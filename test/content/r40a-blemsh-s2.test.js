// 瑕光 S2 慑敌辉光, community report 2026-10-14: facing down, she could not hit the sleeping enemies on her left and
// right. Her attack range stays 1-1 (self + the tile in front). rangeId x-1 is the 技能范围. A sleeper she was blocking
// stands on a side tile; 沉睡 releases the block (DESIGN §24.9) and 1-1 facing the other way does not cover that tile.
// While S2 runs, a sleeping ground enemy on the rotated skill range is extra attack range (server kit [ASSUMED]: the
// skill text does not change her attack range, so an awake enemy in the diamond is not). x-1 also contains the tile
// behind her, so a sleeper there is hittable only during S2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { offsetTile } from '../../server/sim/dir.js';
import { COLS } from '../../server/sim/constants.js';

const ds = getDefaultSource();
const DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
const ROW = 10;
const COL = 6;
const keyOf = (r, c) => r * COLS + c;
const skillIndex = (id) => ds.rawChess(id).skills.find((s) => s.skillId === 'skchr_blemsh_2').index;
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, def: 0, res: 0, atk: 0, ...o });
const hitsFrom = (h, u, target) => h.hooksOf('damaged').filter((c) => c.source === u && c.target === target && c.dmg?.isAttack);

function fight(id, dir, sleeperAt, { fly = false } = {}) {
  const awakeAt = [12, 4];
  const h = makeBattle({
    defs: {
      enemies: {
        enemy_side: dummy('enemy_side', fly ? { motion: 'FLY' } : {}),
        enemy_awake: dummy('enemy_awake'),
      },
    },
    timeLimit: 30,
    hooks: ['damaged'],
    captureNoisy: true,
    units: [{ chessId: id, row: ROW, col: COL, dir, skillIndex: skillIndex(id) }],
    enemies: [
      { key: 'enemy_side', pos: sleeperAt },
      { key: 'enemy_awake', pos: awakeAt },
    ],
  });
  h.step();
  const u = h.unit(id);
  const side = h.enemy('enemy_side');
  const awake = h.enemy('enemy_awake');
  assert.equal(u.dir, dir);
  assert.ok(side && awake, `${id} ${dir}: both enemies spawned`);
  h.b.applyStatus(side, 'sleep', { duration: 30, source: u });
  h.run(1.2);
  assert.equal(hitsFrom(h, u, side).length, 0, `${id} ${dir}: 1-1 does not reach the sleeper before S2`);
  assert.ok(u.skill.activate('test', { free: true }), `${id} ${dir}: S2 starts`);
  h.step();
  return { h, u, side, awake, sideKey: keyOf(sleeperAt[0], sleeperAt[1]), awakeKey: keyOf(awakeAt[0], awakeAt[1]) };
}

function done(h) {
  assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []);
  checkInvariants(h.b);
}

test('瑕光 S2: four facings × left and right sleeping ground enemies are hittable only while the skill runs', () => {
  for (const id of ['chess_char_3_12_a', 'chess_char_3_12_b']) {
    for (const dir of DIRS) {
      for (const [name, dr] of [['left', 1], ['right', -1]]) {
        const at = offsetTile(ROW, COL, dr, 0, dir);
        const { h, u, side, awake, sideKey, awakeKey } = fight(id, dir, at);
        assert.ok(u.rangeKeySet.has(sideKey), `${id} ${dir} ${name}: the sleeper tile is extra range`);
        assert.ok(!u.rangeKeySet.has(awakeKey), `${id} ${dir} ${name}: an awake neighbour stays out of range`);
        assert.ok(h.runUntil(() => hitsFrom(h, u, side).length >= 1, 6), `${id} ${dir} ${name}: she hits the sleeper`);
        assert.equal(hitsFrom(h, u, awake).length, 0, `${id} ${dir} ${name}: the awake enemy is not hit`);
        const n = hitsFrom(h, u, side).length;
        u.skill.end('test');
        h.run(1.5);
        assert.equal(u.extraRangeKeys, null, `${id} ${dir} ${name}: extra range clears with the skill`);
        assert.equal(hitsFrom(h, u, side).length, n, `${id} ${dir} ${name}: no further hits after S2`);
        done(h);
      }
    }
  }
});

