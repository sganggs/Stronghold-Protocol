// test/ui/skin-picker.test.js — the 皮肤 section of 干员调配 / 自选编队 (docs/SKINS.md, public/js/ui/skins.js +
// ui/skinPicker.js), against a COMPOSED asset manifest: the rows one operator offers, the display rules that decide
// whether the section exists at all and what art each tile draws, and the markup of the enlarged preview.
//
// The manifest here is what a browser sees after the cosmetic layers are laid: `chars[<charId>].skins[<skinKey>]`
// (docs/PLUGINS.md §9). It is put in front of the data store as a content set — the same store the app reads — so the
// picker's own lookup path (`data.get('assets')`) is the one under test, not a copy of it.
//
// The display rule is GLOBAL (hasAnySkinChoices): one operator with a wear-able skin shows the section for every
// operator, and an operator without one shows its 默认 tile alone. The older per-operator rule (hasSkinChoices) is kept
// as the single-operator criterion and tested as such.
import { readFileSync } from 'node:fs';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { data } from '../../public/js/data.js';
import { skinsStore, setSkin, clearSkin, setSkins, availableSkins, hasAnySkinChoices, hasSkinChoices, chosenSkin, parseStoredSkins } from '../../public/js/ui/skins.js';
import { SkinPreview } from '../../public/js/ui/skinPicker.js';

const OPERATOR = 'char_498_inside';
const OTHER = 'char_003_kalts';
const ILLUSTR_ONLY = 'char_4058_pepe';
const SKIN = 'char_498_inside@kitchen#2';
const SKIN2 = 'char_498_inside@winter#1';
const ART_ONLY = 'char_498_inside@art#9';

/** The picker's own source: the gate is a rule about where it is applied, and the module is hook-driven (no Node render). */
const PICKER_SRC = readFileSync(new URL('../../public/js/ui/skinPicker.js', import.meta.url), 'utf8');
const FIXTURE_ID = 'x'.repeat(64);

test('the normative picker order keeps the 0.3.1 cultivation section immediately after skins', () => {
  const docs = readFileSync(new URL('../../docs/SKINS.md', import.meta.url), 'utf8');
  assert.match(docs, /潜能与练度 immediately follows 皮肤/);
  assert.doesNotMatch(docs, /with 潜能与练度 last/);
  for (const [file, next] of [['loadout', '<${CultivationSection}'], ['diy', "${!ch.proto && onOps"]]) {
    const src = readFileSync(new URL(`../../public/js/screens/${file}.js`, import.meta.url), 'utf8');
    const skin = src.indexOf('<${SkinSection}');
    assert.ok(skin >= 0 && src.indexOf(next, skin) > skin);
  }
});

/**
 * The composed manifest (see the header): two wear-able skins, one art-only, one operator whose record has a picture and
 * no `skins` at all, one the plugin gave only a 立绘.
 */
const MANIFEST = {
  chars: {
    [OPERATOR]: {
      avatar: '/a/inside.png', portrait: '/p/inside_1.png', illust: '/i/inside.png',
      spine: { front: { skel: '/s/inside/front.skel', atlas: '/s/inside/front.atlas', textures: ['/s/inside/front.png'], anims: { idle: 'Idle' } } },
      skins: {
        [SKIN]: {
          name: '厨房', group: '罗德厨房', avatar: '/a/kitchen.png', portrait: '/p/kitchen_1.png', illust: '/i/kitchen.png',
          spine: { front: { skel: '/s/kitchen/front.skel', atlas: '/s/kitchen/front.atlas', textures: ['/s/kitchen/front.png'], anims: { idle: 'Idle' } } },
        },
        // no art of its own at all: the tiles show the OPERATOR's (never a placeholder), and it is still wear-able
        [SKIN2]: {
          name: '严冬', group: '',
          spine: { front: { skel: '/s/winter/front.skel', atlas: '/s/winter/front.atlas', textures: ['/s/winter/front.png'], anims: { idle: 'Idle' } } },
        },
        // art but no model: shown nowhere, offered nowhere
        [ART_ONLY]: { name: '只有画', group: '', avatar: '/a/art.png' },
      },
    },
    // a record the plugin wrote no skin under: still one 默认 row (the section shows it once any operator has a skin)
    [OTHER]: { avatar: '/a/kalts.png', portrait: '/p/kalts_1.png' },
    // a plugin that replaces the operator's 立绘 and gives it no skin at all
    [ILLUSTR_ONLY]: { illust: '/i/pepe.png' },
  },
};

