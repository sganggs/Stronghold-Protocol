import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';
import { validPlan, planContains, planUnitWeight, planBuyTarget } from '../../server/match/aiPlan.js';
import { advisorWanted, advisorProtected } from '../../server/match/aiEconomy.js';
import { botPrep, botPrepBeginSteps, buyLoopSteps, advisorSpendSteps, sellWeakestHand, sellJunk,
  freeHandSlot, resolveTemp, arrange, levelUp } from '../../server/match/bot.js';

const HAMMER = 'chess_item_1_01_e_a', SHIELD = 'chess_item_1_02_e_a';
const ROSE = 'chess_char_1_06_a', ESTELLE = 'chess_char_1_12_a';
const elite = id => id.replace(/_a$/, '_b');
const slot = (id, price = 2, kind = 'chess') => ({ id, kind, basePrice: price, frozen: false, sold: false });
const run = gen => { for (const step of gen) void step; };
function setup(t, plan = { economy: { maxRefreshes: 0 } }) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', fake: true, botStrategy: 'external', externalReplay: true,
    externalAI: { mode: 'plan' } });
  t.after(() => h.m.dispose()); h.start().toPrep();
  const m = h.m, ps = m.order[0];
  m.externalAI.planFor = () => plan;
  ps.bandId = 'band_amiya'; ps.funds = 0; ps.shop.slots = []; ps.shop.frozen = false;
  const ids = m.gd.visibleChess.filter(id => m.pool.has(id));
  return { h, m, ps, plan, ids };
}
function fillItems(m, ps, id = HAMMER, free = 0) {
  for (let n = ps.hand.filter(p => !p).length - free; n > 0; n--) giveItem(m, ps, id);
}

test('R3: six funds reserve the three-cost level floor before fill purchases', t => {
  const { m, ps } = setup(t, { economy: { level: 2, maxRefreshes: 0 } });
  m.round = 3; ps.funds = 6; ps.shop.upgradePrice = 3;
  ps.shop.slots = ['chess_char_1_01_a', ROSE, 'chess_char_1_04_a'].map(id => slot(id));
  const actions = [];
  for (const key of ['buy', 'levelUp']) { const original = ps[key].bind(ps); ps[key] = (...args) => {
    actions.push(key); return original(...args);
  }; }
  run(botPrepBeginSteps(m, ps));
  assert.equal(actions[0], 'levelUp'); assert.equal(ps.shop.level, 2);
});

test('a completing merge still precedes the level floor', t => {
  const { m, ps } = setup(t, { economy: { level: 2, maxRefreshes: 0 } });
  give(m, ps, ESTELLE); give(m, ps, ESTELLE);
  ps.funds = 6; ps.shop.upgradePrice = 3; ps.shop.slots = [slot(ESTELLE), slot(ROSE)];
  run(buyLoopSteps(m, ps, { fillOnly: true }));
  assert.equal(ps.stats.merges, 1); assert.equal(ps.funds, 4); assert.equal(ps.shop.slots[1].sold, false);
  levelUp(m, ps); assert.equal(ps.shop.level, 2);
});

test('keep and sell match exact forms and keep alone is not a purchase request', t => {
  const { m, ps, plan } = setup(t, { keep: [elite(ESTELLE)], sell: [ROSE] });
  assert.equal(planContains(m, plan.keep, ESTELLE), false);
  assert.equal(planContains(m, plan.sell, elite(ROSE)), false);
  assert.equal(planUnitWeight(m, ps, elite(ESTELLE)), 18);
  assert.equal(planUnitWeight(m, ps, elite(ROSE)), 0);
  plan.keep = [ESTELLE];
  assert.equal(advisorWanted(m, ps, ESTELLE), false);
  assert.equal(planUnitWeight(m, ps, ESTELLE, true), 0);
});

test('either buy form progresses an unowned elite; owned elites remove buy and bond copy weights', t => {
  const { m, ps, plan } = setup(t, { buy: [elite(ROSE)], bonds: [{ id: 'victoriaShip', priority: 5 }] });
  assert.ok(planBuyTarget(m, ps, ROSE)); assert.equal(planUnitWeight(m, ps, ROSE, true), 54);
  give(m, ps, ROSE); assert.ok(advisorWanted(m, ps, ROSE));
  const p = give(m, ps, elite(ROSE));
  assert.equal(planBuyTarget(m, ps, ROSE), false); assert.equal(advisorWanted(m, ps, ROSE), false);
  assert.equal(planUnitWeight(m, ps, ROSE), 0); assert.equal(planUnitWeight(m, ps, ROSE, true), 0);
  assert.equal(planUnitWeight(m, ps, p.id), 30);
  plan.buy = [ROSE]; assert.equal(planBuyTarget(m, ps, ROSE), false);
  ps.funds = 2; ps.shop.slots = [slot(ROSE)];
  run(buyLoopSteps(m, ps, { fillOnly: true })); assert.equal(ps.shop.slots[0].sold, false);
});

