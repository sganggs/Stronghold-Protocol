// test/ui/shop-diy.test.js — 自选编队 in the canvas shop: a filled DIY slot is its owner's picked operator, not the
// faceless base slot record. The card model composes the same `ownDiyRecord` the DOM card uses; the official card has
// no extra 自选 badge, so the model only changes what the card draws (name, art, class, bonds), not its shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { data } from '../../public/js/data.js';
import { cardModelFromSlot } from '../../public/js/ui/shop/adapter/model.js';
import { withContent as withContentSet } from '../helpers/contentSet.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));
const CHESS = read('chess.json');
const BACKUPS = read('backups.json');
const ASSETS = read('assets.json');

const SLOT_ID = 'chess_char_6_diy1_a';
const PICK_ID = 'char_003_kalts';

/** The client's content set with chess/backups/assets, then the server's files back. */
const withContent = (fn) => withContentSet({ chess: CHESS, backups: BACKUPS, assets: ASSETS }, fn, 'shop-diy');

test('a filled DIY slot draws the picked operator while keeping the slot tier and price', () => {
  withContent(() => {
    const base = data.lookup('chess', SLOT_ID);
    const priv = { funds: 10, shop: { level: 4 }, diy: { [SLOT_ID]: { charId: PICK_ID, skillIndex: 1 } } };
    const model = cardModelFromSlot({ kind: 'chess', id: SLOT_ID, price: 4, basePrice: 4 }, 0, priv);
    assert.equal(base.isDiy, true);
    assert.equal(model.name, BACKUPS.units[PICK_ID].name);
    assert.notEqual(model.name, base.name);
    assert.equal(model.tier, base.tier);
    assert.equal(model.price, 4);
    assert.ok(model.portraitFile);
    assert.equal(model.profession, BACKUPS.units[PICK_ID].profession);
  });
});

test('an unfilled DIY slot keeps the slot record', () => {
  withContent(() => {
    const priv = { funds: 10, shop: { level: 4 }, diy: {} };
    const model = cardModelFromSlot({ kind: 'chess', id: SLOT_ID, price: 4, basePrice: 4 }, 0, priv);
    assert.equal(model.name, data.lookup('chess', SLOT_ID).name);
  });
});

test('a stand-in chess draws the stand-in body while keeping the chess identity', () => {
  withContent(() => {
    const base = data.lookup('chess', 'chess_char_5_01_a');
    const standIn = BACKUPS.units.char_600_cpione;
    const priv = { funds: 10, shop: { level: 4 }, standIns: ['chess_char_5_01_a'] };
    const model = cardModelFromSlot({ kind: 'chess', id: 'chess_char_5_01_a', price: base.price, basePrice: base.price }, 0, priv);
    assert.equal(model.name, standIn.name);
    assert.equal(model.profession, standIn.profession);
    assert.equal(model.tier, base.tier);
    assert.equal(model.price, base.price);
    assert.ok(model.portraitFile);
  });
});
