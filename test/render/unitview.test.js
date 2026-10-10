// test/render/unitview.test.js — render/units.js UnitView and render/textures.js caches against a headless fake PIXI
// (test/render/fakepixi.js): tier chips (tokens have no tier), fallback-portrait allocation (no throw-away
// placeholder canvases, nothing built when the Spine model is already there), and the per-mount texture helpers
// (mountain silhouette, tier-chip redraw) that must not allocate a new canvas each time.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));

let fake, UnitView, T;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
  T = await import('../../public/js/render/textures.js');
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('prep', { width: 1280, height: 720 });
const diamonds = () => fake.canvases.filter((c) => c.width === 160 && c.height === 160);

/** Asset store stub: avatar image + (optionally) a Spine model, both resolved asynchronously. */
function store({ image = true, spine = false, imageDelay = 0 } = {}) {
  const img = { width: 180, height: 180 };
  const entry = { skel: '/s/x.skel', atlas: '/s/x.atlas', textures: ['/s/x.png'], anims: { idle: 'Idle' }, animations: { Idle: 1 } };
  return {
    picture: (id) => (id ? `/pic/${id}.png` : null),
    image: (u) => new Promise((r) => (imageDelay ? setTimeout(() => r(image ? img : null), imageDelay) : r(image ? img : null))),
    spineEntry: () => (spine ? entry : null),
    spine: { acquire: async () => ({ animations: [{ name: 'Idle' }] }), release() {} },
  };
}

function view(info, opts = {}, assets = store()) {
  const ctx = fakeViewCtx(fake.P, { assets, cam: cam });
  return new UnitView(ctx, { id: 1, side: 'ally', kind: 'chess', defId: 'char_x', tier: 3, x: 5, y: 12, maxHp: 1000, ...info }, opts);
}

