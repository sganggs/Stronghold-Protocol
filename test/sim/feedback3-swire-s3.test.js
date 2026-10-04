// test/sim/feedback3-swire-s3.test.js — 琳琅诗怀雅 S3 千金一掷. Owner 2026-10-04: at the purse cap of 10
// she shoots once a ground enemy is in the skill attack range (the 1-tile range). Below the cap, or with
// the enemy only further ahead, the skill stays open and the coins stay. A manual close still spends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };
const ID = 'chess_char_3_04_a';
const foe = enemyRec({ key: 'e_sw', hp: 1e9, atk: 0, speed: 0, def: 0, res: 0, mass: 1 });

function battle(pos) {
  return makeBattle({
    defs: { enemies: { e_sw: foe } },
    units: [{ chessId: ID, row: 10, col: 5, skillIndex: 2 }],
    enemies: pos ? [{ key: 'e_sw', pos }] : [],
    hooks: ['damaged', 'skillEnd'], autoFinish: false, timeLimit: 30,
  });
}
const arm = (h) => {
  h.step();
  const u = h.unit(ID);
  assert.equal(u.skill.id, 'skchr_swire2_3');
  assert.ok(u.skill.active || u.skill.activate('test', { free: true }));
  return u;
};

test('琳琅诗怀雅 S3 shoots at the cap only once an enemy is in the skill attack range', REAL, () => {
  const under = battle([10, 6]);
  const u9 = arm(under);
  u9.mem.coins = 9;
  under.run(2);
  assert.equal(u9.skill.active, true, '9 coins do not close it');
  assert.equal(u9.mem.coins, 9);

  const far = battle([10, 7]); // two tiles ahead: outside the 1-tile attack range, inside nothing she swings at
  const uf = arm(far);
  uf.mem.coins = 10;
  far.run(0.5);
  assert.equal(uf.skill.active, true, 'an enemy outside the attack range does not make her shoot');
  assert.equal(uf.mem.coins, 10);

  const none = battle(null);
  const un = arm(none);
  un.mem.coins = 10;
  none.run(0.5);
  assert.equal(un.skill.active, true, 'nobody in range: the purse stays');
  assert.equal(un.mem.coins, 10);

  const h = battle([10, 6]); // one tile ahead: the skill attack range
  const u = arm(h);
  const e = h.enemies()[0];
  const hp0 = e.hp;
  u.mem.coins = 10;
  h.run(0.2);
  assert.equal(u.skill.active, false, 'the enemy in the attack range is shot');
  assert.equal(u.mem.coins, 0, 'every coin is spent');
  assert.ok(e.hp < hp0, 'the coins hit that enemy');
  assert.equal(h.b.errors.length, 0);
  checkInvariants(h.b);
});

test('琳琅诗怀雅 S3: a manual close below the cap still spends', REAL, () => {
  const h = battle(null);
  const u = arm(h);
  u.mem.coins = 4;
  assert.doesNotThrow(() => u.skill.end('manual'));
  assert.equal(u.skill.active, false);
  assert.equal(u.mem.coins, 0);
  assert.equal(h.hooksOf('damaged').length, 0);
  checkInvariants(h.b);
});
