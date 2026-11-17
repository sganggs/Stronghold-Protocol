// Real rehearsal integration. Run only after approval for the three fixed setups below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, DATA } from './harness.js';
import { simulateRehearsal } from './simClient.js';
import { planLayout, REHEARSAL_VARIANTS, LAYOUT_PARAMS, runSteps, contactCandidatePlansSteps,
  createRehearsalSteps } from '../../server/match/bot.js';

for (const seed of [7, 11, 19]) test(`contact candidates: server, host-spec and takeover agree (seed ${seed})`, () => {
  const h = makeMatch({ mode: 'coop', humans: 2, difficulty: 'HARD', seed, botRehearsal: 3,
    hostId: 'p_0', botRehearsalDelegate: true }).start().toPrep();
  const m = h.m, ps = m.order[1];
  try {
    ps.isBot = true;
    const records = Object.values(DATA.chess).filter(c => c.visible && !c.isGolden && c.tier === 1);
    const roster = [...records.filter(c => c.position === 'MELEE' && c.attackKind === 'melee').slice(0, 2),
      ...records.filter(c => c.position === 'RANGED' && c.attackKind === 'ranged').slice(0, 3)];
    assert.equal(roster.length, 5);
    const chosen = roster.map(c => give(m, ps, c.chessId));
    assert.ok(chosen.length <= ps.deployCap);
    const originals = REHEARSAL_VARIANTS.map(v => planLayout(m, ps, chosen, { ...LAYOUT_PARAMS, ...v }));
    const plans = runSteps(contactCandidatePlansSteps(m, ps, chosen, originals));
    assert.equal(plans[0], originals[0]);
    const snapshot = () => JSON.stringify({ board: [...ps.board], hand: ps.hand, funds: ps.funds,
      layers: ps.layers, bonds: ps.bonds, pool: m.pool.snapshot(), uid: m.uidSeq });
    const before = snapshot();
    const local = runSteps(createRehearsalSteps(m, ps, chosen, plans));
    assert.ok(local && local.inputs.length >= 2 && local.inputs.length <= 3);
    local.run();
    const localIndex = local.plans.indexOf(local.best);
    const hostJob = runSteps(createRehearsalSteps(m, ps, chosen, plans, { delegate: true }));
    assert.equal(hostJob.pending, true);
    const frame = h.lastTo('p_0', 'b.rehearsal');
    const hostIndex = simulateRehearsal(frame, m.ds);
    assert.equal(hostIndex, localIndex);
    m._onRehearsalResult(m.players.get('p_0'), { taskId: frame.taskId, choice: hostIndex });
    assert.equal(hostJob.done, true);
    assert.equal(hostJob.best, local.best);
    const fallback = runSteps(createRehearsalSteps(m, ps, chosen, plans, { delegate: true }));
    const retry = h.lastTo('p_0', 'b.rehearsal');
    m._onRehearsalResult(m.players.get('p_0'), { taskId: retry.taskId, error: true });
    assert.equal(fallback.pending, false);
    fallback.run();
    assert.equal(fallback.best, local.best);
    assert.equal(snapshot(), before, 'preview and replay preserve live economy and placement');
    assert.equal(m.errorCount, 0);
  } finally { m.dispose(); }
});
