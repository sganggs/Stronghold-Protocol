// test/dev-grant.test.js — the development-only grant channel (server/dev-grant.js; docs/DEV-GRANT.md).
//
// The channel exists because a room lives in this process's memory and the wire protocol has no grant message. Its
// safety rests on four things this file pins down:
//   * nothing is registered without SP_DEV_GRANT=1 (`parseDevGrant`; the wiring is server/index.js → http/routes.js);
//   * a non-loopback peer is refused even then — the endpoint must never be a public cheat door;
//   * grants go through PlayerState.acquireChess (the same door as buys and rewards), never by writing board state,
//     so the pool is taken and hand/temp overflow applies;
//   * a grant is refused while a battle is running (only PREP / SETTLE pass the phase gate), because a grant that
//     completes a merge would force the elite onto a tile the client is already simulating.
//
// The match is a stub: this file is about the channel's decisions, not about acquireChess itself (that is
// test/match/*.test.js). The stubs mirror the fields of 0.2.0's Match / PlayerState that the handler reads
// (roomCode / modeId / phase / round / matchNo / players / order / flush; playerId / seat / isBot / isHumanActive /
// connected / left / funds / acquireChess / addFunds / dirty).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevGrantHandler, parseDevGrant, DEV_GRANT_PATH } from '../server/dev-grant.js';
import { getData, getChess } from '../server/data.js';
import { PHASE } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = (p) => readFileSync(join(ROOT, p), 'utf8');
const D = getData({ log: { warn() {}, error() {}, info() {} } });

/** A response recorder standing in for http.ServerResponse. */
function res() {
  const r = { status: 0, headers: null, body: '', ended: false };
  r.writeHead = (status, headers) => { r.status = status; r.headers = headers; };
  r.end = (b) => { r.body = b ? b.toString('utf8') : ''; r.ended = true; };
  r.json = () => JSON.parse(r.body);
  return r;
}
const req = (remoteAddress = '127.0.0.1') => ({ socket: { remoteAddress }, method: 'GET' });

/** A stub player that records acquireChess calls, with an optional refusal at call n. */
function stubPlayer(playerId, { refuseAt = Infinity, funds = 0 } = {}) {
  const p = {
    playerId, seat: 0, isBot: false, isHumanActive: true, connected: true, left: false,
    funds, calls: [], dirtied: 0, fundCalls: [],
    acquireChess(id, opts) { p.calls.push({ id, opts }); return p.calls.length >= refuseAt ? null : { id }; },
    // mirrors PlayerState.addFunds (server/match/player/economy.js): clamps at 0, counts gains, dirties
    addFunds(n, { reason = '' } = {}) {
      p.fundCalls.push({ n, reason });
      if (!Number.isFinite(n) || n === 0) return 0;
      const v = Math.trunc(n);
      const before = p.funds;
      p.funds = Math.max(0, p.funds + v);
      p.dirtied++;
      return p.funds - before;
    },
    dirty() { p.dirtied++; },
  };
  return p;
}
/** A stub match holding one human; `phase` decides whether the gate lets a grant through. */
function stubMatch({ phase = PHASE.PREP, player = stubPlayer('p1'), roomCode = 'ABCD', round = 3 } = {}) {
  const m = {
    roomCode, modeId: 'mode_multi_normal', phase, round, matchNo: 1, ds: D, data: D,
    players: new Map([[player.playerId, player]]),
    order: [player], flushed: 0,
    flush() { m.flushed++; },
  };
  return m;
}
const lobbyOf = (...matches) => ({ rooms: new Map(matches.map((m, i) => [`R${i}`, { code: m.roomCode, match: m }])) });

