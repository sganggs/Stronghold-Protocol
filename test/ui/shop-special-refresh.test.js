// test/ui/shop-special-refresh.test.js — a queued rewardOffer is a pick-one reward, not a shop
// refresh. views.js collapses every non-merge offer (promotion, item voucher, command) to 'special'
// for the header, so the adapter must not derive isSpecRefresh from it; the special refresh needs
// its own server state (佩佩 博学多通, 德克萨斯 …).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { shopModelFromPrivate } from '../../public/js/ui/shop/adapter/model.js';
import { PlayerEconomy } from '../../server/match/player/economy.js';
import { bandMetaHandler } from '../../server/sim/content/bands/meta.js';

const SHOP_ASSET = new URL('../../public/assets/local/themes/ac_s_closur/shop.json', import.meta.url);

test('a queued reward offer does not light the refresh special effect', () => {
  const p = shopModelFromPrivate({
    funds: 9,
    shop: {
      level: 1,
      slots: [],
      rewardOffer: { source: 'special', label: '一次性促销券', slots: [{ kind: 'item', id: 'item_1', price: 0, sold: false }] },
    },
  }, {});
  assert.equal(p.isSpecRefresh, false, 'a pick-one reward is not a special shop refresh');
  assert.equal(p.isSpecialRecruit, false, 'nor does it select the special slots clip');
});

test('the server roll marker selects the special slots clip but not the ctrl special state', () => {
  const p = shopModelFromPrivate({
    funds: 9,
    shop: { level: 2, slots: [], refreshSeq: 4, specialRefresh: true },
  }, {});
  assert.equal(p.isSpecialRecruit, true, 'the slots clip reads the server flag');
  assert.equal(p.isSpecRefresh, false, 'the button reads the pending charge, which this roll already spent');
  assert.equal(p.refreshSeq, 4);
  const normal = shopModelFromPrivate({ funds: 9, shop: { level: 2, slots: [], refreshSeq: 5 } }, {});
  assert.equal(normal.isSpecialRecruit, false);
  assert.equal(normal.isSpecRefresh, false);
});

test('佩佩 levels 2/4/6 arm one special refresh each; the next refresh marks it and normal refreshes do not',
  () => {
    const handler = bandMetaHandler('band_pepe');
    assert.ok(handler, '佩佩 has prep hooks');
    const counters = new Map();
    let marked = 0;
    let armed = 0;
    const ctx = {
      counter: (k) => counters.get(k) || 0,
      incCounter: (k, n = 1) => { const v = (counters.get(k) || 0) + n; counters.set(k, v); return v; },
      shopSlots: () => [{ kind: 'chess', id: 'a' }, { kind: 'chess', id: 'b' }],
      gd: { chess: () => ({ bonds: [] }) },
      shopLevel: () => 2,
      rollChess: () => null,
      setShopSlot: () => true,
      markSpecialRefresh: () => { marked += 1; return true; },
      armSpecialRefresh: () => { armed += 1; return true; },
    };
    handler.onLevelUp(ctx, { level: 3 });
    assert.equal(ctx.counter('band:pepe:special'), 0, 'a non-listed level arms nothing');
    assert.equal(armed, 0, 'a non-listed level does not light the button either');
    for (const level of [2, 4, 6]) handler.onLevelUp(ctx, { level });
    assert.equal(ctx.counter('band:pepe:special'), 3, 'each listed level arms exactly one charge');
    assert.equal(armed, 3, 'the upgrade itself shows the special state, before any refresh');
    assert.equal(marked, 0, 'level-up itself is not the special roll');
    handler.onRefresh(ctx);
    assert.equal(marked, 1, 'the first manual refresh after arming is the special refresh');
    assert.equal(ctx.counter('band:pepe:special'), 2);
    handler.onRefresh(ctx);
    assert.equal(marked, 2);
    assert.equal(ctx.counter('band:pepe:special'), 1);
    handler.onRefresh(ctx);
    assert.equal(marked, 3);
    assert.equal(ctx.counter('band:pepe:special'), 0);
    handler.onRefresh(ctx);
    assert.equal(marked, 3, 'a normal refresh does not mark special');
  });

