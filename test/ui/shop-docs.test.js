// test/ui/shop-docs.test.js — the theme pack documents the WebGL shop consumes (ui/prefab/shopDocs.js).
// Add-only: the loader reads the installed official group entries through officialAssetUrl; a group without
// shop.json/card.json/prefabs.json has no WebGL shop capability (the gate keeps the DOM bar). The cases that need
// no files on disk use in-memory fixtures: public/assets/local is git-ignored, so CI has no official pack (the
// installed-pack case at the bottom skips itself there).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shopDocsCapability, themeShopDocs, themeFonts } from '../../public/js/ui/prefab/shopDocs.js';
import { packJson } from '../../public/js/ui/prefab/view.js';
import { createThemeLibrary } from '../../public/js/uiTheme.js';
import { stubFetch as fetchStub } from '../helpers/fetchStub.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const GROUP = 'themes/ac_s_closur';
const DOCS = ['prefabs.json', 'card.json', 'shop.json'];

/** Minimal stand-ins for the extractor's documents (the shapes themeShopDocs / makePack read), never official files. */
const FIXTURES = Object.freeze({
  'prefabs.json': {
    spPrefabs: 1,
    prefabs: { panel_shop_main: { root: { name: 'root', children: [], text: { font: 'Novecentowide-Medium' } } } },
    textures: {},
  },
  'card.json': {
    root: { name: 'root', children: [], text: { font: 'NotoSansHans-Medium' } },
    materials: { mat_add: { shader: 'mat_com_add' } },
  },
  'shop.json': { prefabs: { panel_shop_main: { root: { name: 'root', children: [] } } }, materials: {}, textures: {} },
});

/** Group entries of the theme. `tag` keeps each case's URLs apart (packJson caches a document by its URL). */
function groupsFor(names = DOCS, tag = 'fixture') {
  const entries = {};
  for (const name of names) entries[name] = { path: `/assets/local/${GROUP}/${tag}/${name}` };
  entries['sprites/fx.webp'] = { path: `/assets/local/${GROUP}/${tag}/sprites/fx.webp` };
  return { [GROUP]: entries };
}

/** Stub the global fetch: `read(url)` returns the JSON body, or null for a missing document (404). */
const stubFetch = (read = (url) => FIXTURES[String(url).split('/').pop()] ?? null) => fetchStub(read);

function memoryOpen() {
  const rows = new Map();
  return async () => ({
    transaction() {
      const tx = {
        objectStore() {
          return {
            getAll() { return { result: [...rows.values()] }; },
            put(value, key) { rows.set(key, structuredClone(value)); return { result: key }; },
            delete(key) { rows.delete(key); return { result: undefined }; },
          };
        },
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  });
}

function themeLibrary() {
  let n = 0;
  return createThemeLibrary({
    openDb: memoryOpen(),
    measure: async () => ({ ok: true, width: 8, height: 8 }),
    createUrl: () => `blob:shop-docs/${++n}`,
    revokeUrl: () => {},
    revokeDelayMs: 0,
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => null }),
  });
}

/** One stored pack file (an official pack import reads bytes). */
function packFile(rel, body) {
  const bytes = body instanceof Uint8Array ? body : new TextEncoder().encode(body);
  return { path: rel, size: bytes.length, read: async () => bytes };
}

test('capability: the group must carry prefabs.json, card.json and shop.json', () => {
  assert.equal(shopDocsCapability(groupsFor(), 'ac_s_closur'), true);
  assert.equal(shopDocsCapability(groupsFor(['prefabs.json', 'card.json']), 'ac_s_closur'), false);
  assert.equal(shopDocsCapability(groupsFor(['prefabs.json', 'shop.json']), 'ac_s_closur'), false);
  assert.equal(shopDocsCapability(null, 'ac_s_closur'), false);
  assert.equal(shopDocsCapability(groupsFor(), 'not-a-theme'), false);
});

test('themeShopDocs: loads the three documents and the pack through the group entries', async (t) => {
  const groups = groupsFor();
  const stub = stubFetch();
  t.after(() => stub.restore());
  const docs = await themeShopDocs(groups, 'ac_s_closur');
  assert.ok(docs, 'documents found');
  assert.equal(docs.group, GROUP);
  assert.deepEqual(docs.shop.prefabs.panel_shop_main.root.children, [], 'shop panel document');
  assert.equal(docs.card.root.text.font, 'NotoSansHans-Medium', 'card document');
  assert.equal(docs.prefabs.prefabs.panel_shop_main.root.text.font, 'Novecentowide-Medium', 'prefabs document');
  assert.ok(docs.pack && typeof docs.pack.sprite === 'function', 'makePack output');
  const sprite = `/assets/local/${GROUP}/fixture/sprites/fx.webp`;
  assert.equal(docs.pack.sprite('fx'), sprite);
  assert.equal(typeof docs.url, 'function');
  assert.equal(docs.url('sprites/fx.webp'), sprite);
  assert.equal(stub.calls.length, 3, 'one request per document');
});

test('themeShopDocs: a missing document or theme is null (the gate falls back) and is never fetched', async (t) => {
  const stub = stubFetch(() => { throw new Error('an incomplete group must not be fetched'); });
  t.after(() => stub.restore());
  assert.equal(await themeShopDocs(groupsFor(['prefabs.json', 'card.json']), 'ac_s_closur'), null);
  assert.equal(await themeShopDocs(groupsFor(DOCS, 'missing-theme'), 'not-a-theme'), null);
  assert.equal(await themeShopDocs(null, 'ac_s_closur'), null);
  assert.deepEqual(stub.calls, []);
});

