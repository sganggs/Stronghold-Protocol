// test/ui/shop-garrison.test.js — P2: the tier 6 garrison mark is the official third colour, not a default grey.
// reference/card/card2.js:388-394 maps LV6 -> garrisonIconColor3; the product's theme importer used to drop
// colours 2/3 because ui-theme.css has no custom property for them, so cardModelFromSlot fell back to white.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { garrisonTintFor } from '../../public/js/ui/shop/adapter/model.js';

const COLORS = {
  garrisonIconColor1: '#E5E5E580',
  garrisonIconColor2: '#FFFFFF66',
  garrisonIconColor3: '#96E1EA',
};

test('garrison tint follows the official tier mapping', () => {
  assert.equal(garrisonTintFor(COLORS, 1), '#E5E5E580');
  assert.equal(garrisonTintFor(COLORS, 4), '#E5E5E580');
  assert.equal(garrisonTintFor(COLORS, 5), '#FFFFFF66');
  assert.equal(garrisonTintFor(COLORS, 6), '#96E1EA');
});

test('missing theme colours fall back to white, not a hard-coded tint', () => {
  assert.equal(garrisonTintFor({}, 6), '#FFFFFF');
  assert.equal(garrisonTintFor({ garrisonIconColor3: '#123456' }, 6), '#123456');
});
