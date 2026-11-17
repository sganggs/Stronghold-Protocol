// AI player (server/match/bot.js): field model, layout planner, rehearsal, buying / leveling / bench management.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNormalWave } from '../../server/match/waves.js';
import { PHASE } from '../../shared/constants.js';
import { fieldModel, planLayout, rehearse, createRehearsalSteps, rangeTiles, REHEARSAL_VARIANTS, LAYOUT_PARAMS, botPickCard, botPickBand } from '../../server/match/bot.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { registerMeta, registerExtensionMeta, resetExtensions } from '../../server/sim/content/extensions.js';
import { budgetUsed, charge, DEFAULT_BUDGET } from '../../server/sim/content/dsl/budget.js';
import { FIELD, canPlace, placeClass, parseKey, legalTiles, tileKey } from '../../server/match/board.js';
import { makeMatch, checkInvariants, give, giveItem, DATA } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';

const soloBot = (o = {}) => makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], ...o });

test('user: Given two medics with different ranges, When planning a boss formation, Then provide healing coverage to both ranged damage dealers', () => {
  const { m } = makeMatch({ mode: 'coop', humans: 3, difficulty: 'HARD', seed: 204 }).start().toPrep();
  const ps = m.order[0];
  try {
    m.startRound(m.gd.bossRound);
    const pieces = ['1_19_b', '2_18_b', '4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '6_20_a']
      .map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
    const plan = planLayout(m, ps, pieces);
    const coverage = new Set(pieces.slice(6).flatMap((medic) => {
      const [row, col] = parseKey(plan.get(medic.uid));
      return rangeTiles(ps.gd.chess(medic.id), row, col, plan.dirs.get(medic.uid));
    }));
    for (const ally of pieces.slice(2, 4)) {
      assert.ok(coverage.has(plan.get(ally.uid)), `${ps.gd.chess(ally.id).name} receives medical coverage`);
    }
  } finally { m.dispose(); }
});

for (const [seed, ids] of [
  [144, ['1_06_a', '3_05_b', '2_17_b', '2_06_b', '4_18_a', '2_17_a', '1_09_a', '2_04_b']],
  [173, ['1_04_a', '4_16_a', '1_18_a', '2_06_b', '1_06_b', '4_06_b', '1_01_a', '4_12_a']],
]) test(`user: Given a ground-capable medic in formation ${seed}, When planning a battle, Then do not hold an enemy outside allied fire until timeout`, () => {
  const { m } = makeMatch({ mode: 'coop', humans: 4, difficulty: 'HARD', seed }).start().toPrep();
  const ps = m.order[0];
  try {
    const pieces = ids.map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
    const plan = planLayout(m, ps, pieces);
    const battle = makeBattle({
      stageId: m.stageId, routes: m.wave.routes, timeLimit: 100,
      enemies: [{ key: 'enemy_1006_shield_2', time: 30, route: 0, count: 3, interval: 1 }],
      units: pieces.map((p) => {
        const [row, col] = parseKey(plan.get(p.uid));
        assert.ok(canPlace(ps.deployMap(), placeClass(ps, DATA.chess[p.id]), row, col));
        return { chessId: p.id, uid: p.uid, row, col, dir: plan.dirs.get(p.uid) };
      }),
    });
    battle.runToEnd();
    assert.equal(battle.result().perPlayer.p1.killed, 3, 'the medic must not keep the final enemy away from damage');
    assert.equal(battle.result().perPlayer.p1.leaked.length, 0);
    battle.invariants();
  } finally { m.dispose(); }
});


for (const [humans, seed] of [[1, 60], [3, 5]]) test(`user: Given a full formation in a ${humans}-seat match, When planning a self-range guard, Then keep its road position covered by allied fire`, () => {
  const h = makeMatch({ mode: 'coop', humans, difficulty: 'HARD', seed }).start().toPrep().setStage('act1autochess_m02');
  const m = h.m;
  const ps = m.order[0];
  try {
    const pieces = ['1_02_a', '1_01_b', '2_10_a', '2_14_a', '2_16_b', '1_13_b', '3_17_a', '1_19_b']
      .map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
    const plans = REHEARSAL_VARIANTS.slice(0, 3).map((v) => planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, ...v }));
    for (const [variant, plan] of plans.entries()) {
      let guardBlocks = 0;
      let supportedHits = 0;
      const battle = makeBattle({
        stageId: m.stageId, routes: m.wave.routes, timeLimit: 100,
        enemies: [{ key: 'enemy_1006_shield_2', time: 30, route: 0, count: 3, interval: 1 }],
        units: pieces.map((p) => {
          const [row, col] = parseKey(plan.get(p.uid));
          return { chessId: p.id, uid: p.uid, row, col, dir: plan.dirs.get(p.uid) };
        }),
        setup(b) {
          b.on('blocked', ({ blocker }) => { if (blocker.defId === pieces[0].id) guardBlocks++; });
          b.on('damaged', ({ source, target, amount }) => {
            if (amount > 0 && target.blockedBy?.defId === pieces[0].id && source?.side === 'ally' && source.defId !== pieces[0].id) supportedHits++;
          });
        },
      });
      battle.runToEnd();
      if (variant === 1) assert.ok(guardBlocks > 0, 'the heavy guard actually blocks the enemy');
      if (guardBlocks > 0) assert.ok(supportedHits > 0, 'other operators damage the enemy while the heavy guard holds it');
      assert.equal(battle.result().perPlayer.p1.leaked.length, 0);
      battle.invariants();
      assert.ok(fieldModel(m, ps).ground.has(plan.get(pieces[0].uid)), 'the guard stays on the enemy road');
    }
  } finally { m.dispose(); }
});

