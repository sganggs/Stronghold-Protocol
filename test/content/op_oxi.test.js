// test/content/op_oxi.test.js — the 自选 operator kit of 塔露拉 (char_4247_oxi, 6★ 本源近卫; kit
// server/sim/content/kits/ops/op-oxi.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4) and elite (E2 Lv60, rank 7; she has no module). Every number is
// read back from data/backups.json (the form of that slot status, at the potential asked for); the fidelity checklist
// of kits/README.md item by item.
// Run: node --test test/content/op_oxi.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { holdProtect } from '../../server/sim/content/kits/shared/tier1.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { atPotential } from '../../shared/potential.js';
import { COLS } from '../../server/sim/constants.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const OXI = 'char_4247_oxi';
const FORMS = BACKUPS.units[OXI].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const SKILLS = ['skchr_oxi_1', 'skchr_oxi_2', 'skchr_oxi_3'];
/** Every 自选 form: [tier, elite] (no module exists). */
const FORMS_ALL = [[5, false], [6, false], [5, true], [6, true]];
/** The unit form of a slot (tier, normal / elite) at a potential (default: full, the data's own). */
const formOf = (tier, elite, potential = 6) => atPotential(FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'], potential);
const skillOf = (tier, elite, i) => formOf(tier, elite).skills[i];
const talentOf = (tier, elite, i, potential = 6) => formOf(tier, elite, potential).talents[i].bb;
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, atk: 0, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }), enemy_res: dummy('enemy_res', { res: 50 }),
  enemy_walk: dummy('enemy_walk', { speed: 1 }),
};
const label = ([tier, elite]) => `T${tier} ${elite ? 'elite' : 'normal'}`;

/** A battle with 塔露拉 as uid 1 at (row, col), plus `others`. */
function field({ tier = 6, elite = true, skill = 0, potential = null, row = 10, col = 5, dir = 'RIGHT', others = [], seed = 7 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    hooks: ['damaged', 'attack', 'skillStart', 'skillEnd', 'statusApplied', 'heal'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: OXI, skillIndex: skill }, elite, ...(potential ? { potential } : null), row, col, dir }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
/** Run `fn` inside the next tick, after its buff pass (where an enemy's strike lands); returns what it returned. */
function inTick(h, fn) {
  let out, ran = false;
  h.b.on('tick', () => { if (!ran) { ran = true; out = fn(); } }, { once: true });
  h.step();
  return out;
}
const tagged = (h, tag) => h.hooksOf('damaged').filter((c) => c.dmg?.tags?.includes(tag));
const rageOf = (u) => u.mem.oxiRage?.n ?? 0;

test('塔露拉 in every 自选 form: her operator kit (all three skills authored), the form\'s stats, 1-1, blocks 2, melee ground-only arts, the triggers and SP of the data', () => {
  assert.equal(OPERATOR_KITS[OXI], KITS[OXI]);
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, skill });
      const form = formOf(tier, elite), sk = form.skills[skill];
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [OXI, SLOT[tier], SKILLS[skill], false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res], [form.stats.maxHp, form.stats.atk, form.stats.def, form.stats.res], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.base.bat], [2, 'melee', false, 'arts', form.stats.bat], `${label(f)}: 本源近卫, 绝不妥协`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      // S1 / S3: the data's DEFAULT; S2: never by the strategy (the prefab's NeverTrigger — its guard casts it)
      assert.equal(u.skill.rule, skill === 1 ? 'NEVER' : 'DEFAULT', `${label(f)}: trigger`);
      assert.equal(sk.trigger.rule, 'DEFAULT', 'the data rule');
      assert.deepEqual([u.skill.spCost, u.skill.maxCharges, u.skill.initSp], [sk.spCost, sk.maxChargeTime, sk.initSp], `${label(f)}: SP`);
      assert.equal(u.skill.kind, ['instant', 'charges', 'duration'][skill], `${label(f)}: kind`);
      done(h);
    }
  }
  // the numbers (zh_CN, full potential): E2 Lv1 2415 / 778 / 361, E2 Lv60 2743 / 866 / 403; S2 5 charges, S3 36 s
  assert.deepEqual([FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.atk, skillOf(6, true, 1).maxChargeTime, skillOf(6, true, 2).duration], [778, 866, 5, 36]);
});

test('a 自选 pick: 塔露拉 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(OXI));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(OXI), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: OXI, skillIndex: 2, uniEquipId: null } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: OXI, skillIndex: 2, uniEquipId: null } } });
});

test('绝不妥协: every arts damage instance of hers that lands carries ep_damage_ratio × that damage as 灼燃损伤 (potential 6 and 4); no 灼燃 from 元素伤害 or an element fill', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    for (const potential of [6, 4]) {
      const ep = talentOf(tier, elite, 0, potential).ep_damage_ratio;
      assert.equal(ep, potential === 6 ? 0.13 : 0.11, `${label(f)} P${potential}: the data`);
      const { h, u } = field({ tier, elite, skill: 1, potential });
      const e = h.spawn('enemy_dummy', { pos: [10, 7] }), r = h.spawn('enemy_res', { pos: [11, 7] });
      approx(h.b.dealDamage(u, e, { amount: 1000, type: 'arts' }), 1000, `${label(f)} P${potential}: no 怒火 yet`);
      approx(e.elem.burn, 1000 * ep, `${label(f)} P${potential}: 灼燃 = ${ep} × the damage`);
      approx(h.b.dealDamage(u, r, { amount: 1000, type: 'arts' }), 500, `${label(f)}: RES 50`);
      approx(r.elem.burn, 500 * ep, `${label(f)} P${potential}: from the damage dealt, after RES`);
      h.b.dealDamage(u, e, { amount: 1000, type: 'elemental', element: 'burn' });
      h.b.dealDamage(u, e, { amount: 100, type: 'element', element: 'burn' });
      approx(e.elem.burn, 1000 * ep + 100, `${label(f)}: 元素伤害 adds none, a fill only itself`);
      h.b.dealDamage(u, e, { amount: 1000, type: 'phys' });
      approx(e.elem.burn, 1000 * ep + 100, `${label(f)}: physical damage carries none`);
      done(h);
    }
  }
});

