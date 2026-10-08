import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { PHASE } from '../../shared/constants.js';
import { runHeadless, validateClientResult, RESULT_GRACE_MS } from '../../server/match/fields.js';
import { RealScheduler } from '../../server/match/scheduler.js';
import { compactResult, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { makeMatch } from './harness.js';

const SLICE_MS = 0.000001;

function combat(t, verify = 'all', options = {}) {
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 345, clientCombat: true,
    clients: false, verify, headlessSliceMs: SLICE_MS, timerScale: 0, ...options });
  t.after(() => h.m.dispose());
  h.start();
  assert.ok(h.drive(() => h.m.phase === PHASE.COMBAT));
  return h;
}

function results(h, f) {
  const run = runHeadless(createBattleFromSpec(f.spec, h.m.ds, { recordEvents: false, quiet: true }), { players: f.players });
  const checked = validateClientResult(f.spec, compactResult(run.result), { gd: h.m.gd });
  assert.ok(checked.ok, checked.reason);
  const server = checked.result;
  assert.ok(server.perPlayer.p_0.leaked.length > 0, 'the empty board leaks real enemies');
  const forged = structuredClone(server);
  forged.killed = forged.total;
  Object.assign(forged.perPlayer.p_0, { leaked: [], perfect: true, killed: forged.perPlayer.p_0.total });
  const plausible = validateClientResult(f.spec, forged, { gd: h.m.gd });
  assert.ok(plausible.ok, plausible.reason);
  return { server, forged: plausible.result };
}

function report(h, f, result) {
  assert.deepEqual(h.m.handle('p_0', { t: 'b.result', battleId: f.battleId, result }), { ok: true });
}

function observeSimulation(m, onStep = () => {}) {
  const seen = { battles: 0, steps: 0 };
  const create = m._specBattle.bind(m);
  m._specBattle = (...args) => {
    const battle = create(...args);
    seen.battles++;
    const step = battle.step.bind(battle);
    battle.step = (...stepArgs) => {
      const result = step(...stepArgs);
      seen.steps++;
      onStep(battle, seen);
      return result;
    };
    return battle;
  };
  return seen;
}

test('all verification yields between slices and settles with the synchronous server digest', (t) => {
  const h = combat(t);
  const m = h.m;
  const f = m.fields[0];
  const { server, forged } = results(h, f);
  let between = null;
  const seen = observeSimulation(m, (battle, state) => {
    if (state.steps === 1) h.sched.setTimeout(() => {
      between = { steps: state.steps, finished: battle.finished, checked: m.verifyStats.checked, done: f.done };
    }, 0);
  });
  report(h, f, forged);
  assert.equal(seen.steps, 0, 'report handling schedules simulation without stepping it');
  assert.equal(f.done, false, 'the result awaits verification');
  assert.equal(m.lastResults.has('p_0'), false, 'settlement cannot consume the unverified report');
  assert.ok(h.run(() => m.verifyStats.checked === 1));
  assert.ok(between && between.steps > 0, 'an unrelated timer runs after simulation starts');
  assert.deepEqual([between.finished, between.checked, between.done], [false, 0, false], 'the timer runs between unfinished slices');
  assert.equal(resultDigest(f.result).hash, resultDigest(server).hash, 'sliced verification matches synchronous simulation');
  assert.equal(m.verifyStats.mismatches, 1);
  assert.equal(m.verifyStats.rejected, 0, 'the forgery passes plausibility validation');
  h.runToPhase(PHASE.SETTLE);
  assert.deepEqual(m.lastResults.get('p_0').leaked, server.perPlayer.p_0.leaked);
  assert.equal(m.errorCount, 0);
});

for (const verify of ['all', 'sample']) {
  test(`${verify} verification lets an unrelated real timer run between battle slices`, async (t) => {
    const h = makeMatch({ mode: 'coop', humans: 1, bots: 0, seed: 345, clientCombat: true,
      clients: false, verify, headlessSliceMs: SLICE_MS, timerScale: 0 });
    const m = h.m;
    // Install the real scheduler before start, while the harness has no queued timers.
    const scheduler = new RealScheduler();
    m.sched = scheduler;
    t.after(() => { m.dispose(); scheduler.dispose(); });
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 10000;
      while (!predicate() && Date.now() < deadline) await pause(1);
      assert.ok(predicate(), `timed out in phase ${m.phase}`);
    };
    h.autoHumans().start();
    await waitFor(() => m.phase === PHASE.COMBAT);
    const f = m.fields[0];
    const result = compactResult(runHeadless(createBattleFromSpec(f.spec, m.ds, { recordEvents: false, quiet: true }), { players: f.players }).result);
    let between = null;
    observeSimulation(m, (battle, seen) => {
      if (seen.steps === 1) setTimeout(() => {
        between = { steps: seen.steps, finished: battle.finished, checked: m.verifyStats.checked, done: f.done };
      }, 0);
    });
    report(h, f, result);
    await waitFor(() => between !== null);
    assert.ok(between.steps > 0, 'the timer was scheduled by the first actual battle step');
    assert.deepEqual([between.finished, between.checked, between.done], [false, 0, verify === 'sample'], 'Node executes the timer while verification is unfinished');
    await waitFor(() => m.verifyStats.checked === 1);
    assert.equal(resultDigest(f.result).hash, resultDigest(result).hash);
    assert.equal(m.verifyStats.mismatches, 0);
    assert.equal(m.errorCount, 0);
  });
}

