// Battle-level rules: DP & redeploy, pathing around crates, FLY checkpoints, leaks/results, time limit, unite & boss
// fields, shared boss pool, wire format, determinism, robustness, deployment order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { makeBattle, chessRec, enemyRec, flatStage, hashOf, checkInvariants } from '../helpers/battleHarness.js';
import { UF, ANIM, BOND_LAYER_CAP } from '../../shared/constants.js';
import { EV } from '../../shared/protocol.js';
import { getDefaultSource, spawnsFromTemplate, hasGeneratedData } from '../../server/sim/simdata.js';
import { LocalBossPool } from '../../server/sim/spec.js';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const guard = (o = {}) => chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 300, blockCnt: 2 }, skill: null, ...o });
const walker = (o = {}) => enemyRec({ key: 'enemy_walker', hp: 1e6, speed: 1, ...o });

test('initial deployment order: by column from the left, top to bottom within a column (PRTS 从上到下>从左到右 as a scan); the right boss side from its own left', () => {
  // PRTS 卫戍协议/帮助 §作战阶段 "按从上到下>从左到右的顺序部署" (since 2026-03-14; act 1: "从左到右>从下到上") — down each column,
  // the columns from the left: the order PRTS gives the 阿戈尔 devour ("更靠左和靠上"). Until 0.1.3: the top row first
  const h = makeBattle({
    defs: { chess: { a: guard({ id: 'a' }), b: guard({ id: 'b' }), c: guard({ id: 'c' }), d: guard({ id: 'd' }), e: guard({ id: 'e' }) } },
    units: [{ chessId: 'a', row: 9, col: 5 }, { chessId: 'b', row: 12, col: 7 }, { chessId: 'c', row: 12, col: 3 }, { chessId: 'd', row: 10, col: 4 }, { chessId: 'e', row: 12, col: 5 }],
    content: 'none',
  });
  h.step();
  assert.deepEqual(h.hooksOf('deploy').filter((c) => c.initial).map((c) => c.unit.defId), ['c', 'd', 'e', 'a', 'b']);
  assert.equal(h.hooksOf('battleStart').length, 1);
  const hb = makeBattle({
    kind: 'boss',
    defs: { chess: { a: guard({ id: 'a' }), b: guard({ id: 'b' }), c: guard({ id: 'c' }) } },
    players: [{ playerId: 'R1', side: 'R', colOffset: 8, units: [{ uid: 1, chessId: 'a', row: 10, col: 3 }, { uid: 2, chessId: 'b', row: 10, col: 6 }, { uid: 3, chessId: 'c', row: 12, col: 6 }] }],
    content: 'none',
  });
  hb.step();
  const order = hb.hooksOf('deploy').filter((c) => c.initial).map((c) => [c.unit.defId, c.unit.tileR, c.unit.tileC, c.unit.facing]);
  // board rows 10 / 12 → boss rows 3 / 5; mirrored cols: 3 → 17, 6 → 14; its own left first = the highest field column
  assert.deepEqual(order, [['a', 3, 17, -1], ['c', 5, 14, -1], ['b', 3, 14, -1]]);
});

test('DP: starts at 10, +1/s, cap 99; dead operator redeploys after respawnTime when DP ≥ cost', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ stats: { respawnTime: 5, cost: 20 } }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'none', timeLimit: 200,
  });
  h.step();
  const pl = h.b.getPlayer('p1');
  approx(pl.dp, 10 + 1 / 30);
  const g = h.unit('t_guard');
  h.b.dealDamage(null, g, { amount: 1e9, type: 'true' });
  assert.equal(g.alive, false);
  assert.equal(h.result().perPlayer.p1.deaths, 1);
  h.run(5.2);
  assert.equal(g.alive, false, 'respawn time elapsed but DP (≈15) < cost 20');
  h.run(5);
  assert.equal(g.alive, true, 'redeployed once DP reached 20');
  assert.ok(pl.dp < 2, `dp spent (${pl.dp})`);
  approx(g.hp, g.s.maxHp);
  h.run(150);
  assert.equal(pl.dp, 99);
  assert.equal(h.eventsOf('deploy').length, 2);
});

