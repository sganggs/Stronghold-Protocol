// test/ui/plugins-client.test.js — the browser side of the cosmetic plugins (DESIGN §32 P1a): the cosmetic layers of
// public/js/assets.js (the installation's manifest → the room's visual set → the personal plugins on top, composed on the
// page's own manifest: every plugin URL built from a set's composition, a URL in a document never drawn, a write that
// does not fit left out and told once, a plugin file that failed to load falling back to the art beneath it; the same
// object while nothing changed; the asset store's helpers and onChange follow them), data.js's view of `assets`,
// public/js/content.js (a visual set's document fetched, parsed and checked against the room's vs — retried when the
// network failed, refused when its composition does not hash to it; the room layer follows room.state.content.vs and
// goes with the room, a late answer for a room left is dropped; the personal plugins come from the catalogue's vs of
// each, a plugin the server lacks is skipped, nothing is fetched while none is switched on), the 插件 panel's facts
// (ui/pluginPanel.js) and the room screen's tag.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCosmeticLayers, createAssets } from '../../public/js/assets.js';
import { loadVisual } from '../../public/js/cosmetics.js';
import { createDataStore } from '../../public/js/data.js';
import { createStore } from '../../public/js/store.js';
import {
  fetchVisualDoc, installContent, installedCount, loadPluginOrder, personal, personalSet, setPersonalPlugin, catalog, loadCatalog, cosmeticPlugins, unofficialPlugins,
  pluginName, PERSONAL_PREF,
} from '../../public/js/content.js';
import { ERR } from '../../shared/constants.js';
import { roomPluginFacts, nextChoice, sizeText, pluginTagText, pluginMicro, companionCosmeticHints } from '../../public/js/ui/pluginPanel.js';
import { visualHashOf, writesHashOf, VISUAL_HASH_VERSION } from '../../shared/plugins/visual.js';
import { sha256Hex } from '../../shared/sha256.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// what composes a set's document loads with the first document (cosmetics.js loadVisual): here before any layer is laid
await loadVisual();

test('P9: active content names installed companion art only while it is off for this player and room', () => {
  const play = { id: 'play-demo', class: 'content', optional: { 'look-demo': '1.0.0', missing: '*', ui: '*' } };
  const look = { id: 'look-demo', class: 'cosmetic', status: 'loaded', scope: ['personal', 'room'], version: '1.0.0', name: 'Look demo' };
  const entries = [play, look, { id: 'ui', class: 'ui', status: 'loaded' }];
  assert.deepEqual(companionCosmeticHints(play, entries, new Set()), ['外观在『Look demo』（设置 → 外观插件）']);
  assert.deepEqual(companionCosmeticHints(play, entries, new Set(['look-demo'])), []);
  assert.deepEqual(companionCosmeticHints(play, [play, { ...look, status: 'blocked' }], new Set()), []);
  assert.deepEqual(companionCosmeticHints({ ...play, optional: undefined }, entries, new Set()), []);
  assert.deepEqual(companionCosmeticHints({ ...play, class: 'cosmetic' }, entries, new Set()), []);
  assert.deepEqual(companionCosmeticHints(play, [play, { ...look, version: '2.0.0' }], new Set()), []);
  assert.deepEqual(personal.get().ids, [], 'the hint never changes personal switches');
});
const BASE = { version: 1, chars: { char_102_texas: { avatar: '/assets/~1111111111111111/texas.png' }, char_112_siege: { avatar: '/assets/siege.png' } } };
const fileSha = (id, rel) => sha256Hex(`${id}:${rel}`);
/** A plugin file's URL as the page builds it from the composition: /p/<id>/<first 8 hex of its SHA-256>/<path>. */
const urlOf = (id, rel) => `/p/${id}/${fileSha(id, rel).slice(0, 8)}/${rel}`;
/** A set's document (server/plugins/visualSet.js) of one plugin: its composition and its writes. */
const setDocOf = (id, ops, files = ['a.png']) => {
  const parts = { assets: 'aa'.repeat(32), overlays: [{ id, version: '1.0.0', files: Object.fromEntries(['plugin.json', ...files].map((rel) => [rel, fileSha(id, rel)])), writes: writesHashOf(ops) }] };
  return { visual: { v: VISUAL_HASH_VERSION, vs: visualHashOf(parts), ...parts }, writes: [{ id, ops }] };
};
/** The room's set of one plugin that paints Texas (its a.png). */
const roomDoc = (id = 'red') => setDocOf(id, [{ at: ['chars', 'char_102_texas', 'avatar'], file: 'a.png' }]);
/** A personal plugin that paints Siege (its `rel`). */
const personalDoc = (id, rel = 'm.png') => setDocOf(id, [{ at: ['chars', 'char_112_siege', 'avatar'], file: rel }], [rel]);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred, what) => { for (let i = 0; i < 200; i++) { if (pred()) return; await tick(); } assert.fail(`timed out: ${what}`); };

