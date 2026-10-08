// test/sim/snapshot-outlets.test.js — the two snapshot outlets of server/sim/battle/events.js `snapshot()`:
//
//   proj  [[id, x, y, kind]] — CONTENT-OWNED projectiles. A projectile a kit adds itself has no attack to hang a visual
//         on: the engine only reports a projectile through the 'atk' event of the attack that fired it, and a kit's own
//         projectile is fired by the kit. One whose flight the kit owns as well (projectiles.js `steer`) has no target
//         view to home on either. So the sim publishes the positions of the projectiles whose `visual` is not one of the
//         engine's own, and the client draws one sprite per id from this list. `kind` is the `visual` (the client picks
//         its sprite by it), or `data.hitTag` when the kit sets one — a kit telling two of its own kinds apart under one
//         visual picks the client's entry by that tag. The sim's position stays authoritative.
//   fever [[id, pct]] — a gauge a KIT keeps on `unit.mem.gauges.fever` (0..100), forwarded so the client can show it.
//         Deliberately generic — the engine does not know what the gauge means, it only forwards what the kit wrote;
//         `unit.mem` is the kit's own space and a unit whose kit wrote nothing is published nowhere.
//
// Both fields are present only when non-empty, so an old client / a replay of a battle without them sees exactly what it
// saw before. The engine-side contract is asserted here with synthetic content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, ...o });
const wall = () => chessRec({ id: 't_wall', stats: { atk: 0, maxHp: 1e6, blockCnt: 0 }, skill: null });