test('battle.redeploy(unit) is instant and free; retreat() keeps respawn timers', () => {
  const h = makeBattle({ defs: { chess: { t_guard: guard({ stats: { respawnTime: 50, cost: 50 } }) } }, units: [{ chessId: 't_guard', row: 9, col: 5 }], content: 'none' });
  h.step();
  const g = h.unit('t_guard');
  h.b.retreat(g);
  assert.equal(g.alive, false);
  assert.equal(h.result().perPlayer.p1.deaths, 0, 'retreat is not a death');
  assert.equal(h.b.redeploy(g), true);
  assert.equal(g.alive, true);
});

test('pathing: enemies walk around crates and re-path when a crate is destroyed', () => {
  // wall off rows 10–12 at col 6 except via a crate on (9,6): the only route goes through the crate
  const rows = { 10: '##hrrr#rrrfrrrrrrrf##', 11: '##hrrr#rrrfrrrrrrrf##', 12: '##hrrr#rrrSrrrrrrrS##' };
  const h = makeBattle({
    flat: { rows, crates: [[9, 6]] },
    defs: { enemies: { enemy_walker: walker({ atk: 500, bat: 1 }) } },
    enemies: [{ key: 'enemy_walker' }], content: 'none', autoFinish: false,
  });
  h.step();
  const crate = h.b.allyUnits.find((u) => u.kind === 'device');
  assert.ok(crate && crate.obstacle, 'crate spawned from stage devices');
  assert.ok(h.b.grid.isObstacle(9, 6));
  const e = h.enemy('enemy_walker');
  h.runUntil(() => e.blockedBy === crate, 20);
  assert.equal(e.blockedBy, crate, 'no way around: blocked by the crate');
  h.runUntil(() => !crate.alive, 10);
  assert.equal(crate.alive, false, 'enemy destroyed the crate');
  assert.equal(h.b.grid.isObstacle(9, 6), false);
  h.runUntil(() => !e.alive, 30);
  assert.equal(h.result().perPlayer.p1.leaked.length, 1);

  // with a detour available the crate is avoided entirely
  const h2 = makeBattle({ flat: { crates: [[9, 6]] }, defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker' }], content: 'none', autoFinish: false });
  const e2 = h2.b.units;
  let touched = false;
  h2.b.on('tick', () => { for (const u of h2.b.enemies) if (Math.round(u.y) === 9 && Math.round(u.x) === 6) touched = true; });
  h2.runUntil(() => h2.b.enemies.length === 0 && h2.b.time > 1, 40);
  assert.equal(touched, false, 'detoured around the crate');
  assert.ok(e2.find((u) => u.kind === 'device').alive);
  // re-path when a new obstacle appears mid-walk
  const h3 = makeBattle({ defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker' }], content: 'none', autoFinish: false });
  h3.run(1);
  const e3 = h3.enemy('enemy_walker');
  h3.b.setObstacle(9, 5, true);
  let crossed = false;
  h3.b.on('tick', () => { if (e3.alive && Math.round(e3.y) === 9 && Math.round(e3.x) === 5) crossed = true; });
  h3.runUntil(() => !e3.alive, 40);
  assert.equal(crossed, false);
});

test('FLY enemies follow their checkpoint route and ignore ground obstacles', () => {
  const route = { motion: 'FLY', start: [9, 10], end: [9, 2], checkpoints: [[12, 9], [12, 4]] };
  const h = makeBattle({
    defs: { enemies: { enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1e6, speed: 2, motion: 'FLY' }) } },
    enemies: [{ key: 'enemy_fly', route }], content: 'none', autoFinish: false,
  });
  const pts = [];
  h.b.on('tick', () => { const e = h.b.enemies[0]; if (e) pts.push([e.y, e.x]); });
  h.runUntil(() => h.b.enemies.length === 0 && h.b.time > 0.5, 60);
  assert.ok(pts.some(([y, x]) => Math.abs(y - 12) < 0.05 && Math.abs(x - 9) < 0.05), 'passed checkpoint (12,9)');
  assert.ok(pts.some(([y, x]) => Math.abs(y - 12) < 0.05 && Math.abs(x - 4) < 0.05), 'passed checkpoint (12,4)');
  const maxY = Math.max(...pts.map((p) => p[0]));
  assert.ok(maxY <= 12 + 1e-9);
  assert.equal(h.result().perPlayer.p1.leaked.length, 1);
});

test('route steps: disappear / wait / appear (teleport) are honoured', () => {
  const route = { motion: 'WALK', start: [9, 10], end: [9, 2], steps: [{ t: 'move', p: [9, 8] }, { t: 'disappear' }, { t: 'wait', s: 2 }, { t: 'appear', p: [9, 4] }] };
  const h = makeBattle({ defs: { enemies: { enemy_walker: walker({ speed: 2 }) } }, enemies: [{ key: 'enemy_walker', route }], content: 'none', autoFinish: false });
  h.run(2.1);
  const e = h.enemy('enemy_walker');
  assert.equal(e.hidden, true);
  assert.ok(!h.snapshot().units.some((t) => t[0] === e.id), 'hidden enemies are not in snapshots');
  h.run(2);
  assert.equal(e.hidden, false);
  assert.ok(e.x <= 4 + 1e-9);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'appear'));
});

