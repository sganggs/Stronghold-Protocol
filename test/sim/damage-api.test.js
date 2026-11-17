import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../server/sim/attack.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function arena() {
  const h = makeBattle({
    defs: {
      chess: { t_op: chessRec({ id: 't_op', stats: { atk: 100, maxHp: 10000 }, skill: null }) },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 10000, speed: 0, mass: 0 }) },
    },
    units: [{ uid: 1, chessId: 't_op', row: 10, col: 5 }],
    content: 'none', autoFinish: false,
  });
  h.step();
  return { h, b: h.b, u: h.unit(1), e: h.spawn('enemy_dummy', { pos: [10, 8] }) };
}

test('attack API exposes five operations and public helpers while keeping pipeline internals private', () => {
  assert.deepEqual(Object.keys(api).sort(), [
    'dealDamage', 'dealElementDamage', 'dealHPLose', 'heal', 'healElement',
    'hasHp', 'isHpLoss', 'makeDamageInfo', 'periodicDamage', 'damageAttackType', 'damageApplyWay',
    'damageDodgeMode', 'cancelDamage', 'mitigate', 'attackInput', 'burstLocked', 'elementView', 'palsyBuff', 'reserveTransfer',
  ].sort());
});

test('sourced and sourceless entries share target mitigation, shields and hooks; credit grants no attacker multiplier', () => {
  for (const sourceless of [false, true]) {
    const { h, b, u, e } = arena();
    b.addBuff(u, { key: 'out', mods: { dmgDealtMul: 2 } });
    b.addBuff(e, { key: 'in', mods: { dmgTakenMul: 1.5 } });
    b.addBuff(e, { key: 'shield', shield: 30 });
    const seen = [];
    for (const name of ['hit', 'hpDamage', 'damaged']) b.on(name, c => seen.push([name, c.source, c.credit]));
    const damage = b.makeDamage({ amount: 100, type: 'true' });
    damage.customMarker = 'preserved';
    b.on('hit', c => { assert.equal(c.dmg, damage); assert.equal(c.dmg.customMarker, 'preserved'); });
    const before = e.hp;
    const dealt = sourceless ? b.dealDamage(null, e, damage, { credit: u }) : b.dealDamage(u, e, damage);
    assert.equal(dealt, sourceless ? 120 : 270);
    assert.equal(before - e.hp, dealt);
    assert.equal(u.stats.dmg, dealt);
    assert.deepEqual(seen, ['hit', 'hpDamage', 'damaged'].map(name => [name, sourceless ? null : u, u]));
    checkInvariants(h.b);
  }
});

test('sourceless damage retains fatal and kill attribution, while ownerless damage has no credit', () => {
  for (const credited of [false, true]) {
    const { h, b, u, e } = arena();
    const seen = [];
    b.on('fatal', c => seen.push(['fatal', c.source, c.credit]));
    b.on('kill', c => seen.push(['kill', c.killer]));
    e.hp = 10;
    assert.equal(b.dealDamage(null, e, { amount: 50, type: 'true' }, credited ? { credit: u } : {}), 10);
    assert.deepEqual(seen, [['fatal', null, credited ? u : null], ['kill', credited ? u : null]]);
    assert.equal(u.stats.dmg, credited ? 10 : 0);
    checkInvariants(h.b);
  }
});

test('HP loss bypasses damage protection and hurt SP, preserving ancestry, fatal and actual HP accounting', () => {
  const { h, b, u, e } = arena();
  b.addBuff(u, { key: 'shield', shield: 500, flags: { invulnerable: true }, mods: { dodgePhys: 1, dmgTakenMul: 0 } });
  const damageHooks = [];
  for (const name of ['hit', 'hpDamage']) b.on(name, () => damageHooks.push(name));
  let hurt = 0;
  b._skills.onDamaged = () => { hurt++; };
  const from = { sourceless: true, tags: ['transfer'] };
  const before = u.hp;
  let seen;
  b.on('damaged', c => { seen = c; });
  assert.equal(b.dealHPLose(u, 100, { source: e, from, tags: ['transfer', 'shared'] }), 100);
  assert.equal(u.hp, before - 100);
  assert.equal(u.findBuff('shield').shield, 500);
  assert.deepEqual(damageHooks, []);
  assert.equal(hurt, 0);
  assert.equal(seen.source, null);
  assert.equal(seen.credit, e);
  assert.equal(seen.dmg.origin, from);
  assert.deepEqual(seen.dmg.tags, ['hpLoss', 'transfer', 'shared']);
  b.on('fatal', c => { c.prevented = true; u.hp = 1; });
  assert.equal(b.dealHPLose(u, u.hp + 100), before - 101);
  assert.equal(u.alive, true);
  assert.equal(u.hp, 1);
  checkInvariants(h.b);
});

