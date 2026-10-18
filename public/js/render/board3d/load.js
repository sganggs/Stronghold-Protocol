// render/board3d/load.js — loading of three.js and the official board art (local-client extraction, DESIGN §13/§15).
//
//   const THREE = await loadThree()            // '/vendor/three.module.js' (tools/vendor.mjs), null when missing
//   const pack = await loadBoardPack(assets)   // null when the board art is not installed (→ 2D board)
//   → { key, images: { D, N?, R?, E?, common?, commonE?, BG?, wind?, gate?, waterN?, caustics?, noise?, platform?, crate? },
//       meshes: { crate?, box?, platform?, blower?, bgPlane?, gate: { startDown?, startUp?, startBack?, endDown?, endUp? } },
//       tiles, uv, materials: { theme?, fx?, trap? } }
//   const scene = await loadScenePack(assets, stageId)   // the stage's official scene (tools/local-extract/scenes.py),
//   → { key, stage, doc, chunks: [{ material, lightmap, group, bounds, position, uv, uv1, normal, color, index }],
//       groups: { name: [x0, y0, x1, y1] }, images: { tex: { name: img }, lm: [img|null] } }     null when not extracted
//
// Everything is optional except the diffuse atlas: a missing map or mesh only drops that feature (e.g. no normal
// map → flat shading of the atlas; no crate mesh → a procedural box). URLs come from data/local-assets.json only
// (assets.localUrl) — nothing is guessed. Results are cached per page.

import { resolveUvTable } from './atlas.js';
import { parseObj } from './obj.js';

export const THREE_URL = '/vendor/three.module.js';

let threePromise = null;
let threeFailures = 0;
/** Dynamic import of the vendored three.js ESM build (browser only); null when unavailable. */
export function loadThree(url = THREE_URL) {
  if (!threePromise) {
    // Browsers also cache failed module imports. Two bounded retry URLs permit a transient download failure to
    // recover; clearing only our promise would keep receiving that same cached rejection without another request.
    if (threeFailures >= 3) return Promise.resolve(null);
    const source = new URL(url, import.meta.url);
    if (threeFailures) source.searchParams.set('sp-retry', String(threeFailures));
    const pending = import(/* @vite-ignore */ source.href).then((m) => (m && m.WebGLRenderer ? m : null), () => null).then((m) => {
      if (!m && threePromise === pending) { threePromise = null; threeFailures++; }
      return m;
    });
    threePromise = pending;
  }
  return threePromise;
}

/**
 * Can this browser run the 3D board? (WebGL2 — three r163+ requires it.) Software / blocklisted GPUs ("major
 * performance caveat") count as unavailable unless `allowSlow` (an explicit `?board=3d`).
 */
