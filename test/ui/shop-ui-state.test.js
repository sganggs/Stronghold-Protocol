// test/ui/shop-ui-state.test.js — the shop view's pure state derivation:
//  - the row identity behind the refresh animation (only a replaced row bumps it),
//  - the hand-full flag the card model reads,
//  - the card view's buyable flag,
//  - the slots panel's refresh bookkeeping (no clip on the first render, script anims clip after),
//  - the UIButton cooldown/guard split.
// The renderer and the host are not involved: every case is a plain function/class call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HOST_SOURCE = readFileSync(new URL('../../public/js/ui/shop/host.js', import.meta.url), 'utf8');

import { GEO } from '../../shared/constants.js';
import { shopSignature, cardModelFromSlot } from '../../public/js/ui/shop/adapter/model.js';
import { shopCardFlags, shopCardFlagsWithHand } from '../../public/js/ui/shop/ShopCanvas.js';
import { cardAble } from '../../public/js/ui/shop/cardView.js';
import { UIButton } from '../../public/js/ui/shop/widgets.js';
import { AutoChessStylizedShopSlotsPanel } from '../../public/js/ui/shop/slots.js';

const CHESS = (id) => ({ id, upgradeNum: 3, isGolden: false });
const ITEM = (id) => ({ id, itemType: 'EQUIP', mergeable: true, isGolden: false, upgradeNum: 2, upgradeChessId: `${id}_b` });
const RECORDS = {
  chess_1: CHESS('chess_1'),
  chess_2: CHESS('chess_2'),
  item_1: ITEM('item_1'),
  item_1_b: ITEM('item_1_b'),
};
const lookup = (kind, id) => RECORDS[id] || null;
const slot = (id, kind = 'chess', extra = {}) => ({ kind, id, price: 2, basePrice: 2, sold: false, frozen: false, ...extra });
const privOf = (slots, extra = {}) => ({
  funds: 10,
  shop: { level: 1, layout: { chess: 3, item: 1 }, slots, ...(extra.shop || {}) },
  board: extra.board || [],
  hand: extra.hand || [],
  temp: extra.temp || [],
});

// ---- shopSignature: the refresh animation reacts to a replaced row only ---------------------------------

test('shopSignature ignores sold/price/frozen/level: buying, freezing or a price shift is not a refresh', () => {
  const row = [slot('chess_1'), slot('chess_2'), null, slot('item_1', 'item')];
  const base = shopSignature(privOf(row));
  assert.equal(shopSignature(privOf(row.map((s) => (s ? { ...s, sold: true } : s)))), base, 'sold');
  assert.equal(shopSignature(privOf(row.map((s) => (s ? { ...s, frozen: true } : s)))), base, 'frozen');
  assert.equal(shopSignature(privOf(row.map((s) => (s ? { ...s, price: 9 } : s)))), base, 'price');
  assert.equal(shopSignature(privOf(row, { shop: { level: 5 } })), base, 'shop level');
});

test('shopSignature bumps on a replaced row, a changed kind, a changed layout or an empty position', () => {
  const base = shopSignature(privOf([slot('chess_1'), slot('chess_2')]));
  assert.notEqual(shopSignature(privOf([slot('chess_2'), slot('chess_1')])), base, 'reordered row');
  assert.notEqual(shopSignature(privOf([slot('chess_1'), slot('chess_1')])), base, 'rerolled id');
  assert.notEqual(shopSignature(privOf([slot('chess_1'), slot('chess_2', 'item')])), base, 'changed kind');
  assert.notEqual(shopSignature(privOf([slot('chess_1')], { shop: { layout: { chess: 1, item: 1 } } })), base, 'layout');
  assert.notEqual(shopSignature(privOf([slot('chess_1'), null])), base, 'empty position');
});

test('shopSignature tolerates a missing private state and missing slots', () => {
  assert.equal(shopSignature(null), '|');
  assert.equal(shopSignature({}), '|');
  assert.equal(shopSignature({ shop: { slots: [] } }), '|');
});

