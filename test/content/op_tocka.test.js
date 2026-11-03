// test/content/op_tocka.test.js — the 自选 operator kit of 冻河 (char_4244_tocka, 6★ 游击手; kit
// server/sim/content/kits/ops/op-tocka.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4) and elite (E2 Lv60, rank 7; no module exists). Every number is
// read back from data/backups.json (the form of that slot status, the talents at the unit's potential); the fidelity
// checklist of kits/README.md item by item: the three skills and their trigger effects, both talents, range, anti-air,
// damage typing, statuses, the auto-cast rules.
// Run: node --test test/content/op_tocka.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const T = 'char_4244_tocka';
const FORMS = BACKUPS.units[T].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const S1 = 'skchr_tocka_1', S2 = 'skchr_tocka_2', S3 = 'skchr_tocka_3';
/** Every 自选 form: [tier, elite] (she has no module). */
const FORMS_ALL = [[5, false], [6, false], [5, true], [6, true]];
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
/** Talent `i`'s blackboard at `potential` (data rank potential − 1 below potMin ⇒ the entry below). */
const talentOf = (tier, elite, i, potential = 6) => {
  const t = formOf(tier, elite).talents[i];
  return potential - 1 < t.potMin ? t.potBelow.bb : t.bb;
};
const label = ([tier, elite]) => `T${tier} ${elite ? 'elite' : 'normal'}`;
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

// synthetic allies (generic kits; DEF / RES 0 for exact numbers): a MANUAL 10-SP duration skill (and one that never fills
// in a test), a MANUAL charged one (3 × 10 SP, a cast with no duration), a PASSIVE one, none at all; and MANUAL skills on
// the other trigger rules — SKILL_RANGE / ACTIVE_RANGE on a 1×5 / 1×4 row ahead (beyond the 1×2 attack range), TAKE_DAMAGE,
// SP_FULL
const ally = (id, skill) => chessRec({ id, stats: { def: 0, res: 0 }, skill });
const ROW_AHEAD = (n) => Array.from({ length: n }, (_, i) => [0, i]);
const ALLIES = {
  ally_m: ally('ally_m', { spCost: 10, initSp: 0, duration: 5 }),
  ally_s: ally('ally_s', { spCost: 999, initSp: 0, duration: 5 }),
  ally_c: ally('ally_c', { spCost: 10, initSp: 0, duration: 0, maxChargeTime: 3 }),
  ally_p: ally('ally_p', { skillType: 'PASSIVE', spCost: 0, duration: 0 }),
  ally_n: chessRec({ id: 'ally_n', stats: { def: 0, res: 0 }, skill: null }),
  ally_k: ally('ally_k', { spCost: 10, initSp: 0, duration: 5, trigger: { rule: 'SKILL_RANGE', customRangeGrid: ROW_AHEAD(5) } }),
  ally_r: ally('ally_r', { spCost: 10, initSp: 0, duration: 5, trigger: { rule: 'ACTIVE_RANGE', customRangeGrid: ROW_AHEAD(4) } }),
  ally_t: ally('ally_t', { spCost: 10, initSp: 0, duration: 5, trigger: { rule: 'TAKE_DAMAGE' } }),
  ally_f: ally('ally_f', { spCost: 10, initSp: 0, duration: 5, trigger: { rule: 'SP_FULL' } }),
};
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, atk: 0, speed: 0, def: 0, res: 0, ...o });
const ENEMIES = { dummy: dummy('dummy'), fly: dummy('fly', { motion: 'FLY' }) };

