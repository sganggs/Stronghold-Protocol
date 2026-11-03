// §37.61 Final Assault candidates on a self-bound leader's body: 胄, 管, 昆图斯, 阿利斯泰尔 and “萨米的意志” (content/bosses.js
// SELF_BOUND) stand on their spawn tile all fight and are hit anywhere on their 5 × 3 body (data hitArea, sim body.js).
// The default model walks them down their route; the body model (fieldModel(m, ps, true)) makes the body the leader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldModel, planLayout, rangeRec, rangeTiles, LAYOUT_PARAMS } from '../../server/match/bot.js';
import { parseKey } from '../../server/match/board.js';
import { makeMatch, give } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
const IDS = ['4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '3_12_a', '1_01_a', '2_03_a'];

function bossRound(bossId) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seats: SEAT, seed: 7, botRehearsal: 3 }).start().toPrep();
  const m = h.m, ps = m.order[0];
  m.bossId = bossId;
  m.startRound(m.gd.bossRound);
  const pieces = IDS.map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
  return { h, m, ps, pieces };
}

test('§37.61: a self-bound leader is its body where it spawns; the default model still walks it', () => {
  const { h, m, ps } = bossRound('boss_3');
  try {
    const wave = m.bossGroupOf(ps).wave;
    const lead = wave.spawns.find((s) => s.tag === 'boss');
    assert.equal(lead.enemyKey, 'enemy_9021_acduml', '假想敌：管 leads the wave');
    assert.deepEqual(wave.routes[lead.routeIndex].start, [3, 10], 'it spawns on field (3, 10)');
    const def = fieldModel(m, ps);
    assert.equal(def.lead, null);
    assert.ok(def.routes.some((rt) => !rt.fly && rt.dwell > 0), 'the default model walks the leader down its route');
    const body = fieldModel(m, ps, true);
    assert.notEqual(body, def, 'the body model has its own cache slot');
    assert.equal(fieldModel(m, ps), def, 'the default model stays cached');
    assert.ok(!body.routes.some((rt) => rt.dwell > 0), 'no leader route in the body model');
    // the 4.95 × 2.95 body one row below the spawn: field rows 3–5 × cols 8–12 = board rows 10–12 (cols 11–12 off the
    // deploy area but in reach of a range)
    const want = [];
    for (let r = 10; r <= 12; r++) for (let c = 8; c <= 12; c++) want.push(`${r},${c}`);
    assert.deepEqual([...body.lead.tiles].sort(), want.sort());
  } finally { h.dispose?.(); }
});

test('§37.61: the body model pulls the damage dealers\' ranges onto the body', () => {
  const { h, m, ps, pieces } = bossRound('boss_3');
  try {
    const tiles = fieldModel(m, ps, true).lead.tiles;
    const touching = (plan) => pieces.filter((p) => {
      const [r, c] = parseKey(plan.get(p.uid));
      return rangeTiles(rangeRec(ps, ps.gd.chess(p.id)), r, c, plan.dirOf(p.uid)).some((k) => tiles.has(k));
    }).length;
    const base = planLayout(m, ps, pieces);
    // the candidate's weight is a trade with the escorts' road: a plan of its own, not the default one
    const body = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, body: 0.005 });
    assert.equal(body.size, pieces.length, 'every piece is placed');
    assert.notDeepEqual([...body.entries()], [...base.entries()], 'a distinct candidate');
    // a dominant weight: every dealer that can reach the body does (the medic 白面鸮 heals, 崖心 deals no DPS)
    const heavy = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, body: 1 });
    assert.ok(touching(heavy) > touching(base), `${touching(heavy)} > ${touching(base)} ranges on the body`);
    assert.equal(touching(heavy), pieces.length - 2);
  } finally { h.dispose?.(); }
});

test('§37.61: a walking leader and a normal round have no body', () => {
  const { h, m, ps } = bossRound('boss_5');
  try {
    assert.equal(fieldModel(m, ps, true).lead, null, '卢西恩 walks: no body model');
    m.startRound(1);
    assert.ok(m.wave, 'a normal round');
    assert.equal(fieldModel(m, ps, true), fieldModel(m, ps), 'a normal round has the default model only');
  } finally { h.dispose?.(); }
});
