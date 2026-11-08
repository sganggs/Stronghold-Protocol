// §37.70 the 阿戈尔 devour in the layouts (round 64: the devour knocked out a non-member at t = 0 in 23 of 42 five-阿戈尔
// battles): a normal round's positional plan no longer feeds a member a piece the 物理流失 knocks out, each rehearsal
// candidate that does gets a devour-safe twin, and a boss field's devour stays the rehearsal's (the members gain the base
// ATK and block of what they devour: the devour-safe candidates dealt less leader damage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { positionPlanSteps, devourTwinsSteps, LayoutPlan } from '../../server/match/bot.js';
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

/** The pieces a plan feeds the devour (bot.js devourValue): in front of a member, through members along their facing. */
function fed(m, plan, pieces) {
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const at = new Map([...plan].map(([uid, key]) => [key, uid]));
  const out = new Set();
  for (const p of pieces) {
    if (!member(m, p)) continue;
    const seen = new Set([p.uid]);
    for (let cur = p.uid, g = 0; g < 8; g++) {
      const q = at.get(front(plan, cur));
      if (q == null || seen.has(q)) break;
      seen.add(q);
      out.add(q);
      if (!member(m, byUid.get(q))) break;
      cur = q;
    }
  }
  return out;
}

/**
 * A base plan: `eater` faces the second tile of a legal pair, where `food` stands (without food: a tile off the deploy
 * map); every other piece on a free legal tile beside no other piece, the members turned to face a tile that holds nothing.
 */
function basePlan(m, ps, pieces, eater, food) {
  const map = ps.deployMap();
  const legal = (p) => new Set(legalTiles(map, placeClass(ps, ps.gd.chess(p.id))).map(([r, c]) => tileKey(r, c)));
  const plan = new LayoutPlan();
  const used = new Set();
  const E = legal(eater), F = food ? legal(food) : null;
  let pair = null;
  for (const k of E) {
    const [r, c] = parseKey(k);
    for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
      const [dr, dc] = rotateOffset(0, 1, dir);
      const f = tileKey(r + dr, c + dc);
      if (food ? F.has(f) : !map.has(f)) { pair = { k, f, dir }; break; }
    }
    if (pair) break;
  }
  assert.ok(pair, 'a tile for the eater and its front');
  plan.set(eater.uid, pair.k); plan.dirs.set(eater.uid, pair.dir); used.add(pair.k); used.add(pair.f);
  if (food) { plan.set(food.uid, pair.f); plan.dirs.set(food.uid, pair.dir); }
  const near = (k) => [pair.k, pair.f].some((x) => { const [a, b] = parseKey(x), [c, d] = parseKey(k); return Math.abs(a - c) + Math.abs(b - d) <= 1; });
  for (const p of pieces) {
    if (plan.has(p.uid)) continue;
    const k = [...legal(p)].find((x) => !used.has(x) && !near(x) && ![...used].some((u) => { const [a, b] = parseKey(u), [c, d] = parseKey(x); return Math.abs(a - c) + Math.abs(b - d) <= 1; }));
    assert.ok(k, `a free tile for ${p.id}`);
    used.add(k);
    plan.set(p.uid, k);
    plan.dirs.set(p.uid, 'RIGHT');
  }
  // nobody else in front of a member
  for (const p of pieces) {
    if (p === eater || !member(m, p)) continue;
    for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
      plan.dirs.set(p.uid, dir);
      if (![...plan.values()].includes(front(plan, p.uid))) break;
    }
  }
  return plan;
}

test('the Final Assault leaves the devour to the rehearsal: no positional plan and no twin for it', () => {
  const names = ['斯卡蒂', '幽灵鲨', '乌尔比安', '耀骑士临光', '莱恩哈特', '史尔特尔'];
  const { h, m, ps, byName, pieces } = prep('boss', names);
  try {
    assert.equal(m.wave, null, 'the Final Assault has no wave');
    const base = basePlan(m, ps, pieces, byName.get('斯卡蒂'), byName.get('耀骑士临光'));
    assert.ok(fed(m, base, pieces).has(byName.get('耀骑士临光').uid), 'the fixture feeds 耀骑士临光 to 斯卡蒂');
    assert.equal(run(positionPlanSteps(m, ps, pieces, base, { focus: 'egirShip' })), null, 'no positional plan');
    assert.deepEqual(run(devourTwinsSteps(m, ps, pieces, [base], { focus: 'egirShip' })), [], 'no twin');
  } finally { h.dispose?.(); }
});

