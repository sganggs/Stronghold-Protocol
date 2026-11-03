// test/data-versions.test.js — the official versions' data (docs/DATA.md "Official versions (M0)"): the registry
// shared/versions.js, the build profiles tools/versions/<slug>.mjs, the committed data/versions/<slug>/ directories, the
// build CLI's --version, the field adapters, server/data.js's per-version loader, and (M1, DESIGN §35.23) how a server
// serves an enabled version's data. The default version's bytes are guarded by test/data.test.js and test/golden.test.js,
// its cs inputs and default room by test/versions-default-guard.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { DEFAULT_VERSION, VERSIONS, versionById, versionSlug, versionOfData } from '../shared/versions.js';
import { loadProfile, pinGroupOf, pinnedShaOf } from '../tools/versions/profiles.mjs';
import { bondActiveType, selfBackupPreset, launchModes, launchMilestones, applyAdapters } from '../tools/versions/adapters.mjs';
import { validateReferences } from '../shared/plugins/validate.js';
import { DATA_DIR, VERSION_DATA_FILES, getData, getVersionData, loadData, resetVersionData, versionDataDir } from '../server/data.js';
import { createStaticHandler, startServer } from '../server/index.js';
import { hasDefaultGamedata } from './helpers/defaultGamedata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'tools', 'build-data.mjs');
const EN =JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', 'en.json'), 'utf8'));
/** The 15 files tools/build-data.mjs builds, plus the copy of data/tuning.json. */
const BUILT = ['backups', 'bands', 'bonds', 'bosses', 'chess', 'choices', 'config', 'effects', 'enemies', 'factions', 'garrisons',
  'items', 'stages', 'tokens', 'waves'];
const OTHERS = VERSIONS.filter((v) => v.id !== DEFAULT_VERSION);
const REBUILD_ALL = `rebuild every version: ${VERSIONS.map((v) => `node tools/build-data.mjs --version ${v.id}`).join('; ')} `
  + '(a version also reads data/assets.json, data/tuning.json and docs/research/*.json, so a default-side change to those can make it stale)';
/**
 * The expected counts of each non-default build, written out (DESIGN §35.22.3), independent of the
 * profile's `expect` / `config` that the build and validateAll read: a typo in a profile fails here. V2_1: 36 strategies,
 * 120 chess (119 visible with the 4 DIY slots), no 终极 mode (it opened with V2_2): activity_table @1457587e. The 功勋
 * levels: 35 at a launch (levels 36–60 open with the second sub-version, adapter launchMilestones), 60 in V1_2.
 */
const PINNED = Object.freeze({
  'act2autochess@V2_1': { bonds: 23, bands: 36, visibleNonDiy: 115, chess: 240, items: 115, effects: 361, hiddenCore: [350, 1200], milestones: 35 },
  act1autochess: { bonds: 18, bands: 30, visibleNonDiy: 95, chess: 200, items: 89, effects: 281, hiddenCore: [300, 1000], milestones: 60 },
  'act1autochess@V1_1': { bonds: 18, bands: 20, visibleNonDiy: 95, chess: 200, items: 89, effects: 281, hiddenCore: [300, 1000], milestones: 35 },
});

const readJson = (dir, name) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
const runBuild = (args, timeout = 180_000) => spawnSync(process.execPath, [BUILD, ...args], { encoding: 'utf8', timeout });

// ---------------------------------------------------------------------------------------------------
// registry and profiles
// ---------------------------------------------------------------------------------------------------

test('registry: unique ids, one default with dir \'\', OS-safe unique dirs, msgid labels, a matching profile each', async () => {
  const ids = VERSIONS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Object.isFrozen(VERSIONS) && VERSIONS.every((v) => Object.isFrozen(v)));
  const defaults = VERSIONS.filter((v) => v.dir === '');
  assert.deepEqual(defaults.map((v) => v.id), [DEFAULT_VERSION]);
  const dirs = OTHERS.map((v) => v.dir.toLowerCase());
  assert.equal(new Set(dirs).size, dirs.length, 'dirs unique case-insensitively');
  for (const v of OTHERS) assert.match(v.dir, /^versions\/[a-z0-9][a-z0-9_-]*\/$/, v.id);
  assert.ok(!VERSIONS.some((v) => v.id === 'act1vautochess'), 'the 2024 卫戍协议 is not a version (maintainer, 2026-10-22)');
  for (const v of VERSIONS) {
    assert.ok(EN[v.label], `public/i18n/en.json lacks the label ${v.label}`);
    assert.equal(versionById(v.id), v);
    assert.ok(existsSync(join(ROOT, 'tools', 'versions', `${versionSlug(v)}.mjs`)), `profile of ${v.id}`);
    const { entry, profile } = await loadProfile(v.id);
    assert.equal(entry, v);
    assert.equal(profile.id, v.id);
    assert.equal(profile.season, v.season);
  }
  assert.equal(versionSlug(versionById(DEFAULT_VERSION)), DEFAULT_VERSION);
  assert.equal(versionSlug(versionById('act1autochess@V1_1')), 'act1autochess-v1_1');
  assert.equal(versionSlug(versionById('act2autochess@V2_1')), 'act2autochess-v2_1');
  // the maintainer's names by period (2026-10-22): 第一期 = act1autochess, 第二期 = act2autochess, 上半 / 下半 = V*_1 / V*_2
  assert.deepEqual(Object.fromEntries(VERSIONS.map((v) => [v.id, v.label])), {
    act2autochess: '第二期下半', 'act2autochess@V2_1': '第二期上半', act1autochess: '第一期下半', 'act1autochess@V1_1': '第一期上半',
  });
  assert.equal(versionById('nope'), null);
  assert.equal(versionOfData({ config: { version: { id: 'act1autochess' } } }), 'act1autochess');
  assert.equal(versionOfData({ config: {} }), DEFAULT_VERSION);
  assert.equal(versionOfData(null), DEFAULT_VERSION);
  await assert.rejects(loadProfile('act1vautochess'), /unknown version/);
});

