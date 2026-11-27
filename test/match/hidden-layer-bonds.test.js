// 规程 excludes noStack layer balances; all four covenant versions retain their hidden counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give } from './harness.js';
import { getVersionData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { bondSnapshot, bondsWithGains } from '../../server/match/bondsMeta.js';
import { buildBattleSpec, createBattleFromSpec, compactResult } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { helperStats, helperOrder } from '../../server/match/unite.js';
import { applyTempLayers, commitBattleLayerGains } from '../../server/match/match/common.js';
import { topActiveBond } from '../../server/sim/content/support/index.js';
import { topActiveBondMeta } from '../../server/sim/content/garrisons/meta.js';
import { DataSource } from '../../server/sim/simdata.js';
import { acquireLayers } from '../../server/match/bot.js';

const QUIET = { warn() {}, error() {}, info() {} };
const RAW = getVersionData('act3autochess@V3_1', { log: QUIET });
const VERSIONS = [DATA, ...['act1autochess@V1_1', 'act1autochess', 'act2autochess@V2_1', 'act3autochess@V3_1']
  .map((id) => getVersionData(id, { log: QUIET }))];
const idsOf = (raw) => Object.keys(raw.bonds).filter((id) => raw.bonds[id].noStack);
const state = (layers = 0) => ({ count: 2, active: true, tier: 1, layers });
const specOf = (raw = RAW, kind = 'normal') => buildBattleSpec({ kind, stageId: 'act3autochess_m01', timeLimit: 1,
  content: 'none', players: [{ playerId: 'p_0', units: [], bonds: {
    ...Object.fromEntries(idsOf(raw).map((id) => [id, state(20)])), yanShip: state(10),
  }, ...(kind === 'unite' ? { tempLayers: { soloShip: 50, yanShip: 3 } } : {}) }],
  flags: { layerGainsEnabled: kind !== 'unite' } });

test('version family: 规程 removes stale noStack balances; four covenant versions retain prep gains and views', () => {
  for (const raw of VERSIONS) {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, data: raw, fake: true }).start();
    try {
      h.toPrep(1, { band: raw.bands.band_bldsk ? 'band_bldsk' : 'band_amiya' });
      const ps = h.ps('p_0'), ids = idsOf(raw);
      ps.bandId = null;
      ps.pendingLayerGains = {};
      ps.tempLayers = {};
      for (const id of [...ids, 'yanShip', 'deputShip']) {
        ps.bondCountBonus[id] = ps.gd.bond(id).thresholds[0];
        ps.layers[id] = 50;
        ps.pendingLayerGains[id] = 9;
        ps.tempLayers[id] = 7;
      }
      ps.recompute();
      if (raw.config.version?.family !== 'regulation') {
        for (const id of ids) {
          assert.equal(ps.layers[id], 50, id);
          assert.equal(ps.pendingLayerGains[id], 9, id);
          assert.equal(ps.tempLayers[id], 7, id);
          assert.equal(ps.addLayers(id, 8, { requireActive: true }), 8, id);
          assert.equal(ps.addLayers(id, 8, { requireActive: false }), 8, id);
          assert.equal(ps.bondsView()[id].layers, 75, id);
        }
        continue;
      }
      for (const id of ids) {
        assert.equal(ps.bonds[id].active, true, id);
        assert.equal(ps.layers[id], undefined, id);
        assert.equal(ps.pendingLayerGains[id], undefined, id);
        assert.equal(ps.tempLayers[id], undefined, id);
        assert.equal(ps.addLayers(id, 8, { requireActive: true }), 0, id);
        assert.equal(ps.addLayers(id, 8, { requireActive: false }), 0, id);
      }
      assert.equal(ps.layers.yanShip, 50);
      assert.equal(ps.bondsView().yanShip.layers, 59);
      h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
      for (const id of ids) {
        assert.equal(ps.layers[id], undefined, id);
        assert.equal(ps.bondsView()[id].layers, 0, id);
        assert.equal(bondSnapshot(ps.bonds)[id].layers, 0, id);
      }
      assert.ok(ps.layers.yanShip > 50, '助力 still grants useful layers');
      assert.equal(h.sent.some(([, msg]) => msg.t === 'm.layer' && ids.includes(msg.bondId)), false);
    } finally { h.m.dispose(); }
  }
});

