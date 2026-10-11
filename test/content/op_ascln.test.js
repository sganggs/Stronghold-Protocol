// test/content/op_ascln.test.js — the 自选 operator kit of 阿斯卡纶 (char_4132_ascln, 6★ 伏击客; kit
// server/sim/content/kits/ops/op-ascln.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, AMB-X
// “无形，无情” or AMB-Y “阿斯卡纶的眼睛” at stage 1 (tier 5) / 3 (tier 6). Numbers from data/backups.json; the fidelity
// checklist of kits/README.md.
// Run: node --test test/content/op_ascln.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { dreadKey, DREAD_TAG } from '../../server/sim/content/kits/ops/op-ascln.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const ASC = 'char_4132_ascln';
const FORMS = BACKUPS.units[ASC].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const AX = 'uniequip_002_ascln', AY = 'uniequip_003_ascln';
const S1 = 'skchr_ascln_1', S2 = 'skchr_ascln_2', S3 = 'skchr_ascln_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }), enemy_weak: dummy('enemy_weak', { hp: 10 }),
  enemy_hitter: dummy('enemy_hitter', { atk: 200, range: 1.5, bat: 0.5 }),
  enemy_walkslow: enemyRec({ key: 'enemy_walkslow', hp: 1e9, speed: 1, mass: 0 }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, AX, AY].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/** 阿斯卡纶 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, others = [], seed = 5, items = [] } = {}) {
	const h = makeBattle({
		defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
		flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'attack', 'heal', 'dodge'], captureNoisy: true,
		units: [{ uid: 1, diy: { slot: SLOT[tier], charId: ASC, skillIndex: skill, uniEquipId: mod }, elite, row, col, items }, ...others],
	});
	h.step();
	return { h, u: h.unit(1) };
}
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
/** Keep her from casting (no SP). */
function noSkill(h, u) {
  u.skill.charges = 0; u.skill.sp = 0;
  h.b.addBuff(u, { key: 'test:noSp', flags: { noSp: true } });
}

test('阿斯卡纶 in every 自选 form: her kit (all three skills authored), the form\'s stats + module attributes, y-1, 伏击客 (melee, every enemy in range, ground only, 50 % / AMB-Y 65 % dodge, taunt level −1 — not −2), blocks 0, the data triggers; offered as a pick', () => {
  assert.equal(OPERATOR_KITS[ASC], KITS[ASC]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [ASC, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res],
        [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0), 30], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.profile.allInRange, u.profile.sub, u.base.bat],
        [0, 'melee', false, 'phys', true, 'stalker', 3.5], `${label(f)}: 伏击客`);
      const p = mod === AY ? 0.65 : 0.5;
      assert.deepEqual([u.s.dodgePhys, u.s.dodgeArts, u.s.taunt], [p, p, -1], `${label(f)}: dodge, taunt −1`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: y-1`);
      assert.equal(u.skill.rule, form.skills[skill].trigger.rule, `${label(f)}: the data's trigger`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth && !u.s.flags.untargetable, `${label(f)}: ground enemies can target her`);
      done(h);
    }
  }
  assert.deepEqual(formOf(6, true).skills.map((s) => s.trigger.rule), ['DEFAULT', 'DEFAULT', 'ACTIVE_RANGE']);
  assert.deepEqual([modOf(5, AX).attr, modOf(6, AX).attr, modOf(5, AY).attr, modOf(6, AY).attr],
    [{ maxHp: 180, atk: 15 }, { maxHp: 270, atk: 53 }, { atk: 55, def: 25 }, { atk: 80, def: 60 }]);
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(ASC) && [5, 6].every((t) => diyPool(t, { data, kitted: KITTED_CHARS }).includes(ASC)));
  assert.equal(validateDiyPicks({ [SLOT[6]]: { charId: ASC, skillIndex: 2, uniEquipId: AX } }, { data, kitted: KITTED_CHARS }).ok, true);
});