describe('the cosmetic layers (public/js/assets.js)', () => {
  test('base → the room\'s set composed on it → personal writes on top; the same object while nothing changed', () => {
    const layers = createCosmeticLayers();
    assert.equal(layers.apply(BASE), BASE, 'no layer: the base itself');
    let told = 0;
    layers.subscribe(() => told++);
    const room = roomDoc();
    layers.setRoom(room);
    const r1 = layers.apply(BASE);
    assert.equal(r1.chars.char_102_texas.avatar, urlOf('red', 'a.png'), 'built from the composition');
    assert.equal(r1.chars.char_112_siege, BASE.chars.char_112_siege, 'what no write touches is the page\'s own');
    layers.setPersonal([{ id: 'mine', doc: personalDoc('mine') }]);
    const eff = layers.apply(BASE);
    assert.equal(eff.chars.char_102_texas.avatar, urlOf('red', 'a.png'), 'the room\'s art');
    assert.equal(eff.chars.char_112_siege.avatar, urlOf('mine', 'm.png'), 'the personal plugin over it');
    assert.equal(BASE.chars.char_112_siege.avatar, '/assets/siege.png', 'the base is never changed');
    assert.equal(layers.apply(BASE), eff, 'memoised');
    layers.setRoom(room);
    assert.equal(told, 2, 'the same room again tells nobody');
    layers.setRoom(null);
    assert.equal(layers.apply(BASE).chars.char_102_texas.avatar, BASE.chars.char_102_texas.avatar, 'the room gone: its art too');
    layers.setPersonal([]);
    assert.equal(layers.apply(BASE), BASE);
    assert.equal(layers.active, false);
  });

  test('the page draws exactly what the vs names: a URL in a document is never taken, a write that does not fit is left out (told once)', () => {
    const layers = createCosmeticLayers();
    const told = [];
    layers.onDrop((why, n) => told.push([n, why.join(' ')]));
    const doc = setDocOf('red', [
      { at: ['chars', 'char_102_texas', 'avatar'], value: 'https://evil.example/track.png' },
      { at: ['chars', 'char_102_texas', 'avatar'], file: 'https://evil.example/a.png' },
      { at: ['chars', 'char_102_texas', 'avatar'], file: 'missing.png' },
      { at: ['chars', 'char_112_siege', 'avatar'], file: 'a.png' },
    ]);
    layers.setRoom(doc);
    const m = layers.apply(BASE);
    assert.equal(m.chars.char_102_texas.avatar, BASE.chars.char_102_texas.avatar, 'the installation\'s art');
    assert.equal(m.chars.char_112_siege.avatar, urlOf('red', 'a.png'));
    assert.doesNotMatch(JSON.stringify(m), /evil/);
    assert.equal(told.length, 1);
    assert.equal(told[0][0], 3);
    layers.setRoom(null);
    layers.setRoom(doc);
    layers.apply(BASE);
    assert.equal(told.length, 1, 'once per document');
    // a reference this page's manifest lacks: left out when laid, told once per change
    layers.setRoom(setDocOf('ref', [{ at: ['chars', 'char_102_texas'], from: ['chars', 'char_000_nobody'], ref: 'char_000_nobody' }]));
    assert.equal(layers.apply(BASE).chars.char_102_texas, BASE.chars.char_102_texas);
    layers.apply(JSON.parse(JSON.stringify(BASE)));
    assert.equal(told.length, 2);
    assert.match(told[1][1], /has no chars\.char_000_nobody/);
  });

  test('a plugin file that failed to load: its entry falls back to the art beneath it — the room\'s under a personal plugin, then the installation\'s', () => {
    const layers = createCosmeticLayers();
    let told = 0;
    layers.subscribe(() => told++);
    layers.setRoom(roomDoc());
    layers.setPersonal([{ id: 'mine', doc: setDocOf('mine', [{ at: ['chars', 'char_102_texas', 'avatar'], file: 'b.png' }], ['b.png']) }]);
    assert.equal(layers.apply(BASE).chars.char_102_texas.avatar, urlOf('mine', 'b.png'));
    told = 0;
    assert.equal(layers.fail(`http://localhost${urlOf('mine', 'b.png')}`), true, 'an <img>\'s absolute src');
    assert.equal(told, 1, 'the listeners re-resolve their art');
    assert.equal(layers.apply(BASE).chars.char_102_texas.avatar, urlOf('red', 'a.png'));
    assert.equal(layers.fail(urlOf('red', 'a.png')), true);
    assert.equal(layers.apply(BASE).chars.char_102_texas.avatar, BASE.chars.char_102_texas.avatar);
    assert.equal(layers.fail(urlOf('red', 'a.png')), false, 'told once');
    assert.equal(layers.fail('/assets/siege.png'), false, 'not a layer\'s file');
    assert.equal(layers.fail('https://elsewhere.example/p/mine/00000000/b.png'), false, 'another origin');
    assert.equal(told, 2);
    assert.deepEqual(layers.failed.sort(), [urlOf('mine', 'b.png'), urlOf('red', 'a.png')].sort());
  });

  test('the memo is per base object: data.js\'s copy and the store\'s each keep theirs', () => {
    const layers = createCosmeticLayers();
    layers.setPersonal([{ id: 'mine', doc: personalDoc('mine') }]);
    const other = JSON.parse(JSON.stringify(BASE));
    const a = layers.apply(BASE);
    const b = layers.apply(other);
    assert.notEqual(a, b);
    assert.equal(layers.apply(BASE), a, 'alternating bases: each still memoised');
    assert.equal(layers.apply(other), b);
    assert.equal(layers.apply(undefined), layers.apply(undefined), 'no manifest yet: one empty base');
  });

  test('the asset store reads through its layers and tells its listeners like a late manifest', () => {
    const layers = createCosmeticLayers();
    const store = createAssets({ manifest: BASE, cosmetics: layers, fetch: async () => res(404, {}) });
    const heard = [];
    store.onChange((w) => heard.push(w));
    assert.equal(store.avatar('char_102_texas'), BASE.chars.char_102_texas.avatar);
    layers.setRoom(roomDoc());
    assert.deepEqual(heard, ['manifest']);
    assert.equal(store.avatar('char_102_texas'), urlOf('red', 'a.png'));
    assert.equal(store.manifest.chars.char_102_texas.avatar, urlOf('red', 'a.png'), 'manifest: what the helpers read');
    assert.equal(createAssets({ manifest: BASE }).avatar('char_102_texas'), BASE.chars.char_102_texas.avatar, 'a store without layers');
  });

  test('data.js shows a file through a view: get() through it, getRaw() as downloaded; setView tells the subscribers', async () => {
    const d = createDataStore({ fetch: async () => res(200, BASE), retryDelays: [], timeoutMs: 0 });
    await d.load('assets');
    const heard = [];
    d.subscribe((n) => heard.push(n));
    const layers = createCosmeticLayers();
    layers.setRoom(roomDoc());
    d.setView('assets', (v) => layers.apply(v));
    assert.deepEqual(heard, ['assets']);
    assert.equal(d.get('assets').chars.char_102_texas.avatar, urlOf('red', 'a.png'));
    assert.equal(d.getRaw('assets').chars.char_102_texas.avatar, BASE.chars.char_102_texas.avatar);
    d.setView('assets', null);
    assert.equal(d.get('assets'), d.getRaw('assets'));
  });
});

