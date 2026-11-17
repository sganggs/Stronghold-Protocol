// Official limits (docs/research/11-limits-official.md; the user asked for the co-op leaders to be as hard to kill as
// officially): (1) bond layers stop at 999 per bond — the client's AutoChessBattleConst.MAX_GARRISON_STACK and
// AddBondCount `min(L + n, 999)`; (2) the boss-hit limit "限伤" — in a boss battle outside training (our kinds 'boss' /
// 'hidden'), a single hit on a leader (AutoChessBattleUtil.IsBossEnemy) whose ceil(damage) ≥ 300000
// (AutoChessBattleConst.MAX_BATTLE_DAMAGE) is cancelled: 0 damage, nothing credited to the shared pool.
//
// This file: the switches (shared/constants.js), the in-battle layer copy (Battle.addLayers / support.gainLayers) and
// the hit limit in the damage pipeline (server/sim/attack/health.js leaderHitCancelled: Battle.dealDamage, Battle.dealHPLose).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOND_LAYER_CAP, BOSS_HIT_LIMIT, layerGainRoom } from '../../shared/constants.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { gainLayers } from '../../server/sim/content/support/index.js';
import { SharedBossPool } from '../../server/match/finalAssault.js';
import { LocalBossPool, buildBattleSpec, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { GameData } from '../../server/match/gamedata.js';
import { buildBossWave, setupMatchWaves } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { GEO } from '../../shared/constants.js';
import { getData } from '../../server/data.js';
import { leaderHitCancelled } from '../../server/sim/attack/health.js';
import { grantHitShield } from '../../server/sim/content/enemies/helpers.js';

const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
const LIMIT = BOSS_HIT_LIMIT;

test('switches: BOND_LAYER_CAP = 999 (MAX_GARRISON_STACK), BOSS_HIT_LIMIT = 300000 (MAX_BATTLE_DAMAGE)', () => {
  assert.equal(BOND_LAYER_CAP, 999);
  assert.equal(BOSS_HIT_LIMIT, 300000);
});

test('layerGainRoom: min(n, 999 − before), never negative, never lowers a count; +Infinity = the room left', () => {
  assert.equal(layerGainRoom(0, 5), 5);
  assert.equal(layerGainRoom(990, 5), 5);
  assert.equal(layerGainRoom(995, 10), 4, 'clamped to 999');
  assert.equal(layerGainRoom(999, 1), 0, 'a gain at the cap adds 0');
  assert.equal(layerGainRoom(1200, 3), 0, 'a count over the cap (a test write) gains 0 and is not lowered');
  assert.equal(layerGainRoom(300, Infinity), 699);
  assert.equal(layerGainRoom(undefined, 7), 7);
  assert.equal(layerGainRoom(NaN, 7), 7);
  for (const bad of [0, -3, NaN, null, undefined]) assert.equal(layerGainRoom(10, bad), 0);
});

// ---------------------------------------------------------------------------------------------------------------
// in-battle layer gains (the live copy, as the client's AddBondCount)

const opRec = (o = {}) => chessRec({ id: 't_op', profession: 'WARRIOR', stats: { atk: 300, maxHp: 1e6 }, skill: null, bonds: ['yanShip'], ...o });
function layerBattle(bonds, extra = {}) {
  return makeBattle({
    defs: { chess: { t_op: opRec() } },
    players: [{ playerId: 'P', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, chessId: 't_op', row: 10, col: 4 }], bonds, playerEffects: [] }],
    content: 'none', autoFinish: false, ...extra,
  });
}

