// Sim core: rng, grid/pathing, damage formulas, stat aggregation, buffs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../server/sim/rng.js';
import { Grid } from '../../server/sim/grid.js';
import { mitigate } from '../../server/sim/damage.js';
import { Unit } from '../../server/sim/units.js';
import { getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { makeBattle, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('rng is deterministic and in [0,1)', () => {
  const a = createRng(123), b = createRng(123), c = createRng(124);
  const xs = Array.from({ length: 50 }, () => a());
  const ys = Array.from({ length: 50 }, () => b());
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, Array.from({ length: 50 }, () => c()));
  for (const x of xs) assert.ok(x >= 0 && x < 1);
  const r = createRng(5);
  for (let i = 0; i < 200; i++) { const v = r.int(7); assert.ok(Number.isInteger(v) && v >= 0 && v < 7); }
});

test('user: Given an advanced RNG, When a preview clones it, Then both streams continue independently from the same position', () => {
  for (const seed of [123, 0x100000000 - 0x6d2b79f5]) {
    const live = createRng(seed);
    live();
    const state = live.state();
    const preview = live.clone();
    assert.equal(preview.state(), state);
    const expected = Array.from({ length: 10 }, () => preview());
    assert.equal(live.state(), state, 'preview draws do not advance the live stream');
    assert.deepEqual(Array.from({ length: 10 }, () => live()), expected);
  }
});

test('grid: 8-dir A* without corner cutting matches helper path lengths on real stages', () => {
  const ds = getDefaultSource();
  for (const id of ['act2autochess_m01', 'act2autochess_m02', 'act1autochess_m03']) {
    const st = ds.getStage(id);
    const g = new Grid(st, { r0: 9, r1: 12, c0: 0, c1: 10 });
    const helper = st.raw.groundPaths?.['9,10->9,2'] ?? st.raw.groundPathsHelper?.paths?.['9,10->9,2'];
    const p = g.findPath(9, 10, 9, 2);
    assert.ok(p, `path on ${id}`);
    assert.deepEqual(p[0], [9, 10]);
    assert.deepEqual(p[p.length - 1], [9, 2]);
    if (helper) approx(Grid.pathLength(p), Grid.pathLength(helper), 1e-6);
    // no corner cutting: every diagonal step has both orthogonals passable
    for (let i = 1; i < p.length; i++) {
      const [r0, c0] = p[i - 1], [r1, c1] = p[i];
      assert.ok(Math.abs(r1 - r0) <= 1 && Math.abs(c1 - c0) <= 1);
      if (r1 !== r0 && c1 !== c0) {
        assert.ok(g.groundPassable(r0, c1) || (r0 === 9 && c1 === 2));
        assert.ok(g.groundPassable(r1, c0) || (r1 === 9 && c0 === 2));
      }
    }
  }
});

test('grid: obstacles re-route and bump version; blocked entirely ⇒ null unless ignoreObstacles', () => {
  const g = new Grid(flatStage(), { r0: 9, r1: 12, c0: 0, c1: 10 });
  const direct = g.findPath(9, 10, 9, 2);
  assert.equal(direct.length, 9);
  const v0 = g.version;
  g.setObstacle(9, 6, true);
  assert.ok(g.version > v0);
  const around = g.findPath(9, 10, 9, 2);
  assert.ok(!around.some(([r, c]) => r === 9 && c === 6));
  for (let r = 9; r <= 12; r++) g.setObstacle(r, 6, true);
  assert.equal(g.findPath(9, 10, 9, 2), null);
  assert.ok(g.findPath(9, 10, 9, 2, { ignoreObstacles: true }));
});

test('damage formulas: phys/arts/true, ignore, 5% floor', () => {
  approx(mitigate(1000, 'phys', { def: 300 }), 700);
  approx(mitigate(1000, 'phys', { def: 2000 }), 50);
  approx(mitigate(1000, 'phys', { def: 300 }, { defIgnorePct: 0.5, defIgnoreFlat: 50 }), 900);
  approx(mitigate(1000, 'arts', { res: 30 }), 700);
  approx(mitigate(1000, 'arts', { res: 100 }), 50);
  approx(mitigate(1000, 'arts', { res: 40 }, { resIgnorePct: 0.5, resIgnoreFlat: 10 }), 900);
  approx(mitigate(1000, 'true', { def: 9999, res: 100 }), 1000);
});

test('dealDamage applies multipliers, shields and records stats', () => {
  const h = makeBattle({
    defs: { chess: { t_a: chessRec({ id: 't_a', stats: { atk: 1000 } }) }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, def: 200, res: 50, speed: 0 }) } },
    units: [{ chessId: 't_a', row: 9, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }],
    content: 'none',
  });
  h.step();
  const op = h.unit('t_a');
  const e = h.enemy('enemy_dummy');
  op.markDirty();
  h.b.addBuff(op, { key: 'dd', mods: { dmgDealtMul: 1.5 } });
  h.b.addBuff(e, { key: 'fr', mods: { dmgTakenMul: 1.2, artsTakenMul: 2 } });
  const hp0 = e.hp;
  const d1 = h.b.dealDamage(op, e, { amount: 1000, type: 'phys' });
  approx(d1, (1000 - 200) * 1.5 * 1.2);
  const d2 = h.b.dealDamage(op, e, { amount: 1000, type: 'arts' });
  approx(d2, 1000 * 0.5 * 1.5 * 1.2 * 2);
  approx(e.hp, hp0 - d1 - d2);
  // shield absorbs
  h.b.addBuff(e, { key: 'sh', shield: 500 });
  const d3 = h.b.dealDamage(null, e, { amount: 300, type: 'true' });
  assert.equal(d3, 0);
  const d4 = h.b.dealDamage(null, e, { amount: 300, type: 'true' });
  approx(d4, 360 - (500 - 360)); // 300×1.2 per hit; the shield absorbed 360 of 500 on the first hit
  assert.equal(e.findBuff('sh'), null, 'depleted shield removed');
  // hit-negating barrier
  h.b.addBuff(e, { key: 'barrier', shieldHits: 1 });
  assert.equal(h.b.dealDamage(null, e, { amount: 5000, type: 'true' }), 0);
  assert.ok(h.b.dealDamage(null, e, { amount: 10, type: 'true' }) > 0);
  assert.ok(op.stats.dmg > 0);
  assert.ok(h.result().perPlayer.p1.damageDealt >= d1 + d2);
});

