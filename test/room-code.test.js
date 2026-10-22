// Fixed alliance key (--room-code / startServer({ roomCode })): the parser, the per-instance argument, the option
// mapping and the one-room rule of server/lobby.js. Run with `node --test test/room-code.test.js` (the release package
// has no full test suite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoomCode, lobbyOptionsFrom } from '../server/http/config.js';
import { roomCodeFromArgv } from '../server/index.js';
import { Lobby, Room } from '../server/lobby.js';

test('parseRoomCode: four letters or digits, upper-cased; blank means random', () => {
  assert.equal(parseRoomCode('ark1'), 'ARK1');
  assert.equal(parseRoomCode('  ZZ99  '), 'ZZ99');
  assert.equal(parseRoomCode(''), null);
  assert.equal(parseRoomCode(null), null);
  // NONE is not a reserved word: it is a valid four-letter alliance key.
  assert.equal(parseRoomCode('none'), 'NONE');
  assert.throws(() => parseRoomCode('ABC'), /invalid fixed alliance key/);
  assert.throws(() => parseRoomCode('ABCDE'), /invalid fixed alliance key/);
  assert.throws(() => parseRoomCode('AB-C'), /invalid fixed alliance key/);
});

test('roomCodeFromArgv: the argument belongs to this process; absent = random', () => {
  assert.equal(roomCodeFromArgv(['--room-code', 'ark1']), 'ARK1');
  assert.equal(roomCodeFromArgv(['--room-code=ZZ99']), 'ZZ99');
  assert.equal(roomCodeFromArgv([]), null);
  assert.equal(roomCodeFromArgv(['--port', '3000']), null);
  assert.throws(() => roomCodeFromArgv(['--room-code']), /--room-code needs/);
  assert.throws(() => roomCodeFromArgv(['--room-code=']), /--room-code needs/);
  assert.throws(() => roomCodeFromArgv(['--room-code', 'ABC']), /invalid fixed alliance key/);
});

test('lobbyOptionsFrom: roomCode is the only source; absent or null means random', () => {
  assert.deepEqual(lobbyOptionsFrom({ roomCode: 'zz99' }), { roomCode: 'ZZ99' });
  assert.deepEqual(lobbyOptionsFrom({ roomCode: undefined }), {});
  assert.deepEqual(lobbyOptionsFrom({ roomCode: null }), {});
  assert.deepEqual(lobbyOptionsFrom({}), {});
});

function newLobby(roomCode) {
  return new Lobby({
    registry: { byId: () => null },
    getData: () => ({}),
    options: { roomCode },
  });
}

function newSession(playerId) {
  return {
    playerId, name: playerId, limitKey: null, addr: '127.0.0.1', connected: true, roomCode: null,
    loadout: null, ops: null, notOwned: null, diy: null, skins: null,
  };
}

test('genCode: the fixed key while it is free, null while another room holds it', () => {
  const lobby = newLobby('ARK1');
  assert.equal(lobby.genCode(), 'ARK1');
  lobby.rooms.set('ARK1', new Room('ARK1', 'coop', 'FUNNY', Date.now()));
  assert.equal(lobby.genCode(), null);
});

test('room.create: a fixed key held by another room is refused before the caller leaves their room', () => {
  const lobby = newLobby('ARK1');
  const other = new Room('ARK1', 'coop', 'FUNNY', Date.now());
  other.hostId = 'p_other';
  other.seats[0] = { seat: 0, playerId: 'p_other', name: 'other', isBot: false, ready: false, connected: true, left: false };
  lobby.rooms.set('ARK1', other);
  const res = lobby.create(newSession('p_me'), { mode: 'coop', difficulty: 'FUNNY' });
  assert.equal(res.error, 'ROOM_CODE_TAKEN');
  assert.equal(lobby.rooms.get('ARK1'), other);
});

test('room.create: every new room takes the fixed key; recreating frees it from the caller’s own room', () => {
  const lobby = newLobby('ARK1');
  const session = newSession('p_me');
  assert.deepEqual(lobby.create(session, { mode: 'coop', difficulty: 'FUNNY' }), { ok: true });
  assert.equal(session.roomCode, 'ARK1');
  assert.equal(lobby.rooms.get('ARK1').hostId, 'p_me');
  assert.deepEqual(lobby.create(session, { mode: 'coop', difficulty: 'FUNNY' }), { ok: true });
  assert.equal(session.roomCode, 'ARK1');
  assert.equal(lobby.rooms.size, 1);
});

test('room.create: the fixed key stays refused while another human is in the caller’s room', () => {
  const lobby = newLobby('ARK1');
  const session = newSession('p_me');
  lobby.create(session, { mode: 'coop', difficulty: 'FUNNY' });
  const room = lobby.rooms.get('ARK1');
  room.seats[1] = { seat: 1, playerId: 'p_other', name: 'other', isBot: false, ready: false, connected: true, left: false };
  assert.equal(lobby.create(session, { mode: 'coop', difficulty: 'FUNNY' }).error, 'ROOM_CODE_TAKEN');
  assert.equal(session.roomCode, 'ARK1');
  assert.equal(room.seats[0].playerId, 'p_me');
});
