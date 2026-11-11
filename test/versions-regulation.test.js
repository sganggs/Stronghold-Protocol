// 规程 (act3autochess) as an official version: the mirror normalisation (tools/versions/sources.mjs), the level layout
// (tools/versions/layouts.mjs) and the built data/versions/act3autochess-v3_1/stages.json against 盟约's cells.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeMirror, sourceOfProfile, SOURCES } from '../tools/versions/sources.mjs';
import { composeRegulationStage, placeRegulationTemplate, TEMPLATE_OFFSETS } from '../tools/versions/layouts.mjs';
import { loadProfile, pinnedShaOf } from '../tools/versions/profiles.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), 'utf8'));

test('normalizeMirror: an empty {} becomes [] / null / stays {} by the key, its table siblings and the reference', () => {
  const mirror = {
    table: { a: { list: [1], dict: { k: 1 } }, b: { list: {}, dict: {} } },              // the key elsewhere decides
    effectBuffInfoDataDict: { e1: [{ key: 'x' }], e2: [{ key: 'y' }], e3: {} },           // an id table: siblings decide
    effectInfoDataDict: { e3: { name: 'n' } },                                           // the same id, an object here
    level: { runes: {}, checkpoints: {} },                                               // the reference decides
    holder: { someDict: {}, n: 1 },                                                       // a …Dict name stays an object
    mixed: { a: [1], b: { k: 1 }, mystery: {} },                                         // nothing decides
  };
  const ref = { level: { runes: null, checkpoints: [] } };
  const { obj, unresolved } = normalizeMirror('excel/activity_table.json', mirror, [ref]);
  assert.deepEqual(obj.table.b, { list: [], dict: {} });
  assert.deepEqual(obj.effectBuffInfoDataDict.e3, []);
  assert.deepEqual(obj.effectInfoDataDict.e3, { name: 'n' });
  assert.equal(obj.level.runes, null);
  assert.deepEqual(obj.level.checkpoints, []);
  assert.deepEqual(obj.holder.someDict, {});
  assert.deepEqual(obj.mixed.mystery, {});
  assert.deepEqual(unresolved, ['mixed.mystery']);
});

test('normalizeMirror: the mirror\'s enemy_database { id: levels } becomes { enemies: [{ Key, Value }] }', () => {
  const { obj } = normalizeMirror('levels/enemydata/enemy_database.json', { enemy_1: [{ level: 0, enemyData: {} }] });
  assert.deepEqual(obj, { enemies: [{ Key: 'enemy_1', Value: [{ level: 0, enemyData: {} }] }] });
});

test('the 规程 profile reads Kengxxiao (6f63c14e, CN data 79.2.0) with the regulation layout; the ArknightsAssets mirror stays available', async () => {
  const { profile } = await loadProfile('act3autochess@V3_1');
  assert.deepEqual(profile.section, ['AUTOCHESS', 'act3autochess', 'V3_1']);
  assert.equal(profile.layout, 'regulation');
  assert.equal(sourceOfProfile(profile).mirror, false);
  assert.equal(pinnedShaOf(profile, 'excel/activity_table.json'), '6f63c14e27b847ef74b53b00fe51fc322b3cd7ff');
  assert.equal(sourceOfProfile((await loadProfile('act2autochess')).profile).mirror, false);
  // the mirror a profile may still name (`source: 'arknightsassets'`) when Kengxxiao lags behind a new season
  const aa = sourceOfProfile({ source: 'arknightsassets' });
  assert.equal(aa, SOURCES.arknightsassets);
  assert.equal(aa.mirror, true);
  assert.equal(aa.cacheTag('abc'), 'aa-abc');
  assert.match(aa.url('abc'), /ArknightsAssets\/ArknightsGamedata\/abc\/cn\/gamedata\/$/);
});

/** A level of the given rows (top first, one char per cell) with one tile per char. */
function levelOf(rows, extra = {}) {
  const keys = { x: 'tile_forbidden', '=': 'tile_road', S: 'tile_start', E: 'tile_end' };
  const chars = [...new Set(rows.join(''))];
  const tiles = chars.map((c) => ({ tileKey: keys[c] ?? 'tile_floor', passableMask: c === 'x' ? 'FLY_ONLY' : 'ALL', blackboard: [] }));
  return { levelId: 'test', mapData: { map: rows.map((r) => [...r].map((c) => chars.indexOf(c))), tiles }, ...extra };
}
const glyphAt = (lv, r, c) => lv.mapData.tiles[lv.mapData.map[lv.mapData.map.length - 1 - r][c]].tileKey;

