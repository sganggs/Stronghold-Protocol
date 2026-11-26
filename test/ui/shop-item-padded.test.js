// test/ui/shop-item-padded.test.js — the shop card's equip icon prefers the padded item sprite of the local
// client's extraction (`data/local-assets.json` groups.item, tools/local-extract: every shop item sprite
// exported at its serialized m_Rect canvas instead of the trimmed mirror copy). The fetched `items` entry
// stays the trimmed export, which the DOM slots show with `object-fit: contain`; when the extraction is
// missing the card model falls back to it (and the equip node renders the trimmed stretch, never a 404).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { localItemIconUrl, itemIconUrl } from '../../public/js/ui/assetUrls.js';
import { cardModelFromSlot } from '../../public/js/ui/shop/adapter/model.js';
import { withContent as withContentSet } from '../helpers/contentSet.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ITEMS = JSON.parse(readFileSync(path.join(ROOT, 'data', 'items.json'), 'utf8'));
const ITEM_ID = 'chess_item_1_01_e_a';
const TRAP = 'trap_1041_acarm041';
const TRIMMED = '/assets/item/trap_1041_acarm041.png';
const PADDED = '/assets/local/item/trap_1041_acarm041.png';
const ENTRY = { path: PADDED, w: 160, h: 160, kind: 'Sprite' };

/** The local-art manifest as tools/local-extract writes it, with or without the padded item group. */
const localManifest = (entries) => ({ groups: entries ? { item: entries } : {} });

/** Runs `fn` with the store holding an assets/items/local content set, then gives the server's files back. */
const withContent = (local, fn) => withContentSet(
  { items: ITEMS, assets: { items: { [TRAP]: TRIMMED } }, local }, fn, 'padded-item',
);

const itemModel = () => cardModelFromSlot({ kind: 'item', id: ITEM_ID, price: 1, basePrice: 1 }, 0, { funds: 10 });

test('the padded entry resolves for a record, a raw trap id and a fallback iconId', () => {
  const local = localManifest({ [TRAP]: ENTRY });
  assert.equal(localItemIconUrl(local, ITEMS[ITEM_ID]), PADDED);
  assert.equal(localItemIconUrl(local, TRAP), PADDED);
  assert.equal(localItemIconUrl(local, { iconId: TRAP }), PADDED, 'an iconId without a trapId still resolves');
});

test('a missing manifest, group, entry or path resolves to null', () => {
  assert.equal(localItemIconUrl(null, TRAP), null);
  assert.equal(localItemIconUrl({}, TRAP), null);
  assert.equal(localItemIconUrl(localManifest(null), TRAP), null, 'no item group (no extraction)');
  assert.equal(localItemIconUrl(localManifest({ other: ENTRY }), TRAP), null);
  assert.equal(localItemIconUrl(localManifest({ [TRAP]: { path: '' } }), TRAP), null, 'an empty path is not a URL');
});

test('the item card model prefers the padded sprite of the local extraction', () => {
  withContent(localManifest({ [TRAP]: ENTRY }), () => {
    const model = itemModel();
    assert.equal(model.icon, TRAP);
    assert.equal(model.iconFile, PADDED, 'the equip node draws the padded m_Rect canvas');
    assert.equal(itemIconUrl({ items: { [TRAP]: TRIMMED } }, ITEMS[ITEM_ID]), TRIMMED, 'the fetched entry is unchanged');
  });
});

test('without the local extraction the item card falls back to the fetched trimmed icon', () => {
  withContent(localManifest(null), () => {
    assert.equal(itemModel().iconFile, TRIMMED);
  });
});

test('a local extraction that does not list the item falls back to the fetched trimmed icon', () => {
  withContent(localManifest({ trap_1108_acdisney: { path: '/assets/local/item/trap_1108_acdisney.png', w: 160, h: 160 } }), () => {
    assert.equal(itemModel().iconFile, TRIMMED);
  });
});

test('chess cards are unaffected by the item group', () => {
  withContent(localManifest({ [TRAP]: ENTRY }), () => {
    const model = cardModelFromSlot({ kind: 'chess', id: 'chess_missing', price: 3, basePrice: 3 }, 0, { funds: 10 });
    assert.equal(model.iconFile, null);
    assert.equal(model.isChar, true);
  });
});