test('user: Given two ground routes meeting at a guard, When planning support, Then allies can kill enemies from either entrance', () => {
  const { m } = makeMatch({ mode: 'coop', humans: 3, difficulty: 'HARD', seed: 8 }).start().toPrep().setStage('act2autochess_m02');
  const ps = m.order[0];
  try {
    const routes = [[9, 10], [12, 10]].map((start) => ({ motion: 'WALK', start, end: [9, 2], checkpoints: [] }));
    m.wave = { ...m.wave, routes, spawns: routes.map((_, routeIndex) => ({ enemyKey: 'enemy_1006_shield_2', routeIndex, count: 3 })) };
    const pieces = ['1_02_a', '1_06_b', '2_07_a', '1_10_b', '2_09_a', '2_01_b', '1_18_a', '2_12_b']
      .map((id) => give(m, ps, `chess_char_${id}`, 'hand'));
    const plan = planLayout(m, ps, pieces);
    for (const route of [0, 1]) {
      const battle = makeBattle({
        stageId: m.stageId, routes, timeLimit: 100,
        enemies: [{ key: 'enemy_1006_shield_2', time: 30, route, count: 3, interval: 1 }],
        units: pieces.map((p) => {
          const [row, col] = parseKey(plan.get(p.uid));
          return { chessId: p.id, uid: p.uid, row, col, dir: plan.dirs.get(p.uid) };
        }),
      });
      battle.runToEnd();
      assert.equal(battle.result().perPlayer.p1.killed, 3, `kill enemies entering from route ${route}`);
      assert.equal(battle.result().perPlayer.p1.leaked.length, 0);
      battle.invariants();
    }
  } finally { m.dispose(); }
});

test('user: Given a saturated layout, When placing a self-range defender, Then prefer a free enemy path tile', () => {
  const h = makeMatch({ mode: 'solo', seed: 11 }).start().toPrep();
  const m = h.m;
  const ps = m.order[0];
  try {
    const pieces = ['chess_char_6_03_a', 'chess_char_5_11_a', 'chess_char_1_02_a',
      'chess_char_1_10_a', 'chess_char_2_08_a', 'chess_char_3_16_a'].map((id) => give(m, ps, id, 'hand'));
    const plan = planLayout(m, ps, pieces);
    // act2autochess_m04, first wave: the ground route crosses these deployable tiles.
    const road = new Set(['9,9', '9,8', '9,7', '9,6', '11,5', '11,4', '10,4', '9,4', '9,3']);
    assert.equal(m.stageId, 'act2autochess_m04');
    assert.ok(road.has(plan.get(pieces.at(-1).uid)), `Cuora must block the route, got ${plan.get(pieces.at(-1).uid)}`);
    for (const [key, expectedToBlock] of [[plan.get(pieces.at(-1).uid), true], ['12,5', false]]) {
      const [row, col] = parseKey(key);
      const battle = makeBattle({ stageId: m.stageId, waveTemplate: 'act1autochess_01',
        units: [{ chessId: 'chess_char_3_16_a', row, col }] });
      battle.runToEnd();
      assert.equal(battle.hooksOf('blocked').length > 0, expectedToBlock, `blocking at ${key}`);
      assert.equal(battle.result().perPlayer.p1.damageDealt > 0, expectedToBlock, `damage at ${key}`);
    }
    // When every path position is occupied, a legal fallback remains available.
    const fallback = planLayout(m, ps, [pieces.at(-1)], undefined, { occupied: road });
    const key = fallback.get(pieces.at(-1).uid);
    assert.ok(key && !road.has(key));
    assert.equal(ps.deployMap().get(key), 'melee');
  } finally { m.dispose(); }
});

test('self-range blockers (range 0-1, only their own tile) fill the free enemy-road tiles before any other tile, on every stage and seed', () => {
  // official range_table "0-1": the one grid (0,0) — 角峰 古米 泡泡 折桠 菲莱 蛇屠箱 塞雷娅 余
  const guards = Object.values(DATA.chess).filter((c) => c && !c.isGolden && c.rangeGrid && c.rangeGrid.length === 1 && c.rangeGrid[0].every((v) => v === 0));
  assert.equal(guards.length, 8);
  const stages = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const h = makeMatch({ mode: 'solo', seed }).start().toPrep();
    const m = h.m;
    const ps = m.order[0];
    try {
      stages.add(m.stageId);
      const pieces = guards.map((c) => give(m, ps, c.chessId, 'hand'));
      const plan = planLayout(m, ps, pieces);
      const model = fieldModel(m, ps);
      const road = legalTiles(ps.deployMap(), 'melee').filter(([r, c]) => model.ground.has(tileKey(r, c)));
      const onRoad = pieces.filter((p) => model.ground.has(plan.get(p.uid))).length;
      assert.equal(onRoad, Math.min(pieces.length, road.length), `seed ${seed}, ${m.stageId}: ${onRoad} of ${pieces.length} guards on the ${road.length} road tiles`);
    } finally { m.dispose(); }
  }
  assert.equal(stages.size, 8, 'every stage was tried');
});

test('field model: the round\'s routes traced over the own board, weighted by the enemies that use them', () => {
  const h = soloBot({ seed: 2 }).start();
  const m = h.m;
  h.run(() => m.phase === PHASE.PREP && m.round === 2);
  const model = fieldModel(m);
  assert.ok(model.routes.length > 0);
  const enemies = m.wave.spawns.reduce((s, x) => s + Math.max(1, x.count || 1), 0);
  assert.equal(model.routes.reduce((s, r) => s + r.n, 0), enemies, 'every spawned enemy is on one traced route');
  for (const rt of model.routes) {
    assert.ok(rt.tiles.length > 0 && rt.tileTime > 0 && rt.hp > 0);
    for (const k of rt.tiles) {
      const [r, c] = parseKey(k);
      assert.ok(r >= FIELD.r0 && r <= FIELD.r1 && c >= 0 && c <= FIELD.c1, `route tile ${k} inside the own board`);
    }
  }
  // ground routes follow the stage's device-aware ground paths
  const st = m.stage;
  const paths = st.groundPathsWithDevices || st.groundPaths;
  const ground = m.wave.routes.filter((r) => r.motion !== 'FLY');
  for (const rt of ground) {
    const path = paths[`${rt.start[0]},${rt.start[1]}->${rt.end[0]},${rt.end[1]}`];
    if (!path) continue;
    for (const [r, c] of path.slice(0, -1)) if (r >= 9 && r <= 12 && c <= 10) assert.ok(model.ground.has(`${r},${c}`), `ground path tile ${r},${c}`);
  }
  assert.equal(fieldModel(m), model, 'cached per round');
  m.dispose();
});

