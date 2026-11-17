// test/sim/feedback5-cb4-pins.test.js — community reports of 2026-10-06 that this tree already answers, pinned (DESIGN
// §25.18; they pass on the parent commit — nothing changed for them):
//   item 6 「每局游戏开始展示的敌人类型（折射、飞行等等），实际出现波次在7到9波，而且每个最多三波，其余波次用特异类型填充」 — the
//     official type schedule (client RandomEnemyGenerater, research 08 §2.1; act2autochess specialEnemyRandomTypeDict count 3,
//     constData maxLevelCnt 15 / specialEnemyNum 3 / enemyTypeIdentifierToFillRandom 1): each briefing type owns 3 of the
//     15 round slots, SPECIAL (特异) the other 6, shuffled — R14 (leader) and R15 (hidden core) take slots too, so the 13
//     normal rounds hold 7–9 type waves, at most 3 per type;
//   item 35 「鸭爵策略的悬赏现在有时候会一波出现多只，比如多只鸭子」 — PRTS 下半/PRTS盟约记录 鸭爵 备注 「每回合将有0~2名敌人被
//     替换为上述敌人之一」: each round's wave gets 0–2 swaps, one draw for every player (bands/meta.js duckPicks, GitHub #839), each one of the four at random, so
//     two ducks in one wave is official (≈ 1 wave in 12 here); never more than 2 per player's wave;
//   item 29 「会移动的关底boss在各个地图的移动路线复核下是否正确」 — the only leaders that walk are 铳 and 卢西恩 (the 巨型单位 are
//     自缚: content/bosses.js SELF_BOUND); their official PATROL_MOVE checkpoints (level_act1autochess_h07_02 route 6,
//     act2 h07_05: (3,9) → (2,3) → (5,9), looped) are walked on every boss field of the season over walkable tiles only,
//     the pair's mirrored copy on the right half ((3,11) → (2,17) → (5,11)), and the loop never runs on to the goal;
//   item 38 「干员野鬃放在红门前两格的时候有概率会把怪顶出地图显示漏怪」 — not reproduced: her pushes (Battle.push → displace)
//     stop at the rect and at tiles a ground enemy cannot walk, so no pushed enemy stands off the map;
//   item 39 「锏能拉动10重的关底boss」 — not reproduced: a leader (tag boss) is never displaced (Battle._displaceable), and
//     her pulls (力度 1 / 2) move no weight ≥ 5 enemy (受力等级 ≤ −3, PRTS 推与拉);
//   item 47 「昆图斯占地少最左边和最右边两排」 — not reproduced: its hit area is PRTS' 4.95 × 2.95 up 1.0 — 5 × 3 tiles — and an
//     operator whose range reaches only its leftmost column hits it;
//   item 52 「最终boss跟原版相比攻击欲望感觉低了」 — every leader attacks at its data interval while a target is in range;
//   item 57 「囚犯敌人的解放状态联防时不应继承」 — a leaked prisoner re-enters 联防 as a new spawn (unite.js planUnite →
//     waves.js buildUniteWave: its key and spawn mods only), confined again (archetypes.js prisoner spawn); the freed look
//     the report saw was 普通 / 老练囚犯's red clip set drawn from the gate, fixed with the prisoners' forms (§25.14.1).
// Run: node --test test/sim/feedback5-cb4-pins.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves, buildUniteWave, buildBossWave, buildNormalWave } from '../../server/match/waves.js';
import { bodyKeys } from '../../server/sim/body.js';
import { planUnite } from '../../server/match/unite.js';
import { createRng } from '../../server/sim/rng.js';
import { DATA, makeMatch } from '../match/harness.js';

