// test/content/op_demetr.test.js — the 自选 operator kit of 贝洛内 (char_4037_demetr, 6★ 斗士; kit
// server/sim/content/kits/ops/op-demetr.js) and his summon 牵绊 (token_10065_demetr_dmtpos), fielded the production way (a
// DIY slot + its `diy` pick, simdata getDiy) in every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite
// (E2 Lv60, rank 7) with no module or FGT-Y “实用的工具” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from
// data/backups.json (the form of that slot status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_demetr.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { BOND, MEANS_KEY, MEANS_SLUG_KEY, STREET_KEY, UNDEAD_KEY, RETURN_UNDYING } from '../../server/sim/content/kits/ops/op-demetr.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const DEMETR = 'char_4037_demetr';
const FORMS = BACKUPS.units[DEMETR].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const FGTY = 'uniequip_002_demetr';
const S1 = 'skchr_demetr_1', S2 = 'skchr_demetr_2', S3 = 'skchr_demetr_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const talentOf = (u, i) => u.def.raw.talents.find((t) => t.index === i)?.bb ?? {};
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_armor: dummy('enemy_armor', { def: 1000 }), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_elite: dummy('enemy_elite', { rank: 'ELITE' }), enemy_hit: dummy('enemy_hit', { atk: 3000, bat: 1 }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, FGTY].map((m) => [t, true, m]))];

/** A battle with 贝洛内 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 2, row = 10, col = 5, others = [], seed = 5, rows = null } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed, ...(rows ? { flat: { rows } } : {}),
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'deploy', 'death'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: DEMETR, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
const moves = (h, u) => h.hooksOf('deploy').filter((c) => c.unit === u && c.move);
const bondOf = (h) => h.b.allyUnits.find((a) => a.kind === 'token' && a.defId === BOND && a.alive) ?? null;
const noSp = (h, u) => h.b.addBuff(u, { key: 'test:noSp', flags: { noSp: true } });   // 阻回: the MANUAL skill stays off
const meansOf = (e) => e.findBuff(MEANS_KEY)?.data?.stacks ?? 0;
/** Every 【手段】 on an enemy: the lone source keeps MEANS_KEY; each further 贝洛内 is MEANS_KEY#id. */
const meansRecs = (e) => e.buffs.filter((b) => b.key === MEANS_KEY || (typeof b.key === 'string' && b.key.startsWith(`${MEANS_KEY}#`)));
const recOf = (e, u) => meansRecs(e).find((b) => b.data?.src === u) ?? null;
const hold = (h, u, key) => h.b.addBuff(u, { key, flags: { disarm: true } });
const cutMul = (pct, stacks) => Math.max(0, 1 - pct * stacks);
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

