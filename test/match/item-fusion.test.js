// Official playtests reported 2026-11-14: acquiring a partner fuses owned components, including equipped ones,
// into an unequipped result. Fusion also counts for Mechanist's 精巧设计 item-promotion reward.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { syncCommand, commandSkill, beginCommandPrep, commandView } from '../../server/match/bandCommands.js';
import { GEO } from '../../shared/constants.js';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';

const data = getVersionData('act3autochess@V3_1', { log: { warn() {}, error() {}, info() {} } });
const pairs = Object.values(data.items).filter(r => r.canFuse && r.id < r.fuseWith);
const OP = 'chess_char_1_11_a';
const FILLER = 'chess_item_1_01_e_a';
after(() => setGameData(null));

function setup(t, band = 'band_sarkazb') {
  setGameData(data);
  const registry = registerBuiltins(new MetaRegistry(), data);
  const h = makeMatch({ data, registry, mode: 'solo', modeId: 'mode_single_1', seed: 41, fake: true }).start().toPrep(1, { band: 'band_amiya' });
  t.after(() => { assert.equal(h.m.errorCount, 0); h.m.dispose(); });
  const ps = h.ps('p_0');
  for (const p of ps.allChess()) ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp = new Array(GEO.TEMP_SIZE).fill(null);
  ps._tempDue.clear(); ps.offers = []; ps.bandId = band; ps.funds = 50; ps.shop.level = 5;
  syncCommand(ps); ps.recompute();
  return { m: h.m, ps };
}

assert.equal(pairs.length, 5);
for (const recipe of pairs) for (const reverse of [false, true]) for (const where of ['temp', 'hand', 'board', 'bench', 'hidden']) {
  const [first, second] = reverse ? [recipe.fuseWith, recipe.id] : [recipe.id, recipe.fuseWith];
  test(`fusion on acquire: ${first} + ${second}, partner in ${where}`, t => {
    const { m, ps } = setup(t);
    let carrier, unrelated;
    const old = ps.acquireItem(first);
    if (where === 'board' || where === 'bench') {
      carrier = give(m, ps, OP, where === 'board' ? 'board' : 'hand', where === 'board' ? legalTileFor(m, ps, OP) : null);
      assert.ok(ps.equip(old.uid, carrier.uid).ok);
      unrelated = giveItem(m, ps, FILLER, 'temp');
      assert.ok(ps.equip(unrelated.uid, carrier.uid).ok);
      assert.equal(carrier.items.length, 2);
    } else if (where !== 'temp') {
      ps._detach(ps.find(old.uid));
      if (where === 'hidden') {
        for (let i = 0; i < GEO.TEMP_SIZE; i++) giveItem(m, ps, FILLER, 'temp', i);
        ps.stow(old, { allowTemp: true });
      } else ps.hand[0] = old; // legacy/restored hand inventory is still owned
    }
    const before = ps.stats.itemMerges;
    const merged = ps.acquireItem(second);
    assert.equal(merged.id, recipe.fuseResult);
    assert.equal(ps.find(old.uid), null);
    assert.equal(ps._itemLocations(second).length, 0);
    assert.equal(ps.find(merged.uid).area, 'temp');
    assert.equal(ps.stats.itemMerges, before + 1);
    if (carrier) assert.deepEqual(carrier.items, [unrelated], 'the unrelated item survives a full carrier');
    assert.equal(m.itemPool.held(first), 0);
    assert.equal(m.itemPool.held(second), 0);
    assert.equal(m.itemPool.held(merged.id), m.itemPool.need(merged.id));
  });
}

test('shop purchase and a free reward both fuse instead of requiring an equip action', t => {
  const { ps } = setup(t);
  const r = pairs[0];
  ps.acquireItem(r.id);
  ps.shop.slots = [{ kind: 'item', id: r.fuseWith, basePrice: 3, sold: false }];
  assert.ok(ps.buy(0).ok);
  assert.equal(ps._itemLocations(r.fuseResult).length, 1);
  ps.acquireItem(r.id);
  ps.pushItemOffer([r.fuseWith]);
  assert.ok(ps.pickReward(0).ok);
  assert.equal(ps._itemLocations(r.fuseResult).length, 2);
});

