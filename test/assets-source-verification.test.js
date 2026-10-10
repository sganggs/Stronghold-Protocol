import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceVerifier } from '../tools/assets/source-verifier.mjs';
import { Downloader } from '../tools/assets/downloader.mjs';
import { cachedJson } from '../tools/assets/cache.mjs';
import { collectLeaves, downloadLeaves, resolveTemplate } from '../tools/assets/manifest.mjs';
import { normalizeAtlas } from '../tools/assets/atlas.mjs';
import { processModels } from '../tools/assets/spine.mjs';
import { buildFonts, FONTS } from '../tools/assets/fonts.mjs';
import { decodeWoff2Tables } from '../tools/assets/woff2.mjs';
import { parseArgs } from '../tools/fetch-assets.mjs';

const quiet = () => {};
const commit = '1'.repeat(40);
const tree = '2'.repeat(40);
const raw = 'https://raw.githubusercontent.com/o/r/main/';
// Independent fixture Git-object digest, not the implementation under test.
const digest = (buf) => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

async function fixture(t, files, { revision = commit, payload = (url) => files[url.split('/').at(-1)], apiStatus = 200 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sp-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers.authorization, 'Bearer test-api-token');
      assert.equal(options.redirect, 'error');
      return Response.json({ truncated: false, tree: Object.entries(files).map(([path, buf]) => ({ path, type: 'blob', sha: digest(buf) })) }, { status: apiStatus });
    }
    assert.equal(new Headers(options?.headers).has('authorization'), false, 'payloads never receive the API token');
    const bytes = payload(url);
    return new Response(bytes ?? null, { status: bytes ? 200 : 404 });
  };
  const verifier = new SourceVerifier({ 'o/r@main': { commit: revision, tree } }, { fetchImpl, token: 'test-api-token' });
  const dl = new Downloader({ root, ledgerPath: join(root, 'ledger.json'), verifier, fetchImpl, retries: 1, backoffMs: 0, log: quiet });
  return { root, dl, verifier, fetchImpl, calls };
}

test('user equal-size stale mirror bytes are rejected before a valid pinned fallback is accepted', async (t) => {
  // Given valid JSON of the same size but different contents from the mirror.
  const good = Buffer.from('{"n":2}');
  const stale = Buffer.from('{"n":1}');
  const f = await fixture(t, { 'a.json': good }, { payload: (url) => url.startsWith('https://proxy.example/') ? stale : good });
  const dl = new Downloader({ root: f.root, ledgerPath: join(f.root, 'ledger.json'), verifier: f.verifier,
    fetchImpl: f.fetchImpl, source: 'mirror', proxyPrefix: 'https://proxy.example/', retries: 1, log: quiet });
  // When the generator downloads a current candidate.
  const result = await dl.run([{ rel: 'a.json', urls: [raw + 'a.json'], kind: 'json' }]);
  // Then only the verified direct fallback reaches disk and logical provenance survives.
  assert.equal(result.get('a.json').status, 'ok');
  assert.deepEqual(await readFile(join(f.root, 'a.json')), good);
  assert.equal(dl.ledger.files['a.json'].url, raw + 'a.json');
  assert.equal(f.calls.filter((u) => !u.startsWith('https://api.')).length, 2);
  assert.ok(f.calls.filter((u) => !u.startsWith('https://api.')).every((u) => u.includes(commit)), 'payload requests are pinned, not branch requests');
});

test('user same-path remapping replaces equal-size bytes despite an old ledger URL', async (t) => {
  const old = Buffer.from('old!');
  const good = Buffer.from('new!');
  const f = await fixture(t, { 'old.bin': old, 'new.bin': good });
  await writeFile(join(f.root, 'asset.bin'), old);
  f.dl.ledger.files['asset.bin'] = { url: raw + 'old.bin', bytes: old.length };
  const result = await f.dl.run([{ rel: 'asset.bin', urls: [raw + 'new.bin', raw + 'old.bin'], kind: 'bin' }]);
  assert.equal(result.get('asset.bin').status, 'ok');
  assert.deepEqual(await readFile(join(f.root, 'asset.bin')), good);
  assert.equal(f.dl.ledger.files['asset.bin'].url, raw + 'new.bin');
});

test('user failed replacement removes old output and cannot resolve an unverified cached alternative', async (t) => {
  const good = Buffer.from('new!');
  const f = await fixture(t, { 'a.bin': good, 'fallback.bin': good }, { payload: () => Buffer.from('old!') });
  await writeFile(join(f.root, 'a.bin'), 'old!');
  await writeFile(join(f.root, 'fallback.bin'), good);
  const template = { item: { alts: [
    { rel: 'a.bin', urls: [raw + 'a.bin'], kind: 'bin' },
    { rel: 'fallback.bin', urls: [raw + 'fallback.bin'], kind: 'bin' },
  ] } };
  assert.deepEqual(await downloadLeaves(collectLeaves(template), f.dl, f.root), ['item']);
  await assert.rejects(access(join(f.root, 'a.bin')), { code: 'ENOENT' });
  assert.equal(f.dl.ledger.files['a.bin'], undefined);
  const resolved = resolveTemplate(template, { root: f.root, spine: new Map(), available: (rel) => f.dl.accepted.has(rel) });
  assert.deepEqual(resolved.droppedLeaves, ['item']);
});

