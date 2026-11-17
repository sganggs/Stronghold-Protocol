// Native buff_template_data at ArknightsGameResource 9bf2396 + PRTS: separate injury, gauge applying and output success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';

function fixture(kind) {
  const ids = { philae: ['chess_char_3_06_a', 1], rmixer: ['chess_char_4_01_a', 2], yu: ['chess_char_6_03_a', 2] };
  const [chessId, skillIndex] = ids[kind];
  const h = makeBattle({ autoFinish: false, units: [{ uid: 'defender', chessId, skillIndex, row: 10, col: 5 }],
    defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, def: 0, res: 20, speed: 0, atk: 0 }) } } });
  h.step();
  const b = h.b, u = h.unit('defender'), e = h.spawn('enemy_probe', { pos: [10, 5.2] });
  if (kind !== 'yu') assert.ok(u.skill.activate('test', { free: true }));
  u.hp = u.s.maxHp;
  return { h, b, u, e };
}

for (const kind of ['philae', 'rmixer']) for (const defence of ['dodge', 'block', 'barrier']) {
  test(`${kind} native ON_TAKE_DAMAGE counter observes earlier ${defence} and keeps its cooldown`, () => {
    const { h, b, u, e } = fixture(kind);
    b.rng = () => 0;
    b.addBuff(u, { key: 'earlier', injuryPriority: 3000,
      ...(defence === 'dodge' ? { mods: { dodgePhys: 1 } } : defence === 'barrier' ? { shield: 100000 } : { injury(c) { c.block(); } }) });
    let answers = 0;
    if (kind === 'philae') b.on('hit', c => { if (c.source === u && c.dmg.tags?.includes('counter')) answers++; });
    const priorAttacks = u.stats.attacks;
    const answerCount = () => kind === 'rmixer' ? u.stats.attacks - priorAttacks : answers;
    const hp = u.hp, ammo = u.skill.ammoLeft;
    b.dealDamage({ source: e, target: u, amount: 100, type: 'phys' });
    assert.equal(u.hp, hp);
    if (kind === 'philae') h.run(0.1);
    assert.equal(answerCount(), 1);
    b.dealDamage({ source: e, target: u, amount: 100, type: 'phys' });
    assert.equal(answerCount(), 1);
    if (kind === 'rmixer') assert.equal(u.skill.ammoLeft, ammo - 1);
    b.dealHPLose({ source: e, target: u, amount: 1 });
    b.dealElementDamage({ source: e, target: u, amount: 1, element: 'burn' });
    assert.equal(answerCount(), 1);
    u.skill.end('test');
    assert.equal(u.findBuff(`${kind}:counter`), null);
    checkInvariants(b);
    assert.equal(b.errors.length, 0);
  });
}

test('Philae rage is an applying-gauge effect, even for zero or a later fully blocked gauge', () => {
  for (const amount of [0, 10]) {
    const { b, u, e } = fixture('philae');
    b.on('elementHit', c => { if (c.target === u) c.dmg.cancel = true; }, { priority: -2000 });
    const atk = u.s.atk;
    assert.equal(b.dealElementDamage({ source: e, target: u, amount, element: 'burn' }), 0);
    assert.ok(u.findBuff('skill:philae_rage'));
    assert.ok(u.s.atk > atk);
    assert.equal(u.elem.burn, 0);
    u.skill.end('test');
    assert.equal(u.findBuff('skill:philae_rage'), null);
  }
});

test('Philae blast is normally dodgeable; its separate gauge rider still applies', () => {
  const { h, b, u, e } = fixture('philae');
  b.rng = () => 0;
  b.addBuff(e, { key: 'arts-dodge', mods: { dodgeArts: 1 } });
  const hp = e.hp;
  b.dealDamage({ target: u, amount: 1, type: 'true' });
  h.run(0.1);
  assert.equal(e.hp, hp);
  assert.ok(e.elem.apoptosis > 0);
});

