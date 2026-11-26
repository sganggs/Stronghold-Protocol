// test/ui/shop-reward.test.js — the pick-one offer is the normal shop frame with 0-price cards.
// It must not close the WebGL shop, must not show the item slot or a FREE flag, and must not survive as a
// separate golden layer. Every offer slot is drawn: a 2-slot offer (信标) and a 3-slot promotion reward keep
// their old last-two / last-three positions, a 6-slot 精锐版一次性促销券 (server MAX_OFFER_SLOTS) must not lose
// the slots behind the third. In canvas mode the in-canvas control (稍后 / 选择{奖励名}) feeds the same rewardMin
// state as the DOM bar, so 稍后 falls back to the normal, buyable row. The row's own helpers are the seam the
// screen and the canvas call, so this file tests them rather than the source text that wires them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  shopRewardRow, shopRewardRowActive, shopDisplayPrivate, shopDisplaySlot, shopRewardIndex, shopHotkeyBuyIndex,
  rewardControlReason,
} from '../../public/js/ui/shop/ShopCanvas.js';
import { PHASE } from '../../shared/constants.js';

const normalSlots = [
  { kind: 'chess', id: 'chess_char_1_01_a', price: 3, basePrice: 3, sold: false },
  { kind: 'chess', id: 'chess_char_1_02_a', price: 3, basePrice: 3, sold: false },
  { kind: 'chess', id: 'chess_char_1_03_a', price: 3, basePrice: 3, sold: false },
  { kind: 'chess', id: 'chess_char_1_04_a', price: 3, basePrice: 3, sold: false },
  { kind: 'chess', id: 'chess_char_1_05_a', price: 3, basePrice: 3, sold: false },
  { kind: 'item', id: 'chess_item_1_01_e_a', price: 1, basePrice: 1, sold: false },
];

/** N offer slots of one kind, in the shape the server sends (price 0, unsold). */
const offerSlots = (n, kind = 'chess') => Array.from({ length: n }, (_, i) => ({
  kind, id: `offer_${kind}_${i}_a`, price: 0, sold: false,
}));

const priv = (offer = offerSlots(3), offerExtra = {}) => ({
  funds: 10,
  shop: {
    level: 3,
    maxLevel: 6,
    slots: normalSlots.map((s) => ({ ...s })),
    layout: { chess: 5, item: 1 },
    rewardOffer: offer ? { source: 'merge', slots: offer, ...offerExtra } : null,
  },
});

// ---- every offer slot is drawn; the short offers keep their old positions -------------------------------

test('3-slot promotion reward (regression): normal chess count, N-3 empty fronts, last three cards at price 0, no item slot', () => {
  const offer = offerSlots(3);
  const p = priv(offer);
  const row = shopRewardRow(p);
  assert.ok(row);
  assert.equal(row.count, 3);
  assert.equal(row.slots.length, 5);
  assert.equal(row.start, 2);
  assert.equal(row.slots[0], null);
  assert.equal(row.slots[1], null);
  assert.deepEqual(row.slots.slice(2).map((s) => s.id), offer.map((s) => s.id));
  assert.ok(row.slots.slice(2).every((s) => s.price === 0 && s.basePrice === 0));
  assert.ok(row.slots.every((s) => !s || s.kind === 'chess'), 'the normal item slot is omitted');
});

test('2-slot offer (信标): the normal chess row length stays, the two cards map to indices 3 and 4', () => {
  const offer = offerSlots(2, 'item');
  const p = priv(offer);
  const row = shopRewardRow(p);
  assert.equal(row.count, 2);
  assert.equal(row.slots.length, 5);
  assert.equal(row.start, 3);
  assert.deepEqual(row.slots.map((s) => s?.id ?? null), [null, null, null, offer[0].id, offer[1].id]);
  assert.deepEqual(row.slots.slice(3).map((s) => s.kind), ['item', 'item'], 'an item offer keeps its item cards');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => shopRewardIndex(p, i)), [-1, -1, -1, 0, 1, -1]);
  assert.equal(shopDisplaySlot(p, 3).id, offer[0].id);
  assert.equal(shopDisplaySlot(p, 4).id, offer[1].id);
  assert.equal(shopDisplaySlot(p, 5), null, 'the item slot is still outside the reward row');
});

