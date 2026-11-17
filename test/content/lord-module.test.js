import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

function field(id = 'chess_char_2_16_b', pos = [10, 7], loadout = {}, definition = null) {
  const h = makeBattle({ autoFinish: false, units: [{ chessId: id, row: 10, col: 3, ...loadout }], defs: {
    enemies: { probe: enemyRec({ key: 'probe', hp: 1000000, def: 0, res: 0, atk: 0, speed: 0 }) },
    ...(definition ? { chess: { [id]: definition } } : {}),
  } });
  h.step();
  const b = h.b, u = h.unit(id), e = h.spawn('probe', { pos }), applied = [];
  u.atkCd = 999;
  b.on('damageApplied', c => { if (c.target === e) applied.push(c); });
  return { h, b, u, e, applied };
}
const hit = (f, extra = {}) => f.b.dealDamage({ source: f.u, target: f.e, amount: 1000, type: 'phys', isAttack: true, ...extra });
const done = f => { checkInvariants(f.b); assert.deepEqual(f.b.errors, []); };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ≈ ${b}`);

test('Lappland LOR-X calculates one precomputed arts ADDITION before its parent, with source and origin', () => {
  const f = field(), { b, u, e, applied } = f;
  let calculations = 0;
  b.on('damageCalculate', c => { if (c.source === u) { calculations++; c.dmg.amount *= 2; } });
  b.addBuff(e, { key: 'resistance', mods: { resFlat: 50 } });
  near(hit(f), 2000);
  assert.equal(calculations, 1, 'the child cannot re-enter source calculation');
  assert.equal(applied.length, 2);
  const child = applied[0], parent = applied[1];
  assert.equal(child.source, u);
  assert.equal(child.credit, u);
  assert.equal(child.dmg.origin, parent.dmg);
  assert.equal(child.dmg.attackType, 'ADDITION');
  assert.equal(child.dmg.applyWay, 'NONE');
  assert.equal(child.dmg.calculation, 'precomputed');
  assert.equal(child.dmg.isAttack, false);
  near(child.amount, u.s.atk * 0.1 * 0.5);
  done(f);
});

for (const type of ['phys', 'arts', 'true']) test(`Lappland module source calculation is independent of ${type} parent HP type`, () => {
  const f = field();
  hit(f, { type, isAttack: false });
  assert.equal(f.applied.length, 2, 'native template has no attack-family or HP-type filter');
  done(f);
});

for (const calculation of ['precomputed', 'resolved']) test(`Lappland module does not run for a ${calculation} parent`, () => {
  const f = field();
  hit(f, { calculation });
  assert.equal(f.applied.length, 1);
  done(f);
});

test('Lappland module does not treat credit as actual source or trigger on HP loss/gauges', () => {
  const f = field(), { b, u, e } = f;
  hit(f, { source: null, credit: u });
  b.dealHPLose({ source: u, target: e, amount: 10 });
  b.dealElementDamage({ source: u, target: e, amount: 1, element: 'burn' });
  assert.equal(f.applied.filter(c => c.dmg.tags.includes('module')).length, 0);
  done(f);
});

for (const defense of ['shield', 'physical dodge', 'arts dodge']) test(`Lappland module has its own injury phase before parent ${defense}`, () => {
  const f = field(), { b, u, e, applied } = f;
  if (defense === 'shield') b.addBuff(e, { key: 'defense', shieldHits: 1 });
  if (defense === 'physical dodge') b.addBuff(e, { key: 'defense', mods: { dodgePhys: 1 } });
  if (defense === 'arts dodge') b.addBuff(e, { key: 'defense', mods: { dodgeArts: 1 } });
  const parent = hit(f);
  near(parent, defense === 'physical dodge' ? 0 : 1000);
  near(e.s.maxHp - e.hp, defense === 'physical dodge' ? u.s.atk * 0.1 : 1000);
  assert.equal(applied.length, 1);
  done(f);
});

test('Lappland module can kill before parent damage without reporting a second kill', () => {
  const f = field();
  f.e.hp = 1;
  assert.equal(hit(f), 0);
  assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].dmg.attackType, 'ADDITION');
  assert.equal(f.u.stats.kills, 1);
  done(f);
});

test('Lappland without the module emits only the parent', () => {
  const f = field('chess_char_2_16_a');
  hit(f);
  assert.equal(f.applied.length, 1);
  done(f);
});

test('Lappland natural attack has one earlier module child and no remaining afterHit duplicate', () => {
  const f = field('chess_char_2_16_b', [10, 4]);
  f.u.atkCd = 0;
  assert.ok(f.h.runUntil(() => f.applied.length >= 2, 3));
  assert.equal(f.applied.length, 2);
  assert.equal(f.applied[0].dmg.attackType, 'ADDITION');
  assert.equal(f.applied[1].dmg.isAttack, true);
  assert.equal(f.applied[0].dmg.origin, f.applied[1].dmg);
  done(f);
});

test('Ayer module reads the pending S1 multiplier on a natural attack and stops after that skill', () => {
  const f = field('chess_char_3_02_b', [10, 4], { skillIndex: 0 });
  assert.ok(f.u.skill.activate('test', { free: true }));
  assert.ok(f.u.skill.pending);
  const multiplier = f.u.skill.bb.atk_scale;
  f.u.atkCd = 0;
  assert.ok(f.h.runUntil(() => f.applied.length >= 2, 3));
  assert.equal(f.applied.length, 2);
  assert.equal(f.applied[0].dmg.attackType, 'ADDITION');
  near(f.applied[0].amount, f.u.s.atk * 0.1 * multiplier);
  assert.equal(f.u.skill.active, false);
  f.applied.length = 0;
  hit(f);
  near(f.applied[0].amount, f.u.s.atk * 0.1);
  done(f);
});

test('Ayer S2 module reads atk_scale and excludes its HitBlockee damage', () => {
  const f = field('chess_char_3_02_b');
  assert.ok(f.u.skill.activate('test', { free: true }));
  hit(f, { type: 'arts', isSkill: true });
  assert.equal(f.applied[0].dmg.attackType, 'ADDITION');
  near(f.applied[0].amount, f.u.s.atk * 0.1 * f.u.skill.bb.atk_scale);
  f.applied.length = 0;
  hit(f, { type: 'arts', isAttack: false, isSkill: true, tags: ['skill', 'melee', 'ayerBlade'] });
  assert.equal(f.applied.length, 1, 'HitBlockee does not produce a module child');
  done(f);
});

test('Ayer module has its own shield phase and omits source-less and precomputed parents', () => {
  const f = field('chess_char_3_02_b');
  f.b.addBuff(f.e, { key: 'shield', shieldHits: 1 });
  near(hit(f), 1000, 'the earlier module child consumes the shield');
  f.applied.length = 0;
  hit(f, { source: null, credit: f.u });
  hit(f, { calculation: 'precomputed' });
  assert.equal(f.applied.length, 2);
  assert.ok(f.applied.every(c => !c.dmg.tags.includes('module')));
  done(f);
});

test('Ayer S2 hits her own blocked enemy with HitBlockee, without another module child', () => {
  const f = field('chess_char_3_02_b', [10, 3]);
  f.h.run(0.2);
  assert.equal(f.e.blockedBy, f.u);
  assert.ok(f.u.skill.activate('test', { free: true }));
  f.u.atkCd = 0;
  assert.ok(f.h.runUntil(() => f.applied.some(c => c.dmg.isAttack && c.dmg.isSkill), 3));
  const blades = f.applied.filter(c => c.dmg.tags.includes('ayerBlade'));
  const modules = f.applied.filter(c => c.dmg.tags.includes('module'));
  assert.equal(blades.length, 1);
  assert.equal(modules.length, 1, 'only the primary attack creates the rider');
  near(blades[0].amount, f.u.s.atk * f.u.skill.bb.atk_scale);
  assert.equal(modules[0].dmg.origin.isAttack, true);
  assert.equal(modules[0].dmg.origin.tags.includes('ayerBlade'), false);
  done(f);
});

test('SilverAsh pending S1 projectile retains the module multiplier and creates one earlier child', () => {
  const f = field('chess_char_4_22_b', [10, 4], { skillIndex: 0 });
  assert.ok(f.u.skill.activate('test', { free: true }));
  const multiplier = f.u.skill.bb.atk_scale;
  f.u.atkCd = 0;
  assert.ok(f.h.runUntil(() => f.applied.length >= 2, 3));
  assert.equal(f.applied.length, 2);
  assert.equal(f.applied[0].dmg.attackType, 'ADDITION');
  near(f.applied[0].amount, f.u.s.atk * 0.1 * multiplier);
  assert.equal(f.applied[0].dmg.origin, f.applied[1].dmg);
  assert.equal(f.u.skill.active, false);
  f.applied.length = 0;
  hit(f);
  near(f.applied[0].amount, f.u.s.atk * 0.1);
  done(f);
});

for (const type of ['phys', 'arts', 'true']) test(`SilverAsh source-calculation module has no ${type} or attack-family restriction`, () => {
  const f = field('chess_char_4_22_b');
  hit(f, { type, isAttack: false });
  assert.equal(f.applied.length, 2);
  assert.equal(f.applied[0].dmg.attackType, 'ADDITION');
  near(f.applied[0].amount, f.u.s.atk * 0.1);
  done(f);
});

for (const defense of ['shield', 'physical dodge', 'arts dodge']) test(`SilverAsh module precedes parent ${defense}`, () => {
  const f = field('chess_char_4_22_b');
  if (defense === 'shield') f.b.addBuff(f.e, { key: 'defense', shieldHits: 1 });
  if (defense === 'physical dodge') f.b.addBuff(f.e, { key: 'defense', mods: { dodgePhys: 1 } });
  if (defense === 'arts dodge') f.b.addBuff(f.e, { key: 'defense', mods: { dodgeArts: 1 } });
  near(hit(f), defense === 'physical dodge' ? 0 : 1000);
  near(f.e.s.maxHp - f.e.hp, defense === 'physical dodge' ? f.u.s.atk * 0.1 : 1000);
  done(f);
});

test('SilverAsh module skips source calculation and does not generate another Pegasus child', () => {
  const f = field('chess_char_4_22_b', [10, 7], { items: ['chess_item_5_09_e_a', 'chess_item_6_01_e_a'] });
  let calculations = 0;
  f.b.on('damageCalculate', c => { if (c.source === f.u) { calculations++; c.dmg.amount *= 2; } });
  hit(f);
  assert.equal(calculations, 1);
  assert.equal(f.applied.length, 3);
  const module = f.applied.filter(c => c.dmg.tags.includes('module'));
  const pegasus = f.applied.filter(c => c.dmg.tags.includes('item:pegasus'));
  assert.equal(module.length, 1);
  near(module[0].amount, f.u.s.atk * 0.1);
  assert.equal(pegasus.length, 1);
  assert.equal(pegasus[0].source, null);
  assert.equal(pegasus[0].credit, f.u);
  done(f);
});

test('SilverAsh module omits source-less credit, precomputed/resolved damage, HP loss and gauges', () => {
  const f = field('chess_char_4_22_b');
  hit(f, { source: null, credit: f.u });
  hit(f, { calculation: 'precomputed' });
  hit(f, { calculation: 'resolved' });
  f.b.dealHPLose({ source: f.u, target: f.e, amount: 10 });
  f.b.dealElementDamage({ source: f.u, target: f.e, amount: 1, element: 'burn' });
  assert.equal(f.applied.filter(c => c.dmg.tags.includes('module')).length, 0);
  done(f);
});

for (const rank of ['NORMAL', 'ELITE', 'BOSS']) test(`SilverAsh native higher-stage multiplier affects ${rank} primary and precomputed child exactly once`, () => {
  // Shipped chess has stage 1. Inject the native talent's stage-3 atk_scale to exercise its independent branch.
  const id = 'chess_char_4_22_b', base = getDefaultSource().getChess(id, { skillIndex: 0 });
  const definition = { ...base, talents: base.talents.map((t, i) => i === 0 ? { ...t, bb: { ...t.bb, atk_scale: 1.15 } } : t) };
  const f = field(id, [10, 4], { skillIndex: 0 }, definition);
  f.e.def = { ...f.e.def, rank };
  const multiplier = rank === 'NORMAL' ? 1 : 1.15;
  near(hit(f), 1000 * multiplier);
  near(f.applied[0].amount, f.u.s.atk * 0.1 * multiplier);
  assert.equal(f.applied.length, 2);
  f.applied.length = 0;
  assert.ok(f.u.skill.activate('test', { free: true }));
  const skillScale = f.u.skill.bb.atk_scale;
  f.u.atkCd = 0;
  assert.ok(f.h.runUntil(() => f.applied.length >= 2, 3));
  assert.equal(f.applied.length, 2);
  near(f.applied[0].amount, f.u.s.atk * 0.1 * skillScale * multiplier);
  near(f.applied[1].amount, f.u.s.atk * skillScale * multiplier);
  done(f);
});

function qiubaiField({ moduleId = 'uniequip_002_qiubai', prob = 0 } = {}) {
  const id = 'chess_char_6_15_b', base = getDefaultSource().getChess(id, { moduleId });
  const definition = { ...base, talents: base.talents.map((t, i) => i === 1 ? { ...t, bb: { ...t.bb, prob } } : t) };
  const f = field(id, [10, 7], { moduleId }, definition);
  f.e.atkCd = 999;
  return f;
}
const gaps = f => f.applied.filter(c => c.dmg.tags.includes('qiubai:gap'));
const pendingGap = f => f.e.findBuff(f.u.def.talents[0].bb.atk_scale_t != null ? 'qiubai_e_002_t[damage]' : 'qiubai_talent_1[damage]');

test('Qiubai module is immediate but gap checks control after 0.1 s without source-calculation re-entry', () => {
  const f = qiubaiField(), { b, u, e, h } = f;
  b.applyStatus(e, 'bind', { duration: 10, source: u });
  b.applyStatus(e, 'sluggish', { duration: 10, source: u });
  let calculations = 0;
  b.on('damageCalculate', c => { if (c.source === u) { calculations++; c.dmg.amount *= 2; } });
  hit(f);
  assert.equal(f.applied.length, 2);
  const module = f.applied[0], parent = f.applied[1];
  assert.equal(module.dmg.attackType, 'ADDITION');
  assert.equal(module.dmg.calculation, 'precomputed');
  assert.equal(module.dmg.origin, parent.dmg);
  near(module.amount, u.s.atk * 0.1);
  const started = b.time;
  let landed = null;
  b.on('damageApplied', c => { if (c.dmg.tags.includes('qiubai:gap')) landed = b.time; });
  h.step(3);
  assert.equal(gaps(f).length, 0);
  h.step();
  assert.equal(gaps(f).length, 1);
  const gap = gaps(f)[0];
  assert.equal(gap.dmg.attackType, 'ADDITION');
  assert.equal(gap.dmg.applyWay, 'NONE');
  assert.equal(gap.dmg.calculation, 'precomputed');
  assert.equal(gap.dmg.origin, parent.dmg);
  near(gap.amount, u.s.atk * u.def.talents[0].bb.atk_scale_t * u.def.talents[0].bb.value);
  assert.equal(calculations, 1);
  near(landed - started, 0.1);
  done(f);
});

for (const timing of ['added later', 'expired before check']) test(`Qiubai gap reads status at expiry: ${timing}`, () => {
  const f = qiubaiField();
  if (timing === 'expired before check') f.b.applyStatus(f.e, 'sluggish', { duration: 0.05, source: f.u });
  hit(f);
  f.h.step();
  if (timing === 'added later') f.b.applyStatus(f.e, 'bind', { duration: 10, source: f.u });
  f.h.step(3);
  assert.equal(gaps(f).length, timing === 'added later' ? 1 : 0);
  done(f);
});

test('Qiubai Y binds before a physically dodged primary, enabling its delayed gap', () => {
  const f = qiubaiField({ moduleId: 'uniequip_003_qiubai' });
  f.b.addBuff(f.e, { key: 'dodge', mods: { dodgePhys: 1 } });
  assert.equal(hit(f), 0);
  assert.ok(f.e.findBuff('bind'));
  assert.equal(gaps(f).length, 0);
  f.h.step(4);
  assert.equal(gaps(f).length, 1);
  done(f);
});

test('Qiubai Y first mark resets on the next deployment', () => {
  const f = qiubaiField({ moduleId: 'uniequip_003_qiubai' });
  hit(f);
  assert.ok(f.e.findBuff('bind'));
  f.b.removeBuff(f.e, 'bind');
  hit(f);
  assert.equal(f.e.findBuff('bind'), null, 'the same deployment keeps its first mark');
  f.b.kill(f.u, null);
  f.h.step();
  assert.ok(f.b.redeploy(f.u));
  f.u.atkCd = 999;
  hit(f);
  assert.ok(f.e.findBuff('bind'), 'the new deployment gets its own first bind');
  done(f);
});

for (const calculation of ['precomputed', 'resolved']) test(`Qiubai ${calculation} parents skip module, gap and bind roll`, () => {
  const f = qiubaiField({ prob: 1 });
  const before = f.b.rng.state();
  hit(f, { calculation });
  assert.equal(f.e.findBuff('bind'), null);
  assert.equal(pendingGap(f), null);
  f.h.step(3);
  assert.equal(f.applied.length, 1);
  assert.equal(f.b.rng.state(), before);
  done(f);
});

test('Qiubai actual source calculation can trigger on base non-attack ADDITION, but credit/loss/gauges cannot', () => {
  const f = qiubaiField({ prob: 1 });
  hit(f, { source: null, credit: f.u });
  f.b.dealHPLose(f.e, 10, { source: f.u, from: { isAttack: true } });
  f.b.dealElementDamage({ source: f.u, target: f.e, amount: 1, element: 'burn' });
  assert.equal(f.e.findBuff('bind'), null);
  assert.equal(pendingGap(f), null);
  f.applied.length = 0;
  hit(f, { type: 'true', attackType: 'ADDITION', isAttack: false });
  assert.ok(f.e.findBuff('bind'));
  assert.equal(f.applied.length, 2);
  f.h.step(4);
  assert.equal(gaps(f).length, 1);
  done(f);
});

test('Qiubai single pending key uses the explicitly assumed replacement policy for closely spaced damage', () => {
  const f = qiubaiField();
  f.b.applyStatus(f.e, 'bind', { duration: 10, source: f.u });
  hit(f);
  f.h.step(2);
  hit(f);
  const parent = f.applied[f.applied.length - 1].dmg;
  f.h.step(2);
  assert.equal(gaps(f).length, 0, 'the replacement starts its own 0.1 s window');
  f.h.step(2);
  assert.equal(gaps(f).length, 1);
  assert.equal(gaps(f)[0].dmg.origin, parent);
  done(f);
});

test('Qiubai pending buff also resolves on removal, matching native ON_BUFF_FINISH', () => {
  const f = qiubaiField();
  f.b.applyStatus(f.e, 'bind', { duration: 10, source: f.u });
  hit(f);
  assert.equal(gaps(f).length, 0);
  f.b.removeBuff(f.e, pendingGap(f));
  assert.equal(gaps(f).length, 1);
  f.h.step(3);
  assert.equal(gaps(f).length, 1, 'no expiry duplicate after explicit removal');
  done(f);
});

test('Qiubai base and upgraded talent templates keep separate native pending keys on the same target', () => {
  const h = makeBattle({ autoFinish: false, units: [
    { uid: 1, chessId: 'chess_char_6_15_b', moduleId: 'uniequip_002_qiubai', row: 10, col: 3 },
    { uid: 2, chessId: 'chess_char_6_15_b', moduleId: 'uniequip_003_qiubai', row: 11, col: 3 },
  ], defs: { enemies: { probe: enemyRec({ key: 'probe', hp: 1000000, atk: 0, speed: 0, def: 0, res: 0 }) } } });
  h.step();
  const x = h.unit(1), y = h.unit(2), e = h.spawn('probe', { pos: [10, 7] });
  x.atkCd = y.atkCd = e.atkCd = 999;
  h.b.applyStatus(e, 'bind', { duration: 10, source: x });
  const applied = [];
  h.b.on('damageApplied', c => { if (c.dmg.tags.includes('qiubai:gap')) applied.push(c); });
  for (const u of [x, y]) h.b.dealDamage({ source: u, target: e, amount: 100, type: 'true' });
  assert.ok(e.findBuff('qiubai_e_002_t[damage]'));
  assert.ok(e.findBuff('qiubai_talent_1[damage]'));
  h.step(4);
  assert.equal(applied.length, 2);
  assert.deepEqual(new Set(applied.map(c => c.source)), new Set([x, y]));
  checkInvariants(h.b);
  assert.deepEqual(h.b.errors, []);
});

test('Qiubai gap recognizes the native infinite sluggish key', () => {
  const f = qiubaiField();
  f.b.addBuff(f.e, { key: 'sluggish[inf]' });
  hit(f);
  f.h.step(4);
  assert.equal(gaps(f).length, 1);
  done(f);
});