test('【怒火】: none for arcane_idle_delay s after deployment, then +1 every arcane_step_interval s up to arcane_max / arcane_step; her arts and 元素伤害 ×(1 + arcane_step × layers); an element fill is not raised', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    for (const potential of [6, 4]) {
      const t = talentOf(tier, elite, 0, potential), max = Math.round(t.arcane_max / t.arcane_step);
      assert.deepEqual([t.arcane_idle_delay, t.arcane_step_interval, max], [3, 0.5, 6], `${label(f)} P${potential}: the data`);
      const { h, u } = field({ tier, elite, skill: 1, potential });
      const seen = [];
      h.b.on('tick', () => seen.push([h.b.time, rageOf(u)]));
      h.run(7);
      for (const [time, n] of seen) {
        const want = time < t.arcane_idle_delay - 1e-9 ? 0 : Math.min(max, Math.floor((time - t.arcane_idle_delay) / t.arcane_step_interval + 1e-9) + 1);
        assert.equal(n, want, `${label(f)} P${potential}: ${n} layers at ${time.toFixed(3)} s`);
      }
      const e = h.spawn('enemy_dummy', { pos: [11, 8] });
      approx(h.b.dealDamage(u, e, { amount: 1000, type: 'arts' }), 1000 * (1 + t.arcane_step * max), `${label(f)} P${potential}: arts`);
      approx(h.b.dealDamage(u, e, { amount: 1000, type: 'elemental', element: 'burn' }), 1000 * (1 + t.arcane_step * max), `${label(f)}: 元素伤害`);
      approx(h.b.dealDamage(u, e, { amount: 1000, type: 'phys' }), 1000, `${label(f)}: physical damage is not raised`);
      const before = e.elem.burn;
      h.b.dealDamage(u, e, { amount: 100, type: 'element', element: 'burn' });
      approx(e.elem.burn - before, 100, `${label(f)}: the fill itself is not raised`);
      done(h);
    }
  }
});

test('【怒火】: each normal attack takes one layer and stops the gain for arcane_idle_delay s; S1\'s skill attack takes none', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const t = talentOf(tier, elite, 0);
    // a normal attack (S2 never casts without a hit): 6 layers → 5, and the next layer only once the marker ran out
    {
      const { h, u } = field({ tier, elite, skill: 1 });
      h.run(6);
      assert.equal(rageOf(u), 6, label(f));
      const e = h.spawn('enemy_dummy', { pos: [10, 6] });
      assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 3), `${label(f)}: she attacks`);
      const at = h.hooksOf('attack').find((c) => c.attacker === u).t;
      const hit = h.hooksOf('damaged').find((c) => c.source === u && c.dmg?.isAttack);
      approx(hit.amount, u.s.atk * (1 + t.arcane_step * 6), `${label(f)}: the attack carries the 6 layers it found`);
      assert.equal(rageOf(u), 5, `${label(f)}: one layer taken`);
      h.b.kill(e, null);
      const seen = [];
      h.b.on('tick', () => seen.push([h.b.time, rageOf(u)]));
      h.run(4);
      const first = seen.find(([, n]) => n === 6);
      assert.ok(first, `${label(f)}: the gain resumes`);
      assert.ok(first[0] >= at + t.arcane_idle_delay - 1e-9 && first[0] < at + t.arcane_idle_delay + t.arcane_step_interval, `${label(f)}: ${first[0]} vs ${at} + 3`);
      assert.ok(seen.filter(([time]) => time < at + t.arcane_idle_delay - 1e-9).every(([, n]) => n === 5), `${label(f)}: nothing for 3 s`);
      done(h);
    }
    // S1: the cast replaces an attack — that skill attack takes no layer, the next normal one does
    {
      const { h, u } = field({ tier, elite, skill: 0 });
      h.run(8.5);
      assert.deepEqual([rageOf(u), u.skill.ready], [6, true], `${label(f)}: S1 ready at 6 layers`);
      h.spawn('enemy_dummy', { pos: [10, 6] });
      assert.ok(h.runUntil(() => u.skill.activations === 1, 3), `${label(f)}: S1 cast`);
      h.step();
      assert.equal(rageOf(u), 6, `${label(f)}: no layer for the skill attack`);
      assert.ok(h.runUntil(() => h.hooksOf('attack').filter((c) => c.attacker === u).length === 2, 3), `${label(f)}: a normal attack`);
      assert.deepEqual(h.hooksOf('attack').filter((c) => c.attacker === u).map((c) => c.isSkill), [true, false]);
      assert.equal(rageOf(u), 5, `${label(f)}: the normal attack takes one`);
      done(h);
    }
  }
});