/** A battle with 冻河 as uid 1 at (row, col) facing RIGHT (range 3-18), plus `others`. */
function field({ tier = 6, elite = true, skill = 0, potential = null, row = 10, col = 4, others = [], seed = 7, extra = [], flags = {} } = {}) {
  const h = makeBattle({
    defs: { chess: ALLIES, enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed, flags,
    hooks: ['damaged', 'skillStart', 'statusApplied', 'heal'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: T, skillIndex: skill }, elite, ...(potential ? { potential } : {}), row, col },
      ...extra, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const eff = (kind, u) => `tocka:${kind}:${u.id}`;
const BARRIER = 'tocka:s1:barrier';
/** Fill her SP and let her cast again (the kit casts the AUTO skills from its tick hook). */
function castNow(h, u, n) {
  u.skill.gainSp(999, 'init');
  assert.ok(h.runUntil(() => u.skill.activations >= n, 5), `cast #${n}`);
}
const stunsOn = (h, e) => h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.target === e);

test('冻河 in every 自选 form: her operator kit (all three skills authored), the form\'s stats, range 3-18, ranged physical arrows that reach air units, the data\'s SP; a legal pick at tiers 5 and 6', () => {
  assert.equal(OPERATOR_KITS[T], KITS[T]);
  assert.ok(KITTED_CHARS.includes(T));
  const data = { chess: CHESS, backups: BACKUPS };
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(T), `tier ${t}`);
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const form = formOf(tier, elite);
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, skill });
      const rec = form.skills[skill];
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [T, SLOT[tier], rec.skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp, form.stats.atk, form.stats.def], `${label(f)}: stats`);
      assert.deepEqual([u.profile.attack, u.profile.dmgType, u.profile.projectile, u.profile.canHitFly, u.base.bat], ['ranged', 'phys', 'arrow', true, 2.1], `${label(f)}: 游击手`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-18`);
      // S1 / S2 AUTO: the kit's own cast (trigger NEVER), S3 MANUAL: the data's DEFAULT
      assert.deepEqual([u.skill.kind, u.skill.rule, u.skill.manual, u.skill.spCost, u.skill.initSp],
        [skill === 2 ? 'duration' : 'instant', skill === 2 ? 'DEFAULT' : 'NEVER', skill === 2, rec.spCost, rec.initSp], `${label(f)}: S${skill + 1}`);
      if (skill === 2) approx(u.skill.duration, rec.duration, `${label(f)}: 20 s`);
      done(h);
    }
  }
  // the numbers of the forms (CN 2.7.91, full potential): E2 Lv1 1315 / 704 / 198, E2 Lv60 1562 / 795 / 216; range 3-18
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [1315, 704, 1562, 795]);
  assert.deepEqual([FORMS['2/1/4/0'].rangeId, FORMS['2/60/7/3'].modules], ['3-18', []]);
  assert.deepEqual([skillOf(5, false, S1).skillType, skillOf(5, false, S2).skillType, skillOf(5, false, S3).skillType], ['AUTO', 'AUTO', 'MANUAL']);
});

test('S1 一无所有之人 (AUTO): at full SP — no enemy needed — the effect goes on max_target ally operators of her range not holding it, the lowest HP ratio first, then the latest created, herself included; nobody legal ⇒ no cast', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const sk = skillOf(tier, elite, S1);
    // the initial deployment goes column by column, left first (Battle.start): uid 3 (col 4) before uid 5 (col 5)
    const others = [{ uid: 2, chessId: 'ally_m', row: 11, col: 5 }, { uid: 3, chessId: 'ally_m', row: 11, col: 4 },
      { uid: 4, chessId: 'ally_m', row: 10, col: 9 }, { uid: 5, chessId: 'ally_m', row: 9, col: 5 }];
    const { h, u } = field({ tier, elite, skill: 0, others });
    const [a, b, c, e] = [2, 3, 4, 5].map((id) => h.unit(id));
    a.hp = a.s.maxHp * 0.5; b.hp = b.s.maxHp * 0.8; c.hp = c.s.maxHp * 0.1; e.hp = e.s.maxHp * 0.8;
    assert.ok(e.aggroSeq > b.aggroSeq, 'uid 5 was deployed after uid 3');
    const wait = sk.spCost - sk.initSp;
    h.run(wait - 0.5);
    assert.equal(u.skill.activations, 0, `${label(f)}: not before ${wait} s`);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), `${label(f)}: cast at full SP, no enemy on the field`);
    assert.equal(h.enemies().length, 0);
    const holds = (x) => !!x.findBuff(eff('s1', u));
    // 50 % (uid 2), then of the two at 80 % the later one (uid 5); never uid 4 (out of her range: 10 % HP)
    assert.deepEqual([a, e, b, c, u].map(holds), [true, true, false, false, false], `${label(f)}: max_target ${sk.bb.max_target}`);
    h.run(sk.spCost + 0.1);
    assert.equal(u.skill.activations, 2);
    assert.deepEqual([a, e, b, c, u].map(holds), [true, true, true, false, true], `${label(f)}: the next two (she is one)`);
    h.run(2 * sk.spCost);
    assert.deepEqual([u.skill.activations, u.skill.ready], [2, true], `${label(f)}: every operator of her range holds it: she waits full`);
    // one fires (a hit on uid 2): uid 2 is a legal pick again, and she casts at once
    h.b.dealDamage({ source: null, target: a, amount: 1, type: 'true' });
    assert.ok(!holds(a));
    assert.ok(h.runUntil(() => u.skill.activations === 3, 0.2), `${label(f)}: recast for the free operator`);
    assert.ok(holds(a));
    done(h);
  }
});

test('S1 effect: a hit on its holder (any damage but 元素伤害) fires it once — a barrier of her ATK at that moment × shield_atk_scale losing 1/shield_time of it per second, and the enemy that hit is stunned `stun` s', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const bb = skillOf(tier, elite, S1).bb;
    // uid 3 (10 %) takes the 夜的哑然 heals, so uid 2's HP shows the hits alone
    const others = [{ uid: 2, chessId: 'ally_m', row: 11, col: 5 }, { uid: 3, chessId: 'ally_m', row: 9, col: 5 }];
    const { h, u } = field({ tier, elite, skill: 0, others });
    const [a, z] = [h.unit(2), h.unit(3)];
    a.hp = a.s.maxHp * 0.5; z.hp = z.s.maxHp * 0.1;
    castNow(h, u, 1);
    assert.ok(a.findBuff(eff('s1', u)) && z.findBuff(eff('s1', u)), `${label(f)}: on uids 2 and 3`);
    const e = h.spawn('dummy', { pos: [10, 9] }); // outside her range
    h.b.addBuff(u, { key: 'test:atk', mods: { atkPct: 0.5 } }); // "根据触发时（而非施加时）冻河的攻击力计算"
    h.b.dealDamage(e, a, { amount: 50, type: 'elemental' });
    h.b.dealDamage(e, a, { amount: 50, type: 'element', element: 'burn' });
    assert.ok(a.findBuff(eff('s1', u)) && !a.findBuff(BARRIER), `${label(f)}: 元素伤害 and an element fill do not fire it`);
    const hp0 = a.hp;
    h.b.dealDamage(e, a, { amount: 100, type: 'phys' });
    const total = u.s.atk * bb.shield_atk_scale;
    assert.ok(!a.findBuff(eff('s1', u)), `${label(f)}: one-time`);
    approx(a.findBuff(BARRIER).shield, total, `${label(f)}: ${bb.shield_atk_scale * 100} % of her ATK when it fired`);
    approx(a.hp, hp0 - 100, `${label(f)}: the hit that fires it is not absorbed`);
    assert.equal(stunsOn(h, e).length, 1);
    approx(stunsOn(h, e)[0].duration, bb.stun, `${label(f)}: stun ${bb.stun} s`);
    assert.equal(stunsOn(h, e)[0].source, u);
    h.b.dealDamage(e, a, { amount: 100, type: 'true' });
    approx(a.hp, hp0 - 100, `${label(f)}: the barrier takes the next hit`);
    approx(a.findBuff(BARRIER).shield, total - 100, `${label(f)}: barrier spent`);
    assert.equal(stunsOn(h, e).length, 1, `${label(f)}: no second firing`);
    h.run(1);
    approx(a.findBuff(BARRIER).shield, total - 100 - total / bb.shield_time, `${label(f)}: −1/${bb.shield_time} a second`);
    h.run(bb.shield_time - 1 + 0.05);
    assert.equal(a.findBuff(BARRIER), null, `${label(f)}: gone after ${bb.shield_time} s`);
    done(h);
  }
});

test('S1 effect: any source fires it — sourceless and ally hits give the barrier without a stun, and a dead source is stunned by nobody', () => {
  const others = [{ uid: 2, chessId: 'ally_m', row: 11, col: 5 }, { uid: 3, chessId: 'ally_m', row: 9, col: 5 }];
  const { h, u } = field({ skill: 0, others });
  const [a, b] = [h.unit(2), h.unit(3)];
  a.hp = a.s.maxHp * 0.5; b.hp = b.s.maxHp * 0.6;
  castNow(h, u, 1);
  castNow(h, u, 2);
  assert.ok([a, b, u].every((x) => x.findBuff(eff('s1', u))), 'uid 2, uid 3, then her');
  h.b.dealDamage({ source: null, target: a, amount: 10, type: 'true' });
  const d = h.spawn('dummy', { pos: [10, 9] });
  h.b.kill(d, null);
  h.b.dealDamage(d, b, { amount: 10, type: 'true' });
  h.b.dealDamage(a, u, { amount: 10, type: 'true' });
  for (const x of [a, b, u]) assert.ok(!x.findBuff(eff('s1', u)) && x.findBuff(BARRIER)?.shield > 0, `uid ${x.uid}: fired, barrier`);
  assert.equal(h.hooksOf('statusApplied').filter((c) => c.status === 'stun').length, 0, 'no stun: no source, a dead one, an ally');
  assert.ok(!a.s.flags.stun);
  done(h);
});

test('S1 barrier fired again: the old one is cleared and the new one is max(what is left, the new amount), decaying by its own initial / shield_time', () => {
  const bb = skillOf(6, true, S1).bb;
  const { h, u } = field({ skill: 0, others: [{ uid: 2, chessId: 'ally_m', row: 11, col: 5 }] });
  const a = h.unit(2);
  a.hp = a.s.maxHp * 0.5;
  const e = h.spawn('dummy', { pos: [10, 9] });
  castNow(h, u, 1);
  h.b.dealDamage(e, a, { amount: 1, type: 'true' });
  const x1 = u.s.atk * bb.shield_atk_scale;
  approx(a.findBuff(BARRIER).shield, x1, 'first');
  h.run(3);
  approx(a.findBuff(BARRIER).shield, x1 * 0.7, 'three steps later');
  // a weaker one: what is left stays (less the 1 the old barrier absorbs of the hit that fires it)
  h.b.addBuff(u, { key: 'test:weak', mods: { atkMul: 0.3 } });
  castNow(h, u, 2);
  assert.ok(a.findBuff(eff('s1', u)), 'on uid 2 again');
  const left = a.findBuff(BARRIER).shield;
  h.b.dealDamage(e, a, { amount: 1, type: 'true' });
  assert.ok(u.s.atk * bb.shield_atk_scale < left - 1);
  assert.equal(a.buffs.filter((x) => x.key === BARRIER).length, 1, 'one S1 barrier');
  const kept = a.findBuff(BARRIER).shield;
  approx(kept, left - 1, 'max(left, new) = left');
  h.run(1);
  approx(a.findBuff(BARRIER).shield, kept * 0.9, 'its own initial / 10 per second');
  // a stronger one replaces it
  h.b.removeBuff(u, 'test:weak');
  h.b.addBuff(u, { key: 'test:atk', mods: { atkPct: 1 } });
  castNow(h, u, 3);
  h.b.dealDamage(e, a, { amount: 1, type: 'true' });
  approx(a.findBuff(BARRIER).shield, u.s.atk * bb.shield_atk_scale, 'max(left, new) = new');
  done(h);
});

test('trigger effects and leaving the field: a holder takes its effect along; she leaves hers on their holders (no talent part while she is away)', () => {
  const bb = skillOf(6, true, S1).bb;
  const others = [{ uid: 2, chessId: 'ally_m', row: 11, col: 5 }, { uid: 3, chessId: 'ally_m', row: 9, col: 5 }];
  const { h, u } = field({ skill: 0, others });
  const [a, b] = [h.unit(2), h.unit(3)];
  a.hp = a.s.maxHp * 0.5; b.hp = b.s.maxHp * 0.6;
  castNow(h, u, 1);
  assert.ok(a.findBuff(eff('s1', u)) && b.findBuff(eff('s1', u)));
  h.b.retreat(a);
  assert.equal(a.findBuff(eff('s1', u)), null, 'uid 2 left the field: its effect too');
  h.b.retreat(u);
  assert.ok(!u.alive && b.findBuff(eff('s1', u)), 'she left: uid 3 keeps hers');
  const e = h.spawn('dummy', { pos: [10, 9] });
  const heals = h.hooksOf('heal').length;
  h.b.dealDamage(e, b, { amount: 1, type: 'true' });
  approx(b.findBuff(BARRIER).shield, u.s.atk * bb.shield_atk_scale, 'the barrier from her ATK');
  assert.equal(stunsOn(h, e).length, 1, 'the stun');
  assert.equal(h.hooksOf('heal').length, heals, 'no 夜的哑然 heal while she is away');
  done(h);
});

test('T1 夜的哑然: each firing gives her `sp` SP and heals heal_scale × her ATK (潜能 1: 80 %, 6: 100 %) on the injured ally operator of her range with the lowest HP ratio', () => {
  for (const [tier, elite, potential] of [[5, false, 1], [6, true, 6], [6, false, 2], [5, true, 3]]) {
    const t0 = talentOf(tier, elite, 0, potential);
    const others = [{ uid: 2, chessId: 'ally_m', row: 11, col: 5 }, { uid: 3, chessId: 'ally_m', row: 9, col: 5 }, { uid: 4, chessId: 'ally_m', row: 10, col: 9 }];
    const { h, u } = field({ tier, elite, potential, skill: 0, others });
    const [a, b, c] = [2, 3, 4].map((id) => h.unit(id));
    a.hp = a.s.maxHp * 0.4; b.hp = b.s.maxHp * 0.3; c.hp = c.s.maxHp * 0.1;
    castNow(h, u, 1);
    const [sp0, hb, hc] = [u.skill.sp, b.hp, c.hp];
    h.b.dealDamage({ source: null, target: a, amount: 1, type: 'true' });
    approx(u.skill.sp - sp0, t0.sp, `潜能 ${potential}: +${t0.sp} SP`);
    approx(b.hp - hb, u.s.atk * t0.heal_scale, `潜能 ${potential}: heal ${t0.heal_scale * 100} % ATK on uid 3 (30 %)`);
    assert.equal(c.hp, hc, 'uid 4 (10 %) is outside her range');
    assert.equal(t0.heal_scale, potential <= 2 ? 0.8 : 1);
    done(h);
  }
});

test('T2 雪的印痕: after she places an effect her next attack bursts on its target — the enemies within attack@projectile_range take its damage, all get 虚弱 20 % for 8 s (潜能 ≤ 4: 6 s) and her ATK × 0.8 arts every second meanwhile; the attack after is plain', () => {
  for (const [tier, elite, potential] of [[5, false, 6], [6, true, 6], [6, true, 4], [5, false, 1]]) {
    const t1 = talentOf(tier, elite, 1, potential);
    const { h, u } = field({ tier, elite, potential, skill: 0 });
    castNow(h, u, 1);
    assert.ok(u.findBuff(eff('s1', u)) && u.findBuff('tocka:snow'), 'on herself; her next attack armed');
    const r = t1['attack@projectile_range'];
    const main = h.spawn('dummy', { pos: [10, 7] });
    const near = h.spawn('dummy', { pos: [10, 7 + r - 0.1] }), far = h.spawn('dummy', { pos: [10, 7 + r + 0.1] });
    const hitsOn = (e) => h.hooksOf('damaged').filter((c) => c.source === u && c.target === e);
    assert.ok(h.runUntil(() => hitsOn(main).length > 0, 3), 'her first attack lands');
    assert.ok(!u.findBuff('tocka:snow'), 'spent');
    assert.deepEqual(hitsOn(main).map((c) => [c.type, c.dmg.isSplash]), [['phys', false]]);
    const splash = hitsOn(near);
    assert.equal(splash.length, 1, `within ${r}`);
    assert.deepEqual([splash[0].type, splash[0].dmg.isAttack, splash[0].dmg.isSplash], ['phys', true, true]);
    approx(splash[0].amount, u.s.atk, 'the arrow\'s damage');
    assert.equal(hitsOn(far).length, 0, `beyond ${r}`);
    const weak = h.hooksOf('statusApplied').filter((c) => c.status === 'weaken');
    assert.deepEqual(weak.map((c) => c.target).sort((x, y) => x.id - y.id), [main, near]);
    for (const c of weak) assert.deepEqual([c.value, c.duration], [-t1['attack@t2_atk'], t1['attack@t2_buff_duration']], `潜能 ${potential}`);
    approx(near.findBuff('weaken').mods.atkMul, 0.8, '虚弱 20 %');
    h.run(t1['attack@t2_buff_duration'] + 1);
    const dot = hitsOn(near).filter((c) => c.dmg.tags?.includes('tocka:snow') && c.type === 'arts');
    assert.equal(dot.length, t1['attack@t2_buff_duration'], `潜能 ${potential}: one tick a second for ${t1['attack@t2_buff_duration']} s`);
    for (const c of dot) approx(c.amount, u.s.atk * t1['attack@t2_magic_atk_scale'], 'her ATK × 0.8');
    assert.equal(hitsOn(near).filter((c) => c.type === 'phys').length, 1, 'later attacks on uid main are plain');
    assert.ok(hitsOn(main).filter((c) => c.type === 'phys').length > 3);
    done(h);
  }
});

test('S2 意欲呼啸之心 (AUTO): at full SP the effect goes on the latest created ally operator of the field — not her, not one casting, holding it or her ASPD, with a passive or no skill; nobody legal ⇒ no cast', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const sk = skillOf(tier, elite, S2);
    // deployment order (column by column, left first): her, uid 2, uid 4, uid 3, uid 5 (col 10) — the latest; the two
    // MANUAL skills never fill here, so their effects stay put
    const others = [{ uid: 2, chessId: 'ally_s', row: 12, col: 9 }, { uid: 3, chessId: 'ally_p', row: 9, col: 9 },
      { uid: 4, chessId: 'ally_n', row: 11, col: 9 }, { uid: 5, chessId: 'ally_s', row: 12, col: 10 }];
    const { h, u } = field({ tier, elite, skill: 1, others });
    const [m1, p, n, m2] = [2, 3, 4, 5].map((id) => h.unit(id));
    assert.ok(m2.aggroSeq > Math.max(p.aggroSeq, n.aggroSeq) && Math.min(p.aggroSeq, n.aggroSeq) > m1.aggroSeq);
    const holds = (x) => !!x.findBuff(eff('s2', u));
    h.run(sk.spCost - sk.initSp - 0.5);
    assert.equal(u.skill.activations, 0);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), `${label(f)}: cast at full SP (${sk.spCost} s), no enemy`);
    assert.deepEqual([m2, m1, p, n, u].map(holds), [true, false, false, false, false], `${label(f)}: the latest created (uid 5), anywhere`);
    castNow(h, u, 2);
    assert.deepEqual([m2, m1, p, n, u].map(holds), [true, true, false, false, false], `${label(f)}: then uid 2`);
    h.run(3 * sk.spCost);
    assert.equal(u.skill.activations, 2, `${label(f)}: a passive skill, no skill and herself are never picked`);
    done(h);
  }
  // an ally casting its skill, or holding her ASPD, is skipped (uid 3, col 9, is the latest created)
  const others = [{ uid: 2, chessId: 'ally_m', row: 12, col: 2 }, { uid: 3, chessId: 'ally_m', row: 12, col: 9 }];
  const { h, u } = field({ skill: 1, others });
  const [m1, m2] = [h.unit(2), h.unit(3)];
  assert.ok(m2.aggroSeq > m1.aggroSeq);
  m2.skill.gainSp(10, 'init');
  assert.ok(m2.skill.activate('test') && m2.skill.active);
  castNow(h, u, 1);
  assert.deepEqual([m1, m2].map((x) => !!x.findBuff(eff('s2', u))), [true, false], 'uid 3 is casting');
  m1.skill.gainSp(10, 'init');
  assert.ok(m1.skill.activate('test'));
  assert.ok(m1.findBuff(`tocka:s2:aspd:${u.id}`), 'uid 2 fired (its skill start)');
  h.run(5.5);
  assert.ok(!m1.skill.active && !m2.skill.active);
  castNow(h, u, 2);
  assert.deepEqual([m1, m2].map((x) => !!x.findBuff(eff('s2', u))), [false, true], 'uid 2 holds her ASPD');
  done(h);
});

test('S2 effect: once its holder\'s skill can open — SP ready and its own target condition met (checked every 0.2 s) — or opens, it fires: ASPD +attack_speed for buff_duration s, a MANUAL skill counting as AUTO meanwhile (no 3 s operation cooldown between its casts), MANUAL again after', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const bb = skillOf(tier, elite, S2).bb;
    const { h, u } = field({ tier, elite, skill: 1, others: [{ uid: 2, chessId: 'ally_c', row: 11, col: 6 }] });
    const m = h.unit(2);
    castNow(h, u, 1);
    assert.ok(m.findBuff(eff('s2', u)));
    h.b.retreat(u); // no recast while this runs (the effect stays: see the leaving-the-field test)
    assert.ok(m.skill.manual && m.findBuff(eff('s2', u)));
    h.run(1);
    assert.ok(m.findBuff(eff('s2', u)), `${label(f)}: not ready, not fired`);
    m.skill.gainSp(30, 'init');
    h.run(1);
    assert.ok(m.skill.ready && m.findBuff(eff('s2', u)), `${label(f)}: ready, but no enemy in its range (满足目标条件): not fired`);
    // an enemy in its range: the target condition of its DEFAULT cast is met — it fires, and its charges go on its next
    // attacks, one an attack: no operation cooldown between them
    const e = h.spawn('dummy', { pos: [11, 7] });
    assert.ok(h.runUntil(() => !m.findBuff(eff('s2', u)), 0.2 + 1e-6), `${label(f)}: fired within 0.2 s of an enemy entering its range`);
    const buff = m.findBuff(`tocka:s2:aspd:${u.id}`);
    assert.deepEqual(buff.mods, { aspd: bb.attack_speed });
    approx(buff.timeLeft, bb.buff_duration, `${label(f)}: ${bb.buff_duration} s`, 0.01);
    approx(m.s.aspd, 100 + bb.attack_speed, `${label(f)}: ASPD`);
    assert.equal(m.skill.manual, false, `${label(f)}: 期间技能变为自动开启`);
    const starts = () => h.hooksOf('skillStart').filter((c) => c.unit === m).map((c) => c.t);
    h.runUntil(() => starts().length >= 3, 4);
    const fast = starts();
    assert.equal(fast.length, 3);
    assert.ok(fast[2] - fast[0] < 3, `${label(f)}: three casts within ${fast[2] - fast[0]} s`);
    h.run(bb.buff_duration);
    assert.deepEqual([m.findBuff(`tocka:s2:aspd:${u.id}`), m.skill.manual], [null, true], `${label(f)}: MANUAL again`);
    m.skill.gainSp(30, 'init');
    h.runUntil(() => starts().length >= fast.length + 3, 12);
    const slow = starts().slice(fast.length);
    assert.equal(slow.length, 3);
    for (let i = 1; i < slow.length; i++) assert.ok(slow[i] - slow[i - 1] >= 3 - 1e-6, `${label(f)}: ${slow[i] - slow[i - 1]} s apart`);
    assert.ok(e.alive);
    done(h);
  }
});

test('S2 effect: "不需要目标/满足目标条件" by its holder skill\'s rule — SKILL_RANGE / ACTIVE_RANGE an enemy on their own range, DEFAULT on its attack range, and the rules with no target of their own (SP_FULL, TAKE_DAMAGE) an enemy on its attack range too (the owner\'s test: "技能/攻击范围内有敌人就自动放，没敌人不会放"); met while the battle-start operation cooldown still holds the skill, the 0.2 s check fires it first and the auto-open lets the cast through', () => {
  const holders = [
    // [rule, record, the holder's tile, an enemy tile outside its condition, one inside]
    ['DEFAULT', 'ally_c', [11, 6], [11, 9], [11, 7]],
    ['SKILL_RANGE', 'ally_k', [12, 3], [10, 9], [12, 7]],
    ['ACTIVE_RANGE', 'ally_r', [9, 3], [10, 9], [9, 6]],
    ['SP_FULL', 'ally_f', [11, 6], [11, 9], [11, 7]],
    ['TAKE_DAMAGE', 'ally_t', [11, 6], [11, 9], [11, 7]],
  ];
  for (const [rule, id, [row, col], out, inside] of holders) {
    const { h, u } = field({ skill: 1, flags: { startOpCooldown: 30 }, others: [{ uid: 2, chessId: id, row, col }] });
    const m = h.unit(2);
    assert.deepEqual([m.skill.rule, m.skill.manual], [rule, true]);
    castNow(h, u, 1); // S2 is AUTO: no operation cooldown of its own
    assert.ok(m.findBuff(eff('s2', u)));
    h.b.retreat(u);
    m.skill.gainSp(10, 'init');
    h.run(1);
    assert.ok(m.skill.ready && m.findBuff(eff('s2', u)), `${rule}: ready, no enemy: it waits`);
    h.spawn('dummy', { pos: out });
    h.run(1);
    assert.ok(m.skill.ready && m.findBuff(eff('s2', u)), `${rule}: ready, the enemy outside its condition: it waits`);
    h.spawn('dummy', { pos: inside });
    assert.ok(h.runUntil(() => !m.findBuff(eff('s2', u)), 0.2 + 1e-6), `${rule}: fired within 0.2 s`);
    assert.ok(m.findBuff(`tocka:s2:aspd:${u.id}`) && !m.skill.manual, `${rule}: ASPD and the auto-open`);
    if (rule !== 'TAKE_DAMAGE') {
      assert.ok(h.runUntil(() => m.skill.activations === 1, 1.5), `${rule}: cast once the operation cooldown is lifted`);
      assert.ok(h.b.time < 30, `${rule}: within the 30 s battle-start operation cooldown`);
    } else {
      h.run(1.5);
      assert.equal(m.skill.activations, 0, `${rule}: the enemy in range never hits it: no hit taken, no cast`);
    }
    done(h);
  }
});

test('S2 effect: its holder opening its skill fires it at once (T1: her `sp` SP); her ASPD buffs are independent of another 冻河\'s; a holder leaving the field turns MANUAL again', () => {
  const t0 = talentOf(6, true, 0);
  const { h, u } = field({ skill: 1, others: [{ uid: 2, chessId: 'ally_m', row: 11, col: 6 }] });
  const m = h.unit(2);
  castNow(h, u, 1);
  const sp0 = u.skill.sp;
  m.skill.gainSp(10, 'init');
  assert.ok(m.skill.activate('test'));
  assert.ok(!m.findBuff(eff('s2', u)) && m.findBuff(`tocka:s2:aspd:${u.id}`), '技能开启时: fired at its skill start');
  approx(u.skill.sp - sp0, t0.sp, '夜的哑然 SP');
  assert.equal(m.skill.manual, false);
  h.b.retreat(m);
  assert.equal(m.skill.manual, true, 'its buffs went with it: MANUAL again');
  done(h);
  // two 冻河 (a pair field's or two players'): each places her own effect on the latest created operator; both fire
  const two = field({ tier: 5, elite: false, skill: 1, extra: [{ uid: 2, diy: { slot: SLOT[6], charId: T, skillIndex: 1 }, elite: true, row: 12, col: 4 }],
    others: [{ uid: 3, chessId: 'ally_m', row: 11, col: 6 }] });
  const [t1, t2, m2] = [two.u, two.h.unit(2), two.h.unit(3)];
  t1.skill.gainSp(999, 'init');
  t2.skill.gainSp(999, 'init');
  assert.ok(two.h.runUntil(() => t1.skill.activations === 1 && t2.skill.activations === 1, 1));
  assert.ok(m2.findBuff(eff('s2', t1)) && m2.findBuff(eff('s2', t2)), 'both on uid 3');
  two.h.spawn('dummy', { pos: [11, 7] }); // in uid 3's range: its target condition
  m2.skill.gainSp(10, 'init');
  two.h.run(0.25);
  const sum = skillOf(5, false, S2).bb.attack_speed + skillOf(6, true, S2).bb.attack_speed;
  approx(m2.s.aspd, 100 + sum, `+${sum}: "不同冻河间的攻击速度加成互相独立"`);
  done(two.h);
});

test('S3 踽踽独行之春 (MANUAL, 20 s, data DEFAULT): ASPD +attack_speed, every attack hits attack@max_target enemies (air too) for attack@atk_scale × ATK physical and stuns each attack@stun s; one plain target after', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const sk = skillOf(tier, elite, S3), bb = sk.bb;
    const { h, u } = field({ tier, elite, skill: 2 });
    u.skill.gainSp(999, 'init');
    h.run(2);
    assert.equal(u.skill.activations, 0, `${label(f)}: no enemy, no cast`);
    const es = [[10, 7], [10, 6], [9, 6]].map((pos) => h.spawn('dummy', { pos })).concat([h.spawn('fly', { pos: [11, 5] })]);
    assert.ok(h.runUntil(() => u.skill.active, 3), `${label(f)}: cast with an enemy in her range`);
    approx(u.skill.timeLeft, sk.duration, `${label(f)}: ${sk.duration} s`, 0.01);
    approx(u.s.aspd, 100 + bb.attack_speed, `${label(f)}: ASPD`);
    assert.equal(u.findBuff('tocka:snow'), null, `${label(f)}: nobody to place an effect on`);
    const n0 = h.hooksOf('damaged').length;
    h.run(6);
    const main = h.hooksOf('damaged').slice(n0).filter((c) => c.source === u && c.dmg.isAttack && !c.dmg.isSplash);
    const byAttack = new Map();
    for (const c of main) byAttack.set(c.dmg.attackId, [...(byAttack.get(c.dmg.attackId) ?? []), c]);
    assert.ok(byAttack.size >= 3, `${label(f)}: ${byAttack.size} attacks`);
    for (const list of byAttack.values()) {
      assert.deepEqual(list.map((c) => c.target).sort((x, y) => x.id - y.id), es, `${label(f)}: ${bb['attack@max_target']} targets, the flyer too`);
      for (const c of list) {
        approx(c.amount, u.s.atk * bb['attack@atk_scale'], `${label(f)}: ${bb['attack@atk_scale'] * 100} % ATK`);
        assert.deepEqual([c.type, c.dmg.isSkill], ['phys', true]);
      }
    }
    assert.equal(h.hooksOf('damaged').slice(n0).filter((c) => c.dmg.isSplash).length, 0);
    for (const e of es) {
      assert.ok(stunsOn(h, e).length >= byAttack.size, `${label(f)}: ${e.defId} stunned at every hit`);
      approx(stunsOn(h, e)[0].duration, bb['attack@stun'], `${label(f)}: stun ${bb['attack@stun']} s`);
    }
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `${label(f)}: 3-18 during S3`);
    h.runUntil(() => !u.skill.active, sk.duration);
    approx(u.s.aspd, 100, `${label(f)}: ASPD back`);
    const n1 = h.hooksOf('damaged').length;
    h.run(5);
    const plain = h.hooksOf('damaged').slice(n1).filter((c) => c.source === u && c.dmg.isAttack);
    assert.ok(plain.length >= 2);
    assert.equal(new Set(plain.map((c) => c.dmg.attackId)).size, plain.length, `${label(f)}: one target an attack`);
    for (const c of plain) assert.ok(!c.dmg.isSkill && Math.abs(c.amount - u.s.atk) < 1e-6);
    done(h);
  }
});

test('S3 effect: at its start it goes on the ally operator of her range with the highest true SP ratio; its holder\'s skill start gives it and her ATK +bonus_init_atk falling by bonus_atk_dec_per_sec a second, and it moves on (never back, never to her); during S3 its holder gains bonus_sp SP a second; a later S3 fires it', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const bb = skillOf(tier, elite, S3).bb;
    const others = [{ uid: 2, chessId: 'ally_c', row: 11, col: 5 }, { uid: 3, chessId: 'ally_m', row: 9, col: 5 },
      { uid: 4, chessId: 'ally_m', row: 10, col: 9 }, { uid: 5, chessId: 'ally_m', row: 12, col: 5 }];
    const { h, u } = field({ tier, elite, skill: 2, others });
    const [a, b, c, d] = [2, 3, 4, 5].map((id) => h.unit(id));
    // true ratios: uid 2 2 of 3 charges ≈ 0.67, uid 3 8 / 10, uid 4 9.5 / 10 (outside her range), uid 5 casting: 0
    a.skill.gainSp(20, 'init'); b.skill.gainSp(8, 'init'); c.skill.gainSp(9.5, 'init'); d.skill.gainSp(10, 'init');
    assert.ok(d.skill.activate('test'));
    const holder = () => h.allies().filter((x) => x.findBuff(eff('s3', u)));
    u.skill.gainSp(999, 'init');
    assert.ok(u.skill.activate('test'));
    assert.deepEqual(holder(), [b], `${label(f)}: uid 3 (0.8)`);
    assert.ok(u.findBuff('tocka:snow'), `${label(f)}: placed: her next attack armed`);
    b.skill.gainSp(5, 'init');
    assert.ok(b.skill.activate('test'));
    for (const x of [b, u]) assert.deepEqual(x.findBuff(`tocka:s3:atk:${u.id}`)?.mods, { atkPct: bb.bonus_init_atk }, `${label(f)}: uid ${x.uid} ATK +${bb.bonus_init_atk * 100} %`);
    approx(u.s.atk, u.base.atk * (1 + bb.bonus_init_atk), `${label(f)}: her ATK`);
    assert.deepEqual(holder(), [a], `${label(f)}: moved to uid 2 (0.67 > 0)`);
    assert.equal(u.skill.sp, 0, `${label(f)}: no 夜的哑然 SP during S3`);
    const sp0 = a.skill.spTotal;
    h.run(1);
    approx(a.skill.spTotal - sp0, 1 + bb.bonus_sp, `${label(f)}: its own 1 SP/s + ${bb.bonus_sp}`);
    approx(u.findBuff(`tocka:s3:atk:${u.id}`).mods.atkPct, bb.bonus_init_atk - bb.bonus_atk_dec_per_sec, `${label(f)}: −${bb.bonus_atk_dec_per_sec} a second`);
    h.run(bb.bonus_duration - 1 + 0.05);
    assert.equal(u.findBuff(`tocka:s3:atk:${u.id}`), null, `${label(f)}: gone after ${bb.bonus_duration} s`);
    // S3 over; uid 2 still holds it (no enemy: its skill waits); the next S3 fires it instead of placing another
    h.runUntil(() => !u.skill.active, 25);
    assert.deepEqual(holder(), [a]);
    u.skill.gainSp(999, 'init');
    assert.ok(u.skill.activate('test'));
    assert.deepEqual(a.findBuff(`tocka:s3:atk:${u.id}`)?.mods, { atkPct: bb.bonus_init_atk }, `${label(f)}: fired at her S3 start`);
    // uids 3 and 5 are both full again (ratio 1): the latest created of the two (uid 3: col 5 deploys bottom row first)
    assert.deepEqual([b, d].map((x) => x.skill.spTotal / (x.skill.maxCharges * x.skill.spCost)), [1, 1]);
    assert.ok(b.aggroSeq > d.aggroSeq);
    assert.deepEqual(holder(), [b], `${label(f)}: moved on to the latest created of the full ones`);
    done(h);
  }
  // no legal operator to move to ⇒ it is gone
  const { h, u } = field({ skill: 2, others: [{ uid: 2, chessId: 'ally_m', row: 9, col: 5 }, { uid: 3, chessId: 'ally_m', row: 10, col: 9 }] });
  const b = h.unit(2);
  u.skill.gainSp(999, 'init');
  u.skill.activate('test');
  assert.ok(b.findBuff(eff('s3', u)));
  b.skill.gainSp(10, 'init');
  b.skill.activate('test');
  assert.ok(b.findBuff(`tocka:s3:atk:${u.id}`));
  assert.equal(h.allies().filter((x) => x.findBuff(eff('s3', u))).length, 0, 'uid 3 is outside her range: none left');
  done(h);
});