test('trait 伏击客: one attack strikes every ground enemy of her y-1 at once (physical), never a flyer; her dodge lets 50 % (AMB-Y 65 %) of the enemy hits through as dodges', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, AY]]) {
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    noSkill(h, u);
    const a = h.spawn('enemy_dummy', { pos: [10, 6] }), b = h.spawn('enemy_dummy', { pos: [11, 4] }), c = h.spawn('enemy_dummy', { pos: [10, 7] });
    const fly = h.spawn('enemy_fly', { pos: [9, 5] });
    assert.ok(h.runUntil(() => atkHits(h, u).length >= 3, 6));
    const id = atkHits(h, u)[0].dmg.attackId;
    const hit = atkHits(h, u).filter((x) => x.dmg.attackId === id);
    assert.deepEqual(new Set(hit.map((x) => x.target)), new Set([a, b, c]), `T${tier}: every ground enemy of y-1 ([0,2] included)`);
    for (const x of hit) assert.equal(x.type, 'phys');
    assert.ok(!atkHits(h, u).some((x) => x.target === fly), 'never the flyer');
    // her dodge
    const hitter = h.spawn('enemy_hitter', { pos: [10, 6] });
    h.b.addBuff(u, { key: 'test:inv', mods: { defFlat: 1e6 } });
    h.run(200);
    const dodged = h.hooksOf('dodge').filter((x) => x.target === u && x.source === hitter).length;
    const landed = h.hooksOf('damaged').filter((x) => x.target === u && x.source === hitter).length;
    const r = dodged / (dodged + landed);
    assert.ok(dodged + landed > 200 && Math.abs(r - (mod === AY ? 0.65 : 0.5)) < 0.06, `T${tier}: dodge rate ${r}`);
    done(h);
  }
});

test('T1 死亡拘审: every hit of her attacks adds a layer (≤ 3, the duration reset): move ×(1 − 0.18 × layers), layers × 10 % of her current ATK as arts every second (法术持续伤害: not dodgeable) for 25 s; AMB-X stage 3: 11 %, 30 s; all of it ends the moment she leaves', () => {
  for (const [tier, elite, mod] of [[5, false, null], [5, true, AX], [6, true, AX], [6, true, AY]]) {
    const x3 = tier === 6 && mod === AX;
    const tb = (elite ? formOf(tier, true) : formOf(tier, elite)).talents.find((t) => t.index === 0).bb;
    const [ratio, dur] = x3 ? [0.11, 30] : [0.1, 25];
    if (!x3) assert.deepEqual(tb, { move_speed: -0.18, atk_ratio: 0.1, max_stack_cnt: 3, debuff_duration: 25, interval: 1 });
    else assert.deepEqual(modOf(6, AX).talentChanges.find((t) => t.talentIndex === 0).bb, { move_speed: -0.18, atk_ratio: 0.11, max_stack_cnt: 3, debuff_duration: 30, interval: 1 });
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    noSkill(h, u);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1, dodgeArts: 1 } });
    const key = dreadKey(u);
    // a dodged attack lands nothing and adds nothing
    h.run(4);
    assert.equal(e.findBuff(key), null, `${label([tier, elite, mod])}: dodged hits add no layer`);
    h.b.removeBuff(e, 'test:dodge');
    const n0 = atkHits(h, u).length;
    assert.ok(h.runUntil(() => atkHits(h, u).length > n0, 5));
    let b = e.findBuff(key);
    assert.deepEqual([b.data.n, b.duration], [1, dur], 'one layer');
    approx(b.mods.moveMul, 0.82, 'move ×0.82');
    // its ticks: 10 % × layers of her current ATK, arts, not dodgeable
    const ticks = () => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.tags?.includes(DREAD_TAG));
    h.run(1.05);
    const t1 = ticks();
    assert.ok(t1.length >= 1, 'a tick');
    approx(t1[0].amount, u.s.atk * ratio * 1, `${label([tier, elite, mod])}: ${ratio * 100} % ATK × 1`);
    assert.deepEqual([t1[0].type, t1[0].dmg.canDodge, t1[0].dmg.isAttack], ['arts', false, false]);
    assert.ok(h.runUntil(() => e.findBuff(key)?.data.n === 3, 15), 'three layers');
    b = e.findBuff(key);
    approx(b.mods.moveMul, 1 - 0.18 * 3, 'move ×0.46');
    h.run(5);
    assert.equal(e.findBuff(key).data.n, 3, '≤ 3 layers');
    const last = ticks().slice(-1)[0];
    approx(last.amount, u.s.atk * ratio * 3, 'three layers tick ×3');
    approx(e.findBuff(key).timeLeft, dur, 'reset on each hit', 0.15);
    // no more hits: it runs out after its duration
    h.b.addBuff(u, { key: 'test:disarm', flags: { disarm: true } });
    const tLast = atkHits(h, u).filter((c) => c.target === e).slice(-1)[0].t;
    h.run(tLast + dur - 0.3 - h.b.time);
    assert.ok(e.findBuff(key), 'still there');
    h.run(0.6);
    assert.equal(e.findBuff(key), null, `gone ${dur} s after the last hit`);
    // she leaves: every layer of hers ends at once
    h.b.removeBuff(u, 'test:disarm');
    h.runUntil(() => e.findBuff(key), 5);
    h.b.retreat(u);
    assert.equal(e.findBuff(key), null, 'ends the moment she leaves');
    done(h);
  }
});

