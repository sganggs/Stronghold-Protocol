// server/net.js — WebSocket session layer (DESIGN §1, §8).
//
// Responsibilities:
//   * Session objects (playerId, secret reconnect token, name, bound socket, connection state) and the
//     SessionRegistry that resolves reconnect tokens and expires sessions after the reconnect window (10 min; the
//     lobby may extend it per session via `session.resumeWindowMs` — a solo run: 24 h, see server/lobby.js).
//   * Per-connection pipeline: token-bucket rate limit (40 msg/s) → JSON decode → schema validation
//     (shared/protocol.js) → `hello`/`ping` handling → dispatch to the lobby handler → `ok`/`error`
//     reply echoing the request id (`rid`). Intents whose answer is a large state resend (`g.watch` →
//     m.field) also draw from a second, much smaller bucket (2/s, burst 6), so one socket cannot turn
//     40 tiny requests per second into hundreds of KB/s of downstream traffic.
//   * Client address per connection (`clientAddress`): the socket peer, or — when the peer is a local
//     reverse proxy (loopback / private address, e.g. `cloudflared tunnel --url http://localhost:3000`) —
//     the address it forwards (CF-Connecting-IP, X-Real-IP, rightmost X-Forwarded-For). Its `key` (IPv4
//     address or IPv6 /64) is what per-network limits count against: concurrent sockets here
//     (`maxConnectionsPerAddr`, checked at upgrade time through `admission`), rooms and running matches
//     in server/lobby.js. Local / LAN peers without a forwarding header (dev machine, tests, LAN party)
//     have no key and are never limited per address.
//   * Heartbeat (ws ping/pong every `heartbeatMs`, dead sockets terminated), hello timeout.
//   * Send helpers that never throw, with a backpressure guard: non-critical `b.snap` frames are skipped
//     while the socket has more than 1 MB queued; a socket with more than 16 MB queued is terminated
//     (the client reconnects and receives a full state resync).
//
// Close codes used by the server (clients should NOT auto-reconnect on 4001):
//   4001 session replaced (the same token connected from another socket/tab)
//   4002 hello timeout
//   1008 abusive flooding (rate-limit drops > abuseDropsPerSec)
//   1001 server shutdown
//
// The handler object (implemented by server/lobby.js) receives:
//   onHello(session, { resumed, repeat })  after `welcome` was sent
//   onMessage(session, msg) → { ok: true } | { error: ERR code, detail?: string } | undefined
//   routeGame(session, msg) → same (optional): client-side combat reports `b.progress` / `b.result` (DESIGN §14) go
//                                          straight to the running match through it; without it they reach onMessage
//   onDisconnect(session)                  the session's socket closed (session kept for the reconnect window)
//   onExpire(session)                      the session was purged (disconnected longer than the window)

import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { C2S, validateC2S } from '../shared/protocol.js';
import { ERR, ERR_TEXT, NAME_MAX_LEN, PROTOCOL_VERSION } from '../shared/constants.js';

/** Tunables (all overridable through the Network / SessionRegistry constructors). */
export const NET_DEFAULTS = Object.freeze({
  ratePerSec: 40,               // token bucket refill rate
  rateBurst: 40,                // token bucket capacity
  abuseDropsPerSec: 400,        // rate-limited messages within one second before the socket is closed (1008)
  heartbeatMs: 30_000,          // ping interval; a socket that missed one full interval is terminated
  helloTimeoutMs: 30_000,       // sockets that never say hello are closed (4002)
  reconnectWindowMs: 10 * 60_000, // disconnected sessions stay resumable this long
  snapDropBytes: 1 << 20,       // skip b.snap while bufferedAmount exceeds this
  hardBufferBytes: 16 << 20,    // terminate a socket whose send queue exceeds this
  maxConnections: 2000,         // concurrent sockets (enforced by index.js at upgrade time)
  maxConnectionsPerAddr: 64,    // concurrent sockets per client network key (0 = unlimited); see clientAddress
  maxSessions: 20_000,          // registry cap; oldest idle sessions are evicted first
  heavyPerSec: 2,               // refill of the bucket for resend-heavy intents (HEAVY_TYPES)
  heavyBurst: 6,
  trustProxy: 'auto',           // forwarding headers: 'auto' = from loopback/private peers only, true = always, false = never
});

