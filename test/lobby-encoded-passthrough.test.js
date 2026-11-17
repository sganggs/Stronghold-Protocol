// test/lobby-encoded-passthrough.test.js — the lobby sends the bytes a lane Worker already produced.
//
// A Worker-encoded m.public frame used to be re-serialized once per room broadcast and once per unicast, and a
// broadcast bypassed the state transport entirely (sendRaw), so m.public deltas could never apply. Both paths now take
// the encoded bytes and go through sendSession, which owns each connection's baseline.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Lobby } from '../server/lobby.js';
import { NET_DEFAULTS, SessionRegistry } from '../server/net.js';
import { DATA } from './match/harness.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const socket = () => ({ readyState: 1, bufferedAmount: 0, frames: [], send(data) { this.frames.push(data); } });
const poison = (obj) => ({ ...obj, toJSON() { throw new Error('lobby re-encoded an already encoded frame'); } });

function soloLobby(t) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, log: quiet, getData: () => DATA });
  t.after(() => lobby.shutdown());
  const session = registry.create('Player');
  lobby.create(session, { mode: 'solo', difficulty: 'NORMAL' });
  const room = lobby.roomOf(session);
  const ctx = { results: new Map(), members: [{ playerId: session.playerId, isBot: false, left: false }] };
  session.connected = true;
  session.activeMatchCtx = ctx;
  session.ws = socket();
  return { lobby, session, room, ctx };
}

test('a match broadcast reuses the encoded bytes and keeps them as the replay frame', (t) => {
  const { lobby, session, room, ctx } = soloLobby(t);
  const bytes = '{"t":"m.public","marker":"worker-encoded"}';
  lobby.matchBroadcast(room, ctx, poison({ t: 'm.public', marker: 'worker-encoded' }), bytes);
  assert.equal(session.ws.frames[0], bytes, 'the socket received the Worker bytes, not a re-encoding');
  assert.equal(ctx.lastPublic, bytes, 'the replay keeps the same bytes');
});

test('a match unicast reuses the encoded bytes and keeps them as the result frame', (t) => {
  const { lobby, session, room, ctx } = soloLobby(t);
  const bytes = '{"t":"m.result","winner":"p_0"}';
  assert.equal(lobby.matchSend(room, ctx, session.playerId, poison({ t: 'm.result' }), bytes), true);
  assert.equal(session.ws.frames[0], bytes);
  assert.equal(ctx.results.get(session.playerId), bytes, 'the replay result is the same bytes');
});

test('without encoded bytes both paths still encode, and a disposed room stays a no-op', (t) => {
  const { lobby, session, room, ctx } = soloLobby(t);
  lobby.matchBroadcast(room, ctx, { t: 'm.public', marker: 'plain' });
  assert.deepEqual(JSON.parse(session.ws.frames[0]), { t: 'm.public', marker: 'plain' });
  assert.equal(lobby.broadcastRoom({ ...room, disposed: true }, { t: 'm.public' }, '{"t":"m.public"}'), null);
  assert.equal(session.ws.frames.length, 1, 'a disposed room sends nothing');
});

test('a slow member still has its battle snapshots dropped, and a disconnected member is skipped', (t) => {
  const { lobby, session, room, ctx } = soloLobby(t);
  const slow = lobby.registry.create('Slow');            // a spectator whose send queue is already deep
  slow.connected = true;
  slow.roomCode = room.code;
  slow.ws = socket();
  slow.ws.bufferedAmount = NET_DEFAULTS.snapDropBytes + 1;
  room.spectators.push({ playerId: slow.playerId, isBot: false, left: false });
  const gone = lobby.registry.create('Gone');            // and one that is not connected any more
  gone.connected = false;
  gone.roomCode = room.code;
  gone.ws = socket();
  room.spectators.push({ playerId: gone.playerId, isBot: false, left: false });

  lobby.matchBroadcast(room, ctx, { t: 'b.snap', tick: 1 }, '{"t":"b.snap","tick":1}');
  assert.equal(session.ws.frames.length, 1, 'the healthy member gets the snapshot');
  assert.equal(slow.ws.frames.length, 0, 'the slow member skips the droppable snapshot');
  assert.equal(gone.ws.frames.length, 0, 'a disconnected member is not sent to at all');

  const pub = '{"t":"m.public","marker":"x"}';
  lobby.matchBroadcast(room, ctx, { t: 'm.public', marker: 'x' }, pub);
  assert.equal(slow.ws.frames.length, 1, 'only snapshots are droppable: the slow member still gets this one');
  assert.equal(slow.ws.frames[0], pub, 'and it is still the encoded bytes');
  assert.equal(gone.ws.frames.length, 0, 'a disconnected member stays a no-op');
  assert.equal(session.ws.frames.length, 2);
});
