// test/lobby-versions.test.js — rooms of an official version and the host's version switch (DESIGN §35.23, M1;
// server/lobby.js header "Official versions"): room.create { version }, room.proposeVersion / room.versionVote /
// room.cancelVersionVote (modelled on 重刷: a lone human switches at once, the seated humans vote, a decline cancels, a
// 60 s expiry, a 5 s guard after a declined or expired vote), what voids a vote, what a switch does to the room, the
// content gate, the settings filter by charId and where a version room's match runs. A Lobby over a `versions` stub of the
// real version data (server/data.js getVersionData) with made-up cs values, and once over the real server/versions.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { DATA_DIR, ROOT, getData, getVersionData, lookup } from '../server/data.js';
import { createVersionSets } from '../server/versions.js';
import { createRoomSets } from '../server/plugins/roomSets.js';
import { createContentSets } from '../server/plugins/contentSets.js';
import { createPluginRegistry } from '../server/plugins/registry.js';
import { createPluginPolicy } from '../server/plugins/policy.js';
import { writePlugin } from './helpers/pluginFixtures.js';
import { computeVanillaContent } from '../server/plugins/identity.js';
import { DATA_SHIM_JS } from '../server/http/static.js';
import { DIFFICULTIES, ERR, modeIdFor } from '../shared/constants.js';
import { checkNotOwned, validateC2S } from '../shared/protocol.js';
import { DEFAULT_VERSION, VERSIONS, versionById } from '../shared/versions.js';

const VANILLA = 'a0'.repeat(32);
const CS = { 'act2autochess@V2_1': 'b1'.repeat(32), act1autochess: 'c1'.repeat(32), 'act1autochess@V1_1': 'd1'.repeat(32) };
const ALL = VERSIONS.map((v) => v.id);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** A server/versions.js look-alike over the real version data (the cs values made up). */
function versionStub({ enabled = ALL, defaultId = DEFAULT_VERSION, roomModes = {} } = {}) {
  const ids = ALL.filter((id) => enabled.includes(id));
  const csOf = (id) => (!ids.includes(id) ? null : id === DEFAULT_VERSION ? VANILLA : CS[id]);
  const data = (id) => (!ids.includes(id) ? null : id === DEFAULT_VERSION ? getData() : getVersionData(id));
  const modesOf = (id) => roomModes[id] || versionById(id).roomModes;
  return {
    ids, defaultId, nonDefault: ids.filter((id) => id !== DEFAULT_VERSION),
    isEnabled: (id) => ids.includes(id),
    csOf,
    content: (id) => (!ids.includes(id) ? null : id === DEFAULT_VERSION
      ? Object.freeze({ cs: VANILLA, vanilla: true, plugins: Object.freeze([]) })
      : Object.freeze({ cs: CS[id], vanilla: true, version: id, plugins: Object.freeze([]) })),
    data,
    dataOfCs: (cs) => { const id = ids.find((x) => csOf(x) === cs); return id ? data(id) : null; },
    offered: (id, mode) => {
      if (!ids.includes(id) || !modesOf(id).includes(mode)) return [];
      const modes = data(id).config.modes;
      return DIFFICULTIES.filter((d) => Object.hasOwn(modes, modeIdFor(mode, d)));
    },
    welcome: () => (ids.length === 1 && ids[0] === DEFAULT_VERSION ? null : ids.map((id) => ({ id, cs: csOf(id) }))),
  };
}

/** A recording match class (a version room's match runs here only because the test gives its own MatchClass). */
class Rec {
  static last = null;
  constructor(opts) { this.opts = opts; Rec.last = opts; }
  start() {}
  dispose() {}
}

/** A lobby, its sessions and the frames each got. */
function harness({ versions = versionStub(), versionHosts = null, plugins = null, MatchClass = Rec, options = {}, now = null } = {}) {
  const registry = new SessionRegistry();
  const clock = { t: 1_000_000 };
  const lobby = new Lobby({ registry, log: quiet, MatchClass, content: { cs: VANILLA }, getData, versions, versionHosts, plugins,
    now: now || (() => clock.t), options });
  const frames = new Map();
  const player = (name) => {
    const s = registry.create(name);
    s.connected = true;
    s.disconnectedAt = null;
    const box = [];
    frames.set(s.playerId, box);
    s.ws = { readyState: 1, bufferedAmount: 0, send(data) { box.push(JSON.parse(data)); }, terminate() {} };
    return s;
  };
  const last = (s, t = 'room.state') => [...frames.get(s.playerId)].reverse().find((m) => m.t === t) || null;
  const toasts = (s) => frames.get(s.playerId).filter((m) => m.t === 'm.toast');
  const clear = () => { for (const box of frames.values()) box.length = 0; };
  return { lobby, registry, player, last, toasts, clear, clock };
}

const ok = (r) => assert.deepEqual(r, { ok: true });
const refused = (r, code, detail) => {
  assert.equal(r?.error, code, JSON.stringify(r));
  if (detail) assert.equal(r.detail, detail);
};

