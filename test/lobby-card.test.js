// test/lobby-card.test.js — room.card (名片干员, PR #643 split 6) end to end over WebSocket: the wire check, the
// whitelist (server/lobby.js cardAllowed: an operator of the cross-period roster data/card-roster.json — any official
// period's visible chess operators and 自选编队 pool, DESIGN §37.325, #877 — or a card candidate of the room's content;
// not a hidden preset, a stand-in body or an unknown id), storage on the session (it follows the player into the next
// room) and the seat, room.state seats[].card for every member (human seats with a card only), '' clearing it, no phase
// gate (cosmetic: a running match is neither asked nor refused), a card of another period taken in any room without
// loading that period's data, and a Lobby whose data has no roster falling back to the room's content.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { getData } from '../server/data.js';
import { cardOperators, rosterOperators } from '../public/js/ui/seatArt.js';
import { CARD_ROSTER, parseCardRoster } from '../shared/cardRoster.js';
import { DEFAULT_VERSION, LOBBY_DEFAULT_VERSION } from '../shared/versions.js';

// settings outside a room are checked against the server's default version: these tests use 第二期下半's records
const CLASSIC = Object.freeze({ default: DEFAULT_VERSION });

const OPERATOR = 'char_498_inside';   // 隐现 (chess.json)
const OTHER = 'char_1012_skadi2';     // 浊心斯卡蒂 (chess.json)
const STAND_IN = 'char_600_cpione';   // a 补位 body (backups.units), no chess record
const DIY_ONLY = 'char_003_kalts';    // a 自选 operator (backups.diy.ownedPool), no chess record
const HIDDEN = 'char_616_pithst';     // a hidden preset (chess.json visible: false), not in the picker
const V21_ONLY = 'char_344_beewax';   // 蜜蜡: a card of 第二期上半 only (data/card-roster.json)
const REG_ONLY = 'char_4166_varkis';  // a card of 规程·序列Ⅰ only

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
const quietLog = () => ({ info() {}, warn() {}, debug() {}, error() {} });
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
async function createRoom(c, mode = 'coop') {
  await ok(c, { t: 'room.create', mode, difficulty: 'FUNNY' });
  return c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === mode);
}
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id);

