// WebSocket client for the game server (DESIGN §8).
//
// - One socket at ws(s)://<host>/ws, JSON text frames `{ t, ...payload }`.
// - Auto-reconnect with exponential backoff + jitter; a heartbeat (`ping`) measures latency and
//   detects dead sockets (a ping left unanswered — no inbound frame at all — for DEAD_AFTER_MS ⇒
//   close ⇒ reconnect). Measured from the oldest unanswered ping, not from the last inbound frame,
//   so a background tab whose timers the browser throttles to ~1/min is not mistaken for dead.
// - On every (re)connect, once a player name is known, sends `hello {name, token, version}`;
//   the session is "online" after `welcome`.
// - `request(t, fields)` adds a `rid` and resolves on the matching `ok` (or any reply carrying the
//   rid), rejects with a NetError on `error` or after REQUEST_TIMEOUT_MS. Requests made while
//   reconnecting are queued and flushed after `welcome` (still bound by their timeout).
// - Every server push is emitted by its `t` (see shared/protocol.js S2C) and as '*'.
//   Extra events: 'status', 'ping', 'clock', 'helloError', 'unhandledError', 'replaced'.
// - Server close code 4001 ("session replaced": the same token connected from another tab) stops
//   auto-reconnect (status 'closed', lastError REPLACED) so two tabs never fight over one session.
// - Before a name is known (title screen) the socket only pings; the server closes such sockets
//   with 4002 (hello timeout). That close is answered with a quiet swap: a fresh socket is opened
//   while the status stays 'connected', so the title's server indicator doesn't flicker.
// - Server clock offset (serverNow ≈ Date.now() + offset) from pong samples (lowest RTT wins),
//   bootstrapped from `welcome.serverNow` / `m.public.serverNow`.
//
// Identity persistence (`identity`, see the section at the end): the name lives in localStorage;
// the reconnect token lives in sessionStorage (survives reloads of this tab) plus a short list of
// recent tokens in localStorage (resume after closing/reopening the tab). `identity.init()` asks
// the other live tabs over a BroadcastChannel which tokens they hold, so a second or duplicated tab
// of the same browser becomes a separate player instead of hijacking another tab's session.
//
// Shared modules are imported relatively: in the browser '../../shared/x.js' from /js/ resolves
// to /shared/x.js (URL resolution clamps at the root); under Node it resolves to <repo>/shared.

import { PROTOCOL_VERSION, ERR_TEXT } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { T } from './i18n.js';
export const REQUEST_TIMEOUT_MS = 8000;
export const HELLO_TIMEOUT_MS = 8000;
export const PING_INTERVAL_MS = 4000;
export const DEAD_AFTER_MS = 15000;
export const BACKOFF = Object.freeze({ base: 500, factor: 2, max: 10000, jitter: 0.2 });

/** Client-side error codes (in addition to shared ERR codes). */
export const CLIENT_ERR_TEXT = Object.freeze({
  TIMEOUT: T('请求超时，请重试'),
  OFFLINE: T('未连接到服务器'),
  DISCONNECTED: T('连接已断开，请重试'),
  CLOSED: T('连接已关闭'),
  REPLACED: T('该身份已在其他页面登录'),
  VERSION: T('客户端版本与服务器不一致，请刷新页面'),
});

/** Server close code: the session was taken over by another socket (server/net.js CLOSE.REPLACED). */
export const CLOSE_REPLACED = 4001;
/** Server close code: the socket never sent `hello` (server/net.js CLOSE.HELLO_TIMEOUT, ~30–60 s). */
export const CLOSE_HELLO_TIMEOUT = 4002;
/** A pre-hello socket must have lived this long before a 4002 close is swapped quietly (no loop). */
const QUIET_SWAP_MIN_AGE_MS = 5000;

/**
 * Human readable (Chinese) text for an error code.
 * @param {string} code
 * @param {string} [msg] server-provided message (fallback)
 * @returns {string}
 */
export function errorText(code, msg) {
  return (ERR_TEXT[code] ? T(ERR_TEXT[code]) : null) || CLIENT_ERR_TEXT[code] || (typeof msg === 'string' && msg ? T(msg) : null) || String(code || T('未知错误'));
}

