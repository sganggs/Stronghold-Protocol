import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { cameraBasis } from '../../public/js/render/vfx/geom.js';

// Reduced from the production S3 prefab: the background's +0.104 depth belongs to a nested scale helper,
// while static_offset is zero. Keep its original sorting order; the foreground shares the same effect instance.
const material = {
  name: 'background', shader: 'Torappu/Particles/Additive', queue: 'Transparent',
  passes: [{ blend: ['SrcAlpha', 'One'], zTest: 'Disabled', zWrite: false, cull: 'Off' }],
  floats: {}, colors: {}, textures: {},
};
const mesh = { positions: [0, 0, 0, 1, 0, 1, -1, 0, 1, 0, 1, 1],
  uv0: [0, 0, 1, 0, 0, 1, 1, 1], submeshes: [[0, 1, 2, 0, 2, 3]] };
const lib = { mesh: () => mesh };
function fixture(key = 'cetsyr_skill_03_buff_01') {
  const node = (name, parent, pos = [0, 0, 0]) => ({ name, parent, pos, active: true,
    rot: [0, 0, 0, 1], scale: [1, 1, 1], children: [] });
  const nodes = [node(key, null), node('static_offset', 0), node('fixed', 1),
    node('rotation', 2), node('scale', 3, [0, -.053, .104]),
    node('beijing_01', 4, [0, .816, 0]), node('glow_qian', 3, [0, .407, .05]),
    node('front', 3, [0, .6, 0]), node('dark', 3, [0, .693, 0])];
  for (const [i, order] of [[5, 0], [6, 1], [7, 0], [8, -7]]) {
    nodes[i].meshFilter = 'standing';
    nodes[i].meshRenderer = { m_Enabled: true, m_SortingLayer: 0, m_SortingOrder: order, materials: [0] };
  }
  return { key, root: 0, nodes, materials: [material], textures: [], meshes: [] };
}
function entries(desc, lite) {
  const def = compileEffect(desc, lib), fx = new Effect(def, { lib, lite, seed: 1 });
  fx.update(1 / 30);
  const result = new Map();
  fx.gather(cameraBasis(30, [0, -5, -8], 720, .7), e => result.set(def.nodes[e.node].name, e));
  return result;
}
test('Civilight Eterna S3 background draws below the operator in full and lite tiers, preserving foreground order', () => {
  for (const lite of [false, true]) {
    const desc = fixture(), rows = entries(desc, lite);
    assert.equal(rows.get('beijing_01').ground, true);
    assert.equal(rows.get('beijing_01').order, 0, 'retain the authored sorting order within the ground pass');
    assert.equal(desc.nodes[5].meshRenderer.m_SortingOrder, 0, 'do not rewrite the source descriptor');
    assert.equal(rows.get('glow_qian').ground, false);
    assert.equal(rows.get('front').ground, false, 'order-zero siblings retain the original layering');
    assert.equal(rows.get('dark').ground, true, 'existing negative sorting order still draws below units');
  }
});
test('a similarly named background in another prefab retains the existing depth rules', () => {
  assert.equal(entries(fixture('unrelated_effect'), false).get('beijing_01').ground, false);
});
