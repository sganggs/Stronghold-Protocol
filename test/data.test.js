// test/data.test.js — integrity tests for the generated game data (data/*.json, task F1).
//
// Loads every file produced by tools/build-data.mjs and checks shapes, counts and cross-file
// referential integrity (bonds ↔ chess, garrisons, items/bands ↔ effects, wave spawns ↔ enemies,
// config rounds ↔ waves, stages 19×21, finite numbers…), plus regression tests for defects found in
// review (module token parts, enemy rangeRadius/undefined-field semantics, token sources).
// When the official-data cache (.cache/gamedata) is present, two more suites run: an independent
// re-derivation of every chess/enemy stat from the raw tables, and an offline rebuild that must
// reproduce data/ byte-for-byte (catches a stale data/ after a build-script change).
// Run: node --test test/data.test.js (build first with `node tools/build-data.mjs` if data/ is missing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripPotential } from '../shared/potential.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// DATA_DIR lets the suite validate an alternative build output (e.g. `--out /tmp/x`).
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const CACHE = join(ROOT, '.cache', 'gamedata');
const HAS_CACHE = ['excel/activity_table.json', 'excel/character_table.json', 'excel/skill_table.json', 'excel/battle_equip_table.json',
  'levels/enemydata/enemy_database.json', 'levels/activities/act1autochess/level_autochess_enemy_data.json']
  .every((rel) => existsSync(join(CACHE, rel)));
const FILES = ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices', 'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'backups'];

/** Load one data file (fails with a helpful message when the build has not run). */
function load(name) {
  const p = join(DATA, `${name}.json`);
  assert.ok(existsSync(p), `data/${name}.json missing — run: node tools/build-data.mjs`);
  return JSON.parse(readFileSync(p, 'utf8'));
}
const D = Object.fromEntries(FILES.map((f) => [f, load(f)]));
const { config, chess, bonds, garrisons, items, bands, effects, choices, enemies, factions, waves, stages, bosses, tokens } = D;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isPair = (p) => Array.isArray(p) && p.length === 2 && p.every(isInt);
const normalChess = Object.values(chess).filter((c) => !c.isGolden);
const visible = normalChess.filter((c) => c.visible);

/** Every number reachable in an object is finite (JSON cannot hold NaN, but null stats would slip). */
function assertStatsFinite(stats, label, keys) {
  assert.ok(stats && typeof stats === 'object', `${label}: stats missing`);
  for (const k of keys) assert.ok(isFiniteNum(stats[k]), `${label}: stats.${k} = ${stats[k]}`);
}

test('all data files load and are non-empty; total size < 6 MB', () => {
  let total = 0;
  for (const f of FILES) {
    total += statSync(join(DATA, `${f}.json`)).size;
    assert.ok(Object.keys(D[f]).length > 0, `${f} is empty`);
  }
  assert.ok(total < 6 * 1024 * 1024, `total ${total} bytes`);
});

