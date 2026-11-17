// Unit tests (Node) for the 本机对局统计 record store (public/js/ui/stats.js; PR #323 by @2321Robin, reworked for 0.2.2):
//   record building from a raw m.result (spectator copies and player-less error results build nothing),
//   replay dedupe by content id (the lobby re-pushes m.result on reconnect / reload),
//   the counting rule (a match left before a round was cleared is history only — the owner's decision of 2026-10-08),
//   the match left early (放弃模拟): quit records built from the page's view of the match,
//   bounded storage (MAX_RECORDS, MAX_CHARS, the compacted older records, a refused write),
//   corrupt / old storage (unreadable JSON, damaged rows, a pre-`end` envelope, a newer one never overwritten),
//   import merge semantics (newest first) and the aggregate the stats page renders.
// localStorage is faked per test (Node has none); recordResult / recordQuit / loadStats / saveStats go through it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATS_VERSION, MAX_RECORDS, MAX_CHARS, FULL_KEEP, emptyStats, buildRecord, recordId, appendRecord, recordResult, recordQuit,
  loadStats, saveStats, migrateStats, normalizeRecord, importStats, exportStats, aggregateStats, selfRowOf, roomModeOf,
  recordToResult, compactRecord, fitToBudget, countsTowardStats, roundsOf, clearedRounds, createLiveMatch, observeMatch,
  buildQuitRecord, installStatsRecorder, liveMatch, MIGRATIONS,
  trophyMedalOf, peekStatsRecords,
} from '../../public/js/ui/stats.js';
import { createStore, emptyMatch } from '../../public/js/store.js';
import { normalizeResult } from '../../public/js/ui/gameLogic.js';
import { PHASE } from '../../shared/constants.js';

/** A realistic m.result in the shape server/match/results.js buildResult emits (replayed byte-identically). */
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
        stats: { dmgDealt: 15234.7, kills: 41, leaks: 2, gold: 880, refreshes: 5, merges: 6, itemsEquipped: 4, bossDamage: 5000.5, activatedLayers: 99, lpLost: 3, perfectRounds: 7 },
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

/** Fake localStorage: Map-backed, with an optional byte budget that makes setItem throw like a full quota. */
function fakeStorage({ budget = Infinity } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (String(v).length > budget) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    get raw() { return m.get('sp.pref.stats') ?? null; },
    get damaged() { return m.get('sp.pref.stats.damaged') ?? null; },
  };
}
/** Run `fn` with a fake localStorage installed. */
function withStorage(opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const ls = fakeStorage(opts);
  globalThis.localStorage = ls;
  try { return fn(ls); } finally { delete globalThis.localStorage; }
}
/** n settled records, newest first, t = n−1 … 0 */
function manyRecords(n, mk = (i) => baseResult({ seed: i })) {
  let stats = emptyStats();
  for (let i = 0; i < n; i++) stats = appendRecord(stats, buildRecord(mk(i), { myId: 'p1', now: i })).stats;
  return stats;
}

// ---- the match on screen, as the app store holds it ---------------------------------------------------------------------

/** An app state with a running match: `phase` of `round`, the local player p1 (alive unless `alive: false`). */
function liveState({ phase = PHASE.PREP, round = 1, alive = true, spectator = false, result = null, roomMode = 'solo', difficulty = 'HARD' } = {}) {
  const players = spectator ? [{ playerId: 'p9', seat: 0, name: '别人', alive: true, lp: 20, bandId: 'band_x' }]
    : [{ playerId: 'p1', seat: 0, name: '罗宾', alive, lp: alive ? 22 : 0, bandId: 'band_amiya' }];
  return {
    me: { playerId: 'p1', name: '罗宾' },
    room: { code: 'ABCD', mode: roomMode },
    match: {
      public: { phase, round, lastRound: 14, modeId: roomMode === 'solo' ? `mode_single_${difficulty.toLowerCase()}` : `mode_multi_${difficulty.toLowerCase()}`, difficulty, stageId: 'stage_a', bossId: 'boss_2', hiddenBossId: 'boss_10', players },
      private: null, field: null, result, battle: null,
    },
  };
}
/** The tracker as it would stand after watching `states` (one `now` per state). */
function watched(states, t0 = 1_000_000) {
  const live = createLiveMatch();
  states.forEach((s, i) => observeMatch(live, s, t0 + i * 1000));
  return live;
}

