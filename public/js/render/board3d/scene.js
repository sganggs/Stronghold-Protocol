// render/board3d/scene.js — the official 卫戍协议 board as a real three.js scene (DESIGN §15), rendered on its own
// canvas UNDER the Pixi canvas (units, FX, highlights, HP bars stay in Pixi). One camera model drives both layers:
// render/projection.js `syncThreeCamera` makes the three.js PerspectiveCamera project exactly like the Pixi one.
//
//   const board = new BoardScene(THREE, pack, { canvas, quality })   (pack = load.js loadBoardPack)
//   board.setStage(stage)            geometry from the stage grid (layout.js) + devices + gates + terrain
//   board.setScenePack(id, pack)     the official scene of stage `id` (load.js loadScenePack): drawn instead of the
//                                    procedural tiles and background while that stage is set (null → procedural)
//   board.setArea(rects)             the built areas (layout.js AREAS / areaFor: normal field + pen, 联防, boss)
//   board.setFocus(rect)             the lit field (others fade, animated)
//   board.setBattleRect(rect|null)   crates / turrets inside a running battle are sim units: static ones hide
//   board.createDevice(spec)         → handle { update(cam, { x, y, z, size, height, top, side, alpha, rot }), mesh: null, destroy() }
//                                      (render/units.js DeviceView boxes, drawn as the official crate mesh)
//   board.flashObjective(r, c)       leak flash of a blue objective box
//   board.render(cam, timeSec)       sync the camera, animate, draw
//   board.resize(w, h, dpr) · board.stats() · board.destroy()
//
// Draw calls: board (tiles + blocks + platforms, merged, MT_autochess), the pen's glass hatches (glassMaterial),
// static crates and 射击台 as official models (trap_1105_accrate / trap_1106_achplat, merged, trapMaterial —
// the atlas box / layout.js slab stay the fallbacks without the local art),
// decals (MT_autochess_common), fence pipes, blowers (merged, unlit), gate boxes (additive + alpha, merged per
// material), cyan field edges, terrain overlays (≤ 4), background plane + its shadow catcher — ~12–16 in total.
// An official scene replaces the tiles, glass, decals, pipes and background (all but the device slabs, layout.js
// buckets.raised — GitHub #569) with one mesh per material and lightmap
// page of the parts the built areas show (load.js mergeSceneChunks). Devices, gates, edges and terrain stay.
// The key light's shadow map is rendered only when the geometry changes (autoUpdate off).

import { buildBoard, objToBoard, boxProjectUV, ROWS, COLS, DEVICE_H, AREAS } from './layout.js';
import { surfaceUV } from './atlas.js';
import {
  focusUniforms, makeTexture, boardMaterial, glassMaterial, decalMaterial, pipeMaterial, unlitMaterial, gateMaterial, glowMaterial,
  waterMaterial, mireMaterial, infectionMaterial, smogMaterial, dashTexture, environmentMap, sceneMaterial, sceneWaterDecalMaterial,
  sceneEnvTexture, applyWaterMaterial, trapMaterial,
} from './materials.js';
import { syncThreeCamera } from '../projection.js';
import { mergeSceneChunks, sceneMaterialKey, sceneWaterInfo, isSceneWater } from './load.js';

/** Lighting rig (tuned against the official screenshots: bright even tops, darker sides, soft shadows). */
export const LIGHTING = Object.freeze({
  key: { color: 0xfff1df, intensity: 2.6, dir: [-5.2, -3.4, 10] },
  hemi: { sky: 0xe4ecf4, ground: 0x4a5058, intensity: 0.6 },
  env: 1.0,
  emissive: 0.25,
  roughness: 0.78,
  shadow: { size: 2048, radius: 3, bias: -0.0004, normalBias: 0.025 },
  exposure: 1.0,
  // the clear colour is the fog colour: the far background fades into the void without a visible edge
  clear: 0x0c1114,
  fog: { color: 0x0c1114, near: 17, far: 36 },
  // S_Background_common (100 × 0.4316 = 43.16 tiles); `tiles` × `tiles` mirrored copies around it so no framing
  // (21:9, 4:3, portrait fit, camera flights) sees past its edge
  bg: { z: -8, size: 43.16, color: 0.713, dim: 0.8, tiles: 3 },
});

/**
 * The gate boxes' _TintColor, from the client's 2 s clip (arts/effects/[pack]map.ab, controller `starting`,
 * `UVAnimation`): one renderer red (1, 0, 0) with alpha 0.134 → 0.229 → 0.134, the other blue (0, 0.0897, 1) with alpha
 * 0.16 → 0.097 → 0.16. The alpha-blended part has the material's own (1, 1, 1, 1).
 * [ASSUMED] the clip's renderer paths are hashes that match no name in the bundle: red is read as the start gate,
 * blue as the objective.
 */
export const GATE_TINT = Object.freeze({
  start: { rgb: [1, 0, 0], alpha: [0.134, 0.229] },
  end: { rgb: [0, 0.0897, 1], alpha: [0.16, 0.097] },
  endAb: { rgb: [1, 1, 1], alpha: [1, 1] },
});

/**
 * Gate pulse: a _TintColor.a curve [at 0 s and 2 s, at 1 s] of the 2 s loop. The clip's streamed keys are cubic
 * segments a·x³ + b·x² + c·x + d with flat ends (red: −0.19, 0.285, 0, 0.134 on 0–1 s, then the mirror), i.e. a
 * smoothstep between the two values.
 */
export function gatePulse(t, [from, mid] = GATE_TINT.start.alpha) {
  const u = ((t % 2) + 2) % 2;
  const x = u < 1 ? u : 2 - u;
  return from + (mid - from) * x * x * (3 - 2 * x);
}

/**
 * Is a named part of an official scene (its ground rect [x0, y0, x1, y1]) shown with the built `areas`? The official
 * scene keeps each field as a sub-graphic it switches on (HIDDEN@n: the left / right normal field, the boss field);
 * a part is shown when its centre lies in one of the areas.
 */
