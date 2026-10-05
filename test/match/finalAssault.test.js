// 最终攻势 / 隐秘核心: pairing, merged LP, shared boss pool, overtime, leaks, hidden-core condition (FakeBattle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, GEO } from '../../shared/constants.js';
import { pairPlayers, bossPoolHp, SharedBossPool, hiddenEligible } from '../../server/match/finalAssault.js';
import { GameData } from '../../server/match/gamedata.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';

const bossFields = () => FakeBattle.instances.filter((b) => b.kind === 'boss' || b.kind === 'hidden');

test('pairing by seat: (1,2), (3,4); an odd player alone', () => {
  const p = (seat) => ({ seat, playerId: `s${seat}` });
  assert.deepEqual(pairPlayers([p(0)]).map((g) => g.map((x) => x.seat)), [[0]]);
  assert.deepEqual(pairPlayers([p(2), p(0)]).map((g) => g.map((x) => x.seat)), [[0, 2]]);
  assert.deepEqual(pairPlayers([p(3), p(1), p(0)]).map((g) => g.map((x) => x.seat)), [[0, 1], [3]]);
  assert.deepEqual(pairPlayers([p(3), p(1), p(0), p(2)]).map((g) => g.map((x) => x.seat)), [[0, 1], [2, 3]]);
});

test('boss pool = bloodPoint[difficulty] × the players alive at the fight start / 4 in co-op (solo × 0.25; aliveScaling false = the seats) × tuning; shared and never negative', () => {
  // research numbers (data/tuning.json left out); DESIGN §20.10: notice 5114's "敌方领袖的总生命值不变" is about the
  // mirrored copies. The user rule (2026-10-05) made the LIVING players at that fight's start the factor (captured once
  // and locked there); `bossHpScale.aliveScaling: false` sizes the pool from the seats the match runs with instead (the
  // reading upstream issue #113 "联机boss血量没有乘以联机人数" shipped; the / 4 proportion is the [ASSUMED] solo anchor).
  const { tuning, ...RAW } = DATA; // eslint-disable-line no-unused-vars
  const gd = new GameData(RAW, 'mode_multi_hard');
  for (const n of [4, undefined, 9]) assert.equal(bossPoolHp(gd, 'boss_1', undefined, n), 1800000, `${n} alive: the data value`);
  assert.equal(bossPoolHp(gd, 'boss_1', 4, 3), 1350000, 'three alive');
  assert.equal(bossPoolHp(gd, 'boss_1', 4, 2), 900000, 'two alive');
  assert.equal(bossPoolHp(gd, 'boss_1', 4, 1), 450000, 'one alive — the solo value by the same rule');
  assert.equal(bossPoolHp(gd, 'boss_1', 4), 1800000, 'no count given: a full team');
  assert.equal(bossPoolHp(gd, 'boss_1', 2, 1), 450000, 'two seats, one alive: the living count is the factor');
  // playerScaling false: the data value whatever the counts (the master switch)
  const fixed = new GameData({ ...RAW, config: { ...RAW.config, bossHpScale: { ...RAW.config.bossHpScale, playerScaling: false },
    modes: { ...RAW.config.modes, mode_multi_hard: { ...RAW.config.modes.mode_multi_hard, bossHpScale: { ...RAW.config.modes.mode_multi_hard.bossHpScale, playerScaling: false } } } } }, 'mode_multi_hard');
  for (const n of [4, 2, 1]) assert.equal(bossPoolHp(fixed, 'boss_1', 4, n), 1800000, `fixed pool, ${n} alive`);
  assert.equal(gd.bossPoolHp('boss_1', 4, 2), bossPoolHp(gd, 'boss_1', 4, 2), 'GameData agrees');
  // the flip: config bossHpScale.aliveScaling false sizes the pool from the seats the match runs with
  const seats = new GameData({ ...RAW, config: { ...RAW.config, bossHpScale: { ...RAW.config.bossHpScale, aliveScaling: false },
    modes: { ...RAW.config.modes, mode_multi_hard: { ...RAW.config.modes.mode_multi_hard, bossHpScale: { ...RAW.config.modes.mode_multi_hard.bossHpScale, aliveScaling: false } } } } }, 'mode_multi_hard');
  assert.equal(bossPoolHp(seats, 'boss_1', 4, 4), 1800000);
  assert.equal(bossPoolHp(seats, 'boss_1', 4, 2), 1800000, 'four seats, two alive: the data value');
  assert.equal(bossPoolHp(seats, 'boss_1', 3, 1), 1350000);
  assert.equal(bossPoolHp(seats, 'boss_1', 2, 2), 900000);
  assert.equal(bossPoolHp(seats, 'boss_1', 4, 1), 1800000, 'a 4-seat room with 1 alive: still the data value');
  assert.equal(bossPoolHp(seats, 'boss_1'), 1800000, 'no count given: a full team');
  assert.equal(bossPoolHp(seats, 'boss_1', 9, 9), 1800000, 'never above the data value');
  assert.equal(bossPoolHp(new GameData(RAW, 'mode_single_abyss'), 'boss_5', 1, 1), 750000);
  assert.equal(bossPoolHp(new GameData(RAW, 'mode_single_funny'), 'boss_2', 1, 1), 56250);
  // the balance layer multiplies the pool (docs/BALANCE.md)
  for (const modeId of ['mode_single_funny', 'mode_multi_hard']) {
    const tuned = new GameData(DATA, modeId);
    const raw = new GameData(RAW, modeId);
    assert.equal(bossPoolHp(tuned, 'boss_2', 4, 4), Math.max(1, Math.round(bossPoolHp(raw, 'boss_2', 4, 4) * tuned.bossHpMul('boss_2'))));
  }
  const pool = new SharedBossPool(100);
  assert.equal(pool.damage('a', 60), 60);
  assert.equal(pool.damage('b', 60), 40);
  assert.equal(pool.hp, 0);
  assert.equal(pool.damage('a', 5), 0);
  assert.equal(pool.damage('a', NaN), 0);
  assert.equal(pool.byPlayer.get('a'), 60);
});

