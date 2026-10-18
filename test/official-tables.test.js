import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { tableFixture, OFFICIAL_TEST_ID as ID } from './helpers/officialTables.js';
import { importForge } from '../server/plugins/forgeImport.js';
import { ensureOfficialTables, preparePluginOfficialTables } from '../tools/assets/official-tables.mjs';
import { installedArtReferences } from '../server/plugins/artReferences.js';
import { checkPluginArt, checkPluginFx } from '../tools/setup.mjs';
import { MirrorPolicy } from '../tools/assets/network.mjs';
import { main as pluginMain } from '../tools/plugin.mjs';
import { createStudio } from '../server/studio/index.js';
import { createPluginRegistry } from '../server/plugins/registry.js';

const importer = (f, opts = {}) => importForge({ files: f.files }, {
  root: f.root, dryRun: true, officialTables: { fetchImpl: f.fetchImpl, backoffMs: 0, ...opts },
});
let unexpectedFetches = 0;
const noFetch = async () => { unexpectedFetches++; throw new Error('unexpected network'); };
afterEach(() => { assert.equal(unexpectedFetches, 0, 'even caught fetch failures must not hide an unwanted request'); });

test('a packaged import fetches six tables once, derives both forms, then reuses cached bytes', async t => {
  const f = tableFixture(t);
  const first = await importer(f);
  assert.equal(first.ok, true, JSON.stringify(first.issues));
  assert.equal(first.report.dropped?.operators ?? 0, 0);
  assert.ok(first.report.products.some(p => p.class === 'content'));
  assert.match(first.markdown, /character_table.json.*~50.1 MB/);
  assert.match(first.markdown, /operators outside the roster/);
  assert.equal(f.calls.length, 6);
  const before = fs.readFileSync(f.cache('character_table.json'));
  const second = await importer(f, { fetchImpl: noFetch });
  assert.deepEqual(second.report.products, first.report.products);
  assert.deepEqual(fs.readFileSync(f.cache('character_table.json')), before);
  const wrote = await importForge({ files: f.files }, { root: f.root, officialTables: { fetchImpl: noFetch } });
  assert.equal(wrote.wrote, true, JSON.stringify(wrote.issues));
  const manifest = JSON.parse(fs.readFileSync(path.join(f.root, 'plugins/table-test/plugin.json')));
  const records = [].concat(JSON.parse(fs.readFileSync(path.join(f.root, 'plugins/table-test', manifest.operators[0]))));
  assert.equal(records.length, 1);
  assert.equal(records[0].forms.normal.stats.atk, 100);
  assert.equal(records[0].forms.elite.stats.atk, 100);
});

test('present tables are reused, refresh replaces only after validation, offline overrides refresh', async t => {
  const f = tableFixture(t); f.seed();
  await importer(f, { fetchImpl: noFetch });
  await importer(f, { offline: true, refresh: true, fetchImpl: noFetch });
  await importer(f, { refresh: true });
  assert.equal(f.calls.length, 6);
  assert.ok(fs.readdirSync(path.dirname(f.cache('character_table.json'))).every(n => n.endsWith('.json')));
});

test('offline imports keep the missing-table skip reason without any fetch', async t => {
  const f = tableFixture(t);
  const got = await importer(f, { offline: true, fetchImpl: noFetch });
  assert.equal(got.ok, true);
  assert.equal(got.report.dropped.operators, 1);
  assert.ok(got.report.skipped.some(s => /tables unavailable/.test(s.en) && /offline/.test(s.en)));
  assert.match(got.markdown, /Download refused.*offline/);
  assert.equal(fs.existsSync(f.cache('character_table.json')), false);
});

test('imports that need no derivation do not fetch tables', async t => {
  const f = tableFixture(t);
  const chess = JSON.parse(fs.readFileSync(path.join(f.root, 'data/chess.json')));
  const normal = Object.values(chess).find(row => row.charId && !row.isGolden && !row.isDiy);
  f.files.set('chess.json', Buffer.from(JSON.stringify({ test_a: { charId: normal.charId, tier: normal.tier, bonds: normal.bonds } })));
  const got = await importer(f, { fetchImpl: noFetch });
  assert.equal(got.ok, true);
  assert.equal(fs.existsSync(f.cache('character_table.json')), false);
  assert.equal(got.report.officialTables, undefined);
});

test('failed optional table downloads retain the required-table derivation and name the fallback', async t => {
  const f = tableFixture(t);
  const got = await importer(f, { fetchImpl: async url => /\/(uniequip|battle_equip|activity)_table.json$/.test(url)
    ? new Response('', { status: 404 }) : f.fetchImpl(url) });
  assert.equal(got.ok, true);
  assert.equal(got.report.dropped?.operators ?? 0, 0);
  assert.match(got.markdown, /Unavailable; keeping local fallback.*uniequip_table/);
  assert.equal(fs.existsSync(f.cache('uniequip_table.json')), false);
});

