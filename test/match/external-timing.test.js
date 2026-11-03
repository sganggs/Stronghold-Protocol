// §37.72 plan-mode time limits (handoff/round65 diag coop-timing): a plan seat's budget is its window minus the built-in
// bot's reserve (not half of it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA, checkInvariants } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { planReserveMs } from '../../server/match/externalAI.js';
import { externalConfig } from '../../server/match/externalConfig.js';
import { decodeTestTrace, replayTestMatch } from '../../server/match/testReplay.js';
import { runMatch } from '../../tools/ai/run-match.mjs';

const jobs = m => [...m.externalAI.jobs.values()];
const jobOf = (m, ps, kind) => jobs(m).find(j => j.ps === ps && j.kind === kind);
const answer = (m, job, plan) => m.externalReply(job.id, { v: 'sp-ai/1', id: job.id, plan }, false);
// the slow agent's marker (test/fixtures/slow-plan-agent.mjs): reserve survives carryPlan
const marker = round => ({ economy: { reserve: round } });
const journal = entries => ({ info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } });

/** An all-AI co-op 终极 room (timed: no human) whose four seats ask the external host in plan mode, without IO. */
function coop(t, { externalAI, ...opts } = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 0, bots: 4, fake: true, botStrategy: 'external', externalReplay: true,
    externalAI: { mode: 'plan', timeoutMs: 300000, ...externalAI }, ...opts });
  t.after(() => h.m.dispose());
  return h;
}
/** Run until round r's prep has started and every seat still in has its prep decision out; the jobs in seat order. */
function prepJobs(h, r = 1) {
  const { m } = h;
  assert.ok(h.run(() => m.phase === 'PREP' && m.round === r && m.alivePlayers().every(ps => jobOf(m, ps, 'prep'))), `R${r} prep decisions`);
  return m.order.map(ps => jobOf(m, ps, 'prep'));
}

test('§37.72 plan reserve: the per-round table, the Final Assault and Hidden Core preps, turns, overrides, a delegated rehearsal', t => {
  const { m } = coop(t), ps = m.order[0];
  const at = (round, kind = 'prep', config = m.externalAI.config) => { m.round = round; return planReserveMs(m, ps, kind, config); };
  assert.deepEqual([m.gd.bossRound, m.gd.hiddenRound], [14, 15]);
  assert.deepEqual(Array.from({ length: 15 }, (_, i) => at(i + 1)),
    [5000, 5000, 5000, 5000, 5000, 9000, 9000, 9000, 12000, 12000, 12000, 12000, 12000, 36000, 24000]);
  for (const kind of ['band', 'card', 'offer']) assert.equal(at(14, kind), 1000, kind);
  const config = input => externalConfig({ mode: 'plan', ...input }, {}, true);
  assert.equal(at(14, 'prep', config({ reserveMs: 2000 })), 2000, 'reserveMs replaces the table');
  assert.equal(at(1, 'card', config({ reserveMs: 2000 })), 2000);
  assert.equal(at(14, 'prep', config({ reserveScale: 0.5 })), 18000, 'reserveScale multiplies it');
  assert.equal(at(6, 'prep', config({ reserveMs: 1000, reserveScale: 3 })), 3000);
  m.botRehearsalDelegate = true;
  assert.equal(at(1), 5000 + m.scaled(m.botRehearsalDelegateMs), 'a rehearsal offered to the host adds its answer window');
  assert.equal(at(1, 'band'), 1000);
});

test('§37.72 reserve configuration: environment, defaults and bounds', () => {
  const env = { SP_EXTERNAL_AI_TRANSPORT: 'stdio', SP_EXTERNAL_AI_COMMAND: '["node","agent.mjs"]', SP_EXTERNAL_AI_MODE: 'plan' };
  const base = externalConfig(undefined, env);
  assert.deepEqual([base.reserveMs, base.reserveScale], [null, 1]);
  const set = externalConfig(undefined, { ...env, SP_EXTERNAL_AI_RESERVE_MS: '0', SP_EXTERNAL_AI_RESERVE_SCALE: '1.5' });
  assert.deepEqual([set.reserveMs, set.reserveScale], [0, 1.5]);
  assert.equal(externalConfig({ mode: 'plan', reserveMs: undefined, reserveScale: undefined }, {}, true).reserveScale, 1);
  for (const bad of [{ reserveMs: -1 }, { reserveMs: 120001 }, { reserveMs: 2.5 }, { reserveMs: '5000' },
    { reserveScale: -0.5 }, { reserveScale: 10.5 }, { reserveScale: NaN }, { reserveScale: '2' }]) {
    assert.throws(() => externalConfig({ mode: 'plan', ...bad }, {}, true), /invalid reserve/, String(Object.values(bad)[0]));
  }
  assert.throws(() => externalConfig(undefined, { ...env, SP_EXTERNAL_AI_RESERVE_MS: 'soon' }), /invalid reserveMs/);
});

