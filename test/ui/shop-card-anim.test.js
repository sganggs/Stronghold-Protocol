// test/ui/shop-card-anim.test.js — the repeated-card loop (loop_triple, four curves).
// The renderer already applies clip curves; this pins the product-side clock entry, effective length and still pose.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tripleLoopEntry, tripleLoopLength } from '../../public/js/ui/shop/cardView.js';
import { applyClip } from '../../public/js/render/shop/cardTimeline.js';
import { spawn, stepOne } from '../../public/js/render/shop/cardParticles.js';

const CLIP = {
  len: 2.5,
  stopTime: 1.0,
  curves: [
    ['fx_loop', 'tex.y', [[0, -0.5278, 0.256, 0.256], [0.6667, -0.1181, 1.1063, 1.1063], [1.1667, 0.495, 1.2887, 1.2887], [2, 1, 0, 0]]],
    ['fx_outline', 'tex.y', [[0, -0.5278, 0.256, 0.256], [0.6667, -0.1181, 1.1063, 1.1063], [1.1667, 0.495, 1.2887, 1.2887], [2, 1, 0, 0]]],
    ['fx_loop', 'raw.a', [[0, 0, 0, 0], [0.3333, 0.549, 0, 0], [2.5, 0.549, 0, 0]]],
    ['fx_outline', 'raw.a', [[0, 0, 0, 0], [0.3333, 0.8, 0, 0]]],
  ],
};

function records() {
  const map = new Map();
  for (const name of ['fx_loop', 'fx_outline']) {
    map.set(`state_fx_triple/${name}`, { pose: { tex: {}, colour: {}, alpha: null, ax: null, ay: null, scale: null, rot: null } });
  }
  return {
    byPath: (path) => map.get(path) || null,
    paths: () => map.keys(),
    get: (name) => map.get(`state_fx_triple/${name}`),
  };
}

function sample(t) {
  const recs = records();
  applyClip(recs, CLIP, t, 'state_fx_triple', true);
  const loop = recs.get('fx_loop');
  const outline = recs.get('fx_outline');
  return {
    texY: loop.pose.tex.y,
    outlineY: outline.pose.tex.y,
    alpha: loop.pose.colour.a,
    outlineAlpha: outline.pose.colour.a,
  };
}

test('loop_triple uses the clip stopTime; still pins the same end', () => {
  assert.equal(tripleLoopLength(CLIP), 1.0);
  const live = tripleLoopEntry({ still: false }, CLIP, 'state_fx_triple');
  assert.deepEqual(live, { clipName: 'loop_triple', t: 0, clock: true, len: 1.0, stillT: null, basePath: 'state_fx_triple' });
  const still = tripleLoopEntry({ still: true }, CLIP, 'state_fx_triple');
  assert.deepEqual(still, { clipName: 'loop_triple', t: 1.0, clock: true, len: 1.0, stillT: 1.0, basePath: 'state_fx_triple' });
});

test('the effective loop wraps at 1.0: t=0 / 0.5 / 1.0 / 1.5 have no hold', () => {
  const len = tripleLoopLength(CLIP);
  const wrap = (t) => ((t % len) + len) % len;
  assert.equal(wrap(0), 0);
  assert.equal(wrap(0.5), 0.5);
  assert.equal(wrap(1.0), 0);
  assert.equal(wrap(1.5), 0.5);
});

test('t=0 / 1 / 2.5 advance the UV; alpha fades in and holds', () => {
  const t0 = sample(0);
  const t1 = sample(1);
  const t25 = sample(2.5);
  assert.notEqual(t0.texY, t1.texY);
  assert.notEqual(t1.texY, t25.texY);
  assert.notEqual(t0.texY, t25.texY);
  assert.equal(t0.alpha, 0);
  assert.ok(t1.alpha > 0);
  assert.equal(t25.alpha, t1.alpha, 'the official alpha curve holds after 0.3333 s');
  assert.equal(t0.outlineAlpha, 0);
  assert.ok(t1.outlineAlpha > 0);
});

test('the clip has no transform curves (UV + alpha only, per TRIPLE-SPEC); still samples repeat', () => {
  const props = CLIP.curves.map(([, prop]) => prop);
  assert.deepEqual(props.filter((prop) => /^(ax|ay|scale|rot|sw|sh)$/.test(prop)), []);
  const a = sample(2.0);
  const b = sample(2.0);
  assert.deepEqual(a, b);
});

test('triple particle world units are converted to px (reference scale)', () => {
  const system = {
    shape: { type: 5, box: [1.43, 1.63], angle: 0 },
    life: [1, 1],
    size: [0.1, 0.4],
    speed: [0, 0],
    color: [[1, 1, 1, 1], [1, 1, 1, 1]],
    colorTint: [1, 1, 1],
  };
  const state = { seed: 12345 };
  const p = spawn(system, 0, state);
  assert.ok(p.sizePx >= 10 && p.sizePx <= 40, 'star size 0.1-0.4 world units -> 10-40 px');
  assert.ok(Math.abs(p.x) <= 71.5 && Math.abs(p.y) <= 81.5, 'box position is 143x163 px');
  stepOne(system, p, 0.5);
  assert.ok(p.sizePx >= 10, 'the per-frame step keeps the px scale');
});
