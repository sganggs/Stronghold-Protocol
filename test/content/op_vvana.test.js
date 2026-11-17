// test/content/op_vvana.test.js — the 自选 operator kit of 薇薇安娜 (char_4098_vvana, 6★ 术战者; kit
// server/sim/content/kits/ops/op-vvana.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in every
// form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, AFT-D 目不能及之处 or
// AFT-Y “最后一行” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from data/backups.json (the form of that slot
// status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_vvana.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { sortEnemyTargets } from '../../server/sim/targeting.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const VVANA = 'char_4098_vvana';
const FORMS = BACKUPS.units[VVANA].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const AFTD = 'uniequip_002_vvana', AFTY = 'uniequip_003_vvana';
const S1 = 'skchr_vvana_1', S2 = 'skchr_vvana_2', S3 = 'skchr_vvana_3';
const SHIELD = 'talent:vvana:shield', CANDLE = 'talent:vvana:candle';
const RANGE_3_2 = [[0, 0], [0, 1], [0, 2], [0, 3]];
/** The unit form of a slot (tier, normal / elite). */
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_elite: dummy('enemy_elite', { rank: 'ELITE' }),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e9, speed: 0.6, mass: 0 }),
  enemy_brute: enemyRec({ key: 'enemy_brute', hp: 1e9, speed: 0.6, mass: 0, atk: 500, bat: 1 }),
  enemy_shooter: dummy('enemy_shooter', { atk: 300, range: 3, bat: 1 }),
};
/** Every 自选 form: [tier, elite, module]. */
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, AFTD, AFTY].map((m) => [t, true, m]))];

