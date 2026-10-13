// render/board3d/layout.js — the official board's geometry, built from a stage grid the way the client builds the
// autochess board at runtime (DESIGN §15): pure JS, no three import (tested in Node; render/board3d/scene.js turns
// the buckets into merged BufferGeometries).
//
//   const board = buildBoard(stage, { uv: resolveUvTable(tiles), crate?: objMesh, area?: AREAS.normal })
//   → { grid, buckets: { board, decal, pipe }, gates: [{ r, c, kind: 'start'|'end' }], devices: [...],
//       terrain: { water, mire, smog, infection: [[r,c]…] }, edges: [...cyan field edge strips], bounds, stats }
// `devices` = the active stage devices standing on a built tile — separator walls included (act2 m01's blowers: the
// row-13 ones at the top edge of the normal / 联防 field, the row-6 ones at its bottom edge and at the top edge of the
// Final Assault field — user playtest #5 item 6 and its follow-up).
//
// World space = render/projection.js: x = col, y = row, z = height (up); tile (r,c) covers [c±½]×[r±½].
// Heights follow render/style.js TILE_H (the Pixi layers stand units on the same tops: tiles.js heightAt).
//
// Tiles (glyph legend DATA.md §12):
//   LOW  r road → concrete slab (8 rotation/flip variants) · R → hazard-striped concrete · f / p lane & preview pen →
//        the hazard-framed glass hatch · b fence → concrete + an orange tubular railing around the fenced region ·
//        S gate → chevron concrete (+ the official red start box, scene.js) · E objective → gold ring hatch (+ blue
//        end box) · I / O → lift plate + ▼/▲ plate · m / g / d / i → concrete / grille / sunk basin / concrete with the
//        animated terrain overlay of scene.js
//   HIGH h → gold-framed plates chosen by connectivity (strip L / M / R, vertical strips, single) with gold ribbed
//        sides · # / X → dark hatched blocks ("▨", the official boss-field / arena look; X with REST AREA /
//        EVACUATION wall panels) · a / A → REINFORCEMENTS / EQUIPMENTS bench pads (own bench), concrete plates
//        (Final Assault benches)
// Every top has a small bevel (tile seams catch the light), raised blocks have chamfered edges, vertex colours carry
// ambient occlusion at wall feet. The enemy preview pen's hatches (enemy_place_rect) go to their own `glass` bucket:
// the official pen reads as glossy glass panes in a hazard frame reflecting the sky (scene.js glassMaterial), not as
// the striped hatch. The Final Assault benches (rows 0–1) are dark-rimmed plates with a 2×2 grid of light panels. The island ("drawn" tiles: content + the forbidden ring around it) stands on
// panelled cliff faces; beyond it the official background plane shows through (scene.js).

import { SURFACES, surfaceUV, sideRect, tintRgb } from './atlas.js';
import { GLYPH, TILEKEY_GLYPH, TILE_H } from '../style.js';
import { parsePenRect, PEN_RECT } from '../pen.js';

export const ROWS = 19;
export const COLS = 21;
/** How far the island's cliff faces go down (tiles). */
export const CLIFF = 0.75;
/** Top bevel: inset (tiles) and drop (tiles) of low tiles and raised blocks. */
export const BEVEL = Object.freeze({ low: [0.035, 0.018], block: [0.04, 0.035] });
/** Deep-sea basins: floor depth below the ground. */
export const BASIN = 0.14;

const CONTENT_OF = (g) => g !== '#' && g !== 'X';

/**
 * Areas built per phase (inclusive tile rects; configBlackBoard leftNormal ((6,0),(12,10)), rightNormal
 * ((6,11),(12,20)), leftBoss ((0,0),(6,10)), rightBoss ((0,11),(6,20)); enemy_place_rect ((14,7),(18,13)) + the
 * separator in front of it). The official prep / battle view shows only the player's own field and the preview pen
 * (the island ends under the bench row); 联防 joins both normal halves; the Final Assault builds the boss field.
 * The normal / 联防 field rects also take the separator row 13 above the field (like leftBoss takes row 6 above the
 * boss field): the devices standing on it act on the field — act2 m01's 源石流发生装置 #001/#002 (#101/#102) at (13, 5 /
 * 9 / 13 / 17) blow DOWN into rows 12–10 — and the official normal rounds show those machines at the field's top edge
 * (user playtest #5 item 6: the wind lanes worked but the blowers were missing; the 2D board always drew row 13). The
 * row-6 wall under the bench is built in these views too (in leftNormal), with the boss field's blowers standing on it.
 */
