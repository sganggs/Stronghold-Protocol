// test/ui/plugins-content.test.js — the browser side of a room's content set (DESIGN §32.6, P1c):
//   * content.js fetchChecked / loadContentSet: a real content set (the content builder over a data plugin) fetched as bytes —
//     every file checked against its manifest entry before it is decoded (a BOM stays part of the bytes), the manifest's
//     composition (its translation files' hashes too) against cs; refused: a byte changed, a wrong size, a manifest that
//     names another cs or does not hash to it, an address outside this server's data; transient failures tried again;
//   * content.js installContentSet: the room's content set followed (loaded, shown through data.js, room.contentReady
//     told — again when the seat does not show it), a failure told once ({ ok: false }, a toast), the room back on the
//     original content gives the server's files back; contentFor / simContent for the runner; the operators the set
//     adds to the 自选 picker (room.state.content.kittedExtra → ui/loadoutSync.js installDiySync);
//   * data.js setContent: the set's files are the store's, the server's come back without a download, the set's own
//     game texts per language;
//   * runner.js: a spec of another content than the page holds is no authority (no b.result); the room's content set the
//     page holds (or is loading) is, and its b.result names it; a vanilla spec's result names nothing;
//   * ui/stats.js: records name the content set (v2, migrated from v1), the overview leaves such matches out unless asked;
//   * the room's facts (screens/room.js, ui/pluginTag.js): start and ready wait for every page's check.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchChecked, loadContentSet, installContentSet, contentSet, contentFor, simContent, contentHooks } from '../../public/js/content.js';
import { createDataStore } from '../../public/js/data.js';
import { createStore, initialState } from '../../public/js/store.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { buildRecord, aggregateStats, migrateStats, STATS_VERSION, contentOf, isModdedRecord } from '../../public/js/ui/stats.js';
import { roomFacts } from '../../public/js/screens/room.js';
import { roomPluginFacts, isModdedRoom } from '../../public/js/ui/pluginTag.js';
import { installDiySync } from '../../public/js/ui/loadoutSync.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { getData } from '../../server/data.js';
import { sha256Hex } from '../../shared/sha256.js';
import { buildRecordOverlay } from '../../shared/i18nData.js';
import { validateC2S } from '../../shared/protocol.js';
import { PHASE } from '../../shared/constants.js';
import * as specMod from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { writePlugin } from '../helpers/pluginFixtures.js';
import { DATA, makeMatch } from '../match/harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred, what) => { for (let i = 0; i < 400; i++) { if (pred()) return; await tick(); } assert.fail(`timed out: ${what}`); };
const noWait = () => Promise.resolve();

// a real content set: a data plugin that patches a bond (the content builder, the server's own pieces)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugins-content-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const pluginsDir = path.join(tmp, 'plugins');
writePlugin(path.join(pluginsDir, 'bond-def'), { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'], permissions: ['data.patch'], data: ['p.json'] },
  { 'p.json': { patch: 1, ops: [['bb', 'base_def'], ['buffs', 0, 'bb', 'base_def']].map((p) => ({ op: 'set', file: 'bonds', id: 'deputShip', path: p, value: 0.3 })) } });
const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), dataDir: path.join(ROOT, 'data'), packsDir: path.join(tmp, 'packs'), pluginsDir }, { log: quiet });
registry.refresh(true);
const contents = createContentSets({ registry, vanillaData: getData({ log: quiet }), log: quiet });
const built = contents.resolve(['bond-def']);
assert.ok(built.ok, JSON.stringify(built));
const CS = built.set.cs;
const CS16 = CS.slice(0, 16);

