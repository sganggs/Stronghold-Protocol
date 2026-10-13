// Income, upgrade price math, shop slots, buy/sell, refresh, freeze, ready gating (research 00-INDEX §3, 01 A1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier } from './harness.js';

/** Fill every free hand slot with distinct plain equipment (nothing merges), so a piece put into temp stays there. */
function fillHand(ps) {
  const plain = Object.values(DATA.items).filter((i) => i.itemType === 'EQUIP' && !i.isGolden && i.kind === 'passive').map((i) => i.itemId ?? i.id);
  let k = 0;
  for (let i = 0; i < ps.hand.length; i++) if (ps.hand[i] == null) ps.hand[i] = ps.newPiece('item', plain[k++]);
  ps.recompute();
}

test('income = min(3 + r, 12) in every mode; funds are lost at prep end (band_cannot keeps them)', () => {
  for (const modeId of ['mode_single_funny', 'mode_multi_normal', 'mode_multi_abyss']) {
    const gd = new GameData(DATA, modeId);
    for (let r = 1; r <= 15; r++) assert.equal(gd.income(r), Math.min(3 + r, 12), `${modeId} R${r}`);
  }
  const h = makeMatch({ mode: 'solo', seed: 2 }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  assert.equal(ps.funds, 4, 'R1 income 4');
  ps.funds = 3;
  h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 2);
  assert.equal(ps.funds, 5, 'leftover lost, R2 income 5');
  h.m.dispose();
  const h2 = makeMatch({ mode: 'solo', seed: 2 }).start();
  h2.toPrep(1, { band: 'band_cannot' });
  const p2 = h2.ps('p_0');
  assert.equal(p2.bandId, 'band_cannot');
  p2.funds = 3;
  h2.drive(() => h2.m.phase === PHASE.PREP && h2.m.round === 2);
  assert.equal(p2.funds, 3 + 5, '坎诺特 carries leftovers (the +1 interest is band content)');
  h2.m.dispose();
});

test('upgrade price: base per mode, −1 per round start (floor 0), resets to the next base after a level-up; MAX_LEVEL', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 4 }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const base = m.gd.upgradePrices();
  assert.deepEqual(base, [5, 8, 11, 12, 13]);
  assert.equal(ps.shop.upgradePrice, 5);
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.equal(ps.shop.upgradePrice, 4, 'R2: 5 − 1');
  ps.funds = 100;
  assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
  assert.equal(ps.funds, 96);
  assert.equal(ps.shop.level, 2);
  assert.equal(ps.shop.upgradePrice, 8, 'reset to the next base');
  for (let i = 0; i < 4; i++) m.handle('p_0', { t: 'g.levelUp' });
  assert.equal(ps.shop.level, 6);
  assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), { error: ERR.MAX_LEVEL });
  assert.equal(ps.privateView().shop.upgradePrice, 0);
  // floor 0 after many rounds at one level
  ps.shop.level = 3;
  ps.shop.upgradePrice = 1;
  ps.startRound(3);
  assert.equal(ps.shop.upgradePrice, 0);
  ps.startRound(4);
  assert.equal(ps.shop.upgradePrice, 0);
  // not enough funds
  ps.funds = 0;
  ps.shop.upgradePrice = 5;
  assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), { error: ERR.NO_FUNDS });
  assert.deepEqual(new GameData(DATA, 'mode_single_funny').upgradePrices(), [1, 1, 5, 8, 10]);
  assert.deepEqual(new GameData(DATA, 'mode_multi_funny').upgradePrices(), [5, 8, 10, 11, 11]);
  m.dispose();
});