test('§37.72 plan budgets over a whole co-op match: each prep keeps its round\'s reserve, band and 机变 turns 1 s', t => {
  const h = coop(t, { script: b => (b.kind === 'boss' ? { bossDps: 1e9 } : {}) }), { m } = h, ai = m.externalAI;
  const kept = new Map();
  const request = ai.request.bind(ai);
  ai.request = job => {
    const key = `${job.kind} R${m.round}`;
    kept.set(key, [...new Set([...(kept.get(key) || []), m.deadline - job.deadline])]);
    request(job);
  };
  h.start();
  assert.ok(h.run(() => m.round === m.gd.bossRound && m.phase === 'PREP' && m.order.every(ps => jobOf(m, ps, 'prep'))));
  const want = { 'band R0': [1000], 'card R3': [1000], 'card R9': [1000], 'card R11': [1000] };
  for (let r = 1; r <= 14; r++) want[`prep R${r}`] = [r <= 5 ? 5000 : r <= 8 ? 9000 : r <= 13 ? 12000 : 36000];
  assert.deepEqual(Object.fromEntries([...kept].sort()), Object.fromEntries(Object.entries(want).sort()));
  // no replies: every decision fell back after its budget, softly
  assert.ok(m.order.every(ps => ai.states.get(ps.playerId).failures === 0));
  checkInvariants(m); assert.deepEqual(h.logs.error, []);
});

test('§37.72 unchanged elsewhere: direct seats keep half, a short window keeps half, manual seats the whole turn, untimed solo timeoutMs', t => {
  const made = job => job.deadline - job.budget; // the decision's start
  for (const [externalAI, opts, check] of [
    [{ mode: 'direct' }, {}, (job, m) => assert.equal(job.budget, (m.deadline - made(job)) / 2, 'direct mode: half')],
    [{}, { timerScale: 0.01 }, (job, m) => assert.equal(job.budget, (m.deadline - made(job)) / 2, 'the reserve never exceeds half')],
    [{ reserveMs: 20000 }, {}, (job, m) => assert.equal(m.deadline - job.deadline, 20000, 'reserveMs')],
  ]) {
    const h = coop(t, { externalAI, ...opts });
    h.start();
    for (const job of prepJobs(h)) check(job, h.m);
  }
  const manual = makeMatch({ mode: 'coop', fake: true, botStrategy: 'external', externalReplay: true,
    seats: Array.from({ length: 4 }, (_, seat) => ({ seat, playerId: `manual_${seat}`, name: `S${seat}`, isBot: true, connected: true })),
    externalAI: { manualWait: true, timeoutMs: 300000 } });
  t.after(() => manual.m.dispose());
  manual.start(); manual.run(() => jobs(manual.m).length > 0);
  assert.equal(jobs(manual.m)[0].deadline, manual.m.deadline, 'a manual seat gets the whole turn (§37.30)');
  const solo = makeMatch({ mode: 'solo', fake: true, botStrategy: 'external', externalReplay: true,
    seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true }], externalAI: { mode: 'plan', timeoutMs: 300000 } });
  t.after(() => solo.m.dispose());
  solo.start(); solo.run(() => jobs(solo.m).length > 0);
  const [band] = jobs(solo.m);
  assert.deepEqual([solo.m.deadline, band.budget, band.deadline - solo.m.sched.now()], [0, 300000, 300000], 'untimed: the adapter cap');
});

test('§37.72 deadline boundary: a reply 1 ms before it is the plan, one at it falls back; every seat readies before the prep timer', t => {
  const h = coop(t), { m } = h, ai = m.externalAI;
  h.start();
  assert.ok(h.run(() => m.phase === 'PREP' && m.round === 1));
  const prepEnd = m.deadline, deadline = prepEnd - 5000, [a, b] = m.order;
  // queued before any decision timer exists, so at the deadline it runs ahead of them: the reply came, the timer had not run
  h.sched.setTimeout(() => answer(m, jobOf(m, b, 'prep'), marker(1)), deadline - m.sched.now());
  const all = prepJobs(h);
  assert.ok(all.every(j => j.deadline === deadline), 'every seat\'s budget ends at prep end − 5 s, whatever its stagger');
  h.sched.advance(deadline - 1 - m.sched.now());
  const plan = { economy: { reserve: 2, saveForInterest: true } };
  answer(m, all[0], plan);
  assert.deepEqual(ai.feedbackFor(a).acceptedPlan, { id: all[0].id, round: 1, plan }, 'in time: no late mark');
  assert.deepEqual(ai.planFor(a), plan);
  assert.ok(h.run(() => m.phase !== 'PREP'));
  assert.ok(m.sched.now() < prepEnd, 'the fallbacks readied every seat and the prep ended before its timer');
  assert.ok(m.order.every(ps => ps.deployCount > 0), 'every seat placed a board');
  assert.equal(ai.feedbackFor(b).acceptedPlan, null, 'a reply at the deadline is not the plan');
  assert.equal(ai.planFor(b), null, 'its fallback ran unweighted (no earlier plan to carry)');
  assert.ok(m.order.every(ps => ai.states.get(ps.playerId).failures === 0));
  checkInvariants(m); assert.deepEqual(h.logs.error, []);
});

