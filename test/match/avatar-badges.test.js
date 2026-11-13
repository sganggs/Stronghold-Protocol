// 完美连胜 / 领袖伤害 (DESIGN §37.148), every version: the streak counted at every settlement (0 after an LP loss) and
// published from the first of gd.winStreakThresholds; the leader-damage level live from the pool while a leader fight
// runs (gd.bossDamageThresholds, the player's share of the pool's max HP), gone with the pool; eliminated players carry
// neither. Client side: test/ui/avatar-badges.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { makeMatch } from './harness.js';
import { levelOf } from '../../server/match/match/views.js';
import { GameData, AVATAR_WIN_STREAK, AVATAR_BOSS_DAMAGE } from '../../server/match/gamedata.js';

const act3 = getVersionData('act3autochess@V3_1');
const CLEAN = { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 1, damageDealt: 10 };
const LEAKY = { leaked: [{ counted: true }], perfect: false, coins: 0, layerGains: {}, killed: 1, damageDealt: 10 };

/** One settlement with these results (CLEAN for everyone not named). */
function settleRound(m, results = {}) {
  for (const ps of m.alivePlayers()) m.lastResults.set(ps.playerId, results[ps.playerId] || CLEAN);
  m.settle(null, null);
}
const pubOf = (m, pid) => m.publicView().players.find((p) => p.playerId === pid);
const badges = (p) => ({ winStreak: p.winStreak, winStreakLevel: p.winStreakLevel, bossDamageLevel: p.bossDamageLevel });

test('levelOf counts the thresholds reached', () => {
  assert.equal(levelOf(0, [3, 5]), 0);
  assert.equal(levelOf(2, [3, 5]), 0);
  assert.equal(levelOf(3, [3, 5]), 1);
  assert.equal(levelOf(4, [3, 5]), 1);
  assert.equal(levelOf(5, [3, 5]), 2);
  assert.equal(levelOf(13, [3, 5]), 2);
  assert.equal(levelOf(0.19, [0.2, 0.5, 0.8]), 0);
  assert.equal(levelOf(0.2, [0.2, 0.5, 0.8]), 1);
  assert.equal(levelOf(0.5, [0.2, 0.5, 0.8]), 2);
  assert.equal(levelOf(0.81, [0.2, 0.5, 0.8]), 3);
});

test('the thresholds: 规程 constData values by default, a valid config list overrides, a bad one falls back', () => {
  assert.deepEqual([...AVATAR_WIN_STREAK], [3, 5]);
  assert.deepEqual([...AVATAR_BOSS_DAMAGE], [0.2, 0.5, 0.8]);
  const streakOf = Object.getOwnPropertyDescriptor(GameData.prototype, 'winStreakThresholds').get;
  const damageOf = Object.getOwnPropertyDescriptor(GameData.prototype, 'bossDamageThresholds').get;
  const gd = (constants) => ({ config: { constants } });
  assert.deepEqual(streakOf.call(gd(undefined)), [3, 5]);
  assert.deepEqual(streakOf.call(gd({ playerAvatarWinStreakThresholds: [2, 4] })), [2, 4]);
  assert.deepEqual(streakOf.call(gd({ playerAvatarWinStreakThresholds: [5, 3] })), [3, 5], 'not ascending');
  assert.deepEqual(streakOf.call(gd({ playerAvatarWinStreakThresholds: [] })), [3, 5], 'empty');
  assert.deepEqual(streakOf.call(gd({ playerAvatarWinStreakThresholds: [0, 3] })), [3, 5], 'not positive');
  assert.deepEqual(damageOf.call(gd({})), [0.2, 0.5, 0.8]);
  assert.deepEqual(damageOf.call(gd({ playerAvatarBossDamageThresholds: [0.3, 0.6] })), [0.3, 0.6]);
  assert.deepEqual(damageOf.call(gd({ playerAvatarBossDamageThresholds: 'x' })), [0.2, 0.5, 0.8]);
});