test('贝洛内 in every 自选 form: his operator kit (all three skills authored), the form\'s stats + module attributes, 1-1, blocks 1, melee ground-only, 0.78 s, 叙拉古, no 特质', () => {
  assert.equal(OPERATOR_KITS[DEMETR], KITS[DEMETR]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [DEMETR, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.base.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.sub, u.base.bat, u.dmgType], [1, 'melee', false, 'fighter', 0.78, 'phys'], `${label(f)}: 斗士`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds, u.def.raw.nationId], [['siracusaShip'], [], 'siracusa'], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target him`);
      done(h);
    }
  }
  // full potential: E2 Lv1 2152 / 514 / 298, E2 Lv60 2466 / 590 / 336; FGT-Y +140 / +50 → +230 / +80
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [2152, 514, 2466, 590]);
  assert.deepEqual([modOf(5, FGTY).attr, modOf(6, FGTY).attr], [{ maxHp: 140, atk: 50 }, { maxHp: 230, atk: 80 }]);
});

test('a 自选 pick: 贝洛内 is offered at tiers 5 and 6 and a roster with him passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(DEMETR));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(DEMETR), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: DEMETR, skillIndex: 2, uniEquipId: FGTY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: DEMETR, skillIndex: 2, uniEquipId: FGTY } } });
});

test('FGT-Y “实用的工具”: ASPD +10 while his HP is above 50 % (stages 1 and 3); none without it', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    const on = elite && mod === FGTY;
    if (on) assert.deepEqual(u.def.raw.trait.bb, { attack_speed: 10, hp_ratio: 0.5 }, label(f));
    h.step();
    assert.equal(u.s.aspd, 100 + (on ? 10 : 0), `${label(f)}: full HP`);
    u.hp = u.s.maxHp * 0.5;
    h.step();
    assert.equal(u.s.aspd, 100, `${label(f)}: at 50 %`);
    u.hp = u.s.maxHp * 0.51;
    h.step();
    assert.equal(u.s.aspd, 100 + (on ? 10 : 0), `${label(f)}: above again`);
    done(h);
  }
});

test('T1 家族手段: each attack hit puts one more 【手段】 stack on its target before its damage (DEF ×(1 − 7 % × n), FGT-Y stage 3: 8 %; at most 5) for 10 s; and his damage ×1 → ×1.36 (×1.5) linearly as the target falls from 100 % to 20 % HP', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    noSp(h, u);
    const t = talentOf(u, 0);
    const y3 = elite && mod === FGTY && tier === 6;
    assert.deepEqual([t['attack@def'], t['attack@limited_stack_cnt'], t['attack@s2_limited_stack_cnt'], t['attack@def_dec_duration'], t.min_hp_ratio, t.max_hp_ratio, t.max_add_on_scale],
      [y3 ? -0.08 : -0.07, 5, 8, 10, 1, 0.2, y3 ? 0.5 : 0.36], `${label(f)}: the talent of the form`);
    const pct = -t['attack@def'];
    const e = h.spawn('enemy_armor', { pos: [10, 6] });
    const n0 = atkHits(h, u).length;
    h.run(8);
    const hits = atkHits(h, u).slice(n0);
    assert.ok(hits.length >= 7, `${label(f)}: ${hits.length} attacks`);
    hits.forEach((c, i) => {
      const k = Math.min(5, i + 1);
      approx(c.amount, Math.max(u.s.atk - 1000 * (1 - pct * k), u.s.atk * 0.05), `${label(f)}: attack ${i + 1} at ${k} stack(s)`);
    });
    assert.equal(meansOf(e), 5, `${label(f)}: 5 at most`);
    approx(e.s.def, 1000 * (1 - pct * 5), `${label(f)}: DEF ×${1 - pct * 5} (final multiplier)`);
    // the HP bonus: 60 % HP ⇒ halfway; 20 % HP and below ⇒ the most
    for (const [ratio, frac] of [[0.6, 0.5], [0.2, 1], [0.05, 1]]) {
      e.hp = e.s.maxHp * ratio;
      const m0 = atkHits(h, u).length;
      h.runUntil(() => atkHits(h, u).length > m0, 3);
      const c = atkHits(h, u)[m0];
      approx(c.amount, Math.max(u.s.atk - e.s.def, u.s.atk * 0.05) * (1 + t.max_add_on_scale * frac), `${label(f)}: at ${ratio * 100} % HP ×${1 + t.max_add_on_scale * frac}`);
    }
    // 10 s after the last hit it is gone
    h.b.retreat(u);
    h.run(9.5);
    assert.equal(meansOf(e), 5, `${label(f)}: still there after 9.5 s`);
    h.run(0.6);
    assert.equal(e.findBuff(MEANS_KEY), null, `${label(f)}: gone 10 s after his last hit`);
    approx(e.s.def, 1000, `${label(f)}: DEF back`);
    done(h);
  }
});

test('T2 街头直觉: 80 % physical and arts dodge from every deployment, −2 % each second for 20 s, then 40 % for good', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    const t = talentOf(u, 1);
    assert.deepEqual([t.init_prob, t.dec_prob, t.trig_cnt], [0.8, 0.02, 20], label(f));
    approx(u.s.dodgePhys, 0.8, `${label(f)}: at the deployment`);
    assert.deepEqual(u.findBuff(STREET_KEY)?.mods, { dodgePhys: 0.8, dodgeArts: 0.8 }, `${label(f)}: one buff, both types`);
    approx(u.s.dodgeArts, 0.8, `${label(f)}: arts too`);
    h.run(1.02);
    approx(u.s.dodgePhys, 0.78, `${label(f)}: after 1 s`);
    h.run(9);
    approx(u.s.dodgePhys, 0.6, `${label(f)}: after 10 s`);
    h.run(10);
    approx(u.s.dodgePhys, 0.4, `${label(f)}: after 20 s`);
    h.run(30);
    approx(u.s.dodgeArts, 0.4, `${label(f)}: stays 40 %`);
    const e = h.spawn('enemy_dummy', { pos: [11, 8] });
    let dodged = 0;
    for (let i = 0; i < 400; i++) { u.hp = u.s.maxHp; if (h.b.dealDamage(e, u, { amount: 10, type: i % 2 ? 'phys' : 'arts' }) === 0) dodged++; }
    assert.ok(Math.abs(dodged / 400 - 0.4) < 0.07, `${label(f)}: ${dodged} / 400 dodged`);
    h.b.retreat(u);
    h.b.redeploy(u);
    h.step();
    approx(u.s.dodgePhys, 0.8, `${label(f)}: a new deployment starts again`);
    done(h);
  }
});

test('S1 家主的余裕 (AUTO, attack SP 4, data DEFAULT): the next attack strikes twice for 180 % / 210 % ATK — two 【手段】 stacks', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, FGTY]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    assert.deepEqual([u.skill.rule, u.skill.spType, u.skill.spCost, sk.skillType, sk.bb.atk_scale], ['DEFAULT', 'attack', 4, 'AUTO', elite ? 2.1 : 1.8], `T${tier}`);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => atkHits(h, u).some((c) => c.dmg.isSkill), 20), `T${tier}: cast`);
    const sk1 = atkHits(h, u).filter((c) => c.dmg.isSkill);
    assert.equal(sk1.length, 2, `T${tier}: two strikes`);
    assert.equal(atkHits(h, u).filter((c) => !c.dmg.isSkill).length, 4, `T${tier}: on the 5th attack`);
    // (×1.0000x: the target's HP is not quite full any more — 家族手段's HP bonus)
    for (const c of sk1) approx(c.amount, u.s.atk * sk.bb.atk_scale, `T${tier}: ${sk.bb.atk_scale * 100} %`, 1e-4);
    assert.equal(meansOf(e), 5, `T${tier}: 4 plain + 2 strikes ⇒ capped at 5`);
    done(h);
  }
});

test('S2 军师的手段 (MANUAL, data ACTIVE_RANGE on its 3-13): 15 / 18 s, range 3-13, ASPD +40 / +60, three targets at 155 % / 170 %; 【手段】 up to 8 with 停顿 at 8, back to 5 within 0.1 s after (or once he leaves)', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, FGTY]]) {
    const sk = skillOf(tier, elite, S2);
    const b = sk.bb;
    assert.deepEqual([sk.duration, b.attack_speed, b['attack@max_target'], b['attack@atk_scale'], sk.rangeId], [elite ? 18 : 15, elite ? 60 : 40, 3, elite ? 1.7 : 1.55, '3-13'], `T${tier}`);
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    assert.deepEqual([u.skill.rule, sk.trigger.rawRule], ['ACTIVE_RANGE', 'DEFAULT'], `T${tier}: the owner's ACTIVE_RANGE rule`);
    assert.deepEqual(sk.trigger.customRangeGrid, sk.rangeGrid);
    u.skill.gainSp(999);
    const far = h.spawn('enemy_dummy', { pos: [10, 8] });   // [0, 3]: only in the 3-13
    assert.ok(h.runUntil(() => u.skill.active, 2), `T${tier}: cast with an enemy in the 3-13 only`);
    approx(u.skill.timeLeft, sk.duration, `T${tier}: ${sk.duration} s`, 0.05);
    assert.deepEqual([...u.liveRangeGrid].sort(), [...sk.rangeGrid].sort(), `T${tier}: 3-13 while it runs`);
    assert.equal(u.s.aspd, 100 + b.attack_speed + (mod ? 10 : 0), `T${tier}: ASPD`);
    const es = [far, h.spawn('enemy_dummy', { pos: [11, 6] }), h.spawn('enemy_dummy', { pos: [9, 7] }), h.spawn('enemy_dummy', { pos: [10, 7] })];
    const t0 = h.b.time;
    h.run(6);
    const per = new Map();
    for (const c of atkHits(h, u).filter((x) => x.t > t0)) {
      per.set(c.dmg.attackId, (per.get(c.dmg.attackId) ?? new Set()).add(c.target));
      const base = u.s.atk * b['attack@atk_scale'];
      approx(c.amount, base, `T${tier}: ${b['attack@atk_scale'] * 100} %`, 0.0001);
    }
    assert.ok(per.size >= 4 && [...per.values()].every((s) => s.size === 3), `T${tier}: three targets per attack`);
    const hitOnes = es.filter((e) => meansOf(e) > 0);
    assert.ok(hitOnes.some((e) => meansOf(e) === 8), `T${tier}: 8 stacks during S2`);
    for (const e of hitOnes) {
      assert.ok(meansOf(e) <= 8);
      assert.equal(!!e.findBuff(MEANS_SLUG_KEY), meansOf(e) === 8, `T${tier}: 停顿 exactly at 8`);
      if (meansOf(e) === 8) assert.ok(e.buffs.some((x) => x.status === 'sluggish'), `T${tier}: a 停顿 status`);
    }
    h.runUntil(() => !u.skill.active, 20);
    h.run(0.12);
    for (const e of hitOnes) {
      assert.equal(meansOf(e), Math.min(5, meansOf(e)), `T${tier}: back to 5`);
      assert.ok(meansOf(e) <= 5 && !e.findBuff(MEANS_SLUG_KEY), `T${tier}: no 停顿 after`);
    }
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `T${tier}: 1-1 again`);
    done(h);
  }
  // he leaves the field during S2 ⇒ back to 5 at the next update
  const { h, u } = field({ tier: 6, elite: true, mod: FGTY, skill: 1 });
  u.skill.gainSp(999);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.runUntil(() => meansOf(e) === 8, 20);
  assert.ok(u.skill.active);
  h.b.retreat(u);
  h.run(0.12);
  assert.equal(meansOf(e), 5, 'he left: 5');
  done(h);
});

