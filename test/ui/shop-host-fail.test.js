// test/ui/shop-host-fail.test.js — the host's failure/回退 contract and the pure seams behind it:
//  - createShopHost rejects when the canvas has no WebGL2 (never mounts a dead shop); the caller owns the
//    single fallback (ShopCanvas.failHost), so the host itself calls no onFail there.
//  - preloadShopRuntime drops a failed cache entry, so the next call retries instead of replaying the rejection.
//  - cardAriaLabel / cardBlocked / cardMarkSwitches: the card hotspot's accessible name and the 卡面标记
//    settings → filter mapping (the DOM overlay itself is host.syncCardMarks, tested through cardMarkElements in
//    shop-marks.test.js).
//
// No browser: a minimal document is installed for the mount case only, and the canvas answers a 2D context
// (the text measure) but no webgl2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cardAriaLabel, cardBlocked, createShopHost, orderCardHotspots, preloadShopRuntime } from '../../public/js/ui/shop/host.js';
import { cardMarkSwitches } from '../../public/js/ui/shop/ShopCanvas.js';
import { filterCardMarks } from '../../public/js/ui/shop/marks.js';
import { t, setLang, setMessages } from '../../shared/i18n.js';
import { stubFetch } from '../helpers/fetchStub.js';

/** One DOM node: the host only needs append/remove/listeners/style/classList on these. */
function fakeElement(tag) {
  const listeners = new Map();
  const el = {
    tagName: String(tag).toUpperCase(), className: '', hidden: false, textContent: '', title: '',
    dataset: {}, children: [], parentNode: null, width: 1600, height: 372,
    clientWidth: 1600, clientHeight: 372,
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, contains() { return false; } },
    append(...nodes) { for (const node of nodes) { node.parentNode = el; el.children.push(node); } },
    appendChild(node) { el.append(node); return node; },
    remove() {
      if (!el.parentNode) return;
      const at = el.parentNode.children.indexOf(el);
      if (at >= 0) el.parentNode.children.splice(at, 1);
      el.parentNode = null;
    },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    querySelector() { return null; },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: 1600, height: 372 }; },
    focus() {}, click() {},
    getContext(type) {
      if (type === '2d') {
        return { font: '', measureText: () => ({ width: 10, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) };
      }
      return null; // no WebGL2
    },
    _listeners: listeners,
  };
  return el;
}

/** Install the minimal browser globals a host mount touches; returns the restore. */
function installFakeDom() {
  const real = {
    document: globalThis.document,
    window: globalThis.window,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    devicePixelRatio: globalThis.devicePixelRatio,
  };
  globalThis.window = globalThis;
  globalThis.document = {
    hidden: false,
    fonts: { load: async () => [] },
    createElement: (tag) => fakeElement(tag),
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    head: fakeElement('head'), documentElement: fakeElement('html'),
  };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.devicePixelRatio = 1;
  return () => { Object.assign(globalThis, real); };
}

const runtime = () => ({
  docs: {
    themeId: 'ac_s_closur',
    group: 'themes/ac_s_closur',
    shop: {
      prefabs: {
        panel_shop_main: { root: { name: 'root', path: 'panel_shop_main', children: [] } },
        autochess_main_money_item: { root: { name: 'root', path: 'autochess_main_money_item', children: [] } },
      },
      materials: {}, textures: {},
    },
    card: { root: { name: 'root', path: 'autochess_shop_card_item', children: [] }, materials: {}, sub: {} },
    prefabs: { prefabs: {}, textures: {} },
    pack: null,
    url: () => null,
  },
  pack: null,
  character: null,
  fonts: null,
  faceList: null,
});

test('createShopHost rejects without WebGL2 instead of mounting a dead shop', async () => {
  const restore = installFakeDom();
  try {
    const container = fakeElement('div');
    let failed = 0;
    await assert.rejects(
      createShopHost({
        container,
        priv: { funds: 9, shop: { level: 1, slots: [] } },
        view: { state: 'unfold' },
        options: { runtime: runtime(), still: true },
        callbacks: { onFail: () => { failed += 1; } },
      }),
      /WebGL2 is not available/,
      'the renderer error reaches the caller',
    );
    assert.equal(failed, 0, 'the host rejects; the caller (ShopCanvas.failHost) owns the one fallback report');
  } finally {
    restore();
  }
});

test('preloadShopRuntime retries after a failed load instead of replaying the rejection', async (t) => {
  const bodies = {
    'prefabs.json': { spPrefabs: 1, prefabs: {}, textures: {} },
    'card.json': { root: { name: 'root', children: [] }, materials: {}, sub: {} },
    'shop.json': { prefabs: {}, materials: {}, textures: {} },
  };
  const stub = stubFetch((url) => bodies[String(url).split('/').pop()] ?? null);
  t.after(() => stub.restore());
  // 1. no group: the doc load fails; the entry must not stay cached.
  await assert.rejects(
    preloadShopRuntime({ themeId: 'ac_s_closur', groups: {}, fonts: false }),
    /has no shop documents/,
  );
  // 2. the same theme id with the documents now served: a fresh load, not the cached rejected promise.
  const groups = {
    'themes/ac_s_closur': {
      'prefabs.json': { path: '/assets/local/themes/ac_s_closur/prefabs.json' },
      'card.json': { path: '/assets/local/themes/ac_s_closur/card.json' },
      'shop.json': { path: '/assets/local/themes/ac_s_closur/shop.json' },
    },
  };
  const ready = await preloadShopRuntime({ themeId: 'ac_s_closur', groups, fonts: false });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.docs.group, 'themes/ac_s_closur');
  // and a ready entry is reused (no second doc fetch).
  const reused = await preloadShopRuntime({ themeId: 'ac_s_closur', groups, fonts: false });
  assert.equal(reused, ready, 'the ready entry is cached per theme id');
});

