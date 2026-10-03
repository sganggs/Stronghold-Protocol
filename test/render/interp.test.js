// test/render/interp.test.js — snapshot interpolation buffer: clock, lerp, spawn/die mid-buffer, teleports,
// extrapolation guard, rate estimation, event stamping, robustness against junk.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotBuffer, normalizeSnapshot, isCosmeticEvent, frameTime } from '../../public/js/render/interp.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const snap = (t, units) => ({ fieldId: 'n:1', t, units, dp: 10, killed: 0, total: 5 });
const U = (id, x, y, hp = 100, anim = 0, flags = 0) => [id, x, y, hp, 100, 5, 10, flags, anim];

/** Feed snapshots every 0.1 game s at 2× (every 50 ms real) starting at real time 0. */
function feed(buf, frames, t0 = 0, realStep = 0.05, gameStep = 0.1) {
  frames.forEach((units, i) => buf.push(snap(t0 + i * gameStep, units), i * realStep));
  return (frames.length - 1) * realStep;
}

describe('normalizeSnapshot', () => {
  test('rejects junk, keeps valid tuples, fills defaults', () => {
    assert.equal(normalizeSnapshot(null), null);
    assert.equal(normalizeSnapshot({ t: 'x' }), null);
    assert.equal(normalizeSnapshot({ t: NaN, units: [] }), null);
    const s = normalizeSnapshot({ t: 1, units: [U(1, 2, 3), [2, NaN, 1], 'x', [3], [{}, 1, 1], [4, 1, 2, 'hp']] });
    assert.deepEqual([...s.units.keys()], [1, 4]);
    assert.deepEqual(s.units.get(4), [4, 1, 2, 0, 0, 0, 0, 0, 0]);
  });

  test('wire frames: game time comes from `gt` (the frame `t` is the message type)', () => {
    const wire = { t: 'b.snap', fieldId: 'n:a', gt: 12.5, units: [U(1, 2, 9)], killed: 1, total: 3 };
    assert.equal(frameTime(wire), 12.5);
    assert.equal(normalizeSnapshot(wire).t, 12.5);
    assert.equal(frameTime({ t: 3.5 }), 3.5, 'raw Battle snapshot / recording');
    assert.equal(frameTime({ t: 3.5, gt: 4 }), 4, 'gt wins');
    assert.ok(Number.isNaN(frameTime({ t: 'b.snap' })));
    assert.ok(Number.isNaN(frameTime({ t: 'b.ev', gt: Infinity })));
    assert.ok(Number.isNaN(frameTime(null)));
    assert.equal(normalizeSnapshot({ t: 'b.snap', units: [] }), null, 'a wire frame without gt is unusable');
    // a buffer fed wire frames and gt-stamped events delivers the events at their snapshot time
    const b = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    for (let i = 0; i <= 10; i++) {
      b.pushEvents([['dmg', 1, 5, 'phys']], i * 0.05, frameTime({ t: 'b.ev', gt: i * 0.1 }));
      assert.equal(b.push({ t: 'b.snap', gt: i * 0.1, units: [U(1, i * 0.1, 10)] }, i * 0.05), true);
    }
    assert.ok(near(b.newestT, 1.0));
    const due = b.takeEvents(0.55);
    assert.equal(due.length, 6, 'events stamped 0.0 … 0.5 are due at 0.55');
  });
});