test('field model: 近地悬浮 enemies (掠海漂移体) walk the ground path but count as air units (no blocker credit, anti-air needed)', () => {
  const h = soloBot({ seed: 2 }).start();
  const m = h.m;
  h.run(() => m.phase === PHASE.PREP && m.round === 2);
  const groundRi = new Set(m.wave.routes.map((r, i) => (r.motion !== 'FLY' ? i : -1)).filter((i) => i >= 0));
  const before = fieldModel(m);
  assert.ok(before.ground.size > 0);
  m.wave = { ...m.wave, spawns: m.wave.spawns.map((s) => (groundRi.has(s.routeIndex) && s.tag !== 'boss' ? { ...s, enemyKey: 'enemy_2025_syufo' } : s)) };
  m._botPath = null;
  const model = fieldModel(m);
  const hover = m.wave.spawns.filter((s) => s.enemyKey === 'enemy_2025_syufo').reduce((a, s) => a + Math.max(1, s.count || 1), 0);
  assert.ok(hover > 0);
  assert.ok(model.flyTotal >= hover, `${model.flyTotal} ≥ ${hover}`);
  const hov = model.routes.filter((r) => r.fly && r.tiles.some((k) => before.ground.has(k)));
  assert.ok(hov.length > 0, 'an air route on the ground path tiles');
  m.dispose();
});

test('layout planner: legal distinct tiles; blockers on the enemy road, ranged units cover it without standing on it', () => {
  const h = soloBot({ seed: 3 }).start();
  const m = h.m;
  h.run(() => m.phase === PHASE.PREP && m.round === 2);
  const ps = m.order[0];
  // a controlled lineup: 2 blockers, 3 ranged
  for (const p of [...ps.board.values()]) ps.board.delete([...ps.board.entries()].find(([, x]) => x === p)[0]);
  ps.hand.fill(null);
  ps.recompute();
  const melee = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 1 && c.position === 'MELEE' && c.attackKind === 'melee' && c.stats.blockCnt >= 1).slice(0, 2);
  const ranged = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 1 && c.position === 'RANGED' && c.attackKind === 'ranged').slice(0, 3);
  const pieces = [...melee, ...ranged].map((c) => give(m, ps, c.chessId, 'hand'));
  const plan = planLayout(m, ps, pieces);
  assert.equal(plan.size, pieces.length);
  assert.equal(new Set(plan.values()).size, pieces.length, 'distinct tiles');
  const map = ps.deployMap();
  const model = fieldModel(m);
  for (const p of pieces) {
    const [r, c] = parseKey(plan.get(p.uid));
    assert.ok(canPlace(map, placeClass(ps, m.gd.chess(p.id)), r, c), `${p.id} legal at ${r},${c}`);
  }
  for (const p of pieces.slice(0, 2)) assert.ok(model.ground.has(plan.get(p.uid)), 'a blocker stands on the enemy road');
  for (const p of pieces.slice(2)) {
    const rec = m.gd.chess(p.id);
    const [r, c] = parseKey(plan.get(p.uid));
    // the planned direction rotates the range (DESIGN §3)
    const dir = plan.dirs.get(p.uid);
    assert.ok(['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(dir), `${rec.name} has a planned direction`);
    const covered = rangeTiles(rec, r, c, dir).some((k) => model.ground.has(k) || model.routes.some((rt) => rt.fly && rt.tiles.includes(k)));
    assert.ok(covered, `${rec.name} covers the enemy route from ${r},${c} facing ${dir}`);
  }
  m.dispose();
});

test('rehearsal: candidate layouts are simulated without side effects; the chosen plan is one of them', () => {
  const h = soloBot({ seed: 4, botRehearsal: 3 }).start();
  const m = h.m;
  h.run(() => m.phase === PHASE.PREP && m.round === 3);
  const ps = m.order[0];
  const chosen = ps.allChess().slice(0, ps.deployCap);
  assert.ok(chosen.length >= 3);
  const snap = () => JSON.stringify({ board: [...ps.board.entries()].map(([k, p]) => [k, p.uid, p.dir]), hand: ps.hand.map((p) => p && p.uid), bonds: ps.bonds, pool: m.pool.snapshot(), lp: ps.lp, funds: ps.funds, layers: ps.layers, round: m.round, phase: m.phase, uid: m.uidSeq });
  const before = snap();
  const plans = REHEARSAL_VARIANTS.map((v) => planLayout(m, ps, chosen, { ...LAYOUT_PARAMS, ...v }));
  const best = rehearse(m, ps, chosen, plans);
  assert.ok(plans.includes(best));
  assert.equal(snap(), before, 'board, hand, bonds, pool, economy untouched');
  assert.equal(m.errorCount, 0);
  checkInvariants(m);
  // the whole match still runs deterministically with rehearsal on
  const run = () => { const x = soloBot({ seed: 11, botRehearsal: 3, difficulty: 'FUNNY' }).start(); return JSON.stringify({ ...x.runToEnd(), durationMs: 0 }); };
  assert.equal(run(), run());
  m.dispose();
});

test('rehearsal runs in bounded slices between scheduler callbacks and plays exactly like the one-shot run', () => {
  const run = (botSliceMs) => {
    const h = soloBot({ seed: 11, botRehearsal: 3, difficulty: 'FUNNY', botSliceMs }).start();
    const m = h.m;
    /** scheduler callback → rehearsal ticks stepped in it */
    const perCallback = new Map();
    const newBattle = m.newBattle.bind(m);
    m.newBattle = (opts) => {
      const b = newBattle(opts);
      if (String(opts.fieldId).startsWith('r:')) {
        const step = b.step.bind(b);
        b.step = () => { perCallback.set(h.sched.executed, (perCallback.get(h.sched.executed) || 0) + 1); step(); };
      }
      return b;
    };
    const end = h.runToEnd();
    assert.equal(m.errorCount, 0);
    m.dispose();
    return { result: JSON.stringify({ ...end, durationMs: 0 }), perCallback };
  };
  const whole = run(undefined);
  const sliced = run(1e-6);
  assert.ok(whole.perCallback.size > 0, 'sanity: the bot rehearsed');
  assert.ok(Math.max(...whole.perCallback.values()) > 500, 'unbounded: a whole rehearsal in one callback (virtual time)');
  assert.ok(Math.max(...sliced.perCallback.values()) <= 4, `sliced: ≤ 4 ticks per callback (got ${Math.max(...sliced.perCallback.values())})`);
  assert.ok(sliced.perCallback.size > whole.perCallback.size * 10);
  assert.equal(sliced.result, whole.result, 'same decisions, same match');
});

