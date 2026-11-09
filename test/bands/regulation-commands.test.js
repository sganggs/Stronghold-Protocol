import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { SharedPool } from '../../server/match/pool.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { makeMatch } from '../match/harness.js';
import { syncCommand, beginCommandPrep, commandView, openSkillChangeDraft, commandSkill, commandBattleInput, reconcileCommandChests, keepsFunds } from '../../server/match/bandCommands.js';
import { botUseCommand } from '../../server/match/bot.js';
import { validateC2S } from '../../shared/protocol.js';
import { fileURLToPath } from 'node:url';

const data = loadData(fileURLToPath(new URL('../../data/versions/act3autochess-v3_1', import.meta.url)), { log: { warn() {} } });
before(() => setGameData(data));
after(() => setGameData(null));
const setup = (t, band, round = 1) => {
  const h = makeMatch({ data, mode: 'coop', humans: 2, bots: 0, fake: true, seed: 137, registry: createRegistry() }).start();
  t.after(() => { assert.equal(h.m.errorCount, 0); h.m.dispose(); });
  // Command unit fixtures need named operators from every bond; the real draw is covered in bond-groups.test.js.
  h.m.disabledBonds = []; h.m.bannedChess = []; h.m.pool = new SharedPool(h.m.gd);
  h.toPrep(1);
  const ps = h.ps('p_0');
  h.m.round = round; ps.bandId = band; ps.funds = 100; ps.offers = []; ps.commandDrafts = [];
  ps.recompute(); beginCommandPrep(ps);
  return { h, ps, view: () => commandView(ps), use: (target = {}) => ps.useCommand(ps.command.currentEffectId, target) };
};
const own = ps => [...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess');
const normal = tier => Object.values(data.chess).find(c => !c.isGolden && !c.isDiy && c.tier === tier)?.chessId;
const grant = (ps, tier = 2) => ps.acquireChess(normal(tier), { silent: true });
const next = (ps, round) => { ps.m.round = round; ps.round = { refreshes: 0, buys: 0, sells: 0, spent: 0, gainedChess: 0, arts: 0 }; beginCommandPrep(ps); };

test('command protocol accepts only one bounded target shape and an explicit live effect id', () => {
  for (const target of [{}, { uid: 1 }, { slot: 0 }, { row: 9, col: 2 }]) assert.equal(validateC2S({ t: 'g.command', effectId: 'aceffect_band_80', target }), null);
  for (const target of [null, [], { uid: -1 }, { slot: 16 }, { row: 8, col: 2 }, { uid: 1, slot: 0 }, { row: 9, col: 2, x: 1 }]) assert.ok(validateC2S({ t: 'g.command', effectId: 'aceffect_band_80', target }));
});

test('locked row upgrades by round; fixed cooldown counts rounds and views are read-only', t => {
  const { ps, view, use } = setup(t, 'band_jenga');
  const p = grant(ps); ps.bonds = { [data.chess[p.id].bonds[0]]: { active: true, count: 3 } };
  assert.equal(view().reason, 'locked'); assert.ok(use({ uid: p.uid }).error);
  next(ps, 4); assert.equal(view().effectId, 'aceffect_band_89');
  ps.bonds = { [data.chess[p.id].bonds[0]]: { active: true, count: 3 } };
  assert.ok(use({ uid: p.uid }).ok); assert.equal(view().cooldown, 3);
  const snapshot = JSON.stringify(ps.command); view(); view(); assert.equal(JSON.stringify(ps.command), snapshot);
  next(ps, 6); assert.equal(view().cooldown, 1); next(ps, 7); assert.equal(view().cooldown, 0);
});

test('round uses refill once and tile-command upgrades do not refund uses', t => {
  const { ps, use, view } = setup(t, 'band_dance', 3);
  assert.ok(view().targets.length);
  assert.ok(use(view().targets[0]).ok); assert.equal(view().usesLeft, 0);
  beginCommandPrep(ps); assert.equal(view().usesLeft, 0);
  next(ps, 4); assert.equal(view().usesLeft, 2);
  assert.ok(use(view().targets[0]).ok); assert.equal(view().usesLeft, 1);
  next(ps, 8); assert.equal(view().usesLeft, 3); next(ps, 12); assert.equal(view().usesLeft, 4);
});

test('shop, cumulative spending and bond-count unlocks are monotonic', t => {
  const { ps } = setup(t, 'band_takecare');
  ps.shop.level = 3; syncCommand(ps); assert.equal(commandView(ps).effectId, 'aceffect_band_32');
  ps.shop.level = 5; syncCommand(ps); assert.equal(commandView(ps).effectId, 'aceffect_band_33');
  ps.bandId = 'band_rich'; ps.stats.gold = 59; syncCommand(ps); assert.equal(commandView(ps).type, 'NONE');
  ps.stats.gold = 60; syncCommand(ps); assert.equal(commandView(ps).effectId, 'aceffect_band_54');
  ps.stats.gold = 120; syncCommand(ps); assert.equal(commandView(ps).effectId, 'aceffect_band_55');
  ps.bandId = 'band_iberia'; ps.bonds.iberiaShip = { count: 4 }; syncCommand(ps); assert.equal(commandView(ps).type, 'ACTIVE');
  ps.bonds.iberiaShip.count = 0; syncCommand(ps); assert.equal(commandView(ps).type, 'ACTIVE');
});

test('gold cooldown uses the seeded integer and refuses extra uses without spending or RNG draws', t => {
  const { ps, view, use } = setup(t, 'band_fund');
  const funds = ps.funds; assert.ok(use().ok);
  const gain = ps.funds - funds; assert.ok(gain >= 1 && gain <= 6); assert.equal(view().cooldown, gain);
  const state = JSON.stringify(ps.command), rng = ps.m.rngMeta.state();
  assert.ok(use().error); assert.equal(ps.funds, funds + gain); assert.equal(JSON.stringify(ps.command), state); assert.deepEqual(ps.m.rngMeta.state(), rng);
});

test('target ownership, ready, stale ids, funds and special recruit refuse without consuming uses', t => {
  const { ps, view } = setup(t, 'band_evolve');
  const p = grant(ps); ps.funds = 0;
  assert.equal(ps.useCommand(view().effectId, { uid: p.uid }).error, 'NO_FUNDS');
  ps.funds = 5; assert.ok(ps.useCommand(view().effectId, { uid: 99999 }).error);
  assert.ok(ps.useCommand('stale', { uid: p.uid }).error);
  ps.ready = true; assert.ok(ps.useCommand(view().effectId, { uid: p.uid }).error); ps.ready = false;
  assert.equal(view().usesLeft, 1);
  ps.bandId = 'band_transfer'; syncCommand(ps); ps.offers.push({ slots: [] });
  assert.equal(commandView(ps).reason, 'specialRecruit');
  assert.ok(ps.useCommand(commandView(ps).effectId, { slot: 0 }).error);
});

test('ALL_LIMIT persists across rounds and replacement drafts; drafts queue and survive snapshots', t => {
  const { ps, use, view } = setup(t, 'band_upgrade');
  const p = grant(ps); assert.ok(use({ uid: p.uid }).ok); assert.equal(ps.gd.isGolden(p.id), true);
  next(ps, 2); assert.equal(view().usesLeft, 0);
  assert.ok(openSkillChangeDraft(ps, 'skill_change_1')); assert.ok(openSkillChangeDraft(ps, 'skill_change_2'));
  assert.equal(ps.commandDrafts[0].cards.length, 3); assert.equal(ps.commandDrafts[1].cards.length, 2);
  assert.equal(ps.privateView().commandDraft.cards.length, 3); assert.equal(ps.privateView().canReady, false);
  const draft = ps.commandDrafts[0]; assert.ok(ps.pickCommand('stale', 0).error); assert.ok(ps.pickCommand(draft.id, 0).ok);
  ps.commandDrafts[0].cards[0] = 'aceffect_band_99'; assert.ok(ps.pickCommand(ps.commandDrafts[0].id, 0).ok);
  assert.equal(view().usesLeft, 0); assert.equal(openSkillChangeDraft(ps, 'bad'), false);
});

test('cost decay, reset, permanent growth and bond purchase discount follow their blackboards', t => {
  const { ps, use, view } = setup(t, 'band_kazimier');
  ps.m.dispatch(ps, 'onPrepEnd', {}); assert.equal(view().currentCost, 4);
  ps.shop.level = 6; assert.ok(use().ok); assert.equal(view().currentCost, 6);
  ps.bandId = 'band_lethania'; syncCommand(ps); assert.ok(use().ok); assert.equal(view().currentCost, 2);
  next(ps, 2); assert.equal(view().currentCost, 2);
  ps.bandId = 'band_ursus'; syncCommand(ps);
  const id = Object.values(data.chess).find(c => !c.isGolden && c.bonds.includes('ursusShip')).chessId;
  ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id } }); assert.equal(view().currentCost, 4);
  assert.ok(use().ok); assert.equal(view().currentCost, 5);
});

