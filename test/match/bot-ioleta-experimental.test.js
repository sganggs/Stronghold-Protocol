import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBonds } from '../../server/match/bondsMeta.js';
import { SharedPool } from '../../server/match/pool.js';
import { arrange } from '../../server/match/bot.js';
import {
  EXPERIMENTAL_ELITE_VALUE, EXPERIMENTAL_OPS as O, EXPERIMENTAL_PARAMS,
  experimentalEnabled, experimentalPlan, refreshExperimentalPlan, experimentalTarget, experimentalBondDisabled,
  experimentalCore, experimentalBuyBonus, experimentalBondScore, experimentalCanLevel,
  experimentalSearchTargets,
} from '../../server/match/botIoletaExperimental.js';
import { makeMatch, give, legalTileFor, checkInvariants } from './harness.js';

const L1 = [O.hibiscus, O.podenco, O.jump, O.matterhorn, O.gummy];
const PRIMARY = [O.hibiscus, O.podenco, O.perfumer, O.jump, O.executor, O.matterhorn, O.gummy, O.bough];
const SECONDARY = [O.hibiscus, O.podenco, O.jump, O.executor, O.indigo, O.matterhorn, O.gummy, O.bough];

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
  m.botIoletaPolicy = 'experimental';
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

function bondsFor(ps, ids) {
  return computeBonds(ps.gd, { board: new Map(ids.map((id, i) => [String(i),
    { kind: 'chess', uid: i + 1, id, items: [] }])), hand: [], layers: ps.layers });
}

test('experimental Ioleta: opt-in is exact and every scoring helper is inert otherwise', (t) => {
  const { m, ps } = setup(t);
  delete m.botIoletaPolicy;
  assert.equal(experimentalEnabled(m, ps), false);
  assert.equal(refreshExperimentalPlan(m, ps), null);
  assert.equal(experimentalPlan(m, ps), null);
  assert.equal(experimentalTarget(m, ps, O.hibiscus), null);
  assert.equal(experimentalCore(m, ps, O.hibiscus), false);
  assert.equal(experimentalBuyBonus(m, ps, O.hibiscus), 0);
  assert.equal(experimentalBondScore(m, ps, bondsFor(ps, PRIMARY)), 0);
  assert.equal(experimentalCanLevel(m, ps), true);
  assert.deepEqual(experimentalSearchTargets(m, ps), []);
  m.botIoletaPolicy = 'experimental';
  ps.bandId = 'band_bldsk';
  assert.equal(experimentalEnabled(m, ps), false);
  assert.equal(EXPERIMENTAL_ELITE_VALUE, 24);
});

test('experimental Ioleta: primary targets five L1 elites, two L2 elites, and single Indigo/Bough', (t) => {
  const { m, ps } = setup(t);
  const plan = refreshExperimentalPlan(m, ps);
  assert.equal(plan.framework, 'primary');
  assert.deepEqual(plan.goals, { deputShip: 3, steadShip: 3, preciShip: 2 });
  for (const base of L1) {
    assert.equal(experimentalTarget(m, ps, base).copies, ps.gd.mergeCount(base));
    assert.equal(experimentalCore(m, ps, base), true);
  }
  for (const base of [O.perfumer, O.executor]) {
    assert.equal(experimentalTarget(m, ps, base).elite, true);
    assert.equal(experimentalCore(m, ps, base), false, 'not yet a searchable L1 merge');
  }
  for (const base of [O.indigo, O.bough]) assert.equal(experimentalTarget(m, ps, base).copies, 1);
  assert.equal(experimentalTarget(m, ps, O.cuora).elite, true);
  assert.equal(experimentalTarget(m, ps, O.skadi), null, 'Cuora has priority');
  checkInvariants(m);
});

test('experimental Ioleta: core merge bonus outranks a pair and an already completed elite stops copy pursuit', (t) => {
  const { m, ps } = setup(t);
  refreshExperimentalPlan(m, ps);
  const first = experimentalBuyBonus(m, ps, O.jump);
  add(m, ps, O.jump);
  const pair = experimentalBuyBonus(m, ps, O.jump);
  add(m, ps, O.jump);
  const merge = experimentalBuyBonus(m, ps, O.jump);
  assert.ok(merge > pair && pair > first, `${merge} > ${pair} > ${first}`);
  add(m, ps, O.hibiscus, { elite: true });
  assert.equal(experimentalBuyBonus(m, ps, O.hibiscus), EXPERIMENTAL_PARAMS.surplusCopy);
  assert.ok(!experimentalSearchTargets(m, ps).some((target) => target.base === O.hibiscus));
  add(m, ps, O.indigo);
  assert.equal(experimentalBuyBonus(m, ps, O.indigo), EXPERIMENTAL_PARAMS.surplusCopy);
  checkInvariants(m);
});

