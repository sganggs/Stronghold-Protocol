// Player feedback after 0.1.0, batch 4, workstream WM — D2 "干员野鬃的技能有时会把怪物往攻击方向相反方向推".
//
// Official: 野鬃 S2 夹枪冲锋 "攻击会把目标往攻击方向中等力度地推开" is a 方向力 (PRTS 推与拉: "如果该目标被沿着设定的方向推动，
// 则该力是方向力…常见的推击手特种干员的推力即为此种力"; the 推击手 use the same "往攻击方向…推开" wording). Client data: her
// S2 attack ability (charpack char_496_wildmn, anim Skill_2) carries buff wildmn_s_2[force] of template knockback[dir],
// which buff_template_data defines as Knockback {_useSourceDirection: true, _decreaseForceLevelWhenNotInDirection: 2}:
// a push along her deploy direction, turned radial at 受力等级 −2 when the target is more than 45° off that direction
// or nearer than 0.25 tile ("特殊修正"). The remake pushed her targets radially at
// full force, so an enemy behind her centre — one that walked through her tile while her block was full and that she
// grabbed once a push freed it (the hand-over, DESIGN §19.2), or one coming at her back — was thrown 1.7–2.14 tiles
// the other way, towards the protection objective. The maintainer's 2026-10-19 decision and official recordings
// (#782, DESIGN §35.10) supersede round 40 (§32.14.9): behind targets DO move away radially at reduced force.


import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { PUSH_TILES, PUSH_TILES_EFFECT, PUSH_DIRECTIONAL_MIN_DIST } from '../../server/sim/constants.js';
import { rotateOffset, toLocal } from '../../server/sim/dir.js';
import { Battle } from '../../server/sim/Battle.js';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves, buildNormalWave } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';

const REAL = { skip: !hasGeneratedData() };
const approx = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);
const WILDMN = 'chess_char_1_19_a';
const foe = (key, o = {}) => enemyRec({ key, hp: 1e8, speed: 0, atk: 0, ...o });
const FULL = PUSH_TILES[0]; // 中力 (1) vs weight 1 = 受力等级 0
const WEAK = PUSH_TILES[-2]; // the same push turned radial by the 特殊修正 (受力等级 −2)
const REAR = PUSH_TILES_EFFECT[-2]; // #782 footage: ~0.09 tile; front/side distances retained by task scope

// her tile per facing on the flat stage: room ahead for a full push and behind for a short one
const HOME = { RIGHT: [10, 4], LEFT: [10, 7], UP: [10, 5], DOWN: [11, 5] };

/**
 * 野鬃 (S2 ready) facing `dir`, one static weight-1 enemy at `off` = [dRow, dCol] from her centre in her facing-RIGHT
 * frame. Returns the enemy's displacement by her first skill hit in that frame: { fwd, side, len }.
 */
function wildmnHit(dir, off, { side = 'L', kind = 'normal', mass = 1, chessId = WILDMN } = {}) {
  const [hr, hc] = HOME[dir];
  // the mirrored right half of a boss field: board (r, c) → field (r − 7, 20 − c), RIGHT ↔ LEFT
  const fr = kind === 'boss' ? hr - 7 : hr, fc = side === 'R' ? 20 - hc : hc;
  const fieldDir = side === 'R' ? { RIGHT: 'LEFT', LEFT: 'RIGHT', UP: 'UP', DOWN: 'DOWN' }[dir] : dir;
  const [ar, ac] = rotateOffset(off[0], off[1], fieldDir);
  let before = null, moved = null;
  const h = makeBattle({
    kind, timeLimit: 30, autoFinish: false, hooks: [],
    defs: { enemies: { enemy_t: foe('enemy_t', { mass }) } },
    players: [{ playerId: 'p1', seat: 0, side, colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId, row: hr, col: hc, dir, carryState: { sp: 1e3 } }], bonds: {}, playerEffects: [] }],
    enemies: [{ key: 'enemy_t', pos: [fr + ar, fc + ac] }],
    setup(b) {
      b.on('beforeAttack', (c) => { if (c.attacker.defId === chessId && c.isSkill && c.targets[0]) before = [c.targets[0].y, c.targets[0].x]; }, { priority: -2000 });
      b.on('attack', (c) => { if (c.attacker.defId === chessId && c.isSkill && before && !moved) moved = [c.targets[0].y - before[0], c.targets[0].x - before[1]]; }, { priority: -2000 });
    },
  });
  const u = h.unit(chessId);
  assert.equal(u.dir, fieldDir, 'field direction');
  assert.ok(h.runUntil(() => moved != null, 6), `${side} ${dir} ${off}: a skill hit`);
  assert.equal(u.dir, fieldDir, 'attacking behind never changes gameplay facing');
  checkInvariants(h.b);
  const [lf, ll] = toLocal(moved[0], moved[1], fieldDir); // [left (+row in the RIGHT frame), forward]
  return { fwd: ll, side: lf, len: Math.hypot(lf, ll) };
}