test('click commands take shop operators, refresh higher tiers and change only the equipment offer', t => {
  const { ps, use, view } = setup(t, 'band_support');
  ps.shop.level = 2; assert.ok(use().ok); assert.ok(ps.shop.slots.some(s => s?.kind === 'chess' && ps.gd.tierOf(s.id) === 3));
  assert.equal(view().usesLeft, 2);
  ps.bandId = 'band_equipment'; syncCommand(ps);
  const chars = ps.shop.slots.filter(s => s?.kind === 'chess').map(s => s.id);
  assert.ok(use().ok); assert.deepEqual(ps.shop.slots.filter(s => s?.kind === 'chess').map(s => s.id), chars);
  ps.bandId = 'band_closeout'; syncCommand(ps); const n = own(ps).length;
  assert.ok(use().ok); assert.ok(own(ps).length > n); assert.ok(ps.shop.slots.every(s => s?.kind !== 'chess'));
});

test('equipment discount is applied once to the next item buy and survives command replacement', t => {
  const { ps, use } = setup(t, 'band_price');
  const i = ps.shop.slots.findIndex(s => s?.kind === 'item'); const price = ps.priceOf(ps.shop.slots[i]);
  assert.ok(use().ok); assert.equal(ps.priceOf(ps.shop.slots[i]), Math.max(0, price - 1));
  assert.ok(ps.buy(i).ok); assert.equal(ps.commandDiscounts[0].remaining, 0);
});