test('freeze ignores keep, incidental bonds and owned elites, but preserves explicit buys and merges', t => {
  for (const kind of ['keep', 'bond', 'owned', 'buy', 'merge']) {
    const { m, ps, plan } = setup(t);
    ps.shop.slots = [slot(ROSE)];
    if (kind === 'keep') plan.keep = [elite(ROSE)];
    if (kind === 'bond') plan.bonds = [{ id: 'victoriaShip', priority: 5 }];
    if (kind === 'owned') { give(m, ps, elite(ROSE)); plan.buy = [ROSE]; give(m, ps, ROSE); give(m, ps, ROSE); }
    if (kind === 'buy') plan.buy = [elite(ROSE)];
    if (kind === 'merge') { give(m, ps, ROSE); give(m, ps, ROSE); }
    run(advisorSpendSteps(m, ps));
    assert.equal(ps.shop.frozen, kind === 'buy' || kind === 'merge', kind);
  }
});

test('protection covers elites, high tiers, exact keep and targets actually bought this prep', t => {
  const { m, ps, plan, ids } = setup(t, { buy: [ESTELLE], keep: [ROSE] });
  for (const id of [elite(ROSE), ids.find(id => m.gd.tierOf(id) === 4), ROSE])
    assert.ok(advisorProtected(m, ps, give(m, ps, id)));
  const gifted = give(m, ps, ESTELLE);
  assert.equal(advisorProtected(m, ps, gifted), false, 'a same-round gift is not a purchase');
  ps.funds = 2; ps.shop.slots = [slot(ESTELLE)]; run(buyLoopSteps(m, ps, { fillOnly: true }));
  const bought = ps.allChess().find(p => p.id === ESTELLE && p.uid !== gifted.uid);
  assert.ok(advisorProtected(m, ps, bought));
  m.round++; assert.equal(advisorProtected(m, ps, bought), false);
  plan.keep = [elite(ESTELLE)]; assert.equal(advisorProtected(m, ps, gifted), false);
});

test('distinct plan members are protected only when removal drops an active threshold', t => {
  const { m, ps } = setup(t, { bonds: [{ id: 'victoriaShip', priority: 5 }] });
  const members = [ROSE, 'chess_char_2_05_a', 'chess_char_2_10_a'].map((id, i) => give(m, ps, id, 'board', [9, i]));
  assert.ok(ps.bonds.victoriaShip.active);
  assert.ok(advisorProtected(m, ps, members[0]));
  const duplicate = give(m, ps, ROSE, 'board', [9, 3]);
  assert.equal(advisorProtected(m, ps, duplicate), false);
  assert.equal(advisorProtected(m, ps, members[0]), false);
  assert.ok(advisorProtected(m, ps, members[1]));
});

test('room sales prefer owned-elite copies, then banks, then off-plan singles; cheap items precede protected pieces', t => {
  const { m, ps, ids } = setup(t);
  const kept = give(m, ps, elite(ESTELLE), 'board', [9, 0]);
  const duplicate = give(m, ps, ESTELLE);
  const bank = give(m, ps, ROSE); ps._advisorBankUids = new Set([bank.uid]);
  const single = give(m, ps, ids.find(id => m.gd.tierOf(id) === 2));
  const high = give(m, ps, ids.find(id => m.gd.tierOf(id) === 6));
  fillItems(m, ps);
  for (const expected of [duplicate, bank, single]) {
    assert.ok(sellWeakestHand(m, ps, { handOnly: true })); assert.equal(ps.find(expected.uid), null);
  }
  fillItems(m, ps); const before = ps.hand.filter(p => p?.kind === 'item').length;
  assert.ok(sellWeakestHand(m, ps, { handOnly: true }));
  assert.equal(ps.hand.filter(p => p?.kind === 'item').length, before - 1);
  assert.ok(ps.find(high.uid)); assert.ok(ps.find(kept.uid));
});

test("the pre-emptive shed keeps this prep's purchases and live pairs (legacy shed guards)", t => {
  const { m, ps, ids } = setup(t);
  const t2 = ids.filter(id => m.gd.tierOf(id) === 2);
  const fresh = give(m, ps, t2[0]); fresh.boughtRound = m.round;
  const pair = [give(m, ps, t2[1]), give(m, ps, t2[1])];
  fillItems(m, ps, HAMMER, 1);
  assert.equal(sellWeakestHand(m, ps, { keepFresh: true }), false);
  fillItems(m, ps);
  const items = ps.hand.filter(p => p?.kind === 'item').length;
  assert.ok(sellWeakestHand(m, ps, { keepFresh: true }));
  assert.equal(ps.hand.filter(p => p?.kind === 'item').length, items - 1);
  for (const p of [fresh, ...pair]) assert.ok(ps.find(p.uid));
});