test('duplicate reports during all verification start one simulation and settle once', (t) => {
  const h = combat(t);
  const m = h.m;
  const f = m.fields[0];
  const { forged } = results(h, f);
  const seen = observeSimulation(m);
  let settlements = 0;
  const settle = m.settle.bind(m);
  m.settle = (...args) => { settlements++; return settle(...args); };
  report(h, f, forged);
  assert.equal(f.done, false, 'the duplicate arrives while verification is pending');
  report(h, f, forged);
  assert.ok(h.run(() => seen.steps > 0));
  report(h, f, forged);
  h.runToPhase(PHASE.SETTLE);
  report(h, f, forged);
  assert.equal(seen.battles, 1);
  assert.equal(m.verifyStats.checked, 1);
  assert.equal(m.verifyStats.mismatches, 1);
  assert.equal(settlements, 1);
});

test('sample verification keeps the accepted result and finishes after the phase changes', (t) => {
  // Seed 345 selects the first field for sampling; zero phase delays let settlement overtake verification.
  const h = combat(t, 'sample');
  const m = h.m;
  const f = m.fields[0];
  const { forged } = results(h, f);
  const seen = observeSimulation(m);
  report(h, f, forged);
  assert.equal(f.done, true, 'sampling accepts the report immediately');
  assert.equal(seen.steps, 0);
  h.runToPhase(PHASE.SETTLE);
  assert.equal(m.verifyStats.checked, 0, 'the sampled battle is still running after settlement');
  assert.ok(h.run(() => m.verifyStats.checked === 1));
  assert.equal(m.verifyStats.mismatches, 1);
  assert.equal(resultDigest(f.result).hash, resultDigest(forged).hash);
  assert.deepEqual(m.lastResults.get('p_0').leaked, [], 'sampling never replaces the accepted result');
  assert.ok(h.logs.warn.some((line) => line.includes('client result differs')));
  assert.equal(m.errorCount, 0);
});

for (const event of ['disconnect and reconnect', 'expired deadline']) {
  test(`pending all verification does not restart simulation after ${event}`, (t) => {
    const h = combat(t);
    const m = h.m;
    const f = m.fields[0];
    const { forged } = results(h, f);
    const seen = observeSimulation(m);
    // Leave an already-due deadline callback queued when the result arrives.
    if (event === 'expired deadline') h.sched.t += f.spec.timeLimit / m.gameSpeed * 1000 + RESULT_GRACE_MS + 1;
    report(h, f, forged);
    assert.equal(f.done, false);
    if (event === 'disconnect and reconnect') {
      m.onDisconnect('p_0');
      m.onReconnect('p_0');
      assert.equal(h.lastTo('p_0', 'b.start').authoritative, false, 'reconnect does not request a second result');
    }
    h.runToPhase(PHASE.SETTLE);
    assert.equal(seen.battles, 1);
    assert.equal(m.verifyStats.takeovers, 0, 'a received result no longer needs a client authority');
    assert.equal(m.verifyStats.checked, 1);
    assert.equal(m.verifyStats.mismatches, 1);
  });
}

test('resuming a solo pause does not rearm a result deadline while verification is pending', (t) => {
  const h = combat(t, 'all', { mode: 'solo' });
  const m = h.m;
  const f = m.fields[0];
  const { forged } = results(h, f);
  const seen = observeSimulation(m);
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: true }), { ok: true });
  report(h, f, forged);
  assert.equal(f.done, false);
  assert.deepEqual(m.handle('p_0', { t: 'g.pause', on: false }), { ok: true });
  h.sched.t += f.spec.timeLimit / m.gameSpeed * 1000 + RESULT_GRACE_MS + 1;
  h.runToPhase(PHASE.SETTLE);
  assert.equal(seen.battles, 1);
  assert.equal(m.verifyStats.takeovers, 0);
  assert.equal(m.verifyStats.checked, 1);
});

test('a verification comparison error falls back to a server result and completes the field', (t) => {
  const h = combat(t);
  const m = h.m;
  const f = m.fields[0];
  const { server, forged } = results(h, f);
  const seen = observeSimulation(m);
  const create = m._specBattle.bind(m);
  m._specBattle = (...args) => {
    const battle = create(...args);
    if (seen.battles === 1) {
      const result = battle.result.bind(battle);
      battle.result = () => {
        const out = result();
        Object.defineProperty(out.perPlayer.p_0, 'unitStats', { get() { throw new Error('verification result cannot be normalized'); } });
        return out;
      };
    }
    return battle;
  };
  report(h, f, forged);
  h.runToPhase(PHASE.SETTLE);
  assert.equal(seen.battles, 2, 'the failed comparison is followed by one independent server run');
  assert.equal(f.resultSource, 'server');
  assert.equal(resultDigest(f.result).hash, resultDigest(server).hash, 'fallback never accepts the forged result');
  assert.equal(m.errorCount, 1);
  assert.ok(h.logs.error.some((line) => line.includes('verification result cannot be normalized')));
  assert.deepEqual(h.sched.errors, []);
});

for (const verify of ['all', 'sample']) {
  test(`dispose stops pending ${verify} verification without later completion`, (t) => {
    const h = combat(t, verify, { timerScale: 1 });
    const m = h.m;
    const f = m.fields[0];
    const { forged } = results(h, f);
    const seen = observeSimulation(m);
    report(h, f, forged);
    assert.ok(h.run(() => seen.steps > 0));
    assert.equal(m.verifyStats.checked, 0, 'dispose interrupts an unfinished verification');
    m.dispose();
    const steps = seen.steps;
    h.sched.runAll({ maxSteps: 10000 });
    assert.equal(seen.steps, steps, 'no further battle steps execute');
    assert.equal(m.verifyStats.checked, 0);
    assert.equal(m.verifyStats.mismatches, 0);
    assert.equal(f.done, verify === 'sample');
    assert.equal(m.errorCount, 0);
  });
}
