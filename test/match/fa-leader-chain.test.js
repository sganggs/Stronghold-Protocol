// §37.33 Final Assault candidate aimed at the leader's route (round-54 agent games): the blockers on consecutive tiles
// of the route where the leader passes most, facing the way it comes, every chosen piece once on a legal tile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldModel, planLayout, leaderChainPlan } from '../../server/match/bot.js';
import { legalTiles, tileKey, parseKey, placeClass, basePositionClass } from '../../server/match/board.js';
import { makeMatch, give } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
const IDS = ['4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '3_12_a', '1_01_a', '2_03_a'];

function bossRound() {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seats: SEAT, seed: 7, botRehearsal: 3 }).start().toPrep();
  const m = h.m, ps = m.order[0];
  m.startRound(m.gd.bossRound);
  const pieces = IDS.map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
  const blocker = (p) => { const r = ps.gd.chess(p.id); return basePositionClass(r) === 'melee' && (r.stats?.blockCnt ?? 1) > 0 && r.attackKind !== 'none'; };
  return { h, m, ps, pieces, blocker };
}

function assertLegal(ps, pieces, plan) {
  assert.equal(plan.size, pieces.length, 'every chosen piece is placed');
  assert.equal(new Set(plan.values()).size, pieces.length, 'one piece per tile');
  for (const p of pieces) {
    const legal = legalTiles(ps.deployMap(), placeClass(ps, ps.gd.chess(p.id))).map(([r, c]) => tileKey(r, c));
    assert.ok(legal.includes(plan.get(p.uid)), `${p.id} stands on a legal tile`);
    assert.ok(['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(plan.dirOf(p.uid)));
  }
}

test('the chain puts the blockers on consecutive leader-route tiles, facing the incoming leader', () => {
  const { h, m, ps, pieces, blocker } = bossRound();
  try {
    const lead = fieldModel(m, ps).routes.find((rt) => !rt.fly && rt.dwell > 0);
    assert.ok(lead, 'the boss wave has a leader route');
    const blockers = pieces.filter(blocker);
    assert.ok(blockers.length >= 2, 'the fixture has blockers');
    const chain = leaderChainPlan(m, ps, pieces, planLayout(m, ps, pieces));
    assertLegal(ps, pieces, chain);
    const order = [];
    for (const k of lead.tiles) if (!order.includes(k)) order.push(k);
    const at = blockers.map((p) => order.indexOf(chain.get(p.uid))).filter((i) => i >= 0).sort((a, b) => a - b);
    assert.ok(at.length >= 2, 'blockers stand on the leader route');
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 1, 'distinct route tiles');
    for (const p of blockers) {
      const key = chain.get(p.uid), i = lead.tiles.indexOf(key);
      if (i <= 0) continue;
      const [r, c] = parseKey(key), [pr, pc] = parseKey(lead.tiles[i - 1]);
      const want = pr > r ? 'UP' : pr < r ? 'DOWN' : pc < c ? 'LEFT' : 'RIGHT';
      assert.equal(chain.dirOf(p.uid), want, `${p.id} faces the tile the leader comes from`);
    }
  } finally { h.dispose?.(); }
});

test('a normal round (and the hidden core, not measured) has no leader candidate', () => {
  const { h, m, ps, pieces } = bossRound();
  try {
    if (m.gd.hiddenRound) {
      const real = m.round;
      m.round = m.gd.hiddenRound;
      assert.equal(leaderChainPlan(m, ps, pieces, planLayout(m, ps, pieces)), null, 'no candidate in the hidden core');
      m.round = real;
    }
    m.startRound(1);
    assert.ok(m.wave, 'a normal round');
    assert.equal(leaderChainPlan(m, ps, pieces, planLayout(m, ps, pieces)), null);
  } finally { h.dispose?.(); }
});