/** Swap the composed manifest for one block of assertions and put the fixture back (`data.setContent` is process-wide). */
function withManifest(assets, fn) {
  data.setContent({ id: 'y'.repeat(64), values: { assets } });
  try { fn(); } finally { data.setContent({ id: FIXTURE_ID, values: { assets: MANIFEST } }); }
}

before(() => { data.setContent({ id: FIXTURE_ID, values: { assets: MANIFEST } }); });
after(() => { data.setContent(null); setSkins({}); });

describe('皮肤 picker: what one operator offers', () => {
  test('one row per skin of the composed manifest, plus the operator\'s own 默认 row first', () => {
    const rows = availableSkins(OPERATOR);
    assert.deepEqual(rows.map((r) => r.id), ['', SKIN, SKIN2, ART_ONLY]);
    assert.equal(rows[0].own, true);
    assert.equal(rows[0].portrait, '/i/inside.png', 'the 默认 tile draws the 立绘 the plugin gives the operator');
    assert.equal(rows[0].illust, '/i/inside.png');
    assert.equal(rows[0].avatar, '/a/inside.png');
  });

  test('the 默认 row exists even for a record the plugins wrote no `skins` under (the global rule shows its section)', () => {
    const rows = availableSkins(OTHER);
    assert.deepEqual(rows.map((r) => r.id), ['']);
    assert.equal(rows[0].own, true);
    assert.equal(rows[0].portrait, '/p/kalts_1.png', 'no 立绘 of its own: the portrait is the tile art');
    assert.equal(rows[0].illust, '/p/kalts_1.png');
  });

  test('a 立绘 with no skin at all is drawn (the 默认 tile falls back 立绘 → portrait → avatar, never to an empty box)', () => {
    const rows = availableSkins(ILLUSTR_ONLY);
    assert.deepEqual(rows.map((r) => r.id), ['']);
    assert.equal(rows[0].portrait, '/i/pepe.png', 'the picture the plugin wrote is the tile art');
    assert.equal(rows[0].avatar, null, 'nothing invented for a field the plugin did not write');
  });

  test('a skin without a model is listed but NOT wear-able (the renderer would draw the operator\'s own body)', () => {
    const by = Object.fromEntries(availableSkins(OPERATOR).map((r) => [r.id, r]));
    assert.equal(by[SKIN].playable, true);
    assert.equal(by[SKIN2].playable, true);
    assert.equal(by[ART_ONLY].playable, false);
    assert.equal(by[ART_ONLY].avatar, '/a/art.png', 'its art is still worth looking at');
  });

  test('missing art falls back to the operator\'s own — never a slash or a placeholder', () => {
    const by = Object.fromEntries(availableSkins(OPERATOR).map((r) => [r.id, r]));
    assert.equal(by[SKIN2].portrait, '/p/inside_1.png');
    assert.equal(by[SKIN2].avatar, '/a/inside.png');
    assert.equal(by[SKIN2].illust, '/p/inside_1.png', 'no illustration: the portrait stands in');
    assert.equal(by[SKIN2].fallbackArt, true, 'and the tile says so, so the replacement is legible');
    assert.equal(by[SKIN].fallbackArt, false);
    // nothing at all to draw: still no invented URL
    const bare = { chars: { [OPERATOR]: { skins: { 'x@y#1': { name: 'n', spine: { front: { skel: '/s/bare/front.skel', atlas: '/s/bare/front.atlas', anims: { idle: 'Idle' } } } } } } } };
    withManifest(bare, () => {
      assert.deepEqual(availableSkins(OPERATOR).map((r) => r.portrait), [null, null]);
    });
  });

  test('hasAnySkinChoices is the GLOBAL rule: one operator with a wear-able skin is enough', () => {
    assert.equal(hasAnySkinChoices(), true, 'OPERATOR has two wear-able skins');
    assert.equal(availableSkins(OTHER).some((x) => !x.own && x.playable), false, 'and OTHER has none of its own');
    // the same manifest without it: nothing anywhere is wear-able, so no section is shown for anyone
    const artOnly = { chars: { [OPERATOR]: { avatar: '/a.png', skins: { [ART_ONLY]: { name: '画', avatar: '/b.png' } } } } };
    withManifest(artOnly, () => assert.equal(hasAnySkinChoices(), false, 'a plugin that only adds pictures turns nothing on'));
    const noSkins = { chars: { [OTHER]: { avatar: '/a/kalts.png', portrait: '/p/kalts_1.png' }, [ILLUSTR_ONLY]: { illust: '/i/pepe.png' } } };
    withManifest(noSkins, () => assert.equal(hasAnySkinChoices(), false, 'no plugin, or 立绘 only: every operator looks untouched'));
    withManifest({ chars: {} }, () => assert.equal(hasAnySkinChoices(), false, 'an empty manifest'));
    withManifest({}, () => assert.equal(hasAnySkinChoices(), false, 'a manifest with no chars at all'));
  });

  test('hasSkinChoices stays the single-operator criterion (默认 plus at least one wear-able skin of THAT operator)', () => {
    assert.equal(hasSkinChoices(OPERATOR), true, 'two wear-able skins');
    assert.equal(hasSkinChoices(OTHER), false, 'no skin of its own, whatever the rest of the manifest holds');
    assert.equal(hasSkinChoices('char_002_amiya'), false, 'an operator the manifest does not hold');
    assert.equal(hasSkinChoices(null), false);
    // art only is not a second choice: 默认 would be the only selectable tile
    const artOnly = { chars: { [OPERATOR]: { avatar: '/a.png', skins: { [ART_ONLY]: { name: '画', avatar: '/b.png' } } } } };
    withManifest(artOnly, () => assert.equal(hasSkinChoices(OPERATOR), false, 'a plugin that only adds a picture offers no choice'));
  });

  test('the section is gated globally, not per operator (the picker must not go back to hasSkinChoices)', () => {
    assert.match(PICKER_SRC, /if \(!hasAnySkinChoices\(\)\) return null;/, 'the gate is the global criterion');
    const skinsImport = PICKER_SRC.match(/import \{([^}]*)\} from '\.\/skins\.js'/) || [];
    assert.ok(skinsImport[1] && !/\bhasSkinChoices\b/.test(skinsImport[1]), 'and the per-operator one is not even imported');
    // the 默认 tile is kept for an operator without a skin: an empty grid is what the rule must not draw
    assert.match(PICKER_SRC, /if \(!rows\.length\) return null;/);
  });
});

