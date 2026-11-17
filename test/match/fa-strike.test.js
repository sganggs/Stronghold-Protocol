// §37.64 阿利斯泰尔's 【王权号令】 (content/bosses.js PLUS_STRIKE) strikes a random operator within its rangeRadius and the
// four tiles beside it: the boss model marks the own tiles it may pick, and one more body plan per lineup is spaced
// against it, rehearsed after every other candidate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, faDamageLineups, fieldModel } from '../../server/match/bot.js';
import { parseKey } from '../../server/match/board.js';
import { makeMatch, give } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
const IDS = ['4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '3_12_a', '1_01_a', '2_03_a', '6_12_a', '5_21_a'];

function bossRound(bossId) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seats: SEAT, seed: 7, botRehearsal: 3 }).start().toPrep();
  const m = h.m, ps = m.order[0];
  m.bossId = bossId;
  m.startRound(m.gd.bossRound);
  m.phase = 'PREP'; // the boss round's prep (startRound leaves the round start)
  for (const id of IDS) give(m, ps, `chess_char_${id}`, 'hand');
  return { h, m, ps };
}

/** Pairs of planned tiles side by side with at least one where the strike may pick its target. */
function crowded(plan, strike) {
  const keys = [...plan.values()];
  let n = 0;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const [a, b] = [parseKey(keys[i]), parseKey(keys[j])];
    if ((strike.has(keys[i]) || strike.has(keys[j])) && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1) n++;
  }
  return n;
}

test('§37.64: the boss model marks where 阿利斯泰尔\'s plus-shaped strike may pick its target', () => {
  const { h, m, ps } = bossRound('boss_6');
  try {
    const lead = fieldModel(m, ps, true).lead;
    assert.ok(lead && lead.strike && lead.strike.size > 0, 'a self-bound leader with a plus strike');
    // the leader stands on (3,10) of the boss field: board (10,10) for the left player, its rangeRadius 3.4
    const want = ['9,7', '9,8', '9,9', '9,10', '10,7', '10,8', '10,9', '10,10', '11,7', '11,8', '11,9', '11,10', '12,8', '12,9', '12,10'];
    assert.deepEqual([...lead.strike].sort(), want.sort());
  } finally { h.m.dispose(); }
  const other = bossRound('boss_3');
  try {
    const lead = fieldModel(other.m, other.ps, true).lead;
    assert.ok(lead, '管 is self-bound');
    assert.equal(lead.strike, null, 'and has no plus strike');
  } finally { other.h.m.dispose(); }
});

test('§37.64: a spaced body plan is rehearsed after every other candidate', () => {
  const { h, m, ps } = bossRound('boss_6');
  try {
    const job = arrange(m, ps, { final: true, defer: true });
    assert.ok(job, 'the boss round is rehearsed');
    const strike = fieldModel(m, ps, true).lead.strike;
    const chosen = job.chosen.filter((p) => job.plans[0].lineup.has(p.uid));
    const lineups = faDamageLineups(m, ps, chosen);
    assert.ok(lineups.length >= 1, 'the fixture has damage lineups');
    const isDamage = (pl) => lineups.some((d) => JSON.stringify(pl.swaps) === JSON.stringify(d.swaps));
    const firstDamage = job.plans.findIndex(isDamage);
    // the default lineup's spaced plan: its last plan, after the damage lineups (§37.62)
    const at = job.plans.findLastIndex((pl) => !pl.swaps);
    assert.ok(firstDamage > 0 && at > firstDamage, `spaced plan at ${at}, the damage lineups from ${firstDamage}`);
    assert.ok(crowded(job.plans[at], strike) < crowded(job.plans[0], strike),
      `fewer units side by side in its reach: ${crowded(job.plans[at], strike)} < ${crowded(job.plans[0], strike)}`);
    assert.ok(job.plans.slice(at + 1).every(isDamage), 'then only the damage lineups\' spaced plans');
    assert.equal(job.plans.slice(at + 1).length, lineups.length, 'one for each damage lineup');
  } finally { h.m.dispose(); }
  const other = bossRound('boss_3');
  try {
    const job = arrange(other.m, other.ps, { final: true, defer: true });
    const chosen = job.chosen.filter((p) => job.plans[0].lineup.has(p.uid));
    const lineups = faDamageLineups(other.m, other.ps, chosen);
    const firstDamage = job.plans.findIndex((pl) => lineups.some((d) => JSON.stringify(pl.swaps) === JSON.stringify(d.swaps)));
    assert.ok(job.plans.findLastIndex((pl) => !pl.swaps) < firstDamage, '管: no spaced plan');
  } finally { other.h.m.dispose(); }
});
