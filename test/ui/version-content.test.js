// test/ui/version-content.test.js — the browser side of the official versions' data (DESIGN §35.23, M1; protocol §3):
//   * content.js loadVersionSet: a version's /cs/<cs16>/index.json (vanilla, its `version` the id expected, no plugins or
//     settings, its composition hashing to the cs), every data file under /data/versions/<slug>/ checked by its bytes, the
//     official-bounds snapshot under /cs/<cs16>/; refused: a changed byte, a file outside the version's folder, another
//     version's manifest, another cs, plugins in the manifest, a bounds address elsewhere;
//   * content.js installContentSet: the version the page shows — the lobby's choice (welcome.versions' cs, never told to a
//     room), a room's version (room.state.content.cs, told with room.contentReady, again when the seat shows 'loading' — a
//     reconnect), the set on screen kept until the next one is checked, the last two kept (a lobby ⇄ room round trip
//     downloads nothing twice), a gameplay plugin room inside a version lobby (the plugins' own path), a failure said once;
//   * simContent / contentFor hand the runner the version's data with its bounds snapshot (and `version`);
//   * data.js keeps a version set's texts Chinese (versionFiles: the language folder is keyed by 第二期下半's ids).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVersionSet, installContentSet, contentSet, contentFor, simContent, pageVersion, retryContentSet, VERSION_CACHE } from '../../public/js/content.js';
import { createDataStore } from '../../public/js/data.js';
import { createStore, initialState } from '../../public/js/store.js';
import { sanitizeVersions } from '../../public/js/versions.js';
import { contentHashOf } from '../../shared/plugins/identity.js';
import { sha256Hex } from '../../shared/sha256.js';
import { validateC2S } from '../../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (pred, what) => { for (let i = 0; i < 400; i++) { if (pred()) return; await tick(); } assert.fail(`timed out: ${what}`); };
const noWait = () => Promise.resolve();
const FILES = ['config', 'chess', 'bonds'];

/** A version set as the server would serve it (protocol §3): its index, the files by URL, its cs. */
function versionServed(id, slug, { files = FILES, app = '0.3.2-test', edit = null } = {}) {
  const bodies = new Map();
  const data = {};
  for (const name of files) {
    const buf = fs.readFileSync(path.join(ROOT, 'data/versions', slug, `${name}.json`));
    const sha256 = sha256Hex(new Uint8Array(buf));
    const url = `/data/versions/${slug}/${name}.json?v=${sha256.slice(0, 8)}`;
    bodies.set(url, buf);
    data[name] = { url, sha256, bytes: buf.length };
  }
  const cs = contentHashOf({ app, sim: 'sim-test', data: Object.fromEntries(Object.entries(data).map(([n, f]) => [n, f.sha256])) });
  const cs16 = cs.slice(0, 16);
  const bounds = Buffer.from(JSON.stringify({ v: 1, bb: {}, fields: {}, bbMin: {}, fieldMin: {}, text: {} }));
  const boundsUrl = `/cs/${cs16}/bounds/official.json`;
  bodies.set(boundsUrl, bounds);
  let index = { v: 1, cs, app, vanilla: true, version: id, sim: 'sim-test', simFiles: {}, data, plugins: [], settings: {},
    bounds: { official: { url: boundsUrl, sha256: sha256Hex(new Uint8Array(bounds)), bytes: bounds.length } } };
  if (edit) index = edit(index);
  bodies.set(`/cs/${cs16}/index.json`, Buffer.from(JSON.stringify(index)));
  return { id, slug, cs, bodies, entry: { id, cs, family: 'covenant', label: 'x', roomModes: ['solo', 'coop'] } };
}

const bytesRes = (buf, status = 200) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
/** A fetch serving these sets (`flip`: a URL whose body gets one byte changed); `seen` lists every request. */
function serve(sets, { flip = null } = {}) {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    for (const s of sets) {
      const body = s.bodies.get(url);
      if (body) { const b = Buffer.from(body); if (flip === url) b[b.length - 3] ^= 1; return bytesRes(b); }
    }
    return bytesRes(Buffer.from('nope'), 404);
  };
  return { fetchFn, seen };
}