/** Error thrown/rejected by requests. `code` is an ERR code or a CLIENT_ERR_TEXT key. */
export class NetError extends Error {
  /** @param {string} code @param {string} [msg] server text @param {string} [detail] server developer detail */
  constructor(code, msg, detail) {
    const versionMismatch = typeof detail === 'string' && /version/i.test(detail);
    super(versionMismatch ? CLIENT_ERR_TEXT.VERSION : errorText(code, msg));
    this.name = 'NetError';
    this.code = String(code || 'INTERNAL');
    this.serverMsg = msg ?? null;
    this.detail = typeof detail === 'string' ? detail : null;
  }
}

/**
 * Reconnect delay for the n-th consecutive failed attempt (0-based), with ±jitter.
 * @param {number} attempt
 * @param {() => number} [rand]
 * @returns {number} milliseconds
 */
export function backoffDelay(attempt, rand = Math.random) {
  const n = Math.max(0, Math.min(30, Math.floor(Number(attempt) || 0)));
  const raw = Math.min(BACKOFF.max, BACKOFF.base * BACKOFF.factor ** n);
  const jitter = raw * BACKOFF.jitter * (rand() * 2 - 1);
  return Math.max(100, Math.round(raw + jitter));
}

/**
 * WebSocket URL for the current page (`ws(s)://host/ws`).
 * @param {{protocol: string, host: string}} [loc]
 * @returns {string}
 */