test('#489: 死亡拘审 ticks trigger her attack effects (normal/golden 不融冰 and 催泪瓦斯), without adding layers or refreshing the talent', () => {
	for (const [id, status, hit, miss] of [
		['chess_item_5_02_e_a', 'cold', 0.119, 0.121],
		['chess_item_5_02_e_b', 'cold', 0.199, 0.201],
		['chess_item_5_01_e_a', 'palsy', 0.029, 0.031],
		['chess_item_5_01_e_b', 'palsy', 0.049, 0.051],
	]) {
		for (const [rng, want] of [[hit, true], [miss, false]]) {
			const { h, u } = field({ skill: 1, items: [id] });
			noSkill(h, u);
			const e = h.spawn('enemy_dummy', { pos: [10, 6] });
			// Start with one ordinary attack, then leave only her talent running.
			h.b.rng = Object.assign(() => 0.99, h.b.rng);
			assert.ok(h.runUntil(() => e.findBuff(dreadKey(u)), 5));
			h.b.addBuff(u, { key: 'test:disarm', flags: { disarm: true } });
			h.b.rng = Object.assign(() => rng, h.b.rng);
			const attacks = u.stats.attacks;
			const applied = () => h.hooksOf('statusApplied').filter((c) => c.source === u && c.target === e && c.status === status);
			assert.equal(applied().length, 0, `${id}: ordinary attack did not proc`);
			const hooks = h.hooksOf('attack').length;
			// Other DoTs, including sourceless ones credited to her, gain no attack effect.
			h.b.dealDamage(u, e, { amount: 1, type: 'arts', canDodge: false, sourceless: true, tags: ['dot'] });
			assert.equal(h.hooksOf('attack').length, hooks);
			assert.equal(applied().length, 0);
			assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.dmg.tags?.includes(DREAD_TAG)), 2));
			const tick = h.hooksOf('damaged').find((c) => c.dmg.tags?.includes(DREAD_TAG));
			assert.equal(tick.source, u, 'talent damage comes from her');
			assert.equal(tick.dmg.sourceless, false);
			assert.equal(tick.dmg.isAttack, false, 'BUFF damage does not apply the NORMAL-attack talent again');
			assert.equal(h.hooksOf('attack').length, hooks + 1, 'one attack-effect trigger per target tick');
			assert.equal(applied().length, want ? 1 : 0, `${id}: tick proc probability`);
			if (want && status === 'cold') approx(e.findBuff('cold').timeLeft, 1.5, 'cold lasts 1.5 s');
			assert.equal(u.stats.attacks, attacks, 'ticks do not perform ordinary attacks');
			assert.equal(e.findBuff(dreadKey(u)).data.n, 1, 'ticks add no layers');
			assert.ok(e.findBuff(dreadKey(u)).timeLeft < 24.1, 'tick does not refresh duration');
			h.run(25);
			assert.equal(e.findBuff(dreadKey(u)), null, 'talent expires despite its attack effects');
			done(h);
		}
	}
});