test('owned and shop transforms obey tier/bond constraints, while marks affect only the selected uid', t => {
  const { ps, use } = setup(t, 'band_transfer');
  const tier = ps.gd.tierOf(ps.shop.slots[0].id); assert.ok(use({ slot: 0 }).ok); assert.equal(ps.gd.tierOf(ps.shop.slots[0].id), tier);
  const p = grant(ps, 3); ps.bandId = 'band_yan2'; syncCommand(ps); assert.ok(use({ uid: p.uid }).ok);
  assert.equal(ps.find(p.uid), null); assert.ok(own(ps).some(p => matchesYan(p)));
  ps.bandId = 'band_survive'; syncCommand(ps); const target = own(ps)[0]; assert.ok(use({ uid: target.uid }).ok);
  assert.equal(ps.commandMarks.at(-1).uid, target.uid); assert.equal(ps.commandMarks.at(-1).tag, 'eff_band12');
  function matchesYan(p) { return data.chess[p.id].bonds.includes('yanShip') && data.chess[p.id].tier <= 3; }
});

test('copy preserves equipment, temporary elite/equipment and the layer cap alter only battle inputs', t => {
  const { ps, use } = setup(t, 'band_copy');
  const p = grant(ps, 4), itemId = Object.values(data.items).find(i => i.itemType === 'EQUIP' && i.isGolden && !/装备时销毁/.test(i.desc)).id;
  p.items.push({ uid: ps.m.nextUid(), kind: 'item', id: itemId });
  assert.ok(use({ uid: p.uid }).ok);
  const copy = own(ps).find(c => c !== p && c.id === p.id);
  assert.ok(copy); assert.deepEqual(copy.items.map(i => i.id), [itemId]);
  // Place directly so this regression does not depend on map terrain or a kit's deployment restrictions.
  const loc = ps.find(p.uid); ps._detach(loc); ps.board.set('10,5', p);
  ps.bandId = 'band_evolve'; syncCommand(ps); assert.ok(use({ uid: p.uid }).ok);
  const base = p.id;
  const inp = [{ uid: p.uid, kind: 'chess', chessId: p.id, items: [], row: 10, col: 5 }];
  commandBattleInput(ps, inp); assert.equal(inp[0].chessId, ps.gd.goldenIdOf(base)); assert.equal(p.id, base);
  ps.bandId = 'band_limit'; syncCommand(ps); assert.ok(use({ uid: p.uid }).ok);
  const cap = [{ uid: p.uid, kind: 'chess', chessId: p.id, items: [], row: 10, col: 5 }];
  commandBattleInput(ps, cap); assert.equal(cap[0].commandLayerCapBonus, ps.m.round);
  ps.bandId = 'band_pudd'; syncCommand(ps); ps.shop.slots[0] = { kind: 'item', id: itemId };
  assert.ok(use({ slot: 0 }).ok); assert.equal(ps.shop.slots[0], null);
  const items = [{ uid: p.uid, kind: 'chess', chessId: p.id, items: [] }, { uid: 999, kind: 'chess', chessId: p.id, items: [itemId, itemId] }];
  commandBattleInput(ps, items); assert.deepEqual(items[0].items, [itemId]); assert.equal(items[1].items.length, 2);
  assert.equal(p.items.length, 1);
});