export function defaultWsUrl(loc = globalThis.location) {
  if (!loc || !loc.host) return 'ws://localhost:3000/ws';
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

const WS_OPEN = 1;
const WS_CONNECTING = 0;

/**
 * Game server connection. Construct with injectable dependencies for tests.
 */
export class Net {
  /**
   * @param {object} [opts]
   * @param {string} [opts.url] socket URL (default: derived from location at connect time)
   * @param {any} [opts.WebSocket] WebSocket constructor (default: globalThis.WebSocket)
   * @param {() => (string|null)} [opts.getToken] reconnect-token provider for `hello`
   * @param {() => number} [opts.now]
   * @param {() => number} [opts.random]
   * @param {{setTimeout: Function, clearTimeout: Function, setInterval: Function, clearInterval: Function}} [opts.timers]
   */
  constructor(opts = {}) {
    this.url = opts.url || null;
    this.WS = opts.WebSocket || null;
    this.getToken = typeof opts.getToken === 'function' ? opts.getToken : () => null;
    this.now = opts.now || (() => Date.now());
    this.random = opts.random || Math.random;
    this.timers = opts.timers || {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (id) => globalThis.clearTimeout(id),
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (id) => globalThis.clearInterval(id),
    };

    /** @type {'idle'|'connecting'|'connected'|'handshaking'|'online'|'reconnecting'|'closed'} */
    this.status = 'idle';
    this.ws = null;
    this.name = null;          // desired player name (hello is sent when set)
    this.helloName = null;     // name we sent in the hello that got the last welcome
    this.serverName = null;    // name as normalised by the server
    this.playerId = null;
    this.attempt = 0;          // consecutive failed connection attempts
    this.retryAt = 0;          // epoch ms of the next reconnect attempt (0 = none)
    this.ping = null;          // last RTT in ms
    this.lastError = null;     // last NetError relevant to the connection (e.g. hello rejected)
    this.clockOffset = 0;
    this.clockSynced = false;

    this._rid = 0;
    this._pending = new Map(); // rid -> { msg, resolve, reject, timer, sent }
    this._expired = new Set(); // rids that timed out locally (their late error was already reported)
    this._listeners = new Map();
    this._manualClose = false;
    this._quietSwap = false;   // next connect() keeps the current status (see CLOSE_HELLO_TIMEOUT)
    this._openedAt = 0;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._helloTimer = null;
    this._helloRid = null;
    this._helloSentName = null;
    this._lastRx = 0;
    this._unansweredSince = null; // time of the oldest ping sent since the last inbound frame
    this._clockSamples = [];   // [{ offset, rtt }]
  }

  // ---- events ----------------------------------------------------------------------------------

  /**
   * Subscribe to a message type (any S2C `t`), '*' (all messages) or a client event
   * ('status' | 'ping' | 'clock' | 'helloError' | 'unhandledError').
   * @param {string} type
   * @param {(payload: any) => void} fn
   * @returns {() => void} unsubscribe
   */
  on(type, fn) {
    if (typeof fn !== 'function') return () => {};
    let set = this._listeners.get(type);
    if (!set) this._listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => this.off(type, fn);
  }

  /** @param {string} type @param {Function} fn */
  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  _emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error(`[net] listener for "${type}" failed`, err); }
    }
  }

  /** Snapshot of the connection state (what the 'status' event carries). */
  snapshot() {
    return {
      status: this.status, attempt: this.attempt, retryAt: this.retryAt, ping: this.ping,
      lastError: this.lastError ? { code: this.lastError.code, text: this.lastError.message } : null,
      playerId: this.playerId,
    };
  }

  _setStatus(status) {
    this.status = status;
    this._emit('status', this.snapshot());
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  /** Open the socket (no-op when already open/connecting). Also resumes after close()/replacement. */
  connect() {
    const quiet = this._quietSwap;
    this._quietSwap = false;
    if (this.ws && (this.ws.readyState === WS_OPEN || this.ws.readyState === WS_CONNECTING)) return;
    this._manualClose = false;
    this._clearTimer('_reconnectTimer', 'clearTimeout');
    this.retryAt = 0;
    const WS = this.WS || globalThis.WebSocket;
    const url = this.url || defaultWsUrl();
    let ws;
    try {
      ws = new WS(url);
    } catch (err) {
      console.warn('[net] cannot create WebSocket', err);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    if (!quiet) this._setStatus(this.attempt > 0 ? 'reconnecting' : 'connecting');
    ws.onopen = () => { if (ws === this.ws) this._onOpen(); };
    ws.onmessage = (ev) => { if (ws === this.ws) this._onMessage(ev?.data); };
    ws.onerror = () => { /* followed by close */ };
    ws.onclose = (ev) => { if (ws === this.ws) this._onClose(ev); };
  }

  /** Close for good (no reconnect). Pending requests reject with CLOSED. */
  close() {
    this._manualClose = true;
    this._clearTimer('_reconnectTimer', 'clearTimeout');
    this.retryAt = 0;
    const ws = this.ws;
    this._teardownSocket();
    try { ws?.close(1000, 'client close'); } catch { /* ignore */ }
    this._failPending('CLOSED', true);
    this._setStatus('closed');
  }

  /** Skip the backoff wait and reconnect right now (used on `online` / tab focus / retry button). */
  retryNow() {
    if (this._manualClose) return;
    if (this.ws && (this.ws.readyState === WS_OPEN || this.ws.readyState === WS_CONNECTING)) return;
    this.connect();
  }

  /** Drop the current socket and reconnect immediately (fresh hello). */
  reconnectNow() {
    if (this._manualClose) return;
    const ws = this.ws;
    this._teardownSocket();
    try { ws?.close(4000, 'reconnect'); } catch { /* ignore */ }
    this._failPending('DISCONNECTED', false);
    this.attempt = 0;
    this.connect();
  }

  /**
   * Set the player name used in `hello`. Sends hello right away when the socket is open (the server
   * accepts a repeated hello on a live socket: it renames the session and resyncs room/match
   * state), otherwise as soon as it opens. No-op when that name is already accepted.
   * @param {string} name
   */
  setName(name) {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) return;
    const changed = n !== this.name;
    this.name = n;
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      if (!this.ws && !this._reconnectTimer && !this._manualClose) this.connect();
      return; // hello goes out on open
    }
    if (this.status === 'online' && this.helloName === n) return;
    if (this.status === 'handshaking' && !changed && this._helloSentName === n) return;
    // The server accepts a repeated hello on a live socket (it renames the session and resyncs).
    this._sendHello();
  }

  _onOpen() {
    this._openedAt = this.now();
    this._lastRx = this._openedAt;
    this._unansweredSince = null;
    this.retryAt = 0;
    this._startHeartbeat();
    if (this.name) {
      this._setStatus('handshaking');
      this._sendHello();
    } else {
      this.attempt = 0;
      this._setStatus('connected');
      this._sendPing();
    }
  }

  _onClose(ev) {
    this._teardownSocket();
    this._failPending('DISCONNECTED', false);
    if (this._manualClose) { this._setStatus('closed'); return; }
    if (ev && ev.code === CLOSE_REPLACED) {
      // Another tab/socket took this session over: don't fight it; the user may reconnect manually.
      this._manualClose = true;
      this._failPending('REPLACED', true);
      this.lastError = new NetError('REPLACED');
      this._setStatus('closed');
      this._emit('replaced', this.lastError);
      return;
    }
    if (ev && ev.code === CLOSE_HELLO_TIMEOUT && !this.name && this.status === 'connected'
        && this.now() - this._openedAt >= QUIET_SWAP_MIN_AGE_MS) {
      // Idle pre-hello socket dropped by the server: replace it without a visible status change.
      this._quietSwap = true;
      this.connect();
      return;
    }
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._manualClose) return;
    const delay = backoffDelay(this.attempt, this.random);
    this.attempt += 1;
    this.retryAt = this.now() + delay;
    this._clearTimer('_reconnectTimer', 'clearTimeout');
    this._reconnectTimer = this.timers.setTimeout(() => {
      this._reconnectTimer = null;
      this.connect();
    }, delay);
    this._setStatus('reconnecting');
  }

  _teardownSocket() {
    const ws = this.ws;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    }
    this.ws = null;
    this._unansweredSince = null;
    this._clearTimer('_pingTimer', 'clearInterval');
    this._clearTimer('_helloTimer', 'clearTimeout');
    this._helloRid = null;
    this._helloSentName = null;
  }

  _clearTimer(field, fn) {
    if (this[field] != null) {
      try { this.timers[fn](this[field]); } catch { /* ignore */ }
      this[field] = null;
    }
  }

  // ---- handshake -------------------------------------------------------------------------------

  _sendHello() {
    if (!this.name) return;
    const rid = this._nextRid();
    const msg = { t: 'hello', rid, name: this.name, version: PROTOCOL_VERSION };
    let token = null;
    try { token = this.getToken(); } catch { token = null; }
    if (typeof token === 'string' && token.length > 0 && token.length <= 64) msg.token = token;
    this._helloRid = rid;
    this._helloSentName = this.name;
    if (this.status !== 'handshaking') this._setStatus('handshaking');
    if (!this._sendRaw(msg)) return;
    this._clearTimer('_helloTimer', 'clearTimeout');
    this._helloTimer = this.timers.setTimeout(() => {
      this._helloTimer = null;
      if (this.status !== 'handshaking') return;
      console.warn('[net] hello timed out; reconnecting');
      const ws = this.ws;
      this._teardownSocket();
      try { ws?.close(4000, 'hello timeout'); } catch { /* ignore */ }
      this._failPending('DISCONNECTED', false);
      this._scheduleReconnect();
    }, HELLO_TIMEOUT_MS);
  }

  _onWelcome(msg) {
    this._clearTimer('_helloTimer', 'clearTimeout');
    this._helloRid = null;
    // Compare future setName() calls against what we sent (the server may normalise the name).
    this.helloName = this._helloSentName;
    this.serverName = typeof msg.name === 'string' && msg.name ? msg.name : this._helloSentName;
    this.playerId = msg.playerId ?? null;
    this.attempt = 0;
    this.lastError = null;
    if (Number.isFinite(msg.serverNow)) this._addClockSample(msg.serverNow + (this.ping ?? 0) / 2 - this.now(), Infinity);
    this._setStatus('online');
    this._flushQueue();
    this._sendPing();
  }

  _onHelloError(msg) {
    this._clearTimer('_helloTimer', 'clearTimeout');
    this._helloRid = null;
    this.lastError = new NetError(msg.code, msg.msg, msg.detail);
    this._setStatus('connected');
    // Queued requests can't be sent without a session.
    this._failPending('OFFLINE', true);
    this._emit('helloError', this.lastError);
  }

  // ---- requests --------------------------------------------------------------------------------

  _nextRid() {
    this._rid = (this._rid % 2147483000) + 1;
    return this._rid;
  }

  /**
   * Send a request and wait for its `ok` (resolves with the reply message) or `error`
   * (rejects with NetError). Rejects with TIMEOUT after `timeout` ms, OFFLINE when there is no
   * session to send it on, BAD_MSG when it fails shared/protocol.js validation locally.
   * @param {string} t message type (C2S)
   * @param {object} [fields]
   * @param {{timeout?: number}} [opts]
   * @returns {Promise<any>}
   */
  request(t, fields = {}, opts = {}) {
    return new Promise((resolve, reject) => {
      if (t === 'hello') { reject(new NetError('BAD_MSG', 'use setName() for hello')); return; }
      const rid = this._nextRid();
      const msg = { ...(fields && typeof fields === 'object' ? fields : {}), t, rid };
      const bad = validateC2S(msg);
      if (bad) {
        console.warn(`[net] refusing invalid ${t}: ${bad}`);
        reject(new NetError('BAD_MSG', bad));
        return;
      }
      // Queue while a session is being (re)established; fail fast when none can come.
      const establishing = this.status === 'connecting' || this.status === 'handshaking' || this.status === 'reconnecting';
      if (this.status !== 'online' && !(establishing && this.name && !this._manualClose)) {
        reject(new NetError(this._manualClose ? 'CLOSED' : 'OFFLINE'));
        return;
      }
      const timeout = Number.isFinite(opts.timeout) && opts.timeout > 0 ? opts.timeout : REQUEST_TIMEOUT_MS;
      const entry = { msg, resolve, reject, sent: false, timer: null };
      entry.timer = this.timers.setTimeout(() => {
        if (this._pending.get(rid) !== entry) return;
        this._pending.delete(rid);
        if (entry.sent) {
          this._expired.add(rid);
          if (this._expired.size > 64) this._expired.delete(this._expired.values().next().value);
        }
        reject(new NetError('TIMEOUT'));
      }, timeout);
      this._pending.set(rid, entry);
      if (this.status === 'online') entry.sent = this._sendRaw(msg);
    });
  }

  /**
   * Fire-and-forget message (no rid). Returns false when it could not be sent.
   * @param {string} t
   * @param {object} [fields]
   * @returns {boolean}
   */
  send(t, fields = {}) {
    if (t === 'hello') return false;
    const msg = { ...(fields && typeof fields === 'object' ? fields : {}), t };
    const bad = validateC2S(msg);
    if (bad) { console.warn(`[net] refusing invalid ${t}: ${bad}`); return false; }
    if (this.status !== 'online') return false;
    return this._sendRaw(msg);
  }

  _sendRaw(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (err) {
      console.warn('[net] send failed', err);
      return false;
    }
  }

  _flushQueue() {
    for (const entry of this._pending.values()) {
      if (!entry.sent) entry.sent = this._sendRaw(entry.msg);
    }
  }

  /**
   * Reject pending requests. Sent ones always fail (their reply is lost with the socket);
   * unsent (queued) ones fail only when `includeQueued` is true.
   */
  _failPending(code, includeQueued) {
    for (const [rid, entry] of [...this._pending]) {
      if (!entry.sent && !includeQueued) continue;
      this._pending.delete(rid);
      this._clearEntryTimer(entry);
      try { entry.reject(new NetError(code)); } catch { /* ignore */ }
    }
  }

  _clearEntryTimer(entry) {
    if (entry.timer != null) {
      try { this.timers.clearTimeout(entry.timer); } catch { /* ignore */ }
      entry.timer = null;
    }
  }

  /** Number of requests waiting for a reply (sent or queued). */
  get pendingCount() {
    return this._pending.size;
  }

  // ---- incoming --------------------------------------------------------------------------------

  _onMessage(data) {
    this._lastRx = this.now();
    this._unansweredSince = null;
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      console.warn('[net] dropped non-JSON frame');
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') return;
    const { t } = msg;
    const rid = msg.rid;
    const isHelloError = t === 'error' && rid != null && rid === this._helloRid;

    if (t === 'welcome') {
      this._onWelcome(msg);
    } else if (t === 'pong') {
      this._onPong(msg);
    } else if (isHelloError) {
      this._onHelloError(msg);
    } else if (t === 'm.public' && Number.isFinite(msg.serverNow) && !this.clockSynced) {
      this._addClockSample(msg.serverNow + (this.ping ?? 0) / 2 - this.now(), Infinity);
    }

    let handled = false;
    if (rid != null && t !== 'welcome' && this._pending.has(rid)) {
      const entry = this._pending.get(rid);
      this._pending.delete(rid);
      this._clearEntryTimer(entry);
      handled = true;
      try {
        if (t === 'error') entry.reject(new NetError(msg.code, msg.msg, msg.detail));
        else entry.resolve(msg);
      } catch (err) { console.error('[net] request callback failed', err); }
    }
    const late = rid != null && !handled && this._expired.delete(rid); // reply to a request that already timed out
    if (t === 'error' && !handled && !isHelloError && !late) {
      this._emit('unhandledError', new NetError(msg.code, msg.msg, msg.detail));
    }

    this._emit(t, msg);
    this._emit('*', msg);
  }

  // ---- heartbeat & clock -----------------------------------------------------------------------

  _startHeartbeat() {
    this._clearTimer('_pingTimer', 'clearInterval');
    this._pingTimer = this.timers.setInterval(() => this._heartbeat(), PING_INTERVAL_MS);
  }

  _heartbeat() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    const live = this.status === 'online' || this.status === 'connected';
    if (live && this._unansweredSince != null && this.now() - this._unansweredSince > DEAD_AFTER_MS) {
      console.warn('[net] connection silent; reconnecting');
      this._teardownSocket();
      try { ws.close(4000, 'heartbeat timeout'); } catch { /* ignore */ }
      this._failPending('DISCONNECTED', false);
      this._scheduleReconnect();
      return;
    }
    this._sendPing();
  }

  _sendPing() {
    if (this.status !== 'online' && this.status !== 'connected') return;
    const now = this.now();
    if (this._sendRaw({ t: 'ping', c: now }) && this._unansweredSince == null) this._unansweredSince = now;
  }

  /** Force an immediate latency probe (e.g. when the tab regains focus). */
  probe() {
    this._heartbeat();
  }

  _onPong(msg) {
    const now = this.now();
    const c = Number(msg.c);
    if (!Number.isFinite(c)) return;
    const rtt = now - c;
    if (!(rtt >= 0 && rtt < 60000)) return;
    this.ping = Math.round(rtt);
    if (Number.isFinite(msg.s)) this._addClockSample(msg.s + rtt / 2 - now, rtt);
    this._emit('ping', this.ping);
    this._emit('status', this.snapshot());
  }

  _addClockSample(offset, rtt) {
    if (!Number.isFinite(offset)) return;
    this._clockSamples.push({ offset, rtt });
    if (this._clockSamples.length > 8) this._clockSamples.shift();
    let best = this._clockSamples[0];
    for (const s of this._clockSamples) if (s.rtt < best.rtt) best = s;
    const prev = this.clockOffset;
    this.clockOffset = Math.round(best.offset);
    const wasSynced = this.clockSynced;
    this.clockSynced = this.clockSynced || Number.isFinite(rtt);
    if (Math.abs(prev - this.clockOffset) >= 1 || wasSynced !== this.clockSynced || this._clockSamples.length === 1) {
      this._emit('clock', { offset: this.clockOffset, rtt: Number.isFinite(best.rtt) ? best.rtt : null, synced: this.clockSynced });
    }
  }

  /** Current server time estimate (ms epoch). */
  serverNow() {
    return this.now() + this.clockOffset;
  }

  /**
   * Hook browser signals: reconnect immediately when the network comes back or the tab becomes
   * visible, and probe latency on focus. Safe to call in non-browser environments (no-op).
   */
  attachBrowserHooks() {
    if (typeof window === 'undefined' || this._hooked) return;
    this._hooked = true;
    window.addEventListener('online', () => this.retryNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.status === 'reconnecting') this.retryNow();
      else if (this.status === 'online' || this.status === 'connected') this.probe();
    });
  }
}

