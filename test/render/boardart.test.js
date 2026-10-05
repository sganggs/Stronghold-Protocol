// test/render/boardart.test.js — the real-board-art pipeline and the new pure pieces of the renderer:
//   * tools/crop-board-atlas.mjs rects/materials are consistent with the renderer's material list, stay inside
//     their source textures, and (when the local art is installed) cover real, non-empty pixels,
//   * high-ground plate connectivity, textured device boxes, the backdrop ground plane,
//   * every fx kind the sim emits has an explicit visual; junk fx / status keys never throw,
//   * the impostor atlas shelf allocator (with a fake PIXI),
//   * the optional local-art manifest helpers.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATERIALS as CROPS, SOURCES, BACKDROP, decodePng, encodePng, rectStats, pngSize } from '../../tools/crop-board-atlas.mjs';
import { MATERIALS } from '../../public/js/render/textures.js';
import { parseStage, buildTileQuads, boxQuads, buildPlaneQuads, deviceBoxOf, DEVICE_BOX, splitQuadGroups } from '../../public/js/render/tiles.js';
import { FX_KINDS, fxSpec, tilesAround } from '../../public/js/render/fx.js';
import { statusIconKey } from '../../public/js/render/style.js';
import { STATUS_KEYS } from '../../public/js/render/textures.js';
import { createAssets, localAssetUrl } from '../../public/js/assets.js';
import { loadBoardArt, resetBoardArt, sourceUrl } from '../../public/js/render/boardArt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));
const ART_DIR = path.join(ROOT, 'public/assets/local/map/autochess');
const hasArt = existsSync(path.join(ART_DIR, SOURCES.D.file));