test('element hooks can convert gauge damage to HP damage through the shared pipeline', () => {
  const { h, b, u, e } = arena();
  b.on('elementHit', c => { c.dmg.type = 'true'; });
  assert.equal(b.dealDamage(null, e, { amount: 50, type: 'element', element: 'burn' }, { credit: u }), 50);
  assert.equal(e.elem.burn, 0);
  assert.equal(u.stats.dmg, 50);
  checkInvariants(h.b);
});


test('healElement restores one or all gauges, respects burst lock, and remains independent of HP healing', () => {
  const { h, b, u } = arena();
  b.dealDamage(null, u, { amount: 100, type: 'element', element: 'burn' });
  b.dealDamage(null, u, { amount: 50, type: 'element', element: 'neural' });
  const hp = u.hp;
  assert.equal(b.healElement(u, 40, 'burn'), 40);
  assert.equal(u.elem.burn, 60);
  assert.equal(u.elem.neural, 50);
  assert.equal(b.healElement(u, 100), 110);
  assert.equal(u.hp, hp);
  b.dealDamage(null, u, { amount: u.gaugeMax, type: 'element', element: 'burn' });
  assert.equal(b.healElement(u, 10000), 0);
  checkInvariants(h.b);
});

test('legacy HP-loss and element-recovery aliases remain available for independent content migrations', () => {
  const { b, u } = arena();
  const before = u.hp;
  assert.equal(b.loseHp(u, 10), 10);
  assert.equal(u.hp, before - 10);
  u.elem.burn = 50;
  assert.equal(b.reduceElement(u, 10, 'burn'), 10);
  assert.equal(u.elem.burn, 40);
});

test('both HP-loss forms share one path: `type` selects the mitigation, a positional loss without it stays already mitigated', () => {
  for (const type of ['phys', 'arts', 'true', undefined]) {
    const object = arena(), positional = arena();
    for (const { b, e } of [object, positional]) b.addBuff(e, { key: 'armour', mods: { defFlat: 300 - e.s.def, resFlat: 40 - e.s.res } });
    const lost = object.b.dealHPLose({ source: object.u, target: object.e, amount: 1000, type });
    const lostPositional = positional.b.dealHPLose(positional.e, 1000, { source: positional.u, ...(type ? { type } : {}) });
    assert.equal(lostPositional, lost, String(type));
    assert.equal(lost, type === 'phys' ? 700 : type === 'arts' ? 600 : 1000, String(type));
    for (const { b, u, e } of [object, positional]) {
      assert.equal(e.stats.taken, lost);
      assert.equal(u.stats.dmg, lost);
      assert.deepEqual(b.errors, []);
    }
  }
});

test('Battle settlement entry points report a refused request as an internal error and return 0 instead of throwing', () => {
  const { b, u, e } = arena();
  const hp = e.hp;
  assert.equal(b.dealHPLose({ target: e, amount: 10, type: 'element' }), 0);
  assert.equal(b.dealHPLose(e, 10, { type: 'element' }), 0);
  assert.equal(b.dealElementDamage({ source: u, target: e, amount: 10, element: 'burn', attackType: 'MAGIC' }), 0);
  assert.equal(b.healElement(null), 0);
  assert.equal(b.dealDamage({ source: u, target: e, amount: 10, type: 'element' }), 0);
  assert.equal(b.heal({ source: u, target: u, amount: 10, mode: 'overflow' }), 0);
  assert.equal(e.hp, hp);
  // six refusals (the two HP-loss ones share a message, so the error list records it once)
  assert.equal(b.errorCount, 6);
  assert.deepEqual(b.errors.map(x => x.label), ['internal:dealHPLose', 'internal:dealElementDamage', 'internal:healElement',
    'internal:dealDamage', 'internal:heal']);
});

test('object requests keep sourced damage attribution independent of its attacker', () => {
  const { b, u, e } = arena();
  b.addBuff(e, { key: 'source', mods: { dmgDealtMul: 2 } });
  b.addBuff(u, { key: 'credit', mods: { dmgDealtMul: 7 } });
  let seen;
  b.on('hit', c => { seen = c; });
  assert.equal(b.dealDamage({ source: e, credit: u, target: e, amount: 100, type: 'true' }), 200);
  assert.equal(seen.source, e);
  assert.equal(seen.credit, u);
  assert.equal(u.stats.dmg, 200);
  assert.equal(e.stats.dmg, 0);
});

