// Player report after the 0.1.0 release (sixth batch, F3): "干员蒂比（巡空者）起飞后仍能被不该打到的攻击打到".
//
// Verdict: real. Official rule (gamedata_const termDescriptionDict ba.liftoff 起飞 "不阻挡地面敌人且不会被地面敌人攻击，可以
// 阻挡飞行敌人"; PRTS 术语释义 起飞 "※包含对地规避（无法被不同阵营行动方式为地面的单位选中）… ※起飞后单位的行动方式依旧是地面";
// PRTS 异常效果 MOTION_TARGET_FREE 对地规避 "无法被行动方式为地面的不同阵营单位选中（属于无法选择类效果）", ignored when the
// selector's 行动方式 is not ground; PRTS 行动方式 "起飞的干员仍然是地面单位" and 近地悬浮 / 浮空 units count as flyers;
// PRTS 作战机制 "AOE的判定是对攻击范围内的每个可以被选中的敌人进行判定"):
//   - no ground enemy (行动方式 ground: data WALK, not hovering / levitated) selects an airborne operator — normal attacks,
//     the targets its abilities add (控潮术师's 周围四格, chain / bounce jumps) and its area damage and statuses skip her;
//   - flyers, 近地悬浮 and 浮空 enemies still select her (she stays a ground unit: no 对空 check);
//   - what is no selection still reaches her: sourceless damage, abilities that "无视无法选择" (【污染秽蚀】 at the
//     low-ground rate — she is still on her low tile; 【盲信之誓】; 萨卡兹悖谬暴虐兵长's 暴击 splash), direct picks
//     (碎铳之簧's counter on its attacker — PRTS 异常效果 "'直接选中'的能力…不受这些仅在选择时生效的异常效果制约"), flying
//     units' blasts (刺胄之弹, 斩胄之剑) and the ticks of a debuff put on her before she took off (出血, 沙狱, burning);
//     a ground enemy's zone does not (集团军重型火炮 【燃烧区域】 "碰撞不受迷彩制约，不可对空": 迷彩 only);
//   - she stays a 地面单位 for ally rules (隐德来希 S2 puts a 血镰 on her; PRTS 备注 "被添加血镰的单位处于起飞时，血镰可对空").
// Cause: 起飞 was `unit.ground = false` (an operator on a high tile): melee enemies could not reach her (she released them),
// but every ranged ground enemy kept shooting her and the AoE / skills of ground enemies hit her.
// [ASSUMED] a ground enemy's shot already in flight is cancelled too (PRTS 作战机制 伤害流程 7 "取消掉隐匿/无敌状态下的攻击",
// read for 对地规避); auras of ground enemies (光环, field-wide debuffs) still apply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { hasGeneratedData, getDefaultSource } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };
const ds = getDefaultSource();
const TIPPI = ['chess_char_2_13_a', 'chess_char_2_13_b'];
const S1 = 'skchr_tippi_1';              // 专业喷绘技巧: MANUAL → DEFAULT trigger, takes off at once
const S2 = 'skchr_tippi_2';              // 紧急赶场通知: takes off when attacked (dodging that hit)
const BAIT = 'chess_char_1_02_a';        // 角峰 (TANK) on the fence tile below her
const TIDMAG = 'enemy_1161_tidmag';      // 控潮术师: ground caster, hits its target and the 周围四格 (+ erosion)
const JSHOOT = 'enemy_1019_jshoot';      // 隐形弩手: ground sniper
const DUMAGE = 'enemy_1168_dumage';      // 深池暗影术师: ground caster
const LAZERD = 'enemy_1041_lazerd';      // 法术大师A1: FLY caster
const SYUFO = 'enemy_2025_syufo';        // 掠海漂移体: 近地悬浮 (a flyer while it hovers)
const NHPBR = 'enemy_1267_nhpbr';        // 萨卡兹枯朽战士: ground melee; death → 【污染秽蚀】 50 / 25 true per s
const ETLCHI = 'chess_char_5_06_a';      // 隐德来希 (S2 绯红壁合: 血镰 on herself and one other 地面单位)
const GOPRO = 'enemy_1000_gopro_2';      // 猎狗pro: ground melee
const skillIndex = (id, sk) => ds.rawChess(id).skills.find((s) => s.skillId === sk).index;
const done = (h) => { checkInvariants(h.b); assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []); };

/**
 * act2 m02's lower lane: 蒂比 on the road (9,5) facing the gate, 角峰 on the fence tile (10,5) — inside 控潮术师's 周围四格 of
 * her and she of him — and a still, tanky enemy at (9,7) (in her range and both of them in its own). Runs until she has
 * landed and `after` more seconds; returns the hits on her while airborne / after landing and those on the bait.
 */
