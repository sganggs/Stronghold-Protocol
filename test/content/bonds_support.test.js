// Shared wave-B helpers (server/sim/content/support): bond membership (own bonds, 变形同构体 grants, 调和 enjoying
// active core bonds), live bond state, IN_BATTLE layer gains (requireActive, per-battle caps, disabled fields) and the
// prep→battle `contentInfo` written by the global meta handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import {
  unitBonds, isMember, bondMembers, bondTier, bondLayers, gainLayers, layersUsed, contentInfo, topActiveBond,
  itemKeyOf, buffParams, bondRecord, isCoreBond, frontTile, alliesAround, N4,
} from '../../server/sim/content/support/index.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { makeMatch, give } from '../match/harness.js';
import { FakeBattle } from '../match/fakeBattle.js';

const guard = (id, bonds, extra = {}) => chessRec({ id, bonds, profession: 'WARRIOR', skill: null, ...extra });

test('support: data helpers', () => {
  assert.equal(itemKeyOf('chess_item_1_01_e_b'), 'chess_item_1_01_e');
  assert.equal(itemKeyOf('chess_item_6_02_m'), 'chess_item_6_02_m');
  assert.ok(isCoreBond('yanShip') && !isCoreBond('preciShip'));
  const p = buffParams(bondRecord('yanShip'), 'act1autochess_bond_eff_yan');
  assert.equal(p.base_atk, 0.23);
  assert.equal(p.atk_per_stack, 0.009);
});

test('support: membership — own bonds, 变形同构体 grants, 调和 enjoys active core bonds only', () => {
  const h = makeBattle({
    defs: { chess: {
      t_yan_a: guard('t_yan_a', ['yanShip']),
      t_mani_a: guard('t_mani_a', ['maniShip']),
      t_none_a: guard('t_none_a', ['preciShip']),
    } },
    units: [
      { chessId: 't_yan_a', row: 10, col: 3 },
      { chessId: 't_mani_a', row: 10, col: 4 },
      // 变形同构体 + 维式重锤 → also 维多利亚
      { chessId: 't_none_a', row: 10, col: 5, items: ['chess_item_6_09_e_a', 'chess_item_1_01_e_a'] },
    ],
    bonds: {
      yanShip: { count: 3, active: true, tier: 1, layers: 10 },
      maniShip: { count: 1, active: true, tier: 1, layers: 0 },
      victoriaShip: { count: 1, active: false, tier: 0, layers: 4 },
      preciShip: { count: 1, active: false, tier: 0, layers: 0 },
    },
  });
  h.step();
  const yan = h.unit('t_yan_a'), mani = h.unit('t_mani_a'), none = h.unit('t_none_a');
  assert.deepEqual([...unitBonds(none)].sort(), ['preciShip', 'victoriaShip']);
  assert.ok(isMember(h.b, yan, 'yanShip'));
  assert.ok(isMember(h.b, mani, 'yanShip'), '调和 enjoys a core bond');
  assert.ok(!isMember(h.b, mani, 'preciShip'), '调和 does not enjoy add-on bonds');
  assert.ok(isMember(h.b, none, 'victoriaShip'), '变形同构体 grant');
  assert.deepEqual(bondMembers(h.b, 'p1', 'yanShip').map((u) => u.defId).sort(), ['t_mani_a', 't_yan_a']);
  assert.equal(bondTier(h.b, 'p1', 'yanShip'), 1);
  assert.equal(bondTier(h.b, 'p1', 'victoriaShip'), 0);
  assert.equal(topActiveBond(h.b, 'p1'), 'yanShip');
  assert.deepEqual(frontTile(yan), [10, 4]);
  assert.deepEqual(alliesAround(h.b, mani, N4).map((u) => u.defId).sort(), ['t_none_a', 't_yan_a']);
  checkInvariants(h.b);
});

