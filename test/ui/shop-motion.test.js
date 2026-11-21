// test/ui/shop-motion.test.js — the WebGL shop's still mode (S4, 设置 → 主题动画 off or prefers-reduced-motion).
// A still shop must not animate on its own: the host gets `still` at construction (pinned card clips), the themed
// spine idle is parked (its compose canvas follows the idle tick, so a paused spine is what empties the host's
// ambient repaint), and a settings change re-mounts the host because createShopHost captures its options then.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shopStill } from '../../public/js/ui/shop/ShopCanvas.js';
import { ShopSpineView } from '../../public/js/ui/shop/spineView.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const GAME_SOURCE = read('public/js/screens/game.js');
const CANVAS_SOURCE = read('public/js/ui/shop/ShopCanvas.js');
const HOST_SOURCE = read('public/js/ui/shop/host.js');
const SCENE_SOURCE = read('public/js/ui/shop/scene.js');

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

test('game.js computes the canvas still from the player setting and the OS preference', () => {
  assert.match(GAME_SOURCE, /still=\$\{shopStill\(playerSettings, reducedMotion\(\)\)\}/);
  assert.match(GAME_SOURCE, /import \{ ShopCanvas, shopMountKey, shopStill, shopHotkeyBuyIndex \} from '\.\.\/ui\/shop\/ShopCanvas\.js';/);
});

test('the canvas passes still as a host option and parks the spine on a still mount', () => {
  assert.match(CANVAS_SOURCE, /options: \{ runtime, still \}/);
  assert.match(CANVAS_SOURCE, /if \(still\) pauseSpine\(created\);/);
  assert.match(CANVAS_SOURCE, /host\.spine\?\.pause\?\.\(true\)/);
});

test('a motion-setting change re-mounts the host (options are captured at construction)', () => {
  assert.match(CANVAS_SOURCE, /\}, \[props\.runtime, failed, props\.lang, props\.still\]\)/,
    'still stays in the mount effect deps');
  assert.match(CANVAS_SOURCE, /captures its renderer options at construction/,
    'the re-mount choice is documented where the effect is');
});

test('the host and scene honour still: pinned card clips, no card FX, ambient repaint from the spine only', () => {
  assert.match(HOST_SOURCE, /still: options\.still/);
  assert.match(SCENE_SOURCE, /this\.stillCards = !!opts\.still/);
  assert.match(SCENE_SOURCE, /if \(this\.stillCards\) return false;/);
  assert.match(HOST_SOURCE, /const ambient = !!\(particleAnim \|\| cardFxAnim \|\| spineAnim \|\| spinePaint\);/);
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