/**
 * Intents that also draw from the per-connection heavy bucket: g.watch (its reply is a large state resend, m.field),
 * room.loadout (a ≤ 160-entry map validated against the game data; the client debounces its edits) and room.spectate
 * (taking a spectator seat in a running match resends its state like a watcher's g.watch — server/lobby.js spectate).
 */
export const HEAVY_TYPES = new Set(['g.watch', 'room.loadout', 'room.spectate']);

/** Close codes (see header). */
export const CLOSE = Object.freeze({ REPLACED: 4001, HELLO_TIMEOUT: 4002, POLICY: 1008, SHUTDOWN: 1001 });

const WS_OPEN = 1;
const MAX_RID = 2 ** 31;
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

// ---------------------------------------------------------------------------------------------------
// Session & registry
// ---------------------------------------------------------------------------------------------------

/** One logical player identity; survives socket reconnects for the reconnect window. */
export class Session {
  /**
   * @param {{ playerId: string, token: string, name: string, now?: number }} init
   */
  constructor({ playerId, token, name, now = Date.now() }) {
    /** @type {string} public id, shared with other players */
    this.playerId = playerId;
    /** @type {string} secret 128-bit hex reconnect token (only ever sent to its owner) */
    this.token = token;
    /** @type {string} sanitized nickname */
    this.name = name;
    /** @type {import('ws').WebSocket | null} currently bound socket */
    this.ws = null;
    /** @type {boolean} */
    this.connected = false;
    /** @type {number} ms epoch of the last inbound frame / pong */
    this.lastSeen = now;
    /** @type {number | null} ms epoch when the socket was lost (null while connected) */
    this.disconnectedAt = now;
    /** @type {string | null} room code — owned and maintained by server/lobby.js */
    this.roomCode = null;
    /** @type {string | null} pending `room.closed` reason to deliver on the next resume (lobby-owned) */
    this.notice = null;
    /** @type {string[] | null} encoded frames (final m.public + m.result) to deliver on the next resume (lobby-owned) */
    this.pendingResult = null;
    /** @type {number} ms epoch of the last full match resync (lobby-owned; throttles repeated hellos) */
    this.resyncAt = -Infinity;
    /** @type {Record<string, { skill: number, module: string|null }> | null} checked operator loadout (lobby-owned, DESIGN §16) */
    this.loadout = null;
    /** @type {string} client address of the latest connection (logging) */
    this.addr = '?';
    /** @type {string | null} per-network limit key of the latest connection (null = not limited), see clientAddress */
    this.limitKey = null;
    /**
     * @type {number | null} lobby-owned extension of the reconnect window for this session (ms; null = the registry's
     * window). A solo run keeps its session resumable for the official `singleReconnectTime` (24 h) — see lobby.js.
     */
    this.resumeWindowMs = null;
  }
}

/** Random 128-bit hex token. */
export const newToken = () => randomBytes(16).toString('hex');

/** Registry of sessions by playerId and by token; purges sessions disconnected longer than the window. */
export class SessionRegistry {
  /**
   * @param {{ reconnectWindowMs?: number, maxSessions?: number, now?: () => number }} [opts]
   */
  constructor({ reconnectWindowMs = NET_DEFAULTS.reconnectWindowMs, maxSessions = NET_DEFAULTS.maxSessions, now = Date.now } = {}) {
    this.reconnectWindowMs = reconnectWindowMs;
    this.maxSessions = maxSessions;
    this.now = now;
    /** @type {Map<string, Session>} */ this.byPlayerId = new Map();
    /** @type {Map<string, Session>} */ this.byTokenMap = new Map();
  }