test('Battle.addLayers: clamps the live copy at 999; the event and layerGains carry what was added; at the cap: 0, no hook, no event', () => {
  const h = layerBattle({ yanShip: { count: 3, active: true, tier: 1, layers: 990 } });
  h.step();
  const b = h.b;
  assert.equal(b.addLayers('P', 'yanShip', 4, 'garrison'), 4);
  assert.equal(b.getPlayer('P').bonds.yanShip.layers, 994);
  assert.equal(b.addLayers('P', 'yanShip', 20, 'garrison'), 5, 'only the room left (999 − 994)');
  assert.equal(b.getPlayer('P').bonds.yanShip.layers, 999);
  const hooks0 = h.hooksOf('layerGain').length;
  assert.equal(b.addLayers('P', 'yanShip', 3, 'garrison'), 0, 'a gain at the cap adds 0');
  assert.equal(h.hooksOf('layerGain').length, hooks0, 'no layerGain hook at the cap');
  assert.equal(b.getPlayer('P').bonds.yanShip.layers, 999);
  assert.deepEqual(h.eventsOf('layer').map((e) => e[3]), [4, 5], "'layer' events carry the clamped gains, none at the cap");
  assert.equal(h.result().perPlayer.P.layerGains.yanShip, 9, 'the result reports what was added');
});

test('Battle.addLayers: a layerGain hook that raises n (魔王 +1) is clamped after the hook', () => {
  const h = layerBattle({ yanShip: { count: 3, active: true, tier: 1, layers: 997 } }, {
    setup: (b) => b.on('layerGain', (c) => { c.n += 5; }),
  });
  h.step();
  assert.equal(h.b.addLayers('P', 'yanShip', 1, 'garrison'), 2, '1 + 5 asked, 2 room');
  assert.equal(h.b.getPlayer('P').bonds.yanShip.layers, 999);
});

test('Battle.addLayers without a live copy of the bond (partial input): the battle\'s own gains stop at 999', () => {
  const h = layerBattle({});
  h.step();
  assert.equal(h.b.addLayers('P', 'kjeragShip', 600, 'bond'), 600);
  assert.equal(h.b.addLayers('P', 'kjeragShip', 600, 'bond'), 399);
  assert.equal(h.b.addLayers('P', 'kjeragShip', 1, 'bond'), 0);
  assert.equal(h.result().perPlayer.P.layerGains.kjeragShip, 999);
});

test('support.gainLayers (特质 / bond gains): returns the clamped total; a capped bond counts nothing toward the per-battle cap', () => {
  const h = layerBattle({ yanShip: { count: 3, active: true, tier: 1, layers: 998 }, kjeragShip: { count: 2, active: true, tier: 1, layers: 10 } });
  h.step();
  assert.equal(gainLayers(h.b, { playerId: 'P', bonds: ['yanShip', 'kjeragShip'], n: 3, reason: 'garrison' }), 1 + 3);
  assert.equal(gainLayers(h.b, { playerId: 'P', bonds: 'yanShip', n: 3, reason: 'garrison', cap: 24, capKey: 'g' }), 0);
  const ps = h.b.getPlayer('P');
  assert.deepEqual([ps.bonds.yanShip.layers, ps.bonds.kjeragShip.layers], [999, 13]);
});

test('layer gains stay disabled in boss / 联防 fields (unchanged)', () => {
  const h = layerBattle({ yanShip: { count: 3, active: true, tier: 1, layers: 10 } }, { kind: 'boss' });
  h.step();
  assert.equal(h.b.addLayers('P', 'yanShip', 5, 'garrison'), 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 限伤: the boss-hit limit

const guardRec = () => chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 10, maxHp: 1e9 }, skill: null });
/** A field of `kind` with a leader (tag 'boss'), a minion and a part, all standing still; the shared pool when given. */
function hitField({ kind = 'boss', pool = null, leaderDef = 0, leaderRes = 0 } = {}) {
  const h = makeBattle({
    kind, sharedBoss: pool,
    defs: {
      chess: { t_guard: guardRec() },
      enemies: {
        enemy_lead: enemyRec({ key: 'enemy_lead', rank: 'BOSS', hp: 1e9, speed: 0, def: leaderDef, res: leaderRes }),
        enemy_mini: enemyRec({ key: 'enemy_mini', hp: 1e9, speed: 0 }),
        enemy_part: enemyRec({ key: 'enemy_part', rank: 'ELITE', hp: 1e9, speed: 0 }),
      },
    },
    players: [{ playerId: 'P', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, chessId: 't_guard', row: 10, col: 2 }], bonds: {}, playerEffects: [] }],
    enemies: kind === 'boss' || kind === 'hidden'
      ? [{ key: 'enemy_lead', pos: [3, 9], tag: 'boss' }, { key: 'enemy_mini', pos: [3, 12] }, { key: 'enemy_part', pos: [4, 12], tag: 'part' }]
      : [{ key: 'enemy_lead', pos: [10, 9], tag: 'boss' }, { key: 'enemy_mini', pos: [11, 9] }],
    content: 'none', autoFinish: false,
  });
  h.step();
  const leader = h.enemy('enemy_lead');
  const op = h.unit(1);
  assert.ok(leader && leader.isBoss, 'the leader is a boss unit');
  return { h, b: h.b, leader, mini: h.enemy('enemy_mini'), part: h.enemy('enemy_part'), op };
}
const capEvents = (h) => h.eventsOf('fx').filter((e) => e[1] === 'hitCap');