test('S3 清算 (MANUAL, data CUSTOM_RANGE on x-2): 30 s, ATK +110 / 140 %, ASPD +30 / +40; he 【移动】s onto the first ground target of the x-2 (dodge back to 80 %), leaves 牵绊 on his tile; 35 / 40 % of his hits ×1.4 / 1.5', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, FGTY]]) {
    const sk = skillOf(tier, elite, S3);
    const b = sk.bb;
    assert.deepEqual([sk.duration, b['attack@demetr_s3[bonus].atk'], b['attack@demetr_s3[bonus].attack_speed'], b['attack@demetr_s3[bonus].prob'], b['attack@demetr_s3[bonus].prob_atk_scale'], sk.overrideTokenKey],
      [30, elite ? 1.4 : 1.1, elite ? 40 : 30, elite ? 0.4 : 0.35, elite ? 1.5 : 1.4, BOND], `T${tier}`);
    const { h, u } = field({ tier, elite, mod, skill: 2, seed: 13 });
    assert.deepEqual([u.skill.rule, sk.trigger.rawRule, sk.trigger.customRangeGrid.length], ['CUSTOM_RANGE', 'CUSTOM_RANGE_SEARCH_ENEMY', 21], `T${tier}: x-2 (21 tiles)`);
    h.run(10);
    u.skill.gainSp(999);
    h.run(1);
    assert.equal(u.skill.activations, 0, `T${tier}: no enemy around, no cast`);
    assert.ok(u.s.dodgePhys < 0.8, 'his dodge decayed');
    const e = h.spawn('enemy_dummy', { pos: [11, 7] });   // [1, 2] of his x-2
    assert.ok(h.runUntil(() => u.skill.active, 1), `T${tier}: cast`);
    assert.deepEqual([u.tileR, u.tileC], [11, 7], `T${tier}: moved onto its tile`);
    assert.equal(moves(h, u).length, 1, `T${tier}: one 【移动】`);
    approx(u.s.dodgePhys, 0.8, `T${tier}: 街头直觉 restarts with the 【移动】`);
    approx(u.s.atk, u.base.atk * (1 + b['attack@demetr_s3[bonus].atk']), `T${tier}: ATK +${b['attack@demetr_s3[bonus].atk'] * 100} %`);
    assert.equal(u.s.aspd, 100 + b['attack@demetr_s3[bonus].attack_speed'] + (mod ? 10 : 0), `T${tier}: ASPD`);
    const bond = bondOf(h);
    assert.ok(bond, `T${tier}: 牵绊`);
    assert.deepEqual([bond.tileR, bond.tileC, bond.ownerUnit === u, bond.s.flags.invulnerable, bond.s.flags.untargetable, bond.s.flags.isolated, bond.profile.noAttack, bond.s.blockCnt],
      [10, 5, true, true, true, true, true, 0], `T${tier}: on his tile, 无敌 / untargetable / 孤立, no attack, blocks nothing`);
    assert.equal(h.b.isReservedTile(10, 5), true, `T${tier}: nobody else deploys there`);
    // the crits
    const t0 = h.b.time;
    u.skill.extend(200);
    h.run(150);
    const hits = atkHits(h, u).filter((c) => c.t > t0 && c.target === e);
    const atk = u.s.atk;
    const big = hits.filter((c) => Math.abs(c.amount - atk * b['attack@demetr_s3[bonus].prob_atk_scale'] * (c.dmg.mul ?? 1)) < 1e-3 * atk).length;
    const plain = hits.filter((c) => Math.abs(c.amount - atk * (c.dmg.mul ?? 1)) < 1e-3 * atk).length;
    assert.equal(big + plain, hits.length, `T${tier}: every hit is ×1 or ×${b['attack@demetr_s3[bonus].prob_atk_scale']}`);
    assert.ok(Math.abs(big / hits.length - b['attack@demetr_s3[bonus].prob']) < 0.06, `T${tier}: ${big} / ${hits.length} ≈ ${b['attack@demetr_s3[bonus].prob']}`);
    done(h);
  }
});

