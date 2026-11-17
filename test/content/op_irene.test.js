// test/content/op_irene.test.js — the 自选 operator kit of 艾丽妮 (char_4009_irene, 6★ 剑豪; kit
// server/sim/content/kits/ops/op-irene.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, SWO-Y
// “厚重的经卷”, SWO-X “审判官口粮” or ISW-A “艾丽妮特限证章” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from
// data/backups.json (the form of that slot status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_irene.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const IRENE = 'char_4009_irene';
const FORMS = BACKUPS.units[IRENE].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const SWOY = 'uniequip_002_irene', SWOX = 'uniequip_003_irene', ISWA = 'uniequip_004_irene';
const S1 = 'skchr_irene_1', S2 = 'skchr_irene_2', S3 = 'skchr_irene_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_def: dummy('enemy_def', { def: 400 }), enemy_fly_def: dummy('enemy_fly_def', { motion: 'FLY', def: 400 }),
  enemy_heavy: dummy('enemy_heavy', { mass: 4 }), enemy_fly_weak: dummy('enemy_fly_weak', { motion: 'FLY', hp: 2000 }),
  enemy_frail: dummy('enemy_frail', { hp: 1000 }), enemy_weak2k: dummy('enemy_weak2k', { hp: 2000 }), enemy_sea: { ...dummy('enemy_sea'), tags: ['seamonster'] },
};
/** Every 自选 form: [tier, elite, module]. */
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, SWOY, SWOX, ISWA].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
const skillMulOf = (elite, mod) => (elite && mod === SWOX ? 1.1 : 1);
/** 审判之火's DEF share ignored in a form (SWO-X stage 3: 55 %). */
const penOf = (tier, elite, mod) => (elite && mod === SWOX && tier === 6 ? 0.55 : 0.5);

