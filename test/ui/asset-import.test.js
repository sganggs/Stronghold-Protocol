import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { hash16 } from '../../server/http/assetIndex.js';
import { rewriteManifest } from '../../server/http/assetViews.js';
import { siteCsp, SIM_WORKER_CSP } from '../../server/http/csp.js';
import { createAssetDownload } from '../../public/js/assetDownload.js';
import {
  IMPORTED_ASSET_CACHE, IMPORTED_ASSET_CACHE_PREFIX, IMPORTED_ASSET_PATH, IMPORTED_INDEX_URL,
  addImportedPaths, askPersistStorage, countImportedFiles, importSupport, listImportedPaths, pruneImportedPaths, shouldServeImportedAsset,
  storagePersisted,
} from '../../public/js/assetCache.js';
import {
  cacheUrlsFor, crc32, createAssetImport, detectAssetPrefix, importedKeepSet, modelHashOf, normalizePackPath,
  openZip, plainRel, planFromManifests, pruneImportedAssets, sha256Hex16,
} from '../../public/js/assetPack.js';

const enc = new TextEncoder();
const bytesOf = (text) => enc.encode(text);

function set16(view, offset, value) { view.setUint16(offset, value, true); }
function set32(view, offset, value) { view.setUint32(offset, value, true); }

/** A tiny zip. `raw` is the uncompressed bytes; `comp` defaults to `raw` (method 0). */
function buildZip(files) {
  const locals = [];
  const cds = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const raw = file.raw instanceof Uint8Array ? file.raw : bytesOf(String(file.raw ?? ''));
    const comp = file.comp || raw;
    const method = file.method ?? 0;
    const crc = file.crc ?? crc32(raw);
    const flags = file.flags ?? 0x800;
    const extra = file.extra || new Uint8Array(0);
    const local = new Uint8Array(30 + name.length + comp.length);
    const lv = new DataView(local.buffer);
    set32(lv, 0, 0x04034b50);
    set16(lv, 4, 20);
    set16(lv, 6, flags);
    set16(lv, 8, method);
    set32(lv, 14, crc);
    set32(lv, 18, file.localComp ?? comp.length);
    set32(lv, 22, file.localUncomp ?? raw.length);
    set16(lv, 26, name.length);
    local.set(name, 30);
    local.set(comp, 30 + name.length);
    locals.push(local);

    const cd = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(cd.buffer);
    set32(cv, 0, 0x02014b50);
    set16(cv, 4, 20);
    set16(cv, 6, 20);
    set16(cv, 8, flags);
    set16(cv, 10, method);
    set32(cv, 16, crc);
    set32(cv, 20, file.cdComp ?? comp.length);
    set32(cv, 24, file.cdUncomp ?? raw.length);
    set16(cv, 28, name.length);
    set16(cv, 30, extra.length);
    set32(cv, 42, file.localOffset ?? offset);
    cd.set(name, 46);
    if (extra.length) cd.set(extra, 46 + name.length);
    cds.push(cd);
    offset += local.length;
  }
  const cdStart = offset;
  const cdSize = cds.reduce((n, part) => n + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  set32(ev, 0, 0x06054b50);
  set16(ev, 8, files.length);
  set16(ev, 10, files.length);
  set32(ev, 12, cdSize);
  set32(ev, 16, cdStart);
  const out = new Uint8Array(cdStart + cdSize + 22);
  let p = 0;
  for (const part of locals) { out.set(part, p); p += part.length; }
  for (const part of cds) { out.set(part, p); p += part.length; }
  out.set(eocd, p);
  return out;
}

function u64(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 0x100000000), true);
}

async function deflateRaw(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function indexFor(map) {
  return {
    hashOf: (rel) => map[rel] || null,
    modelHash(rels) {
      const parts = [];
      for (const rel of rels) {
        if (!map[rel]) return null;
        parts.push(map[rel]);
      }
      return hash16(parts.join('\n'));
    },
  };
}

/**
 * Cache Storage in memory. `keysLimit`: Cache.keys() throws above that many entries, as Chrome's does ("Operation too
 * large", about 15,000 entries). `assets()`: the stored URLs without the import's index entry.
 */
function memoryCache({ keysLimit = Infinity } = {}) {
  const store = new Map();
  const caches = {
    async open(name) {
      assert.equal(name, IMPORTED_ASSET_CACHE);
      return {
        async put(url, response) {
          store.set(String(url), {
            bytes: new Uint8Array(await response.arrayBuffer()),
            type: response.headers.get('content-type'),
          });
        },
        async match(url) {
          const hit = store.get(String(url));
          return hit ? new Response(hit.bytes.slice(), { headers: { 'content-type': hit.type || '' } }) : undefined;
        },
        async keys() {
          if (store.size > keysLimit) throw new DOMException("Failed to execute 'keys' on 'Cache': Operation too large.", 'AbortError');
          return [...store.keys()].map((url) => ({ url }));
        },
        async delete(url) { return store.delete(String(url)); },
      };
    },
    async keys() { return [IMPORTED_ASSET_CACHE]; },
    async delete() { store.clear(); return true; },
  };
  const assets = () => [...store.keys()].filter((url) => url !== IMPORTED_INDEX_URL);
  return { caches, store, assets };
}

function manifestFetch(assets, local = { groups: {} }, fx = null) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, cache: opts?.cache });
    if (url === '/data/assets.json') return Response.json(assets);
    if (url === '/data/local-assets.json') return local === null
      ? new Response('', { status: 404 })
      : Response.json(local);
    if (url === '/data/local-fx.json') return fx === null ? new Response('', { status: 404 }) : Response.json(fx);
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetch, calls };
}

