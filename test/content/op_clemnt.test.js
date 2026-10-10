import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';
import { diyPool } from '../../shared/diy.js';
import { performAttack, effectiveProfile } from '../../server/sim/ai.js';
const C = 'char_4231_clemnt';
const data = Object.fromEntries(['chess', 'backups'].map((f) => [f, JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url)))]));
const approx = (a, b, label = '') => assert.ok(Math.abs(a - b) < 1e-5 * Math.max(1, Math.abs(b)), `${label}: ${a} != ${b}`);
const enemy = (key, opts = {}) => enemyRec({ key, hp: 1e8, atk: 0, speed: 0, ...opts });
const defs = { enemies: { dummy: enemy('dummy'), light: enemy('light', { mass: 3 }), mid: enemy('mid', { mass: 4 }), heavy: enemy('heavy', { mass: 9 }),
  fly: enemy('fly', { motion: 'FLY' }), zero: enemy('zero', { mass: 0 }), armored: enemy('armored', { def: 100 }) } };
function field({ tier = 6, elite = true, skill = 0, potential = 6, dir = 'RIGHT', row = 10, col = 3 } = {}) {
  const h = makeBattle({ seed: 23, autoFinish: false, timeLimit: 180, defs,
    hooks: ['damaged', 'attack', 'elementBurst', 'ammoUsed'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: tier, charId: C, skillIndex: skill }, elite, potential, row, col, dir }] });
  h.step(); return { h, u: h.unit(1) };
}
function done(h) { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); }
function start(u) { u.skill.gainSp(999, 'init'); assert.equal(u.skill.activate('test'), true); }
const hits = (h, tag) => h.hooksOf('damaged').filter((c) => c.dmg?.tags?.includes(tag));

test('克莱门莎 is selectable with authored skills in both slots, every form and potential', () => {
  assert.ok(KITTED_CHARS.includes(C));
  for (const tier of [5, 6]) {
    assert.ok(diyPool(tier, { data, kitted: KITTED_CHARS }).includes(C));
    for (const elite of [false, true]) for (const skill of [0, 1, 2]) for (const potential of [1, 6]) {
      const { h, u } = field({ tier, elite, skill, potential });
      assert.equal(u.def.charId, C); assert.equal(u.kit.skillSource, 'skills'); assert.ok(!u.kit.generic);
      assert.equal(u.skill.id, `skchr_clemnt_${skill + 1}`);
      assert.deepEqual([u.profile.dmgType, u.profile.canHitFly, u.s.blockCnt, u.base.bat], ['phys', false, 2, 1.2]);
      assert.ok(u.def.bonds.includes('egirShip'));
      assert.equal(u.skill.rule, skill ? 'ACTIVE_RANGE' : 'DEFAULT');
      done(h);
    }
  }
});

test('生死定夺 checks current versus initial DEF for each physical hit; scales before DEF, never elemental damage', () => {
  for (const potential of [1, 3, 6]) {
    const { h, u } = field({ potential });
    const e = h.spawn('armored', { pos: [10, 6] }); h.b.rng = () => 0.3;
    approx(h.b.dealDamage(u, e, { amount: 1000, type: 'phys' }), 900);
    h.b.addBuff(e, { key: 'test:def', mods: { defFlat: -50 } });
    approx(h.b.dealDamage(u, e, { amount: 1000, type: 'phys' }), 1000 * (potential >= 3 ? 1.5 : 1.35) - 50);
    approx(h.b.dealDamage(u, e, { amount: 1000, type: 'elemental' }), 1000);
    const z = h.spawn('dummy', { pos: [10, 7] }); h.b.addBuff(z, { key: 'test:def', mods: { defFlat: -50 } });
    approx(h.b.dealDamage(u, z, { amount: 1000, type: 'phys' }), 1000);
    done(h);
  }
});

test('习得性防御 handles all facings, boundary tiles, blocked enemies, seamonsters, and damage types', () => {
  for (const dir of ['RIGHT', 'LEFT', 'UP', 'DOWN']) {
    const { h, u } = field({ dir, col: 5 });
    const e = h.spawn('dummy', { pos: [10, 5] });
    const take = (type = 'arts') => { u.hp = u.s.maxHp; return h.b.dealDamage(e, u, { amount: 100, type }); };
    approx(take(), 100 * 0.9 * 0.65); // same tile/column belongs to the forward half-plane
    const [dr, dc] = { RIGHT: [0, 1], LEFT: [0, -1], UP: [1, 0], DOWN: [-1, 0] }[dir];
    e.x = 5 - dc; e.y = 10 - dr; approx(take(), 90);
    e.blockedBy = u; u.blocking.push(e); approx(take(), 90 * 0.65);
    e.def = { ...e.def, tags: ['seamonster'] }; approx(take(), 90 * 0.45);
    approx(take('true'), 100); approx(take('elemental'), 100);
    e.blockedBy = null; u.blocking.length = 0; done(h);
  }
});

