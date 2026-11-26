// test/ui/shop-equip.test.js — the equip icon is the prefab node (93×93 at (0,17)) with the sprite the model
// supplies; the renderer never resizes it. The official Image is Simple with m_PreserveAspect=0 and _RenderEquip
// only calls Image.set_sprite (EQUIP-AUDIT.md §2.2/§2.4), and the official sprite is a padded m_Rect canvas, so
// drawing it in the prefab rect with UV 0..1 is the uGUI result (§2.3/§6.1). The equip node keeps its prefab
// rect and only takes the sprite from the model, on the first frame too.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AutoChessBattleShopCardView } from '../../public/js/ui/shop/cardView.js';

const IMAGE_A = '/assets/item/trap_1041_acarm041.png';
const IMAGE_B = '/assets/item/trap_1042_acarm042.png';
const PREFAB_BOX = [93, 93];
const PREFAB_POS = [0, 17];

const viewFor = (model) => new AutoChessBattleShopCardView({ scene: { cardDoc: {} }, root: null, model, index: 0 });

/** The equip subtree as the extracted prefab carries it: Simple image, no sprite yet, 93×93 at (0,17). */
function treeWithEquip() {
  const equip = { name: 'equip', rect: { sizeDelta: [...PREFAB_BOX], anchoredPosition: [...PREFAB_POS] }, image: { type: 'simple', color: '#FFFFFF', sprite: null } };
  const name = { name: 'eqiup_name', text: { text: '', color: '#000000' } };
  return {
    name: 'root',
    children: [
      { name: 'group_equip', children: [{ name: 'root_equip', children: [equip] }] },
      name,
    ],
  };
}

const nodes = (tree) => ({ equip: tree.children[0].children[0].children[0], name: tree.children[1] });

test('the equip node keeps the prefab rect and only receives the model file/sprite', () => {
  const tree = treeWithEquip();
  const { equip } = nodes(tree);
  viewFor({ iconFile: IMAGE_A, icon: 'trap_1041_acarm041', name: '遗迹机关' }).renderEquip(tree);

  assert.deepEqual(equip.rect.sizeDelta, PREFAB_BOX, 'the prefab 93×93 box is what the official Simple image fills');
  assert.deepEqual(equip.rect.anchoredPosition, PREFAB_POS);
  assert.equal(equip.image.file, IMAGE_A);
  assert.equal(equip.image.sprite, 'trap_1041_acarm041');
  assert.equal(equip.image.color, '#FFFFFF', 'the prefab colour is kept');
  assert.equal(equip.image.type, 'simple');
  assert.equal('preserveAspect' in equip.image, false, 'official m_PreserveAspect=0: the renderer must not set it');
  assert.equal('uvRect' in equip.image, false, 'the stage draws UV 0..1 of the padded sprite');
});

test('re-rendering and switching items never resize the node', () => {
  const tree = treeWithEquip();
  const { equip } = nodes(tree);
  const view = viewFor({ iconFile: IMAGE_A, icon: 'trap_1041_acarm041' });
  view.renderEquip(tree);
  for (let i = 0; i < 9; i += 1) view.renderEquip(tree);
  assert.deepEqual(equip.rect.sizeDelta, PREFAB_BOX, 're-rendering the same item is idempotent');

  view.model = { iconFile: IMAGE_B, icon: 'trap_1042_acarm042' };
  view.renderEquip(tree);
  assert.deepEqual(equip.rect.sizeDelta, PREFAB_BOX, 'a different item keeps the prefab box');
  assert.equal(equip.image.file, IMAGE_B);

  view.model = { iconFile: IMAGE_A, icon: 'trap_1041_acarm041' };
  view.renderEquip(tree);
  assert.deepEqual(equip.rect.sizeDelta, PREFAB_BOX, 'switching back never starts from a fitted rect');
  assert.equal(equip.image.file, IMAGE_A);
});

test('no fit bookkeeping is left on the node', () => {
  const tree = treeWithEquip();
  const { equip } = nodes(tree);
  viewFor({ iconFile: IMAGE_A, icon: 'trap_1041_acarm041' }).renderEquip(tree);
  assert.deepEqual(Object.keys(equip).filter((key) => key.startsWith('__')), [], 'no __equipBase/__equipFile marker');
});

test('a card without an icon file leaves the equip image untouched', () => {
  const tree = treeWithEquip();
  const { equip } = nodes(tree);
  viewFor({ name: '空卡' }).renderEquip(tree);
  assert.equal(equip.image.file, undefined);
  assert.equal(equip.image.sprite, null);
});

test('the equip name follows the model name and its colour', () => {
  const tree = treeWithEquip();
  const { name } = nodes(tree);
  viewFor({ iconFile: IMAGE_A, icon: 'trap_1041_acarm041', name: '遗迹机关', nameColor: '#59F4CA' }).renderEquip(tree);
  assert.equal(name.text.text, '遗迹机关');
  assert.equal(name.text.color, '#59F4CA');
});