test('sha-256 prefix matches the server, and a model hash is the joined file hashes', async () => {
  const body = bytesOf('spine-page');
  assert.equal(await sha256Hex16(body), hash16(body));
  const parts = ['0123456789abcdef', 'fedcba9876543210', '0011223344556677'];
  assert.equal(await modelHashOf(parts), hash16(parts.join('\n')));
});

test('pack paths reject traversal and directories; a drive prefix is kept for public/', () => {
  assert.equal(normalizePackPath('C:/game/public/assets/a.png'), 'C:/game/public/assets/a.png');
  assert.equal(normalizePackPath('public\\assets\\a.png'), 'public/assets/a.png');
  assert.equal(normalizePackPath('./public/./assets/a.png'), 'public/assets/a.png');
  assert.equal(normalizePackPath('/assets/a.png'), 'assets/a.png');
  assert.equal(normalizePackPath('../assets/a.png'), null);
  assert.equal(normalizePackPath('assets/../../etc/passwd'), null);
  assert.equal(normalizePackPath('dir/'), null);
  assert.equal(normalizePackPath('a\0b'), null);
});

test('prefix detection prefers the public/ folder, then the path as it is', () => {
  const rels = new Set(['assets/a.png', 'fonts/a.woff2']);
  assert.equal(detectAssetPrefix(['Stronghold-Protocol/public/assets/a.png'], rels).id, 'strip');
  assert.equal(detectAssetPrefix(['Stronghold-Protocol/public/assets/a.png'], rels).map('Stronghold-Protocol/public/assets/a.png'), 'assets/a.png');
  assert.equal(detectAssetPrefix(['assets/a.png'], rels).id, 'as-is');
  assert.equal(detectAssetPrefix(['a.png'], rels).id, 'assets');
  assert.equal(detectAssetPrefix(['a.woff2'], new Set(['fonts/a.woff2'])).id, 'fonts');
  assert.equal(detectAssetPrefix(['README.md'], rels), null);
  assert.equal(detectAssetPrefix(['Assets/a.png'], rels), null);
  const tie = ['assets/a.png', 'pack/public/fonts/a.woff2'];
  assert.equal(detectAssetPrefix(tie, rels).id, 'strip');
});

test('zip: stored, deflate, data descriptor, bad crc, unsupported method, truncated, zip64', async () => {
  const raw = bytesOf('stored-bytes');
  const stored = await openZip(buildZip([{ name: 'public/assets/a.png', raw }]));
  assert.equal(stored.ok, true);
  const got = await stored.read(stored.entries[0]);
  assert.equal(got.ok, true);
  assert.deepEqual(got.bytes, raw);

  const comp = await deflateRaw(raw);
  assert.notDeepEqual(comp, raw);
  const deflated = await openZip(buildZip([{ name: 'a.png', raw, comp, method: 8 }]));
  const inflated = await deflated.read(deflated.entries[0]);
  assert.equal(inflated.ok, true);
  assert.deepEqual(inflated.bytes, raw);

  const described = await openZip(buildZip([{
    name: 'a.png', raw, flags: 0x800 | 0x8, localComp: 0, localUncomp: 0,
  }]));
  assert.deepEqual((await described.read(described.entries[0])).bytes, raw);

  const bad = await openZip(buildZip([{ name: 'a.png', raw, crc: 1 }]));
  assert.equal((await bad.read(bad.entries[0])).code, 'bad-entry');
  const weird = await openZip(buildZip([{ name: 'a.png', raw, method: 14 }]));
  assert.equal((await weird.read(weird.entries[0])).code, 'unsupported');
  const broken = await openZip(new Uint8Array([1, 2, 3, 4, 5]));
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 'bad-zip');

  const slip = await openZip(buildZip([{ name: '../secrets.txt', raw }]));
  assert.equal(normalizePackPath(slip.entries[0].name), null);

  const plain = buildZip([{ name: 'a.png', raw }]);
  const cdAt = plain.length - 22 - (46 + enc.encode('a.png').length);
  const entry = await openZip(plain);
  const localSize = 30 + enc.encode('a.png').length + raw.length;
  const cdSize = 46 + enc.encode('a.png').length;
  const extra = new Uint8Array(4 + 24);
  const xv = new DataView(extra.buffer);
  set16(xv, 0, 0x0001);
  set16(xv, 2, 24);
  u64(xv, 4, raw.length);
  u64(xv, 12, raw.length);
  u64(xv, 20, 0);
  const zip64cd = buildZip([{
    name: 'a.png', raw, extra,
    cdComp: 0xffffffff, cdUncomp: 0xffffffff, localOffset: 0xffffffff,
  }]);
  const zip64 = await openZip(zip64cd);
  assert.equal(zip64.ok, true, 'zip64 extra');
  assert.deepEqual((await zip64.read(zip64.entries[0])).bytes, raw);

  const zipped = buildZip([{ name: 'a.png', raw }]);
  const eocdAt = zipped.length - 22;
  const z64 = new Uint8Array(56);
  const zv = new DataView(z64.buffer);
  set32(zv, 0, 0x06064b50);
  u64(zv, 4, 44);
  u64(zv, 24, 1);
  u64(zv, 32, 1);
  u64(zv, 40, cdSize);
  u64(zv, 48, localSize);
  const loc = new Uint8Array(20);
  const lv = new DataView(loc.buffer);
  set32(lv, 0, 0x07064b50);
  u64(lv, 8, eocdAt);
  set32(lv, 16, 1);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  set32(ev, 0, 0x06054b50);
  set16(ev, 8, 0xffff);
  set16(ev, 10, 0xffff);
  set32(ev, 12, 0xffffffff);
  set32(ev, 16, 0xffffffff);
  const wrapped = new Uint8Array(zipped.length - 22 + 56 + 20 + 22);
  wrapped.set(zipped.subarray(0, eocdAt), 0);
  wrapped.set(z64, eocdAt);
  wrapped.set(loc, eocdAt + 56);
  wrapped.set(eocd, eocdAt + 76);
  const opened = await openZip(wrapped);
  assert.equal(opened.ok, true, 'zip64 eocd');
  assert.equal(opened.entries.length, 1);
  assert.deepEqual((await opened.read(opened.entries[0])).bytes, raw);
  assert.ok(cdAt > 0 && entry.ok);
});