test('Rmixer can counter source-less injury without a target; gauges/loss do not spend ammo', () => {
  const { b, u, e } = fixture('rmixer');
  b.kill(e);
  const ammo = u.skill.ammoLeft;
  b.addBuff(u, { key: 'block', injury(c) { c.block(); } });
  b.dealElementDamage({ target: u, amount: 1, element: 'burn' });
  b.dealHPLose({ target: u, amount: 1 });
  assert.equal(u.skill.ammoLeft, ammo);
  b.dealDamage({ target: u, amount: 1, type: 'true' });
  assert.equal(u.skill.ammoLeft, ammo - 1);
  assert.equal(u.mem.inCounter, false);
  assert.equal(u.findBuff('rmixer:t1'), null, 'no successful damage was dealt');
});

test('Yu talent gauge bursts before its arts DoT, so the same pulse uses the lowered RES', () => {
  const { h, b, u, e } = fixture('yu');
  assert.ok(h.runUntil(() => u.blocking.includes(e), 0.5));
  e.elem.burn = e.gaugeMax - 1;
  const trace = [], arts = [];
  b.on('elementHit', c => { if (c.source === u && c.target === e && c.dmg.tags?.includes('talent')) trace.push('gauge'); });
  b.on('hit', c => {
    if (c.target !== e) return;
    if (c.dmg.tags?.includes('burst')) trace.push('burst');
    if (c.source === u && c.dmg.type === 'arts' && c.dmg.tags?.includes('talent')) {
      trace.push('arts');
      assert.equal(e.s.res, 0);
      assert.equal(c.dmg.applyWay, 'MELEE');
      assert.ok(c.dmg.tags.includes('dot'));
    }
  });
  b.on('damageApplied', c => { if (c.source === u && c.target === e && c.dmg.type === 'arts' && c.dmg.tags?.includes('talent')) arts.push(c); });
  assert.ok(h.runUntil(() => arts.length > 0, 1.5));
  assert.deepEqual(trace.slice(0, 3), ['gauge', 'burst', 'arts']);
  assert.ok(Math.abs(arts[0].amount - arts[0].dmg.amount) < 1e-6);
  checkInvariants(b);
});

for (const actor of ['operator', 'enemy']) {
  test(`native ${actor} apoptosis periodic damage is marked noSp; immediate burn damage is not`, () => {
    const { h, b, u, e } = fixture('yu');
    const target = actor === 'operator' ? u : e, ticks = [];
    b.on('damageApplied', c => { if (c.target === target && c.dmg.tags?.includes('burst')) ticks.push(c.dmg); });
    b.dealElementDamage({ target, element: 'apoptosis', amount: target.gaugeMax });
    h.run(1.1);
    assert.ok(ticks.length > 0);
    assert.ok(ticks.every(d => d.noSp && d.tags.includes('dot')));
    b.removeBuff(target, 'apoptosisBurst');
    ticks.length = 0;
    b.dealElementDamage({ target, element: 'burn', amount: target.gaugeMax });
    assert.equal(ticks.length, 1);
    assert.equal(ticks[0].noSp, false);
  });
}


test('Logos source calculation marks a base attack, target calculation affects precomputed arts, and resolved damage skips both', () => {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 'logos', diy: { slot: 6, charId: 'char_4133_logos', skillIndex: 0 }, row: 10, col: 5 }],
    defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, def: 0, res: 0, speed: 0, atk: 0 }) } } });
  h.step();
  const b = h.b, u = h.unit('logos'), e = h.spawn('enemy_probe', { pos: [10, 8] });
  b.dealDamage({ source: u, target: e, amount: 100, type: 'arts', isAttack: true, calculation: 'precomputed' });
  assert.equal(e.findBuff('logos:soulRend'), null, 'a precomputed input must not acquire the source-calculation mark');
  assert.equal(b.dealDamage({ source: u, target: e, amount: 100, type: 'arts' }), 265);
  assert.ok(e.findBuff('logos:soulRend'));
  assert.equal(b.dealDamage({ source: null, target: e, amount: 100, type: 'arts', calculation: 'precomputed' }), 265);
  assert.equal(b.dealDamage({ source: u, target: e, amount: 100, type: 'arts', calculation: 'resolved' }), 100,
    'post-calculation input must not receive a second pre-mitigation addition');
  checkInvariants(b);
});

