// test/ui/shop-card-reuse.test.js — one card view is reused across slot kinds. The normal row has an
// operator card where the reward row later puts an offer item; the chess render switches `equip` off, so
// the item render must switch it back on or the icon is uploaded but never drawn (GitHub #973).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AutoChessBattleShopCardView } from '../../public/js/ui/shop/cardView.js';
import { cardNeedsRebuild } from '../../public/js/ui/shop/slots.js';

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

test('a reused card root is rebuilt when the slot kind changes', () => {
  const empty = { slotId: 'slot-1', isEmpty: true, isChar: false };
  const filled = { slotId: 'slot-1', isEmpty: false, isChar: true };
  const item = { slotId: 'slot-1', isEmpty: false, isChar: false };

  assert.equal(cardNeedsRebuild(empty, filled), true, 'an empty slot that gains a chess card');
  assert.equal(cardNeedsRebuild(filled, item), true, 'an operator slot that becomes an item');
  assert.equal(cardNeedsRebuild(item, filled), true, 'an item slot that becomes an operator');
  assert.equal(cardNeedsRebuild(filled, { ...filled }), false, 'the same kind keeps the reused root');
  assert.equal(cardNeedsRebuild(null, filled), true, 'a new slot always builds a root');
});