test('item 6: the three briefing types fill 7–9 of the 13 normal waves (险境 / 绝境 / 终极), at most 3 each; the rest are SPECIAL', () => {
  for (const modeId of ['mode_multi_normal', 'mode_single_hard', 'mode_multi_abyss']) {
    const gd = new GameData(DATA, modeId);
    assert.equal(gd.bossRound, 14);
    const totals = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const s = setupMatchWaves(gd, createRng(seed));
      const normal = s.typeSlots.slice(0, gd.bossRound - 1);
      const per = s.factions.map((f) => normal.filter((t) => t === f).length);
      for (const n of per) assert.ok(n >= 1 && n <= 3, `${modeId} seed ${seed}: ${per}`);
      const total = per.reduce((a, b) => a + b, 0);
      assert.ok(total >= 7 && total <= 9, `${modeId} seed ${seed}: ${total}`);
      assert.equal(normal.filter((t) => t === 'SPECIAL').length, normal.length - total, 'every other wave is SPECIAL');
      totals.add(total);
    }
    assert.deepEqual([...totals].sort(), [7, 8, 9], `${modeId}: all three totals occur`);
  }
});

test('item 57: a prisoner freed in its own combat leaks and re-enters 联防 confined (no freed form, the confinement buff, freed only by its own attacks there)', () => {
  const KEY = 'enemy_1116_liprr'; // 普通囚犯
  const wall = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e9, def: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  const kits = { t_wall: () => ({ trait: { noAttack: true } }) };
  const h = makeBattle({ autoFinish: false, timeLimit: 120, defs: { chess: { t_wall: wall } }, kits, units: [{ chessId: 't_wall', row: 9, col: 6 }], enemies: [{ key: KEY, route: 0 }] });
  assert.ok(h.runUntil(() => h.enemy(KEY) && h.enemy(KEY).form === 'liberty', 60), 'freed by its own attacks');
  const p = h.enemy(KEY);
  assert.ok(p.findBuff('ab:liberty') && !p.findBuff('ab:confined'));
  h.b.retreat(h.unit('t_wall'));
  assert.ok(h.runUntil(() => !p.alive, 60), 'it walks on and leaks');
  const r = h.result().perPlayer.p1;
  assert.deepEqual(r.leaked.filter((l) => l.counted !== false).map((l) => l.enemyKey), [KEY]);
  checkInvariants(h.b);
  // 联防: the leaker's counted leak re-enters on the escaped template of one helper
  const gd = new GameData(DATA, 'mode_multi_normal');
  const seat = (id, s) => ({ playerId: id, seat: s, deployCount: 1, bonds: {}, layers: {}, board: new Map(), bounties: [] });
  const m = { isSolo: false, alivePlayers: () => [seat('p1', 1), seat('H', 0)], gd: { unite: { maxHelpers: 2 }, enemy: (k) => gd.enemy(k) } };
  const plan = planUnite(m, new Map([['p1', r], ['H', { perfect: true, leaked: [], unitsEnd: [] }]]));
  assert.deepEqual(plan.leaked.map((l) => l.enemyKey), [KEY]);
  assert.deepEqual(Object.keys(plan.leaked[0]).sort(), ['bounty', 'enemyKey', 'lpr', 'mods', 'sourcePlayerId', 'tag'], 'nothing of its state travels');
  const wave = buildUniteWave(gd, plan.leaked, 1, 60);
  const u = makeBattle({
    kind: 'unite', stageId: 'act1autochess_escaped_single', autoFinish: false, timeLimit: 60, routes: wave.routes,
    defs: { chess: { t_wall: wall } }, kits, units: [{ chessId: 't_wall', row: 9, col: 8 }],
    enemies: wave.spawns.map((s) => ({ key: s.enemyKey, time: s.time, route: s.routeIndex, mods: s.mods, sourcePlayerId: s.sourcePlayerId })),
  });
  assert.ok(u.runUntil(() => u.enemy(KEY), 30), 're-entered');
  const q = u.enemy(KEY);
  assert.equal(q.form ?? null, null, 'drawn confined');
  assert.ok(q.findBuff('ab:confined') && !q.findBuff('ab:liberty'), 'confined again');
  assert.ok(u.runUntil(() => q.stats.attacks >= 1, 40), 'blocked, it attacks');
  assert.equal(q.form ?? null, null, 'still confined after its first 联防 attack');
  assert.ok(u.runUntil(() => q.form === 'liberty', 60), 'freed again only by its own attacks there');
  assert.equal(q.stats.attacks, 4, 'at its 4th attack in 联防 (confinement.times), as in a fresh spawn');
  checkInvariants(u.b);
});

