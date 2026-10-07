// test/sim/trait_attack_speed.test.js — the ENGINE-level consumption of a trait's attack-speed rider
// (server/sim/content/traitMods.js, wired from server/sim/battle/players.js `_setupUnit` after `kit.install`; the v0.1.4
// original wired the same call from `Battle._setupUnit`).
//
// Background (the def shape is docs/SIM.md `traitBb`; the profile merge is professions.js:658-665): build-data.mjs folds
// a module's trait blackboard into `trait.bb` unconditionally, so `{key:'attack_speed', value:12}` reached
// `resolveProfile` and stopped there — nothing read it, because the CONDITION only exists in the module sentence
// (「攻击范围内存在2名及以上敌人时攻击速度+12」). The line was therefore inert as DATA, and the two operators that
// carry it implemented it by hand in their kits (shared/tier5.js `crowdAspd`, deleted by this change): the engine now
// applies the same line for everyone.
//
// The tests below pin the four things that make this a fix rather than a special case:
//   1. the two REA-Y beneficiaries get +12 ASPD POINTS, and only while the engine's own targeting sees the required
//      enemies — no bonus with 1 enemy in range, a measurably shorter attack interval from 2, back to base when the
//      condition is left, and back on when it holds again;
//   2. the SAME engine rule serves both, although their numbers live on DIFFERENT blackboards (圣约送葬人 REA-Y:
//      a hidden module talent, index −1; 隐德来希 REA-Y: `trait.bb` folded in by build-data) — there is no operator-id
//      whitelist anywhere in the path;
//   3. operators with no such line are untouched;
//   4. the trait attack-speed lines a hand-written kit already implemented are neither double-counted nor changed
//      (史尔特尔 / 维娜·维多利亚 / 山 / 空弦 / 斯卡蒂), and the whole shipped data set is closed against silent gaps.
//
// ASPD is a POINT score, not a percentage: `aspd = clamp(base + Σaspd, 20, 600)` and
// `interval = bat × (1 + ΣbatPct) × 100 / aspd` (units.js:6-7), so +12 means 100 → 112 (interval × 100/112), which is
// how every existing module / item / enemy implementation reads `attack_speed` too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { TICK } from '../../server/sim/constants.js';
import { traitAttackSpeedRule, installTraitAttackSpeed, conditionClause, plainText, TRAIT_ASPD_BUFF } from '../../server/sim/content/traitMods.js';

