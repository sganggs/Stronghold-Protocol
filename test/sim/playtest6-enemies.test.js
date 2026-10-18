// test/sim/playtest6-enemies.test.js — user playtest #6, workstream WG (enemies), real enemy data in the real sim:
//   #13 “萨科塔之翼”'s 恐惧 (the user's "战栗（小范围乱飞）"): below half HP it fears itself for 5 s (SelfFear, ×1.5 speed) —
//       official 恐惧 = "无法被阻挡并四散逃跑" (ba.fear); a self-inflicted fear has no 恐惧可达地块, so the unit keeps picking
//       a random point of its own tile (±0.25) and flies there (PRTS 诱发移动 §恐惧). It used to hang still. Also
//       “萨科塔之眼” / “萨科塔昂首” (same talent) and an operator's fear (runs away from the source, fan of ±45°).
//   #12 萨卡兹枯朽战车 / 尖端: initial SP 2 = max ⇒ the FIRST attack is 秽蚀轰击 (100 % + a 【污染秽蚀】 of radius 1.7 for 10 s),
//       then every 3rd; 污染秽蚀 = 50 / 25 true damage per second on low / high ground, same-name zones do not stack
//       (PRTS 萨卡兹枯朽战车 / 萨卡兹枯朽战士). It used to pollute only from the 3rd attack, radius 1 [ASSUMED], HP loss, stacking.
//   Review follow-up: the 恐惧 and 诱导 walks re-plan from where the enemy stands after a push (Battle.displace), an
//       obstacle change or (诱导) an outranking 恐惧 — a stale path walked through walls (real stages m01–m04).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { reachableTiles, FEAR_RADIUS } from '../../server/sim/fear.js';
import { createRng } from '../../server/sim/rng.js';
import { ALLY_COLLIDER_RADIUS } from '../../server/sim/constants.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const tb = (key, k) => E[key].talents.bb[k];
const WALL = (id, o = {}) => chessRec({ id, profession: o.profession ?? 'TANK', position: o.position, stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: o.block ?? 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });

function arena(o = {}) {
  const { chess = {}, kits = {}, ...rest } = o;
  return makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 11, autoFinish: false, timeLimit: 600,
    defs: { chess: { t_wall: WALL('t_wall'), t_wall2: WALL('t_wall2'), t_hi: WALL('t_hi', { profession: 'SNIPER', position: 'RANGED', block: 0 }), ...chess } },
    kits: { t_wall: NOATK, t_wall2: NOATK, t_hi: NOATK, ...kits }, ...rest,
  });
}

/** Positions of `e` over `secs` game seconds (one sample per tick). */
function track(h, e, secs) {
  const out = [];
  const n = Math.round(secs * 30);
  for (let i = 0; i < n; i++) { h.step(); out.push({ t: h.b.time, x: e.x, y: e.y, moving: e.moving, blocked: !!e.blockedBy, atk: e.stats.attacks }); }
  return out;
}
const pathLen = (p) => p.reduce((s, q, i) => (i ? s + Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y) : 0), 0);
/** Sign changes of the horizontal movement (ignoring standstill). */
function turns(p) {
  let n = 0, last = 0;
  for (let i = 1; i < p.length; i++) {
    const dx = p[i].x - p[i - 1].x;
    if (Math.abs(dx) < 1e-6) continue;
    const s = dx > 0 ? 1 : -1;
    if (last && s !== last) n++;
    last = s;
  }
  return n;
}

