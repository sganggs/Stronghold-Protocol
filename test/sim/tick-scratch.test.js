// The tick hot path's scratch buffers and lazy reads: every one of them must be invisible to the simulation. These
// tests pin the ways a "reuse instead of allocate" change can leak into behaviour — a property read moved earlier
// (stats aggregation re-applies the HP ratio), a snapshot that keeps a removed hook alive, a timer buffer that a
// nested run clobbers, a buff buffer that skips or double-ticks, a targeting flag written on the live profile, and
// buffers that keep dropped objects reachable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { noteAttackCommit, acquireTargets } from '../../server/sim/ai.js';

const R3 = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3]];
const mk = (sub, profession, o = {}) => chessRec({
  id: 't_' + sub, profession, subProfessionId: sub, skill: null, rangeGrid: R3, stats: { atk: 100, bat: 1, ...(o.stats || {}) }, ...o,
});
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0, ...o });

/** A field with one operator and no enemies, already stepped once so the unit is deployed. */
function field(chess, o = {}) {
  const id = Object.keys(chess)[0];
  const h = makeBattle({ defs: { chess, enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 9, col: 5 }],
    enemies: o.enemies ?? [], content: 'none', autoFinish: false, timeLimit: o.timeLimit ?? 30 });
  h.step();
  return h;
}

test('isFlying does not aggregate the stats of our units (the re-apply of the HP ratio must stay where the sim did it)', () => {
  const h = field({ t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { maxHp: 1000, atk: 100, blockCnt: 1 }, skill: null }) });
  const u = h.unit('t_guard');
  h.b.addBuff(u, { key: 'hp', mods: { hpMul: 2 } });
  u._dirty = true; // a buff was added; the sim has not asked for the aggregated stats yet
  const hp0 = u.hp;

  assert.equal(u.isFlying, false);
  assert.equal(u._dirty, true, 'the stats were not aggregated');
  assert.equal(u.hp, hp0, 'and the HP ratio was not re-applied');

  void u.s; // the first real read still applies it, exactly as before
  assert.equal(u.hp, hp0 * 2);
  assert.equal(u._dirty, false);
});

test('flying state follows the flags and `motion` both ways and is invalidated by a fresh stats object', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { maxHp: 1e6, atk: 100, blockCnt: 1 }, skill: null }) },
      enemies: { enemy_ground: enemyRec({ key: 'enemy_ground', hp: 1e6, speed: 0 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], enemies: [{ key: 'enemy_ground', pos: [9, 7] }], content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_ground');
  const guard = h.unit('t_guard');
  assert.equal(e.isFlying, false);
  h.b.addBuff(e, { key: 'float', flags: { float: true } });
  assert.equal(e.isFlying, true, 'a fresh stats object invalidates the cached answer');
  h.b.removeBuff(e, 'float');
  assert.equal(e.isFlying, false);
  h.b.addBuff(e, { key: 'groundbind', flags: { groundbind: true } });
  h.b.addBuff(e, { key: 'float2', flags: { float: true } });
  assert.equal(e.isFlying, false, 'groundbind wins over float');
  h.b.addBuff(e, { key: 'levitate', flags: { levitate: true } });
  assert.equal(e.isFlying, true, 'levitate wins over groundbind');
  // a unit of ours answers from `motion` alone
  assert.equal(guard.isFlying, false);
  guard.motion = 'FLY';
  assert.equal(guard.isFlying, true);
  guard.motion = 'GROUND';
  assert.equal(guard.isFlying, false);
});

test('hooks see a snapshot: a nested emit keeps its own frame, and a hook removed during the emit does not run', () => {
  const h = field({ t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { maxHp: 1e6, atk: 100, blockCnt: 1 }, skill: null }) });
  const b = h.b;
  const order = [];
  let depth = 0;
  b.on('hit', (ctx) => { order.push('a' + (ctx.nested ? '!' : '')); if (depth++ < 2) b.emit('hit', { nested: true }); });
  b.on('hit', (ctx) => { order.push(ctx.nested ? 'b!' : 'b'); });
  b.emit('hit', {});
  assert.deepEqual(order, ['a', 'a!', 'a!', 'b!', 'b!', 'b'], 'each nesting level runs its own snapshot, outer frame last');

  const ran = [];
  let victim = null;
  b.on('hit', () => { ran.push('remover'); b.off(victim); });
  victim = b.on('hit', () => { ran.push('victim'); });
  b.emit('hit', {});
  assert.deepEqual(ran, ['remover'], 'the removed hook is skipped by the running snapshot');
  ran.length = 0;
  b.emit('hit', {});
  assert.deepEqual(ran, ['remover'], 'and stays gone afterwards');
});

