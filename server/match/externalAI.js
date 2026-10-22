// Maintainer 2026-10-17 / 2026-10-19: external AI is a #673 strategy, with human validation and legacy fallback.
import { ERR } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { defineBotStrategy } from './botStrategyContract.js';
import { externalConfig, EXTERNAL_DEFAULTS } from './externalConfig.js';
import { httpDecision, StdioAI } from '../ai/transport.js';

import { aiDigest } from './aiDigest.js';
import { validPlan, validUsage } from './aiPlan.js';
import { knowledgePack } from '../ai/knowledge.js';
import { randomUUID } from 'node:crypto';

export const AI_VERSION = 'sp-ai/1';
// [ASSUMED] Only seat gameplay actions. Administration, test commands, battle reports, emotes and leaving are excluded.
export const AI_ACTIONS = Object.freeze({
  band: ['g.band', 'g.bandSkip', 'g.bandFocus'],
  card: ['g.choice'],
  offer: ['g.offer', 'g.offerRefresh'],
  prep: ['g.buy', 'g.sell', 'g.move', 'g.refresh', 'g.freeze', 'g.levelUp', 'g.equip', 'g.unequip', 'g.art', 'g.destroy', 'g.reward', 'g.choice', 'g.ready', 'g.offer', 'g.offerRefresh'],
});
const clone = value => JSON.parse(JSON.stringify(value));

export function aiObservation(m, ps, { id, kind, deadline, remaining }, results) {
  // Exactly the existing wire views: no PlayerState spread, data tables, RNG, seeds or other private views.
  const pub = m.publicView(), own = ps.privateView();
  const pack = m.externalAI?.knowledge;
  return clone({ v: AI_VERSION, id, public: pub, private: own,
    digest: aiDigest(m, ps, kind, pub, own, pack),
    ...(pack ? { knowledgeVersion: pack.version } : {}),
    context: { kind, phase: m.phase, round: m.round, deadline, remaining, legalActions: AI_ACTIONS[kind],
      ...(m.externalAI?.config.mode === 'plan' ? { matchId: m.externalAI.matchId } : {}) }, results });
}

export function validAIReply(reply, id, remaining) {
  return !!reply && typeof reply === 'object' && !Array.isArray(reply)
    && Object.keys(reply).every(k => ['v', 'id', 'intents', 'done', 'usage'].includes(k))
    && reply.v === AI_VERSION && reply.id === id && typeof reply.done === 'boolean' && validUsage(reply.usage)
    && Array.isArray(reply.intents) && reply.intents.length <= remaining
    && (reply.done || reply.intents.length > 0);
}

export const EXTERNAL_BOT = defineBotStrategy({ id: 'external', decide: (m, ps, decision) => m.externalAI.start(ps, decision) });

export class ExternalAI {
  constructor(m, input, replay = false) {
    this.m = m;
    this.replay = replay;
    this.config = externalConfig(input, process.env, replay);
    this.transport = !replay && this.config.transport === 'stdio' ? new StdioAI(this.config) : null;
    this.states = new Map();
    // [ASSUMED] Opaque advisor memory scope, independent of game RNG/seeds; never used by replay decisions.
    this.matchId = randomUUID();
    this.jobs = new Map();
    this.seq = 0;
    this.knowledge = this.config.knowledge ? knowledgePack(m.gd.raw, { language: this.config.language,
      modeId: m.modeId, rules: m.rules, offers: m.offers, contentId: m.cs }) : null;
    this.hello = null;
    this.helloChild = null;
    this.inflight = new Set();
    this.metrics = { calls: 0, helloCalls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, usageReports: 0, latencyMs: 0, fallbacks: 0, bySeat: {} };
  }

  journalConfig() {
    return { ...Object.fromEntries(Object.keys(EXTERNAL_DEFAULTS).map(k => [k, this.config[k]])),
      knowledge: this.config.knowledge,
      ...(this.config.seats ? { seats: this.config.seats.slice() } : {}) };
  }