export const AREAS = Object.freeze({
  normal: Object.freeze([Object.freeze({ r0: 6, r1: 13, c0: 0, c1: 10 }), Object.freeze({ r0: 13, r1: 18, c0: 6, c1: 14 })]),
  unite: Object.freeze([Object.freeze({ r0: 6, r1: 13, c0: 0, c1: 20 }), Object.freeze({ r0: 13, r1: 18, c0: 6, c1: 14 })]),
  boss: Object.freeze([Object.freeze({ r0: 0, r1: 6, c0: 0, c1: 20 })]),
  all: Object.freeze([Object.freeze({ r0: 0, r1: 18, c0: 0, c1: 20 })]),
});

/** Area set of a camera kind ('prep' | 'normal' | 'pen' | 'unite' | 'boss' | 'hidden' | 'bossPrep'). */
export function areaFor(kind) {
  if (kind === 'unite') return AREAS.unite;
  if (kind === 'boss' || kind === 'hidden' || kind === 'bossPrep') return AREAS.boss;
  return AREAS.normal;
}

/** Union of area sets (camera transitions show both). */
export function unionAreas(...sets) {
  const out = [];
  const seen = new Set();
  for (const s of sets) for (const a of s || []) { const k = `${a.r0},${a.r1},${a.c0},${a.c1}`; if (!seen.has(k)) { seen.add(k); out.push(a); } }
  return out;
}
const hash2 = (r, c) => ((r * 73856093) ^ (c * 19349663)) >>> 0;

// ---- geometry accumulator ----------------------------------------------------------------------------------