test('served spine plan includes the default page and local groups sort like the server', () => {
  const skel = bytesOf('skel');
  const atlas = bytesOf('atlas');
  const png = bytesOf('page');
  const map = {
    'assets/m/a.skel': hash16(skel),
    'assets/m/a.atlas': hash16(atlas),
    'assets/m/a.png': hash16(png),
  };
  const view = rewriteManifest({
    chars: { a: { skel: '/assets/m/a.skel', atlas: '/assets/m/a.atlas' } },
  }, 'assets.json', indexFor(map));
  assert.equal(view.doc.chars.a.textures, undefined);
  const plan = planFromManifests(view.doc, null);
  assert.deepEqual(plan.groups[0].members.map((m) => m.rel), ['assets/m/a.skel', 'assets/m/a.atlas', 'assets/m/a.png']);
  assert.equal(plan.groups[0].hash, hash16([map['assets/m/a.skel'], map['assets/m/a.atlas'], map['assets/m/a.png']].join('\n')));
  assert.equal(plan.files.size, 0);
  assert.equal(plainRel('/assets/m/a.skel'), null);
  assert.equal(plainRel(`${plan.groups[0].members[0].url}?x=1`), null);

  const localMap = {
    'assets/local/t/a.skel': hash16(bytesOf('Lskel')),
    'assets/local/t/a.atlas': hash16(bytesOf('Latlas')),
    'assets/local/t/a.png': hash16(bytesOf('Lpng')),
    'assets/local/emoticon/basic/pic.png': hash16(bytesOf('pic')),
  };
  const local = rewriteManifest({
    groups: {
      'spine/token/a': {
        z_png: { path: '/assets/local/t/a.png', w: 1, h: 1, kind: 'tex' },
        a_skel: { path: '/assets/local/t/a.skel', w: 1, h: 1, kind: 'skel' },
        m_atlas: { path: '/assets/local/t/a.atlas', w: 1, h: 1, kind: 'atlas' },
      },
      'emoticon/basic': {
        pic: { path: '/assets/local/emoticon/basic/pic.png', w: 1, h: 1, kind: 'ui' },
      },
    },
  }, 'local-assets.json', indexFor(localMap));
  const localPlan = planFromManifests(null, local.doc);
  assert.deepEqual(localPlan.groups[0].members.map((m) => m.rel), [
    'assets/local/t/a.skel', 'assets/local/t/a.atlas', 'assets/local/t/a.png',
  ]);
  assert.equal(localPlan.files.has('assets/local/emoticon/basic/pic.png'), true);
  assert.equal(localPlan.groups.some((g) => g.members.some((m) => m.rel.includes('emoticon'))), false);
});