test('#489: each marked enemy rolls separately; DoT consumes no S1 charge and stops triggering effects after retreat', () => {
	const { h, u } = field({ items: ['chess_item_5_02_e_a'] });
	noSkill(h, u);
	h.b.rng = Object.assign(() => 0.99, h.b.rng);
	const enemies = [h.spawn('enemy_dummy', { pos: [10, 6] }), h.spawn('enemy_dummy', { pos: [11, 5] })];
	assert.ok(h.runUntil(() => enemies.every((e) => e.findBuff(dreadKey(u))), 5));
	h.b.addBuff(u, { key: 'test:disarm', flags: { disarm: true } });
	u.skill.gainSp(999);
	const charges = u.skill.charges, attacks = u.stats.attacks, activations = u.skill.activations;
	let rolls = 0;
	h.b.rng = Object.assign(() => { rolls++; return 0; }, h.b.rng);
	h.run(1.05);
	assert.equal(rolls, 2, 'each marked enemy rolls once');
	for (const e of enemies) {
		assert.ok(e.findBuff('cold'), 'each enemy receives its own cold');
		assert.equal(e.findBuff(dreadKey(u)).data.n, 1);
	}
	assert.deepEqual([u.skill.charges, u.stats.attacks, u.skill.activations], [charges, attacks, activations]);
	h.b.retreat(u);
	h.run(2);
	assert.equal(rolls, 2, 'no attack effect after her retreat');
	assert.ok(enemies.every((e) => !e.findBuff(dreadKey(u))));
	done(h);
});

test('T2 噬光残影: ASPD +10; +6 more with 高台 (HIGHLAND) among the four tiles next to her — the ranged wall on her left, the forbidden rim below', () => {
  for (const [row, col, high] of [[10, 5, false], [10, 3, true], [12, 6, true], [11, 5, false]]) {
    const { h, u } = field({ tier: 6, elite: true, skill: 1, row, col });
    approx(u.s.aspd, 100 + 10 + (high ? 6 : 0), `(${row},${col}): ASPD`);
    approx(u.s.interval, 3.5 * 100 / u.s.aspd, 'interval');
    done(h);
  }
  assert.deepEqual(FORMS['2/1/4/0'].talents.find((t) => t.index === 1).bb, { attack_speed: 10, attack_speed_add: 6, cnt: 1 });
});

test('S1 追袭 (AUTO, 2 / 3 charges, data DEFAULT): the next attack strikes every enemy of her range twice at 130 % / 170 % ATK — two 死亡拘审 layers', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    assert.deepEqual([sk.spCost, sk.initSp, sk.maxChargeTime, sk.bb.atk_scale, sk.skillType], elite ? [8, 4, 3, 1.7, 'AUTO'] : [10, 2, 2, 1.3, 'AUTO'], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.kind, u.skill.rule, u.skill.maxCharges], ['charges', 'DEFAULT', elite ? 3 : 2]);
    const a = h.spawn('enemy_dummy', { pos: [10, 6] }), b = h.spawn('enemy_dummy', { pos: [11, 5] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 3), `T${tier}: cast on her next attack`);
    h.step();
    const hits = atkHits(h, u).filter((c) => c.dmg.isSkill);
    assert.equal(hits.length, 4, `T${tier}: 2 enemies × 2 strikes`);
    for (const c of hits) approx(c.amount, u.s.atk * sk.bb.atk_scale, `T${tier}: ×${sk.bb.atk_scale}`);
    assert.deepEqual([a.findBuff(dreadKey(u)).data.n, b.findBuff(dreadKey(u)).data.n], [2, 2], `T${tier}: two layers each`);
    assert.equal(u.skill.charges, u.skill.maxCharges - 1, 'one charge spent');
    done(h);
  }
});

