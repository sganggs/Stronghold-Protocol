// test/ui/shop-reward.test.js — the pick-one offer is the normal shop frame with 0-price cards.
// It must not close the WebGL shop, must not show the item slot or a FREE flag, and must not survive as a
// separate golden layer. Every offer slot is drawn: a 2-slot offer (信标) and a 3-slot promotion reward keep
// their old last-two / last-three positions, a 6-slot 精锐版一次性促销券 (server MAX_OFFER_SLOTS) must not lose
// the slots behind the third. In canvas mode the row's title / queued count and 稍后 live in a DOM strip that
// feeds the same rewardMin state as the DOM bar, so 稍后 falls back to the normal, buyable row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  shopRewardRow, shopDisplayPrivate, shopDisplaySlot, shopRewardIndex, shopHotkeyBuyIndex,
} from '../../public/js/ui/shop/ShopCanvas.js';
import { PHASE } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  assert.equal(shopRewardRow(p, false, PHASE.SP_DRAFT), null, 'round start / strategy draft keeps the normal row');
  assert.equal(shopDisplayPrivate(p, false, PHASE.SP_DRAFT), p);
  assert.equal(shopRewardRow(p, false, PHASE.PREP)?.count, 6, 'prep still synthesises the offer row');
});

test('the canvas root marks the reward row so SHOP_SLOT commands skip its display indices', () => {
  assert.match(CANVAS_SOURCE, /const rewardRowOn = shopRewardRow\(props\.priv, !!props\.rewardMin, props\.phase\) !== null;/);
  assert.match(CANVAS_SOURCE, /data-shop-reward-row=\$\{rewardRowOn \? '1' : undefined\}/);
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

// ---- wiring: game.js rewardMin → the row helpers -------------------------------------------------------

const GAME_SOURCE = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
const CANVAS_SOURCE = readFileSync(path.join(ROOT, 'public/js/ui/shop/ShopCanvas.js'), 'utf8');
const CTRL_SOURCE = readFileSync(path.join(ROOT, 'public/js/ui/shop/ctrl.js'), 'utf8');
const SHOPBAR_SOURCE = readFileSync(path.join(ROOT, 'public/js/ui/shopBar.js'), 'utf8');

/** The buy hotkey branch, delimited by the next prep-shortcut branch (retreat / sell). */
function buyHotkeyBranch(source) {
  const start = source.search(/if\s*\(\s*act\s*===\s*['"]buy['"]\s*\)/);
  assert.notEqual(start, -1, 'game.js has a buy hotkey branch');
  const rest = source.slice(start);
  const end = rest.search(/if\s*\(\s*act\s*===\s*['"](?:retreat|sell)['"]/);
  assert.ok(end > 0, 'the buy branch ends before the retreat / sell branch');
  return rest.slice(0, end);
}

/** The RewardCards component body: the offer's cards in the DOM bar. */
function rewardCardsSource(source) {
  const start = source.indexOf('export function RewardCards');
  const end = source.indexOf('function FundsChar', start);
  assert.ok(start > 0 && end > start, 'shopBar.js has a RewardCards component');
  return source.slice(start, end);
}

test('DOM + pending offer + 稍后: W buys the card under the pointer at its priv index', () => {
  const p = priv(offerSlots(3));
  // Before 稍后 the DOM bar has no normal card at all: the offer replaces the row with RewardCards, whose
  // cards are `free` and therefore carry no data-shop-slot (the normal cards below do).
  assert.match(SHOPBAR_SOURCE, /showReward \? html`<\$\{RewardCards\}/, 'the offer replaces the normal cards');
  assert.doesNotMatch(rewardCardsSource(SHOPBAR_SOURCE), /data-shop-slot/, 'offer cards are not hotkey targets');
  assert.match(SHOPBAR_SOURCE, /data-shop-slot=\$\{free \? undefined : idx\}/, 'normal cards are the only hotkey targets');
  // 稍后 puts the normal row back: display index 3 is priv slot 3, and the branch buys exactly that slot.
  const idx = shopHotkeyBuyIndex(p, 3, { canvas: false, rewardMin: true });
  assert.equal(idx, 3);
  assert.equal(p.shop.slots[idx].id, normalSlots[3].id, 'the card under the pointer is the priv slot');
  const branch = buyHotkeyBranch(GAME_SOURCE);
  assert.match(branch, /shopHotkeyBuyIndex\(L\.priv, Number\(card\.dataset\.shopSlot\), \{ canvas: !!L\.canvasShop, rewardMin: !!L\.rewardMin, phase: L\.pub\?\.phase \}\)/);
  assert.ok(branch.indexOf('shopHotkeyBuyIndex') < branch.indexOf('await buy('), 'the helper runs before the purchase');
  assert.match(GAME_SOURCE, /live\.current = \{[^}]*rewardMin[^}]*canvasShop: webglShopOn\.on/, 'the once-bound key handler sees both flags');
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

test('the canvas row still receives the rewardMin state', () => {
  assert.match(GAME_SOURCE, /rewardMin=\$\{rewardMin\}/, 'the host receives the minimized state');
  assert.match(CANVAS_SOURCE, /shopDisplayPrivate\(propsRef\.current\.priv, !!propsRef\.current\.rewardMin, propsRef\.current\.phase\)/);
  assert.match(CANVAS_SOURCE, /shopDisplaySlot\(p\.priv, index, !!p\.rewardMin, p\.phase\)/);
  assert.match(CANVAS_SOURCE, /shopRewardIndex\(p\.priv, index, !!p\.rewardMin, p\.phase\)/);
});

test('the DOM fallback keeps its reward pill; the canvas draws no DOM pill', () => {
  assert.match(GAME_SOURCE, /phase === PHASE\.PREP && priv\?\.shop\?\.rewardOffer && !webglShopOn\.on/,
    'the DOM fallback mount is unchanged');
  assert.equal((GAME_SOURCE.match(/<\$\{RewardOverlay\}/g) || []).length, 1, 'only the DOM fallback mounts the pill');
  assert.doesNotMatch(GAME_SOURCE, /webglShopOn\.on && \(rewardMin \|\| barCollapsed\)/,
    'the canvas mode no longer mounts a DOM pill');
});

test('the R/F hotkeys reuse the canvas reward guard, and a frozen shop keeps its unfreeze face', () => {
  assert.match(GAME_SOURCE, /L\.canvasShop && L\.pub\?\.phase === PHASE\.PREP && L\.priv\?\.shop\?\.rewardOffer[\s\S]*?act === 'refresh' \|\| act === 'freeze'/);
  assert.match(GAME_SOURCE, /toast\(t\('请先选择奖励'\), 'warn'\)/);
  assert.match(CTRL_SOURCE, /data\.isFrozen \? 2 : \(data\.freezeBlocked \? 0 : 1\)/,
    'a frozen shop shows 解冻 even after the ready lock');
});

test('no reward slot count is pinned any more', () => {
  assert.doesNotMatch(CANVAS_SOURCE, /REWARD_SLOT_COUNT/);
  assert.doesNotMatch(GAME_SOURCE, /REWARD_SLOT_COUNT/);
});