test('D2 野鬃 S2 pushes along her direction ("往攻击方向", the 推击手 wording) — straight ahead the full 中力 distance, every facing', REAL, () => {
  const ds = getDefaultSource();
  assert.match(ds.rawChess(WILDMN).skill.desc, /往攻击方向/, 'data: the directional wording');
  assert.equal(ds.rawChess(WILDMN).skill.bb['attack@force'], 1, 'data: 中等力度 = 1');
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    const m = wildmnHit(dir, [0, 0.7]);
    approx(m.fwd, FULL, 1e-6, `${dir}: forward`);
    approx(m.side, 0, 1e-9, `${dir}: no sideways`);
  }
});

test('D2 野鬃 S2: a target within 45° of her direction goes straight along it (not radially sideways)', REAL, () => {
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    for (const lat of [0.3, -0.3]) {
      const m = wildmnHit(dir, [lat, 0.6]); // 26.6° off, inside her block radius and her range (tile ahead)
      approx(m.fwd, FULL, 1e-6, `${dir} ${lat}: along her direction`);
      approx(m.side, 0, 1e-9, `${dir} ${lat}: no sideways (radial would be ${(FULL * lat / Math.hypot(lat, 0.6)).toFixed(2)})`);
    }
  }
});

test('#782 野鬃 S2: behind targets move away radially at reduced force (maintainer 2026-10-19)', REAL, () => {
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    // Include the back edge of her tile, the case round 40 incorrectly kept along her deployment direction.
    for (const backOff of [-0.45, -0.49]) {
      const back = wildmnHit(dir, [0, backOff]);
      approx(back.len, REAR, 1e-6, `${dir} behind ${backOff}: the −2 distance`);
      approx(back.fwd, -REAR, 1e-6, `${dir} behind ${backOff}: away from her`);
      approx(back.side, 0, 1e-9, `${dir} behind ${backOff}: no lateral offset`);
    }
  }
});

test('#782 野鬃 S2: side targets keep the >45° radial correction in every facing', REAL, () => {
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    // Both lateral directions, including exactly perpendicular (dot = 0, not the rear hemisphere).
    for (const off of [[0.6, 0.3], [-0.6, 0.3], [0.45, 0], [-0.45, 0]]) {
      const beside = wildmnHit(dir, off);
      approx(beside.len, WEAK, 1e-6, `${dir} ${off}: the −2 distance`);
      approx(beside.side, WEAK * off[0] / Math.hypot(...off), 1e-6, `${dir} ${off}: radial sideways`);
      approx(beside.fwd, WEAK * off[1] / Math.hypot(...off), 1e-6, `${dir} ${off}: radial forward`);
    }
  }
});

test('#782 野鬃 S2: near targets keep the <0.25-tile radial correction in every facing', REAL, () => {
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    // nearer than 0.25 tile: radial, −2
    const near = wildmnHit(dir, [0.1, 0.1]);
    assert.ok(Math.hypot(0.1, 0.1) < PUSH_DIRECTIONAL_MIN_DIST);
    approx(near.len, WEAK, 1e-6, `${dir} near: the −2 distance`);
    approx(near.side, near.fwd, 1e-6, `${dir} near: radial`);
  }
});

test('#782 野鬃 S2 on the mirrored right boss half: front, behind, side and near use field facing', REAL, () => {
  for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
    const ahead = wildmnHit(dir, [0, 0.7], { side: 'R', kind: 'boss' });
    approx(ahead.fwd, FULL, 1e-6, `R ${dir}: forward`);
    approx(ahead.side, 0, 1e-9, `R ${dir}: no sideways`);
    const diag = wildmnHit(dir, [0.3, 0.6], { side: 'R', kind: 'boss' });
    approx(diag.fwd, FULL, 1e-6, `R ${dir} diagonal: along its direction`);
    approx(diag.side, 0, 1e-9, `R ${dir} diagonal: no sideways`);
    const back = wildmnHit(dir, [0, -0.45], { side: 'R', kind: 'boss' });
    approx(back.len, REAR, 1e-6, `R ${dir} behind: the −2 distance`);
    approx(back.fwd, -REAR, 1e-6, `R ${dir} behind: away from her`);
    approx(back.side, 0, 1e-9, `R ${dir} behind: no sideways`);
    for (const off of [[0.6, 0.3], [-0.6, 0.3], [0.1, 0.1], [-0.1, -0.1]]) {
      const m = wildmnHit(dir, off, { side: 'R', kind: 'boss' });
      const distance = off[1] < 0 ? REAR : WEAK;
      approx(m.len, distance, 1e-6, `R ${dir} ${off}: reduced distance`);
      approx(m.side, distance * off[0] / Math.hypot(...off), 1e-6, `R ${dir} ${off}: radial sideways`);
      approx(m.fwd, distance * off[1] / Math.hypot(...off), 1e-6, `R ${dir} ${off}: radial forward`);
    }
  }
});