for (const n of [1, 2, 3, 4]) {
  test(`Final Assault with ${n} player(s): fields, sides, templates, merged LP, shared pool, victory`, () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: n, seed: 40 + n, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : {}) }).start();
    const m = h.m;
    h.drive(() => m.phase === PHASE.PREP && m.round === 14);
    const lps = [...m.players.values()].map((p) => p.lp);
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
    assert.equal(m.teamLp, lps.reduce((a, b) => a + b, 0), 'merged team LP');
    const fields = bossFields();
    assert.equal(fields.length, Math.ceil(n / 2));
    assert.deepEqual(fields.map((f) => f.fieldId), Math.ceil(n / 2) === 2 ? ['b1', 'b2'] : ['b1']);
    const pool = fields[0].sharedBoss;
    assert.ok(fields.every((f) => f.sharedBoss === pool), 'one pool for every boss field');
    assert.equal(pool.maxHp, bossPoolHp(m.gd, m.bossId, n, m.alivePlayers().length), 'the pool of the players alive at the start');
    assert.equal(m.bossPoolAlive, n, 'every seat is alive when the fight starts');
    for (const f of fields) {
      assert.deepEqual(f.opts.rect, GEO.BOSS_RECT);
      assert.equal(f.opts.timeLimit, Infinity);
      assert.equal(f.opts.flags.layerGainsEnabled, false);
      assert.ok(f.opts.players.every((p) => p.lpForBoss === m.teamLp));
      if (f.opts.players.length === 2) {
        assert.deepEqual(f.opts.players.map((p) => p.side), ['L', 'R']);
        assert.ok(!/_s$/.test(f.opts.waveId), `pair uses the multi template (${f.opts.waveId})`);
      } else {
        assert.deepEqual(f.opts.players.map((p) => p.side), ['L']);
        assert.ok(/_s$/.test(f.opts.waveId), `a lone player uses the _s template (${f.opts.waveId})`);
      }
      assert.ok(f.opts.spawns.some((s) => s.tag === 'boss'), 'the boss spawns');
      const boss = f.opts.spawns.find((s) => s.tag === 'boss');
      assert.equal(boss.mods.hpMul, undefined, 'bosses are never scaled');
    }
    const pub = m.publicView();
    assert.equal(pub.teamLp, m.teamLp);
    assert.deepEqual(pub.bossHp, { hp: Math.round(pool.hp), max: Math.round(pool.maxHp) });
    const end = h.runToEnd();
    assert.equal(end.victory, true);
    assert.equal(end.roundsPassed, 14);
    assert.equal(end.hiddenReached, false, 'FUNNY has no hidden core');
    assert.equal(h.endedCount, 1);
    for (const p of end.players) assert.equal(p.roundsPassed, 14);
    const res = h.lastTo('p_0', 'm.result');
    assert.equal(res.playerId, 'p_0');
    assert.equal(res.victory, true);
    checkInvariants(m);
    m.dispose();
  });
}

