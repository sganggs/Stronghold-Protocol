// test/ui/shop-card-reuse.test.js — one card view is reused across slot kinds. The normal row has an
// operator card where the reward row later puts an offer item; the chess render switches `equip` off, so
// the item render must switch it back on or the icon is uploaded but never drawn (GitHub #973).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AutoChessBattleShopCardView } from '../../public/js/ui/shop/cardView.js';

test('a chess card view reused for an item re-activates its equip node', () => {
  const view = Object.create(AutoChessBattleShopCardView.prototype);
  view.model = { iconFile: '/assets/item.png', icon: 'trap_1', name: '装备' };
  const equip = { name: 'equip', active: false, image: { type: 'simple' } };
  const tree = { name: 'root', children: [equip, { name: 'eqiup_name', text: {} }] };

  view.renderEquip(tree);

  assert.equal(equip.active, true, 'the equip node must be active when the card turns into an item');
  assert.equal(equip.image.file, '/assets/item.png');
  assert.equal(equip.image.sprite, 'trap_1');
});