test('numbers: every stats/bb/enemyScale object holds only finite numbers (no null/NaN leaks)', () => {
  const bad = [];
  const walk = (x, path) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    for (const [k, v] of Object.entries(x)) {
      if ((k === 'stats' || k === 'bb' || k === 'enemyScale') && v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === null || (typeof sv === 'number' && !Number.isFinite(sv))) bad.push(`${path}.${k}.${sk}`);
        }
      }
      walk(v, `${path}.${k}`);
    }
  };
  for (const f of FILES) walk(D[f], f);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} bad numeric fields`);
});

test('chess: 266 records, 112 visible non-DIY (16/17/19/22/19/19 per tier)', () => {
  assert.equal(Object.keys(chess).length, 266);
  assert.equal(visible.length, 112);
  const perTier = {};
  for (const c of visible) perTier[c.tier] = (perTier[c.tier] || 0) + 1;
  assert.deepEqual(perTier, { 1: 16, 2: 17, 3: 19, 4: 22, 5: 19, 6: 19 });
  assert.equal(normalChess.filter((c) => c.isDiy).length, 4);
  assert.equal(normalChess.filter((c) => c.isHidden).length, 17);
});

test('chess: ids, golden pairs and references resolve', () => {
  for (const [id, c] of Object.entries(chess)) {
    assert.equal(c.chessId, id);
    assert.ok(chess[c.baseId], `${id}: baseId`);
    assert.equal(chess[c.baseId].isGolden, false, `${id}: baseId must be normal`);
    assert.ok(c.goldenId && chess[c.goldenId]?.isGolden, `${id}: goldenId`);
    assert.equal(c.tier, chess[c.baseId].tier, `${id}: tier differs from base`);
    assert.ok(c.tier >= 1 && c.tier <= 6);
    for (const b of c.bonds) assert.ok(bonds[b], `${id}: bond ${b}`);
    for (const g of c.garrisonIds) assert.ok(garrisons[g], `${id}: garrison ${g}`);
    for (const t of c.tokens) assert.ok(tokens[t], `${id}: token ${t}`);
    assert.ok(isFiniteNum(c.price) && isFiniteNum(c.sellPrice), `${id}: price`);
  }
  assert.equal(chess.chess_char_2_11_a.upgradeNum, 2, '风丸 merges with 2 copies');
});

test('chess: every non-DIY chess has stats, range, classification and a resolvable skill', () => {
  const statKeys = ['maxHp', 'atk', 'def', 'res', 'cost', 'blockCnt', 'bat', 'aspd', 'respawnTime', 'spRecovery', 'moveSpeed', 'tauntLevel', 'massLevel'];
  for (const c of Object.values(chess)) {
    if (c.isDiy) { assert.equal(c.visible, false); continue; }
    assertStatsFinite(c.stats, c.chessId, statKeys);
    assert.ok(c.stats.maxHp > 0 && c.stats.bat > 0 && c.stats.aspd > 0, `${c.chessId}: positive stats`);
    assert.ok(Array.isArray(c.rangeGrid) && c.rangeGrid.every(isPair), `${c.chessId}: rangeGrid`);
    assert.ok(['phys', 'arts', 'heal', 'true'].includes(c.dmgType), `${c.chessId}: dmgType ${c.dmgType}`);
    assert.ok(['melee', 'ranged', 'heal', 'none'].includes(c.attackKind), `${c.chessId}: attackKind`);
    assert.ok(['arrow', 'bolt', 'orb', 'none'].includes(c.projectile), `${c.chessId}: projectile`);
    assert.equal(typeof c.canHitFly, 'boolean');
    assert.ok(c.skill && typeof c.skill.skillId === 'string', `${c.chessId}: skill`);
    assert.ok(c.skill.level === (c.isGolden ? 7 : 4), `${c.chessId}: skill level ${c.skill.level}`);
    assert.ok(typeof c.skill.trigger?.rule === 'string', `${c.chessId}: trigger`);
    assert.ok(typeof c.skill.desc === 'string' && !/\{[a-z_@.\[\]]+(:[0-9.%]+)?\}/i.test(c.skill.desc), `${c.chessId}: unresolved skill placeholder`);
    for (const [k, v] of Object.entries(c.skill.bb)) assert.ok(isFiniteNum(v), `${c.chessId}: skill bb ${k}`);
    assert.ok(c.trait && typeof c.trait.desc === 'string', `${c.chessId}: trait`);
    assert.ok(Array.isArray(c.talents));
    assert.ok(c.assets && c.assets.avatar && c.assets.spine, `${c.chessId}: assets`);
    if (c.isGolden) assert.equal(c.module ? c.module.active || c.module.id === null : true, true);
  }
  // Spot checks against official numbers (隐现 E1 Lv55: HP 1123, ATK 399 + 攻击力+23 at full potential = 422; cost 15 − 3).
  assert.equal(chess.chess_char_1_01_a.stats.maxHp, 1123);
  assert.equal(chess.chess_char_1_01_a.stats.atk, 422);
  assert.equal(chess.chess_char_1_01_a.stats.cost, 12);
  assert.equal(chess.chess_char_1_01_a.targetPriority, 'fly');
});

test('bonds: 23 bonds with valid members, thresholds and effects', () => {
  assert.equal(Object.keys(bonds).length, 23);
  assert.equal(Object.values(bonds).filter((b) => b.isCore).length, 8);
  const modes = new Set(['BOARD', 'BOARD_AND_DECK', 'BOARD_ALL_CHESS']);
  for (const b of Object.values(bonds)) {
    assert.ok(modes.has(b.countMode), `${b.bondId}: countMode ${b.countMode}`);
    assert.ok(b.thresholds.length >= 1, `${b.bondId}: thresholds`);
    for (let i = 0; i < b.thresholds.length; i++) {
      assert.ok(isInt(b.thresholds[i]) && b.thresholds[i] > 0);
      if (i) assert.ok(b.thresholds[i] > b.thresholds[i - 1], `${b.bondId}: ascending`);
    }
    for (const m of b.members) {
      assert.ok(chess[m] && !chess[m].isGolden, `${b.bondId}: member ${m}`);
      assert.ok(chess[m].bonds.includes(b.bondId), `${b.bondId}: member ${m} lacks bond`);
    }
    assert.ok(effects[b.effectId], `${b.bondId}: effect`);
  }
  assert.deepEqual(bonds.yanShip.thresholds, [3, 6, 9]);
  assert.deepEqual(bonds.egirShip.thresholds, [3, 5]);
  assert.deepEqual(bonds.suntShip.thresholds, [2, 5]);
  assert.equal(bonds.soloShip.maxCount, 1);
  // Every chess bond membership is mirrored in the bond member list.
  for (const c of normalChess) for (const b of c.bonds) assert.ok(bonds[b].members.includes(c.chessId), `${c.chessId} not in ${b}.members`);
});

test('garrisons: all referenced exist; 43 distinct effect keys', () => {
  const keys = new Set(Object.values(garrisons).map((g) => g.effectKey));
  assert.equal(keys.size, 43);
  for (const g of Object.values(garrisons)) {
    assert.ok(typeof g.eventType === 'string' && typeof g.desc === 'string', g.garrisonId);
    for (const o of g.owners) assert.ok(chess[o], `${g.garrisonId}: owner ${o}`);
  }
});

test('items: 115 item chess with valid effects, bonds and golden links', () => {
  assert.equal(Object.keys(items).length, 115);
  assert.equal(Object.values(items).filter((i) => i.itemType === 'EQUIP' && !i.isGolden).length, 56);
  assert.equal(Object.values(items).filter((i) => i.itemType === 'MAGIC').length, 3);
  for (const it of Object.values(items)) {
    assert.ok(effects[it.effectId], `${it.id}: effect ${it.effectId}`);
    if (it.goldenId) assert.ok(items[it.goldenId]?.isGolden, `${it.id}: golden`);
    if (it.giveBondId) assert.ok(bonds[it.giveBondId], `${it.id}: giveBond`);
    if (it.requiresBondId) assert.ok(bonds[it.requiresBondId], `${it.id}: requiresBond`);
    assert.ok(isInt(it.tier) && it.tier >= 1 && it.tier <= 6, `${it.id}: tier`);
    assert.ok(isFiniteNum(it.price), `${it.id}: price`);
    assert.ok(typeof it.trapId === 'string' && it.iconId === it.trapId);
  }
});

test('bands: 40 strategies with effects and starting LP', () => {
  assert.equal(Object.keys(bands).length, 40);
  for (const b of Object.values(bands)) {
    assert.ok(effects[b.effectId], `${b.bandId}: effect`);
    assert.ok(isInt(b.totalHp) && b.totalHp >= 20 && b.totalHp <= 45, `${b.bandId}: totalHp`);
    assert.ok(b.name && b.iconId);
  }
  assert.equal(bands.band_bldsk.totalHp, 28);
});

test('effects: every buff has a key and finite numeric blackboard', () => {
  for (const e of Object.values(effects)) {
    for (const b of e.buffs) {
      assert.equal(typeof b.key, 'string', e.effectId);
      for (const [k, v] of Object.entries(b.bb)) assert.ok(isFiniteNum(v), `${e.effectId}.${k}`);
    }
  }
});

test('enemies: stats are finite and motion/dmgType valid', () => {
  for (const e of Object.values(enemies)) {
    assertStatsFinite(e.stats, e.key, ['maxHp', 'atk', 'def', 'res', 'moveSpeed', 'bat', 'aspd', 'rangeRadius', 'blockCnt', 'massLevel', 'lpr', 'hpRecoveryPerSec', 'tauntLevel']);
    assert.ok(['WALK', 'FLY'].includes(e.stats.motion), `${e.key}: motion ${e.stats.motion}`);
    assert.ok(['phys', 'arts', 'true', 'heal', 'none', 'element'].includes(e.stats.dmgType), `${e.key}: dmgType ${e.stats.dmgType}`);
    for (const s of e.summons) assert.ok(enemies[s], `${e.key}: summon ${s}`);
  }
});

test('waves: every template resolves spawns, routes and enemies', () => {
  assert.equal(Object.keys(waves).length, 38);
  for (const w of Object.values(waves)) {
    assert.ok(w.routes.length > 0, `${w.id}: routes`);
    for (const r of [...w.routes, ...w.extraRoutes]) {
      if (!r) continue;
      assert.ok(isPair(r.start) && isPair(r.end), `${w.id}: route endpoints`);
      for (const p of r.checkpoints) assert.ok(isPair(p), `${w.id}: checkpoint`);
    }
    for (const sp of w.spawns) {
      assert.ok(isFiniteNum(sp.time) && sp.time >= 0, `${w.id}: time`);
      assert.ok(isInt(sp.count) && sp.count >= 1, `${w.id}: count`);
      assert.ok(isFiniteNum(sp.interval) && sp.interval >= 0, `${w.id}: interval`);
      if (sp.action) continue;
      assert.ok(enemies[sp.key], `${w.id}: enemy ${sp.key}`);
      assert.ok(w.routes[sp.routeIndex], `${w.id}: route ${sp.routeIndex}`);
    }
    for (const [bn, phases] of Object.entries(w.branches)) {
      for (const sp of phases.flat()) {
        if (sp.action) continue;
        assert.ok(enemies[sp.key], `${w.id}/${bn}: enemy ${sp.key}`);
        assert.ok(w.extraRoutes[sp.routeIndex], `${w.id}/${bn}: extraRoute ${sp.routeIndex}`);
      }
    }
    for (const k of Object.keys(w.overrides)) assert.ok(enemies[k], `${w.id}: override ${k}`);
    if (w.kind === 'normal') assert.ok(isFiniteNum(w.maxPlayTime) && w.maxPlayTime > 0);
  }
});

test('config: modes, rounds and templates', () => {
  const inScope = Object.values(config.modes).filter((m) => m.inScope);
  assert.equal(inScope.length, 8);
  for (const m of Object.values(config.modes)) {
    for (const [r, rd] of Object.entries(m.rounds)) {
      const tpls = rd.template ? [rd.template] : Object.values(rd.bossTemplates || {});
      assert.ok(tpls.length > 0, `${m.modeId} r${r}: template`);
      for (const t of tpls) assert.ok(waves[t], `${m.modeId} r${r}: ${t}`);
      if (!rd.isBoss) assert.ok(isFiniteNum(rd.combatTimeLimit), `${m.modeId} r${r}: combatTimeLimit`);
      if (m.type === 'SINGLE') assert.equal(rd.prepTime, null, `${m.modeId}: solo prep untimed`);
      if (m.type === 'MULTI') assert.ok(isFiniteNum(rd.prepTime), `${m.modeId} r${r}: prepTime`);
      const es = m.enemyScale[r];
      assert.ok(es && isFiniteNum(es.atk) && isFiniteNum(es.hp) && isFiniteNum(es.speed), `${m.modeId} r${r}: enemyScale`);
    }
    for (const b of [...m.activeBondIds, ...m.inactiveBondIds]) assert.ok(bonds[b], `${m.modeId}: bond ${b}`);
    for (const s of m.stages) assert.ok(stages[s]?.active, `${m.modeId}: stage ${s}`);
    if (m.inScope) {
      assert.equal(m.upgradePrices.length, 5);
      assert.ok(m.stages.length > 0);
    }
  }
  const M = config.modes;
  assert.equal(M.mode_single_funny.lastRound, 9);
  assert.equal(M.mode_single_funny.hiddenRound, null);
  assert.equal(M.mode_multi_funny.lastRound, 14);
  assert.equal(M.mode_multi_funny.hiddenRound, null);
  for (const id of ['mode_single_normal', 'mode_single_hard', 'mode_single_abyss', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss']) {
    assert.equal(M[id].lastRound, 14, id);
    assert.equal(M[id].hiddenRound, 15, id);
  }
  assert.deepEqual(M.mode_multi_hard.spRounds, [3, 9, 11]);
  assert.deepEqual(M.mode_multi_normal.upgradePrices, [5, 8, 11, 12, 13]);
  assert.equal(config.economy.income[1], 4);
  assert.equal(config.economy.income[3], 6);
  assert.equal(config.economy.benchSize, 10);
  assert.equal(config.economy.deployCap, 8);
  assert.equal(config.economy.mergeCountOverrides.chess_char_2_11_a, 2);
  // GitHub #430 (路标月报#2): co-op = solo ×2; the solo Ⅰ/Ⅱ per-operator exceptions are in the overrides.
  // The season-1 缪尔赛思 4 is dropped — this season's table lists every Ⅵ at 5/10, no exception.
  assert.ok(!('chess_char_6_11_a' in config.economy.poolCopiesOverrides));
  assert.equal(config.economy.poolCopiesCoopScale, 2);
  assert.equal(config.economy.poolCopiesOverrides.chess_char_1_07_a, 10);
  assert.equal(config.economy.poolCopiesOverrides.chess_char_2_11_a, 8);
  assert.equal(config.economy.poolCopiesOverrides.chess_char_2_02_a, 12);
  assert.deepEqual(config.hiddenCore.single, 350);
  assert.deepEqual(config.hiddenCore.multi, 1200);
  assert.equal(config.titles.length, 6);
});

test('stages: 19 rows × 21 cols with known glyphs; paths are contiguous', () => {
  const glyphs = new Set('#XrRfphbaASEIOmgdi'.split(''));
  for (const s of Object.values(stages)) {
    assert.equal(s.rows.length, 19, `${s.id}: rows`);
    for (const row of s.rows) {
      assert.equal(row.length, 21, `${s.id}: cols`);
      for (const ch of row) assert.ok(glyphs.has(ch), `${s.id}: glyph ${ch}`);
    }
    assert.equal(s.rows[9][2], 'E', `${s.id}: objective at (9,2)`);
    assert.equal(s.rows[9][10], 'S', `${s.id}: gate at (9,10)`);
    for (const paths of [s.groundPaths, s.groundPathsWithDevices]) {
      for (const [k, p] of Object.entries(paths)) {
        for (let i = 1; i < p.length; i++) {
          const dr = Math.abs(p[i][0] - p[i - 1][0]), dc = Math.abs(p[i][1] - p[i - 1][1]);
          assert.ok(dr <= 1 && dc <= 1 && dr + dc > 0, `${s.id} ${k}: step ${i}`);
          const g = s.rows[p[i][0]][p[i][1]];
          assert.ok(s.tiles[g]?.groundPassable, `${s.id} ${k}: impassable ${g}`);
        }
      }
    }
    assert.ok(s.groundPaths['9,10->9,2'], `${s.id}: lower gate path`);
  }
  assert.equal(Object.values(stages).filter((s) => s.active).length, 8);
});

test('bosses, factions, tokens and choices resolve', () => {
  assert.equal(Object.keys(bosses).length, 10);
  for (const b of Object.values(bosses)) {
    assert.ok(enemies[b.enemyKey], `${b.bossId}: enemy`);
    for (const v of Object.values(b.bloodPoint)) assert.ok(isFiniteNum(v) && v > 0, `${b.bossId}: bloodPoint`);
    for (const t of Object.values(b.templates)) assert.ok(waves[t.template], `${b.bossId}: ${t.template}`);
  }
  assert.equal(Object.values(bosses).filter((b) => b.hidden).length, 3);

  assert.equal(Object.keys(factions.entries).length, 67);
  for (const e of Object.values(factions.entries)) {
    assert.equal(typeof e.fly, 'boolean', `faction ${e.key}: fly`);
    assert.ok(!('kS' in e), `faction ${e.key}: no k copies (research 08 §7-1)`);
    for (const x of [{ key: e.key }, ...e.N, ...e.E]) {
      assert.ok(enemies[x.key], `faction ${e.key}: ${x.key}`);
      assert.ok(!('k' in x), `faction ${e.key}: ${x.key} has no k`);
      assert.equal(enemies[x.key].isFlyEnemy, e.fly, `faction ${e.key}: ${x.key} shares the entry's movement class`);
    }
  }
  for (const k of Object.values(factions.templateSlots)) assert.ok(enemies[k], `template slot ${k}`);
  // the official generator's parameters (research 08 §2)
  const g = factions.generation;
  assert.equal(g.maxLevelCnt, 15);
  assert.equal(g.specialEnemyNum, 3);
  assert.equal(g.fillType, 'SPECIAL');
  assert.deepEqual([g.minReplacedEnemyCount, g.maxReplacedEnemyCount, g.firstHalfMaxRound, g.minActionIntervalRatio], [1, 5, 7, 0.05]);
  assert.deepEqual(Object.values(g.typeSlots), [3, 3, 3, 3, 3, 3]);
  assert.deepEqual(Object.values(g.placeholders).map((p) => p.slot).sort(), ['E', 'EF', 'N', 'NF', 'S', 'SF'], 'T / TF are tokens, not placeholders');
  assert.ok(!('kFormula' in g));

  for (const t of Object.values(tokens)) {
    assertStatsFinite(t.stats, t.tokenId, ['maxHp', 'atk', 'def', 'res', 'bat', 'aspd']);
    for (const o of t.owners) assert.ok(chess[o]?.tokens.includes(t.tokenId), `${t.tokenId}: owner ${o}`);
  }
  assert.ok(tokens.enemy_9012_acloon, '炎佑 present');

  assert.equal(Object.keys(choices.events).length, 109);
  for (const s of Object.values(choices.schedule)) {
    for (const r of Object.values(s.rounds)) {
      assert.ok(r.families.length > 0);
      for (const ids of Object.values(r.events)) for (const id of ids) assert.ok(choices.events[id], `event ${id}`);
    }
  }
  for (const c of choices.cards.bounty) {
    assert.ok(effects[c.effectId]);
    for (const a of c.adds) assert.ok(enemies[a.enemyKey], `bounty ${c.effectId}: ${a.enemyKey}`);
    assert.ok([1, 2, 3].includes(c.tier));
  }
  for (const c of choices.cards.tactic) assert.ok(effects[c.effectId]);
  for (const [id, p] of Object.entries(choices.pools)) {
    for (const x of [...(p.items || []), ...(p.weighted || []).map((w) => w[0])]) assert.ok(items[x] || chess[x], `pool ${id}: ${x}`);
  }
});