test('我即火焰: an enemy\'s 灼燃 burst while she is on the field leaves her footprints for 5 s on the tiles it stands on; each lasts field_duration s from its last refresh; ground enemies on them take field_atk_scale × ATK arts every field_interval s, flyers none (potential 6 and 2)', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    for (const potential of [6, 2]) {
      const t1 = talentOf(tier, elite, 1, potential);
      assert.deepEqual([t1.field_duration, t1.field_atk_scale, t1.field_interval, t1.max_count], potential === 6 ? [4, 0.15, 0.3, 25] : [3, 0.12, 0.3, 25], `${label(f)} P${potential}: the data`);
      const { h, u } = field({ tier, elite, skill: 1, potential, row: 12, col: 3 });
      const bursting = h.spawn('enemy_dummy', { pos: [10, 7] });
      const standing = h.spawn('enemy_dummy', { pos: [10, 7.2] });   // the same tile
      const fly = h.spawn('enemy_fly', { pos: [10, 6.8] });
      const elsewhere = h.spawn('enemy_dummy', { pos: [10, 8] });
      const key = 10 * COLS + 7;
      const t0 = h.b.time;
      h.b.dealDamage(u, bursting, { amount: 5000, type: 'element', element: 'burn' });
      assert.ok(bursting.findBuff('burnBurst'), 'the burst');
      assert.deepEqual([...u.mem.oxiField.tiles.keys()], [key], `${label(f)}: its tile at once`);
      h.run(12);
      const hits = tagged(h, 'oxi:footprint');
      const on = (e) => hits.filter((c) => c.target === e);
      assert.ok(on(standing).length > 10 && on(bursting).length > 10, `${label(f)}: the enemies on it`);
      assert.deepEqual([on(fly).length, on(elsewhere).length], [0, 0], `${label(f)}: no flyer, nobody on another tile`);
      // every field_interval s, the first one interval after the footprint reached it; field_atk_scale × ATK before 【怒火】
      const times = on(standing).map((c) => c.t);
      approx(times[0] - t0, t1.field_interval, `${label(f)}: the first one interval after it reached the footprint`, 1e-6);
      for (let i = 1; i < times.length; i++) approx(times[i] - times[i - 1], t1.field_interval, `${label(f)}: every ${t1.field_interval} s`, 1e-6);
      for (const c of on(standing).filter((c) => c.t < talentOf(tier, elite, 0).arcane_idle_delay - 1e-9)) {
        approx(c.amount, u.s.atk * t1.field_atk_scale, `${label(f)} P${potential}: ${t1.field_atk_scale} × ATK`);
        assert.deepEqual([c.type, c.dmg.attackType, c.dmg.isAttack], ['arts', 'BUFF', false], '持续伤害');
      }
      // the stationary trail refreshed it until 5 s after the burst (its last tick at 4.8 s): it ends field_duration s later
      const last = times[times.length - 1] - t0;
      assert.ok(last > 4.8 + t1.field_duration - t1.field_interval - 1e-6 && last <= 4.8 + t1.field_duration + 1e-6, `${label(f)} P${potential}: the last tick ${last}`);
      assert.equal(u.mem.oxiField.tiles.size, 0, `${label(f)}: gone`);
      // the footprint arts damage carries 绝不妥协's 灼燃 to the one not bursting
      assert.ok(standing.elem.burn > 0 || standing.findBuff('burnBurst'), `${label(f)}: 灼燃 from the footprints`);
      done(h);
    }
  }
});

test('我即火焰: a walking enemy marks the tiles it walks over during the 5 s after its burst; at most max_count footprints (no new one when full); none once she left the field', () => {
  const { h, u } = field({ skill: 1, row: 12, col: 3 });
  const dur = talentOf(6, true, 1).field_duration;
  const w = h.spawn('enemy_walk', { routeIndex: 0 });
  h.run(0.5);
  const t0 = h.b.time, tileOfW = () => Math.round(w.y) * COLS + Math.round(w.x);
  const lastOn = new Map([[tileOfW(), t0]]), marked = new Set();
  h.b.on('tick', () => {
    if (h.b.time < t0 + 5 - 1e-9) lastOn.set(tileOfW(), h.b.time);
    for (const k of u.mem.oxiField?.tiles.keys() ?? []) marked.add(k);
  });
  h.b.dealDamage(u, w, { amount: 5000, type: 'element', element: 'burn' });
  h.run(5.2);
  assert.ok(lastOn.size >= 3, `it walked over ${lastOn.size} tiles`);
  assert.deepEqual([...marked].sort((a, b) => a - b), [...lastOn.keys()].sort((a, b) => a - b), 'exactly the tiles it stood on');
  // each lasts field_duration s from its last refresh (on entering it, then every field_interval s while it stands there)
  for (const [k, until] of u.mem.oxiField.tiles) {
    assert.ok(until - dur <= lastOn.get(k) + 1e-9 && until - dur > lastOn.get(k) - talentOf(6, true, 1).field_interval - 1e-9, `tile ${k}: ${until} vs ${lastOn.get(k)}`);
  }
  h.run(dur);
  assert.equal(u.mem.oxiField.tiles.size, 0, 'all gone field_duration s after the trail');
  done(h);

  // the cap: 26 bursts on 26 tiles → 25 footprints
  const c = field({ skill: 1, row: 12, col: 2 });
  const cap = talentOf(6, true, 1).max_count;
  let n = 0;
  for (let r = 9; r <= 12 && n < cap + 1; r++) for (let col = 3; col <= 9 && n < cap + 1; col++, n++) {
    c.h.b.dealDamage(c.u, c.h.spawn('enemy_dummy', { pos: [r, col] }), { amount: 5000, type: 'element', element: 'burn' });
  }
  assert.equal(c.u.mem.oxiField.tiles.size, cap, `max_count ${cap}`);
  assert.ok(!c.u.mem.oxiField.tiles.has(12 * COLS + 7), 'the 26th tile is refused');
  // she leaves: her footprints go with her, and a burst while she is away leaves none
  c.h.b.retreat(c.u);
  c.h.step();
  assert.equal(c.u.mem.oxiField.tiles.size, 0, 'cleared');
  const late = c.h.spawn('enemy_dummy', { pos: [11, 9.3] });
  c.h.b.dealDamage(null, late, { amount: 5000, type: 'element', element: 'burn' });
  c.h.run(1);
  assert.equal(c.u.mem.oxiField.tiles.size, 0, 'none while she is off the field');
  done(c.h);
});

