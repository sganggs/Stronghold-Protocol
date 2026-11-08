// test/sim/regulation-enemies.test.js — 规程·序列Ⅰ leaders, the new special-enemy classes, and tile_speedup.
// Battles use content 'generic' plus the enemy / boss modules (devices only for terrain) and the act3 enemy table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, flatStage } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import * as devicesMod from '../../server/sim/content/devices.js';
import { REGULATION_KITS } from '../../server/sim/content/enemies/regulation.js';
import { REGULATION_BOSS_KITS } from '../../server/sim/content/regulation-bosses.js';
import { getData, getVersionData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves, isFlyKey } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';

const V = getVersionData('act3autochess@V3_1');
const MECH = 'enemy_9029_acfnc';
const MECH_2 = 'enemy_9029_acfnc_2';
const ARMOR = 'enemy_9027_acfnca';
const SPIDER = 'enemy_9035_acspider';
const SPIDER_2 = 'enemy_9035_acspider_2';
const EEL = 'enemy_9037_aceel';
const EEL_2 = 'enemy_9037_aceel_2';
const BEAST = 'enemy_2124_dyjsfg';
const TAIL = 'enemy_2123_dyjsww';
const CRIT = 'enemy_9040_accrit';
const TITUS = 'enemy_1104_lfkght_3';

