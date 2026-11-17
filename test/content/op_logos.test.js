// test/content/op_logos.test.js — the 自选 operator kit of 逻各斯 (char_4133_logos, 6★ 中坚术师; kit
// server/sim/content/kits/ops/op-logos.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, CCR-Δ
// “来自河谷的笔盒” or CCR-Y “《语义范式百科》” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from
// data/backups.json (the form of that slot status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_logos.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const LOGOS = 'char_4133_logos';
const FORMS = BACKUPS.units[LOGOS].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const CCRD = 'uniequip_002_logos', CCRY = 'uniequip_003_logos';
const S1 = 'skchr_logos_1', S2 = 'skchr_logos_2', S3 = 'skchr_logos_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
/** The talent bb of a form with a module's changes (stage 2+ rewrites 语汇演化). */
const talentOf = (tier, elite, mod, i) => {
  const m = elite ? modOf(tier, mod) : null;
  return m?.talentChanges.find((t) => t.talentIndex === i)?.bb ?? formOf(tier, elite).talents.find((t) => t.index === i).bb;
};
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }), enemy_elite: dummy('enemy_elite', { rank: 'ELITE' }),
  enemy_boss: dummy('enemy_boss', { rank: 'BOSS' }), enemy_low: dummy('enemy_low', { hp: 300 }),
  enemy_gun: dummy('enemy_gun', { atk: 100, range: 3, bat: 1, applyWay: 'RANGED' }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, CCRD, CCRY].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/** A battle with 逻各斯 as uid 1 at (row, col) facing RIGHT. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, others = [], seed = 5, setup } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed, setup,
    flags: { dpPerSec: 0 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'attack', 'elementBurst'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: LOGOS, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
const tagged = (h, u, tag) => h.hooksOf('damaged').filter((c) => c.source === u && (c.dmg?.tags || []).includes(tag));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
/** Start the skill now (SP filled, no enemy needed). */
function cast(u) { u.skill.gainSp(999); assert.ok(u.skill.activate('test')); }