test('room.create frees the sole-held old room set for default plugins at maxSets (without a socket)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-version-content-limit-'));
  let contents;
  let h;
  try {
    const pluginsDir = path.join(tmp, 'plugins');
    for (const id of ['one', 'two']) writePlugin(path.join(pluginsDir, id), {
      manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'], permissions: ['data.patch'], data: ['p.json'],
    }, { 'p.json': { patch: 1, ops: [] } });
    fs.writeFileSync(path.join(pluginsDir, 'config.json'), JSON.stringify({ limits: { maxSets: 1 }, default: ['one'] }));
    const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), dataDir: DATA_DIR, packsDir: tmp, pluginsDir }, { log: quiet });
    registry.refresh(true);
    const policy = createPluginPolicy({ pluginsDir, log: quiet, env: {} });
    contents = createContentSets({ registry, vanillaData: getData(), log: quiet, maxSets: () => policy.get().maxSets });
    const plugins = createRoomSets({ registry, visual: null, contents, policy });
    h = harness({ plugins });
    const p = h.player('Host');
    ok(h.lobby.create(p, { mode: 'solo' }));
    ok(h.lobby.setPlugins(p, { plugins: [{ id: 'two' }] }));
    const oldCode = p.roomCode;
    assert.equal(contents.inUse(), 1);
    ok(h.lobby.create(p, { mode: 'solo' }));
    assert.equal(h.lobby.getRoom(oldCode), null);
    assert.deepEqual(h.last(p).content.plugins.map((x) => x.id), ['one']);
    assert.equal(h.last(p).content.vanilla, false);
    assert.equal(contents.inUse(), 1);
  } finally {
    h?.lobby.shutdown();
    contents?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** A co-op room with `n` humans (the first one the host). */
function coop(h, n, extra = {}) {
  const people = Array.from({ length: n }, (_, i) => h.player(`P${i}`));
  ok(h.lobby.create(people[0], { mode: 'coop', difficulty: 'NORMAL', ...extra }));
  const code = people[0].roomCode;
  for (const p of people.slice(1)) ok(h.lobby.join(p, { code }));
  return { people, room: h.lobby.getRoom(code) };
}

test('protocol: room.create version and the three vote messages', () => {
  assert.equal(validateC2S({ t: 'room.create', mode: 'coop', version: 'act1autochess@V1_1' }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'coop' }), null);
  assert.notEqual(validateC2S({ t: 'room.create', mode: 'coop', version: 'ACT1' }), null);
  assert.notEqual(validateC2S({ t: 'room.create', mode: 'coop', version: '../x' }), null);
  assert.equal(validateC2S({ t: 'room.proposeVersion', version: 'act1autochess' }), null);
  assert.notEqual(validateC2S({ t: 'room.proposeVersion' }), null);
  assert.equal(validateC2S({ t: 'room.versionVote', voteId: 3, agree: false }), null);
  assert.notEqual(validateC2S({ t: 'room.versionVote', voteId: 0, agree: true }), null);
  assert.notEqual(validateC2S({ t: 'room.versionVote', voteId: 3 }), null);
  assert.equal(validateC2S({ t: 'room.cancelVersionVote', voteId: 1 }), null);
  assert.notEqual(validateC2S({ t: 'room.cancelVersionVote', voteId: 'x' }), null);
});

test('a lone human switches at once — solo, and co-op with AI teammates: version, cs, seats loading, replay gone', () => {
  for (const mode of ['solo', 'coop']) {
    const h = harness();
    const p = h.player('Solo');
    ok(h.lobby.create(p, { mode, difficulty: 'NORMAL' }));
    const room = h.lobby.getRoom(p.roomCode);
    if (mode === 'coop') { ok(h.lobby.addBot(p)); ok(h.lobby.addBot(p)); }
    room.replay = { publicFrame: null, frames: new Map([[p.playerId, '{}']]), pending: new Set([p.playerId]) };
    h.clear();
    ok(h.lobby.proposeVersion(p, { version: 'act1autochess' }));
    assert.equal(room.version, 'act1autochess');
    assert.equal(room.versionVote, null);
    assert.equal(room.replay, null);
    const st = h.last(p);
    assert.equal(st.version, 'act1autochess');
    assert.deepEqual(st.content, { cs: CS.act1autochess, vanilla: true, version: 'act1autochess', plugins: [] });
    assert.equal(st.seats[0].content, 'loading');
    assert.equal(st.versionVote, undefined);
    for (const s of st.seats.filter((x) => x && x.isBot)) assert.equal(s.content, undefined, 'AI seats load nothing');
    // and back to 第二期下半: exactly the default shape again
    h.clock.t += 10_000;
    ok(h.lobby.proposeVersion(p, { version: DEFAULT_VERSION }));
    const back = h.last(p);
    assert.equal(Object.hasOwn(back, 'version'), false);
    assert.deepEqual(back.content, { cs: VANILLA, vanilla: true, plugins: [] });
    assert.equal(Object.hasOwn(back.seats[0], 'content'), false);
    h.lobby.shutdown();
  }
});

test('unanimous agreement switches; one decline cancels with a toast to all, then the 5 s guard', () => {
  const h = harness();
  const { people: [a, b, c], room } = coop(h, 3);
  ok(h.lobby.addBot(a));
  h.clear();
  ok(h.lobby.proposeVersion(a, { version: 'act2autochess@V2_1' }));
  const v = h.last(c).versionVote;
  assert.deepEqual(v, { id: 1, proposerId: a.playerId, version: 'act2autochess@V2_1', voters: [a.playerId, b.playerId, c.playerId], agreed: [a.playerId], remainingMs: 60_000 });
  assert.equal(room.version, DEFAULT_VERSION, 'nothing switched yet');
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess' }), ERR.VERSION_VOTE);
  h.clock.t += 1500;
  ok(h.lobby.versionVote(b, { voteId: 1, agree: true }));
  assert.deepEqual(h.last(a).versionVote.agreed, [a.playerId, b.playerId]);
  assert.equal(h.last(a).versionVote.remainingMs, 58_500, 'a duration by the lobby clock');
  ok(h.lobby.versionVote(b, { voteId: 1, agree: true }), 'agreeing twice changes nothing');
  ok(h.lobby.versionVote(c, { voteId: 1, agree: true }));
  assert.equal(room.version, 'act2autochess@V2_1');
  assert.equal(h.last(b).versionVote, undefined);
  assert.equal(h.last(b).version, 'act2autochess@V2_1');

  // a decline: cancelled, every member told, 5 s before the next proposal
  h.clock.t += 1000;
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  assert.equal(room.versionVote.id, 2);
  h.clear();
  ok(h.lobby.versionVote(c, { voteId: 2, agree: false }));
  assert.equal(room.versionVote, null);
  assert.equal(room.version, 'act2autochess@V2_1');
  for (const p of [a, b, c]) {
    const [toast] = h.toasts(p);
    assert.equal(toast.kind, 'warn');
    assert.equal(toast.msgid, '{name}拒绝了切换版本');
    assert.deepEqual(toast.params, { name: 'P2' });
  }
  h.clock.t += 4000;
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess' }), ERR.RATE);
  h.clock.t += 1001;
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  assert.equal(room.versionVote.id, 3);
  h.lobby.shutdown();
});