test('sellJunk cannot shed protected bench units at or above its budget', t => {
  const { m, ps, ids, plan } = setup(t); m.round = 10;
  const high = ids.filter(id => m.gd.tierOf(id) >= 4).slice(0, 16);
  const pieces = high.map((id, i) => give(m, ps, elite(id), i < 8 ? 'board' : 'hand', i < 8 ? [9 + Math.floor(i / 5), i % 5] : null));
  const keep = give(m, ps, ESTELLE); plan.keep = [ESTELLE];
  give(m, ps, ROSE);
  sellJunk(m, ps);
  for (const p of [...pieces, keep]) assert.ok(ps.find(p.uid));
});

test('arrangement frees cheap hand clutter before withdrawing a protected board piece', t => {
  const { m, ps, ids, plan } = setup(t);
  const weak = give(m, ps, ROSE, 'board', [9, 0]); plan.keep = [ROSE];
  for (const id of ids.filter(id => m.gd.tierOf(id) === 6).slice(0, 8)) give(m, ps, elite(id));
  fillItems(m, ps);
  arrange(m, ps);
  assert.ok(ps.find(weak.uid), 'unchosen board piece survives');
  assert.ok(ps.deployCount > 0);
});

test('arrangement considers unprotected outgoing board pieces before destroying hand items', t => {
  const { m, ps, ids, plan } = setup(t);
  const weak = give(m, ps, ROSE, 'board', [9, 0]); plan.sell = [ROSE];
  for (const id of ids.filter(id => m.gd.tierOf(id) === 6).slice(0, 8)) give(m, ps, elite(id));
  fillItems(m, ps);
  const destroyed = [], original = ps.destroy.bind(ps);
  ps.destroy = uid => { destroyed.push(uid); return original(uid); };
  arrange(m, ps);
  assert.equal(ps.find(weak.uid), null); assert.deepEqual(destroyed, []);
});

test('freeHandSlot chooses an unprotected single before an item or protected piece', t => {
  const { m, ps, ids } = setup(t);
  const high = give(m, ps, ids.find(id => m.gd.tierOf(id) === 6));
  const single = give(m, ps, ESTELLE); fillItems(m, ps);
  assert.ok(freeHandSlot(m, ps)); assert.equal(ps.find(single.uid), null); assert.ok(ps.find(high.uid));
});

test('resolveTemp drains cheap hand items instead of selling a protected overflow piece', t => {
  const { m, ps, ids } = setup(t);
  fillItems(m, ps);
  const high = give(m, ps, ids.find(id => m.gd.tierOf(id) === 6), 'temp');
  resolveTemp(m, ps);
  assert.equal(ps.find(high.uid)?.area, 'hand'); assert.ok(ps.tempEmpty);
});

test('all-protected full hands can still fall back and reach legal room', t => {
  const { m, ps, ids } = setup(t);
  ids.filter(id => m.gd.tierOf(id) >= 4).slice(0, 10).forEach(id => give(m, ps, id));
  assert.ok(freeHandSlot(m, ps)); assert.ok(ps.hand.some(p => !p));
});

test('an affordable explicit target can clear a cheap item from a full hand before buying', t => {
  const { m, ps } = setup(t, { buy: [ESTELLE] });
  fillItems(m, ps); ps.funds = 2; ps.shop.slots = [slot(ESTELLE)];
  run(advisorSpendSteps(m, ps));
  assert.equal(ps.shop.slots[0].sold, true);
  assert.ok(advisorProtected(m, ps, ps.allChess().find(p => p.id === ESTELLE)));
});

test('a non-completing plan purchase cannot consume the floor through a full-hand room sale', t => {
  const { m, ps } = setup(t, { buy: [ESTELLE], economy: { level: 2 } });
  fillItems(m, ps); ps.funds = 3; ps.shop.upgradePrice = 3; ps.shop.slots = [slot(ESTELLE)];
  run(buyLoopSteps(m, ps, { fillOnly: true }));
  assert.equal(ps.shop.slots[0].sold, false); assert.equal(ps.funds, 3);
  levelUp(m, ps); assert.equal(ps.shop.level, 2);
});

