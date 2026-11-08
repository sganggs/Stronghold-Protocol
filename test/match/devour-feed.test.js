// §37.77 the Final Assault feeds the 阿戈尔 devour on purpose: each member keeps the base ATK and block of what it marks for the
// whole fight, the victim comes back after its redeploy time. Feeding candidates join the boss rehearsal, which judges them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { devourFeedSteps, positionPlanSteps, createRehearsal, arrange, LayoutPlan, fieldModel, fedAtk } from '../../server/match/bot.js';
import { Unit } from '../../server/sim/units.js';
import { rotateOffset } from '../../server/sim/dir.js';
import { tileKey, parseKey, legalTiles, placeClass } from '../../server/match/board.js';
import { makeMatch, give } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
const run = (gen) => { let r; for (;;) { r = gen.next(); if (r.done) return r.value; } };

/** A solo 终极 prep of round `round` ('boss': the Final Assault) with these chess in the hand (none on the board). */
function prep(round, names) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seats: SEAT, seed: 3 }).start().toPrep();
  const m = h.m, ps = m.order[0];
  m.startRound(round === 'boss' ? m.gd.bossRound : round);
  ps.hand.fill(null);
  ps.board.clear();
  ps.recompute();
  const byName = new Map();
  for (const name of names) {
    const c = Object.values(m.gd.raw.chess).find((x) => x.name === name && !x.isGolden && x.visible !== false);
    assert.ok(c, name);
    byName.set(name, give(m, ps, c.chessId, 'hand'));
  }
  return { h, m, ps, byName, pieces: [...byName.values()] };
}

const member = (m, p) => m.gd.chess(p.id).bonds.includes('egirShip');
const front = (plan, uid) => {
  const [r, c] = parseKey(plan.get(uid));
  const [dr, dc] = rotateOffset(0, 1, plan.dirs.get(uid) ?? 'RIGHT');
  return tileKey(r + dr, c + dc);
};
const legal = (ps, p) => new Set(legalTiles(ps.deployMap(), placeClass(ps, ps.gd.chess(p.id))).map(([r, c]) => tileKey(r, c)));

/** What each member marks (sim bonds/core.js devour): the piece in front, through marked members; never one that marked it. */
function marksOf(m, plan, pieces) {
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const at = new Map([...plan].map(([uid, key]) => [key, uid]));
  const out = new Map();
  for (const p of pieces) {
    if (!member(m, p) || !plan.has(p.uid)) continue;
    const mine = new Set();
    const seen = new Set([p.uid]);
    for (let cur = p.uid, g = 0; g < 8; g++) {
      const q = at.get(front(plan, cur));
      if (q == null || seen.has(q)) break;
      seen.add(q);
      mine.add(q);
      if (!member(m, byUid.get(q))) break;
      cur = q;
    }
    out.set(p.uid, mine);
  }
  return out;
}

/** The base ATK a plan's devour hands its members, by the records. */
function devouredAtk(m, plan, pieces) {
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  let F = 0;
  for (const mine of marksOf(m, plan, pieces).values()) for (const q of mine) F += m.gd.chess(byUid.get(q).id).stats.atk;
  return F;
}

/** A plan with every piece on a free legal tile, nothing in front of a member and nobody beside anybody (a sparse deploy map allowing). */
function sparsePlan(m, ps, pieces) {
  const plan = new LayoutPlan();
  const used = new Set();
  const dist = (a, b) => { const [r, c] = parseKey(a), [x, y] = parseKey(b); return Math.abs(r - x) + Math.abs(c - y); };
  for (const p of pieces) {
    const tiles = [...legal(ps, p)].filter((k) => !used.has(k));
    const k = tiles.find((x) => [...used].every((u) => dist(u, x) > 1)) ?? tiles[0];
    assert.ok(k, `a free tile for ${p.id}`);
    used.add(k);
    plan.set(p.uid, k);
    plan.dirs.set(p.uid, 'RIGHT');
  }
  for (const p of pieces) {
    if (!member(m, p)) continue;
    for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
      plan.dirs.set(p.uid, dir);
      if (![...plan.values()].includes(front(plan, p.uid))) break;
    }
  }
  return plan;
}

const NAMES = ['斯卡蒂', '幽灵鲨', '乌尔比安', '歌蕾蒂娅', '深巡', '耀骑士临光', '蕾缪安', '史尔特尔'];