test('version family and four battle kinds: 规程 excludes noStack gains; covenant keeps them', () => {
  for (const raw of VERSIONS) for (const kind of ['normal', 'boss', 'hidden', 'unite']) {
    const b = createBattleFromSpec(specOf(raw, kind), raw, { quiet: true });
    if (raw.config.version?.family !== 'regulation') {
      for (const id of idsOf(raw)) {
        assert.equal(b.getPlayer('p_0').bonds[id].layers, 20, id);
        assert.equal(b.addLayers('p_0', id, 4), kind === 'unite' ? 0 : 4, id);
        assert.equal(b.addTempLayers('p_0', id, 4), kind === 'unite' ? 0 : 4, id);
        assert.ok(b.effectiveBondLayers('p_0', id) >= 20, id);
      }
      if (kind === 'unite') assert.equal(b.tempLayers('p_0', 'soloShip'), 50);
      b.forceEnd();
      if (kind !== 'unite') for (const id of idsOf(raw)) {
        assert.equal(b.result().perPlayer.p_0.layerGains[id], 4, id);
        assert.equal(b.result().perPlayer.p_0.tempLayerGains[id], 4, id);
      }
      continue;
    }
    const calls = [];
    for (const hook of ['layerGain', 'bondLayersChanged', 'tempLayerGain', 'tempLayerChange']) b.on(hook, (ev) => calls.push(ev.bondId));
    for (const id of idsOf(raw)) {
      assert.equal(b.getPlayer('p_0').bonds[id].layers, 0, `${kind} ${id}`);
      assert.equal(b.addLayers('p_0', id, 4), 0, id);
      assert.equal(b.addTempLayers('p_0', id, 4), 0, id);
      assert.equal(b.effectiveBondLayers('p_0', id), 0, id);
    }
    assert.equal(b.tempLayers('p_0', 'soloShip'), 0);
    if (kind === 'unite') assert.equal(b.tempLayers('p_0', 'yanShip'), 3);
    assert.deepEqual(calls, []);
    assert.equal(b.drainEvents().some((e) => e[0] === 'layer'), false);
    b.forceEnd();
    assert.deepEqual(b.result().perPlayer.p_0.layerGains, {});
    assert.equal(b.result().perPlayer.p_0.tempLayerGains, undefined);
  }
});

test('client validation rejects positive noStack permanent and temporary reports', () => {
  const gd = new GameData(RAW, 'mode_multi_hard'), spec = specOf();
  const b = createBattleFromSpec(spec, RAW, { quiet: true });
  b.forceEnd();
  const raw = compactResult(b.result());
  assert.equal(validateClientResult(spec, raw, { gd }).ok, true);
  for (const key of ['layerGains', 'tempLayerGains']) for (const id of idsOf(RAW)) {
    const forged = structuredClone(raw);
    forged.perPlayer.p_0[key] = { [id]: 4 };
    assert.equal(validateClientResult(spec, forged, { gd }).ok, false, `${key} ${id}`);
  }
});

test('settlement and pending views cannot restore noStack layers from a stale result', () => {
  const gd = new GameData(RAW, 'mode_multi_hard');
  const gains = { soloShip: 12, emptyShip: 9, yanShip: 3 }, ps = { layers: {} }, events = [];
  commitBattleLayerGains(gd, ps, gains, (_ps, _event, ev) => events.push(ev.bondId));
  assert.deepEqual(ps.layers, { yanShip: 3 });
  assert.deepEqual(events, ['yanShip']);
  applyTempLayers(gd, ps, { tempLayerGains: gains });
  assert.deepEqual(ps.tempLayers, { yanShip: 3 });
  const bonds = { soloShip: state(), yanShip: state(10) };
  assert.deepEqual(bondsWithGains(bonds, gains, gd), { soloShip: state(), yanShip: state(13) });
});