export class Geom {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
  /**
   * Quad from 4 corners in counter-clockwise order seen from the front (BL, BR, TR, TL), `uv` = 8 numbers in the
   * same corner order, `nrm` one [x,y,z] (flat) or 4, `col` one [r,g,b] or 4.
   */
  quad(p, uv, nrm, col) {
    const base = this.n;
    for (let k = 0; k < 4; k++) {
      const q = p[k];
      this.pos.push(q[0], q[1], q[2]);
      const nn = Array.isArray(nrm[0]) ? nrm[k] : nrm;
      this.nrm.push(nn[0], nn[1], nn[2]);
      this.uv.push(uv ? uv[k * 2] : 0, uv ? uv[k * 2 + 1] : 0);
      const cc = col ? (Array.isArray(col[0]) ? col[k] : col) : [1, 1, 1];
      this.col.push(cc[0], cc[1], cc[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.n += 4;
    return this;
  }
  /** Triangle (CCW from the front). */
  tri(p, nrm, col) {
    const base = this.n;
    for (let k = 0; k < 3; k++) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      const nn = Array.isArray(nrm[0]) ? nrm[k] : nrm;
      this.nrm.push(nn[0], nn[1], nn[2]);
      this.uv.push(0, 0);
      const cc = col ? (Array.isArray(col[0]) ? col[k] : col) : [1, 1, 1];
      this.col.push(cc[0], cc[1], cc[2]);
    }
    this.idx.push(base, base + 1, base + 2);
    this.n += 3;
    return this;
  }
  get vertexCount() { return this.n; }
  get triangleCount() { return this.idx.length / 3; }
  /** Typed arrays for a BufferGeometry. */
  finish() {
    return {
      position: new Float32Array(this.pos), normal: new Float32Array(this.nrm), uv: new Float32Array(this.uv),
      color: new Float32Array(this.col), index: this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      vertexCount: this.n, triangleCount: this.idx.length / 3,
    };
  }
}

const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

/** Bilinear UV at fractions (fx right, fy far) of a face whose corner UVs are [BL, BR, TR, TL] (8 numbers). */
export function uvAt(uv, fx, fy) {
  const bu = uv[0] + (uv[2] - uv[0]) * fx, bv = uv[1] + (uv[3] - uv[1]) * fx;
  const tu = uv[6] + (uv[4] - uv[6]) * fx, tv = uv[7] + (uv[5] - uv[7]) * fx;
  return [bu + (tu - bu) * fy, bv + (tv - bv) * fy];
}

// ---- stage classification -----------------------------------------------------------------------------------

/**
 * Per-tile description of a stage: `{ r, c, glyph, content, drawn, h (top height), raised, surf (top surface),
 * tint, side (side panel surface) }`. Tolerant of malformed stages (missing rows → forbidden). `area` = the built
 * areas (inclusive tile rects, see AREAS): content outside them is not built, like the client which only builds the
 * areas of the current phase (configBlackBoard leftNormal / rightNormal / leftBoss / rightBoss + the preview pen).
 */
export function classifyStage(stage, area = null) {
  const rows = Array.isArray(stage?.rows) ? stage.rows : [];
  const pen = parsePenRect(stage?.config?.enemy_place_rect) || PEN_RECT;
  const legend = stage && typeof stage.tiles === 'object' && stage.tiles ? stage.tiles : {};
  const grid = [];
  for (let r = 0; r < ROWS; r++) {
    const line = typeof rows[r] === 'string' ? rows[r] : '';
    const row = [];
    for (let c = 0; c < COLS; c++) {
      let g = line[c] || '#';
      if (!GLYPH[g]) g = TILEKEY_GLYPH[legend[g]?.tileKey] || (legend[g]?.height === 'HIGH' ? '#' : 'R');
      const def = GLYPH[g];
      const inArea = !area || area.some((a) => r >= a.r0 && r <= a.r1 && c >= a.c0 && c <= a.c1);
      row.push({ r, c, glyph: g, content: inArea && CONTENT_OF(g), inArea, drawn: false, h: def.h ? TILE_H[def.h] : 0, raised: !!def.h });
    }
    grid.push(row);
  }
  // the island: content tiles + the forbidden / separator ring around them (Chebyshev 1)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = grid[r][c];
    if (t.content) { t.drawn = true; continue; }
    if (!t.inArea) continue;
    let near = false;
    for (let dr = -1; dr <= 1 && !near; dr++) for (let dc = -1; dc <= 1; dc++) {
      const n = grid[r + dr]?.[c + dc];
      if (n && n.content) { near = true; break; }
    }
    t.drawn = near;
  }
  const at = (r, c) => grid[r]?.[c] || null;
  for (const row of grid) for (const t of row) {
    t.tint = [1, 1, 1];
    t.surf = 'concrete';
    t.rot = 0; t.flipX = false;
    const h = hash2(t.r, t.c);
    switch (t.glyph) {
      case 'r': t.rot = (h % 4) * 90; t.flipX = ((h >> 3) & 1) === 1; break;
      case 'R': t.surf = 'concreteStripe'; t.rot = (h & 1) ? 180 : 0; break;
      case 'f': case 'p':
        t.surf = 'hatch'; t.rot = (h % 4) * 90; if (t.glyph === 'p') t.tint = [0.9, 0.92, 0.95];
        t.glass = t.r >= pen.r0 && t.r <= pen.r1 && t.c >= pen.c0 && t.c <= pen.c1;
        break;
      case 'b': t.rot = (h % 4) * 90; break;
      case 'S': t.surf = 'concreteArrow'; break;
      case 'E': t.surf = 'ringHatch'; break;
      case 'I': case 'O': t.surf = 'lift'; t.rot = t.glyph === 'O' ? 180 : 0; break;
      case 'g': t.surf = 'slats'; t.tint = [0.72, 0.76, 0.78]; break;
      case 'm': t.rot = (h % 4) * 90; t.tint = [0.78, 0.8, 0.7]; break;
      case 'i': t.rot = (h % 4) * 90; t.tint = [0.95, 0.88, 0.86]; break;
      case 'd': t.surf = 'concrete'; t.tint = [0.35, 0.42, 0.46]; break;
      // the own bench (rows 7–8): REINFORCEMENTS / EQUIPMENTS pads; the Final Assault benches (rows 0–1) are plain
      // 2×2-slab concrete plates in the official boss field
      case 'a': t.surf = t.r <= 1 ? 'concrete' : 'padReinf'; t.side = 'benchRail'; if (t.r <= 1) { t.tint = [0.3, 0.32, 0.35]; t.panels = true; } break;
      case 'A': t.surf = t.r <= 1 ? 'concrete' : 'padEquip'; t.side = 'benchRail'; if (t.r <= 1) { t.tint = [0.3, 0.32, 0.35]; t.panels = true; } break;
      case 'h': t.side = 'goldSide'; break;
      // forbidden blocks and separators: the dark hatched ("▨") blocks of the official boss field / arena rows
      case '#': t.surf = 'hatch'; t.rot = (h & 1) ? 90 : 0; t.tint = [0.34, 0.36, 0.39]; t.side = 'graySide'; t.sideTint = [0.52, 0.55, 0.58]; break;
      case 'X': t.surf = 'hatch'; t.tint = [0.36, 0.38, 0.41]; t.side = (t.c % 5 === 2) ? 'evacPanel' : 'restPanel'; t.sideTint = [0.8, 0.82, 0.86]; break;
      default: break;
    }
  }
  // high-ground plates by connectivity (texture top = the tile's far edge)
  const wall = (r, c) => { const n = at(r, c); return !!n && n.glyph === 'h'; };
  for (const row of grid) for (const t of row) {
    if (t.glyph !== 'h') continue;
    const L = wall(t.r, t.c - 1), R = wall(t.r, t.c + 1);
    if (L || R) { t.surf = L && R ? 'plateM' : R ? 'plateL' : 'plateR'; continue; }
    const near = wall(t.r - 1, t.c), far = wall(t.r + 1, t.c);
    if (near && far) { t.surf = 'plateM'; t.rot = 90; }
    else if (far) { t.surf = 'plateL'; t.rot = 270; }
    else if (near) { t.surf = 'plateL'; t.rot = 90; }
    else t.surf = 'plateS';
  }
  return grid;
}

/** Top height of tile (r,c) of a classified grid (0 off-grid / not drawn), like tiles.js heightAt. */
export function heightOf(grid, r, c) {
  const t = grid[r]?.[c];
  return t && t.drawn ? t.h : 0;
}

// ---- builder ----------------------------------------------------------------------------------------------------

const DIRS = [['S', 0, -1], ['E', 1, 0], ['N', 0, 1], ['W', -1, 0]];
const NRM = { S: [0, -1, 0], E: [1, 0, 0], N: [0, 1, 0], W: [-1, 0, 0] };

/** Corners (BL, BR, TR, TL seen from outside) of the side face `dir` of box [x0,x1]×[y0,y1] between zb and zt. */
export function sideCorners(dir, x0, x1, y0, y1, zb, zt) {
  switch (dir) {
    case 'S': return [[x0, y0, zb], [x1, y0, zb], [x1, y0, zt], [x0, y0, zt]];
    case 'N': return [[x1, y1, zb], [x0, y1, zb], [x0, y1, zt], [x1, y1, zt]];
    case 'E': return [[x1, y0, zb], [x1, y1, zb], [x1, y1, zt], [x1, y0, zt]];
    default: return [[x0, y1, zb], [x0, y0, zb], [x0, y0, zt], [x0, y1, zt]];
  }
}

const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/**
 * Beveled top of a tile: an inset flat top at `zt` + 4 sloped strips down to `zt − drop` at the tile border.
 * `ao` = corner occlusion [NL, NR, FR, FL] (1 = open).
 */
function bevelTop(g, uvTable, t, zt, inset, drop, ao, tint) {
  const x0 = t.c - 0.5, x1 = t.c + 0.5, y0 = t.r - 0.5, y1 = t.r + 0.5;
  const surf = uvTable[t.surf] || uvTable.concrete;
  const uv = surfaceUV({ ...surf, rot: ((surf.rot | 0) + (t.rot | 0)) % 360, flipX: !!surf.flipX !== !!t.flipX });
  const b = inset, zo = zt - drop;
  const f = (fx, fy) => uvAt(uv, fx, fy);
  const colAt = (fx, fy) => {
    // bilinear corner AO
    const a = ao[0] + (ao[1] - ao[0]) * fx, d = ao[3] + (ao[2] - ao[3]) * fx;
    return scl(tint, a + (d - a) * fy);
  };
  const ib = b, ie = 1 - b;
  // inner flat top
  const P = (fx, fy, z) => [x0 + fx, y0 + fy, z];
  g.quad([P(ib, ib, zt), P(ie, ib, zt), P(ie, ie, zt), P(ib, ie, zt)],
    [...f(ib, ib), ...f(ie, ib), ...f(ie, ie), ...f(ib, ie)], [0, 0, 1],
    [colAt(ib, ib), colAt(ie, ib), colAt(ie, ie), colAt(ib, ie)]);
  if (drop <= 0) return;
  const ns = norm3(0, -drop, b), nn = norm3(0, drop, b), ne = norm3(drop, 0, b), nw = norm3(-drop, 0, b);
  // south strip (outer edge y0)
  g.quad([P(0, 0, zo), P(1, 0, zo), P(ie, ib, zt), P(ib, ib, zt)], [...f(0, 0), ...f(1, 0), ...f(ie, ib), ...f(ib, ib)], ns,
    [colAt(0, 0), colAt(1, 0), colAt(ie, ib), colAt(ib, ib)]);
  // north strip (outer edge y1), seen from the north: BL = (1,1)
  g.quad([P(1, 1, zo), P(0, 1, zo), P(ib, ie, zt), P(ie, ie, zt)], [...f(1, 1), ...f(0, 1), ...f(ib, ie), ...f(ie, ie)], nn,
    [colAt(1, 1), colAt(0, 1), colAt(ib, ie), colAt(ie, ie)]);
  // east strip (outer edge x1), seen from the east: BL = (1,0)
  g.quad([P(1, 0, zo), P(1, 1, zo), P(ie, ie, zt), P(ie, ib, zt)], [...f(1, 0), ...f(1, 1), ...f(ie, ie), ...f(ie, ib)], ne,
    [colAt(1, 0), colAt(1, 1), colAt(ie, ie), colAt(ie, ib)]);
  // west strip (outer edge x0), seen from the west: BL = (0,1)
  g.quad([P(0, 1, zo), P(0, 0, zo), P(ib, ib, zt), P(ib, ie, zt)], [...f(0, 1), ...f(0, 0), ...f(ib, ib), ...f(ib, ie)], nw,
    [colAt(0, 1), colAt(0, 0), colAt(ib, ib), colAt(ib, ie)]);
}

/** Final Assault bench plate: a 2×2 grid of light concrete panels on the dark-rimmed top (the official boss field). */
export const PANEL = Object.freeze({ rim: 0.085, seam: 0.05, lift: 0.004 });
function benchPanels(g, uvTable, t, zt, ao) {
  const surf = uvTable.concrete || uvTable.steel;
  if (!surf) return;
  const x0 = t.c - 0.5, y0 = t.r - 0.5, z = zt + PANEL.lift;
  const a = PANEL.rim, h = PANEL.seam / 2;
  const light = [0.9, 0.92, 0.94];
  const span = [[a, 0.5 - h], [0.5 + h, 1 - a]];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const [fx0, fx1] = span[i], [fy0, fy1] = span[j];
    // each panel shows a quarter of the concrete slab (texture v runs down: the far edge is the top of the crop)
    const uv = surfaceUV(surf, [i * 0.5, (1 - j) * 0.5, i * 0.5 + 0.5, (1 - j) * 0.5 + 0.5]);
    const col = (fx, fy) => { const s0 = ao[0] + (ao[1] - ao[0]) * fx, s1 = ao[3] + (ao[2] - ao[3]) * fx; return scl(light, s0 + (s1 - s0) * fy); };
    g.quad([[x0 + fx0, y0 + fy0, z], [x0 + fx1, y0 + fy0, z], [x0 + fx1, y0 + fy1, z], [x0 + fx0, y0 + fy1, z]], uv, [0, 0, 1],
      [col(fx0, fy0), col(fx1, fy0), col(fx1, fy1), col(fx0, fy1)]);
  }
}

