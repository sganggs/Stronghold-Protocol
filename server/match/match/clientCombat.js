// server/match/match/clientCombat.js — Match methods: client-side combat bookkeeping (DESIGN §14) — field records (the
// JSON BattleSpec + the authority / result state), spec battles on the server, the field clock, the authority (the
// lowest connected seat), b.start per recipient, result deadlines and releases, server runs (headless slices,
// takeovers), field completion → the phase end, and the timers of it all.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE } from '../../../shared/constants.js';
import { DeadBattle, syntheticResult, RESULT_GRACE_MS, HARD_CAP_SECONDS, HeadlessJob } from '../fields.js';
import { buildBattleSpec, createBattleFromSpec } from '../../sim/spec.js';

export class MatchClientCombat {
  /** Stop every client-combat timer and the headless pacer (phase end, finish, dispose). */
  _stopClientCombat() {
    if (this._progressTimer) { this.cancel(this._progressTimer); this._progressTimer = null; }
    if (this._bossClock) { this.cancel(this._bossClock); this._bossClock = null; }
    this._bossClockOn = false;
    // a pending throttled boss refresh: the merged team LP is written back now (m.result / settlement read it)
    if (this._bossPubTimer) { this.cancel(this._bossPubTimer); this._bossPubTimer = null; this._syncTeamLp(); this.markPublic(); }
    this._clearPause();
    if (this._poolTimer) { this.cancel(this._poolTimer); this._poolTimer = null; }
    if (this.pacer) { try { this.pacer.stop(); } catch { /* ignore */ } this.pacer = null; }
    for (const f of this.fields) this._clearFieldTimers(f);
  }

  _clearFieldTimers(f) {
    if (!f || !f.cc) return;
    for (const k of ['deadlineTimer', 'doneTimer', 'waitTimer', 'sliceTimer']) if (f[k]) { this.cancel(f[k]); f[k] = null; }
    f.job = null;
  }

  /** A client-combat field record: the JSON BattleSpec of its Battle options plus the authority / result state. */
  _ccField({ fieldId, kind, players, opts, boss = null }) {
    const seq = `${this.battlePrefix}.${this.round}.${++this._battleSeq}`;
    // protocol ids are ≤ 64 chars (shared/protocol.js isId): the field id is informational, the sequence is unique
    const battleId = seq.length + 1 + String(fieldId).length <= 64 ? `${seq}.${fieldId}` : seq;
    const spec = buildBattleSpec({ ...opts, battleId, fieldId, kind, content: this.battleContent, boss });
    let total = 0;
    for (const x of spec.spawns) if (x && x.tag !== 'boss' && x.tag !== 'part' && x.countInTotal !== false) total += Math.max(1, Math.floor(Number(x.count) || 1));
    return {
      cc: true, fieldId, kind, players: players.slice(), battleId, spec, battle: null, live: true, done: false,
      mode: null, authority: null, startAt: this.sched.now(), result: null, resultSource: null, timeline: null, endGt: null,
      // progress: the field's own numbers as far as they are known before its first b.progress / result (`total` = the
      // spec's scheduled enemies — the capsule's denominator). `resolved` starts at **null**: it is only adopted from a
      // real report, so `resolved ?? killed` fallbacks (an unreported field, a synthetic result) keep working — a 0 here
      // would read as "nothing resolved yet" and could never be told apart from a reported 0.
      progress: { gt: 0, killed: 0, total, leaks: 0, resolved: null, done: false }, lastProgressAt: this.sched.now(),
      bossAcked: 0, bossBy: {}, lpAcked: 0, lpCum: 0, deadlineTimer: null, doneTimer: null, waitTimer: null,
      // boss fields: the latest client reports (re-credited as the plausibility budget grows), the server run's
      // CreditPool, humans demoted for an implausible result (never the authority of this field again), a 'cleared'
      // b.result waiting for the budget to credit the pool it emptied (`heldResult`, _onResult)
      bossReported: null, lpReported: 0, credit: null, demoted: new Set(), heldResult: null,
    };
  }

