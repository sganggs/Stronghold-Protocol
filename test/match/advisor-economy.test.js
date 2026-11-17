import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give } from './harness.js';
import { validPlan } from '../../server/match/aiPlan.js';
import { planSpendSteps, spendDown, levelUp, botPrep } from '../../server/match/bot.js';
import { aiObservation } from '../../server/match/externalAI.js';

function setup(t, plan = { economy: { maxRefreshes: 0, refreshAbove: 100, reserve: 100 } }) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', fake: true, botStrategy: 'external', externalReplay: true,
    externalAI: { mode: 'plan' } });
  t.after(() => h.m.dispose()); h.start().toPrep();
  const m = h.m, ps = m.order[0];
  m.externalAI.planFor = () => plan;
  ps.bandId = 'band_amiya'; ps.funds = 0;
  ps.shop.slots = []; ps.shop.frozen = false;
  const ids = m.gd.visibleChess.filter(id => m.pool.has(id));
  return { m, ps, plan, ids, h };
}
const slot = (id, price) => ({ id, kind: 'chess', basePrice: price, frozen: false, sold: false });
const spend = (m, ps) => { for (const step of planSpendSteps(m, ps)) void step; };

test('hold requires an explicit level and a bounded nonblank reason; false is a preference', () => {
  assert.ok(validPlan({ economy: { level: 2, holdLevel: true, why: 'Low-tier elite farm.' } }));
  assert.ok(validPlan({ economy: { holdLevel: false } }));
  for (const e of [{ holdLevel: true }, { holdLevel: true, level: 2 }, { holdLevel: true, level: 0, why: 'farm' },
    { holdLevel: true, level: 2, why: ' ' }, { holdLevel: 'true' }, { why: 'a'.repeat(361) }])
    assert.equal(validPlan({ economy: e }), false);
});

test('level is a floor and legacy continues beyond it; explicit hold stops even free upgrades', t => {
  const { m, ps, plan } = setup(t, { economy: { level: 1 } });
  m.round = 7; ps.funds = 60;
  levelUp(m, ps); assert.ok(ps.shop.level >= 4);
  ps.shop.level = 1; ps.shop.upgradePrice = 0;
  plan.economy = { level: 1, holdLevel: true, why: 'Farm cheap elites.' };
  levelUp(m, ps); assert.equal(ps.shop.level, 1);
  plan.economy = { level: 3 }; m.round = 1; ps.funds = 13; ps.shop.upgradePrice = 5;
  levelUp(m, ps); assert.equal(ps.shop.level, 3); assert.equal(ps.funds, 0);
});

test('§37.71: a level-6 floor stops at the bots\' level cap 5', t => {
  const { m, ps } = setup(t, { economy: { level: 6 } });
  m.round = 13; ps.shop.level = 5; ps.funds = 60; ps.shop.upgradePrice = 0;
  levelUp(m, ps);
  assert.equal(ps.shop.level, 5);
  assert.equal(ps.funds, 60);
});

test('§37.71: the funds left buy the plan\'s explicit target before legacy spends them', t => {
  const { m, ps, plan, ids } = setup(t); const id = ids[0];
  plan.buy = [id]; ps.funds = 4;
  ps.shop.slots = [slot(id, 2)];
  spend(m, ps);
  assert.ok(ps.allChess().some(p => p.id === id));
  assert.equal(ps.stats.refreshes, 0);
});

test('§37.71: legacy spendDown buys an explicit target its refresh shows, whatever maxRefreshes says', t => {
  const { m, ps, plan, ids } = setup(t);
  plan.buy = [ids[0]]; ps.funds = 3;
  // Keep the actual refresh/payment/stock path; fix only the next displayed roll.
  ps.rollShop = () => { ps.shop.slots = [slot(ids[0], 2)]; };
  spend(m, ps);
  assert.equal(ps.stats.refreshes, 0, 'without freezeSearch the plan pass does not refresh');
  spendDown(m, ps);
  assert.equal(ps.stats.refreshes, 1); assert.equal(ps.funds, 0);
  assert.ok(ps.allChess().some(p => p.id === ids[0]));
});

