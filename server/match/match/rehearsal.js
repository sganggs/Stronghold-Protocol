// server/match/match/rehearsal.js — Match methods: the bot layout rehearsal delegated to the current host's browser
// (DESIGN §14; Match option `botRehearsalDelegate`, env SP_BOT_REHEARSAL=host, off by default). A rehearsal is a real
// simulation of this round's wave against each candidate layout, 0.2–1 s of CPU per bot prep — the one part of a bot's
// play that needs no match state, so the host's browser can do it off the page's main thread instead of the server.
// Only an AI teammate's prep is offered (`ps.isBot`): a human seat played by "AI 托管" uses the same bot routine, but
// the server keeps rehearsing it as before.
//
// The server sends the candidate BattleSpecs it would simulate itself, the seed and the tick cap in one `b.rehearsal`
// frame; the host's Worker simulates them with the same sim and the same scoring (server/sim/rehearsal.js) and answers
// `b.rehearsalResult { taskId, choice }` — the index of its pick in the order it was sent. Nothing else travels: the
// candidate layouts, the scoring and the layout application stay on the server, so the answer can only name one of the
// server's own candidates. The server takes the pick as it is (the host's browser is a worker of the match, like the
// authoritative client of a field): it does not re-simulate to prove the pick, which would spend exactly the CPU the
// delegation saves.
//
// A task is live only while its bot prep runs and its executor is still the host. A timeout, a host that changed,
// disconnected or left, and an errored or invalid answer make the server run the very same candidates itself
// (`job.takeOver()`), and the task is dropped, so a late or repeated answer is ignored — never applied twice. A task
// the server stops waiting for is also cancelled on the host (`b.rehearsalCancel`), which drops the work there
// instead of letting a stale simulation hold the browser's Worker. Waiting never extends the prep: MatchPrep.endPrep
// cancels whatever is left (Match._cancelRehearsal), and the deadline stays the phase's own.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { buildBattleSpec } from '../../sim/spec.js';
import { createDelegatedRehearsalJob } from '../bot.js';
import { morphBattleOpt } from '../../../shared/plugins/rules.js';

/**
 * Wall-clock ms the host has to answer a delegated rehearsal before the server runs the candidates itself. Long enough
 * for a slow client to simulate 2–3 candidates, short enough that a match with no usable host does not stall its bot
 * preps (the fallback then costs the CPU the server would have spent anyway).
 */
export const REHEARSAL_ANSWER_MS = 3000;

export class MatchRehearsal {
  /**
   * Offer one bot prep's layout rehearsal to the current host.
   * @param {{ ps: import('../PlayerState.js').PlayerState, chosen: any[], plans: Array<Map<number, string>>,
   *   inputs: object[] }} o the candidate plans and, per candidate, the preview battle options the server would build
   *   its own `Battle` from (server/match/bot.js candidateOpts)
   * @returns {null | ReturnType<typeof createDelegatedRehearsalJob>} the job to drive, or null when the server should
   *   rehearse the candidates itself (delegation off, no host to ask, or the frame could not be sent)
   */
  delegateRehearsal({ ps, chosen, plans, inputs }) {
    if (!this.botRehearsalDelegate || this.disposed || this.ended) return null;
    // A gameplay-plugin room (requireCs) runs in a match host on that room's content set. The host browser only has
    // the official data pack and must not load the room's scripts or spend a different script budget, so the server
    // rehearses these candidates itself — the same preview inputs, on the child's DataSource. The env flag is
    // inherited by the child; the gate has to live here, because the host proxy does not forward a delegate flag.
    if (this.requireCs) return null;
    if (!Array.isArray(inputs) || inputs.length < 2) return null;
    // an AI teammate only: a human's seat under AI 托管 plays the same bot routine, but its prep is not this feature's
    // business (the server rehearses it — same candidates, same comparison)
    if (!ps.isBot) return null;
    const host = this.hostId ? this.players.get(this.hostId) : null;
    if (!host || host.isBot || host.left || !host.connected) return null;
    const job = createDelegatedRehearsalJob(this, ps, chosen, plans, inputs);
    const task = {
      // protocol ids are ≤ 64 chars (shared/protocol.js isId): prefix, round, seat and a per-match counter
      id: `${this.battlePrefix}.${this.round}.${ps.seat}.${++this._rehearsalSeq}`,
      job, executor: host.playerId, timer: null,
    };
    // the candidates as the JSON the browser simulates — the same preview inputs the server would build, so both
    // sides compare the same battles. No `cs`: a missing hash means the official data. A spec that names a content
    // set is refused by the page (public/js/battle/rehearsal.js); plugin rooms never get here (requireCs above).
    const specs = inputs.map((o) => buildBattleSpec({ ...o, content: this.battleContent, ...morphBattleOpt(this.rules) }));
    // registered (and timed) before the frame goes out: an answer can only name a task the server already holds, and one
    // that comes back with the frame itself cannot race the timeout being armed
    this._rehearsalTasks.set(task.id, task);
    task.timer = this.later(this.scaled(this.botRehearsalDelegateMs), () => this._rehearsalTimeout(task));
    if (!this.sendTo(task.executor, { t: 'b.rehearsal', taskId: task.id, playerId: ps.playerId, cap: job.cap, specs })) {
      this._dropRehearsalTask(task);
      return null;
    }
    this.rehearsalStats.delegated++;
    this.log.info?.(`[match ${this.roomCode}] bot ${ps.playerId} rehearsal → ${task.executor} (${specs.length} candidates)`);
    return job;
  }

