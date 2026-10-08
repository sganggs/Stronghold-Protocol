// test/sim/projectile-steer.test.js — server/sim/projectiles.js `steer(p, dt)`: the hook that hands ONE projectile's
// movement to its content.
//
// A projectile normally flies straight at `tx`/`ty` (a homing target or a fixed point) and lands when it gets there.
// A content-owned flight cannot be expressed that way (a 【自由移动】/【追踪移动】/【已命中】 state machine, a drift, a turn
// speed, "out of range for `delay` s with nothing to chase ⇒ it disappears"): a single straight leg cannot carry a state
// machine, and `tx`/`ty` cannot be re-aimed from inside `onHit` without a second projectile. So the content owns the
// move (`steer`, an option of `addProjectile`): it is called every step INSTEAD of the straight-line move, and returning
// true is the arrival (`onHit` runs as usual). Everything else — id, age/maxAge, data, visual, the target fizzle, the
// handler-error isolation — stays the system's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, ...o });
const wall = () => chessRec({ id: 't_wall', stats: { atk: 0, maxHp: 1e6, blockCnt: 0 }, skill: null });

/** A battle with a wall ally (uid 1) and a stationary dummy — enough to own the projectile list by hand. */
function field(o = {}) {
  return makeBattle({
    seed: 7, autoFinish: false, timeLimit: 60, content: 'none',
    defs: { chess: { t_wall: wall() }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_wall', row: 10, col: 4 }],
    ...o,
  });
}

test('steer owns the flight: the straight-line move is skipped, the content writes the position', () => {
  const h = field();
  const u = h.unit('t_wall');
  h.step();
  // a projectile that WOULD fly straight east at 1 tile/s, but its content drags it north instead
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 15, y: 10 }, speed: 1, onHit: () => {} });
  const seen = [];
  p.steer = (q, dt) => { seen.push(dt); q.x += 0; q.y += 1 * dt; return false; };
  h.step(10);
  assert.equal(seen.length, 10, 'one steer call per step');
  assert.ok(Math.abs(p.y - (10 + 10 * h.TICK)) < 1e-9, `it moved along the content's own axis (y=${p.y})`);
  assert.equal(p.x, 5, 'tx/ty and speed were never consulted');
  assert.ok(u.alive);
  checkInvariants(h.b);
});

test('steer returning true is the arrival: onHit runs once with the battle, the projectile and the live target', () => {
  const h = field();
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  const hits = [];
  let alive = 0;
  const p = h.b.addProjectile({
    from: { x: 5, y: 10 }, target: e, speed: 0.5, data: { tag: 'test' },
    onHit: (c) => hits.push(c),
  });
  p.steer = (q, dt) => { q.x += 3 * dt; alive++; return alive >= 3; };   // it "lands" on the third step
  h.step(6);
  assert.equal(hits.length, 1, 'exactly one arrival');
  assert.equal(hits[0].battle, h.b);
  assert.equal(hits[0].projectile, p);
  assert.equal(hits[0].target, e, 'the ctx target is the one the projectile still tracks');
  assert.ok(Math.abs(hits[0].x - (5 + 3 * 3 * h.TICK)) < 1e-9, 'the ctx carries the content-owned impact point');
  assert.equal(h.b.projectiles.list.includes(p), false, 'and it left the flight list');
  checkInvariants(h.b);
});

test('a projectile passed `steer` at add time is steered too (the option is read once, at add)', () => {
  const h = field();
  h.step();
  const hits = [];
  let steps = 0;
  const p = h.b.addProjectile({
    from: { x: 5, y: 10 }, to: { x: 15, y: 10 }, speed: 4,
    steer: (q, dt) => { q.y += 1 * dt; return ++steps >= 4; },
    onHit: () => hits.push(1),
  });
  assert.equal(typeof p.steer, 'function', 'the system kept the content\'s function');
  h.step(6);
  assert.equal(hits.length, 1, 'its own arrival, not the straight leg to (15,10)');
  assert.equal(p.x, 5, 'the `to` point was never reached');
  assert.ok(Math.abs(p.y - (10 + 4 * h.TICK)) < 1e-9);
  checkInvariants(h.b);
});

