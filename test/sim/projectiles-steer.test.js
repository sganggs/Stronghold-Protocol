// test/sim/projectiles-steer.test.js — a content-owned projectile's own flight path (ProjectileSystem `steer`).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ProjectileSystem } from '../../server/sim/projectiles.js';

/** The engine's own isolation wrapper, without a whole battle: a throwing callback is counted, never thrown out. */
function fakeBattle() {
  const errors = [];
  return {
    errors,
    _safe(fn, what) { try { fn(); } catch (e) { errors.push({ what, e }); } },
  };
}

const sys = () => {
  const battle = fakeBattle();
  return { battle, ps: new ProjectileSystem(battle) };
};

test('a steer redirects the aim for that tick, and the hit lands at the steered point', () => {
  const { ps } = sys();
  const hits = [];
  ps.add({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, speed: 10, steer: () => ({ x: 0, y: 10 }), onHit: (c) => hits.push([c.x, c.y]) });
  ps.update(1);
  assert.deepEqual(hits, [[0, 10]]);            // the straight line to (10, 0) was replaced
  assert.equal(ps.list.length, 0);
});

test('a steer answering nothing keeps the straight line', () => {
  const { ps } = sys();
  for (const answer of [null, undefined, {}, { x: 'far' }, { x: Number.NaN, y: 1 }]) {
    const p = ps.add({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, speed: 1, steer: () => answer });
    ps.update(1);
    assert.deepEqual([p.x, p.y], [1, 0], JSON.stringify(answer));
  }
});

test('a throwing steer is isolated: the projectile keeps its old aim', () => {
  const { ps, battle } = sys();
  const p = ps.add({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, speed: 1, steer: () => { throw new Error('boom'); } });
  ps.update(1);
  assert.deepEqual([p.x, p.y], [1, 0]);
  assert.equal(battle.errors.length, 1);
  assert.equal(battle.errors[0].what, 'projectile.steer');
});

test('a steered projectile drops its homing target (the kit owns the aim)', () => {
  const { ps } = sys();
  const target = { x: 5, y: 5, alive: true, hidden: false, deploySeq: 0 };
  const p = ps.add({ from: { x: 0, y: 0 }, target, speed: 1, steer: () => ({ x: 0, y: 10 }) });
  ps.update(1);
  assert.equal(p.target, null);
  assert.deepEqual([p.tx, p.ty], [0, 10]);
});

test('without a steer every call is the plain homing flight it always was', () => {
  const { ps, battle } = sys();
  const target = { x: 5, y: 0, alive: true, hidden: false, deploySeq: 0 };
  const p = ps.add({ from: { x: 0, y: 0 }, target, speed: 2 });
  ps.update(1);
  assert.deepEqual([p.x, p.y], [2, 0]);        // straight towards the body
  assert.equal(p.target, target);
  assert.equal(battle.errors.length, 0);
});

test('maxAge still lands a steer that never comes close', () => {
  const { ps } = sys();
  const hits = [];
  const p = ps.add({
    from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, speed: 1, maxAge: 3,
    steer: () => ({ x: 100, y: 0 }),
    onHit: (c) => hits.push([c.x, c.y]),
  });
  for (let i = 0; i < 5 && ps.list.length; i++) ps.update(1);
  assert.equal(hits.length, 1);                 // the safety net, not the step test
  assert.deepEqual([p.x, p.y], [100, 0]);       // the safety landing snaps to the last aim (a straight shot's `to`)
});
