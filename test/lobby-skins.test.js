// test/lobby-skins.test.js — room.skins end to end over WebSocket (docs/SKINS.md): the structural check (a skinId
// that is NOT an isId, ≤ SKIN_LIMITS.entries charId keys), storage on the session and the seat, the seat handed to
// the Match when it starts, bots refused, and — unlike room.loadout / room.diy / room.ownership — a change while a
// match runs going straight to it rather than being stored for the next one.
//
// The match here is the StubMatch (server/match/StubMatch.js), which has no setSkins: that is exactly the older server
// the client's sync reports as 'locked' (ui/loadoutSync.js installSkinsSync), and it is what proves the reply path is
// the generic one (a match method that is missing → ROOM_STARTED 'stored for the next match').
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { SKIN_LIMITS } from '../shared/protocol.js';

const OPERATOR = 'char_498_inside';
const SKIN = 'char_498_inside@kitchen#2';
const OTHER = 'char_003_kalts';
const SKIN_OTHER = 'char_003_kalts@boc#6';

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
      c.welcome = w;
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

describe('room.skins (lobby, stub match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingStub, heavyBurst: 12, heavyPerSec: 4 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { RecordingStub.instances = []; await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('the wire check runs first: a real skinId passes, junk is BAD_MSG and nothing is stored', async () => {
    const c = await pool.player('Wire');
    await ok(c, { t: 'room.skins', skins: { [OPERATOR]: SKIN } });
    // an id with a space, an empty value, a non-string, a value past the limit, a key past the limit
    await err(c, { t: 'room.skins', skins: { [OPERATOR]: 'has space' } }, ERR.BAD_MSG);
    await err(c, { t: 'room.skins', skins: { [OPERATOR]: '' } }, ERR.BAD_MSG);
    await err(c, { t: 'room.skins', skins: { [OPERATOR]: 7 } }, ERR.BAD_MSG);
    await err(c, { t: 'room.skins', skins: { [OPERATOR]: 'x'.repeat(65) } }, ERR.BAD_MSG);
    await err(c, { t: 'room.skins', skins: { ['k'.repeat(65)]: SKIN } }, ERR.BAD_MSG);
    await err(c, { t: 'room.skins', skins: [SKIN] }, ERR.BAD_MSG);
    await err(c, { t: 'room.skins', skins: { chess_char_1_01_a: SKIN } }, ERR.BAD_MSG);
    await err(c, { t: 'room.skins', skins: { [OPERATOR]: SKIN, chess_char_1_01_a: SKIN } }, ERR.BAD_MSG);
    const big = {};
    for (let i = 0; i <= SKIN_LIMITS.entries; i++) big[`char_${i}_x`] = SKIN;
    await err(c, { t: 'room.skins', skins: big }, ERR.BAD_MSG);
    await err(c, { t: 'room.skins' }, ERR.BAD_MSG);
    // …and the install channel is not routable at all (upstream #652: it let any client make the server download files
    // and rewrite the shared data/assets.json)
    await err(c, { t: 'room.skin.install', skinId: SKIN }, ERR.BAD_MSG);
    // the accepted selection is intact after the refusals
    const st = await createRoom(c);
    assert.ok(st.seats.some((s) => s && s.playerId === c.id));
    await ok(c, { t: 'room.skins', skins: {} });
  });

  test('a charId the room does not have is dropped; a refusal does not clear the rest', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.skins', skins: { [OPERATOR]: SKIN, char_999_nope: SKIN } });
    await createRoom(host);
    await err(host, { t: 'room.skins', skins: { [OPERATOR]: '@@@' } }, ERR.BAD_MSG);
    await err(host, { t: 'room.skins', skins: { chess_char_1_01_a: SKIN } }, ERR.BAD_MSG);
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const seat = RecordingStub.instances.at(-1).opts.seats.find((s) => s.playerId === host.id);
    assert.deepEqual(seat.skins, { [OPERATOR]: SKIN }, 'the unknown operator is gone and the refusal did not clear the choice');
  });

  test('stored per session and per seat, and handed to the Match when it starts', async () => {
    const host = await pool.player('Host');
    // outside a room: accepted, and it follows the player into the room (like the loadout)
    await ok(host, { t: 'room.skins', skins: { [OPERATOR]: SKIN } });
    const st = await createRoom(host);
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    await ok(guest, { t: 'room.skins', skins: { [OTHER]: SKIN_OTHER } });
    assert.equal(RecordingStub.instances.length, 0, 'no match yet');
    await ok(guest, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const seats = RecordingStub.instances.at(-1).opts.seats;
    assert.deepEqual(seats.find((s) => s.playerId === host.id).skins, { [OPERATOR]: SKIN }, 'the lobby entry reached the match');
    assert.deepEqual(seats.find((s) => s.playerId === guest.id).skins, { [OTHER]: SKIN_OTHER });
    // during the match the stub cannot take a change (no setSkins): the generic reply is ROOM_STARTED, and the lobby
    // HAS stored it for the next one (see the seat's copy below)
    const r = await err(host, { t: 'room.skins', skins: { [OPERATOR]: SKIN_OTHER } }, ERR.ROOM_STARTED);
    assert.match(r.detail || '', /next match/);
    await ok(host, { t: 'g.infoReady' });
    await ok(guest, { t: 'g.infoReady' });
    await host.waitFor('room.state', (s) => !s.inMatch, 5000);
    await ok(host, { t: 'room.ready', ready: true });
    await ok(guest, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    assert.equal(RecordingStub.instances.length, 2);
    assert.deepEqual(RecordingStub.instances.at(-1).opts.seats.find((s) => s.playerId === host.id).skins, { [OPERATOR]: SKIN_OTHER },
      'the change made mid-match is what the next match takes');
  });

  test('a bot holds no skins', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.skins', skins: { [OPERATOR]: SKIN } });
    await createRoom(host);
    await ok(host, { t: 'room.addBot' });
    await host.waitFor('room.state', (s) => s.seats.some((x) => x && x.isBot));
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const started = RecordingStub.instances.at(-1);
    const bot = started.opts.seats.find((s) => s.isBot);
    assert.equal(bot.skins, null, 'a bot fields every operator on its default model');
    const human = started.opts.seats.find((s) => !s.isBot);
    assert.deepEqual(human.skins, { [OPERATOR]: SKIN });
    assert.deepEqual(cap.errors, []);
  });
});
