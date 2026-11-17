// test/content/op_hsgma2.test.js — the 自选 operator kit of 斩业星熊 (char_1044_hsgma2, 6★ 驭法铁卫; kit
// server/sim/content/kits/ops/op-hsgma2.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or AST-X
// 无迹 at stage 1 (tier 5) / 3 (tier 6). Every number is read back from data/backups.json (the form of that slot status);
// the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_hsgma2.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const HSG = 'char_1044_hsgma2';
const FORMS = BACKUPS.units[HSG].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const ASTX = 'uniequip_002_hsgma2';
const S1 = 'skchr_hsgma2_1', S2 = 'skchr_hsgma2_2', S3 = 'skchr_hsgma2_3';
const TEXAS = 'chess_char_1_08_a', YAK = 'chess_char_1_02_a';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_shooter: dummy('enemy_shooter', { atk: 300, bat: 1, range: 4 }),
};
/** Every 自选 form: [tier, elite, module]. */
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, ASTX].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/** A battle with 斩业星熊 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 2, row = 10, col = 5, others = [], items = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'heal', 'skillStart', 'skillEnd', 'statusApplied', 'fatal', 'death'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: HSG, skillIndex: skill, uniEquipId: mod }, elite, row, col, items }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const skillBuff = (u) => u.findBuff(`skill:${u.id}`);
const noSp = (h, u) => h.b.addBuff(u, { key: 'test:noSp', flags: { noSp: true }, duration: Infinity });
const mine = (h, u, from = 0) => h.hooksOf('damaged').slice(from).filter((c) => c.source === u && c.target?.side === 'enemy');
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('斩业星熊 in every 自选 form: her operator kit (all three skills authored), the form\'s stats + module attributes, 1-1 range, blocks 3, melee ground-only, physical attacks while no skill runs (the data\'s arts is the skill-on type), 炎, no 特质', () => {
  assert.equal(OPERATOR_KITS[HSG], KITS[HSG]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [HSG, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def, 15], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.base.bat], [3, 'melee', false, 'phys', 1.6], `${label(f)}: 驭法铁卫`);
      assert.equal(form.dmgType, 'phys', 'the data carries the normal attack\'s type (build-data classifyAttack: "技能开启时…法术伤害")');
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['yanShip'], []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth && !u.s.flags.untargetable, `${label(f)}: ground enemies target her`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN): E2 Lv1 2592 / 533 / 461, E2 Lv60 3228 / 622 / 547; AST-X +190 / +55 → +325 / +80
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [2592, 533, 3228, 622]);
  assert.deepEqual([modOf(5, ASTX).attr, modOf(6, ASTX).attr], [{ maxHp: 190, atk: 55 }, { maxHp: 325, atk: 80 }]);
});

test('a 自选 pick: 斩业星熊 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(HSG));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(HSG), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: HSG, skillIndex: 2, uniEquipId: ASTX } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: HSG, skillIndex: 2, uniEquipId: ASTX } } });
});

test('triggers: S1 (AUTO, self buff) fires at full SP with no enemy (the kit\'s SP_FULL); S2 (AUTO) keeps the data DEFAULT; S3 (MANUAL) the data\'s ACTIVE_RANGE on its x-2 (rawRule TAKE_DAMAGE): an enemy two tiles ahead casts it, a shot from outside the x-2 does not', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const form = formOf(tier, elite);
    assert.deepEqual(form.skills.map((s) => [s.skillType, s.trigger.rule, s.trigger.rawRule]), [['AUTO', 'DEFAULT', 'DEFAULT'], ['AUTO', 'DEFAULT', 'DEFAULT'], ['MANUAL', 'ACTIVE_RANGE', 'TAKE_DAMAGE']], `T${tier}: data`);
    assert.deepEqual(form.skills[2].trigger.customRangeGrid, form.skills[2].rangeGrid, `T${tier}: the running x-2`);
    // S1: no enemy at all
    const a = field({ tier, elite, skill: 0 });
    assert.deepEqual([a.u.skill.rule, a.u.skill.spType, a.u.skill.kind], ['SP_FULL', 'hurt', 'toggle'], `T${tier} S1`);
    a.u.skill.gainSp(999);
    assert.ok(a.h.runUntil(() => a.u.skill.active, 0.2), `T${tier} S1: cast at once, no enemy`);
    done(a.h);
    // S2: waits for an attack
    const b = field({ tier, elite, skill: 1 });
    assert.deepEqual([b.u.skill.rule, b.u.skill.spType], ['DEFAULT', 'attack'], `T${tier} S2`);
    b.u.skill.gainSp(999);
    b.h.run(2);
    assert.equal(b.u.skill.activations, 0, `T${tier} S2: no target, no cast`);
    b.h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(b.h.runUntil(() => b.u.skill.activations === 1, 2), `T${tier} S2: cast on her next attack`);
    done(b.h);
    // S3: the x-2
    const c = field({ tier, elite, skill: 2 });
    assert.equal(c.u.skill.rule, 'ACTIVE_RANGE', `T${tier} S3`);
    c.h.spawn('enemy_shooter', { pos: [10, 9] });
    c.u.skill.gainSp(999);
    c.h.run(3);
    assert.ok(c.h.hooksOf('damaged').some((x) => x.target === c.u), `T${tier} S3: she is being shot`);
    assert.equal(c.u.skill.activations, 0, `T${tier} S3: a hit from outside the x-2 casts nothing`);
    c.h.spawn('enemy_dummy', { pos: [10, 7] });
    assert.ok(c.h.runUntil(() => c.u.skill.activations === 1, 1), `T${tier} S3: an enemy two tiles ahead (outside her 1-1) casts it`);
    done(c.h);
  }
});

test('S1 恶业苦果 (持续时间无限): ATK / DEF +40 % / +55 %, arts attacks, every enemy attack she takes returns 100 % / 130 % ATK arts to the attacker (ranged too); it never ends on its own', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    assert.deepEqual([sk.duration, sk.spCost, sk.initSp, sk.bb.atk, sk.bb.def, sk.bb.atk_scale], [-1, 15, 0, elite ? 0.55 : 0.4, elite ? 0.55 : 0.4, elite ? 1.3 : 1], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 0 });
    const near = h.spawn('enemy_dummy', { pos: [10, 5] }), far = h.spawn('enemy_shooter', { pos: [10, 8] });
    h.run(2);
    const b0 = h.hooksOf('damaged').length;
    h.b.dealDamage(near, u, { amount: 10, type: 'phys', isAttack: true });
    assert.ok(!mine(h, u, b0).some((c) => c.dmg.tags?.includes('counter')), `T${tier}: no counter before the cast`);
    assert.ok(mine(h, u).filter((c) => c.dmg.isAttack).every((c) => c.type === 'phys'), `T${tier}: physical attacks before`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 0.2), `T${tier}: cast`);
    assert.deepEqual(skillBuff(u).mods, { atkPct: sk.bb.atk, defPct: sk.bb.def }, `T${tier}: the skill buff`);
    for (const src of [near, far]) {
      const n = h.hooksOf('damaged').length;
      h.b.dealDamage(src, u, { amount: 10, type: 'phys', isAttack: true });
      const back = mine(h, u, n).filter((c) => c.target === src && c.dmg.tags?.includes('counter'));
      assert.equal(back.length, 1, `T${tier}: a counter on ${src.defId}`);
      assert.equal(back[0].type, 'arts');
      approx(back[0].amount, u.s.atk * sk.bb.atk_scale, `T${tier}: ${sk.bb.atk_scale * 100} % ATK`);
    }
    const n1 = h.hooksOf('damaged').length;
    h.run(60);
    assert.ok(u.skill.active, `T${tier}: still on after 60 s`);
    const atk = mine(h, u, n1).filter((c) => c.dmg.isAttack && c.target === near);
    assert.ok(atk.length > 10 && atk.every((c) => c.type === 'arts'), `T${tier}: arts attacks while it runs`);
    done(h);
  }
});

test('S2 无始无明 (AUTO, attack SP 9 / 7): the cast\'s attack throws the shield — 3 hits of 55 % / 70 % ATK arts on every blocked enemy; the shield then turns 365° at 90°/s (4.06 s) around her, no SP meanwhile, her attacks of the flight in arts; then plain physical attacks and SP again', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    assert.deepEqual([sk.spCost, sk.initSp, sk.bb['attack@atk_scale'], sk.bb.shield_atk_scale, sk.bb.sluggish, sk.bb.interval, sk.bb.heal_ratio],
      [elite ? 7 : 9, 0, elite ? 0.7 : 0.55, elite ? 1.1 : 0.8, 1, 0.5, elite ? 0.15 : 0.1], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 1 });
    // two enemies on her own tile, blocked: the shield (1.2 tiles out, radius 1.0) never reaches her centre
    const a = h.spawn('enemy_dummy', { pos: [10, 5] }), b = h.spawn('enemy_dummy', { pos: [10, 5] });
    assert.ok(h.runUntil(() => u.blocking.length === 2, 1), `T${tier}: both blocked`);
    u.skill.gainSp(999);
    const n0 = h.hooksOf('damaged').length;
    assert.ok(h.runUntil(() => u.skill.active, 3), `T${tier}: cast`);
    const t0 = h.b.time;
    const throwHits = mine(h, u, n0).filter((c) => c.dmg.isAttack);
    assert.equal(new Set(throwHits.map((c) => c.dmg.attackId)).size, 1, `T${tier}: one attack`);
    for (const e of [a, b]) {
      const hits = throwHits.filter((c) => c.target === e);
      assert.equal(hits.length, 3, `T${tier}: 3 hits on each blocked enemy`);
      for (const c of hits) { assert.equal(c.type, 'arts'); approx(c.amount, u.s.atk * sk.bb['attack@atk_scale'], `T${tier}: ${sk.bb['attack@atk_scale'] * 100} %`); }
    }
    const sp0 = u.skill.sp;
    const n1 = h.hooksOf('damaged').length;
    assert.ok(h.runUntil(() => !u.skill.active, 10), `T${tier}: the turn ends it`);
    approx(h.b.time - t0, 365 / 90, `T${tier}: 365° at 90°/s`, 0.02);
    assert.equal(u.skill.sp, sp0, `T${tier}: no SP during the flight`);
    const flight = mine(h, u, n1).filter((c) => c.dmg.isAttack);
    assert.ok(flight.length >= 2 && flight.every((c) => c.type === 'arts'), `T${tier}: ${flight.length} arts attacks during it`);
    assert.ok(!mine(h, u, n1).some((c) => c.dmg.tags?.includes('hsgma2:shield')), `T${tier}: nothing within 1.0 of the shield`);
    const n2 = h.hooksOf('damaged').length;
    h.run(4);
    const after = mine(h, u, n2).filter((c) => c.dmg.isAttack);
    assert.ok(after.length > 0 && after.every((c) => c.type === 'phys' && Math.abs(c.amount - Math.max(u.s.atk * 0.05, u.s.atk)) < 1e-6), `T${tier}: plain physical attacks after`);
    assert.ok(u.skill.sp > 0, `T${tier}: attack SP again`);
    done(h);
  }
});

test('S2 shield: within 1.0 of it a targetable ground enemy slows it to 18°/s; every 0.5 s from the throw each such enemy takes 停顿 1 s and 80 % / 110 % ATK arts, and she heals 10 % / 15 % of the HP it lost (through her 禁疗 too); a flyer is untouched', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, skill: 1 });
    const front = h.spawn('enemy_dummy', { pos: [10, 6] }), fly = h.spawn('enemy_fly', { pos: [11, 5] });
    h.b.addBuff(u, { key: 'test:healFree', flags: { healFree: true, noHeal: true } }); // her 禁疗 (as in 我执)
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 3), `T${tier}: cast`);
    const t0 = h.b.time;
    const atk = u.s.atk; // at full HP (no 坚忍): the hits and heals below use it
    h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.dmg.tags?.includes('hsgma2:shield')), 1);
    u.hp = 100; // from now on her heals show in her HP (坚忍 then raises her ATK: amounts are checked on the first hit)
    h.runUntil(() => !u.skill.active, 15);
    // slowed while the shield is within 1.0 of the enemy one tile ahead: |θ| ≤ acos(0.6) at both ends of the turn
    const slow = (2 * Math.acos(0.6) * 180) / Math.PI - 0;
    const startArc = (Math.acos(0.6) * 180) / Math.PI, endArc = 365 - (360 - startArc);
    const want = startArc / 18 + endArc / 18 + (365 - startArc - endArc) / 90;
    approx(h.b.time - t0, want, `T${tier}: ${want.toFixed(2)} s with the slowed arcs (${slow.toFixed(1)}°)`, 0.02);
    const shield = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.tags?.includes('hsgma2:shield'));
    assert.ok(shield.length >= 10 && shield.every((c) => c.target === front && c.type === 'arts'), `T${tier}: ${shield.length} shield hits, the front enemy only`);
    approx(shield[0].amount, atk * sk.bb.shield_atk_scale, `T${tier}: ${sk.bb.shield_atk_scale * 100} % ATK`);
    const sl = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'sluggish');
    assert.equal(sl.length, shield.length, `T${tier}: 停顿 with every hit`);
    assert.ok(sl.every((c) => c.target === front && Math.abs(c.duration - 1) < 1e-9), `T${tier}: 1 s`);
    const heals = h.hooksOf('heal').filter((c) => c.target === u && c.source === u);
    assert.ok(heals.length >= shield.length, `T${tier}: a heal per hit`);
    approx(heals[0].amount, shield[0].amount * sk.bb.heal_ratio, `T${tier}: ${sk.bb.heal_ratio * 100} % of the HP lost`);
    assert.ok(u.hp > 100, `T${tier}: healed through 禁疗`);
    assert.ok(!h.hooksOf('damaged').some((c) => c.source === u && c.target === fly), `T${tier}: the flyer untouched`);
    done(h);
  }
});

test('S3 地狱变相 (32 s): range x-2, max HP +55 % / +70 %, ATK +150 % / +180 %, two arts hits on up to 2 enemies — air units too; back to 1-1 and physical after', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    assert.deepEqual([sk.duration, sk.spCost, sk.initSp, sk.rangeId, sk.bb.max_hp, sk.bb.atk, sk.bb['attack@max_target'], sk.bb.before_dead_duration],
      [32, elite ? 50 : 55, elite ? 31 : 28, 'x-2', elite ? 0.7 : 0.55, elite ? 1.8 : 1.5, 2, 11], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 2 });
    const fly = h.spawn('enemy_fly', { pos: [10, 7] });
    const g1 = h.spawn('enemy_dummy', { pos: [9, 6] }), g2 = h.spawn('enemy_dummy', { pos: [11, 6] }), g3 = h.spawn('enemy_dummy', { pos: [10, 6] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1), `T${tier}: cast`);
    assert.deepEqual(skillBuff(u).mods, { hpPct: sk.bb.max_hp, atkPct: sk.bb.atk }, `T${tier}: the skill buff`);
    approx(u.s.maxHp, u.base.maxHp * (1 + sk.bb.max_hp), `T${tier}: max HP`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: x-2 while it runs`);
    const n0 = h.hooksOf('damaged').length;
    h.run(6);
    const atk = mine(h, u, n0).filter((c) => c.dmg.isAttack);
    const byAttack = new Map();
    for (const c of atk) byAttack.set(c.dmg.attackId, [...(byAttack.get(c.dmg.attackId) ?? []), c]);
    assert.ok(byAttack.size >= 2, `T${tier}: attacks`);
    for (const [, list] of byAttack) {
      const targets = new Set(list.map((c) => c.target.id));
      assert.equal(targets.size, 2, `T${tier}: two of the four enemies on her x-2 per attack`);
      for (const id of targets) assert.equal(list.filter((c) => c.target.id === id).length, 2, `T${tier}: two hits each`);
      assert.ok(list.every((c) => c.type === 'arts'), `T${tier}: arts`);
    }
    // with the ground enemies gone, the flyer on her x-2 is struck (技能期间攻击可对空)
    for (const g of [g1, g2, g3]) h.b.kill(g, null);
    const n1 = h.hooksOf('damaged').length;
    h.run(3);
    assert.ok(mine(h, u, n1).some((c) => c.target === fly && c.dmg.isAttack && c.type === 'arts'), `T${tier}: air units too`);
    u.skill.extend(-999);
    h.step();
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `T${tier}: back to 1-1`);
    approx(u.s.maxHp, u.base.maxHp, `T${tier}: max HP back`);
    done(h);
  }
});

test('S3 临死模式 (a 主动关闭 only — no strategy of this mode closes it): 11 s with the bonuses kept, four hits, 阻回 + 沉默 + 不死; an allied operator on her range survives at 1 HP and the excess is her 流失, one outside falls; then she leaves the field; a plain stop or the time running out does nothing of it', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const { h, u } = field({ tier, elite, skill: 2, others: [{ uid: 2, chessId: TEXAS, row: 11, col: 6 }, { uid: 3, chessId: YAK, row: 12, col: 9 }] });
    const tex = h.unit(2), yak = h.unit(3);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1), `T${tier}: cast`);
    h.run(2);
    u.skill.end('manual');
    assert.ok(u.skill.active && u.mem.hsDying, `T${tier}: the 临死模式 keeps the skill running`);
    approx(u.skill.timeLeft, 11, `T${tier}: 11 s`);
    assert.deepEqual(u.findBuff('skill:hsgma2:dying')?.flags, { noSp: true, silence: true }, `T${tier}: 阻回 + 沉默`);
    assert.equal(u.skill.spec.attack.hits, 4, `T${tier}: four hits`);
    assert.ok(skillBuff(u), `T${tier}: the bonuses stay`);
    assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === u).length, 1, `T${tier}: no second cast`);
    // 不死 for her …
    h.b.dealDamage(e, u, { amount: 1e9, type: 'true' });
    assert.ok(u.alive, `T${tier}: she cannot be knocked out`);
    // … and for 德克萨斯 on her x-2 (the excess becomes her 流失); 角峰 outside falls
    const over = 500;
    h.b.dealDamage(e, tex, { amount: tex.hp + over, type: 'true' });
    assert.deepEqual([tex.alive, tex.hp], [true, 1], `T${tier}: 德克萨斯 at 1 HP`);
    const loss = h.hooksOf('damaged').filter((c) => c.target === u && c.dmg?.tags?.includes('hsgma2:shoulder'));
    assert.equal(loss.length, 1, `T${tier}: one 流失`);
    approx(loss[0].amount, over, `T${tier}: the excess`);
    assert.ok(u.alive && u.mem.hsEgo, `T${tier}: (she is in 我执 since the blow above; 不死 holds her)`);
    h.b.dealDamage(e, yak, { amount: yak.hp + 10, type: 'true' });
    assert.equal(yak.alive, false, `T${tier}: 角峰 (off her range) falls`);
    h.run(11.1);
    const out = h.hooksOf('death').filter((c) => c.unit === u);
    assert.deepEqual(out.map((c) => [c.reason, c.dying]), [['retreat', true]], `T${tier}: she leaves the field after 11 s`);
    done(h);
    // a plain stop / the duration: no 临死模式
    for (const how of ['stop', 'time']) {
      const g = field({ tier, elite, skill: 2 });
      g.h.spawn('enemy_dummy', { pos: [10, 6] });
      g.u.skill.gainSp(999);
      assert.ok(g.h.runUntil(() => g.u.skill.active, 1));
      if (how === 'stop') g.u.skill.stop(); else g.h.runUntil(() => !g.u.skill.active, 40);
      assert.deepEqual([g.u.skill.active, !!g.u.mem.hsDying, g.u.alive], [false, false, true], `T${tier} ${how}: no 临死模式`);
      done(g.h);
    }
  }
});

// 社区反馈 (PR #383 by @Convey123): 「绿条被打空以后受到伤害就会涨红条，这里看不到红条」 — the official HP bar shows the 我执 pool as a red bar
// growing over the drained green one. The sim has kept the pool since 0.2.0 (unit.mem.hsEgo); the snapshot now lists its share of the
// cap (b.snap `neg`, snapshot.js negView — display only) and render/units.js draws it (test/render/hud-readouts.test.js).
test('T1 业火 我执: the pool reaches the client as b.snap `neg` — its share of the cap (2 × max HP) from the first lethal hit, growing with the damage, gone with 我执', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0, others: [{ uid: 2, chessId: TEXAS, row: 12, col: 9 }] });
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.step();
  const max = u.s.maxHp;
  const negOf = () => (h.b.snapshot().neg || []).find((x) => x[0] === u.id);
  assert.equal(h.b.snapshot().neg, undefined, 'not in 我执: no list');
  h.b.dealDamage(e, u, { amount: u.hp + 300, type: 'true' });
  h.step();
  assert.ok(u.mem.hsEgo, '已进入 我执');
  const cap = 2 * max;                      // max_minus_hp_ratio
  approx(negOf()[1], 300 / cap, 'the share of the cap', 0.02);
  h.b.dealDamage(e, u, { amount: 400, type: 'true' });
  h.step();
  approx(negOf()[1], 700 / cap, 'it grew with the damage', 0.02);
  assert.ok(negOf()[1] < 1, 'still below a full pool');
  assert.ok(u.hp / max < 0.01, 'her green bar sits on the 1-HP floor: the red bar is the whole story');
  assert.equal(h.b.snapshot().units.find((t) => t[0] === u.id).length, 9, 'the tuple is not widened');
  assert.ok(h.runUntil(() => !u.mem.hsEgo, 60), 'the quiet-time regeneration clears the pool');
  h.step();
  assert.equal(h.b.snapshot().neg, undefined, 'no pool, no red bar');
  done(h);
});

test('T1 业火 我执: a lethal hit leaves her on the field (HP floor) with the excess as negative HP; later damage goes there (受击回复 SP still), 禁疗 meanwhile; 200 % of max HP knocks her out; 4 s without damage ⇒ 生命回复速度 5 %/s clears it and she leaves 我执', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const t0 = formOf(tier, elite).talents.find((t) => t.index === 0).bb;
    assert.deepEqual([t0.max_minus_hp_ratio, t0['hsgma2_t_1[heal].interval'], t0['hsgma2_t_1[heal].hp_recovery_per_sec_by_max_hp_ratio']], [2, 4, 0.05], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 0, others: [{ uid: 2, chessId: TEXAS, row: 12, col: 9 }] });
    const e = h.spawn('enemy_dummy', { pos: [10, 8] });
    h.step();
    const max = u.s.maxHp;
    h.b.dealDamage(e, u, { amount: u.hp + 300, type: 'true' });
    assert.ok(u.alive && u.mem.hsEgo, `T${tier}: in 我执`);
    assert.equal(u.hp, 1, `T${tier}: the engine's HP floor`);
    approx(u.mem.hsEgo.pool, 300, `T${tier}: the excess`);
    assert.deepEqual(u.findBuff('talent:hsgma2:ego')?.flags, { noHeal: true, healFree: true }, `T${tier}: 禁疗`);
    const sp = u.skill.sp;
    h.b.dealDamage(e, u, { amount: 500, type: 'true' });
    assert.deepEqual([u.hp, Math.round(u.mem.hsEgo.pool), u.skill.sp], [1, 800, sp + 1], `T${tier}: into the pool, +1 受击回复 SP`);
    assert.equal(h.b.heal(h.unit(2), u, 1000), 0, `T${tier}: no heal from others`);
    // every HP change goes to the negative HP first: a heal that passes 禁疗 (S2's) lowers it, a 流失 raises it
    h.b.heal(u, u, 200, { self: true, ignoreHealFree: true });
    h.step();
    assert.deepEqual([u.hp, Math.round(u.mem.hsEgo.pool)], [1, 600], `T${tier}: a heal that ignores 禁疗 clears negative HP first`);
    h.b.loseHp(u, 200, { source: e });
    assert.deepEqual([u.alive, u.hp, Math.round(u.mem.hsEgo.pool)], [true, 1, 800], `T${tier}: a 流失 adds to it`);
    // quiet: the regeneration starts at 4 s and clears the pool at 5 % max HP / s
    h.run(3.9);
    assert.equal(u.findBuff('talent:hsgma2:egoRegen'), null, `T${tier}: not before 4 s`);
    h.run(0.2);
    assert.deepEqual(u.findBuff('talent:hsgma2:egoRegen')?.mods, { hpRegenRatio: 0.05 }, `T${tier}: 生命回复速度（百分比）`);
    const t1 = h.b.time;
    assert.ok(h.runUntil(() => !u.mem.hsEgo, 30), `T${tier}: out of 我执`);
    approx(h.b.time - t1, 800 / (0.05 * max), `T${tier}: 800 at ${0.05 * max} / s`, 0.03);
    assert.ok(!u.findBuff('talent:hsgma2:ego') && !u.findBuff('talent:hsgma2:egoRegen'), `T${tier}: 禁疗 / regeneration gone`);
    // again into 我执, then 200 %
    h.b.dealDamage(e, u, { amount: u.hp + 100, type: 'true' });
    assert.ok(u.mem.hsEgo, `T${tier}: 我执 again`);
    h.b.dealDamage(e, u, { amount: 2 * max - 100 - 1, type: 'true' });
    assert.ok(u.alive, `T${tier}: just under 200 %`);
    h.b.dealDamage(e, u, { amount: 5, type: 'true' });
    assert.equal(u.alive, false, `T${tier}: 200 % knocks her out`);
    assert.equal(u.removeReason, 'killed');
    done(h);
  }
});

test('T2 鬼之架势 坚忍: RES up to +50 and ATK up to +35 % by the HP lost, full at 70 % lost; AST-X stage 3: full at 50 % lost and then ATK +15 % more', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const x3 = elite && mod === ASTX && tier === 6;
    const t1 = formOf(tier, elite).talents.find((t) => t.index === 1).bb;
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    const tb = u.def.raw.talents.find((t) => t.index === 1).bb;
    assert.deepEqual(tb, x3 ? { ...t1, min_hp_ratio: 0.5, atk: 0.15 } : t1, `${label(f)}: data`);
    const lo = x3 ? 0.5 : 0.3;
    for (const r of [1, 0.85, lo, 0.1]) {
      u.hp = r * u.s.maxHp;
      h.step();
      const fac = Math.min(1, (1 - r) / (1 - lo));
      const b = u.findBuff('talent:hsgma2:berserk');
      if (fac === 0) { assert.equal(b, null, `${label(f)} ${r}: nothing at full HP`); continue; }
      approx(b.mods.resFlat, 50 * fac, `${label(f)} ${r}: RES`);
      approx(b.mods.atkPct, 0.35 * fac + (x3 && fac >= 1 ? 0.15 : 0), `${label(f)} ${r}: ATK`);
    }
    approx(u.s.res, 15 + 50, `${label(f)}: RES 65 at the most`);
    done(h);
  }
});

test('AST-X 无迹 trait (stages 1 and 3, during skill): every damage instance of her attacks adds precomputed 10 % ATK arts ADDITION (ordinary dodge) on that enemy; every enemy attack she takes returns 10 % ATK arts; none without the module', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const x = elite && mod === ASTX;
    if (x) assert.deepEqual(modOf(tier, ASTX).traitOverride.bb, { atk_scale: 0.1 }, label(f));
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    noSp(h, u);
    assert.ok(u.skill.activate('test', { free: true }));
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(3.5);
    const atk = mine(h, u).filter((c) => c.dmg.isAttack);
    const extra = mine(h, u).filter((c) => c.dmg.tags?.includes('hsgma2:astx'));
    assert.ok(atk.length >= 2, `${label(f)}: attacks`);
    assert.equal(extra.length, x ? atk.length : 0, `${label(f)}: one extra per attack hit`);
    if (x) for (const c of extra) { assert.deepEqual([c.type, c.dmg.canDodge, c.dmg.isAttack], ['arts', true, false]); approx(c.amount, 0.1 * u.s.atk, `${label(f)}: 10 % ATK`); }
    const n = h.hooksOf('damaged').length;
    h.b.dealDamage(e, u, { amount: 10, type: 'phys', isAttack: true });
    const back = mine(h, u, n).filter((c) => c.target === e && c.dmg.tags?.includes('hsgma2:astx'));
    assert.equal(back.length, x ? 1 : 0, `${label(f)}: returned when attacked`);
    if (x) approx(back[0].amount, 0.1 * u.s.atk, `${label(f)}: 10 % ATK back`);
    done(h);
  }
});

for (const dodge of [false, true]) test(`AST-X output uses precomputed ADDITION/NONE and ordinary dodge (${dodge})`, () => {
  const { h, u } = field({ tier: 6, elite: true, mod: ASTX, skill: 2 });
  const b = h.b, e = h.spawn('enemy_dummy', { pos: [10, 7] });
  u.atkCd = 999;
  assert.ok(u.skill.activate('test', { free: true }));
  if (dodge) b.addBuff(e, { key: 'dodge', mods: { dodgeArts: 1 } });
  let calculations = 0;
  b.on('damageCalculate', c => { if (c.source === u) { calculations++; c.dmg.amount *= 2; } });
  const output = [], applied = [];
  b.on('damageOutput', c => { if (c.source === u) output.push(c); });
  b.on('damageApplied', c => { if (c.source === u) applied.push(c); });
  b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', isAttack: true });
  assert.equal(calculations, 1, 'child omits source calculation');
  const child = output.find(c => c.dmg.tags.includes('hsgma2:astx'));
  assert.ok(child);
  assert.equal(child.source, u);
  assert.equal(child.credit, u);
  assert.equal(child.dmg.attackType, 'ADDITION');
  assert.equal(child.dmg.applyWay, 'NONE');
  assert.equal(child.dmg.calculation, 'precomputed');
  assert.equal(child.dmg.origin, output.find(c => c.dmg.isAttack).dmg);
  approx(child.amount, u.s.atk * 0.1, 'native ATK scale, no second source-calculation factor');
  assert.equal(applied.filter(c => c.dmg.tags.includes('hsgma2:astx')).length, dodge ? 0 : 1);
  done(h);
});

test('AST-X incoming reflection is precomputed NORMAL/NONE without a recursive output rider', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: ASTX, skill: 2 });
  const b = h.b, e = h.spawn('enemy_dummy', { pos: [10, 7] });
  u.atkCd = 999;
  assert.ok(u.skill.activate('test', { free: true }));
  let calculations = 0;
  b.on('damageCalculate', c => { if (c.source === u) calculations++; });
  const out = [];
  b.on('damageOutput', c => { if (c.source === u) out.push(c); });
  b.dealDamage({ source: e, target: u, amount: 100, type: 'phys', isAttack: true });
  assert.equal(calculations, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].dmg.attackType, 'NORMAL');
  assert.equal(out[0].dmg.applyWay, 'NONE');
  assert.equal(out[0].dmg.calculation, 'precomputed');
  assert.ok(out[0].dmg.tags.includes('counter'));
  done(h);
});

for (const attackType of ['SPLASH', 'BUFF', 'ADDITION', 'NONE']) test(`AST-X output excludes ${attackType} even with attack behavior`, () => {
  const { h, u } = field({ tier: 6, elite: true, mod: ASTX, skill: 2 });
  const b = h.b, e = h.spawn('enemy_dummy', { pos: [10, 7] });
  assert.ok(u.skill.activate('test', { free: true }));
  const out = [];
  b.on('damageOutput', c => { if (c.dmg.tags.includes('hsgma2:astx')) out.push(c); });
  b.dealDamage({ source: u, target: e, amount: 100, type: 'true', attackType, isAttack: true });
  assert.equal(out.length, 0);
  done(h);
});

test('AST-X ADDITION does not retrigger Pegasus, while the original attack still does', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: ASTX, skill: 2,
    items: ['chess_item_5_09_e_a', 'chess_item_6_01_e_a'] });
  const b = h.b, e = h.spawn('enemy_dummy', { pos: [10, 7] });
  u.atkCd = 999;
  assert.ok(u.skill.activate('test', { free: true }));
  const rows = [];
  b.on('damageApplied', c => { if (c.target === e) rows.push(c); });
  b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', isAttack: true });
  const modules = rows.filter(c => c.dmg.tags.includes('hsgma2:astx'));
  const riders = rows.filter(c => c.dmg.tags.includes('item:pegasus'));
  assert.equal(modules.length, 1);
  assert.equal(riders.length, 1, 'only the NORMAL attack can generate Pegasus');
  assert.equal(riders[0].source, null);
  assert.equal(riders[0].credit, u);
  assert.equal(riders[0].dmg.origin.isAttack, true);
  done(h);
});