test('profiles: the default is today\'s build; pins pick a commit per file group', async () => {
  const { profile: def } = await loadProfile(DEFAULT_VERSION);
  // pinned since master's activity_table lost the 盟约 season (CN 2.7.91, DESIGN §37.91)
  assert.deepEqual(Object.keys(def.pins), ['default', 'character']);
  assert.equal(pinnedShaOf(def, 'excel/character_table.json'), '08ba2aea0e8dba88eff0ec0d2c87e24b4db626f8');
  assert.equal(pinnedShaOf(def, 'levels/activities/act2autochess/level_act2autochess_01.json'), '17759cc8cdf37388414145d16262a3a06f3ab25e');
  assert.deepEqual(def.adapters, []);
  assert.equal(def.tables, 'default');
  assert.deepEqual(def.config.hiddenCore, { single: 350, multi: 1200 });
  assert.equal(def.config.rules, undefined, 'no rules: the default build emits no config.version');
  assert.deepEqual(def.expect, { bonds: 23, bands: 40, visibleNonDiy: 112, triggerDeviations: 'default' });
  assert.equal(pinnedShaOf(def, 'excel/activity_table.json'), '17759cc8cdf37388414145d16262a3a06f3ab25e');

  const { profile: v12 } = await loadProfile('act1autochess');
  assert.equal(pinnedShaOf(v12, 'excel/activity_table.json'), '21b1f240817dafe486653adda7a5085ff8a1ba17');
  assert.equal(pinnedShaOf(v12, 'levels/activities/act1autochess/level_act1autochess_01.json'), '21b1f240817dafe486653adda7a5085ff8a1ba17');
  assert.equal(pinnedShaOf(v12, 'levels/enemydata/enemy_database.json'), 'ee2cabffd45de01548cc6dceb23129ce93ac7926');
  assert.equal(pinnedShaOf(v12, 'excel/enemy_handbook_table.json'), 'ee2cabffd45de01548cc6dceb23129ce93ac7926');
  const { profile: v11 } = await loadProfile('act1autochess@V1_1');
  // V1_1 with the 11-18 hotfix (the maintainer, 2026-10-22): activity_table and the character group at ea164ef7, the rest at the
  // launch; no enemy pin: V1_2's ee2cabff would leak V1_2 enemies
  assert.deepEqual(Object.keys(v11.pins), ['default', 'activity', 'character']);
  for (const rel of ['excel/activity_table.json', 'excel/skill_table.json', 'excel/character_table.json']) {
    assert.equal(pinnedShaOf(v11, rel), 'ea164ef70736ca2d1a356b3bf7b1cd7540960dc1', rel);
  }
  for (const rel of ['levels/enemydata/enemy_database.json', 'excel/range_table.json', 'levels/activities/act1autochess/level_act1autochess_m01.json']) {
    assert.equal(pinnedShaOf(v11, rel), '8303c922f749f0dcf08e03671519421ef6a7748b', rel);
  }
  const { profile: v21 } = await loadProfile('act2autochess@V2_1');
  assert.deepEqual(Object.keys(v21.pins), ['default'], 'V2_1: every file at its launch commit (none changed before V2_2)');
  for (const rel of ['excel/activity_table.json', 'excel/skill_table.json', 'excel/range_table.json', 'levels/enemydata/enemy_database.json',
    'levels/activities/act1autochess/level_autochess_enemy_data.json', 'levels/activities/act2autochess/level_act2autochess_m01.json']) {
    assert.equal(pinnedShaOf(v21, rel), '1457587e48fe65361f523821d24e6d14c3b91713', rel);
  }
  assert.deepEqual(v21.adapters, ['launchModes', 'launchMilestones']);
  assert.deepEqual(v11.adapters, ['bondActiveType', 'selfBackupPreset', 'launchMilestones']);
  assert.deepEqual(v12.adapters, ['bondActiveType', 'selfBackupPreset'], 'V1_2 is the final state: all 60 功勋 levels');
  assert.equal(v21.research, 'docs/research/versions/act2autochess-v2_1/', 'V2_1 uses its own evidence');
  assert.equal(v21.tables, 'default', 'the 下半-measured tables apply by id / name');
  assert.deepEqual(v21.config.rules, {}, 'the default\'s rules');
  assert.equal(v21.expect.triggerDeviations, 'present');
  assert.equal(pinGroupOf('excel/uniequip_table.json'), 'character');
  assert.equal(pinGroupOf('excel/range_table.json'), 'range');
  assert.equal(pinGroupOf('levels/activities/act2autochess/level_act2autochess_m01.json'), 'levels');
  assert.equal(pinGroupOf('excel/item_table.json'), null);
});

// ---------------------------------------------------------------------------------------------------
// the committed version directories
// ---------------------------------------------------------------------------------------------------

