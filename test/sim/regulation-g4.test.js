// test/sim/regulation-g4.test.js — 规程·序列Ⅰ: Reborn Creations (萨卡兹子裔 summons), “喷射罐” / “喷爆罐”,
// MAP10 盐坨子炮 (trap_196_cnnon), and MAP12 优化模块 (tile_speedup).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData, getVersionData } from '../../server/data.js';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import * as devicesMod from '../../server/sim/content/devices.js';
import { GEO } from '../../shared/constants.js';
import { parseStage } from '../../public/js/render/tiles.js';
import { classifyStage, stageDevices, AREAS } from '../../public/js/render/board3d/layout.js';

const V = getVersionData('act3autochess@V3_1');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const waitAt = (y, x, motion = 'WALK') => ({ motion, start: [y, x], end: [y, x], steps: [{ t: 'wait', s: 99999 }] });

const CHESS = {
  wall1: chessRec({ id: 'wall1', profession: 'GUARD', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 1 }, rangeGrid: [[0, 0]], skill: null }),
  wall3: chessRec({ id: 'wall3', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null }),
  gun: chessRec({ id: 'gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 0 }, rangeGrid: [[0, 0], [0, 1]], skill: null }),
  casterUp: chessRec({ id: 'casterUp', profession: 'CASTER', projectile: 'none', stats: { atk: 40000, maxHp: 1e7, def: 0, res: 0, bat: 0.5, blockCnt: 0 }, rangeGrid: [[0, 0], [0, 1]], skill: null }),
};

// 1. 萨卡兹子裔 summons (enemy_1220_dzoms/_2, enemy_1221_dzomg/_2)
test('Reborn Creations take 90% less phys/arts damage (unsilenceable, true dmg untouched) and grant +1 blockCnt (max +6) to their blocker', () => {
  const keys = ['enemy_1220_dzoms', 'enemy_1220_dzoms_2', 'enemy_1221_dzomg', 'enemy_1221_dzomg_2'];
  for (const k of keys) {
    assert.equal(V.enemies[k].talents.bb['dmg_res.damage_resistance'], 0.9, k);
    assert.equal(V.enemies[k].talents.bb['buff_to_blocker.block_cnt'], 1, k);
    assert.equal(V.enemies[k].talents.bb['buff_to_blocker.max_valid_stack_cnt'], 6, k);
  }

  const h = makeBattle({
    flat: true, content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 1, autoFinish: false, timeLimit: 30,
    defs: { enemies: V.enemies, chess: CHESS },
    units: [{ chessId: 'wall1', row: 10, col: 6 }],
  });
  h.step(1);
  const wall = h.unit('wall1');
  const dzoms = h.spawn('enemy_1220_dzoms', { pos: [10, 6], route: waitAt(10, 6) });
  const dzomg = h.spawn('enemy_1221_dzomg_2', { pos: [10, 8], route: waitAt(10, 8) });
  const fodder = h.spawn('enemy_1000_gopro_2', { pos: [10, 6], route: waitAt(10, 6) });
  h.step(2);

  // 90% physical & arts damage reduction, unsilenceable; true damage unreduced.
  assert.ok(near(dzoms.s.physTakenMul, 0.1));
  assert.ok(near(dzoms.s.artsTakenMul, 0.1));
  assert.ok(near(dzomg.s.physTakenMul, 0.1));
  assert.ok(near(dzomg.s.artsTakenMul, 0.1));
  h.b.applyStatus(dzoms, 'silence', { duration: 10, force: true });
  // dzoms DEF=100, RES=10: (500 - 100) * 0.1 = 40 phys; 500 * 0.9 * 0.1 = 45 arts; 500 true.
  assert.ok(near(h.b.dealDamage(wall, dzoms, { amount: 500, type: 'phys', canDodge: false }), 40));
  assert.ok(near(h.b.dealDamage(wall, dzoms, { amount: 500, type: 'arts', canDodge: false }), 45));
  assert.ok(near(h.b.dealDamage(wall, dzoms, { amount: 500, type: 'true', canDodge: false }), 500));

  // Blocker gains +1 blockCnt per blocked Reborn Creation, so wall1 (base 1) blocks both dzoms and fodder.
  assert.equal(dzoms.blockedBy, wall);
  assert.equal(wall.s.blockCnt, 2);
  assert.equal(fodder.blockedBy, wall);

  // The bonus is granted when a creation is blocked (enemy_bloodsucker_block_cnt). A full blocker takes no further
  // enemy, so the fodder has to leave before more copies can raise the cap. Each newly blocked copy adds 1, up to 6.
  h.b.kill(fodder, wall);
  h.step(1);
  assert.equal(wall.s.blockCnt, 2);
  const extras = [];
  for (let i = 0; i < 7; i++) extras.push(h.spawn('enemy_1220_dzoms_2', { pos: [10, 6], route: waitAt(10, 6) }));
  h.step(2);
  assert.equal(wall.s.blockCnt, 7); // 1 base + 6 max stacks
  assert.equal(extras.filter((x) => x.blockedBy === wall).length, 6);
  assert.equal(extras.filter((x) => !x.blockedBy).length, 1);
  h.b.kill(dzoms, wall);
  for (const x of extras) h.b.kill(x, wall);
  h.step(1);
  assert.equal(wall.s.blockCnt, 1);

  // Death-spawned child from 萨卡兹子裔战士 inherits the kit too.
  const h2 = makeBattle({
    flat: true, content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 1, autoFinish: false, timeLimit: 30,
    defs: { enemies: V.enemies, chess: CHESS },
  });
  const parent = h2.spawn('enemy_1222_dpvt', { pos: [10, 7], route: waitAt(10, 7) });
  h2.b.kill(parent, null);
  h2.run(1.2);
  const child = h2.enemies().find((e) => e.defId === 'enemy_1220_dzoms');
  assert.ok(child);
  assert.ok(near(child.s.physTakenMul, 0.1));
  assert.ok(near(child.s.artsTakenMul, 0.1));
  checkInvariants(h.b);
});

// 2. “喷射罐” / “喷爆罐” (enemy_1385_winbom, enemy_1385_winbom_2)
test('喷射罐 / 喷爆罐 channels 3 spray hits per attack, stands through an unblocked spray, and explodes with arts + cold on death unless silenced', () => {
  for (const k of ['enemy_1385_winbom', 'enemy_1385_winbom_2']) {
    const t = V.enemies[k].talents.bb;
    assert.equal(t['Boom.attack@times'], 3, k);
    assert.equal(t['Boom.attack@cooldown'], 4, k);
    assert.equal(t['Boom.atk_scale'], 1, k);
    assert.equal(t['Boom.freeze'], 10, k);
  }

  // Blocked: sprays 3 hits per 4s cycle (0s, 1s, 2s; 4s, 5s, 6s; 8s, 9s, 10s -> 9 hits in 10.1s).
  const h = makeBattle({
    flat: true, content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 1, autoFinish: false, timeLimit: 30,
    defs: { enemies: V.enemies, chess: CHESS },
    units: [{ chessId: 'wall3', row: 10, col: 6 }],
  });
  h.step(1);
  const wall = h.unit('wall3');
  let hits = 0;
  h.b.on('damaged', (c) => { if (c.target === wall && c.dmg?.isAttack) hits++; });
  const wb = h.spawn('enemy_1385_winbom', { pos: [10, 6], route: waitAt(10, 6) });
  h.run(2.3);
  assert.equal(hits, 3, 'first spray lands 3 arts hits over 2s');
  h.run(7.9); // total 10.2s: 3 sprays = 9 hits (3600 dmg vs 0 RES)
  assert.equal(hits, 9);

  // Death explosion deals 100% ATK arts and applies 10s cold; silenced death does neither.
  const beforeBoom = wall.hp;
  h.b.kill(wb, wall);
  assert.ok(near(beforeBoom - wall.hp, 400));
  assert.equal(wall.s.flags.cold, true);

  const hSil = makeBattle({
    flat: true, content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 1, autoFinish: false, timeLimit: 30,
    defs: { enemies: V.enemies, chess: CHESS },
    units: [{ chessId: 'wall3', row: 10, col: 6 }],
  });
  hSil.step(1);
  const wSil = hSil.unit('wall3');
  const wb2 = hSil.spawn('enemy_1385_winbom_2', { pos: [10, 6], route: waitAt(10, 6) });
  hSil.b.applyStatus(wb2, 'silence', { duration: 10, force: true });
  const hpSil = wSil.hp;
  hSil.b.kill(wb2, wSil);
  assert.equal(hpSil - wSil.hp, 0);
  assert.ok(!wSil.s.flags.cold);

  // Unblocked walking past an adjacent ally: stands to finish the 3-hit spray; stun cuts an active spray short.
  const hWalk = makeBattle({
    flat: true, content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 1, autoFinish: false, timeLimit: 30,
    defs: { enemies: V.enemies, chess: CHESS },
    units: [{ chessId: 'wall3', row: 11, col: 6 }],
  });
  hWalk.step(1);
  const sideUnit = hWalk.unit('wall3');
  let walkHits = 0;
  hWalk.b.on('damaged', (c) => { if (c.target === sideUnit && c.dmg?.isAttack) walkHits++; });
  const walker = hWalk.spawn('enemy_1385_winbom', { pos: [10, 8], route: { motion: 'WALK', start: [10, 8], end: [10, 2], steps: [] } });
  const reached = hWalk.runUntil(() => walkHits >= 1, 5);
  assert.equal(reached, true);
  const xAtStart = walker.x;
  hWalk.run(1.5);
  assert.ok(Math.abs(walker.x - xAtStart) < 0.05, 'stands still while channeling Attack_Loop');
  hWalk.run(1.0);
  assert.ok(walkHits >= 3, 'finishes at least one full 3-hit spray before walking past');
  checkInvariants(h.b);
  checkInvariants(hWalk.b);
});

// 3. MAP10 盐坨子炮 (trap_196_cnnon)
test('MAP10 盐坨子炮: built role, 2D/3D props, loaded projectile + mass<=3 passenger across normal, unite and boss fields, and destruction', () => {
  const m10 = V.stages.act3autochess_m10;
  const cannons = m10.devices.filter((d) => d.key === 'trap_196_cnnon');
  assert.equal(cannons.length, 4);
  for (const d of cannons) assert.equal(d.role, 'cannon');
  assert.deepEqual(cannons.map((d) => d.pos), [[13, 6], [13, 14], [6, 6], [6, 14]]);

  // 2D and 3D board classification include the cannons on rows 13 and 6.
  const g3dNormal = classifyStage(m10, AREAS.normal);
  const d3dNormal = stageDevices(m10, g3dNormal).filter((d) => d.kind === 'cannon');
  assert.ok(d3dNormal.some((d) => d.r === 13 && d.c === 6));
  const g3dBoss = classifyStage(m10, AREAS.boss);
  const d3dBoss = stageDevices(m10, g3dBoss).filter((d) => d.kind === 'cannon');
  assert.deepEqual(d3dBoss.map((d) => [d.r, d.c]), [[6, 6], [6, 14]]);
  assert.ok(parseStage(m10));

  // Normal field: only [13, 6] spawns. The stage runes apply once (ATK 1200−300, HP 30000+30000, 6 SP ×3): at 18 s it deals
  // 900 phys splash on landing at [9, 6], releasing one loaded mass<=3 ground enemy.
  const h = makeBattle({
    stage: m10, rect: GEO.NORMAL_RECT, content: 'generic', extraContent: [enemiesMod, bossesMod, devicesMod],
    seed: 1, autoFinish: false, timeLimit: 30,
    defs: { enemies: V.enemies, chess: CHESS },
    units: [{ chessId: 'wall3', row: 9, col: 6 }],
  });
  h.step(1);
  const wall = h.unit('wall3');
  const liveCannons = h.b.enemies.filter((u) => u.defId === 'trap_196_cnnon');
  assert.equal(liveCannons.length, 1);
  assert.deepEqual([liveCannons[0].tileR, liveCannons[0].tileC], [13, 6]);
  assert.equal(liveCannons[0].s.maxHp, 60000);
  assert.equal(liveCannons[0].s.atk, 900);
  assert.equal(liveCannons[0].base.def, 3000);
  assert.equal(liveCannons[0].s.blockCnt, 0);

  // Heavy (mass 4) and a flyer are not taken. The sailor boards before the shot and reappears on landing.
  const heavy = h.spawn('enemy_1006_shield', { pos: [12, 5], route: waitAt(12, 5) });
  heavy.base.massLevel = 4; heavy.markDirty();
  const flyer = h.spawn('enemy_9027_acfnca', { pos: [12, 7], route: waitAt(12, 7, 'FLY') });
  const sailor = h.spawn('enemy_10043_sailor', { pos: [12, 6], route: waitAt(12, 6) });
  h.step(2);
  assert.equal(heavy.hidden, false);
  assert.equal(flyer.hidden, false);
  assert.equal(sailor.hidden, true);

  const hpBefore = wall.hp;
  h.run(6.1);
  assert.equal(wall.hp, hpBefore, 'no shot at 9 s: the ×3 rune makes it 18 s');
  h.run(12.1);
  assert.ok(h.b.time > 18 && h.b.time < 18.6);
  assert.equal(wall.hp, hpBefore, 'the shell is still in flight');
  h.run(.8);
  assert.ok(near(hpBefore - wall.hp, 900), 'cannon shell deals 900 physical splash at [9, 6] on landing');
  assert.equal(sailor.hidden, false);
  assert.equal(Math.round(sailor.y), 9);
  assert.equal(Math.round(sailor.x), 6);
  assert.ok(sailor.findBuff('ab:sailorCannon'), '寻险水手 gains brief move-speed boost on cannon teleport');
  assert.equal(Math.round(heavy.y), 12);
  assert.equal(Math.round(heavy.x), 5);
  assert.equal(Math.round(flyer.y), 12);
  assert.equal(Math.round(flyer.x), 7);

  const cannonPos = (battle) => battle.enemies.filter((u) => u.defId === 'trap_196_cnnon').map((u) => [u.tileR, u.tileC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Unite field spawns both [13, 6] and [13, 14]; Boss field spawns both [6, 6] and [6, 14].
  const hUnite = makeBattle({
    stage: m10, kind: 'unite', rect: GEO.UNITE_RECT, content: 'generic', extraContent: [enemiesMod, bossesMod, devicesMod],
    seed: 1, autoFinish: false, timeLimit: 20, defs: { enemies: V.enemies, chess: CHESS },
  });
  hUnite.step(1);
  assert.deepEqual(cannonPos(hUnite.b), [[13, 6], [13, 14]]);

  const hBoss = makeBattle({
    stage: m10, kind: 'boss', rect: GEO.BOSS_RECT, content: 'generic', extraContent: [enemiesMod, bossesMod, devicesMod],
    seed: 1, autoFinish: false, timeLimit: 20, defs: { enemies: V.enemies, chess: CHESS },
  });
  hBoss.step(1);
  assert.deepEqual(cannonPos(hBoss.b), [[6, 6], [6, 14]]);

  // Operator facing UP at [12, 6] can attack the separator cannon. Its one-HP final shot releases the passenger.
  const hKill = makeBattle({
    stage: m10, rect: GEO.NORMAL_RECT, content: 'generic', extraContent: [enemiesMod, bossesMod, devicesMod],
    seed: 1, autoFinish: false, timeLimit: 20,
    defs: { enemies: V.enemies, chess: CHESS },
    units: [{ chessId: 'casterUp', row: 12, col: 6, dir: 'UP' }],
  });
  hKill.step(1);
  const cn = hKill.b.enemies.find((u) => u.defId === 'trap_196_cnnon');
  const pass = hKill.spawn('enemy_10043_sailor', { pos: [12, 6], route: waitAt(12, 6) });
  hKill.step(2);
  assert.equal(pass.hidden, true);
  const killed = hKill.runUntil(() => !cn.alive, 15);
  assert.equal(killed, true, 'caster facing UP destroys the 60000 HP cannon');
  assert.equal(pass.hidden, false);
  assert.deepEqual([Math.round(pass.y), Math.round(pass.x)], [9, 6]);
  checkInvariants(h.b);
  checkInvariants(hKill.b);
});

// 4. MAP12 【莱塔尼亚】 优化模块 (tile_speedup)
test('MAP12 tile_speedup: allies keep +25 ASPD after leaving; ground enemies keep 1.5x move and gain no ASPD', () => {
  const m12 = V.stages.act3autochess_m12;
  assert.deepEqual(m12.special.speedup, { attack_speed: 25, move_speed: 1.5 });

  const h = makeBattle({
    stage: m12, rect: GEO.NORMAL_RECT, content: 'generic', extraContent: [enemiesMod, bossesMod, devicesMod],
    seed: 1, autoFinish: false, timeLimit: 40,
    defs: { enemies: V.enemies, chess: CHESS },
    units: [{ chessId: 'gun', row: 9, col: 7 }],
  });
  h.step(1);
  const op = h.unit('gun');
  assert.equal(op.s.aspd, 125);
  assert.equal(op.findBuff('terrain:speedup')?.mods?.moveMul, undefined, 'allies get ASPD only, no moveMul');

  // The derived ASPD buff is not finished when the tile buff ends, and a second step on z does not stack it.
  assert.equal(h.b.relocate(op, 9, 6), true);
  h.step(1);
  assert.ok(op.findBuff('terrain:speedup'), 'ally ASPD child outlives the tile');
  assert.equal(op.s.aspd, 125);
  assert.equal(h.b.relocate(op, 9, 7), true);
  h.step(1);
  assert.equal(op.s.aspd, 125);

  // Ground enemy walks across [9, 7] ('z') and keeps 1.5x moveSpeed (and 100 ASPD!) after leaving [9, 7] all the way into [9, 2] ('E').
  const e = h.spawn('enemy_1381_winman', {
    pos: [9, 9],
    route: { motion: 'WALK', start: [9, 9], end: [9, 2], steps: [] },
  });
  const onZ = h.runUntil(() => Math.round(e.y) === 9 && Math.round(e.x) === 7 && !!e.findBuff('terrain:speedup'), 5);
  assert.equal(onZ, true);
  assert.equal(e.s.aspd, 100, 'official tile_speedup grants enemies 0 ASPD');
  assert.ok(near(e.s.moveSpeed, 0.9 * 1.5));

  const pastZ = h.runUntil(() => Math.round(e.x) <= 5, 5);
  assert.equal(pastZ, true);
  assert.ok(e.findBuff('terrain:speedup'), 'enemy keeps speedup buff after leaving the tile');
  assert.equal(e.s.aspd, 100);
  assert.ok(near(e.s.moveSpeed, 0.9 * 1.5));

  const leaked = h.runUntil(() => !e.alive, 20);
  assert.equal(leaked, true);
  assert.equal(e.removeReason, 'leak');
  assert.equal(h.b.leakedCount, 1);
  assert.ok(h.b.time < 16, `boosted enemy reaches blue door in ${h.b.time.toFixed(2)}s (<16s vs 19.3s unboosted)`);

  // Rebirth cleanses the enemy's terrain speedup buff off 'z' (PRTS §重生).
  const hReb = makeBattle({
    stage: m12, rect: GEO.NORMAL_RECT, content: 'generic', extraContent: [enemiesMod, bossesMod, devicesMod],
    seed: 1, autoFinish: false, timeLimit: 30,
    defs: { enemies: V.enemies, chess: CHESS },
  });
  const titus = hReb.spawn('enemy_1104_lfkght_3', { pos: [9, 7], route: waitAt(9, 7) });
  hReb.step(2);
  assert.ok(titus.findBuff('terrain:speedup'));
  titus.x = 6; titus.y = 9;
  hReb.step(2);
  assert.ok(titus.findBuff('terrain:speedup'), 'still boosted off z before KO');
  hReb.b.kill(titus, null);
  assert.equal(titus.findBuff('terrain:speedup'), null, 'rebirthCleanse clears terrain speedup');

  // Default season has none of the 规程 stages/devices.
  assert.equal(getData().stages.act3autochess_m10, undefined);
  assert.equal(getData().stages.act3autochess_m12, undefined);
  checkInvariants(h.b);
});