test('gain and prep-finish commands explicitly trigger only the selected operator garrison event', t => {
  const { ps, use } = setup(t, 'band_gain');
  const c = Object.values(data.chess).find(c => !c.isGolden && c.garrisonIds.some(id => data.garrisons[id].eventType === 'SERVER_GAIN'));
  const p = ps.acquireChess(c.chessId, { silent: true });
  const seen = []; ps.m.dispatcher.triggerGarrisons = (_ps, piece, event) => { seen.push([piece.uid, event]); return 1; };
  assert.ok(use({ uid: p.uid }).ok); assert.deepEqual(seen, [[p.uid, 'SERVER_GAIN']]);
  ps.bandId = 'band_prepfin'; syncCommand(ps);
  const end = Object.values(data.chess).find(c => !c.isGolden && c.garrisonIds.some(id => data.garrisons[id].eventType === 'SERVER_PREP_FIN'));
  const q = ps.acquireChess(end.chessId, { silent: true }); assert.ok(use({ uid: q.uid }).ok);
  assert.equal(seen.length, 1); ps.m.dispatch(ps, 'onPrepEnd', {});
  assert.deepEqual(seen[1], [q.uid, 'SERVER_PREP_FIN']); ps.m.dispatch(ps, 'onPrepEnd', {}); assert.equal(seen.length, 2);
});

