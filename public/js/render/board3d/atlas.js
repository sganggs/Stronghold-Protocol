// render/board3d/atlas.js — which pixels of the official board textures dress each surface of the 3D board
// (DESIGN §15). Pure data + UV helpers (no three import): the geometry builder (layout.js) maps these rects straight
// onto the tiles, the three.js scene samples the textures of MT_autochess (TX_autochessi_D + _N + _M + _E, which
// share one UV layout) and MT_autochess_common (TX_autochessi_common_D/_E, device plates).
//
// Source of truth for the rects: this table. tools/crop-board-atlas.mjs validates every rect against the extracted
// images and writes it into public/assets/local/map/autochess/tiles.json → `board3d`, which the renderer prefers
// (so a re-crop needs no code change); `resolveUvTable(tiles)` merges it over these defaults.
//
//   surface = { src: 'D' | 'common', rect: [x, y, w, h] (source px, y down), rot?: 0|90|180|270 (clockwise, of the
//               texture on the face), flipX?: bool, tint?: '#rrggbb' (vertex colour multiply), glow?: number }
//
// Atlas pieces (TX_autochessi_D 2048², 256 px per floor cell; picked by eye, validated by the crop tool): gold-framed
// high-ground plates (row 0: strip L / M / R + single), concrete slabs (rows 1–2: rails, ✕ marker, hazard stripes,
// chevrons, red no-deploy stripes), wall panels (REST AREA / EVACUATION), REINFORCEMENTS / EQUIPMENTS bench pads
// (512² each), ribbed side panels (gold / grey), the hazard-framed glass hatch, the ▲▼ lift plate, grille slats,
// dark machinery hatch, gold ring hatch (objective), orange crate panels.

export const SOURCES = Object.freeze({
  D: Object.freeze({ w: 2048, h: 2048 }),
  common: Object.freeze({ w: 1024, h: 1024 }),
});

const S = (src, rect, o = {}) => Object.freeze({ src, rect: Object.freeze(rect), ...o });

