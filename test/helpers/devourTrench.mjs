// §37.70 in 第一期's data (node devourTrench.mjs <version>): an 阿戈尔 holding 海沟实验体 devours its four neighbours, so a
// normal round's positional plan moves the non-member the devour knocks out, standing beside it (not in front), away.
import assert from 'node:assert/strict';
import { getVersionData, setData } from '../../server/data.js';
import { installOfficialBounds, officialBoundsOf } from '../../shared/plugins/officialBounds.js';

const version = process.argv[2];
if (!version) process.exit(0);
const data = setData(getVersionData(version, { log: { info() {}, warn() {}, error() {} } }));
installOfficialBounds(officialBoundsOf(data));
const { makeMatch, give } = await import('../match/harness.js');
const { positionPlanSteps, LayoutPlan } = await import('../../server/match/bot.js');
const { rotateOffset } = await import('../../server/sim/dir.js');
const { tileKey, parseKey, legalTiles, placeClass } = await import('../../server/match/board.js');

const TRENCH = 'act1autochess_equip_acarm078_global_buff';
const h = makeMatch({ data, mode: 'solo', difficulty: 'HARD', seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], seed: 3 }).start().toPrep();
try {
  const m = h.m, ps = m.order[0];
  m.startRound(7);
  assert.ok(m.wave, 'a normal round');
  ps.hand.fill(null); ps.board.clear(); ps.recompute();
  const chess = Object.values(m.gd.raw.chess).filter((c) => !c.isGolden && c.visible !== false);
  const byName = (n) => chess.find((c) => c.name === n);
  const trench = Object.entries(m.gd.raw.items).find(([id, it]) => /_a$/.test(id) && (it.buffs || []).some((b) => b?.bbStr?.key === TRENCH));
  assert.ok(trench, `${version} has 海沟实验体`);
  const holder = give(m, ps, byName('斯卡蒂').chessId, 'hand');
  holder.items = [{ kind: 'item', uid: 9001, id: trench[0] }];
  const members = ['乌尔比安', '深巡'].map((n) => give(m, ps, byName(n).chessId, 'hand'));
  // a non-member the 6000 物理流失 knocks out, standing beside the holder
  const food = give(m, ps, chess.find((c) => !c.bonds.includes('egirShip') && c.tier <= 3 && placeClass(ps, c) !== 'ranged'
    && (c.stats?.maxHp || 0) < 3000).chessId, 'hand');
  const pieces = [holder, ...members, food];
  const map = ps.deployMap();
  const legal = (p) => new Set(legalTiles(map, placeClass(ps, ps.gd.chess(p.id))).map(([r, c]) => tileKey(r, c)));
  const L = legal(holder), F = legal(food);
  const base = new LayoutPlan();
  // the holder faces a tile that holds nothing; the food stands on a side neighbour
  let pair = null;
  for (const k of L) {
    const [r, c] = parseKey(k);
    for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
      const [fr, fc] = rotateOffset(0, 1, dir), [sr, sc] = rotateOffset(1, 0, dir);
      const side = tileKey(r + sr, c + sc);
      if (F.has(side) && side !== tileKey(r + fr, c + fc)) { pair = { k, dir, side }; break; }
    }
    if (pair) break;
  }
  assert.ok(pair, 'a holder tile with a legal side neighbour');
  base.set(holder.uid, pair.k); base.dirs.set(holder.uid, pair.dir);
  base.set(food.uid, pair.side); base.dirs.set(food.uid, pair.dir);
  const used = new Set([pair.k, pair.side]);
  const far = (k) => [...used].every((u) => { const [a, b] = parseKey(u), [c, d] = parseKey(k); return Math.abs(a - c) + Math.abs(b - d) > 1; });
  for (const p of members) {
    const k = [...legal(p)].find((x) => !used.has(x) && far(x));
    assert.ok(k, 'a free tile');
    used.add(k); base.set(p.uid, k); base.dirs.set(p.uid, 'RIGHT');
  }
  // nothing in front of the other members
  for (const p of members) {
    for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
      base.dirs.set(p.uid, dir);
      const [r, c] = parseKey(base.get(p.uid)), [dr, dc] = rotateOffset(0, 1, dir);
      if (![...base.values()].includes(tileKey(r + dr, c + dc))) break;
    }
  }
  const run = (gen) => { let x; for (;;) { x = gen.next(); if (x.done) return x.value; } };
  // what the sim devours (bonds/core.js devour): the holder's four neighbours, the others' front tile, through members
  const devoured = (plan) => {
    const at = new Map([...plan].map(([uid, key]) => [key, uid]));
    const isMember = (uid) => pieces.find((p) => p.uid === uid) !== food;
    const out = new Set();
    for (const p of [holder, ...members]) {
      const seen = new Set([p.uid]);
      const queue = [p.uid];
      while (queue.length) {
        const x = queue.shift();
        const [r, c] = parseKey(plan.get(x));
        const offs = x === holder.uid ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [rotateOffset(0, 1, plan.dirs.get(x) ?? 'RIGHT')];
        for (const [dr, dc] of offs) {
          const q = at.get(tileKey(r + dr, c + dc));
          if (q == null || seen.has(q)) continue;
          seen.add(q); out.add(q);
          if (isMember(q)) queue.push(q);
        }
      }
    }
    return out;
  };
  assert.ok(devoured(base).has(food.uid), 'the base plan feeds the food to the holder');
  const plan = run(positionPlanSteps(m, ps, pieces, base, { focus: 'egirShip' })) ?? base;
  console.log(JSON.stringify({ version, food: m.gd.chess(food.id).name, base: [base.get(holder.uid), base.get(food.uid)], plan: [plan.get(holder.uid), plan.get(food.uid)] }));
  assert.ok(!devoured(plan).has(food.uid), 'the plan feeds the food to no member');
} finally { h.dispose?.(); }
