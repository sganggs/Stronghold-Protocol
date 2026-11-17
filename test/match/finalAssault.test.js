// 最终攻势 / 隐秘核心: pairing, merged LP, shared boss pool, overtime, leaks, hidden-core condition (FakeBattle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, GEO } from '../../shared/constants.js';
import { pairPlayers, bossPoolHp, SharedBossPool, hiddenEligible } from '../../server/match/finalAssault.js';
import { GameData } from '../../server/match/gamedata.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';
import { createRng, deriveSeed } from '../../server/sim/rng.js';

const bossFields = () => FakeBattle.instances.filter((b) => b.kind === 'boss' || b.kind === 'hidden');

test('pairing is seeded, independent of input order, includes everyone once and can draw every partner', () => {
  const p = (seat) => ({ seat, playerId: `s${seat}` });
  const partners = new Set(), lone = new Set();
  for (let seed = 1; seed <= 64; seed++) for (const n of [1, 2, 3, 4]) {
    const alive = Array.from({ length: n }, (_, i) => p(i));
    const groups = pairPlayers(alive, createRng(seed));
    assert.deepEqual(groups, pairPlayers([...alive].reverse(), createRng(seed)));
    assert.equal(groups.length, Math.ceil(n / 2));
    assert.deepEqual(groups.flat().map(x => x.seat).sort(), alive.map(x => x.seat));
    if (n === 4) partners.add(groups.find(g => g.some(x => x.seat === 0)).find(x => x.seat !== 0).seat);
    if (n === 3) lone.add(groups.find(g => g.length === 1)[0].seat);
  }
  assert.deepEqual([...partners].sort(), [1, 2, 3]);
  assert.deepEqual([...lone].sort(), [0, 1, 2]);
});

test('previous boss partners and sides persist; only orphaned survivors form a new pair', () => {
  const all = [0, 1, 2, 3].map(seat => ({ seat, playerId: `s${seat}` }));
  const previous = [['s3', 's0'], ['s2', 's1']];
  const ids = groups => groups.map(g => g.map(p => p.playerId));
  assert.deepEqual(ids(pairPlayers(all, createRng(99), previous)), previous);
  assert.deepEqual(ids(pairPlayers(all.filter(p => p.seat !== 0), createRng(99), previous)), [['s2', 's1'], ['s3']]);
  assert.deepEqual(ids(pairPlayers(all.filter(p => p.seat > 1), createRng(99), previous)), [['s3', 's2']]);
});

// GitHub #845 (DESIGN §35.27, superseding §30.12's kept partners): the official R15 of BV1VCXyBjEN1 p1 pairs 1-2 / 3-4
// after an R14 of 1-4 / 2-3 — the Hidden Core draws pairs and sides anew, from a stream of its own (the Final Assault's
// draw unchanged). Each round's plan drives its prep preview, side checks and fields.
test('boss preview and actual fields share each round\'s draw; the Hidden Core draws pairs and sides anew (#845)', () => {
  const ids = (groups) => groups.map((g) => g.map((p) => p.playerId));
  let changed = 0;
  for (const seed of [31, 32, 33, 34, 35, 36]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 4, seed, fake: true,
      script: b => ['boss', 'hidden'].includes(b.kind) ? { bossDps: 1e9 } : {} }).start();
    try {
      h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 14);
      const m = h.m;
      const pairs = structuredClone(m.bossPairs);
      // the Final Assault's draw is the one of before (seed salt 'boss-pairs', no previous)
      assert.deepEqual(pairs, ids(pairPlayers(m.alivePlayers(), createRng(deriveSeed(m.seed, 'boss-pairs')))));
      assert.deepEqual(m.bossWaves.map(w => w.players), pairs);
      for (const p of m.order) {
        p.bondCountBonus.yanShip = 3; p.layers.yanShip = 400; p.recompute();
        const group = m.bossGroupOf(p);
        assert.equal(group.side, pairs.find(g => g.includes(p.playerId)).indexOf(p.playerId) === 0 ? 'L' : 'R');
      }
      h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
      assert.deepEqual(m.fields.map(f => f.players), pairs);
      const boards = new Map(m.order.map((p) => [p.playerId, p.board.size]));
      h.drive(() => m.phase === PHASE.PREP && m.round === 15);
      const hidden = structuredClone(m.bossPairs);
      assert.deepEqual(hidden, ids(pairPlayers(m.alivePlayers(), createRng(deriveSeed(m.seed, 'boss-pairs:15')))), 'the Hidden Core\'s own draw');
      assert.deepEqual(m.bossWaves.map(w => w.players), hidden, 'the R15 prep preview uses it');
      if (JSON.stringify(hidden) !== JSON.stringify(pairs)) changed++;
      // a player who changed half keeps the whole board: the halves' deploy maps are mirror images
      for (const p of m.order) {
        assert.equal(m.bossGroupOf(p).side, hidden.find(g => g.includes(p.playerId)).indexOf(p.playerId) === 0 ? 'L' : 'R');
        p.recompute();
        assert.equal(p.board.size, boards.get(p.playerId), `${p.playerId} keeps its board on its R15 half`);
      }
      h.drive(() => m.phase === PHASE.HIDDEN_CORE);
      assert.deepEqual(m.fields.map(f => f.players), hidden);
    } finally { h.m.dispose(); }
  }
  assert.ok(changed > 0, 'some Hidden Core pairs or sides differ from the Final Assault\'s');
});