test('逻各斯 in every 自选 form: his operator kit (all three skills authored), stats + module attributes, 3-1 range, ranged arts that hits air units, targetable by ground enemies, 空 bond, no 特质', () => {
  assert.equal(OPERATOR_KITS[LOGOS], KITS[LOGOS]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [LOGOS, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def, form.stats.res + (m?.attr.res ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.dmgType, u.profile.canHitFly, u.base.bat], [1, 'ranged', 'arts', true, 1.6], `${label(f)}: 中坚术师`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target him`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN, full potential): E2 Lv1 1297 / 583, E2 Lv60 1540 / 659; CCR-Δ +100 / +36 → +170 / +67 HP / ATK,
  // CCR-Y +35 / +5 → +60 / +5 ATK / RES
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [1297, 583, 1540, 659]);
  assert.deepEqual([modOf(5, CCRD).attr, modOf(6, CCRD).attr, modOf(5, CCRY).attr, modOf(6, CCRY).attr], [{ maxHp: 100, atk: 36 }, { maxHp: 170, atk: 67 }, { atk: 35, res: 5 }, { atk: 60, res: 5 }]);
});

test('a 自选 pick: 逻各斯 is offered at tiers 5 and 6 (he has a kit) and a roster with him passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(LOGOS));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(LOGOS), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: LOGOS, skillIndex: 2, uniEquipId: CCRY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: LOGOS, skillIndex: 2, uniEquipId: CCRY } } });
});

test('S1 殁亡 (AUTO, data DEFAULT): 74 / 68 SP from 0, cast as he is about to attack an enemy of his 3-1; then for good the 3-3 range and ATK +40 % / +70 %', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.rule, u.skill.kind, u.skill.spCost, sk.initSp, sk.bb.atk, sk.rangeId], ['DEFAULT', 'toggle', elite ? 68 : 74, 0, elite ? 0.7 : 0.4, '3-3'], `T${tier}`);
    h.run(sk.spCost - 1);
    assert.equal(u.skill.activations, 0, `T${tier}: not before its SP is full`);
    h.run(3);
    assert.equal(u.skill.activations, 0, `T${tier}: full SP, no enemy: no cast`);
    h.spawn('enemy_dummy', { pos: [10, 8] });
    assert.ok(h.runUntil(() => u.skill.active, 3), `T${tier}: cast with an enemy in his range`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: 3-3 while on`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    h.run(200);
    assert.ok(u.skill.active, `T${tier}: 持续时间无限`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: still 3-3`);
    done(h);
  }
});

test('S1 殁亡 execution: an enemy of his range under 90 % / 120 % of his ATK falls at once (9999999 无来源 true damage, uncancellable by dodge/block/miss), then another random enemy of the range takes arts damage equal to the HP it had left; one try only on a survivor; air units too', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    let guard = null;
    const { h, u } = field({ tier, elite, skill: 0, setup: (b) => b.on('fatal', (c) => { if (c.unit === guard) c.prevented = true; }) });
    cast(u);
    const thr = sk.bb['attack@kill_atk_scale'] * u.s.atk;
    assert.equal(sk.bb['attack@kill_damage'], 9999999);
    const big = h.spawn('enemy_dummy', { pos: [11, 8] });   // a 3-3 tile outside the 3-1 (the toggle's range counts)
    const low = h.spawn('enemy_fly', { pos: [10, 7] });
    const hp0 = thr * 0.6;
    low.hp = hp0;
    const high = h.spawn('enemy_dummy', { pos: [9, 6] });
    h.step();
    assert.ok(!low.alive, `T${tier}: the flyer under the threshold fell`);
    const kill = h.hooksOf('damaged').find((c) => c.target === low && (c.dmg?.tags || []).includes('execute'));
    assert.ok(kill && kill.source === null && kill.credit === u && kill.type === 'true' && kill.dmg.sourceless && kill.dmg.ignoreCancelReasons?.join(',') === 'dodge,block,miss', `T${tier}: 无来源 true, credited to him`);
    assert.equal(low.removeReason, 'killed');
    const follow = tagged(h, u, 'logosPerish');
    assert.equal(follow.length, 1, `T${tier}: one follow-up`);
    assert.ok([big, high].includes(follow[0].target) && follow[0].type === 'arts', `T${tier}: on another enemy of his range`);
    // Native logos_s_1 FixedValueDamage explicitly enables source calculation, so T2 marks this new target.
    assert.ok(follow[0].target.findBuff('logos:soulRend'));
    approx(follow[0].amount, hp0 + talentOf(tier, elite, null, 1).atk_addition, `T${tier}: remaining HP plus T2 before RES`);
    assert.ok(![big, high].some((e) => h.hooksOf('damaged').some((c) => c.target === e && (c.dmg?.tags || []).includes('execute'))), `T${tier}: above the threshold: no execution`);
    // an enemy that falls under the threshold while on his range is executed then (the aura checks every tick)
    high.hp = thr * 0.9;
    h.step();
    assert.ok(!high.alive, `T${tier}: executed once under the threshold`);
    // a survivor (不死) is never tried again
    guard = h.spawn('enemy_dummy', { pos: [10, 6] });
    guard.hp = thr * 0.5;
    h.step();
    const tries = () => h.hooksOf('damaged').filter((c) => c.target === guard && (c.dmg?.tags || []).includes('execute')).length;
    assert.equal(tries(), 1, `T${tier}: tried once`);
    assert.ok(guard.alive && guard.hp <= 1 + 1e-9, `T${tier}: held at 1 HP`);
    h.run(3);
    assert.equal(tries(), 1, `T${tier}: never again`);
    done(h);
  }
});

for (const outcome of ['killed', 'survived', 'no-follow-up']) test(`S1 native talent trigger order: ${outcome}`, () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, CCRY]]) {
    let victim;
    const { h, u } = field({ tier, elite, mod, setup: b => {
      if (outcome === 'survived') b.on('fatal', c => { if (c.unit === victim) c.prevented = true; });
    } });
    cast(u);
    victim = h.spawn('enemy_low', { pos: [10, 7] });
    const target = outcome === 'no-follow-up' ? null : h.spawn('enemy_dummy', { pos: [11, 7] });
    const left = victim.hp, hits = [];
    let rolls = 0;
    h.b.rng.chance = () => { rolls++; return true; };
    h.b.rng.pick = list => list[0];
    h.b.on('damageApplied', c => {
      if (c.source === u && c.target === target) hits.push({ tags: c.dmg.tags, amount: c.amount });
    });
    // Let the scheduler refresh spatial/range caches, without an ordinary attack supplying extra talent rolls.
    u.atkCd = 1000;
    h.step();
    const count = talentOf(tier, elite, mod, 0).emit_count ?? 1;
    assert.equal(victim.alive, outcome === 'survived');
    assert.equal(rolls, outcome === 'survived' ? 0 : count, 'roll on successful execution even without another target');
    const follow = tagged(h, u, 'logosPerish');
    assert.equal(follow.length, target ? 1 : 0);
    if (target) {
      const extra = outcome === 'survived' ? 0 : count;
      assert.equal(hits.length, extra + 1);
      for (let i = 0; i < extra; i++) {
        assert.ok(hits[i].tags.includes('logosLexicon'), 'talent executes before the S1 follow-up');
        approx(hits[i].amount, u.s.atk * talentOf(tier, elite, mod, 0).atk_scale, 'precomputed talent does not create a T2 mark');
      }
      assert.ok(hits[extra].tags.includes('logosPerish'));
      approx(hits[extra].amount, left + 165, 'the later source-calculating follow-up applies T2');
    }
    done(h);
  }
});

test('S2 提喻 (MANUAL, data DEFAULT): 20 s, RES +40 / +50; locks one target with a hit every 0.5 s whatever the attack speed, 35 %→105 % / 50 %→150 % of ATK and its speed down to 40 % over 10 hits; a stun breaks the lock', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const b = sk.bb;
    const { h, u } = field({ tier, elite, skill: 1, seed: 7 });
    assert.deepEqual([u.skill.rule, u.skill.kind, sk.duration, b.magic_resistance, b['attack@cooldown'], b['attack@atk_scale_base'], b['attack@atk_scale_delta'], b['attack@move_speed'], b['attack@max_stack_cnt']],
      ['DEFAULT', 'duration', 20, elite ? 50 : 40, 0.5, elite ? 0.5 : 0.35, elite ? 0.1 : 0.07, -0.06, 10], `T${tier}`);
    const e = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.b.addBuff(u, { key: 'test:aspd', mods: { aspd: 300 } });   // the lock ignores the attack speed
    const res0 = u.s.res;
    cast(u);
    approx(u.s.res, res0 + b.magic_resistance, `T${tier}: RES`);
    const n0 = atkHits(h, u).length;
    h.run(6.02);
    const hits = atkHits(h, u).slice(n0);
    assert.ok(hits.length >= 12 && hits.length <= 13, `T${tier}: ${hits.length} hits in 6 s (one per 0.5 s)`);
    for (let i = 1; i < hits.length; i++) approx(hits[i].t - hits[i - 1].t, 0.5, `T${tier}: cadence`, 0.07);
    hits.forEach((c, i) => {
      assert.equal(c.target, e, `T${tier}: the locked target`);
      // + 剜魂具辞's 165 (the first hit marks it already); the target's RES 0
      approx(c.amount, u.s.atk * (b['attack@atk_scale_base'] + b['attack@atk_scale_delta'] * Math.min(10, i)) + 165, `T${tier}: hit ${i}`, 1e-4);
    });
    assert.ok(Math.abs(hits[10].amount - (u.s.atk * b['attack@atk_scale_base'] * 3 + 165)) < 1e-3 * hits[10].amount, `T${tier}: 3× after 5 s`);
    approx(e.findBuff(`logos:lockSlow:${u.id}`).mods.moveMul, 0.4, `T${tier}: 40 % speed`);
    // a stun breaks it: the slow goes, the next hits start over
    h.b.applyStatus(u, 'stun', { duration: 1, source: e });
    h.step();
    assert.equal(e.findBuff(`logos:lockSlow:${u.id}`), null, `T${tier}: slow gone with the lock`);
    const n1 = atkHits(h, u).length;
    h.run(1.6);
    const after = atkHits(h, u).slice(n1);
    approx(after[0].amount, u.s.atk * b['attack@atk_scale_base'] + 165, `T${tier}: reset`, 1e-4);
    // beam: the hit lands as the attack is made (no bolt in flight)
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u);
    assert.ok(Math.abs(atks[atks.length - 1].t - after[after.length - 1].t) < 1e-9, `T${tier}: instant`);
    h.runUntil(() => !u.skill.active, 25);
    approx(u.s.res, res0, `T${tier}: RES back`);
    done(h);
  }
});

test('S2 提喻 keeps its lock while another enemy comes first in the order, and locks anew when its target leaves the field', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  const a = h.spawn('enemy_dummy', { pos: [10, 8] });
  cast(u);
  h.run(1.1);
  assert.ok(atkHits(h, u).every((c) => c.target === a));
  h.spawn('enemy_dummy', { pos: [10, 6], routeIndex: 0 });   // nearer the goal: first in the order
  const n0 = atkHits(h, u).length;
  h.run(1.6);
  assert.ok(atkHits(h, u).slice(n0).every((c) => c.target === a), 'still the locked one');
  h.b.kill(a, null);
  const n1 = atkHits(h, u).length;
  h.run(1.1);
  const next = atkHits(h, u).slice(n1);
  assert.ok(next.length >= 2 && next.every((c) => c.target !== a));
  approx(next[0].amount, u.s.atk * 0.5 + 165, 'a new lock starts at the base scale', 1e-4);
  done(h);
});

test('S3 延异视阈 (MANUAL, data ACTIVE_RANGE on its 3-4): cast with an enemy on the 3-4 only, 30 s, ATK +160 % / +220 %, 3 targets at once', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u } = field({ tier, elite, skill: 2 });
    assert.deepEqual([u.skill.rule, sk.rangeId, sk.duration, sk.bb.atk, sk.bb['attack@max_target'], sk.bb.projectile_move_scale], ['ACTIVE_RANGE', '3-4', 30, elite ? 2.2 : 1.6, 3, 0.05], `T${tier}`);
    assert.deepEqual(u.skill.triggerGrid, sk.rangeGrid, `T${tier}: the trigger grid is the 3-4`);
    u.skill.gainSp(999);
    h.run(1);
    assert.equal(u.skill.activations, 0, `T${tier}: no enemy`);
    const far = h.spawn('enemy_dummy', { pos: [12, 6] });   // dRow +2: the 3-4 only
    assert.ok(h.runUntil(() => u.skill.active, 1), `T${tier}: cast for an enemy outside his own range`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: 3-4 while on`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    const more = [h.spawn('enemy_dummy', { pos: [10, 6] }), h.spawn('enemy_fly', { pos: [9, 7] }), h.spawn('enemy_dummy', { pos: [11, 8] })];
    const a0 = h.hooksOf('attack').filter((c) => c.attacker === u).length;
    h.run(5);
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u).slice(a0);
    assert.ok(atks.length >= 2 && atks.every((c) => c.targets.length === 3), `T${tier}: 3 targets per attack`);
    assert.ok(atks.every((c) => c.targets.every((e) => [far, ...more].includes(e))));
    h.runUntil(() => !u.skill.active, 40);
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `T${tier}: back to 3-1`);
    done(h);
  }
});

