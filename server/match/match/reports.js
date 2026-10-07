// server/match/match/reports.js — Match methods: the battle reports of client-side combat (DESIGN §14) — b.progress
// (field progress, boss credits, the 联防 counts) and b.result (validated against the spec; an implausible one is
// replaced by the server's run; a boss field's 'cleared' result may wait for the budget, `heldResult`), SP_VERIFY
// re-simulation.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { ERR } from '../../../shared/constants.js';
import { runHeadless, syntheticResult, validateClientResult, HARD_CAP_SECONDS } from '../fields.js';
import { resultDigest, compactResult as compactForVerify } from '../../sim/spec.js';
import { OK, fail } from './common.js';

export class MatchReports {
  _fieldByBattle(battleId) {
    return typeof battleId === 'string' ? this.fields.find((f) => f.cc && f.battleId === battleId) || null : null;
  }

  /** b.progress from a field's authority (anything else — a stale battle, a demoted client — is ignored). */
  _onProgress(ps, msg) {
    if (!this.clientCombat) return fail(ERR.WRONG_PHASE, 'server-run combat');
    const f = this._fieldByBattle(msg.battleId);
    if (!f || f.done || f.mode !== 'client' || f.authority !== ps.playerId) return OK;
    const p = f.progress;
    const maxTotal = Math.max(p.total, (f.spec.spawns.length + 1) * 400);
    p.gt = Math.max(p.gt, Math.min(Number(msg.gt) || 0, HARD_CAP_SECONDS));
    // the latest total (spawns never reached before the limit leave it at the end)
    p.total = Math.min(maxTotal, Math.max(0, msg.total | 0));
    p.killed = Math.min(p.total, Math.max(p.killed, msg.killed | 0));
    // the HUD capsule's numerator as the authority reported it (shared/protocol.js b.progress `resolved`). Only a real
    // integer is adopted — an absent field leaves the null placeholder alone, so "not reported" and a reported 0 differ
    // (a `Number(null) === 0` here would defeat every `resolved ?? killed` fallback); a lower value is kept (the final
    // report drops never-spawned enemies from `total`, and a takeover may report a different number)
    if (Number.isInteger(msg.resolved)) p.resolved = Math.max(0, Math.min(1e5, msg.resolved));
    f.lastProgressAt = this.sched.now();
    if (f.kind === 'boss' || f.kind === 'hidden') {
      this._creditBoss(f, msg.bossDmg, msg.by);
      this._creditLp(f, msg.leaks, true);
      this._checkFinalEnd();
      this._broadcastPool(false);
      // 4 Hz per field: b.pool carries the exact pool / team LP; m.public (boss HP, LP, progress) follows at ~1 Hz
      this._bossPublic();
      return OK;
    }
    if (Number.isFinite(msg.leaks)) p.leaks = Math.max(p.leaks, msg.leaks);
    // 联防: the leakers' enemies still standing (the latest report; clamped where it is read, _uniteLeft)
    if (f.kind === 'unite' && msg.left && typeof msg.left === 'object') p.left = { ...msg.left };
    this.markPublic();
    return OK;
  }

