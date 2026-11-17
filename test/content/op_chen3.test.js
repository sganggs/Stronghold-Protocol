// test/content/op_chen3.test.js — the 自选 operator kit of 赤刃明霄陈 (char_1050_chen3, 6★ 术战者; kit
// server/sim/content/kits/ops/op-chen3.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or AFT-X
// “记忆残页” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from data/backups.json (the form of that slot
// status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_chen3.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const CHEN3 = 'char_1050_chen3';
const FORMS = BACKUPS.units[CHEN3].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const AFTX = 'uniequip_002_chen3';
const S1 = 'skchr_chen3_1', S2 = 'skchr_chen3_2', S3 = 'skchr_chen3_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
/** Talent `i`'s blackboard of a form with its module. */
const tOf = (tier, elite, mod, i) => {
  const base = formOf(tier, elite).talents.find((t) => t.index === i).bb;
  const ch = elite && mod ? modOf(tier, mod).talentChanges.find((t) => t.talentIndex === i) : null;
  return { ...base, ...(ch?.bb ?? {}) };
};
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_frail: dummy('enemy_frail', { hp: 2000 }),
  enemy_mid: dummy('enemy_mid', { hp: 10000 }),
  enemy_big: dummy('enemy_big', { hp: 1e6 }),
  enemy_flymid: dummy('enemy_flymid', { hp: 10000, motion: 'FLY' }),
  enemy_mage: dummy('enemy_mage', { res: 60 }),
  enemy_tank: dummy('enemy_tank', { def: 5000 }),
  enemy_shooter: dummy('enemy_shooter', { atk: 100, range: 2.5, bat: 1 }),
  enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e9, speed: 0.6, mass: 0 }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, AFTX].map((m) => [t, true, m]))];