describe('皮肤 picker: the choice', () => {
  test('a stored id that is not one of this operator\'s wear-able skins counts as 默认', () => {
    assert.equal(chosenSkin(OPERATOR, { [OPERATOR]: SKIN }), SKIN);
    assert.equal(chosenSkin(OPERATOR, { [OPERATOR]: ART_ONLY }), null, 'no model: not a choice');
    assert.equal(chosenSkin(OPERATOR, { [OPERATOR]: 'char_498_inside@gone#9' }), null, 'the plugin was switched off');
    assert.equal(chosenSkin(OPERATOR, { [OTHER]: SKIN }), null, 'a skin of another operator');
    assert.equal(chosenSkin(OPERATOR, {}), null);
    assert.equal(chosenSkin(OPERATOR, { [OPERATOR]: '' }), null);
    assert.equal(chosenSkin(null, { [OPERATOR]: SKIN }), null);
  });

  test('clearSkin drops one entry and leaves the others; the live store is what chosenSkin reads by default', () => {
    setSkins({ [OPERATOR]: SKIN, [OTHER]: 'char_003_kalts@boc#6' });
    assert.equal(chosenSkin(OPERATOR), SKIN);
    clearSkin(OPERATOR);
    assert.equal(chosenSkin(OPERATOR), null);
    assert.equal(skinsStore.get().skins[OTHER], 'char_003_kalts@boc#6', 'the other operator is untouched');
    setSkin(OPERATOR, SKIN);
    assert.equal(chosenSkin(OPERATOR), SKIN);
    setSkins({});
    assert.deepEqual(chosenSkin(OPERATOR), null);
  });

  test('parseStoredSkins keeps only non-empty string pairs (a hand-edited localStorage)', () => {
    assert.deepEqual(parseStoredSkins({ a: 'x', b: '', c: 7, d: null, '': 'y', e: 'z' }), { a: 'x', e: 'z' });
    assert.deepEqual(parseStoredSkins(null), {});
    assert.deepEqual(parseStoredSkins([]), {});
    assert.deepEqual(parseStoredSkins('x'), {});
  });
});

describe('皮肤 picker: the enlarged preview', () => {
  const ART = '/i/kitchen.png';
  test('one illustration inside the modal', () => {
    const v = SkinPreview({ art: ART, name: '厨房' });
    assert.equal(v.props.class, 'lo-skin-preview');
    const img = v.props.children;
    assert.equal(img.type, 'img');
    assert.equal(img.props.src, ART);
  });

  test('no art at all renders nothing (a skin with no illustration uses the tile art, so this is the empty case)', () => {
    assert.equal(SkinPreview({ art: null }), null);
  });
});