describe('tier chips', () => {
  test('summon tokens in the hand show no tier chip (tokens have no tier)', async () => {
    const v = view({ kind: 'token', defId: 'token_10028_vigil_wolf', avatar: 'token_10028_vigil_wolf' }, { prep: true });
    for (let i = 0; i < 3; i++) v.update(1 / 60, cam(), i / 60);
    assert.ok(!v.chip || !v.chip.visible, 'no chip on a token');
  });

  test('operators keep their chip in prep and in battle; enemies never have one', () => {
    const p = view({ kind: 'chess', tier: 4 }, { prep: true });
    p.update(1 / 60, cam(), 0);
    assert.ok(p.chip && p.chip.visible);
    const b = view({ kind: 'chess', tier: 2 });
    b.update(1 / 60, cam(), 0);
    assert.ok(b.chip && b.chip.visible);
    const e = view({ side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime' });
    e.update(1 / 60, cam(), 0);
    assert.equal(e.chip, null);
  });
});

describe('fallback portraits (avatar diamonds)', () => {
  test('an avatar that loads builds one diamond — no image-less placeholder first', async () => {
    const before = diamonds().length;
    const v = view({ defId: 'char_a', avatar: 'char_a' });
    v.update(1 / 60, cam(), 0);
    await tick(); await tick();
    v.update(1 / 60, cam(), 1 / 60);
    assert.equal(diamonds().length - before, 1, 'one 160×160 canvas');
    assert.notEqual(v.fallback.texture, fake.P.Texture.EMPTY, 'the diamond shows');
  });

  test('a unit whose Spine model is ready before its first frame builds no diamond at all', async () => {
    const before = diamonds().length;
    const v = view({ defId: 'char_b', avatar: 'char_b' }, {}, store({ spine: true }));
    await tick(); await tick();
    assert.ok(v.spineReady, 'spine ready');
    for (let i = 0; i < 30; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(diamonds().length - before, 0);
  });

  test('a missing avatar falls back to the procedural placeholder (once)', async () => {
    const before = diamonds().length;
    const v = view({ defId: 'char_c', avatar: 'char_c' }, {}, store({ image: false }));
    await tick(); await tick();
    for (let i = 0; i < 3; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(diamonds().length - before, 1);
    assert.notEqual(v.fallback.texture, fake.P.Texture.EMPTY);
  });

  test('圣聆初雪 S2: the frozen gate (保护目标（冻结状态）, no art in the data) is an ice diamond, not the plain placeholder', async () => {
    const before = diamonds().length;
    const v = view({ kind: 'token', defId: 'token_10058_sbell2_icetgt' }, {}, store());   // (an owner avatar would load)
    await tick(); await tick();
    for (let i = 0; i < 3; i++) v.update(1 / 60, cam(), i / 60);
    assert.equal(v._frameColor(), 0x9fe6ff, 'ice frame');
    assert.equal(diamonds().length - before, 1);
    assert.notEqual(v.fallback.texture, T.diamondTexture('token_10058_sbell2_icetgt', null, 0x9fe6ff), 'its own (ice) glyph, not the procedural one');
    assert.equal(v.fallback.texture, T.diamondTexture('token_10058_sbell2_icetgt', null, 0x9fe6ff, { ice: true }));
  });

  test('a slow avatar shows the placeholder meanwhile, then the picture', async () => {
    const before = diamonds().length;
    let release;
    const gate = new Promise((r) => { release = r; });
    const assets = { ...store(), image: () => gate };
    const v = view({ defId: 'char_d', avatar: 'char_d' }, {}, assets);
    v.update(1 / 60, cam(), 0);
    assert.equal(diamonds().length - before, 0, 'nothing built while the avatar may still arrive quickly');
    const t0 = Date.now();
    while (v.fallback.texture === fake.P.Texture.EMPTY && Date.now() - t0 < 5000) { await new Promise((r) => setTimeout(r, 40)); v.update(1 / 60, cam(), 0); }
    assert.ok(Date.now() - t0 >= 300, 'placeholder only after the wait');
    assert.notEqual(v.fallback.texture, fake.P.Texture.EMPTY, 'placeholder while waiting');
    release({ width: 180, height: 180 });
    await tick(); await tick();
    v.update(1 / 60, cam(), 0);
    assert.equal(diamonds().length - before, 2, 'placeholder + picture');
  });

  test('two views of the same unit share the cached diamond', async () => {
    const a = view({ defId: 'char_e', avatar: 'char_e' });
    a.update(1 / 60, cam(), 0);
    await tick(); await tick();
    a.update(1 / 60, cam(), 0);
    const before = diamonds().length;
    const b = view({ defId: 'char_e', avatar: 'char_e' });
    b.update(1 / 60, cam(), 0);
    await tick(); await tick();
    b.update(1 / 60, cam(), 0);
    assert.equal(diamonds().length, before);
    assert.equal(a.fallback.texture, b.fallback.texture);
  });
});

describe('diamond cache', () => {
  test('bounded LRU; eviction never destroys a texture a view may still show', () => {
    const first = T.diamondTexture('lru_0', null, 0xffffff);
    for (let i = 1; i < 400; i++) {
      T.diamondTexture(`lru_${i}`, null, 0xffffff);
      if (i % 50 === 0) assert.equal(T.diamondTexture('lru_0', null, 0xffffff), first, 'recently used stays cached');
    }
    assert.ok(!first.destroyed && !first.baseTexture.destroyed);
    const n0 = diamonds().length;
    T.diamondTexture('lru_1', null, 0xffffff);
    assert.equal(diamonds().length, n0 + 1, 'the least recently used ones were evicted');
  });
});

describe('per-mount textures', () => {
  test('silhouetteTexture is cached per image (the field view builds it on every mount)', () => {
    const img = { width: 1024, height: 236 };
    const n0 = fake.canvases.length;
    const t1 = T.silhouetteTexture(img);
    const t2 = T.silhouetteTexture(img);
    assert.equal(t1, t2);
    assert.equal(fake.canvases.length - n0, 1);
    assert.notEqual(T.silhouetteTexture({ width: 512, height: 100 }), t1);
  });

  test('refreshTierChips redraws the chip atlas in place (no new canvas, chips handed out stay valid)', () => {
    const chip = T.tierChip(3, false);
    const n0 = fake.canvases.length;
    const b0 = fake.baseTextures.length;
    for (let i = 0; i < 5; i++) T.refreshTierChips();
    const again = T.tierChip(3, false);
    assert.equal(fake.canvases.length, n0, 'no new canvas');
    assert.equal(fake.baseTextures.length, b0, 'no new base texture');
    assert.equal(again.baseTexture, chip.baseTexture);
    assert.ok(!chip.destroyed && !chip.baseTexture.destroyed);
  });
});

describe('field view teardown (app.js releaseGl)', () => {
  test('drops the dead renderer’s GL copies of shared textures, buffers, geometries and cached programs', async () => {
    const { releaseGl } = await import('../../public/js/render/app.js');
    const UID = 7;
    const listeners = [];
    const mkBt = () => ({ _glTextures: { [UID]: { texture: {} }, 3: { texture: {} } } });
    const shared = [mkBt(), mkBt()];
    const deleted = [];
    const ts = {
      managedTextures: shared.slice(),
      destroyTexture(bt, skipRemove) {
        deleted.push(bt);
        delete bt._glTextures[UID];
        listeners.push('off');
        if (!skipRemove) this.managedTextures.splice(this.managedTextures.indexOf(bt), 1);
      },
    };
    const disposed = [];
    const sys = (name) => ({ disposeAll(lost) { disposed.push([name, lost]); } });
    const prog = { glPrograms: { [UID]: { program: 'p7' }, 3: { program: 'p3' } } };
    const gl = { deleted: [], deleteProgram(p) { this.deleted.push(p); } };
    const prevPixi = globalThis.PIXI;
    globalThis.PIXI = { ...prevPixi, utils: { ...(prevPixi?.utils || {}), ProgramCache: { src: prog } } };
    try {
      releaseGl({ CONTEXT_UID: UID, gl, texture: ts, geometry: sys('geometry'), buffer: sys('buffer'), framebuffer: sys('framebuffer') });
    } finally { globalThis.PIXI = prevPixi; }
    assert.deepEqual(deleted, shared);
    assert.equal(ts.managedTextures.length, 0);
    for (const bt of shared) assert.deepEqual(Object.keys(bt._glTextures), ['3'], 'other contexts untouched');
    assert.deepEqual(disposed.map((d) => d[0]).sort(), ['buffer', 'framebuffer', 'geometry']);
    assert.ok(disposed.every((d) => d[1] === false));
    assert.deepEqual(Object.keys(prog.glPrograms), ['3']);
    assert.deepEqual(gl.deleted, ['p7']);
    assert.doesNotThrow(() => releaseGl(null));
    assert.doesNotThrow(() => releaseGl({}));
  });
});

// user playtest #4 item 1: picking is by tile (render/pick.js); bounds() is the body's screen rect for tooltips / overlays
describe('bounds (view.pieceScreenRect)', () => {
  test('a unit: 0.7 tile wide, from its head (UNIT.headroom) to just below its feet; an enemy by its model height', async () => {
    const v = view({ defId: 'char_p1', avatar: 'char_p1' }, { prep: true });
    v.update(1 / 60, cam(), 0);
    const { x, y, s } = v.screen;
    const r = v.bounds();
    assert.ok(Math.abs(r.x - (x - 0.35 * s)) < 1e-6 && Math.abs(r.width - 0.7 * s) < 1e-6);
    assert.ok(Math.abs(r.y - (y - 1.18 * s)) < 1e-6 && Math.abs(r.y + r.height - (y + 0.1 * s)) < 1e-6);
    assert.equal(typeof v.pickShape, 'undefined', 'no hit shapes any more');
    const foe = view({ side: 'enemy', kind: 'enemy', defId: 'enemy_big' }, {}, store({ spine: true }));
    await tick(); await tick();
    foe.actor.entry.bounds = { height: 640 }; // setup-pose bounds: 2 tiles (UNIT.modelScale 1/320) × 0.92
    foe.update(1 / 60, cam(), 0);
    const fr = foe.bounds();
    assert.ok(Math.abs(fr.y - (foe.screen.y - foe._headTiles * foe.screen.s)) < 1e-6 && foe._headTiles > 1.5, 'its own height');
  });

  test('item plates: floating above the slot; centred on the pointer while dragged (lifted)', async () => {
    const { ItemView } = await import('../../public/js/render/units.js');
    const ctx = fakeViewCtx(fake.P, { assets: store(), cam });
    const it = new ItemView(ctx, { id: 'p:9', uid: 9, defId: 'item_x', x: 3, y: 7 });
    it.setWorld(3, 7, 0.16);
    it.update(1 / 60, cam(), 0);
    let r = it.bounds();
    assert.ok(Math.abs(r.y + r.height - it.screen.y) < 1e-6, 'resting: the plate above its anchor');
    it.lift = 0.3;
    it.update(1 / 60, cam(), 0);
    r = it.bounds();
    const g = cam().project(3, 7, 0.16);
    assert.ok(Math.abs(r.x + r.width / 2 - g.x) < 1e-6 && Math.abs(r.y + r.height / 2 - g.y) < 1e-6, 'dragged: centred on its ground point (the pointer)');
    assert.equal(it.plate.anchor.y, 0.5);
  });
});

describe('enemy preview pen figures (lod idle)', () => {
  /** A UnitView of a pen figure with a Spine model, an impostor atlas (full or not) and a counting renderer. */
  async function penFigure(full) {
    let frame = 0;
    const renders = [];
    const atlas = {
      alloc: (w, h) => (full ? null : { w, h, tex: new fake.P.Texture(), clip: false }),
      free() {}, park(o) { o.visible = false; }, unpark(o) { o.visible = true; }, draw() {},
    };
    const ctx = fakeViewCtx(fake.P, {
      assets: store({ spine: true }), cam, frameNo: () => frame, impostors: atlas,
      renderer: { resolution: 1, render: (obj, o) => renders.push(o?.renderTexture || null) },
    });
    const v = new UnitView(ctx, { id: 'e:0', side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime', tier: 1, x: 9, y: 15, maxHp: 1, facing: -1 }, { prep: true, lod: 'idle' });
    await tick(); await tick();
    assert.ok(v.spineReady, 'spine ready');
    let steps = 0;
    const upd = v.actor.update.bind(v.actor);
    v.actor.update = (dt) => { steps++; return upd(dt); };
    const step = () => { v.update(1 / 60, cam(), frame / 60); frame++; };
    return { v, step, renders, steps: () => steps };
  }

  test('with room in the shared atlas: an impostor refreshed every 3rd frame, never a private render target', async () => {
    const { v, step, renders, steps } = await penFigure(false);
    for (let i = 0; i < 30; i++) step();
    assert.ok(v.imp && v.imp.slot, 'atlas slot');
    assert.equal(renders.length, 0, 'drawn by the atlas flush, no per-figure render call');
    assert.ok(steps() <= 12, `idle loop stepped ≈ every 3rd frame (${steps()} of 30)`);
  });
});

// The impostor refreshes of a frame are spread evenly over the interval (app.js impostorSlot: each frame the impostor
// units take slots 0, 1, 2 … in update order): a frame refreshes ⌊n/k⌋ or ⌈n/k⌉ of n units. With a random phase per
// unit, the busiest frame did 20–66% more refreshes than that (16–48 units, intervals 2–6) — the frame-time peaks of a
// crowded battle on a slow device.
describe('impostor refresh slots', () => {
  /** n pen figures (lod idle: interval 3) in one context; `slotOf(frame, i)` gives view i its slot, or null: no slots. */
  async function crowd(n, slotOf) {
    let frame = 0;
    let i = 0;
    const atlas = {
      alloc: (w, h) => ({ w, h, tex: new fake.P.Texture(), clip: false }),
      free() {}, park(o) { o.visible = false; }, unpark(o) { o.visible = true; }, draw() {},
    };
    const ctx = fakeViewCtx(fake.P, {
      assets: store({ spine: true }), cam, frameNo: () => frame, impostors: atlas,
      renderer: { resolution: 1, render() {} },
      ...(slotOf ? { impostorSlot: () => slotOf(frame, i) } : {}),
    });
    const views = [];
    for (let k = 0; k < n; k++) {
      views.push(new UnitView(ctx, { id: `e:${k}`, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime', tier: 1, x: 9, y: 15, maxHp: 1, facing: -1 }, { prep: true, lod: 'idle' }));
    }
    await tick(); await tick();
    const refreshed = views.map(() => []);
    views.forEach((v, k) => {
      assert.ok(v.spineReady, 'spine ready');
      const upd = v.actor.update.bind(v.actor);
      v.actor.update = (dt) => { refreshed[k].push(frame); return upd(dt); };
    });
    const step = () => { views.forEach((v, k) => { i = k; v.update(1 / 60, cam(), frame / 60); }); frame++; };
    return { step, refreshed, frames: () => frame };
  }
  const perFrame = (refreshed, from, to) => {
    const c = new Map();
    for (const list of refreshed) for (const f of list) if (f >= from && f < to) c.set(f, (c.get(f) || 0) + 1);
    return Array.from({ length: to - from }, (_, j) => c.get(from + j) || 0);
  };

  test('slots in update order: every frame refreshes ⌊n/3⌋ or ⌈n/3⌉ units, each unit every 3rd frame', async () => {
    for (const n of [7, 16, 24]) {
      const { step, refreshed } = await crowd(n, (frame, k) => k);
      for (let f = 0; f < 31; f++) step();
      // frame 0: every new impostor is drawn once (dirty); from frame 1 on, the interval rules
      const counts = perFrame(refreshed, 1, 31);
      assert.ok(counts.every((c) => c === Math.floor(n / 3) || c === Math.ceil(n / 3)), `${n} units: ${counts.join(' ')}`);
      for (const list of refreshed) {
        const after = list.filter((f) => f >= 1);
        assert.equal(after.length, 10, `each unit refreshed 10 times in 30 frames (${after.join(',')})`);
        assert.ok(after.every((f, j) => j === 0 || f - after[j - 1] === 3), 'exactly every 3rd frame');
      }
    }
  });

  test('a slot that moves with the frame never starves a unit: refreshed at least every 2 intervals', async () => {
    // (frame + slot) % 3 is never 0: the turn alone would never come
    const { step, refreshed } = await crowd(3, (frame) => 4 - (frame % 3));
    for (let f = 0; f < 31; f++) step();
    for (const list of refreshed) {
      const after = list.filter((f) => f >= 1);
      assert.ok(after.length >= 5, `refreshed ${after.length} times`);
      assert.ok([0, ...after].every((f, j, a) => j === 0 || f - a[j - 1] <= 6), `gaps ≤ 6 frames (${after.join(',')})`);
    }
  });

  test('without slots (a context that has none) the random phase still refreshes every 3rd frame', async () => {
    const { step, refreshed } = await crowd(5, null);
    for (let f = 0; f < 31; f++) step();
    for (const list of refreshed) assert.equal(list.filter((f) => f >= 1).length, 10);
  });
});

// Player report 2026-10-05: 「无人机等飞行单位贴图位置明显偏低」, and the follow-up "绝对不止 0.35" with an official
// screenshot of 帝国炮火先兆者 over a tile (PR #211 by @xcdoge; the owner's decision of 2026-10-06). The lift is the
// official client's own single constant — Vector3(0, 0.35, 0) written by Torappu.Battle.CharacterAnimator's constructor
// (docs/research/12-flying-visuals-official.md) — measured in the client's character space, whose unit is the standard
// battle-prefab scale 0.27, so the tile-space lift is 0.35 / 0.27 ≈ 1.3 tiles (the screenshot measures 1.2–1.4). The
// client applies it to the model's root transform and nothing per model (its battle prefabs carry no flyer-specific
// vertical offset), so a model whose art hangs below its origin keeps that hang and flies with it — 妖怪 at ≈ 0.9 tiles
// of rotor clearance. The previous flat 0.32 left every flyer ~1 tile too low (the two 妖怪 drones even had their art
// under the tile).
describe('flying units hover FLY_HOVER above the ground, whatever their model', () => {
  const boundsOf = (key) => { const sp = ASSETS.enemies[key].spine; return (sp.front || sp).bounds; };
  const MODEL_K = { enemy_1005_yokai: 0.7407, enemy_1005_yokai_2: 0.8148, enemy_1040_bombd: 0.7407, enemy_1042_frostd: 0.6667 };
  /** Independent algorithm: tiles the art bottom hangs below the unit's ground point. */
  const sinkOf = (key) => (-boundsOf(key).y / 320) * MODEL_K[key];

  test('FLY_HOVER is the client constant 0.35 in character space, i.e. 0.35 / 0.27 tiles', async () => {
    const { FLY_HOVER } = await import('../../public/js/render/units.js');
    const STANDARD_PREFAB_SCALE = 0.27;   // enemies.json modelScale is a multiple of it (units.js enemyModelScale)
    const want = 0.35 / STANDARD_PREFAB_SCALE;
    assert.ok(Math.abs(FLY_HOVER - want) < 0.02, `FLY_HOVER ${FLY_HOVER} ≈ 0.35 / ${STANDARD_PREFAB_SCALE} = ${want.toFixed(3)} 格`);
  });

  test('every flyer of this mode gets the same lift, whatever its model hangs below its origin', async () => {
    const { FLY_HOVER } = await import('../../public/js/render/units.js');
    for (const key of Object.keys(MODEL_K)) {
      const sink = sinkOf(key);
      assert.ok(sink > 0, `${key}: the model does hang ${sink.toFixed(3)} tiles below its pivot`);
      // the lift is model-independent, so a flyer's visible clearance is FLY_HOVER − sink, and it differs per model
      assert.ok(FLY_HOVER - sink > 0.8, `${key}: 净高度 ${(FLY_HOVER - sink).toFixed(3)} 格（修复前 0.32 − sink 为负 → 贴地）`);
    }
    // with the old flat 0.32 the two 妖怪 drones had a negative clearance = art under the tile, and 寒霜 floated 0.25
    assert.ok(0.32 - sinkOf('enemy_1005_yokai') < 0, 'before: 妖怪 −0.06 tiles');
    assert.ok(0.32 - sinkOf('enemy_1042_frostd') > 0.2, 'before: 寒霜 floated 0.25 tiles (inconsistent)');
    // a model whose art starts above its pivot (帝国炮火先兆者) gets the plain FLY_HOVER
    assert.equal(boundsOf('enemy_1112_emppnt').y > 0, true, '帝国炮火先兆者 art bottom is above the origin');
    assert.ok(FLY_HOVER > 1.2, 'the sub-tile 0.35 left every flyer about one tile low');
  });

  test('a flying UnitView lifts by FLY_HOVER — its body and HP bar ride it, its shadow stays on the ground; a ground view keeps its feet on the tile', async () => {
    const { FLY_HOVER } = await import('../../public/js/render/units.js');
    const bounds = boundsOf('enemy_1005_yokai');
    const entry = { skel: '/s/x.skel', atlas: '/s/x.atlas', textures: ['/s/x.png'], anims: { idle: 'Idle' }, animations: { Idle: 1 }, bounds };
    const assets = {
      picture: () => null, image: async () => null, spineEntry: () => entry,
      spine: { acquire: async () => ({ animations: [{ name: 'Idle' }] }), release() {} },
    };
    const ctx = fakeViewCtx(fake.P, { assets, cam: cam, lookupDef: () => ({ modelScale: MODEL_K.enemy_1005_yokai }) });
    const fly = new UnitView(ctx, { id: 1, side: 'enemy', kind: 'enemy', defId: 'enemy_1005_yokai', x: 5, y: 12, maxHp: 100, motion: 'FLY' }, {});
    await tick(); await tick();
    for (let i = 0; i < 180; i++) fly.update(1 / 60, cam(), i / 60);
    assert.ok(Math.abs(fly.hover - FLY_HOVER) < 1e-3, `hover ${fly.hover.toFixed(3)} ≈ FLY_HOVER ${FLY_HOVER}`);
    const ground = new UnitView(ctx, { id: 2, side: 'enemy', kind: 'enemy', defId: 'enemy_1005_yokai', x: 5, y: 12, maxHp: 100 }, {});
    await tick(); await tick();
    for (let i = 0; i < 60; i++) ground.update(1 / 60, cam(), i / 60);
    assert.equal(ground.hover, 0, 'a ground unit is not lifted');
    // the same tile: the flyer's body (and the bar above it) is FLY_HOVER higher on screen, the shadows coincide
    const c = cam();
    const lift = c.project(5, 12, 0).y - c.project(5, 12, fly.hover).y;
    assert.ok(lift > 0);
    assert.ok(Math.abs((ground.screen.y - fly.screen.y) - lift) < 1e-6, `body lifted by the projected FLY_HOVER (${ground.screen.y - fly.screen.y} vs ${lift})`);
    // the bar sits the head height above the body (the projected scale at the body's height, so not exactly `lift`)
    assert.ok(fly.screen.top < fly.screen.y && Math.abs((fly.screen.y - fly.screen.top) - (ground.screen.y - ground.screen.top)) < 0.1 * (ground.screen.y - ground.screen.top), 'the HP bar keeps its head height over the body');
    assert.ok(ground.screen.top - fly.screen.top > 0.9 * lift, `the HP bar rides the body (${ground.screen.top - fly.screen.top} vs ${lift})`);
    assert.ok(Math.abs(fly.shadow.position.y - ground.shadow.position.y) < 1e-9, 'the shadow stays on the ground');
  });
});

// GitHub #277 (@FrogThai): 飞机经过一格方块时会跟走楼梯一样，有高低差 — a flyer crossing one raised tile (high ground,
// a forbidden block) rose onto the block and dropped back like a step, because the view added the tile's height under
// it before its FLY_HOVER. The official lift is one constant over the route (docs/research/12: Vector3(0, 0.35, 0) added
// while flying), so an enemy flyer hovers from the road (z 0) whatever tile it crosses; its shadow lies on the tile top
// under it. Ground enemies keep to the road as before, and an operator on high ground keeps standing on the block.
describe('an enemy flyer crossing a raised tile keeps its height (GitHub #277)', () => {
  const RAISED = { row: 12, col: 6, h: 0.42 };   // one high-ground block ('h', TILE_H.wall) on the flyer's row
  const heightAt = (r, c) => (r === RAISED.row && c === RAISED.col ? RAISED.h : 0);
  const sample = (x, flags) => ({ x, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags, anim: 1, vx: 0.5 });

  test('the body stays FLY_HOVER above the road over the block; the shadow lies on the block top', async () => {
    const { FLY_HOVER } = await import('../../public/js/render/units.js');
    const ctx = fakeViewCtx(fake.P, { assets: store(), cam, heightAt });
    const fly = new UnitView(ctx, { id: 1, side: 'enemy', kind: 'enemy', defId: 'enemy_1005_yokai', x: 4, y: 12, maxHp: 100, motion: 'FLY' }, {});
    await tick(); await tick();
    let t = 0;
    const step = (x) => { fly.sync(sample(x, 512), t); fly.update(1 / 60, cam(), t); t += 1 / 60; };
    for (let i = 0; i < 180; i++) step(4);                       // settle the lift on the road
    const heights = [];
    for (let i = 0; i <= 80; i++) { step(4 + i * 0.05); heights.push(fly.z + fly.hover); }   // x 4 → 8 across col 6
    const rise = Math.max(...heights) - Math.min(...heights);
    assert.ok(rise < 1e-6, `the body height never changes over the block (rose ${rise.toFixed(3)} tiles; before: +${RAISED.h})`);
    assert.ok(Math.abs(heights[0] - FLY_HOVER) < 1e-3, `FLY_HOVER above the road (${heights[0].toFixed(3)})`);
    for (let i = 0; i < 60; i++) step(6);                        // hold over the block
    assert.equal(fly.z, 0, 'the flyer hovers from the road plane');
    const c = cam();
    assert.ok(Math.abs(fly.screen.y - c.project(6, 12, FLY_HOVER).y) < 1e-6, 'drawn FLY_HOVER above the road, not above the block');
    assert.ok(Math.abs(fly.shadow.position.y - c.project(6, 12, RAISED.h).y) < 0.05, 'its shadow lies on the block top under it');
    for (let i = 0; i < 60; i++) step(8);                        // back over the road
    assert.ok(Math.abs(fly.shadow.position.y - c.project(8, 12, 0).y) < 0.05, 'and on the road again past it');
  });

  test('ground enemies stay on the road and an operator on the block stands on its top', async () => {
    const ctx = fakeViewCtx(fake.P, { assets: store(), cam, heightAt });
    const walker = new UnitView(ctx, { id: 2, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime', x: 6, y: 12, maxHp: 100 }, {});
    const op = new UnitView(ctx, { id: 3, side: 'ally', kind: 'chess', defId: 'char_x', tier: 1, x: 6, y: 12, maxHp: 100 }, {});
    await tick(); await tick();
    for (let i = 0; i < 60; i++) {
      walker.sync(sample(6, 0), i / 60); walker.update(1 / 60, cam(), i / 60);
      op.sync({ ...sample(6, 0), anim: 0, vx: 0 }, i / 60); op.update(1 / 60, cam(), i / 60);
    }
    assert.equal(walker.z, 0, 'a ground enemy is never popped onto a block');
    assert.ok(Math.abs(op.z - RAISED.h) < 1e-6, `the operator stands on the high ground (${op.z})`);
  });
});

// PR #275 (@xcdoge): 猎狗pro ships Move_Loop 0.80 s next to Run_Loop 0.53 s and its moveSpeed is 1.9, so a fast enemy
// walks on its model's own Run cycle (anims.run) while a standard one keeps Move; the cast slot composes with it.
describe('a fast enemy walks on its Run cycle (PR #275)', () => {
  const entry = {
    skel: '/s/x.skel', atlas: '/s/x.atlas', textures: ['/s/x.png'],
    anims: {
      idle: 'Idle', deploy: 'Idle', die: 'Die', attack: null,
      move: { begin: 'Move_Begin', loop: 'Move_Loop', end: 'Move_End' },
      run: { begin: 'Run_Begin', loop: 'Run_Loop', end: 'Run_End' },
      skill: { begin: null, loop: 'Skill_01', end: null, index: 0, idle: null },
      skills: { 0: { begin: null, loop: 'Skill_01', end: null, index: 0, idle: null }, 1: { begin: null, loop: 'Skill_02', end: null, index: 1, idle: null } },
    },
    animations: { Idle: 1, Die: 0.67, Move_Begin: 0.17, Move_Loop: 0.8, Move_End: 0.17, Run_Begin: 0.17, Run_Loop: 0.53, Run_End: 0.17, Skill_01: 1, Skill_02: 1 },
  };
  const assets = {
    picture: () => null, image: async () => null, spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: Object.keys(entry.animations).map((name) => ({ name })) }), release() {} },
  };
  const enemyView = async (id, speed, side = 'enemy') => {
    const ctx = fakeViewCtx(fake.P, { assets, cam, lookupDef: () => ({ stats: { moveSpeed: speed } }) });
    const v = new UnitView(ctx, { id, side, kind: side === 'enemy' ? 'enemy' : 'op', defId: 'enemy_1000_gopro_2', x: 5, y: 12, maxHp: 100 }, {});
    await tick(); await tick();
    assert.ok(v.actor, 'spine actor built');
    return v;
  };

  test('moveSpeed 1.9 moves on Run, 1 on Move; the cast slot and the Run cycle compose', async () => {
    const hound = await enemyView(1, 1.9);
    assert.equal(hound.actor.roles.move.loop, 'Run_Loop');
    const slug = await enemyView(2, 1);
    assert.equal(slug.actor.roles.move.loop, 'Move_Loop');
    // the MOVE anim code plays it
    hound.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: 0.5 }, 1);
    for (let i = 0; i < 20; i++) hound.update(1 / 60, cam(), i / 60);
    assert.match(String(hound.actor.current), /^Run/, `playing ${hound.actor.current}`);
    hound.setSkillSlot(1);
    assert.equal(hound.actor.roles.skill.loop, 'Skill_02', 'the cast slot');
    assert.equal(hound.actor.roles.move.loop, 'Run_Loop', 'and the Run cycle survives it');
    hound.actor.setRunMode(false);
    assert.equal(hound.actor.roles.move.loop, 'Move_Loop');
    assert.equal(hound.actor.roles.skill.loop, 'Skill_02', 'the cast slot survives that too');
  });
});

// 推拉 (player report): the sim displaces instantly (battle/displacement.js walks 0.1-tile steps inside one call) and the
// snapshot only carries the destination, so the view eases there (app.js `displace` fx → UnitView.slideTo) instead of
// appearing at the end of the path.
describe('a push / pull slide (推拉: the official impulse under friction)', () => {
  const view = async (id = 1) => {
    const ctx = fakeViewCtx(fake.P, { assets: store({ spine: true }), cam });
    const v = new UnitView(ctx, { id, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime', x: 5, y: 12, maxHp: 100 }, {});
    await tick(); await tick();
    return v;
  };
  // 推进 n 帧（update 会把单帧 dt 截到 0.1 s，所以必须多帧走完）
  const step = (v, dur, n = 60) => { for (let i = 0; i < n; i++) v.update(dur / n, cam(), 0); };

  test('slideTo runs a real deceleration: the velocity falls every frame and stops on the destination', async () => {
    const v = await view();
    v.slideTo(7.7, 12);
    const sl = v.slide;
    assert.ok(sl, 'a slide is in flight');
    assert.ok(sl.v > 0 && sl.a > 0, 'it starts with a speed and a deceleration');
    assert.ok(Math.abs(sl.v * sl.v / (2 * sl.a) - 2.7) < 1e-6, 'v²/2a = the distance (constant deceleration)');
    let prev = sl.v;
    let monotone = true;
    for (let i = 0; i < 40; i++) {
      v.update(sl.dur / 80, cam(), 0);
      if (v.slide && v.slide.v > prev + 1e-9) monotone = false;
      if (!v.slide) break;
      prev = v.slide.v;
    }
    assert.ok(monotone, 'the velocity only ever decreases');
    step(v, sl.dur);
    assert.equal(v.x, 7.7, 'it arrives exactly on the authoritative destination');
    assert.equal(v.y, 12, 'the cross axis holds');
    assert.equal(v.slide, null);
  });

  test('starting a slide from the destination is a no-op (why app.js pre-scans the frame)', async () => {
    // The trap this guards: app.js's snapshot loop runs before processEvents, and the snapshot already carries the
    // displacement's destination, so a fx handler that runs after it finds the view there and has nothing to animate —
    // the reported pause with no frames. app.js therefore starts the slide from the pre-snapshot position.
    const v = await view(8);
    v.sync({ x: 7.7, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0 });
    assert.equal(v.x, 7.7);
    v.slideTo(7.7, 12);
    assert.equal(v.slide, null, 'no slide when the view is already there');
  });

  test('a second request for the same destination never restarts the slide in flight', async () => {
    const v = await view(9);
    v.slideTo(7.7, 12);
    const first = v.slide;
    for (let i = 0; i < 10; i++) v.update(first.dur / 40, cam(), 0);
    const mid = v.x, done = v.slide.done;
    v.slideTo(7.7, 12);                       // the fx handler, later in the same frame
    assert.equal(v.slide, first, 'the same slide object, not a restart');
    assert.equal(v.x, mid, 'the position is untouched');
    assert.equal(v.slide.done, done);
    step(v, first.dur);
    assert.equal(v.x, 7.7, 'and it still lands');
  });

  test('an unmarked raw displacement still faces its travel direction', async () => {
    const v = await view(10);
    v.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0, vx: -1.2 });
    assert.equal(v.visFacing, -1, 'walking left before the pull');
    v.slideTo(7.7, 12);                       // unmarked raw move to the right
    assert.equal(v.visFacing, 1, 'faces the movement at once');
    for (let i = 0; i < 20; i++) v.update(v.slide.dur / 40, cam(), 0);
    assert.equal(v.visFacing, 1, 'still facing the movement in flight');
    v.slideTo(5.2, 12);                       // another unmarked raw move to the left
    assert.equal(v.visFacing, -1, 'and the other way for a raw move');
  });

  test('a flagged push or pull keeps the enemy facing left while sliding right, then resumes snapshot facing', async () => {
    const v = await view(14);
    v.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: -1 });
    assert.equal(v.visFacing, -1, 'facing left before the push');
    v.slideTo(6.7, 12, { at: 3, dur: 0.8, keepFacing: true });
    assert.equal(v.visFacing, -1, 'unchanged when the push begins');
    v.sync({ x: 6.7, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: 20 }, 2.95);
    v.update(1 / 60, cam(), 0);
    assert.equal(v.visFacing, -1, 'a positive interpolated velocity cannot flip it before the destination snapshot');
    v.sync({ x: 6.7, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: -1 }, 3);
    const dur = v.slide.dur;
    step(v, dur / 2);
    assert.ok(v.x > 5 && v.x < 6.7, `still slides right (${v.x})`);
    assert.equal(v.visFacing, -1, 'unchanged in flight');
    step(v, dur / 2);
    assert.equal(v.slide, null, 'slide ends normally');
    assert.equal(v.x, 6.7);
    v.sync({ x: 6.6, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: 1 });
    assert.equal(v.visFacing, 1, 'normal snapshot facing resumes after the slide');
  });

  test('a buffered earlier attack sets the facing retained by a prestarted slide in either field direction', async () => {
    for (const sign of [-1, 1]) {
      const v = await view(30 + sign);
      v.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: -sign });
      v.slideTo(5 - sign, 12, { at: 3, dur: 0.8, keepFacing: true });
      v.onAttack({ x: 5 + sign, y: 12 }, 2.9, 'melee');
      assert.equal(v.visFacing, sign, 'the earlier attack supplies the real pre-push facing');
      v.sync({ x: 5 - sign, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: -sign * 20 }, 3);
      step(v, v.slide.dur / 2);
      assert.equal(v.visFacing, sign, 'the slide and sampled velocity retain that facing');
    }
  });

  test('a snapshot in flight does not teleport it (the slide owns the position until it lands)', async () => {
    const v = await view(7);
    v.slideTo(7.7, 12);
    const dur = v.slide.dur;
    for (let i = 0; i < 12; i++) v.update(dur / 40, cam(), 0);
    const mid = v.x;
    assert.ok(mid > 5.2 && mid < 7.6, `mid-flight (${mid})`);
    // the sim's snapshots already carry the destination (it displaced the enemy inside one call), so a plain sync
    // would snap the view there — the reported "no frames in between"
    v.sync({ x: 7.7, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0 });
    assert.equal(v.x, mid, 'the snapshot does not move a sliding view');
    assert.equal(v.y, 12);
    step(v, dur);
    assert.equal(v.x, 7.7, 'and it still lands on the destination');
    // once landed, snapshots drive it again
    v.update(dur, cam(), 0);
    v.sync({ x: 6.4, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0 });
    assert.equal(v.x, 6.4, 'a landed view follows the snapshot again');
  });

  test('a slippery floor (a smaller friction factor) slides longer and lands just the same', async () => {
    const dry = await view(2), ice = await view(3);
    dry.slideTo(7.7, 12);
    ice.slideTo(7.7, 12, { friction: 0.5 });
    assert.ok(ice.slide.dur > dry.slide.dur * 1.5, `ice ${ice.slide.dur} > dry ${dry.slide.dur}`);
    step(ice, ice.slide.dur * 1.05, 90);
    assert.equal(ice.x, 7.7, 'the destination is authoritative whatever the floor');
  });

  test('the slide takes the sim\'s 失衡 time: the fx `dur` (game s) at the playback rate — 0.8 s at 2× is 0.4 real s', async () => {
    const at2 = async (id) => {
      const ctx = fakeViewCtx(fake.P, { assets: store({ spine: true }), cam, animRate: () => 2 });
      const v = new UnitView(ctx, { id, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime', x: 5, y: 12, maxHp: 100 }, {});
      await tick(); await tick();
      return v;
    };
    const push = await at2(11), pull = await at2(12), old = await at2(13);
    push.slideTo(6.7, 12, { dur: 0.8 });                    // a 受力等级 0 push (1.7 tiles, PRTS 位移时间 0.8 s)
    assert.ok(Math.abs(push.slide.dur - 0.4) < 1e-9, `${push.slide.dur}`);
    pull.slideTo(3, 12, { dur: 1 });                        // a pull's force window
    assert.ok(Math.abs(pull.slide.dur - 0.5) < 1e-9, `${pull.slide.dur}`);
    old.slideTo(6.7, 12);                                   // an fx without `dur` (an older recording): the fallback
    assert.ok(Math.abs(old.slide.dur - Math.min(0.45, Math.max(0.12, 0.14 * Math.sqrt(1.7)))) < 1e-9, `${old.slide.dur}`);
    step(push, push.slide.dur);
    assert.equal(push.x, 6.7, 'lands on the destination');
  });

  test('the duration follows √distance, not distance', async () => {
    const near = await view(4), far = await view(5);
    near.slideTo(6.2, 12); far.slideTo(10.5, 12);          // 1.2 vs 5.5 tiles
    assert.ok(far.slide.dur > near.slide.dur, `${far.slide.dur} > ${near.slide.dur}`);
    assert.ok(far.slide.dur / near.slide.dur < 2.6, 'sub-linear (∝ √d)');
  });

  test('a trivial move snaps, an unknown target is ignored; a unit that dies on the way lies where it was pushed', async () => {
    const v = await view(6);
    v.slideTo(5.01, 12);
    assert.equal(v.slide, null); assert.equal(v.x, 5.01, 'a sub-0.05 tile move is not a displacement');
    v.slideTo(NaN, 12);
    assert.equal(v.slide, null); assert.equal(v.x, 5.01);
    v.slideTo(7.7, 12);
    step(v, v.slide.dur / 3, 20);
    assert.ok(v.x > 5 && v.x < 7.7, `moving (${v.x})`);
    // the sim's displacement already put the body at the destination (a Weedy wall kill dies there): the corpse
    // finishes the slide and stays — PR #380 sent it back to where it stood, and the next snapshot then jumped it
    v.die();
    v.update(1, cam(), 0);
    v.update(0.1, cam(), 0);
    assert.equal(v.x, 7.7, 'the corpse lies where the push put it');
    assert.equal(v.slide, null);
    const dead = await view(11);
    dead.die();
    dead.slideTo(7.7, 12);
    assert.equal(dead.slide, null, 'a dead view does not start a slide');
    assert.equal(dead.x, 7.7, 'it is placed on the destination');
  });

  test('held until the snapshot with the destination is shown (`at`), then eased into the sampled position — the walk it resumes included — with no jump on landing', async () => {
    const v = await view(12);
    v.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: -0.8 }, 2.9);
    v.slideTo(7.7, 12, { at: 3 });              // app.js: the interval ending on the destination's snapshot is shown
    for (const [x, t] of [[5.9, 2.93], [6.8, 2.96]]) {   // the interpolator lerps there in the meantime
      v.sync({ x, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: 27 }, t);
      v.update(1 / 60, cam(), 0);
      assert.equal(v.x, 5, `held where it stood at ${t}`);
    }
    // from the destination's snapshot on the sample anchors the slide, and the enemy walks back down its route
    let live = 7.7, prev = v.x, maxStep = 0, frames = 0;
    for (let t = 3; v.slide && frames < 120; t += 1 / 30, frames++) {
      v.sync({ x: live, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: -0.8 }, t);
      v.update(1 / 60, cam(), 0);
      maxStep = Math.max(maxStep, Math.abs(v.x - prev)); prev = v.x;
      live -= 0.8 / 30;
    }
    assert.ok(frames >= 8, `a slide of ${frames} frames, not a jump`);
    assert.equal(v.slide, null);
    assert.ok(maxStep < 0.4, `no frame moves more than ${maxStep.toFixed(3)} tiles`);
    const landed = v.x;
    v.sync({ x: live, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1, vx: -0.8 }, 3 + frames / 30);
    assert.ok(Math.abs(v.x - landed) < 0.05, `landed on the walking enemy (${landed.toFixed(3)} → ${v.x.toFixed(3)})`);
  });

  test('a slide whose destination snapshot never shows (the unit left the snapshots) goes to the fx\'s destination', async () => {
    const v = await view(13);
    v.slideTo(7.7, 12, { at: 3 });
    for (let i = 0; i < 24; i++) v.update(1 / 60, cam(), 0);
    assert.equal(v.x, 5, 'held while the snapshot may still come');
    for (let i = 0; i < 30; i++) v.update(1 / 60, cam(), 0);
    assert.equal(v.slide, null);
    assert.equal(v.x, 7.7, 'then slid to where the push put it');
    v.sync({ x: 6.1, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 1 }, 3.4);
    assert.equal(v.x, 6.1, 'snapshots drive it again');
  });
});

// the app.js frame order (render/app.js: processEvents takes the events ≤ renderT — a 'die' kills the view —, then
// syncBattle's look-ahead starts a slide for a `displace` fx still queued up to the next snapshot, then each sampled unit
// goes through syncView — a dying view takes only the position —, then update) run over a real battle: a pushed enemy is
// drawn sliding, not snapped, and one killed by the push lies where the sim put it
describe('a push through SnapshotBuffer and UnitView in the app.js frame order (PR #380)', () => {
  /**
   * A real battle: an enemy (`kind` 'route': on its route; 'summon': spawned mid-battle; 'flyer': a flying one) pushed
   * 1.7 tiles at 3 s, killed `killDelay` ticks later when `kill`. Returns the drawn x of every frame from renderT 2.8 to
   * 4.6, the sim's position right after the push and where the body lies (the sim's position at the kill).
   */
  async function pushed({ kill = false, killDelay = 0, kind = 'route' } = {}) {
    const { makeBattle, enemyRec } = await import('../helpers/battleHarness.js');
    const { SnapshotBuffer } = await import('../../public/js/render/interp.js');
    const { snapFrame } = await import('../../server/match/fields.js');
    const { syncView } = await import('../../public/js/render/units.js');
    const rec = enemyRec({ key: 'enemy_walker', hp: 1e6, speed: 0.8, ...(kind === 'flyer' ? { motion: 'FLY' } : {}) });
    const h = makeBattle({ defs: { enemies: { enemy_walker: rec } }, enemies: kind === 'summon' ? [] : [{ key: 'enemy_walker', time: 0, route: 0 }],
      content: 'none', autoFinish: false, timeLimit: 60 });
    const frames = [];
    let e = null, info = null, moved = 0, dest = null, since = -1, body = null;
    for (let i = 0; i < 30 * 7; i++) {
      h.b.step();   // the battle's own step: h.step() would drain the events into h.events
      if (kind === 'summon' && !e && h.b.time >= 1) e = h.b.spawnEnemy('enemy_walker', { pos: [10, 8] });   // (h.spawn drains too)
      e = e || h.enemy('enemy_walker');
      if (!moved && e && h.b.time >= 3) { moved = h.b.displace(e, { x: 1, y: 0 }, 1.7); dest = e.x; since = 0; }
      else if (since >= 0) since++;
      if (kill && since === killDelay) { h.b.kill(e, null); body = e.x; }
      if (i % 3 === 2) {
        const ev = h.b.drainEvents();
        info = info || ev.find((x) => x[0] === 'spawn' && e && x[1].id === e.id)?.[1];
        const s = h.b.snapshot();
        frames.push({ at: s.t / 2, snap: snapFrame('f', s), ev, gt: s.t });
      }
    }
    assert.ok(moved > 1, `the sim pushed it ${moved} tiles`);
    assert.equal(e.alive, !kill);
    const v = new UnitView(fakeViewCtx(fake.P, { cam }), info, {});
    const buf = new SnapshotBuffer(), sample = new Map(), xs = [];
    const start = (ev, at) => { if (ev[0] === 'fx' && ev[1] === 'displace' && ev[4]?.id === e.id) v.slideTo(Number(ev[2]), Number(ev[3]), at == null ? {} : { at }); };
    for (let f = 0, fi = 0; f < 60 * 4; f++) {
      const now = f / 60;
      for (; fi < frames.length && frames[fi].at <= now; fi++) { buf.push(frames[fi].snap, frames[fi].at); buf.pushEvents(frames[fi].ev, frames[fi].at, frames[fi].gt); }
      const renderT = buf.update(now);
      if (!Number.isFinite(renderT)) continue;
      for (const ev of buf.takeEvents(renderT, [])) { start(ev); if (ev[0] === 'die' && ev[1] === e.id && v.alive) v.die(); }
      const at = buf.nextSnapT(renderT);
      if (at > renderT) buf.forEachUpcoming(renderT, at, (ev) => start(ev, at));
      buf.sample(renderT, sample);
      if (sample.get(e.id)) syncView(v, sample.get(e.id), renderT);
      v.update(1 / 60, cam(), now);
      if (renderT > 2.8 && renderT < 4.6) xs.push(v.x);
    }
    return { xs, dest, body };
  }
  /** The largest frame-to-frame step, the frames moving, the slide's first frame and any step back after it. */
  const steps = (xs) => {
    let big = 0, moving = 0, back = false;
    const from = xs.findIndex((x, i) => i > 0 && x > xs[i - 1] + 0.01);   // the slide's first frame (it walked left before)
    for (let i = 1; i < xs.length; i++) {
      const d = xs[i] - xs[i - 1];
      big = Math.max(big, Math.abs(d)); if (Math.abs(d) > 0.02) moving++;
      if (from > 0 && i > from && d < -1e-9) back = true;
    }
    return { big, moving, from, back };
  };

  test('a 1.7-tile push is drawn over a dozen frames, every frame a step under 0.35 tiles', async () => {
    const { xs } = await pushed();
    const { big, moving } = steps(xs);
    assert.ok(moving >= 8, `${moving} frames show it moving (the bare interpolator: 3)`);
    assert.ok(big < 0.35, `largest step ${big.toFixed(3)} tiles (the bare interpolator: 0.58)`);
  });

  // a unit killed on the very step of its push: its 'die' comes due with the displace fx, so its view is dying before the
  // slide can anchor — and syncBattle gives a dying view only its position (syncView). The slide used to stay on hold,
  // be dropped after 0.5 s, past the 0.8 s DIE window, and leave the body on its pre-push tile (Grok's review of fb7-render)
  for (const [name, o] of [
    ['killed on the step of the push', { kind: 'route', killDelay: 0 }],
    ['a summoned enemy killed on the step of the push', { kind: 'summon', killDelay: 0 }],
    ['a flyer killed on the step of the push', { kind: 'flyer', killDelay: 0 }],
    ['killed 6 ticks after the push', { kind: 'route', killDelay: 6 }],
  ]) {
    test(`${name}: the body slides on to where the sim put it and stays there, no frame stepping 0.35 tiles`, async () => {
      const { xs, dest, body } = await pushed({ kill: true, ...o });
      const { big, moving, from, back } = steps(xs);
      if (!o.killDelay) assert.equal(body, dest, 'killed where the push put it');
      assert.ok(Math.abs(xs[xs.length - 1] - body) < 0.011, `lies at ${xs[xs.length - 1].toFixed(3)}, the sim's body at ${body.toFixed(3)}`);
      assert.ok(from > 0 && moving >= 8, `${moving} frames show it sliding`);
      assert.ok(big < 0.35, `largest step ${big.toFixed(3)} tiles`);
      // (killed later, it walked back down its route a little first: the body eases onto that)
      if (!o.killDelay) assert.ok(!back, 'never back towards where it stood');
    });
  }
});

// PR #380, death: a flyer holds its lift through the Die clip (the official client drops its fly offset in
// CharacterAnimator.OnFinish) and a long Die clip plays whole (DIE_CLIP_MAX, data/assets.json's longest 7.97 s)
describe('death timing (PR #380): a dying flyer drops inside the fade, a long Die clip plays whole', () => {
  test('a dying flyer keeps FLY_HOVER through its Die clip and sinks only in the fade tail; a walker stays down', async () => {
    const { FLY_HOVER, UF } = { ...(await import('../../public/js/render/units.js')), ...(await import('../../shared/constants.js')) };
    const ctx = fakeViewCtx(fake.P, { cam });
    const fly = new UnitView(ctx, { id: 21, side: 'enemy', kind: 'enemy', defId: 'enemy_fly', motion: 'FLY', x: 5, y: 12, maxHp: 100 }, {});
    fly.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: UF.FLYING, anim: 1 }, 1);
    for (let i = 0; i < 120; i++) fly.update(1 / 60, cam(), 0);
    assert.ok(Math.abs(fly.hover - FLY_HOVER) < 1e-3, 'aloft while alive');
    fly.die();                                   // no clip known: 0.35 s of clip, then the 0.55 s fade
    for (let i = 0; i < 18; i++) fly.update(1 / 60, cam(), 0);
    assert.ok(Math.abs(fly.hover - FLY_HOVER) < 1e-3, `still aloft in the Die clip (${fly.hover.toFixed(3)})`);
    for (let i = 0; i < 30; i++) fly.update(1 / 60, cam(), 0);
    assert.ok(fly.hover < FLY_HOVER * 0.25, `sinking in the fade (${fly.hover.toFixed(3)})`);
    const walker = new UnitView(ctx, { id: 22, side: 'enemy', kind: 'enemy', defId: 'enemy_walk', x: 5, y: 12, maxHp: 100 }, {});
    walker.die();
    walker.update(1 / 60, cam(), 0);
    assert.equal(walker.hover, 0);
  });

  test('every enemy Die clip of data/assets.json is within DIE_CLIP_MAX, and a 7.97 s one is scheduled whole', async () => {
    const { DIE_CLIP_MAX, dieClipDur } = await import('../../public/js/render/units.js');
    const durs = Object.values(ASSETS.enemies).map((e) => dieClipDur(e && e.spine)).filter((d) => d > 0);
    assert.ok(durs.length > 200, `${durs.length} enemy Die clips`);
    const longest = Math.max(...durs);
    assert.ok(longest <= DIE_CLIP_MAX, `longest Die clip ${longest} s ≤ ${DIE_CLIP_MAX}`);
    assert.ok(durs.filter((d) => d > 1.6).length > 0, 'the old 1.6 s cap cut some clips short');
    const entry = { skel: '/s/q.skel', atlas: '/s/q.atlas', textures: ['/s/q.png'], anims: { idle: 'Idle', die: 'Die' }, animations: { Idle: 1, Die: longest } };
    const assets = { ...store({ spine: true }), spineEntry: () => entry };
    const v = new UnitView(fakeViewCtx(fake.P, { assets, cam }), { id: 23, side: 'enemy', kind: 'enemy', defId: 'enemy_1521_dslily', x: 5, y: 12, maxHp: 100 }, {});
    await tick(); await tick();
    assert.ok(v.actor, 'the model is up');
    v.die();
    assert.ok(Math.abs(v.dying - (longest + 0.55)) < 1e-6, `the whole clip, then the fade (${v.dying.toFixed(3)} s)`);
    for (let i = 0; i < 300; i++) v.update(1 / 60, cam(), 0);
    assert.ok(!v.remove && v.alpha > 0.5, 'still on screen 5 s in');
  });
});