test('shop slots per level (+ the item slot), buy prices by tier, SOLD_OUT, NO_FUNDS, HAND_FULL', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 6 }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const counts = { 1: 3, 2: 4, 3: 4, 4: 5, 5: 5, 6: 5 };
  for (let lv = 1; lv <= 6; lv++) {
    ps.shop.level = lv;
    ps.rollShop();
    const chess = ps.shop.slots.filter((s) => s && s.kind === 'chess');
    const items = ps.shop.slots.filter((s) => s && s.kind === 'item');
    assert.equal(chess.length, counts[lv], `L${lv} chess slots`);
    assert.equal(items.length, 1, `L${lv} item slot`);
    for (const s of chess) {
      assert.ok(DATA.chess[s.id].tier <= lv);
      assert.equal(s.basePrice, { 1: 2, 2: 3, 3: 3, 4: 3, 5: 4, 6: 4 }[DATA.chess[s.id].tier]);
    }
    for (const s of items) assert.equal(s.basePrice, DATA.items[s.id].price);
  }
  ps.shop.level = 1;
  ps.rollShop();
  ps.funds = 1;
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { error: ERR.NO_FUNDS });
  ps.funds = 50;
  const slot0 = ps.shop.slots[0];
  const left0 = m.pool.left(slot0.id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.equal(ps.funds, 48);
  assert.equal(m.pool.left(slot0.id), left0 - 1);
  assert.equal(ps.hand[9].id, slot0.id, 'hand fills right→left');
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { error: ERR.SOLD_OUT });
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 15 }).error, ERR.BAD_TARGET);
  // a display is not a reservation, but its operator remains purchasable after the pool is exhausted (#498)
  const s1 = ps.shop.slots[1];
  const taken = m.pool.take(s1.id, 100);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 1 }), { ok: true });
  assert.equal(m.pool.entries.get(s1.id).left, -1);
  m.pool.give(s1.id, taken);
  // full hand blocks buys
  const fillers = chessOfTier(3).filter((x) => m.pool.has(x) && x !== s1.id);
  for (let i = 0; ps.hand.some((x) => x == null); i++) give(m, ps, fillers[i]);
  ps.shop.slots[1] = { ...s1, sold: false };
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 1 }), { error: ERR.HAND_FULL });
  const itemSlot = ps.shop.slots.findIndex((s) => s && s.kind === 'item');
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: itemSlot }), { error: ERR.HAND_FULL });
  checkInvariants(m);
  m.dispose();
});

test('refresh: 1 fund, free refreshes first, rerolls every slot; freeze: one toggle, kept through the round start', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 8 }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.funds = 10;
  m.handle('p_0', { t: 'g.refresh' });
  assert.equal(ps.funds, 9);
  assert.equal(ps.stats.refreshes, 1);
  ps.shop.freeRefreshes = 2;
  assert.equal(ps.privateView().shop.refreshPrice, 0);
  m.handle('p_0', { t: 'g.refresh' });
  assert.equal(ps.funds, 9);
  assert.equal(ps.shop.freeRefreshes, 1);
  ps.funds = 0;
  ps.shop.freeRefreshes = 0;
  assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { error: ERR.NO_FUNDS });
  ps.funds = 20;
  // freeze keeps the unsold slots to the next round; sold slots are refilled
  m.handle('p_0', { t: 'g.buy', slot: 0 });
  assert.deepEqual(m.handle('p_0', { t: 'g.freeze' }), { ok: true });
  assert.equal(ps.shop.frozen, true);
  assert.ok(ps.shop.slots.every((s) => !s || s.sold || s.frozen));
  const keep = ps.shop.slots.slice(1).map((s) => s && s.id);
  // unfreeze and freeze again (toggle)
  m.handle('p_0', { t: 'g.freeze' });
  assert.equal(ps.shop.frozen, false);
  m.handle('p_0', { t: 'g.freeze' });
  // combat start clears unfrozen slots only; next round start keeps frozen ones and unfreezes
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.deepEqual(ps.shop.slots.slice(1, keep.length + 1).map((s) => s && s.id), keep);
  assert.equal(ps.shop.frozen, false, 'the freeze is consumed at the round start');
  assert.ok(ps.shop.slots.every((s) => !s || !s.frozen));
	// refresh while frozen rerolls everything and cancels the freeze
  m.handle('p_0', { t: 'g.freeze' });
  ps.funds = 50;
  const before = ps.shop.slots.map((s) => s && s.id).join();
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) { m.handle('p_0', { t: 'g.refresh' }); changed = ps.shop.slots.map((s) => s && s.id).join() !== before; }
  assert.ok(changed, 'refresh rerolls frozen slots');
	assert.equal(ps.shop.frozen, false);
	assert.ok(ps.shop.slots.every((s) => !s || !s.frozen));
  m.dispose();
});

