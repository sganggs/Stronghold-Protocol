// 规程 Final Assault / Hidden Core keep permanent IN_BATTLE layer gains. 联防 and the covenant versions do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { getVersionData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossLayerGainsEnabled } from '../../server/match/finalAssault.js';
import { commitBattleLayerGains } from '../../server/match/match/common.js';
import { validateClientResult } from '../../server/match/fields.js';
import { buildBattleSpec } from '../../server/sim/spec.js';
import { Battle } from '../../server/sim/Battle.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { DATA, makeMatch, give, legalTileFor } from './harness.js';
import { FakeBattle } from './fakeBattle.js';

const QUIET = { warn() {}, error() {}, info() {} };
const RAW = getVersionData('act3autochess@V3_1', { log: QUIET });
const VERSIONS = ['act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1'];

function bondLayers(m, pid, bondId) {
  const row = m.publicView().players.find((p) => p.playerId === pid);
  const bond = row && row.bonds.find((b) => b.bondId === bondId);
  return bond ? bond.layers : 0;
}

function bossSpec(flags) {
  return buildBattleSpec({
    battleId: 'boss-layers', fieldId: 'b1', kind: 'boss', round: 14, stageId: 's', timeLimit: 120,
    players: [{ playerId: 'p', units: [], bonds: { yanShip: { layers: 10, count: 3, active: true, tier: 1 } } }],
    spawns: [], flags,
  });
}

const reported = {
  reason: 'cleared', time: 10,
  perPlayer: { p: { killed: 0, total: 0, leaked: [], perfect: true, layerGains: { yanShip: 3 }, coins: 0, unitsEnd: [] } },
};

test('only the regulation profile enables boss and hidden layer gains', () => {
  assert.equal(RAW.config.finalAssault.layerGainsEnabled, true);
  assert.equal(RAW.config.unite.layerGainsEnabled, false);
  assert.equal(bossLayerGainsEnabled(new GameData(RAW, 'mode_multi_hard')), true);
  assert.equal(DATA.config.finalAssault.layerGainsEnabled, false);
  assert.equal(bossLayerGainsEnabled(new GameData(DATA, 'mode_multi_funny')), false);
  for (const id of VERSIONS) {
    const data = getVersionData(id, { log: QUIET });
    assert.equal(data.config.finalAssault.layerGainsEnabled, false, id);
    assert.equal(data.config.unite.layerGainsEnabled, false, id);
  }
});

test('commitBattleLayerGains clamps at 999 and drops an unknown bond', () => {
  const gd = new GameData(RAW, 'mode_multi_hard');
  const ps = { layers: { yanShip: 998 } };
  const events = [];
  commitBattleLayerGains(gd, ps, { yanShip: 5, notARealBond: 4, arcaneShip: 0 }, (p, ev, ctx) => events.push([ev, ctx]));
  assert.equal(ps.layers.yanShip, 999);
  assert.equal(ps.layers.notARealBond, undefined);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'onLayers');
  assert.equal(events[0][1].reason, 'battle');
  assert.equal(events[0][1].from, 998);
  assert.equal(events[0][1].to, 999);
});

test('a live boss battle raises permanent layers when the flag is on, and not when it is off', () => {
  const bonds = { yanShip: { layers: 10, count: 3, active: true, tier: 1 } };
  const on = makeBattle({ kind: 'boss', content: 'none', bonds, flags: { layerGainsEnabled: true }, autoFinish: false });
  assert.equal(on.b.addLayers('p1', 'yanShip', 4, 'garrison'), 4);
  assert.equal(on.b.getPlayer('p1').bonds.yanShip.layers, 14);
  assert.equal(on.b.addTempLayers('p1', 'yanShip', 2), 2);
  assert.equal(on.b.tempLayers('p1', 'yanShip'), 2);
  on.b.forceEnd('cleared');
  assert.equal(on.b.result().perPlayer.p1.layerGains.yanShip, 4);
  const off = makeBattle({ kind: 'boss', content: 'none', bonds, flags: { layerGainsEnabled: false }, autoFinish: false });
  assert.equal(off.b.addLayers('p1', 'yanShip', 4, 'garrison'), 0);
  assert.equal(off.b.getPlayer('p1').bonds.yanShip.layers, 10);
  assert.equal(off.b.addTempLayers('p1', 'yanShip', 2), 2, 'temporary layers stay enabled on a covenant boss field');
  const hidden = makeBattle({ kind: 'hidden', content: 'none', bonds, flags: { layerGainsEnabled: true }, autoFinish: false });
  assert.equal(hidden.b.addLayers('p1', 'yanShip', 6, 'talent'), 6);
  assert.equal(hidden.b.getPlayer('p1').bonds.yanShip.layers, 16);
});