export function sceneGroupVisible(rect, areas) {
  if (!Array.isArray(rect) || rect.length < 4) return true;
  const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
  return (areas || []).some((a) => cx >= a.c0 - 0.5 && cx <= a.c1 + 0.5 && cy >= a.r0 - 0.5 && cy <= a.r1 + 0.5);
}

const areaKey = (list) => (list || []).map((a) => `${a.r0},${a.r1},${a.c0},${a.c1}`).sort().join(';');

const mergeInto = (list) => {
  // concatenate { position, normal, uv, color?, index } records
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.position.length / 3; ni += g.index.length; }
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), color = new Float32Array(nv * 3);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const n = g.position.length / 3;
    position.set(g.position, vo * 3);
    if (g.normal) normal.set(g.normal, vo * 3);
    if (g.uv) uv.set(g.uv, vo * 2);
    if (g.color) color.set(g.color, vo * 3); else color.fill(1, vo * 3, (vo + n) * 3);
    for (let i = 0; i < g.index.length; i++) index[io + i] = g.index[i] + vo;
    vo += n; io += g.index.length;
  }
  return { position, normal, uv, color, index };
};

/** Apply a 4×4-free transform (scale s, rotate about z by `rot` quarter turns, translate) to board-space data. */
function placeMesh(src, { x = 0, y = 0, z = 0, s = 1, sz = s, rot = 0 }) {
  const p = src.position, n = src.normal;
  const pos = new Float32Array(p.length), nrm = n ? new Float32Array(n.length) : null;
  const a = rot * Math.PI / 2, ca = Math.round(Math.cos(a)), sa = Math.round(Math.sin(a));
  for (let i = 0; i < p.length; i += 3) {
    const px = p[i] * s, py = p[i + 1] * s;
    pos[i] = x + px * ca - py * sa; pos[i + 1] = y + px * sa + py * ca; pos[i + 2] = z + p[i + 2] * sz;
    if (nrm) { nrm[i] = n[i] * ca - n[i + 1] * sa; nrm[i + 1] = n[i] * sa + n[i + 1] * ca; nrm[i + 2] = n[i + 2]; }
  }
  return { ...src, position: pos, normal: nrm };
}

/**
 * Grow a textured plane `k`× about (cx, cy) keeping its texel density: positions scale by k, UVs scale by k about
 * the texture centre (0..1 → (1−k)/2..(1+k)/2), so a MirroredRepeat texture tiles seamlessly around the original.
 */
export function extendPlane(src, cx, cy, k = 1) {
  if (!(k > 1) || !src || !src.position) return src;
  const p = src.position, pos = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) { pos[i] = cx + (p[i] - cx) * k; pos[i + 1] = cy + (p[i + 1] - cy) * k; pos[i + 2] = p[i + 2]; }
  let uv = src.uv;
  if (uv) { uv = new Float32Array(src.uv.length); for (let i = 0; i < uv.length; i++) uv[i] = 0.5 + (src.uv[i] - 0.5) * k; }
  return { ...src, position: pos, uv };
}

/** Quarter turns (counter-clockwise about +z) that point the wind device's outlet (−x in the mesh) along `dir`. */
export const DIR_TURNS = Object.freeze({ LEFT: 0, DOWN: 1, RIGHT: 2, UP: 3 });

