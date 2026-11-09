// test/lobby-ownership.test.js — room.ownership end to end over WebSocket (0.2.0 补位, 干员持有): lenient validation
// (only a malformed list is refused; non-droppable ids are dropped), storage on the session (follows the player into
// rooms, survives a resume) and on the seat, seats[].notOwned handed to the Match when it starts (bots: none), never to a
// running match (ROOM_STARTED: stored for the next one — the setting is out of match), a spectator's kept on its session,
// and the real match exposing it as m.private.standIns.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, PHASE } from '../shared/constants.js';
import { DEFAULT_VERSION } from '../shared/versions.js';

// settings outside a room are checked against the server's default version: these tests use 第二期下半's records
const CLASSIC = Object.freeze({ default: DEFAULT_VERSION });

const SILVER = 'chess_char_4_22_a'; // 银灰 (NORMAL)
const SARIA = 'chess_char_5_11_a'; // 塞雷娅 (NORMAL)
const CATHY = 'chess_char_4_11_a'; // 凯瑟琳 (PRESET)

class RecordingStub extends StubMatch {
  static instances = [];
  constructor(opts) { super(opts); this.opts = opts; RecordingStub.instances.push(this); }
}

function clientPool(getUrl) {
  const open = new Set();
  return {
    async player(name, token) {
      const c = await TestClient.connect(getUrl());
      open.add(c);
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
async function createRoom(c, mode = 'coop', difficulty = 'NORMAL') {
  await ok(c, { t: 'room.create', mode, difficulty });
  return c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === mode);
}

describe('room.ownership (lobby, stub match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', versions: CLASSIC, log: cap.log, MatchClass: RecordingStub, heavyBurst: 12, heavyPerSec: 4 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { RecordingStub.instances = []; await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('lenient: a malformed list is BAD_MSG (nothing stored); other ids are dropped; stored per session and seat; bots none', async () => {
    const host = await pool.player('Host');
    await err(host, { t: 'room.ownership', notOwned: { [SILVER]: true } }, ERR.BAD_MSG);
    await err(host, { t: 'room.ownership', notOwned: ['bad id'] }, ERR.BAD_MSG);
    // outside a room: accepted (PRESET / elite / unknown ids dropped), kept on the session
    await ok(host, { t: 'room.ownership', notOwned: [SARIA, CATHY, 'chess_char_9_99_a', `${SILVER.slice(0, -1)}b`, SILVER, SILVER] });
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    await ok(guest, { t: 'room.ownership', notOwned: [SARIA] });
    await ok(guest, { t: 'room.ownership', notOwned: [SILVER] }); // re-sent: the latest wins
    await ok(host, { t: 'room.addBot' });
    // the guest drops and resumes: the session keeps its list
    await guest.terminate();
    const back = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    await back.hello('Guest', guest.token);
    await ok(back, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const seats = RecordingStub.instances.at(-1).opts.seats;
    const by = (id) => seats.find((s) => s.playerId === id);
    assert.deepEqual(by(host.id).notOwned, [SILVER, SARIA].sort());
    assert.ok(Object.isFrozen(by(host.id).notOwned));
    assert.deepEqual(by(guest.id).notOwned, [SILVER]);
    assert.equal(seats.find((s) => s.isBot).notOwned, null, 'bots own every operator');
    // during the match: refused for this match (ROOM_STARTED) but stored for the next one
    const r = await err(host, { t: 'room.ownership', notOwned: [] }, ERR.ROOM_STARTED);
    assert.match(r.detail || '', /next match/);
    await back.terminate();
    assert.deepEqual(cap.errors, []);
  });

  test('a spectator\'s list stays on its session (never on a seat, never handed to the match)', async () => {
    const host = await pool.player('Host2');
    const st = await createRoom(host);
    const spec = await pool.player('Watcher');
    await ok(spec, { t: 'room.spectate', code: st.code });
    await spec.waitFor('room.state', (s) => (s.spectators || []).some((x) => x.playerId === spec.id));
    await ok(spec, { t: 'room.ownership', notOwned: [SILVER] });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const seats = RecordingStub.instances.at(-1).opts.seats;
    assert.ok(!seats.some((s) => s.playerId === spec.id));
    assert.equal(seats[0].notOwned, null);
  });
});

describe('room.ownership (lobby + real match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', versions: CLASSIC, log: cap.log, seedFn: () => 4242 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('the list the seat had at the start is the match\'s m.private.standIns; a change during the briefing waits for the next match', async () => {
    const a = await pool.player('Solo');
    await ok(a, { t: 'room.ownership', notOwned: [SILVER] });
    await createRoom(a, 'solo');
    await ok(a, { t: 'room.start' });
    await a.waitFor('m.public', (p) => p.phase === PHASE.INFO_CHECK, 5000);
    const priv = await a.waitFor('m.private', (p) => Array.isArray(p.standIns), 3000);
    assert.deepEqual(priv.standIns, [SILVER]);
    // stored for the next match only: this match keeps [SILVER] (PlayerState.standIns is fixed; test/match/standin-ownership)
    await err(a, { t: 'room.ownership', notOwned: [SARIA] }, ERR.ROOM_STARTED);
    await ok(a, { t: 'g.infoReady' });
    await a.waitFor('m.public', (p) => p.phase === PHASE.BAND_DRAFT, 3000);
    assert.deepEqual(cap.errors, []);
  });
});