const V1 = versionServed('act1autochess', 'act1autochess');
const V21 = versionServed('act2autochess@V2_1', 'act2autochess-v2_1');

describe('loadVersionSet (protocol §3)', () => {
  test('a version set: every file and the bounds by their bytes, the manifest against the cs and the version', async () => {
    const { fetchFn, seen } = serve([V1]);
    const progress = [];
    const set = await loadVersionSet(V1.cs, 'act1autochess', { fetch: fetchFn, wait: noWait, onProgress: (a, b) => progress.push([a, b]) });
    assert.equal(set.version, 'act1autochess');
    assert.equal(set.values.get('config').version.id, 'act1autochess');
    assert.equal(set.bounds.v, 1);
    assert.deepEqual([set.scripts, set.canSim, set.nativeVerified], [[], true, false]);
    assert.ok(seen.every((u) => u.startsWith('/data/versions/act1autochess/') || u.startsWith(`/cs/${V1.cs.slice(0, 16)}/`)), seen.join(' '));
    const [loaded, total] = progress[progress.length - 1];
    assert.ok(total > 1000 && loaded === total);
  });

  test('refused: a changed byte, an address outside the version, another version or cs, plugins, a bounds address elsewhere', async () => {
    const chessUrl = [...V1.bodies.keys()].find((u) => u.includes('/chess.json'));
    await assert.rejects(loadVersionSet(V1.cs, 'act1autochess', { fetch: serve([V1], { flip: chessUrl }).fetchFn, wait: noWait }), /do not hash/);
    await assert.rejects(loadVersionSet(V1.cs, 'act1autochess', { fetch: serve([V1], { flip: `/cs/${V1.cs.slice(0, 16)}/bounds/official.json` }).fetchFn, wait: noWait }), /do not hash/);
    // the manifest of another version (the same cs asked as V1_1): refused before any data file
    await assert.rejects(loadVersionSet(V1.cs, 'act1autochess@V1_1', { fetch: serve([V1]).fetchFn, wait: noWait }), /not that version/);
    await assert.rejects(loadVersionSet(V1.cs, 'act2autochess', { fetch: serve([V1]).fetchFn, wait: noWait }), /not another official version/);
    // a manifest that names another cs
    const otherCs = versionServed('act1autochess', 'act1autochess', { edit: (i) => ({ ...i, cs: 'ab'.repeat(32) }) });
    await assert.rejects(loadVersionSet(otherCs.cs, 'act1autochess', { fetch: serve([otherCs]).fetchFn, wait: noWait }), /not that version/);
    // a data file of the default data (or another version's folder): outside the version's own
    const moved = versionServed('act1autochess', 'act1autochess', { edit: (i) => ({ ...i, data: { ...i.data, chess: { ...i.data.chess, url: '/data/chess.json' } } }) });
    await assert.rejects(loadVersionSet(moved.cs, 'act1autochess', { fetch: serve([moved]).fetchFn, wait: noWait }), /outside the version/);
    const sibling = versionServed('act1autochess', 'act1autochess', { edit: (i) => ({ ...i, data: { ...i.data, chess: { ...i.data.chess, url: '/data/versions/act1autochess-v1_1/chess.json' } } }) });
    await assert.rejects(loadVersionSet(sibling.cs, 'act1autochess', { fetch: serve([sibling]).fetchFn, wait: noWait }), /outside the version/);
    const dots = versionServed('act1autochess', 'act1autochess', { edit: (i) => ({ ...i, data: { ...i.data, chess: { ...i.data.chess, url: '/data/versions/act1autochess/../chess.json' } } }) });
    await assert.rejects(loadVersionSet(dots.cs, 'act1autochess', { fetch: serve([dots]).fetchFn, wait: noWait }), /outside the version/);
    const plugged = versionServed('act1autochess', 'act1autochess', { edit: (i) => ({ ...i, plugins: [{ id: 'x', version: '1.0.0', files: {} }] }) });
    await assert.rejects(loadVersionSet(plugged.cs, 'act1autochess', { fetch: serve([plugged]).fetchFn, wait: noWait }), /plugins or settings/);
    const bounds = versionServed('act1autochess', 'act1autochess', { edit: (i) => ({ ...i, bounds: { official: { ...i.bounds.official, url: '/data/bounds.json' } } }) });
    await assert.rejects(loadVersionSet(bounds.cs, 'act1autochess', { fetch: serve([bounds]).fetchFn, wait: noWait }), /bounds/);
    // a composition that does not hash to the cs (a file entry's hash rewritten)
    const rehashed = versionServed('act1autochess', 'act1autochess', { edit: (i) => ({ ...i, data: { ...i.data, bonds: { ...i.data.bonds, sha256: 'cd'.repeat(32) } } }) });
    await assert.rejects(loadVersionSet(rehashed.cs, 'act1autochess', { fetch: serve([rehashed]).fetchFn, wait: noWait }), /does not hash/);
  });
});