test('refresh cancels freezing for paid and free rolls, but a rejected refresh preserves it', () => {
	for (const free of [false, true]) {
		const h = makeMatch({ mode: 'solo', seed: 8 }).start();
		h.toPrep(1);
		const m = h.m;
		const ps = h.ps('p_0');
		ps.funds = free ? 0 : 1;
		ps.shop.freeRefreshes = free ? 1 : 0;
		assert.deepEqual(m.handle('p_0', { t: 'g.freeze' }), { ok: true });
		const frozenSlots = structuredClone(ps.shop.slots);
		ps.ready = true;
		assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { error: ERR.WRONG_PHASE, detail: 'ready' });
		assert.equal(ps.shop.frozen, true);
		assert.deepEqual(ps.shop.slots, frozenSlots);
		ps.ready = false;
		if (!free) {
			ps.funds = 0;
			assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { error: ERR.NO_FUNDS });
			assert.equal(ps.shop.frozen, true);
			assert.deepEqual(ps.shop.slots, frozenSlots);
			ps.funds = 1;
		}
		assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { ok: true });
		assert.equal(ps.funds, 0);
		assert.equal(ps.shop.freeRefreshes, 0);
		const shop = ps.privateView().shop;
		assert.equal(shop.frozen, false, 'the client receives the unfrozen state');
		assert.ok(shop.slots.some(Boolean));
		assert.ok(shop.slots.every((s) => !s || !s.frozen));
		ps.clearUnfrozenShop();
		assert.ok(ps.shop.slots.every((s) => s === null), 'refreshed offers are cleared at combat start');
		m.dispose();
	}
});

test('selling: +1 (normal and elite, board or hand), items return to the hand, items and tokens are not sellable', () => {
  const h = makeMatch({ mode: 'solo', seed: 9 }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.funds = 0;
  const id = chessOfTier(5).find((x) => m.pool.has(x));
  const a = give(m, ps, DATA.chess[id].goldenId);
  const it = giveItem(m, ps, 'chess_item_1_02_e_a');
  m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: a.uid });
  assert.equal(a.items.length, 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: it.uid }).error, ERR.BAD_TARGET);
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: a.uid }), { ok: true });
  assert.equal(ps.funds, 1);
  assert.ok(ps.hand.some((p) => p && p.uid === it.uid), 'equipment returned to the hand');
  assert.equal(m.pool.left(id), m.pool.cap(id));
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: it.uid }), { ok: true });
  assert.ok(!ps.hand.some((p) => p && p.uid === it.uid));
  assert.equal(ps.funds, 1, 'destroying pays nothing');
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: 424242 }).error, ERR.BAD_TARGET);
  // a board chess carrying equipment is not sold while neither the hand nor the temp slots can take the equipment back
  const b = give(m, ps, chessOfTier(4).find((x) => m.pool.has(x)), 'board', [10, 3]);
  b.items.push(ps.newPiece('item', 'chess_item_1_01_e_a'), ps.newPiece('item', 'chess_item_3_03_e_a'));
  const fill = chessOfTier(1).filter((x) => m.pool.has(x));
  for (let i = 0; ps.hand.some((p) => p == null); i++) give(m, ps, fill[i]);
  const fill2 = chessOfTier(2).filter((x) => m.pool.has(x));
  for (let i = 0; i < 4; i++) give(m, ps, fill2[i], 'temp');
  assert.equal(m.handle('p_0', { t: 'g.sell', uid: b.uid }).error, ERR.HAND_FULL, '2 items, 1 free temp slot');
  assert.ok(ps.find(b.uid) && b.items.length === 2, 'nothing lost');
  ps.resolveTemp();
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: b.uid }), { ok: true });
  assert.equal(ps.temp.filter(Boolean).length, 2, 'the equipment overflowed into temp');
  checkInvariants(m);
  m.dispose();
});