test('item 35: the 鸭爵 strategy swaps 0–2 enemies of each player\'s wave, each one of its four at random (two ducks in one wave included), never more', () => {
  const hist = [0, 0, 0];
  let twoSame = 0;
  for (const seed of [31, 32]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed, fake: true }).start();
    h.toPrep(6, { band: 'band_ducklord' });
    const seed0 = h.m.seed;
    for (const ps of h.m.alivePlayers()) {
      for (let k = 0; k < 40; k++) {
        h.m.seed = seed0 + k; // one draw per round from the match seed (GitHub #839): another seed, another draw
        const ducks = h.m._normalOpts(ps).spawns.filter((x) => x.tag === 'duck');
        assert.ok(ducks.length <= 2, `${ducks.length} swaps in one wave`);
        hist[ducks.length]++;
        if (ducks.length === 2 && ducks[0].enemyKey === ducks[1].enemyKey) twoSame++;
        for (const d of ducks) assert.deepEqual(d.bounty, { coins: 1, ownerPlayerId: ps.playerId });
      }
    }
    h.m.dispose();
  }
  assert.ok(hist.every((n) => n > 0), `0, 1 and 2 swaps all occur: ${hist}`);
  assert.ok(twoSame > 0, 'two of the same kind (e.g. two ducks) in one wave occurs');
});

const BIG_POOL = () => ({ hp: 1e12, maxHp: 1e12, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } });
const PAIR = [{ playerId: 'p1', seat: 0, side: 'L', units: [], bonds: {} }, { playerId: 'p2', seat: 1, side: 'R', units: [], bonds: {} }];
/** A leader field of the real template (the match passes waveId: content/bosses.js templateOf). */
function leaderField(bossId, { solo = true, stageId = 'act1autochess_m01', round = 14, mode = 'mode_multi_hard', units = undefined, players = undefined, timeLimit = 600 } = {}) {
  const gd = new GameData(DATA, mode);
  const bw = buildBossWave(gd, createRng(5), setupMatchWaves(gd, createRng(1)).factions, round, { bossId, solo });
  const L = bw.spawns.find((x) => x.tag === 'boss');
  return makeBattle({
    kind: round === 15 ? 'hidden' : 'boss', stageId, seed: 3, routes: bw.routes, sharedBoss: BIG_POOL(), autoFinish: false, timeLimit, units,
    players: players ?? (solo ? undefined : PAIR), enemies: [{ key: L.enemyKey, time: L.time, route: L.routeIndex, mods: L.mods, tag: 'boss' }],
    setup(b) { b.opts.waveId = bw.templateId; },
  });
}

test('item 29: 铳 patrols (3,9) → (2,3) → (5,9) on every boss field over walkable tiles (the pair\'s copy the mirrored points); 卢西恩 loops without reaching the goal', () => {
  const stages = Object.keys(DATA.stages).filter((id) => DATA.stages[id].active !== false && DATA.stages[id].weight > 0);
  assert.equal(stages.length, 8);
  for (const stageId of stages) {
    for (const solo of [true, false]) {
      const h = leaderField('boss_2', { solo, stageId });
      const seen = new Map();
      for (let t = 0; t < 240 * 30; t++) {
        h.b.step();
        for (const e of h.b.enemies) {
          if (!e.alive || !e.isBoss) continue;
          const r = Math.round(e.y), c = Math.round(e.x);
          assert.ok(h.b.grid.walkable(r, c, true), `${stageId} ${solo ? 'solo' : 'pair'}: off the road at (${r},${c})`);
          // the patrol targets in the order it walks them (the leg it is on)
          const l = seen.get(e.id) ?? []; seen.set(e.id, l);
          const leg = e.route.legs[e.route.legIdx];
          const k = leg && leg.r != null ? `${leg.r},${leg.c}` : '-';
          if (l[l.length - 1] !== k) l.push(k);
        }
      }
      const tracks = [...seen.values()].map((l) => l.join(' '));
      assert.equal(tracks.length, solo ? 1 : 2, stageId);
      assert.ok(tracks.some((x) => x.startsWith('3,9 2,3 5,9 3,9')), `${stageId}: ${tracks}`);
      if (!solo) assert.ok(tracks.some((x) => x.startsWith('3,11 2,17 5,11 3,11')), `${stageId}: the mirrored copy ${tracks}`);
      checkInvariants(h.b);
    }
  }
  const h = leaderField('boss_5');
  const leaks = [];
  h.b.on('enemyLeak', ({ enemy }) => leaks.push(enemy.defId));
  let wrapped = false;
  for (let t = 0; t < 420 * 30; t++) { h.b.step(); const e = h.b.enemies.find((x) => x.alive && x.isBoss); if (e && e.route.legIdx === 0 && h.b.time > 300) wrapped = true; }
  assert.ok(wrapped, '卢西恩 starts its patrol again after its 19 checkpoints');
  assert.deepEqual(leaks, []);
});