export function webgl2Available(allowSlow = false) {
  try {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', allowSlow ? {} : { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch { return false; }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Manifest key → pack slot. */
export const PACK_IMAGES = Object.freeze({
  D: ['map/autochess', 'TX_autochessi_D'],
  N: ['map/autochess', 'TX_autochessi_N_rgb'],
  R: ['map/autochess', 'TX_autochessi_M_rough'],
  E: ['map/autochess', 'TX_autochessi_E'],
  common: ['map/autochess', 'TX_autochessi_common_D'],
  commonE: ['map/autochess', 'TX_autochessi_common_E'],
  BG: ['map/autochess', 'TX_autochessi_BG'],
  wind: ['map/common', 'TX_wind_device'],
  gate: ['map/fx', '[opt]merged_textures'],
  waterN: ['map/water', '[ucp]TX_water_normal'],
  caustics: ['map/water', 'TX_Caustics256'],
  noise: ['map/water', 'T_noise_clouds_01'],
  platform: ['mesh/trap_110', 'TX_trap_1106_achplat'],
  crate: ['mesh/trap_110', 'TX_trap_1105_accrate'],
});

export const PACK_MESHES = Object.freeze({
  crate: ['mesh/trap_110', 'trap_1105_accrate'],
  box: ['mesh/s_common_box_01', 'pCube2'],
  blower: ['mesh/s_wind_device', 'S_wild_wind_device'],
  bgPlane: ['mesh/s_background_common', 'pPlane1'],
  platform: ['mesh/trap_110', 'trap_1106_achplat'],
});

/** The official gate / objective boxes: prefab node → pack slot (meshes resolved through map/fx/prefab.json). */
export const GATE_NODES = Object.freeze({
  startDown: 'Start_down', startUp: 'Start_up', startBack: 'Start_back', endDown: 'Start_down1', endUp: 'Start_up1',
});

let cached = null;

/**
 * Does the local-art manifest list the board atlas? Reads the manifest only (no images): decides whether the
 * ~2 MB three.js build is worth downloading at all (most hosts have no local-client art → 2D board, no three).
 */
export async function boardArtListed(assets) {
  if (!assets || typeof assets.local !== 'function' || typeof assets.localUrl !== 'function') return false;
  try { await assets.local(); } catch { return false; }
  const u = assets.localUrl(...PACK_IMAGES.D);
  return typeof u === 'string' && u.length > 0;
}

async function fetchText(url) {
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.text() : null; } catch { return null; }
}
async function fetchJson(url) {
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
}

/**
 * Load the board pack through the asset store of public/js/assets.js (needs local(), localUrl(), image()).
 * @returns {Promise<object|null>}
 */
export function loadBoardPack(assets) {
  if (cached) return cached;
  const pending = (async () => {
    if (!assets || typeof assets.local !== 'function' || typeof assets.localUrl !== 'function' || typeof assets.image !== 'function') return null;
    const manifest = await assets.local().catch(() => null);
    if (!isObj(manifest)) return null;
    const url = (g, n) => { const u = assets.localUrl(g, n); return typeof u === 'string' && u ? encodeURI(u) : null; };
    const dUrl = url(...PACK_IMAGES.D);
    if (!dUrl) return null;
    const images = {};
    await Promise.all(Object.entries(PACK_IMAGES).map(async ([k, [g, n]]) => {
      const u = url(g, n);
      if (!u) return;
      const img = await assets.image(u, { retry: true }).catch(() => null);
      if (img && (img.width || img.naturalWidth) > 0) images[k] = img;
    }));
    if (!images.D) return null;
    const dir = dUrl.replace(/\/[^/]*$/, '');
    const [tiles, theme, fxMats, fxPrefab, trapMats] = await Promise.all([
      fetchJson(`${dir}/tiles.json`),
      (async () => { const u = url('map/autochess', 'materials'); return u ? fetchJson(u) : null; })(),
      (async () => { const u = url('map/fx', 'materials'); return u ? fetchJson(u) : null; })(),
      (async () => { const u = url('map/fx', 'prefab'); return u ? fetchJson(u) : null; })(),
      (async () => { const u = url('mesh/trap_110', 'materials'); return u ? fetchJson(u) : null; })(),
    ]);
    const meshes = { gate: {} };
    await Promise.all(Object.entries(PACK_MESHES).map(async ([k, [g, n]]) => {
      const u = url(g, n);
      const text = u ? await fetchText(u) : null;
      const m = text ? parseObj(text) : null;
      if (m) meshes[k] = m;
    }));
    const prefab = Array.isArray(fxPrefab) ? fxPrefab : [];
    await Promise.all(Object.entries(GATE_NODES).map(async ([slot, node]) => {
      const rec = prefab.find((p) => p && p.name === node && (node !== 'Start_back' || p.parent === '[opt]start_box'));
      const key = rec && typeof rec.mesh === 'string' ? rec.mesh : node;
      const u = url('map/fx', key);
      const text = u ? await fetchText(u) : null;
      const m = text ? parseObj(text) : null;
      if (m) meshes.gate[slot] = { mesh: m, material: rec && Array.isArray(rec.materials) ? rec.materials[0] || null : null };
    }));
    return {
      key: `${dUrl}#${tiles?.version || 0}`,
      images, meshes, tiles: isObj(tiles) ? tiles : null, uv: resolveUvTable(isObj(tiles) ? tiles : null),
      materials: { theme: isObj(theme) ? theme : null, fx: isObj(fxMats) ? fxMats : null, trap: isObj(trapMats) ? trapMats : null },
    };
  })().catch((err) => { console.warn('[board3d] art load failed', err); return null; }).then((pack) => {
    // A timeout / failed atlas is not proof the host lacks 3D art. A later mount or visibility change may retry.
    // An older attempt finishing after reset must not discard a newer cached request.
    if (!pack && cached === pending) cached = null;
    return pack;
  });
  cached = pending;
  return pending;
}

/** Manifest group of a stage's official scene, and of the textures the scenes share. */
export const sceneGroup = (stageId) => `scene/${stageId}`;
export const SCENE_TEX_GROUP = 'scene/tex';
export const SCENE_VERSION = 1;
/** Bytes per vertex of a scene chunk: position f32×3, uv f32×2, lightmap uv f32×2, normal i8×4, colour u8×4. */
export const SCENE_VERTEX_BYTES = 36;

/**
 * Typed-array views of the chunks of a scene.bin (scenes.py pack_chunk); null when a record does not fit the buffer.
 * @param {object} doc scene.json
 * @param {ArrayBuffer} buf scene.bin
 */
export function parseSceneChunks(doc, buf) {
  if (!isObj(doc) || !Array.isArray(doc.chunks) || !(buf instanceof ArrayBuffer)) return null;
  const out = [];
  for (const c of doc.chunks) {
    const n = c?.verts | 0, m = (c?.tris | 0) * 3, o = c?.offset | 0;
    const end = o + n * SCENE_VERTEX_BYTES + m * (c.index32 ? 4 : 2);
    if (!(n > 0) || !(m > 0) || o < 0 || o % 4 || end > buf.byteLength || typeof c.material !== 'string') return null;
    let p = o;
    const position = new Float32Array(buf, p, n * 3); p += n * 12;
    const uv = new Float32Array(buf, p, n * 2); p += n * 8;
    const uv1 = new Float32Array(buf, p, n * 2); p += n * 8;
    const normal = new Int8Array(buf, p, n * 4); p += n * 4;
    const color = new Uint8Array(buf, p, n * 4); p += n * 4;
    const index = c.index32 ? new Uint32Array(buf, p, m) : new Uint16Array(buf, p, m);
    out.push({
      material: c.material, lightmap: Number.isInteger(c.lightmap) ? c.lightmap : -1, group: typeof c.group === 'string' ? c.group : '',
      bounds: Array.isArray(c.bounds) ? c.bounds : null, position, uv, uv1, normal, color, index,
    });
  }
  return out;
}

/**
 * Mesh bucket of a scene chunk. One material and one lightmap page are one draw. Water ignores the page: that shader
 * has no lightmap (`scene.js` `sceneWaterMaterial`).
 * @param {{ material?: string, lightmap?: number }} chunk
 * @param {{ kind?: string }|null} info scene.json materials[name]
 */
export function sceneMaterialKey(chunk, info) {
  return `${chunk?.material}|${info?.kind === 'water' || isSceneWater(info, chunk?.material) ? '' : chunk?.lightmap}`;
}

/** Surface water, not the DynamicWaterTile platform decal (both were extracted as kind: water). */
export function isSceneWater(info, name = '') {
  if (!isObj(info)) return false;
  const shader = typeof info.shader === 'string' ? info.shader : '';
  if (shader.endsWith('/DynamicWaterTile')) return false;
  return shader.endsWith('/StylizedWater') || /_water\d*$/i.test(name);
}

/**
 * Pick this map's water record by shader, then by name, never by a theme-specific name. An explicit surface pick
 * wins. [ASSUMED] With several surfaces the board takes the first StylizedWater; each scene mesh keeps its own
 * record (including water2). No surface record → null, so the caller restores the procedural water defaults.
 */
export function sceneWaterInfo(doc) {
  const mats = isObj(doc?.materials) ? doc.materials : {};
  const name = doc?.waterMaterial;
  if (typeof name === 'string' && isSceneWater(mats[name], name)) return mats[name];
  const entries = Object.entries(mats).filter(([n, info]) => isSceneWater(info, n));
  return entries.find(([, info]) => typeof info.shader === 'string' && info.shader.endsWith('/StylizedWater'))?.[1] || entries[0]?.[1] || null;
}

/**
 * One scene chunk from several that share a material bucket (`sceneMaterialKey`). Vertex attributes stay in the
 * scene.bin layout (position f32×3, uv f32×2, lightmap uv f32×2, normal i8×4, colour u8×4) and indices are rewritten
 * with the vertex offset; past 65535 vertices the index is 32-bit (WebGL2). A single chunk is returned as-is, so the
 * pack's views of scene.bin stay shared. The caller passes chunks of one bucket that are on screen together: a
 * file-level merge would bake a switched-off HIDDEN part into the base mesh.
 * @param {object[]|null} chunks
 * @returns {object|null}
 */
export function mergeSceneChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  if (chunks.length === 1) return chunks[0];
  const first = chunks[0];
  let nv = 0, ni = 0, index32 = false;
  for (const c of chunks) {
    const n = c?.position?.length / 3;
    if (!Number.isInteger(n) || n <= 0) throw new Error(`scene chunk ${c?.material}: ${c?.position?.length ?? 0} position components`);
    if (c.material !== first.material) throw new Error(`scene merge mixes ${first.material} and ${c.material}`);
    if (c.uv?.length !== n * 2 || c.uv1?.length !== n * 2 || c.normal?.length !== n * 4 || c.color?.length !== n * 4) {
      throw new Error(`scene chunk ${c.material}: attributes do not match ${n} vertices`);
    }
    if (!c.index || c.index.length === 0) throw new Error(`scene chunk ${c.material}: no indices`);
    nv += n;
    ni += c.index.length;
    if (c.index instanceof Uint32Array) index32 = true;
  }
  if (nv > 65535) index32 = true;
  const position = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const uv1 = new Float32Array(nv * 2);
  const normal = new Int8Array(nv * 4);
  const color = new Uint8Array(nv * 4);
  const index = index32 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0, bounds = null;
  for (const c of chunks) {
    const n = c.position.length / 3;
    position.set(c.position, vo * 3);
    uv.set(c.uv, vo * 2);
    uv1.set(c.uv1, vo * 2);
    normal.set(c.normal, vo * 4);
    color.set(c.color, vo * 4);
    for (let i = 0; i < c.index.length; i++) {
      const v = c.index[i];
      if (v < 0 || v >= n) throw new Error(`scene chunk ${c.material}: index ${v} out of ${n}`);
      index[io + i] = v + vo;
    }
    vo += n;
    io += c.index.length;
    if (Array.isArray(c.bounds) && c.bounds.length >= 6) {
      const b = c.bounds;
      bounds = bounds
        ? [Math.min(bounds[0], b[0]), Math.min(bounds[1], b[1]), Math.min(bounds[2], b[2]), Math.max(bounds[3], b[3]), Math.max(bounds[4], b[4]), Math.max(bounds[5], b[5])]
        : b.slice();
    }
  }
  return { material: first.material, lightmap: first.lightmap, group: '', bounds, position, uv, uv1, normal, color, index };
}

