import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

function setup() {
  const h = makeBattle({
    defs: { enemies: { enemy_test: enemyRec({ key: 'enemy_test', hp: 1e6, atk: 100, def: 1000, speed: 0 }) } },
    enemies: [{ key: 'enemy_test', pos: [11, 8] }], content: 'none', autoFinish: false,
  });
  h.step();
  return { h, e: h.enemy('enemy_test') };
}

const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);

for (const plain of [false, true]) {
  for (const order of orders) {
    test(`${plain ? 'applyStrongest' : 'fragile'}: three effects expire in strength order after application order ${order}`, () => {
      const { h, e } = setup();
      const effects = [{ value: 0.8, duration: 2 }, { value: 0.6, duration: 5 }, { value: 0.3, duration: 10 }];
      const key = plain ? 'test:strongest' : 'fragile';
      for (const i of order) {
        if (plain) h.b.applyStrongest(e, key, { ...effects[i], mods: (v) => ({ dmgTakenMul: 1 + v }) });
        else h.b.applyStatus(e, key, effects[i]);
      }
      for (const [elapsed, multiplier, damage] of [[0, 1.8, 180], [2.1, 1.6, 160], [3, 1.3, 130], [5, 1, 100]]) {
        if (elapsed) h.run(elapsed);
        approx(e.s.dmgTakenMul, multiplier);
        assert.equal(h.b.dealDamage(null, e, { amount: 100, type: 'true' }), damage);
        assert.equal(e.buffs.filter((b) => b.key === key).length, multiplier === 1 ? 0 : 1);
      }
      assert.deepEqual(h.b.errors, []);
    });
  }
}

test('strongest statuses: a weaker effect that expires under the winner never resumes', () => {
  const { h, e } = setup();
  h.b.applyStatus(e, 'fragile', { value: 0.6, duration: 3 });
  h.b.applyStatus(e, 'fragile', { value: 0.3, duration: 10 });
  h.b.applyStatus(e, 'fragile', { value: 0.8, duration: 5 });
  h.run(5.1);
  approx(e.s.dmgTakenMul, 1.3);
  h.run(5);
  assert.equal(e.findBuff('fragile'), null);
});

test('strongest statuses: equal-strength refresh skips expired fallbacks but keeps the later one', () => {
  const { h, e } = setup();
  for (const [value, duration] of [[0.8, 2], [0.6, 5], [0.3, 10]]) h.b.applyStatus(e, 'fragile', { value, duration });
  h.run(1);
  h.b.applyStatus(e, 'fragile', { value: 0.8, duration: 6 });
  h.b.applyStatus(e, 'fragile', { value: 0.8, duration: 1 });
  h.run(5.1);
  approx(e.s.dmgTakenMul, 1.8);
  h.run(1);
  approx(e.s.dmgTakenMul, 1.3);
  h.run(3);
  assert.equal(e.findBuff('fragile'), null);
});

test('strongest statuses: refreshing a waiting effect preserves the weaker later fallback', () => {
  const { h, e } = setup();
  for (const [value, duration] of [[0.8, 2], [0.6, 5], [0.3, 10]]) h.b.applyStatus(e, 'fragile', { value, duration });
  h.run(1);
  h.b.applyStatus(e, 'fragile', { value: 0.6, duration: 6 });
  h.run(4.1);
  approx(e.s.dmgTakenMul, 1.6);
  h.run(2);
  approx(e.s.dmgTakenMul, 1.3);
  h.run(3);
  assert.equal(e.findBuff('fragile'), null);
});

test('strongest statuses: stackAs controls every fallback without changing its actual effect', () => {
  const { h, e } = setup();
  h.b.applyStatus(e, 'weaken', { value: 0.1, stackAs: 0.9, duration: 2 });
  h.b.applyStatus(e, 'weaken', { value: 0.2, stackAs: 0.8, duration: 5 });
  h.b.applyStatus(e, 'weaken', { value: 0.3, duration: 10 });
  approx(e.s.atk, 90);
  h.run(2.1);
  approx(e.s.atk, 80);
  h.run(3);
  approx(e.s.atk, 70);
  h.run(5);
  approx(e.s.atk, 100);
});

test('strongest statuses: equal-priority waiting effects keep the longest-lived application value', () => {
  const { h, e } = setup();
  h.b.applyStatus(e, 'weaken', { value: 0.9, duration: 2 });
  h.b.applyStatus(e, 'weaken', { value: 0.1, stackAs: 0.8, duration: 5 });
  h.b.applyStatus(e, 'weaken', { value: 0.3, duration: 10 });
  h.b.applyStatus(e, 'weaken', { value: 0.2, stackAs: 0.8, duration: 7 });
  h.b.applyStatus(e, 'weaken', { value: 0.4, stackAs: 0.8, duration: 6 });
  h.b.applyStatus(e, 'weaken', { value: 0.5, stackAs: 0.8, duration: 7 });
  h.run(2.1);
  approx(e.s.atk, 80);
  h.run(3);
  approx(e.s.atk, 80);
  h.run(2);
  approx(e.s.atk, 70);
  h.run(3);
  approx(e.s.atk, 100);
});

for (const plain of [false, true]) {
  test(`${plain ? 'removeBuff' : 'removeStatus'} discards every waiting strongest effect`, () => {
    const { h, e } = setup();
    const key = plain ? 'test:strongest' : 'fragile';
    for (const [value, duration] of [[0.8, 2], [0.6, 5], [0.3, 10]]) {
      if (plain) h.b.applyStrongest(e, key, { value, duration, mods: (v) => ({ dmgTakenMul: 1 + v }) });
      else h.b.applyStatus(e, key, { value, duration });
    }
    assert.equal(plain ? h.b.removeBuff(e, key) : h.b.removeStatus(e, key), 1);
    h.b.applyStatus(e, 'fragile', { value: 0.1, duration: 1 });
    h.run(2.1);
    approx(e.s.dmgTakenMul, 1);
    h.run(8);
    approx(e.s.dmgTakenMul, 1);
    assert.equal(e.findBuff(key), null);
    assert.deepEqual(h.b.errors, []);
  });
}