  get size() { return this.byPlayerId.size; }

  /**
   * Create a new session with a fresh playerId and token. Evicts the oldest idle (disconnected, roomless)
   * session when the registry is full. Returns null when full of active sessions.
   * @param {string} name
   * @returns {Session | null}
   */
  create(name) {
    if (this.byPlayerId.size >= this.maxSessions && !this.evictOne()) return null;
    let playerId;
    do playerId = 'p_' + randomBytes(5).toString('hex'); while (this.byPlayerId.has(playerId));
    let token;
    do token = newToken(); while (this.byTokenMap.has(token));
    const s = new Session({ playerId, token, name, now: this.now() });
    this.byPlayerId.set(playerId, s);
    this.byTokenMap.set(token, s);
    return s;
  }

  /** @param {unknown} token @returns {Session | null} a live (non-expired) session for this token */
  byToken(token) {
    if (typeof token !== 'string' || token.length === 0) return null;
    const s = this.byTokenMap.get(token);
    if (!s) return null;
    if (this.isExpired(s, this.now())) return null;
    return s;
  }

  /** @param {string} playerId @returns {Session | null} */
  byId(playerId) { return this.byPlayerId.get(playerId) || null; }

  /** @param {Session} s */
  remove(s) {
    if (this.byPlayerId.get(s.playerId) === s) this.byPlayerId.delete(s.playerId);
    if (this.byTokenMap.get(s.token) === s) this.byTokenMap.delete(s.token);
  }

  /**
   * The reconnect window of one session: the registry's, or the session's own `resumeWindowMs` when that is longer
   * (the lobby may only extend it, never shorten it).
   * @param {Session} s @returns {number} ms
   */
  windowOf(s) {
    const own = s.resumeWindowMs;
    return typeof own === 'number' && own > this.reconnectWindowMs ? own : this.reconnectWindowMs;
  }

  /** @param {Session} s @param {number} now */
  isExpired(s, now) {
    return !s.connected && s.disconnectedAt != null && now - s.disconnectedAt > this.windowOf(s);
  }

  /**
   * Remove and return every session whose reconnect window has elapsed.
   * @param {number} [now]
   * @returns {Session[]}
   */
  sweep(now = this.now()) {
    const out = [];
    for (const s of this.byPlayerId.values()) if (this.isExpired(s, now)) out.push(s);
    for (const s of out) this.remove(s);
    return out;
  }

  /** Evict the oldest disconnected session that is not in a room. @returns {boolean} */
  evictOne() {
    for (const s of this.byPlayerId.values()) {
      if (!s.connected && !s.roomCode) { this.remove(s); return true; }
    }
    return false;
  }

  /** @returns {IterableIterator<Session>} */
  all() { return this.byPlayerId.values(); }
}

// ---------------------------------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------------------------------

/** Classic token bucket: `burst` capacity, refilled continuously at `ratePerSec`. */
export class TokenBucket {
  /** @param {number} ratePerSec @param {number} burst @param {number} now ms */
  constructor(ratePerSec, burst, now) {
    this.rate = ratePerSec / 1000;
    this.burst = burst;
    this.tokens = burst;
    this.at = now;
  }

