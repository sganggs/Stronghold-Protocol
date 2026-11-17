// test/content/op_thorns.test.js — the 自选 operator kit of 棘刺 (char_293_thorns, 6★ 领主; kit
// server/sim/content/kits/ops/op-thorns.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, LOR-X
// “盐与沙” or LOR-Δ “沙蚀” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from data/backups.json (the form of
// that slot status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_thorns.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const THORNS = 'char_293_thorns';
const FORMS = BACKUPS.units[THORNS].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const LORX = 'uniequip_002_thorns', LORD = 'uniequip_003_thorns';
const S1 = 'skcom_atk_up[3]', S2 = 'skchr_thorns_2', S3 = 'skchr_thorns_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
/** Talent 0's blackboard of a form with its module (the module talent change merged over the base). */
const t0Of = (tier, elite, mod) => {
  const base = formOf(tier, elite).talents.find((t) => t.index === 0).bb;
  const ch = elite && mod ? modOf(tier, mod).talentChanges.find((t) => t.talentIndex === 0) : null;
  return { ...base, ...(ch?.bb ?? {}) };
};
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_ranged: dummy('enemy_ranged', { applyWay: 'RANGED' }),
  enemy_both: dummy('enemy_both', { applyWay: 'ALL' }),
  // a stationary ranged attacker: 100 ATK every second on whoever stands within 2.5
  enemy_shooter: dummy('enemy_shooter', { atk: 100, range: 2.5, bat: 1 }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, LORX, LORD].map((m) => [t, true, m]))];

