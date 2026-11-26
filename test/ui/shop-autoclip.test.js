// test/ui/shop-autoclip.test.js — the panel's auto-clips (uGUI AnimationWrapper autoClip): which script clips
// scene.js registers per node, which node owns each clip's curves, and when a hidden state stops the sampling.
// All of it is renderer behaviour; the clips come from the extracted panel document, never from the server.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ShopScene } from '../../public/js/ui/shop/scene.js';

test('a Spine clip on an autoClip node is not treated as a node loop', () => {
  // loop_spine_deco addresses bones (`img.r` on path `2`), so no panel node samples it: registering it would
  // leave the shop painting every frame with nothing moving.
  const spineClip = { len: 6, curves: [['2', 'img.r', [[1, 1]]], ['1', 'img.a', [[0.5, 1]]]] };
  const deco = { path: 'panel_shop_main/fold_mask_spine/root_deco', name: 'root_deco', autoClip: 'loop_spine_deco' };
  const spine = { path: 'panel_shop_main/fold_mask_spine', name: 'fold_mask_spine', children: [deco] };
  const scene = Object.assign(Object.create(ShopScene.prototype), {
    panelDoc: { clips: { loop_spine_deco: spineClip } },
    panel: { path: 'panel_shop_main', name: 'panel_shop_main', children: [spine] },
    autoClips: new Map(),
    autoClipParent: new Map(),
    autoClipClock: 0,
    autoClipLast: null,
  });
  scene.collectAutoClips();
  assert.equal(scene.autoClips.size, 0, 'a bone clip is skipped');
  assert.equal(scene.autoClipAnimating(), false);
});

test('the refresh button auto-clip samples against group_normal and only while root_special is shown', () => {
  const clip = {
    len: 5,
    curves: [['root_special/icon', 'rot', [[0, [0, 0, 0, 1]], [1, [0, 0, 0.7, 1]]]]],
  };
  const btnPath = 'panel_shop_main/state_unfold/panel_ctrl_btn/btn_refresh';
  const icon = { path: `${btnPath}/group_normal/root_special/icon`, name: 'icon' };
  const rootSpecial = { path: `${btnPath}/group_normal/root_special`, name: 'root_special', children: [icon] };
  const groupNormal = {
    path: `${btnPath}/group_normal`, name: 'group_normal', autoClip: 'loop_btn_refresh_sweep_closure', children: [rootSpecial],
  };
  const btnRefresh = { path: btnPath, name: 'btn_refresh', children: [groupNormal] };
  const ctrlBtn = { path: 'panel_shop_main/state_unfold/panel_ctrl_btn', name: 'panel_ctrl_btn', children: [btnRefresh] };
  const stateUnfold = { path: 'panel_shop_main/state_unfold', name: 'state_unfold', children: [ctrlBtn] };
  const scene = Object.assign(Object.create(ShopScene.prototype), {
    panelDoc: { clips: { loop_btn_refresh_sweep_closure: clip } },
    panel: { path: 'panel_shop_main', name: 'panel_shop_main', children: [stateUnfold] },
    autoClips: new Map(),
    autoClipParent: new Map(),
    autoClipClock: 0,
    autoClipLast: null,
  });
  scene.collectAutoClips();
  const entry = scene.autoClips.get(groupNormal.path);
  assert.ok(entry, 'the node with autoClip is registered');
  assert.equal(entry.basePath, groupNormal.path, 'the clip curves are relative to group_normal, which owns root_special');
  assert.deepEqual(entry.targets, [icon], 'the sampled nodes are the clip targets');

  rootSpecial.active = false;
  assert.equal(scene.autoClipAnimating(), false, 'a hidden special state paints nothing');
  assert.deepEqual(scene.sampleAutoClips(), [], 'and samples no frame');

  rootSpecial.active = true;
  assert.equal(scene.autoClipAnimating(), true, 'a shown special state keeps painting');
  // Sample a wrapped phase: the clock is 5.5 s while the clip is 5 s long, from the origin set above.
  entry.live = true;
  entry.start = 0;
  scene.autoClipClock = 5.5;
  scene.autoClipLast = null;
  const [frame] = scene.sampleAutoClips();
  assert.equal(frame.clipName, 'loop_btn_refresh_sweep_closure');
  assert.equal(frame.basePath, groupNormal.path);
  assert.equal(frame.t, 0.5, 'the phase wraps at the clip length (5 s)');
});

test('a hidden special state parks the clip, and showing it again restarts at t=0', () => {
  const clip = { len: 5, curves: [['root_special/icon', 'rot', [[0, [0, 0, 0, 1]]]]] };
  const icon = { path: 'p/root_special/icon', name: 'icon', active: true };
  const entry = { clip, clipName: 'loop_x', basePath: 'p', targets: [icon], live: true, start: 0 };
  const scene = Object.assign(Object.create(ShopScene.prototype), {
    panelDoc: { clips: {} },
    panel: { path: 'p', name: 'p', children: [icon] },
    autoClips: new Map([['p', entry]]),
    autoClipParent: new Map([[icon, null]]),
    autoClipClock: 5.5,
    autoClipLast: null,
  });
  const [frame] = scene.sampleAutoClips();
  assert.equal(frame.t, 0.5, '5.5 s from a 0 origin on a 5 s clip');
  icon.active = false;
  assert.deepEqual(scene.sampleAutoClips(), [], 'a hidden state samples no frame');
  assert.equal(entry.live, false, 'and the clip is marked stopped');
  icon.active = true;
  const [restarted] = scene.sampleAutoClips();
  assert.ok(restarted.t < 0.05, `a state shown again restarts the clip at 0 (got ${restarted.t})`);
});
