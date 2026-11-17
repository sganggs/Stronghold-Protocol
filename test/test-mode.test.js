// Gate, protocol shape, lobby marking and stats exclusion for match test mode (DESIGN §34.8).
// No listeners: Lobby and MatchProxy are in-process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestModeEnv, testModeGate, interfacesArePrivate, TEST_MODE_PUBLIC_HINT, TEST_MODE_FORCE_HINT } from '../server/testMode.js';
import { parseTestArgs } from '../shared/testMode.js';
import { validateC2S } from '../shared/protocol.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { wireOptions, MatchProxy } from '../server/match/host/proxy.js';
import {
  aggregateStats, buildQuitRecord, buildRecord, compactRecord, countsTowardStats, createLiveMatch,
  normalizeRecord, appendRecord, highestBondRecord, recordId, recordToResult, strategyBadgeIds,
} from '../public/js/ui/stats.js';

test('parseTestModeEnv: local words, force, everything else off', () => {
  for (const w of ['1', 'true', 'TRUE', 'yes', 'on', 'local']) assert.equal(parseTestModeEnv(w), 'local');
  assert.equal(parseTestModeEnv('force'), 'force');
  assert.equal(parseTestModeEnv('FORCE'), 'force');
  for (const w of [undefined, '', '0', 'off', 'false', 'no', 'nope', 'trusted-force']) assert.equal(parseTestModeEnv(w), 'off');
});