// ---- regression tests for review findings -------------------------------------------------------

test('chess: module parts flagged isToken upgrade the summon, never the operator', () => {
  // 缪尔赛思 golden: talent 0 keeps her own text/token/cnt; the 流形 upgrades live on the token variant.
  const mlyss = chess.chess_char_6_11_b;
  assert.equal(mlyss.talents[0].name, '净水即生命');
  assert.equal(mlyss.talents[0].tokenKey, 'token_10030_mlyss_wtrman');
  assert.equal(mlyss.talents[0].bb.cnt, 1);
  assert.ok(!('scale' in mlyss.talents[0].bb), 'token-only blackboard leaked into the operator talent');
  assert.ok(!mlyss.talents.some((t) => t.bb.damage_scale !== undefined || t.bb.sp === 5), 'token talents attached to operator');
  const wtr = tokens.token_10030_mlyss_wtrman.variants;
  assert.equal(wtr.chess_char_6_11_a.talents[0].bb.scale, 0.9);
  assert.equal(wtr.chess_char_6_11_b.talents[0].bb.scale, 1);
  assert.ok(wtr.chess_char_6_11_b.talents.some((t) => t.bb.damage_scale === 0.85));
  assert.equal(wtr.chess_char_6_11_b.count, 1);

  // 浊心斯卡蒂 golden: operator talent 0 still sends 1 海嗣; the 30 s duration belongs to the 海嗣.
  const skadi = chess.chess_char_6_04_b;
  assert.equal(skadi.talents[0].tokenKey, 'token_10017_skadi2_dedant');
  assert.equal(skadi.talents[0].bb.cnt, 1);
  assert.ok(!('duration' in skadi.talents[0].bb));
  const dedant = tokens.token_10017_skadi2_dedant.variants;
  assert.equal(dedant.chess_char_6_04_a.talents[0].bb.duration, 25);
  assert.equal(dedant.chess_char_6_04_b.talents[0].bb.duration, 30);
  assert.equal(dedant.chess_char_6_04_b.stats.respawnTime, dedant.chess_char_6_04_a.stats.respawnTime - 5, 'module token attribute');

  // 伺夜 golden: the wolves' damage reduction is on the wolf, not on 伺夜.
  assert.ok(!chess.chess_char_3_19_b.talents.some((t) => t.bb.damage_scale !== undefined));
  assert.ok(tokens.token_10028_vigil_wolf.variants.chess_char_3_19_b.talents.some((t) => t.bb.damage_scale === 0.85));
  assert.ok(!tokens.token_10028_vigil_wolf.variants.chess_char_3_19_a.talents.some((t) => t.bb.damage_scale !== undefined));

  // 耀骑士临光 golden: “耀阳” gets the module trait upgrade.
  assert.equal(tokens.token_10019_nearl2_sword.variants.chess_char_6_17_b.trait.bb.atk_scale, 1.15);
  assert.equal(tokens.token_10019_nearl2_sword.variants.chess_char_6_17_a.trait.bb.atk_scale, undefined);

  // Module talent overrides keep base keys the upgrade does not restate (宴: +100 aspd at 70% HP lost).
  assert.equal(chess.chess_char_1_18_b.talents[0].bb.min_attack_speed, 100);
  assert.equal(chess.chess_char_1_18_b.talents[0].bb.damage_resistance, 0.25);
});