// ---- handFull: the full-hand refusal must reach the card model ------------------------------------------

test('shopCardFlagsWithHand: a full hand marks every live card, empty and sold slots stay false', () => {
  const hand = Array.from({ length: GEO.HAND_SIZE }, (_, i) => ({ kind: 'chess', id: `owned_${i}` }));
  const slots = [slot('chess_1'), slot('item_1', 'item'), null, slot('chess_2', 'chess', { sold: true })];
  const open = shopCardFlagsWithHand(privOf(slots), lookup);
  assert.equal(open[0].isHandFull, false);
  const full = shopCardFlagsWithHand(privOf(slots, { hand }), lookup);
  assert.equal(full[0].isHandFull, true, 'chess card');
  assert.equal(full[1].isHandFull, true, 'item card keeps using the chess hand without the equipHand rule');
  assert.equal(full[2].isHandFull, false, 'empty slot');
  assert.equal(full[3].isHandFull, false, 'sold slot');
});

test('handFull: a hole in the hand does not count as full', () => {
  const hand = Array.from({ length: GEO.HAND_SIZE }, (_, i) => ({ kind: 'chess', id: `owned_${i}` }));
  hand[4] = null;
  const flags = shopCardFlagsWithHand(privOf([slot('chess_1')], { hand }), lookup);
  assert.equal(flags[0].isHandFull, false);
});

test('handFull: equipHand moves items onto the temp row, chess cards keep the hand', () => {
  const config = { version: { rules: { equipHand: true } } };
  const slots = [slot('chess_1'), slot('item_1', 'item')];
  const few = shopCardFlagsWithHand(privOf(slots, { temp: [{ kind: 'item', id: 't1' }, { kind: 'item', id: 't2' }] }), lookup, config);
  assert.equal(few[1].isHandFull, false, 'temp row not full');
  const fullTemp = Array.from({ length: GEO.TEMP_SIZE }, (_, i) => ({ kind: 'item', id: `temp_${i}` }));
  const full = shopCardFlagsWithHand(privOf(slots, { temp: fullTemp }), lookup, config);
  assert.equal(full[0].isHandFull, false, 'chess still reads the hand');
  assert.equal(full[1].isHandFull, true, 'item reads the full temp row');
  // Without the rule the item card also checks the chess hand: a full temp row alone blocks nothing.
  const plain = shopCardFlagsWithHand(privOf(slots, { temp: fullTemp }), lookup);
  assert.equal(plain[1].isHandFull, false);
});

test('shopCardFlags keeps its published shape (the flags regression test pins three keys)', () => {
  const flags = shopCardFlags(privOf([slot('chess_1')]), lookup);
  assert.deepEqual(Object.keys(flags[0]).sort(), ['canComb', 'hasFusePartner', 'hasSame']);
});

test('the card model carries the hand-full flag and the view derives buyability from it', () => {
  const priv = privOf([slot('chess_1')]);
  const open = cardModelFromSlot(priv.shop.slots[0], 0, priv, { cardFlags: { 0: { isHandFull: false } } });
  assert.equal(open.isHandFull, false);
  assert.equal(cardAble(open), true);
  const full = cardModelFromSlot(priv.shop.slots[0], 0, priv, { cardFlags: { 0: { isHandFull: true } } });
  assert.equal(full.isHandFull, true);
  assert.equal(cardAble(full), false);
});

test('cardAble: empty and sold cards are not buyable', () => {
  assert.equal(cardAble({ isHandFull: false }), true);
  assert.equal(cardAble({ isHandFull: true }), false);
  assert.equal(cardAble({ isEmpty: true, isHandFull: false }), false);
});

// ---- slots panel: first render records the sequence, later ones play the script anims clip --------------

const SLOT_LIST_NODE = { name: 'group_slots', children: [] };