test('冲蚀 is every fourth attack and fills erosion from actual post-mitigation damage, with no air target', () => {
  for (const elite of [false, true]) {
    const { h, u } = field({ elite }); const e = h.spawn('dummy', { pos: [10, 4] }); h.b.rng = () => 0.99;
    h.run(5);
    const dealt = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isAttack);
    assert.ok(dealt.length >= 4);
    dealt.forEach((c, i) => assert.equal(c.dmg.isSkill, i % 4 === 3));
    const r = hits(h, 'clemnt:rider'); assert.ok(r.length > 0);
    const first = dealt.find((c) => c.dmg.isSkill);
    approx(r[0].amount, first.amount * (elite ? 0.3 : 0.25));
    assert.ok(e.elem.erosion > 0); done(h);
  }
});

test('风暴潮 carries at most eight total weight, excludes flyers/self-bound enemies and releases after three tiles', () => {
  const { h, u } = field({ skill: 1 });
  const es = [0, 1, 2].map(() => h.spawn('light', { pos: [10, 4] }));
  const heavy = h.spawn('heavy', { pos: [10, 4] }), fly = h.spawn('fly', { pos: [10, 4] });
  const bound = h.spawn('zero', { pos: [10, 4] }); h.b.addBuff(bound, { key: 'test:bound', flags: { selfBound: true, noMove: true } });
  start(u); assert.ok(u.s.flags.disarm); h.run(0.7);
  assert.equal(u.mem.clemntCabin.passengers.length, 2);
  assert.equal(u.mem.clemntCabin.mass, 2);
  assert.ok(es[0].s.flags.unblockable && es[0].s.flags.disarm);
  for (const e of [heavy, fly, bound]) assert.ok(!u.mem.clemntCabin.passengers.includes(e));
  h.run(0.9); assert.ok(u.mem.clemntCabin.stopped); approx(u.mem.clemntCabin.x, 6);
  assert.ok(!u.s.flags.disarm); assert.ok(!es[0].s.flags.unblockable);
  approx(es[0].x, 6); done(h);
});

test('风暴潮 caps passengers at fifteen and cleans them on early skill end', () => {
  const { h, u } = field({ skill: 1 });
  for (let n = 0; n < 20; n++) h.spawn('zero', { pos: [10, 4] });
  start(u); h.run(0.4); assert.equal(u.mem.clemntCabin.passengers.length, 15);
  const es = [...u.mem.clemntCabin.passengers]; u.skill.stop();
  assert.ok(es.every((e) => !e.s.flags.disarm && !e.s.flags.unblockable && !e.s.flags.noMove));
  assert.equal(u.mem.clemntCabin, null); done(h);
});

for (const reason of ['death', 'hidden', 'self-bound', 'teleport-immune', 'no-path']) {
  test(`风暴潮 releases ${reason} passengers before admitting a replacement in the same tick`, () => {
    const { h, u } = field({ skill: 1 });
    const victim = h.spawn('light', { pos: [10, 4] });
    const survivor = h.spawn('light', { pos: [10, 4] });
    start(u); h.run(0.7);
    const c = u.mem.clemntCabin, carry = `clemnt:carry:${u.id}`;
    assert.deepEqual(c.passengers.map((e) => e.id), [victim.id, survivor.id]);
    assert.equal(c.mass, 2);
    if (reason === 'death') h.b.dealDamage(u, victim, { amount: 1e12, type: 'true' });
    if (reason === 'hidden') victim.hidden = true;
    if (reason === 'self-bound') h.b.addBuff(victim, { key: 'test:bound', flags: { selfBound: true } });
    if (reason === 'teleport-immune') victim.def = { ...victim.def, immune: new Set(['teleport']) };
    if (reason === 'no-path') {
      victim.x = 7; victim.y = 12;
      for (const [r, col] of [[11, 6], [11, 7], [11, 8], [12, 6], [12, 8]]) h.b.grid.setObstacle(r, col, true);
      assert.equal(h.b.grid.findPath(12, 7, Math.round(c.y), Math.round(c.x)), null);
    }
    const replacement = h.spawn('light', { pos: [c.y, c.x] });
    h.step();
    assert.deepEqual(c.passengers.map((e) => e.id), [survivor.id, replacement.id]);
    assert.equal(c.mass, 2);
    assert.ok(!victim.findBuff(carry));
    assert.ok(replacement.findBuff(carry));
    approx(replacement.x, c.x); approx(survivor.x, c.x);
    h.step(); assert.equal(c.mass, 2, 'released weight is returned only once');
    done(h);
  });
}

for (const [kind, count] of [['zero', 15], ['mid', 1]]) {
  test(`风暴潮 frees the ${kind === 'zero' ? 'fifteenth slot' : 'four-weight budget'} after a passenger dies`, () => {
    const { h, u } = field({ skill: 1 });
    const riders = Array.from({ length: count }, () => h.spawn(kind, { pos: [10, 4] }));
    start(u); h.run(0.7);
    const c = u.mem.clemntCabin;
    assert.equal(c.passengers.length, count);
    h.b.dealDamage(u, riders[0], { amount: 1e12, type: 'true' });
    const replacement = h.spawn(kind, { pos: [c.y, c.x] });
    h.step();
    assert.equal(c.passengers.length, count);
    assert.ok(!c.passengers.includes(riders[0]));
    assert.ok(c.passengers.includes(replacement));
    assert.equal(c.mass, kind === 'zero' ? 8 : 4);
    done(h);
  });
}