test('experimental Ioleta: primary wins close framework scores, secondary can form immediately and stays stable', (t) => {
  const { m, ps } = setup(t);
  m.round = 5;
  refreshExperimentalPlan(m, ps);
  assert.ok(experimentalBondScore(m, ps, bondsFor(ps, PRIMARY))
    > experimentalBondScore(m, ps, bondsFor(ps, SECONDARY)));
  for (const base of SECONDARY) add(m, ps, base, { board: true });
  const secondary = refreshExperimentalPlan(m, ps);
  assert.equal(secondary.framework, 'secondary');
  assert.equal(secondary.goals.deputShip, 2);
  assert.equal(secondary.goals.preciShip, 3);
  add(m, ps, O.perfumer);
  assert.equal(refreshExperimentalPlan(m, ps).framework, 'secondary', 'a stable formed board does not chase a return');
  checkInvariants(m);
});

test('experimental Ioleta: offered third deputy keeps the preferred frame and probes never mutate memory', (t) => {
  const { m, ps } = setup(t);
  m.round = 5;
  for (const base of SECONDARY) add(m, ps, base, { board: true });
  ps.shop.slots = [{ kind: 'chess', id: O.perfumer, basePrice: 3, sold: false }, null, null, null];
  const before = refreshExperimentalPlan(m, ps);
  assert.equal(before.framework, 'primary');
  m.rngBots = () => { throw new Error('policy must not draw randomness'); };
  for (let i = 0; i < 30; i++) {
    experimentalBondScore(m, ps, bondsFor(ps, i % 2 ? PRIMARY : SECONDARY));
    experimentalBuyBonus(m, ps, O.perfumer);
    experimentalCanLevel(m, ps);
  }
  assert.equal(experimentalPlan(m, ps), before);
  assert.equal(before.framework, 'primary');
  assert.ok(Object.isFrozen(before) && Object.isFrozen(before.targets));
});

test('experimental Ioleta: arrange retains a formed elite secondary frame when an elite third deputy arrives', (t) => {
  const { m, ps } = setup(t);
  m.round = 5;
  const kept = SECONDARY.map((base) => add(m, ps, base, { elite: true, board: true }));
  assert.equal(refreshExperimentalPlan(m, ps).framework, 'secondary');
  const newcomer = add(m, ps, O.perfumer, { elite: true });
  arrange(m, ps);
  assert.equal(experimentalPlan(m, ps).framework, 'secondary');
  assert.equal(ps.bonds.deputShip.count, 2);
  assert.equal(ps.bonds.steadShip.count, 3);
  assert.equal(ps.bonds.preciShip.count, 3);
  assert.ok(kept.every((piece) => ps.find(piece.uid)?.area === 'board'), 'retain all eight advanced frame members');
  assert.equal(ps.find(newcomer.uid)?.area, 'hand');
  checkInvariants(m);
});

for (const disabled of ['deputShip', 'steadShip', 'preciShip']) {
  test(`experimental Ioleta: disabled ${disabled} loses every target and bond reward`, (t) => {
    const { m, ps } = setup(t);
    ps.gd.modeInactiveBonds.add(disabled);
    const plan = refreshExperimentalPlan(m, ps);
    assert.equal(plan.framework, 'fallback');
    assert.ok(!Object.hasOwn(plan.goals, disabled));
    assert.ok(!plan.targets.some((target) => target.bond === disabled));
    assert.ok(plan.fallback === 'arcaneShip' || plan.fallback === 'swiftShip');
    const bonds = bondsFor(ps, PRIMARY);
    assert.equal(experimentalBondScore(m, ps, bonds), experimentalBondScore(m, ps,
      { ...bonds, [disabled]: { count: 100, tier: 2, layers: 100 } }));
    if (disabled === 'steadShip') {
      assert.equal(experimentalTarget(m, ps, O.cuora), null);
      assert.equal(experimentalTarget(m, ps, O.skadi), null);
    }
  });
}

