import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mitigate } from '../../server/sim/attack.js';

test('fixed penetration is subtracted before percentage penetration, for both DEF and RES', () => {
  // The wrong order clamps effective DEF to zero; the native order leaves 17.5.
  assert.equal(mitigate(100, 'phys', { def: 120 }, { defIgnoreFlat: 95, defIgnorePct: 0.3 }), 82.5);
  assert.equal(mitigate(100, 'arts', { res: 80 }, { resIgnoreFlat: 20, resIgnorePct: 0.5 }), 70);
  assert.equal(mitigate(100, 'phys', { def: 120 }, { defIgnoreFlat: 150, defIgnorePct: 0.3 }), 100);
});