test('support: gainLayers — requireActive, per-battle caps, live layers, recorded in the result', () => {
  const h = makeBattle({
    defs: { chess: { t_a: guard('t_a', ['yanShip']) } },
    units: [{ chessId: 't_a', row: 10, col: 3 }],
    bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 0 }, preciShip: { count: 0, active: false, tier: 0, layers: 0 } },
  });
  h.step();
  const u = h.unit('t_a');
  assert.equal(gainLayers(h.b, { playerId: 'p1', bonds: ['yanShip', 'preciShip'], n: 4, source: u, reason: 'garrison' }), 4, 'inactive 精准 skipped');
  assert.equal(gainLayers(h.b, { playerId: 'p1', bonds: 'preciShip', n: 4, requireActive: false }), 4, '无需激活');
  for (let i = 0; i < 5; i++) gainLayers(h.b, { playerId: 'p1', bonds: 'yanShip', n: 4, cap: 12, capKey: 'g1' });
  assert.equal(layersUsed(h.b, 'g1', 'yanShip'), 12);
  assert.equal(bondLayers(h.b, 'p1', 'yanShip'), 16, 'live layers');
  h.b.forceEnd('forced');
  assert.deepEqual(h.result().perPlayer.p1.layerGains, { yanShip: 16, preciShip: 4 });
});

test('support: gainLayers never pays a bond whose effect does not scale with layers (owner decision, DESIGN §24.3)', () => {
  const h = makeBattle({
    defs: { chess: { t_a: guard('t_a', ['yanShip']) } },
    units: [{ chessId: 't_a', row: 10, col: 3 }],
    bonds: {
      yanShip: { count: 3, active: true, tier: 1, layers: 0 },
      soloShip: { count: 1, active: true, tier: 1, layers: 0 },   // noStack: 独行
      maniShip: { count: 1, active: true, tier: 1, layers: 0 },   // noStack: 调和
    },
  });
  h.step();
  assert.equal(gainLayers(h.b, { playerId: 'p1', bonds: ['yanShip', 'soloShip', 'maniShip'], n: 4, requireActive: false }), 4, 'only 炎 takes them');
  assert.equal(bondLayers(h.b, 'p1', 'soloShip'), 0);
  assert.equal(bondLayers(h.b, 'p1', 'maniShip'), 0);
  h.b.forceEnd('forced');
  assert.deepEqual(h.result().perPlayer.p1.layerGains, { yanShip: 4 }, 'the noStack bonds are not even reported');
});

test('support: gainLayers is a no-op when layer gains are disabled (联防 / boss)', () => {
  const h = makeBattle({
    defs: { chess: { t_a: guard('t_a', ['yanShip']) } },
    units: [{ chessId: 't_a', row: 10, col: 3 }],
    bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 0 } },
    flags: { layerGainsEnabled: false },
  });
  h.step();
  assert.equal(gainLayers(h.b, { playerId: 'p1', bonds: 'yanShip', n: 5 }), 0);
  assert.equal(bondLayers(h.b, 'p1', 'yanShip'), 0);
});

test('support meta: global:contentb_info writes contentInfo into every battle input', () => {
  const reg = createRegistry();
  assert.ok(reg.has('global:contentb_info'));
  const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 11, registry: reg, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  give(h.m, ps, 'chess_char_1_01_a', 'hand');
  h.drive(() => FakeBattle.instances.length > 0, { ready: true });
  const fb = FakeBattle.instances.find((b) => b.players.includes('p_0'));
  assert.ok(fb, 'battle built');
  const inp = fb.opts.players.find((p) => p.playerId === 'p_0');
  const ci = inp.contentInfo;
  assert.ok(ci && ci.round === 1 && ci.kind === 'normal');
  assert.ok(ci.handChess >= 1 && ci.handUnits >= ci.handChess);
  assert.equal(ci.matchBands.length, 2);
  assert.equal(ci.teammates.length, 1);
  assert.equal(typeof ci.roundStats.gainedChess, 'number');
  h.m.dispose();
});

test('support: contentInfo() is {} without meta input (plain harness battle)', () => {
  const h = makeBattle({ units: [] });
  assert.deepEqual(contentInfo(h.b, 'p1'), {});
});