test('chess/tokens: talent tokens resolve and every token variant says where it comes from', () => {
  for (const c of Object.values(chess)) {
    for (const t of c.talents) if (t.tokenKey) {
      assert.ok(c.tokens.includes(t.tokenKey) && tokens[t.tokenKey], `${c.chessId}: talent token ${t.tokenKey}`);
    }
  }
  // 凛御银灰: the talent's container id maps onto the default skill's token (S2 → eagle2).
  const svash = chess.chess_char_5_14_a;
  assert.equal(svash.talents[0].tokenKey, 'token_10057_svash2_eagle2');
  assert.equal(svash.talents[0].containerTokenKey, 'token_10057_svash2_eagle');
  assert.equal(svash.skill.overrideTokenKey, 'token_10057_svash2_eagle2');
  const allowed = new Set(['talent', 'skill', 'display']);
  for (const t of Object.values(tokens)) {
    for (const [owner, v] of Object.entries(t.variants)) {
      assert.ok(Array.isArray(v.sources) && v.sources.length && v.sources.every((s) => allowed.has(s)), `${t.tokenId}@${owner}: sources`);
      assert.ok(chess[owner]?.tokens.includes(t.tokenId), `${t.tokenId}: owner ${owner}`);
    }
  }
  assert.deepEqual(tokens.token_10057_svash2_eagle1.variants.chess_char_5_14_a.sources, ['display']);
  // 夕's skill "cnt" is a charge count, not a token count.
  assert.equal(tokens.token_10015_dusk_drgn.variants.chess_char_5_12_a.count, null);
  // Placeable (hand) tokens = the manually deployable summons (PRTS 卫戍协议/帮助 §战斗部署; user playtest #6): shop
  // state DEFAULT or no shop-state entry (凯瑟琳's device), never HIDDEN, made by some owner loadout (talent or skill) —
  // 赫默's 医疗探机 and 巫恋's 诅咒娃娃 included (in battle they wait on their tile for the skill).
  const makes = (list) => list.includes('talent') || list.includes('skill');
  for (const t of Object.values(tokens)) {
    if (t.kind !== 'summon') continue;
    const made = Object.values(t.variants).some((v) => makes(v.sources) || Object.values(v.bySkill || {}).some((b) => makes(b.sources)));
    assert.equal(t.placeable, t.displayType !== 'HIDDEN' && made, `${t.tokenId} (${t.name}): placeable`);
  }
  assert.deepEqual(Object.values(tokens).filter((t) => t.placeable).map((t) => t.name).sort(),
    ['医疗探机', '诅咒娃娃', '斯卡蒂的海嗣', '流形', '狼群', '爬行号·防护单元'].sort());
  assert.equal(tokens.enemy_9012_acloon.stats.deployLimit, tokens.enemy_9012_acloon.deployLimit);
});

// ---- operator loadouts: selectable skills & modules (DESIGN §16) ------------------------------------

test('chess: skills[] = every skill unlocked at the status, at the chess skill level; exactly one default = skill', () => {
  for (const c of Object.values(chess)) {
    if (c.isDiy) { assert.equal(c.skills, undefined, `${c.chessId}: DIY has no skills`); continue; }
    assert.ok(Array.isArray(c.skills) && c.skills.length >= 1 && c.skills.length <= 3, `${c.chessId}: skills`);
    const idx = c.skills.map((s) => s.index);
    assert.deepEqual(idx, [...idx].sort((a, b) => a - b), `${c.chessId}: skills ordered by index`);
    assert.equal(new Set(idx).size, idx.length, `${c.chessId}: unique skill indices`);
    // E1 unlocks S1–S2, E2 S1–S3 (tier 1–2 normal chess are E1)
    assert.ok(idx.every((i) => i <= c.status.phase), `${c.chessId}: skill ${idx} locked at E${c.status.phase}`);
    const defs = c.skills.filter((s) => s.isDefault);
    assert.equal(defs.length, 1, `${c.chessId}: one default skill`);
    const { isDefault, ...d } = defs[0];
    assert.deepEqual(d, c.skill, `${c.chessId}: default entry = skill (back-compat shape)`);
    for (const s of c.skills) {
      assert.equal(s.level, c.status.skillLevel, `${c.chessId} ${s.skillId}: level`);
      assert.equal(typeof s.isDefault, 'boolean');
      assert.ok(typeof s.skillId === 'string' && typeof s.iconId === 'string' && typeof s.name === 'string', `${c.chessId}: skill ids`);
      assert.ok(typeof s.trigger?.rule === 'string', `${c.chessId} ${s.skillId}: trigger`);
      assert.ok(s.rangeGrid === null || s.rangeGrid.every(isPair), `${c.chessId} ${s.skillId}: rangeGrid`);
      assert.ok(!/\{[a-z_@.\[\]]+(:[0-9.%]+)?\}/i.test(s.desc), `${c.chessId} ${s.skillId}: unresolved placeholder`);
      for (const [k, v] of Object.entries(s.bb)) assert.ok(isFiniteNum(v), `${c.chessId} ${s.skillId}: bb ${k}`);
      assert.ok(s.overrideTokenKey === null || c.tokens.includes(s.overrideTokenKey), `${c.chessId} ${s.skillId}: token ${s.overrideTokenKey} listed`);
    }
    if (c.tier <= 2 && !c.isGolden) assert.ok(idx.length <= 2, `${c.chessId}: E1 chess has no S3`);
  }
  // Triggers per skill (PRTS 卫戍协议/帮助 技能策略; tools/build-data.mjs resolveTrigger): the class rows cover every MANUAL
  // skill of the class and no AUTO one; a MANUAL skill with a 技能范围 of its own (not an attack-range change) is SKILL_RANGE.
  const rules = (id) => chess[id].skills.map((s) => s.trigger.rule);
  const raws = (id) => chess[id].skills.map((s) => s.trigger.rawRule);
  assert.deepEqual(rules('chess_char_1_02_a'), ['TAKE_DAMAGE', 'TAKE_DAMAGE']);         // 角峰 (重装, both MANUAL)
  assert.deepEqual(rules('chess_char_1_10_b'), ['DEFAULT', 'TAKE_DAMAGE']);             // 古米 (S1 自动触发)
  assert.deepEqual(rules('chess_char_3_08_a'), ['ACTIVE_RANGE', 'SEARCH']);             // 薄绿 (阵法术师: the default S2 too; S1's x-2: the owner's rule)
  assert.deepEqual(raws('chess_char_3_08_a'), ['SEARCH', 'SEARCH']);
  assert.deepEqual(rules('chess_char_3_19_a'), ['DEFAULT', 'DEFAULT', 'SP_FULL']);      // 伺夜 (战术家: S1/S2 are AUTO)
  assert.deepEqual(rules('chess_char_6_11_b'), ['MLYSS_WTRMAN', 'MLYSS_WTRMAN', 'MLYSS_WTRMAN']); // 缪尔赛思 (charId row −1)
  assert.deepEqual(rules('chess_char_1_08_a'), ['DEFAULT', 'SKILL_RANGE']);             // 德克萨斯 S2 剑雨: 对周围所有敌人
  assert.deepEqual(chess.chess_char_1_08_a.skills[1].trigger.customRangeGrid, chess.chess_char_1_08_a.skills[1].rangeGrid);
  assert.deepEqual(rules('chess_char_4_22_a'), ['DEFAULT', 'DEFAULT', 'ACTIVE_RANGE']); // 银灰: "攻击范围缩小 / 扩大" = attack range
  assert.deepEqual(rules('chess_char_3_18_a'), ['DEFAULT', 'SKILL_RANGE', 'ACTIVE_RANGE']); // 忍冬: S2 对周围…, S3 攻击距离+1
  // the deliberate deviation from the 重装 row (DESIGN §21.29, the owner's decision; tools/build-data.mjs
  // TRIGGER_DEVIATIONS, per chess): six skills cast with an enemy in range, rawRule keeps the official TAKE_DAMAGE
  for (const id of ['chess_char_1_04_a', 'chess_char_1_04_b']) {                       // 深巡: S1 keeps the row, S2 deviates
    assert.deepEqual(rules(id), ['TAKE_DAMAGE', 'ACTIVE_RANGE']);                      // (S2: and the owner's ACTIVE_RANGE on top)
    assert.deepEqual(raws(id), ['TAKE_DAMAGE', 'TAKE_DAMAGE']);
  }
  for (const id of ['chess_char_1_20_a', 'chess_char_1_20_b']) {                       // 雷蛇: S1 AUTO, S2 deviates
    assert.deepEqual(rules(id), ['DEFAULT', 'DEFAULT']);
    assert.deepEqual(raws(id), ['DEFAULT', 'TAKE_DAMAGE']);
  }
  for (const id of ['chess_char_5_08_a', 'chess_char_5_08_b']) {                       // 号角: S1 AUTO, S2 / S3 deviate
    assert.deepEqual(rules(id), ['DEFAULT', 'DEFAULT', 'DEFAULT']);
    assert.deepEqual(raws(id), ['DEFAULT', 'TAKE_DAMAGE', 'TAKE_DAMAGE']);
  }
  for (const id of ['chess_char_2_18_a', 'chess_char_2_18_b']) {                       // 灰毫: S1 (generic skcom_atk_up[3]) and S2
    assert.deepEqual(rules(id), ['DEFAULT', 'DEFAULT']);
    assert.deepEqual(raws(id), ['TAKE_DAMAGE', 'TAKE_DAMAGE']);
  }
  // 余 S2 厚礼上宾 (DESIGN §22.10, the owner's decision of 2026-10-04): SKILL_RANGE on its own x-1, S1 keeps the row, S3 its
  // official charId row
  for (const id of ['chess_char_6_03_a', 'chess_char_6_03_b']) {
    assert.deepEqual(rules(id), ['TAKE_DAMAGE', 'SKILL_RANGE', 'CUSTOM_RANGE']);
    assert.deepEqual(raws(id), ['TAKE_DAMAGE', 'TAKE_DAMAGE', 'CUSTOM_RANGE_SEARCH_ENEMY']);
    assert.deepEqual(chess[id].skills[1].trigger.customRangeGrid, chess[id].skills[1].rangeGrid);
  }
  // the owner's rule of 2026-10-05 (a deliberate deviation): a MANUAL skill on the basic strategy (DEFAULT by no row or by
  // a deviation: 深巡 S2) or on the SEARCH row whose running attack range strictly contains the operator's own range is
  // ACTIVE_RANGE on that range (rawRule keeps the official row)
  const tiles = (g) => new Set((g || []).map(([r, c]) => `${r},${c}`));
  const wider = (a, b) => { const A = tiles(a), B = tiles(b); return A.size > B.size && [...B].every((k) => A.has(k)); };
  const active = Object.values(chess).flatMap((c) => (c.skills || []).filter((s) => s.trigger.rule === 'ACTIVE_RANGE').map((s) => [c, s]));
  for (const [c, s] of active) {
    assert.equal(s.skillType, 'MANUAL', `${c.chessId} ${s.skillId}`);
    const dev = c.baseId === 'chess_char_1_04_a' && s.skillId === 'skchr_udflow_2';
    assert.equal(s.trigger.rawRule, dev ? 'TAKE_DAMAGE' : s.trigger.rawRule === 'SEARCH' ? 'SEARCH' : 'DEFAULT', `${c.chessId} ${s.skillId}: only the basic strategy / SEARCH`);
    assert.ok(wider(s.trigger.customRangeGrid, c.rangeGrid), `${c.chessId} ${s.skillId}: its running range strictly contains ${c.rangeId}`);
    if (s.rangeGrid) assert.deepEqual(s.trigger.customRangeGrid, s.rangeGrid, `${c.chessId} ${s.skillId}: the skill's own grid`);
  }
  assert.equal(active.length, 78, '39 skills, normal + elite');
  assert.equal(new Set(active.map(([c, s]) => `${c.baseId} ${s.skillId}`)).size, 39);
  // from the SEARCH row (解放者 / 阵法术师 / 安洁莉娜) and 深巡 S2's deviation: the owner's decisions of 2026-10-05
  const fromSearch = active.filter(([, s]) => s.trigger.rawRule === 'SEARCH').map(([c, s]) => `${c.baseId} ${s.skillId}`);
  assert.deepEqual([...new Set(fromSearch)].sort(), ['chess_char_3_08_a skchr_mint_1', 'chess_char_4_05_a skchr_beewax_1', 'chess_char_4_24_a skchr_billro_3', 'chess_char_5_19_a skchr_mlynar_2', 'chess_char_5_20_a skchr_aglina_3']);
  assert.equal(fromSearch.length, 10);
  // the SEARCH skills whose range does not grow keep the row (薄绿 / 蜜蜡 S2, 卡涅利安 S1 / S2, 玛恩纳 S1, 安洁莉娜 S2, 圣聆初雪 S1)
  const search = Object.values(chess).flatMap((c) => (c.skills || []).filter((s) => s.trigger.rule === 'SEARCH').map((s) => `${c.baseId} ${s.skillId}`));
  assert.deepEqual([...new Set(search)].sort(), ['chess_char_3_08_a skchr_mint_2', 'chess_char_4_05_a skchr_beewax_2', 'chess_char_4_24_a skchr_billro_1', 'chess_char_4_24_a skchr_billro_2', 'chess_char_5_19_a skchr_mlynar_1', 'chess_char_5_20_a skchr_aglina_2', 'chess_char_6_02_a skchr_sbell2_1']);
  const grown = (id, sid) => chess[id].skills.find((s) => s.skillId === sid).trigger;
  assert.deepEqual(grown('chess_char_5_07_a', 'skchr_surtr_3').customRangeGrid.length, chess.chess_char_5_07_a.rangeGrid.length + 2, '史尔特尔 S3 攻击距离+2: 1-1 grown by 2');
  assert.equal(grown('chess_char_5_03_a', 'skchr_blaze2_3').rule, 'DEFAULT', '烛煌 S3: 4-11 does not contain her 3-1');
  assert.deepEqual(grown('chess_char_1_04_a', 'skchr_udflow_2'), { rule: 'ACTIVE_RANGE', rawRule: 'TAKE_DAMAGE', customRangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] }, '深巡 S2: its 3-2 over her 2-2, on top of the §21.29 deviation');
  assert.equal(grown('chess_char_3_08_a', 'skchr_mint_1').rawRule, 'SEARCH', '薄绿 S1: its official 阵法术师 row stays the rawRule');
  assert.equal(grown('chess_char_5_15_a', 'skchr_thorn2_3').rule, 'DEFAULT', '引星棘刺 S3: 被动效果：攻击范围扩大 is her own range');
  const deviated = Object.values(chess).flatMap((c) => (c.skills || []).filter((s) => s.trigger.rawRule === 'TAKE_DAMAGE' && s.trigger.rule !== 'TAKE_DAMAGE').map((s) => `${c.baseId} ${s.skillId}`));
  assert.equal(deviated.length, 14, 'exactly the six skills of §21.29 and 余 S2, normal + elite');
  assert.deepEqual([...new Set(deviated)].sort(), ['chess_char_1_04_a skchr_udflow_2', 'chess_char_1_20_a skchr_liskam_2', 'chess_char_2_18_a skchr_ashlok_2', 'chess_char_2_18_a skcom_atk_up[3]', 'chess_char_5_08_a skchr_horn_2', 'chess_char_5_08_a skchr_horn_3', 'chess_char_6_03_a skchr_yu_2']);
  for (const c of Object.values(chess)) {
    for (const s of c.skills || []) {
      if (s.skillType !== 'MANUAL') assert.ok(!['TAKE_DAMAGE', 'SEARCH', 'SKILL_RANGE'].includes(s.trigger.rule), `${c.chessId} ${s.skillId}: an AUTO / PASSIVE skill takes no strategy row`);
      if (s.trigger.rule === 'SKILL_RANGE') assert.ok(s.rangeGrid && s.skillType === 'MANUAL' && !/攻击(范围|距离)(与溅射范围)?(扩大|改变|缩小|缩短|加长|增加|\+)/.test(s.desc), `${c.chessId} ${s.skillId}: SKILL_RANGE only for a 技能范围`);
    }
  }
  assert.deepEqual(chess.chess_char_1_01_a.skills.map((s) => [s.skillId, s.level, s.spCost, s.isDefault]),
    [['skchr_inside_1', 4, 14, false], ['skchr_inside_2', 4, 24, true]]);             // 隐现 Lv4 (default S2)
  const sw = chess.chess_char_3_04_b;                                                    // 琳琅诗怀雅: S2 makes the 香槟
  assert.deepEqual(sw.skills.map((s) => s.overrideTokenKey), [null, 'token_10031_swire2_gdtrap', null]);
});

