// The content-owned projectile channel (`snap.proj`, docs/SIM.md §9). A projectile whose `visual` is something other
// than the sim's default 'arrow' is not drawn by the attack fx, so the renderer needs the projectile itself: one
// `[id, x, y, visual]` tuple per live projectile, with its own hit-test position — it is what a content pack aims with,
// and where the damage lands. Everything else stays off the wire (the ordinary arrow is the attack fx's job), and the
// channel is capped so a flood of aura projectiles cannot grow the snapshot without bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const OP = chessRec({ id: 'op', profession: 'SNIPER', skill: null, rangeGrid: [[0, 0]], stats: { atk: 1, bat: 1, blockCnt: 0, def: 0 } });
const WALKER = enemyRec({ key: 'walker', hp: 1e7, atk: 0, speed: 0 });

function harness() {
  return makeBattle({
    autoFinish: false, timeLimit: 60,
    defs: { chess: { op: OP }, enemies: { walker: WALKER } },
    units: [], enemies: [],
  });
}

/** Shoots from a fixed point; `visual` undefined = the addProjectile default ('arrow'). */
function fire(b, visual, extra = {}) {
  return b.addProjectile({
    from: { x: 3.2, y: 4.1 }, to: { x: 9.5, y: 4.1 }, speed: 2, onHit() {},
    ...(visual === undefined ? {} : { visual }),
    ...extra,
  });
}

test('snap.proj carries the content-owned projectiles only: not the plain arrow, not an empty key', () => {
  const h = harness();
  h.step();
  assert.equal(h.snapshot().proj, undefined, 'nothing to stream before a pack fires');
  const note = fire(h.b, 'note');
  fire(h.b);        // the sim's default visual
  fire(h.b, 'arrow');
  fire(h.b, '');    // an empty key is not a visual
  const snap = h.snapshot();
  assert.equal(snap.proj.length, 1);
  const [id, x, y, visual] = snap.proj[0];
  assert.equal(id, note.id, 'its stable id');
  assert.equal(visual, 'note');
  assert.ok(Math.abs(x - 3.2) < 1e-6 && Math.abs(y - 4.1) < 1e-6, "its own position, not the launcher's tile");
});

test('the streamed position is the projectile\'s flight position, frame by frame', () => {
  const h = harness();
  h.step();
  const p = fire(h.b, 'note');
  const x0 = p.x;              // the projectile object is live: read its launch position first
  h.step(6);
  const [, x] = h.snapshot().proj[0];
  assert.ok(x - x0 > 1e-6, `it flies on from its launch point (${x0} → ${x})`);
  assert.ok(x - x0 < 0.5, 'one snapshot interval of flight');
});

test('the channel is capped and drops nothing else: the plain arrows never take a slot', () => {
  const h = harness();
  h.step();
  for (let i = 0; i < 40; i++) fire(h.b);              // 40 plain arrows
  for (let i = 0; i < 70; i++) fire(h.b, `v${i}`);     // 70 content projectiles
  const snap = h.snapshot();
  assert.equal(snap.proj.length, 64, 'capped at PROJ_SNAPSHOT_MAX');
  // the cap keeps the NEWEST ones — the ones a player is looking at — and lists them newest first
  assert.equal(snap.proj[0][3], 'v69', 'the newest is first');
  assert.equal(snap.proj[63][3], 'v6', 'the 64 newest, so v0..v5 fell off');
  assert.ok(!snap.proj.some(([, , , v]) => v === 'arrow'), 'plain arrows never take a slot');
});