test('sourceless element damage keeps source null through conversion and burst, while credit survives', () => {
  for (const convert of [false, true]) {
    const { b, u, e } = arena();
    b.addBuff(u, { key: 'credit-multiplier', mods: { dmgDealtMul: 9 } });
    const sources = [];
    b.on('elementHit', c => { sources.push([c.source, c.credit]); if (convert) c.dmg.type = 'true'; });
    b.on('hit', c => sources.push([c.source, c.credit]));
    b.dealElementDamage({ source: null, credit: u, target: e, amount: e.gaugeMax, element: 'burn' });
    assert.ok(sources.length >= 2);
    assert.ok(sources.every(([source, credit]) => source === null && credit === u));
    assert.equal(u.stats.dmg, convert ? e.gaugeMax : 7000);
  }
});

test('typed HP loss calculates physical/arts defence once and distinguishes its source from its credit', () => {
  for (const [type, expected] of [['phys', 700], ['arts', 700], ['true', 1000]]) {
    const { b, u, e } = arena();
    b.addBuff(e, { key: 'defence', mods: { defFlat: 300 - e.s.def, resFlat: 30 - e.s.res, dmgTakenMul: 0.1 }, shield: 10000 });
    let fatal;
    b.on('fatal', c => { fatal = c; c.prevented = true; });
    assert.equal(b.dealHPLose({ source: e, credit: u, target: e, amount: 1000, type }), expected);
    assert.equal(u.stats.dmg, expected);
    assert.equal(e.findBuff('defence').shield, 10000);
    e.hp = 1;
    b.dealHPLose({ source: e, credit: u, target: e, amount: 1000, type });
    assert.equal(fatal.source, e);
    assert.equal(fatal.credit, u);
  }
});