test('ready gating: temp must be empty (a freed hand slot pulls the temp piece in); unready allowed until everyone is ready; actions locked while ready', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 10 }).start();
  h.toPrep(1);
  const m = h.m;
  const a = h.ps('p_0');
  fillHand(a);
  const t = give(m, a, chessOfTier(1).find((x) => m.pool.has(x)), 'temp');
  assert.ok(a.temp.includes(t), 'a full hand: it waits in temp');
  assert.equal(a.privateView().canReady, false);
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { error: ERR.TEMP_NOT_EMPTY });
  // destroying a hand item frees its slot: the temp piece moves in by itself (PRTS 卫戍协议/帮助 §手牌区, GitHub #82)
  const freed = a.hand[3];
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: freed.uid }), { ok: true });
  assert.equal(a.hand[3], t);
  assert.ok(a.tempEmpty);
  assert.equal(a.privateView().canReady, true);
  const art = giveItem(m, a, 'chess_item_6_03_m', 'temp');
  assert.deepEqual(a.useArt(art.uid, 10, 5), { ok: true });
  assert.ok(a.tempEmpty);
  assert.equal(a.privateView().canReady, false);
  assert.deepEqual(a.setReady(true), { error: ERR.BAD_TARGET, detail: '请先完成教鞭选择' });
  assert.deepEqual(a.setReady(false), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.choice', idx: 0, choiceId: a.personalChoice.id }), { ok: true });
  assert.equal(a.privateView().canReady, true);
  assert.equal(a.round.arts, 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { error: ERR.WRONG_PHASE, detail: 'ready' });
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: false }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }).ok, true);
  m.handle('p_0', { t: 'g.ready', ready: true });
  h.sched.advance(10);
  assert.equal(m.phase, PHASE.PREP, 'still waiting for p_1');
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.sched.runNext();
  assert.notEqual(m.phase, PHASE.PREP, 'everyone ready → prep ends');
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: false }), { error: ERR.WRONG_PHASE });
  m.dispose();
});

test('prep deadline (co-op): unready players are auto-readied and their temp is auto-resolved', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 12, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const a = h.ps('p_0');
  const id = chessOfTier(1).find((x) => m.pool.has(x));
  const left = m.pool.left(id);
  const art = giveItem(m, a, 'chess_item_6_03_m');
  assert.deepEqual(a.useArt(art.uid, 10, 5), { ok: true });
  fillHand(a);
  give(m, a, id, 'temp');
  assert.ok(!a.tempEmpty, 'a full hand: it waits in temp');
  const endPrep = m.endPrep.bind(m);
  let checked = false;
  m.endPrep = () => {
    assert.equal(a.personalChoice, null, 'deadline picks before endPrep builds the battle');
    assert.equal(a.bounties.length, 1);
    assert.equal(a.round.arts, 1);
    assert.ok(a.ready && a.tempEmpty);
    checked = true;
    endPrep();
  };
  assert.ok(m.deadline > h.sched.now(), 'co-op prep is timed');
  assert.equal(Math.round((m.deadline - h.sched.now()) / 1000), m.gd.prepTime(1));
  h.sched.advance(m.deadline - h.sched.now() + 1);
  assert.notEqual(m.phase, PHASE.PREP);
  assert.ok(checked);
  assert.ok(a.tempEmpty);
  assert.equal(m.pool.left(id), left, 'temp chess sold back to the pool');
  checkInvariants(m);
  m.dispose();
});

test('solo prep and 机变 are untimed', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 13 }).start();
  h.toPrep(1);
  assert.equal(h.m.deadline, 0);
  const ps = h.ps('p_0');
  const art = giveItem(h.m, ps, 'chess_item_6_03_m');
  assert.deepEqual(ps.useArt(art.uid, 10, 5), { ok: true });
  const id = ps.personalChoice.id;
  h.sched.advance(10 * 60 * 1000);
  assert.equal(h.m.phase, PHASE.PREP);
  assert.equal(ps.personalChoice.id, id, 'no separate personal-choice timer');
  h.m.dispose();
});