test('the prep routine itself (shop, lineup, layout planning) runs in bounded slices and plays exactly like the one-shot run', () => {
  const seats = [0, 1].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const run = (botSliceMs) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 13, fake: true, botRehearsal: 3, botSliceMs }).start();
    const m = h.m;
    /** `${bot}:${round}` → the scheduler callbacks in which the bot acted */
    const cbs = new Map();
    for (const ps of m.players.values()) {
      for (const k of ['buy', 'move', 'sell', 'levelUp', 'refresh', 'equip', 'pickReward']) {
        const f = ps[k].bind(ps);
        ps[k] = (...a) => {
          const key = `${ps.playerId}:${m.round}`;
          if (!cbs.has(key)) cbs.set(key, new Set());
          cbs.get(key).add(h.sched.executed);
          return f(...a);
        };
      }
    }
    h.run(() => h.ended != null || (m.phase === PHASE.SETTLE && m.round === 6), { maxSteps: 5e6 });
    assert.equal(m.errorCount, 0);
    checkInvariants(m);
    const state = JSON.stringify([...m.players.values()].map((ps) => ({
      board: [...ps.board.entries()].map(([k, p]) => [k, p.id, p.dir ?? null, (p.items || []).map((x) => x.id)]),
      hand: ps.hand.map((p) => p && p.id), funds: ps.funds, level: ps.shop.level, lp: ps.lp, bonds: ps.bonds,
    })));
    m.dispose();
    return { state, perPrep: [...cbs.values()].map((s) => s.size) };
  };
  const whole = run(undefined);
  const sliced = run(1e-6);
  assert.ok(Math.max(...whole.perPrep) <= 1, `unbounded (virtual time): a whole prep in one callback (${whole.perPrep})`);
  assert.ok(Math.min(...sliced.perPrep) >= 3 && Math.max(...sliced.perPrep) >= 8, `sliced: every prep spread over many callbacks (${sliced.perPrep})`);
  assert.equal(sliced.state, whole.state, 'same decisions, same boards');
});

test('a bot prep dropped mid-planning (the prep ended) leaves a legal board and no rehearsal layout behind', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 14, fake: true, botRehearsal: 3, botSliceMs: 1e-6 }).start();
  const m = h.m;
  h.toPrep(4);
  const bot = h.ps('ai_0');
  let moves = 0;
  const move = bot.move.bind(bot);
  bot.move = (...a) => { moves++; return move(...a); };
  // stop right after the bot started placing (mid-way through its sliced prep)
  h.run(() => moves > 0);
  assert.equal(bot.ready, false, 'mid-prep');
  m.prepDeadline();
  assert.equal(m.phase, PHASE.COMBAT);
  const at = moves;
  h.run(() => m.phase === PHASE.SETTLE);
  assert.equal(moves, at, 'the pending steps were dropped');
  assert.ok(bot.deployCount <= bot.deployCap);
  assert.equal(m.errorCount, 0);
  checkInvariants(m);
  m.dispose();
});

test('a sliced rehearsal is dropped when the prep ends first; the default layout is already on the board', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 12, fake: true, botRehearsal: 3, botSliceMs: 1e-6 }).start();
  const m = h.m;
  h.toPrep(3);
  const bot = h.ps('ai_0');
  let ticks = 0;
  const newBattle = m.newBattle.bind(m);
  m.newBattle = (opts) => {
    const b = newBattle(opts);
    if (String(opts.fieldId).startsWith('r:')) { const step = b.step.bind(b); b.step = () => { ticks++; step(); }; }
    return b;
  };
  h.run(() => ticks > 0);
  assert.equal(bot.ready, false, 'mid-rehearsal');
  const layout = JSON.stringify([...bot.board.entries()].map(([k, p]) => [k, p.uid]));
  assert.ok(bot.deployCount > 0, 'the default layout already stands');
  m.prepDeadline();
  assert.equal(m.phase, PHASE.COMBAT);
  const at = ticks;
  h.run(() => m.phase === PHASE.SETTLE);
  assert.equal(ticks, at, 'the pending slices dropped the job');
  assert.equal(JSON.stringify([...bot.board.entries()].map(([k, p]) => [k, p.uid])), layout, 'the board was left alone');
  assert.equal(m.errorCount, 0);
  checkInvariants(m);
  m.dispose();
});

test('AI takeover resolves a personal choice in untimed PREP, including generator-error Ready cleanup', () => {
  for (const broken of [false, true]) {
    const h = makeMatch({ mode: 'coop', humans: 1, seed: 6, fake: true, botSliceMs: 0 }).start();
    h.toPrep(1);
    const m = h.m, ps = h.ps('p_0');
    assert.equal(m.deadline, 0, 'single-human co-op is untimed');
    const art = giveItem(m, ps, 'chess_item_6_03_m');
    assert.deepEqual(ps.useArt(art.uid, 10, 5), { ok: true });
    const pick = m.autoPickPersonalChoice.bind(m), modes = [];
    m.autoPickPersonalChoice = (p, mode) => {
      if (p.personalChoice) modes.push(mode);
      if (broken && mode === 'bot') throw new Error('scripted choice scoring failure');
      return pick(p, mode);
    };
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.autoplay', on: true }), { ok: true });
    assert.ok(h.run(() => m.phase !== PHASE.PREP));
    assert.equal(ps.personalChoice, null);
    assert.equal(ps.bounties.length, 1);
    assert.equal(ps.round.arts, 1);
    assert.ok(ps.ready);
    assert.ok(modes.includes(broken ? 'random' : 'bot'));
    assert.equal(m.errorCount > 0, broken);
    m.dispose();
  }
});