test('chess: golden modules[] (+ statsBase/traitBase/talentsBase) compose back to the default record', async () => {
  const { composeStats, composeTalents } = await import('../server/sim/simdata.js');
  const statKeys = ['maxHp', 'atk', 'def', 'res', 'aspd', 'cost', 'blockCnt', 'respawnTime', 'bat', 'deployLimit', 'deckStack'];
  let nMods = 0;
  for (const c of Object.values(chess)) {
    if (c.isDiy) continue;
    if (!c.isGolden || !(c.status.equipLevel > 0)) {
      for (const k of ['modules', 'statsBase', 'traitBase', 'talentsBase']) assert.equal(c[k], undefined, `${c.chessId}: normal chess has no ${k}`);
      continue;
    }
    assert.ok(Array.isArray(c.modules), `${c.chessId}: modules`);
    const defs = c.modules.filter((m) => m.isDefault);
    assert.equal(defs.length, c.module?.active ? 1 : 0, `${c.chessId}: default module iff module active`);
    if (defs.length) assert.equal(defs[0].uniEquipId, c.module.id);
    const dm = defs[0] ?? null;
    // default loadout = the record's own stats / trait / talents
    assert.deepEqual(composeStats(c.statsBase, dm?.attr), c.stats, `${c.chessId}: statsBase + default attr = stats`);
    assert.deepEqual(dm?.traitOverride ?? c.traitBase, c.trait, `${c.chessId}: trait`);
    // (the record's own lists chain their lower-potential entries — shared/potential.js; a composed list carries none)
    assert.deepEqual(composeTalents(c.talentsBase, dm?.talentChanges), stripPotential(c.talents), `${c.chessId}: talents`);
    assert.equal(new Set(c.modules.map((m) => m.uniEquipId)).size, c.modules.length);
    for (const m of c.modules) {
      nMods++;
      assert.match(m.uniEquipId, /^uniequip_\d{3}_/, `${c.chessId}: module id`);
      assert.ok(!/^uniequip_001_/.test(m.uniEquipId), `${c.chessId}: INITIAL (no module) is not a module choice`);
      assert.ok(typeof m.name === 'string' && typeof m.typeName === 'string' && m.typeName.length > 0, `${m.uniEquipId}: name/type`);
      assert.equal(m.level, c.status.equipLevel, `${m.uniEquipId}: level`);
      for (const [k, v] of Object.entries(m.attr)) assert.ok(statKeys.includes(k) && isFiniteNum(v), `${m.uniEquipId}: attr ${k}`);
      assert.ok(m.traitOverride === null || (typeof m.traitOverride.desc === 'string' && m.traitOverride.bb), `${m.uniEquipId}: traitOverride`);
      for (const t of m.talentChanges) assert.ok(Number.isInteger(t.talentIndex) && t.bb && typeof t.hidden === 'boolean', `${m.uniEquipId}: talentChanges`);
      // every choice composes into complete stats
      assertStatsFinite(composeStats(c.statsBase, m.attr), `${c.chessId}+${m.uniEquipId}`, statKeys);
    }
  }
  assert.ok(nMods >= 170, `module choices: ${nMods}`);  // 184 ADVANCED modules over 129 goldens
  // 缪尔赛思 精锐 (E2 60, module Lv3): 梳妆流形 (default) / 落叶四季
  const m = chess.chess_char_6_11_b;
  assert.deepEqual(m.modules.map((x) => [x.uniEquipId, x.typeName, x.isDefault]), [['uniequip_002_mlyss', 'TAC-X', true], ['uniequip_003_mlyss', 'TAC-Y', false]]);
  assert.deepEqual(m.modules[1].attr, { maxHp: 170, atk: 28, def: 28 });
  assert.deepEqual([m.statsBase.maxHp, m.statsBase.atk, m.statsBase.def], [1703, 492, 111]);   // ATK 467 + 攻击力+25 (full potential)
  // module-less goldens: no choices, base = stats
  assert.deepEqual(chess.chess_char_5_14_b.modules, []);
  assert.deepEqual(chess.chess_char_5_14_b.statsBase, chess.chess_char_5_14_b.stats);
});