describe('local stats: record building', () => {
  test('builds one full record from a raw m.result (frame + players + self marking)', () => {
    const rec = buildRecord(baseResult(), { myId: 'p1', roomMode: 'solo', now: 1700000000000 });
    assert.ok(rec);
    assert.equal(rec.v, STATS_VERSION);
    assert.equal(rec.end, 'settled');
    assert.equal(rec.t, 1700000000000);
    assert.equal(rec.selfId, 'p1');
    assert.equal(rec.victory, true);
    assert.equal(rec.difficulty, 'HARD');
    assert.equal(rec.seed, 123456789);
    assert.equal(rec.durationMs, 952123);
    assert.equal(rec.roomMode, 'solo');
    assert.equal(rec.id, recordId(baseResult(), 'p1'));
    assert.equal(rec.players.length, 2);
    const self = rec.players[0];
    assert.equal(self.bandId, 'band_amiya');
    assert.deepEqual(self.title, { id: 'comment_1' }, 'the title is kept by id: its texts come from the game data');
    assert.equal(self.stats.bossDamage, 5000.5);
    assert.deepEqual(self.lineup, [{ id: 'char_290_vigna', golden: false, tier: 2, items: ['item_eq_1'] }]);
    assert.deepEqual(self.bonds, [{ bondId: 'steadShip', layers: 12, active: true }]);
  });

  test('a 自选 pick and a 补位 stand-in survive in the lineup, or the replayed card would draw the plain operator', () => {
    const res = baseResult();
    res.players[0].lineup = [
      { id: 'chess_diy_a', golden: true, tier: 5, row: 1, col: 1, items: [], diy: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege', extra: 'x' } },
      { id: 'chess_x', golden: false, tier: 1, items: [], standInFor: 'char_002_amiya' },
      { id: 'tok_1', kind: 'token', golden: false, tier: 0, items: [] },
    ];
    const back = buildRecord(res, { myId: 'p1', now: 1 }).players[0].lineup;
    assert.deepEqual(back[0].diy, { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' });
    assert.equal(back[1].standInFor, 'char_002_amiya');
    assert.equal(back[2].kind, 'token');
  });

  test('a spectator seat copy (my id not among players) records nothing; so do player-less error results', () => {
    assert.equal(buildRecord(baseResult(), { myId: 'spec9', now: 1 }), null);
    assert.equal(buildRecord(baseResult({ players: [] }), { myId: 'p1', now: 1 }), null);
    assert.equal(buildRecord(null, { myId: 'p1' }), null);
  });

  test('roomMode falls back to the modeId (single → solo, multi → coop, else null)', () => {
    assert.equal(roomModeOf('mode_multi_funny', null), 'coop');
    assert.equal(roomModeOf('mode_single_normal', 'coop'), 'coop'); // explicit room mode wins
    assert.equal(roomModeOf('mode_training_1', null), null);
    assert.equal(buildRecord(baseResult({ modeId: 'mode_multi_hard' }), { myId: 'p1', now: 1 }).roomMode, 'coop');
  });
});

describe('local stats: replay dedupe', () => {
  test('the replayed m.result (same content) appends once; a different seed is a new game', () => {
    const stats = emptyStats();
    const res = baseResult();
    const first = appendRecord(stats, buildRecord(res, { myId: 'p1', now: 1000 }));
    assert.equal(first.added, true);
    const replay = appendRecord(first.stats, buildRecord(res, { myId: 'p1', now: 999000 }));
    assert.equal(replay.added, false); // the reload / reconnect replay
    assert.equal(replay.stats.records.length, 1);
    assert.equal(replay.stats.records[0].t, 1000); // the FIRST arrival's timestamp is kept
    const other = appendRecord(replay.stats, buildRecord(baseResult({ seed: 42, durationMs: 55555 }), { myId: 'p1', now: 2000 }));
    assert.equal(other.added, true);
    assert.equal(other.stats.records.length, 2);
    assert.equal(other.stats.records[0].id, recordId(baseResult({ seed: 42, durationMs: 55555 }), 'p1'));
  });

  test('recordResult end-to-end over faked localStorage: replay arrives, nothing is written twice', () => {
    withStorage(() => {
      const res = baseResult();
      const rec = recordResult(res, { myId: 'p1', roomMode: 'solo', now: 1000 });
      assert.ok(rec);
      assert.equal(recordResult(res, { myId: 'p1', roomMode: 'solo', now: 2000 }), null); // replay dropped
      const loaded = loadStats();
      assert.equal(loaded.records.length, 1);
      assert.equal(loaded.records[0].id, rec.id);
    });
  });
});

describe('local stats: the room\'s cosmetic plugins (DESIGN §32 P1a review round 2)', () => {
  const VS = 'ab'.repeat(32);
  test('every record names the room\'s visual set vs (null without plugins); a cosmetic-only match counts like any (the owner\'s decision of 2026-10-13)', () => {
    const plain = buildRecord(baseResult(), { myId: 'p1', now: 1 });
    assert.equal(plain.vs, null, 'no cosmetic plugin: null');
    const skinned = buildRecord(baseResult({ seed: 7 }), { myId: 'p1', vs: VS, now: 2 });
    assert.equal(skinned.vs, VS);
    assert.equal(buildRecord(baseResult(), { myId: 'p1', vs: 'not-a-hash', now: 3 }).vs, null, 'only a visual hash');
    assert.equal(compactRecord(skinned).vs, VS, 'kept when compacted');
    assert.equal(normalizeRecord({ ...skinned, vs: 'XX' }).vs, null);
    // a quit record takes the room's from the app state
    const s = liveState({ phase: PHASE.PREP, round: 3 });
    s.room.content = { cs: 'cd'.repeat(32), vanilla: true, vs: VS, plugins: [{ id: 'skin' }] };
    const quit = buildQuitRecord(s, { live: watched([liveState({ phase: PHASE.INFO_CHECK, round: 0 }), s]), now: 5_000_000 });
    assert.equal(quit.vs, VS);
    // the overview counts both alike: cosmetic plugins change neither gameplay nor numbers (the owner's decision of 2026-10-13)
    let stats = emptyStats();
    for (const r of [plain, skinned]) stats = appendRecord(stats, r).stats;
    assert.deepEqual([aggregateStats(stats.records).total, aggregateStats(stats.records).count], [2, 2]);
    // an id-less (hand-made) record's content id does not depend on vs: the id of a record from before 0.3.0 stays
    const { id: _id, vs: _vs, ...bare } = plain;
    assert.equal(normalizeRecord({ ...bare }).id, normalizeRecord({ ...bare, vs: VS }).id);
  });
});

describe('local stats: the counting rule (a match entered and left right away does not count)', () => {
  /** A quit record whose player left in `phase` of `round` (alive unless told otherwise). */
  const quitAt = (phase, round, o = {}) => {
    const s = liveState({ phase, round, ...o });
    return buildQuitRecord(s, { live: watched([liveState({ phase: PHASE.INFO_CHECK, round: 0 }), s]), now: 5_000_000 });
  };

  test('a settled match always counts — even one lost in the first rounds', () => {
    const rec = buildRecord(baseResult({ victory: false, roundsPassed: 0, players: [{ ...baseResult().players[0], victory: false, alive: false, roundsPassed: 0 }] }), { myId: 'p1', now: 1 });
    assert.equal(rec.end, 'settled');
    assert.equal(countsTowardStats(rec), true);
  });

  test('left before the first round was cleared: history only; once a round is cleared it counts', () => {
    // the server's rule (platform.js _quit): leaving while round k runs has passed k − 1 rounds, leaving in its settlement k
    for (const [phase, round, passed, counts] of [
      [PHASE.INFO_CHECK, 0, 0, false], [PHASE.BAND_DRAFT, 0, 0, false], [PHASE.PREP, 1, 0, false], [PHASE.COMBAT, 1, 0, false],
      [PHASE.SETTLE, 1, 1, true], [PHASE.PREP, 2, 1, true], [PHASE.COMBAT, 9, 8, true], [PHASE.FINAL_ASSAULT, 14, 13, true],
    ]) {
      const rec = quitAt(phase, round);
      assert.equal(rec.end, 'quit', `${phase} ${round}`);
      assert.equal(rec.players[0].roundsPassed, passed, `${phase} ${round}: rounds cleared`);
      assert.equal(clearedRounds(phase, round), passed);
      assert.equal(countsTowardStats(rec), counts, `${phase} ${round}: counts`);
    }
  });

  test('left after being eliminated: it counts (the player lost it), the rounds are those it was seen alive in, less one', () => {
    const s = [liveState({ phase: PHASE.INFO_CHECK, round: 0 }), liveState({ round: 4 }), liveState({ round: 5 }), liveState({ phase: PHASE.SETTLE, round: 5, alive: false }), liveState({ phase: PHASE.PREP, round: 8, alive: false })];
    const live = watched(s);
    const rec = buildQuitRecord(s[4], { live, now: 9e6 });
    assert.equal(rec.players[0].alive, false);
    assert.equal(rec.players[0].eliminatedRound, 5);
    assert.equal(rec.players[0].roundsPassed, 4, 'eliminated in round 5 ⇒ 4 passed (the round 8 it left in is not its)');
    assert.equal(roundsOf(rec), 4);
    assert.equal(countsTowardStats(rec), true);
    // a page that never saw it alive (a reload after the elimination) does not know the rounds — it still counts
    const unknown = buildQuitRecord(s[4], { live: watched([s[4]]), now: 9e6 });
    assert.equal(unknown.players[0].roundsPassed, null);
    assert.equal(roundsOf(unknown), 0);
    assert.equal(countsTowardStats(unknown), true);
  });

  test('the aggregates take only the records that count; total / excluded say what was left out', () => {
    const settled = buildRecord(baseResult(), { myId: 'p1', roomMode: 'solo', now: 3000 });
    const peek = quitAt(PHASE.PREP, 1);           // entered, left in the first round
    const played = quitAt(PHASE.PREP, 6);         // 5 rounds cleared, then gave up
    const agg = aggregateStats([settled, peek, played]);
    assert.equal(agg.total, 3);
    assert.equal(agg.count, 2);
    assert.equal(agg.excluded, 1);
    assert.equal(agg.wins, 1);
    assert.equal(agg.rounds.max, 16, 'the best of the player\'s own rounds');
    assert.equal(agg.rounds.total, 16 + 5, 'the peek adds nothing');
    assert.equal(agg.byDifficulty.HARD.games, 2);
    assert.deepEqual(agg.bands.band_amiya, { games: 2, wins: 1 });
    assert.equal(agg.byMode.solo.games, 2);
  });

  test('combat totals read the settled records only (a quit record has no stat block)', () => {
    const agg = aggregateStats([buildRecord(baseResult(), { myId: 'p1', now: 1 }), quitAt(PHASE.PREP, 6)]);
    assert.equal(agg.sums.kills, 41);
    assert.equal(agg.count, 2);
  });

  test('the history keeps every record, counted or not: the page filters nothing out of the list', () => {
    const peek = quitAt(PHASE.INFO_CHECK, 0);
    assert.equal(countsTowardStats(peek), false);
    withStorage(() => {
      let stats = emptyStats();
      stats = appendRecord(stats, peek).stats;
      stats = appendRecord(stats, buildRecord(baseResult(), { myId: 'p1', now: 7e6 })).stats;
      assert.equal(saveStats(stats), true);
      const back = loadStats();
      assert.equal(back.records.length, 2);
      assert.deepEqual(back.records.map((r) => r.end).sort(), ['quit', 'settled']);
      assert.equal(back.records.find((r) => r.end === 'quit').players[0].roundsPassed, 0);
    });
  });
});

describe('local stats: the match left early (放弃模拟)', () => {
  test('builds a quit record from the page\'s view: frame, own row, no teammates, no stats, no replay', () => {
    const s = liveState({ phase: PHASE.PREP, round: 3, roomMode: 'coop', difficulty: 'ABYSS' });
    const rec = buildQuitRecord(s, { live: watched([liveState({ phase: PHASE.INFO_CHECK, round: 0, roomMode: 'coop', difficulty: 'ABYSS' }), s]), now: 2_000_000 });
    assert.equal(rec.end, 'quit');
    assert.equal(rec.reason, 'quit');
    assert.equal(rec.victory, false);
    assert.equal(rec.difficulty, 'ABYSS');
    assert.equal(rec.roomMode, 'coop');
    assert.equal(rec.modeId, 'mode_multi_abyss');
    assert.equal(rec.selfId, 'p1');
    assert.equal(rec.players.length, 1);
    assert.equal(rec.players[0].left, true);
    assert.equal(rec.players[0].bandId, 'band_amiya');
    assert.deepEqual(rec.players[0].stats, {});
    assert.equal(rec.durationMs, 1_000_000, 'seen from the start: now − when the page first saw it');
    assert.equal(recordToResult(rec), null, 'nothing was settled: no settlement screen to show');
    assert.match(rec.id, /^q\./);
  });

  test('no record for: no match on screen, a settlement already there, a spectator seat, a match the page never saw', () => {
    const s = liveState({ round: 2 });
    const live = watched([s]);
    assert.equal(buildQuitRecord({ ...s, match: { ...s.match, public: null } }, { live }), null);
    assert.equal(buildQuitRecord(liveState({ round: 2, result: { victory: true, players: [] } }), { live }), null);
    assert.equal(buildQuitRecord(liveState({ round: 2, spectator: true }), { live: watched([liveState({ round: 2, spectator: true })]) }), null);
    assert.equal(buildQuitRecord(s, { live: createLiveMatch() }), null);
  });

  test('a match first seen mid-way (a reload) keeps no duration; the tracker restarts for the next match', () => {
    const s = liveState({ phase: PHASE.PREP, round: 6 });
    const live = watched([s]);
    assert.equal(live.sawStart, false);
    assert.equal(buildQuitRecord(s, { live, now: 9e6 }).durationMs, null);
    // the match ends (result) and a new one starts: a fresh start
    observeMatch(live, liveState({ phase: PHASE.RESULT, round: 14, result: { victory: true } }), 1);
    assert.equal(live.active, false);
    observeMatch(live, liveState({ phase: PHASE.INFO_CHECK, round: 0 }), 2);
    assert.equal(live.active, true);
    assert.equal(live.sawStart, true);
  });

  test('recordQuit stores it through localStorage once; the settlement of the same match is a different record', () => {
    withStorage(() => {
      const s = liveState({ phase: PHASE.PREP, round: 4 });
      const live = watched([liveState({ phase: PHASE.INFO_CHECK, round: 0 }), s]);
      const rec = recordQuit(s, { live, now: 3e6 });
      assert.ok(rec);
      assert.equal(live.active, false, 'one record per match');
      assert.equal(recordQuit(s, { live, now: 3e6 }), null);
      assert.equal(loadStats().records.length, 1);
      assert.equal(loadStats().records[0].players[0].roundsPassed, 3);
    });
  });
});

describe('local stats: following the app store', () => {
  test('installStatsRecorder watches a match from its start; a quit is recorded with its duration, then the tracker rests', () => {
    withStorage(() => {
      const first = liveState({ phase: PHASE.INFO_CHECK, round: 0 });
      const store = createStore({ me: first.me, room: first.room, match: emptyMatch() });
      const off = installStatsRecorder(store);
      try {
        assert.equal(liveMatch.active, false);
        store.patch('match', { public: first.match.public });
        assert.equal(liveMatch.active, true);
        assert.equal(liveMatch.sawStart, true);
        store.patch('match', { public: liveState({ phase: PHASE.PREP, round: 3 }).match.public });
        const rec = recordQuit(store.get());
        assert.ok(rec);
        assert.equal(rec.players[0].roundsPassed, 2);
        assert.ok(rec.durationMs >= 0);
        assert.equal(liveMatch.active, false, 'recorded once');
        // the app clears the match: still at rest; a new match is a fresh start
        store.set({ match: emptyMatch() });
        assert.equal(liveMatch.active, false);
        store.patch('match', { public: first.match.public });
        assert.equal(liveMatch.active, true);
      } finally { off(); }
    });
  });
});

describe('local stats: bounded storage', () => {
  test(`the store caps at MAX_RECORDS (${MAX_RECORDS}), dropping the oldest`, () => {
    const stats = manyRecords(MAX_RECORDS + 30);
    assert.equal(stats.records.length, MAX_RECORDS);
    assert.equal(stats.records[0].t, MAX_RECORDS + 29); // newest first
    assert.equal(stats.records.at(-1).t, 30); // oldest 30 dropped
  });

  test(`the newest ${FULL_KEEP} records keep their rows; older non-peak records compact without losing aggregates`, () => {
    withStorage((ls) => {
      assert.equal(saveStats(manyRecords(FULL_KEEP + 20)), true);
      const stored = JSON.parse(ls.raw).records;
      assert.equal(stored.length, FULL_KEEP + 20);
      assert.equal(stored.slice(0, FULL_KEEP).every((r) => !r.compact && r.players.length === 2), true);
      const old = stored.at(-1);
      assert.equal(old.compact, true);
      assert.equal(old.players.length, 1, 'no teammates');
      assert.equal(old.players[0].name, undefined, 'no names');
      assert.equal(old.players[0].lineup, undefined);
      // what the aggregates read is all still there
      const back = loadStats().records;
      assert.deepEqual(aggregateStats(back).bands, aggregateStats(manyRecords(FULL_KEEP + 20).records).bands);
      assert.equal(aggregateStats(back).sums.kills, 41 * (FULL_KEEP + 20));
      // …and the settlement of a compacted record cannot be re-viewed
      assert.equal(recordToResult(back.at(-1)), null);
      assert.ok(recordToResult(back[0]));
    });
  });

  test('compactRecord is idempotent and keeps the frame', () => {
    const rec = buildRecord(baseResult(), { myId: 'p1', now: 5 });
    const c = compactRecord(rec);
    assert.equal(JSON.stringify(compactRecord(normalizeRecord(c))), JSON.stringify(c));
    assert.equal(c.difficulty, 'HARD');
    assert.equal(c.durationMs, 952123);
    assert.equal(selfRowOf(normalizeRecord(c)).bandId, 'band_amiya');
    assert.equal(selfRowOf(normalizeRecord(c)).reward, 88, 'the settlement level sums the 卫戍认证 of every kept match');
  });

  test(`a store of ${MAX_RECORDS} real-size co-op matches fits MAX_CHARS (${MAX_CHARS}) — the oldest few go; solo matches all stay`, () => {
    // a 4-player settlement with 10-unit lineups, 12 bonds and every stat, as server/match/results.js builds it
    const row = (i) => ({
      playerId: `p${i}`, seat: i, name: `博士${i}`, isBot: i > 1, left: false, alive: true, victory: true, roundsPassed: 14, eliminatedRound: null, lp: 12,
      bandId: `band_${i}`, title: { id: 'comment_3', name: '坚若磐石', picId: 'comment_icon_3', text: '目标生命值损失最少' }, trophies: 5, reward: 425,
      lineup: Array.from({ length: 10 }, (_, k) => ({ id: `chess_char_${k}_0${i}_a`, golden: k % 2 === 0, tier: 1 + (k % 6), row: 12, col: k, items: ['chess_item_4_08_e_a', 'chess_item_4_07_e_a'] })),
      bonds: Array.from({ length: 12 }, (_, k) => ({ bondId: `bond${k}Ship`, count: 3, tier: 1, layers: 100 + k, active: true })),
      stats: { dmgDealt: 6871190, kills: 393, leaks: 21, gold: 148, refreshes: 23, merges: 3, itemsEquipped: 33, bossDamage: 945575, activatedLayers: 246, lpLost: 10, perfectRounds: 7 },
    });
    const coop = (i) => baseResult({ seed: i, modeId: 'mode_multi_hard', players: [row(1), row(2), row(3), row(4)].map((r, k) => (k === 0 ? { ...r, playerId: 'p1' } : r)) });
    const stats = manyRecords(MAX_RECORDS, coop);
    const fit = fitToBudget(stats.records);
    assert.ok(fit.length > FULL_KEEP && fit.length <= MAX_RECORDS, `kept ${fit.length}; full replays and compacted history must both remain`);
    assert.equal(fit[0].t, MAX_RECORDS - 1, 'the newest first');
    assert.ok(JSON.stringify({ v: 1, records: fit }).length <= MAX_CHARS);
    withStorage((ls) => { assert.equal(saveStats(stats), true); assert.ok(ls.raw.length <= MAX_CHARS); });
    const solo = manyRecords(MAX_RECORDS, (i) => baseResult({ seed: i, players: [baseResult().players[0]] }));
    assert.equal(fitToBudget(solo.records).length, MAX_RECORDS);
  });

  test('over the character budget the oldest records go first; the newest is always kept', () => {
    const stats = manyRecords(200);
    const fit = fitToBudget(stats.records, 60_000);
    assert.ok(fit.length < 200 && fit.length > FULL_KEEP, `kept ${fit.length}`);
    assert.equal(fit[0].t, 199);
    assert.equal(fit.at(-1).t, 200 - fit.length);
    assert.ok(JSON.stringify({ v: 1, records: fit }).length <= 60_000);
    // a budget below one record still keeps the newest
    assert.deepEqual(fitToBudget(stats.records, 10).map((r) => r.t), [199]);
  });

  test('a write the browser refuses (quota) is retried with half the history; a hopeless one reports failure instead of throwing', () => {
    const probe = JSON.stringify({ v: STATS_VERSION, records: [compactRecord(buildRecord(baseResult(), { myId: 'p1', now: 1 }))] }).length;
    withStorage({ budget: probe * 40 }, (ls) => {
      const stats = manyRecords(300);
      assert.equal(saveStats(stats), true);
      const back = JSON.parse(ls.raw).records;
      assert.ok(back.length < 300 && back.length >= 8, `shrank to ${back.length}`);
      assert.equal(back[0].t, 299, 'the newest kept');
    });
    withStorage({ budget: 10 }, () => assert.equal(saveStats(manyRecords(20)), false));
    // no localStorage at all (a locked-down browser): quiet failure
    assert.equal(saveStats(manyRecords(2)), false);
    assert.deepEqual(loadStats().records, []);
  });

  test('peekStatsRecords (the 成就统计 card of the lobby) reads without writing: a damaged or newer value stays for the page', () => {
    withStorage((ls) => {
      assert.deepEqual(peekStatsRecords(), []);
      const bad = '{"v":1,"records":[{"players":[';
      ls.setItem('sp.pref.stats', bad);
      assert.deepEqual(peekStatsRecords(), []);
      assert.equal(ls.raw, bad, 'not moved to the backup');
      assert.equal(ls.damaged, null);
      const newer = JSON.stringify({ v: STATS_VERSION + 3, records: [{ players: [{ playerId: 'x' }] }] });
      ls.setItem('sp.pref.stats', newer);
      assert.deepEqual(peekStatsRecords(), []);
      assert.equal(ls.raw, newer);
      const stored = JSON.stringify({ v: STATS_VERSION, records: [buildRecord(baseResult(), { myId: 'p1', now: 1 })] });
      ls.setItem('sp.pref.stats', stored);
      assert.equal(peekStatsRecords().length, 1);
      assert.equal(ls.raw, stored);
    });
  });

  test('every string and list of an (imported) record is bounded', () => {
    const rec = normalizeRecord({
      players: Array.from({ length: 30 }, (_, i) => ({
        playerId: `p${i}`, name: 'N'.repeat(500), bandId: 'b'.repeat(500),
        lineup: Array.from({ length: 100 }, (_, k) => ({ id: `u${k}`, items: Array(50).fill('x'.repeat(500)) })),
        bonds: Array.from({ length: 100 }, (_, k) => ({ bondId: `b${k}`, layers: 1 })),
        stats: Object.fromEntries(Array.from({ length: 200 }, (_, k) => [`stat${k}`, k])),
        bigUnknown: 'z'.repeat(1e5),
      })),
      bigUnknown: 'y'.repeat(1e6),
    });
    assert.ok(JSON.stringify(rec).length < 40_000, `${JSON.stringify(rec).length} chars`);
    assert.equal(rec.players.length, 6);
    assert.equal(rec.players[0].lineup.length, 12);
    assert.equal(rec.players[0].lineup[0].items.length, 4);
    assert.equal(rec.players[0].name.length, 24);
    assert.equal(Object.keys(rec.players[0].stats).length, 24);
    assert.equal(rec.bigUnknown, undefined);
  });
});

describe('local stats: corrupt and old storage', () => {
  test('an unversioned PR-era envelope (no `end`) normalizes with defaults as settled records and self-heals on load', () => {
    withStorage((ls) => {
      const old = { records: [{ players: [{ playerId: 'p1', stats: { kills: 2 }, futureField: { x: 1 } }], futureTop: 1 }] };
      ls.setItem('sp.pref.stats', JSON.stringify(old));
      const loaded = loadStats();
      assert.equal(loaded.v, STATS_VERSION);
      assert.equal(loaded.damaged, false);
      assert.equal(loaded.records.length, 1);
      const rec = loaded.records[0];
      assert.equal(rec.end, 'settled');
      assert.equal(countsTowardStats(rec), true);
      assert.equal(rec.victory, false);
      assert.equal(rec.roundsPassed, 0);
      assert.equal(rec.selfId, null);
      assert.equal(rec.players[0].roundsPassed, 0);
      assert.equal(rec.players[0].alive, true);
      assert.deepEqual(rec.players[0].stats, { kills: 2 });
      assert.equal(rec.players[0].futureField, undefined, 'a strict schema: unknown fields do not survive (a newer build bumps the version instead)');
      assert.equal(rec.futureTop, undefined);
      assert.match(rec.id, /^c\./, 'an id-less row gets a content id');
      const rewritten = JSON.parse(ls.raw);
      assert.equal(rewritten.v, STATS_VERSION); // self-healed back to storage
      assert.equal(rewritten.records[0].id, rec.id);
    });
  });

  test('unreadable storage (not JSON, not an envelope) is set aside as a backup and the history starts again', () => {
    for (const bad of ['{"v":1,"records":[', 'null', '[1,2,3]', '"hello"', '{"v":1}', '{"records":"nope"}']) {
      withStorage((ls) => {
        ls.setItem('sp.pref.stats', bad);
        const loaded = loadStats();
        assert.equal(loaded.damaged, true, bad);
        assert.deepEqual(loaded.records, [], bad);
        assert.equal(ls.damaged, bad, `${bad}: kept where a person can find it`);
        assert.equal(ls.raw, null);
        // and recording works again straight away
        assert.ok(recordResult(baseResult(), { myId: 'p1', now: 1 }));
        assert.equal(loadStats().records.length, 1);
        assert.equal(loadStats().damaged, false);
      });
    }
  });

  test('damaged rows are dropped and counted, the good ones kept (in order, newest first); the storage is rewritten without them', () => {
    withStorage((ls) => {
      const good = (seed, t) => ({ ...buildRecord(baseResult({ seed }), { myId: 'p1', now: t }) });
      ls.setItem('sp.pref.stats', JSON.stringify({
        v: STATS_VERSION,
        records: [good(1, 100), null, 42, 'junk', { nope: 1 }, { players: [] }, { players: [null, 3] }, good(2, 300), good(3, 200)],
      }));
      const loaded = loadStats();
      assert.deepEqual(loaded.records.map((r) => r.t), [300, 200, 100], 'sorted newest first');
      assert.equal(loaded.dropped, 6);
      assert.equal(JSON.parse(ls.raw).records.length, 3, 'self-healed');
      assert.equal(loadStats().dropped, 0);
    });
  });

  test('a record listed twice (hand-merged data) counts once', () => {
    withStorage((ls) => {
      const rec = buildRecord(baseResult(), { myId: 'p1', now: 100 });
      ls.setItem('sp.pref.stats', JSON.stringify({ v: STATS_VERSION, records: [rec, { ...rec }, rec] }));
      const loaded = loadStats();
      assert.equal(loaded.records.length, 1);
      assert.equal(loaded.dropped, 2);
      assert.equal(aggregateStats(loaded.records).count, 1);
    });
  });

  test('numbers that are not numbers, wrong types and absurd values normalize instead of crashing the page', () => {
    const rec = normalizeRecord({
      t: 'yesterday', victory: 'yes', roundsPassed: NaN, durationMs: '5', difficulty: 12, roomMode: 'both', end: 'whatever',
      players: [{ playerId: 7, seat: 'x', name: {}, alive: 'no', stats: { kills: '3', gold: NaN, dmgDealt: 5, deep: { a: 1 } }, lineup: [1, null, { id: 5 }], bonds: 'many', title: 'comment_1' }],
    });
    assert.equal(rec.end, 'settled');
    assert.equal(rec.t, 0);
    assert.equal(rec.victory, false);
    assert.equal(rec.roundsPassed, 0);
    assert.equal(rec.durationMs, null);
    assert.equal(rec.difficulty, null);
    assert.equal(rec.roomMode, null);
    const p = rec.players[0];
    assert.equal(p.playerId, '');
    assert.equal(p.alive, true);
    assert.deepEqual(p.stats, { dmgDealt: 5 });
    assert.deepEqual(p.lineup, []);
    assert.deepEqual(p.bonds, []);
    assert.equal(p.title, null);
    // and the whole page reads it
    assert.doesNotThrow(() => aggregateStats([rec]));
    assert.doesNotThrow(() => recordToResult(rec));
  });

  test('a NEWER envelope is returned untouched and flagged — nothing records over it', () => {
    withStorage((ls) => {
      const newer = JSON.stringify({ v: STATS_VERSION + 5, records: [{ players: [], brandNew: true }] });
      ls.setItem('sp.pref.stats', newer);
      const loaded = loadStats();
      assert.equal(loaded.newer, true);
      assert.equal(ls.raw, newer);
      assert.equal(recordResult(baseResult(), { myId: 'p1', now: 1 }), null, 'a result is not written over a newer build\'s data');
      assert.equal(recordQuit(liveState({ round: 3 }), { live: watched([liveState({ round: 3 })]) }), null);
      assert.equal(saveStats(loaded), false);
      assert.equal(ls.raw, newer, 'still byte for byte');
      const mig = migrateStats(JSON.parse(newer));
      assert.equal(mig.newer, true);
      assert.equal(mig.changed, false);
    });
  });

  test('a list longer than MAX_RECORDS (hand-edited, merged) is cut to the newest on load', () => {
    withStorage((ls) => {
      const recs = Array.from({ length: MAX_RECORDS + 50 }, (_, i) => buildRecord(baseResult({ seed: i }), { myId: 'p1', now: i }));
      ls.setItem('sp.pref.stats', JSON.stringify({ v: STATS_VERSION, records: recs }));
      const loaded = loadStats();
      assert.equal(loaded.records.length, MAX_RECORDS);
      assert.equal(loaded.records[0].t, MAX_RECORDS + 49);
      assert.equal(loaded.dropped, 50);
    });
  });

  test('the MIGRATIONS hook runs: v → v+1 steps apply in order (dry-run with a temporary step)', () => {
    const original = MIGRATIONS[0];
    MIGRATIONS[0] = ({ records }) => ({ v: 1, records: records.map((r) => ({ ...r, victory: true })) });
    try {
      const { stats, changed } = migrateStats({ v: 0, records: [{ players: [{ playerId: 'p1' }] }] });
      assert.equal(changed, true);
      assert.equal(stats.records[0].victory, true);
      assert.equal(stats.v, STATS_VERSION);
    } finally {
      if (original === undefined) delete MIGRATIONS[0]; else MIGRATIONS[0] = original;
    }
  });
});

describe('local stats: export / import merge', () => {
  test('an import offers the newest valid self nickname without taking a teammate or existing-history name', () => {
    const newest = buildRecord(baseResult({ seed: 3 }), { myId: 'p1', now: 3 });
    newest.players[0].name = '\u200b';
    newest.players[1].name = 'Teammate';
    const named = buildRecord(baseResult({ seed: 2 }), { myId: 'p1', now: 2 });
    named.players[0].name = '  Archive\u200bID  ';
    const older = buildRecord(baseResult({ seed: 1 }), { myId: 'p1', now: 1 });
    older.players[0].name = 'OldID';
    const existing = buildRecord(baseResult({ seed: 4 }), { myId: 'p1', now: 4 });
    existing.players[0].name = 'ExistingID';
    const incoming = { v: STATS_VERSION, records: [older, newest, named] };
    assert.equal(importStats(incoming, { records: [existing] }).name, 'ArchiveID');
    assert.equal(importStats(incoming, { records: [existing, newest, named, older] }).name, 'ArchiveID', 'duplicate imports can also recover an unknown ID');
    assert.equal(importStats({ v: STATS_VERSION, records: [compactRecord(named), newest] }, { records: [existing] }).name, '', 'no usable imported self name stays unknown');
    assert.equal(importStats({ v: STATS_VERSION, records: [] }, { records: [existing] }).name, '');
  });

  test('export → import round-trips; merge unions by id, newest first, and counts added / skipped', () => {
    withStorage(() => {
      const rec = recordResult(baseResult(), { myId: 'p1', now: 1000 });
      const exported = exportStats(loadStats());
      assert.equal(exported.kind, 'local-stats');
      assert.equal(exported.records.length, 1);
      assert.equal(exported.records[0].id, rec.id);

      // importing into the SAME store: everything is a duplicate
      const same = importStats(exported, loadStats());
      assert.equal(same.added, 0);
      assert.equal(same.skipped, 1);
      assert.equal(same.stats.records.length, 1);

      // a second device's store (one shared + one newer record) merges by id
      const theirs = exportStats({ records: [buildRecord(baseResult({ seed: 777 }), { myId: 'p1', now: 5000 }), rec] });
      const merged = importStats(JSON.parse(JSON.stringify(theirs)), loadStats());
      assert.equal(merged.added, 1);
      assert.equal(merged.skipped, 1);
      assert.equal(merged.stats.records.length, 2);
      assert.equal(merged.stats.records[0].t, 5000, 'newest first: the history list shows the latest matches at the top');
      saveStats(merged.stats);
      assert.deepEqual(loadStats().records.map((r) => r.t), [5000, 1000]);
      // a match recorded after the import goes on top, and the cap would drop the oldest, not the newest
      recordResult(baseResult({ seed: 5 }), { myId: 'p1', now: 9000 });
      assert.deepEqual(loadStats().records.map((r) => r.t), [9000, 5000, 1000]);
    });
  });

  test('an import over the cap keeps the newest MAX_RECORDS', () => {
    const a = manyRecords(MAX_RECORDS);
    const b = { v: 1, kind: 'local-stats', records: Array.from({ length: 40 }, (_, i) => buildRecord(baseResult({ seed: 5000 + i }), { myId: 'p1', now: 10_000 + i })) };
    const out = importStats(JSON.parse(JSON.stringify(b)), a);
    assert.equal(out.added, 40);
    assert.equal(out.stats.records.length, MAX_RECORDS);
    assert.equal(out.stats.records[0].t, 10_039);
  });

  test('importing a NEWER export, another tool\'s file or junk is refused with a code, nothing is merged', () => {
    assert.throws(() => importStats({ v: STATS_VERSION + 1, records: [] }, emptyStats()), (e) => e.code === 'stats-newer-version');
    assert.throws(() => importStats({ kind: 'stronghold.loadout', v: 1, records: [] }, emptyStats()), (e) => e.code === 'stats-bad-file');
    for (const junk of [{ hello: 'world' }, [], 'text', 42, null]) {
      assert.throws(() => importStats(junk, emptyStats()), (e) => e.code === 'stats-bad-file', JSON.stringify(junk));
    }
  });

  test('rows of an import that cannot be read are dropped and reported; the rest merge', () => {
    const out = importStats({ kind: 'local-stats', v: 1, records: [buildRecord(baseResult(), { myId: 'p1', now: 1 }), null, { players: [] }, 'x'] }, emptyStats());
    assert.equal(out.added, 1);
    assert.equal(out.dropped, 3);
    assert.equal(out.stats.records.length, 1);
  });
});

describe('local stats: aggregation (what the page renders)', () => {
  const records = [
    buildRecord(baseResult(), { myId: 'p1', roomMode: 'solo', now: 1000 }),
    buildRecord(baseResult({ victory: false, roundsPassed: 8, hiddenReached: false, hiddenCleared: false, difficulty: 'NORMAL', modeId: 'mode_multi_normal', durationMs: 300000, seed: 2,
      players: [
        { ...baseResult().players[0], alive: true, victory: false, roundsPassed: 8, title: null, stats: { kills: 10, gold: 200 } },
        baseResult().players[1],
      ] }), { myId: 'p1', roomMode: 'coop', now: 2000 }),
  ];
  const agg = aggregateStats(records);

  test('totals, wins (per-row victory), rounds and duration', () => {
    assert.equal(agg.count, 2);
    assert.equal(agg.total, 2);
    assert.equal(agg.excluded, 0);
    assert.equal(agg.wins, 1); // game 2 was a loss
    assert.equal(agg.rounds.max, 16, 'the player\'s own rounds (the settlement prints them per player)');
    assert.equal(agg.rounds.total, 16 + 8);
    assert.equal(agg.duration.totalMs, 952123 + 300000);
    assert.equal(agg.hidden.reached, 1);
    assert.equal(agg.hidden.cleared, 1);
    assert.equal(agg.byMode.solo.games, 1);
    assert.equal(agg.byMode.coop.games, 1);
  });

  test('per-difficulty rows; an unknown difficulty is keyed UNKNOWN (never a translated text)', () => {
    assert.deepEqual(agg.byDifficulty.HARD, { games: 1, wins: 1, hiddenCleared: 1 });
    assert.deepEqual(agg.byDifficulty.NORMAL, { games: 1, wins: 0, hiddenCleared: 0 });
    const odd = aggregateStats([normalizeRecord({ players: [{ playerId: 'p1' }] })]);
    assert.deepEqual(Object.keys(odd.byDifficulty), ['UNKNOWN']);
  });

  test('per-band games / passed and self titles', () => {
    assert.deepEqual(agg.bands.band_amiya, { games: 2, wins: 1 });
    assert.equal(agg.titles.comment_1.count, 1); // only the win granted 卫戍之星
  });

  test('alliance usage counts self active settlement bonds once per match, independent of layers', () => {
    const first = buildRecord(baseResult({ players: [
      { ...baseResult().players[0], bonds: [
        { bondId: 'yanShip', active: true, layers: 0 }, { bondId: 'yanShip', active: true, layers: 999 },
        { bondId: 'steadShip', active: false, layers: 500 }, { bondId: 'soloShip', active: true, layers: 0 },
      ] }, { ...baseResult().players[1], bonds: [{ bondId: 'egirShip', active: true, layers: 999 }] },
    ] }), { myId: 'p1', now: 1 });
    const second = buildRecord(baseResult({ seed: 2, victory: false, players: [{ ...baseResult().players[0], victory: false,
      bonds: [{ bondId: 'yanShip', active: true, layers: 1 }, { bondId: 'steadShip', active: true, layers: 10 }],
    }] }), { myId: 'p1', now: 2 });
    const quit = { ...first, id: 'quit', end: 'quit' };
    assert.deepEqual({ ...aggregateStats([first, second, quit]).bonds }, {
      yanShip: { games: 2 }, soloShip: { games: 1 }, steadShip: { games: 1 },
    });
  });

  test('active alliance usage survives compaction and transfer; v2 rows with discarded bonds stay unknown', () => {
    const full = buildRecord(baseResult(), { myId: 'p1', now: 1 });
    const compact = compactRecord(full);
    assert.deepEqual(compact.players[0].usedBondIds, ['steadShip']);
    assert.equal(compact.players[0].bonds, undefined, 'the replay-only bond details are still discarded');
    const transferred = importStats(exportStats({ v: STATS_VERSION, records: [compact] }), emptyStats());
    assert.deepEqual({ ...aggregateStats(transferred.stats.records).bonds }, { steadShip: { games: 1 } });
    const legacy = { ...compact, id: 'old', players: [{ ...compact.players[0], usedBondIds: undefined }] };
    const migrated = migrateStats({ v: 2, records: [full, legacy] });
    assert.equal(migrated.stats.v, STATS_VERSION);
    assert.deepEqual({ ...aggregateStats(migrated.stats.records).bonds }, { steadShip: { games: 1 } });
  });

  test('mode rows separate successful defense from hidden-core clears and use the player outcome', () => {
    const solo = buildRecord(baseResult({ hiddenCleared: false }), { myId: 'p1', roomMode: 'solo', now: 1 });
    const coop = buildRecord(baseResult(), { myId: 'p1', roomMode: 'coop', now: 2 });
    const eliminated = buildRecord(baseResult(), { myId: 'p2', roomMode: 'coop', now: 3 });
    const summary = aggregateStats([solo, coop, eliminated]);
    assert.deepEqual(summary.byMode.solo, { games: 1, wins: 1, hiddenCleared: 0 }, 'failing the hidden core keeps the final-boss win');
    assert.deepEqual(summary.byMode.coop, { games: 2, wins: 1, hiddenCleared: 1 }, 'an eliminated teammate gets neither a personal clear nor a breakthrough');
    assert.deepEqual(aggregateStats([]).byMode, {
      solo: { games: 0, wins: 0, hiddenCleared: 0 }, coop: { games: 0, wins: 0, hiddenCleared: 0 },
    });
  });

  test('trophy totals count self settled co-op awards, including defeats, and survive compaction and transfer', () => {
    const records = [['coop', 5, true, 'match'], ['coop', 2, false, 'match'], ['solo', 999, true, 'match'], ['coop', 999, false, 'quit']].map(([mode, award, won, end], i) => {
      const rec = buildRecord(baseResult({ seed: i + 1, victory: won, modeId: mode === 'coop' ? 'mode_multi_hard' : 'mode_single_hard',
        players: [{ ...baseResult().players[0], trophies: award, victory: won }, { ...baseResult().players[1], trophies: 999 }],
      }), { myId: 'p1', roomMode: mode, now: i + 1 });
      rec.end = end;
      return rec;
    });
    assert.equal(aggregateStats(records).trophies, 7, 'solo, quit and teammate awards must not inflate the total');
    const compacted = records.map(compactRecord);
    const transferred = importStats(exportStats({ v: STATS_VERSION, records: compacted }), emptyStats());
    assert.equal(aggregateStats(transferred.stats.records).trophies, 7, 'discarding replay details and exporting must retain actual rewards');
  });

  test('trophy medals choose the highest eligible configured threshold regardless of row order', () => {
    const medals = [{ count: 20, iconId: 'high' }, { count: 0, iconId: 'base' }, { count: 5, iconId: 'mid' }];
    assert.equal(trophyMedalOf(4, medals).iconId, 'base');
    assert.equal(trophyMedalOf(5, medals).iconId, 'mid');
    assert.equal(trophyMedalOf(19, medals).iconId, 'mid');
    assert.equal(trophyMedalOf(20, medals).iconId, 'high');
    assert.equal(trophyMedalOf(100, medals).iconId, 'high');
    assert.equal(trophyMedalOf(0, null), null);
  });

  test('combat sums over the self player only', () => {
    assert.equal(agg.sums.kills, 41 + 10);
    assert.equal(agg.sums.gold, 880 + 200);
    assert.equal(agg.sums.leaks, 2); // game 2's self row has no leaks → skipped, not NaN
  });

  test('selfRowOf fallbacks: selfId, else first human, else first row; anonymous record → null', () => {
    assert.equal(selfRowOf(records[0]).playerId, 'p1');
    const noSelf = normalizeRecord({ players: [{ playerId: 'a', isBot: true }, { playerId: 'b', isBot: false }] });
    assert.equal(selfRowOf(noSelf).playerId, 'b');
    assert.equal(selfRowOf({ players: [] }), null);
  });

  test('an empty list aggregates to zeros', () => {
    const e = aggregateStats([]);
    assert.equal(e.count, 0);
    assert.equal(e.rounds.max, 0);
    assert.deepEqual(e.byDifficulty, {});
    assert.equal(aggregateStats(null).total, 0);
  });
});

describe('local stats: recordToResult (history row → settlement re-view)', () => {
  test('record → m.result payload → normalizeResult renders the same settlement the live push did', () => {
    const rec = buildRecord(baseResult(), { myId: 'p1', roomMode: 'solo', now: 1000 });
    const res = recordToResult(rec);
    assert.ok(res);
    const view = normalizeResult(res, null);
    assert.equal(view.victory, true);
    assert.equal(view.difficulty, 'HARD');
    assert.equal(view.modeId, 'mode_single_hard');
    assert.equal(view.roundsPassed, 15);
    assert.equal(view.hiddenReached, true);
    assert.equal(view.hiddenCleared, true);
    assert.equal(view.durationMs, 952123);
    assert.equal(view.players.length, 2);
    const self = view.players.find((p) => p.playerId === 'p1');
    assert.equal(self.bandId, 'band_amiya');
    assert.equal(self.title.id, 'comment_1');
    assert.equal(self.stats.kills, 41);
    assert.equal(self.stats.bossDamage, 5000.5);
    assert.equal(self.lineup[0].id, 'char_290_vigna');
    assert.equal(self.lineup[0].golden, false);
    const mate = view.players.find((p) => p.playerId === 'p2');
    assert.equal(mate.alive, false);
    assert.equal(mate.roundsPassed, 9);
  });

  test('a null lastRound is passed through as absent (normalizeResult defaults it); garbage → null', () => {
    const rec = buildRecord(baseResult({ lastRound: undefined }), { myId: 'p1', now: 1 });
    assert.equal('lastRound' in recordToResult(rec), false);
    assert.equal(recordToResult(null), null);
    assert.equal(recordToResult({ players: [] }), null);
  });
});

describe('local stats: official versions (DESIGN §35.23, format v3)', () => {
  test('a record names another version (only a non-default one); its id does not include it; an unknown id is dropped', () => {
    const plain = buildRecord(baseResult(), { myId: 'p1', now: 1 });
    const v1 = buildRecord(baseResult(), { myId: 'p1', now: 1, version: 'act1autochess' });
    assert.equal('version' in plain, false, '第二期下半: no field');
    assert.equal(v1.version, 'act1autochess');
    assert.equal(v1.id, plain.id, 'the id stays what it was');
    assert.equal('version' in buildRecord(baseResult(), { myId: 'p1', now: 1, version: 'act2autochess' }), false);
    assert.equal('version' in normalizeRecord({ ...v1, version: 'act9autochess' }), false, 'not a registry id');
    assert.equal(compactRecord(v1).version, 'act1autochess', 'kept in the compact form');
    // an id-less record's content id leaves the version out too
    const { id, ...anon } = v1;
    assert.equal(normalizeRecord(anon).id, normalizeRecord({ ...anon, version: undefined }).id);
  });

  test('v2 → v3: nothing rewritten (a record without a version played 第二期下半); a quit record names the room\'s version', () => {
    assert.equal(STATS_VERSION, 3);
    assert.equal(typeof MIGRATIONS[2], 'function');
    const v2 = { v: 2, records: [buildRecord(baseResult(), { myId: 'p1', now: 5 })] };
    const { stats, changed } = migrateStats(v2);
    assert.equal(changed, true);
    assert.equal(stats.v, 3);
    assert.equal('version' in stats.records[0], false);
    const live = createLiveMatch();
    const state = { me: { playerId: 'p1' }, room: { code: 'A', mode: 'solo', version: 'act1autochess@V1_1' },
      match: { ...emptyMatch(), public: { phase: PHASE.PREP, round: 3, modeId: 'mode_single_funny', players: [{ playerId: 'p1', seat: 0, alive: true }] } } };
    observeMatch(live, state, 10);
    assert.equal(buildQuitRecord(state, { live, now: 20 }).version, 'act1autochess@V1_1');
  });

  test('per version and per season: recordsOfVersion / recordsOfSeason; the levels count one season', async () => {
    const { recordsOfVersion, recordsOfSeason, recordVersion } = await import('../../public/js/ui/stats.js');
    const { levelProgress } = await import('../../public/js/screens/settle.js');
    const mk = (t, version) => buildRecord(baseResult({ players: [{ ...baseResult().players[0], reward: 100 }] }), { myId: 'p1', now: t, version });
    const recs = [mk(1, null), mk(2, 'act1autochess'), mk(3, 'act1autochess@V1_1'), mk(4, 'act2autochess@V2_1')].map((r, i) => ({ ...r, id: `r${i}` }));
    assert.deepEqual(recs.map(recordVersion), ['act2autochess', 'act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1']);
    assert.deepEqual(recordsOfVersion(recs, 'act1autochess').map((r) => r.id), ['r1']);
    assert.deepEqual(recordsOfVersion(recs, 'act2autochess').map((r) => r.id), ['r0']);
    assert.equal(recordsOfVersion(recs, 'all').length, 4);
    assert.deepEqual(recordsOfSeason(recs, 'act1autochess').map((r) => r.id), ['r1', 'r2'], '第一期: both sub-versions');
    assert.deepEqual(recordsOfSeason(recs, 'act2autochess').map((r) => r.id), ['r0', 'r3']);
    assert.equal(aggregateStats(recordsOfVersion(recs, 'act1autochess')).count, 1);
    const at = 10;
    assert.equal(levelProgress(recs, { counted: false, at }).before, 400, 'no season: every record');
    assert.equal(levelProgress(recs, { counted: false, at, season: 'act1autochess' }).before, 200, '第一期\'s levels');
    assert.equal(levelProgress(recs, { counted: false, at, season: 'act2autochess' }).before, 200);
  });
});