for (const [label, data] of [['盟约 (default data)', undefined], ['规程', act3]]) {
  test(`${label}: the streak grows at every clean settlement, a loss resets it; shown from 3, level 2 from 5`, () => {
    const h = makeMatch({ humans: 2, fake: true, ...(data ? { data, modeId: 'mode_multi_hard', difficulty: 'HARD' } : {}) }).start();
    h.toPrep(1, data ? { band: 'band_amiya' } : {});
    const m = h.m;
    try {
      const [a, b] = m.order.map((ps) => ps.playerId);
      const streak = (pid) => m.players.get(pid).stats.perfectStreak;
      settleRound(m);
      settleRound(m);
      assert.equal(streak(a), 2);
      assert.deepEqual(badges(pubOf(m, a)), { winStreak: undefined, winStreakLevel: undefined, bossDamageLevel: undefined }, 'below 3: no field');
      assert.equal(Object.hasOwn(pubOf(m, a), 'winStreak'), false);
      settleRound(m);
      assert.deepEqual(badges(pubOf(m, a)), { winStreak: 3, winStreakLevel: 1, bossDamageLevel: undefined });
      settleRound(m, { [b]: LEAKY });
      assert.equal(streak(b), 0, 'a round that cost LP resets the streak');
      assert.equal(Object.hasOwn(pubOf(m, b), 'winStreak'), false);
      assert.deepEqual(badges(pubOf(m, a)), { winStreak: 4, winStreakLevel: 1, bossDamageLevel: undefined });
      settleRound(m);
      assert.deepEqual(badges(pubOf(m, a)), { winStreak: 5, winStreakLevel: 2, bossDamageLevel: undefined });
      settleRound(m);
      assert.deepEqual(badges(pubOf(m, a)), { winStreak: 6, winStreakLevel: 2, bossDamageLevel: undefined }, 'the count goes on');
      // a leaked enemy that cost nothing (not counted: lifePointReduce 0) keeps the streak
      settleRound(m, { [a]: { ...CLEAN, leaked: [{ counted: false }], perfect: true } });
      assert.equal(streak(a), 7);
      // eliminated: no badges
      m.players.get(a).eliminate(m.round);
      assert.equal(Object.hasOwn(pubOf(m, a), 'winStreak'), false);
    } finally { m.dispose(); }
  });
}

function openBoss(h, hidden, data) {
  const m = h.m;
  const ids = Object.keys((data || m.gd.raw).bosses || {});
  m.round = hidden ? m.gd.hiddenRound || 15 : 14;
  m.teamLp = 50;
  m.bossId = ids.includes('boss_1') ? 'boss_1' : ids[0];
  m.hiddenBossId = ids.includes('boss_9') ? 'boss_9' : ids[Math.min(1, ids.length - 1)];
  m._planBossWaves();
  m.startFinalAssault(!!hidden);
  return m;
}

for (const [label, data] of [['盟约 (default data)', undefined], ['规程', act3]]) {
  test(`${label}: the leader-damage level follows the player's share of the pool live, and goes with the pool`, () => {
    const h = makeMatch({
      humans: 4, difficulty: 'HARD', clientCombat: true, fake: true, instant: false, clients: false,
      ...(data ? { data, modeId: 'mode_multi_hard' } : {}),
    }).start();
    h.toPrep(1, data ? { band: 'band_amiya' } : {});
    const m = openBoss(h, false, data);
    try {
      const pool = m.bossPool;
      assert.ok(pool && pool.maxHp > 0);
      const [a, b] = m.order.map((ps) => ps.playerId);
      assert.equal(Object.hasOwn(pubOf(m, a), 'bossDamageLevel'), false, 'no damage yet');
      pool.damage(a, pool.maxHp * 0.19);
      assert.equal(pubOf(m, a).bossDamageLevel, undefined, '19 %: below the first step');
      pool.damage(a, pool.maxHp * 0.01);
      assert.equal(pubOf(m, a).bossDamageLevel, 1, '20 %');
      pool.damage(a, pool.maxHp * 0.3);
      assert.equal(pubOf(m, a).bossDamageLevel, 2, '50 %');
      pool.damage(b, pool.maxHp * 0.1);
      assert.equal(pubOf(m, b).bossDamageLevel, undefined, 'a teammate at 10 %');
      pool.damage(a, pool.maxHp * 0.3);
      assert.equal(pubOf(m, a).bossDamageLevel, 3, '80 %');
      m.bossPool = null;
      assert.equal(Object.hasOwn(pubOf(m, a), 'bossDamageLevel'), false, 'gone with the pool (the prep after the fight)');
    } finally { m.dispose(); }
  });
}
