import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strategyProgressModel } from '../../public/js/ui/strategyProgress.js';

test('Chiave keeps the actual remainder and reward count visible after the round limit', () => {
  const effect = { progress: { current: 3, total: 6 }, roundProgress: { current: 2, total: 2 } };
  assert.deepEqual(strategyProgressModel(effect), {
    badge: '本回合已满', lines: [['主动刷新', '3 / 6'], ['本回合获得', '2 / 2']],
  });
  effect.roundProgress.current = 0;
  assert.equal(strategyProgressModel(effect).badge, '3 / 6');
  assert.equal(strategyProgressModel({ progress: { current: 0, total: 6 } }).badge, '0 / 6');
});

test('missing and malformed counters never display NaN or an unrelated badge', () => {
  for (const effect of [null, {}, { progress: { current: -1, total: 6 } }, { progress: { current: 2, total: 0 } }]) {
    assert.equal(strategyProgressModel(effect), null);
  }
});