test('a normal round no longer feeds a non-member the devour knocks out (耀骑士临光, 2968 HP against 4728)', () => {
  const names = ['斯卡蒂', '幽灵鲨', '乌尔比安', '耀骑士临光', '莱恩哈特', '史尔特尔'];
  const { h, m, ps, byName, pieces } = prep(7, names);
  try {
    assert.ok(m.wave, 'a normal round');
    const base = basePlan(m, ps, pieces, byName.get('斯卡蒂'), byName.get('耀骑士临光'));
    const plan = run(positionPlanSteps(m, ps, pieces, base, { focus: 'egirShip' })) ?? base;
    assert.ok(!fed(m, plan, pieces).has(byName.get('耀骑士临光').uid), '耀骑士临光 is not devoured');
  } finally { h.dispose?.(); }
});

test('a normal round feeds the member that survives the devour (乌尔比安, 7346 HP), not the higher-tier piece it would knock out', () => {
  const names = ['斯卡蒂', '幽灵鲨', '乌尔比安', '耀骑士临光', '莱恩哈特', '史尔特尔'];
  const { h, m, ps, byName, pieces } = prep(7, names);
  try {
    const base = basePlan(m, ps, pieces, byName.get('斯卡蒂'), null);
    assert.equal(fed(m, base, pieces).size, 0, 'the fixture feeds nothing');
    const plan = run(positionPlanSteps(m, ps, pieces, base, { focus: 'egirShip' }));
    assert.ok(plan, 'feeding a survivor adds layers');
    const eaten = [...fed(m, plan, pieces)].map((uid) => pieces.find((p) => p.uid === uid).id).map((id) => m.gd.chess(id).name);
    assert.ok(eaten.includes('乌尔比安'), `乌尔比安 is devoured (${eaten})`);
    for (const n of ['耀骑士临光', '莱恩哈特', '史尔特尔', '斯卡蒂', '幽灵鲨']) assert.ok(!eaten.includes(n), `${n} (knocked out by one mark) is not`);
  } finally { h.dispose?.(); }
});

test('a normal round\'s rehearsal candidate that feeds a piece the devour knocks out gets a devour-safe twin with its tags; one that feeds a survivor does not', () => {
  const names = ['斯卡蒂', '幽灵鲨', '乌尔比安', '耀骑士临光', '莱恩哈特', '史尔特尔'];
  const { h, m, ps, byName, pieces } = prep(7, names);
  try {
    const kills = basePlan(m, ps, pieces, byName.get('斯卡蒂'), byName.get('耀骑士临光'));
    kills.lineup = new Set(pieces.map((p) => p.uid));
    const feeds = basePlan(m, ps, pieces, byName.get('斯卡蒂'), byName.get('乌尔比安'));
    assert.ok(fed(m, feeds, pieces).has(byName.get('乌尔比安').uid), 'the second candidate feeds 乌尔比安');
    const twins = run(devourTwinsSteps(m, ps, pieces, [kills, feeds], { focus: 'egirShip' }));
    assert.equal(twins.length, 1, 'one twin: of the candidate that knocks 耀骑士临光 out');
    assert.ok(!fed(m, twins[0], pieces).has(byName.get('耀骑士临光').uid), 'the twin does not feed it');
    assert.equal(twins[0].lineup, kills.lineup, 'the twin keeps its candidate\'s lineup');
    assert.notEqual(twins[0], kills, 'the original stays a candidate of its own');
  } finally { h.dispose?.(); }
});

// 第一期's 海沟实验体: its 阿戈尔 holder devours the four neighbours (sim bonds/core.js devour), each in its own data process
const trench = fileURLToPath(new URL('../helpers/devourTrench.mjs', import.meta.url));
for (const version of ['act1autochess', 'act1autochess@V1_1']) {
  test(`${version}: a normal round moves the non-member beside a 海沟实验体 holder away`, () => {
    const result = spawnSync(process.execPath, [trench, version], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  });
}