test('S3 distinguishes projectile speed-change and removal eligibility', () => {
  const { h, u } = field({ skill: 2 });
  const e = h.spawn('enemy_dummy', { pos: [12, 9] });
  cast(u);
  const make = opts => h.b.addProjectile({ from: { x: 6, y: 10 }, to: { x: 7, y: 10 }, source: e, speed: 1, ...opts });
  const invisible = make({ visual: 'none' });
  const slowOnly = make({ speedChangeable: true, removable: false });
  const clearOnly = make({ speedChangeable: false, removable: true });
  h.run(0.1);
  assert.equal(invisible.speed, 1);
  assert.equal(slowOnly.speed, 0.05);
  assert.equal(clearOnly.speed, 1);
  u.skill.end('test');
  assert.ok(h.b.projectiles.list.includes(invisible));
  assert.ok(h.b.projectiles.list.includes(slowOnly));
  assert.equal(slowOnly.speed, 1, 'release a slowed but non-removable projectile');
  assert.ok(!h.b.projectiles.list.includes(clearOnly));
  done(h);
});

test('S3 延异视阈: enemy shots on his range fly at 5 % of their speed (back once they leave it) and are cleared when the skill ends — not when he is disarmed then', () => {
  for (const disarm of [false, true]) {
    const { h, u } = field({ tier: 6, elite: true, skill: 2 });
    h.spawn('enemy_gun', { pos: [10, 7] });
    h.run(1.5);
    cast(u);
    h.run(0.2);
    h.run(3);
    const shots = h.b.projectiles.list.filter((p) => p.source && p.source.side === 'enemy');
    assert.ok(shots.length >= 2, `${shots.length} enemy shots held`);
    for (const p of shots) approx(p.speed, 10 * 0.05, 'slowed to 0.05×');
    if (disarm) h.b.applyStatus(u, 'disarm', { duration: 40, source: null });
    h.runUntil(() => u.skill.timeLeft < 0.5, 40);
    for (const g of h.enemies()) h.b.applyStatus(g, 'stun', { duration: 99, source: null });   // no new shot
    const held = h.b.projectiles.list.filter((p) => p.source && p.source.side === 'enemy').length;
    assert.ok(held >= 1, `${held} shots in the air as it ends`);
    h.runUntil(() => !u.skill.active, 2);
    h.step();
    // (until the end a held shot still reaches him at its 5 % speed — one a second from the gun 2 tiles away)
    const taken = u.stats.taken;
    const left = h.b.projectiles.list.filter((p) => p.source && p.source.side === 'enemy');
    if (!disarm) {
      assert.equal(left.length, 0, 'cleared');
      h.run(5);
      assert.equal(u.stats.taken, taken, 'none of the held shots hit him');
    } else {
      assert.ok(left.length > 0 && left.every((p) => Math.abs(p.speed - 10) < 1e-9), 'disarmed: kept, at full speed again');
    }
    done(h);
  }
});

