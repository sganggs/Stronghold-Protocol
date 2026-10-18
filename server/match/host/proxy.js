// server/match/host/proxy.js — the lobby's side of a match that runs in a match host (DESIGN §32.6, P1c; the
// design study's §6.4 方案 B): a MatchProxy is what server/lobby.js holds as `room.match` for a room with gameplay plugins.
// It implements the MATCH INTERFACE of server/match/Match.js towards the lobby and forwards everything to the worker
// (server/match/host/entry.js), which runs the real Match on the room's content set:
//
//   start()                                  the worker creates the match and starts it (the worker may still be booting:
//                                            the host queues the messages; the match exists for the lobby at once)
//   handle / setLoadout / requestSetupReroll / cancelSetupReroll → Promise of the match's answer ({ ok } | { error, detail })
//                                            — the lobby answers the request when it settles (server/net.js)
//   onDisconnect / onReconnect / onLeave / addSpectator / removeSpectator → posted, no answer
//   dispose()                                posted; nothing of this match reaches the lobby afterwards
//   diag()                                   → Promise of the match's diagnostics (verifyStats, errors, fields — tests,
//                                            /healthz never)
// The worker's messages drive the lobby's callbacks in the order they arrive: `send` (opts.send), `broadcast`
// (opts.broadcast), `end` (opts.onEnd, once), `reply` (a pending request). One message queue per match: the worker
// handles them in the order they were posted (a MessagePort keeps the order), so a player's g.buy is always handled
// before the g.sell that follows it.
// When the worker stops — it crashed, ran out of memory, or the watchdog terminated it after its heartbeats stopped
// (server/match/host/index.js) — or the match could not be created there, every pending request is answered INTERNAL,
// the room's members are told (an m.toast, a message id) and onEnd({ reason, detail }) returns the room to its lobby
// (`reason`: 'plugin-crash' | 'plugin-hang' | 'plugin-start'). A request the worker leaves unanswered for
// REQUEST_TIMEOUT_MS is answered INTERNAL too (a living worker never takes that long: the watchdog acts first).

import { ERR } from '../../../shared/constants.js';
import { msg, wireMessage } from '../../../shared/i18n.js';
import { validHostMessage } from './ipc.js';

/** A request the worker has not answered after this long is answered INTERNAL. [ASSUMED] */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * What the room is told when its match ends because of its plugins (a message id, shared/i18n.js msg).
 * @param {string} reason 'plugin-crash' | 'plugin-hang' | 'plugin-start'
 */