describe('content.js', () => {
  test('fetchVisualDoc: /vs/<vs16>/overlay.json as text, parsed, checked against the vs; a network failure or 5xx retried, a 404 or a bad composition refused', async () => {
    const doc = roomDoc();
    const vs = doc.visual.vs;
    const urls = [];
    const ok = await fetchVisualDoc(vs, { fetch: async (u, init) => { urls.push([u, init.cache]); return res(200, doc); } });
    assert.deepEqual(ok, { doc });
    assert.deepEqual(urls, [[`/vs/${vs.slice(0, 16)}/overlay.json`, 'no-cache']]);
    let n = 0;
    const flaky = await fetchVisualDoc(vs, { retryDelays: [0, 0], wait: async () => {}, fetch: async () => { n++; if (n === 1) throw new Error('offline'); if (n === 2) return res(503, ''); return res(200, doc); } });
    assert.deepEqual([flaky.doc === undefined, n], [false, 3]);
    assert.match((await fetchVisualDoc(vs, { fetch: async () => res(404, '') })).error, /HTTP 404/);
    assert.match((await fetchVisualDoc('cd'.repeat(32), { fetch: async () => res(200, doc) })).error, /names another set/);
    assert.match((await fetchVisualDoc(vs, { fetch: async () => res(200, '{"nope') })).error, /not JSON/);
    assert.match((await fetchVisualDoc('short')).error, /no visual hash/);
    // the composition untouched, the writes not the ones its vs names (another file of the table into another slot, a
    // plugin's list twice, a list of a plugin it does not name): refused, nothing thrown
    const other = [{ at: ['chars', 'char_112_siege', 'avatar'], file: 'a.png' }];
    const served = async (writes) => (await fetchVisualDoc(vs, { fetch: async () => res(200, { ...doc, writes }) })).error;
    assert.match(await served([{ id: 'red', ops: other }]), /the writes of red are not the ones its vs names/);
    assert.match(await served([...doc.writes, ...doc.writes]), /not one list per plugin/);
    assert.match(await served([...doc.writes, { id: 'blue', ops: [] }]), /writes of a plugin its composition does not name/);
    assert.match(await served([]), /the writes of red are not the ones its vs names/);
    // an attempt that never answers is given up after the timeout (and tried again like a network error)
    let tries = 0;
    const stalled = await fetchVisualDoc(vs, { timeoutMs: 20, retryDelays: [0], wait: async () => {}, fetch: () => { tries++; return new Promise(() => {}); } });
    assert.deepEqual([stalled.error, tries], [`/vs/${vs.slice(0, 16)}/overlay.json: unreachable`, 2]);
  });

  test('installContent: the room layer follows room.state.content.vs, goes with the room, ignores a late answer, says a failure once', async () => {
    const app = createStore({ room: null });
    const data = createDataStore({ fetch: async () => res(200, BASE), retryDelays: [], timeoutMs: 0 });
    await data.load('assets');
    const layers = createCosmeticLayers();
    const red = roomDoc('red');
    const blue = roomDoc('blue');
    const pending = new Map();
    const fetch = (u) => new Promise((resolve) => pending.set(u, resolve));
    const toasts = [];
    const off = installContent({ store: app, data, layers, fetch, toast: (text, kind) => toasts.push([text, kind]), retryDelays: [] });
    assert.equal(pending.size, 0, 'no room, no personal plugin: nothing is fetched');
    app.set({ room: { code: 'ABCD', content: { cs: 'ee'.repeat(32), vanilla: true, vs: red.visual.vs, plugins: [{ id: 'red' }] } } });
    const redUrl = `/vs/${red.visual.vs.slice(0, 16)}/overlay.json`;
    assert.ok(pending.has(redUrl));
    // the room changes to blue before red's document arrives: red's late answer is dropped
    app.set({ room: { code: 'ABCD', content: { cs: 'ee'.repeat(32), vanilla: true, vs: blue.visual.vs, plugins: [{ id: 'blue' }] } } });
    pending.get(redUrl)(res(200, red));
    pending.get(`/vs/${blue.visual.vs.slice(0, 16)}/overlay.json`)(res(200, blue));
    await until(() => layers.room === null ? false : layers.room.visual.vs === blue.visual.vs, 'blue applied');
    await tick();
    assert.equal(layers.room.visual.vs, blue.visual.vs, 'never the late red');
    assert.equal(data.get('assets').chars.char_102_texas.avatar, urlOf('blue', 'a.png'), 'every data.get(\'assets\') of the interface draws it');
    // leaving the room: its art goes too
    app.set({ room: null });
    assert.equal(layers.room, null);
    assert.equal(data.get('assets').chars.char_102_texas.avatar, BASE.chars.char_102_texas.avatar);
    // a document that fails its check: the original art, one toast
    const bad = roomDoc('bad');
    app.set({ room: { content: { vs: 'ab'.repeat(32) } } });
    pending.get(`/vs/${'ab'.repeat(8)}/overlay.json`)(res(200, bad));
    await until(() => toasts.length === 1, 'the toast');
    assert.equal(layers.room, null);
    assert.equal(toasts[0][1], 'warn');
    off();
    assert.equal(data.get('assets'), data.getRaw('assets'), 'uninstalled: the file as downloaded');
  });

  test('installContent: a document of the room\'s vs whose writes were changed (the same file table) → the installation\'s art, one toast, nothing thrown', async () => {
    const app = createStore({ room: null });
    const data = createDataStore({ fetch: async () => res(200, BASE), retryDelays: [], timeoutMs: 0 });
    await data.load('assets');
    const layers = createCosmeticLayers();
    const forged = roomDoc('forged');
    forged.writes[0].ops = [{ at: ['chars', 'char_112_siege', 'avatar'], file: 'a.png' }];
    const toasts = [];
    const off = installContent({ store: app, data, layers, fetch: async () => res(200, forged), toast: (text, kind) => toasts.push([text, kind]), retryDelays: [] });
    app.set({ room: { code: 'ABCD', content: { cs: 'ee'.repeat(32), vanilla: true, vs: forged.visual.vs, plugins: [{ id: 'forged' }] } } });
    await until(() => toasts.length === 1, 'the toast');
    await tick();
    assert.equal(layers.room, null, 'no room layer');
    assert.deepEqual(toasts.map(([, kind]) => kind), ['warn'], 'one toast');
    assert.equal(data.get('assets').chars.char_112_siege.avatar, BASE.chars.char_112_siege.avatar, 'the installation\'s art, not the forged slot');
    assert.equal(data.get('assets').chars.char_102_texas.avatar, BASE.chars.char_102_texas.avatar, 'nor the slot the vs names');
    off();
  });

  test('installContent: an <img> of the interface whose plugin file will not load makes its entry fall back (one toast)', async () => {
    const listeners = {};
    const had = 'document' in globalThis;
    const prev = globalThis.document;
    globalThis.document = { addEventListener: (type, fn, capture) => { listeners[type] = [fn, capture]; }, removeEventListener: (type, fn) => { if (listeners[type]?.[0] === fn) delete listeners[type]; } };
    try {
      const app = createStore({ room: null });
      const data = createDataStore({ fetch: async () => res(200, BASE), retryDelays: [], timeoutMs: 0 });
      await data.load('assets');
      const layers = createCosmeticLayers();
      const doc = roomDoc('red');
      const toasts = [];
      const off = installContent({ store: app, data, layers, fetch: async () => res(200, doc), toast: (text, kind) => toasts.push([text, kind]), retryDelays: [] });
      assert.equal(listeners.error?.[1], true, 'caught on the way down (error events do not bubble)');
      app.set({ room: { code: 'ABCD', content: { vs: doc.visual.vs } } });
      await until(() => data.get('assets').chars.char_102_texas.avatar === urlOf('red', 'a.png'), 'the room\'s art');
      listeners.error[0]({ target: { tagName: 'DIV' } });
      listeners.error[0]({ target: { tagName: 'IMG', src: 'http://localhost/assets/siege.png' } });
      assert.equal(toasts.length, 0, 'not a plugin file: nothing to do');
      listeners.error[0]({ target: { tagName: 'IMG', currentSrc: `http://localhost${urlOf('red', 'a.png')}`, src: `http://localhost${urlOf('red', 'a.png')}` } });
      assert.equal(data.get('assets').chars.char_102_texas.avatar, BASE.chars.char_102_texas.avatar, 'the installation\'s art again');
      assert.deepEqual(toasts.map((x) => x[1]), ['warn'], 'said once');
      off();
      assert.equal(listeners.error, undefined, 'uninstalled: the listener goes too');
    } finally {
      if (had) globalThis.document = prev; else delete globalThis.document;
    }
  });

  test('installContent: the personal plugins come from the catalogue\'s vs of each, in its order; a missing one is skipped', async () => {
    const mine = personalDoc('mine', 'm.png');
    const zed = personalDoc('zed', 'z.png');
    const entries = [
      { id: 'mine', class: 'cosmetic', status: 'loaded', scope: ['personal'], vs: mine.visual.vs, unofficial: true },
      { id: 'room-only', class: 'cosmetic', status: 'loaded', scope: ['room'], vs: 'cc'.repeat(32), unofficial: true },
      { id: 'zed', class: 'cosmetic', status: 'loaded', scope: ['room', 'personal'], vs: zed.visual.vs, unofficial: true },
    ];
    const asked = [];
    const fetch = async (u, init) => {
      asked.push(u);
      if (u === '/plugins/index.json') { assert.equal(init.cache, 'no-store'); return res(200, { version: 1, app: '0.3.0-dev', plugins: entries }); }
      if (u === `/vs/${mine.visual.vs.slice(0, 16)}/overlay.json`) return res(200, mine);
      if (u === `/vs/${zed.visual.vs.slice(0, 16)}/overlay.json`) return res(200, zed);
      return res(404, '');
    };
    catalog.set({ status: 'idle', plugins: [], app: null, at: 0 });
    personal.set({ ids: [] });
    const layers = createCosmeticLayers();
    const data = createDataStore({ fetch: async () => res(200, BASE), retryDelays: [], timeoutMs: 0 });
    await data.load('assets');
    const off = installContent({ store: createStore({ room: null, installedPlugins: 3 }), data, layers, fetch, retryDelays: [] });
    await tick();
    assert.deepEqual(asked, [], 'no personal plugin switched on: not even the catalogue');
    setPersonalPlugin('zed', true);
    setPersonalPlugin('mine', true);
    setPersonalPlugin('gone', true);
    assert.deepEqual(personal.get().ids, ['gone', 'mine', 'zed']);
    await until(() => layers.personal.length === 2, 'two personal plugins');
    assert.deepEqual(layers.personal.map((p) => p.id), ['mine', 'zed'], 'the catalogue\'s order; a plugin the server lacks is skipped');
    assert.equal(data.get('assets').chars.char_112_siege.avatar, urlOf('zed', 'z.png'), 'the later one applies');
    assert.ok(!asked.some((u) => u.includes('cc'.repeat(8))), 'a room-only plugin is never a personal one');
    setPersonalPlugin('zed', false);
    await until(() => layers.personal.length === 1, 'one left');
    assert.equal(data.get('assets').chars.char_112_siege.avatar, urlOf('mine', 'm.png'));
    setPersonalPlugin('mine', false);
    setPersonalPlugin('gone', false);
    await until(() => layers.personal.length === 0, 'none');
    off();
    assert.equal(PERSONAL_PREF, 'cosmetics');
  });

  test('a server without plugins (no content.plugins in /healthz or welcome) is never asked for its catalogue, even with personal plugins kept here', async () => {
    catalog.set({ status: 'idle', plugins: [], app: null, at: 0 });
    personal.set({ ids: ['mine'] });
    const asked = [];
    const mine = personalDoc('mine', 'm.png');
    const fetch = async (u) => {
      asked.push(u);
      if (u === '/plugins/index.json') return res(200, { plugins: [{ id: 'mine', class: 'cosmetic', status: 'loaded', scope: ['personal'], vs: mine.visual.vs, unofficial: true }] });
      return u.startsWith('/vs/') ? res(200, mine) : res(404, '');
    };
    const app = createStore({ room: null, installedPlugins: 0 });
    const layers = createCosmeticLayers();
    const data = createDataStore({ fetch: async () => res(200, BASE), retryDelays: [], timeoutMs: 0 });
    await data.load('assets');
    const off = installContent({ store: app, data, layers, fetch, retryDelays: [] });
    for (let i = 0; i < 5; i++) await tick();
    assert.deepEqual(asked, [], 'nothing fetched: the server has no plugin');
    assert.equal(installedCount(app.get()), 0);
    assert.equal(installedCount({}), 0, 'nothing said: none');
    // a server that has some (/healthz, or welcome after a reconnect): the switched-on one is fetched and applied
    app.set({ installedPlugins: 1 });
    await until(() => layers.personal.length === 1, 'the personal plugin');
    assert.deepEqual(asked, ['/plugins/index.json', `/vs/${mine.visual.vs.slice(0, 16)}/overlay.json`]);
    off();
    personal.set({ ids: [] });
  });

  test('personal plugins form a set like a room\'s: requirements switched on (「自动」), the load order, a conflicting switch refused', async () => {
    // the load-order function comes with the catalogue (a page of a server without plugins never loads it)
    assert.equal(await loadPluginOrder(), true);
    const e = (id, o = {}) => ({ id, class: 'cosmetic', status: 'loaded', scope: ['personal'], vs: sha256Hex(id), version: '1.0.0', unofficial: true, ...o });
    const entries = [e('base'), e('top', { requires: { base: '^1.0.0' } }), e('late', { loadAfter: ['zz-first'] }), e('zz-first', { priority: 5 }),
      e('rival', { conflicts: { top: '*' } }), e('needs-gone', { requires: { gone: '*' } })];
    assert.deepEqual(personalSet(['top'], entries), { order: ['base', 'top'], auto: ['base'], skipped: [] }, 'its requirement on too');
    assert.deepEqual(personalSet(['late', 'zz-first'], entries).order, ['zz-first', 'late'], 'loadAfter (and priority) as in a room\'s set');
    assert.deepEqual(personalSet(['absent', 'base'], entries).order, ['base'], 'a plugin the server lacks: ignored (kept switched on)');
    // a choice that turned bad since (the server's plugins changed): what still fits, by id
    assert.deepEqual(personalSet(['rival', 'top'], entries), { order: ['rival'], auto: [], skipped: ['top'] });
    assert.deepEqual(personalSet(['needs-gone', 'base'], entries), { order: ['base'], auto: [], skipped: ['needs-gone'] });
    // the switches: a conflict or a missing requirement refused with the room's code; off always works
    catalog.set({ status: 'ready', plugins: entries, app: null, at: 1 });
    personal.set({ ids: ['top'] });
    assert.deepEqual(setPersonalPlugin('rival', true).error, ERR.PLUGIN_CONFLICT);
    assert.equal(setPersonalPlugin('needs-gone', true).error, ERR.PLUGIN_DEPENDENCY);
    assert.deepEqual(personal.get().ids, ['top'], 'nothing stored');
    assert.deepEqual(setPersonalPlugin('late', true), { ok: true });
    assert.deepEqual(setPersonalPlugin('top', false), { ok: true });
    assert.deepEqual(personal.get().ids, ['late']);
    personal.set({ ids: [] });
    catalog.set({ status: 'idle', plugins: [], app: null, at: 0 });
  });

  test('loadCatalog: shared while on its way, a failure keeps what was there; the helpers pick the right entries', async () => {
    catalog.set({ status: 'idle', plugins: [], app: null, at: 0 });
    let n = 0;
    const body = { plugins: [{ id: 'a', class: 'cosmetic', status: 'loaded', scope: ['room'], unofficial: true, names: { zh: '甲', en: 'A' }, name: '甲' },
      { id: 'b', class: 'content', status: 'planned', unofficial: true, name: 'B' }, { id: 'en', class: 'lang', status: 'loaded', name: 'English' }] };
    const fetch = async () => { n++; return res(200, body); };
    const [x, y] = await Promise.all([loadCatalog({ fetch }), loadCatalog({ fetch })]);
    assert.equal(n, 1);
    assert.equal(x, y);
    assert.equal(catalog.get().status, 'ready');
    await loadCatalog({ fetch });
    assert.equal(n, 1, 'ready: not again unless forced');
    await loadCatalog({ fetch: async () => { throw new Error('offline'); }, force: true });
    assert.deepEqual([catalog.get().status, catalog.get().plugins.length], ['ready', 3], 'a failure keeps the list');
    assert.deepEqual(cosmeticPlugins(body.plugins, 'room').map((p) => p.id), ['a']);
    assert.deepEqual(cosmeticPlugins(body.plugins, 'personal'), []);
    assert.deepEqual(unofficialPlugins(body.plugins).map((p) => p.id), ['a', 'b'], 'the title screen counts every plugin but a language');
    assert.equal(pluginName(body.plugins[0]), '甲', 'the interface language (Chinese here)');
    assert.equal(pluginName({ id: 'x' }), 'x');
  });
});

