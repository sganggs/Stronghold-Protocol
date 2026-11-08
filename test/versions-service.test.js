// test/versions-service.test.js — the official versions a server offers (DESIGN §35.23, M1; server/versions.js): each
// version's cs (contentHashOf of the vanilla code and its own data), its manifest and bounds, the match hosts' view, and
// nothing for a version the server does not enable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { createVersionSets } from '../server/versions.js';
import { computeVanillaContent } from '../server/plugins/identity.js';
import { DATA_DIR, ROOT, getData, versionDataDir } from '../server/data.js';
import { DATA_SHIM_JS } from '../server/http/static.js';
import { contentHashOf, csUrlPart, canonicalJson } from '../shared/plugins/identity.js';
import { DEFAULT_VERSION } from '../shared/versions.js';
import { DIFFICULTIES, modeIdFor } from '../shared/constants.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const vanilla = computeVanillaContent({ simDir: path.join(ROOT, 'server', 'sim'), sharedDir: path.join(ROOT, 'shared'), dataDir: DATA_DIR, shim: DATA_SHIM_JS });
const ALL = ['act2autochess', 'act2autochess@V2_1', 'act1autochess', 'act1autochess@V1_1'];
const quiet = { info() {}, warn() {}, error() {} };

test('every version: cs = contentHashOf(vanilla app / sim, its data), all distinct, the default the vanilla cs', () => {
  const v = createVersionSets({ enabled: ALL, vanilla, log: quiet });
  assert.deepEqual([...v.ids], ALL);
  assert.deepEqual([...v.nonDefault], ALL.slice(1));
  assert.equal(v.defaultId, DEFAULT_VERSION);
  assert.equal(v.csOf(DEFAULT_VERSION), vanilla.cs);
  const seen = new Set([vanilla.cs]);
  for (const id of ALL.slice(1)) {
    const cs = v.csOf(id);
    const set = v.get(cs);
    assert.equal(set.name, id);
    assert.equal(contentHashOf(set.hashInput), cs, id);
    assert.equal(set.hashInput.app, vanilla.app);
    assert.equal(set.hashInput.sim, vanilla.sim);
    assert.equal(Object.hasOwn(set.hashInput.data, 'assets'), false, 'the art manifest is never part of a version');
    assert.ok(!seen.has(cs), `${id}: a cs of its own`);
    seen.add(cs);
    assert.equal(v.idOfCs(cs), id);
    // the data bytes are the hashed files
    const bytes = v.dataBytes(cs);
    assert.deepEqual(Object.keys(bytes).sort(), Object.keys(set.hashInput.data).sort());
    for (const [name, b] of Object.entries(bytes)) assert.equal(sha(b), set.hashInput.data[name], `${id} ${name}`);
    assert.deepEqual(v.content(id), { cs, vanilla: true, version: id, plugins: [] });
    assert.ok(Object.isFrozen(v.content(id)));
  }
  assert.deepEqual(v.content(DEFAULT_VERSION), { cs: vanilla.cs, vanilla: true, plugins: [] });
  assert.equal(v.idOfCs(vanilla.cs), DEFAULT_VERSION);
});

test('the manifest names the version, its data under /data/versions/<slug>/ and its bounds; the bounds hash matches', () => {
  const v = createVersionSets({ enabled: ['act2autochess', 'act1autochess'], vanilla, log: quiet });
  const cs = v.csOf('act1autochess');
  const cs16 = csUrlPart(cs);
  const f = v.file(cs16, 'index.json');
  assert.ok(f && f.type.startsWith('application/json'));
  const index = JSON.parse(f.body.toString('utf8'));
  assert.equal(index.cs, cs);
  assert.equal(index.vanilla, true);
  assert.equal(index.version, 'act1autochess');
  assert.deepEqual(index.plugins, []);
  assert.deepEqual(index.settings, {});
  assert.equal(index.app, vanilla.app);
  assert.deepEqual(index.simFiles, vanilla.simFiles);
  const dir = versionDataDir('act1autochess');
  for (const [name, d] of Object.entries(index.data)) {
    assert.match(d.url, new RegExp(`^/data/versions/act1autochess/${name}\\.json\\?v=[0-9a-f]{8}$`));
    const body = fs.readFileSync(path.join(dir, `${name}.json`));
    assert.equal(d.sha256, sha(body));
    assert.equal(d.bytes, body.length);
    assert.equal(d.url.slice(-8), d.sha256.slice(0, 8));
  }
  assert.equal(contentHashOf({ app: index.app, sim: index.sim, data: Object.fromEntries(Object.entries(index.data).map(([k, d]) => [k, d.sha256])) }), cs);
  assert.equal(index.bounds.official.url, `/cs/${cs16}/bounds/official.json`);
  const b = v.file(cs16, 'bounds/official.json');
  assert.equal(sha(b.body), index.bounds.official.sha256);
  assert.equal(b.body.length, index.bounds.official.bytes);
  const snap = JSON.parse(b.body.toString('utf8'));
  assert.equal(snap.v, 1);
  assert.equal(b.body.toString('utf8'), canonicalJson(snap));
  assert.deepEqual(v.get(cs).bounds, snap);
  assert.equal(v.file(cs16, 'data/chess.json'), null, 'a version serves its data under /data/versions/, never /cs/');
  assert.equal(v.file(csUrlPart(vanilla.cs), 'index.json'), null, 'the vanilla manifest stays the static server\'s');
});