test('experimental Ioleta: real solo HARD seed 2 excludes drawn deputy even while Perfumer remains buyable', (t) => {
  const { m, ps } = setup(t, { seed: 2, naturalBans: true });
  assert.ok(m.disabledBonds.includes('deputShip'));
  assert.equal(ps.gd.modeInactiveBonds.has('deputShip'), false, 'the mode list alone misses this public ban');
  assert.ok(m.pool.has(O.perfumer), 'Perfumer retains the unbanned emptyShip bond and remains in stock');
  const plan = refreshExperimentalPlan(m, ps);
  assert.equal(plan.framework, 'fallback');
  assert.equal(experimentalBondDisabled(m, ps, 'deputShip'), true);
  assert.equal(experimentalBondDisabled(m, ps, 'emptyShip'), false);
  assert.ok(!Object.hasOwn(plan.goals, 'deputShip'));
  assert.ok(!plan.targets.some((target) => target.bond === 'deputShip'));
  assert.equal(experimentalTarget(m, ps, O.perfumer), null);
  ps.shop.level = 2;
  assert.equal(experimentalCore(m, ps, O.perfumer), false);
  assert.equal(experimentalBuyBonus(m, ps, O.perfumer), 0, 'disabled membership grants no bonus or penalty to the buyable healer');
  const bonds = bondsFor(ps, PRIMARY);
  assert.equal(experimentalBondScore(m, ps, bonds), experimentalBondScore(m, ps,
    { ...bonds, deputShip: { count: 100, tier: 2, layers: 100 } }));
  assert.ok(!experimentalSearchTargets(m, ps).some((target) => target.bond === 'deputShip'));
  add(m, ps, O.executor, { elite: true });
  ps.shop.upgradePrice = 0;
  assert.equal(experimentalCanLevel(m, ps), true, 'disabled Perfumer cannot hold L2 once the remaining stage core is complete');
  checkInvariants(m);
});

test('experimental Ioleta: Set-form drawn bans combine with static bans throughout cached decisions', (t) => {
  const { m, ps } = setup(t);
  refreshExperimentalPlan(m, ps);
  m.disabledBonds = new Set(['deputShip']);
  ps.gd.modeInactiveBonds.add('steadShip');
  assert.equal(experimentalBondDisabled(m, ps, 'deputShip'), true);
  assert.equal(experimentalBondDisabled(m, ps, 'steadShip'), true);
  assert.equal(experimentalTarget(m, ps, O.hibiscus), null, 'even a cached target is filtered');
  assert.equal(experimentalCore(m, ps, O.matterhorn), false);
  assert.ok(!experimentalSearchTargets(m, ps).some((target) => ['deputShip', 'steadShip'].includes(target.bond)));
  const plan = refreshExperimentalPlan(m, ps);
  assert.ok(!Object.hasOwn(plan.goals, 'deputShip') && !Object.hasOwn(plan.goals, 'steadShip'));
  const bonds = bondsFor(ps, PRIMARY);
  assert.equal(experimentalBondScore(m, ps, bonds), experimentalBondScore(m, ps, {
    ...bonds, deputShip: { count: 3, tier: 2, layers: 99 }, steadShip: { count: 3, tier: 2, layers: 99 },
  }));
});

test('experimental Ioleta: swift fallback reads its sole two-member threshold and never rewards a third', (t) => {
  const { m, ps } = setup(t);
  ps.gd.modeInactiveBonds.add('deputShip');
  ps.gd.modeInactiveBonds.add('arcaneShip');
  add(m, ps, 'chess_char_1_01_a');
  const plan = refreshExperimentalPlan(m, ps);
  assert.equal(plan.fallback, 'swiftShip');
  assert.equal(plan.goals.swiftShip, 2);
  const swift = (count) => ({ swiftShip: { count, tier: 1, layers: 40 } });
  assert.equal(experimentalBondScore(m, ps, swift(2)), experimentalBondScore(m, ps, swift(3)));
  assert.ok(experimentalBondScore(m, ps, swift(2)) > experimentalBondScore(m, ps,
    { swiftShip: { count: 1, tier: 0, layers: 40 } }));
});

test('experimental Ioleta: public bans and exhausted pool remove dead searches; shown cards remain obtainable', (t) => {
  const { m, ps } = setup(t);
  m.pool.entries.delete(O.cuora);
  assert.equal(refreshExperimentalPlan(m, ps).targets.find((target) => target.stage === 3)?.base, O.skadi);
  m.pool.entries.delete(O.jump);
  refreshExperimentalPlan(m, ps);
  assert.equal(experimentalTarget(m, ps, O.jump), null);
  const old = m.pool.entries.get(O.hibiscus).left;
  m.pool.entries.get(O.hibiscus).left = 0;
  assert.ok(!experimentalSearchTargets(m, ps).some((target) => target.base === O.hibiscus));
  add(m, ps, O.jump);
  add(m, ps, O.jump);
  ps.shop.slots = [{ kind: 'chess', id: O.jump, sold: false, basePrice: 2 }, null, null, null];
  refreshExperimentalPlan(m, ps);
  assert.ok(experimentalSearchTargets(m, ps).some((target) => target.base === O.jump), 'visible third copy can overdraw stock');
  m.pool.entries.get(O.hibiscus).left = old;
  checkInvariants(m);
});