test('限伤: a leader\'s hit of 299999 lands, 300000 deals 0 — nothing credited to the shared pool, no number, a hitCap event', () => {
  const pool = new SharedBossPool(5e6);
  const { h, b, leader, op } = hitField({ pool });
  assert.equal(b.dealDamage(op, leader, { amount: LIMIT - 1, type: 'true' }), LIMIT - 1);
  assert.equal(pool.hp, 5e6 - (LIMIT - 1));
  assert.equal(pool.byPlayer.get('P'), LIMIT - 1);
  const dmg0 = h.eventsOf('dmg').length;
  const damaged0 = h.hooksOf('damaged').length;
  assert.equal(b.dealDamage(op, leader, { amount: LIMIT, type: 'true' }), 0, 'cancelled, not clamped');
  assert.equal(pool.hp, 5e6 - (LIMIT - 1), 'the pool is untouched');
  assert.equal(pool.byPlayer.get('P'), LIMIT - 1, 'nothing credited');
  assert.equal(b._pp('P').bossDamage, LIMIT - 1, 'no boss damage stat');
  assert.equal(op.stats.dmg, LIMIT - 1, 'no damage stat');
  assert.equal(h.eventsOf('dmg').length, dmg0, 'no damage number');
  assert.equal(h.hooksOf('damaged').length, damaged0, "no 'damaged' hook (nothing was dealt)");
  const ev = capEvents(h);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0][4].id, ev[0][4].n], [leader.id, LIMIT]);
  assert.equal(b.dealDamage(op, leader, { amount: 5e6, type: 'true' }), 0, 'a whole pool in one hit is cancelled too');
  assert.ok(leader.alive);
  assert.equal(pool.hp, 5e6 - (LIMIT - 1));
});

test('限伤: the check is ceil(final damage) — 299999.2 rounds up to the line and is cancelled, 299999 exactly lands', () => {
  const { b, leader, op } = hitField();
  const hp0 = leader.hp;
  assert.equal(b.dealDamage(op, leader, { amount: 299999.2, type: 'true' }), 0);
  assert.equal(leader.hp, hp0);
  assert.equal(b.dealDamage(op, leader, { amount: 299999, type: 'true' }), 299999);
});

test('限伤: the value checked is the hit after DEF / RES and every multiplier (before shields)', () => {
  const { b, leader, op } = hitField({ leaderDef: 100000, leaderRes: 50 });
  // phys: 399999 − 100000 DEF = 299999 → lands; 400000 − 100000 = 300000 → cancelled
  assert.equal(b.dealDamage(op, leader, { amount: 399999, type: 'phys' }), 299999);
  assert.equal(b.dealDamage(op, leader, { amount: 400000, type: 'phys' }), 0);
  // arts: 590000 × (1 − 50 %) = 295000 lands; 600000 × 50 % = 300000 cancelled
  assert.equal(b.dealDamage(op, leader, { amount: 590000, type: 'arts' }), 295000);
  assert.equal(b.dealDamage(op, leader, { amount: 600000, type: 'arts' }), 0);
  // a multiplier pushes a small hit past the line: 150000 true × 2 (脆弱 on the leader) = 300000 → 0
  b.addBuff(leader, { key: 'test:fragile', mods: { dmgTakenMul: 2 } });
  assert.equal(b.dealDamage(op, leader, { amount: 149999, type: 'true' }), 299998);
  assert.equal(b.dealDamage(op, leader, { amount: 150000, type: 'true' }), 0, 'bigger multipliers lower the damage of hits past the line');
  // the attacker's damage-dealt multiplier and dmg.mul count too
  b.removeBuff(leader, 'test:fragile');
  b.addBuff(op, { key: 'test:dealt', mods: { dmgDealtMul: 3 } });
  assert.equal(b.dealDamage(op, leader, { amount: 100000, type: 'true' }), 0);
  assert.equal(b.dealDamage(op, leader, { amount: 99999, type: 'true' }), 299997);
  assert.equal(b.dealDamage(op, leader, { amount: 50000, type: 'true', mul: 2 }), 0, '50000 × 3 × 2');
});