// A departure during the Hidden Core's round start / prep re-plans the pairs (platform.js _quit); only the round's first
// plan draws anew, so the pair the departed player was not in stays whole, as in the Final Assault (DESIGN §35.27).
test('a departure in the Hidden Core prep keeps the intact pair and re-pairs only the orphan (#845)', () => {
  for (const seed of [31, 32, 33, 34, 35, 36, 37, 38]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 4, seed, fake: true,
      script: b => ['boss', 'hidden'].includes(b.kind) ? { bossDps: 1e9 } : {} }).start();
    try {
      h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 14);
      const m = h.m;
      for (const p of m.order) { p.bondCountBonus.yanShip = 3; p.layers.yanShip = 400; p.recompute(); }
      h.drive(() => m.phase === PHASE.PREP && m.round === 15);
      const before = structuredClone(m.bossPairs);
      assert.equal(before.length, 2);
      const [gone, orphan] = before[0];
      m.onLeave(gone);
      assert.equal(m.players.get(gone).alive, false);
      assert.deepEqual(m.bossPairs, [before[1], [orphan]], `seed ${seed}: the whole pair stays, the orphan alone`);
      assert.deepEqual(m.bossWaves.map(w => w.players), m.bossPairs, 'the prep preview follows the re-plan');
      h.drive(() => m.phase === PHASE.HIDDEN_CORE);
      assert.deepEqual(m.fields.map(f => f.players), m.bossPairs);
    } finally { h.m.dispose(); }
  }
});