test('user source revisions reuse unchanged raw bytes but replace same-size changed bytes and refresh the ledger', async (t) => {
  const good = Buffer.from('unchanged');
  const revision = '3'.repeat(40);
  for (const [cached, status, requests] of [[good, 'skip', 1], [Buffer.from('outdated!'), 'ok', 2]]) {
    const f = await fixture(t, { 'a.bin': good }, { revision });
    await writeFile(join(f.root, 'a.bin'), cached);
    f.dl.ledger.files['a.bin'] = { url: raw + 'a.bin', bytes: good.length, commit };
    const result = await f.dl.run([{ rel: 'a.bin', urls: [raw + 'a.bin'], kind: 'bin' }]);
    assert.equal(result.get('a.bin').status, status);
    assert.equal(f.calls.length, requests, 'unchanged raw bytes need metadata only; same-size changes need a new payload');
    assert.deepEqual(await readFile(join(f.root, 'a.bin')), good);
    const ledger = JSON.parse(await readFile(join(f.root, 'ledger.json'), 'utf8'));
    assert.equal(ledger.files['a.bin'].commit, revision);
    assert.equal(ledger.files['a.bin'].blob, digest(good));
  }
});

test('user stale JSON index is verified before parsing and cannot drive the plan', async (t) => {
  const good = Buffer.from('{"plan":"new"}');
  const stale = Buffer.from('{"plan":"old"}');
  const f = await fixture(t, { 'index.json': good }, { payload: (url) => url.startsWith('https://proxy.example/') ? stale : good });
  const cacheFile = join(f.root, 'index.json');
  await writeFile(cacheFile, stale);
  const index = await cachedJson({ cacheFile, url: raw + 'index.json', verifier: f.verifier, fetchImpl: f.fetchImpl,
    source: 'mirror', proxyPrefix: 'https://proxy.example/', log: quiet, backoffMs: 0 });
  assert.deepEqual(index, { plan: 'new' });
  assert.deepEqual(await readFile(cacheFile), good);
  const calls = f.calls.length;
  assert.deepEqual(await cachedJson({ cacheFile, url: raw + 'index.json', verifier: f.verifier, fetchImpl: f.fetchImpl }), { plan: 'new' });
  assert.equal(f.calls.length, calls, 'a verified unchanged index is reused without fetching payloads or repeated tree metadata');
});

test('user source API failure fails closed even for matching cached assets and indexes', async (t) => {
  const good = Buffer.from('{"n":2}');
  const f = await fixture(t, { 'a.json': good }, { apiStatus: 503 });
  const cacheFile = join(f.root, 'a.json');
  await writeFile(cacheFile, good);
  const result = await f.dl.run([{ rel: 'a.json', urls: [raw + 'a.json'], kind: 'json' }]);
  assert.equal(result.get('a.json').status, 'error');
  assert.match(result.get('a.json').error, /source tree API HTTP 503/);
  await assert.rejects(access(cacheFile), { code: 'ENOENT' });
  await writeFile(cacheFile, good);
  await assert.rejects(cachedJson({ cacheFile, url: raw + 'a.json', verifier: f.verifier, fetchImpl: f.fetchImpl }), /source tree API HTTP 503/);
  await assert.rejects(access(cacheFile), { code: 'ENOENT' });
});