test('a deferred prep-end grant keeps the equipped partner until the next prep releases it', t => {
  const { m, ps } = setup(t, 'band_equipment');
  const r = pairs[0];
  const carrier = give(m, ps, OP, 'hand');
  const old = ps.acquireItem(r.id);
  assert.ok(ps.equip(old.uid, carrier.uid).ok);
  for (let i = 0; i < GEO.TEMP_SIZE; i++) giveItem(m, ps, FILLER, 'temp', i);
  const gained = ps.acquireItem(r.fuseWith, { deferMerge: true, toTemp: true });
  assert.equal(gained.id, r.fuseWith);
  assert.equal(gained.deferMerge, true);
  assert.equal(gained.pendingFusion, true);
  assert.deepEqual(carrier.items.map((it) => it.id), [r.id]);
  assert.equal(ps._itemLocations(r.fuseResult).length, 0);
  assert.equal(ps.offers.length, 0, '精巧设计 waits for the combination');
  assert.ok(ps.find(gained.uid).idx >= GEO.TEMP_SIZE);
  ps.checkItemMerges();
  assert.equal(ps.find(old.uid)?.piece, old, 'a merge scan that does not release the mark leaves the partner equipped');
  assert.equal(gained.deferMerge, true);
  assert.equal(ps._itemLocations(r.fuseResult).length, 0);
  const before = ps.stats.itemMerges;
  ps.checkItemMerges({ releaseDeferred: true });
  assert.deepEqual(carrier.items, []);
  assert.equal(ps.stats.itemMerges, before + 1);
  const merged = ps._itemLocations(r.fuseResult)[0].piece;
  assert.equal(merged.deferMerge, undefined);
  assert.equal(merged.pendingFusion, undefined);
  assert.equal(ps.find(gained.uid), null);
  assert.notEqual(ps.find(merged.uid).area, 'equipped');
  assert.equal(ps.offers.length > 0, true);
});

test('a scroll copy does not fuse an equipped partner until deferred marks release', t => {
  const { m, ps } = setup(t, 'band_copy');
  const r = pairs[0];
  const otherId = Object.keys(data.chess).find((id) => {
    const c = data.chess[id];
    return c && !c.isGolden && !c.isDiy && id !== OP && m.pool.has(m.gd.baseIdOf(id));
  });
  assert.ok(otherId);
  const x = give(m, ps, OP, 'hand');
  const y = give(m, ps, otherId, 'hand');
  // giveItem skips acquireItem, so the two components can be equipped without combining first.
  const wornA = giveItem(m, ps, r.id, 'temp', 0);
  const wornB = giveItem(m, ps, r.fuseWith, 'temp', 1);
  assert.ok(ps.equip(wornA.uid, x.uid).ok);
  assert.ok(ps.equip(wornB.uid, y.uid).ok);
  beginCommandPrep(ps);
  const view = commandView(ps);
  assert.equal(view.effectId, 'aceffect_band_96');
  assert.equal(view.usable, true);
  assert.ok(ps.useCommand(view.effectId, { uid: x.uid }).ok);
  const copy = ps.allChess().find((p) => p !== x && p.id === x.id);
  assert.ok(copy);
  assert.deepEqual(x.items.map((it) => it.id), [r.id]);
  assert.deepEqual(y.items.map((it) => it.id), [r.fuseWith]);
  assert.deepEqual(copy.items.map((it) => it.id), [r.id]);
  assert.equal(copy.items[0].deferMerge, true);
  assert.equal(copy.items[0].pendingFusion, true);
  assert.equal(ps._itemLocations(r.fuseResult).length, 0);
  ps.checkItemMerges();
  assert.deepEqual(y.items.map((it) => it.id), [r.fuseWith]);
  assert.equal(ps._itemLocations(r.fuseResult).length, 0);
  ps.checkItemMerges({ releaseDeferred: true });
  assert.deepEqual(y.items, [], 'the partner comes off only when deferred fusion runs');
  assert.deepEqual(x.items.map((it) => it.id), [r.id]);
  assert.deepEqual(copy.items, []);
  const merged = ps._itemLocations(r.fuseResult)[0];
  assert.equal(merged.area === 'equipped', false);
  assert.equal(merged.piece.pendingFusion, undefined);
});

test('no item pool means no combination and no throw', t => {
  const { m, ps } = setup(t);
  const r = pairs[0];
  const old = ps.acquireItem(r.id);
  const incoming = ps.acquireItem(r.fuseWith, { deferMerge: true });
  assert.equal(incoming.pendingFusion, true);
  const pool = m.itemPool;
  m.itemPool = null;
  try {
    assert.equal(ps._itemFusionPartner(r.id), null);
    assert.equal(ps._itemFusionPartner(r.fuseWith), null);
    ps.checkItemMerges({ releaseDeferred: true });
    assert.equal(ps.find(old.uid)?.piece, old);
    assert.equal(ps.find(incoming.uid)?.piece, incoming);
    assert.equal(ps._itemLocations(r.fuseResult).length, 0);
  } finally {
    m.itemPool = pool;
  }
});