const PUBLIC_NICS = { eth0: [{ address: '8.8.8.8', family: 'IPv4', internal: false }] };
const PRIVATE_NICS = {
  eth0: [
    { address: '10.1.2.3', family: 'IPv4', internal: false },
    { address: '192.168.1.5', family: 'IPv4', internal: false },
    { address: '172.16.4.4', family: 'IPv4', internal: false },
    { address: '100.64.1.1', family: 'IPv4', internal: false },
    { address: '169.254.1.1', family: 'IPv4', internal: false },
    { address: 'fd12::1', family: 'IPv6', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
  ],
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
};

test('testModeGate: local accepts 1, public needs force, unknown host fails closed', () => {
  assert.deepEqual(testModeGate('off', '127.0.0.1'), { enabled: false, warn: null });
  assert.deepEqual(testModeGate('local', '127.0.0.1'), { enabled: true, warn: null });
  assert.deepEqual(testModeGate('local', '192.168.1.5').enabled, true);
  const pub = testModeGate('local', '0.0.0.0', PUBLIC_NICS);
  assert.equal(pub.enabled, false);
  assert.equal(pub.warn, TEST_MODE_PUBLIC_HINT);
  assert.match(pub.warn, /127\.0\.0\.1/);
  assert.match(pub.warn, /局域网/);
  assert.match(pub.warn, /--test-mode force/);
  assert.match(pub.warn, /SP_TEST_MODE=force/);
  assert.equal(testModeGate('local', '8.8.8.8').enabled, false);
  assert.equal(testModeGate('local', '8.8.8.8').warn, TEST_MODE_PUBLIC_HINT);
  assert.equal(testModeGate('local', '::', PUBLIC_NICS).enabled, false);
  const forced = testModeGate('force', '8.8.8.8');
  assert.equal(forced.enabled, true);
  assert.equal(forced.warn, TEST_MODE_FORCE_HINT);
  assert.equal(testModeGate('force', '::', PUBLIC_NICS).enabled, true);
  assert.equal(testModeGate('force', '::', PUBLIC_NICS).warn, TEST_MODE_FORCE_HINT);
  assert.deepEqual(testModeGate('force', '127.0.0.1'), { enabled: true, warn: null });
  assert.deepEqual(testModeGate('force', ''), { enabled: false, warn: null });
  assert.deepEqual(testModeGate('local', ''), { enabled: false, warn: null });
  assert.deepEqual(testModeGate('nope', '127.0.0.1'), { enabled: false, warn: null });
});

test('a wildcard bind follows the machine interfaces', () => {
  assert.equal(interfacesArePrivate(PRIVATE_NICS), true);
  assert.deepEqual(testModeGate('local', '::', PRIVATE_NICS), { enabled: true, warn: null });
  assert.equal(testModeGate('local', '0.0.0.0', PRIVATE_NICS).enabled, true);
  assert.deepEqual(testModeGate('force', '::', PRIVATE_NICS), { enabled: true, warn: null });
  const v4 = { eth0: [{ address: '8.8.8.8', family: 'IPv4', internal: false }] };
  assert.equal(testModeGate('local', '::', v4).enabled, false);
  assert.equal(testModeGate('local', '0.0.0.0', v4).warn, TEST_MODE_PUBLIC_HINT);
  const v6 = { eth0: [{ address: '2001:4860:4860::8888', family: 'IPv6', internal: false }] };
  assert.equal(testModeGate('local', '::', v6).enabled, false);
  assert.equal(testModeGate('force', '::', v6).warn, TEST_MODE_FORCE_HINT);
  assert.equal(testModeGate('local', '::', {}).enabled, true);
  assert.equal(testModeGate('local', '::', { lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }).enabled, true);
  assert.equal(interfacesArePrivate(null), false);
  assert.equal(testModeGate('local', '::', null).enabled, false);
  assert.equal(testModeGate('local', '1.1.1.1', PRIVATE_NICS).enabled, false);
});

test('parseTestArgs refuses the wrong type, unknown keys and out-of-range values', () => {
  assert.equal(parseTestArgs('nope', {}).error, 'BAD_MSG');
  assert.equal(parseTestArgs('funds', { amount: 1.5 }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', { amount: '10' }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', { amount: -1 }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', { amount: 100000 }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', {}).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('funds', { amount: 1, extra: true }).error, 'BAD_MSG');
  assert.equal(parseTestArgs('funds', null).error, 'BAD_MSG');
  assert.deepEqual(parseTestArgs('level', undefined), { args: {} });
  assert.equal(parseTestArgs('shop', { slots: [{ kind: 'chess', id: 'a', extra: 1 }] }).error, 'BAD_MSG');
  assert.equal(parseTestArgs('shop', { slots: [{ kind: 'nope', id: 'a' }] }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('shop', { slots: [] }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('phase', { name: 'lobby' }).error, 'BAD_TARGET');
  assert.deepEqual(parseTestArgs('funds', { amount: 0 }), { args: { amount: 0 } });
});

test('validateC2S accepts only a literal test:true and a known g.test command', () => {
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', test: true }), null);
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', test: false }), 'bad field test');
  assert.equal(validateC2S({ t: 'g.test', cmd: 'funds' }), null);
  assert.equal(validateC2S({ t: 'g.test', cmd: 'funds', args: { amount: 1 } }), null);
  assert.match(validateC2S({ t: 'g.test', cmd: 'nope' }), /bad field cmd/);
  assert.match(validateC2S({ t: 'g.nope' }), /unknown type/);
});

function openLobby(t, extra = {}) {
  const registry = new SessionRegistry();
  const lobby = new Lobby({
    registry,
    content: { cs: 'ab'.repeat(32) },
    log: { info() {}, warn() {}, error() {}, debug() {} },
    ...extra,
    options: { testMode: extra.testMode ?? 'off', testHost: extra.testHost },
  });
  t.after(() => lobby.shutdown());
  const player = (name) => {
    const s = registry.create(name);
    s.connected = true;
    s.messages = [];
    s.ws = { readyState: 1, bufferedAmount: 0, send: (txt) => s.messages.push(JSON.parse(txt)) };
    return s;
  };
  return { lobby, player };
}

test('a server with the gate off rejects a test room and omits the welcome flag', (t) => {
  const { lobby, player } = openLobby(t);
  assert.equal(lobby.testEnabled, false);
  assert.equal(lobby.welcomeInfo().testMode, undefined);
  const host = player('host');
  const res = lobby.create(host, { mode: 'solo', difficulty: 'NORMAL', test: true });
  assert.equal(res.error, 'TEST_DISABLED');
  assert.equal(lobby.rooms.size, 0);
  assert.equal(lobby.create(host, { mode: 'solo', difficulty: 'NORMAL', test: false }).ok, true);
  const room = lobby.roomOf(host);
  assert.equal(room.test, false);
  assert.equal(room.toState().test, undefined);
  assert.equal(typeof lobby.setTest, 'undefined');
});

test('an enabled local gate marks the room, the welcome and a co-op guest', (t) => {
  const { lobby, player } = openLobby(t, { testMode: '1', testHost: '127.0.0.1' });
  assert.equal(lobby.testEnabled, true);
  assert.equal(lobby.welcomeInfo().testMode, true);
  assert.equal(lobby.testWarn, null);
  const host = player('host');
  const guest = player('guest');
  assert.equal(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', test: true }).ok, true);
  const room = lobby.roomOf(host);
  assert.equal(room.test, true);
  assert.equal(room.toState().test, true);
  assert.equal(lobby.join(guest, { code: host.roomCode, testAck: true }).ok, true);
  const seen = guest.messages.filter((m) => m.t === 'room.state');
  assert.ok(seen.length > 0);
  assert.equal(seen.at(-1).test, true);
  const plain = player('other');
  assert.equal(lobby.create(plain, { mode: 'solo', difficulty: 'NORMAL' }).ok, true);
  assert.equal(lobby.roomOf(plain).test, false);
  assert.equal(lobby.roomOf(plain).toState().test, undefined);
});

test('startMatch forwards test only for a room created with the flag', (t) => {
  const seen = [];
  class Rec {
    constructor(opts) { seen.push(opts); this.opts = opts; }
    start() {}
    dispose() {}
  }
  const { lobby, player } = openLobby(t, { testMode: '1', testHost: '127.0.0.1', MatchClass: Rec });
  const host = player('host');
  lobby.create(host, { mode: 'solo', difficulty: 'NORMAL' });
  assert.equal(lobby.startMatch(lobby.roomOf(host)).ok, true);
  assert.equal(seen[0].test, undefined);
  assert.equal(typeof seen[0].hostId, 'string');
  const host2 = player('host2');
  lobby.create(host2, { mode: 'solo', difficulty: 'NORMAL', test: true });
  assert.equal(lobby.startMatch(lobby.roomOf(host2)).ok, true);
  assert.equal(seen[1].test, true);
  assert.equal(seen[1].hostId, host2.playerId);
});

test('wireOptions and setHost stay silent unless the match was created as a test', () => {
  assert.deepEqual(wireOptions({ roomCode: 'ABCD', mode: 'solo', hostId: 'p', test: false }), { roomCode: 'ABCD', mode: 'solo' });
  assert.deepEqual(
    wireOptions({ roomCode: 'ABCD', mode: 'solo', hostId: 'p', test: true }),
    { roomCode: 'ABCD', mode: 'solo', test: true, hostId: 'p' },
  );
  const posts = [];
  const normal = new MatchProxy({ host: { post: (m) => posts.push(m) }, matchId: 'n', opts: { roomCode: 'ABCD', test: false, hostId: 'p' } });
  normal.setHost('q');
  assert.deepEqual(posts, []);
  assert.equal(normal.opts.hostId, 'p');
  const testMatch = new MatchProxy({ host: { post: (m) => posts.push(m) }, matchId: 't', opts: { roomCode: 'ABCD', test: true, hostId: 'p' } });
  testMatch.setHost('q');
  assert.equal(testMatch.opts.hostId, 'q');
  assert.equal(posts.at(-1).method, 'setHost');
  assert.deepEqual(posts.at(-1).args, ['q']);
});

function baseResult(over = {}) {
  return {
    t: 'm.result',
    victory: true, roundsPassed: 15, hiddenReached: true, hiddenCleared: true, reason: 'hidden_cleared',
    teamLp: 24, modeId: 'mode_single_hard', difficulty: 'HARD', stageId: 'stage_hard', bossId: 'enemy_boss', hiddenBossId: 'enemy_hidden',
    seed: 123456789, durationMs: 952123,
    players: [
      {
        playerId: 'p1', seat: 0, name: '罗宾', isBot: false, left: false, alive: true, victory: true,
        roundsPassed: 16, eliminatedRound: null, lp: 24, bandId: 'band_amiya',
        title: { id: 'comment_1', name: '卫戍之星', picId: 'comment_icon_1', text: '对敌方领袖造成伤害最高（仅胜利时）' },
        trophies: 30, reward: 88,
        lineup: [{ id: 'char_290_vigna', golden: false, tier: 2, row: 10, col: 5, items: ['item_eq_1'] }],
        bonds: [{ bondId: 'steadShip', count: 3, tier: 1, layers: 12, active: true }],
        stats: { dmgDealt: 100, kills: 41, leaks: 2, gold: 80, refreshes: 1, merges: 1, itemsEquipped: 1, bossDamage: 10, activatedLayers: 3, lpLost: 1, perfectRounds: 1 },
      },
      {
        playerId: 'p2', seat: 1, name: '队友B', isBot: false, left: false, alive: false, victory: false,
        roundsPassed: 9, eliminatedRound: 10, lp: 0, bandId: 'band_fang', title: null, trophies: 0, reward: 40,
        lineup: [], bonds: [], stats: { kills: 3 },
      },
    ],
    ...over,
  };
}

test('test results never persist and legacy test records stay excluded from every tally', () => {
  const content = { cs: 'ab'.repeat(32), vanilla: false, plugins: [{ id: 'x', version: '1' }] };
  const real = buildRecord(baseResult(), { myId: 'p1', now: 1 });
  const modded = buildRecord(baseResult({ seed: 8 }), { myId: 'p1', now: 8, content });
  assert.equal(buildRecord(baseResult({ test: true }), { myId: 'p1' }), null);
  const testRec = normalizeRecord({ ...modded, id: 'test', test: true, testActions: 4 });
  assert.equal(appendRecord({ records: [] }, testRec).added, false);
  assert.equal(real.test, undefined);
  assert.equal(testRec.test, true);
  assert.equal(testRec.testActions, 4);
  assert.equal(countsTowardStats(real), true);
  assert.equal(countsTowardStats(testRec), false);
  assert.notEqual(recordId(baseResult(), 'p1'), recordId(baseResult({ test: true }), 'p1'));
  assert.equal(normalizeRecord({ ...testRec, test: 'yes' }).test, undefined);
  const agg = aggregateStats([real, modded, testRec]);
  assert.equal(agg.total, 3);
  assert.equal(agg.test, 1);
  assert.equal(agg.modded, 1);
  assert.equal(agg.count, 1);
  const withModded = aggregateStats([real, modded, testRec], { modded: true });
  assert.equal(withModded.count, 2);
  assert.equal(withModded.test, 1);
  assert.equal(aggregateStats([real]).test, 0);
  const bands = { a: { bandId: 'band_amiya', victorCount: 1, sortId: 1 } };
  assert.deepEqual(strategyBadgeIds([testRec], bands), []);
  assert.deepEqual(strategyBadgeIds([real], bands), ['band_amiya']);
  const taller = normalizeRecord({ ...testRec, id: 'taller' });
  assert.equal(highestBondRecord([taller, real]).record.id, real.id);
  assert.equal(highestBondRecord([taller]), null);
  const replay = recordToResult(testRec);
  assert.equal(replay.test, true);
  assert.equal(replay.testActions, 4);
  assert.equal(compactRecord(testRec).test, true);
  assert.equal(compactRecord(real).test, undefined);
  const live = createLiveMatch();
  live.active = true;
  live.startedAt = 10;
  const state = {
    me: { playerId: 'p1' },
    room: { code: 'ABCD', mode: 'solo' },
    match: {
      result: null,
      public: {
        phase: 'PREP', round: 2, modeId: 'mode_single_hard', difficulty: 'NORMAL', lastRound: 15,
        test: true, testActions: 2,
        players: [{ playerId: 'p1', seat: 0, name: 'A', alive: true, lp: 10, bandId: 'band_amiya' }],
      },
    },
  };
  const quit = buildQuitRecord(state, { live, now: 50 });
  assert.equal(quit, null);
  const plain = buildQuitRecord({ ...state, match: { ...state.match, public: { ...state.match.public, test: false, testActions: 2 } } }, { live, now: 50 });
  assert.equal(plain.test, undefined);
  assert.ok(plain);
});

import { makeMatch, DATA } from './match/harness.js';
import { buildResult } from '../server/match/results.js';
import { replayTestMatch } from '../server/match/testReplay.js';
import { Match } from '../server/match/Match.js';
import { RealScheduler, VirtualScheduler } from '../server/match/scheduler.js';
import { collectViolations } from '../server/match/invariants.js';
import { TEST_JOURNAL_CAP } from '../server/match/testTrace.js';
import { FakeBattle } from './match/fakeBattle.js';
import { TEST_COMMANDS, TEST_RATE_COUNT, guardTestMessage } from '../shared/testMode.js';
import { readFileSync } from 'node:fs';
import { matchClock, newestFirst, explainTestDetail, formatAuditLine, testRefusalText } from '../public/js/ui/testAudit.js';
import { DOCK_REM, clampDock, dockHome, dockMetricsFromStyle, dockObstacles, readDockPos, rectAreaOverlap, remOf, writeDockPos } from '../public/js/ui/testDock.js';

function fixture(t, opts = {}) {
  const h = makeMatch({ mode: 'solo', test: true, ...opts });
  t.after(() => h.m.dispose());
  h.start(); h.toPrep();
  h.p = h.ps('p_0');
  h.cmd = (cmd, args = {}, who = 'p_0') => h.m.handle(who, { t: 'g.test', cmd, args });
  return h;
}
const ok = (r) => assert.deepEqual(r, { ok: true });
const error = (r, code) => assert.equal(r.error, code);

test('all commands reject a normal match; forged flags and unknown identities cannot enter the test path', (t) => {
  const h = fixture(t, { test: false });
  for (const cmd of TEST_COMMANDS) error(h.m.handle('p_0', { t: 'g.test', cmd, test: true, args: {} }), 'TEST_FORBIDDEN');
  error(h.cmd('funds', { amount: 99 }, 'other'), 'NOT_IN_ROOM');
  assert.equal(h.m.publicView().test, undefined);
  assert.equal(h.m.testLog, undefined);
  assert.equal(buildResult(h.m, { victory: false }).test, undefined);
});

test('funds, chess, item and token grants use the host seat and actual acquisition primitives', (t) => {
  const h = fixture(t);
  ok(h.cmd('funds', { amount: 99999 })); assert.equal(h.p.funds, 99999);
  ok(h.cmd('funds', { amount: 0 })); assert.equal(h.p.funds, 0);
  ok(h.cmd('chess', { id: 'chess_char_3_19_a' }));
  const owner = [...h.p.hand, ...h.p.temp].find(p => p?.id === 'chess_char_3_19_a');
  assert.ok(owner);
  const id = h.p.gd.placeableTokens(owner.id, h.p.loadoutFor(h.p.gd.chess(owner.id)))[0].tokenId;
  const count = () => [...h.p.hand, ...h.p.temp].filter(p => p?.kind === 'token' && p.ownerUid === owner.uid).reduce((n, p) => n + p.count, 0);
  const before = count();
  ok(h.cmd('token', { id, ownerUid: owner.uid })); assert.equal(count(), before + 1);
  error(h.cmd('token', { id, ownerUid: 99999 }), 'BAD_TARGET');
  ok(h.cmd('item', { id: 'chess_item_1_03_e_a' }));
  assert.ok([...h.p.hand, ...h.p.temp].some(p => p?.id === 'chess_item_1_03_e_a'));
  for (const cmd of ['chess', 'item']) error(h.cmd(cmd, { id: 'missing' }), 'BAD_TARGET');
  assert.equal(h.m.errorCount, 0);
});

test('LP, boss HP and team LP accept exact bounded values only in their valid states', (t) => {
  const h = fixture(t);
  ok(h.cmd('lp', { value: 77 })); assert.equal(h.p.lp, 77);
  error(h.cmd('lp', { value: -1 }), 'BAD_TARGET'); assert.equal(h.p.lp, 77);
  error(h.cmd('hp', { value: 1 }), 'WRONG_PHASE');
  error(h.cmd('teamLp', { value: 1 }), 'WRONG_PHASE');
  h.m.phase = 'FINAL_ASSAULT'; h.m.bossPool = { hp: 100, maxHp: 100 }; h.m.teamLp = 20;
  ok(h.cmd('hp', { value: 42 })); assert.equal(h.m.bossPool.hp, 42);
  error(h.cmd('hp', { value: 101 }), 'BAD_TARGET'); assert.equal(h.m.bossPool.hp, 42);
  ok(h.cmd('teamLp', { value: 9 })); assert.equal(h.m.teamLp, 9);
  error(h.cmd('funds', { amount: 10 }), 'WRONG_PHASE');
});

test('bond activation, layers and strategy changes use the real calculator and update draft ownership', (t) => {
  const h = fixture(t);
  const id = h.m.gd.bondIds.find((bondId) => {
    const bond = h.m.gd.bond(bondId);
    return bond && !h.m.gd.modeInactiveBonds.has(bondId) && bond.thresholdTemplate !== 'count_threshold_downward' && bond.thresholds?.[0] >= 2;
  });
  const count = h.m.gd.bond(id).thresholds[0];
  ok(h.cmd('bond', { id, count: count - 1, layers: 0 }));
  assert.equal(h.p.bonds[id].active, false);
  assert.equal(h.p.privateView().bonds.find((b) => b.bondId === id).active, false);
  ok(h.cmd('bond', { id, count, layers: 0 }));
  assert.equal(h.p.bonds[id].active, true);
  assert.equal(h.p.privateView().bonds.find((b) => b.bondId === id).active, true);
  ok(h.cmd('bond', { id, count, layers: 3 }));
  assert.equal(h.p.layers[id], 3);
  const down = h.cmd('bond', { id, count: 0, layers: 2 });
  assert.equal(down.error, 'BAD_TARGET');
  assert.equal(down.detail, 'layers');
  assert.equal(h.p.bondCountBonus[id], count);
  const strategy = h.m.gd.bandIds().find(id => id !== h.p.bandId && h.m.gd.bandAllowed(id));
  ok(h.cmd('strategy', { id: strategy, resetLp: true }));
  assert.equal(h.p.bandId, strategy); assert.equal(h.p.lp, h.m.gd.startLp(strategy));
  assert.equal(h.m.draft.picks[h.p.playerId], strategy);
  error(h.cmd('strategy', { id: 'not_a_strategy' }), 'BAD_TARGET');
});

test('next shop is consumed once by a paid refresh; queued layout blocks upgrades; level uses its real price', (t) => {
  const h = fixture(t);
  ok(h.cmd('funds', { amount: 1000 }));
  const slots = h.p.shop.slots.map(s => ({ kind: s.kind, id: s.id }));
  const short = h.cmd('shop', { slots: slots.slice(1) });
  assert.equal(short.error, 'BAD_TARGET');
  assert.match(short.detail, /^shop\|\{"chess":\d+,"item":\d+\}$/);
  ok(h.cmd('shop', { slots }));
  error(h.cmd('level'), 'WRONG_PHASE');
  ok(h.m.handle('p_0', { t: 'g.refresh' }));
  assert.deepEqual(h.p.shop.slots.map(s => ({ kind: s.kind, id: s.id })), slots);
  assert.equal(h.p._testShopNext, null);
  const funds = h.p.funds, price = h.p.shop.upgradePrice, level = h.p.shop.level;
  ok(h.cmd('level')); assert.equal(h.p.shop.level, level + 1); assert.equal(h.p.funds, funds - price);
});

test('round and phase commands cancel stale callbacks; timers hold, advance once and resume', (t) => {
  const h = fixture(t);
  const far = h.cmd('round', { round: 99 });
  assert.equal(far.error, 'BAD_TARGET');
  assert.match(far.detail, /^round\|\{"hi":\d+\}$/);
  ok(h.cmd('timers', { on: false }));
  ok(h.cmd('round', { round: 2 })); assert.equal(h.m.round, 2); assert.equal(h.m.phase, 'ROUND_START');
  h.sched.advance(10000); assert.equal(h.m.phase, 'ROUND_START');
  ok(h.cmd('phase', { name: 'prep' })); assert.equal(h.m.phase, 'PREP');
  error(h.cmd('phase', { name: 'advance' }), 'WRONG_PHASE');
  ok(h.cmd('round', { round: 2 }));
  ok(h.cmd('phase', { name: 'advance' })); assert.notEqual(h.m.phase, 'ROUND_START');
  ok(h.cmd('timers', { on: true }));
  ok(h.cmd('round', { round: 3 }));
  h.sched.runUntil(() => h.m.phase !== 'ROUND_START');
  ok(h.cmd('timers', { on: false }));
  error(h.cmd('phase', { name: 'advance' }), 'WRONG_PHASE');
});

test('a live battle refuses timer commands and keeps its deadline', (t) => {
  const h = fixture(t);
  h.m.phase = 'COMBAT';
  h.m.deadline = 4200;
  for (const on of [false, true]) {
    const r = h.cmd('timers', { on });
    assert.equal(r.error, 'WRONG_PHASE');
    assert.equal(r.detail, 'timers');
  }
  assert.equal(h.m.deadline, 4200);
  assert.equal(h.m.testTimers, true);
});

test('an extra g.test field is BAD_MSG; rid is still allowed', (t) => {
  const h = fixture(t);
  assert.equal(guardTestMessage({ t: 'g.test', cmd: 'funds', args: { amount: 1 }, playerId: 'x', rid: 4 }).oversize, 'BAD_MSG');
  const kept = guardTestMessage({ t: 'g.test', cmd: 'funds', args: { amount: 1 }, rid: 4 });
  assert.equal(kept.oversize, undefined);
  assert.equal(kept.rid, 4);
  error(h.m.handle('p_0', { t: 'g.test', cmd: 'funds', args: { amount: 1 }, playerId: 'x', rid: 4 }), 'BAD_MSG');
  error(h.m.applyTestCommand(h.p, { t: 'g.test', cmd: 'funds', args: { amount: 1 }, playerId: 'x' }), 'BAD_MSG');
  ok(h.m.applyTestCommand(h.p, { t: 'g.test', cmd: 'funds', args: { amount: 2 }, rid: 9 }));
  assert.equal(h.p.funds, 2);
});

test('audit rows use one number, the actor name, a clock and the translated reason', () => {
  assert.equal(matchClock(3661000), '01:01:01');
  assert.equal(matchClock(0), '00:00:00');
  assert.equal(matchClock('nope'), '00:00:00');
  const log = [
    { seq: 1, playerId: 'p', cmd: 'bond', at: 5000, ok: false, code: 'BAD_TARGET', detail: 'layers' },
    { seq: 2, playerId: 'p', cmd: 'funds', at: 7000, ok: true },
  ];
  assert.deepEqual(newestFirst(log).map((e) => e.seq), [2, 1]);
  assert.equal(log[0].seq, 1);
  assert.match(explainTestDetail('shop|{"chess":5,"item":2}'), /5/);
  assert.match(explainTestDetail('shop|{"chess":5,"item":2}'), /2/);
  assert.match(explainTestDetail('round|{"hi":15}'), /15/);
  assert.match(explainTestDetail('layers'), /层数不能减少/);
  assert.match(explainTestDetail('timers'), /作战进行中不能开关计时/);
  assert.match(explainTestDetail('bond'), /盟约/);
  assert.equal(explainTestDetail(''), '');
  assert.equal(formatAuditLine(log[1], '凯尔希'), '2 凯尔希 00:00:07 funds 成功');
  const bad = formatAuditLine(log[0], '凯尔希');
  assert.match(bad, /^1 凯尔希 00:00:05 bond 层数不能减少$/);
  assert.equal(bad.split('1').length, 2);
  assert.equal(testRefusalText({ code: 'WRONG_PHASE', detail: 'timers', message: 'ignored' }), '作战进行中不能开关计时');
  assert.equal(testRefusalText({ code: 'WRONG_PHASE' }), '当前阶段无法进行该操作');
  assert.equal(testRefusalText({ code: 'BAD_TARGET' }), '无效的目标');
  assert.equal(testRefusalText({ message: 'plain' }).includes('无效的目标'), false);
  const packs = ['en', 'ja', 'ko', 'zh-TW'].map((code) => [code, JSON.parse(readFileSync(new URL(`../public/i18n/${code}.json`, import.meta.url), 'utf8'))]);
  for (const [code, pack] of packs) {
    const term = pack['层数'];
    assert.equal(typeof term, 'string');
    assert.equal(pack['层数不能减少'].includes(term), true, code);
  }
});

test('the public audit clock is match-relative when the scheduler stamp is an epoch', (t) => {
  const h = fixture(t);
  const epoch = 1_791_234_567_890;
  h.m.startedAt = epoch;
  ok(h.cmd('funds', { amount: 4 }));
  const stored = h.m.testLog.at(-1);
  stored.at = epoch + 12_500;
  const row = h.m.publicView().testLog.at(-1);
  assert.equal(stored.at, epoch + 12_500);
  assert.equal(row.at, 12_500);
  assert.equal(matchClock(row.at), '00:00:12');
  assert.match(matchClock(stored.at), /^497/);
  stored.at = epoch - 1000;
  assert.equal(h.m.publicView().testLog.at(-1).at, 0);
  assert.equal(matchClock(0), '00:00:00');
});

test('the open test dock defaults to the field and stays inside the viewport', () => {
  const css = readFileSync(new URL('../public/css/screens/game.css', import.meta.url), 'utf8');
  const declared = {
    '--dock-w': DOCK_REM.width, '--dock-margin': DOCK_REM.margin, '--dock-team-left': DOCK_REM.teamLeft,
    '--dock-team-right': DOCK_REM.teamRight, '--dock-team-top': DOCK_REM.teamTop, '--dock-team-avatar': DOCK_REM.teamAvatar,
    '--dock-team-gap': DOCK_REM.teamGap, '--dock-team-rows': DOCK_REM.teamRows, '--dock-bond-left': DOCK_REM.bondLeft,
    '--dock-bond-top': DOCK_REM.bondTop, '--dock-bond-bottom': DOCK_REM.bondBottom, '--dock-bond-slot': DOCK_REM.bondSlot,
    '--dock-bond-gap': DOCK_REM.bondGap, '--dock-top': DOCK_REM.topBar, '--dock-hand-clear': DOCK_REM.handClear,
    '--dock-hand-left': DOCK_REM.handLeft, '--dock-ready-right': DOCK_REM.readyRight, '--dock-ready-w': DOCK_REM.readyWidth,
    '--dock-ready-h': DOCK_REM.readyHeight, '--dock-shop-top': DOCK_REM.shopTop, '--dock-funds-w': DOCK_REM.fundsWidth,
    '--dock-shop-right': DOCK_REM.shopRight,
  };
  for (const [name, value] of Object.entries(declared)) assert.match(css, new RegExp(`${name}: ${value};`));
  const style = { getPropertyValue: (name) => declared[name] == null ? '' : String(declared[name]) };
  const metrics = dockMetricsFromStyle(style);
  assert.equal(metrics.bondBottom, DOCK_REM.bondBottom);
  assert.equal(metrics.handClear, DOCK_REM.handClear);
  assert.equal(dockMetricsFromStyle({ getPropertyValue: () => '' }).width, DOCK_REM.width);
  const piece1280 = { x: 190, y: 405, w: 57, h: 104 };
  const piece1920 = { x: 285, y: 607.5, w: 85.5, h: 156 };
  for (const [size, piece] of [[[1280, 720], piece1280], [[1920, 1080], piece1920]]) {
    const view = { width: size[0], height: size[1] };
    const home = dockHome(view, metrics);
    assert.equal(home.sheet, false);
    const panel = { x: home.x, y: home.y, w: home.width, h: home.height };
    assert.equal(rectAreaOverlap(panel, piece), 0, `${size} hand`);
    const boxes = dockObstacles(view, metrics);
    for (const [name, box] of Object.entries(boxes)) assert.equal(rectAreaOverlap(panel, box), 0, `${size} ${name}`);
    assert.ok(panel.x >= boxes.team.x + boxes.team.w - 1);
    assert.ok(panel.y >= boxes.bonds.y + boxes.bonds.h - 1);
    assert.ok(panel.y + panel.h <= boxes.hand.y + 1);
  }
  assert.equal(dockHome({ width: 720, height: 1280 }).sheet, true);
  assert.equal(dockHome({ width: 360, height: 640 }).sheet, true);
  // 界面大小 75 % (DESIGN §35.43): the measured root (50 px at 1280×720) places the dock, not the unscaled clamp (66.7)
  assert.ok(Math.abs(remOf(1280, 720) * 0.75 - 50) < 1e-9, 'remOf is the unscaled clamp');
  const full = dockHome({ width: 1280, height: 720 }, metrics), small = dockHome({ width: 1280, height: 720, rem: 50 }, metrics);
  assert.equal(small.rem, 50);
  assert.ok(Math.abs(small.x - full.x * 0.75) < 1e-9, `${small.x} vs ${full.x}`);
  assert.equal(dockObstacles({ width: 1280, height: 720, rem: 50 }, metrics).topBar.h, metrics.topBar * 50);
  const clamped = clampDock({ x: -40, y: 9000 }, { width: 1280, height: 720 }, { width: 240, height: 248 });
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 720 - 248);
  const mem = { m: new Map(), getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { this.m.set(k, v); } };
  assert.equal(readDockPos(mem), null);
  assert.equal(writeDockPos({ x: 12, y: 34 }, mem), true);
  assert.deepEqual(readDockPos(mem), { x: 12, y: 34 });
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readDockPos(boom), null);
  assert.equal(writeDockPos({ x: 1, y: 2 }, boom), false);
  assert.equal(writeDockPos({ x: NaN, y: 1 }, mem), false);
});

test('an unrecognised SP_TEST_MODE stays off and warns; a silent off does not', (t) => {
  const forced = openLobby(t, { testMode: 'forced', testHost: '127.0.0.1' });
  assert.equal(forced.lobby.testEnabled, false);
  assert.match(forced.lobby.testWarn, /未识别/);
  const quiet = openLobby(t, { testMode: 'off', testHost: '127.0.0.1' });
  assert.equal(quiet.lobby.testWarn, null);
  assert.equal(quiet.lobby.testEnabled, false);
});

test('bounty and choice use the existing offers and reject forged selections', (t) => {
  const h = fixture(t);
  const enemyKey = Object.keys(DATA.enemies).find(id => !h.m.gd.inactiveEnemies.has(id));
  ok(h.cmd('bounty', { enemyKey })); assert.ok(h.p.bounties.length);
  error(h.cmd('bounty', { enemyKey: 'missing' }), 'BAD_TARGET');
  error(h.cmd('choice', { idx: 0 }), 'WRONG_PHASE');
  const round = h.m.gd.spRounds()[0];
  ok(h.cmd('timers', { on: false })); ok(h.cmd('round', { round }));
  ok(h.cmd('phase', { name: 'sp' })); assert.equal(h.m.phase, 'SP_DRAFT');
  ok(h.cmd('choice', { idx: 0 }));
  assert.equal(h.m.errorCount, 0);
});

test('host migration, spectators, rate bounds and audit results cannot mutate another seat', (t) => {
  const h = fixture(t, { mode: 'coop', humans: 2, spectators: ['watch'] });
  const other = h.ps('p_1'), before = other.funds;
  error(h.cmd('funds', { amount: 90 }, 'p_1'), 'NOT_HOST');
  error(h.cmd('funds', { amount: 90 }, 'watch'), 'SPECTATOR');
  assert.equal(h.m.testLog.at(-1).cmd, 'funds');
  assert.equal(h.m.testLog.at(-1).code, 'SPECTATOR');
  assert.equal(h.m.testLog.at(-2).cmd, 'funds');
  // The guest and the spectator already took two slots of the shared funds bucket.
  for (let i = 0; i < TEST_RATE_COUNT - 2; i++) error(h.cmd('funds', { amount: -1 }), 'BAD_TARGET');
  error(h.cmd('funds', { amount: 90 }), 'RATE');
  assert.equal(other.funds, before);
  h.sched.advance(10000);
  h.m.setHost('p_1');
  error(h.cmd('funds', { amount: 90 }), 'NOT_HOST');
  ok(h.cmd('funds', { amount: 90 }, 'p_1')); assert.equal(other.funds, 90);
  const last = h.m.testLog.at(-1);
  assert.deepEqual(last.args, { amount: 90 }); assert.equal(last.playerId, 'p_1'); assert.equal(last.ok, true);
  assert.equal(h.m.publicView().test, true); assert.equal(h.m.publicView().testActions, 1);
  const result = buildResult(h.m, { victory: true, hiddenCleared: true });
  assert.equal(result.testActions, 1);
  for (const row of result.players) { assert.equal(row.title, null); assert.equal(row.trophies, 0); assert.equal(row.reward, 0); }
});

test('test journal re-simulates real inputs, timer order, RNG, public/private views and result', () => {
  const scheduler = new VirtualScheduler();
  const entries = [];
  const m = new Match({ mode: 'solo', difficulty: 'NORMAL', test: true, hostId: 'p', seed: 832,
    seats: [{ playerId: 'p', seat: 0, name: 'P', connected: true }], data: DATA, scheduler,
    send() {}, broadcast() {}, onEnd() {}, clientCombat: false, botRehearsal: 0, log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } },
  });
  m.start();
  ok(m.handle('p', { t: 'g.test', cmd: 'timers', args: { on: false } }));
  ok(m.handle('p', { t: 'g.infoReady' }));
  scheduler.runUntil(() => m.phase === 'BAND_DRAFT');
  ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'battleCheck' } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'advance' } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'prep' } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'funds', args: { amount: 700 } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'chess', args: { id: 'chess_char_1_01_a' } }));
  ok(m.handle('p', { t: 'g.refresh' }));
  ok(m.handle('p', { t: 'g.test', cmd: 'lp', args: { value: 0 } }));
  ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'combat' } }));
  assert.ok(scheduler.runUntil(() => m.phase === 'SETTLE' || m.ended));
  if (!m.ended) ok(m.handle('p', { t: 'g.test', cmd: 'phase', args: { name: 'advance' } }));
  assert.equal(m.ended, true);
  assert.equal(m.lastResultMsg.testActions, m.testActions);
  const copy = replayTestMatch(DATA, entries);
  assert.deepEqual(copy.publicView(), m.publicView());
  assert.deepEqual(copy.players.get('p').privateView(), m.players.get('p').privateView());
  assert.deepEqual(buildResult(copy, { victory: false }), buildResult(m, { victory: false }));
  assert.deepEqual(copy.lastResultMsg, m.lastResultMsg);
  assert.deepEqual(copy.testLog, m.testLog); assert.equal(copy.errorCount, 0);
  copy.dispose(); m.dispose();
});

