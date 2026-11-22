import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { SharedPool } from '../../server/match/pool.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { fieldTile } from '../../server/match/board.js';
import { makeMatch } from '../match/harness.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { syncCommand, beginCommandPrep, commandView, openSkillChangeDraft, commandSkill, commandBattleInput, commandBondOverrides, skillRows, reconcileCommandChests, keepsFunds } from '../../server/match/bandCommands.js';
import { botUseCommand, fieldModel } from '../../server/match/bot.js';
import { validateC2S } from '../../shared/protocol.js';
import { fileURLToPath } from 'node:url';
import { data as uiData } from '../../public/js/data.js';
import { BondPopup, BondStrip } from '../../public/js/ui/bondStrip.js';
import { popupView } from '../../public/js/ui/watchBonds.js';

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
  assert.equal(ps.effectsView()[0].id, view().effectId, 'the effects column follows the locked current row');
  next(ps, 4); assert.equal(view().effectId, 'aceffect_band_89');
  assert.equal(ps.effectsView()[0].id, view().effectId, 'an upgrade changes the displayed row');
  ps.bonds = { [data.chess[p.id].bonds[0]]: { active: true, count: 3 } };
  assert.ok(use({ uid: p.uid }).ok); assert.equal(view().cooldown, 3);
  const snapshot = JSON.stringify(ps.command); view(); view(); assert.equal(JSON.stringify(ps.command), snapshot);
  next(ps, 6); assert.equal(view().cooldown, 1); next(ps, 7); assert.equal(view().cooldown, 0);
});

test('swapping the command keeps the opening replacement, and the live table wins a shared key', t => {
  const { ps } = setup(t, 'band_kazimier');
  assert.equal(commandBattleInput(ps, []).bondEffectOverrides.bondeffect_kazimierz_2, 'bondeffect_kazimierz');
  const skill = skillRows(ps).find((s) => s.type === 'ACTIVE' && !s.next && s.effectId !== ps.command.currentEffectId
    && !(s.buffs || []).some((b) => b.key === 'auto_chess_effect_replace'));
  assert.ok(skill, 'a non-replacing active skill with no further upgrade');
  ps.commandDrafts = [{ id: 'swap-1', choiceId: 'skill_change_1', cards: [skill.effectId] }];
  assert.ok(ps.pickCommand('swap-1', 0).ok);
  assert.equal(ps.command.currentEffectId, skill.effectId);
  const after = commandBattleInput(ps, []).bondEffectOverrides;
  assert.equal(after.bondeffect_kazimierz_2, 'bondeffect_kazimierz');
  assert.deepEqual(after, commandBondOverrides(ps));
  const rows = ps.effectsView();
  assert.equal(rows.find((e) => e.command)?.id, skill.effectId);
  assert.equal(rows.find((e) => e.descRef?.kind === 'bondEffect')?.id, 'bondeffect_kazimierz');
  assert.equal(rows.some((e) => e.id === data.bands.band_kazimier.effectId && e.command !== false), false, 'the opening strategy paragraph is not the command row');

  const stub = {
    gd: {
      band: () => ({ buffs: [{ key: 'auto_chess_effect_replace', bb: {}, bbStr: { bondeffect_a: 'old', bondeffect_only: 'keep' } }] }),
      raw: { bands: { x: { skills: [{ effectId: 'live', buffs: [{ key: 'auto_chess_effect_replace', bb: {}, bbStr: { bondeffect_a: 'new', bondeffect_live: 'add' } }] }] } } },
    },
    bandId: 'band_x',
    command: { currentEffectId: 'live' },
  };
  assert.deepEqual(commandBondOverrides(stub), { bondeffect_a: 'new', bondeffect_only: 'keep', bondeffect_live: 'add' });
});