  /** Consume one token. @param {number} now ms @returns {boolean} false when rate-limited */
  take(now) {
    const dt = Math.max(0, now - this.at);
    this.at = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate);
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------
// Send helpers (never throw)
// ---------------------------------------------------------------------------------------------------

/**
 * JSON-encode a message; returns null (and never throws) on unserializable input.
 * @param {object} msg
 * @returns {string | null}
 */
export function encode(msg) {
  try {
    const s = JSON.stringify(msg);
    return typeof s === 'string' ? s : null;
  } catch {
    return null;
  }
}

const onSendDone = (err) => { void err; }; // errors surface through the socket's 'error'/'close' events

/**
 * Send an already-encoded frame. Skips when the socket is not OPEN, when `droppable` and the socket is
 * congested (> 1 MB queued), and terminates sockets whose queue exceeds 16 MB.
 * @param {import('ws').WebSocket | null | undefined} ws
 * @param {string} data
 * @param {{ droppable?: boolean }} [opts]
 * @returns {boolean} true when the frame was queued
 */
export function sendRaw(ws, data, { droppable = false } = {}) {
  if (!ws || ws.readyState !== WS_OPEN || typeof data !== 'string') return false;
  try {
    const queued = ws.bufferedAmount;
    if (queued > NET_DEFAULTS.hardBufferBytes) { ws.terminate(); return false; }
    if (droppable && queued > NET_DEFAULTS.snapDropBytes) return false;
    ws.send(data, onSendDone);
    return true;
  } catch {
    return false;
  }
}

/** True for frames that may be skipped under backpressure (only battle snapshots). */
export const isDroppable = (msg) => !!msg && msg.t === 'b.snap';

/**
 * Encode and send one message to a socket. Never throws.
 * @param {import('ws').WebSocket | null | undefined} ws
 * @param {object} msg
 * @returns {boolean}
 */
export function send(ws, msg) {
  const data = encode(msg);
  if (data == null) return false;
  return sendRaw(ws, data, { droppable: isDroppable(msg) });
}

/**
 * Send to a session's current socket (no-op while disconnected). Never throws.
 * @param {Session | null | undefined} session
 * @param {object} msg
 * @returns {boolean}
 */
export function sendSession(session, msg) {
  if (!session || !session.connected) return false;
  return send(session.ws, msg);
}

/** @param {unknown} rid */
const validRid = (rid) => Number.isInteger(rid) && rid >= 0 && rid <= MAX_RID;

/**
 * True for a real ERR code (own property; rejects inherited names like "constructor").
 * @param {unknown} code
 * @returns {boolean}
 */
export const isErrCode = (code) => typeof code === 'string' && Object.hasOwn(ERR, code);

/**
 * Build an `error` frame.
 * @param {string} code ERR code
 * @param {unknown} [rid]
 * @param {string} [detail] developer-facing reason
 */
export function errorMsg(code, rid, detail) {
  const known = isErrCode(code);
  const m = { t: 'error', code: known ? code : ERR.INTERNAL, msg: known ? ERR_TEXT[code] || ERR_TEXT.INTERNAL : ERR_TEXT.INTERNAL };
  if (validRid(rid)) m.rid = rid;
  if (detail) m.detail = String(detail).slice(0, 120);
  return m;
}

// ---------------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------------

// Control chars, zero-width & bidi controls, BOM.
const STRIP_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const hexEscape = (n) => '\\u' + n.toString(16).padStart(4, '0');
const STRIP_RE = new RegExp('[' + STRIP_RANGES.map(([a, b]) => (a === b ? hexEscape(a) : `${hexEscape(a)}-${hexEscape(b)}`)).join('') + ']', 'g');
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * Normalize a nickname: strip control/invisible characters and lone surrogates, collapse whitespace,
 * trim, cap at NAME_MAX_LEN code points. Returns null when nothing printable remains.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFC').replace(LONE_SURROGATE_RE, '').replace(/\s+/g, ' ').replace(STRIP_RE, '').replace(/ {2,}/g, ' ').trim();
  s = [...s].slice(0, NAME_MAX_LEN).join('').trim();
  return s.length > 0 ? s : null;
}

// ---------------------------------------------------------------------------------------------------
// Client addresses (per-network limits)
// ---------------------------------------------------------------------------------------------------

/**
 * Canonical textual IP: lowercase, zone id stripped, IPv4-mapped IPv6 (`::ffff:1.2.3.4`) → IPv4.
 * @param {unknown} raw
 * @returns {string} '' when not an IP address
 */
