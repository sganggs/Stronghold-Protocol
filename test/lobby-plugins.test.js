// test/lobby-plugins.test.js — the room's plugins (DESIGN §32 P1a, server/lobby.js setPlugins; shared/protocol.js
// room.setPlugins): the host switches cosmetic plugins on before the match — room.state.content names the set (`vs`, the
// plugins, their warnings and size) while `cs` stays the vanilla one (art never changes a battle: the match and its
// BattleSpecs get the vanilla cs), the other humans are un-readied, the same set again changes nothing, an empty list
// brings back exactly the vanilla shape; refused: a player who is not the host, a running match, an unknown plugin, a
// plugin of another class or scope, a malformed message, a lobby given no visual sets. A plugin of the room's set that
// changes on disk: the host (only) is told once to apply the plugins again, and the same list then makes the set of the
// files as they are now. A real server in-process with a plugins folder of its own (art generated on the spot).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { png, writePlugin, cosmetic } from './helpers/pluginFixtures.js';
import { fileURLToPath } from 'node:url';
import { EMOTES, ERR } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { layVisualOps, prepareVisualDoc } from '../shared/plugins/visual.js';
import { contentHashOf } from '../shared/plugins/identity.js';
import { nodeSha256 } from '../server/plugins/identity.js';
import { DEFAULT_POLICY, readPolicy, createPluginPolicy } from '../server/plugins/policy.js';
import { ROOT } from '../server/data.js';

class RecordingStub extends StubMatch {
  static last = null;
  constructor(o) { super(o); RecordingStub.last = o; }
}