describe('board atlas crops (tools/crop-board-atlas.mjs)', () => {
  test('every cropped material exists in the renderer atlas; rects stay inside their sources', () => {
    for (const [name, layers] of Object.entries(CROPS)) {
      assert.ok(MATERIALS.includes(name), `${name} is a renderer material`);
      assert.ok(Array.isArray(layers) && layers.length, name);
      for (const ly of layers) {
        if (ly.proc) { assert.equal(ly.proc, 'rim'); continue; }
        const S = SOURCES[ly.src];
        assert.ok(S, `${name}: source ${ly.src}`);
        const [x, y, w, h] = ly.rect;
        assert.ok(x >= 0 && y >= 0 && w > 8 && h > 8 && x + w <= S.w && y + h <= S.h, `${name}: rect ${ly.rect} inside ${ly.src}`);
        if (ly.rot != null) assert.ok([0, 90, 180, 270].includes(ly.rot), `${name}: rot`);
        if (ly.tint != null) assert.match(ly.tint, /^#[0-9a-f]{6}$/i);
      }
    }
    assert.equal(BACKDROP.src, 'BG');
    assert.ok(MATERIALS.length <= 64, 'atlas holds at most 64 cells');
  });

  test('the real atlas (when installed): sizes match and every first layer covers opaque, non-flat pixels', { skip: !hasArt && 'local art not extracted' }, () => {
    const imgs = {};
    for (const [k, s] of Object.entries(SOURCES)) {
      const f = path.join(ART_DIR, s.file);
      if (!existsSync(f)) continue;
      const buf = readFileSync(f);
      assert.deepEqual(pngSize(buf), { w: s.w, h: s.h }, s.file);
      imgs[k] = decodePng(buf);
    }
    for (const [name, layers] of Object.entries(CROPS)) {
      const ly = layers[0];
      if (!imgs[ly.src]) continue;
      const st = rectStats(imgs[ly.src], ly.rect);
      assert.ok(st.opaque > 0.9, `${name}: opaque ${st.opaque}`);
      assert.ok(st.std > 2, `${name}: contrast ${st.std}`);
    }
    const tiles = path.join(ART_DIR, 'tiles.json');
    if (existsSync(tiles)) {
      const j = JSON.parse(readFileSync(tiles, 'utf8'));
      assert.equal(j.cell, 256);
      assert.deepEqual(Object.keys(j.materials).sort(), Object.keys(CROPS).sort(), 'tiles.json is up to date (node tools/crop-board-atlas.mjs)');
      for (const s of Object.values(j.source)) assert.match(s.path, /^\/assets\/local\/map\/autochess\/TX_autochessi_\w+\.png$/);
    }
  });

  test('PNG codec round-trips RGBA', () => {
    const w = 5, h = 3, px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = (i * 37) & 255;
    const back = decodePng(encodePng(w, h, px));
    assert.equal(back.w, w); assert.equal(back.h, h);
    assert.deepEqual([...back.rgba], [...px]);
  });
});

describe('board geometry', () => {
  const uv = Object.fromEntries(MATERIALS.map((m, i) => [m, [i, i, i + 1, i + 1]]));

  test('high-ground plates pick their frame piece by connectivity (texture top = far edge)', () => {
    const rows = Array(19).fill('#'.repeat(21));
    const put = (r, c, g) => { rows[r] = rows[r].slice(0, c) + g + rows[r].slice(c + 1); };
    for (const c of [3, 4, 5]) put(10, c, 'h');         // horizontal strip
    for (const r of [9, 10, 11]) put(r, 8, 'h');        // vertical strip
    put(12, 1, 'h');                                     // single
    for (let c = 0; c < 21; c++) put(11, c, rows[11][c] === '#' ? 'r' : rows[11][c]);
    const G = parseStage({ rows, tiles: {} });
    assert.equal(G[10][3].top, 'wallL'); assert.equal(G[10][4].top, 'wallM'); assert.equal(G[10][5].top, 'wallR');
    assert.equal(G[9][8].top, 'wallB'); assert.equal(G[10][8].top, 'wallVM'); assert.equal(G[11][8].top, 'wallT');
    assert.equal(G[12][1].top, 'wall');
    assert.equal(G[10][4].mat, 'wall', 'material class unchanged (sides, heights)');
    const q = buildTileQuads(G, uv).find((x) => x.row === 10 && x.col === 4 && x.order === 0);
    assert.deepEqual(q.u, uv.wallM);
  });

  test('act2 stages: every drawn wall tile resolves to a known plate material', () => {
    for (const id of ['act2autochess_m01', 'act2autochess_m02', 'act2autochess_m03', 'act2autochess_m04']) {
      const G = parseStage(stages[id]);
      for (const row of G) for (const t of row) if (t.glyph === 'h' && t.drawn) assert.ok(MATERIALS.includes(t.top), `${id} ${t.r},${t.c} ${t.top}`);
    }
  });

  test('device boxes: 4 faces (top + S/E/W), E/W carry their face x; roles map from sim device keys', () => {
    const q = boxQuads([], uv, 5, 10, 0, 0.84, 0.74, 'crateTop', 'crateSide', { row: 10, col: 5, rot: 1 });
    assert.equal(q.length, 4);
    assert.deepEqual(q.map((x) => x.faceDir), ['S', 'E', 'W', 0]);
    assert.ok(Math.abs(q[1].fx - 5.42) < 1e-9 && Math.abs(q[2].fx - 4.58) < 1e-9);
    assert.equal(q[3].rot, 1);
    assert.deepEqual(q[3].u, uv.crateTop);
    assert.ok(q.every((x) => x.kind === 'block' && x.row === 10));
    const top = q[3].pts.map((p) => p[2]);
    assert.ok(top.every((z) => Math.abs(z - 0.74) < 1e-9));
    assert.equal(deviceBoxOf('trap_1105_accrate'), DEVICE_BOX.crate);
    assert.equal(deviceBoxOf('trap_1104_aclasert'), DEVICE_BOX.turret);
    assert.equal(deviceBoxOf('trap_9999_unknown'), null);
    for (const b of Object.values(DEVICE_BOX)) assert.ok(MATERIALS.includes(b.top) && MATERIALS.includes(b.side));
  });

  test('ground plane: covers the island with baked contact shadows in [0, 1], never in a block row', () => {
    const G = parseStage(stages.act2autochess_m01, [6, 18], [6, 13]);
    const plane = buildPlaneQuads(G, 8);
    assert.ok(plane.length > 500);
    for (const q of plane) {
      assert.equal(q.kind, 'plane');
      for (const a of q.ao) assert.ok(a > 0 && a <= 1);
      assert.ok(q.pts.every((p) => p[2] < 0));
    }
    const { ground } = splitQuadGroups(plane);
    assert.equal(ground.length, plane.length);
    // darker right at the island's foot than far away
    const at = (x, y) => plane.find((q) => Math.abs(q.pts[3][0] - x) < 0.01 && Math.abs(q.pts[3][1] - y) < 0.01);
    assert.ok(at(-4.5, 12.5).ao[3] < at(-12.5, 12.5).ao[3] + 0.3);
  });
});

describe('sim fx coverage', () => {
  // every literal fx kind in the sim sources: battle.fx('kind' | b.fx('kind' | fx(battle, 'kind' | unitFx(…, 'kind'
  const kinds = new Set();
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.js')) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\b(?:battle|b|b2|this)\.fx\(\s*'([A-Za-z]+)'/g)) kinds.add(m[1]);
        for (const m of src.matchAll(/\bfx\((?:battle|b), '([A-Za-z]+)'/g)) kinds.add(m[1]);
        for (const m of src.matchAll(/[fF]x\(\s*(?:[\w.[\]]+\s*,\s*){0,2}'([A-Za-z]+)'/g)) kinds.add(m[1]);
        for (const m of src.matchAll(/\bfxOn\(\s*\w+\s*,\s*'([A-Za-z]+)'/g)) kinds.add(m[1]);
        // kinds passed as options / defaults (tokens.js burst(…, { fx: 'kind' }), `fx = 'kind'`) and ternaries
        for (const m of src.matchAll(/\bfx\s*[:=]\s*'([A-Za-z]+)'/g)) kinds.add(m[1]);
        for (const m of src.matchAll(/\.fx\(\s*[\w.!]+\s*\?\s*'([A-Za-z]+)'\s*:\s*'([A-Za-z]+)'/g)) { kinds.add(m[1]); kinds.add(m[2]); }
      }
    }
  };
  walk(path.join(ROOT, 'server/sim'));

  test('every fx kind literal in server/sim has an explicit visual', () => {
    assert.ok(kinds.size > 50, `found ${kinds.size} kinds`);
    const missing = [...kinds].filter((k) => !FX_KINDS[k]);
    assert.deepEqual(missing, [], 'add these to render/fx.js FX_KINDS');
    for (const k of ['aoe', 'zone', 'counter', 'crit', 'dp', 'heal', 'taunt', 'summon', 'pull', 'sonic', 'shield', 'overload', 'takeoff', 'sleep', 'buff', 'reveal', 'dodge', 'burst', 'displace', 'appear', 'disappear', 'substitute', 'swap', 'sandChains', 'sandChainsCharged', 'summonBurst', 'summonStun', 'radiantSword', 'paperDoll']) {
      assert.ok(kinds.has(k), `the scan finds ${k}`);
      assert.ok(FX_KINDS[k], k);
    }
  });

  test('fxSpec: unknown kinds guess or fall back to generic; junk never throws; element recolours', () => {
    assert.equal(fxSpec('weirdHealWave').a, 'heal');
    assert.equal(fxSpec('zzzz').a, 'generic');
    for (const junk of [null, undefined, 42, {}, [], '']) assert.ok(fxSpec(junk, junk).a);
    assert.notEqual(fxSpec('explode', { element: 'burn' }).c, fxSpec('explode', {}).c + 1);
    assert.equal(fxSpec('explode', { element: 'burn' }).c, 0xff7a33);
  });

  test('tilesAround: box / disc / explicit lists, bounded', () => {
    assert.equal(tilesAround(5, 10, 1.5, 'box').length, 9);
    assert.equal(tilesAround(5, 10, 1, 'disc').length, 5);
    assert.deepEqual(tilesAround(0, 0, 1, [[1, 2], ['x'], [3, 4]]), [[1, 2], [3, 4]]);
    assert.ok(tilesAround(5, 10, 99, 'box').length <= 169);
  });

  test('status icons: namespaced content keys resolve to drawn icons; unknown → none', () => {
    assert.equal(statusIconKey('ab:frost'), 'cold');
    assert.equal(statusIconKey('reed2:scorch'), 'burn');
    assert.equal(statusIconKey('skill:shotst_shred'), 'fragile');
    assert.equal(statusIconKey('lumen:resist'), 'shield');
    assert.equal(statusIconKey('stun'), 'stun');
    assert.equal(statusIconKey('talent:angel_bless_ally'), null);
    for (const junk of [null, 1, '', {}]) assert.equal(statusIconKey(junk), null);
    for (const k of ['ab:frost', 'reed2:scorch', 'sluggish', 'tremble', 'weaken']) assert.ok(STATUS_KEYS.includes(statusIconKey(k)), k);
  });
});

describe('impostor atlas allocator', () => {
  test('shelf packing, reuse of freed slots, clip pages separate, full ⇒ null', async () => {
    class Obj { constructor() { this.children = []; this.parent = null; this.visible = true; this.position = { set: (x, y) => { this.x = x; this.y = y; } }; this.scale = { set: () => {} }; }
      addChild(...cs) { for (const c of cs) { c.parent?.removeChild?.(c); c.parent = this; this.children.push(c); } return cs[0]; }
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; }
      destroy() {} }
    const rendered = [];
    globalThis.PIXI = {
      Container: Obj,
      Sprite: class extends Obj { constructor(t) { super(); this.texture = t; } },
      Texture: class { constructor(b, f) { this.baseTexture = b; this.frame = f; } destroy() {} static WHITE = {} },
      Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, width: w, height: h }); } },
      RenderTexture: { create: (o) => ({ ...o, baseTexture: { id: Math.random() }, framebuffer: { enableStencil() {} }, destroy() {} }) },
      BLEND_MODES: { ERASE: 26 },
    };
    try {
      const { ImpostorAtlas } = await import('../../public/js/render/impostor.js');
      const atlas = new ImpostorAtlas({ resolution: 1, render: (obj, o) => rendered.push(o.clear) });
      const a = atlas.alloc(100, 110);
      const b = atlas.alloc(100, 110);
      assert.ok(a && b && a.page === b.page);
      assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, 112, 112]);
      assert.deepEqual([b.x, b.y], [112, 0]);
      atlas.free(a);
      const c = atlas.alloc(90, 100);
      assert.deepEqual([c.x, c.y], [0, 0], 'freed slot reused');
      const k = atlas.alloc(100, 110, { clip: true });
      assert.ok(k.clip && k.page !== a.page && k.page.kind === 'clip');
      // queue + flush: one render per page with work, erasers hidden again, bodies parked
      const body = new Obj();
      atlas.park(body);
      atlas.draw(c, body, { a: 0.3, d: 0.3, tx: 40, ty: 90 });
      assert.equal(body.parent, c.page.bodies);
      atlas.flush();
      assert.deepEqual(rendered, [true]);
      assert.equal(body.parent, atlas.parked);
      assert.equal(body.visible, false);
      atlas.draw(c, body, { a: 0.3, d: 0.3, tx: 40, ty: 90 });
      atlas.flush();
      assert.deepEqual(rendered, [true, false], 'later passes only erase their slots');
      // fill everything: eventually null, never throws
      let n = 0;
      while (atlas.alloc(500, 500) && n < 1000) n++;
      assert.ok(n > 0 && n < 1000);
      assert.equal(atlas.alloc(4000, 10), null, 'larger than a page');
      atlas.destroy();
    } finally {
      delete globalThis.PIXI;
    }
  });

  test('zoom churn (the enemy pen camera: 50 figures grow and shrink again and again) never exhausts the atlas; freeing every slot resets the pages', async () => {
    class Obj { constructor() { this.children = []; this.parent = null; this.visible = true; this.position = { set: () => {} }; this.scale = { set: () => {} }; }
      addChild(...cs) { for (const c of cs) { c.parent?.removeChild?.(c); c.parent = this; this.children.push(c); } return cs[0]; }
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; }
      destroy() { this.parent?.removeChild(this); } }
    globalThis.PIXI = {
      Container: Obj,
      Sprite: class extends Obj { constructor(t) { super(); this.texture = t; } },
      Texture: class { constructor(b, f) { this.baseTexture = b; this.frame = f; } destroy() {} static WHITE = {} },
      Rectangle: class { constructor(x, y, w, h) { Object.assign(this, { x, y, width: w, height: h }); } },
      RenderTexture: { create: (o) => ({ ...o, baseTexture: {}, framebuffer: { enableStencil() {} }, destroy() {} }) },
      BLEND_MODES: { ERASE: 26 },
    };
    try {
      const { ImpostorAtlas } = await import('../../public/js/render/impostor.js');
      const atlas = new ImpostorAtlas({ resolution: 2, render() {} });
      // 50 figures, each re-allocating whenever its size leaves [0.6, 1] of its slot (render/units.js rule)
      const figs = Array.from({ length: 50 }, (_, i) => ({ w0: 40 + (i % 5) * 4, h0: 60 + (i % 7) * 3, slot: null }));
      let failed = 0;
      const frame = (k) => {
        for (const f of figs) {
          const w = Math.ceil(f.w0 * k), h = Math.ceil(f.h0 * k);
          const s = f.slot;
          if (!s || w > s.w || h > s.h || w < s.w * 0.6 || h < s.h * 0.6) {
            if (s) atlas.free(s);
            f.slot = atlas.alloc(w, h);
            if (!f.slot) failed++;
          }
        }
      };
      for (let cycle = 0; cycle < 8; cycle++) {
        for (let k = 1; k <= 2.2; k += 0.05) frame(k);       // pan into the pen: figures ≈ 2.2× bigger
        for (let k = 2.2; k >= 1; k -= 0.05) frame(k);       // and back
      }
      const failedChurn = failed;
      frame(1);
      assert.equal(figs.filter((f) => !f.slot).length, 0, `after 8 pen visits every prep-size figure has an atlas slot (${failedChurn} misses during the zooms)`);
      // combat start: every view is destroyed → every page empties and starts over (no stale shelves for the battle)
      for (const f of figs) { atlas.free(f.slot); f.slot = null; }
      for (const page of atlas.pages) { assert.equal(page.nextY, 0, `${page.kind} page reset`); assert.equal(page.shelves.length, 0); }
      const crowd = [];
      for (let i = 0; i < 120; i++) crowd.push(atlas.alloc(40 + (i % 6) * 5, 70 + (i % 4) * 6));
      assert.equal(crowd.filter((x) => !x).length, 0, 'a 120-unit battle crowd fits after the pen visits');
      atlas.destroy();
    } finally {
      delete globalThis.PIXI;
    }
  });
});

