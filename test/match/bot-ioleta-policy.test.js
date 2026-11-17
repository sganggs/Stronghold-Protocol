import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SharedPool } from '../../server/match/pool.js';
import {
  IOLETA_OPS as O, IOLETA_PARAMS,
  refreshIoletaPlan, ioletaTarget,
  ioletaCore, ioletaBuyBonus, ioletaCanLevel,
  ioletaSearchTargets,
} from '../../server/match/botIoletaPolicy.js';
import { makeMatch, give, legalTileFor, checkInvariants } from './harness.js';

const L1 = [O.hibiscus, O.podenco, O.jump, O.matterhorn, O.gummy];

for (const disabled of ['deputShip', 'steadShip', 'preciShip']) {
  test(`ioleta: disabled ${disabled} removes its targets and selects an obtainable fallback`, t => {
    const { m, ps } = setup(t);
    m.disabledBonds = [disabled];
    const plan = refreshIoletaPlan(m, ps);
    assert.equal(plan.framework, 'fallback');
    assert.equal(plan.goals[disabled], undefined);
    assert.ok(!plan.targets.some(target => target.bond === disabled));
    assert.ok(['arcaneShip', 'swiftShip'].includes(plan.fallback));
    assert.ok(!ioletaSearchTargets(m, ps).some(target => target.bond === disabled));
  });
}

function setup(t, { seed = 11, naturalBans = false } = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed, fake: true }).start().toPrep();
  t.after(() => h.m.dispose());
  const m = h.m, ps = m.order[0];
  // Most scenarios isolate decisions with all operators available; naturalBans
  // preserves the real seed's disabled bonds and public stock for regressions.
  if (!naturalBans) {
    m.pool = new SharedPool(m.gd);
    m.disabledBonds = [];
  }
  ps.bandId = 'band_ioleta';
  ps.shop.slots.fill(null);
  ps.shop.freeRefreshes = 0;
  ps.funds = 20;
  return { m, ps };
}

function add(m, ps, base, { elite = false, board = false } = {}) {
  const id = elite ? ps.gd.goldenIdOf(base) : base;
  const tile = board ? legalTileFor(m, ps, id) : null;
  if (board) assert.ok(tile, `no tile for ${id}`);
  return give(m, ps, id, board ? 'board' : 'hand', tile);
}


test('ioleta Ioleta: primary targets five L1 elites, two L2 elites, and single Indigo/Bough', (t) => {
  const { m, ps } = setup(t);
  const plan = refreshIoletaPlan(m, ps);
  assert.equal(plan.framework, 'primary');
  assert.deepEqual(plan.goals, { deputShip: 3, steadShip: 3, preciShip: 2 });
  for (const base of L1) {
    assert.equal(ioletaTarget(m, ps, base).copies, ps.gd.mergeCount(base));
    assert.equal(ioletaCore(m, ps, base), true);
  }
  for (const base of [O.perfumer, O.executor]) {
    assert.equal(ioletaTarget(m, ps, base).elite, true);
    assert.equal(ioletaCore(m, ps, base), false, 'not yet a searchable L1 merge');
  }
  for (const base of [O.indigo, O.bough]) assert.equal(ioletaTarget(m, ps, base).copies, 1);
  assert.equal(ioletaTarget(m, ps, O.cuora).elite, true);
  assert.equal(ioletaTarget(m, ps, O.skadi), null, 'Cuora has priority');
  checkInvariants(m);
});

test('ioleta Ioleta: core merge bonus outranks a pair and an already completed elite stops copy pursuit', (t) => {
  const { m, ps } = setup(t);
  refreshIoletaPlan(m, ps);
  const first = ioletaBuyBonus(m, ps, O.jump);
  add(m, ps, O.jump);
  const pair = ioletaBuyBonus(m, ps, O.jump);
  add(m, ps, O.jump);
  const merge = ioletaBuyBonus(m, ps, O.jump);
  assert.ok(merge > pair && pair > first, `${merge} > ${pair} > ${first}`);
  add(m, ps, O.hibiscus, { elite: true });
  assert.equal(ioletaBuyBonus(m, ps, O.hibiscus), IOLETA_PARAMS.surplusCopy);
  assert.ok(!ioletaSearchTargets(m, ps).some((target) => target.base === O.hibiscus));
  add(m, ps, O.indigo);
  assert.equal(ioletaBuyBonus(m, ps, O.indigo), IOLETA_PARAMS.surplusCopy);
  checkInvariants(m);
});

