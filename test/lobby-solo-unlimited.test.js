// 「不限时」 for a version whose solo is timed (DESIGN §35.23.10): room.create's optional flag, room.setSoloUnlimited,
// room.state only while it is on, and startMatch / wireOptions passing it only then. A default or 第二期上半 solo, and
// co-op, ignore a stray true. Lone-human co-op is unchanged (it never reads this flag).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { getData, getVersionData } from '../server/data.js';
import { wireOptions } from '../server/match/host/proxy.js';
import { DIFFICULTIES, ERR, modeIdFor } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import { DEFAULT_VERSION, VERSIONS, versionById } from '../shared/versions.js';

const VANILLA = 'a0'.repeat(32);
const CS = { 'act2autochess@V2_1': 'b1'.repeat(32), act1autochess: 'c1'.repeat(32), 'act1autochess@V1_1': 'd1'.repeat(32) };
const ALL = VERSIONS.map((v) => v.id);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const V1 = 'act1autochess';
const V1_1 = 'act1autochess@V1_1';
const V2_1 = 'act2autochess@V2_1';

function versionStub() {
  const ids = ALL;
  const data = (id) => (id === DEFAULT_VERSION ? getData() : getVersionData(id));
  return {
    ids, defaultId: DEFAULT_VERSION, nonDefault: ids.filter((id) => id !== DEFAULT_VERSION),
    isEnabled: (id) => ids.includes(id),
    csOf: (id) => (id === DEFAULT_VERSION ? VANILLA : CS[id]),
    content: (id) => (id === DEFAULT_VERSION
      ? Object.freeze({ cs: VANILLA, vanilla: true, plugins: Object.freeze([]) })
      : Object.freeze({ cs: CS[id], vanilla: true, version: id, plugins: Object.freeze([]) })),
    data,
    offered: (id, mode) => {
      if (!versionById(id).roomModes.includes(mode)) return [];
      const modes = data(id).config.modes;
      return DIFFICULTIES.filter((d) => Object.hasOwn(modes, modeIdFor(mode, d)));
    },
    welcome: () => ids.map((id) => ({ id, cs: id === DEFAULT_VERSION ? VANILLA : CS[id] })),
  };
}

class Rec {
  static last = null;
  constructor(opts) { this.opts = opts; Rec.last = opts; }
  start() {}
  dispose() {}
}

function harness() {
  const clock = { t: 1_000_000 };
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: quiet, MatchClass: Rec, content: { cs: VANILLA }, getData, versions: versionStub(),
    now: () => clock.t });
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
  const state = (s) => [...frames.get(s.playerId)].reverse().find((m) => m.t === 'room.state');
  return { lobby, player, state, clock };
}

const ok = (r) => assert.deepEqual(r, { ok: true });
const refused = (r, code) => assert.equal(r?.error, code, JSON.stringify(r));

test('protocol: room.create may carry soloUnlimited, room.setSoloUnlimited takes a boolean on', () => {
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', soloUnlimited: true }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', soloUnlimited: false }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo' }), null);
  assert.notEqual(validateC2S({ t: 'room.create', mode: 'solo', soloUnlimited: 'yes' }), null);
  assert.equal(validateC2S({ t: 'room.setSoloUnlimited', on: true }), null);
  assert.equal(validateC2S({ t: 'room.setSoloUnlimited', on: false }), null);
  assert.notEqual(validateC2S({ t: 'room.setSoloUnlimited', on: 1 }), null);
  assert.notEqual(validateC2S({ t: 'room.setSoloUnlimited' }), null);
});

test('create stores soloUnlimited only for a timed solo, and room.state omits it otherwise', () => {
  const h = harness();
  const host = h.player('Host');
  ok(h.lobby.create(host, { mode: 'solo', version: V1, soloUnlimited: true }));
  assert.equal(h.state(host).soloUnlimited, true);
  assert.equal(h.state(host).version, V1);

  ok(h.lobby.create(host, { mode: 'solo', version: V1 }));
  assert.equal(h.state(host).soloUnlimited, undefined);
  ok(h.lobby.create(host, { mode: 'solo', version: V1, soloUnlimited: false }));
  assert.equal(h.state(host).soloUnlimited, undefined);

  ok(h.lobby.create(host, { mode: 'solo', soloUnlimited: true }));
  assert.equal(h.state(host).version, undefined, 'default room');
  assert.equal(h.state(host).soloUnlimited, undefined);
  ok(h.lobby.create(host, { mode: 'solo', version: V2_1, soloUnlimited: true }));
  assert.equal(h.state(host).version, V2_1);
  assert.equal(h.state(host).soloUnlimited, undefined);
  ok(h.lobby.create(host, { mode: 'coop', version: V1, soloUnlimited: true }));
  assert.equal(h.state(host).mode, 'coop');
  assert.equal(h.state(host).soloUnlimited, undefined);
});