test('effects view follows a drafted command and keeps only the followers prep passive', t => {
  const { h, ps } = setup(t, 'band_random');
  const original = data.bands.band_random;
  assert.equal(ps.effectsView()[0].desc, original.skills[0].descRaw || original.skills[0].desc);
  assert.equal(openSkillChangeDraft(ps, 'skill_change_2'), true);
  const draft = ps.commandDrafts[0], selectedId = draft.cards[0];
  assert.notEqual(selectedId, original.effectId);
  assert.ok(ps.pickCommand(draft.id, 0).ok);
  const rows = ps.effectsView();
  const current = rows.find((e) => e.command);
  const selectedBand = Object.values(data.bands).find((b) => b.skills?.some((s) => s.effectId === selectedId));
  const selectedSkill = selectedBand.skills.find((s) => s.effectId === ps.command.currentEffectId);
  assert.equal(current.id, ps.command.currentEffectId);
  assert.equal(current.desc, selectedSkill.descRaw || selectedSkill.desc);
  assert.deepEqual(current.descRef, { kind: 'bandSkill', bandId: selectedBand.bandId, effectId: current.id });
  assert.notEqual(current.desc, original.desc);
  const retained = rows.find((e) => e.descRef?.kind === 'effect');
  assert.equal(retained.id, original.effectId);
  assert.equal(retained.desc, data.effects[original.effectId].descRaw || data.effects[original.effectId].desc);
  assert.deepEqual(h.m.prepFieldMeta(ps).effects, ps.privateView().effects);
});

test('replacing the refresh-rebate command removes its old effects row and keeps the opening map', t => {
  const { ps } = setup(t, 'band_siracusa');
  const original = commandSkill(ps);
  assert.ok(original.buffs.some((b) => b.key === 'n_round_refresh_cnt_gain_coin'));
  const originalId = original.effectId;
  assert.equal(ps.effectsView()[0].id, originalId);
  assert.equal(commandBattleInput(ps, []).bondEffectOverrides.bondeffect_siracusa_2, 'bondeffect_siracusa');
  assert.equal(openSkillChangeDraft(ps, 'skill_change_2'), true);
  const draft = ps.commandDrafts[0];
  assert.ok(ps.pickCommand(draft.id, 0).ok);
  const current = ps.effectsView().find((e) => e.command);
  assert.notEqual(current.id, originalId);
  assert.equal(ps.effectsView().some((e) => e.id === originalId), false);
  assert.equal(commandBattleInput(ps, []).bondEffectOverrides.bondeffect_siracusa_2, 'bondeffect_siracusa');
});

test('private and public bonds use the same mapping as the battle input', t => {
  const { h, ps } = setup(t, 'band_egir');
  ps.bonds = { egirShip: { count: 3, active: true, tier: 1, layers: 2 } };
  const input = commandBattleInput(ps, []);
  const target = input.bondEffectOverrides.bondeffect_egir;
  assert.equal(target, 'bondeffect_egir_2');
  assert.equal(ps.privateView().bonds.find((b) => b.bondId === 'egirShip')?.effectId, target);
  assert.equal(h.m.publicView().players.find((p) => p.playerId === ps.playerId)?.bonds.find((b) => b.bondId === 'egirShip')?.effectId, target);
});

