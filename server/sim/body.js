// server/sim/body.js — where a unit can be hit: the ONE helper behind every range test that targets enemies (user
// playtest #5 item 10: "大体型的关底boss实际受击判定范围很小…原版是很大的一片区域").
//
// Regular units are a point with a collider: an operator-side RANGE (an attack range, a skill's or trait's range grid,
// the skill-range trigger) takes an enemy whose collider circle (constants.js ENEMY_COLLIDER_RADIUS 0.1, the client's
// CircleCollider2D; PRTS 作战机制 "索敌抬手等均使用碰撞箱") overlaps one of its tiles — colliderKeys / bodyInRange, the
// owner's decision of 2026-10-14 —; a TILE rule (格子判定: terrain, traps, fields and marks laid on tiles, "所在格"
// effects) takes the tile containing the position — rounded half to even (detmath roundHalfEven; PRTS 作战机制 "受击方
// 坐标经round函数取整(四舍六入五成双)得到其所属格坐标"), bodyKeys / bodyInKeys / bodyOnTile —; a radius takes the
// position (DESIGN §3). Huge units (巨型单位 — enemy data `hitArea`, tools/build-data.mjs
// HIT_AREAS, from PRTS "巨型单位：受击判定区域为长4.95、宽2.95的长方形，向上偏移1.0") are hit anywhere on a rectangle
// `w` tiles along the columns × `h` along the rows, centred on their position moved `dx` columns right and `dy` rows
// up:
//   * grid ranges / tile rules: the unit occupies every tile its rectangle overlaps (the rectangle is its collider —
//     no 0.1 circle is added; PRTS 作战机制 "巨型BOSS单位的每一个
//     占据的格子都可以让其本身通过格子判定"; an operator's range — 1×1 tile squares — touches the rectangle exactly then):
//     a 4.95 × 2.95 area centred on a tile covers that 5 × 3 block;
//   * radius rules (auras, AoE around a point or a unit): the distance from the point to the rectangle (0 inside it)
//     [ASSUMED: PRTS 作战机制 calls collider tests "the most common"];
//   * splash around a struck / marked target is a 中点判定 (PRTS 作战机制: "中点判定…案例：阻挡，酒神1天赋的1.3溅射半径"):
//     every enemy, a huge one too, counts by its position (Battle.enemiesInRadius(x, y, r, true) — the engine's
//     profession splash and aftershocks, and the kits' splash centred on an enemy).
// The unit's own position stays its 判定中心: projectiles fly to it, its own attacks and radii measure from it, and it
// is the centre of splash on it (PRTS 分支特性信息: 投掷物会抵达目标的判定中心…巨型单位的模型中心具有一定偏移). Body size
// plays no part in blocking or movement — legacy huge leaders separately have 自缚 + 无法被阻挡 (content/bosses.js
// SELF_BOUND), while 后兽 has a centred 2.95×2.95 body and still moves. Also by position: movement, pathing and terrain on the
// enemy's tile, tile-entry tracking (雪境 tiles), placement heuristics and distance-scaled numbers, and the range keys
// taken from blocked enemies. A rectangular hit body alone does not imply unblockable.
// Pure functions of (x, y, hitArea); no battle state — also used for the client's picking (render/pick.js mirrors
// `hitRect`).

import { ROWS, COLS, ENEMY_COLLIDER_RADIUS } from './constants.js';
import { hypot, roundHalfEven } from './detmath.js';

/**
 * Validated hit area of a data record (`{ w, h, dx, dy }`, tiles) or null for a regular (point) unit.
 * @param {any} a
 */
export function normHitArea(a) {
  if (!a || typeof a !== 'object') return null;
  const w = Number(a.w), h = Number(a.h), dx = Number(a.dx ?? 0), dy = Number(a.dy ?? 0);
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return Object.freeze({ w, h, dx, dy });
}

/** The world rectangle `{ x0, x1, y0, y1 }` of a huge unit, or null for a point unit (no `hitArea`). */
export function hitRect(u) {
  const a = u && u.hitArea;
  if (!a) return null;
  const cx = u.x + a.dx, cy = u.y + a.dy;
  return { x0: cx - a.w / 2, x1: cx + a.w / 2, y0: cy - a.h / 2, y1: cy + a.h / 2 };
}

/** Tile key of a unit's position (-1 off the grid). */
function posKey(u) {
  const r = roundHalfEven(u.y), c = roundHalfEven(u.x);
  return r < 0 || r >= ROWS || c < 0 || c >= COLS ? -1 : r * COLS + c;
}

/**
 * Tile keys (row × COLS + col) the unit occupies: a point unit the tile of its position ([] off the grid), a huge unit
 * every tile its rectangle overlaps (open intervals: a tile only touched along an edge is not overlapped).
 */
export function bodyKeys(u) {
  const R = hitRect(u);
  if (!R) { const k = posKey(u); return k < 0 ? [] : [k]; }
  const out = [];
  const r0 = Math.max(0, Math.floor(R.y0 + 0.5 + 1e-9)), r1 = Math.min(ROWS - 1, Math.ceil(R.y1 - 0.5 - 1e-9));
  const c0 = Math.max(0, Math.floor(R.x0 + 0.5 + 1e-9)), c1 = Math.min(COLS - 1, Math.ceil(R.x1 - 0.5 - 1e-9));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * COLS + c);
  return out;
}

/** Does the unit occupy tile (r, c)? */
export function bodyOnTile(u, r, c) {
  const R = hitRect(u);
  if (!R) return roundHalfEven(u.y) === r && roundHalfEven(u.x) === c;
  return c + 0.5 > R.x0 + 1e-9 && c - 0.5 < R.x1 - 1e-9 && r + 0.5 > R.y0 + 1e-9 && r - 0.5 < R.y1 - 1e-9;
}

