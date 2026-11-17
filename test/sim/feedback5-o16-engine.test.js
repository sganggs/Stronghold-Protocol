// test/sim/feedback5-o16-engine.test.js — two additive engine rules the 0.2.0 自选 kits of 机械师 and 凯尔希 need:
// - a 屏障 limited to several damage types (buff `shieldType` as a list, attack/effects.js injuryEffects): 机械师's 屏障 absorb
//   physical and arts damage only (buff_template_data mcnist_t_2 / mcnist_s_2_shield: BlockDamage PHYSICAL_AND_MAGICAL);
// - a healer that heals an ally through its 禁疗 (profile `healThrough(healer, ally)`, attack/heal.js heal and
//   Battle.injuredAlliesInKeys): 凯尔希 on her Mon3tr (PRTS Mon3tr(凯尔希的召唤物) "持有禁疗（可被凯尔希…无视）") — her heal
//   selection takes it and her heal reaches it; any other healer still skips it, a profile's `noHeal` (无法被友方治疗)
//   still stops her.
// Run: node --test test/sim/feedback5-o16-engine.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const ENEMIES = { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, mass: 0 }) };
const CHESS = {
  test_guard_a: chessRec({ id: 'test_guard_a', profession: 'WARRIOR', stats: { maxHp: 10000, atk: 300, def: 0, res: 0 } }),
  test_medic_a: chessRec({ id: 'test_medic_a', profession: 'MEDIC', subProf: 'physician', stats: { maxHp: 2000, atk: 100, def: 0, res: 0 }, rangeGrid: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [-1, 0], [-1, 1]] }),
};

test('a 屏障 of several types (shieldType [\'phys\', \'arts\']) absorbs those, not true damage; older shields first as ever', () => {
  const h = makeBattle({ defs: { enemies: ENEMIES, chess: CHESS }, timeLimit: 600, autoFinish: false, seed: 3, units: [{ uid: 1, chessId: 'test_guard_a', row: 10, col: 5 }] });
  h.step();
  const u = h.unit(1);
  h.b.addBuff(u, { key: 'test:pa', shield: 100, shieldType: ['phys', 'arts'], duration: 30 });
  let hp = u.hp;
  for (const type of ['true', 'elemental']) {
    h.b.dealDamage(null, u, { amount: 10, type, canDodge: false });
    hp -= 10;
    assert.equal(u.hp, hp, `${type} passes it`);
  }
  assert.equal(u.findBuff('test:pa').shield, 100);
  h.b.dealDamage(null, u, { amount: 30, type: 'phys', canDodge: false });
  h.b.dealDamage(null, u, { amount: 30, type: 'arts', canDodge: false });
  assert.deepEqual([u.hp, u.findBuff('test:pa').shield], [hp, 40], 'physical and arts absorbed');
  h.b.dealDamage(null, u, { amount: 50, type: 'arts', canDodge: false });
  assert.deepEqual([u.hp, u.findBuff('test:pa')], [hp - 10, null], 'spent: the rest reaches HP');
  // a single type still works as before
  h.b.addBuff(u, { key: 'test:a', shield: 20, shieldType: 'arts', duration: 30 });
  hp = u.hp;
  h.b.dealDamage(null, u, { amount: 10, type: 'phys', canDodge: false });
  assert.equal(u.hp, hp - 10);
  checkInvariants(h.b);
});

test('profile healThrough: the healer selects and heals the ally it names through its 禁疗 (noHeal / healFree); others do not, and a profile noHeal still stops it', () => {
  const marked = new Set();
  const kits = { test_medic_a: () => ({ trait: { healThrough: (healer, a) => marked.has(a) } }) };
  const h = makeBattle({
    defs: { enemies: ENEMIES, chess: CHESS }, timeLimit: 600, autoFinish: false, seed: 3, kits, hooks: ['heal'], captureNoisy: true,
    units: [{ uid: 1, chessId: 'test_medic_a', row: 10, col: 3 }, { uid: 2, chessId: 'test_guard_a', row: 10, col: 4 }, { uid: 3, chessId: 'test_guard_a', row: 11, col: 4 }],
  });
  h.step();
  const medic = h.unit(1), a = h.unit(2), b = h.unit(3);
  h.b.addBuff(a, { key: 'test:healFree', flags: { noHeal: true }, persist: true });
  h.b.addBuff(b, { key: 'test:healFree', flags: { noHeal: true }, persist: true });
  a.hp = 1000; b.hp = 1000;
  assert.deepEqual(h.b.injuredAlliesInKeys(medic.rangeKeys, medic), [], '禁疗: no heal target');
  assert.equal(h.b.heal(medic, a, 100), 0, 'no heal');
  marked.add(a);
  assert.deepEqual(h.b.injuredAlliesInKeys(medic.rangeKeys, medic), [a], 'the named ally is a heal target');
  assert.equal(h.b.heal(medic, a, 100), 100, 'and is healed');
  assert.equal(h.b.heal(medic, b, 100), 0, 'the other 禁疗 ally is not');
  assert.ok(h.runUntil(() => h.hooksOf('heal').some((c) => c.source === medic && c.target === a), 5), 'its attack heals it');
  assert.ok(!h.hooksOf('heal').some((c) => c.source === medic && c.target === b), 'never the other');
  // another unit's heal is still stopped; healFree too passes for the named one; a profile noHeal does not
  assert.equal(h.b.heal(b, a, 100), 0, 'another healer: 禁疗 holds');
  h.b.addBuff(a, { key: 'test:hf2', flags: { healFree: true }, persist: true });
  assert.equal(h.b.heal(medic, a, 50), 50, 'healFree passes for it');
  a.profile.noHeal = true;
  assert.equal(h.b.heal(medic, a, 50), 0, 'a profile noHeal (无法被友方治疗) stops it');
  checkInvariants(h.b);
});