test('overtime: −1 team LP per REAL second after 150 real s (300 game s at 2×); team LP 0 ends every field → defeat (13 rounds passed)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 50, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1 } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  for (const p of m.players.values()) p.lp = 10;
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.equal(m.teamLp, 20);
  const f = bossFields()[0];
  const end = h.runToEnd();
  assert.equal(end.victory, false);
  assert.equal(end.roundsPassed, 13);
  assert.ok(Math.abs(f.time - 340) < 2.5, `ended ≈ 300 + 2 × 20 game s (${f.time})`);
  assert.equal(m.teamLp, 0);
  m.dispose();
});

test('Final Assault leaks cost their lpr from the merged LP', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 51, fake: true, instant: false, script: (b) => (b.kind === 'boss' ? { bossDps: 1, leakEvents: [{ at: 5, lpr: 1 }, { at: 10, lpr: 30, boss: true }] } : {}) }).start();
  const m = h.m;
  assert.equal(m.gd.bossRound, 9, 'solo FUNNY: boss at R9');
  h.drive(() => m.phase === PHASE.PREP && m.round === 9);
  h.ps('p_0').lp = 40;
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.ok(/_s$/.test(bossFields()[0].opts.waveId));
  h.run(() => bossFields()[0].time >= 6);
  assert.equal(m.teamLp, 39);
  h.run(() => bossFields()[0].time >= 11);
  assert.equal(m.teamLp, 9);
  const end = h.runToEnd();
  assert.equal(end.victory, false);
  assert.equal(end.roundsPassed, 8);
  m.dispose();
});

test('Hidden Core: Σ activated layers (end of the boss prep) > 1200 and team LP > 1 after a win → R15 prep → HIDDEN_CORE', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 52, fake: true, script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : {}) }).start();
  const m = h.m;
  assert.equal(m.gd.hiddenRound, 15);
  assert.ok(m.hiddenBossId && ['boss_8', 'boss_9', 'boss_10'].includes(m.hiddenBossId));
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  for (const p of m.players.values()) { p.bondCountBonus.yanShip = 3; p.layers.yanShip = 601; p.recompute(); }
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.equal(m.hiddenLayerSum, 1202);
  h.drive(() => m.phase === PHASE.PREP && m.round === 15);
  assert.equal(m.phase, PHASE.PREP);
  assert.ok(m.deadline > 0, 'R15 prep is timed in co-op');
  assert.equal(Math.round((m.deadline - h.sched.now()) / 1000), m.gd.prepTime(15));
  const lp = m.teamLp;
  h.drive(() => m.phase === PHASE.HIDDEN_CORE);
  const f = bossFields().find((b) => b.kind === 'hidden');
  assert.ok(f, 'hidden field');
  assert.equal(f.opts.bossId, m.hiddenBossId);
  assert.equal(m.teamLp, lp, 'team LP carries over');
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  assert.equal(end.hiddenReached, true);
  assert.equal(end.hiddenCleared, true);
  assert.equal(end.roundsPassed, 15);
  m.dispose();
});

