import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSDK, dir, targeting } from '../../shared/plugins/sdk.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';
import { FORGE_IMPORT_MAP } from '../../server/plugins/forgeKits.js';

test('SDK geometry stays frozen, bounded, identical to engine geometry and closed to live target sorting', () => {
  const sp = createSDK({ id: 'geometry' });
  assert.equal(sp.dir, dir); assert.equal(sp.targeting, targeting);
  assert.ok(Object.isFrozen(dir)); assert.ok(Object.isFrozen(targeting));
  assert.deepEqual(FORGE_IMPORT_MAP['@sim/dir.js'].names, Object.keys(dir));
  assert.deepEqual(FORGE_IMPORT_MAP['@sim/targeting.js'].names, Object.keys(targeting));
  for (const facing of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
    const grid = [[0, 0], [0, 1], [1, 1]], before = JSON.stringify(grid);
    const got = targeting.absoluteRangeKeys(grid, 5, 5, facing, 2);
    assert.deepEqual(got, absoluteRangeKeys(grid, 5, 5, facing, 2));
    assert.ok(Object.isFrozen(got));
    assert.throws(() => got.push(1), TypeError);
    assert.equal(JSON.stringify(grid), before);
  }
  assert.throws(() => targeting.absoluteRangeKeys(Array(1025).fill([0, 0]), 0, 0, 'RIGHT'), RangeError);
  assert.equal(targeting.sortEnemyTargets, undefined);
});
