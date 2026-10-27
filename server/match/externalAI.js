// Maintainer 2026-10-17 / 2026-10-19: external AI is a #673 strategy, with human validation and legacy fallback.
import { ERR } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { defineBotStrategy } from './botStrategyContract.js';
import { externalConfig, EXTERNAL_DEFAULTS } from './externalConfig.js';
import { httpDecision, StdioAI } from '../ai/transport.js';

import { aiDigest } from './aiDigest.js';
import { validPlan, validUsage } from './aiPlan.js';
import { knowledgePack } from '../ai/knowledge.js';
import { previewOf } from './waves.js';
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
// §35.62 [ASSUMED]: a failed or late prep call keeps the last accepted direction (bonds, buy/keep/sell, items,
// economy preferences) instead of leaving legacy with no weights. Observation-local choice IDs, placements and a
// one-prep level hold never carry over.
export function carryPlan(plan) {
  if (!plan) return null;
  const { choice, placements, economy, ...rest } = clone(plan);
  void choice; void placements;
  // §35.63: only the funds direction carries over. A carried maxRefreshes 0 / level / refreshAbove met a new round's
  // shop with last round's limits (failed preps lost 1.19 funds each against 0.37 for accepted ones).
  if (economy) {
    const kept = Object.fromEntries(Object.entries(economy).filter(([k]) => ['saveForInterest', 'reserve'].includes(k)));
    if (Object.keys(kept).length) rest.economy = kept;
  }
  return rest;
}

export function aiObservation(m, ps, { id, kind, deadline, remaining }, results) {
  // Exactly the existing wire views: no PlayerState spread, data tables, RNG, seeds or other private views.
  const pub = m.publicView(), own = ps.privateView();
  const pack = m.externalAI?.knowledge;
  return clone({ v: AI_VERSION, id, public: pub, private: own,
    digest: aiDigest(m, ps, kind, pub, own, pack),
    ...(pack ? { knowledgeVersion: pack.version } : {}),
    context: { kind, phase: m.phase, round: m.round, deadline, remaining, legalActions: AI_ACTIONS[kind],
      // a non-default official version's match (DESIGN §35.23): its registry id; the default's observation is unchanged
      ...(m.version ? { gameVersion: m.version } : {}),
      ...(m.externalAI?.config.mode === 'plan' ? { matchId: m.externalAI.matchId } : {}) }, results });
}

// §37.29 [ASSUMED] Both modes: the seat's last own battle as the battle statistics panel and the leaks show it to a
// human (per-unit damage/kills/taken/healing, leaks per enemy kind with the gates the round's preview showed for it).
function gatesOf(spawns) {
  const out = new Map();
  for (const e of previewOf(Array.isArray(spawns) ? spawns : [])) out.set(e.enemyKey, [...new Set([...(out.get(e.enemyKey) || []), e.gate])]);
  return out;
}
function battleReport(round, ps, ev, gates) {
  const r = ev.result || {}, leaks = new Map();
  for (const l of (r.leaked || []).filter(Boolean)) {
    const e = leaks.get(l.enemyKey) || { enemyKey: l.enemyKey, count: 0, counted: 0, gates: gates?.get(l.enemyKey) || [] };
    e.count++;
    if (l.counted !== false) e.counted++;
    leaks.set(l.enemyKey, e);
  }
  const units = (r.unitStats || []).filter(Boolean).map(u => ({ uid: u.uid ?? null, id: u.defId, kind: u.kind,
    dmg: u.dmg || 0, kills: u.kills || 0, taken: u.taken || 0, heal: u.heal || 0 })).sort((a, b) => b.dmg - a.dmg).slice(0, 24);
  return { round, ...(ev.boss ? { boss: true } : {}), lp: ps.lp, lpLoss: ev.lpLoss || 0, killed: r.killed || 0, total: r.total || 0,
    leaks: [...leaks.values()].sort((a, b) => b.counted - a.counted || b.count - a.count), units };
}