const BIG = [];
for (let dr = -4; dr <= 4; dr++) for (let dc = -12; dc <= 12; dc++) BIG.push([dr, dc]);
const CHESS = {
  t_wall: chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null }),
  t_gun: chessRec({ id: 't_gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 0 }, rangeGrid: BIG, skill: null }),
};

const waitAt = (y, x, motion = 'WALK') => ({ motion, start: [y, x], end: [y, x], steps: [{ t: 'wait', s: 99999 }] });

function fight(o = {}) {
  const { units = [], extraContent = [enemiesMod, bossesMod], stage = null, flat = null, ...rest } = o;
  return makeBattle({
    content: 'generic', extraContent, seed: 1, autoFinish: false, timeLimit: 30,
    stage: stage ?? undefined, flat: flat ?? undefined,
    defs: { enemies: V.enemies, chess: CHESS },
    units, ...rest,
  });
}

const put = (h, key, pos, motion = 'WALK') => h.spawn(key, { pos, route: waitAt(pos[0], pos[1], motion) });
const living = (h, key) => h.enemies().filter((e) => e.defId === key);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function tally(slots) {
  const c = {};
  for (const t of slots) c[t] = (c[t] || 0) + 1;
  return c;
}

test('regulation keys stay off the default kit maps and carry fly / beFactor', () => {
  for (const k of Object.keys(REGULATION_KITS)) {
    assert.equal(enemiesMod.KITS[k], undefined, k);
    assert.equal(bossesMod.BOSS_KITS[k], undefined, k);
    const e = V.enemies[k];
    assert.ok(e, k);
    assert.equal(typeof e.beFactor, 'number', k);
    assert.ok(e.beFactor > 0, k);
    assert.equal(typeof e.isFlyEnemy, 'boolean', k);
  }
  for (const k of Object.keys(REGULATION_BOSS_KITS)) {
    assert.equal(bossesMod.BOSS_KITS[k], undefined, k);
    assert.equal(enemiesMod.KITS[k], undefined, k);
    const e = V.enemies[k];
    assert.ok(e, k);
    assert.equal(typeof e.beFactor, 'number', k);
    assert.equal(typeof e.isFlyEnemy, 'boolean', k);
  }
  const gd = new GameData(V, 'mode_multi_hard');
  assert.equal(isFlyKey(gd, ARMOR), true);
  assert.equal(gd.enemy(ARMOR).isFlyEnemy, true);
  assert.equal(gd.enemy(ARMOR).beFactor, 1);
  assert.equal(isFlyKey(gd, BEAST), false);
  assert.equal(gd.enemy(BEAST).isFlyEnemy, false);
  assert.equal(gd.enemy(BEAST).beFactor, 0.5);
  assert.equal(gd.factions.types.CRITIC.showEnemyId, CRIT);
  assert.ok(gd.enemy(gd.factions.types.CRITIC.showEnemyId));
  assert.equal(gd.factions.types.REBORN.showEnemyId, 'enemy_9030_acpara');
  assert.ok(gd.enemy('enemy_9030_acpara'));
});

test('械 below half health spawns an untargetable armor pair; the hidden form does not', () => {
  const ratio = V.enemies[MECH].talents.bb['Armor.hp_ratio'];
  assert.equal(ratio, 0.5);
  const h = fight();
  const e = put(h, MECH, [9, 8]);
  e.hp = e.s.maxHp * 0.49;
  h.step(2);
  const armors = living(h, ARMOR);
  assert.equal(armors.length, 2);
  for (const a of armors) assert.equal(a.s.flags.untargetable, true);
  assert.equal(V.enemies[MECH_2].talents.bb['Armor.hp_ratio'], undefined);
  const h2 = fight();
  const hidden = put(h2, MECH_2, [9, 8]);
  hidden.hp = hidden.s.maxHp * 0.49;
  h2.step(2);
  assert.equal(living(h2, ARMOR).length, 0);
});

test('茧 volley hits the highest-HP operators and evade stacks from missing health', () => {
  const h = fight({
    units: [3, 4, 5, 6].map((col, i) => ({ chessId: 't_gun', row: 10, col, uid: i + 1 })),
  });
  h.step(1);
  const ops = h.allies().slice().sort((a, b) => a.tileC - b.tileC);
  assert.equal(ops.length, 4);
  const hp = [5000, 4000, 3000, 1000];
  ops.forEach((u, i) => { u.hp = hp[i]; });
  put(h, SPIDER, [9, 2]);
  h.run(0.2);
  assert.equal(ops[3].hp, 1000);
  assert.ok(ops[0].hp < 5000);
  assert.ok(ops[1].hp < 4000);
  assert.ok(ops[2].hp < 3000);
  assert.equal(ops[0].hp, 4500);

  const base = fight();
  const s = put(base, SPIDER, [9, 8]);
  s.hp = s.s.maxHp * 0.75;
  base.step(1);
  assert.equal(s.s.dodgePhys, 0.5);
  assert.equal(s.s.dodgeArts, 0.5);

  const hid = fight();
  const s2 = put(hid, SPIDER_2, [9, 8]);
  s2.hp = s2.s.maxHp * 0.75;
  hid.step(1);
  assert.equal(s2.s.dodgePhys, 0.8);
  assert.equal(s2.s.dodgeArts, 0.8);
});

test('鳍 holds a damage cut while it is not blocked', () => {
  const h = fight();
  const e = put(h, EEL, [9, 8]);
  h.step(1);
  assert.ok(near(e.s.physTakenMul, 0.6));
  assert.ok(near(e.s.artsTakenMul, 0.6));
  const h2 = fight();
  const e2 = put(h2, EEL_2, [9, 8]);
  h2.step(1);
  assert.ok(near(e2.s.physTakenMul, 0.3));
  assert.ok(near(e2.s.artsTakenMul, 0.3));
});

test('矩兽 tramples on its interval, overloads below half health, and 后兽 drops untargetable when 矩兽 dies', () => {
  const h = fight({ units: [{ chessId: 't_gun', row: 9, col: 9 }] });
  put(h, BEAST, [9, 10]);
  const tail = h.enemy(TAIL);
  assert.ok(tail);
  assert.equal(Math.round(tail.x), 11);
  assert.equal(tail.s.flags.untargetable, true);
  h.step(1);
  const gun = h.allies()[0];
  assert.ok(gun);
  const start = gun.hp;
  h.run(2);
  assert.equal(gun.hp, start);
  h.run(0.6);
  assert.ok(gun.hp < start);

  const h2 = fight();
  const beast = put(h2, BEAST, [9, 10]);
  beast.hp = beast.s.maxHp * 0.49;
  h2.step(1);
  assert.ok(near(beast.s.moveSpeed, 0.6));
  assert.ok(near(beast.s.atk, 2250));

  const h3 = fight();
  const b3 = put(h3, BEAST, [9, 10]);
  const t3 = h3.enemy(TAIL);
  assert.equal(t3.s.flags.untargetable, true);
  h3.b.kill(b3, null);
  assert.equal(t3.alive, true);
  assert.equal(b3.alive, false);
  assert.ok(!t3.s.flags.untargetable);
});

test('寄生者 summons one 大君之赐 per nearby knock-down and does not chain off the gift', () => {
  const GIFT = 'enemy_1221_dzomg';
  const PARA = 'enemy_9030_acpara';
  const FODDER = 'enemy_1000_gopro_2';
  const h = fight();
  put(h, PARA, [9, 8]);
  put(h, PARA, [9, 8.2]);
  const nearFodder = put(h, FODDER, [9, 8]);
  h.b.kill(nearFodder, null);
  assert.equal(living(h, GIFT).length, 2);
  const gifts = living(h, GIFT);
  h.b.kill(gifts[0], null);
  h.b.kill(gifts[1], null);
  assert.equal(living(h, GIFT).length, 0);
  const outside = put(h, FODDER, [9, 14]);
  h.b.kill(outside, null);
  assert.equal(living(h, GIFT).length, 0);
  const leaker = put(h, FODDER, [9, 8]);
  h.b.leak(leaker);
  assert.equal(living(h, GIFT).length, 0);
  assert.equal(h.b.errors.length, 0);
});

test('丛生 doubles the first hit and locks healing; 左手泰特斯 revives once', () => {
  const h = fight({ units: [{ chessId: 't_wall', row: 9, col: 9 }] });
  const wall = h.unit('t_wall');
  const start = wall.hp;
  put(h, CRIT, [9, 9]);
  const hit = h.runUntil(() => start - wall.hp >= 2000 && wall.s.flags.healFree && wall.s.flags.noHeal, 20);
  assert.equal(hit, true);

  const h2 = fight();
  const e = put(h2, TITUS, [9, 8]);
  h2.b.kill(e, null);
  assert.equal(e.alive, true);
  assert.equal(e.s.flags.untargetable, true);
});

test('speedup raises ASPD and move speed; grassland does not; a flyer skips the tile', () => {
  const row = '##hrrzrwrrfrrrrrrrf##';
  assert.equal(row.length, 21);
  assert.equal(row[5], 'z');
  assert.equal(row[7], 'w');
  const stage = flatStage({ rows: { 10: row } });
  stage.special = { speedup: { attack_speed: 25, move_speed: 1.5 } };
  const h = fight({
    extraContent: [enemiesMod, bossesMod, devicesMod],
    stage,
    units: [
      { chessId: 't_gun', row: 10, col: 5, uid: 1 },
      { chessId: 't_gun', row: 10, col: 7, uid: 2 },
    ],
  });
  h.step(1);
  const fast = h.allies().find((u) => u.tileC === 5);
  const grass = h.allies().find((u) => u.tileC === 7);
  const speed = fast.findBuff('terrain:speedup');
  assert.ok(speed);
  assert.equal(speed.mods.aspd, 25);
  assert.equal(speed.mods.moveMul, 1.5);
  assert.equal(fast.s.aspd, 125);
  // Operators are created with base move 0, so the multiplier does not change their stat.
  assert.equal(fast.s.moveSpeed, 0);
  assert.equal(grass.findBuff('terrain:speedup'), null);
  assert.equal(grass.s.aspd, 100);
  assert.equal(grass.s.moveSpeed, 0);
  const gear = put(h, 'enemy_9028_acfncb', [10, 5]);
  h.step(1);
  assert.ok(gear.findBuff('terrain:speedup'));
  assert.equal(gear.s.aspd, 125);
  assert.ok(near(gear.s.moveSpeed, 0.6));
  const fly = put(h, ARMOR, [10, 5], 'FLY');
  h.step(1);
  assert.equal(fly.isFlying, true);
  assert.equal(fly.findBuff('terrain:speedup'), null);
});

test('solo schedule uses countSingle and specialEnemyNumSingle; multi and the default season do not', () => {
  const solo = setupMatchWaves(new GameData(V, 'mode_single_funny'), createRng(1));
  assert.equal(solo.factions.length, 2);
  assert.equal(solo.typeSlots.length, 15);
  const soloC = tally(solo.typeSlots);
  for (const f of solo.factions) assert.equal(soloC[f], 4, f);
  assert.equal(soloC.SPECIAL, 7);

  const multi = setupMatchWaves(new GameData(V, 'mode_multi_hard'), createRng(1));
  assert.equal(multi.factions.length, 3);
  const multiC = tally(multi.typeSlots);
  for (const f of multi.factions) assert.equal(multiC[f], 3, f);
  assert.equal(multiC.SPECIAL, 6);

  const def = setupMatchWaves(new GameData(getData(), 'mode_single_funny'), createRng(1));
  assert.equal(def.factions.length, 3);
  const defC = tally(def.typeSlots);
  for (const f of def.factions) assert.equal(defC[f], 3, f);
  assert.equal(defC.SPECIAL, 6);
  assert.equal(getData().factions.generation.specialEnemyNumSingle, undefined);
});

test('each new kit can spawn for a short step without a handler error', () => {
  const keys = [...Object.keys(REGULATION_KITS), ...Object.keys(REGULATION_BOSS_KITS)];
  for (const key of keys) {
    const h = fight();
    put(h, key, [9, 8]);
    h.run(0.2);
    assert.equal(h.b.errors.length, 0, `${key} ${h.b.errors.map((e) => e.message).join('; ')}`);
  }
});
