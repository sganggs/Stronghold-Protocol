// test/render/proj.js — the content-owned projectile layer (render/proj.js) against a minimal fake PIXI.
//   * `assets.fx.proj[visual]` normalization: defaults, clamps, `#rgb` / `#rrggbb` / named tints, an entry with no
//     picture draws nothing
//   * one sprite per streamed id, placed at the sim's own position and scaled by the picture's own pixel size
//   * a projectile that leaves the stream fades out over `fade` real seconds, then its sprite is pooled
//   * a visual the manifest does not describe is dropped instead of drawing a placeholder
//   * unreadable stream entries are skipped, and ids are stable so a sprite is reused
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjLayer, projStyle, tintOf } from '../../public/js/render/proj.js';

class FakeTexture {
  constructor(w, h) { this.width = w; this.height = h; }
}

class FakeSprite {
  constructor(tex) {
    this.texture = tex;
    this.anchor = { x: 0.5, y: 0.5, set(x, y) { this.x = x; this.y = y; } };
    this.position = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
    this.scale = { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } };
    this.rotation = 0;
    this.alpha = 1;
    this.visible = true;
    this.tint = 0xffffff;
  }
}

const P = { Sprite: FakeSprite, Texture: { EMPTY: new FakeTexture(1, 1) } };

const ASSETS = {
  fx: {
    proj: {
      note: { src: '/p/note.png', w: 1, h: 0.4, lift: 0.6, spin: 90, tint: '#f80', fade: 0.2 },
      big: { src: '/p/big.png' },
      noPic: { w: 1, h: 1 },
    },
  },
};

const SIZES = { '/p/note.png': [40, 20], '/p/big.png': [100, 100] };
const textureOf = (src) => new FakeTexture(...(SIZES[src] ?? [1, 1]));
const project = (x, y, z, out) => { out.x = x * 10; out.y = (-y + z) * 10; out.s = 5; return out; };

function layer(assets = ASSETS) {
  const container = { children: [], addChild(sp) { this.children.push(sp); } };
  const l = new ProjLayer(P, { container, textureOf, assets, project, groundZ: () => 0 });
  return { l, container };
}

test('tintOf reads the manifest forms and refuses the rest', () => {
  assert.equal(tintOf('#ff8800'), 0xff8800);
  assert.equal(tintOf('#f80'), 0xff8800);
  assert.equal(tintOf('  #F80 '), 0xff8800);
  assert.equal(tintOf('gold'), 0xffc600);
  assert.equal(tintOf(0x123456), 0x123456);
  assert.equal(tintOf('#12345'), null);
  assert.equal(tintOf('chartreuse'), null);
  assert.equal(tintOf(null), null);
});

test('projStyle normalizes one entry and keeps the defaults a pack leaves out', () => {
  const note = projStyle(ASSETS, 'note');
  assert.equal(note.src, '/p/note.png');
  assert.equal(note.w, 1);
  assert.equal(note.h, 0.4);
  assert.equal(note.lift, 0.6);
  assert.equal(note.spin, 90);
  assert.equal(note.tint, 0xff8800);
  assert.equal(note.fade, 0.2);
  assert.equal(note.anchorX, 0.5);
  const big = projStyle(ASSETS, 'big');
  assert.equal(big.w, 0.5, 'the default size');
  assert.equal(big.h, 0.5);
  assert.equal(big.lift, 0.5);
  assert.equal(big.fade, 0.12, 'the default fade');
  assert.equal(big.tint, null, 'no tint: the picture keeps its colours');
  assert.equal(big.spin, 0);
});

test('projStyle draws nothing without an entry or without a picture', () => {
  assert.equal(projStyle(ASSETS, 'missing'), null);
  assert.equal(projStyle(ASSETS, 'noPic'), null);
  assert.equal(projStyle(ASSETS, ''), null);
  assert.equal(projStyle(null, 'note'), null);
  assert.equal(projStyle({ fx: { proj: [] } }, 'note'), null);
});

test('the layer draws one sprite per streamed id at the sim position, scaled by the picture', () => {
  const { l, container } = layer();
  l.sync([[7, 1, 2, 'note'], [8, 3, 4, 'note']]);
  l.update(1 / 60);
  assert.equal(l.size, 2);
  assert.equal(container.children.length, 2);
  const sp = container.children[0];
  assert.equal(sp.visible, true);
  assert.equal(sp.texture.width, 40);
  assert.equal(sp.anchor.x, 0.5);
  assert.deepEqual([sp.position.x, sp.position.y], [10, (-2 + 0.6) * 10]);
  assert.deepEqual([sp.scale.x, sp.scale.y], [(1 * 5) / 40, (0.4 * 5) / 20]);
  assert.equal(sp.tint, 0xff8800);
  assert.ok(sp.rotation > 0, 'the spin of the entry');
});

test('a projectile that leaves the stream fades over its own fade, then the sprite is pooled', () => {
  const { l, container } = layer();
  l.sync([[7, 1, 2, 'note']]);
  l.update(1 / 60);
  const sp = container.children[0];
  l.sync([]);
  l.update(0.05);
  assert.ok(sp.alpha > 0 && sp.alpha < 1, `fading (${sp.alpha})`);
  assert.equal(l.size, 1);
  l.update(0.2);
  assert.equal(l.size, 0);
  assert.equal(sp.visible, false);
  assert.equal(sp.alpha, 0);
});

test('an undescribed visual is dropped, and unreadable entries are skipped', () => {
  const { l, container } = layer();
  l.sync([[7, 1, 2, 'noPic'], [8, NaN, 2, 'note'], [9, Infinity, 2, 'note'], null, [10, 1]]);
  l.update(1 / 60);
  assert.equal(l.size, 0, 'noPic draws nothing; the NaN/Infinity/short entries never entered');
  assert.equal(container.children.length, 1, 'noPic did take a sprite for a frame, then gave it back');
  assert.equal(container.children[0].visible, false, 'no placeholder appeared');
});

test('ids are stable: a recycled sprite keeps drawing, a new id reuses a freed one', () => {
  const { l, container } = layer();
  l.sync([[7, 1, 2, 'note']]);
  l.update(1 / 60);
  const sp = container.children[0];
  l.sync([[7, 5, 6, 'note']]);
  l.update(1 / 60);
  assert.equal(container.children.length, 1, 'one sprite for one id');
  assert.deepEqual([sp.position.x, sp.position.y], [50, (-6 + 0.6) * 10]);
  l.sync([]);
  l.update(1);           // fade out
  assert.equal(l.size, 0);
  l.sync([[9, 2, 2, 'big']]);
  l.update(1 / 60);
  assert.equal(container.children.length, 1, 'the freed sprite came back');
  assert.equal(l.size, 1);
  assert.equal(container.children[0].texture.width, 100);
});

test('clear() drops everything and hides the sprites', () => {
  const { l, container } = layer();
  l.sync([[7, 1, 2, 'note'], [8, 3, 4, 'note']]);
  l.update(1 / 60);
  l.clear();
  assert.equal(l.size, 0);
  assert.ok(container.children.every((sp) => sp.visible === false));
});
