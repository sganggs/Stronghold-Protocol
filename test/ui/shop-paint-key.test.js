// test/ui/shop-paint-key.test.js — W98: a late theme colour must repaint without a fold/unfold.
// The host's model key covers the painted card fields; garrisonTint is one of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shopModelPaintKey } from '../../public/js/ui/shop/host.js';

const model = (over = {}) => ({
  avalid: true,
  unfold: true,
  level: 6,
  maxLevel: 6,
  coinCount: 10,
  refreshCost: 1,
  upgradeCost: 0,
  freeRefreshCnt: 0,
  isFrozen: false,
  isSpecRefresh: false,
  isSpecialRecruit: false,
  remainCharCnt: 3,
  refreshSeq: 0,
  selectSlot: null,
  slots: [{
    slotId: 1, id: 'chess_char_6_01_a', isEmpty: false, isFrozen: false,
    price: 5, srcPrice: 5, currCoin: 10, tier: 6, level: 6, armed: false, armedAt: 0,
    isHandFull: false, hasSame: false, canComb: false, hasFusePartner: false,
    name: '蕾缪安', nameColor: '#000000', bondColor: '#000000',
    portraitFile: '/p.png', profMarkFile: '/m.png', garrisonIconFile: '/g.png',
    garrisonTint: '#FFFFFF33', iconFile: null, bondList: [],
  }],
  ...over,
});

test('garrisonTint changing alone changes the repaint key', () => {
  const before = shopModelPaintKey(model());
  const after = shopModelPaintKey({
    ...model(),
    slots: [{ ...model().slots[0], garrisonTint: '#96E1EA' }],
  });
  assert.notEqual(before, after);
});

test('garrison file/colour and the unchanged model are stable', () => {
  assert.equal(shopModelPaintKey(model()), shopModelPaintKey(model()));
  const file = shopModelPaintKey({
    ...model(),
    slots: [{ ...model().slots[0], garrisonIconFile: '/other.png' }],
  });
  assert.notEqual(file, shopModelPaintKey(model()));
});