test('leaks: recorded per player with enemyKey/mods/lpr/sourcePlayerId; perfect=false; cleared when all gone', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_walker: walker({ speed: 3, lpr: 2 }) } },
    enemies: [{ key: 'enemy_walker', mods: { hpMul: 2 }, sourcePlayerId: 'pX' }], content: 'none',
  });
  const r = h.runToEnd(60);
  assert.equal(r.reason, 'cleared');
  const pp = r.perPlayer.p1;
  assert.equal(pp.leaked.length, 1);
  assert.deepEqual({ ...pp.leaked[0] }, { enemyKey: 'enemy_walker', mods: { hpMul: 2 }, lpr: 2, sourcePlayerId: 'pX', tag: null, counted: true, boss: undefined, spawned: true });
  assert.equal(pp.perfect, false);
  assert.equal(pp.killed, 0);
  assert.equal(pp.total, 1);
  assert.equal(h.eventsOf('leak').length, 1);
  assert.equal(h.hooksOf('enemyLeak').length, 1);
  assert.equal(h.hooksOf('battleEnd').length, 1);
});

test('kills: killed/total counters, bounty coins to the killer\'s owner, perfect clear', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ stats: { atk: 5000 } }) }, enemies: { enemy_walker: walker({ hp: 1000 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_walker', count: 3, interval: 1, bounty: { coins: 2 } }], content: 'none',
  });
  const r = h.runToEnd(60);
  assert.equal(r.reason, 'cleared');
  assert.equal(r.perPlayer.p1.killed, 3);
  assert.equal(r.perPlayer.p1.total, 3);
  assert.equal(r.perPlayer.p1.perfect, true);
  assert.equal(r.perPlayer.p1.coins, 6);
  assert.equal(h.eventsOf('bounty').length, 3);
  assert.equal(h.b.killed, 3);
  assert.equal(h.snapshot().killed, 3);
  assert.equal(h.unit('t_guard').stats.kills, 3);
});

test('time limit: battle ends at timeLimit, remaining enemies count as leaked, unspawned ones are dropped', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_walker: walker({ speed: 0.01 }) } },
    enemies: [{ key: 'enemy_walker', count: 2 }, { key: 'enemy_walker', time: 100 }], timeLimit: 10, content: 'none',
  });
  const r = h.runToEnd(30);
  assert.equal(r.reason, 'timeout');
  approx(r.time, 10, 1 / 30 + 1e-9);
  assert.equal(r.perPlayer.p1.leaked.length, 2);
  assert.equal(r.unspawned.length, 1);
  assert.equal(r.total, 2);
  assert.equal(r.perPlayer.p1.total, 2);
  assert.equal(r.perPlayer.p1.perfect, false);
});