test('a Final Assault gets a feeding candidate from a plan that feeds nothing: more base ATK on the members, its tags kept', () => {
  const { h, m, ps, pieces } = prep('boss', NAMES);
  try {
    assert.equal(m.wave, null, 'the Final Assault has no wave');
    const base = sparsePlan(m, ps, pieces);
    base.lineup = new Set(pieces.map((p) => p.uid));
    base.swaps = [[1, 2]];
    assert.equal(devouredAtk(m, base, pieces), 0, 'the fixture feeds nothing');
    const fed = run(devourFeedSteps(m, ps, pieces, [base], { focus: 'egirShip' }));
    assert.equal(fed.length, 1, 'one candidate from one plan');
    assert.notEqual(fed[0], base, 'the original stays a candidate of its own');
    assert.ok(devouredAtk(m, fed[0], pieces) > 0, 'the members gain base ATK');
    assert.equal(fed[0].lineup, base.lineup, 'its lineup');
    assert.equal(fed[0].swaps, base.swaps, 'its swaps');
    for (const p of pieces) assert.ok(legal(ps, p).has(fed[0].get(p.uid)), `${p.id} on a legal tile`);
    assert.equal(new Set(fed[0].values()).size, pieces.length, 'one piece per tile');
  } finally { h.dispose?.(); }
});

test('the feeding candidates are distinct and the search raises the rating', () => {
  const { h, m, ps, pieces } = prep('boss', NAMES);
  try {
    const a = sparsePlan(m, ps, pieces);
    const copy = (p) => { const q = new LayoutPlan(p); for (const [u, d] of p.dirs) q.dirs.set(u, d); return q; };
    const fed = run(devourFeedSteps(m, ps, pieces, [a, copy(a), copy(a), copy(a)], { focus: 'egirShip' }));
    assert.equal(fed.length, 1, 'the same plan four times gives one candidate');
    const rate = (p) => run(positionPlanSteps(m, ps, pieces, p, { focus: 'egirShip' }, { feed: true, rate: true }));
    const plain = sparsePlan(m, ps, pieces);
    const better = run(positionPlanSteps(m, ps, pieces, plain, { focus: 'egirShip' }, { feed: true }));
    assert.ok(better && rate(better) > rate(plain), 'the search raises the rating');
  } finally { h.dispose?.(); }
});

test('the rating weighs the transfer against the victim: its redeploy time of the fight when it hits the leader, nothing when it does not', () => {
  const { h, m, ps, byName, pieces } = prep('boss', ['歌蕾蒂娅', '乌尔比安', '深巡', '耀骑士临光', '蕾缪安']);
  try {
    const ctx = { focus: 'egirShip' };
    const lead = fieldModel(m, ps, true).lead;
    const hits = new Set(lead ? lead.tiles : fieldModel(m, ps).routes.find((r) => !r.fly && r.dwell > 0).tiles);
    const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
    const eater = byName.get('歌蕾蒂娅'), food = byName.get('蕾缪安');
    const reachOf = (p) => (key, dir) => {
      const [r, c] = parseKey(key);
      return (m.gd.chess(p.id).rangeGrid || []).some(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, dir); return hits.has(tileKey(r + a, c + b)); });
    };
    const reach = reachOf(food), eaterReach = reachOf(eater);
    // the eater reaches the leader over the victim's tile; on that tile the victim's facing decides whether it reaches the leader
    let found = null;
    for (const key of legal(ps, eater)) {
      const [r, c] = parseKey(key);
      for (const dir of DIRS) {
        if (!eaterReach(key, dir)) continue;
        const [dr, dc] = rotateOffset(0, 1, dir);
        const f = tileKey(r + dr, c + dc);
        if (!legal(ps, food).has(f)) continue;
        const yes = DIRS.find((d) => reach(f, d)), no = DIRS.find((d) => !reach(f, d));
        if (yes && no) { found = { key, dir, f, yes, no }; break; }
      }
      if (found) break;
    }
    assert.ok(found, 'a tile pair where the eater reaches the leader and the victim may or may not');
    const { key, dir, f, yes, no } = found;
    const [kr, kc] = parseKey(key);
    const beside = new Set(DIRS.map((d) => { const [a, b] = rotateOffset(0, 1, d); return tileKey(kr + a, kc + b); }));
    // the same eater marking nothing: a facing with an empty tile in front; the other pieces stand apart in every plan
    const away = DIRS.find((d) => d !== dir);
    const others = pieces.filter((p) => p !== eater && p !== food);
    const used = new Set([key, f]);
    const fixed = others.map((p) => {
      const k = [...legal(ps, p)].find((x) => !used.has(x) && !beside.has(x));
      assert.ok(k, 'a free tile');
      used.add(k);
      return [p, k];
    });
    const safe = [...legal(ps, food)].find((x) => !used.has(x) && !beside.has(x) && DIRS.some((d) => !reach(x, d)));
    assert.ok(safe, 'a tile for the victim away from the eater');
    const safeDir = DIRS.find((d) => !reach(safe, d));
    const plan = (eaterDir, foodKey, foodDir) => {
      const q = new LayoutPlan();
      q.set(eater.uid, key); q.dirs.set(eater.uid, eaterDir);
      q.set(food.uid, foodKey); q.dirs.set(food.uid, foodDir);
      for (const [p, k] of fixed) { q.set(p.uid, k); q.dirs.set(p.uid, 'LEFT'); }
      return q;
    };
    const rate = (q) => run(positionPlanSteps(m, ps, pieces, q, ctx, { feed: true, rate: true }));
    assert.ok(rate(plan(dir, f, no)) > rate(plan(dir, safe, safeDir)), 'a victim that does not hit the leader: the transfer is pure gain');
    // the victim's own damage on the leader, with its redeploy time of the fight gone when it is the one devoured
    const whole = rate(plan(away, f, yes)) - rate(plan(away, f, no));
    const fed = rate(plan(dir, f, yes)) - rate(plan(dir, f, no));
    assert.ok(whole > 0, 'the victim hits the leader');
    const T = m.gd.bossLevelTime(m.round) * m.gd.combatTimeScale;
    const respawn = m.gd.chess(food.id).stats.respawnTime;
    assert.ok(Math.abs(fed - whole * (1 - respawn / T)) < 1e-6, `${fed} = ${whole} × (1 − ${respawn} / ${T})`);
  } finally { h.dispose?.(); }
});

