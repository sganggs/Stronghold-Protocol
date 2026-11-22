// test/ui/shop-motion.test.js — the WebGL shop's still mode (设置 → 主题动画 off or prefers-reduced-motion).
//
// Covered behavior: 主题动画 off / reduced motion resolves to `still`; the host mount key changes when `still`
// changes (so the mount effect re-runs and createShopHost picks the option up again); the host passes `still`
// through to the scene options; a still mount parks the themed spine (and a spine-less fake host is harmless);
// a still scene reports no card FX; and the host's ambient repaint follows the same loops. The full Preact
// mount effect and a real WebGL/PIXI host are not exercised here (the SP_E2E suite owns those).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  shopStill,
  shopMountKey,
  pauseSpine,
} from '../../public/js/ui/shop/ShopCanvas.js';
import { ShopSpineView } from '../../public/js/ui/shop/spineView.js';
import { ShopScene } from '../../public/js/ui/shop/scene.js';
import { ambientPaintNeeded, shopSceneOptions } from '../../public/js/ui/shop/host.js';

test('shopStill: 主题动画 off OR reducedMotion(); a missing setting keeps today\'s motion', () => {
  assert.equal(shopStill({ themeMotion: false }), true);
  assert.equal(shopStill({ themeMotion: false }, false), true);
  assert.equal(shopStill({ themeMotion: false }, true), true);
  assert.equal(shopStill({ themeMotion: true }), false);
  assert.equal(shopStill({ themeMotion: true }, false), false);
  assert.equal(shopStill({ themeMotion: true }, true), true, 'the OS preference also stills it');
  assert.equal(shopStill(null), false);
  assert.equal(shopStill(undefined, true), true);
  assert.equal(shopStill({}), false, 'a missing themeMotion is the default (motion on)');
});

test('the host mount key is still-aware, so a still toggle re-runs the mount effect', () => {
  // game.js uses the one-argument (language) form as the component's key; shop-i18n.test.js pins the helper.
  assert.equal(shopMountKey('zh'), 'zh');
  assert.equal(shopMountKey('zh', false), 'zh');
  assert.equal(shopMountKey('en'), 'en');
  // The host effect uses the two-argument form: a motion → still switch must produce a new key.
  assert.notEqual(shopMountKey('zh', true), shopMountKey('zh', false));
  assert.notEqual(shopMountKey('en', true), shopMountKey('en', false));
  assert.notEqual(shopMountKey('zh', true), shopMountKey('en', true), 'a language change still re-mounts too');
  assert.equal(shopMountKey('zh', true), shopMountKey('zh', true), 'the same still state is the same key');
});

test('the host passes still (and the pinned times) through to the scene options', () => {
  const still = shopSceneOptions({ still: true });
  assert.equal(still.still, true, 'the host → ShopScene still pass-through');
  assert.equal(shopSceneOptions({ still: false }).still, false);
  assert.equal(shopSceneOptions({}).still, undefined, 'a host without the option does not invent one');
  const pinned = shopSceneOptions({ still: true, cardTime: 0, particleTime: 1.5, arrowAt: 2, cardParticles: false });
  assert.equal(pinned.cardTime, 0);
  assert.equal(pinned.particleTime, 1.5);
  assert.equal(pinned.arrowAt, 2);
  assert.equal(pinned.cardParticles, false);
});

test('pauseSpine parks a still spine, leaves motion alone, and tolerates a host without one', () => {
  const calls = [];
  const host = { spine: { pause: (value) => calls.push(value) } };
  assert.equal(pauseSpine(host, true), true);
  assert.deepEqual(calls, [true], 'a still mount pauses the themed spine');
  assert.equal(pauseSpine(host, false), false);
  assert.deepEqual(calls, [true], 'motion on never calls pause');
  assert.equal(pauseSpine({}, true), false, 'a host without a spine is harmless');
  assert.equal(pauseSpine(null, true), false);
  assert.doesNotThrow(() => pauseSpine({ spine: { pause() { throw new Error('no pixi'); } } }, true),
    'a spine that throws on pause must not break the mount');
});

test('a still scene pins card FX; a pinned card time also stops them', () => {
  const scene = Object.create(ShopScene.prototype);
  scene.stillCards = true;
  scene.cardTime = null;
  assert.equal(scene.cardFxAnimating(), false, 'still cards do not animate');
  scene.stillCards = false;
  scene.cardTime = 0;
  assert.equal(scene.cardFxAnimating(), false, 'a pinned card time is still');
  scene.cardTime = null;
  assert.equal(scene.cardFxAnimating(), true, 'motion on with no pinned time animates');
});

test('the host ambient repaint follows any ambient loop', () => {
  assert.equal(ambientPaintNeeded({}), false);
  assert.equal(ambientPaintNeeded({ particleAnim: true }), true);
  assert.equal(ambientPaintNeeded({ cardFxAnim: true }), true);
  assert.equal(ambientPaintNeeded({ spineAnim: true }), true);
  assert.equal(ambientPaintNeeded({ spinePaint: true }), true);
});

test('a paused spine reports no animation, which empties the host ambient repaint', () => {
  const view = new ShopSpineView({ scene: { canvas: null }, host: {}, mode: 'compose' });
  view.app = {};                       // a mounted PIXI app
  view.mode = 'compose';
  view.hidden = false;
  assert.equal(view.animating(), true);
  view.pause(true);
  assert.equal(view.animating(), false, 'still: the idle tick must not keep the ambient loop alive');
  view.pause(false);
  assert.equal(view.animating(), true, 'motion on: the idle tick resumes');
});
