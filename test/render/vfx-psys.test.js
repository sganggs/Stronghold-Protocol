// test/render/vfx-psys.test.js — the ParticleSystem interpreter of the official effects (render/vfx/psys.js,
// render/vfx/shapes.js, DESIGN §33.5): emission (rate over time, rate over distance, bursts with cycles / interval /
// probability, start delay, duration, looping, prewarm, the max-particles cap), shape sampling, forces / limit
// velocity, the scaling modes, birth / death sub-emitters and the per-particle trails.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compileSystem, PSys } from '../../public/js/render/vfx/psys.js';
import { Shape } from '../../public/js/render/vfx/shapes.js';
import { Rng } from '../../public/js/render/vfx/rng.js';
import { mat4, mat4Trs, quatEuler } from '../../public/js/render/vfx/math.js';

const ID = { m: mat4(), scale: [1, 1, 1] };
const frameAt = (x, y, z, rot = [0, 0, 0, 1], s = [1, 1, 1]) => ({ m: mat4Trs([x, y, z], rot, s), scale: s });

/** A minimal ParticleSystem descriptor (Unity defaults, overridden by `o`). */
function sys(o = {}) {
  return {
    lengthInSec: 1, looping: false, prewarm: false, startDelay: 0, playOnAwake: true, simulationSpeed: 1, moveWithTransform: 0,
    scalingMode: 1, autoRandomSeed: false, randomSeed: 7,
    InitialModule: { startLifetime: 1, startSpeed: 0, startSize: 1, startColor: [1, 1, 1, 1], maxNumParticles: 1000, ...(o.I || {}) },
    EmissionModule: { rateOverTime: 0, rateOverDistance: 0, m_Bursts: [], ...(o.E || {}) },
    ...o.extra,
    ...(o.top || {}),
  };
}

function run(ps, seconds, frame = ID, dt = 1 / 60) {
  let born = 0;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) { const before = ps.count + ps.deaths; ps.update(dt, frame); born += ps.count + ps.deaths - before; }
  return born;
}