test('item 38: 野鬃\'s pushes towards the red gate never leave a ground enemy off the map (real waves, S2 running)', () => {
  const gd = new GameData(DATA, 'mode_single_hard');
  const setup = setupMatchWaves(gd, createRng(2));
  let pushes = 0;
  for (const r of [6, 12]) {
    const w = buildNormalWave(gd, createRng(200 + r), setup.factions, r);
    for (const [row, col] of [[9, 8], [12, 8], [12, 9]]) {
      const h = makeBattle({ stageId: 'act1autochess_m01', seed: 2, routes: w.routes, timeLimit: w.timeLimit, units: [{ chessId: 'chess_char_1_19_b', row, col, dir: 'RIGHT' }],
        enemies: w.spawns.map((x) => ({ key: x.enemyKey, time: x.time, route: x.routeIndex, count: x.count, interval: x.interval, mods: x.mods })) });
      const u = h.unit('chess_char_1_19_b');
      h.step();
      h.b.on('tick', () => {
        if (u.alive && u.skill && !u.skill.active) u.skill.gainSp(999, 'test');
        for (const e of h.b.enemies) {
          if (!e.alive || e.hidden || e.isFlying) continue;
          assert.ok(h.b.grid.walkable(Math.round(e.y), Math.round(e.x), true), `R${r} (${row},${col}): ${e.defId} off the map at (${e.y.toFixed(2)},${e.x.toFixed(2)})`);
        }
      }, { priority: -1000 });
      const orig = h.b.push.bind(h.b);
      h.b.push = (...a) => { const m = orig(...a); if (m > 0) pushes++; return m; };
      h.runToEnd(200);
      assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
      checkInvariants(h.b);
    }
  }
  assert.ok(pushes >= 60, `she pushed (${pushes} pushes)`);
});

test('item 39: 锏\'s S3 never moves a leader (every leader of the season), nor any weight-10 enemy', () => {
  for (const bossId of ['boss_1', 'boss_4', 'boss_6', 'boss_7']) {
    const h = leaderField(bossId, { units: [{ chessId: 'chess_char_6_19_b', row: 9, col: 7, skillIndex: 3 }] });
    h.step();
    const u = h.unit('chess_char_6_19_b');
    const boss = h.b.enemies.find((e) => e.isBoss);
    boss.mods = { ...(boss.mods || {}), speedMul: 0 };
    boss.markDirty?.();
    const at = [boss.x, boss.y];
    let moved = 0;
    const orig = h.b.displace.bind(h.b);
    h.b.displace = (e, ...a) => { const m = orig(e, ...a); if (e === boss) moved += m; return m; };
    for (let t = 0; t < 40 * 30; t++) { h.b.step(); if (u.alive && u.skill && !u.skill.active) u.skill.gainSp(999, 'test'); }
    assert.ok(u.skill.activations >= 3, `${bossId}: S3 cast`);
    assert.equal(boss.s.massLevel, 10);
    assert.equal(moved, 0, `${bossId}: never displaced`);
    assert.deepEqual([boss.x, boss.y], at);
  }
  // a weight-10 enemy that is no leader (自在 as a bounty): 力度 2 − 10 ⇒ no pull
  const h = makeBattle({ autoFinish: false, timeLimit: 30, units: [{ chessId: 'chess_char_6_19_b', row: 10, col: 6 }], enemies: [{ key: 'enemy_1517_xi', pos: [10, 8], mods: { speedMul: 0 } }] });
  h.step();
  const xi = h.enemy('enemy_1517_xi');
  assert.equal(xi.s.massLevel, 10);
  assert.equal(h.b.pull(xi, 2, { to: { x: 6, y: 10 } }), 0);
  assert.equal(h.b.pull(xi, 5, { to: { x: 6, y: 10 } }), 0, 'not even 特大力');
});