const ds = getDefaultSource();
const HOOKS = ['attack', 'damaged', 'deploy', 'skillStart', 'skillEnd', 'tick'];
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const DEFS = { enemies: { enemy_dummy: dummy('enemy_dummy') } };
/** Battle + one tick (t = 0 spawns exist afterwards). `autoFinish:false`: the battles below outlive their enemies. */
const run = (o) => makeBattle({ seed: 7, autoFinish: false, timeLimit: 400, hooks: HOOKS, captureNoisy: true, ...o }).step();
/** No skill casts while a window is measured (a silence buff, as the other kit tests do). */
const mute = (h, u) => h.b.addBuff(u, { key: 'test:mute', flags: { silence: true } });
const approx = (a, b, msg = '', rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
/** The enemies the ENGINE counts for `u` (the call traitMods.js itself makes: live range keys + its own profile). */
const inRange = (h, u) => h.b.enemiesInKeys(u.rangeKeys, u, u.profile);
/** The cadence the engine can actually produce: `atkCd` counts down in whole ticks, so a gap is ⌈interval/TICK⌉ ticks. */
const cadence = (interval) => Math.ceil(interval / TICK - 1e-9) * TICK;
/** Run `seconds` and return the gaps (s) between `u`'s consecutive ordinary attacks inside that window. */
function attackGaps(h, u, seconds) {
  const t0 = h.b.time;
  h.run(seconds);
  const ts = h.hooksOf('attack').filter((c) => c.attacker === u && !c.isSkill && c.t >= t0 - 1e-9).map((c) => c.t);
  const gaps = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  return gaps;
}
/** `chessId` on the board with `moduleId`, 1 dummy in range (the placement every REA-Y module test uses). */
function board(id, o = {}) {
  return run({ defs: DEFS, units: [{ chessId: id, row: 10, col: 4, ...o }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
}
/** Spawn dummies on the candidate tiles (skipping occupied ones) until `n` of them stand in `u`'s own range. */
function spawnInRange(h, u, n, tiles = [[10, 5], [11, 5], [9, 5], [9, 4], [8, 5]]) {
  const occupied = new Set(h.enemies().map((e) => `${Math.round(e.y)},${Math.round(e.x)}`));
  const out = [];
  for (const pos of tiles) {
    if (inRange(h, u).length >= n) break;
    if (occupied.has(pos.join(','))) continue;
    out.push(h.spawn('enemy_dummy', { pos }));
    occupied.add(pos.join(','));
    h.step();
  }
  assert.ok(inRange(h, u).length >= n, `${u.defId}: ${n} enemies stand in its range (${inRange(h, u).length})`);
  return out;
}
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };

/** The two operators the engine serves; `legacy` = the buff key their deleted hand-written copy used. */
const REA_Y = [
  // 圣约送葬人 chess_char_5_01_b: the module's number rides a HIDDEN module talent (`talentChanges[0].bb.attack_speed`)
  { id: 'chess_char_5_01_b', moduleId: 'uniequip_003_excu2', legacy: 'excu2:module', base: 100 },
  // 隐德来希 chess_char_5_06_b: build-data folds it straight into `trait.bb`
  { id: 'chess_char_5_06_b', moduleId: 'uniequip_003_etlchi', legacy: 'etlchi:module', base: 105 },
];

// =================================================================================================================
// 1. the two REA-Y beneficiaries: entered, left and re-entered, with the cadence measured

test('圣约送葬人 / 隐德来希 REA-Y: 1 名敌人 → 正好 base，2 名 → 正好 +12 点（不是 +24）且实测攻击间隔按 ASPD 比缩短，击杀后恢复，重新进范围再加回', () => {
  for (const { id, moduleId, legacy, base } of REA_Y) {
    const h = board(id, { moduleId });
    const u = h.unit(id);
    const rule = traitAttackSpeedRule(u.def);
    assert.equal(rule.value, 12, `${id}: the REA-Y line is +12`);
    assert.equal(rule.reason, 'ok', `${id}: the engine owns it`);
    assert.equal(rule.clause, '攻击范围内存在2名及以上敌人时', `${id}: read from the module sentence`);
    assert.equal(u.base.aspd, base, `${id}: base ASPD`);
    mute(h, u);   // a skill that widened the range would move the measured condition under our feet

    // --- one enemy in range: the 「存在2名及以上敌人」 clause does not hold, so nothing is installed
    h.run(1);
    assert.equal(inRange(h, u).length, 1, `${id}: exactly one enemy stands in its range`);
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, `${id}: 1 enemy → the module line is NOT installed`);
    assert.equal(u.findBuff(legacy), null, `${id}: the kit copy of the line is gone (${legacy})`);
    assert.equal(u.s.aspd, u.base.aspd, `${id}: 1 enemy → exactly the base (NOT base + 12: no kit + engine double count)`);
    approx(u.s.interval, u.base.bat * 100 / u.base.aspd, `${id}: interval = bat × 100 / aspd`);
    const g1 = attackGaps(h, u, 8);
    assert.ok(g1.length >= 4, `${id}: enough attacks to measure (${g1.length})`);
    approx(median(g1), cadence(u.s.interval), `${id}: baseline cadence matches the interval`, 0.02);

    // --- a second enemy walks in: the stat is on within one tick
    const interval0 = u.s.interval;
    const second = h.spawn('enemy_dummy', { pos: [11, 5] });
    h.step();
    assert.equal(inRange(h, u).length, 2, `${id}: the second enemy is in range (the engine's own targeting)`);
    assert.equal(u.s.aspd, u.base.aspd + 12, `${id}: 2 enemies → +12 ASPD POINTS`);
    assert.notEqual(u.s.aspd, u.base.aspd + 24, `${id}: the engine rule only — the hand-written copy is deleted`);
    approx(u.s.interval, u.base.bat * 100 / (u.base.aspd + 12), `${id}: the shortened interval`);
    assert.ok(u.s.interval < interval0 - 1e-9, `${id}: the attack interval really shrank`);
    const buff = u.findBuff(TRAIT_ASPD_BUFF);
    assert.ok(buff, `${id}: the engine rule installed the buff`);
    assert.equal(buff.mods.aspd, 12, `${id}: 12 points`);
    const g2 = attackGaps(h, u, 8);
    approx(median(g2), cadence(u.s.interval), `${id}: buffed cadence matches the shortened interval`, 0.02);
    assert.ok(median(g2) < median(g1) - 0.02, `${id}: measured gaps shrank (${median(g2).toFixed(4)} < ${median(g1).toFixed(4)})`);
    approx(median(g1) / median(g2), (u.base.aspd + 12) / u.base.aspd, `${id}: the measured cadence ratio is the ASPD ratio`, 0.03);

    // --- the condition is left: the stat goes away again
    h.b.dealDamage(null, second, { type: 'true', amount: 1e9 });
    h.step();
    assert.equal(second.alive, false, `${id}: the second enemy is dead`);
    assert.equal(u.s.aspd, u.base.aspd, `${id}: back to the baseline`);
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, `${id}: buff removed`);
    const g3 = attackGaps(h, u, 8);
    approx(median(g3), cadence(u.s.interval), `${id}: cadence back to the baseline interval`, 0.02);
    approx(median(g3), median(g1), `${id}: and back to the measured baseline cadence`, 0.03);

    // --- and it comes back on a new enemy
    h.spawn('enemy_dummy', { pos: [11, 5] });
    h.step();
    assert.equal(u.s.aspd, u.base.aspd + 12, `${id}: re-entering the condition re-applies it`);
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF)?.mods.aspd, 12, `${id}: still 12 points`);
    done(h);
  }
});