test('higher-tier transform caps at six; sale snapshots active bonds before removing the selected operator', t => {
  const { ps, use } = setup(t, 'band_mess', 7);
  const p = grant(ps, 5); assert.ok(use({ uid: p.uid }).ok); assert.ok(own(ps).some(c => ps.gd.tierOf(c.id) === 6));
  ps.bandId = 'band_sell'; syncCommand(ps); const q = grant(ps, 3);
  ps.bonds = { yanShip: { active: true, count: 3 } };
  const n = ps.layers.yanShip || 0; assert.ok(use({ uid: q.uid }).ok);
  assert.equal(ps.find(q.uid), null); assert.equal(ps.layers.yanShip, n + 3);
});

test('health sacrifice pays capped gold immediately and heals the lowest teammate at prep end', t => {
  const { h, ps, use } = setup(t, 'band_protect', 7);
  const other = h.ps('p_1'); ps.lp = 22; other.lp = 5;
  const before = ps.funds; assert.ok(use().ok); assert.equal(ps.lp, 5); assert.equal(other.lp, 5);
  const cap = commandSkill(ps).buffs[0].bb.max_count; assert.equal(ps.funds - before, Math.min(17, cap));
  ps.m.dispatch(ps, 'onPrepEnd', {}); assert.equal(other.lp, Math.min(ps.gd.startLp(other.bandId), 22));
});

test('shop command tiers and bond preference, one-stock board refresh, and free taking obey pools', t => {
  const { ps, use } = setup(t, 'band_yan'); ps.shop.level = 4;
  assert.ok(use().ok); assert.ok(ps.shop.slots.some(s => s?.kind === 'chess' && data.chess[s.id].bonds.includes('yanShip')));
  ps.bandId = 'band_high'; syncCommand(ps); const p = grant(ps, 3); ps._detach(ps.find(p.uid)); ps.board.set('10,5', p);
  assert.ok(use().ok); assert.ok(ps.shop.slots.some(s => s?.id === p.id)); assert.equal(commandView(ps).usesLeft, 0);
  ps.bandId = 'band_rich'; ps.stats.gold = 120; syncCommand(ps); const count = own(ps).length;
  assert.ok(use().ok); assert.ok(own(ps).length >= count);
  ps.bandId = 'band_iberia'; ps.bonds.iberiaShip = { count: 4 }; syncCommand(ps);
  ps.offers = []; ps.shop.slots[0] = { kind: 'chess', id: normal(6) };
  const slot = 0; const tier = ps.gd.tierOf(ps.shop.slots[slot].id);
  assert.ok(use({ slot }).ok); assert.ok(data.chess[ps.shop.slots[slot].id].bonds.includes('iberiaShip'));
  assert.ok(ps.gd.tierOf(ps.shop.slots[slot].id) <= tier);
});

test('equipment grant rounds, bond gains, purchase rewards and manual refresh rebates use official counts', t => {
  const { ps } = setup(t, 'band_smith'); ps.shop.level = 3;
  const skill = commandSkill(ps), round = skill.buffs[0].bb.round;
  ps.m.round = round; const itemsBefore = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item').length;
  ps.m.dispatch(ps, 'onPrepStart', {});
  const items = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item'); assert.equal(items.length, itemsBefore + 1); assert.equal(ps.gd.item(items.at(-1).id).tier, 3);
  ps.bandId = 'band_sargon'; syncCommand(ps);
  const buff = commandSkill(ps).buffs.find(b => b.key === 'gain_bond_cnt_shop_up_discount');
  const c = Object.values(data.chess).find(c => c.bonds.includes(buff.bbStr.bond)); const price = ps.shop.upgradePrice;
  for (let i = 0; i < buff.bb.count + 2; i++) ps.m.dispatch(ps, 'onGain', { kind: 'chess', piece: { id: c.chessId } });
  assert.equal(ps.shop.upgradePrice, Math.max(0, price - buff.bb.value));
  ps.bandId = 'band_victoria'; syncCommand(ps);
  const b = commandSkill(ps).buffs.find(b => b.key === 'buy_bond_char_cnt_gain_equip');
  const id = Object.values(data.chess).find(c => c.bonds.includes(b.bbStr.bond)).chessId;
  const gained = []; const acquire = ps.acquireItem.bind(ps); ps.acquireItem = (id, opts) => { gained.push(id); return acquire(id, opts); };
  for (let i = 0; i < b.bb.count; i++) ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id } });
  assert.equal(gained.length, b.bb.count2); assert.ok(gained.every(id => ps.gd.item(id).tier <= ps.shop.level));
  ps.bandId = 'band_siracusa'; syncCommand(ps); const rebate = commandSkill(ps).buffs.find(b => b.key === 'n_round_refresh_cnt_gain_coin').bb;
  ps.m.round = rebate.round; const funds = ps.funds;
  for (let n = 1; n <= rebate.refresh_count + 1; n++) { ps.round.refreshes = n; ps.m.dispatch(ps, 'onRefresh', {}); }
  assert.equal(ps.funds, funds + rebate.coin * rebate.refresh_count);
});