/**
 * Does the unit occupy any tile of `keys` (tile keys: a Set / Map — anything with `has` — or an array)? The TILE rule
 * (格子判定: its position's tile, a huge unit's rectangle); a range test uses bodyInRange.
 */
export function bodyInKeys(u, keys) {
  if (!u || !keys) return false;
  const has = typeof keys.has === 'function' ? (k) => keys.has(k) : (k) => keys.includes(k);
  if (!u.hitArea) { const k = posKey(u); return k >= 0 && has(k); }
  for (const k of bodyKeys(u)) if (has(k)) return true;
  return false;
}

/**
 * Tile keys a RANGE test sees the unit on: a huge unit its rectangle's tiles (bodyKeys); a point enemy every tile its
 * collider circle — radius ENEMY_COLLIDER_RADIUS around its position — overlaps (open: a tile the circle only touches is
 * not overlapped; one to four tiles, off-grid tiles dropped), so an enemy within 0.1 of a range tile's edge is in range.
 * An ally (allies stand on their tile, never tested against an enemy-search range) gets the tile of its position.
 */
export function colliderKeys(u) {
  if (u.hitArea || u.side === 'ally') return bodyKeys(u);
  const rho = ENEMY_COLLIDER_RADIUS, x = u.x, y = u.y;
  const r0 = Math.max(0, Math.floor(y - rho + 0.5 + 1e-9)), r1 = Math.min(ROWS - 1, Math.ceil(y + rho - 0.5 - 1e-9));
  const c0 = Math.max(0, Math.floor(x - rho + 0.5 + 1e-9)), c1 = Math.min(COLS - 1, Math.ceil(x + rho - 0.5 - 1e-9));
  const out = [];
  for (let r = r0; r <= r1; r++) {
    const dy = y < r - 0.5 ? r - 0.5 - y : y > r + 0.5 ? y - r - 0.5 : 0;
    for (let c = c0; c <= c1; c++) {
      const dx = x < c - 0.5 ? c - 0.5 - x : x > c + 0.5 ? x - c - 0.5 : 0;
      // a diagonal tile only when the circle reaches past its corner (the side tiles are within rho by the bounds)
      if (dx > 0 && dy > 0 && dx * dx + dy * dy >= rho * rho) continue;
      out.push(r * COLS + c);
    }
  }
  return out;
}

/**
 * Is the unit in a RANGE of tile `keys` (a Set / Map — anything with `has` — or an array)? Its collider overlaps one of
 * them (colliderKeys): an attack range, a skill's or trait's range grid. Tile rules use bodyInKeys.
 */
export function bodyInRange(u, keys) {
  if (!u || !keys) return false;
  const has = typeof keys.has === 'function' ? (k) => keys.has(k) : (k) => keys.includes(k);
  if (u.hitArea || u.side === 'ally') { for (const k of bodyKeys(u)) if (has(k)) return true; return false; }
  // colliderKeys without its array (kits call this per enemy on every aura tick)
  const rho = ENEMY_COLLIDER_RADIUS, x = u.x, y = u.y;
  const r0 = Math.max(0, Math.floor(y - rho + 0.5 + 1e-9)), r1 = Math.min(ROWS - 1, Math.ceil(y + rho - 0.5 - 1e-9));
  const c0 = Math.max(0, Math.floor(x - rho + 0.5 + 1e-9)), c1 = Math.min(COLS - 1, Math.ceil(x + rho - 0.5 - 1e-9));
  for (let r = r0; r <= r1; r++) {
    const dy = y < r - 0.5 ? r - 0.5 - y : y > r + 0.5 ? y - r - 0.5 : 0;
    for (let c = c0; c <= c1; c++) {
      const dx = x < c - 0.5 ? c - 0.5 - x : x > c + 0.5 ? x - c - 0.5 : 0;
      if (dx > 0 && dy > 0 && dx * dx + dy * dy >= rho * rho) continue;
      if (has(r * COLS + c)) return true;
    }
  }
  return false;
}

/** Is the unit in the range of the single tile (r, c) — its collider overlaps it (bodyInRange)? False off the grid. */
export function bodyInRangeTile(u, r, c) {
  if (!u || r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
  return colliderKeys(u).includes(r * COLS + c);
}

/** Distance (tiles) from point (x, y) to the unit's body: its position, or its rectangle (0 inside). */
export function bodyDist(u, x, y) {
  const R = hitRect(u);
  if (!R) return hypot(u.x - x, u.y - y);
  const dx = x < R.x0 ? R.x0 - x : x > R.x1 ? x - R.x1 : 0;
  const dy = y < R.y0 ? R.y0 - y : y > R.y1 ? y - R.y1 : 0;
  return hypot(dx, dy);
}

/** Is the unit's body within `r` tiles of point (x, y)? (the same ≤ r + 1e-9 test as Battle.enemiesInRadius) */
export function bodyInRadius(u, x, y, r) {
  return bodyDist(u, x, y) <= r + 1e-9;
}

/**
 * Chebyshev reach in tiles from tile (r, c) to the unit's body (0 = it occupies that tile; 1 = one of the 8 tiles
 * around it; …): "周围八格"-style square areas centred on a tile.
 */
export function bodyTileReach(u, r, c) {
  if (!u.hitArea) return Math.max(Math.abs(roundHalfEven(u.y) - r), Math.abs(roundHalfEven(u.x) - c));
  let best = Infinity;
  for (const k of bodyKeys(u)) {
    const kr = Math.floor(k / COLS), kc = k % COLS;
    const d = Math.max(Math.abs(kr - r), Math.abs(kc - c));
    if (d < best) best = d;
  }
  return best;
}