test('themeShopDocs: an imported pack reads its documents from the stored bytes, never a blob: URL', async (t) => {
  const lib = themeLibrary();
  t.after(async () => { await lib.remove('ac_s_closur'); });
  const imported = await lib.importEntries([
    packFile('theme.json', JSON.stringify({ spTheme: 1, id: 'ac_s_closur', name: 'in-memory stand-in' })),
    ...DOCS.map((name) => packFile(name, JSON.stringify(FIXTURES[name]))),
    packFile('sprites/fx.webp', Uint8Array.of(1)),
  ], 0);
  assert.equal(imported.ok, true, imported.code);
  const groups = lib.importedGroups();
  assert.ok(DOCS.every((name) => String(groups[GROUP]?.[name]?.path).startsWith('blob:')), 'the imported group lists blob: URLs');

  const real = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => { fetched += 1; throw new Error('a blob: document must not be fetched'); };
  t.after(() => { globalThis.fetch = real; });

  const docs = await themeShopDocs(groups, 'ac_s_closur');
  assert.ok(docs, 'documents read from the stored Blobs');
  assert.equal(docs.group, GROUP);
  assert.deepEqual(docs.shop.prefabs.panel_shop_main.root.children, []);
  assert.ok(String(docs.pack.sprite('fx')).startsWith('blob:'), 'the pack resolves the pack’s own sprites');
  assert.equal(fetched, 0);
});

test('packJson: a blob:/data: URL is not fetched, and a failed document is not cached', async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });

  // no bytes for this blob in this page: null, without a request
  let fetched = 0;
  globalThis.fetch = () => { fetched += 1; throw new Error('a blob: document must not be fetched'); };
  assert.equal(await packJson('blob:shop-docs/unregistered'), null);
  assert.equal(fetched, 0);

  // a data: URL carries its document
  assert.deepEqual(await packJson(`data:application/json,${encodeURIComponent('{"inline":true}')}`), { inline: true });
  const base64 = Buffer.from('{"base64":true}', 'utf8').toString('base64');
  assert.deepEqual(await packJson(`data:application/json;base64,${base64}`), { base64: true });
  assert.equal(await packJson('data:application/json,%7B'), null);

  // a served document that 404s is retried by the next call
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1
    ? { ok: false, status: 404, json: async () => null }
    : { ok: true, status: 200, json: async () => ({ retried: true }) });
  const url = `/assets/local/${GROUP}/retry/shop.json`;
  assert.equal(await packJson(url), null);
  assert.deepEqual(await packJson(url), { retried: true }, 'the failure was not cached');
  assert.equal(calls, 2);
});

test('themeFonts: manifest font entries become @font-face sources (no hard-coded font path)', () => {
  const faces = themeFonts({ fonts: {
    NotoSansHansMedium: { path: '/assets/local/fonts/NotoSansHans-Medium.ttf', family: 'NotoSansHans-Medium', weight: 500, kind: 'Font' },
    NovecentowideNormal: { path: '/assets/local/fonts/Novecentowide-Normal.otf', family: 'Novecentowide-Normal', weight: 400, kind: 'Font' },
    ignored: { path: '/assets/local/fonts/x.otf', kind: 'Sprite' },
  } });
  assert.deepEqual(faces.map((face) => face.family), ['NotoSansHans-Medium', 'Novecentowide-Normal']);
  assert.ok(faces.every((face) => face.url.startsWith('/assets/local/fonts/')));
});

// The official theme pack comes from the local client (data/local-assets.json + public/assets/local, git-ignored).
const MANIFEST = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'data/local-assets.json'), 'utf8')); } catch { return null; }
})();
const REAL_GROUP = MANIFEST?.groups?.[GROUP] || null;
const REAL = !!REAL_GROUP && DOCS.every((name) => {
  const path = REAL_GROUP[name]?.path;
  return typeof path === 'string' && existsSync(join(ROOT, 'public', path.replace(/^\//, '')));
});

test('the installed ac_s_closur pack loads its real documents (local extraction)', { skip: !REAL && 'official theme documents not extracted (data/local-assets.json / public/assets are git-ignored)' }, async (t) => {
  /** The real document behind each group URL (the files under public/). */
  const byUrl = new Map(DOCS.map((name) => [REAL_GROUP[name].path, join(ROOT, 'public', REAL_GROUP[name].path.replace(/^\//, ''))]));
  const stub = stubFetch((url) => JSON.parse(readFileSync(byUrl.get(url), 'utf8')));
  t.after(() => stub.restore());
  const docs = await themeShopDocs(MANIFEST.groups, 'ac_s_closur');
  assert.ok(docs);
  assert.equal(docs.group, GROUP);
  assert.equal(docs.prefabs.spPrefabs, 1);
  assert.ok(docs.prefabs.prefabs['shop/panel_shop_main'], 'the prefabs document is parsed');
  assert.ok(docs.shop.prefabs.panel_shop_main, 'the shop document is parsed');
  assert.ok(docs.card.root, 'the card document is parsed');
  assert.equal(stub.calls.length, 3);
});
