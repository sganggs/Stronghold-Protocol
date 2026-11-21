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
import { shopSignature, cardModelFromSlot, shopModelFromPrivate } from '../../public/js/ui/shop/adapter/model.js';
import { shopCardFlags, shopCardFlagsWithHand } from '../../public/js/ui/shop/ShopCanvas.js';
import { shopBlockReason } from '../../public/js/ui/gameLogic.js';
import { canRefreshOf } from '../../public/js/ui/shop/ctrl.js';
import { CtrlViewData } from '../../public/js/ui/shop/viewData.js';
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

// ---- UIButton: C# ClickGuardModule (cooldown bool + seconds) -------------------------------------------

test('UIButton: the prefab guard cooldown blocks at 290 ms and allows at 300 ms', () => {
  let presses = 0;
  const button = new UIButton({ onClick: () => { presses += 1; }, clickGuard: { cooldown: 1, seconds: 0.3 } });
  assert.equal(button.IsInCooldown(1000), false, 'no press yet');
  assert.equal(button.Press(1000), true);
  assert.equal(button.IsInCooldown(1290), true);
  assert.equal(button.Press(1290), false);
  assert.equal(button.lastBlocked, 1290);
  assert.equal(button.Press(1300), true);
  assert.equal(presses, 2);
});

test('UIButton: cooldown:0 (also with seconds:.5) is off; only refresh has a lock', () => {
  const button = new UIButton({ clickGuard: { cooldown: 0, seconds: 0.5 } });
  assert.equal(button.Press(0), true);
  assert.equal(button.IsInCooldown(100), false);
  assert.equal(button.Press(100), true, 'no client-side card/button debounce in the prefab');
});

test('UIButton: a non-interactable button never presses', () => {
  const button = new UIButton({ interactable: false });
  assert.equal(button.Press(0), false);
});

test('the host reads each control guard from the prefab UIButton, not hardcoded seconds', () => {
  assert.match(HOST_SOURCE, /clickGuardFor\(spec\.paths\)/);
  assert.doesNotMatch(HOST_SOURCE, /guardSeconds: 0\.5/);
  assert.doesNotMatch(HOST_SOURCE, /cooldown: 1/);
});

// ---- refresh affordability: the ctrl hotspot and the DOM control use shopBlockReason's one rule -------------

test('refresh: the server turns a free refresh into refreshPrice 0, and a special offer is not free', () => {
  const refresh = (priv, editable = true) => shopBlockReason('refresh', { priv, editable });
  // a free refresh arrives as price 0 (server/match/player/views.js), so enough funds means >= that price
  assert.equal(refresh({ funds: 0, shop: { refreshPrice: 0, freeRefreshes: 1 } }), null);
  assert.equal(refresh({ funds: 3, shop: { refreshPrice: 3 } }), null);
  assert.equal(refresh({ funds: 2, shop: { refreshPrice: 3 } }), '资金不足');
  // no special-refresh free pass: the ctrl used to paint a 定向投放 refresh as affordable with 0 funds
  assert.equal(refresh({ funds: 0, shop: { refreshPrice: 3, rewardOffer: { source: 'special' } } }), '资金不足');
  // a seat that may not act is refused with the phase/ready wording, not with a fund reason
  assert.equal(refresh({ funds: 9, ready: false, shop: { refreshPrice: 1 } }, false), '当前阶段无法进行该操作');
  assert.equal(refresh({ funds: 9, ready: true, shop: { refreshPrice: 1 } }, false), '已准备就绪，取消准备后才能操作');
  assert.equal(refresh({ alive: false, funds: 9, shop: { refreshPrice: 1 } }), '你已被淘汰');
});

test('the canvas control reasons use shopBlockReason for refresh with editable (not a funds-only helper)', () => {
  const canvas = readFileSync(new URL('../../public/js/ui/shop/ShopCanvas.js', import.meta.url), 'utf8');
  assert.match(canvas, /refresh: chooseFirst \|\| shopBlockReason\('refresh', \{ config: p\.config, priv: p\.priv, editable: p\.editable \}\)/,
    'the painted refresh face is not locked by the in-flight busy flag');
  assert.match(canvas, /if \(propsRef\.current\.refreshBusy\) return;/, 'the action itself still drops a second refresh');
  assert.doesNotMatch(canvas, /shopCanRefresh/, 'the old funds-only shortcut is gone');
});