/** A panelled side face from zb to zt; the panel texture keeps its aspect (repeats along the face if needed). */
function sideFace(g, uvTable, surfName, dir, x0, x1, y0, y1, zb, zt, colBottom, colTop, width = 1) {
  if (zt - zb < 1e-4) return;
  const surf = uvTable[surfName] || uvTable.graySide;
  const uv = surfaceUV(surf, sideRect(surf, width, zt - zb));
  const c = sideCorners(dir, x0, x1, y0, y1, zb, zt);
  g.quad(c, uv, NRM[dir], [colBottom, colBottom, colTop, colTop]);
}

/**
 * Build the whole board of a stage.
 * @param {any} stage data/stages.json entry
 * @param {{ uv?: object, devices?: boolean }} [opts] uv = resolveUvTable(tiles.json) (defaults to the built-in table)
 */
export function buildBoard(stage, opts = {}) {
  const uvTable = opts.uv || null;
  const UVT = uvTable || Object.fromEntries(Object.entries(SURFACES).map(([k, v]) => [k, { ...v, rect: [...v.rect] }]));
  const grid = classifyStage(stage, opts.area || null);
  const at = (r, c) => grid[r]?.[c] || null;
  const topZ = (t) => (t.glyph === 'd' ? -BASIN : t.h);
  const board = new Geom(), decal = new Geom(), pipe = new Geom(), glass = new Geom();
  const gates = [], terrain = { water: [], mire: [], smog: [], infection: [] };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = grid[r][c];
    if (!t.drawn) continue;
    minX = Math.min(minX, c - 0.5); maxX = Math.max(maxX, c + 0.5); minY = Math.min(minY, r - 0.5); maxY = Math.max(maxY, r + 0.5);
    const zt = topZ(t);
    const x0 = c - 0.5, x1 = c + 0.5, y0 = r - 0.5, y1 = r + 0.5;
    const tint = t.tint;
    // corner occlusion: a corner touching a taller neighbour darkens (NL, NR, FR, FL)
    const occl = (dx, dy) => {
      let hi = false;
      for (const [ax, ay] of [[0, 0], [dx, 0], [0, dy], [dx, dy]]) {
        const n = at(r + ay, c + ax);
        if (n && n.drawn && topZ(n) > zt + 0.05) hi = true;
      }
      return hi ? 0.66 : 1;
    };
    const ao = [occl(-1, -1), occl(1, -1), occl(1, 1), occl(-1, 1)];
    const [inset, drop] = t.raised ? BEVEL.block : BEVEL.low;
    bevelTop(t.glass ? glass : board, UVT, t, zt, inset, t.glyph === 'd' ? 0 : drop, ao, tint);
    if (t.panels) benchPanels(board, UVT, t, zt, ao);
    const zEdge = zt - (t.glyph === 'd' ? 0 : drop);
    // sides: towards lower drawn neighbours (block sides / basin walls) and the island edge (cliffs)
    for (const [dir, dx, dy] of DIRS) {
      const n = at(r + dy, c + dx);
      const nDrawn = !!(n && n.drawn);
      const nz = nDrawn ? topZ(n) - (n.glyph === 'd' ? 0 : (n.raised ? BEVEL.block[1] : BEVEL.low[1])) : -CLIFF;
      if (!nDrawn) {
        // island edge: the tile's own side (if raised) then the platform's panelled cliff
        const sideTint = t.sideTint || [1, 1, 1];
        if (zEdge > 0.001) sideFace(board, UVT, t.side || 'graySide', dir, x0, x1, y0, y1, 0, zEdge, scl(sideTint, 0.7), sideTint);
        sideFace(board, UVT, 'pipePanel', dir, x0, x1, y0, y1, -CLIFF, Math.min(0, zEdge), [0.16, 0.18, 0.2], [0.62, 0.66, 0.7], 1);
        continue;
      }
      if (zEdge > nz + 1e-4) {
        const surf = t.glyph === 'd' ? 'graySide' : (t.side || 'graySide');
        const st = t.sideTint || (t.glyph === 'd' ? [0.45, 0.5, 0.55] : [1, 1, 1]);
        sideFace(board, UVT, surf, dir, x0, x1, y0, y1, nz, zEdge, scl(st, 0.62), st);
      }
    }
    // per-glyph extras
    switch (t.glyph) {
      case 'S': gates.push({ r, c, kind: 'start', z: 0 }); break;
      case 'E': gates.push({ r, c, kind: 'end', z: 0 }); break;
      case 'I': case 'O': {
        const surf = UVT[t.glyph === 'I' ? 'arrowDown' : 'arrowUp'];
        if (surf) {
          const a = 0.3, z = zt + 0.004;
          decal.quad([[c - a, r - a, z], [c + a, r - a, z], [c + a, r + a, z], [c - a, r + a, z]], surfaceUV(surf), [0, 0, 1], [1, 1, 1]);
        }
        break;
      }
      case 'd': terrain.water.push([r, c]); break;
      case 'm': terrain.mire.push([r, c]); break;
      case 'g': terrain.smog.push([r, c]); break;
      case 'i': terrain.infection.push([r, c]); break;
      default: break;
    }
  }

  // fence railings: orange pipes around every connected region of fenced tiles ('b'), posts at the corners
  const fence = (r, c) => { const n = at(r, c); return !!n && n.drawn && n.glyph === 'b'; };
  const rail = { inset: 0.07, h: 0.26, rad: 0.032, post: 0.038 };
  const posts = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (!fence(r, c)) continue;
    const e = rail.inset;
    const x0 = c - 0.5, x1 = c + 0.5, y0 = r - 0.5, y1 = r + 0.5;
    const S = !fence(r - 1, c), N = !fence(r + 1, c), W = !fence(r, c - 1), E = !fence(r, c + 1);
    const xa = W ? x0 + e : x0, xb = E ? x1 - e : x1, ya = S ? y0 + e : y0, yb = N ? y1 - e : y1;
    if (S) tube(pipe, [xa, y0 + e, rail.h], [xb, y0 + e, rail.h], rail.rad);
    if (N) tube(pipe, [xa, y1 - e, rail.h], [xb, y1 - e, rail.h], rail.rad);
    if (W) tube(pipe, [x0 + e, ya, rail.h], [x0 + e, yb, rail.h], rail.rad);
    if (E) tube(pipe, [x1 - e, ya, rail.h], [x1 - e, yb, rail.h], rail.rad);
    const corner = (x, y, key) => { if (!posts.has(key)) { posts.add(key); tube(pipe, [x, y, 0], [x, y, rail.h + rail.rad], rail.post); } };
    if (S && W) corner(x0 + e, y0 + e, `${r},${c},sw`);
    if (S && E) corner(x1 - e, y0 + e, `${r},${c},se`);
    if (N && W) corner(x0 + e, y1 - e, `${r},${c},nw`);
    if (N && E) corner(x1 - e, y1 - e, `${r},${c},ne`);
    // a mid post on long straight runs keeps the railing from floating
    if (S && !W && !E && (c % 2 === 0)) corner(x0, y0 + e, `${r},${c},sm`);
    if (N && !W && !E && (c % 2 === 0)) corner(x0, y1 - e, `${r},${c},nm`);
    if (W && !S && !N && (r % 2 === 0)) corner(x0 + e, y0, `${r},${c},wm`);
    if (E && !S && !N && (r % 2 === 0)) corner(x1 - e, y0, `${r},${c},em`);
  }

  // cyan field edge: emissive strips along the play areas' outer border (the official boundary glow)
  const edges = [];
  const zone = (t) => !!t && t.drawn && t.content && t.glyph !== 'a' && t.glyph !== 'A';
  // "outside": undrawn tiles and the forbidden / separator tiles connected to them (interior holes are not)
  const outside = new Set();
  const stack = [];
  for (let r = -1; r <= ROWS; r++) for (let c = -1; c <= COLS; c++) {
    const t = at(r, c);
    if (!t || !t.drawn) { outside.add(`${r},${c}`); stack.push([r, c]); }
  }
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [, dx, dy] of DIRS) {
      const rr = r + dy, cc = c + dx, n = at(rr, cc);
      if (!n || outside.has(`${rr},${cc}`) || !n.drawn || n.content) continue;
      outside.add(`${rr},${cc}`);
      stack.push([rr, cc]);
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = grid[r][c];
    if (!zone(t)) continue;
    for (const [dir, dx, dy] of DIRS) {
      const n = at(r + dy, c + dx);
      if (zone(n)) continue;
      if (!outside.has(`${r + dy},${c + dx}`)) continue; // interior holes, bench pads: no boundary glow
      edges.push({ r, c, dir, z: topZ(t) });
    }
  }

  const devices = opts.devices === false ? [] : stageDevices(stage, grid);
  for (const d of devices) {
    if (d.kind === 'platform' || d.kind === 'sealedFloor' || d.kind === 'waterPlatform') slabDevice(board, decal, UVT, d, grid);
  }

  return {
    grid, gates, devices, terrain, edges,
    buckets: { board: board.finish(), decal: decal.finish(), pipe: pipe.finish(), glass: glass.finish() },
    bounds: { x0: minX, x1: maxX, y0: minY, y1: maxY },
    stats: { tiles: grid.flat().filter((t) => t.drawn).length, vertices: board.vertexCount + decal.vertexCount + pipe.vertexCount },
  };
}