test('限伤: checked before shields — a cancelled hit leaves the leader\'s shield untouched; a smaller hit is absorbed as usual', () => {
  const { b, leader, op } = hitField();
  b.addBuff(leader, { key: 'test:shield', shield: 100000 });
  const hp0 = leader.hp;
  assert.equal(b.dealDamage(op, leader, { amount: 350000, type: 'true' }), 0);
  assert.equal(leader.findBuff('test:shield').shield, 100000, 'shield untouched');
  assert.equal(b.dealDamage(op, leader, { amount: 250000, type: 'true' }), 150000, '100000 absorbed, 150000 lands');
  assert.equal(leader.hp, hp0 - 150000);
});

test('限伤: only leaders — a minion and a part in the same boss field take any hit', () => {
  const { b, mini, part, op } = hitField();
  assert.equal(b.dealDamage(op, mini, { amount: 1e6, type: 'true' }), 1e6);
  assert.equal(b.dealDamage(op, part, { amount: 2e6, type: 'phys' }), 2e6);
  assert.equal(part.isBoss, false);
});

test('限伤: only boss / hidden battles — the same leader-tagged unit takes any hit in a normal or 联防 field', () => {
  for (const kind of ['normal', 'unite']) {
    const { b, leader, op } = hitField({ kind });
    assert.equal(b.dealDamage(op, leader, { amount: 5e5, type: 'true' }), 5e5, kind);
  }
  const { b, leader, op } = hitField({ kind: 'hidden' });
  assert.equal(b.dealDamage(op, leader, { amount: 5e5, type: 'true' }), 0, 'the Hidden Core is a boss battle');
});

test('限伤: every HP-damage kind — 元素伤害 and element bursts, DoT ticks, losses passed on (loseHp); element 损伤 (gauge) is not HP damage', () => {
  const pool = new SharedBossPool(5e7);
  const { h, b, leader, op } = hitField({ pool });
  const hp = () => pool.hp;
  // 元素伤害
  let p0 = hp();
  assert.equal(b.dealDamage(op, leader, { amount: 4e5, type: 'elemental', element: 'burn' }), 0);
  assert.equal(hp(), p0);
  // a burn burst whose 7000 元素伤害 is pushed past the line by 元素脆弱 ×100: the gauge bursts (its lock / RES cut stay),
  // the burst's hit is cancelled
  b.addBuff(leader, { key: 'test:elemFragile', mods: { elementalTakenMul: 100 } });
  p0 = hp();
  const caps0 = capEvents(h).length;
  b.dealDamage(op, leader, { amount: 1e7, type: 'element', element: 'burn' });
  assert.ok(leader.findBuff('burnBurst'), 'the gauge burst (爆发冷却 running)');
  assert.equal(hp(), p0, 'the burst\'s 700000 元素伤害 was cancelled');
  assert.equal(capEvents(h).length, caps0 + 1);
  b.removeBuff(leader, 'test:elemFragile');
  // DoT ticks: each tick is a hit of its own
  p0 = hp();
  b.addBuff(leader, { key: 'test:dotBig', duration: 3.01, interval: 1, onTick: () => b.dealDamage(op, leader, { amount: 4e5, type: 'true', canDodge: false }) });
  b.addBuff(leader, { key: 'test:dotSmall', duration: 3.01, interval: 1, onTick: () => b.dealDamage(op, leader, { amount: 1000, type: 'true', canDodge: false }) });
  h.run(3.2);
  assert.equal(p0 - hp(), 3000, 'only the small ticks landed');
  // a loss passed on to the leader (parts' 传递, a drone's death): one hit too
  p0 = hp();
  assert.equal(b.loseHp(leader, 3e5, { source: op }), 0);
  assert.equal(hp(), p0);
  assert.equal(b.loseHp(leader, 2e5, { source: op }), 2e5);
  assert.equal(hp(), p0 - 2e5);
});

