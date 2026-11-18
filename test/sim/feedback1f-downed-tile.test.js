// Player report F5 after the 0.1.0 release: "突袭盟约的干员会移动到濒死干员的尸体上" — a 突袭 member jumping
// ("保留技力立即再部署至一名地面敌人周围") landed on the tile of a knocked-out (濒死) operator lying there, and an
// operator's timed redeploy came back on its home tile although another operator lay knocked out on it.
// Official (PRTS 卫戍协议/帮助 §作战阶段 单位部署):
//   "干员退场后，将返回隐藏的待部署区，并原地留下一个“倒地干员”以供查看信息，满足再部署条件时，移除场上的该倒地干员并
//    自动部署至该位置。"
//   "倒地干员所在地块视为可部署，但所有我方单位在此处的部署行为将被阻止。"
//   "若干员被击倒的位置为其他干员或召唤物的初始位置，则在被击倒后，尝试返回其自身的初始位置。"
// So a knocked-out operator lies where it fell (on its own home tile when it fell on another board piece's home and its
// own is free), comes back on that tile, and no ally deployment (a 突袭 landing, a redeploy, a summon, a device, a
// move) takes it meanwhile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { makeMatch } from '../match/harness.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { inRange } from '../../server/sim/content/support/index.js';

const RAID = { raidShip: { count: 2, active: true, tier: 1, layers: 0 } };
const raider = (id) => chessRec({ id, bonds: ['raidShip'], profession: 'WARRIOR', skill: null });
const plain = (id) => chessRec({ id, bonds: [], profession: 'WARRIOR', skill: null });
const tileOf = (u) => [u.tileR, u.tileC];
const kill = (b, u) => b.dealDamage(null, u, { amount: 1e9, type: 'true' });
/** The b.snap `down` entry of `u` ([id, respawnAt, respawnTime, state, row, col]) or null. */
const downEntry = (b, u) => (b.snapshot().down || []).find((d) => d[0] === u.id) ?? null;
/** Where the client draws the knocked-out `u`: the tile its `down` entry names (a 4-element entry: where it fell). */
const bodyOf = (b, u) => { const d = downEntry(b, u); return d && d.length >= 6 ? d.slice(4) : tileOf(u); };

// ---------------------------------------------------------------------------------------------------------------------
// the player scenario on the real product path

/**
 * The normal field of a solo player at PREP of `round` (seed `seed`, stage `stageId`) with exactly `pieces`
 * ([chessId, row, col]) on the board: the real Match, PlayerState, chess data and round wave, built like
 * Match._ccField (the BattleSpec the browser and the server both build their Battle from).
 */
function realField({ pieces, round, seed, stageId }) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed }).start();
  const ps = h.ps('p_0');
  assert.ok(h.drive(() => { if (ps.lp > 0 && ps.lp < 300) ps.lp = 300; return h.m.phase === 'PREP' && h.m.round === round; }), `PREP R${round}`);
  h.setStage(stageId);
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  for (const [id, r, c] of pieces) ps.board.set(`${r},${c}`, ps.newPiece('chess', id));
  ps.recompute();
  const spec = buildBattleSpec({ ...h.m._normalOpts(ps), battleId: 'feedback1f', fieldId: 'n:p_0', kind: 'normal', content: h.m.battleContent });
  return createBattleFromSpec(spec, h.m.ds, { quiet: true, recordEvents: false });
}

