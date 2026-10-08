// render/tiles.js — stage renderer (DESIGN §9, research 07 §7).
//
// The ground (low tile tops, the island's cliff edges) is one PIXI.Mesh with a custom perspective-correct shader:
// every quad carries (u·w, v·w, w) texture coordinates with w = 1/depth, so the material atlas (render/textures.js:
// the real 卫戍协议 board art of the local client when installed — render/boardArt.js — else procedural) maps onto
// the trapezoid tiles without the affine "kink". Vertices are re-projected only when the camera changes. Draw
// order (painter's): backdrop ground plane → cliff faces → low tops. The island stands on a large textured ground
// plane (the board art's concrete backdrop) with baked contact shadows, fading into fog with distance.
//
// Raised blocks (high ground, forbidden blocks, walls, bench pads) are one mesh PER ROW placed in the depth-sorted
// unit layer (outer→inner within the row, each block's visible sides before its top), keyed at the row's far edge
// (`rowDepthKey`): a unit standing farther away than a block row is drawn before it, so the block hides its feet /
// lower body; units on or in front of the row are drawn after it. Things lying ON a raised top (highlights, unit
// shadows, facing chevrons, ground rings) go into that row's surface container (`surfaceLayer(row)`), drawn right
// after the row's blocks and devices but before its units.
//
// Also:
//   * highlight groups (legal green / illegal red / attack range orange / custom) — Graphics, redrawn on change,
//   * gate (red) and objective (blue) wireframe boxes with warning glyphs, pulsing (redrawn per frame),
//   * animated terrain: smog puffs, deep-sea shimmer, infection glow, mire bubbles, teleport rings,
//   * devices: crates, platforms, sealed floors, blowers (▶▶ plate + airflow along rangeTiles), turrets are textured
//     boxes in their row's block mesh; mounds and bushes are Graphics in the depth-sorted unit layer. Battle
//     devices (sim units) use `BoxMesh`, the same textured box as a standalone mesh.
// High-ground plates pick a frame piece by connectivity (horizontal strip L/M/R, vertical strip B/VM/T, single).
// Tiles outside the playable area fade out with distance, so the board reads as a lit island over the backdrop.
//
// External board (`setExternal(true)`): the official 3D board scene (render/board3d) draws the tiles, blocks, gates,
// devices and animated terrain on its own canvas under the Pixi one. The field then keeps only what lies on top
// of the board — highlight groups, blower airflow streaks — plus the grid queries (tile / heightAt / levels) that
// units, FX and hit-testing use, so both layers agree on every height. No meshes, Graphics props or anim sprites
// are built; switching back (WebGL context lost, art missing) rebuilds the 2D board.

import { tileAtlas, fxAtlas, rng, groundTexture } from './textures.js';
import { GLYPH, TILEKEY_GLYPH, TILE_H, COLORS, ORIGINIUM } from './style.js';

/**
 * How deep a water tile (the map's 'd', tile_deepsea) sits below the surrounding ground, in tiles. The official's water
 * level is the scene's own water plane (metadata get_currentWaterHeight / _HGWaterSurfaceZ) and its level files carry
 * only HIGHLAND/LOWLAND, so this is our stand-in for the depth — one line to tune. It is a TERRAIN height: units standing
 * on water are lowered by the tile itself, and the ground in front of them (higher) then hides the part it should
 * (player report: 低一点的单位应该被外面的普通地板遮住).
 */
export const WATER_DEPTH = 1.0;   // the single source of the water depth (board3d/layout.js BASIN re-uses it)
/** The water surface's own height relative to the ground (the 3D board draws its water plane here). */
export const WATER_SURFACE_Z = -0.2;
/**
 * The water tile's near wall — the step face between the sunken floor and the road. It exists to hide the lower part of
 * a unit standing in the water, so it has to READ as the floor's own edge: a mid grey a shade below the plates, with a
 * lighter top lip. (It used to be near-black, which looked like a stray black bar: player report 渲染层有问题.)
 */


/** The water surface sheet drawn above the units (tile 'd'): a normal-blend teal at this tint and opacity, so a body
 *  standing in water is visible through it but reads as submerged. The shimmer under the units keeps its own look. */
import { parsePenRect, PEN_RECT } from './pen.js';

/**
 * Depth-sort key (unit layer zIndex) of block row `row`: the row's far edge. Units use
 * `-cam.depthOf(x, y, 0) * 100`, so a unit is drawn after (in front of) the row's blocks iff y < row + ½.
 */
export const rowDepthKey = (cam, row) => -cam.depthOf(0, row + 0.5, 0) * 100;
/** Offsets above rowDepthKey: row blocks < devices on the row < things lying on the row's raised tops. */
export const ROW_KEY = Object.freeze({ blocks: 0, devices: 0.01, surface: 0.02 });
/** Gate / objective boxes (low tiles) of row `row`: after the row's blocks, before units standing in the box. */
export const boxDepthKey = (cam, row) => -cam.depthOf(0, row + 0.45, 0) * 100;

const ROWS = 19, COLS = 21;
const PLAYABLE_DIST = 2;         // margin tiles farther than this from a playable tile are not drawn
const CLIFF_DEPTH = 0.62;        // how far the island's edge faces go down to the ground plane (tiles)
/** Brightness of the board meshes (vertex colour above 1 lifts the mid-grey board art a little). */
const EXPOSURE = 1.12;
/** Ground plane extent (world tiles) and cell size; contact shadows are baked per vertex. */
const PLANE = Object.freeze({ x0: -16, x1: 36, y0: -10, y1: 32, cell: 1 });