test('import keeps a matching file and its /media alias, and rejects a mismatch', async () => {
  const audio = bytesOf('bgm-bytes');
  const hash = hash16(audio);
  const view = rewriteManifest({ audio: '/assets/audio/bgm/a.mp3' }, 'assets.json', indexFor({
    'assets/audio/bgm/a.mp3': hash,
  }));
  const { caches, store } = memoryCache();
  const { fetch, calls } = manifestFetch(view.doc);
  const imp = createAssetImport({ fetch, caches });
  await imp.start({
    type: 'files',
    files: [{ path: 'setup/public/assets/audio/bgm/a.mp3', read: async () => audio }],
  });
  assert.equal(imp.get().phase, 'complete');
  assert.equal(imp.get().accepted, 1);
  assert.deepEqual(calls.map((c) => c.url), ['/data/assets.json', '/data/local-assets.json', '/data/local-fx.json']);
  const urls = cacheUrlsFor(planFromManifests(view.doc, null).files.get('assets/audio/bgm/a.mp3').url);
  assert.equal(urls[1], `/media/~${hash}/bgm/a`);
  assert.equal(store.has(urls[0]), true);
  assert.equal(store.has(urls[1]), true);
  assert.equal(store.get(urls[0]).type, 'audio/mpeg');

  const wrong = createAssetImport({ fetch, caches: memoryCache().caches });
  const other = memoryCache();
  const bad = createAssetImport({ fetch, caches: other.caches });
  await bad.start({
    type: 'zip',
    data: buildZip([{ name: 'public/assets/audio/bgm/a.mp3', raw: bytesOf('nope') }]),
  });
  assert.equal(bad.get().phase, 'partial');
  assert.equal(bad.get().rejected, 1);
  assert.equal(bad.get().accepted, 0);
  assert.equal(other.store.size, 0);
  assert.equal(wrong.get().phase, 'idle');
});

test('a spine group is stored only when every member matches the model hash', async () => {
  const skel = bytesOf('skel-v');
  const atlas = bytesOf('atlas-v');
  const png = bytesOf('png-v');
  const map = {
    'assets/m/a.skel': hash16(skel),
    'assets/m/a.atlas': hash16(atlas),
    'assets/m/a.png': hash16(png),
  };
  const view = rewriteManifest({
    chars: { a: { skel: '/assets/m/a.skel', atlas: '/assets/m/a.atlas' } },
    also: '/assets/m/a.png',
  }, 'assets.json', indexFor(map));
  const fileUrl = planFromManifests(view.doc, null).files.get('assets/m/a.png').url;
  const modelUrl = planFromManifests(view.doc, null).groups[0].members[2].url;
  assert.notEqual(fileUrl, modelUrl);

  const pack = (pngBytes) => [
    { path: 'public/assets/m/a.skel', read: async () => skel },
    { path: 'public/assets/m/a.atlas', read: async () => atlas },
    { path: 'public/assets/m/a.png', read: async () => pngBytes },
  ];
  const goodCache = memoryCache();
  const good = createAssetImport({ fetch: manifestFetch(view.doc).fetch, caches: goodCache.caches });
  await good.start({ type: 'files', files: pack(png) });
  assert.equal(good.get().phase, 'complete');
  assert.equal(good.get().accepted, 3);
  assert.equal(goodCache.store.has(modelUrl), true);
  assert.equal(goodCache.store.has(fileUrl), true);

  const badCache = memoryCache();
  const bad = createAssetImport({ fetch: manifestFetch(view.doc).fetch, caches: badCache.caches });
  await bad.start({ type: 'files', files: pack(bytesOf('wrong-page')) });
  assert.equal(bad.get().accepted, 0);
  assert.ok(bad.get().rejected >= 2);
  assert.equal(badCache.store.has(modelUrl), false);
  assert.equal(badCache.store.has(fileUrl), false);

  const partCache = memoryCache();
  const part = createAssetImport({ fetch: manifestFetch(view.doc).fetch, caches: partCache.caches });
  await part.start({
    type: 'files',
    files: [
      { path: 'public/assets/m/a.skel', read: async () => skel },
      { path: 'public/assets/m/a.atlas', read: async () => atlas },
    ],
  });
  assert.equal(part.get().accepted, 0);
  assert.equal(part.get().rejected, 0);
  assert.equal(partCache.store.size, 0);
  assert.equal(part.get().phase, 'empty');

  const onlyCache = memoryCache();
  const only = createAssetImport({ fetch: manifestFetch(view.doc).fetch, caches: onlyCache.caches });
  await only.start({
    type: 'files',
    files: [{ path: 'assets/m/a.png', read: async () => png }],
  });
  assert.equal(only.get().accepted, 1);
  assert.equal(only.get().phase, 'complete');
  assert.equal(onlyCache.store.has(fileUrl), true);
  assert.equal(onlyCache.store.has(modelUrl), false);
});

