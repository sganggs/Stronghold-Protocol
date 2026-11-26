// test/ui/shop-cost.test.js — the upgrade/card cost view contract (ui/shop/widgets.js ShopCostView)
// and the upgrade price colour the model feeds it. Add-only: the normal number carries the calculated
// colour, the grey number stays #C0C5C3, and the grey/normal group is the affordability toggle.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ShopCostView } from '../../public/js/ui/shop/widgets.js';
import { shopModelFromPrivate } from '../../public/js/ui/shop/adapter/model.js';

function textNode(name, color) {
  return { name, path: name, active: true, children: [], text: { text: '0', color, font: 'Novecentowide-Medium', size: 20 } };
}

function costView() {
  const normalText = textNode('text_num', '#FFC600');
  const greyText = textNode('text_num', '#C0C5C3');
  const normal = { name: 'root_normal', path: 'root_normal', active: true, children: [normalText] };
  const grey = { name: 'root_grey', path: 'root_grey', active: false, children: [greyText] };
  const root = { name: 'cost', path: 'cost', active: true, children: [normal, grey] };
  return { view: new ShopCostView({ root }), normal, grey, normalText, greyText };
}

test('affordable: normal group active, normal number carries the price colour', () => {
  const { view, normal, grey, normalText, greyText } = costView();
  view.Render(4, 5);
  view.SetPriceColor('#FFC600');
  assert.equal(normal.active, true);
  assert.equal(grey.active, false);
  assert.equal(normalText.text.color, '#FFC600');
  assert.equal(greyText.text.color, '#C0C5C3', 'grey number never turns red');
});

test('not affordable: grey group active, grey number keeps #C0C5C3', () => {
  const { view, normal, grey, normalText, greyText } = costView();
  view.Render(5, 4);
  view.SetPriceColor('#FFC600');
  assert.equal(normal.active, false);
  assert.equal(grey.active, true);
  assert.equal(normalText.text.color, '#FFC600', 'hidden normal number keeps the calculated colour');
  assert.equal(greyText.text.color, '#C0C5C3');
  assert.equal(greyText.text.text, '5');
});

test('upgradeCostColor is the normal price colour, not a red unaffordable colour', () => {
  const model = shopModelFromPrivate({
    funds: 0,
    shop: { level: 5, maxLevel: 6, upgradePrice: 5, slots: [] },
  });
  assert.equal(model.upgradeCostColor, '#FFC600');
  assert.equal(model.upgradeCost, 5);
});