describe('room.setPlugins (P1a: cosmetic plugins)', () => {
  let srv;
  let tmp;
  const open = [];
  const player = async (name) => {
    const c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
    open.push(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    c.welcome = w;
    return c;
  };
  const room = async (host, mode = 'coop') => {
    assert.equal((await host.request({ t: 'room.create', mode, difficulty: 'NORMAL' })).t, 'ok');
    return host.waitFor('room.state', (s) => s.hostId === host.id);
  };

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lobby-plugins-'));
    const plugins = path.join(tmp, 'plugins');
    writePlugin(path.join(plugins, 'texas-red'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(4, 4) });
    writePlugin(path.join(plugins, 'texas-blue'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'b.png' } } } }), { 'b.png': png(4, 4, [0, 0, 255, 255]) });
    writePlugin(path.join(plugins, 'mine'), cosmetic({ scope: ['personal'], assets: { chars: { char_102_texas: { avatar: 'm.png' } } } }), { 'm.png': png(2, 2) });
    writePlugin(path.join(plugins, 'rules'), { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', permissions: ['data.patch'], data: ['d.json'] }, { 'd.json': { patch: 1, ops: [] } });
    writePlugin(path.join(plugins, 'base'), cosmetic({ assets: { chars: { char_112_siege: { avatar: 'b.png' } } } }), { 'b.png': png(2, 2) });
    writePlugin(path.join(plugins, 'top'), cosmetic({ requires: { base: '*' }, assets: { chars: { char_102_texas: { avatar: 't.png' } } } }), { 't.png': png(2, 2) });
    writePlugin(path.join(plugins, 'fresh'), cosmetic({ assets: { chars: { char_112_siege: { avatar: 'f.png' } } } }), { 'f.png': png(2, 2, [1, 1, 1, 255]) });
    writePlugin(path.join(plugins, 'later'), cosmetic({ assets: { chars: { char_112_siege: { portrait: 'l.png' } } } }), { 'l.png': png(2, 2, [5, 5, 5, 255]) });
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, MatchClass: RecordingStub, assetIndex: false });
  });
  after(async () => {
    await Promise.all(open.map((c) => c.terminate().catch(() => {})));
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('/healthz and welcome count the server\'s unofficial plugins (the title screen\'s N; a server without any sends no count)', async () => {
    const c = await player('Closure');
    // texas-red, texas-blue, mine, base, top, fresh, later (cosmetic) and rules (content, planned): every class but a language
    assert.deepEqual(c.welcome.content, { vanilla: srv.content.cs, plugins: 8 });
    assert.deepEqual((await (await fetch(`${srv.url}/healthz`)).json()).content, { vanilla: srv.content.cs, sets: 0, plugins: 8 }, 'before any hello: the title screen');
    const lobby = new Lobby({ registry: new SessionRegistry(), content: { cs: 'ab'.repeat(32) }, plugins: { resolve: () => null, unofficial: () => 0 } });
    assert.deepEqual(lobby.welcomeInfo().content, { vanilla: 'ab'.repeat(32) }, 'none: exactly the welcome of a server without plugins');
    lobby.shutdown();
  });

  test('the host switches plugins on: room.state.content names the set, cs stays the vanilla one, the others are un-readied', async () => {
    const host = await player('Kal\'tsit');
    const guest = await player('Amiya');
    const s0 = await room(host);
    assert.deepEqual(s0.content, { cs: srv.content.cs, vanilla: true, plugins: [] }, 'a room without plugins: the vanilla shape of P0');
    assert.equal((await guest.request({ t: 'room.join', code: s0.code })).t, 'ok');
    assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
    await host.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id && x.ready));
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'texas-blue' }, { id: 'texas-red' }] })).t, 'ok');
    const s1 = await guest.waitFor('room.state', (s) => !!s.content?.vs);
    assert.equal(s1.content.cs, srv.content.cs, 'art never changes a battle: the vanilla cs');
    assert.equal(s1.content.vanilla, true);
    assert.match(s1.content.vs, /^[0-9a-f]{64}$/);
    assert.deepEqual(s1.content.plugins.map((p) => [p.id, p.version, p.class]), [['texas-blue', '1.0.0', 'cosmetic'], ['texas-red', '1.0.0', 'cosmetic']], 'in load order (by id)');
    assert.deepEqual(s1.content.warnings, [{ code: 'override', params: { path: 'chars.char_102_texas.avatar', plugins: ['texas-blue', 'texas-red'] } }]);
    assert.ok(s1.content.bytes > 0);
    assert.equal(s1.seats.find((x) => x && x.playerId === guest.id).ready, false, 'un-readied like a difficulty change');
    // the room's set is served: its composition is what room.state named, and a page composing it draws the later plugin
    const doc = await (await fetch(`${srv.url}/vs/${s1.content.vs.slice(0, 16)}/overlay.json`)).json();
    assert.equal(doc.visual.vs, s1.content.vs);
    const view = await (await fetch(`${srv.url}/data/assets.json`)).json();
    assert.match(layVisualOps(view, [prepareVisualDoc(doc)]).manifest.chars.char_102_texas.avatar, /^\/p\/texas-red\//, 'the later plugin applies');
    // the same set again: nothing changes, nobody is un-readied, no room.state
    assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
    await host.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id && x.ready));
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id && x.ready));
    guest.clearInbox();
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'texas-red' }, { id: 'texas-blue' }] })).t, 'ok');
    await guest.expectNone('room.state', () => true, 200);
    // the match gets the vanilla cs
    assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
    await host.waitFor('room.state', (s) => s.inMatch === true);
    assert.equal(RecordingStub.last.cs, srv.content.cs, 'lobby → Match opts.cs: the vanilla one');
    // during the match: refused
    const busy = await host.request({ t: 'room.setPlugins', plugins: [] });
    assert.deepEqual([busy.t, busy.code], ['error', ERR.ROOM_STARTED]);
  });

  test('an empty list brings back exactly the vanilla shape; refused: not the host, unknown, another class or scope, malformed', async () => {
    const host = await player('Doctor');
    const guest = await player('Warfarin');
    const s0 = await room(host);
    assert.equal((await guest.request({ t: 'room.join', code: s0.code })).t, 'ok');
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'texas-red' }] })).t, 'ok');
    await host.waitFor('room.state', (s) => !!s.content?.vs);
    const refuse = async (c, msg, code) => { const r = await c.request(msg); assert.deepEqual([r.t, r.code], ['error', code], JSON.stringify(r)); return r; };
    await refuse(guest, { t: 'room.setPlugins', plugins: [] }, ERR.NOT_HOST);
    await refuse(host, { t: 'room.setPlugins', plugins: [{ id: 'absent' }] }, ERR.PLUGIN_UNKNOWN);
    // (a content plugin is a room's too since P1c: the "room content sets" tests below)
    const scope = await refuse(host, { t: 'room.setPlugins', plugins: [{ id: 'mine' }] }, ERR.PLUGIN_BLOCKED);
    assert.match(scope.detail, /scope room/);
    await refuse(host, { t: 'room.setPlugins', plugins: [{ id: 'Texas' }] }, ERR.BAD_MSG);
    await refuse(host, { t: 'room.setPlugins', plugins: 'texas-red' }, ERR.BAD_MSG);
    await refuse(host, { t: 'room.setPlugins' }, ERR.BAD_MSG);
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [] })).t, 'ok');
    const back = await guest.waitFor('room.state', (s) => !s.content?.vs);
    assert.deepEqual(back.content, { cs: srv.content.cs, vanilla: true, plugins: [] });
  });

  test('「自动」: a plugin switched on because another needs it; chosen later, the same set — broadcast, nobody un-readied', async () => {
    const host = await player('Texas');
    const guest = await player('Lappland');
    const s0 = await room(host);
    assert.equal((await guest.request({ t: 'room.join', code: s0.code })).t, 'ok');
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'top' }] })).t, 'ok');
    const s1 = await host.waitFor('room.state', (s) => !!s.content?.vs);
    assert.deepEqual(s1.content.plugins.map((p) => [p.id, !!p.auto]), [['base', true], ['top', false]]);
    assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
    await host.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id && x.ready));
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'top' }, { id: 'base' }] })).t, 'ok');
    const s2 = await host.waitFor('room.state', (s) => s.content?.plugins?.some((p) => p.id === 'base' && !p.auto));
    assert.equal(s2.content.vs, s1.content.vs, 'the same set');
    assert.equal(s2.seats.find((x) => x && x.playerId === guest.id).ready, true, 'nobody un-readied for a mark');
  });

  test('a plugin of the room\'s set changes on disk: the host is told once to apply again; the same list then makes the new set', async () => {
    const host = await player('Ifrit');
    const guest = await player('Saria');
    const s0 = await room(host);
    assert.equal((await guest.request({ t: 'room.join', code: s0.code })).t, 'ok');
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'fresh' }] })).t, 'ok');
    const s1 = await guest.waitFor('room.state', (s) => !!s.content?.vs);
    host.clearInbox();
    guest.clearInbox();
    fs.writeFileSync(path.join(tmp, 'plugins', 'fresh', 'f.png'), png(2, 2, [2, 2, 2, 255]));
    srv.packs.rescan();
    const toast = await host.waitFor('m.toast', (m) => m.msgid === '房间插件「{names}」的文件在服务器上变了，请在插件面板中点「重新应用」');
    assert.deepEqual([toast.kind, toast.params?.names], ['warn', 'fresh']);
    await guest.expectNone('m.toast', () => true, 150);
    srv.packs.rescan();
    await host.expectNone('m.toast', () => true, 150);
    // 「重新应用」: the same list → the set of the files as they are now
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'fresh' }] })).t, 'ok');
    const s2 = await guest.waitFor('room.state', (s) => !!s.content?.vs && s.content.vs !== s1.content.vs);
    assert.deepEqual(s2.content.plugins.map((p) => p.id), ['fresh']);
    assert.notEqual(s2.content.plugins[0].hash, s1.content.plugins[0].hash);
  });

  test('a plugin that changes during a match: the host hears it once the room is back in its lobby, when it can be applied again', async () => {
    const MSG = '房间插件「{names}」的文件在服务器上变了，请在插件面板中点「重新应用」';
    const host = await player('Mudrock');
    await room(host, 'solo');
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [{ id: 'later' }] })).t, 'ok');
    await host.waitFor('room.state', (s) => !!s.content?.vs);
    assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
    await host.waitFor('room.state', (s) => s.inMatch === true);
    host.clearInbox();
    fs.writeFileSync(path.join(tmp, 'plugins', 'later', 'l.png'), png(2, 2, [6, 6, 6, 255]));
    srv.packs.rescan();
    await host.expectNone('m.toast', (m) => m.msgid === MSG, 200);
    host.send({ t: 'g.infoReady' }); // the stub match ends once every human is ready
    await host.waitFor('room.state', (s) => s.inMatch === false);
    const toast = await host.waitFor('m.toast', (m) => m.msgid === MSG);
    assert.equal(toast.params?.names, 'later');
  });

  test('a room holds its visual set while it uses it: released when it changes and when the room goes', () => {
    const calls = [];
    const plugins = {
      resolve: (ids) => ({ ok: true, set: { vs: (ids.join('-').charCodeAt(0) % 16).toString(16).repeat(64), plugins: ids.map((id) => ({ id, version: '1.0.0', class: 'cosmetic', hash: '0'.repeat(16) })), warnings: [], bytes: 1 } }),
      hold: (vs) => calls.push(['hold', vs.slice(0, 2)]),
      release: (vs) => calls.push(['release', vs.slice(0, 2)]),
    };
    const lobby = new Lobby({ registry: new SessionRegistry(), content: { cs: 'ab'.repeat(32) }, plugins });
    const session = { playerId: 'p1', name: 'A', connected: true, roomCode: null, ws: null };
    assert.deepEqual(lobby.create(session, { mode: 'solo', difficulty: 'NORMAL' }), { ok: true });
    assert.deepEqual(lobby.setPlugins(session, { plugins: [{ id: 'a' }] }), { ok: true });   // 'a' → 1…
    assert.deepEqual(lobby.setPlugins(session, { plugins: [{ id: 'b' }] }), { ok: true });   // 'b' → 2…
    assert.deepEqual(lobby.setPlugins(session, { plugins: [] }), { ok: true });
    assert.deepEqual(lobby.setPlugins(session, { plugins: [{ id: 'a' }] }), { ok: true });
    lobby.leave(session);
    assert.deepEqual(calls, [['hold', '11'], ['hold', '22'], ['release', '11'], ['release', '22'], ['hold', '11'], ['release', '11']]);
    lobby.shutdown();
  });

  test('the host\'s result replay is dropped only when the set changes: the same set again, or a refused one, keeps it', () => {
    const plugins = {
      resolve: (ids) => (ids.includes('absent') ? { error: ERR.PLUGIN_UNKNOWN, detail: 'absent is not installed' }
        : { ok: true, set: { vs: (ids.join('-').charCodeAt(0) % 16).toString(16).repeat(64), plugins: ids.map((id) => ({ id, version: '1.0.0', class: 'cosmetic', hash: '0'.repeat(16) })), warnings: [], bytes: 1 } }),
      hold() {}, release() {},
    };
    const lobby = new Lobby({ registry: new SessionRegistry(), content: { cs: 'ab'.repeat(32) }, plugins });
    const session = { playerId: 'p1', name: 'A', connected: true, roomCode: null, ws: null };
    assert.deepEqual(lobby.create(session, { mode: 'solo', difficulty: 'NORMAL' }), { ok: true });
    const r = lobby.getRoom(session.roomCode);
    assert.deepEqual(lobby.setPlugins(session, { plugins: [{ id: 'a' }] }), { ok: true });
    // a settlement screen still open: the lobby replays its result until the player acts (dropReplay)
    r.replay = { pending: new Set(['p1']), frames: new Map([['p1', { t: 'm.result' }]]), publicFrame: { t: 'm.public' } };
    assert.deepEqual(lobby.setPlugins(session, { plugins: [{ id: 'a' }] }), { ok: true });
    assert.ok(r.replay?.pending.has('p1'), 'the same set again: kept');
    assert.equal(lobby.setPlugins(session, { plugins: [{ id: 'absent' }] }).error, ERR.PLUGIN_UNKNOWN);
    assert.ok(r.replay?.pending.has('p1'), 'a refused set: kept');
    assert.deepEqual(lobby.setPlugins(session, { plugins: [{ id: 'b' }] }), { ok: true });
    assert.equal(r.replay, null, 'another set: the host moved on');
    lobby.shutdown();
  });

  test('the protocol: room.setPlugins { plugins: [{ id, settings? }] } — plugin ids, ≤ 32, scalar settings', () => {
    assert.equal(validateC2S({ t: 'room.setPlugins', plugins: [] }), null);
    assert.equal(validateC2S({ t: 'room.setPlugins', plugins: [{ id: 'texas-red', settings: { a: 1, b: 'x', c: true } }] }), null);
    for (const plugins of [[{ id: 'A' }], [{ id: 'x' }], [{}], [{ id: 'ok-id', settings: { a: {} } }], Array.from({ length: 33 }, (_, i) => ({ id: `p${i}x` })), null]) {
      assert.equal(validateC2S({ t: 'room.setPlugins', plugins }), 'bad field plugins', JSON.stringify(plugins).slice(0, 60));
    }
  });

  test('a lobby given no visual sets refuses any plugin; an empty list is fine', () => {
    const lobby = new Lobby({ registry: new SessionRegistry(), content: { cs: 'ab'.repeat(32) } });
    const session = { playerId: 'p1', name: 'A', connected: true, roomCode: null, ws: null };
    lobby.registry.add?.(session);
    assert.deepEqual(lobby.create(session, { mode: 'solo', difficulty: 'NORMAL' }), { ok: true });
    assert.equal(lobby.setPlugins(session, { plugins: [{ id: 'texas-red' }] }).error, ERR.PLUGIN_UNKNOWN);
    assert.deepEqual(lobby.setPlugins(session, { plugins: [] }), { ok: true });
    assert.deepEqual(lobby.getRoom(session.roomCode).toState().content, { cs: 'ab'.repeat(32), vanilla: true, plugins: [] });
    lobby.shutdown();
  });
});