test('S2 恩赐 (MANUAL, 35 s, data DEFAULT): ATK +50 % / +90 %; every enemy of her range — air units too (PRTS 修正) — moves ×0.7 / ×0.6; a ground enemy of her range knocked out gives one 死亡拘审 layer to the ground enemies within 1.3 of it (not flyers, not beyond)', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    assert.deepEqual([sk.duration, sk.spCost, sk.initSp, sk.bb.atk, sk.bb.move_speed, sk.bb.range_radius], [35, elite ? 24 : 27, elite ? 10 : 5, elite ? 0.9 : 0.5, elite ? -0.4 : -0.3, 1.3], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 1 });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['duration', 'DEFAULT']);
    const weak = h.spawn('enemy_weak', { pos: [10, 6] });
    h.b.addBuff(weak, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    const near = h.spawn('enemy_dummy', { pos: [11, 6] });   // 1 tile from it, in her range too
    const fly = h.spawn('enemy_fly', { pos: [10, 7] });      // in her range (air), 1 tile from it
    const out = h.spawn('enemy_dummy', { pos: [9, 8] });     // outside her range, √5 from it
    h.b.addBuff(near, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 5), `T${tier}: cast`);
    approx(u.skill.timeLeft, 35, '35 s', 0.01);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    h.run(0.3);
    for (const e of [weak, near, fly]) approx(e.findBuff('ascln:s2slow')?.mods.moveMul ?? 1, 1 + sk.bb.move_speed, `T${tier}: ${e.defId} slowed`);
    assert.equal(out.findBuff('ascln:s2slow'), null, 'not outside her range');
    // the knock-out: one layer on the ground enemy next to it; the flyer and the far one get none
    h.b.removeBuff(weak, 'test:dodge');
    assert.ok(h.runUntil(() => !weak.alive, 10), 'knocked out');
    assert.equal(near.findBuff(dreadKey(u))?.data.n, 1, `T${tier}: a layer on the ground enemy within 1.3`);
    assert.equal(fly.findBuff(dreadKey(u)), null, 'never a flyer');
    assert.equal(out.findBuff(dreadKey(u)), null, 'not beyond 1.3');
    u.skill.extend(-999);
    h.step(2);
    h.run(0.5);
    assert.equal(near.findBuff('ascln:s2slow'), null, `T${tier}: the slow ends with the skill`);
    done(h);
  }
});

