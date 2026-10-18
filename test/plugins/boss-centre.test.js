import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, getData } from '../../server/data.js';
import { fixture } from '../helpers/contentFixtures.js';
import { readPluginFolder } from '../../server/plugins/registry.js';
import { checkPluginFolder } from '../../server/plugins/pack.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { bossCentreWarnings } from '../../server/plugins/stageWarnings.js';
import { describeIssue } from '../../shared/plugins/errors.js';

const CODE = 'PLUGIN_BOSS_CENTRE_DEPLOYABLE';
const stageId = 'stage_x_centre_map', modeId = 'mode_x_centre_coop';
// Synthetic terrain only; no official level bytes in fixtures.
const stage = () => ({
  id: stageId, name: 'Synthetic centre', rows: Array.from({ length: 19 }, (_, r) => r === 2 || r === 4 ? `${'#'.repeat(10)}${r === 2 ? 'r' : 'h'}${'#'.repeat(10)}` : '#'.repeat(21)),
  tiles: {
    '#': { tileKey: 'tile_forbidden', height: 'HIGH', buildable: 'NONE', groundPassable: false, flyPassable: true },
    r: { tileKey: 'tile_road', height: 'LOW', buildable: 'ALL', groundPassable: true, flyPassable: true },
    h: { tileKey: 'tile_wall', height: 'HIGH', buildable: 'RANGED', groundPassable: false, flyPassable: true },
  },
});
const mode = () => ({ modeId, type: 'MULTI', stages: [stageId], rounds: { 14: { isBoss: true } } });
const data = (m = mode(), s = stage()) => ({ config: { modes: { [modeId]: m } }, stages: { [stageId]: s } });

test('every official battle stage has no deployable boss centre (including the three inactive maps)', () => {
  const official = getData();
  const stages = Object.values(official.stages).filter(s => s.kind !== 'unite');
  assert.equal(stages.length, 11);
  for (const s of stages) {
    assert.deepEqual(bossCentreWarnings({ stages: { [s.id]: s }, config: { modes: { coop: { ...mode(), stages: [s.id] } } } }), [], s.id);
    for (let r = 1; r <= 5; r++) assert.equal(s.tiles[s.rows[r][10]].buildable, 'NONE', `${s.id} row ${r}`);
  }
});

test('warning names stage and all centre rows in zh/en; solo, unused and normal-only maps do not warn', () => {
  const original = data(), before = structuredClone(original);
  const [issue] = bossCentreWarnings(original);
  assert.equal(issue.code, CODE);
  assert.equal(issue.level, 'warning');
  assert.deepEqual(issue.params, { stage: `Synthetic centre (${stageId})`, rows: '2, 4' });
  for (const lang of ['zh', 'en']) {
    const text = describeIssue(issue, lang).message;
    assert.match(text, /Synthetic centre/); assert.match(text, /2, 4/); assert.doesNotMatch(text, /\{\w+\}/);
  }
  assert.deepEqual(original, before, 'diagnostics never change stage data');
  for (const m of [{ ...mode(), type: 'SINGLE' }, { ...mode(), stages: [] }, { ...mode(), rounds: { 1: { isBoss: false } } }]) assert.deepEqual(bossCentreWarnings(data(m)), []);
  assert.equal(bossCentreWarnings(data({ ...mode(), rounds: { 15: { isHidden: true } } })).length, 1);
});

test('MELEE centre tiles and active deployment platforms warn; adjacent tiles and boss benches do not', () => {
  const s = stage(); s.tiles.r.buildable = 'MELEE';
  assert.equal(bossCentreWarnings(data(mode(), s)).length, 1);
  s.rows[2] = '#'.repeat(21); s.rows[4] = '#'.repeat(21);
  s.rows[0] = `${'#'.repeat(10)}r${'#'.repeat(10)}`;
  s.rows[3] = `${'#'.repeat(9)}r#r${'#'.repeat(9)}`;
  assert.deepEqual(bossCentreWarnings(data(mode(), s)), []);
  for (const role of ['platform', 'waterPlatform']) {
    s.devices = [{ active: true, role, pos: [3, 10] }];
    assert.equal(bossCentreWarnings(data(mode(), s))[0].params.rows, '3');
    s.devices[0].active = false;
    assert.deepEqual(bossCentreWarnings(data(mode(), s)), []);
  }
});

