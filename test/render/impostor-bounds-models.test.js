// test/render/impostor-bounds-models.test.js — GitHub #542 on the three reported models (野鬃 char_496_wildmn, 浊心斯卡蒂
// char_1012_skadi2, 隐现 char_498_inside), read by @pixi-spine/runtime-3.8 and played by its real Spine and AnimationState
// inside the real SpineActor (headless, as test/render/eyemask.test.js): every pose a unit of them plays — each clip of
// its roles at 30 Hz, measured with Spine's own vertex math (RegionAttachment.computeWorldVertices with the region offsets
// pixi-spine never computes, MeshAttachment.computeWorldVertices) — lies inside the impostor box UnitView._impBox builds
// from the clip bounds of render/spine.js, except the clips the box leaves to a direct draw (`over`); the old rule (the
// pose shown first + a margin) cut 野鬃's idle flag and 浊心斯卡蒂's S3 flight when that pose was the setup pose. The box
// leaves the setup pose out: a model built while stunned (no stun clip) shows its clip's first frame instead — 隐现's
// Back model, whose setup pose stands 900 units right of its feet.
// The skeletons are not in the repository (public/assets: `npm run assets`): without them these tests skip.
// Run: node --test test/render/impostor-bounds-models.test.js

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'package.json'));
const ASSETS = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const dirOf = (id, side = 'front') => path.join(ROOT, 'public', 'assets', 'spine', 'op', id, side);
const have = (id, side = 'front') => existsSync(path.join(dirOf(id, side), `${id}.skel`)) && existsSync(path.join(dirOf(id, side), `${id}.atlas`));
const MODELS = ['char_496_wildmn', 'char_1012_skadi2', 'char_498_inside'];

let spine, units, rt, base, core;
before(async () => {
  class HeadlessCanvas { constructor() { this.width = 16; this.height = 16; } getContext(kind) { return kind === '2d' ? { fillStyle: '', fillRect() {}, clearRect() {}, drawImage() {} } : null; } }
  globalThis.HTMLCanvasElement ??= HeadlessCanvas;
  globalThis.document ??= { createElement: () => new HeadlessCanvas() };
  rt = require('@pixi-spine/runtime-3.8');
  base = require('@pixi-spine/base');
  core = require('@pixi/core');
  globalThis.PIXI = { spine: { Spine: rt.Spine } };
  spine = await import('../../public/js/render/spine.js');
  units = await import('../../public/js/render/units.js');
});

const cache = new Map();
function skeletonData(id, side = 'front') {
  const key = `${id}:${side}`;
  if (!cache.has(key)) {
    const dir = dirOf(id, side);
    const atlas = new base.TextureAtlas(readFileSync(path.join(dir, `${id}.atlas`), 'utf8'), (line, cb) => cb(new core.BaseTexture(null, { width: 1024, height: 1024 })));
    cache.set(key, new rt.SkeletonBinary(new rt.AtlasAttachmentLoader(atlas)).readSkeletonData(new Uint8Array(readFileSync(path.join(dir, `${id}.skel`)))));
  }
  return cache.get(key);
}
const measured = new Set();
/**
 * A real actor of `id` and the impostor box its battle view builds (UnitView._impBox on a stand-in view): the first actor
 * of a skeleton waits for its clips to be sampled (stepClipBounds, once per frame); later ones share the result.
 */
function unit(id, side = 'front') {
  const a = new spine.SpineActor(skeletonData(id, side), ASSETS.chars[id].spine[side]);
  const view = Object.assign(Object.create(units.UnitView.prototype), { actor: a, lodIdle: false, info: { spine: id, defId: id } });
  const t0 = performance.now();
  let box = view._impBox();
  if (!measured.has(`${id}:${side}`)) assert.equal(box, null, 'measured over the next frames, not at once');
  measured.add(`${id}:${side}`);
  let frames = 0;
  while (!box) { spine.stepClipBounds(); frames++; box = view._impBox(); }
  return { a, view, box, frames, ms: performance.now() - t0 };
}
const V = new Float32Array(1 << 14);
/** The skeleton's drawn geometry now (Spine's own vertex math; slots drawn at alpha 0 skipped), as [x0, y0, x1, y1]. */
function drawn(skel) {
  const r = [Infinity, Infinity, -Infinity, -Infinity];
  for (const slot of skel.drawOrder) {
    const att = slot.getAttachment();
    if (!att || !slot.bone.active || slot.color.a * att.color.a <= 0.004) continue;
    let n = 0;
    if (att instanceof rt.RegionAttachment) {
      if (!att.offsetDone) { att.updateOffset(); att.offsetDone = true; }
      att.computeWorldVertices(slot.bone, V, 0, 2);
      n = 8;
    } else if (att instanceof rt.MeshAttachment) {
      n = att.worldVerticesLength;
      att.computeWorldVertices(slot, 0, n, V, 0, 2);
    }
    for (let k = 0; k < n; k += 2) { r[0] = Math.min(r[0], V[k]); r[2] = Math.max(r[2], V[k]); r[1] = Math.min(r[1], V[k + 1]); r[3] = Math.max(r[3], V[k + 1]); }
  }
  return r;
}
/** The pose `t` s into `clip`, played by the actor's own Spine (AnimationState, no mix), as drawn([x0, y0, x1, y1]). */
function drawnAt(a, clip, t) {
  const sp = a.spine;
  sp.state.clearTracks();
  sp.skeleton.setToSetupPose();
  const e = sp.state.setAnimation(0, clip, false);
  e.mixDuration = 0;
  sp.update(t);
  return drawn(sp.skeleton);
}
const rectOf = (b) => [b.x0, b.y0, b.x0 + b.w, b.y0 + b.h];
const past = (r, p) => Math.max(r[0] - p[0], p[2] - r[2], r[1] - p[1], p[3] - r[3]);
/** The pre-#542 box: the bounds of the pose shown when the unit became an impostor + its margins. */
function oldBox(p) {
  const w = p[2] - p[0], h = p[3] - p[1];
  const padX = Math.max(60, w * 0.3), padY = Math.max(50, h * 0.22);
  return [Math.min(p[0] - padX, -140), Math.min(p[1] - padY, -260), Math.max(p[2] + padX, 140), Math.max(p[3] + padY * 0.4, 30)];
}
/** What a freshly built model shows before its first update: the setup pose. */
function setupDrawn(a) {
  const sp = a.spine;
  sp.state.clearTracks();
  sp.skeleton.setToSetupPose();
  sp.skeleton.updateWorldTransform();
  return drawn(sp.skeleton);
}