  /** b.result from a field's authority: validated against the spec; an implausible one is replaced by the server's run. */
  _onResult(ps, msg) {
    if (!this.clientCombat) return fail(ERR.WRONG_PHASE, 'server-run combat');
    const f = this._fieldByBattle(msg.battleId);
    if (!f || f.done || f.heldResult || f.mode !== 'client' || f.authority !== ps.playerId) return OK;
    const bossLike = f.kind === 'boss' || f.kind === 'hidden';
    const v = validateClientResult(f.spec, msg.result, { gd: this.gd });
    if (!v.ok) {
      this.verifyStats.rejected++;
      this.log.warn?.(`[match ${this.roomCode}] ${f.fieldId}: rejected client result from ${ps.playerId} (${v.reason}) — server re-simulation`);
      if (bossLike && this._finalEnding) { f.result = syntheticResult(f.players, { bossBy: f.bossBy, time: this._fieldElapsed(f) }); this._fieldDone(f); this._checkFinalEnd(); }
      else if (bossLike) this._bossHandover(f, 'invalid', { demote: true });
      else this._runOnServer(f, 'invalid');
      return OK;
    }
    let result = v.result;
    if (bossLike) {
      // the final b.progress normally carried everything; the result's per-player damage is a lower bound
      const by = {};
      let sum = 0;
      for (const pid of f.players) { const d = Number(result.perPlayer[pid] && result.perPlayer[pid].bossDamage) || 0; by[pid] = d; sum += d; }
      if (sum > f.bossAcked) this._creditBoss(f, sum, by);
      // the client emptied the pool as it saw it (server hp − its unacknowledged damage): what is left on the server is
      // float dust from summing the fields' reports in another order — the boss is down (pools never hold less than
      // BOSS_POOL_MIN_HP, finalAssault.js: this only catches a noise-level disagreement at that boundary)
      const pool = this.bossPool;
      if (result.reason === 'cleared' && this._finalEnding !== 'forced' && pool && pool.hp > 0 && pool.hp < 1 + 1e-6) pool.damage(f.players[0] ?? null, pool.hp);
      // a boss field ends only when the shared pool is empty (the client saw it reach 0) or the match forced the end
      // (b.end): any other result — 'forced' / 'timeout' at t = 0, 'cleared' while the pool still holds — would stop
      // the pair's fight (and, with every field done, end the Final Assault as a defeat). The field is handed to the
      // partner's replica or the server instead, and the sender never reports it again.
      if (!this._finalEnding && !(pool && pool.hp <= 0)) {
        // 'cleared' while the budget still holds part of the client's cumulative report back: when that report covers
        // what the pool holds, the client emptied the pool as it saw it, only faster than BOSS_MIN_CLEAR_GS lets the
        // server credit (999-layer boards kill a 绝境 leader in 2–4 game s; official "boss一秒死", DESIGN §20.10). The
        // result waits: the boss clock credits the report as the budget grows and the pool's end (_endFinal) completes
        // the field with it — no takeover, nothing credited faster than the budget (a forged report gains nothing a
        // b.progress could not already get). The 1 HP slack is the pool's dust floor (BOSS_POOL_MIN_HP).
        const reported = Math.max(sum, f.bossReported ? f.bossReported.cum : 0);
        if (result.reason === 'cleared' && pool && reported - f.bossAcked >= pool.hp - 1) {
          f.heldResult = result;
          return OK;
        }
        this.verifyStats.rejected++;
        this.log.warn?.(`[match ${this.roomCode}] ${f.fieldId}: implausible boss result from ${ps.playerId} (${result.reason} while the pool holds ${pool ? Math.round(pool.hp) : '?'}) — handed over`);
        this._bossHandover(f, 'invalid', { demote: true });
        return OK;
      }
      this._bossResultDamage(f, result);
    } else {
      result = this._verifyResult(f, result);
    }
    f.result = result;
    f.resultSource = 'client';
    this._fieldDone(f);
    if (bossLike) { this._checkFinalEnd(); this._broadcastPool(false); }
    return OK;
  }

  /** A boss field's accepted client result: each player's bossDamage is at least what the server credited them. */
  _bossResultDamage(f, result) {
    for (const pid of f.players) if (result.perPlayer[pid]) result.perPlayer[pid].bossDamage = Math.max(result.perPlayer[pid].bossDamage || 0, f.bossBy[pid] || 0);
  }

  /**
   * SP_VERIFY: re-simulate an accepted client result ('all': now, the server's result wins on a mismatch; 'sample':
   * ~1 battle in 8 in a later callback, mismatches are only logged).
   */
  _verifyResult(f, result) {
    if (this.verifyMode === 'off') return result;
    const check = () => {
      const run = runHeadless(this._specBattle(f.spec), { players: f.players });
      const mine = validateClientResult(f.spec, compactForVerify(run.result), { gd: this.gd });
      const server = mine.ok ? mine.result : run.result;
      this.verifyStats.checked++;
      if (resultDigest(server).hash !== resultDigest(result).hash) {
        this.verifyStats.mismatches++;
        this.log.warn?.(`[match ${this.roomCode}] ${f.fieldId}: client result differs from the server's simulation`);
        return server;
      }
      return null;
    };
    if (this.verifyMode === 'all') return check() || result;
    let h = 0;
    for (let i = 0; i < f.battleId.length; i++) h = (h * 31 + f.battleId.charCodeAt(i)) >>> 0;
    if (h % 8 === 0) this.later(0, () => { try { check(); } catch (e) { this.reportError('verify', e); } });
    return result;
  }
}
