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

test('fixed codes stay out of lifecycle logs, occupied errors and invalid-value errors', () => {
  const lines = [];
  const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => lines.push(args)]));
  const lobby = new Lobby({ registry: { byId: () => null }, getData: () => ({}), options: { roomCode: 'ZZ99' }, log });
  const owner = newSession('owner');
  assert.deepEqual(lobby.create(owner, { mode: 'coop', difficulty: 'FUNNY' }), { ok: true });
  const refused = lobby.create(newSession('stranger'), { mode: 'coop', difficulty: 'FUNNY' });
  assert.equal(refused.error, 'ROOM_CODE_TAKEN');
  assert.doesNotMatch(JSON.stringify(refused), /ZZ99/);
  lobby.shutdown();
  assert.ok(lines.length > 0, 'the lifecycle is still logged');
  assert.doesNotMatch(JSON.stringify(lines), /ZZ99/);
  assert.throws(() => parseRoomCode('secret-too-long'), e => e instanceof RangeError && !e.message.includes('secret-too-long'));
});

test('a late fixed-plugin/version refusal preserves the sole-human room before a fixed-code replacement', () => {
  const lobby = newLobby('ARK1'), session = newSession('owner');
  lobby.create(session, { mode: 'coop', difficulty: 'FUNNY' });
  const old = lobby.rooms.get('ARK1');
  lobby.versions = { isEnabled: () => true, offered: () => ['FUNNY'], content: () => null };
  lobby.plugins = { defaults: () => ['required'], fixed: () => ['required'] };
  lobby.resolveContent = () => ({ error: 'VERSION_UNSUPPORTED' });
  let considered = false;
  const gen = lobby.genCode.bind(lobby);
  lobby.genCode = room => { considered = room === old; return gen(room); };
  const result = lobby.create(session, { mode: 'coop', difficulty: 'FUNNY', version: 'act1autochess' });
  assert.equal(considered, true, 'code generation temporarily considers the old room releasable');
  assert.equal(result.error, 'VERSION_UNSUPPORTED');
  assert.equal(lobby.rooms.get('ARK1'), old);
  assert.equal(old.disposed, false);
  assert.equal(old.seats[0].playerId, session.playerId);
  assert.equal(session.roomCode, 'ARK1');
  lobby.shutdown();
});

test('launcher drops inherited SP_ROOM_CODE and keeps the explicit argument out of setup', async () => {
  const { parseArgs, serverEnv } = await import('../scripts/launch.mjs');
  const options = parseArgs(['--room-code=ark1', '--no-setup']);
  assert.equal(options.roomCode, 'ark1');
  assert.deepEqual(options.setupArgs, []);
  assert.equal(Object.hasOwn(serverEnv(options, { SP_ROOM_CODE: 'ZZ99' }), 'SP_ROOM_CODE'), false);
  assert.equal(Object.hasOwn(serverEnv(parseArgs([]), { SP_ROOM_CODE: 'ZZ99' }), 'SP_ROOM_CODE'), false);
});
