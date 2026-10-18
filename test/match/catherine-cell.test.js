// #677: maintainer decision 2026-10-17 (official play memory): one Cathy cell per player/match.
// Official activity_table aceffect_band_26: three choices, one pick, pool_equip_kathe; aceffect_band_41: Quintus R3 cell.
// [ASSUMED] Only a successful pick counts; Quintus's cell is independent. Seed 236 offers a cell on both first upgrades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { replayTestMatch } from '../../server/match/testReplay.js';
import { botPrepBeginSteps } from '../../server/match/bot.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { createRng } from '../../server/sim/rng.js';

const CELL = 'chess_item_5_08_e_a';
const CELL_TAKEN = 'band:cathy:cellTaken';
const OK = { ok: true };
const idsOf = (offer) => offer.slots.map((s) => s.id);
const cellIndex = (offer) => offer.slots.findIndex((s) => s.id === CELL);
const cellsOwned = (ps) => [...ps.hand, ...ps.temp].filter((p) => p?.id === CELL).length;

function fixture(t, seed = 236, opts = {}) {
  const h = makeMatch({ mode: 'solo', seed, fake: true, ...opts }).start().toPrep(1, { band: 'band_cathy' });
  t.after(() => h.m.dispose());
  const ps = h.ps('p_0');
  ps.funds = 999;
  const upgrade = () => {
    assert.deepEqual(ps.levelUp(), OK);
    const offer = ps.offers.at(-1);
    assert.ok(offer);
    assert.equal(offer.slots.length, 3);
    assert.equal(new Set(idsOf(offer)).size, 3);
    return offer;
  };
  const pickCell = () => {
    const idx = cellIndex(ps.offers[0]);
    assert.ok(idx >= 0, 'the seeded offer includes a cell');
    assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.reward', idx }), OK);
  };
  return { ...h, ps, upgrade, pickCell };
}

test('Cathy: after taking a cell, later upgrades exclude it even after destruction, reconnect and a new round', (t) => {
  const h = fixture(t);
  h.upgrade(); h.pickCell();
  assert.equal(cellsOwned(h.ps), 1);
  assert.ok(!idsOf(h.upgrade()).includes(CELL), 'the second seeded offer used to repeat the cell');
  const cell = h.ps.hand.find((p) => p?.id === CELL);
  assert.deepEqual(h.ps.destroy(cell.uid), OK);
  h.m.onDisconnect('p_0'); h.m.onReconnect('p_0');
  h.m.round = 2; h.ps.startRound(2);
  for (let level = 4; level <= 6; level++) assert.ok(!idsOf(h.upgrade()).includes(CELL));
  h.m.onReconnect('p_0');
  assert.ok(!idsOf(h.lastTo('p_0', 'm.private').shop.rewardOffer).includes(CELL));
});

test('Cathy: showing a cell without taking it leaves it eligible on the next upgrade [ASSUMED]', (t) => {
  const h = fixture(t);
  const offer = h.upgrade();
  assert.ok(idsOf(offer).includes(CELL));
  const idx = offer.slots.findIndex((s) => s.id !== CELL);
  assert.deepEqual(h.m.handle('p_0', { t: 'g.reward', idx }), OK);
  assert.ok(idsOf(h.upgrade()).includes(CELL), 'declining the first cell does not use the allowance');
  h.pickCell();
  assert.equal(cellsOwned(h.ps), 1);
});

test('Cathy: a refused full-hand pick does not use the allowance', (t) => {
  const h = fixture(t);
  h.upgrade();
  const hand = h.ps.hand.slice();
  h.ps.hand = h.ps.hand.map(() => h.ps.newPiece('item', CELL));
  const idx = cellIndex(h.ps.offers[0]);
  assert.equal(h.m.handle('p_0', { t: 'g.reward', idx }).error, 'HAND_FULL');
  h.ps.hand = hand;
  assert.ok(idsOf(h.upgrade()).includes(CELL), 'the failed pick leaves the next cell eligible');
  h.pickCell();
  assert.ok(h.ps.offers.every((o) => !idsOf(o).includes(CELL)));
});

test('Cathy: taking a cell removes it from queued Cathy offers and preserves other sources [ASSUMED]', (t) => {
  const h = fixture(t);
  h.upgrade();
  const pending = h.upgrade();
  assert.ok(idsOf(pending).includes(CELL));
  const otherIds = idsOf(pending).filter((id) => id !== CELL);
  h.ps.pushItemOffer([CELL], { source: 'other' });
  h.pickCell();
  assert.deepEqual(idsOf(h.ps.offers[0]), otherIds, 'the other queued choices are retained without rerolling');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.reward', idx: 0 }), OK);
  assert.deepEqual(idsOf(h.ps.offers[0]), [CELL], 'the limit belongs only to Cathy');
  assert.deepEqual(h.m.handle('p_0', { t: 'g.reward', idx: 0 }), OK);
  assert.equal(cellsOwned(h.ps), 2);
});

