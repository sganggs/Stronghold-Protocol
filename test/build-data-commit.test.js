// build-data --gamedata-commit <sha> (GitHub #567, DESIGN §37.323): every official file of a run from one full commit of
// Kengxxiao/ArknightsGameData, in its own cache directory <cache>@<sha>/, --offline naming every missing file, and the
// build report recording the commit of each file. No network: a preloaded fake fetch or a fixture cache stands in for
// GitHub; the two full builds read the real pinned cache and skip without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import defaultProfile from '../tools/versions/act2autochess.mjs';
import regulationProfile from '../tools/versions/act3autochess-v3_1.mjs';
import { commitShaError, originOf, pinKeyOf, pinnedShaOf } from '../tools/versions/profiles.mjs';
import { hasDefaultGamedata } from './helpers/defaultGamedata.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'tools', 'build-data.mjs');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const BASE = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/';
/** The eight tables every build reads first, in the order build-data asks for them. */
const TABLES = ['excel/activity_table.json', 'excel/character_table.json', 'excel/skill_table.json', 'excel/range_table.json',
  'excel/uniequip_table.json', 'excel/battle_equip_table.json', 'excel/enemy_handbook_table.json', 'levels/enemydata/enemy_database.json'];
/** The level files the fixture activity table names (a battle template, a stage, the season's enemy override level). */
const LEVELS = ['levels/activities/act2autochess/level_act2autochess_m01.json', 'levels/activities/act2autochess/level_act2autochess_t01.json',
  'levels/activities/act1autochess/level_autochess_enemy_data.json'];
/** A minimal 盟约 activity table: enough for build-data to list the level files it reads, nothing to build from. */
const ACTIVITY = {
  activity: { AUTOCHESS_SEASON: { act2autochess: {
    battleDataDict: { mode_x: { 1: [{ levelId: 'Activities/ACT2AUTOCHESS/level_act2autochess_t01' }] } },
    constData: {}, stageDatasDict: { act2autochess_m01: {} }, charShopChessDatas: {},
  } } },
  autoChessData: { constData: { enemyDataLevelId: 'Activities/ACT1AUTOCHESS/level_autochess_enemy_data' } },
};
/** The 规程 shape: its section path, one stage (an atlas of three pieces) and one road-only template. */
const REGULATION_ACTIVITY = {
  activity: { AUTOCHESS: { act3autochess: { V3_1: {
    battleDataDict: { mode_x: { 1: [{ levelId: 'Activities/ACT3AUTOCHESS/level_act3autochess_t01' }] } },
    constData: {}, stageDatasDict: { act3autochess_m01: {} }, charShopChessDatas: {},
  } } } },
  autoChessData: { constData: {} },
};

const run = (args, opts = {}) => spawnSync(process.execPath, [...(opts.preload ? ['--import', pathToFileURL(opts.preload).href] : []), BUILD, ...args],
  { encoding: 'utf8', timeout: opts.timeout ?? 60_000 });

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-gamedata-commit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, cache: join(dir, 'cache'), out: join(dir, 'out'), report: join(dir, 'report.json') };
}

function put(dir, rel, value) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), typeof value === 'string' ? value : JSON.stringify(value));
}

/** A fake fetch, preloaded into the build: logs every URL, serves the fixture activity table and {} for the rest. */
function fakeFetch(dir, activity = ACTIVITY) {
  const log = join(dir, 'requests.txt');
  const preload = join(dir, 'fake-fetch.mjs');
  writeFileSync(preload, `
    import { appendFileSync } from 'node:fs';
    globalThis.fetch = async (url) => {
      appendFileSync(${JSON.stringify(log)}, url + '\\n');
      return new Response(url.endsWith('/excel/activity_table.json') ? ${JSON.stringify(JSON.stringify(activity))} : '{}');
    };
  `);
  const requests = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  return { preload, requests, reset: () => rmSync(log, { force: true }) };
}

/** Every file under a directory, relative to it, sorted. */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1).split('\\').join('/')).sort();
}

// ---------------------------------------------------------------------------------------------------
// option parsing
// ---------------------------------------------------------------------------------------------------

test('commitShaError: only a full 40-hex SHA passes; branches, tags and short SHAs are refused with the reason', () => {
  assert.equal(commitShaError(SHA), null);
  assert.equal(commitShaError(SHA.toUpperCase()), null, 'case-insensitive (build-data stores it in lower case)');
  assert.match(commitShaError('17759cc8'), /short SHA \(8 characters\) is refused.*keyed by it/);
  assert.match(commitShaError(`${SHA}0`), /41 hex characters: a full commit SHA has 40/);
  for (const v of ['master', 'main', 'v2.7.81', 'HEAD', `${SHA.slice(0, 39)}g`, '']) {
    assert.match(commitShaError(v), /branch or tag name is refused.*keyed by the commit/, v);
  }
});