// ---- pipes -----------------------------------------------------------------------------------------------------

/** Closed-side cylinder from a to b (8 segments) with flat caps. */
export function tube(g, a, b, rad, seg = 8, col = [1, 1, 1]) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-6) return g;
  const w = [d[0] / len, d[1] / len, d[2] / len];
  const ref = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let u = [w[1] * ref[2] - w[2] * ref[1], w[2] * ref[0] - w[0] * ref[2], w[0] * ref[1] - w[1] * ref[0]];
  const ul = Math.hypot(...u); u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const ring = (k) => { const t = (k / seg) * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t); return [u[0] * cs + v[0] * sn, u[1] * cs + v[1] * sn, u[2] * cs + v[2] * sn]; };
  for (let k = 0; k < seg; k++) {
    const n0 = ring(k), n1 = ring(k + 1);
    const p = (base, n) => [base[0] + n[0] * rad, base[1] + n[1] * rad, base[2] + n[2] * rad];
    g.quad([p(a, n0), p(a, n1), p(b, n1), p(b, n0)], null, [n0, n1, n1, n0], col);
  }
  for (const [end, sgn] of [[a, -1], [b, 1]]) {
    const n = [w[0] * sgn, w[1] * sgn, w[2] * sgn];
    for (let k = 0; k < seg; k++) {
      const r0 = ring(k), r1 = ring(k + 1);
      const p0 = [end[0] + r0[0] * rad, end[1] + r0[1] * rad, end[2] + r0[2] * rad];
      const p1 = [end[0] + r1[0] * rad, end[1] + r1[1] * rad, end[2] + r1[2] * rad];
      g.tri(sgn > 0 ? [end, p0, p1] : [end, p1, p0], n, col);
    }
  }
  return g;
}

