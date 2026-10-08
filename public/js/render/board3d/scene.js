// render/board3d/scene.js — the official 卫戍协议 board as a real three.js scene (DESIGN §15), rendered on its own
// canvas UNDER the Pixi canvas (units, FX, highlights, HP bars stay in Pixi). One camera model drives both layers:
// render/projection.js `syncThreeCamera` makes the three.js PerspectiveCamera project exactly like the Pixi one.
//
//   const board = new BoardScene(THREE, pack, { canvas, quality })   (pack = load.js loadBoardPack)
//   board.setStage(stage)            geometry from the stage grid (layout.js) + devices + gates + terrain
//   board.setArea(rects)             the built areas (layout.js AREAS / areaFor: normal field + pen, 联防, boss)
//   board.setFocus(rect)             the lit field (others fade, animated)
//   board.setBattleRect(rect|null)   crates / turrets inside a running battle are sim units: static ones hide
//   board.createDevice()             → handle { update(cam, { x, y, z, size, height, top, side, alpha, rot }), mesh: null, destroy() }
//                                      (render/units.js DeviceView boxes, drawn as the official crate mesh)
//   board.flashObjective(r, c)       leak flash of a blue objective box
//   board.render(cam, timeSec)       sync the camera, animate, draw
//   board.resize(w, h, dpr) · board.stats() · board.destroy()
//
// Draw calls: board (tiles + blocks + platforms, merged, MT_autochess), the pen's glass hatches (glassMaterial),
// static crates (merged, same material),
// decals (MT_autochess_common), fence pipes, blowers (merged, unlit), gate boxes (additive + alpha, merged per
// material), cyan field edges, terrain overlays (≤ 4), background plane + its shadow catcher — ~12–16 in total.
// The key light's shadow map is rendered only when the geometry changes (autoUpdate off).

import { WATER_SURFACE_Z } from '../tiles.js';
import { buildBoard, objToBoard, boxProjectUV, ROWS, COLS, DEVICE_H, AREAS } from './layout.js';
import { surfaceUV } from './atlas.js';
import {
  focusUniforms, makeTexture, boardMaterial, glassMaterial, decalMaterial, pipeMaterial, unlitMaterial, gateMaterial, glowMaterial,
  waterMaterial, mireMaterial, infectionMaterial, smogMaterial, dashTexture, environmentMap,
} from './materials.js';
import { syncThreeCamera } from '../projection.js';

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

/** Additive gain of the gate boxes at the curve's mean (tuned against the official screenshots). */
export const GATE_GAIN = 0.6;