/** Ground rect [x0, y0, x1, y1] (board space) of every named group of chunks (the scene's switchable parts). */
export function sceneGroupRects(chunks) {
  const out = {};
  for (const c of chunks || []) {
    if (!c.group || !c.bounds) continue;
    const b = c.bounds, r = out[c.group];
    out[c.group] = r ? [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[3]), Math.max(r[3], b[4])] : [b[0], b[1], b[3], b[4]];
  }
  return out;
}

async function fetchBuffer(url) {
  try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.arrayBuffer() : null; } catch { return null; }
}

const sceneCache = new Map();

/** Does the local-art manifest list the official scene of `stageId`? (manifest only) */
export async function sceneListed(assets, stageId) {
  if (!stageId || !assets || typeof assets.local !== 'function' || typeof assets.localUrl !== 'function') return false;
  try { await assets.local(); } catch { return false; }
  return !!assets.localUrl(sceneGroup(stageId), 'scene') && !!assets.localUrl(sceneGroup(stageId), 'bin');
}

/**
 * Load a stage's official scene (scene.json + scene.bin + lightmap pages + the materials' albedo and emission
 * (`images.tex`, sRGB) and normal / metallic-gloss (`images.data`, linear) textures + the reflection atlas
 * `images.env`). A missing texture, lightmap page or atlas only drops that map; a missing or malformed scene
 * gives null (→ the procedural board). scene.json `version` stays the mesh layout (SCENE_VERSION).
 * @returns {Promise<object|null>}
 */