test('S3 延异视阈 slows a self-destructing 枯朽之种 as a bullet, which 逻各斯 cannot attack', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  cast(u);
  const seed = h.spawn('enemy_1269_nhfly', { pos: [10, 7], routeIndex: 2 });
  h.step();
  const shot = h.b.projectiles.list.find((p) => p.source === seed);
  assert.ok(shot, 'the seed has become a projectile');
  const attacksAtLaunch = h.hooksOf('attack').length; // Logos may attack before the seed's end-of-frame launch
  const dummyTarget = h.spawn('enemy_dummy', { pos: [10, 8], routeIndex: 2 });
  h.step(); // the seed's tick hook launches after the skill tick; Logos slows it on the next frame
  approx(shot.speed, 10 * 0.05, 'Logos S3 slows the seed');
  h.run(2);
  const attacks = h.hooksOf('attack').slice(attacksAtLaunch).filter((c) => c.attacker === u);
  assert.ok(attacks.length > 0 && attacks.some((c) => c.targets.includes(dummyTarget)), 'Logos keeps attacking another enemy');
  assert.ok(attacks.every((c) => !c.targets.includes(seed)), 'Logos never selects the flying seed');
  assert.equal(seed.stats.taken, 0, 'Logos does not hit the self-destructing seed');
  assert.ok(seed.alive && u.stats.taken === 0, 'the slowed seed remains in flight');
  u.skill.end('test');
  assert.ok(!h.b.projectiles.list.includes(shot), 'S3 clears the seed projectile');
  h.step();
  assert.ok(!seed.alive, 'the cleared seed model leaves the field');
  done(h);
});

