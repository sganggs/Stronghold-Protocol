// The settlement flow's own facts (screens/settle.js): the level settlement against the official 60 levels of
// cumulative 卫戍认证 (config.rewards.milestones, act2autochess milestoneList) and the 每日防卫目标 bonus
// (config.rewards.daily, dailyMission*), counted from this device's records — official settled matches only — plus the
// small helpers of the cards (elite level by tier, the ace, time and date). The pages themselves: test/ui/mock.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const S = await import('../../public/js/screens/settle.js');
const REWARDS = JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8')).rewards;
const MS = REWARDS.milestones;
const DAILY = REWARDS.daily;
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

/** A stored record (ui/stats.js shape) whose own row earned `reward` over `rounds`. */
const rec = (id, t, { reward = 0, rounds = 0, trophies = 0, end = 'settled', content = undefined } = {}) => ({
  id, t, end, selfId: 'me', ...(content ? { content } : {}),
  players: [{ playerId: 'me', seat: 0, roundsPassed: rounds, reward, trophies }, { playerId: 'mate', seat: 1, roundsPassed: rounds, reward: 999, trophies: 9 }],
});

test('the data: 60 cumulative levels and the daily goal from the official tables', () => {
  assert.equal(MS.length, 60);
  assert.deepEqual(MS.slice(0, 3), [{ level: 1, tokens: 100 }, { level: 2, tokens: 200 }, { level: 3, tokens: 350 }]);
  assert.equal(MS.at(-1).level, 60);
  assert.ok(MS.every((m, i) => i === 0 || m.tokens > MS[i - 1].tokens), 'cumulative: rising');
  assert.equal(DAILY.name, '每日防卫目标');
  assert.deepEqual([DAILY.need, DAILY.bonus, DAILY.resetHour], [200, 300, 4]);
});

test('levelOf: the levels reached and the progress into the next, MAX past the last', () => {
  assert.deepEqual(S.levelOf(0, MS), { lv: 0, into: 0, need: 100, max: false });
  assert.deepEqual(S.levelOf(99, MS), { lv: 0, into: 99, need: 100, max: false });
  assert.deepEqual(S.levelOf(100, MS), { lv: 1, into: 0, need: 100, max: false });
  assert.deepEqual(S.levelOf(425, MS), { lv: 3, into: 75, need: 150, max: false });
  assert.deepEqual(S.levelOf(MS.at(-1).tokens, MS), { lv: 60, into: 0, need: 0, max: true });
  assert.equal(S.levelOf(1e9, MS).lv, 60);
  assert.equal(S.levelOf(-5, MS).lv, 0, 'a broken total counts as none');
});

test('daily points by rounds passed, and the day turning over at 04:00 local time', () => {
  assert.equal(S.dailyPointsFor(0, REWARDS.baseByRoundsPassed), 0);
  assert.equal(S.dailyPointsFor(11, REWARDS.baseByRoundsPassed), 120);
  assert.equal(S.dailyPointsFor(14, REWARDS.baseByRoundsPassed), 200);
  assert.equal(S.dailyPointsFor(15, REWARDS.baseByRoundsPassed), 200, 'the Hidden Core round keeps the last row');
  assert.equal(S.dayKey(at(16, 3, 59)), S.dayKey(at(15, 12)), 'before 04:00: still the day before');
  assert.notEqual(S.dayKey(at(16, 4)), S.dayKey(at(16, 3, 59)));
});

test('levelProgress: official settled matches before this one, each day\'s bonus once, this match\'s gain and bonus', () => {
  const now = at(16, 20);
  const records = [
    rec('old-a', at(14, 10), { reward: 200, rounds: 14 }), // a full day: 200 points → the bonus that day
    rec('old-b', at(14, 11), { reward: 50, rounds: 5 }), // the same day: no second bonus
    rec('today', at(16, 9), { reward: 100, rounds: 10 }), // today: 100 of 200 points
    rec('modded', at(16, 10), { reward: 500, rounds: 14, content: { cs: 'x', plugins: [] } }), // gameplay plugins: nothing
    rec('quit', at(16, 11), { reward: 0, rounds: 3, end: 'quit' }), // no settlement: nothing
    rec('own', now, { reward: 425, rounds: 14 }), // this match's own record (already stored)
    rec('later', at(17, 9), { reward: 80, rounds: 8 }), // after this match
  ];
  const p = S.levelProgress(records, { id: 'own', gain: 425, rounds: 14, trophies: 5, at: now, rewards: REWARDS });
  assert.equal(p.before, 200 + 50 + 100 + 300, 'the rewards and the one bonus of the 14th');
  assert.equal(p.gain, 425);
  assert.equal(p.bonus, 300, 'today reaches 200 with this match: the bonus now');
  assert.equal(p.after, p.before + 425 + 300);
  assert.deepEqual(p.daily, { name: '每日防卫目标', need: 200, today: 200 });
  assert.equal(p.trophies, 5, 'my trophies so far (the records\' rows hold none here) and this match\'s');
  // the goal reached already today: no second bonus
  const again = S.levelProgress([...records, rec('today-2', at(16, 12), { reward: 200, rounds: 14 })],
    { id: 'own', gain: 425, rounds: 14, at: now, rewards: REWARDS });
  assert.equal(again.bonus, 0);
  assert.equal(again.before, p.before + 200 + 300, 'today\'s earlier full match earned the day\'s bonus');
});