test('experimental Ioleta: completed L1 cores permit L2 immediately; R6 relaxes two missing and R7 forces an affordable exit', (t) => {
  const { m, ps } = setup(t);
  m.round = 3;
  ps.shop.upgradePrice = 5;
  refreshExperimentalPlan(m, ps);
  assert.equal(experimentalCanLevel(m, ps), false);
  for (const base of L1.slice(0, 3)) add(m, ps, base, { elite: true });
  m.round = 5;
  assert.equal(experimentalCanLevel(m, ps), false);
  m.round = 6;
  assert.equal(experimentalCanLevel(m, ps), true);
  ps.funds = 4;
  m.round = 7;
  assert.equal(experimentalCanLevel(m, ps), false, 'real upgradePrice controls affordability');
  ps.funds = 5;
  assert.equal(experimentalCanLevel(m, ps), true);
  m.round = 3;
  for (const base of L1.slice(3)) add(m, ps, base, { elite: true });
  assert.equal(experimentalCanLevel(m, ps), true, 'no forced R5 wait');
  checkInvariants(m);
});

test('experimental Ioleta: L2 and turtle stops have explicit experimental exits, independent of R7', (t) => {
  const { m, ps } = setup(t);
  ps.shop.level = 2;
  ps.shop.upgradePrice = 0;
  m.round = 7;
  refreshExperimentalPlan(m, ps);
  assert.equal(experimentalCanLevel(m, ps), false, 'L1 deadline is not reused for L2');
  m.round = EXPERIMENTAL_PARAMS.exitL2Round;
  assert.equal(experimentalCanLevel(m, ps), true);
  m.round = 5;
  for (const base of [O.perfumer, O.executor]) add(m, ps, base, { elite: true });
  assert.equal(experimentalCanLevel(m, ps), true);
  ps.shop.level = 3;
  m.round = 8;
  assert.equal(experimentalCanLevel(m, ps), false);
  add(m, ps, O.cuora);
  assert.equal(experimentalCanLevel(m, ps), false, 'this experiment searches for the elite, not just the first copy');
  m.round = EXPERIMENTAL_PARAMS.exitL3Round;
  assert.equal(experimentalCanLevel(m, ps), true);
  m.round = 8;
  add(m, ps, O.cuora, { elite: true });
  assert.equal(experimentalCanLevel(m, ps), true);
  const layout = ps.gd.shopSlots(ps.shop.level);
  ps.shop.slots = Array(layout.chess + layout.item).fill(null);
  ps.shop.layout = layout;
  checkInvariants(m);
});

test('experimental Ioleta: late levels resume a slower explicit experimental curve', (t) => {
  const { m, ps } = setup(t);
  ps.shop.upgradePrice = 0;
  ps.shop.level = 4;
  m.round = 9;
  assert.equal(experimentalCanLevel(m, ps), false);
  m.round = EXPERIMENTAL_PARAMS.l4UpgradeRound;
  assert.equal(experimentalCanLevel(m, ps), true);
  ps.shop.level = 5;
  assert.equal(experimentalCanLevel(m, ps), false);
  m.round = EXPERIMENTAL_PARAMS.l5UpgradeRound;
  assert.equal(experimentalCanLevel(m, ps), true);
  ps.shop.level = 6;
  assert.equal(experimentalCanLevel(m, ps), false);
});

test('experimental Ioleta: deputy variant and deployed elite counts stay separate', (t) => {
  const { m, ps } = setup(t);
  refreshExperimentalPlan(m, ps);
  const mixed = bondsFor(ps, [O.hibiscus, ps.gd.goldenIdOf(O.hibiscus), O.podenco]);
  assert.equal(mixed.deputShip.count, 2);
  assert.equal(mixed.deputShip.tier, 2);
  assert.ok(experimentalBondScore(m, ps, mixed) > experimentalBondScore(m, ps,
    { ...mixed, deputShip: { ...mixed.deputShip, tier: 1 } }));
});
