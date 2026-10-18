// A content plugin's 自选 operator must survive into the match. The lobby checks the pick against the content
// set's list; the match used to re-check against the vanilla kit list and drop the pick with no error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { wireOptions } from '../../server/match/host/proxy.js';
import { decodeTestTrace, replayTestMatch } from '../../server/match/testReplay.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { fixture, guard } from '../helpers/contentFixtures.js';
import { DATA, makeMatch, legalTileFor } from './harness.js';

const T6A = 'chess_char_6_diy1_a';
const CHAR = 'char_x_data_demo_guard';
const PICK = { charId: CHAR, skillIndex: 0, uniEquipId: null };

function content(t) {
  const f = fixture(t);
  f.put('data-demo', { operators: ['op.json'] }, { 'op.json': guard() });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  assert.deepEqual(set.problems, []);
  assert.ok(set.kitted.includes(CHAR));
  return set;
}

const seats = () => [
  { seat: 0, playerId: 'p_0', name: 'P', isBot: false, connected: true, diy: { [T6A]: { ...PICK } } },
  { seat: 1, playerId: 'ai_0', name: 'AI', isBot: true, connected: true, diy: { [T6A]: { ...PICK } } },
];

test('a content plugin 自选 operator survives into the match, can be granted and fielded; without the list it is dropped', (t) => {
  const set = content(t);
  const dropped = makeMatch({ mode: 'coop', test: true, seed: 3, data: set.data, seats: seats(), fake: true, botRehearsal: 0 });
  assert.equal(dropped.m.diyKitted, undefined, 'a match that omits kitted stays on the vanilla list');
  assert.deepEqual(dropped.ps('p_0').diy, {}, 'the plugin operator is not on the vanilla list, so the lenient check drops it');
  assert.deepEqual(dropped.ps('ai_0').diy, {});
  dropped.start();
  dropped.toPrep(1);
  assert.equal(dropped.m.handle('p_0', { t: 'g.test', cmd: 'chess', args: { id: T6A } }).error, 'BAD_TARGET');
  dropped.m.dispose();

  const h = makeMatch({ mode: 'coop', test: true, seed: 3, data: set.data, kitted: set.kitted, seats: seats(), fake: true, botRehearsal: 0 });
  const ps = h.ps('p_0');
  assert.equal(ps.diy[T6A].charId, CHAR);
  assert.deepEqual(h.ps('ai_0').diy, {}, 'a bot seat still fields no 自选 piece');
  assert.equal(ps.gd.chess(T6A).charId, CHAR, 'the human\'s data view is what a bot reads');
  assert.equal(ps.gd.chess(T6A).diyFor, T6A);
  assert.equal(h.m.publicView().diyKitted, undefined);
  h.start();
  const before = h.sent.length;
  h.m.onReconnect('p_0');
  const resent = h.sent.slice(before).map(([, msg]) => msg).find((msg) => msg.t === 'm.private');
  assert.equal(resent?.diy?.[T6A]?.charId, CHAR, 'reconnect resends the pick');
  h.toPrep(1);
  assert.equal(h.m.handle('p_0', { t: 'g.test', cmd: 'chess', args: { id: T6A } }).ok, true);
  const piece = ps.hand.find((p) => p && p.id === T6A);
  assert.ok(piece, 'the granted 自选 piece is in the hand');
  const tile = legalTileFor(h.m, ps, T6A);
  assert.ok(tile, 'a legal tile for the operator');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
  assert.equal(ps.board.get(`${tile[0]},${tile[1]}`)?.id, T6A);
  h.m.dispose();

  const vanilla = makeMatch({ mode: 'solo', test: true, seed: 1, data: DATA, seats: [{ seat: 0, playerId: 'p_0', name: 'P', isBot: false, connected: true }] });
  assert.equal(vanilla.m.diyKitted, undefined);
  vanilla.m.dispose();
});

