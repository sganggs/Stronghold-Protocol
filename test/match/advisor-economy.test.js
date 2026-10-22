import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem } from './harness.js';
import { validPlan } from '../../server/match/aiPlan.js';
import { advisorBanks, fundAdvisorPurchase } from '../../server/match/aiEconomy.js';
import { advisorSpendSteps, levelUp, botPrep } from '../../server/match/bot.js';
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
const spend = (m, ps) => { for (const step of advisorSpendSteps(m, ps)) void step; };

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

test('expiring funds ignore refresh/reserve preferences and buy a wanted offer before refreshing', t => {
  const { m, ps, plan, ids } = setup(t); const id = ids[0];
  plan.buy = [id]; ps.funds = 4;
  ps.shop.slots = [slot(id, 2)];
  spend(m, ps);
  assert.ok(ps.allChess().some(p => p.id === id));
  assert.equal(ps.stats.refreshes, 0, 'two remaining funds cannot pay refresh plus minimum purchase');
});

test('zero refresh preference searches absent targets, but never spends the last purchase budget on a refresh', t => {
  const { m, ps, plan, ids } = setup(t);
  plan.buy = [ids[0]]; ps.funds = 3;
  // Keep the actual refresh/payment/stock path; fix only the next displayed roll.
  ps.rollShop = () => { ps.shop.slots = [slot(ids[0], 2)]; };
  spend(m, ps);
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
  ps.shop.slots = [slot(ids[0], 2)]; spend(m, ps);
  assert.equal(ps.funds, 10); assert.equal(ps.stats.refreshes, 0); assert.equal(ps.allChess().length, 0);
});

test('bank sale funds the wanted purchase and returns its occupied pool copy', t => {
  const { m, ps, plan, ids } = setup(t); const bank = give(m, ps, ids[0]);
  ps._advisorBankUids = new Set([bank.uid]); plan.buy = [ids[1]];
  const before = m.pool.left(ids[0]); ps.funds = 1; ps.shop.slots = [slot(ids[1], 2)];
  spend(m, ps);
  assert.equal(ps.find(bank.uid), null); assert.equal(m.pool.left(ids[0]), before + 1);
  assert.ok(ps.allChess().some(p => p.id === ids[1])); assert.equal(ps.funds, 0);
});

test('banks stay held when their combined refunds cannot fund the target, or a new plan needs them', t => {
  const { m, ps, plan, ids } = setup(t); const bank = give(m, ps, ids[0]);
  ps._advisorBankUids = new Set([bank.uid]); plan.buy = [ids[1]];
  fundAdvisorPurchase(m, ps, slot(ids[1], 5)); assert.ok(ps.find(bank.uid));
  plan.keep = [ids[0]]; ps.funds = 1;
  fundAdvisorPurchase(m, ps, slot(ids[1], 2)); assert.ok(ps.find(bank.uid));
  assert.deepEqual(advisorBanks(m, ps), []);
});

test('a full-board prep does not spend a wanted purchase bank refund on the intervening level-up', t => {
  const { m, ps, plan, ids } = setup(t);
  ids.filter(id => m.gd.tierOf(id) === 6).slice(0, ps.deployCap)
    .forEach((id, i) => give(m, ps, id.replace(/_a$/, '_b'), 'board', [9 + Math.floor(i / 5), i % 5]));
  const bank = give(m, ps, ids[0]); ps._advisorBankUids = new Set([bank.uid]);
  plan.buy = [ids[1]]; ps.funds = 2; m.round = 7; ps.shop.upgradePrice = 3;
  ps.shop.slots = [slot(ids[1], 3)];
  botPrep(m, ps);
  assert.equal(ps.find(bank.uid), null);
  assert.ok(ps.allChess().some(p => p.id === ids[1]));
  assert.equal(ps.shop.level, 1, 'the refund funds its purchase before any later upgrade');
});

test('bank spending preserves a bench vacancy and refuses depleted shared stock', t => {
  const { m, ps, ids } = setup(t);
  // A full elite lineup makes cheap off-plan singletons pure sale-value storage.
  const eliteIds = ids.filter(id => m.gd.tierOf(id) === 6).slice(0, ps.deployCap);
  eliteIds.forEach((id, i) => give(m, ps, id.replace(/_a$/, '_b'), 'board', [9 + Math.floor(i / 5), i % 5]));
  const cheap = ids.filter(id => m.gd.tierOf(id) === 1);
  ps.funds = 2; ps.shop.slots = cheap.map(id => slot(id, 2));
  spend(m, ps);
  const banks = advisorBanks(m, ps);
  assert.equal(banks.length, 1); assert.equal(ps.funds, 0);
  const exhausted = cheap.find(id => id !== banks[0].id);
  m.pool.entries.get(exhausted).left = 0;
  ps.funds = 2; ps.shop.slots = [slot(exhausted, 2)]; spend(m, ps);
  assert.equal(ps.funds, 2); assert.equal(advisorBanks(m, ps).length, 1);
  // Fill remaining hand slots without spending funds. The final slot stays available.
  for (let n = ps.hand.filter(p => !p).length - 1; n > 0; n--) giveItem(m, ps, 'chess_item_1_01_e_a');
  ps.shop.slots = [slot(cheap.find(id => id !== exhausted && id !== banks[0].id), 2)];
  spend(m, ps); assert.equal(ps.hand.filter(p => !p).length, 1); assert.equal(ps.funds, 2);
});

test('empty shared stock prevents a futile refresh, and empty plans preserve legacy delegation', t => {
  const { m, ps, plan } = setup(t); ps.funds = 10;
  for (const e of m.pool.entries.values()) e.left = 0;
  spend(m, ps); assert.equal(ps.stats.refreshes, 0); assert.equal(ps.funds, 10);
  delete plan.economy; spend(m, ps); assert.equal(ps.funds, 10);
});

test('an absent plan and an explicit empty plan produce identical legacy state and RNG', t => {
  const a = setup(t, null), b = setup(t, {});
  for (const { m, ps } of [a, b]) { ps.funds = 20; ps.rollShop(); botPrep(m, ps); }
  assert.deepEqual(a.ps.privateView(), b.ps.privateView());
  assert.deepEqual(a.m.rngBots.state(), b.m.rngBots.state());
  assert.deepEqual(a.m.rngShop.state(), b.m.rngShop.state());
});

test('digest exposes expiring funds, effective refresh/upgrade costs, frozen slots and bank base refunds', t => {
  const { m, ps, ids } = setup(t); const bank = give(m, ps, ids[0]);
  ps._advisorBankUids = new Set([bank.uid]); ps.funds = 3; ps.shop.freeRefreshes = 1;
  ps.shop.slots = [slot(ids[1], 5)]; ps.freeze();
  const observe = () => aiObservation(m, ps, { id: 'economy', kind: 'prep', remaining: 64, deadline: 100 }, []).digest.economy;
  const e = observe();
  assert.equal(e.expiringFunds, 3); assert.equal(e.refreshPrice, 0); assert.equal(e.upgradePrice, ps.shop.upgradePrice);
  assert.deepEqual(e.frozenSlots, [0]); assert.deepEqual(e.bankOperators, [{ uid: bank.uid, id: bank.id, sellValue: 1 }]);
  ps.bandId = 'band_cannot'; assert.equal(observe().expiringFunds, 0);
});
