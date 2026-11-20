// test/ui/shop-cardflags.test.js — the renderer's duplicated-operator flags (ui/shop/ShopCanvas.js).
// The card view/slots already implement hasSame/canComb/hasFusePartner/repeated; the product view must fill
// them from mergeProgress for chess cards only. Items stay false until their merge path is specified.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shopCardFlags } from '../../public/js/ui/shop/ShopCanvas.js';

const RECORDS = {
  chess_char_1_01_a: { id: 'chess_char_1_01_a', upgradeNum: 3, isGolden: false },
  chess_char_1_02_a: { id: 'chess_char_1_02_a', upgradeNum: 3, isGolden: false },
  chess_char_1_03_a: { id: 'chess_char_1_03_a', upgradeNum: 1, isGolden: false },
  chess_char_9_99_b: { id: 'chess_char_9_99_b', upgradeNum: 3, isGolden: true },
  chess_item_1_01_e_a: { id: 'chess_item_1_01_e_a', baseId: 'chess_item_1_01_e_a', itemType: 'EQUIP', mergeable: true, isGolden: false, upgradeNum: 2, upgradeChessId: 'chess_item_1_01_e_b' },
  chess_item_1_01_e_b: { id: 'chess_item_1_01_e_b', itemType: 'EQUIP', mergeable: true, isGolden: true, upgradeNum: 2 },
  chess_item_2_01_e_a: { id: 'chess_item_2_01_e_a', itemType: 'EQUIP', mergeable: false, isGolden: false, upgradeNum: 2, upgradeChessId: 'chess_item_2_01_e_b' },
  chess_item_3_01_e_a: { id: 'chess_item_3_01_e_a', itemType: 'EQUIP', mergeable: true, isGolden: false, upgradeNum: 2, upgradeChessId: 'chess_item_3_01_e_b' },
  chess_item_4_01_e_a: { id: 'chess_item_4_01_e_a', itemType: 'MAGIC', mergeable: true, isGolden: false, upgradeNum: 2, upgradeChessId: 'chess_item_4_01_e_b' },
};
const lookup = (kind, id) => (kind === 'chess' ? RECORDS[id] || null : RECORDS[id] || null);
const slot = (id, kind = 'chess') => ({ kind, id, price: 2, basePrice: 2, sold: false, frozen: false });
const priv = (slots, pieces = []) => ({ funds: 10, shop: { slots }, board: pieces, hand: [], temp: [] });
const piece = (id) => ({ kind: 'chess', id, uid: `u-${id}` });

test('0 copies: no hasSame/canComb; hasFusePartner stays false', () => {
  const flags = shopCardFlags(priv([slot('chess_char_1_01_a')]), lookup);
  assert.deepEqual(flags[0], { hasSame: false, canComb: true, hasFusePartner: false });
});

test('1 and 2 copies: hasSame true, canComb true while not golden', () => {
  const one = shopCardFlags(priv([slot('chess_char_1_01_a')], [piece('chess_char_1_01_a')]), lookup);
  assert.deepEqual(one[0], { hasSame: true, canComb: true, hasFusePartner: false });
  const two = shopCardFlags(priv([slot('chess_char_1_01_a')], [piece('chess_char_1_01_a'), piece('chess_char_1_01_a')]), lookup);
  assert.deepEqual(two[0], { hasSame: true, canComb: true, hasFusePartner: false });
});

test('a golden record never combines and mergeProgress reports no normal copies', () => {
  const flags = shopCardFlags(priv([slot('chess_char_9_99_b')], [piece('chess_char_9_99_b')]), lookup);
  assert.deepEqual(flags[0], { hasSame: false, canComb: false, hasFusePartner: false });
});

test('need=1 cannot combine even with copies', () => {
  const flags = shopCardFlags(priv([slot('chess_char_1_03_a')], [piece('chess_char_1_03_a')]), lookup);
  assert.deepEqual(flags[0], { hasSame: true, canComb: false, hasFusePartner: false });
});