  /** A battle built from a spec on the server (headless / takeover / verification); never throws. */
  _specBattle(spec, { sharedBoss = null } = {}) {
    try {
      return createBattleFromSpec(spec, this.ds, { BattleClass: this.BattleClass, sharedBoss, logger: this.log, recordEvents: false });
    } catch (e) {
      this.reportError(`battle ${spec && spec.fieldId} construct`, e);
      return new DeadBattle({ fieldId: spec && spec.fieldId, kind: spec && spec.kind, players: (spec && spec.players) || [], rect: spec && spec.rect, stageId: spec && spec.stageId }, 'forced');
    }
  }

  /** Game seconds a field has run (its clock; a finished field: its final time). */
  _fieldElapsed(f) {
    if (f.done && f.result && Number.isFinite(f.result.time)) return f.result.time;
    const gt = Math.max(0, ((this._clockNow() - f.startAt) / 1000) * this.gameSpeed);
    if (f.endGt != null) return Math.min(gt, f.endGt);
    const lim = f.spec && f.spec.timeLimit > 0 ? f.spec.timeLimit : HARD_CAP_SECONDS;
    return Math.min(gt, lim);
  }

  /** The connected human who simulates a field: lowest seat among its players (normal: the owner). */
  _authorityFor(f, exclude = null) {
    let best = null;
    for (const pid of f.players) {
      if (pid === exclude || (f.demoted && f.demoted.has(pid))) continue;
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left || !ps.connected) continue;
      if (!best || ps.seat < best.seat) best = ps;
    }
    return best ? best.playerId : null;
  }

  /** b.start of a field for one recipient (`watch`: not a player of the field). */
  _startMsg(f, pid, { watch = false } = {}) {
    return {
      t: 'b.start', battleId: f.battleId, fieldId: f.fieldId, kind: f.kind,
      spec: this.spectators.has(pid) ? this._spectatorSpec(f) : f.spec,
      authoritative: !!(!f.done && f.mode === 'client' && f.authority === pid && !watch),
      startAt: f.startAt, serverNow: this.sched.now(), elapsed: Math.round(this._fieldElapsed(f) * 1000) / 1000,
      speed: this.gameSpeed, watch: !!watch, done: !!f.done,
    };
  }

  _sendStart(pid, f, opts = {}) {
    const ps = this.players.get(pid) || this.spectators.get(pid);
    if (!ps || ps.isBot || ps.left || !ps.connected) return false;
    return this.sendTo(pid, this._startMsg(f, pid, opts));
  }

  /** Give every field its authority (a connected human) or run it on the server. */
  _launch(fields) {
    const now = this.sched.now();
    this.fields = fields;
    for (const f of fields) { f.startAt = now; f.lastProgressAt = now; }
    for (const f of fields) {
      const auth = this._authorityFor(f);
      if (auth) this._assignClient(f, auth);
      else this._runOnServer(f, 'no-human');
    }
  }

  _assignClient(f, pid) {
    f.mode = 'client';
    f.authority = pid;
    f.lastProgressAt = this.sched.now();
    if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; }
    if (f.kind === 'boss' || f.kind === 'hidden') return; // the pool / team LP / silence watchdog end those
    if (this.paused) { f.rearmDeadline = true; return; }
    this._armDeadline(f);
  }

  /** A client field's result deadline: its time limit on the field clock + RESULT_GRACE_MS (then the server takes over). */
  _armDeadline(f) {
    if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; }
    const lim = f.spec.timeLimit > 0 ? f.spec.timeLimit : 60;
    const at = f.startAt + Math.round((lim / this.gameSpeed) * 1000) + RESULT_GRACE_MS;
    f.deadlineTimer = this.later(Math.max(0, at - this.sched.now()), () => {
      f.deadlineTimer = null;
      if (f.done || f.mode !== 'client') return;
      this._runOnServer(f, 'timeout');
    });
  }

  /** A server-run normal / 联防 field's result is released at the battle's natural end on the field clock. */
  _armRelease(f) {
    if (f.doneTimer) { this.cancel(f.doneTimer); f.doneTimer = null; }
    if (f.done || f.result == null) return;
    if (this.paused) { f.rearmRelease = true; return; }
    const doneAt = f.startAt + Math.round(((f.endGt || 0) / this.gameSpeed) * 1000);
    const wait = this.sched.instant ? 0 : Math.max(0, doneAt - this.sched.now());
    f.doneTimer = this.later(wait, () => { f.doneTimer = null; this._fieldDone(f); });
  }

  /**
   * The server simulates a field: normal / 联防 headlessly at once (the result is released at the battle's natural end
   * on the field's clock, so the teammates' progress UI and the round pacing stay as if it ran live); boss fields in
   * real time on the pacer (they share the pool), fast-forwarded to the field's clock on a takeover.
   */
  _runOnServer(f, reason) {
    const prev = f.mode === 'client' ? f.authority : null;
    if (prev) {
      this.verifyStats.takeovers++;
      this.log.info?.(`[match ${this.roomCode}] ${f.fieldId} R${this.round}: server takeover from ${prev} (${reason})`);
    }
    f.mode = 'server';
    f.authority = null;
    if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; }
    // the former authority (still online after a timeout / an invalid result) stops reporting and keeps its view
    if (prev) this.sendTo(prev, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'takeover' });
    if (f.kind === 'boss' || f.kind === 'hidden') { this._bossServerRun(f); return; }
    const job = new HeadlessJob(this._specBattle(f.spec), { onError: (e) => this.reportError(`field ${f.fieldId} step`, e), players: f.players });
    f.job = job;
    f.battle = job.battle;
    f.timeline = job.timeline; // grows while the job runs (the teammates' progress UI reads it on the field clock)
    if (f.sliceTimer) { this.cancel(f.sliceTimer); f.sliceTimer = null; }
    const complete = () => {
      if (f.job !== job || f.done) return;
      f.job = null;
      const run = job.output();
      f.battle = run.battle;
      f.result = run.result;
      f.resultSource = 'server';
      f.timeline = run.timeline;
      f.endGt = Number(run.battle.time) || 0;
      this._armRelease(f);
    };
    if (!Number.isFinite(this.headlessSliceMs)) {
      job.run(Infinity);
      complete();
    } else {
      // a real host: wall-clock-bounded slices in callbacks of their own (3 bot fields at combat start would otherwise
      // block the event loop for ~0.2–0.5 s here, seconds on a low-power mini PC)
      const slice = () => {
        f.sliceTimer = null;
        if (f.job !== job || f.done) return;
        if (job.run(this.headlessSliceMs)) complete();
        else f.sliceTimer = this.later(0, slice);
      };
      f.sliceTimer = this.later(0, slice);
    }
    this._armProgressTicker();
  }

  /** m.public ~1 Hz while server-run fields progress along their timelines. */
  _armProgressTicker() {
    if (this._progressTimer || this.sched.instant) return;
    const tick = () => {
      this._progressTimer = null;
      if (!this.fields.some((f) => f.cc && f.mode === 'server' && !f.done && f.timeline)) return;
      this.markPublic();
      this._progressTimer = this.later(1000, tick);
    };
    this._progressTimer = this.later(1000, tick);
  }

  /** A field has its final result. */
  _fieldDone(f) {
    if (!f || f.done) return;
    f.done = true;
    f.live = false;
    this._clearFieldTimers(f);
    if (!f.result) f.result = syntheticResult(f.players, { bossBy: f.bossBy });
    f.progress.done = true;
    this.markPublic();
    this._maybeFieldsDone();
  }

  _maybeFieldsDone() {
    if (!this.fields.length || this.fields.some((f) => f.cc && !f.done)) return;
    if (!this.fields.every((f) => f.cc)) return;
    if (this.phase === PHASE.COMBAT) this._finishCombat((f) => f.result);
    else if (this.phase === PHASE.UNITE) this._finishUniteClient();
    else if (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) this._finishFinal(this.phase === PHASE.HIDDEN_CORE, (f) => f.result);
  }

  /** An authoritative human disconnected / left: normal & 联防 fields → server takeover; boss → the partner or the server. */
  _authorityLost(ps, why) {
    for (const f of this.fields) {
      if (!f.cc || f.done || f.mode !== 'client' || f.authority !== ps.playerId) continue;
      if (f.kind === 'boss' || f.kind === 'hidden') this._bossHandover(f, why);
      else this._runOnServer(f, why);
    }
  }
}