// ---- P1c (DESIGN §32.6): room content sets — gameplay plugins in a room ----------------------------------------------
// room.setPlugins with content plugins gives the room a content set of its own (its own cs, `vanilla: false`), served at
// /cs/<cs16>/ (the manifest recomputes cs; a patched file's bytes hash to its entry), seats[].content until every page
// checked it (room.contentReady: ready and start wait — CONTENT_NOT_READY), the match in that set's match host worker
// (the test fixture's StubMatch probes what the worker runs: the patched data, opts.cs / requireCs / modeId); requirements
// switched on (「自动」), conflicts / incompatible / not the host / during the match refused; room.setMode among the
// official modes and the set's plugin modes; settings in the cs; a content plugin with a cosmetic one (cs and vs);
// loadouts checked against the room's data and filtered at a later vanilla start; a dropped page checks again; the
// server owner's maxSets (PLUGIN_BUSY) and default set; the room's queue answers a worker room's requests in order.
describe('room content sets (P1c: gameplay plugins)', () => {
  const FIXTURE = fileURLToPath(new URL('./match/fixtures/hostMatch.js', import.meta.url));
  const bondPatch = (value) => ({ patch: 1, ops: [['bb', 'base_def'], ['buffs', 0, 'bb', 'base_def']].map((p) => ({ op: 'set', file: 'bonds', id: 'deputShip', path: p, value })) });
  const content = (extra = {}) => ({ manifest: 2, name: { zh: '测试数据', en: 'Test data' }, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'], permissions: ['data.patch', 'data.add'], ...extra });
  let srv;
  let tmp;
  const open = [];
  const player = async (name, s = srv) => {
    const c = await TestClient.connect(s.url.replace('http', 'ws') + '/ws');
    open.push(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    c.token = w.token;
    return c;
  };
  // (15 s per answer: a content set's first build and a match host's first worker take a while on a loaded machine)
  const ok = async (c, msg) => { const r = await c.request(msg, 15000); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
  const refuse = async (c, msg, code) => { const r = await c.request(msg, 15000); assert.deepEqual([r.t, r.code], ['error', code], `${msg.t}: ${JSON.stringify(r)}`); return r; };
  const seatOf = (s, id) => s.seats.find((x) => x && x.playerId === id) || null;
  const room = async (host, mode = 'coop') => {
    await ok(host, { t: 'room.create', mode, difficulty: 'NORMAL' });
    return host.waitFor('room.state', (s) => s.hostId === host.id);
  };
  // (a content set's cs covers its translation files' hashes too: index.i18n, by language)
  const csOf = (index) => contentHashOf({ app: index.app, sim: index.sim, data: Object.fromEntries(Object.entries(index.data).map(([k, v]) => [k, v.sha256])), plugins: index.plugins, settings: index.settings,
    ...(index.i18n && Object.keys(index.i18n).length ? { i18n: index.i18n } : {}) });

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lobby-content-'));
    const plugins = path.join(tmp, 'plugins');
    writePlugin(path.join(plugins, 'bond-def'), content({ data: ['patch.json'] }), { 'patch.json': bondPatch(0.3) });
    writePlugin(path.join(plugins, 'bond-max'), content({ data: ['patch.json'], conflicts: { 'bond-def': '*' } }), { 'patch.json': bondPatch(0.5) });
    writePlugin(path.join(plugins, 'base-pack'), content({ data: ['patch.json'] }), { 'patch.json': { patch: 1, ops: [] } });
    writePlugin(path.join(plugins, 'needs-base'), content({ data: ['patch.json'], requires: { 'base-pack': '*' } }), { 'patch.json': { patch: 1, ops: [] } });
    writePlugin(path.join(plugins, 'old-rules'), content({ app: '<0.2.0', data: ['patch.json'] }), { 'patch.json': { patch: 1, ops: [] } });
    writePlugin(path.join(plugins, 'marathon'), content({ modes: ['modes/long.json', 'modes/solo.json'] }), {
      'modes/long.json': { id: 'mode_x_marathon_long', base: 'mode_multi_normal', set: { name: '马拉松·险境' } },
      'modes/solo.json': { id: 'mode_x_marathon_solo', base: 'mode_single_hard', set: { name: '马拉松·独立' } },
    });
    writePlugin(path.join(plugins, 'tuned'), content({ data: ['patch.json'], settings: { def: { type: 'number', min: 0, max: 1, default: 0.5 } } }), { 'patch.json': bondPatch({ $setting: 'def' }) });
    // the content template's operator (a new operator: char_x_data_demo_guard)
    const tpl = path.join(ROOT, 'plugins', '_template', 'content');
    writePlugin(path.join(plugins, 'data-demo'), content({ operators: ['operators/guard.json'] }), { 'operators/guard.json': fs.readFileSync(path.join(tpl, 'operators', 'guard.json'), 'utf8') });
    writePlugin(path.join(plugins, 'skin'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(4, 4) });
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, MatchClass: RecordingStub, assetIndex: false,
      matchHost: { matchModule: FIXTURE } });
  });
  after(async () => {
    await Promise.all(open.map((c) => c.terminate().catch(() => {})));
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('a content plugin: the room gets a content set of its own — served, checked by every page, played in its match host', async () => {
    const host = await player('Kal\'tsit');
    const guest = await player('Amiya');
    const s0 = await room(host);
    assert.ok(s0.seats.every((x) => !x || !('content' in x)), 'a vanilla room\'s seats name no content state');
    await ok(guest, { t: 'room.join', code: s0.code });
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready === true);
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'bond-def' }] });
    const s1 = await guest.waitFor('room.state', (s) => s.content?.vanilla === false);
    assert.notEqual(s1.content.cs, srv.content.cs, 'a content set of its own');
    assert.deepEqual(s1.content.plugins.map((p) => [p.id, p.class, p.version]), [['bond-def', 'content', '1.0.0']]);
    assert.match(s1.content.plugins[0].hash, /^[0-9a-f]{16}$/);
    assert.equal(s1.content.vs, undefined);
    assert.ok(s1.content.dataBytes > 0);
    assert.deepEqual(s1.content.modes, []);
    assert.equal(seatOf(s1, guest.id).ready, false, 'un-readied like a difficulty change');
    for (const seat of s1.seats.filter(Boolean)) assert.equal(seat.content, 'loading');

    // served: the manifest recomputes cs; the patched file's bytes hash to its entry; an unchanged file keeps its plain URL
    const res = await fetch(`${srv.url}/cs/${s1.content.cs.slice(0, 16)}/index.json`);
    assert.match(res.headers.get('cache-control') || '', /immutable/);
    const index = await res.json();
    assert.equal(index.cs, s1.content.cs);
    assert.equal(index.vanilla, false);
    assert.equal(csOf(index), s1.content.cs, 'a page can recompute cs from the manifest');
    assert.match(index.data.bonds.url, /^\/cs\/[0-9a-f]{16}\/data\/bonds\.json$/);
    const bytes = Buffer.from(await (await fetch(srv.url + index.data.bonds.url)).arrayBuffer());
    assert.equal(nodeSha256(bytes), index.data.bonds.sha256);
    assert.equal(JSON.parse(bytes.toString('utf8')).deputShip.bb.base_def, 0.3);
    assert.match(index.data.chess.url, /^\/data\/chess\.json\?v=[0-9a-f]{8}$/);
    assert.equal((await fetch(`${srv.url}/cs/${'0'.repeat(16)}/index.json`)).status, 404);
    assert.equal((await fetch(`${srv.url}/cs/${s1.content.cs.slice(0, 16)}/data/../plugin.json`)).status, 404);

    // ready and start wait for the pages' checks
    await refuse(guest, { t: 'room.ready', ready: true }, ERR.CONTENT_NOT_READY);
    await ok(guest, { t: 'room.contentReady', cs: 'ab'.repeat(32) }); // another (older) set: nothing recorded
    await ok(guest, { t: 'room.contentReady', cs: s1.content.cs, ok: false });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.content === 'failed');
    await ok(guest, { t: 'room.contentReady', cs: s1.content.cs });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.content === 'ready');
    await ok(guest, { t: 'room.ready', ready: true });
    await refuse(host, { t: 'room.start' }, ERR.CONTENT_NOT_READY); // the host's page too
    await ok(host, { t: 'room.contentReady', cs: s1.content.cs });
    const before = RecordingStub.last;
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch === true);
    assert.equal(RecordingStub.last, before, 'not an in-process match');
    assert.equal(srv.hosts.stats().workers, 1);
    assert.equal((await (await fetch(`${srv.url}/healthz`)).json()).content.sets, 1, '/healthz counts the content sets in use');

    // the worker's match runs the content set: its data, the room's cs, the cs check on
    await ok(host, { t: 'g.emote', id: EMOTES[0] });
    const probe = await host.waitFor('m.toast', (m) => /^probe;/.test(m.text || ''), 5000);
    assert.match(probe.text, new RegExp(`;cs=${s1.content.cs};`));
    assert.match(probe.text, /;requireCs=true;/);
    assert.match(probe.text, /;bond=0\.3;/, 'the patched bond reached the worker');
    assert.match(probe.text, /;modeId=mode_multi_normal;/);
    // during the match: refused
    await refuse(host, { t: 'room.setPlugins', plugins: [] }, ERR.ROOM_STARTED);
    await refuse(host, { t: 'room.setMode', modeId: 'mode_multi_hard' }, ERR.ROOM_STARTED);
    // the stub ends once every human is ready: back in the lobby, the pages' checks still stand
    host.clearInbox();
    await ok(host, { t: 'g.infoReady' });
    await ok(guest, { t: 'g.infoReady' });
    const back = await host.waitFor('room.state', (s) => s.inMatch === false, 5000);
    assert.equal(seatOf(back, guest.id).content, 'ready');
  });

  test('requirements switched on (「自动」); refused: a conflict, a plugin for other versions, not the host, unknown', async () => {
    const host = await player('Texas');
    const guest = await player('Lappland');
    const s0 = await room(host);
    await ok(guest, { t: 'room.join', code: s0.code });
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'needs-base' }] });
    const s1 = await host.waitFor('room.state', (s) => s.content?.plugins?.length === 2);
    assert.deepEqual(s1.content.plugins.map((p) => [p.id, !!p.auto]), [['base-pack', true], ['needs-base', false]]);
    assert.equal(s1.content.vanilla, false);
    await refuse(host, { t: 'room.setPlugins', plugins: [{ id: 'bond-def' }, { id: 'bond-max' }] }, ERR.PLUGIN_CONFLICT);
    await refuse(host, { t: 'room.setPlugins', plugins: [{ id: 'old-rules' }] }, ERR.PLUGIN_INCOMPATIBLE);
    await refuse(guest, { t: 'room.setPlugins', plugins: [{ id: 'bond-def' }] }, ERR.NOT_HOST);
    await refuse(host, { t: 'room.setPlugins', plugins: [{ id: 'nope-plugin' }] }, ERR.PLUGIN_UNKNOWN);
    // the room keeps its set after a refusal; an empty list brings back exactly the vanilla shape
    assert.equal((await host.request({ t: 'room.setPlugins', plugins: [] })).t, 'ok');
    const back = await guest.waitFor('room.state', (s) => s.content?.vanilla === true);
    assert.deepEqual(back.content, { cs: srv.content.cs, vanilla: true, plugins: [] });
    assert.ok(back.seats.every((x) => !x || !('content' in x)));
  });

  test('room.setMode: the official modes of the room\'s type and the plugin modes of its set; the match plays the one chosen', async () => {
    const host = await player('Ifrit');
    const guest = await player('Saria');
    const s0 = await room(host);
    await ok(guest, { t: 'room.join', code: s0.code });
    await refuse(host, { t: 'room.setMode', modeId: 'mode_x_marathon_long' }, ERR.BAD_TARGET); // no such mode yet
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'marathon' }] });
    const s1 = await host.waitFor('room.state', (s) => s.content?.modes?.length === 2);
    assert.deepEqual(s1.content.modes.map((m) => [m.id, m.roomMode, m.difficulty, m.name]),
      [['mode_x_marathon_long', 'coop', 'NORMAL', '马拉松·险境'], ['mode_x_marathon_solo', 'solo', 'HARD', '马拉松·独立']]);
    await ok(guest, { t: 'room.contentReady', cs: s1.content.cs });
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready === true);
    await ok(host, { t: 'room.setMode', modeId: 'mode_x_marathon_long' });
    const s2 = await guest.waitFor('room.state', (s) => s.content?.modeId === 'mode_x_marathon_long');
    assert.equal(s2.difficulty, 'NORMAL');
    assert.equal(seatOf(s2, guest.id).ready, false, 'un-readied like a difficulty change');
    await refuse(host, { t: 'room.setMode', modeId: 'mode_x_marathon_solo' }, ERR.BAD_TARGET); // a solo room's mode
    await refuse(guest, { t: 'room.setMode', modeId: 'mode_multi_hard' }, ERR.NOT_HOST);
    // an official mode sets the difficulty and leaves the plugin mode
    await ok(host, { t: 'room.setMode', modeId: 'mode_multi_hard' });
    const s3 = await guest.waitFor('room.state', (s) => s.difficulty === 'HARD');
    assert.equal(s3.content.modeId, undefined);
    // a difficulty leaves it too
    await ok(host, { t: 'room.setMode', modeId: 'mode_x_marathon_long' });
    await guest.waitFor('room.state', (s) => s.content?.modeId === 'mode_x_marathon_long');
    await ok(host, { t: 'room.setDifficulty', difficulty: 'ABYSS' });
    const s4 = await guest.waitFor('room.state', (s) => s.difficulty === 'ABYSS');
    assert.equal(s4.content.modeId, undefined);
    // the match plays the mode chosen (the worker's data has it)
    await ok(host, { t: 'room.setMode', modeId: 'mode_x_marathon_long' });
    await guest.waitFor('room.state', (s) => s.content?.modeId === 'mode_x_marathon_long');
    await ok(guest, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.contentReady', cs: s1.content.cs });
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch === true);
    await ok(host, { t: 'g.emote', id: EMOTES[0] });
    const probe = await host.waitFor('m.toast', (m) => /^probe;/.test(m.text || ''), 5000);
    assert.match(probe.text, /;modeId=mode_x_marathon_long;/);
    assert.match(probe.text, /;plugin-modes=mode_x_marathon_long,mode_x_marathon_solo;/);
    await ok(host, { t: 'g.infoReady' });
    await ok(guest, { t: 'g.infoReady' });
    await host.waitFor('room.state', (s) => s.inMatch === false, 5000);
    // switching the plugins off takes the plugin mode with it
    await ok(host, { t: 'room.setPlugins', plugins: [] });
    const s5 = await guest.waitFor('room.state', (s) => s.content?.vanilla === true);
    assert.equal(s5.content.modeId, undefined);
  });

  test('settings are part of the cs (a value out of range is the default); a content plugin with a cosmetic one has cs and vs', async () => {
    const host = await player('Mudrock');
    await room(host, 'solo');
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'tuned' }] });
    const a = await host.waitFor('room.state', (s) => s.content?.vanilla === false);
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'tuned', settings: { def: 0.7 } }] });
    const b = await host.waitFor('room.state', (s) => s.content?.vanilla === false && s.content.cs !== a.content.cs);
    const index = await (await fetch(`${srv.url}/cs/${b.content.cs.slice(0, 16)}/index.json`)).json();
    assert.equal(index.settings.tuned.def, 0.7);
    const patched = JSON.parse(Buffer.from(await (await fetch(srv.url + index.data.bonds.url)).arrayBuffer()).toString('utf8'));
    assert.equal(patched.deputShip.bb.base_def, 0.7);
    // out of range → the default: the same set as without settings (nothing changes, no room.state)
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'tuned', settings: { def: 5 } }] });
    const c = await host.waitFor('room.state', (s) => s.content?.cs === a.content.cs);
    assert.equal(c.content.cs, a.content.cs);
    // art and gameplay together: the room's cs is the content set's, `vs` its art
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'skin' }, { id: 'bond-def' }] });
    const m = await host.waitFor('room.state', (s) => s.content?.vanilla === false && !!s.content.vs);
    assert.match(m.content.vs, /^[0-9a-f]{64}$/);
    assert.deepEqual(m.content.plugins.map((p) => [p.id, p.class]), [['bond-def', 'content'], ['skin', 'cosmetic']]);
    assert.equal((await fetch(`${srv.url}/vs/${m.content.vs.slice(0, 16)}/overlay.json`)).status, 200);
  });

  test('a room.contentReady queued before its page disconnected marks nothing; the page that comes back checks the set again', async () => {
    // the review's sequence (MED-3): a guest's g.* waits on the match host, its contentReady queues behind it, the guest's
    // socket closes, the queue drains — once with the guest still away, once with it back before the queue drained
    const CS = 'cd'.repeat(32);
    const plugins = {
      resolve: () => ({ ok: true, set: { cs: CS, plugins: [{ id: 'rules', version: '1.0.0', class: 'content', hash: '0'.repeat(16) }], warnings: [], bytes: 0, dataBytes: 1, modes: [] } }),
      hold() {}, release() {}, holdContent() {}, releaseContent() {},
    };
    for (const backBeforeDrain of [false, true]) {
      const lobby = new Lobby({ registry: new SessionRegistry(), content: { cs: 'ab'.repeat(32) }, plugins });
      const host = { playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null };
      const guest = { playerId: 'p_guest', name: 'G', connected: true, roomCode: null, ws: null };
      assert.deepEqual(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
      assert.deepEqual(lobby.join(guest, { code: host.roomCode }), { ok: true });
      assert.deepEqual(lobby.setPlugins(host, { plugins: [{ id: 'rules' }] }), { ok: true });
      const room = lobby.getRoom(host.roomCode);
      assert.equal(room.modded, true);
      const seat = room.seatOf(guest.playerId);
      let release = () => {};
      const gate = new Promise((r) => { release = r; });
      room.match = { hosted: true, handle: () => gate.then(() => ({ ok: true })), onDisconnect() {}, onReconnect() {}, onLeave() {}, dispose() {} };
      const g = lobby.onMessage(guest, { t: 'g.emote', id: EMOTES[0] });
      const told = lobby.onMessage(guest, { t: 'room.contentReady', cs: CS });       // 1. queued behind the match
      assert.equal(seat.content, null);
      guest.connected = false;
      lobby.onDisconnect(guest);                                                       // 2. the page goes
      assert.deepEqual([seat.content, seat.connected], [null, false]);
      const back = () => { guest.connected = true; lobby.onHello(guest, { resumed: true, repeat: false }); };
      if (backBeforeDrain) back();
      release();                                                                       // 3. the queue drains
      assert.deepEqual(await g, { ok: true });
      assert.deepEqual(await told, { ok: true });
      assert.equal(seat.content, null, `the queued contentReady wrote nothing (${backBeforeDrain ? 'back before' : 'away when'} it ran)`);
      if (!backBeforeDrain) back();                                                    // 4. the page comes back
      assert.deepEqual([seat.content, seat.connected], [null, true], 'the new page has checked nothing yet');
      // 5. / 6. back in the lobby: no ready and no start until that page checks the set
      room.match = null;
      assert.deepEqual(lobby.contentReady(host, { cs: CS }), { ok: true });
      assert.equal(lobby.ready(guest, { ready: true }).error, ERR.CONTENT_NOT_READY);
      seat.ready = true; // (a ready flag that survived would not help either)
      assert.equal(lobby.start(host).error, ERR.CONTENT_NOT_READY);
      seat.ready = false;
      // the page checks it: now it counts (on the room's queue, if anything of it is still settling)
      assert.deepEqual(await lobby.onMessage(guest, { t: 'room.contentReady', cs: CS }), { ok: true });
      assert.equal(seat.content, 'ready');
      assert.deepEqual(lobby.ready(guest, { ready: true }), { ok: true });
      lobby.shutdown();
    }
  });

  test('a burst of room.setPlugins with junk settings builds the set once (settings as the builder reads them)', async () => {
    const host = await player('Ifrit');
    await room(host, 'solo');
    const before = srv.contents.stats().builds;
    // the heavy bucket's burst (6): every request a new junk key beside the same declared value
    for (let i = 0; i < 6; i++) await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'tuned', settings: { def: 0.25, junk: `j${i}` } }] });
    assert.equal(srv.contents.stats().builds - before, 1, 'one build for six requests');
    const st = await host.waitFor('room.state', (s) => s.content?.vanilla === false);
    const index = await (await fetch(`${srv.url}/cs/${st.content.cs.slice(0, 16)}/index.json`)).json();
    assert.deepEqual(index.settings.tuned, { def: 0.25 }, 'the junk key is no part of the set');
    await ok(host, { t: 'room.leave' });
  });

  test('loadouts are checked against the room\'s data; a stored one of another content is filtered when a match starts', async () => {
    const host = await player('Ptilopsis');
    await room(host, 'solo');
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'data-demo' }] });
    const s1 = await host.waitFor('room.state', (s) => s.content?.vanilla === false);
    assert.deepEqual(s1.content.kittedExtra, ['char_x_data_demo_guard'], 'the operator a 自选 slot may field here, beside welcome\'s');
    // the plugin's operator is an operator of this room: its 练度 is accepted here (a 潜能 is not: it has no curve) …
    await refuse(host, { t: 'room.loadout', entries: {}, ops: { char_x_data_demo_guard: { potential: 3 } } }, ERR.BAD_TARGET);
    const loadout = { t: 'room.loadout', entries: {}, ops: { char_x_data_demo_guard: { cultivate: 2 }, char_102_texas: { potential: 2 } } };
    await ok(host, loadout);
    await ok(host, { t: 'room.contentReady', cs: s1.content.cs });
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch === true);
    await ok(host, { t: 'g.emote', id: EMOTES[0] });
    const probe = await host.waitFor('m.toast', (m) => /^probe;/.test(m.text || ''), 5000);
    assert.match(probe.text, /"char_x_data_demo_guard":\{"potential":6,"cultivate":2\}/, 'the room\'s match takes it');
    await ok(host, { t: 'room.leave' });
    // … refused in a vanilla room (strict, nothing stored) — and the one stored loses its unknown operator at the start
    await room(host, 'solo');
    await refuse(host, loadout, ERR.BAD_TARGET);
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch === true);
    assert.deepEqual(RecordingStub.last.seats[0].ops, { char_102_texas: { potential: 2, cultivate: 3 } }, 'the vanilla match never sees the plugin operator');
    await ok(host, { t: 'room.leave' });
  });

  test('room.card (名片干员) of a plugin operator: taken in its room, left off a vanilla room\'s seat — the session keeps it', async () => {
    const OP = 'char_x_data_demo_guard';
    const host = await player('Lappland');
    await room(host, 'solo');
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'data-demo' }] });
    await host.waitFor('room.state', (s) => s.content?.vanilla === false);
    await ok(host, { t: 'room.card', charId: OP });
    await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card === OP);
    await ok(host, { t: 'room.leave' });
    // a new vanilla room checks the card again when the player takes the seat (server/lobby.js humanSeat)
    const plain = await room(host, 'solo');
    assert.ok(!('card' in seatOf(plain, host.id)), 'a room without the operator shows no card for it');
    assert.equal(srv.registry.byId(host.id).card, OP, 'the session keeps it (the page sends the card it can show: installCardSync)');
    await refuse(host, { t: 'room.card', charId: OP }, ERR.BAD_MSG);
    await ok(host, { t: 'room.leave' });
  });

  test('a page that drops checks the content again; the room\'s queue answers a worker room\'s requests in order', async () => {
    const host = await player('Skadi');
    const guest = await player('Specter');
    const s0 = await room(host);
    await ok(guest, { t: 'room.join', code: s0.code });
    await ok(host, { t: 'room.setPlugins', plugins: [{ id: 'bond-def' }] });
    const s1 = await host.waitFor('room.state', (s) => s.content?.vanilla === false);
    await ok(guest, { t: 'room.contentReady', cs: s1.content.cs });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.content === 'ready');
    await guest.terminate();
    const dropped = await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.connected === false);
    assert.equal(seatOf(dropped, guest.id).content, 'loading', 'a page that comes back (a reload) checks again');
    const again = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
    open.push(again);
    await again.hello('Specter', guest.token);
    const st = await again.waitFor('room.state', (s) => seatOf(s, guest.id)?.connected === true);
    assert.equal(seatOf(st, guest.id).content, 'loading');
    await ok(again, { t: 'room.contentReady', cs: s1.content.cs });
    await ok(again, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.contentReady', cs: s1.content.cs });
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch === true);
    // several requests at once: answered in the order they were sent (the room's queue, one at a time)
    const rids = [];
    const replies = [];
    const want = new Set();
    for (let i = 0; i < 6; i++) { const rid = host.send({ t: 'g.emote', id: EMOTES[0] }); rids.push(rid); want.add(rid); }
    while (want.size) {
      const m = await host.waitFor(null, (x) => (x.t === 'ok' || x.t === 'error') && want.has(x.rid), 5000);
      want.delete(m.rid);
      replies.push(m.rid);
    }
    assert.deepEqual(replies, rids, 'in order');
    await ok(host, { t: 'g.infoReady' });
    await ok(again, { t: 'g.infoReady' });
    await host.waitFor('room.state', (s) => s.inMatch === false, 5000);
  });

  test('the protocol: room.setMode { modeId } and room.contentReady { cs, ok? }', () => {
    assert.equal(validateC2S({ t: 'room.setMode', modeId: 'mode_x_marathon_long' }), null);
    assert.equal(validateC2S({ t: 'room.setMode' }), 'bad field modeId');
    assert.equal(validateC2S({ t: 'room.setMode', modeId: 'a b' }), 'bad field modeId');
    assert.equal(validateC2S({ t: 'room.contentReady', cs: 'ab'.repeat(32) }), null);
    assert.equal(validateC2S({ t: 'room.contentReady', cs: 'ab'.repeat(32), ok: false }), null);
    assert.equal(validateC2S({ t: 'room.contentReady', cs: 'AB'.repeat(32) }), 'bad field cs');
    assert.equal(validateC2S({ t: 'room.contentReady', cs: 'ab'.repeat(32), ok: 'no' }), 'bad field ok');
  });
});

