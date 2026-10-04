// AI player (server/match/bot.js): field model, layout planner, rehearsal, buying / leveling / bench management.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { fieldModel, planLayout, rehearse, rangeTiles, REHEARSAL_VARIANTS, LAYOUT_PARAMS, botPickCard, botPickBand } from '../../server/match/bot.js';
import { FIELD, canPlace, placeClass, parseKey } from '../../server/match/board.js';
import { makeMatch, checkInvariants, give, DATA } from './harness.js';

const soloBot = (o = {}) => makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], ...o });

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