test('the host cancels (told to the others); a stale or foreign vote id is BAD_TARGET; who may answer', () => {
  const h = harness();
  const { people: [a, b], room } = coop(h, 2);
  const spy = h.player('Spy');
  ok(h.lobby.spectate(spy, { code: room.code }));
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  refused(h.lobby.versionVote(b, { voteId: 99, agree: true }), ERR.BAD_TARGET, 'vote changed');
  refused(h.lobby.versionVote(spy, { voteId: 1, agree: true }), ERR.SPECTATOR);
  refused(h.lobby.cancelVersionVote(b, { voteId: 1 }), ERR.NOT_HOST);
  refused(h.lobby.cancelVersionVote(spy, { voteId: 1 }), ERR.SPECTATOR);
  refused(h.lobby.cancelVersionVote(a, { voteId: 7 }), ERR.BAD_TARGET);
  h.clear();
  ok(h.lobby.cancelVersionVote(a, { voteId: 1 }));
  assert.equal(room.versionVote, null);
  assert.deepEqual(h.toasts(a), [], 'the host is not told what it did');
  assert.equal(h.toasts(b)[0].msgid, '创建者取消了切换版本投票');
  assert.equal(h.toasts(b)[0].kind, 'info');
  assert.equal(h.toasts(spy)[0].msgid, '创建者取消了切换版本投票');
  refused(h.lobby.versionVote(b, { voteId: 1, agree: true }), ERR.WRONG_PHASE);
  refused(h.lobby.cancelVersionVote(a, { voteId: 1 }), ERR.WRONG_PHASE);
  // no guard after a cancel; but the 300 ms debounce holds
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess' }), ERR.RATE);
  h.clock.t += 300;
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  // a voter that joined later is not one
  ok(h.lobby.cancelVersionVote(a, { voteId: 2 }));
  h.lobby.shutdown();
});

test('a version whose data failed to load is refused by room.create and room.proposeVersion (VERSION_UNSUPPORTED)', () => {
  const stub = versionStub({ enabled: ['act2autochess', 'act1autochess'] });
  stub.available = (id) => id === DEFAULT_VERSION; // server/versions.js available after act1autochess's load failed
  const h = harness({ versions: stub });
  refused(h.lobby.create(h.player('Solo'), { mode: 'solo', version: 'act1autochess' }), ERR.VERSION_UNSUPPORTED, 'the data of this version is not available');
  const { people: [a], room } = coop(h, 2);
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess' }), ERR.VERSION_UNSUPPORTED, 'the data of this version is not available');
  assert.equal(room.versionVote, null, 'no vote opened');
  assert.equal(room.version, DEFAULT_VERSION);
  h.lobby.shutdown();
});

test('a configured default whose data failed to load: rooms and settings fall back (第二期下半, else the first that loads)', () => {
  const stub = versionStub({ enabled: ['act2autochess', 'act1autochess'], defaultId: 'act1autochess' });
  stub.available = (id) => id === DEFAULT_VERSION;
  const h = harness({ versions: stub });
  const solo = h.player('Solo');
  ok(h.lobby.create(solo, { mode: 'solo' }));
  assert.equal(h.lobby.roomOf(solo).version, DEFAULT_VERSION, 'not VERSION_UNSUPPORTED for a room created without a version');
  assert.equal(h.lobby.csOf(null), VANILLA);
  assert.equal(h.lobby.dataFor(null), getData());
  h.lobby.shutdown();
  const other = versionStub({ enabled: ['act1autochess', 'act2autochess@V2_1'], defaultId: 'act1autochess' });
  other.available = (id) => id === 'act2autochess@V2_1';
  const h2 = harness({ versions: other });
  const p = h2.player('Solo');
  ok(h2.lobby.create(p, { mode: 'solo' }));
  assert.equal(h2.lobby.roomOf(p).version, 'act2autochess@V2_1');
  h2.lobby.shutdown();
});

test('refusals of room.proposeVersion, in their order', () => {
  const h = harness({ versions: versionStub({ enabled: ['act2autochess', 'act1autochess', 'act2autochess@V2_1'], roomModes: { 'act2autochess@V2_1': ['solo'] } }) });
  const outsider = h.player('Out');
  refused(h.lobby.proposeVersion(outsider, { version: 'act1autochess' }), ERR.NOT_IN_ROOM);
  const { people: [a, b], room } = coop(h, 2);
  const spy = h.player('Spy');
  ok(h.lobby.spectate(spy, { code: room.code }));
  refused(h.lobby.proposeVersion(spy, { version: 'act1autochess' }), ERR.SPECTATOR);
  refused(h.lobby.proposeVersion(b, { version: 'act1autochess' }), ERR.NOT_HOST);
  room.match = { start() {} };
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess' }), ERR.ROOM_STARTED);
  room.match = null;
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess@V1_1' }), ERR.VERSION_UNKNOWN, undefined);
  refused(h.lobby.proposeVersion(a, { version: 'act9autochess' }), ERR.VERSION_UNKNOWN);
  refused(h.lobby.proposeVersion(a, { version: 'act2autochess@V2_1' }), ERR.VERSION_UNSUPPORTED);
  refused(h.lobby.proposeVersion(a, { version: DEFAULT_VERSION }), ERR.ALREADY);
  const bs = room.seatOf(b.playerId);
  bs.connected = false;
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess' }), ERR.NOT_READY);
  bs.connected = true;
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  h.lobby.shutdown();
});