test('S3 清算 targets: ground enemies only, on a tile he may take (melee-buildable low ground, nobody but him / 牵绊) — else he 【移动】s in place once; another target 1 s after his last damage, at once when the elite he attacked falls; moving home retreats 牵绊 first', () => {
  // (a) a flyer and an enemy on a floor tile (build NONE): an in-place move, 牵绊 never placed
  {
    const rows = { 11: '##hrrrfrrrfrrrrrrrf##' };   // (11, 6) = floor
    const { h, u } = field({ tier: 6, elite: true, mod: FGTY, skill: 2, rows });
    assert.equal(h.b.grid.canStand(11, 6), false);
    h.spawn('enemy_fly', { pos: [10, 6] });
    const onFloor = h.spawn('enemy_dummy', { pos: [11, 6] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1), 'cast (the flyer counts for CUSTOM_RANGE)');
    assert.deepEqual([u.tileR, u.tileC, moves(h, u).length, !!bondOf(h)], [10, 5, 1, false], 'an in-place 【移动】, no 牵绊');
    assert.ok(onFloor.alive);
    done(h);
  }
  // (b) the idle re-target, the elite re-target, home
  {
    const { h, u } = field({ tier: 6, elite: true, mod: FGTY, skill: 2 });
    const e1 = h.spawn('enemy_dummy', { pos: [11, 7] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1));
    assert.deepEqual([u.tileR, u.tileC], [11, 7]);
    h.run(2);
    h.b.kill(e1, null);
    const last = Math.max(...atkHits(h, u).map((c) => c.t));
    const e2 = h.spawn('enemy_dummy', { pos: [9, 6] });
    assert.ok(h.runUntil(() => u.tileR === 9 && u.tileC === 6, 3), 'the next target');
    assert.ok(h.b.time >= last + 1 - 1e-6 && h.b.time <= last + 1 + 0.1, `1 s after his last damage (${h.b.time} vs ${last})`);
    assert.equal(moves(h, u).length, 2);
    assert.deepEqual([bondOf(h).tileR, bondOf(h).tileC], [10, 5], 'one 牵绊, still on his tile');
    assert.equal(h.b.allyUnits.filter((a) => a.kind === 'token' && a.alive).length, 1);
    // the elite he attacks falls ⇒ at once (the next tick), not 1 s later
    h.b.kill(e2, null);
    const el = h.spawn('enemy_elite', { pos: [9, 6] });   // on his tile
    h.runUntil(() => atkHits(h, u).some((c) => c.target === el), 2);
    const home = h.spawn('enemy_dummy', { pos: [10, 5] });   // on 牵绊's tile: his located tile
    h.b.kill(el, null);
    const tk = h.b.time;
    assert.ok(h.runUntil(() => u.tileR === 10 && u.tileC === 5, 0.2), 'back home on the next tick');
    assert.ok(h.b.time - tk < 0.05, 'at once');
    assert.equal(bondOf(h), null, '牵绊 retreated first (his located tile)');
    assert.ok(home.alive);
    // the end: a 【返回】 in place, the SP emptied, a short 不死
    h.runUntil(() => !u.skill.active, 40);
    assert.deepEqual([u.tileR, u.tileC], [10, 5]);
    assert.ok(u.skill.sp < 0.1, `SP emptied (${u.skill.sp})`);
    assert.equal(moves(h, u).length, 4, 'cast, idle, elite, return');
    done(h);
  }
});