// ---- devices ----------------------------------------------------------------------------------------------------

const DEVICE_KINDS = new Set(['crate', 'platform', 'mound', 'blower', 'turret', 'waterPlatform', 'bush', 'sealedFloor']);

/**
 * Active stage devices standing on drawn tiles: `{ kind, r, c, dir, z0, key, alias, rangeTiles }`. Every visible
 * predefined token of the level is a scene object; a device on a separator wall is drawn wherever that wall is built,
 * whichever field it blows into (act2 m01: row 6 belongs to both leftNormal and leftBoss, row 13 tops the normal field).
 * The official client hides none of them by the way they face: the row-13 machines show in the official normal rounds
 * although row 13 lies outside every configBlackBoard area rect (user playtest #5 item 6), and so do the boss field's
 * row-6 machines under the bench (user playtest #5 follow-up: "吹风机原版道中也该有").
 */
export function stageDevices(stage, grid) {
  const list = Array.isArray(stage?.devices) ? stage.devices : [];
  const out = [];
  for (const d of list) {
    if (!d || !Array.isArray(d.pos) || !Number.isInteger(d.pos[0]) || !Number.isInteger(d.pos[1])) continue;
    if (!DEVICE_KINDS.has(d.role)) continue;
    const active = typeof d.active === 'boolean' ? d.active : !d.hidden;
    if (!active) continue;
    const [r, c] = d.pos;
    const t = grid?.[r]?.[c];
    if (!t || !t.drawn) continue;
    out.push({ kind: d.role, r, c, dir: ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(d.dir) ? d.dir : 'UP', z0: t.h, key: d.key || null, alias: d.alias || null, rangeTiles: Array.isArray(d.rangeTiles) ? d.rangeTiles : null });
  }
  return out;
}

