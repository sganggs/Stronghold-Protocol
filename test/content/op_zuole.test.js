// test/content/op_zuole.test.js — the 自选 operator kit of 左乐 (char_4121_zuole, 6★ 武者; kit
// server/sim/content/kits/ops/op-zuole.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, SBL-X
// “岂苦夜长” or SBL-Y “秉烛人的记录” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from data/backups.json
// (the form of that slot status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_zuole.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deploymentOf } from '../../server/sim/content/items/battle.js';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const ZUOLE = 'char_4121_zuole';
const FORMS = BACKUPS.units[ZUOLE].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const SBLX = 'uniequip_002_zuole', SBLY = 'uniequip_003_zuole';
const S1 = 'skchr_zuole_1', S2 = 'skchr_zuole_2', S3 = 'skchr_zuole_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e9, speed: 0.6, mass: 0 }),
};
/** Every 自选 form: [tier, elite, module]. */
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, SBLX, SBLY].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/** A battle with 左乐 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 2, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'heal', 'skillStart', 'skillEnd', 'statusApplied', 'fatal'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: ZUOLE, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const hitsBy = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.target?.side === 'enemy');
const healsOf = (h, u) => h.hooksOf('heal').filter((c) => c.target === u);
/** Keep 守正自明 / 坚忍 SP out of the way: no SP of any kind (阻回). */
const noSp = (h, u) => h.b.addBuff(u, { key: 'test:noSp', flags: { noSp: true }, duration: Infinity });
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('左乐 in every 自选 form: his operator kit (all three skills authored), the form\'s stats + module attributes, 1-1 range, blocks 1, melee ground-only, 炎, no 特质; 武者: no heal from others, 70 HP per enemy hit', () => {
  assert.equal(OPERATOR_KITS[ZUOLE], KITS[ZUOLE]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [ZUOLE, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.profile.noHeal, u.profile.selfHeal, u.base.bat], [1, 'melee', false, 'phys', true, 70, 1.2], `${label(f)}: 武者`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['yanShip'], []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth && !u.s.flags.untargetable, `${label(f)}: ground enemies target him`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN): E2 Lv1 2893 / 673 / 267, E2 Lv60 3533 / 761 / 299; SBL-X +55 / +40 → +90 / +60
  // ATK / DEF, SBL-Y +300 / +60 → +380 / +84 HP / ATK
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [2893, 673, 3533, 761]);
  assert.deepEqual([modOf(5, SBLX).attr, modOf(6, SBLX).attr, modOf(5, SBLY).attr, modOf(6, SBLY).attr], [{ atk: 55, def: 40 }, { atk: 90, def: 60 }, { maxHp: 300, atk: 60 }, { maxHp: 380, atk: 84 }]);
});

test('a 自选 pick: 左乐 is offered at tiers 5 and 6 (he has a kit) and a roster with him passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(ZUOLE));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(ZUOLE), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[5]]: { charId: ZUOLE, skillIndex: 1, uniEquipId: SBLX } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[5]]: { charId: ZUOLE, skillIndex: 1, uniEquipId: SBLX } } });
});

test('trait (武者): +70 HP on every enemy hit, none from another unit\'s heal', () => {
  const { h, u } = field({ tier: 5, elite: true, skill: 1 });
  noSp(h, u);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.hp = u.s.maxHp * 0.6;
  const hp0 = u.hp;
  h.runUntil(() => hitsBy(h, u).length >= 3, 6);
  approx(u.hp - hp0, 70 * hitsBy(h, u).length, 'one heal of 70 per hit');
  assert.equal(h.b.heal(e, u, 500), 0, 'no heal from another unit');
  done(h);
});