test('tokens: owner loadout variants (bySkill per non-default owner skill, byModule per other module / none)', () => {
  const allowed = new Set(['talent', 'skill', 'display']);
  for (const t of Object.values(tokens)) {
    for (const [owner, v] of Object.entries(t.variants || {})) {
      const o = chess[owner];
      const alt = o.skills.filter((s) => !s.isDefault).map((s) => String(s.index));
      assert.deepEqual(Object.keys(v.bySkill || {}), alt, `${t.tokenId}@${owner}: bySkill keys`);
      for (const b of Object.values(v.bySkill || {})) {
        assert.ok(Array.isArray(b.sources) && b.sources.every((x) => allowed.has(x)), `${t.tokenId}@${owner}: bySkill sources`);
        assert.ok(b.count === null || isInt(b.count), `${t.tokenId}@${owner}: bySkill count`);
      }
      const mods = o.isGolden && o.module?.active ? [...o.modules.filter((m) => !m.isDefault).map((m) => m.uniEquipId), 'none'] : [];
      assert.deepEqual(Object.keys(v.byModule || {}), mods, `${t.tokenId}@${owner}: byModule keys`);
      for (const b of Object.values(v.byModule || {})) assert.ok(b.stats && b.trait && Array.isArray(b.talents), `${t.tokenId}@${owner}: byModule shape`);
    }
  }
  const w = tokens.token_10030_mlyss_wtrman.variants.chess_char_6_11_b;
  assert.equal(w.skill.skillId, 'sktok_mlyss_wtrman_3');                         // default S3
  assert.equal(w.bySkill[0].skill.skillId, 'sktok_mlyss_wtrman_1');              // 流形 follows the owner's skill slot
  assert.equal(w.byModule.none.talents[0].bb.scale, 0.9);                        // no module: 90% copy
  assert.ok(!w.byModule.none.talents.some((x) => x.bb.damage_scale !== undefined));
  assert.deepEqual(tokens.token_10022_kazema_shadow.variants.chess_char_2_11_a.bySkill[0].sources, [], '风丸 S1 makes no 纸偶');
  assert.deepEqual(tokens.token_10057_svash2_eagle1.variants.chess_char_5_14_a.bySkill[0].sources, ['talent', 'skill', 'display'], '凛御银灰 S1: talent eagle = eagle1');
});

test('enemies: rangeRadius contract (MELEE ⇒ 0) and undefined-field defaults', () => {
  for (const e of Object.values(enemies)) {
    const s = e.stats;
    assert.ok(s.rangeRadius >= 0, `${e.key}: rangeRadius ${s.rangeRadius}`);
    if (e.applyWay === 'MELEE') assert.equal(s.rangeRadius, 0, `${e.key}: MELEE enemy must not attack at range`);
    assert.ok(isFiniteNum(s.rawRangeRadius), `${e.key}: rawRangeRadius`);
    if (e.applyWay !== 'MELEE') assert.equal(s.rangeRadius, Math.max(0, s.rawRangeRadius), `${e.key}: rangeRadius`);
    assert.ok(s.maxHp > 0 && s.bat > 0 && s.moveSpeed >= 0 && s.lpr >= 0, `${e.key}: core stats`);
  }
  // Only three skill-driven leaders have an official (defined) attack speed of 0.
  const zeroAspd = Object.values(enemies).filter((e) => e.stats.aspd === 0).map((e) => e.key).sort();
  assert.deepEqual(zeroAspd, ['enemy_9017_achunt', 'enemy_9017_achunt_2', 'enemy_9021_acduml', 'enemy_9021_acduml_2', 'enemy_9022_acdumm']);
  assert.equal(enemies.enemy_1045_hammer.stats.rangeRadius, 0);         // 粉碎攻坚手: MELEE, official 2.5
  assert.equal(enemies.enemy_1045_hammer.stats.rawRangeRadius, 2.5);
  assert.equal(enemies.enemy_1305_mhslim.stats.rangeRadius, 1.8);       // 灼热源石虫: RANGED keeps its radius
  assert.equal(enemies.enemy_2016_csphtm.stats.aspd, 100);              // 卢西恩: undefined attackSpeed → 100
  assert.equal(enemies.enemy_1269_nhfly.stats.bat, 1);                  // 枯朽之种: undefined bat → 1
  assert.equal(enemies.enemy_1229_darmy.stats.lpr, 1);                  // 萨卡兹王庭军战士: undefined lpr → 1
  assert.equal(enemies.enemy_10067_ftsjc.stats.atk, 400);               // 灼藤: season override ATK 400
  for (const w of Object.values(waves)) {
    for (const [k, o] of Object.entries(w.overrides)) {
      if (o.stats && 'rangeRadius' in o.stats && (o.applyWay || enemies[k].applyWay) === 'MELEE') assert.equal(o.stats.rangeRadius, 0, `${w.id}: ${k}`);
    }
  }
});

test('stages: 下半 devices at match start = the non-hidden ones (act1 m02 has no crates); official helper lanes', () => {
  for (const s of Object.values(stages)) for (const d of s.devices) assert.equal(d.active, !d.hidden, `${s.id} ${d.alias}`);
  const m02 = stages.act1autochess_m02;
  for (const a of ['#001', '#002', '#003', '#004']) assert.equal(m02.devices.find((d) => d.alias === `trap_1105_accrate${a}`).active, false, `m02 crate ${a}`);
  // research 08 §3.2: upper gate of act1 m02 keeps the top road to col 3; act1 m04 stays on row 11 down to col 4
  const lane = (id, k = '12,10->9,2') => stages[id].groundPathsWithDevices[k].map((p) => p.join(',')).join(' ');
  assert.equal(lane('act1autochess_m02'), '12,10 12,9 12,8 12,7 12,6 12,5 12,4 12,3 11,3 10,3 9,3 9,2');
  assert.equal(lane('act1autochess_m04'), '12,10 12,9 11,9 11,8 11,7 11,6 11,5 11,4 10,4 9,4 9,3 9,2');
  assert.equal(lane('act2autochess_m02'), '12,10 12,9 12,8 12,7 11,7 10,7 9,7 9,6 9,5 9,4 9,3 9,2', 'crates on col 9: col 7 (mire)');
  assert.equal(lane('act2autochess_m02', '9,10->9,2'), '9,10 9,9 9,8 9,7 9,6 9,5 9,4 9,3 9,2');
});

test('stages: device rangeTiles are the direction-rotated range, inside the grid', () => {
  for (const s of Object.values(stages)) {
    for (const d of s.devices) {
      if (!d.rangeGrid) { assert.equal(d.rangeTiles ?? null, null, `${s.id} ${d.alias}`); continue; }
      assert.ok(Array.isArray(d.rangeTiles) && d.rangeTiles.length <= d.rangeGrid.length, `${s.id} ${d.alias}: rangeTiles`);
      for (const [r, c] of d.rangeTiles) assert.ok(r >= 0 && r < 19 && c >= 0 && c < 21, `${s.id} ${d.alias}: (${r},${c})`);
      assert.ok(d.rangeTiles.some(([r, c]) => r === d.pos[0] && c === d.pos[1]) || !d.rangeGrid.some(([a, b]) => a === 0 && b === 0), `${s.id} ${d.alias}: own tile`);
    }
  }
  // A blower on the row-13 separator facing DOWN blows into rows 12..10 of its column.
  const blower = stages.act2autochess_m01.devices.find((d) => d.key === 'trap_013_blower' && d.pos[0] === 13 && d.pos[1] === 5);
  assert.deepEqual(blower.rangeTiles, [[13, 5], [12, 5], [11, 5], [10, 5]]);
});