test('我即火焰: a revive inside the knock-out\'s `death` hooks (命结之秘 / M3茧甲 priority) starts her new deployment without the old footprints and trails', () => {
  const { h, u } = field({ skill: 1 });
  const e = h.spawn('enemy_dummy', { pos: [10, 7] });
  h.b.dealDamage(u, e, { amount: 5000, type: 'element', element: 'burn' });
  assert.deepEqual([u.mem.oxiField.tiles.size, u.mem.oxiField.trails.size], [1, 1], 'a footprint and a trail');
  h.b.on('death', (c) => { if (c.unit === u && c.reason === 'killed') h.b.redeploy(u, { free: true }); }, { priority: 12 });
  h.b.dealDamage({ source: null, target: u, amount: 1e7, type: 'true' });
  assert.ok(u.alive && u.deployed, 'revived at once');
  assert.deepEqual([u.mem.oxiField.tiles.size, u.mem.oxiField.trails.size, u.mem.oxiField.burning.size], [0, 0, 0], 'cleared by the deployment');
  h.run(0.5);
  assert.equal(tagged(h, 'oxi:footprint').length, 0, 'no footprint damage');
  const later = h.spawn('enemy_dummy', { pos: [11, 8] });
  h.b.dealDamage(u, later, { amount: 5000, type: 'element', element: 'burn' });
  assert.deepEqual([...u.mem.oxiField.tiles.keys()], [11 * COLS + 8], 'a new burst marks again');
  done(h);
});

test('S1 照霎白夜 (AUTO, DEFAULT): her next attack hits every ground enemy on its target\'s tile for atk_scale × ATK arts with `fear` s 恐惧; flyers and other tiles untouched', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const sk = skillOf(tier, elite, 0);
    assert.deepEqual([sk.skillType, sk.spCost, sk.initSp, sk.bb.atk_scale, sk.bb.fear], ['AUTO', 8, 0, elite ? 4.9 : 4, elite ? 2.5 : 2], label(f));
    const { h, u } = field({ tier, elite, skill: 0 });
    u.skill.gainSp(999);
    const main = h.spawn('enemy_dummy', { pos: [10, 6] }), mate = h.spawn('enemy_dummy', { pos: [10, 6.3] });
    const fly = h.spawn('enemy_fly', { pos: [10, 5.8] }), next = h.spawn('enemy_dummy', { pos: [10, 7] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 2), `${label(f)}: cast on her attack`);
    const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
    assert.deepEqual(hits.map((c) => c.target.id).sort(), [main.id, mate.id].sort(), `${label(f)}: the ground enemies of that tile`);
    for (const c of hits) {
      approx(c.amount, u.s.atk * sk.bb.atk_scale, `${label(f)}: ${sk.bb.atk_scale * 100} % ATK`);
      assert.deepEqual([c.type, c.dmg.isSkill], ['arts', true]);
    }
    const fears = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'fear');
    assert.deepEqual(fears.map((c) => c.target.id).sort(), [main.id, mate.id].sort(), `${label(f)}: 恐惧`);
    for (const c of fears) approx(c.duration, sk.bb.fear, `${label(f)}: ${sk.bb.fear} s`);
    assert.ok(![fly, next].some((e) => hits.some((c) => c.target === e)), `${label(f)}: no flyer, no other tile`);
    done(h);
  }
});

test('S2 阂断骤雪: never cast by the strategy; an enemy\'s hit casts it — that hit ×damage_remaining_scale, retaliate_atk_scale × ATK arts around the source (r 0.9, 隐匿 and air too), heal_ratio × the HP removed, one layer of ATK / DEF', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const sk = skillOf(tier, elite, 1), b = sk.bb;
    assert.deepEqual([sk.skillType, sk.maxChargeTime, b.damage_remaining_scale, b.damage_resistance, b.heal_ratio, b.max_stack_cnt], ['AUTO', 5, 0.1, 0.9, 0.05, 5], label(f));
    const { h, u } = field({ tier, elite, skill: 1 });
    u.skill.gainSp(999);
    const src = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.run(1);
    assert.equal(u.skill.activations, 0, `${label(f)}: no hit, no cast (an enemy in range, every charge stored)`);
    const near = h.spawn('enemy_dummy', { pos: [10, 7.85] }), hidden = h.spawn('enemy_dummy', { pos: [9.2, 7] });
    h.b.addBuff(hidden, { key: 'test:hide', flags: { stealth: true } });
    const air = h.spawn('enemy_fly', { pos: [10.6, 7.5] }), out = h.spawn('enemy_dummy', { pos: [10, 8] });
    const def0 = u.s.def, hp0 = u.hp, atk = u.base.atk;
    const got = inTick(h, () => h.b.dealDamage(src, u, { amount: 2000, type: 'phys' }));
    approx(got, (2000 - def0) * b.damage_remaining_scale, `${label(f)}: the hit that cast it, ×${b.damage_remaining_scale}`);
    assert.deepEqual([u.skill.activations, u.skill.charges], [1, 4], `${label(f)}: one charge`);
    assert.equal(u.findBuff('skill:oxi:stack')?.stacks, 1);
    approx(u.s.atk, atk * (1 + b.atk), `${label(f)}: ATK +${b.atk}`);
    approx(u.s.def, u.base.def * (1 + b.def), `${label(f)}: DEF +${b.def}`);
    const area = tagged(h, 'oxi:retaliate');
    assert.deepEqual(area.filter((c) => c.type === 'arts').map((c) => c.target.id).sort(), [src.id, near.id, hidden.id, air.id].sort(), `${label(f)}: within 0.9 of the source`);
    for (const c of area.filter((x) => x.type === 'arts')) approx(c.amount, u.s.atk * b.retaliate_atk_scale, `${label(f)}: ${b.retaliate_atk_scale} × ATK`);
    assert.ok(!area.some((c) => c.target === out), `${label(f)}: 1.0 away is outside`);
    const heals = h.hooksOf('heal').filter((c) => c.target === u && c.source === u);
    assert.equal(heals.length, 4, `${label(f)}: one heal per instance`);
    for (const c of heals) approx(c.amount, u.s.atk * b.retaliate_atk_scale * b.heal_ratio, `${label(f)}: ${b.heal_ratio} × the HP removed`);
    approx(u.hp, Math.min(u.s.maxHp, hp0 - got + heals.reduce((s, c) => s + c.amount, 0)), `${label(f)}: healed`);
    // inside the guard window (skill_duration s) no second cast; the 庇护 holds
    h.run(0.1);
    approx(inTick(h, () => h.b.dealDamage(src, u, { amount: 2000, type: 'phys' })), (2000 - u.s.def) * (1 - b.damage_resistance), `${label(f)}: 90 % 庇护`);
    assert.equal(u.skill.activations, 1, `${label(f)}: the window`);
    h.run(b.skill_duration);
    inTick(h, () => h.b.dealDamage(src, u, { amount: 100, type: 'true' }));
    assert.deepEqual([u.skill.activations, u.findBuff('skill:oxi:stack')?.stacks], [2, 2], `${label(f)}: true damage casts it too, a second layer`);
    done(h);
  }
});

