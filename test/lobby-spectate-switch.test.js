import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { getData } from '../server/data.js';
import { ERR, MAX_SPECTATORS } from '../shared/constants.js';
import { describeError } from '../public/js/ui/toasts.js';
import { spectateSwitchReason } from '../public/js/screens/room.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const ok = (r) => assert.deepEqual(r, { ok: true });

function setup(t, mode = 'coop') {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, getData, MatchClass: StubMatch, log: quiet });
  t.after(() => lobby.shutdown());
  const frames = new Map();
  const player = (name) => {
    const session = registry.create(name);
    session.connected = true;
    const messages = [];
    frames.set(session.playerId, messages);
    session.ws = { readyState: 1, bufferedAmount: 0, send(bytes) { messages.push(JSON.parse(bytes)); } };
    return session;
  };
  const host = player('Host');
  ok(lobby.create(host, { mode, difficulty: 'FUNNY' }));
  const room = lobby.roomOf(host);
  const join = (name) => {
    const session = player(name);
    ok(lobby.join(session, { code: room.code }));
    return session;
  };
  return { lobby, room, host, player, join, frames };
}

test('a player switches in place, retries idempotently and sits back with saved settings but not ready', (t) => {
  const { lobby, room, join, frames } = setup(t);
  const guest = join('Guest');
  const prefs = { loadout: {}, ops: {}, notOwned: [], diy: {}, skins: {} };
  Object.assign(guest, prefs);
  Object.assign(room.seatOf(guest.playerId), prefs);
  ok(lobby.ready(guest, { ready: true }));
  const before = frames.get(guest.playerId).length;
  ok(lobby.spectate(guest, { code: room.code.toLowerCase() }));
  assert.equal(room.seatOf(guest.playerId), null);
  assert.equal(guest.roomCode, room.code);
  assert.equal(lobby.roomOf(guest), room);
  const states = frames.get(guest.playerId).slice(before).filter((f) => f.t === 'room.state');
  assert.equal(states.length, 1, 'one complete role change, no intermediate departure');
  assert.ok(states[0].spectators.some((s) => s.playerId === guest.playerId));
  assert.ok(!states[0].seats.some((s) => s?.playerId === guest.playerId));
  ok(lobby.spectate(guest, { code: room.code }));
  assert.equal(room.spectators.length, 1);
  assert.equal(lobby.ready(guest, { ready: true }).error, ERR.SPECTATOR);
  assert.equal(lobby.setDifficulty(guest, { difficulty: 'HARD' }).error, ERR.NOT_HOST);
  ok(lobby.join(guest, { code: room.code }));
  assert.equal(room.spectators.length, 0);
  const seat = room.seatOf(guest.playerId);
  assert.equal(seat.ready, false);
  for (const [key, value] of Object.entries(prefs)) assert.equal(seat[key], value, key);
});

test('the host becomes a spectator, hands over to a connected human, and does not reclaim host on rejoining', (t) => {
  const { lobby, room, host, join } = setup(t);
  const offline = join('Offline');
  const successor = join('Successor');
  offline.connected = room.seatOf(offline.playerId).connected = false;
  ok(lobby.ready(successor, { ready: true }));
  ok(lobby.spectate(host, { code: room.code }));
  assert.equal(room.hostId, successor.playerId);
  assert.equal(lobby.rooms.get(room.code), room);
  assert.equal(lobby.start(host).error, ERR.NOT_HOST);
  ok(lobby.join(host, { code: room.code }));
  assert.equal(room.hostId, successor.playerId);
  assert.equal(room.seatOf(host.playerId).ready, false);
});

test('a lone human, including one with AI teammates, cannot leave only spectators in the room', (t) => {
  const { lobby, room, host, player } = setup(t);
  ok(lobby.addBot(host));
  ok(lobby.spectate(player('Watcher'), { code: room.code }));
  const refused = lobby.spectate(host, { code: room.code });
  assert.equal(refused.error, ERR.NOT_READY);
  assert.equal(refused.detail, 'at least one player must remain seated');
  assert.ok(room.seatOf(host.playerId));
  assert.equal(room.hostId, host.playerId);
  assert.equal(room.spectators.length, 1);
});

