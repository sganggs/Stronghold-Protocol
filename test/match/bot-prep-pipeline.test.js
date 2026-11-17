// Scheduling-contract tests with fake actions: no Match, Battle or gameplay simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrepSteps } from '../../server/match/botPrep.js';

function fixture() {
  const calls = [], job = { pending: true };
  const ps = { alive: true, ready: false, room: false, chess: [], allChess() { return this.chess; } };
  const m = { autoPickPersonalChoice(player, source) { assert.equal(player, ps); calls.push(['personal', source]); } };
  const actions = {};
  for (const name of ['takeOffers', 'sellJunk', 'levelUp', 'spendDown', 'maybeFreeze', 'equipItems', 'resolveTemp', 'freeHandSlot']) {
    actions[name] = (match, player, options) => {
      assert.equal(match, m); assert.equal(player, ps); calls.push([name, options]);
    };
  }
  for (const name of ['buyLoopSteps', 'planSpendSteps', 'arrangeSteps', 'applyPlanSteps']) {
    actions[name] = function* (match, player, ...args) {
      assert.equal(match, m); assert.equal(player, ps); calls.push([name, ...args]);
      yield name;
      if (name === 'arrangeSteps' && args[0]?.final) return job;
    };
  }
  actions.hasHandRoom = player => { assert.equal(player, ps); return player.room; };
  actions.rememberOwned = player => { assert.equal(player, ps); calls.push(['remember']); };
  actions.ready = player => { assert.equal(player, ps); player.ready = true; calls.push(['ready']); };
  return { m, ps, actions, calls, job, hooks: createPrepSteps(actions, { maxRefreshes: 16 }) };
}

function finish(iterator) {
  let step;
  const yielded = [];
  while (!(step = iterator.next()).done) yielded.push(step.value);
  return { yielded, result: step.value };
}

test('prep keeps legacy action order, yield boundaries and delegated job identity', () => {
  const f = fixture();
  const run = finish(f.hooks.prepBegin(f.m, f.ps, { delegate: true }));
  assert.equal(run.result, f.job);
  assert.deepEqual(run.yielded, [undefined, undefined, 'buyLoopSteps', undefined, 'buyLoopSteps',
    'planSpendSteps', undefined, 'arrangeSteps', undefined, 'arrangeSteps']);
  assert.deepEqual(f.calls, [
    ['personal', 'bot'], ['takeOffers', undefined], ['sellJunk', undefined],
    ['buyLoopSteps', { fillOnly: true, maxRefreshes: 0 }], ['takeOffers', undefined], ['levelUp', undefined],
    ['buyLoopSteps', { fillOnly: false, maxRefreshes: 16 }], ['takeOffers', undefined], ['levelUp', { spare: true }],
    ['planSpendSteps'], ['spendDown', undefined], ['maybeFreeze', undefined], ['arrangeSteps'], ['equipItems', undefined],
    ['arrangeSteps', { final: true, defer: true, delegate: true, pooled: false }],
  ]);
});

test('pausing and cancelling at a yield never runs later economy or placement actions', () => {
  const f = fixture(), iterator = f.hooks.prepBegin(f.m, f.ps);
  assert.deepEqual(f.calls, []);
  iterator.next();
  assert.deepEqual(f.calls.map(x => x[0]), ['personal', 'takeOffers']);
  iterator.return();
  assert.deepEqual(f.calls.map(x => x[0]), ['personal', 'takeOffers']);
});

test('finished winning plan is applied before cleanup and Ready; resumed completion is idempotent', () => {
  const f = fixture(), original = new Map(), best = new Map(), chosen = [];
  const iterator = f.hooks.prepEnd(f.m, f.ps, { done: true, best, plans: [original], chosen });
  iterator.next();
  assert.deepEqual(f.calls, [['applyPlanSteps', chosen, best]]);
  finish(iterator);
  assert.deepEqual(f.calls.map(x => x[0]), ['applyPlanSteps', 'resolveTemp', 'freeHandSlot', 'remember', 'personal', 'ready']);
  finish(f.hooks.prepEnd(f.m, f.ps));
  assert.equal(f.calls.filter(x => x[0] === 'ready').length, 1);
});

test('null, pending and unchanged plans clean up without applying a layout', () => {
  const plan = new Map();
  for (const job of [null, { done: false }, { done: true, best: plan, plans: [plan] }]) {
    const f = fixture(); f.ps.room = true;
    finish(f.hooks.prepEnd(f.m, f.ps, job));
    assert.deepEqual(f.calls.map(x => x[0]), ['resolveTemp', 'remember', 'personal', 'ready']);
  }
});

test('§37.71: nothing spends or re-arranges after the rehearsed layout, with or without a plan', () => {
  const f = fixture(); f.ps.room = true;
  f.actions.planSpendSteps = function* () { f.calls.push(['planSpendSteps']); f.ps.chess = [{ uid: 1 }]; yield; };
  finish(createPrepSteps(f.actions, { maxRefreshes: 16 }).prepEnd(f.m, f.ps));
  assert.deepEqual(f.calls.map(x => x[0]), ['resolveTemp', 'remember', 'personal', 'ready']);
});

test('dead and ready seats cause no prep actions', () => {
  for (const state of [{ alive: false }, { ready: true }]) {
    const f = fixture(); Object.assign(f.ps, state);
    assert.equal(finish(f.hooks.prepBegin(f.m, f.ps)).result, null);
    finish(f.hooks.prepEnd(f.m, f.ps));
    assert.deepEqual(f.calls, []);
  }
});

test('action errors propagate to the scheduler; the caller can invoke cleanup separately', () => {
  const f = fixture(), error = new Error('buy failed');
  f.actions.buyLoopSteps = function* () { yield; throw error; };
  const hooks = createPrepSteps(f.actions, { maxRefreshes: 16 });
  assert.throws(() => finish(hooks.prepBegin(f.m, f.ps)), e => e === error);
  finish(hooks.prepEnd(f.m, f.ps));
  assert.equal(f.ps.ready, true);
  assert.equal(f.calls.some(x => x[0] === 'arrangeSteps'), false);
});

test('factory isolates its action map and validates the trusted execution contract', () => {
  const f = fixture();
  f.actions.takeOffers = () => { throw new Error('mutated caller map'); };
  assert.doesNotThrow(() => finish(f.hooks.prepBegin(f.m, f.ps)));
  assert.equal(Object.isFrozen(f.hooks), true);
  assert.throws(() => createPrepSteps({ ...f.actions, typo: () => {} }, { maxRefreshes: 16 }));
  assert.throws(() => createPrepSteps({}, { maxRefreshes: 16 }));
  assert.throws(() => createPrepSteps(f.actions, { maxRefreshes: -1 }));
});