test('a client report is accepted on a regulation boss field and rejected when the flag is off', () => {
  const gd = new GameData(RAW, 'mode_multi_hard');
  const yes = bossSpec({ layerGainsEnabled: true });
  assert.equal(validateClientResult(yes, reported, { gd }).ok, true);
  const hidden = buildBattleSpec({ ...yes, kind: 'hidden' });
  assert.equal(validateClientResult(hidden, reported, { gd }).ok, true);
  const no = bossSpec({ layerGainsEnabled: false });
  assert.equal(validateClientResult(no, reported, { gd }).reason, 'layers disabled');
  const unite = buildBattleSpec({ ...yes, kind: 'unite', flags: { layerGainsEnabled: false } });
  assert.equal(validateClientResult(unite, reported, { gd }).reason, 'layers disabled');
  const forged = JSON.parse(JSON.stringify(reported));
  forged.perPlayer.p.layerGains = { notARealBond: 3 };
  assert.equal(validateClientResult(yes, forged, { gd }).reason, 'bond');
});

test('regulation R14 keeps both players\' gains into the R15 prep; R15 keeps its own; 联防 stays off', () => {
  const settled = [];
  const h = makeMatch({
    mode: 'coop', difficulty: 'HARD', humans: 2, seed: 83, fake: true, data: RAW,
    script: (b) => {
      if (b.kind === 'normal' && b.round === 1) return { leaks: { p_0: 1 } };
      if (b.kind === 'unite') return { duration: 1 };
      if (b.kind === 'boss' || b.kind === 'hidden') {
        const hidden = b.kind === 'hidden';
        return {
          bossDps: 1e9,
          layerGains: {
            p_0: hidden ? { yanShip: 4 } : { yanShip: 5, swiftShip: 7, notARealBond: 9 },
            p_1: hidden ? { arcaneShip: 2 } : { arcaneShip: 5 },
          },
          tempLayerGains: hidden ? {} : { p_0: { ursusShip: 6 } },
        };
      }
      return {};
    },
  }).start();
  const m = h.m;
  const orig = m.dispatch.bind(m);
  m.dispatch = (ps, ev, ctx) => {
    if (ev === 'onBattleResult' && ctx && ctx.boss) {
      settled.push({ pid: ps.playerId, round: m.round, layers: { ...ps.layers }, temp: ps.tempLayers ? { ...ps.tempLayers } : null });
    }
    return orig(ps, ev, ctx);
  };
  try {
    h.drive(() => m.phase === PHASE.UNITE, { band: 'band_sarkazb' });
    const unite = FakeBattle.instances.filter((b) => b.kind === 'unite');
    assert.equal(unite.length, 1);
    assert.equal(unite[0].opts.flags.layerGainsEnabled, false);
    h.drive(() => m.phase === PHASE.PREP && m.round === 14, { band: 'band_sarkazb' });
    for (const p of m.order) {
      for (const piece of [...p.board.values(), ...p.hand.filter(Boolean), ...p.temp.filter(Boolean)]) {
        if (piece.kind === 'chess') p.returnCopies(piece);
      }
      p.board.clear();
      p.hand.fill(null);
      p.temp.fill(null);
      p.layers = { yanShip: 700, swiftShip: 998 };
      p.bondCountBonus.yanShip = 20;
      p.bondCountBonus.swiftShip = 20;
      p.bondCountBonus.arcaneShip = 20;
      p.lp = Math.max(20, p.lp);
      p.recompute();
    }
    const prepSum = m.alivePlayers().reduce((s, p) => s + p.activatedLayers(), 0);
    assert.ok(prepSum > 1200);
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT, { band: 'band_sarkazb' });
    const fields = FakeBattle.instances.filter((b) => b.kind === 'boss' && b.round === 14);
    assert.equal(fields.length, 1, 'two players share one boss field');
    assert.equal(fields[0].opts.flags.layerGainsEnabled, true);
    assert.deepEqual(fields[0].opts.players.map((p) => p.playerId).sort(), ['p_0', 'p_1']);
    assert.equal(m.hiddenLayerSum, prepSum, 'in-battle gains do not rewrite hidden-core eligibility');
    // The field is still running here. Settle snapshots land when the runner finishes.
    h.drive(() => m.phase === PHASE.PREP && m.round === 15, { band: 'band_sarkazb' });
    const r14 = (pid) => settled.find((s) => s.pid === pid && s.round === 14);
    assert.equal(r14('p_0').layers.yanShip, 705);
    assert.equal(r14('p_0').layers.swiftShip, 999);
    assert.equal(r14('p_0').layers.notARealBond, undefined);
    assert.deepEqual(r14('p_0').temp, { ursusShip: 6 });
    assert.equal(r14('p_1').layers.yanShip, 700);
    assert.equal(r14('p_1').layers.swiftShip, 998);
    assert.equal(r14('p_1').layers.arcaneShip, 5);
    assert.equal(r14('p_1').temp, null);
    assert.equal(m.hiddenLayerSum, prepSum);
    assert.ok(h.ps('p_0').layers.yanShip >= 705);
    assert.equal(h.ps('p_0').layers.swiftShip, 999);
    assert.equal(h.ps('p_1').layers.arcaneShip, 5);
    assert.equal(bondLayers(m, 'p_0', 'yanShip'), h.ps('p_0').layers.yanShip);
    assert.equal(bondLayers(m, 'p_1', 'arcaneShip'), 5);
    assert.equal(h.ps('p_0').tempLayers, undefined, 'the temp ledger is not merged into the permanent count');
    const atPrep = h.ps('p_0').layers.yanShip;
    h.drive(() => m.phase === PHASE.HIDDEN_CORE, { band: 'band_sarkazb' });
    const hiddenFields = FakeBattle.instances.filter((b) => b.kind === 'hidden');
    assert.equal(hiddenFields.length, 1);
    assert.equal(hiddenFields[0].opts.flags.layerGainsEnabled, true);
    // Settle runs when the hidden field ends, still on round 15, before RESULT.
    h.drive(() => settled.some((s) => s.round === 15) || h.ended != null, { band: 'band_sarkazb' });
    const r15 = (pid) => settled.find((s) => s.pid === pid && s.round === 15);
    assert.ok(r15('p_0').layers.yanShip >= atPrep + 4);
    assert.equal(r15('p_1').layers.arcaneShip, h.ps('p_1').layers.arcaneShip);
    assert.ok(r15('p_1').layers.arcaneShip >= 7);
    const end = h.ended || h.runToEnd();
    assert.equal(end.victory, true);
    assert.equal(end.hiddenReached, true);
    assert.ok(h.ps('p_0').layers.yanShip >= atPrep + 4);
    assert.ok(h.ps('p_1').layers.arcaneShip >= 7);
    assert.equal(h.ps('p_0').layers.swiftShip, 999);
  } finally {
    m.dispose();
  }
});