test('a file the manifest does not list is skipped, and a bad zip stops the import', async () => {
  const png = bytesOf('one-png');
  const hash = hash16(png);
  const view = rewriteManifest({ a: '/assets/a.png' }, 'assets.json', indexFor({ 'assets/a.png': hash }));
  const { caches, store } = memoryCache();
  const { fetch, calls } = manifestFetch(view.doc, null);
  const imp = createAssetImport({ fetch, caches });
  await imp.start({
    type: 'zip',
    data: buildZip([
      { name: 'Stronghold-Protocol/public/assets/a.png', raw: png },
      { name: 'Stronghold-Protocol/public/README.md', raw: bytesOf('nope') },
      { name: 'Stronghold-Protocol/public/assets/a.png', raw: png },
    ]),
  });
  assert.equal(imp.get().phase, 'complete');
  assert.equal(imp.get().accepted, 1);
  assert.ok(imp.get().skipped >= 2);
  assert.deepEqual([...store.keys()].filter((url) => url !== IMPORTED_INDEX_URL).length, 1);
  assert.equal(calls.length, 3);   // assets.json, local-assets.json, local-fx.json (DESIGN §33)
  assert.equal(imp.get().localMissing, undefined);

  const broken = createAssetImport({ fetch, caches });
  await broken.start({ type: 'zip', data: new Uint8Array([9, 9, 9]) });
  assert.equal(broken.get().phase, 'error');
  assert.equal(broken.get().error, 'bad-zip');

  const other = bytesOf('other-png');
  const both = rewriteManifest({ a: '/assets/a.png', b: '/assets/b.png' }, 'assets.json', indexFor({
    'assets/a.png': hash, 'assets/b.png': hash16(other),
  }));
  const unsupported = createAssetImport({ fetch: manifestFetch(both.doc).fetch, caches: memoryCache().caches });
  await unsupported.start({
    type: 'zip',
    data: buildZip([
      { name: 'public/assets/a.png', raw: png },
      { name: 'public/assets/b.png', raw: other, method: 12 },
    ]),
  });
  assert.equal(unsupported.get().accepted, 1);
  assert.equal(unsupported.get().unsupported, 1);
  assert.equal(unsupported.get().failed, 0);
  assert.equal(unsupported.get().phase, 'complete');
});