test('test join and watch require acknowledgement before any seat or private state is sent', (t) => {
  const { lobby, player } = openLobby(t, { testMode: '1', testHost: '127.0.0.1' });
  const host = player('host'), guest = player('guest'), watcher = player('watcher');
  ok(lobby.create(host, { mode: 'coop', difficulty: 'NORMAL', test: true }));
  const code = host.roomCode;
  for (const [s, method] of [[guest, 'join'], [watcher, 'spectate']]) {
    error(lobby[method](s, { code }), 'TEST_CONFIRM');
    assert.equal(lobby.roomOf(s), null); assert.equal(s.messages.length, 0);
    ok(lobby[method](s, { code, testAck: true }));
    assert.equal(s.messages.at(-1).test, true);
  }
  for (const type of ['room.join', 'room.spectate']) {
    assert.equal(validateC2S({ t: type, code }), null);
    assert.equal(validateC2S({ t: type, code, testAck: true }), null);
    assert.ok(validateC2S({ t: type, code, testAck: false }));
  }
});

test('lobby rechecks process and immutable room gates on start and every command', (t) => {
  const { lobby, player } = openLobby(t, { testMode: '1', testHost: '127.0.0.1' });
  const host = player('host'); ok(lobby.create(host, { mode: 'solo', difficulty: 'NORMAL' }));
  const room = lobby.roomOf(host);
  let calls = 0; room.match = { handle() { calls++; }, dispose() {} };
  error(lobby.routeGameNow(host, { t: 'g.test', cmd: 'funds', args: { amount: 9 }, test: true }), 'TEST_FORBIDDEN');
  assert.equal(calls, 0);
  const tester = player('tester'); ok(lobby.create(tester, { mode: 'solo', difficulty: 'NORMAL', test: true }));
  const testRoom = lobby.roomOf(tester);
  lobby.setTestHost('8.8.8.8');
  error(lobby.startMatch(testRoom), 'TEST_DISABLED');
  error(lobby.routeGameNow(host, { t: 'g.test' }), 'TEST_DISABLED');
  assert.equal(calls, 0); assert.equal(testRoom.match, null);
});