test('S3 清算: a lethal hit while it runs ⇒ 不死 / untargetable / no block / 禁疗, the skill ends at once and he returns (a short 不死 after); away without 牵绊 at the end ⇒ forced retreat', () => {
  {
    const { h, u } = field({ tier: 5, elite: false, skill: 2 });
    const e = h.spawn('enemy_dummy', { pos: [11, 7] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1));
    assert.deepEqual([u.tileR, u.tileC], [11, 7]);
    h.b.dealDamage(e, u, { amount: 1e7, type: 'true' });
    assert.ok(u.alive, 'not knocked out');
    assert.ok(u.hp >= 1 && u.hp <= 1.0001, 'held at 1 HP');
    assert.deepEqual([u.s.flags.untargetable, u.s.flags.noBlock, u.s.flags.healFree], [true, true, true], 'demetr_s3[undeadable]');
    h.b.dealDamage(e, u, { amount: 1e7, type: 'true' });
    assert.ok(u.alive, 'still 不死 until the skill ends');
    h.step();
    h.step();
    assert.ok(!u.skill.active, 'the skill ended');
    assert.deepEqual([u.tileR, u.tileC, !!bondOf(h), !!u.findBuff(UNDEAD_KEY)], [10, 5, false, false], 'returned home');
    assert.equal(h.hooksOf('skillEnd').find((c) => c.unit === u)?.reason, 'fatal');
    h.b.dealDamage(e, u, { amount: 1e7, type: 'true' });
    assert.ok(u.alive, `a short 不死 after the return (${RETURN_UNDYING} s)`);
    h.run(RETURN_UNDYING + 0.05);
    h.b.dealDamage(e, u, { amount: 1e7, type: 'true' });
    assert.ok(!u.alive, 'then a knock-out');
    done(h);
  }
  {
    const { h, u } = field({ tier: 6, elite: true, mod: FGTY, skill: 2 });
    h.spawn('enemy_dummy', { pos: [9, 6] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1));
    h.b.retreat(bondOf(h), { reason: 'expired', permanent: true });
    h.runUntil(() => !u.skill.active, 40);
    assert.ok(!u.alive && u.removeReason === 'retreat', 'forced retreat');
    assert.ok(h.b.isDown(u), 'lies down and redeploys by the normal rule');
    done(h);
  }
  // 牵绊 belongs to S3: never under S1 / S2
  for (const skill of [0, 1]) {
    const { h, u } = field({ tier: 6, elite: true, mod: FGTY, skill });
    for (const pos of [[10, 6], [11, 7], [9, 6]]) h.spawn('enemy_dummy', { pos });
    u.skill.gainSp(999);
    h.run(30);
    assert.equal(h.b.allyUnits.filter((a) => a.kind === 'token').length, 0, `S${skill + 1}: no 牵绊`);
    assert.equal(moves(h, u).length, 0, `S${skill + 1}: no 【移动】`);
    done(h);
  }
});

