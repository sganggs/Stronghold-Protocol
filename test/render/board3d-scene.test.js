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
import { BoardScene, sceneGroupVisible, LIGHTING } from '../../public/js/render/board3d/scene.js';
import { parseObj } from '../../public/js/render/board3d/obj.js';
import { TILE_H } from '../../public/js/render/style.js';
import { AREAS } from '../../public/js/render/board3d/layout.js';
import { resolveUvTable } from '../../public/js/render/board3d/atlas.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { sceneMaterial, sceneWaterMaterial, sceneBlend, sceneEnvTexture, focusUniforms, SCENE_LIGHT, waterMaterial, applyWaterMaterial, WATER_DEFAULTS, SCENE_WATER_DEFAULTS, WATER_TUNING, boardMaterial, glassMaterial, trapMaterial } from '../../public/js/render/board3d/materials.js';
import {
  parseSceneChunks, sceneGroupRects, loadScenePack, sceneListed, resetBoardPack, sceneGroup, sceneMaterialKey, mergeSceneChunks,
  SCENE_TEX_GROUP, SCENE_VERSION, SCENE_VERTEX_BYTES, isSceneWater, sceneWaterInfo,
} from '../../public/js/render/board3d/load.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'tools/local-extract');
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const HAS_PIL = !!PY && spawnSync(PY, ['-I', '-B', '-c', 'import PIL'], { env: ENV }).status === 0;
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));
const manifest = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'data/local-assets.json'), 'utf8')); } catch { return null; } })();