function duel(id, sk, enemyKey, { after = 12, mods = {}, pos = [9, 7] } = {}) {
  const h = makeBattle({
    stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged', 'skillStart', 'skillEnd'], captureNoisy: true,
    units: [{ chessId: id, row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(id, sk) }, { chessId: BAIT, row: 10, col: 5 }],
    enemies: [{ key: enemyKey, pos, mods: { hpMul: 1e4, speedMul: 0, ...mods } }],
  });
  const u = h.unit(id), bait = h.unit(BAIT);
  let up = null, down = null, airborneSeen = false;
  for (let i = 0; i < 120 * 30 && (down == null || h.b.time < down + after); i++) {
    h.step();
    if (up == null && u.skill.active) up = h.b.time;
    if (u.skill.active && u.s.flags.liftoff) airborneSeen = true;
    if (up != null && down == null && !u.skill.active) down = h.b.time;
  }
  const fromEnemy = (c) => c.source && c.source.side === 'enemy';
  const on = (t) => h.hooksOf('damaged').filter((c) => c.target === t && fromEnemy(c));
  const tOf = (c) => c.t ?? c.time;
  return {
    h, u, bait, up, down, airborneSeen,
    air: on(u).filter((c) => tOf(c) > up + 1e-6 && tOf(c) < down - 1e-6),
    landed: on(u).filter((c) => tOf(c) > down + 1e-6),
    baitAir: on(bait).filter((c) => tOf(c) > up + 1e-6 && tOf(c) < down - 1e-6),
  };
}

test('F3: no ground enemy hits an airborne 蒂比 — 控潮术师 (direct and 周围四格), S1 and S2, normal and elite; she is a target again once landed', REAL, () => {
  for (const id of TIPPI) for (const sk of [S1, S2]) {
    const r = duel(id, sk, TIDMAG);
    assert.ok(r.up != null && r.down != null, `${id} ${sk}: took off and landed`);
    assert.ok(r.airborneSeen, `${id} ${sk}: 起飞 is the buff flag \`liftoff\``);
    assert.deepEqual(r.air.map((c) => `${c.type} ${Math.round(c.amount)}`), [], `${id} ${sk}: nothing from the ground caster while airborne`);
    assert.ok(r.baitAir.length > 0, `${id} ${sk}: the caster shoots 角峰 instead`);
    assert.ok(r.landed.length > 0, `${id} ${sk}: hit again after landing`);
    assert.equal(r.u.ground, true, `${id} ${sk}: still on her low tile (行动方式 ground)`);
    done(r.h);
  }
});

test('F3: ranged ground snipers / casters (隐形弩手, 深池暗影术师) never shoot an airborne 蒂比', REAL, () => {
  // the 隐匿 隐形弩手 is no target of hers, so S1's DEFAULT trigger never fires for it: S2 (its shot sets her off)
  for (const [key, sk] of [[JSHOOT, S2], [DUMAGE, S1], [DUMAGE, S2]]) {
    const r = duel(TIPPI[0], sk, key);
    assert.ok(r.up != null && r.down != null, `${key} ${sk}: took off and landed`);
    assert.deepEqual(r.air.map((c) => `${c.type} ${Math.round(c.amount)}`), [], `${key} ${sk}: nothing while airborne`);
    assert.ok(r.baitAir.length > 0, `${key} ${sk}: it shoots 角峰 instead`);
    done(r.h);
  }
});

test('F3: flyers and 近地悬浮 enemies still attack an airborne 蒂比 (对地规避 only stops ground selectors; she stays a ground unit)', REAL, () => {
  for (const key of [LAZERD, SYUFO]) {
    const r = duel(TIPPI[0], S1, key, { mods: { atkMul: 0.2 } });
    assert.ok(r.up != null, `${key}: took off`);
    assert.ok(r.air.length > 0, `${key}: hits her while she is airborne`);
    done(r.h);
  }
});

