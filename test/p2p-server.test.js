import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { Lobby, Room } from '../server/lobby.js';
import { PeerRelay, parseIceServers, p2pEnabledFromEnv, P2P_FRAME_BYTES } from '../server/peerRelay.js';
import { negotiateStateDelta } from '../server/stateTransport.js';
import { applyStatePatch, STATE_DELTA_VERSION } from '../shared/stateDelta.js';
import { validateC2S } from '../shared/protocol.js';
import { ERR } from '../shared/constants.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stateOnly = ({ deliveryEpoch: _epoch, deliverySeq: _seq, ...state }) => state;
function socket() {
  return { readyState: 1, bufferedAmount: 0, frames: [], send(frame) { this.frames.push(JSON.parse(frame)); }, terminate() { this.readyState = 3; } };
}

function setup(t, count = 3, options = {}) {
  let clock = 1000;
  const members = new Map();
  const lobby = new Lobby({ registry: { byId: (id) => members.get(id) }, getData: () => ({}), now: () => clock });
  lobby.peerRelay.dispose();
  lobby.peerRelay = new PeerRelay({ enabled: true, iceServers: [], now: () => clock, ...options });
  const room = new Room('ABCD', 'coop', 'NORMAL', clock);
  lobby.rooms.set(room.code, room);
  const clients = Array.from({ length: count }, (_, i) => {
    const session = { playerId: `player-${i}`, name: `Player ${i}`, connected: true, roomCode: room.code, ws: socket() };
    members.set(session.playerId, session);
    room.seats[i] = lobby.humanSeat(i, session);
    return session;
  });
  room.hostId = clients[0].playerId;
  t.after(() => lobby.shutdown());
  const clear = () => { for (const client of clients) client.ws.frames.length = 0; };
  const enable = (client, enabled = true) => lobby.onMessage(client, { t: 'p2p.enable', enabled });
  const plan = () => lobby.peerRelay.rooms.get(room);
  const ready = (client, seq = 0, enabled = true) => lobby.onMessage(client, { t: 'p2p.ready', epoch: plan().epoch, ready: enabled, seq });
  const start = () => { clients.forEach((c) => enable(c)); clients.forEach((c) => ready(c)); clear(); };
  return { lobby, room, clients, members, clear, enable, plan, ready, start, advance: (ms) => { clock += ms; } };
}

test('public fanout sends one verifiable envelope and preserves the original replay bytes', (t) => {
  const { lobby, room, clients: [a, b, c], start, plan } = setup(t);
  start();
  const payload = { t: 'm.public', serverNow: 1000, round: 1, padding: 'abc'.repeat(500) };
  const original = lobby.broadcastRoom(room, payload);
  assert.deepEqual(stateOnly(JSON.parse(original)), payload);
  assert.equal(a.ws.frames.length, 1);
  assert.equal(b.ws.frames.length + c.ws.frames.length, 0, 'receivers get their public snapshot through the relay');
  const frame = a.ws.frames[0];
  assert.equal(frame.t, 'p2p.frame');
  assert.equal(frame.payload, original);
  assert.equal(frame.epoch, plan().epoch);
  assert.equal(frame.seq, 1);
  const key = createPublicKey({ key: lobby.peerRelay.keys.publicKey.export({ format: 'jwk' }), format: 'jwk' });
  const signed = Buffer.from(JSON.stringify([frame.epoch, frame.seq, frame.payload]));
  assert(verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(frame.signature, 'base64')));
  assert(!verify('sha256', Buffer.from(JSON.stringify([frame.epoch, frame.seq, original + ' '])),
    { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(frame.signature, 'base64')), 'a relay cannot alter state');
  assert(Buffer.byteLength(JSON.stringify(frame)) < 2 * Buffer.byteLength(original), 'fanout reduces WS snapshot bytes');
});