test('displayed components consumed by fusion leave no shared-stock debt behind', t => {
  const { m, ps } = setup(t);
  const r = pairs[0];
  for (let i = 0; i < m.itemPool.cap(r.fuseWith); i++) giveItem(m, ps, r.fuseWith, 'temp', GEO.TEMP_SIZE + i);
  ps.acquireItem(r.id); // consumes one owned partner
  // Fill back to the cap without gaining through the production path: the shop card was already displayed.
  giveItem(m, ps, r.fuseWith, 'temp', ps.temp.length);
  const first = giveItem(m, ps, r.id, 'temp', ps.temp.length);
  assert.equal(m.itemPool.left(r.fuseWith), 0);
  const result = ps.acquireItem(r.fuseWith, { displayed: true });
  assert.equal(result.id, r.fuseResult);
  assert.equal(ps.find(first.uid), null);
  assert.equal(m.itemPool.debtOf(r.fuseWith), 0);
});

test('Mechanist: fusion and same-name promotion share the per-round reward allowance, reset next round', t => {
  const { ps } = setup(t, 'band_equipment');
  const p = commandSkill(ps).buffs.find(b => b.key === 'promote_equip_extra_award').bb;
  const r = pairs[0];
  assert.equal(p.n, 1);
  ps.acquireItem(r.id);
  assert.equal(ps.offers.length, 0, 'one component does not trigger a reward');
  ps.acquireItem(r.fuseWith);
  assert.equal(ps.offers.length, p.select_count);
  assert.equal(ps.offers[0].slots.length, p.count);
  ps.acquireItem(FILLER); ps.acquireItem(FILLER);
  ps.acquireItem(pairs[1].id); ps.acquireItem(pairs[1].fuseWith);
  assert.equal(ps.offers.length, p.select_count, 'later promotions/fusions do not repeat the reward');
  ps.m.round++;
  ps.startRound(ps.m.round);
  ps.acquireItem(r.id); ps.acquireItem(r.fuseWith);
  assert.equal(ps.offers.length, p.select_count * 2);
});

test('a full row with a visible partner has room for its result and emits no temporary-component stash notices', t => {
  const { m, ps } = setup(t);
  const r = pairs[0];
  ps.acquireItem(r.id);
  for (let i = 0; i < GEO.TEMP_SIZE - 1; i++) giveItem(m, ps, FILLER, 'temp', i);
  const notices = [];
  const toast = m.toast.bind(m);
  m.toast = (...args) => { notices.push(args); return toast(...args); };
  const result = ps.acquireItem(r.fuseWith);
  assert.ok(ps.find(result.uid).idx < GEO.TEMP_SIZE);
  assert.equal(notices.length, 0);
});

test('fusion hooks see the complete inventory and fire one merge, one gain and no equip', t => {
  const { m, ps } = setup(t);
  const r = pairs[0];
  const old = ps.acquireItem(r.id);
  const seen = [];
  const dispatch = m.dispatch.bind(m), item = m.dispatchItem.bind(m);
  const check = (hook) => {
    assert.equal(ps._itemLocations(r.id).length, 0);
    assert.equal(ps._itemLocations(r.fuseWith).length, 0);
    assert.equal(ps._itemLocations(r.fuseResult).length, 1);
    assert.equal(m.itemPool.held(r.id), 0);
    assert.equal(m.itemPool.held(r.fuseWith), 0);
    seen.push(hook);
  };
  m.dispatch = (owner, hook, ev, ...rest) => {
    if (owner === ps && ['onMerge', 'onGain'].includes(hook)) { check(hook); assert.equal(ev.piece.id, r.fuseResult); }
    return dispatch(owner, hook, ev, ...rest);
  };
  m.dispatchItem = (owner, it, holder, hook, ev) => {
    if (owner === ps) check(hook);
    return item(owner, it, holder, hook, ev);
  };
  const result = ps.acquireItem(r.fuseWith);
  assert.equal(ps.find(old.uid), null);
  assert.equal(ps.find(result.uid).area, 'temp');
  assert.deepEqual(seen, ['onDestroy', 'onDestroy', 'onMerge', 'onGain']);
});

for (const fault of ['missing result', 'result stock']) test(`fusion keeps both components when ${fault} is unavailable`, t => {
  const { m, ps } = setup(t);
  const r = pairs[0];
  const old = ps.acquireItem(r.id);
  const item = m.gd.item.bind(m.gd), canGain = m.itemPool.canGain.bind(m.itemPool);
  if (fault === 'missing result') m.gd.item = id => id === r.fuseResult ? null : item(id);
  else m.itemPool.canGain = id => id === r.fuseResult ? false : canGain(id);
  const before = ps.stats.itemMerges;
  const incoming = ps.acquireItem(r.fuseWith);
  assert.equal(incoming.id, r.fuseWith);
  assert.ok(ps.find(old.uid));
  assert.ok(ps.find(incoming.uid));
  assert.equal(ps.stats.itemMerges, before);
});
