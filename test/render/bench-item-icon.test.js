// test/render/bench-item-icon.test.js — GitHub #993 (DESIGN §37.335): a bench item is its shop icon without the plate's
// frame and black backing (render/textures.js itemIconTexture), its longer side BENCH_ITEM.size tiles (render/style.js:
// the official world size of the 坚守盾牌 model), in the box the framed plate took, so the drawn rect, the drag point and
// the tile under them stay where they were. The framed '?' plate stays until the icon loads; equipped-item pips keep
// their frame. Against the headless fake PIXI (test/render/fakepixi.js).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera, pickTile } from '../../public/js/render/projection.js';

let fake, ItemView, T, S;
before(async () => {
  fake = installFakePixi();
  ({ ItemView } = await import('../../public/js/render/units.js'));
  T = await import('../../public/js/render/textures.js');
  S = await import('../../public/js/render/style.js');
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** Wrap every canvas made from now on in a context that records its calls: [method, args]. */
function recordCanvases() {
  const create = globalThis.document.createElement;
  const log = new Map();
  globalThis.document.createElement = (tag) => {
    const c = create(tag);
    if (tag === 'canvas') {
      const ctx = c.getContext('2d');
      const calls = [];
      log.set(c, calls);
      const rec = new Proxy(ctx, {
        get(t, k) { const v = t[k]; return typeof v === 'function' ? (...a) => { calls.push([k, a]); return v(...a); } : v; },
        set(t, k, v) { t[k] = v; return true; },
      });
      c.getContext = () => rec;
    }
    return c;
  };
  return { log, restore() { globalThis.document.createElement = create; } };
}

test('the sizes: a 0.62-tile icon (the framed plate\'s box) floating 0.12 over the slot; a 176 px texture with the icon in 160 px', () => {
  assert.deepEqual({ ...S.BENCH_ITEM }, { size: 0.62, lift: 0.12 });
  assert.deepEqual({ ...T.ITEM_ICON }, { box: 176, art: 160, glow: 8 });
  // 228 skeleton units × SkeletonDataAsset 0.01 × FaceSwitcher 0.27 (trap_1047_acarm047, the official screenshot's item)
  assert.ok(close(S.BENCH_ITEM.size, 228 * 0.01 * 0.27, 0.005));
});

test('itemIconTexture: only the picture, fitted and centred, with a glow in the tier colour; no frame, no backing', () => {
  const rec = recordCanvases();
  try {
    const img = { width: 109, height: 160 };
    const tex = T.itemIconTexture('/icon/shield.png', img, 0xffc600);
    const canvas = tex.baseTexture.resource;
    assert.equal(canvas.width, 176);
    assert.equal(canvas.height, 176);
    const calls = rec.log.get(canvas);
    assert.ok(calls, 'drawn on its own canvas');
    const names = calls.map(([k]) => k);
    for (const k of ['fill', 'stroke', 'fillRect', 'fillText', 'strokeRect']) assert.ok(!names.includes(k), `no ${k}: frameless, no black backing`);
    const draws = calls.filter(([k]) => k === 'drawImage');
    assert.ok(draws.length >= 1);
    for (const [, [src, x, y, w, h]] of draws) {
      assert.equal(src, img);
      assert.deepEqual([x, y, w, h], [(176 - 109) / 2, 8, 109, 160], 'its own size, centred in the glow margin');
    }
    const ctx = canvas.getContext('2d');
    assert.equal(ctx.shadowColor, '#ffc600');
    assert.equal(ctx.shadowBlur, 8);
    // a wide icon fits by its width; a small one is scaled up to the 160 px box
    T.itemIconTexture('/icon/wide.png', { width: 320, height: 184 }, 0x9aa5a0);
    const wide = [...rec.log.values()].at(-1).find(([k]) => k === 'drawImage')[1];
    assert.deepEqual(wide.slice(1), [8, (176 - 92) / 2, 160, 92]);
    // cached by icon URL and colour; the 精锐 gold and a tier colour are different textures
    assert.equal(T.itemIconTexture('/icon/shield.png', { width: 109, height: 160 }, 0xffc600), tex);
    assert.notEqual(T.itemIconTexture('/icon/shield.png', img, 0x9aa5a0), tex);
    // no picture (still loading, or no art): the framed '?' plate
    assert.equal(T.itemIconTexture('/icon/shield.png', null, 0xffc600), T.itemTexture('/icon/shield.png', null, 0xffc600));
    assert.equal(T.itemIconTexture('/icon/shield.png', { width: 0, height: 0 }, 0xffc600), T.itemTexture('/icon/shield.png', null, 0xffc600));
  } finally { rec.restore(); }
});

test('ItemView: the framed plate until the icon loads, then the bare icon in the same box (resting and dragged)', async () => {
  for (const [w, h] of [[1280, 720], [1920, 1080], [844, 390]]) {
    const cam = presetCamera('prep', { width: w, height: h });
    let resolve;
    const img = { width: 109, height: 160 };
    const ctx = fakeViewCtx(fake.P, { assets: { image: () => new Promise((r) => { resolve = r; }) } });
    const it = new ItemView(ctx, { id: 'p:9', uid: 9, kind: 'item', defId: 'chess_item_1_02_e_a', icon: '/icon/shield.png', color: 0x9aa5a0, x: 4, y: 8 });
    try {
      it.setWorld(4, 8, 0.16);
      it.bob = 0; // sin(2t + bob) = 0 at t = 0
      assert.equal(it.bare, false);
      assert.equal(it.plate.texture, T.itemTexture('/icon/shield.png', null, 0x9aa5a0));
      it.update(0, cam, 0);
      const s = it.screen.s;
      const plate = it.bounds();
      assert.ok(close(it.plate.scale.x * 128, s * 0.62), 'the placeholder plate fills the 0.62 box');
      resolve(img);
      await tick();
      assert.equal(it.bare, true);
      assert.equal(it.plate.texture, T.itemIconTexture('/icon/shield.png', img, 0x9aa5a0));
      it.update(0, cam, 0);
      // resting: the icon's 160 px are the 0.62-tile box; the glow margin hangs below, so the box bottom stays on the float
      assert.ok(close(it.plate.scale.x * 160, s * 0.62), 'icon longer side = 0.62 tile');
      assert.ok(close(it.plate.anchor.y, 1 - 8 / 176));
      const g = cam.project(4, 8, 0.16 + 0.12);
      assert.ok(close(it.root.position.y, g.y) && close(it.root.position.x, g.x), 'floats 0.12 over the slot');
      const r = it.bounds();
      assert.deepEqual(r, plate, 'the drawn rect is the plate\'s');
      assert.ok(close(r.y + r.height, it.screen.y) && close(r.height, s * 0.62));
      // the e2e drag point (piecePoint: 72 % down the rect) and the rect's centre are over the item's own tile
      for (const at of [0.5, 0.72]) {
        const t = pickTile(cam, r.x + r.width / 2, r.y + r.height * at, () => 0.16, [0.16]);
        assert.deepEqual([t?.row, t?.col], [8, 4], `${w}×${h}: ${at} of the rect picks the slot`);
      }
      // dragged: centred on its ground point (the pointer)
      it.lift = 0.3;
      it.update(0, cam, 0);
      assert.equal(it.plate.anchor.y, 0.5);
      const d = cam.project(4, 8, 0.16);
      const b = it.bounds();
      assert.ok(close(b.x + b.width / 2, d.x) && close(b.y + b.height / 2, d.y));
      // a removed icon goes back to the plain plate
      it.lift = 0;
      it.setIcon(null);
      assert.equal(it.bare, false);
      assert.equal(it.plate.texture, T.itemTexture('none', null, 0x9aa5a0));
    } finally { it.destroy(); }
  }
});

test('equipped-item pips on an operator keep their framed plate', async () => {
  const { UnitView } = await import('../../public/js/render/units.js');
  const img = { width: 109, height: 160 };
  const ctx = fakeViewCtx(fake.P, { assets: { image: async () => img } });
  const v = new UnitView(ctx, { id: 1, side: 'ally', kind: 'op', defId: 'char_x', tier: 1, x: 4, y: 7, maxHp: 1 }, { prep: true, bench: true });
  try {
    v.setItems(['/icon/shield.png']);
    await tick();
    assert.equal(v.itemPips[0].texture, T.itemTexture('/icon/shield.png', img, 0x4ed8af));
  } finally { v.destroy(); }
});