test('S2: 持续伤害, 环境伤害, 无来源 damage, an ally\'s damage and 元素伤害 cast nothing; a true hit casts but is not lowered; stunned or silenced she does not cast', () => {
  const { h, u } = field({ skill: 1 });
  u.skill.gainSp(999);
  const e = h.spawn('enemy_dummy', { pos: [10, 7] });
  const ally = h.b.allyUnits.find((a) => a !== u) ?? u;
  const tries = [
    ['持续伤害', () => h.b.dealDamage({ source: e, target: u, amount: 500, type: 'arts', attackType: 'BUFF' })],
    ['dot tag', () => h.b.dealDamage(e, u, { amount: 500, type: 'arts', tags: ['dot'] })],
    ['环境伤害', () => h.b.dealDamage({ source: e, target: u, amount: 500, type: 'true', tags: ['terrain'] })],
    ['无来源', () => h.b.dealDamage({ source: null, credit: e, target: u, amount: 500, type: 'arts' })],
    ['an ally', () => h.b.dealDamage(ally, u, { amount: 500, type: 'arts' })],
    ['元素伤害', () => h.b.dealDamage(e, u, { amount: 500, type: 'elemental', element: 'burn' })],
  ];
  for (const [what, fn] of tries) { u.hp = u.s.maxHp; inTick(h, fn); assert.equal(u.skill.activations, 0, what); }
  h.b.applyStatus(u, 'stun', { duration: 1, force: true });
  inTick(h, () => h.b.dealDamage(e, u, { amount: 500, type: 'arts' }));
  assert.equal(u.skill.activations, 0, 'stunned');
  h.run(1.1);
  h.b.applyStatus(u, 'silence', { duration: 1, force: true });
  inTick(h, () => h.b.dealDamage(e, u, { amount: 500, type: 'arts' }));
  assert.equal(u.skill.activations, 0, 'silenced');
  h.run(1.1);
  u.hp = u.s.maxHp;
  approx(inTick(h, () => h.b.dealDamage(e, u, { amount: 500, type: 'true' })), 500, 'a true hit keeps its damage');
  assert.equal(u.skill.activations, 1, 'and casts it');
  done(h);
});

test('S2: a dodged hit casts nothing (PRTS 未被成功闪避) — her 闪避 is rolled for it once, at the guard; a hit not dodged casts as before and is not rolled again', () => {
  for (const [type, mod] of [['phys', 'dodgePhys'], ['arts', 'dodgeArts']]) {
    // a certain dodge: no charge, no window, no 庇护, no layer, no retaliation
    const { h, u } = field({ skill: 1 });
    u.skill.gainSp(999);
    h.b.addBuff(u, { key: 'test:dodge', mods: { [mod]: 1 } });
    const src = h.spawn('enemy_dummy', { pos: [10, 7] });
    const hp0 = u.hp;
    const dodges = () => h.eventsOf('fx').filter((e) => e[1] === 'dodge').length;
    assert.equal(inTick(h, () => h.b.dealDamage(src, u, { amount: 2000, type })), 0, `${type}: dodged`);
    assert.deepEqual([u.hp, dodges(), u.skill.charges, u.skill.activations], [hp0, 1, u.skill.maxCharges, 0], `${type}: one MISS, every charge kept`);
    assert.deepEqual([!!u.findBuff('protect'), !!u.findBuff('skill:oxi:stack'), !!u.findBuff('skill:oxi:guardWindow'), tagged(h, 'oxi:retaliate').length], [false, false, false, 0], `${type}: nothing of the cast`);
    // an undodgeable hit still casts it (no roll)
    approx(inTick(h, () => h.b.dealDamage(src, u, { amount: 2000, type, canDodge: false })), (type === 'phys' ? 2000 - u.base.def : 2000 * (1 - u.base.res / 100)) * 0.1, `${type}: undodgeable, ×0.1`);
    assert.equal(u.skill.activations, 1, `${type}: cast`);
    done(h);
  }
  // a 50 % dodge that fails: the hit is rolled exactly once (at the guard), casts, and the buff's 闪避 comes back afterwards
  const { h, u } = field({ skill: 1 });
  u.skill.gainSp(999);
  h.b.addBuff(u, { key: 'test:dodge', mods: { dodgePhys: 0.5 } });
  const src = h.spawn('enemy_dummy', { pos: [10, 7] });
  let draws = 0;
  h.b.rng = () => { draws++; return 0.7; };
  const def0 = u.s.def;
  approx(inTick(h, () => h.b.dealDamage(src, u, { amount: 2000, type: 'phys' })), (2000 - def0) * 0.1, 'not dodged: ×0.1');
  assert.deepEqual([draws, u.skill.activations, u.findBuff('test:dodge').mods.dodgePhys], [1, 1, 0.5], 'one roll, cast, the 闪避 restored');
  draws = 0;
  inTick(h, () => h.b.dealDamage(src, u, { amount: 2000, type: 'phys' }));
  assert.deepEqual([draws, u.skill.activations], [1, 1], 'inside the window: the pass rolls it itself, once, and nothing casts');
  done(h);
});