// GitHub #991 (reported on 0.4.0, whose boss fields always ran with layerGainsEnabled false): the reported case end to end
// on the real engine. 霍尔海雅's elite 规程 trait garrison_101_b 「每次开启技能时使自身已激活的盟约层数+8（每场战斗至多叠加
// 24层）」 on the right half of the R14 pair field, server-run and client-run (the production default) combat alike: the
// live copy rises during the fight (what the bond strip and the layer readers see) and the gain is kept after it.
const HEYAK = 'chess_char_4_18_b';

test('#991: 霍尔海雅\'s skill-start layers count on a real regulation R14 pair field, server and client combat', () => {
  // a version's match host runs on that version's data; garrison records are read from the process singleton
  setGameData(RAW);
  try {
    for (const clientCombat of [false, true]) {
      const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, seed: 991, fake: true, data: RAW, clientCombat }).start();
      const m = h.m;
      try {
        h.drive(() => m.phase === PHASE.PREP && m.round === 14, { band: 'band_sarkazb' });
        const ps = h.ps('p_1');
        for (const piece of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) {
          if (piece.kind === 'chess') ps.returnCopies(piece);
        }
        ps.board.clear();
        ps.hand.fill(null);
        ps.temp.fill(null);
        ps.layers = { preciShip: 170, arcaneShip: 100 };
        ps.bondCountBonus.preciShip = 20;
        ps.bondCountBonus.arcaneShip = 20;
        ps.lp = Math.max(30, ps.lp);
        ps.recompute();
        give(m, ps, HEYAK, 'board', legalTileFor(m, ps, HEYAK));
        assert.deepEqual(RAW.chess[HEYAK].bonds, ['arcaneShip', 'preciShip']);
        assert.deepEqual(RAW.chess[HEYAK].garrisonIds, ['garrison_101_b']);
        // The real engine for the boss round only. Her skill (32 SP) is ready at each deployment: the leader knocks her out
        // long before it charges, and the trait is about the skill start, not the charge.
        const fields = [];
        class RealBattle extends Battle {
          constructor(...args) {
            super(...args);
            if (this.kind !== 'boss') return;
            const live = [];
            fields.push({ battle: this, live });
            this.on('deploy', ({ unit }) => { if (unit.def?.raw?.chessId === HEYAK && unit.skill) unit.skill.sp = unit.skill.spCost; });
            this.on('bondLayersChanged', (c) => live.push([c.playerId, c.bondId, this.getPlayer(c.playerId)?.bonds?.[c.bondId]?.layers]));
          }
        }
        m.BattleClass = RealBattle;
        if (h.clients) for (const c of h.clients.values()) c.o.BattleClass = RealBattle;
        const reports = [];
        const orig = m.dispatch.bind(m);
        m.dispatch = (p, ev, ctx) => {
          if (ev === 'onBattleResult' && ctx && ctx.boss) reports.push({ pid: p.playerId, gains: { ...ctx.result.layerGains } });
          return orig(p, ev, ctx);
        };
        h.drive(() => m.phase === PHASE.FINAL_ASSAULT, { band: 'band_sarkazb' });
        assert.equal(m.fields.length, 1, 'one pair field');
        assert.deepEqual(m.fields[0].players, ['p_0', 'p_1']);
        h.drive(() => m.phase !== PHASE.FINAL_ASSAULT || h.ended != null, { band: 'band_sarkazb' });
        const tag = clientCombat ? 'client' : 'server';
        // client-run: each browser builds the field from its b.start, only the authority's copy is stepped here (SimClient)
        const ran = fields.filter((f) => f.battle.time > 0);
        assert.equal(ran.length, 1, `${tag}: the boss field ran once on the real engine`);
        for (const f of ran) {
          assert.equal(f.battle.kind, 'boss');
          assert.equal(f.battle.flags.layerGainsEnabled, true, tag);
          // the first skill start: both of her active bonds +8 on the live copy, during the fight
          assert.deepEqual(f.live.slice(0, 2), [['p_1', 'arcaneShip', 108], ['p_1', 'preciShip', 178]], tag);
        }
        const r = reports.find((x) => x.pid === 'p_1');
        assert.ok(r, `${tag}: p_1's boss result was settled`);
        assert.deepEqual(r.gains, { arcaneShip: 24, preciShip: 24 }, `${tag}: +8 per skill start, at most 24 per battle`);
        assert.equal(ps.layers.arcaneShip, 124, tag);
        assert.equal(ps.layers.preciShip, 194, tag);
      } finally {
        m.dispose();
      }
    }
  } finally {
    setGameData(null);
  }
});