test('a 鼓舞 holder counts by its skill: fed, 浊心斯卡蒂 raises the true damage and the dealers in her range', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seats: SEAT, seed: 3 }).start().toPrep();
  try {
    const m = h.m, ps = m.order[0];
    m.bossId = 'boss_3';
    m.startRound(m.gd.bossRound);
    ps.hand.fill(null);
    ps.board.clear();
    ps.recompute();
    const of = (name) => give(m, ps, Object.values(m.gd.raw.chess).find((x) => x.name === name && !x.isGolden && x.visible !== false).chessId, 'hand');
    const [tide, m1, m2, food, dealer] = ['浊心斯卡蒂', '斯卡蒂', '幽灵鲨', '蕾缪安', '耀骑士临光'].map(of);
    const pieces = [tide, m1, m2, food, dealer];
    const lead = fieldModel(m, ps, true).lead;
    assert.ok(lead, '管 is self-bound');
    const rec = m.gd.chess(tide.id);
    const dist = (a, b) => { const [r, c] = parseKey(a), [x, y] = parseKey(b); return Math.abs(r - x) + Math.abs(c - y); };
    const covers = (p, key, dir) => {
      const [r, c] = parseKey(key);
      return (m.gd.chess(p.id).rangeGrid || []).map(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, dir); return tileKey(r + a, c + b); });
    };
    const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
    // her tile reaches the body, the victim in front of her reaches nothing; the other pieces stand beyond her range
    let spot = null;
    for (const key of legal(ps, tide)) {
      for (const dir of DIRS) {
        if (!covers(tide, key, dir).some((k) => lead.tiles.has(k))) continue;
        const [kr, kc] = parseKey(key), [fr, fc] = rotateOffset(0, 1, dir);
        const f = tileKey(kr + fr, kc + fc);
        if (!legal(ps, food).has(f)) continue;
        const foodDir = DIRS.find((d) => !covers(food, f, d).some((k) => lead.tiles.has(k)));
        if (foodDir) { spot = { key, dir, f, foodDir }; break; }
      }
      if (spot) break;
    }
    assert.ok(spot, 'a tile for her and the victim');
    const far = (p, used) => {
      const k = [...legal(ps, p)].find((x) => !used.has(x) && dist(x, spot.key) > 2 && dist(x, spot.f) > 1);
      assert.ok(k, `a far tile for ${p.id}`);
      used.add(k);
      return k;
    };
    const used = new Set([spot.key, spot.f]);
    const k1 = far(m1, used), k2 = far(m2, used), kd = far(dealer, used);
    const away = DIRS.find((d) => d !== spot.dir);
    const facing = (p, key) => DIRS.find((d) => { const [a, b] = rotateOffset(0, 1, d); const [r, c] = parseKey(key); return !used.has(tileKey(r + a, c + b)); });
    const plan = (dir, dealerKey = kd, dealerDir = facing(dealer, kd)) => {
      const q = new LayoutPlan();
      q.set(tide.uid, spot.key); q.dirs.set(tide.uid, dir);
      q.set(food.uid, spot.f); q.dirs.set(food.uid, spot.foodDir);
      q.set(m1.uid, k1); q.dirs.set(m1.uid, facing(m1, k1));
      q.set(m2.uid, k2); q.dirs.set(m2.uid, facing(m2, k2));
      q.set(dealer.uid, dealerKey); q.dirs.set(dealer.uid, dealerDir);
      return q;
    };
    const rate = (q) => run(positionPlanSteps(m, ps, pieces, q, { focus: 'egirShip' }, { feed: true, rate: true }));
    // nobody in her range: the difference is her true damage on the leader alone, for the part of the fight the skill runs
    const sk = rec.skill;
    const mul = 1.1; // 精英2 Lv.60 (练度 3)
    const duty = sk.duration / (sk.duration + sk.spCost);
    const want = duty * sk.bb.atk_scale * m.gd.chess(food.id).stats.atk * mul;
    const got = rate(plan(spot.dir)) - rate(plan(away));
    assert.ok(Math.abs(got - want) < 1e-6, `${got} = ${want}`);
    // a dealer in her range that reaches the leader: feeding her is worth more
    const [ar, ac] = parseKey(spot.key), [fr, fc] = rotateOffset(0, 1, away);
    const inFront = tileKey(ar + fr, ac + fc);
    const inRange = [...legal(ps, dealer)].filter((k) => !used.has(k) && k !== inFront).map((k) => {
      const d = DIRS.find((x) => covers(dealer, k, x).some((t) => lead.tiles.has(t)));
      return d && covers(tide, spot.key, spot.dir).includes(k) ? [k, d] : null;
    }).find(Boolean);
    assert.ok(inRange, 'a tile for the dealer in her range, reaching the leader');
    const fed = rate(plan(spot.dir, ...inRange)) - rate(plan(away, ...inRange));
    assert.ok(fed > got, `the 鼓舞 scales with what she devours (${fed} > ${got})`);
  } finally { h.dispose?.(); }
});