export class BoardScene {
  /**
   * @param {any} THREE three.js module
   * @param {any} pack load.js loadBoardPack result
   * @param {{ canvas?: HTMLCanvasElement, quality?: string, antialias?: boolean, renderer?: any }} [opts]
   */
  constructor(THREE, pack, opts = {}) {
    this.THREE = THREE;
    this.pack = pack;
    this.opts = opts;
    this.destroyed = false;
    this.lost = false;
    const T = THREE;
    this.renderer = opts.renderer || new T.WebGLRenderer({
      canvas: opts.canvas, antialias: opts.antialias ?? true, alpha: false, stencil: false, depth: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    });
    const R = this.renderer;
    R.outputColorSpace = T.SRGBColorSpace;
    R.toneMapping = T.NoToneMapping;
    R.setClearColor(LIGHTING.clear, 1);
    R.shadowMap.enabled = opts.shadows !== false;
    R.shadowMap.type = T.PCFShadowMap;
    R.shadowMap.autoUpdate = false;
    this.canvas = R.domElement;
    this._onLost = (e) => { e.preventDefault?.(); this.lost = true; };
    this.canvas.addEventListener?.('webglcontextlost', this._onLost);

    this.scene = new T.Scene();
    this.scene.fog = new T.Fog(LIGHTING.fog.color, LIGHTING.fog.near, LIGHTING.fog.far);
    this.camera = new T.PerspectiveCamera(40, 16 / 9, 0.5, 120);
    this.focus = focusUniforms(T);
    this.envMap = null;
    this.envRT = null;
    if (opts.environment !== false) {
      try {
        this.envMap = environmentMap(T, R);
        this.envRT = this.envMap?.userData?.pmremTarget || null;
        if (this.envMap) {
          this.scene.environment = this.envMap;
          this.scene.environmentIntensity = LIGHTING.env;
          this.scene.environmentRotation?.set?.(-Math.PI / 2, 0, 0);
        }
      } catch { this.envMap = null; this.envRT = null; }
    }
    this.focusTarget = null;
    const aniso = Math.min(8, R.capabilities?.getMaxAnisotropy?.() || 1);
    const img = pack?.images || {};
    this.tex = {
      D: makeTexture(T, img.D, { aniso }), N: makeTexture(T, img.N, { srgb: false, aniso }), R: makeTexture(T, img.R, { srgb: false, aniso }),
      E: makeTexture(T, img.E, { aniso }), common: makeTexture(T, img.common, { aniso }), commonE: makeTexture(T, img.commonE, { aniso }),
      BG: makeTexture(T, img.BG, { aniso }), wind: makeTexture(T, img.wind, { aniso }), gate: makeTexture(T, img.gate, { srgb: false }),
      waterN: makeTexture(T, img.waterN, { srgb: false, repeat: true }), caustics: makeTexture(T, img.caustics, { srgb: false, repeat: true }),
      noise: makeTexture(T, img.noise, { srgb: false, repeat: true }),
      platform: makeTexture(T, img.platform, { aniso }),
      crate: makeTexture(T, img.crate, { aniso }),
    };
    if (this.tex.BG) { this.tex.BG.wrapS = T.MirroredRepeatWrapping; this.tex.BG.wrapT = T.MirroredRepeatWrapping; }
    this.mat = {
      board: boardMaterial(T, this.tex, this.focus, { emissive: LIGHTING.emissive, roughness: LIGHTING.roughness }),
      glass: glassMaterial(T, this.tex, this.focus, { emissive: LIGHTING.emissive, roughness: LIGHTING.roughness }),
      decal: this.tex.common ? decalMaterial(T, this.tex, this.focus) : null,
      pipe: pipeMaterial(T, this.focus),
      bg: this.tex.BG ? unlitMaterial(T, this.tex.BG, new T.Color().setScalar(LIGHTING.bg.color * LIGHTING.bg.dim)) : new T.MeshBasicMaterial({ color: 0x1a1d1f }),
      wind: this.tex.wind ? unlitMaterial(T, this.tex.wind) : null,
      gateStartAdd: this.tex.gate ? gateMaterial(T, this.tex.gate, { additive: true, tint: GATE_TINT.start.rgb }) : null,
      gateEndAdd: this.tex.gate ? gateMaterial(T, this.tex.gate, { additive: true, tint: GATE_TINT.end.rgb }) : null,
      gateEndAb: this.tex.gate ? gateMaterial(T, this.tex.gate, { additive: false, tint: GATE_TINT.endAb.rgb }) : null,
      edge: glowMaterial(T, dashTexture(T)),
      water: waterMaterial(T, this.tex, this.focus),
      mire: mireMaterial(T, this.tex, this.focus),
      infection: infectionMaterial(T, this.tex, this.focus),
      smog: smogMaterial(T, this.tex, this.focus),
      shadowCatcher: new T.ShadowMaterial({ opacity: 0.32, color: 0x000000 }),
      platform: this.tex.platform ? trapMaterial(T, this.tex.platform, this.focus, pack?.materials?.trap?.MT_trap_1106_achplat || null, LIGHTING.key.dir) : null,
      crate: this.tex.crate ? trapMaterial(T, this.tex.crate, this.focus, pack?.materials?.trap?.MT_trap_1105_accrate
        || { floats: { _Ambient: 0.809, _Diffuse: 0.271 } }, LIGHTING.key.dir) : null,
    };
    // lights
    const hemi = new T.HemisphereLight(LIGHTING.hemi.sky, LIGHTING.hemi.ground, LIGHTING.hemi.intensity);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const key = new T.DirectionalLight(LIGHTING.key.color, LIGHTING.key.intensity);
    key.castShadow = R.shadowMap.enabled;
    key.shadow.mapSize.set(LIGHTING.shadow.size, LIGHTING.shadow.size);
    key.shadow.radius = LIGHTING.shadow.radius;
    key.shadow.bias = LIGHTING.shadow.bias;
    key.shadow.normalBias = LIGHTING.shadow.normalBias;
    this.scene.add(key, key.target);
    this.key = key;
    this.hemi = hemi;
    // static board geometry (rebuilt by setStage / setArea) and the battle device meshes (owned by render/units.js
    // DeviceView handles: they must survive a rebuild — a camera flight between areas rebuilds mid-battle)
    this.root = new T.Group();
    this.dynamic = new T.Group();
    this.scene.add(this.root, this.dynamic);
    this.stageKey = null;
    this.stage = null;
    this.scenePacks = new Map();   // stage id → official scene pack (setScenePack)
    this.sceneRes = new Map();     // pack key → { tex, lm, mats } GPU resources (kept across rebuilds)
    this.official = null;
    this.sceneWater = [];
    this.area = AREAS.normal;
    this.areaKey = areaKey(AREAS.normal);
    this.battleRect = null;
    this.devices = new Set();
    this.flashes = [];
    this.time = 0;
    this.size = { w: 1, h: 1, dpr: 1 };
    this.camVersion = -1;
    this.camRef = null;
    this.frames = 0;
    this.lastMs = 0;
    this._crateGeom = undefined;
    this._boxGeom = null;
    this._platformGeom = undefined;
  }

  // ---- geometry ----------------------------------------------------------------------------------------------

  _geometry(data) {
    const T = this.THREE;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(data.position, 3));
    if (data.normal) g.setAttribute('normal', new T.BufferAttribute(data.normal, 3));
    if (data.uv) g.setAttribute('uv', new T.BufferAttribute(data.uv, 2));
    if (data.color) g.setAttribute('color', new T.BufferAttribute(data.color, 3));
    g.setIndex(new T.BufferAttribute(data.index, 1));
    if (!data.normal) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  _mesh(data, material, { cast = true, receive = true, order = 0 } = {}) {
    if (!data || !material || !(data.index?.length > 0)) return null;
    const m = new this.THREE.Mesh(this._geometry(data), material);
    m.castShadow = cast; m.receiveShadow = receive; m.renderOrder = order;
    m.matrixAutoUpdate = false; m.updateMatrix();
    this.root.add(m);
    return m;
  }