function fakeSlotsPanel() {
  const root = {
    name: 'root_layout',
    scripts: [{
      class: 'AutoChessStylizedShopSlotsPanel',
      script: '-1',
      refs: { _slotList: 94 },
      anims: {
        _refreshAnim: { clip: 'whole_card_refresh_normal', on: 46 },
        _refreshSpecAnim: { clip: 'whole_card_refresh_special', on: 46 },
      },
    }],
    children: [],
  };
  const scene = {
    index: { byId: new Map([['94', SLOT_LIST_NODE]]) },
    cardViews: [],
    buildCard: () => { throw new Error('no card is built for an empty row'); },
  };
  return new AutoChessStylizedShopSlotsPanel({ scene, root });
}

test('slots panel: the first Render records refreshSeq without playing a clip', () => {
  const panel = fakeSlotsPanel();
  panel.Render({ refreshSeq: 0, slots: [] });
  assert.equal(panel.lastRefresh, null, 'a mount is not a refresh');
  assert.equal(panel.refreshSeq, 0);
  panel.Render({ refreshSeq: 0, slots: [] });
  assert.equal(panel.lastRefresh, null);
});

test('slots panel: a changed refreshSeq plays the script anims clip (special variant included)', () => {
  const panel = fakeSlotsPanel();
  panel.Render({ refreshSeq: 0, slots: [] });
  panel.Render({ refreshSeq: 1, slots: [] });
  assert.equal(panel.lastRefresh, 'whole_card_refresh_normal');
  panel.Render({ refreshSeq: 2, slots: [], isSpecialRecruit: true });
  assert.equal(panel.lastRefresh, 'whole_card_refresh_special');
});

// ---- UIButton: cooldown is the cooldown, guardSeconds is the click guard --------------------------------

test('UIButton: a cooldown blocks presses for its own length', () => {
  let presses = 0;
  const button = new UIButton({ onClick: () => { presses += 1; }, cooldown: 1 });
  assert.equal(button.IsInCooldown(1000), false, 'no press yet');
  assert.equal(button.Press(1000), true);
  assert.equal(button.IsInCooldown(1500), true);
  assert.equal(button.Press(1500), false);
  assert.equal(button.lastBlocked, 1500);
  assert.equal(button.IsInCooldown(2100), false);
  assert.equal(button.Press(2100), true);
  assert.equal(presses, 2);
});

test('UIButton: no cooldown means never on cooldown; guardSeconds still debounces a rapid press', () => {
  const button = new UIButton({ guardSeconds: 0.5 });
  assert.equal(button.Press(0), true);
  assert.equal(button.IsInCooldown(100), false, 'no cooldown configured');
  assert.equal(button.IsInGuard(100), true);
  assert.equal(button.Press(100), false);
  assert.equal(button.Press(600), true);
});

test('UIButton: a non-interactable button never presses', () => {
  const button = new UIButton({ interactable: false });
  assert.equal(button.Press(0), false);
});

test('UIButton: the 0.3 s refresh cooldown blocks at 290 ms and allows at 300 ms', () => {
  let presses = 0;
  const button = new UIButton({ onClick: () => { presses += 1; }, guardSeconds: 0.3, cooldown: 0.3 });
  assert.equal(button.Press(1000), true);
  assert.equal(button.IsInCooldown(1290), true);
  assert.equal(button.Press(1290), false);
  assert.equal(button.Press(1300), true);
  assert.equal(presses, 2);
});

test('the host binds the refresh button to 0.3 s, not the clickGuard boolean as 1 s', () => {
  assert.match(HOST_SOURCE, /refresh: new UIButton\(\{ guardSeconds: 0\.3, cooldown: 0\.3 \}\)/);
  assert.doesNotMatch(HOST_SOURCE, /refresh: new UIButton\(\{ guardSeconds: 0\.3, cooldown: 1 \}\)/);
  assert.doesNotMatch(HOST_SOURCE, /event: 'refresh', guard: 0\.3, cooldown: 1/);
});