test('forceEnd: forced ends immediately, timeout counts leaks; step after finish is a no-op', () => {
  const h = makeBattle({ defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker' }], content: 'none' });
  h.run(1);
  h.b.forceEnd('forced');
  assert.equal(h.b.finished, true);
  assert.equal(h.result().reason, 'forced');
  const t = h.b.time;
  h.step(5);
  assert.equal(h.b.time, t);
  const h2 = makeBattle({ defs: { enemies: { enemy_walker: walker() } }, enemies: [{ key: 'enemy_walker' }], content: 'none' });
  h2.run(1);
  h2.b.forceEnd('timeout');
  assert.equal(h2.result().reason, 'timeout');
  assert.equal(h2.result().perPlayer.p1.leaked.length, 1);
});

test('unite field: two helpers (colOffset 0 / +8), carryState, per-half attribution, no layer gains', () => {
  const h = makeBattle({
    kind: 'unite',
    defs: { chess: { t_guard: guard({ stats: { atk: 1e5 } }), t_b: guard({ id: 't_b', stats: { atk: 0, maxHp: 1e6, blockCnt: 0 } }) }, enemies: { enemy_walker: walker({ hp: 100, speed: 2 }) } },
    players: [
      { playerId: 'A', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 11, chessId: 't_guard', row: 9, col: 4, carryState: { hpPct: 0.4, sp: 0 } }] },
      { playerId: 'B', seat: 1, side: 'L', colOffset: 8, units: [{ uid: 21, chessId: 't_b', row: 9, col: 7 }] },
    ],
    enemies: [{ key: 'enemy_walker', route: 0, sourcePlayerId: 'A' }, { key: 'enemy_walker', route: 0, time: 0.5, sourcePlayerId: 'B' }],
    content: 'none',
  });
  h.step();
  const a = h.b.allyUnits.find((u) => u.uid === 11), b = h.b.allyUnits.find((u) => u.uid === 21);
  assert.deepEqual([a.tileR, a.tileC, a.facing], [9, 4, 1]);
  assert.deepEqual([b.tileR, b.tileC, b.facing], [9, 15, 1]);
  approx(a.hpRatio, 0.4, 1e-9);
  assert.equal(h.b.flags.layerGainsEnabled, false);
  assert.equal(h.b.addLayers('A', 'yanShip', 5), 0, 'no IN_BATTLE gains in unite');
  const r = h.runToEnd(60);
  assert.equal(r.reason, 'cleared');
  // enemies spawn on the right half (col 18) ⇒ attributed to B's half
  assert.equal(r.perPlayer.B.total, 2);
  assert.equal(r.perPlayer.B.killed, 2);
  assert.equal(r.perPlayer.A.total, 0);
  assert.ok(r.perPlayer.A.damageDealt > 0, 'A dealt the damage');
  assert.equal(r.perPlayer.A.unitsEnd[0].uid, 11);
});

test('boss field: side R is mirrored and faces left; range grid mirrored', () => {
  const sn = chessRec({ id: 't_sn', profession: 'SNIPER', subProfessionId: 'closerange', stats: { atk: 100 }, rangeGrid: [[0, 0], [0, 1], [0, 2]], skill: null });
  const h = makeBattle({
    kind: 'boss',
    defs: { chess: { t_sn: sn }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0 }) } },
    players: [
      { playerId: 'L1', side: 'L', colOffset: 0, units: [{ uid: 1, chessId: 't_sn', row: 11, col: 5 }] },
      { playerId: 'R1', side: 'R', colOffset: 8, units: [{ uid: 2, chessId: 't_sn', row: 11, col: 5 }] },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [4, 13] }, { key: 'enemy_dummy', pos: [4, 7] }],
    content: 'none', autoFinish: false,
  });
  h.run(2);
  const l = h.b.allyUnits.find((u) => u.uid === 1), r = h.b.allyUnits.find((u) => u.uid === 2);
  assert.deepEqual([l.tileR, l.tileC, l.facing], [4, 5, 1]);
  assert.deepEqual([r.tileR, r.tileC, r.facing], [4, 15, -1]);
  const [e1, e2] = h.b.units.filter((u) => u.defId === 'enemy_dummy');
  assert.ok(e1.stats.taken > 0, 'right player hits (4,13) to its left');
  assert.ok(e2.stats.taken > 0, 'left player hits (4,7) to its right');
  assert.equal(e1.ownerId, 'R1');
  assert.equal(e2.ownerId, 'L1');
});

