import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, checkInvariants } from './harness.js';
import { createIoletaPrepSteps } from '../../server/match/botIoleta.js';
import { runSteps, arrangeSteps, contactCandidatePlansSteps, createBotPrepSteps } from '../../server/match/bot.js';

// Each adaptive strategy against the same procurement with the fixed three-candidate placement: procurement, RNG and
// strategy state match, the adaptive candidates start with the fixed three and the search stays within its budget.
const contact = (m, ps, opts = {}) => arrangeSteps(m, ps, { ...opts, candidatePlans: contactCandidatePlansSteps });
const fixedFor = { 'adaptive': createBotPrepSteps({ arrangeSteps: contact }),
  'ioleta-adaptive': createIoletaPrepSteps({ arrangeSteps: contact }) };
const signature = plan => [...plan].map(([uid, tile]) => [uid, tile, plan.dirs.get(uid)]);
for (const strategy of ['adaptive', 'ioleta-adaptive']) for (const band of ['band_ioleta', 'band_amiya', 'band_cannot', 'band_amedic']) {
  test(`${strategy} ${band}: identical procurement/RNG and fixed-three candidate prefix`, t => {
    const states = [], jobs = [];
    for (const adaptive of [false, true]) {
      const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 19, botStrategy: strategy, botRehearsal: 3 }).start().toPrep();
      t.after(() => h.m.dispose());
      const m = h.m, ps = m.order[0], prep = adaptive ? m.bot : fixedFor[strategy];
      ps.bandId = band; ps.funds = 8;
      const job = runSteps(prep.prepBegin(m, ps, { delegate: false }));
      states.push({ funds: ps.funds, level: ps.shop.level, chess: ps.allChess().map(p => p.id).sort(),
        buys: ps.stats.buys, rng: m.rngBots.state(), state: ps.botStrategyState });
      jobs.push(job);
      assert.ok(job); assert.ok(job.plans.length <= (adaptive ? 8 : 3));
      job.run(); runSteps(prep.prepEnd(m, ps, job));
      assert.ok(ps.ready); checkInvariants(m); assert.deepEqual(h.logs.error, []);
    }
    assert.deepEqual(states[0], states[1]);
    assert.deepEqual(jobs[1].plans.slice(0, jobs[0].plans.length).map(signature), jobs[0].plans.map(signature));
    assert.ok(jobs[1].stats.totalTicks <= 6 * jobs[1].cap);
  });
}

// `adaptive` keeps legacy procurement for Russell too: same purchases, RNG and (absent) strategy state as legacy.
test('adaptive band_ioleta: legacy procurement, no Russell plan', t => {
  const states = [];
  for (const botStrategy of ['legacy', 'adaptive']) {
    const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 19, botStrategy, botRehearsal: 3 }).start().toPrep();
    t.after(() => h.m.dispose());
    const m = h.m, ps = m.order[0];
    ps.bandId = 'band_ioleta'; ps.funds = 8;
    const job = runSteps(m.bot.prepBegin(m, ps, { delegate: false }));
    states.push({ funds: ps.funds, level: ps.shop.level, chess: ps.allChess().map(p => p.id).sort(),
      buys: ps.stats.buys, rng: m.rngBots.state(), state: ps.botStrategyState ?? null });
    job?.run(); runSteps(m.bot.prepEnd(m, ps, job));
    assert.ok(ps.ready); checkInvariants(m);
  }
  assert.deepEqual(states[0], states[1]);
  assert.equal(states[1].state?.ioleta, undefined);
});