// ---- identity persistence -------------------------------------------------------------------------
//
// Which reconnect token a tab uses is decided once per page load by `identity.init()`:
//   1. this tab's own token (sessionStorage: survives reloads of this tab),
//   2. else the most recent token of this browser (localStorage, so closing the tab and reopening
//      the game within the server's reconnect window resumes the seat),
// skipping every token that another *live* tab of this browser is using. Liveness is asked over a
// BroadcastChannel ('who holds these token hashes?' → 'mine'), not inferred from timer heartbeats:
// browsers throttle background-tab timers to ~1/min, which would make a busy background tab look
// dead. A duplicated tab (sessionStorage is copied) therefore drops the copied token and becomes a
// new player instead of kicking the original tab off its session (server close 4001). Two tabs
// resolving at the same moment tie-break on tab id. Without BroadcastChannel a tab only ever uses
// its own token (never another tab's), so it can't steal a live session either.

const K_NAME = 'sp.name';
const K_TOKEN = 'sp.token';      // sessionStorage: this tab's token
const K_RECENT = 'sp.tokens';    // localStorage: this browser's recent tokens, most recent first
const K_ENTERED = 'sp.entered';  // sessionStorage: this tab passed the title screen
const RECENT_MAX = 4;
const TOKEN_MAX_LEN = 64;        // protocol limit for hello.token
const CHANNEL_NAME = 'sp.identity';
/** How long init() waits for other tabs to claim a candidate token (ms). */
export const CLAIM_QUERY_MS = 150;

