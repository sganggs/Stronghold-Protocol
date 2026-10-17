// A content-owned projectile (addProjectile with a `visual`) reports its own impact as the `projhit` event, so the
// client can play that kind's impact sound instead of borrowing the target's `hit` cue. A plain projectile reports none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const op = chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 1, blockCnt: 2 }, skill: null });

const field = () => makeBattle({
  defs: { chess: { t_guard: op }, enemies: { enemy_w: enemyRec({ key: 'enemy_w', hp: 1e6, speed: 1 }) } },
  units: [{ chessId: 't_guard', row: 9, col: 3 }],
  enemies: [{ key: 'enemy_w', count: 1, pos: [9, 8] }],
  content: 'none',
});

test('projhit: one event per landed content projectile, none for a plain one', () => {
  const h = field();
  const b = h.b;
  const hits = [];
  b.addProjectile({ from: { x: 1, y: 9 }, to: { x: 3, y: 9 }, speed: 120, visual: 'orb', hitSound: true, onHit: (ctx) => hits.push(ctx.x) });
  b.addProjectile({ from: { x: 1, y: 9 }, to: { x: 3, y: 9 }, speed: 120, onHit: () => {} });
  for (let i = 0; i < 60 && b.projectiles.list.length; i++) b.step();
  assert.equal(hits.length, 1, 'the content projectile landed once');
  const events = b.drainEvents().filter((e) => e[0] === 'projhit');
  assert.equal(events.length, 1, 'exactly one projhit — the plain projectile reports nothing');
  assert.equal(events[0][2], 'orb');
  assert.equal(typeof events[0][1], 'number', 'the projectile id travels with the event');
});

test('projhit: a projectile that fizzles reports no impact', () => {
  const h = field();
  const b = h.b;
  b.addProjectile({ from: { x: 1, y: 9 }, to: { x: 20, y: 9 }, speed: 1, visual: 'orb', maxAge: 0.05 });
  for (let i = 0; i < 20 && b.projectiles.list.length; i++) b.step();
  b.drainEvents();
  const later = b.drainEvents().filter((e) => e[0] === 'projhit');
  assert.equal(later.length, 0);
});
