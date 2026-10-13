// test/render/board3d-scene.test.js — the official battlefield scenes (DESIGN §15): tools/local-extract/scenes.py
// (the scene table, the board-space conversion, the chunk records, the sub-graphic groups, the RGBM lightmap decode;
// run without UnityPy), fetch_scenes.py's bundle selection, the browser side (render/board3d/load.js chunk reader and
// loader with a fake store; scene.js BoardScene with a stub renderer: the scene replaces the procedural tiles and
// background, its parts follow the built areas, a missing scene keeps the procedural board), and — when scenes were
// extracted here — the files the manifest lists.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { BoardScene, sceneGroupVisible } from '../../public/js/render/board3d/scene.js';
import { AREAS } from '../../public/js/render/board3d/layout.js';
import { resolveUvTable } from '../../public/js/render/board3d/atlas.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { sceneMaterial, sceneWaterMaterial, sceneBlend, focusUniforms, SCENE_LIGHT } from '../../public/js/render/board3d/materials.js';
import {
  parseSceneChunks, sceneGroupRects, loadScenePack, sceneListed, resetBoardPack, sceneGroup, sceneMaterialKey, mergeSceneChunks,
  SCENE_TEX_GROUP, SCENE_VERSION, SCENE_VERTEX_BYTES,
} from '../../public/js/render/board3d/load.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'tools/local-extract');
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const HAS_PIL = !!PY && spawnSync(PY, ['-c', 'import PIL'], { env: ENV }).status === 0;
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));
const manifest = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'data/local-assets.json'), 'utf8')); } catch { return null; } })();