test('a disabled version gives nothing; offered and welcome follow the data and the switch', () => {
  const off = createVersionSets({ enabled: ['act2autochess'], vanilla, log: quiet });
  assert.equal(off.welcome(), null, 'act2autochess alone: no welcome.versions');
  assert.deepEqual([...off.nonDefault], []);
  for (const id of ALL.slice(1)) {
    assert.equal(off.isEnabled(id), false);
    assert.equal(off.csOf(id), null);
    assert.equal(off.content(id), null);
    assert.equal(off.data(id), null);
    assert.deepEqual(off.offered(id, 'coop'), []);
  }
  assert.equal(off.get(vanilla.cs), null, 'the vanilla set never runs in a version host');
  assert.deepEqual(off.servedDirs(), []);
  assert.deepEqual(off.offered(DEFAULT_VERSION, 'coop'), ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']);

  const on = createVersionSets({ enabled: ALL, defaultId: 'act1autochess', vanilla, log: quiet });
  assert.equal(on.defaultId, 'act1autochess');
  assert.deepEqual(on.offered('act1autochess', 'coop'), ['FUNNY', 'NORMAL', 'HARD']);
  assert.deepEqual(on.offered('act2autochess@V2_1', 'solo'), ['FUNNY', 'NORMAL', 'HARD']);
  const w = on.welcome();
  assert.deepEqual(w.map((e) => e.id), ALL);
  assert.deepEqual(w.filter((e) => e.default).map((e) => e.id), ['act1autochess']);
  for (const e of w) {
    assert.match(e.cs, /^[0-9a-f]{64}$/);
    assert.equal(e.family, 'covenant');
    assert.deepEqual(e.roomModes, ['solo', 'coop']);
    assert.equal(typeof e.label, 'string');
  }
  assert.equal(on.servedDirs().length, 3);
  const only = createVersionSets({ enabled: ['act1autochess'], defaultId: 'act1autochess', vanilla, log: quiet });
  assert.deepEqual(only.welcome().map((e) => e.id), ['act1autochess'], 'a server of one non-default version announces it');
  assert.equal(only.data(DEFAULT_VERSION), null);
});

test('data loads once, frozen, the version\'s own; the default is the server\'s data', () => {
  const v = createVersionSets({ enabled: ['act2autochess', 'act1autochess@V1_1'], vanilla, defaultData: getData(), log: quiet });
  assert.equal(v.stats().loaded, 0, 'nothing parsed at boot');
  const d = v.data('act1autochess@V1_1');
  assert.equal(d.config.version.id, 'act1autochess@V1_1');
  assert.ok(Object.isFrozen(d.chess));
  assert.equal(v.data('act1autochess@V1_1'), d);
  assert.equal(v.dataOfCs(v.csOf('act1autochess@V1_1')), d);
  assert.equal(v.data(DEFAULT_VERSION), getData());
  assert.equal(v.dataOfCs(vanilla.cs), getData());
  assert.deepEqual(v.stats(), { enabled: ['act2autochess', 'act1autochess@V1_1'], default: 'act2autochess', loaded: 1 });
});

test('a version whose directory is missing or incomplete stays disabled, with a warning', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-versions-'));
  try {
    fs.mkdirSync(path.join(tmp, 'versions', 'act1autochess'), { recursive: true });
    fs.copyFileSync(path.join(versionDataDir('act1autochess'), 'config.json'), path.join(tmp, 'versions', 'act1autochess', 'config.json'));
    const warnings = [];
    const v = createVersionSets({ enabled: ALL, dataDir: tmp, vanilla, defaultData: getData(), log: { ...quiet, warn: (m) => warnings.push(m) } });
    assert.deepEqual([...v.ids], ['act2autochess']);
    assert.equal(v.welcome(), null);
    assert.equal(warnings.length, 3);
    assert.ok(warnings.some((w) => /act1autochess disabled: .*chess\.json/.test(w)), warnings.join('\n'));
    assert.ok(warnings.some((w) => /act2autochess@V2_1 disabled: cannot read/.test(w)), warnings.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a version whose data passed the boot checks but fails to load is remembered: logged once, null from then on, no manifest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-versions-'));
  try {
    const dir = path.join(tmp, 'versions', 'act1autochess');
    fs.cpSync(versionDataDir('act1autochess'), dir, { recursive: true });
    const errors = [];
    const v = createVersionSets({ enabled: ['act2autochess', 'act1autochess'], dataDir: tmp, vanilla, defaultData: getData(), log: { ...quiet, error: (m) => errors.push(m) } });
    assert.deepEqual([...v.ids], ['act2autochess', 'act1autochess'], 'the boot checks hash the files: enabled');
    fs.writeFileSync(path.join(dir, 'chess.json'), '{ not json'); // a file that does not parse (the boot checks only hash it)
    assert.equal(v.data('act1autochess'), null);
    assert.equal(errors.filter((m) => /act1autochess data failed to load/.test(m)).length, 1, errors.join('\n'));
    fs.rmSync(dir, { recursive: true, force: true }); // never read again: the failure is remembered
    assert.equal(v.data('act1autochess'), null);
    assert.equal(v.dataOfCs(v.csOf('act1autochess')), null);
    assert.equal(v.file(csUrlPart(v.csOf('act1autochess')), 'index.json'), null);
    assert.equal(v.file(csUrlPart(v.csOf('act1autochess')), 'bounds/official.json'), null);
    assert.equal(errors.filter((m) => /act1autochess data failed to load/.test(m)).length, 1, 'logged once');
    assert.equal(v.stats().loaded, 0);
    // no longer offered: the lobby's gates refuse it (available) and later pages do not see it (welcome)
    assert.equal(v.isEnabled('act1autochess'), true);
    assert.equal(v.available('act1autochess'), false);
    assert.equal(v.available(DEFAULT_VERSION), true);
    assert.equal(v.welcome(), null, 'only 第二期下半 left: the default welcome');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a configured default (not 第二期下半) whose data fails to load: the welcome marks 第二期下半 the default', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-versions-'));
  try {
    for (const id of ['act1autochess', 'act2autochess@V2_1']) fs.cpSync(versionDataDir(id), versionDataDir(id, tmp), { recursive: true });
    const v = createVersionSets({ enabled: ['act2autochess', 'act1autochess', 'act2autochess@V2_1'], defaultId: 'act1autochess', dataDir: tmp, vanilla,
      defaultData: getData(), log: quiet });
    assert.equal(v.welcome().find((e) => e.default)?.id, 'act1autochess');
    fs.writeFileSync(path.join(versionDataDir('act1autochess', tmp), 'chess.json'), '{ not json');
    assert.equal(v.available('act1autochess'), false);
    assert.deepEqual(v.welcome().map((e) => [e.id, !!e.default]), [['act2autochess', true], ['act2autochess@V2_1', false]]);
    assert.equal(v.defaultId, 'act1autochess', 'the configuration is unchanged (the lobby falls back: lobby-versions)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a configured default whose data fails to load, 第二期下半 not enabled: the welcome marks the first version that loads the default', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-versions-'));
  try {
    for (const id of ['act1autochess', 'act2autochess@V2_1']) fs.cpSync(versionDataDir(id), versionDataDir(id, tmp), { recursive: true });
    const v = createVersionSets({ enabled: ['act1autochess', 'act2autochess@V2_1'], defaultId: 'act1autochess', dataDir: tmp, vanilla,
      defaultData: getData(), log: quiet });
    assert.equal(v.welcome().find((e) => e.default)?.id, 'act1autochess');
    fs.writeFileSync(path.join(versionDataDir('act1autochess', tmp), 'chess.json'), '{ not json');
    assert.equal(v.available('act1autochess'), false);
    // (the lobby's defaultVersion() agrees: lobby-versions)
    assert.deepEqual(v.welcome().map((e) => [e.id, !!e.default]), [['act2autochess@V2_1', true]]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('规程·序列Ⅰ: its solo is laddered (极速模拟 and 规程等级 1–20), its co-op is not; offered follows the modes', () => {
  const v = createVersionSets({ enabled: [DEFAULT_VERSION, 'act3autochess@V3_1'], vanilla, log: quiet });
  assert.equal(v.laddered('act3autochess@V3_1', 'solo'), true);
  assert.equal(v.laddered('act3autochess@V3_1', 'coop'), false);
  assert.equal(v.laddered(DEFAULT_VERSION, 'solo'), false);
  const solo = v.modesOf('act3autochess@V3_1', 'solo');
  assert.deepEqual(solo.map((m) => m.id), ['mode_single_funny', ...Array.from({ length: 20 }, (_, i) => `mode_single_${i + 1}`)]);
  assert.deepEqual([solo[0].difficulty, solo[1].difficulty, solo[5].difficulty, solo[9].difficulty, solo[15].difficulty], ['FAST', 'FUNNY', 'NORMAL', 'HARD', 'ABYSS']);
  assert.deepEqual(v.offered('act3autochess@V3_1', 'solo'), ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']);
  assert.deepEqual(v.modesOf('act3autochess@V3_1', 'coop').map((m) => m.id), DIFFICULTIES.map((d) => modeIdFor('coop', d)));
  assert.deepEqual(v.modesOf(DEFAULT_VERSION, 'solo').map((m) => m.id), DIFFICULTIES.map((d) => modeIdFor('solo', d)));
});