test('noStack bonds stay active for counts but contribute zero to helper layer ranking', () => {
  const gd = new GameData(RAW, 'mode_multi_hard');
  const player = (id, seat, hidden, real) => ({ playerId: id, seat, deployCount: 1, board: new Map(),
    layers: { soloShip: hidden, yanShip: real }, pendingLayerGains: { soloShip: 100 },
    bonds: { soloShip: state(hidden), yanShip: state(real) } });
  const a = player('p_0', 0, 999, 5), b = player('p_1', 1, 0, 8), m = { gd }, results = new Map();
  assert.equal(helperStats(m, a, results).layers, 5);
  assert.deepEqual(helperOrder(m, [a, b], results).map((p) => p.playerId), ['p_1', 'p_0']);
  a.bonds.yanShip.active = false;
  assert.equal(helperStats(m, a, results).active, true, '独行 still counts as an active bond');
});

test('highest-layer selection uses the battle content set, including plugin overrides and fallback data', () => {
  const bonds = { ...RAW.bonds, soloShip: { ...RAW.bonds.soloShip, noStack: false },
    yanShip: { ...RAW.bonds.yanShip, noStack: true } };
  const gd = new GameData({ ...RAW, bonds }, 'mode_multi_hard');
  const ctx = { gd, bondActive: (id) => ['soloShip', 'yanShip'].includes(id), layers: (id) => id === 'yanShip' ? 100 : 0 };
  assert.equal(topActiveBondMeta(ctx), 'soloShip');
  const b = createBattleFromSpec(specOf(), new DataSource({}, new DataSource({ ...RAW, bonds })), { quiet: true });
  b.getPlayer('p_0').bonds = { soloShip: state(), yanShip: state(100) };
  assert.equal(topActiveBond(b, 'p_0'), 'soloShip');
  assert.equal(b.addLayers('p_0', 'soloShip', 2), 2);
  assert.equal(b.addLayers('p_0', 'yanShip', 2), 0);
  b.getPlayer('p_0').bonds.soloShip.active = false;
  assert.equal(topActiveBond(b, 'p_0'), null);
});

test('highest-layer and adjacent-bond garrisons skip 独行 and still grow stacking bonds', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, data: RAW, fake: true }).start();
  try {
    h.toPrep(1, { band: 'band_amiya' });
    const ps = h.ps('p_0');
    ps.bandId = null;
    const star = RAW.chess.chess_char_2_23_a;
    give(h.m, ps, star.chessId);
    ps.bondCountBonus.soloShip = 1;
    ps.recompute();
    h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
    assert.equal(ps.layers.soloShip, undefined);
    ps.bondCountBonus.preciShip = 2;
    ps.recompute();
    h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
    assert.equal(ps.layers.preciShip, 2, 'newly active 精准 receives 星源’s +2');
    assert.equal(ps.layers.soloShip, undefined);
    // 渡桥 adds to its own and the front operator's activated bonds. 地灵 carries 独行.
    const bridge = Object.values(RAW.chess).find((c) => c.name === '渡桥' && !c.isGolden);
    ps.bondCountBonus.visiShip = 2;
    ps.bondCountBonus.soloShip = 0;
    ps.recompute();
    give(h.m, ps, bridge.chessId, 'board', [10, 4]);
    const solo = Object.values(ps.gd.raw.chess).find((c) => c.name === '地灵' && !c.isGolden);
    assert.ok(solo.bonds.includes('soloShip'), 'front operator really carries 独行 in the match data');
    const front = give(h.m, ps, solo.chessId, 'board', [10, 5]);
    assert.ok(ps.gd.chess(front.id).bonds.includes('soloShip'));
    assert.equal(ps.bonds.soloShip.active, true);
    h.m.dispatch(ps, 'onPrepEnd', { round: 1 });
    assert.equal(ps.layers.soloShip, undefined);
    assert.equal(ps.layers.visiShip, 2);
  } finally { h.m.dispose(); }
});

