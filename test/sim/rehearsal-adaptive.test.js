import test from 'node:test';
import assert from 'node:assert/strict';
import { RehearsalRun } from '../../server/sim/rehearsal.js';

function candidate({ ticks = 5, leaks = 0, reason = 'cleared', errors = 0, fail = false } = {}) {
  let n = 0;
  return { finished: false,
    step() { if (fail) throw new Error('step'); if (++n >= ticks) this.finished = true; },
    forceEnd() { this.finished = true; reason = 'timeout'; },
    result() { return { reason, errors, perPlayer: { p: { killed: 10, leaked: Array.from({ length: leaks }, () => ({})) } } }; },
  };
}
function run(options, entries) {
  return new RehearsalRun(entries.map(e => () => candidate(e)), 'p', 20, options);
}
test('adaptive completes initial three then stops only on complete zero', () => {
  const r = run({ stage: 3, tickBudget: 120 }, [{}, {}, {}, { leaks: 2 }]);
  r.run();
  assert.equal(r.index, 3); assert.equal(r.totalTicks, 15); assert.equal(r.stopReason, 'zero');
});
test('timeout, errors, missing result, factory/step failure never certify zero', () => {
  for (const entry of [{ reason: 'timeout' }, { errors: 1 }, { ticks: 100 }, { fail: true }]) {
    const r = run({ stage: 3, tickBudget: 120 }, [entry, entry, entry, { leaks: 1 }]);
    r.run(); assert.equal(r.index, 4); assert.equal(r.zeroComplete, false);
  }
  const r = new RehearsalRun([() => null, () => { throw new Error('build'); }, () => ({ finished: true, result: () => ({}) }), () => candidate({ leaks: 1 })], 'p', 20, { stage: 3 });
  r.run(); assert.equal(r.index, 4); assert.equal(r.zeroComplete, false);
});
test('strict total tick cap, slices and replay counters agree; partial cannot win', () => {
  const entries = [{ leaks: 2 }, { ticks: 30 }, { leaks: 3 }, { leaks: 1 }];
  const a = run({ stage: 3, tickBudget: 12 }, entries), b = run({ stage: 3, tickBudget: 12 }, entries);
  a.run(); let count = 0;
  while (!b.run(() => true, { note(n) { count += n; } })) { /* finite budget */ }
  assert.equal(a.totalTicks, 12); assert.equal(count, 12);
  assert.equal(b.totalTicks, 12); assert.equal(b.score.index, a.score.index);
  assert.equal(a.score.index, 0); assert.equal(a.stopReason, 'budget');
});
test('expansion can select a later improved result; legacy always visits full list', () => {
  const entries = [{ leaks: 5 }, { leaks: 4 }, { leaks: 3 }, { leaks: 1 }, {}];
  const a = run({ stage: 3, tickBudget: 120 }, entries); a.run(); assert.equal(a.score.index, 4);
  const b = run({}, [{}, {}, {}, {}]); b.run(); assert.equal(b.index, 4);
});
