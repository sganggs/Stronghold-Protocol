// Opt-in house rule requested by the fork owner. Pacing only; never changes sim ticks.
import { PHASE, ERR } from '../../../shared/constants.js';
import { ruleOption } from '../../../shared/plugins/rules.js';
import { OK, fail } from './common.js';

export class MatchBattleSpeed {
  _initBattleSpeed() {
    this._leaveBattleSpeed();
    if (ruleOption(this.rules, 'battleSpeedControl') !== 'unanimous') return;
    this._speedPhaseSeq = (this._speedPhaseSeq || 0) + 1;
    this.speedControl = {
      phaseId: `${this.battlePrefix}.s${this._speedPhaseSeq}`, phase: this.phase,
      base: this.gameSpeed, multiplier: 1, revision: 0, sequence: 0, vote: null, outcome: null,
    };
  }

  _leaveBattleSpeed() {
    const s = this.speedControl;
    if (!s) return;
    if (s.vote) this.cancel(s.vote.timer);
    this.gameSpeed = s.base;
    this.speedControl = null;
  }

  _speedVoters() {
    const list = this.phase === PHASE.UNITE ? this.unitePlan?.helpers || [] : this.order;
    return list.filter(p => !p.isBot && p.alive && !p.left);
  }

  _speedAvailable() {
    return this.speedControl && this.speedControl.phase === this.phase && !this.ended && !this.disposed &&
      [PHASE.COMBAT, PHASE.UNITE].includes(this.phase) && this.uniteFast?.status !== 'running' &&
      this.fields.some(f => f.live && !f.done);
  }

  _cancelSpeedVote(outcome) {
    const s = this.speedControl;
    if (!s?.vote) return;
    this.cancel(s.vote.timer);
    s.vote = null;
    s.outcome = outcome;
    s.revision++;
    this.markPublic();
  }

  _syncBattleSpeed() {
    const s = this.speedControl;
    if (!s) return;
    if (s.phase !== this.phase || this.ended) { this._leaveBattleSpeed(); return; }
    if (!s.vote) return;
    const voters = this._speedVoters();
    if (!this._speedAvailable()) this._cancelSpeedVote('ended');
    else if (voters.some(p => !p.connected) ||
      voters.map(p => p.playerId).join('|') !== s.vote.eligible.join('|')) this._cancelSpeedVote('members');
    else if (this.sched.now() >= s.vote.deadline) this._cancelSpeedVote('expired');
  }

  _battleSpeedView() {
    const s = this.speedControl;
    if (!s) return null;
    const voters = this._speedVoters();
    const v = s.vote;
    return { phaseId: s.phaseId, revision: s.revision, speed: this.gameSpeed, multiplier: s.multiplier,
      eligible: voters.map(p => p.playerId), available: !!this._speedAvailable() && voters.every(p => p.connected),
      outcome: s.outcome, vote: v ? { id: v.id, target: v.target, proposer: v.proposer,
        eligible: v.eligible.slice(), agreed: [...v.agreed], deadline: v.deadline } : null };
  }

  voteBattleSpeed(ps, msg) {
    this._syncBattleSpeed();
    const s = this.speedControl;
    if (!s || msg.phaseId !== s.phaseId || msg.revision !== s.revision || !this._speedAvailable()) return fail(ERR.WRONG_PHASE);
    const voters = this._speedVoters();
    if (!voters.includes(ps) || voters.some(p => !p.connected)) return fail(ERR.BAD_TARGET);
    if (msg.action === 'propose') {
      if (s.vote || ![1, 2, 4].includes(msg.target) || msg.target === s.multiplier) return fail(ERR.BAD_TARGET);
      const v = { id: `${s.phaseId}.v${++s.sequence}`, target: msg.target, proposer: ps.playerId,
        eligible: voters.map(p => p.playerId), agreed: new Set([ps.playerId]),
        deadline: this.sched.now() + 15000, timer: null };
      s.vote = v;
      s.outcome = null;
      v.timer = this.later(15000, () => { if (this.speedControl === s && s.vote === v) this._cancelSpeedVote('expired'); });
    } else {
      const v = s.vote;
      if (!v || msg.voteId !== v.id) return fail(ERR.BAD_TARGET);
      if (msg.action === 'agree') v.agreed.add(ps.playerId);
      else if (msg.action === 'reject' || (msg.action === 'withdraw' && v.agreed.has(ps.playerId)) ||
        (msg.action === 'cancel' && v.proposer === ps.playerId)) {
        this._cancelSpeedVote(msg.action);
        return OK;
      } else return fail(ERR.BAD_TARGET);
    }
    const v = s.vote;
    if (v.eligible.every(id => v.agreed.has(id))) {
      this._applyBattleSpeed(v.target);
      this._cancelSpeedVote('passed');
      // Publish the new revision only once after the vote is completed.
      this._sendBattleSpeed();
    }
    this.markPublic();
    return OK;
  }

  _applyBattleSpeed(multiplier) {
    const s = this.speedControl;
    const now = this._clockNow();
    const old = this.gameSpeed;
    const speed = s.base * multiplier;
    // Consume elapsed wall time into the old-rate accumulator before changing the rate.
    // Do not run callbacks here: completion may transition the phase during a vote commit.
    if (this.runner && !this.runner.stopped && !this.runner.done) {
      if (!this.paused) this.runner.acc += Math.max(0, this.sched.now() - this.runner.last) / 1000 * old;
      this.runner.last = this.sched.now();
    }
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      // startAt is the virtual origin: preserve the unbounded field clock, including its grace interval.
      const elapsed = Math.max(0, (now - f.startAt) / 1000 * old);
      const limit = f.spec.timeLimit > 0 ? f.spec.timeLimit : 60;
      // Once the simulation limit was reached, the remaining network grace is wall time.
      if (elapsed >= limit && f.resultDeadlineAt != null) f.speedGraceDeadline = f.resultDeadlineAt;
      f.startAt = now - elapsed / speed * 1000;
    }
    if (this.deadline) this.deadline = now + Math.max(0, this.deadline - now) * old / speed;
    this.gameSpeed = speed;
    s.multiplier = multiplier;
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      if (this.paused) { f.rearmDeadline = f.mode === 'client'; f.rearmRelease = f.result != null; }
      else {
        if (f.mode === 'client') this._armDeadline(f);
        if (f.result != null) this._armRelease(f);
      }
    }
  }

  _sendBattleSpeed() {
    const s = this.speedControl;
    if (!s) return;
    for (const f of this.fields) {
      if (!f.live || f.done) continue;
      this.broadcast({ t: 'b.speed', battleId: f.battleId || f.fieldId, fieldId: f.fieldId,
        phaseId: s.phaseId, revision: s.revision, speed: this.gameSpeed,
        elapsed: f.cc ? this._fieldElapsed(f) : this.runner?.time || 0, serverNow: this.sched.now() });
    }
  }
}