test('F3: the pipeline — a ground enemy\'s damage, element and statuses never land on an airborne 蒂比; a flyer\'s and sourceless ones do', REAL, () => {
  const h = makeBattle({
    stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['hit', 'damaged', 'statusApplied'], captureNoisy: true,
    defs: { enemies: { enemy_g: enemyRec({ key: 'enemy_g', hp: 1e7, speed: 0, atk: 0 }), enemy_f: enemyRec({ key: 'enemy_f', hp: 1e7, speed: 0, atk: 0, motion: 'FLY' }) } },
    units: [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }],
    enemies: [{ key: 'enemy_g', pos: [11, 9] }, { key: 'enemy_f', pos: [9, 7] }],
  });
  const u = h.unit(TIPPI[0]);
  assert.ok(h.runUntil(() => u.skill.active, 3), 'S1 takes off (the flyer is in range)');
  const g = h.b.enemies.find((e) => e.defId === 'enemy_g'), f = h.b.enemies.find((e) => e.defId === 'enemy_f');
  assert.equal(g.isFlying, false);
  // a ground enemy's hit: cancelled before any hook (she is not selected: no 'hit', no 片场工作指南 / S2 trigger)
  const hits0 = h.hooksOf('hit').filter((c) => c.target === u).length;
  assert.equal(h.b.dealDamage(g, u, { amount: 300, type: 'phys', canDodge: false, isAttack: true }), 0, 'ground attack');
  assert.equal(h.b.dealDamage(g, u, { amount: 300, type: 'true', isSkill: true }), 0, 'ground ability (true damage)');
  assert.equal(h.b.dealDamage(g, u, { type: 'element', element: 'burn', amount: 500 }), 0, 'ground element fill');
  assert.equal(u.elem.burn, 0);
  assert.equal(h.hooksOf('hit').filter((c) => c.target === u).length, hits0, 'no hit hook for a ground source');
  assert.equal(h.b.applyStatus(u, 'stun', { duration: 2, source: g }), false, 'ground enemy\'s stun refused');
  assert.equal(u.s.flags.stun, false);
  // a flyer, sourceless damage and an ability that ignores 无法选择 still land
  assert.ok(h.b.dealDamage(f, u, { amount: 300, type: 'true', isSkill: true }) > 0, 'flyer');
  assert.ok(h.b.dealDamage(null, u, { amount: 300, type: 'true' }) > 0, 'sourceless');
  assert.ok(h.b.dealDamage(g, u, { amount: 300, type: 'true', ignoreSelect: true }) > 0, '无视无法选择 (ignoreSelect)');
  assert.equal(h.b.applyStatus(u, 'stun', { duration: 0.2, source: f }), true, 'a flyer\'s stun lands');
  // landed: the ground enemy reaches her again
  h.runUntil(() => !u.skill.active, 40);
  h.run(0.5);
  assert.equal(u.s.flags.liftoff, undefined);
  assert.ok(h.b.dealDamage(g, u, { amount: 300, type: 'true', isSkill: true }) > 0, 'landed: ground ability lands');
  done(h);
});

test('F3: 【污染秽蚀】 (萨卡兹枯朽战士) still reaches an airborne 蒂比, at the low-ground rate (PRTS "可对空，无视无法选择")', REAL, () => {
  const h = makeBattle({
    stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }],
    enemies: [{ key: NHPBR, pos: [9, 6], mods: { hpMul: 0.01, speedMul: 0 } }],
  });
  const u = h.unit(TIPPI[0]);
  assert.ok(h.runUntil(() => u.skill.active, 3), 'takes off');
  assert.ok(h.runUntil(() => !h.b.enemies.some((e) => e.alive), 10), 'she kills the 战士 while airborne');
  h.run(4);
  assert.ok(u.skill.active && u.s.flags.liftoff, 'still airborne');
  const ticks = h.hooksOf('damaged').filter((c) => c.target === u && (c.dmg?.tags || []).includes('pollution'));
  assert.ok(ticks.length >= 3, `pollution ticks on her: ${ticks.length}`);
  for (const c of ticks) assert.equal(Math.round(c.amount), 50, 'low-ground rate (her tile is low ground)');
  done(h);
});

test('F3: an airborne 蒂比 is still a 地面单位 for 隐德来希 S2 — she carries a 血镰 and it cuts the flyer next to her', REAL, () => {
  const h = makeBattle({
    stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged', 'skillStart'], captureNoisy: true,
    units: [
      { chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) },
      { chessId: ETLCHI, row: 9, col: 3, skillIndex: skillIndex(ETLCHI, 'skchr_etlchi_2') },
    ],
    enemies: [
      { key: GOPRO, pos: [9, 4], mods: { hpMul: 1e4, speedMul: 0, atkMul: 0 } },
      { key: LAZERD, pos: [9, 6.2], mods: { hpMul: 1e4, speedMul: 0, atkMul: 0 } },
    ],
  });
  const u = h.unit(TIPPI[0]), et = h.unit(ETLCHI);
  assert.ok(h.runUntil(() => u.skill.active, 3), '蒂比 takes off');
  assert.ok(h.runUntil(() => et.skill.active, 40), '隐德来希 casts S2');
  assert.ok(u.skill.active && u.s.flags.liftoff, 'while 蒂比 is airborne');
  assert.ok((et.mem.sickles || []).includes(u), 'the second 血镰 is on 蒂比');
  h.run(2);
  const fl = h.b.enemies.find((e) => e.defId === LAZERD);
  const cuts = h.hooksOf('damaged').filter((c) => c.target === fl && c.source === et && (c.dmg?.tags || []).includes('bloodSickle'));
  assert.ok(cuts.length > 0, 'her 血镰 hits the flyer (可对空 while she is airborne)');
  done(h);
});