test('first normal sale swaps the actual shop slot once; later sales and elite sales retain their proceeds', t => {
  const { ps } = setup(t, 'band_substitute'); const p = grant(ps, 2);
  const shop = ps.shop.slots.filter(s => s?.kind === 'chess').map(s => s.id), before = ps.funds;
  assert.ok(ps.sell(p.uid).ok); assert.equal(ps.funds, before); assert.ok(ps.shop.slots.some(s => s?.id === p.id));
  assert.ok(own(ps).some(p => shop.includes(p.id)));
  const q = grant(ps, 3); assert.ok(ps.sell(q.uid).ok); assert.ok(ps.funds > before);
});

test('promotion reward passives limit counts per round and random strategy opens two-command drafts every prep', t => {
  const { ps } = setup(t, 'band_bonus');
  const b = commandSkill(ps).buffs[0].bb; let awards = 0; ps.pushRewardOffer = () => { awards++; };
  for (let n = 0; n < b.n + 1; n++) ps.m.dispatch(ps, 'onMerge', { kind: 'chess' });
  assert.equal(awards, b.n * b.count);
  ps.bandId = 'band_equipment'; syncCommand(ps); const eq = commandSkill(ps).buffs.find(b => b.key === 'promote_equip_extra_award').bb;
  const offers = []; ps.pushItemOffer = ids => { offers.push(ids); return true; };
  for (let n = 0; n < eq.n + 1; n++) ps.m.dispatch(ps, 'onMerge', { kind: 'item' });
  assert.equal(offers.length, eq.n * eq.select_count); assert.ok(offers.every(ids => ids.length === eq.count && new Set(ids).size === ids.length));
  ps.bandId = 'band_random'; syncCommand(ps); ps.m.dispatch(ps, 'onPrepStart', {}); assert.equal(ps.commandDrafts[0].cards.length, 2);
  ps.autoPickCommands(); next(ps, 2); ps.m.dispatch(ps, 'onPrepStart', {}); assert.equal(ps.commandDrafts.length, 1);
});

test('treasure marks persist across rounds, then disappear on validated battle receipts; bots consume click and drag commands', t => {
  const { ps, use, view } = setup(t, 'band_treasure'); assert.ok(use(view().targets[0]).ok);
  const mark = ps.commandMarks[0]; next(ps, 2); assert.ok(ps.commandMarks.includes(mark));
  reconcileCommandChests(ps, { commandChests: [{ id: mark.id, alive: false }] }); assert.equal(ps.commandMarks.length, 0);
  ps.bandId = 'band_fund'; syncCommand(ps); assert.ok(botUseCommand(ps.m, ps));
  ps.bandId = 'band_survive'; syncCommand(ps); grant(ps); assert.ok(botUseCommand(ps.m, ps, true)); assert.equal(ps.commandMarks.length, 1);
});