describe('local-art manifest helpers', () => {
  test('localAssetUrl / assets.local(): optional, never throws', async () => {
    const m = { groups: { 'map/autochess': { TX_autochessi_D: { path: '/assets/local/map/autochess/TX_autochessi_D.png', w: 2048, h: 2048 } } } };
    assert.equal(localAssetUrl(m, 'map/autochess', 'TX_autochessi_D'), '/assets/local/map/autochess/TX_autochessi_D.png');
    assert.equal(localAssetUrl(m, 'map/autochess', 'nope'), null);
    assert.equal(localAssetUrl(null, 'x', 'y'), null);
    assert.equal(localAssetUrl(m, '__proto__', 'constructor'), null);
    const ok = createAssets({ manifest: {}, fetch: async () => ({ ok: true, json: async () => m }) });
    assert.deepEqual(await ok.local(), m);
    assert.equal(ok.localUrl('map/autochess', 'TX_autochessi_D'), m.groups['map/autochess'].TX_autochessi_D.path);
    const missing = createAssets({ manifest: {}, fetch: async () => ({ ok: false, status: 404 }) });
    assert.equal(await missing.local(), null);
    assert.equal(missing.localUrl('map/autochess', 'TX_autochessi_D'), null);
    const broken = createAssets({ manifest: {}, fetch: async () => { throw new Error('offline'); } });
    assert.equal(await broken.local(), null);
  });

  test('board art loads the crop-table textures at the URLs the manifest lists (one download with the 3D board)', async () => {
    const at = (n, ext) => `/assets/local/map/autochess/${n}.${ext}`;
    const m = { groups: { 'map/autochess': { TX_autochessi_D: { path: at('TX_autochessi_D', 'webp') }, TX_autochessi_BG: { path: at('TX_autochessi_BG', 'webp') } } } };
    const asked = [];
    const store = { local: async () => m, localUrl: (g, n) => localAssetUrl(m, g, n), image: async (u) => { asked.push(u); return { width: 4 }; } };
    assert.equal(sourceUrl(store, at('TX_autochessi_D', 'png')), at('TX_autochessi_D', 'webp'));
    assert.equal(sourceUrl(store, at('TX_autochessi_common_D', 'png')), at('TX_autochessi_common_D', 'png'), 'not in the manifest: the table path');
    assert.equal(sourceUrl({}, '/x/y.png'), '/x/y.png');
    const tiles = { version: 2, materials: {}, source: { D: { path: at('TX_autochessi_D', 'png') }, common: { path: at('TX_autochessi_common_D', 'png') }, BG: { path: at('TX_autochessi_BG', 'png') } } };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => (u === '/assets/local/map/autochess/tiles.json' ? { ok: true, json: async () => tiles } : { ok: false, status: 404 });
    try {
      resetBoardArt();
      const art = await loadBoardArt(store);
      assert.ok(art?.images.D && art.images.common && art.images.BG);
      assert.deepEqual(asked.sort(), [at('TX_autochessi_BG', 'webp'), at('TX_autochessi_D', 'webp'), at('TX_autochessi_common_D', 'png')]);
    } finally {
      globalThis.fetch = realFetch;
      resetBoardArt();
    }
  });
});