// ---------------------------------------------------------------------------------------------------------------
// Review round: which enemy abilities are selections (skip an airborne 蒂比) and which are not (still reach her).
// PRTS 异常效果 无法选择: "'直接选中'的能力不会进行具体的目标选择，故同样不受这些仅在选择时生效的异常效果制约"; abilities
// marked "无视无法选择" ignore it; a selector whose 行动方式 is not ground ignores 对地规避 (MOTION_TARGET_FREE).

const UACANN = 'enemy_10122_uacann_2';   // 集团军重型火炮: ground; hits leave a 3 s 【燃烧区域】 (PRTS "碰撞不受迷彩制约，不可对空")
const SPRING_A = 'enemy_9018_actrpa';    // “碎铳之簧” 法术护盾: phys hits → "对来源造成…无来源物理附加伤害" + erosion
const GUN2 = 'enemy_9017_achunt_2';      // 假想敌：铳 (隐秘核心): 【盲信之誓】 chains "无视无法选择、迷彩"
const SPRING_C = 'enemy_9020_actrpc';    // “碎铳之簧” 频次护盾 (a chain end)
const HELM = 'enemy_9013_acstmk';        // 假想敌：胄 (ground): 【灭顶之灾】 → 刺胄之弹 (行动方式 飞行)
const BLADE = 'enemy_9014_acstma';       // “斩胄之剑” (行动方式 飞行): 掷剑 "（无视无法选择）"
const SFHU = 'enemy_1203_sfhu';          // 烹泉: ground; death blast "无视迷彩，不可对空" + 【烹泉减益】
const MOUSEK = 'enemy_1509_mousek';      // “鼠王”: ground; 【沙狱】 ATK cut + arts per second on a 3×3
const VTSK = 'enemy_10027_vtsk';         // “帝国的甲胄”: ground; entrance barrage on the highest-HP unit around its lock
const pool = (hp) => ({ hp, maxHp: hp, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } });
const WAVES = getDefaultSource();
const tAt = (c) => c.t ?? c.time;
/** Steps `h` until 蒂比 has landed (or `max` s); returns [take-off, landing] times. */
function airborne(h, u, max = 60) {
  let up = null, down = null;
  for (let i = 0; i < max * 30 && down == null; i++) {
    h.step();
    if (up == null && u.s.flags.liftoff) up = h.b.time;
    if (up != null && down == null && !u.s.flags.liftoff) down = h.b.time;
  }
  return [up, down];
}

test('F3 review: a ground enemy\'s 【燃烧区域】 (集团军重型火炮, "不可对空", no 无视无法选择) never ticks on an airborne 蒂比; it does once she has landed', REAL, () => {
  const h = makeBattle({
    stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }, { chessId: BAIT, row: 10, col: 5 }],
    enemies: [{ key: UACANN, pos: [9, 7], mods: { hpMul: 1e4, speedMul: 0 } }],
  });
  const u = h.unit(TIPPI[0]), bait = h.unit(BAIT);
  const [up, down] = airborne(h, u);
  assert.ok(up != null && down != null, 'took off and landed');
  assert.ok(u.alive, 'she survives the window (the zones on 角峰 next to her used to kill her)');
  const burn = (t, a, z) => h.hooksOf('damaged').filter((c) => c.target === t && (c.dmg?.tags || []).includes('burning') && tAt(c) > a && tAt(c) < z);
  assert.ok(burn(bait, up, down).length > 0, 'the cannon shoots 角峰 and the zone burns him');
  assert.deepEqual(burn(u, up + 1e-6, down - 1e-6).map((c) => `${tAt(c).toFixed(1)} ${Math.round(c.amount)}`), [], 'no zone tick on her while airborne');
  h.run(15);
  assert.ok(burn(u, down, Infinity).length > 0, 'landed: the zone burns her again');
  done(h);
});

