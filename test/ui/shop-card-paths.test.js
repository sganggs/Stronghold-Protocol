// test/ui/shop-card-paths.test.js — PORT-DIFF C7: every card's cloned sub-prefab needs its own path.
// Without repath, five cards share frame_lv3_obj/tv_particle, cost_view and bond_item, and
// byPath/boxes keep only the last card's records.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repathCardNode } from '../../public/js/ui/shop/cardView.js';

const sub = {
  name: 'frame_lv3_obj',
  path: 'frame_lv3_obj',
  children: [
    { name: 'tv_particle', path: 'frame_lv3_obj/tv_particle', children: [] },
    { name: 'root_star', path: 'frame_lv3_obj/root_star', children: [
      { name: '1', path: 'frame_lv3_obj/root_star/1', children: [] },
    ] },
  ],
};

test('five cloned cards produce five unique sub-prefab paths', () => {
  const paths = [];
  for (let i = 0; i < 5; i += 1) {
    const parent = `panel_shop_main/state_unfold/root_layout/group_slots/card_${i}/root/panel_main/btn_card/group_frame/frame_obj_container`;
    const node = repathCardNode(JSON.parse(JSON.stringify(sub)), parent);
    paths.push(node.path, `${node.path}/tv_particle`, `${node.path}/root_star/1`);
  }
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes('panel_shop_main/state_unfold/root_layout/group_slots/card_4/root/panel_main/btn_card/group_frame/frame_obj_container/frame_lv3_obj/tv_particle'));
});

test('bond rows repathed under their card list do not collide', () => {
  const row = { name: 'bond_item', path: 'bond_item', children: [{ name: 'txt', path: 'bond_item/txt', children: [] }] };
  const listPaths = [];
  for (let i = 0; i < 5; i += 1) {
    const list = `panel_shop_main/state_unfold/root_layout/group_slots/card_${i}/root/panel_main/btn_card/group_char/bond_list`;
    for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
      const node = repathCardNode(JSON.parse(JSON.stringify(row)), list, `bond_item_${rowIndex}`);
      listPaths.push(node.path, node.children[0].path);
    }
  }
  assert.equal(new Set(listPaths).size, listPaths.length);
});