test('placeRegulationTemplate: a 5×9 normal round lands on the left road half (rows 9–12, cols 2–10) with its routes', () => {
  const lv = levelOf(['xxxxxxxxx', 'x=======S', 'x=======x', 'x=======x', 'E=======S'],
    { routes: [{ startPosition: { row: 0, col: 8 }, endPosition: { row: 0, col: 0 }, checkpoints: [{ position: { row: 3, col: 8 } }] }] });
  const out = placeRegulationTemplate(lv);
  assert.equal(out.mapData.map.length, 19);
  assert.equal(out.mapData.map[0].length, 21);
  assert.equal(glyphAt(out, 9, 2), 'tile_end');
  assert.equal(glyphAt(out, 9, 10), 'tile_start');
  assert.equal(glyphAt(out, 12, 10), 'tile_start');
  assert.deepEqual(out.routes[0].startPosition, { row: 9, col: 10 });
  assert.deepEqual(out.routes[0].endPosition, { row: 9, col: 2 });
  assert.deepEqual(out.routes[0].checkpoints[0].position, { row: 12, col: 10 });
  assert.deepEqual(lv.routes[0].startPosition, { row: 0, col: 8 }, 'the input is not changed');
  assert.deepEqual(Object.keys(TEMPLATE_OFFSETS).sort(), ['5x17', '5x9', '6x17']);
  assert.throws(() => placeRegulationTemplate(levelOf(['xx', 'xx'])), /no known place/);
});

// the 盟约 cells every 规程 stage must keep: gates S, objectives E, teleport exits O, hand slots a, temp/equipment slots A
const KEY_GLYPHS = ['S', 'E', 'O', 'a', 'A'];
const cellsOf = (rows, g) => rows.flatMap((line, r) => [...line].map((x, c) => (x === g ? `${r},${c}` : null)).filter(Boolean)).sort();

test('data/versions/act3autochess-v3_1: every stage keeps 盟约\'s gates, objectives, exits, hand and temp rows', () => {
  const dir = join(ROOT, 'data', 'versions', 'act3autochess-v3_1');
  if (!existsSync(join(dir, 'stages.json'))) return;
  const ours = readJson('data', 'versions', 'act3autochess-v3_1', 'stages.json');
  const covenant = readJson('data', 'stages.json').act2autochess_m01.rows;
  const stages = Object.entries(ours).filter(([id]) => !id.includes('escaped'));
  assert.equal(stages.length, 10);
  for (const [id, s] of stages) {
    assert.deepEqual(s.size, [19, 21], id);
    for (const g of KEY_GLYPHS) assert.deepEqual(cellsOf(s.rows, g), cellsOf(covenant, g), `${id} ${g}`);
    // 盟约's own board has a teleport entrance at (8,11) for nothing a 规程 field has; the boss field's two match
    assert.deepEqual(cellsOf(s.rows, 'I'), cellsOf(covenant, 'I').filter((p) => p !== '8,11'), `${id} I`);
  }
});

test('composeRegulationStage: the cached 战场 m01 pieces give the built rows (skipped without the gamedata cache)', async () => {
  const { profile } = await loadProfile('act3autochess@V3_1');
  const base = join(ROOT, '.cache', `gamedata@${sourceOfProfile(profile).cacheTag(profile.pins.default)}`, 'levels', 'activities', 'act3autochess');
  if (!existsSync(join(base, 'level_act3autochess_m01', 'level_act3autochess_m01_sub_01.json'))) return;
  const read = (f) => JSON.parse(readFileSync(join(base, f), 'utf8'));
  const pieces = [1, 2, 3].map((n) => read(`level_act3autochess_m01/level_act3autochess_m01_sub_0${n}.json`));
  const out = composeRegulationStage(read('level_act3autochess_m01.json'), pieces);
  assert.equal(out.mapData.map.length, 19);
  assert.equal(glyphAt(out, 9, 2), 'tile_end');
  assert.equal(glyphAt(out, 7, 0), 'tile_achand');
  assert.ok(out.mapData.tiles[out.mapData.map[18 - 7][0]].blackboard.some((b) => b.key === 'isValidHand'), 'hand row marked');
  assert.equal(glyphAt(out, 8, 4), 'tile_acbag', 'the equipment row where 盟约 has its temp row');
  assert.throws(() => composeRegulationStage(read('level_act3autochess_m01.json'), [pieces[1], pieces[0], pieces[2]]), /sub_01 is 6x21/);
});

test('data/versions/act3autochess-v3_1: regulation bond rule and editable add-on counts (owner 2026-11-09; 终极 5 add-ons from the 11-10 recording)', () => {
  const dir = join(ROOT, 'data', 'versions', 'act3autochess-v3_1');
  if (!existsSync(join(dir, 'config.json'))) return;
  const { bans, version } = readJson('data', 'versions', 'act3autochess-v3_1', 'config.json');
  assert.equal(version.rules.bondDraw, 'regulation');
  for (const d of ['NORMAL', 'HARD', 'ABYSS']) assert.deepEqual(bans[d], { core: 0, addon: 5 }, d);
  for (const d of ['FUNNY', 'FAST']) assert.deepEqual(bans[d], { core: 0, addon: 2 }, d);
  assert.deepEqual(bans.TRAINING, { core: 0, addon: 0 });
  assert.deepEqual(readJson('data', 'config.json').bans.ABYSS, { core: 3, addon: 4 }, '盟约 keeps its draw');
});
