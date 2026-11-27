// test/ui/shop-followups.test.js — the canvas-shop follow-ups from the maintainer's review:
//  1  the funds-short level-up face: the 升级 hotspot also covers group_disable, so the refusal is reachable,
//     announced (aria-disabled + title) and still refuses through onRefuse;
//  2  every card's first click reads 确认购买, a free reward pick included (the official client's strip); there is
//     no reward/price branch on either card render path;
//  3  card hotspots are created at their display index, so Tab walks 0,1,2 — not 1,2,0.
// Every rect and badge here is synthetic: no official theme file is read and nothing is committed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AutoChessBattleShopCardView } from '../../public/js/ui/shop/cardView.js';

import {
  applyControlState, CONTROL_HOTSPOTS, controlGuardFor, controlHotspotVisible, cardHotspotInsertBefore,
  runControlClick,
} from '../../public/js/ui/shop/host.js';
import { shopRewardRow } from '../../public/js/ui/shop/ShopCanvas.js';
import { shopBlockReason } from '../../public/js/ui/gameLogic.js';
import { PHASE } from '../../shared/constants.js';
import { t } from '../../shared/i18n.js';

// ---- 1. the funds-short level-up hotspot --------------------------------------------------------------

const levelUpSpec = () => CONTROL_HOTSPOTS.find((spec) => spec.key === 'levelUp');