test('item 47: 昆图斯 occupies 5 × 3 tiles (PRTS 4.95 × 2.95, up 1.0); an operator reaching only its leftmost column hits it', () => {
  const h = makeBattle({ kind: 'boss', stageId: 'flat', sharedBoss: BIG_POOL(), autoFinish: false, timeLimit: 30,
    units: [{ chessId: 'chess_char_1_12_a', row: 10, col: 7 }], enemies: [{ key: 'enemy_1521_dslily', pos: [3, 10], mods: { speedMul: 0 }, tag: 'boss' }] });
  h.step();
  const boss = h.b.enemies.find((e) => e.isBoss);
  const tiles = bodyKeys(boss).map((k) => [Math.floor(k / 21), k % 21]);
  assert.deepEqual([...new Set(tiles.map((t) => t[1]))], [8, 9, 10, 11, 12], '5 columns');
  assert.deepEqual([...new Set(tiles.map((t) => t[0]))], [3, 4, 5], '3 rows (up 1.0)');
  const u = h.unit('chess_char_1_12_a');
  assert.deepEqual([u.tileR, u.tileC], [3, 7]);
  h.run(8);
  assert.ok(u.stats.attacks >= 3, `艾丝黛尔 next to its leftmost column attacks it (${u.stats.attacks})`);
});

test('item 52: each leader attacks at its data interval while it has a target (150 s, walls in range)', () => {
  const units = [[9, 3], [10, 4], [11, 5], [12, 6], [9, 8], [10, 9], [12, 9], [11, 8]].map(([row, col], i) => ({ chessId: `t_w${i}`, row, col }));
  const chess = {}, kits = {};
  units.forEach((x) => { chess[x.chessId] = chessRec({ id: x.chessId, profession: 'TANK', stats: { atk: 1, maxHp: 1e9, def: 300, res: 30, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null }); kits[x.chessId] = () => ({ trait: { noAttack: true } }); });
  for (const bossId of ['boss_1', 'boss_4', 'boss_6', 'boss_7']) {
    const gd = new GameData(DATA, 'mode_multi_hard');
    const bw = buildBossWave(gd, createRng(5), setupMatchWaves(gd, createRng(1)).factions, 14, { bossId, solo: true });
    const L = bw.spawns.find((x) => x.tag === 'boss');
    const h = makeBattle({ kind: 'boss', stageId: 'act1autochess_m01', seed: 3, routes: bw.routes, sharedBoss: BIG_POOL(), autoFinish: false, timeLimit: 160,
      defs: { chess }, kits, units, enemies: [{ key: L.enemyKey, time: L.time, route: L.routeIndex, mods: L.mods, tag: 'boss' }], setup(b) { b.opts.waveId = bw.templateId; } });
    h.run(150);
    const boss = h.b.enemies.find((e) => e.isBoss);
    const max = Math.floor(150 / boss.s.interval);
    // an attack-class skill takes an attack's turn (昆图斯's 崩坍 / 大潮, §35.19): it counts as one of the attacks here
    const slots = (boss.mem.ab ? boss.mem.ab.list : []).filter((a) => a && a.atk).reduce((n, a) => n + (a.casts ?? 0), 0);
    const turns = boss.stats.attacks + slots;
    assert.ok(turns >= max - 1, `${bossId} ${L.enemyKey}: ${boss.stats.attacks} attacks + ${slots} attack-class casts, ${max} at its ${boss.s.interval} s interval`);
    if (bossId === 'boss_4') assert.ok(slots > 0, 'boss_4: 崩坍 / 大潮 took attack turns');
  }
});

