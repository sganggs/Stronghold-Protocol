// test/lobby-loadout.test.js — room.loadout end to end over WebSocket (DESIGN §16): strict validation, storage on the
// session (follows the player into rooms, survives a resume) and on the seat, seats[].loadout handed to the Match
// (bots: none), re-sendable until the match leaves INFO_CHECK (real Match: accepted in the briefing, WRONG_PHASE after),
// the heavy-intent rate limit; its per-operator 潜能 / 练度 `ops` (0.2.2): validated with it, stored and handed over beside it.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { getData } from '../server/data.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, PHASE } from '../shared/constants.js';
import { DEFAULT_VERSION } from '../shared/versions.js';

// settings outside a room are checked against the server's default version: these tests use 第二期下半's records
const CLASSIC = Object.freeze({ default: DEFAULT_VERSION });

const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
const C = (id) => DATA.chess[id];
const INSIDE = 'chess_char_1_01_a'; // 隐现: S1 / S2 (default S2), module MAR-X
const SWIRE = 'chess_char_3_04_a'; // 琳琅诗怀雅: three modules
const SWIRE_ALT = C(C(SWIRE).goldenId).modules.find((m) => !m.isDefault).uniEquipId;

/** Stub match that records its constructor options (the seats) — it has no setLoadout. */
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

describe('room.loadout (lobby, stub match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', versions: CLASSIC, log: cap.log, MatchClass: RecordingStub, heavyBurst: 6, heavyPerSec: 2 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { RecordingStub.instances = []; await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('strict validation: structure (BAD_MSG) and data (BAD_TARGET); a refusal keeps the stored loadout', async () => {
    const a = await pool.player('A');
    await err(a, { t: 'room.loadout', entries: [] }, ERR.BAD_MSG);
    await err(a, { t: 'room.loadout', entries: { [INSIDE]: { skill: 0, extra: true } } }, ERR.BAD_MSG);
    await err(a, { t: 'room.loadout', entries: { [INSIDE]: { skill: 2 } } }, ERR.BAD_TARGET); // no S3
    await err(a, { t: 'room.loadout', entries: { [C(INSIDE).goldenId]: { skill: 0 } } }, ERR.BAD_TARGET); // elite id
    await err(a, { t: 'room.loadout', entries: { chess_char_9_99_a: { skill: 0 } } }, ERR.BAD_TARGET);
    await err(a, { t: 'room.loadout', entries: { [INSIDE]: { module: SWIRE_ALT } } }, ERR.BAD_TARGET); // another character's module
    // outside a room: accepted, kept on the session
    await ok(a, { t: 'room.loadout', entries: { [INSIDE]: { skill: 0 } } });
    await err(a, { t: 'room.loadout', entries: { [INSIDE]: { skill: 7 } } }, ERR.BAD_TARGET);
    const st = await createRoom(a, 'solo');
    await ok(a, { t: 'room.start' });
    await a.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const m = RecordingStub.instances.at(-1);
    assert.equal(m.opts.roomCode, st.code);
    assert.deepEqual(m.opts.seats[0].loadout, { [INSIDE]: { skill: 0, module: 'uniequip_002_inside' } }, 'the last valid loadout');
    assert.deepEqual(cap.errors, []);
  });

  test('stored per session and seat: follows into rooms, latest wins until start, bots get none, resume keeps it', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.loadout', entries: { [SWIRE]: { module: SWIRE_ALT } } });
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    await ok(guest, { t: 'room.loadout', entries: { [INSIDE]: { skill: 0, module: 'none' } } });
    await ok(guest, { t: 'room.loadout', entries: { [INSIDE]: { module: 'none' } } }); // re-sent: the latest wins
    await ok(host, { t: 'room.addBot' });
    // the guest drops and resumes: the session keeps its loadout
    await guest.terminate();
    const back = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    await back.hello('Guest', guest.token);
    await ok(back, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const seats = RecordingStub.instances.at(-1).opts.seats;
    const by = (id) => seats.find((s) => s.playerId === id);
    assert.deepEqual(by(host.id).loadout, { [SWIRE]: { skill: C(SWIRE).skill.index, module: SWIRE_ALT } });
    assert.deepEqual(by(guest.id).loadout, { [INSIDE]: { skill: 1, module: 'none' } });
    const bot = seats.find((s) => s.isBot);
    assert.equal(bot.loadout, null, 'bots fight with the defaults');
    assert.ok(Object.isFrozen(by(host.id).loadout));
    // during a match without setLoadout: refused (ROOM_STARTED) but stored for the next match
    await err(host, { t: 'room.loadout', entries: {} }, ERR.ROOM_STARTED);
    await back.terminate();
  });

  test('潜能 / 练度 (ops, 0.2.2): strict validation, defaults dropped, stored per session and seat beside the loadout; a message without ops sets none', async () => {
    const VENDLA = C('chess_char_1_06_a').charId;   // a 特许 operator of the roster
    const KALTS = 'char_003_kalts';                   // an owned-6★ 自选 pick
    const a = await pool.player('Ops');
    await err(a, { t: 'room.loadout', entries: {}, ops: [] }, ERR.BAD_MSG);
    await err(a, { t: 'room.loadout', entries: {}, ops: { [VENDLA]: {} } }, ERR.BAD_MSG);
    await err(a, { t: 'room.loadout', entries: {}, ops: { [VENDLA]: { potential: 0 } } }, ERR.BAD_MSG);
    await err(a, { t: 'room.loadout', entries: {}, ops: { [VENDLA]: { potential: 7 } } }, ERR.BAD_MSG);
    await err(a, { t: 'room.loadout', entries: {}, ops: { [VENDLA]: { cultivate: 4 } } }, ERR.BAD_MSG);
    await err(a, { t: 'room.loadout', entries: {}, ops: { [VENDLA]: { potential: 2, elite: 1 } } }, ERR.BAD_MSG);
    await err(a, { t: 'room.loadout', entries: {}, ops: { char_609_acguad: { potential: 1 } } }, ERR.BAD_TARGET); // a prototype
    await err(a, { t: 'room.loadout', entries: {}, ops: { char_999_nobody: { potential: 1 } } }, ERR.BAD_TARGET);
    // a refusal of the ops refuses the entries too (nothing stored)
    await err(a, { t: 'room.loadout', entries: { [INSIDE]: { skill: 0 } }, ops: { char_999_nobody: { potential: 1 } } }, ERR.BAD_TARGET);
    await ok(a, { t: 'room.loadout', entries: { [INSIDE]: { skill: 0 } }, ops: { [VENDLA]: { potential: 1, cultivate: 0 }, [KALTS]: { cultivate: 2 }, [C(INSIDE).charId]: { potential: 6, cultivate: 3 } } });
    await createRoom(a, 'solo');
    await ok(a, { t: 'room.start' });
    await a.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const seat = RecordingStub.instances.at(-1).opts.seats[0];
    assert.deepEqual(seat.loadout, { [INSIDE]: { skill: 0, module: 'uniequip_002_inside' } });
    assert.deepEqual(seat.ops, { [VENDLA]: { potential: 1, cultivate: 0 }, [KALTS]: { potential: 6, cultivate: 2 } }, 'complete entries, defaults dropped');
    assert.ok(Object.isFrozen(seat.ops) && Object.isFrozen(seat.ops[VENDLA]));
    // an older client's message (no ops): none set — the next match fields every operator at 潜能 6 / 精英2 Lv.60
    await err(a, { t: 'room.loadout', entries: {} }, ERR.ROOM_STARTED);
    const b = await pool.player('Old');
    await ok(b, { t: 'room.loadout', entries: { [INSIDE]: { skill: 0 } } });
    await createRoom(b, 'solo');
    await ok(b, { t: 'room.start' });
    await b.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    assert.deepEqual(RecordingStub.instances.at(-1).opts.seats[0].ops, {});
    assert.deepEqual(cap.errors, []);
  });

  test('heavy-intent limit: a burst of room.loadout beyond the bucket is rate-limited', async () => {
    const a = await pool.player('Spam');
    const replies = await Promise.all(Array.from({ length: 10 }, () => a.request({ t: 'room.loadout', entries: {} })));
    const codes = replies.map((r) => (r.t === 'ok' ? 'ok' : r.code));
    assert.ok(codes.includes('ok'));
    assert.ok(codes.includes(ERR.RATE), codes.join(','));
  });
});