test('S1 破虏 (AUTO, 2 charges, data DEFAULT): the next attack at 145 % / 160 %; below 80 % HP one more strike, below 50 % two more — each a damage instance of its own (and a trait heal)', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    assert.deepEqual([sk.skillType, sk.spType, sk.spCost, sk.initSp, sk.maxChargeTime, sk.bb.atk_scale, sk.bb.hp_ratio_double, sk.bb.hp_ratio_tripple],
      ['AUTO', 'INCREASE_WITH_TIME', elite ? 5 : 6, elite ? 4 : 2, 2, elite ? 1.6 : 1.45, 0.8, 0.5], `T${tier}`);
    for (const [ratio, strikes] of [[1, 1], [0.79, 2], [0.49, 3]]) {
      const { h, u } = field({ tier, elite, skill: 0 });
      assert.deepEqual([u.skill.rule, u.skill.maxCharges], ['DEFAULT', 2], `T${tier}`);
      noSp(h, u);
      u.skill.sp = 0;
      u.skill.charges = 1;
      u.hp = u.s.maxHp * ratio;
      const e = h.spawn('enemy_dummy', { pos: [10, 6] });
      assert.ok(h.runUntil(() => u.skill.activations === 1, 2), `T${tier}: cast`);
      h.step();
      const sk1 = hitsBy(h, u).filter((c) => c.dmg.isSkill);
      assert.equal(sk1.length, strikes, `T${tier} at ${ratio * 100} % HP: ${strikes} strike(s)`);
      for (const c of sk1) {
        assert.equal(c.target, e);
        approx(c.amount, u.s.atk * sk.bb.atk_scale, `T${tier}: ${sk.bb.atk_scale * 100} %`);
        assert.equal(c.type, 'phys');
      }
      assert.equal(healsOf(h, u).filter((c) => c.opts?.self && !c.opts?.tags).length, strikes, `T${tier}: a trait heal per strike`);
      done(h);
    }
  }
});

test('S2 行险 (MANUAL, 12 s, data DEFAULT): −50 % current HP (never below 1), a barrier of 75 % / 90 % max HP stacking to 2× max HP, ATK +110 % / +140 %, block 2, every blocked enemy struck; once over the barrier loses 200 per second', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, skill: 1, row: 9 });
    assert.deepEqual([u.skill.rule, sk.duration, sk.spCost, sk.initSp, sk.bb.atk, sk.bb.hp_ratio, sk.bb.scale, sk.bb.block_cnt, sk.bb.max_scale, sk.bb.shield_decrease],
      ['DEFAULT', 12, elite ? 24 : 27, elite ? 10 : 5, elite ? 1.4 : 1.1, 0.5, elite ? 0.9 : 0.75, 1, 2, -200], `T${tier}`);
    noSp(h, u);
    const max = u.s.maxHp;
    const a = h.spawn('enemy_dummy', { pos: [9, 5] }), b = h.spawn('enemy_dummy', { pos: [9, 5] });
    h.step();
    assert.equal(u.blocking.length, 1, `T${tier}: blocks 1`);
    const hpAtStart = [];
    h.b.on('skillStart', (c) => { if (c.unit === u) hpAtStart.push(u.hp); });
    u.skill.charges = 1;
    assert.ok(h.runUntil(() => u.skill.active, 3), `T${tier}: cast`);
    approx(hpAtStart[0], max * 0.5, `T${tier}: −50 % of the current HP`);
    const bar = () => u.findBuff('skill:zuole:barrier2');
    approx(bar().shield, max * sk.bb.scale, `T${tier}: barrier ${sk.bb.scale * 100} % max HP`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    h.step();
    assert.deepEqual([u.s.blockCnt, u.blocking.length], [2, 2], `T${tier}: block +1`);
    const n0 = hitsBy(h, u).length;
    h.runUntil(() => hitsBy(h, u).length > n0, 3);
    const atk = hitsBy(h, u).slice(n0);
    assert.deepEqual(new Set(atk.map((c) => c.target)), new Set([a, b]), `T${tier}: both blocked enemies at once`);
    // the barrier absorbs damage; it stays put while the skill runs
    const hpBefore = u.hp;
    h.b.dealDamage(a, u, { amount: 1000, type: 'true' });
    approx(bar().shield, max * sk.bb.scale - 1000, `T${tier}: absorbed`);
    approx(u.hp, hpBefore, `T${tier}: HP untouched`);
    const left = bar().shield;
    h.runUntil(() => !u.skill.active, 13);
    approx(bar().shield, left, `T${tier}: no decay during the skill`);
    h.run(3.05);
    approx(bar().shield, left - 600, `T${tier}: −200 per second once over`, 1e-3);
    // a second cast stacks onto what is left, capped at 2× max HP; the 流失 never goes below 1 HP
    u.hp = 1;
    const before = bar().shield;
    u.skill.charges = 1;
    assert.ok(h.runUntil(() => u.skill.active, 5), `T${tier}: second cast`);
    assert.equal(hpAtStart[1], 1, `T${tier}: at 1 HP nothing is lost`);
    const diff = bar().shield - before, add = max * sk.bb.scale;
    assert.ok(Math.abs(diff - add) < 1e-6 || Math.abs(diff - (add - 200)) < 1e-6, `T${tier}: stacked onto what was left (${diff} vs ${add}, a decay step at most in between)`);
    done(h);
  }
  // the cap: a cast on a barrier of 1.6× max HP stops at 2×
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  noSp(h, u);
  h.b.addBuff(u, { key: 'skill:zuole:barrier2', shield: u.s.maxHp * 1.6, data: { createdAt: 0 } });
  u.skill.charges = 1;
  h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 3));
  approx(u.findBuff('skill:zuole:barrier2').shield, u.s.maxHp * 2, 'capped at 2× max HP');
  done(h);
});