test('scheduled timers: cancelling and adding one from inside a callback keeps the tick list consistent', () => {
  const h = field({ t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { maxHp: 1e6, atk: 100, blockCnt: 1 }, skill: null }) });
  const b = h.b;
  let slow = 0, fast = 0, late = 0;
  const slowTimer = b.every(0.2, () => { slow++; });
  let switched = false;
  b.every(0.05, () => {
    fast++;
    if (!switched && b.time > 0.3) { switched = true; slowTimer.cancel(); b.after(0.05, () => { late++; }); }
  });
  h.run(1.2);
  assert.ok(fast >= 10, `the fast timer kept running (${fast})`);
  assert.ok(slow <= 2, `the cancelled timer stopped (${slow})`);
  assert.equal(late, 1, 'the timer added mid-tick ran exactly once');
  assert.equal(b._sched.filter((s) => s.cancelled).length, 0, 'no cancelled timer is left in the list');
});

test('a buff that adds and removes buffs from its own onTick neither skips nor double-ticks the queue', () => {
  const h = field({ t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { maxHp: 1e6, atk: 100, blockCnt: 1 }, skill: null }) });
  const b = h.b;
  const u = h.unit('t_guard');
  const seen = [];
  b.addBuff(u, {
    key: 'a', interval: 0.1,
    onTick: ({ battle, unit }) => {
      seen.push('a');
      battle.addBuff(unit, { key: 'b', interval: 0.1, onTick: () => seen.push('b') });
      battle.removeBuff(unit, 'a');
    },
  });
  h.run(0.6);
  assert.equal(seen[0], 'a');
  assert.ok(seen.filter((x) => x === 'a').length <= 2, 'the removed buff did not tick again');
  assert.ok(seen.filter((x) => x === 'b').length >= 3, 'the buff added during the tick runs on later ticks');
  assert.equal(u.buffs.some((x) => x.key === 'a'), false);
});

test('the fortress melee switch of the committed search never lands on the live profile', () => {
  const fort = mk('fortress', 'TANK', { attackKind: 'ranged', projectile: 'arrow', stats: { maxHp: 1e6, atk: 100, blockCnt: 3 } });
  const h = makeBattle({
    defs: { chess: { t_fortress: fort }, enemies: { enemy_dummy: dummy({ hp: 1e5 }) } },
    units: [{ chessId: 't_fortress', row: 9, col: 5 }], enemies: [], content: 'none', autoFinish: false,
  });
  h.step();
  const u = h.unit('t_fortress');
  const prof = u.profile;
  delete prof._fortressMelee; // the step's own attack search had written it; start from a clean profile
  assert.equal(Object.prototype.hasOwnProperty.call(prof, '_fortressMelee'), false);

  const scratch = { fortressMelee: false };
  u.blocking.push({ blockWeight: 1, alive: true }); // a blocked enemy makes the answer "melee"
  acquireTargets(h.b, u, prof, scratch);
  assert.equal(Object.prototype.hasOwnProperty.call(prof, '_fortressMelee'), false, 'the profile is untouched');
  assert.equal(scratch.fortressMelee, true, 'the answer came back in the scratch object');

  u.atkCd = 0; // ready this tick, so the pre-move snapshot really searches
  if (u.trait) u.trait.hadTarget = null;
  h.b._attackCommit = null;
  noteAttackCommit(h.b, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(prof, '_fortressMelee'), false, 'and the pre-move snapshot leaves it alone too');
});

test('the scratch buffers are emptied after a tick: nothing the sim dropped stays reachable', () => {
  const h = field({ t_guard: chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { maxHp: 1e6, atk: 100, blockCnt: 1 }, skill: null }) });
  const b = h.b;
  b.addBuff(h.unit('t_guard'), { key: 'scratch_probe', mods: { atkMul: 1 } });
  b.on('hit', () => {});
  b.emit('hit', {});
  b.every(0.01, () => {}, { immediate: true });
  h.step();
  const bufs = { emit: b._emitBufs, buff: b._buffScratch, due: b._dueBufs };
  for (const [name, list] of Object.entries(bufs)) {
    assert.ok(Array.isArray(list) && list.every((a) => a.length === 0), `the ${name} buffer holds nothing after the tick`);
  }
});