test('two 贝洛内 on one enemy: one 【手段】 each (stacks, timer); only the higher DEF cut acts; one 贝洛内 stays on MEANS_KEY', () => {
  // A: E2 7 % per stack. B: FGT-Y stage 3, 8 % per stack. Shared stacks would become 5 × 8 % on B's first hit.
  const { h, u: a } = field({
    tier: 5, elite: true, mod: null, skill: 2, row: 10, col: 5,
    others: [{ uid: 2, dir: 'LEFT', elite: true, row: 10, col: 7, diy: { slot: 'chess_char_6_diy2_a', charId: DEMETR, skillIndex: 2, uniEquipId: FGTY } }],
  });
  const b = h.unit(2);
  noSp(h, a);
  noSp(h, b);
  const pa = -talentOf(a, 0)['attack@def'];
  const pb = -talentOf(b, 0)['attack@def'];
  assert.deepEqual([pa, pb], [0.07, 0.08]);
  hold(h, b, 'test:holdB');
  const e = h.spawn('enemy_armor', { pos: [10, 6] });
  assert.ok(h.runUntil(() => meansOf(e) === 5, 20), 'A reaches 5');
  hold(h, a, 'test:holdA');
  approx(e.s.def, 1000 * cutMul(pa, 5), 'A alone: DEF ×(1 − 7 % × 5)');
  assert.equal(meansRecs(e).length, 1, 'one source keeps a single buff');
  assert.equal(e.findBuff(MEANS_KEY)?.data?.src, a);
  const leftA = e.findBuff(MEANS_KEY).timeLeft;
  h.run(3);
  const afterWait = recOf(e, a).timeLeft;
  assert.ok(afterWait < leftA - 2.5 && afterWait > leftA - 3.5, `A's timer ran: ${leftA} → ${afterWait}`);
  h.b.removeBuff(b, 'test:holdB');
  const n0 = atkHits(h, b).length;
  assert.ok(h.runUntil(() => atkHits(h, b).length > n0, 8), 'B lands one hit');
  hold(h, b, 'test:holdB');
  const ra = recOf(e, a), rb = recOf(e, b);
  assert.ok(ra && rb && ra !== rb, 'one 【手段】 per 贝洛内');
  assert.equal(ra.data.stacks, 5, 'A stays at 5');
  assert.equal(rb.data.stacks, 1, 'B starts at 1');
  assert.ok(rb.timeLeft > 9 && ra.timeLeft < 8, `timers stay apart (A ${ra.timeLeft}, B ${rb.timeLeft})`);
  approx(e.s.def, 1000 * cutMul(pa, 5), 'the higher cut is A\'s 35 %, not 5 × 8 % and not a product');
  assert.ok(Math.abs(ra.mods.defMul - cutMul(pa, 5)) < 1e-9 && Math.abs(rb.mods.defMul - 1) < 1e-9, 'only the winner multiplies DEF');
  // B catches up to 5 × 8 %: that cut (40 %) overtakes A's 35 %.
  h.b.removeBuff(b, 'test:holdB');
  assert.ok(h.runUntil(() => (recOf(e, b)?.data?.stacks ?? 0) >= 5, 15), 'B reaches 5');
  hold(h, b, 'test:holdB');
  assert.equal(recOf(e, a).data.stacks, 5, 'A still 5');
  assert.equal(recOf(e, b).data.stacks, 5, 'B capped at 5');
  approx(e.s.def, 1000 * cutMul(pb, 5), 'now B\'s 40 %');
  assert.ok(Math.abs(e.s.def - 1000 * cutMul(pa, 5) * cutMul(pb, 5)) > 50, 'the two cuts do not multiply');
  done(h);

  // a single 贝洛内 is unchanged: one MEANS_KEY, 5 stacks, DEF ×(1 − 7 % × 5), gone 10 s after the last hit
  const one = field({ tier: 5, elite: true, mod: null, skill: 2 });
  noSp(one.h, one.u);
  const e1 = one.h.spawn('enemy_armor', { pos: [10, 6] });
  assert.ok(one.h.runUntil(() => meansOf(e1) === 5, 20));
  assert.equal(meansRecs(e1).length, 1);
  assert.equal(e1.findBuff(MEANS_KEY)?.key, MEANS_KEY);
  approx(e1.s.def, 1000 * 0.65, 'single source DEF');
  one.h.b.retreat(one.u);
  one.h.run(9.5);
  assert.equal(meansOf(e1), 5);
  one.h.run(0.6);
  assert.equal(e1.findBuff(MEANS_KEY), null);
  done(one.h);
});

