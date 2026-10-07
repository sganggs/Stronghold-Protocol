// test/match/hud-capsule-resolved.test.js — the HUD capsule's server half (PR #157): m.public.fields[].progress carries
// the field's own `resolved` (knocked out + leaked among the enemies the round scheduled), and
//   * a bot / server-run field has no authority reporting b.progress — its capsule must read the battle's own counters
//     (`timelineSample` → Battle.resolved), not the report-driven `progress.leaks`, which stays 0 forever (maintainer
//     review point ①);
//   * `progress.resolved` starts at **null**, never 0: only a real reported number is adopted, so the client's
//     `resolved ?? killed` fallback keeps working (a `Number(null) === 0` would defeat it) — and a reported 0 is a real
//     value, told apart from "not reported" (review point ②).
// Run: node --test test/match/hud-capsule-resolved.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';
import { timelineSample, timelineAt } from '../../server/match/fields.js';
import { battleProgress } from '../../server/sim/spec.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { teammateProgress } from '../../public/js/battle/observe.js';

const fields = (h) => h.m.fields;
const progressOf = (m, fieldId) => (m.publicView().fields.find((f) => f.fieldId === fieldId) || {}).progress;

test('① 机器人战场 (mode server, 无上报): 胶囊读该战斗自己的计数器，不是停在 0 的 progress.leaks', () => {
  // no FakeBattle: the bot's field runs the real sim on the server (HeadlessJob + timeline), and nobody reports b.progress
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7, instant: false, clientCombat: true, clients: false }).start();
  const m = h.m;
  h.toPrep(1);
  m.handle('p_0', { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT);
  const f = fields(h).find((x) => x.fieldId === 'n:ai_0');
  assert.equal(f.mode, 'server', 'the bot field runs on the server');
  assert.equal(f.authority, null, 'no authority ever reports it');
  assert.ok(f.timeline && f.timeline.length > 1, 'it has a progress timeline');
  assert.equal(f.progress.leaks, 0, 'nothing was reported: progress.leaks stays 0');
  assert.equal(f.progress.resolved, null, 'and progress.resolved stays null (never a fabricated 0)');

  let filled = 0;
  for (let i = 0; i < 20 && !f.done; i++) {
    h.sched.advance(2000);
    const pr = progressOf(m, 'n:ai_0');
    // the capsule reads the battle's own counters, sampled on the field clock
    assert.equal(pr.resolved, timelineAt(f.timeline, m._fieldElapsed(f))[3], 'resolved = the timeline sample');
    assert.ok(pr.resolved != null && pr.resolved <= pr.total, 'a real number, never above the denominator');
    if (pr.resolved > 0) { filled = pr.resolved; break; }
  }
  assert.ok(filled > 0, 'the bot field\'s capsule fills up (a report-driven number would have stayed at 0)');
  // the sample is composed of the battle's own two counters — the field's own scheduled enemies that were resolved
  assert.equal(timelineSample(f.battle)[3], Math.min(f.battle.total, f.battle.killedInTotal + f.battle.leakedInTotal));
  assert.equal(progressOf(m, 'n:ai_0').resolved, timelineAt(f.timeline, m._fieldElapsed(f))[3], 'clamped by the field clock');
});

test('① 一场只漏不杀的机器人战场: resolved 由 leakedInTotal 顶起来 (不是 0)', () => {
  // three walkers, nobody to stop them: the field's own enemies leak — leakedInTotal is what the capsule must show
  const h = makeBattle({ seed: 5, enemies: [{ key: 'enemy_1005_yokai', count: 3 }], content: 'full' });
  h.runToEnd(120);
  assert.equal(h.b.total, 3);
  assert.equal(h.b.leakedInTotal, 3, 'the field leaked all three of its own enemies');
  assert.equal(h.b.leakedCount, 3, 'counted leaks — the LP charge, unchanged from master');
  const sample = timelineSample(h.b);
  assert.equal(sample[3], 3, 'the timeline sample carries the capsule numerator');
  assert.equal(battleProgress(h.b).resolved, 3, 'b.progress too (what a teammate HUD reads)');
  assert.equal(battleProgress(h.b).total, 3);
  assert.equal(battleProgress(h.b).killed, 0);
});

test('② 上报没有 resolved ⇒ progress.resolved = null，客户端回落到 killed；上报 resolved: 0 ⇒ 采用 0', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 9103, fake: true, clientCombat: true, clients: false, script: () => ({ duration: 6 }) }).start();
  const m = h.m;
  h.toPrep(1);
  m.handle('p_0', { t: 'g.ready', ready: true });
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT);
  const human = fields(h).find((x) => x.fieldId === 'n:p_0');
  assert.equal(human.mode, 'client');
  assert.equal(human.progress.resolved, null, 'a fresh field: resolved unknown, not 0');

  // a report without `resolved` (an older client / a field that cannot count it) leaves it unknown
  assert.deepEqual(m.handle('p_0', { t: 'b.progress', battleId: human.battleId, gt: 4, killed: 3, total: 9, leaks: 0 }), { ok: true });
  m.flush(true);
  assert.deepEqual(progressOf(m, 'n:p_0'), { killed: 3, resolved: null, total: 9, done: false });
  // … and the teammate HUD falls back to `killed` (master's display: resolved ?? killed)
  const mine = (pub) => teammateProgress(pub, 'p_1').find((x) => x.playerId === 'p_0');
  assert.deepEqual(mine(m.publicView()), { playerId: 'p_0', name: 'P0', isBot: false, killed: 3, resolved: 3, total: 9, done: false });

  // a reported 0 is a real value: adopted, and the HUD shows 0 (not the fallback)
  assert.deepEqual(m.handle('p_0', { t: 'b.progress', battleId: human.battleId, gt: 5, killed: 3, total: 9, leaks: 0, resolved: 0 }), { ok: true });
  m.flush(true);
  assert.deepEqual(progressOf(m, 'n:p_0'), { killed: 3, resolved: 0, total: 9, done: false });
  assert.deepEqual(mine(m.publicView()), { playerId: 'p_0', name: 'P0', isBot: false, killed: 3, resolved: 0, total: 9, done: false });
});

test('a done field\'s m.public progress sums the reported per-player resolved (never a fabricated one)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 9104, fake: true, clientCombat: true, clients: false, script: () => ({ duration: 2 }) }).start();
  const m = h.m;
  h.toPrep(1);
  m.handle('p_0', { t: 'g.ready', ready: true });
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT);
  const human = fields(h).find((x) => x.fieldId === 'n:p_0');
  // a result carrying the capsule numbers: 5 counted knock-outs (a split child included), 3 of the round's own resolved
  const result = {
    reason: 'cleared', time: 6, killed: 5, total: 3, resolved: 3,
    perPlayer: { p_0: { killed: 5, total: 3, resolved: 3, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [] } },
    errors: 0,
  };
  assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: human.battleId, result }), { ok: true });
  m.flush(true);
  const pr = progressOf(m, 'n:p_0');
  assert.equal(pr.done, true);
  assert.equal(pr.killed, 5, '`killed` keeps the counted reading (may exceed the denominator)');
  assert.equal(pr.total, 3, 'the denominator is the round\'s own list');
  assert.equal(pr.resolved, 3, 'the capsule numerator of the finished field');
});