  start(ps, decision) {
    const m = this.m;
    if (this.config.seats && !this.config.seats.includes(ps.seat)) return false;
    let state = this.states.get(ps.playerId);
    if (!state) { state = { failures: 0, disabled: false, results: [] }; this.states.set(ps.playerId, state); }
    if (state.disabled) return false;
    // Superseded prep schedules, manual takeover, test jumps, elimination and expired windows cannot apply late replies.
    this.prune();
    const key = `${ps.playerId}:${decision.key || decision.kind}`;
    if ([...this.jobs.values()].some(j => j.key === key)) return true;
    if (this.config.mode === 'plan' && decision.kind === 'prep' && state.prepRound === m.round) return false;
    const now = m.sched.now();
    const phaseDeadline = decision.deadline ?? m.deadline;
    // [ASSUMED] Reserve half the remaining phase for legacy; untimed phases still have the adapter's own cap.
    const budget = Math.max(0, Math.min(this.config.timeoutMs, phaseDeadline > 0 ? (phaseDeadline - now) / 2 : Infinity));
    if (budget <= 0) return false;
    if (this.config.mode === 'plan' && decision.kind === 'prep') { state.prepRound = m.round; state.plan = null; }
    const job = { ...decision, key, ps, state, used: 0, deadline: now + budget, id: null, controller: null, timer: null };
    job.timer = m.later(budget, () => this.fail(job));
    if (!this.replay) job.wallTimer = setTimeout(() => this.m.externalReply(job.id, null, true), budget);
    this.request(job);
    return true;
  }

  active(job) { return !this.m.disposed && !this.m.ended && job.ps.alive && job.ps.botControlled && job.valid(); }

  prune() {
    for (const job of [...this.jobs.values()]) if (!this.active(job)) this.drop(job);
  }

  request(job) {
    const id = `ai-${++this.seq}`;
    job.id = id;
    this.jobs.set(id, job);
    const observation = aiObservation(this.m, job.ps, { ...job, remaining: this.config.maxIntents - job.used }, job.state.results);
    observation.context.mode = this.config.mode;
    job.actions = new Map(observation.digest.actions.map(a => [a.id, a.intent]));
    if (this.replay) { job.state.results = []; return; }
    job.controller = new AbortController();
    job.state.results = [];
    job.started = performance.now();
    this.metric(job, 'calls');
    const promise = this.exchange(observation, job.controller.signal);
    const settled = promise.then(reply => {
      if (this.jobs.get(id) === job) this.m.externalReply(id, reply, false);
    }, () => {
      // Never journal or log transport diagnostics: URLs, bearer tokens and remote output may contain secrets.
      if (this.jobs.get(id) === job) this.m.externalReply(id, null, true);
    }).finally(() => this.inflight.delete(settled));
    this.inflight.add(settled);
  }

  metric(job, key, value = 1) {
    this.metrics[key] += value;
    const seat = this.metrics.bySeat[job.ps.seat] ||= { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, usageReports: 0, latencyMs: 0, fallbacks: 0 };
    seat[key] += value;
  }

  planFor(ps) {
    const state = this.states.get(ps.playerId);
    return state?.prepRound === this.m.round && !state.disabled ? state.plan : null;
  }

  observe(ps, hook, ev) {
    // §35.11: only completed, own-seat actions/results a human can observe. No inference from missing pieces.
    const state = this.states.get(ps?.playerId);
    if (this.config.mode !== 'plan' || !state || state.disabled || ev.preview) return;
    if (hook === 'onBattleResult') {
      state.lastBattle = { round: this.m.round, lp: ps.lp, lpLoss: ev.lpLoss,
        leaks: (ev.result?.leaked || []).filter(l => l && l.counted !== false).length };
      return;
    }
    let event;
    if (hook === 'onBuy') event = { type: 'buy', id: ev.slot.id, kind: ev.kind, cost: ev.price };
    if (hook === 'onSold') event = { type: 'sell', id: ev.piece.id, uid: ev.piece.uid };
    if (hook === 'onMerge') event = { type: 'merge', id: ev.piece.id, kind: ev.kind, baseId: ev.baseId || ev.itemId, consumed: ev.consumed?.slice() };
    if (!event) return;
    state.eventSeq = (state.eventSeq || 0) + 1;
    (state.events ||= []).push({ seq: state.eventSeq, round: this.m.round, ...event });
    // [ASSUMED] Keep the last 256 own events; expose the sequence so clients report gaps, never invent outcomes.
    if (state.events.length > 256) state.events.shift();
  }

  feedbackFor(ps) {
    const s = this.states.get(ps.playerId);
    return { events: s?.events || [], through: s?.eventSeq || 0, lastBattle: s?.lastBattle || null,
      acceptedPlan: s?.acceptedPlan || null };
  }

