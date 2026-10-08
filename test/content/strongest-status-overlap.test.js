import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

test('Dorothy, Pozëmka, and Schwarz DEF reductions fall back to the strongest unexpired application', () => {
  const h = makeBattle({
    autoFinish: false,
    timeLimit: 10,
    flags: { dpInit: 0, dpPerSec: 0 },
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, def: 1000, speed: 0 }) } },
    units: [
      { uid: 1, diy: { slot: 'chess_char_6_diy1_a', charId: 'char_4048_doroth', skillIndex: 0, uniEquipId: null }, elite: true, row: 10, col: 4 },
      { uid: 2, kind: 'token', tokenId: 'token_10025_doroth_recttp', ownerUid: 1, row: 9, col: 6 },
      { uid: 3, diy: { slot: 'chess_char_6_diy2_a', charId: 'char_4055_bgsnow', skillIndex: 0, uniEquipId: null }, elite: true, row: 10, col: 5 },
      { uid: 4, kind: 'token', tokenId: 'token_10026_bgsnow_subbow', ownerUid: 3, row: 9, col: 5 },
      { uid: 5, diy: { slot: 'chess_char_5_diy1_a', charId: 'char_340_shwaz', skillIndex: 2, uniEquipId: null }, elite: true, row: 9, col: 4 },
    ],
  });
  h.step();
  // Keep the real kits and projectile travel; prevent extra attacks refreshing their reductions.
  for (const unit of h.allies()) unit.atkCd = 100;
  const trap = h.unit(2), typewriter = h.unit(4), schwarz = h.unit(5);
  const enemy = h.spawn('enemy_dummy', { pos: [9, 6] });
  h.step();
  assert.equal(enemy.s.def, 700, 'Dorothy S1 applies the initial 30% reduction');

  h.run(0.9 - h.b.time);
  assert.equal(h.b.forceAttack(typewriter, [enemy]), true);
  h.run(1.8 - h.b.time);
  schwarz.skill.gainSp(999);
  schwarz.atkCd = 0;
  h.step();
  assert.equal(schwarz.skill.active, true, 'Schwarz S3 guarantees her armor-piercing talent');
  schwarz.atkCd = 100;
  h.run(2.1 - h.b.time);

  const reductions = h.hooksOf('statusApplied').filter((event) => event.target === enemy && event.status === 'defDown');
  assert.deepEqual(reductions.map(({ source, value, duration }) => [source.id, value, duration]), [
    [trap.id, 0.3, 5],
    [typewriter.id, 0.25, 5],
    [schwarz.id, 0.2, 5],
  ]);
  for (const [index, expectedTime] of [[0, 0], [1, 1], [2, 2]]) {
    assert.ok(Math.abs(reductions[index].t - expectedTime) < 0.1, `reduction ${index + 1} lands near ${expectedTime}s`);
  }
  assert.equal(enemy.s.def, 700, 'weaker applications do not reduce the active strength');

  h.run(5.1 - h.b.time);
  assert.equal(enemy.s.def, 750, 'the typewriter reduction survives Dorothy S1 expiring');
  h.run(6.1 - h.b.time);
  assert.equal(enemy.s.def, 800, 'Schwarz reduction survives the typewriter reduction expiring');
  h.run(7.1 - h.b.time);
  assert.equal(enemy.s.def, 1000, 'DEF returns to its base value after the final application expires');
  assert.deepEqual(h.b.errors, []);
  h.invariants();
});