test('a steered projectile does not fizzle on a dead target — the content decides when it is done', () => {
  const h = field();
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  const hits = [];
  let steps = 0;
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, target: e, speed: 1, onHit: (c) => hits.push(c) });
  p.steer = (q, dt) => { q.x += 1 * dt; return ++steps >= 12; };
  h.step(2);
  h.b.kill(e);                       // the homing target dies mid-flight
  h.step(2);
  assert.ok(h.b.projectiles.list.includes(p), 'a straight-line projectile would have fizzled here');
  h.step(10);
  assert.equal(hits.length, 1, 'it still arrives, and onHit sees no target');
  assert.equal(hits[0].target, null);
  checkInvariants(h.b);
});

test('a throwing steer is isolated: the handler error is recorded, the projectile arrives instead of leaking', () => {
  const h = field();
  const hits = [];
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 9, y: 10 }, speed: 1, onHit: () => hits.push(1) });
  p.steer = () => { throw new Error('bad steer'); };
  h.step(1);
  assert.equal(h.b.projectiles.list.includes(p), false, 'it arrived (a throwing steer must not leak it for maxAge)');
  assert.equal(hits.length, 1);
  assert.equal(h.b.errors.length, 1);
  assert.equal(h.b.errors[0].label, 'projectile.steer');
  assert.match(h.b.errors[0].message, /bad steer/);
  h.step(5);
  assert.equal(h.b.errors.length, 1, 'reported once per message, not once per step');
  assert.equal(h.b.errorCount, 1);
  checkInvariants(h.b);
});

test('a non-boolean steer keeps the projectile alive; maxAge stays the system\'s own fuse', () => {
  const h = field();
  const hits = [];
  let n = 0;
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 9, y: 10 }, speed: 1, maxAge: 0.5, onHit: () => hits.push(1) });
  p.steer = () => { n++; return undefined; };            // undefined = "not done" (never true)
  h.step(20);                                            // 0.67 s > maxAge
  assert.ok(n > 0, 'it was steered every step until the fuse blew');
  assert.equal(h.b.projectiles.list.includes(p), false, 'maxAge still retires it');
  assert.equal(hits.length, 1);
  checkInvariants(h.b);
});

test('without a steer the projectile keeps its own straight-line flight (the hook is opt-in)', () => {
  const h = field();
  const hits = [];
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 6, y: 10 }, speed: 4, onHit: () => hits.push(1) });
  assert.equal(p.steer, null);
  h.step(8);                                             // 8 × TICK × 4 tiles/s > the 1-tile leg
  assert.ok(Math.abs(p.x - 6) < 1e-9, `arrived on the straight leg (x=${p.x})`);
  assert.equal(hits.length, 1);
  checkInvariants(h.b);
});

test('a non-function steer is ignored: the projectile flies its own leg', () => {
  const h = field();
  const hits = [];
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 6, y: 10 }, speed: 4, steer: 'nope', onHit: () => hits.push(1) });
  assert.equal(p.steer, null);
  h.step(8);
  assert.ok(Math.abs(p.x - 6) < 1e-9);
  assert.equal(hits.length, 1);
  checkInvariants(h.b);
});

test('a homing steer still leaves every other projectile alone (one hook, one projectile)', () => {
  const h = field();
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.step();
  const steered = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 15, y: 10 }, speed: 1, onHit: () => {} });
  steered.steer = (q, dt) => { q.y += 2 * dt; return false; };
  const plain = h.b.addProjectile({ from: { x: 5, y: 12 }, target: e, speed: 4, onHit: () => {} });
  h.step(5);
  assert.ok(Math.abs(steered.x - 5) < 1e-9, 'the steered one never used tx');
  assert.ok(plain.x > 5, 'the plain one homed on the target as usual');
  checkInvariants(h.b);
});
