// test/ui/shop-reward.test.js — the promotion reward is the normal shop frame with three 0-price cards.
// It must not close the WebGL shop, must not show the item slot or a FREE flag, and must not survive as a
// separate golden layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shopRewardRow, shopDisplayPrivate, shopDisplaySlot, shopRewardIndex, REWARD_SLOT_COUNT } from '../../public/js/ui/shop/ShopCanvas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const normalSlots = [
  { kind: 'chess', id: 'chess_char_1_01_a', price: 3, basePrice: 3, sold: false },
  { kind: 'chess', id: 'chess_char_1_02_a', price: 3, basePrice: 3, sold: false },
  { kind: 'chess', id: 'chess_char_1_03_a', price: 3, basePrice: 3, sold: false },
  { kind: 'chess', id: 'chess_char_1_04_a', price: 3, basePrice: 3, sold: false },
  { kind: 'chess', id: 'chess_char_1_05_a', price: 3, basePrice: 3, sold: false },
  { kind: 'item', id: 'chess_item_1_01_e_a', price: 1, basePrice: 1, sold: false },
];
const offerSlots = [
  { kind: 'chess', id: 'chess_char_2_01_a', price: 0, sold: false },
  { kind: 'chess', id: 'chess_char_2_02_a', price: 0, sold: false },
  { kind: 'chess', id: 'chess_char_2_03_a', price: 0, sold: false },
];
const priv = (offer = offerSlots) => ({
  funds: 10,
  shop: {
    level: 3,
    maxLevel: 6,
    slots: normalSlots.map((s) => ({ ...s })),
    layout: { chess: 5, item: 1 },
    rewardOffer: offer ? { source: 'merge', slots: offer } : null,
  },
});

test('reward: normal chess count, N-3 empty, last three offer cards at price 0, no item slot', () => {
  assert.equal(REWARD_SLOT_COUNT, 3);
  const p = priv();
  const row = shopRewardRow(p);
  assert.ok(row);
  assert.equal(row.slots.length, 5);
  assert.equal(row.start, 2);
  assert.equal(row.slots[0], null);
  assert.equal(row.slots[1], null);
  assert.deepEqual(row.slots.slice(2).map((s) => s.id), offerSlots.map((s) => s.id));
  assert.ok(row.slots.slice(2).every((s) => s.price === 0 && s.basePrice === 0));
  assert.ok(row.slots.every((s) => !s || s.kind === 'chess'), 'the normal item slot is omitted');
});

test('reward display private keeps the original private intact', () => {
  const p = priv();
  const shown = shopDisplayPrivate(p);
  assert.equal(shown.shop.slots.length, 5);
  assert.equal(shown.shop.layout.item, 0);
  assert.equal(p.shop.slots.length, 6);
  assert.equal(p.shop.layout.item, 1);
  assert.equal(p.shop.rewardOffer.slots.length, 3);
});

test('reward index maps only the last three; empty fronts map to -1', () => {
  const p = priv();
  assert.equal(shopRewardIndex(p, 0), -1);
  assert.equal(shopRewardIndex(p, 1), -1);
  assert.equal(shopRewardIndex(p, 2), 0);
  assert.equal(shopRewardIndex(p, 4), 2);
  assert.equal(shopDisplaySlot(p, 0), null);
  assert.equal(shopDisplaySlot(p, 2).id, offerSlots[0].id);
  assert.equal(shopDisplaySlot(p, 5), null, 'the item slot is outside the reward row');
});

test('no rewardOffer keeps the original slots; clearing the offer restores the normal row', () => {
  const p = priv(null);
  assert.equal(shopRewardRow(p), null);
  assert.equal(shopDisplayPrivate(p), p);
  assert.equal(shopRewardIndex(p, 2), -1);
  assert.equal(shopDisplaySlot(p, 5).kind, 'item');
  const rewarded = priv();
  rewarded.shop.rewardOffer = null;
  assert.equal(shopDisplayPrivate(rewarded), rewarded);
  assert.equal(rewarded.shop.slots.length, 6);
});

test('reward index / display slot map the display row only: empty fronts, offer cards, out of range', () => {
  const p = priv();
  // empty fronts: no reward card and no display slot
  assert.deepEqual([0, 1].map((i) => shopRewardIndex(p, i)), [-1, -1]);
  assert.deepEqual([0, 1].map((i) => shopDisplaySlot(p, i)), [null, null]);
  // the last three positions are the offer cards, in order
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => shopRewardIndex(p, i)), [-1, -1, 0, 1, 2]);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => shopDisplaySlot(p, i)?.id ?? null),
    [null, null, ...offerSlots.map((s) => s.id)],
  );
  // out of range: past the row and before it
  for (const i of [-1, 5, 6, 99]) {
    assert.equal(shopRewardIndex(p, i), -1, `index ${i} is not a reward card`);
    assert.equal(shopDisplaySlot(p, i), null, `index ${i} has no display slot`);
  }
});

test('a short offer keeps the normal chess row length and maps only its own cards', () => {
  const p = priv(offerSlots.slice(0, 2));
  const row = shopRewardRow(p);
  assert.equal(row.slots.length, 5);
  assert.equal(row.start, 3);
  assert.deepEqual(row.slots.map((s) => s?.id ?? null), [null, null, null, offerSlots[0].id, offerSlots[1].id]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => shopRewardIndex(p, i)), [-1, -1, -1, 0, 1, -1]);
});

test('without an offer the mapping is the identity over priv.shop.slots', () => {
  const p = priv(null);
  for (let i = 0; i < p.shop.slots.length; i += 1) {
    assert.equal(shopRewardIndex(p, i), -1);
    assert.equal(shopDisplaySlot(p, i), p.shop.slots[i]);
  }
  assert.equal(shopDisplaySlot(p, 6), null, 'past the normal row');
  assert.equal(shopDisplaySlot(p, -1), null);
  assert.equal(shopDisplaySlot({ funds: 1, shop: { slots: [] } }, 0), null, 'a private without slots has none');
});

const GAME_SOURCE = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');

/** The buy hotkey branch, delimited by the next prep-shortcut branch (retreat / sell). */
function buyHotkeyBranch(source) {
  const start = source.search(/if\s*\(\s*act\s*===\s*['"]buy['"]\s*\)/);
  assert.notEqual(start, -1, 'game.js has a buy hotkey branch');
  const rest = source.slice(start);
  const end = rest.search(/if\s*\(\s*act\s*===\s*['"](?:retreat|sell)['"]/);
  assert.ok(end > 0, 'the buy branch ends before the retreat / sell branch');
  return rest.slice(0, end);
}

test('the buy hotkey returns while a reward offer is shown (display index ≠ priv.shop.slots index)', () => {
  const branch = buyHotkeyBranch(GAME_SOURCE);
  const guard = branch.match(/if\s*\(\s*L\.priv\?\.shop\?\.rewardOffer\s*\)\s*return\s*;/);
  assert.ok(guard, 'the buy branch guards on L.priv.shop.rewardOffer');
  const guardAt = branch.indexOf(guard[0]);
  assert.ok(guardAt < branch.indexOf('barRef.current'), 'the guard runs before the hotspot under the pointer is read');
  assert.ok(guardAt < branch.indexOf('await buy('), 'the guard runs before a slot index is sent as a purchase');
});