test('public/wildcard/numeric listener variants require force and an actual IP', () => {
  for (const host of ['8.8.8.8', '2001:4860:4860::8888']) {
    assert.equal(testModeGate('local', host).enabled, false);
    assert.equal(testModeGate('local', host).warn, TEST_MODE_PUBLIC_HINT);
    assert.equal(testModeGate('force', host).enabled, true);
    assert.equal(testModeGate('force', host).warn, TEST_MODE_FORCE_HINT);
  }
  for (const host of ['0.0.0.0', '0.1.2.3', '::', '0:0:0:0:0:0:0:0', '::ffff:0.0.0.0']) {
    assert.equal(testModeGate('local', host, PUBLIC_NICS).enabled, false);
    assert.equal(testModeGate('local', host, PUBLIC_NICS).warn, TEST_MODE_PUBLIC_HINT);
    assert.equal(testModeGate('force', host, PUBLIC_NICS).enabled, true);
    assert.equal(testModeGate('force', host, PUBLIC_NICS).warn, TEST_MODE_FORCE_HINT);
  }
  for (const host of ['', 'localhost', 'not-an-address']) assert.equal(testModeGate('force', host).enabled, false);
});

test('strict catalogue rejects every malformed command before mutation, including prototype/path-shaped IDs', () => {
  const valid = {
    funds: { amount: 3 }, chess: { id: 'x' }, item: { id: 'x' }, token: { id: 'x', ownerUid: 1 },
    lp: { value: 1 }, hp: { value: 1 }, teamLp: { value: 1 }, round: { round: 1 }, phase: { name: 'prep' },
    shop: { slots: [{ kind: 'chess', id: 'x' }] }, timers: { on: false }, bond: { id: 'x', layers: 0, count: 3 },
    strategy: { id: 'x' }, level: {}, bounty: { enemyKey: 'x' }, choice: { idx: 0 },
  };
  for (const cmd of TEST_COMMANDS) {
    assert.ok(parseTestArgs(cmd, valid[cmd]).args, cmd);
    for (const args of [null, [], { ...valid[cmd], playerId: 'other' }, Object.create(valid[cmd])]) assert.equal(parseTestArgs(cmd, args).error, 'BAD_MSG', cmd);
  }
  for (const id of ['constructor', '__proto__', '../file', 'file:///tmp/a', 'x'.repeat(65)]) assert.equal(parseTestArgs('chess', { id }).error, 'BAD_TARGET');
  for (const amount of [NaN, Infinity, -1, 1.5, '3', 100000]) assert.equal(parseTestArgs('funds', { amount }).error, 'BAD_TARGET');
  assert.equal(parseTestArgs('bond', { id: 'x', layers: 0, count: 100 }).error, 'BAD_TARGET');
});