test('S3 降临 (MANUAL, 45 s, data ACTIVE_RANGE on y-10): an enemy only on y-10 casts it; range y-10; ATK +20 %, interval 3.5 − 1.2 / 1.5 s, taunt level −1 → +1; ground enemies of her range miss 15 % / 30 % of their attacks (one roll per attack), and a miss on her or a dodge of hers heals 4 % / 5 % of her max HP', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    assert.deepEqual([sk.duration, sk.spCost, sk.initSp, sk.bb.atk, sk.bb.base_attack_time, sk.bb.taunt_level, sk.bb['attack@hp_ratio'], sk.bb['attack@damage_hitrate_physical'], sk.rangeId],
      [45, elite ? 49 : 53, elite ? 30 : 25, 0.2, elite ? -1.5 : -1.2, 2, elite ? 0.05 : 0.04, elite ? -0.3 : -0.15, 'y-10'], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 2 });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['duration', 'ACTIVE_RANGE']);
    u.skill.gainSp(999);
    const far = h.spawn('enemy_dummy', { pos: [12, 5] });   // [2,0]: in y-10, not in y-1
    assert.ok(h.runUntil(() => u.skill.active, 1), `T${tier}: cast for [2,0]`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: y-10 while it runs`);
    approx(u.s.atk, u.base.atk * 1.2, 'ATK +20 %');
    approx(u.s.interval, (3.5 + sk.bb.base_attack_time) * 100 / u.s.aspd, 'interval');
    assert.equal(u.s.taunt, 1, 'taunt level +1');
    h.b.kill(far, null);
    // a ground hitter in her range: count its attacks before and after the 命中率 roll
    const hitter = h.spawn('enemy_hitter', { pos: [10, 6] });
    h.b.addBuff(hitter, { key: 'test:dodge', mods: { dodgePhys: 1 } });   // she never kills it
    const seen = new Set(), passed = new Set();
    h.b.on('hit', (c) => { if (c.source === hitter && c.dmg.isAttack) seen.add(c.dmg.attackId); }, { priority: 295 });
    h.b.on('hit', (c) => { if (c.source === hitter && c.dmg.isAttack && !c.dmg.cancel) passed.add(c.dmg.attackId); }, { priority: 280 });
    h.b.on('fatal', (c) => { if (c.unit === u) c.prevented = true; });
    h.b.addBuff(u, { key: 'test:tough', mods: { defFlat: 1e6 } });
    const heals0 = h.hooksOf('heal').filter((c) => c.target === u).length;
    u.skill.extend(400);
    h.run(300);
    const r = 1 - passed.size / seen.size;
    assert.ok(seen.size > 400 && Math.abs(r - Math.abs(sk.bb['attack@damage_hitrate_physical'])) < 0.05, `T${tier}: miss rate ${r} (${seen.size} attacks)`);
    const dodges = h.hooksOf('dodge').filter((c) => c.target === u && c.source === hitter).length;
    const heals = h.hooksOf('heal').filter((c) => c.target === u).length - heals0;
    assert.equal(heals, (seen.size - passed.size) + dodges, `T${tier}: a heal per miss on her and per dodge`);
    approx(h.hooksOf('heal').filter((c) => c.target === u).slice(-1)[0].amount, u.s.maxHp * sk.bb['attack@hp_ratio'], `T${tier}: ${sk.bb['attack@hp_ratio'] * 100} % max HP`, 1e-3);
    u.skill.extend(-999);
    h.step(2);
    assert.deepEqual([u.s.taunt, u.liveRangeGrid], [-1, formOf(tier, elite).rangeGrid], `T${tier}: back`);
    done(h);
  }
});

test('AMB-X “无形，无情”: every enemy of her range (air too) moves ×0.8 (stages 1 and 3) — two 阿斯卡纶 with it: ×0.64 (PRTS: they stack); none without it', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    noSkill(h, u);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] }), fly = h.spawn('enemy_fly', { pos: [9, 5] });
    h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    h.run(0.6);
    const x = elite && mod === AX;
    if (x) assert.deepEqual(formOf(tier, true).modules.find((m) => m.uniEquipId === AX).talentChanges.find((t) => t.talentIndex === -1).bb, { move_speed: -0.2 });
    for (const t of [e, fly]) approx(t.findBuff(`ascln:ambx#${u.id}`)?.mods.moveMul ?? 1, x ? 0.8 : 1, `${label(f)}: ${t.defId}`);
    done(h);
  }
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 60, autoFinish: false, seed: 3, flags: { dpPerSec: 0 },
    units: [{ uid: 1, diy: { slot: 5, charId: ASC, skillIndex: 1, uniEquipId: AX }, elite: true, row: 10, col: 5 },
      { uid: 2, diy: { slot: 6, charId: ASC, skillIndex: 1, uniEquipId: AX }, elite: true, row: 11, col: 5 }],
  });
  h.step();
  const e = h.spawn('enemy_walkslow', { pos: [10, 6] });
  h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  h.run(0.5);
  approx(e.s.moveSpeed, e.base.moveSpeed * 0.8 * 0.8, 'two AMB-X slows multiply');
  done(h);
});

test('AMB-Y “阿斯卡纶的眼睛”: 65 % dodge (stages 1 and 3); stage 3 adds "拥有该效果的敌人被击倒时阿斯卡纶回复10%生命" — a heal of 10 % of her max HP whoever knocks out an enemy carrying her 死亡拘审', () => {
  for (const [tier, elite, mod] of [[5, true, AY], [6, true, AY], [6, true, AX], [6, false, null]]) {
    const y3 = tier === 6 && mod === AY;
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    noSkill(h, u);
    if (y3) assert.equal(modOf(6, AY).talentChanges.find((t) => t.talentIndex === 0).bb.hp_ratio, 0.1);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => e.findBuff(dreadKey(u)), 6), 'marked');
    u.hp = 100;
    const h0 = h.hooksOf('heal').filter((c) => c.target === u).length;
    h.b.kill(e, null);   // knocked out by anybody
    const heals = h.hooksOf('heal').filter((c) => c.target === u).slice(h0);
    if (y3) {
      assert.equal(heals.length, 1, 'one heal');
      approx(heals[0].amount, u.s.maxHp * 0.1, '10 % of her max HP');
    } else assert.equal(heals.length, 0, `${tier} ${mod}: no heal`);
    // an unmarked enemy: nothing
    const plain = h.spawn('enemy_dummy', { pos: [12, 8] });
    h.b.kill(plain, null);
    assert.equal(h.hooksOf('heal').filter((c) => c.target === u).length - h0, y3 ? 1 : 0);
    done(h);
  }
});
