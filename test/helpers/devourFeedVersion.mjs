// §37.77 in another version's data (node devourFeedVersion.mjs <version>): the Final Assault gets a feeding candidate, its members'
// devoured ATK in the sim's first tick is what it marks (第一期's 海沟实验体 holder: its four neighbours), and the candidate rates higher.
import assert from 'node:assert/strict';
import { getVersionData, setData } from '../../server/data.js';
import { installOfficialBounds, officialBoundsOf } from '../../shared/plugins/officialBounds.js';

const version = process.argv[2];
if (!version) process.exit(0);
const data = setData(getVersionData(version, { log: { info() {}, warn() {}, error() {} } }));
installOfficialBounds(officialBoundsOf(data));
const { makeMatch, give } = await import('../match/harness.js');
const { devourFeedSteps, positionPlanSteps, createRehearsal, fieldModel, LayoutPlan } = await import('../../server/match/bot.js');
const { rotateOffset } = await import('../../server/sim/dir.js');
const { tileKey, parseKey, legalTiles, placeClass } = await import('../../server/match/board.js');

const TRENCH = 'act1autochess_equip_acarm078_global_buff';
const h = makeMatch({ data, mode: 'solo', difficulty: 'HARD', seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], seed: 3, botRehearsal: 6 }).start().toPrep();
try {
  const m = h.m, ps = m.order[0];
  m.startRound(m.gd.bossRound);
  assert.equal(m.wave, null, 'the Final Assault has no wave');
  ps.hand.fill(null); ps.board.clear(); ps.recompute();
  const chess = Object.values(m.gd.raw.chess).filter((c) => !c.isGolden && c.visible !== false);
  const members = chess.filter((c) => c.bonds.includes('egirShip')).slice(0, 4);
  assert.equal(members.length, 4, 'four 阿戈尔 operators');
  const others = chess.filter((c) => !c.bonds.includes('egirShip')).sort((a, b) => b.stats.atk - a.stats.atk).slice(0, 3);
  const pieces = [...members, ...others].map((c) => give(m, ps, c.chessId, 'hand'));
  // 第一期: the first member holds 海沟实验体
  const trench = Object.entries(m.gd.raw.items).find(([id, it]) => /_a$/.test(id) && (it.buffs || []).some((b) => b?.bbStr?.key === TRENCH));
  if (trench) pieces[0].items = [{ kind: 'item', uid: 9001, id: trench[0] }];
  const legal = (p) => legalTiles(ps.deployMap(), placeClass(ps, ps.gd.chess(p.id))).map(([r, c]) => tileKey(r, c));
  const dist = (a, b) => { const [r, c] = parseKey(a), [x, y] = parseKey(b); return Math.abs(r - x) + Math.abs(c - y); };
  const base = new LayoutPlan();
  const used = [];
  for (const p of pieces) {
    const k = legal(p).find((x) => !used.includes(x) && used.every((u) => dist(u, x) > 1)) ?? legal(p).find((x) => !used.includes(x));
    assert.ok(k, `a tile for ${p.id}`);
    used.push(k); base.set(p.uid, k); base.dirs.set(p.uid, 'RIGHT');
  }
  const ctx = { focus: 'egirShip' };
  const run = (gen) => { let x; for (;;) { x = gen.next(); if (x.done) return x.value; } };
  const [fed] = run(devourFeedSteps(m, ps, pieces, [base], ctx));
  assert.ok(fed, 'a feeding candidate');
  const rate = (plan) => run(positionPlanSteps(m, ps, pieces, plan, ctx, { feed: true, rate: true }));
  assert.ok(rate(fed) > rate(base), 'it rates higher');
  // what the sim hands the members in the candidate's first tick against what they stand next to
  const job = createRehearsal(m, ps, pieces, [base, fed]);
  assert.ok(job, 'two candidates');
  const battle = m.newBattle(job.inputs[1], { preview: true });
  battle.step();
  const at = new Map([...fed].map(([uid, key]) => [key, uid]));
  const isMember = (uid) => members.some((c) => c.chessId === pieces.find((p) => p.uid === uid)?.id);
  const held = (uid) => !!trench && uid === pieces[0].uid;
  const fronts = (uid) => {
    const [r, c] = parseKey(fed.get(uid));
    const offs = held(uid) ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [rotateOffset(0, 1, fed.dirs.get(uid) ?? 'RIGHT')];
    return offs.map(([dr, dc]) => at.get(tileKey(r + dr, c + dc))).filter((q) => q != null);
  };
  let total = 0;
  const order = [...fed.keys()].filter(isMember);
  const simGain = new Map(battle.allyUnits.filter((u) => u.ownerId === ps.playerId).map((u) => [u.uid, u.buffs.find((b) => b.key === 'bond:egir:devour')?.mods?.atkFinal || 0]));
  for (const uid of order) total += simGain.get(uid) || 0;
  assert.ok(total > 0, 'the members gain ATK in the sim');
  // a member's gain comes from what it faces: nothing to mark, nothing gained; 海沟实验体's holder gains its non-member neighbours' ATK
  for (const uid of order) if (simGain.get(uid) > 0) assert.ok(fronts(uid).length > 0, `${uid} has something to mark`);
  if (trench) {
    const atkOf = (uid) => m.gd.chess(pieces.find((p) => p.uid === uid).id).stats.atk;
    const direct = fronts(pieces[0].uid).filter((q) => !isMember(q)).reduce((s, q) => s + atkOf(q), 0);
    assert.ok((simGain.get(pieces[0].uid) || 0) >= direct, 'the holder gains its neighbours');
  }
  // the model knows the holder: a piece beside it (not in front) raises the rating, standing away it does not
  if (trench) {
    const holder = pieces[0], food = pieces[pieces.length - 1];
    const DIRS = ['RIGHT', 'UP', 'DOWN', 'LEFT'];
    const model = fieldModel(m, ps, true).lead;
    const hits = new Set(model ? model.tiles : fieldModel(m, ps).routes.find((x) => !x.fly && x.dwell > 0).tiles);
    const reach = (p, key, dir) => {
      const [r, c] = parseKey(key);
      return (m.gd.chess(p.id).rangeGrid || []).some(([dr, dc]) => { const [a, b] = rotateOffset(dr, dc, dir); return hits.has(tileKey(r + a, c + b)); });
    };
    let spot = null;
    for (const key of legal(holder)) {
      for (const dir of DIRS) {
        if (!reach(holder, key, dir)) continue;
        const [r, c] = parseKey(key), [fr, fc] = rotateOffset(1, 0, dir);
        const side = tileKey(r + fr, c + fc);
        if (!legal(food).includes(side)) continue;
        const foodDir = DIRS.find((d) => !reach(food, side, d));
        const away = legal(food).find((x) => dist(x, key) > 1 && x !== side && DIRS.some((d) => !reach(food, x, d)));
        if (foodDir && away) { spot = { key, dir, side, foodDir, away, awayDir: DIRS.find((d) => !reach(food, away, d)) }; break; }
      }
      if (spot) break;
    }
    assert.ok(spot, 'a tile for the holder and a side neighbour');
    const rest = pieces.filter((p) => p !== holder && p !== food);
    const taken = new Set([spot.key, spot.side, spot.away]);
    const placed = rest.map((p) => {
      const k = legal(p).find((x) => !taken.has(x) && dist(x, spot.key) > 1);
      assert.ok(k, `a free tile for ${p.id}`);
      taken.add(k);
      return [p, k];
    });
    const plan = (foodKey, foodDir) => {
      const q = new LayoutPlan();
      q.set(holder.uid, spot.key); q.dirs.set(holder.uid, spot.dir);
      q.set(food.uid, foodKey); q.dirs.set(food.uid, foodDir);
      for (const [p, k] of placed) { q.set(p.uid, k); q.dirs.set(p.uid, 'LEFT'); }
      return q;
    };
    assert.ok(rate(plan(spot.side, spot.foodDir)) > rate(plan(spot.away, spot.awayDir)), 'the piece beside the holder feeds it');
  }
  console.log(JSON.stringify({ version, trench: !!trench, marked: total }));
} finally { h.dispose?.(); }