test('equipment participates; empty/non-equipment slots stay false; chess keeps its own index', () => {
  const flags = shopCardFlags(priv([slot('chess_item_1_01_e_a', 'item'), null, slot('chess_char_1_01_a')], [piece('chess_char_1_01_a')]), lookup);
  assert.deepEqual(flags[0], { hasSame: false, canComb: true, hasFusePartner: false });
  assert.deepEqual(flags[1], { hasSame: false, canComb: false, hasFusePartner: false });
  assert.deepEqual(flags[2], { hasSame: true, canComb: true, hasFusePartner: false });
});

test('a changed priv produces new flags (data/lang updates reuse this recompute)', () => {
  const slots = [slot('chess_char_1_01_a')];
  assert.equal(shopCardFlags(priv(slots), lookup)[0].hasSame, false);
  assert.equal(shopCardFlags(priv(slots, [piece('chess_char_1_01_a')]), lookup)[0].hasSame, true);
});

test('equipment: 0/1 owned copy, mergeable target → hasSame false/true, canComb true', () => {
  const slotA = slot('chess_item_1_01_e_a', 'item');
  const noCopy = shopCardFlags(priv([slotA]), lookup);
  assert.deepEqual(noCopy[0], { hasSame: false, canComb: true, hasFusePartner: false });
  const boardCopy = shopCardFlags(priv([slotA], [{ kind: 'item', id: 'chess_item_1_01_e_a', uid: 'i1' }]), lookup);
  assert.deepEqual(boardCopy[0], { hasSame: true, canComb: true, hasFusePartner: false });
  const equippedCopy = shopCardFlags(priv([slotA], [{ kind: 'chess', id: 'c1', items: [{ id: 'chess_item_1_01_e_a', uid: 'i2' }] }]), lookup);
  assert.deepEqual(equippedCopy[0], { hasSame: true, canComb: true, hasFusePartner: false });
});

test('equipment: golden, non-mergeable, missing target and MAGIC never combine', () => {
  const golden = shopCardFlags(priv([slot('chess_item_1_01_e_b', 'item')], [{ kind: 'item', id: 'chess_item_1_01_e_b', uid: 'g' }]), lookup);
  assert.deepEqual(golden[0], { hasSame: true, canComb: false, hasFusePartner: false });
  const noMerge = shopCardFlags(priv([slot('chess_item_2_01_e_a', 'item')]), lookup);
  assert.deepEqual(noMerge[0], { hasSame: false, canComb: false, hasFusePartner: false });
  const noTarget = shopCardFlags(priv([slot('chess_item_3_01_e_a', 'item')]), lookup);
  assert.deepEqual(noTarget[0], { hasSame: false, canComb: false, hasFusePartner: false });
  const magic = shopCardFlags(priv([slot('chess_item_4_01_e_a', 'item')]), lookup);
  assert.deepEqual(magic[0], { hasSame: false, canComb: false, hasFusePartner: false });
});

test('sold equipment/operator cards are not flagged', () => {
  const sold = slot('chess_item_1_01_e_a', 'item'); sold.sold = true;
  const flags = shopCardFlags(priv([sold], [{ kind: 'item', id: 'chess_item_1_01_e_a', uid: 'i1' }]), lookup);
  assert.deepEqual(flags[0], { hasSame: false, canComb: false, hasFusePartner: false });
});

test('an owned equipment counts from the hand, the temp row and an equipped piece', () => {
  const s = [slot('chess_item_1_01_e_a', 'item')];
  const flagsFor = (pieces) => shopCardFlags({ funds: 10, shop: { slots: s }, board: [], hand: [], temp: [], ...pieces }, lookup);
  assert.equal(flagsFor({ hand: [{ kind: 'item', id: 'chess_item_1_01_e_a' }] })[0].hasSame, true, 'the same item in the hand');
  assert.equal(flagsFor({ temp: [{ kind: 'item', id: 'chess_item_1_01_e_a' }] })[0].hasSame, true, 'the same item in the temp row');
  assert.equal(flagsFor({ board: [{ kind: 'chess', id: 'chess_char_1_01_a', items: [{ id: 'chess_item_1_01_e_a' }] }] })[0].hasSame, true, 'the same item on an operator');
});
