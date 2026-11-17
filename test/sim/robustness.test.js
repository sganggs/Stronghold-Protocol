// Robustness, determinism & performance regressions (adversarial review of the sim core). Every test here pins a
// defect that was reproduced before its fix: re-entrancy from hooks, garbage numbers reaching engine helpers,
// runaway content loops, unreachable route legs, listener leaks, and a heavy 2-player boss field.
//
// The boss-field speed bar (DESIGN §11) is 0.5 ms per tick on a development machine (≈ 0.07 ms alone, ≈ 0.2 ms inside
// the parallel full suite on the one it was tuned on) and 1.0 ms when process.env.CI is set: GitHub's shared windows
// runners measured 0.51–0.58 ms for the same work and failed the 0.5 ms bar on PR #10, PR #12, PR #14 and master's own
// push. The time is the best of three runs of the same battle (after two warm-up battles), so one noisy neighbour on a
// runner does not decide it; a real regression of the hot paths still shows locally against 0.5 ms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { createRng } from '../../server/sim/rng.js';
import { MAX_HOOK_DEPTH, MAX_ALIVE_ENEMIES } from '../../server/sim/constants.js';
import { getDefaultSource, spawnsFromTemplate } from '../../server/sim/simdata.js';
import { makeBattle, chessRec, enemyRec, flatStage, checkInvariants, hashOf } from '../helpers/battleHarness.js';

const quiet = { error() {}, warn() {}, info() {} };
const guard = (o = {}) => chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 300, blockCnt: 2 }, skill: null, ...o });
const sniper = (o = {}) => chessRec({
  id: 't_sniper', profession: 'SNIPER', skill: null,
  rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8]], ...o, stats: { atk: 400, blockCnt: 0, ...(o.stats || {}) },
});
const wideGrid = () => { const g = []; for (let dr = -1; dr <= 2; dr++) for (let dc = -1; dc <= 8; dc++) g.push([dr, dc]); return g; };
const walker = (o = {}) => enemyRec({ key: 'enemy_walker', hp: 1e6, speed: 1, ...o });
const hookCount = (b) => Object.values(b._hooks).reduce((a, l) => a + l.length, 0);

// ---------------------------------------------------------------------------------------------------------------
// lifecycle / re-entrancy

test('forceEnd from a hook mid-step: the step stops there and the result is never mutated afterwards', () => {
  const h = makeBattle({
    defs: { chess: { t_sniper: sniper({ stats: { atk: 5000 } }) }, enemies: { enemy_w: walker({ key: 'enemy_w', hp: 100 }) } },
    units: [{ chessId: 't_sniper', row: 9, col: 3 }, { chessId: 't_sniper', row: 9, col: 4 }, { chessId: 't_sniper', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_w', count: 6, pos: [9, 8] }], content: 'none',
    setup(b) { b.on('kill', () => b.forceEnd('forced'), { priority: 5 }); },
  });
  h.runToEnd(30);
  const r = h.result();
  assert.equal(r.reason, 'forced');
  assert.equal(r.killed, r.perPlayer.p1.killed, 'top-level and per-player kill counters agree');
  assert.equal(r.killed, 1, 'the in-flight kill completes, nothing after it');
  assert.equal(r.time, h.b.time, 'time does not advance past the forced end');
  const snap = JSON.stringify(r);
  h.b.step(); h.b.forceEnd('timeout');
  assert.equal(JSON.stringify(h.result()), snap, 'finished battles are frozen');
});

test('forceEnd from battleStart / deploy hooks and from a scheduled callback never throws', () => {
  for (const hook of ['battleStart', 'deploy']) {
    const h = makeBattle({ defs: { chess: { t_guard: guard() } }, units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'none',
      setup(b) { b.on(hook, () => b.forceEnd('timeout')); } });
    h.step();
    assert.equal(h.b.finished, true, hook);
    assert.equal(h.result().reason, 'timeout');
  }
  let late = 0;
  const h = makeBattle({ defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker' }], content: 'none',
    setup(b) { b.after(1, () => b.forceEnd('forced')); b.after(1.5, () => { late++; }); b.every(0.1, () => { if (b.time > 1.01) late++; }); } });
  h.run(10);
  assert.equal(h.result().reason, 'forced');
  assert.ok(h.b.time <= 1 + 1e-9, `ended at ${h.b.time}`);
  assert.equal(late, 0, 'no scheduled callback runs after the end');
});

test('step() called re-entrantly from a hook is a no-op', () => {
  let inner = 0;
  const h = makeBattle({ content: 'none', defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker' }],
    setup(b) { b.on('tick', () => { const t = b.tickCount; b.step(); if (b.tickCount !== t) inner++; }); } });
  h.step(30);
  assert.equal(inner, 0);
  assert.equal(h.b.tickCount, 30);
});

test('a flood of engine errors force-ends the battle as a timeout (never throws out of step)', () => {
  const h = makeBattle({ defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker', count: 20 }], content: 'none', timeLimit: 1000 });
  // sabotage: every enemy update throws (enemies steer by the grid's flow field — grid.js; findPath / waypoints too)
  for (const fn of ['flowField', 'waypoints', 'findPath']) h.b.grid[fn] = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => h.run(60));
  assert.equal(h.b.finished, true);
  assert.equal(h.result().reason, 'timeout');
  assert.ok(h.b.internalErrorCount > 200);
});

test('hook recursion is cut at MAX_HOOK_DEPTH deterministically (no stack overflow)', () => {
  const run = () => {
    const h = makeBattle({
      defs: { chess: { t_guard: guard() }, enemies: { enemy_walker: walker({ hp: 3000, atk: 100 }) } },
      units: [{ chessId: 't_guard', row: 9, col: 5 }], enemies: [{ key: 'enemy_walker' }], content: 'none', timeLimit: 30,
      setup(b) { b.on('damaged', (c) => { b.dealDamage(c.target, c.source ?? c.target, { amount: 0.1, type: 'true' }); }); },
    });
    h.runToEnd(40);
    return h;
  };
  const a = run(), b = run();
  assert.equal(a.b.finished, true);
  assert.equal(a.b.internalErrorCount ?? 0, 0, 'no internal error (stack overflow) reached the engine');
  assert.ok(a.b.errors.some((e) => e.label.startsWith('hookDepth:')), 'recursion reported as a content error');
  assert.equal(hashOf(a.events), hashOf(b.events), 'deterministic');
  assert.equal(a.b._emitDepth, 0);
  assert.ok(MAX_HOOK_DEPTH >= 16);
});

// Regression (matchrun solo FUNNY seed 17, "hookDepth: hit → fatal → damaged → kill → death"): 忍冬's 追凶 deals bonus
// damage from a `damaged` handler and skips its own 'vulpisHunt'-tagged damage; 频次 (hit-count) enemies used to cancel
// every hit and re-create it as a fresh loseHp(1) WITHOUT the original tags, so the talent re-triggered on its own
// bonus until the depth guard tripped — and the skipped kill/death handlers lost death spawns / bounties. Hit counting
// now happens inside the damage pipeline (flags hitCount / hitCountArts) on the original DamageInfo, and a loss derived
// from another damage passes `from` so it inherits its tags.
test('hit-count units keep the original DamageInfo: a self-excluding bonus-on-damaged handler never recurses', () => {
  const bonusHandler = (b, u) => b.on('damaged', (c) => {
    if (c.source !== u || c.target.side !== 'enemy' || (c.dmg?.tags || []).includes('bonus')) return;
    b.dealDamage(u, c.target, { amount: 1, type: 'arts', tags: ['bonus'] });
  }, { owner: u });
  const run = (mode) => {
    let deaths = 0;
    const h = makeBattle({
      defs: { chess: { t_guard: guard({ stats: { atk: 300, blockCnt: 2 } }) }, enemies: { enemy_h: walker({ key: 'enemy_h', hp: 6, speed: 0 }) } },
      units: [{ chessId: 't_guard', row: 9, col: 5 }], enemies: [{ key: 'enemy_h', pos: [9, 5] }], content: 'none', timeLimit: 30,
      setup(b) {
        b.on('battleStart', () => bonusHandler(b, b.allyUnits[0]));
        b.on('enemySpawn', ({ enemy }) => { if (mode === 'engine') b.addBuff(enemy, { key: 'times', flags: { hitCount: true }, persist: true }); });
        if (mode !== 'engine') {
          // the old content conversion: cancel the hit, re-create it as 1 HP loss (with / without `from`)
          b.on('hit', (c) => {
            if (c.target.side !== 'enemy') return;
            c.dmg.cancel = true;
            b.loseHp(c.target, 1, { source: c.source, from: mode === 'from' ? c.dmg : null });
          }, { priority: -500 });
        }
        b.on('death', ({ unit }) => { if (unit.side === 'enemy') deaths++; });
      },
    });
    h.runToEnd(30);
    return { h, deaths };
  };
  for (const mode of ['engine', 'from']) {
    const { h, deaths } = run(mode);
    assert.deepEqual(h.b.errors, [], `${mode}: no hookDepth errors`);
    assert.equal(h.result().reason, 'cleared', mode);
    assert.equal(deaths, 1, `${mode}: the death hook of the 频次 unit fired`);
    assert.equal(h.unit('t_guard').stats.attacks, 3, `${mode}: 6 hits = 3 attacks + 3 bonus instances`);
  }
  // the old pattern is exactly the reported cascade — and the guard's message names the looping frames
  const old = run('fresh');
  const depth = old.h.b.errors.filter((e) => e.label.startsWith('hookDepth:'));
  assert.ok(depth.length > 0, 'reproduces the cascade');
  assert.ok(depth.some((e) => /chain: .*damaged\(t_guard\).*hit\(t_guard→enemy_h\)/.test(e.message)), depth.map((e) => e.message).join('\n'));
  // engine hit counting: arts-only units ignore physical HP loss; accepted damage lowers HP by exactly 1
  const h = makeBattle({ defs: { enemies: { enemy_h: walker({ key: 'enemy_h', hp: 4, speed: 0, def: 0 }) } }, enemies: [{ key: 'enemy_h', pos: [9, 5] }], content: 'none', autoFinish: false });
  h.step();
  const e = h.enemy('enemy_h');
  h.b.addBuff(e, { key: 'times', flags: { hitCountArts: true } });
  assert.equal(h.b.dealDamage(null, e, { amount: 5000, type: 'phys' }), 0);
  assert.equal(h.b.dealDamage(null, e, { amount: 5000, type: 'arts' }), 1);
  assert.equal(h.b.dealDamage(null, e, { amount: 0.5, type: 'true' }), 1);
  assert.equal(e.hp, 2);
});

test('recursion through content callbacks (skill onEnd → activate → onEnd …) is cut by the same depth guard', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ skill: { duration: 0, spCost: 5, initSp: 5 } }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'generic', timeLimit: 5, hooks: [], // no hooks: recursion only via _safe
    kits: { t_guard: () => ({ skill: { kind: 'instant', trigger: 'SP_FULL', onEnd: ({ skill }) => { skill.activate('again', { free: true }); } } }) },
  });
  assert.doesNotThrow(() => h.run(2));
  assert.equal(h.b.internalErrorCount ?? 0, 0);
  assert.ok(h.b.errors.some((e) => e.label.startsWith('hookDepth:')));
  assert.equal(h.b._emitDepth, 0);
  checkInvariants(h.b);
});