function py(code) {
  const src = `import sys, json, struct\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport scenes as s\n${code}`;
  const r = spawnSync(PY, ['-I', '-B', '-c', src], { encoding: 'utf8', env: ENV });
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
    const r = spawnSync(PY, ['-I', '-B', path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const { scenes } = JSON.parse(r.stdout);
    assert.equal(scenes.sub, 'scene');
    assert.equal(scenes.tex, SCENE_TEX_GROUP);
    assert.equal(scenes.version, 4, 'manifest scene-record version; scene.json stays SCENE_VERSION');
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

  test('decode_rgbm: the RGBM light in display space as 5 · A · RGB / LIGHT_RANGE; a page without alpha is kept', { skip: !HAS_PIL && 'no Pillow' }, () => {
    const out = py(`from PIL import Image
img = Image.new('RGBA', (3, 1)); img.putdata([(255, 128, 0, 51), (255, 255, 255, 255), (40, 20, 10, 255)])
d = s.decode_rgbm(img)
print(json.dumps({'mode': d.mode, 'px': list(d.getdata()), 'range': s.LIGHT_RANGE, 'encoding': s.LIGHT_ENCODING, 'plain': s.decode_rgbm(Image.new('RGB', (1, 1), (9, 8, 7))).getpixel((0, 0))}))`);
    assert.equal(out.mode, 'RGB');
    assert.equal(out.encoding, 'gamma');
    // texel (1, 0.5, 0, A = 0.2): Unity's gamma-space RGBM value 5 · 0.2 · rgb, stored / range
    const want = (px, a) => px.map((c) => Math.min(255, Math.round(255 * 5 * a * (c / 255) / out.range)));
    assert.deepEqual(out.px[0], want([255, 128, 0], 0.2));
    assert.deepEqual(out.px[1], [255, 255, 255], 'clamped at the range');
    assert.deepEqual(out.px[2], want([40, 20, 10], 1), 'a bright multiplier does not clamp a dark colour');
    assert.deepEqual(out.plain, [9, 8, 7]);
  });

  test('fetch_scenes.py: CDN file names and the bundles of the scene table', () => {
    const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport fetch_scenes as f\nnames = ['arts/maps/map_autochess/res.ab', 'scenes/activities/act2autochess/level_act2autochess_m02/level_act2autochess_m02.ab', 'scenes/activities/act2autochess/level_act2autochess_m02/level_act2autochess_m02/lightingdata.ab', 'scenes/activities/act44side/level_act44side_01/level_act44side_01.ab']\nprint(json.dumps({'dat': f.dat_name('scenes/a/level_x/level_x.ab'), 'hash': f.dat_name('avg/a#1.ab'), 'wanted': f.wanted(names, ['act2autochess_m02'])}))`;
    const r = spawnSync(PY, ['-I', '-B', '-c', src], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.dat, 'scenes_a_level_x_level_x.dat');
    assert.equal(out.hash, 'avg_a__1.dat');
    assert.equal(out.wanted.length, 2, 'the scene and its lighting data, nothing else');
  });

  test('data maps are lossless WebP; emission is exported only with _EMISSION', { skip: !HAS_PIL && 'no Pillow' }, () => {
    const out = py(`import tempfile, os
from PIL import Image
try:
    from PIL import features
    webp = bool(features.check('webp'))
except Exception:
    webp = False
def keys(kind, kw):
    return [k for _s, k in s.map_exports(kind, kw)]
img = Image.new('RGBA', (2, 2))
img.putdata([(10, 20, 30, 255), (40, 50, 60, 255), (70, 80, 90, 128), (200, 10, 240, 0)])
with tempfile.TemporaryDirectory() as d:
    lossless = s.save_image(img, d, 'n', 'scene/tex', True)
    lossy = s.save_image(img, d, 'a', 'scene/tex', False)
    match = None
    if webp and lossless.get('webp') == 'lossless':
        match = list(Image.open(os.path.join(d, 'n.webp')).convert('RGBA').getdata()) == list(img.getdata())
print(json.dumps({
  'ver': s.SCENE_EXTRACT_VERSION, 'mesh': s.SCENE_VERSION, 'webp': webp,
  'metro': keys('lit', ['HG_LIGHTMAP', '_EMISSION', '_METALLICGLOSSMAP', '_NORMALMAP']),
  'floor': keys('lit', ['HG_LIGHTMAP', '_METALLICGLOSSMAP', '_NORMALMAP']),
  'cut': keys('lit', ['HG_LIGHTMAP', '_ALPHATEST_ON', '_EMISSION', '_METALLICGLOSSMAP']),
  'water': keys('water', ['HG_LIGHTMAP', '_EMISSION', '_METALLICGLOSSMAP', '_NORMALMAP']),
  'lossless': lossless.get('webp'), 'lossy': lossy.get('webp'), 'match': match,
}))`);
    assert.equal(out.mesh, SCENE_VERSION);
    assert.equal(out.ver, 4);
    assert.deepEqual(out.metro, ['map', 'normalMap', 'glossMap', 'emissionMap']);
    assert.deepEqual(out.floor, ['map', 'normalMap', 'glossMap']);
    assert.deepEqual(out.cut, ['map', 'normalMap', 'glossMap', 'emissionMap']);
    assert.deepEqual(out.water, ['map']);
    if (out.webp) {
      assert.equal(out.lossless, 'lossless');
      assert.equal(out.lossy, 'lossy');
      assert.equal(out.match, true, 'lossless WebP keeps each texel, including chroma');
    } else {
      assert.equal(out.lossless, null);
      assert.equal(out.lossy, null);
    }
  });

  test('an emission map round-trips a saturated texel exactly', { skip: !HAS_PIL && 'no Pillow' }, () => {
    const out = py(`import tempfile, os
from PIL import Image
try:
    from PIL import features
    webp = bool(features.check('webp'))
except Exception:
    webp = False
# The three measured lights, plus a neighbour so 4:2:0 has something to average.
px = [(173, 165, 12, 255), (231, 49, 49, 255), (255, 135, 2, 255), (12, 40, 220, 255)]
img = Image.new('RGBA', (2, 2))
img.putdata(px)
lossless = 'emissionMap' in s.LOSSLESS_MAPS
with tempfile.TemporaryDirectory() as d:
    entry = s.save_image(img, d, 'E', 'scene/tex', lossless)
    got = None
    lossy = None
    if webp and entry.get('webp'):
        got = list(Image.open(os.path.join(d, 'E.webp')).convert('RGBA').getdata())
        bad = s.save_image(img, d, 'L', 'scene/tex', False)
        if bad.get('webp') == 'lossy':
            lossy = list(Image.open(os.path.join(d, 'L.webp')).convert('RGBA').getdata())
print(json.dumps({
  'webp': webp,
  'inSet': 'emissionMap' in s.LOSSLESS_MAPS and 'normalMap' in s.LOSSLESS_MAPS and 'glossMap' in s.LOSSLESS_MAPS,
  'mapLossy': 'map' not in s.LOSSLESS_MAPS,
  'mode': entry.get('webp'),
  'match': got == px if got is not None else None,
  'got0': got[0] if got else None,
  'lossyDiffers': (lossy != px) if lossy is not None else None,
}))`);
    assert.equal(out.inSet, true);
    assert.equal(out.mapLossy, true);
    if (out.webp) {
      assert.equal(out.mode, 'lossless');
      assert.equal(out.match, true, 'lossless emission keeps each saturated texel');
      assert.deepEqual(out.got0, [173, 165, 12, 255]);
      assert.equal(out.lossyDiffers, true, 'quality 95 would have moved the same texels');
    } else {
      assert.equal(out.mode, null);
    }
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
      assert.deepEqual(pack.images.data, {});
      assert.equal(pack.images.env, null, 'a scene extracted before the reflection atlas');
      resetBoardPack();
      Object.assign(urls, { [`${group}|env`]: '/s/env.png', [`${SCENE_TEX_GROUP}|TX_N`]: '/t/TX_N.webp', [`${SCENE_TEX_GROUP}|TX_M`]: '/t/TX_M.webp', [`${SCENE_TEX_GROUP}|TX_E`]: '/t/TX_E.webp' });
      const first = Object.keys(doc.materials || {})[0] || 'M';
      json = { ...doc, env: { size: 128, mips: 8, range: 1.5 }, materials: { ...doc.materials, [first]: { ...(doc.materials || {})[first], normalMap: 'TX_N', glossMap: 'TX_M', emissionMap: 'TX_E' } } };
      const lit = await loadScenePack(store, 'act2autochess_m02');
      assert.ok(lit.images.data.TX_N && lit.images.data.TX_M && lit.images.env, 'the normal / gloss maps and the reflection atlas');
      assert.ok(lit.images.tex.TX_E && !lit.images.data.TX_E, 'emission is an sRGB colour map');
      assert.ok(!lit.images.tex.TX_N && !lit.images.tex.TX_M, 'data maps stay out of the sRGB textures');
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

  test('sceneMaterial: display-space tint, lightmap range by encoding, key light, cutoff; unlit fallback without a lightmap page', () => {
    const focus = focusUniforms(THREE);
    const map = new THREE.Texture(), lm = new THREE.Texture();
    const info = { keywords: ['_ALPHATEST_ON'], colors: { _Color: [0.5, 1, 1, 1] }, floats: { _Cutoff: 0.4, _ShadowStrength: 0.9 } };
    const light = { dir: [0, 0, 2], color: [1, 0.5, 1], intensity: 1.1 };
    const m = sceneMaterial(THREE, { map, lightMap: lm, info, lightRange: 3, lightEncoding: 'gamma', light }, focus);
    assert.equal(m.uniforms.uMap.value, map);
    assert.equal(m.uniforms.uLm.value, lm);
    assert.equal(m.uniforms.uColor.value.x, 0.5, 'the tint multiplies display values, as in the gamma-space client');
    assert.equal(m.uniforms.uCutoff.value, 0.4);
    assert.equal(m.uniforms.uShadow, undefined, '_ShadowStrength scales the realtime shadow map only: the baked shadow is used whole');
    assert.ok(/shade = lm\.a;/.test(m.fragmentShader));
    assert.equal(m.uniforms.uLmScale.value, 3 * SCENE_LIGHT.indirect);
    assert.deepEqual(m.uniforms.uLightDir.value.toArray(), [0, 0, 1], 'normalised');
    assert.ok(Math.abs(m.uniforms.uLightColor.value.x - 1.1 * SCENE_LIGHT.direct) < 1e-6);
    assert.ok(Math.abs(m.uniforms.uLightColor.value.y - 0.55 * SCENE_LIGHT.direct) < 1e-6, 'the light colour is not linearised');
    assert.equal(m.uniforms.uFocus, focus.uFocus, 'the shared focus falloff');
    assert.equal(m.uniforms.uFocusDim, focus.uFocusDim);
    assert.equal(m.transparent, false);
    assert.ok(m.defines.SCENE_MAP && m.defines.SCENE_LM && !m.defines.SCENE_LM_V1);
    assert.ok(!m.defines.SCENE_PBS && !m.defines.SCENE_NORMAL && !m.defines.SCENE_GLOSS && !m.defines.SCENE_EMIS, 'no reflection atlas → the plain sum, and no emission without the keyword');
    assert.equal(m.uniforms.uEnvScale.value, 0);
    // with the scene's reflection: the client's BRDF, its maps and the material's surface values
    const env = new THREE.CubeTexture(), nrm = new THREE.Texture(), gloss = new THREE.Texture();
    const surf = { ...info, floats: { ...info.floats, _BumpScale: 0.5, _Metallic: 0.25, _Glossiness: 0.3, _GlossMapScale: 0.8 } };
    const full = sceneMaterial(THREE, { map, lightMap: lm, info: surf, lightRange: 3, lightEncoding: 'gamma', light, env, envRange: 1.5, normalMap: nrm, glossMap: gloss }, focus);
    assert.ok(full.defines.SCENE_PBS && full.defines.SCENE_NORMAL && full.defines.SCENE_GLOSS);
    assert.equal(full.uniforms.uEnv.value, env);
    assert.equal(full.uniforms.uEnvScale.value, 1.5);
    assert.equal(full.uniforms.uNormal.value, nrm);
    assert.equal(full.uniforms.uGlossMap.value, gloss);
    assert.deepEqual(full.uniforms.uSurface.value.toArray(), [0.5, 0.25, 0.8], 'bump scale, metallic, the gloss map\'s scale');
    const flat = sceneMaterial(THREE, { map, info: surf, env, light }, focus);
    assert.ok(flat.defines.SCENE_PBS && !flat.defines.SCENE_NORMAL && !flat.defines.SCENE_GLOSS);
    assert.deepEqual(flat.uniforms.uSurface.value.toArray(), [0.5, 0.25, 0.3], 'without a gloss map: _Metallic / _Glossiness');
    for (const term of ['0.779083729', '0.220916301', 'textureLod(uEnv', '0.28 * r2 * rough']) assert.ok(full.fragmentShader.includes(term), term);
    assert.equal(sceneEnvTexture(THREE, {}, { size: 128, mips: 8 }), null, 'no DOM canvas (Node) → no reflection');
    // a scene extracted before lightEncoding: the page holds (L / 8)^(1/2.2), read back in the shader
    const old = sceneMaterial(THREE, { map, lightMap: lm, info, lightRange: 8, light }, focus);
    assert.ok(old.defines.SCENE_LM_V1);
    assert.ok(Math.abs(old.uniforms.uLmScale.value - 8 ** (1 / 2.2) * SCENE_LIGHT.indirect) < 1e-9);
    const bare = sceneMaterial(THREE, { info: { keywords: ['_ALPHABLEND_ON'] } }, focus);
    assert.equal(bare.uniforms.uLmScale.value, 0);
    assert.equal(bare.uniforms.uAmbient.value, SCENE_LIGHT.ambient);
    assert.equal(bare.uniforms.uCutoff.value, 0);
    assert.equal(bare.transparent, true);
    assert.equal(bare.depthWrite, false);
    assert.ok(!bare.defines.SCENE_MAP && !bare.defines.SCENE_LM && !bare.defines.SCENE_EMIS);
    assert.ok(!full.defines.SCENE_EMIS && !flat.defines.SCENE_EMIS && !old.defines.SCENE_EMIS);
    const w = sceneWaterMaterial(THREE, {}, focus, { colors: { _DeepWaterColor: [0, 0.27, 0.4, 0.67] } });
    assert.deepEqual(w.uniforms.uDeep.value.toArray(), [0, 0.27, 0.4, 0.67]);
    assert.equal(w.transparent, true);
    assert.ok(!w.defines.WATER_MAPS, 'no water maps: a flat tint');
  });

  test('emission is the client add after the BRDF, and only when the keyword and the map are both present', () => {
    const focus = focusUniforms(THREE);
    const map = new THREE.Texture();
    const emis = new THREE.Texture();
    const env = new THREE.CubeTexture();
    const info = { keywords: ['_EMISSION'], colors: { _Color: [1, 1, 1, 1], _EmissionColor: [1, 0.6, 0.2, 1] } };
    const on = sceneMaterial(THREE, { map, emissionMap: emis, info, env }, focus);
    assert.equal(on.defines.SCENE_EMIS, 1);
    assert.equal(on.defines.SCENE_PBS, 1);
    assert.equal(on.uniforms.uEmissionMap.value, emis);
    assert.deepEqual(on.uniforms.uEmissionColor.value.toArray(), [1, 0.6, 0.2]);
    const src = on.fragmentShader;
    const add = src.indexOf('lit += toDisplay(texture2D(uEmissionMap, vUv).rgb) * uEmissionColor;');
    const clampAt = src.indexOf('clamp(lit, 0.0, 1.0)');
    const brdf = src.indexOf('0.779083729');
    assert.ok(brdf >= 0 && add > brdf && clampAt > add, 'added in display space after the BRDF and before the clamp');
    assert.ok(src.includes('vec3 lit = a.rgb * (light + uLightColor * max(dot(n, uLightDir), 0.0) * shade);'));
    assert.ok(!src.includes('uEmissionMap, vUv).rgb) * a.rgb'), 'not multiplied by albedo');
    const floor = sceneMaterial(THREE, {
      map, emissionMap: emis, env,
      info: { keywords: ['_NORMALMAP', '_METALLICGLOSSMAP'], colors: { _EmissionColor: [1, 1, 1, 1] } },
    }, focus);
    assert.ok(!floor.defines.SCENE_EMIS, 'a map without _EMISSION stays unlit');
    assert.equal(floor.uniforms.uEmissionMap.value, null);
    const missing = sceneMaterial(THREE, { map, info, env }, focus);
    assert.ok(!missing.defines.SCENE_EMIS, 'keyword on, map missing');
    const black = sceneMaterial(THREE, { map, emissionMap: emis, info: { keywords: ['_EMISSION'] } }, focus);
    assert.equal(black.defines.SCENE_EMIS, 1);
    assert.deepEqual(black.uniforms.uEmissionColor.value.toArray(), [0, 0, 0], 'Unity default _EmissionColor is black');
    const plain = sceneMaterial(THREE, { map, info: { keywords: [] } }, focus);
    assert.ok(!plain.defines.SCENE_EMIS);
    assert.ok(plain.fragmentShader.includes('0.779083729'));
    assert.ok(plain.fragmentShader.includes('0.220916301'));
    const board = boardMaterial(THREE, { D: map }, focus);
    assert.equal(board.isMeshStandardMaterial, true);
    assert.equal(board.emissiveMap, null);
    const glass = glassMaterial(THREE, { D: map }, focus);
    assert.equal(glass.isMeshStandardMaterial, true);
    assert.ok(!glass.defines?.SCENE_EMIS);
    for (const m of [trapMaterial(THREE, map, focus), waterMaterial(THREE, {}, focus)]) {
      assert.equal(typeof m.fragmentShader, 'string');
      assert.ok(!m.fragmentShader.includes('uEmissionMap') && !m.defines?.SCENE_EMIS);
    }
  });
});

describe('shared board / scene water (#549, port of #555 onto #571)', () => {
  const focus = focusUniforms(THREE);
  const record = (extra = {}) => ({ shader: 'Torappu/Scene/StylizedWater', kind: 'water', ...extra });
  const vec = (m, name) => m.uniforms[name].value.toArray();

  test('surface selection uses shader or name, excludes platform decals and validates an explicit pick', () => {
    const plain = { kind: 'lit' }, byName = { kind: 'water' }, a = record(), b = record();
    const decal = { kind: 'water', shader: 'Torappu/Scene/DynamicWaterTile' };
    const materials = { rock: plain, other_water12: byName, sea: a, sea2: b, platform_water: decal };
    assert.equal(sceneWaterInfo({ materials }), a, 'shader wins over name fallback');
    assert.equal(sceneWaterInfo({ materials, waterMaterial: 'sea2' }), b);
    assert.equal(sceneWaterInfo({ materials, waterMaterial: 'platform_water' }), a, 'decal cannot override a surface');
    assert.equal(sceneWaterInfo({ materials: { other_water12: byName, platform_water: decal } }), byName);
    for (const doc of [null, {}, { materials: [] }, { materials: { rock: plain, platform: decal, bad: null } }]) {
      assert.equal(sceneWaterInfo(doc), null);
    }
    assert.equal(isSceneWater({ shader: 'Torappu/Scene/StylizedWater' }, 'any_theme'), true, 'kind is not required');
    assert.equal(isSceneWater({ shader: 42 }, 'other_WATER2'), true, 'old extraction without a shader name');
    assert.equal(isSceneWater(decal, 'platform_water'), false);
    assert.equal(sceneMaterialKey({ material: 'other_water2', lightmap: 3 }, byName), 'other_water2|');
    assert.equal(sceneMaterialKey({ material: 'sea', lightmap: 3 }, { shader: a.shader }), 'sea|');
  });

  test('every official parameter maps to its uniform, with field fallbacks and a board-space sun', () => {
    const info = record({
      colors: { _DeepWaterColor: [0.1, 0.2, 0.3, 0.4], _ShallowWaterColor: [0.5, 0.6, 0.7, 0.8],
        _WaterSpeed: [0.2, 0.3, 0, 0], _FlowSpeed: [-0.1, 0.4, 0, 0], _SunDir: [0, 0, -2, 0] },
      floats: { _Tiling: 0.8, _NormalTiling: 0.9, _BumpScale: 0.4, _CausticsTiling: 0.3,
        _CausticsSpeed: 0.1, _CausticsBrightness: 0.5, _SkyStrength: 0.6, _WaterColorIntensity: 1.2, _Glossiness: 0.5 },
    });
    const w = waterMaterial(THREE, {}, focus, info);
    assert.deepEqual(vec(w, 'uDeep'), info.colors._DeepWaterColor);
    assert.deepEqual(vec(w, 'uShallow'), info.colors._ShallowWaterColor);
    assert.deepEqual(vec(w, 'uWaterSpeed'), [0.2, 0.3]);
    assert.deepEqual(vec(w, 'uFlowSpeed'), [-0.1, 0.4]);
    assert.deepEqual(vec(w, 'uSunDir'), [0, 0, 1]);
    assert.deepEqual(vec(w, 'uViewDir'), [0, 0, 0], 'use actual camera on scene water');
    for (const [name, expected] of Object.entries({ uTiling: 0.8, uNormalTiling: 0.9, uBumpScale: 0.4,
      uCausticsTiling: 0.3, uCausticsSpeed: 0.1, uCausticsGain: 0.5 * WATER_TUNING.causticsGain,
      uSkyStrength: 0.6 * WATER_TUNING.skyGain, uColorIntensity: 1.2, uSpecPower: 64 })) {
      assert.equal(w.uniforms[name].value, expected, name);
    }
    assert.equal(sceneWaterMaterial, waterMaterial, 'compatibility entry point is the same function');
    assert.equal(w.uniforms.uFocus, focus.uFocus);
    applyWaterMaterial(w, record({ colors: { _DeepWaterColor: [0, NaN] }, floats: { _Tiling: Infinity, _BumpScale: 0, _Glossiness: 0 } }));
    assert.deepEqual(vec(w, 'uDeep'), SCENE_WATER_DEFAULTS.deep, 'invalid components fall back individually');
    assert.equal(w.uniforms.uTiling.value, SCENE_WATER_DEFAULTS.tiling);
    assert.equal(w.uniforms.uBumpScale.value, 0, 'valid zero is retained');
    assert.equal(w.uniforms.uSpecPower.value, 2);
  });

  test('no-record defaults retain procedural animation, opacity and approximately its displayed colour', () => {
    assert.deepEqual(WATER_DEFAULTS, {
      deep: [0.189748, 0.484529, 0.556393, 0.9], shallow: [0.331830, 0.708370, 0.767376, 0.9],
      tiling: 0.45, normalTiling: 0.765, bumpScale: 1 / 2.2,
      waterSpeed: [0.03, 0.021], flowSpeed: [-0.025, 0.017],
      causticsTiling: 0.6, causticsSpeed: 0.02, causticsBrightness: 1,
      sunDir: [-0.45, -0.3, 0.84], viewDir: [0, -0.5, 0.866], skyStrength: 0, colorIntensity: 1, specPower: 40,
      wet: [0.35, 0.45], causticsTint: [0.28, 0.25, 0.23], specTint: [0.8, 0.65, 0.6],
    });
    const w = waterMaterial(THREE, {}, focus);
    for (const [name, field] of [['uDeep', 'deep'], ['uShallow', 'shallow'], ['uWaterSpeed', 'waterSpeed'],
      ['uFlowSpeed', 'flowSpeed'], ['uWet', 'wet'], ['uCausticsTint', 'causticsTint'], ['uSpecTint', 'specTint']]) {
      assert.deepEqual(vec(w, name), WATER_DEFAULTS[field]);
    }
    assert.equal(w.uniforms.uTiling.value, 0.45);
    assert.equal(w.uniforms.uNormalTiling.value, 0.765);
    assert.equal(w.uniforms.uBumpScale.value, 1 / 2.2);
    assert.equal(w.uniforms.uCausticsGain.value, 1);
    assert.equal(w.uniforms.uSkyStrength.value, 0);
    assert.equal(w.uniforms.uSpecPower.value, 40);
    assert.equal(w.uniforms.uAlphaLift.value, 0);
    // CPU colour reference for a flat normal, no glint: compare old linear sum → sRGB to the new gamma sum.
    // This guards against a large fallback darkening; GPU screenshots still own the visual acceptance.
    const display = (c) => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    const linear = (c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    const wet = 0.35 + 0.45 * 0.84 / Math.hypot(0.45, 0.3, 0.84);
    for (const ca of [0, 0.25, 0.5, 0.75, 1]) for (const dim of [1, 0.72]) {
      for (let i = 0; i < 3; i++) {
        const old = display((([0.03, 0.2, 0.27][i] * (1 - wet) + [0.09, 0.46, 0.55][i] * wet) + ca * [0.18, 0.32, 0.34][i]) * dim);
        const lit = WATER_DEFAULTS.deep[i] * (1 - wet) + WATER_DEFAULTS.shallow[i] * wet + ca * WATER_DEFAULTS.causticsTint[i];
        const current = display(linear(lit) * dim);
        assert.ok(Math.abs(old - current) * 255 < 10, `ca=${ca}, focus=${dim}, channel=${i}`);
      }
    }
  });

  test('reflection and gradient are exclusive; colour sums precede toLinear, waves and caustics fail independently', () => {
    const env = new THREE.CubeTexture(), waterN = new THREE.Texture(), caustics = new THREE.Texture();
    const w = waterMaterial(THREE, { waterN, caustics }, focus, record(), { env, envRange: 1.54, envMips: 8 });
    assert.ok(w.defines.WATER_ENV && w.defines.WATER_NORMAL && w.defines.WATER_CAUSTICS);
    assert.equal(w.uniforms.uEnv.value, env);
    assert.equal(w.uniforms.uEnvScale.value, 1.54);
    const rough = 1 - SCENE_WATER_DEFAULTS.glossiness;
    assert.equal(w.uniforms.uEnvLod.value, rough * (1.7 - 0.7 * rough) * 7);
    assert.equal(w.uniforms.uSkyStrength.value, 0.767 * 0.15);
    assert.equal(w.uniforms.uCausticsGain.value, 0.377 * 0.2);
    assert.deepEqual(vec(w, 'uSpecTint'), [0.5, 0.6, 0.65].map((v) => v * 0.6));
    assert.equal(w.uniforms.uAlphaLift.value, 0.2);
    assert.match(w.fragmentShader, /#ifdef WATER_ENV\n\s+vec3 sky = textureLod\(uEnv, vec3\(rd.x, rd.y, -rd.z\), uEnvLod\).rgb \* uEnvScale;\n\s+#else/);
    assert.match(w.fragmentShader, /lit \+= ca \* uCausticsGain \* uCausticsTint \+ spec \* uSpecTint;\n\s+vec3 c = toLinear\(clamp\(lit, 0.0, 1.0\)\)/);
    assert.ok(!w.fragmentShader.includes('vec3(2.2)'), 'no early approximate gamma decode');
    assert.match(w.fragmentShader, /c \* focusMask/);
    assert.ok(w.fragmentShader.includes('#include <colorspace_fragment>'));
    const version = w.version;
    applyWaterMaterial(w, record());
    assert.ok(!w.defines.WATER_ENV);
    assert.equal(w.uniforms.uEnv.value, null);
    assert.equal(w.uniforms.uEnvScale.value, 0);
    assert.equal(w.version, version + 1, 'changing cube branch recompiles');
    assert.equal(w.uniforms.uSkyStrength.value, 0.767 * 0.22);
    assert.equal(w.uniforms.uCausticsGain.value, 0.377 * 0.35);
    assert.deepEqual(vec(w, 'uSpecTint'), [0.5, 0.6, 0.65].map((v) => v * 1.6));
    applyWaterMaterial(w, record());
    assert.equal(w.version, version + 1, 'same branch does not recompile');
    for (const tex of [{}, { waterN }, { caustics }]) {
      const partial = waterMaterial(THREE, tex, focus, record(), { env });
      assert.equal(!!partial.defines.WATER_NORMAL, !!tex.waterN);
      assert.equal(!!partial.defines.WATER_CAUSTICS, !!tex.caustics);
      assert.equal(partial.defines.WATER_ENV, 1, 'cube works even without normal / caustics maps');
      assert.equal(partial.uniforms.uEnvScale.value, 1);
    }
  });

  test('applyWaterMaterial ignores non-water uniforms and resets our material without replacing shared objects', () => {
    const w = waterMaterial(THREE, {}, focus, record());
    const deep = w.uniforms.uDeep.value;
    w.uniforms.uTime.value = 12;
    applyWaterMaterial(w, null);
    assert.equal(w.uniforms.uDeep.value, deep);
    assert.deepEqual(deep.toArray(), WATER_DEFAULTS.deep);
    assert.equal(w.uniforms.uFocus, focus.uFocus);
    assert.equal(w.uniforms.uTime.value, 12);
    const other = { uniforms: { uDeep: { value: new THREE.Vector4(9, 8, 7, 6) }, uEnv: { value: 'other env' } } };
    assert.equal(applyWaterMaterial(other, record()), other);
    assert.deepEqual(other.uniforms.uDeep.value.toArray(), [9, 8, 7, 6], 'coincident uniform names are not authorization');
    assert.equal(other.uniforms.uEnv.value, 'other env');
    for (const m of [null, undefined, {}, { uniforms: {} }, { uniforms: { uTime: { value: 2 } } }]) {
      assert.equal(applyWaterMaterial(m, record()), m);
    }
    delete w.uniforms.uTiling;
    assert.doesNotThrow(() => applyWaterMaterial(w, record()), 'older partial water uniforms are safe');
  });

  test('active stage owns the board parameters, cube and animation across preload, switch, replacement and removal', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    const stage = stages.act1autochess_m05, otherStage = stages.act2autochess_m04;
    const pack = fakeScenePack();
    pack.doc.env = { size: 2, mips: 2, range: 1.54 };
    pack.images.env = { width: 12, height: 3 };
    // A tiny canvas stub exercises the production atlas creation without a WebGL context or a localhost server.
    const original = globalThis.document;
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
    let res;
    try { res = board._sceneResources(pack); } finally {
      if (original === undefined) delete globalThis.document; else globalThis.document = original;
    }
    const env = res.env;
    assert.ok(env.isCubeTexture);
    assert.equal(env.colorSpace, THREE.NoColorSpace);
    let disposed = 0;
    env.addEventListener('dispose', () => disposed++);
    board.setScenePack(stage.id, pack);
    board.setStage(stage);
    const boardWater = board.mat.water;
    assert.ok(board.meshes.water && board.official);
    const surface = board.sceneWater[0];
    assert.equal(surface.fragmentShader, boardWater.fragmentShader);
    for (const name of Object.keys(surface.uniforms)) {
      assert.deepEqual(boardWater.uniforms[name].value, surface.uniforms[name].value, name);
    }
    assert.equal(boardWater.uniforms.uEnv.value, env);
    const other = fakeScenePack();
    other.key = 'another';
    other.doc.materials.W.colors._DeepWaterColor = [0.1, 0.2, 0.3, 0.4];
    board.setScenePack(otherStage.id, other);
    assert.equal(boardWater.uniforms.uEnv.value, env, 'background preload does not change active water');
    board.setArea(AREAS.unite);
    assert.equal(board.sceneWater[0], surface, 'rebuild reuses water and cube');
    board.render(presetCamera('normal', { width: 1280, height: 720 }), 8);
    assert.equal(boardWater.uniforms.uTime.value, 8);
    assert.equal(surface.uniforms.uTime.value, 8);
    board.setStage(otherStage);
    assert.deepEqual(vec(boardWater, 'uDeep'), [0.1, 0.2, 0.3, 0.4]);
    assert.equal(boardWater.uniforms.uEnv.value, null);
    assert.ok(!boardWater.defines.WATER_ENV, 'no cube in the second pack');
    board.setStage(stage);
    assert.equal(boardWater.uniforms.uEnv.value, env, 'cached stage restores its cube');
    const replacement = fakeScenePack(); replacement.key = 'replacement';
    board.setScenePack(stage.id, replacement);
    assert.equal(disposed, 1);
    assert.equal(boardWater.uniforms.uEnv.value, null, 'no reference to the disposed cube');
    board.setScenePack(stage.id, null);
    assert.deepEqual(vec(boardWater, 'uDeep'), WATER_DEFAULTS.deep);
    assert.ok(!board.official && board.meshes.water);
    board.setStage(otherStage);
    board.setStage(null);
    assert.equal(board.official, null);
    assert.deepEqual(board.sceneWater, []);
    assert.deepEqual(vec(boardWater, 'uDeep'), WATER_DEFAULTS.deep);
    board.destroy();
    assert.equal(disposed, 1, 'the cube has one owner');
  });

  test('no surface record, hidden-only scene and a platform decal cannot choose surface water parameters', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    const stage = stages.act1autochess_m05;
    const pack = fakeScenePack();
    pack.doc.materials.W = { kind: 'water', shader: 'Torappu/Scene/DynamicWaterTile', colors: { _Color: [1, 0, 0, 1] } };
    board.setScenePack(stage.id, pack);
    board.setStage(stage);
    assert.equal(sceneWaterInfo(pack.doc), null);
    assert.deepEqual(vec(board.mat.water, 'uDeep'), WATER_DEFAULTS.deep);
    assert.ok(!board.sceneWater[0].userData.water, 'decal keeps its previous approximation');
    const hidden = fakeScene([{ material: 'W', x0: 10, y0: 3, group: 'HIDDEN@3' }]);
    const chunks = parseSceneChunks(hidden.doc, hidden.bin);
    board.setScenePack(stage.id, { key: 'hidden', doc: hidden.doc, chunks, groups: sceneGroupRects(chunks), images: {} });
    assert.equal(board.official, null);
    assert.deepEqual(vec(board.mat.water, 'uDeep'), WATER_DEFAULTS.deep, 'failed scene build restores defaults');
    board.destroy();
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

  test('round 40: the 射击台 are the official model (trap_1106_achplat) on the scene and on the procedural board, lit by its material; without the model the slab stays', () => {
    // a 1 × 0.465 quad standing in for the model (OBJ in the exported centimetres, prefab scale 0.01)
    const quad = parseObj(['v -50 0 -50', 'v 50 0 -50', 'v 50 46.5 -50', 'v -50 46.5 -50', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
      'vn 0 0 -1', 'f 1/1/1 2/2/1 3/3/1 4/4/1'].join('\n'));
    const pack = fakePack();
    pack.images.platform = { width: 4, height: 4 };
    pack.meshes.platform = quad;
    pack.materials = { trap: { MT_trap_1106_achplat: { floats: { _Ambient: 0.895, _Diffuse: 0.197 } } } };
    const board = new BoardScene(THREE, pack, { renderer: stubRenderer() });
    const m03 = stages.act1autochess_m03;
    board.setStage(m03);
    const count = board.board.devices.filter((d) => d.kind === 'platform').length;
    assert.ok(count >= 4, 'm03 has its 射击台 in the normal field');
    assert.ok(board.meshes.board && board.meshes.platforms, 'procedural board: the model');
    assert.equal(board.meshes.platforms.material, board.mat.platform);
    assert.equal(board.meshes.platforms.geometry.getAttribute('position').count, count * 4, 'one model per 射击台');
    const P = board.meshes.platforms.geometry.getAttribute('position').array;
    let top = -Infinity;
    for (let i = 2; i < P.length; i += 3) top = Math.max(top, P[i]);
    assert.ok(Math.abs(top - TILE_H.platform) < 1e-6, `the model's top is where units stand (${top})`);
    assert.equal(board.mat.platform.uniforms.uAmbient.value, 0.895);
    assert.equal(board.mat.platform.uniforms.uDiffuse.value, 0.197);
    const key = new THREE.Vector3(...LIGHTING.key.dir).normalize();
    assert.ok(board.mat.platform.uniforms.uLightDir.value.distanceTo(key) < 1e-6, 'lit like the procedural board');
    board.setScenePack(m03.id, fakeScenePack());
    assert.ok(board.official && board.meshes.platforms && !board.meshes.raised, 'scene: the model and no slab');
    const sun = new THREE.Vector3(0.36, 0.45, 0.82).normalize();
    assert.ok(board.mat.platform.uniforms.uLightDir.value.distanceTo(sun) < 1e-6, "lit by the scene's own light");
    board.destroy();
    const plain = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    plain.setStage(m03);
    assert.ok(plain.mat.platform === null && !plain.meshes.platforms, 'no local model: no platform mesh');
    assert.ok(plain.board.buckets.board.vertexCount > 0);
    plain.setScenePack(m03.id, fakeScenePack());
    assert.ok(plain.meshes.raised, 'no local model: the slab on the scene');
    plain.destroy();
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

  test('a scene.json without emission keys leaves the scene and the procedural board unlit by emission', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board.setStage(stage);
    for (const m of Object.values(board.mat)) {
      if (!m) continue;
      assert.ok(!m.defines?.SCENE_EMIS);
      if (typeof m.fragmentShader === 'string') assert.ok(!m.fragmentShader.includes('uEmissionMap'));
    }
    assert.equal(board.mat.board.isMeshStandardMaterial, true);
    board.setScenePack(stage.id, fakeScenePack());
    const meshes = sceneMeshes(board);
    assert.ok(meshes.length > 0);
    for (const mesh of meshes) assert.ok(!mesh.material.defines?.SCENE_EMIS);
    board.destroy();
  });

  test('_EMISSION lights only that material; the same map without the keyword does not', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    const pack = fakeScenePack();
    const img = { width: 4, height: 4 };
    pack.doc.materials.M = {
      ...pack.doc.materials.M,
      keywords: ['_EMISSION'],
      emissionMap: 'TX_E',
      colors: { ...pack.doc.materials.M.colors, _EmissionColor: [0.6, 1, 0.25, 1] },
    };
    pack.doc.materials.Cut = { ...pack.doc.materials.Cut, emissionMap: 'TX_FLOOR' };
    pack.images.tex = { ...pack.images.tex, TX_E: img, TX_FLOOR: img };
    board.setScenePack(stage.id, pack);
    board.setStage(stage);
    const meshes = sceneMeshes(board);
    const emis = meshes.filter((m) => m.material.defines?.SCENE_EMIS);
    assert.ok(emis.length >= 1);
    for (const m of emis) {
      assert.equal(m.material.uniforms.uEmissionMap.value.colorSpace, THREE.SRGBColorSpace);
      assert.deepEqual(m.material.uniforms.uEmissionColor.value.toArray(), [0.6, 1, 0.25]);
    }
    const cut = meshes.find((m) => m.material.uniforms.uCutoff?.value === 0.4);
    assert.ok(cut && !cut.material.defines?.SCENE_EMIS, 'assigned map, keyword off');
    const water = meshes.find((m) => m.material.uniforms.uDeep);
    assert.ok(water && !water.material.fragmentShader.includes('uEmissionMap'));
    board.destroy();
  });

  test('_fitShadow keeps a finite box and substitutes a fixed box for empty or non-finite bounds', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board._fitShadow({ bounds: { x0: 0, x1: 10, y0: 2, y1: 8 } });
    assert.equal(board.key.shadow.camera.right, 14);
    assert.equal(board.key.shadow.camera.left, -14);
    assert.equal(board.key.shadow.camera.top, 14);
    assert.equal(board.key.shadow.camera.bottom, -14);
    assert.ok(Math.abs(board.key.target.position.x - 5) < 1e-6);
    assert.ok(Math.abs(board.key.target.position.y - 5) < 1e-6);
    assert.ok(Number.isFinite(board.key.position.x) && Number.isFinite(board.key.position.z));
    for (const bounds of [{ x0: 0, x1: Infinity, y0: 0, y1: 10 }, { x0: NaN, x1: 1, y0: 0, y1: 1 }, {}]) {
      board._fitShadow({ bounds });
      assert.equal(board.key.shadow.camera.right, 24);
      assert.equal(board.key.target.position.x, 0);
      assert.equal(board.key.target.position.y, 0);
      assert.ok(Number.isFinite(board.key.position.x) && Number.isFinite(board.key.shadow.camera.far));
    }
    board._fitShadow(null);
    assert.equal(board.key.shadow.camera.right, 24);
    board.destroy();
  });

  test('destroy frees the PMREM render target once and does not free it on a stage rebuild', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    assert.equal(board.envMap, null);
    assert.equal(board.envRT, null);
    let rt = 0;
    let tex = 0;
    board.envRT = { dispose() { rt++; } };
    board.envMap = { dispose() { tex++; }, userData: {} };
    board.setStage(stage);
    assert.equal(rt, 0, 'setStage does not drop the environment target');
    board.destroy();
    assert.equal(rt, 1);
    assert.equal(tex, 0, 'the target dispose owns the texture');
    assert.equal(board.envRT, null);
    assert.equal(board.envMap, null);
    board.destroy();
    assert.equal(rt, 1, 'a second destroy is a no-op');
    const bare = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    bare.envMap = { dispose() { tex++; } };
    bare.destroy();
    assert.equal(tex, 1, 'no target: the texture is disposed');
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
      for (const m of Object.values(doc.materials)) {
        for (const k of ['map', 'normalMap', 'glossMap', 'emissionMap']) if (m[k]) assert.ok(groups[SCENE_TEX_GROUP]?.[m[k]], `texture ${m[k]}`);
      }
      if (doc.env) {   // a scene extracted with its reflection: the atlas holds 6 faces × the mip chain
        const e = groups[g].env;
        assert.ok(e && existsSync(file(e.path)), 'the reflection atlas');
        assert.ok(doc.env.size > 0 && doc.env.mips > 0 && doc.env.range > 0);
        assert.equal(e.w, 6 * doc.env.size);
        assert.equal(e.h, Array.from({ length: doc.env.mips }, (_, i) => Math.max(1, doc.env.size >> i)).reduce((a, b) => a + b, 0));
      }
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