/** A response of `bytes` (a Buffer). */
const bytesRes = (buf, status = 200) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
/** What this server serves for a URL: the set's files from memory, the data files from disk (`edit` changes a body). */
function serverFetch({ edit = null, fail = null } = {}) {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    if (fail) { const r = fail(url, seen); if (r) return r; }
    const u = new URL(url, 'http://x');
    let body = null;
    if (u.pathname.startsWith(`/cs/${CS16}/`)) body = contents.file(CS16, u.pathname.slice(`/cs/${CS16}/`.length))?.body ?? null;
    else if (u.pathname.startsWith('/data/')) { try { body = fs.readFileSync(path.join(ROOT, 'data', decodeURIComponent(u.pathname.slice(6)))); } catch { body = null; } }
    if (!body) return bytesRes(Buffer.from('not found'), 404);
    return bytesRes(edit ? edit(u.pathname, Buffer.from(body)) : Buffer.from(body));
  };
  return { fetchFn, seen };
}

describe('loading and checking a room\'s content set (public/js/content.js)', () => {
  test('fetchChecked: the bytes are checked before they are decoded — a BOM stays part of them; a changed byte or size is refused', async () => {
    const json = Buffer.from(JSON.stringify({ a: 1 }));
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json]);
    const want = { sha256: sha256Hex(new Uint8Array(bom)), bytes: bom.length };
    assert.deepEqual(await fetchChecked('/x', want, { fetch: async () => bytesRes(bom), wait: noWait }), { a: 1 }, 'decoded without the BOM after the check');
    // the same JSON without its BOM: other bytes, refused (a page that read text would never notice)
    await assert.rejects(fetchChecked('/x', want, { fetch: async () => bytesRes(json), wait: noWait }), /bytes/);
    const flipped = Buffer.from(bom); flipped[5] ^= 1;
    await assert.rejects(fetchChecked('/x', want, { fetch: async () => bytesRes(flipped), wait: noWait }), /do not hash/);
    // a transient failure is tried again; a 404 is final
    let n = 0;
    assert.deepEqual(await fetchChecked('/x', want, { fetch: async () => (++n === 1 ? bytesRes(Buffer.from(''), 503) : bytesRes(bom)), wait: noWait }), { a: 1 });
    assert.equal(n, 2);
    await assert.rejects(fetchChecked('/x', want, { fetch: async () => bytesRes(Buffer.from(''), 404), wait: noWait }), /HTTP 404/);
  });

  test('loadContentSet: the manifest recomputes cs, every data file is checked, the patched one comes from /cs/<cs16>/', async () => {
    const { fetchFn, seen } = serverFetch();
    const progress = [];
    const set = await loadContentSet(CS, { fetch: fetchFn, wait: noWait, onProgress: (a, b) => progress.push([a, b]) });
    assert.equal(set.cs, CS);
    assert.equal(set.values.get('bonds').deputShip.bb.base_def, 0.3, 'the patched file');
    assert.ok(set.values.get('chess') && Object.keys(set.values.get('chess')).length > 100, 'an unchanged file');
    assert.ok(seen.includes(`/cs/${CS16}/data/bonds.json`));
    assert.ok(seen.some((u) => /^\/data\/chess\.json\?v=[0-9a-f]{8}$/.test(u)), 'an unchanged file at its plain URL (cached for good)');
    const [loaded, total] = progress[progress.length - 1];
    assert.ok(total > 1e6 && loaded === total, `progress ${loaded}/${total}`);
  });

  test('loadContentSet refuses: a changed byte, a manifest of another cs or one that does not hash to it, an address outside the server\'s data', async () => {
    const flip = (target) => (p, b) => { if (p === target) b[b.length - 3] ^= 1; return b; };
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: flip(`/cs/${CS16}/data/bonds.json`) }).fetchFn, wait: noWait }), /do not hash/);
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: flip('/data/chess.json') }).fetchFn, wait: noWait }), /do not hash/);
    const rewrite = (fn) => (p, b) => (p === `/cs/${CS16}/index.json` ? Buffer.from(JSON.stringify(fn(JSON.parse(b.toString('utf8'))))) : b);
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: rewrite((i) => ({ ...i, cs: 'ab'.repeat(32) })) }).fetchFn, wait: noWait }), /not the room's content set/);
    // a manifest that names a file another hash: the composition no longer hashes to cs
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: rewrite((i) => ({ ...i, data: { ...i.data, bonds: { ...i.data.bonds, sha256: 'cd'.repeat(32) } } })) }).fetchFn, wait: noWait }), /does not hash/);
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: rewrite((i) => ({ ...i, data: { ...i.data, bonds: { ...i.data.bonds, url: 'https://elsewhere.example/bonds.json' } } })) }).fetchFn, wait: noWait }), /outside this server/);
    // its translation files: the cs covers their hashes (DESIGN §32.5), their addresses are this server's too
    const lang = Object.keys((await loadContentSet(CS, { fetch: serverFetch().fetchFn, wait: noWait })).index.i18n || {})[0];
    assert.ok(lang, 'the set lists the server\'s translation files');
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: rewrite((i) => ({ ...i, i18n: { ...i.i18n, [lang]: { ...i.i18n[lang], sha256: 'cd'.repeat(32) } } })) }).fetchFn, wait: noWait }), /does not hash/);
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: rewrite((i) => { const rest = { ...i.i18n }; delete rest[lang]; return { ...i, i18n: rest }; }) }).fetchFn, wait: noWait }), /does not hash/);
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: rewrite((i) => ({ ...i, i18n: { ...i.i18n, [lang]: { ...i.i18n[lang], url: 'https://elsewhere.example/en.json' } } })) }).fetchFn, wait: noWait }), /outside this server/);
  });

  test('loadContentSet: the official-bounds snapshot the manifest lists comes with the set, checked by its bytes — the table the server\'s match host installs (DESIGN §32.5)', async () => {
    const { fetchFn, seen } = serverFetch();
    const set = await loadContentSet(CS, { fetch: fetchFn, wait: noWait });
    assert.equal(set.bounds?.v, 1);
    assert.equal(set.bounds.bb.times, 12, 'the official maximum of a blackboard key, not a value of the plugin');
    assert.deepEqual(set.bounds, JSON.parse(JSON.stringify(built.set.bounds)), 'the snapshot the server built and hands its match host');
    assert.ok(seen.includes(`/cs/${CS16}/bounds/official.json`));
    const flip = (target) => (p, b) => { if (p === target) b[b.length - 3] ^= 1; return b; };
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: flip(`/cs/${CS16}/bounds/official.json`) }).fetchFn, wait: noWait }), /do not hash/);
    const rewrite = (fn) => (p, b) => (p === `/cs/${CS16}/index.json` ? Buffer.from(JSON.stringify(fn(JSON.parse(b.toString('utf8'))))) : b);
    await assert.rejects(loadContentSet(CS, { fetch: serverFetch({ edit: rewrite((i) => ({ ...i, bounds: { official: { ...i.bounds.official, url: '/data/bonds.json' } } })) }).fetchFn, wait: noWait }), /outside this content set/);
    // a manifest that lists none: no snapshot (the battle runner then runs the set on the floor, never on a scan of it)
    const none = await loadContentSet(CS, { fetch: serverFetch({ edit: rewrite((i) => ({ ...i, bounds: {} })) }).fetchFn, wait: noWait });
    assert.equal(none.bounds, null);
  });

  test('installContentSet: follows the room — loads, shows it through data.js, tells the room (again when its seat does not show it); back to the original content', async () => {
    const store = createStore(initialState);
    const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({ vanilla: true }) }), retryDelays: [] });
    const requests = [];
    const net = { request: async (t, fields) => { const msg = { t, ...fields }; assert.equal(validateC2S(msg), null); requests.push(msg); return { t: 'ok' }; } };
    const toasts = [];
    const stop = installContentSet({ store, data, net, fetch: serverFetch().fetchFn, toast: (text, kind) => toasts.push([text, kind]), wait: noWait });
    try {
      // the original content: nothing is fetched, nothing told
      store.set({ me: { playerId: 'p1', name: 'A', token: null }, room: { code: 'ABCD', seats: [{ seat: 0, playerId: 'p1' }], content: { cs: 'ab'.repeat(32), vanilla: true, plugins: [] } } });
      await tick();
      assert.equal(contentSet.get().status, 'idle');
      assert.equal(await data.load('bonds').then((b) => b?.vanilla), true, 'the server\'s file');
      // the host switches the content plugin on
      const room = { code: 'ABCD', seats: [{ seat: 0, playerId: 'p1', content: 'loading' }], content: { cs: CS, vanilla: false, plugins: [{ id: 'bond-def', version: '1.0.0', class: 'content' }], kittedExtra: ['char_x_demo', 7] } };
      store.set({ room });
      assert.equal(contentSet.get().status, 'loading');
      const pending = contentFor(CS);
      await until(() => contentSet.get().status === 'ready', 'the set loaded');
      assert.equal(data.get('bonds').deputShip.bb.base_def, 0.3, 'every screen reads the room\'s data');
      assert.equal(data.contentId(), CS);
      assert.deepEqual(contentSet.get().kitted, ['char_x_demo'], 'the operators the set adds to a 自选 slot\'s list');
      assert.deepEqual(requests, [{ t: 'room.contentReady', cs: CS }]);
      assert.equal((await pending).cs, CS, 'the runner\'s wait');
      assert.equal(simContent().data.bonds.deputShip.bb.base_def, 0.3);
      assert.equal(simContent().bounds?.bb?.times, 12, 'the runner gets the set\'s official-bounds snapshot with its data');
      // a later state whose seat does not show it (a reconnect): told again
      await until(() => requests.length === 1, 'settled');
      store.set({ room: { ...room, seats: [{ seat: 0, playerId: 'p1', connected: true, content: 'loading' }] } });
      await until(() => requests.length === 2, 'told again');
      store.set({ room: { ...room, seats: [{ seat: 0, playerId: 'p1', content: 'ready' }] } });
      await tick();
      assert.equal(requests.length, 2, 'not while the seat shows it');
      // back to the original content: the server's file again, no download
      store.set({ room: { ...room, content: { cs: 'ab'.repeat(32), vanilla: true, plugins: [] } } });
      await tick();
      assert.equal(contentSet.get().status, 'idle');
      assert.equal(contentSet.get().kitted, null);
      assert.equal(data.contentId(), null);
      assert.equal(data.get('bonds').vanilla, true);
      assert.equal(simContent(), null);
      assert.deepEqual(toasts, []);
    } finally { stop(); }
  });

  test('installContentSet: a set that does not check is told once ({ ok: false }) and toasted; the runner\'s wait gets null', async () => {
    const store = createStore(initialState);
    const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({}) }), retryDelays: [] });
    const requests = [];
    const net = { request: async (t, fields) => { requests.push({ t, ...fields }); return { t: 'ok' }; } };
    const toasts = [];
    const flip = (p, b) => { if (p.endsWith('bonds.json')) b[10] ^= 1; return b; };
    const stop = installContentSet({ store, data, net, fetch: serverFetch({ edit: flip }).fetchFn, toast: (text) => toasts.push(text), wait: noWait });
    try {
      store.set({ me: { playerId: 'p1', name: 'A', token: null }, room: { code: 'ABCD', seats: [{ seat: 0, playerId: 'p1', content: 'loading' }], content: { cs: CS, vanilla: false, plugins: [] } } });
      const pending = contentFor(CS);
      await until(() => contentSet.get().status === 'failed', 'the check failed');
      assert.equal(await pending, null);
      assert.match(contentSet.get().error, /do not hash/);
      await until(() => requests.length === 1, 'told');
      assert.deepEqual(requests, [{ t: 'room.contentReady', cs: CS, ok: false }]);
      assert.equal(toasts.length, 1);
      assert.equal(data.contentId(), null, 'the page keeps the server\'s files');
    } finally { stop(); }
  });
});