const VERT = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec3 aUvq;
attribute vec4 aColor;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec3 vUvq;
varying vec4 vColor;
void main(void) {
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
  vUvq = aUvq;
  vColor = aColor;
}`;

const FRAG = `
precision mediump float;
varying vec3 vUvq;
varying vec4 vColor;
uniform sampler2D uSampler;
uniform float uAlpha;
void main(void) {
  vec4 c = texture2D(uSampler, vUvq.xy / vUvq.z);
  gl_FragColor = vec4(c.rgb * vColor.rgb, c.a) * (vColor.a * uAlpha);
}`;

const HL_STYLES = {
  legal: { color: COLORS.legal, fill: 0.26, line: 0.9 },
  illegal: { color: COLORS.illegal, fill: 0.32, line: 0.95 },
  range: { color: COLORS.range, fill: 0.3, line: 0.85 },
  rangeStand: { color: COLORS.rangeStand, fill: 0.3, line: 0.9 },
  hover: { color: 0xffffff, fill: 0.14, line: 0.55 },
  target: { color: 0xffffff, fill: 0.22, line: 1 },
  deploy: { color: 0x9fd4ff, fill: 0.12, line: 0.45 },
};

const SIDE_MAT = {
  wall: 'wallSide', forbid: 'forbidSide', forbid2: 'forbidSide', sep: 'sepSide', hand: 'benchSide', temp: 'benchSideTemp',
  fence: 'fenceSide', margin: 'forbidSide',
};

/**
 * Parse a stage record into a per-tile info grid (tolerant of partial/malformed data). `band` = [r0, r1] rows drawn;
 * `field` = [f0, f1] rows of the active field — drawn rows outside it are dim, non-playable scenery (e.g. the enemy
 * preview pen behind the normal field, or the normal field behind the boss field).
 */
export function parseStage(stage, band = [0, ROWS - 1], field = [0, 13]) {
  const rows = Array.isArray(stage?.rows) ? stage.rows : [];
  const legend = stage && typeof stage.tiles === 'object' && stage.tiles ? stage.tiles : {};
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const line = typeof rows[r] === 'string' ? rows[r] : '';
    const row = [];
    for (let c = 0; c < COLS; c++) {
      let g = line[c] || '#';
      if (!GLYPH[g]) g = TILEKEY_GLYPH[legend[g]?.tileKey] || (legend[g]?.height === 'HIGH' ? '#' : 'R');
      const def = GLYPH[g];
      const inBand = r >= band[0] && r <= band[1];
      const scenery = r < field[0] || r > field[1];
      row.push({ r, c, glyph: g, water: g === 'd', mat: def.mat, hClass: def.h, h: (def.h ? TILE_H[def.h] : 0) - (g === 'd' ? WATER_DEPTH : 0), playable: inBand && !scenery && g !== '#' && g !== 'X', inBand, scenery, dist: 0, alpha: 1, drawn: true, focus: true });
    }
    grid.push(row);
  }
  // the enemy preview pen's floor (enemy_place_rect) is the glass hatch of the official pen, row 16 included
  const pen = parsePenRect(stage?.config?.enemy_place_rect) || PEN_RECT;
  for (let r = pen.r0; r <= pen.r1; r++) for (let c = pen.c0; c <= pen.c1; c++) {
    const t = grid[r]?.[c];
    if (t && (t.glyph === 'f' || t.glyph === 'p')) t.mat = 'penGlass';
  }
  // distance (Chebyshev) to the nearest playable tile → fade / skip the margin
  const INF = 99;
  for (const row of grid) for (const t of row) t.dist = t.playable ? 0 : INF;
  for (let pass = 0; pass < PLAYABLE_DIST + 1; pass++) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = grid[r][c];
      if (t.dist === 0) continue;
      let best = t.dist;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const n = grid[r + dr]?.[c + dc];
        if (n && n.dist + 1 < best) best = n.dist + 1;
      }
      t.dist = best;
    }
  }
  for (const row of grid) for (const t of row) {
    t.drawn = t.inBand && (t.dist <= PLAYABLE_DIST || (t.scenery && t.glyph !== '#'));
    t.alpha = t.dist === 0 ? 1 : t.dist === 1 ? 0.92 : 0.5;
    if (t.glyph === '#' && t.dist >= 2) t.mat = 'margin';
  }
  // high-ground plates: frame piece by connectivity (texture top = the tile's far edge)
  const wall = (r, c) => { const n = grid[r]?.[c]; return !!n && n.drawn && n.glyph === 'h'; };
  for (const row of grid) for (const t of row) {
    if (t.glyph !== 'h' || !t.drawn) continue;
    const L = wall(t.r, t.c - 1), Rt = wall(t.r, t.c + 1);
    if (L || Rt) t.top = L && Rt ? 'wallM' : Rt ? 'wallL' : 'wallR';
    else {
      const near = wall(t.r - 1, t.c), far = wall(t.r + 1, t.c);
      t.top = near && far ? 'wallVM' : far ? 'wallB' : near ? 'wallT' : 'wall';
    }
  }
  return grid;
}

const hash2 = (r, c) => ((r * 73856093) ^ (c * 19349663)) >>> 0;

/** Stripe spacing (tiles, along x) of striped range highlights. */
const STRIPE_STEP = 0.2;
/**
 * Diagonal stripes (world x − y = const, like the official striped range tiles) clipped to tile (r, c)'s top at
 * height z, drawn as light orange lines into `g`.
 */
export function stripeSegments(r, c, inset = 0.05, step = STRIPE_STEP) {
  const a = 0.5 - inset;
  const x0 = c - a, x1 = c + a, y0 = r - a, y1 = r + a;
  const out = [];
  for (let d = (x0 - y1) + step / 2; d < x1 - y0; d += step) {
    // points of x − y = d inside the square: x from max(x0, y0 + d) to min(x1, y1 + d)
    const xa = Math.max(x0, y0 + d), xb = Math.min(x1, y1 + d);
    if (xb - xa > 1e-4) out.push([xa, xa - d, xb, xb - d]);
  }
  return out;
}
function drawStripes(g, cam, r, c, z, inset, lw, p) {
  g.lineStyle(lw, 0xffc27a, 0.55, 0.5);
  for (const [xa, ya, xb, yb] of stripeSegments(r, c, inset)) {
    cam.project(xa, ya, z, p);
    g.moveTo(p.x, p.y);
    cam.project(xb, yb, z, p);
    g.lineTo(p.x, p.y);
  }
  g.lineStyle(0);
}

function variantMat(t) {
  if (t.top) return t.top;
  const h = hash2(t.r, t.c) % 7;
  switch (t.mat) {
    case 'road': return h < 3 ? 'road' : h < 5 ? 'road2' : 'road3';
    case 'roadN': return h < 4 ? 'roadN' : 'roadN2';
    case 'floor': return h < 4 ? 'floor' : 'floor2';
    case 'forbid': return h < 4 ? 'forbid' : 'forbid2';
    // 活性源石: the same material twice (the second mirrored), so a field of it does not repeat one pattern
    // (textures.js originiumOverlay — the palette and recipe match the 3D board's shader, GitHub #184)
    case 'infection': return h < 4 ? 'infection' : 'infection2';
    default: return t.mat;
  }
}

/** Device roles we draw, and whether they stand on the tile as a 3D prop. */
const DEVICE_ROLES = new Set(['crate', 'platform', 'mound', 'blower', 'turret', 'waterPlatform', 'bush', 'sealedFloor']);
/** Textured box props: role → { size (tiles), height, top / side materials }. */
export const DEVICE_BOX = Object.freeze({
  crate: { size: 0.84, height: 0.74, top: 'crateTop', side: 'crateSide' },
  platform: { size: 0.94, height: 0.26, top: 'platformTop', side: 'forbidSide' },
  waterPlatform: { size: 0.94, height: 0.2, top: 'platformTop', side: 'lowSide' },
  sealedFloor: { size: 0.92, height: 0.05, top: 'sealed', side: 'forbidSide' },
  blower: { size: 0.86, height: 0.28, top: 'blowerTop', side: 'forbidSide' },
  turret: { size: 0.72, height: 0.34, top: 'turretTop', side: 'forbidSide' },
});
/** Box prop of a battle device unit by its defId (sim `spawnDevice`: stage device keys). */
export function deviceBoxOf(defId) {
  const k = String(defId || '');
  if (k.includes('accrate') || k.includes('crate')) return DEVICE_BOX.crate;
  if (k.includes('aclasert') || k.includes('turret')) return DEVICE_BOX.turret;
  if (k.includes('achplat') || k.includes('plat')) return DEVICE_BOX.platform;
  if (k.includes('blower')) return DEVICE_BOX.blower;
  return null;
}
/** Texture rotation (clockwise quarter turns) so a ▶ icon on a device top points along its `dir`. */
const DIR_ROT = Object.freeze({ RIGHT: 0, DOWN: 1, LEFT: 2, UP: 3 });

export class TileField {
  /**
   * @param {{ ground: PIXI.Container, overlay: PIXI.Container, props: PIXI.Container, anim: PIXI.Container }} layers
   *   props must be the depth-sorted unit layer (sortableChildren).
   */
  constructor(layers) {
    const P = globalThis.PIXI;
    this.P = P;
    this.layers = layers;
    this.atlas = tileAtlas();
    this.art = null;
    this.stage = null;
    this.grid = parseStage(null);
    this.quads = [];
    this.mesh = null;              // ground mesh (low tops + cliffs)
    this.meshes = [];              // every mesh record { quads, row, buffers…, mesh }
    this.rowMeshes = new Map();    // block row → mesh record (in the unit layer)
    this.rowSurfaces = new Map();  // block row → Container for things on its raised tops
    this.shader = null;
    this.plane = null;             // backdrop ground plane mesh record
    this.planeShader = null;
    this.hlGfx = new P.Graphics();
    this.boxes = [];               // gate / objective wire boxes { r, c, gate, g } (in the unit layer)
    this.flowGfx = new P.Graphics();
    this.flowGfx.blendMode = P.BLEND_MODES.ADD;
    layers.overlay.addChild(this.hlGfx, this.flowGfx);
    this.animLayer = new P.Container();
    layers.anim.addChild(this.animLayer);
    // The water shimmer is drawn ABOVE the units (app.js layers.water) so a body standing in water is seen through it;
    // every other animated terrain stays under them. Same sprites, same animation, same rebuild rules — and the same
    // drawn / r < 13 filtering, so a single-player field's other half never shows water.
    this.waterLayer = layers.water ? new P.Container() : null;
    if (this.waterLayer) this.waterLayer.visible = false;
    this.highlights = new Map();   // group → { tiles: [[r,c]], style }
    this.devices = [];             // Graphics props { dev, gfx, row, col, role } (mounds, bushes)
    this.devBoxes = [];            // textured box props (in the row meshes) { dev, row, col, role }
    this.blowers = [];             // { dev, row, col, dir } airflow sources
    this.animSprites = [];         // { sprite, r, c, kind, phase }
    this.battleRect = null;
    this.cam = null;
    this.camVersion = -1;
    this.time = 0;
    this.flashes = [];             // objective leak flashes { r, c, t }
    this._p = { x: 0, y: 0, s: 0, depth: 0 };
    this.levels = [0];
    this.band = [0, ROWS - 1];
    this.field = [0, 13];
    this.focus = null;
    this.boxMeshes = new Set();    // live BoxMesh instances (re-textured on art swaps)
    this.external = false;         // true: the 3D board layer draws the board (see header)
  }

  /** Let an external (3D) board layer draw the board: only highlights / airflow / grid queries stay here. */
  setExternal(on) {
    const next = !!on;
    if (next === this.external) return;
    this.external = next;
    if (this.stage) this._rebuild();
    else if (next) this._freeBoard();
  }

  /** Drop every board mesh, prop Graphics, anim sprite and gate box (external mode). */
  _freeBoard() {
    for (const m of this.meshes) m.mesh.destroy({ children: true });
    for (const s of this.rowSurfaces.values()) this._freeSurface(s);
    this.meshes = []; this.rowMeshes = new Map(); this.rowSurfaces = new Map(); this.mesh = null; this.plane = null;
    for (const d of this.devices) d.gfx.destroy();
    this.devices = [];
    for (const a of this.animSprites) a.sprite.destroy();
    this.animSprites = [];
    for (const b of this.boxes) b.g.destroy();
    this.boxes = [];
    this.quads = [];
  }

  /**
   * Rows drawn (`band` [r0, r1]) and the focused rect (tiles outside it are dimmed). Rebuilds the geometry only
   * when something changed.
   */
  setView(band, focus, field) {
    const b = Array.isArray(band) ? [Math.max(0, band[0] | 0), Math.min(ROWS - 1, band[1] | 0)] : [0, ROWS - 1];
    const fb = Array.isArray(field) ? [field[0] | 0, field[1] | 0] : [b[0], Math.min(b[1], 13)];
    const f = focus ? { r0: focus.r0, r1: focus.r1, c0: focus.c0, c1: focus.c1 } : null;
    const same = b[0] === this.band[0] && b[1] === this.band[1] && fb[0] === this.field[0] && fb[1] === this.field[1] &&
      JSON.stringify(f) === JSON.stringify(this.focus);
    this.band = b;
    this.field = fb;
    this.focus = f;
    if (!same && this.stage) this._rebuild();
  }

  /**
   * Use the real board art (render/boardArt.js result) or null for the procedural look. Swaps the atlas texture
   * (identical UV layout) and the ground plane texture; geometry is rebuilt so art-only materials apply.
   */
  setArt(art) {
    const next = art && art.images ? art : null;
    if ((next?.key || '') === (this.art?.key || '') && this.shader) return;
    this.art = next;
    this.atlas = tileAtlas(next);
    if (this.shader) this.shader.uniforms.uSampler = this.atlas.texture;
    if (this.planeShader) this.planeShader.uniforms.uSampler = groundTexture(next?.images?.BG || null, next?.tiles?.backdrop?.crop);
    for (const b of this.boxMeshes) b.retexture();
    if (this.stage) this._rebuild();
  }

  /** Tile info (always an object; off-grid → forbidden). */
  tile(r, c) { return this.grid[r]?.[c] || { r, c, glyph: '#', mat: 'forbid', h: 0, playable: false, drawn: false }; }
  heightAt(r, c) { const t = this.grid[r]?.[c]; return t && t.drawn ? t.h + (t.devH || 0) : 0; }
  /** Is (r,c) a water tile? (the map's 'd' letter, classified as sea below). Units standing on one sit lower. */
  waterAt(r, c) { const t = this.grid[r]?.[c]; return !!(t && t.drawn && t.water); }

  setStage(stage) {
    this.stage = stage || null;
    this._rebuild();
  }

  _rebuild() {
    const stage = this.stage;
    this.grid = parseStage(stage, this.band, this.field);
    const F = this.focus;
    for (const row of this.grid) for (const t of row) {
      t.focus = !F || (t.r >= F.r0 && t.r <= F.r1 && t.c >= F.c0 && t.c <= F.c1);
    }
    // raised device tops (active platforms / mounds) change the standing height of their tile
    for (const d of this._stageDevices()) {
      const t = this.grid[d.pos[0]]?.[d.pos[1]];
      if (!t) continue;
      if (d.role === 'platform' || d.role === 'mound') t.devH = TILE_H.platform;
      else if (d.role === 'waterPlatform') t.devH = DEVICE_BOX.waterPlatform.height + WATER_DEPTH;   // the platform floats at the surface, not on the sunken floor
    }
    const hs = new Set([0]);
    for (const row of this.grid) for (const t of row) if (t.drawn) hs.add(t.h + (t.devH || 0));
    this.levels = [...hs].sort((a, b) => b - a);
    this._buildDevices();
    if (this.external) {
      this._freeBoard();
      // The external (three.js) board draws the ground, so the Pixi field keeps nothing — except the water sheet that
      // has to lie ON TOP of the units: the units are Pixi sprites, so water drawn behind them (three.js) can never
      // cover a body standing in it. This is the one piece of the animated terrain that must exist in both modes.
      this.camVersion = -1;
      return;
    }
    this._buildQuads();
    this._buildMesh();
    this._buildAnim();
    this._buildBoxes();
    this.camVersion = -1;
  }

  _stageDevices() {
    const list = Array.isArray(this.stage?.devices) ? this.stage.devices : [];
    const out = [];
    for (const d of list) {
      if (!d || !Array.isArray(d.pos) || !Number.isInteger(d.pos[0]) || !Number.isInteger(d.pos[1])) continue;
      if (!DEVICE_ROLES.has(d.role)) continue;
      const active = typeof d.active === 'boolean' ? d.active : !d.hidden;
      if (!active) continue;
      if (d.pos[0] < 0 || d.pos[0] >= ROWS || d.pos[1] < 0 || d.pos[1] >= COLS || d.pos[0] >= 14) continue;
      const gt = this.grid[d.pos[0]] && this.grid[d.pos[0]][d.pos[1]];
      // devices stand on the island (playable tiles + the ring around them, dist ≤ 1 — the 3D board's drawn tiles), not
      // on the faded margin. A device on the field's edge wall is drawn like any other (board3d/layout.js stageDevices):
      // act2 m01's row-13 blowers top the field and its row-6 ones stand under the bench in the normal views, as in the
      // official normal rounds (user playtest #5 item 6 and its follow-up); the airflow (_drawFlow) only covers drawn
      // tiles, so the row-6 machines' shows in the Final Assault view alone
      if (gt && (!gt.drawn || gt.scenery || gt.dist > 1)) continue;
      out.push(d);
    }
    return out;
  }

  // ---- geometry ------------------------------------------------------------------------------------------

  _buildQuads() {
    const uv = this.atlas.uv;
    const quads = buildTileQuads(this.grid, uv);
    for (const d of this.devBoxes) {
      if (!d.visible) continue;
      const spec = DEVICE_BOX[d.role];
      const z0 = this.tile(d.row, d.col).h;
      boxQuads(quads, uv, d.col, d.row, z0, spec.size, spec.height, spec.top, spec.side, { row: d.row, col: d.col, rot: d.role === 'blower' ? DIR_ROT[d.dir] ?? 0 : 0 });
    }
    this.quads = quads;
  }

  _makeMesh(quads, row, shader, noSort = false) {
    const P = this.P;
    const n = quads.length;
    const m = { quads, row, noSort, pos: new Float32Array(n * 8), uvq: new Float32Array(n * 12), col: new Float32Array(n * 16), idx: new Uint16Array(n * 6), order: new Array(n) };
    m.posBuf = new P.Buffer(m.pos, false, false);
    m.uvqBuf = new P.Buffer(m.uvq, false, false);
    m.colBuf = new P.Buffer(m.col, false, false);
    m.idxBuf = new P.Buffer(m.idx, false, true);
    const geom = new P.Geometry()
      .addAttribute('aVertexPosition', m.posBuf, 2)
      .addAttribute('aUvq', m.uvqBuf, 3)
      .addAttribute('aColor', m.colBuf, 4)
      .addIndex(m.idxBuf);
    m.mesh = new P.Mesh(geom, shader);
    return m;
  }

  _buildMesh() {
    const P = this.P;
    for (const m of this.meshes) m.mesh.destroy({ children: true });
    for (const s of this.rowSurfaces.values()) this._freeSurface(s);
    this.meshes = [];
    this.rowMeshes = new Map();
    this.rowSurfaces = new Map();
    this.mesh = null;
    const { ground, rows } = splitQuadGroups(this.quads);
    if (!this.shader) this.shader = P.Shader.from(VERT, FRAG, { uSampler: this.atlas.texture, uAlpha: 1 });
    if (!this.planeShader) this.planeShader = P.Shader.from(VERT, FRAG, { uSampler: groundTexture(this.art?.images?.BG || null, this.art?.tiles?.backdrop?.crop), uAlpha: 1 });
    // backdrop ground plane (under everything)
    const plane = buildPlaneQuads(this.grid, this.art?.tiles?.backdrop?.tilesPerRepeat || 8);
    this.plane = this._makeMesh(plane, null, this.planeShader, true);
    this.meshes.push(this.plane);
    this.layers.ground.addChildAt(this.plane.mesh, 0);
    if (ground.length) {
      const m = this._makeMesh(ground, null, this.shader);
      this.meshes.push(m);
      this.mesh = m.mesh;
      this.layers.ground.addChild(m.mesh);
    }
    for (const [row, quads] of rows) {
      const m = this._makeMesh(quads, row, this.shader);
      this.meshes.push(m);
      this.rowMeshes.set(row, m);
      this.layers.props.addChild(m.mesh);
    }
  }

  /**
   * Container for things lying on the raised tops of block row `row` (drawn after that row's blocks, before its
   * units), or null when the row has no raised blocks (callers then use their ordinary ground layer).
   */
  surfaceLayer(row) {
    const r = Math.round(row);
    if (!this.rowMeshes.has(r)) return null;
    let s = this.rowSurfaces.get(r);
    if (!s) {
      s = new this.P.Container();
      s.sortableChildren = false;
      if (this.cam) s.zIndex = rowDepthKey(this.cam, r) + ROW_KEY.surface;
      this.layers.props.addChild(s);
      this.rowSurfaces.set(r, s);
    }
    return s;
  }

  _freeSurface(s) {
    // children belong to their owners (unit shadows, fx rings…): hand them back to the ground layers
    for (const ch of [...s.children]) { if (ch !== s._hl) this.layers.overlay.addChild(ch); }
    s.destroy({ children: true });
  }

  /** Lighting parameters of the current view (fog distances + the focused field's spotlight). */
  _light(cam) {
    const F = this.focus || { r0: 9, r1: 12, c0: 0, c1: 10 };
    return {
      fogNear: cam.dist * 0.75, fogFar: cam.dist * 1.7,
      lcx: (F.c0 + F.c1) / 2, lcy: (F.r0 + F.r1) / 2,
      lrx: Math.max(3, (F.c1 - F.c0) / 2 + 2.5), lry: Math.max(2.5, (F.r1 - F.r0) / 2 + 2.5),
    };
  }

  /** Re-project the ground when the camera changed (call every frame; cheap when unchanged). */
  project(cam, force = false) {
    if (!cam) return;
    if (!force && cam === this.cam && cam.version === this.camVersion) return;
    this.cam = cam;
    this.camVersion = cam.version;
    const light = this._light(cam);
    for (const m of this.meshes) projectMesh(cam, m, light, this._p);
    for (const [row, m] of this.rowMeshes) m.mesh.zIndex = rowDepthKey(cam, row) + ROW_KEY.blocks;
    for (const [row, s] of this.rowSurfaces) s.zIndex = rowDepthKey(cam, row) + ROW_KEY.surface;
    for (const b of this.boxMeshes) b.dirty = true;
    this._drawHighlights();
    this._placeDevices();
    this._placeAnim();
  }

  /**
   * A standalone textured box (battle devices: crates, turrets) sharing the tile shader & atlas. The caller owns
   * it: `box.update(cam, { x, y, z, size, height, top, side, alpha, rot })` per frame (re-projects on change),
   * `box.mesh` goes into the depth-sorted unit layer, `box.destroy()` when done.
   */
  createBox() {
    const b = new BoxMesh(this);
    this.boxMeshes.add(b);
    return b;
  }

  // ---- highlights ----------------------------------------------------------------------------------------

  /**
   * Set a highlight group. `tiles`: [[r,c]] or [{row,col}] (null/empty clears). `style`: 'legal' | 'illegal' |
   * 'range' | 'rangeStand' | 'hover' | 'target' | 'deploy' | { color, fill, line, group }. `opts.stripes`: light
   * diagonal stripes over the fill (the official striped range tiles; drawn under the units like every highlight).
   */
  setHighlights(tiles, style = 'range', group, opts) {
    let st = typeof style === 'object' && style ? { ...HL_STYLES.range, ...style } : (HL_STYLES[style] || HL_STYLES.range);
    if (opts && opts.stripes) st = { ...st, stripes: true };
    const key = group || (typeof style === 'object' && style?.group) || (typeof style === 'string' ? style : 'custom');
    const list = [];
    if (Array.isArray(tiles)) {
      for (const t of tiles) {
        const r = Array.isArray(t) ? t[0] : t?.row, c = Array.isArray(t) ? t[1] : t?.col;
        if (Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < ROWS && c >= 0 && c < COLS) list.push([r, c]);
      }
    }
    if (!list.length) this.highlights.delete(key);
    else this.highlights.set(key, { tiles: list, style: st });
    this._drawHighlights();
  }

  clearHighlights(group) {
    if (group) this.highlights.delete(group); else this.highlights.clear();
    this._drawHighlights();
  }

  _drawHighlights() {
    this.hlGfx.clear();
    for (const s of this.rowSurfaces.values()) if (s._hl) s._hl.clear();
    const cam = this.cam;
    if (!cam || !this.highlights.size) return;
    const p = this._p;
    const inset = 0.05;
    for (const { tiles, style } of this.highlights.values()) {
      for (const [r, c] of tiles) {
        const h = this.heightAt(r, c);
        let g = this.hlGfx;
        if (h > 1e-3) {
          // on a raised top: drawn with that block row (after the blocks, under the units standing there)
          const s = this.surfaceLayer(r);
          if (s) {
            if (!s._hl) { s._hl = new this.P.Graphics(); s.addChildAt(s._hl, 0); }
            g = s._hl;
          }
        }
        const z = h + 0.012;
        const cs = [c - 0.5 + inset, r + 0.5 - inset, c + 0.5 - inset, r + 0.5 - inset, c + 0.5 - inset, r - 0.5 + inset, c - 0.5 + inset, r - 0.5 + inset];
        const pts = new Array(8); // Graphics keeps a reference to the polygon's points: never reuse this array
        for (let k = 0; k < 4; k++) {
          cam.project(cs[k * 2], cs[k * 2 + 1], z, p);
          pts[k * 2] = p.x; pts[k * 2 + 1] = p.y;
        }
        const sc = cam.scaleAt(c, r, z);
        const lw = Math.max(1.5, sc * 0.035);
        g.lineStyle(lw, style.color, style.line, 0.5);
        g.beginFill(style.color, style.fill);
        g.drawPolygon(pts);
        g.endFill();
        if (style.stripes) drawStripes(g, cam, r, c, z, inset, Math.max(1.5, sc * 0.05), p);
      }
    }
  }

  // ---- devices -------------------------------------------------------------------------------------------

  _buildDevices() {
    for (const d of this.devices) d.gfx.destroy();
    this.devices = [];
    this.devBoxes = [];
    this.blowers = [];
    const P = this.P;
    for (const dev of this._stageDevices()) {
      const row = dev.pos[0], col = dev.pos[1];
      if (dev.role === 'blower') this.blowers.push({ dev, row, col, dir: dev.dir || 'UP', visible: true });
      if (DEVICE_BOX[dev.role]) { this.devBoxes.push({ dev, row, col, role: dev.role, dir: dev.dir || 'UP', visible: true }); continue; }
      if (this.external) continue; // mounds / bushes are 3D props then
      const gfx = new P.Graphics();
      gfx.sortableChildren = false;
      this.layers.props.addChild(gfx);
      this.devices.push({ dev, gfx, row, col, role: dev.role, dir: dev.dir || 'UP', seed: hash2(row, col), visible: true });
    }
    this._applyBattleRect();
  }

  /** In battle, crates / turrets inside the field rect are sim units (kind 'device'): hide the static ones there. */
  setBattleRect(rect) {
    const next = rect ? { ...rect } : null;
    if (JSON.stringify(next) === JSON.stringify(this.battleRect)) return;
    this.battleRect = next;
    const before = this.devBoxes.map((d) => d.visible).join();
    this._applyBattleRect();
    if (this.stage && !this.external && this.devBoxes.map((d) => d.visible).join() !== before) {
      this._buildQuads();
      this._buildMesh();
      this.camVersion = -1;
    }
  }

  _applyBattleRect() {
    const R = this.battleRect;
    const inside = (d) => !!R && d.row >= R.r0 && d.row <= R.r1 && d.col >= R.c0 && d.col <= R.c1;
    for (const d of this.devBoxes) d.visible = !(inside(d) && (d.role === 'crate' || d.role === 'turret'));
    for (const d of this.devices) { d.visible = true; d.gfx.visible = true; }
  }

  _placeDevices() {
    const cam = this.cam;
    if (!cam) return;
    for (const d of this.devices) {
      const g = d.gfx;
      g.clear();
      const z0 = this.tile(d.row, d.col).h;
      g.zIndex = rowDepthKey(cam, d.row) + ROW_KEY.devices;
      switch (d.role) {
        case 'mound': drawMound(g, cam, d.col, d.row, z0, d.seed); break;
        case 'bush': drawBush(g, cam, d.col, d.row, z0, d.seed); break;
        default: break;
      }
    }
  }

  // ---- animated terrain ------------------------------------------------------------------------------------

  /**
   * The water sheet above the units, on its own: the tile layer's animated terrain is skipped while the three.js board
   * draws the ground (see the external branch of build()), but this sheet has to exist in both modes — it is what makes
   * a body standing in water read as submerged. Same sprite, same animation, same drawn / r < 13 filtering as the rest.
   */
  _buildAnim() {
    for (const a of this.animSprites) a.sprite.destroy();
    this.animSprites = [];
    const P = this.P;
    const fx = fxAtlas();
    const R = rng(4242);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = this.grid[r][c];
      if (!t.drawn || t.scenery || r >= 13) continue;
      const add = (kind, tex, blend, tint, n = 1, layer = null) => {
        for (let i = 0; i < n; i++) {
          const s = new P.Sprite(fx.tex[tex]);
          s.anchor.set(0.5);
          s.blendMode = blend;
          s.tint = tint;
          (layer || this.animLayer).addChild(s);
          this.animSprites.push({ sprite: s, r, c, kind, phase: R() * Math.PI * 2, ox: (R() - 0.5) * 0.5, oy: (R() - 0.5) * 0.5, sp: 0.6 + R() * 0.8 });
        }
      };
      switch (t.glyph) {
        case 'g': add('smog', 'smoke', P.BLEND_MODES.NORMAL, 0xb8c4c0, 2); break;
        case 'd':
          // the shimmer under the units (the board's own look) …
          add('sea', 'soft', P.BLEND_MODES.ADD, 0x5fe0ff, 1);
          // … and the surface itself above them: a normal-blend sheet that actually covers a body standing in water
          // (ADD only lightens, so the old single sprite could not hide anything), tinted with the same colour.
          break;
        case 'i': add('infect', 'glow', P.BLEND_MODES.ADD, ORIGINIUM.glow, 1); break;
        case 'm': add('mire', 'dot', P.BLEND_MODES.ADD, 0xc8d890, 2); break;
        case 'I': case 'O': add('tel', 'ring', P.BLEND_MODES.ADD, 0xb36bff, 1); break;
        case 'S': if (r <= 12) add('gateGlow', 'glow', P.BLEND_MODES.ADD, COLORS.gateRed, 1); break;
        case 'E': if (r <= 12) add('objGlow', 'glow', P.BLEND_MODES.ADD, COLORS.objBlue, 1); break;
        default: break;
      }
    }
  }

  _placeAnim() {
    const cam = this.cam;
    if (!cam) return;
    const p = this._p;
    for (const a of this.animSprites) {
      const z = this.tile(a.r, a.c).h + 0.02;
      cam.project(a.c + (a.kind === 'smog' || a.kind === 'mire' ? a.ox : 0), a.r + (a.kind === 'smog' || a.kind === 'mire' ? a.oy : 0), z, p);
      a.x = p.x; a.y = p.y; a.s = p.s;
      a.sprite.position.set(p.x, p.y);
    }
  }

  /** Leak flash on an objective tile (b.ev 'leak'). */
  flashObjective(r, c) {
    this.flashes.push({ r, c, t: 0 });
    if (this.flashes.length > 8) this.flashes.shift();
  }

  /** Per-frame animation (dt seconds). */
  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const a of this.animSprites) {
      const s = a.sprite, px = a.s || 40;
      switch (a.kind) {
        case 'smog': {
          const k = (t * 0.25 * a.sp + a.phase) % 1;
          s.position.set(a.x + Math.sin(t * 0.5 + a.phase) * px * 0.08, a.y - k * px * 0.5);
          s.scale.set((px / 128) * (0.9 + k * 0.8), (px / 128) * (0.6 + k * 0.5));
          s.alpha = 0.55 * Math.sin(k * Math.PI);
          break;
        }
        case 'sea': s.scale.set(px / 128 * 1.05, px / 128 * 0.62); s.alpha = 0.1 + 0.08 * Math.sin(t * 1.6 + a.phase); break;
        case 'infect': s.scale.set(px / 128 * 1.2, px / 128 * 0.75); s.alpha = 0.22 + 0.16 * Math.sin(t * 2.2 + a.phase); break;
        case 'mire': {
          const k = (t * 0.6 * a.sp + a.phase) % 1;
          s.scale.set(px / 32 * 0.12 * (0.4 + k));
          s.alpha = 0.6 * (1 - k);
          break;
        }
        case 'tel': s.scale.set(px / 128 * 0.9, px / 128 * 0.55); s.alpha = 0.35 + 0.25 * Math.sin(t * 2 + a.phase); s.rotation = 0; break;
        case 'gateGlow': s.scale.set(px / 128 * 2.1, px / 128 * 1.2); s.alpha = 0.3 + 0.15 * Math.sin(t * 3.2 + a.phase); break;
        case 'objGlow': s.scale.set(px / 128 * 2.0, px / 128 * 1.15); s.alpha = 0.28 + 0.1 * Math.sin(t * 2 + a.phase); break;
        default: break;
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].t += dt; if (this.flashes[i].t > 1.2) this.flashes.splice(i, 1); }
    this._drawBoxes();
    this._drawFlow();
  }

  /** Gate / objective wire boxes: tall, so each is its own Graphics depth-sorted with the block rows and units. */
  _buildBoxes() {
    for (const b of this.boxes) b.g.destroy();
    this.boxes = [];
    // the field's gates / objectives, and the enemy preview pen's two gates (the red cubes behind which the next
    // round's enemies wait, also while the pen is dim scenery behind the prep board)
    const pen = parsePenRect(this.stage?.config?.enemy_place_rect) || PEN_RECT;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const tile = this.grid[r][c];
      if (!tile.drawn || (tile.glyph !== 'S' && tile.glyph !== 'E')) continue;
      const penGate = tile.glyph === 'S' && r >= pen.r0 && r <= pen.r1 && c >= pen.c0 && c <= pen.c1;
      if ((tile.scenery || r > 12) && !penGate) continue;
      const g = new this.P.Graphics();
      g.blendMode = this.P.BLEND_MODES.ADD;
      this.layers.props.addChild(g);
      this.boxes.push({ r, c, gate: tile.glyph === 'S', g });
    }
  }

  _drawBoxes() {
    const cam = this.cam;
    if (!cam) return;
    const t = this.time;
    for (const { r, c, gate, g } of this.boxes) {
      g.clear();
      // just in front of its row's blocks, behind the units standing in the gate
      g.zIndex = boxDepthKey(cam, r);
      let flash = 0;
      if (!gate) for (const f of this.flashes) if (f.r === r && f.c === c) flash = Math.max(flash, 1 - f.t / 1.2);
      const pulse = gate ? 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 3.4 + c)) : 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.1));
      const color = gate ? COLORS.gateRed : flash > 0 ? mixColor(COLORS.objBlue, COLORS.gateRed, flash) : COLORS.objBlue;
      drawWireBox(g, cam, c, r, 0.02, 0.96, 0.92, color, Math.min(1.25, pulse + flash * 0.6), gate);
    }
  }

  /** Airflow streaks along the blowers' rangeTiles (the machines themselves are textured boxes). */
  _drawFlow() {
    const g = this.flowGfx;
    g.clear();
    const cam = this.cam;
    if (!cam || !this.blowers.length) return;
    const p = this._p, q = { x: 0, y: 0, s: 0, depth: 0 };
    for (const d of this.blowers) {
      const tiles = Array.isArray(d.dev.rangeTiles) ? d.dev.rangeTiles : [];
      const dx = d.dir === 'LEFT' ? -1 : d.dir === 'RIGHT' ? 1 : 0, dy = d.dir === 'UP' ? 1 : d.dir === 'DOWN' ? -1 : 0;
      for (const [r, c] of tiles) {
        if (r === d.row && c === d.col) continue;
        if (!this.tile(r, c).drawn) continue;
        const z = this.heightAt(r, c) + 0.05;
        for (let k = 0; k < 3; k++) {
          const ph = (this.time * 0.9 + k / 3 + ((r * 7 + c * 3) % 10) / 10) % 1;
          const ox = (k - 1) * 0.28 * (dy !== 0 ? 1 : 0), oy = (k - 1) * 0.28 * (dx !== 0 ? 1 : 0);
          const x0 = c + ox + dx * (ph - 0.5), y0 = r + oy + dy * (ph - 0.5);
          cam.project(x0, y0, z, p);
          cam.project(x0 + dx * 0.28, y0 + dy * 0.28, z, q);
          g.lineStyle(Math.max(1, p.s * 0.022), 0xd8f6ff, 0.32 * Math.sin(ph * Math.PI));
          g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
        }
      }
    }
  }

  destroy() {
    for (const d of this.devices) d.gfx.destroy();
    for (const a of this.animSprites) a.sprite.destroy();
    for (const b of [...this.boxMeshes]) b.destroy();
    this.devices = [];
    this.animSprites = [];
    for (const m of this.meshes) m.mesh.destroy();
    for (const s of this.rowSurfaces.values()) this._freeSurface(s);
    this.meshes = []; this.rowMeshes.clear(); this.rowSurfaces.clear(); this.mesh = null; this.plane = null;
    for (const b of this.boxes) b.g.destroy();
    this.boxes = [];
    this.hlGfx.destroy(); this.flowGfx.destroy(); this.animLayer.destroy();
  }
}

// ---- projection of textured quads (shared by the tile meshes and BoxMesh) ------------------------------------

/**
 * Project mesh record `m` ({ quads, pos, uvq, col, idx, order, *Buf, noSort }) with camera `cam`: perspective-correct
 * UVs (u·w, v·w, w), per-vertex fog + spotlight shading, painter's index order.
 */
export function projectMesh(cam, m, light, p = { x: 0, y: 0, s: 0, depth: 0 }) {
  const qs = m.quads;
  const n = qs.length;
  if (!n) return;
  const camX = cam.tx;
  const pos = m.pos, uvq = m.uvq, col = m.col;
  const { fogNear, fogFar, lcx, lcy, lrx, lry } = light;
  const UVK = [[0, 1], [2, 1], [2, 3], [0, 3]]; // corner k → (u index, v index) of q.u, before rotation
  for (let i = 0; i < n; i++) {
    const q = qs[i];
    // back-facing E/W faces collapse to nothing
    let visible = q.alpha > 0;
    if (q.faceDir === 'E') visible = visible && camX > q.fx;
    else if (q.faceDir === 'W') visible = visible && camX < q.fx;
    const u = q.u;
    const rot = q.rot | 0;
    for (let k = 0; k < 4; k++) {
      const pt = q.pts[k];
      cam.project(pt[0], pt[1], pt[2], p);
      const vi = i * 4 + k;
      if (visible || k === 0) { pos[vi * 2] = p.x; pos[vi * 2 + 1] = p.y; }
      else { pos[vi * 2] = pos[i * 8]; pos[vi * 2 + 1] = pos[i * 8 + 1]; }
      const w = 1 / p.depth;
      const uk = UVK[(k - rot + 4) & 3];
      uvq[vi * 3] = u[uk[0]] * w;
      uvq[vi * 3 + 1] = u[uk[1]] * w;
      uvq[vi * 3 + 2] = w;
      const fog = Math.min(1, Math.max(0, (p.depth - fogNear) / (fogFar - fogNear)));
      // soft spotlight on the focused field (cheap "lighting": edges of the island fall off)
      const ddx = (pt[0] - lcx) / lrx, ddy = (pt[1] - lcy) / lry;
      const spot = 1 - 0.22 * Math.min(1, ddx * ddx + ddy * ddy);
      const ao = q.ao ? q.ao[k] : EXPOSURE;
      const lum = q.shade * ao * (1 - 0.42 * fog) * spot;
      col[vi * 4] = lum * (1 - 0.06 * fog);
      col[vi * 4 + 1] = lum;
      col[vi * 4 + 2] = lum * (1 + 0.05 * fog);
      col[vi * 4 + 3] = q.alpha;
    }
  }
  const order = m.order;
  for (let i = 0; i < n; i++) order[i] = i;
  if (!m.noSort) sortQuadOrder(order, qs, camX);
  const idx = m.idx;
  for (let j = 0; j < n; j++) {
    const i = order[j], b = i * 4, o = j * 6;
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
  }
  m.posBuf.update();
  m.uvqBuf.update();
  m.colBuf.update();
  m.idxBuf.update();
}

/**
 * Append the visible faces of a textured box (top + S/E/W sides; N never faces the camera) to `quads`.
 * `o`: { row, col (sort keys), rot (top texture quarter turns), alpha, kind ('block' default) }.
 */
export function boxQuads(quads, uv, cx, cy, z0, size, height, topMat, sideMat, o = {}) {
  const a = size / 2;
  const x0 = cx - a, x1 = cx + a, y0 = cy - a, y1 = cy + a, zt = z0 + height;
  const blank = (uv && uv.blank) || [0, 0, 0, 0];
  const top = (uv && uv[topMat]) || blank, side = (uv && uv[sideMat]) || blank;
  const base = { kind: o.kind || 'block', row: o.row ?? Math.round(cy), col: o.col ?? Math.round(cx), alpha: o.alpha ?? 1 };
  quads.push({ ...base, pts: sidePts('S', x0, x1, y0, y1, zt, z0), u: side, shade: 0.86, order: 1, faceDir: 'S', fx: cx });
  quads.push({ ...base, pts: sidePts('E', x0, x1, y0, y1, zt, z0), u: side, shade: 0.64, order: 1, faceDir: 'E', fx: x1 });
  quads.push({ ...base, pts: sidePts('W', x0, x1, y0, y1, zt, z0), u: side, shade: 0.64, order: 1, faceDir: 'W', fx: x0 });
  quads.push({ ...base, pts: [[x0, y1, zt], [x1, y1, zt], [x1, y0, zt], [x0, y0, zt]], u: top, shade: 1, order: 0, faceDir: 0, rot: o.rot | 0 });
  return quads;
}

/**
 * Backdrop ground plane under the island (z = −CLIFF_DEPTH), textured with repeating concrete, with contact
 * shadows baked into the vertex shading near drawn tiles.
 */
export function buildPlaneQuads(G, tilesPerRepeat = 5) {
  const quads = [];
  const T = Math.max(1, Number(tilesPerRepeat) || 5);
  const z = -CLIFF_DEPTH;
  // distance field (tiles) to the nearest drawn tile, sampled at vertices
  const drawn = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (G[r]?.[c]?.drawn) drawn.push([c, r]);
  const occl = (x, y) => {
    if (!drawn.length) return 1;
    let best = Infinity;
    for (const [c, r] of drawn) {
      const dx = Math.max(0, Math.abs(x - c) - 0.5), dy = Math.max(0, Math.abs(y - r) - 0.5);
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    const d = Math.sqrt(best);
    // contact shadow at the island's foot, then a slow falloff into the dark surroundings
    return (1 - 0.6 * Math.exp(-d / 0.9)) * (0.42 + 0.58 * Math.exp(-d / 7));
  };
  const cache = new Map();
  const ao = (x, y) => { const k = x * 1000 + y; let v = cache.get(k); if (v === undefined) { v = occl(x, y); cache.set(k, v); } return v; };
  const S = PLANE.cell;
  for (let y = PLANE.y0; y < PLANE.y1; y += S) for (let x = PLANE.x0; x < PLANE.x1; x += S) {
    const xa = x - 0.5, xb = x - 0.5 + S, ya = y - 0.5, yb = y - 0.5 + S;
    quads.push({
      kind: 'plane', row: y, col: x, order: 0, faceDir: 0, alpha: 1, shade: 0.62,
      pts: [[xa, yb, z], [xb, yb, z], [xb, ya, z], [xa, ya, z]],
      u: [xa / T, -yb / T, xb / T, -ya / T],
      ao: [ao(xa, yb), ao(xb, yb), ao(xb, ya), ao(xa, ya)],
    });
  }
  return quads;
}

/** A standalone textured box mesh (battle devices), sharing the TileField shader & atlas. */
export class BoxMesh {
  constructor(field) {
    this.field = field;
    this.quads = [];
    this.m = null;
    this.key = '';
    this.dirty = true;
    this.mesh = null;
    this.destroyed = false;
  }

  /** Material UVs changed (art swap): rebuild the quads next update. */
  retexture() { this.key = ''; this.dirty = true; }

  /** @param {any} cam @param {{ x, y, z, size, height, top, side, alpha?, rot? }} b */
  update(cam, b) {
    if (this.destroyed || !cam) return;
    const f = this.field;
    const key = `${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)},${b.size.toFixed(3)},${b.height.toFixed(3)},${b.top},${b.side},${b.rot | 0}`;
    const alpha = b.alpha ?? 1;
    if (key !== this.key) {
      this.key = key;
      const quads = boxQuads([], f.atlas.uv, b.x, b.y, b.z, b.size, b.height, b.top, b.side, { rot: b.rot, row: Math.round(b.y), col: Math.round(b.x) });
      if (!this.m || this.m.quads.length !== quads.length) {
        const parent = this.mesh?.parent || null;
        const z = this.mesh?.zIndex ?? 0;
        if (this.mesh) this.mesh.destroy();
        if (!f.shader) f.shader = f.P.Shader.from(VERT, FRAG, { uSampler: f.atlas.texture, uAlpha: 1 });
        this.m = f._makeMesh(quads, null, f.shader);
        this.mesh = this.m.mesh;
        this.mesh.zIndex = z;
        if (parent) parent.addChild(this.mesh);
      } else this.m.quads = quads;
      this.dirty = true;
    }
    if (this.m && this.m.quads.some((q) => q.alpha !== alpha)) { for (const q of this.m.quads) q.alpha = alpha; this.dirty = true; }
    if (this.dirty || this.camVersion !== cam.version) {
      this.dirty = false;
      this.camVersion = cam.version;
      projectMesh(cam, this.m, f._light(cam), f._p);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.field.boxMeshes.delete(this);
    if (this.mesh) this.mesh.destroy();
    this.mesh = null;
  }
}

/**
 * Tile geometry as quads: `{ kind: 'low'|'block'|'cliff', pts: [[x,y,z]×4], u: [u0,v0,u1,v1], shade, alpha,
 * order (0 top, 1 side), faceDir: 0|'S'|'E'|'W', fx (x of an E/W face: visible when the camera is beyond it),
 * row, col, rot? (top texture quarter turns) }`. Pure (uv map from the tile atlas).
 */
export function buildTileQuads(G, uv) {
  const quads = [];
  const blank = (uv && uv.blank) || [0, 0, 0, 0];
  const add = (kind, mat, pts, shade, alpha, order, faceDir, tile) => {
    const u = (uv && uv[mat]) || blank;
    const fx = faceDir === 'E' ? tile.c + 0.5 : faceDir === 'W' ? tile.c - 0.5 : tile.c;
    quads.push({ kind, pts, u, shade, alpha, order, faceDir, row: tile.r, col: tile.c, fx });
  };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = G[r][c];
    if (!t.drawn) continue;
    const H = t.h;
    const x0 = c - 0.5, x1 = c + 0.5, y0 = r - 0.5, y1 = r + 0.5;
    const topMat = variantMat(t);
    const dim = t.scenery ? 0.36 : t.focus ? 1 : 0.58;
    // top (texture top = far edge)
    add(H > 0 ? 'block' : 'low', topMat, [[x0, y1, H], [x1, y1, H], [x1, y0, H], [x0, y0, H]], dim, t.alpha, 0, 0, t);
    // sides: S (near), E, W. N faces are never visible (the camera is always south of the field).
    const sideMat = SIDE_MAT[t.mat] || SIDE_MAT[t.hClass] || 'lowSide';
    for (const [dir, dr, dc] of [['S', -1, 0], ['E', 0, 1], ['W', 0, -1]]) {
      const n = G[r + dr]?.[c + dc];
      const nDrawn = !!(n && n.drawn);
      const nh = nDrawn ? n.h : -CLIFF_DEPTH;
      if (H > (nDrawn ? nh : 0) + 1e-6) {
        const zb = nDrawn ? nh : 0;
        add(H > 0 ? 'block' : 'low', sideMat, sidePts(dir, x0, x1, y0, y1, H, zb), (dir === 'S' ? 0.86 : 0.66) * dim, t.alpha, 1, dir, t);
      }
      if (!nDrawn) {
        // island edge: cliff going down from the ground
        add('cliff', 'cliff', sidePts(dir, x0, x1, y0, y1, 0, -CLIFF_DEPTH), (dir === 'S' ? 0.9 : 0.62) * dim, t.alpha, 1, dir, t);
      }
    }
  }
  return quads;
}

/** Ground quads (cliffs + low tiles) and raised-block quads grouped by row (each row is depth-sorted with units). */
export function splitQuadGroups(quads) {
  const ground = [];
  const rows = new Map();
  for (const q of quads) {
    if (q.kind !== 'block') { ground.push(q); continue; }
    let list = rows.get(q.row);
    if (!list) { list = []; rows.set(q.row, list); }
    list.push(q);
  }
  return { ground, rows };
}

/**
 * Painter's order of quad indices (in place): cliffs, then low tiles far→near, then blocks far→near, outer→inner
 * (by distance from the camera's column) within a row, each block's sides before its top.
 */
export function sortQuadOrder(order, qs, camX) {
  return order.sort((a, b) => {
    const A = qs[a], B = qs[b];
    const ka = A.kind === 'cliff' ? 0 : A.kind === 'low' ? 1 : 2;
    const kb = B.kind === 'cliff' ? 0 : B.kind === 'low' ? 1 : 2;
    if (ka !== kb) return ka - kb;
    if (ka === 2 || ka === 0) {
      if (A.row !== B.row) return B.row - A.row;
      const da = Math.abs(A.col - camX), db = Math.abs(B.col - camX);
      if (da !== db) return db - da;
      if (A.col !== B.col) return A.col - B.col;
      return B.order - A.order; // sides (1) before top (0)
    }
    return B.row - A.row || A.col - B.col || B.order - A.order;
  });
}

function sidePts(dir, x0, x1, y0, y1, zt, zb) {
  switch (dir) {
    case 'S': return [[x0, y0, zt], [x1, y0, zt], [x1, y0, zb], [x0, y0, zb]];
    case 'E': return [[x1, y0, zt], [x1, y1, zt], [x1, y1, zb], [x1, y0, zb]];
    case 'W': return [[x0, y1, zt], [x0, y0, zt], [x0, y0, zb], [x0, y1, zb]];
    default: return [[x0, y1, zt], [x1, y1, zt], [x1, y1, zb], [x0, y1, zb]];
  }
}

export function mixColor(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * k) << 16) | (Math.round(ag + (bg - ag) * k) << 8) | Math.round(ab + (bb - ab) * k);
}

// ---- device drawing helpers (Graphics, projected corners) -----------------------------------------------------

function boxCorners(cam, cx, cy, z0, size, height) {
  const a = size / 2;
  const P = (x, y, z) => { const p = cam.project(x, y, z); return [p.x, p.y]; };
  return {
    // bottom
    b0: P(cx - a, cy - a, z0), b1: P(cx + a, cy - a, z0), b2: P(cx + a, cy + a, z0), b3: P(cx - a, cy + a, z0),
    // top
    t0: P(cx - a, cy - a, z0 + height), t1: P(cx + a, cy - a, z0 + height), t2: P(cx + a, cy + a, z0 + height), t3: P(cx - a, cy + a, z0 + height),
  };
}

function poly(g, pts, color, alpha = 1, line = null) {
  if (line) g.lineStyle(line[0], line[1], line[2] ?? 1, 0.5); else g.lineStyle(0);
  g.beginFill(color, alpha);
  g.drawPolygon(pts.flat());
  g.endFill();
}

function drawBox(g, cam, cx, cy, z0, size, height, top, front, side) {
  const k = boxCorners(cam, cx, cy, z0, size, height);
  const camX = cam.tx;
  if (camX > cx + size / 2) poly(g, [k.b1, k.b2, k.t2, k.t1], side);
  if (camX < cx - size / 2) poly(g, [k.b3, k.b0, k.t0, k.t3], side);
  poly(g, [k.b0, k.b1, k.t1, k.t0], front);
  poly(g, [k.t0, k.t1, k.t2, k.t3], top);
  return k;
}

function drawCrate(g, cam, cx, cy, z0, size, height, seed) {
  const s = cam.scaleAt(cx, cy, z0);
  // soft contact shadow
  const sh = boxCorners(cam, cx, cy, z0 + 0.001, size + 0.16, 0);
  poly(g, [sh.b0, sh.b1, sh.b2, sh.b3], 0x000000, 0.28);
  const k = drawBox(g, cam, cx, cy, z0, size, height, 0xc89a5a, 0x9a6d38, 0x7d5529);
  const lw = Math.max(1, s * 0.022);
  // plank lines on the front
  g.lineStyle(lw * 0.8, 0x5a3a18, 0.55);
  for (const f of [0.33, 0.66]) {
    const y0 = lerp2(k.b0, k.t0, f), y1 = lerp2(k.b1, k.t1, f);
    g.moveTo(y0[0], y0[1]); g.lineTo(y1[0], y1[1]);
  }
  // X brace + frame
  g.lineStyle(lw * 1.6, 0xe0b877, 0.95);
  g.moveTo(k.b0[0], k.b0[1]); g.lineTo(k.t1[0], k.t1[1]);
  g.moveTo(k.b1[0], k.b1[1]); g.lineTo(k.t0[0], k.t0[1]);
  g.lineStyle(lw * 1.8, 0x3c2810, 0.9);
  g.drawPolygon([...k.b0, ...k.b1, ...k.t1, ...k.t0]);
  g.drawPolygon([...k.t0, ...k.t1, ...k.t2, ...k.t3]);
  // lid highlight + center diamond marker (like the original's blue diamonds)
  g.lineStyle(lw, 0xffe2a8, 0.7);
  g.moveTo(k.t3[0], k.t3[1]); g.lineTo(k.t2[0], k.t2[1]);
  const c = cam.project(cx, cy - size / 2, z0 + height * 0.5);
  const d = s * 0.1;
  g.lineStyle(lw * 1.2, 0x7fd3ff, 0.95);
  g.drawPolygon([c.x, c.y - d, c.x + d, c.y, c.x, c.y + d, c.x - d, c.y]);
  void seed;
}

function drawMound(g, cam, cx, cy, z0, seed) {
  const R = rng(seed);
  for (let i = 0; i < 5; i++) {
    const p = cam.project(cx + (R() - 0.5) * 0.5, cy + (R() - 0.5) * 0.4, z0 + 0.12 + i * 0.03);
    const s = p.s * (0.28 + R() * 0.12);
    g.lineStyle(0);
    g.beginFill(i % 2 ? 0x8a7a5e : 0x75664c, 1);
    g.drawEllipse(p.x, p.y, s, s * 0.62);
    g.endFill();
  }
}

function drawBush(g, cam, cx, cy, z0, seed) {
  const R = rng(seed);
  for (let i = 0; i < 6; i++) {
    const p = cam.project(cx + (R() - 0.5) * 0.55, cy + (R() - 0.5) * 0.45, z0 + 0.18 + R() * 0.2);
    const s = p.s * (0.2 + R() * 0.1);
    g.lineStyle(0);
    g.beginFill(i % 2 ? 0x3f7a3a : 0x2f6230, 0.95);
    g.drawCircle(p.x, p.y, s);
    g.endFill();
  }
}

const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Glowing wireframe box (gates / objective) with a warning glyph on the front face. */
function drawWireBox(g, cam, cx, cy, z0, size, height, color, pulse, gate) {
  const k = boxCorners(cam, cx, cy, z0, size, height);
  const s = cam.scaleAt(cx, cy, z0);
  const lw = Math.max(1.2, s * 0.028);
  // faces
  g.lineStyle(0);
  g.beginFill(color, 0.08 * pulse); g.drawPolygon([...k.b0, ...k.b1, ...k.t1, ...k.t0]); g.endFill();
  g.beginFill(color, 0.05 * pulse); g.drawPolygon([...k.t0, ...k.t1, ...k.t2, ...k.t3]); g.endFill();
  // back edges (dim)
  g.lineStyle(lw * 0.7, color, 0.3 * pulse);
  g.moveTo(k.b2[0], k.b2[1]); g.lineTo(k.b3[0], k.b3[1]);
  g.moveTo(k.b2[0], k.b2[1]); g.lineTo(k.t2[0], k.t2[1]);
  g.moveTo(k.b3[0], k.b3[1]); g.lineTo(k.t3[0], k.t3[1]);
  g.moveTo(k.b1[0], k.b1[1]); g.lineTo(k.b2[0], k.b2[1]);
  g.moveTo(k.b0[0], k.b0[1]); g.lineTo(k.b3[0], k.b3[1]);
  // front + top edges (bright)
  g.lineStyle(lw * 1.6, color, 0.95 * pulse);
  g.drawPolygon([...k.b0, ...k.b1, ...k.t1, ...k.t0]);
  g.drawPolygon([...k.t0, ...k.t1, ...k.t2, ...k.t3]);
  g.lineStyle(lw * 3.2, color, 0.25 * pulse);
  g.drawPolygon([...k.t0, ...k.t1, ...k.t2, ...k.t3]);
  // corner ticks on the front face
  g.lineStyle(lw * 1.3, 0xffffff, 0.55 * pulse);
  const tick = 0.18;
  for (const [a, b, c2] of [[k.b0, k.b1, k.t0], [k.b1, k.b0, k.t1], [k.t0, k.t1, k.b0], [k.t1, k.t0, k.b1]]) {
    const p1 = lerp2(a, b, tick), p2 = lerp2(a, c2, tick);
    g.moveTo(p1[0], p1[1]); g.lineTo(a[0], a[1]); g.lineTo(p2[0], p2[1]);
  }
  // warning triangle glyph on the front face
  const f = cam.project(cx, cy - size / 2, z0 + height * 0.5);
  const tri = s * 0.2;
  g.lineStyle(lw * 1.4, gate ? 0xffd0c8 : 0xd8f0ff, 0.95 * pulse);
  g.drawPolygon([f.x, f.y - tri, f.x + tri * 1.1, f.y + tri * 0.8, f.x - tri * 1.1, f.y + tri * 0.8]);
  g.lineStyle(0);
  g.beginFill(gate ? 0xffd0c8 : 0xd8f0ff, 0.95 * pulse);
  g.drawRect(f.x - lw * 0.7, f.y - tri * 0.45, lw * 1.4, tri * 0.75);
  g.drawCircle(f.x, f.y + tri * 0.52, lw * 0.9);
  g.endFill();
}

export { drawCrate, drawWireBox };