export function crashMessage(reason) {
  if (reason === 'plugin-hang') return msg('房间的插件内容长时间无响应，本局模拟已结束');
  if (reason === 'plugin-start') return msg('房间的插件内容无法启动模拟');
  return msg('房间的插件内容出错，本局模拟已结束');
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** The lobby options a worker can take (JSON-safe: no callbacks, no data, no class). */
export function wireOptions(opts) {
  const out = {};
  for (const k of ['roomCode', 'mode', 'difficulty', 'modeId', 'aiPicksLast', 'seats', 'spectators', 'seed', 'matchNo', 'cs', 'vs', 'requireCs', 'kitted']) {
    if (opts[k] !== undefined) out[k] = opts[k];
  }
  // A test room must arrive as a test match. Forwarding these only when the flag is set keeps every other
  // worker payload identical. Dropping the flag fails closed: the worker match refuses g.test.
  if (opts.test === true) {
    out.test = true;
    if (typeof opts.hostId === 'string') out.hostId = opts.hostId;
  }
  // Rule switches ride with the content set. A room that declares none keeps today's worker payload.
  if (opts.rules && typeof opts.rules === 'object' && !Array.isArray(opts.rules)) out.rules = opts.rules;
  return out;
}

export class MatchProxy {
  /**
   * @param {{ host: { post: (m: object) => void }, matchId: string, opts: any, log?: object, requestTimeoutMs?: number }} o
   *   host: the worker host (index.js) it posts through; opts: the lobby's Match options (send / broadcast / onEnd used here)
   */
  constructor({ host, matchId, opts, log = noopLog, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
    /** a match in a match host: its answers are Promises, its room's messages go through the room's queue (lobby.js) */
    this.hosted = true;
    this.host = host;
    this.matchId = matchId;
    this.opts = opts;
    this.log = log;
    this.requestTimeoutMs = requestTimeoutMs;
    this.roomCode = opts.roomCode ?? '----';
    /** @type {Map<number, { resolve: (r: any) => void, timer: any }>} */
    this.pending = new Map();
    this.seq = 0;
    this.started = false;
    this.ended = false;
    this.disposed = false;
    /** the host no longer routes this match's messages (dispose with nothing pending, or the worker stopped) */
    this.forgotten = false;
  }

  /** Post one message of this match to the worker (never throws). */
  _post(m) {
    try { this.host.post({ ...m, matchId: this.matchId }); } catch (e) { this.log.error?.(`[match ${this.roomCode}] host post failed`, e); }
  }

  /**
   * A request: the match's answer, or INTERNAL when the worker is gone or silent. `afterEnd`: also once the match ended
   * (diag — the match stays in the worker until the lobby disposes it).
   * @returns {Promise<any>}
   */
  _request(method, args, afterEnd = false) {
    if (this.disposed || (this.ended && !afterEnd) || this.forgotten) return Promise.resolve({ error: ERR.WRONG_PHASE, detail: 'no running match' });
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.log.warn?.(`[match ${this.roomCode}] the match host did not answer ${method} in ${this.requestTimeoutMs} ms`);
        resolve({ error: ERR.INTERNAL, detail: 'the match host did not answer' });
        this._forgetIfDone();
      }, this.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, timer });
      this._post({ type: 'call', id, method, args });
    });
  }

  _notify(method, args) {
    if (this.disposed || this.ended) return;
    this._post({ type: 'call', method, args });
  }

  start() {
    if (this.started) return;
    this.started = true;
    this._post({ type: 'create', opts: wireOptions(this.opts) });
  }

  handle(playerId, msg) { return this._request('handle', [playerId, msg]); }
  setLoadout(playerId, loadout, ops) { return this._request('setLoadout', [playerId, loadout, ops]); }
  requestSetupReroll(playerId, revision) { return this._request('requestSetupReroll', [playerId, revision]); }
  cancelSetupReroll(playerId, voteId) { return this._request('cancelSetupReroll', [playerId, voteId]); }
  onDisconnect(playerId) { this._notify('onDisconnect', [playerId]); }
  onReconnect(playerId) { this._notify('onReconnect', [playerId]); }
  onLeave(playerId) { this._notify('onLeave', [playerId]); }
  /**
   * Host migration. A normal plugin match never posted setHost (the proxy had no such method, so lobby
   * callMatch no-op'd). Only a test match follows the new host, because g.test checks hostId in the worker.
   */
  setHost(playerId) {
    if (this.opts.test !== true) return;
    this.opts.hostId = typeof playerId === 'string' ? playerId : null;
    this._notify('setHost', [playerId]);
  }
  addSpectator(playerId) { this._notify('addSpectator', [playerId]); }
  removeSpectator(playerId) { this._notify('removeSpectator', [playerId]); }
  /** The match's diagnostics in the worker (tests). @returns {Promise<any>} */
  diag() { return this.disposed ? Promise.resolve(null) : this._request('diag', [], true); }

  /**
   * The lobby is done with the match. The worker still answers what was asked before (its port keeps the order: those
   * answers come before it handles the dispose), so the host forgets this match only once nothing is pending.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._post({ type: 'dispose' });
    this._forgetIfDone();
  }

  /** Disposed and nothing pending: the host stops routing this match's messages (it may stop the idle worker). */
  _forgetIfDone() {
    if (this.disposed && this.pending.size === 0 && !this.forgotten) { this.forgotten = true; this.host.forget?.(this.matchId); }
  }

  /** Answer every pending request with `result`. */
  _settle(result) {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); this.pending.delete(id); p.resolve(result); }
    this._forgetIfDone();
  }

  /**
   * A message of the worker for this match (index.js routes them by matchId).
   * @param {any} m
   */
  deliver(m) {
    if (!validHostMessage(m) || m.matchId !== this.matchId) return;
    if (m.type === 'reply') {
      // answered after the end, even after the dispose: the request was asked while the match ran (see dispose)
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.resolve(m.result ?? { ok: true });
      this._forgetIfDone();
      return;
    }
    if (this.disposed) return;
    if (m.type === 'send') { try { this.opts.send(m.playerId, m.msg); } catch (e) { this.log.error?.(`[match ${this.roomCode}] send failed`, e); } return; }
    if (m.type === 'broadcast') { try { this.opts.broadcast(m.msg); } catch (e) { this.log.error?.(`[match ${this.roomCode}] broadcast failed`, e); } return; }
    if (m.type === 'end') { this._end(m.summary ?? null); return; }
    if (m.type === 'failed') { this.crash('plugin-start', m.error); }
  }

  /**
   * The match is over: the lobby's onEnd. A request still pending keeps waiting for its answer — the match may end inside
   * the very call that asked (the last g.infoReady of a stub, a g.leave): the worker posts 'end', then that call's reply.
   */
  _end(summary) {
    if (this.ended) return;
    this.ended = true;
    try { this.opts.onEnd(summary); } catch (e) { this.log.error?.(`[match ${this.roomCode}] onEnd failed`, e); }
  }

  /** The worker was stopped without a fault (the server stops): pending requests answered, the match over, nobody told. */
  halt() {
    this._settle({ error: ERR.INTERNAL, detail: 'the match host stopped' });
    if (!this.ended && !this.disposed) this._end({ reason: 'host-stopped', cs: this.opts.cs ?? null });
    this.forgotten = true;
  }

  /**
   * The worker stopped (or could not create the match): pending requests answered, the room told, the match over.
   * @param {'plugin-crash' | 'plugin-hang' | 'plugin-start'} reason @param {string} [detail]
   */
  crash(reason, detail = '') {
    this.forgotten = true; // the worker is gone: nothing more to route (the host already dropped its matches)
    if (this.ended || this.disposed) { this._settle({ error: ERR.INTERNAL, detail: 'the match host stopped' }); return; }
    this._settle({ error: ERR.INTERNAL, detail: 'the match host stopped' });
    try { this.opts.broadcast({ t: 'm.toast', kind: 'error', ...wireMessage(crashMessage(reason)) }); } catch { /* the room may be gone */ }
    this._end({ reason, detail: String(detail || '').slice(0, 300), cs: this.opts.cs ?? null });
  }
}
