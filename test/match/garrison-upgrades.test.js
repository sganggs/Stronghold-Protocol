import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { SharedPool } from '../../server/match/pool.js';
import { garrisonUpgradeKey, nextGarrisonUpgrade } from '../../shared/garrisonUpgrades.js';
import { makeMatch, give } from './harness.js';

const RAW = getVersionData('act3autochess@V3_1');
const AURORA = 'chess_char_3_07_a', CANTO = 'chess_char_3_13_a';
function setup(t) {
  const registry = createRegistry({ builtins: false });
  registerBuiltins(registry, RAW);
  const h = makeMatch({ data: RAW, registry, mode: 'coop', modeId: 'mode_multi_normal', humans: 2,
    seed: 41, fake: true }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  h.m.disabledBonds = []; h.m.bannedChess = [];
  h.m.pool = new SharedPool(h.m.gd);
  for (const ps of h.m.players.values()) ps.bandId = null;
  t.after(() => { assert.equal(h.m.errorCount, 0); h.m.dispose(); });
  return { h, m: h.m, ps: h.ps('p_0'), other: h.ps('p_1') };
}
const gidOf = (ps, p) => ps.gd.chess(p.id).garrisonIds[0];
const preview = (ps, p) => {
  const g = ps.gd.garrison(gidOf(ps, p));
  return nextGarrisonUpgrade(g.bb, { fired: ps.counters[garrisonUpgradeKey(g, ps.gd.baseIdOf(p.id))] });
};
function reward(ps, id) {
  const before = id === AURORA ? ps.layers.kjeragShip || 0 : ps.shop.freeRefreshes;
  const p = ps.acquireChess(id);
  assert.ok(p);
  const after = id === AURORA ? ps.layers.kjeragShip : ps.shop.freeRefreshes;
  return { p, n: after - before };
}

test('upgrade formula caps each payout, not the lifetime sum; Canto upgrades every two triggers', () => {
  for (const [gid, expected] of [
    ['garrison_50_a', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12]],
    ['garrison_74_a', [1, 1, 2, 2, 3, 3, 3, 3]],
  ]) {
    let sum = 0;
    for (const [fired, n] of expected.entries()) {
      assert.equal(nextGarrisonUpgrade(RAW.garrisons[gid].bb, { fired, sum }), n, `${gid} trigger ${fired + 1}`);
      sum += n;
    }
  }
});

for (const [id, expected] of [[AURORA, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12]],
  [CANTO, [1, 1, 2, 2, 3, 3, 3]]]) {
  test(`${id}: buying again after sale shares progress and keeps paying at the cap`, t => {
    const { ps } = setup(t);
    const values = [];
    for (const n of expected) {
      const { p, n: actual } = reward(ps, id);
      values.push(actual);
      assert.equal(actual, n);
      assert.equal(ps.sell(p.uid).ok, true);
    }
    assert.deepEqual(values, expected);
  });
}

test('normal copies, merge-produced elites and directly gained elites share progress; players do not', t => {
  for (const [id, payouts, next] of [[AURORA, [1, 2, 3, 4], 5], [CANTO, [1, 1, 2, 2], 3]]) {
    const { ps, other } = setup(t);
    const first = reward(ps, id), second = reward(ps, id), elite = reward(ps, id);
    assert.deepEqual([first.n, second.n, elite.n], payouts.slice(0, 3));
    assert.equal(ps.gd.isGolden(elite.p.id), true);
    const directId = ps.gd.goldenIdOf(id);
    const before = id === AURORA ? ps.layers.kjeragShip : ps.shop.freeRefreshes;
    const direct = ps.acquireChess(directId);
    assert.equal((id === AURORA ? ps.layers.kjeragShip : ps.shop.freeRefreshes) - before, payouts[3]);
    assert.equal(preview(ps, elite.p), next);
    assert.equal(preview(ps, direct), next);
    assert.equal(reward(other, id).n, 1);
  }
});

test('g.buy uses shared progress through automatic promotion and silent grants do not count', t => {
  const { m, ps } = setup(t);
  ps.funds = 50;
  const silent = ps.acquireChess(AURORA, { silent: true });
  assert.equal(preview(ps, silent), 1);
  for (const [i, n] of [1, 2, 3].entries()) {
    ps.shop.slots[0] = { kind: 'chess', id: AURORA, basePrice: 3, sold: false };
    const before = ps.layers.kjeragShip || 0;
    assert.equal(m.handle(ps.playerId, { t: 'g.buy', slot: 0 }).ok, true);
    assert.equal(ps.layers.kjeragShip - before, n);
    if (i === 1) assert.ok(ps.allChess().some(p => p.id === ps.gd.goldenIdOf(AURORA)));
  }
});

test('repeated and copied traits, investor repeats and read-only previews share the same authoritative progress', t => {
  const { m, ps, other } = setup(t);
  const { p } = reward(ps, AURORA);
  const held = give(m, ps, AURORA, 'hand');
  const copy = give(m, ps, 'chess_char_5_17_a', 'hand'); // Saria copies another operator's trait.
  const before = JSON.stringify(ps.counters);
  assert.equal(preview(ps, p), 2);
  assert.equal(preview(ps, held), 2);
  assert.equal(JSON.stringify(ps.counters), before);
  m.dispatcher.triggerGarrisons(ps, p, 'SERVER_GAIN', { asPiece: copy });
  assert.equal(ps.layers.kjeragShip, 3);
  assert.equal(preview(ps, p), 3);
  ps.bondCountBonus.investShip = 20; ps.recompute();
  assert.equal(m.dispatcher.investRepeat(ps), 2);
  m.dispatcher.triggerGarrisons(ps, held, 'SERVER_GAIN');
  assert.equal(ps.layers.kjeragShip, 10, 'investor repeats advance from 3 to 4 within the same dispatch');
  assert.equal(preview(ps, held), 5);
  assert.equal(reward(other, AURORA).n, 1);
});

test('next payout survives round changes even with no remaining copy', t => {
  const { h, ps } = setup(t);
  for (const id of [AURORA, CANTO]) {
    for (let i = 0; i < 4; i++) {
      const { p } = reward(ps, id);
      assert.equal(ps.sell(p.uid).ok, true);
    }
  }
  h.m.dispatch(ps, 'onRoundStart', { round: 2 });
  assert.equal(reward(ps, AURORA).n, 5);
  assert.equal(reward(ps, CANTO).n, 3);
  assert.equal(reward(h.ps('p_1'), AURORA).n, 1);
});