test('economy: the bot fills the board first (8 units by round 4), levels on its curve and keeps a hand slot free', () => {
  for (const seed of [5, 8]) {
    const h = soloBot({ seed }).start();
    const m = h.m;
    const ps = m.order[0];
    h.run(() => m.phase === PHASE.PREP && m.round === 1);
    ps.lp = 999;
    const funds1 = ps.funds; // 老鲤 (band_lmlee) withholds R1–R2 income until R3
    h.run(() => m.phase === PHASE.COMBAT && m.round === 1);
    assert.equal(ps.shop.level, 1, 'no level-up in round 1 (units first)');
    assert.equal(ps.deployCount, Math.floor(funds1 / 2), `R1: ${funds1} funds → tier-I operators deployed`);
    h.run(() => m.phase === PHASE.COMBAT && m.round === 4);
    assert.equal(ps.deployCount, ps.deployCap, 'full board by round 4');
    h.run(() => m.phase === PHASE.COMBAT && m.round === 6);
    assert.ok(ps.shop.level >= 2, `level ${ps.shop.level} by round 6`);
    h.run(() => m.phase === PHASE.COMBAT && m.round === 10);
    assert.ok(ps.shop.level >= 4, `level ${ps.shop.level} by round 10`);
    assert.ok(ps.hand.some((x) => x == null), 'a hand slot is kept free for merges');
    checkInvariants(m);
    m.dispose();
  }
});

test('bench management: stale low-tier singles are sold at a high shop level; pairs that can still merge are kept', () => {
  const h = soloBot({ seed: 6 }).start();
  const m = h.m;
  const ps = m.order[0];
  ps.lp = 999;
  h.run(() => m.phase === PHASE.ROUND_START && m.round === 7);
  // a crowded bench of tier-I singles at shop level 5, plus a live pair of a tier-V chess
  ps.shop.level = 5;
  const owned = new Set(ps.allChess().map((p) => m.gd.baseIdOf(p.id)));
  const t5 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 5 && m.pool.has(c.chessId) && m.pool.left(c.chessId) >= 3 && !owned.has(c.chessId));
  const freeIdx = () => ps.hand.findIndex((x) => x == null);
  assert.ok(freeIdx() >= 0);
  const pairA = give(m, ps, t5.chessId, 'hand', freeIdx());
  assert.ok(freeIdx() >= 0);
  const pairB = give(m, ps, t5.chessId, 'hand', freeIdx());
  const t1 = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 1 && m.pool.has(c.chessId) && !owned.has(c.chessId));
  const junk = [];
  for (const c of t1) if (freeIdx() >= 0) junk.push(give(m, ps, c.chessId, 'hand', freeIdx()));
  assert.ok(junk.length >= 2, 'the bench is crowded with tier-I singles');
  h.run(() => m.phase === PHASE.COMBAT && m.round === 7);
  const bench = ps.hand.filter((p) => p && p.kind === 'chess');
  assert.ok(bench.length <= 6, `bench trimmed to ${bench.length}`);
  const stillOwned = junk.filter((p) => ps.find(p.uid)).length;
  assert.ok(stillOwned < junk.length, `sold stale singles (${junk.length - stillOwned}/${junk.length})`);
  const kept = ps.allChess().filter((p) => m.gd.baseIdOf(p.id) === t5.chessId);
  assert.ok(kept.length >= 2 || kept.some((p) => m.gd.isGolden(p.id)) || (ps.find(pairA.uid) && ps.find(pairB.uid)), 'the tier-V pair is kept (or merged)');
  checkInvariants(m);
  m.dispose();
});

test('机变 pick: items and team buffs before bounties (bounties add enemies to the bot\'s own battle)', () => {
  const h = soloBot({ seed: 7 }).start();
  const m = h.m;
  const ps = m.order[0];
  const cards = [
    { idx: 0, kind: 'bounty', payout: 'kill', coin: 3, tier: 2, count: 3, rounds: 1 },
    { idx: 1, kind: 'item', id: 'x', tier: 2 },
    { idx: 2, kind: 'tactic', team: true, tacticKind: 'ally' },
  ];
  assert.equal(botPickCard(m, ps, cards, [0, 1, 2]), 2);
  assert.equal(botPickCard(m, ps, cards, [0, 1]), 1);
  assert.equal(botPickCard(m, ps, cards, [0]), 0);
  m.dispose();
});

test('merge rewards: a merge completed while buying is followed by taking its free reward offer the same prep', () => {
  const h = soloBot({ seed: 9 }).start();
  const m = h.m;
  const ps = m.order[0];
  h.run(() => m.phase === PHASE.PREP && m.round === 1);
  ps.lp = 999;
  h.run(() => m.phase === PHASE.ROUND_START && m.round === 3);
  // two copies owned, the third in the shop: the bot buys it (merge) and must pick the reward offer it queues
  const id = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 1 && m.pool.has(c.chessId) && m.pool.left(c.chessId) >= 3 && ps.countCopies(c.chessId) === 0).chessId;
  const freeIdx = () => ps.hand.findIndex((x) => x == null);
  give(m, ps, id, 'hand', freeIdx());
  give(m, ps, id, 'hand', freeIdx());
  ps.funds = 20;
  h.run(() => m.phase === PHASE.PREP && m.round === 3);
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), price: m.gd.chessPrice(id), sold: false, frozen: false };
  const picks = [];
  const orig = ps.pickReward.bind(ps);
  ps.pickReward = (i) => { const r = orig(i); picks.push(r); return r; };
  const merges = ps.stats.merges;
  h.run(() => m.phase === PHASE.COMBAT && m.round === 3);
  assert.ok(ps.stats.merges > merges, 'the third copy was bought (merge)');
  assert.ok(picks.some((r) => r && r.ok), 'the merge reward was taken in the same prep');
  assert.ok(ps.allChess().some((p) => m.gd.goldenIdOf(id) === p.id), 'the elite is owned');
  checkInvariants(m);
  m.dispose();
});

test('band pick: alone, the bot avoids a band that withholds the first rounds\' funds (老鲤); in co-op it may take it', () => {
  const counts = { solo: 0, coop: 0 };
  for (let seed = 1; seed <= 60; seed++) {
    for (const mode of ['solo', 'coop']) {
      const h = makeMatch({ mode, difficulty: 'NORMAL', seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], seed, fake: true });
      if (botPickBand(h.m, h.m.order[0]) === 'band_lmlee') counts[mode]++;
      h.m.dispose();
    }
  }
  assert.ok(counts.solo <= 1, `solo picks 老鲤 ${counts.solo}/60`);
  assert.ok(counts.coop >= 1, `co-op may pick it (${counts.coop}/60)`);
});