test('F3 review: “碎铳之簧” 法术护盾 counter is 无来源 on its attacker (直接选中) — it reaches an airborne 蒂比', REAL, () => {
  const h = makeBattle({
    stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }],
    enemies: [{ key: SPRING_A, pos: [9, 7], mods: { hpMul: 1e4, speedMul: 0 } }],
  });
  const u = h.unit(TIPPI[0]);
  assert.ok(h.runUntil(() => u.s.flags.liftoff, 3), 'takes off (the spring is in range)');
  h.run(10);
  assert.ok(u.s.flags.liftoff, 'still airborne');
  const on = h.hooksOf('damaged').filter((c) => c.target === u);
  assert.ok(on.some((c) => c.dmg.type === 'phys' && (c.dmg.tags || []).includes('springCounter')), 'the physical counter lands');
  assert.ok(on.some((c) => c.dmg.type === 'element' && (c.dmg.tags || []).includes('springCounter')), 'its erosion lands');
  assert.ok(!on.some((c) => c.dmg.isAttack), 'the ground spring\'s own attacks never select her');
  done(h);
});

test('F3 review: 假想敌：铳\'s 【盲信之誓】 chain ("无视无法选择") hurts an airborne 蒂比 standing on it', REAL, () => {
  const h = makeBattle({
    kind: 'boss', sharedBoss: pool(1e7), seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged'], captureNoisy: true,
    setup(b) { b.enemyOverrides = WAVES.getWave('act1autochess_h08_02').overrides; },
    units: [{ chessId: TIPPI[0], row: 10, col: 7, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }],
  });
  h.step();
  const put = (key, pos, o = {}) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: 0, ...o.mods }, tag: o.tag ?? null });
  put(GUN2, [3, 10], { tag: 'boss' }).profile.noAttack = true;
  put(SPRING_C, [3, 4], { tag: 'part' }).profile.noAttack = true;
  put(LAZERD, [3, 8.2], { mods: { hpMul: 1e4, atkMul: 0 } });            // her S1 target
  const u = h.unit(TIPPI[0]);
  assert.equal(u.y, 3, 'on the chain between 铳 (3,10) and the spring (3,4)');
  const [up, down] = airborne(h, u);
  assert.ok(up != null && down != null, 'took off and landed');
  const chain = h.hooksOf('damaged').filter((c) => c.target === u && (c.dmg?.tags || []).includes('faithLink') && tAt(c) > up && tAt(c) < down);
  assert.ok(chain.length >= 20, `the chain hurts her every second while airborne: ${chain.length}`);
  done(h);
});

