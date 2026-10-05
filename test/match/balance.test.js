// Balance: NO custom balance any more (research 08 §6: the official numbers only; data/tuning.json keeps result titles)
// and the competent-board model of tools/balance.mjs, which now only MEASURES difficulty (docs/BALANCE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { buildNormalWave, setupMatchWaves } from '../../server/match/waves.js';
import { computeBonds } from '../../server/match/bondsMeta.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA } from './harness.js';
import {
  CURVES, planBoard, applyBoard, makeMatch, runNormal, runBoss, withoutTuning, waveNeeds, summarizeNormal,
} from '../../tools/balance.mjs';

const RAW = withoutTuning(DATA);

test('no custom balance: legacy tuning multipliers are ignored; enemy scale = the PRTS table; leader pool = bloodPoint', () => {
  const tuning = {
    modes: {
      '*': { enemyHpMul: 0.5, enemyAtkMul: 0.9 },
      mode_multi_hard: { enemyHpMul: { 3: 0.8, '*': 0.7 }, enemySpeedMul: 1.1, bossHpMul: { boss_1: 0.5, hidden: 0.25, '*': 0.9 }, flyPlaceholders: 'drop' },
    },
  };
  const hard = new GameData({ ...RAW, tuning }, 'mode_multi_hard');
  const base = new GameData(RAW, 'mode_multi_hard');
  for (const r of [1, 3, 9, 13]) {
    assert.deepEqual(hard.enemyScale(r), base.enemyScale(r));
    const e = DATA.config.modes.mode_multi_hard.enemyScale[r];
    assert.deepEqual(hard.enemyScale(r), { hpMul: e.hp, atkMul: e.atk, speedMul: e.speed }, `R${r}: the config (PRTS) table`);
  }
  assert.equal(hard.bossHpMul('boss_1'), 1);
  // co-op: one pool = bloodPoint[difficulty] × players / 4, `players` = the players ALIVE when that boss fight starts
  // (captured once and locked: §20.10; `aliveScaling` on by default — `false` sizes it from the seats the match runs
  // with, the reading upstream issue #113 shipped); the official data carries one bloodPoint per difficulty only;
  // solo: ×0.25 [ASSUMED, flagged]
  for (const [modeId, key] of [['mode_multi_funny', 'FUNNY'], ['mode_multi_normal', 'NORMAL'], ['mode_multi_hard', 'HARD'], ['mode_multi_abyss', 'ABYSS']]) {
    const gd = new GameData(RAW, modeId);
    for (const b of ['boss_1', 'boss_5', 'boss_8']) {
      assert.equal(gd.bossPoolHp(b), DATA.bosses[b].bloodPoint[key], `${modeId} ${b} (no count: a full team)`);
      assert.equal(gd.bossPoolHp(b, 4, 4), DATA.bosses[b].bloodPoint[key], `${modeId} ${b} four alive`);
      assert.equal(gd.bossPoolHp(b, 4, 2), Math.round(DATA.bosses[b].bloodPoint[key] / 2), `${modeId} ${b} two alive of a four-seat room: half`);
      assert.equal(gd.bossPoolHp(b, 4, 1), Math.round(DATA.bosses[b].bloodPoint[key] / 4), `${modeId} ${b} one alive: a quarter`);
    }
  }
  assert.equal(DATA.config.bossHpScale.aliveScaling, true, 'the players alive at the fight start are the factor');
  assert.equal(DATA.config.bossHpScale.aliveAssumed, true);
  assert.equal(DATA.config.bossHpScale.playerScaling, true);
  // …and `aliveScaling: false` sizes it from the seats the match runs with instead (the seat-count behaviour, kept as
  // the flip)
  const seatMode = JSON.parse(JSON.stringify(RAW));
  seatMode.config.bossHpScale.aliveScaling = false;
  seatMode.config.modes.mode_multi_hard.bossHpScale.aliveScaling = false;
  const gdS = new GameData(seatMode, 'mode_multi_hard');
  assert.equal(gdS.bossPoolHp('boss_5', 4, 2), DATA.bosses.boss_5.bloodPoint.HARD, 'aliveScaling off: four seats whatever the living count');
  assert.equal(gdS.bossPoolHp('boss_5', 2, 2), Math.round(DATA.bosses.boss_5.bloodPoint.HARD / 2), 'aliveScaling off: the seats are the factor');
  assert.equal(DATA.config.modes.mode_multi_hard.bossHpScale.playerScaling, true);
  const solo = new GameData(RAW, 'mode_single_hard');
  assert.equal(solo.bossPoolHp('boss_2'), Math.round(DATA.bosses.boss_2.bloodPoint.HARD * 0.25));
  assert.equal(solo.bossPoolHp('boss_2', 1), Math.round(DATA.bosses.boss_2.bloodPoint.HARD * 0.25), 'a one-seat solo match: the same value');
  assert.equal(DATA.config.bossHpScale.soloAssumed, true);
  // the waves carry exactly the table
  const setup = setupMatchWaves(hard, createRng(3));
  const w = buildNormalWave(hard, createRng(3), setup.factions, 3);
  for (const s of w.spawns) assert.equal(s.mods.hpMul, base.baseEnemyScale(3).hpMul);
});