export function normalizeIp(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase();
  const withPort = /^\[([^\]]+)\](?::\d+)?$/.exec(s) || /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s); // [v6]:port, v4:port
  if (withPort) s = withPort[1];
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) s = mapped[1];
  if (isIP(s) === 6) {
    const g = ipv6Groups(s);
    if (g && g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) s = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  return isIP(s) ? s : '';
}

/** Expand an IPv6 address into 8 numeric groups (null when malformed). @param {string} ip */
function ipv6Groups(ip) {
  let s = ip;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const o = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...new Array(Math.max(0, fill)).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Loopback or private-network address (RFC 1918, link-local, CGNAT/Tailscale, IPv6 ULA / link-local).
 * @param {string} ip normalized
 */
export function isLocalIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0;
  }
  if (isIP(ip) === 6) {
    const g = ipv6Groups(ip);
    if (!g) return false;
    if (g.every((x, i) => (i < 7 ? x === 0 : x <= 1))) return true; // ::1 and ::
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80;
  }
  return false;
}

/**
 * The key per-network limits count against: the IPv4 address, or the /64 prefix of an IPv6 address
 * (one subscriber typically owns a whole /64).
 * @param {string} ip normalized
 */
export function limitKeyOf(ip) {
  if (isIP(ip) !== 6) return ip;
  const g = ipv6Groups(ip);
  return g ? `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64` : ip;
}

/** The client address a trusted local proxy forwards (null when it sent none). */
function forwardedAddress(headers) {
  if (!headers) return null;
  const one = (h) => (Array.isArray(h) ? h[h.length - 1] : h);
  for (const name of ['cf-connecting-ip', 'x-real-ip']) {
    const ip = normalizeIp(one(headers[name]));
    if (ip) return ip;
  }
  const xff = one(headers['x-forwarded-for']);
  if (typeof xff === 'string') {
    // The rightmost entry was appended by the proxy nearest to us; earlier ones are client-controlled.
    const parts = xff.split(',');
    const ip = normalizeIp(parts[parts.length - 1]);
    if (ip) return ip;
  }
  return null;
}

/**
 * Resolve an upgrade request's client address and its per-network limit key.
 * Forwarding headers are honoured from loopback/private peers ('auto'), always (true) or never (false).
 * Local/private peers without a forwarded address get `key: null` (never limited per network).
 * @param {import('node:http').IncomingMessage | undefined} req
 * @param {'auto' | boolean} [trustProxy]
 * @returns {{ ip: string, key: string | null }}
 */
export function clientAddress(req, trustProxy = NET_DEFAULTS.trustProxy) {
  const peer = normalizeIp(req?.socket?.remoteAddress);
  const local = !peer || isLocalIp(peer);
  if (trustProxy === true || (trustProxy !== false && local)) {
    const fwd = forwardedAddress(req?.headers);
    if (fwd) return { ip: fwd, key: isLocalIp(fwd) ? null : limitKeyOf(fwd) };
  }
  if (local) return { ip: peer || '?', key: null };
  return { ip: peer, key: limitKeyOf(peer) };
}

// ---------------------------------------------------------------------------------------------------
// Network: per-socket pipeline
// ---------------------------------------------------------------------------------------------------

/** Per-socket state. */
class Connection {
  /** @param {import('ws').WebSocket} ws @param {{ ip: string, key: string | null }} addr @param {number} now @param {typeof NET_DEFAULTS} opts */
  constructor(ws, addr, now, opts) {
    this.ws = ws;
    this.ip = addr.ip;
    /** @type {string | null} per-network limit key (see clientAddress) */
    this.key = addr.key;
    this.openedAt = now;
    this.alive = true;
    /** @type {Session | null} */
    this.session = null;
    this.bucket = new TokenBucket(opts.ratePerSec, opts.rateBurst, now);
    this.heavy = new TokenBucket(opts.heavyPerSec, opts.heavyBurst, now);
    this.dropWindowAt = now;
    this.drops = 0;
    /** true once the server initiated the close; frames still in flight are ignored */
    this.closing = false;
  }