test('build CLI: --gamedata-commit without a full SHA exits 2 with the reason and the usage, and writes nothing', (t) => {
  const { dir, cache, out, report } = scratch(t);
  const cases = [
    [['--gamedata-commit'], /needs a full commit SHA/],
    [['--gamedata-commit', '--offline'], /needs a full commit SHA/],
    [['--gamedata-commit='], /needs a full commit SHA/],
    [['--gamedata-commit', 'master'], /--gamedata-commit master: not a full commit SHA .*branch or tag name is refused/],
    [['--gamedata-commit=17759cc8'], /--gamedata-commit 17759cc8: a short SHA \(8 characters\) is refused/],
    [['--gamedata-commit', `${SHA}0`], /41 hex characters/],
  ];
  for (const [args, reason] of cases) {
    const r = run([...args, '--cache', cache, '--out', out, '--report', report], { timeout: 30_000 });
    assert.equal(r.status, 2, `${args.join(' ')}: exit ${r.status} ${r.stderr}`);
    assert.match(r.stderr, reason, args.join(' '));
    assert.match(r.stderr, /usage: .*\[--gamedata-commit <sha>\]/);
  }
  assert.deepEqual(readdirSync(dir), [], 'no cache, output or report');
});

// ---------------------------------------------------------------------------------------------------
// cache directory and download URL
// ---------------------------------------------------------------------------------------------------

test('originOf / pinKeyOf: the option wins over every pin and mirror source; without it the pins (or master) as before', () => {
  for (const rel of [...TABLES, ...LEVELS]) {
    assert.deepEqual(originOf(defaultProfile, rel, SHA), { commit: SHA, from: 'option', pin: null, source: 'kengxxiao' }, rel);
    const o = originOf(defaultProfile, rel);
    assert.deepEqual(o, { commit: pinnedShaOf(defaultProfile, rel), from: 'pin', pin: pinKeyOf(defaultProfile, rel), source: 'kengxxiao' }, rel);
  }
  assert.equal(pinKeyOf(defaultProfile, 'excel/character_table.json'), 'character');
  assert.equal(pinKeyOf(defaultProfile, 'excel/activity_table.json'), 'default');
  const mirror = { pins: { default: 'b1031d1035e8df3042f601e33d5c1dfab8345d59' }, source: 'arknightsassets' };
  assert.deepEqual(originOf(mirror, 'excel/activity_table.json'), { commit: mirror.pins.default, from: 'pin', pin: 'default', source: 'arknightsassets' });
  assert.deepEqual(originOf(mirror, 'excel/activity_table.json', SHA), { commit: SHA, from: 'option', pin: null, source: 'kengxxiao' });
  assert.deepEqual(originOf({ pins: null }, 'excel/activity_table.json'), { commit: null, from: 'master', pin: null, source: 'kengxxiao' });
  assert.equal(pinKeyOf({ pins: null }, 'excel/activity_table.json'), null);
});

test('--gamedata-commit downloads every file from that commit into <cache>@<sha>/ only; a rerun reads the cache, --refresh downloads again', (t) => {
  const { cache, out, report, dir } = scratch(t);
  const fetch = fakeFetch(dir);
  const args = ['--gamedata-commit', SHA.toUpperCase(), '--cache', cache, '--out', out, '--report', report];
  const r = run(args, { preload: fetch.preload });
  // the fixture has nothing to build from, so the build fails after loading: every official file was read by then
  assert.match(r.stdout, /building…/, r.stderr);
  assert.notEqual(r.status, 0);
  const expected = [...TABLES, ...LEVELS].sort();
  assert.deepEqual(fetch.requests().map((u) => u.slice(`${BASE}${SHA}/zh_CN/gamedata/`.length)).sort(), expected);
  assert.ok(fetch.requests().every((u) => u.startsWith(`${BASE}${SHA}/zh_CN/gamedata/`)), 'the lower-cased commit, never master or a pin');
  assert.deepEqual(readdirSync(dir).filter((n) => n.startsWith('cache')), [`cache@${SHA}`], 'not <cache>/ (master) nor <cache>@<pin>/');
  assert.deepEqual(filesUnder(`${cache}@${SHA}`), expected);
  assert.match(r.stdout, new RegExp(`note: --gamedata-commit ${SHA} replaces the pins of tools/versions/act2autochess\\.mjs \\(default 17759cc8, character 08ba2aea\\)`));

  fetch.reset();
  assert.match(run(args, { preload: fetch.preload }).stdout, /building…/);
  assert.deepEqual(fetch.requests(), [], 'cached files are not downloaded again');
  fetch.reset();
  assert.match(run([...args, '--offline'], { preload: fetch.preload }).stdout, /building…/);
  assert.deepEqual(fetch.requests(), [], 'offline: nothing missing, nothing downloaded');
  fetch.reset();
  assert.match(run([...args, '--refresh'], { preload: fetch.preload }).stdout, /building…/);
  assert.equal(fetch.requests().length, expected.length, '--refresh downloads every file of the commit again');
});