test('plugin noStack metadata survives DataSource overlays and rejects both kinds of layer gain', () => {
  const raw = { ...RAW, bonds: { ...RAW.bonds, plugin_no_layers: { noStack: true } } };
  const source = new DataSource({}, new DataSource(raw));
  const spec = buildBattleSpec({ kind: 'normal', stageId: 'act3autochess_m01', timeLimit: 1, content: 'none',
    players: [{ playerId: 'p_0', units: [], bonds: { plugin_no_layers: state(20) } }] });
  const b = createBattleFromSpec(spec, source, { quiet: true });
  assert.equal(b.getPlayer('p_0').bonds.plugin_no_layers.layers, 0);
  assert.equal(b.addLayers('p_0', 'plugin_no_layers', 4), 0);
  assert.equal(b.addTempLayers('p_0', 'plugin_no_layers', 4), 0);
  assert.equal(raw.bonds.plugin_no_layers.noStack, true);
});

test('covenant results, settlement and helper ranking preserve hidden counts in all four versions', () => {
  for (const raw of VERSIONS.filter((d) => d.config.version?.family !== 'regulation')) {
    const gd = new GameData(raw, 'mode_multi_hard'), id = idsOf(raw)[0];
    const spec = specOf(raw), b = createBattleFromSpec(spec, raw, { quiet: true });
    assert.equal(b.addLayers('p_0', id, 4), 4);
    assert.equal(b.addTempLayers('p_0', id, 3), 3);
    b.forceEnd();
    const report = compactResult(b.result());
    assert.equal(validateClientResult(spec, report, { gd }).ok, true);
    const ps = { layers: {} };
    commitBattleLayerGains(gd, ps, report.perPlayer.p_0.layerGains, () => {});
    applyTempLayers(gd, ps, report.perPlayer.p_0);
    assert.equal(ps.layers[id], 4);
    assert.equal(ps.tempLayers[id], 3);
    assert.equal(bondsWithGains({ [id]: state(20) }, { [id]: 4 }, gd)[id].layers, 24);
    const player = { playerId: 'p_0', deployCount: 1, board: new Map(),
      layers: { [id]: 20 }, bonds: { [id]: state(20) } };
    assert.equal(helperStats({ gd }, player, new Map()).layers, 20);
  }
});

test('bot acquisition estimates follow the version family for own bonds and highest-layer grants', () => {
  for (const raw of VERSIONS) {
    const id = idsOf(raw)[0];
    const gd = new GameData({ ...raw, garrisons: { ...raw.garrisons,
      all: { eventType: 'SERVER_GAIN', effectKey: 'SERVER_ADD_BOND_CHESS_ALL', bb: { count: 2 } },
      most: { eventType: 'SERVER_GAIN', effectKey: 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER', bb: { count: 3 } },
    } }, 'mode_multi_hard');
    const regulation = raw.config.version?.family === 'regulation';
    const ps = { gd, layers: { [id]: 99, yanShip: 0 }, bonds: { [id]: state(99), yanShip: state() } };
    assert.deepEqual([...acquireLayers({ gd }, ps, { bonds: [id, 'yanShip'], garrisonIds: ['all'] })],
      regulation ? [['yanShip', 2]] : [[id, 2], ['yanShip', 2]]);
    assert.deepEqual([...acquireLayers({ gd }, ps, { garrisonIds: ['most'] })],
      [[regulation ? 'yanShip' : id, 3]]);
  }
});