test('dodge mode distinguishes normal cancellation, ignored rolls and uncancellable rolls', () => {
  for (const [mode, draws, events, loss] of [['normal', 1, 1, 0], ['ignore', 0, 0, 100], ['uncancellable', 1, 1, 100]]) {
    const { b, u, e } = arena();
    b.addBuff(e, { key: 'dodge', mods: { dodgePhys: 1, defFlat: -e.s.def } });
    let rolls = 0, attempts = 0;
    b.rng = () => { rolls++; return 0; };
    b.on('dodge', c => { attempts++; assert.equal(c.cancelled, mode !== 'uncancellable'); });
    assert.equal(b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', dodgeMode: mode }), loss);
    assert.deepEqual([rolls, attempts], [draws, events]);
  }
});

test('HP restoration bypasses healing events, multipliers, forbidden healing and overheal shields', () => {
  const { b, u } = arena();
  b.addBuff(u, { key: 'anti-heal', flags: { healFree: true, noHeal: true }, mods: { healingTakenMul: 10, healingDealtMul: 10 } });
  u.hp = u.s.maxHp - 100;
  let heals = 0;
  b.on('heal', () => { heals++; });
  assert.equal(b.heal({ source: u, target: u, amount: 20 }), 0);
  assert.equal(b.heal({ source: u, target: u, amount: 200, mode: 'restore', overheal: true }), 100);
  assert.equal(heals, 0);
  assert.equal(u.stats.heal, 0);
  assert.equal(u.findBuff('overheal'), null);
});

test('resolved damage preserves attacker identity without applying mitigation/source multipliers twice', () => {
  const { b, u, e } = arena();
  b.addBuff(u, { key: 'out', mods: { dmgDealtMul: 9 } });
  b.addBuff(e, { key: 'in', mods: { dmgTakenMul: 1.5, defFlat: 1000 } });
  b.addBuff(e, { key: 'shield', shield: 20 });
  let source;
  b.on('hit', c => { source = c.source; });
  assert.equal(b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', calculation: 'resolved' }), 130);
  assert.equal(source, u);
});

test('calculated-stage modifiers operate on actual pre-barrier damage, not a reverse estimate', () => {
  const { b, u, e } = arena();
  b.addBuff(e, { key: 'def', mods: { defFlat: 100 - e.s.def } });
  b.addBuff(e, { key: 'shield', shield: 10 });
  b.on('damageOutput', c => { assert.equal(c.amount, 200); c.amount -= 50; });
  assert.equal(b.dealDamage({ source: u, target: e, amount: 300, type: 'phys' }), 140);
});

test('new events distinguish HP loss, HP damage and gauge damage without compatibility filters', () => {
  const { b, u, e } = arena();
  const events = [];
  for (const name of ['hpChanged', 'damageApplied', 'elementApplied']) b.on(name, () => events.push(name));
  b.dealHPLose({ source: u, target: e, amount: 1 });
  assert.deepEqual(events.splice(0), ['hpChanged']);
  b.dealDamage({ source: u, target: e, amount: 1, type: 'true' });
  assert.deepEqual(events.splice(0), ['hpChanged', 'damageApplied']);
  b.dealElementDamage({ source: u, target: e, amount: 1, element: 'burn' });
  assert.deepEqual(events.splice(0), ['elementApplied']);
});

for (const mode of ['heal', 'regen', 'restore']) test(`${mode} reports HP changes only when HP increases, independently of heal modifiers`, () => {
  const { b, u } = arena();
  u.hp = u.s.maxHp;
  const changes = [], applied = [];
  b.on('hpChanged', c => changes.push(c));
  b.on('modifierApplied', c => applied.push(c));
  assert.equal(b.heal({ source: u, target: u, amount: 100, mode, overheal: true }), 0);
  assert.equal(changes.length, 0);
  assert.equal(applied.length, mode === 'heal' ? 1 : 0);
  assert.equal(!!u.findBuff('overheal'), mode !== 'restore', 'zero HP increase does not suppress eligible overheal');
  u.hp -= 10;
  assert.equal(b.heal({ source: u, target: u, amount: 100, mode }), 10);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, mode);
  assert.equal(changes[0].delta, 10);
  assert.deepEqual(b.errors, []);
});

test('a source-less gauge fill keeps no source while its credit counts it (v0.3.1 showed the filler as the source)', () => {
  const { b, u, e } = arena();
  let source;
  b.on('elementHit', c => { source = c.source; });
  api.dealElementDamage(b, { source: null, credit: u, target: e, amount: 10, element: 'burn' });
  assert.equal(source, null);
  assert.equal(u.stats.elem, 10);
});

test('credit controls the shared-pool player tally while the source remains independent', () => {
  const { b, u, e } = arena();
  const calls = [];
  e.bossPool = { hp: 10000, maxHp: 10000, damage(pid, amount) { calls.push([pid, amount]); this.hp -= amount; } };
  assert.equal(b.dealDamage({ source: e, credit: u, target: e, amount: 100, type: 'true' }), 100);
  assert.deepEqual(calls, [[u.ownerId, 100]]);
  assert.equal(b._pp(u.ownerId).bossDamage, 100);
});

test('legacy missing arguments never reinterpret a unit with an AI target as a request object', () => {
  const { b, u, e } = arena();
  u.target = e;
  let hit = 0;
  b.on('hit', () => hit++);
  const hp = e.hp;
  assert.equal(b.dealDamage(u, undefined, { amount: 100, type: 'true' }), 0);
  assert.equal(hit, 0);
  assert.equal(e.hp, hp);
  assert.equal(b.heal(u, undefined, 100), 0);
  assert.equal(b.dealHPLose(u, undefined), 0);
  assert.equal(b.healElement(u, undefined), 0);
});


for (const calculation of ['base', 'precomputed', 'resolved']) {
  test(`${calculation} damage keeps source calculation, target calculation and output as distinct stages`, () => {
    const { b, u, e } = arena();
    b.addBuff(e, { key: 'def', mods: { defFlat: 100 - e.s.def } });
    b.addBuff(u, { key: 'out', mods: { dmgDealtMul: 2 } });
    const stages = [];
    b.on('damageCalculate', c => { stages.push('source'); c.dmg.amount += 100; });
    b.on('damageCalculateTarget', c => { stages.push('target'); c.dmg.amount += 10; });
    b.on('damageOutput', c => { stages.push('output'); assert.equal(c.amount, calculation === 'base' ? 620 : calculation === 'precomputed' ? 420 : 300); });
    assert.equal(b.dealDamage({ source: u, target: e, amount: 300, type: 'phys', calculation }),
      calculation === 'base' ? 620 : calculation === 'precomputed' ? 420 : 300);
    assert.deepEqual(stages, calculation === 'base' ? ['source', 'target', 'output'] : calculation === 'precomputed' ? ['target', 'output'] : ['output']);
  });
}

test('source-less base damage has target calculation and output but no source calculation event', () => {
  const { b, e } = arena(), stages = [];
  for (const name of ['damageCalculate', 'damageCalculateTarget', 'damageOutput']) b.on(name, () => stages.push(name));
  b.dealDamage({ target: e, amount: 10, type: 'true' });
  assert.deepEqual(stages, ['damageCalculateTarget', 'damageOutput']);
});
