// The shared bot layout rehearsal run (server/sim/rehearsal.js): the candidate comparison the server and the host's
// browser both use (DESIGN §14). It is pure ESM with no clock of its own — the caller passes the wall-clock slice —, so
// this file covers the scoring order (fewest counted leaks, then most kills, then the earlier candidate), the early stop,
// the tick cap, the candidate boundaries a slice stops on and the candidates that cannot be built. The delegation that
// hands one such run to a browser is test/match/rehearsal-delegate.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RehearsalRun, rehearsalLimits } from '../../server/sim/rehearsal.js';

test('the shared comparison scores leaks, then kills, then the earlier candidate', () => {
  const res = (n, killed) => ({ perPlayer: { p: { killed, total: 9, leaked: Array.from({ length: n }, () => ({ enemyKey: 'e', counted: true })) } } });
  const battle = (r) => () => ({ finished: true, result: () => r, forceEnd() {}, step() {} });
  const run = new RehearsalRun([battle(res(2, 5)), battle(res(1, 1)), battle(res(1, 1))], 'p', 10);
  run.run();
  assert.equal(run.score.index, 1, 'the fewest leaks win, the earlier candidate wins the tie');
  assert.equal(run.score.leaks, 1);
  const other = new RehearsalRun([battle({ perPlayer: { p: { killed: 1, total: 3, leaked: [{ enemyKey: 'e', counted: false }] } } })], 'p', 10);
  other.run();
  assert.equal(other.score.leaks, 0, 'a leak that does not count is no leak');
  assert.equal(other.score.score, 1);
  // a candidate that cannot be built (the factory returns nothing, like the stand-in the server never scores either) is
  // skipped, not picked
  const skipped = new RehearsalRun([() => null, battle(res(0, 4))], 'p', 10);
  skipped.run();
  assert.equal(skipped.score.index, 1);
  // a candidate is only built when the slice reaches it — the construction is sliced work
  const built = [];
  const stepping = (r) => ({ finished: false, result: () => r, forceEnd() {}, step() {} });
  const factory = (i) => () => { built.push(i); return stepping(res(0, 5 - i)); };
  const lazy = new RehearsalRun([factory(0), factory(1), factory(2)], 'p', 1);
  assert.equal(lazy.run(() => true), false, 'the budget ran out at the first candidate boundary');
  assert.deepEqual(built, [0], 'nothing beyond the stopped slice was built');
  lazy.run();
  assert.deepEqual(built, [0, 1, 2]);
  assert.equal(lazy.score.index, 0, 'the most kills win');
  // a factory that throws is reported and skipped like one that returns nothing
  const errors = [];
  const failing = new RehearsalRun([() => { throw new Error('no battle'); }, battle(res(0, 3))], 'p', 10, { onError: (e, i) => errors.push([e.message, i]) });
  failing.run();
  assert.deepEqual(errors, [['no battle', 0]]);
  assert.equal(failing.score.index, 1);
  // a candidate a slice stops in the middle of keeps its battle: the factory runs once and the second slice scores it
  const built2 = [];
  const across = new RehearsalRun([() => { built2.push(0); return stepping(res(0, 9)); }], 'p', 8);
  assert.equal(across.run(() => true), false, 'the budget stopped the slice after 4 of the 8 ticks');
  assert.equal(across.run(), true);
  assert.deepEqual(built2, [0], 'the candidate was built once, not once per slice');
  assert.equal(across.score.leaks, 0, 'the candidate was scored by the slice that finished it');
  assert.equal(across.score.score, 9);
});