test('6-slot 精锐版一次性促销券: the row grows to every offer slot and indices 0..5 all select', () => {
  const offer = offerSlots(6);
  const p = priv(offer);
  const row = shopRewardRow(p);
  assert.equal(row.count, 6);
  assert.equal(row.slots.length, 6, 'the row grows to the offer instead of dropping its last three cards');
  assert.equal(row.start, 0, 'no empty front is needed when the offer fills the row');
  assert.deepEqual(row.slots.map((s) => s.id), offer.map((s) => s.id));
  assert.ok(row.slots.every((s) => s.price === 0 && s.basePrice === 0));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => shopRewardIndex(p, i)), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => shopDisplaySlot(p, i)?.id), offer.map((s) => s.id));
  assert.equal(shopRewardIndex(p, 6), -1);
  assert.equal(shopDisplaySlot(p, 6), null);
  const shown = shopDisplayPrivate(p);
  assert.equal(shown.shop.slots.length, 6);
  assert.equal(shown.shop.layout.chess, 6);
  assert.equal(shown.shop.layout.item, 0, 'the item slot is not shown over the offer row');
  assert.equal(p.shop.slots.length, 6, 'the original private is not mutated');
  assert.equal(p.shop.layout.item, 1);
});

test('a 6-slot offer in a wider chess row keeps the empty fronts and still maps 0..5', () => {
  const offer = offerSlots(6);
  const p = priv(offer);
  p.shop.slots = [...normalSlots, { kind: 'chess', id: 'chess_char_1_06_a', price: 3, basePrice: 3, sold: false }];
  p.shop.layout = { chess: 7, item: 1 };
  const row = shopRewardRow(p);
  assert.equal(row.slots.length, 7);
  assert.equal(row.start, 1);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => shopRewardIndex(p, i)), [-1, 0, 1, 2, 3, 4, 5]);
  assert.equal(row.slots[0], null);
});

test('a malformed offer longer than the server cap is clamped to MAX_OFFER_SLOTS (6)', () => {
  const offer = offerSlots(9);
  const p = priv(offer);
  const row = shopRewardRow(p);
  assert.equal(row.count, 6, 'never more than the server ever sends');
  assert.equal(row.slots.length, 6, 'the row holds the cap, not every malformed slot');
  assert.equal(row.start, 0);
  assert.deepEqual(row.slots.map((s) => s.id), offer.slice(0, 6).map((s) => s.id), 'the first six, as the server slices its own list');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => shopRewardIndex(p, i)), [0, 1, 2, 3, 4, 5]);
  assert.equal(shopRewardIndex(p, 6), -1, 'a clamped slot is unreachable');
  assert.equal(shopDisplayPrivate(p).shop.slots.length, 6);
});

test('the reward row is drawn only in the PREP phase', () => {
  const p = priv(offerSlots(6));
  assert.equal(shopRewardRow(p, false, PHASE.SP_DRAFT), null, 'ROUND_START / 机变阶段 (SP_DRAFT) draws the normal row');
  assert.equal(shopDisplayPrivate(p, false, PHASE.SP_DRAFT), p);
  assert.equal(shopRewardRow(p, false, PHASE.PREP)?.count, 6, 'prep still synthesises the offer row');
});

test('the root marks the reward row while its display indices are shown', () => {
  const p = priv(offerSlots(3));
  assert.equal(shopRewardRowActive(p, false, PHASE.PREP), true, 'the offer row occupies the display indices');
  assert.equal(shopRewardRowActive(p, true, PHASE.PREP), false, '稍后 draws the ordinary, priv-indexed row');
  assert.equal(shopRewardRowActive(p, false, PHASE.SP_DRAFT), false, 'a non-PREP phase keeps the ordinary row');
  assert.equal(shopRewardRowActive(priv(null), false, PHASE.PREP), false, 'no offer, no reward row');
});