// A buy or reward shortcut stands for what its observation showed in that slot. A refresh, a level-up or a new reward
// offer earlier in the same reply can put something else there: the shortcut is then refused, not re-aimed (round-54
// manual play: "refresh" then "buy slot 4" bought the operator the refresh rolled in).
function slotExpectations(observation) {
  const { slots, rewardOffer } = observation.private.shop;
  return new Map(observation.digest.actions.flatMap(({ id, intent }) => intent.t === 'g.buy' ? [[id, slots[intent.slot]?.id ?? null]]
    : intent.t === 'g.reward' ? [[id, rewardOffer?.slots[intent.idx]?.id ?? null]] : []));
}
function staleShortcut(job, ps, action) {
  if (typeof action !== 'string' || !job.expect?.has(action)) return null;
  const intent = job.actions.get(action), want = job.expect.get(action);
  // a taken reward shifts the queue: the next offer is another card even when its slot shows the same operator
  if (intent.t === 'g.reward' && (ps.offers?.[0] ?? null) !== job.rewardOffer) {
    return { error: 'STALE_ACTION', detail: `${action} was for ${want} in an offer that is no longer the current one` };
  }
  const now = (intent.t === 'g.buy' ? ps.shop.slots[intent.slot] : ps.offers[0]?.slots[intent.idx])?.id ?? null;
  return now === want ? null : { error: 'STALE_ACTION', detail: `${action} was for ${want}; that slot now holds ${now ?? 'nothing'}` };
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
      ...(this.config.manualWait ? { manualWait: true } : {}),
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
    // §37.26 [ASSUMED]: the dev manual seat may wait indefinitely in an untimed window (untimed solo, a lone human's co-op).
    // §37.30 [ASSUMED]: a timed manual window (co-op, timed solo versions) gets the whole remaining phase or turn, and
    // the built-in bot never plays a manual seat: an expired window is left to the phase timer as for a human.
    const untimed = this.config.manualWait && !(phaseDeadline > 0);
    const share = this.config.manualWait ? 1 : 2;
    const budget = untimed ? Infinity : Math.max(0, Math.min(this.config.timeoutMs, phaseDeadline > 0 ? (phaseDeadline - now) / share : Infinity));
    if (budget <= 0) return this.config.manualWait;
    if (this.config.mode === 'plan' && decision.kind === 'prep') { state.prepRound = m.round; state.plan = carryPlan(state.acceptedPlan?.plan); }
    const job = { ...decision, key, ps, state, used: 0, deadline: untimed ? 0 : now + budget, id: null, controller: null, timer: null };
    this.arm(job);
    this.request(job);
    return true;
  }

  /** The decision window's timers (none in an untimed window); re-armed when a manual seat is asked again. */
  arm(job) {
    const left = job.deadline - this.m.sched.now();
    if (!(job.deadline > 0) || left <= 0) return;
    job.timer = this.m.later(left, () => this.fail(job, 'timeout'));
    if (!this.replay) job.wallTimer = setTimeout(() => this.m.externalReply(job.id, null, 'timeout'), left);
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
    job.expect = slotExpectations(observation);
    job.rewardOffer = job.ps.offers?.[0] ?? null;
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
    if (!state || state.disabled || ev.preview) return;
    // a helper's 联防 battle starts after its own one: keep the own wave's gates for that battle's report
    if (hook === 'onBattleStart') { if (ev.kind !== 'unite') state.gates = gatesOf(ev.spawns); return; }
    if (hook === 'onBattleResult') {
      state.battle = battleReport(this.m.round, ps, ev, state.gates);
      if (this.config.mode === 'plan') state.lastBattle = { round: this.m.round, lp: ps.lp, lpLoss: ev.lpLoss,
        leaks: (ev.result?.leaked || []).filter(l => l && l.counted !== false).length };
      return;
    }
    if (this.config.mode !== 'plan') return;
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

  battleFor(ps) { return this.states.get(ps.playerId)?.battle || null; }

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
    const timeoutMs = observation.context?.deadline === 0 && this.config.manualWait ? 0 : this.config.timeoutMs;
    return this.transport ? this.transport.request(observation, signal, { timeoutMs })
      : httpDecision({ ...this.config, timeoutMs }, observation, signal);
  }

  receive(id, reply, failed) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (!this.active(job)) { this.drop(job); return; }
    if (job.started != null) { this.metric(job, 'latencyMs', performance.now() - job.started); job.started = null; }
    if (failed || (job.deadline > 0 && this.m.sched.now() >= job.deadline)) { this.fail(job, failed === true ? 'error' : 'timeout'); return; }
    if (validUsage(reply?.usage) && reply?.usage) {
      this.metric(job, 'usageReports');
      for (const key of ['inputTokens', 'outputTokens', 'cachedTokens']) this.metric(job, key, reply.usage[key] || 0);
    }
    if (this.config.mode === 'plan') {
      if (!reply || !Object.keys(reply).every(k => ['v', 'id', 'plan', 'usage'].includes(k))
        || reply.v !== AI_VERSION || reply.id !== id || !validUsage(reply.usage)) { this.fail(job, 'error'); return; }
      // An agent that answers {plan: null} could not produce a plan in time (its own model timeout or refusal).
      if (reply.plan === null) { this.fail(job, 'timeout'); return; }
      if (!validPlan(reply.plan)) { this.fail(job, 'error'); return; }
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
    if (this.config.manualWait) state.failures = 0; // a manual seat's broken replies count only in a row
    let completed = false;
    for (const action of reply.intents) {
      const intent = typeof action === 'string' ? job.actions.get(action) ?? null : action;
      job.used++;
      const schema = validateC2S(intent);
      const result = schema !== null || !AI_ACTIONS[job.kind].includes(intent?.t) ? { error: ERR.BAD_MSG }
        : completed || !this.active(job) ? { error: ERR.WRONG_PHASE }
          : staleShortcut(job, ps, action) ?? this.m._handleSeatIntent(ps, intent);
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

  fail(job, reason = 'error') {
    if (this.jobs.get(job.id) !== job) return;
    const active = this.active(job);
    this.drop(job);
    if (this.config.manualWait) { this.manualFail(job, reason, active); return; }
    if (!active) return;
    this.metric(job, 'fallbacks');
    if (this.config.mode === 'direct') {
      job.state.results.push({ intent: null, error: reason === 'timeout' ? 'TIMEOUT' : 'EXTERNAL_ERROR',
        detail: `External decision ${job.id} ended; built-in bot fallback`, fallback: true });
      if (job.state.results.length > this.config.maxIntents) job.state.results.shift();
    }
    // §35.62 [ASSUMED]: in plan mode legacy always continues the decision, so a slow reply (budget elapsed or the
    // agent's {plan: null}) is not a broken adapter: only protocol/transport errors count toward failureLimit, and
    // the carried plan stays. Direct mode keeps §35.8's rule (every failure counts, the plan is cleared).
    const soft = this.config.mode === 'plan' && reason === 'timeout';
    if (this.config.mode !== 'plan') job.state.plan = null;
    if (!soft && ++job.state.failures >= this.config.failureLimit && !job.state.disabled) {
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

  // §37.30 [ASSUMED] A manual seat is never played by the built-in bot while it answers. A timed window that ends leaves the
  // seat to the phase timer exactly as for a human (prep: Ready with the current board; drafts and offers: their timeout
  // pick); a broken reply is asked again while the window lasts, at most failureLimit times in a row. An untimed window
  // has no timer to hand over to (Grok review): a used-up intent budget starts a fresh observation, and only failureLimit
  // broken replies in a row let the built-in bot finish that one decision. The seat is never switched to legacy.
  manualFail(job, reason, active) {
    const timed = job.deadline > 0, capped = job.used >= this.config.maxIntents;
    const broken = reason !== 'timeout' && !capped && ++job.state.failures >= this.config.failureLimit;
    let again = false, bot = false, detail;
    if (!active || (timed && (reason === 'timeout' || capped || broken))) {
      detail = `Decision ${job.id} ended; the phase timer decides as for a human (no bot fallback)`;
    } else if (!timed && broken) {
      bot = true;
      detail = `Decision ${job.id}: ${this.config.failureLimit} broken replies in a row; the built-in bot finished this untimed decision (the seat stays manual)`;
    } else {
      again = true;
      detail = !timed && capped ? `Decision ${job.id}: intent budget used up; a fresh observation with a new budget` : `Decision ${job.id}: invalid reply, asking again`;
      if (!timed && capped) job.used = 0;
    }
    job.state.results.push({ intent: null, error: reason === 'timeout' ? 'TIMEOUT' : 'EXTERNAL_ERROR', fallback: bot, detail });
    if (job.state.results.length > this.config.maxIntents) job.state.results.shift();
    if (again) { this.request(job); this.arm(job); }
    if (bot) { job.state.failures = 0; this.metric(job, 'fallbacks'); job.fallback(); }
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