test('a leak hook that spawns an instantly-leaking enemy cannot loop inside one tick', () => {
  const stage = { id: 'noend', rows: Array.from({ length: 19 }, () => 'r'.repeat(21)), devices: [] };
  const h = makeBattle({ stage, routes: [], defs: { enemies: { enemy_w: walker({ key: 'enemy_w' }) } }, enemies: [{ key: 'enemy_w' }], timeLimit: 5,
    setup(b) { b.on('enemyLeak', () => { b.spawnEnemy('enemy_w', {}); }); } });
  h.step(3);
  assert.ok(h.b.units.length <= 5, `bounded growth: ${h.b.units.length} units after 3 ticks`);
  h.runToEnd(10);
  assert.equal(h.b.finished, true);
});

test('runaway spawning is capped at MAX_ALIVE_ENEMIES living enemies (spawnEnemy returns null beyond)', () => {
  const h = makeBattle({ defs: { enemies: { enemy_w: walker({ key: 'enemy_w', speed: 0 }) } }, content: 'none', timeLimit: 5 });
  h.step();
  let last = null;
  for (let i = 0; i < MAX_ALIVE_ENEMIES + 5; i++) last = h.b.spawnEnemy('enemy_w', { pos: [10, 8] });
  assert.equal(last, null);
  assert.equal(h.b.aliveEnemies().length, MAX_ALIVE_ENEMIES);
  // bogus schedule sizes are capped too (Infinity / 1e9 would hang the constructor)
  const b = new Battle({ stage: flatStage(), kind: 'normal', logger: quiet, quiet: true, timeLimit: 1,
    spawns: [{ time: 0, enemyKey: 'enemy_1422_lrsldr', count: Infinity }, { time: 0, enemyKey: 'enemy_1422_lrsldr', count: 1e9 }, null, { time: Infinity, enemyKey: 'enemy_1422_lrsldr' }],
    players: [null, { playerId: 'p', units: [] }] });
  assert.ok(b._pending.length <= 2 * MAX_ALIVE_ENEMIES);
  assert.equal(b._pending.filter((p) => p.time === Infinity).length, 0, 'a spawn at time Infinity is never scheduled');
});