test('cancel keeps bytes already accepted and does not store the file still being read', async () => {
  const a = bytesOf('file-a');
  const b = bytesOf('file-b');
  const view = rewriteManifest({
    a: '/assets/a.png', b: '/assets/b.png',
  }, 'assets.json', indexFor({ 'assets/a.png': hash16(a), 'assets/b.png': hash16(b) }));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { caches, assets } = memoryCache();
  const imp = createAssetImport({ fetch: manifestFetch(view.doc).fetch, caches });
  const run = imp.start({
    type: 'files',
    files: [
      { path: 'assets/a.png', read: async () => a },
      { path: 'assets/b.png', read: async () => { await gate; return b; } },
    ],
  });
  for (let i = 0; i < 50 && imp.get().accepted < 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(imp.get().accepted, 1);
  imp.cancel();
  release();
  await run;
  assert.equal(imp.get().phase, 'cancelled');
  assert.equal(assets().length, 1);
  assert.deepEqual([...await listImportedPaths(caches)], [new URL(assets()[0], 'http://x').pathname], 'a cancelled import indexes what it stored');
});

test('the download queue does not request a URL the import cache already has', async () => {
  const calls = [];
  const queue = createAssetDownload({
    lookupImported: async () => new Set(['/media/~1234567890abcdef/bgm/a']),
    fetch: async (url) => {
      calls.push(url);
      if (url === '/data/assets.json') return Response.json({ audio: '/assets/~1234567890abcdef/audio/bgm/a.mp3' });
      if (url === '/data/local-assets.json') return Response.json({ groups: {} });
      if (url === '/data/local-fx.json') return new Response('', { status: 404 });
      return new Response('x', { headers: { 'content-type': 'application/octet-stream' } });
    },
  });
  await queue.start();
  assert.equal(queue.get().phase, 'complete');
  assert.equal(queue.get().cached, 1);
  assert.equal(queue.get().bytes, 0);
  assert.equal(calls.includes('/media/~1234567890abcdef/bgm/a'), false);
});

test('the worker answers only hashed asset GET, and its copy matches the module', async () => {
  const sw = fs.readFileSync(path.resolve('public/sw.js'), 'utf8');
  assert.ok(sw.includes(`const IMPORTED_ASSET_CACHE = '${IMPORTED_ASSET_CACHE}';`));
  assert.ok(sw.includes(`const IMPORTED_ASSET_CACHE_PREFIX = '${IMPORTED_ASSET_CACHE_PREFIX}';`));
  assert.ok(sw.includes(`const IMPORTED_ASSET_PATH = ${IMPORTED_ASSET_PATH};`));
  assert.equal(sw.includes('.put('), false);

  const origin = 'http://127.0.0.1:9';
  const deleted = [];
  const fetched = [];
  const stored = new Map([[`${origin}/assets/~0123456789abcdef/hit.png`, 'cached-bytes']]);
  let skipWaiting = 0;
  let claimed = 0;
  const listeners = {};
  const sandbox = {
    self: {
      location: { origin },
      addEventListener(type, fn) { listeners[type] = fn; },
      skipWaiting() { skipWaiting++; return Promise.resolve(); },
      clients: { claim() { claimed++; return Promise.resolve(); } },
    },
    caches: {
      async open() {
        return {
          async match(request, options) {
            // exact keys only (the worker never asks for ignoreSearch: Chrome scans every entry for it)
            assert.equal(options, undefined);
            const key = typeof request === 'string' ? request : request.url;
            const hit = stored.get(key);
            return hit ? new Response(hit) : undefined;
          },
          async put() { throw new Error('network responses must not be cached'); },
        };
      },
      async keys() { return ['sp-imported-assets-v0', IMPORTED_ASSET_CACHE, 'other-cache']; },
      async delete(name) { deleted.push(name); return true; },
    },
    fetch: async (request) => {
      fetched.push(request.url);
      return new Response('from-network');
    },
    URL: globalThis.URL,
    Response: globalThis.Response,
    Promise: globalThis.Promise,
  };
  vm.runInNewContext(sw, sandbox, { filename: 'public/sw.js' });
  const install = {};
  listeners.install({ waitUntil(p) { install.p = p; } });
  await install.p;
  assert.equal(skipWaiting, 1);
  const activate = {};
  listeners.activate({ waitUntil(p) { activate.p = p; } });
  await activate.p;
  assert.deepEqual(deleted, ['sp-imported-assets-v0']);
  assert.equal(claimed, 1);

  const cases = [
    ['GET', `${origin}/assets/~0123456789abcdef/a.png`],
    ['GET', `${origin}/fonts/~0123456789abcdef/a.woff2`],
    ['GET', `${origin}/media/~0123456789abcdef/bgm/a`],
    ['GET', `${origin}/`],
    ['GET', `${origin}/index.html`],
    ['GET', `${origin}/js/main.js`],
    ['GET', `${origin}/data/assets.json`],
    ['GET', `${origin}/sim/worker.js`],
    ['GET', `${origin}/ws`],
    ['GET', `${origin}/assets/plain.png`],
    ['POST', `${origin}/assets/~0123456789abcdef/a.png`],
    ['GET', `http://evil.test/assets/~0123456789abcdef/a.png`],
    ['GET', `${origin}/assets/~0123456789abcdef/../secret`],
  ];
  // The three in-scope URLs are cache misses. respondWith starts the fetch
  // immediately, so drain those promises before counting later requests.
  const pending = [];
  for (const [method, url] of cases) {
    const request = new Request(url, { method });
    let responded = null;
    listeners.fetch({ request, respondWith(p) { responded = p; } });
    assert.equal(responded != null, shouldServeImportedAsset(request, origin), url);
    if (responded) pending.push(responded);
  }
  await Promise.all(pending);
  const ranged = new Request(`${origin}/assets/~0123456789abcdef/a.png`, { headers: { Range: 'bytes=0-1' } });
  let rangedResponse = null;
  listeners.fetch({ request: ranged, respondWith(p) { rangedResponse = p; } });
  assert.equal(rangedResponse, null);
  assert.equal(shouldServeImportedAsset(ranged, origin), false);

  const fetchedBeforeHit = fetched.length;
  const hit = new Request(`${origin}/assets/~0123456789abcdef/hit.png`);
  let hitPromise = null;
  listeners.fetch({ request: hit, respondWith(p) { hitPromise = p; } });
  assert.equal(await (await hitPromise).text(), 'cached-bytes');
  assert.equal(fetched.length, fetchedBeforeHit);
  const withQuery = new Request(`${origin}/assets/~0123456789abcdef/hit.png?x=1`);
  let queryPromise = null;
  listeners.fetch({ request: withQuery, respondWith(p) { queryPromise = p; } });
  assert.equal(await (await queryPromise).text(), 'cached-bytes', 'a query string still finds the imported entry');
  assert.equal(fetched.length, fetchedBeforeHit);
  assert.equal(/ignoreSearch\s*:/.test(sw), false, 'no ignoreSearch option: Chrome scans every entry for it');

  const miss = new Request(`${origin}/assets/~0123456789abcdef/miss.png`);
  let missPromise = null;
  listeners.fetch({ request: miss, respondWith(p) { missPromise = p; } });
  assert.equal(await (await missPromise).text(), 'from-network');
  assert.equal(fetched.length, fetchedBeforeHit + 1);
  assert.equal(fetched.at(-1), miss.url);
});

test('site CSP keeps worker-src self and blob, and the sim worker policy does not gain the asset worker', () => {
  const csp = siteCsp(path.resolve('public'));
  const worker = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('worker-src '));
  const tokens = worker.slice('worker-src '.length).split(/\s+/);
  assert.ok(tokens.includes("'self'"));
  assert.ok(tokens.includes('blob:'));
  assert.equal(tokens.some((token) => token === '*' || token.startsWith('http:') || token.startsWith('https:')), false);
  assert.equal(SIM_WORKER_CSP.includes('worker-src'), false);
  assert.equal(SIM_WORKER_CSP.includes('/sw.js'), false);
  assert.equal(importSupport({ serviceWorker: {} }, false).reason, 'insecure');
  assert.equal(importSupport({}, true).ok, false);
});

