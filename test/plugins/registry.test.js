// test/plugins/registry.test.js — the plugin registry (DESIGN §32, server/plugins/registry.js): one scan over the
// language folders, packs/ and plugins/ — manifest 1 read as before, manifest 2 by class (lang and cosmetic loaded —
// P1a —, content loaded, code disabled by default), broken manifests, stray files and links, duplicate ids (across packs/ and
// plugins/, any case) and languages skipped with a reason, `_` templates and top-level files never read; the
// language-pack view and /packs/index.json unchanged (server/packs.js is a compatibility export), a lang plugin served
// like a pack folder and nothing else of plugins/ served; GET /plugins/index.json with the vanilla content hash; a
// plugin dropped in or removed while the server runs; tools/plugin.mjs list / check; plugins/ in .gitignore and in the
// release zips (its readme and templates only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanPlugins, scanPacks, packIndexOf, createPluginRegistry, readPluginFolder, crossPluginFindings } from '../../server/plugins/registry.js';
import * as compat from '../../server/packs.js';
import { readPackIndex } from '../../shared/packs.js';
import { selectTracked } from '../../tools/package.mjs';
import { writePackIndex } from '../../tools/packs.mjs';
import { serveDirs } from '../../server/http/config.js';
import { createStaticHandler } from '../../server/http/static.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-plugins-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};
const dirsOf = (root, plugins = true) => ({
  publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), packsDir: path.join(root, 'packs'),
  ...(plugins ? { pluginsDir: path.join(root, 'plugins') } : {}),
});
const content = (extra = {}) => ({
  manifest: 2, name: { zh: '马拉松', en: 'Marathon' }, version: '0.1.0', app: '>=0.2.0', api: 1, class: 'content', permissions: ['data.patch'],
  data: ['data/economy.json'], ...extra,
});

/** A checkout-shaped root: the language packs of 0.2.0 and a plugins/ folder with one of everything. */
function exampleRoot() {
  const dir = tmpdir('root');
  put(dir, 'public/i18n/en.json', { _meta: { name: 'English', complete: true }, 开始: 'Start' });
  put(dir, 'public/i18n/qaa.json', { _meta: { name: 'Qaa', fallback: ['en'] }, 开始: 'Los' });
  put(dir, 'packs/qab/pack.json', { type: 'lang', lang: 'qab', name: 'Qab', files: { ui: 'ui.json' } });
  put(dir, 'packs/qab/ui.json', { 开始: 'Qab' });
  put(dir, 'packs/art/pack.json', { type: 'assets', name: 'HD art' });
  put(dir, 'plugins/README.md', '# plugins\n');
  put(dir, 'plugins/config.json', { rooms: 'host' });
  put(dir, 'plugins/marathon/plugin.json', content());
  put(dir, 'plugins/marathon/data/economy.json', { patch: 1, ops: [] });
  put(dir, 'plugins/marathon/README.md', '# Marathon\n');
  put(dir, 'plugins/skin/plugin.json', { manifest: 2, name: 'Skin', version: '1.0.0', app: '*', api: 1, class: 'cosmetic', permissions: ['assets.override'],
    assets: { chars: { char_102_texas: { avatar: 'art/avatar.png' } } } });
  put(dir, 'plugins/skin/art/avatar.png', 'png');
  put(dir, 'plugins/qac/plugin.json', { manifest: 2, class: 'lang', lang: 'qac', name: 'Qac', version: '1.0.0', files: { ui: 'ui.json', data: 'game.json' } });
  put(dir, 'plugins/qac/ui.json', { 开始: 'Qac', 设置: 'Qac-S' });
  put(dir, 'plugins/qac/game.json', { version: 1, lang: 'qac', names: {}, files: {} });
  put(dir, 'plugins/kit/plugin.json', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'script', permissions: ['sim.code'], entry: { sim: 'sim/index.js' } });
  put(dir, 'plugins/kit/sim/index.js', 'export default function setup() {}\n');
  put(dir, 'plugins/needs/plugin.json', content({ requires: { marathon: '>=1.0.0', absent: '*' } }));
  put(dir, 'plugins/needs/data/economy.json', { patch: 1, ops: [] });
  // skipped
  put(dir, 'plugins/_template/content/plugin.json', content());
  put(dir, 'plugins/nomanifest/data.json', {});
  put(dir, 'plugins/oldstyle/pack.json', { type: 'lang', lang: 'qad', files: { ui: 'ui.json' } });
  put(dir, 'plugins/broken/plugin.json', '{ "manifest": 2, ');
  put(dir, 'plugins/qab/plugin.json', content());
  put(dir, 'plugins/qab/data/economy.json', { patch: 1, ops: [] });
  put(dir, 'plugins/dup-lang/plugin.json', { manifest: 2, class: 'lang', lang: 'qab', version: '1.0.0', files: { ui: 'ui.json' } });
  put(dir, 'plugins/dup-lang/ui.json', { 开始: 'x' });
  put(dir, 'plugins/stray/plugin.json', content());
  put(dir, 'plugins/stray/data/economy.json', {});
  put(dir, 'plugins/stray/tools/run.exe', 'MZ');
  put(dir, 'plugins/missing/plugin.json', content({ data: ['data/none.json'] }));
  put(dir, 'packs/upper/plugin.json', content());
  return dir;
}

