import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

const quiet = { warn() {}, error() {}, info() {} };
function setup(t, bandId = 'band_chiave') {
  const h = makeMatch({ mode: 'solo', seed: 17, fake: true, registry: createRegistry({ log: quiet }) }).start();
  t.after(() => h.m.dispose()); h.toPrep(1);
  const ps = h.ps('p_0'); ps.bandId = bandId; ps.shop.level = 4; ps.funds = 200;
  const effect = () => ps.effectsView().find(e => e.iconKind === 'band');
  const refresh = n => { for (let i = 0; i < n; i++) assert.deepEqual(h.m.handle('p_0', { t: 'g.refresh' }), { ok: true }); };
  return { h, ps, effect, refresh };
}

test('Chiave shows the actual six-refresh cycle and the two-reward round cap', t => {
  const { h, ps, effect, refresh } = setup(t);
  assert.deepEqual(effect().progress, { current: 0, total: 6 });
  refresh(5);
  assert.deepEqual(effect().progress, { current: 5, total: 6 });
  assert.deepEqual(effect().roundProgress, { current: 0, total: 2 });
  refresh(1);
  assert.deepEqual(effect().progress, { current: 0, total: 6 });
  assert.deepEqual(effect().roundProgress, { current: 1, total: 2 });
  refresh(14);
  assert.deepEqual(effect().progress, { current: 2, total: 6 });
  assert.deepEqual(effect().roundProgress, { current: 2, total: 2 });
  const before = { ...ps.counters };
  assert.deepEqual(h.m.prepFieldMeta(ps).effects.find(e => e.id === effect().id), effect());
  assert.deepEqual(ps.battleInput().bandProgress, { progress: effect().progress, roundProgress: effect().roundProgress });
  h.m.round++;
  assert.deepEqual(effect().progress, { current: 2, total: 6 }, 'remainder continues across rounds');
  assert.deepEqual(effect().roundProgress, { current: 0, total: 2 }, 'old lazily-reset rewards are not shown in a new round');
  assert.deepEqual(ps.counters, before, 'reading views never resets the game counters');
  refresh(4);
  assert.deepEqual(effect().roundProgress, { current: 1, total: 2 });
});

test('automatic rolls do not advance Chiave and unrelated strategies have no display counters', t => {
  const { ps, effect, refresh } = setup(t);
  refresh(3); ps.rollShop();
  assert.deepEqual(effect().progress, { current: 3, total: 6 });
  ps.bandId = 'band_bldsk';
  assert.equal(ps.bandProgressView(), null);
  assert.equal(Object.hasOwn(ps.battleInput(), 'bandProgress'), false);
});