test('S3 佑序有炎 (MANUAL, data SKILL_RANGE on 3-2): 7 slashes on ≤ 3 enemies of the 3-2 (air too) at 205 % / 220 %, the last ×2 and 晕眩 3.5 / 4 s; meanwhile no trait heal — every hit adds 70 × 2.5 / 3 to a barrier (≤ 2× max HP, 15 s from the last gain)', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u } = field({ tier, elite, skill: 2 });
    assert.deepEqual([u.skill.rule, sk.rangeId, sk.spCost, sk.initSp, sk.bb.atk_scale, sk.bb.times, sk.bb.stun, sk.bb.last_atk_bonus, sk.bb.shield_scale, sk.bb.shield_duration, sk.bb.max_scale],
      ['SKILL_RANGE', '3-2', elite ? 28 : 29, elite ? 6 : 3, elite ? 2.2 : 2.05, 7, elite ? 4 : 3.5, 2, elite ? 3 : 2.5, 15, 2], `T${tier}`);
    assert.deepEqual(u.skill.triggerGrid, [[0, 0], [0, 1], [0, 2], [0, 3]], `T${tier}: its 3-2`);
    noSp(h, u);
    u.hp = u.s.maxHp * 0.6;
    const hp0 = u.hp;
    let hpAtEnd = null;
    h.b.on('skillEnd', (c) => { if (c.unit === u && hpAtEnd == null) hpAtEnd = u.hp; });
    u.skill.charges = 1;
    h.run(1);
    assert.equal(u.skill.activations, 0, `T${tier}: no enemy on the 3-2, no cast`);
    const near = h.spawn('enemy_dummy', { pos: [10, 6] });
    const mid = h.spawn('enemy_fly', { pos: [10, 7] });
    const tip = h.spawn('enemy_dummy', { pos: [10, 8] });
    const fourth = h.spawn('enemy_dummy', { pos: [10, 8] });
    const beyond = h.spawn('enemy_dummy', { pos: [10, 9] });
    const side = h.spawn('enemy_dummy', { pos: [9, 6] });
    h.step();
    assert.equal(u.skill.activations, 1, `T${tier}: cast as soon as an enemy is on its 3-2`);
    const slashes = hitsBy(h, u).filter((c) => c.dmg.isSkill);
    assert.equal(slashes.length, 21, `T${tier}: 7 × 3`);
    const struck = new Set(slashes.map((c) => c.target));
    assert.equal(struck.size, 3, `T${tier}: the same three`);
    assert.ok(struck.has(near) && struck.has(mid), `T${tier}: the flyer too`);
    assert.ok(!struck.has(beyond) && !struck.has(side), `T${tier}: nothing off the 3-2`);
    assert.ok(struck.has(tip) !== struck.has(fourth), `T${tier}: one of the two on the tip (at most 3)`);
    const amt = u.s.atk * sk.bb.atk_scale;
    for (const [i, c] of slashes.entries()) approx(c.amount, amt * (i >= 18 ? 2 : 1), `T${tier}: slash ${Math.floor(i / 3) + 1}`);
    const stuns = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'stun');
    assert.equal(stuns.length, 3, `T${tier}: the last slash stuns`);
    for (const c of stuns) approx(c.duration, sk.bb.stun, `T${tier}: ${sk.bb.stun} s`);
    approx(hpAtEnd, hp0, `T${tier}: no trait heal during the slashes`);
    const bar = u.findBuff('skill:zuole:barrier3');
    approx(bar.shield, 21 * 70 * sk.bb.shield_scale, `T${tier}: 21 × 70 × ${sk.bb.shield_scale}`);
    approx(bar.timeLeft, 15, `T${tier}: 15 s`, 0.01);
    // afterwards the trait heals again; the barrier lasts 15 s from its last gain
    h.runUntil(() => hitsBy(h, u).some((c) => !c.dmg.isSkill), 3);
    assert.ok(u.hp > hp0, `T${tier}: the trait heals again`);
    h.run(15);
    assert.equal(u.findBuff('skill:zuole:barrier3'), null, `T${tier}: gone 15 s later`);
    done(h);
  }
  // the cap: 2× max HP at each gain; each gain restarts the 15 s
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  noSp(h, u);
  h.b.addBuff(u, { key: 'skill:zuole:barrier3', shield: u.s.maxHp * 1.99, duration: 3, data: { createdAt: 0 } });
  u.skill.charges = 1;
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.step();
  const b = u.findBuff('skill:zuole:barrier3');
  approx(b.shield, u.s.maxHp * 2, 'capped at 2× max HP');
  approx(b.timeLeft, 15, 'restarted', 0.01);
  done(h);
});