describe('emission', () => {
  test('rate over time emits rate × duration particles, then stops (non-looping)', () => {
    const ps = new PSys(compileSystem(sys({ E: { rateOverTime: 20 } })), {});
    ps.play(ID);
    const born = run(ps, 1.5);
    assert.ok(Math.abs(born - 20) <= 1, `born ${born}`);
    assert.equal(ps.emitting, false);
  });

  test('a looping system keeps emitting; stopEmitting lets the particles finish', () => {
    const ps = new PSys(compileSystem(sys({ top: { looping: true }, E: { rateOverTime: 10 } })), {});
    ps.play(ID);
    const born = run(ps, 3);
    assert.ok(Math.abs(born - 30) <= 1, `born ${born}`);
    ps.stopEmitting();
    run(ps, 1.1);
    assert.equal(ps.count, 0);
    assert.equal(ps.alive, false);
  });

  test('bursts fire at their time, repeat by cycles and interval, and re-arm every loop', () => {
    const E = { m_Bursts: [{ time: 0.2, countCurve: 3, cycleCount: 2, repeatInterval: 0.1, probability: 1 }] };
    const one = new PSys(compileSystem(sys({ E })), {});
    one.play(ID);
    assert.equal(run(one, 0.15), 0);
    assert.equal(run(one, 0.07), 3);
    assert.equal(run(one, 0.1), 3);
    assert.equal(run(one, 1), 0);
    const loop = new PSys(compileSystem(sys({ top: { looping: true }, E })), {});
    loop.play(ID);
    assert.equal(run(loop, 3.05), 18); // 3 loops × 2 cycles × 3
  });

  test('a burst at time 0 fires on the first step; probability 0 never fires', () => {
    const a = new PSys(compileSystem(sys({ E: { m_Bursts: [{ time: 0, countCurve: { min: 4, max: 4 }, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] } })), {});
    a.play(ID);
    assert.equal(run(a, 1 / 60), 4);
    const b = new PSys(compileSystem(sys({ E: { m_Bursts: [{ time: 0, countCurve: 4, cycleCount: 1, repeatInterval: 0.01, probability: 0 }] } })), {});
    b.play(ID);
    assert.equal(run(b, 0.5), 0);
  });

  test('the start delay holds the emission back', () => {
    const ps = new PSys(compileSystem(sys({ top: { startDelay: 0.5 }, E: { m_Bursts: [{ time: 0, countCurve: 2, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] } })), {});
    ps.play(ID);
    assert.equal(run(ps, 0.45), 0);
    assert.equal(run(ps, 0.1), 2);
  });

  test('maxNumParticles caps the live particles; the emission multiplier scales counts', () => {
    const capped = new PSys(compileSystem(sys({ I: { maxNumParticles: 5, startLifetime: 10 }, E: { rateOverTime: 100 } })), {});
    capped.play(ID);
    run(capped, 1);
    assert.equal(capped.count, 5);
    const half = new PSys(compileSystem(sys({ E: { m_Bursts: [{ time: 0, countCurve: 10, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] } })), { emission: 0.5 });
    half.play(ID);
    assert.equal(run(half, 0.1), 5);
  });

  test('prewarm starts a looping system as if one loop had run', () => {
    const ps = new PSys(compileSystem(sys({ top: { looping: true, prewarm: true, startDelay: 5 }, I: { startLifetime: 2 }, E: { rateOverTime: 10 } })), {});
    ps.play(ID);
    assert.ok(ps.count >= 9 && ps.count <= 11, `prewarmed ${ps.count}`);
    assert.equal(ps.delay, 0, 'no start delay with prewarm');
  });

  test('rate over distance emits per unit the emitter moves (none while it stands)', () => {
    const def = compileSystem(sys({ top: { looping: true, moveWithTransform: 1 }, I: { startLifetime: 5 }, E: { rateOverDistance: 4 } }));
    const ps = new PSys(def, {});
    ps.play(frameAt(0, 0, 0));
    run(ps, 0.5, frameAt(0, 0, 0));
    assert.equal(ps.count, 0);
    for (let i = 1; i <= 30; i++) ps.update(1 / 60, frameAt(i * 0.1, 0, 0)); // 3 units
    assert.ok(Math.abs(ps.count - 12) <= 1, `count ${ps.count}`);
    // spread along the path, not bunched at the emitter
    const xs = Array.from(ps.px.subarray(0, ps.count)).sort((a, b) => a - b);
    assert.ok(xs[xs.length - 1] - xs[0] > 2.4, `spread ${xs[0]}..${xs[xs.length - 1]}`);
  });
});

describe('simulation', () => {
  test('a world-space particle stays where it was born; a local one moves with the system', () => {
    const E = { m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] };
    const w = new PSys(compileSystem(sys({ top: { moveWithTransform: 1 }, I: { startLifetime: 5 }, E })), {});
    w.play(frameAt(1, 2, 3));
    w.update(1 / 60, frameAt(1, 2, 3));
    w.update(1 / 60, frameAt(5, 2, 3));
    const pw = w.worldPos(0, [0, 0, 0]);
    assert.deepEqual(pw.map((v) => Math.round(v * 1000) / 1000), [1, 2, 3]);
    const l = new PSys(compileSystem(sys({ I: { startLifetime: 5 }, E })), {});
    l.play(frameAt(1, 2, 3));
    l.update(1 / 60, frameAt(1, 2, 3));
    l.update(1 / 60, frameAt(5, 2, 3));
    assert.equal(Math.round(l.worldPos(0, [0, 0, 0])[0] * 1000) / 1000, 5);
  });

  test('gravity pulls towards −y of the battle frame; limit velocity dampens the excess speed', () => {
    const E = { m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] };
    const g = new PSys(compileSystem(sys({ top: { moveWithTransform: 1 }, I: { startLifetime: 5, gravityModifier: 1 }, E })), {});
    g.play(ID);
    run(g, 1);
    assert.ok(g.vy[0] < -9 && g.vy[0] > -10.5, `vy ${g.vy[0]}`);
    const lim = new PSys(compileSystem(sys({ top: { moveWithTransform: 1 }, I: { startLifetime: 5, startSpeed: 10 }, E,
      extra: { ClampVelocityModule: { magnitude: 2, dampen: 1, separateAxis: false } } })), {});
    lim.play(ID);
    run(lim, 0.1);
    const sp = Math.hypot(lim.vx[0], lim.vy[0], lim.vz[0]);
    assert.ok(Math.abs(sp - 2) < 1e-3, `speed ${sp}`);
  });

  test('scaling mode Local: the node scale sizes the particles; Shape: it does not', () => {
    const E = { m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] };
    const big = frameAt(0, 0, 0, [0, 0, 0, 1], [2, 2, 2]);
    const local = new PSys(compileSystem(sys({ I: { startSize: 0.5 }, E })), {});
    local.play(big); local.update(1 / 60, big);
    assert.equal(local.sx[0] * local.sizeScale(0), 1);
    // drawn at the scale as it is now (0.3.1): a node scaled down later shrinks the particles it holds
    const small = frameAt(0, 0, 0, [0, 0, 0, 1], [0.5, 0.5, 0.5]);
    local.update(1 / 60, small);
    assert.equal(local.sx[0] * local.sizeScale(0), 0.25);
    const shape = new PSys(compileSystem(sys({ top: { scalingMode: 2 }, I: { startSize: 0.5 }, E })), {});
    shape.play(big); shape.update(1 / 60, big);
    assert.equal(shape.sx[0] * shape.sizeScale(0), 0.5);
  });
});

