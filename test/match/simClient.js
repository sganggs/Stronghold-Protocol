// test/match/simClient.js — a scripted "browser" under client-side combat (DESIGN §14) for Match tests: it answers
// b.start (authoritative) by simulating the spec with the shared sim (server/sim/spec.js createBattleFromSpec), reports
// b.progress / b.result through `send` (every frame passes shared/protocol.js validateC2S, like the platform), syncs
// its boss pool with b.pool and obeys b.end. Timers come from the injected scheduler (the harness' VirtualScheduler, or
// real timers for websocket clients), never synchronous with the server call that delivered the frame.
//
//   const c = new SimClient('p_0', { send, setTimeout, clearTimeout, ds, BattleClass, pace: 'instant' | 'paced', speed })
//   c.onMessage(frame)
//
// pace 'instant' simulates normal / 联防 fields to the end in one timer callback (boss fields are always paced: they
// share the pool with other fields); 'paced' steps every field at `speed` game-s per real second in 250 ms slices.
// Test knobs: `tamper(result, spec) → result` edits the outgoing result, `mute: true` never reports, `stall: true`
// reports progress but no result, `delayMs` delays the first slice. `log` keeps every sent frame; `battles` every
// local battle by battleId.

import assert from 'node:assert/strict';
import { createBattleFromSpec, compactResult, battleProgress, attachLpMeter } from '../../server/sim/spec.js';
import { validateC2S } from '../../shared/protocol.js';
import { TICK } from '../../server/sim/constants.js';

const SLICE_MS = 250;

export class SimClient {
  constructor(playerId, o) {
    this.playerId = playerId;
    this.o = { pace: 'instant', speed: 2, ...o };
    this.log = [];
    /** @type {Map<string, { battle: any, spec: any, authoritative: boolean, meter: any, timer: any, finished: boolean, sentResult: boolean }>} */
    this.battles = new Map();
    this.starts = [];
    this.ends = [];
    this.pools = [];
  }

  send(msg) {
    const bad = validateC2S(msg);
    assert.equal(bad, null, `${this.playerId} would send an invalid ${msg.t}: ${bad}`);
    this.log.push(msg);
    this.o.send(msg);
  }

  /** Stop every timer (the page closed). */
  close() {
    this.closed = true;
    for (const e of this.battles.values()) if (e.timer) { this.o.clearTimeout(e.timer); e.timer = null; }
  }

  onMessage(msg) {
    if (!msg || typeof msg !== 'object' || this.closed) return;
    if (msg.t === 'b.start') this._start(msg);
    else if (msg.t === 'b.pool') this._pool(msg);
    else if (msg.t === 'b.end') this._end(msg);
  }

  _start(msg) {
    this.starts.push(msg);
    const cur = this.battles.get(msg.battleId);
    if (cur) { // resend (reconnect / watch back / authority handover): keep the running battle
      const was = cur.authoritative;
      cur.authoritative = !!msg.authoritative;
      if (cur.authoritative && !was) {
        // a replica promoted to authority (handover): it ran live in a browser — catch up to the field's clock
        this._stepTo(cur, Number(msg.elapsed) || 0);
        this._schedule(cur, 0);
      }
      return;
    }
    const entry = { spec: msg.spec, battleId: msg.battleId, fieldId: msg.fieldId, authoritative: !!msg.authoritative, finished: false, sentResult: false, timer: null, lastProgress: -Infinity };
    entry.battle = createBattleFromSpec(msg.spec, this.o.ds, { BattleClass: this.o.BattleClass, recordEvents: false, quiet: true });
    entry.meter = attachLpMeter(entry.battle);
    this.battles.set(msg.battleId, entry);
    // catch up to the field's clock (reconnect / observing a running field)
    const target = Number(msg.elapsed) || 0;
    if (target > 0) this._stepTo(entry, target);
    if (entry.authoritative) this._schedule(entry, this.o.delayMs || 0);
  }

  _pool(msg) {
    this.pools.push(msg);
    for (const e of this.battles.values()) {
      const pool = e.battle.sharedBoss;
      if (pool && typeof pool.sync === 'function') pool.sync(msg.hp, msg.acked ? msg.acked[e.fieldId] : undefined);
    }
  }

  _end(msg) {
    this.ends.push(msg);
    const e = this.battles.get(msg.battleId);
    if (!e) return;
    if (msg.reason === 'takeover') { e.authoritative = false; if (e.timer) this.o.clearTimeout(e.timer); e.timer = null; return; }
    try { e.battle.forceEnd(msg.reason === 'timeout' ? 'timeout' : 'forced'); } catch { /* ignore */ }
    if (e.authoritative) this._schedule(e, 0);
  }

  _stepTo(e, gt) {
    const b = e.battle;
    const cap = Math.ceil(gt / TICK);
    while (!b.finished && (b.tickCount ?? Math.round(b.time / TICK)) < cap) b.step();
  }

  _schedule(e, ms) {
    if (e.timer) this.o.clearTimeout(e.timer);
    e.timer = this.o.setTimeout(() => { e.timer = null; this._slice(e); }, ms);
  }