test('F3 review: the 刺胄之弹 and 斩胄之剑 blasts (flying units — 对地规避 does not stop them; 无来源 DoT) still stun and hurt an airborne 蒂比', REAL, () => {
  // 刺胄之弹: 胄 (ground) cannot pick her; the shell flies at 角峰 next to her and its 3×3 blast catches her
  {
    const h = makeBattle({
      kind: 'boss', sharedBoss: pool(1e7), seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged', 'statusApplied'], captureNoisy: true,
      units: [{ chessId: TIPPI[0], row: 10, col: 7, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }, { chessId: BAIT, row: 11, col: 7 }],
    });
    h.step();
    h.spawn(LAZERD, { pos: [3, 8.2], routeIndex: 0, mods: { speedMul: 0, hpMul: 1e4, atkMul: 0 } });
    h.spawn(HELM, { pos: [3, 9], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' }).profile.noAttack = true;
    const u = h.unit(TIPPI[0]);
    // the shell lands at ≈ 29 s, S1 ends at ≈ 32 s
    const [up, down] = airborne(h, u, 40);
    const st = h.hooksOf('statusApplied').filter((c) => c.status === 'stun');
    assert.ok(st.some((c) => c.target === h.unit(BAIT)), 'the shell went to 角峰');
    assert.ok(st.some((c) => c.target === u && tAt(c) > up && tAt(c) < down), 'she is stunned while airborne');
    // (片场工作指南 may dodge one physical tick: her talent's dodge after a quiet spell)
    const dot = h.hooksOf('damaged').filter((c) => c.target === u && (c.dmg?.tags || []).includes('helmShell') && tAt(c) > up && tAt(c) < down);
    assert.ok(dot.length >= 1, `the DoT ticks on her while airborne: ${dot.length}`);
    done(h);
  }
  // 斩胄之剑 掷剑 "选择…攻击力最低的1名我方单位（无视无法选择）": it dives at her while she is airborne, 胄 on the field
  {
    const H08 = 'act1autochess_h08_01';
    const tpl = WAVES.getWave(H08);
    const origin = tpl.extraRoutes[tpl.branches.left_hand_origin[0][0].routeIndex];
    const h = makeBattle({
      kind: 'boss', sharedBoss: pool(1e7), seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged', 'statusApplied'], captureNoisy: true,
      setup(b) { b.opts.templateId = H08; },
      units: [{ chessId: TIPPI[0], row: 12, col: 15, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }],
    });
    h.step();
    h.spawn(LAZERD, { pos: [5, 16], routeIndex: 0, mods: { speedMul: 0, hpMul: 1e4, atkMul: 0 } });
    h.spawn(HELM, { pos: [2, 9], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' }).profile.noAttack = true;
    h.spawn(BLADE, { pos: origin.start, routeIndex: 0, tag: 'part' });
    const u = h.unit(TIPPI[0]);
    const [up, down] = airborne(h, u, 40);                                // the dive lands at ≈ 29 s, S1 ends at ≈ 32 s
    assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'stun' && c.target === u && tAt(c) > up && tAt(c) < down), 'the dive stuns her while airborne');
    const dot = h.hooksOf('damaged').filter((c) => c.target === u && (c.dmg?.tags || []).includes('bladeDive') && tAt(c) > up && tAt(c) < down);
    assert.ok(dot.length >= 1, `its DoT hurts her while airborne: ${dot.length}`);
    done(h);
  }
});

test('F3 review: one-shot area abilities of ground enemies skip an airborne 蒂比 — 烹泉 death blast and steam, 鼠王 【沙狱】, “帝国的甲胄” barrage', REAL, () => {
  // 烹泉: dies next to her while she is airborne (PRTS "死亡爆炸（…无视迷彩，不可对空）": a selection, no 无视无法选择)
  {
    const h = makeBattle({
      stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged'], captureNoisy: true,
      units: [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }, { chessId: BAIT, row: 10, col: 5 }],
      // both within the blast's 1.25 (PRTS 爆炸半径1.25, since 0.1.3): 0.72 from her, 0.85 from 角峰
      enemies: [{ key: SFHU, pos: [9.4, 5.6], mods: { hpMul: 0.4, speedMul: 0 } }],
    });
    const u = h.unit(TIPPI[0]), bait = h.unit(BAIT);
    let slowAir = false, baitSlow = false;
    // one 【烹泉减益】 layer per blast, keyed `ab:teaBoom:<enemy id>` (each layer its own buff, since 0.1.3)
    const teaSlow = (x) => x.buffs.some((bf) => String(bf.key).startsWith('ab:teaBoom'));
    for (let i = 0; i < 25 * 30; i++) { h.step(); if (u.s.flags.liftoff && teaSlow(u)) slowAir = true; if (teaSlow(bait)) baitSlow = true; }
    assert.ok(!h.b.enemies.some((e) => e.alive && e.defId === SFHU), '烹泉 died');
    assert.ok(u.s.flags.liftoff, 'she is still airborne');
    const blast = (t) => h.hooksOf('damaged').filter((c) => c.target === t && (c.dmg?.tags || []).includes('teaBoom'));
    assert.equal(blast(u).length, 0, 'no blast on her');
    assert.ok(blast(bait).length > 0 && baitSlow, '角峰 takes the blast and the slow');
    assert.ok(!slowAir, 'no 【烹泉减益】 on her');
    done(h);
  }
  // 鼠王 【沙狱】 centred on 角峰 next to her: neither its ATK cut nor its DoT attaches to her
  {
    const h = makeBattle({
      stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged'], captureNoisy: true,
      units: [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }, { chessId: BAIT, row: 10, col: 5 }],
      enemies: [{ key: MOUSEK, pos: [9, 8], mods: { hpMul: 1e4, speedMul: 0, atkMul: 0.01 } }, { key: LAZERD, pos: [9, 6.2], mods: { hpMul: 1e4, speedMul: 0, atkMul: 0 } }],
    });
    const u = h.unit(TIPPI[0]), bait = h.unit(BAIT);
    assert.ok(h.runUntil(() => u.s.flags.liftoff, 3), 'takes off');
    const m = h.b.enemies.find((e) => e.defId === MOUSEK);
    const storm = m.mem.ab.list.find((a) => a && a.cd === m.mem.ab.sk.SandStorm.cd && a.fire);
    storm.left = 0.1;                                                     // 【沙狱】 now (its initial cooldown is 60 s)
    h.run(2);
    assert.ok(bait.findBuff('ab:sandStorm'), '沙狱 on 角峰');
    assert.ok(u.s.flags.liftoff && !u.findBuff('ab:sandStorm'), 'not on the airborne 蒂比 next to him');
    done(h);
  }
  // “帝国的甲胄” entrance barrage: locks 角峰 (she cannot be selected) and hits the highest-HP unit she is not
  {
    const h = makeBattle({
      stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged'], captureNoisy: true,
      units: [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }, { chessId: BAIT, row: 10, col: 5 }],
      enemies: [{ key: LAZERD, pos: [9, 7], mods: { hpMul: 1e4, speedMul: 0, atkMul: 0 } }],
    });
    const u = h.unit(TIPPI[0]), bait = h.unit(BAIT);
    assert.ok(h.runUntil(() => u.s.flags.liftoff, 3), 'takes off');
    bait.hp = Math.min(bait.hp, 100);                                     // she has the most HP in the 3×3
    const e = h.spawn(VTSK, { pos: [9, 8], routeIndex: 0, mods: { speedMul: 0, atkMul: 0.01 } });
    h.run(1.5);
    const shots = (t) => h.hooksOf('damaged').filter((c) => c.target === t && c.source === e && !c.dmg.isAttack).length;
    assert.equal(shots(u), 0, 'no shot on her');
    assert.equal(shots(bait), ds.rawEnemy(VTSK).skills.find((s) => s.prefabKey === 'Appear').bb.times, 'every shot hits 角峰 instead of being wasted on her');
    done(h);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Second review round: 萨卡兹悖谬暴虐兵长's 暴击 splash ("无视无法选择") and the ticks of debuffs already on her.

const WDRRL = 'enemy_1320_wdrrl_2';      // 萨卡兹悖谬暴虐兵长 (ground, block ≥ 3): 暴击 "对目标和周围4格…（无视无法选择，无视迷彩）"
const NHSTLK = 'enemy_1270_nhstlk';      // 逐腐兽 (ground melee): 出血 on hit — arts per second
const LSLIME = 'enemy_1050_lslime';      // “庞贝” (ground): its hits leave a burning DoT

test('F3 review 2: 萨卡兹悖谬暴虐兵长\'s 暴击 splash ("无视无法选择") reaches an airborne 蒂比 next to its blocker', REAL, () => {
  const h = makeBattle({
    stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['hit', 'damaged'], captureNoisy: true,
    units: [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 999 }, skillIndex: skillIndex(TIPPI[0], S1) }, { chessId: BAIT, row: 9, col: 4 }],
    enemies: [{ key: WDRRL, route: { motion: 'WALK', start: [9, 8], end: [9, 1], checkpoints: [] }, mods: { hpMul: 1e3, atkMul: 0.3 } }],
  });
  const u = h.unit(TIPPI[0]), bait = h.unit(BAIT);
  let e = null, airAtBlock = null;
  for (let i = 0; i < 14 * 30; i++) {                                     // it reaches 角峰 at ≈ 9 s, S1 lasts 32 s
    h.step();
    e ??= h.b.enemies.find((x) => x.defId === WDRRL) ?? null;
    if (e && airAtBlock == null && e.blockedBy) airAtBlock = !!u.s.flags.liftoff;
  }
  assert.ok(e && e.blockedBy === bait, '角峰 (block 3) blocks it; she cannot (block < 3)');
  assert.equal(airAtBlock, true, 'she is airborne when it reaches 角峰');
  // the splash gets past 对地规避 to her `hit` (where her 片场工作指南 may dodge it: no damage for stack_time s), once
  const reach = h.hooksOf('hit').filter((c) => c.target === u && c.source === e);
  assert.equal(reach.length, 1, 'its one-off splash reaches her');
  assert.ok(!reach[0].dmg.isAttack && reach[0].dmg.ignoreSelect && reach[0].dmg.tags.includes('aoeAttack'));
  const landed = h.hooksOf('damaged').filter((c) => c.target === u && c.source === e);
  assert.equal(landed.length, reach[0].dmg.cancel ? 0 : 1, 'it hurts her unless her talent dodged it');
  assert.ok(landed.every((c) => c.amount > 0));
  assert.ok(u.s.flags.liftoff, 'while airborne');
  assert.ok(h.hooksOf('damaged').some((c) => c.target === bait && c.source === e && c.dmg.isAttack), 'its attack itself is on 角峰');
  done(h);
});