test('shared boss pool: damage routed to the pool from two battles; victory when it reaches 0', () => {
  const pool = {
    hp: 20000, maxHp: 20000, byPlayer: {},
    damage(pid, amount) { const d = Math.min(this.hp, amount); this.hp -= d; this.byPlayer[pid] = (this.byPlayer[pid] ?? 0) + d; },
  };
  const mk = (pid) => makeBattle({
    kind: 'boss', sharedBoss: pool,
    defs: { chess: { t_guard: guard({ stats: { atk: 2000, maxHp: 1e6 } }) }, enemies: { enemy_boss: enemyRec({ key: 'enemy_boss', rank: 'BOSS', hp: 999, speed: 0 }) } },
    players: [{ playerId: pid, side: 'L', units: [{ uid: 1, chessId: 't_guard', row: 10, col: 4 }] }],
    enemies: [{ key: 'enemy_boss', pos: [3, 5], tag: 'boss' }], content: 'none',
  });
  const h1 = mk('P1'), h2 = mk('P2');
  h1.step(); h2.step();
  const boss1 = h1.enemy('enemy_boss');
  assert.equal(boss1.isBoss, true);
  assert.equal(Math.round(boss1.s.maxHp), 20000);
  assert.equal(h1.b.total, 0, 'boss not counted in total');
  while (!h1.b.finished || !h2.b.finished) { h1.b.step(); h2.b.step(); if (h1.b.time > 60) break; }
  assert.equal(pool.hp, 0);
  const r1 = h1.result(), r2 = h2.result();
  assert.equal(r1.reason, 'cleared');
  assert.equal(r2.reason, 'cleared');
  assert.equal(r1.bossHpLeft, 0);
  approx(r1.perPlayer.P1.bossDamage + r2.perPlayer.P2.bossDamage, 20000, 1e-6);
  assert.ok(pool.byPlayer.P1 > 0 && pool.byPlayer.P2 > 0);
  assert.ok(h1.snapshot().boss);
});

test('boss field with a shared pool: an emptied field (leader leaked) keeps running until the pool is 0 or the match ends it', () => {
  // DESIGN §5.5: boss battles end by the pool or the match — never 'cleared' just because the field emptied.
  const mk = (pool) => makeBattle({
    kind: 'boss', sharedBoss: pool,
    defs: { enemies: { enemy_boss: enemyRec({ key: 'enemy_boss', rank: 'BOSS', hp: 999, speed: 4, lpr: 2 }) } },
    players: [{ playerId: 'P', side: 'L', units: [] }],
    enemies: [{ key: 'enemy_boss', route: 0, tag: 'boss' }], content: 'none',
  });
  const pool = new LocalBossPool(50000);
  const h = mk(pool);
  assert.ok(h.runUntil(() => h.hooks.enemyLeak.length > 0, 60), 'the leader walks into the objective');
  h.run(300);
  assert.equal(h.b.finished, false, 'no "cleared" while the pool is above 0');
  assert.equal(h.b.enemies.length, 0);
  pool.sync(0, 0);   // another field emptied the shared pool
  h.step();
  assert.equal(h.result().reason, 'cleared');
  const h2 = mk(new LocalBossPool(50000));
  h2.run(60);
  h2.b.forceEnd('forced'); // team LP 0 (overtime drain)
  const r = h2.result();
  assert.equal(r.reason, 'forced');
  assert.deepEqual(r.perPlayer.P.leaked.map((l) => [l.enemyKey, l.lpr, l.boss]), [['enemy_boss', 2, true]]);
  // without a shared pool (sandboxes, tools) a boss-kind battle still ends when it empties
  const h3 = mk(null);
  assert.equal(h3.runToEnd(120).reason, 'cleared');
});

test('Final Assault h07_04 (pair): 昆图斯 walking into the objective does not end the field while the pool is full', { skip: !hasGeneratedData() && 'no generated data' }, () => {
  // Regression: the official pair route of the leader has no wait step; with nobody blocking him he leaked at ~180 s
  // and the field used to finish 'cleared' at once, ending the Final Assault as a defeat with team LP left.
  // Officially he is 自缚 (PRTS 天赋; content/bosses.js SELF_BOUND, user playtest #5) and never walks it — the engine
  // rule is still checked by lifting the 自缚 buff.
  const pool = new LocalBossPool(708750);
  const opts = { kind: 'boss', stageId: 'act2autochess_m02', rect: { r0: 0, r1: 5, c0: 0, c1: 20 }, waveTemplate: 'act1autochess_h07_04', sharedBoss: pool, units: [] };
  const bound = makeBattle({ ...opts, sharedBoss: new LocalBossPool(708750) });
  bound.run(400);
  assert.ok(!bound.hooks.enemyLeak.some((x) => x.enemy.defId === 'enemy_1521_dslily'), '自缚: he stays');
  assert.equal(bound.b.finished, false);
  const h = makeBattle(opts);
  assert.ok(h.runUntil(() => h.b.enemies.some((e) => e.defId === 'enemy_1521_dslily'), 5));
  for (const e of h.b.enemies) if (e.defId === 'enemy_1521_dslily') h.b.removeBuff(e, 'boss:selfBound');
  assert.ok(h.runUntil(() => h.hooks.enemyLeak.some((x) => x.enemy.defId === 'enemy_1521_dslily'), 400), 'the leader leaks');
  h.run(200);
  assert.equal(h.b.finished, false);
  assert.equal(pool.hp, 708750);
  h.b.forceEnd('forced');
  assert.equal(h.result().reason, 'forced');
});

