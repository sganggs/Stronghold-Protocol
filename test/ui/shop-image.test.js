// test/ui/shop-image.test.js — PORT-DIFF P1: an empty content slot must not draw a solid quad.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawsShape } from '../../public/js/render/shop/cardWebgl.js';

const card = { materials: {}, sub: {} };

test('empty file + empty sprite is not drawable, even with a colour', () => {
  assert.equal(drawsShape({ image: { type: 'simple', color: '#FFFFFF', file: null, sprite: null } }, card), false);
  assert.equal(drawsShape({ image: { type: 'simple', color: '#123456' } }, card), false);
});

test('a file draws; an external or sprite-only image does not', () => {
  assert.equal(drawsShape({ image: { file: '/sprites/x.webp', sprite: 'x' } }, card), true);
  assert.equal(drawsShape({ image: { file: '/sprites/x.webp', sprite: 'x', external: true } }, card), false);
  assert.equal(drawsShape({ image: { sprite: 'x' } }, card), false);
});