test('what voids a vote (toast to every member): a join, a spectator sitting down, a leave, a kick, the host leaving (its freed seat), a voter dropping', () => {
  const cases = {
    join: (h, ctx) => { ctx.late = h.player('Late'); ok(h.lobby.join(ctx.late, { code: ctx.room.code })); },
    sit: (h, { room, spy }) => ok(h.lobby.join(spy, { code: room.code })),
    leave: (h, { people }) => ok(h.lobby.leave(people[2])),
    kick: (h, { people, room }) => ok(h.lobby.kick(people[0], { seat: room.seatOf(people[2].playerId).seat, playerId: people[2].playerId })),
    // the host leaving frees its seat, which voids the vote before migrateHost runs (migrateHost's own void is defensive:
    // while a vote is open the host changes no other way)
    hostLeaves: (h, { people }) => ok(h.lobby.leave(people[0])),
    drop: (h, { people }) => { people[1].connected = false; h.lobby.onDisconnect(people[1]); },
  };
  for (const [name, act] of Object.entries(cases)) {
    const h = harness();
    const ctx = coop(h, 3);
    ctx.spy = h.player('Spy');
    ok(h.lobby.spectate(ctx.spy, { code: ctx.room.code }));
    ok(h.lobby.proposeVersion(ctx.people[0], { version: 'act1autochess' }));
    h.clear();
    act(h, ctx);
    assert.equal(ctx.room.versionVote, null, name);
    assert.equal(ctx.room.version, DEFAULT_VERSION, name);
    const watcher = name === 'sit' ? ctx.people[1] : ctx.spy;
    assert.equal(h.toasts(watcher).at(-1)?.msgid, '同盟成员有变动，切换版本投票已取消', name);
    assert.equal(h.last(watcher).versionVote, undefined, name);
    // the joiner never saw the vote: no toast about it; a spectator sitting down did see it
    if (name === 'join') assert.deepEqual(h.toasts(ctx.late), [], 'no toast for the joiner');
    if (name === 'sit') assert.equal(h.toasts(ctx.spy).at(-1)?.msgid, '同盟成员有变动，切换版本投票已取消', 'the spectator who sat down saw the vote');
    h.lobby.shutdown();
  }
});

test('what does not void a vote: spectators coming and going (a spectator\'s socket dropping too), AI seats added and removed', () => {
  const h = harness();
  const { people: [a], room } = coop(h, 2);
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  const spy = h.player('Spy');
  ok(h.lobby.spectate(spy, { code: room.code }));
  ok(h.lobby.removeSpectator(a, { playerId: spy.playerId }));
  const spy2 = h.player('Spy2');
  ok(h.lobby.spectate(spy2, { code: room.code }));
  ok(h.lobby.leave(spy2));
  ok(h.lobby.addBot(a));
  ok(h.lobby.removeBot(a, { seat: room.seats.findIndex((s) => s && s.isBot) }));
  const spy3 = h.player('Spy3');
  ok(h.lobby.spectate(spy3, { code: room.code }));
  spy3.connected = false;
  h.lobby.onDisconnect(spy3);
  assert.equal(room.versionVote?.id, 1);
  h.lobby.shutdown();
});

test('during a vote room.start, room.setPlugins and room.setMode answer VERSION_VOTE; room.setDifficulty still works', () => {
  const h = harness();
  const { people: [a, b], room } = coop(h, 2);
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  refused(h.lobby.start(a), ERR.VERSION_VOTE);
  refused(h.lobby.setPlugins(a, { plugins: [] }), ERR.VERSION_VOTE);
  refused(h.lobby.setMode(a, { modeId: 'mode_multi_hard' }), ERR.VERSION_VOTE);
  ok(h.lobby.setDifficulty(a, { difficulty: 'HARD' }));
  assert.equal(room.difficulty, 'HARD');
  ok(h.lobby.versionVote(b, { voteId: 1, agree: true }));
  assert.equal(room.version, 'act1autochess');
  h.lobby.shutdown();
});

test('the vote expires after versionVoteMs (toast, the 5 s guard); the 300 ms debounce', async () => {
  const h = harness({ options: { versionVoteMs: 40 } });
  const { people: [a, b], room } = coop(h, 2);
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  h.clear();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(room.versionVote, null);
  assert.equal(h.toasts(b)[0].msgid, '切换版本投票已超时，房间版本未改变');
  assert.equal(h.toasts(a)[0].msgid, '切换版本投票已超时，房间版本未改变');
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess' }), ERR.RATE);
  h.clock.t += 5000;
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  ok(h.lobby.cancelVersionVote(a, { voteId: 2 }));
  h.clock.t += 299;
  refused(h.lobby.proposeVersion(a, { version: 'act1autochess' }), ERR.RATE);
  h.clock.t += 1;
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  h.lobby.shutdown();
  assert.equal(room.versionVote, null, 'disposed with the room');
});

test('ABYSS → HARD on a switch and on create; a version room refuses its missing modes (BAD_TARGET)', () => {
  const h = harness();
  const p = h.player('A');
  ok(h.lobby.create(p, { mode: 'coop', difficulty: 'ABYSS' }));
  const room = h.lobby.getRoom(p.roomCode);
  ok(h.lobby.proposeVersion(p, { version: 'act1autochess@V1_1' }));
  assert.equal(room.difficulty, 'HARD');
  refused(h.lobby.setDifficulty(p, { difficulty: 'ABYSS' }), ERR.BAD_TARGET, 'not a mode of this version');
  refused(h.lobby.setMode(p, { modeId: 'mode_multi_abyss' }), ERR.BAD_TARGET, 'not a mode of this version');
  ok(h.lobby.setMode(p, { modeId: 'mode_multi_funny' }));
  assert.equal(room.difficulty, 'FUNNY');
  const q = h.player('B');
  ok(h.lobby.create(q, { mode: 'solo', difficulty: 'ABYSS', version: 'act2autochess@V2_1' }));
  assert.equal(h.lobby.getRoom(q.roomCode).difficulty, 'HARD');
  assert.equal(h.lobby.fallbackDifficulty('act1autochess', 'coop', 'NORMAL'), 'NORMAL');
  h.lobby.shutdown();
});