test('the model hands the members what the sim hands them: a rehearsal candidate\'s first tick', () => {
  const { h, m, ps, pieces } = prep('boss', NAMES);
  try {
    m.botRehearsal = 6;
    const base = sparsePlan(m, ps, pieces);
    const [fed] = run(devourFeedSteps(m, ps, pieces, [base], { focus: 'egirShip' }));
    assert.ok(fed, 'a feeding candidate');
    const job = createRehearsal(m, ps, pieces, [base, fed]);
    assert.ok(job, 'two candidates to rehearse');
    const battle = m.newBattle(job.inputs[1], { preview: true });
    battle.step();
    const marks = marksOf(m, fed, pieces);
    const byUid = new Map(pieces.map((p) => [p.uid, p]));
    let total = 0;
    for (const u of battle.allyUnits) {
      if (u.ownerId !== ps.playerId || !marks.has(u.uid)) continue;
      const want = [...marks.get(u.uid)].reduce((s, q) => s + m.gd.chess(byUid.get(q).id).stats.atk, 0);
      const got = u.buffs.find((b) => b.key === 'bond:egir:devour')?.mods?.atkFinal || 0;
      assert.equal(got, want, `${u.name}'s devoured ATK`);
      total += got;
    }
    assert.ok(total > 0, 'the candidate does feed in the sim');
  } finally { h.dispose?.(); }
});

test('a blower scales the holder\'s own ATK, not the devoured ATK: the rating\'s ATK is the sim\'s', () => {
  const u = new Unit({ id: 1, side: 'ally', kind: 'op', base: { maxHp: 1000, atk: 640, def: 0, res: 0, aspd: 100, bat: 1 } });
  u.alive = true;
  u.cultMul = { hp: 1.1, atk: 1.1, def: 1.1 };
  u.buffs.push({ key: 'air', stacks: 1, mods: { atkPct: 0.3 } }, { key: 'fed', stacks: 1, mods: { atkFinal: 875 } });
  u.markDirty();
  assert.ok(Math.abs(u.s.atk - fedAtk(640, 875, 1.1, 1.3)) < 1e-9, `${u.s.atk} vs ${fedAtk(640, 875, 1.1, 1.3)}`);
});