test('weakness and actual calculation share Logos target addition, without speculative calculation hooks or double scaling', () => {
  const weak = { ...chessRec({ id: 'weak', stats: { atk: 100 }, skill: null }), garrisonIds: ['garrison_01_a'] };
  const h = makeBattle({ autoFinish: false, units: [
    { uid: 'weak', chessId: 'weak', row: 10, col: 4 },
    { uid: 'logos', diy: { slot: 6, charId: 'char_4133_logos', skillIndex: 0 }, row: 10, col: 5 }],
    defs: { chess: { weak }, enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, def: 25, res: 80, atk: 0, speed: 0 }) } } });
  h.step();
  const b = h.b, u = h.unit('weak'), logos = h.unit('logos'), e = h.spawn('enemy_probe', { pos: [10, 8] });
  b.dealDamage({ source: logos, target: e, amount: 1, type: 'true' });
  assert.equal(e.s.artsAttackAddition, 165);
  assert.equal(e.s.res, 70);
  let sourceCalculations = 0, targetCalculations = 0;
  const output = [];
  b.on('damageCalculate', c => { if (c.source === u) sourceCalculations++; });
  b.on('damageCalculateTarget', c => { if (c.source === u) targetCalculations++; });
  b.on('damageOutput', c => { if (c.source === u) output.push([c.dmg.type, c.dmg.amount]); });
  // Physical 100-25=75; arts (100+165)*0.3=79.5. Actual calculation adds 165 exactly once.
  assert.ok(Math.abs(b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' }) - 79.5) < 1e-9);
  assert.deepEqual(output, [['arts', 265]]);
  assert.equal(sourceCalculations, 1);
  assert.equal(targetCalculations, 1);
  assert.ok(Math.abs(b.dealDamage({ target: e, amount: 0, type: 'arts', calculation: 'precomputed' }) - 49.5) < 1e-9);
  assert.equal(b.dealDamage({ target: e, amount: 100, type: 'arts', calculation: 'resolved' }), 100);
  b.removeBuff(e, 'logos:soulRend');
  assert.equal(e.s.artsAttackAddition, 0);
  assert.equal(b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' }), 75);
  assert.deepEqual(output[1], ['phys', 100]);
  checkInvariants(b);
  assert.deepEqual(b.errors, []);
});

for (const calculation of ['base', 'precomputed', 'resolved']) test(`source before-apply phase follows ${calculation} output and precedes injury`, () => {
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', skill: null }) },
      enemies: { target: enemyRec({ key: 'target', hp: 100000, def: 300, atk: 0, speed: 0 }) } },
    units: [{ chessId: 'probe', row: 10, col: 5 }] });
  h.step();
  const b = h.b, u = h.unit('probe'), e = h.spawn('target', { pos: [10, 7] }), order = [];
  for (const event of ['damageCalculate', 'damageCalculateTarget', 'damageOutput', 'damageApplied']) b.on(event, () => order.push(event));
  b.on('damageBeforeApply', c => {
    order.push('beforeApply');
    assert.equal(c.amount, calculation === 'resolved' ? 1000 : 700);
    b.addBuff(e, { key: 'lateDEF', mods: { defFlat: -100 } });
    c.amount += 1;
  });
  b.addBuff(e, { key: 'injury', observeInjury() { order.push('injury'); assert.equal(e.s.def, 200); } });
  assert.equal(b.dealDamage({ source: u, target: e, amount: 1000, type: 'phys', calculation }), calculation === 'resolved' ? 1001 : 701);
  assert.deepEqual(order, [...(calculation === 'base' ? ['damageCalculate'] : []),
    ...(calculation !== 'resolved' ? ['damageCalculateTarget'] : []), 'damageOutput', 'beforeApply', 'injury', 'damageApplied']);
  checkInvariants(b);
  assert.deepEqual(b.errors, []);
});

test('before-apply cancellation preserves target defenses and suppresses success', () => {
  const { b, u, e } = fixture('yu');
  b.addBuff(e, { key: 'shield', shieldHits: 1 });
  let applied = 0;
  b.on('damageBeforeApply', c => { if (c.source === u) c.dmg.cancel = true; });
  b.on('damageApplied', () => { applied++; });
  assert.equal(b.dealDamage({ source: u, target: e, amount: 100, type: 'true' }), 0);
  assert.equal(e.findBuff('shield').shieldHits, 1);
  assert.equal(applied, 0);
  assert.deepEqual(b.errors, []);
});