// ---- the painted refresh control follows the hotspot's own rule -------------------------------------------

test('canRefreshOf: the published block reason wins; the cost-only fallback has no special-free pass', () => {
  assert.equal(canRefreshOf({ refreshBlocked: true, coinCount: 99, refreshCost: 0, freeRefreshCnt: 3 }), false,
    'blocked (ready / special + no funds) even with free refreshes or cost 0');
  assert.equal(canRefreshOf({ refreshBlocked: false, coinCount: 0, refreshCost: 3, freeRefreshCnt: 0 }), true,
    'the hotspot published no reason, so the button is usable');
  // no gate published (dev page / old callers): a free refresh arrives as refreshCost 0
  assert.equal(canRefreshOf({ refreshBlocked: null, coinCount: 0, refreshCost: 0, freeRefreshCnt: 0 }), true);
  assert.equal(canRefreshOf({ refreshBlocked: null, coinCount: 0, refreshCost: 3, freeRefreshCnt: 1 }), true,
    'the dev mock keeps its free-refresh display (paid price + freeRefreshes)');
  assert.equal(canRefreshOf({ refreshBlocked: null, coinCount: 2, refreshCost: 3, freeRefreshCnt: 0 }), false);
  assert.equal(canRefreshOf({ refreshBlocked: null, coinCount: 0, refreshCost: 3, freeRefreshCnt: 0, isSpecialRecruit: true }), false,
    'a special recruit alone no longer makes the refresh free');
  assert.equal(canRefreshOf(null), false);
});

test('the ctrl view data carries the caller\'s refresh block from the model', () => {
  assert.equal(new CtrlViewData({ refreshBlocked: true }).refreshBlocked, true);
  assert.equal(new CtrlViewData({}).refreshBlocked, null);
  const blocked = shopModelFromPrivate({ funds: 0, shop: { level: 1, slots: [] } }, { controls: { refresh: '资金不足' } });
  assert.equal(blocked.refreshBlocked, true, 'the caller\'s reason blocks the painted button');
  const open = shopModelFromPrivate({ funds: 9, shop: { level: 1, slots: [] } }, { controls: { refresh: null } });
  assert.equal(open.refreshBlocked, false);
  assert.equal(shopModelFromPrivate({ funds: 9, shop: { level: 1, slots: [] } }).refreshBlocked, null, 'no gate published');
  // wiring: host passes view.controls, mainView hands refreshBlocked to the ctrl, ctrl paints from canRefreshOf
  assert.match(HOST_SOURCE, /controls: nextView\.controls \|\| null/);
  const main = readFileSync(new URL('../../public/js/ui/shop/mainView.js', import.meta.url), 'utf8');
  assert.match(main, /refreshBlocked: model\.refreshBlocked/);
  assert.match(main, /function ctrlKey\(model\) \{/);
  assert.match(main, /model\.refreshBlocked \? 1 : 0/);
  assert.match(main, /model\.freezeBlocked \? 1 : 0/);
  assert.match(main, /model\.reward \|\| null/);
  assert.match(main, /this\.scene\.ctrl\.Render\(this\._BuildCtrlViewData\(model\)\)/,
    'a gate-only change repaints the ctrl');
  const ctrl = readFileSync(new URL('../../public/js/ui/shop/ctrl.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ctrl, /isSpecialRecruit \|\| data\.freeRefreshCnt/);
  assert.match(ctrl, /const canRefresh = canRefreshOf\(data\);/);
  assert.match(ctrl, /this\.enableToggle\.set_selected\(canRefresh, true\)/, 'the toggle is re-applied, not skipped as unchanged');
});

// ---- the middle deploy level shrinks the canvas shop exactly like the DOM bar ------------------------------

test('the canvas shop takes the #692 70% deploy-partial scale the DOM bar takes', () => {
  const bar = readFileSync(new URL('../../public/css/screens/game-shop.css', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../../public/css/screens/game-shop-canvas.css', import.meta.url), 'utf8');
  assert.match(bar, /\.gm\.is-deploy-partial \.shopbar \{ transform: scale\(\.7\); animation: none; \}/,
    'the DOM bar rule the canvas must match');
  assert.match(canvas, /\.gm\.is-deploy-partial \.gm__hud > \.shop-webgl\.shop-webgl--game \{\s*transform: scale\(\.7\);\s*animation: none;\s*\}/,
    'the canvas root scales the same way (canvas, hotspots and overlays move together)');
});