describe('the 插件 panel (ui/pluginPanel.js) and the room screen', () => {
  const room = (content, o = {}) => ({ code: 'ABCD', hostId: 'h', mode: 'coop', inMatch: false, content, ...o });
  const set = { cs: 'ee'.repeat(32), vanilla: true, vs: 'ff'.repeat(32), plugins: [{ id: 'a', version: '1.0.0', class: 'cosmetic', hash: '0123456789abcdef' }, { id: 'b', auto: true }],
    warnings: [{ code: 'override', params: { path: 'chars.x.avatar', plugins: ['a', 'b'] } }], bytes: 2048 };

  test('the facts: count, what is on and automatic, who may switch (the host, outside a match), the warnings', () => {
    const f = roomPluginFacts(room(set), 'h');
    assert.deepEqual([f.count, [...f.on], [...f.auto], f.chosen, f.editable, f.warnings.length, f.vs], [2, ['a', 'b'], ['b'], ['a'], true, 1, 'ff'.repeat(32)]);
    assert.equal(roomPluginFacts(room(set), 'g').editable, false, 'another player reads it');
    assert.equal(roomPluginFacts(room(set, { inMatch: true }), 'h').editable, false, 'not during a match');
    assert.deepEqual([roomPluginFacts(room({ cs: 'ee'.repeat(32), vanilla: true, plugins: [] }), 'h').count, roomPluginFacts(null, 'h').count], [0, 0]);
    assert.deepEqual(nextChoice(['a'], 'c', true), ['a', 'c']);
    assert.deepEqual(nextChoice(['a', 'c'], 'a', false), ['c']);
    // a plugin the server no longer offers is never sent again (else every switch is refused); its own switch turns it off
    assert.deepEqual(nextChoice(['gone', 'a'], 'c', true, new Set(['a', 'c'])), ['a', 'c']);
    assert.deepEqual(nextChoice(['gone', 'a'], 'gone', false, new Set(['a'])), ['a']);
    assert.deepEqual(nextChoice(['gone', 'a'], 'c', true, null), ['gone', 'a', 'c'], 'the catalogue not loaded: the choice as it is');
    assert.equal(pluginTagText(room(set)), '插件 ×2');
    assert.equal(pluginTagText(room({ plugins: [] })), '原版');
    assert.deepEqual([sizeText(2048), sizeText(3 * 1048576), sizeText(NaN)], ['2 KB', '3.0 MB', '']);
    assert.equal(pluginMicro({ id: 'a', version: '1.0.0', artBytes: 4096 }), 'a · v1.0.0 · 4 KB');
  });

  test('a vanilla page loads none of the panel, the asset store or what composes a set at start (the import graph of main.js)', () => {
    const seen = new Set();
    const walk = (rel) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      let src;
      try { src = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return; }
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/gm)) {
        if (m[1].startsWith('.')) walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
      }
    };
    walk('public/js/main.js');
    assert.ok(seen.has('public/js/content.js') && seen.has('public/js/cosmetics.js') && seen.has('public/js/ui/pluginTag.js'), 'the small parts are there');
    for (const lazy of ['public/js/assets.js', 'public/js/ui/pluginPanel.js', 'shared/plugins/visual.js', 'shared/plugins/order.js']) {
      assert.equal(seen.has(lazy), false, `${lazy} loads only when it is needed`);
    }
  });

  test('the room screen shows the tag under its title; the settings show 外观插件; the texts are in every pack', () => {
    const roomSrc = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
    assert.match(roomSrc, /<\$\{PluginTag\} room=\$\{room\} myId=\$\{me\.playerId\} \/>/);
    const settingsSrc = readFileSync(path.join(ROOT, 'public/js/ui/settings.js'), 'utf8');
    assert.match(settingsSrc, /<\$\{CosmeticSection\} \/>/);
    for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
      const pack = JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
      for (const k of ['原版', '插件 ×{n}', '外观插件', '本服务器安装了 {n} 个插件', '非官方', '本服务器没有安装该插件']) assert.ok(pack[k], `${lang}: ${k}`);
    }
  });
});
