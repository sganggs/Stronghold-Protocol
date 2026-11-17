// test/sim/feedback5-hpdamage-hook.test.js — the `hpDamage` hook of the settlement (attack/hit.js) (0.2.0, the 自选 operator kits):
// what passed the shields of a damage instance, before the HP loss; a handler may only lower it — the 伤判效果 that act
// after a barrier (煌's 紧急除颤 HP floor, 左乐's 庇护 re-applied behind his 行险 barrier). A 流失 (Battle.loseHp) never
// reaches it, a hit the shields absorb whole neither. docs/SIM.md §4 / §5.
// Run: node --test test/sim/feedback5-hpdamage-hook.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function arena() {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0, mass: 0 }) } },
    units: [{ uid: 1, chessId: 'chess_char_1_02_a', row: 10, col: 5 }], timeLimit: 60, autoFinish: false,
  });
  h.step();
  const u = h.unit(1), e = h.spawn('enemy_dummy', { pos: [10, 8] });
  return { h, u, e };
}

test('hpDamage: after the shields, before the HP loss — a handler lowers what reaches the HP; a raise is ignored', () => {
  const { h, u, e } = arena();
  const seen = [];
  const off = h.b.on('hpDamage', (c) => { if (c.target === u) { seen.push([c.amount, c.source, c.dmg.type]); c.amount = Math.min(c.amount, 100); } });
  h.b.addBuff(u, { key: 'test:shield', shield: 300 });
  const hp = u.hp;
  const dealt = h.b.dealDamage(e, u, { amount: 1000, type: 'true' });
  assert.deepEqual(seen, [[700, e, 'true']], 'the 300 shield first, then the hook sees the 700 that passed');
  assert.equal(u.findBuff('test:shield'), null, 'the shield was spent');
  assert.deepEqual([hp - u.hp, dealt], [100, 100], 'HP loss and the returned amount follow the lowered value');
  h.b.off(off);
  h.b.on('hpDamage', (c) => { if (c.target === u) c.amount = 1e9; });
  const hp2 = u.hp;
  h.b.dealDamage(e, u, { amount: 50, type: 'true' });
  assert.equal(hp2 - u.hp, 50, 'a raise is ignored');
  checkInvariants(h.b);
});

test('hpDamage: no call for a 流失 nor for a hit the shields take whole; without a handler nothing changes', () => {
  const { h, u, e } = arena();
  let n = 0;
  h.b.on('hpDamage', (c) => { if (c.target === u) n++; });
  h.b.loseHp(u, 100, { source: e });
  assert.equal(n, 0, 'a 流失 skips it (no 伤判效果)');
  h.b.addBuff(u, { key: 'test:shield', shield: 500 });
  h.b.dealDamage(e, u, { amount: 200, type: 'true' });
  assert.equal(n, 0, 'absorbed whole: nothing reaches the HP');
  h.b.dealDamage(e, u, { amount: 400, type: 'true' });
  assert.equal(n, 1, 'the 100 that passed');
  const r = arena();
  const hp = r.u.hp;
  r.h.b.dealDamage(r.e, r.u, { amount: 250, type: 'true' });
  assert.equal(hp - r.u.hp, 250, 'no handler: the plain pipeline');
  checkInvariants(h.b);
});