test('#782 野鬃 S2: normal and elite behind hits use force minus weight minus two, including no movement', REAL, () => {
  for (const chessId of [WILDMN, 'chess_char_1_19_b']) {
    for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
      for (const mass of [0, 1, 2, 3, 4]) {
        const off = [0.2, -0.45], m = wildmnHit(dir, off, { chessId, mass });
        const expected = mass >= 2 ? 0 : PUSH_TILES_EFFECT[1 - mass - 2];
        approx(m.len, expected, 1e-6, `${chessId} ${dir} weight ${mass}: reduced distance`);
        approx(m.fwd, expected * off[1] / Math.hypot(...off), 1e-6, 'behind diagonal is radial');
        approx(m.side, expected * off[0] / Math.hypot(...off), 1e-6, 'behind diagonal retains its lateral component');
      }
    }
  }
});

test('#782 野鬃 S2: a forward target at 0.25 tile keeps full force; below it is reduced', REAL, () => {
  for (const distance of [0.249, 0.25, 0.251]) {
    const m = wildmnHit('RIGHT', [0, distance]);
    approx(m.fwd, distance < 0.25 ? WEAK : FULL, 1e-6, `distance ${distance}`);
  }
});

test('#782 野鬃 S2: a coincident target has finite reduced movement along the deployment direction', REAL, () => {
  const m = wildmnHit('RIGHT', [0, 0]);
  approx(m.fwd, WEAK, 1e-6, 'existing zero-vector fallback');
  approx(m.side, 0, 1e-9, 'no arbitrary radial direction at coincidence');
});

// ---------------------------------------------------------------------------------------------------------------------
// The real product path: the act2 m01 lane, the match's own R5 wave (server/match/waves.js), 野鬃 on the melee tiles
// next to the lower lane's last bend. Enemies walk through her tile while she holds one; when a push frees her block
// she grabs the one behind her centre: #782 requires a small radial push away, even towards the objective.

function realRun(chessId, r, c, dir, round = 5) {
  const quiet = { warn() {}, error() {}, info() {}, debug() {} };
  const data = getData({ log: quiet });
  const modeId = 'mode_multi_normal';
  const gd = new GameData(data, modeId);
  const setup = setupMatchWaves(gd, createRng(11 + round));
  const w = buildNormalWave(gd, createRng(11 + round + round), setup.factions, round);
  const b = new Battle({
    seed: 7 + r * 31 + c, kind: 'normal', modeId, round, stageId: 'act2autochess_m01', timeLimit: w.timeLimit || 60,
    routes: w.routes, spawns: w.spawns, enemyOverrides: w.overrides ?? {}, fieldId: 'n:P1', logger: quiet,
    players: [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId, row: r, col: c, dir }] }],
    flags: { layerGainsEnabled: true, dpInit: 10, dpPerSec: 1, dpMax: 99 },
  });
  const u = b.allyUnits.find((x) => x.defId === chessId);
  const pushes = [];
  const orig = b.push.bind(b);
  b.push = (e, force, o = {}) => {
    if (o.from !== u) return orig(e, force, o);
    const x0 = e.x, y0 = e.y, behind = (x0 - u.x) * u.fwd[1] + (y0 - u.y) * u.fwd[0] < 0;
    const moved = orig(e, force, o);
    if (moved > 1e-6) pushes.push({ dx: e.x - x0, dy: e.y - y0, vx: x0 - u.x, vy: y0 - u.y, moved, behind, massLevel: e.s.massLevel });
    return moved;
  };
  for (let n = 0; !b.finished && n < 30 * 120; n++) b.step();
  return { u, pushes };
}

test('#782 real battle (act2 m01, R5 official wave): rear hand-overs push away radially within the −2 distance', REAL, () => {
  let behind = 0, total = 0;
  for (const [r, c] of [[9, 3], [9, 4], [9, 5]]) {
    for (const chessId of ['chess_char_1_19_a', 'chess_char_1_19_b']) {
      const { u, pushes } = realRun(chessId, r, c, 'RIGHT');
      const [fr, fc] = u.fwd;
      for (const p of pushes) {
        total++;
        const along = p.dx * fc + p.dy * fr;
        if (p.behind) {
          behind++;
          assert.ok(along < 0, 'a rear hit moves away, never along deployment facing');
          approx(p.dx * p.vy - p.dy * p.vx, 0, 1e-6, 'rear movement is radial');
          const expected = p.massLevel >= 2 ? 0 : PUSH_TILES_EFFECT[1 - p.massLevel - 2];
          assert.ok(p.moved <= expected + 1e-6, 'rear movement is bounded by its reduced force row');
        }
        // either straight along her direction, or the −2 radial push (受力等级 = 1 − weight − 2)
        if (along < p.moved * (1 - 1e-6)) {
          assert.ok(p.moved <= PUSH_TILES[-1] + 1e-6, `(${r},${c}) ${chessId}: off-direction push of ${p.moved.toFixed(2)} tiles (weight ${p.massLevel})`);
        }
      }
    }
  }
  assert.ok(total > 50, `pushes ${total}`);
  assert.ok(behind > 0, 'the hand-over case happens (an enemy grabbed behind her centre)');
});
