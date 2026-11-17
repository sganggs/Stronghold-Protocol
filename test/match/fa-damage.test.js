// §37.62 Final Assault lineups re-chosen for damage: chooseLineup with a DPS weight and without the blocker and solo healer
// terms. A lineup that differs from the default one joins the boss rehearsal after the usual candidates, and the
// rehearsed lineup's swaps put its incoming pieces on the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, botPrepEnd, effDps, faDamageLineups, fieldModel, rangeRec } from '../../server/match/bot.js';
import { makeMatch, give } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
// the fa-body fixture (白面鸮 heals, 瑕光 guards, 崖心 hooks) and two more dealers for the bench: 迷迭香 (6), 寒檀 (5)
const IDS = ['4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '3_12_a', '1_01_a', '2_03_a', '6_12_a', '5_21_a'];

function bossRound(bossId) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seats: SEAT, seed: 7, botRehearsal: 3 }).start().toPrep();
  const m = h.m, ps = m.order[0];
  m.bossId = bossId;
  m.startRound(m.gd.bossRound);
  m.phase = 'PREP'; // the boss round's prep (startRound leaves the round start)
  const pieces = IDS.map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
  return { h, m, ps, pieces };
}

const dpsOf = (m, ps, set) => set.reduce((s, p) => s + effDps(fieldModel(m, ps), rangeRec(ps, ps.gd.chess(p.id))), 0);
const sameSwaps = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The default lineup of a deferred Final Assault arrangement, its damage lineups and the rehearsal job. */
function prepared(m, ps) {
  const job = arrange(m, ps, { final: true, defer: true });
  assert.ok(job, 'the boss round is rehearsed');
  const chosen = job.chosen.filter((p) => job.plans[0].lineup.has(p.uid));
  return { job, chosen, lineups: faDamageLineups(m, ps, chosen) };
}

test('§37.62: a damage lineup trades deployed support for bench damage and is rehearsed after the usual candidates', () => {
  const { h, m, ps } = bossRound('boss_2');
  try {
    const { job, chosen, lineups } = prepared(m, ps);
    assert.equal(chosen.length, ps.deployCap, 'the default lineup fills the deploy cap');
    assert.ok(lineups.length >= 1, 'a damage lineup differs from the default one');
    assert.ok(lineups.some((d) => dpsOf(m, ps, d.set) > dpsOf(m, ps, chosen)), 'one deals more DPS on the boss field');
    const firstDamage = job.plans.findIndex((pl) => lineups.some((d) => sameSwaps(pl.swaps, d.swaps)));
    assert.ok(firstDamage > 0, 'the default plan stays first');
    for (const d of lineups) {
      assert.equal(d.set.length, chosen.length, 'one piece in for each one out');
      assert.equal(d.swaps.length, d.ins.length);
      for (const q of d.ins) assert.ok(job.chosen.some((p) => p.uid === q.uid), 'the incoming pieces are rehearsed');
      const plans = job.plans.filter((pl) => sameSwaps(pl.swaps, d.swaps));
      assert.ok(plans.length >= 1, 'the lineup is a candidate');
      // 铳 walks: the default plan and the leader chain (when the lineup has a blocker for it)
      for (const pl of plans) assert.deepEqual([...pl.lineup].sort(), d.set.map((p) => p.uid).sort());
    }
    // the usual candidates keep their places: none of them comes after a damage lineup
    assert.ok(job.plans.slice(firstDamage).every((pl) => lineups.some((d) => sameSwaps(pl.swaps, d.swaps))));
  } finally { h.dispose?.(); }
});

test('§37.62: a self-bound leader\'s damage lineups also get the body plan', () => {
  const { h, m, ps } = bossRound('boss_3');
  try {
    const { job, lineups } = prepared(m, ps);
    assert.ok(fieldModel(m, ps, true).lead, '管 is self-bound');
    assert.ok(lineups.length >= 1);
    const plans = job.plans.filter((pl) => lineups.some((d) => sameSwaps(pl.swaps, d.swaps)));
    assert.ok(plans.length > lineups.length, 'a body plan beside a default plan');
  } finally { h.dispose?.(); }
});

test('§37.62: the rehearsed damage lineup puts its pieces on the board', () => {
  const { h, m, ps } = bossRound('boss_2');
  try {
    const { job, chosen, lineups } = prepared(m, ps);
    assert.deepEqual([...ps.board.values()].filter((p) => p.kind === 'chess').map((p) => p.uid).sort(), chosen.map((p) => p.uid).sort(),
      'the default lineup is deployed while the rehearsal runs');
    const d = lineups.at(-1);
    const best = job.plans.find((pl) => sameSwaps(pl.swaps, d.swaps));
    botPrepEnd(m, ps, { done: true, plans: job.plans, best, chosen: job.chosen });
    const board = [...ps.board.values()].filter((p) => p.kind === 'chess').map((p) => p.uid).sort();
    assert.deepEqual(board, d.set.map((p) => p.uid).sort(), 'the damage lineup is deployed');
    for (const [out] of d.swaps) assert.notEqual(ps.find(out)?.area, 'board', 'the replaced piece left the board');
    for (const p of d.set) assert.equal(ps.find(p.uid).key, best.get(p.uid), 'every piece on its planned tile');
  } finally { h.dispose?.(); }
});

test('§37.62: a normal round has no damage lineups', () => {
  const { h, m, ps, pieces } = bossRound('boss_2');
  try {
    m.startRound(1);
    assert.ok(m.wave, 'a normal round');
    assert.deepEqual(faDamageLineups(m, ps, pieces.slice(0, 8)), []);
  } finally { h.dispose?.(); }
});