  _clear() {
    for (const ch of [...this.root.children]) {
      this.root.remove(ch);
      ch.traverse?.((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.meshes = {};
  }

  /** The old atlas box: kept for mounds and missing-art installs (including the procedural-box fallback). */
  boxGeometry() {
    if (this._boxGeom) return this._boxGeom;
    const uv = this.pack?.uv || {};
    const obj = this.pack?.meshes?.box;
    let base;
    if (obj && obj.normal) base = objToBoard(obj, 0.01);
    else base = boxData(0.9, 0.675);
    this._boxGeom = boxProjectUV(base, uv.crateTop || { src: 'D', rect: [1222, 1938, 134, 108] }, uv.crateSide || { src: 'D', rect: [1087, 1938, 134, 108] });
    this._boxGeom.color = null;
    return this._boxGeom;
  }

  /**
   * 阻隔工事: battle prefab Graphic/Mesh/trap_1105_accrate has identity parents, X rotation −90°, scale 0.01.
   * Undo OBJ's mirrored X, apply that rotation, then battle −z → board height: (−x, z, y) × 0.01 = objToBoard.
   * Keep the authored UVs and pivot (base ~0.002, top ~0.838, footprint ~1.013 × 1.019 tiles), no recentering.
   */
  clientCrateGeometry() {
    if (this._crateGeom !== undefined) return this._crateGeom;
    const obj = this.pack?.meshes?.crate;
    this._crateGeom = obj?.normal && obj?.uv && this.mat.crate ? objToBoard(obj, 0.01) : null;
    return this._crateGeom;
  }

  crateGeometry() { return this.clientCrateGeometry() || this.boxGeometry(); }

  /** DeviceView's dimensions follow the active model; 2D and missing-art boxes keep their old spec. */
  deviceSpec(spec) {
    if (spec?.top !== 'crateTop' || !this.clientCrateGeometry()) return spec;
    if (!this._crateSpec) {
      const { min, max } = this.pack.meshes.crate.bounds;
      this._crateSpec = { ...spec, size: (max[0] - min[0]) * 0.01, height: max[1] * 0.01 };
    }
    return this._crateSpec;
  }

  /**
   * The official 射击台 model in board space (trap_1106_achplat at its prefab scale 0.01: 1.05 tiles square, 0.465
   * high — render/style.js TILE_H.platform is its top), or null without the local art (layout.js draws the slab).
   */
  platformGeometry() {
    if (this._platformGeom !== undefined) return this._platformGeom;
    const obj = this.pack?.meshes?.platform;
    this._platformGeom = obj && obj.normal && obj.uv && this.mat.platform ? objToBoard(obj, 0.01) : null;
    return this._platformGeom;
  }

  /** Built areas (inclusive tile rects): rebuilds when they change. */
  setArea(rects) {
    const list = Array.isArray(rects) && rects.length ? rects : AREAS.normal;
    const k = areaKey(list);
    if (k === this.areaKey) return false;
    this.area = list;
    this.areaKey = k;
    if (this.stage) { this.stageKey = null; this.setStage(this.stage); }
    return true;
  }

  /** Rebuild everything for a stage (no-op when the same stage object/grid is set again). */
  setStage(stage) {
    if (this.destroyed) return;
    const official = stage ? this.scenePacks.get(stage.id) || null : null;
    const key = stage ? `${stage.id || ''}|${official ? official.key : ''}|${(stage.rows || []).join('/')}|${JSON.stringify((stage.devices || []).map((d) => [d.key, d.pos, d.active, d.dir]))}` : '';
    if (key === this.stageKey) return;
    this.stageKey = key;
    this.stage = stage || null;
    this._clear();
    this.sceneWater = [];
    this.official = null;
    if (!stage) { applyWaterMaterial(this.mat.water, null); return; }
    const board = buildBoard(stage, { uv: this.pack?.uv || null, area: this.area, platformMesh: !!this.platformGeometry() });
    this.board = board;
    const M = this.meshes = {};
    this.official = official && this._buildScene(official) ? official : null;
    // Apply only the active, successfully built pack: preloading another stage must not recolour this board.
    // setScenePack rebuilds the current stage, so replacement/removal also restores parameters and cube defines.
    const waterPack = this.official;
    applyWaterMaterial(this.mat.water, sceneWaterInfo(waterPack?.doc), waterPack ? {
      env: this._sceneResources(waterPack).env, envRange: waterPack.doc?.env?.range, envMips: waterPack.doc?.env?.mips,
    } : {});
    if (!this.official) {
      M.board = this._mesh(board.buckets.board, this.mat.board);
      M.glass = this._mesh(board.buckets.glass, this.mat.glass);
      M.decal = this._mesh(board.buckets.decal, this.mat.decal, { cast: false });
      M.pipe = this._mesh(board.buckets.pipe, this.mat.pipe);
    } else {
      // the scene has no device slabs: the 特制水上平台 / 封印的地面 slabs (and the 射击台's without its model) stay
      // drawn on it (units stand on them at tiles.js heightAt; GitHub #569)
      M.raised = this._mesh(board.buckets.raised, this.mat.board);
      M.raisedDecal = this._mesh(board.buckets.raisedDecal, this.mat.decal, { cast: false });
    }
    this._buildDevices(board);
    this._buildGates(board);
    this._buildEdges(board);
    this._buildTerrain(board);
    if (!this.official) this._buildBackground(board);
    this._fitShadow(board);
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Use (or drop, with null) the official scene of stage `id`; rebuilds when that stage is the current one. */
  setScenePack(id, pack) {
    if (this.destroyed || typeof id !== 'string' || !id) return false;
    const prev = this.scenePacks.get(id) || null;
    if (prev === (pack || null)) return false;
    if (prev) this._disposeScene(prev);
    if (pack) this.scenePacks.set(id, pack); else this.scenePacks.delete(id);
    if (this.stage && this.stage.id === id) { this.stageKey = null; this.setStage(this.stage); }
    return true;
  }

  /** Textures and materials of a scene pack (created once per pack, kept across rebuilds). */
  _sceneResources(pack) {
    let res = this.sceneRes.get(pack.key);
    if (res) return res;
    const T = this.THREE;
    const aniso = Math.min(8, this.renderer.capabilities?.getMaxAnisotropy?.() || 1);
    const tex = {}, data = {}, lm = [];
    for (const [name, img] of Object.entries(pack.images?.tex || {})) tex[name] = makeTexture(T, img, { aniso, repeat: true });
    for (const [name, img] of Object.entries(pack.images?.data || {})) data[name] = makeTexture(T, img, { srgb: false, aniso, repeat: true });
    for (const img of pack.images?.lm || []) lm.push(img ? makeTexture(T, img, { srgb: false }) : null);
    res = { tex, data, lm, env: sceneEnvTexture(T, pack.images?.env, pack.doc?.env), mats: new Map() };
    this.sceneRes.set(pack.key, res);
    return res;
  }

  _disposeScene(pack) {
    const res = this.sceneRes.get(pack.key);
    if (!res) return;
    for (const m of res.mats.values()) m.dispose();
    for (const t of [...Object.values(res.tex), ...Object.values(res.data), ...res.lm, res.env]) t?.dispose?.();
    this.sceneRes.delete(pack.key);
  }

  /**
   * The official scene's meshes: the base plus the fields of the built areas, one mesh per material and lightmap
   * page (`mergeSceneChunks`). A switched-off HIDDEN part is left out before the merge.
   */
  _buildScene(pack) {
    const T = this.THREE;
    const res = this._sceneResources(pack);
    const infos = pack.doc?.materials || {};
    this.sceneWater = [];
    const buckets = new Map();
    for (const c of pack.chunks || []) {
      if (c.group && !sceneGroupVisible(pack.groups?.[c.group], this.area)) continue;
      const info = infos[c.material] || null;
      const mk = sceneMaterialKey(c, info);
      let bucket = buckets.get(mk);
      if (!bucket) { bucket = { info, chunks: [] }; buckets.set(mk, bucket); }
      bucket.chunks.push(c);
    }
    let n = 0;
    for (const [mk, bucket] of buckets) {
      const c = mergeSceneChunks(bucket.chunks);
      const info = bucket.info;
      const surface = isSceneWater(info, c.material);
      const water = surface || info?.kind === 'water';
      let mat = res.mats.get(mk);
      if (!mat) {
        mat = surface
          ? waterMaterial(T, this.tex, this.focus, info, { env: res.env, envRange: pack.doc?.env?.range, envMips: pack.doc?.env?.mips })
          : water ? sceneWaterDecalMaterial(T, this.tex, this.focus, info)
          : sceneMaterial(T, {
            map: res.tex[info?.map] || null, lightMap: c.lightmap >= 0 ? (res.lm[c.lightmap] || null) : null, info,
            light: pack.doc?.light || null, lightRange: pack.doc?.lightRange, lightEncoding: pack.doc?.lightEncoding,
            normalMap: res.data[info?.normalMap] || null, glossMap: res.data[info?.glossMap] || null,
            // sRGB. sceneMaterial samples it only when _EMISSION is on, so a map without the keyword stays unlit.
            emissionMap: res.tex[info?.emissionMap] || null,
            env: res.env, envRange: pack.doc?.env?.range,
          }, this.focus);
        res.mats.set(mk, mat);
      }
      if (water) this.sceneWater.push(mat);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(c.position, 3));
      g.setAttribute('normal', new T.BufferAttribute(c.normal, 4, true));
      g.setAttribute('uv', new T.BufferAttribute(c.uv, 2));
      g.setAttribute('aLm', new T.BufferAttribute(c.uv1, 2));
      g.setAttribute('aColor', new T.BufferAttribute(c.color, 4, true));
      g.setIndex(new T.BufferAttribute(c.index, 1));
      g.computeBoundingSphere();
      const mesh = new T.Mesh(g, mat);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.renderOrder = water ? 1 : mat.userData.blend === 'blend' ? 2 : mat.userData.blend === 'cutout' ? -3 : -4;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.root.add(mesh);
      this.meshes[`scene${n++}`] = mesh;
    }
    return n > 0;
  }

  _buildDevices(board) {
    const crates = [], blowers = [], platforms = [];
    this.staticCrates = [];
    const wind = this.pack?.meshes?.blower ? objToBoard(this.pack.meshes.blower, 1) : null;
    const plat = this.platformGeometry();
    for (const mat of [this.mat.platform, this.mat.crate]) if (mat) {
      // lit by the official scene's own key light when one is drawn, else by the procedural board's
      const dir = this.official?.doc?.light?.dir;
      mat.uniforms.uLightDir.value.set(...(Array.isArray(dir) && dir.length === 3 ? dir : LIGHTING.key.dir)).normalize();
    }
    for (const d of board.devices) {
      if (d.kind === 'crate') this.staticCrates.push(d);
      else if (d.kind === 'platform' && plat) platforms.push(placeMesh(plat, { x: d.c, y: d.r, z: d.z0 }));
      else if (d.kind === 'blower' && wind && this.mat.wind) blowers.push(placeMesh(wind, { x: d.c, y: d.r, z: d.z0 + 0.078, rot: DIR_TURNS[d.dir] ?? 0 }));
      else if (d.kind === 'blower' || d.kind === 'turret') crates.push(placeMesh(boxWithTop(this.pack?.uv, d.kind), { x: d.c, y: d.r, z: d.z0 }));
      else if (d.kind === 'mound') crates.push(placeMesh(this.boxGeometry(), { x: d.c, y: d.r, z: d.z0, s: 0.95, sz: 0.55 }));
      else if (d.kind === 'bush') crates.push(placeMesh(bushData(), { x: d.c, y: d.r, z: d.z0 }));
    }
    if (blowers.length) this.meshes.blowers = this._mesh(mergeInto(blowers), this.mat.wind, { receive: false });
    if (crates.length) this.meshes.props = this._mesh(mergeInto(crates), this.mat.board);
    if (platforms.length) this.meshes.platforms = this._mesh(mergeInto(platforms), this.mat.platform);
    this._rebuildCrates();
  }

  _rebuildCrates() {
    if (this.meshes.crates) { this.root.remove(this.meshes.crates); this.meshes.crates.geometry.dispose(); this.meshes.crates = null; }
    const R = this.battleRect;
    const inside = (d) => !!R && d.r >= R.r0 && d.r <= R.r1 && d.c >= R.c0 && d.c <= R.c1;
    const list = (this.staticCrates || []).filter((d) => !inside(d)).map((d) => placeMesh(this.crateGeometry(), { x: d.c, y: d.r, z: d.z0 }));
    if (list.length) this.meshes.crates = this._mesh(mergeInto(list), this.clientCrateGeometry() ? this.mat.crate : this.mat.board);
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Battle rect (null in prep): static crates inside it are hidden (the sim spawns them as device units). */
  setBattleRect(rect) {
    const next = rect ? { r0: rect.r0, r1: rect.r1, c0: rect.c0, c1: rect.c1 } : null;
    if (JSON.stringify(next) === JSON.stringify(this.battleRect)) return;
    this.battleRect = next;
    if (this.board) this._rebuildCrates();
  }

  _buildGates(board) {
    const G = this.pack?.meshes?.gate || {};
    if (!this.tex.gate) return;
    const place = (slot) => {
      const rec = G[slot];
      if (!rec) return null;
      return objToBoard(rec.mesh, 0.01);
    };
    const parts = { startDown: place('startDown'), startUp: place('startUp'), startBack: place('startBack'), endDown: place('endDown'), endUp: place('endUp') };
    const startAdd = [], endAdd = [], endAb = [];
    for (const g of board.gates) {
      // the tile effect's prefab rotation (0, .707, −.707, 0) maps the mesh to (x', −z', y') of the exported OBJ:
      // objToBoard's frame turned half a turn — the warning glyph on the top face points north (the official look)
      const at = { x: g.c, y: g.r, z: g.z + 0.5 + 0.003, rot: 2 };
      if (g.kind === 'start') for (const k of ['startDown', 'startUp', 'startBack']) { if (parts[k]) startAdd.push(placeMesh(parts[k], at)); }
      else {
        if (parts.endDown) endAdd.push(placeMesh(parts.endDown, at));
        if (parts.endUp) endAb.push(placeMesh(parts.endUp, at));
      }
    }
    const opt = { cast: false, receive: false, order: 5 };
    if (startAdd.length) this.meshes.gateStart = this._mesh(mergeInto(startAdd), this.mat.gateStartAdd, opt);
    if (endAdd.length) this.meshes.gateEndAdd = this._mesh(mergeInto(endAdd), this.mat.gateEndAdd, opt);
    if (endAb.length) this.meshes.gateEndAb = this._mesh(mergeInto(endAb), this.mat.gateEndAb, { ...opt, order: 4 });
  }

  _buildEdges(board) {
    const pos = [], uv = [], idx = [];
    const w = 0.085, e = 0.018;
    for (const s of board.edges) {
      const x0 = s.c - 0.5, x1 = s.c + 0.5, y0 = s.r - 0.5, y1 = s.r + 0.5, z = s.z + 0.006;
      let q;
      switch (s.dir) {
        case 'S': q = [[x0, y0 + e, z], [x1, y0 + e, z], [x1, y0 + e + w, z], [x0, y0 + e + w, z]]; break;
        case 'N': q = [[x1, y1 - e, z], [x0, y1 - e, z], [x0, y1 - e - w, z], [x1, y1 - e - w, z]]; break;
        case 'E': q = [[x1 - e, y0, z], [x1 - e, y1, z], [x1 - e - w, y1, z], [x1 - e - w, y0, z]]; break;
        default: q = [[x0 + e, y1, z], [x0 + e, y0, z], [x0 + e + w, y0, z], [x0 + e + w, y1, z]]; break;
      }
      const b = pos.length / 3;
      for (const p of q) pos.push(...p);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      // winding: all strips face up
      const n = [(q[1][0] - q[0][0]) * (q[3][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[3][0] - q[0][0])];
      if (n[0] >= 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    if (!pos.length) return;
    const nrm = new Float32Array(pos.length); for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1;
    this.meshes.edges = this._mesh({ position: new Float32Array(pos), normal: nrm, uv: new Float32Array(uv), color: null, index: new Uint16Array(idx) }, this.mat.edge, { cast: false, receive: false, order: 3 });
  }

  _buildTerrain(board) {
    const quads = (tiles, z, inset = 0) => {
      const pos = [], uv = [], idx = [];
      for (const [r, c] of tiles) {
        const a = 0.5 - inset, b = pos.length / 3;
        pos.push(c - a, r - a, z, c + a, r - a, z, c + a, r + a, z, c - a, r + a, z);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const nrm = new Float32Array(pos.length); for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1;
      return { position: new Float32Array(pos), normal: nrm, uv: new Float32Array(uv), color: null, index: new Uint16Array(idx) };
    };
    const T = board.terrain;
    const opt = { cast: false, receive: false, order: 2 };
    if (T.water.length) this.meshes.water = this._mesh(quads(T.water, -0.035), this.mat.water, opt);
    if (T.mire.length) this.meshes.mire = this._mesh(quads(T.mire, 0.006, 0.02), this.mat.mire, opt);
    // The infection (活性源石) glow is our own flat patch; an official scene already carries that floor in its own
    // geometry and textures, so drawing ours on top just overlaps it (#549).
    if (T.infection.length && !this.official) this.meshes.infection = this._mesh(quads(T.infection, 0.007, 0.02), this.mat.infection, opt);
    if (T.smog.length) {
      // two crossed haze cards per grille tile, standing up
      const pos = [], uv = [], idx = [];
      for (const [r, c] of T.smog) {
        for (const [dx, dy] of [[1, 0], [0.7, 0.7]]) {
          const b = pos.length / 3, h = 0.95, w = 0.55;
          pos.push(c - dx * w, r - dy * w, 0.02, c + dx * w, r + dy * w, 0.02, c + dx * w, r + dy * w, h, c - dx * w, r - dy * w, h);
          uv.push(0, 0, 1, 0, 1, 1, 0, 1);
          idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
      }
      const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = -1;
      this.meshes.smog = this._mesh({ position: new Float32Array(pos), normal: nrm, uv: new Float32Array(uv), color: null, index: new Uint16Array(idx) }, this.mat.smog, { ...opt, order: 6 });
    }
  }

  _buildBackground(board) {
    const T = this.THREE;
    const B = LIGHTING.bg;
    const cx = (COLS - 1) / 2, cy = (ROWS - 1) / 2;
    let plane = null;
    const obj = this.pack?.meshes?.bgPlane;
    if (obj) plane = objToBoard(obj, B.size / 100);
    const data = plane || { position: new Float32Array([-B.size / 2, -B.size / 2, 0, B.size / 2, -B.size / 2, 0, B.size / 2, B.size / 2, 0, -B.size / 2, B.size / 2, 0]), normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), index: new Uint16Array([0, 1, 2, 0, 2, 3]) };
    const placed = extendPlane(placeMesh(data, { x: cx, y: cy, z: B.z }), cx, cy, B.tiles);
    // the plane may face either way after the axis swap: make it face up
    if (placed.normal && placed.normal[2] < 0) {
      for (let i = 0; i < placed.normal.length; i++) placed.normal[i] = -placed.normal[i];
      const ix = placed.index;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    }
    this.meshes.bg = this._mesh({ ...placed, color: null }, this.mat.bg, { cast: false, receive: false, order: -2 });
    // the key light's shadow of the island on the ground far below (S_Background_shadow's role)
    const s = B.size;
    const q = { position: new Float32Array([cx - s / 2, cy - s / 2, B.z + 0.02, cx + s / 2, cy - s / 2, B.z + 0.02, cx + s / 2, cy + s / 2, B.z + 0.02, cx - s / 2, cy + s / 2, B.z + 0.02]), normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), color: null, index: new Uint16Array([0, 1, 2, 0, 2, 3]) };
    this.meshes.bgShadow = this._mesh(q, this.mat.shadowCatcher, { cast: false, receive: true, order: -1 });
    void T;
  }

  _fitShadow(board) {
    const k = this.key;
    const b = (board && board.bounds) || {};
    // [ASSUMED] an empty or non-finite board box (no tiles yet) centres the shadow camera at the origin
    // with a 30-tile span. A finite box keeps the previous centre and span.
    const finite = [b.x0, b.x1, b.y0, b.y1].every((v) => Number.isFinite(v));
    const cx = finite ? (b.x0 + b.x1) / 2 : 0;
    const cy = finite ? (b.y0 + b.y1) / 2 : 0;
    const span = finite ? Math.max(b.x1 - b.x0, b.y1 - b.y0) : 30;
    const d = LIGHTING.key.dir;
    const len = Math.hypot(d[0], d[1], d[2]);
    const dist = 30;
    k.position.set(cx + (d[0] / len) * dist, cy + (d[1] / len) * dist, (d[2] / len) * dist);
    k.target.position.set(cx, cy, 0);
    k.target.updateMatrixWorld();
    const cam = k.shadow.camera;
    // light-space box covering the island and its shadow on the background plane
    const half = span / 2 + 9;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 1; cam.far = dist + 30;
    cam.updateProjectionMatrix();
    k.updateMatrixWorld();
  }

  // ---- dynamic devices (battle) ------------------------------------------------------------------------------

  /** A crate / device box driven by render/units.js DeviceView (see header). */
  createDevice(spec = { top: 'crateTop' }) {
    const T = this.THREE;
    const self = this;
    const clientCrate = spec.top === 'crateTop' && this.clientCrateGeometry();
    const geom = this._geometry({ ...(clientCrate || this.boxGeometry()), color: null });
    const source = clientCrate ? this.mat.crate : this.mat.board;
    const mat = source.clone();
    mat.transparent = true;
    mat.vertexColors = false;
    // Keep focus and scene light live across stage / camera rebuilds; opacity belongs to this device alone.
    if (clientCrate) Object.assign(mat.uniforms, this.focus, { uMap: source.uniforms.uMap, uLightDir: source.uniforms.uLightDir });
    else mat.onBeforeCompile = source.onBeforeCompile;
    const mesh = new T.Mesh(geom, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.dynamic.add(mesh);
    geom.computeBoundingBox();
    const { min, max } = geom.boundingBox;
    const baseSize = Math.max(0.01, max.x - min.x), baseH = Math.max(0.01, clientCrate ? max.z : max.z - min.z);
    let dead = false;
    const h = {
      mesh: null,
      board: this,
      get destroyed() { return dead; },
      update(cam, b) {
        if (!b || dead) return;
        mesh.visible = (b.alpha ?? 1) > 0.01;
        mesh.position.set(b.x, b.y, b.z);
        const s = (b.size || baseSize) / baseSize;
        mesh.scale.set(s, s, Math.max(0.001, (b.height ?? baseH) / baseH));
        mat.opacity = Math.max(0, Math.min(1, b.alpha ?? 1));
        if (clientCrate) mat.uniforms.uOpacity.value = mat.opacity;
        mat.depthWrite = mat.opacity > 0.98;
      },
      destroy() {
        if (dead) return;
        dead = true;
        self.dynamic.remove(mesh); geom.dispose(); mat.dispose(); self.devices.delete(h);
        if (!self.destroyed) self.renderer.shadowMap.needsUpdate = true;
      },
    };
    this.devices.add(h);
    this.renderer.shadowMap.needsUpdate = true;
    return h;
  }

  /** Red leak flash on the objective box at (r, c). */
  flashObjective(r, c) {
    this.flashes.push({ r, c, t: 0 });
    if (this.flashes.length > 8) this.flashes.shift();
  }

  // ---- view ------------------------------------------------------------------------------------------------------

  /** The lit field rect ({ r0, r1, c0, c1 } tiles; null = everything lit). Animated in render(). */
  setFocus(rect) {
    this.focusTarget = rect ? [rect.c0 - 0.5, rect.r0 - 0.5, rect.c1 + 0.5, rect.r1 + 0.5] : [-50, -50, 70, 70];
  }

  /** Settings quality change: 'low' drops the key light's shadow (antialias is fixed at context creation). */
  setQuality(q) {
    const on = q !== 'low';
    const R = this.renderer;
    if (R.shadowMap.enabled === on && this.key.castShadow === on) return false;
    R.shadowMap.enabled = on;
    this.key.castShadow = on;
    R.shadowMap.needsUpdate = true;
    return true;
  }

  resize(w, h, dpr = 1) {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    if (W === this.size.w && H === this.size.h && dpr === this.size.dpr) return;
    this.size = { w: W, h: H, dpr };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(W, H, false);
    this.camVersion = -1;
  }

  /** Draw a frame with projection camera `cam` at time `t` (seconds). */
  render(cam, t = 0) {
    if (this.destroyed || this.lost || !cam) return false;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const dt = Math.max(0, Math.min(0.1, t - this.time));
    this.time = t;
    if (cam !== this.camRef || cam.version !== this.camVersion) {
      this.camRef = cam; this.camVersion = cam.version;
      syncThreeCamera(cam, this.camera, this.size.w, this.size.h, { near: Math.max(0.3, cam.dist * 0.08), far: cam.dist + 70 });
    }
    // focus falloff (eased)
    const F = this.focus.uFocus.value;
    if (this.focusTarget) {
      const k = Math.min(1, dt * 5);
      const tg = this.focusTarget;
      if (Math.abs(F.x - tg[0]) + Math.abs(F.y - tg[1]) + Math.abs(F.z - tg[2]) + Math.abs(F.w - tg[3]) > 40) F.set(tg[0], tg[1], tg[2], tg[3]);
      else F.set(F.x + (tg[0] - F.x) * k, F.y + (tg[1] - F.y) * k, F.z + (tg[2] - F.z) * k, F.w + (tg[3] - F.w) * k);
    }
    // gate pulses (the official clip's _TintColor.a curves), objective leak flashes
    if (this.mat.gateStartAdd) this.mat.gateStartAdd.uniforms.uAlpha.value = gatePulse(t, GATE_TINT.start.alpha);
    if (this.mat.gateEndAdd) this.mat.gateEndAdd.uniforms.uAlpha.value = gatePulse(t, GATE_TINT.end.alpha);
    if (this.mat.gateEndAb) this.mat.gateEndAb.uniforms.uAlpha.value = gatePulse(t, GATE_TINT.endAb.alpha);
    let flash = 0;
    for (let i = this.flashes.length - 1; i >= 0; i--) { const f = this.flashes[i]; f.t += dt; if (f.t > 1.2) this.flashes.splice(i, 1); else flash = Math.max(flash, 1 - f.t / 1.2); }
    for (const m of [this.mat.gateEndAdd, this.mat.gateEndAb]) if (m) m.uniforms.uFlash.value.setRGB(flash, flash * 0.12, flash * 0.1);
    for (const k of ['water', 'mire', 'infection', 'smog']) this.mat[k].uniforms.uTime.value = t;
    if (this.official) for (const m of this.sceneWater || []) m.uniforms.uTime.value = t;
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (t0) this.lastMs = this.lastMs * 0.9 + ((typeof performance !== 'undefined' ? performance.now() : t0) - t0) * 0.1;
    return true;
  }

  stats() {
    const info = this.renderer.info;
    return { calls: info?.render?.calls ?? 0, triangles: info?.render?.triangles ?? 0, textures: info?.memory?.textures ?? 0, geometries: info?.memory?.geometries ?? 0, frames: this.frames, cpuMs: Math.round(this.lastMs * 100) / 100, lost: this.lost };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const d of [...this.devices]) d.destroy();
    this._clear();
    for (const p of [...this.scenePacks.values()]) this._disposeScene(p);
    this.scenePacks.clear();
    this.mat.edge?.map?.dispose?.(); // canvas dash texture (not in this.tex)
    for (const m of Object.values(this.mat)) m?.dispose?.();
    for (const t of Object.values(this.tex)) t?.dispose?.();
    // PMREM's render target owns the environment texture. Disposing the texture alone leaks the framebuffer.
    // app.js rebuilds 3D by destroy() then a new BoardScene. [ASSUMED] the target's dispose frees the texture too.
    if (this.envRT) {
      try { this.envRT.dispose(); } catch { /* ignore */ }
    } else {
      this.envMap?.dispose?.();
    }
    this.envRT = null;
    this.envMap = null;
    this.canvas.removeEventListener?.('webglcontextlost', this._onLost);
    try { this.renderer.dispose(); } catch { /* ignore */ }
    try { this.renderer.forceContextLoss?.(); } catch { /* ignore */ }
  }
}

// ---- small procedural meshes (fallbacks / rare devices) ------------------------------------------------------------

/** Axis-aligned box on the ground, centred on the origin: size × size × height. */
export function boxData(size, height) {
  const a = size / 2, pos = [], nrm = [], uv = [], idx = [];
  const faces = [
    [[0, 0, 1], [[-a, -a, height], [a, -a, height], [a, a, height], [-a, a, height]]],
    [[0, -1, 0], [[-a, -a, 0], [a, -a, 0], [a, -a, height], [-a, -a, height]]],
    [[1, 0, 0], [[a, -a, 0], [a, a, 0], [a, a, height], [a, -a, height]]],
    [[0, 1, 0], [[a, a, 0], [-a, a, 0], [-a, a, height], [a, a, height]]],
    [[-1, 0, 0], [[-a, a, 0], [-a, -a, 0], [-a, -a, height], [-a, a, height]]],
  ];
  for (const [n, q] of faces) {
    const b = pos.length / 3;
    for (const p of q) { pos.push(...p); nrm.push(...n); }
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), index: new Uint16Array(idx) };
}

/** Device box with an atlas top (blower fallback ▶▶ hatch, turret target plate) and grey sides. */
function boxWithTop(uvTable, kind) {
  const size = kind === 'turret' ? 0.72 : 0.86, h = kind === 'turret' ? 0.34 : DEVICE_H.platform;
  const b = boxData(size, h);
  const top = surfaceUV(uvTable?.mech || { src: 'D', rect: [1088, 708, 356, 310] });
  const side = surfaceUV(uvTable?.graySide || { src: 'D', rect: [272, 1664, 272, 120] });
  const uv = new Float32Array(b.uv.length);
  for (let f = 0; f < 5; f++) uv.set(f === 0 ? top : side, f * 8);
  return { ...b, uv, color: null };
}

/** Low green blob (act1 m07 bushes: inactive in 盟约, kept for completeness). */
function bushData() {
  const b = boxData(0.7, 0.32);
  return { ...b, uv: new Float32Array(b.uv.length).fill(0.02), color: new Float32Array((b.position.length / 3) * 3).fill(0).map((_, i) => [0.25, 0.48, 0.22][i % 3]) };
}