// ---------------------------------------------------------------------------------------------------
// --offline: every missing file at once
// ---------------------------------------------------------------------------------------------------

test('--gamedata-commit --offline names every missing file of the commit, never falling back to master or a pin', (t) => {
  const { cache, out, report, dir } = scratch(t);
  const fetch = fakeFetch(dir);
  // the files a build without the option would read: master and the default profile's pinned directories
  for (const rel of [...TABLES, ...LEVELS]) {
    put(cache, rel, rel === TABLES[0] ? ACTIVITY : {});
    put(`${cache}@${pinnedShaOf(defaultProfile, rel)}`, rel, rel === TABLES[0] ? ACTIVITY : {});
  }
  const args = ['--gamedata-commit', SHA, '--offline', '--cache', cache, '--out', out, '--report', report];
  let r = run(args, { preload: fetch.preload });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, [
    `build-data failed: missing cached files for --gamedata-commit ${SHA} (offline mode): 8 file(s) not in ${cache}@${SHA}/`,
    ...TABLES.map((rel) => `  ${rel}`),
    '  (and the level files excel/activity_table.json names, which cannot be listed until it is cached)',
    'run once without --offline to download them', '',
  ].join('\n'), 'all eight tables, no stack trace');

  // with the activity table cached, the level files it names are listed too, in the order the build reads them
  put(`${cache}@${SHA}`, TABLES[0], ACTIVITY);
  put(`${cache}@${SHA}`, TABLES[3], {});
  r = run(args, { preload: fetch.preload });
  assert.equal(r.status, 1);
  const missing = [...TABLES.filter((x) => x !== TABLES[0] && x !== TABLES[3]), 'levels/activities/act2autochess/level_act2autochess_m01.json',
    'levels/activities/act2autochess/level_act2autochess_t01.json', 'levels/activities/act1autochess/level_autochess_enemy_data.json'];
  assert.match(r.stderr, new RegExp(`: ${missing.length} file\\(s\\) not in `));
  assert.deepEqual(r.stderr.split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim()), missing);
  assert.doesNotMatch(r.stderr, /cannot be listed/);
  assert.doesNotMatch(r.stdout, /building…/, 'stops before building');
  assert.deepEqual(fetch.requests(), [], 'offline: no request');
  assert.ok(!existsSync(out) && !existsSync(report), 'no output, no report');
});

test('--version act3autochess@V3_1 --gamedata-commit --offline lists the 规程 stage pieces too (the option replaces the 规程 pin)', (t) => {
  const { cache, out, report } = scratch(t);
  put(`${cache}@${SHA}`, TABLES[0], REGULATION_ACTIVITY);
  for (const rel of TABLES.slice(1)) put(`${cache}@${SHA}`, rel, {});
  put(`${cache}@${regulationProfile.pins.default}`, 'levels/activities/act3autochess/level_act3autochess_m01.json', {});
  const r = run(['--version', 'act3autochess@V3_1', '--gamedata-commit', SHA, '--offline', '--cache', cache, '--out', out, '--report', report]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, new RegExp(`note: --gamedata-commit ${SHA} replaces the pins of tools/versions/act3autochess-v3_1\\.mjs \\(default 6f63c14e\\)`));
  assert.deepEqual(r.stderr.split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim()), [
    'levels/activities/act3autochess/level_act3autochess_m01.json',
    'levels/activities/act3autochess/level_act3autochess_t01.json',
    'levels/activities/act3autochess/level_act3autochess_m01/level_act3autochess_m01_sub_01.json',
    'levels/activities/act3autochess/level_act3autochess_m01/level_act3autochess_m01_sub_02.json',
    'levels/activities/act3autochess/level_act3autochess_m01/level_act3autochess_m01_sub_03.json',
  ]);
});

// ---------------------------------------------------------------------------------------------------
// full builds from the real cache: the report fields, the version profile, the default unchanged
// ---------------------------------------------------------------------------------------------------

