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

test('hidden 械 summons an untargetable armor pair the moment it enters', () => {
  const h = fight();
  const boss = put(h, MECH_2, [9, 8]);
  const armors = living(h, ARMOR);
  assert.equal(armors.length, 2);
  for (const a of armors) {
    assert.equal(a.s.flags.untargetable, true);
    assert.equal(Math.round(a.y), 9);
    assert.equal(a.mem.regBossId, boss.id);
    assert.equal(a.mem.regLaunch, undefined);
  }
  const xs = armors.map((a) => Math.round(a.x)).sort((a, b) => a - b);
  assert.deepEqual(xs, [7, 9]);
  // LaunchArmor (cd 10, init 10) starts the pair that is already on the field.
  h.run(10);
  assert.equal(living(h, ARMOR).length, 2);
  for (const a of living(h, ARMOR)) assert.equal(a.mem.regLaunch, true);
});

test('械 below half health spawns an untargetable armor pair; hidden 械 does not spawn another', () => {
  const ratio = V.enemies[MECH].talents.bb['Armor.hp_ratio'];
  assert.equal(ratio, 0.5);
  const h = fight();
  const e = put(h, MECH, [9, 8]);
  assert.equal(living(h, ARMOR).length, 0);
  e.hp = e.s.maxHp * 0.49;
  h.step(2);
  const armors = living(h, ARMOR);
  assert.equal(armors.length, 2);
  for (const a of armors) assert.equal(a.s.flags.untargetable, true);
  assert.equal(V.enemies[MECH_2].talents.bb['Armor.hp_ratio'], undefined);
  const h2 = fight();
  const hidden = put(h2, MECH_2, [9, 8]);
  assert.equal(living(h2, ARMOR).length, 2);
  hidden.hp = hidden.s.maxHp * 0.49;
  h2.step(2);
  assert.equal(living(h2, ARMOR).length, 2);
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

test('左手泰特斯 halves the highest-ATK operator for 25 s after 10 s and marks it with the weaken status (round 83)', () => {
  const chess = { ...CHESS, t_hit: chessRec({ id: 't_hit', profession: 'SNIPER', projectile: 'none', stats: { atk: 600, maxHp: 1e7, def: 0, res: 0, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null }) };
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 1, autoFinish: false, timeLimit: 40,
    defs: { enemies: V.enemies, chess }, units: [{ chessId: 't_hit', row: 9, col: 2 }, { chessId: 't_gun', row: 9, col: 3 }],
  });
  put(h, TITUS, [9, 12]);
  const hit = h.unit('t_hit');
  h.run(9);
  assert.ok(!hit.findBuff('reg:weaken'));
  h.run(2);
  const buff = hit.findBuff('reg:weaken');
  assert.ok(buff, 'the cut lands after the 10 s initial cooldown');
  assert.equal(buff.status, 'weaken');
  assert.ok(near(hit.s.atk, 300), 'ATK -50 % (additive atkPct)');
  assert.ok(h.eventsOf('status').some((e) => e[1] === hit.id && e[2] === 'weaken'), 'the client gets the weaken status');
  assert.ok(!h.unit('t_gun').findBuff('reg:weaken'), 'only the highest ATK');
});

test('speedup gives allies ASPD only and enemies move speed only; grassland grants stealth; a flyer skips the tile', () => {
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
  assert.equal(speed.mods.moveMul, undefined);
  assert.equal(fast.s.aspd, 125);
  // Operators are created with base move 0. Allies do not get the enemy move scaler.
  assert.equal(fast.s.moveSpeed, 0);
  assert.equal(grass.findBuff('terrain:speedup'), null);
  assert.ok(grass.findBuff('terrain:duelGrass'));
  assert.equal(grass.s.flags.stealth, true);
  assert.equal(grass.s.aspd, 100);
  assert.equal(grass.s.moveSpeed, 0);
  const gear = put(h, 'enemy_9028_acfncb', [10, 5]);
  h.step(1);
  assert.ok(gear.findBuff('terrain:speedup'));
  assert.equal(gear.s.aspd, 100);
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

test('投石机 throws one snowball with a plus splash, then only melees', () => {
  const WING = 'enemy_1388_wingnt';
  const h = fight({
    units: [
      { chessId: 't_gun', row: 9, col: 6, uid: 1 },
      { chessId: 't_gun', row: 9, col: 7, uid: 2 },
      { chessId: 't_gun', row: 10, col: 7, uid: 3 },
      { chessId: 't_gun', row: 9, col: 10, uid: 4 },
      { chessId: 't_wall', row: 12, col: 4, uid: 5 },
    ],
  });
  h.step(1);
  const primary = h.allies().find((u) => u.uid === 1);
  const ortho = h.allies().find((u) => u.uid === 2);
  const diag = h.allies().find((u) => u.uid === 3);
  const far = h.allies().find((u) => u.uid === 4);
  const wall = h.allies().find((u) => u.uid === 5);
  const p0 = primary.hp, o0 = ortho.hp, d0 = diag.hp, f0 = far.hp, w0 = wall.hp;
  put(h, WING, [9, 4]);
  const landed = h.runUntil(() => primary.hp < p0, 8);
  assert.equal(landed, true);
  assert.equal(p0 - primary.hp, 1200);
  assert.equal(o0 - ortho.hp, 1200);
  assert.equal(diag.hp, d0);
  assert.equal(far.hp, f0);
  assert.equal(wall.hp, w0);
  const lobs = h.eventsOf('atk').filter((e) => e[3] === 'lob');
  assert.equal(lobs.length, 1);
  const blast = h.eventsOf('fx').filter((e) => e[1] === 'explode');
  assert.equal(blast.length, 1);
  assert.deepEqual(blast[0][4].tiles, [[9, 6], [10, 6], [8, 6], [9, 7], [9, 5]]);

  const afterP = primary.hp, afterO = ortho.hp;
  assert.equal(h.b.relocate(wall, 9, 4), true);
  const hit = h.runUntil(() => wall.hp < w0, 8);
  assert.equal(hit, true);
  assert.equal(w0 - wall.hp, 800);
  assert.equal(primary.hp, afterP);
  assert.equal(ortho.hp, afterO);
  assert.equal(h.b.errors.length, 0);
});

test('聚焦魂灵残迹 picks up to three vortices and spends them on a line laser', () => {
  const WIZ = 'enemy_1429_lrwzrd';
  const SOUL = 'enemy_1428_lrsoul';
  const held = fight();
  put(held, WIZ, [9, 8]);
  const near = [put(held, SOUL, [9, 7]), put(held, SOUL, [9, 8.2]), put(held, SOUL, [9, 6.5]), put(held, SOUL, [9, 7.4])];
  const outside = put(held, SOUL, [12, 10]);
  held.run(1);
  const aliveNear = near.filter((e) => e.alive).length;
  assert.equal(aliveNear, 1);
  assert.equal(outside.alive, true);
  assert.equal(held.b.errors.length, 0);

  const h = fight({
    units: [
      { chessId: 't_gun', row: 9, col: 9, uid: 1 },
      { chessId: 't_gun', row: 9, col: 10, uid: 2 },
      { chessId: 't_gun', row: 10, col: 9, uid: 3 },
    ],
  });
  h.step(1);
  const onLine = h.allies().find((u) => u.uid === 2);
  const off = h.allies().find((u) => u.uid === 3);
  const line0 = onLine.hp, off0 = off.hp;
  put(h, WIZ, [9, 8]);
  const soul = put(h, SOUL, [9, 7]);
  soul.bounty = { coins: 9, ownerPlayerId: 'p1' };
  const fired = h.runUntil(() => onLine.hp < line0, 3);
  assert.equal(fired, true);
  assert.equal(soul.alive, false);
  assert.equal(line0 - onLine.hp, 200);
  assert.equal(off.hp, off0);
  const beams = h.eventsOf('fx').filter((e) => e[1] === 'beam');
  assert.equal(beams.length >= 1, true);
  assert.equal(beams[0][4].kind, 'soulLaser');
  const again = onLine.hp;
  put(h, SOUL, [9, 7]);
  h.run(2);
  assert.equal(onLine.hp, again);
  assert.equal(h.b.errors.length, 0);

  const elite = fight({
    units: [
      { chessId: 't_gun', row: 9, col: 9, uid: 1 },
      { chessId: 't_gun', row: 9, col: 10, uid: 2 },
    ],
  });
  elite.step(1);
  const far = elite.allies().find((u) => u.uid === 2);
  const f0 = far.hp;
  put(elite, 'enemy_1429_lrwzrd_2', [9, 8]);
  put(elite, SOUL, [9, 7]);
  const hit = elite.runUntil(() => far.hp < f0, 3);
  assert.equal(hit, true);
  assert.equal(f0 - far.hp, 280);
  assert.equal(elite.b.errors.length, 0);
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

test('刺胄之弹 / 余音 hits leave out the 补给线 share where the season excludes them (规程), keep it on 下半', () => {
  const D = getData();
  const mods = { hpMul: 2, atkMul: 1, speedMul: 1, supplyHpMul: 1.6 };
  for (const key of ['enemy_9016_acstmr', 'enemy_9023_acdums']) {
    const hits = (season) => {
      const h = makeBattle({
        content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 1, autoFinish: false, timeLimit: 30,
        defs: { enemies: season.enemies, chess: CHESS, effects: season.effects }, units: [],
      });
      const e = h.spawn(key, { pos: [2, 6], route: waitAt(2, 6, 'FLY'), mods });
      return e.base.maxHp;
    };
    const raw = (season) => season.enemies[key].stats.maxHp;
    assert.equal(hits(V), Math.max(1, Math.round(raw(V) * 2 / 1.6)), `${key}: 规程 drops the 补给线 share`);
    assert.equal(hits(D), Math.max(1, Math.round(raw(D) * 2)), `${key}: 下半 keeps the whole multiplier`);
  }
});

test('锋盔骑士团学徒 weakens the highest ATK after its own 25 s cooldown and revives once', () => {
  const KEY = 'enemy_1104_lfkght';
  const chess = {
    ...CHESS,
    t_hit: chessRec({ id: 't_hit', profession: 'SNIPER', projectile: 'none', stats: { atk: 600, maxHp: 1e7, def: 0, res: 0, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null }),
  };
  const h = makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 1, autoFinish: false, timeLimit: 40,
    defs: { enemies: V.enemies, chess },
    units: [{ chessId: 't_hit', row: 9, col: 2 }, { chessId: 't_gun', row: 9, col: 3 }],
  });
  const e = put(h, KEY, [9, 12]);
  const hit = h.unit('t_hit');
  h.run(24);
  assert.ok(!hit.findBuff('reg:weaken'), 'still inside the 25 s initial cooldown');
  h.run(2);
  const buff = hit.findBuff('reg:weaken');
  assert.ok(buff, 'the cut lands after 25 s');
  assert.equal(buff.status, 'weaken');
  assert.ok(near(hit.s.atk, 300), 'ATK -50 % from this row, not from 左手');
  assert.ok(!h.unit('t_gun').findBuff('reg:weaken'));
  h.b.kill(e, null);
  assert.equal(e.alive, true);
  assert.equal(e.s.flags.untargetable, true);
  assert.equal(h.b.errors.length, 0);
});

test('沙地兽 and 岩蛛 death-split the pinned child and count; silence stops it', () => {
  const cases = [
    ['enemy_1131_sbeast', 'enemy_1137_plasm', 2],
    ['enemy_1131_sbeast_2', 'enemy_1138_tumor', 2],
    ['enemy_1132_sarchn', 'enemy_1137_plasm', 3],
    ['enemy_1132_sarchn_2', 'enemy_1138_tumor', 3],
  ];
  for (const [key, child, n] of cases) {
    assert.equal(V.enemies[key].talents.bbStr['deathrattle.enemy_key'], child, key);
    assert.equal(V.enemies[key].talents.bb['deathrattle.cnt'], n, key);
    const h = fight();
    const e = put(h, key, [9, 8]);
    h.b.kill(e, null);
    h.run(0.3);
    assert.equal(living(h, child).length, n, key);
    assert.equal(h.b.errors.length, 0, key);
  }
  const silenced = fight();
  const e = put(silenced, 'enemy_1131_sbeast', [9, 8]);
  silenced.b.applyStatus(e, 'silence', { duration: 30 });
  silenced.b.kill(e, null);
  silenced.run(0.3);
  assert.equal(living(silenced, 'enemy_1137_plasm').length, 0);
});

test('雪怪小队 deals atkup.atk_scale only against a frozen target', () => {
  const KEY = 'enemy_1064_snsbr';
  const scale = V.enemies[KEY].talents.bb['atkup.atk_scale'];
  assert.equal(scale, 1.5);
  const h = fight({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
  h.step(1);
  const wall = h.unit('t_wall');
  const e = put(h, KEY, [9, 5]);
  assert.equal(h.runUntil(() => e.stats.attacks >= 1, 8), true);
  const first = h.hooksOf('damaged').find((c) => c.source === e);
  assert.ok(near(first.amount, e.s.atk));
  h.b.applyStatus(wall, 'freeze', { duration: 30 });
  assert.equal(h.runUntil(() => e.stats.attacks >= 2, 8), true);
  const second = h.hooksOf('damaged').filter((c) => c.source === e)[1];
  assert.ok(near(second.amount, e.s.atk * scale));
  assert.equal(h.b.errors.length, 0);
});

test('冰爆源石虫·α death blast is physical ATK×boom within rawRangeRadius and applies cold', () => {
  const KEY = 'enemy_1067_snslime_2';
  const rec = V.enemies[KEY];
  const h = fight({
    units: [
      { chessId: 't_wall', row: 10, col: 6, uid: 1 },
      { chessId: 't_gun', row: 10, col: 4, uid: 2 },
    ],
  });
  h.step(1);
  const nearW = h.unit('t_wall');
  const far = h.allies().find((u) => u.uid === 2);
  const e = put(h, KEY, [10, 7.6]);
  h.b.kill(e, null);
  assert.ok(near(nearW.stats.taken, rec.stats.atk * rec.talents.bb['boom.atk_scale']));
  assert.equal(far.stats.taken, 0, 'past rawRangeRadius 1.9');
  assert.equal(nearW.s.flags.cold, true);
  assert.equal(h.b.errors.length, 0);
});

test('沸血骑士团精锐 gains ATK and ASPD per enemy knock-down, capped at 10; a leak does not count', () => {
  const KEY = 'enemy_1103_wdkght_2';
  const bb = V.enemies[KEY].talents.bb;
  assert.equal(bb['enhance.atk'], 0.1);
  assert.equal(bb['enhance.attack_speed'], 5);
  assert.equal(bb['enhance.max_stack_cnt'], 10);
  const h = fight();
  const e = put(h, KEY, [9, 8]);
  h.step(1);
  const baseAtk = e.s.atk;
  const baseAspd = e.s.aspd;
  h.b.kill(put(h, 'enemy_1000_gopro_2', [9, 12]), null);
  assert.ok(near(e.s.atk, baseAtk * 1.1));
  assert.equal(e.s.aspd, baseAspd + 5);
  for (let i = 0; i < 12; i++) h.b.kill(put(h, 'enemy_1000_gopro_2', [9, 12]), null);
  assert.ok(near(e.s.atk, baseAtk * 2));
  assert.equal(e.s.aspd, baseAspd + 50);
  const leaked = put(h, 'enemy_1000_gopro_2', [9, 12]);
  h.b.leak(leaked);
  assert.ok(near(e.s.atk, baseAtk * 2));
  assert.equal(e.s.aspd, baseAspd + 50);
  assert.equal(h.b.errors.length, 0);
});

test('械 洪流攻势: one 量变之械 on each walkable side of the highest-block ally (cnt 4 = the four sides)', () => {
  const GEAR = 'enemy_9028_acfncb';
  for (const key of [MECH, MECH_2]) {
    const squad = V.enemies[key].skills.find((s) => s.prefabKey === 'SommonSquad');
    assert.equal(squad.bb.cnt, 4);
    assert.equal(squad.bb.batch_max_target, 2);
    const h = fight({ units: [{ chessId: 't_wall', row: 9, col: 8 }] });
    put(h, key, [9, 12]);
    // Base form is an SP timer of 25 s. Hidden form's cooldown is ready immediately (icd 0).
    h.run(key === MECH ? 25.1 : 0.2);
    const wall = h.allies()[0];
    const sides = [[1, 0], [0, 1], [-1, 0], [0, -1]]
      .map(([dr, dc]) => [wall.tileR + dr, wall.tileC + dc])
      .filter(([r, c]) => h.b.grid.walkable(r, c));
    assert.ok(sides.length >= 2, 'the test tile has walkable sides');
    const gears = living(h, GEAR);
    assert.equal(gears.length, sides.length, key);
    const at = new Set(gears.map((g) => `${Math.round(g.y)},${Math.round(g.x)}`));
    for (const [r, c] of sides) assert.ok(at.has(`${r},${c}`), `${key}: a gear on ${r},${c}`);
    assert.equal(h.b.errors.length, 0, key);
  }
});

test('管 below half HP gains talent 1.prob (10 %) physical and arts dodge; 弦 does not', () => {
  const gun = { chessId: 't_gun', row: 1, col: 1 };
  for (const key of ['enemy_9021_acduml', 'enemy_9021_acduml_2']) {
    assert.equal(V.enemies[key].talents.bb['1.prob'], 0.1);
    const h = fight({ units: [gun], hooks: ['dodge'] });
    const e = put(h, key, [9, 8]);
    const src = h.allies()[0];
    h.step(1);
    assert.equal(e.findBuff('boss:pipeEvade'), null, `${key} above half`);
    e.hp = e.s.maxHp * 0.49;
    h.step(1);
    const buff = e.findBuff('boss:pipeEvade');
    assert.ok(buff, `${key} below half`);
    assert.ok(near(buff.mods.dodgePhys, 0.1) && near(buff.mods.dodgeArts, 0.1), key);
    // A chance, not immunity: some of 200 small hits land, some are dodged.
    const hp = e.hp;
    for (let i = 0; i < 200; i++) h.b.dealDamage(src, e, { amount: 1, type: i % 2 ? 'arts' : 'phys', canDodge: true });
    const dodged = h.hooksOf('dodge').filter((c) => c && c.target === e).length;
    assert.ok(dodged >= 5 && dodged <= 45, `${key}: ${dodged} of 200 dodged`);
    assert.ok(e.hp < hp, `${key}: the rest land`);
    e.hp = e.s.maxHp * 0.6;
    h.step(1);
    assert.equal(e.findBuff('boss:pipeEvade'), null, `${key} back above half`);
    assert.equal(h.b.errors.length, 0, key);
  }
  const h = fight({ units: [gun] });
  const echo = put(h, 'enemy_9022_acdumm', [9, 8]);
  h.step(1);
  echo.hp = echo.s.maxHp * 0.4;
  h.step(1);
  assert.equal(echo.findBuff('boss:pipeEvade'), null, '弦 has no Evade node');
});

test('碎铳之簧 9019 and 9020 are silenced while the shield regenerates and their attack count resets; 9018 is not', () => {
  const h = fight({ timeLimit: 40 });
  const hits = put(h, 'enemy_9020_actrpc', [9, 8]);
  const element = put(h, 'enemy_9019_actrpb', [9, 6]);
  const arts = put(h, 'enemy_9018_actrpa', [9, 4]);
  h.step(1);
  const src = null;
  for (let i = 0; i < 5; i++) h.b.dealDamage(src, hits, { amount: 100, type: 'phys' });
  assert.equal(hits.s.flags.silence, true);
  const hitsSkill = hits.mem.ab.list.find((a) => a && typeof a.attack === 'function');
  hitsSkill.n = 3;
  h.b.emit('elementBurst', { target: element, element: 'erosion', source: null });
  assert.equal(element.s.flags.silence, true);
  const elSkill = element.mem.ab.list.find((a) => a && typeof a.attack === 'function');
  elSkill.n = 4;
  const artsShield = arts.findBuff('boss:springShield');
  h.b.dealDamage(src, arts, { amount: artsShield.shield, type: 'arts' });
  assert.equal(arts.alive, true);
  assert.ok(!arts.s.flags.silence);
  h.run(25.2);
  assert.ok(!hits.s.flags.silence);
  assert.ok(!element.s.flags.silence);
  assert.equal(hitsSkill.n, 0);
  assert.equal(elSkill.n, 0);
  assert.ok(hits.findBuff('boss:springShield'));
  assert.ok(element.findBuff('boss:springShield'));
  assert.ok(arts.findBuff('boss:springShield'));
  assert.equal(h.b.errors.length, 0);
});

test('蕴核饲育者 children keep move_speed as a multiplier', () => {
  const h = fight();
  const e = put(h, 'enemy_1437_dsfull', [9, 8]);
  h.step(1);
  h.b.kill(e, null);
  const kids = h.enemies().filter((u) => u.alive);
  assert.equal(kids.length, 1);
  assert.ok(near(kids[0].s.moveSpeed, kids[0].base.moveSpeed * V.enemies['enemy_1437_dsfull'].talents.bb['0.move_speed']));
  assert.equal(h.b.errors.length, 0);
});

test('规程 round multipliers use its own 攻坚装备 / 补给线II / 急行军 values on 下半\'s stack schedule', () => {
  const r7 = V.config.modes.mode_multi_abyss.enemyScale['7'], d7 = getData().config.modes.mode_multi_abyss.enemyScale['7'];
  assert.deepEqual([d7.kAtk, d7.kHp], [r7.kAtk, r7.kHp], 'same stack counts');
  assert.ok(near(r7.atk, 1.11 ** r7.kAtk, 1e-6) && near(d7.atk, 1.1 ** d7.kAtk, 1e-6));
  assert.ok(near(r7.hp, 1.2 ** r7.kAtk * 1.3 ** (r7.kHp - r7.kAtk), 1e-6) && near(d7.hp, 1.2 ** d7.kHp, 1e-6));
  assert.ok(near(r7.supplyHp, 1.3 ** (r7.kHp - r7.kAtk), 1e-6));
  assert.equal(r7.speed, 1.3);
  assert.equal(d7.speed, 1.15);
  assert.equal(V.config.modes.mode_multi_abyss.enemyScale['2'].speed, 1, '急行军 from round 3');
});

// --- round 84: the companions whose abilities come from their PRTS pages (regulation.js kitGunsho … kitDsdivi) ---------

const T_WALL1 = chessRec({ id: 't_wall1', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 1 }, rangeGrid: [[0, 0]], skill: null });
/** A target that never hits the enemy (its range is its own tile): no zero-damage hits that would count as 受到伤害. */
const T_POST = chessRec({ id: 't_post', profession: 'SNIPER', projectile: 'none', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null });
const walkLeft = (y, x) => ({ motion: 'WALK', start: [y, x], end: [9, 2], checkpoints: [] });
const byUid = (h, uid) => h.allies().find((u) => u.uid === uid);
const bySource = (h, e) => h.hooksOf('damaged').filter((c) => c.source === e);

test('速射轻弩手 / 劲弩手 直击: three 100 % ATK physical bolts at the first ally in its row or column, after initCooldown 2 s and then every cooldown + clip (PRTS)', () => {
  for (const key of ['enemy_1403_gunsho', 'enemy_1403_gunsho_2']) {
    const rec = V.enemies[key];
    const sk = rec.skills.find((s) => s.prefabKey === 'CrossAttack');
    assert.deepEqual([sk.initCooldown, sk.cooldown], [2, 5], key);
    const h = fight({
      units: [
        { chessId: 't_gun', row: 9, col: 5, uid: 1 },   // the nearest in its row: the direction, and the first a bolt meets
        { chessId: 't_gun', row: 9, col: 3, uid: 2 },   // behind it on the same line
        { chessId: 't_gun', row: 10, col: 6, uid: 3 },  // on neither line
      ],
      hooks: ['damaged'], captureNoisy: true,
    });
    h.step(1);
    const first = byUid(h, 1), behind = byUid(h, 2), off = byUid(h, 3);
    const e = put(h, key, [9, 8]);
    h.run(1.9);
    assert.equal(bySource(h, e).length, 0, `${key}: nothing inside the initial cooldown`);
    h.run(1.5);
    const hits = bySource(h, e);
    assert.equal(hits.length, 3, key);
    for (const c of hits) {
      assert.equal(c.target, first, key);
      assert.equal(c.type, 'phys', key);
      assert.ok(near(c.amount, rec.stats.atk), `${key}: ${c.amount}`);
    }
    assert.equal(behind.stats.taken, 0, `${key}: the first ally takes every bolt`);
    assert.equal(off.stats.taken, 0, key);
    // an attack-class skill: its clip (Skill 1.567 s) on the cast event, its cooldown counted from the clip's end
    assert.deepEqual(h.eventsOf('cast').filter((ev) => ev[1] === e.id).map((ev) => ev[4]), [1.567], key);
    h.run(5);
    assert.equal(bySource(h, e).length, 3, `${key}: not again before cooldown + clip`);
    h.run(1.2);
    assert.equal(bySource(h, e).length, 6, `${key}: the second volley`);
    assert.equal(h.b.errors.length, 0, key);
  }
});

test('无畏掷弹兵: once, the first damage while not silenced and not blocked throws four 200 % ATK bombs (1.1 blast), then speed +0.7 and weight −2 (PRTS)', () => {
  const KEY = 'enemy_1405_boomer_2';
  const rec = V.enemies[KEY];
  const bomb = rec.skills.find((s) => s.prefabKey === 'Bomb');
  assert.deepEqual([bomb.bb.atk_scale, bomb.bb.projectile_range], [2, 1.1]);
  assert.deepEqual([rec.talents.bb['Light.move_speed'], rec.talents.bb['Light.mass_level']], [0.7, -2]);
  const h = fight({
    defs: { enemies: V.enemies, chess: { ...CHESS, t_post: T_POST } },
    units: [
      { chessId: 't_post', row: 9, col: 5, uid: 1 },   // the first on the left: its bomb bursts here
      { chessId: 't_post', row: 9, col: 4, uid: 2 },   // 1.0 from that burst: inside 1.1
      { chessId: 't_post', row: 9, col: 3, uid: 3 },   // 2.0 from it: outside
      { chessId: 't_post', row: 11, col: 8, uid: 4 },  // the first upwards (row + 1)
      { chessId: 't_post', row: 10, col: 9, uid: 5 },  // diagonal: no bomb flies there
    ],
    hooks: ['damaged'], captureNoisy: true,
  });
  h.step(1);
  const e = put(h, KEY, [9, 8]);
  h.step(1);
  const speed0 = e.s.moveSpeed, mass0 = e.weight;
  h.b.applyStatus(e, 'silence', { duration: 0.3 });
  h.b.dealDamage(null, e, { amount: 10, type: 'true' });
  h.run(1);
  assert.equal(e.findBuff('reg:boomerBomb'), null, 'silenced: no 掷弹模式');
  assert.equal(bySource(h, e).length, 0);
  h.b.dealDamage(null, e, { amount: 10, type: 'true' });
  assert.equal(e.s.flags.unblockable, true, '掷弹模式: cannot be blocked');
  assert.equal(e.s.flags.disarm, true, '掷弹模式: cannot attack');
  h.run(1);
  const atk = rec.stats.atk * 2;
  for (const uid of [1, 2, 4]) assert.ok(near(byUid(h, uid).stats.taken, atk), `uid ${uid}: ${byUid(h, uid).stats.taken}`);
  for (const uid of [3, 5]) assert.equal(byUid(h, uid).stats.taken, 0, `uid ${uid}`);
  h.run(0.6);
  assert.ok(near(e.s.moveSpeed, speed0 + 0.7), `${speed0} → ${e.s.moveSpeed}`);
  assert.equal(e.weight, mass0 - 2);
  assert.ok(!e.s.flags.unblockable, 'blockable again');
  const n = bySource(h, e).length;
  h.b.dealDamage(null, e, { amount: 10, type: 'true' });
  h.run(1.5);
  assert.equal(bySource(h, e).length, n, 'only once');

  const blocked = fight({ units: [{ chessId: 't_wall', row: 9, col: 6 }] });
  blocked.step(1);
  const b2 = put(blocked, KEY, [9, 6]);
  blocked.step(1);
  assert.ok(b2.blockedBy);
  blocked.b.dealDamage(null, b2, { amount: 10, type: 'true' });
  assert.equal(b2.findBuff('reg:boomerBomb'), null, 'blocked: no 掷弹模式');
  assert.equal(h.b.errors.length + blocked.b.errors.length, 0);
});

test('萨卡兹子裔补给车: each 重生造物 gets ATK +10 % per cart of a kind (5 at most) and that many 10 % 凋亡 riders on its attacks; 改装 counts apart; silence stops a cart (PRTS)', () => {
  const CART = 'enemy_1224_dsuply', CART_2 = 'enemy_1224_dsuply_2', TOUCH = 'enemy_1220_dzoms';
  const bb = V.enemies[CART].talents.bb;
  assert.deepEqual([bb['aura.enemy_dsuply_t[attr_buff].atk'], bb['aura.enemy_dsuply_t[attr_buff].max_valid_stack_cnt'], bb['aura.ep_damage_ratio']], [0.1, 5, 0.1]);
  const h = fight({ units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['damaged'], captureNoisy: true });
  h.step(1);
  const z = put(h, TOUCH, [9, 5]);
  h.step(2);
  const a0 = z.s.atk;
  assert.equal(a0, V.enemies[TOUCH].stats.atk);
  const carts = [put(h, CART, [12, 8]), put(h, CART, [12, 9])];
  put(h, CART_2, [12, 10]);
  h.step(2);
  assert.ok(near(z.s.atk, a0 * 1.3), `2 + 1 carts: ${z.s.atk}`);
  const from = bySource(h, z).length;
  assert.equal(h.runUntil(() => bySource(h, z).length >= from + 3, 6), true);
  const hit = bySource(h, z).slice(from);
  const phys = hit.find((c) => c.type === 'phys');
  assert.ok(near(phys.amount, z.s.atk), 'the boosted ATK hits (wall DEF 0)');
  const riders = hit.filter((c) => c.type === 'element' && c.dmg.element === 'apoptosis').map((c) => c.amount).sort((p, q) => p - q);
  assert.equal(riders.length, 2, 'one 凋亡 instance per cart kind');
  assert.ok(near(riders[0], z.s.atk * 0.1) && near(riders[1], z.s.atk * 0.2), riders.join(', '));
  h.b.applyStatus(carts[0], 'silence', { duration: 30 });
  h.run(0.3);
  assert.ok(near(z.s.atk, a0 * 1.2), `a silenced cart counts for nothing: ${z.s.atk}`);
  for (let i = 0; i < 6; i++) put(h, CART, [12, 3 + i * 0.5]);
  h.step(2);
  assert.ok(near(z.s.atk, a0 * (1 + 0.5 + 0.1)), `at most 5 stacks of a kind: ${z.s.atk}`);
  assert.equal(carts[0].profile.canTarget({ isFlying: true }), false, '不会攻击飞行单位');
  assert.equal(h.b.errors.length, 0);
});

test('新生血裔: melee arts at ATK × (1 + 0.2 × the enemies its target blocks), heals 220 % of the damage dealt, leaves a 血珀 (PRTS)', () => {
  const KEY = 'enemy_1360_dfello';
  const rec = V.enemies[KEY];
  assert.deepEqual([rec.talents.bb['DamageUp.scale_ratio'], rec.talents.bb['DamageUp.add_on'], rec.talents.bb['vampire.heal_scale']], [0.2, 1, 2.2]);
  const h = fight({ units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['damaged', 'heal'], captureNoisy: true });
  h.step(1);
  const wall = h.unit('t_wall');
  const e = put(h, KEY, [9, 5]);
  put(h, 'enemy_1000_gopro_2', [9, 5]);
  h.step(2);
  assert.equal(wall.blocking.length, 2);
  e.hp = e.s.maxHp * 0.5;
  assert.equal(h.runUntil(() => bySource(h, e).length >= 1, 5), true);
  const c = bySource(h, e)[0];
  assert.equal(c.type, 'arts');
  assert.ok(near(c.amount, rec.stats.atk * 1.4), `${c.amount}`);
  const healed = h.hooksOf('heal').filter((x) => x.target === e);
  assert.equal(healed.length, 1);
  assert.ok(near(healed[0].amount, c.amount * 2.2), `${healed[0].amount}`);
  const total = h.b.total;
  h.b.kill(e, null);
  h.step(1);
  const seeds = living(h, 'enemy_1367_dseed');
  assert.equal(seeds.length, 1, 'one 血珀 (Summon.cnt)');
  assert.equal(seeds[0].counted, false);
  assert.equal(h.b.total, total);
  assert.equal(h.b.errors.length, 0);
});

test('萨卡兹子裔轰击者 / 毁击者: the shell lands where the target stood and blows up 4 s later on every ally within 1.1 (PRTS)', () => {
  for (const key of ['enemy_1361_dthrow', 'enemy_1361_dthrow_2']) {
    const rec = V.enemies[key];
    assert.deepEqual([rec.talents.bb['Attack.attack@projectile_delay_time'], rec.talents.bb['Attack.attack@projectile_radius']], [4, 1.1], key);
    const h = fight({
      units: [
        { chessId: 't_gun', row: 9, col: 7, uid: 1 },   // the target (nearest)
        { chessId: 't_gun', row: 10, col: 7, uid: 2 },  // 1.0 from it
        { chessId: 't_gun', row: 11, col: 7, uid: 3 },  // 2.0 from it, out of the dthrow's reach too
      ],
      hooks: ['damaged'], captureNoisy: true,
    });
    h.step(1);
    const e = put(h, key, [9, 8.5]);
    assert.equal(h.runUntil(() => h.eventsOf('atk').some((ev) => ev[1] === e.id), 5), true, key);
    const t0 = h.b.time;
    assert.equal(h.eventsOf('atk').find((ev) => ev[1] === e.id)[3], 'bomb', key);
    h.run(3.9);
    assert.equal(bySource(h, e).length, 0, `${key}: nothing before the 4 s fuse`);
    h.runUntil(() => h.b.time >= t0 + 4.5, 2);
    for (const uid of [1, 2]) assert.ok(near(byUid(h, uid).stats.taken, rec.stats.atk), `${key} uid ${uid}: ${byUid(h, uid).stats.taken}`);
    assert.equal(byUid(h, 3).stats.taken, 0, key);
    assert.equal(h.b.errors.length, 0, key);
  }
});

test('萨卡兹骸骨卫士长: an ally that damages it loses 40 ASPD for 5 s, neither stacked nor restarted by more hits; a 无来源 hit names nobody (PRTS)', () => {
  const KEY = 'enemy_1363_spnshd_2';
  assert.deepEqual([V.enemies[KEY].talents.bb['Summon.attack_speed'], V.enemies[KEY].talents.bb['Summon.duration']], [-40, 5]);
  const chess = { ...CHESS, t_post: T_POST, t_hit: chessRec({ id: 't_hit', profession: 'SNIPER', projectile: 'none', stats: { atk: 100, maxHp: 1e7, def: 0, res: 0, blockCnt: 0, bat: 1 }, rangeGrid: BIG, skill: null }) };
  const h = fight({ defs: { enemies: V.enemies, chess }, units: [{ chessId: 't_hit', row: 9, col: 4 }, { chessId: 't_post', row: 10, col: 4 }] });
  h.step(1);
  const u = h.unit('t_hit');
  const aspd0 = u.s.aspd;
  const e = put(h, KEY, [9, 8]);
  assert.equal(h.runUntil(() => !!u.findBuff('reg:spnshdSlow'), 5), true);
  const t0 = h.b.time;
  const first = u.findBuff('reg:spnshdSlow');
  assert.equal(u.s.aspd, aspd0 - 40);
  h.run(4.5);
  assert.ok(e.stats.taken > 0);
  assert.equal(u.findBuff('reg:spnshdSlow'), first, 'the same instance (later hits do not restart it)');
  assert.equal(u.s.aspd, aspd0 - 40, 'not stacked');
  h.runUntil(() => u.findBuff('reg:spnshdSlow') !== first, 1);
  assert.ok(h.b.time - t0 <= 5.05, `the first one ran out after ${h.b.time - t0} s`);
  const post = h.unit('t_post');
  assert.equal(post.findBuff('reg:spnshdSlow'), null, 'an ally that never hit it');
  h.b.dealDamage(null, e, { amount: 10, type: 'true' });
  assert.equal(post.findBuff('reg:spnshdSlow'), null, 'a 无来源 hit names nobody');
  assert.equal(h.b.errors.length, 0);
});

test('狂暴凶豕兽: weight 2; rush layers +33.3 % after the 3 s predelay; the crash on a low-ground ally and the first hit while rushing deal move speed × 800 / × 600; the hit ends the rush (PRTS)', () => {
  const KEY = 'enemy_1309_mhboar_2';
  const bb = V.enemies[KEY].talents.bb;
  assert.deepEqual([bb['Crash.atk_scale'], bb['FirstAttack.atk_scale'], bb['Rush.mhboar_t_predelay.predelay']], [800, 600, 3]);
  const h = fight({
    defs: { enemies: V.enemies, chess: { ...CHESS, t_wall1: T_WALL1 } },
    units: [{ chessId: 't_wall1', row: 9, col: 6 }, { chessId: 't_wall', row: 9, col: 3 }],
  });
  const extra = [];
  h.b.on('damaged', (c) => {
    const tag = c.dmg && c.dmg.tags.find((t) => t === 'boarCrash' || t === 'boarRush');
    if (tag) extra.push({ tag, amount: c.amount, speed: c.source.s.moveSpeed, target: c.target, calc: c.dmg.calculation, way: c.dmg.applyWay });
  });
  h.step(1);
  const low = h.unit('t_wall1'), wall = h.unit('t_wall');
  const e = h.spawn(KEY, { pos: [9, 10], route: walkLeft(9, 10) });
  assert.equal(e.blockWeight, 2);
  const base = e.s.moveSpeed;
  h.run(3.15);
  assert.ok(near(e.s.moveSpeed, base), 'every try inside the predelay fails');
  h.run(0.3);
  assert.ok(near(e.s.moveSpeed, base * (1 + bb['Rush.mhboar_t[trigger].move_speed'])), `the first layer: ${e.s.moveSpeed}`);
  assert.equal(h.runUntil(() => e.blockedBy === wall, 20), true, 'the blockCnt-3 wall blocks it');
  const crash = extra.filter((x) => x.tag === 'boarCrash');
  assert.equal(crash.length, 1, 'the blockCnt-1 ally it passed: once');
  assert.equal(crash[0].target, low);
  assert.ok(near(crash[0].amount, crash[0].speed * 800), `${crash[0].amount} vs ${crash[0].speed}`);
  assert.deepEqual([crash[0].calc, crash[0].way], ['precomputed', 'MELEE']);
  assert.ok(crash[0].speed > base * 2, 'it had accelerated by then');
  assert.equal(h.runUntil(() => extra.some((x) => x.tag === 'boarRush'), 6), true);
  const rush = extra.find((x) => x.tag === 'boarRush');
  assert.equal(rush.target, wall);
  assert.ok(near(rush.amount, rush.speed * 600));
  h.step(1);
  assert.ok(near(e.s.moveSpeed, base), 'the hit ended the rush and its layers');
  h.run(4);
  assert.ok(near(e.s.moveSpeed, base), 'blocked: no new rush');
  assert.equal(extra.filter((x) => x.tag === 'boarRush').length, 1);

  const s = fight();
  const b2 = s.spawn(KEY, { pos: [9, 10], route: { motion: 'WALK', start: [9, 10], end: [9, 2], steps: [{ t: 'move', p: [9, 9.9] }, { t: 'wait', s: 999 }] } });
  s.run(5);
  assert.ok(b2.findBuff('reg:boarRush'), 'layers while rushing in place');
  s.b.applyStatus(b2, 'stun', { duration: 1 });
  s.run(0.15);
  assert.equal(b2.findBuff('reg:boarRush'), null, '晕眩 ends the rush');
  assert.equal(h.b.errors.length + s.b.errors.length, 0);
});

test('神勇的帕拉杜利斯 冲锋: with an ally ahead in its row it marks that tile, charges unblockable and hits the first ground ally for 200 % ATK once, then walks and fights again (PRTS)', () => {
  const KEY = 'enemy_10163_mnctur_2';
  const rec = V.enemies[KEY];
  const rush = rec.skills.find((s) => s.prefabKey === 'rush');
  assert.deepEqual([rush.initCooldown, rush.cooldown, rec.talents.bb['CollideChar.atk_scale_collide']], [5, 10, 2]);
  const h = fight({ units: [{ chessId: 't_wall', row: 9, col: 4 }], hooks: ['damaged'], captureNoisy: true });
  h.step(1);
  const wall = h.unit('t_wall');
  const e = h.spawn(KEY, { pos: [9, 8], route: walkLeft(9, 8) });
  h.run(4.8);
  assert.equal(e.findBuff('reg:mncturMark'), null, 'inside the initial cooldown');
  assert.equal(h.runUntil(() => !!e.findBuff('reg:mncturRun'), 2), true, 'the charge starts after the 1 s mark');
  assert.equal(e.s.flags.unblockable, true);
  assert.equal(e.s.flags.disarm, true);
  const charge = h.eventsOf('fx').find((ev) => ev[1] === 'charge' && ev[4].id === e.id);
  assert.ok(charge && charge[4].tx === 4 && charge[4].ty === 9, 'at the marked tile');
  assert.equal(h.runUntil(() => bySource(h, e).length >= 1, 10), true);
  const hit = bySource(h, e)[0];
  assert.equal(hit.target, wall);
  assert.ok(hit.dmg.tags.includes('mncturRush'));
  assert.ok(near(hit.amount, rec.stats.atk * 2), `${hit.amount}`);
  assert.ok(Math.hypot(e.x - wall.x, e.y - wall.y) <= 0.45 + 1e-6);
  h.step(1);
  assert.equal(e.findBuff('reg:mncturRun'), null, 'back to its initial mode');
  assert.equal(e.blockedBy, wall);
  assert.equal(h.runUntil(() => bySource(h, e).length >= 2, 6), true);
  assert.ok(near(bySource(h, e)[1].amount, rec.stats.atk), 'a normal attack');
  assert.equal(bySource(h, e).filter((c) => c.dmg.tags.includes('mncturRush')).length, 1);
  assert.equal(h.b.errors.length, 0);
});

test('诡核 / 异光体集养者: below half HP after a hit, one split of its own key around its tile centre with its HP ratio, uncounted and unable to split; silence waits; once (PRTS)', () => {
  for (const key of ['enemy_1436_dsdivi', 'enemy_1436_dsdivi_2']) {
    const rec = V.enemies[key];
    assert.equal(rec.talents.bb['0.hp_ratio'], 0.5, key);
    assert.equal(rec.skills[0].bb.offset_bound, 0.3, key);
    const h = fight();
    const e = put(h, key, [9, 8]);
    h.step(1);
    h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.3, type: 'true' });
    assert.equal(h.enemies().length, 1, `${key}: still above half`);
    h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.3, type: 'true' });
    const kids = h.enemies().filter((o) => o !== e);
    assert.equal(kids.length, 1, key);
    const k = kids[0];
    assert.equal(k.defId, key);
    assert.ok(Math.abs(k.x - 8) <= 0.3 + 1e-9 && Math.abs(k.y - 9) <= 0.3 + 1e-9, `${key}: ${k.x}, ${k.y}`);
    assert.ok(near(k.hpRatio, e.hpRatio), `${key}: ${k.hpRatio}`);
    assert.equal(k.counted, false);
    h.b.dealDamage(null, k, { amount: 1, type: 'true' });
    h.b.dealDamage(null, e, { amount: 1, type: 'true' });
    assert.equal(h.enemies().length, 2, `${key}: neither splits again`);
    assert.equal(h.b.errors.length, 0, key);
  }
  const s = fight();
  const e = put(s, 'enemy_1436_dsdivi', [9, 8]);
  s.step(1);
  s.b.applyStatus(e, 'silence', { duration: 1 });
  s.b.dealDamage(null, e, { amount: e.s.maxHp * 0.6, type: 'true' });
  assert.equal(s.enemies().length, 1, 'silenced: no split');
  s.run(1.2);
  assert.equal(s.enemies().length, 1, 'no new modifier yet');
  s.b.dealDamage(null, e, { amount: 1, type: 'true' });
  assert.equal(s.enemies().length, 2, 'the next hit after the silence splits it');
  assert.equal(s.b.errors.length, 0);
});
