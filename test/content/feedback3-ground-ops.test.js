// test/content/feedback3-ground-ops.test.js — 「地面干员」 is the melee position (地面位), not the tile (0.1.3; community
// report 「不屈盟约效果高台干员也错误的吃到了」). Game data words the deploy class this way (this mode's map card
// 「可以部署高台干员和地面干员的地面」, 「可将高台干员部署于其上」, 「所有地面干员阻挡数+2」); PRTS corrected 琴柳's 地面干员 to
// 地面位干员. The three effects worded 地面干员 — 不屈 (both lines), the 战栗维式重锤 proc and 休谟斯 回收利用 — read
// support isGroundOp = def.position MELEE: 歌蕾蒂娅 on a 高台 counts, a ranged operator on a melee tile does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { isGroundOp } from '../../server/sim/content/support/index.js';

const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const RANGE5 = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
const op = (id, o = {}) => chessRec({
  id, profession: o.profession ?? 'WARRIOR', bonds: o.bonds ?? [], rangeGrid: RANGE5,
  stats: { maxHp: 2000, atk: 500, def: 200, res: 10, aspd: 100, bat: 1, respawnTime: 20, spRecovery: 1, blockCnt: 2 },
  skill: { spCost: 60, duration: 5, initSp: 0 },
});
const DUMMY = enemyRec({ key: 'e_d', hp: 1e7, speed: 0 });
function forceRng(h, v) { const orig = h.b.rng; h.b.rng = Object.assign(() => v, orig); }

// act2autochess_m01 (战场#01(下半)): (9,4) a melee tile on the road, (10,4) a 高台
const PROVENCE = 'chess_char_1_07_a'; // 普罗旺斯 狙击 RANGED, 不屈
const GLADIIA = 'chess_char_4_12_a'; // 歌蕾蒂娅 钩索师 MELEE (placement 'all': may stand on a 高台)
const CUORA = 'chess_char_3_16_a'; // 蛇屠箱: takes the tier-2 SP
const INDOM = { indomShip: { count: 3, active: true, tier: 2, layers: 210 } }; // p = min(1, 0.18 + 0.004 × 210) = 1

test('不屈 (real chess): 歌蕾蒂娅 knocked out on a 高台 is back at once with the tier-2 SP; 普罗旺斯 on a melee tile stays down', () => {
  const run = (id, row, col) => {
    const h = makeBattle({
      stageId: 'act2autochess_m01', seed: 4, timeLimit: 60, autoFinish: false, bonds: INDOM,
      units: [{ chessId: id, row, col, dir: 'RIGHT' }, { chessId: CUORA, row: 12, col: 6, dir: 'RIGHT' }],
    });
    h.step(2);
    const u = h.unit(id), other = h.unit(CUORA);
    const sp0 = other.skill.sp;
    h.b.kill(u, null);
    const back = u.alive && u.deployed;
    const sp = other.skill.sp - sp0;
    checkInvariants(h.b);
    return { u, back, sp };
  };
  const g = run(GLADIIA, 10, 4);
  assert.equal(g.u.ground, false, '歌蕾蒂娅 stands on the 高台');
  assert.equal(g.u.def.position, 'MELEE');
  assert.ok(isGroundOp(g.u), 'a 地面干员 up there');
  assert.ok(g.back, '不屈 brings her back at once');
  close(g.sp, 5, '不屈 tier 2: every operator on the field +5 SP');
  const p = run(PROVENCE, 9, 4);
  assert.equal(p.u.ground, true, '普罗旺斯 stands on a melee tile');
  assert.ok(!isGroundOp(p.u), 'not a 地面干员');
  assert.ok(!p.back, '不屈 does not bring a ranged operator back');
  close(p.sp, 0, 'no tier-2 SP for her knock-out');
  const g2 = run(GLADIIA, 9, 4);
  assert.ok(g2.back && g2.sp === 5, '歌蕾蒂娅 on the ground: as before');
});

test('战栗维式重锤: the 战栗 proc takes a melee carrier on a 高台, never a ranged carrier on a melee tile', () => {
  const ops = { t_m: op('t_m', { bonds: ['victoriaShip'] }), t_r: op('t_r', { bonds: ['victoriaShip'], profession: 'SNIPER' }) };
  const tremble = (id, row, col) => {
    const h = makeBattle({
      defs: { chess: ops, enemies: { e_d: DUMMY } }, timeLimit: 999, autoFinish: false,
      units: [{ chessId: id, row, col, items: ['chess_item_2_03_e_a'] }], enemies: [{ key: 'e_d', pos: [10, 5] }],
    });
    forceRng(h, 0.05); // under the 10 % chance
    h.runUntil(() => h.hooksOf('attack').length >= 1, 5);
    assert.ok(h.hooksOf('attack').length >= 1, `${id} attacked`);
    const u = h.unit(id);
    return { ground: u.ground, hit: !!h.b.enemies[0].findBuff('tremble') };
  };
  const m = tremble('t_m', 10, 2);
  assert.equal(m.ground, false, 'the melee carrier on the 高台');
  assert.ok(m.hit, '战栗 from a melee carrier on a 高台');
  const r = tremble('t_r', 10, 4);
  assert.equal(r.ground, true, 'the ranged carrier on a melee tile');
  assert.ok(!r.hit, 'no 战栗 from a ranged carrier');
});

test('休谟斯 回收利用: a melee operator\'s skill end on a 高台 feeds a neighbour 3 SP; a ranged one\'s on a melee tile does not', () => {
  const ops = { t_m: op('t_m'), t_r: op('t_r', { profession: 'SNIPER' }), t_n: op('t_n') };
  const recycle = (id, row, col, nRow, nCol) => {
    const h = makeBattle({
      defs: { chess: ops, enemies: { e_d: DUMMY } }, bandId: 'band_humus', timeLimit: 999, autoFinish: false,
      units: [{ chessId: id, row, col }, { chessId: 't_n', row: nRow, col: nCol }],
    });
    h.step(1);
    const u = h.unit(id), n = h.unit('t_n');
    const n0 = n.skill.sp;
    u.skill.activate('test', { free: true });
    u.skill.end('test');
    return { ground: u.ground, gain: n.skill.sp - n0 };
  };
  const m = recycle('t_m', 10, 2, 10, 3);
  assert.equal(m.ground, false);
  close(m.gain, 3, 'melee on the 高台: neighbour +3');
  const r = recycle('t_r', 10, 4, 11, 4);
  assert.equal(r.ground, true);
  close(r.gain, 0, 'ranged on a melee tile: nothing');
});