test('T1 语汇演化: 40 % per attacked target for an extra 65 % ATK arts hit on a random enemy of his range + 停顿 0.8 s; CCR-Δ stage 3: 60 % and 60 % ATK 元素伤害 on a target in its 凋亡 burst; CCR-Y stage 3: two executions at 70 %', () => {
  for (const f of [[5, false, null], [5, true, CCRD], [6, true, CCRD], [6, true, CCRY]]) {
    const [tier, elite, mod] = f;
    const t = talentOf(tier, elite, mod, 0);
    const { h, u } = field({ tier, elite, mod, skill: 0, seed: 21 });
    h.b.addBuff(u, { key: 'test:aspd', mods: { aspd: 500 } });
    const es = [h.spawn('enemy_dummy', { pos: [10, 7] }), h.spawn('enemy_fly', { pos: [11, 6] })];
    h.run(50);
    const attacks = h.hooksOf('attack').filter((c) => c.attacker === u).reduce((n, c) => n + c.targets.length, 0);
    const extra = tagged(h, u, 'logosLexicon').filter((c) => c.type === 'arts');
    const emit = t.emit_count ?? 1;
    const ratio = extra.length / (attacks * emit);
    assert.ok(attacks > 150 && Math.abs(ratio - t.prob) < 0.08, `${label(f)}: ${extra.length} / ${attacks}×${emit} ≈ ${t.prob}`);
    for (const c of extra.slice(0, 6)) {
      assert.ok(es.includes(c.target), `${label(f)}: an enemy of his range (air too)`);
      const marked = h.hooksOf('damaged').some((d) => d.source === u && d.target === c.target && d.dmg?.isAttack && d.t <= c.t && c.t - d.t <= 5);
      approx(c.amount, u.s.atk * t.atk_scale + (marked ? 165 : 0), `${label(f)}: ${t.atk_scale * 100} % ATK (+ 剜魂具辞 on a marked one)`, 1e-4);
    }
    const slug = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'sluggish');
    assert.ok(slug.length >= extra.length * 0.95 && slug.every((c) => Math.abs(c.duration - t.sluggish) < 1e-9), `${label(f)}: 停顿 ${t.sluggish} s`);
    const elem = tagged(h, u, 'logosLexicon').filter((c) => c.type === 'elemental');
    if (t.element_atk_scale) {
      assert.ok(elem.length > 0, `${label(f)}: 元素伤害 during the 凋亡 bursts (his own CCR-Δ fills them)`);
      for (const c of elem) {
        approx(c.amount, u.s.atk * t.element_atk_scale, `${label(f)}: ${t.element_atk_scale * 100} % ATK 元素伤害`, 1e-4);
        assert.ok(h.hooksOf('elementBurst').some((b) => b.target === c.target && b.element === 'apoptosis' && b.t <= c.t && c.t - b.t < 15), 'in its 凋亡 burst');
      }
    } else assert.equal(elem.length, 0, `${label(f)}: no 元素伤害`);
    done(h);
  }
  // the module texts
  assert.match(modOf(6, CCRD).talentChanges.find((t) => t.talentIndex === 0).desc, /60%几率.*凋亡损伤爆发期间则同时造成相当于攻击力60%的元素伤害/);
  assert.match(modOf(6, CCRY).talentChanges.find((t) => t.talentIndex === 0).desc, /两个随机目标造成相当于攻击力70%/);
  assert.equal(modOf(5, CCRD).talentChanges.find((t) => t.talentIndex === 0), undefined, 'stage 1: the talent unchanged');
});