test('data/tuning.json holds only title rules (the enemy / leader multipliers were removed)', () => {
  const t = DATA.tuning;
  assert.ok(t && typeof t === 'object', 'data/tuning.json is loaded as data.tuning');
  assert.deepEqual(Object.keys(t).filter((k) => !k.startsWith('_')).sort(), ['titles', 'version']);
  for (const [id, o] of Object.entries(t.titles || {})) {
    assert.ok(DATA.config.titles.some((x) => x.id === id), id);
    assert.ok(['max', 'min'].includes(o.rule));
  }
});

test('competent board model: curves (level, units, elites, items), a core bond active with its layers, wave-aware roles', () => {
  const m = makeMatch({ data: RAW, mode: 'coop', difficulty: 'NORMAL', seed: 5, players: 1, rehearsal: 0 });
  for (const r of [3, 8, 12]) {
    m.round = r;
    m.wave = buildNormalWave(m.gd, m.rngWaves, m.factions, r);
    const rng = createRng(100 + r);
    const plan = planBoard(m, r, rng);
    assert.equal(plan.level, CURVES.level[r]);
    assert.equal(plan.units.length, CURVES.units[r]);
    assert.equal(new Set(plan.units).size, plan.units.length, 'distinct chess');
    for (const id of plan.units) {
      assert.ok(m.pool.has(id), `${id} not banned this match`);
      assert.ok(m.gd.tierOf(id) <= plan.level, `${id} tier ≤ shop level`);
    }
    assert.ok(plan.elites.size >= Math.floor(CURVES.elites[r]) && plan.elites.size <= Math.ceil(CURVES.elites[r]));
    const ps = m.order[0];
    applyBoard(m, ps, plan, r, rng);
    assert.equal(ps.deployCount, plan.units.length, 'every unit deployed');
    const bonds = computeBonds(m.gd, ps);
    assert.ok(plan.core && bonds[plan.core].active, `R${r}: core bond ${plan.core} active`);
    const L = ps.layers[plan.core];
    assert.ok(L >= CURVES.coreLayers[r] * 0.8 - 1 && L <= CURVES.coreLayers[r] * 1.2 + 1, `R${r}: core layers ${L}`);
    const flyers = waveNeeds(m.gd, m.wave.spawns).flyShare;
    const aa = [...ps.board.values()].filter((p) => p.kind === 'chess' && m.gd.chess(p.id).canHitFly && m.gd.chess(p.id).attackKind !== 'heal').length;
    if (flyers > 0.2) assert.ok(aa >= 2, `R${r}: anti-air for a flying wave (${aa})`);
  }
  m.dispose();
});

test('runNormal / runBoss return consistent samples (real sim, full content)', () => {
  const a = runNormal({ data: RAW, mode: 'coop', difficulty: 'FUNNY', round: 1, seed: 7, rehearsal: 0 });
  assert.equal(a.round, 1);
  assert.ok(a.killed + a.leaks <= a.total);
  assert.ok(a.goalLeaks <= a.leaks);
  assert.equal(a.timeLimit, 90, 'R1: 45 real seconds of the 2× battle');
  assert.ok(a.time > 0 && a.time <= a.timeLimit + 1e-6);
  const again = runNormal({ data: RAW, mode: 'coop', difficulty: 'FUNNY', round: 1, seed: 7, rehearsal: 0 });
  assert.deepEqual(again, a, 'deterministic per seed');
  const s = summarizeNormal([a, again]);
  assert.equal(s.leaksAvg, a.leaks);
  const b = runBoss({ data: RAW, mode: 'solo', difficulty: 'FUNNY', round: 9, seed: 3, tMax: 30 });
  assert.equal(b.players, 1);
  assert.ok(b.pool > 0 && b.dmg150 >= 0 && b.dmg150 <= b.pool);
  assert.ok(b.ratio150 >= 0 && b.ratio150 <= 1);
  assert.equal(b.teamLp0, 15);
});