test('private state, commands, and every event stay on WebSocket; unicast public resync is unchanged', (t) => {
  const { lobby, room, clients, start, clear } = setup(t);
  start();
  for (const type of ['m.ticker', 'm.emote', 'm.toast', 'm.result', 'b.pool', 'b.start', 'b.end', 'b.ev', 'b.snap']) {
    lobby.broadcastRoom(room, { t: type, event: 1 });
    for (const c of clients) assert.deepEqual(c.ws.frames.at(-1), { t: type, event: 1 });
  }
  clear();
  lobby.sendToPlayer(room, clients[1].playerId, { t: 'm.private', gold: 10 });
  lobby.sendToPlayer(room, clients[1].playerId, { t: 'm.public', serverNow: 123 });
  assert.deepEqual(clients[1].ws.frames.map(stateOnly), [{ t: 'm.private', gold: 10 }, { t: 'm.public', serverNow: 123 }]);
  assert.equal(clients[0].ws.frames.length + clients[2].ws.frames.length, 0);
  const calls = [];
  room.match = { handle(id, msg) { calls.push({ id, msg }); return { ok: true }; } };
  assert.deepEqual(lobby.onMessage(clients[1], { t: 'g.ready', ready: true }), { ok: true });
  assert.equal(calls[0].id, clients[1].playerId);
});

test('transport readiness bypasses a plugin match queue and stays bound to its source socket', (t) => {
  const { lobby, room, clients: [a, b], enable, ready, plan } = setup(t, 2);
  // An unresolved gameplay request keeps a plugin host's normal room messages queued.
  room.queue.pending = 1;
  room.queue.tail = new Promise(() => {});
  assert.deepEqual(enable(a), { ok: true });
  assert.deepEqual(enable(b), { ok: true });
  assert.deepEqual(ready(a), { ok: true });
  assert.deepEqual(ready(b), { ok: true });
  assert.equal(room.queue.pending, 1, 'P2P control does not join or mutate the gameplay queue');
  const previous = plan();
  a.ws = socket();
  lobby.sendState(room, a);
  assert.equal(lobby.peerRelay.capable(a), false, 'the previous page cannot opt in its replacement through a delayed handler');
  assert.equal(lobby.peerRelay.rooms.size, 0);
  assert(previous.peers.every((p) => !p.ready && p.timer === null));
});

