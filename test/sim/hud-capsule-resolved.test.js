// test/sim/hud-capsule-resolved.test.js — the HUD capsule's own counters (PR #157, maintainer-reviewed direction; the
// bounty / kill semantics stay master's):
//   resolved = min(total, killedInTotal + leakedInTotal) — the field's OWN scheduled enemies (`inTotal`) that are
//   已解决: knocked down or leaked. The official example: 开局 0/3 → 漏一个 1/3 → 打死一个 2/3 → 打死会分裂的 3/3.
//   A runtime spawn — a split child, a summon (a boss's included), a part — is in neither the numerator nor the
//   denominator, while `counted` (the LP / 完美作战 / `killed` reading) keeps counting it exactly as master did.
// Run: node --test test/sim/hud-capsule-resolved.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves, buildBossWave } from '../../server/match/waves.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';

const QUIET = { warn() {}, error() {}, info() {}, log() {}, debug() {} };
/** The real mode config: the per-round LP cap settlement charges min(cap, counted leaks) with (match/settle.js). */
const gd = new GameData(getData({ log: QUIET }), 'mode_multi_normal');

const MOLANG = 'enemy_1195_sfyin';          // 磨砻 — 被击倒后生成2个<木制瑞印> (data talents DeadSpawn)
const MOLANG_CHILD = 'enemy_1196_msfyin';   // 木制瑞印
const APOSTLE = 'enemy_1321_wdarft';        // 枯朽萃聚使徒 — 召唤数个<枯朽之种> while it lives
const SEED = 'enemy_1269_nhfly';            // 枯朽之种
const done = (h) => {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
};
const capsule = (b) => ({ total: b.total, killedInTotal: b.killedInTotal, leakedInTotal: b.leakedInTotal, resolved: b.resolved });

test('官方例子: 开局 0/3 → 漏一个 1/3 → 打死一个 2/3 → 打死会分裂的 3/3 (分裂子体不进胶囊)', () => {
  const h = makeBattle({
    seed: 11, autoFinish: false, timeLimit: 300,
    enemies: [
      { key: 'enemy_1195_sfyin', pos: [9, 6], count: 1 },
      { key: 'enemy_1005_yokai', pos: [9, 8], count: 2 },
    ],
  });
  h.step();
  const molang = h.b.enemies.find((e) => e.defId === MOLANG);
  const yokai = h.b.enemies.filter((e) => e.defId === 'enemy_1005_yokai');
  assert.equal(h.b.total, 3, '分母 = 本关自己排定的 3 个敌人');
  assert.ok(molang.inTotal && yokai.every((e) => e.inTotal), '排定的敌人 inTotal');
  assert.equal(h.b.resolved, 0, '0/3');
  const snap = h.snapshot();
  assert.equal(snap.resolved, 0, 'b.snap carries the capsule numerator');
  assert.equal(snap.total, 3);

  h.b.leak(yokai[0]);                                        // 漏一个
  assert.equal(h.b.resolved, 1, '1/3');

  h.b.kill(yokai[1], null);                                  // 打死一个
  assert.equal(h.b.resolved, 2, '2/3');

  h.b.kill(molang, null);                                    // 打死会分裂的
  assert.equal(h.b.killedInTotal + h.b.leakedInTotal, 3, '三个排定的敌人都已解决 (2 击倒 + 1 漏掉)');
  assert.equal(h.b.killedInTotal, 2);
  assert.equal(h.b.leakedInTotal, 1);
  assert.equal(h.b.resolved, 3, '3/3');
  assert.equal(h.b.total, 3, '分裂出来的子体没有抬高分母');
  const kids = h.b.enemies.filter((e) => e.alive && e.defId === MOLANG_CHILD);
  assert.equal(kids.length, 2, '磨砻 split into 2 木制瑞印');
  for (const k of kids) assert.ok(!k.inTotal && k.counted, 'a split child counts for LP, not for the capsule');
  assert.equal(h.b.resolved, 3, 'the children move no capsule number');
  done(h);
});