/** A room of a version (protocol §5) with this player in seat 0. */
const versionRoom = (v, content = 'loading', extra = {}) => ({
  code: 'ABCD', mode: 'coop', version: v.id, hostId: 'p1', seats: [{ seat: 0, playerId: 'p1', content }],
  content: { cs: v.cs, vanilla: true, version: v.id, plugins: [] }, ...extra,
});

describe('installContentSet with official versions', () => {
  test('lobby V1 → a room of V2_1 → leave: kept until checked, told only in the room, the round trip downloads nothing twice', async () => {
    const store = createStore(initialState);
    const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({ vanilla: true }) }), retryDelays: [] });
    const requests = [];
    const net = { request: async (t, fields) => { const msg = { t, ...fields }; assert.equal(validateC2S(msg), null); requests.push(msg); return { t: 'ok' }; } };
    const { fetchFn, seen } = serve([V1, V21]);
    const stop = installContentSet({ store, data, net, fetch: fetchFn, toast: () => {}, wait: noWait });
    try {
      store.set({ me: { playerId: 'p1', name: 'A', token: null }, versions: sanitizeVersions([{ ...V1.entry }, { ...V21.entry }, { id: 'act2autochess', cs: 'ef'.repeat(32), default: true }]) });
      await tick();
      assert.equal(contentSet.get().status, 'idle', 'the server\'s default: nothing to load');
      // the lobby switch: this browser's choice
      store.set({ lobbyVersion: 'act1autochess' });
      assert.deepEqual([contentSet.get().kind, contentSet.get().version, contentSet.get().status], ['version', 'act1autochess', 'loading']);
      await until(() => contentSet.get().status === 'ready', 'V1 loaded');
      assert.equal(data.get('config').version.id, 'act1autochess', 'every screen reads 第一期下半');
      assert.equal(pageVersion(), 'act1autochess');
      assert.equal(requests.length, 0, 'the lobby tells no room');
      // join a room of 第二期上半: V1 stays on screen until V2_1 is checked
      store.set({ room: versionRoom(V21) });
      assert.equal(contentSet.get().status, 'loading');
      assert.equal(data.get('config').version.id, 'act1autochess', 'no 第二期下半 in between');
      await until(() => contentSet.get().status === 'ready', 'V2_1 loaded');
      assert.equal(data.get('config').version.id, 'act2autochess@V2_1');
      await until(() => requests.length === 1, 'told');
      assert.deepEqual(requests[0], { t: 'room.contentReady', cs: V21.cs });
      const sim = simContent();
      assert.deepEqual([sim.cs, sim.version, sim.bounds.v, typeof sim.data.chess], [V21.cs, 'act2autochess@V2_1', 1, 'object'], 'the runner gets the version\'s data and its bounds');
      assert.equal((await contentFor(V21.cs)).cs, V21.cs);
      // a reconnect: the seat shows loading again while the page holds the set — told again
      store.set({ room: versionRoom(V21, 'loading', { seats: [{ seat: 0, playerId: 'p1', content: 'loading' }] }) });
      await until(() => requests.length === 2, 'told again');
      store.set({ room: versionRoom(V21, 'ready') });
      await tick();
      assert.equal(requests.length, 2, 'not while the seat shows it');
      // leave: the lobby's V1 again, from the kept sets
      const before = seen.length;
      store.set({ room: null });
      assert.equal(contentSet.get().status, 'ready');
      assert.equal(data.get('config').version.id, 'act1autochess');
      assert.equal(seen.length, before, 'nothing downloaded again');
      assert.equal(requests.length, 2, 'nothing told from the lobby');
      // back to the default: the server's files
      store.set({ lobbyVersion: 'act2autochess' });
      assert.equal(contentSet.get().status, 'idle');
      assert.equal(data.contentId(), null);
      assert.equal(pageVersion(), 'act2autochess');
      assert.ok(VERSION_CACHE >= 2);
    } finally { stop(); }
  });

  test('a gameplay plugin room inside a version lobby: the plugins\' own path (from the original data), the lobby version back after', async () => {
    // a minimal content set of gameplay plugins (DESIGN §32.6): one file of the server's own data
    const buf = fs.readFileSync(path.join(ROOT, 'data/config.json'));
    const sha256 = sha256Hex(new Uint8Array(buf));
    const plugins = [{ id: 'demo', version: '1.0.0', files: {} }];
    const dataEntry = { config: { url: `/data/config.json?v=${sha256.slice(0, 8)}`, sha256, bytes: buf.length } };
    const cs = contentHashOf({ app: 'a', sim: 's', data: { config: sha256 }, plugins, settings: {} });
    const set = { cs, bodies: new Map([[dataEntry.config.url, buf], [`/cs/${cs.slice(0, 16)}/index.json`, Buffer.from(JSON.stringify({ cs, app: 'a', sim: 's', vanilla: false, data: dataEntry, plugins, settings: {} }))]]) };
    const store = createStore(initialState);
    const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({ vanilla: true }) }), retryDelays: [] });
    const requests = [];
    const net = { request: async (t, fields) => { requests.push({ t, ...fields }); return { t: 'ok' }; } };
    const stop = installContentSet({ store, data, net, fetch: serve([V1, set]).fetchFn, toast: () => {}, wait: noWait });
    try {
      store.set({ me: { playerId: 'p1', name: 'A', token: null }, versions: sanitizeVersions([{ ...V1.entry }]), lobbyVersion: 'act1autochess' });
      await until(() => contentSet.get().status === 'ready' && contentSet.get().kind === 'version', 'V1 loaded');
      store.set({ room: { code: 'WXYZ', mode: 'coop', hostId: 'p1', seats: [{ seat: 0, playerId: 'p1', content: 'loading' }], content: { cs, vanilla: false, plugins: [{ id: 'demo', version: '1.0.0', class: 'content' }] } } });
      assert.equal(contentSet.get().kind, 'plugins');
      assert.equal(data.contentId(), null, 'a plugin room starts from the original data, as before M1');
      await until(() => contentSet.get().status === 'ready', 'the plugin set loaded');
      assert.equal(pageVersion(), 'act2autochess', 'gameplay plugins play 第二期下半');
      assert.equal(data.get('config').version, undefined);
      await until(() => requests.length === 1, 'told');
      assert.deepEqual(requests[0], { t: 'room.contentReady', cs });
      store.set({ room: null });
      assert.deepEqual([contentSet.get().kind, contentSet.get().status], ['version', 'ready'], 'the lobby\'s version again (kept)');
      assert.equal(data.get('config').version.id, 'act1autochess');
    } finally { stop(); }
  });

  test('a room whose content does not name its version yet keeps the page as it is; a version room seen as a spectator is told too', async () => {
    const store = createStore(initialState);
    const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({}) }), retryDelays: [] });
    const requests = [];
    const net = { request: async (t, fields) => { requests.push({ t, ...fields }); return { t: 'ok' }; } };
    const stop = installContentSet({ store, data, net, fetch: serve([V1, V21]).fetchFn, toast: () => {}, wait: noWait });
    try {
      store.set({ me: { playerId: 'p2', name: 'B', token: null }, versions: sanitizeVersions([{ ...V1.entry }, { ...V21.entry }]) });
      store.set({ room: { ...versionRoom(V1), content: { cs: 'ab'.repeat(32), vanilla: true, plugins: [] } } });
      await tick();
      assert.equal(contentSet.get().status, 'idle', 'the content does not name V1: nothing loaded');
      store.set({ room: { ...versionRoom(V1), spectators: [{ playerId: 'p2', content: 'loading' }] } });
      await until(() => requests.length === 1, 'a spectator tells too');
      assert.deepEqual(requests[0], { t: 'room.contentReady', cs: V1.cs });
    } finally { stop(); }
  });

  test('a failure is said once and told to the room; 重试 loads it again', async () => {
    const store = createStore(initialState);
    const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({}) }), retryDelays: [] });
    const requests = [];
    const toasts = [];
    const net = { request: async (t, fields) => { requests.push({ t, ...fields }); return { t: 'ok' }; } };
    const bad = versionServed('act1autochess@V1_1', 'act1autochess-v1_1');
    const chessUrl = [...bad.bodies.keys()].find((u) => u.includes('/chess.json'));
    let broken = true;
    const fetchFn = async (url) => (broken ? serve([bad], { flip: chessUrl }) : serve([bad])).fetchFn(url);
    const stop = installContentSet({ store, data, net, fetch: fetchFn, toast: (text, kind) => toasts.push([text, kind]), wait: noWait });
    try {
      store.set({ me: { playerId: 'p1', name: 'A', token: null }, versions: sanitizeVersions([{ ...bad.entry }]) });
      store.set({ room: versionRoom(bad) });
      await until(() => contentSet.get().status === 'failed', 'failed');
      assert.equal(data.contentId(), null, 'the server\'s files, never another version under this one\'s name');
      await until(() => requests.length === 1, 'told');
      assert.deepEqual(requests[0], { t: 'room.contentReady', cs: bad.cs, ok: false });
      assert.equal(toasts.length, 1);
      assert.equal(toasts[0][1], 'error');
      store.set({ room: { ...versionRoom(bad, 'failed') } });
      await tick();
      assert.equal(toasts.length, 1, 'said once');
      broken = false;
      retryContentSet();
      await until(() => contentSet.get().status === 'ready', 'loaded on retry');
      assert.equal(data.get('config').version.id, 'act1autochess@V1_1');
    } finally { stop(); }
  });

  test('data.js: a version set\'s texts stay Chinese in another language (versionFiles — the language folder is keyed by 第二期下半)', async () => {
    const store = createStore(initialState);
    const overlay = { lang: 'en', files: { chess: { records: {} }, config: { records: {} } }, names: {} };
    const data = createDataStore({ fetch: async (url) => ({ ok: true, json: async () => (String(url).includes('/i18n/') ? overlay : { vanilla: true }) }), retryDelays: [] });
    const stop = installContentSet({ store, data, net: null, fetch: serve([V1]).fetchFn, toast: () => {}, wait: noWait });
    try {
      await data.setLocale('en');
      store.set({ versions: sanitizeVersions([{ ...V1.entry }]), lobbyVersion: 'act1autochess' });
      await until(() => contentSet.get().status === 'ready', 'V1 loaded');
      const raw = data.getRaw('chess');
      assert.equal(data.get('chess'), raw, 'no overlay of the language folder over another version\'s records');
    } finally { stop(); }
  });
});