test('raw GitHub failure falls back to jsDelivr and shares the chosen MirrorPolicy', async t => {
  const f = tableFixture(t), urls = [];
  const policy = new MirrorPolicy({ source: 'mirror', proxyPrefix: 'https://mirror.example/', log() {} });
  const got = await importer(f, { mirrorPolicy: policy, fetchImpl: async url => {
    urls.push(url);
    if (!url.startsWith('https://cdn.jsdelivr.net/')) return new Response('', { status: 404 });
    return f.fetchImpl(url);
  } });
  assert.equal(got.report.dropped?.operators ?? 0, 0);
  assert.match(urls[0], /^https:\/\/mirror.example\//);
  assert.match(urls[1], /^https:\/\/raw.githubusercontent.com\//);
  assert.match(urls[2], /^https:\/\/cdn.jsdelivr.net\/gh\/Kengxxiao\/ArknightsGameData@master\/zh_CN\/gamedata\/excel\//);
  assert.equal(f.calls.length, 6);
});

test('invalid JSON, invalid shape, and oversized bodies never cache and name the skip reason', async t => {
  for (const kind of ['json', 'shape', 'length', 'stream']) await t.test(kind, async t => {
    const f = tableFixture(t);
    const got = await importer(f, { fetchImpl: async url => {
      if (!url.endsWith('/character_table.json')) return f.fetchImpl(url);
      if (kind === 'json') return new Response('{broken');
      if (kind === 'shape') return Response.json({ error: 'upstream failure' });
      if (kind === 'length') return new Response('{}', { headers: { 'content-length': String(33 * 1024 * 1024) } });
      let count = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (count++ < 33) controller.enqueue(new Uint8Array(1024 * 1024));
        else controller.close();
      } }));
    } });
    assert.equal(got.ok, true);
    assert.equal(got.report.dropped.operators, 1);
    assert.ok(got.report.skipped.some(s => /tables unavailable/.test(s.en)));
    assert.match(got.markdown, kind === 'shape' ? /invalid table shape/ : kind === 'json' ? /JSON|property name/ : /exceeds/);
    assert.equal(fs.existsSync(f.cache('character_table.json')), false);
    assert.ok(fs.readdirSync(path.dirname(f.cache('range_table.json'))).every(n => n.endsWith('.json')));
  });
});

test('every table has its own shape check; corrupt existing files and failed refreshes stay untouched', async t => {
  const f = tableFixture(t);
  const bad = await ensureOfficialTables(f.root, 'test', { fetchImpl: async () => Response.json({}), backoffMs: 0 });
  assert.equal(bad.failures.length, 6);
  assert.equal(fs.existsSync(path.dirname(f.cache('character_table.json'))), false);
  f.seed();
  const before = fs.readFileSync(f.cache('character_table.json'));
  const refresh = await ensureOfficialTables(f.root, 'test', { refresh: true, fetchImpl: async () => Response.json([]), backoffMs: 0 });
  assert.equal(refresh.failures.length, 6);
  assert.deepEqual(fs.readFileSync(f.cache('character_table.json')), before);
  f.put('.cache/gamedata/excel/character_table.json', '{broken');
  const corrupt = await importer(f, { fetchImpl: noFetch });
  assert.equal(corrupt.report.dropped.operators, 1);
  assert.equal(fs.readFileSync(f.cache('character_table.json'), 'utf8'), '{broken');
});

test('setup/startup gap preparation downloads only for discovered out-of-roster plugin references', async t => {
  const f = tableFixture(t), opts = { fetchImpl: f.fetchImpl, backoffMs: 0 };
  await preparePluginOfficialTables(f.root, opts);
  f.put('plugins/test/plugin.json', { operators: ['ops.json'], entry: { sim: 'never.js' } });
  f.put('plugins/test/never.js', 'throw new Error("must not execute")');
  const roster = Object.values(JSON.parse(fs.readFileSync(path.join(f.root, 'data/chess.json')))).find(r => r.charId).charId;
  f.put('plugins/test/ops.json', [{ charId: roster }, { charId: 'char_x_custom_operator' }]);
  await preparePluginOfficialTables(f.root, opts);
  assert.equal(f.calls.length, 0);
  f.put('plugins/test/ops.json', [{ origin: { charId: ID } }]);
  assert.deepEqual(installedArtReferences(f.root), []);
  for (const flags of [{ offline: true }, { check: true }, { assets: false }]) {
    const r = await preparePluginOfficialTables(f.root, { ...opts, ...flags, fetchImpl: noFetch });
    assert.match(r.lines.join('\n'), /Download refused/);
  }
  await preparePluginOfficialTables(f.root, opts);
  assert.equal(f.calls.length, 6);
  assert.deepEqual(checkPluginArt(f.root), [ID]);
  assert.deepEqual(checkPluginFx(f.root), [ID]);
  await preparePluginOfficialTables(f.root, { fetchImpl: noFetch });
});