test('磨砻 4 个全被击倒 → 胶囊 4/4；它们 8 个子体全漏 → leakedInTotal 仍 0、counted 口径的 LP 照扣 min(10, 8) = 8', () => {
  const h = makeBattle({ seed: 12, autoFinish: false, timeLimit: 300, enemies: [{ key: MOLANG, pos: [9, 6], count: 4 }] });
  h.step();
  const molang = h.b.enemies.filter((e) => e.defId === MOLANG && e.alive);
  assert.equal(molang.length, 4);
  assert.equal(h.b.total, 4, '分母 = 排定的 4 个磨砻');
  for (const e of molang) h.b.kill(e, null);
  assert.equal(h.b.killedInTotal, 4);
  assert.equal(h.b.resolved, 4, '胶囊 4/4 — 击倒的是本关自己的敌人');
  assert.equal(h.b.total, 4, '子体不进分母');
  const kids = h.b.enemies.filter((e) => e.alive && e.defId === MOLANG_CHILD);
  assert.equal(kids.length, 8, '四个磨砻各分裂出 2 个木制瑞印');
  assert.equal(h.b.leakedInTotal, 0);

  for (const k of kids) h.b.leak(k);
  // the capsule: the leaked children are no enemies of the stage's own list — the numerator stays at 4/4
  assert.deepEqual(capsule(h.b), { total: 4, killedInTotal: 4, leakedInTotal: 0, resolved: 4 });
  // the LP reading is master's, unchanged: every leaked child is a counted leak, and settlement charges min(cap, 8)
  // (server/match/settle.js `Math.min(cap, counted)`); leakedCount is the count the LP meter reads
  assert.equal(h.b.leakedCount, 8);
  const r = h.result();
  const countedLeaks = r.perPlayer.p1.leaked.filter((l) => l.counted !== false).length;
  assert.equal(countedLeaks, 8, '8 counted leaks — the children each cost LP as before');
  assert.equal(Math.min(gd.lpCapPerRound, countedLeaks), 8, 'the settled charge is min(10, 8) = 8, exactly as master');
  assert.equal(r.perPlayer.p1.perfect, false, 'a counted leak still breaks 完美作战');
  assert.equal(r.perPlayer.p1.resolved, 4, 'BattleResult carries the capsule numerator');
  assert.equal(r.resolved, 4);
  done(h);
});

test('分裂子体被击倒: 胶囊数字不动，`killed` 仍按 counted 口径 +1 (master 的击杀语义不变)', () => {
  const h = makeBattle({ seed: 13, autoFinish: false, timeLimit: 300, enemies: [{ key: MOLANG, pos: [9, 6] }] });
  h.step();
  const molang = h.b.enemies.find((e) => e.defId === MOLANG);
  h.b.kill(molang, null);
  const kids = h.b.enemies.filter((e) => e.alive && e.defId === MOLANG_CHILD);
  assert.equal(kids.length, 2);
  const before = capsule(h.b);
  const killedBefore = h.b.killed;
  const coinsBefore = h.result().perPlayer.p1.coins;
  h.b.kill(kids[0], null);
  assert.deepEqual(capsule(h.b), before, 'a knocked-down split child moves no capsule number');
  assert.equal(h.b.killed, killedBefore + 1, '`killed` counts every counted knock-out (master semantics, unchanged)');
  assert.equal(h.result().perPlayer.p1.coins, coinsBefore, 'no bounty for a split child');
  h.b.leak(kids[1]);
  assert.deepEqual(capsule(h.b), before, 'a leaked split child moves no capsule number either');
  assert.equal(h.b.leakedCount, 1, '… but it is a counted leak (LP / 完美作战)');
  assert.equal(h.b.resolved, 1, 'the capsule stands at 1/1 — the 磨砻 itself');
  done(h);
});