/** Surface → atlas region (see header). Names are used by layout.js. */
export const SURFACES = Object.freeze({
  // floors
  concrete: S('D', [256, 512, 256, 256]),
  concreteRailTL: S('D', [0, 256, 256, 256]),
  concreteRailT: S('D', [256, 256, 256, 256]),
  concreteRailL: S('D', [0, 512, 256, 256]),
  concreteStripe: S('D', [512, 256, 256, 256]),
  concreteArrow: S('D', [768, 256, 256, 256]),
  concreteRed: S('D', [768, 512, 256, 256]),
  hatch: S('D', [549, 1787, 255, 256]),
  lift: S('D', [804, 1790, 234, 234]),
  ringHatch: S('D', [1290, 1400, 190, 190]),
  slats: S('D', [1036, 480, 404, 216]),
  mech: S('D', [1088, 708, 356, 310]),
  steel: S('D', [12, 776, 196, 196]),
  // high ground (gold-framed plates; texture top = the tile's far edge)
  plateL: S('D', [0, 0, 256, 256]),
  plateM: S('D', [256, 0, 256, 256]),
  plateR: S('D', [512, 0, 256, 256]),
  plateS: S('D', [768, 0, 256, 256]),
  // bench pads
  padReinf: S('D', [0, 1024, 512, 512]),
  padEquip: S('D', [512, 1024, 512, 512]),
  // side panels (cropped to the face aspect at use: see sideRect)
  goldSide: S('D', [0, 1664, 272, 384]),
  graySide: S('D', [272, 1664, 272, 384]),
  benchRail: S('D', [0, 1538, 512, 98]),
  restPanel: S('D', [0, 768, 512, 208]),
  evacPanel: S('D', [512, 768, 256, 208]),
  pipePanel: S('D', [544, 1540, 480, 244]),
  // devices
  crateSide: S('D', [1087, 1938, 134, 108]),
  crateTop: S('D', [1222, 1938, 134, 108], { rot: 90 }),
  // common atlas plates (MT_autochess_common, alpha-tested decals)
  hazardX: S('common', [2, 2, 250, 248]),
  heal: S('common', [264, 2, 256, 250]),
  shield: S('common', [538, 2, 256, 250]),
  target: S('common', [2, 262, 250, 250]),
  blast: S('common', [538, 262, 250, 250]),
  enemyMark: S('common', [792, 258, 232, 262]),
  fast: S('common', [2, 520, 250, 250]),
  arrowUp: S('common', [508, 762, 244, 244]),
  arrowDown: S('common', [776, 762, 244, 244]),
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validate one surface record (from tiles.json) → a clean record or null. */
export function cleanSurface(v) {
  if (!isObj(v) || !SOURCES[v.src] || !Array.isArray(v.rect) || v.rect.length !== 4) return null;
  const [x, y, w, h] = v.rect.map(Number);
  const src = SOURCES[v.src];
  if (![x, y, w, h].every(Number.isFinite) || w < 4 || h < 4 || x < 0 || y < 0 || x + w > src.w || y + h > src.h) return null;
  const rot = [0, 90, 180, 270].includes(v.rot) ? v.rot : 0;
  const out = { src: v.src, rect: [x, y, w, h], rot, flipX: !!v.flipX };
  if (typeof v.tint === 'string' && /^#[0-9a-f]{6}$/i.test(v.tint)) out.tint = v.tint;
  return out;
}

/** Surface table: defaults overridden by a tiles.json `board3d` section (invalid entries ignored). */
export function resolveUvTable(tiles) {
  const out = {};
  for (const [k, v] of Object.entries(SURFACES)) out[k] = cleanSurface(v);
  const extra = isObj(tiles) && isObj(tiles.board3d) ? tiles.board3d : null;
  if (extra) for (const [k, v] of Object.entries(extra)) { const c = cleanSurface(v); if (c) out[k] = c; }
  return out;
}

/**
 * UV corners of a surface for a quad whose corners are given as [bottom-left, bottom-right, top-right, top-left]
 * of the face as seen from outside (for a top face: near-left, near-right, far-right, far-left). Optional
 * `sub` = [u0, v0, u1, v1] (fractions of the rect, v down) crops the rect (side panels, partial faces).
 * Returns [u,v, u,v, u,v, u,v] in three's convention (v up, textures flipped on upload). `inset` (source px)
 * keeps mip filtering inside the region.
 */
export function surfaceUV(surface, sub = null, inset = 2) {
  const src = SOURCES[surface.src] || SOURCES.D;
  let [x, y, w, h] = surface.rect;
  if (sub) {
    const [a, b, c, d] = sub;
    x += w * a; y += h * b; const w2 = w * (c - a), h2 = h * (d - b); w = w2; h = h2;
  }
  const ix = Math.min(inset, w / 4), iy = Math.min(inset, h / 4);
  const u0 = (x + ix) / src.w, u1 = (x + w - ix) / src.w;
  const vTop = 1 - (y + iy) / src.h, vBot = 1 - (y + h - iy) / src.h;
  // texture corners in face order BL, BR, TR, TL
  let c = [[u0, vBot], [u1, vBot], [u1, vTop], [u0, vTop]];
  if (surface.flipX) c = [c[1], c[0], c[3], c[2]];
  const turns = ((surface.rot | 0) / 90) & 3;
  // rotating the texture clockwise on the face = the face corner k samples texture corner k − turns
  for (let t = 0; t < turns; t++) c = [c[1], c[2], c[3], c[0]];
  return [c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]];
}

/** Sub-rect (fractions) of a side panel that keeps the texture undistorted on a face `width` × `height` tiles. */
export function sideRect(surface, width, height) {
  const [, , w, h] = surface.rect;
  const faceAspect = Math.max(1e-3, height / Math.max(1e-3, width));
  const texAspect = h / w;
  if (faceAspect >= texAspect) return [0, 0, 1, 1];
  const frac = faceAspect / texAspect;
  return [0, 0, 1, frac];
}

/** '#rrggbb' → [r, g, b] (0..1); null → [1, 1, 1]. */
export function tintRgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return [1, 1, 1];
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