function safeStorage(kind) {
  try {
    const s = globalThis[kind];
    if (!s) return null;
    const probe = '__sp_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function sget(s, k) { try { return s ? s.getItem(k) : null; } catch { return null; } }
function sset(s, k, v) { try { if (s) s.setItem(k, v); } catch { /* quota / privacy mode */ } }
function sdel(s, k) { try { if (s) s.removeItem(k); } catch { /* ignore */ } }

const isToken = (t) => typeof t === 'string' && t.length > 0 && t.length <= TOKEN_MAX_LEN;

/**
 * Short, stable hash of a token (FNV-1a, hex) so tabs never broadcast tokens in clear.
 * @param {string} token
 * @returns {string}
 */
export function tokenHash(token) {
  let h = 2166136261;
  const s = String(token);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function defaultChannel() {
  try {
    return typeof globalThis.BroadcastChannel === 'function' ? new globalThis.BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    return null;
  }
}

/**
 * Create the identity helper (nickname, "entered" flag and reconnect-token selection; see above).
 * @param {{ local?: Storage|null, session?: Storage|null, tabId?: string,
 *           channel?: { postMessage: Function, addEventListener?: Function, onmessage?: any } | null,
 *           setTimeout?: (fn: Function, ms: number) => any, queryMs?: number }} [deps]
 */
export function createIdentity(deps = {}) {
  const local = deps.local !== undefined ? deps.local : safeStorage('localStorage');
  const session = deps.session !== undefined ? deps.session : safeStorage('sessionStorage');
  const tabId = deps.tabId || Math.random().toString(36).slice(2) + Date.now().toString(36);
  const setTimer = deps.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
  const queryMs = Number.isFinite(deps.queryMs) && deps.queryMs >= 0 ? deps.queryMs : CLAIM_QUERY_MS;

  let channel = null;
  let initPromise = null;
  let initialized = false;
  let current = null;    // token this tab uses (null = let the server create a session)
  let resolving = null;  // { taken: Set<hash> } while init() waits for claims

  const readRecent = () => {
    try {
      const v = JSON.parse(sget(local, K_RECENT) || '[]');
      return Array.isArray(v) ? v.filter(isToken) : [];
    } catch {
      return [];
    }
  };
  const writeRecent = (list) => sset(local, K_RECENT, JSON.stringify([...new Set(list)].slice(0, RECENT_MAX)));

  const post = (msg) => {
    try { channel?.postMessage({ ...msg, from: tabId }); } catch { /* channel closed */ }
  };

  function onChannelMessage(ev) {
    const m = ev && ev.data;
    if (!m || typeof m !== 'object' || m.from === tabId || typeof m.from !== 'string') return;
    if (m.type === 'who' && Array.isArray(m.hashes)) {
      if (current) {
        const h = tokenHash(current);
        if (m.hashes.includes(h)) post({ type: 'mine', hash: h, to: m.from });
      }
      // Another tab is choosing at the same time: the smaller tab id has precedence.
      if (resolving && m.from < tabId) for (const h of m.hashes) if (typeof h === 'string') resolving.taken.add(h);
    } else if (m.type === 'mine' && resolving && m.to === tabId && typeof m.hash === 'string') {
      resolving.taken.add(m.hash);
    }
  }

  async function resolveToken() {
    channel = deps.channel !== undefined ? deps.channel : defaultChannel();
    if (channel) {
      if (typeof channel.addEventListener === 'function') channel.addEventListener('message', onChannelMessage);
      else channel.onmessage = onChannelMessage;
    }
    const own = sget(session, K_TOKEN);
    const ownOk = isToken(own) ? own : null;
    // Without a channel we cannot tell whether a shared token is in use: never adopt one.
    const candidates = [...new Set([ownOk, ...(channel ? readRecent() : [])].filter(isToken))];
    if (!channel || candidates.length === 0) return ownOk;
    resolving = { taken: new Set() };
    post({ type: 'who', hashes: candidates.map(tokenHash) });
    await new Promise((r) => setTimer(r, queryMs));
    const { taken } = resolving;
    resolving = null;
    return candidates.find((t) => !taken.has(tokenHash(t))) || null;
  }

  return {
    tabId,
    /**
     * Decide which reconnect token this tab uses (once per page load; later calls return the same
     * promise). Call before the first `hello`. Never rejects.
     * @returns {Promise<string|null>}
     */
    init() {
      if (!initPromise) {
        initPromise = resolveToken().catch(() => null).then((pick) => {
          const own = sget(session, K_TOKEN);
          if (pick) sset(session, K_TOKEN, pick);
          else if (own) sdel(session, K_TOKEN); // duplicated tab: the copied token belongs to a live tab
          // A welcome may already have set a token while we were waiting: that one wins.
          if (!current) current = pick;
          initialized = true;
          return current;
        });
      }
      return initPromise;
    },
    /** @returns {string} remembered player name ('' if none) */
    loadName: () => (sget(local, K_NAME) || '').slice(0, 64),
    /** @param {string} name */
    saveName: (name) => sset(local, K_NAME, String(name)),
    /** Token for `hello` (null ⇒ new session). Before init() only this tab's own token is used. */
    getToken() {
      if (current) return current;
      if (initialized) return null;
      const own = sget(session, K_TOKEN);
      return isToken(own) ? own : null;
    },
    /** @param {string} token from `welcome` */
    saveToken(token) {
      if (!isToken(token)) return;
      current = token;
      sset(session, K_TOKEN, token);
      writeRecent([token, ...readRecent().filter((t) => t !== token)]);
    },
    /** Forget this tab's token (e.g. the server said the session is invalid). */
    clearToken() {
      const t = current || sget(session, K_TOKEN);
      current = null;
      sdel(session, K_TOKEN);
      if (t) writeRecent(readRecent().filter((x) => x !== t));
    },
    /** Whether this tab already passed the title screen (survives reloads, not new tabs). */
    wasEntered: () => sget(session, K_ENTERED) === '1',
    /** @param {boolean} on */
    setEntered: (on) => (on ? sset(session, K_ENTERED, '1') : sdel(session, K_ENTERED)),
  };
}

/** Browser identity singleton (main.js awaits `identity.init()` before connecting). */
export const identity = createIdentity();

/** Browser connection singleton (created lazily-safe: nothing touches the network until connect()). */
export const net = new Net({ getToken: () => identity.getToken() });