test('Hidden Core is skipped at Σ layers ≤ threshold, on FUNNY, or with team LP ≤ 1; a failed hidden core keeps the clear', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  assert.equal(hiddenEligible(gd, { layerSum: 1200, teamLp: 50 }), false);
  assert.equal(hiddenEligible(gd, { layerSum: 1201, teamLp: 50 }), true);
  assert.equal(hiddenEligible(gd, { layerSum: 5000, teamLp: 1 }), false);
  assert.equal(hiddenEligible(new GameData(DATA, 'mode_single_hard'), { layerSum: 351, teamLp: 2 }), true);
  assert.equal(hiddenEligible(new GameData(DATA, 'mode_single_hard'), { layerSum: 350, teamLp: 2 }), false);
  assert.equal(hiddenEligible(new GameData(DATA, 'mode_multi_funny'), { layerSum: 9999, teamLp: 99 }), false);
  // failed hidden core → still a victory
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 53, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : b.kind === 'hidden' ? { bossDps: 0 } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  const ps = h.ps('p_0');
  ps.bondCountBonus.yanShip = 3; ps.layers.yanShip = 400; ps.lp = 5; ps.recompute();
  h.drive(() => h.ended != null);
  const end = h.ended;
  assert.equal(end.hiddenReached, true);
  assert.equal(end.hiddenCleared, false);
  assert.equal(end.victory, true);
  assert.equal(end.roundsPassed, 14);
  m.dispose();
});

test('Final Assault: a fighting player may only watch its own boss field; eliminated players spectate any field', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 4, seed: 54, fake: true, instant: false, script: (b) => (b.kind === 'boss' ? { bossDps: 1 } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  h.ps('p_3').eliminate(13);
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.deepEqual(m.fields.map((f) => [f.fieldId, f.players]), [['b1', ['p_0', 'p_1']], ['b2', ['p_2']]]);
  assert.equal(m.handle('p_0', { t: 'g.watch', fieldId: 'b2' }).error, 'BAD_TARGET', 'the other group is hidden');
  assert.equal(m.handle('p_2', { t: 'g.watch', fieldId: 'b1' }).error, 'BAD_TARGET');
  assert.deepEqual(m.handle('p_1', { t: 'g.watch', fieldId: 'b1' }), { ok: true });
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b2' }), { ok: true }, 'an eliminated player spectates freely');
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b1' }), { ok: true });
  assert.equal(m.watchers.get('p_0'), 'b1', 'the refused watch keeps the default (own) field');
  // the prep-scouting id of a player of the other group is no way around the rule, and never detaches the viewer
  const scouted = h.allTo('p_0', 'm.field').length;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { error: 'BAD_TARGET', detail: 'no such field' });
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { error: 'BAD_TARGET', detail: 'no such field' });
  assert.equal(h.allTo('p_0', 'm.field').length, scouted, 'no board of the other group was sent');
  assert.equal(m.watchers.get('p_0'), 'b1', 'still streaming the own boss field');
  const snaps = h.allTo('p_0', 'b.snap').length;
  h.sched.advance(500);
  assert.ok(h.allTo('p_0', 'b.snap').length > snaps, 'b.snap of b1 keeps coming');
  m.dispose();
});

test('Final Assault: stats reach m.private at the end; leader "扣除目标生命" effects (lpLoss) hit the team LP', () => {
  const h = makeMatch({
    mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 56, fake: true,
    script: (b) => (b.kind === 'boss' ? { bossDps: b.sharedBoss.maxHp / 10, damage: { p_0: 5000, p_1: 7000 }, lpLossEvents: [{ at: 2, amount: 7 }] } : {}),
  }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  h.ps('p_0').lp = 20;
  h.ps('p_1').lp = 20;
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  assert.equal(m.teamLp, 40 - 7, 'lpLoss drains the merged pool');
  for (const id of ['p_0', 'p_1']) {
    const ps = h.ps(id);
    const last = h.lastTo(id, 'm.private');
    assert.deepEqual(last.stats, ps.privateView().stats, `${id}: the last m.private carries the boss-field damage / kills`);
    assert.equal(last.lp, ps.lp);
  }
  m.dispose();
});