test('co-op band timer is held and cannot fire a stale draft callback after a phase jump', (t) => {
  const h = makeMatch({ test: true, mode: 'coop', humans: 2 }); t.after(() => h.m.dispose());
  h.start();
  for (const p of h.m.order) ok(h.m.handle(p.playerId, { t: 'g.infoReady' }));
  h.sched.runUntil(() => h.m.phase === 'BAND_DRAFT');
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'timers', args: { on: false } }));
  h.sched.advance(60000); assert.equal(h.m.phase, 'BAND_DRAFT'); assert.equal(Object.keys(h.m.draft.picks).length, 0);
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'phase', args: { name: 'battleCheck' } }));
  assert.equal(h.m.phase, 'BATTLE_CHECK');
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'phase', args: { name: 'advance' } }));
  assert.equal(h.m.phase, 'ROUND_START');
});

import { decodeTestTrace } from '../server/match/testReplay.js';
import { validHostMessage } from '../server/match/host/ipc.js';
import { mergeStats, migrateStats, saveStats, observeMatch, recordResult, liveMatch } from '../public/js/ui/stats.js';

test('large Unicode input journals survive the match-host log limit and reject missing fragments', () => {
  const entries = [];
  const m = new Match({ mode: 'solo', difficulty: 'NORMAL', test: true, data: DATA, scheduler: new VirtualScheduler(),
    seats: [{ playerId: 'p', seat: 0, name: '测试😀'.repeat(400), connected: true }],
    send() {}, broadcast() {}, onEnd() {},
    log: { info(text) { assert.ok(validHostMessage({ type: 'log', level: 'info', text })); entries.push(JSON.parse(text.slice(text.indexOf(']') + 2))); } },
  });
  m.start();
  assert.equal(entries[0].kind, 'chunk');
  assert.equal(decodeTestTrace(entries)[0].kind, 'init');
  assert.throws(() => decodeTestTrace(entries.slice(1)), /chunk/);
  assert.throws(() => decodeTestTrace(entries.slice(0, 1)), /incomplete/);
  const replay = replayTestMatch(DATA, entries);
  assert.deepEqual(replay.publicView(), m.publicView());
  replay.dispose(); m.dispose();
});

