// server/match/match/infra.js — Match methods: infrastructure — error isolation (guard, reportError), timers tracked
// for dispose (later, cancel, scaled) and the phase deadline (setDeadline), soloUntimed, uids, the player lists
// (alivePlayers, humans), the bonds this match's pool holds (bondInPool, bondLive), a player's boss-round group, deploy
// field and deploy map, and the guarded meta dispatch (dispatch, dispatchItem → effectsMeta.js EffectDispatcher).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { buildDeployMap, fieldTile, parseKey, boardTileOf } from '../board.js';

export class MatchInfra {
  /** Run a callback with error isolation, then flush the views. */
  guard(fn) {
    if (this.disposed) return;
    try { fn(); } catch (e) { this.reportError('guard', e); }
    try { this.flush(); } catch (e) { this.reportError('flush', e); }
  }

  reportError(label, e) {
    this.errorCount++;
    const msg = `${label}: ${e && e.message ? e.message : e}`;
    if (this.errors.length < 50) this.errors.push({ label, message: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack).split('\n').slice(0, 6).join('\n') : null });
    this.log.error?.(`[match ${this.roomCode}] ${msg}`, e && e.stack ? String(e.stack).split('\n').slice(1, 4).join(' | ') : '');
  }

  /** Schedule a guarded callback (tracked for dispose). */
  later(ms, fn) {
    if (this.disposed) return null;
    let h = null;
    h = this.sched.setTimeout(() => {
      this._timers.delete(h);
      if (this.disposed) return;
      this.guard(fn);
    }, ms);
    if (h) this._timers.add(h);
    return h;
  }

  cancel(h) {
    if (!h) return;
    this.sched.clearTimeout(h);
    this._timers.delete(h);
  }

  scaled(ms) { return Math.max(0, Math.round(ms * this.timerScale)); }

  /**
   * Set the phase deadline (seconds; null/0 ⇒ untimed) and its timeout callback. `silent`: the timer runs but no
   * deadline is published (m.public.deadline 0 ⇒ no countdown) — the fixed presentation steps of a solo match.
   */
  setDeadline(seconds, fn, { silent = false } = {}) {
    this.cancel(this._phaseTimer);
    this._phaseTimer = null;
    if (!(seconds > 0) || typeof fn !== 'function') { this.deadline = 0; return; }
    const ms = this.scaled(seconds * 1000);
    this.deadline = silent ? 0 : this.sched.now() + ms;
    this._phaseTimer = this.later(ms, () => { this._phaseTimer = null; fn(); });
  }

  /**
   * Solo timers (research 01 §843 / 06 §3: 下半 独立模拟 has no time limit on 休整期 / 机变 — "休整期及机变阶段没有时间
   * 限制"; the strategy draft is free too): a solo match publishes a deadline ONLY for its battles. INFO_CHECK waits
   * for 准备就绪 (co-op keeps the official 25 s guard), BAND_DRAFT / SP_DRAFT / PREP are untimed, and the fixed
   * presentation steps (BATTLE_CHECK, ROUND_START, SETTLE) run silently (no countdown). The same holds for any match
   * with a single human (loneHuman: a 同盟 room started alone or with AI teammates only — user playtest #4 item 3):
   * the timers only ever made humans wait on each other; AI seats act at once.
   */
  get soloUntimed() { return this.isSolo || this.loneHuman; }

  nextUid() { return ++this.uidSeq; }

  alivePlayers() { return this.order.filter((p) => p.alive); }

  /** Whether any chess of a bond is in this match's pool (a 驰援 card of a fully banned bond is never offered). */
  bondInPool(bondId) {
    for (const id of this.pool.entries.keys()) {
      const c = this.gd.chess(id);
      if (c && Array.isArray(c.bonds) && c.bonds.includes(bondId)) return true;
    }
    return false;
  }

  /**
   * Whether a bond can matter in this match: not in the mode's static inactive list (标准: 拉特兰 / 阿戈尔 / 卡西米尔 /
   * 奥术 … never activate, research 02 §2.1) and still with chess in the pool. 机变 tactic cards whose every target bond
   * is dead are not offered (choices.js).
   */
  bondLive(bondId) {
    return !this.gd.modeInactiveBonds.has(bondId) && this.bondInPool(bondId);
  }
  humans() { return this.order.filter((p) => !p.isBot && !p.left); }

  /** [ASSUMED] Touch's initial, match-long team grant survives its holder's elimination/quit; focus alone grants none. */
  teamMedicGranted() { return this.order.some(p => p.bandId === 'band_amedic'); }

  /**
   * The boss-round group of a player (`bossWaves`: the per-match random pairs, planned in startRound
   * before the players' round start) and its side — 'L', or 'R' for the second player of a pair (the mirrored right
   * half) — or null outside a boss round / for a player without a field.
   * @returns {{ wave: object, players: string[], side: 'L'|'R' } | null}
   */
  bossGroupOf(ps) {
    if (!ps || !Array.isArray(this.bossWaves)) return null;
    const g = this.bossWaves.find((x) => Array.isArray(x.players) && x.players.includes(ps.playerId));
    return g ? { wave: g.wave, players: g.players, side: g.players.indexOf(ps.playerId) === 1 ? 'R' : 'L' } : null;
  }

  /**
   * The field a player deploys on (server/match/board.js DEPLOY_FIELDS): in a boss round (最终攻势 / 隐秘核心, from its
   * ROUND_START on — the pairing exists before PlayerState.startRound's recompute) the player's half of the boss field,
   * 'bossL' or 'bossR' (bossGroupOf); otherwise its own normal board. User playtest #5 item 7.
   * @returns {'normal'|'bossL'|'bossR'}
   */
  deployFieldOf(ps) {
    const g = this.bossGroupOf(ps);
    return !g ? 'normal' : g.side === 'R' ? 'bossR' : 'bossL';
  }

  /**
   * A fresh deploy map of a player on `field` (default: the field it deploys on now) under its device / tile overrides.
   * Pure — no PlayerState cache is touched (the read-only checker invariants.js uses it; PlayerState.deployMap caches).
   */
  deployMapFor(ps, field = this.deployFieldOf(ps)) {
    return buildDeployMap(this.stage, { deviceOverrides: ps.deviceOverrides, tileOverrides: ps.tileOverrides, field });
  }


  /** Board tiles of `ps` that its boss-round partner occupies in shared field coordinates. */
  bossMateOccupiedTiles(ps) {
    const g = this.bossGroupOf(ps);
    if (!g || g.players.length !== 2) return new Set();
    const mateId = g.players.find((id) => id !== ps.playerId);
    const mate = mateId ? this.players.get(mateId) : null;
    if (!mate || !mate.alive) return new Set();
    const mine = this.deployFieldOf(ps);
    const theirs = this.deployFieldOf(mate);
    const out = new Set();
    for (const key of mate.board.keys()) {
      const [r, c] = parseKey(key);
      const [fr, fc] = fieldTile(theirs, r, c);
      const [mr, mc] = boardTileOf(mine, fr, fc);
      out.add(`${mr},${mc}`);
    }
    return out;
  }

  /** True when the board tile maps to a tile held by this boss-round partner. */
  bossMateOccupies(ps, row, col) {
    return this.bossMateOccupiedTiles(ps).has(`${row},${col}`);
  }

  /** All board tiles of `ps` that overlap a partner on the shared boss field. */
  bossMateOverlaps(ps) {
    const occupied = this.bossMateOccupiedTiles(ps);
    return [...ps.board.keys()].filter((key) => occupied.has(key));
  }

  /** At the prep deadline, move a legacy shared-centre overlap to a free legal tile instead of dropping it in battle. */
  separateBossMateOverlaps() {
    let moved = 0;
    for (const g of this.bossWaves || []) {
      if (!Array.isArray(g?.players) || g.players.length !== 2) continue;
      const ps = this.players.get(g.players[1]); // preserve the left player's existing layout on a tie
      if (!ps || !ps.alive) continue;
      for (const source of this.bossMateOverlaps(ps)) {
        const piece = ps.board.get(source);
        if (!piece) continue;
        let placed = false;
        for (const target of ps.deployMap().keys()) {
          if (ps.board.has(target)) continue;
          const [row, col] = parseKey(target);
          if (this.bossMateOccupies(ps, row, col)) continue;
          const result = ps.move(piece.uid, { area: 'board', row, col });
          if (!result.ok) continue;
          moved += 1;
          placed = true;
          break;
        }
        if (!placed) break;
      }
    }
    return moved;
  }
  dispatch(ps, hook, ev = {}, opts = {}) {
    try { return this.dispatcher.dispatch(ps, hook, ev, opts); } catch (e) { this.reportError(`dispatch ${hook}`, e); return ev; }
  }

  dispatchItem(ps, item, holder, hook, ev) {
    try { return this.dispatcher.dispatchItem(ps, item, holder, hook, ev); } catch (e) { this.reportError(`dispatchItem ${hook}`, e); return ev; }
  }
}