test('自选: the picker lists welcome\'s operators, and the ones the room\'s content set adds while it is ready (installDiySync)', () => {
  const listeners = new Map();
  const net = { status: 'offline', on(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); return () => listeners.get(t).delete(fn); },
    request: async () => ({ t: 'ok' }) };
  const emit = (t, msg) => { for (const fn of listeners.get(t) || []) fn(msg); };
  const content = createStore({ cs: null, status: 'idle', loaded: 0, total: 0, error: null, kitted: null });
  const target = createStore({ diy: {}, diyKitted: null, diySync: 'idle' });
  const s = installDiySync({ net, timers: { setTimeout: () => 0, clearTimeout() {} }, target, content });
  try {
    emit('welcome', { diyKitted: ['char_a', 'char_b'] });
    const vanilla = target.get().diyKitted;
    assert.deepEqual(vanilla, ['char_a', 'char_b']);
    content.set({ cs: CS, status: 'loading' });
    assert.equal(target.get().diyKitted, vanilla, 'not while it loads');
    content.set({ status: 'ready', kitted: ['char_x_demo', 'char_a'] });
    const joined = target.get().diyKitted;
    assert.deepEqual(joined, ['char_a', 'char_b', 'char_x_demo']);
    content.set({ loaded: 1 });
    assert.equal(target.get().diyKitted, joined, 'the same list (no new array per store change)');
    content.set({ cs: null, status: 'idle', kitted: null });
    assert.deepEqual(target.get().diyKitted, ['char_a', 'char_b']);
  } finally { s.dispose(); }
});