test('T1 语汇演化 also follows 殁亡\'s follow-up hit (备注 "可触发第一天赋") and works while he is disarmed', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0, seed: 3 });
  cast(u);
  h.b.applyStatus(u, 'disarm', { duration: 999, source: null });
  const thr = 1.2 * u.s.atk;
  let rolls = 0;
  for (let i = 0; i < 40; i++) {
    h.spawn('enemy_dummy', { pos: [9, 7] });
    const low = h.spawn('enemy_dummy', { pos: [10, 7] });
    low.hp = thr * 0.5;
    h.step();
    rolls++;
    for (const e of h.enemies()) h.b.kill(e, null);
    h.step();
  }
  assert.equal(atkHits(h, u).length, 0, 'disarmed: no attack');
  assert.equal(tagged(h, u, 'logosPerish').length, rolls);
  const extra = tagged(h, u, 'logosLexicon');
  assert.ok(extra.length > rolls * 0.2 && extra.length < rolls * 0.6, `${extra.length} / ${rolls} ≈ 40 %`);
  done(h);
});

test('T2 剜魂具辞: each of his attack hits gives the target RES −10 and +165 on every arts damage it takes for 5 s — the hit itself included, other casters\' arts too; one instance per enemy', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, CCRY]]) {
    const t = talentOf(tier, elite, mod, 1);
    assert.deepEqual(t, { duration: 5, magic_resistance: -10, atk_addition: 165 });
    const { h, u } = field({ tier, elite, mod, skill: 0, seed: 9 });
    const e = h.spawn('enemy_dummy', { pos: [10, 7] });
    e.base.res = 30; e.markDirty();
    const first = () => atkHits(h, u)[0];
    assert.ok(h.runUntil(() => !!first(), 4));
    const c = first();
    approx(c.amount, (u.s.atk + 165) * (1 - 0.2), `T${tier}: (ATK + 165) × (1 − (30 − 10) %) on the very hit`, 1e-4);
    const mark = e.findBuff('logos:soulRend');
    assert.ok(mark && Math.abs(mark.mods.resFlat + 10) < 1e-9 && mark.data.value === 165);
    approx(e.s.res, 20, `T${tier}: RES −10`);
    // another source's arts damage gets the 165 too; physical does not
    approx(h.b.dealDamage(null, e, { amount: 1000, type: 'arts', canDodge: false }), (1000 + 165) * 0.8, 'arts +165');
    approx(h.b.dealDamage(null, e, { amount: 1000, type: 'phys', canDodge: false }), 1000, 'phys unchanged');
    // it lapses 5 s after his last hit
    h.b.applyStatus(u, 'stun', { duration: 20, source: null });
    h.run(5.2);
    assert.equal(e.findBuff('logos:soulRend'), null, `T${tier}: gone after 5 s`);
    approx(e.s.res, 30, `T${tier}: RES back`);
    done(h);
  }
});