test('re-entrant kills/retreats/redeploys inside buff ticks, expiry and death hooks keep state consistent', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ stats: { respawnTime: 1, cost: 0 } }) }, enemies: { enemy_walker: walker({ hp: 5000, atk: 400 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }, { chessId: 't_guard', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_walker', count: 6, interval: 1 }], content: 'none', timeLimit: 40,
    setup(b) {
      b.on('deploy', ({ unit }) => {
        if (unit.side !== 'ally') return;
        b.addBuff(unit, { key: 'boom', duration: 0.5, onExpire: () => { b.kill(unit); b.removeBuff(unit, 'x'); }, interval: 0.1,
          onTick: ({ unit: u }) => { if (b.time > 3 && b.rng() < 0.05) b.retreat(u); } });
        b.addBuff(unit, { key: 'x', duration: 5 });
      });
      b.on('death', ({ unit }) => { if (unit.side === 'ally' && b.rng() < 0.5) b.redeploy(unit); });
    },
  });
  for (let i = 0; i < 40 * 30 && !h.b.finished; i++) { h.b.step(); checkInvariants(h.b); }
  assert.equal(h.b.internalErrorCount ?? 0, 0);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors.slice(0, 2)));
  for (const u of h.b.allyUnits) if (!u.alive) assert.equal(u.blocking.length, 0);
});

test('spGain handlers that change the SP cost mid-gain never leave sp above the new cost (stale-cost re-entrancy)', () => {
  // found by the chaos soak: gainSp captured the cost before emitting spGain; a handler set spCostMul = 0 and the
  // stale cost (25) was then written back as sp → sp 25 / cost 0
  for (const mul of [0, 0.5, 3]) {
    const h = makeBattle({ defs: { chess: { t_guard: guard({ skill: { duration: 5, spCost: 25, initSp: 0 } }) } }, units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'generic',
      setup(b) { b.on('spGain', ({ skill }) => { if (b.time > 1 && skill.spCostMul !== mul) skill.spCostMul = mul; }); } });
    for (let i = 0; i < 90; i++) { h.b.step(); checkInvariants(h.b); }
    const sk = h.unit('t_guard').skill;
    assert.ok(sk.sp <= sk.spCost + 1e-9, `mul ${mul}: sp ${sk.sp} ≤ cost ${sk.spCost}`);
  }
});

test('hit handlers see their own changes: invulnerability or fragile granted in `hit` applies to that same hit', () => {
  const mk = () => {
    const h = makeBattle({ defs: { chess: { t_guard: guard() } }, units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'none' });
    h.step();
    return h;
  };
  const inv = mk();
  inv.b.on('hit', ({ target }) => { inv.b.addBuff(target, { key: 'shieldwall', duration: 1, flags: { invulnerable: true } }); });
  assert.equal(inv.b.dealDamage(null, inv.unit('t_guard'), { amount: 500, type: 'true' }), 0, 'invulnerable from the hit hook');
  const fr = mk();
  fr.b.on('hit', ({ target }) => { if (!target.findBuff('fragile')) fr.b.applyStatus(target, 'fragile', { duration: 5, value: 1 }); });
  assert.equal(fr.b.dealDamage(null, fr.unit('t_guard'), { amount: 100, type: 'true' }), 200, 'fragile ×2 applies to the triggering hit');
});

test('a skill onEnd that redeploys its unit during death is refused (no ghost unit outside the occupancy map)', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ skill: { duration: 30, spCost: 1, initSp: 1 } }) }, enemies: { enemy_walker: walker() } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], enemies: [{ key: 'enemy_walker', pos: [9, 6] }], content: 'generic',
    kits: { t_guard: () => ({ skill: { kind: 'duration', duration: 30, trigger: 'SP_FULL', onEnd: ({ battle, unit, reason }) => { if (reason === 'death') battle.redeploy(unit); } } }) },
  });
  h.step(2);
  const g = h.unit('t_guard');
  assert.equal(g.skill.active, true);
  h.b.kill(g);
  assert.equal(g.alive, false, 'stays dead');
  assert.equal(h.b.unitAt(9, 5), null);
  h.b.redeploy(g); // allowed afterwards (e.g. from a death hook)
  assert.equal(g.alive, true);
  assert.equal(h.b.unitAt(9, 5), g);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// garbage numbers reaching the engine

test('DP flags and time limits: undefined/NaN/0 never poison DP or make a normal round endless', () => {
  const h = makeBattle({ content: 'none', flags: { dpInit: undefined, dpPerSec: NaN, dpMax: 'x' }, timeLimit: 0 });
  h.step(30);
  const pl = h.b.getPlayer('p1');
  assert.ok(Number.isFinite(pl.dp) && Math.abs(pl.dp - 11) < 1e-6, `dp ${pl.dp}`);
  assert.equal(h.b.timeLimit, 60, 'normal: invalid limit → 60 s');
  for (const tl of [NaN, -5, 0]) assert.equal(new Battle({ kind: 'normal', stage: flatStage(), timeLimit: tl, logger: quiet }).timeLimit, 60);
  assert.equal(new Battle({ kind: 'boss', stage: flatStage(), timeLimit: 0, logger: quiet }).timeLimit, Infinity);
  // malformed field rects fall back to the kind's default
  assert.deepEqual(new Battle({ kind: 'normal', stage: flatStage(), rect: { r0: 12, r1: 9, c0: 0, c1: 10 }, logger: quiet }).rect, { r0: 9, r1: 12, c0: 0, c1: 10 });
  assert.deepEqual(new Battle({ kind: 'boss', stage: flatStage(), rect: { r0: 0, r1: 5, c0: 0, c1: 99 }, logger: quiet }).rect, { r0: 0, r1: 5, c0: 0, c1: 20 });
});

test('unit input rows/cols given as strings deploy correctly (no "10"+-7 concatenation); junk tiles are skipped', () => {
  const h = makeBattle({ kind: 'boss', defs: { chess: { t_guard: guard() } }, content: 'none',
    players: [{ playerId: 'A', side: 'L', units: [{ uid: 1, chessId: 't_guard', row: '10', col: '5' }, { uid: 2, chessId: 't_guard', row: 'x', col: 5 }] }] });
  h.step();
  const g = h.unit(1);
  assert.equal(g.alive, true);
  assert.deepEqual([g.tileR, g.tileC], [3, 5]);
  assert.equal(h.b.allyUnits.length, 1, 'the unit with a junk row was not created');
});

test('kill handlers that write NaN / huge / negative hp: revive clamps to maxHp, otherwise the unit dies with hp 0', () => {
  for (const v of [NaN, -5, 1e12, 50]) {
    const h = makeBattle({ defs: { chess: { t_guard: guard() } }, units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'none',
      setup(b) { b.on('kill', ({ victim }) => { victim.hp = v; }); } });
    h.step();
    const g = h.unit('t_guard');
    h.b.dealDamage(null, g, { amount: 1e9, type: 'true' });
    checkInvariants(h.b);
    if (v > 0) { assert.equal(g.alive, true, `revived with ${v}`); assert.ok(g.hp <= g.s.maxHp); } else { assert.equal(g.alive, false); assert.equal(g.hp, 0); }
  }
});