test('user: Given normal battle-start effects, When rehearsing candidate layouts, Then choose the layout with fewer actual battle leaks', async (t) => {
  // Real round-7 wave from seed 104; no equipment, bench, effects or prior layers are needed.
  // Blemishine also gains Kazimierz layers in battle; Touch is supplied by the teammate's contentInfo.
  const lineup = [
    ['chess_char_4_02_a', '12,4', 'DOWN'],
    ['chess_char_1_17_a', '12,5', 'DOWN'],
    ['chess_char_3_17_a', '11,4', 'RIGHT'],
    ['chess_char_2_18_a', '10,5', 'RIGHT'],
    ['chess_char_3_12_a', '9,4', 'RIGHT'],
  ];
  const prep = () => {
    const h = makeMatch({ mode: 'coop', humans: 2, difficulty: 'HARD', seed: 104, botRehearsal: 2 }).start().toPrep(1, { band: 'band_ducklord' });
    const m = h.m, ps = m.order[0];
    m.round = 7;
    m.wave = buildNormalWave(m.gd, m.rngWave, m.factions, m.round);
    ps.bandId = 'band_ducklord';
    m.order[1].bandId = 'band_amedic';
    const pieces = lineup.map(([id, key, dir]) => {
      const p = give(m, ps, id, 'board', parseKey(key));
      p.dir = dir;
      return p;
    });
    ps.recompute();
    return { h, m, ps, pieces };
  };
  const cases = [
    // (0.3.0's 0.1 enemy collider changed the leaks: 9,4 3 / 9,8 7 — 9,5 now has the strict advantage)
    { effect: 'in-battle layer gains', keys: ['9,4', '9,5'] },
    { effect: 'duck replacements and a teammate medic', keys: ['9,9', '9,7'] },
  ];
  for (const { effect, keys } of cases) {
    await t.test(`user: Given ${effect}, When comparing two layouts, Then prefer the second layout's lower leak count`, () => {
      // Each normal combat starts from a fresh, identical prep state, including the meta RNG.
      const actual = keys.map((key) => {
        const { h, m, ps, pieces } = prep();
        try {
          ps.board.delete('9,4');
          ps.board.set(key, pieces.at(-1));
          ps.recompute();
          checkInvariants(m);
          m.startCombat();
          assert.ok(h.run(() => m.lastResults.has(ps.playerId)));
          assert.equal(m.errorCount, 0);
          const result = m.lastResults.get(ps.playerId);
          return { leaks: result.leaked.filter((l) => l.counted !== false).length, layers: result.layerGains.kazimierzShip };
        } finally { m.dispose(); }
      });
      assert.ok(actual.every((result) => result.layers > 0), 'both battles exercise in-battle layer gains');
      assert.ok(actual[1].leaks < actual[0].leaks, 'normal combat gives the second layout a strict leak advantage');
      const { m, ps, pieces } = prep();
      try {
        const plans = keys.map((key) => {
          const plan = new Map(pieces.map((p, i) => [p.uid, i === pieces.length - 1 ? key : lineup[i][1]]));
          plan.dirs = new Map(pieces.map((p) => [p.uid, p.dir]));
          return plan;
        });
        assert.equal(rehearse(m, ps, pieces, plans), plans[1], `${effect}: choose ${keys[1]} (${actual[1].leaks} leaks), not ${keys[0]} (${actual[0].leaks} leaks)`);
        assert.equal(m.errorCount, 0);
        checkInvariants(m);
      } finally { m.dispose(); }
    });
  }
});


// Snapshot every own player field, including caches, directions, temp slots, stats, counters and pending gains.
// Match/data references are infrastructure; their gameplay state is checked separately below.
const playerSnapshot = (ps) => structuredClone(Object.fromEntries(Object.entries(ps).filter(([k, v]) => k !== 'm' && k !== 'gd' && typeof v !== 'function')));