test('stages: player-facing names are clean Chinese "战场#NN…" labels (no research annotations)', () => {
  // Regression: research 05 named act1 m01 '战场#01 (upper half #01)'; the English note reached the
  // briefing BATTLEFIELD row. Names come from research only, so the build must strip such notes.
  for (const s of Object.values(stages)) {
    if (s.kind === 'unite') continue; // the escaped levels' two maps: the remake's own label, checked in the test below
    assert.match(s.name, /^战场#\d{2}(?:\((?:上半|下半)\))?(?: \S.*)?$/, `${s.id}: name ${JSON.stringify(s.name)}`);
    assert.doesNotMatch(s.name, /[A-Za-z]/, `${s.id}: Latin text in name ${JSON.stringify(s.name)}`);
    assert.equal(s.name, s.name.trim().replace(/\s+/g, ' '), `${s.id}: stray whitespace in name`);
  }
  assert.equal(stages.act1autochess_m01.name, '战场#01');
  assert.equal(stages.act2autochess_m01.name, '战场#05(下半) 源石流发生装置');
});

test('stages: the escaped levels\' maps — one per helper count, never a match stage (and since 0.2.1 never the 联防 field)', () => {
  // act2autochess constData escapedBattleTemplateMapSinglePlayer / MultiPlayer → config.unite.templates { 1, 2 }. 0.2.0
  // fought the 联防 battle on these maps (GitHub #41); 联防 plays on the round's battlefield again (the owner's decision of
  // 2026-10-07, test/match/feedback5-unite-map.test.js) and the records stay as the official level data
  assert.deepEqual(config.unite.templates, { 1: 'act1autochess_escaped_single', 2: 'act1autochess_escaped_multi' });
  for (const [n, id] of Object.entries(config.unite.templates)) {
    const s = stages[id];
    assert.ok(s, id);
    assert.equal(s.kind, 'unite');
    assert.equal(s.helpers, Number(n));
    assert.equal(s.active, false);
    assert.equal(s.weight, 0);
    assert.deepEqual(s.modes, []);
    assert.ok(!Object.values(config.modes).some((m) => m.stages.includes(id)), `${id} in no mode's stage list`);
    assert.equal(s.name, `联防阵地（${n}名玩家）`);
    assert.deepEqual(s.devices, [], 'no crates, platforms or other devices');
    assert.deepEqual(s.special, {}, 'no water, mire, smog or infection');
    // the official level map (level_act1autochess_escaped_*.json): two road halves joined at col 10
    assert.deepEqual(s.rows.slice(9, 13), ['##ErrrrrrrSrrrrrrrS##', '###rrrrrrr#rrrrrrr###', '###rrrrrrr#rrrrrrr###', '###rrrrrrrSrrrrrrrS##']);
    for (let r = 9; r <= 12; r++) for (const c of [19, 20]) assert.equal(s.tiles[s.rows[r][c]].groundPassable, false, `${id} (${r},${c}) is no ground`);
    assert.ok(s.groundPaths['9,10->9,2'] && s.groundPaths['9,18->9,2'], 'walkable from both gates');
  }
  // the two maps are tile for tile the same: they differ in their routes (data/waves.json — 1 helper enters at col 10,
  // 2 helpers at col 18 through the checkpoint (9,10)), which the 联防 field follows on the round's stage (its gates
  // (9,10) / (12,10) and (9,18) / (12,18))
  assert.deepEqual(stages.act1autochess_escaped_single.rows, stages.act1autochess_escaped_multi.rows);
  assert.deepEqual(waves.act1autochess_escaped_single.routes.map((r) => r.start), [[9, 10], [9, 10], [12, 10], [9, 10], [9, 10], [9, 10], [9, 10], [9, 10]]);
  assert.deepEqual(waves.act1autochess_escaped_multi.routes.map((r) => r.start), [[9, 18], [9, 18], [12, 18], [9, 18], [9, 18], [9, 18], [9, 18], [9, 18]]);
  assert.deepEqual(waves.act1autochess_escaped_multi.routes[3].checkpoints, [[9, 10]]);
});

test('official spot checks (hard-coded values from the zh_CN client data)', () => {
  // at full potential (the owner's decision of 2026-10-07): the client's numbers plus each operator's potential steps
  const st = (id) => { const s = chess[id].stats; return [s.maxHp, s.atk, s.def, s.res, s.blockCnt, s.cost]; };
  assert.deepEqual(st('chess_char_6_11_b'), [1893, 517, 141, 0, 1, 13]);      // 缪尔赛思 精锐 (E2 60 + module Lv3): 492 + 25 ATK, 15 − 2 cost
  assert.deepEqual(st('chess_char_6_17_b'), [3593, 1143, 279, 0, 1, 17]);     // 耀骑士临光 精锐: 1108 + 35, 19 − 2
  assert.deepEqual(st('chess_char_3_08_a'), [1594, 629, 170, 15, 1, 22]);     // 薄绿 (E2 1): 25 − 3
  assert.deepEqual(st('chess_char_2_11_a'), [1816, 574, 254, 0, 2, 13]);      // 风丸 (E1 60): 547 + 27, 15 − 2
  assert.deepEqual(st('chess_char_4_07_b'), [2383, 629, 359, 0, 1, 11]);      // 风笛 精锐: 604 + 25, 13 − 2
  assert.equal(chess.chess_char_6_11_b.module.level, 3);
  assert.deepEqual([chess.chess_char_4_07_b.skill.skillId, chess.chess_char_4_07_b.skill.level, chess.chess_char_4_07_b.skill.spCost], ['skchr_bpipe_2', 7, 5]);
  const es = (k) => { const s = enemies[k].stats; return [s.maxHp, s.atk, s.def, s.res]; };
  assert.deepEqual(es('enemy_1422_lrsldr'), [4700, 300, 100, 40]);           // 萨卡兹枯朽前锋 (template N)
  assert.deepEqual(es('enemy_1427_lrnazg'), [15000, 900, 500, 50]);          // “灵幛” (template E)
  assert.deepEqual(es('enemy_1045_hammer'), [10000, 1000, 1000, 0]);         // 粉碎攻坚手
  assert.deepEqual(bosses.boss_1.bloodPoint, { FUNNY: 247500, NORMAL: 675000, HARD: 1800000, ABYSS: 3600000 });
  assert.deepEqual(bosses.boss_10.bloodPoint, { FUNNY: 825000, NORMAL: 1012500, HARD: 3800000, ABYSS: 7600000 });
  assert.deepEqual([items.chess_item_1_01_e_a.name, items.chess_item_1_01_e_a.price, items.chess_item_1_01_e_a.params.atk], ['维式重锤', 1, 0.15]);
  assert.deepEqual([bands.band_sarkazb.totalHp, bands.band_lisa.totalHp], [45, 20]);
  assert.deepEqual(config.modes.mode_multi_abyss.rounds['15'].prepTime, 215);
  assert.equal(config.modes.mode_multi_abyss.enemyScale['6'].hp, 2.239488);   // 1.2^4 × 1.08
});

test('a module trait part that only adds a display line writes that line only (GitHub #400): 圣约送葬人 REA-Y heals 50 per enemy hit, its line ASPD +12', () => {
  // official battle_equip_table uniequip_003_excu2: a DISPLAY part whose blackboard `value` 12 belongs to its own
  // 「攻击速度+{value}」; the class trait's 「回复自身{value}生命」 stays the base 50 (REA-X's TRAIT_DATA_ONLY part rewrites it: 60)
  const g = chess.chess_char_5_01_b;
  const y = g.modules.find((m) => m.uniEquipId === 'uniequip_003_excu2').traitOverride;
  assert.equal(y.desc, g.traitBase.desc, 'the class trait as without a module');
  assert.match(y.desc, /每攻击到一个敌人回复自身50生命/);
  assert.match(y.descRaw, /回复自身<@ba\.kw>50<\/>生命/);
  assert.equal(y.moduleDesc, '攻击范围内存在2名及以上敌人时攻击速度+12');
  assert.match(g.modules.find((m) => m.uniEquipId === 'uniequip_002_excu2').traitOverride.desc, /回复自身60生命/, 'REA-X');
  // no other module record carries a trait line that differs from its owner's class trait only in a number its own
  // display line uses (the class of this bug)
  const forms = [...Object.values(chess), ...Object.values(D.backups.units || {}).flatMap((u) => Object.values(u.forms || {}))];
  for (const f of forms) {
    for (const m of f.modules || []) {
      const o = m.traitOverride;
      if (!o?.moduleDesc || !f.traitBase?.desc || o.desc === f.traitBase.desc) continue;
      const nums = (t) => String(t).match(/\d+(?:\.\d+)?/g) || [];
      const sameWords = o.desc.replace(/\d+(?:\.\d+)?/g, '#') === f.traitBase.desc.replace(/\d+(?:\.\d+)?/g, '#');
      if (!sameWords) continue;
      const moved = nums(o.desc).filter((n, i) => n !== nums(f.traitBase.desc)[i]);
      assert.ok(!moved.every((n) => nums(o.moduleDesc).includes(n)), `${f.chessId || f.charId} ${m.uniEquipId}: ${o.desc} / ${o.moduleDesc}`);
    }
  }
});

/** Read an official cache file (only called when HAS_CACHE). */
const raw = (rel) => JSON.parse(readFileSync(join(CACHE, rel), 'utf8'));

test('independent re-derivation of every chess and enemy stat from the raw official tables', { skip: !HAS_CACHE && 'no .cache/gamedata' }, () => {
  const act = raw('excel/activity_table.json').activity.AUTOCHESS_SEASON.act2autochess;
  const CT = raw('excel/character_table.json'), BE = raw('excel/battle_equip_table.json'), ST = raw('excel/skill_table.json');
  const PH = { PHASE_0: 0, PHASE_1: 1, PHASE_2: 2 };
  let n = 0;
  for (const [id, cd] of Object.entries(act.charChessDataDict)) {
    const c = chess[id];
    if (!c || c.isDiy) continue;
    const shop = act.charShopChessDatas[act.chessNormalIdLookupDict[id] || id];
    const P = CT[shop.charId].phases[PH[cd.status.evolvePhase]];
    const k0 = P.attributesKeyFrames[0], k1 = P.attributesKeyFrames[P.attributesKeyFrames.length - 1];
    const t = (cd.status.charLevel - k0.level) / (k1.level - k0.level || 1);
    const f = (key) => k0.data[key] + (k1.data[key] - k0.data[key]) * t;
    const exp = { maxHp: f('maxHp'), atk: f('atk'), def: f('def'), res: f('magicResistance'), aspd: f('attackSpeed'), blockCnt: f('blockCnt'), cost: f('cost'), respawnTime: f('respawnTime') };
    const map = { max_hp: 'maxHp', atk: 'atk', def: 'def', magic_resistance: 'res', attack_speed: 'aspd', block_cnt: 'blockCnt', cost: 'cost', respawn_time: 'respawnTime' };
    // full potential (the owner's decision of 2026-10-07): every potentialRanks attribute step (all ADDITION)
    const POT = { MAX_HP: 'maxHp', ATK: 'atk', DEF: 'def', MAGIC_RESISTANCE: 'res', ATTACK_SPEED: 'aspd', COST: 'cost', RESPAWN_TIME: 'respawnTime' };
    for (const r of CT[shop.charId].potentialRanks || []) for (const m of r.buff?.attributes?.attributeModifiers || []) exp[POT[m.attributeType]] += m.value;
    if (cd.status.equipLevel > 0 && shop.defaultUniEquipId) {
      const mp = BE[shop.defaultUniEquipId]?.phases.find((p) => p.equipLevel === cd.status.equipLevel);
      for (const b of mp?.attributeBlackboard || []) if (map[b.key]) exp[map[b.key]] += b.value;
    }
    for (const [key, v] of Object.entries(exp)) assert.ok(Math.abs(v - c.stats[key]) <= 0.5 + 1e-9, `${id} ${c.name}: ${key} ${c.stats[key]} vs official ${v}`);
    const lv = ST[CT[shop.charId].skills[shop.defaultSkillIndex].skillId].levels[cd.status.skillLevel - 1];
    for (const e of lv.blackboard) if (!(e.valueStr && e.value === 0)) assert.ok(Math.abs(c.skill.bb[e.key] - e.value) < 1e-6, `${id}: skill bb ${e.key}`);
    assert.deepEqual([c.skill.spCost, c.skill.initSp, c.skill.duration], [lv.spData.spCost, lv.spData.initSp, lv.duration], `${id}: skill sp`);
    // every selectable skill (DESIGN §16) at the chess skill level
    const ph = PH[cd.status.evolvePhase];
    const unlockedIdx = CT[shop.charId].skills.map((s, i) => [s, i]).filter(([s, i]) => s.skillId && (i === shop.defaultSkillIndex || PH[s.unlockCond?.phase ?? 'PHASE_0'] <= ph)).map(([, i]) => i);
    assert.deepEqual(c.skills.map((s) => s.index), unlockedIdx, `${id}: unlocked skills`);
    for (const s of c.skills) {
      const sl = ST[CT[shop.charId].skills[s.index].skillId].levels[cd.status.skillLevel - 1];
      for (const e of sl.blackboard) if (!(e.valueStr && e.value === 0)) assert.ok(Math.abs(s.bb[e.key] - e.value) < 1e-6, `${id} S${s.index + 1}: bb ${e.key}`);
      assert.deepEqual([s.spCost, s.initSp, s.duration, s.name], [sl.spData.spCost, sl.spData.initSp, sl.duration, sl.name], `${id} S${s.index + 1}: sp`);
    }
    for (const m of c.modules || []) {
      const mp = BE[m.uniEquipId].phases.find((p) => p.equipLevel === cd.status.equipLevel);
      const exp = {};
      for (const b of mp.attributeBlackboard) exp[map[b.key] ?? b.key] = (exp[map[b.key] ?? b.key] || 0) + b.value;
      for (const [k, v] of Object.entries(exp)) {
        const f = { respawn_time: 'respawnTime', base_attack_time: 'bat', max_deploy_count: 'deployLimit', max_deck_stack_cnt: 'deckStack' }[k] ?? k;
        assert.ok(Math.abs(m.attr[f] - v) < 1e-6, `${id} ${m.uniEquipId}: attr ${k} ${m.attr[f]} vs official ${v}`);
      }
    }
    n++;
  }
  assert.equal(n, 258);

  const db = new Map(raw('levels/enemydata/enemy_database.json').enemies.map((e) => [e.Key, e.Value]));
  const ov = new Map((raw('levels/activities/act1autochess/level_autochess_enemy_data.json').enemyDbRefs || [])
    .filter((r) => r.overwrittenData).map((r) => [r.id, r.overwrittenData]));
  // the 鸭爵 strategy's swapped-in enemies cost 1 LP at the protection point (PRTS 卫戍协议：盟约 下半/PRTS盟约记录 鸭爵 备注
  // "但进入保护目标点将减少1点目标生命值"; the database's lifePointReduce 0 is the roguelike rule)
  const swapped = new Set(Object.values(act.effectBuffInfoDataDict).flat().filter((b) => b.key === 'round_start_all_player_change_enemy_2')
    .flatMap((b) => b.blackboard.filter((kv) => kv.key === 'enemylist').flatMap((kv) => kv.valueStr.split(','))));
  assert.equal(swapped.size, 4);
  for (const e of Object.values(enemies)) {
    const base = db.get(e.key).find((l) => l.level === 0).enemyData;
    const o = ov.get(e.key);
    // Season override if defined, else the base value if defined, else the documented default.
    const pick = (get, dflt) => {
      const x = o && get(o);
      if (x && x.m_defined) return x.m_value;
      const b = get(base);
      return b && b.m_defined ? b.m_value : dflt;
    };
    const exp = {
      maxHp: pick((x) => x.attributes?.maxHp, 0), atk: pick((x) => x.attributes?.atk, 0), def: pick((x) => x.attributes?.def, 0),
      res: pick((x) => x.attributes?.magicResistance, 0), moveSpeed: pick((x) => x.attributes?.moveSpeed, 1),
      bat: pick((x) => x.attributes?.baseAttackTime, 1), aspd: pick((x) => x.attributes?.attackSpeed, 100),
      lpr: swapped.has(e.key) ? 1 : pick((x) => x.lifePointReduce, 1), massLevel: pick((x) => x.attributes?.massLevel, 0),
      motion: pick((x) => x.motion, 'WALK'),
    };
    for (const [key, v] of Object.entries(exp)) {
      const got = e.stats[key];
      assert.ok(typeof v === 'number' ? Math.abs(v - got) < 1e-6 : v === got, `${e.key} ${e.name}: ${key} ${got} vs official ${v}`);
    }
    // official attribute power (RandomEnemyGenerater._GetEnemyAttrPower): DATABASE stats (no season override), float32
    const at = base.attributes;
    const f = Math.fround;
    const P = f(f(f(f(at.atk.m_value * 5) + f(at.maxHp.m_value)) + f(at.def.m_value * 3)) + f(3 * at.magicResistance.m_value));
    assert.equal(e.attrPower, P, `${e.key} ${e.name}: attrPower`);
  }
  // 灼藤 / 元核孽生者 count with their database ATK, not the season override 400 (research 08 §2.3)
  for (const k of ['enemy_10067_ftsjc', 'enemy_1439_dslntf']) {
    const e = enemies[k];
    assert.equal(e.stats.atk, 400, `${k}: spawned with the season ATK`);
    assert.notEqual(e.attrPower, e.stats.maxHp + 5 * e.stats.atk + 3 * e.stats.def + 3 * e.stats.res, `${k}: power from the database ATK`);
  }
});

test('offline rebuild reproduces data/ byte-for-byte (data/ is not stale)', { skip: (!HAS_CACHE && 'no .cache/gamedata') || (process.env.DATA_DIR && 'DATA_DIR set') }, (t) => {
  const out = mkdtempSync(join(tmpdir(), 'sp-data-'));
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-data.mjs'), '--offline', '--quiet', '--out', out, '--report', join(out, 'report.json')], { encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0 && /missing cached file/.test(r.stderr)) { t.skip('partial .cache/gamedata (run node tools/build-data.mjs once online)'); return; }
    assert.equal(r.status, 0, `build failed: ${r.stderr}`);
    for (const f of FILES) {
      assert.ok(readFileSync(join(out, `${f}.json`)).equals(readFileSync(join(DATA, `${f}.json`))), `data/${f}.json is stale — run: node tools/build-data.mjs`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('build CLI rejects unknown options and missing values without writing anything', () => {
  for (const args of [['--bogus'], ['--out'], ['--out', '--offline'], ['--refresh', '--offline']]) {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-data.mjs'), ...args], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status}`);
    assert.match(r.stderr, /usage:/);
  }
});