test('瑕光 S2 facing down: a sleeper on the tile behind her is hittable only during the skill [ASSUMED]', () => {
  const at = offsetTile(ROW, COL, 0, -1, 'DOWN');
  const { h, u, side, sideKey } = fight('chess_char_3_12_a', 'DOWN', at);
  assert.ok(u.rangeKeySet.has(sideKey), 'x-1 contains the tile behind her');
  assert.ok(h.runUntil(() => hitsFrom(h, u, side).length >= 1, 6), 'she hits the sleeper behind her during S2');
  u.skill.end('test');
  const n = hitsFrom(h, u, side).length;
  h.run(1.5);
  assert.equal(hitsFrom(h, u, side).length, n);
  done(h);
});

test('瑕光 S2: a sleeping flyer on a side tile is not added to her attack range', () => {
  const at = offsetTile(ROW, COL, 1, 0, 'DOWN');
  const { h, u, side, sideKey } = fight('chess_char_3_12_a', 'DOWN', at, { fly: true });
  assert.ok(side.isFlying && side.s.flags.sleep);
  assert.ok(!u.rangeKeySet.has(sideKey), 'the skill text sleeps ground enemies; a flyer is not extra range');
  h.run(3);
  assert.equal(hitsFrom(h, u, side).length, 0);
  done(h);
});