test('cardBlocked: empty, disabled, locked and unaffordable cards are unbuyable', () => {
  assert.equal(cardBlocked(null, {}), true);
  assert.equal(cardBlocked({ isEmpty: true }, {}), true);
  assert.equal(cardBlocked({ price: 3 }, { avalid: true, coinCount: 3 }), false);
  assert.equal(cardBlocked({ price: 4 }, { avalid: true, coinCount: 3 }), true);
  assert.equal(cardBlocked({ price: 0 }, { avalid: false, coinCount: 9 }), true, 'a disabled shop');
  assert.equal(cardBlocked({ price: 0 }, { avalid: true, locked: true, coinCount: 9 }), true, 'a locked seat');
  assert.equal(cardBlocked({ price: 2, currCoin: 5 }, { avalid: true, coinCount: 0 }), false, 'the card overrides funds');
  assert.equal(cardBlocked({ price: 6, currCoin: 5 }, { avalid: true, coinCount: 0 }), true);
});

test('cardAriaLabel: the price, every mark aria and the two-tap state', () => {
  const card = { id: 'chess_char_6_01_a', name: '蕾缪安', price: 3, armed: false };
  const price = t('{name}，价格 {price}', { name: '蕾缪安', price: 3 });
  assert.equal(cardAriaLabel(card, { coinCount: 10 }), price, 'no marks: name and price');
  assert.equal(cardAriaLabel({ isEmpty: true }, { coinCount: 10 }), t('空栏位'));
  const marks = {
    standIn: { aria: 'A' }, diy: { aria: 'B' }, pips: { aria: 'C' }, skill: { aria: 'D' }, merge: { aria: 'E' },
  };
  assert.equal(cardAriaLabel(card, { coinCount: 10 }, marks), `${price}，A，B，C，D，E`, 'the model order');
  assert.equal(cardAriaLabel({ ...card, armed: true }, { coinCount: 10 }), `${price}${t('，再次点击确认')}`);
  assert.equal(cardAriaLabel({ ...card, armed: true }, { coinCount: 1 }), `${price}${t('，无法购买')}`,
    'the armed state names the block instead of asking for a confirm');

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const en = JSON.parse(readFileSync(path.join(root, 'public/i18n/en.json'), 'utf8'));
  setMessages('en', en);
  setLang('en');
  try {
    const cardEn = { id: 'x', name: 'Bubble', price: 0, armed: false };
    const label = t('{name}，价格 {price}', { name: 'Bubble', price: 0 });
    const joined = cardAriaLabel(cardEn, { coinCount: 10 }, { skill: { aria: 'Skill: S' } });
    assert.equal(en['，'], ', ');
    assert.equal(joined, `${label}${en['，']}Skill: S`);
    assert.equal(joined.includes('，'), false, 'the mark join is not a full-width comma');
    const armed = cardAriaLabel({ ...cardEn, armed: true }, { coinCount: 10 }, { skill: { aria: 'Skill: S' } });
    assert.equal(armed, `${joined}${t('，再次点击确认')}`);
    assert.equal(armed.includes('，'), false);
  } finally {
    setLang('zh');
  }
});

test('orderCardHotspots keeps display order when a slot is recreated', () => {
  const parent = { children: [] };
  let moves = 0;
  const make = (index) => {
    const el = {
      index,
      parentNode: parent,
      get nextElementSibling() {
        const at = parent.children.indexOf(el);
        return at >= 0 ? parent.children[at + 1] || null : null;
      },
      after(node) {
        moves += 1;
        const from = parent.children.indexOf(node);
        if (from >= 0) parent.children.splice(from, 1);
        const at = parent.children.indexOf(el);
        parent.children.splice(at + 1, 0, node);
        node.parentNode = parent;
      },
    };
    return el;
  };
  const ctrl = make('ctrl');
  const card1 = make(1);
  const card2 = make(2);
  const card0 = make(0);
  parent.children.push(ctrl, card1, card2, card0);
  const cardEls = new Map([[1, card1], [2, card2], [0, card0]]);
  orderCardHotspots(cardEls);
  assert.deepEqual(parent.children.map((el) => el.index), ['ctrl', 0, 1, 2]);
  assert.equal(parent.children[1], card0, 'slot 0 is the same node, not a new one');
  assert.equal(parent.children[2], card1);
  assert.equal(parent.children[3], card2);
  const moved = moves;
  orderCardHotspots(cardEls);
  assert.equal(moves, moved, 'an already-ordered row is left alone');
  assert.equal(cardEls.get(0), card0);
});

test('the 卡面标记 settings map to the filter switches and drop the matching marks', () => {
  assert.deepEqual(cardMarkSwitches({ shopMarkSkill: false, shopMarkStandIn: true, shopMarkProgress: false }),
    { skill: false, standIn: true, progress: false });
  assert.deepEqual(cardMarkSwitches({}), { skill: undefined, standIn: undefined, progress: undefined });
  assert.deepEqual(cardMarkSwitches(null), { skill: undefined, standIn: undefined, progress: undefined });
  const marks = { skill: { aria: 's' }, standIn: { aria: 't' }, diy: null, pips: { aria: 'p' }, merge: null };
  const noSkill = filterCardMarks(marks, cardMarkSwitches({ shopMarkSkill: false }));
  assert.equal(noSkill.skill, null);
  assert.ok(noSkill.standIn && noSkill.pips);
  const allOff = filterCardMarks(marks, cardMarkSwitches({ shopMarkSkill: false, shopMarkStandIn: false, shopMarkProgress: false }));
  assert.equal(allOff, null, 'nothing left to draw');
});
