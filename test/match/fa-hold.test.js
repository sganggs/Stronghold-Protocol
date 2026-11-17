// §37.74 卢西恩 (boss_5) in the Final Assault: his loop is modeled on the path the sim walks (the flow-field path between
// his patrol checkpoints, not straight lines through fences), and hold candidates put the blockers next to the dead end
// of the loop, where a blink is cut short, with the other units' ranges on the tiles where he is held.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldModel, planLayout, leaderHoldPlansSteps, runSteps, rangeRec, rangeTiles } from '../../server/match/bot.js';
import { legalTiles, tileKey, parseKey, placeClass, basePositionClass, fieldTile } from '../../server/match/board.js';
import { Grid } from '../../server/sim/grid.js';
import { GEO } from '../../shared/constants.js';
import { makeMatch, give } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
const IDS = ['4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '3_12_a', '1_01_a', '2_03_a'];

function bossRound(bossId = 'boss_5', stageId = 'act1autochess_m03') {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seats: SEAT, seed: 7, botRehearsal: 3 }).start().toPrep();
  h.setStage(stageId);
  const m = h.m, ps = m.order[0];
  m.bossId = bossId;
  m.startRound(m.gd.bossRound);
  const pieces = IDS.map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
  const blocker = (p) => { const r = ps.gd.chess(p.id); return basePositionClass(r) === 'melee' && (r.stats?.blockCnt ?? 1) > 0 && r.attackKind !== 'none'; };
  return { h, m, ps, pieces, blocker };
}

const leadRoute = (m, ps) => fieldModel(m, ps).routes.find((rt) => !rt.fly && (rt.lead || rt.dwell > 0));

/** Every tile of the leader's modeled route is walkable on the boss field and touches the one before it. */
function assertWalked(m, ps, lead) {
  const st = m.stage;
  const grid = new Grid({ ...st, legend: st.tiles }, GEO.BOSS_RECT);
  for (let i = 0; i < lead.tiles.length; i++) {
    const [r, c] = parseKey(lead.tiles[i]);
    const [fr, fc] = fieldTile('bossL', r, c);
    assert.ok(grid.groundPassable(fr, fc), `${lead.tiles[i]} (field ${fr},${fc}) is walkable`);
    if (i) {
      const [pr, pc] = parseKey(lead.tiles[i - 1]);
      assert.ok(Math.max(Math.abs(r - pr), Math.abs(c - pc)) <= 1, 'consecutive tiles touch');
    }
  }
}

test('§37.74: 卢西恩\'s loop is the ground path the sim walks, not straight lines through the fences', () => {
  const { h, m, ps } = bossRound();
  try {
    const lead = leadRoute(m, ps);
    assert.ok(lead, 'the leader route');
    assertWalked(m, ps, lead);
    // act1 m03: west along boss row 2 to the dead end (2,3), back to (2,6), down col 6, east along row 5
    const first = lead.tiles.slice(0, 18).join(' ');
    assert.equal(first, '11,10 10,9 9,9 9,8 9,7 9,6 9,5 9,4 9,3 9,4 9,5 9,6 10,6 11,6 12,6 12,7 12,8 12,9');
    assert.ok(!lead.tiles.includes('10,7') && !lead.tiles.includes('10,8'), 'never through the fences at boss (3,7) / (3,8)');
  } finally { h.dispose?.(); }
});

test('§37.74: 铳 walks the same checkpoints and is modeled on its path too', () => {
  const { h, m, ps } = bossRound('boss_2');
  try {
    const lead = leadRoute(m, ps);
    assert.ok(lead, 'the leader route');
    assertWalked(m, ps, lead);
    assert.ok(lead.tiles.includes('9,3'), 'it turns at the dead end (2,3) too');
    // from the last checkpoint (5,9) it goes back to the first (3,9), never on to the goal (sim bosses.js patrolLoop)
    const walked = lead.tiles.join(' ');
    assert.ok(walked.endsWith('12,8 12,9 11,9'), `closes on the first checkpoint: ${walked}`);
    assert.ok(!walked.includes('12,9 12,8'), 'no leg back along row 5 towards the goal');
  } finally { h.dispose?.(); }
});