/** A battle with 艾丽妮 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 },
    hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'attack'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: IRENE, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const hitsBy = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u);
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('艾丽妮 in every 自选 form: her operator kit (all three skills authored), the form\'s stats + module attributes, 1-1 range, blocks 2, two hits per attack, melee ground-only, 无 core bond (emptyShip), no 特质', () => {
  assert.equal(OPERATOR_KITS[IRENE], KITS[IRENE]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [IRENE, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.aspd],
        [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0), 100 + (m?.attr.aspd ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.hits, u.profile.dmgType, u.base.bat], [2, 'melee', false, 2, 'phys', 1.3], `${label(f)}: 剑豪`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target her`);
      assert.deepEqual(u.def.raw.tokens, [], `${label(f)}: no summons`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN, full potential): E2 Lv1 2201 / 507 / 282, E2 Lv60 2688 / 598 / 326; SWO-Y +50 / +35 → +65 / +50
  // ATK / DEF, SWO-X +50 ATK +5 ASPD → +80 / +7, ISW-A +240 HP +40 ATK → +300 / +65
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [2201, 507, 2688, 598]);
  assert.deepEqual([SWOY, SWOX, ISWA].map((m) => [modOf(5, m).attr, modOf(6, m).attr]),
    [[{ atk: 50, def: 35 }, { atk: 65, def: 50 }], [{ atk: 50, aspd: 5 }, { atk: 80, aspd: 7 }], [{ maxHp: 240, atk: 40 }, { maxHp: 300, atk: 65 }]]);
});

test('a 自选 pick: 艾丽妮 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks (ISW-A, a 集成战略 module, is refused)', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(IRENE));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(IRENE), `tier ${t}`);
  assert.equal(validateDiyPicks({ [SLOT[5]]: { charId: IRENE, skillIndex: 1, uniEquipId: ISWA } }, { data, kitted: KITTED_CHARS }).error, 'BAD_TARGET',
    'a 集成战略 module (ISW-A) is not a 自选 choice (shared/diy.js, W5K)');
  assert.deepEqual(validateDiyPicks({ [SLOT[5]]: { charId: IRENE, skillIndex: 1, uniEquipId: SWOX } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[5]]: { charId: IRENE, skillIndex: 1, uniEquipId: SWOX } } });
});

test('T1 审判之火 vs an air unit: every physical instance ignores 50 % (SWO-X stage 3: 55 %) of its DEF with no random draw; a levitated enemy is an air unit; arts untouched', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    const pen = penOf(tier, elite, mod), flat = elite && mod === SWOY ? 70 : 0;
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb;
    assert.deepEqual([t0.prob, t0.def_penetrate], [0.5, pen], `${label(f)}: the data`);
    const fly = h.spawn('enemy_fly_def', { pos: [9, 8] });
    for (let i = 0; i < 20; i++) {
      const st = h.b.rng.state();
      approx(h.b.dealDamage(u, fly, { amount: 1000, type: 'phys' }), 1000 - Math.max(0, 400 - flat) * (1 - pen), `${label(f)}: air #${i}`);
      assert.equal(h.b.rng.state(), st, `${label(f)}: no random draw against an air unit`);
    }
    const g = h.spawn('enemy_def', { pos: [9, 9] });
    h.b.applyStatus(g, 'levitate', { duration: 5, source: u });
    assert.ok(g.isFlying, 'levitated = an air unit');
    for (let i = 0; i < 5; i++) approx(h.b.dealDamage(u, g, { amount: 1000, type: 'phys' }), 1000 - Math.max(0, 400 - flat) * (1 - pen), `${label(f)}: levitated #${i}`);
    const st = h.b.rng.state();
    approx(h.b.dealDamage(u, fly, { amount: 1000, type: 'arts' }), 1000, `${label(f)}: arts (RES 0)`);
    assert.equal(h.b.rng.state(), st, `${label(f)}: arts draws nothing`);
    done(h);
  }
});

test('T1 审判之火 vs a ground enemy: one draw per physical instance at 50 %; a won charge is spent only by an instance that lands — a dodged one keeps it and the next lands pierced without a draw', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, SWOX], [6, true, ISWA]]) {
    const { h, u } = field({ tier, elite, mod, skill: 2, seed: 17 });
    const pen = penOf(tier, elite, mod);
    const g = h.spawn('enemy_def', { pos: [9, 9] });
    let pierced = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const st = h.b.rng.state();
      const d = h.b.dealDamage(u, g, { amount: 1000, type: 'phys' });
      assert.notEqual(h.b.rng.state(), st, 'a draw per ground instance (no charge held)');
      if (Math.abs(d - (1000 - 400 * (1 - pen))) < 1e-6) pierced++;
      else approx(d, 600, 'or no pierce');
    }
    assert.ok(pierced > 0.4 * N && pierced < 0.6 * N, `${pierced} / ${N} pierced ≈ 50 %`);
    // a charge drawn against a flyer that dodges is kept: the next ground instance lands pierced and draws nothing
    const fly = h.spawn('enemy_fly_def', { pos: [9, 8] });
    h.b.addBuff(fly, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    assert.equal(h.b.dealDamage(u, fly, { amount: 1000, type: 'phys' }), 0, 'dodged');
    assert.equal(u.mem.ireneCharge, true, 'the charge is kept');
    const st = h.b.rng.state();
    approx(h.b.dealDamage(u, g, { amount: 1000, type: 'phys' }), 1000 - 400 * (1 - pen), 'pierced');
    assert.equal(h.b.rng.state(), st, 'no draw while a charge is held');
    assert.equal(u.mem.ireneCharge, false, 'spent');
    // a held charge does not outlive her deployment (a buff on her)
    assert.equal(h.b.dealDamage(u, fly, { amount: 1000, type: 'phys' }), 0, 'dodged again');
    assert.equal(u.mem.ireneCharge, true, 'held');
    h.b.retreat(u);
    h.b.redeploy(u);
    assert.ok(u.alive && u.deployed, 'redeployed');
    assert.equal(u.mem.ireneCharge, false, 'a new deployment holds no charge');
    done(h);
  }
});

test('T2 净化之剑: ASPD +21 (SWO-Y stage 3: ATK +5 % too), doubled while a 【海怪】 enemy is on the field', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    const y3 = elite && mod === SWOY && tier === 6;
    const atk = y3 ? 0.05 : 0;
    approx(u.s.aspd, u.base.aspd + 21, `${label(f)}: ASPD +21`);
    approx(u.s.atk, u.base.atk * (1 + atk), `${label(f)}: ATK`);
    const sea = h.spawn('enemy_sea', { pos: [9, 9] });
    h.step();
    approx(u.s.aspd, u.base.aspd + 42, `${label(f)}: ×2 with a 海怪 on the field`);
    approx(u.s.atk, u.base.atk * (1 + 2 * atk), `${label(f)}: ATK ×2`);
    h.b.kill(sea, null);
    h.step();
    approx(u.s.aspd, u.base.aspd + 21, `${label(f)}: back once it is gone`);
    done(h);
  }
});

test('S1 起风 (AUTO, attack SP 6 / 5, data DEFAULT): the next attack hits its target for 130 % / 160 % ATK, levitates it 1 s, then hits it again for 130 % / 160 % — an air unit by then, so 审判之火 always pierces', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, null], [5, true, SWOX], [6, true, SWOY]]) {
    const sk = skillOf(tier, elite, S1), mul = skillMulOf(elite, mod), pen = penOf(tier, elite, mod), flat = elite && mod === SWOY ? 70 : 0;
    const lb = `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    assert.deepEqual([u.skill.rule, u.skill.spType, u.skill.spCost, sk.initSp, sk.bb.atk_scale, sk.bb.levitate], ['DEFAULT', 'attack', elite ? 5 : 6, 0, elite ? 1.6 : 1.3, 1], lb);
    u.skill.gainSp(999);
    const e = h.spawn('enemy_def', { pos: [10, 6] });
    assert.ok(h.runUntil(() => u.skill.activations === 1 && hitsBy(h, u).length >= 2, 3), `${lb}: cast on her next attack`);
    const [a, b] = hitsBy(h, u);
    assert.deepEqual([a.target, b.target, a.dmg.attackId === b.dmg.attackId, a.dmg.isSkill, b.dmg.isSkill, a.type, b.type], [e, e, true, true, true, 'phys', 'phys'], lb);
    const A = u.s.atk * sk.bb.atk_scale;
    const raw = (p) => (A - Math.max(0, 400 - flat) * (1 - p)) * mul;
    assert.ok([raw(0), raw(pen)].some((v) => Math.abs(v - a.amount) < 1e-6), `${lb}: the first strike (${a.amount})`);
    approx(b.amount, raw(pen), `${lb}: the second on the levitated target, pierced`);
    const lev = h.hooksOf('statusApplied').find((c) => c.source === u && c.status === 'levitate');
    assert.ok(lev && lev.target === e && Math.abs(lev.duration - 1) < 1e-9, `${lb}: levitate 1 s`);
    assert.equal(hitsBy(h, u).length, 2, `${lb}: two hits in all`);
    done(h);
  }
  // 浮空 rules: a 重量 > 3 target floats half as long (engine)
  const { h, u } = field({ tier: 6, elite: true, skill: 0 });
  u.skill.gainSp(999);
  const heavy = h.spawn('enemy_heavy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.activations === 1, 3));
  h.step();
  const lev = h.hooksOf('statusApplied').find((c) => c.source === u && c.status === 'levitate');
  assert.ok(lev && lev.target === heavy && Math.abs(lev.duration - 0.5) < 1e-9, 'half on a heavy target');
  done(h);
});

test('S2 裂潮 (MANUAL, 2 charges, data SKILL_RANGE on 3-12): not opened with only a flyer in range; up to 5 / 6 ground enemies there take 310 % / 340 % ATK, those of 重量 ≤ 3 float 2 / 3 s; the second charge ≥ 3 s later', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, null], [6, true, SWOX]]) {
    const sk = skillOf(tier, elite, S2), mul = skillMulOf(elite, mod), lb = `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    assert.deepEqual([u.skill.rule, u.skill.kind, u.skill.maxCharges, u.skill.spCost, sk.initSp, sk.bb.atk_scale, sk.bb.max_target, sk.bb.levitate, sk.bb.value, sk.rangeId],
      ['SKILL_RANGE', 'charges', 2, elite ? 10 : 11, 0, elite ? 3.4 : 3.1, elite ? 6 : 5, elite ? 3 : 2, 3, '3-12'], lb);
    assert.deepEqual(u.skill.triggerGrid, sk.rangeGrid, `${lb}: the trigger grid is the skill range`);
    u.skill.gainSp(999);
    assert.equal(u.skill.charges, 2, lb);
    const fly = h.spawn('enemy_fly', { pos: [10, 7] });
    h.run(1.5);
    assert.equal(u.skill.activations, 0, `${lb}: a flyer alone does not open it (地面敌人 only)`);
    const light = h.spawn('enemy_dummy', { pos: [10, 8] }), heavy = h.spawn('enemy_heavy', { pos: [9, 6] });
    const out = h.spawn('enemy_dummy', { pos: [10, 9] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), `${lb}: opened`);
    const hit = hitsBy(h, u);
    assert.deepEqual([...new Set(hit.map((c) => c.target))].sort((a, b) => a.id - b.id), [light, heavy].sort((a, b) => a.id - b.id), `${lb}: the ground enemies of 3-12`);
    for (const c of hit) { approx(c.amount, u.s.atk * sk.bb.atk_scale * mul, `${lb}: ${sk.bb.atk_scale * 100} %`); assert.deepEqual([c.type, c.dmg.isSkill], ['phys', true]); }
    assert.ok(!hit.some((c) => c.target === fly || c.target === out), `${lb}: no flyer, nothing outside`);
    const lev = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'levitate');
    assert.deepEqual(lev.map((c) => [c.target, c.duration]), [[light, sk.bb.levitate]], `${lb}: only the light one floats (重量 ≤ 3)`);
    assert.equal(u.skill.charges, 1, `${lb}: one charge left`);
    const t1 = u.skill.lastStart;
    assert.ok(h.runUntil(() => u.skill.activations === 2, 5), `${lb}: the second charge`);
    assert.ok(u.skill.lastStart - t1 >= 3 - 1e-9, `${lb}: 3 s apart (automatic operation cooldown)`);
    done(h);
  }
  // seven ground enemies: max_target of them
  const sk = skillOf(5, false, S2);
  const { h, u } = field({ tier: 5, skill: 1 });
  u.skill.gainSp(999);
  for (const pos of [[11, 5], [11, 6], [10, 6], [10, 7], [10, 8], [9, 5], [9, 6]]) h.spawn('enemy_dummy', { pos });
  assert.ok(h.runUntil(() => u.skill.activations === 1, 1));
  assert.equal(new Set(hitsBy(h, u).filter((c) => c.dmg.isSkill).map((c) => c.target)).size, sk.bb.max_target, `${sk.bb.max_target} of 7`);
  done(h);
});

test('S3 判决 (MANUAL, data SKILL_RANGE on x-1): every ground enemy of x-1 takes 250 % ATK and floats 2 / 3 s, then 10 bombardments every 0.3 s on a random enemy of x-1, radius 1.1 (air too) at 200 % / 230 %; 3.5 s, no normal attack', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, null], [6, true, SWOX]]) {
    const sk = skillOf(tier, elite, S3), mul = skillMulOf(elite, mod), lb = `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    assert.deepEqual([u.skill.rule, u.skill.spCost, u.skill.sp, sk.bb.atk_scale, sk.bb.levitate, sk.bb.multi_atk_scale, sk.bb.multi_times, sk.bb.multi_hit_interval, sk.rangeId],
      ['SKILL_RANGE', elite ? 30 : 32, elite ? 16 : 8, 2.5, elite ? 3 : 2, elite ? 2.3 : 2, 10, 0.3, 'x-1'], lb);
    assert.deepEqual(u.skill.triggerGrid, sk.rangeGrid, `${lb}: the trigger grid is the skill range`);
    u.skill.gainSp(999);
    const a = h.spawn('enemy_dummy', { pos: [10, 7] }); // in x-1
    const b = h.spawn('enemy_dummy', { pos: [10, 8] }); // outside x-1, 1 tile from a
    const c = h.spawn('enemy_dummy', { pos: [10, 9] }); // 2 tiles from a
    assert.ok(h.runUntil(() => u.skill.active, 1), `${lb}: opened`);
    const t0 = u.skill.lastStart;
    h.runUntil(() => !u.skill.active, 5);
    approx(h.b.time - t0, 3.5, `${lb}: 3.5 s`, 0.02);
    const hit = hitsBy(h, u);
    const opening = hit.filter((x) => Math.abs(x.t - t0) < 1e-6);
    assert.deepEqual(opening.map((x) => x.target), [a], `${lb}: the opening strike on x-1's ground enemies only`);
    approx(opening[0].amount, u.s.atk * sk.bb.atk_scale * mul, `${lb}: 250 %`);
    const lev = h.hooksOf('statusApplied').find((x) => x.source === u && x.status === 'levitate');
    assert.deepEqual([lev.target, lev.duration], [a, sk.bb.levitate], `${lb}: floats`);
    const bomb = hit.filter((x) => x.t > t0 + 1e-6);
    assert.equal(bomb.filter((x) => x.target === a).length, 10, `${lb}: 10 bombardments on the only enemy of x-1 (an air unit by then)`);
    assert.equal(bomb.filter((x) => x.target === b).length, 10, `${lb}: each also hits within 1.1 (outside x-1 too)`);
    assert.ok(!bomb.some((x) => x.target === c), `${lb}: nothing farther than 1.1`);
    for (const x of bomb) approx(x.amount, u.s.atk * sk.bb.multi_atk_scale * mul, `${lb}: ${sk.bb.multi_atk_scale * 100} %`);
    const at = [...new Set(bomb.map((x) => Math.round((x.t - t0) * 30)))];
    assert.deepEqual(at, [9, 18, 27, 36, 45, 54, 63, 72, 81, 90], `${lb}: every 0.3 s (ticks)`);
    assert.ok(!h.hooksOf('attack').some((x) => x.attacker === u && x.t > t0 && x.t < t0 + 3.5), `${lb}: no normal attack meanwhile`);
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `${lb}: her range stays 1-1`);
    done(h);
  }
  // opened with only a flyer in range (PRTS 备注), the bombardments reach it
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  u.skill.gainSp(999);
  const fly = h.spawn('enemy_fly', { pos: [9, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 1), 'a flyer alone opens it');
  h.runUntil(() => !u.skill.active, 5);
  assert.equal(hitsBy(h, u).filter((x) => x.target === fly).length, 10, 'ten bombardments on the flyer');
  done(h);
});

test('SWO-X stage 3 审判之火: an air unit knocked out during her skill gives 6 SP once the skill ends — a levitated one too — not at stage 1, not a ground kill, not without the module', () => {
  for (const [tier, elite, mod] of [[6, true, SWOX], [5, true, SWOX], [6, true, SWOY], [6, false, null]]) {
    const lb = `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
    const sp = elite && mod === SWOX && tier === 6 ? 6 : 0;
    if (sp) assert.equal(formOf(6, true).modules.find((m) => m.uniEquipId === SWOX).talentChanges[0].bb.sp, 6);
    // a flyer (the bombardments); a ground enemy the opening strike levitates and the bombardments finish (an air unit when
    // it falls); a ground enemy the opening strike itself knocks out (before it floats)
    for (const [key, pos, air] of [['enemy_fly_weak', [9, 6], true], ['enemy_weak2k', [10, 7], true], ['enemy_frail', [10, 7], false]]) {
      const { h, u } = field({ tier, elite, mod, skill: 2 });
      u.skill.gainSp(999);
      const e = h.spawn(key, { pos });
      assert.ok(h.runUntil(() => u.skill.active, 1), `${lb} ${key}: opened`);
      h.runUntil(() => !u.skill.active, 5);
      h.step();
      assert.ok(!e.alive, `${lb} ${key}: knocked out during the skill`);
      assert.equal(e.isFlying, air, `${lb} ${key}: an air unit when it fell`);
      approx(u.skill.sp, air ? sp : 0, `${lb} ${key}: SP after the skill`);
      done(h);
    }
  }
});

test('modules: SWO-X skill damage ×1.1, normal attacks unchanged; SWO-Y ignores 70 DEF (stages 1 and 3); ISW-A only its attributes (集成战略-only parts: no deploy SP, 50 % / 50 %)', () => {
  for (const f of FORMS_ALL.filter(([, elite]) => elite)) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    assert.equal(u.s.defIgnoreFlat, mod === SWOY ? 70 : 0, `${label(f)}: SWO-Y`);
    if (mod === SWOX) assert.deepEqual(u.def.raw.trait.bb, { damage_scale: 1.1, value: 0.1 });
    if (mod === ISWA) {
      assert.match(u.def.raw.trait.moduleDesc, /集成战略/);
      assert.equal(u.skill.sp, skillOf(tier, elite, S2).initSp, `${label(f)}: no 部署后立即获得8点技力 here`);
      assert.equal(u.base.respawnTime, formOf(tier, elite).stats.respawnTime, `${label(f)}: no 再部署时间-60%`);
      const t0 = u.def.raw.talents.find((t) => t.index === 0);
      assert.deepEqual([t0.bb.prob, t0.bb.def_penetrate], [0.5, 0.5], `${label(f)}: 审判之火 unchanged`);
    }
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => hitsBy(h, u).length >= 2, 3));
    approx(hitsBy(h, u)[0].amount, u.s.atk, `${label(f)}: a normal hit (DEF 0)`);
    u.skill.gainSp(999);
    const n0 = hitsBy(h, u).length;
    assert.ok(h.runUntil(() => u.skill.activations === 1, 4));
    const cut = hitsBy(h, u).slice(n0).find((c) => c.dmg.isSkill && c.target === e);
    approx(cut.amount, u.s.atk * skillOf(tier, elite, S2).bb.atk_scale * skillMulOf(elite, mod), `${label(f)}: S2`);
    done(h);
  }
});
