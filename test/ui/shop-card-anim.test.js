// test/ui/shop-card-anim.test.js — the repeated-card loop (loop_triple, four curves).
// The renderer already applies clip curves; this pins the product-side clock entry, effective length and still pose.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tripleLoopEntry, tripleLoopLength } from '../../public/js/ui/shop/cardView.js';
import { applyClip } from '../../public/js/render/shop/cardTimeline.js';
import {
  spawn, stepOne, tintOf, systemsOf, prepare, advanceEmitter,
  MAX_POINT_PX, pointMaxSize, pointSizeOf,
} from '../../public/js/render/shop/cardParticles.js';

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

test('only particle_tv_glow multiplies _TintColor (triple stays at 1)', () => {
  const tv = tintOf({ name: 'particle_tv_glow', colors: { _TintColor: [0.5, 0.5, 0.5, 1] } });
  const point = tintOf({ name: 'm_particle_point', colors: { _TintColor: [0.5, 0.5, 0.5, 1] } });
  const star = tintOf({ name: 'm_particle_star', colors: { _TintColor: [0.5, 0.5, 0.5, 1] } });
  assert.deepEqual(tv, [0.5, 0.5, 0.5]);
  assert.deepEqual(point, [1, 1, 1]);
  assert.deepEqual(star, [1, 1, 1]);
});

test('only the mounted tier sub-prefab may keep its tv_particle system', () => {
  const spec = (name) => ({ path: `autochess_shop_card_item/root/${name}/tv_particle`, sub: name, material: null });
  const card = { materials: {}, sub: {}, particles: [spec('frame_lv2_obj'), spec('frame_lv3_obj')] };
  const five = systemsOf(card, ['frame_lv2_obj', 'chess_level_5_obj']);
  const six = systemsOf(card, ['frame_lv3_obj', 'chess_level_6_obj']);
  assert.deepEqual(five.map((s) => s.name), ['tv_particle']);
  assert.ok(five[0].spec.path.includes('frame_lv2_obj'));
  assert.deepEqual(six.map((s) => s.name), ['tv_particle']);
  assert.ok(six[0].spec.path.includes('frame_lv3_obj'));
});

test('the particle draw cap is reference MAX_POINT_PX=64, not 1024', () => {
  assert.equal(MAX_POINT_PX, 64);
});

// reference/card/particles.js:175-177/369/373: the TV glow is a point sprite with one square size derived from
// ParticleSystemRenderer.maxParticleSize (world units -> px) and clamped to the 64 px point cap.
test('point size follows the reference maxPx and cap', () => {
  assert.equal(pointMaxSize({ maxPx: 2000 }, 1.6667), 64);
  assert.equal(pointMaxSize({ maxPx: 30 }, 2), 60);
  assert.equal(pointMaxSize({}, 3), 64, 'no renderer max falls back to the point cap');
  assert.equal(pointSizeOf({ maxPx: 2000 }, { sizePx: 64 }, 4 / 3), 64, '106.7 px is clamped to 64');
  assert.equal(pointSizeOf({ maxPx: 2000 }, { sizePx: 10 }, 2), 20);
  assert.equal(pointSizeOf({ maxPx: 2000 }, { sizePx: 0.1 }, 1), 1);
});

test('prepare keeps the point path for the TV glow only and derives maxPx from the spec renderer', () => {
  const base = {
    startSize: { mode: 'constant', value: 0.64 },
    startLifetime: { mode: 'constant', value: 0.4 },
    maxParticles: 1,
    rate: { mode: 'constant', value: 10 },
    startColor: { mode: 'color', min: '#FFFFFF1A', color: '#FFFFFF0D' },
    modules: {},
    renderer: { maxParticleSize: 20 },
  };
  const tv = prepare({ ...base, path: 'autochess_shop_card_item/root/frame_lv3_obj/tv_particle', material: 'particle_tv_glow' }, 0, null);
  assert.equal(tv.pointSprite, true);
  assert.equal(tv.maxPx, 2000, '20 world units -> 2000 px, so the 64 px cap binds');
  const star = prepare({ ...base, path: 'autochess_shop_card_item/root/panel_main/btn_card/state_fx_triple/particle_ctrl/particle_3', material: 'm_particle_star' }, 1, null);
  assert.equal(star.pointSprite, false, 'the triple star keeps the masked quad path');
});

// reference/card/particles.js:340-355 emits before advancing the alive particles. Spawning after the step left
// the fresh particle at spawn()'s placeholder alpha=1, so the TV glow painted one white frame per respawn.
function tvSystem() {
  return {
    emission: { enabled: true, rate: [10, 10], rateDistance: [0, 0], bursts: [], duration: 1, looping: true, prewarm: true },
    rate: [10, 10],
    life: [0.4, 0.4],
    size: [0.64, 0.64],
    color: [[1, 1, 1, 0.10196078431372549], [1, 1, 1, 0.10196078431372549]],
    startGradient: null,
    alphaKeys: [[0, 0], [0.5, 1], [1, 0]],
    sizeKeys: null,
    max: 1,
    shape: null,
    speed: [0, 0],
    noise: null,
    alive: [],
    acc: 0,
    distAcc: 0,
    t: 0,
    active: false,
    seed: 12345,
  };
}

test('a fresh particle is never drawn with the spawn() placeholder alpha', () => {
  const system = tvSystem();
  let worst = 0;
  for (let i = 0; i < 240; i += 1) {
    advanceEmitter(system, system, 1 / 60, 0);
    for (const p of system.alive) worst = Math.max(worst, p.alpha);
  }
  assert.ok(worst <= 0.10196078431372549 + 1e-9, `the TV alpha ramp tops out at its start colour alpha (saw ${worst})`);
});

test('the emitter advances a freshly spawned particle in the same frame', () => {
  const system = tvSystem();
  // run until a respawn happens after the prewarmed particle has died
  let respawnAge = null;
  for (let i = 0; i < 240; i += 1) {
    const had = system.alive.length;
    advanceEmitter(system, system, 1 / 60, 0);
    if (had === 0 && system.alive.length === 1 && system.t > 0.4) {
      respawnAge = system.alive[0].age;
      break;
    }
  }
  assert.ok(respawnAge != null, 'a respawn happened');
  assert.ok(respawnAge > 0 && respawnAge <= 1 / 60 + 1e-9, `the new particle was stepped once (age ${respawnAge})`);
});