test('§37.74: the hold plans put the blockers on the path tiles nearest the dead end, the rest on the hold', () => {
  const { h, m, ps, pieces, blocker } = bossRound();
  try {
    const blockers = pieces.filter(blocker);
    assert.ok(blockers.length >= 2, 'the fixture has blockers');
    const plans = runSteps(leaderHoldPlansSteps(m, ps, pieces));
    assert.equal(plans.length, 2, 'packed and spaced');
    const lead = leadRoute(m, ps);
    const melee = new Set(legalTiles(ps.deployMap(), 'melee').map(([r, c]) => tileKey(r, c)));
    for (const plan of plans) {
      assert.equal(plan.size, pieces.length, 'every piece placed');
      assert.equal(new Set(plan.values()).size, pieces.length, 'one piece per tile');
      for (const p of pieces) {
        const legal = legalTiles(ps.deployMap(), placeClass(ps, ps.gd.chess(p.id))).map(([r, c]) => tileKey(r, c));
        assert.ok(legal.includes(plan.get(p.uid)), `${p.id} on a legal tile`);
      }
      const at = blockers.map((p) => plan.get(p.uid));
      for (const k of at) assert.ok(lead.tiles.includes(k) && melee.has(k), `blocker on the leader's path (${k})`);
    }
    // packed: the dead end (board 9,3) and the next path tiles back along row 9
    const packed = plans[0];
    const want = ['9,3', '9,4', '9,5', '9,6', '10,6', '9,7'].slice(0, blockers.length);
    assert.deepEqual(blockers.map((p) => packed.get(p.uid)).sort(), want.sort());
    // the other units reach the hold more often than in the default plan
    const hold = new Set(['9,3', '9,4', '9,5', '9,6', '9,7']);
    const reach = (plan) => pieces.filter((p) => !blockers.includes(p)).filter((p) => {
      const [r, c] = parseKey(plan.get(p.uid));
      return rangeTiles(rangeRec(ps, ps.gd.chess(p.id)), r, c, plan.dirOf(p.uid)).some((k) => hold.has(k));
    }).length;
    assert.ok(reach(packed) > reach(planLayout(m, ps, pieces)), `${reach(packed)} ranges on the hold`);
  } finally { h.dispose?.(); }
});

test('§37.74: in a pair the right seat (mirrored half) is held at its own dead end too', () => {
  const seats = [0, 1].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', seats, seed: 7, botRehearsal: 3 }).start().toPrep();
  try {
    h.setStage('act1autochess_m03');
    const m = h.m;
    m.bossId = 'boss_5';
    m.startRound(m.gd.bossRound);
    const sides = [];
    for (const ps of m.order) {
      sides.push(m.bossGroupOf(ps).side);
      const pieces = IDS.map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
      const lead = leadRoute(m, ps);
      assert.ok(lead && lead.tiles.includes('9,3'), `${ps.playerId}: its loop turns at board (9,3)`);
      const [packed] = runSteps(leaderHoldPlansSteps(m, ps, pieces));
      assert.ok(packed && [...packed.values()].includes('9,3'), `${ps.playerId}: a blocker at its dead end`);
    }
    assert.deepEqual(sides.sort(), ['L', 'R']);
  } finally { h.dispose?.(); }
});

test('§37.74: no hold plans for a leader that does not blink, nor in a normal round', () => {
  for (const id of ['boss_2', 'boss_3']) {
    const { h, m, ps, pieces } = bossRound(id);
    try {
      assert.deepEqual(runSteps(leaderHoldPlansSteps(m, ps, pieces)), [], `${id}: none`);
    } finally { h.dispose?.(); }
  }
  const { h, m, ps, pieces } = bossRound();
  try {
    m.startRound(1);
    assert.ok(m.wave);
    assert.deepEqual(runSteps(leaderHoldPlansSteps(m, ps, pieces)), []);
  } finally { h.dispose?.(); }
});