/** A battle with 赤刃明霄陈 as uid 1 at (row, col) facing RIGHT. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, seed = 5, others = [] } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'heal', 'deploy', 'dodge'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: CHEN3, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
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

test('赤刃明霄陈 in every 自选 form: her operator kit (all three skills authored), the form\'s stats + module attributes, 1-1, blocks 1, melee arts ground-only, 炎, no 特质, ground enemies can target her', () => {
  assert.equal(OPERATOR_KITS[CHEN3], KITS[CHEN3]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [CHEN3, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.sub, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.base.bat], [1, 'artsfghter', 'melee', false, 'arts', 1.25], `${label(f)}: 术战者`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      assert.deepEqual([form.tokens, form.displayTokens, u.def.raw.tokens], [[], [], []], `${label(f)}: no summons`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['yanShip'], []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target her`);
      done(h);
    }
  }
  // E2 Lv1 2211 / 570 / 352, E2 Lv60 2674 / 655 / 400; AFT-X +240 / +30 → +420 / +60 (HP / ATK)
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [2211, 570, 2674, 655]);
  assert.deepEqual([modOf(5, AFTX).attr, modOf(6, AFTX).attr], [{ maxHp: 240, atk: 30 }, { maxHp: 420, atk: 60 }]);
});

test('a 自选 pick: 赤刃明霄陈 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(CHEN3));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(CHEN3), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[5]]: { charId: CHEN3, skillIndex: 1, uniEquipId: AFTX } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[5]]: { charId: CHEN3, skillIndex: 1, uniEquipId: AFTX } } });
});

test('T1 形意洞照: ATK +16 %, ASPD +16; every physical / arts damage of hers is 弱点伤害 — physical on a high-RES enemy, arts on a high-DEF one', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const t0 = tOf(tier, elite, mod, 0);
    assert.deepEqual([t0.atk, t0.attack_speed], [0.16, 16]);
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    approx(u.s.atk, u.base.atk * 1.16, `${label(f)}: ATK`);
    const as = elite && mod === AFTX ? 8 : 0;   // she blocks nobody yet: AFT-X's +8 on top
    assert.equal(u.s.aspd, 100 + 16 + as, `${label(f)}: ASPD`);
    u.skill.sp = 0;
    const mage = h.spawn('enemy_mage', { pos: [10, 6] });
    h.runUntil(() => from(h, u, (c) => c.target === mage).length > 0, 3);
    const m = from(h, u, (c) => c.target === mage)[0];
    assert.deepEqual([m.type, m.dmg.isAttack], ['phys', true], `${label(f)}: physical on RES 60 / DEF 0`);
    approx(m.amount, u.s.atk, `${label(f)}: full`);
    h.b.kill(mage, null);
    const tank = h.spawn('enemy_tank', { pos: [10, 6] });
    h.runUntil(() => from(h, u, (c) => c.target === tank).length > 0, 3);
    assert.equal(from(h, u, (c) => c.target === tank)[0].type, 'arts', `${label(f)}: arts on DEF 5000 / RES 0`);
    done(h);
  }
});

test('AFT-X “记忆残页” (stages 1 / 3): ASPD +8 while she blocks nobody — off while she blocks', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 0, row: 9, col: 5 });
    const on = elite && mod === AFTX;
    if (on) assert.deepEqual(u.def.raw.trait.bb, { attack_speed: 8 }, label(f));
    h.step();
    assert.equal(!!u.findBuff('trait:chen3:unblocked'), on, `${label(f)}: nobody blocked`);
    u.skill.sp = 0;
    h.spawn('enemy_walk', { routeIndex: 0 });
    assert.ok(h.runUntil(() => u.blocking.length > 0, 30), `${label(f)}: the walker reaches her`);
    h.step();
    assert.equal(u.findBuff('trait:chen3:unblocked'), null, `${label(f)}: blocking`);
    assert.equal(u.s.aspd, 116, `${label(f)}: ASPD while blocking`);
    done(h);
  }
});

test('T2 寒暑觉知: every 7 s (AFT-X stage 3: 6 s) without damage a self-heal of ATK × a whole random percent of [35, 166) ([55, 206)) and one held dodge; any damage restarts the count', () => {
  for (const f of [[5, false, null], [6, true, null], [5, true, AFTX], [6, true, AFTX]]) {
    const [tier, elite, mod] = f;
    const t1 = tOf(tier, elite, mod, 1);
    const st = t1.stack_time, lo = t1.heal_atk_scale_min, hi = t1.heal_atk_scale_max;
    assert.deepEqual([st, lo, hi], elite && mod === AFTX && tier === 6 ? [6, 55, 206] : [7, 35, 166], label(f));
    const { h, u } = field({ tier, elite, mod, skill: 0 });
    u.hp = 100;
    const heals = () => h.hooksOf('heal').filter((c) => c.target === u && c.source === u && !c.opts?.regen);
    h.run(st - 0.15);
    assert.equal(heals().length, 0, `${label(f)}: not before ${st} s`);
    assert.equal(u.mem.chen3T2.evade, false);
    h.run(0.25);
    assert.equal(heals().length, 1, `${label(f)}: at ${st} s`);
    const pct = heals()[0].amount / u.s.atk * 100;
    assert.ok(Math.abs(pct - Math.round(pct)) < 1e-6 && pct >= lo && pct < hi, `${label(f)}: ${pct} % of ATK`);
    assert.equal(u.mem.chen3T2.evade, true, `${label(f)}: a dodge held`);
    // damage restarts the count: no second heal at 2 × st
    h.run(st - 3);
    const e = h.spawn('enemy_dummy', { pos: [12, 9] });
    h.b.dealDamage(e, u, { amount: 1, type: 'true' });
    h.run(3);
    assert.equal(heals().length, 1, `${label(f)}: the count restarted`);
    h.run(st - 3 + 0.2);
    assert.equal(heals().length, 2, `${label(f)}: ${st} s after the damage`);
    done(h);
  }
});

test('T2: the held dodge cancels the next dodgeable physical / arts damage instance and is spent; true damage passes; a 流失 restarts nothing; her other dodges (S2) are rolled first and keep it', () => {
  const { h, u } = field({ tier: 5, skill: 0 });
  const e = h.spawn('enemy_dummy', { pos: [12, 9] });
  h.run(7.2);
  assert.equal(u.mem.chen3T2.evade, true);
  const hp0 = u.hp;
  assert.equal(h.b.dealDamage(e, u, { amount: 300, type: 'true' }), 300, 'true damage is not dodged');
  assert.equal(u.mem.chen3T2.evade, true, 'still held');
  assert.equal(h.b.dealDamage(e, u, { amount: 300, type: 'arts' }), 0, 'arts dodged');
  assert.equal(u.mem.chen3T2.evade, false, 'spent');
  assert.equal(h.hooksOf('dodge').filter((c) => c.target === u).length, 1, 'a dodge event');
  assert.equal(h.b.dealDamage(e, u, { amount: 300, type: 'phys' }) > 0, true, 'the next one lands');
  approx(u.hp, hp0 - 300 - (300 - u.s.def > 300 * 0.05 ? 300 - u.s.def : 15), 'HP');
  // a 流失 does not restart the count
  h.run(5);
  h.b.loseHp(u, 1, { source: e });
  h.run(2.2);
  assert.equal(u.mem.chen3T2.evade, true, 'a 流失 is no damage taken');
  // another dodge first: a certain one (p 1) wins and the held one is kept
  h.b.addBuff(u, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  assert.equal(h.b.dealDamage(e, u, { amount: 300, type: 'phys' }), 0);
  assert.equal(u.mem.chen3T2.evade, true, 'kept behind the other dodge');
  done(h);
});

test('T2 held dodge uses -1000 order without a second probability draw; source stays independent of credit', () => {
  for (const roll of [0.1, 0.9]) {
    const { h, u } = field();
    h.run(7.2);
    const e = h.spawn('enemy_dummy', { pos: [12, 9] });
    h.b.addBuff(u, { key: 'ordinary-dodge', mods: { dodgePhys: 0.5 } });
    let draws = 0;
    h.b.rng = () => { draws++; return roll; };
    assert.equal(h.b.dealDamage({ source: null, credit: e, target: u, amount: 100, type: 'phys' }), 0);
    assert.equal(draws, 1);
    assert.equal(u.mem.chen3T2.evade, roll < 0.5);
    const event = h.hooksOf('dodge').at(-1);
    assert.equal(event.source, null);
    assert.equal(event.credit, e);
  }
});

test('T2 held dodge respects ignore/uncancellable, preserves its timer under full absorption and reacquires on move', () => {
  for (const mode of ['ignore', 'uncancellable']) {
    const { h, u } = field();
    h.run(7.2);
    u.mem.chen3T2.count = 3;
    u.mem.chen3T2.acc = 0.25;
    h.b.addBuff(u, { key: 'barrier', shield: 100 });
    h.b.dealDamage({ target: u, amount: 100, type: 'true' });
    assert.equal(u.mem.chen3T2.count, 3);
    assert.equal(u.mem.chen3T2.acc, 0.25);
    const old = u.findBuff('talent:chen3:evade');
    assert.ok(h.b.moveRedeploy(u, 10, 4));
    assert.ok(u.findBuff('talent:chen3:evade').seq > old.seq);
    let draws = 0;
    h.b.rng = () => { draws++; return 0; };
    assert.ok(h.b.dealDamage({ target: u, amount: 100, type: 'arts', dodgeMode: mode }) > 0);
    assert.equal(draws, 0, 'the held guarantee needs no probability roll');
    assert.equal(u.mem.chen3T2.evade, mode === 'ignore');
    assert.equal(u.mem.chen3T2.count, 0, 'the accepted damage restarts the timer');
  }
});

test('T2 holding another timer grant does not stack or reorder the dodge; death and ordinary redeploy clear it', () => {
  const { h, u } = field();
  h.run(7.2);
  const buff = u.findBuff('talent:chen3:evade');
  h.run(7);
  assert.equal(u.findBuff('talent:chen3:evade'), buff, 'a second timer grant keeps the same single effect');
  assert.equal(buff.stacks, 1);
  h.b.kill(u, null);
  assert.equal(u.mem.chen3T2.evade, false);
  assert.ok(h.b.redeploy(u));
  assert.equal(u.mem.chen3T2.evade, false);
  assert.equal(u.mem.chen3T2.count, 0);
});

test('S1 赤霄·奔夜 (MANUAL, data DEFAULT): ATK +65 % / +80 % for 18 s, every attack hits twice, 沉默 on its target until the skill ends', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.rule, sk.duration, sk.bb.atk], ['DEFAULT', 18, elite ? 0.8 : 0.65], `T${tier}`);
    u.skill.gainSp(999);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => u.skill.active, 3), `T${tier}: cast`);
    approx(u.s.atk, u.base.atk * (1 + 0.16 + sk.bb.atk), `T${tier}: ATK`);
    const n0 = from(h, u).length;
    h.runUntil(() => from(h, u).length >= n0 + 2, 3);
    const two = from(h, u).slice(n0, n0 + 2);
    assert.equal(two[0].dmg.attackId, two[1].dmg.attackId, `T${tier}: one attack, two hits`);
    approx(two[0].amount, u.s.atk, `T${tier}: ATK each`);
    const sil = h.hooksOf('statusApplied').filter((c) => c.status === 'silence' && c.target === e && c.source === u);
    assert.ok(sil.length >= 1, `T${tier}: 沉默`);
    approx(sil[0].duration + sil[0].t, u.mem.chen3S1End, `T${tier}: until the skill ends`, 0.05);
    h.runUntil(() => !u.skill.active, 20);
    h.step();
    assert.ok(!e.s.flags.silence, `T${tier}: lifted with the skill's end`);
    done(h);
  }
  // knocked out mid-skill: the silences she set end with it
  const { h, u } = field({ tier: 5, skill: 0 });
  u.skill.gainSp(999);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.runUntil(() => h.hooksOf('statusApplied').some((c) => c.status === 'silence'), 3);
  assert.ok(e.s.flags.silence);
  h.b.kill(u, null);
  h.step();
  assert.ok(!e.s.flags.silence, 'gone with the skill');
  done(h);
});

test('S2 赤霄·绝影-驰 (MANUAL, 技能范围 x-1, data SKILL_RANGE): 10 slashes on the nearest enemy, 0.4 s apart, 390 % / 430 % ATK arts; 无敌, blocks nobody, no attack, stun immune; then a 【移动】 onto its tile and 6 s of ATK +230 % / +260 % with 40 % / 50 % physical and arts dodge', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, skill: 1 });
    assert.deepEqual([u.skill.rule, sk.rangeId, sk.duration, sk.bb.atk_scale, sk.bb['chen3_s2[respawn_buff].atk'], sk.bb['chen3_s2[respawn_buff].prob']],
      ['SKILL_RANGE', 'x-1', 6, elite ? 4.3 : 3.9, elite ? 2.6 : 2.3, elite ? 0.5 : 0.4], `T${tier}`);
    u.skill.gainSp(999);
    const near = h.spawn('enemy_dummy', { pos: [11, 6] });      // √2 away
    const far = h.spawn('enemy_dummy', { pos: [10, 7] });       // 2 away
    const shooter = h.spawn('enemy_shooter', { pos: [12, 7] });
    assert.ok(h.runUntil(() => u.skill.active, 2), `T${tier}: cast`);
    const t0 = h.b.time;
    h.step();
    assert.ok(u.s.flags.invulnerable && u.s.flags.noBlock, `T${tier}: 无敌, 不可阻挡`);
    assert.equal(h.b.applyStatus(u, 'stun', { duration: 2, source: shooter }), false, `T${tier}: stun immune`);
    const hp0 = u.hp;
    h.run(3.5);
    assert.equal(u.hp, hp0, `T${tier}: nothing hurts her`);
    h.runUntil(() => u.mem.chen3S2?.phase !== 1, 3);
    const cuts = from(h, u, (c) => tagged(c, 'chen3:slash'));
    assert.equal(cuts.length, 10, `T${tier}: 10 slashes`);
    assert.ok(cuts.every((c) => c.target === near), `T${tier}: on the nearest`);
    cuts.forEach((c, i) => approx(c.t - cuts[0].t, 0.4 * i, `T${tier}: slash ${i + 1}`, 0.04));
    approx(cuts[0].t, t0, `T${tier}: the first at the cast`, 0.05);
    for (const c of cuts) { approx(c.amount, u.base.atk * 1.16 * sk.bb.atk_scale, `T${tier}: ${sk.bb.atk_scale * 100} % ATK`); assert.deepEqual([c.type, c.dmg.isSkill], ['arts', true]); }
    // the move onto the target's tile, the 6 s state
    const moves = h.hooksOf('deploy').filter((c) => c.unit === u && c.move);
    assert.equal(moves.length, 1, `T${tier}: one 【移动】`);
    approx(moves[0].t - cuts[0].t, 4, `T${tier}: after 10 × 0.4 s`, 0.05);
    assert.equal(from(h, u, (c) => c.dmg.isAttack && c.t < moves[0].t).length, 0, `T${tier}: no attack while slashing`);
    assert.deepEqual([u.tileR, u.tileC], [11, 6], `T${tier}: moved onto its tile`);
    assert.ok(!u.s.flags.invulnerable && !u.s.flags.noBlock, `T${tier}: the slashing is over`);
    approx(u.s.atk, u.base.atk * (1 + 0.16 + sk.bb['chen3_s2[respawn_buff].atk']), `T${tier}: ATK`);
    approx(u.s.dodgePhys, sk.bb['chen3_s2[respawn_buff].prob'], `T${tier}: physical dodge`);
    approx(u.s.dodgeArts, sk.bb['chen3_s2[respawn_buff].prob'], `T${tier}: arts dodge`);
    approx(u.skill.timeLeft, 6, `T${tier}: 6 s from the move`, 0.05);
    h.runUntil(() => !u.skill.active, 7);
    approx(u.s.atk, u.base.atk * 1.16, `T${tier}: back`);
    assert.equal(from(h, u, (c) => tagged(c, 'chen3:slash') && c.target === far).length, 0, `T${tier}: the farther one is never slashed`);
    done(h);
  }
});

test('S2: a slashed enemy that falls hands the slashes to the nearest one within 1.7 (+1 slash); with nobody left the slashing ends and she moves back onto her own tile; damage on a 2000-HP target', () => {
  {
    const { h, u } = field({ tier: 5, skill: 1 });
    u.skill.gainSp(999);
    const frail = h.spawn('enemy_frail', { pos: [10, 6] }), next = h.spawn('enemy_dummy', { pos: [11, 7] });
    assert.ok(h.runUntil(() => u.skill.active, 2));
    h.runUntil(() => u.mem.chen3S2?.phase !== 1, 6);
    const cuts = from(h, u, (c) => tagged(c, 'chen3:slash'));
    assert.ok(!frail.alive, 'the first target fell');
    const onFrail = cuts.filter((c) => c.target === frail).length;
    assert.equal(cuts.length, 11, `11 slashes (${onFrail} on the first)`);
    assert.ok(cuts.slice(onFrail).every((c) => c.target === next), 'the rest on the next');
    assert.deepEqual([u.tileR, u.tileC], [11, 7], 'onto the last target\'s tile');
    done(h);
  }
  {
    const { h, u } = field({ tier: 5, skill: 1 });
    u.skill.gainSp(999);
    const frail = h.spawn('enemy_frail', { pos: [10, 6] });
    assert.ok(h.runUntil(() => u.skill.active, 2));
    h.runUntil(() => u.mem.chen3S2?.phase !== 1, 6);
    assert.ok(!frail.alive);
    assert.ok(from(h, u, (c) => tagged(c, 'chen3:slash')).length < 10, 'ended early');
    assert.deepEqual([u.tileR, u.tileC], [10, 5], 'back on her own tile');
    assert.equal(h.hooksOf('deploy').filter((c) => c.unit === u && c.move).length, 1, 'a 【移动】 in place');
    assert.ok(u.skill.active && u.findBuff('skill:chen3:respawn'), 'the 6 s state still');
    done(h);
  }
});

test('S3 赤霄·天喟 (MANUAL, data ACTIVE_RANGE on 3-12): range 3-12, each attack hits up to 3 ground enemies 3 times for 165 % / 180 % ATK arts; back to 1-1 after 20 s', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u } = field({ tier, elite, skill: 2 });
    assert.deepEqual([u.skill.rule, sk.rangeId, sk.duration, sk.bb['attack@atk_scale'], sk.bb['attack@max_target'], sk.bb.hp_ratio, sk.bb.projectile_min_atk_scale],
      ['ACTIVE_RANGE', '3-12', 20, elite ? 1.8 : 1.65, 3, 0.06, elite ? 5.5 : 5.3], `T${tier}`);
    u.skill.gainSp(999);
    const ground = [[10, 7], [9, 6], [11, 6], [10, 8]].map((pos) => h.spawn('enemy_dummy', { pos }));
    const fly = h.spawn('enemy_fly', { pos: [11, 5] });
    assert.ok(h.runUntil(() => u.skill.active, 2), `T${tier}: an enemy on the 3-12`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: 3-12`);
    const n0 = from(h, u, (c) => c.dmg.isAttack).length;
    h.runUntil(() => from(h, u, (c) => c.dmg.isAttack).length >= n0 + 9, 4);
    const hits = from(h, u, (c) => c.dmg.isAttack).slice(n0, n0 + 9);
    assert.equal(new Set(hits.map((c) => c.dmg.attackId)).size, 1, `T${tier}: one attack`);
    assert.equal(new Set(hits.map((c) => c.target)).size, 3, `T${tier}: 3 targets`);
    assert.ok(hits.every((c) => c.target !== fly && ground.includes(c.target)), `T${tier}: ground only`);
    for (const c of hits) { approx(c.amount, u.s.atk * sk.bb['attack@atk_scale'], `T${tier}: ${sk.bb['attack@atk_scale'] * 100} %`); assert.equal(c.type, 'arts'); }
    h.runUntil(() => !u.skill.active, 21);
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `T${tier}: back to 1-1`);
    done(h);
  }
});

// 用户报告: 「自选干员赤刃明霄陈三技能的龙剑气看不到」. 波是 kit 自己管的探针（会拐弯、跟技能同寿），不在快照的 projectile
// 列表里，所以客户端只能靠 fx 事件画它——原来只在起手发了一个 `dash`、每次命中发 `slash`，波本身**没有任何事件**。
// 现在每 WAVE_FX_EVERY(0.12) 秒发一次 `chen3Wave`：位置 + 上一个点（拖尾）+ 方向（月牙朝向）。
test('S3: the 龙剑气 streams its position to the client as `chen3Wave` fx (position, previous point, direction)', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  u.skill.gainSp(999);
  h.spawn('enemy_dummy', { pos: [10, 6] });          // a target in range: the MANUAL skill casts
  const waveFx = () => h.events.filter((e) => e[0] === 'fx' && e[1] === 'chen3Wave');
  assert.ok(h.runUntil(() => u.skill.active, 2));
  h.run(1);
  const fx = waveFx();
  assert.ok(fx.length >= 6, `每 0.12 秒一次 ⇒ 1 秒约 8 次（实际 ${fx.length}）`);
  for (const [, , x, y, ex] of fx) {
    assert.equal(ex.id, u.id, '带着她的 id（可定位到玩家/队伍）');
    assert.equal(ex.skill, 'chen3:wave');
    assert.ok(Math.abs(x - u.tileC) <= 12 && Math.abs(y - u.tileR) <= 12, '波在场上');
  }
  // 位置随时间前移、方向与朝向一致（row 10 向右），from 是上一个点（拖尾）
  const [, , x0, , ex0] = fx[0];
  const last = fx[fx.length - 1];
  assert.ok(last[2] > x0, `向前推进（${x0.toFixed(2)} → ${last[2].toFixed(2)}）`);
  assert.deepEqual([last[4].dc, last[4].dr], [1, 0], '方向 = 她的朝向（向右）');
  assert.ok(Math.abs(ex0.fromX - u.tileC) < 0.5 && Math.abs(ex0.fromY - u.tileR) < 0.5, '第一个事件从上场点开始');
  assert.ok(last[4].fromX < last[2], 'from 是上一个事件的点（拖尾向前）');
  // 技能结束后不再发
  h.runUntil(() => !u.skill.active, 25);
  h.step();
  const n = waveFx().length;
  h.run(2);
  assert.equal(waveFx().length, n, '技能结束后不再有波的 fx');
  done(h);
});

test('S3: the sword wave leaves her tile forward at 1.5 tiles/s, hits each enemy within 1.3 once per straight run (air too) for max(6 % of its HP, 530 % / 550 % ATK) arts, turns clockwise at the field\'s edge / high ground / gates and forgets whom it hit, and is gone with the skill', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u } = field({ tier, elite, skill: 2 });
    u.skill.gainSp(999);
    const trigger = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => u.skill.active, 2));
    const t0 = h.b.time;
    const mid = h.spawn('enemy_mid', { pos: [10, 8] }), big = h.spawn('enemy_big', { pos: [9, 8] });
    const fly = h.spawn('enemy_flymid', { pos: [11, 9] });
    const corner = h.spawn('enemy_dummy', { pos: [10, 10] });
    const waveHits = (e) => from(h, u, (c) => tagged(c, 'chen3:wave') && c.target === e);
    h.run(3);
    const w = u.mem.chen3Wave;
    approx(w.x, 5 + 1.5 * (h.b.time - t0), `T${tier}: 1.5 tiles/s along row 10`, 0.02);
    assert.deepEqual([w.dr, w.dc, w.y], [0, 1, 10], `T${tier}: still heading right`);
    assert.equal(waveHits(trigger).length, 1, `T${tier}: once per run`);
    approx(waveHits(trigger)[0].t, t0, `T${tier}: at the cast`, 0.1);
    // 10 000 HP: 6 % = 600 < 530 % ATK ⇒ the ATK floor; 1 000 000 HP: 6 % = 60 000 wins
    for (const [e, amt] of [[mid, sk.bb.projectile_min_atk_scale * u.s.atk], [fly, sk.bb.projectile_min_atk_scale * u.s.atk], [big, 0.06 * 1e6]]) {
      assert.equal(waveHits(e).length, 1, `T${tier}: ${e.defId} once`);
      approx(waveHits(e)[0].amount, amt, `T${tier}: ${e.defId}`);
      assert.deepEqual([waveHits(e)[0].type, waveHits(e)[0].dmg.isSkill], ['arts', true]);
    }
    // the field ends after column 10: it turns down there (the corner enemy, within 1.3, is hit again), then left before
    // the 侵入点 at (9, 10) — and runs back along row 10
    h.run(1);
    assert.ok(waveHits(corner).length >= 2, `T${tier}: the corner one again after a turn (${waveHits(corner).length})`);
    h.run(2);
    assert.deepEqual([u.mem.chen3Wave.dr, u.mem.chen3Wave.dc], [0, -1], `T${tier}: heading left`);
    assert.ok(u.mem.chen3Wave.x < 10 && Math.round(u.mem.chen3Wave.y) === 10, `T${tier}: back along row 10`);
    h.runUntil(() => !u.skill.active, 20);
    h.step();
    assert.equal(u.mem.chen3Wave, null, `T${tier}: gone with the skill`);
    const n = from(h, u, (c) => tagged(c, 'chen3:wave')).length;
    h.run(3);
    assert.equal(from(h, u, (c) => tagged(c, 'chen3:wave')).length, n, `T${tier}: no more wave hits`);
    done(h);
  }
});
