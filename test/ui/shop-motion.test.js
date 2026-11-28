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
import { bindThemeCharacterMount, dispatchThemeCharacterVoice } from '../../public/js/ui/themeCharacter.js';

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

// A pixi-spine stand-in: setAnimation / addAnimation record the calls the voice binding makes.
function voiceActor(names = ['Idle', 'Default', 'Happy']) {
  const calls = [];
  const tracks = [];
  return {
    calls,
    tracks,
    spineData: { animations: names.map((name) => ({ name })) },
    state: {
      setAnimation(track, name, loop) {
        const entry = {
          track, name, loop, listener: null,
          complete() { this.listener?.complete?.(); },
        };
        tracks.push(entry);
        calls.push({ op: 'set', track, name, loop });
        return entry;
      },
      addAnimation(track, name, loop, delay) {
        calls.push({ op: 'add', track, name, loop, delay });
        return null;
      },
    },
  };
}

const VOICE_CHARACTER = {
  spine: { skel: 'char.skel', atlas: 'char.atlas', textures: ['char.png'] },
  anims: { idle: 'Idle', voice: { cn_001: 'Happy', cn_missing: 'Nope' } },
};

function voiceView(extra = {}) {
  const view = new ShopSpineView({
    scene: { canvas: null }, host: {}, character: VOICE_CHARACTER, ...extra,
  });
  const actor = voiceActor();
  view.actor = actor;
  return { view, actor };
}

test('the canvas character plays the latest voice clip once, then idle, and a disposed view does not unbind a newer one', () => {
  const views = [];
  try {
    const older = voiceView();
    const newer = voiceView();
    views.push(older.view, newer.view);

    assert.equal(dispatchThemeCharacterVoice('CN_001'), true);
    assert.deepEqual(older.actor.calls, [], 'the earlier mount does not answer');
    assert.deepEqual(newer.actor.calls, [
      { op: 'set', track: 0, name: 'Happy', loop: false },
      { op: 'add', track: 0, name: 'Idle', loop: true, delay: 0 },
    ], 'the clip plays once and queues the idle loop');

    newer.actor.calls.length = 0;
    newer.actor.tracks[0].complete();
    assert.deepEqual(newer.actor.calls, [
      { op: 'set', track: 0, name: 'Idle', loop: true },
    ], 'the clip finishing returns to the idle loop');

    const parked = newer.actor.tracks[0];
    newer.view.pause(true);
    newer.actor.calls.length = 0;
    assert.equal(dispatchThemeCharacterVoice('CN_001'), true);
    parked.complete();
    assert.deepEqual(newer.actor.calls, [], 'a parked spine (pauseSpine / still) does not restart');

    newer.view.pause(false);
    older.view.destroy();
    newer.actor.calls.length = 0;
    assert.equal(dispatchThemeCharacterVoice('CN_001'), true);
    assert.equal(newer.actor.calls.length, 2, 'disposing the older mount leaves the latest one answering');
    assert.deepEqual(older.actor.calls, []);

    newer.view.destroy();
    assert.equal(dispatchThemeCharacterVoice('CN_001'), false, 'the latest mount unbinds itself');
    assert.equal(older.actor.calls.length, 0, 'the older mount does not resume');
  } finally {
    for (const view of views) view.destroy();
  }
});

test('a null stem returns to idle, an unmapped stem changes nothing, and a paused view ignores both', () => {
  const { view, actor } = voiceView();
  try {
    view.pause(true);
    assert.equal(dispatchThemeCharacterVoice(null), true);
    assert.equal(dispatchThemeCharacterVoice('no-such-stem'), true);
    assert.deepEqual(actor.calls, [], 'still mode ignores idle and unmapped stems alike');

    view.pause(false);
    assert.equal(dispatchThemeCharacterVoice(null), true);
    assert.deepEqual(actor.calls, [{ op: 'set', track: 0, name: 'Idle', loop: true }]);

    actor.calls.length = 0;
    assert.equal(dispatchThemeCharacterVoice('no-such-stem'), true);
    assert.equal(dispatchThemeCharacterVoice('cn_missing'), true);
    assert.deepEqual(actor.calls, [], 'a stem with no clip, or a clip the skeleton lacks, leaves the pose');
  } finally {
    view.destroy();
  }
});

test('a funds-card mount that binds later keeps the voice, and disposing the canvas does not take it', () => {
  const { view, actor } = voiceView();
  const heard = [];
  let funds = null;
  try {
    funds = bindThemeCharacterMount((stem) => { heard.push(stem); });
    assert.equal(dispatchThemeCharacterVoice('CN_001'), true);
    assert.deepEqual(actor.calls, [], 'the canvas lost the binding to the later funds card');
    assert.deepEqual(heard, ['CN_001']);

    view.destroy();
    assert.equal(dispatchThemeCharacterVoice('CN_002'), true);
    assert.deepEqual(heard, ['CN_001', 'CN_002'], 'disposing the older canvas does not unbind the funds card');
    assert.equal(funds.release(), true);
    assert.equal(dispatchThemeCharacterVoice('CN_003'), false);
  } finally {
    view.destroy();
    if (funds) funds.release();
  }
});

test('spine mode off does not take the voice binding', () => {
  const heard = [];
  const funds = bindThemeCharacterMount((stem) => { heard.push(stem); });
  const off = new ShopSpineView({
    scene: { canvas: null }, host: {}, character: VOICE_CHARACTER, mode: 'off',
  });
  try {
    assert.equal(off.voiceBinding, null);
    assert.equal(dispatchThemeCharacterVoice('CN_001'), true);
    assert.deepEqual(heard, ['CN_001']);
    off.destroy();
    assert.equal(dispatchThemeCharacterVoice('CN_001'), true);
    assert.deepEqual(heard, ['CN_001', 'CN_001'], 'destroying an off view leaves the current mount bound');
  } finally {
    off.destroy();
    funds.release();
  }
});