for (const format of ['parts', 'records', 'patches']) test(`${format}: registry, CLI/studio check and composed data warn without refusing or changing deployment`, t => {
  const f = fixture(t);
  const stageRec = { id: stageId, value: stage() };
  const modeRec = { id: modeId, base: 'mode_multi_normal', set: { stages: [stageId] } };
  let parts, files;
  if (format === 'parts') {
    parts = { stages: 'stages.json', modes: 'modes.json' };
    files = { 'stages.json': stageRec, 'modes.json': modeRec };
  } else {
    parts = { data: 'data.json' };
    files = { 'data.json': format === 'records'
      ? { records: 1, entries: [{ ...stageRec, file: 'stages' }, { ...modeRec, file: 'modes' }] }
      : { patch: 1, ops: [{ op: 'add', file: 'stages', id: stageId, value: stage() },
        { op: 'add', file: 'config', path: ['modes'], id: modeId, value: { ...getData().config.modes.mode_multi_normal, modeId, stages: [stageId] } }] } };
  }
  const dir = f.put('centre', { ...parts, permissions: ['data.add'] }, files);
  assert.equal(f.registry.report().warnings.filter(w => w.issue.code === CODE).length, 1);
  const read = readPluginFolder(dir);
  assert.deepEqual(read.problems, []); assert.ok(read.plugin);
  assert.equal(read.issues.filter(i => i.code === CODE).length, 1);
  // The studio's validation uses this exact function, without a listener or browser.
  const check = checkPluginFolder(dir, 'plugins/centre/');
  assert.deepEqual(check.problems, []); assert.ok(check.plugin);
  assert.equal(check.issues.filter(i => i.code === CODE).length, 1);
  const set = buildContentSet({ registry: f.registry, ids: ['centre'] });
  assert.deepEqual(set.problems, []); assert.ok(set.cs);
  assert.equal(set.warnings.filter(i => i.code === CODE).length, 1);
  for (const half of ['bossLeft', 'bossRight']) assert.ok(set.data.stages[stageId].deployTiles[half].melee.some(([r, c]) => r === 2 && c === 10));
  assert.equal(set.data.stages[stageId].tiles.r.buildable, 'ALL');
  for (const lang of ['zh', 'en']) {
    const args = [path.join(ROOT, 'tools/plugin.mjs'), 'check', dir, '--lang', lang, '--json'];
    const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.problems, 0); assert.equal(report.warnings, 1);
    assert.equal(report.folders[0].issues[0].code, CODE);
    const strict = spawnSync(process.execPath, [...args, '--strict'], { encoding: 'utf8' });
    assert.equal(strict.status, 1, strict.stdout + strict.stderr);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, format === 'parts' ? 'stages.json' : 'data.json'))), files[format === 'parts' ? 'stages.json' : 'data.json']);
});

test('a data patch changing an existing official boss lane also warns', t => {
  const f = fixture(t);
  const dir = f.put('centre', { data: 'patch.json', permissions: ['data.patch'] }, { 'patch.json': { patch: 1, ops: [
    { op: 'set', file: 'stages', id: 'act1autochess_m01', path: ['tiles', 'O', 'buildable'], value: 'ALL' },
  ] } });
  const issue = checkPluginFolder(dir).issues.find(i => i.code === CODE);
  assert.ok(issue); assert.equal(issue.params.rows, '2, 5');
});

test('full composition checks a mode using a dependency-provided stage', t => {
  const f = fixture(t), id = 'stage_x_terrain_map';
  f.put('terrain', { stages: 'map.json', permissions: ['data.add'] }, { 'map.json': { id, value: { ...stage(), id } } });
  f.put('centre', { modes: 'mode.json', permissions: ['data.add'], requires: { terrain: '*' } }, {
    'mode.json': { id: modeId, base: 'mode_multi_normal', set: { stages: [id] } },
  });
  const set = buildContentSet({ registry: f.registry, ids: ['centre'] });
  assert.deepEqual(set.problems, []);
  const issue = set.warnings.find(i => i.code === CODE);
  assert.ok(issue); assert.match(issue.params.stage, /stage_x_terrain_map/);
});

test('folder checks use defaults; full composition warns when selected settings enable the centre', t => {
  const f = fixture(t);
  const dir = f.put('centre', { data: 'patch.json', permissions: ['data.patch'],
    settings: { build: { type: 'enum', options: ['NONE', 'ALL'], default: 'NONE' } },
  }, { 'patch.json': { patch: 1, ops: [
    { op: 'set', file: 'stages', id: 'act1autochess_m01', path: ['tiles', 'O', 'buildable'], value: { $setting: 'build' } },
  ] } });
  assert.deepEqual(checkPluginFolder(dir).issues.filter(i => i.code === CODE), []);
  assert.deepEqual(buildContentSet({ registry: f.registry, ids: ['centre'] }).warnings, []);
  const set = buildContentSet({ registry: f.registry, ids: [{ id: 'centre', settings: { build: 'ALL' } }] });
  assert.deepEqual(set.problems, []);
  assert.equal(set.warnings.find(i => i.code === CODE).params.rows, '2, 5');
});