test('two 贝洛内: S2 ending or leaving drops only that source\'s stacks; 停顿 follows the source still at 8', () => {
  const { h, u: a } = field({
    tier: 5, elite: false, skill: 1, row: 10, col: 5,
    others: [{ uid: 2, dir: 'LEFT', elite: false, row: 10, col: 7, diy: { slot: 'chess_char_5_diy2_a', charId: DEMETR, skillIndex: 1 } }],
  });
  const b = h.unit(2);
  const pct = -talentOf(a, 0)['attack@def'];
  assert.equal(pct, 0.07);
  assert.equal(-talentOf(b, 0)['attack@def'], pct);
  hold(h, b, 'test:holdB');
  const e = h.spawn('enemy_armor', { pos: [10, 6] });
  a.skill.gainSp(999);
  b.skill.gainSp(999);
  assert.ok(h.runUntil(() => a.skill.active && meansOf(e) === 8 && e.findBuff(MEANS_SLUG_KEY), 20), 'A at 8 with 停顿');
  hold(h, a, 'test:holdA');
  h.b.removeBuff(b, 'test:holdB');
  const n0 = atkHits(h, b).length;
  assert.ok(h.runUntil(() => atkHits(h, b).length >= n0 + 3, 15), 'B lands 3');
  hold(h, b, 'test:holdB');
  h.run(0.25); // the old shared buff would have fallen back to 5 within 0.1 s of B's hit
  assert.equal(recOf(e, a)?.data?.stacks, 8, 'A stays at 8 while his S2 is on');
  assert.equal(recOf(e, b)?.data?.stacks, 3, 'B\'s own stacks');
  assert.ok(e.findBuff(MEANS_SLUG_KEY), '停顿 while A is at 8');
  approx(e.s.def, 1000 * cutMul(pct, 8), 'DEF follows A\'s 8, not 8 + 3');
  a.skill.end('test');
  h.run(0.2);
  assert.equal(recOf(e, a).data.stacks, 5, 'A back to 5 on the 0.1 s tick');
  assert.equal(recOf(e, b).data.stacks, 3, 'B unchanged');
  assert.equal(e.findBuff(MEANS_SLUG_KEY), null, '停顿 ends with A\'s cap');
  approx(e.s.def, 1000 * cutMul(pct, 5), 'DEF is now A\'s 5');
  // both at 8: ending A's S2 leaves B's 8 and the 停顿
  h.b.removeBuff(a, 'test:holdA');
  h.b.removeBuff(b, 'test:holdB');
  a.skill.gainSp(999);
  b.skill.gainSp(999); // ignored while B's S2 is still up; refills him if the 15 s already ended
  assert.ok(h.runUntil(() => a.skill.active && b.skill.active && recOf(e, a)?.data?.stacks === 8 && recOf(e, b)?.data?.stacks === 8, 25), 'both at 8');
  hold(h, a, 'test:holdA');
  hold(h, b, 'test:holdB');
  a.skill.end('test');
  h.run(0.2);
  assert.equal(recOf(e, a).data.stacks, 5, 'only A drops');
  assert.equal(recOf(e, b).data.stacks, 8, 'B keeps 8 while his S2 is on');
  assert.ok(e.findBuff(MEANS_SLUG_KEY), '停顿 follows B');
  approx(e.s.def, 1000 * cutMul(pct, 8), 'DEF follows B');
  done(h);

  // leaving the field drops only that source (from 8 back to 5). B is below 8, so 停顿 ends.
  const left = field({
    tier: 5, elite: false, skill: 1, row: 10, col: 5,
    others: [{ uid: 2, dir: 'LEFT', elite: false, row: 10, col: 7, diy: { slot: 'chess_char_5_diy2_a', charId: DEMETR, skillIndex: 1 } }],
  });
  const a2 = left.u, b2 = left.h.unit(2);
  hold(left.h, b2, 'test:holdB');
  const e2 = left.h.spawn('enemy_armor', { pos: [10, 6] });
  a2.skill.gainSp(999);
  assert.ok(left.h.runUntil(() => a2.skill.active && recOf(e2, a2)?.data?.stacks === 8, 20), 'A at 8');
  hold(left.h, a2, 'test:holdA');
  left.h.b.removeBuff(b2, 'test:holdB');
  const n1 = atkHits(left.h, b2).length;
  assert.ok(left.h.runUntil(() => atkHits(left.h, b2).length >= n1 + 2, 12), 'B at least 2');
  hold(left.h, b2, 'test:holdB');
  const bStacks = recOf(e2, b2).data.stacks;
  assert.ok(bStacks >= 2 && bStacks < 8, `B has his own stacks (${bStacks})`);
  left.h.b.retreat(a2);
  left.h.run(0.2);
  assert.equal(recOf(e2, a2).data.stacks, 5, 'the one who left is back at 5');
  assert.equal(recOf(e2, b2).data.stacks, bStacks, 'the other source is untouched');
  assert.equal(e2.findBuff(MEANS_SLUG_KEY), null, '停顿 ends when the source at 8 has left');
  approx(e2.s.def, 1000 * cutMul(pct, 5), 'DEF follows the remaining higher cut');
  done(left.h);
});
