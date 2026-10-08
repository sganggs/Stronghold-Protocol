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

  test('a walk-back velocity does not flip the sprite mid-slide, but does once it lands', async () => {
    // Player report: 有些敌人会反过来有些不会. The sim displaces instantly, so an enemy that re-paths immediately
    // reports the velocity of its walk BACK — that flipped the sprite during the knockback, for exactly those enemies
    // that had one. The official does not turn a displaced unit; the facing it had is what it keeps until it walks.
    const v = await view(12);
    v.visFacing = 1;
    v.slideTo(3.8, 12);                                        // pushed left
    v.sync({ x: 3.8, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 1.4 });
    assert.equal(v.visFacing, 1, 'a rightward walk-back velocity must not flip it in mid-air');
    step(v, v.slide.dur);
    assert.equal(v.x, 3.8, 'landed');
    v.sync({ x: 3.8, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 1.4 });
    assert.equal(v.visFacing, 1, 'and once it is walking again the walk direction rules');
    v.sync({ x: 3.8, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0, vx: -1.4 });
    assert.equal(v.visFacing, -1, 'either way once landed');
  });

  test('a displaced view already on the destination still slides from where it was', async () => {
    // app.js's snapshot loop runs before processEvents and the snapshot already carries the displacement's
    // destination, so the fx handler finds the view there. The view remembers where it stood before that snapshot and
    // a fx marked `displaced` rebuilds the slide from there — order- and latency-independent.
    const v = await view(13);
    v.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0 });
    assert.equal(v.x, 5);
    v.sync({ x: 7.7, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0 });   // the frame's snapshot: already there
    assert.equal(v.x, 7.7);
    v.slideTo(7.7, 12, { displaced: true });
    assert.ok(v.slide, 'still slides');
    assert.equal(v.x, 5, 'back to the position held before that snapshot');
    step(v, v.slide.dur);
    assert.equal(v.x, 7.7, 'and lands on the destination');
    const w = await view(14);
    w.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0 });
    w.slideTo(5, 12);
    assert.equal(w.slide, null, 'a plain call at the current position stays a no-op');
  });

  test('a fast charge still turns the unit (no speed ceiling on the facing)', async () => {
    // 萨卡兹穿刺手 accelerates to 12.75 game tiles/s = 25.5 real tiles/s (official enemy_database talentBlackboard
    // rush.dlancer_t[trigger]); a speed ceiling meant to filter out displacement spikes would freeze its facing, and
    // could not separate the two anyway. The slide's own facing lock covers the spike (one snapshot interval, ~50 ms),
    // so the rule has no ceiling.
    const v = await view(16);
    v.visFacing = -1;
    v.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0, vx: -0.5 });
    assert.equal(v.visFacing, -1, 'a walk to the left keeps it facing left');
    v.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0.62 });
    assert.equal(v.visFacing, 1, 'a walk to the right turns it');
    v.sync({ x: 5, y: 12, hp: 100, maxHp: 100, sp: 0, spMax: 0, flags: 0, anim: 0, vx: -25.5 });
    assert.equal(v.visFacing, -1, 'a fully charged lancer (25.5 tiles/s) still turns');
  });

  test('a push does not turn the unit (the official keeps its facing)', () => {
    // Player-verified: a knockback does not force the facing. The official's _dontChangeFaceByDirection is what some
    // abilities opt out of, not what a displacement does — so the slide must leave visFacing to the snapshot's vx.
    // (The enemy does stand still for a moment after landing; that pause is the sim's — route cleared, atkStandUntil.)
    const v = new UnitView(fakeViewCtx(fake.P, { assets: store({ spine: true }), cam }), {
      id: 11, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime', x: 5, y: 12, maxHp: 100,
    }, {});
    v.visFacing = -1;
    v.slideTo(7.7, 12);
    assert.equal(v.visFacing, -1, 'facing untouched when the slide starts');
    for (let i = 0; i < 80 && v.slide; i++) v.update(v.slide.dur / 40, cam(), 0);
    assert.equal(v.visFacing, -1, 'and untouched while it slides');
    assert.equal(v.x, 7.7, 'it still lands on the destination');
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

  test('the duration follows √distance, not distance', async () => {
    const near = await view(4), far = await view(5);
    near.slideTo(6.2, 12); far.slideTo(10.5, 12);          // 1.2 vs 5.5 tiles
    assert.ok(far.slide.dur > near.slide.dur, `${far.slide.dur} > ${near.slide.dur}`);
    assert.ok(far.slide.dur / near.slide.dur < 2.6, 'sub-linear (∝ √d)');
  });

  test('a trivial move snaps, an unknown target is ignored, and a corpse never slides', async () => {
    const v = await view(6);
    v.slideTo(5.01, 12);
    assert.equal(v.slide, null); assert.equal(v.x, 5.01, 'a sub-0.05 tile move is not a displacement');
    v.slideTo(NaN, 12);
    assert.equal(v.slide, null); assert.equal(v.x, 5.01);
    v.slideTo(7.7, 12);
    step(v, v.slide.dur / 3, 20);
    assert.ok(v.x > 5 && v.x < 7.7, `moving (${v.x})`);
    v.die();
    v.update(1, cam(), 0);
    assert.equal(v.x, 5.01, 'the corpse is back where it stood, not at the destination');
    assert.equal(v.slide, null);
  });
});