test('两名受益者的取值来源不同（隐藏天赋 / traitBb），引擎两条路都读；默认模组都没有这条词条', () => {
  // 圣约送葬人 REA-Y: `talentChanges[0]` targets the hidden talent, so the number is NOT on the trait blackboard
  const excu2 = ds.getChess('chess_char_5_01_b', { moduleId: 'uniequip_003_excu2' });
  const hidden = (excu2.raw.talents ?? []).filter((t) => t.index === -1);
  assert.equal(excu2.raw.trait.bb.attack_speed, undefined, '圣约送葬人: the number is not on trait.bb');
  assert.equal(hidden.length, 1, '圣约送葬人: …it is on the hidden module talent (index −1)');
  assert.equal(hidden[0].bb.attack_speed, 12, '圣约送葬人: +12 there');
  const r1 = traitAttackSpeedRule(excu2);
  assert.equal(r1.value, 12);
  assert.equal(r1.reason, 'ok');
  assert.equal(r1.clause, '攻击范围内存在2名及以上敌人时');
  assert.equal(plainText(r1.source), '攻击范围内存在2名及以上敌人时攻击速度+12');

  // 隐德来希 REA-Y: build-data folded the line into trait.bb, and she has no hidden module talent at all
  const etlchi = ds.getChess('chess_char_5_06_b', { moduleId: 'uniequip_003_etlchi' });
  assert.equal(etlchi.raw.trait.bb.attack_speed, 12, '隐德来希: the number is on trait.bb');
  assert.deepEqual((etlchi.raw.talents ?? []).filter((t) => t.index === -1), [], '隐德来希: no hidden module talent');
  const r2 = traitAttackSpeedRule(etlchi);
  assert.equal(r2.value, 12);
  assert.equal(r2.reason, 'ok');
  assert.equal(r2.clause, '攻击范围内存在2名及以上敌人时');
  assert.equal(plainText(r2.source), '攻击范围内存在2名及以上敌人时攻击速度+12');

  // the module has to be EQUIPPED: without it neither carries the line (no permanent rider on the default loadout)
  assert.equal(traitAttackSpeedRule(ds.getChess('chess_char_5_01_b')), null, '圣约送葬人 默认模组: no such line');
  assert.equal(traitAttackSpeedRule(ds.getChess('chess_char_5_06_b')), null, '隐德来希 默认模组: no such line');
});