test('限伤: what ran before the hit stays — the attack\'s hit hook fires; nothing after (damaged, fatal, kill)', () => {
  const { h, b, leader, op } = hitField();
  const hit0 = h.hooksOf('hit').length;
  const dmg0 = h.hooksOf('damaged').length;
  b.dealDamage(op, leader, { amount: 1e6, type: 'phys', isAttack: true });
  assert.equal(h.hooksOf('hit').length, hit0 + 1, "the 'hit' hook (before mitigation) ran");
  assert.equal(h.hooksOf('damaged').length, dmg0);
  assert.equal(h.hooksOf('fatal').length, 0);
  assert.equal(h.hooksOf('kill').length, 0);
  assert.ok(leader.alive);
});

test('限伤: a browser pool (client-side combat) behaves the same; the field stays alive and deterministic', () => {
  const pool = new LocalBossPool(1e6);
  const { b, leader, op } = hitField({ pool });
  assert.equal(b.dealDamage(op, leader, { amount: 3e5, type: 'true' }), 0);
  assert.equal(pool.hp, 1e6);
  assert.equal(pool.cum, 0, 'nothing to report to the server');
  assert.equal(b.dealDamage(op, leader, { amount: 2e5, type: 'true' }), 2e5);
  assert.equal(pool.cum, 2e5);
});

// ---------------------------------------------------------------------------------------------------------------
// the real leaders (data/bosses.json enemyKey = activity_table autoChessData.bossInfoDict enemyId, the official
// IsBossEnemy list) on real boss fields

test('IsBossEnemy ⇔ tag \'boss\': every tag-\'boss\' spawn of a boss / hidden template is a bosses.json enemyKey; parts and escorts never are', () => {
  const leaders = new Set(Object.values(DATA.bosses).map((x) => x.enemyKey));
  assert.equal(leaders.size, 10);
  const parts = new Set(Object.values(DATA.bosses).flatMap((x) => x.parts || []));
  for (const [id, t] of Object.entries(DATA.waves)) {
    if (!t || !Array.isArray(t.spawns) || (t.kind !== 'boss' && t.kind !== 'hidden')) continue;
    for (const s of t.spawns) {
      const key = s && (s.key ?? s.enemyKey);
      if (!key) continue;
      if (s.tag === 'boss') assert.ok(leaders.has(key), `${id}: ${key} tagged boss is a leader`);
      else assert.ok(!leaders.has(key), `${id}: ${key} is a leader but not tagged boss`);
      if (s.tag === 'part') assert.ok(parts.has(key) && !leaders.has(key), `${id}: part ${key}`);
    }
  }
});

const gd = new GameData(DATA, 'mode_multi_hard');
const setup = setupMatchWaves(gd, createRng(3));
const PAIR = [
  { playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, units: [], bonds: {}, playerEffects: [] },
  { playerId: 'p_1', seat: 1, side: 'R', colOffset: 8, units: [], bonds: {}, playerEffects: [] },
];
function realBossField(bossId, hidden, pool, players = PAIR) {
  const wave = buildBossWave(gd, createRng(1), setup.factions, hidden ? 15 : 14, { bossId, solo: false });
  const spec = buildBattleSpec({
    battleId: `lim.${bossId}`, fieldId: 'b1', kind: hidden ? 'hidden' : 'boss', seed: 5, modeId: 'mode_multi_hard', round: hidden ? 15 : 14,
    stageId: 'act2autochess_m01', rect: { ...GEO.BOSS_RECT }, timeLimit: null, players,
    spawns: wave.spawns.filter((s) => s && gd.enemy(s.enemyKey)), routes: wave.routes, flags: { layerGainsEnabled: false, ...gd.dp },
    enemyOverrides: wave.overrides, waveId: wave.templateId, bossId, boss: { poolHp: pool.maxHp, poolMax: pool.maxHp },
  });
  const b = createBattleFromSpec(spec, undefined, { sharedBoss: pool, recordEvents: true, quiet: true });
  const want = gd.boss(bossId).parts?.length ? 1 + gd.boss(bossId).parts.length : 1;
  for (let i = 0; i < 30 * 120 && b.enemies.filter((e) => e.alive && (e.isBoss || e.tag === 'part')).length < want; i++) b.step();
  return { b, spec };
}