describe('sub-emitters', () => {
  test('a death sub-emitter bursts where its parent dies, inheriting the colour', () => {
    const parent = compileSystem(sys({ top: { moveWithTransform: 1 }, I: { startLifetime: 0.2, startSpeed: 5, startColor: [1, 0, 0, 1] },
      E: { m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] },
      extra: { ShapeModule: { typeName: 'cone', angle: 0, radius: { value: 0 }, radiusThickness: 0 } } }));
    const child = compileSystem(sys({ top: { moveWithTransform: 1 }, I: { startLifetime: 1, startColor: [0.5, 0.5, 0.5, 1] },
      E: { m_Bursts: [{ time: 0, countCurve: 3, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] } }));
    const p = new PSys(parent, {});
    const c = new PSys(child, { sub: true });
    p.children = [{ sys: c, type: 2, props: 1, prob: 1 }];
    p.play(ID); c.play(ID);
    for (let i = 0; i < 9; i++) { p.update(1 / 60, ID); c.update(1 / 60, ID); }
    assert.equal(c.count, 0, 'nothing before the death');
    for (let i = 0; i < 15; i++) { p.update(1 / 60, ID); c.update(1 / 60, ID); }
    assert.equal(p.count, 0);
    assert.equal(c.count, 3);
    // born at the parent's last position: 5 units/s along +z for 0.2 s
    assert.ok(Math.abs(c.pz[0] - 1) < 0.15, `z ${c.pz[0]}`);
    assert.ok(Math.abs(c.cr[0] - 0.5) < 1e-6 && c.cg[0] === 0, 'colour × the parent colour');
  });

  test('a birth sub-emitter emits its rate over time along its living parent', () => {
    const parent = compileSystem(sys({ top: { moveWithTransform: 1 }, I: { startLifetime: 1, startSpeed: 2 },
      E: { m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] } }));
    const child = compileSystem(sys({ top: { moveWithTransform: 1 }, I: { startLifetime: 5 }, E: { rateOverTime: 30 } }));
    const p = new PSys(parent, {});
    const c = new PSys(child, { sub: true });
    p.children = [{ sys: c, type: 0, props: 0, prob: 1 }];
    p.play(ID); c.play(ID);
    for (let i = 0; i < 60; i++) { p.update(1 / 60, ID); c.update(1 / 60, ID); }
    assert.ok(c.count >= 27 && c.count <= 31, `count ${c.count}`);
    const zs = Array.from(c.pz.subarray(0, c.count));
    assert.ok(Math.max(...zs) - Math.min(...zs) > 1.5, 'a trail along the parent');
  });
});

describe('trails', () => {
  test('the trail module records points every minVertexDistance', () => {
    const ps = new PSys(compileSystem(sys({ top: { moveWithTransform: 1 }, I: { startLifetime: 2, startSpeed: 3 },
      E: { m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] },
      extra: { TrailModule: { mode: 0, ratio: 1, lifetime: 1, minVertexDistance: 0.25, worldSpace: true } } })), {});
    ps.play(ID);
    run(ps, 1);
    assert.equal(ps.count, 1);
    assert.ok(ps.trailLen[0] >= 10 && ps.trailLen[0] <= 13, `points ${ps.trailLen[0]}`);
  });
});