test('boss battles: infinite time limit, leaks carry lpr, match ends via forceEnd', () => {
  const h = makeBattle({
    kind: 'boss',
    defs: { enemies: { enemy_walker: walker({ speed: 4, lpr: 3 }), enemy_boss: enemyRec({ key: 'enemy_boss', hp: 1e9, speed: 0 }) } },
    players: [{ playerId: 'P', side: 'L', units: [] }],
    enemies: [{ key: 'enemy_walker', route: 0 }, { key: 'enemy_boss', pos: [3, 9], tag: 'boss' }], content: 'none',
  });
  h.run(200);
  assert.equal(h.b.finished, false);
  assert.equal(h.b.timeLimit, Infinity);
  h.b.forceEnd('forced');
  const r = h.result();
  assert.equal(r.reason, 'forced');
  assert.equal(r.perPlayer.P.leaked[0].lpr, 3);
});

test('snapshot / event wire format (DESIGN §8.2)', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ stats: { atk: 100, maxHp: 5000 } }) }, enemies: { enemy_walker: walker({ atk: 100, hp: 3000 }), enemy_fly: enemyRec({ key: 'enemy_fly', hp: 500, speed: 3, motion: 'FLY' }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_walker' }, { key: 'enemy_fly', route: 2 }], content: 'generic', fieldId: 'n:p1',
  });
  h.run(10.5); // walker (0.5 tiles/s) reaches the guard at ~9 s
  const snap = h.snapshot();
  assert.deepEqual(Object.keys(snap).slice(0, 6), ['fieldId', 't', 'units', 'dp', 'killed', 'total']);
  assert.equal(snap.fieldId, 'n:p1');
  for (const u of snap.units) {
    assert.equal(u.length, 9);
    const [id, x, y, hp, maxHp, sp, spMax, flags, anim] = u;
    assert.ok(Number.isInteger(id) && Number.isInteger(hp) && Number.isInteger(maxHp) && Number.isInteger(flags) && Number.isInteger(anim));
    for (const v of [x, y, sp, spMax]) assert.ok(Number.isFinite(v));
    assert.ok(Object.values(ANIM).includes(anim));
    assert.ok(hp <= maxHp);
  }
  const g = snap.units.find((u) => u[0] === h.unit('t_guard').id);
  assert.ok(g[7] & UF.BLOCKED, 'guard is blocking');
  const allEv = h.events;
  const kinds = new Set(Object.values(EV));
  for (const ev of allEv) assert.ok(kinds.has(ev[0]), `known event ${ev[0]}`);
  const spawn = allEv.find((e) => e[0] === 'spawn');
  assert.deepEqual(Object.keys(spawn[1]).filter((k) => spawn[1][k] !== undefined).slice(0, 15).sort(),
    ['avatar', 'defId', 'dir', 'facing', 'golden', 'id', 'kind', 'maxHp', 'name', 'ownerId', 'side', 'spine', 'tier', 'x', 'y'].sort());
  assert.ok(['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(spawn[1].dir), 'UnitInfo.dir is a direction');
  const atk = allEv.find((e) => e[0] === 'atk');
  assert.equal(atk.length, 4);
  const dmg = allEv.find((e) => e[0] === 'dmg');
  assert.equal(dmg.length, 4);
  assert.ok(['phys', 'arts', 'true', 'burn', 'neural', 'necrosis', 'apoptosis'].includes(dmg[3]));
  const flyInSnap = h.b.units.find((u) => u.defId === 'enemy_fly');
  if (flyInSnap.alive) assert.ok(snap.units.find((u) => u[0] === flyInSnap.id)[7] & UF.FLYING);
  assert.deepEqual(h.b.drainEvents(), [], 'drained');
  const meta = h.b.fieldMeta();
  assert.equal(meta.kind, 'normal');
  assert.ok(Array.isArray(meta.units));
  JSON.stringify(snap); // serialisable
});