/** Gate pulse: the official clip's _TintColor.a curve (2 s loop, 0.134 → 0.229 → 0.134) scaled to our intensity. */
export function gatePulse(t, phase = 0) {
  const k = 0.5 - 0.5 * Math.cos(((t / 2 + phase) % 1) * Math.PI * 2);
  return 0.134 + (0.229 - 0.134) * k;
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
    if (opts.environment !== false) {
      try {
        this.envMap = environmentMap(T, R);
        if (this.envMap) {
          this.scene.environment = this.envMap;
          this.scene.environmentIntensity = LIGHTING.env;
          this.scene.environmentRotation?.set?.(-Math.PI / 2, 0, 0);
        }
      } catch { this.envMap = null; }
    }
    this.focusTarget = null;
    const aniso = Math.min(8, R.capabilities?.getMaxAnisotropy?.() || 1);
    const img = pack?.images || {};
    this.tex = {
      D: makeTexture(T, img.D, { aniso }), N: makeTexture(T, img.N, { srgb: false, aniso }), R: makeTexture(T, img.R, { srgb: false, aniso }),
      E: makeTexture(T, img.E, { aniso }), common: makeTexture(T, img.common, { aniso }), commonE: makeTexture(T, img.commonE, { aniso }),
      BG: makeTexture(T, img.BG, { aniso }), wind: makeTexture(T, img.wind, { aniso }), gate: makeTexture(T, img.gate, {}),
      waterN: makeTexture(T, img.waterN, { srgb: false, repeat: true }), caustics: makeTexture(T, img.caustics, { srgb: false, repeat: true }),
      noise: makeTexture(T, img.noise, { srgb: false, repeat: true }),
    };
    if (this.tex.BG) { this.tex.BG.wrapS = T.MirroredRepeatWrapping; this.tex.BG.wrapT = T.MirroredRepeatWrapping; }
    this.mat = {
      board: boardMaterial(T, this.tex, this.focus, { emissive: LIGHTING.emissive, roughness: LIGHTING.roughness }),
      glass: glassMaterial(T, this.tex, this.focus, { emissive: LIGHTING.emissive, roughness: LIGHTING.roughness }),
      decal: this.tex.common ? decalMaterial(T, this.tex, this.focus) : null,
      pipe: pipeMaterial(T, this.focus),
      bg: this.tex.BG ? unlitMaterial(T, this.tex.BG, new T.Color().setScalar(LIGHTING.bg.color * LIGHTING.bg.dim)) : new T.MeshBasicMaterial({ color: 0x1a1d1f }),
      wind: this.tex.wind ? unlitMaterial(T, this.tex.wind) : null,
      gateStartAdd: this.tex.gate ? gateMaterial(T, this.tex.gate, { additive: true }) : null,
      gateEndAdd: this.tex.gate ? gateMaterial(T, this.tex.gate, { additive: true }) : null,
      gateEndAb: this.tex.gate ? gateMaterial(T, this.tex.gate, { additive: false }) : null,
      edge: glowMaterial(T, dashTexture(T)),
      water: waterMaterial(T, this.tex, this.focus),
      mire: mireMaterial(T, this.tex, this.focus),
      infection: infectionMaterial(T, this.tex, this.focus),
      smog: smogMaterial(T, this.tex, this.focus),
      shadowCatcher: new T.ShadowMaterial({ opacity: 0.32, color: 0x000000 }),
    };
    this.mat.crateFade = null;
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
    this._crateGeom = null;
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

  /** The crate mesh in board space (s_common_box_01 when loaded, else a unit chamfer-free box), UVs on D. */
  crateGeometry() {
    if (this._crateGeom) return this._crateGeom;
    const uv = this.pack?.uv || {};
    const obj = this.pack?.meshes?.crate;
    let base;
    if (obj && obj.normal) base = objToBoard(obj, 0.01);
    else base = boxData(0.9, 0.675);
    this._crateGeom = boxProjectUV(base, uv.crateTop || { src: 'D', rect: [1222, 1938, 134, 108] }, uv.crateSide || { src: 'D', rect: [1087, 1938, 134, 108] });
    this._crateGeom.color = null;
    return this._crateGeom;
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
    const key = stage ? `${stage.id || ''}|${(stage.rows || []).join('/')}|${JSON.stringify((stage.devices || []).map((d) => [d.key, d.pos, d.active, d.dir]))}` : '';
    if (key === this.stageKey) return;
    this.stageKey = key;
    this.stage = stage || null;
    this._clear();
    if (!stage) return;
    const board = buildBoard(stage, { uv: this.pack?.uv || null, area: this.area });
    this.board = board;
    const M = this.meshes = {};
    M.board = this._mesh(board.buckets.board, this.mat.board);
    M.glass = this._mesh(board.buckets.glass, this.mat.glass);
    M.decal = this._mesh(board.buckets.decal, this.mat.decal, { cast: false });
    M.pipe = this._mesh(board.buckets.pipe, this.mat.pipe);
    this._buildDevices(board);
    this._buildGates(board);
    this._buildEdges(board);
    this._buildTerrain(board);
    this._buildBackground(board);
    this._fitShadow(board);
    this.renderer.shadowMap.needsUpdate = true;
  }

  _buildDevices(board) {
    const crates = [], blowers = [];
    this.staticCrates = [];
    const wind = this.pack?.meshes?.blower ? objToBoard(this.pack.meshes.blower, 1) : null;
    for (const d of board.devices) {
      if (d.kind === 'crate') this.staticCrates.push(d);
      else if (d.kind === 'blower' && wind && this.mat.wind) blowers.push(placeMesh(wind, { x: d.c, y: d.r, z: d.z0 + 0.078, rot: DIR_TURNS[d.dir] ?? 0 }));
      else if (d.kind === 'blower' || d.kind === 'turret') crates.push(placeMesh(boxWithTop(this.pack?.uv, d.kind), { x: d.c, y: d.r, z: d.z0 }));
      else if (d.kind === 'mound') crates.push(placeMesh(this.crateGeometry(), { x: d.c, y: d.r, z: d.z0, s: 0.95, sz: 0.55 }));
      else if (d.kind === 'bush') crates.push(placeMesh(bushData(), { x: d.c, y: d.r, z: d.z0 }));
    }
    if (blowers.length) this.meshes.blowers = this._mesh(mergeInto(blowers), this.mat.wind, { receive: false });
    if (crates.length) this.meshes.props = this._mesh(mergeInto(crates), this.mat.board);
    this._rebuildCrates();
  }

  _rebuildCrates() {
    if (this.meshes.crates) { this.root.remove(this.meshes.crates); this.meshes.crates.geometry.dispose(); this.meshes.crates = null; }
    const R = this.battleRect;
    const inside = (d) => !!R && d.r >= R.r0 && d.r <= R.r1 && d.c >= R.c0 && d.c <= R.c1;
    const list = (this.staticCrates || []).filter((d) => !inside(d)).map((d) => placeMesh(this.crateGeometry(), { x: d.c, y: d.r, z: d.z0 }));
    if (list.length) this.meshes.crates = this._mesh(mergeInto(list), this.mat.board);
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
    if (T.water.length) this.meshes.water = this._mesh(quads(T.water, WATER_SURFACE_Z), this.mat.water, opt);
    if (T.mire.length) this.meshes.mire = this._mesh(quads(T.mire, 0.006, 0.02), this.mat.mire, opt);
    if (T.infection.length) this.meshes.infection = this._mesh(quads(T.infection, 0.007, 0.02), this.mat.infection, opt);
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
    const b = board.bounds;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const d = LIGHTING.key.dir;
    const len = Math.hypot(d[0], d[1], d[2]);
    const dist = 30;
    k.position.set(cx + (d[0] / len) * dist, cy + (d[1] / len) * dist, (d[2] / len) * dist);
    k.target.position.set(cx, cy, 0);
    k.target.updateMatrixWorld();
    const cam = k.shadow.camera;
    // light-space box covering the island and its shadow on the background plane
    const half = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + 9;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 1; cam.far = dist + 30;
    cam.updateProjectionMatrix();
    k.updateMatrixWorld();
  }

  // ---- dynamic devices (battle) ------------------------------------------------------------------------------

  /** A crate / device box driven by render/units.js DeviceView (see header). */
  createDevice() {
    const T = this.THREE;
    const self = this;
    const geom = this._geometry({ ...this.crateGeometry(), color: null });
    const mat = this.mat.board.clone();
    mat.transparent = true;
    mat.vertexColors = false;
    // keep the focus falloff on the clone
    mat.onBeforeCompile = this.mat.board.onBeforeCompile;
    const mesh = new T.Mesh(geom, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.dynamic.add(mesh);
    const bx = this.crateGeometry().bounds || { x0: -0.45, x1: 0.45, z0: 0, z1: 0.675 };
    const baseSize = Math.max(0.01, bx.x1 - bx.x0), baseH = Math.max(0.01, bx.z1 - bx.z0);
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
    // gate pulses (official 2 s curve → additive intensity), objective leak flashes
    const pulse = gatePulse(t);
    if (this.mat.gateStartAdd) this.mat.gateStartAdd.uniforms.uPulse.value = GATE_GAIN * pulse / 0.18;
    if (this.mat.gateEndAdd) this.mat.gateEndAdd.uniforms.uPulse.value = GATE_GAIN * gatePulse(t, 0.5) / 0.18;
    if (this.mat.gateEndAb) this.mat.gateEndAb.uniforms.uPulse.value = 0.9;
    let flash = 0;
    for (let i = this.flashes.length - 1; i >= 0; i--) { const f = this.flashes[i]; f.t += dt; if (f.t > 1.2) this.flashes.splice(i, 1); else flash = Math.max(flash, 1 - f.t / 1.2); }
    for (const m of [this.mat.gateEndAdd, this.mat.gateEndAb]) if (m) m.uniforms.uFlash.value.setRGB(flash, flash * 0.12, flash * 0.1);
    for (const k of ['water', 'mire', 'infection', 'smog']) this.mat[k].uniforms.uTime.value = t;
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
    this.mat.edge?.map?.dispose?.(); // canvas dash texture (not in this.tex)
    for (const m of Object.values(this.mat)) m?.dispose?.();
    for (const t of Object.values(this.tex)) t?.dispose?.();
    this.envMap?.dispose?.();
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