test('F3 review 2: a debuff a ground enemy put on 蒂比 before she took off keeps ticking (no selection); its new attacks still skip her', REAL, () => {
  // 鼠王 【沙狱】 (centred near 角峰 and her), 逐腐兽's 出血, “庞贝”'s burning DoT: attached on the ground, then S1
  const cases = [
    { key: MOUSEK, pos: [9, 8], buff: 'ab:sandStorm', bait: true, fire: (h, m) => { m.mem.ab.list.find((a) => a && a.cd === m.mem.ab.sk.SandStorm.cd && a.fire).left = 0.05; } },
    { key: NHSTLK, pos: [9, 5.3], buff: 'ab:bleed' },
    { key: LSLIME, pos: [9, 7], buff: 'ab:burnDot' },
  ];
  for (const k of cases) {
    const units = [{ chessId: TIPPI[0], row: 9, col: 5, carryState: { sp: 0 }, skillIndex: skillIndex(TIPPI[0], S1) }];
    if (k.bait) units.push({ chessId: BAIT, row: 10, col: 5 });
    const h = makeBattle({
      stageId: 'act2autochess_m02', seed: 3, autoFinish: false, timeLimit: 400, hooks: ['damaged'], captureNoisy: true, units,
      enemies: [{ key: k.key, pos: k.pos, mods: { hpMul: 1e4, speedMul: 0, atkMul: k.bait ? 0.01 : 0.05 } }, { key: LAZERD, pos: [9, 7.2], mods: { hpMul: 1e4, speedMul: 0, atkMul: 0 } }],
    });
    const u = h.unit(TIPPI[0]);
    h.step();
    const e = h.b.enemies.find((x) => x.defId === k.key);
    k.fire?.(h, e);
    assert.ok(h.runUntil(() => u.findBuff(k.buff), 10), `${k.key}: ${k.buff} on her`);
    assert.ok(!u.s.flags.liftoff, `${k.key}: before she takes off`);
    u.skill.gainSp(999, 'init');
    assert.ok(h.runUntil(() => u.s.flags.liftoff, 3), `${k.key}: takes off`);
    const up = h.b.time;
    h.run(4);
    assert.ok(u.s.flags.liftoff && u.findBuff(k.buff), `${k.key}: still airborne with the debuff`);
    const air = h.hooksOf('damaged').filter((c) => c.target === u && c.source === e && tAt(c) > up + 1e-6);
    assert.ok(air.filter((c) => !c.dmg.isAttack).length >= 3, `${k.key}: its ticks land while airborne: ${air.length}`);
    assert.deepEqual(air.filter((c) => c.dmg.isAttack).map((c) => Math.round(c.amount)), [], `${k.key}: no new attack on her`);
    done(h);
  }
});