test('S2 庇护: damage_resistance for shelter_hold_duration s, then linearly to 0 at skill_duration s — the shared 庇护; the hit that cast it takes neither it nor a weaker 庇护 (a stronger one still applies)', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const b = skillOf(tier, elite, 1).bb;
    const { h, u } = field({ tier, elite, skill: 1 });
    u.skill.gainSp(999);
    const src = h.spawn('enemy_dummy', { pos: [10, 7] });
    holdProtect(h.b, u, 0.5, 5);   // a weaker 庇护 held already
    const def0 = u.s.def;
    let k0 = null;
    const seen = [];
    approx(inTick(h, () => { k0 = h.b.tickCount; return h.b.dealDamage(src, u, { amount: 2000, type: 'phys' }); }), (2000 - def0) * b.damage_remaining_scale,
      `${label(f)}: the weaker 庇护 does not reach the hit that cast it`);
    h.b.on('tick', () => { const p = u.findBuff('protect'); seen.push([h.b.tickCount - k0, p ? 1 - p.mods.physTakenMul : 0]); });
    h.run(1.6);
    const hold = Math.round(b.shelter_hold_duration * 30), total = Math.round(b.skill_duration * 30);
    for (const [m, v] of seen) {
      const own = m <= hold ? b.damage_resistance : m >= total ? 0 : (b.damage_resistance * (total - m)) / (total - hold);
      approx(v, Math.max(own, 0.5), `${label(f)}: 庇护 ${m} ticks after the cast (同名效果取最高 with the 0.5)`, 1e-9);
    }
    done(h);
  }
  // a stronger 庇护 (95 %) already held still reaches that hit
  const { h, u } = field({ skill: 1 });
  u.skill.gainSp(999);
  const src = h.spawn('enemy_dummy', { pos: [10, 7] });
  holdProtect(h.b, u, 0.95, 5);
  const def0 = u.s.def;
  approx(inTick(h, () => h.b.dealDamage(src, u, { amount: 2000, type: 'phys' })), (2000 - def0) * 0.1 * 0.05, 'the 95 % applies');
  assert.equal(u.skill.activations, 1);
  done(h);
});

test('S2 layers: at most max_stack_cnt, every gain refreshing them, one lost every stack_duration s; while she holds one her attacks hit up to her block count', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const b = skillOf(tier, elite, 1).bb;
    assert.deepEqual([b.max_stack_cnt, b.stack_duration, b['attack@buffed_attack_atk_scale']], [5, 5, 1], label(f));
    const { h, u } = field({ tier, elite, skill: 1 });
    const src = h.spawn('enemy_fly', { pos: [11, 9] });
    for (let i = 0; i < 6; i++) {
      u.skill.gainSp(999);
      inTick(h, () => h.b.dealDamage(src, u, { amount: 100, type: 'phys' }));
      h.run(b.skill_duration + 0.1);
    }
    assert.deepEqual([u.skill.activations, u.findBuff('skill:oxi:stack').stacks], [6, b.max_stack_cnt], `${label(f)}: capped`);
    approx(u.s.atk, u.base.atk * (1 + b.atk * b.max_stack_cnt), `${label(f)}: ATK`);
    // refreshed by the last gain (skill_duration + 0.1 s ago): one layer goes stack_duration s after it
    h.run(b.stack_duration - b.skill_duration - 0.2);
    assert.equal(u.findBuff('skill:oxi:stack').stacks, 5, `${label(f)}: still 5`);
    h.run(0.2);
    assert.equal(u.findBuff('skill:oxi:stack').stacks, 4, `${label(f)}: one layer gone`);
    h.run(b.stack_duration);
    assert.equal(u.findBuff('skill:oxi:stack').stacks, 3, `${label(f)}: then the next`);
    // BuffedAttack: both enemies of her 1-1 at once; without a layer one only
    const a = h.spawn('enemy_dummy', { pos: [10, 6] }), c = h.spawn('enemy_dummy', { pos: [10, 5.2] });
    const n0 = h.hooksOf('attack').length;
    assert.ok(h.runUntil(() => h.hooksOf('attack').length > n0, 3));
    assert.deepEqual(h.hooksOf('attack').slice(n0)[0].targets.map((t) => t.id).sort(), [a.id, c.id].sort(), `${label(f)}: every target up to her block count`);
    h.b.removeBuff(u, 'skill:oxi:stack');
    const n1 = h.hooksOf('attack').length;
    assert.ok(h.runUntil(() => h.hooksOf('attack').length > n1, 3));
    assert.equal(h.hooksOf('attack').slice(n1)[0].targets.length, 1, `${label(f)}: one target without a layer`);
    done(h);
  }
});