/** Device heights on their tile (platform tops are standing surfaces: tiles.js heightAt adds them). */
export const DEVICE_H = Object.freeze({ platform: TILE_H.platform, sealedFloor: 0.05, waterPlatform: 0.2 });

function slabDevice(board, decal, UVT, d, grid) {
  const size = d.kind === 'sealedFloor' ? 0.92 : 0.94;
  const h = DEVICE_H[d.kind] || 0.2;
  const z0 = grid[d.r][d.c].h, zt = z0 + h;
  const a = size / 2, x0 = d.c - a, x1 = d.c + a, y0 = d.r - a, y1 = d.r + a;
  const topSurf = d.kind === 'sealedFloor' ? null : UVT.plateS;
  if (topSurf) board.quad([[x0, y0, zt], [x1, y0, zt], [x1, y1, zt], [x0, y1, zt]], surfaceUV(topSurf), [0, 0, 1], [1.02, 1.02, 1.02]);
  else decal.quad([[x0, y0, zt], [x1, y0, zt], [x1, y1, zt], [x0, y1, zt]], surfaceUV(UVT.hazardX), [0, 0, 1], [1, 1, 1]);
  const side = UVT.graySide;
  for (const dir of ['S', 'E', 'N', 'W']) {
    const uv = surfaceUV(side, sideRect(side, size, h));
    board.quad(sideCorners(dir, x0, x1, y0, y1, z0, zt), uv, NRM[dir], [[0.5, 0.53, 0.56], [0.5, 0.53, 0.56], [0.85, 0.88, 0.9], [0.85, 0.88, 0.9]]);
  }
}