for (const plugin of [false, true]) test(`rehearsal capabilities: ${plugin ? 'plugin' : 'official-registry'} start effects cannot write any player field or the live wave`, () => {
  const registry = createRegistry();
  const h = makeMatch({ humans: 2, seed: 104, difficulty: 'HARD', botRehearsal: 2, registry }).start().toPrep();
  const m = h.m, ps = m.order[0], mate = m.order[1];
  try {
    m.round = 7;
    m.wave = buildNormalWave(m.gd, m.rngWave, m.factions, m.round);
    ps.bandId = 'band_ducklord';
    mate.bandId = 'band_amedic';
    const piece = give(m, ps, 'chess_char_1_01_a', 'board', [9, 4]);
    give(m, ps, 'chess_char_1_06_a', 'hand');
    // This item must not get pulled out of temp by a rehearsal recompute.
    const temp = ps.newPiece('item', 'chess_item_1_01_e_a');
    ps.temp[0] = temp;
    ps._tempDue.set(temp.uid, ps.prepsEnded);
    ps.effects.push({ id: 'preview-state', key: 'effect:preview-state', battle: true, data: { value: 1 }, params: { value: 1 } });
    // 鸭爵's swaps are one draw per round from the match seed (GitHub #839): take a match seed whose R7 draw swaps
    for (let k = 0; k < 50 && !m._normalOpts(ps, { preview: true }).spawns.some((s) => s.tag === 'duck'); k++) m.seed++;
    let calls = 0;
    const draws = [];
    const handler = { onBattleStart(ctx, ev) {
      calls++;
      draws.push([ctx.rng(), ctx.rollChess({ maxTier: 2 }), ctx.rollItem({ maxTier: 2 })]);
      for (const c of [ctx, ...ctx.teammates(), ctx.player(ctx.playerId)]) {
        c.addFunds(100);
        c.addPendingFunds(50);
        c.addLayers('steadShip', 10);
        c.setCounter('preview-write', 2);
        c.incCounter('preview-write');
        c.grantFreeRefresh(5);
        c.setTileOverride(9, 4, 'none');
        c.setDeviceActive('preview-device', true);
        c.setDeployCapAtLeast(12);
        c.addEffect({ id: 'unexpected', data: { value: 1 } });
      }
      ctx.incPieceCounter(piece.uid, 'preview-write');
      ctx.destroyPiece(piece.uid);
      ctx.setShopSlot(0, null);
      ctx.effect('preview-state').data.value = 99;
      if (ctx.source.ref) ctx.source.ref.params.value = 99;
      // Returned data and source objects must not bypass the context's disabled writers.
      ctx.gd.modeInactiveBonds.add('preview-write');
      const board = ctx.board();
      if (board[0]) board[0].dir = 'LEFT';
      ev.input.playerEffects[0].data.value = 77;
      ev.input.playerEffects[0].params.value = 88;
      ev.input.ownBoardViaMate = ctx.teammates()[0].player(ctx.playerId).board()[0].col;
      ev.spawns[0].enemyKey = 'enemy_1006_shield_2';
      ev.spawns[0].mods = { ...ev.spawns[0].mods, hpMul: 3 };
      ev.preview = false; // A handler cannot turn off dispatcher isolation for later handlers.
    } };
    if (plugin) {
      registerMeta({ id: 'preview-test' }, 'effect:preview-state', handler);
      registerExtensionMeta(registry);
    } else registry.effect('preview-state', handler);
    const before = m.order.map(playerSnapshot);
    const wave = structuredClone(m.wave);
    const pool = structuredClone(m.pool.entries);
    const itemStock = () => Object.fromEntries(Object.keys(m.gd.raw.items).map((id) => [id, m.itemPool.left(id)]));
    const items = itemStock();
    const uid = m.uidSeq;
    const rngs = () => [m.rngMeta, m.rngBots, m.rngShop, m.rngWave, m.rngDraft, m.rngSetup].filter(Boolean).map((rng) => rng.state());
    const rngBefore = rngs();
    const inactive = new Set(m.gd.modeInactiveBonds);
    const dirty = new Set(m._privDirty);
    const plans = ['9,4', '9,5'].map((key) => new Map([[piece.uid, key]]));
    const inputs = [];
    const newBattle = m.newBattle.bind(m);
    m.newBattle = (opts, options) => { inputs.push(opts); return newBattle(opts, options); };
    const steps = createRehearsalSteps(m, ps, [piece], plans);
    let result;
    do {
      result = steps.next();
      assert.deepEqual(m.order.map(playerSnapshot), before, 'every player field remains unchanged at each yield');
    } while (!result.done);
    result.value.run();
    assert.equal(calls, 2, 'both candidates dispatch the effect');
    assert.deepEqual(draws[0], draws[1], 'every candidate starts at the same RNG position, including the pool roll helpers');
    assert.deepEqual(m.order.map(playerSnapshot), before, 'running battles is also isolated');
    assert.deepEqual(m.wave, wave);
    assert.deepEqual(m.pool.entries, pool);
    assert.deepEqual(itemStock(), items);
    assert.equal(m.uidSeq, uid);
    assert.deepEqual(rngs(), rngBefore);
    assert.deepEqual(m.gd.modeInactiveBonds, inactive);
    assert.deepEqual(new Set(m._privDirty), dirty);
    assert.equal(m.dispatcher.scriptBudget, undefined, 'preview never initializes the live budget');
    assert.equal(m.dispatcher.errors, 0);
    assert.equal(m.errorCount, 0);
    assert.deepEqual(h.logs.error, []);
    assert.deepEqual(h.logs.warn, []);
    for (const input of inputs) {
      assert.equal(input.flags.layerGainsEnabled, true);
      assert.ok(input.spawns.some((s) => s.tag === 'duck'), 'official duck replacement runs in preview');
      assert.equal(input.spawns[0].enemyKey, 'enemy_1006_shield_2');
      assert.equal(input.spawns[0].mods.hpMul, 3);
      assert.equal(input.players[0].playerEffects[0].data.value, 77);
      assert.ok(input.players[0].contentInfo.matchBands.includes('band_amedic'));
      assert.equal(input.players[0].contentInfo.teammates.length, 1, 'the candidate is not its own teammate');
    }
    assert.deepEqual(inputs.map((input) => input.players[0].ownBoardViaMate), [4, 5], 'nested teammate/player reads still see the candidate');
  } finally { m.dispose(); if (plugin) resetExtensions(); }
});

test('rehearsal scripts use a separate budget and error sink; actual starts still charge, mutate and report errors', () => {
  const registry = createRegistry();
  const h = makeMatch({ humans: 1, seed: 11, registry }).start().toPrep();
  const m = h.m, ps = m.order[0];
  try {
    const draws = [];
    registerMeta({ id: 'preview-budget' }, 'global:preview-budget', { onBattleStart(ctx, ev) {
      draws.push(ctx.rng());
      ctx.addFunds(3);
      ctx.addLayers('steadShip', 1);
      ev.input.testMarker = true;
      throw new Error('preview-budget intentional error');
    } });
    registerExtensionMeta(registry);
    // Leave precisely one real invocation. Any rehearsal charge would use it up.
    const budget = { units: [], _handlerError: (...args) => m.dispatcher._report(...args) };
    m.dispatcher.scriptRound = m.round;
    m.dispatcher.scriptBudget = budget;
    for (let i = 0; i < DEFAULT_BUDGET - 1; i++) charge(budget, null, 'preview-budget');
    const before = playerSnapshot(ps);
    const state = m.rngMeta.state();
    for (let i = 0; i < 3; i++) assert.equal(m._normalOpts(ps, { preview: true }).players[0].testMarker, true);
    assert.deepEqual(playerSnapshot(ps), before);
    assert.equal(m.rngMeta.state(), state);
    assert.equal(budgetUsed(budget, 'preview-budget'), DEFAULT_BUDGET - 1);
    assert.equal(m.dispatcher.scriptBudget, budget);
    assert.equal(m.dispatcher.errors, 0);
    assert.equal(m.dispatcher.errorsByKey.size, 0);
    assert.equal(m.dispatcher._errKeys.size, 0);
    assert.deepEqual(h.logs.error, []);
    assert.equal(m._normalOpts(ps).players[0].testMarker, true);
    assert.equal(budgetUsed(budget, 'preview-budget'), DEFAULT_BUDGET);
    assert.equal(ps.funds, before.funds + 3);
    assert.equal(ps.layers.steadShip, (before.layers.steadShip || 0) + 1);
    assert.notEqual(m.rngMeta.state(), state);
    assert.deepEqual(draws, Array(4).fill(draws[0]), 'the real start uses the original stream at the previewed position');
    assert.equal(m.dispatcher.errors, 1);
    assert.ok(h.logs.error.some((s) => s.includes('preview-budget intentional error')));
    assert.equal(m._normalOpts(ps).players[0].testMarker, undefined, 'the next real call is blocked by the exhausted budget');
  } finally { m.dispose(); resetExtensions(); }
});