test('T1 秉烛照影 (坚忍): ASPD up to +50 and SP recovery up to +2/s, linear in the HP lost, full at 70 % lost — SBL-X stage 3: +70 / +2.3 at 50 % lost (stage 1: unchanged)', () => {
  for (const f of [[5, false, null], [6, true, null], [5, true, SBLX], [6, true, SBLX], [6, true, SBLY]]) {
    const [tier, elite, mod] = f;
    const x3 = tier === 6 && mod === SBLX;
    const [as, sp, full] = x3 ? [70, 2.3, 0.5] : [50, 2, 0.3];
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb;
    assert.deepEqual([t0.min_attack_speed, t0.min_sp_recovery_per_sec, t0.min_hp_ratio], [as, sp, full], label(f));
    assert.deepEqual([u.s.aspd, u.s.spRecovery], [100, 1], `${label(f)}: full HP`);
    for (const ratio of [0.8, 0.6, full, 0.1]) {
      u.hp = u.s.maxHp * ratio;
      h.step();
      const k = Math.min(1, (1 - ratio) / (1 - full));
      approx(u.s.aspd, 100 + as * k, `${label(f)}: ASPD at ${ratio * 100} %`);
      approx(u.s.spRecovery, 1 + sp * k, `${label(f)}: SP recovery at ${ratio * 100} %`);
    }
    u.hp = u.s.maxHp;
    h.step();
    assert.deepEqual([u.s.aspd, u.s.spRecovery], [100, 1], `${label(f)}: back at full HP`);
    done(h);
  }
});