test('CCR-Δ “来自河谷的笔盒” (stages 1 and 3): 8 % of every arts damage he deals as 凋亡 损伤; none without it', () => {
  for (const f of [[5, false, null], [5, true, null], [5, true, CCRD], [6, true, CCRD], [6, true, CCRY]]) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 0, seed: 4 });
    const e = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.run(4);
    const arts = h.hooksOf('damaged').filter((c) => c.source === u && c.target === e && c.type === 'arts');
    const fills = h.hooksOf('damaged').filter((c) => c.source === u && c.target === e && c.type === 'element');
    assert.ok(arts.length > 0);
    if (elite && mod === CCRD) {
      assert.equal(u.def.raw.talents.find((t) => t.index === -1).bb.ep_damage_ratio, 0.08);
      assert.equal(fills.length, arts.length, `${label(f)}: one fill per arts hit`);
      fills.forEach((c, i) => {
        assert.equal(c.dmg.element, 'apoptosis');
        approx(c.amount, arts[i].amount * 0.08, `${label(f)}: 8 %`);
      });
    } else assert.equal(fills.length, 0, `${label(f)}: no 凋亡`);
    done(h);
  }
});

test('CCR-Y “《语义范式百科》” (stages 1 and 3): +1 SP per normal-attack hit on an elite or leader enemy (none on a normal one, none while a skill runs); none without it', () => {
  for (const f of [[5, true, CCRY], [6, true, CCRY], [6, true, CCRD], [6, false, null]]) {
    const [tier, elite, mod] = f;
    const y = elite && mod === CCRY;
    if (y) assert.deepEqual(modOf(tier, CCRY).traitOverride.bb, { sp: 1 });
    for (const key of ['enemy_dummy', 'enemy_elite', 'enemy_boss']) {
      const { h, u } = field({ tier, elite, mod, skill: 0, seed: 2 });
      const e = h.spawn(key, { pos: [10, 7] });
      h.b.applyStatus(u, 'disarm', { duration: 3, source: null });
      h.run(3.1);
      const sp0 = u.skill.sp, t0 = h.b.time;
      h.run(5);
      const hits = [...atkHits(h, u), ...tagged(h, u, 'logosLexicon')].filter((c) => c.target === e && c.t >= t0 - 1e-9).length;
      const gain = u.skill.sp - sp0 - 5;   // 5 s of natural SP
      const want = y && key !== 'enemy_dummy' ? hits : 0;
      approx(gain, want, `${label(f)} ${key}: ${hits} hits`, 1e-6);
      done(h);
    }
  }
});


