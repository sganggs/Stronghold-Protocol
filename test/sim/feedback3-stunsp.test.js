// test/sim/feedback3-stunsp.test.js — community report #18: 洛洛's S2 self-stun lasted the right time, but her SP did not
// recover while she was stunned (skills.js returned before the natural recovery when the unit could not act).
// Official: PRTS 技能 "在阻回状态或技力条已满时，保留剩余冷却时间，计时暂停" — only 阻回 pauses natural recovery; PRTS 异常效果
// STUNNED "无法攻击、释放技能、阻挡敌人类单位" (gamedata_const ba.stun "无法移动、阻挡、攻击及使用技能") names no SP effect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} ± ${eps}, got ${a}`);
const dummy = enemyRec({ key: 'e_dummy', hp: 1e9, speed: 0 });

test('洛洛 S2 自负此轭: the data matches skill_table (lv 4 / 7), the stun lasts the overload, and her SP recovers while she is stunned', () => {
  const ds = getDefaultSource();
  // skill_table skchr_rockr_2: level 4 duration 40, spCost 45, initSp 15, atk 0.4, attack_speed 45, scale 1.6; level 7
  // (the elite piece) 40 / 40 / 20, 0.5 / 60 / 1.7 — the chess status skillLevel 4 / 7
  for (const [id, lv, cost, init, atk, aspd, scale] of [['chess_char_2_10_a', 4, 45, 15, 0.4, 45, 1.6], ['chess_char_2_10_b', 7, 40, 20, 0.5, 60, 1.7]]) {
    const sk = ds.rawChess(id).skill;
    assert.equal(sk.skillId, 'skchr_rockr_2', id);
    assert.equal(sk.level, lv, id);
    assert.deepEqual([sk.duration, sk.spCost, sk.initSp, sk.bb.atk, sk.bb.attack_speed, sk.bb.scale], [40, cost, init, atk, aspd, scale], id);
  }
  const h = makeBattle({
    defs: { enemies: { e_dummy: dummy } }, units: [{ chessId: 'chess_char_2_10_a', row: 10, col: 4, carryState: { sp: 999 } }],
    enemies: [{ key: 'e_dummy', pos: [10, 6] }], autoFinish: false, timeLimit: 200, hooks: ['statusApplied', 'skillStart'],
  });
  const u = h.unit('chess_char_2_10_a');
  h.step();
  assert.ok(u.skill.active, 'cast at once');
  h.runUntil(() => !u.skill.active, 45);
  h.step();
  const stun = h.hooksOf('statusApplied').find((c) => c.status === 'stun' && c.target === u);
  close(stun.duration, 20, 0.05, 'stunned as long as the overload (the second half of the 40 s)');
  assert.ok(!u.canAct);
  const sp0 = u.skill.sp;
  assert.ok(sp0 < 0.2, `the cast spent the SP, got ${sp0}`);
  h.run(10);
  assert.ok(!u.canAct, 'still stunned');
  close(u.skill.sp - sp0, 10, 0.1, 'SP +1/s while stunned (it stayed at 0 before)');
  h.run(10.5);
  assert.ok(u.canAct, 'the stun is over after 20 s');
  close(u.skill.sp, 20.5, 0.2);
  // ready 45 s after the skill end (not 45 s after the stun): cast again then
  const casts = () => h.hooksOf('skillStart').filter((c) => c.unit === u).length;
  assert.equal(casts(), 1);
  h.run(25);
  assert.equal(casts(), 2, 'recast 45 s after the end of the skill');
});

test('frozen or stunned operators keep their natural SP recovery; 阻回 (noSp) still stops it; no cast while stunned', () => {
  const op = (id) => chessRec({ id, profession: 'SNIPER', rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 100 }, skill: { duration: 5, spCost: 30, initSp: 0, bb: { atk: 1 } } });
  const h = makeBattle({
    defs: { chess: { t_a: op('t_a'), t_b: op('t_b'), t_c: op('t_c') }, enemies: { e_dummy: dummy } },
    units: [{ chessId: 't_a', row: 9, col: 3 }, { chessId: 't_b', row: 10, col: 3 }, { chessId: 't_c', row: 11, col: 3, carryState: { sp: 25 } }],
    enemies: [{ key: 'e_dummy', pos: [11, 4] }], content: 'generic', autoFinish: false, timeLimit: 60,
  });
  h.step();
  const [a, b, c] = ['t_a', 't_b', 't_c'].map((id) => h.unit(id));
  h.b.applyStatus(a, 'cold', { duration: 10 });
  h.b.applyStatus(a, 'cold', { duration: 10 }); // cold on cold → 冻结 (3 s)
  assert.ok(a.findBuff('freeze'), 'frozen');
  h.b.addBuff(b, { key: 't:noSp', duration: 3, flags: { noSp: true } });
  h.b.applyStatus(c, 'stun', { duration: 8 });
  const [a0, b0] = [a.skill.sp, b.skill.sp];
  h.run(2.9);
  close(a.skill.sp - a0, 2.9, 0.05, 'frozen: +1/s');
  close(b.skill.sp - b0, 0, 1e-9, '阻回: nothing');
  // t_c fills its 30 SP while stunned (25 + 5 s) but casts only once the stun is over (no cast while stunned)
  h.run(4.5);
  assert.ok(!c.canAct && c.skill.ready && c.skill.activations === 0, 'ready, stunned, no cast');
  h.run(1);
  assert.ok(c.canAct);
  h.run(1);
  assert.equal(c.skill.activations, 1, 'cast once it can act again');
});
