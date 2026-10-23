// Opt-in house rule, explicitly requested by the server owner. Vanilla remains unchanged.
import { PHASE, ERR } from '../../../shared/constants.js';
import { ruleOption } from '../../../shared/plugins/rules.js';
import { buildBattleSpec } from '../../sim/spec.js';
import { morphBattleOpt } from '../../../shared/plugins/rules.js';
import { startUniteFastJob } from '../uniteFastJob.js';
import { OK, fail } from './common.js';

export class MatchUniteFast {
  _initUniteFast(opts) {
    this._cancelUniteFast();
    if (this.mode !== 'coop' || ruleOption(this.rules, 'uniteFastForward') !== 'unanimous') return;
    this.uniteFast = {
      phaseId: `${this.battlePrefix}.${this.round}.u`, round: this.round,
      status: 'waiting', votes: new Set(), job: null, completed: false,
      spec: buildBattleSpec({ ...opts, ...morphBattleOpt(this.rules), content: this.battleContent, cs: this.cs }),
    };
  }

  _cancelUniteFast() {
    const state = this.uniteFast;
    this.uniteFast = null;
    state?.job?.cancel();
  }

  _uniteVoters() {
    // Disconnected humans stay in the quorum. Leaving / elimination never counts as consent.
    return (this.unitePlan?.helpers ?? []).filter(p => !p.isBot && p.alive && !p.left);
  }

  _uniteFastView() {
    const s = this.uniteFast;
    if (!s || this.phase !== PHASE.UNITE) return null;
    const eligible = this._uniteVoters().map(p => p.playerId);
    return { phaseId: s.phaseId, round: s.round, status: s.status, eligible,
      failed: !!s.failed, votes: [...s.votes].filter(id => eligible.includes(id)) };
  }

  voteUniteFast(ps, msg) {
    const s = this.uniteFast;
    const f = this.fields[0];
    if (!s || this.phase !== PHASE.UNITE || s.round !== msg.round || s.phaseId !== msg.phaseId)
      return fail(ERR.WRONG_PHASE);
    if (!this._uniteVoters().includes(ps) || !ps.connected) return fail(ERR.BAD_TARGET);
    if (s.status !== 'waiting') return OK; // retransmission cannot start another job
    if (!f?.live || f.done) return fail(ERR.WRONG_PHASE);
    if (msg.agree) s.votes.add(ps.playerId); else s.votes.delete(ps.playerId);
    const voters = this._uniteVoters();
    if (voters.length && voters.every(p => p.connected && s.votes.has(p.playerId))) {
      this._cancelSpeedVote('locked');
      s.status = 'running';
      s.failed = false;
      // Normal simulation remains available as a recovery path, but cannot settle while locked.
      s.job = startUniteFastJob({ spec: s.spec, data: this.data });
      s.job.promise.then(result => this.guard(() => {
        if (this.uniteFast !== s || this.phase !== PHASE.UNITE || s.completed || this.disposed || this.ended) return;
        s.job = null;
        s.status = 'complete';
        this.runner?.stop();
        if (f.cc) {
          this._clearFieldTimers(f);
          f.result = result;
          f.resultSource = 'server';
          f.done = true;
          f.live = false;
          this._finishUniteClient();
        } else this._completeUniteServer(result);
      }), error => this.guard(() => {
        if (this.uniteFast !== s || this.phase !== PHASE.UNITE || s.completed || this.disposed || this.ended) return;
        s.job = null;
        s.status = 'waiting';
        s.failed = true;
        s.votes.clear();
        this.log.warn?.(`[match ${this.roomCode}] Unite fast-forward failed: ${error.message}`);
        // Never accept an old browser result after a locked request. The original spec is replayed normally.
        if (f.cc) {
          if (f.done) this._finishUniteClient();
          else this._runOnServer(f, 'fast-forward-recovery');
        } else if (s.normalResult) this._completeUniteServer(s.normalResult);
        this.markPublic();
      }));
    }
    this.markPublic();
    return OK;
  }

  _claimUniteEnd(result) {
    const s = this.uniteFast;
    if (!s) return true;
    if (s.completed) return false;
    if (s.status === 'running') { s.normalResult = result; return false; }
    s.completed = true;
    s.status = 'complete';
    s.votes.clear();
    return true;
  }
}