test('__SP_CONTENT__: state() always; forgeHeldCs only in a dev build or a browser under automation (the browser tests)', () => {
  assert.equal(typeof contentHooks({ dev: false, nav: { webdriver: false } }).state, 'function');
  assert.equal(contentHooks({ dev: false, nav: { webdriver: false } }).forgeHeldCs, undefined, 'a release page');
  assert.equal(contentHooks({ dev: false, nav: null }).forgeHeldCs, undefined);
  assert.equal(typeof contentHooks({ dev: false, nav: { webdriver: true } }).forgeHeldCs, 'function', 'the browser tests');
  assert.equal(typeof contentHooks({ dev: true, nav: null }).forgeHeldCs, 'function', 'a dev build');
});

describe('data.js setContent', () => {
  test('a content set\'s files are the store\'s; the server\'s come back without a download; the set\'s game texts per language', async () => {
    const fetched = [];
    const data = createDataStore({
      retryDelays: [],
      fetch: async (url) => {
        fetched.push(url);
        if (url.endsWith('i18n/en.json')) return { ok: true, json: async () => ({ files: { chess: { c1: buildRecordOverlay([{ path: ['name'], zh: '原版', en: 'Vanilla EN' }]) } }, names: {} }) };
        return { ok: true, json: async () => ({ c1: { id: 'c1', name: '原版' } }) };
      },
    });
    let told = 0;
    data.subscribe((n) => { if (n === 'chess') told++; });
    await data.load('chess');
    await data.setLocale('en', ['en']);
    assert.equal(data.get('chess').c1.name, 'Vanilla EN');
    const before = fetched.length;
    const n0 = told;
    data.setContent({ id: 'cs1', values: { chess: { c1: { id: 'c1', name: '原版' }, c2: { id: 'c2', name: '插件干员' } } }, langs: ['en'],
      overlay: async () => ({ files: { chess: { c1: buildRecordOverlay([{ path: ['name'], zh: '原版', en: 'Vanilla EN' }]), c2: buildRecordOverlay([{ path: ['name'], zh: '插件干员', en: 'Plugin EN' }]) } }, names: {} }) });
    assert.ok(told > n0, 'the subscribers are told');
    assert.equal(data.lookupRaw('chess', 'c2').name, '插件干员');
    await until(() => data.get('chess')?.c2?.name === 'Plugin EN', 'the set\'s own English texts');
    assert.equal(await data.invalidate('chess').then((v) => v.c2.name), '插件干员', 'a checked file is never fetched again');
    data.setContent(null);
    assert.equal(data.lookupRaw('chess', 'c2'), null);
    await until(() => data.get('chess')?.c1?.name === 'Vanilla EN', 'the server\'s texts again');
    assert.equal(fetched.filter((u) => u.includes('chess')).length, fetched.slice(0, before).filter((u) => u.includes('chess')).length, 'no new download of the file');
  });
});