test('枯朽萃聚使徒: 召唤出的枯朽之种出生 / 被击倒 / 漏掉都不动胶囊，本体照旧结算 (悬赏口径不变)', () => {
  const card = { id: 'enemyeffect_10_8', card: { payout: 'kill', coin: 2, enemyKey: APOSTLE } };
  const h = makeBattle({
    seed: 14, autoFinish: false, timeLimit: 300,
    enemies: [{ key: APOSTLE, route: 2, mods: { hpMul: 1, bountyId: card.id }, bounty: { coins: 2, ownerPlayerId: 'p1' }, tag: 'bounty', ownerPlayerId: 'p1' }],
  });
  assert.ok(h.runUntil(() => h.b.enemies.filter((e) => e.alive && e.defId === SEED).length >= 2, 30), 'BornBugs cast');
  const seeds = h.b.enemies.filter((e) => e.alive && e.defId === SEED);
  assert.equal(h.b.total, 1, '分母只有排定的本体 — 召唤物不进分母');
  for (const s of seeds) {
    assert.ok(!s.inTotal, 'a summoned 枯朽之种 is not in the capsule');
    assert.ok(s.counted, '… but it counts for LP / 完美作战 (master)');
    assert.equal(s.bounty, null, '悬赏只在召唤物本体上 (master rule, untouched)');
  }
  const before = capsule(h.b);
  const killedBefore = h.b.killed;
  h.b.kill(seeds[0], null);
  assert.deepEqual(capsule(h.b), before, 'the summoned seed\'s knock-out moves no capsule number');
  assert.equal(h.b.killed, killedBefore + 1, '`killed` still counts it (master)');
  assert.deepEqual(h.eventsOf('bounty'), [], 'a summoned seed pays no bounty');
  h.b.leak(seeds[1]);
  assert.deepEqual(capsule(h.b), before, 'the summoned seed\'s leak moves no capsule number');
  assert.equal(h.b.leakedCount, 1, 'counted leak: the LP charge is unchanged from master');
  // the body itself is the field's own scheduled enemy: its knock-out resolves the capsule and pays once
  const body = h.b.enemies.find((e) => e.alive && e.defId === APOSTLE);
  assert.ok(body && body.inTotal);
  h.b.kill(body, null);
  assert.deepEqual(h.eventsOf('bounty'), [['bounty', 'p1', 2]], 'the body pays once (master rule)');
  assert.equal(h.b.resolved, h.b.total, 'the field\'s own list is resolved');
  done(h);
});

// =====================================================================================================================
// A real Boss round: a boss summon is a runtime spawn too. The 假想敌：管 (boss_3, act1autochess_h07_03) summons a
// 余音 (enemy_9023_acdums) every 40 game s (20 below half HP); its wave ALSO schedules 2 余音 of its own — those are
// the round's own enemies and do enter the capsule, the summoned ones do not.