describe('room.card (lobby, stub match)', () => {
  let srv;
  let pool;
  before(async () => {
    // a burst large enough for the test that walks the whole picker list
    srv = await startServer({ port: 0, host: '127.0.0.1', versions: CLASSIC, log: quietLog(), MatchClass: StubMatch, heavyBurst: 400, heavyPerSec: 4, rateBurst: 400 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('the wire check: a charId or "" passes; a chess id, a number, junk or a missing field is BAD_MSG', async () => {
    const c = await pool.player('Wire');
    await ok(c, { t: 'room.card', charId: OPERATOR });
    await ok(c, { t: 'room.card', charId: '' });
    for (const charId of ['chess_char_1_01_a', 7, null, 'char_498 inside', `char_1_${'x'.repeat(70)}`]) {
      await err(c, { t: 'room.card', charId }, ERR.BAD_MSG);
    }
    await err(c, { t: 'room.card' }, ERR.BAD_MSG);
  });

  test('a visible operator of chess.json or a 自选 operator of the pool is taken; a hidden preset, a stand-in body or an unknown id is refused, the stored card stays', async () => {
    const host = await pool.player('Host');
    await createRoom(host);
    await ok(host, { t: 'room.card', charId: OPERATOR });
    await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card === OPERATOR);
    // 自选编队 operator (#877): no chess record of its own, but a real operator of the room version's pool
    await ok(host, { t: 'room.card', charId: DIY_ONLY });
    await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card === DIY_ONLY);
    await ok(host, { t: 'room.card', charId: OPERATOR });
    await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card === OPERATOR);
    for (const charId of [HIDDEN, STAND_IN, 'char_999_nobody']) {
      const r = await err(host, { t: 'room.card', charId }, ERR.BAD_MSG);
      assert.match(JSON.stringify(r), /unknown operator/);
    }
    // a later room.state still carries the card the refused ones did not replace
    await ok(host, { t: 'room.addBot' });
    const st = await host.waitFor('room.state', (s) => s.seats.some((x) => x && x.isBot));
    assert.equal(seatOf(st, host.id).card, OPERATOR);
  });

  test('the server takes every operator the client picker lists (ui/seatArt.js cardOperators and rosterOperators), in a 第二期下半 room: 250', async () => {
    const list = cardOperators(Object.values(getData().chess), getData().backups).map((c) => c.charId);
    assert.ok(list.length > 100);
    assert.ok(list.includes(DIY_ONLY), 'the 自选 pool is offered (ui/seatArt.js cardOperators)');
    // the other periods' operators (DESIGN §37.325): the roster's rows the room's list lacks, as the picker lists them
    const others = rosterOperators(getData()[CARD_ROSTER], { exclude: new Set(list) }).map((c) => c.charId);
    assert.deepEqual(new Set(others), new Set([...parseCardRoster(getData()[CARD_ROSTER]).ids].filter((id) => !list.includes(id))));
    const all = [...list, ...others];
    assert.equal(new Set(all).size, 250);
    assert.ok(others.includes(V21_ONLY) && others.includes(REG_ONLY));
    const c = await pool.player('All');
    const st = await createRoom(c, 'solo');
    assert.equal(st.version ?? DEFAULT_VERSION, DEFAULT_VERSION);
    for (const charId of all) await ok(c, { t: 'room.card', charId });
  });

  test('a card of another period (第二期上半 蜜蜡, 规程 only) is taken in a 第二期下半 room; every member sees it', async () => {
    const host = await pool.player('Host');
    const guest = await pool.player('Guest');
    const st0 = await createRoom(host);
    await ok(guest, { t: 'room.join', code: st0.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    await ok(host, { t: 'room.card', charId: V21_ONLY });
    await guest.waitFor('room.state', (s) => seatOf(s, host.id)?.card === V21_ONLY);
    await ok(guest, { t: 'room.card', charId: REG_ONLY });
    const seen = await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.card === REG_ONLY);
    assert.equal(seatOf(seen, host.id).card, V21_ONLY);
  });

  test('a card of another period picked outside a room is taken and lands on the seat of the next room (humanSeat)', async () => {
    const c = await pool.player('Lobby');
    await ok(c, { t: 'room.card', charId: REG_ONLY });
    assert.equal(srv.registry.byId(c.id).card, REG_ONLY);
    const st = await createRoom(c);
    assert.equal(seatOf(st, c.id).card, REG_ONLY);
  });

  test('every member sees it as room.state seats[].card; "" clears it; bots and card-less seats carry no key', async () => {
    const host = await pool.player('Host');
    const guest = await pool.player('Guest');
    const st0 = await createRoom(host);
    assert.ok(!('card' in seatOf(st0, host.id)), 'a room without cards sends what it sent before');
    await ok(guest, { t: 'room.join', code: st0.code });
    await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    await ok(host, { t: 'room.card', charId: OPERATOR });
    const seen = await guest.waitFor('room.state', (s) => seatOf(s, host.id)?.card === OPERATOR);
    assert.ok(!('card' in seatOf(seen, guest.id)), 'the guest picked none');
    await ok(host, { t: 'room.addBot' });
    const withBot = await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.isBot));
    assert.ok(withBot.seats.filter((x) => x && x.isBot).every((b) => !('card' in b)));
    await ok(host, { t: 'room.card', charId: '' });
    const cleared = await guest.waitFor('room.state', (s) => !!seatOf(s, host.id) && !('card' in seatOf(s, host.id)));
    assert.equal(cleared.code, st0.code);
  });

  test('the card follows the player: picked outside a room it is on the seat of the next room', async () => {
    const c = await pool.player('Early');
    await ok(c, { t: 'room.card', charId: OTHER });
    const st = await createRoom(c);
    assert.equal(seatOf(st, c.id).card, OTHER);
    await ok(c, { t: 'room.leave' });
    const again = await createRoom(c, 'solo');
    assert.equal(seatOf(again, c.id).card, OTHER);
  });

  test('cosmetic, no phase gate: accepted while the match runs and shown in room.state', async () => {
    const host = await pool.player('Solo');
    await createRoom(host, 'solo');
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    await ok(host, { t: 'room.card', charId: OPERATOR });
    const st = await host.waitFor('room.state', (s) => seatOf(s, host.id)?.card === OPERATOR);
    assert.equal(st.inMatch, true);
  });
});