describe('the reported operators: every pose they play fits their impostor box', { skip: !(MODELS.every((id) => have(id)) && have('char_498_inside', 'back')) && 'the operator skeletons are not in public/assets (npm run assets)' }, () => {
  test('野鬃 idling: the flag at 0.27 s of Idle is in the box — the old box from the setup pose cut it by 103 units', (t) => {
    const { a, box, frames, ms } = unit('char_496_wildmn');
    t.diagnostic(`measured in ${frames} frames (${ms.toFixed(1)} ms with the box)`);
    const flag = drawnAt(a, 'Idle', 0.273);
    assert.ok(flag[0] < -420, `the flag reaches x ${flag[0].toFixed(0)}`);
    assert.ok(past(rectOf(box), flag) <= 0, `inside the box (${past(rectOf(box), flag).toFixed(1)})`);
    const before = past(oldBox(setupDrawn(a)), flag);
    assert.ok(before > 80, `the old box cut it by ${before.toFixed(0)} units`);
    assert.ok(box.over.has('Start'), 'its deploy drop (1700 units tall) is drawn directly instead');
  });

  test('浊心斯卡蒂 S3 (Skill_3_Begin, the flight): her head at 3.5 s is in the box — the old box cut it', () => {
    const { a, box } = unit('char_1012_skadi2');
    const head = drawnAt(a, 'Skill_3_Begin', 3.527);
    assert.ok(head[1] < -680, `the hat reaches y ${head[1].toFixed(0)}`);
    assert.ok(past(rectOf(box), head) <= 0, 'inside the box');
    assert.ok(past(oldBox(setupDrawn(a)), head) > 150, 'the old box cut it');
    assert.ok(!box.over.has('Skill_3_Begin') && !box.over.has('Skill_3_Loop'), 'her skill plays as an impostor');
  });

  test('隐现 S2: the pistol with its silencer is in the box (her own box held it before too: the stray pixels came from neighbours)', () => {
    const { a, box } = unit('char_498_inside');
    for (const [clip, at] of [['Skill_2_Begin', 0.658], ['Skill_2_Loop', 0.333], ['Attack_Begin', 0.1]]) {
      const p = drawnAt(a, clip, at);
      assert.ok(past(rectOf(box), p) <= 0, `${clip} at ${at} inside the box`);
    }
    assert.equal(box.over.size, 0, 'no clip of hers is drawn directly');
  });

  test('all three: every clip they play, at 30 Hz, inside the box unless left to a direct draw', (t) => {
    for (const id of MODELS) {
      const { a, view, box } = unit(id);
      const r = rectOf(box);
      let poses = 0, worst = -Infinity, at = '';
      for (const name of view._clipNames().keys()) {
        if (box.over.has(name)) continue;
        const d = a.dur(name);
        for (let k = 0; k <= Math.ceil(d * 30); k++) {
          const time = Math.min(d, k / 30);
          const e = past(r, drawnAt(a, name, time));
          poses++;
          if (e > worst) { worst = e; at = `${name} ${time.toFixed(2)} s`; }
        }
      }
      t.diagnostic(`${id}: ${poses} poses, closest to the edge ${(-worst).toFixed(1)} units inside (${at}); over: ${[...box.over].join(', ') || '—'}`);
      assert.ok(worst <= 0, `${id}: ${at} is ${worst.toFixed(1)} units past the box`);
    }
  });

  test('隐现\'s Back model built while stunned (no stun clip): its Idle\'s first frame, inside the box — not its setup pose', () => {
    const { box } = unit('char_498_inside', 'back');
    const r = rectOf(box);
    const setup = setupDrawn(unit('char_498_inside', 'back').a);
    assert.ok(setup[0] > 700, `the setup pose stands right of its feet (x ${setup[0].toFixed(0)}…${setup[2].toFixed(0)})`);
    assert.ok(past(r, setup) > 500, 'and lies outside the box: no model shows it');
    const first = drawnAt(unit('char_498_inside', 'back').a, 'Idle', 0);
    const { a } = unit('char_498_inside', 'back');      // a model built for a stunned unit, before any update
    a.setBase('stun');
    assert.equal(a.frozen, true, 'no stun clip: frozen');
    a.update(1 / 60);
    const shown = drawn(a.spine.skeleton);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(shown[i] - first[i]) < 0.5, `the Idle clip's first frame (${shown.map(Math.round)} vs ${first.map(Math.round)})`);
    assert.ok(past(r, shown) <= 0, 'inside the box');
    a.update(1 / 60);
    assert.deepEqual(drawn(a.spine.skeleton), shown, 'and held while stunned');
  });
});