describe('room.loadout (lobby + real match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', versions: CLASSIC, log: cap.log, seedFn: () => 4242 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('accepted during INFO_CHECK (the briefing entry), locked afterwards; the solo briefing has no deadline', async () => {
    const a = await pool.player('Solo');
    await createRoom(a, 'solo');
    await ok(a, { t: 'room.start' });
    const pub = await a.waitFor('m.public', (p) => p.phase === PHASE.INFO_CHECK, 5000);
    assert.equal(pub.deadline, 0, 'solo INFO_CHECK is untimed');
    await ok(a, { t: 'room.loadout', entries: { [INSIDE]: { skill: 0 } } });
    const priv = await a.waitFor('m.private', (p) => p.loadout && p.loadout[INSIDE], 3000);
    assert.deepEqual(priv.loadout, { [INSIDE]: { skill: 0, module: 'uniequip_002_inside' } });
    await ok(a, { t: 'g.infoReady' });
    await a.waitFor('m.public', (p) => p.phase === PHASE.BAND_DRAFT, 3000);
    const r = await err(a, { t: 'room.loadout', entries: {} }, ERR.WRONG_PHASE);
    assert.match(r.detail || '', /locked/);
    assert.deepEqual(cap.errors, []);
  });

  test('潜能 / 练度 (0.2.2): taken with the loadout in the briefing (m.private.ops), stated in the battle input; locked afterwards', async () => {
    const VENDLA = C('chess_char_1_06_a').charId;
    const a = await pool.player('Solo2');
    await createRoom(a, 'solo');
    await ok(a, { t: 'room.start' });
    await a.waitFor('m.public', (p) => p.phase === PHASE.INFO_CHECK, 5000);
    await ok(a, { t: 'room.loadout', entries: {}, ops: { [VENDLA]: { potential: 2, cultivate: 1 } } });
    const priv = await a.waitFor('m.private', (p) => p.ops && p.ops[VENDLA], 3000);
    assert.deepEqual(priv.ops, { [VENDLA]: { potential: 2, cultivate: 1 } });
    await ok(a, { t: 'g.infoReady' });
    await a.waitFor('m.public', (p) => p.phase === PHASE.BAND_DRAFT, 3000);
    await err(a, { t: 'room.loadout', entries: {}, ops: {} }, ERR.WRONG_PHASE);
    assert.deepEqual(cap.errors, []);
  });
});