  /** The host answered (C2S b.rehearsalResult): its pick, a task it cannot run, or something to ignore. */
  _onRehearsalResult(ps, msg) {
    const task = this._rehearsalTasks.get(msg.taskId);
    if (!task) return; // unknown, already taken over, or ended with the prep: a late answer changes nothing
    if (task.executor !== ps.playerId) return; // never the current authorized executor of this task
    if (msg.error) { this._takeOverRehearsal(task, 'host cannot run the task'); return; }
    // only an index the host was actually sent: plans can keep a suffix that never became a spec (a preview that
    // failed to build), and a choice past the sent list is not one of this task's candidates
    const sent = Array.isArray(task.job.inputs) ? task.job.inputs.length : 0;
    const plan = Number.isInteger(msg.choice) && msg.choice < sent ? task.job.plans[msg.choice] : null;
    if (!plan) { this._takeOverRehearsal(task, `invalid choice ${String(msg.choice)}`); return; }
    this._dropRehearsalTask(task);
    task.job.accept(msg.choice);
    this.rehearsalStats.answered++;
    if (task.job.onSettled) task.job.onSettled();
  }

  /** The host ran out of time: the server runs the same candidates. */
  _rehearsalTimeout(task) {
    task.timer = null;
    if (this._rehearsalTasks.get(task.id) === task) this._takeOverRehearsal(task, 'timeout');
  }

  /**
   * A host changed (setHost: host migration) or the host is gone (disconnect / leave): a running task whose executor is
   * no longer the connected current host falls back to the server. Later tasks ask whoever the host is by then.
   */
  _rehearsalHostChanged() {
    for (const task of [...this._rehearsalTasks.values()]) {
      const host = this.players.get(task.executor);
      if (task.executor === this.hostId && host && !host.left && host.connected) continue;
      this._takeOverRehearsal(task, task.executor === this.hostId ? 'host gone' : 'host changed');
    }
  }

  /**
   * Every running task is dropped: the prep that owned them ended (their hosts are told to stop), or the match is being
   * disposed — a disposed match sends nothing at all (MatchMessaging.sendTo), and the page drops its own tasks when the
   * match on screen is over (public/js/battle/rehearsal.js clear, wired in main.js).
   */
  _cancelRehearsal() {
    for (const task of [...this._rehearsalTasks.values()]) this._dropRehearsalTask(task, !this.disposed);
  }

  /** Run a delegated rehearsal on the server instead: the job resumes locally, the task is dead (its answers ignored). */
  _takeOverRehearsal(task, reason) {
    this._dropRehearsalTask(task, true);
    task.job.takeOver();
    this.rehearsalStats.takeovers++;
    this.log.info?.(`[match ${this.roomCode}] bot rehearsal ← server (${reason})`);
    if (task.job.onSettled) task.job.onSettled();
  }

  /**
   * Drop one task: the server no longer waits for its answer and a late one changes nothing. With `cancel` the executor
   * is told (`b.rehearsalCancel`), so the host's browser stops working on a task the server already ran — it can only
   * interrupt a simulation in its Worker by dropping that Worker, which is why the task id travels with the frame. Not
   * sent for an answer the server accepted: that host is done with the task anyway.
   */
  _dropRehearsalTask(task, cancel = false) {
    if (this._rehearsalTasks.get(task.id) !== task) return;
    this._rehearsalTasks.delete(task.id);
    if (task.timer) { this.cancel(task.timer); task.timer = null; }
    if (cancel) this.sendTo(task.executor, { t: 'b.rehearsalCancel', taskId: task.id });
  }

  /**
   * The match's current host (server/lobby.js room.hostId: host migration while a match runs). Delegated rehearsals
   * follow it: a task whose executor is no longer the host is run by the server, the next ones ask the new host.
   */
  setHost(playerId) {
    const next = typeof playerId === 'string' ? playerId : null;
    if (next === this.hostId) return;
    this.hostId = next;
    this._rehearsalHostChanged();
  }
}