test('one scan: the language packs, packs/ and plugins/ by class — lang and cosmetic loaded, content loaded, code disabled by default', () => {
  const root = exampleRoot();
  try {
    const scan = scanPlugins(dirsOf(root), { app: '0.3.0' });
    assert.deepEqual(scan.plugins.map((p) => [p.id, p.class, p.status, p.source]), [
      ['en', 'lang', 'loaded', 'i18n'], ['qaa', 'lang', 'loaded', 'i18n'], ['qab', 'lang', 'loaded', 'packs'],
      ['kit', 'script', 'disabled', 'plugins'], ['marathon', 'content', 'loaded', 'plugins'], ['needs', 'content', 'loaded', 'plugins'],
      ['qac', 'lang', 'loaded', 'plugins'], ['skin', 'cosmetic', 'loaded', 'plugins'],
    ]);
    // a loaded cosmetic plugin is no language entry; its overlay was read (no data/assets.json here: no vs)
    const skin = scan.plugins.find((p) => p.id === 'skin');
    assert.deepEqual([skin.supported, skin.visual.ops.length, [...skin.visual.served.keys()], skin.visual.vs], [false, 1, ['art/avatar.png'], null]);
    const why = Object.fromEntries(scan.skipped.map((s) => [s.where, s.problems.join('; ')]));
    assert.match(why['packs/art/'], /type "assets" is planned .*its successor is a cosmetic plugin/);
    assert.match(why['packs/upper/'], /no pack\.json \(plugin\.json belongs in plugins\/upper\/\)/);
    assert.match(why['plugins/nomanifest/'], /^no plugin\.json$/);
    assert.match(why['plugins/oldstyle/'], /pack\.json is the manifest 1 of a pack folder in packs\//);
    assert.match(why['plugins/broken/'], /plugin\.json: not valid JSON/);
    assert.match(why['plugins/qab/'], /the id "qab" is taken by packs\/qab\//);
    assert.match(why['plugins/dup-lang/'], /the language qab is already provided by packs\/qab\//);
    assert.match(why['plugins/stray/'], /tools\/run\.exe: \.exe is not a file a content plugin may carry/);
    assert.match(why['plugins/missing/'], /"data": data\/none\.json is missing/);
    assert.ok(!Object.keys(why).some((w) => w.includes('_template') || w.includes('config') || w.includes('README')), 'templates and top-level files are never read');
    const warns = scan.warnings.filter((w) => w.where === 'plugins/needs/').map((w) => w.warning);
    assert.deepEqual(warns, ['requires "marathon" >=1.0.0; the installed one is 0.1.0', 'requires "absent" *, which is not installed']);
    const marathon = scan.plugins.find((p) => p.id === 'marathon');
    assert.deepEqual([marathon.count, marathon.manifest.name, marathon.supported, marathon.files], [1, '马拉松', false, {}], 'README not counted; nothing served');
    const qac = scan.plugins.find((p) => p.id === 'qac');
    assert.deepEqual([qac.supported, qac.strings, qac.files.ui.url, qac.files.data.url], [true, 2, '/packs/qac/ui.json', '/packs/qac/game.json']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the language-pack view is 0.2.0\'s: server/packs.js re-exports it, plugins/ is read only when given, /packs/index.json unchanged', () => {
  const root = exampleRoot();
  try {
    assert.equal(compat.createPackRegistry, createPluginRegistry);
    assert.equal(compat.scanPacks, scanPacks);
    assert.equal(compat.packIndexOf, packIndexOf);
    assert.equal(compat.LANG_DIR, 'i18n');
    const old = scanPacks(dirsOf(root, false), { app: '0.2.0' });
    assert.deepEqual(old.packs.map((p) => [p.id, p.type, p.layout, p.manifest.lang]), [['en', 'lang', 'file', 'en'], ['qaa', 'lang', 'file', 'qaa'], ['qab', 'lang', 'folder', 'qab']]);
    assert.ok(!old.skipped.some((s) => s.where.startsWith('plugins/')), 'no pluginsDir: plugins/ is not read');
    const withPlugins = scanPacks(dirsOf(root), { app: '0.2.0' });
    assert.deepEqual(withPlugins.packs.map((p) => p.id), ['en', 'qaa', 'qab', 'qac'], 'a lang plugin is a language entry; other classes are not packs');
    // the index of the packs alone is the one 0.2.0 wrote, field for field
    const index = packIndexOf(old.packs, { app: '0.2.0' });
    assert.deepEqual(index.packs.find((p) => p.id === 'qaa'), {
      id: 'qaa', type: 'lang', name: 'Qaa', englishName: 'qaa', compatible: true, lang: 'qaa', fallback: ['en'], strings: 1, files: { ui: '/i18n/qaa.json' },
    });
    const both = packIndexOf(withPlugins.packs, { app: '0.2.0' });
    assert.deepEqual(both.packs.filter((p) => p.id !== 'qac'), index.packs);
    assert.deepEqual(readPackIndex(both, 'lang').map((p) => p.id), ['en', 'qaa', 'qab', 'qac']);
    // an empty plugins/ changes nothing at all
    const plain = tmpdir('plain');
    put(plain, 'public/i18n/en.json', { _meta: { name: 'English' }, 开始: 'Start' });
    fs.mkdirSync(path.join(plain, 'plugins'));
    assert.deepEqual(packIndexOf(scanPacks(dirsOf(plain)).packs), packIndexOf(scanPacks(dirsOf(plain, false)).packs));
    fs.rmSync(plain, { recursive: true, force: true });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the registry: only a lang folder\'s named files are servable; the catalogue lists every valid entry; a plugin dropped in shows', () => {
  const root = exampleRoot();
  try {
    const reg = createPluginRegistry(dirsOf(root), { recheckMs: 0, app: '0.3.0' });
    assert.equal(reg.servable('qac', 'ui.json'), path.join(root, 'plugins/qac/ui.json'));
    assert.equal(reg.servable('qac', 'plugin.json'), null);
    assert.equal(reg.servable('marathon', 'data/economy.json'), null, 'content data is served only through content sets');
    assert.equal(reg.servable('kit', 'sim/index.js'), null, 'code is never served');
    assert.equal(reg.servable('skin', 'art/avatar.png'), null, 'a cosmetic plugin\'s art is no pack file (it is served at /p/)');
    assert.equal(reg.pluginFile('skin', 'art/avatar.png')?.abs, path.join(root, 'plugins/skin/art/avatar.png'));
    assert.equal(reg.pluginFile('skin', 'plugin.json'), null);
    assert.equal(reg.pluginFile('marathon', 'data/economy.json'), null, 'content JSON is never served through /p/');
    assert.deepEqual(reg.list().map((p) => p.id), ['en', 'qaa', 'qab', 'qac']);
    assert.deepEqual(reg.plugins('content').map((p) => p.id), ['marathon', 'needs']);
    const body = reg.pluginIndex({ vanilla: 'cd'.repeat(32) });
    assert.deepEqual(body.content, { vanilla: 'cd'.repeat(32) });
    assert.deepEqual(body.plugins.map((e) => [e.id, e.class, e.status]), [
      ['en', 'lang', 'loaded'], ['qaa', 'lang', 'loaded'], ['qab', 'lang', 'loaded'], ['qac', 'lang', 'loaded'],
      ['skin', 'cosmetic', 'loaded'], ['marathon', 'content', 'loaded'], ['needs', 'content', 'loaded'], ['kit', 'script', 'disabled'],
    ]);
    assert.ok(body.plugins.filter((e) => e.class !== 'lang').every((e) => e.unofficial === true), 'every non-language plugin is marked unofficial');
    assert.ok(!JSON.stringify(body).includes(root), 'no server path in the catalogue');
    // dropped in, then removed, while the registry runs
    put(root, 'plugins/later/plugin.json', content());
    put(root, 'plugins/later/data/economy.json', { patch: 1, ops: [] });
    assert.ok(reg.pluginIndex().plugins.some((e) => e.id === 'later'), 'appears without a restart');
    fs.rmSync(path.join(root, 'plugins/later'), { recursive: true, force: true });
    assert.ok(!reg.pluginIndex().plugins.some((e) => e.id === 'later'), 'removed');
    assert.ok(reg.report().skipped.some((s) => s.where === 'plugins/stray/'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('links: a symbolic link inside a plugin folder keeps it out; a plugin folder that is itself a link reads normally', (t) => {
  const root = tmpdir('links');
  const outside = tmpdir('outside');
  try {
    put(outside, 'secret.json', { patch: 1, ops: [] });
    put(root, 'plugins/leak/plugin.json', content());
    fs.mkdirSync(path.join(root, 'plugins/leak/data'), { recursive: true });
    try { fs.symlinkSync(path.join(outside, 'secret.json'), path.join(root, 'plugins/leak/data/economy.json')); } catch { t.skip('no symbolic links here'); return; }
    put(outside, 'dev/plugin.json', content());
    put(outside, 'dev/data/economy.json', { patch: 1, ops: [] });
    fs.symlinkSync(path.join(outside, 'dev'), path.join(root, 'plugins/dev'));
    const r = readPluginFolder(path.join(root, 'plugins/leak'));
    assert.equal(r.plugin, null);
    assert.match(r.problems.join(), /data\/economy\.json: a symbolic link/);
    const dev = readPluginFolder(path.join(root, 'plugins/dev'));
    assert.deepEqual(dev.problems, [], 'a developer\'s linked folder');
    assert.equal(dev.plugin.id, 'dev');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('one unreadable entry never stops the scan, the registry or the server: JSON nested too deep to quote back', async () => {
  const root = exampleRoot();
  const deep = (n) => `{"manifest":${'['.repeat(n)}${']'.repeat(n)}}`;
  put(root, 'plugins/deep-one/plugin.json', deep(20000));
  put(root, 'packs/deep-pack/pack.json', `{"type":"lang","lang":"qaz","files":{"ui":"ui.json"},"machineTranslated":${'['.repeat(20000)}${']'.repeat(20000)}}`);
  put(root, 'packs/deep-pack/ui.json', { 开始: 'z' });
  try {
    const scan = scanPlugins(dirsOf(root), { app: '0.3.0' });
    const why = Object.fromEntries(scan.skipped.map((s) => [s.where, s.problems.join('; ')]));
    assert.match(why['plugins/deep-one/'], /"manifest": \[…\] is not 2/);
    assert.ok(scan.plugins.some((p) => p.id === 'deep-pack'), 'a deep but ignorable value only warns (0.2.0 stopped the whole scan here)');
    assert.ok(scan.plugins.some((p) => p.id === 'marathon'), 'the other entries are read');
    const { startServer } = await import('../../server/index.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(root, 'public'), packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'plugins') });
    try {
      assert.equal((await fetch(`${srv.url}/plugins/index.json`)).status, 200);
      assert.equal((await fetch(`${srv.url}/packs/index.json`)).status, 200);
    } finally { await srv.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the plugins folder defaults to the one beside the packs folder; a static index lists packs only; a 0.2.0-shaped registry gets an empty catalogue', async () => {
  assert.equal(serveDirs({ packsDir: path.join(os.tmpdir(), 'x', 'packs') }).pluginsDir, path.join(os.tmpdir(), 'x', 'plugins'), 'a test\'s own packs: never this checkout\'s plugins');
  assert.equal(serveDirs({}).pluginsDir, path.join(ROOT, 'plugins'));
  assert.equal(serveDirs({ pluginsDir: '/p' }).pluginsDir, '/p');
  const root = exampleRoot();
  try {
    const body = writePackIndex(root);
    assert.deepEqual(body.packs.map((p) => p.id), ['en', 'qaa', 'qab'], 'a static host could not serve a lang plugin\'s files at /packs/<id>/');
    const old = { refresh() {}, list: () => [], index: () => ({ version: 1, app: '0.2.0', packs: [] }), report: () => ({ skipped: [], warnings: [] }), servable: () => null };
    const serve = createStaticHandler({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), sharedDir: path.join(ROOT, 'shared'), packs: old, content: { cs: 'ab'.repeat(32) } });
    const out = { status: 0, body: '' };
    const res = { writeHead(st) { out.status = st; }, setHeader() {}, end(b) { out.body = b ? b.toString() : ''; } };
    await serve({ method: 'GET', headers: {} }, res, '/plugins/index.json', '');
    assert.equal(out.status, 200);
    assert.deepEqual(JSON.parse(out.body).plugins, []);
    assert.deepEqual(JSON.parse(out.body).content, { vanilla: 'ab'.repeat(32) });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the server: GET /plugins/index.json (never cached, the vanilla hash), a lang plugin through /packs/, nothing else of plugins/ served', async () => {
  const root = exampleRoot();
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(root, 'public'), packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'plugins') });
  try {
    const get = (u) => fetch(srv.url + u);
    const res = await get('/plugins/index.json');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.version, 1);
    assert.deepEqual(body.content, { vanilla: srv.content.cs });
    assert.match(srv.content.cs, /^[0-9a-f]{64}$/);
    assert.ok(body.plugins.some((e) => e.id === 'marathon' && e.status === 'loaded' && e.unofficial));
    const packs = await (await get('/packs/index.json')).json();
    assert.deepEqual(readPackIndex(packs, 'lang').map((p) => p.id), ['en', 'qaa', 'qab', 'qac']);
    assert.deepEqual(await (await get('/packs/qac/ui.json')).json(), { 开始: 'Qac', 设置: 'Qac-S' });
    for (const u of ['/packs/qac/plugin.json', '/packs/marathon/data/economy.json', '/packs/kit/sim/index.js', '/plugins/marathon/plugin.json',
      '/plugins/README.md', '/plugins/', '/plugins/config.json']) assert.equal((await get(u)).status, 404, u);
    assert.equal((await get('/plugins/index.json', { method: 'HEAD' })).status, 200);
  } finally {
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tools/plugin.mjs: list names every class and the vanilla hash; check exits 1 on a problem, --strict on a warning', () => {
  const root = exampleRoot();
  try {
    const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools/plugin.mjs'), ...args, '--root', root], { encoding: 'utf8' });
    const list = run('list');
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /^vanilla content: [0-9a-f]{64} \(\d+ code files, \d+ data files\)$/m);
    assert.match(list.stdout, /^content \(supported: .*\): $/m);
    assert.match(list.stdout, /^ {2}marathon +马拉松 \(Marathon\) {2}— plugins\/marathon\/; v0\.1\.0, app >=0\.2\.0, unofficial, 1 file, /m);
    assert.match(list.stdout, /^skipped {2}plugins\/stray\/: .*run\.exe/m);
    const json = JSON.parse(run('list', '--json').stdout);
    assert.match(json.index.content.vanilla, /^[0-9a-f]{64}$/);
    assert.ok(json.skipped.some((s) => s.where === 'plugins/broken/'));
    const all = run('check');
    assert.equal(all.status, 1, 'the broken folders');
    assert.match(all.stdout, /^plugins\/marathon\/ {2}marathon 0\.1\.0 · content \(loaded\) · 1 file, [\d.]+ KB\n {2}ok$/m);
    assert.match(all.stdout, /^plugins\/stray\/ {2}not loadable\n {2}problem {2}tools\/run\.exe/m);
    assert.doesNotMatch(all.stdout, /_template/);
    assert.equal(run('check', 'marathon').status, 0);
    assert.equal(run('check', 'marathon', '--strict').status, 0);
    assert.equal(run('check', 'needs').status, 0, 'a missing requirement is the registry\'s warning, not the folder\'s');
    put(root, 'plugins/marathon/data/bad.json', '{ "x": 1e999 }');
    const bad = run('check', 'marathon');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /problem {2}data\/bad\.json: \$\.x: a number that is not finite/);
    put(root, 'plugins/marathon/plugin.json', content({ id: 'other' }));
    fs.rmSync(path.join(root, 'plugins/marathon/data/bad.json'));
    assert.equal(run('check', 'marathon').status, 0, 'a warning');
    assert.equal(run('check', 'marathon', '--strict').status, 1, '--strict: a warning fails');
    const outside = run('check', path.join(root, 'plugins/skin'));
    assert.equal(outside.status, 0, outside.stdout);
    assert.equal(run('check', 'nope').status, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cross-plugin: a second overlay names the plugin that won, and a shared slot is a warning', () => {
  const lang = (id, code, source = 'plugins') => ({
    id, class: 'lang', source, where: source === 'i18n' ? `public/i18n/${code}.json` : `plugins/${id}/`, manifest: { lang: code },
  });
  const ui = (id) => ({
    id, class: 'ui', source: 'plugins', where: `plugins/${id}/`, manifest: { slots: ['hud.right'] }, ui: { slots: ['hud.right'] },
  });
  const cross = crossPluginFindings([lang('en', 'en', 'i18n'), lang('alpha', 'en'), lang('beta', 'en'), ui('meter'), ui('log')]);
  assert.equal(cross.plugins.some((p) => p.id === 'alpha'), true);
  assert.equal(cross.plugins.some((p) => p.id === 'beta'), false);
  const lost = cross.skipped.find((s) => s.where === 'plugins/beta/');
  assert.match(lost.problems[0], /alpha \(plugins\/alpha\/\)/);
  assert.match(lost.problems[0], /one overlay per language/);
  assert.doesNotMatch(lost.problems[0], /public\/i18n\/en\.json/);
  assert.equal(cross.warnings.length, 2);
  assert.match(cross.warnings[0].warning, /hud\.right/);
  assert.match(cross.warnings[0].warning, /meter, log/);
  assert.equal(cross.warnings[0].issue.code, 'PLUGIN_UI_SLOT_SHARED');
});

test('plugin check reports a second overlay and a shared slot; list follows SP_PLUGIN_SCRIPTS', () => {
  const root = tmpdir('cross');
  const run = (args, env = {}) => spawnSync(process.execPath, [path.join(ROOT, 'tools/plugin.mjs'), ...args, '--root', root], {
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  try {
    put(root, 'public/i18n/en.json', { _meta: { name: 'English', complete: true }, 开始: 'Start' });
    put(root, 'packs/.keep', '');
    put(root, 'data/assets.json', '{}\n');
    const lang = (id) => ({ manifest: 2, class: 'lang', lang: 'en', name: id, version: '1.0.0', files: { ui: 'ui.json' } });
    put(root, 'plugins/alpha/plugin.json', lang('alpha'));
    put(root, 'plugins/alpha/ui.json', { 开始: 'Alpha' });
    put(root, 'plugins/beta/plugin.json', lang('beta'));
    put(root, 'plugins/beta/ui.json', { 开始: 'Beta' });
    const ui = (id) => ({
      manifest: 2, name: id, version: '1.0.0', app: '*', api: 1, class: 'ui', scope: ['personal'], permissions: ['ui.frame'],
      entry: { client: 'ui/index.html' }, slots: ['hud.right'],
    });
    put(root, 'plugins/meter/plugin.json', ui('meter'));
    put(root, 'plugins/meter/ui/index.html', '<!doctype html><title>meter</title><style>html{color-scheme:dark}</style>');
    put(root, 'plugins/log/plugin.json', ui('log'));
    put(root, 'plugins/log/ui/index.html', '<!doctype html><title>log</title>');
    put(root, 'plugins/kit/plugin.json', { manifest: 2, name: 'kit', version: '1.0.0', app: '*', api: 1, class: 'script', permissions: ['sim.code'], entry: { sim: 'sim/index.js' } });
    put(root, 'plugins/kit/sim/index.js', 'export default function setup() {}\n');
    const packed = run(['pack', 'kit']);
    assert.equal(packed.status, 0, packed.stdout + packed.stderr);
    const check = run(['check']);
    assert.equal(check.status, 1, check.stdout);
    assert.match(check.stdout, /already has an overlay from alpha/);
    assert.match(check.stdout, /one overlay per language/);
    assert.match(check.stdout, /slot hud\.right is also requested by log, meter/);
    const alone = run(['check', 'alpha']);
    assert.equal(alone.status, 0, alone.stdout);
    const named = (args) => {
      const r = run(['check', ...args, '--json']);
      const body = JSON.parse(r.stdout);
      const dups = (body.folders || []).flatMap((f) => (f.issues || []).filter((i) => i.code === 'PLUGIN_DUPLICATE'));
      return { status: r.status, problems: body.problems, dups };
    };
    for (const args of [['alpha', 'beta'], ['beta', 'alpha']]) {
      const got = named(args);
      assert.equal(got.status, 1, JSON.stringify({ args, problems: got.problems, texts: got.dups.map((d) => d.text) }));
      assert.equal(got.problems, 1);
      assert.equal(got.dups.length, 1);
      assert.equal(got.dups[0].where, 'plugins/beta/');
      assert.match(got.dups[0].text, /alpha \(plugins\/alpha\/\)/);
    }
    const onlyBeta = named(['beta']);
    assert.equal(onlyBeta.status, 0, JSON.stringify(onlyBeta.dups.map((d) => d.text)));
    assert.equal(onlyBeta.problems, 0);
    const off = run(['list']);
    assert.match(off.stdout, /kit .+disabled/);
    const sandbox = run(['list'], { SP_PLUGIN_SCRIPTS: 'sandbox' });
    assert.equal(sandbox.status, 0, sandbox.stderr);
    assert.match(sandbox.stdout, /kit /);
    assert.doesNotMatch(sandbox.stdout, /kit .+disabled/);
    const trusted = run(['list'], { SP_PLUGIN_SCRIPTS: 'trusted' });
    assert.match(trusted.stdout, /kit .+disabled/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('plugins/: ignored by git except its readme and templates, which the release zips ship', () => {
  const ignored = (rel) => {
    try { execFileSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT, stdio: 'ignore' }); return true; } catch (e) { return e && e.status === 1 ? false : null; }
  };
  for (const [rel, want] of [['plugins/marathon/plugin.json', true], ['plugins/config.json', true], ['plugins/README.md', false], ['plugins/_template/content/plugin.json', false]]) {
    const v = ignored(rel);
    if (v !== null) assert.equal(v, want, rel);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'plugins/README.md')));
  assert.deepEqual(selectTracked(['plugins/README.md', 'plugins/_template/content/plugin.json']).keep, ['plugins/README.md', 'plugins/_template/content/plugin.json']);
});

test('release allowlist includes both original template media files', () => {
  const samples = ['plugins/_template/cosmetic/media/sample.png', 'plugins/_template/cosmetic/media/sample.ogg'];
  assert.deepEqual(selectTracked(samples).keep, [...samples].sort());
  assert.equal(fs.readFileSync(path.join(ROOT, samples[0])).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(fs.readFileSync(path.join(ROOT, samples[1])).subarray(0, 4).toString(), 'OggS');
});