// Six 突袭 members (宴 休谟斯 斯卡蒂 瑕光 伊内丝 缄默德克萨斯 史尔特尔 仇白 耀骑士临光 — real chess) on 战场#07 / 战场#08 (下半)
// against the real round waves: on 0.1.0 each run put a member on a knocked-out operator — a 突袭 landing on the body
// of a member that fell after its own jump, or a member's timed redeploy on its home tile where a teammate lay that
// had jumped there and fallen.
const RUNS = [
  { stageId: 'act2autochess_m03', round: 12, seed: 4, pieces: [['chess_char_4_04_a', 12, 2], ['chess_char_4_16_a', 10, 2], ['chess_char_5_07_a', 12, 5], ['chess_char_6_15_a', 10, 5], ['chess_char_6_17_a', 9, 4], ['chess_char_1_18_a', 11, 6]] },
  { stageId: 'act2autochess_m04', round: 6, seed: 3, pieces: [['chess_char_3_12_a', 12, 3], ['chess_char_4_04_a', 11, 3], ['chess_char_4_16_a', 10, 3], ['chess_char_5_07_a', 9, 3], ['chess_char_6_15_a', 12, 4], ['chess_char_6_17_a', 11, 4]] },
  { stageId: 'act2autochess_m04', round: 12, seed: 1, pieces: [['chess_char_2_09_a', 12, 3], ['chess_char_3_05_a', 11, 3], ['chess_char_3_12_a', 10, 3], ['chess_char_4_04_a', 9, 3], ['chess_char_4_16_a', 12, 4], ['chess_char_5_07_a', 11, 4]] },
  { stageId: 'act2autochess_m04', round: 12, seed: 1, pieces: [['chess_char_2_09_a', 12, 2], ['chess_char_3_05_a', 10, 2], ['chess_char_3_12_a', 12, 5], ['chess_char_4_04_a', 10, 5], ['chess_char_4_16_a', 9, 4], ['chess_char_5_07_a', 11, 6]] },
  { stageId: 'act2autochess_m04', round: 12, seed: 4, pieces: [['chess_char_4_04_a', 12, 3], ['chess_char_4_16_a', 11, 3], ['chess_char_5_07_a', 10, 3], ['chess_char_6_15_a', 9, 3], ['chess_char_6_17_a', 12, 4], ['chess_char_1_18_a', 11, 4]] },
];

test('F5 real match: no 突袭 landing, redeploy or summon ever takes the tile of a knocked-out operator; it comes back where it lies', () => {
  let jumps = 0, downs = 0, comebacks = 0;
  const bad = [];
  for (const run of RUNS) {
    const b = realField(run);
    const tag = `${run.stageId} R${run.round} seed ${run.seed}`;
    const lay = new Map(); // knocked-out operator → the tile it lies on
    b.on('death', (c) => {
      const u = c.unit;
      if (c.reason !== 'killed' || u.kind !== 'op' || !b.isDown(u)) return;
      downs++;
      const body = bodyOf(b, u);
      lay.set(u, body);
      // it lies where it fell — on its own home when it fell on another board piece's home and its own is free
      const other = b.allyUnits.find((a) => a !== u && a.uid != null && !a.removed && a.homeR === u.tileR && a.homeC === u.tileC);
      const homeFree = !b.allyUnits.some((a) => a !== u && ((a.alive && a.tileR === u.homeR && a.tileC === u.homeC) || (!a.alive && !a.removed && b.restTile(a).join() === `${u.homeR},${u.homeC}`)));
      if (other && (u.tileR !== u.homeR || u.tileC !== u.homeC) && homeFree && body.join() !== `${u.homeR},${u.homeC}`) bad.push(`${tag} t=${b.time.toFixed(1)}: ${u.name} lies on ${other.name}'s home ${body} (its own ${u.homeR},${u.homeC} is free)`);
      else if (!other && body.join() !== tileOf(u).join()) bad.push(`${tag} t=${b.time.toFixed(1)}: ${u.name} fell on ${tileOf(u)} but lies on ${body}`);
    });
    b.on('deploy', (c) => {
      const u = c.unit;
      if (c.initial || u.side !== 'ally') return;
      if (u.kind === 'op' && (u.tileR !== u.homeR || u.tileC !== u.homeC) && !lay.has(u)) jumps++;
      for (const [d, t] of lay) {
        if (d === u || d.alive) continue;
        if (t[0] === u.tileR && t[1] === u.tileC) bad.push(`${tag} t=${b.time.toFixed(1)}: ${u.name} deployed on ${t} where ${d.name} lies knocked out`);
      }
      if (lay.has(u)) {
        const t = lay.get(u);
        lay.delete(u);
        comebacks++;
        if (t[0] !== u.tileR || t[1] !== u.tileC) bad.push(`${tag} t=${b.time.toFixed(1)}: ${u.name} lay on ${t} but redeployed on ${tileOf(u)}`);
      }
    });
    while (!b.finished && b.time < 400) b.step();
  }
  assert.deepEqual(bad, []);
  // the scenario: members jumped, fell and came back
  assert.ok(jumps >= 20 && downs >= 10 && comebacks >= 5, `jumps ${jumps}, knocked out ${downs}, redeploys ${comebacks}`);
});