const REAL_CACHE = join(ROOT, '.cache', 'gamedata');
const BUILT = ['backups', 'bands', 'bonds', 'bosses', 'chess', 'choices', 'config', 'effects', 'enemies', 'factions', 'garrisons',
  'items', 'stages', 'tokens', 'waves'];
const regulationCached = existsSync(join(`${REAL_CACHE}@${regulationProfile.pins.default}`, 'excel', 'activity_table.json'));

test('without the option the default build is unchanged and its report records each file\'s profile pin', { skip: (!hasDefaultGamedata(...TABLES) && 'pinned official data not cached') || (process.env.DATA_DIR && 'DATA_DIR set') }, (t) => {
  const { out, report } = scratch(t);
  const r = run(['--offline', '--out', out, '--report', report], { timeout: 180_000 });
  if (r.status !== 0 && /missing cached file/.test(r.stderr)) { t.skip('partial .cache/gamedata'); return; }
  assert.equal(r.status, 0, r.stderr);
  for (const n of BUILT) assert.ok(readFileSync(join(out, `${n}.json`)).equals(readFileSync(join(ROOT, 'data', `${n}.json`))), `data/${n}.json`);
  assert.doesNotMatch(r.stdout, /note: --gamedata-commit/);
  const g = JSON.parse(readFileSync(report, 'utf8')).gamedata;
  assert.equal(g.commit, null);
  assert.equal(g.replacedPins, null);
  assert.equal(g.references, undefined, 'no mirror, no reference files');
  for (const rel of [...TABLES, LEVELS[0]]) {
    assert.deepEqual(g.files[rel], { commit: pinnedShaOf(defaultProfile, rel), from: 'pin', pin: pinKeyOf(defaultProfile, rel), source: 'kengxxiao' }, rel);
  }
  assert.deepEqual(Object.keys(g.files), Object.keys(g.files).slice().sort(), 'sorted by path');
  assert.deepEqual(g.groups.map((x) => [x.commit, x.from, x.pin]), [
    [defaultProfile.pins.default, 'pin', 'default'], [defaultProfile.pins.character, 'pin', 'character'],
  ]);
  assert.equal(g.groups[1].files, 4, 'character, skill, uniequip and battle_equip tables');
  assert.equal(g.groups[0].files + g.groups[1].files, Object.keys(g.files).length);
  assert.match(r.stdout, new RegExp(`^official data: ${defaultProfile.pins.default} \\(pin default\\): ${g.groups[0].files} file\\(s\\); ${defaultProfile.pins.character} \\(pin character\\): 4 file\\(s\\)$`, 'm'));
});

test('--version act3autochess@V3_1 --gamedata-commit <its pin> --offline reproduces its data byte for byte; the report says "option"', { skip: (!regulationCached && 'pinned official data not cached') || (process.env.DATA_DIR && 'DATA_DIR set') }, (t) => {
  const { out, report } = scratch(t);
  const sha = regulationProfile.pins.default;
  const r = run(['--version', 'act3autochess@V3_1', '--gamedata-commit', sha, '--offline', '--out', out, '--report', report], { timeout: 180_000 });
  if (r.status !== 0 && /missing cached file/.test(r.stderr)) { t.skip('partial .cache/gamedata'); return; }
  assert.equal(r.status, 0, r.stderr);
  const dir = join(ROOT, 'data', 'versions', 'act3autochess-v3_1');
  for (const n of [...BUILT, 'tuning']) assert.ok(readFileSync(join(out, `${n}.json`)).equals(readFileSync(join(dir, `${n}.json`))), `data/versions/act3autochess-v3_1/${n}.json`);
  assert.match(r.stdout, new RegExp(`^note: --gamedata-commit ${sha} replaces the pins of tools/versions/act3autochess-v3_1\\.mjs \\(default ${sha.slice(0, 8)}\\)`, 'm'));
  const g = JSON.parse(readFileSync(report, 'utf8')).gamedata;
  assert.equal(g.commit, sha);
  assert.deepEqual(g.replacedPins, { default: sha });
  assert.ok(Object.keys(g.files).length > 50, 'tables, levels and stage pieces');
  for (const [rel, o] of Object.entries(g.files)) assert.deepEqual(o, { commit: sha, from: 'option', pin: null, source: 'kengxxiao' }, rel);
  assert.deepEqual(g.groups, [{ commit: sha, from: 'option', pin: null, source: 'kengxxiao', files: Object.keys(g.files).length }]);
  assert.match(r.stdout, new RegExp(`^official data: ${sha} \\(--gamedata-commit\\): ${Object.keys(g.files).length} file\\(s\\)$`, 'm'));
});