export function loadScenePack(assets, stageId) {
  if (typeof stageId !== 'string' || !stageId) return Promise.resolve(null);
  if (sceneCache.has(stageId)) return sceneCache.get(stageId);
  const pending = (async () => {
    if (!(await sceneListed(assets, stageId)) || typeof assets.image !== 'function') return null;
    const url = (g, n) => { const u = assets.localUrl(g, n); return typeof u === 'string' && u ? encodeURI(u) : null; };
    const group = sceneGroup(stageId);
    const [doc, buf] = await Promise.all([fetchJson(url(group, 'scene')), fetchBuffer(url(group, 'bin'))]);
    if (!isObj(doc) || doc.version !== SCENE_VERSION || !buf) return null;
    const chunks = parseSceneChunks(doc, buf);
    if (!chunks || !chunks.length) return null;
    const img = async (u) => {
      if (!u) return null;
      const i = await assets.image(u, { retry: true }).catch(() => null);
      return i && (i.width || i.naturalWidth) > 0 ? i : null;
    };
    const mats = isObj(doc.materials) ? doc.materials : {};
    const namesOf = (...keys) => [...new Set(Object.values(mats).flatMap((m) => keys.map((k) => (isObj(m) && typeof m[k] === 'string' ? m[k] : null))).filter(Boolean))];
    const names = namesOf('map', 'emissionMap'), dataNames = namesOf('normalMap', 'glossMap');
    const pages = Math.max(0, Math.min(16, doc.lightmaps | 0));
    const [texList, dataList, lm, env] = await Promise.all([
      Promise.all(names.map((n) => img(url(SCENE_TEX_GROUP, n)))),
      Promise.all(dataNames.map((n) => img(url(SCENE_TEX_GROUP, n)))),
      Promise.all(Array.from({ length: pages }, (_, i) => img(url(group, `lm${i}`)))),
      isObj(doc.env) ? img(url(group, 'env')) : null,
    ]);
    const tex = {}, data = {};
    names.forEach((n, i) => { if (texList[i]) tex[n] = texList[i]; });
    dataNames.forEach((n, i) => { if (dataList[i]) data[n] = dataList[i]; });
    return { key: `${url(group, 'scene')}#${doc.binBytes | 0}`, stage: stageId, doc, chunks, groups: sceneGroupRects(chunks), images: { tex, data, lm, env } };
  })().catch((err) => { console.warn('[board3d] scene load failed', err); return null; }).then((pack) => {
    if (!pack && sceneCache.get(stageId) === pending) sceneCache.delete(stageId);
    return pack;
  });
  sceneCache.set(stageId, pending);
  return pending;
}

/** Forget the cached pack and the three.js import attempt (tests / hot reload). */
export function resetBoardPack() { cached = null; threePromise = null; threeFailures = 0; sceneCache.clear(); }
