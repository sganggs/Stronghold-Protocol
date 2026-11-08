import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from '../helpers/contentFixtures.js';
import { scriptFixture } from '../helpers/scriptFixtures.js';
import { readPluginManifest, pluginSupportsVersion } from '../../shared/plugins/manifest.js';
import { contentHashOf } from '../../shared/plugins/identity.js';
import { officialBoundsOf, officialBbMax, rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { DEFAULT_VERSION, VERSIONS } from '../../shared/versions.js';
import { ERR } from '../../shared/constants.js';
import { ROOT, getData, getVersionData } from '../../server/data.js';
import { computeVanillaContent } from '../../server/plugins/identity.js';
import { DATA_SHIM_JS } from '../../server/http/static.js';
import { createVersionSets } from '../../server/versions.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { createRoomSets } from '../../server/plugins/roomSets.js';
import { createPluginPolicy } from '../../server/plugins/policy.js';
import { createMatchHosts } from '../../server/match/host/index.js';
import { checkPluginFolder } from '../../server/plugins/pack.js';
import { editMeta, openPlugin } from '../../server/studio/edit.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { checkGameplayFolder } from '../../server/studio/gameplayCheck.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { createDataStore } from '../../public/js/data.js';
import { createStore, initialState } from '../../public/js/store.js';
import { loadContentSet, installContentSet, contentSet, pageVersion, simContent } from '../../public/js/content.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';

const REG = 'act3autochess@V3_1';
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const vanilla = computeVanillaContent({ dataDir: path.join(ROOT, 'data'), simDir: path.join(ROOT, 'server/sim'), sharedDir: path.join(ROOT, 'shared'), shim: DATA_SHIM_JS });
const versions = createVersionSets({ enabled: VERSIONS.map(v => v.id), vanilla, defaultData: getData(), log: quiet });
const patch = { patch: 1, ops: [{ op: 'set', file: 'config', path: ['economy', 'income', 1], value: 42 }] };
const ok = r => assert.ok(r.ok, JSON.stringify(r));

function add(f, id, supported) {
  f.put(id, { ...(supported ? { versions: supported } : {}), data: ['patch.json'] }, { 'patch.json': patch });
}
function harness(t, f, policyConfig = {}) {
  const pluginsDir = f.pluginsDir || path.join(f.dir, 'plugins');
  fs.writeFileSync(path.join(pluginsDir, 'config.json'), JSON.stringify(policyConfig));
  const policy = createPluginPolicy({ pluginsDir, log: quiet });
  const contents = createContentSets({ registry: f.registry, vanillaData: getData(), versions, maxSets: () => policy.get().maxSets });
  const plugins = createRoomSets({ registry: f.registry, visual: null, contents, policy });
  const warnings = [];
  const lobby = new Lobby({ registry: new SessionRegistry(), content: vanilla, versions, plugins,
    log: { ...quiet, warn: s => warnings.push(s) }, options: { versionProposeGapMs: 0 } });
  t.after(() => { lobby.shutdown(); contents.close(); });
  const player = name => { const p = lobby.registry.create(name); p.connected = true; return p; };
  return { lobby, player, contents, plugins, warnings };
}

test('manifest versions validate, catalogue preserves the declaration, absence is permanently act2-only', t => {
  const base = { manifest: 2, id: 'demo', version: '1.0.0', app: '*', api: 1, class: 'content' };
  for (const value of [[], null, REG, ['unknown'], [REG, REG], [4]]) {
    const r = readPluginManifest({ ...base, versions: value }, { id: 'demo' });
    assert.equal(r.manifest, null);
    assert.ok(r.issues.some(p => p.code === 'PLUGIN_VERSIONS'));
  }
  const legacy = readPluginManifest(base, { id: 'demo' }).manifest;
  assert.equal(pluginSupportsVersion(legacy, DEFAULT_VERSION), true);
  assert.equal(pluginSupportsVersion(legacy, REG), false);
  assert.equal(pluginSupportsVersion({ ...legacy, class: 'cosmetic' }, REG), true);
  const f = fixture(t);
  add(f, 'demo', [REG]);
  assert.deepEqual(f.registry.pluginIndex().plugins.find(p => p.id === 'demo').versions, [REG]);
});

test('Studio manifest edits and import checks retain explicit versions and include them in plugin identity', t => {
  const f = fixture(t);
  add(f, 'studio-demo', [REG]);
  const dir = path.join(f.dir, 'plugins', 'studio-demo');
  const files = createPluginFiles(path.join(f.dir, 'plugins'));
  const before = buildContentSet({ registry: f.registry, ids: ['studio-demo'], version: REG });
  assert.deepEqual(before.problems, []);
  const opened = openPlugin(files, 'studio-demo');
  assert.throws(() => editMeta(opened, { versions: [] }), e => e.code === 'PLUGIN_VERSIONS');
  editMeta(opened, { versions: [REG, DEFAULT_VERSION] });
  opened.save();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'))).versions, [REG, DEFAULT_VERSION]);
  assert.deepEqual(checkPluginFolder(dir).problems, []);
  assert.equal(checkGameplayFolder(dir, { strict: false, updateLock: false }).ok, true);
  f.registry.rescan();
  const after = buildContentSet({ registry: f.registry, ids: ['studio-demo'], version: REG });
  assert.deepEqual(after.problems, []);
  assert.notEqual(before.cs, after.cs, 'manifest versions participates in plugin identity even on the same base');
});

test('compositions use the selected official base, bounds, URLs and hash; pages load the version; limits span versions', async t => {
  const f = fixture(t);
  add(f, 'both', [DEFAULT_VERSION, REG]);
  const contents = createContentSets({ registry: f.registry, vanillaData: getData(), versions, maxSets: () => 1 });
  t.after(() => contents.close());
  rememberOfficialBounds(getData());
  const cap = officialBbMax('attack_speed');
  const reg = contents.resolve(['both'], { version: REG });
  ok(reg);
  const base = getVersionData(REG);
  assert.equal(reg.set.data.config.version.id, REG);
  assert.equal(reg.set.data.config.economy.income[1], 42);
  assert.deepEqual(reg.set.data.chess, base.chess);
  assert.deepEqual(reg.set.bounds, officialBoundsOf(base));
  assert.equal(officialBbMax('attack_speed'), cap, 'composition restores main-process act2 bounds');
  assert.notEqual(reg.set.cs, versions.csOf(REG));
  assert.equal(contents.resolve(['both'], { version: REG }).set, reg.set, 'memoized by version');
  const act2 = contents.resolve(['both']);
  ok(act2);
  assert.notEqual(reg.set.cs, act2.set.cs);
  assert.equal(act2.set.data.config.version, undefined);
  assert.equal(contentHashOf({ ...reg.set.hashInput, version: DEFAULT_VERSION }) === reg.set.cs, false, 'version is hashed independently of data');
  const fetch = async url => {
    const body = url.startsWith('/cs/') ? contents.file(url.split('/')[2], url.split('/').slice(3).join('/'))?.body
      : fs.readFileSync(path.join(ROOT, url.split('?')[0].slice(1)));
    return { ok: !!body, arrayBuffer: async () => new Uint8Array(body).buffer };
  };
  const loaded = await loadContentSet(reg.set.cs, { fetch, retryDelays: [] });
  assert.equal(loaded.version, REG);
  assert.equal(loaded.values.get('config').economy.income[1], 42);
  assert.match(loaded.index.data.chess.url, /^\/data\/versions\/act3autochess-v3_1\//);
  assert.match(loaded.index.data.config.url, /^\/cs\//);
  const store = createStore(initialState);
  const data = createDataStore({ fetch: async () => ({ ok: true, json: async () => ({}) }), retryDelays: [] });
  const ready = [];
  const stop = installContentSet({ store, data, fetch, retryDelays: [], net: { request: async (type, fields) => { ready.push({ type, ...fields }); } } });
  try {
    store.set({ me: { playerId: 'host' }, room: { version: REG, seats: [{ playerId: 'host', content: 'loading' }],
      content: { cs: reg.set.cs, version: REG, vanilla: false, plugins: [{ id: 'both', class: 'content' }] } } });
    for (let i = 0; i < 400 && contentSet.get().status === 'loading'; i++) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(contentSet.get().status, 'ready');
    assert.equal(contentSet.get().kind, 'plugins');
    assert.equal(contentSet.get().version, REG);
    assert.equal(pageVersion(), REG);
    assert.equal(data.get('config').economy.income[1], 42);
    assert.equal(simContent().version, REG);
    assert.deepEqual(ready, [{ type: 'room.contentReady', cs: reg.set.cs }]);
  } finally { stop(); }
  contents.hold(reg.set.cs);
  assert.equal(contents.resolve(['both']).error, ERR.PLUGIN_BUSY);
  ok(contents.resolve(['both'], { replacing: reg.set.cs }));
});

test('room selection and unanimous proposals check every gameplay plugin, preserving composed data across the switch', t => {
  const f = fixture(t);
  add(f, 'reg-only', [REG]); add(f, 'legacy'); add(f, 'both', [DEFAULT_VERSION, REG]);
  f.put('dependent', { versions: [REG], requires: { legacy: '*' } });
  const { lobby, player, contents } = harness(t, f);
  const host = player('Host'), guest = player('Guest');
  ok(lobby.create(host, { mode: 'coop', version: REG }));
  const room = lobby.roomOf(host);
  assert.equal(lobby.setPlugins(host, { plugins: [{ id: 'legacy' }] }).error, ERR.VERSION_UNSUPPORTED);
  assert.equal(lobby.setPlugins(host, { plugins: [{ id: 'dependent' }] }).error, ERR.VERSION_UNSUPPORTED);
  ok(lobby.setPlugins(host, { plugins: [{ id: 'reg-only' }] }));
  assert.equal(room.content.version, REG);
  assert.equal(room.content.vanilla, false);
  assert.equal(lobby.dataFor(room).config.economy.income[1], 42);
  assert.equal(lobby.proposeVersion(host, { version: DEFAULT_VERSION }).error, ERR.VERSION_UNSUPPORTED);
  ok(lobby.setPlugins(host, { plugins: [{ id: 'both' }] }));
  const before = room.content.cs;
  ok(lobby.join(guest, { code: room.code }));
  ok(lobby.proposeVersion(host, { version: DEFAULT_VERSION }));
  assert.equal(room.version, REG);
  ok(lobby.versionVote(guest, { voteId: room.versionVote.id, agree: true }));
  assert.equal(room.version, DEFAULT_VERSION);
  assert.equal(room.content.vanilla, false);
  assert.notEqual(room.content.cs, before);
  assert.equal(lobby.dataFor(room).config.version, undefined);
  assert.equal(lobby.dataFor(room).config.economy.income[1], 42);
  assert.equal(contents.inUse(), 1);
  assert.equal(lobby.setPlugins(host, { plugins: [{ id: 'reg-only' }] }).error, ERR.VERSION_UNSUPPORTED);
  ok(lobby.proposeVersion(host, { version: REG }));
  ok(lobby.versionVote(guest, { voteId: room.versionVote.id, agree: true }));
  assert.equal(room.content.cs, before);
  // A manifest can change while humans vote; do not silently drop gameplay on completion.
  ok(lobby.proposeVersion(host, { version: DEFAULT_VERSION }));
  add(f, 'both', [REG]);
  assert.equal(lobby.versionVote(guest, { voteId: room.versionVote.id, agree: true }).error, ERR.VERSION_UNSUPPORTED);
  assert.equal(room.version, REG);
  assert.equal(room.content.cs, before);
});

test('room.create keeps compatible defaults, warns once for others, and fixed rooms reject only unsupported versions', t => {
  const f = fixture(t);
  add(f, 'legacy'); add(f, 'reg-only', [REG]); add(f, 'both', [DEFAULT_VERSION, REG]);
  const h = harness(t, f, { default: ['legacy', 'reg-only', 'both'] });
  for (const name of ['A', 'B']) {
    const p = h.player(name);
    ok(h.lobby.create(p, { mode: 'solo', version: REG }));
    assert.deepEqual(h.lobby.roomOf(p).content.plugins.map(p => p.id).sort(), ['both', 'reg-only']);
  }
  assert.equal(h.warnings.length, 1);
  const p = h.player('Default');
  ok(h.lobby.create(p, { mode: 'solo' }));
  assert.deepEqual(h.lobby.roomOf(p).content.plugins.map(p => p.id).sort(), ['both', 'legacy']);
  const fixed = harness(t, f, { rooms: 'fixed', default: ['reg-only'] });
  const q = fixed.player('Fixed');
  ok(fixed.lobby.create(q, { mode: 'solo', version: REG }));
  assert.equal(fixed.lobby.create(q, { mode: 'solo' }).error, ERR.VERSION_UNSUPPORTED);
  assert.equal(fixed.lobby.roomOf(q).version, REG, 'refusal preserves the old room');
  const all = harness(t, f, { rooms: 'fixed', default: ['both'] });
  for (const version of [DEFAULT_VERSION, REG]) ok(all.lobby.create(all.player(version), { mode: 'solo', version }));
});

async function runMatch(t, contents, cs) {
  const hosts = createMatchHosts({ contents, log: quiet, options: { virtualTime: true, matchOptions: { botRehearsal: 0 } } });
  t.after(() => hosts.close());
  let end;
  const done = new Promise(resolve => { end = resolve; });
  const match = hosts.create(cs, { roomCode: 'VPLG', mode: 'coop', difficulty: 'FUNNY', modeId: 'mode_multi_funny', version: REG,
    seats: Array.from({ length: 2 }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `Bot ${i}`, isBot: true, connected: true })),
    spectators: [], seed: 7, matchNo: 1, cs, requireCs: true, broadcast() {}, send() { return true; }, onEnd: end });
  assert.equal(match.hosted, true);
  match.start();
  const summary = await done;
  assert.equal(typeof summary.victory, 'boolean', JSON.stringify(summary));
  assert.ok(summary.roundsPassed >= 1);
  const diag = await match.diag();
  assert.equal(diag.version, REG);
  assert.equal(diag.cs, cs);
  assert.equal(diag.errorCount, 0, JSON.stringify(diag.errors));
  assert.equal(diag.simErrors, 0);
  assert.notEqual(hosts._host(cs).kind, 'version', 'uses the limited plugin pool');
  match.dispose();
}

test('a regulation content match completes normally in the plugin host', { timeout: 180_000 }, async t => {
  const f = fixture(t); add(f, 'reg-only', [REG]);
  const { lobby, player, contents } = harness(t, f);
  const host = player('Host');
  ok(lobby.create(host, { mode: 'coop', version: REG }));
  ok(lobby.setPlugins(host, { plugins: [{ id: 'reg-only' }] }));
  const room = lobby.roomOf(host);
  const captured = [];
  lobby.hosts = { create(cs, opts) { captured.push({ cs, opts }); return { hosted: true, start() {}, dispose() {} }; } };
  ok(lobby.contentReady(host, { cs: room.content.cs }));
  ok(await lobby.start(host));
  assert.equal(captured[0].opts.data.config.economy.income[1], 42, 'the room passes its patched version data into match wiring');
  assert.equal(captured[0].opts.version, REG);
  await runMatch(t, contents, room.content.cs);
});

test('a regulation sandbox script is admitted and completes in the plugin host', { timeout: 180_000 }, async t => {
  const old = process.env.SP_PLUGIN_SCRIPTS;
  process.env.SP_PLUGIN_SCRIPTS = 'sandbox';
  t.after(() => { if (old === undefined) delete process.env.SP_PLUGIN_SCRIPTS; else process.env.SP_PLUGIN_SCRIPTS = old; });
  const f = scriptFixture(t, { mode: 'sandbox', host: '0.0.0.0', log: quiet });
  f.put('reg-script', `export default sp => { sp.meta.register('global:reg-script', { onRoundStart(ctx) { ctx.addFunds(1); } }); };`,
    { versions: [REG], permissions: ['meta.code'], entry: { meta: 'index.js' } });
  const contents = createContentSets({ registry: f.registry, vanillaData: getData(), versions });
  t.after(() => contents.close());
  const roomSets = createRoomSets({ registry: f.registry, visual: null, contents, policy: null });
  const r = roomSets.resolve(['reg-script'], { version: REG });
  ok(r);
  assert.equal(r.set.execution, 'sandbox');
  assert.equal(roomSets.resolve(['reg-script']).error, ERR.VERSION_UNSUPPORTED);
  assert.equal(buildContentSet({ registry: f.registry, ids: ['reg-script'] }).problems[0].code, ERR.VERSION_UNSUPPORTED);
  await runMatch(t, contents, r.set.cs);
});

test('trusted gameplay declarations use the same official-version gate', t => {
  const f = scriptFixture(t, { log: quiet });
  f.put('reg-trusted', 'export default () => {};',
    { class: 'trusted', versions: [REG], permissions: ['meta.code'], entry: { meta: 'index.js' } });
  const contents = createContentSets({ registry: f.registry, vanillaData: getData(), versions });
  t.after(() => contents.close());
  const sets = createRoomSets({ registry: f.registry, visual: null, contents, policy: null });
  const r = sets.resolve(['reg-trusted'], { version: REG });
  ok(r);
  assert.equal(r.set.execution, 'trusted');
  assert.equal(r.set.trusted.plugins[0].id, 'reg-trusted');
  assert.equal(sets.resolve(['reg-trusted']).error, ERR.VERSION_UNSUPPORTED);
});