test('levelProgress: a match with gameplay plugins earns nothing and leaves the daily goal', () => {
  const now = at(16, 20);
  const p = S.levelProgress([rec('a', at(16, 9), { reward: 100, rounds: 10 })], { id: 'own', gain: 425, rounds: 14, trophies: 5, at: now, counted: false, rewards: REWARDS });
  assert.deepEqual([p.gain, p.bonus, p.before, p.after, p.counted], [0, 0, 100, 100, false]);
  assert.equal(p.daily.today, 100);
  assert.equal(p.trophies, 0);
});

test('levelProgress: a record marked test (0.3.1 测试 mode) counts toward neither the level nor the daily goal', () => {
  const now = at(16, 20);
  const p = S.levelProgress([rec('a', at(16, 9), { reward: 100, rounds: 10 }), { ...rec('b', at(16, 10), { reward: 900, rounds: 14 }), test: true }],
    { id: 'own', gain: 0, rounds: 0, at: now, rewards: REWARDS });
  assert.equal(p.before, 100, 'the test record adds no 卫戍认证 (and does not complete the daily goal)');
  assert.equal(p.daily.today, 100, 'nor daily points');
});

test('the result flow marks a 测试 match on both pages and counts it toward nothing', () => {
  const src = readFileSync(new URL('../../public/js/screens/settle.js', import.meta.url), 'utf8');
  assert.match(src, /<\$\{SettleTestMark\} res=\$\{res\} \/><\/div>/, 'the personal report');
  assert.match(src, /steam__tags[^\n]*<\$\{SettleTestMark\} res=\$\{res\} \/>/, 'the alliance page');
  assert.match(src, /counted: !isTest && !isModdedRoom/);
});

test('levelProgress without the data\'s rewards: the rewards only, no daily goal', () => {
  const p = S.levelProgress([rec('a', 1, { reward: 30 })], { id: 'own', gain: 10, at: 2 });
  assert.deepEqual([p.before, p.after, p.bonus, p.daily], [30, 40, 0, null]);
});

test('the card helpers: elite level by tier, the ace, time and date, a row\'s own outcome', () => {
  assert.deepEqual(S.opLevel(1, false), { phase: 1, level: 55 });
  assert.deepEqual(S.opLevel(2, true), { phase: 2, level: 55 });
  assert.deepEqual(S.opLevel(5, false), { phase: 2, level: 1 });
  assert.deepEqual(S.opLevel(6, true), { phase: 2, level: 60 });
  const lineup = [{ id: 'a', tier: 4 }, { id: 'b', tier: 5 }, { id: 'c', tier: 5, golden: true }, { id: 't', tier: 6, kind: 'token' }];
  assert.equal(S.aceOf(lineup).id, 'c', 'the highest tier, elite first; a token never');
  assert.equal(S.aceOf([]), null);
  assert.equal(S.fmtDuration(52 * 60000), '00时52分00秒');
  assert.equal(S.fmtDuration(3723000), '01时02分03秒');
  assert.equal(S.fmtDuration(null), '—');
  assert.equal(S.fmtDate(at(16, 7, 5)), '2026/10/16 07:05');
  assert.equal(S.fmtDate('nope'), '—');
  assert.equal(S.rowCleared({ victory: false }, { alive: true }, true), false, 'the server\'s per-row outcome first');
  assert.equal(S.rowCleared(null, { alive: true }, true), true);
  assert.equal(S.rowCleared(null, { alive: false }, true), false);
  assert.equal(S.rowCleared(null, { left: true }, true), false);
});

test('the stylesheet keeps to the project\'s rules', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/screens/settle.css'), 'utf8');
  assert.doesNotMatch(css, /!important/);
  assert.doesNotMatch(css, /:has\(/);
  assert.doesNotMatch(css, /--t\s*:/, 'the text size setting (--t) is followed, not reset');
  const js = readFileSync(path.join(ROOT, 'public/js/screens/settle.js'), 'utf8');
  assert.equal(js.match(/data-ui-slot="result\.tab"/g)?.length, 1, 'one 结算 tab plugin slot (the team page); the detail view drops its own');
  assert.match(js, /slot=\$\{false\}/);
});