test('setSoloUnlimited: host of a timed solo only; false drops the key; a started match refuses', () => {
  const h = harness();
  const host = h.player('Host');
  const guest = h.player('Guest');
  ok(h.lobby.create(host, { mode: 'coop', version: V1 }));
  refused(h.lobby.setSoloUnlimited(guest, { on: true }), ERR.NOT_IN_ROOM);
  ok(h.lobby.spectate(guest, { code: h.state(host).code }));
  refused(h.lobby.setSoloUnlimited(guest, { on: true }), ERR.SPECTATOR);
  refused(h.lobby.setSoloUnlimited(host, { on: true }), ERR.BAD_TARGET);

  ok(h.lobby.create(host, { mode: 'solo', version: V2_1 }));
  refused(h.lobby.setSoloUnlimited(host, { on: true }), ERR.BAD_TARGET);
  ok(h.lobby.create(host, { mode: 'solo' }));
  refused(h.lobby.setSoloUnlimited(host, { on: true }), ERR.BAD_TARGET);

  ok(h.lobby.create(host, { mode: 'solo', version: V1 }));
  ok(h.lobby.setSoloUnlimited(host, { on: true }));
  assert.equal(h.state(host).soloUnlimited, true);
  ok(h.lobby.setSoloUnlimited(host, { on: true }));
  ok(h.lobby.setSoloUnlimited(host, { on: false }));
  assert.equal(h.state(host).soloUnlimited, undefined);

  const room = h.lobby.getRoom(host.roomCode);
  ok(h.lobby.contentReady(host, { cs: room.content.cs }));
  ok(h.lobby.setSoloUnlimited(host, { on: true }));
  ok(h.lobby.start(host));
  assert.equal(Rec.last.soloUnlimited, true);
  assert.equal(wireOptions(Rec.last).soloUnlimited, true);
  refused(h.lobby.setSoloUnlimited(host, { on: false }), ERR.ROOM_STARTED);
});

test('a version switch clears the flag off a timed solo and keeps it between the two 第一期 versions', () => {
  const h = harness();
  const host = h.player('Host');
  ok(h.lobby.create(host, { mode: 'solo', version: V1, soloUnlimited: true }));
  ok(h.lobby.proposeVersion(host, { version: V1_1 }));
  assert.equal(h.state(host).version, V1_1);
  assert.equal(h.state(host).soloUnlimited, true);
  h.clock.t += 300; // versionProposeGapMs: the second proposal in the same instant is RATE
  ok(h.lobby.proposeVersion(host, { version: V2_1 }));
  assert.equal(h.state(host).version, V2_1);
  assert.equal(h.state(host).soloUnlimited, undefined);
  h.clock.t += 300;
  ok(h.lobby.proposeVersion(host, { version: DEFAULT_VERSION }));
  assert.equal(h.state(host).version, undefined);
  assert.equal(h.state(host).soloUnlimited, undefined);
});

test('startMatch and wireOptions omit soloUnlimited unless the flag is on', () => {
  const h = harness();
  const host = h.player('Host');
  ok(h.lobby.create(host, { mode: 'solo', version: V1 }));
  const room = h.lobby.getRoom(host.roomCode);
  ok(h.lobby.contentReady(host, { cs: room.content.cs }));
  ok(h.lobby.start(host));
  assert.equal(Rec.last.version, V1);
  assert.equal(Rec.last.soloUnlimited, undefined);
  assert.equal(wireOptions(Rec.last).soloUnlimited, undefined);
  assert.equal(wireOptions({ roomCode: 'ABCD', mode: 'solo', hostId: 'p', test: false, soloUnlimited: true }).soloUnlimited, true);
  assert.deepEqual(wireOptions({ roomCode: 'ABCD', mode: 'solo', hostId: 'p', test: false }), { roomCode: 'ABCD', mode: 'solo' });

  // the first match is still running, so the same session cannot create again (ROOM_STARTED)
  const h2 = harness();
  const host2 = h2.player('Host');
  ok(h2.lobby.create(host2, { mode: 'solo' }));
  ok(h2.lobby.start(host2));
  assert.equal(Object.hasOwn(Rec.last, 'soloUnlimited'), false);
  assert.equal(Object.hasOwn(Rec.last, 'version'), false);
});