test('room.create: unknown or disabled → VERSION_UNKNOWN; a version without the room mode → VERSION_UNSUPPORTED', () => {
  const h = harness({ versions: versionStub({ enabled: ['act2autochess', 'act1autochess'], roomModes: { act1autochess: ['solo'] } }) });
  const p = h.player('A');
  refused(h.lobby.create(p, { mode: 'coop', version: 'act1autochess@V1_1' }), ERR.VERSION_UNKNOWN);
  refused(h.lobby.create(p, { mode: 'coop', version: 'zzz' }), ERR.VERSION_UNKNOWN);
  refused(h.lobby.create(p, { mode: 'coop', version: 'act1autochess' }), ERR.VERSION_UNSUPPORTED);
  ok(h.lobby.create(p, { mode: 'solo', version: 'act1autochess' }));
  assert.equal(h.last(p).version, 'act1autochess');
  // a lobby without the service knows 第二期下半 alone
  const bare = new Lobby({ registry: new SessionRegistry(), log: quiet, MatchClass: Rec, getData });
  const s = bare.registry.create('X');
  s.connected = true;
  refused(bare.create(s, { mode: 'solo', version: 'act1autochess' }), ERR.VERSION_UNKNOWN);
  ok(bare.create(s, { mode: 'solo', version: DEFAULT_VERSION }));
  bare.shutdown();
  h.lobby.shutdown();
});

test('room.create without a version: the server default; a server default ≠ act2autochess writes room.state.version', () => {
  const h = harness({ versions: versionStub({ defaultId: 'act1autochess' }) });
  const p = h.player('A');
  ok(h.lobby.create(p, { mode: 'coop', difficulty: 'NORMAL' }));
  assert.equal(h.last(p).version, 'act1autochess');
  assert.equal(h.last(p).content.cs, CS.act1autochess);
  const q = h.player('B');
  ok(h.lobby.create(q, { mode: 'coop', difficulty: 'NORMAL', version: DEFAULT_VERSION }));
  assert.equal(Object.hasOwn(h.last(q), 'version'), false);
  // settings outside a room are checked against (and stamped with) the server's default version
  const r = h.player('C');
  ok(h.lobby.loadout(r, { entries: { chess_char_1_02_a: { skill: 0 } } }));
  assert.equal(r.loadoutCs, CS.act1autochess);
  assert.equal(h.lobby.dataFor(null), getVersionData('act1autochess'));
  h.lobby.shutdown();
});

test('a default room on a server with versions has no new key; welcome carries versions only beyond act2autochess', () => {
  const plain = harness({ versions: versionStub({ enabled: ['act2autochess'] }) });
  assert.equal(Object.hasOwn(plain.lobby.welcomeInfo(), 'versions'), false);
  plain.lobby.shutdown();
  const none = new Lobby({ registry: new SessionRegistry(), log: quiet, content: { cs: VANILLA } });
  assert.equal(Object.hasOwn(none.welcomeInfo(), 'versions'), false);
  none.shutdown();
  const h = harness();
  assert.deepEqual(h.lobby.welcomeInfo().versions.map((v) => v.id), ALL);
  const p = h.player('A');
  ok(h.lobby.create(p, { mode: 'coop', difficulty: 'NORMAL' }));
  const st = h.last(p);
  for (const k of ['version', 'versionVote']) assert.equal(Object.hasOwn(st, k), false, k);
  assert.deepEqual(st.content, { cs: VANILLA, vanilla: true, plugins: [] });
  assert.equal(Object.hasOwn(st.seats[0], 'content'), false);
  h.lobby.shutdown();
});

