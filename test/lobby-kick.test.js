// test/lobby-kick.test.js — room.kick (community report #17, owner approved): before the match the host removes another
// human like an AI seat (server/lobby.js kick). The player gets room.closed {kicked} (now, or on the next resume when
// offline), the reconnect token no longer leads back to the seat, and the player may join again (no ban) [ASSUMED].
// The message names the confirmed player too: a seat that changed hands while the host's dialog was open is refused.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

function clientPool(getUrl) {
  const open = new Set();
  return {
    async connect() { const c = await TestClient.connect(getUrl()); open.add(c); return c; },
    async player(name, token) {
      const c = await this.connect();
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;
async function createRoom(c) {
  await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  return c.waitFor('room.state', (s) => s.hostId === c.id);
}
async function joinRoom(c, code) {
  await ok(c, { t: 'room.join', code });
  return c.waitFor('room.state', (s) => s.code === code && !!seatOf(s, c.id));
}

describe('room.kick (lobby)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: StubMatch, lobbyGraceMs: 60_000 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('protocol: room.kick {seat, playerId} — a seat index and the confirmed player', () => {
    assert.equal(validateC2S({ t: 'room.kick', seat: 1, playerId: 'p_0123456789' }), null);
    assert.notEqual(validateC2S({ t: 'room.kick', seat: 1 }), null, 'the player is required');
    assert.notEqual(validateC2S({ t: 'room.kick', seat: 9, playerId: 'p_0123456789' }), null);
    assert.notEqual(validateC2S({ t: 'room.kick', seat: 1, playerId: '' }), null);
    assert.notEqual(validateC2S({ t: 'room.kick' }), null);
  });

  test('the host kicks a connected human: room.closed {kicked}, the seat is freed, the player may join again', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await joinRoom(guest, st.code);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    guest.clearInbox();
    await ok(host, { t: 'room.kick', seat: 1, playerId: guest.id });
    const closed = await guest.waitFor('room.closed');
    assert.equal(closed.reason, 'kicked');
    const after = await host.waitFor('room.state', (s) => s.seats[1] === null);
    assert.equal(after.hostId, host.id);
    await guest.expectNone('room.state');
    await err(guest, { t: 'room.ready', ready: true }, ERR.NOT_IN_ROOM);
    // no ban: the same player joins again (lowest free seat)
    const back = await joinRoom(guest, st.code);
    assert.equal(seatOf(back, guest.id).seat, 1);
    assert.equal(seatOf(back, guest.id).ready, false);
  });

  test('an offline human is removed at once; the old token resumes outside the room with room.closed {kicked}', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await joinRoom(guest, st.code);
    await guest.terminate();
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.connected === false);
    await ok(host, { t: 'room.kick', seat: 1, playerId: guest.id });
    await host.waitFor('room.state', (s) => s.seats[1] === null);
    // the host can start alone right away (the offline seat no longer blocks it with NOT_READY)
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch === true);
    const again = await pool.connect();
    const w = await again.hello('Guest', guest.token);
    assert.equal(w.resumed, true, 'the identity survives');
    assert.equal(w.playerId, guest.id);
    const closed = await again.waitFor('room.closed');
    assert.equal(closed.reason, 'kicked');
    await again.expectNone('room.state');
    await err(again, { t: 'room.ready', ready: true }, ERR.NOT_IN_ROOM);
  });

  test('refusals: not the host, yourself, an AI seat, an empty seat, during a match', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await joinRoom(guest, st.code);
    await err(guest, { t: 'room.kick', seat: 0, playerId: host.id }, ERR.NOT_HOST);
    const self = await err(host, { t: 'room.kick', seat: 0, playerId: host.id }, ERR.BAD_TARGET);
    assert.match(self.detail || self.msg, /yourself/);
    await ok(host, { t: 'room.addBot' });
    const withBot = await host.waitFor('room.state', (s) => s.seats[2]?.isBot);
    await err(host, { t: 'room.kick', seat: 2, playerId: withBot.seats[2].playerId }, ERR.BAD_TARGET);
    await err(host, { t: 'room.kick', seat: 3, playerId: guest.id }, ERR.BAD_TARGET);
    await err(host, { t: 'room.kick', seat: 1 }, ERR.BAD_MSG);
    const stranger = await pool.player('Stranger');
    await err(stranger, { t: 'room.kick', seat: 1, playerId: guest.id }, ERR.NOT_IN_ROOM);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(host, { t: 'room.start' });
    await host.waitFor('room.state', (s) => s.inMatch === true);
    await err(host, { t: 'room.kick', seat: 1, playerId: guest.id }, ERR.ROOM_STARTED);
  });

  test('a seat that changed hands while the host confirmed is refused: the newcomer stays (review of #17)', async () => {
    const host = await pool.player('Host');
    const st = await createRoom(host);
    const alice = await pool.player('Alice');
    await joinRoom(alice, st.code);
    await host.waitFor('room.state', (s) => seatOf(s, alice.id)?.seat === 1);
    // the host's dialog names Alice … she leaves and Bob takes seat 1 before the host confirms
    await ok(alice, { t: 'room.leave' });
    await host.waitFor('room.state', (s) => s.seats[1] === null);
    const bob = await pool.player('Bob');
    const joined = await joinRoom(bob, st.code);
    assert.equal(seatOf(joined, bob.id).seat, 1);
    bob.clearInbox();
    const stale = await err(host, { t: 'room.kick', seat: 1, playerId: alice.id }, ERR.BAD_TARGET);
    assert.match(stale.detail || stale.msg, /changed hands/);
    await bob.expectNone('room.closed');
    await ok(bob, { t: 'room.ready', ready: true });
    const still = await host.waitFor('room.state', (s) => seatOf(s, bob.id)?.ready);
    assert.equal(seatOf(still, bob.id).seat, 1, 'Bob keeps the seat');
    // naming Bob works
    await ok(host, { t: 'room.kick', seat: 1, playerId: bob.id });
    assert.equal((await bob.waitFor('room.closed')).reason, 'kicked');
  });
});