for (const quintusFirst of [true, false]) test(`Quintus's R3 grant stays independent ${quintusFirst ? 'before' : 'after'} Cathy's cell [ASSUMED]`, (t) => {
  const h = fixture(t);
  const quintus = () => {
    h.ps.bandId = 'band_quintus'; h.m.round = 3;
    h.m.dispatch(h.ps, 'onRoundStart', { round: 3 });
    h.ps.bandId = 'band_cathy';
  };
  if (quintusFirst) { quintus(); assert.equal(cellsOwned(h.ps), 1); }
  h.upgrade(); h.pickCell();
  if (!quintusFirst) quintus();
  assert.equal(cellsOwned(h.ps), 2, 'one cell from each source');
  assert.ok(!idsOf(h.upgrade()).includes(CELL), "only Cathy's successful pick uses her allowance");
});

test('the bot reward routine uses the same Cathy allowance', (t) => {
  const h = fixture(t, 36); // Cell (tier V), tier IV, tier II: the bot prefers the cell.
  h.ps.isBot = true;
  h.upgrade();
  const steps = botPrepBeginSteps(h.m, h.ps);
  steps.next(); steps.return(); // First step resolves offers through the real bot routine.
  assert.equal(cellsOwned(h.ps), 1);
  assert.equal(h.ps.counters[CELL_TAKEN], 1, 'the bot records the successful Cathy pick');
  // Force the next draw to contain a cell unless the allowance excludes it; no lucky later seeds.
  h.m.itemPool.canGain = (id) => id === CELL;
  assert.deepEqual(h.ps.levelUp(), OK);
  assert.equal(h.ps.offers.length, 0, 'the bot cannot receive a second cell even from a cell-only pool');
});

test('inherited Cathy effects share the canonical source, queued offers and match-long allowance', (t) => {
  const alias = 'band_x_test_cathy';
  const data = { ...DATA, bands: { ...DATA.bands,
    [alias]: { ...structuredClone(DATA.bands.band_cathy), bandId: alias, effectRef: 'band_cathy' },
  } };
  setGameData(data);
  t.after(() => setGameData(null));
  const h = fixture(t, 236, { data, registry: createRegistry() });
  h.ps.bandId = alias;
  assert.equal(h.upgrade().source, 'band:band_cathy');
  assert.ok(idsOf(h.upgrade()).includes(CELL), 'another inherited offer is queued before the pick');
  h.pickCell();
  assert.equal(h.ps.counters[CELL_TAKEN], 1);
  assert.ok(h.ps.offers.every((o) => !idsOf(o).includes(CELL)), 'queued inherited offers lose the cell');
  h.ps.bandId = 'band_cathy';
  assert.ok(!idsOf(h.upgrade()).includes(CELL), 'the original strategy shares the inherited allowance');
  h.ps.bandId = alias;
  assert.ok(!idsOf(h.upgrade()).includes(CELL), 'the inherited strategy still excludes the cell');
  assert.equal(cellsOwned(h.ps), 1);
});

test('Cathy fills all three eligible choices after excluding the cell, across 300 seeds', (t) => {
  const h = fixture(t);
  h.upgrade(); h.pickCell();
  const shopIds = Object.values(h.m.gd.shopItemsByTier).flat();
  const eligible = shopIds.slice(0, 3);
  for (const id of shopIds.filter((id) => !eligible.includes(id))) {
    for (let copies = 0; copies < 30 && h.m.itemPool.canGain(id); copies++) {
      assert.ok(h.ps.acquireItem(id, { toTemp: true, silent: true }));
    }
    assert.equal(h.m.itemPool.canGain(id), false, `stock exhausted: ${id}`);
  }
  assert.deepEqual(shopIds.filter((id) => h.m.itemPool.canGain(id)), eligible);
  assert.ok(h.m.itemPool.canGain(CELL), 'the uncapped cell stays available in the underlying pool');
  for (let seed = 1; seed <= 300; seed++) {
    h.ps.offers = [];
    h.m.rngMeta = createRng(seed);
    h.m.dispatch(h.ps, 'onLevelUp', {});
    assert.deepEqual(idsOf(h.ps.offers[0]).sort(), [...eligible].sort(), `seed ${seed}: all eligible items`);
  }
});

test('Cathy samples eligible choices without replacement and stops only at exhaustion [ASSUMED]', (t) => {
  const h = fixture(t);
  h.upgrade(); h.pickCell();
  const shopIds = Object.values(h.m.gd.shopItemsByTier).flat();
  for (const count of [3, 2, 1, 0]) {
    const eligible = shopIds.slice(0, count);
    h.m.itemPool.canGain = (id) => id === CELL || eligible.includes(id);
    h.ps.offers = [];
    let draws = 0;
    h.m.rngMeta = () => { draws++; return 0; }; // Repeated identical rolls must still draw distinct candidates.
    h.m.dispatch(h.ps, 'onLevelUp', {});
    assert.deepEqual(h.ps.offers.flatMap(idsOf), eligible, `${count} eligible choices`);
    assert.equal(draws, count, 'excluded/previously selected items consume no random draws');
  }
});