test('gameplay plugins: refused in a version room and for a proposal while on; cosmetic plugins kept across a switch', () => {
  const resolved = [];
  const plugins = {
    resolve(ids, opts) {
      resolved.push([ids, opts.gameplay]);
      if (ids.includes('rules')) {
        if (opts.gameplay === false) return { error: ERR.VERSION_UNSUPPORTED, detail: 'rules changes the gameplay' };
        return { ok: true, set: { cs: 'ee'.repeat(32), plugins: [{ id: 'rules', version: '1.0.0', class: 'content', hash: 'ab' }], warnings: [], bytes: 0, dataBytes: 10, modes: [] } };
      }
      return { ok: true, set: { vs: 'ff'.repeat(32), plugins: ids.map((id) => ({ id, version: '1.0.0', class: 'cosmetic', hash: 'cd' })), warnings: [], bytes: 5 } };
    },
    hold() {}, release() {}, holdContent() {}, releaseContent() {},
  };
  const h = harness({ plugins });
  const p = h.player('A');
  ok(h.lobby.create(p, { mode: 'solo', difficulty: 'NORMAL' }));
  const room = h.lobby.getRoom(p.roomCode);
  ok(h.lobby.setPlugins(p, { plugins: [{ id: 'rules' }] }));
  assert.equal(room.modded, true);
  refused(h.lobby.proposeVersion(p, { version: 'act1autochess' }), ERR.VERSION_UNSUPPORTED);
  ok(h.lobby.setPlugins(p, { plugins: [{ id: 'skin' }] }));
  ok(h.lobby.proposeVersion(p, { version: 'act1autochess' }));
  const st = h.last(p);
  assert.equal(st.content.vs, 'ff'.repeat(32), 'the cosmetic set comes along');
  assert.equal(st.content.cs, CS.act1autochess);
  assert.equal(st.content.version, 'act1autochess');
  assert.deepEqual(st.content.plugins.map((x) => x.id), ['skin']);
  assert.equal(resolved.at(-1)[1], false, 'resolved without gameplay plugins');
  refused(h.lobby.setPlugins(p, { plugins: [{ id: 'rules' }] }), ERR.VERSION_UNSUPPORTED);
  // cosmetic plugins that do not resolve on the target (the owner's policy, a refused plugin): the proposal is refused
  h.clock.t += 1000;
  ok(h.lobby.proposeVersion(p, { version: DEFAULT_VERSION }));
  ok(h.lobby.setPlugins(p, { plugins: [{ id: 'old-skin' }] }));
  const resolve = plugins.resolve;
  plugins.resolve = (ids, opts) => (ids.includes('old-skin') && opts.gameplay === false ? { error: ERR.PLUGIN_BLOCKED, detail: 'not here' } : resolve(ids, opts));
  h.clock.t += 1000;
  refused(h.lobby.proposeVersion(p, { version: 'act1autochess' }), ERR.VERSION_UNSUPPORTED);
  assert.equal(room.version, DEFAULT_VERSION);
  // …and when they stop resolving between a vote and its end, the switch keeps the version's base without them
  plugins.resolve = resolve;
  h.clock.t += 1000;
  const g = h.player('Guest');
  room.mode = 'coop'; // (a second human for a vote)
  ok(h.lobby.join(g, { code: room.code }));
  ok(h.lobby.proposeVersion(p, { version: 'act1autochess' }));
  plugins.resolve = (ids, opts) => (opts.gameplay === false ? { error: ERR.PLUGIN_BLOCKED } : resolve(ids, opts));
  ok(h.lobby.versionVote(g, { voteId: room.versionVote.id, agree: true }));
  assert.equal(room.version, 'act1autochess');
  assert.deepEqual(room.content, { cs: CS.act1autochess, vanilla: true, version: 'act1autochess', plugins: [] });
  plugins.resolve = resolve;
  // a room-sets object that ignores the option still cannot slip a gameplay set into a version room
  const lax = harness({ plugins: { ...plugins, resolve: (ids) => plugins.resolve(ids, { gameplay: true }) } });
  const q = lax.player('B');
  ok(lax.lobby.create(q, { mode: 'solo', version: 'act1autochess' }));
  refused(lax.lobby.setPlugins(q, { plugins: [{ id: 'rules' }] }), ERR.VERSION_UNSUPPORTED);
  lax.lobby.shutdown();
  h.lobby.shutdown();
});

test('the content gate: contentReady flips the seat, ready / start wait for it; spectators show theirs', () => {
  const h = harness();
  const { people: [a, b], room } = coop(h, 2, { version: 'act1autochess' });
  const spy = h.player('Spy');
  ok(h.lobby.spectate(spy, { code: room.code }));
  const st = h.last(a);
  assert.deepEqual(st.seats.filter(Boolean).map((s) => s.content), ['loading', 'loading']);
  assert.equal(st.spectators[0].content, 'loading');
  refused(h.lobby.ready(b, { ready: true }), ERR.CONTENT_NOT_READY);
  ok(h.lobby.contentReady(b, { cs: VANILLA }), 'another cs: answered, nothing written');
  assert.equal(room.seatOf(b.playerId).content ?? null, null);
  ok(h.lobby.contentReady(b, { cs: CS.act1autochess }));
  ok(h.lobby.contentReady(spy, { cs: CS.act1autochess }));
  assert.equal(h.last(a).spectators[0].content, 'ready');
  ok(h.lobby.ready(b, { ready: true }));
  refused(h.lobby.start(a), ERR.CONTENT_NOT_READY);
  ok(h.lobby.contentReady(a, { cs: CS.act1autochess, ok: false }));
  assert.equal(h.last(b).seats[0].content, 'failed');
  ok(h.lobby.contentReady(a, { cs: CS.act1autochess }));
  ok(h.lobby.start(a));
  h.lobby.shutdown();
});

test('a switch: others un-readied, settings cleared, a card the version lacks dropped, replay gone, every page loading', () => {
  const h = harness();
  const { people: [a, b], room } = coop(h, 2);
  const spy = h.player('Spy');
  ok(h.lobby.spectate(spy, { code: room.code }));
  // the last match's replay, still owed to everyone — a spectator too (buildReplay): the old version's chess ids, so the
  // WHOLE replay goes with the switch, not only the proposer's (proposeVersion drops that one itself)
  room.replay = { publicFrame: null, frames: new Map([[a.playerId, '{}'], [b.playerId, '{}'], [spy.playerId, '{}']]), pending: new Set([a.playerId, b.playerId, spy.playerId]) };
  ok(h.lobby.card(b, { charId: 'char_494_vendla' }));
  ok(h.lobby.card(a, { charId: 'char_102_texas' }));
  ok(h.lobby.loadout(b, { entries: { chess_char_1_02_a: { skill: 0 } } }));
  ok(h.lobby.ownership(b, { notOwned: ['chess_char_1_02_a'] }));
  ok(h.lobby.ready(b, { ready: true }));
  ok(h.lobby.proposeVersion(a, { version: 'act1autochess' }));
  ok(h.lobby.versionVote(b, { voteId: 1, agree: true }));
  const seat = room.seatOf(b.playerId);
  assert.equal(seat.ready, false);
  assert.equal(seat.loadout, null);
  assert.equal(seat.notOwned, null);
  assert.equal(seat.loadoutCs, null);
  assert.equal(seat.card, null, '本 version has no 温蒂 (char_494_vendla)');
  assert.equal(room.seatOf(a.playerId).card, 'char_102_texas');
  assert.equal(b.loadout?.chess_char_1_02_a?.skill, 0, 'the session keeps its own copy (the page sends again)');
  assert.deepEqual(h.last(a).seats.filter(Boolean).map((s) => s.content), ['loading', 'loading']);
  assert.equal(room.replay, null, 'the replay is gone');
  assert.equal(h.lobby.replayFor(room, spy.playerId), null, 'a spectator is never replayed the old version\'s result');
  h.lobby.shutdown();
});

