// Final Assault layout rehearsal (0.3.2, #315): an independent seed, a bounded cap, no live RNG or board writes; the
// boss field's own ranking (§37.61: leader damage less a leak's cost first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeed } from '../../server/sim/rng.js';
import { FA_LEAK_SECONDS } from '../../server/sim/rehearsal.js';
import { fieldModel, planLayout, createRehearsal, faRehearsalSeed, faRehearsalTicks } from '../../server/match/bot.js';
import { legalTiles, tileKey, placeClass } from '../../server/match/board.js';
import { makeMatch, give, checkInvariants } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];

test('Final Assault rehearsal uses an independent seed and the fight\'s own ranking', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seats: SEAT, seed: 7, botRehearsal: 3 }).start().toPrep();
  const m = h.m;
  const ps = m.order[0];
  try {
    m.startRound(m.gd.bossRound);
    assert.equal(m.wave, null);
    assert.ok(m.bossGroupOf(ps), 'the boss wave is already planned');
    const pieces = ['4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '3_12_a']
      .map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
    const good = planLayout(m, ps, pieces);
    const covered = new Set(fieldModel(m, ps).routes.flatMap((r) => r.tiles));
    const bad = new Map();
    bad.dirs = new Map();
    const taken = new Set();
    for (const p of pieces) {
      const tiles = [...legalTiles(ps.deployMap(), placeClass(ps, ps.gd.chess(p.id)))].map(([r, c]) => tileKey(r, c));
      const off = tiles.find((k) => !covered.has(k) && !taken.has(k)) || tiles.find((k) => !taken.has(k));
      assert.ok(off, `${p.id} has a legal tile`);
      taken.add(off);
      bad.set(p.uid, off);
      bad.dirs.set(p.uid, 'LEFT');
    }
    assert.notDeepEqual([...good.entries()], [...bad.entries()], 'the two layouts differ');
    const waveBefore = JSON.stringify(m.bossWaves);
    const rngs = () => [m.rngWaves, m.rngBots, m.rngMeta, m.rngShop, m.rngDraft, m.rngSetup].map((r) => r.state());
    const rngBefore = rngs();
    const hand = ps.hand.map((p) => p && p.uid);
    const board = [...ps.board.keys()];
    const seen = [];
    const orig = m.newBattle.bind(m);
    m.newBattle = (opts, options) => {
      const battle = orig(opts, options);
      const result = battle.result.bind(battle);
      battle.result = () => {
        const r = result();
        if (battle.finished) seen.push(r);
        return r;
      };
      return battle;
    };
    const job = createRehearsal(m, ps, pieces, [good, bad]);
    assert.ok(job, 'two distinct boss layouts are rehearsed');
    assert.equal(job.cap, faRehearsalTicks(m));
    assert.equal(job.cap, 120 * 2 * 30, 'the visible countdown is 120 real seconds at the 2× clock');
    const seed = faRehearsalSeed(m, ps);
    assert.equal(job.inputs[0].seed, seed);
    assert.equal(job.inputs[1].seed, seed);
    assert.notEqual(seed, deriveSeed(m.seed, `b1:${m.round}`));
    assert.notEqual(seed, deriveSeed(m.seed, `fa:${m.round}:${ps.seat}`));
    assert.equal(job.inputs[0].kind, 'boss');
    assert.equal(job.inputs[0].timeLimit, Infinity);
    assert.equal(job.inputs[0].flags.layerGainsEnabled, false);
    assert.equal(job.inputs[0].fieldId, `rb:${ps.playerId}`);
    assert.equal(job.inputs[0].boss.poolHp, job.inputs[0].boss.poolMax);
    assert.notEqual(job.inputs[0].sharedBoss, job.inputs[1].sharedBoss);
    assert.equal(m.bossPool ?? null, null, 'prep does not open the live pool');
    assert.deepEqual(rngs(), rngBefore, 'building the candidates does not draw a live rng');
    assert.equal(JSON.stringify(m.bossWaves), waveBefore);
    job.run();
    assert.equal(job.done, true);
    assert.deepEqual(rngs(), rngBefore, 'stepping the rehearsal does not draw a live rng');
    assert.equal(JSON.stringify(m.bossWaves), waveBefore);
    assert.deepEqual(ps.hand.map((p) => p && p.uid), hand);
    assert.deepEqual([...ps.board.keys()], board);
    assert.equal(m.errorCount, 0);
    const scored = seen.map((r) => {
      const pp = r.perPlayer[ps.playerId];
      return {
        leaks: (pp.leaked || []).filter((l) => l && l.counted !== false).length,
        boss: pp.bossDamage || 0,
        killed: pp.killed || 0,
      };
    });
    assert.ok(scored.length >= 1, 'at least one candidate was scored');
    assert.ok(scored.some((s) => s.boss > 0), `a layout reached the leader ${JSON.stringify(scored)}`);
    // §37.61: a boss field ranks leader damage × (1 − leaks / FA_LEAK_SECONDS) first and stops no candidate early
    const value = (x) => x.boss * Math.max(0, 1 - x.leaks / FA_LEAK_SECONDS);
    const rank = (a, b) => (Math.abs(value(a) - value(b)) > 1e-6 ? value(b) - value(a) : 0)
      || a.leaks - b.leaks || b.boss - a.boss || b.killed - a.killed;
    assert.equal(scored.length, 2, 'both boss candidates are scored (no early stop on a boss field)');
    assert.equal(job.best, rank(scored[0], scored[1]) <= 0 ? good : bad);
    checkInvariants(m);
  } finally { m.dispose(); }
});