test('test results cannot enter local records via result, quit, import, merge or direct save', (t) => {
  const real = buildRecord(baseResult(), { myId: 'p1' });
  const marked = { ...real, id: 'test', test: true };
  assert.deepEqual(mergeStats({ records: [marked] }, { records: [] }).records, []);
  assert.deepEqual(migrateStats({ v: real.v, records: [marked] }).stats.records, []);
  const old = globalThis.localStorage;
  const writes = [];
  globalThis.localStorage = { setItem(k, v) { writes.push(JSON.parse(v)); } };
  t.after(() => { if (old === undefined) delete globalThis.localStorage; else globalThis.localStorage = old; liveMatch.active = false; liveMatch.test = false; });
  assert.equal(saveStats({ records: [marked] }), true); assert.deepEqual(writes[0].records, []);
  const state = { me: { playerId: 'p1' }, room: { test: true }, match: { public: { phase: 'PREP', round: 1, players: [] } } };
  observeMatch(liveMatch, state);
  state.room.test = false; observeMatch(liveMatch, state);
  assert.equal(liveMatch.test, true);
  assert.equal(recordResult(baseResult(), { myId: 'p1' }), null);
  assert.equal(buildQuitRecord(state), null);
  assert.equal(writes.length, 1);
});

test('DIY grants resolve the host configured view and no other player owner UID is accepted', (t) => {
  const id = 'chess_char_5_diy1_a';
  const h = fixture(t, { mode: 'coop', seats: [
    { seat: 0, playerId: 'p_0', name: 'P0', connected: true, diy: { [id]: { charId: 'char_601_cguard' } } },
    { seat: 1, playerId: 'p_1', name: 'P1', connected: true },
  ] });
  ok(h.cmd('chess', { id })); assert.ok([...h.p.hand, ...h.p.temp].some(p => p?.id === id));
  const other = h.ps('p_1').acquireChess('chess_char_3_19_a');
  const tokenId = h.ps('p_1').gd.placeableTokens(other.id, h.ps('p_1').loadoutFor(h.ps('p_1').gd.chess(other.id)))[0].tokenId;
  error(h.cmd('token', { id: tokenId, ownerUid: other.uid }), 'BAD_TARGET');
  assert.equal(h.ps('p_1').hand.filter(Boolean).length > 0, true);
});

test('audit memory/public tails are bounded, while every attempt is sent to the server journal', (t) => {
  const h = fixture(t);
  const audits = [];
  h.m.log.info = (line) => { if (line.startsWith('[test-audit ')) audits.push(JSON.parse(line.slice(line.indexOf(']') + 2))); };
  for (let i = 0; i < 224; i++) {
    if (i && i % 8 === 0) h.sched.advance(10000);
    ok(h.cmd('funds', { amount: i }));
  }
  assert.equal(audits.length, 224); assert.equal(h.m.testLog.length, 200);
  assert.equal(h.m.publicView().testLog.length, 12); assert.equal(h.m.testActions, 224);
  assert.equal(audits.at(-1).args.amount, 223); assert.equal(audits.at(-1).seq, 224);
});

