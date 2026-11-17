// Pure geometry, no game or battle simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formationRelations, preservesFormation, refineFormationSteps } from '../../server/match/botFormationCandidates.js';

const unit = (uid, key, cover, extra = {}) => ({ uid, key, kind: 'chess', dps: 10, ground: true, air: false,
  block: 0, heal: false, rec: { attackKind: 'normal' }, cover: new Set(cover), ...extra });
const route = (tiles, fly = false) => ({ tiles, fly, n: 1 });
function finish(iterator) { let s; while (!(s = iterator.next()).done) { /* pure search slices */ } return s.value; }
function sample() {
  const model = { routes: [route(['0,0', '0,1', '0,2', '0,3'])] };
  const blocker = unit(1, '0,2', ['0,2'], { block: 2 });
  const idle = unit(2, '1,3', ['0,3']);
  const option = unit(2, '1,1', ['0,1', '0,2']);
  return { model, units: [blocker, idle], option };
}

test('repairs idle damage using legal candidates while preserving the input layout', () => {
  const f = sample(), snapshot = structuredClone(f.units);
  const after = finish(refineFormationSteps(f.model, f.units, u => u.uid === 2 ? [f.option] : []));
  assert.equal(after[1], f.option);
  assert.deepEqual(f.units, snapshot);
  assert.equal(formationRelations(f.model, after).contacts[0][0], true);
  assert.deepEqual(formationRelations(f.model, after).active, [true, true]);
});

test('a second entrance cannot lose its existing fire support to repair the first', () => {
  const model = { routes: [route(['a', 'b']), route(['x', 'b'])] };
  const units = [unit(1, 'b', ['b'], { block: 2 }), unit(2, 'side', ['x', 'b'])];
  const before = formationRelations(model, units);
  const after = formationRelations(model, [units[0], unit(2, 'side', ['a', 'b'])]);
  assert.equal(before.contacts[0][1], true);
  assert.equal(after.contacts[0][0], true);
  assert.equal(preservesFormation(before, after), false);
});

test('preserves existing air coverage and healing', () => {
  const f = sample();
  f.model.routes.push(route(['sky'], true));
  f.units[1] = unit(2, '1,3', ['sky'], { air: true });
  assert.equal(finish(refineFormationSteps(f.model, f.units, u => u.uid === 2 ? [f.option] : [])), f.units);
  const medic = unit(3, '2,3', ['1,3'], { heal: true, dps: 0 });
  const ground = sample(); ground.units.push(medic);
  assert.equal(finish(refineFormationSteps(ground.model, ground.units, u => u.uid === 2 ? [ground.option] : [])), ground.units);
});

test('occupied tiles, foreign unit options, pure medics and tokens are excluded', () => {
  const f = sample();
  assert.equal(finish(refineFormationSteps(f.model, f.units, u => u.uid === 2
    ? [{ ...f.option, key: f.units[0].key }, { ...f.option, uid: 99 }] : [])), f.units);
  for (const extra of [{ heal: true }, { kind: 'token' }]) {
    const u = { ...f.units[1], ...extra };
    const called = [];
    finish(refineFormationSteps(f.model, [f.units[0], u], value => { called.push(value.uid); return []; }));
    assert.equal(called.includes(2), false);
  }
});

test('damage-dealing medic is eligible based on attack behavior', () => {
  const f = sample(); f.units[1].rec = { attackKind: 'normal', profession: 'MEDIC' };
  assert.equal(finish(refineFormationSteps(f.model, f.units, u => u.uid === 2 ? [f.option] : []))[1], f.option);
});

test('route translation and reflection produce the corresponding repaired layout', () => {
  for (const transform of [([r, c]) => [r + 7, c + 10], ([r, c]) => [c, -r]]) {
    const f = sample(), key = k => transform(k.split(',').map(Number)).join(',');
    const move = u => ({ ...u, key: key(u.key), cover: new Set([...u.cover].map(key)) });
    const model = { stageId: 'unseen-map', routes: f.model.routes.map(r => ({ ...r, tiles: r.tiles.map(key) })) };
    const option = move(f.option);
    const result = finish(refineFormationSteps(model, f.units.map(move), u => u.uid === 2 ? [option] : []));
    assert.equal(result[1].key, key(f.option.key));
  }
});

test('missing routes, equal candidates and zero passes return the original layout', () => {
  const f = sample();
  assert.equal(finish(refineFormationSteps({}, f.units, () => [])), f.units);
  assert.equal(finish(refineFormationSteps(f.model, f.units, u => [{ ...u }])), f.units);
  assert.equal(finish(refineFormationSteps(f.model, f.units, () => [f.option], { passes: 0 })), f.units);
  assert.throws(() => finish(refineFormationSteps(f.model, f.units, () => [], { passes: 3 })));
});