describe('dev grant channel', () => {
  test('SP_DEV_GRANT: only an explicit yes registers the route', () => {
    for (const v of ['1', 'true', 'YES', 'on', 'always', ' 1 ']) assert.equal(parseDevGrant(v), true, v);
    for (const v of [undefined, '', '0', 'false', 'off', 'no', 'maybe']) assert.equal(parseDevGrant(v), false, String(v));
    assert.equal(DEV_GRANT_PATH, '/dev/grant');
    // the route is wired in the 0.2.0 request listener, and only when startServer() built a handler for it
    assert.match(doc('server/http/routes.js'), /if \(devGrant && parts\.rawPath === DEV_GRANT_PATH\)/);
    assert.match(doc('server/index.js'), /parseDevGrant\(process\.env\.SP_DEV_GRANT\) \? createDevGrantHandler/);
  });

  test('loopback only: a LAN or internet peer is refused before anything else', () => {
    const m = stubMatch();
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });
    for (const addr of ['192.168.1.9', '100.64.0.2', '240e:47f:9240:abd0::1', '::ffff:10.0.0.1']) {
      const r = res();
      h(req(addr), r, 'chess=chess_char_1_09_a');
      assert.equal(r.status, 403, addr);
      assert.match(r.json().error, /loopback only/);
    }
    assert.equal(m.order[0].calls.length, 0, 'nothing was granted');
    // and the loopback forms do get through
    for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const r = res();
      h(req(addr), r, '');
      assert.equal(r.status, 200, addr);
    }
  });

  test('discovery: no chess= lists the running matches and their players', () => {
    const m = stubMatch({ roomCode: 'WXYZ', phase: PHASE.COMBAT, round: 7 });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });
    const r = res();
    h(req(), r, '');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.match(j.usage, /^\/dev\/grant\?chess=/);
    assert.equal(j.matches.length, 1);
    assert.equal(j.matches[0].roomCode, 'WXYZ');
    assert.equal(j.matches[0].phase, PHASE.COMBAT);
    assert.deepEqual(j.matches[0].players, [{ playerId: 'p1', seat: 0, isBot: false, connected: true, left: false }]);
  });

  test('a grant lands through acquireChess, with pool/door options and an immediate flush', () => {
    const player = stubPlayer('p1');
    const m = stubMatch({ player, roomCode: 'ABCD' });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });
    const r = res();
    h(req(), r, 'chess=chess_char_1_09_a,chess_char_5_02_a&count=2');
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.ok, true);
    assert.equal(j.playerId, 'p1');
    assert.equal(j.round, 3);
    assert.deepEqual(j.granted, [
      { id: 'chess_char_1_09_a', count: 2, name: '跃跃' },
      { id: 'chess_char_5_02_a', count: 2, name: '缇缇' },
    ]);
    assert.deepEqual(j.failed, []);
    // the same door as a buy: fromPool default true, source marked dev, toTemp off
    assert.deepEqual(player.calls.map((c) => c.id), ['chess_char_1_09_a', 'chess_char_1_09_a', 'chess_char_5_02_a', 'chess_char_5_02_a']);
    for (const c of player.calls) assert.deepEqual(c.opts, { source: 'dev', toTemp: false, fromPool: true });
    assert.equal(player.dirtied, 1, 'the client is told');
    assert.equal(m.flushed, 1, 'combat otherwise flushes only once a second');
  });

  test('the phase gate refuses during a battle and names the phase', () => {
    for (const phase of [PHASE.COMBAT, PHASE.UNITE, PHASE.RESULT, PHASE.SP_DRAFT]) {
      const player = stubPlayer('p1');
      const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(stubMatch({ player, phase })) });
      const r = res();
      h(req(), r, 'chess=chess_char_1_09_a');
      assert.equal(r.status, 409, phase);
      assert.equal(r.json().phase, phase);
      assert.equal(player.calls.length, 0, `${phase}: nothing granted`);
    }
    for (const phase of [PHASE.PREP, PHASE.SETTLE]) {
      const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(stubMatch({ phase })) });
      const r = res();
      h(req(), r, 'chess=chess_char_1_09_a');
      assert.equal(r.status, 200, phase);
    }
  });

  test('unknown ids, a full hand and a missing match are reported instead of throwing', () => {
    const player = stubPlayer('p1', { refuseAt: 2 }); // the second copy is refused
    const m = stubMatch({ player });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });

    const r1 = res();
    h(req(), r1, 'chess=not_a_chess');
    assert.equal(r1.status, 409);
    assert.deepEqual(r1.json().failed, [{ id: 'not_a_chess', error: 'unknown chess id' }]);

    const r2 = res();
    h(req(), r2, 'chess=chess_char_1_09_a&count=3');
    assert.deepEqual(r2.json().granted, [{ id: 'chess_char_1_09_a', count: 1, name: '跃跃' }]);
    assert.equal(r2.json().failed[0].error, 'stopped after 1');

    const empty = createDevGrantHandler({ log: {}, lobby: { rooms: new Map() } });
    const r3 = res();
    empty(req(), r3, 'chess=chess_char_1_09_a');
    assert.equal(r3.status, 404);
    assert.match(r3.json().detail, /先开一局/);

    // several rooms without room= is ambiguous, with room= it resolves
    const a = stubMatch({ roomCode: 'AAAA' }), b = stubMatch({ roomCode: 'BBBB' });
    const two = createDevGrantHandler({ log: {}, lobby: lobbyOf(a, b) });
    const r4 = res();
    two(req(), r4, 'chess=chess_char_1_09_a');
    assert.equal(r4.status, 404);
    assert.match(r4.json().detail, /ambiguous|room=|带上 room/);
    const r5 = res();
    two(req(), r5, 'chess=chess_char_1_09_a&room=bbbb');
    assert.equal(r5.status, 200, 'room codes are case-insensitive');
    assert.equal(r5.json().roomCode, 'BBBB');
  });

  test('a player id that is not in the match, and several humans without player=', () => {
    const p1 = stubPlayer('p1'), p2 = stubPlayer('p2');
    const m = stubMatch({ player: p1 });
    m.players.set('p2', p2); m.order.push(p2);
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });

    const r1 = res();
    h(req(), r1, 'chess=chess_char_1_09_a');
    assert.equal(r1.status, 404);
    assert.match(r1.json().detail, /p1, p2/);

    const r2 = res();
    h(req(), r2, 'chess=chess_char_1_09_a&player=p2');
    assert.equal(r2.status, 200);
    assert.equal(r2.json().playerId, 'p2');
    assert.equal(p2.calls.length, 1, 'the named player got it');
    assert.equal(p1.calls.length, 0, 'and nobody else did');
  });

  test('funds: funds=N sets the exact amount, fundsAdd=N adds, and it goes through addFunds', () => {
    const player = stubPlayer('p1', { funds: 7 });
    const m = stubMatch({ player });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(m) });

    // exact set, on its own (no chess= — must not fall into discovery mode)
    const r1 = res();
    h(req(), r1, 'funds=99');
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.json().funds, { before: 7, after: 99, delta: 92 });
    assert.equal(player.funds, 99);
    assert.deepEqual(player.fundCalls, [{ n: 92, reason: 'dev' }], 'the delta is what is handed to addFunds');
    assert.equal(r1.json().granted.length, 0, 'no chess was touched');
    assert.equal(player.calls.length, 0);

    // relative add — its own parameter, because `+` in a query decodes to a space
    const r2 = res();
    h(req(), r2, 'fundsAdd=50');
    assert.deepEqual(r2.json().funds, { before: 99, after: 149, delta: 50 });

    // setting a lower amount spends down to it
    const r3 = res();
    h(req(), r3, 'funds=10');
    assert.deepEqual(r3.json().funds, { before: 149, after: 10, delta: -139 });

    // `funds=+50` must NOT silently mean "set to 50": the `+` is a space in a query, so it is rejected outright and
    // nothing is written (the earlier shape of this code mutated state here)
    const rPlus = res();
    h(req(), rPlus, 'funds=+50');
    assert.equal(rPlus.status, 409);
    assert.deepEqual(rPlus.json().failed, [{ id: 'funds= 50', error: 'sign or space not allowed (use fundsAdd=N to add)' }]);
    assert.equal(rPlus.json().funds ?? null, null);
    assert.equal(player.funds, 10, 'unchanged by the malformed value');

    // a bad value is reported, not thrown; and it is the only failure
    const r4 = res();
    h(req(), r4, 'funds=abc');
    assert.equal(r4.status, 409);
    assert.deepEqual(r4.json().failed, [{ id: 'funds=abc', error: 'not a whole number' }]);
    assert.equal(r4.json().funds ?? null, null);
    assert.equal(player.funds, 10, 'unchanged');

    // `funds=` takes no sign either — spending down has its own spelling
    const rMinus = res();
    h(req(), rMinus, 'funds=-5');
    assert.equal(rMinus.status, 409);
    assert.deepEqual(rMinus.json().failed, [{ id: 'funds=-5', error: 'funds= takes no sign (use fundsAdd=-N to spend down)' }]);
    assert.equal(player.funds, 10);

    // a negative add is a valid way to spend down
    const rNeg = res();
    h(req(), rNeg, 'fundsAdd=-4');
    assert.deepEqual(rNeg.json().funds, { before: 10, after: 6, delta: -4 });

    // funds and chess in one call
    const r5 = res();
    h(req(), r5, 'funds=99&chess=chess_char_1_09_a');
    assert.equal(r5.status, 200);
    assert.deepEqual(r5.json().funds, { before: 6, after: 99, delta: 93 });
    assert.equal(r5.json().granted[0].name, '跃跃');
    assert.equal(player.funds, 99);
  });

  test('funds does not bypass the phase gate', () => {
    const player = stubPlayer('p1', { funds: 5 });
    const h = createDevGrantHandler({ log: {}, lobby: lobbyOf(stubMatch({ player, phase: PHASE.COMBAT })) });
    const r = res();
    h(req(), r, 'funds=99');
    assert.equal(r.status, 409);
    assert.equal(player.funds, 5, 'nothing changed during a battle');
  });

  test('the two operators the owner asked for resolve to the expected records', () => {
    // guards the ids quoted to the owner: a rename upstream should fail here, not silently grant the wrong chess
    const yue = getChess('chess_char_1_09_a', D), titi = getChess('chess_char_5_02_a', D);
    assert.equal(yue.name, '跃跃');
    assert.equal(yue.tier, 1);
    assert.equal(yue.visible, true);
    assert.equal(titi.name, '缇缇');
    assert.equal(titi.tier, 5);
    assert.equal(titi.visible, true);
    assert.deepEqual(titi.garrisonIds, ['garrison_125_a'], '缇缇 carries the trait §23.40 changed');
    assert.equal(getChess('nope', D), null, 'an unknown id resolves to null, not a throw');
  });
});
