// test/content/op_narant.test.js — the 自选 operator kit of 娜仁图亚 (char_4138_narant, 6★ 回环射手; kit
// server/sim/content/kits/ops/op-narant.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, LPS-X
// “吹尽狂沙” or LPS-Y “致我们的老大” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from data/backups.json (the
// form of that slot status); the fidelity checklist of kits/README.md item by item. Also the two engine hooks of the
// boomerang flight it relies on (ai.js throwBoomerang: `boomerangCaught`, a profile's `boomerangOnward`).
// Run: node --test test/content/op_narant.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { PROJECTILE_SPEEDS, BOOMERANG_RETURN_SPEED } from '../../server/sim/constants.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const NARANT = 'char_4138_narant';
const FORMS = BACKUPS.units[NARANT].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const LPSX = 'uniequip_002_narant', LPSY = 'uniequip_003_narant';
const S1 = 'skchr_narant_1', S2 = 'skchr_narant_2', S3 = 'skchr_narant_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_brute: dummy('enemy_brute', { atk: 400, def: 300 }),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  // a ranged attacker that shoots twice a second at whatever ally its 2.5-tile radius holds (an ATK her steals cannot drain)
  enemy_shooter: dummy('enemy_shooter', { atk: 5000, bat: 0.5, range: 2.5 }),
};
/** Every 自选 form: [tier, elite, module]. */
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, LPSX, LPSY].map((m) => [t, true, m]))];
/** LPS-Y stage 3 婀娜虚影: ATK +15 % while unhurt — she starts unhurt. */
const calmAtk = (tier, elite, mod) => (elite && mod === LPSY && tier === 6 ? 0.15 : 0);

