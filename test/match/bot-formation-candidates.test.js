// Production candidate adapter with synthetic records and cached geometry; no Match/Battle simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutPlan, contactCandidatePlansSteps, createContactPrepSteps } from '../../server/match/bot.js';

function fixture() {
  const records = {
    front: { position: 'MELEE', attackKind: 'normal', dmgType: 'phys', stats: { atk: 20, blockCnt: 2 }, rangeGrid: [[0, 0]] },
    damage: { position: 'RANGED', attackKind: 'normal', dmgType: 'phys', stats: { atk: 50, blockCnt: 0 }, rangeGrid: [[0, 0], [0, 1]] },
  };
  const model = { key: '1|unknown|wave|', routes: [{ fly: false, n: 3, tiles: ['9,2', '9,3', '9,4', '9,5', '9,6'] }],
    armor: [], dps: new Map() };
  const m = { round: 1, stageId: 'unknown', wave: { templateId: 'wave' }, _botPath: model, botRehearsal: 3,
    rngBots() { throw new Error('Candidate repair must not draw RNG'); },
    gd: { bossRound: 14, hiddenRound: 15, chess: id => records[id] } };
  const map = new Map([['9,3', 'melee'], ['9,4', 'melee'], ['10,6', 'ranged']]);
  const ps = { gd: m.gd, deployMap: () => map };
  const chosen = [{ uid: 1, id: 'front', kind: 'chess' }, { uid: 2, id: 'damage', kind: 'chess' }];
  const plans = ['RIGHT', 'UP', 'DOWN', 'LEFT'].map(dir => {
    const plan = new LayoutPlan([[1, '9,4'], [2, '10,6']]);
    plan.dirs.set(2, dir); return plan;
  });
  return { m, ps, chosen, plans, map };
}
function finish(iterator) { let step; while (!(step = iterator.next()).done) { /* geometry only */ } return step.value; }

test('unknown map repair uses the final budget slot and retains the default candidate prefix', () => {
  const f = fixture(), before = f.plans.map(p => [...p]);
  const plans = finish(contactCandidatePlansSteps(f.m, f.ps, f.chosen, f.plans));
  assert.equal(plans.length, 3);
  assert.equal(plans[0], f.plans[0]); assert.equal(plans[1], f.plans[1]);
  assert.equal(plans[2].get(2), '9,3');
  assert.equal(plans[2].dirOf(2), 'RIGHT');
  assert.deepEqual(f.plans.map(p => [...p]), before);
  for (const plan of plans) {
    assert.equal(new Set(plan.values()).size, plan.size);
    assert.ok([...plan.values()].every(k => f.map.has(k)));
  }
});

test('one candidate, disabled rehearsal, boss, hidden and missing routes retain original plans', () => {
  for (const change of [f => { f.m.botRehearsal = 1; }, f => { f.m.botRehearsal = 0; },
    f => { f.m.round = 14; }, f => { f.m.round = 15; }, f => { f.m.wave = null; },
    f => { f.m._botPath.routes = []; }]) {
    const f = fixture(); change(f);
    assert.equal(finish(contactCandidatePlansSteps(f.m, f.ps, f.chosen, f.plans)), f.plans);
  }
});

test('already-present repairs and incomplete records keep the original candidates', () => {
  const f = fixture();
  const result = finish(contactCandidatePlansSteps(f.m, f.ps, f.chosen, f.plans));
  f.plans.push(result.at(-1));
  assert.equal(finish(contactCandidatePlansSteps(f.m, f.ps, f.chosen, f.plans)), f.plans);
  f.chosen[1].id = 'missing';
  assert.equal(finish(contactCandidatePlansSteps(f.m, f.ps, f.chosen, f.plans)), f.plans);
});

test('opt-in prep factory returns immutable synchronous hook definitions', () => {
  const hooks = createContactPrepSteps();
  assert.equal(Object.isFrozen(hooks), true);
  const begin = hooks.prepBegin({}, { alive: false });
  assert.deepEqual(begin.next(), { done: true, value: null });
});