describe('#13 “萨科塔” self-fear: flutters at random inside a small area, then flies on', () => {
  for (const key of ['enemy_10083_hlbird', 'enemy_10084_hlegle', 'enemy_10085_hllevi_2']) {
    test(`${key} ${E[key].name}: 5 s of random flight inside its tile (±0.25), ×1.5 speed, then its route again`, () => {
      const h = arena({ units: [{ chessId: 't_hi', row: 11, col: 2 }] });
      const e = h.spawn(key, { routeIndex: 2 });            // flat stage fly lane (9,10) → (9,2)
      h.run(4);                                             // on its way (x ≈ 10 − 0.45·4)
      assert.equal(e.motion, 'FLY');
      const x0 = e.x;
      h.b.dealDamage(h.unit('t_hi'), e, { amount: e.s.maxHp * 0.6, type: 'true' });
      assert.ok(e.s.flags.fear, 'feared');
      const tr = Math.round(e.y), tc = Math.round(e.x);
      const fear = tb(key, 'SelfFear.fear');
      const p = track(h, e, fear - 0.1);
      const settled = p.filter((q) => q.t > h.b.time - fear + 1.2);
      for (const q of p) assert.ok(Math.abs(q.x - tc) <= 0.5 + 1e-6 && Math.abs(q.y - tr) <= 0.5 + 1e-6, `stays on its tile: ${q.x.toFixed(2)},${q.y.toFixed(2)}`);
      for (const q of settled) assert.ok(Math.abs(q.x - tc) <= 0.25 + 1e-6 && Math.abs(q.y - tr) <= 0.25 + 1e-6, `inside the 0.5 square: ${q.x.toFixed(2)},${q.y.toFixed(2)}`);
      const len = pathLen(p);
      const speed = e.base.moveSpeed * 0.5 * tb(key, 'SelfFear.move_speed');
      assert.ok(len > 0.6 * speed * fear, `keeps flying (${len.toFixed(2)} tiles in ${fear} s, speed ${speed})`);
      assert.ok(turns(p) >= 3, `changes direction at random (${turns(p)} turns)`);
      assert.ok(p.filter((q) => q.moving).length > 0.8 * p.length, 'animated as moving');
      assert.ok(Math.abs(p[p.length - 1].x - x0) < 0.6, 'does not advance along its route meanwhile');
      h.run(0.2);
      assert.ok(!e.s.flags.fear, 'the fear ended');
      const xe = e.x;
      h.run(3);
      assert.ok(e.x < xe - 0.8 * e.s.moveSpeed * 0.5 * 3, `flies on toward the goal (${xe.toFixed(2)} → ${e.x.toFixed(2)})`);
    });
  }

  test('deterministic: the same seed flies the same wander', () => {
    const run = () => {
      const h = arena({ units: [{ chessId: 't_hi', row: 11, col: 2 }] });
      const e = h.spawn('enemy_10083_hlbird', { routeIndex: 2 });
      h.run(3);
      h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.6, type: 'true' });
      return track(h, e, 4).map((q) => `${q.x.toFixed(6)},${q.y.toFixed(6)}`).join(' ');
    };
    assert.equal(run(), run());
  });
});

describe('#13 恐惧 from an operator: unblockable, flees into the fan away from the source', () => {
  test('a walking enemy feared by an operator west of it runs east (±45°), never attacks, then walks its route again', () => {
    const walker = { key: 'enemy_walker', name: 'w', rank: 'NORMAL', applyWay: 'MELEE', stats: { maxHp: 1e7, atk: 100, def: 0, res: 0, moveSpeed: 1, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: 1, lpr: 1, dmgType: 'phys', motion: 'WALK', immunities: {}, otherImmunities: [] }, talents: { bb: {} }, skills: [], abilities: [], tags: [] };
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], defs: { chess: { t_wall: WALL('t_wall') }, enemies: { enemy_walker: walker } } });
    const e = h.spawn('enemy_walker', { routeIndex: 0 });
    const u = h.unit('t_wall');
    assert.ok(h.runUntil(() => e.blockedBy === u, 20), 'blocked first');
    h.b.applyStatus(e, 'fear', { duration: 4, source: u });
    assert.equal(e.blockedBy, null, 'released');
    const tiles = reachableTiles(h.b, e, e.findBuff('fear').data.fear);
    assert.ok(tiles.length > 3, `a fan of reachable tiles (${tiles.length})`);
    for (const k of tiles) {
      const r = Math.floor(k / 21), c = k % 21;
      const vx = c - e.x, vy = r - e.y, L = Math.hypot(vx, vy);
      assert.ok(L <= FEAR_RADIUS + 1e-6 && (L < 1e-6 || vx / L >= Math.SQRT1_2 - 1e-6), `(${r},${c}) inside the eastern fan`);
      assert.ok(h.b.grid.walkable(r, c, true) && h.b.grid.tile(r, c).special !== 'end');
    }
    const d0 = Math.hypot(e.x - u.x, e.y - u.y);
    const a0 = e.stats.attacks;
    const p = track(h, e, 3.9);
    assert.ok(p.every((q) => !q.blocked), 'never blocked while feared');
    assert.equal(e.stats.attacks, a0, 'no attack while feared');
    assert.ok(pathLen(p) > 1.5, 'it runs');
    assert.ok(Math.hypot(e.x - u.x, e.y - u.y) > d0 + 0.5, 'farther from the source');
    for (const q of p) assert.ok(h.b.grid.walkable(Math.round(q.y), Math.round(q.x), true), 'on walkable ground');
    h.run(0.3);
    assert.ok(!e.s.flags.fear);
    assert.ok(h.runUntil(() => e.blockedBy === u, 20), 'walks back its route and is blocked again');
  });

  test('恐惧 outranks 诱导 (PRTS 诱移优先级)', () => {
    const walker = { key: 'enemy_walker', name: 'w', rank: 'NORMAL', applyWay: 'MELEE', stats: { maxHp: 1e7, atk: 0, def: 0, res: 0, moveSpeed: 1, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: 1, lpr: 1, dmgType: 'none', motion: 'WALK', immunities: {}, otherImmunities: [] }, talents: { bb: {} }, skills: [], abilities: [], tags: [] };
    const h = arena({ units: [{ chessId: 't_hi', row: 11, col: 2 }], defs: { chess: { t_hi: WALL('t_hi', { profession: 'SNIPER', position: 'RANGED', block: 0 }) }, enemies: { enemy_walker: walker } } });
    const e = h.spawn('enemy_walker', { routeIndex: 0, pos: [9, 6], mods: { speedMul: 1 } });
    h.step();
    h.b.applyStatus(e, 'attract', { duration: 3, point: [12, 6] });
    h.b.applyStatus(e, 'fear', { duration: 3, source: null });   // no source: no reachable tile, flutters on its tile
    const r0 = Math.round(e.y);
    track(h, e, 2.5);
    assert.equal(Math.round(e.y), r0, 'stays on its tile instead of walking to the attract point');
  });
});