  async exchange(observation, signal) {
    if (this.knowledge) {
      if (this.transport) {
        this.transport.start();
        if (this.helloChild !== this.transport.child) { this.hello = null; this.helloChild = this.transport.child; }
      }
      if (!this.hello) {
        const hello = { v: AI_VERSION, type: 'hello', id: `hello-${observation.id}`, knowledge: this.knowledge };
        this.metrics.helloCalls++;
        this.hello = this.send(hello, signal).then(reply => {
          if (reply?.v !== AI_VERSION || reply.id !== hello.id || reply.type !== 'hello' || reply.knowledgeVersion !== this.knowledge.version) throw new Error('hello');
        }).catch(() => { this.hello = null; throw new Error('hello'); });
      }
      await this.hello;
    }
    if (signal.aborted) throw new Error('cancelled');
    return this.send(observation, signal);
  }

  send(observation, signal) {
    return this.transport ? this.transport.request(observation, signal) : httpDecision(this.config, observation, signal);
  }

  receive(id, reply, failed) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (!this.active(job)) { this.drop(job); return; }
    if (job.started != null) { this.metric(job, 'latencyMs', performance.now() - job.started); job.started = null; }
    if (failed || this.m.sched.now() >= job.deadline) { this.fail(job); return; }
    if (validUsage(reply?.usage) && reply?.usage) {
      this.metric(job, 'usageReports');
      for (const key of ['inputTokens', 'outputTokens', 'cachedTokens']) this.metric(job, key, reply.usage[key] || 0);
    }
    if (this.config.mode === 'plan') {
      if (!reply || !Object.keys(reply).every(k => ['v', 'id', 'plan', 'usage'].includes(k))
        || reply.v !== AI_VERSION || reply.id !== id || !validPlan(reply.plan) || !validUsage(reply.usage)) { this.fail(job); return; }
      if (job.kind === 'prep') {
        job.state.plan = clone(reply.plan);
        job.state.acceptedPlan = { id, round: this.m.round, plan: clone(reply.plan) };
      }
      const choice = reply.plan.choice && job.actions.get(reply.plan.choice);
      if (choice && validateC2S(choice) === null && AI_ACTIONS[job.kind].includes(choice.t)
        && ['g.band', 'g.bandSkip', 'g.choice', 'g.offer', 'g.reward'].includes(choice.t)) {
        const result = this.m._handleSeatIntent(job.ps, choice);
        job.state.results.push({ intent: choice, ...result });
      }
      job.state.failures = 0;
      const complete = job.complete();
      this.drop(job);
      // Accepted plans resume the #673 legacy continuation, including sliced rehearsal, without a failure.
      if (!complete && this.active(job)) job.fallback();
      return;
    }
    if (!validAIReply(reply, id, this.config.maxIntents - job.used)) { this.fail(job); return; }
    const { state, ps } = job;
    let completed = false;
    for (const action of reply.intents) {
      const intent = typeof action === 'string' ? job.actions.get(action) ?? null : action;
      job.used++;
      const schema = validateC2S(intent);
      const result = schema !== null || !AI_ACTIONS[job.kind].includes(intent?.t) ? { error: ERR.BAD_MSG }
        : completed || !this.active(job) ? { error: ERR.WRONG_PHASE }
          : this.m._handleSeatIntent(ps, intent);
      state.results.push({ intent, ...result });
      if (state.results.length > this.config.maxIntents) state.results.shift();
      completed ||= job.complete();
    }
    if (completed) { state.failures = 0; this.drop(job); }
    else if (reply.done || job.used >= this.config.maxIntents) this.fail(job);
    else {
      this.jobs.delete(id);
      this.request(job);
    }
  }

  fail(job) {
    if (this.jobs.get(job.id) !== job) return;
    const active = this.active(job);
    this.drop(job);
    if (!active) return;
    job.state.plan = null;
    this.metric(job, 'fallbacks');
    if (++job.state.failures >= this.config.failureLimit && !job.state.disabled) {
      job.state.disabled = true;
      this.m.log.warn?.(`[match ${this.m.roomCode}] external AI seat ${job.ps.seat} switched to legacy for this match`);
      for (const other of [...this.jobs.values()]) if (other.state === job.state) {
        const active = this.active(other);
        this.drop(other);
        if (active) other.fallback();
      }
    }
    job.fallback();
  }

  drop(job) {
    if (job.started != null) { this.metric(job, 'latencyMs', performance.now() - job.started); job.started = null; }
    this.jobs.delete(job.id);
    this.m.cancel(job.timer);
    clearTimeout(job.wallTimer);
    job.controller?.abort();
  }

  async waitForIdle() { await Promise.allSettled([...this.inflight]); }

  close() { for (const job of [...this.jobs.values()]) this.drop(job); this.transport?.close(); }
}