  /** Server-initiated close (never throws). Later frames from this socket are ignored. */
  close(code, reason) {
    this.closing = true;
    try { this.ws.close(code, reason); } catch { /* ignore */ }
  }
}

/** Frames larger than this are not parsed just to echo a rid on a RATE error (CPU guard). */
const PEEK_RID_MAX_BYTES = 2048;

/** Owns every live socket; turns frames into validated messages for the handler. */
export class Network {
  /**
   * @param {{
   *   registry: SessionRegistry,
   *   handler: { onHello?: Function, onMessage: Function, onDisconnect?: Function, onExpire?: Function },
   *   log?: { info: Function, warn: Function, error: Function, debug?: Function },
   *   now?: () => number,
   *   options?: Partial<typeof NET_DEFAULTS>,
   * }} opts
   */
  constructor({ registry, handler, log = noopLog, now = Date.now, options = {} }) {
    this.registry = registry;
    this.handler = handler;
    this.log = log;
    this.now = now;
    this.opts = { ...NET_DEFAULTS, ...options };
    /** @type {Map<import('ws').WebSocket, Connection>} */
    this.conns = new Map();
    /** @type {Map<string, number>} open sockets per client network key */
    this.connsPerKey = new Map();
    this.closed = false;
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.opts.heartbeatMs);
    this.heartbeatTimer.unref?.();
    const sweepMs = Math.max(20, Math.min(15_000, Math.floor(this.opts.reconnectWindowMs / 4)));
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    this.sweepTimer.unref?.();
  }

  /** Number of open sockets. */
  get connectionCount() { return this.conns.size; }

  /**
   * Upgrade-time admission check (server/index.js): null to accept, otherwise the reason to refuse.
   * @param {import('node:http').IncomingMessage} req
   * @returns {null | 'shutdown' | 'full' | 'per-address'}
   */
  admission(req) {
    if (this.closed) return 'shutdown';
    if (this.conns.size >= this.opts.maxConnections) return 'full';
    const { key } = clientAddress(req, this.opts.trustProxy);
    const cap = this.opts.maxConnectionsPerAddr;
    if (key && cap > 0 && (this.connsPerKey.get(key) || 0) >= cap) return 'per-address';
    return null;
  }

  /**
   * Adopt a freshly upgraded socket.
   * @param {import('ws').WebSocket} ws
   * @param {import('node:http').IncomingMessage} [req]
   */
  handleConnection(ws, req) {
    if (this.closed) { try { ws.close(CLOSE.SHUTDOWN, 'server shutdown'); } catch { /* ignore */ } return; }
    const conn = new Connection(ws, clientAddress(req, this.opts.trustProxy), this.now(), this.opts);
    this.conns.set(ws, conn);
    if (conn.key) this.connsPerKey.set(conn.key, (this.connsPerKey.get(conn.key) || 0) + 1);
    ws.on('message', (data, isBinary) => {
      try { this.onFrame(conn, data, isBinary); } catch (e) { this.log.error('[net] frame handler crashed', e); }
    });
    ws.on('pong', () => { conn.alive = true; if (conn.session && conn.session.ws === ws) conn.session.lastSeen = this.now(); });
    ws.on('error', (e) => { this.log.debug?.('[net] socket error', e?.code || e?.message); });
    ws.on('close', () => { try { this.onClose(conn); } catch (e) { this.log.error('[net] close handler crashed', e); } });
  }

  /** @param {Connection} conn @param {object} msg */
  reply(conn, msg) { return send(conn.ws, msg); }

  /** @param {Connection} conn */
  onFrame(conn, data, isBinary) {
    // A socket we are closing (replaced by another tab, hello timeout, flooding, shutdown) may still have
    // frames in flight; acting on them could e.g. mint an orphan session from a late `hello`.
    if (conn.closing || this.closed) return;
    const now = this.now();
    conn.alive = true;
    if (conn.session && conn.session.ws === conn.ws) conn.session.lastSeen = now;

    if (!conn.bucket.take(now)) {
      if (now - conn.dropWindowAt >= 1000) { conn.dropWindowAt = now; conn.drops = 0; }
      if (++conn.drops > this.opts.abuseDropsPerSec) {
        this.log.warn(`[net] closing flooding socket ${conn.ip}`);
        conn.close(CLOSE.POLICY, 'rate limit');
        return;
      }
      this.reply(conn, errorMsg(ERR.RATE, peekRid(data, isBinary)));
      return;
    }

    if (isBinary) { this.reply(conn, errorMsg(ERR.BAD_MSG, undefined, 'binary frame')); return; }
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { this.reply(conn, errorMsg(ERR.BAD_MSG, undefined, 'invalid json')); return; }
    const rid = msg && typeof msg === 'object' ? msg.rid : undefined;
    // Own-property check first: validateC2S alone would accept inherited keys like "constructor".
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string' || !Object.hasOwn(C2S, msg.t)) {
      const t = msg && typeof msg === 'object' ? String(msg.t).slice(0, 32) : typeof msg;
      this.reply(conn, errorMsg(ERR.BAD_MSG, rid, `unknown type ${t}`));
      return;
    }
    const reason = validateC2S(msg);
    if (reason) { this.reply(conn, errorMsg(ERR.BAD_MSG, rid, reason)); return; }

    if (msg.t === 'ping') {
      const pong = { t: 'pong', c: msg.c, s: now };
      if (validRid(rid)) pong.rid = rid;
      this.reply(conn, pong);
      return;
    }
    if (msg.t === 'hello') { this.onHelloMsg(conn, msg, now); return; }
    if (!conn.session) { this.reply(conn, errorMsg(ERR.BAD_MSG, rid, 'hello required')); return; }
    if (HEAVY_TYPES.has(msg.t) && !conn.heavy.take(now)) { this.reply(conn, errorMsg(ERR.RATE, rid, `${msg.t} too often`)); return; }

    let res;
    try {
      // client-side combat reports (b.progress / b.result, DESIGN §14) belong to the running match like 'g.*' intents:
      // handed to the lobby's match router when the handler has one (server/lobby.js routeGame)
      if (msg.t.startsWith('b.') && typeof this.handler.routeGame === 'function') res = this.handler.routeGame(conn.session, msg);
      else res = this.handler.onMessage(conn.session, msg);
    } catch (e) {
      this.log.error(`[net] handler crashed on ${msg.t}`, e);
      res = { error: ERR.INTERNAL };
    }
    if (res && res.error) {
      // fire-and-forget battle progress (no rid) that reached no running match — the match just ended, the room went
      // back to the lobby — is stale, not a client mistake: never answered (DESIGN §14; a rid-less error frame would
      // surface as an error toast in the browser)
      if (msg.t === 'b.progress' && !validRid(rid)) return;
      this.reply(conn, errorMsg(isErrCode(res.error) ? res.error : ERR.INTERNAL, rid, res.detail));
    } else if (validRid(rid)) this.reply(conn, { t: 'ok', rid });
  }

  /** @param {Connection} conn @param {any} msg @param {number} now */
  onHelloMsg(conn, msg, now) {
    const rid = msg.rid;
    if (msg.version != null && msg.version !== PROTOCOL_VERSION) {
      this.reply(conn, errorMsg(ERR.BAD_MSG, rid, `version mismatch: server ${PROTOCOL_VERSION}`));
      return;
    }
    const name = sanitizeName(msg.name);
    if (!name) { this.reply(conn, errorMsg(ERR.BAD_MSG, rid, 'bad field name')); return; }

    let session = conn.session;
    let resumed = false;
    const repeat = !!session;
    if (!session) {
      session = msg.token ? this.registry.byToken(msg.token) : null;
      if (session) {
        resumed = true;
        if (session.ws && session.ws !== conn.ws) this.detachReplaced(session.ws);
      } else {
        session = this.registry.create(name);
        if (!session) { this.reply(conn, errorMsg(ERR.INTERNAL, rid, 'server full')); return; }
      }
      conn.session = session;
      session.ws = conn.ws;
      session.connected = true;
      session.disconnectedAt = null;
    }
    session.name = name;
    session.lastSeen = now;
    session.addr = conn.ip;
    session.limitKey = conn.key;

    const welcome = { t: 'welcome', playerId: session.playerId, token: session.token, name: session.name, serverNow: now, version: PROTOCOL_VERSION, resumed };
    if (validRid(rid)) welcome.rid = rid;
    this.reply(conn, welcome);
    try {
      this.handler.onHello?.(session, { resumed, repeat });
    } catch (e) {
      this.log.error('[net] onHello crashed', e);
    }
  }

  /** The session moved to a new socket: unbind and close the old one without firing a disconnect. */
  detachReplaced(oldWs) {
    const old = this.conns.get(oldWs);
    if (old) {
      old.session = null;
      old.close(CLOSE.REPLACED, 'session replaced');
    } else {
      try { oldWs.close(CLOSE.REPLACED, 'session replaced'); } catch { /* ignore */ }
    }
  }

  /** @param {Connection} conn */
  onClose(conn) {
    if (this.conns.delete(conn.ws) && conn.key) {
      const n = (this.connsPerKey.get(conn.key) || 1) - 1;
      if (n > 0) this.connsPerKey.set(conn.key, n);
      else this.connsPerKey.delete(conn.key);
    }
    const s = conn.session;
    conn.session = null;
    if (!s || s.ws !== conn.ws) return;
    s.ws = null;
    s.connected = false;
    s.disconnectedAt = this.now();
    if (this.closed) return;
    try { this.handler.onDisconnect?.(s); } catch (e) { this.log.error('[net] onDisconnect crashed', e); }
  }

  /** Ping every socket; terminate the ones that did not answer since the previous heartbeat. */
  heartbeat() {
    const now = this.now();
    for (const conn of this.conns.values()) {
      try {
        if (conn.closing) {
          // Closing handshake never completed within a heartbeat interval → drop the TCP connection.
          if (!conn.alive) conn.ws.terminate();
          conn.alive = false;
          continue;
        }
        if (!conn.session && now - conn.openedAt > this.opts.helloTimeoutMs) {
          conn.close(CLOSE.HELLO_TIMEOUT, 'hello timeout');
          continue;
        }
        if (!conn.alive) { conn.ws.terminate(); continue; }
        conn.alive = false;
        conn.ws.ping();
      } catch (e) {
        this.log.debug?.('[net] heartbeat error', e?.message);
      }
    }
  }

  /** Purge expired sessions and tell the handler. */
  sweep() {
    let expired;
    try { expired = this.registry.sweep(this.now()); } catch (e) { this.log.error('[net] sweep crashed', e); return; }
    for (const s of expired) {
      try { this.handler.onExpire?.(s); } catch (e) { this.log.error('[net] onExpire crashed', e); }
    }
  }

  /**
   * Stop timers and close every socket (graceful: close frame, then terminate after 1 s).
   * @param {number} [code] @param {string} [reason]
   */
  close(code = CLOSE.SHUTDOWN, reason = 'server shutdown') {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    clearInterval(this.sweepTimer);
    for (const conn of this.conns.values()) {
      conn.close(code, reason);
      const t = setTimeout(() => { try { conn.ws.terminate(); } catch { /* ignore */ } }, 1000);
      t.unref?.();
    }
  }
}

/** Best-effort rid extraction for rate-limited frames (so the client's pending request resolves). */
function peekRid(data, isBinary) {
  if (isBinary || !data || data.length > PEEK_RID_MAX_BYTES) return undefined;
  try {
    const m = JSON.parse(data.toString('utf8'));
    return m && typeof m === 'object' ? m.rid : undefined;
  } catch {
    return undefined;
  }
}