describe('#13 恐惧 / 诱导 walks re-plan when something else moves the enemy (review follow-up)', () => {
  const WALKER = { key: 'enemy_walker', name: 'w', rank: 'NORMAL', applyWay: 'MELEE', stats: { maxHp: 1e7, atk: 0, def: 0, res: 0, moveSpeed: 1, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: 0, lpr: 1, dmgType: 'none', motion: 'WALK', immunities: {}, otherImmunities: [] }, talents: { bb: {} }, skills: [], abilities: [], tags: [] };
  const STAGES = ['act2autochess_m01', 'act2autochess_m02', 'act2autochess_m03', 'act2autochess_m04'];
  /** A walker on a real stage at a deterministic walkable tile of the lower lanes. */
  function realWalker(stageId, seed, pick) {
    const h = makeBattle({ stageId, seed, autoFinish: false, timeLimit: 300, content: 'generic', defs: { enemies: { enemy_walker: WALKER } },
      routes: [{ motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] }] });
    const g = h.b.grid;
    const walk = [];
    for (let r = 9; r <= 12; r++) for (let c = 2; c <= 18; c++) if (g.walkable(r, c) && g.tile(r, c).special !== 'end') walk.push([r, c]);
    const e = h.spawn('enemy_walker', { routeIndex: 0, pos: walk[pick(walk.length)] });
    h.step();
    return { h, g, e, walk };
  }
  /** Ticks (over `secs`) the enemy spent on a tile it cannot walk, `when(e)` filtering the ticks counted. */
  function offGround(h, g, e, secs, when = () => true) {
    let n = 0;
    for (let i = 0; i < Math.round(secs * 30); i++) { h.step(); if (when(e) && !g.walkable(Math.round(e.y), Math.round(e.x), true)) n++; }
    return n;
  }

  test('a feared walker pushed mid-hop (Battle.displace) re-plans from where it lands: it never cuts through walls', () => {
    const rng = createRng(5);
    let pushed = 0;
    const bad = [];
    for (const stageId of STAGES) {
      for (let n = 0; n < 60; n++) {
        const { h, g, e } = realWalker(stageId, n + 1, (len) => (n * 7 + 3) % len);
        const a1 = rng() * Math.PI * 2, a2 = rng() * Math.PI * 2;
        h.b.applyStatus(e, 'fear', { duration: 4, source: { x: e.x + Math.cos(a1), y: e.y + Math.sin(a1), side: 'ally' } });
        h.run(0.3 + rng());
        if (h.b.displace(e, { x: Math.cos(a2), y: Math.sin(a2) }, 1.5, { force: 3 }) > 0) pushed++;
        if (offGround(h, g, e, 4)) bad.push(`${stageId}#${n + 1}`);
      }
    }
    assert.ok(pushed > 150, `pushes landed (${pushed})`);
    assert.deepEqual(bad, [], 'walked onto an unwalkable tile after the push');
  });

  test('an obstacle appearing on a feared walker\'s path (grid.version) is walked around, not into', () => {
    let tried = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const h = arena({ seed, defs: { enemies: { enemy_walker: { ...WALKER, stats: { ...WALKER.stats, massLevel: 1 } } } } });
      const e = h.spawn('enemy_walker', { routeIndex: 0, pos: [10, 8] });
      h.step();
      h.b.applyStatus(e, 'fear', { duration: 6, source: { x: 6, y: 10, side: 'ally' } });   // flee east
      h.step();
      const m = e.mem.fearMove;
      const p = m && m.pts && m.pts[m.i];
      if (!p) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
      if (d < 1.2) continue;
      const r = Math.round(e.y + dy / d), c = Math.round(e.x + dx / d);   // the tile one step ahead
      if (r === Math.round(e.y) && c === Math.round(e.x)) continue;
      h.b.setObstacle(r, c, true);
      tried++;
      const t = track(h, e, 3);
      assert.ok(t.every((q) => Math.round(q.y) !== r || Math.round(q.x) !== c), `seed ${seed}: kept off the new obstacle (${r},${c})`);
      assert.ok(pathLen(t) > 1, `seed ${seed}: still running`);
    }
    assert.ok(tried >= 20, `obstacles placed ahead in ${tried} runs`);
  });

  test('诱导 after an outranking 恐惧, and 诱导 after a push, re-plan from where the enemy stands (no wall cutting)', () => {
    const rng = createRng(77);
    const afterFear = [], afterPush = [];
    for (const stageId of STAGES) {
      for (let n = 0; n < 60; n++) {
        {
          const { h, g, e, walk } = realWalker(stageId, n + 1, (len) => Math.floor(rng() * len));
          h.b.applyStatus(e, 'attract', { duration: 14, point: walk[Math.floor(rng() * walk.length)] });
          h.run(0.5 + rng() * 2);
          const ang = rng() * Math.PI * 2;
          h.b.applyStatus(e, 'fear', { duration: 2 + rng() * 2, source: { x: e.x + Math.cos(ang), y: e.y + Math.sin(ang), side: 'ally' } });
          if (offGround(h, g, e, 10, (x) => !x.s.flags.fear)) afterFear.push(`${stageId}#${n + 1}`);
        }
        {
          const { h, g, e, walk } = realWalker(stageId, n + 1, (len) => (n * 7 + 3) % len);
          h.b.applyStatus(e, 'attract', { duration: 6, point: walk[(n * 13 + 5) % walk.length] });
          h.run(0.3 + rng());
          const a = rng() * Math.PI * 2;
          h.b.displace(e, { x: Math.cos(a), y: Math.sin(a) }, 1.5, { force: 3 });
          if (offGround(h, g, e, 4)) afterPush.push(`${stageId}#${n + 1}`);
        }
      }
    }
    assert.deepEqual(afterFear, [], 'the 诱导 walk after the 恐惧 cut through an unwalkable tile');
    assert.deepEqual(afterPush, [], 'the 诱导 walk after a push cut through an unwalkable tile');
  });
});