test('art phase references trigger preparation; invented IDs still authorize no art extraction', async t => {
  const f = tableFixture(t);
  f.put('plugins/test/plugin.json', { assets: { chars: { char_x_test: { portrait: { ref: `${ID}_2` } } } } });
  await preparePluginOfficialTables(f.root, { fetchImpl: f.fetchImpl, backoffMs: 0 });
  assert.deepEqual(installedArtReferences(f.root), [ID]);
  f.put('plugins/test/plugin.json', { origin: { charId: 'char_999_fabricated' } });
  await preparePluginOfficialTables(f.root, { fetchImpl: noFetch });
  assert.deepEqual(installedArtReferences(f.root), []);
  fs.rmSync(path.join(f.root, '.cache'), { recursive: true });
  f.calls.length = 0;
  const unknown = await preparePluginOfficialTables(f.root, { fetchImpl: f.fetchImpl, backoffMs: 0 });
  assert.equal(f.calls.length, 1, 'the character table resolves the candidate; no unrelated tables fetched');
  assert.match(unknown.lines.join('\n'), /remaining tables not requested/);
  assert.deepEqual(installedArtReferences(f.root), []);
});

test('concurrent imports fetch each missing table once', async t => {
  const f = tableFixture(t);
  const results = await Promise.all([importer(f), importer(f)]);
  assert.ok(results.every(r => r.ok && !r.report.dropped?.operators));
  assert.equal(f.calls.length, 6);
});

test('CLI honors offline, source and refresh options and keeps --json stdout parseable', async t => {
  const f = tableFixture(t), output = [];
  for (const [name, bytes] of f.files) f.put(`forge/${name}`, bytes.toString());
  t.mock.method(console, 'log', line => output.push(line));
  t.mock.method(console, 'error', () => {});
  const args = ['import-forge', path.join(f.root, 'forge'), '--root', f.root, '--dry-run', '--json'];
  assert.equal(await pluginMain([...args, '--offline'], { fetchImpl: noFetch }), 0);
  assert.match(JSON.parse(output.pop()).markdown, /Download refused/);
  assert.equal(await pluginMain([...args, '--asset-source=mirror'], { fetchImpl: f.fetchImpl }), 0);
  assert.equal(JSON.parse(output.pop()).dropped?.operators ?? 0, 0);
  assert.match(f.calls[0], /ArknightsGameData/);
  assert.equal(await pluginMain(args, { fetchImpl: noFetch }), 0);
  assert.equal(await pluginMain([...args, '--refresh-index'], { fetchImpl: f.fetchImpl }), 0);
  assert.equal(f.calls.length, 12);
});

test('studio preview/import use the CLI download path and offline flag without opening a port', async t => {
  const f = tableFixture(t);
  const dirs = { publicDir: path.join(f.root, 'public'), pluginsDir: path.join(f.root, 'plugins'), dataDir: path.join(f.root, 'data') };
  fs.mkdirSync(dirs.pluginsDir);
  const registry = createPluginRegistry(dirs);
  const studio = createStudio({ ...dirs, registry, fetch: f.fetchImpl, watch: () => ({ close() {} }) });
  t.after(() => studio.close());
  const body = { files: [...f.files].map(([name, bytes]) => ({ name, data: bytes.toString('base64') })) };
  const call = async (route, offline = false) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ ...body, offline }))]);
    Object.assign(req, { method: 'POST', headers: { host: 'localhost', 'x-sp-studio': studio.key }, socket: { remoteAddress: '127.0.0.1' } });
    let result, status;
    const res = { setHeader() {}, writeHead(code) { status = code; }, end(bytes) { result = JSON.parse(bytes); } };
    await studio.handle(req, res, `/studio/api/forge/${route}`, '');
    assert.equal(status, 200, JSON.stringify(result));
    return result.report;
  };
  const offline = await call('preview', true);
  assert.equal(offline.dropped.operators, 1);
  assert.equal(f.calls.length, 0);
  const preview = await call('preview');
  assert.equal(preview.ok, true);
  assert.equal(preview.dropped?.operators ?? 0, 0);
  assert.equal(f.calls.length, 6);
  assert.equal(fs.existsSync(path.join(dirs.pluginsDir, 'table-test')), false);
  const imported = await call('import');
  assert.equal(imported.wrote, true);
  assert.deepEqual(imported.products, preview.products);
  assert.equal(f.calls.length, 6);
});