// =================================================================================================================
// 2. regression — operators without the line

test('回归: 没有该词条的干员完全不变（3 名敌人也不动）', () => {
  for (const id of ['chess_char_1_01_a', 'chess_char_5_01_a']) {   // 隐现; 圣约送葬人的 NORMAL 棋子（未装备 REA-Y）
    assert.equal(traitAttackSpeedRule(ds.getChess(id)), null, `${id}: no trait attack-speed line`);
    const h = board(id);
    const u = h.unit(id);
    mute(h, u);
    h.run(0.5);
    const as0 = u.s.aspd;
    spawnInRange(h, u, 3);
    h.run(0.5);
    assert.equal(u.s.aspd, as0, `${id}: ASPD unchanged with 3 enemies in range`);
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, `${id}: no engine buff`);
    done(h);
  }
});

test('回归: 手写实现的那几条特性词条，引擎显式拒绝接管（防止二次加成）', () => {
  const cases = [
    ['chess_char_3_05_b', null, 30, 'kit'],                     // DRE-Y 被击倒时不撤退 +30（kit: ops/chess_char_3_05-skadi.js）
    ['chess_char_6_17_b', 'uniequip_003_nearl2', 30, 'kit'],    // DRE-Y 耀骑士临光
    ['chess_char_5_07_b', null, 8, 'kit'],                      // AFT-X 未阻挡 +8（史尔特尔）
    ['chess_char_6_07_b', null, 8, 'kit'],                      // AFT-X 维娜·维多利亚
    ['chess_char_5_08_b', 'uniequip_003_horn', 10, 'kit'],      // FOR-Y 号角 不阻挡敌人时 +10
    ['chess_char_5_17_b', null, 10, 'kit'],                     // FGT-Y 生命值高于50% +10（山）
    ['chess_char_3_21_b', null, 8, 'kit'],                      // MAR-Y 空弦 范围内地面敌人 +8
    ['chess_char_3_01_b', 'uniequip_003_angel', 8, 'kit'],      // MAR-Y 能天使
    ['chess_char_6_20_b', 'uniequip_003_agoat2', 8, 'kit'],     // WDM-Y 纯烬艾雅法拉
    ['chess_char_4_09_b', 'uniequip_004_mizuki', 50, 'mode'],   // ISW-A 水月（集成战略专用，本模式不适用）
  ];
  for (const [id, moduleId, value, reason] of cases) {
    const def = ds.getChess(id, moduleId ? { moduleId } : null);
    const r = traitAttackSpeedRule(def);
    assert.ok(r, `${id}: carries a trait attack-speed line`);
    assert.equal(r.value, value, `${id}: value`);
    assert.equal(r.condition, null, `${id}: the engine installs nothing`);
    assert.equal(r.reason, reason, `${id}: refused as '${reason}'`);
    assert.ok(r.clause.length > 0, `${id}: the clause it read is reported (${JSON.stringify(r.clause)})`);
  }
});

