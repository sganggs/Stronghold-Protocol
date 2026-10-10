// Player-confirmed: 远牙's granted trait gains on body / substitute switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const bond = (active = true, layers = 0) => ({ count: active ? 3 : 0, active, tier: active ? 1 : 0, layers });
const gains = (h) => h.result().perPlayer.p1.layerGains;
const enter = (h, u) => {
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.deployed && u.trait.doll, 'the lethal body hit switches to a substitute');
};
const leave = (h, u) => {
  h.b.removeBuff(u, 'trait:substitute');
  assert.ok(u.alive && u.deployed && !u.trait.doll, 'ending the substitute returns to the body');
};

for (const sfx of ['a', 'b']) {
  for (const id of [`chess_char_2_11_${sfx}`, `chess_char_5_13_${sfx}`]) {
    test(`远牙 + ${id}: both swaps gain 精准/卡西米尔, with the original battle cap`, () => {
      const per = sfx === 'a' ? 4 : 8;
      const cap = per * 6;
      const h = makeBattle({
        units: [{ chessId: `chess_char_4_20_${sfx}`, row: 10, col: 3 }, { chessId: id, row: 10, col: 8 }],
        bonds: { kazimierzShip: bond(), preciShip: bond() },
        autoFinish: false, timeLimit: 300, hooks: ['dollSwap'],
      });
      h.step();
      const u = h.unit(id);
      assert.deepEqual(gains(h), { kazimierzShip: per, preciShip: per }, 'initial deployment');
      enter(h, u);
      assert.deepEqual(gains(h), { kazimierzShip: per * 2, preciShip: per * 2 }, 'gain at the switch event, before another tick');
      h.runUntil(() => !u.trait.doll, 30);
      assert.deepEqual(gains(h), { kazimierzShip: per * 3, preciShip: per * 3 }, 'natural return to body');
      h.run(2); // finish the return animation before the next lethal hit
      for (let i = 0; i < 4; i++) {
        enter(h, u);
        leave(h, u); // two real swaps between ticks must both count
        h.run(2);
      }
      assert.deepEqual(gains(h), { kazimierzShip: cap, preciShip: cap }, 'swaps share the initial deployment cap');
      assert.equal(h.hooksOf('dollSwap').filter((c) => c.unit === u).length, 10);
      h.b.retreat(u, { reason: 'test' });
      h.b.redeploy(u, { free: true });
      assert.deepEqual(gains(h), { kazimierzShip: cap, preciShip: cap }, 'a later real deployment does not reset the cap');
      checkInvariants(h.b);
    });
  }
}

test('远牙 grants once to a dollkeeper even with duplicate holders; inactive 精准 does not gain or consume its cap', () => {
  const id = 'chess_char_2_11_a';
  const h = makeBattle({
    units: [{ chessId: 'chess_char_4_20_a', row: 10, col: 3 }, { chessId: 'chess_char_4_20_a', row: 10, col: 5 }, { chessId: id, row: 10, col: 8 }],
    bonds: { kazimierzShip: bond(), preciShip: bond(false) }, autoFinish: false,
  });
  h.step();
  const u = h.unit(id);
  enter(h, u);
  assert.deepEqual(gains(h), { kazimierzShip: 8 }, 'one granted trait, no inactive bond');
  Object.assign(h.b.getPlayer('p1').bonds.preciShip, bond());
  leave(h, u);
  assert.deepEqual(gains(h), { kazimierzShip: 12, preciShip: 4 });
  checkInvariants(h.b);
});

test('归鲨 S2 ending triggers the trait granted by 远牙', () => {
  const id = 'chess_char_5_13_a';
  const h = makeBattle({
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, atk: 0, speed: 0 }) } },
    enemies: [{ key: 'dummy', pos: [10, 9] }],
    units: [{ chessId: 'chess_char_4_20_a', row: 10, col: 3 }, { chessId: id, row: 10, col: 8 }],
    bonds: { kazimierzShip: bond(), preciShip: bond() }, autoFinish: false,
  });
  h.step();
  const u = h.unit(id);
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 3));
  assert.ok(h.runUntil(() => u.trait.doll, 30), 'S2 switches form when it ends');
  assert.deepEqual(gains(h), { kazimierzShip: 8, preciShip: 8 });
  checkInvariants(h.b);
});

test('other deployment layer traits and timed attribute windows keep their existing triggers', () => {
  const h = makeBattle({
    defs: { chess: { doll: {
      ...chessRec({ id: 'doll', profession: 'SPECIAL', subProfessionId: 'dollkeeper', bonds: ['raidShip'], skill: null }),
      garrisonIds: ['garrison_106_a', 'garrison_107_a', 'garrison_143_a', 'garrison_155_a', 'garrison_115_a'],
    } } },
    units: [{ chessId: 'doll', row: 10, col: 8 }], bonds: { raidShip: bond(), kazimierzShip: bond(true, 10) },
    autoFinish: false,
  });
  h.step();
  const u = h.unit('doll');
  const initial = { ...gains(h) };
  h.run(5);
  const remaining = u.findBuff('gar:garrison_115_a').timeLeft;
  enter(h, u);
  assert.equal(u.findBuff('gar:garrison_115_a').timeLeft, remaining, 'switch does not refresh the window');
  h.run(2);
  const beforeReturn = u.findBuff('gar:garrison_115_a').timeLeft;
  leave(h, u);
  assert.equal(u.findBuff('gar:garrison_115_a').timeLeft, beforeReturn);
  assert.deepEqual(gains(h), initial, 'no additional layers from other deployment traits');
  checkInvariants(h.b);
});