for (const mode of ['loss', 'gauge', 'sourceLess', 'dodge', 'shield', 'partial', 'overkill', 'hitCount']) {
  test(`Logos CCR-Δ successful arts rider: ${mode}`, () => {
    const { h, u } = field({ tier: 6, elite: true, mod: CCRD });
    const b = h.b, e = h.spawn('enemy_elite', { pos: [10, 7] });
    u.atkCd = 999;
    if (mode === 'dodge') b.addBuff(e, { key: 'defense', injury(c) { c.dodge(); } });
    if (mode === 'shield') b.addBuff(e, { key: 'defense', shieldHits: 1 });
    if (mode === 'partial') b.addBuff(e, { key: 'defense', shield: 40 });
    if (mode === 'hitCount') b.addBuff(e, { key: 'defense', flags: { hitCount: true } });
    if (mode === 'overkill') e.hp = 10;
    const fills = [];
    b.on('elementApplied', c => { if (c.source === u && c.target === e && c.dmg.tags?.includes('logosCcrd')) fills.push(c); });
    let removed;
    if (mode === 'loss') removed = b.dealHPLose({ source: u, target: e, amount: 100, type: 'arts' });
    else if (mode === 'gauge') b.dealElementDamage({ source: u, target: e, amount: 10, element: 'burn' });
    else removed = b.dealDamage({ source: mode === 'sourceLess' ? null : u, credit: u, target: e,
      amount: 100, type: 'arts', calculation: 'resolved', attackType: 'BUFF', isAttack: false });
    // Gauge riders retain the existing hasHp policy: no gauge fill on a killing blow.
    const success = ['partial', 'hitCount'].includes(mode);
    assert.equal(fills.length, success ? 1 : 0);
    if (success) approx(fills[0].amount, (mode === 'partial' ? 60 : 100) * 0.08, 'damage basis');
    if (mode === 'overkill') assert.equal(removed, 10);
    if (mode === 'hitCount') assert.equal(removed, 1);
    done(h);
  });
}

for (const mode of ['attack', 'lexicon', 'skill', 'loss', 'originLoss', 'legacyLoss', 'sourceLess', 'zero', 'shield', 'cancelled']) {
  test(`Logos CCR-Y trigger boundary (zero/full-shield compatibility remains ASSUMED): ${mode}`, () => {
    const { h, u } = field({ tier: 6, elite: true, mod: CCRY, skill: 0 });
    const b = h.b, e = h.spawn('enemy_elite', { pos: [10, 7] });
    u.atkCd = 999;
    if (mode === 'shield') b.addBuff(e, { key: 'defense', shieldHits: 1 });
    if (mode === 'cancelled') b.addBuff(e, { key: 'defense', injury(c) { c.dodge(); } });
    const before = u.skill.sp;
    if (mode === 'loss') b.dealHPLose({ source: u, target: e, amount: 100, type: 'arts' });
    else if (mode === 'originLoss') b.dealHPLose({ source: u, target: e, amount: 100, type: 'arts', origin: { tags: ['logosLexicon'] } });
    else if (mode === 'legacyLoss') b.dealHPLose(e, 100, { source: u, from: { tags: ['logosLexicon'] } });
    else b.dealDamage({ source: mode === 'sourceLess' ? null : u, credit: u, target: e,
      amount: mode === 'zero' ? 0 : 100, type: 'arts', calculation: 'resolved',
      isAttack: !['lexicon', 'skill'].includes(mode), tags: mode === 'lexicon' ? ['logosLexicon'] : [] });
    const eligible = ['attack', 'lexicon', 'zero', 'shield'].includes(mode);
    assert.equal(u.skill.sp - before, eligible ? 1 : 0);
    done(h);
  });
}