test('any known equipment can be granted after stock is exhausted using existing overdraw accounting', (t) => {
  const h = fixture(t);
  const id = 'chess_item_1_03_e_a';
  for (let i = 0; i < 100 && h.m.itemPool.canGain(id); i++) h.p.acquireItem(id);
  assert.equal(h.m.itemPool.canGain(id), false);
  const debt = h.m.itemPool.debtOf(id);
  ok(h.cmd('item', { id }));
  assert.ok([...h.p.hand, ...h.p.temp].some(p => p?.kind === 'item'));
  assert.equal(h.m.itemPool.canGain(id), false);
  assert.equal(h.m.itemPool.debtOf(id), debt + 1);
});

test('LP 0 stays a raw write through combat, and an accepted jump eliminates it', (t) => {
  const live = makeMatch({ test: true, mode: 'solo', fake: true });
  t.after(() => live.m.dispose());
  live.start(); live.toPrep();
  const p = live.ps('p_0');
  ok(live.m.handle('p_0', { t: 'g.test', cmd: 'lp', args: { value: 0 } }));
  assert.ok(collectViolations(live.m).some((v) => v.includes('alive with lp')));
  error(live.m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: 99 } }), 'BAD_TARGET');
  assert.equal(p.alive, true);
  assert.equal(p.lp, 0);
  ok(live.m.handle('p_0', { t: 'g.test', cmd: 'phase', args: { name: 'combat' } }));
  assert.ok(live.run(() => live.m.phase === 'SETTLE' || live.m.ended));
  assert.equal(p.alive, false);
  assert.deepEqual(collectViolations(live.m), []);

  const jumped = makeMatch({ test: true, mode: 'solo', fake: true });
  t.after(() => jumped.m.dispose());
  jumped.start(); jumped.toPrep();
  const jp = jumped.ps('p_0');
  ok(jumped.m.handle('p_0', { t: 'g.test', cmd: 'lp', args: { value: 0 } }));
  ok(jumped.m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: 3 } }));
  assert.equal(jumped.m.ended, true);
  assert.equal(jumped.m.outcome.victory, false);
  assert.equal(jumped.m.outcome.reason, 'eliminated');
  assert.equal(jumped.m.round, 1);
  assert.equal(jp.alive, false);
  assert.equal(jp.funds, 0);
  assert.equal(jp.eliminatedRound, 1);
  assert.equal(jp.hand.some(Boolean), false);
  assert.deepEqual(collectViolations(jumped.m), []);
  error(jumped.m.handle('p_0', { t: 'g.test', cmd: 'lp', args: { value: 30 } }), 'WRONG_PHASE');
  assert.equal(jp.alive, false);
});

test('co-op jump eliminates only doctors already at LP 0; boss prep waits, hidden jump opens team LP', (t) => {
  const h = makeMatch({ test: true, mode: 'coop', humans: 2, fake: true });
  t.after(() => h.m.dispose());
  h.start(); h.toPrep();
  const host = h.ps('p_0');
  const guest = h.ps('p_1');
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'lp', args: { value: 0 } }));
  const left = h.m.round;
  const guestFunds = guest.funds;
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: 3 } }));
  assert.equal(host.alive, false);
  assert.equal(host.eliminatedRound, left);
  assert.equal(host.funds, 0);
  assert.equal(host.board.size, 0);
  assert.equal(host.hand.some(Boolean), false);
  assert.equal(guest.alive, true);
  assert.ok(guest.funds > guestFunds);
  assert.equal(h.m.ended, false);
  h.sched.runUntil(() => h.m.phase !== 'ROUND_START');
  assert.deepEqual(collectViolations(h.m), []);
  ok(h.m.handle('p_0', { t: 'g.test', cmd: 'lp', args: { value: 30 } }));
  assert.equal(host.alive, false);
  assert.equal(host.lp, 30);
  assert.deepEqual(collectViolations(h.m), []);

  const both = makeMatch({ test: true, mode: 'coop', humans: 2, fake: true });
  t.after(() => both.m.dispose());
  both.start(); both.toPrep();
  both.ps('p_1').lp = 0;
  ok(both.m.handle('p_0', { t: 'g.test', cmd: 'lp', args: { value: 0 } }));
  ok(both.m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: 3 } }));
  assert.equal(both.m.ended, true);
  assert.equal(both.m.round, 1);
  assert.equal(both.m.outcome.reason, 'eliminated');
  assert.equal(both.ps('p_0').funds, 0);
  assert.equal(both.ps('p_1').funds, 0);
  assert.deepEqual(collectViolations(both.m), []);

  const boss = makeMatch({ test: true, mode: 'solo', fake: true, instant: false });
  t.after(() => boss.m.dispose());
  boss.start(); boss.toPrep();
  const bp = boss.ps('p_0');
  ok(boss.m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: boss.m.gd.bossRound } }));
  boss.sched.runUntil(() => boss.m.phase !== 'ROUND_START');
  assert.equal(boss.m.phase, 'PREP');
  assert.equal(boss.m.teamLp, null);
  assert.ok(boss.m.bossWaves.length >= 1);
  assert.deepEqual(collectViolations(boss.m), []);
  ok(boss.m.handle('p_0', { t: 'g.test', cmd: 'phase', args: { name: 'combat' } }));
  assert.equal(boss.m.phase, 'FINAL_ASSAULT');
  assert.equal(boss.m.teamLp, bp.lp);
  assert.ok(boss.m.teamLp > 0);

  const hid = makeMatch({ test: true, mode: 'solo', fake: true, instant: false });
  t.after(() => hid.m.dispose());
  hid.start(); hid.toPrep();
  const hp = hid.ps('p_0');
  const hidden = hid.m.gd.hiddenRound;
  ok(hid.m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: hidden } }));
  assert.equal(hid.m.teamLp, hp.lp);
  assert.equal(hp.lpAtFinal, hp.lp);
  const pool = hid.m.teamLp;
  ok(hid.m.handle('p_0', { t: 'g.test', cmd: 'lp', args: { value: hp.lp - 1 } }));
  ok(hid.m.handle('p_0', { t: 'g.test', cmd: 'round', args: { round: hidden } }));
  assert.equal(hid.m.teamLp, pool);
  assert.notEqual(hid.m.teamLp, hp.lp);
  hid.sched.runUntil(() => hid.m.phase === 'PREP');
  assert.deepEqual(collectViolations(hid.m), []);
  ok(hid.m.handle('p_0', { t: 'g.test', cmd: 'phase', args: { name: 'combat' } }));
  assert.equal(hid.m.phase, 'HIDDEN_CORE');
  assert.ok(hid.m.teamLp > 0);
  hid.sched.runNext();
  assert.equal(hid.m.phase, 'HIDDEN_CORE');
  assert.deepEqual(collectViolations(hid.m), []);
});

test('real-scheduler test matches keep 8 ms slices; virtual time stays unbounded', (t) => {
  const seats = [{ playerId: 'p', seat: 0, name: 'P', connected: true }];
  const quiet = { send() {}, broadcast() {}, onEnd() {}, log: { info() {}, warn() {}, error() {} } };
  const real = new Match({ mode: 'solo', difficulty: 'NORMAL', test: true, hostId: 'p', seats, data: DATA, scheduler: new RealScheduler(), ...quiet });
  t.after(() => real.dispose());
  assert.equal(real.botSliceMs, 8);
  assert.equal(real.headlessSliceMs, 8);
  const virt = new Match({ mode: 'solo', difficulty: 'NORMAL', test: true, hostId: 'p', seats, data: DATA, scheduler: new VirtualScheduler(), ...quiet });
  t.after(() => virt.dispose());
  assert.equal(virt.botSliceMs, Infinity);
  assert.equal(virt.headlessSliceMs, Infinity);
  const plain = new Match({ mode: 'solo', difficulty: 'NORMAL', seats, data: DATA, scheduler: new RealScheduler(), ...quiet });
  t.after(() => plain.dispose());
  assert.equal(plain.botSliceMs, 8);
  assert.equal(plain.headlessSliceMs, 8);
});