/** A battle with 棘刺 as uid 1 at (row, col) facing RIGHT. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, seed = 5, others = [] } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'attack'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: THORNS, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const from = (h, u, pred = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && pred(c));
const tagged = (c, t) => (c.dmg?.tags || []).includes(t);
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

test('棘刺 in every 自选 form: his operator kit (all three skills authored), the form\'s stats + module attributes, 3-12, blocks 2, a 领主 hitting air, physical, no 特质, ground enemies can target him', () => {
  assert.equal(OPERATOR_KITS[THORNS], KITS[THORNS]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [THORNS, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.aspd], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def, 100 + (m?.attr.aspd ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.sub, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.base.bat, u.profile.rangedScale], [2, 'lord', 'ranged', true, 'phys', 1.3, 0.8], `${label(f)}: 领主`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-12`);
      assert.deepEqual([form.tokens, form.displayTokens, u.def.raw.tokens], [[], [], []], `${label(f)}: no summons`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target him`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN): E2 Lv1 2063 / 601 / 333, E2 Lv60 2427 / 691 / 379; LOR-X +160 / +39 / +5 → +260 / +55 / +7,
  // LOR-Δ +80 / +60 / +5 → +150 / +75 / +7 (HP / ATK / ASPD)
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [2063, 601, 2427, 691]);
  assert.deepEqual([modOf(5, LORX).attr, modOf(6, LORX).attr, modOf(5, LORD).attr, modOf(6, LORD).attr],
    [{ maxHp: 160, atk: 39, aspd: 5 }, { maxHp: 260, atk: 55, aspd: 7 }, { maxHp: 80, atk: 60, aspd: 5 }, { maxHp: 150, atk: 75, aspd: 7 }]);
});

test('a 自选 pick: 棘刺 is offered at tiers 5 and 6 (he has a kit) and a roster with him passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(THORNS));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(THORNS), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: THORNS, skillIndex: 2, uniEquipId: LORD } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: THORNS, skillIndex: 2, uniEquipId: LORD } } });
});

test('trait 领主: a ranged attack on an enemy two tiles ahead deals 80 % ATK, one on the tile in front 100 %; he hits a flyer', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const { h, u } = field({ tier, elite, skill: 0 });
    u.skill.sp = 0; // keep S1 off
    const far = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.runUntil(() => from(h, u, (c) => c.dmg.isAttack && c.target === far).length > 0, 5);
    approx(from(h, u, (c) => c.dmg.isAttack && c.target === far)[0].amount, u.s.atk * 0.8, `T${tier}: two tiles ahead`);
    h.b.kill(far, null);
    const near = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.runUntil(() => from(h, u, (c) => c.dmg.isAttack && c.target === near).length > 0, 5);
    approx(from(h, u, (c) => c.dmg.isAttack && c.target === near)[0].amount, u.s.atk, `T${tier}: the tile in front`);
    h.b.kill(near, null);
    const fly = h.spawn('enemy_fly', { pos: [11, 6] });
    assert.ok(h.runUntil(() => from(h, u, (c) => c.dmg.isAttack && c.target === fly).length > 0, 5), `T${tier}: a flyer`);
    done(h);
  }
});

test('S1 攻击力强化·γ型 (MANUAL, data DEFAULT): ATK +45 % / +60 % for 30 s with an enemy in range', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.rule, sk.duration, sk.bb.atk, u.skill.spCost, sk.initSp], ['DEFAULT', 30, elite ? 0.6 : 0.45, elite ? 35 : 37, elite ? 10 : 5], `T${tier}`);
    u.skill.gainSp(999);
    h.run(2);
    assert.equal(u.skill.activations, 0, `T${tier}: no enemy, no cast`);
    h.spawn('enemy_dummy', { pos: [10, 7] });
    assert.ok(h.runUntil(() => u.skill.active, 3), `T${tier}: cast`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    approx(u.skill.timeLeft, 30, `T${tier}: 30 s`, 0.01);
    h.runUntil(() => !u.skill.active, 31);
    approx(u.s.atk, u.base.atk, `T${tier}: back`);
    done(h);
  }
});

test('S2 护身尖刺 (MANUAL, 技能范围 3-1, data SKILL_RANGE): no attack, ATK / DEF up; an enemy\'s 普通伤害 sets off up to 4 spikes 0.5 s later on the 3-1 (air too) for 80 % ATK physical, at most every 0.8 / 0.75 s; his range stays 3-12', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, skill: 1 });
    assert.deepEqual([u.skill.rule, sk.rangeId, sk.duration, sk.bb.atk, sk.bb.def, sk.bb.cooldown, sk.bb.max_target],
      ['SKILL_RANGE', '3-1', elite ? 36 : 33, elite ? 0.4 : 0.3, elite ? 0.7 : 0.55, elite ? 0.75 : 0.8, 4], `T${tier}`);
    u.skill.gainSp(999);
    h.run(1);
    assert.equal(u.skill.activations, 0, `T${tier}: nobody on the 3-1`);
    // targets on the 3-1: (9,7) (11,7) (10,8) a flyer at (11,6); one outside it at (10,9)
    const shooter = h.spawn('enemy_shooter', { pos: [10, 7] });
    const a = h.spawn('enemy_dummy', { pos: [9, 7] }), b = h.spawn('enemy_dummy', { pos: [11, 7] });
    const fly = h.spawn('enemy_fly', { pos: [11, 6] }), out = h.spawn('enemy_dummy', { pos: [10, 9] });
    assert.ok(h.runUntil(() => u.skill.active, 2), `T${tier}: cast with an enemy on the 3-1`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    approx(u.s.def, u.base.def * (1 + sk.bb.def), `T${tier}: DEF`);
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `T${tier}: the card keeps his 3-12`);
    const n0 = from(h, u).length, cast = h.b.time;
    h.run(6);
    assert.equal(from(h, u, (c) => c.dmg.isAttack && c.t >= cast).length, 0, `T${tier}: 停止攻击`);
    const hurt = h.hooksOf('damaged').filter((c) => c.target === u && c.source === shooter);
    const spikes = from(h, u, (c) => tagged(c, 'thorns:spike')).filter((c) => from(h, u).indexOf(c) >= n0);
    assert.ok(hurt.length >= 4, `T${tier}: ${hurt.length} hits from the shooter`);
    // each shooter hit (1 s apart, cooldown < 1 s) ⇒ one volley of 4 spikes on the four nearest 3-1 enemies, 0.5 s later
    const volleys = new Map();
    for (const c of spikes) volleys.set(c.t, [...(volleys.get(c.t) ?? []), c]);
    assert.ok(volleys.size >= hurt.length - 1, `T${tier}: ${volleys.size} volleys for ${hurt.length} hits`);
    for (const [t, v] of volleys) {
      assert.equal(v.length, 4, `T${tier}: 4 spikes at ${t}`);
      assert.ok(v.every((c) => c.target !== out), `T${tier}: (10,9) is off the 3-1`);
      for (const c of v) { approx(c.amount, u.s.atk * 0.8, `T${tier}: 80 % ATK`); assert.deepEqual([c.type, c.dmg.isSkill, !!c.dmg.isAttack], ['phys', true, false]); }
      assert.ok(hurt.some((x) => Math.abs(x.t + 0.5 - t) < 0.05), `T${tier}: a hit 0.5 s before ${t}`);
    }
    assert.ok(spikes.some((c) => c.target === fly) && spikes.some((c) => c.target === a) && spikes.some((c) => c.target === b), `T${tier}: the flyer and the dummies`);
    done(h);
  }
});

test('S2: the cooldown (0.8 s) holds a second hit back; 持续 / 溅射 / element / 流失 / 无来源 damage and an ally\'s set nothing off; a stunned 棘刺 casts none', () => {
  const { h, u } = field({ tier: 5, skill: 1 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  const spikes = () => from(h, u, (c) => tagged(c, 'thorns:spike')).length;
  const hit = (o) => h.b.dealDamage(e, u, { amount: 1, type: 'phys', ...o });
  hit({ tags: ['dot'] }); hit({ attackType: 'BUFF', tags: ['periodic'] }); hit({ isSplash: true }); hit({ sourceless: true });
  h.b.dealDamage(e, u, { type: 'element', element: 'burn', amount: 10 });
  h.b.loseHp(u, 1, { source: e });
  h.b.dealDamage(u, u, { amount: 1, type: 'phys' });
  h.run(1);
  assert.equal(spikes(), 0, 'none of those is an enemy\'s 普通伤害');
  hit({});
  h.run(0.3);
  hit({});
  h.run(1);
  assert.equal(spikes(), 1, 'the second hit fell inside the 0.8 s cooldown');
  hit({});
  h.b.applyStatus(u, 'stun', { duration: 1, source: e });
  h.run(0.8);
  assert.equal(spikes(), 1, 'stunned before the spikes landed: none');
  h.run(1);
  hit({});
  h.run(0.6);
  assert.equal(spikes(), 2, 'after the stun: a volley again');
  done(h);
});

test('S3 至高之术 (MANUAL, attack SP, data ACTIVE_RANGE on 3-3): 30 s of range 3-3, ATK +33 % / +40 %, ASPD +14 / +16, no 80 % on ranged attacks; the second use of a deployment doubles both and never ends; a redeploy starts the count again', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u } = field({ tier, elite, skill: 2 });
    assert.deepEqual([u.skill.rule, sk.rangeId, sk.spType, sk.spCost, sk.duration, sk.bb.atk, sk.bb.attack_speed, sk.bb['thorns_s_3[b].atk'], sk.bb['thorns_s_3[b].attack_speed'], sk.bb['thorns_s_3[b].duration']],
      ['ACTIVE_RANGE', '3-3', 'INCREASE_WHEN_ATTACK', 15, 30, elite ? 0.4 : 0.33, elite ? 16 : 14, elite ? 0.8 : 0.66, elite ? 32 : 28, -1], `T${tier}`);
    u.skill.gainSp(999);
    const e = h.spawn('enemy_dummy', { pos: [11, 8] });   // on the 3-3, off the 3-12
    assert.ok(h.runUntil(() => u.skill.active, 2), `T${tier}: an enemy on the 3-3 casts it`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: range 3-3`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    assert.equal(u.s.aspd, u.base.aspd + sk.bb.attack_speed, `T${tier}: ASPD`);
    approx(u.skill.timeLeft, 30, `T${tier}: 30 s`, 0.01);
    h.runUntil(() => from(h, u, (c) => c.dmg.isAttack && c.target === e).length > 0, 3);
    approx(from(h, u, (c) => c.dmg.isAttack && c.target === e)[0].amount, u.s.atk, `T${tier}: full ATK at range`);
    h.runUntil(() => !u.skill.active, 31);
    assert.deepEqual([u.liveRangeGrid, u.s.aspd], [formOf(tier, elite).rangeGrid, u.base.aspd], `T${tier}: back after 30 s`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 4), `T${tier}: the second use`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb['thorns_s_3[b].atk']), `T${tier}: ATK ×2`);
    assert.equal(u.s.aspd, u.base.aspd + sk.bb['thorns_s_3[b].attack_speed'], `T${tier}: ASPD ×2`);
    h.run(120);
    assert.ok(u.skill.active, `T${tier}: 持续时间无限`);
    // knocked out and back: the count restarts
    h.b.kill(u, null);
    h.step();
    assert.ok(h.b.redeploy(u) && u.alive && u.deployed, `T${tier}: redeployed`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 4), `T${tier}: cast again`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: the first-use numbers again`);
    approx(u.skill.timeLeft, 30, `T${tier}: 30 s again`, 0.05);
    done(h);
  }
});

test('T1 神经腐蚀: an attack poisons its target — 3 ticks of 140 arts (280 on an enemy that attacks at range: RANGED / ALL), the first a second in, 持续伤害; a new hit refreshes it without a second instance', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const t0 = t0Of(tier, elite, null);
    assert.deepEqual([t0['damage[normal]'], t0['damage[ranged]'], t0.duration], [140, 280, 3]);
    for (const [key, dmg] of [['enemy_dummy', 140], ['enemy_ranged', 280], ['enemy_both', 280]]) {
      const { h, u } = field({ tier, elite, skill: 0 });
      u.skill.sp = 0;
      const e = h.spawn(key, { pos: [10, 6] });
      h.runUntil(() => from(h, u, (c) => c.dmg.isAttack).length > 0, 3);
      const hitT = h.b.time;
      u.atkCd = 99; // no further attack
      h.run(4);
      const ticks = from(h, u, (c) => tagged(c, 'thorns:poison'));
      assert.equal(ticks.length, 3, `T${tier} ${key}: 3 ticks`);
      approx(ticks[0].t - hitT, 1, `T${tier} ${key}: the first a second in`, 0.05);
      for (const c of ticks) {
        approx(c.amount, dmg, `T${tier} ${key}: ${dmg} arts`);
        assert.deepEqual([c.type, c.dmg.canDodge, tagged(c, 'dot'), c.target], ['arts', true, true, e]);
      }
      done(h);
    }
    // refreshed by every hit: one poison per 棘刺, ticking once a second while he keeps attacking
    const { h, u } = field({ tier, elite, skill: 0 });
    u.skill.sp = 0;
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(10.05);
    assert.equal(e.buffs.filter((b) => b.key === `thorns:poison:${u.id}`).length, 1, `T${tier}: one instance`);
    const ticks = from(h, u, (c) => tagged(c, 'thorns:poison'));
    assert.ok(ticks.length >= 8 && ticks.length <= 10, `T${tier}: ${ticks.length} ticks in 10 s`);
    assert.ok(ticks.every((c) => Math.abs(c.amount - 140) < 1e-6), `T${tier}: the value never changes`);
    done(h);
  }
});

test('T1 + LOR-X stage 3 "可叠加4次": the tick is 150 × the hits so far (≤ 4), 300 on a ranged enemy; stage 1 leaves the talent (140, one layer); a dodged hit poisons nothing', () => {
  const t03 = t0Of(6, true, LORX), t01 = t0Of(5, true, LORX);
  assert.deepEqual([t03['damage[normal]'], t03['damage[ranged]'], t03.max_cnt, t01['damage[normal]'], t01.max_cnt], [150, 300, 4, 140, undefined]);
  for (const [tier, per, cap] of [[6, 150, 4], [5, 140, 1]]) {
    const { h, u } = field({ tier, elite: true, mod: LORX, skill: 0 });
    u.skill.sp = 0;
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(12);
    const amounts = from(h, u, (c) => tagged(c, 'thorns:poison')).map((c) => c.amount);
    assert.ok(amounts.length >= 9, `T${tier}: ${amounts.length} ticks`);
    assert.equal(Math.max(...amounts), per * cap, `T${tier}: up to ${cap} layers`);
    assert.ok(amounts.every((a) => a % per === 0 && a <= per * cap), `T${tier}: multiples of ${per}`);
    // a hit every 1.3 × 100 / 107 s, a tick every second: one layer more per tick until the cap
    if (cap > 1) assert.deepEqual(amounts.slice(0, 4), [per, per * 2, per * 3, per * 4], `T${tier}: growing`);
    done(h);
  }
  // a dodged attack: no poison
  const { h, u } = field({ tier: 5, skill: 0 });
  u.skill.sp = 0;
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  h.run(5);
  assert.ok(h.hooksOf('attack').some((c) => c.attacker === u), 'he attacked');
  assert.equal(e.findBuff(`thorns:poison:${u.id}`), null, 'nothing hit, nothing poisoned');
  done(h);
});

test('LOR-X “盐与沙” (stages 1 / 3): every attack hit adds 10 % ATK arts (附加伤害); none without it', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    u.skill.sp = 0;
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(4);
    const atks = from(h, u, (c) => c.dmg.isAttack), adds = from(h, u, (c) => tagged(c, 'thorns:lorx'));
    const on = elite && mod === LORX;
    assert.equal(adds.length, on ? atks.length : 0, `${label(f)}: ${adds.length} additions for ${atks.length} hits`);
    if (on) {
      assert.deepEqual(u.def.raw.trait.bb, { atk_scale: 0.8, atk_scale_m: 0.1 }, label(f));
      for (const c of adds) { approx(c.amount, u.s.atk * 0.1, `${label(f)}: 10 % ATK`); assert.deepEqual([c.type, tagged(c, 'addition')], ['arts', true]); }
    }
    done(h);
  }
});

test('LOR-Δ “沙蚀” (stages 1 / 3): every damage instance he deals carries 10 % of it as 神经损伤; stage 3 poison: ×2.5 元素伤害 in a 神经 burst, and S2\'s spikes poison no more (stage 1 still does)', () => {
  for (const [tier] of [[5], [6]]) {
    const { h, u } = field({ tier, elite: true, mod: LORD, skill: 0 });
    assert.deepEqual(u.def.raw.trait.bb, { atk_scale: 0.8, ep_damage_ratio: 0.1 }, `T${tier}`);
    u.skill.sp = 0;
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(6);
    const dealt = from(h, u, (c) => c.type !== 'element' && c.amount > 0);
    const fills = from(h, u, (c) => c.type === 'element' && c.dmg.element === 'neural');
    assert.ok(dealt.length > 3 && fills.length === dealt.length, `T${tier}: one fill per damage instance (${fills.length} / ${dealt.length})`);
    for (let i = 0; i < 3; i++) approx(fills[i].dmg.amount, dealt[i].amount * 0.1, `T${tier}: 10 %`);
    done(h);
  }
  // stage 3: the poison on an enemy in its 神经 burst
  const t03 = t0Of(6, true, LORD);
  assert.deepEqual([t03['damage[normal]'], t03['damage[ranged]'], t03.ep_break_multi], [315, 630, 2.5]);
  {
    const { h, u } = field({ tier: 6, elite: true, mod: LORD, skill: 0 });
    u.skill.sp = 0;
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.b.addBuff(e, { key: 'neuralBurst', duration: 30, flags: { burstLock: true } });
    h.run(4);
    const ticks = from(h, u, (c) => tagged(c, 'thorns:poison'));
    assert.ok(ticks.length >= 2, 'ticks');
    for (const c of ticks) { approx(c.amount, 315 * 2.5, '×2.5'); assert.deepEqual([c.type, c.dmg.element], ['elemental', 'neural']); }
    // thorns_e_003_t has no independentCharacterSource: one poison per enemy, not one per 棘刺
    assert.deepEqual([!!e.findBuff('thorns:poison'), !!e.findBuff(`thorns:poison:${u.id}`)], [true, false], 'the shared poison');
    done(h);
  }
  // stage 1 has no burst multiplier: plain arts ticks
  {
    const { h, u } = field({ tier: 5, elite: true, mod: LORD, skill: 0 });
    u.skill.sp = 0;
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.b.addBuff(e, { key: 'neuralBurst', duration: 30, flags: { burstLock: true } });
    h.run(4);
    for (const c of from(h, u, (x) => tagged(x, 'thorns:poison'))) { approx(c.amount, 140, 'stage 1: 140'); assert.equal(c.type, 'arts'); }
    done(h);
  }
  // S2 spikes: they poison at stage 1 and without a module, never at LOR-Δ stage 3
  for (const [tier, mod, poisons] of [[6, LORD, false], [5, LORD, true], [6, LORX, true], [6, null, true]]) {
    const { h, u } = field({ tier, elite: true, mod, skill: 1 });
    const shooter = h.spawn('enemy_shooter', { pos: [10, 7] });
    u.skill.gainSp(999);
    h.run(4);
    assert.ok(from(h, u, (c) => tagged(c, 'thorns:spike')).length > 0, `T${tier} ${mod}: spikes`);
    assert.equal(!!(shooter.findBuff(`thorns:poison:${u.id}`) || shooter.findBuff('thorns:poison')), poisons, `T${tier} ${mod}: spikes poison`);
    done(h);
  }
});

test('T2 故土潮声: 生命回复速度 +4 % max HP/s (an hpRegenRatio buff, no 治疗: 禁疗 does not stop it) once his last attack is 2 s old — off while he attacks; S2\'s spikes are no 主动攻击', () => {
  for (const f of [[5, false, null], [6, true, LORX]]) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    const r = formOf(tier, elite).talents.find((t) => t.index === 1).bb;
    assert.deepEqual([r.delay, r.hp_recovery_per_sec_by_max_hp_ratio], [2, 0.04]);
    assert.deepEqual(u.findBuff('talent:thorns:tide')?.mods, { hpRegenRatio: 0.04 }, `${label(f)}: on from the deployment`);
    approx(u.s.hpRegen, u.s.maxHp * 0.04, `${label(f)}: 4 % max HP / s`);
    u.skill.sp = 0;
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 3);
    h.step();
    assert.equal(u.findBuff('talent:thorns:tide'), null, `${label(f)}: off while attacking`);
    h.b.kill(e, null);
    h.run(1.9);
    assert.equal(u.findBuff('talent:thorns:tide'), null, `${label(f)}: not yet`);
    h.run(0.2);
    assert.ok(u.findBuff('talent:thorns:tide'), `${label(f)}: 2 s after his last attack`);
    // 禁疗 (flag healFree) keeps heals off, not the regeneration attribute
    h.b.addBuff(u, { key: 'test:healFree', flags: { healFree: true, noHeal: true } });
    u.hp = u.s.maxHp * 0.5;
    h.run(1);
    approx(u.hp, u.s.maxHp * (0.5 + 0.04), `${label(f)}: +4 % in a second under 禁疗`, 0.01);
    done(h);
  }
  // S2: the spikes keep the regeneration on
  const { h, u } = field({ tier: 5, skill: 1 });
  h.spawn('enemy_shooter', { pos: [10, 7] });
  u.skill.gainSp(999);
  h.run(5);
  assert.ok(from(h, u, (c) => tagged(c, 'thorns:spike')).length > 0, 'spikes');
  assert.ok(u.findBuff('talent:thorns:tide'), 'still on');
  done(h);
});

for (const [tier, mod] of [[5, null], [5, LORX], [6, LORX], [5, LORD], [6, LORD]]) test(`precomputed poison omits source calculation and LOR-X re-entry: T${tier} ${mod}`, () => {
  const { h, u } = field({ tier, elite: true, mod });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.atkCd = e.atkCd = 999;
  let calculations = 0;
  h.b.on('damageCalculate', c => { if (c.source === u) { calculations++; c.dmg.amount *= 2; } });
  h.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', isAttack: true });
  h.run(1.1);
  const ticks = from(h, u, c => tagged(c, 'thorns:poison'));
  assert.equal(calculations, 1, 'only the primary enters source calculation');
  assert.equal(ticks.length, 1);
  approx(ticks[0].amount, t0Of(tier, true, mod)['damage[normal]'], 'fixed poison input is not doubled');
  assert.equal(ticks[0].dmg.calculation, 'precomputed');
  assert.equal(ticks[0].dmg.attackType, 'BUFF');
  assert.equal(ticks[0].dmg.applyWay, 'NONE');
  assert.equal(from(h, u, c => tagged(c, 'thorns:lorx')).length, mod === LORX ? 1 : 0);
  done(h);
});

test('LOR-X child consumes a count shield before its primary', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: LORX });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.b.addBuff(e, { key: 'shield', shieldHits: 1 });
  approx(h.b.dealDamage({ source: u, target: e, amount: 1000, type: 'true', isAttack: true }), 1000, 'primary lands');
  const hits = from(h, u);
  assert.equal(hits[0].dmg.attackType, 'ADDITION');
  assert.equal(hits[0].amount, 0);
  assert.equal(hits[0].dmg.origin, hits[1].dmg);
  done(h);
});

test('poison retains ordinary arts dodge rather than an implicit ignore-cancellation mask', () => {
  const { h, u } = field();
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.atkCd = e.atkCd = 999;
  h.b.addBuff(e, { key: 'dodge', mods: { dodgeArts: 1 } });
  let attempts = 0;
  h.b.on('dodge', c => { if (c.source === u && c.dmg.tags.includes('thorns:poison')) attempts++; });
  h.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', isAttack: true });
  h.run(1.1);
  assert.equal(attempts, 1);
  assert.equal(from(h, u, c => tagged(c, 'thorns:poison')).length, 0);
  done(h);
});

for (const defense of ['shield', 'overkill']) test(`LOR-Delta takes its gauge basis before parent ${defense}`, () => {
  const { h, u } = field({ tier: 5, elite: true, mod: LORD });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  if (defense === 'shield') h.b.addBuff(e, { key: 'shield', shieldHits: 1 });
  else e.hp = 1;
  h.b.dealDamage({ source: u, target: e, amount: 1000, type: 'true' });
  approx(e.elem.neural, 100, '10% of output amount, independent of parent injury/remaining HP');
  done(h);
});

for (const [attackType, tags, splash, expected] of [
  ['NORMAL', ['dot', 'addition'], true, 1], ['ADDITION', [], false, 0], ['BUFF', [], false, 0],
  ['SPLASH', [], false, 0], ['NONE', [], false, 0],
]) test(`S2 reads explicit ${attackType} rather than descriptive tags or splash flags`, () => {
  const { h, u } = field({ skill: 1 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  e.atkCd = 999;
  assert.ok(u.skill.activate('test', { free: true }));
  h.b.dealDamage({ source: e, target: u, amount: 1, type: 'true', attackType, tags, isSplash: splash });
  h.run(0.6);
  assert.equal(from(h, u, c => tagged(c, 'thorns:spike')).length, expected);
  done(h);
});

// Literal-zero dispatch is the sim's [ASSUMED] shared event contract; cancelled nonzero hits have native evidence.
for (const [defense, before] of [['shield', true], ['shield', false], ['dodge', true], ['dodge', false], ['zero', false]]) test(`S2 observer accepts ${defense} acquired ${before ? 'before' : 'after'} the skill`, () => {
  const { h, u } = field({ skill: 1 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  e.atkCd = 999;
  const addDefense = () => {
    if (defense === 'shield') h.b.addBuff(u, { key: 'shield', shieldHits: 1 });
    if (defense === 'dodge') h.b.addBuff(u, { key: 'dodge', mods: { dodgePhys: 1 } });
  };
  if (before) addDefense();
  assert.ok(u.skill.activate('test', { free: true }));
  if (!before) addDefense();
  h.b.dealDamage({ source: e, target: u, amount: defense === 'zero' ? 0 : 10, type: 'phys', attackType: 'NORMAL' });
  h.run(0.6);
  assert.equal(from(h, u, c => tagged(c, 'thorns:spike')).length, 1);
  done(h);
});

test('S2 held observer ends with the skill and its LOR-X spike has only one precomputed child', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: LORX, skill: 1 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  e.atkCd = 999;
  assert.ok(u.skill.activate('test', { free: true }));
  assert.ok(u.findBuff('skill:thorns:spikes'));
  let calculations = 0;
  h.b.on('damageCalculate', c => { if (c.source === u) calculations++; });
  h.b.dealDamage({ source: e, target: u, amount: 10, type: 'true' });
  h.run(0.6);
  assert.equal(from(h, u, c => tagged(c, 'thorns:spike')).length, 1);
  assert.equal(from(h, u, c => tagged(c, 'thorns:lorx')).length, 1);
  assert.equal(calculations, 1);
  u.skill.end('test');
  u.atkCd = 999;
  assert.equal(u.findBuff('skill:thorns:spikes'), null);
  h.b.dealDamage({ source: e, target: u, amount: 10, type: 'true' });
  h.run(0.6);
  assert.equal(from(h, u, c => tagged(c, 'thorns:spike')).length, 1);
  assert.equal(from(h, u, c => tagged(c, 'thorns:lorx')).length, 1, 'poison does not make another module child');
  done(h);
});

test('an attack-shaped HP-loss origin cannot apply Thorns poison', () => {
  const { h, u } = field();
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.atkCd = e.atkCd = 999;
  h.b.dealHPLose(e, 10, { source: u, from: { isAttack: true, tags: ['thorns:spike'] } });
  assert.equal(e.findBuff(`thorns:poison:${u.id}`), null);
  h.b.dealHPLose({ source: u, target: e, amount: 10, origin: { isAttack: true, tags: ['thorns:spike'] } });
  assert.equal(e.findBuff(`thorns:poison:${u.id}`), null);
  done(h);
});