describe('room.card on a server with every version (default 规程·序列Ⅰ)', () => {
  let srv;
  let pool;
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', versions: { enabled: 'all', default: LOBBY_DEFAULT_VERSION }, log: quietLog(),
      MatchClass: StubMatch, assetIndex: false, studio: false });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('a card of another period loads no version\'s data: in the lobby (whose default is 规程) and in a 第二期下半 room', async () => {
    assert.equal(srv.versions.stats().loaded, 0);
    const c = await pool.player('Light');
    await ok(c, { t: 'room.card', charId: V21_ONLY });   // outside a room: the roster answers before the default version's data
    assert.equal(srv.versions.stats().loaded, 0, 'the lobby\'s card loaded no version');
    await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL', version: DEFAULT_VERSION });
    const st = await c.waitFor('room.state', (s) => s.hostId === c.id);
    assert.equal(seatOf(st, c.id).card, V21_ONLY, 'humanSeat took it from the roster');
    await ok(c, { t: 'room.card', charId: REG_ONLY });
    await c.waitFor('room.state', (s) => seatOf(s, c.id)?.card === REG_ONLY);
    assert.equal(srv.versions.stats().loaded, 0, 'the room\'s card loaded no version');
    assert.equal((await (await fetch(`${srv.url}/healthz`)).json()).versions.loaded, 0, '/healthz says so');
    // the refused ones still are
    for (const charId of [HIDDEN, STAND_IN, 'char_999_nobody']) await err(c, { t: 'room.card', charId }, ERR.BAD_MSG);
  });

  test('a 规程 room takes the cards of every other period too (a sample of five)', async () => {
    const c = await pool.player('Reg');
    await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL', version: LOBBY_DEFAULT_VERSION });
    const st = await c.waitFor('room.state', (s) => s.hostId === c.id);
    assert.equal(st.version, LOBBY_DEFAULT_VERSION);
    const roster = parseCardRoster(getData()[CARD_ROSTER]);
    const elsewhere = [...roster.byChar.values()].filter((r) => !r.periods.includes(LOBBY_DEFAULT_VERSION)).map((r) => r.charId);
    assert.ok(elsewhere.includes(V21_ONLY));
    const sample = [V21_ONLY, OPERATOR, ...elsewhere.filter((id) => id !== V21_ONLY && id !== OPERATOR).slice(0, 3)];
    assert.equal(sample.length, 5);
    for (const charId of sample) {
      await ok(c, { t: 'room.card', charId });
      await c.waitFor('room.state', (s) => seatOf(s, c.id)?.card === charId);
    }
  });
});

test('a Lobby whose data has no card roster falls back to the room\'s content: another period\'s operator is refused', () => {
  const { [CARD_ROSTER]: roster, ...rest } = getData();
  assert.ok(roster, 'the server\'s data has the roster');
  const data = Object.freeze(rest);
  const lobby = new Lobby({ registry: new SessionRegistry(), log: quietLog(), getData: () => data });
  const session = { playerId: 'p_card', name: 'C', connected: true, roomCode: null, ws: null };
  assert.equal(lobby.officialCardIds().size, 0);
  assert.equal(lobby.card(session, { charId: V21_ONLY }).error, ERR.BAD_MSG);
  assert.deepEqual(lobby.card(session, { charId: OPERATOR }), { ok: true });
  assert.deepEqual(lobby.card(session, { charId: DIY_ONLY }), { ok: true });
  assert.equal(session.card, DIY_ONLY);
  lobby.shutdown();
});