// QA after the integration: two ground enemies decided to cast an area skill by counting every ally in its radius —
// 卢西恩，“猩红血钻”'s 【aoe】 (radius 2) and 锏's CircleAttack (first form, radius 1.5) — so an airborne 蒂比 alone in
// range set it off and the blast, which skips her (对地规避), was spent on nobody (6 casts in 60 s, 0 hits). They count
// only the allies the blast can hurt now. The `liftoff` flag on 角峰 stands for 蒂比's 起飞 (targeting.js evadesGround
// reads the flag), so no skill of hers takes off or lands in the middle of the count.
test('F3 QA: 卢西恩\'s 【aoe】 and 锏\'s CircleAttack are not cast for an airborne operator alone in range; they are once it lands', REAL, () => {
  for (const [key, kind, radius] of [['enemy_2016_csphtm', 'crimsonAoe', 2], ['enemy_1525_blkswb', 'blizzard', 1.5]]) {
    const h = makeBattle({
      stageId: 'flat', seed: 3, autoFinish: false, timeLimit: 400,
      units: [{ chessId: BAIT, row: 10, col: 5 }],
      enemies: [{ key, pos: [10, 6], mods: { hpMul: 1e3, speedMul: 0, atkMul: 0.01 } }],
    });
    h.step();
    const u = h.unit(BAIT);
    const e = h.b.enemies.find((x) => x.alive && x.defId === key);
    assert.ok(e && Math.hypot(e.x - u.x, e.y - u.y) <= radius, `${key}: 角峰 inside the radius`);
    h.b.addBuff(u, { key: 'test:liftoff', persist: true, flags: { liftoff: true, blockFly: true } });
    let casts = 0;
    const fx0 = h.b.fx.bind(h.b);
    h.b.fx = (k, p) => { if (k === 'explode' && p && p.kind === kind) casts++; return fx0(k, p); };
    h.run(40);
    assert.equal(casts, 0, `${key}: no ${kind} while the only ally in range is airborne`);
    h.b.removeBuff(u, 'test:liftoff');
    h.run(2);
    assert.equal(casts, 1, `${key}: cast at once when a target it can hurt is there (the skill was ready all along)`);
    done(h);
  }
});