/** A battle with 娜仁图亚 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 3, others = [], seed = 5, hooks = [] } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'boomerangCaught', 'spGain', 'attack', ...hooks], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: NARANT, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const hitsBy = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u);
const atkHits = (h, u) => hitsBy(h, u).filter((c) => c.dmg?.isAttack);
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
const TICK = 1 / 30;

test('娜仁图亚 in every 自选 form: her operator kit (all three skills authored), the form\'s stats + module attributes, y-7 range, ranged physical boomerangs that hit air, block 1, 38 % dodge, no 特质', () => {
  assert.equal(OPERATOR_KITS[NARANT], KITS[NARANT]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [NARANT, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.dmgType, u.profile.projectile, u.profile.canHitFly, u.base.bat, typeof u.profile.canAttack],
        [1, 'ranged', 'phys', 'boomerang', true, 1, 'function'], `${label(f)}: 回环射手`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: y-7`);
      assert.deepEqual([u.s.dodgePhys, u.s.dodgeArts], [0.38, 0.38], `${label(f)}: 婀娜虚影 dodge`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [BACKUPS.diy.operators[NARANT].bonds, []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target her`);
      done(h);
    }
  }
  // full potential: E2 Lv1 2000 / 573 / 144, E2 Lv60 2331 / 659 / 161; LPS-X +25 / +25 → +45 / +45 ATK / DEF, LPS-Y +210 / +20 → +300 / +40 HP / ATK
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [2000, 573, 2331, 659]);
  assert.deepEqual([modOf(5, LPSX).attr, modOf(6, LPSX).attr, modOf(5, LPSY).attr, modOf(6, LPSY).attr], [{ atk: 25, def: 25 }, { atk: 45, def: 45 }, { maxHp: 210, atk: 20 }, { maxHp: 300, atk: 40 }]);
});

test('a 自选 pick: 娜仁图亚 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(NARANT));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(NARANT), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[5]]: { charId: NARANT, skillIndex: 0, uniEquipId: LPSX } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[5]]: { charId: NARANT, skillIndex: 0, uniEquipId: LPSX } } });
});

test('trait 回环射手 (engine): one boomerang out at 15 and back at 3.75 tiles/s, the next throw once it is caught — each catch fires boomerangCaught { unit, attackId, isSkill }; a flyer is hit', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  const fly = h.spawn('enemy_fly', { pos: [10, 6] });
  h.run(6);
  const hits = atkHits(h, u), caught = h.hooksOf('boomerangCaught').filter((c) => c.unit === u);
  assert.ok(hits.length >= 2 && hits.every((c) => c.target === fly), '可对空');
  assert.ok(caught.length >= 2);
  for (const c of caught) assert.ok(hits.some((x) => x.dmg.attackId === c.attackId) && c.isSkill === false, 'the catch names its attack');
  const d = 3;
  const flight = d / PROJECTILE_SPEEDS.boomerang + d / BOOMERANG_RETURN_SPEED;
  approx(caught[0].t - hits[0].t, d / BOOMERANG_RETURN_SPEED, 'back at 3.75 tiles/s', 0.1);
  approx(hits[1].t - hits[0].t, flight, 'she waits for it (longer than her 1 s interval)', 0.1);
  assert.ok(h.eventsOf('atk').filter((e) => e[1] === u.id).every((e) => e[3] === 'boomerang'));
  done(h);
});

test('S1 旋刃 (切换: on until she leaves; data DEFAULT): range −1 (the far column of y-7), 140 % / 160 % ATK, then up to 3 bounces (radius 1.7, an enemy this attack has not hit first, then the nearest; 6 tiles/s), then back; a lone enemy: no bounce', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.rule, u.skill.kind, u.skill.spCost, u.skill.initSp, sk.bb['attack@times'], sk.bb['attack@atk_scale'], sk.bb.ability_range_forward_extend],
      ['DEFAULT', 'toggle', elite ? 8 : 9, 0, 3, elite ? 1.6 : 1.4, -1], `T${tier}`);
    const lone = h.spawn('enemy_dummy', { pos: [10, 5] });
    assert.ok(h.runUntil(() => u.skill.active, 12), `T${tier}: on once its SP is full and an enemy is in range`);
    const short = formOf(tier, elite).rangeGrid.filter(([, c]) => c < 3);
    assert.deepEqual(u.liveRangeGrid, short, `T${tier}: 攻击距离-1`);
    h.run(3);
    const one = atkHits(h, u).filter((c) => c.dmg.isSkill);
    assert.ok(one.length >= 1 && one.every((c) => c.target === lone), `T${tier}: one hit per attack on a lone enemy`);
    assert.equal(new Set(one.map((c) => c.dmg.attackId)).size, one.length, `T${tier}: no bounce`);
    const before = atkHits(h, u).filter((c) => c.t < one[0].t - 1e-9).length;   // her normal attacks' steals so far
    approx(one[0].amount, (u.base.atk + Math.min(270, 27 * before)) * sk.bb['attack@atk_scale'], `T${tier}: ${sk.bb['attack@atk_scale'] * 100} % (+ the ATK stolen before)`);
    // A (lone) at 10,5; B at 11,5 (1 from A); C at 9,6 (1.41 from A, 2.24 from B)
    const b = h.spawn('enemy_dummy', { pos: [11, 5] }), c = h.spawn('enemy_dummy', { pos: [9, 6] });
    const far = h.spawn('enemy_dummy', { pos: [12, 5] });   // 2 from A, 1 from B: reachable from B only
    h.run(0.1);
    const before0 = atkHits(h, u), n0 = before0.length;
    h.run(4);
    const after = atkHits(h, u).slice(n0);
    // the first attack thrown after that (one in flight then has already hit A before the others came)
    const id = after.find((x) => !before0.some((y) => y.dmg.attackId === x.dmg.attackId)).dmg.attackId;
    const chain = after.filter((x) => x.dmg.attackId === id);
    assert.equal(chain.length, 4, `T${tier}: the hit + 3 bounces`);
    assert.equal(chain[0].target, lone, `T${tier}: her target`);
    assert.equal(chain[1].target, b, `T${tier}: nearest not yet hit (B, 1 tile)`);
    assert.equal(chain[2].target, far, `T${tier}: from B the one not yet hit (12,5), before A`);
    approx(chain[1].t - chain[0].t, 1 / 6 + TICK, `T${tier}: bounce at 6 tiles/s`, 0.07);
    assert.ok(chain.every((x) => x.dmg.isAttack && x.dmg.isSkill && x.type === 'phys'), `T${tier}: hits of the attack`);
    assert.ok(!chain.some((x) => x.target === c) || chain[3].target === c, `T${tier}: C (2.24 from B) only from A`);
    // on until she leaves; redeployed: off, own range
    h.run(30);
    assert.ok(u.skill.active, `T${tier}: still on`);
    h.b.retreat(u);
    h.b.redeploy(u);
    assert.ok(!u.skill.active, `T${tier}: off after a redeploy`);
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `T${tier}: y-7 again`);
    done(h);
  }
});

test('S2 恶魇 (30 s, attack SP 18 from 5 / 8): 210 % / 225 % ATK + 停顿 1 s; the boomerang flies on 0.5 s, then hits every enemy within 1.0 of its way back once for 155 % / 170 %; farther ones untouched', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, skill: 1 });
    assert.deepEqual([u.skill.rule, u.skill.spType, u.skill.spCost, u.skill.initSp, sk.duration, sk.bb['attack@atk_scale'], sk.bb['attack@atk_scale_comeback'], sk.bb['attack@sluggish'], sk.bb['attack@move_ahead_time'], sk.bb['attack@projectile_range']],
      ['DEFAULT', 'attack', 18, elite ? 8 : 5, 30, elite ? 2.25 : 2.1, elite ? 1.7 : 1.55, 1, 0.5, 1], `T${tier}`);
    const target = h.spawn('enemy_dummy', { pos: [10, 6] });
    const side = h.spawn('enemy_dummy', { pos: [11, 5] });    // 1.0 from the return line (row 10): hit on the way back
    const off = h.spawn('enemy_dummy', { pos: [12, 4] });     // 2 rows off: never
    h.b.addBuff(target, { key: 'test:taunt', mods: { taunt: 5 } });   // her target
    // attack SP: one per normal attack
    const sp0 = u.skill.sp;
    h.run(3.5);
    const normal = atkHits(h, u).filter((c) => !c.dmg.isSkill).length;
    approx(u.skill.sp, Math.min(18, sp0 + normal), `T${tier}: +1 SP an attack`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 4), `T${tier}: cast`);
    approx(u.skill.timeLeft, 30, `T${tier}: 30 s`, 0.1);
    h.run(3);
    const sk2 = atkHits(h, u).filter((c) => c.dmg.isSkill);
    const id = sk2[0].dmg.attackId;
    const main = sk2.find((c) => c.dmg.attackId === id && !c.dmg.tags?.includes('narant:comeback'));
    const back = sk2.filter((c) => c.dmg.attackId === id && c.dmg.tags?.includes('narant:comeback'));
    assert.equal(main.target, target, `T${tier}: her target`);
    assert.deepEqual(back.map((c) => c.target).sort((a, b) => a.id - b.id), [target, side].sort((a, b) => a.id - b.id), `T${tier}: once each within 1.0 of the way back`);
    assert.ok(back.every((c) => c.t - main.t >= 0.5), `T${tier}: after the 0.5 s dash`);
    assert.ok(!sk2.some((c) => c.target === off), `T${tier}: 2 tiles off the line`);
    assert.ok(back.every((c) => c.dmg.isAttack && c.type === 'phys'), `T${tier}: hits of the attack`);
    const slows = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'sluggish');
    assert.ok(slows.length && slows.every((c) => c.target === target && Math.abs(c.duration - 1) < 1e-9), `T${tier}: 停顿 1 s on the hit target only`);
    // the hit's ATK scale: her ATK at that hit (base + the steals before it) × 225 %
    const before = atkHits(h, u).filter((c) => c.t < main.t - 1e-9).length;
    const sa = formOf(tier, elite).talents.find((t) => t.index === 0).bb['attack@steal_atk'];
    approx(main.amount, (u.base.atk + Math.min(270, sa * before)) * sk.bb['attack@atk_scale'], `T${tier}: ${sk.bb['attack@atk_scale'] * 100} %`);
    done(h);
  }
});

test('S3 吞日 (20 s): 3 boomerangs per attack (3 hits of 145 % / 160 %, flying together); once they are caught she strikes at most 3 enemies within one tile for 130 % / 140 % and 停顿 1 s (no attack)', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u } = field({ tier, elite, skill: 2 });
    assert.deepEqual([u.skill.rule, u.skill.spCost, u.skill.initSp, sk.duration, sk.bb.cnt, sk.bb['attack@atk_scale'], sk.bb.atk_scale_aoe, sk.bb['attack@aoe.max_target'], sk.bb.sluggish],
      ['DEFAULT', elite ? 36 : 39, elite ? 17 : 14, 20, 3, elite ? 1.6 : 1.45, elite ? 1.4 : 1.3, 3, 1], `T${tier}`);
    const target = h.spawn('enemy_dummy', { pos: [10, 6] });
    const around = [[9, 3], [11, 3], [9, 4], [11, 4]].map((pos) => h.spawn('enemy_dummy', { pos }));
    h.b.addBuff(target, { key: 'test:taunt', mods: { taunt: 5 } });   // her target: the far one
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 4), `T${tier}: cast`);
    approx(u.skill.timeLeft, 20, `T${tier}: 20 s`, 0.1);
    h.run(2.5);
    const sk3 = atkHits(h, u).filter((c) => c.dmg.isSkill);
    const id = sk3[0].dmg.attackId;
    const three = sk3.filter((c) => c.dmg.attackId === id);
    assert.equal(three.length, 3, `T${tier}: 3 boomerangs`);
    assert.ok(three.every((c) => c.target === target && c.t === three[0].t), `T${tier}: together, at the target`);
    const caught = h.hooksOf('boomerangCaught').find((c) => c.unit === u && c.attackId === id);
    assert.ok(caught?.isSkill, `T${tier}: caught`);
    const blast = hitsBy(h, u).filter((c) => c.dmg.tags?.includes('narant:blast') && Math.abs(c.t - caught.t) < 1e-9);
    assert.equal(blast.length, 3, `T${tier}: at most 3 of the 4 around her`);
    assert.ok(blast.every((c) => around.includes(c.target) && !c.dmg.isAttack && c.dmg.isSkill && c.type === 'phys'), `T${tier}: skill hits within one tile`);
    const slows = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'sluggish' && Math.abs(c.t - caught.t) < 1e-9);
    assert.equal(slows.length, 3, `T${tier}: 停顿 on each`);
    for (const c of slows) approx(c.duration, 1, '1 s');
    done(h);
  }
});

test('T1 “我见，我得”: every landing attack hit steals 27 ATK / 21 DEF — the enemy loses, she gains, each capped at 270 / 210 (LPS-X stage 3: 324 / 252, twice within one tile); two of her: the larger loss, not the sum; target dodge does not suppress the earlier steal; all given back when she leaves', () => {
  for (const f of [[5, false, null], [6, true, null], [5, true, LPSX], [6, true, LPSX], [6, true, LPSY]]) {
    const [tier, elite, mod] = f;
    const t0 = formOf(tier, elite).talents.find((t) => t.index === 0).bb;
    const tc = mod === LPSX && tier === 6 ? modOf(6, LPSX).talentChanges.find((t) => t.talentIndex === 0) : null;
    const capA = tc?.bb['attack@steal_atk_max'] ?? t0['attack@steal_atk_max'], capD = tc?.bb['attack@steal_def_max'] ?? t0['attack@steal_def_max'];
    assert.deepEqual([t0['attack@steal_atk'], t0['attack@steal_def'], capA, capD], [27, 21, ...(tc ? [324, 252] : [270, 210])], label(f));
    const twice = !!tc;
    if (twice) assert.match(tc.desc, /攻击到周围8格的敌人时偷取触发2次/);
    // one hit at two tiles, then one at one tile
    {
      const { h, u } = field({ tier, elite, mod, skill: 2 });
      const e = h.spawn('enemy_brute', { pos: [10, 5] });
      assert.ok(h.runUntil(() => atkHits(h, u).length === 1, 3));
      assert.deepEqual(u.findBuff('talent:narant:loot')?.mods, { atkFlat: 27, defFlat: 21 }, `${label(f)}: she gains`);
      assert.deepEqual(e.findBuff('narant:stolen')?.mods, { atkFlat: -27, defFlat: -21 }, `${label(f)}: the enemy loses`);
      assert.deepEqual([e.s.atk, e.s.def], [373, 279], `${label(f)}: its stats`);
      h.b.kill(e, null);
      const near = h.spawn('enemy_brute', { pos: [10, 4] });
      assert.ok(h.runUntil(() => atkHits(h, u).length === 2, 4));
      const k = twice ? 2 : 1;
      assert.deepEqual(near.findBuff('narant:stolen')?.mods, { atkFlat: -27 * k, defFlat: -21 * k }, `${label(f)}: within one tile ×${k}`);
      assert.deepEqual(u.findBuff('talent:narant:loot')?.mods, { atkFlat: 27 * (1 + k), defFlat: 21 * (1 + k) }, `${label(f)}: hers`);
      // the caps
      h.run(40);
      assert.deepEqual(u.findBuff('talent:narant:loot')?.mods, { atkFlat: capA, defFlat: capD }, `${label(f)}: her cap`);
      assert.deepEqual(near.findBuff('narant:stolen')?.mods, { atkFlat: -capA, defFlat: -capD }, `${label(f)}: its cap`);
      approx(u.s.atk, (u.base.atk + capA) * (1 + calmAtk(tier, elite, mod)), `${label(f)}: her ATK`);
      // she leaves: nothing kept, everything given back
      h.b.retreat(u);
      h.step();
      assert.equal(u.findBuff('talent:narant:loot'), null, `${label(f)}: her gains go`);
      assert.equal(near.findBuff('narant:stolen'), null, `${label(f)}: its losses come back`);
      assert.deepEqual([near.s.atk, near.s.def], [400, 300]);
      done(h);
    }
  }
  // two of her (a T5 and a T6 piece) hitting one enemy: the larger loss, never the sum; target dodge does not suppress the earlier steal
  const { h, u } = field({ tier: 5, skill: 2, others: [{ uid: 2, diy: { slot: SLOT[6], charId: NARANT, skillIndex: 2 }, row: 12, col: 3 }] });
  const v = h.unit(2);
  const e = h.spawn('enemy_brute', { pos: [11, 5] });
  h.run(8);
  const n1 = atkHits(h, u).filter((c) => c.target === e).length, n2 = atkHits(h, v).filter((c) => c.target === e).length;
  assert.ok(n1 >= 3 && n2 >= 3, `both hit it (${n1}, ${n2})`);
  assert.deepEqual(e.findBuff('narant:stolen')?.mods.atkFlat, -Math.min(270, 27 * Math.max(n1, n2)), 'the larger loss');
  const ghost = h.spawn('enemy_brute', { pos: [11, 4] });
  h.b.kill(e, null);
  h.b.addBuff(ghost, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  h.run(4);
  assert.ok(h.hooksOf('damaged').every((c) => c.target !== ghost), 'every hit dodged');
  assert.ok(ghost.findBuff('narant:stolen'), 'stealing precedes target injury dodge');
  done(h);
});

test('T2 婀娜虚影: enemies within one tile of her miss 20 % (LPS-Y stage 3: 30 %) of their physical / arts attacks — one roll per attack —, farther ones never; LPS-Y stage 3: ATK +15 % after 6 s without damage', () => {
  for (const f of [[5, false, null], [6, true, LPSY], [5, true, LPSY]]) {
    const [tier, elite, mod] = f;
    const t1 = formOf(tier, elite).talents.find((t) => t.index === 1).bb;
    const cut = mod === LPSY && tier === 6 ? -modOf(6, LPSY).talentChanges.find((t) => t.talentIndex === 1).bb.damage_hitrate_physical : -t1.damage_hitrate_physical;
    assert.equal(cut, mod === LPSY && tier === 6 ? 0.3 : 0.2, label(f));
    for (const [pos, inside] of [[[10, 4], true], [[11, 5], false]]) {
      const { h, u } = field({ tier, elite, mod, skill: 2, seed: 13 });
      h.b.removeBuff(u, 'talent:narant:dodge');   // her own 闪避 aside: every lost shot is a miss
      h.b.addBuff(u, { key: 'test:tank', mods: { hpFlat: 1e9 } });
      const shooter = h.spawn('enemy_shooter', { pos });
      h.run(150);
      const shots = h.hooksOf('attack').filter((c) => c.attacker === shooter).length;
      const landed = h.hooksOf('damaged').filter((c) => c.source === shooter).length;
      assert.ok(shots > 200, `${label(f)}: ${shots} shots`);
      const rate = 1 - landed / shots;
      if (inside) assert.ok(Math.abs(rate - cut) < 0.07, `${label(f)}: ${(rate * 100).toFixed(1)} % missed ≈ ${cut * 100} %`);
      else assert.ok(landed >= shots - 1, `${label(f)}: two tiles away: no miss (${landed} / ${shots}, the last one may still fly)`);
      done(h);
    }
  }
  // the calm ATK
  const { h, u } = field({ tier: 6, elite: true, mod: LPSY, skill: 2 });
  assert.deepEqual(modOf(6, LPSY).talentChanges.find((t) => t.talentIndex === -1).bb, { atk: 0.15, interval: 6 });
  h.step();
  assert.deepEqual(u.findBuff('talent:narant:calm')?.mods, { atkPct: 0.15 }, 'unhurt since her deployment');
  h.b.dealDamage(null, u, { amount: 10, type: 'true' });
  h.step();
  assert.equal(u.findBuff('talent:narant:calm'), null, 'hurt: gone');
  h.run(5.5);
  assert.equal(u.findBuff('talent:narant:calm'), null, 'not yet');
  h.run(0.6);
  assert.ok(u.findBuff('talent:narant:calm'), '6 s later: back');
  h.b.loseHp(u, 10, {});
  h.step();
  assert.ok(u.findBuff('talent:narant:calm'), 'a 流失 is no damage');
  done(h);
});

test('LPS-X “吹尽狂沙”: ×1.1 on her attack hits within one tile (stages 1 and 3), not beyond; none without it', () => {
  for (const [tier, mod] of [[5, LPSX], [6, LPSX], [6, LPSY], [5, null]]) {
    const near = mod === LPSX ? 1.1 : 1;
    if (mod === LPSX) assert.deepEqual(modOf(tier, LPSX).traitOverride.bb, { atk_scale: 1.1 });
    for (const [pos, d1] of [[[10, 4], true], [[10, 5], false], [[11, 4], true]]) {
      const { h, u } = field({ tier, elite: true, mod, skill: 2 });
      const e = h.spawn('enemy_dummy', { pos });
      assert.ok(h.runUntil(() => atkHits(h, u).length === 1, 3));
      approx(atkHits(h, u)[0].amount, u.base.atk * (1 + calmAtk(tier, true, mod)) * (d1 ? near : 1), `T${tier} ${mod}: ${pos}`);
      assert.equal(atkHits(h, u)[0].target, e);
      done(h);
    }
  }
});

test('LPS-Y “致我们的老大”: 1 SP every 5 boomerangs caught (an S3 throw carries 3), none while her skill runs; none without it', () => {
  for (const [tier, mod] of [[5, LPSY], [6, LPSY], [6, LPSX]]) {
    if (mod === LPSY) assert.deepEqual(modOf(tier, LPSY).traitOverride.bb, { come_back_cnt: 5, sp: 1 });
    const { h, u } = field({ tier, elite: true, mod, skill: 1 });    // S2: attack SP — the time SP stays out of it
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(9);
    const caught = h.hooksOf('boomerangCaught').filter((c) => c.unit === u && !c.isSkill).length;
    const gains = h.hooksOf('spGain').filter((c) => c.unit === u && c.reason === 'module').length;
    assert.ok(caught >= 5, `T${tier} ${mod}: ${caught} caught`);
    assert.equal(gains, mod === LPSY ? Math.floor(caught / 5) : 0, `T${tier} ${mod}: ${gains} module SP`);
    done(h);
  }
  // S3: each throw is 3 boomerangs; while S3 runs no SP is gained (the catches still count)
  const { h, u } = field({ tier: 6, elite: true, mod: LPSY, skill: 2 });
  h.spawn('enemy_dummy', { pos: [10, 6] });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 4));
  h.run(6);
  const during = h.hooksOf('boomerangCaught').filter((c) => c.unit === u && c.isSkill).length;
  assert.ok(during >= 3, `${during} S3 throws caught`);
  assert.equal(u.mem.narantCaught, (3 * during) % 5, 'the S3 catches count 3 each');
  assert.equal(h.hooksOf('spGain').filter((c) => c.unit === u && c.reason === 'module' && c.amount > 0 && u.skill.active).length, 0, 'no SP during S3');
  done(h);
});

test('engine: a profile `boomerangOnward` takes the flight over after the first hit — ctx.hit / ctx.comeBack once — and a content error there still brings the boomerang back', () => {
  const calls = [];
  const kits = {
    [NARANT]: () => ({
      skills: Object.fromEntries([S1, S2, S3].map((id) => [id, { kind: 'duration' }])),
      trait: {
        boomerangOnward(ctx) {
          calls.push(ctx.attackId);
          if (calls.length === 2) throw new Error('kit bug');
          ctx.battle.after(0.5, () => { assert.equal(typeof ctx.comeBack(ctx.x, ctx.y), 'object'); assert.equal(ctx.comeBack(ctx.x, ctx.y), null, 'once'); });
        },
      },
    }),
  };
  const h = makeBattle({ defs: { enemies: ENEMIES }, timeLimit: 120, autoFinish: false, seed: 1, kits, verbose: false, hooks: ['boomerangCaught'],
    units: [{ uid: 1, diy: { slot: SLOT[6], charId: NARANT, skillIndex: 2 }, elite: true, row: 10, col: 3 }] });
  h.step();
  const u = h.unit(1);
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.run(6);
  assert.ok(calls.length >= 3, `${calls.length} flights taken over`);
  assert.ok(h.hooksOf('boomerangCaught').length >= 2, 'caught every time (the error one too)');
  assert.ok(h.b.errors.some((e) => /boomerang\.onward/.test(e.label ?? e.where ?? JSON.stringify(e))), 'the error is logged');
  assert.equal(u.trait.boomerangsOut <= 1, true);
  checkInvariants(h.b);
});


for (const defense of ['none', 'dodge', 'shield']) test(`Narant steals before target ${defense}, after computing this hit`, () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  const b = h.b, e = h.spawn('enemy_brute', { pos: [10, 5] });
  if (defense === 'dodge') b.addBuff(e, { key: 'test:defense', mods: { dodgePhys: 1 } });
  if (defense === 'shield') b.addBuff(e, { key: 'test:defense', shieldHits: 1 });
  const before = [];
  b.on('damageBeforeApply', c => { if (c.source === u) before.push({ amount: c.amount, def: e.s.def, loot: u.mem.narantLoot.a }); }, { priority: -100 });
  const removed = b.dealDamage({ source: u, target: e, amount: 1000, type: 'phys', isAttack: true });
  assert.deepEqual(before, [{ amount: 700, def: 279, loot: 27 }]);
  assert.equal(removed, defense === 'none' ? 700 : 0);
  assert.deepEqual(e.findBuff('narant:stolen').mods, { atkFlat: -27, defFlat: -21 });
  if (defense === 'none') assert.equal(b.dealDamage({ source: u, target: e, amount: 1000, type: 'phys', isAttack: true }), 721);
  done(h);
});

test('Narant rejects HP loss, gauges, non-attack output and source-less credit before-apply triggers', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  const b = h.b, e = h.spawn('enemy_brute', { pos: [10, 5] });
  let stages = 0;
  b.on('damageBeforeApply', () => { stages++; });
  b.dealHPLose({ source: u, target: e, amount: 100 });
  b.dealElementDamage({ source: u, target: e, amount: 10, element: 'burn' });
  b.dealDamage({ source: null, credit: u, target: e, amount: 100, type: 'true', isAttack: true });
  assert.equal(stages, 0);
  b.dealDamage({ source: u, target: e, amount: 100, type: 'true', isAttack: false });
  assert.equal(stages, 1);
  assert.equal(e.findBuff('narant:stolen'), null);
  assert.deepEqual(u.mem.narantLoot, { a: 0, d: 0 });
  done(h);
});

test('Narant steals before the real Rhine count shield; later source-less damage uses the stolen DEF', () => {
  // enemy_lysdb[damage_block_fixed]: DEFAULT ON_TAKE_DAMAGE, not an early hit cancellation.
  // narant_t_1[steal]: ON_BEFORE_TARGET_APPLY_MODIFIER, before that shield cancels the damage.
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const { h, u } = field({ tier, elite, skill: 2 });
    const b = h.b, e = h.spawn('enemy_1249_lysdb_2', { pos: [10, 5] });
    const hp = e.hp, defense = e.s.def, shield = e.findBuff('ab:hitShield');
    assert.equal(shield.shieldHits, 1);
    const stages = [], observed = [];
    let successes = 0;
    b.on('damageBeforeApply', c => {
      if (c.source === u) stages.push({ amount: c.amount, defense: e.s.def });
    }, { priority: -100 });
    b.addBuff(e, { key: 'test:observe', injuryPriority: -1000,
      observeInjury(c) { observed.push({ amount: c.amount, cancelled: c.cancelled, loot: u.mem.narantLoot.a }); } });
    b.on('damageApplied', c => { if (c.target === e) successes++; });
    assert.equal(b.dealDamage({ source: u, target: e, amount: 1000, type: 'phys',
      attackType: 'NORMAL', applyWay: 'RANGED', isAttack: true }), 0);
    assert.deepEqual(stages, [{ amount: 1000 - defense, defense: defense - 21 }]);
    assert.deepEqual(observed, [{ amount: 0, cancelled: true, loot: 27 }]);
    assert.equal(e.hp, hp);
    assert.equal(e.findBuff('ab:hitShield'), null);
    assert.equal(successes, 0, 'stealing does not turn an absorbed instance into successful damage');
    approx(b.dealDamage({ source: null, target: e, amount: 1000, type: 'phys' }), 1000 - defense + 21, 'later input uses the debuffed DEF');
    assert.deepEqual(u.mem.narantLoot, { a: 27, d: 21 }, 'source-less follow-up does not steal again');
    done(h);
  }
});