test('determinism: same seed ⇒ identical result and event stream; different seed may differ', () => {
  const ds = getDefaultSource();
  const tpl = ds.getWave('act1autochess_05');
  const run = (seed) => {
    const { routes, spawns, maxPlayTime } = spawnsFromTemplate(tpl);
    const b = new Battle({
      seed, kind: 'normal', stageId: 'act2autochess_m03', timeLimit: maxPlayTime, routes, spawns, logger: { error() {}, warn() {} },
      players: [{ playerId: 'p', units: [
        { uid: 1, chessId: 'chess_char_1_02_a', row: 9, col: 7 }, { uid: 2, chessId: 'chess_char_1_01_a', row: 10, col: 5 },
        { uid: 3, chessId: 'chess_char_4_09_a', row: 12, col: 6 }, { uid: 4, chessId: 'chess_char_2_02_a', row: 11, col: 5 },
        { uid: 5, chessId: 'chess_char_3_08_a', row: 10, col: 6 },
      ] }],
    });
    const ev = [];
    while (!b.finished) { b.step(); if (b.tickCount % 3 === 0) ev.push(b.snapshot()); ev.push(b.drainEvents()); }
    return { res: hashOf(b.result()), ev: hashOf(ev) };
  };
  const a = run(1234), b = run(1234);
  assert.deepEqual(a, b);
});

test('robustness: throwing content handlers / kits never crash the battle', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ stats: { atk: 2000 } }) }, enemies: { enemy_walker: walker({ hp: 2000 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_walker', count: 3, interval: 1 }],
    kits: { t_guard: () => { throw new Error('bad kit'); } },
    setup: (b) => {
      b.on('hit', () => { throw new Error('bad hit handler'); });
      b.on('tick', () => { throw new Error('bad tick handler'); });
      b.after(1, () => { throw new Error('bad timer'); });
      b.addBuff(b.allyUnits[0], { key: 'x', onTick: () => { throw new Error('bad buff'); } });
    },
  });
  const r = h.runToEnd(60);
  assert.equal(r.reason, 'cleared');
  assert.ok(h.b.errorCount > 0);
  assert.ok(h.b.errors.some((e) => /bad kit/.test(e.message)));
  assert.ok(h.b.errors.length < 20, 'errors are logged once per key');
  checkInvariants(h.b);
});

test('hook bus: priority order, owner removal, once, off by handle', () => {
  const h = makeBattle({ content: 'none' });
  const order = [];
  const owner = {};
  h.b.on('custom', () => order.push('p0'));
  h.b.on('custom', () => order.push('p10'), { priority: 10 });
  h.b.on('custom', () => order.push('p0b'));
  h.b.on('custom', () => order.push('owned'), { owner });
  const once = h.b.on('custom', () => order.push('once'), { once: true, priority: 5 });
  h.b.emit('custom', {});
  assert.deepEqual(order, ['p10', 'once', 'p0', 'p0b', 'owned']);
  order.length = 0;
  h.b.offOwner(owner);
  h.b.emit('custom', {});
  assert.deepEqual(order, ['p10', 'p0', 'p0b']);
  assert.ok(once.removed);
});

test('scheduling: after / every with cancel', () => {
  const h = makeBattle({ content: 'none' });
  let a = 0, e = 0;
  h.b.after(1, () => a++);
  const ev = h.b.every(0.5, () => e++);
  h.run(2.01);
  assert.equal(a, 1);
  assert.equal(e, 4);
  ev.cancel();
  h.run(2);
  assert.equal(e, 4);
});

