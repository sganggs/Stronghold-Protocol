import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitShopSlots } from '../../public/js/ui/shopBar.js';

const chess = id => ({ kind: 'chess', id, price: 4 });
const item = id => ({ kind: 'item', id, price: 2 });

test('existing operator cards are never treated as equipment because of an older layout', () => {
  const slots = [chess('a'), chess('b'), chess('c'), chess('d'), item('equipment')];
  const rows = splitShopSlots(slots, { chess: 3, item: 1 });
  assert.deepEqual(rows.chess.map(x => x.i), [0, 1, 2, 3]);
  assert.deepEqual(rows.item.map(x => x.i), [4]);
  assert.equal(rows.chess[3].s, slots[3], 'preserve the real card, price and original purchase index');
});

test('equipment cards remain equipment when the advertised operator row is longer', () => {
  const slots = [chess('a'), item('equipment')];
  const rows = splitShopSlots(slots, { chess: 3, item: 0 });
  assert.deepEqual(rows.chess.map(x => x.i), [0]);
  assert.deepEqual(rows.item.map(x => x.i), [1]);
});

test('layout preserves empty equipment positions, including the first-season unlock after an upgrade', () => {
  const slots = [chess('a'), null, null];
  const rows = splitShopSlots(slots, { chess: 2, item: 1 });
  assert.deepEqual(rows.chess.map(x => x.i), [0, 1]);
  assert.deepEqual(rows.item, [{ s: null, i: 2 }]);
  assert.deepEqual(splitShopSlots(slots.slice(0, 2), { chess: 2, item: 0 }).item, []);
});

test('sold cards retain their actual kind and all cards survive classification exactly once', () => {
  const slots = [item('e'), { ...chess('c'), sold: true }, null, item('e2')];
  const rows = splitShopSlots(slots, { chess: 1, item: 1 });
  assert.deepEqual(rows.chess.map(x => x.i), [1, 2]);
  assert.deepEqual(rows.item.map(x => x.i), [0, 3]);
  assert.deepEqual([...rows.chess, ...rows.item].map(x => x.i).sort(), [0, 1, 2, 3]);
});

test('frames without layout retain kind-based grouping and operator empty slots', () => {
  const slots = [chess('c'), null, item('e')];
  const rows = splitShopSlots(slots);
  assert.deepEqual(rows.chess.map(x => x.i), [0, 1]);
  assert.deepEqual(rows.item.map(x => x.i), [2]);
});