describe('the runner\'s cs check (public/js/battle/runner.js)', () => {
  const DS = new DataSource(DATA, null);
  let start = null;
  /** A real b.start of round 2 from a client-combat match (as test/match/runner.test.js). */
  const realStart = () => {
    if (start) return JSON.parse(JSON.stringify(start));
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7301, captureFrames: false, clientCombat: true, clients: false });
    h.autoHumans();
    h.m.start();
    h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 2, { maxSteps: 3e6 });
    start = h.lastTo('p_0', 'b.start');
    h.m.dispose();
    return JSON.parse(JSON.stringify(start));
  };
  function rig({ held = null, loading = null, state = null, contentFor = null, vanilla = 'ee'.repeat(32), simCs = null } = {}) {
    const st = state || { held, loading };
    let t = 1000;
    const frames = [];
    const sent = [];
    const handlers = new Map();
    const net = {
      on(ty, fn) { if (!handlers.has(ty)) handlers.set(ty, new Set()); handlers.get(ty).add(fn); return () => handlers.get(ty).delete(fn); },
      emit(ty, msg) { for (const fn of handlers.get(ty) || []) fn({ t: ty, ...msg }); },
      send(ty, fields) { sent.push({ t: ty, ...fields }); return true; },
      request(ty, fields) { const msg = { t: ty, ...fields }; assert.equal(validateC2S(msg), null, `invalid ${ty}`); sent.push(msg); return Promise.resolve({ t: 'ok' }); },
    };
    const store = createStore({ ...initialState, ...(vanilla ? { content: { vanilla } } : {}) });
    const loads = [];
    const runner = createBattleRunner({
      net, store, doc: { hidden: false, addEventListener() {} }, now: () => t,
      raf: (fn) => { frames.push(fn); return frames.length; }, caf: () => {}, setInterval: () => 1, clearInterval: () => {},
      // (as loadBrowserSim: the simulation names the content it was loaded with — `simCs` makes it name another)
      loadSim: async (content) => { loads.push(content ? content.cs : null); return { spec: specMod, ds: DS, cs: simCs ?? (content ? content.cs : null) }; },
      logger: quiet,
      simContent: () => st.held,
      loadingContent: () => st.loading,
      contentFor: contentFor || (async (cs) => (st.held && st.held.cs === cs ? st.held : null)),
    });
    return {
      runner, net, sent, loads,
      async run(ms) { for (let i = 0; i < 50; i++) { await new Promise((r) => setImmediate(r)); for (const fn of frames.splice(0)) fn(t); } const end = t + ms; while (t < end) { t += 1000 / 60; for (const fn of frames.splice(0)) fn(t); } await new Promise((r) => setImmediate(r)); },
    };
  }

  test('a spec of a content set the page does not hold: a replica, never the authority — no b.progress, no b.result', async () => {
    const s = realStart();
    s.spec.cs = 'cd'.repeat(32);
    const r = rig({ held: null });
    r.net.emit('b.start', s);
    await r.run(200);
    const e = r.runner._entries.get(s.battleId);
    assert.ok(!e || e.authoritative === false, 'not the authority');
    assert.equal(r.sent.filter((m) => m.t === 'b.result' || m.t === 'b.progress').length, 0);
  });

  test('the room\'s content set the page holds: the authority, its sim loaded on the set, its b.result names the set; a vanilla spec names none', async () => {
    const s = realStart();
    s.spec.cs = 'cd'.repeat(32);
    const r = rig({ held: { cs: 'cd'.repeat(32), data: DATA } });
    r.net.emit('b.start', s);
    await r.run(60_000);
    const e = r.runner._entries.get(s.battleId);
    assert.equal(e.authoritative, true);
    assert.deepEqual(r.loads, ['cd'.repeat(32)], 'the sim was loaded on the room\'s content set');
    const res = r.sent.find((m) => m.t === 'b.result');
    assert.ok(res, 'the result was sent');
    assert.equal(res.cs, 'cd'.repeat(32));
    // the original content's spec: its result as before (no cs)
    const v = realStart();
    v.spec.cs = 'ee'.repeat(32);
    v.battleId = `${v.battleId}x`;
    const r2 = rig({ held: null });
    r2.net.emit('b.start', v);
    await r2.run(60_000);
    const res2 = r2.sent.find((m) => m.t === 'b.result');
    assert.ok(res2);
    assert.equal('cs' in res2, false);
    assert.deepEqual(r2.loads, [null]);
  });

  test('a page that does not know the original content\'s cs is no authority of a spec naming one; a result names the content simulated', async () => {
    const s = realStart();
    s.spec.cs = 'ee'.repeat(32);
    const r = rig({ held: null, vanilla: null });
    r.net.emit('b.start', s);
    await r.run(200);
    const e = r.runner._entries.get(s.battleId);
    assert.ok(!e || e.authoritative === false, 'not the authority without welcome.content.vanilla');
    assert.equal(r.sent.filter((m) => m.t === 'b.result' || m.t === 'b.progress').length, 0);
    // b.result names the content its simulation was loaded with, not what the spec says
    const c = realStart();
    c.spec.cs = 'cd'.repeat(32);
    c.battleId = `${c.battleId}y`;
    const r2 = rig({ held: { cs: 'cd'.repeat(32), data: DATA }, simCs: 'ab'.repeat(32) });
    r2.net.emit('b.start', c);
    await r2.run(60_000);
    assert.equal(r2.sent.find((m) => m.t === 'b.result')?.cs, 'ab'.repeat(32));
  });

  test('a content set still loading when the b.start comes (a reconnect): the authority once it is there', async () => {
    const s = realStart();
    s.spec.cs = 'cd'.repeat(32);
    const state = { held: null, loading: 'cd'.repeat(32) };
    // the set arrives after one turn of the event loop the rig's run() flushes (setImmediate): a setTimeout(0) could
    // still be pending when the 50 flushes finish on a fast runner (Node 24.21 on CI took 3.8 ms), and the battle then
    // never became the authority before the clock ran out
    const r = rig({ state, contentFor: async (cs) => { await new Promise((ok) => setImmediate(ok)); state.held = { cs, data: DATA }; state.loading = null; return state.held; } });
    r.net.emit('b.start', s);
    await r.run(60_000);
    const e = r.runner._entries.get(s.battleId);
    assert.equal(e.authoritative, true, 'kept while the page loaded the set, confirmed once it was there');
    const res = r.sent.find((m) => m.t === 'b.result');
    assert.equal(res?.cs, 'cd'.repeat(32));
  });

  test('a content set that never arrives (its check failed): no battle, no result — the server takes the field over', async () => {
    const s = realStart();
    s.spec.cs = 'cd'.repeat(32);
    const state = { held: null, loading: 'cd'.repeat(32) };
    const r = rig({ state, contentFor: async () => { await tick(); state.loading = null; return null; } });
    r.net.emit('b.start', s);
    await r.run(2000);
    assert.equal(r.runner._entries.get(s.battleId), undefined);
    assert.equal(r.sent.filter((m) => m.t === 'b.result' || m.t === 'b.progress').length, 0);
  });
});