test('boss pool = bloodPoint[difficulty] × the players alive at the fight\'s start (solo × 1) × tuning; config restores the fixed pool; shared and never negative', () => {
  // DESIGN §25.13.4: the owner's decision of 2026-10-06 adopts PR #209 by @qingjingshenghuo (bloodPoint is one player's
  // share) and replaces the fixed pool of 「保持固定血量」 — config bossHpScale (perPlayer false, solo 0.25) restores it.
  // Research numbers (data/tuning.json left out).
  const { tuning, ...RAW } = DATA; // eslint-disable-line no-unused-vars
  const gd = new GameData(RAW, 'mode_multi_hard');
  for (const n of [1, 2, 3, 4]) assert.equal(bossPoolHp(gd, 'boss_1', n), 1800000 * n, `${n} alive`);
  assert.equal(bossPoolHp(gd, 'boss_1'), 1800000 * 4, 'no count given: a full team');
  assert.equal(bossPoolHp(gd, 'boss_1', 9), 1800000 * 4, 'at most aliveFull (4) players');
  assert.equal(gd.bossPoolHp('boss_1', 2), bossPoolHp(gd, 'boss_1', 2), 'GameData agrees');
  assert.equal(bossPoolHp(new GameData(RAW, 'mode_single_abyss'), 'boss_5', 1), 3000000, 'solo: the table value');
  assert.equal(bossPoolHp(new GameData(RAW, 'mode_single_funny'), 'boss_2', 1), 225000);
  // the flip back: the fixed pool of 0.1.x (perPlayer false; solo 0.25), and its optional × alive / 4 (aliveScaling)
  const withScale = (over) => ({ ...RAW, config: { ...RAW.config, bossHpScale: { ...RAW.config.bossHpScale, ...over } } });
  const fixed = withScale({ perPlayer: false, solo: 0.25 });
  for (const n of [4, 3, 2, 1, undefined, 9]) assert.equal(bossPoolHp(new GameData(fixed, 'mode_multi_hard'), 'boss_1', n), 1800000, `fixed pool, ${n} alive`);
  assert.equal(bossPoolHp(new GameData(fixed, 'mode_single_abyss'), 'boss_5', 1), 750000);
  assert.equal(bossPoolHp(new GameData(fixed, 'mode_single_funny'), 'boss_2', 1), 56250);
  const scaled = new GameData(withScale({ perPlayer: false, aliveScaling: true }), 'mode_multi_hard');
  assert.equal(bossPoolHp(scaled, 'boss_1', 4), 1800000);
  assert.equal(bossPoolHp(scaled, 'boss_1', 3), 1350000);
  assert.equal(bossPoolHp(scaled, 'boss_1', 2), 900000);
  assert.equal(bossPoolHp(scaled, 'boss_1', 1), 450000);
  assert.equal(bossPoolHp(scaled, 'boss_1'), 1800000, 'no count given: a full team');
  assert.equal(bossPoolHp(scaled, 'boss_1', 9), 1800000, 'never above the data value');
  // a mode's own entry overrides the global one
  const perMode = { ...RAW, config: { ...RAW.config, modes: { ...RAW.config.modes, mode_multi_hard: { ...RAW.config.modes.mode_multi_hard, bossHpScale: { ...RAW.config.modes.mode_multi_hard.bossHpScale, perPlayer: false } } } } };
  assert.equal(bossPoolHp(new GameData(perMode, 'mode_multi_hard'), 'boss_1', 3), 1800000, 'the mode entry first');
  assert.equal(bossPoolHp(new GameData(perMode, 'mode_multi_abyss'), 'boss_1', 3), 3600000 * 3, 'other modes keep the global rule');
  // the balance layer multiplies the pool (docs/BALANCE.md)
  for (const modeId of ['mode_single_funny', 'mode_multi_hard']) {
    const tuned = new GameData(DATA, modeId);
    const raw = new GameData(RAW, modeId);
    assert.equal(bossPoolHp(tuned, 'boss_2', 4), Math.max(1, Math.round(bossPoolHp(raw, 'boss_2', 4) * tuned.bossHpMul('boss_2'))));
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
    assert.equal(pool.maxHp, bossPoolHp(m.gd, m.bossId, n));
    for (const f of fields) {
      assert.deepEqual(f.opts.rect, GEO.BOSS_RECT);
      assert.equal(f.opts.modeId, 'mode_multi_funny', '#475: an unpaired field retains multiplayer mode despite its solo wave template');
      assert.equal(f.opts.timeLimit, Infinity);
      assert.equal(f.opts.flags.layerGainsEnabled, false);
      assert.deepEqual(f.opts.flags.enemyScale, m.gd.enemyScale(14), 'the round\'s enemy effects for the leader\'s summons (PR #272)');
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

test('all-human overtime: −1 team LP per REAL second after 120 real s (240 game s at 2×); team LP 0 ends every field → defeat (13 rounds passed)', () => {
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
  assert.ok(Math.abs(f.time - 280) < 2.5, `ended ≈ 240 + 2 × 20 game s (${f.time})`);
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
  // team LP > 1: PRTS and the community's measurement (路标月报#2, GitHub #645) — 1 LP left does not enter
  assert.equal(hiddenEligible(gd, { layerSum: 5000, teamLp: 1 }), false);
  assert.equal(hiddenEligible(gd, { layerSum: 5000, teamLp: 2 }), true);
  assert.equal(hiddenEligible(new GameData(DATA, 'mode_single_hard'), { layerSum: 351, teamLp: 1 }), false);
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
  const pair = m.fields.find(f => f.players.length === 2), lone = m.fields.find(f => f.players.length === 1);
  assert.deepEqual(m.fields.flatMap(f => f.players).sort(), ['p_0', 'p_1', 'p_2']);
  const [first, second] = pair.players, third = lone.players[0];
  assert.equal(m.handle(first, { t: 'g.watch', fieldId: lone.fieldId }).error, 'BAD_TARGET', 'the other group is hidden');
  assert.equal(m.handle(third, { t: 'g.watch', fieldId: pair.fieldId }).error, 'BAD_TARGET');
  assert.deepEqual(m.handle(second, { t: 'g.watch', fieldId: pair.fieldId }), { ok: true });
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b2' }), { ok: true }, 'an eliminated player spectates freely');
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b1' }), { ok: true });
  assert.equal(m.watchers.get(first), pair.fieldId, 'the refused watch keeps the default (own) field');
  // the prep-scouting id of a player of the other group is no way around the rule, and never detaches the viewer
  const scouted = h.allTo(first, 'm.field').length;
  assert.deepEqual(m.handle(first, { t: 'g.watch', fieldId: `n:${third}` }), { error: 'BAD_TARGET', detail: 'no such field' });
  assert.deepEqual(m.handle(first, { t: 'g.watch', fieldId: `n:${second}` }), { error: 'BAD_TARGET', detail: 'no such field' });
  assert.equal(h.allTo(first, 'm.field').length, scouted, 'no board of the other group was sent');
  assert.equal(m.watchers.get(first), pair.fieldId, 'still streaming the own boss field');
  const snaps = h.allTo(first, 'b.snap').length;
  h.sched.advance(500);
  assert.ok(h.allTo(first, 'b.snap').length > snaps, 'snapshots of the own field keep coming');
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