/** The DOM shape applyControlState touches (no browser in this suite). */
function fakeControlEl() {
  const attrs = new Map();
  return {
    disabled: true,
    hidden: false,
    title: '',
    setAttribute(name, value) {
      attrs.set(name, String(value));
      if (name === 'title') this.title = String(value);
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    removeAttribute(name) {
      attrs.delete(name);
      if (name === 'title') this.title = '';
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
  };
}

test('the levelUp hotspot falls back to the disabled upgrade face', () => {
  const spec = levelUpSpec();
  assert.equal(spec.event, 'levelUp');
  // panel: true keeps the click running so ShopCanvas.tapLevel can refuse it with the old bar's wording.
  assert.equal(spec.panel, true);
  // The local prefab's short-funds face: group_disable carries its own 112×176 hotspot, painted only while the
  // three-state toggle is UNSELECT (upgrade.js), so it belongs after the two able-state paths.
  assert.deepEqual(spec.paths, [
    'hotspot_normal',
    'upgrade',
    'panel_unfold/root_layout/group_upgrade/group_disable/hotspot',
  ]);
  assert.ok(Object.isFrozen(spec.paths), 'the host hotspots stay unwireable at runtime');
});

test('a funds-short upgrade hotspot is placed, announced and refuses through onRefuse', () => {
  const spec = levelUpSpec();
  const disabledPath = 'panel_shop_main/state_unfold/panel_unfold/root_layout/group_upgrade/group_disable/hotspot';
  const guard = { cooldown: 1, seconds: 0.3 };
  const panel = {
    name: 'panel_shop_main',
    path: 'panel_shop_main',
    children: [{ path: disabledPath, components: [{ class: 'UIButton', fields: { _clickGuard: guard } }] }],
  };
  // controlGuardFor matches by the same path suffix rule the host's boxFor() uses for the painted box: the third
  // fallback is what resolves the disabled face, and its prefab UIButton guard is picked up with it.
  assert.equal(controlGuardFor(panel, spec.paths), guard);
  assert.equal(controlGuardFor({ ...panel, children: [] }, spec.paths), null, 'no painted box, no guard');

  // Only the reward pills are view-gated; the upgrade hotspot is placed by the frame's box (112×176 locally).
  assert.equal(controlHotspotVisible(spec, { controls: { levelUp: t('资金不足') } }, true), true);

  const el = fakeControlEl();
  const button = { interactable: true };
  applyControlState(el, button, t('资金不足'));
  assert.equal(el.hidden, false);
  assert.equal(el.disabled, false, 'not natively disabled: that would swallow the title and the click');
  assert.equal(el.getAttribute('aria-disabled'), 'true', 'Tab reaches it and the reader announces it');
  assert.equal(el.title, t('资金不足'), 'the hotspot explains the refusal');
  assert.equal(button.interactable, false, 'the scene button must not press its tint while blocked');

  // The click chain: runControlClick hands a panel control to onLevelUp, and ShopCanvas.tapLevel re-runs
  // shopBlockReason('levelUp') and reports it through onRefuse.
  const priv = { funds: 0, shop: { level: 2, maxLevel: 6, upgradePrice: 4, slots: [] } };
  const reason = shopBlockReason('levelUp', { config: null, priv, editable: true });
  assert.equal(reason, t('资金不足'), 'the actual gate for 0 funds against a 4-fund upgrade');
  const calls = [];
  let refused = null;
  assert.equal(runControlClick({
    reason,
    panel: spec.panel,
    press: () => { calls.push('press'); return true; },
    onRefuse: (value) => { refused = value; },
    run: () => {
      calls.push('run');
      refused = shopBlockReason('levelUp', { config: null, priv, editable: true });
    },
  }), 'run');
  assert.deepEqual(calls, ['run'], 'a blocked panel control is not pressed; its handler owns the refusal');
  assert.equal(refused, t('资金不足'));
});

// ---- 2. every card's first click reads 确认购买 (official), reward picks included ------------------------

const paidPriv = () => ({
  funds: 10,
  shop: {
    level: 2,
    maxLevel: 6,
    upgradePrice: 4,
    slots: [
      { kind: 'chess', id: 'chess_char_1_01_a', price: 2, basePrice: 2, sold: false },
      { kind: 'chess', id: 'chess_char_1_02_a', price: 2, basePrice: 2, sold: false },
    ],
    layout: { chess: 2, item: 0 },
    rewardOffer: { source: 'merge', slots: [{ kind: 'chess', id: 'offer_reward_a', price: 0, sold: false }] },
  },
});

const stripTree = () => ({
  name: 'root',
  path: 'root',
  children: [
    { name: 'group_able', path: 'root/group_able', children: [{ name: 'text', path: 'root/group_able/text', text: {} }] },
    { name: 'group_disable', path: 'root/group_disable', children: [{ name: 'text', path: 'root/group_disable/text', text: {} }] },
  ],
});

function stripTextOf(tree, group) {
  return tree.children.find((child) => child.name === group).children[0].text.text;
}

test('the strip says 确认购买 for every card; only the blocked face says 无法购买', () => {
  const view = Object.create(AutoChessBattleShopCardView.prototype);
  const tree = stripTree();
  view.applyStripText(tree);
  assert.equal(stripTextOf(tree, 'group_able'), t('确认购买'),
    'a free reward pick is still a purchase: the official strip says so for any shop card');
  assert.equal(stripTextOf(tree, 'group_disable'), t('无法购买'), 'the refusal face is unchanged');
});

test('the card render applies the strip (the wiring from applyState)', () => {
  // applyStripText is the leaf; this pins that applyState reaches it, so removing the call cannot survive.
  const renderTree = () => stripTree();
  const view = Object.create(AutoChessBattleShopCardView.prototype);
  view.model = { isChar: true, tier: 1, bonds: false, name: 'x' };
  view.state = { tier: 1, frozen: false, repeated: false, bonds: false, armed: false, operator: 'x' };
  view.doc = { sub: {} };
  view.applyShopState = () => {};
  view.applyChessLevelStyle = () => {};
  view.applyCost = () => {};
  view.applyBonds = () => {};
  const tree = renderTree();
  view.applyState(tree);
  assert.equal(stripTextOf(tree, 'group_able'), t('确认购买'));
});

test('a reward pick is displayed at price 0 whatever the offer sends', () => {
  const priv = paidPriv();
  priv.shop.rewardOffer.slots[0].price = 3;
  const row = shopRewardRow(priv, false, PHASE.PREP);
  assert.equal(row.slots[1].price, 0, 'the pick is drawn free');
  assert.equal(row.slots[0], null, 'the empty front slot stays empty');
});

// ---- 3. the card hotspots' Tab order --------------------------------------------------------------------

test('cardHotspotInsertBefore keeps the display order for 0, a middle slot, the last and a shuffled map', () => {
  const el = (index) => ({ index });
  const e0 = el(0);
  const e1 = el(1);
  const e2 = el(2);
  const e3 = el(3);
  assert.equal(cardHotspotInsertBefore(new Map(), 0), null, 'the first card appends');
  assert.equal(cardHotspotInsertBefore(new Map([[1, e1], [2, e2]]), 0), e1, 'index 0 goes before 1');
  assert.equal(cardHotspotInsertBefore(new Map([[1, e1], [3, e3]]), 1), e3, 'a middle slot precedes the next shown card');
  assert.equal(cardHotspotInsertBefore(new Map([[0, e0], [1, e1]]), 2), null, 'the last card appends');
  // The map's insertion order is not the display order: the smallest index above the new one wins.
  assert.equal(cardHotspotInsertBefore(new Map([[2, e2], [0, e0], [3, e3]]), 1), e2);
  assert.equal(cardHotspotInsertBefore(new Map([[2, e2], [0, e0]]), 0), e2);
});

/** A container with the two DOM calls createCardEl() makes (no DOM in this suite). */
function fakeHotspotContainer() {
  const children = [];
  return {
    children,
    insertBefore(el, before) {
      if (before == null) { children.push(el); return; }
      const at = children.indexOf(before);
      if (at < 0) throw new Error('insertBefore anchor is not attached');
      children.splice(at, 0, el);
    },
  };
}

test('a rebuilt card hotspot is inserted at its display index, not appended', () => {
  const host = fakeHotspotContainer();
  const cardEls = new Map();
  const add = (index) => {
    const el = {
      dataset: { shopSlot: String(index) },
      remove() {
        const at = host.children.indexOf(el);
        if (at >= 0) host.children.splice(at, 1);
      },
    };
    // The createCardEl() line under test: insert by display index instead of append.
    host.insertBefore(el, cardHotspotInsertBefore(cardEls, index));
    cardEls.set(index, el);
    return el;
  };
  // A 3-slot offer on a 5-wide row: display 2,3,4, and the empty fronts 0,1 have no hotspot.
  add(2); add(3); add(4);
  assert.deepEqual(host.children.map((el) => el.dataset.shopSlot), ['2', '3', '4']);
  // 稍后 puts the normal row back: 0 and 1 must land in front of the kept cards (appending would read 2,3,4,0,1).
  add(0); add(1);
  assert.deepEqual(host.children.map((el) => el.dataset.shopSlot), ['0', '1', '2', '3', '4']);
  // The reported case — 0 rebuilt while 1,2 exist — keeps Tab on 0,1,2.
  cardEls.get(0).remove();
  cardEls.delete(0);
  add(0);
  assert.deepEqual(host.children.map((el) => el.dataset.shopSlot), ['0', '1', '2', '3', '4']);

  // There is no DOM here to observe the host itself, so the wiring line is pinned as text.
  const source = readFileSync(new URL('../../public/js/ui/shop/host.js', import.meta.url), 'utf8');
  assert.match(source, /hotspots\.insertBefore\(el, cardHotspotInsertBefore\(cardEls, index\)\)/,
    'createCardEl inserts by display index');
});