test('a disconnected guest is not a successor: the seat and the host stay', (t) => {
  const { lobby, room, host, join } = setup(t);
  const offline = join('Offline');
  offline.connected = room.seatOf(offline.playerId).connected = false;
  const refused = lobby.spectate(host, { code: room.code });
  assert.equal(refused.error, ERR.NOT_READY);
  assert.equal(refused.detail, 'at least one player must remain seated');
  assert.equal(room.hostId, host.playerId);
  assert.equal(room.seatOf(host.playerId).playerId, host.playerId);
  assert.equal(room.seatOf(offline.playerId).playerId, offline.playerId);
  assert.equal(room.spectators.length, 0);
});

test('a guest cannot switch when the host is the only other human and is disconnected', (t) => {
  const { lobby, room, host, join } = setup(t);
  const guest = join('Guest');
  host.connected = room.seatOf(host.playerId).connected = false;
  const refused = lobby.spectate(guest, { code: room.code });
  assert.equal(refused.error, ERR.NOT_READY);
  assert.equal(refused.detail, 'at least one player must remain seated');
  assert.equal(room.hostId, host.playerId);
  assert.equal(room.seatOf(guest.playerId).playerId, guest.playerId);
  assert.equal(room.spectators.length, 0);
});

test('full spectator seats refuse a role change without freeing the player seat', (t) => {
  const { lobby, room, host, join, player } = setup(t);
  const guest = join('Guest');
  for (let i = 0; i < MAX_SPECTATORS; i++) ok(lobby.spectate(player(`Watcher${i}`), { code: room.code }));
  const seat = room.seatOf(guest.playerId);
  const refused = lobby.spectate(guest, { code: room.code });
  assert.equal(refused.error, ERR.ROOM_FULL);
  assert.equal(refused.detail, 'no free spectator seat');
  const outsider = player('Outsider');
  const outside = lobby.spectate(outsider, { code: room.code });
  assert.equal(outside.error, ERR.ROOM_FULL);
  assert.equal(outside.detail, 'no free spectator seat');
  assert.equal(room.seatOf(guest.playerId), seat);
  assert.equal(room.spectators.length, MAX_SPECTATORS);
  assert.equal(room.hostId, host.playerId);
});

test('a running match refuses a role change, retaining the original participant', (t) => {
  const { lobby, room, host, join } = setup(t);
  const guest = join('Guest');
  ok(lobby.ready(guest, { ready: true }));
  ok(lobby.start(host));
  const seat = room.seatOf(guest.playerId);
  assert.equal(lobby.spectate(guest, { code: room.code }).error, ERR.ROOM_STARTED);
  assert.equal(room.seatOf(guest.playerId), seat);
  assert.equal(room.spectators.length, 0);
});

test('solo rooms still have no spectator seats', (t) => {
  const { lobby, room, host } = setup(t, 'solo');
  const refused = lobby.spectate(host, { code: room.code });
  assert.equal(refused.error, ERR.ROOM_FULL);
  assert.equal(refused.detail, 'solo room');
  assert.equal(room.hostId, host.playerId);
  assert.ok(room.seatOf(host.playerId));
});

test('the spectate button and the error text use the same online-human and full-strip reasons', () => {
  const seat = (id, connected) => ({ playerId: id, isBot: false, connected, ready: false });
  const facts = (humans, spectators = []) => ({ humans, spectators, mine: humans[0] });
  const room = { mode: 'coop', inMatch: false, hostId: 'h' };
  assert.equal(spectateSwitchReason(room, facts([seat('h', true), seat('g', false)]), 'h'), '至少保留一名参赛博士');
  assert.equal(spectateSwitchReason(room, facts([seat('h', true)]), 'h'), '至少保留一名参赛博士');
  assert.equal(spectateSwitchReason(room, facts([seat('h', true), seat('g', true)]), 'h'), '');
  assert.equal(spectateSwitchReason({ ...room, inMatch: true }, facts([seat('h', true), seat('g', true)]), 'h'), '模拟已开始');
  assert.equal(spectateSwitchReason(room, facts([seat('h', true), seat('g', true)], [{ playerId: 's1' }, { playerId: 's2' }]), 'h'), '观战席已满');
  assert.equal(describeError({ code: ERR.NOT_READY, detail: 'at least one player must remain seated' }), '至少保留一名参赛博士');
  assert.equal(describeError({ code: ERR.ROOM_FULL, detail: 'no free spectator seat' }), '观战席已满');
  assert.equal(describeError({ code: ERR.ROOM_FULL, detail: 'solo room' }), '房间已满');
  assert.equal(describeError({ code: ERR.NOT_READY }), '仍有玩家未就绪');
  assert.equal(describeError({ code: ERR.ROOM_FULL }), '房间已满');
});