for (const [bossId, hidden] of [['boss_1', false], ['boss_5', false], ['boss_8', true], ['boss_9', true], ['boss_10', true]]) {
  test(`限伤 on a real field: ${bossId} — every copy of the leader cancels a 300000 hit and takes a 299999 one; its parts are no leaders`, () => {
    const pool = new SharedBossPool(gd.boss(bossId).bloodPoint.HARD);
    const { b } = realBossField(bossId, hidden, pool);
    const caps = [];
    const fx0 = b.fx.bind(b);
    b.fx = (k, p) => { if (k === 'hitCap') caps.push(p.id); return fx0(k, p); };
    const leaders = b.enemies.filter((e) => e.alive && e.isBoss);
    assert.ok(leaders.length >= 1, 'the leader spawned');
    for (const L of leaders) {
      assert.equal(L.defId, gd.boss(bossId).enemyKey);
      const before = pool.hp;
      assert.equal(b.dealDamage(null, L, { amount: LIMIT, type: 'true', ignoreSleep: true }), 0, `${L.defId} #${L.id}`);
      assert.equal(pool.hp, before);
      assert.ok(caps.includes(L.id), `${L.defId} #${L.id}: cancelled by the limit (not by an invulnerable phase)`);
      assert.equal(b.dealDamage(null, L, { amount: LIMIT - 1, type: 'true', ignoreSleep: true }), LIMIT - 1);
      assert.equal(pool.hp, before - (LIMIT - 1));
    }
    const parts = b.enemies.filter((e) => e.alive && e.tag === 'part');
    if (hidden && bossId !== 'boss_10') assert.ok(parts.length > 0, 'the parts spawned');
    for (const p of parts) {
      assert.equal(p.isBoss, false);
      assert.equal(leaderHitCancelled(b, p, 1e7), false, `part ${p.defId} is no leader`);
    }
    for (const m of b.enemies.filter((e) => e.alive && !e.isBoss && e.tag !== 'part')) assert.equal(leaderHitCancelled(b, m, 1e7), false, m.defId);
  });
}