test('a nested kill inside kill handlers: a later handler writing hp cannot leave a dead unit with hp > 0', () => {
  // found by the chaos soak: kill(A) → handler X kills A again (nested, completes the removal) → handler Y then wrote
  // hp = 154 on the now-dead A; the outer kill() saw !alive and returned, leaving "killed with hp 154"
  let nested = false;
  const h = makeBattle({ defs: { chess: { t_guard: guard() } }, units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'none',
    setup(b) {
      b.on('kill', ({ victim }) => { if (!nested) { nested = true; b.kill(victim); } }, { priority: 10 });
      b.on('kill', ({ victim }) => { if (!victim.alive) victim.hp = 154; }, { priority: 0 });
    } });
  h.step();
  const g = h.unit('t_guard');
  h.b.kill(g);
  assert.equal(g.alive, false);
  assert.equal(g.hp, 0);
  checkInvariants(h.b);
});

test('a heal hook that kills its target: the heal is dropped (no dead unit with hp > 0)', () => {
  const h = makeBattle({ defs: { chess: { t_guard: guard() } }, units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'none',
    setup(b) { b.on('heal', ({ target }) => { b.kill(target); }); } });
  h.step();
  const g = h.unit('t_guard');
  h.b.loseHp(g, 500);
  assert.equal(h.b.heal(null, g, 300), 0);
  assert.equal(g.alive, false);
  assert.equal(g.hp, 0);
  checkInvariants(h.b);
});

test('helpers validate their inputs: spawnDevice / relocate / spawnToken / spawnEnemy / projectiles / skills', () => {
  const h = makeBattle({ defs: { chess: { t_guard: guard({ skill: { duration: 5, spCost: 10, initSp: 10 } }) }, enemies: { enemy_walker: walker() } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'generic', timeLimit: 60 });
  h.step();
  const b = h.b;
  const g = h.unit('t_guard');
  // spawnDevice: outside the rect / on a living unit / junk hp
  assert.equal(b.spawnDevice('trap_1105_accrate', 3, 5, { obstacle: true }), null, 'outside the normal rect');
  assert.equal(b.spawnDevice('trap_1105_accrate', 9, 5, { obstacle: true }), null, 'on the guard');
  assert.equal(b.spawnDevice('trap_1105_accrate', 10.5, 5), null, 'non-integer tile');
  const d = b.spawnDevice('trap_1105_accrate', 11, 6, { hp: Infinity, obstacle: true });
  assert.equal(d.hp, 100);
  // relocate: dead units, junk tiles and tiles outside the rect are refused; a move refreshes the initial range
  assert.equal(b.relocate(g, 16, 5), false);
  assert.equal(b.relocate(g, NaN, 5), false);
  assert.equal(b.relocate(g, 10, 6), true);
  assert.ok(g.baseRangeKeys.includes(10 * 21 + 6), 'initial (DEFAULT trigger) range follows the unit');
  b.kill(g);
  assert.equal(b.relocate(g, 12, 6), false, 'dead units stay put');
  b.redeploy(g); // back on the tile it was knocked out on, (10,6) (PRTS 卫戍协议/帮助: 自动部署至该位置)
  // spawnToken on a busy tile (even with force) → null, no half-built token left behind
  const aliveBefore = b.allyUnits.filter((u) => u.alive).length;
  const hooks = hookCount(b);
  assert.equal(g.alive, true);
  assert.deepEqual([g.tileR, g.tileC], [10, 6]);
  assert.equal(b.spawnToken('p1', 'x_token', 10, 6, { def: { name: 't', stats: { maxHp: 100 } }, force: true }), null);
  assert.equal(b.allyUnits.filter((u) => u.alive).length, aliveBefore, 'no half-built token');
  assert.ok(hookCount(b) <= hooks);
  const t = b.spawnToken('p1', 'x_token', 12, 8, { def: { name: 't', stats: { maxHp: 100 } }, hp: NaN, stats: { atk: NaN, def: 50 } });
  assert.equal(t.hp, 100);
  assert.equal(t.base.def, 50);
  assert.ok(Number.isFinite(t.base.atk));
  // spawnEnemy: junk multipliers and positions outside the field
  const e = b.spawnEnemy('enemy_walker', { mods: { hpMul: NaN, speedMul: -1, atkMul: Infinity }, pos: [3, 40] });
  assert.ok(Number.isFinite(e.hp) && e.hp > 0 && Number.isFinite(e.s.moveSpeed) && Number.isFinite(e.s.atk));
  assert.ok(e.x <= b.rect.c1 + 0.5 && e.y >= b.rect.r0 - 0.5, `spawned inside the field (${e.x},${e.y})`);
  // projectiles aimed at NaN never linger
  b.addProjectile({ from: g, to: { x: NaN, y: NaN }, onHit() {} });
  b.addProjectile({ from: { x: NaN, y: 3 }, target: e, maxAge: NaN, onHit() {} });
  for (const p of b.projectiles.list) assert.ok([p.x, p.y, p.tx, p.ty, p.maxAge].every(Number.isFinite));
  h.step(45);
  assert.equal(b.projectiles.list.length, 0);
  // skills: NaN cost multipliers, NaN extensions and ammo never freeze the skill
  const sk = h.unit('t_guard').skill;
  sk.spCostMul = NaN;
  assert.equal(sk.spCostMul, 1);
  sk.spCostMul = 0;
  assert.ok(sk.sp <= sk.spCost + 1e-9, 'sp ≤ cost immediately after a cost change');
  sk.spCostMul = 1;
  sk.activate('test', { free: true });
  sk.extend(NaN); sk.addAmmo(NaN); sk.addCharge(NaN);
  h.run(6);
  assert.equal(sk.active, false, 'duration skill still ends');
  checkInvariants(b);
});

test('malformed kits (junk range grids, mods, talents, trait) never raise engine errors', () => {
  const junkKit = () => ({
    skill: { kind: 'duration', duration: 3, trigger: 'SP_FULL', mods: { atkPct: 'x', aspd: NaN, blockCnt: Infinity },
      targeting: { rangeGrid: 5, rangeExtend: NaN, maxTargets: 'many' }, attack: { atkScale: NaN, splashRadius: 'big', hits: Infinity } },
    talents: [null, { install: 'x' }, { install() { throw new Error('talent boom'); } }],
    trait: 'garbage',
  });
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ skill: { duration: 3, spCost: 1, initSp: 1 }, rangeGrid: [[0, 0], 'x', [0, 1.5], [0, 1]] }) }, enemies: { enemy_walker: walker({ hp: 5000, atk: 50 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], enemies: [{ key: 'enemy_walker', count: 3, interval: 2 }], content: 'generic', timeLimit: 20,
    kits: { t_guard: junkKit },
  });
  for (let i = 0; i < 20 * 30 && !h.b.finished; i++) { h.b.step(); if (i % 5 === 0) checkInvariants(h.b); }
  assert.equal(h.b.internalErrorCount ?? 0, 0, JSON.stringify(h.b.errors.filter((e) => e.label.startsWith('internal')).slice(0, 2)));
  assert.ok(h.unit('t_guard').skill.activations > 0);
});