describe('statistics and the room\'s facts with gameplay plugins', () => {
  const RES = { players: [{ playerId: 'p1', seat: 0, name: 'A', alive: true, victory: true, roundsPassed: 14, stats: {} }], victory: true, roundsPassed: 14, modeId: 'mode_multi_normal', difficulty: 'NORMAL' };
  test('a record names the room\'s content set (null for the original game); the overview leaves such matches out unless asked', () => {
    const modded = buildRecord(RES, { myId: 'p1', now: 2, content: { cs: 'cd'.repeat(32), vanilla: false, plugins: [{ id: 'bond-def', version: '1.0.0', class: 'content' }] } });
    assert.deepEqual(modded.content, { cs: 'cd'.repeat(32), plugins: ['bond-def@1.0.0'] });
    assert.equal(isModdedRecord(modded), true);
    const cosmetic = buildRecord({ ...RES, roundsPassed: 3, players: [{ ...RES.players[0], roundsPassed: 3 }] }, { myId: 'p1', now: 1, content: { cs: 'ab'.repeat(32), vanilla: true, vs: 'ef'.repeat(32), plugins: [{ id: 'skin' }] } });
    assert.equal(cosmetic.content, null, 'cosmetic plugins only: the original game');
    assert.equal(contentOf(null), null);
    const agg = aggregateStats([modded, cosmetic]);
    assert.deepEqual([agg.count, agg.modded, agg.rounds.max], [1, 1, 3]);
    const all = aggregateStats([modded, cosmetic], { modded: true });
    assert.deepEqual([all.count, all.modded, all.rounds.max], [2, 0, 14]);
  });

  test('stats v2+: a v1 envelope migrates (its records played the original game; v3 added `version`, DESIGN §35.23)', () => {
    assert.equal(STATS_VERSION, 3);
    const v1 = { v: 1, records: [{ id: 'r1', v: 1, t: 5, end: 'settled', players: [{ playerId: 'p1', stats: {} }], selfId: 'p1' }] };
    const { stats, changed } = migrateStats(v1);
    assert.equal(changed, true);
    assert.equal(stats.v, 3);
    assert.equal('version' in stats.records[0], false, 'no version: 第二期下半');
    assert.equal(stats.records[0].content, null);
    assert.equal(stats.records[0].id, 'r1');
  });

  test('the room\'s facts: start waits for every page\'s check (the host\'s too), ready for the own page\'s', () => {
    const room = { code: 'ABCD', mode: 'coop', hostId: 'h', seats: [
      { seat: 0, playerId: 'h', name: 'H', isBot: false, ready: false, connected: true, content: 'ready' },
      { seat: 1, playerId: 'g', name: 'G', isBot: false, ready: true, connected: true, content: 'loading' },
      { seat: 2, playerId: 'ai_1', name: 'AI', isBot: true, ready: true, connected: true },
    ], content: { cs: 'cd'.repeat(32), vanilla: false, plugins: [{ id: 'bond-def', class: 'content' }], modes: [{ id: 'mode_x_a_b', roomMode: 'coop' }], modeId: 'mode_x_a_b' } };
    assert.equal(isModdedRoom(room), true);
    const host = roomFacts(room, 'h');
    assert.deepEqual([host.modded, host.contentReady, host.canStart], [true, false, false]);
    assert.equal(roomFacts(room, 'g').myContent, 'loading');
    const ready = { ...room, seats: room.seats.map((s) => (s.isBot ? s : { ...s, content: 'ready' })) };
    assert.equal(roomFacts(ready, 'h').canStart, true);
    const f = roomPluginFacts(room, 'h');
    assert.deepEqual([f.modded, f.cs, f.modeId, f.modes.length], [true, 'cd'.repeat(32), 'mode_x_a_b', 1]);
    // the original game: no wait
    const vanilla = { ...room, seats: room.seats.map((s) => ({ ...s, content: undefined })), content: { cs: 'ab'.repeat(32), vanilla: true, plugins: [] } };
    assert.deepEqual([roomFacts(vanilla, 'h').contentReady, roomFacts(vanilla, 'h').canStart, roomFacts(vanilla, 'g').myContent], [true, true, 'ready']);
  });
});