test('item-pool exclusions filter explicit items, weights, tiers and also before sampling', (t) => {
  const keep = 'chess_item_1_02_e_a', blocked = 'chess_item_1_01_e_a';
  const pools = {
    test_items: { kind: 'equip', items: [blocked, keep], also: [CELL] },
    test_weights: { kind: 'equip', weighted: [[blocked, 100], [keep, 1]], also: [CELL] },
    test_tiers: { kind: 'equip', tiers: [1], also: [CELL] },
    test_shop_level: { kind: 'equip', maxTier: 'shopLevel', also: [CELL] },
    test_also_only: { kind: 'equip', items: [blocked], also: [keep, CELL] },
  };
  const data = { ...DATA, choices: { ...DATA.choices, pools: { ...DATA.choices.pools, ...pools } } };
  const h = fixture(t, 236, { data });
  h.m.itemPool.canGain = (id) => [keep, blocked, CELL].includes(id);
  let draws = 0;
  h.m.rngMeta = () => { draws++; return 0; };
  for (const pool of Object.keys(pools)) {
    assert.deepEqual(h.m.rollPool(pool, { shopLevel: 1, exclude: [blocked, CELL] }), { kind: 'item', id: keep }, pool);
    assert.equal(h.m.rollItemId({ pool, exclude: [blocked, keep, CELL] }), null, `${pool}: exhausted`);
  }
  assert.equal(h.m.rollItemId({ tier: 1, exclude: [blocked] }), keep, 'plain tier draws filter too');
  assert.equal(h.m.rollItemId({ maxTier: 1, exclude: [blocked, keep] }), null, 'plain max-tier draw exhausted');
  assert.equal(draws, Object.keys(pools).length + 1, 'empty candidates draw no RNG');
});

test('the Cathy allowance belongs to the player, even when the cell is the only available item', (t) => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 236, fake: true }).start().toPrep(1);
  t.after(() => h.m.dispose());
  const a = h.ps('p_0'), b = h.ps('p_1');
  a.bandId = 'band_cathy'; a.funds = 999;
  h.m.itemPool.canGain = (id) => id === CELL;
  assert.deepEqual(a.levelUp(), OK);
  assert.deepEqual(a.pickReward(0), OK);
  a.bandId = 'band_bldsk'; b.bandId = 'band_cathy'; b.funds = 999;
  assert.deepEqual(b.levelUp(), OK);
  assert.deepEqual(idsOf(b.offers[0]), [CELL], 'the other player still has an allowance');
  assert.deepEqual(b.pickReward(0), OK);
  assert.deepEqual(b.levelUp(), OK);
  assert.equal(b.offers.length, 0, 'a cell-only pool cannot bypass the limit or create an empty offer');
});

test('test-console upgrades, strategy switches and reconnect replay the same source-specific allowance', (t) => {
  const entries = [];
  const scheduler = new VirtualScheduler();
  const m = new Match({ mode: 'solo', difficulty: 'NORMAL', test: true, hostId: 'p', seed: 236,
    seats: [{ playerId: 'p', seat: 0, name: 'P', connected: true }], data: DATA, scheduler,
    send() {}, broadcast() {}, onEnd() {}, clientCombat: false, botRehearsal: 0,
    log: { info(line) { if (line.startsWith('[test-input ')) entries.push(JSON.parse(line.slice(line.indexOf(']') + 2))); } },
  });
  t.after(() => m.dispose());
  const cmd = (cmd, args = {}) => assert.deepEqual(m.handle('p', { t: 'g.test', cmd, args }), OK);
  m.start();
  assert.deepEqual(m.handle('p', { t: 'g.infoReady' }), OK);
  assert.ok(scheduler.runUntil(() => m.phase === 'BAND_DRAFT'));
  assert.deepEqual(m.handle('p', { t: 'g.band', bandId: 'band_cathy' }), OK);
  assert.ok(scheduler.runUntil(() => m.phase === 'PREP'));
  cmd('funds', { amount: 999 }); cmd('level');
  const ps = m.players.get('p');
  const idx = cellIndex(ps.offers[0]);
  assert.ok(idx >= 0);
  assert.deepEqual(m.handle('p', { t: 'g.reward', idx }), OK);
  cmd('strategy', { id: 'band_quintus' }); cmd('strategy', { id: 'band_cathy' });
  m.onDisconnect('p'); m.onReconnect('p');
  cmd('level');
  assert.ok(!idsOf(ps.offers[0]).includes(CELL));
  const copy = replayTestMatch(DATA, entries);
  t.after(() => copy.dispose());
  assert.deepEqual(copy.players.get('p').counters, ps.counters);
  assert.deepEqual(copy.players.get('p').privateView(), ps.privateView());
  assert.deepEqual(copy.testLog, m.testLog);
});