test('settings sent before the seat\'s page reported the new content are unverified: a version room\'s match drops them', () => {
  const h = harness();
  const p = h.player('A');
  ok(h.lobby.create(p, { mode: 'solo', difficulty: 'NORMAL' }));
  const room = h.lobby.getRoom(p.roomCode);
  ok(h.lobby.proposeVersion(p, { version: 'act1autochess' }));
  // the page built this against 第二期's data (角峰 at chess_char_1_02), and it lands after the switch
  ok(h.lobby.loadout(p, { entries: { chess_char_1_02_a: { skill: 0 } } }));
  ok(h.lobby.ownership(p, { notOwned: ['chess_char_1_02_a'] }));
  assert.equal(room.seatOf(p.playerId).loadoutCs, 'unverified');
  assert.equal(Object.keys(room.seatOf(p.playerId).loadout).length, 1);
  ok(h.lobby.contentReady(p, { cs: CS.act1autochess }));
  Rec.last = null;
  ok(h.lobby.start(p));
  const seat = Rec.last.seats[0];
  assert.deepEqual(seat.loadout, {}, 'dropped, never applied to 讯使');
  assert.equal(seat.notOwned, null);
  assert.equal(Rec.last.version, 'act1autochess');
  // after the page reported the content ready, a setting is the room's
  const h2 = harness();
  const q = h2.player('B');
  ok(h2.lobby.create(q, { mode: 'solo', difficulty: 'NORMAL', version: 'act1autochess' }));
  ok(h2.lobby.contentReady(q, { cs: CS.act1autochess }));
  ok(h2.lobby.loadout(q, { entries: { chess_char_1_02_a: { skill: 0 } } }));
  assert.equal(h2.lobby.getRoom(q.roomCode).seatOf(q.playerId).loadoutCs, CS.act1autochess);
  ok(h2.lobby.start(q));
  assert.deepEqual(Rec.last.seats[0].loadout.chess_char_1_02_a, { skill: 0, module: 'uniequip_002_blackd' }, '讯使\'s own module');
  h.lobby.shutdown();
  h2.lobby.shutdown();
});

test('seatSettings: a setting checked for another version keeps only the chess ids whose operator is the same (角峰 ≠ 讯使)', () => {
  const h = harness();
  const p = h.player('A');
  // checked outside a room against 第二期 (the vanilla cs): chess_char_1_02 = 角峰 there, 讯使 in 第一期; `same` (a
  // droppable chess both versions give one operator) and `diff` (a droppable one whose operator differs) for 干员持有
  const v2 = getData(), v1 = getVersionData('act1autochess');
  const a2 = v2.chess, a1 = v1.chess;
  const keeps = (data, id) => checkNotOwned([id], (x) => lookup('chess', x, data)).notOwned?.length === 1;
  const both = (id) => /_a$/.test(id) && !!a1[id] && keeps(v2, id) && keeps(v1, id);
  const same = Object.keys(a2).find((id) => both(id) && a1[id].charId === a2[id].charId);
  const diff = Object.keys(a2).find((id) => both(id) && a1[id].charId !== a2[id].charId);
  assert.ok(same && diff, 'droppable chess ids of one and of two operators');
  assert.notEqual(a2.chess_char_1_02_a.charId, a1.chess_char_1_02_a.charId);
  ok(h.lobby.loadout(p, { entries: { chess_char_1_02_a: { skill: 0 }, [same]: { skill: 0 } } }));
  ok(h.lobby.ownership(p, { notOwned: [diff, same] }));
  assert.equal(p.loadoutCs, VANILLA);
  ok(h.lobby.create(p, { mode: 'solo', difficulty: 'NORMAL', version: 'act1autochess' }));
  ok(h.lobby.contentReady(p, { cs: CS.act1autochess }));
  ok(h.lobby.start(p));
  const seat = Rec.last.seats[0];
  assert.deepEqual(Object.keys(seat.loadout), [same]);
  assert.deepEqual([...seat.notOwned], [same]);
  // and the other way: checked for 第一期, played on 第二期
  const h2 = harness();
  const q = h2.player('B');
  ok(h2.lobby.create(q, { mode: 'solo', version: 'act1autochess' }));
  ok(h2.lobby.contentReady(q, { cs: CS.act1autochess }));
  ok(h2.lobby.loadout(q, { entries: { chess_char_1_02_a: { skill: 0 }, [same]: { skill: 0 } } }));
  ok(h2.lobby.create(q, { mode: 'solo' }));
  ok(h2.lobby.start(q));
  assert.deepEqual(Object.keys(Rec.last.seats[0].loadout), [same]);
  assert.equal(Object.hasOwn(Rec.last, 'version'), false);
  h.lobby.shutdown();
  h2.lobby.shutdown();
});