test('renamed passive keys keep delayed gold, first bond price and paid special refresh semantics', t => {
  const { ps } = setup(t, 'band_mlynar');
  const c = Object.values(data.chess).find(c => !c.isGolden && c.bonds.includes('kazimierzShip')).chessId;
  const funds = ps.funds, pending = ps.pendingFunds;
  for (let i = 0; i < 5; i++) ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id: c } });
  assert.equal(ps.funds, funds); assert.equal(ps.pendingFunds, pending + 3);
  ps.bandId = 'band_kjerag'; syncCommand(ps);
  const id = Object.values(data.chess).find(c => !c.isGolden && c.bonds.includes('kjeragShip')).chessId;
  const slot = { kind: 'chess', id, basePrice: 3 }; assert.equal(ps.priceOf(slot), 1);
  ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot }); assert.equal(ps.priceOf(slot), 3);
  ps.bandId = 'band_pepe'; syncCommand(ps); ps.shop.level = 4;
  ps.m.dispatch(ps, 'onLevelUp', { level: 4 }); const free = ps.shop.freeRefreshes;
  assert.ok(ps.refresh().ok); assert.equal(ps.shop.freeRefreshes, free); assert.equal(ps.counters['band:pepe:special'], 0);
  assert.ok(ps.shop.slots.filter(s => s?.kind === 'chess').some(s => data.chess[s.id].bonds.includes('sargonShip')));
});

test('Chiave counts manual refreshes within the round and Warfarin only grows active bonds in regulation', t => {
  const { ps } = setup(t, 'band_bond'); let granted = 0;
  const acquire = ps.acquireChess.bind(ps); ps.acquireChess = (...args) => { granted++; return acquire(...args); };
  for (let round = 1; round <= 2; round++) {
    next(ps, round);
    for (let n = 1; n <= 3; n++) { ps.round.refreshes = n; ps.m.dispatch(ps, 'onRefresh', {}); }
  }
  assert.equal(granted, 0); ps.round.refreshes = 4; ps.m.dispatch(ps, 'onRefresh', {}); assert.equal(granted, 1);
  ps.round.refreshes = 8; ps.m.dispatch(ps, 'onRefresh', {}); assert.equal(granted, 1);
  ps.bandId = 'band_takecare'; syncCommand(ps); const p = grant(ps, 3); ps._detach(ps.find(p.uid)); ps.board.set('10,5', p);
  ps.bonds = Object.fromEntries(data.chess[p.id].bonds.map(id => [id, { active: false, count: 1 }]));
  ps.layers = {}; ps.m.dispatch(ps, 'onPrepEnd', {}); assert.deepEqual(ps.layers, {});
  for (const b of Object.values(ps.bonds)) b.active = true;
  ps.m.dispatch(ps, 'onPrepEnd', {}); assert.ok(Object.values(ps.layers).some(n => n > 0));
});

test('carried funds and duck substitutions follow the current effect after a command replacement', t => {
  const { ps } = setup(t, 'band_cannot'); assert.equal(keepsFunds(ps), true);
  assert.ok(openSkillChangeDraft(ps, 'skill_change_1')); ps.autoPickCommands(); assert.equal(keepsFunds(ps), false);
  ps.bandId = 'band_ducklord'; syncCommand(ps); ps.m.round = 6;
  const id = ps.command.currentEffectId; assert.equal(id, 'aceffect_band_16');
  assert.ok(openSkillChangeDraft(ps, 'skill_change_1')); ps.autoPickCommands(); assert.notEqual(ps.command.currentEffectId, id);
  // Swapping a passive must not leave its global hook behind merely because the original band id is unchanged.
  const spawns = [{ enemyKey: 'enemy_1007_slime', count: 30, time: 0, routeIndex: 0 }];
  const before = structuredClone(spawns);
  ps.m.dispatch(ps, 'onBattleStart', { kind: 'normal', spawns, waveSpawns: structuredClone(spawns), routes: [{ start: [12, 10], end: [9, 2] }] });
  assert.deepEqual(spawns, before);
});
