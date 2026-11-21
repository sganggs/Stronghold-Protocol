// test/ui/shop-special-refresh.test.js — a queued rewardOffer is a pick-one reward, not a shop
// refresh. views.js collapses every non-merge offer (promotion, item voucher, command) to 'special'
// for the header, so the adapter must not derive isSpecRefresh from it; the special refresh needs
// its own server state (佩佩 博学多通, 德克萨斯 …).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shopModelFromPrivate } from '../../public/js/ui/shop/adapter/model.js';

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
});