test('rollShop bumps refreshSeq and marks only the roll that consumes a special-refresh charge', () => {
  const fake = (bondRefresh) => ({
    shop: {
      level: 1, slots: [], layout: { chess: 1, item: 0 }, refreshSeq: 7, specialRefresh: false,
      ...(bondRefresh ? { bondRefresh } : {}),
    },
    gd: {
      shopSlots: () => ({ chess: 1, item: 0 }),
      chess: () => ({ bonds: ['pepe'] }),
      chessPrice: () => 2,
      itemPrice: () => 2,
    },
    _consumeTestShop: () => false,
    _applyBondRefresh: PlayerEconomy.prototype._applyBondRefresh,
    _rollChessSlot: () => ({ kind: 'chess', id: 'c1', basePrice: 2, frozen: false, sold: false }),
    diyRollEntries: () => [],
    dirty() {},
  });
  const special = fake([{ bond: 'pepe', count: 1 }]);
  PlayerEconomy.prototype.rollShop.call(special);
  assert.equal(special.shop.refreshSeq, 8);
  assert.equal(special.shop.specialRefresh, true);
  assert.equal(special.shop.bondRefresh, undefined, 'the charge is consumed');
  const model = shopModelFromPrivate({ funds: 10, shop: special.shop });
  assert.equal(model.isSpecialRecruit, true, 'the rolled private state reaches the slots clip choice');
  assert.equal(model.isSpecRefresh, false, 'the charge was spent by this roll');
  assert.equal(model.refreshSeq, 8);
  const normal = fake(null);
  normal.shop.slots = [{ kind: 'chess', id: 'c1', basePrice: 2, frozen: false, sold: false }];
  PlayerEconomy.prototype.rollShop.call(normal);
  assert.equal(normal.shop.refreshSeq, 8);
  assert.equal(normal.shop.specialRefresh, false);
  normal.shop.slots = [{ kind: 'chess', id: 'c1', basePrice: 2, frozen: false, sold: false }];
  PlayerEconomy.prototype.rollShop.call(normal);
  assert.equal(normal.shop.refreshSeq, 9, 'each roll advances the server sequence');
});

test('an armed charge draws the button before its roll and the roll clears the arm', () => {
  // 佩佩's level-up arms the charge: the button is already special, the row has not changed yet.
  const armedOnly = shopModelFromPrivate({
    funds: 9,
    shop: { level: 2, slots: [], refreshSeq: 4, specialRefresh: false, specialRefreshArmed: true },
  }, {});
  assert.equal(armedOnly.isSpecRefresh, true, 'the button shows the waiting special refresh at once');
  assert.equal(armedOnly.isSpecialRecruit, false, 'no roll has happened, so no panel clip');

  // The roll that spends it: the button is driven by the charge alone (C# isSpecRefresh ← ShopData.specialRefresh),
  // so it returns to normal while the row keeps the special slots clip.
  const spent = shopModelFromPrivate({
    funds: 9,
    shop: { level: 2, slots: [], refreshSeq: 5, specialRefresh: true, specialRefreshArmed: false },
  }, {});
  assert.equal(spent.isSpecRefresh, false, 'the charge is gone, so the button is back to normal');
  assert.equal(spent.isSpecialRecruit, true, 'the row itself is still the special one');

  const after = shopModelFromPrivate({
    funds: 9,
    shop: { level: 2, slots: [], refreshSeq: 6, specialRefresh: false, specialRefreshArmed: false },
  }, {});
  assert.equal(after.isSpecRefresh, false, 'the next normal roll returns the button to normal');
});

test('the extracted panel clips keep the official normal/special lengths and root_fx timeline',
  { skip: !existsSync(SHOP_ASSET) && 'shop.json asset is not present' }, () => {
    const doc = JSON.parse(readFileSync(SHOP_ASSET, 'utf8'));
    const clips = doc.prefabs.panel_shop_main.clips;
    assert.equal(clips.whole_card_refresh_normal.len, 0.1);
    assert.equal(clips.whole_card_refresh_special.len, 1.3333);
    const special = clips.whole_card_refresh_special.curves;
    const gradActive = special.find(([path, prop]) => path === 'root_fx/grad' && prop === 'active');
    const particlesActive = special.find(([path, prop]) => path === 'root_fx/particle_ctrl' && prop === 'active');
    assert.deepEqual(gradActive[2].map(([t, v]) => [t, v]), [[0, 0], [0.0333, 1], [0.5667, 0]]);
    assert.deepEqual(particlesActive[2].map(([t, v]) => [t, v]), [[0, 0], [0.0167, 1], [1.3333, 0]]);
  });
