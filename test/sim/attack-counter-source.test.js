// Native enemy-source injury filters are independent of descriptive counter tags and statistical credit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const kinds = ['bubble', 'hsguma', 'nian', 'yu', 'hsgma2-s1', 'hsgma2-module', 'judge'];
function fixture(kind, flying = false) {
  let entry;
  if (kind === 'judge') entry = { diy: { slot: 6, charId: 'char_4065_judge', skillIndex: 0, uniEquipId: null } };
  else if (kind === 'nian') entry = { diy: { slot: 6, charId: 'char_2014_nian', skillIndex: 1, uniEquipId: null } };
  else if (kind.startsWith('hsgma2')) entry = { elite: true, diy: { slot: 6, charId: 'char_1044_hsgma2',
    skillIndex: kind === 'hsgma2-s1' ? 0 : 1, uniEquipId: kind === 'hsgma2-module' ? 'uniequip_002_hsgma2' : null } };
  else entry = { chessId: { bubble: 'chess_char_2_08_a', hsguma: 'chess_char_4_17_a', yu: 'chess_char_6_03_a' }[kind],
    ...(kind === 'bubble' ? {} : { skillIndex: kind === 'yu' ? 0 : 1 }) };
  const h = makeBattle({ autoFinish: false, units: [{ ...entry, uid: 'receiver', row: 10, col: 4 }],
    defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 1000000, def: 0, res: 0, speed: 0, atk: 0 }),
      enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1000000, def: 0, res: 0, speed: 0, atk: 0, motion: 'FLY' }) } } });
  h.step();
  const b = h.b, unit = h.unit('receiver'), enemy = h.spawn(flying ? 'enemy_fly' : 'enemy_probe', { pos: [10, 8] });
  if (!['hsguma', 'judge'].includes(kind) && !unit.skill.active) assert.ok(unit.skill.activate('test', { free: true }));
  unit.hp = unit.s.maxHp; // Resolve activation stat changes before HP snapshots.
  return { h, b, unit, enemy };
}
function observe(b, unit, enemy, kind) {
  const hits = [];
  b.on(kind === 'yu' ? 'elementHit' : 'hit', c => { if (c.source === unit && c.target === enemy) hits.push(c); });
  return hits;
}
for (const kind of kinds) {
  test(`${kind} native receiver filter accepts sourced BUFF injury regardless of counter/reflect tags`, () => {
    const { b, unit, enemy } = fixture(kind), hits = observe(b, unit, enemy, kind);
    b.addBuff(unit, { key: 'earlier-absorption', shield: 1000000, injuryPriority: 3000 });
    for (const tags of [[], ['counter'], ['reflect']]) {
      const hp = unit.hp, n = hits.length;
      b.dealDamage({ source: enemy, target: unit, amount: 1, type: 'true', attackType: 'BUFF', isAttack: false, tags });
      assert.equal(unit.hp, hp);
      assert.equal(hits.length, n + 1, 'actual enemy source passes even after earlier cancellation');
    }
    assert.deepEqual(b.errors, []);
    checkInvariants(b);
  });
  test(`${kind} native receiver filter rejects source-less credit, HP loss and gauge intake`, () => {
    const { b, unit, enemy } = fixture(kind), hits = observe(b, unit, enemy, kind);
    b.dealDamage({ source: null, credit: enemy, target: unit, amount: 1, type: 'true', tags: ['counter'] });
    b.dealHPLose({ source: enemy, target: unit, amount: 1 });
    b.dealElementDamage({ source: enemy, target: unit, amount: 1, element: 'burn' });
    assert.equal(hits.length, 0);
    assert.deepEqual(b.errors, []);
    checkInvariants(b);
  });
}
for (const kind of ['hsgma2-s1', 'hsgma2-module']) {
  test(`${kind} counter skips source calculation but retains target calculation and output`, () => {
    const { b, unit, enemy } = fixture(kind), hits = observe(b, unit, enemy, kind);
    let sourceCalculations = 0, targetCalculations = 0, outputs = 0;
    b.on('damageCalculate', c => { if (c.source === unit) { sourceCalculations++; c.dmg.amount *= 100; } });
    b.on('damageCalculateTarget', c => { if (c.source === unit) targetCalculations++; });
    b.on('damageOutput', c => { if (c.source === unit) outputs++; });
    b.dealDamage({ source: enemy, target: unit, amount: 1, type: 'true' });
    assert.equal(sourceCalculations, 0);
    assert.equal(targetCalculations, 1);
    assert.equal(outputs, 1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].dmg.calculation, 'precomputed');
    assert.equal(hits[0].dmg.attackType, 'NORMAL');
    assert.equal(hits[0].dmg.applyWay, 'NONE');
    assert.deepEqual(b.errors, []);
  });
}
for (const state of ['ordinary', 'flying', 'stealth', 'untargetable']) {
  test(`Bubble direct S2 reflection and selectable-source talent differ for ${state}`, () => {
    const { b, unit, enemy } = fixture('bubble', state === 'flying'), hits = observe(b, unit, enemy, 'bubble');
    if (state === 'flying') assert.ok(enemy.isFlying);
    if (state === 'stealth' || state === 'untargetable') b.addBuff(enemy, { key: 'selection-probe', flags: { [state]: true } });
    b.dealDamage({ source: enemy, target: unit, amount: 1, type: 'true' });
    assert.equal(hits.length, 1, 'direct reflection does not require normal target selection or attack range');
    assert.equal(!!enemy.findBuff('bubble:spike'), state === 'ordinary', 'native talent verifies selectable source');
    assert.deepEqual(b.errors, []);
    checkInvariants(b);
  });
}