test('zero-state mapped bond reaches own and watched popups but stays off the strip', t => {
  const { h, ps } = setup(t, 'band_kazimier');
  const bondId = 'kazimierzShip';
  const baseEffectId = data.bonds[bondId].effectId;
  const target = commandBattleInput(ps, []).bondEffectOverrides[baseEffectId];
  assert.equal(target, 'bondeffect_kazimierz');
  ps.bonds = {};
  uiData.setContent({ id: 'regulation-commands-test', values: { ...data, assets: {} } });
  t.after(() => uiData.setContent(null));

  const priv = ps.privateView();
  const privateEntry = priv.bonds.find((b) => b.bondId === bondId);
  assert.deepEqual(
    { count: privateEntry?.count, active: privateEntry?.active, tier: privateEntry?.tier, layers: privateEntry?.layers, effectId: privateEntry?.effectId, off: privateEntry?.off },
    { count: 0, active: false, tier: 0, layers: 0, effectId: target, off: undefined },
  );
  const pub = h.m.publicView();
  const publicEntry = pub.players.find((p) => p.playerId === ps.playerId)?.bonds.find((b) => b.bondId === bondId);
  assert.equal(publicEntry?.effectId, target);
  assert.equal(publicEntry?.off, undefined);

  const own = popupView({ open: { id: bondId, ownerId: ps.playerId }, pub, priv, myId: ps.playerId });
  assert.equal(own.entry.effectId, target);
  const walk = function* (v) {
    if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
    if (!v || typeof v !== 'object') return;
    yield v;
    yield* walk(v.props?.children);
  };
  const effectText = (popup) => {
    const description = [...walk(popup)].find((v) => v.props?.class === 'bpop__desc');
    return (description?.props.text || '').replace(/<[^>]*>/g, '');
  };
  const ownPopup = BondPopup({ bondId, entry: own.entry, priv: own.priv, onClose() {} });
  assert.match(effectText(ownPopup), /周围敌人造成120%攻击力真实伤害/);
  assert.doesNotMatch(effectText(ownPopup), /召唤整备区最右侧/);
  assert.ok(!/—/.test(effectText(ownPopup)));

  const teammateId = h.ps('p_1').playerId;
  const watched = popupView({ open: { id: bondId, ownerId: ps.playerId }, pub, priv: h.ps('p_1').privateView(), myId: teammateId, field: null });
  assert.equal(watched.entry.effectId, target);
  assert.match(effectText(BondPopup({ bondId, entry: watched.entry, priv: watched.priv, owner: watched.name, onClose() {} })), /周围敌人造成120%攻击力真实伤害/);

  const emptyStrip = BondStrip({ bonds: priv.bonds, onOpen() {} });
  assert.ok(![...walk(emptyStrip)].some((v) => v.props?.['data-bond'] === bondId));
  assert.ok([...walk(BondStrip({ bonds: [{ ...privateEntry, layers: 1 }], onOpen() {} }))].some((v) => v.props?.['data-bond'] === bondId));

  ps.bonds = { [bondId]: { count: 3, active: true, tier: 1, layers: 2 } };
  const populated = ps.privateView().bonds.find((b) => b.bondId === bondId);
  assert.equal(populated.effectId, target);
  assert.equal(populated.off, undefined);
  assert.ok([...walk(BondStrip({ bonds: [populated], onOpen() {} }))].some((v) => v.props?.['data-bond'] === bondId));
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

test('the special-recruit lock ends with the prep: an unpicked offer lapses at its end (§37.339)', t => {
  const { h, ps } = setup(t, 'band_transfer');
  assert.ok(ps.pushRewardOffer('merge'));
  assert.equal(commandView(ps).reason, 'specialRecruit');
  assert.equal(ps.privateView().command.reason, 'specialRecruit');
  h.toPrep(2);
  assert.equal(ps.offers.length, 0, 'the offer lapsed with the prep');
  assert.notEqual(commandView(ps).reason, 'specialRecruit');
  assert.notEqual(ps.privateView().command.reason, 'specialRecruit', 'the view carries no special-recruit state');
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
  const shown = ps.privateView().prepMapChars.find(u => u.defId === 'enemy_9038_achest');
  assert.ok(shown); assert.equal(shown.x, mark.col); assert.equal(shown.y, mark.row);
  assert.ok(shown.uid < 0 && !ps.privateView().board.some(p => p.uid === shown.uid));
  reconcileCommandChests(ps, { commandChests: [{ id: mark.id, alive: false }] }); assert.equal(ps.commandMarks.length, 0);
  assert.equal(ps.privateView().prepMapChars.some(u => u.defId === 'enemy_9038_achest'), false);
  ps.bandId = 'band_fund'; syncCommand(ps); assert.ok(botUseCommand(ps.m, ps));
  ps.bandId = 'band_survive'; syncCommand(ps); grant(ps); assert.ok(botUseCommand(ps.m, ps, true)); assert.equal(ps.commandMarks.length, 1);
});

test('a standing treasure refuses its tile and a bot places it off the enemy route', t => {
  const { ps, use, view } = setup(t, 'band_treasure');
  const melee = Object.values(data.chess).find(c => !c.isGolden && !c.isDiy && c.position === 'MELEE' && c.tier === 2).chessId;
  const piece = ps.acquireChess(melee, { silent: true });
  const tile = view().targets.find(t => ps._legal(piece, t.row, t.col));
  assert.ok(tile);
  assert.ok(use(tile).ok);
  assert.equal(ps.move(piece.uid, { area: 'board', row: tile.row, col: tile.col }, 'RIGHT').error, 'BAD_TILE');
  const other = view().targets.find(t => ps._legal(piece, t.row, t.col));
  assert.ok(other);
  assert.ok(ps.move(piece.uid, { area: 'board', row: other.row, col: other.col }, 'RIGHT').ok);
  next(ps, 3);
  assert.equal(ps.commandMarks.length, 1);
  assert.equal(ps.move(piece.uid, { area: 'board', row: tile.row, col: tile.col }, 'RIGHT').error, 'BAD_TILE');

  // Used on round 1 with availCount 3: the command is ready again on readyRound, and the mark is still there until then.
  next(ps, ps.command.records[ps.command.currentEffectId].readyRound);
  assert.equal(ps.commandMarks.length, 1);
  ps.commandMarks = [];
  const first = commandView(ps).targets[0];
  const endCol = first.col >= 10 ? first.col - 1 : first.col + 1;
  ps.m.wave = {
    templateId: 'treasure-path',
    routes: [{ motion: 'WALK', start: [first.row, first.col], end: [first.row, endCol], checkpoints: [] }],
    spawns: [{ enemyKey: 'enemy_1000_gopro_2', count: 1, routeIndex: 0 }],
  };
  delete ps.m._botPath;
  const path = new Set((fieldModel(ps.m, ps).routes || []).flatMap(r => r.tiles));
  assert.ok(path.has(`${first.row},${first.col}`));
  const off = commandView(ps).targets.find(t => !path.has(`${t.row},${t.col}`));
  assert.ok(off);
  assert.ok(botUseCommand(ps.m, ps, true));
  assert.deepEqual([ps.commandMarks[0].row, ps.commandMarks[0].col], [off.row, off.col]);
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

test('v3_1 raw stages: Nymph PASSABLE excludes red/blue gates and still accepts ordinary ground on all deploy fields', t => {
  const fields = ['normal', 'bossL', 'bossR'];
  const rows = [[1, 'aceffect_band_107'], [5, 'aceffect_band_108'], [9, 'aceffect_band_109'], [13, 'aceffect_band_110']];
  const coverage = {
    layouts: 0, successfulGroundUses: 0, floorTargets: 0,
    tile_startCells: 0, tile_startLayouts: 0,
    tile_endCells: 0, tile_endLayouts: 0,
    highCells: 0, highLayouts: 0,
    fenceCells: 0, fenceLayouts: 0,
    floorCells: 0, floorLayouts: 0,
  };
  assert.equal(Object.keys(data.stages).length, 12, 'the test reads all twelve real v3_1 stages');

  for (const [stageId, stage] of Object.entries(data.stages)) for (const field of fields) {
    const { h, ps } = setup(t, 'band_dance', 1);
    const teammate = h.ps('p_1');
    h.m.stageId = stageId;
    h.m.bossWaves = field === 'normal' ? null : [{ players: field === 'bossL'
      ? [ps.playerId, teammate.playerId] : [teammate.playerId, ps.playerId], wave: {} }];
    assert.equal(h.m.deployFieldOf(ps), field, `${stageId} uses the real ${field} deploy-field mapping`);

    const byType = { tile_start: [], tile_end: [], high: [], fence: [], floor: [], ground: [] };
    for (let row = 9; row <= 12; row++) for (let col = 2; col <= 10; col++) {
      const [stageRow, stageCol] = fieldTile(field, row, col);
      const glyph = stage.rows?.[stageRow]?.[stageCol];
      const tile = glyph == null ? null : stage.tiles?.[glyph];
      if (!tile) continue;
      const cell = { row, col, tile };
      if (tile.tileKey === 'tile_start') byType.tile_start.push(cell);
      if (tile.tileKey === 'tile_end') byType.tile_end.push(cell);
      if (tile.height === 'HIGH') byType.high.push(cell);
      if (tile.tileKey === 'tile_fence_bound') byType.fence.push(cell);
      if (tile.tileKey === 'tile_floor' && tile.height === 'LOW' && tile.passable === 'ALL') byType.floor.push(cell);
      if (tile.height === 'LOW' && tile.passable === 'ALL' && !['tile_start', 'tile_end', 'tile_fence_bound'].includes(tile.tileKey)) byType.ground.push(cell);
    }
    coverage.layouts++;
    for (const [type, cellKey, layoutKey] of [
      ['tile_start', 'tile_startCells', 'tile_startLayouts'], ['tile_end', 'tile_endCells', 'tile_endLayouts'],
      ['high', 'highCells', 'highLayouts'], ['fence', 'fenceCells', 'fenceLayouts'], ['floor', 'floorCells', 'floorLayouts'],
    ]) {
      coverage[cellKey] += byType[type].length;
      if (byType[type].length) coverage[layoutKey]++;
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const [round, effectId] = rows[rowIndex];
      if (rowIndex) next(ps, round);
      const view = commandView(ps);
      assert.equal(view.effectId, effectId, `${stageId}/${field} R${round} uses Nymph ${effectId}`);
      assert.equal(view.targetFilterType, 'PASSABLE');
      assert.equal(view.reason, null, 'the command still has an available use before forged-target checks');
      const targetKeys = new Set(view.targets.map(target => `${target.row},${target.col}`));
      for (const cell of [...byType.tile_start, ...byType.tile_end]) {
        assert.equal(cell.tile.height, 'LOW', 'red/blue gate cells are LOW');
        assert.equal(cell.tile.passable, 'ALL', 'red/blue gate cells pass the existing passable check');
        assert.ok(!targetKeys.has(`${cell.row},${cell.col}`), `${stageId}/${field} excludes ${cell.tile.tileKey} at ${cell.row},${cell.col}`);
        const funds = ps.funds, uses = view.usesLeft, markCount = ps.commandMarks.length;
        assert.equal(ps.useCommand(effectId, { row: cell.row, col: cell.col }).error, 'BAD_TARGET', 'a forged gate target is refused');
        assert.equal(ps.funds, funds, 'a refused gate does not spend funds');
        assert.equal(commandView(ps).usesLeft, uses, 'a refused gate does not consume a command use');
        assert.equal(ps.commandMarks.length, markCount, 'a refused gate creates no tile mark');
      }
      for (const cell of [...byType.high, ...byType.fence]) {
        assert.ok(['FLY_ONLY', 'NONE'].includes(cell.tile.passable), 'HIGH/fence cells remain excluded by the existing passable check');
        assert.ok(!targetKeys.has(`${cell.row},${cell.col}`), `${stageId}/${field} leaves HIGH/fence excluded by the existing passable rule`);
      }

      const floorTarget = byType.floor.find(cell => targetKeys.has(`${cell.row},${cell.col}`));
      if (byType.floor.length) {
        assert.ok(floorTarget, `${stageId}/${field} keeps an ordinary tile_floor target`);
        coverage.floorTargets++;
      }
      const ground = floorTarget || byType.ground.find(cell => targetKeys.has(`${cell.row},${cell.col}`));
      if (ground) {
        assert.ok(view.targets.some(target => target.row === ground.row && target.col === ground.col));
        assert.ok(ps.useCommand(effectId, { row: ground.row, col: ground.col }).ok, `${stageId}/${field} accepts a legal ground tile at R${round}`);
        coverage.successfulGroundUses++;
      }
    }
  }

  assert.equal(coverage.layouts, 36, 'all twelve maps are checked on normal, bossL and bossR');
  assert.ok(coverage.tile_startCells && coverage.tile_endCells && coverage.highCells && coverage.fenceCells && coverage.floorCells);
  assert.equal(coverage.floorTargets, coverage.floorLayouts * rows.length, 'every tier keeps tile_floor targetable in each map-field layout that contains it');
  assert.ok(coverage.successfulGroundUses > 0, 'real PlayerState commands accept ordinary ground tiles');
  t.diagnostic(`raw data/versions/act3autochess-v3_1/stages.json coverage: ${coverage.layouts} map-field layouts; `
    + `tile_start ${coverage.tile_startCells} cells/${coverage.tile_startLayouts} layouts; `
    + `tile_end ${coverage.tile_endCells} cells/${coverage.tile_endLayouts} layouts; `
    + `HIGH ${coverage.highCells} cells/${coverage.highLayouts} layouts; `
    + `tile_fence_bound ${coverage.fenceCells} cells/${coverage.fenceLayouts} layouts; `
    + `tile_floor ${coverage.floorCells} cells/${coverage.floorLayouts} layouts; `
    + `${coverage.successfulGroundUses} legal ground uses`);
});

test('skill-change drafts offer at most one current unlocked row per strategy chain and never another tier of the held command', t => {
  const { ps } = setup(t, 'band_random', 1);
  const bandOf = id => Object.values(data.bands).find(b => b.skills?.some(s => s.effectId === id))?.bandId;
  const capturePool = choiceId => {
    let seen = null;
    const rng = { shuffle(arr) { seen = [...arr]; return [...arr]; } };
    ps.commandDrafts = [];
    assert.equal(openSkillChangeDraft(ps, choiceId, { rng }), true);
    return seen;
  };

  // 琳琅诗怀雅 starts on NONE aceffect_band_53 until cumulative gold reaches 60. Gold 0 therefore
  // offers no row. The previous pool started at the first ACTIVE row and offered aceffect_band_54 early.
  for (const [round, gold, wantDance, wantShield, wantRich] of [
    [1, 0, 'aceffect_band_107', 'aceffect_band_37', null],
    [4, 60, 'aceffect_band_108', 'aceffect_band_37', 'aceffect_band_54'],
    [9, 119, 'aceffect_band_109', 'aceffect_band_38', 'aceffect_band_54'],
    [12, 120, 'aceffect_band_110', 'aceffect_band_38', 'aceffect_band_55'],
  ]) {
    ps.stats.gold = gold;
    next(ps, round);
    for (const choiceId of ['skill_change_1', 'skill_change_2']) {
      const pool = capturePool(choiceId);
      const bands = pool.map(s => bandOf(s.effectId));
      assert.equal(new Set(bands).size, bands.length, `R${round} ${choiceId} has at most one row per chain`);
      assert.deepEqual(pool.filter(s => bandOf(s.effectId) === 'band_dance').map(s => s.effectId), [wantDance]);
      assert.deepEqual(pool.filter(s => bandOf(s.effectId) === 'band_shield').map(s => s.effectId), [wantShield]);
      assert.deepEqual(pool.filter(s => bandOf(s.effectId) === 'band_rich').map(s => s.effectId), wantRich ? [wantRich] : []);
    }
    for (let i = 0; i < 40; i++) {
      ps.commandDrafts = [];
      assert.equal(openSkillChangeDraft(ps, 'skill_change_1'), true);
      const cards = ps.commandDrafts[0].cards;
      assert.equal(new Set(cards.map(bandOf)).size, cards.length, 'a draft never shows two levels of the same command');
    }
  }

  for (const [bandId, round, gold] of [['band_dance', 1, 0], ['band_dance', 9, 0], ['band_shield', 1, 0], ['band_rich', 4, 60]]) {
    ps.bandId = bandId; ps.stats.gold = gold;
    next(ps, round);
    const pool = capturePool('skill_change_1');
    assert.equal(pool.some(s => bandOf(s.effectId) === bandId), false, `holding ${bandId} excludes its entire chain`);
  }
});

test('skill-change pool offers the unlocked active or passive row and omits locked, replacement and followers rows', t => {
  const { ps } = setup(t, 'band_dance', 1);
  const bandOf = id => Object.values(data.bands).find(b => b.skills?.some(s => s.effectId === id))?.bandId;
  const excluded = new Set(['auto_chess_effect_replace', 'gain_band_skill_from_pool_in_prep']);
  const replaceIds = ['aceffect_band_83', 'aceffect_band_69', 'aceffect_band_66', 'aceffect_band_67', 'aceffect_band_68', 'aceffect_band_62', 'aceffect_band_104', 'aceffect_band_65'];
  const capturePool = () => {
    let seen = null;
    const rng = { shuffle(arr) { seen = [...arr]; return [...arr]; } };
    ps.commandDrafts = [];
    assert.equal(openSkillChangeDraft(ps, 'skill_change_1', { rng }), true);
    return seen;
  };
  const assertShape = (label) => {
    const pool = capturePool();
    const bands = pool.map(s => bandOf(s.effectId));
    assert.equal(new Set(bands).size, bands.length, `${label}: one row per chain`);
    assert.ok(pool.every(s => s.type === 'ACTIVE' || s.type === 'PASSIVE'), `${label}: only ACTIVE and PASSIVE`);
    assert.ok(pool.every(s => !(s.buffs || []).some(b => excluded.has(b.key))), `${label}: no 变约 or followers-prep row`);
    assert.equal(pool.some(s => s.effectId === 'aceffect_band_72'), false, `${label}: 追随者们 is not a card`);
    for (const id of replaceIds) assert.equal(pool.some(s => s.effectId === id), false, `${label}: ${id} stays out`);
    assert.equal(pool.some(s => bandOf(s.effectId) === ps.bandId), false, `${label}: held chain stays out`);
    return pool;
  };
  const row = (pool, bandId) => pool.filter(s => bandOf(s.effectId) === bandId).map(s => s.effectId);

  ps.shop.level = 1;
  ps.stats.gold = 0;
  ps.bonds = {};
  next(ps, 1);
  let pool = assertShape('R1');
  assert.ok(pool.some(s => s.effectId === 'aceffect_band_22' && s.type === 'PASSIVE'), '众志合一 is offered');
  assert.ok(pool.some(s => s.effectId === 'aceffect_band_12' && s.type === 'PASSIVE'), '以己之长 is offered');
  assert.deepEqual(row(pool, 'band_takecare'), ['aceffect_band_31']);
  assert.deepEqual(row(pool, 'band_jenga'), []);
  assert.deepEqual(row(pool, 'band_mess'), []);
  assert.deepEqual(row(pool, 'band_protect'), []);
  assert.deepEqual(row(pool, 'band_rich'), []);
  assert.deepEqual(row(pool, 'band_iberia'), []);
  assert.deepEqual(row(pool, 'band_egir'), []);

  next(ps, 3);
  assert.deepEqual(row(assertShape('R3'), 'band_jenga'), [], '但书 stays out through round 3');

  next(ps, 4);
  pool = assertShape('R4');
  assert.deepEqual(row(pool, 'band_jenga'), ['aceffect_band_89']);
  assert.deepEqual(row(pool, 'band_mess'), ['aceffect_band_112']);
  assert.deepEqual(row(pool, 'band_protect'), ['aceffect_band_94']);

  ps.stats.gold = 59;
  assert.deepEqual(row(assertShape('gold 59'), 'band_rich'), []);
  ps.stats.gold = 60;
  assert.deepEqual(row(assertShape('gold 60'), 'band_rich'), ['aceffect_band_54']);
  ps.stats.gold = 120;
  assert.deepEqual(row(assertShape('gold 120'), 'band_rich'), ['aceffect_band_55']);

  ps.shop.level = 2;
  assert.deepEqual(row(assertShape('shop 2'), 'band_takecare'), ['aceffect_band_31']);
  ps.shop.level = 3;
  assert.deepEqual(row(assertShape('shop 3'), 'band_takecare'), ['aceffect_band_32']);
  assert.deepEqual(row(assertShape('egir shop 3'), 'band_egir'), []);
  ps.shop.level = 4;
  assert.deepEqual(row(assertShape('egir shop 4'), 'band_egir'), [], '歌蕾蒂娅 unlocks into a 变约 row and stays out');
  ps.shop.level = 5;
  assert.deepEqual(row(assertShape('shop 5'), 'band_takecare'), ['aceffect_band_33']);

  ps.bonds = { iberiaShip: { count: 3, active: true } };
  assert.deepEqual(row(assertShape('iberia 3'), 'band_iberia'), []);
  ps.bonds = { iberiaShip: { count: 4, active: true } };
  assert.deepEqual(row(assertShape('iberia 4'), 'band_iberia'), ['aceffect_band_85']);

  ps.bandId = 'band_amiya';
  next(ps, 4);
  pool = assertShape('holding 众志合一');
  assert.deepEqual(row(pool, 'band_amiya'), []);
  assert.deepEqual(row(pool, 'band_dance'), ['aceffect_band_108']);
});

test('a passive command taken from the skill-change pool applies in prep and in battle', t => {
  const offerFirst = (ps, effectId) => {
    const rng = {
      shuffle(arr) {
        const copy = [...arr];
        const i = copy.findIndex(s => s.effectId === effectId);
        assert.ok(i >= 0, `${effectId} is in the pool`);
        assert.equal(copy[i].type, 'PASSIVE');
        const [row] = copy.splice(i, 1);
        return [row, ...copy];
      },
    };
    ps.commandDrafts = [];
    assert.equal(openSkillChangeDraft(ps, 'skill_change_1', { rng }), true);
    const draft = ps.commandDrafts[0];
    assert.equal(draft.cards[0], effectId);
    assert.ok(ps.pickCommand(draft.id, 0).ok);
    assert.equal(ps.command.currentEffectId, effectId);
    assert.equal(ps.bandId, 'band_dance');
  };

  const prep = setup(t, 'band_dance', 1);
  prep.ps.shop.level = 1;
  offerFirst(prep.ps, 'aceffect_band_31');
  const piece = grant(prep.ps, 3);
  prep.ps._detach(prep.ps.find(piece.uid));
  prep.ps.board.set('10,5', piece);
  const bondId = data.chess[piece.id].bonds[0];
  prep.ps.bonds = { [bondId]: { active: true, count: 1 } };
  prep.ps.layers = {};
  prep.ps.m.dispatch(prep.ps, 'onPrepEnd', {});
  assert.equal(prep.ps.layers[bondId], 1, '华法琳 level 1 adds one layer at prep end');
  prep.ps.bonds[bondId].active = false;
  prep.ps.layers = {};
  prep.ps.m.dispatch(prep.ps, 'onPrepEnd', {});
  assert.deepEqual(prep.ps.layers, {}, 'regulation 华法琳 does not grow an inactive bond');

  const fight = setup(t, 'band_dance', 1);
  offerFirst(fight.ps, 'aceffect_band_12');
  const input = fight.ps.battleInput();
  assert.equal(input.commandEffectId, 'aceffect_band_12');
  assert.equal(input.bandId, 'band_dance');
  const eliteId = Object.values(data.chess).find(c => c.isGolden && !c.isDiy && c.position === 'MELEE').chessId;
  const normalId = Object.values(data.chess).find(c => !c.isGolden && !c.isDiy && c.position === 'MELEE').chessId;
  const battleData = new DataSource({
    ...data,
    enemies: { ...data.enemies, test_enemy: enemyRec({ key: 'test_enemy', hp: 100000, speed: 0 }) },
  }, null);
  const h = makeBattle({
    data: battleData, content: 'full', autoFinish: false, timeLimit: 2,
    players: [{
      playerId: 'p1', seat: 0, side: 'L', bonds: {},
      bandId: input.bandId, commandEffectId: input.commandEffectId,
      units: [
        { uid: 1, kind: 'chess', chessId: normalId, row: 10, col: 5 },
        { uid: 2, kind: 'chess', chessId: eliteId, row: 10, col: 6 },
      ],
    }],
  });
  h.step();
  const normal = h.unit(1), elite = h.unit(2);
  assert.equal(normal.s.atk, normal.base.atk);
  const buff = elite.findBuff('band:band_dance:attributes');
  assert.ok(buff);
  assert.equal(buff.mods.atkPct, 0.16);
  assert.equal(buff.mods.aspd, 16);
  const target = h.spawn('test_enemy', { pos: [10, 9] });
  target.base.def = 900; target.base.res = 0; target.markDirty();
  const damage = { type: 'phys', amount: 500 };
  h.b.emit('hit', { source: normal, target, dmg: damage });
  assert.equal(damage.type, 'arts');
  assert.equal(h.b.errorCount, 0);
});

test('坚雷 on the receiver of a handed-out layer trait: the result audit allows its raised cap (round 83 audit)', async () => {
  const { getVersionData } = await import('../../server/data.js');
  const { GameData } = await import('../../server/match/gamedata.js');
  const { specBounds } = await import('../../server/match/fields.js');
  const { buildBattleSpec } = await import('../../server/sim/spec.js');
  const gdReg = new GameData(getVersionData('act3autochess@V3_1', { log: () => {} }), 'mode_multi_hard');
  // 荒芜拉普兰德 精锐 (garrison_79_b) hands every 【叙拉古】 operator 「每击倒一名敌人 … +4（每场战斗至多叠加40层）」
  // (garrison_145_a); the second operator, a normal 荒芜拉普兰德, also holds its own 「… +2（每场战斗至多叠加20层）」
  // (garrison_79_a) and carries a 坚雷 raise of 9 — the sim raises both its traits (garrisons/battle.js makeInstance)
  const allowance = (raise) => {
    const spec = buildBattleSpec({ battleId: 'a', fieldId: 'n:p', kind: 'normal', seed: 1, round: 9, timeLimit: 60,
      players: [{ playerId: 'p', bonds: { siracusaShip: { layers: 10 } }, units: [
        { uid: 1, kind: 'chess', chessId: 'chess_char_6_06_b', row: 10, col: 3, items: [] },
        { uid: 2, kind: 'chess', chessId: 'chess_char_6_06_a', row: 10, col: 4, items: [], ...(raise ? { commandLayerCapBonus: raise } : {}) },
      ] }], spawns: [], flags: { layerGainsEnabled: true } });
    return specBounds(spec, gdReg).players.get('p').layerAllow.get('siracusaShip');
  };
  assert.equal(allowance(0), 40 * 2 + 20, 'two receivers × 40 + the own trait 20');
  assert.equal(allowance(9), 40 * 2 + 20 + 9 + 9, 'the raised operator: its own trait 29 and the received one 49');
});