test('限伤 vs the real leader defences [ASSUMED order]: 阿利斯泰尔\'s 5000 vest barrier stays under a cancelled hit; both native barrier and count shield are preserved by the pre-injury cap', () => {
  // boss_6: the kit's own 莫非王土 animates a shield equipment lying on the field → the `boss:vest` HP shield (5000)
  const pool6 = new SharedBossPool(gd.boss('boss_6').bloodPoint.HARD);
  const { b: b6 } = realBossField('boss_6', false, pool6);
  const lion = b6.enemies.find((e) => e.alive && e.isBoss);
  const spot = [Math.round(lion.y), Math.round(lion.x) + 1];
  assert.ok(b6.spawnEnemy('enemy_10029_vtshld', { pos: spot, route: { motion: 'FLY', start: spot, end: spot, steps: [{ t: 'wait', s: 99999 }] }, tag: 'part', countInTotal: false }));
  for (let i = 0; i < 30 * 10 && !lion.findBuff('boss:vest'); i++) b6.step();
  const vest = lion.findBuff('boss:vest');
  assert.ok(vest, 'the kit put on the vest');
  assert.equal(vest.shield, 5000, 'store.dynamic');
  const caps6 = [];
  const fx6 = b6.fx.bind(b6);
  b6.fx = (k, p) => { if (k === 'hitCap') caps6.push(p.id); return fx6(k, p); };
  const before = pool6.hp;
  assert.equal(b6.dealDamage(null, lion, { amount: 302000, type: 'true', ignoreSleep: true }), 0, 'within 5000 of the line: still cancelled');
  assert.equal(lion.findBuff('boss:vest')?.shield, 5000, 'the barrier is untouched (限伤 before shields)');
  assert.equal(pool6.hp, before);
  assert.deepEqual(caps6, [lion.id]);
  assert.equal(b6.dealDamage(null, lion, { amount: 299999, type: 'true', ignoreSleep: true }), 294999, 'under the line: 5000 absorbed, the rest lands');
  assert.equal(pool6.hp, before - 294999);
  assert.equal(lion.findBuff('boss:vest'), null, 'the barrier is spent');

  // [ASSUMED] Keep the shared pre-injury cap policy for the native ordinary-priority aura shield too.
  const pool10 = new SharedBossPool(gd.boss('boss_10').bloodPoint.HARD);
  const { b: b10 } = realBossField('boss_10', true, pool10);
  const pipe = b10.enemies.find((e) => e.alive && e.isBoss);
  grantHitShield(b10, pipe, 1);
  const caps10 = [];
  const fx10 = b10.fx.bind(b10);
  b10.fx = (k, p) => { if (k === 'hitCap') caps10.push(p.id); return fx10(k, p); };
  const before10 = pool10.hp;
  assert.equal(b10.dealDamage(null, pipe, { amount: 2e6, type: 'phys', ignoreSleep: true }), 0);
  assert.equal(pipe.findBuff('ab:hitShield').shieldHits, 1, 'the cap cancels before consuming an injury shield');
  assert.deepEqual(caps10, [pipe.id]);
  assert.equal(b10.dealDamage(null, pipe, { amount: 2e6, type: 'phys', ignoreSleep: true }), 0);
  assert.deepEqual(caps10, [pipe.id, pipe.id], 'the next over-limit hit also preserves the layer');
  assert.equal(pipe.findBuff('ab:hitShield').shieldHits, 1);
  assert.equal(b10.dealDamage(null, pipe, { amount: 1, type: 'arts', ignoreSleep: true }), 0);
  assert.equal(pipe.findBuff('ab:hitShield'), null, 'an under-limit hit reaches and consumes the layer');
  assert.equal(pool10.hp, before10);
});

test('限伤 vs 【死亡集群】 (real kit): a drone killed by an operator costs the leader 2 % of the pool max — a share, no hit: it lands past the 300000 line too (DESIGN §25.13.4)', () => {
  // boss_1 / boss_8 skill 2: bb hp_ratio 0.02; the leader's max HP is the shared pool's max (Battle syncs it), so the
  // loss is 0.02 × pool max. With the pool per player alive (the owner's decision of 2026-10-06, PR #209) boss_8 ABYSS
  // reaches 21.6M / 28.8M at 3 / 4 players: 432000 / 576000 per drone, past the line where ceil(0.02 × max) ≥ 300000 —
  // until 0.2.0 the link was cancelled there like a hit; it is a share of the pool and lands (Battle.loseHp noHitLimit
  // [ASSUMED], research 11 §6).
  assert.equal(gd.enemy('enemy_9013_acstmk').skills.find((s) => s.prefabKey === '2').bb.hp_ratio, 0.02);
  assert.equal(gd.enemy('enemy_9013_acstmk_2').skills.find((s) => s.prefabKey === '2').bb.hp_ratio, 0.02);
  const withOp = [{ ...PAIR[0], units: [{ uid: 1, chessId: 'chess_char_1_01_a', row: 10, col: 2 }] }, PAIR[1]];
  const run = (poolMax) => {
    const pool = new SharedBossPool(poolMax);
    const { b } = realBossField('boss_1', false, pool, withOp);
    const L = b.enemies.find((e) => e.alive && e.isBoss);
    const key = gd.enemy(L.defId).skills.find((s) => s.prefabKey === '2').bbStr.enemy_key; // enemy_1005_yokai
    const caps = [];
    const fx0 = b.fx.bind(b);
    b.fx = (k, p) => { if (k === 'hitCap') caps.push([p.id, p.n]); return fx0(k, p); };
    for (let i = 0; i < 30 * 5 && !b.enemies.some((e) => e.alive && e.defId === key); i++) b.step();
    const drone = b.enemies.find((e) => e.alive && e.defId === key);
    assert.ok(drone, 'the kit summoned its drones (skill 2, initCooldown 0)');
    const op = b.units.find((u) => u.alive && u.side === 'ally');
    assert.ok(op, 'an operator to kill the drone');
    assert.equal(L.s.maxHp, poolMax, 'the leader\'s max HP is the pool max');
    const before = pool.hp;
    b.dealDamage(op, drone, { amount: 1e9, type: 'true', ignoreSleep: true });
    assert.equal(drone.alive, false, 'the drone died');
    return { lost: before - pool.hp, caps, id: L.id };
  };
  const solo = run(7200000);
  assert.equal(solo.lost, 144000, 'boss_8 ABYSS-sized pool (one player): the loss lands');
  assert.deepEqual(solo.caps, []);
  const under = run(14999950);
  assert.equal(under.lost, 299999, 'just under the line: lands');
  assert.deepEqual(under.caps, []);
  for (const [m, want] of [[14999951, 299999.02], [15000000, 300000], [21600000, 432000], [28800000, 576000]]) {
    const over = run(m);
    assert.ok(Math.abs(over.lost - want) < 1e-6, `${m}: the share lands past the line (${over.lost})`);
    assert.deepEqual(over.caps, [], `${m}: no cancelled hit`);
  }
});

