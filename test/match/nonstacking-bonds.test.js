import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds, bondSnapshot } from '../../server/match/bondsMeta.js';
import { buildBattleSpec, createBattleFromSpec, compactResult } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';

const IDS = ['maniShip', 'emptyShip', 'soloShip', 'suntShip'];
const gd = new GameData(DATA, 'mode_multi_normal');

test('non-stacking bonds still activate, but prep gains, stale layers and pending battle gains never add layers', () => {
  const h = makeMatch({ mode: 'solo', humans: 1, fake: true }).start();
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
    assert.equal(ps.bonds[id].active, true, `${id} activates by member count`);
    assert.equal(ps.bonds[id].layers, 0);
    assert.equal(ps.layers[id], undefined, 'stale saved layers are removed');
    assert.equal(ps.addLayers(id, 8, { requireActive: true }), 0);
    assert.equal(ps.addLayers(id, 8, { requireActive: false }), 0);
  }
  h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
  assert.equal(ps.layers.deputShip, 2, '助力 still adds layers to a stacking bond');
  ps.pendingLayerGains = Object.fromEntries(IDS.map((id) => [id, 9]));
  for (const id of IDS) assert.equal(ps.bondsView()[id].layers, 0, 'pending gains never appear in views');
  const s = computeBonds(gd, { board: ps.board, hand: ps.hand, layers: { soloShip: 100 }, bondCountBonus: ps.bondCountBonus });
  assert.equal(bondSnapshot(s).soloShip.layers, 0, 'battle input excludes old layers');
  h.m.dispose();
});

test('server/browser battle simulation blocks non-stacking layer gains before hooks and events', () => {
  const bonds = Object.fromEntries([...IDS, 'yanShip'].map((id) => [id, { count: 3, active: true, tier: 1, layers: 20 }]));
  const spec = buildBattleSpec({ stageId: 'act2autochess_m01', kind: 'normal', timeLimit: 1, content: 'none',
    players: [{ playerId: 'p_0', units: [], bonds }], flags: { layerGainsEnabled: true } });
  const b = createBattleFromSpec(spec, DATA, { quiet: true });
  const calls = [];
  b.on('layerGain', (c) => calls.push(c.bondId));
  for (const id of IDS) {
    assert.equal(b.getPlayer('p_0').bonds[id].layers, 0);
    assert.equal(b.addLayers('p_0', id, 4), 0);
  }
  assert.equal(b.addLayers('p_0', 'yanShip', 4), 4);
  assert.deepEqual(calls, ['yanShip']);
  assert.deepEqual(b.drainEvents().filter((e) => e[0] === 'layer').map((e) => e[2]), ['yanShip']);
  b.forceEnd();
  assert.deepEqual(b.result().perPlayer.p_0.layerGains, { yanShip: 4 });
});

test('client-result validation refuses positive layer gains on non-stacking bonds', () => {
  const bonds = Object.fromEntries(IDS.map((id) => [id, { count: 2, active: true, tier: 1, layers: 0 }]));
  const spec = buildBattleSpec({ stageId: 'act2autochess_m01', kind: 'normal', timeLimit: 1, content: 'none',
    players: [{ playerId: 'p_0', units: [], bonds }], flags: { layerGainsEnabled: true } });
  const b = createBattleFromSpec(spec, DATA, { quiet: true });
  b.forceEnd();
  const raw = compactResult(b.result());
  assert.equal(validateClientResult(spec, raw, { gd }).ok, true);
  for (const id of IDS) {
    const forged = structuredClone(raw);
    forged.perPlayer.p_0.layerGains[id] = 4;
    assert.deepEqual(validateClientResult(spec, forged, { gd }), { ok: false, reason: 'non-stacking bond' });
  }
});

test('settlement ignores non-stacking gains even in a server-run battle result', () => {
  const h = makeMatch({ mode: 'solo', humans: 1, fake: true, script: () => ({ layerGains: { p_0: { soloShip: 12, suntShip: 9, yanShip: 3 } } }) }).start();
  h.toPrep(1);
  h.m.handle('p_0', { t: 'g.ready', ready: true });
  h.toPrep(2);
  assert.equal(h.ps('p_0').layers.soloShip, undefined);
  assert.equal(h.ps('p_0').layers.suntShip, undefined);
  assert.equal(h.ps('p_0').layers.yanShip, 3);
  h.m.dispose();
});