// ---------------------------------------------------------------------------------------------------------------------
// the rule, step by step (synthetic chess, flat stage)

test('F5 突袭: a member never lands on a knocked-out member\'s body; the fallen member comes back on the tile it lies on', () => {
  const defs = {
    chess: { r_a: raider('r_a'), r_b: raider('r_b') },
    enemies: { enemy_f5_dummy: enemyRec({ key: 'enemy_f5_dummy', hp: 1e7, speed: 0 }), enemy_f5_bait: enemyRec({ key: 'enemy_f5_bait', hp: 2500, speed: 0 }) },
  };
  // A idles from the start; B kills the bait in front of it first (~5 s), so it becomes idle later than A
  const h = makeBattle({
    defs, bonds: RAID, units: [{ chessId: 'r_a', row: 12, col: 3 }, { chessId: 'r_b', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_f5_dummy', pos: [9, 8] }, { key: 'enemy_f5_bait', pos: [10, 4] }],
  });
  const A = h.unit('r_a'), B = h.unit('r_b');
  assert.ok(h.runUntil(() => A.tileR !== 12 || A.tileC !== 3, 12), 'A jumped');
  const L = tileOf(A);
  assert.deepEqual([B.tileR, B.tileC], [10, 3], 'B still busy / idle at home');
  kill(h.b, A);
  assert.ok(h.b.isDown(A), 'A knocked out');
  assert.deepEqual(downEntry(h.b, A).slice(4), L, 'A lies where it fell: b.snap down carries that tile');
  assert.equal(h.b.isReservedTile(L[0], L[1]), true, 'its tile is reserved for it');
  assert.equal(h.b.isReservedTile(12, 3), false, 'its home is not (only the body\'s tile blocks)');
  assert.ok(h.runUntil(() => B.tileR !== 10 || B.tileC !== 3, 20), 'B jumped');
  assert.notDeepEqual(tileOf(B), L, 'B did not land on A\'s body');
  assert.ok(inRange(B, h.enemy('enemy_f5_dummy')), 'B still lands next to the enemy, with it in range');
  // "满足再部署条件时，移除场上的该倒地干员并自动部署至该位置"
  assert.ok(h.runUntil(() => A.alive, 30), 'A redeployed after its timer');
  assert.deepEqual(tileOf(A), L, 'on the tile it lay on');
  assert.deepEqual([A.homeR, A.homeC], [12, 3], 'its home (the board tile) is unchanged');
  checkInvariants(h.b);
});

test('F5 engine: every ally placement refuses the tile a knocked-out operator lies on — redeploy, summon, device, move', () => {
  const defs = { chess: { d_a: plain('d_a'), d_b: plain('d_b'), d_c: plain('d_c') } };
  const h = makeBattle({ defs, units: [{ chessId: 'd_a', row: 12, col: 3 }, { chessId: 'd_b', row: 10, col: 3 }, { chessId: 'd_c', row: 11, col: 5 }] });
  h.step();
  const b = h.b, A = h.unit('d_a'), B = h.unit('d_b'), C = h.unit('d_c');
  // A moved away like a 突袭 jump, then knocked out there
  b.retreat(A, { reason: 'raid' });
  assert.ok(b.redeploy(A, { free: true, tile: [9, 8] }));
  kill(b, A);
  assert.ok(b.isDown(A));
  assert.deepEqual(tileOf(A), [9, 8]);
  assert.equal(b.isReservedTile(9, 8), true);
  b.retreat(B, { reason: 'raid' });
  assert.equal(b.redeploy(B, { free: true, tile: [9, 8] }), false, 'a redeploy onto the body is refused');
  assert.ok(b.redeploy(B, { free: true }), 'B back home');
  assert.deepEqual(tileOf(B), [10, 3]);
  assert.equal(b.spawnToken('p1', 'token_10028_vigil_wolf', 9, 8), null, 'a summon onto the body is refused');
  assert.equal(b.spawnDevice('f5_device', 9, 8, { hp: 100 }), null, 'a device onto the body is refused');
  assert.equal(b.relocate(C, 9, 8), false, 'moving an operator onto the body is refused');
  assert.deepEqual(tileOf(C), [11, 5]);
  // a tactician at (9,6) whose range holds (9,8) — the nearer tile — and (9,9)
  assert.equal(b.findTacticalPoint({ baseRangeKeys: [9 * 21 + 8, 9 * 21 + 9], tileR: 9, tileC: 6, dir: 'RIGHT' })?.join(), '9,9', 'no tactical point on the body');
  // its own redeploy comes back there ("自动部署至该位置")
  assert.ok(b.redeploy(A, { free: true }));
  assert.deepEqual(tileOf(A), [9, 8]);
  assert.equal(b.isReservedTile(9, 8), true, 'standing there now');
  checkInvariants(b);
});

test('F5 "若干员被击倒的位置为其他干员或召唤物的初始位置…尝试返回其自身的初始位置": a body on another piece\'s home goes back to its own', () => {
  const defs = { chess: { h_a: plain('h_a'), h_b: plain('h_b') } };
  const setup = () => {
    const h = makeBattle({ defs, units: [{ chessId: 'h_a', row: 12, col: 3 }, { chessId: 'h_b', row: 10, col: 3 }] });
    h.step();
    const b = h.b, A = h.unit('h_a'), B = h.unit('h_b');
    b.retreat(A, { reason: 'raid' });
    assert.ok(b.redeploy(A, { free: true, tile: [11, 6] }), 'A away from its home');
    b.retreat(B, { reason: 'raid' });
    assert.ok(b.redeploy(B, { free: true, tile: [12, 3] }), 'B on A\'s home (free: A is away)');
    return { h, b, A, B };
  };
  {
    const { h, b, A, B } = setup();
    let fellAt = null;
    b.on('death', (c) => { if (c.unit === B) fellAt = [B.tileR, B.tileC]; });
    kill(b, B);
    assert.ok(b.isDown(B));
    assert.deepEqual(fellAt, [12, 3], 'the death handlers (被击倒时 effects) still see where it fell');
    assert.deepEqual(downEntry(b, B).slice(4), [10, 3], 'B lies on its own home, not on A\'s (b.snap down)');
    assert.deepEqual(b.restTile(B), [10, 3]);
    assert.equal(b.isReservedTile(12, 3), false, 'A\'s home stays free');
    assert.equal(b.isReservedTile(10, 3), true);
    // A knocked out too: it lies where it is and comes back there
    kill(b, A);
    assert.deepEqual(downEntry(b, A).slice(4), [11, 6], 'A fell on no other piece\'s home: it stays');
    assert.ok(h.runUntil(() => A.alive && B.alive, 40), 'both redeploy');
    assert.deepEqual(tileOf(B), [10, 3]);
    assert.deepEqual(tileOf(A), [11, 6]);
    checkInvariants(b);
  }
  {
    // its own home taken (A moved onto it): the body stays where it fell [ASSUMED: one attempt, at the knock-out]
    const { b, A, B } = setup();
    b.retreat(A, { reason: 'raid' });
    assert.ok(b.redeploy(A, { free: true, tile: [10, 3] }), 'A on B\'s home');
    kill(b, B);
    assert.deepEqual(downEntry(b, B).slice(4), [12, 3], 'B stays on the tile it fell on');
    assert.equal(b.isReservedTile(12, 3), true);
    checkInvariants(b);
  }
});

// Rule 3 for a SUMMON's initial position (QA after the integration): a summon leaves its home free only once it has
// expired or been killed — and the removed summon was not counted, so the clause never applied: a 突袭 member that
// landed on the free tile of 浊心斯卡蒂's 海嗣 and fell there lay on it and kept the 海嗣 (远古血亲: it comes back on its
// tile) off the field. Every board piece's 初始位置 counts now, on the field or not.
// Since 0.2.0 the 海嗣 is a countdown summon — 无敌 + 禁疗 (PRTS 海嗣 备注 「持有禁疗、无敌」; DESIGN §25.16): it only expires,
// no damage kills it. The killed case takes 缪尔赛思's 流形, a board summon that is attacked and killed and also comes back
// on its tile (「其被击败后会在25秒后自动刷新」).
test('F5 rule 3: a body on the home of a summon that has expired or been killed goes back to its own; the summon comes back', () => {
  const CASES = {
    expired: { owner: 'chess_char_6_04_a', tokenId: 'token_10017_skadi2_dedant', name: '海嗣' },
    killed: { owner: 'chess_char_6_11_a', tokenId: 'token_10030_mlyss_wtrman', name: '流形' },
  };
  for (const [how, { owner, tokenId, name }] of Object.entries(CASES)) {
    const h = makeBattle({
      stageId: 'flat', autoFinish: false, timeLimit: 400, bonds: RAID,
      units: [
        { chessId: owner, row: 10, col: 3, uid: 1 },
        { kind: 'token', tokenId, row: 10, col: 5, uid: 2, ownerUid: 1 },
        { chessId: 'chess_char_1_18_a', row: 12, col: 3, uid: 3 },
      ],
    });
    h.step();
    const b = h.b;
    const sum = b.allyUnits.find((u) => u.kind === 'token' && u.uid === 2);
    const yan = h.unit(3);
    // round 83 (§37.244): her S3 drain can knock her out now, and a 海嗣 comes back only while she stands — keep her skill off
    if (how === 'expired') b.addBuff(h.unit(1), { key: 'test:silence', duration: 999, flags: { silence: true } });
    assert.ok(sum.alive && sum.tileR === 10 && sum.tileC === 5, `the ${name} on its placed tile`);
    if (how === 'killed') kill(b, sum);
    else h.runUntil(() => !sum.alive, 120);
    assert.ok(!sum.alive && sum.removed, `${how}: the ${name} is gone`);
    assert.equal(b.isReservedTile(10, 5), false, 'its home is free for an automatic placement');
    b.retreat(yan, { reason: 'raid' });                 // the 突袭 landing (raidRedeploy: retreat + redeploy on a free tile)
    assert.ok(b.redeploy(yan, { free: true, tile: [10, 5], keepSp: true }), `${how}: 宴 lands on the ${name}'s home`);
    kill(b, yan);
    assert.deepEqual(b.restTile(yan), [12, 3], `${how}: 宴 lies on her own home, not on the ${name}'s`);
    assert.deepEqual(bodyOf(b, yan), [12, 3], 'the client draws her there');
    assert.equal(b.isReservedTile(10, 5), false, `the ${name}'s home stays free`);
    const back = () => b.allyUnits.find((u) => u.kind === 'token' && u.alive && u.defId === tokenId) ?? null;
    assert.ok(h.runUntil(() => back() != null, 60), `${how}: the ${name} comes back`);
    assert.deepEqual(tileOf(back()), [10, 5], 'on its own tile');
    checkInvariants(b);
  }
});

test('F5 safeguard: the `down` state reports WAIT_TILE whenever _checkRedeploys holds a body back — a living unit or another body on its tile', async () => {
  const { DOWN_STATE } = await import('../../server/sim/constants.js');
  const op = (id) => chessRec({ id, profession: 'WARRIOR', stats: { atk: 0, maxHp: 1000, def: 0, blockCnt: 0, cost: 1, respawnTime: 2 }, skill: null });
  const h = makeBattle({
    defs: { chess: { s_a: op('s_a'), s_b: op('s_b') } }, units: [{ chessId: 's_a', row: 9, col: 5 }, { chessId: 's_b', row: 10, col: 5 }],
    content: 'none', autoFinish: false, timeLimit: 120, flags: { dpInit: 50, dpPerSec: 1, dpMax: 99 },
  });
  h.step();
  const b = h.b, A = h.unit('s_a'), B = h.unit('s_b');
  kill(b, A);
  kill(b, B);
  // unreachable through the engine (no ally deploys on a body tile; _layBody checks isReservedTile): force two bodies
  // onto one tile to check that the client's state and the redeploy check agree
  B.body = [9, 5];
  h.run(3);
  assert.ok(!A.alive && !B.alive, 'neither redeploys onto a tile another body lies on');
  assert.equal(downEntry(b, A)[3], DOWN_STATE.WAIT_TILE, 'A: its tile is taken (not COUNTING with the DP there)');
  assert.equal(downEntry(b, B)[3], DOWN_STATE.WAIT_TILE);
  B.body = [10, 5];
  assert.ok(h.runUntil(() => A.alive && B.alive, 5), 'both redeploy once the tiles are their own');
  assert.deepEqual(tileOf(A), [9, 5]);
  assert.deepEqual(tileOf(B), [10, 5]);
  checkInvariants(b);
});