test('dodge uses the seeded rng and is deterministic', () => {
  const run = (seed) => {
    const h = makeBattle({ seed, defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } }, enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none' });
    h.step();
    const e = h.enemy('enemy_dummy');
    h.b.addBuff(e, { key: 'dodge', mods: { dodgePhys: 0.5 } });
    let hits = 0;
    for (let i = 0; i < 400; i++) if (h.b.dealDamage(null, e, { amount: 100, type: 'phys' }) > 0) hits++;
    assert.equal(h.b.dealDamage(null, e, { amount: 100, type: 'phys', canDodge: false }) > 0, true);
    return hits;
  };
  const a = run(9);
  assert.equal(a, run(9));
  assert.ok(a > 150 && a < 250, `~50% hits (${a})`);
});

test('stat aggregation: (base+flat)(1+pct)Πmul, res clamp, aspd clamp, interval, HP ratio kept', () => {
  const u = new Unit({ id: 1, side: 'ally', kind: 'op', base: { maxHp: 1000, atk: 100, def: 50, res: 20, aspd: 100, bat: 1.2 } });
  u.alive = true;
  u.hp = 500;
  u.buffs.push({ key: 'a', stacks: 1, mods: { atkFlat: 50, atkPct: 0.5, atkMul: 1.2, hpPct: 1, resFlat: 200, aspd: 30, batPct: -0.25 } });
  u.buffs.push({ key: 'b', stacks: 2, mods: { atkPct: 0.1, atkMul: 1.1 } });
  u.markDirty();
  const s = u.s;
  approx(s.atk, (100 + 50) * (1 + 0.5 + 0.2) * 1.2 * 1.1 * 1.1);
  assert.equal(s.res, 100);
  assert.equal(s.aspd, 130);
  approx(s.interval, 1.2 * 0.75 * 100 / 130);
  approx(s.maxHp, 2000);
  approx(u.hp, 1000, 1e-6);
  u.buffs.push({ key: 'c', stacks: 1, mods: { aspd: -500 } });
  u.markDirty();
  assert.equal(u.s.aspd, 20, 'ASPD floor 20 (PRTS 数值范围)');
});

