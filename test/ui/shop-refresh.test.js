// test/ui/shop-refresh.test.js — refresh must not drop the theme's name/bond colours.
// The card model carries both the resolved fields and the theme colour map; after a row refresh the fields
// can fall back to the built-in white defaults while the map still has the pack colours (or vice versa).
// cardRenderModel resolves the map first, so RenderView cannot keep a white clone.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardThemeColors, cardRenderModel } from '../../public/js/ui/shop/slots.js';

const MODEL = {
  slotId: 1,
  id: 'chess_char_1_01_a',
  nameColor: '#FFFFFF',
  bondColor: '#B7B7B7',
  colors: { chessNameColor: '#000000', bondColor: '#000000' },
};

test('theme colours win over the built-in white defaults after refresh', () => {
  assert.deepEqual(cardThemeColors(MODEL), { nameColor: '#000000', bondColor: '#000000' });
  const rendered = cardRenderModel(MODEL);
  assert.equal(rendered.nameColor, '#000000');
  assert.equal(rendered.bondColor, '#000000');
  assert.equal(rendered.id, MODEL.id);
});

test('a model that already has the theme colours is reused unchanged', () => {
  const already = { ...MODEL, nameColor: '#000000', bondColor: '#000000' };
  assert.equal(cardRenderModel(already), already);
});

test('a model without the colour map keeps its resolved fields', () => {
  const bare = { id: 'x', nameColor: '#123456', bondColor: '#654321' };
  assert.deepEqual(cardThemeColors(bare), { nameColor: '#123456', bondColor: '#654321' });
  assert.equal(cardRenderModel(bare).nameColor, '#123456');
});