test('S2 centre: without a source an enemy she blocks, else a ground enemy of her 1-1; with none the cast still gives the 庇护 and the layer but hits nobody', () => {
  const { h, u } = field({ skill: 1 });
  const fly = h.spawn('enemy_fly', { pos: [10, 6] });
  u.skill.gainSp(999);
  inTick(h, () => u.skill.activate('test'));
  assert.deepEqual([u.skill.activations, tagged(h, 'oxi:retaliate').length, u.findBuff('skill:oxi:stack')?.stacks], [1, 0, 1], 'a flyer is no centre');
  assert.ok(u.findBuff('protect'), '庇护');
  const g = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.run(1.5);
  inTick(h, () => u.skill.activate('test'));
  assert.deepEqual(tagged(h, 'oxi:retaliate').filter((c) => c.type === 'arts').map((c) => c.target.id).sort(), [fly.id, g.id].sort(), 'the ground enemy of her 1-1, the flyer by it');
  done(h);
});

test('S3 日冕重烈 (MANUAL, DEFAULT, 36 s): ATK +atk, no attack; a volley at once and every 80 frames, 过载 from half its duration (a volley at once, then every 60 frames); it runs its full duration', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const sk = skillOf(tier, elite, 2), b = sk.bb;
    assert.deepEqual([sk.skillType, sk.duration, sk.spCost, sk.initSp, b.normal_interval, b.overload_interval, b.normal_half_width, b.overload_half_width],
      ['MANUAL', 36, 45, 38, 2.67, 2, 2, 6], label(f));
    const { h, u } = field({ tier, elite, skill: 2 });
    h.spawn('enemy_dummy', { pos: [10, 6] });
    const volleys = [];
    const fx = h.b.fx.bind(h.b);
    h.b.fx = (kind, p) => { if (kind === 'heatwave') volleys.push([h.b.tickCount, p.n]); return fx(kind, p); };
    u.skill.gainSp(999);
    let k0 = null;
    assert.ok(h.runUntil(() => { if (u.skill.active && k0 === null) k0 = h.b.tickCount - 1; return u.skill.active; }, 3), `${label(f)}: cast with an enemy in her range`);
    approx(u.s.atk, u.base.atk * (1 + b.atk), `${label(f)}: ATK +${b.atk}`);
    assert.ok(h.runUntil(() => !u.skill.active, 40), `${label(f)}: it ends`);
    const from = h.hooksOf('skillStart').find((c) => c.unit === u).t, to = h.hooksOf('skillEnd').find((c) => c.unit === u);
    assert.equal(to.reason, 'duration');
    approx(to.t - from, sk.duration, `${label(f)}: ${sk.duration} s`, 1e-6);
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.t > from + 1e-9 && c.t < to.t - 1e-9).length, 0, `${label(f)}: no attack while it runs`);
    const rel = volleys.map(([k]) => k - k0);
    const want = [0, 80, 160, 240, 320, 400, 480, 540, 600, 660, 720, 780, 840, 900, 960, 1020];
    assert.deepEqual(rel, want, `${label(f)}: 80 frames (2.67 s), from 18 s 60 frames`);
    assert.ok(volleys.every(([, n]) => n === 4), `${label(f)}: every row of the field (4 < 5)`);
    done(h);
  }
});

test('S3 lanes: across her facing within normal_half_width (overload_half_width under 过载) of her own, shifted inside the field; from up to 11 tiles behind her to wave_exit_distance past the far edge', () => {
  const b = skillOf(6, true, 2).bb;
  const lanes = (u) => u.mem.oxiShots.map((s) => [s.x, s.y, s.dx, s.dy, s.left]);
  {
    const { h, u } = field({ skill: 2, dir: 'UP', col: 5 });
    inTick(h, () => { u.skill.gainSp(999); u.skill.activate('test'); });
    // facing up: the lanes are columns; from row max(9, 10 − 11) = 9 up to 12 + wave_exit_distance
    assert.deepEqual(lanes(u), [3, 4, 5, 6, 7].map((c) => [c, 9, 0, 1, 12 + b.wave_exit_distance - 9]), 'five columns around hers');
    h.runUntil(() => u.mem.oxiRain?.over, 20);
    const wave = u.mem.oxiShots[u.mem.oxiShots.length - 1].wave;   // the 过载 volley, just fired
    assert.deepEqual(u.mem.oxiShots.filter((s) => s.wave === wave).map((s) => s.x), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '过载: every column of the field (11 < 13)');
    done(h);
  }
  {
    const { h, u } = field({ skill: 2, dir: 'UP', col: 1 });
    inTick(h, () => { u.skill.gainSp(999); u.skill.activate('test'); });
    assert.deepEqual(lanes(u).map((s) => s[0]), [0, 1, 2, 3, 4], 'shifted inside the field at its edge');
    done(h);
  }
  {
    const { h, u } = field({ skill: 2, dir: 'LEFT', col: 5 });
    inTick(h, () => { u.skill.gainSp(999); u.skill.activate('test'); });
    assert.deepEqual(lanes(u), [9, 10, 11, 12].map((r) => [10, r, -1, 0, 10 + b.wave_exit_distance]), 'facing left: from col min(10, 5 + 11) to 0 − 5');
    done(h);
  }
});