test('upstream plugin content and session-claim validation remain compatible with P2P messages', () => {
  const cs = 'a'.repeat(64);
  for (const message of [
    { t: 'hello', name: 'Player', noReplace: true, claimAt: 1234 },
    { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', test: true },
    { t: 'room.join', code: 'ABCD', testAck: true },
    { t: 'room.setPlugins', plugins: [{ id: 'sample', settings: { speed: 1, label: 'demo' } }] },
    { t: 'room.setMode', modeId: 'sample:mode' },
    { t: 'room.contentReady', cs, ok: true },
    { t: 'room.consent', cs, accept: true },
  ]) assert.equal(validateC2S(message), null, JSON.stringify(message));
  assert(validateC2S({ t: 'hello', name: 'Player', noReplace: 'true' }));
  assert(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', test: false }));
});

test('opt-in, opt-out, nonready members, unsupported clients, and solo games retain WS coverage', (t) => {
  const { lobby, room, clients: [a, b, c, d], enable, ready, clear, plan } = setup(t, 4);
  [a, b, c].forEach((x) => enable(x));
  const config = a.ws.frames.findLast((f) => f.t === 'p2p.config' && f.enabled);
  assert.deepEqual(config.peers, [a.playerId, b.playerId, c.playerId]);
  assert.equal(config.relayId, a.playerId);
  assert.equal(config.publicKey.d, undefined);
  assert.deepEqual(config.iceServers, []);
  ready(a); ready(b); clear();
  lobby.broadcastRoom(room, { t: 'm.public', turn: 1 });
  assert.equal(a.ws.frames[0].t, 'p2p.frame');
  assert.equal(b.ws.frames.length, 0, 'a ready receiver is served by the relay');
  // c is capable but not ready yet, so the lobby's own send keeps it covered — the plain, authoritative frame.
  assert.deepEqual(c.ws.frames.map(stateOnly), [{ t: 'm.public', turn: 1 }]);
  assert.deepEqual(d.ws.frames.map(stateOnly), [{ t: 'm.public', turn: 1 }]);
  const oldEpoch = plan().epoch;
  enable(b, false);
  assert.notEqual(plan().epoch, oldEpoch);
  assert.equal(plan().peers.some((p) => p.session === b), false);
  clear();
  lobby.broadcastRoom(room, { t: 'm.public', turn: 2 });
  for (const x of [a, b, c, d]) assert.deepEqual(x.ws.frames.map(stateOnly), [{ t: 'm.public', turn: 2 }]);
  room.mode = 'solo';
  clear();
  lobby.broadcastRoom(room, { t: 'm.public', solo: true });
  assert.equal(lobby.peerRelay.rooms.size, 0);
  for (const x of [a, b, c, d]) assert.deepEqual(stateOnly(x.ws.frames.at(-1)), { t: 'm.public', solo: true });
});

test('signaling is bounded and restricted to the current room, epoch, and star links', (t) => {
  const { lobby, room, clients: [a, b, c], members, start, plan } = setup(t);
  start();
  const signal = { t: 'p2p.signal', epoch: plan().epoch, to: b.playerId, description: { type: 'offer', sdp: 'v=0' } };
  assert.deepEqual(lobby.onMessage(a, signal), { ok: true });
  assert.deepEqual(b.ws.frames[0], { t: 'p2p.signal', epoch: plan().epoch, from: a.playerId, description: signal.description });
  assert.equal(lobby.onMessage(b, { ...signal, to: c.playerId }).error, ERR.BAD_TARGET);
  assert.deepEqual(lobby.onMessage(a, { ...signal, epoch: 'stale' }), { ok: true }, 'late negotiation after topology change is harmless');
  assert.equal(b.ws.frames.length, 1, 'stale signal is never forwarded');
  assert.deepEqual(lobby.onMessage(c, { t: 'p2p.ready', epoch: 'stale', ready: true, seq: 999 }), { ok: true });
  const stranger = { playerId: 'outside', connected: true, roomCode: 'EFGH', ws: socket() };
  members.set(stranger.playerId, stranger);
  assert.equal(lobby.onMessage(a, { ...signal, to: stranger.playerId }).error, ERR.BAD_TARGET);
  assert.equal(stranger.ws.frames.length, 0);
  for (let i = 0; i < 23; i++) assert.equal(lobby.onMessage(a, signal).ok, true);
  assert.equal(lobby.onMessage(a, signal).error, ERR.RATE);
  assert.equal(lobby.onMessage(c, { t: 'p2p.ready', epoch: plan().epoch, ready: true, seq: 10 }).error, ERR.BAD_TARGET);
  assert.equal(room.code, 'ABCD');
});

test('protocol rejects injection, ambiguous signals, oversized SDP, and invalid acknowledgement sequences', () => {
  const signal = { t: 'p2p.signal', epoch: 'epoch', to: 'player', candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null } };
  assert.equal(validateC2S(signal), null);
  assert(validateC2S({ ...signal, description: { type: 'offer', sdp: 'x' } }));
  assert(validateC2S({ ...signal, candidate: undefined }));
  assert(validateC2S({ ...signal, candidate: undefined, description: { type: 'offer', sdp: 'x'.repeat(16385) } }));
  assert(validateC2S({ ...signal, candidate: { candidate: 'x', sdpMid: null, sdpMLineIndex: -1 } }));
  assert(validateC2S({ t: 'p2p.ready', epoch: 'epoch', ready: true, seq: -1 }));
  assert(validateC2S({ t: 'p2p.ready', epoch: 'epoch', ready: true, seq: Number.MAX_SAFE_INTEGER + 1 }));
  assert(validateC2S({ t: 'p2p.frame', epoch: 'epoch', seq: 1, payload: '{}' }), 'clients cannot inject server frames');
});

test('an acknowledged snapshot still comes back on WebSocket by the original deadline', async (t) => {
  const { lobby, room, clients: [a, b], start, ready, plan, clear } = setup(t, 2, { ackMs: 70 });
  start();
  lobby.broadcastRoom(room, { t: 'm.public', turn: 1 });
  const timer = plan().peers[1].timer;
  await pause(20);
  lobby.broadcastRoom(room, { t: 'm.public', turn: 2 });
  assert.equal(plan().peers[1].timer, timer, 'new frames cannot postpone an old unacknowledged delivery');
  assert.equal(b.ws.frames.length, 0);
  ready(b, 2);
  assert.equal(plan().peers[1].timer, timer, 'an acknowledgement cannot cancel it either');
  await pause(70);
  // The bytes still go out: a receiver that already had them drops the copy by sequence.
  assert.equal(b.ws.frames.length, 1);
  assert.equal(b.ws.frames[0].t, 'p2p.frame');
  assert.equal(b.ws.frames[0].fallback, undefined, 'a confirmed route is not torn down');
  assert.equal(JSON.parse(b.ws.frames[0].payload).turn, 2);
  assert.equal(plan().peers[1].timer, null);
  assert.equal(plan().peers[1].ready, true, 'the route stays in service');
  assert.equal(plan().peers[1].blocked, false);
  clear();
  lobby.broadcastRoom(room, { t: 'm.public', turn: 3 });
  assert.equal(a.ws.frames.at(-1).t, 'p2p.frame');
  assert.equal(b.ws.frames.length, 0, 'the receiver is still served over RTC');
});

test('a receiver that confirms a sequence it never applied still recovers the snapshot', async (t) => {
  const { lobby, room, clients: [_a, b], start, ready, plan } = setup(t, 2, { ackMs: 60 });
  start();
  lobby.broadcastRoom(room, { t: 'm.public', turn: 1, gold: 7 });
  // The receiver's pulse claims the newest sequence although the forwarded bytes never reached game state
  // (the old client acknowledged frames it had merely received). The snapshot stays on the hook.
  ready(b, 1);
  assert.notEqual(plan().peers[1].timer, null, 'the watchdog is not cancelled by a self-reported sequence');
  assert.equal(b.ws.frames.length, 0);
  await pause(80);
  const frames = b.ws.frames.filter((f) => f.t === 'p2p.frame' || f.t === 'm.public');
  assert.equal(frames.length, 1, 'the snapshot is re-delivered over the authenticated WebSocket');
  const msg = frames[0].t === 'p2p.frame' ? JSON.parse(frames[0].payload) : frames[0];
  assert.equal(msg.turn, 1);
  assert.equal(msg.gold, 7, 'no state is lost behind a false acknowledgement');
});

test('fresh readiness needs a lease; signing/ack timers are absent for raw-only and oversized state', (t) => {
  const { lobby, room, clients, start, plan, advance, clear } = setup(t, 2);
  start(); advance(3001);
  lobby.broadcastRoom(room, { t: 'm.public', expired: true });
  for (const c of clients) assert.deepEqual(c.ws.frames.map(stateOnly), [{ t: 'm.public', expired: true }]);
  for (const p of plan().peers) assert.equal(p.timer, null);
  start(); clear();
  const payload = { t: 'm.public', text: 'x'.repeat(P2P_FRAME_BYTES) };
  lobby.broadcastRoom(room, payload);
  for (const c of clients) assert.deepEqual(c.ws.frames.map(stateOnly), [payload]);
  assert.equal(plan().seq, 0);
  for (const p of plan().peers) assert.equal(p.timer, null);
});

test('steady delayed ACK progress keeps the route while stagnant ACK heartbeats still time out', async (t) => {
  const { lobby, room, clients: [a, b], start, ready, plan, clear } = setup(t, 2, { ackMs: 100 });
  start();
  lobby.broadcastRoom(room, { t: 'm.public', turn: 1 });
  const timer = plan().peers[1].timer;
  await pause(40);
  lobby.broadcastRoom(room, { t: 'm.public', turn: 2 });
  assert.equal(plan().peers[1].timer, timer, 'new state cannot postpone the deadline');
  // The receiver always lags the newest frame but keeps confirming: the watchdog re-sends and leaves the route up.
  ready(a, 1); ready(b, 1);
  await pause(80);
  assert.equal(plan().peers[1].blocked, false, 'an advancing ACK is a healthy receiver, not a blackhole');
  assert.equal(plan().peers[1].ready, true);
  assert.equal(b.ws.frames.length, 1);
  assert.equal(b.ws.frames[0].fallback, undefined);
  assert.equal(JSON.parse(b.ws.frames[0].payload).turn, 2, 'the latest snapshot is what comes back');
  clear();
  // Now its watermark stops moving while new state keeps coming: the route is torn down and the frame says so.
  lobby.broadcastRoom(room, { t: 'm.public', turn: 3 });
  const fixed = plan().peers[1].timer;
  for (let turn = 4; turn <= 5; turn++) {
    await pause(40);
    lobby.broadcastRoom(room, { t: 'm.public', turn });
    ready(a, turn - 1); ready(b, 1);  // the receiver's watermark never moves
    assert.equal(plan().peers[1].timer, fixed, 'unchanged ACK heartbeats and new state do not hide a blackholed relay');
  }
  await pause(60);
  assert.equal(b.ws.frames.length, 1);
  assert.equal(b.ws.frames.at(-1).fallback, true, 'a stagnant watermark is treated as a blackholed route');
  assert.equal(JSON.parse(b.ws.frames.at(-1).payload).turn, 5, 'timeout still resends the latest available state');
  assert.equal(plan().peers[1].blocked, true);
});

test('public delivery stream orders raw, RTC, and direct snapshots across topology changes and room reuse', (t) => {
  const { lobby, room, clients: [a, b], start, ready, enable, clear } = setup(t, 2);
  const initial = { t: 'm.public', serverNow: 1000, turn: 1 };
  const first = JSON.parse(lobby.broadcastRoom(room, initial));
  assert.deepEqual(initial, { t: 'm.public', serverNow: 1000, turn: 1 }, 'transport metadata never mutates Match state');
  assert.match(first.deliveryEpoch, /^[a-f0-9]{32}$/);
  assert.equal(first.deliverySeq, 1);
  start();
  const second = JSON.parse(lobby.broadcastRoom(room, { t: 'm.public', serverNow: 1000, turn: 2 }));
  assert.equal(second.deliveryEpoch, first.deliveryEpoch);
  assert.equal(second.deliverySeq, 2);
  assert.deepEqual(JSON.parse(a.ws.frames.at(-1).payload), second);
  assert.equal(b.ws.frames.length, 0);
  ready(b, 1);
  enable(b, false); clear();
  lobby.sendToPlayer(room, b.playerId, { t: 'm.public', serverNow: 1000, turn: 3, deliverySeq: -10, deliveryEpoch: 'untrusted' });
  const direct = b.ws.frames[0];
  assert.equal(direct.deliveryEpoch, first.deliveryEpoch);
  assert.equal(direct.deliverySeq, 3, 'a direct snapshot shares the room-wide serial and overwrites supplied metadata');
  const fourth = JSON.parse(lobby.broadcastRoom(room, { t: 'm.public', serverNow: 1000, turn: 4 }));
  assert.equal(fourth.deliverySeq, 4);
  assert.equal(fourth.deliveryEpoch, first.deliveryEpoch);
  const replacementRoom = new Room(room.code, 'coop', 'NORMAL', 1000);
  const replacement = JSON.parse(lobby.broadcastRoom(replacementRoom, { t: 'm.public', serverNow: 1000, turn: 1 }));
  assert.notEqual(replacement.deliveryEpoch, first.deliveryEpoch, 'reusing the short join code cannot reuse the snapshot stream');
  assert.equal(replacement.deliverySeq, 1);
});

test('relay WS send failure immediately falls back for every receiver', (t) => {
  const { lobby, room, clients: [a, b, c], start } = setup(t);
  start();
  a.ws.send = () => { throw new Error('socket failure'); };
  const payload = { t: 'm.public', turn: 1 };
  lobby.broadcastRoom(room, payload);
  // The relay's socket cannot carry the fanout, so the route is dropped (every member is told peer delivery is off)
  // and the lobby sends its own copy to everyone.
  assert.deepEqual(b.ws.frames.filter((f) => f.t === 'm.public').map(stateOnly), [payload]);
  assert.deepEqual(c.ws.frames.filter((f) => f.t === 'm.public').map(stateOnly), [payload]);
  assert.deepEqual(b.ws.frames.filter((f) => f.t === 'p2p.config'), [{ t: 'p2p.config', enabled: false }]);
  assert.equal(lobby.peerRelay.rooms.size, 0);
});

test('raw fallback invalidates delayed peer bytes before a newer oversized snapshot', (t) => {
  const { lobby, room, clients: [a, b], start, plan } = setup(t, 2);
  start();
  lobby.broadcastRoom(room, { t: 'm.public', serverNow: 1000, turn: 1 });
  const previous = plan();
  const oversized = { t: 'm.public', serverNow: 1000, turn: 2, text: 'x'.repeat(P2P_FRAME_BYTES) };
  lobby.broadcastRoom(room, oversized);
  assert.notEqual(plan().epoch, previous.epoch);
  assert(previous.peers.every((p) => p.timer === null));
  assert.deepEqual(stateOnly(a.ws.frames.at(-1)), oversized);
  assert.deepEqual(stateOnly(b.ws.frames.at(-1)), oversized);
  assert(plan().peers.every((p) => !p.ready));
});

test('membership, replacement, match lifecycle, disconnect, and shutdown invalidate stale routing and clean timers', (t) => {
  const { lobby, room, clients: [a, b, c], start, plan, enable, ready, clear } = setup(t);
  start();
  let epoch = plan().epoch;
  lobby.sendState(room, a);
  assert.equal(plan().epoch, epoch, 'ordinary state resync preserves healthy topology');
  lobby.broadcastRoom(room, { t: 'm.public', turn: 1 });
  room.match = {};
  lobby.broadcastState(room);
  assert.notEqual(plan().epoch, epoch, 'new match invalidates in-flight snapshots');
  epoch = plan().epoch;
  b.ws = socket();
  lobby.sendState(room, b);
  assert.notEqual(plan().epoch, epoch);
  assert.equal(plan().peers.some((p) => p.session === b), false, 'replaced socket must opt in again');
  enable(b); [a, b, c].forEach((x) => ready(x));
  lobby.broadcastRoom(room, { t: 'm.public', turn: 2 });
  const previous = plan();
  c.connected = false; c.ws.readyState = 3;
  lobby.onDisconnect(c);
  assert.notEqual(plan().epoch, previous.epoch);
  assert(previous.peers.every((p) => p.timer === null));
  assert.equal(lobby.peerRelay.capable(c), false);
  clear(); [a, b].forEach((x) => ready(x));
  lobby.broadcastRoom(room, { t: 'm.public', turn: 3 });
  const ending = plan();
  lobby.shutdown();
  assert.equal(lobby.peerRelay.rooms.size, 0);
  assert(ending.peers.every((p) => p.timer === null));
});

test('peer delivery is off unless the operator enables SP_P2P', (t) => {
  assert.equal(p2pEnabledFromEnv({}), false, 'no variable at all keeps the server fanout');
  for (const value of ['', '0', 'off', 'false', 'no', '2']) assert.equal(p2pEnabledFromEnv({ SP_P2P: value }), false, value);
  for (const value of ['1', 'true', 'TRUE', ' on ']) assert.equal(p2pEnabledFromEnv({ SP_P2P: value }), true, value);
  const old = process.env.SP_P2P;
  try {
    delete process.env.SP_P2P;
    const lobby = new Lobby({ registry: { byId: () => null }, getData: () => ({}), now: () => 1000 });
    t.after(() => lobby.shutdown());
    assert.equal(lobby.peerRelay.enabled, false, 'a plain start distributes public state from the server');
    const room = new Room('ABCD', 'coop', 'NORMAL', 1000);
    lobby.rooms.set(room.code, room);
    const client = { playerId: 'p1', name: 'A', connected: true, roomCode: room.code, ws: socket() };
    lobby.registry.byId = () => client;
    room.seats[0] = lobby.humanSeat(0, client);
    room.hostId = client.playerId;
    assert.deepEqual(lobby.onMessage(client, { t: 'p2p.enable', enabled: true }), { ok: true });
    assert.equal(lobby.peerRelay.capable(client), false, 'an opt-in cannot switch peer delivery on by itself');
    assert.deepEqual(client.ws.frames.at(-1), { t: 'p2p.config', enabled: false }, 'the browser is told it is off');
    const payload = { t: 'm.public', turn: 1 };
    lobby.broadcastRoom(room, payload);
    assert.deepEqual(client.ws.frames.filter((f) => f.t === 'm.public').map(stateOnly), [payload]);
    assert.equal(lobby.peerRelay.rooms.size, 0, 'no room plan exists while the switch is off');
  } finally {
    if (old === undefined) delete process.env.SP_P2P;
    else process.env.SP_P2P = old;
  }
});

test('peer delivery coexists with the negotiated state-delta transport', async (t) => {
  const { lobby, room, clients: [a, b], start, plan, clear } = setup(t, 2, { ackMs: 60 });
  // A client that named the version in its hello gets its public view as m.state frames (shared/stateDelta.js).
  negotiateStateDelta(a.ws, STATE_DELTA_VERSION);
  negotiateStateDelta(b.ws, STATE_DELTA_VERSION);
  // Nobody has opted in yet, so the lobby's own fanout runs: a full frame first, then a patch.
  const first = lobby.broadcastRoom(room, { t: 'm.public', serverNow: 1000, turn: 1 });
  const full = a.ws.frames.at(-1);
  assert.equal(full.t, 'm.state');
  assert.deepEqual(full.full, JSON.parse(first));
  clear();
  const second = lobby.broadcastRoom(room, { t: 'm.public', serverNow: 1001, turn: 2 });
  const patch = a.ws.frames.at(-1);
  assert.equal(patch.t, 'm.state');
  assert.equal(patch.base, full.seq, 'each connection keeps its own baseline');
  assert.ok(patch.patch);
  const baseline = applyStatePatch(full.full, patch.patch);
  assert.deepEqual(baseline, JSON.parse(second));
  // Now both opt in. The relay receives the signed frame over its own WebSocket — never as a delta, because it
  // must forward these exact bytes — and the ready receiver is left to the peer channel.
  start(); clear();
  lobby.broadcastRoom(room, { t: 'm.public', serverNow: 1002, turn: 3 });
  assert.equal(a.ws.frames.at(-1).t, 'p2p.frame');
  const third = a.ws.frames.at(-1).payload;
  assert.equal(b.ws.frames.length, 0, 'the receiver is served over RTC');
  // Its watchdog puts that snapshot (the LATEST one) back on its own WebSocket, marked `fallback`, and abandons the route.
  await pause(120);
  const fallback = b.ws.frames.at(-1);
  assert.equal(fallback.t, 'p2p.frame');
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.payload, third, 'the receiver gets the very snapshot it missed');
  assert.equal(plan().peers[1].blocked, true);
  // Peer traffic never moved the delta baseline, so the ordinary WebSocket stream resumes with a patch against
  // the baseline that socket already had: one delivery order, never two.
  clear();
  const fourth = lobby.broadcastRoom(room, { t: 'm.public', serverNow: 1003, turn: 6 });
  const resumed = b.ws.frames.at(-1);
  assert.equal(resumed.t, 'm.state');
  assert.equal(resumed.base, patch.seq, 'the WebSocket stream resumes from the baseline peer traffic never touched');
  assert.deepEqual(applyStatePatch(baseline, resumed.patch), JSON.parse(fourth));
});

test('ICE configuration accepts STUN/TURN and rejects malformed configuration without exposing secrets', () => {
  assert.deepEqual(parseIceServers('[{"urls":"stun:stun.example.org:3478"},{"urls":["turn:turn.example.org:3478?transport=udp"],"username":"u","credential":"secret"}]'),
    [{ urls: ['stun:stun.example.org:3478'] }, { urls: ['turn:turn.example.org:3478?transport=udp'], username: 'u', credential: 'secret' }]);
  assert.throws(() => parseIceServers('{"credential":"secret"}'));
  assert.throws(() => parseIceServers('[{"urls":"https:example.org"}]'));
  const old = process.env.SP_P2P_ICE_SERVERS;
  const warnings = [];
  try {
    process.env.SP_P2P_ICE_SERVERS = '{"credential":"secret"}';
    const relay = new PeerRelay({ enabled: true, log: { warn: (msg) => warnings.push(msg) } });
    assert.equal(relay.enabled, false);
    assert.equal(warnings.length, 1);
    assert(!warnings[0].includes('secret'));
    relay.dispose();
  } finally {
    if (old === undefined) delete process.env.SP_P2P_ICE_SERVERS;
    else process.env.SP_P2P_ICE_SERVERS = old;
  }
});