test('user mutable atlas is fetched and verified raw before existing normalization', async (t) => {
  const good = Buffer.from('page.png\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n');
  const stale = Buffer.from(good.toString().replace('1,1', '9,9'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
  const f = await fixture(t, { 'model.atlas': good, 'page.png': png }, {
    payload: (url) => url.endsWith('page.png') ? png : url.startsWith('https://proxy.example/') ? stale : good,
  });
  const normalized = normalizeAtlas(stale.toString(), { pageSize: () => ({ width: 2, height: 2 }), pma: true });
  await writeFile(join(f.root, 'model.atlas'), normalized.text);
  const dl = new Downloader({ root: f.root, ledgerPath: join(f.root, 'ledger.json'), verifier: f.verifier, fetchImpl: f.fetchImpl,
    source: 'mirror', proxyPrefix: 'https://proxy.example/', log: quiet, retries: 1 });
  const result = await dl.run([{ rel: 'model.atlas', urls: [raw + 'model.atlas'], kind: 'atlas', mutable: true }]);
  assert.equal(result.get('model.atlas').status, 'ok');
  assert.deepEqual(await readFile(join(f.root, 'model.atlas')), good);
  const next = normalizeAtlas((await readFile(join(f.root, 'model.atlas'))).toString(), { pageSize: () => ({ width: 2, height: 2 }), pma: true });
  assert.match(next.text, /pma: true/);
  assert.equal(dl.ledger.files['model.atlas'].url, raw + 'model.atlas', 'page derivation uses logical branch URL');
  // The real Spine follow-up must derive an unlisted page using the logical URL, not the pinned transport URL.
  const model = { key: 'model', dir: '', baseUrl: raw, pngs: [],
    skel: { rel: 'model.skel', urls: [raw + 'missing.skel'], kind: 'skel' },
    atlas: { rel: 'model.atlas', urls: [raw + 'model.atlas'], kind: 'atlas', mutable: true } };
  await processModels(new Map([['model', model]]), { root: f.root, dl, cachePath: join(f.root, 'spine.json'), log: quiet });
  assert.deepEqual(await readFile(join(f.root, 'page.png')), png);
  assert.equal(dl.ledger.files['page.png'].url, raw + 'page.png');
});

// A minimal SFNT with one independently readable table, sufficient for the font converter.
function font(value) {
  const buf = Buffer.alloc(32);
  buf.write('OTTO'); buf.writeUInt16BE(1, 4); buf.write('CFF ', 12);
  buf.writeUInt32BE(28, 20); buf.writeUInt32BE(4, 24); buf.write(value, 28);
  return buf;
}

test('user changed font originals are verified before WOFF2 generation and failed fonts lose generated outputs', async (t) => {
  const good = font('new!');
  const stale = font('old!');
  let available = true;
  const f = await fixture(t, { 'font.otf': good }, { payload: () => available ? good : stale });
  const name = FONTS[0].name;
  await writeFile(join(f.root, name + '.otf'), stale);
  await writeFile(join(f.root, name + '.woff2'), 'stale generated');
  await writeFile(join(f.root, 'fonts.css'), 'stale css');
  await f.dl.run([{ rel: name + '.otf', urls: [raw + 'font.otf'], kind: 'font' }]);
  const built = await buildFonts(f.root, quiet, { verified: true });
  assert.ok(built.files[name].woff2);
  const tables = decodeWoff2Tables(await readFile(join(f.root, name + '.woff2')));
  assert.equal(tables.tables[0].data.toString(), 'new!');
  available = false;
  const forceDl = new Downloader({ root: f.root, ledgerPath: join(f.root, 'ledger.json'), verifier: f.verifier,
    fetchImpl: f.fetchImpl, force: true, retries: 1, backoffMs: 0, log: quiet });
  const result = await forceDl.run([{ rel: name + '.otf', urls: [raw + 'font.otf'], kind: 'font' }]);
  assert.equal(result.get(name + '.otf').status, 'error');
  await assert.rejects(access(join(f.root, name + '.otf')), { code: 'ENOENT' });
  const failed = await buildFonts(f.root, quiet, { verified: true });
  assert.deepEqual(failed.files, {});
  await assert.rejects(access(join(f.root, name + '.woff2')), { code: 'ENOENT' });
  await assert.rejects(access(join(f.root, 'fonts.css')), { code: 'ENOENT' });
});

test('user truncated or unavailable recursive Git tree uses complete bounded subtrees', async () => {
  const sha = digest(Buffer.from('ok'));
  const subtree = '4'.repeat(40);
  for (const recursiveStatus of [200, 500]) {
    const calls = [];
    const verifier = new SourceVerifier({ 'o/r@main': { commit, tree } }, { token: '', fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith(tree + '?recursive=1')) return Response.json({ truncated: true, tree: [{ path: 'dir/a.bin', type: 'blob', sha: '5'.repeat(40) }] }, { status: recursiveStatus });
      if (url.endsWith(tree)) return Response.json({ truncated: false, tree: [{ path: 'dir', type: 'tree', sha: subtree }] });
      assert.ok(url.endsWith(subtree + '?recursive=1'));
      return Response.json({ truncated: false, tree: [{ path: 'a.bin', type: 'blob', sha }] });
    } });
    assert.equal((await verifier.resolve(raw + 'dir/a.bin')).blob, sha);
    assert.equal(await verifier.resolve(raw + 'dir/missing.bin'), null);
    assert.equal(calls.length, 3, 'complete subtrees are memoized; partial recursive entries are never used');
    await assert.rejects(verifier.resolve(raw + 'dir/'.repeat(65) + 'a.bin'), /traversal limit/);
  }
});

test('user malformed tree entries are verification errors rather than optional-source misses', async () => {
  for (const entry of [{ path: 'a.bin', sha: tree }, { type: 'blob', sha: tree }, { path: 'a.bin', type: 'blob', sha: 'bad' }]) {
    const verifier = new SourceVerifier({ 'o/r@main': { commit, tree } }, {
      token: '', fetchImpl: async () => Response.json({ truncated: false, tree: [entry] }),
    });
    await assert.rejects(verifier.resolve(raw + 'a.bin'), /invalid source tree entry/);
  }
});

test('user invalid snapshots and incompatible CLI modes reject clearly', () => {
  for (const flag of ['--offline', '--add-only', '--local-spines']) {
    assert.throws(() => parseArgs(['--source-snapshot=pins.json', flag]), /incompatible/);
  }
  assert.throws(() => parseArgs(['--source-snapshot=']), /requires a path/);
  assert.throws(() => new SourceVerifier({ 'o/r@main': { commit: 'short', tree } }), /invalid source snapshot/);
  assert.equal(parseArgs(['--source-snapshot=a=b.json']).sourceSnapshot, 'a=b.json');
});