test('mergeLocalManifests: the effects manifest\'s groups join the local ones for the import plan (DESIGN §33)', async () => {
  const { mergeLocalManifests } = await import('../../public/js/assetPack.js');
  assert.equal(mergeLocalManifests(null, null), null);
  const merged = mergeLocalManifests({ groups: { scene: { a: { path: '/assets/~0123456789abcdef/local/scene/a.bin' } } } },
    { format: 'fx-manifest', groups: { 'fx/tex': { t: { path: '/assets/~fedcba9876543210/local/fx/tex/t.webp' } } } });
  assert.deepEqual(Object.keys(merged.groups).sort(), ['fx/tex', 'scene']);
  const plan = planFromManifests({}, merged);
  assert.ok(plan.rels.has('assets/local/fx/tex/t.webp'));
  assert.ok(plan.rels.has('assets/local/scene/a.bin'));
});

test('a whole pack is too large for Cache.keys() in Chrome: the import\'s index keeps the count and the download queue\'s skips', async () => {
  const files = Array.from({ length: 12 }, (_, i) => bytesOf(`file-${i}`));
  const manifest = Object.fromEntries(files.map((_, i) => [`f${i}`, `/assets/f${i}.png`]));
  const map = Object.fromEntries(files.map((b, i) => [`assets/f${i}.png`, hash16(b)]));
  manifest.audio = '/assets/audio/bgm/a.mp3';
  const audio = bytesOf('bgm');
  map['assets/audio/bgm/a.mp3'] = hash16(audio);
  const view = rewriteManifest(manifest, 'assets.json', indexFor(map));
  // keys() refuses more than 5 entries here, as Chrome refuses some 15,000: 12 files and the audio twice are 14
  const mem = memoryCache({ keysLimit: 5 });
  const imp = createAssetImport({ fetch: manifestFetch(view.doc).fetch, caches: mem.caches });
  await imp.start({ type: 'files', files: [
    ...files.map((b, i) => ({ path: `public/assets/f${i}.png`, read: async () => b })),
    { path: 'public/assets/audio/bgm/a.mp3', read: async () => audio },
  ] });
  assert.equal(imp.get().phase, 'complete');
  assert.equal(imp.get().accepted, 13);
  assert.equal(mem.assets().length, 14, '12 images, the audio and its /media/ alias');
  await assert.rejects(async () => (await mem.caches.open(IMPORTED_ASSET_CACHE)).keys(), /Operation too large/);
  const paths = await listImportedPaths(mem.caches);
  assert.equal(paths.size, 14);
  assert.ok(paths.has(`/media/~${hash16(audio)}/bgm/a`));
  assert.equal(await countImportedFiles(mem.caches), 13, '/assets/ and /fonts/ only, not the /media/ alias');

  const requested = [];
  const queue = createAssetDownload({
    lookupImported: () => listImportedPaths(mem.caches),
    fetch: async (url) => {
      if (url === '/data/assets.json') return Response.json(view.doc);
      if (url === '/data/local-assets.json' || url === '/data/local-fx.json') return new Response('', { status: 404 });
      requested.push(url);
      return new Response('x', { headers: { 'content-type': 'application/octet-stream' } });
    },
  });
  await queue.start();
  assert.equal(queue.get().phase, 'complete');
  assert.equal(queue.get().cached, 13);
  assert.deepEqual(requested, [], 'nothing imported is downloaded again');
});

test('the import index merges imports, seeds itself from the keys once, and never lists itself', async () => {
  const mem = memoryCache();
  const cache = await mem.caches.open(IMPORTED_ASSET_CACHE);
  await cache.put('/assets/~0123456789abcdef/old.png', new Response('old'));
  assert.deepEqual([...await listImportedPaths(mem.caches)], ['/assets/~0123456789abcdef/old.png'], 'no index: the keys');
  await addImportedPaths(cache, ['/assets/~1111111111111111/a.png', IMPORTED_INDEX_URL]);
  await addImportedPaths(cache, ['/fonts/~2222222222222222/b.woff2']);
  assert.deepEqual([...await listImportedPaths(mem.caches)].sort(), [
    '/assets/~0123456789abcdef/old.png', '/assets/~1111111111111111/a.png', '/fonts/~2222222222222222/b.woff2',
  ]);
  assert.equal(await countImportedFiles(mem.caches), 3);
  assert.ok(!IMPORTED_ASSET_PATH.test(IMPORTED_INDEX_URL), 'the worker never answers the index');
  await cache.put(IMPORTED_INDEX_URL, new Response('not json'));
  assert.deepEqual([...await listImportedPaths(mem.caches)], ['/assets/~0123456789abcdef/old.png'], 'a broken index falls back to the keys (the one stored file)');
});