test('rehearsal construction and battle errors never enter live diagnostics', () => {
  for (const when of ['construct', 'step']) {
    const h = makeMatch({ humans: 1, botRehearsal: 2 }).start().toPrep();
    const m = h.m, ps = m.order[0];
    try {
      const piece = give(m, ps, 'chess_char_1_01_a', 'board', [9, 4]);
      const OriginalBattle = m.BattleClass;
      m.BattleClass = class extends OriginalBattle {
        constructor(opts) { if (when === 'construct') throw new Error('preview construct'); super(opts); }
        step() { throw new Error('preview step'); }
      };
      const plans = ['9,4', '9,5'].map((key) => new Map([[piece.uid, key]]));
      rehearse(m, ps, [piece], plans);
      assert.equal(m.errorCount, 0);
      assert.equal(m.simErrors, 0);
      assert.equal(m.simErrorLog.size, 0);
      assert.deepEqual(h.logs.error, []);
      assert.deepEqual(h.logs.warn, []);
      if (when === 'construct') {
        m._normalBattle(ps);
        assert.equal(m.errorCount, 1, 'a real construction failure is still reported');
      }
    } finally { m.dispose(); }
  }
});

test('boss medics break ties by uncovered damage, so separate damage groups both receive healing', () => {
  const records = {
    strong: { position: 'RANGED', rangedTilesOnly: true, attackKind: 'ranged', stats: { atk: 1000 }, rangeGrid: [[0, 0]] },
    weak: { position: 'RANGED', rangedTilesOnly: true, attackKind: 'ranged', stats: { atk: 500 }, rangeGrid: [[0, 0]] },
    medic: { position: 'RANGED', attackKind: 'heal', stats: { blockCnt: 1 }, rangeGrid: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] },
  };
  const gd = { chess: (id) => records[id] };
  const m = { round: 1, stageId: 'fixture', wave: null, gd, rngBots: () => 0,
    _botPath: { key: '1|fixture|boss|', routes: [], index: new Map(), ground: new Map() } };
  const ps = { gd, deployMap: () => new Map([['9,3', 'ranged'], ['9,8', 'ranged'],
    ['10,3', 'melee'], ['9,2', 'melee'], ['10,8', 'melee'], ['9,7', 'melee']]) };
  const pieces = ['strong', 'weak', 'medic', 'medic'].map((id, uid) => ({ id, uid, kind: 'chess' }));
  const plan = planLayout(m, ps, pieces);
  const coverage = new Set(pieces.slice(2).flatMap((p) => rangeTiles(records.medic, ...parseKey(plan.get(p.uid)), plan.dirOf(p.uid))));
  assert.ok(coverage.has(plan.get(0)), 'higher DPS group healed');
  assert.ok(coverage.has(plan.get(1)), 'the second medic reaches the other group despite its lower DPS');
});

test('medic support checks every incoming ground contact, permits different supporters, and prefers an off-road tile', () => {
  const key = '9,5';
  const routes = [
    { tiles: ['9,6', key], fly: false, n: 1, hp: 10000, tileTime: 2 },
    { tiles: ['10,5', key], fly: false, n: 1, hp: 10000, tileTime: 2 },
  ];
  for (const missingContact of [false, true]) for (const offRoad of [false, true]) {
    const records = {
      a: { position: 'RANGED', attackKind: 'ranged', stats: { atk: 100 }, rangeGrid: [[0, -2], [0, -3]] },
      b: { position: 'RANGED', attackKind: 'ranged', stats: { atk: 90 }, rangeGrid: missingContact ? [[-2, 0]] : [[-2, 0], [-1, 0]] },
      medic: { position: 'RANGED', attackKind: 'heal', stats: { blockCnt: 1 }, rangeGrid: [[0, 0]] },
    };
    const ground = new Map([['9,6', { flow: 1 }], ['10,5', { flow: 1 }], [key, { flow: 2 }]]);
    const gd = { token: (id) => records[id] };
    const m = { round: 1, stageId: 'fixture', wave: { templateId: 'test' }, gd, rngBots: () => 0,
      _botPath: { key: '1|fixture|test|', routes, ground,
        index: new Map([[key, [[0, 1], [1, 1]]], ['9,6', [[0, 0]]], ['10,5', [[1, 0]]]]) } };
    // Pin the dealers to separated tiles; neither can cover both incoming contacts.
    const tiles = new Map([['9,8', 'melee'], ['11,5', 'melee'], [key, 'melee'], ['9,6', 'melee']]);
    if (offRoad) tiles.set('12,2', 'melee');
    const ps = { gd, deployMap: () => tiles, summonRange: (p) => new Set(p.id === 'a' ? ['9,8'] : p.id === 'b' ? ['11,5']
      : offRoad ? [key, '9,6', '12,2'] : [key, '9,6']) };
    const pieces = ['a', 'b', 'medic'].map((id, uid) => ({ uid, id, kind: 'token' }));
    const plan = planLayout(m, ps, pieces, { ...LAYOUT_PARAMS, roadPenalty: 0 });
    assert.equal(plan.get(2), offRoad ? '12,2' : missingContact ? '9,6' : key,
      'off-road first; otherwise every incoming route must have both tiles covered (or keep a legal fallback)');
    const alone = planLayout(m, ps, [pieces[2]], { ...LAYOUT_PARAMS, roadPenalty: 0 });
    assert.ok(tiles.has(alone.get(2)), 'without allies the medic still gets a legal fallback');
  }
});