test('回归: 史尔特尔 / 维娜·维多利亚 / 山 / 空弦 / 斯卡蒂 的数值与改动前一致（各自的 kit 路径照旧）', () => {
  // 史尔特尔 AFT-X: 未阻挡敌人时 +8
  {
    const h = run({ defs: DEFS, units: [{ chessId: 'chess_char_5_07_b', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 9] }] });
    const u = h.unit('chess_char_5_07_b');
    mute(h, u);
    const as = u.def.traitBb.attack_speed;
    assert.equal(as, 8, '史尔特尔: trait.bb 上的 +8');
    h.run(1);
    assert.equal(u.blocking.length, 0, '未阻挡');
    assert.equal(u.s.aspd, u.base.aspd + as, '未阻挡: kit 的 +8');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
  // 维娜·维多利亚 AFT-X: 未阻挡敌人时 +8
  {
    const h = run({ defs: DEFS, units: [{ chessId: 'chess_char_6_07_b', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 9] }] });
    const u = h.unit('chess_char_6_07_b');
    mute(h, u);
    const as = u.def.traitBb.attack_speed;
    assert.equal(as, 8, '维娜·维多利亚: trait.bb 上的 +8');
    h.run(1);
    assert.equal(u.blocking.length, 0, '未阻挡');
    assert.equal(u.s.aspd, u.base.aspd + as, '未阻挡: kit 的 +8');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
  // 山 FGT-Y: 生命值高于 50% 时 +10
  {
    const h = board('chess_char_5_17_b');
    const u = h.unit('chess_char_5_17_b');
    mute(h, u);
    const as = u.def.traitBb.attack_speed;
    assert.equal(as, 10, '山: trait.bb 上的 +10');
    h.run(1);
    assert.ok(u.hpRatio > 0.5, 'full HP');
    assert.equal(u.s.aspd, u.base.aspd + as, 'HP > 50 %: kit 的 +10');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
  // 空弦 MAR-Y: 范围内存在地面敌人时 +8 —— 数值在隐藏天赋上（与圣约送葬人同一个来源），kit（shared/tier3.js groundAspd）负责
  {
    const h = board('chess_char_3_21_b');
    const u = h.unit('chess_char_3_21_b');
    mute(h, u);
    const as = (u.def.raw.talents ?? []).find((t) => t.index === -1)?.bb.attack_speed;
    assert.equal(as, 8, '空弦: MAR-Y 的 +8 在隐藏天赋 (index −1) 上');
    h.run(1);
    assert.equal(u.s.aspd, u.base.aspd + as, '地面敌人在范围内: kit 的 +8');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
  // 斯卡蒂 DRE-Y: 被击倒时不撤退 + 攻击速度 +30（kit 的 trait:skadi_tide）
  {
    const h = run({ defs: DEFS, units: [{ chessId: 'chess_char_3_05_b', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 9] }] });
    const u = h.unit('chess_char_3_05_b');
    mute(h, u);
    const as = u.def.traitBb.attack_speed;
    assert.equal(as, 30, '斯卡蒂: trait.bb 上的 +30');
    h.run(0.5);
    assert.equal(u.s.aspd, u.base.aspd, 'before the lethal blow');
    h.b.dealDamage(null, u, { type: 'true', amount: 1e9 });
    h.step();
    assert.equal(u.alive, true, 'DRE-Y 不撤退');
    assert.ok(u.findBuff('trait:skadi_tide'), 'kit 的复活 buff');
    assert.equal(u.s.aspd, u.base.aspd + as, '复活后 +30（只有 kit 这一份）');
    assert.equal(u.findBuff(TRAIT_ASPD_BUFF), null, 'engine 未接管');
    done(h);
  }
});

// =================================================================================================================
// 3. the rule itself: what it reads, and that it installs nothing when unsure

test('规则解析: 条件子句 + 取值被显式报出；读不出条件 / 不认识的形状 → 什么都不装', () => {
  const def = ds.getChess('chess_char_5_01_b', { moduleId: 'uniequip_003_excu2' });
  const r = traitAttackSpeedRule(def);
  assert.equal(r.value, 12);
  assert.equal(r.reason, 'ok');
  assert.equal(r.clause, '攻击范围内存在2名及以上敌人时');
  assert.equal(typeof r.condition, 'function');
  assert.equal(plainText(r.source), '攻击范围内存在2名及以上敌人时攻击速度+12');
  assert.equal(conditionClause(r.source), '攻击范围内存在2名及以上敌人时');

  // a line whose 「攻击速度」 comes first is unconditional → no clause → nothing installed (never a permanent stat)
  const tail = { ...def, raw: { ...def.raw, trait: { desc: '攻击速度+9，攻击力+1%', bb: { attack_speed: 9 } } } };
  const rt = traitAttackSpeedRule(tail);
  assert.equal(rt.value, 9);
  assert.equal(rt.reason, 'no-text', 'no condition clause → refused');
  assert.equal(rt.clause, '');
  assert.equal(rt.source, null);
  assert.equal(rt.condition, null, 'the engine installs nothing');

  // an unknown clause shape
  const odd = { ...def, raw: { ...def.raw, trait: { desc: '心情好的时候攻击速度+9', bb: { attack_speed: 9 } } } };
  const ro = traitAttackSpeedRule(odd);
  assert.equal(ro.value, 9);
  assert.equal(ro.reason, 'unknown');
  assert.equal(ro.condition, null, 'an unrecognised condition never becomes a permanent stat');

  // no trait attack-speed line at all
  assert.equal(traitAttackSpeedRule(ds.getChess('chess_char_1_01_a')), null);
  assert.equal(traitAttackSpeedRule(null), null);
  // tokens are never touched
  assert.equal(installTraitAttackSpeed({}, { kind: 'token' }), null);
});

test('规则解析: 仇白 LOR-Y 同文案但数值写进具名天赋 —— 引擎连这条词条都看不到（她的 kit 负责，绝不二次加成）', () => {
  const def = ds.getChess('chess_char_6_15_b', { moduleId: 'uniequip_003_qiubai' });
  assert.equal(def.raw.trait.bb.attack_speed, undefined, 'trait.bb 上没有攻速');
  assert.deepEqual((def.raw.talents ?? []).filter((t) => t.index === -1), [], '也没有隐藏天赋');
  assert.equal(def.raw.talents[0].bb.attack_speed, 12, '数值在具名天赋 入隙 (index 0) 上');
  assert.equal(def.raw.talents[0].bb.cnt, 2, '连条件计数也一起');
  assert.equal(traitAttackSpeedRule(def), null, '引擎看不到 → 由 kits/ops/chess_char_6_15-qiubai.js 消费');
});

test('覆盖锁定: 全数据 266 个棋子 × 全部模组选择里，被引擎接管的只有那两条 REA-Y，其余全部显式拒绝（unknown = 0）', () => {
  const installed = [];
  const refused = [];
  const reasons = {};
  let scanned = 0;
  for (const id of ds.chessIds()) {
    const rec = ds.rawChess(id);
    if (!rec) continue;
    const choices = [null, ...(rec.modules || []).map((m) => ({ moduleId: m.uniEquipId })), { moduleId: 'none' }];
    for (const lo of choices) {
      let d;
      try { d = ds.getChess(id, lo); } catch { continue; }
      if (!d) continue;
      scanned++;
      const r = traitAttackSpeedRule(d);
      if (!r) continue;
      const tag = `${id}|${lo?.moduleId ?? 'default'}|${r.value}|${r.reason}`;
      if (r.condition) installed.push(tag);
      else { refused.push(tag); reasons[r.reason] = (reasons[r.reason] ?? 0) + 1; }
    }
  }
  assert.ok(scanned > 500, `the whole data set was scanned (${scanned} defs)`);
  assert.deepEqual(installed.sort(), [
    'chess_char_5_01_b|uniequip_003_excu2|12|ok',   // 圣约送葬人 REA-Y（数值在隐藏天赋上）
    'chess_char_5_06_b|uniequip_003_etlchi|12|ok',  // 隐德来希 REA-Y（数值在 trait.bb 上）
  ]);
  assert.deepEqual(Object.keys(reasons).sort(), ['kit', 'mode'], 'no silent gap — every refusal carries a known reason');
  assert.equal(reasons.unknown ?? 0, 0, 'nothing falls through as unknown');
  assert.ok((reasons.kit ?? 0) >= 13, `every other carrier is refused explicitly (${reasons.kit} kit)`);
  assert.equal(reasons.mode, 1, '集成战略专用的一条（水月 ISW-A）');
  assert.ok(refused.length >= 13, `refused lines (${refused.length})`);
  for (const t of refused) {
    assert.ok(/\|(kit|mode)$/.test(t), `refused with a known reason: ${t}`);
  }
  assert.ok(refused.some((t) => t.startsWith('chess_char_3_05_b|default|30|kit')), '斯卡蒂 DRE-Y is in the list');
  assert.ok(refused.some((t) => t.startsWith('chess_char_3_21_b|default|8|kit')), '空弦 MAR-Y is in the list');
  assert.ok(refused.some((t) => t.startsWith('chess_char_4_09_b|uniequip_004_mizuki|50|mode')), '水月 ISW-A is in the list');
});