test('layers & coins: addLayers records gains (normal field) and emits client events', () => {
  const h = makeBattle({ content: 'none', bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 10 } } });
  h.step();
  assert.equal(h.b.addLayers('p1', 'yanShip', 3, 'test'), 3);
  assert.equal(h.b.getPlayer('p1').bonds.yanShip.layers, 13);
  h.b.addCoins('p1', 2);
  h.b.forceEnd('forced');
  const r = h.result();
  assert.deepEqual(r.perPlayer.p1.layerGains, { yanShip: 3 });
  assert.equal(r.perPlayer.p1.coins, 2);
  assert.ok(h.eventsOf('layer').some((e) => e[1] === 'p1' && e[2] === 'yanShip' && e[3] === 3));
  const h2 = makeBattle({ content: 'none', flags: { layerGainsEnabled: false } });
  assert.equal(h2.b.addLayers('p1', 'yanShip', 3), 0);
});

test('layers: an IN_BATTLE gain stops at BOND_LAYER_CAP (999, MAX_GARRISON_STACK) — the battle\'s count and the reported gain', () => {
  assert.equal(BOND_LAYER_CAP, 999);
  const h = makeBattle({ content: 'none', bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 995 } } });
  h.step();
  assert.equal(h.b.addLayers('p1', 'yanShip', 3, 'test'), 3);
  assert.equal(h.b.addLayers('p1', 'yanShip', 5, 'test'), 1, 'only the room left under the cap');
  assert.equal(h.b.addLayers('p1', 'yanShip', 5, 'test'), 0, 'at the cap: nothing');
  assert.equal(h.b.getPlayer('p1').bonds.yanShip.layers, 999);
  h.b.forceEnd('forced');
  assert.deepEqual(h.result().perPlayer.p1.layerGains, { yanShip: 4 });
  assert.deepEqual(h.eventsOf('layer').map((e) => e[3]), [3, 1], 'the client sees what was added');
});

test('tokens: spawnToken deploys a token next to its owner; manual token pieces deploy from input', () => {
  const ds = getDefaultSource();
  const h = makeBattle({
    units: [{ chessId: 'chess_char_2_02_a', row: 10, col: 4, uid: 7 }, { kind: 'token', tokenId: 'token_10000_silent_healrb', ownerUid: 7, row: 10, col: 5, uid: 8 }],
    content: 'generic',
  });
  h.step();
  const tok = h.b.allyUnits.find((u) => u.kind === 'token');
  assert.ok(tok && tok.alive);
  assert.ok(tok.s.flags.untargetable, '医疗探机 cannot be attacked');
  assert.equal(tok.profile.dmgType, 'heal');
  const t2 = h.b.spawnToken(h.unit(7), 'token_10000_silent_healrb', 11, 4, { duration: 1 });
  assert.ok(t2 && t2.alive);
  h.run(1.1);
  assert.equal(t2.alive, false, 'expired');
  assert.ok(ds.getToken('token_10000_silent_healrb', 'chess_char_2_02_b').stats.atk > ds.getToken('token_10000_silent_healrb', 'chess_char_2_02_a').stats.atk);
});

test('displacement helper moves enemies along passable tiles and re-paths', () => {
  const h = makeBattle({ defs: { enemies: { enemy_walker: walker({ speed: 0.01 }) } }, enemies: [{ key: 'enemy_walker', pos: [10, 6] }], content: 'none', autoFinish: false });
  h.step();
  const e = h.enemy('enemy_walker');
  const moved = h.b.displace(e, { x: 1, y: 0 }, 2, { force: 1 });
  assert.ok(moved > 1.8);
  approx(Math.round(e.x), 8);
  const blocked = h.b.displace(e, { x: 0, y: 1 }, 5);
  assert.ok(e.y <= 12.5);
  assert.ok(blocked <= 3);
});

test('content modules: a throwing install() is logged and skipped; units outside the rect are not deployed', () => {
  let ran = false;
  const h = makeBattle({
    defs: { chess: { t_guard: guard() }, enemies: { enemy_walker: walker({ hp: 100 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }, { chessId: 't_guard', row: 3, col: 5, abs: true }],
    enemies: [{ key: 'enemy_walker' }],
    extraContent: [{ install() { throw new Error('broken module'); } }, { install(b) { b.on('battleStart', () => { ran = true; }); } }],
  });
  const r = h.runToEnd(60);
  assert.equal(ran, true, 'later modules still installed');
  assert.ok(h.b.errors.some((e) => /broken module/.test(e.message)));
  assert.equal(h.b.allyUnits.filter((u) => u.deployed || u.alive).length, 1);
  assert.equal(r.reason, 'cleared');
  checkInvariants(h.b);
});