test('a zip File is read in slices, never whole: the same entries and bytes as from memory, and the import accepts it', async () => {
  const big = new Uint8Array(150_000).map((_, i) => (i * 7) & 0xff);      // > the 64 KB tail the reader looks at
  const text = bytesOf('deflated-bytes '.repeat(40));
  const comp = await deflateRaw(text);
  const zipBytes = buildZip([
    { name: 'pack/public/assets/big.bin', raw: big },
    { name: 'pack/public/assets/t.json', raw: text, comp, method: 8 },
    { name: 'pack/public/assets/bad.png', raw: bytesOf('crc'), crc: 1 },
    { name: 'pack/README.txt', raw: bytesOf('readme') },
  ]);
  const real = new Blob([zipBytes]);
  const slices = [];
  const file = {
    size: real.size,
    slice: (a, b) => { slices.push([a, b]); return real.slice(a, b); },
    stream: () => { throw new Error('the whole file was streamed'); },
    arrayBuffer: () => { throw new Error('the whole file was read'); },
  };
  const zip = await openZip(file);
  const mem = await openZip(zipBytes);
  assert.equal(zip.ok, true);
  assert.deepEqual(zip.entries, mem.entries);
  for (const entry of zip.entries) assert.deepEqual(await zip.read(entry), await mem.read(entry), entry.name);
  assert.ok(slices.length > 0 && slices.every(([a, b]) => b - a < zipBytes.length), 'no read spans the file');
  assert.deepEqual((await openZip({ ...file, size: 10 })).code, 'bad-zip');

  const view = rewriteManifest({ big: '/assets/big.bin', t: '/assets/t.json', bad: '/assets/bad.png' }, 'assets.json', indexFor({
    'assets/big.bin': hash16(big), 'assets/t.json': hash16(text), 'assets/bad.png': hash16(bytesOf('crc')),
  }));
  const mc = memoryCache();
  const imp = createAssetImport({ fetch: manifestFetch(view.doc).fetch, caches: mc.caches });
  await imp.start({ type: 'zip', data: file });
  assert.deepEqual({ accepted: imp.get().accepted, failed: imp.get().failed, skipped: imp.get().skipped }, { accepted: 2, failed: 1, skipped: 1 },
    'big.bin and t.json stored, bad.png unreadable (its CRC), the README skipped');
  assert.equal(mc.assets().length, 2);
});

test('设置 → 素材存储 reads and asks through StorageManager, and answers null where the browser cannot say', async () => {
  assert.equal(await storagePersisted({}), null, 'no StorageManager: plain http to a LAN IP, or an old browser');
  assert.equal(await storagePersisted({ storage: { persisted: async () => true } }), true);
  assert.equal(await storagePersisted({ storage: { persisted: async () => false } }), false);
  assert.equal(await storagePersisted({ storage: { persisted: async () => { throw new Error('blocked'); } } }), null);
  assert.equal(await askPersistStorage({}), null);
  assert.equal(await askPersistStorage({ storage: { persist: async () => false } }), false, 'a refusal is false, not null');
  assert.equal(await askPersistStorage({ storage: { persist: async () => true } }), true);
});

test('清理旧版本素材 keeps what the current manifests name, the audio alias included, and deletes the rest', async () => {
  const mem = memoryCache();
  const cache = await mem.caches.open(IMPORTED_ASSET_CACHE);
  const keepPng = '/assets/~1111111111111111/char/a.png', oldPng = '/assets/~0000000000000000/char/a.png';
  const keepMp3 = '/assets/~2222222222222222/audio/bgm/x.mp3', keepMedia = '/media/~2222222222222222/bgm/x';
  const oldMp3 = '/assets/~3333333333333333/audio/bgm/x.mp3', oldMedia = '/media/~3333333333333333/bgm/x';
  const all = [keepPng, oldPng, keepMp3, keepMedia, oldMp3, oldMedia];
  for (const u of all) await cache.put(u, new Response('x'));
  await addImportedPaths(cache, all);
  const keep = importedKeepSet({ chars: { a: { avatar: keepPng } }, audio: { bgm: { x: keepMp3 } } }, null, null);
  assert.ok([keepPng, keepMp3, keepMedia].every((u) => keep.has(u)), [...keep].join(' '));
  assert.deepEqual(await pruneImportedPaths(keep, mem.caches), { removed: 3, removedFiles: 2, kept: 3 }, 'the .mp3 and its alias are one file');
  assert.deepEqual(mem.assets().sort(), [keepMp3, keepPng, keepMedia].sort());
  assert.deepEqual([...await listImportedPaths(mem.caches)].sort(), [keepMp3, keepMedia, keepPng].sort(), 'the index lists what remains');
  assert.deepEqual(await pruneImportedPaths(keep, mem.caches), { removed: 0, removedFiles: 0, kept: 3 }, 'a second run finds nothing');
});

test('清理旧版本素材 deletes nothing when a served manifest cannot be read', async () => {
  const mem = memoryCache();
  const cache = await mem.caches.open(IMPORTED_ASSET_CACHE);
  await cache.put('/assets/~0000000000000000/a.png', new Response('x'));
  await addImportedPaths(cache, ['/assets/~0000000000000000/a.png']);
  const html = async (url) => (url === '/data/assets.json'
    ? new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 }));
  const broken = async () => new Response('', { status: 500 });
  for (const fetch of [html, broken]) {
    await assert.rejects(pruneImportedAssets({ fetch, caches: mem.caches }), { code: 'manifest' });
    assert.deepEqual(mem.assets(), ['/assets/~0000000000000000/a.png']);
  }
});