test('Boss 召唤物 (假想敌：管的余音) 出生 / 被击倒 / 漏掉都不动胶囊；Boss 死后 resolved === total', () => {
  const bossId = 'boss_3';
  const ECHO = 'enemy_9023_acdums';   // 余音 — 管 summons it every 40 game s (20 s below half HP)
  const seed = deriveSeed(20261005, `boss:${bossId}:p`);
  const wave = buildBossWave(gd, createRng(deriveSeed(seed, 'waves')), setupMatchWaves(gd, createRng(deriveSeed(seed, 'setup'))), gd.bossRound, { bossId, solo: false });
  const h = makeBattle({
    kind: 'boss', seed: 21, autoFinish: false,
    routes: wave.routes,
    enemies: wave.spawns.map((s) => ({ key: s.enemyKey, time: s.time, route: s.routeIndex, count: s.count, interval: s.interval, mods: s.mods, tag: s.tag, countInTotal: s.countInTotal })),
  });
  // the round's own list: 2 疏术士 + 2 疏den + 2 余音 (the wave's own 余音, scheduled 40 s apart) — the 领袖 (tag 'boss')
  // and everything 管 summons are outside it. 会召唤的 Boss 关胶囊 therefore fills up now (the old `total++` of a runtime
  // spawn left it short forever).
  const scheduled = wave.spawns.filter((s) => s.tag !== 'boss' && s.countInTotal !== false).reduce((n, s) => n + s.count, 0);
  assert.equal(scheduled, 6);
  assert.equal(h.b.total, scheduled, `分母 = 本关排定且该计入的 ${scheduled} 个敌人`);
  h.run(3);   // the 领袖 comes in at t = 1 s, the wave's first 余音 at t = 0
  const leader = h.b.enemies.find((e) => e.defId === 'enemy_9021_acduml');
  assert.ok(leader, 'the 领袖 is on the field');
  assert.ok(!leader.inTotal && !leader.counted, 'the 领袖 (tag boss) is in no capsule part');
  assert.equal(h.b.units.filter((u) => u.side === 'enemy' && u.inTotal && u.defId === ECHO).length, 1, 'the wave scheduled its own 余音');
  assert.equal(h.b.total, scheduled, 'the 领袖 does not add to the denominator (tag boss ⇒ not counted)');

  // the boss summons one of its own (pipeCore, bosses.js: `spawnEnemy` — never the spawn queue)
  const runtime = () => h.b.units.find((u) => u.side === 'enemy' && u.alive && !u.inTotal && u.defId === ECHO);
  assert.ok(h.runUntil(() => !!runtime(), 90), 'the boss summoned a 余音');
  const first = runtime();
  assert.ok(first.counted, 'the summon still counts for LP (master)');
  assert.equal(h.b.total, scheduled, 'the summoned 余音 never raised the denominator (the old defect: an unfillable capsule)');
  const before = capsule(h.b);
  const killedBefore = h.b.killed;
  h.b.kill(first, null);
  assert.deepEqual(capsule(h.b), before, 'a knocked-down boss summon moves no capsule number');
  assert.equal(h.b.killed, killedBefore + 1, '`killed` counts it (master semantics unchanged)');

  assert.ok(h.runUntil(() => !!runtime(), 120), 'a second summon');
  const beforeLeak = capsule(h.b);
  const leakedBefore = h.b.leakedCount;
  h.b.leak(runtime());
  assert.deepEqual(capsule(h.b), beforeLeak, 'a leaked boss summon moves no capsule number');
  assert.equal(h.b.leakedCount, leakedBefore + 1, 'a counted leak — the LP charge follows the real data (`counted`), as master');

  // the leader itself: tag 'boss' ⇒ counted false ⇒ in no capsule number, and killing it is no `killed` either (master)
  const killedBeforeLeader = h.b.killed;
  h.b.kill(leader, null);
  assert.equal(h.b.killed, killedBeforeLeader, 'the leader is not a counted knock-out (master reading)');
  // every one of the round's own enemies resolved ⇒ the capsule is full
  for (const e of h.b.enemies.filter((e) => e.alive && e.inTotal)) h.b.kill(e, null);
  for (const e of h.b.enemies.filter((e) => e.alive && e.inTotal)) h.b.leak(e);
  assert.equal(h.b.killedInTotal + h.b.leakedInTotal, h.b.total);
  assert.equal(h.b.resolved, h.b.total, 'Boss 死后 resolved === total — the summons never pushed the denominator up');
  assert.equal(h.b.total, scheduled, 'nor did they move it at the end');
  done(h);
});

test('kept honest: a helper enemy record the tests build is a scheduled enemy (inTotal) while spawnEnemy is not', () => {
  const h = makeBattle({
    seed: 31, autoFinish: false, timeLimit: 60,
    defs: { enemies: { enemy_helper: enemyRec({ key: 'enemy_helper', hp: 10, speed: 0 }) } },
    enemies: [{ key: 'enemy_helper' }],
  });
  h.step();
  assert.equal(h.b.total, 1);
  assert.equal(h.b.enemies[0].inTotal, true);
  const runtime = h.spawn('enemy_helper', { pos: [9, 4] });
  assert.equal(h.b.total, 1, 'a runtime spawnEnemy is not in the denominator');
  assert.ok(!runtime.inTotal && runtime.counted, '… and not in the capsule, while counted stays master\'s');
  const explicit = h.b.spawnEnemy('enemy_helper', { pos: [9, 3], inTotal: true });   // the content back door
  assert.equal(h.b.total, 2, 'an explicit `inTotal: true` is honoured');
  assert.ok(explicit.inTotal);
  assert.equal(h.b.enemies.filter((e) => e.alive).length, 3);
  done(h);
});