function py(code) {
  const src = `import sys, json, struct\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport scenes as s\n${code}`;
  const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** One quad as a scene chunk record + its bytes (the layout of scenes.py pack_chunk). */
function quadChunk({ x0 = 0, y0 = 0, z = 0, material = 'M', lightmap = 0, group = '' } = {}) {
  const n = 4, idx = [0, 1, 2, 0, 2, 3];
  const buf = new ArrayBuffer(n * SCENE_VERTEX_BYTES + idx.length * 2);
  new Float32Array(buf, 0, 12).set([x0, y0, z, x0 + 1, y0, z, x0 + 1, y0 + 1, z, x0, y0 + 1, z]);
  new Float32Array(buf, 48, 8).set([0, 0, 1, 0, 1, 1, 0, 1]);
  new Float32Array(buf, 80, 8).set([0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5]);
  new Int8Array(buf, 112, 16).set([0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0]);
  new Uint8Array(buf, 128, 16).fill(255);
  new Uint16Array(buf, 144, 6).set(idx);
  return { rec: { material, lightmap, group, verts: n, tris: 2, index32: false, bounds: [x0, y0, z, x0 + 1, y0 + 1, z] }, bytes: new Uint8Array(buf) };
}

/** scene.json + scene.bin of a few quads. */
function fakeScene(parts) {
  const chunks = parts.map(quadChunk);
  const total = chunks.reduce((a, c) => a + c.bytes.length, 0);
  const bin = new Uint8Array(total);
  let off = 0;
  const recs = chunks.map((c) => { bin.set(c.bytes, off); const r = { ...c.rec, offset: off }; off += c.bytes.length; return r; });
  const doc = {
    version: SCENE_VERSION, stage: 'act2autochess_m02', lightmaps: 1, lightRange: 8, binBytes: total,
    light: { dir: [0.36, 0.45, 0.82], color: [1, 0.93, 0.87], intensity: 1.1 },
    materials: {
      M: { shader: 'Torappu/Scene/StandardRealtimeShadow', keywords: [], colors: { _Color: [1, 1, 1, 1] }, floats: { _ShadowStrength: 0.9 }, textures: {}, kind: 'lit', map: 'TX_A' },
      Cut: { shader: 'Torappu/Scene/StandardRealtimeShadow', keywords: ['_ALPHATEST_ON'], colors: {}, floats: { _Cutoff: 0.4 }, textures: {}, kind: 'lit', map: 'TX_A' },
      W: { shader: 'Torappu/Scene/StylizedWater', keywords: [], colors: { _DeepWaterColor: [0, 0.27, 0.4, 0.67] }, floats: {}, textures: {}, kind: 'water' },
    },
    chunks: recs,
  };
  return { doc, bin: bin.buffer };
}

const PARTS = [
  { material: 'M', x0: 9, y0: 15 },                               // the base (pen side)
  { material: 'W', x0: 20, y0: 12, lightmap: -1 },                 // water of the base
  { material: 'M', x0: 4, y0: 9, group: 'HIDDEN@1' },              // left normal field
  { material: 'Cut', x0: 5, y0: 9, group: 'HIDDEN@1' },
  { material: 'M', x0: 16, y0: 9, group: 'HIDDEN@2' },             // right normal field
  { material: 'M', x0: 10, y0: 3, group: 'HIDDEN@3' },             // boss field
];

function fakeScenePack() {
  const { doc, bin } = fakeScene(PARTS);
  const chunks = parseSceneChunks(doc, bin);
  const img = { width: 4, height: 4 };
  return { key: 'scene-test', stage: doc.stage, doc, chunks, groups: sceneGroupRects(chunks), images: { tex: { TX_A: img }, lm: [img] } };
}

function stubRenderer() {
  const calls = [];
  return {
    calls,
    domElement: { addEventListener() {}, removeEventListener() {} },
    shadowMap: { enabled: true, needsUpdate: false },
    capabilities: { getMaxAnisotropy: () => 8 },
    info: { render: { calls: 7, triangles: 1234 }, memory: { textures: 3, geometries: 5 } },
    setClearColor() {}, setPixelRatio() {}, setSize() {}, render() {}, dispose() { calls.push(['dispose']); },
  };
}

function fakePack() {
  const img = { width: 4, height: 4 };
  return { key: 'test', images: { D: img, common: img, gate: img, BG: img }, meshes: { gate: {} }, tiles: null, uv: resolveUvTable(null), materials: {} };
}

const sceneMeshes = (board) => Object.entries(board.meshes).filter(([k, m]) => k.startsWith('scene') && m).map(([, m]) => m);

describe('scenes.py (no UnityPy needed)', { skip: !PY && 'no python3' }, () => {
  test('scene table: one prebuilt scene per battlefield of data/stages.json, with the theme bundles of its materials', () => {
    const r = spawnSync(PY, [path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const { scenes } = JSON.parse(r.stdout);
    assert.equal(scenes.sub, 'scene');
    assert.equal(scenes.tex, SCENE_TEX_GROUP);
    const ids = scenes.stages.map((x) => x.id);
    const battlefields = Object.keys(stages).filter((id) => /^act\dautochess_m\d+$/.test(id)).sort();
    assert.deepEqual([...ids].sort(), battlefields, 'every battlefield has a scene');
    for (const st of scenes.stages) {
      const season = st.id.replace(/_m\d+$/, '');
      assert.equal(st.bundle, `scenes/activities/${season}/level_${st.id}/level_${st.id}.ab`);
      assert.ok(st.deps.length > 0 && st.deps.every((d) => d.startsWith('arts/maps/') && d.endsWith('.ab')), st.id);
    }
    const sand = scenes.stages.filter((x) => x.deps.includes('arts/maps/map_autochesssand/res.ab')).map((x) => x.id);
    assert.deepEqual(sand, ['act1autochess_m01', 'act1autochess_m02', 'act1autochess_m03', 'act1autochess_m04', 'act1autochess_m05',
      'act1autochess_m06', 'act1autochess_m07', 'act2autochess_m02', 'act2autochess_m04'], 'the sand-theme battlefields (official asset index)');
    assert.ok(!scenes.stages.some((x) => x.deps.includes('arts/maps/map_autochess/res.ab')), 'no battlefield uses the metal theme');
  });

  test('--only scene / scene/<id> selects scenes; a client without scene bundles skips them', () => {
    const out = py(`import extract as e
print(json.dumps({'all': len(e.scene_ids([])), 'scene': len(e.scene_ids(['scene'])), 'one': e.scene_ids(['scene/act2autochess_m02']),
  'other': e.scene_ids(['emoticon']), 'missing': s.find_scene('act2autochess_m02', ['/no/such/root']) is None}))`);
    assert.deepEqual(out, { all: 11, scene: 11, one: ['act2autochess_m02'], other: [], missing: true });
  });

  test('board space: Unity anchor-local (x, y, −z); transforms compose; a mirrored transform has a negative determinant', () => {
    const out = py(`m = s.mul(s.trs((1, 2, 3), (0, 0, 0, 1), (2, 2, 2)), s.trs((1, 0, 0), (0, 0, 0, 1), (1, 1, 1)))
rot = s.trs((0, 0, 0), (0, 0, 0.7071068, 0.7071068), (1, 1, 1))
print(json.dumps({'board': s.to_board((-6.0, -4.0, -0.4), (-10.0, -9.0, 0.0)), 'm': [m[0][3], m[1][3], m[2][3], m[0][0]],
  'rot': [round(rot[0][1], 4), round(rot[1][0], 4)], 'det': [s.det3(s.IDENTITY), s.det3(s.trs((0, 0, 0), (0, 0, 0, 1), (1, 1, -1)))]}))`);
    assert.deepEqual(out.board, [4, 5, 0.4], 'tile (row 5, col 4) on high ground');
    assert.deepEqual(out.m, [3, 2, 3, 2]);
    assert.deepEqual(out.rot, [-1, 1], 'a quarter turn about z');
    assert.deepEqual(out.det, [1, -1]);
  });

  test('pack_chunk: 36 bytes per vertex + 16-bit indices padded to 4 bytes (what load.js parseSceneChunks reads)', () => {
    const out = py(`ch = {'pos': [(0, 0, 0), (1, 0, 0), (0, 1, 0.5)], 'uv': [(0, 0), (1, 0), (0, 1)], 'uv1': [(0.1, 0.2), (0.3, 0.2), (0.1, 0.4)],
  'nrm': [(0, 0, 1)] * 3, 'col': [(1, 0.5, 0, 1)] * 3, 'idx': [0, 1, 2]}
data, idx32 = s.pack_chunk(ch)
print(json.dumps({'len': len(data), 'idx32': idx32, 'hex': data.hex()}))`);
    assert.equal(out.idx32, false);
    assert.equal(out.len, 3 * SCENE_VERTEX_BYTES + 8, '3 vertices, 3 indices (6 bytes) padded to 8');
    const bin = Uint8Array.from(Buffer.from(out.hex, 'hex')).buffer;
    const [c] = parseSceneChunks({ chunks: [{ material: 'M', lightmap: 0, group: '', verts: 3, tris: 1, offset: 0, index32: false, bounds: [0, 0, 0, 1, 1, 0.5] }] }, bin);
    assert.deepEqual([...c.position], [0, 0, 0, 1, 0, 0, 0, 1, 0.5]);
    assert.deepEqual([...c.uv1].map((v) => Math.round(v * 10) / 10), [0.1, 0.2, 0.3, 0.2, 0.1, 0.4]);
    assert.deepEqual([...c.normal.slice(0, 4)], [0, 0, 127, 0]);
    assert.deepEqual([...c.color.slice(0, 4)], [255, 128, 0, 255]);
    assert.deepEqual([...c.index], [0, 1, 2]);
  });

  test('hidden_groups: the objects listed after each sub-graphic name of a MapSubGraphicHolder', () => {
    const out = py(`def name(t):
    b = t.encode(); return struct.pack('<i', len(b)) + b + b'\\0' * (-len(b) % 4)
ptr = lambda pid: struct.pack('<iq', 0, pid)
raw = struct.pack('<i', 2) + name('HIDDEN@1') + struct.pack('<ii', 1, 2) + ptr(11) + ptr(12) + struct.pack('<i', 1) + ptr(21) + struct.pack('<i', 0) \\
    + name('HIDDEN@2') + struct.pack('<ii', 1, 1) + ptr(13) + struct.pack('<i', 0) + ptr(99)
objs = {11: 1, 12: 1, 13: 1, 21: 1}
print(json.dumps({str(k): v for k, v in s.hidden_groups(raw, objs).items()}))`);
    assert.deepEqual(out, { 11: 'HIDDEN@1', 12: 'HIDDEN@1', 21: 'HIDDEN@1', 13: 'HIDDEN@2' }, 'pointers to objects of the file; an unknown id is no pointer');
  });

  test('decode_rgbm: the RGBM light as (L / LIGHT_RANGE)^(1/2.2); a page without alpha is kept', { skip: !HAS_PIL && 'no Pillow' }, () => {
    const out = py(`from PIL import Image
img = Image.new('RGBA', (2, 1)); img.putdata([(255, 128, 0, 51), (255, 255, 255, 255)])
d = s.decode_rgbm(img)
print(json.dumps({'mode': d.mode, 'px': list(d.getdata()), 'range': s.LIGHT_RANGE, 'plain': s.decode_rgbm(Image.new('RGB', (1, 1), (9, 8, 7))).getpixel((0, 0))}))`);
    assert.equal(out.mode, 'RGB');
    // texel (1, 0.5, 0, A = 0.2): L = 5^2.2 · 0.2^2.2 · rgb → stored (L / range)^(1/2.2) = (5^2.2 / range)^(1/2.2) · 0.2 · rgb^(1/2.2)
    const k = (5 ** 2.2 / out.range) ** (1 / 2.2);
    const want = [1, 128 / 255, 0].map((c) => Math.round(255 * Math.min(1, k * 0.2) * c ** (1 / 2.2)));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(out.px[0][i] - want[i]) <= 2, `channel ${i}: ${out.px[0][i]} vs ${want[i]}`);
    assert.deepEqual(out.px[1], [255, 255, 255], 'clamped at the range');
    assert.deepEqual(out.plain, [9, 8, 7]);
  });

  test('fetch_scenes.py: CDN file names and the bundles of the scene table', () => {
    const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport fetch_scenes as f\nnames = ['arts/maps/map_autochess/res.ab', 'scenes/activities/act2autochess/level_act2autochess_m02/level_act2autochess_m02.ab', 'scenes/activities/act2autochess/level_act2autochess_m02/level_act2autochess_m02/lightingdata.ab', 'scenes/activities/act44side/level_act44side_01/level_act44side_01.ab']\nprint(json.dumps({'dat': f.dat_name('scenes/a/level_x/level_x.ab'), 'hash': f.dat_name('avg/a#1.ab'), 'wanted': f.wanted(names, ['act2autochess_m02'])}))`;
    const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.dat, 'scenes_a_level_x_level_x.dat');
    assert.equal(out.hash, 'avg_a__1.dat');
    assert.equal(out.wanted.length, 2, 'the scene and its lighting data, nothing else');
  });
});

describe('scene chunks (load.js)', () => {
  test('parseSceneChunks: typed-array views per chunk; a record that does not fit the buffer rejects the scene', () => {
    const { doc, bin } = fakeScene(PARTS);
    const chunks = parseSceneChunks(doc, bin);
    assert.equal(chunks.length, PARTS.length);
    assert.equal(chunks[0].position.length, 12);
    assert.deepEqual([...chunks[2].position.slice(0, 3)], [4, 9, 0]);
    assert.deepEqual([...chunks[0].index], [0, 1, 2, 0, 2, 3]);
    assert.equal(chunks[1].lightmap, -1);
    assert.equal(parseSceneChunks(doc, bin.slice(0, bin.byteLength - 4)), null, 'truncated bin');
    assert.equal(parseSceneChunks({ chunks: [{ ...doc.chunks[0], offset: 2 }] }, bin), null, 'unaligned offset');
    assert.equal(parseSceneChunks({ chunks: [{ ...doc.chunks[0], verts: 0 }] }, bin), null);
    assert.equal(parseSceneChunks(null, bin), null);
    assert.equal(parseSceneChunks(doc, null), null);
  });

  test('sceneMaterialKey / mergeSceneChunks: one mesh per material and lightmap page; indices keep each quad', () => {
    assert.equal(sceneMaterialKey({ material: 'M', lightmap: 3 }, { kind: 'lit' }), 'M|3');
    assert.equal(sceneMaterialKey({ material: 'M', lightmap: 0 }, null), 'M|0');
    assert.equal(sceneMaterialKey({ material: 'W', lightmap: -1 }, { kind: 'water' }), 'W|');
    assert.equal(sceneMaterialKey({ material: 'W', lightmap: 2 }, { kind: 'water' }), 'W|', 'water has no lightmap page');
    const { doc, bin } = fakeScene([{ material: 'M', x0: 0, y0: 0 }, { material: 'M', x0: 3, y0: 1, group: 'HIDDEN@1' }]);
    const chunks = parseSceneChunks(doc, bin);
    assert.equal(mergeSceneChunks([chunks[0]]), chunks[0], 'a single chunk stays the scene.bin view');
    assert.equal(mergeSceneChunks([]), null);
    assert.equal(mergeSceneChunks(null), null);
    const merged = mergeSceneChunks(chunks);
    assert.equal(merged.position.length / 3, 8);
    assert.ok(merged.index instanceof Uint16Array);
    assert.deepEqual([...merged.index], [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    assert.equal(merged.position[12], 3, 'the second quad keeps its board position');
    assert.equal(merged.normal[18], 127);
    assert.deepEqual([...merged.color.slice(16, 20)], [255, 255, 255, 255]);
    assert.deepEqual([...merged.uv1.slice(8, 12)], [0, 0, 0.5, 0]);
    assert.deepEqual([...chunks[1].index], [0, 1, 2, 0, 2, 3], 'the source chunk is not rewritten');
    assert.deepEqual(merged.bounds, [0, 0, 0, 4, 2, 0]);
    const big = new Float32Array(65535 * 3);
    const one = {
      material: 'M', lightmap: 0, group: '', bounds: null,
      position: big, uv: new Float32Array(65535 * 2), uv1: new Float32Array(65535 * 2),
      normal: new Int8Array(65535 * 4), color: new Uint8Array(65535 * 4), index: new Uint16Array([0, 0, 0]),
    };
    const extra = {
      material: 'M', lightmap: 0, group: 'HIDDEN@1', bounds: null,
      position: new Float32Array([9, 8, 7]), uv: new Float32Array(2), uv1: new Float32Array(2),
      normal: new Int8Array(4), color: new Uint8Array(4), index: new Uint16Array([0, 0, 0]),
    };
    const wide = mergeSceneChunks([one, extra]);
    assert.ok(wide.index instanceof Uint32Array, 'past 65535 vertices the index is 32-bit');
    assert.equal(wide.position.length / 3, 65536);
    assert.equal(wide.index[3], 65535);
    assert.equal(wide.position[65535 * 3], 9);
    assert.throws(() => mergeSceneChunks([{ ...chunks[0], material: 'Other' }, chunks[1]]), /mixes/);
  });

  test('sceneGroupRects / sceneGroupVisible: the official sub-graphics are the fields of the built areas', () => {
    const { doc, bin } = fakeScene(PARTS);
    const rects = sceneGroupRects(parseSceneChunks(doc, bin));
    assert.deepEqual(Object.keys(rects).sort(), ['HIDDEN@1', 'HIDDEN@2', 'HIDDEN@3']);
    assert.deepEqual(rects['HIDDEN@1'], [4, 9, 6, 10], 'union of the group\'s chunks');
    const shown = (areas) => Object.keys(rects).filter((g) => sceneGroupVisible(rects[g], areas)).sort();
    assert.deepEqual(shown(AREAS.normal), ['HIDDEN@1'], 'own field');
    assert.deepEqual(shown(AREAS.unite), ['HIDDEN@1', 'HIDDEN@2'], 'both normal fields');
    assert.deepEqual(shown(AREAS.boss), ['HIDDEN@3'], 'the boss field');
    assert.deepEqual(shown(AREAS.all), ['HIDDEN@1', 'HIDDEN@2', 'HIDDEN@3']);
    assert.equal(sceneGroupVisible(null, AREAS.normal), true, 'a part without bounds is shown');
  });

  test('loadScenePack: scene.json + scene.bin + lightmap pages + textures through the store; null when not listed or malformed', async () => {
    resetBoardPack();
    const { doc, bin } = fakeScene(PARTS);
    const group = sceneGroup('act2autochess_m02');
    const urls = { [`${group}|scene`]: '/s/scene.json', [`${group}|bin`]: '/s/scene.bin', [`${group}|lm0`]: '/s/lm0.webp', [`${SCENE_TEX_GROUP}|TX_A`]: '/t/TX_A.webp' };
    const seen = [];
    const store = { local: async () => ({ groups: {} }), localUrl: (g, n) => urls[`${g}|${n}`] || null, image: async (u) => { seen.push(u); return { width: 8, height: 8 }; } };
    const original = globalThis.fetch;
    let json = doc;
    globalThis.fetch = async (u) => (u === '/s/scene.json' ? { ok: true, json: async () => json } : u === '/s/scene.bin' ? { ok: true, arrayBuffer: async () => bin } : { ok: false });
    try {
      assert.equal(await sceneListed(store, 'act2autochess_m02'), true);
      assert.equal(await sceneListed(store, 'act2autochess_m01'), false);
      assert.equal(await loadScenePack(store, 'act2autochess_m01'), null, 'not extracted');
      const pack = await loadScenePack(store, 'act2autochess_m02');
      assert.equal(pack.chunks.length, PARTS.length);
      assert.deepEqual(seen.sort(), ['/s/lm0.webp', '/t/TX_A.webp']);
      assert.ok(pack.images.tex.TX_A && pack.images.lm[0]);
      assert.deepEqual(Object.keys(pack.groups).sort(), ['HIDDEN@1', 'HIDDEN@2', 'HIDDEN@3']);
      assert.equal(await loadScenePack(store, 'act2autochess_m02'), pack, 'cached');
      resetBoardPack();
      json = { ...doc, version: SCENE_VERSION + 1 };
      assert.equal(await loadScenePack(store, 'act2autochess_m02'), null, 'unknown version → the procedural board');
      json = doc;
      assert.ok(await loadScenePack(store, 'act2autochess_m02'), 'a failed load is not cached');
      assert.equal(await loadScenePack(null, 'act2autochess_m02').catch(() => 'threw'), await loadScenePack(store, 'act2autochess_m02'), 'cached per stage');
    } finally { globalThis.fetch = original; resetBoardPack(); }
  });
});

describe('scene materials', () => {
  test('sceneBlend: alpha test / blend by the Unity keywords', () => {
    assert.equal(sceneBlend({ keywords: ['_NORMALMAP'] }), 'opaque');
    assert.equal(sceneBlend({ keywords: ['_ALPHATEST_ON'] }), 'cutout');
    assert.equal(sceneBlend({ keywords: ['_ALPHABLEND_ON', '_EMISSION'] }), 'blend');
    assert.equal(sceneBlend(null), 'opaque');
  });

  test('sceneMaterial: linear albedo tint, lightmap range, key light, cutoff; unlit fallback without a lightmap page', () => {
    const focus = focusUniforms(THREE);
    const map = new THREE.Texture(), lm = new THREE.Texture();
    const info = { keywords: ['_ALPHATEST_ON'], colors: { _Color: [0.5, 1, 1, 1] }, floats: { _Cutoff: 0.4, _ShadowStrength: 0.9 } };
    const m = sceneMaterial(THREE, { map, lightMap: lm, info, lightRange: 8, light: { dir: [0, 0, 2], color: [1, 1, 1], intensity: 1.1 } }, focus);
    assert.equal(m.uniforms.uMap.value, map);
    assert.equal(m.uniforms.uLm.value, lm);
    assert.ok(Math.abs(m.uniforms.uColor.value.x - 0.5 ** 2.2) < 1e-6, 'authored in gamma space');
    assert.equal(m.uniforms.uCutoff.value, 0.4);
    assert.equal(m.uniforms.uShadow.value, 0.9);
    assert.equal(m.uniforms.uLmScale.value, 8 * SCENE_LIGHT.indirect);
    assert.deepEqual(m.uniforms.uLightDir.value.toArray(), [0, 0, 1], 'normalised');
    assert.ok(Math.abs(m.uniforms.uLightColor.value.x - 1.1 * SCENE_LIGHT.direct) < 1e-6);
    assert.equal(m.uniforms.uFocus, focus.uFocus, 'the shared focus falloff');
    assert.equal(m.transparent, false);
    assert.ok(m.defines.SCENE_MAP && m.defines.SCENE_LM);
    const bare = sceneMaterial(THREE, { info: { keywords: ['_ALPHABLEND_ON'] } }, focus);
    assert.equal(bare.uniforms.uLmScale.value, 0);
    assert.equal(bare.uniforms.uAmbient.value, SCENE_LIGHT.ambient);
    assert.equal(bare.uniforms.uCutoff.value, 0);
    assert.equal(bare.transparent, true);
    assert.equal(bare.depthWrite, false);
    assert.ok(!bare.defines.SCENE_MAP && !bare.defines.SCENE_LM);
    const w = sceneWaterMaterial(THREE, {}, focus, { colors: { _DeepWaterColor: [0, 0.27, 0.4, 0.67] } });
    assert.deepEqual(w.uniforms.uDeep.value.toArray(), [0, 0.27, 0.4, 0.67]);
    assert.equal(w.transparent, true);
    assert.ok(!w.defines.WATER_MAPS, 'no water maps: a flat tint');
  });
});

describe('BoardScene with an official scene (stub renderer)', () => {
  const stage = stages.act2autochess_m02;

  test('the scene replaces the procedural tiles and background; devices, gates, edges and terrain stay', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board.setStage(stage);
    assert.ok(board.meshes.board && board.meshes.bg, 'procedural board first');
    assert.equal(board.official, null);
    assert.equal(board.setScenePack(stage.id, fakeScenePack()), true);
    assert.ok(board.official, 'official scene on');
    assert.ok(!board.meshes.board && !board.meshes.glass && !board.meshes.decal && !board.meshes.pipe && !board.meshes.bg && !board.meshes.bgShadow);
    assert.ok(board.meshes.crates && board.meshes.edges && board.meshes.mire, Object.keys(board.meshes).join());
    const meshes = sceneMeshes(board);
    assert.equal(meshes.length, 3, 'base + the left field: the two M quads share one mesh');
    assert.deepEqual(meshes.map((m) => m.geometry.getAttribute('position').count).sort((a, b) => a - b), [4, 4, 8]);
    const xs = meshes.flatMap((m) => {
      const a = m.geometry.getAttribute('position').array;
      const out = [];
      for (let i = 0; i < a.length; i += 3) out.push(a[i]);
      return out;
    });
    assert.ok(xs.includes(9) && xs.includes(4), 'base and the left field');
    assert.ok(!xs.includes(16) && !xs.includes(11), 'the right field and the boss field stay out');
    for (const m of meshes) {
      assert.ok(m.geometry.getAttribute('aLm') && m.geometry.getAttribute('aColor').normalized && m.geometry.getAttribute('normal').normalized);
      assert.equal(m.castShadow, false);
    }
    const water = meshes.find((m) => m.material.uniforms.uDeep);
    assert.ok(water && water.material.transparent);
    board.resize(1280, 720, 1);
    board.render(presetCamera('normal', { width: 1280, height: 720 }), 2.5);
    assert.equal(water.material.uniforms.uTime.value, 2.5, 'water animates');
    board.destroy();
  });

  test('the scene\'s fields follow the built areas; materials and textures are reused across rebuilds', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    const pack = fakeScenePack();
    board.setScenePack(stage.id, pack);
    board.setStage(stage);
    const lit = sceneMeshes(board).find((m) => m.material.uniforms.uMap).material;
    assert.equal(lit.uniforms.uMap.value.colorSpace, THREE.SRGBColorSpace);
    assert.equal(lit.uniforms.uLm.value.colorSpace, THREE.NoColorSpace);
    board.setArea(AREAS.boss);
    assert.equal(sceneMeshes(board).length, 2, 'base + the boss field, the two M quads merged');
    board.setArea(AREAS.unite);
    assert.equal(sceneMeshes(board).length, 3, 'base + both normal fields: M merged, water, cutout');
    assert.equal(sceneMeshes(board).find((m) => m.material.uniforms.uMap).material, lit, 'same material object');
    assert.equal(board.sceneRes.size, 1);
    board.destroy();
    assert.equal(board.sceneRes.size, 0, 'scene resources disposed');
  });

  test('#569: the device slabs stay drawn on an official scene (the procedural board is gone); a stage without slabs adds nothing', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    const m03 = stages.act1autochess_m03;
    board.setScenePack(m03.id, fakeScenePack());
    board.setStage(m03);
    assert.ok(board.official && !board.meshes.board, 'the scene replaces the board');
    assert.ok(board.meshes.raised, 'the 射击台 slabs beside the blue gate stay');
    assert.equal(board.meshes.raised.geometry.getAttribute('position').count, board.board.buckets.raised.vertexCount);
    assert.equal(board.meshes.raised.material, board.mat.board, 'drawn like the procedural board');
    assert.equal(board.setScenePack(m03.id, null), true);
    assert.ok(board.meshes.board && !board.meshes.raised, 'without the scene the board draws them itself');
    board.setScenePack(stage.id, fakeScenePack());
    board.setStage(stage);
    assert.ok(board.official && !board.meshes.raised && !board.meshes.raisedDecal, `${stage.id}: no slab devices`);
    board.destroy();
  });

  test('another stage, or dropping the scene, shows the procedural board again', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board.setScenePack(stage.id, fakeScenePack());
    board.setStage(stages.act2autochess_m01);
    assert.equal(board.official, null);
    assert.ok(board.meshes.board && board.meshes.bg && !sceneMeshes(board).length, 'a stage without a scene');
    board.setStage(stage);
    assert.ok(board.official && !board.meshes.board);
    assert.equal(board.setScenePack(stage.id, null), true);
    assert.equal(board.official, null);
    assert.ok(board.meshes.board && board.meshes.bg && !sceneMeshes(board).length);
    assert.equal(board.setScenePack(stage.id, null), false, 'nothing to drop');
    assert.equal(board.setScenePack('', fakeScenePack()), false);
    board.destroy();
  });

  test('a different lightmap page stays its own mesh; water pages share one', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    const parts = [
      { material: 'M', x0: 4, y0: 9, lightmap: 0, group: 'HIDDEN@1' },
      { material: 'M', x0: 9, y0: 15, lightmap: 1 },
      { material: 'W', x0: 5, y0: 9, lightmap: 0, group: 'HIDDEN@1' },
      { material: 'W', x0: 6, y0: 9, lightmap: 1, group: 'HIDDEN@1' },
    ];
    const { doc, bin } = fakeScene(parts);
    const chunks = parseSceneChunks(doc, bin);
    board.setScenePack(stage.id, { key: 'split', stage: stage.id, doc, chunks, groups: sceneGroupRects(chunks), images: { tex: {}, lm: [] } });
    board.setStage(stage);
    const meshes = sceneMeshes(board);
    assert.equal(meshes.length, 3, 'M|0, M|1, and one water mesh');
    const water = meshes.filter((m) => m.material.uniforms.uDeep);
    assert.equal(water.length, 1);
    assert.equal(water[0].geometry.getAttribute('position').count, 8, 'both water quads');
    assert.equal(board.sceneWater.length, 1);
    board.destroy();
  });

  test('a scene whose chunks are all hidden parts of other areas keeps the procedural board', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    const { doc, bin } = fakeScene([{ material: 'M', x0: 10, y0: 3, group: 'HIDDEN@3' }]);
    const chunks = parseSceneChunks(doc, bin);
    board.setScenePack(stage.id, { key: 'k2', stage: stage.id, doc, chunks, groups: sceneGroupRects(chunks), images: { tex: {}, lm: [] } });
    board.setStage(stage);
    assert.equal(board.official, null);
    assert.ok(board.meshes.board && board.meshes.bg);
    board.destroy();
  });
});

describe('extracted scenes (when scene bundles were extracted here)', { skip: !Object.keys(manifest?.groups || {}).some((g) => g.startsWith('scene/act')) && 'no scene in data/local-assets.json' }, () => {
  const groups = manifest?.groups || {};
  const file = (p) => path.join(ROOT, 'public', p.replace(/^\//, ''));

  for (const g of Object.keys(groups).filter((k) => k.startsWith('scene/act'))) {
    test(`${g}: scene.json records fit scene.bin; lightmap pages and textures are listed and on disk`, { skip: !existsSync(file(groups[g].scene?.path || '/x')) && 'files not on this machine' }, () => {
      const doc = JSON.parse(readFileSync(file(groups[g].scene.path), 'utf8'));
      const bin = readFileSync(file(groups[g].bin.path));
      assert.equal(doc.version, SCENE_VERSION);
      assert.equal(`scene/${doc.stage}`, g);
      assert.equal(doc.binBytes, bin.length);
      const chunks = parseSceneChunks(doc, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
      assert.ok(chunks && chunks.length === doc.chunks.length && chunks.length > 0);
      assert.ok(chunks.some((c) => !c.group), 'a base part');
      for (const c of chunks) {
        let max = 0;
        for (const i of c.index) if (i > max) max = i;
        assert.ok(max < c.position.length / 3, 'indices in range');
        assert.ok(doc.materials[c.material], `material ${c.material}`);
        if (c.lightmap >= 0) assert.ok(c.lightmap < doc.lightmaps && groups[g][`lm${c.lightmap}`], `lightmap page ${c.lightmap}`);
      }
      for (const m of Object.values(doc.materials)) if (m.map) assert.ok(groups[SCENE_TEX_GROUP]?.[m.map], `texture ${m.map}`);
      const L = doc.light;
      assert.ok(L && Math.abs(Math.hypot(...L.dir) - 1) < 1e-3 && L.dir[2] > 0, 'the key light shines down on the board');
    });
  }

  test('each built area is one mesh per material and lightmap, with every shown vertex and no switched-off part', () => {
    const views = [['normal', AREAS.normal], ['boss', AREAS.boss], ['unite', AREAS.unite]];
    for (const g of Object.keys(groups).filter((k) => k.startsWith('scene/act'))) {
      if (!existsSync(file(groups[g].scene?.path || '/x'))) continue;
      const doc = JSON.parse(readFileSync(file(groups[g].scene.path), 'utf8'));
      const bin = readFileSync(file(groups[g].bin.path));
      const chunks = parseSceneChunks(doc, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
      const rects = sceneGroupRects(chunks);
      const stage = stages[doc.stage];
      const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
      board.setScenePack(doc.stage, { key: g, stage: doc.stage, doc, chunks, groups: rects, images: { tex: {}, lm: [] } });
      board.setStage(stage);
      for (const [name, area] of views) {
        board.setArea(area);
        const shown = chunks.filter((c) => !c.group || sceneGroupVisible(rects[c.group], area));
        const keys = new Set(shown.map((c) => sceneMaterialKey(c, doc.materials[c.material])));
        const meshes = sceneMeshes(board);
        assert.equal(meshes.length, keys.size, `${doc.stage} ${name}: ${shown.length} chunks → ${keys.size} meshes`);
        assert.ok(meshes.length > 0 && meshes.length <= 16, `${doc.stage} ${name}: ${meshes.length} scene draw calls`);
        let verts = 0;
        for (const m of meshes) verts += m.geometry.getAttribute('position').count;
        assert.equal(verts, shown.reduce((a, c) => a + c.position.length / 3, 0), `${doc.stage} ${name} vertices`);
        if (name !== 'unite') assert.ok(board.root.children.length <= 19, `${doc.stage} ${name}: ${board.root.children.length} meshes beside one battle device still fit 20 draws`);
      }
      assert.equal(board.meshes.board, undefined, `${doc.stage}: the scene replaces the metal tiles`);
      board.setScenePack(doc.stage, null);
      assert.ok(board.meshes.board && board.meshes.bg, `${doc.stage}: dropping the scene restores the metal board`);
      board.destroy();
    }
  });
});