// skill_table skchr_blemsh_2 + character_table char_423_blemsh talents[1]; gamedata_const ba.sleep.
// Exercise the production TAKE_DAMAGE cast, rather than pre-applying sleep with the harness as above.
for (const id of ['chess_char_3_12_a', 'chess_char_3_12_b']) for (const dir of DIRS) {
  test(`瑕光 S2 own sleep: ${id} ${dir}, own tile and actual blocks keep attacks and replay events`, () => {
    for (const [dr, dc] of [[0, 0], [0.65, 0], [-0.65, 0], [0, -0.65], [0, 0.65]]) {
      const at = offsetTile(ROW, COL, dr, dc, dir);
      const h = makeBattle({
        seed: 48, timeLimit: 30, autoFinish: false, captureNoisy: true,
        hooks: ['attack', 'damaged', 'statusApplied'],
        defs: {
          chess: { test_guard_a: chessRec({ id: 'test_guard_a', skill: null,
            rangeGrid: [[0, 1], [0, 2], [0, 3], [1, 2], [-1, 2]] }) },
          enemies: { enemy_sleeper: dummy('enemy_sleeper'), enemy_awake: dummy('enemy_awake') },
        },
        units: [
          { chessId: id, row: ROW, col: COL, dir, skillIndex: skillIndex(id) },
          { chessId: 'test_guard_a', row: ROW, col: COL - 2 },
        ],
        enemies: [{ key: 'enemy_sleeper', pos: at }],
      });
      h.step();
      const u = h.unit(id), e = h.enemy('enemy_sleeper'), guard = h.unit('test_guard_a');
      assert.equal(e.blockedBy, u, 'real enemy contact establishes the block before S2');
      assert.equal(u.profile.hitSleep, true);
      assert.equal(u.skill.rule, 'TAKE_DAMAGE');
      u.skill.gainSp(u.skill.spCost, 'test');
      h.b.dealDamage(e, u, { amount: 1, type: 'true' });
      assert.equal(u.skill.active, true, 'the damage triggers S2');
      const sleep = h.hooksOf('statusApplied').find((c) => c.target === e && c.status === 'sleep');
      assert.equal(sleep?.source, u, 'S2 itself put the enemy to sleep');
      assert.equal(sleep.duration, u.skill.duration);
      assert.ok(e.s.flags.sleep && !e.canAct);
      assert.ok(!e.s.flags.untargetable && !e.s.flags.invulnerable, 'sleep has its own selectability/damage gate');
      assert.equal(e.blockedBy, null, 'sleep frees her block slot');
      assert.ok(u.canAct && !h.b.effectiveProfile(u).noAttack, 'S2 does not disable her attacks');
      const lone0 = hitsFrom(h, u, e).length;
      h.run(2.5);
      assert.ok(hitsFrom(h, u, e).length >= lone0 + 2, 'the engine acquires a lone sleeper without the priority hook finding an awake target');
      const awake = h.spawn('enemy_awake', { pos: offsetTile(ROW, COL, 0, 0.65, dir) });
      const attacks0 = h.hooksOf('attack').length, damage0 = h.hooksOf('damaged').length;
      const events0 = h.eventsOf('atk').length;
      u.atkCd = 0;
      assert.ok(h.runUntil(() => h.hooksOf('attack').slice(attacks0).some((c) => c.attacker === u), 3));
      h.run(3);
      const attacks = h.hooksOf('attack').slice(attacks0).filter((c) => c.attacker === u);
      assert.ok(attacks.length >= 2, 'she keeps attacking while the enemy sleeps');
      assert.ok(attacks.every((c) => c.targets[0] === e), '仁慈 prioritizes the sleeper over the awake target');
      assert.equal(hitsFrom(h, u, awake).length, 0);
      const hits = h.hooksOf('damaged').slice(damage0).filter((c) => c.source === u && c.target === e);
      assert.equal(hits.length, attacks.length);
      const mercy = ds.getChess(id).talents[1].bb.atk_scale;
      for (const hit of hits) assert.ok(Math.abs(hit.amount - u.s.atk * mercy) < 1e-6, "仁慈 uses this form's atk_scale");
      const replay = JSON.parse(JSON.stringify(h.eventsOf('atk').slice(events0)));
      assert.equal(replay.filter((ev) => ev[1] === u.id && ev[2] === e.id).length, attacks.length,
        'each attack is serialized as an atk event for the client animation');
      assert.equal(h.hooksOf('attack').slice(attacks0).filter((c) => c.attacker === guard && c.targets.includes(e)).length, 0);
      const hp0 = e.hp;
      assert.equal(h.b.dealDamage(guard, e, { amount: 1e6, type: 'true' }), 0, 'another unit cannot damage the sleeper');
      h.b.forceAttack(guard, [e]);
      assert.equal(e.hp, hp0, 'even a forced attack cannot bypass sleep immunity');
      done(h);
    }
  });
}

test('瑕光 S2: all ground enemies on her own tile sleep even when her block slots are full', () => {
  for (const id of ['chess_char_3_12_a', 'chess_char_3_12_b']) {
    const h = makeBattle({
      seed: 48, timeLimit: 30, autoFinish: false, captureNoisy: true, hooks: ['statusApplied', 'damaged'],
      units: [{ chessId: id, row: ROW, col: COL, skillIndex: skillIndex(id) }],
      defs: { enemies: { enemy_ground: dummy('enemy_ground'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) } },
      enemies: [{ key: 'enemy_ground', pos: [ROW, COL], count: 4 }, { key: 'enemy_fly', pos: [ROW, COL], route: 2 }],
    });
    h.step();
    const u = h.unit(id), grounds = h.enemies().filter((e) => !e.isFlying), fly = h.enemy('enemy_fly');
    assert.ok(grounds.some((e) => e.blockedBy !== u), 'some on-tile enemies exceed her block capacity');
    assert.ok(u.skill.activate('test', { free: true }));
    assert.ok(grounds.every((e) => e.s.flags.sleep && e.blockedBy === null));
    assert.ok(!fly.s.flags.sleep, 'an unblocked flyer on her tile does not sleep');
    h.run(3);
    assert.ok(grounds.some((e) => hitsFrom(h, u, e).length >= 2));
    assert.equal(hitsFrom(h, u, fly).length, 0);
    done(h);
  }
});