// ---- OBJ meshes → board space -------------------------------------------------------------------------------------

/**
 * Convert a parsed OBJ (board3d/obj.js, Unity Y-up exported right-handed with X mirrored) into board space
 * (x = col, y = row, z = up): (x', y', z') → (−x'·s, z'·s, y'·s) — a proper rotation, windings stay outward.
 */
export function objToBoard(obj, s = 1) {
  const p = obj.position, n = obj.normal;
  const pos = new Float32Array(p.length), nrm = n ? new Float32Array(n.length) : null;
  for (let i = 0; i < p.length; i += 3) {
    pos[i] = -p[i] * s; pos[i + 1] = p[i + 2] * s; pos[i + 2] = p[i + 1] * s;
    if (nrm) { nrm[i] = -n[i]; nrm[i + 1] = n[i + 2]; nrm[i + 2] = n[i + 1]; }
  }
  return { ...obj, position: pos, normal: nrm };
}

/**
 * Box-project UVs of a (board-space) mesh onto atlas surfaces: faces pointing up take `top`, the others `side`
 * (mapped across the face's horizontal extent × height). Used for the official crate mesh (s_common_box_01), whose
 * own material is assigned at runtime by the client.
 */
export function boxProjectUV(mesh, top, side) {
  const p = mesh.position, n = mesh.normal;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); z0 = Math.min(z0, p[i + 2]); z1 = Math.max(z1, p[i + 2]);
  }
  const uvTop = surfaceUV(top), uvSide = surfaceUV(side);
  const out = new Float32Array((p.length / 3) * 2);
  for (let i = 0, j = 0; i < p.length; i += 3, j += 2) {
    const nx = n ? n[i] : 0, ny = n ? n[i + 1] : 0, nz = n ? n[i + 2] : 1;
    let uv;
    if (nz > 0.6) uv = uvAt(uvTop, (p[i] - x0) / (x1 - x0 || 1), (p[i + 1] - y0) / (y1 - y0 || 1));
    else {
      const fy = (p[i + 2] - z0) / (z1 - z0 || 1);
      // horizontal coordinate along the face (seen from outside)
      let fx;
      if (Math.abs(nx) >= Math.abs(ny)) fx = nx > 0 ? (p[i + 1] - y0) / (y1 - y0 || 1) : (y1 - p[i + 1]) / (y1 - y0 || 1);
      else fx = ny < 0 ? (p[i] - x0) / (x1 - x0 || 1) : (x1 - p[i]) / (x1 - x0 || 1);
      uv = uvAt(uvSide, fx, fy);
    }
    out[j] = uv[0]; out[j + 1] = uv[1];
  }
  return { ...mesh, uv: out, bounds: { x0, x1, y0, y1, z0, z1 } };
}