test('stat aggregation never produces non-finite stats (overflowing stacked multipliers fall back to base)', () => {
  const h = makeBattle({ defs: { chess: { t_guard: guard() } }, units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'none' });
  h.step();
  const g = h.unit('t_guard');
  const buff = h.b.addBuff(g, { key: 'huge', refresh: 'stack', maxStacks: 1000, mods: { hpMul: 1e9, atkMul: 1e9, moveMul: 1e9, spRecoveryMul: 1e300 } });
  for (let i = 0; i < 50; i++) h.b.addBuff(g, { key: 'huge', refresh: 'stack', maxStacks: 1000, mods: buff.mods });
  for (const k of ['maxHp', 'atk', 'def', 'interval', 'moveSpeed', 'spRecovery', 'hpRegen']) assert.ok(Number.isFinite(g.s[k]), `${k}=${g.s[k]}`);
  assert.ok(Number.isFinite(g.hp) && g.hp <= g.s.maxHp);
  checkInvariants(h.b);
});

test('zero / junk attack intervals from data never yield NaN or 0-length cooldowns', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ stats: { bat: 0, aspd: 0 } }) }, enemies: { enemy_walker: walker({ bat: 0, aspd: -50, hp: 1e9 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], enemies: [{ key: 'enemy_walker', pos: [9, 5] }], content: 'none', timeLimit: 5,
  });
  h.run(3);
  const g = h.unit('t_guard'), e = h.enemies()[0];
  for (const u of [g, e]) assert.ok(Number.isFinite(u.s.interval) && u.s.interval > 0, `${u.kind} interval ${u.s.interval}`);
  assert.ok(g.stats.attacks <= 3 / g.s.interval + 2, 'attack count bounded by the interval');
  checkInvariants(h.b);
});