test('startMatch: a version room plays in its version host (version + requireCs); a default room keeps today\'s opts', () => {
  const hosted = [];
  const versionHosts = { create(cs, opts) { assert.equal(opts.simPool, undefined, "a live pool must not cross the match-host boundary"); hosted.push([cs, opts]); return { hosted: true, start() {}, dispose() {} }; } };
  const h = harness({ versionHosts, MatchClass: Rec });
  h.lobby.simPool = { submit() { throw new Error("must not reach hosted versions"); } };
  const p = h.player('A');
  ok(h.lobby.create(p, { mode: 'solo', difficulty: 'NORMAL', version: 'act2autochess@V2_1' }));
  ok(h.lobby.contentReady(p, { cs: CS['act2autochess@V2_1'] }));
  ok(h.lobby.start(p));
  const [cs, opts] = hosted[0];
  assert.equal(cs, CS['act2autochess@V2_1']);
  assert.equal(opts.version, 'act2autochess@V2_1');
  assert.equal(opts.requireCs, true);
  assert.equal(opts.cs, cs);
  assert.equal(Object.hasOwn(opts, 'kitted'), false, 'kitted only with gameplay plugins');
  assert.equal(opts.data, getVersionData('act2autochess@V2_1'));
  h.lobby.simPool = null;
  const q = h.player('B');
  Rec.last = null;
  ok(h.lobby.create(q, { mode: 'solo', difficulty: 'NORMAL' }));
  ok(h.lobby.start(q));
  assert.equal(hosted.length, 1);
  const keys = Object.keys(Rec.last).sort();
  assert.deepEqual(keys, ['aiPicksLast', 'broadcast', 'cs', 'data', 'difficulty', 'hostId', 'log', 'matchNo', 'mode', 'modeId', 'now', 'onEnd', 'roomCode', 'seats', 'seed', 'send', 'spectators']);
  // a version room without a version host, and the real Match class: never in this process
  const lone = new Lobby({ registry: new SessionRegistry(), log: quiet, content: { cs: VANILLA }, getData, versions: versionStub() });
  const s = lone.registry.create('C');
  s.connected = true;
  ok(lone.create(s, { mode: 'solo', version: 'act1autochess' }));
  ok(lone.contentReady(s, { cs: CS.act1autochess }));
  refused(lone.start(s), ERR.INTERNAL, 'no match host for this version');
  assert.equal(lone.getRoom(s.roomCode).match, null);
  lone.shutdown();
  h.lobby.shutdown();
});

test('the real version service: a room of 第一期上半 names its real cs and data, its match its version', () => {
  const vanilla = computeVanillaContent({ simDir: path.join(ROOT, 'server', 'sim'), sharedDir: path.join(ROOT, 'shared'), dataDir: DATA_DIR, shim: DATA_SHIM_JS });
  const versions = createVersionSets({ enabled: ['act2autochess', 'act1autochess@V1_1'], vanilla, defaultData: getData(), log: quiet });
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: quiet, MatchClass: Rec, content: { cs: vanilla.cs }, getData, versions });
  const s = registry.create('A');
  s.connected = true;
  ok(lobby.create(s, { mode: 'coop', difficulty: 'ABYSS', version: 'act1autochess@V1_1' }));
  const room = lobby.getRoom(s.roomCode);
  assert.equal(room.difficulty, 'HARD');
  assert.equal(room.content.cs, versions.csOf('act1autochess@V1_1'));
  assert.equal(lobby.dataFor(room).config.version.id, 'act1autochess@V1_1');
  assert.deepEqual(lobby.welcomeInfo().versions.map((v) => [v.id, !!v.default]), [['act2autochess', true], ['act1autochess@V1_1', false]]);
  ok(lobby.contentReady(s, { cs: room.content.cs }));
  ok(lobby.addBot(s));
  ok(lobby.start(s));
  assert.equal(Rec.last.version, 'act1autochess@V1_1');
  assert.equal(Rec.last.modeId, 'mode_multi_hard');
  lobby.shutdown();
});

test('server/plugins/roomSets.js resolve({ gameplay: false }): a content / script / trusted plugin in the closed list → VERSION_UNSUPPORTED, nothing built', () => {
  const built = [];
  const plugin = (id, cls, extra = {}) => ({ id, class: cls, status: 'loaded', content: cls !== 'cosmetic' ? {} : undefined, visual: cls === 'cosmetic' ? {} : undefined,
    manifest: { version: '1.0.0', scope: ['room'], ...extra } });
  const list = { skin: plugin('skin', 'cosmetic'), rules: plugin('rules', 'content'), needs: plugin('needs', 'cosmetic', { requires: { rules: '*' } }) };
  const sets = createRoomSets({
    registry: { plugin: (id) => list[id] || null },
    visual: { resolve: (ids) => { built.push(['visual', ids]); return { ok: true, set: { vs: 'ff'.repeat(32), plugins: ids.map((id) => ({ id, hash: 'ab' })), warnings: [], bytes: 1 } }; } },
    contents: { resolve: (ids) => { built.push(['content', ids]); return { ok: true, set: { cs: 'ee'.repeat(32), plugins: [], dataBytes: 0, modes: [], kitted: [] } }; } },
    policy: null,
  });
  for (const ids of [['rules'], ['needs'], ['skin', 'rules']]) {
    const r = sets.resolve(ids, { gameplay: false });
    assert.equal(r.error, ERR.VERSION_UNSUPPORTED, `${ids}: ${JSON.stringify(r)}`);
  }
  assert.deepEqual(built, [], 'refused before any set is built');
  assert.equal(sets.resolve(['skin'], { gameplay: false }).ok, true);
  assert.equal(sets.resolve(['rules']).ok, true, 'the default keeps gameplay plugins');
});


test('switching from player to spectator cancels a version vote in every official version', (t) => {
  for (const version of ALL) for (const changingHost of [false, true]) {
    const h = harness();
    t.after(() => h.lobby.shutdown());
    const host = h.player('Host');
    const guest = h.player('Guest');
    ok(h.lobby.create(host, { mode: 'coop', version }));
    const room = h.lobby.roomOf(host);
    ok(h.lobby.join(guest, { code: room.code }));
    const target = ALL.find((id) => id !== version);
    ok(h.lobby.proposeVersion(host, { version: target }));
    assert.ok(room.versionVote);
    const changing = changingHost ? host : guest;
    ok(h.lobby.spectate(changing, { code: room.code }));
    assert.equal(room.versionVote, null);
    assert.equal(room.version, version);
    assert.equal(room.hostId, changingHost ? guest.playerId : host.playerId);
    assert.equal(room.seatOf(changing.playerId), null);
    assert.equal(h.last(changing).spectators[0].playerId, changing.playerId);
    assert.ok(h.toasts(changing).some((m) => m.msgid === '同盟成员有变动，切换版本投票已取消'));
    ok(h.lobby.join(changing, { code: room.code }));
    assert.equal(room.seatOf(changing.playerId).ready, false);
    if (version !== DEFAULT_VERSION) assert.notEqual(room.seatOf(changing.playerId).content, 'ready');
  }
});