  _slice(e) {
    if (this.closed || !e.authoritative || e.sentResult || this.o.mute) return;
    const b = e.battle;
    const bossLike = e.spec.kind === 'boss' || e.spec.kind === 'hidden';
    if (this.o.pace === 'instant' && !bossLike) {
      let n = 0;
      while (!b.finished && n++ < 200_000) b.step();
    } else {
      const ticks = Math.max(1, Math.round(((this.o.speed || 2) * SLICE_MS) / 1000 / TICK));
      for (let i = 0; i < ticks && !b.finished; i++) b.step();
    }
    this._progress(e);
    if (b.finished) {
      if (this.o.stall) return;
      let result = compactResult(b.result());
      if (this.o.tamper) result = this.o.tamper(result, e.spec);
      e.sentResult = true;
      this.send({ t: 'b.result', battleId: e.battleId, result });
      return;
    }
    this._schedule(e, SLICE_MS);
  }

  _progress(e) {
    const p = battleProgress(e.battle);
    const msg = { t: 'b.progress', battleId: e.battleId, gt: p.gt, killed: Math.min(p.killed, p.total), total: p.total, done: p.done };
    // the HUD capsule's numerator, like public/js/battle/runner.js (kept only when the battle reports one)
    if (Number.isFinite(p.resolved)) msg.resolved = Math.min(p.resolved, p.total);
    const bossLike = e.spec.kind === 'boss' || e.spec.kind === 'hidden';
    if (bossLike) {
      const pool = e.battle.sharedBoss;
      msg.leaks = e.meter.lp;
      msg.bossDmg = pool && Number.isFinite(pool.cum) ? pool.cum : 0;
      if (pool && pool.byPlayer) msg.by = { ...pool.byPlayer };
    } else {
      msg.leaks = p.leaks;
      // 联防: the leakers' enemies still standing (like public/js/battle/runner.js)
      if (p.left) msg.left = Object.fromEntries(Object.entries(p.left).slice(0, 4));
    }
    this.send(msg);
  }
}

/**
 * Attach SimClients to a harness match (test/match/harness.js makeMatch): every human gets one; frames sent to a
 * disconnected / departed human are dropped (like the platform). Returns Map playerId → SimClient.
 */
export function attachSimClients(h, opts = {}) {
  const clients = new Map();
  const m = h.m;
  for (const ps of m.players.values()) {
    if (ps.isBot) continue;
    const c = new SimClient(ps.playerId, {
      send: (msg) => { const r = m.handle(ps.playerId, msg); if (r && r.error && opts.onError) opts.onError(ps.playerId, msg, r); },
      setTimeout: (fn, ms) => h.sched.setTimeout(fn, ms),
      clearTimeout: (t) => h.sched.clearTimeout(t),
      ds: m.ds,
      BattleClass: opts.BattleClass,
      speed: m.gameSpeed,
      ...(opts.perPlayer && opts.perPlayer[ps.playerId] ? opts.perPlayer[ps.playerId] : {}),
      pace: (opts.perPlayer && opts.perPlayer[ps.playerId] && opts.perPlayer[ps.playerId].pace) || opts.pace || 'instant',
    });
    clients.set(ps.playerId, c);
  }
  const HANDLED = new Set(['b.start', 'b.pool', 'b.end']);
  const pending = new Set();
  const deliver = (c, ps, msg) => {
    // delivered after the server call that produced it (a real socket is never re-entrant)
    const t = h.sched.setTimeout(() => { pending.delete(t); if (ps.connected && !ps.left) c.onMessage(msg); }, 0);
    pending.add(t);
  };
  h.onSend.push((pid, msg) => {
    const c = clients.get(pid);
    const ps = m.players.get(pid);
    if (!c || !ps || !ps.connected || ps.left || !HANDLED.has(msg.t)) return;
    deliver(c, ps, msg);
  });
  h.onBroadcast.push((msg) => {
    if (!HANDLED.has(msg.t)) return;
    for (const [pid, c] of clients) {
      const ps = m.players.get(pid);
      if (!ps || !ps.connected || ps.left) continue;
      deliver(c, ps, msg);
    }
  });
  /** Close every client (pending deliveries and battle timers are dropped). */
  clients.closeAll = () => {
    for (const t of pending) h.sched.clearTimeout(t);
    pending.clear();
    for (const c of clients.values()) c.close();
  };
  return clients;
}

/**
 * A SimClient behind a websocket test client (test/helpers/wsClient.js TestClient): frames are read from the socket,
 * reports go out without a rid (fire-and-forget, like the browser runner). Real timers.
 * @returns {SimClient}
 */
export function attachWsSimClient(tc, opts = {}) {
  const sc = new SimClient(tc.id, {
    send: (msg) => { if (tc.isOpen) tc.send({ ...msg, rid: null }); },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    ...opts,
  });
  tc.ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    try { sc.onMessage(msg); } catch (e) { sc.error = e; }
  });
  return sc;
}