test('broken shared boss pool (NaN hp) never leaks NaN into the boss unit', () => {
  const pool = { hp: 1000, maxHp: 1000, damage() { this.hp = NaN; } };
  const h = makeBattle({ kind: 'boss', sharedBoss: pool, content: 'none',
    defs: { chess: { t_sniper: sniper() }, enemies: { enemy_boss: enemyRec({ key: 'enemy_boss', hp: 1e6, speed: 0 }) } },
    players: [{ playerId: 'A', side: 'L', units: [{ uid: 1, chessId: 't_sniper', row: 10, col: 3 }] }],
    enemies: [{ key: 'enemy_boss', pos: [3, 8], tag: 'boss' }] });
  h.run(5);
  const boss = h.enemies()[0];
  assert.ok(Number.isFinite(boss.hp));
  assert.ok(Number.isFinite(h.result().perPlayer.A.bossDamage));
  assert.ok(Number.isFinite(h.unit(1).stats.dmg));
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// movement: unreachable goals, blocked paths, empty routes

test('route legs outside the field rect are clamped: a flyer finishes its route instead of hovering at the border', () => {
  // mirrors act1autochess_h07_01 extraRoutes[1] (FLY start (6,10) → (6,17): row 6 is outside the boss rect)
  const route = { motion: 'FLY', start: [6, 10], end: [1, 3], checkpoints: [[6, 17]] };
  const h = makeBattle({ kind: 'boss', content: 'none', defs: { enemies: { enemy_f: enemyRec({ key: 'enemy_f', motion: 'FLY', speed: 3 }) } },
    players: [{ playerId: 'A', side: 'L', units: [] }], enemies: [{ key: 'enemy_f', route }], autoFinish: true });
  h.step();
  assert.equal(h.enemies().length, 1);
  h.runUntil(() => h.enemies().length === 0, 60);
  assert.equal(h.enemies().length, 0, 'reached its goal');
  assert.equal(h.result().perPlayer.A.leaked.length, 1);
  // and the real template still converts cleanly
  const tpl = getDefaultSource().getWave('act1autochess_h07_01');
  if (tpl) assert.ok(spawnsFromTemplate(tpl).extraRoutes.length > 0);
});

test('crates blocking every path: attackers break through, harmless walkers time out (battle always terminates)', () => {
  const crates = [[9, 6], [10, 6], [11, 6], [12, 6]];
  const brk = makeBattle({ flat: { crates }, content: 'none', timeLimit: 60, defs: { enemies: { enemy_walker: walker({ atk: 300, speed: 2 }) } }, enemies: [{ key: 'enemy_walker', count: 3, interval: 1 }] });
  brk.runToEnd(70);
  assert.equal(brk.result().perPlayer.p1.leaked.length, 3, 'crate destroyed, everyone walked through');
  assert.ok(brk.b.allyUnits.some((u) => u.kind === 'device' && !u.alive));
  const stuck = makeBattle({ flat: { crates }, content: 'none', timeLimit: 20, defs: { enemies: { enemy_walker: walker({ atk: 0, speed: 2 }) } }, enemies: [{ key: 'enemy_walker' }] });
  stuck.runToEnd(30);
  assert.equal(stuck.result().reason, 'timeout');
  assert.ok(stuck.b.time <= 20 + 1e-6);
  checkInvariants(stuck.b);
});

test('empty routes / no goal tile: enemies leak immediately instead of wandering; spawns on an occupied tile get blocked', () => {
  const stage = { id: 'noend', rows: Array.from({ length: 19 }, () => 'r'.repeat(21)), devices: [] };
  const h = makeBattle({ stage, routes: [], content: 'none', defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker', count: 3 }] });
  h.runToEnd(5);
  assert.equal(h.b.finished, true);
  assert.equal(h.result().perPlayer.p1.leaked.length, 3);
  const o = makeBattle({ defs: { chess: { t_guard: guard() }, enemies: { enemy_walker: walker() } }, units: [{ chessId: 't_guard', row: 10, col: 6 }], content: 'none',
    enemies: [{ key: 'enemy_walker', pos: [10, 6] }] });
  o.step(2);
  assert.equal(o.enemies()[0].blockedBy, o.unit('t_guard'));
});

test('an enemy that turns unblockable through a plain buff walks on', () => {
  const h = makeBattle({ defs: { chess: { t_guard: guard({ stats: { atk: 0 } }) }, enemies: { enemy_walker: walker({ speed: 2 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], enemies: [{ key: 'enemy_walker', route: 0 }], content: 'none', timeLimit: 60 });
  h.runUntil(() => h.enemies()[0]?.blockedBy, 20);
  const e = h.enemies()[0];
  assert.ok(e.blockedBy);
  h.b.addBuff(e, { key: 'phase', flags: { unblockable: true } });
  h.step(2);
  assert.equal(e.blockedBy, null);
  assert.equal(h.unit('t_guard').blocking.length, 0);
  h.runToEnd(60);
  assert.equal(h.result().perPlayer.p1.leaked.length, 1);
});

test('a single-target projectile whose target dies mid-flight fizzles without errors', () => {
  const h = makeBattle({
    defs: { chess: { t_sniper: sniper({ stats: { atk: 100 } }) }, enemies: { enemy_walker: walker({ hp: 1e6, speed: 0 }) } },
    units: [{ chessId: 't_sniper', row: 9, col: 3 }], enemies: [{ key: 'enemy_walker', pos: [9, 9] }, { key: 'enemy_walker', pos: [12, 9] }], content: 'none', timeLimit: 10,
  });
  h.runUntil(() => h.b.projectiles.list.length > 0, 5);
  const e = h.enemies()[0];
  h.b.kill(e);
  const dmgBefore = h.eventsOf('dmg').length;
  h.step(30);
  assert.equal(h.b.finished, false);
  assert.equal(h.eventsOf('dmg').length, dmgBefore, 'no damage to a dead target');
  assert.equal(h.b.projectiles.list.length, 0);
  assert.equal(h.b.errors.length, 0);
});

test('an enemy shot in flight at an operator that dies and is redeployed at once fizzles (new life, new target)', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ stats: { respawnTime: 0, cost: 0 } }) }, enemies: { enemy_gun: enemyRec({ key: 'enemy_gun', hp: 1e9, atk: 500, range: 6, bat: 20, speed: 0 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 3 }], enemies: [{ key: 'enemy_gun', pos: [9, 8] }], content: 'none', timeLimit: 30,
  });
  h.runUntil(() => h.b.projectiles.list.length > 0, 5);
  const g = h.unit('t_guard');
  assert.equal(h.b.projectiles.list.length, 1);
  h.b.kill(g);
  assert.ok(h.b.redeploy(g));
  const hp = g.hp;
  h.step(60);
  assert.equal(h.b.projectiles.list.length, 0);
  assert.equal(g.hp, hp, 'the redeployed operator was not hit by the old shot');
});

// ---------------------------------------------------------------------------------------------------------------
// listener / timer leaks

test('hooks and periodic timers owned by removed enemies/tokens are released at step end; their own death/leak handlers still fire', () => {
  let deaths = 0, leaks = 0, afterRan = 0, everyRuns = 0;
  const h = makeBattle({
    defs: { chess: { t_sniper: sniper({ stats: { atk: 3000 }, rangeGrid: wideGrid() }) }, enemies: { enemy_walker: walker({ hp: 500, speed: 3 }) } },
    units: [{ chessId: 't_sniper', row: 10, col: 3 }], enemies: [{ key: 'enemy_walker', count: 30, interval: 0.3 }], content: 'none', timeLimit: 60,
    setup(b) {
      b.on('enemySpawn', ({ enemy }) => {
        b.on('damaged', () => {}, { owner: enemy });
        b.on('death', ({ unit }) => { if (unit === enemy) { deaths++; b.after(0.5, () => { afterRan++; }, { owner: enemy }); } }, { owner: enemy });
        b.on('enemyLeak', (c) => { if (c.enemy === enemy) leaks++; }, { owner: enemy });
        b.every(0.2, () => { everyRuns++; }, { owner: enemy });
      });
    },
  });
  h.step();
  const base = hookCount(h.b);
  h.runToEnd(70);
  assert.equal(deaths, 30, 'own death handler ran for every enemy (killed or leaked)');
  assert.equal(leaks, h.result().perPlayer.p1.leaked.length, 'own leak handler ran');
  const dead = h.b.units.filter((u) => u.side === 'enemy');
  const due = dead.filter((u) => u.deathAt + 0.5 < h.b.time - 1e-6).length;
  assert.ok(afterRan >= due && afterRan <= deaths, `one-shot after() owned by a dead enemy still runs (${afterRan}, due ${due})`);
  assert.ok(h.result().perPlayer.p1.killed > 0 && leaks > 0, 'both kill and leak paths exercised');
  assert.ok(hookCount(h.b) <= base, `hooks released (${hookCount(h.b)} vs ${base})`);
  assert.equal(h.b._sched.filter((s) => s.interval > 0 && !s.cancelled).length, 0, 'periodic timers of dead enemies cancelled');
  assert.ok(everyRuns > 0);
});

test('client event buffer stays bounded when nobody drains', () => {
  const h = makeBattle({ defs: { enemies: { enemy_walker: walker({ speed: 0 }) } }, content: 'none', recordEvents: true, timeLimit: 1e5 });
  h.step();
  for (let i = 0; i < 70000; i++) h.b.fx('spam', { x: 1, y: 1 });
  assert.ok(h.b._evq.length <= 50000);
});

// ---------------------------------------------------------------------------------------------------------------
// chaos fuzz, determinism, performance (real data)

const ds = getDefaultSource();
const WEIRD = [0, -1, NaN, Infinity, -Infinity, 1e9, 0.5, 3, undefined, null];
const BUFFKEYS = ['stun', 'freeze', 'cold', 'sleep', 'slow', 'bind', 'fragile', 'silence', 'fear', 'levitate', 'stealth', 'invulnerable', 'taunt', 'bogus', 'attract', 'resist', 'palsy'];

/** Content module that randomly abuses every public helper from inside hooks (seeded → deterministic). */
function chaosContent(cr, P, pools) {
  return {
    install(b) {
      const w = () => cr.pick(WEIRD);
      const any = () => cr.pick(b.units);
      const act = () => {
        if (!cr.chance(P)) return;
        const u = any();
        if (!u) return;
        switch (cr.int(24)) {
          case 0: b.kill(u, any()); break;
          case 1: b.retreat(u, { permanent: cr.chance(0.3) }); break;
          case 2: b.redeploy(u, cr.chance(0.5) ? {} : { free: cr.chance(0.5), keepSp: cr.chance(0.5), tile: cr.pick([null, [cr.int(19), cr.int(21)], [w(), w()], 'x', [u.tileR, u.tileC]]) }); break;
          case 3: b.relocate(u, cr.int(21), cr.int(21)); break;
          case 4: b.displace(u, { x: w() ?? 1, y: w() ?? 0 }, w(), { force: w() }); break;
          case 5: b.applyStatus(u, cr.pick(BUFFKEYS), { duration: w(), value: w(), source: any(), point: cr.pick([undefined, [w(), w()], [cr.int(19), cr.int(21)], { x: w(), y: w() }, 'x']) }); break;
          case 6: b.addBuff(u, { key: 'c' + cr.int(3), duration: w(), refresh: cr.pick(['replace', 'extend', 'stack', 'independent', 'keep']), maxStacks: w(),
            mods: { atkPct: w(), aspd: w(), hpMul: w(), moveMul: w(), blockCnt: w(), batPct: w(), shield: w(), massFlat: w(), rangeExtend: w() }, persist: cr.chance(0.2), interval: w(),
            onTick: cr.chance(0.3) ? () => { if (cr.chance(0.2)) b.kill(u); } : null, onExpire: cr.chance(0.3) ? () => b.kill(any()) : null }); break;
          case 7: b.spawnEnemy(cr.pick(pools.enemies), { routeIndex: cr.int(30) - 2, pos: cr.chance(0.3) ? [cr.int(19), cr.int(21)] : undefined, mods: { hpMul: w(), speedMul: w() }, tag: cr.pick([null, 'boss', 'part']) }); break;
          case 8: b.spawnToken(cr.chance(0.5) ? u : u.ownerId, cr.pick(pools.tokens), cr.int(19), cr.int(21), { duration: w(), hp: w(), force: cr.chance(0.3) }); break;
          case 9: b.spawnDevice('trap_1105_accrate', cr.int(19), cr.int(21), { hp: w(), obstacle: true }); break;
          case 10: b.setObstacle(cr.int(19), cr.int(21), cr.chance(0.5)); break;
          case 11: b.loseHp(u, w()); break;
          case 12: b.heal(any(), u, w(), { overheal: cr.chance(0.5) }); break;
          case 13: b.dealDamage(any(), u, { amount: w(), type: cr.pick(['phys', 'arts', 'true', 'element']), element: cr.pick(['burn', 'neural', 'necrosis', 'apoptosis']), mul: w() }); break;
          case 14: b.addDp(u.ownerId, w()); b.addLayers(u.ownerId, 'bond_x', w()); b.addCoins(u.ownerId, w()); break;
          case 15: if (u.skill) { const m = cr.int(5); if (m === 0) u.skill.gainSp(w()); else if (m === 1) u.skill.activate('chaos', { free: cr.chance(0.5) }); else if (m === 2) u.skill.end('chaos'); else if (m === 3) u.skill.extend(w()); else u.skill.spCostMul = w(); } break;
          case 16: b.after(w(), () => { const v = any(); if (v) b.kill(v); }, { owner: cr.chance(0.5) ? u : null }); break;
          case 17: b.every(w(), () => { const v = any(); if (v && cr.chance(0.05)) b.retreat(v); }, { owner: u }); break;
          case 18: if (cr.chance(0.002)) b.forceEnd(cr.pick(['forced', 'timeout'])); break;
          case 19: b.forceAttack(u, cr.chance(0.8) ? null : [any()], { noAmmo: cr.chance(0.5) }); break;
          case 20: b.addProjectile({ from: u, target: any(), to: cr.chance(0.3) ? { x: w(), y: w() } : undefined, speed: w(), onHit: (c) => { if (c.target) b.kill(c.target); }, hitDead: cr.chance(0.5) }); break;
          case 21: b.setExtraRange(u, cr.pick([null, [], [w(), cr.int(399)], 'x', [cr.int(399), cr.int(399)]])); break;
          case 22: if (u.skill && cr.chance(0.1)) u.skill.addTriggerRange(cr.pick([() => [any()], () => [[cr.int(399)]], () => null, () => { throw new Error('chaos trigger'); }, () => 5])); break;
          default: if (u.side === 'enemy') b.leak(u); break;
        }
      };
      for (const name of ['damaged', 'kill', 'death', 'attack', 'beforeAttack', 'skillStart', 'skillEnd', 'deploy', 'blocked', 'enemySpawn', 'enemyLeak', 'tick', 'heal', 'statusApplied', 'hit', 'fatal', 'spGain']) {
        b.on(name, act, { priority: cr.int(5) - 2 });
      }
      b.on('kill', (c) => { if (cr.chance(P) && c.victim.side === 'ally') c.victim.hp = cr.pick([1, NaN, -5, 1e12]); });
      b.on('fatal', (c) => { if (cr.chance(P)) c.prevented = true; });
      b.on('beforeAttack', (c) => { if (cr.chance(P)) c.targets = cr.pick([null, [], [any()], [null, undefined]]); });
      b.on('hit', (c) => { if (cr.chance(P)) c.dmg.amount = w(); });
      b.on('heal', (c) => { if (cr.chance(P)) c.amount = w(); });
      b.on('spGain', (c) => { if (cr.chance(P)) c.amount = w(); });
    },
  };
}

function realPools() {
  const chess = ds.chessIds().filter((id) => { const r = ds.rawChess(id); return r && r.stats && r.visible !== false && !r.isHidden && r.chessType !== 'DIY'; });
  const stages = ds.stageIds().filter((id) => { const s = ds.getStage(id); return s && s.raw && s.raw.active !== false && s.raw.deployTiles; });
  const waves = ds.waveIds().filter((id) => ['normal', 'boss', 'hidden', 'escaped'].includes(ds.getWave(id)?.kind));
  return { chess, stages, waves, enemies: Object.keys(ds.raw.enemies), tokens: Object.keys(ds.raw.tokens) };
}

function realBattle(P, seed, { chaos = 0, stageId = null, waveId = null, extra = null, units = null } = {}) {
  const r = createRng(seed);
  stageId = stageId ?? r.pick(P.stages);
  waveId = waveId ?? r.pick(P.waves);
  const stage = ds.getStage(stageId), tpl = ds.getWave(waveId);
  const kind = tpl.kind === 'escaped' ? 'unite' : tpl.kind;
  const { routes, spawns, maxPlayTime } = spawnsFromTemplate(tpl, { mods: { hpMul: 0.7 } });
  const lineup = (where, n, off = 0) => {
    const dt = stage.raw.deployTiles[where];
    const tiles = [...dt.melee, ...dt.rangedOnly];
    r.shuffle(tiles);
    return tiles.slice(0, n).map(([a, c], j) => ({ uid: j + 1, kind: 'chess', chessId: r.pick(P.chess), row: a, col: c + off, abs: true }));
  };
  let players, sharedBoss = null;
  if (kind === 'boss' || kind === 'hidden') {
    players = [{ playerId: 'A', side: 'L', units: lineup('bossLeft', units ?? 1 + r.int(9)) }, { playerId: 'B', side: 'R', units: lineup('bossRight', units ?? 1 + r.int(9)) }];
    sharedBoss = { hp: 1e5, maxHp: 1e5, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } };
  } else if (kind === 'unite') {
    players = [{ playerId: 'A', side: 'L', units: lineup('normal', 1 + r.int(8)) }, { playerId: 'B', side: 'L', colOffset: 8, units: lineup('normal', 1 + r.int(8), 8) }];
  } else players = [{ playerId: 'P', side: 'L', units: lineup('normal', 1 + r.int(9)) }];
  const bossLike = kind === 'boss' || kind === 'hidden';
  const b = new Battle({
    seed, kind, stageId, routes, spawns: spawns.concat(extra ? extra(routes) : []), players, sharedBoss, logger: quiet, quiet: true,
    timeLimit: bossLike ? Infinity : (kind === 'unite' ? 60 : maxPlayTime ?? 60), enemyOverrides: tpl.overrides ?? {},
    extraContent: chaos ? [chaosContent(createRng(seed ^ 0xc4a05), chaos, P)] : [],
  });
  return { b, kind, stageId, waveId, bossLike };
}

test('chaos fuzz: content abusing every helper from every hook never breaks invariants or the engine (real data)', () => {
  const P = realPools();
  const N = Number(process.env.SIM_CHAOS_N) || 12;   // SIM_CHAOS_N=500 for a soak
  const rng = createRng(Number(process.env.SIM_CHAOS_SEED) || 424242);
  const stats = { simSeconds: 0, reasons: {}, contentErrors: 0 };
  for (let i = 0; i < N; i++) {
    const seed = (rng() * 2 ** 32) >>> 0;
    const { b, kind, stageId, waveId, bossLike } = realBattle(P, seed, { chaos: 0.04 });
    const cap = bossLike ? 40 : b.timeLimit + 1;
    const tag = `#${i} ${kind} ${stageId} ${waveId} seed=${seed}`;
    let n = 0;
    try {
      while (!b.finished && b.time < cap) {
        b.step();
        if (++n % 4 === 0) checkInvariants(b);
        if (n % 3 === 0) { b.snapshot(); b.drainEvents(); }
      }
    } catch (e) { e.message = `${tag}: ${e.message}`; throw e; }
    if (!bossLike) assert.ok(b.finished, `${tag} terminated`);
    checkInvariants(b);
    assert.equal(b.internalErrorCount ?? 0, 0, `${tag}: ${JSON.stringify(b.errors.filter((e) => e.label.startsWith('internal')).slice(0, 2))}`);
    JSON.stringify(b.result());
    stats.simSeconds += b.time;
    stats.reasons[b.reason ?? 'running'] = (stats.reasons[b.reason ?? 'running'] ?? 0) + 1;
    stats.contentErrors += b.errorCount;
  }
  // eslint-disable-next-line no-console
  console.log(`chaos: ${N} battles, ${stats.simSeconds.toFixed(0)} s simulated, ${JSON.stringify(stats.reasons)}, ${stats.contentErrors} content errors`);
  assert.ok(stats.simSeconds >= N * 10, 'battles ran long enough to matter');
});

test('determinism: identical event streams regardless of battle order / interleaving (real data, with chaos content)', () => {
  const P = realPools();
  const cases = [[11, 'act2autochess_m01', 'act1autochess_h05'], [12, 'act2autochess_m01', 'act1autochess_h07_01'], [13, 'act1autochess_m01', 'act1autochess_escaped_multi'], [14, 'act2autochess_m03', 'act1autochess_h08_01']]
    .filter(([, s, w]) => ds.getStage(s) && ds.getWave(w));
  const runAll = (order, interleave) => {
    const bs = order.map((i) => realBattle(P, cases[i][0], { chaos: 0.01, stageId: cases[i][1], waveId: cases[i][2] }).b);
    const logs = bs.map(() => []);
    for (let t = 0, active = true; active; t++) {
      active = false;
      bs.forEach((b, k) => {
        const steps = interleave ? 1 + ((t + k) % 3) : 1e9;
        for (let s = 0; s < steps && !b.finished && b.time < 45; s++) { b.step(); if (b.tickCount % 3 === 0) logs[k].push(hashOf(b.snapshot()), hashOf(b.drainEvents())); }
        if (!b.finished && b.time < 45) active = true;
      });
    }
    const out = {};
    order.forEach((i, k) => { out[i] = hashOf(logs[k]) + hashOf(bs[k].result()); });
    return out;
  };
  const seq = runAll(cases.map((_, i) => i), false);
  const inter = runAll(cases.map((_, i) => i).reverse(), true);
  assert.deepEqual(inter, seq);
});

test('determinism: shared defs are frozen — a kit that mutates its blackboard / range cannot leak into later battles', () => {
  const chessId = 'chess_char_1_02_a';
  const def = ds.getChess(chessId);
  if (!def) return;
  assert.ok(Object.isFrozen(def) && Object.isFrozen(def.stats) && Object.isFrozen(def.rangeGrid));
  if (def.skill) assert.ok(Object.isFrozen(def.skill.bb));
  const evil = (bb, chess, d) => { bb.atk = 99; d.rangeGrid.push([0, 9]); d.stats.atk *= 10; return null; };
  const run = () => {
    const h = makeBattle({ data: ds, stageId: 'act2autochess_m01', units: [{ chessId, row: 9, col: 7 }], kits: { [def.baseId]: evil },
      enemies: [{ key: 'enemy_1422_lrsldr', count: 4, interval: 2 }], timeLimit: 40 });
    h.runToEnd(45);
    return { hash: hashOf(h.result()), errs: h.b.errors.filter((e) => e.label.startsWith('kit:')).length };
  };
  const a = run(), b = run();
  assert.equal(a.hash, b.hash, 'second battle unaffected by the first');
  assert.ok(a.errs >= 1, 'the mutation attempt surfaced as a kit error');
  assert.ok(def.stats.atk < 5000 && !def.rangeGrid.some(([r, c]) => r === 0 && c === 9));
});

/** Speed bar of the heavy boss field, ms per tick (see the header): DESIGN §11's 0.5 ms locally, 1.0 ms on CI runners. */
const BOSS_FIELD_MS_PER_TICK = process.env.CI ? 1.0 : 0.5;

test(`performance: heavy 2-player boss field (18 ops, ~130 enemies alive) averages < ${BOSS_FIELD_MS_PER_TICK} ms/tick (best of 3)`, () => {
  const P = realPools();
  if (!ds.getStage('act2autochess_m01') || !ds.getWave('act1autochess_h07_01')) return;
  const keys = ['enemy_1422_lrsldr', 'enemy_1427_lrnazg', 'enemy_1005_yokai', 'enemy_1042_frostd', 'enemy_1425_lrcmra', 'enemy_1040_bombd'].filter((k) => ds.getEnemy(k));
  const extra = (routes) => Array.from({ length: 120 }, (_, i) => ({ time: (i % 20) * 0.25, enemyKey: keys[i % keys.length], routeIndex: i % routes.length, mods: { hpMul: 20 } }));
  const mk = (seed) => realBattle(P, seed, { stageId: 'act2autochess_m01', waveId: 'act1autochess_h07_01', extra, units: 9 }).b;
  for (let w = 0; w < 2; w++) { const b = mk(100 + w); while (b.time < 15) b.step(); }
  const runs = [];
  for (let r = 0; r < 3; r++) {
    const b = mk(7);
    let n = 0, peak = 0;
    const t0 = performance.now();
    while (!b.finished && b.time < 60) {
      b.step();
      if (++n % 3 === 0) { b.snapshot(); b.drainEvents(); }
      peak = Math.max(peak, b.enemies.length);
    }
    runs.push({ avg: (performance.now() - t0) / n, n, peak, allies: b.allyUnits.length });
    assert.ok(peak >= 100, `peak ${peak}`);
    assert.equal(b.allyUnits.filter((u) => u.kind === 'op').length, 18);
    assert.equal(b.errors.length, 0);
  }
  const best = Math.min(...runs.map((x) => x.avg));
  // eslint-disable-next-line no-console
  console.log(`bench boss field: ${runs[0].n} ticks, peak ${runs[0].peak} alive, ${runs[0].allies} allies, avg ${runs.map((x) => (x.avg * 1000).toFixed(1)).join(' / ')} µs/tick (best ${(best * 1000).toFixed(1)}; bar ${BOSS_FIELD_MS_PER_TICK} ms${process.env.CI ? ', CI' : ''})`);
  assert.equal(new Set(runs.map((x) => `${x.n}/${x.peak}`)).size, 1, 'the three runs are the same battle');
  assert.ok(best < BOSS_FIELD_MS_PER_TICK, `best ${best} ms/tick of ${runs.map((x) => x.avg.toFixed(3)).join(', ')}`);
});