test('风暴潮 returns a released passenger’s current weight after a weight modifier', () => {
  const { h, u } = field({ skill: 1 });
  const victim = h.spawn('light', { pos: [10, 4] });
  start(u); h.run(0.7);
  const c = u.mem.clemntCabin;
  assert.equal(c.mass, 5);
  h.b.addBuff(victim, { key: 'test:lighter', mods: { massFlat: -1 }, flags: { selfBound: true } });
  assert.equal(victim.weight, 2);
  h.step();
  assert.equal(c.passengers.length, 0);
  assert.equal(c.mass, 7, 'return current weight 2, not boarding weight 3');
  done(h);
});

test('风暴潮 stops before a blocked tile; vortex keeps its continuous stop point, hits air and applies normal erosion resistance', () => {
  const { h, u } = field({ skill: 1 }); h.b.grid.setObstacle(10, 5, true);
  const fly = h.spawn('fly', { pos: [10, 5.55] });
  fly.def = { ...fly.def, epResistance: 99 };
  start(u); h.run(0.7); assert.ok(u.mem.clemntCabin.stopped);
  approx(u.mem.clemntCabin.x, 4.1); h.run(1.1);
  approx(fly.findBuff(`clemnt:vortex:${u.id}`).mods.moveMul, 0.3); approx(fly.elem.erosion, 10); // damage formula's 5% floor at 99 resistance
  assert.ok(hits(h, 'clemnt:vortex').some((c) => c.target === fly)); done(h);
});

test('风暴潮 normal attack hits five ground enemies in total, never all neighbours or a flyer', () => {
  const { h, u } = field({ skill: 1 }); start(u); h.run(1.6);
  const es = Array.from({ length: 9 }, () => h.spawn('heavy', { pos: [10, 4] }));
  const fly = h.spawn('fly', { pos: [10, 4] });
  const before = h.hooksOf('damaged').length;
  performAttack(h.b, u, effectiveProfile(u), [es[0]]);
  const victims = new Set(h.hooksOf('damaged').slice(before).filter((c) => c.dmg.isAttack).map((c) => c.target));
  assert.equal(victims.size, 5); assert.ok(!victims.has(fly)); done(h);
});

test('与海为敌 normal attacks hit three and spend no ammunition; remote erosion bursts fire three cross-shaped mixed hits', () => {
  const { h, u } = field({ skill: 2 }); start(u); h.b.rng = () => 0.99;
  const close = Array.from({ length: 3 }, () => h.spawn('dummy', { pos: [10, 4] }));
  performAttack(h.b, u, effectiveProfile(u), close);
  assert.equal(u.skill.ammoLeft, 10);
  const remote = h.spawn('dummy', { pos: [11, 9] }), near = h.spawn('dummy', { pos: [12, 9] });
  const diagonal = h.spawn('dummy', { pos: [12, 8] }), fly = h.spawn('fly', { pos: [11, 9] });
  h.b.dealDamage(u, remote, { amount: 1000, type: 'element', element: 'erosion' }); h.step();
  assert.equal(u.skill.ammoLeft, 9); u.skill.stop(); h.run(2.6);
  const bombs = hits(h, 'clemnt:bomb');
  for (const e of [remote, near]) {
    assert.equal(bombs.filter((c) => c.target === e && c.type === 'phys').length, 3);
    assert.equal(bombs.filter((c) => c.target === e && c.type === 'elemental').length, 3);
  }
  assert.ok(!bombs.some((c) => c.target === diagonal || c.target === fly)); done(h);
});

test('与海为敌 selects nearest marked enemy, suppresses duplicate bombing tiles and does not mark air or sleeping units', () => {
  const { h, u } = field({ skill: 2 }); start(u);
  const far = h.spawn('dummy', { pos: [12, 9] }), near = h.spawn('dummy', { pos: [11, 7] });
  const same = h.spawn('dummy', { pos: [11, 7] }), fly = h.spawn('fly', { pos: [11, 8] });
  const asleep = h.spawn('dummy', { pos: [11, 6] }); h.b.applyStatus(asleep, 'sleep', { duration: 5 });
  for (const target of [far, near, same, fly, asleep]) h.b.emit('elementBurst', { source: null, target, element: 'erosion' });
  h.step(); assert.equal(u.skill.ammoLeft, 9); assert.ok(!u.mem.clemntBombs.marks.has(near));
  h.step(); assert.equal(u.skill.ammoLeft, 8); assert.ok(!u.mem.clemntBombs.marks.has(far));
  h.run(1.1); assert.equal(u.skill.ammoLeft, 8); assert.equal(u.mem.clemntBombs.marks.size, 0); done(h);
});
