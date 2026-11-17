// test/sim/feedback5-o8-engine.test.js — two additive engine rules the 0.2.0 自选 kits of 夜莺 and 嵯峨 need:
// - a 屏障 of one damage type (buff `shieldType`, attack/effects.js injuryEffects): 夜莺 S2 法术护盾 "能吸收…法术伤害"; a shield
//   without a type absorbs every type (PRTS 术语释义 屏障 "若无特殊说明，屏障可吸收全种类伤害"); older shields first;
// - a profile's own target exclusion (`skipEnemy(e)`, targeting.js canTargetEnemy): 嵯峨 "不攻击重伤单位" — no normal
//   attack on such an enemy, not as a block target, and the DEFAULT trigger condition ignores it.
// Run: node --test test/sim/feedback5-o8-engine.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { canTargetEnemy } from '../../server/sim/targeting.js';

const ENEMIES = { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, mass: 0 }) };
const CHESS = { test_guard_a: chessRec({ id: 'test_guard_a', profession: 'WARRIOR', stats: { maxHp: 10000, atk: 300, def: 0, res: 0 }, skill: { duration: 5, spCost: 1, initSp: 0, trigger: { rule: 'DEFAULT' } } }) };

function field(kits = undefined) {
  const h = makeBattle({
    defs: { enemies: ENEMIES, chess: CHESS }, timeLimit: 600, autoFinish: false, seed: 3, kits,
    hooks: ['damaged', 'skillStart'], captureNoisy: true,
    units: [{ uid: 1, chessId: 'test_guard_a', row: 10, col: 5 }],
  });
  h.step();
  return { h, u: h.unit(1) };
}

test('typed shield: an arts 屏障 absorbs arts damage only; an untyped one every type; the older shield is spent first', () => {
  const { h, u } = field();
  h.b.addBuff(u, { key: 'test:artsBarrier', shield: 100, shieldType: 'arts', duration: 30 });
  for (const type of ['phys', 'true', 'elemental']) {
    const hp = u.hp;
    h.b.dealDamage(null, u, { amount: 10, type, canDodge: false });
    assert.equal(u.hp, hp - 10, `${type} passes the arts barrier`);
  }
  assert.equal(u.findBuff('test:artsBarrier').shield, 100);
  assert.equal(u.s.shield, 100, 'it counts in the shield bar');
  let hp = u.hp;
  h.b.dealDamage(null, u, { amount: 40, type: 'arts', canDodge: false });
  assert.deepEqual([u.hp, u.findBuff('test:artsBarrier').shield], [hp, 60], 'arts absorbed');
  // an untyped shield added later: arts goes to the older (typed) one first, physical to the untyped one
  h.b.addBuff(u, { key: 'test:barrier', shield: 50, duration: 30 });
  h.b.dealDamage(null, u, { amount: 30, type: 'arts', canDodge: false });
  assert.deepEqual([u.findBuff('test:artsBarrier').shield, u.findBuff('test:barrier').shield], [30, 50], 'older first');
  h.b.dealDamage(null, u, { amount: 20, type: 'phys', canDodge: false });
  assert.deepEqual([u.findBuff('test:artsBarrier').shield, u.findBuff('test:barrier').shield], [30, 30], 'physical: the untyped one only');
  hp = u.hp;
  h.b.dealDamage(null, u, { amount: 100, type: 'arts', canDodge: false });
  assert.equal(u.findBuff('test:artsBarrier'), null, 'spent and removed');
  assert.equal(u.findBuff('test:barrier'), null, 'the rest on the untyped one, spent too');
  assert.equal(u.hp, hp - 40, '100 − 30 − 30 reaches HP');
  // a typed hit-negating barrier
  h.b.addBuff(u, { key: 'test:physBlock', shieldHits: 1, shieldType: 'phys', duration: 30 });
  hp = u.hp;
  h.b.dealDamage(null, u, { amount: 25, type: 'arts', canDodge: false });
  assert.equal(u.hp, hp - 25, 'arts passes a physical block');
  h.b.dealDamage(null, u, { amount: 25, type: 'phys', canDodge: false });
  assert.equal(u.hp, hp - 25, 'the physical hit is negated');
  assert.equal(u.findBuff('test:physBlock'), null);
  checkInvariants(h.b);
});

test('profile skipEnemy: the unit never selects such an enemy — no attack, no block target, no DEFAULT trigger — and other enemies stay its targets', () => {
  const skip = new Set();
  const { h, u } = field({ test_guard_a: () => ({ skill: { kind: 'duration' }, trait: { skipEnemy: (e) => skip.has(e) } }) });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  skip.add(e);
  assert.equal(canTargetEnemy(u, e, u.profile), false);
  assert.equal(canTargetEnemy(u, e, { canHitFly: false }), true, 'another profile still may');
  h.run(3);
  assert.equal(h.hooksOf('damaged').filter((c) => c.source === u).length, 0, 'never attacked');
  assert.equal(u.skill.activations, 0, 'DEFAULT: no target');
  // blocked: still not a target
  const w = h.spawn('enemy_dummy', { pos: [10, 5] });
  skip.add(w);
  h.run(1);
  assert.ok(u.blocking.includes(w), 'she blocks it');
  assert.equal(h.b.blockedTargets(u, u.profile).length, 0, 'not a block target');
  assert.equal(h.hooksOf('damaged').filter((c) => c.source === u).length, 0);
  // an ordinary enemy is attacked
  const o = h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.target === o), 3), 'attacks the other one');
  assert.ok(h.hooksOf('damaged').filter((c) => c.source === u).every((c) => c.target === o), 'only that one');
  assert.ok(u.skill.activations >= 1, 'DEFAULT fires for it');
  checkInvariants(h.b);
});