describe('shapes', () => {
  const rng = new Rng(3);
  const ctx = { time: 0, tau: 0, index: 0, count: 0 };
  const out = { px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: 1 };
  const many = (shape, n = 400) => Array.from({ length: n }, () => ({ ...shape.sample(rng, ctx, out) }));

  test('cone: the base edge emits at the cone angle; 90° is radial in the XY plane', () => {
    const s = new Shape({ typeName: 'cone', angle: 30, radius: { value: 1 }, radiusThickness: 0, arc: { value: 360 } });
    for (const p of many(s, 50)) {
      assert.ok(Math.abs(Math.hypot(p.px, p.py) - 1) < 1e-6 && p.pz === 0);
      assert.ok(Math.abs(Math.acos(p.dz) * 180 / Math.PI - 30) < 1e-3);
    }
    const flat = new Shape({ typeName: 'cone', angle: 90, radius: { value: 0.01 }, radiusThickness: 0, arc: { value: 360 } });
    for (const p of many(flat, 20)) assert.ok(Math.abs(p.dz) < 1e-6);
  });

  test('sphere / hemisphere: inside the radius band, radial directions, hemisphere opens along +Z', () => {
    const s = new Shape({ typeName: 'sphere', radius: { value: 2 }, radiusThickness: 0.5 });
    for (const p of many(s)) { const r = Math.hypot(p.px, p.py, p.pz); assert.ok(r >= 1 - 1e-9 && r <= 2 + 1e-9, `r ${r}`); }
    const h = new Shape({ typeName: 'hemisphere', radius: { value: 1 }, radiusThickness: 1 });
    for (const p of many(h)) assert.ok(p.pz >= 0 && p.dz >= 0);
  });

  test('circle and donut lie in the XY plane; box inside the scaled unit cube; edge along X', () => {
    const c = new Shape({ typeName: 'circle', radius: { value: 1 }, radiusThickness: 1, arc: { value: 90 } });
    for (const p of many(c)) { assert.equal(p.pz, 0); assert.ok(p.px >= -1e-9 && p.py >= -1e-9, 'inside the 90° arc'); }
    const d = new Shape({ typeName: 'donut', radius: { value: 1 }, donutRadius: 0.2, radiusThickness: 0 });
    for (const p of many(d)) {
      const ring = Math.hypot(p.px, p.py);
      assert.ok(Math.abs(Math.hypot(ring - 1, p.pz) - 0.2) < 1e-6);
    }
    const b = new Shape({ typeName: 'box', m_Scale: [2, 4, 0.5] });
    for (const p of many(b)) assert.ok(Math.abs(p.px) <= 1 && Math.abs(p.py) <= 2 && Math.abs(p.pz) <= 0.25);
    const e = new Shape({ typeName: 'singleSidedEdge', radius: { value: 3 } });
    for (const p of many(e)) { assert.ok(Math.abs(p.px) <= 3 && p.py === 0 && p.pz === 0); assert.equal(p.dy, 1); }
  });

  test("the shape's own transform rotates and moves the samples", () => {
    const s = new Shape({ typeName: 'cone', angle: 0, radius: { value: 0 }, radiusThickness: 0, m_Position: [1, 2, 3], m_Rotation: [0, 90, 0] });
    const p = s.sample(rng, ctx, out);
    assert.deepEqual([p.px, p.py, p.pz].map((v) => Math.round(v * 1e6) / 1e6), [1, 2, 3]);
    // +Z turned 90° about Y points along +X
    assert.ok(Math.abs(p.dx - 1) < 1e-6 && Math.abs(p.dz) < 1e-6);
  });

  test('mesh shapes emit from the triangles along their normals', () => {
    const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], submeshes: [[0, 1, 2]] };
    const s = new Shape({ typeName: 'mesh', placementMode: 2, m_Mesh: { mesh: 'm' } }, { mesh: () => mesh });
    for (const p of many(s, 100)) { assert.ok(p.px >= -1e-9 && p.py >= -1e-9 && p.px + p.py <= 1 + 1e-9 && p.pz === 0); assert.equal(p.dz, 1); }
  });

  test('the arc modes: BurstSpread spaces a burst evenly', () => {
    const s = new Shape({ typeName: 'circle', radius: { value: 1 }, radiusThickness: 0, arc: { value: 360, mode: 3 } });
    const angles = [0, 1, 2, 3].map((i) => { const p = s.sample(rng, { time: 0, tau: 0, index: i, count: 4 }, out); return Math.round(Math.atan2(p.py, p.px) * 180 / Math.PI); });
    assert.deepEqual(angles, [0, 90, 180, -90]);
  });

  test('quatEuler follows Unity (Z, then X, then Y)', () => {
    const q = quatEuler(90, 0, 0);
    assert.ok(Math.abs(q[0] - Math.SQRT1_2) < 1e-6 && Math.abs(q[3] - Math.SQRT1_2) < 1e-6);
  });
});