function field(o = {}) {
  return makeBattle({
    seed: 7, autoFinish: false, timeLimit: 60, content: 'none',
    defs: { chess: { t_wall: wall() }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_wall', row: 10, col: 4 }],
    ...o,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// snap.proj

test('snap.proj: absent with nothing to publish, [id, x, y, visual] for a content projectile, never an engine one', () => {
  const h = field();
  h.step();
  assert.equal(h.b.snapshot().proj, undefined, 'the field is not in the snapshot at all when empty');
  // every projectile the ENGINE draws itself is left to its own 'atk' event
  const engine = ['arrow', 'bolt', 'bomb', 'lob', 'orb', 'drone', 'boomerang', 'boomerangReturn', 'beam', 'none']
    .map((visual, i) => h.b.addProjectile({ from: { x: 5, y: 10 + i }, to: { x: 20, y: 10 + i }, speed: 4, visual }));
  h.step();
  assert.equal(h.b.snapshot().proj, undefined, 'no engine visual is published');
  assert.equal(engine[0].steer, null);
  // …a content-owned one is
  const note = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note' });
  h.step();
  const proj = h.b.snapshot().proj;
  assert.equal(proj.length, 1);
  assert.deepEqual(proj[0].slice(0, 1), [note.id], 'the projectile id is the key the client maintains its sprites by');
  assert.equal(proj[0][3], 'note', 'without a data.hitTag the visual itself is the kind');
  checkInvariants(h.b);
});

test('snap.proj carries the sim\'s authoritative position (2 decimals) and data.hitTag as the kind', () => {
  const h = field();
  h.step();
  const a = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note', data: { hitTag: 'talent' } });
  const b = h.b.addProjectile({ from: { x: 6, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note', data: { hitTag: 'skill' } });
  a.x = 7.123456; a.y = 10.987654;
  const proj = h.b.snapshot().proj;
  assert.deepEqual(proj, [[a.id, 7.12, 10.99, 'talent'], [b.id, 6, 10, 'skill']],
    'the sim\'s own positions, rounded to 2 decimals; a kit\'s own kinds are told apart by data.hitTag');
  checkInvariants(h.b);
});

test('snap.proj: a content projectile that moved is followed, and a snapshot does not disturb the flight', () => {
  const h = field();
  h.step();
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note' });
  h.step(5);
  assert.equal(h.b.snapshot().proj[0][1], 5.67, 'it moved (5 × 1/30 s × 4 tiles/s)');
  h.b.projectiles.list.length = 0;
  assert.equal(h.b.snapshot().proj, undefined, 'a landed projectile is simply absent from the next snapshot');
  checkInvariants(h.b);
});

test('snap.proj: a projectile with no visual of its own is not published (the outlet is opt-in per visual)', () => {
  const h = field();
  h.step();
  h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'none' });
  h.b.addProjectile({ from: { x: 5, y: 11 }, to: { x: 20, y: 11 }, speed: 4, visual: undefined });
  h.step();
  assert.equal(h.b.snapshot().proj, undefined);
  checkInvariants(h.b);
});

test('snap.proj: a non-finite position is skipped rather than published as null', () => {
  const h = field();
  const p = h.b.addProjectile({ from: { x: 5, y: 10 }, to: { x: 20, y: 10 }, speed: 4, visual: 'note' });
  // the system validates `from` and its own move always yields a finite point, so this only happens if a content
  // `steer` writes one — the outlet must not hand the client a null then (the invariant below is checked on a clean
  // field: `p.x = NaN` itself is what checkInvariants exists to catch)
  p.x = NaN;
  assert.equal(h.b.snapshot().proj, undefined, 'the client is never told a position it cannot draw');
  p.x = 5;
  assert.deepEqual(h.b.snapshot().proj, [[p.id, 5, 10, 'note']]);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// snap.fever

test('snap.fever: absent without a kit gauge, forwarded as [[id, pct]] — the engine does not know the gauge', () => {
  const h = field();
  const u = h.unit('t_wall');
  h.step();
  assert.equal(h.b.snapshot().fever, undefined, 'no kit wrote a gauge');
  u.mem.gauges = { fever: 42 };
  assert.deepEqual(h.b.snapshot().fever, [[u.id, 42]], 'a gauge a kit keeps on mem.gauges.fever is forwarded');
  // the engine only FORWARDS: it rounds and clamps, it does not invent or scale a value (a kit whose own gauge runs on
  // another scale writes the 0–100 share it wants shown)
  u.mem.gauges.fever = 99.6;
  assert.deepEqual(h.b.snapshot().fever[0], [u.id, 100]);
  u.mem.gauges.fever = -5;
  assert.deepEqual(h.b.snapshot().fever[0], [u.id, 0]);
  u.mem.gauges.fever = NaN;
  assert.equal(h.b.snapshot().fever, undefined, 'a non-finite gauge is not published');
  delete u.mem.gauges.fever;
  assert.equal(h.b.snapshot().fever, undefined);
  checkInvariants(h.b);
});

test('snap.fever: one entry per LIVE visible unit — a gauge of an undeployed or dead unit is not sent', () => {
  const h = field();
  const u = h.unit('t_wall');
  h.step();
  u.mem.gauges = { fever: 10 };
  assert.equal(h.b.snapshot().fever.length, 1);
  h.b.kill(u);                                   // knocked out: its badge must not be drawn any more
  assert.equal(h.b.snapshot().fever, undefined);
  checkInvariants(h.b);
});

test('snap.fever: a gauge of an ENEMY is forwarded too — the outlet is generic, not operator-specific', () => {
  const h = field();
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.unit('t_wall').mem.gauges = { fever: 30 };
  e.mem.gauges = { fever: 70 };
  assert.deepEqual(h.b.snapshot().fever, [[h.unit('t_wall').id, 30], [e.id, 70]]);
  checkInvariants(h.b);
});

test('both outlets are absent from a plain battle: an untouched field snapshots exactly what it did before', () => {
  const h = field({ enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  h.run(3);
  const snap = h.b.snapshot();
  assert.deepEqual(Object.keys(snap).sort(), ['dp', 'fieldId', 'killed', 't', 'total', 'units']);
  checkInvariants(h.b);
});