test('限伤 keeps the sim deterministic: a boss field whose hits cross the line gives the same result digest twice', () => {
  const run = () => {
    const pool = new LocalBossPool(gd.boss('boss_1').bloodPoint.HARD);
    const { b } = realBossField('boss_1', false, pool);
    // a stand-in for a 999-layer board: every hit on the leader is ×40 (some land, the big ones are cancelled)
    b.on('hit', (c) => { if (c.target && c.target.isBoss) c.dmg.mul *= 40; });
    b.on('tick', () => {
      const L = b.enemies.find((e) => e.alive && e.isBoss);
      if (L && b.tickCount % 15 === 0) b.dealDamage(null, L, { amount: 2000 + (b.tickCount % 7) * 2500, type: 'true' });
    });
    let caps = 0;
    const fx0 = b.fx.bind(b);
    b.fx = (k, p) => { if (k === 'hitCap') caps++; return fx0(k, p); };
    for (let i = 0; i < 30 * 20; i++) b.step();
    return { d: resultDigest(b.result()), hp: pool.hp, caps };
  };
  const a = run(), c = run();
  assert.deepEqual(a.d, c.d);
  assert.equal(a.hp, c.hp);
  assert.ok(a.caps > 0, 'some hits were cancelled');
});

// ---------------------------------------------------------------------------------------------------------------
// the docs state the rules (kept here, next to the code, so they move together)

test('docs: research 11 is indexed; SIM / META / DATA / PLAYING / BALANCE state the 999 cap and the 300000 cancel', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const R11 = doc('docs/research/11-limits-official.md');
  assert.match(R11, /^# 11 · Official limits/);
  assert.match(R11, /MAX_GARRISON_STACK/);
  assert.match(R11, /MAX_BATTLE_DAMAGE/);
  assert.match(R11, /IsBossEnemy/);
  assert.match(doc('docs/research/00-INDEX.md'), /`11-limits-official\.md`/);
  const SIM = doc('docs/SIM.md');
  assert.match(SIM, /限伤/);
  assert.match(SIM, /BOSS_HIT_LIMIT/);
  assert.match(SIM, /BOND_LAYER_CAP/);
  assert.match(SIM, /hitCap/);
  const META = doc('docs/META.md');
  assert.match(META, /BOND_LAYER_CAP/);
  assert.match(META, /BOSS_HIT_LIMIT/);
  assert.match(doc('docs/DATA.md'), /IsBossEnemy/);
  const PLAYING = doc('docs/PLAYING.md');
  assert.match(PLAYING, /999 层/);
  assert.match(PLAYING, /300000/);
  assert.match(doc('docs/BALANCE.md'), /限伤 300000/);
});
