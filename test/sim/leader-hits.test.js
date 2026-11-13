// Per-operator damage actually removed from the current leader pool. Not a BattleResult field: goldens read perPlayer
// only. A CreditPool re-sim records the excess past `acked`, because that is the drop in pool HP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { dealHPLose } from '../../server/sim/attack.js';
import { CreditPool, SharedBossPool } from '../../server/match/finalAssault.js';

function bossBattle(pool) {
  const h = makeBattle({
    kind: 'boss', content: 'none', sharedBoss: pool, autoFinish: false,
    units: [{ chessId: 'chess_char_1_01_a', uid: 11, row: 3, col: 4 }],
    enemies: [],
  });
  const boss = h.spawn('enemy_1422_lrsldr', { tag: 'boss', pos: [2, 8] });
  assert.ok(boss && boss.bossPool, 'the tagged leader shares the pool');
  const ally = h.unit(11);
  assert.ok(ally && ally.kind === 'op' && ally.ownerId === 'p1', 'the operator is on the field');
  return { h, boss, ally };
}

test('CreditPool: leaderHits records the pool drop, not the hit asked for', () => {
  const pool = new SharedBossPool(10000);
  const credit = new CreditPool(pool, { acked: 400 });
  const { h, boss, ally } = bossBattle(credit);
  const dealt = dealHPLose(h.battle, { target: boss, amount: 1000, source: ally });
  assert.equal(dealt, 600);
  assert.equal(pool.hp, 9400);
  const hits = h.battle.leaderHits();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].pid, 'p1');
  assert.equal(hits[0].uid, 11);
  assert.equal(hits[0].chess, ally.defId);
  assert.equal(hits[0].dmg, 600);
  const res = h.battle.result();
  assert.equal(Object.hasOwn(res, 'leaderHits'), false);
  assert.equal(Object.hasOwn(res, 'ops'), false);
  assert.equal(res.perPlayer.p1.bossDamage, 600);
});

test('damage still inside the acknowledged total adds no row; the next hit records only the excess', () => {
  const pool = new SharedBossPool(10000);
  const credit = new CreditPool(pool, { acked: 400 });
  const { h, boss, ally } = bossBattle(credit);
  assert.equal(dealHPLose(h.battle, { target: boss, amount: 100, source: ally }), 0);
  assert.deepEqual(h.battle.leaderHits(), []);
  assert.equal(pool.hp, 10000);
  assert.equal(dealHPLose(h.battle, { target: boss, amount: 500, source: ally }), 200);
  assert.equal(h.battle.leaderHits()[0].dmg, 200);
  assert.equal(h.battle.result().perPlayer.p1.bossDamage, 200);
});

test('a token rolls up to its operator; a device and a token with no operator are not ranked', () => {
  const { h, ally } = bossBattle(new SharedBossPool(1000));
  const token = { kind: 'token', ownerUnit: ally, uid: 99, ownerId: 'p1', defId: 'token_x' };
  h.battle.noteLeaderDamage(token, 30);
  const nested = { kind: 'token', ownerUnit: { kind: 'token', ownerUnit: ally }, uid: 98, ownerId: 'p1', defId: 'token_y' };
  h.battle.noteLeaderDamage(nested, 5);
  h.battle.noteLeaderDamage({ kind: 'device', uid: 3, ownerId: 'p1', defId: 'dev_a', def: { tier: 1 } }, 50);
  h.battle.noteLeaderDamage({ kind: 'token', ownerUnit: null, uid: 4, ownerId: 'p1', defId: 'token_z' }, 10);
  // four token steps still reach the operator; a fifth stops on a token and is not ranked
  let four = ally;
  for (let i = 0; i < 4; i++) four = { kind: 'token', ownerUnit: four, uid: 70 + i, ownerId: 'p1', defId: 'token_d' };
  h.battle.noteLeaderDamage(four, 1);
  let five = ally;
  for (let i = 0; i < 5; i++) five = { kind: 'token', ownerUnit: five, uid: 80 + i, ownerId: 'p1', defId: 'token_e' };
  h.battle.noteLeaderDamage(five, 9);
  const hits = h.battle.leaderHits();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].uid, ally.uid);
  assert.equal(hits[0].dmg, 36);
});

test('a normal battle records nothing', () => {
  const h = makeBattle({
    kind: 'normal', content: 'none', autoFinish: false,
    units: [{ chessId: 'chess_char_1_01_a', uid: 11, row: 10, col: 5 }],
  });
  const ally = h.unit(11);
  h.battle.noteLeaderDamage(ally, 40);
  assert.deepEqual(h.battle.leaderHits(), []);
});
