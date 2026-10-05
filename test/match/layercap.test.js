// Bond layer cap (user report after playtest #6, DESIGN §20.10 / §20.12): a bond holds at most BOND_LAYER_CAP — 999, the
// client's AutoChessBattleConst.MAX_GARRISON_STACK (research 11 §1; the community also never names a count above 999:
// 巴哈姆特 12534 "每把都能999层", 12316 "999謝"). v2.5 had no cap, so per-layer bonuses kept growing past anything the
// official game reaches. Prep-side gains (PlayerState.addLayers: items, choices, bands, garrisons) and the IN_BATTLE gains
// merged at settlement both stop there (shared/constants.js layerGainRoom, the one implementation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, BOND_LAYER_CAP } from '../../shared/constants.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';

test('prep-side layer gains stop at 999; a gain at the cap adds nothing and fires no onLayers', () => {
  assert.equal(BOND_LAYER_CAP, 999);
  const reg = registerBuiltins(new MetaRegistry(), DATA);
  const seen = [];
  reg.global('watch', { onLayers: (ctx, ev) => { seen.push([ev.bondId, ev.from, ev.to]); } });
  const h = makeMatch({ mode: 'solo', seed: 81, registry: reg, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.layers.yanShip = 990;
  assert.equal(ps.addLayers('yanShip', 20, { reason: 'test' }), 9, 'only the room left under the cap');
  assert.equal(ps.layers.yanShip, 999);
  assert.equal(ps.addLayers('yanShip', 5, { reason: 'test' }), 0, 'at the cap: nothing');
  assert.equal(ps.layers.yanShip, 999);
  assert.deepEqual(seen, [['yanShip', 990, 999]], 'one onLayers, with the clamped value');
  assert.equal(ps.addLayers('sargonShip', 40, { reason: 'test' }), 40, 'other bonds unaffected');
  checkInvariants(h.m);
  h.m.dispose();
});

test('IN_BATTLE gains merged at settlement skip a bond whose effect does not scale with layers (DESIGN §24.3)', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 83, fake: true,
    script: (b) => (b.round === 1 ? { layerGains: { p_0: { yanShip: 50, soloShip: 50, maniShip: 50 } } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const a = h.ps('p_0');
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(a.layers.yanShip, 50, '炎 keeps its gains');
  assert.equal(a.layers.soloShip ?? 0, 0, '独行 takes nothing (owner decision, deviation from the record)');
  assert.equal(a.layers.maniShip ?? 0, 0, '调和 too');
  checkInvariants(m);
  m.dispose();
});

test('IN_BATTLE gains merged at settlement stop at 999 too; below the cap they apply in full', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 82, fake: true,
    script: (b) => (b.round === 1 ? { layerGains: { p_0: { yanShip: 50 }, p_1: { yanShip: 50 } } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const [a, b] = [h.ps('p_0'), h.ps('p_1')];
  a.layers.yanShip = 980;
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(a.layers.yanShip, 999, '980 + 50 stops at 999');
  assert.equal(b.layers.yanShip, 50);
  checkInvariants(m);
  m.dispose();
});