// ---- 稍后 (rewardMin): the normal row returns, mouse and hotkey both index priv.shop.slots --------------

test('稍后: the row helpers fall back to the untouched private, so the normal row is drawn and buyable', () => {
  const p = priv(offerSlots(3));
  assert.equal(shopRewardRow(p, true), null);
  assert.equal(shopDisplayPrivate(p, true), p);
  assert.equal(shopDisplaySlot(p, 5, true).kind, 'item', 'the normal item slot comes back');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => shopRewardIndex(p, i, true)), [-1, -1, -1, -1, -1, -1]);
  for (let i = 0; i < p.shop.slots.length; i += 1) {
    assert.equal(shopDisplaySlot(p, i, true), p.shop.slots[i], `display index ${i} is the priv slot`);
  }
  // the 6-slot offer minimises the same way: the normal row, not a 6-long offer row
  const big = priv(offerSlots(6));
  assert.equal(shopDisplayPrivate(big, true), big);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => shopRewardIndex(big, i, true)), [-1, -1, -1, -1, -1, -1]);
});

test('the row helpers treat a minimized pick as no offer, per call (rewardMin is not sticky on the private)', () => {
  const p = priv(offerSlots(6));
  assert.equal(shopRewardRow(p, false)?.count, 6);
  assert.equal(shopRewardRow(p, true), null);
  assert.equal(shopRewardRow(p, false)?.count, 6, 'the same private still synthesises the offer row');
});

// ---- the buy hotkey: the row on screen decides what the display index means ------------------------------

test('DOM + pending offer + 稍后: the card under the pointer buys at its priv index', () => {
  const p = priv(offerSlots(3));
  // Before 稍后 the DOM bar draws the offer's own cards (no data-shop-slot, so they are not hotkey targets);
  // 稍后 puts the normal row back, where display index 3 is priv slot 3.
  const idx = shopHotkeyBuyIndex(p, 3, { canvas: false, rewardMin: true });
  assert.equal(idx, 3);
  assert.equal(p.shop.slots[idx].id, normalSlots[3].id, 'the card under the pointer is the priv slot');
});

test('the canvas keeps the two-tap flow: its synthesised offer row is not a buy-hotkey row', () => {
  const p = priv(offerSlots(3));
  assert.equal(shopRewardIndex(p, 3), 1, 'display index 3 is offer card 1 there');
  assert.equal(shopHotkeyBuyIndex(p, 3, { canvas: true, rewardMin: false }), -1, 'the hotkey must not buy priv slot 3');
  assert.equal(shopHotkeyBuyIndex(priv(offerSlots(6)), 3, { canvas: true }), -1, 'the 6-slot row is a display row too');
  assert.equal(shopHotkeyBuyIndex(p, 3, { canvas: true, rewardMin: true }), 3, 'after 稍后 the normal row returns');
  assert.equal(shopHotkeyBuyIndex(p, 6, { canvas: true, rewardMin: true }), -1, 'past the normal row');
  assert.equal(shopHotkeyBuyIndex(priv(null), 3, { canvas: true }), 3, 'without an offer the row is already priv-indexed');
  assert.equal(shopHotkeyBuyIndex(p, -1), -1);
  assert.equal(shopHotkeyBuyIndex(p, 1.5), -1);
});

test('the reward row blocks refresh/freeze (and the R/F hotkeys use the same reason)', () => {
  const offer = { slots: offerSlots(3) };
  assert.equal(rewardControlReason(offer, false, PHASE.PREP), '请先选择奖励');
  assert.equal(rewardControlReason(offer, true, PHASE.PREP), null, '稍后 puts the ordinary controls back');
  assert.equal(rewardControlReason(offer, false, PHASE.SP_DRAFT), null, 'only the PREP offer row gates them');
  assert.equal(rewardControlReason(null, false, PHASE.PREP), null);
});