test('items.buy and freezeSearch validate strictly, including eight-item bound', () => {
  assert.ok(validPlan({ items: { buy: Array(8).fill(HAMMER) }, economy: { freezeSearch: true } }));
  for (const p of [{ items: { buy: Array(9).fill(HAMMER) } }, { items: { buy: [3] } },
    { economy: { freezeSearch: 1 } }, { economy: { freezeSearch: 'true' } }]) assert.equal(validPlan(p), false);
});

test('requested shop items buy and equip through the normal handlers', t => {
  const { m, ps, plan } = setup(t, { items: { buy: [HAMMER], equip: [{ id: HAMMER, target: ESTELLE }] } });
  const p = give(m, ps, ESTELLE); ps.funds = 1; ps.shop.slots = [slot(HAMMER, 1, 'item')];
  run(advisorSpendSteps(m, ps));
  assert.equal(ps.shop.slots[0].sold, true); assert.ok(p.items.some(i => i.id === HAMMER));
  plan.items = { buy: [SHIELD], keep: [SHIELD] }; fillItems(m, ps, HAMMER, 1);
  ps.funds = 1; ps.shop.slots = [slot(SHIELD, 1, 'item')]; run(advisorSpendSteps(m, ps));
  assert.equal(ps.shop.slots[0].sold, false, 'explicit purchases preserve a hand vacancy');
});

test('near-full hands reject unequippable incidental items but allow explicit requests with room', t => {
  const { m, ps, plan } = setup(t, { items: { keep: [SHIELD, HAMMER] } });
  give(m, ps, ESTELLE, 'board', legalTileFor(m, ps, ESTELLE));
  fillItems(m, ps, HAMMER, 2); ps.funds = 1; ps.shop.slots = [slot(SHIELD, 1, 'item')];
  run(buyLoopSteps(m, ps)); assert.equal(ps.shop.slots[0].sold, false);
  plan.items.buy = [SHIELD]; run(buyLoopSteps(m, ps)); assert.equal(ps.shop.slots[0].sold, true);
  assert.equal(ps.hand.filter(p => !p).length, 1);
});

test('freezeSearch spends the last refresh fund and freezes the explicit target it finds', t => {
  const { m, ps } = setup(t, { buy: [ESTELLE], economy: { freezeSearch: true, maxRefreshes: 1 } });
  ps.funds = 1; ps.rollShop = () => { ps.shop.slots = [slot(ESTELLE)]; };
  run(advisorSpendSteps(m, ps));
  assert.equal(ps.stats.refreshes, 1); assert.equal(ps.funds, 0); assert.ok(ps.shop.frozen);
});

test('freezeSearch obeys the prep-wide cap across repeated passes, including free refreshes', t => {
  const { m, ps } = setup(t, { buy: [ESTELLE], economy: { freezeSearch: true, maxRefreshes: 1 } });
  ps.funds = 0; ps.shop.freeRefreshes = 5; ps.rollShop = () => { ps.shop.slots = []; };
  run(advisorSpendSteps(m, ps)); run(advisorSpendSteps(m, ps));
  assert.equal(ps.stats.refreshes, 1);
});

test('freezeSearch needs an absent eligible buy target and explicit opt-in', t => {
  for (const plan of [{ buy: [ESTELLE] }, { keep: [ESTELLE], economy: { freezeSearch: true } },
    { buy: ['unknown'], economy: { freezeSearch: true } }]) {
    const { m, ps } = setup(t, plan); ps.funds = 1;
    run(advisorSpendSteps(m, ps)); assert.equal(ps.stats.refreshes, 0);
  }
});

test('holdLevel defers this prep only; the next round does not inherit its ceiling', t => {
  const { m, ps } = setup(t);
  // Exercise the adapter's actual plan lifetime rather than the fixture override.
  delete m.externalAI.planFor;
  m.externalAI.states.set(ps.playerId, { prepRound: m.round, plan: { economy: { level: 1, holdLevel: true, why: 'Search now; level next prep.' } } });
  ps.funds = 30; ps.shop.upgradePrice = 0;
  levelUp(m, ps); assert.equal(ps.shop.level, 1);
  m.round++; levelUp(m, ps); assert.ok(ps.shop.level > 1);
});

test('no-advisor AI takeover retains legacy item and sale behavior', t => {
  const a = setup(t, null), b = setup(t, {});
  for (const { m, ps } of [a, b]) {
    ps.autoplay = true; ps.funds = 10; give(m, ps, elite(ESTELLE)); fillItems(m, ps);
    ps.shop.slots = [slot(ROSE)]; botPrep(m, ps);
  }
  assert.deepEqual(a.ps.privateView(), b.ps.privateView());
  assert.deepEqual(a.m.rngBots.state(), b.m.rngBots.state());
  assert.deepEqual(a.m.rngShop.state(), b.m.rngShop.state());
});