for (const v of OTHERS) {
  test(`data/${v.dir}: mode and shop fields come from this version's pinned activity table`, async (t) => {
    const { profile } = await loadProfile(v.id);
    const sha = pinnedShaOf(profile, 'excel/activity_table.json');
    const source = join(ROOT, '.cache', `gamedata@${sha}`, 'excel', 'activity_table.json');
    if (!existsSync(source)) { t.skip(`no ${source}`); return; }
    const raw = JSON.parse(readFileSync(source, 'utf8'));
    const act = raw.activity.AUTOCHESS_SEASON[profile.season];
    const config = readJson(join(ROOT, 'data', v.dir), 'config');
    for (const [id, mode] of Object.entries(config.modes)) {
      const official = act.modeDataDict[id];
      for (const [field, input] of Object.entries({ name: 'name', code: 'code', sortId: 'sortId', type: 'modeType',
        difficulty: 'modeDifficulty', desc: 'desc', effectDescList: 'effectDescList', specialPhaseTime: 'specialPhaseTime',
        activeBondIds: 'activeBondIdList', inactiveBondIds: 'inactiveBondIdList', inactiveEnemyKeys: 'inactiveEnemyKey' })) {
        assert.deepEqual(mode[field], official[input], `${id}.${field}`);
      }
      const levels = Object.values(act.shopLevelDataDict[id]);
      assert.deepEqual(mode.shopSlots, Object.fromEntries(levels.map(l => [l.shopLevel, { chess: l.charChessCount, item: l.itemCount }])), id);
      assert.deepEqual(mode.upgradePrices, levels.slice(0, -1).map(l => l.initialUpgradePrice), id);
      assert.deepEqual(mode.levelTagColors, Object.fromEntries(levels.map(l => [l.shopLevel, l.levelTagBgColor])), id);
      assert.equal(mode.maxShopLevel, Math.max(...levels.map(l => l.shopLevel)), id);
      for (const [round, built] of Object.entries(mode.rounds)) {
        const turn = raw.autoChessData.turnInfoDataDict[id][round];
        assert.equal(built.prepTimeData, turn.normalPhaseTime, `${id} R${round}`);
        assert.equal(built.prepTime, mode.type !== 'SINGLE' || profile.config.rules?.soloTimed ? turn.normalPhaseTime : null, `${id} R${round}`);
        assert.equal(built.isSpPrepare, act.battleDataDict[id][round].some(b => b.isSpPrepare), `${id} R${round}`);
      }
    }
  });

  test(`data/${v.dir}: the 16 files, under 6 MB, config.version, the profile's counts, no effectRef, the trigger deviations of its profile, references resolve`, async () => {
    const { profile } = await loadProfile(v.id);
    const dir = join(ROOT, 'data', v.dir);
    const names = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    assert.deepEqual(names, [...BUILT, 'tuning'].sort(), 'exactly the 15 built files and tuning.json');
    for (const n of VERSION_DATA_FILES) assert.ok(names.includes(n), `${n}.json: server/data.js VERSION_DATA_FILES expects it`);
    const total = BUILT.reduce((n, f) => n + statSync(join(dir, `${f}.json`)).size, 0);
    assert.ok(total < 6 * 1024 * 1024, `${v.id}: ${total} bytes`);
    const f = Object.fromEntries(BUILT.map((n) => [n, readJson(dir, n)]));
    assert.equal(f.config.version?.id, v.id);
    assert.equal(f.config.version.family, v.family);
    assert.deepEqual(f.config.version.rules, profile.config.rules ?? {});
    assert.equal(Object.keys(f.config).at(-1), 'version', 'config.version is the last key');
    assert.equal(f.config.season, v.season);
    assert.equal(f.config.hiddenCore.single, profile.config.hiddenCore.single);
    assert.equal(f.config.hiddenCore.multi, profile.config.hiddenCore.multi);
    // 上半's constData has no singleReconnectTime (12e0a020 added it): null, never the 下半 value (server/lobby.js falls back)
    if (v.season === 'act1autochess') assert.equal(f.config.constants.singleReconnectTime, null, 'no 下半 constant as official data');
    // no 终极 mode before V2_2 (上半 has none; V2_1's table lists it with a later startTime, adapter launchModes)
    assert.ok(Object.values(f.config.modes).every((m) => m.difficulty !== 'ABYSS'), `${v.id}: no 终极 mode`);
    assert.ok(Object.keys(f.config.modes).every((id) => !/abyss/.test(id)), `${v.id}: no abyss mode id`);
    for (const st of Object.values(f.stages)) assert.ok(st.modes.every((id) => f.config.modes[id]), `${v.id} ${st.id}: a stage mode the version lacks`);
    assert.equal(Object.keys(f.bonds).length, profile.expect.bonds);
    assert.equal(Object.keys(f.bands).length, profile.expect.bands);
    assert.equal(Object.values(f.chess).filter((c) => !c.isGolden && c.visible).length, profile.expect.visibleNonDiy);
    const pin = PINNED[v.id];
    assert.ok(pin, `${v.id}: pin its counts in PINNED`);
    assert.deepEqual({
      bonds: Object.keys(f.bonds).length, bands: Object.keys(f.bands).length,
      visibleNonDiy: Object.values(f.chess).filter((c) => !c.isGolden && c.visible).length, chess: Object.keys(f.chess).length,
      items: Object.keys(f.items).length, effects: Object.keys(f.effects).length, hiddenCore: [f.config.hiddenCore.single, f.config.hiddenCore.multi],
      milestones: f.config.rewards.milestones.length,
    }, pin, `${v.id}: the pinned counts`);
    assert.deepEqual(f.config.rewards.milestones.map((m) => m.level), Array.from({ length: pin.milestones }, (_, i) => i + 1), `${v.id}: the 功勋 levels 1…n`);
    for (const [file, recs] of [['items', f.items], ['bands', f.bands]]) {
      for (const r of Object.values(recs)) assert.ok(!Object.hasOwn(r, 'effectRef'), `${file} ${r.id ?? r.bandId}: no effectRef (it would name a default-version id)`);
    }
    if (profile.expect.triggerDeviations === 'present') {
      // the deliberate deviations (DESIGN §21.29) of the operators the version has, on their TAKE_DAMAGE rows
      const devs = Object.values(f.chess).filter((c) => c.skills?.some((s) => s.trigger?.rawRule === 'TAKE_DAMAGE' && s.trigger.rule !== 'TAKE_DAMAGE'));
      assert.ok(devs.length > 0 && devs.length % 2 === 0, `${v.id}: normal and elite records under a deviation (${devs.length})`);
      assert.ok(!Object.values(f.chess).some((c) => c.charId === 'char_107_liskam'), '雷蛇 joined with V2_2');
    }
    if (profile.expect.triggerDeviations === 'none') {
      const td = [];
      for (const c of Object.values(f.chess)) for (const s of c.skills || []) if (s.trigger?.rawRule === 'TAKE_DAMAGE') td.push(`${c.chessId} ${s.skillId}`);
      for (const [id, u] of Object.entries(f.backups.units)) for (const [k, form] of Object.entries(u.forms)) for (const s of form.skills) if (s.trigger?.rawRule === 'TAKE_DAMAGE') td.push(`${id}@${k} ${s.skillId}`);
      assert.deepEqual(td, [], 'no TAKE_DAMAGE row, so no trigger deviation applies');
    }
    assert.ok(readFileSync(join(dir, 'tuning.json')).equals(readFileSync(join(ROOT, 'data', 'tuning.json'))), 'tuning.json is a byte copy of data/tuning.json');
    assert.deepEqual(validateReferences(f), []);
  });

  test(`data/${v.dir}: an offline rebuild reproduces all 16 files byte for byte`, { skip: process.env.DATA_DIR && 'DATA_DIR set' }, async (t) => {
    const { profile } = await loadProfile(v.id);
    const shas = [...new Set(Object.values(profile.pins || {}))];
    const out = mkdtempSync(join(tmpdir(), 'sp-version-'));
    try {
      const r = runBuild(['--version', v.id, '--offline', '--quiet', '--out', out, '--report', join(out, 'r.json')]);
      if (r.status !== 0 && /missing cached file/.test(r.stderr)) {
        t.skip(`${v.id}: official data not cached (${shas.map((s) => `.cache/gamedata@${s}/`).join(', ')}; run node tools/build-data.mjs --version ${v.id} once online)`);
        return;
      }
      assert.equal(r.status, 0, `${v.id}: build failed: ${r.stderr}`);
      const dir = join(ROOT, 'data', v.dir);
      for (const n of [...BUILT, 'tuning']) {
        assert.ok(readFileSync(join(out, `${n}.json`)).equals(readFileSync(join(dir, `${n}.json`))), `data/${v.dir}${n}.json is stale — ${REBUILD_ALL}`);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
}

// 第二期上半's records that keep today's id but differ from today's data (DESIGN §35.22.5 lists each). Today's data is V2_2
// with the 04-14 level and text fixes (86da4cfa) and the modules added after 03-14, so the list is not only V2_2's. A
// rebuild that changes one of the compared fields fails here, and the hand-written list is reviewed with the new set.
// Compared: every field of bands, effects, enemies and tokens; the waves' routes; the chess records' whole modules (ids,
// attr, traitOverride, talentChanges with their blackboards and texts) and their skill / talent texts; the 自选 operators'
// powers and bonds, the 自选 forms' module ids and the 自选 operators / ownedPool / excluded sets against today's
// (backups.json). Not compared: the chess fields the shop changes rewrite
// (visible, isHidden, bonds, garrisons, identifier, shopSortId: the DIY slots chess_char_5_diy1 / diy2 are 22 / 23 in V2_1,
// 24 / 25 today), the waves' usedBy (终极 dropped), the 自选 forms' texts, and the other backups.json fields derived from
// the roster (units[].standsIn, the order of the diy pools, locked, tokens).
test('data/versions/act2autochess-v2_1: the same-id records that differ from today\'s are the listed ones', () => {
  const read = (dir, name) => readJson(join(ROOT, 'data', dir), name);
  const changed = (name, pick = (x) => x) => {
    const today = read('', name);
    const v21 = read('versions/act2autochess-v2_1', name);
    return Object.keys(v21).filter((id) => Object.hasOwn(today, id) && JSON.stringify(pick(today[id])) !== JSON.stringify(pick(v21[id]))).sort();
  };
  // 余's HP, 商业包装 every 7 sold, 陈 以己之长's 高台 clause (all V2_2)
  assert.deepEqual(changed('bands'), ['band_chen', 'band_malkie', 'band_yu']);
  // the bands' and bonds' effects above, 奥术法阵 without 失能 and 商业包装方案 (V2_2), 阿戈尔's swallow order and
  // 悬赏·折射II's 卫队 / 卫士 (04-14)
  assert.deepEqual(changed('effects'), ['aceffect_band_27', 'aceffect_band_39', 'bondeffect_egir', 'bondeffect_invest', 'bondeffect_mira',
    'bondeffect_visi', 'eff_acarm048', 'eff_acarm074', 'eff_acgarm048', 'eff_acgarm074', 'enemyeffect_15_7']);
  // 圆仔 NORMAL and 节日气球 uncounted (level_autochess_enemy_data, 04-14); the rest term markup or an ability's format only
  assert.deepEqual(changed('enemies'), ['enemy_10028_vtswd', 'enemy_10029_vtshld', 'enemy_10030_vtwand', 'enemy_10034_cnvsax', 'enemy_10040_cnvbln',
    'enemy_10144_xdelk_2', 'enemy_2008_flking', 'enemy_2085_skzjxd', 'enemy_2085_skzjxd_2', 'enemy_9011_acrefr']);
  // h07_05's patrol loop (04-14)
  assert.deepEqual(changed('waves', (w) => [w.routes, w.extraRoutes]), ['act2autochess_h07_05', 'act2autochess_h07_05_s']);
  // the modules added after 03-14: 17 elite records offer one fewer (4 of them the CN 2.7.91 modules of 号角, 凛御银灰, 缪尔赛思
  // and 溯光星源, DESIGN §37.91), and their summons lose their byModule entry
  assert.deepEqual(changed('chess', (c) => (c.modules || []).map((m) => m.uniEquipId)), ['chess_char_3_18_b', 'chess_char_4_01_b', 'chess_char_4_16_b',
    'chess_char_5_03_b', 'chess_char_5_05_b', 'chess_char_5_07_b', 'chess_char_5_08_b', 'chess_char_5_13_b', 'chess_char_5_14_b', 'chess_char_5_18_b',
    'chess_char_6_04_b', 'chess_char_6_08_b', 'chess_char_6_10_b', 'chess_char_6_11_b', 'chess_char_6_15_b', 'chess_char_6_16_b', 'chess_char_6_19_b']);
  // whole modules: the 17 above plus 异客's RA-A module uniequip_004_pasngr, whose 1457587e battle_equip has only the rank-0
  // 机理分析 (×1.2 at every potential; today ×1.25 from 潜能 5)
  assert.deepEqual(changed('chess', (c) => c.modules || []), ['chess_char_3_18_b', 'chess_char_4_01_b', 'chess_char_4_16_b',
    'chess_char_5_03_b', 'chess_char_5_05_b', 'chess_char_5_07_b', 'chess_char_5_08_b', 'chess_char_5_13_b', 'chess_char_5_14_b', 'chess_char_5_18_b',
    'chess_char_6_04_b', 'chess_char_6_05_b', 'chess_char_6_08_b', 'chess_char_6_10_b', 'chess_char_6_11_b', 'chess_char_6_15_b', 'chess_char_6_16_b',
    'chess_char_6_19_b']);
  const v21chess = read('versions/act2autochess-v2_1', 'chess');
  const pasngr = v21chess.chess_char_6_05_b.modules.find((m) => m.uniEquipId === 'uniequip_004_pasngr');
  assert.equal(pasngr.talentChanges[1].bb['pasngr_t_1[enhance].damage_scale'], 1.2);
  // the skill or talent texts of 菲莱, 忍冬, 阿罗玛, 乌尔比安, 圣聆初雪 and 焰影苇草 (term markup, 攻击力 30%, （+2） / （+2%）)
  assert.deepEqual(changed('chess', (c) => [c.skill, c.skills, c.talents, c.talentsBase]), ['chess_char_3_06_a', 'chess_char_3_06_b',
    'chess_char_3_18_a', 'chess_char_3_18_b', 'chess_char_4_10_a', 'chess_char_4_10_b', 'chess_char_5_05_a', 'chess_char_5_05_b',
    'chess_char_6_02_a', 'chess_char_6_02_b', 'chess_char_6_08_a', 'chess_char_6_08_b']);
  assert.deepEqual(changed('tokens'), ['token_10017_skadi2_dedant', 'token_10030_mlyss_wtrman', 'token_10039_ulpia_block',
    'token_10057_svash2_eagle1', 'token_10057_svash2_eagle2', 'token_10057_svash2_eagle3']);
  // backups.json: the 自选 operators' powers and bonds from the 03-14 character_table (鸿雪 and 真言 emptyShip, not
  // sargonShip; seven with one power fewer), and the 自选 forms without a module added after 03-14
  const today = read('', 'backups');
  const v21b = read('versions/act2autochess-v2_1', 'backups');
  const changedIn = (sub, pick) => Object.keys(sub(v21b)).filter((id) => Object.hasOwn(sub(today), id)
    && JSON.stringify(pick(sub(today)[id])) !== JSON.stringify(pick(sub(v21b)[id]))).sort();
  const diyOps = (b) => b.diy.operators;
  assert.deepEqual(changedIn(diyOps, (o) => o.bonds), ['char_4055_bgsnow', 'char_4204_mantra']);
  assert.deepEqual(changedIn(diyOps, (o) => o.powers), ['char_003_kalts', 'char_1044_hsgma2', 'char_1050_chen3', 'char_1502_crosly',
    'char_4055_bgsnow', 'char_4132_ascln', 'char_4133_logos', 'char_4195_radian', 'char_4204_mantra']);
  assert.deepEqual(changedIn((b) => b.units, (u) => Object.values(u.forms || {}).map((f) => (f.modules || []).map((m) => m.uniEquipId))),
    ['char_2012_typhon', 'char_2025_shu', 'char_300_phenxi', 'char_4138_narant']);
  // the 自选 pools: the 12 operators released after 03-14 are absent (怒潮凛冬 among them; 冻河, 国度 and 塔露拉 from CN 2.7.91);
  // 银灰, 空弦, 卡涅利安 and 伺夜 are V2_1-only 自选 picks (pending: the kitted gate drops them); 焰狐龙梓兰 and 结城理 are not
  // excluded yet
  const minus = (a, b) => a.filter((c) => !b.includes(c)).sort();
  const later = ['char_1015_aglna2', 'char_1051_headb2', 'char_1052_kalts2', 'char_4226_veen', 'char_4228_closur', 'char_4229_aphris',
    'char_4230_mcnist', 'char_4231_clemnt', 'char_4235_thumpy', 'char_4244_tocka', 'char_4246_dminon', 'char_4247_oxi'];
  const own = ['char_172_svrash', 'char_332_archet', 'char_426_billro', 'char_427_vigil'];
  assert.deepEqual([minus(Object.keys(today.diy.operators), Object.keys(v21b.diy.operators)), minus(Object.keys(v21b.diy.operators), Object.keys(today.diy.operators))], [later, own]);
  assert.deepEqual([minus(today.diy.ownedPool, v21b.diy.ownedPool), minus(v21b.diy.ownedPool, today.diy.ownedPool), v21b.diy.ownedPool.length], [later, own, 67]);
  assert.deepEqual([minus(today.diy.excluded, v21b.diy.excluded), minus(v21b.diy.excluded, today.diy.excluded)], [['char_1048_orchd2', 'char_4217_makoto'], []]);
  const v21 = read('versions/act2autochess-v2_1', 'enemies');
  assert.deepEqual([v21.enemy_2085_skzjxd.rank, v21.enemy_10040_cnvbln.notCountInTotal], ['NORMAL', true]);
});

test('--version act2autochess --offline reproduces data/*.json (the default profile is today\'s build)', { skip: (!hasDefaultGamedata('excel/activity_table.json') && 'no cached official data') || (process.env.DATA_DIR && 'DATA_DIR set') }, (t) => {
  const out = mkdtempSync(join(tmpdir(), 'sp-version-'));
  try {
    const r = runBuild(['--version', DEFAULT_VERSION, '--offline', '--quiet', '--out', out, '--report', join(out, 'r.json')]);
    if (r.status !== 0 && /missing cached file/.test(r.stderr)) { t.skip('partial .cache/gamedata'); return; }
    assert.equal(r.status, 0, r.stderr);
    for (const n of BUILT) assert.ok(readFileSync(join(out, `${n}.json`)).equals(readFileSync(join(ROOT, 'data', `${n}.json`))), `data/${n}.json`);
    assert.ok(!existsSync(join(out, 'tuning.json')), 'the default build writes no tuning.json (data/tuning.json is hand-maintained)');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('build CLI: --version without a value or with an unknown id exits 2 with the usage and writes nothing', () => {
  for (const args of [['--version'], ['--version', '--offline'], ['--version', 'act1vautochess'], ['--version=bogus']]) {
    const out = mkdtempSync(join(tmpdir(), 'sp-version-'));
    try {
      const r = runBuild([...args, '--out', join(out, 'o'), '--report', join(out, 'r.json')], 30_000);
      assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status} ${r.stderr}`);
      assert.match(r.stderr, /usage:/);
      assert.match(r.stderr, /act1autochess@V1_1/, 'the valid ids are listed');
      assert.deepEqual(readdirSync(out), [], 'nothing written');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------------------------------
// server/data.js
// ---------------------------------------------------------------------------------------------------

test('server/data.js: versionDataDir and getVersionData; loadData(DATA_DIR) never reads data/versions', () => {
  resetVersionData();
  assert.equal(versionDataDir(), DATA_DIR);
  assert.equal(versionDataDir(DEFAULT_VERSION), DATA_DIR);
  assert.equal(versionDataDir('act1autochess'), join(DATA_DIR, 'versions', 'act1autochess'));
  assert.equal(versionDataDir('act1autochess@V1_1', '/x'), join('/x', 'versions', 'act1autochess-v1_1'));
  assert.equal(versionDataDir('nope'), null);
  assert.equal(getVersionData(DEFAULT_VERSION), getData());
  const quiet = { warn() {}, error() {}, info() {} };
  const a = getVersionData('act1autochess', { log: quiet });
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.chess));
  assert.equal(a.config.version.id, 'act1autochess');
  assert.equal(versionOfData(a), 'act1autochess');
  assert.equal(getVersionData('act1autochess'), a, 'cached');
  assert.equal(versionOfData(getVersionData('act1autochess@V1_1', { log: quiet })), 'act1autochess@V1_1');
  assert.ok(!Object.hasOwn(loadData(DATA_DIR, { log: quiet }), 'versions'));
  assert.equal(versionOfData(getData()), DEFAULT_VERSION);
  assert.throws(() => getVersionData('nope'), RangeError);
  resetVersionData();
  assert.notEqual(getVersionData('act1autochess', { log: quiet }), a, 'reloaded after resetVersionData');
  resetVersionData();
});

const VERSION_ENV = ['SP_VERSIONS', 'SP_VERSION_DEFAULT', 'SP_MAX_VERSION_HOSTS'];

/** Start a server with the version environment unset, then restore it. `extra` still wins (the `versions` option). */
async function startVersionsServer(extra = {}) {
  const saved = VERSION_ENV.map((k) => [k, process.env[k]]);
  for (const [k] of saved) delete process.env[k];
  try {
    return await startServer({ port: 0, host: '127.0.0.1', quiet: true, ...extra });
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('HTTP: a server narrowed to 第二期下半 never serves data/versions/ (any spelling); the default data is', async () => {
  const srv = await startVersionsServer({ versions: { enabled: ['act2autochess'] } });
  try {
    const get = (p) => fetch(srv.url + p, { redirect: 'manual' });
    assert.equal((await get('/data/chess.json')).status, 200);
    assert.equal(Object.hasOwn(await (await get('/healthz')).json(), 'versions'), false, '/healthz says nothing of versions');
    assert.equal(srv.versionHosts, null, 'no version match host');
    // the nested default data stays served: the client store loads its game-text overlays from /data/i18n/ (public/js/data.js)
    const langs = readdirSync(join(ROOT, 'data', 'i18n')).filter((f) => f.endsWith('.json'));
    assert.ok(langs.length >= 4, 'data/i18n/<lang>.json');
    for (const name of langs) {
      const r = await get(`/data/i18n/${name}`);
      assert.equal(r.status, 200, `/data/i18n/${name}`);
      assert.ok((await r.arrayBuffer()).byteLength > 0);
    }
    for (const v of OTHERS) {
      for (const p of [`/data/${v.dir}chess.json`, `/data/${v.dir}config.json`, `/data/${v.dir}`, `/data/${v.dir.toUpperCase()}CHESS.JSON`,
        `/data/${v.dir.replace('versions/', 'Versions/')}chess.json`, `/data/./${v.dir}chess.json`, `/data/i18n/../${v.dir}chess.json`]) {
        const r = await get(p);
        assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
        await r.arrayBuffer();
      }
    }
  } finally {
    await srv.close();
  }
});

test('HTTP: nothing set enables every version, serves their data, and forks no version host while idle', async () => {
  const srv = await startVersionsServer();
  try {
    const get = (p) => fetch(srv.url + p, { redirect: 'manual' });
    assert.deepEqual(srv.versions.ids, VERSIONS.map((v) => v.id));
    assert.equal(srv.versions.defaultId, DEFAULT_VERSION);
    assert.equal(srv.versionHosts.stats().workers, 0, 'the pool exists; no child until the first match of a version');
    assert.equal(srv.versionHosts.stats().matches, 0);
    const health = await (await get('/healthz')).json();
    assert.deepEqual(health.versions, {
      enabled: VERSIONS.map((v) => v.id), default: DEFAULT_VERSION,
      hosts: { workers: 0, matches: 0, transport: 'process' },
    });
    assert.equal((await get('/data/chess.json')).status, 200);
    for (const v of OTHERS) {
      const r = await get(`/data/${v.dir}chess.json`);
      assert.equal(r.status, 200, v.id);
      await r.arrayBuffer();
    }
  } finally {
    await srv.close();
  }
});

test('HTTP (M1, DESIGN §35.23): an enabled version\'s data is served (immutable with ?v=), a disabled one\'s is 404; its /cs/ manifest and bounds', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, studio: false,
    versions: { enabled: ['act2autochess', 'act1autochess', 'act2autochess@V2_1'] } });
  try {
    const get = (p) => fetch(srv.url + p, { redirect: 'manual' });
    for (const id of ['act1autochess', 'act2autochess@V2_1']) {
      const v = versionById(id);
      const r = await get(`/data/${v.dir}chess.json?v=12345678`);
      assert.equal(r.status, 200, id);
      assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.deepEqual(JSON.parse(Buffer.from(await r.arrayBuffer()).toString('utf8')), JSON.parse(readFileSync(join(ROOT, 'data', v.dir, 'chess.json'), 'utf8')));
      // its manifest and bounds under /cs/<cs16>/
      const cs = srv.versions.csOf(id);
      const ir = await get(`/cs/${cs.slice(0, 16)}/index.json`);
      assert.equal(ir.status, 200);
      assert.equal(ir.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      const index = await ir.json();
      assert.equal(index.cs, cs);
      assert.equal(index.version, id);
      assert.equal(index.vanilla, true);
      for (const d of Object.values(index.data)) assert.ok(d.url.startsWith(`/data/${v.dir}`), d.url);
      const br = await get(index.bounds.official.url);
      assert.equal(br.status, 200);
      assert.equal(Buffer.from(await br.arrayBuffer()).length, index.bounds.official.bytes);
      for (const d of Object.values(index.data).slice(0, 3)) {
        const dr = await get(d.url);
        assert.equal(dr.status, 200, d.url);
        assert.equal(Buffer.from(await dr.arrayBuffer()).length, d.bytes);
      }
    }
    const off = versionById('act1autochess@V1_1');
    for (const p of [`/data/${off.dir}chess.json`, `/data/${off.dir.toUpperCase()}CHESS.JSON`, `/data/./${off.dir}chess.json`, `/data/i18n/../${off.dir}chess.json`, `/data/${off.dir}`]) {
      const r = await get(p);
      assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
      await r.arrayBuffer();
    }
    assert.equal((await get('/data/versions/')).status, 404);
    // the vanilla manifest is unchanged: no version, its data under /data/
    const vr = await get(`/cs/${srv.content.cs.slice(0, 16)}/index.json`);
    const vanilla = await vr.json();
    assert.equal(Object.hasOwn(vanilla, 'version'), false);
    assert.equal(Object.hasOwn(vanilla, 'bounds'), false);
    assert.ok(Object.values(vanilla.data).every((d) => /^\/data\/[a-z]+\.json\?v=[0-9a-f]{8}$/.test(d.url)));
    assert.deepEqual(vanilla, srv.content.index);
    assert.equal((await get(`/cs/${srv.versions.csOf('act1autochess').slice(0, 16)}/data/chess.json`)).status, 404);
    // /healthz names them and their match hosts
    const health = await (await get('/healthz')).json();
    assert.deepEqual(health.versions, { enabled: ['act2autochess', 'act2autochess@V2_1', 'act1autochess'], default: 'act2autochess',
      hosts: { workers: 0, matches: 0, transport: 'process' } });
  } finally {
    await srv.close();
  }
});

test('HTTP: only the versions/ folder itself is refused — a sibling whose name starts with "versions" is served', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-versions-static-'));
  for (const sub of ['versions/act1autochess', 'versions-old', 'versionsX', 'i18n']) mkdirSync(join(dir, sub), { recursive: true });
  for (const rel of ['config.json', 'versions/act1autochess/chess.json', 'versions-old/chess.json', 'versionsX/chess.json', 'versions.json', 'i18n/en.json']) {
    writeFileSync(join(dir, rel), '{}');
  }
  const handler = createStaticHandler({ publicDir: join(ROOT, 'public'), dataDir: dir, sharedDir: join(ROOT, 'shared') });
  const srv = createServer((req, res) => { const [p, q] = req.url.split('?'); handler(req, res, p, q || ''); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const get = async (p) => {
      const r = await fetch(`http://127.0.0.1:${srv.address().port}${p}`, { redirect: 'manual' });
      await r.arrayBuffer();
      return r.status;
    };
    for (const p of ['/data/versions-old/chess.json', '/data/versionsX/chess.json', '/data/versions.json', '/data/i18n/en.json']) assert.equal(await get(p), 200, p);
    assert.equal(await get('/data/versions/act1autochess/chess.json'), 404);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------
// adapters
// ---------------------------------------------------------------------------------------------------

test('adapter bondActiveType: the three 上半 shapes become 下半\'s activeCondition; 下半 rows are left alone; unknown shapes throw', () => {
  const act = { bondInfoDict: {
    investShip: { activeType: 'ALL', isActiveInDeck: true, activeCount: 3 },
    yanShip: { activeType: 'BATTLE', isActiveInDeck: false, activeCount: 3 },
    maniShip: { activeType: 'MANI', isActiveInDeck: false, activeCount: 1 },
    soloShip: { activeType: 'BATTLE', isActiveInDeck: false, activeCount: 1, activeCondition: 'BOARD', activeConditionTemplate: 'count_threshold_downward', activeParamList: ['1', '2'], maxInactiveBondCount: -1 },
  } };
  const before = JSON.stringify(act.bondInfoDict.soloShip);
  bondActiveType(act);
  const pick = (b) => [b.activeCondition, b.activeConditionTemplate, b.activeParamList, b.maxInactiveBondCount];
  assert.deepEqual(pick(act.bondInfoDict.investShip), ['BOARD_AND_DECK', 'count_threshold_upward', ['3'], -1]);
  assert.deepEqual(pick(act.bondInfoDict.yanShip), ['BOARD', 'count_threshold_upward', ['3'], -1]);
  assert.deepEqual(pick(act.bondInfoDict.maniShip), ['BOARD', 'count_threshold_upward', ['1'], -1]);
  assert.equal(JSON.stringify(act.bondInfoDict.soloShip), before, 'a 下半 row is a no-op');
  assert.throws(() => bondActiveType({ bondInfoDict: { x: { activeType: 'ALL', isActiveInDeck: false, activeCount: 2 } } }), /unknown shape/);
  assert.throws(() => bondActiveType({ bondInfoDict: { x: { activeType: 'BATTLE', isActiveInDeck: false } } }), /unknown shape/);
});

test('adapter selfBackupPreset: a NORMAL row backing itself up becomes a PRESET with its default skill and module; others untouched', () => {
  const act = { charShopChessDatas: {
    chess_char_1_15_a: { chessType: 'NORMAL', charId: 'char_616_pithst', backupCharId: 'char_616_pithst', defaultSkillIndex: 0, defaultUniEquipId: 'uniequip_002_pithst', backupCharSkillIndex: 0, backupCharUniEquipId: null },
    chess_char_1_01_a: { chessType: 'NORMAL', charId: 'char_x', backupCharId: 'char_600_cpione', defaultSkillIndex: 0, backupCharUniEquipId: null },
    chess_char_1_02_a: { chessType: 'PRESET', charId: 'char_y', backupCharId: 'char_y', defaultSkillIndex: 1, defaultUniEquipId: 'u', backupCharSkillIndex: 1, backupCharUniEquipId: 'u' },
    chess_char_1_03_a: { chessType: 'DIY', charId: null, backupCharId: null },
  } };
  const others = JSON.stringify([act.charShopChessDatas.chess_char_1_01_a, act.charShopChessDatas.chess_char_1_02_a, act.charShopChessDatas.chess_char_1_03_a]);
  applyAdapters(act, ['selfBackupPreset']);
  const r = act.charShopChessDatas.chess_char_1_15_a;
  assert.deepEqual([r.chessType, r.backupCharSkillIndex, r.backupCharUniEquipId], ['PRESET', 0, 'uniequip_002_pithst']);
  assert.equal(JSON.stringify([act.charShopChessDatas.chess_char_1_01_a, act.charShopChessDatas.chess_char_1_02_a, act.charShopChessDatas.chess_char_1_03_a]), others);
  assert.throws(() => selfBackupPreset({ charShopChessDatas: { x: {} } }), /no chessType/);
  assert.throws(() => applyAdapters(act, ['noAbyss']), /unknown adapter/);
});

test('adapter launchModes: modes opening after the earliest one leave modeDataDict, battleDataDict and the stage lists', () => {
  const act = {
    modeDataDict: { mode_single_normal: { startTime: 100 }, mode_multi_normal: { startTime: 100 }, mode_single_abyss: { startTime: 200 } },
    battleDataDict: { mode_single_normal: { 1: [] }, mode_multi_normal: { 1: [] }, mode_single_abyss: { 1: [] } },
    stageDatasDict: { s1: { mode: ['mode_single_normal', 'mode_single_abyss'] }, s2: { mode: ['mode_single_abyss'] } },
  };
  launchModes(act);
  assert.deepEqual(Object.keys(act.modeDataDict), ['mode_single_normal', 'mode_multi_normal']);
  assert.deepEqual(Object.keys(act.battleDataDict), ['mode_single_normal', 'mode_multi_normal']);
  assert.deepEqual(act.stageDatasDict.s1.mode, ['mode_single_normal']);
  assert.deepEqual(act.stageDatasDict.s2.mode, []);
  const same = { modeDataDict: { a: { startTime: 5 }, b: { startTime: 5 } }, battleDataDict: { a: {}, b: {} }, stageDatasDict: {} };
  launchModes(same);
  assert.deepEqual(Object.keys(same.modeDataDict), ['a', 'b'], 'one launch time: nothing dropped');
  assert.throws(() => launchModes({ modeDataDict: { a: {} }, battleDataDict: {}, stageDatasDict: {} }), /no startTime/);
});

test('adapter launchMilestones: 功勋 levels opening after the earliest one leave milestoneList', () => {
  const lv = (n, t) => ({ milestoneId: `m${n}`, milestoneLvl: n, tokenNum: n * 100, availableTime: t });
  const act = { milestoneList: [lv(1, 100), lv(2, 100), lv(3, 200), lv(4, 200)] };
  launchMilestones(act);
  assert.deepEqual(act.milestoneList.map((m) => m.milestoneLvl), [1, 2]);
  const dict = { milestoneList: { a: lv(1, 100), b: lv(2, 300) } };
  launchMilestones(dict);
  assert.deepEqual(Object.keys(dict.milestoneList), ['a'], 'a keyed list too');
  const same = { milestoneList: [lv(1, 5), lv(2, 5)] };
  launchMilestones(same);
  assert.equal(same.milestoneList.length, 2, 'one opening time: nothing dropped');
  assert.throws(() => launchMilestones({ milestoneList: [{ milestoneLvl: 1 }] }), /no availableTime/);
  assert.throws(() => launchMilestones({ milestoneList: [] }), /no levels/);
});

// ---------------------------------------------------------------------------------------------------
// the pools by effectId / charId
// ---------------------------------------------------------------------------------------------------

test('pools: resolving by the normal item\'s effectId and the operator\'s charId gives today\'s data/choices.json ids', () => {
  const items = readJson(join(ROOT, 'data'), 'items');
  const chess = readJson(join(ROOT, 'data'), 'chess');
  const pools = readJson(join(ROOT, 'data'), 'choices').pools;
  const src = readFileSync(BUILD, 'utf8');
  const equip = Object.values(items).filter((i) => i.itemType === 'EQUIP' && !i.isGolden);
  const byEffect = (e) => { assert.ok(src.includes(`'${e}'`), `tools/build-data.mjs names ${e}`); return equip.find((i) => i.effectId === e)?.id ?? null; };
  const byChar = (c) => {
    assert.ok(src.includes(`'${c}'`), `tools/build-data.mjs names ${c}`);
    return Object.values(chess).find((x) => !x.isGolden && x.visible && x.charId === c)?.chessId
      ?? Object.values(chess).find((x) => !x.isGolden && x.charId === c)?.chessId ?? null;
  };
  assert.deepEqual(pools.pool_equip_kathe.also, ['eff_acarm072'].map(byEffect));
  assert.deepEqual(pools.pool_equip_vict.items, ['eff_acarm042', 'eff_acarm043', 'eff_acarm044', 'eff_acarm045'].map(byEffect));
  assert.deepEqual(pools.pool_equip_pepe.weighted, [['eff_acarm066', 45], ['eff_acarm050', 45], ['eff_acarm103', 10]].map(([e, w]) => [byEffect(e), w]));
  assert.deepEqual(pools.pool_equip_rockr.weighted, [['eff_acarm041', 10], ['eff_acarm045', 2], ['eff_acarm043', 2], ['eff_acarm044', 2], ['eff_acarm042', 2],
    ['eff_acarm052', 1], ['eff_acarm061', 4], ['eff_acarm053', 4]].map(([e, w]) => [byEffect(e), w]));
  assert.deepEqual(pools.pool_chess_glady.items, ['char_263_skadi', 'char_143_ghost', 'char_4137_udflow'].map(byChar));
  assert.deepEqual(pools.pool_char_pinus.weighted, [['char_496_wildmn', 10], ['char_431_ashlok', 10], ['char_430_fartth', 3]].map(([c, w]) => [byChar(c), w]));
  // the shop-excluded items are the same five, keyed by effectId
  assert.deepEqual(equip.filter((i) => i.shopExcluded).map((i) => i.effectId).sort(), ['eff_acarm042', 'eff_acarm043', 'eff_acarm044', 'eff_acarm045', 'eff_acarm072']);
});

test('pools: 歌蕾蒂娅\'s pool_chess_glady holds the three operators her garrison_39 names in each version (第一期: 安哲拉, not 深巡)', () => {
  const want = { '': '斯卡蒂 幽灵鲨 深巡', 'versions/act2autochess-v2_1': '斯卡蒂 幽灵鲨 深巡', 'versions/act1autochess': '斯卡蒂 幽灵鲨 安哲拉', 'versions/act1autochess-v1_1': '斯卡蒂 幽灵鲨 安哲拉' };
  for (const [dir, names] of Object.entries(want)) {
    const d = join(ROOT, 'data', dir);
    const chess = readJson(d, 'chess');
    const got = readJson(d, 'choices').pools.pool_chess_glady.items.map((id) => chess[id]?.name);
    assert.deepEqual(got, names.split(' '), dir || 'data/');
    for (const g of ['garrison_39_a', 'garrison_39_b']) {
      const desc = readJson(d, 'garrisons')[g].desc;
      for (const n of got) assert.ok(desc.includes(n), `${dir || 'data/'} ${g} names ${n}: ${desc}`);
    }
  }
});