test('ioleta Ioleta: public bans and exhausted pool remove dead searches; shown cards remain obtainable', (t) => {
  const { m, ps } = setup(t);
  m.pool.entries.delete(O.cuora);
  assert.equal(refreshIoletaPlan(m, ps).targets.find((target) => target.stage === 3)?.base, O.skadi);
  m.pool.entries.delete(O.jump);
  refreshIoletaPlan(m, ps);
  assert.equal(ioletaTarget(m, ps, O.jump), null);
  const old = m.pool.entries.get(O.hibiscus).left;
  m.pool.entries.get(O.hibiscus).left = 0;
  assert.ok(!ioletaSearchTargets(m, ps).some((target) => target.base === O.hibiscus));
  add(m, ps, O.jump);
  add(m, ps, O.jump);
  ps.shop.slots = [{ kind: 'chess', id: O.jump, sold: false, basePrice: 2 }, null, null, null];
  refreshIoletaPlan(m, ps);
  assert.ok(ioletaSearchTargets(m, ps).some((target) => target.base === O.jump), 'visible third copy can overdraw stock');
  m.pool.entries.get(O.hibiscus).left = old;
  checkInvariants(m);
});

test('ioleta Ioleta: completed L1 cores permit L2 immediately; R6 relaxes two missing and R7 forces an affordable exit', (t) => {
  const { m, ps } = setup(t);
  m.round = 3;
  ps.shop.upgradePrice = 5;
  refreshIoletaPlan(m, ps);
  assert.equal(ioletaCanLevel(m, ps), false);
  for (const base of L1.slice(0, 3)) add(m, ps, base, { elite: true });
  m.round = 5;
  assert.equal(ioletaCanLevel(m, ps), false);
  m.round = 6;
  assert.equal(ioletaCanLevel(m, ps), true);
  ps.funds = 4;
  m.round = 7;
  assert.equal(ioletaCanLevel(m, ps), false, 'real upgradePrice controls affordability');
  ps.funds = 5;
  assert.equal(ioletaCanLevel(m, ps), true);
  m.round = 3;
  for (const base of L1.slice(3)) add(m, ps, base, { elite: true });
  assert.equal(ioletaCanLevel(m, ps), true, 'no forced R5 wait');
  checkInvariants(m);
});

test('ioleta Ioleta: L2 and turtle stops have explicit ioleta exits, independent of R7', (t) => {
  const { m, ps } = setup(t);
  ps.shop.level = 2;
  ps.shop.upgradePrice = 0;
  m.round = 7;
  refreshIoletaPlan(m, ps);
  assert.equal(ioletaCanLevel(m, ps), false, 'L1 deadline is not reused for L2');
  m.round = IOLETA_PARAMS.exitL2Round;
  assert.equal(ioletaCanLevel(m, ps), true);
  m.round = 5;
  for (const base of [O.perfumer, O.executor]) add(m, ps, base, { elite: true });
  assert.equal(ioletaCanLevel(m, ps), true);
  ps.shop.level = 3;
  m.round = 8;
  assert.equal(ioletaCanLevel(m, ps), false);
  add(m, ps, O.cuora);
  assert.equal(ioletaCanLevel(m, ps), false, 'this experiment searches for the elite, not just the first copy');
  m.round = IOLETA_PARAMS.exitL3Round;
  assert.equal(ioletaCanLevel(m, ps), true);
  m.round = 8;
  add(m, ps, O.cuora, { elite: true });
  assert.equal(ioletaCanLevel(m, ps), true);
  const layout = ps.gd.shopSlots(ps.shop.level);
  ps.shop.slots = Array(layout.chess + layout.item).fill(null);
  ps.shop.layout = layout;
  checkInvariants(m);
});

test('ioleta Ioleta: late levels resume a slower explicit ioleta curve', (t) => {
  const { m, ps } = setup(t);
  ps.shop.upgradePrice = 0;
  ps.shop.level = 4;
  m.round = 9;
  assert.equal(ioletaCanLevel(m, ps), false);
  m.round = IOLETA_PARAMS.l4UpgradeRound;
  assert.equal(ioletaCanLevel(m, ps), true);
  ps.shop.level = 5;
  assert.equal(ioletaCanLevel(m, ps), false);
  m.round = IOLETA_PARAMS.l5UpgradeRound;
  assert.equal(ioletaCanLevel(m, ps), true);
  ps.shop.level = 6;
  assert.equal(ioletaCanLevel(m, ps), false);
});