test('the worker payload and the test journal carry kitted only when the match was given one', (t) => {
  const set = content(t);
  assert.deepEqual(wireOptions({ roomCode: 'ABCD', mode: 'solo', kitted: undefined }), { roomCode: 'ABCD', mode: 'solo' });
  assert.deepEqual(wireOptions({ roomCode: 'ABCD', mode: 'solo', kitted: set.kitted }).kitted.includes(CHAR), true);

  const entries = [];
  const log = { info(line) { if (String(line).startsWith('[test-input ')) entries.push(JSON.parse(String(line).slice(String(line).indexOf(']') + 2))); }, warn() {}, error() {}, debug() {} };
  const bare = new Match({
    mode: 'solo', difficulty: 'NORMAL', test: true, seed: 1, data: set.data,
    seats: [{ seat: 0, playerId: 'p', name: 'P', isBot: false, connected: true }],
    scheduler: new VirtualScheduler(), send() {}, broadcast() {}, onEnd() {}, log, journal: true,
  });
  assert.equal(decodeTestTrace(entries)[0].options.kitted, undefined, 'a vanilla journal grows no kitted key');
  bare.dispose();

  entries.length = 0;
  const m = new Match({
    mode: 'solo', difficulty: 'NORMAL', test: true, seed: 4, data: set.data, kitted: set.kitted,
    seats: [{ seat: 0, playerId: 'p', name: 'P', isBot: false, connected: true, diy: { [T6A]: { ...PICK } } }],
    scheduler: new VirtualScheduler(), send() {}, broadcast() {}, onEnd() {}, log,
  });
  assert.equal(m.players.get('p').diy[T6A].charId, CHAR);
  assert.ok(decodeTestTrace(entries)[0].options.kitted.includes(CHAR));
  const copy = replayTestMatch(set.data, entries.filter((e) => e.kind === 'init' || e.kind === 'chunk'));
  assert.equal(copy.players.get('p').diy[T6A].charId, CHAR, 'a replay keeps the content list');
  copy.dispose();
  m.dispose();
});

test('lobby start passes the room content list on the local match and on the match host; a vanilla room omits it', (t) => {
  const set = content(t);
  const plugins = { dataOf: () => set.data, kittedOf: (cs) => (cs === set.cs ? set.kitted : null) };
  const seen = [];
  class Rec {
    constructor(opts) { this.opts = opts; seen.push(opts); }
    start() {}
    dispose() {}
  }
  const host = { playerId: 'p_host', name: 'H', connected: true, roomCode: null, ws: null };
  const lobby = new Lobby({ registry: new SessionRegistry(), MatchClass: Rec, plugins, getData: () => set.data, log: { info() {}, warn() {}, error() {}, debug() {} } });
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby.addBot(host).ok, true);
  const room = lobby.roomOf(host);
  room.content = { cs: set.cs, vanilla: false, plugins: [{ id: 'data-demo', version: '1.0.0', hash: 'ab'.repeat(8) }] };
  const seat = room.seatOf(host.playerId);
  seat.content = 'ready';
  seat.diy = Object.freeze({ [T6A]: Object.freeze({ ...PICK }) });
  seat.diyCs = set.cs;
  const bot = room.seats.find((s) => s && s.isBot);
  bot.diy = { [T6A]: { ...PICK } };
  assert.equal(lobby.start(host).ok, true);
  assert.ok(seen[0].kitted.includes(CHAR), 'the in-process match receives the content list');
  assert.equal(seen[0].seats.find((s) => !s.isBot).diy[T6A].charId, CHAR);
  assert.equal(seen[0].seats.find((s) => s.isBot).diy, null, 'bots still field no 自选');
  assert.deepEqual(wireOptions(seen[0]).kitted.includes(CHAR), true);

  const hosted = [];
  const lobby2 = new Lobby({
    registry: new SessionRegistry(), MatchClass: Rec, plugins, getData: () => set.data,
    hosts: { create(_cs, opts) { hosted.push(opts); return { hosted: true, start() {} }; } },
    log: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const host2 = { playerId: 'p_host2', name: 'H2', connected: true, roomCode: null, ws: null };
  assert.equal(lobby2.create(host2, { mode: 'solo', difficulty: 'NORMAL' }).ok, true);
  const room2 = lobby2.roomOf(host2);
  room2.content = { cs: set.cs, vanilla: false, plugins: [] };
  room2.seatOf(host2.playerId).content = 'ready';
  assert.equal(lobby2.start(host2).ok, true);
  assert.ok(hosted[0].kitted.includes(CHAR), 'the match host receives the same list');

  const vanilla = [];
  class Rec2 {
    constructor(opts) { vanilla.push(opts); }
    start() {}
  }
  const lobby3 = new Lobby({ registry: new SessionRegistry(), MatchClass: Rec2, getData: () => DATA, log: { info() {}, warn() {}, error() {}, debug() {} } });
  const host3 = { playerId: 'p_host3', name: 'H3', connected: true, roomCode: null, ws: null };
  assert.equal(lobby3.create(host3, { mode: 'solo', difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby3.start(host3).ok, true);
  assert.equal(Object.hasOwn(vanilla[0], 'kitted'), false, 'a vanilla room does not grow a kitted key');
});