describe('SnapshotBuffer', () => {
  test('render clock trails the newest snapshot by delay × rate', () => {
    const b = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    const frames = [];
    for (let i = 0; i <= 20; i++) frames.push([U(1, i * 0.1, 10)]);
    const now = feed(b, frames);
    b.update(now);
    assert.ok(near(b.rate, 2, 0.05), `rate ${b.rate}`);
    assert.ok(near(b.renderT, b.newestT - 0.2, 0.03), `renderT ${b.renderT} newest ${b.newestT}`);
    // steady state: snapshots keep arriving every 50 ms real, frames every 16 ms → stays ~0.2 game s behind
    let t = 2, real = now;
    for (let i = 0; i < 60; i++) {
      real += 0.05; t += 0.1;
      b.push(snap(t, [U(1, t, 10)]), real);
      for (let f = 1; f <= 3; f++) b.update(real + f * 0.0166);
    }
    const lag = b.newestT - b.renderT;
    assert.ok(lag > 0.05 && lag < 0.25, `steady lag ${lag} (renderT ${b.renderT} newest ${b.newestT})`);
  });

  test('lerps positions / hp between bracketing snapshots; flags & anim from the older one', () => {
    const b = new SnapshotBuffer();
    b.push(snap(1.0, [U(1, 0, 10, 100, 1, 0)]), 0);
    b.push(snap(1.1, [U(1, 1, 10.5, 50, 2, 16)]), 0.05);
    const out = b.sample(1.05);
    const s = out.get(1);
    assert.ok(near(s.x, 0.5) && near(s.y, 10.25) && near(s.hp, 75));
    assert.equal(s.anim, 1);
    assert.equal(s.flags, 0);
    assert.ok(near(s.vx, 10) && near(s.vy, 5));
    const s2 = b.sample(1.1).get(1);
    assert.equal(s2.anim, 2);
    assert.equal(s2.flags, 16);
  });

  test('spawn mid-buffer appears only once renderT reaches it; die mid-buffer holds then disappears', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, [U(1, 0, 10), U(2, 5, 10)]), 0);
    b.push(snap(0.1, [U(1, 1, 10), U(3, 9, 12)]), 0.05);
    let out = b.sample(0.05);
    assert.ok(out.has(1) && out.has(2), 'dying unit still shown before the newer snapshot');
    assert.ok(!out.has(3), 'spawned unit not shown early');
    assert.ok(near(out.get(2).x, 5), 'holds last position');
    out = b.sample(0.1, out);
    assert.ok(out.has(3) && !out.has(2), 'sample map reused and pruned');
  });

  test('teleports (> teleport tiles between snapshots) snap instead of sliding', () => {
    const b = new SnapshotBuffer({ teleport: 2 });
    b.push(snap(0, [U(1, 0, 10)]), 0);
    b.push(snap(0.1, [U(1, 8, 10)]), 0.05);
    assert.equal(b.sample(0.05).get(1).x, 0);
    assert.equal(b.sample(0.1).get(1).x, 8);
  });

  test('extrapolation guard: never more than maxExtrapolate past the newest; then freezes', () => {
    const b = new SnapshotBuffer({ delay: 0.1, rate: 2, maxExtrapolate: 0.1 });
    const frames = [];
    for (let i = 0; i <= 10; i++) frames.push([U(1, i * 0.1, 10)]); // 1 tile/s game
    const now = feed(b, frames);
    b.update(now);
    for (let k = 1; k <= 200; k++) b.update(now + k * 0.02); // stream stalls for 4 s
    assert.ok(b.renderT <= b.newestT + 0.1 * b.rate + 1e-9, `renderT ${b.renderT}`);
    const s = b.sample();
    assert.ok(s.get(1).x <= 1.0 + 0.2 + 1e-6 && s.get(1).x >= 1.0, `extrapolated x ${s.get(1).x}`);
  });

  test('large lag snaps the clock; a stream restart (t jumps back) resets the buffer', () => {
    const b = new SnapshotBuffer({ delay: 0.1, rate: 2, snapAfter: 0.5 });
    b.push(snap(0, [U(1, 0, 10)]), 0);
    b.update(0);
    b.push(snap(30, [U(1, 3, 10)]), 0.1); // server jumped ahead
    b.update(0.11);
    assert.ok(b.renderT > 29, `snapped to ${b.renderT}`);
    b.pushEvents([['dmg', 1, 5, 'phys']], 0.12);
    assert.ok(b.push(snap(0.5, [U(9, 1, 1)]), 0.2), 'accepted after reset');
    assert.equal(b.size, 1);
    assert.equal(b.events.length, 0, 'old events dropped on restart');
  });

  test('duplicate / out-of-order / junk snapshots are ignored', () => {
    const b = new SnapshotBuffer();
    assert.ok(b.push(snap(1, [U(1, 0, 0)]), 0));
    assert.ok(!b.push(snap(1, [U(1, 9, 9)]), 0.01));
    assert.ok(!b.push(snap(0.9, [U(1, 9, 9)]), 0.02));
    assert.ok(!b.push({ t: 'no' }, 0.03));
    assert.ok(!b.push(null, 0.03));
    assert.equal(b.size, 1);
    assert.equal(b.sample(1).get(1).x, 0);
  });

  test('rate estimation follows the stream (1× and 4×) within clamps', () => {
    for (const rate of [1, 4]) {
      const b = new SnapshotBuffer({ rate: 2 });
      for (let i = 0; i < 80; i++) b.push(snap(i * 0.1, [U(1, 0, 0)]), i * 0.1 / rate);
      assert.ok(near(b.rate, rate, 0.1), `estimated ${b.rate} for ${rate}`);
    }
  });

  test('old snapshots are trimmed even without frames (hidden tab); events queue is bounded', () => {
    const b = new SnapshotBuffer({ keep: 1 });
    for (let i = 0; i < 200; i++) {
      b.push(snap(i * 0.1, [U(1, i, 0)]), i * 0.05);
      b.pushEvents([['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['dmg', 1, 5, 'phys'], ['die', i]], i * 0.05);
    }
    assert.ok(b.size < 40, `size ${b.size}`);
    assert.ok(b.events.length <= 6000, `events ${b.events.length}`);
    assert.equal(b.events.filter((e) => e.ev[0] === 'die').length, 200, 'state events never shed');
    b.update(10);
    const s = b.sample();
    assert.ok(s.get(1), 'sample available');
  });

  test('events: stamped inside the latest interval, delivered in order when renderT passes', () => {
    const b = new SnapshotBuffer({ delay: 0.1, rate: 2 });
    b.push(snap(0, [U(1, 0, 0)]), 0);
    b.push(snap(0.1, [U(1, 0, 0)]), 0.05);
    b.pushEvents([['atk', 1, 2, 'arrow'], ['dmg', 2, 50, 'phys'], 'junk', [5]], 0.05);
    b.push(snap(0.2, [U(1, 0, 0)]), 0.1);
    b.pushEvents([['die', 2]], 0.1);
    assert.equal(b.events.length, 3);
    assert.deepEqual(b.takeEvents(0.0), []);
    const first = b.takeEvents(0.06);
    assert.deepEqual(first.map((e) => e[0]), ['atk', 'dmg']);
    assert.deepEqual(b.takeEvents(0.2).map((e) => e[0]), ['die']);
    // server-provided stamp
    b.pushEvents([['skill', 1, 1]], 0.2, 0.15);
    b.pushEvents([['skill', 1, 0]], 0.2, 5);
    assert.deepEqual(b.takeEvents(0.16).map((e) => e[2]), [1]);
  });

  test('takeEvents can drop stale cosmetic events but keeps state events', () => {
    const b = new SnapshotBuffer();
    b.pushEvents([['dmg', 1, 5, 'phys'], ['die', 1], ['fx', 'burst', 1, 1, {}], ['spawn', { id: 3 }]], 0, 1);
    const out = b.takeEvents(10, [], 5);
    assert.deepEqual(out.map((e) => e[0]), ['die', 'spawn']);
    assert.ok(isCosmeticEvent(['atk']) && !isCosmeticEvent(['leak']) && !isCosmeticEvent(null));
    b.pushEvents([['leak', 4]], 0, 50);
    assert.deepEqual(b.flushEvents().map((e) => e[0]), ['leak']);
  });

  test('enemy form changes survive fast-forward and a hidden tab while cosmetic effects expire', () => {
    const b = new SnapshotBuffer();
    const ember = ['fx', 'phase', 10, 9, { id: 1, kind: 'ember' }];
    const normal = ['fx', 'phase', 8, 9, { id: 1, kind: 'normal' }];
    b.pushEvents([ember, ['fx', 'ember', 10, 9, { id: 1 }]], 0, 1);
    b.pushEvents([normal], 0, 11);
    assert.deepEqual(b.takeEvents(20, [], 18), [ember, normal]);
  });

  test('sample before any snapshot / with NaN time is empty; update before snapshots is NaN', () => {
    const b = new SnapshotBuffer();
    assert.ok(Number.isNaN(b.update(1)));
    assert.equal(b.sample().size, 0);
    b.push(snap(2, [U(1, 1, 1)]), 1);
    assert.equal(b.sample(NaN).size, 0);
    assert.equal(b.sample(0).get(1).x, 1, 'time before the oldest clamps to the oldest');
  });

  test('no NaN anywhere through a noisy stream', () => {
    const b = new SnapshotBuffer();
    let now = 0, t = 0;
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const out = new Map();
    for (let i = 0; i < 500; i++) {
      now += 0.03 + rnd() * 0.05;
      if (rnd() < 0.8) { t += 0.1; b.push(snap(t, [U(1, rnd() * 20, rnd() * 18, rnd() * 100), U(2 + (i % 5), 3, 3)]), now); }
      b.update(now);
      b.sample(undefined, out);
      for (const s of out.values()) for (const k of ['x', 'y', 'hp', 'sp', 'vx', 'vy']) assert.ok(Number.isFinite(s[k]), k);
    }
  });
});