test('S3 簇火: the first enemy it touches (air too) makes it explode — heatwave_atk_scale × the ATK cached at the volley within range_radius; same_wave_repeat_damage_scale on a repeat; 元素伤害 to an enemy in its 灼燃 爆发冷却; a 隐匿 one is passed', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    const b = skillOf(tier, elite, 2).bb, t = talentOf(tier, elite, 0);
    const { h, u } = field({ tier, elite, skill: 2, row: 9, col: 2 });
    h.run(6);   // 6 layers of 【怒火】, kept while she does not attack
    const rage = 1 + t.arcane_step * 6;
    const hidden = h.spawn('enemy_dummy', { pos: [10, 5] });
    h.b.addBuff(hidden, { key: 'test:hide', flags: { stealth: true } });
    const e1 = h.spawn('enemy_dummy', { pos: [10, 7] }), e2 = h.spawn('enemy_dummy', { pos: [10, 8.4] });
    const fly = h.spawn('enemy_fly', { pos: [11, 7] }), far = h.spawn('enemy_dummy', { pos: [10, 8.6] });
    h.b.dealDamage(u, e2, { amount: 5000, type: 'element', element: 'burn' });   // e2 in its 灼燃 burst
    u.skill.gainSp(999);
    inTick(h, () => u.skill.activate('test'));
    const cached = u.s.atk;
    approx(cached, u.base.atk * (1 + b.atk), 'the cached ATK');
    h.b.addBuff(u, { key: 'test:atk', mods: { atkPct: 1 } });   // later ATK changes do not reach the volley in flight
    assert.ok(h.runUntil(() => tagged(h, 'oxi:heatwave').length > 0, 6), `${label(f)}: an explosion`);
    h.step();
    const first = tagged(h, 'oxi:heatwave');
    const by = (e) => first.filter((c) => c.target === e);
    // row 10's 簇火 passes the 隐匿 enemy and meets e1: e1, e2 (1.4 away) and the flyer (1 away) — not `far` (1.6)
    assert.deepEqual([by(hidden).length, by(far).length], [0, 0], `${label(f)}: the 隐匿 one passed, 1.6 away is outside`);
    approx(by(e1)[0].amount, cached * b.heatwave_atk_scale * rage, `${label(f)}: ${b.heatwave_atk_scale} × the cached ATK`);
    assert.equal(by(e1)[0].type, 'arts');
    assert.deepEqual([by(e2)[0].type, by(e2)[0].dmg.element], ['elemental', 'burn'], `${label(f)}: 元素伤害 in its 爆发冷却`);
    approx(by(e2)[0].amount, cached * b.heatwave_atk_scale * rage, `${label(f)}: the same scale`);
    // row 11's 簇火 meets the flyer: a second explosion of the same volley — repeats at ×same_wave_repeat_damage_scale
    const repeat = by(fly).slice(1).concat(by(e1).slice(1));
    assert.ok(repeat.length >= 2, `${label(f)}: the second explosion`);
    for (const c of repeat) approx(c.amount, cached * b.heatwave_atk_scale * b.same_wave_repeat_damage_scale * rage, `${label(f)}: ${b.same_wave_repeat_damage_scale} on a repeat`);
    approx(by(fly)[0].amount, cached * b.heatwave_atk_scale * rage, `${label(f)}: the flyer's first hit in full`);
    done(h);
  }
});

test('S3: a 簇火 in flight when she leaves the field still explodes (the cached ATK) — without her 【怒火】 or 灼燃, which leave with her', () => {
  const { h, u } = field({ skill: 2, row: 9, col: 2 });
  const b = skillOf(6, true, 2).bb;
  h.run(6);
  assert.equal(rageOf(u), 6);
  const e = h.spawn('enemy_dummy', { pos: [10, 7] });
  inTick(h, () => { u.skill.gainSp(999); u.skill.activate('test'); });
  const cached = u.s.atk;
  h.b.retreat(u);
  assert.ok(h.runUntil(() => tagged(h, 'oxi:heatwave').length > 0, 6), 'it still lands');
  const hit = tagged(h, 'oxi:heatwave').find((c) => c.target === e);
  approx(hit.amount, cached * b.heatwave_atk_scale, 'the cached ATK, no 【怒火】');
  assert.equal(e.elem.burn, 0, 'no 灼燃');
  done(h);
});

test('S3: only one 塔露拉 channels at a time — another\'s volleys fail until the first one\'s skill ended; the 簇火 in flight outlive the skill', () => {
  const second = { uid: 2, diy: { slot: SLOT[5], charId: OXI, skillIndex: 2 }, elite: true, row: 12, col: 5 };
  const { h, u } = field({ skill: 2, others: [second] });
  const v = h.unit(2);
  assert.equal(v.def.charId, OXI);
  const volleys = [];
  const fx = h.b.fx.bind(h.b);
  h.b.fx = (kind, p) => { if (kind === 'heatwave') volleys.push([p.id, h.b.time]); return fx(kind, p); };
  inTick(h, () => { u.skill.gainSp(999); u.skill.activate('test'); });
  h.run(10);
  inTick(h, () => { v.skill.gainSp(999); v.skill.activate('test'); });
  assert.ok(v.skill.active);
  h.runUntil(() => !u.skill.active, 30);
  const end = h.b.time;
  assert.ok(volleys.filter(([id]) => id === v.id).length === 0, 'the second one fails while the first channels');
  assert.ok(u.mem.oxiShots.length > 0, 'the first one\'s 簇火 still fly');
  h.runUntil(() => !v.skill.active, 15);
  assert.ok(volleys.some(([id, time]) => id === v.id && time >= end - 1e-9), 'then the second one channels');
  done(h);
});