/** A battle with 薇薇安娜 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'hit', 'block', 'skillStart', 'skillEnd', 'statusApplied'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: VVANA, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
const byAttack = (hits) => { const m = new Map(); for (const c of hits) { const k = c.dmg.attackId; if (!m.has(k)) m.set(k, []); m.get(k).push(c); } return [...m.values()]; };
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
const keysOf = (u, grid) => grid.map(([dr, dc]) => (u.tileR + dr) * 21 + u.tileC + dc).sort((a, b) => a - b);

test('薇薇安娜 in every 自选 form: her operator kit (all three skills authored), the form\'s stats + module attributes, 1-1 range, blocks 1, melee arts ground-only, 卡西米尔, no 特质', () => {
  assert.equal(OPERATOR_KITS[VVANA], KITS[VVANA]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [VVANA, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0), form.stats.res], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.dmgType, u.profile.canHitFly, u.base.bat], [1, 'melee', 'arts', false, 1.25], `${label(f)}: 术战者`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['kazimierzShip'], []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target her`);
      done(h);
    }
  }
  // zh_CN, full potential: E2 Lv1 2219 / 551 / 371, E2 Lv60 2684 / 633 / 421; AFT-D +240 / +30 → +420 / +60 HP / ATK, AFT-Y +240 / +30 / +30 → +300 / +45 / +45
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [2219, 551, 2684, 633]);
  assert.deepEqual([modOf(5, AFTD).attr, modOf(6, AFTD).attr, modOf(5, AFTY).attr, modOf(6, AFTY).attr], [{ maxHp: 240, atk: 30 }, { maxHp: 420, atk: 60 }, { maxHp: 240, atk: 30, def: 30 }, { maxHp: 300, atk: 45, def: 45 }]);
});

test('a 自选 pick: 薇薇安娜 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(VVANA));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(VVANA), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: VVANA, skillIndex: 2, uniEquipId: AFTY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: VVANA, skillIndex: 2, uniEquipId: AFTY } } });
});

test('S1 光影迅捷剑 (AUTO, DEFAULT, 2 charges): with one charge the next attack hits twice at 155 % / 170 % ATK (arts) and spends one charge; the range stays 1-1', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.rule, u.skill.maxCharges, u.skill.spCost, sk.initSp, sk.bb.atk_scale], ['DEFAULT', 2, elite ? 4 : 5, 0, elite ? 1.7 : 1.55], `T${tier}`);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    const fly = h.spawn('enemy_fly', { pos: [10, 6] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, sk.spCost + 2), `T${tier}: cast once a charge is stored`);
    assert.equal(h.hooksOf('damaged').filter((c) => c.target === fly).length, 0, `T${tier}: a melee 术战者 never hits the flyer`);
    h.run(0.1);
    const skillAtk = byAttack(atkHits(h, u).filter((c) => c.dmg.isSkill));
    assert.equal(skillAtk.length, 1, `T${tier}: one skill attack`);
    assert.equal(skillAtk[0].length, 2, `T${tier}: 连续攻击两次`);
    for (const c of skillAtk[0]) {
      assert.deepEqual([c.target, c.type], [e, 'arts'], `T${tier}: the target, arts`);
      approx(c.amount, u.s.atk * sk.bb.atk_scale * 1.09, `T${tier}: ${sk.bb.atk_scale * 100} % ATK (× 燃烛施明 1.09)`);
    }
    assert.ok(u.skill.charges < 1 && !u.mem.vvanaCharged, `T${tier}: one charge spent, no 蓄力`);
    assert.deepEqual(u.liveRangeGrid, [[0, 0], [0, 1]], `T${tier}: 1-1`);
    // plain attacks hit once at 100 %
    const plain = byAttack(atkHits(h, u).filter((c) => !c.dmg.isSkill));
    assert.ok(plain.length > 0 && plain.every((a) => a.length === 1), `T${tier}: plain attacks hit once`);
    done(h);
  }
});

test('S1 蓄力: both charges stored ⇒ the 3-2 range (card and trigger), the cast spends every charge and hits three times from 3 tiles away; the range is 1-1 again after it', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    h.run(sk.spCost * 2 - 0.5);
    assert.equal(u.skill.charges, 1, `T${tier}: one charge after ${sk.spCost * 2 - 0.5} s`);
    assert.deepEqual(u.liveRangeGrid, [[0, 0], [0, 1]], `T${tier}: not yet`);
    h.run(0.6);
    assert.equal(u.skill.charges, 2, `T${tier}: both charges`);
    assert.deepEqual(u.liveRangeGrid, RANGE_3_2, `T${tier}: 蓄力 — 3-2`);
    assert.deepEqual([...u.baseRangeKeys].sort((a, b) => a - b), keysOf(u, RANGE_3_2), `T${tier}: the DEFAULT trigger range follows`);
    const e = h.spawn('enemy_dummy', { pos: [10, 8] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 2), `T${tier}: cast on the enemy 3 tiles ahead`);
    h.step();
    const skillAtk = byAttack(atkHits(h, u).filter((c) => c.dmg.isSkill));
    assert.equal(skillAtk.length, 1);
    assert.equal(skillAtk[0].length, 3, `T${tier}: 改为连续攻击三次`);
    for (const c of skillAtk[0]) { assert.equal(c.target, e); approx(c.amount, u.s.atk * sk.bb.atk_scale * 1.09, `T${tier}: ${sk.bb.atk_scale * 100} %`); }
    assert.ok(u.skill.charges === 0 && u.skill.sp < 0.2, `T${tier}: 任何时候开启均消耗全部技力 (${u.skill.charges} / ${u.skill.sp})`);
    assert.deepEqual(u.liveRangeGrid, [[0, 0], [0, 1]], `T${tier}: 蓄力 over with the skill`);
    const n = atkHits(h, u).length;
    h.run(3);
    assert.equal(atkHits(h, u).length, n, `T${tier}: the enemy 3 tiles ahead is out of her 1-1 again`);
    done(h);
  }
});

test('S1 蓄力 mode stays until the next end of the skill: silenced with both charges she attacks with the 3-2 range (plain attacks); a redeploy clears it', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0 });
  h.run(9);
  assert.equal(u.skill.charges, 2);
  h.b.applyStatus(u, 'silence', { duration: 4, source: null });
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.run(3);
  const hits = atkHits(h, u).filter((c) => c.target === e);
  assert.ok(hits.length >= 2 && hits.every((c) => !c.dmg.isSkill), `plain attacks from the 3-2 range: ${hits.length}`);
  assert.deepEqual(u.liveRangeGrid, RANGE_3_2);
  h.b.retreat(u);
  h.b.redeploy(u);
  h.step();
  assert.deepEqual([u.liveRangeGrid, !!u.mem.vvanaCharged], [[[0, 0], [0, 1]], false], 'a new deployment: 1-1, SP from 0');
  done(h);
});

test('S2 烛燃影息 (MANUAL, DEFAULT): 28 / 30 s, ATK +20 / 30 %, DEF +80 / 110 %, block 2, every attack hits all she blocks; 20 % double hits at 130 / 140 % that steal 25 / 30 ASPD (capped), given back at the end', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, AFTD]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, mod, skill: 1, row: 9, col: 5, seed: 13 });
    assert.deepEqual([u.skill.rule, sk.duration, sk.bb.atk, sk.bb.def, sk.bb.block_cnt, sk.bb['attack@prob_twice'], sk.bb['attack@atk_scale_twice'], sk.bb['attack@steal_atk_speed'], sk.bb['attack@steal_atk_speed_max']],
      ['DEFAULT', elite ? 30 : 28, elite ? 0.3 : 0.2, elite ? 1.1 : 0.8, 1, 0.2, elite ? 1.4 : 1.3, elite ? 30 : 25, elite ? 30 : 25], `T${tier}`);
    h.spawn('enemy_walk', { routeIndex: 0 });
    h.spawn('enemy_walk', { routeIndex: 0, time: 0 });
    assert.ok(h.runUntil(() => u.blocking.length === 1, 30), `T${tier}: blocks one`);
    h.run(2);
    assert.equal(u.blocking.length, 1, `T${tier}: block 1 before the skill`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 3), `T${tier}: cast with an enemy blocked`);
    approx(u.skill.timeLeft, sk.duration, `T${tier}: ${sk.duration} s`, 0.01);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    approx(u.s.def, u.base.def * (1 + sk.bb.def), `T${tier}: DEF`);
    assert.ok(h.runUntil(() => u.blocking.length === 2, 10), `T${tier}: block 2 (阻挡数+1)`);
    const n0 = atkHits(h, u).length;
    u.skill.extend(300);
    h.run(300);
    const attacks = byAttack(atkHits(h, u).slice(n0));
    const both = attacks.filter((a) => new Set(a.map((c) => c.target)).size === 2);
    assert.ok(both.length > attacks.length * 0.9, `T${tier}: ${both.length} / ${attacks.length} attacks hit both blocked enemies`);
    const twice = attacks.filter((a) => a.length === 4);
    const once = attacks.filter((a) => a.length === 2);
    assert.equal(twice.length + once.length, attacks.length, `T${tier}: one or two hits per target`);
    const rate = twice.length / attacks.length;
    assert.ok(rate > 0.13 && rate < 0.27, `T${tier}: double hits ${twice.length} / ${attacks.length} ≈ 20 %`);
    for (const c of once[0]) approx(c.amount, u.s.atk * 1.09, `T${tier}: a plain hit 100 %`, 1e-3);
    for (const c of twice[0]) approx(c.amount, u.s.atk * sk.bb['attack@atk_scale_twice'] * 1.09, `T${tier}: a double hit ${sk.bb['attack@atk_scale_twice'] * 100} %`, 1e-3);
    // 偷取: capped on both sides
    const steal = sk.bb['attack@steal_atk_speed'];
    assert.equal(u.findBuff('skill:vvana:loot')?.mods.aspd, steal, `T${tier}: her +${steal} ASPD (max ${steal})`);
    for (const e of u.blocking) assert.equal(e.findBuff('skill:vvana:stolen')?.mods.aspd, -steal, `T${tier}: each target −${steal}`);
    approx(u.s.aspd, 100 + steal, `T${tier}: her ASPD`);
    const victims = u.blocking.slice();
    u.skill.end('test');
    assert.equal(u.findBuff('skill:vvana:loot'), null, `T${tier}: given back at the end`);
    for (const e of victims) assert.equal(e.findBuff('skill:vvana:stolen'), null, `T${tier}: the enemies get theirs back`);
    approx(u.s.atk, u.base.atk, `T${tier}: ATK back`);
    done(h);
  }
});

test('S3 “明灭” (MANUAL, DEFAULT): 15 s, interval 1.25 + 0.5 s, ATK / DEF / RES up, double hits, 1-1; from the second cast of a deployment 25 s, triple hits on 3-2, elite / leader enemies first; a redeploy counts again', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u } = field({ tier, elite, skill: 2, seed: 3 });
    assert.deepEqual([u.skill.rule, sk.duration, sk.bb.base_attack_time, sk.bb.atk, sk.bb.def, sk.bb.magic_resistance, sk.bb.enhance_duration, sk.bb.talent_scale, sk.rangeId],
      ['DEFAULT', 15, 0.5, elite ? 0.75 : 0.55, elite ? 0.6 : 0.4, elite ? 20 : 15, 25, elite ? 2 : 1.8, '1-1'], `T${tier}`);
    u.skill.gainSp(999);
    h.run(2);
    assert.equal(u.skill.activations, 0, `T${tier}: no enemy, no cast`);
    const front = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => u.skill.active, 3), `T${tier}: cast with an enemy in her range`);
    approx(u.skill.timeLeft, 15, `T${tier}: 15 s`, 0.01);
    approx(u.s.interval, 1.75, `T${tier}: 攻击间隔延长(+0.5)`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    approx(u.s.def, u.base.def * (1 + sk.bb.def), `T${tier}: DEF`);
    approx(u.s.res, u.base.res + sk.bb.magic_resistance, `T${tier}: RES`);
    assert.deepEqual(u.liveRangeGrid, [[0, 0], [0, 1]], `T${tier}: the first cast keeps 1-1`);
    const n0 = atkHits(h, u).length;
    h.runUntil(() => !u.skill.active, 20);
    const first = byAttack(atkHits(h, u).slice(n0).filter((c) => c.dmg.isSkill));
    assert.ok(first.length >= 7 && first.every((a) => a.length === 2), `T${tier}: ${first.length} double hits`);
    approx(u.s.interval, 1.25, `T${tier}: interval back`);
    // the second cast: 25 s, 3-2, triple hits, the elite first
    h.b.kill(front, null);
    const normal = h.spawn('enemy_dummy', { pos: [10, 7] });
    const eliteE = h.spawn('enemy_elite', { pos: [10, 8] });
    assert.deepEqual(sortEnemyTargets(h.b, u, [eliteE, normal], null).map((e) => e.defId), ['enemy_dummy', 'enemy_elite'], `T${tier}: her usual order takes the one nearer the goal`);
    assert.deepEqual(sortEnemyTargets(h.b, u, [normal, eliteE], 'elite').map((e) => e.defId), ['enemy_elite', 'enemy_dummy'], `T${tier}: the 'elite' priority (targeting.js)`);
    u.skill.gainSp(999);
    u.skill.activate('test');
    approx(u.skill.timeLeft, 25, `T${tier}: 持续时间延长至25秒`, 0.01);
    assert.deepEqual(u.liveRangeGrid, RANGE_3_2, `T${tier}: 3-2 while it runs`);
    const n1 = atkHits(h, u).length;
    h.run(10);
    const second = byAttack(atkHits(h, u).slice(n1).filter((c) => c.dmg.isSkill));
    assert.ok(second.length >= 5 && second.every((a) => a.length === 3 && a.every((c) => c.target === eliteE)), `T${tier}: triple hits on the elite (${second.length})`);
    h.runUntil(() => !u.skill.active, 20);
    assert.deepEqual(u.liveRangeGrid, [[0, 0], [0, 1]], `T${tier}: 1-1 after it`);
    // a new deployment counts from one again
    h.b.retreat(u);
    h.b.redeploy(u);
    h.step();
    u.skill.gainSp(999);
    u.skill.activate('test');
    assert.deepEqual([Math.round(u.skill.timeLeft), u.liveRangeGrid], [15, [[0, 0], [0, 1]]], `T${tier}: the first cast of the new deployment`);
    done(h);
  }
});

test('T1 燃烛施明: arts dealt ×1.09, physical / arts taken ×0.91 — ×1.18 / ×0.82 while an elite / leader enemy is in her range; AFT-D stage 3: 9 % (18 %) of her attack damage as 灼燃损伤', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb;
    assert.deepEqual([t0.damage_scale_m, t0.damage_resistance_pm, t0.super_scale], [0.09, 0.09, 2], label(f));
    assert.deepEqual(u.findBuff(CANDLE)?.mods, { artsDealtMul: 1.09, physTakenMul: 0.91, artsTakenMul: 0.91 }, `${label(f)}: no elite`);
    const taken = (type) => { const hp = u.hp; h.b.dealDamage(null, u, { amount: 1000, type }); const d = hp - u.hp; u.hp = u.s.maxHp; return d; };
    approx(taken('arts'), 1000 * (1 - u.s.res / 100) * 0.91, `${label(f)}: arts taken −9 %`);
    approx(taken('true'), 1000, `${label(f)}: true damage untouched`);
    const el = h.spawn('enemy_elite', { pos: [10, 6] });
    h.step();
    approx(taken('arts'), 1000 * (1 - u.s.res / 100) * 0.82, `${label(f)}: −18 % with the elite in her range`);
    const m = u.findBuff(CANDLE).mods;
    approx(m.artsDealtMul, 1.18, `${label(f)}: elite in range — arts dealt`);
    approx(m.physTakenMul, 0.82, `${label(f)}: phys taken`);
    approx(m.artsTakenMul, 0.82, `${label(f)}: arts taken`);
    const ep = elite && tier === 6 && mod === AFTD ? 0.09 : 0;
    assert.equal(t0.ep_damage_ratio_m ?? 0, ep, `${label(f)}: the AFT-D stage-3 灼燃损伤`);
    h.run(1.3);
    const hit = atkHits(h, u).find((c) => c.target === el);
    assert.ok(hit, `${label(f)}: she hits the elite`);
    approx(el.elem.burn, ep * 2 * atkHits(h, u).filter((c) => c.target === el).reduce((s, c) => s + c.amount, 0), `${label(f)}: 灼燃损伤 ×2 next to an elite`);
    h.b.kill(el, null);
    h.step();
    approx(u.findBuff(CANDLE).mods.artsDealtMul, 1.09, `${label(f)}: back without the elite`);
    if (ep) {
      const e = h.spawn('enemy_dummy', { pos: [10, 6] });
      h.run(1.3);
      approx(e.elem.burn, ep * atkHits(h, u).filter((c) => c.target === e).reduce((s, c) => s + c.amount, 0), `${label(f)}: 9 % next to no elite`);
    }
    done(h);
  }
});

test('T2 散华: hits on elite / leader enemies give a 护盾 layer at 20 % (AFT-Y stage 3: 27 %, 2 layers; × talent_scale while S3 runs) — only on elites, never above the cap', () => {
  const rateOf = (tier, elite, mod, s3) => {
    const { h, u } = field({ tier, elite, mod, skill: s3 ? 2 : 1, seed: 21 });
    if (!s3) h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; });
    const el = h.spawn('enemy_elite', { pos: [10, 6] });
    if (s3) { u.skill.gainSp(999); u.skill.activate('test'); u.skill.extend(600); }
    let gains = 0, rolls = 0;
    const cap = mod === AFTY && tier === 6 ? 2 : 1;
    h.b.on('damaged', (c) => {
      if (c.source !== u || c.target !== el || !c.dmg.isAttack) return;
      rolls++;
      const n = u.findBuff(SHIELD)?.data.n ?? 0;
      assert.ok(n <= cap, `never above ${cap}`);
      if (n > 0) { gains++; h.b.removeBuff(u, SHIELD); }
    }, { priority: -100 });
    h.run(400);
    done(h);
    return gains / rolls;
  };
  for (const [tier, elite, mod, p] of [[5, false, null, 0.2], [6, true, AFTY, 0.27], [5, true, AFTY, 0.2]]) {
    const r = rateOf(tier, elite, mod, false);
    assert.ok(Math.abs(r - p) < 0.06, `T${tier} ${mod ?? 'none'}: ${r.toFixed(3)} ≈ ${p}`);
  }
  for (const [tier, elite, mod, p] of [[5, false, null, 0.2 * 1.8], [6, true, AFTY, 0.27 * 2]]) {
    const r = rateOf(tier, elite, mod, true);
    assert.ok(Math.abs(r - p) < 0.08, `T${tier} ${mod ?? 'none'} under S3: ${r.toFixed(3)} ≈ ${p}`);
  }
  // a normal enemy gives none; AFT-Y stage 3 holds two layers
  const { h, u } = field({ tier: 6, elite: true, mod: AFTY, skill: 1, seed: 2 });
  h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.run(60);
  assert.equal(u.findBuff(SHIELD), null, 'no layer from a normal enemy');
  h.b.kill(e, null);
  h.spawn('enemy_elite', { pos: [10, 6] });
  assert.ok(h.runUntil(() => (u.findBuff(SHIELD)?.data.n ?? 0) === 2, 120), 'two layers (AFT-Y stage 3)');
  h.run(30);
  assert.equal(u.findBuff(SHIELD).data.n, 2, 'no third');
  done(h);
});

test('T2 散华\'s 护盾 negates one whole enemy melee-path damage per layer — not an enemy shot that flew as a projectile, not 无来源 damage', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: AFTY, skill: 1, seed: 4 });
  h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; });
  const el = h.spawn('enemy_elite', { pos: [10, 6] });
  assert.ok(h.runUntil(() => (u.findBuff(SHIELD)?.data.n ?? 0) === 2, 120), 'two layers');
  h.b.kill(el, null);
  const brute = h.spawn('enemy_dummy', { pos: [11, 9] });
  const hp0 = u.hp;
  // a projectile-borne hit and a 无来源 one pass
  assert.ok(h.b.dealDamage(brute, u, { amount: 300, type: 'phys', isAttack: true, isProjectile: true }) > 0, 'a projectile hit lands');
  assert.ok(h.b.dealDamage(brute, u, { amount: 300, type: 'true', sourceless: true }) > 0, 'a 无来源 hit lands');
  assert.equal(u.findBuff(SHIELD).data.n, 2, 'both layers kept');
  // a melee-path hit (an attack or an ability) is negated whole, one layer each
  const hp1 = u.hp;
  assert.equal(h.b.dealDamage(brute, u, { amount: 5000, type: 'phys', isAttack: true }), 0, 'a melee attack: negated');
  assert.equal(u.findBuff(SHIELD).data.n, 1);
  assert.equal(h.b.dealDamage(brute, u, { amount: 5000, type: 'arts' }), 0, 'a melee-path ability: negated');
  assert.equal(u.findBuff(SHIELD), null, 'no layer left');
  assert.equal(u.hp, hp1, 'no HP lost to them');
  assert.ok(h.b.dealDamage(brute, u, { amount: 300, type: 'phys', isAttack: true }) > 0, 'without a layer the hit lands');
  assert.ok(u.hp < hp0);
  done(h);
});

test('T2 散华 in battle: an enemy shooter\'s projectile (ai.js: DamageInfo isProjectile) never spends a layer; a blocked brute\'s blow does', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: AFTY, skill: 1, row: 9, col: 5, seed: 4 });
  h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; });
  const el = h.spawn('enemy_elite', { pos: [9, 6] });
  assert.ok(h.runUntil(() => (u.findBuff(SHIELD)?.data.n ?? 0) === 2, 120), 'two layers');
  h.b.kill(el, null);
  const shooter = h.spawn('enemy_shooter', { pos: [11, 6] });
  const hits0 = h.hooksOf('hit').length;
  assert.ok(h.runUntil(() => h.hooksOf('hit').slice(hits0).some((c) => c.source === shooter && c.target === u), 10), 'the shooter hits her');
  const shot = h.hooksOf('hit').slice(hits0).find((c) => c.source === shooter && c.target === u);
  assert.deepEqual([shot.dmg.isProjectile, shot.dmg.cancel], [true, false], 'a projectile, not negated');
  assert.equal(u.findBuff(SHIELD).data.n, 2, 'the layers stay');
  h.b.kill(shooter, null);
  h.spawn('enemy_brute', { routeIndex: 0 });
  assert.ok(h.runUntil(() => (u.findBuff(SHIELD)?.data.n ?? 0) < 2, 60), 'the brute\'s blow spends one');
  const blow = h.hooksOf('hit').filter((c) => c.source?.defId === 'enemy_brute' && c.target === u)[0];
  assert.equal(blow.dmg.isProjectile, false, 'a melee blow');
  assert.ok(h.hooksOf('block').some(c => c.source?.defId === 'enemy_brute' && c.target === u), 'the ordered shield blocks it');
  done(h);
});

test('T2 uses explicit damage route across all HP types, independently of projectile marker and kill credit', () => {
  for (const type of ['phys', 'arts', 'true', 'elemental']) {
    const { h, u } = field({ tier: 6, elite: true, mod: AFTY });
    const e = h.spawn('enemy_elite', { pos: [11, 9] });
    h.b.rng.chance = () => true;
    for (let i = 0; i < 2; i++) h.b.dealDamage({ source: u, target: e, amount: 1, type: 'true' });
    assert.equal(u.findBuff(SHIELD).data.n, 2);
    h.b.dealDamage({ source: null, credit: e, target: u, amount: 1, type, applyWay: 'MELEE' });
    h.b.dealDamage({ source: e, target: u, amount: 1, type, applyWay: 'RANGED', isProjectile: false });
    h.b.dealHPLose({ source: e, target: u, amount: 1 });
    h.b.dealElementDamage({ source: e, target: u, amount: 1, element: 'burn' });
    assert.equal(u.findBuff(SHIELD).data.n, 2, 'unqualified source/route and non-HP-damage paths preserve layers');
    assert.equal(h.b.dealDamage({ source: e, target: u, amount: 100, type, applyWay: 'MELEE', isProjectile: true }), 0);
    assert.equal(u.findBuff(SHIELD).data.n, 1);
    assert.ok(h.hooksOf('block').some(c => c.target === u && c.dmg.type === type));
    done(h);
  }
});

test('T2 layers keep their acquisition position when replenished, and earlier dodge preserves them', () => {
  for (const earlier of [true, false]) {
    const { h, u } = field({ tier: 6, elite: true, mod: AFTY });
    const e = h.spawn('enemy_elite', { pos: [11, 9] });
    h.b.rng.chance = () => true;
    const dodge = () => h.b.addBuff(u, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    if (earlier) dodge();
    h.b.dealDamage({ source: u, target: e, amount: 1, type: 'true' });
    const shield = u.findBuff(SHIELD), seq = shield.seq;
    if (!earlier) dodge();
    h.b.dealDamage({ source: u, target: e, amount: 1, type: 'true' });
    assert.equal(u.findBuff(SHIELD), shield);
    assert.equal(shield.seq, seq);
    let rolls = 0;
    h.b.rng = () => { rolls++; return 0; };
    assert.equal(h.b.dealDamage({ source: e, target: u, amount: 100, type: 'phys' }), 0);
    assert.equal(rolls, earlier ? 1 : 0);
    assert.equal(shield.data.n, earlier ? 2 : 1);
    done(h);
  }
});

test('AFT-D 目不能及之处 trait: her damage on an enemy in its 灼燃 爆发冷却 is followed by 15 % ATK 元素伤害 (stages 1 and 3) — once per instance, never otherwise', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 1, seed: 8 });
    h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; });
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(3);
    const rider = () => h.hooksOf('damaged').filter((c) => c.source === u && c.type === 'elemental');
    assert.equal(rider().length, 0, `${label(f)}: no rider without a burst`);
    h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 2000 });
    assert.ok(e.findBuff('burnBurst'), `${label(f)}: 灼燃 burst`);
    const n0 = atkHits(h, u).length;
    h.run(4);
    const hits = atkHits(h, u).slice(n0);
    const aftd = elite && mod === AFTD;
    assert.equal(rider().length, aftd ? hits.length : 0, `${label(f)}: one rider per hit (${hits.length})`);
    if (aftd) {
      assert.equal(u.def.raw.trait.bb.ep_damage_ratio, 0.15);
      for (const c of rider()) approx(c.amount, u.s.atk * 0.15, `${label(f)}: 15 % ATK 元素伤害`);
    }
    done(h);
  }
});

test('AFT-Y “最后一行” trait: the enemies she blocks take 10 % 法术脆弱 (her arts hits ×1.1); not an enemy she does not block, none without the module', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 1, row: 9, col: 5, seed: 6 });
    h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; });
    const far = h.spawn('enemy_dummy', { pos: [10, 6] });
    const w = h.spawn('enemy_walk', { routeIndex: 0 });
    assert.ok(h.runUntil(() => u.blocking.includes(w), 30), `${label(f)}: blocks the walker`);
    h.run(0.5);
    const afty = elite && mod === AFTY;
    const fv = w.findBuff('artsFragile')?.data?.value ?? null;
    if (afty) approx(fv, 0.1, `${label(f)}: 法术脆弱 on the blocked one`); else assert.equal(fv, null, `${label(f)}: no 法术脆弱`);
    assert.equal(far.findBuff('artsFragile'), null, `${label(f)}: none on the unblocked one`);
    if (afty) {
      const n0 = atkHits(h, u).length;
      h.run(2);
      const c = atkHits(h, u).slice(n0).find((x) => x.target === w);
      approx(c.amount, u.s.atk * 1.09 * 1.1, `${label(f)}: ×1.1 arts`);
    }
    done(h);
  }
});