describe('#12 萨卡兹枯朽战车: 秽蚀轰击 first, 污染秽蚀 radius 1.7, true damage, no stacking', () => {
  for (const key of ['enemy_1272_nhtank', 'enemy_1272_nhtank_2']) {
    test(`${key} ${E[key].name}: attacks 1, 4, 7 are 秽蚀轰击 (100 % + zone r 1.7 / 10 s); the zone hits 50 / 25 true per second`, () => {
      // (10,7) road = low ground; (11,7) raised to high ground (ranged tile) inside the zone
      const flat = { rows: { 11: '##hrrrrhrrfrrrrrrrf##' } };
      const h = arena({ flat, units: [{ chessId: 't_wall', row: 10, col: 7 }, { chessId: 't_hi', row: 11, col: 7 }], captureNoisy: true, hooks: ['damaged', 'attack'] });
      h.step();
      const e = h.spawn(key, { pos: [9, 8], routeIndex: 0, mods: { speedMul: 0 } });
      h.runUntil(() => e.stats.attacks >= 7, 60);
      h.run(1);                                             // the 7th shot lands
      const fx = h.eventsOf('fx').filter((f) => f[1] === 'zone' && f[4].kind === 'pollution');
      assert.equal(fx.length, 3, `three zones in seven attacks (${fx.length})`);
      for (const f of fx) {
        assert.equal(f[4].r, 1.7, 'radius 1.7 (PRTS)');
        assert.equal(f[4].dur, E[key].skills[0].bb.projectile_life_time);
        assert.equal(f[4].id, e.id, 'the zone names its source (display only)');
      }
      const dmg = h.hooksOf('damaged').filter((c) => c.source === e);
      const atk = e.s.atk;
      const hits = dmg.filter((c) => c.dmg.isAttack && c.target === h.unit('t_wall')).map((c) => c.amount / atk);
      assert.deepEqual(hits.slice(0, 7).map((x) => Math.round(x * 100) / 100), [1, 1, 1, 1, 1, 1, 1], 'unblocked: 100 % per attack');
      const poll = dmg.filter((c) => (c.dmg.tags || []).includes('pollution'));
      assert.ok(poll.length > 0 && poll.every((c) => c.type === 'true'), '真实伤害');
      const lo = poll.filter((c) => c.target === h.unit('t_wall')), hi = poll.filter((c) => c.target === h.unit('t_hi'));
      assert.ok(lo.length > 5 && lo.every((c) => Math.abs(c.amount - 50) < 1e-6), 'low ground 50 / s');
      assert.ok(hi.length > 5 && hi.every((c) => Math.abs(c.amount - 25) < 1e-6), 'high ground 25 / s (it never targets the high ground)');
      assert.equal(dmg.filter((c) => c.dmg.isAttack && c.target === h.unit('t_hi')).length, 0);
      // the first zone is up before the second attack
      const t1 = h.hooksOf('attack').filter((c) => c.attacker === e)[1].t;
      assert.ok(lo.some((c) => c.t < t1 + 1e-6), 'polluting from the first attack on');
    });
  }

  test('reach: its 2.2 range circle takes an operator whose 0.25 collider touches it (PRTS 作战机制 §碰撞体积) — 2.45 from the centre', () => {
    // user follow-up (2026-10-01): "远程攻击射程挺远、伤害很高". The data range stays 2.2; the official target search
    // uses the operators' colliders, which the remake measured from the centre (2.2 reached 13 tiles around it, 2.45 21)
    assert.equal(ALLY_COLLIDER_RADIUS, 0.25);
    assert.equal(E.enemy_1272_nhtank.stats.rangeRadius, 2.2);
    const hitsOn = (r, c) => {
      const h = arena({ units: [{ chessId: 't_wall', row: r, col: c }], captureNoisy: true, hooks: ['damaged'] });
      h.step();
      const e = h.spawn('enemy_1272_nhtank', { pos: [10, 5], routeIndex: 0, mods: { speedMul: 0 } });
      h.run(20);
      return h.hooksOf('damaged').filter((x) => x.source === e && x.dmg.isAttack).length;
    };
    assert.ok(hitsOn(10, 7) >= 4, 'd 2.0: in range');
    assert.ok(hitsOn(11, 7) >= 4, 'd 2.236 > 2.2: in range through the collider (2.45)');
    assert.ok(hitsOn(12, 6) >= 4, 'd 2.236 (the other diagonal)');
    assert.equal(hitsOn(12, 7), 0, 'd 2.83 > 2.45: out of range');
    assert.equal(hitsOn(10, 8), 0, 'd 3.0: out of range');
  });

  test('blocked: normal attacks hit ×2 (近战), the skill attack 100 %; overlapping 污染秽蚀 do not stack', () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
    h.step();
    const a = h.spawn('enemy_1272_nhtank', { pos: [9, 5.6], routeIndex: 0, mods: { speedMul: 0 } });
    const b2 = h.spawn('enemy_1272_nhtank', { pos: [9, 5.7], routeIndex: 0, mods: { speedMul: 0 } });
    h.runUntil(() => a.stats.attacks >= 4 && b2.stats.attacks >= 4, 60);
    const w = h.unit('t_wall');
    const blockedBy = (e) => h.hooksOf('damaged').filter((c) => c.source === e && c.dmg.isAttack && c.target === w).map((c) => Math.round((c.amount / e.s.atk) * 100) / 100);
    const blocked = [a, b2].find((e) => e.blockedBy === w);
    assert.ok(blocked, 'one of them is blocked');
    assert.deepEqual(blockedBy(blocked).slice(0, 4), [1, 2, 2, 1], 'skill 100 %, melee 200 %, 200 %, skill 100 %');
    // both tanks' zones cover the wall: one 50 per second, not two
    const poll = h.hooksOf('damaged').filter((c) => c.target === w && (c.dmg.tags || []).includes('pollution'));
    assert.ok(poll.length > 4);
    for (let i = 1; i < poll.length; i++) assert.ok(poll[i].t - poll[i - 1].t > 1 - 1e-6, `one tick per second (${poll[i - 1].t.toFixed(2)} → ${poll[i].t.toFixed(2)})`);
  });
});