test('wanted unaffordable singles freeze and survive next round; legacy refresh cannot discard them', t => {
  const { m, ps, plan, ids } = setup(t);
  plan.buy = [ids[0]]; plan.economy.maxRefreshes = 16;
  plan.economy.holdLevel = true; plan.economy.level = 1; plan.economy.why = 'Farm.';
  ps.funds = 3; ps.shop.slots = [slot(ids[0], 5)];
  botPrep(m, ps);
  assert.ok(ps.shop.frozen); assert.equal(ps.stats.refreshes, 0);
  assert.equal(ps.shop.slots[0].id, ids[0]);
  ps.ready = false; ps.startRound(2);
  assert.equal(ps.shop.slots[0].id, ids[0]); // the round-start roll consumes the freeze
});

test('carry-over funds retain interest and no forced spending', t => {
  const { m, ps, ids } = setup(t); ps.bandId = 'band_cannot'; ps.funds = 10;
  ps.shop.slots = [slot(ids[0], 2)]; spend(m, ps); spendDown(m, ps);
  assert.equal(ps.funds, 10); assert.equal(ps.stats.refreshes, 0); assert.equal(ps.allChess().length, 0);
});

test('§37.71: the plan pass buys no bank: an off-plan single stays in the shop', t => {
  const { m, ps, ids } = setup(t);
  const eliteIds = ids.filter(id => m.gd.tierOf(id) === 6).slice(0, ps.deployCap);
  eliteIds.forEach((id, i) => give(m, ps, id.replace(/_a$/, '_b'), 'board', [9 + Math.floor(i / 5), i % 5]));
  const cheap = ids.filter(id => m.gd.tierOf(id) === 1);
  ps.funds = 2; ps.shop.slots = cheap.map(id => slot(id, 2));
  const before = ps.allChess().map(p => p.uid);
  spend(m, ps);
  assert.equal(ps.funds, 2);
  assert.deepEqual(ps.allChess().map(p => p.uid), before);
});

test('empty shared stock prevents a futile freeze search, and empty plans preserve legacy delegation', t => {
  const { m, ps, plan, ids } = setup(t); ps.funds = 10;
  plan.buy = [ids[0]]; plan.economy = { freezeSearch: true };
  for (const e of m.pool.entries.values()) e.left = 0;
  spend(m, ps); assert.equal(ps.stats.refreshes, 0); assert.equal(ps.funds, 10);
  delete plan.economy; delete plan.buy; spend(m, ps); assert.equal(ps.funds, 10);
});

test('§37.71: an absent plan, an empty plan and plans whose fields are empty produce identical legacy state and RNG', t => {
  const plans = [null, {}, { economy: {} }, { items: { buy: [] } }, { bonds: [] }, { placements: [] },
    { buy: [], keep: [], sell: [], items: { keep: [], equip: [] } }];
  const runs = plans.map(plan => setup(t, plan));
  for (const { m, ps } of runs) { ps.funds = 20; ps.rollShop(); botPrep(m, ps); }
  for (const run of runs.slice(1)) {
    assert.deepEqual(run.ps.privateView(), runs[0].ps.privateView());
    assert.deepEqual(run.m.rngBots.state(), runs[0].m.rngBots.state());
    assert.deepEqual(run.m.rngShop.state(), runs[0].m.rngShop.state());
  }
});

test('digest exposes expiring funds, effective refresh/upgrade costs, frozen slots and the bot\'s defaults', t => {
  const { m, ps, ids } = setup(t); ps.funds = 3; ps.shop.freeRefreshes = 1;
  ps.shop.slots = [slot(ids[1], 5)]; ps.freeze();
  const observe = () => aiObservation(m, ps, { id: 'economy', kind: 'prep', remaining: 64, deadline: 100 }, []).digest;
  const d = observe(), e = d.economy;
  assert.equal(e.expiringFunds, 3); assert.equal(e.refreshPrice, 0); assert.equal(e.upgradePrice, ps.shop.upgradePrice);
  assert.deepEqual(e.frozenSlots, [0]); assert.equal(e.bankOperators, undefined);
  assert.ok(Number.isInteger(d.bot.levelTarget) && d.bot.levelTarget <= 5);
  assert.ok('focus' in d.bot && 'second' in d.bot && 'route' in d.bot);
  ps.bandId = 'band_cannot'; assert.equal(observe().economy.expiringFunds, 0);
});
