import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resourceFloat } from '../../public/js/render/resourceNumbers.js';
import { fallbackFloat } from '../../public/js/ui/fallbackField.js';
import { isCosmeticEvent } from '../../public/js/render/interp.js';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

test('official/default modes share only attributed COST and extra SP; master switch hides both', () => {
  const receipts = [
    [['resource', 7, 'cost', 1, 'agent'], 'COST 1', 'cost'],
    [['resource', 7, 'cost', 1, 'charger'], 'COST 1', 'cost'],
    [['resource', 7, 'cost', -3, 'merchant'], 'COST −3', 'costLoss'],
    [['resource', 7, 'sp', 3, 'bond'], 'SP 3', 'sp'],
    [['resource', 7, 'sp', 0.5, 'talent'], 'SP 0.5', 'sp'],
  ];
  for (const [event, text, type] of receipts) for (const officialDamageNumbers of [false, true]) {
    const settings = { damageNumbers: true, officialDamageNumbers };
    const expected = { id: 7, text, type };
    assert.deepEqual(resourceFloat(event, settings), expected);
    assert.deepEqual(fallbackFloat(event, settings), expected);
    assert.equal(resourceFloat(event, { ...settings, damageNumbers: false }), null);
    assert.equal(isCosmeticEvent(event), true);
  }
  const pioneer = ['resource', 7, 'cost', 12, 'pioneer'];
  assert.equal(resourceFloat(pioneer, {}).text, 'COST 12');
  assert.equal(resourceFloat(pioneer, { officialDamageNumbers: true }), null);
  for (const reason of ['time', 'attack', 'hurt', 'init', 'unknown']) assert.equal(resourceFloat(['resource', 7, 'sp', 1, reason], {}), null);
  for (const amount of [0, NaN, Infinity, -1]) assert.equal(resourceFloat(['resource', 7, 'sp', amount, 'talent'], {}), null);
});

test('Pixi renders independent readable labels above the unit and releases them', async () => {
  const fake = installFakePixi();
  try {
    const { FxSystem } = await import('../../public/js/render/fx.js');
    const cam = presetCamera('normal', { width: 1600, height: 900 });
    const settings = { damageNumbers: true, officialDamageNumbers: true };
    const fx = new FxSystem({ ...fakeViewCtx(fake.P), settings, cam: () => cam, loadLevel: () => 0 });
    const view = { id: 7, x: 5, y: 10, z: 0, _headTiles: 1.2 };
    fx.resourceNumber(view, ['resource', 7, 'sp', 3, 'talent']);
    fx.resourceNumber(view, ['resource', 7, 'cost', -3, 'merchant']);
    assert.deepEqual(fx.nums.map((n) => n.text.text), ['SP 3', 'COST −3']);
    assert.ok(fx.nums.every((n) => n.official && n.ox === 0));
    fx.simFx('dp', 5, 10, { id: 7, n: 10 });
    assert.equal(fx.labels.length, 0, 'legacy DP fx never duplicates a receipt or bypasses the master switch');
    settings.damageNumbers = false;
    fx.resourceNumber(view, ['resource', 7, 'sp', 3, 'talent']);
    assert.equal(fx.nums.length, 2);
    fx._updateNums(1);
    assert.equal(fx.nums.length, 0);
  } finally { fake.restore(); }
});