test('no feeding candidate: a normal round, the hidden core, or without an active 阿戈尔', () => {
  {
    const { h, m, ps, pieces } = prep(7, NAMES);
    try {
      assert.ok(m.wave, 'a normal round');
      assert.deepEqual(run(devourFeedSteps(m, ps, pieces, [sparsePlan(m, ps, pieces)], { focus: 'egirShip' })), []);
    } finally { h.dispose?.(); }
  }
  {
    const { h, m, ps, pieces } = prep('boss', NAMES);
    try {
      m.round = m.gd.hiddenRound;
      assert.deepEqual(run(devourFeedSteps(m, ps, pieces, [sparsePlan(m, ps, pieces)], { focus: 'egirShip' })), [], 'the hidden core keeps its own candidates');
    } finally { h.dispose?.(); }
  }
  {
    const { h, m, ps, pieces } = prep('boss', ['斯卡蒂', '幽灵鲨', '耀骑士临光', '蕾缪安', '史尔特尔']);
    try {
      assert.deepEqual(run(devourFeedSteps(m, ps, pieces, [sparsePlan(m, ps, pieces)], { focus: 'egirShip' })), [], 'two members: no devour');
    } finally { h.dispose?.(); }
  }
});

test('the Final Assault rehearsal takes the feeding candidates after the others', () => {
  const finalJob = (names) => {
    const { h, m, ps, pieces } = prep('boss', names);
    m.botRehearsal = 6;
    for (const p of pieces) {
      const k = [...legal(ps, p)].find((x) => !ps.board.has(x));
      const [r, c] = parseKey(k);
      ps.move(p.uid, { area: 'board', row: r, col: c }, 'RIGHT');
    }
    const job = arrange(m, ps, { final: true, defer: true });
    return { h, m, pieces: job?.chosen.filter((p) => p.kind === 'chess') ?? pieces, job };
  };
  const a = finalJob(NAMES);
  try {
    assert.ok(a.job, 'a rehearsal job');
    const withFeed = a.job.plans.map((pl) => devouredAtk(a.m, pl, a.pieces));
    const last = withFeed[withFeed.length - 1];
    assert.ok(last > 0, 'the last candidate feeds the devour');
    assert.ok(last >= Math.max(...withFeed.slice(0, -2)), `it feeds more than the plans before it (${withFeed})`);
  } finally { a.h.dispose?.(); }
});

test('a member-only chain: the first in the chain keeps the ATK of all it marks through', () => {
  const { h, m, ps, byName, pieces } = prep('boss', ['歌蕾蒂娅', '斯卡蒂', '乌尔比安', '史尔特尔']);
  try {
    const [a, b, c] = ['歌蕾蒂娅', '斯卡蒂', '乌尔比安'].map((n) => byName.get(n));
    const plan = new LayoutPlan();
    // three tiles in a line, each legal for its piece
    let line = null;
    for (const k of legal(ps, a)) {
      const [r, cc] = parseKey(k);
      for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
        const [dr, dc] = rotateOffset(0, 1, dir);
        const k2 = tileKey(r + dr, cc + dc), k3 = tileKey(r + 2 * dr, cc + 2 * dc);
        if (legal(ps, b).has(k2) && legal(ps, c).has(k3)) { line = { k, k2, k3, dir }; break; }
      }
      if (line) break;
    }
    assert.ok(line, 'three tiles in a line');
    plan.set(a.uid, line.k); plan.dirs.set(a.uid, line.dir);
    plan.set(b.uid, line.k2); plan.dirs.set(b.uid, line.dir);
    plan.set(c.uid, line.k3); plan.dirs.set(c.uid, 'LEFT');
    const other = pieces.find((p) => !plan.has(p.uid));
    const k = [...legal(ps, other)].find((x) => ![...plan.values()].includes(x));
    plan.set(other.uid, k); plan.dirs.set(other.uid, 'RIGHT');
    const mine = marksOf(m, plan, pieces);
    assert.deepEqual([...mine.get(a.uid)], [b.uid, c.uid], '歌蕾蒂娅 marks through 斯卡蒂 to 乌尔比安');
    assert.ok(run(positionPlanSteps(m, ps, pieces, plan, { focus: 'egirShip' }, { feed: true, rate: true })) > 0, 'the rating reads the plan');
  } finally { h.dispose?.(); }
});

// the other versions' data, each in its own process; 第一期's 海沟实验体 holder marks its four neighbours
const versioned = fileURLToPath(new URL('../helpers/devourFeedVersion.mjs', import.meta.url));
for (const version of ['act2autochess@V2_1', 'act1autochess', 'act1autochess@V1_1']) {
  test(`${version}: the Final Assault gets a feeding candidate and the sim hands its members the ATK`, () => {
    const result = spawnSync(process.execPath, [versioned, version], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  });
}