test('T2 守正自明: every damage he outputs rolls 23 % (75 % below half HP) for 1 SP — SBL-Y stage 3: 85 % below half and the instance ×1.2 on a success (stage 1: unchanged)', () => {
  for (const f of [[5, false, null], [5, true, SBLY], [6, true, SBLY]]) {
    const [tier, elite, mod] = f;
    const y3 = tier === 6 && mod === SBLY;
    const { h, u } = field({ tier, elite, mod, skill: 1, seed: 17 });
    const t1 = u.def.raw.talents.find((t) => t.index === 1).bb;
    assert.deepEqual([t1.prob_1, t1.prob_2, t1.hp_ratio, t1.sp, t1.atk_scale ?? 1], [0.23, y3 ? 0.85 : 0.75, 0.5, 1, y3 ? 1.2 : 1], label(f));
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    u.skill.spCostMul = 1e5;   // the skill never fills: every success is an spGain of its own
    for (const [ratio, prob] of [[0.9, 0.23], [0.3, y3 ? 0.85 : 0.75]]) {
      let gains = 0, rolls = 0, boosted = 0;
      const offG = h.b.on('spGain', (c) => { if (c.unit === u && c.reason === 'talent') gains++; });
      const offD = h.b.on('damaged', (c) => {
        if (c.source !== u || c.target !== e) return;
        rolls++;
        if (Math.abs(c.amount - u.s.atk * 1.2) < 1e-6) boosted++;
        u.hp = u.s.maxHp * ratio;   // keep the HP band
      });
      u.hp = u.s.maxHp * ratio;
      h.run(150);
      h.b.off(offG);
      h.b.off(offD);
      const rate = gains / rolls;
      assert.ok(Math.abs(rate - prob) < 0.08, `${label(f)} at ${ratio * 100} %: ${gains} / ${rolls} ≈ ${prob}`);
      assert.equal(boosted, y3 ? gains : 0, `${label(f)}: ×1.2 on each success`);
    }
    done(h);
  }
});