test('§37.72 journal replay: the reserve configuration is journalled; in-time plans and fallbacks replay identically', t => {
  const entries = [];
  const h = coop(t, { test: true, botSliceMs: 0.001, externalAI: { reserveMs: 7000 }, log: journal(entries) }), { m } = h;
  h.start();
  assert.ok(h.run(() => m.phase === 'PREP' && m.round === 1));
  const deadline = m.deadline - 7000, b = m.order[1];
  // seat 1 answers at its deadline before the timer ran (falls back), seat 0 1 ms before it (in time), seats 2–3 never
  h.sched.setTimeout(() => answer(m, jobOf(m, b, 'prep'), marker(1)), deadline - m.sched.now());
  const [ja] = prepJobs(h);
  assert.equal(ja.deadline, deadline);
  h.sched.advance(deadline - 1 - m.sched.now());
  answer(m, ja, { economy: { reserve: 3 } });
  assert.ok(h.run(() => m.phase !== 'PREP'));
  prepJobs(h, 2);
  assert.ok(h.run(() => m.phase !== 'PREP'));
  const plans = x => x.order.map(p => x.externalAI.states.get(p.playerId)?.acceptedPlan ?? null);
  assert.deepEqual(plans(m).map(p => p && p.id), [ja.id, null, null, null]);
  const trace = decodeTestTrace(entries);
  assert.deepEqual([trace[0].options.externalAI.reserveMs, trace[0].options.externalAI.reserveScale], [7000, 1]);
  const replay = replayTestMatch(DATA, trace, { BattleClass: FakeBattle });
  t.after(() => replay.dispose());
  assert.deepEqual(replay.publicView(), m.publicView());
  assert.deepEqual(replay.order.map(p => p.privateView()), m.order.map(p => p.privateView()));
  assert.equal(replay.rngBots.state(), m.rngBots.state());
  assert.equal(replay.rngMeta.state(), m.rngMeta.state());
  assert.deepEqual(plans(replay), plans(m));
  assert.equal(replay.externalAI.metrics.fallbacks, m.externalAI.metrics.fallbacks);
  assert.deepEqual([replay.externalAI.transport, replay.externalAI.inflight.size], [null, 0]);
  assert.equal(replay.errorCount, 0);
});

test('§37.72 real IO: a plan past the old half but inside the new budget is accepted; a slower one falls back and the seat readies', async t => {
  const run = async sleep => {
    const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 0, bots: 4, fake: true, timerScale: 0.02, botStrategy: 'external',
      externalAI: { mode: 'plan', transport: 'stdio', seats: [0], timeoutMs: 60000, reserveMs: 100,
        command: [process.execPath, 'test/fixtures/slow-plan-agent.mjs', ...sleep, '--kinds', 'prep'] } });
    t.after(() => h.m.dispose());
    const { m } = h, ai = m.externalAI, ps = m.order[0];
    let job;
    const request = ai.request.bind(ai);
    ai.request = j => { if (j.kind === 'prep') job = j; request(j); };
    h.start();
    assert.ok(await runMatch(m, () => !!job && ps.ready));
    return { m, ai, ps, job };
  };
  // R1 at timerScale 0.02: 1282 ms left at the decision; half was 641 ms, the budget is now 1182 ms
  const fast = await run(['--sleep-ms', '900']);
  assert.equal(fast.job.budget, fast.m.deadline - 100 - (fast.job.deadline - fast.job.budget));
  assert.ok(fast.job.budget > 900 && 900 > (fast.m.deadline - (fast.job.deadline - fast.job.budget)) / 2);
  assert.deepEqual(fast.ai.feedbackFor(fast.ps).acceptedPlan, { id: fast.job.id, round: 1, plan: marker(1) });
  assert.deepEqual([fast.ai.metrics.fallbacks, fast.ai.states.get(fast.ps.playerId).failures], [0, 0]);
  const slow = await run(['--sleep-frac', '3']);
  assert.equal(slow.ai.feedbackFor(slow.ps).acceptedPlan, null);
  assert.deepEqual([slow.ai.metrics.fallbacks, slow.ai.states.get(slow.ps.playerId).failures], [1, 0], 'a slow plan is a soft fallback');
  assert.ok(slow.ps.deployCount > 0, 'the fallback placed a board');
});
