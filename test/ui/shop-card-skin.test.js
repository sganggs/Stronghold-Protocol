// test/ui/shop-card-skin.test.js — §37.273: the canvas shop card's operator portrait follows the shop owner's
// outfit exactly like the DOM card's `OperatorImage`. The card model takes the caller's `ownerSkin` resolver
// (the DOM card resolves the same store), and `cardPortraitFile` draws that picture; without a resolver, or
// without a chosen outfit for the operator, the card keeps the operator's own portrait.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardModelFromSlot, cardPortraitFile } from '../../public/js/ui/shop/adapter/model.js';
import { withContent as withContentSet } from '../helpers/contentSet.js';

const CHESS_ID = 'chess_char_1_01_a';
const CHAR_ID = 'char_498_inside';
const SKIN = 'char_498_inside@kitchen#2';
const BASE = '/assets/portrait/char_498_inside.webp';
const OUTFIT = '/assets/skin/char_498_inside_kitchen.webp';

/** A chess.json record and a composed manifest with one wearable picture outfit (docs/SKINS.md). */
const CHESS = { chessId: CHESS_ID, charId: CHAR_ID, tier: 1, profession: 'SNIPER', name: '隐现', bonds: [], garrisonIds: [] };
const MANIFEST = {
  chars: {
    [CHAR_ID]: {
      portrait: BASE,
      skins: { [SKIN]: { portrait: OUTFIT } },
    },
  },
};
const SLOT = Object.freeze({ kind: 'chess', id: CHESS_ID, price: 2, basePrice: 2 });

/** Runs `fn` with the client's content set holding the record and the manifest, then gives the files back. */
const withContent = (fn) => withContentSet({ chess: { [CHESS_ID]: CHESS }, assets: MANIFEST }, fn, 'shop-card-skin');

test('the card portrait takes the owner outfit the caller resolved', () => {
  withContent(() => {
    const ownerSkin = (charId) => (charId === CHAR_ID ? SKIN : null);
    const model = cardModelFromSlot(SLOT, 0, { funds: 10, playerId: 7 }, { ownerSkin });
    assert.equal(model.portraitFile, OUTFIT);
  });
});

test('without a resolver, or without a chosen outfit, the operator own portrait stays', () => {
  withContent(() => {
    assert.equal(cardModelFromSlot(SLOT, 0, { funds: 10 }).portraitFile, BASE);
    assert.equal(cardModelFromSlot(SLOT, 0, { funds: 10 }, { ownerSkin: () => null }).portraitFile, BASE);
    assert.equal(cardModelFromSlot(SLOT, 0, { funds: 10 }, { ownerSkin: () => '' }).portraitFile, BASE);
  });
});

test('an item card and a missing record have no portrait, whatever the resolver answers', () => {
  withContent(() => {
    const ownerSkin = () => SKIN;
    assert.equal(cardModelFromSlot({ kind: 'item', id: 'chess_item_1_01_e_a', price: 1 }, 0, { funds: 10 }, { ownerSkin }).portraitFile, null);
    assert.equal(cardModelFromSlot({ kind: 'chess', id: 'chess_missing', price: 3 }, 0, { funds: 10 }, { ownerSkin }).portraitFile, null);
  });
});

test('cardPortraitFile is the pure resolution the model uses', () => {
  assert.equal(cardPortraitFile(MANIFEST, CHESS, SKIN), OUTFIT);
  assert.equal(cardPortraitFile(MANIFEST, CHESS), BASE);
  assert.equal(cardPortraitFile(MANIFEST, CHESS, 'char_498_inside@missing#9'), BASE);
  assert.equal(cardPortraitFile(MANIFEST, null, SKIN), null);
});
