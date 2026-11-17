import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function setup() {
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 10000, speed: 0 }) } },
    enemies: [{ key: 'enemy_probe', pos: [10, 8] }] });
  h.step();
  return { h, b: h.b, unit: h.enemy('enemy_probe') };
}

test('buff removal remains valid when a finish callback removes an earlier barrier', () => {
  const { h, b, unit } = setup();
  let removed = 0;
  b.addBuff(unit, { key: 'barrier', shield: 100, onRemove() { removed++; } });
  b.addBuff(unit, { key: 'pending', onRemove() { b.removeBuff(unit, 'barrier'); } });
  assert.equal(b.removeBuff(unit, 'pending'), 1);
  assert.equal(removed, 1);
  assert.equal(unit.findBuff('pending'), null);
  assert.equal(unit.findBuff('barrier'), null);
  assert.deepEqual(b.errors, []);
  checkInvariants(h.b);
});

test('nested removal invokes each selected buff at most once', () => {
  const { b, unit } = setup();
  const removed = [];
  b.addBuff(unit, { key: 'same', refresh: 'independent', maxStacks: 2, onRemove() { removed.push(1); } });
  b.addBuff(unit, { key: 'same', refresh: 'independent', maxStacks: 2, onRemove() { removed.push(2); b.removeBuff(unit, 'same'); } });
  assert.equal(b.removeBuff(unit, 'same'), 1, 'nested removal owns the other direct removal');
  assert.deepEqual(removed, [2, 1]);
  assert.equal(unit.findBuff('same'), null);
  assert.deepEqual(b.errors, []);
});

test('a replacement acquired during removal survives the original selection', () => {
  const { b, unit } = setup();
  let replacement;
  b.addBuff(unit, { key: 'replace', onRemove() { replacement = b.addBuff(unit, { key: 'replace', shield: 50 }); } });
  assert.equal(b.removeBuff(unit, 'replace'), 1);
  assert.equal(unit.findBuff('replace'), replacement);
  assert.equal(replacement.shield, 50);
  assert.deepEqual(b.errors, []);
});