describe('the server owner\'s policy and the content-set limit (P1c)', () => {
  const content = (extra = {}) => ({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'], permissions: ['data.patch'], data: ['p.json'], ...extra });
  const open = [];
  const servers = [];
  const dirs = [];
  /** A server whose plugins folder holds two content plugins and the policy `config`. */
  async function serverWith(config) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-policy-'));
    dirs.push(tmp);
    const plugins = path.join(tmp, 'plugins');
    writePlugin(path.join(plugins, 'one'), content(), { 'p.json': { patch: 1, ops: [] } });
    writePlugin(path.join(plugins, 'two'), content(), { 'p.json': { patch: 1, ops: [] } });
    if (config) fs.writeFileSync(path.join(plugins, 'config.json'), JSON.stringify(config));
    const s = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, MatchClass: RecordingStub, assetIndex: false });
    servers.push(s);
    return s;
  }
  /** A request or a wait that builds a content set: the 15 s the other P1c tests give one (about 1 s alone, more under a full run). */
  const BUILD_MS = 15000;
  const player = async (s, name) => {
    const c = await TestClient.connect(s.url.replace('http', 'ws') + '/ws');
    open.push(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    return c;
  };
  after(async () => {
    await Promise.all(open.map((c) => c.terminate().catch(() => {})));
    for (const s of servers) await s.close();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  test('limits.maxSets: one content set more than rooms hold is PLUGIN_BUSY; a set already held, or the one a room gives up, is free', async () => {
    const s = await serverWith({ limits: { maxSets: 1 } });
    const a = await player(s, 'A');
    const b = await player(s, 'B');
    for (const c of [a, b]) { assert.equal((await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }, BUILD_MS)).t, 'ok'); await c.waitFor('room.state', undefined, BUILD_MS); }
    assert.equal((await a.request({ t: 'room.setPlugins', plugins: [{ id: 'one' }] }, BUILD_MS)).t, 'ok');
    const builds = s.contents.stats().builds;
    const busy = await b.request({ t: 'room.setPlugins', plugins: [{ id: 'two' }] }, BUILD_MS);
    assert.deepEqual([busy.t, busy.code], ['error', ERR.PLUGIN_BUSY]);
    assert.equal(s.contents.stats().builds, builds, 'refused before it was built');
    assert.equal((await b.request({ t: 'room.setPlugins', plugins: [{ id: 'one' }] }, BUILD_MS)).t, 'ok', 'the set already held');
    // A gives it up; B (its only holder now) switches to another one: freed by the change
    assert.equal((await a.request({ t: 'room.setPlugins', plugins: [] }, BUILD_MS)).t, 'ok');
    assert.equal((await b.request({ t: 'room.setPlugins', plugins: [{ id: 'two' }] }, BUILD_MS)).t, 'ok');
    const st = await b.waitFor('room.state', (x) => x.content?.plugins?.[0]?.id === 'two', BUILD_MS);
    assert.equal(st.content.vanilla, false);
  });

  test('limits.maxSets and room.create: the set of the room its creator leaves (its only holder) is freed for the default set', async () => {
    const s = await serverWith({ limits: { maxSets: 1 }, default: ['one'] });
    const a = await player(s, 'A');
    assert.equal((await a.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }, BUILD_MS)).t, 'ok');
    await a.waitFor('room.state', (x) => x.content?.plugins?.[0]?.id === 'one', BUILD_MS);
    // the room switches to another set (freed by the change): the server is at its limit with a set the default is not
    assert.equal((await a.request({ t: 'room.setPlugins', plugins: [{ id: 'two' }] }, BUILD_MS)).t, 'ok');
    const old = await a.waitFor('room.state', (x) => x.content?.plugins?.[0]?.id === 'two', BUILD_MS);
    // a new room: the old one goes with the create, so the default set fits (not PLUGIN_BUSY → the original game)
    assert.equal((await a.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }, BUILD_MS)).t, 'ok');
    const st = await a.waitFor('room.state', (x) => x.code !== old.code, BUILD_MS);
    assert.deepEqual([st.content.vanilla, st.content.plugins.map((p) => p.id)], [false, ['one']]);
  });

  test('rooms: fixed — every room starts with the default set and its host cannot change it; allow — only the listed plugins', async () => {
    const s = await serverWith({ rooms: 'fixed', default: ['one'] });
    const a = await player(s, 'A');
    assert.equal((await a.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }, BUILD_MS)).t, 'ok');
    const st = await a.waitFor('room.state', (x) => x.content?.vanilla === false, BUILD_MS);
    assert.deepEqual(st.content.plugins.map((p) => p.id), ['one']);
    const r = await a.request({ t: 'room.setPlugins', plugins: [] }, BUILD_MS);
    assert.deepEqual([r.t, r.code], ['error', ERR.PLUGIN_BLOCKED]);
    assert.equal((await a.request({ t: 'room.setPlugins', plugins: [{ id: 'one' }] }, BUILD_MS)).t, 'ok', 'the fixed set itself');
    const s2 = await serverWith({ allow: ['one'] });
    const b = await player(s2, 'B');
    assert.equal((await b.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }, BUILD_MS)).t, 'ok');
    const st2 = await b.waitFor('room.state', undefined, BUILD_MS);
    assert.equal(st2.content.vanilla, true, 'no default: the original game');
    const no = await b.request({ t: 'room.setPlugins', plugins: [{ id: 'two' }] }, BUILD_MS);
    assert.deepEqual([no.t, no.code], ['error', ERR.PLUGIN_BLOCKED]);
    assert.equal((await b.request({ t: 'room.setPlugins', plugins: [{ id: 'one' }] }, BUILD_MS)).t, 'ok');
  });

  test('readPolicy: defaults, every field checked, SP_PLUGINS wins over the file', () => {
    assert.deepEqual(readPolicy(null, { env: {} }).policy, DEFAULT_POLICY);
    const r = readPolicy({ rooms: 'nope', default: ['Bad Id'], allow: 'all', classes: { content: 'yes' }, limits: { maxSets: -1 }, allowIncompatible: 1 }, { env: {} });
    assert.deepEqual(r.policy, DEFAULT_POLICY);
    assert.equal(r.problems.length, 6);
    const off = readPolicy({ rooms: 'host', limits: { maxSets: 2 }, classes: { content: false } }, { env: { SP_PLUGINS: 'off' } }).policy;
    assert.deepEqual([off.rooms, off.maxSets, off.classes.content], ['off', 2, false]);
    // classes not listed are denied (the review's LOW-6): only the ones switched on pass
    const pol = createPluginPolicy({ pluginsDir: null, env: {} });
    assert.deepEqual(['cosmetic', 'content', 'script', 'ui', 'trusted', 'lang', 'toString', '__proto__'].map((c) => pol.allows('x', c)), [true, true, false, false, false, false, false, false]);
  });
});