test('a candidate the slice never steps cannot run the whole list past the caller\'s budget', () => {
  const res = (n, killed) => ({ perPlayer: { p: { killed, total: 9, leaked: Array.from({ length: n }, () => ({ enemyKey: 'e', counted: true })) } } });
  const battle = (r) => () => ({ finished: true, result: () => r, forceEnd() {}, step() {} });
  // three candidates that end without a single tick (finished on arrival): no tick, but each one is consumed work, so
  // the budget is asked at the candidate boundary all the same
  let checks = 0;
  const done = new RehearsalRun([battle(res(0, 3)), battle(res(0, 2)), battle(res(0, 1))], 'p', 10);
  assert.equal(done.run(() => { checks++; return true; }), false, 'the slice stops at the first candidate boundary');
  assert.equal(checks, 1, 'the budget was consulted once, though not one tick was stepped');
  assert.equal(done.score.index, 0, 'the candidate the slice did consume counts');
  assert.equal(done.run(() => false), true);
  // the same for candidates that cannot be built at all (nothing, or a factory that threw): they are skipped, the slice
  // still ends on the budget instead of building the rest of the list
  const errors = [];
  let checks2 = 0;
  const unbuilt = new RehearsalRun([() => null, () => { throw new Error('no battle'); }, battle(res(1, 1))], 'p', 10, { onError: (e, i) => errors.push(i) });
  assert.equal(unbuilt.run(() => { checks2++; return true; }), false);
  assert.equal(checks2, 1);
  assert.deepEqual(errors, [], 'nothing of the third candidate ran yet');
  assert.equal(unbuilt.run(() => false), true);
  assert.deepEqual(errors, [1]);
  assert.equal(unbuilt.score.index, 2);
});

test('limits: a stage stops once a finished candidate is leak-free; a tick budget stops before the next candidate', () => {
  const res = (n, killed) => ({ perPlayer: { p: { killed, total: 9, leaked: Array.from({ length: n }, () => ({ enemyKey: 'e', counted: true })) } } });
  const built = [];
  const finished = (i, r) => () => { built.push(i); return { finished: true, result: () => r, forceEnd() {}, step() {} }; };
  // the first two candidates run; the second is leak-free, so the rest never build
  const clean = new RehearsalRun([finished(0, res(2, 1)), finished(1, res(0, 9)), finished(2, res(0, 9))], 'p', 10, { stage: 2 });
  assert.equal(clean.run(), true);
  assert.deepEqual(built, [0, 1]);
  assert.equal(clean.score.index, 1);
  // while every finished candidate leaks, the stage lets the rest run and the best of all of them wins
  built.length = 0;
  const leaky = new RehearsalRun([finished(0, res(3, 1)), finished(1, res(2, 1)), finished(2, res(1, 1))], 'p', 10, { stage: 1 });
  leaky.run();
  assert.deepEqual(built, [0, 1, 2]);
  assert.equal(leaky.score.index, 2);
  // a stage never stops before its first candidates, even when the first one is already leak-free
  built.length = 0;
  const early = new RehearsalRun([finished(0, res(0, 1)), finished(1, res(0, 5))], 'p', 10, { stage: 2 });
  early.run();
  assert.deepEqual(built, [0, 1]);
  assert.equal(early.score.index, 1, 'the stage candidates are compared as before (most kills)');
  // the tick budget: a started candidate runs to its cap, the next one does not start
  const steps = [];
  const ticking = (i) => () => ({ finished: false, result: () => res(1, i), forceEnd() {}, step() { steps.push(i); } });
  const budget = new RehearsalRun([ticking(0), ticking(1), ticking(2)], 'p', 4, { tickBudget: 6 });
  assert.equal(budget.run(), true);
  assert.deepEqual(steps, [0, 0, 0, 0, 1, 1, 1, 1], 'candidate 1 started under the budget and finished its cap');
  assert.equal(budget.spent, 8);
  assert.equal(budget.score.index, 1);
  // a frame field is untrusted: anything but a positive integer is "off"
  assert.deepEqual(rehearsalLimits({ stage: -1, tickBudget: 'x' }), { stage: 0, tickBudget: 0 });
  assert.deepEqual(rehearsalLimits({ stage: 2.5, tickBudget: Infinity }), { stage: 0, tickBudget: 0 });
  assert.deepEqual(rehearsalLimits(undefined), { stage: 0, tickBudget: 0 });
  assert.deepEqual(rehearsalLimits({ stage: 3, tickBudget: 900 }), { stage: 3, tickBudget: 900 });
});