test('spectators share the rate bucket; oversized args never reach the journal', (t) => {
  const entries = [];
  const audits = [];
  const m = new Match({
    mode: 'coop', difficulty: 'NORMAL', test: true, hostId: 'p_0',
    seats: [
      { playerId: 'p_0', seat: 0, name: 'P0', connected: true },
      { playerId: 'p_1', seat: 1, name: 'P1', connected: true },
    ],
    spectators: ['watch'], data: DATA, scheduler: new VirtualScheduler(),
    send() {}, broadcast() {}, onEnd() {},
    log: { info(line) {
      if (typeof line !== 'string') return;
      if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2)));
      if (line.startsWith('[test-audit ')) audits.push(JSON.parse(line.slice(line.indexOf(']') + 2)));
    } },
  });
  t.after(() => m.dispose());
  const before = entries.length;
  for (let i = 0; i < 250; i++) {
    const res = m.handle('watch', { t: 'g.test', cmd: 'funds', args: { amount: 1 } });
    assert.equal(res.error, i < TEST_RATE_COUNT ? 'SPECTATOR' : 'RATE');
  }
  assert.equal(entries.length - before, 250);
  assert.equal(audits.length, 250);
  assert.equal(audits[TEST_RATE_COUNT - 1].code, 'SPECTATOR');
  assert.equal(audits[TEST_RATE_COUNT].code, 'RATE');
  assert.equal(m._testRate.get('funds').length, TEST_RATE_COUNT);
  const huge = 'c'.repeat(60000);
  const grew = entries.length;
  const res = m.handle('p_0', { t: 'g.test', cmd: 'chess', args: { id: huge } });
  assert.equal(res.error, 'BAD_TARGET');
  assert.equal(entries.length, grew + 1);
  assert.equal(audits.at(-1).code, 'BAD_TARGET');
  assert.equal(audits.at(-1).args.rejected, true);
  assert.equal(JSON.stringify(entries.at(-1)).includes(huge), false);
  const wide = m.handle('p_0', { t: 'g.test', cmd: 'z'.repeat(60000) });
  assert.equal(wide.error, 'BAD_MSG');
  assert.equal(JSON.stringify(entries.at(-1)).includes('z'.repeat(80)), false);
  assert.equal(guardTestMessage({ t: 'g.test', cmd: 'chess', args: { id: huge } }).oversize, 'BAD_TARGET');
  assert.equal(m.testReplayable, true);
  assert.equal(m.publicView().testReplayable, undefined);
});

test('a full input journal is marked not replayable instead of truncated', (t) => {
  const entries = [];
  const scheduler = new VirtualScheduler();
  const m = new Match({
    mode: 'solo', difficulty: 'NORMAL', test: true, hostId: 'p', seed: 3,
    seats: [{ playerId: 'p', seat: 0, name: 'P', connected: true }],
    data: DATA, scheduler, send() {}, broadcast() {}, onEnd() {},
    log: { info(line) {
      if (typeof line === 'string' && line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2)));
    } },
  });
  t.after(() => m.dispose());
  for (let i = 0; i < TEST_JOURNAL_CAP + 16; i++) {
    if (i > 0 && i % TEST_RATE_COUNT === 0) scheduler.advance(TEST_RATE_COUNT * 2000);
    m.handle('p', { t: 'g.test', cmd: 'nope' });
    if (m.testReplayable === false) break;
  }
  assert.equal(m.testReplayable, false);
  assert.equal(entries.length <= TEST_JOURNAL_CAP, true);
  assert.equal(entries.at(-1).kind, 'capped');
  assert.equal(buildResult(m, { victory: false }).testReplayable, false);
  assert.equal(m.publicView().testReplayable, undefined);
  assert.throws(() => replayTestMatch(DATA, entries), /not replayable/);
});

for (const botRehearsal of [0, 1]) test(`sliced bot prep and a server-run battle replay a host command between slices (rehearsal ${botRehearsal})`, (t) => {
  const origNow = performance.now.bind(performance);
  let clock = 0;
  performance.now = () => (clock += 100);
  FakeBattle.reset();
  FakeBattle.script = () => ({ duration: 1 });
  const scheduler = new VirtualScheduler({ instantCombat: false });
  const entries = [];
  const m = new Match({
    mode: 'coop', difficulty: 'NORMAL', test: true, hostId: 'p_0', seed: 832,
    seats: [
      { playerId: 'p_0', seat: 0, name: 'P', connected: true },
      { playerId: 'ai_0', seat: 1, name: 'AI', isBot: true, connected: true },
    ],
    data: DATA, scheduler, clientCombat: true, botRehearsal, botSliceMs: 8, headlessSliceMs: 8,
    BattleClass: FakeBattle, send() {}, broadcast() {}, onEnd() {},
    log: { info(line) {
      if (typeof line === 'string' && line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2)));
    }, warn() {}, error() {} },
  });
  t.after(() => { performance.now = origNow; FakeBattle.reset(); m.dispose(); });
  assert.equal(m.botSliceMs, 8);
  assert.equal(m.headlessSliceMs, 8);
  const pump = (pred, max = 250000) => {
    for (let i = 0; i < max; i++) {
      if (pred()) return true;
      const ps = m.players.get('p_0');
      if (ps && !ps.left) {
        if (m.phase === 'INFO_CHECK' && !ps.infoReady) m.handle('p_0', { t: 'g.infoReady' });
        else if (m.phase === 'BAND_DRAFT' && m.draftTurn() === 'p_0') m.handle('p_0', { t: 'g.band', bandId: 'band_bldsk' });
      }
      if (pred()) return true;
      if (!scheduler.runNext()) return !!pred();
    }
    return !!pred();
  };
  m.start();
  assert.ok(pump(() => m.phase === 'PREP'), `prep ${m.phase}`);
  const ai = m.players.get('ai_0');
  assert.ok(pump(() => entries.some((e) => e.kind === 'timer' && e.steps > 0) && !ai.ready), 'bot prep did not slice');
  const fundsBefore = m.players.get('p_0').funds;
  ok(m.handle('p_0', { t: 'g.test', cmd: 'funds', args: { amount: fundsBefore + 25 } }));
  assert.equal(ai.ready, false);
  assert.equal(m.players.get('p_0').funds, fundsBefore + 25);
  assert.deepEqual(collectViolations(m), []);
  const prepCut = entries.findIndex((e) => e.kind === 'call' && e.args?.[1]?.cmd === 'funds');
  assert.ok(prepCut > 0 && entries.slice(0, prepCut).some((e) => e.kind === 'timer' && e.steps > 0));
  // Journal the drop (onDisconnect). A raw connected write is invisible to replay, so the human
  // field would stay on the client and the sliced server battle would not re-sim.
  m.onDisconnect('p_0');
  const host = m.players.get('p_0');
  if (host.personalChoice) m.handle('p_0', { t: 'g.choice', idx: 0, choiceId: host.personalChoice.id });
  if (!host.tempEmpty) host.resolveTemp();
  ok(m.handle('p_0', { t: 'g.ready', ready: true }));
  assert.ok(pump(() => m.phase === 'COMBAT' && m.fields.some((f) => f.job && !f.job.done) && entries.slice(prepCut + 1).some((e) => e.kind === 'timer' && e.steps > 0)), `combat ${m.phase}`);
  const marked = entries.length;
  error(m.handle('p_0', { t: 'g.test', cmd: 'lp', args: { value: 17 } }), 'WRONG_PHASE');
  assert.ok(m.fields.some((f) => f.job && !f.job.done));
  const battleCut = entries.findIndex((e, i) => i >= marked && e.kind === 'call' && e.args?.[1]?.cmd === 'lp');
  assert.ok(battleCut > prepCut);
  assert.ok(entries.slice(prepCut + 1, battleCut).some((e) => e.kind === 'timer' && e.steps > 0));
  assert.ok(pump(() => m.phase === 'SETTLE' || m.ended), `settle ${m.phase}`);
  assert.ok(entries.slice(battleCut + 1).some((e) => e.kind === 'timer' && e.steps > 0));
  assert.deepEqual(collectViolations(m), []);
  performance.now = origNow;
  const copy = replayTestMatch(DATA, entries, { BattleClass: FakeBattle });
  t.after(() => copy.dispose());
  assert.deepEqual(copy.publicView(), m.publicView());
  assert.deepEqual(copy.players.get('p_0').privateView(), m.players.get('p_0').privateView());
  assert.deepEqual(copy.players.get('ai_0').privateView(), m.players.get('ai_0').privateView());
  assert.deepEqual(copy.testLog, m.testLog);
  assert.equal(copy.phase, m.phase);
  assert.equal(copy.errorCount, 0);
});