test('SBL-X (stages 1 and 3): 25 % 庇护 below 50 % HP — physical and arts, not true; none at or above 50 %; after 行险 the 庇护 comes back behind the barrier (it cuts only what passes it)', () => {
  for (const tier of [5, 6]) {
    const { h, u } = field({ tier, elite: true, mod: SBLX, skill: 1 });
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb;
    assert.deepEqual([t0.hp_ratio, t0.damage_resistance], [0.5, 0.25], `T${tier}`);
    noSp(h, u);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    const take = (amount, type) => { const hp = u.hp; h.b.dealDamage(e, u, { amount, type }); return hp - u.hp; };
    u.hp = u.s.maxHp * 0.6;
    approx(take(300, 'true'), 300, `T${tier}: above 50 %: nothing`);
    u.hp = u.s.maxHp * 0.4;
    approx(take(1000, 'phys'), Math.max(1000 - u.s.def, 50) * 0.75, `T${tier}: physical ×0.75`);
    approx(take(400, 'arts'), 400 * 0.75, `T${tier}: arts ×0.75`);
    approx(take(400, 'true'), 400, `T${tier}: true untouched`);
    // 行险: 庇护 reset for 0.1 s, then judged again — after the barrier
    u.hp = u.s.maxHp * 0.8;
    let hpAtStart = null;
    h.b.on('skillStart', (c) => { if (c.unit === u && hpAtStart == null) hpAtStart = u.hp; });
    u.skill.charges = 1;
    assert.ok(h.runUntil(() => u.skill.active, 3));
    approx(hpAtStart, u.s.maxHp * 0.4, `T${tier}: −50 %`);
    const bar = u.findBuff('skill:zuole:barrier2');
    const B = bar.shield;
    approx(take(1000, 'true'), 0, `T${tier}: inside 0.1 s the barrier takes it whole`);
    approx(bar.shield, B - 1000, `T${tier}: no 庇护 inside the 0.1 s`);
    h.run(0.2);
    bar.shield = 500;
    const hp = u.hp;
    take(1300, 'arts');
    approx(bar.shield, 0, `T${tier}: the barrier took 500 of the full 1300`);
    approx(hp - u.hp, 800 * 0.75, `T${tier}: 庇护 cut the 800 that passed`);
    done(h);
  }
  // without the module: no 庇护
  const { h, u } = field({ tier: 6, elite: true, mod: SBLY, skill: 1 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.hp = u.s.maxHp * 0.3;
  const hp = u.hp;
  h.b.dealDamage(e, u, { amount: 400, type: 'arts' });
  approx(hp - u.hp, 400, 'SBL-Y: no 庇护');
  done(h);
});

test('SBL-Y (stages 1 and 3): knocked out ⇒ he stays and heals 30 % max HP, once per deployment (again after a redeploy); not while a 不死 holds him; none without the module', () => {
  for (const tier of [5, 6]) {
    const { h, u } = field({ tier, elite: true, mod: SBLY, skill: 1 });
    assert.deepEqual(u.def.raw.trait.bb, { value: 70, hp_ratio: 0.3 }, `T${tier}`);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.b.dealDamage(e, u, { amount: 1e6, type: 'true' });
    assert.ok(u.alive, `T${tier}: not withdrawn`);
    approx(u.hp, u.s.maxHp * 0.3, `T${tier}: 30 % max HP`);
    h.b.dealDamage(e, u, { amount: 1e6, type: 'true' });
    assert.ok(!u.alive, `T${tier}: once per deployment`);
    h.b.redeploy(u);
    h.step();
    h.b.dealDamage(e, u, { amount: 1e6, type: 'true' });
    assert.ok(u.alive, `T${tier}: again after the redeploy`);
    // a running 不死 (坚固维式重锤's window) keeps him up instead
    h.b.redeploy(u);
    const r = field({ tier, elite: true, mod: SBLY, skill: 1 });
    r.u.mem.undyingAt = deploymentOf(r.u);
    r.u.mem.undyingUntil = r.h.b.time + 5;
    const hammer = r.h.b.on('fatal', (c) => { if (c.unit === r.u && !c.prevented) c.prevented = true; }, { priority: -99 });
    const f = r.h.spawn('enemy_dummy', { pos: [10, 6] });
    r.h.b.dealDamage(f, r.u, { amount: 1e6, type: 'true' });
    assert.ok(r.u.alive && r.u.hp < 2, `T${tier}: held by the 不死, the module untouched`);
    r.h.b.off(hammer);
    r.u.mem.undyingUntil = 0;
    r.h.b.dealDamage(f, r.u, { amount: 1e6, type: 'true' });
    assert.ok(r.u.alive, `T${tier}: the module still there afterwards`);
    approx(r.u.hp, r.u.s.maxHp * 0.3, `T${tier}: 30 % max HP`);
    done(h);
    done(r.h);
  }
  for (const mod of [null, SBLX]) {
    const { h, u } = field({ tier: 6, elite: true, mod, skill: 1 });
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.b.dealDamage(e, u, { amount: 1e6, type: 'true' });
    assert.ok(!u.alive, `${mod ?? 'no module'}: withdrawn`);
    done(h);
  }
});

for (const enhanced of [false, true]) for (const defense of ['none', 'dodge', 'count', 'full', 'partial']) {
  test(`native output timing: ${enhanced ? 'SBL-Y stage 3 calculation' : 'base T2 output'} and Musha heal precede ${defense}`, () => {
    const { h, u } = field({ tier: 6, elite: enhanced, mod: enhanced ? SBLY : null, skill: 1 });
    const b = h.b, e = h.spawn('enemy_dummy', { pos: [10, 6] });
    u.skill.spCostMul = 1e6;
    u.skill.sp = 0;
    u.hp = u.s.maxHp * 0.5 - 10;
    const hp = u.hp;
    let draws = 0;
    b.rng = Object.assign(() => { draws++; return 0.5; }, b.rng);
    b.rng.chance = p => b.rng() < p;
    if (defense === 'dodge') b.addBuff(e, { key: 'defense', injury(c) { c.dodge(); } });
    if (defense === 'count') b.addBuff(e, { key: 'defense', shieldHits: 1 });
    if (defense === 'full' || defense === 'partial') b.addBuff(e, { key: 'defense', shield: defense === 'full' ? 1000 : 40 });
    const seen = [];
    b.addBuff(e, { key: 'output-observer', observeInjury() { seen.push([u.hp, u.skill.sp]); } });
    const raw = enhanced ? 120 : 100;
    approx(b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' }),
      ['dodge', 'count', 'full'].includes(defense) ? 0 : raw - (defense === 'partial' ? 40 : 0), 'remaining damage');
    assert.equal(draws, 1, 'one talent roll before target defenses');
    assert.equal(u.skill.sp, 1, 'the low-HP chance was read before the trait heal crosses half HP');
    approx(u.hp, hp + 70, 'output heals even when target injury cancels');
    assert.deepEqual(seen, [[hp + 70, 1]], 'source effects precede target injury');
    done(h);
  });
}

for (const calculation of ['precomputed', 'resolved']) test(`SBL-Y stage 3 ${calculation} damage omits calculation-only chance but still heals on output`, () => {
  const { h, u } = field({ tier: 6, elite: true, mod: SBLY, skill: 1 });
  const b = h.b, e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.skill.spCostMul = 1e6;
  u.skill.sp = 0;
  u.hp = u.s.maxHp * 0.3;
  const hp = u.hp;
  let draws = 0;
  b.rng = Object.assign(() => { draws++; return 0; }, b.rng);
  b.rng.chance = p => b.rng() < p;
  approx(b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', calculation }), 100, 'not boosted');
  assert.equal(draws, 0);
  assert.equal(u.skill.sp, 0);
  approx(u.hp, hp + 70, 'output trait remains eligible');
  done(h);
});

test('Musha source output accepts BUFF damage; source-less credit, gauges, loss and early refusal trigger neither heal nor base T2', () => {
  const { h, u } = field({ skill: 1 });
  const b = h.b, e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.skill.spCostMul = 1e6;
  u.skill.sp = 0;
  u.hp = u.s.maxHp * 0.3;
  const hp = u.hp;
  let draws = 0;
  b.rng = Object.assign(() => { draws++; return 0; }, b.rng);
  b.rng.chance = p => b.rng() < p;
  b.dealDamage({ source: null, credit: u, target: e, amount: 100, type: 'phys' });
  b.dealDamage({ source: u, target: e, amount: 0, type: 'true' });
  b.dealElementDamage({ source: u, target: e, amount: 1, element: 'burn' });
  b.dealHPLose({ source: u, target: e, amount: 100 });
  b.addBuff(e, { key: 'invulnerability', flags: { invulnerable: true } });
  b.dealDamage({ source: u, target: e, amount: 100, type: 'true' });
  assert.equal(draws, 0);
  approx(u.hp, hp, 'no source output');
  assert.equal(u.skill.sp, 0);
  b.removeBuff(e, 'invulnerability');
  b.dealDamage({ source: u, target: e, amount: 100, type: 'true', attackType: 'BUFF', tags: ['talent', 'dot'] });
  assert.equal(draws, 1);
  assert.equal(u.skill.sp, 1);
  approx(u.hp, hp + 70, 'native trait has no BUFF exclusion');
  done(h);
});

test('S3 obtains and extends the same barrier before every dodged slash, without trait healing', () => {
  const { h, u } = field({ tier: 6, skill: 2 });
  const b = h.b, e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.atkCd = 999;
  u.skill.charges = 0;
  u.skill.sp = 0;
  h.step(); // Build the normal enemy range index before invoking the real S3 selector.
  u.hp = u.s.maxHp * 0.3;
  const hp = u.hp, add = 70 * u.skill.bb.shield_scale, pools = [];
  b.rng = Object.assign(() => 0.99, b.rng);
  b.rng.chance = p => b.rng() < p;
  b.addBuff(e, { key: 'guaranteed-dodge', injury(c) { c.dodge(); } });
  b.addBuff(e, { key: 'barrier-observer', observeInjury() {
    const barrier = u.findBuff('skill:zuole:barrier3');
    pools.push({ barrier, seq: barrier?.seq, amount: barrier?.shield });
  } });
  assert.ok(u.skill.activate('test', { free: true }));
  assert.equal(pools.length, 7, JSON.stringify(b.errors));
  for (const [i, pool] of pools.entries()) {
    assert.equal(pool.barrier, pools[0].barrier);
    assert.equal(pool.seq, pools[0].seq);
    approx(pool.amount, add * (i + 1), 'one barrier gain per output');
  }
  approx(u.hp, hp, 'S3 suppresses the trait heal');
  approx(e.hp, e.s.maxHp, 'every slash was dodged');
  done(h);
});