test('buffs: replace / extend / stack / independent / keep, expiry and onExpire', () => {
  const h = makeBattle({ defs: { chess: { t_a: chessRec({ id: 't_a' }) } }, units: [{ chessId: 't_a', row: 9, col: 3 }], content: 'none' });
  h.step();
  const u = h.unit('t_a');
  const b = h.b;
  b.addBuff(u, { key: 'r', duration: 2, mods: { atkPct: 0.1 } });
  b.addBuff(u, { key: 'r', duration: 1, mods: { atkPct: 0.3 } });
  assert.equal(u.buffs.filter((x) => x.key === 'r').length, 1);
  approx(u.findBuff('r').timeLeft, 1);
  b.addBuff(u, { key: 'e', duration: 5, refresh: 'extend', mods: { defPct: 0.1 } });
  b.addBuff(u, { key: 'e', duration: 2, refresh: 'extend', mods: { defPct: 0.2 } });
  approx(u.findBuff('e').timeLeft, 5);
  assert.equal(u.findBuff('e').mods.defPct, 0.2);
  for (let i = 0; i < 5; i++) b.addBuff(u, { key: 's', duration: 3, refresh: 'stack', maxStacks: 3, mods: { aspd: 10 } });
  assert.equal(u.findBuff('s').stacks, 3);
  assert.equal(u.s.aspd, 130);
  for (let i = 0; i < 4; i++) b.addBuff(u, { key: 'i', duration: 1 + i, refresh: 'independent', maxStacks: 3, mods: { atkFlat: 1 } });
  assert.equal(u.buffs.filter((x) => x.key === 'i').length, 3);
  b.addBuff(u, { key: 'k', duration: 1, refresh: 'keep', mods: { atkFlat: 5 } });
  b.addBuff(u, { key: 'k', duration: 9, refresh: 'keep', mods: { atkFlat: 50 } });
  assert.equal(u.findBuff('k').mods.atkFlat, 5);
  let expired = 0;
  b.addBuff(u, { key: 'x', duration: 0.5, onExpire: () => expired++ });
  h.run(0.6);
  assert.equal(expired, 1);
  assert.equal(u.findBuff('x'), null);
  assert.ok(u.findBuff('r'), '1 s buff still alive at 0.6 s');
  h.run(3);
  assert.equal(u.findBuff('r'), null, '1 s buff expired');
  assert.equal(u.findBuff('s'), null);
  assert.ok(u.findBuff('e'));
  // interval ticks
  let ticks = 0;
  b.addBuff(u, { key: 'dot', duration: 3, interval: 1, onTick: () => ticks++ });
  h.run(3.05);
  assert.equal(ticks, 3);
});

test('persistent buffs survive death; others are cleared', () => {
  const h = makeBattle({ defs: { chess: { t_a: chessRec({ id: 't_a', stats: { respawnTime: 1, cost: 0 } }) } }, units: [{ chessId: 't_a', row: 9, col: 3 }], content: 'none' });
  h.step();
  const u = h.unit('t_a');
  h.b.addBuff(u, { key: 'keepme', persist: true, mods: { atkPct: 1 } });
  h.b.addBuff(u, { key: 'loseme', mods: { atkPct: 1 } });
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false);
  assert.ok(u.findBuff('keepme'));
  assert.equal(u.findBuff('loseme'), null);
  h.run(1.5);
  assert.equal(u.alive, true, 'redeployed');
  approx(u.s.atk, 500 * 2);
});

test('simdata normalises real chess, enemy, token, stage and routes', () => {
  assert.ok(hasGeneratedData(), 'tests run against the generated data/*.json');
  const ds = getDefaultSource();
  const c = ds.getChess('chess_char_1_01_a');
  assert.equal(c.subProf, 'fastshot');
  assert.ok(c.skill && c.skill.spCost > 0);
  assert.ok(c.rangeGrid.length > 3);
  const e = ds.getEnemy('enemy_1427_lrnazg');
  assert.ok(e.maxHp > 0 && e.rangeRadius > 0);
  const e2 = ds.getEnemy('1427_lrnazg');
  assert.equal(e2.key, 'enemy_1427_lrnazg');
  const st = ds.getStage('act2autochess_m01');
  assert.equal(st.rows.length, 19);
  assert.equal(st.rows[9][2], 'E');
});
