import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { bondSnapshot } from '../../server/match/bondsMeta.js';
import { buildBattleSpec, createBattleFromSpec, compactResult } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { helperStats, helperOrder } from '../../server/match/unite.js';

const IDS = ['maniShip', 'emptyShip', 'soloShip', 'suntShip'];
const gd = new GameData(DATA, 'mode_multi_normal');
const bonds = () => Object.fromEntries(IDS.map((id) => [id, { count: 2, active: true, tier: 1, layers: 20 }]));

test('hidden-layer bonds retain saved layers, prep gains, pending gains and battle input layers', () => {
  const h = makeMatch({ mode: 'solo', humans: 1, fake: true }).start();
  try {
    h.toPrep(1);
    const ps = h.ps('p_0');
    for (const id of IDS) {
      assert.equal(gd.bond(id).noStack, true, id);
      ps.bondCountBonus[id] = gd.bond(id).thresholds[0];
      ps.layers[id] = 50;
    }
    ps.bondCountBonus.deputShip = 2;
    ps.recompute();
    for (const id of IDS) {
      assert.equal(ps.bonds[id].active, true);
      assert.equal(ps.layers[id], 50, 'recompute must not erase saved layers');
      assert.equal(ps.addLayers(id, 8, { requireActive: true }), 8);
      assert.equal(ps.addLayers(id, 8, { requireActive: false }), 8);
    }
    h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
    for (const id of IDS) assert.equal(ps.layers[id], 68, '助力 prep-end traits can add hidden layers');
    ps.pendingLayerGains = Object.fromEntries(IDS.map((id) => [id, 9]));
    for (const id of IDS) {
      assert.equal(ps.bondsView()[id].layers, 77);
      assert.equal(bondSnapshot(ps.bonds)[id].layers, 68, 'battle input keeps settled layers');
    }
  } finally { h.m.dispose(); }
});

test('hidden-layer gains run through the simulator hooks, event stream and result', () => {
  const spec = buildBattleSpec({ stageId: 'act2autochess_m01', timeLimit: 1, content: 'none',
    players: [{ playerId: 'p_0', units: [], bonds: bonds() }], flags: { layerGainsEnabled: true } });
  const b = createBattleFromSpec(spec, DATA, { quiet: true });
  const calls = [];
  b.on('layerGain', (c) => calls.push(c.bondId));
  for (const id of IDS) {
    assert.equal(b.getPlayer('p_0').bonds[id].layers, 20);
    assert.equal(b.addLayers('p_0', id, 4), 4);
    assert.equal(b.getPlayer('p_0').bonds[id].layers, 24);
  }
  assert.deepEqual(calls, IDS);
  assert.deepEqual(b.drainEvents().filter((e) => e[0] === 'layer').map((e) => e[2]), IDS);
  b.forceEnd();
  assert.deepEqual(b.result().perPlayer.p_0.layerGains, Object.fromEntries(IDS.map((id) => [id, 4])));
});

test('client validation accepts legal hidden-layer gains and still rejects malformed JSON values', () => {
  const spec = buildBattleSpec({ stageId: 'act2autochess_m01', timeLimit: 1, content: 'none',
    players: [{ playerId: 'p_0', units: [], bonds: bonds() }], flags: { layerGainsEnabled: true } });
  const b = createBattleFromSpec(spec, DATA, { quiet: true });
  for (const id of IDS) b.addLayers('p_0', id, 4);
  b.forceEnd();
  const raw = compactResult(b.result());
  assert.equal(validateClientResult(spec, raw, { gd }).ok, true);
  for (const value of [-1, '4', null, {}, 1000]) {
    const forged = structuredClone(b.result());
    forged.perPlayer.p_0.layerGains.soloShip = value;
    assert.equal(validateClientResult(spec, forged, { gd }).ok, false, JSON.stringify(value));
  }
});

test('settlement retains hidden-layer gains from the server result', () => {
  const h = makeMatch({ mode: 'solo', humans: 1, fake: true,
    script: () => ({ layerGains: { p_0: { soloShip: 12, suntShip: 9, yanShip: 3 } } }) }).start();
  try {
    h.toPrep(1);
    h.m.handle('p_0', { t: 'g.ready', ready: true });
    h.toPrep(2);
    assert.equal(h.ps('p_0').layers.soloShip, 12);
    assert.equal(h.ps('p_0').layers.suntShip, 9);
    assert.equal(h.ps('p_0').layers.yanShip, 3);
  } finally { h.m.dispose(); }
});

test('hidden layers contribute to unite pair ordering while inactive layers do not', () => {
  const player = (id, seat, layers) => ({ playerId: id, seat, deployCount: 1, board: new Map(),
    layers: { soloShip: layers, suntShip: 999 }, bonds: {
      soloShip: { active: true, layers }, suntShip: { active: false, layers: 999 },
    } });
  const a = player('p_0', 0, 5), b = player('p_1', 1, 8), m = { gd }, results = new Map();
  assert.equal(helperStats(m, b, results).layers, 8);
  assert.deepEqual(helperOrder(m, [a, b], results).map((p) => p.playerId), ['p_1', 'p_0']);
});
