import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { cameraBasis } from '../../public/js/render/vfx/geom.js';
import { OfficialFx } from '../../public/js/render/vfx/system.js';

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
    assert.equal(rows.get('beijing_01').unitBack, true);
    assert.equal(rows.get('beijing_01').ground, false, 'standing background must not sit under raised tile meshes');
    assert.equal(rows.get('beijing_01').order, 0, 'retain the authored sorting order within its owner pass');
    assert.equal(desc.nodes[5].meshRenderer.m_SortingOrder, 0, 'do not rewrite the source descriptor');
    assert.equal(rows.get('glow_qian').ground, false);
    assert.equal(rows.get('front').ground, false, 'order-zero siblings retain the original layering');
    assert.equal(rows.get('dark').ground, true, 'existing negative sorting order still draws below units');
  }
});
test('a similarly named background in another prefab retains the existing depth rules', () => {
  assert.equal(entries(fixture('unrelated_effect'), false).get('beijing_01').ground, false);
  assert.equal(entries(fixture('unrelated_effect'), false).get('beijing_01').unitBack, false);
});

class Container {
  constructor(name = '') { this.name = name; this.children = []; this.parent = null; this.destroyed = false; }
  addChildAt(child, index) { this.children.splice(index, 0, child); child.parent = this; }
  destroy() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null; this.destroyed = true;
  }
}

test('raised tiles draw before each owner background, then its model; owners keep independent depth order', () => {
  const cam = { tilt: 30, cx: 360, cy: 240, scale: 40, dist: 20, position: () => ({ x: 10, y: -5, z: 8 }) };
  const ofx = new OfficialFx({ P: { Container }, lib: { ...lib, available: true }, cam: () => cam, tier: 'full' });
  const renderer = { screen: { width: 720, height: 480 }, batch: { flush() {} } };
  const drawn = [];
  ofx.glr = { upload() {}, draw(items) {
    for (const e of items) if (e.effect.def.nodes[e.node].name === 'beijing_01') drawn.push(`${e.effect.owner.id}:background`);
  } };
  const owners = ['far', 'near'].map(id => {
    const root = new Container(id), body = new Container('body');
    body._render = () => drawn.push(`${id}:model`); root.addChildAt(body, 0);
    const fx = new Effect(compileEffect(fixture(), lib), { lib, seed: 1 });
    fx.owner = { id, root }; fx.update(1 / 30); ofx.effects.push(fx);
    return fx.owner;
  });
  // TileField puts raised block rows in the same depth-sorted parent as UnitView.root. Each root's children draw
  // after its platform, so a global ground pass cannot provide this ordering.
  const paint = container => { container._render?.(renderer); for (const child of container.children) paint(child); };
  ofx.ground._render(renderer);
  for (const owner of owners) { drawn.push(`${owner.id}:platform`); paint(owner.root); }
  ofx.over._render(renderer);
  assert.deepEqual(drawn, ['far:platform', 'far:background', 'far:model', 'near:platform', 'near:background', 'near:model']);
  assert.equal(ofx.items.ground.some(e => e.effect.def.nodes[e.node].name === 'beijing_01'), false);
  assert.ok(ofx.items.over.some(e => e.effect.def.nodes[e.node].name === 'front'));
  // Finish one owner's effect without a new ground draw: no stale child or owner reference may remain.
  const farBucket = ofx.unitBack.get(owners[0]);
  ofx.effects[0].kill(); ofx.update(1 / 30);
  assert.equal(farBucket.container.destroyed, true);
  assert.equal(ofx.unitBack.has(owners[0]), false);
  ofx.clear();
  assert.equal(ofx.unitBack.size, 0);
  assert.deepEqual(owners[1].root.children.map(c => c.name), ['body']);
});
