// Facing (direction) rules of the prep board — pure logic, no DOM (research 09 §1.2, DESIGN §3 "Facing (corrected)").
//
// Every board piece has a direction `dir ∈ UP|RIGHT|DOWN|LEFT`, chosen with the standard Arknights 4-direction deploy
// wheel after a legal drop on a board tile (also the piece's own tile: re-orienting in place). Range grids are
// `[dRow, dCol]` offsets relative to facing RIGHT (row 0 = the bottom row, nearest the camera) and rotate as
//   RIGHT (dr, dc) · UP (dc, −dr) · LEFT (−dr, −dc) · DOWN (−dc, dr).
// Screen space of the wheel: +x right, +y down; the camera looks "up" the board, so screen-up = towards higher rows =
// UP. A swipe shorter than the dead-zone (~0.5 tile) chooses nothing (release there = cancel). On the mirrored right
// half of the Final Assault prep a screen direction maps to its board direction through `boardDir(dir, mirror)`.
//
// Also here: which drops enter the direction step, which range grid previews, and the underframe (selection diamond)
// actions of a tapped piece — 撤退 / 出售 +N on a board operator, 撤退 on a board summon, 出售 +N on a bench operator,
// 销毁 on items and Arts (research 09 §5 / §6.5).

import { GEO } from '../../../shared/constants.js';
import { attackRangeGrid } from '../../../shared/loadoutRecord.js';
import { T } from '../i18n.js';
export const DIRS = Object.freeze(['UP', 'RIGHT', 'DOWN', 'LEFT']);
export const DEFAULT_DIR = 'RIGHT';
/** Dead-zone radius of the wheel, in tiles (research 09 §1.2: ~0.5 tile). */
export const DEAD_ZONE_TILES = 0.5;

/** Row / column unit step of a direction (row 0 = bottom). */
export const DIR_VEC = Object.freeze({
  UP: Object.freeze({ dr: 1, dc: 0 }),
  RIGHT: Object.freeze({ dr: 0, dc: 1 }),
  DOWN: Object.freeze({ dr: -1, dc: 0 }),
  LEFT: Object.freeze({ dr: 0, dc: -1 }),
});

/** Chinese label (for aria / tooltips). */
export const DIR_LABEL = Object.freeze({ UP: T('上'), RIGHT: T('右'), DOWN: T('下'), LEFT: T('左') });

/** Normalise any direction spelling ('up', 'Right', 1/−1 facing) to UP|RIGHT|DOWN|LEFT; unknown → `fallback`. */
export function normDir(d, fallback = DEFAULT_DIR) {
  if (typeof d === 'string') {
    const u = d.trim().toUpperCase();
    if (DIRS.includes(u)) return u;
  }
  if (d === -1) return 'LEFT';
  if (d === 1) return 'RIGHT';
  return fallback;
}

/** Rotate a range offset given relative to facing RIGHT (DESIGN §3). */
export function rotateOffset(dr, dc, dir) {
  const z = (v) => (v === 0 ? 0 : v); // no −0
  switch (normDir(dir)) {
    case 'UP': return [z(dc), z(-dr)];
    case 'LEFT': return [z(-dr), z(-dc)];
    case 'DOWN': return [z(-dc), z(dr)];
    default: return [z(dr), z(dc)];
  }
}

/**
 * Absolute board tiles of a range grid for a piece standing on (row, col) facing `dir` (clipped to the stage grid,
 * deduplicated). `extend` adds columns along +dCol before rotating (rangeExtend, DESIGN §3).
 * @param {Array<[number, number]>} grid
 * @returns {Array<[number, number]>}
 */
export function rangeTiles(grid, row, col, dir, { extend = 0, rows = GEO.ROWS, cols = GEO.COLS } = {}) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(grid) ? grid : [];
  const ext = Number.isInteger(extend) && extend > 0 ? extend : 0;
  const push = (dr, dc) => {
    const [rr, rc] = rotateOffset(dr, dc, dir);
    const r = row + rr, c = col + rc;
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    const k = `${r},${c}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push([r, c]);
  };
  for (const g of list) {
    if (!Array.isArray(g) || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) continue;
    push(g[0], g[1]);
  }
  if (ext) {
    // rangeExtend: every row of the grid grows by `ext` columns at its far (+dCol) end
    const rowsOf = new Map();
    for (const g of list) if (Array.isArray(g) && Number.isFinite(g[0]) && Number.isFinite(g[1])) rowsOf.set(g[0], Math.max(rowsOf.get(g[0]) ?? -Infinity, g[1]));
    for (const [dr, far] of rowsOf) for (let k = 1; k <= ext; k++) push(dr, far + k);
  }
  return out;
}

/**
 * Direction of a swipe from the wheel centre. `dx`, `dy` in screen px (+y down); `dead` = dead-zone radius in px.
 * The dominant axis decides (ties go to the horizontal axis, where the lanes are).
 * @returns {'UP'|'RIGHT'|'DOWN'|'LEFT'|null}
 */
export function dirFromDelta(dx, dy, dead = 0) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.hypot(dx, dy) <= Math.max(0, dead)) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'RIGHT' : 'LEFT';
  return dy < 0 ? 'UP' : 'DOWN';
}

const MIRROR = Object.freeze({ UP: 'UP', RIGHT: 'LEFT', DOWN: 'DOWN', LEFT: 'RIGHT' });

/**
 * Board direction of a direction picked on screen (the wheel's chevrons / arrow keys are screen-oriented). On the
 * right half of the Final Assault prep the board is drawn mirrored (research 09 §1.2: col c → 20 − c, RIGHT ↔ LEFT;
 * render/prepfield.js), so a swipe to the screen's right means board LEFT there; UP / DOWN are unchanged. The mapping
 * is its own inverse: `boardDir(boardDir(d, m), m) === d` (also the screen chevron of a board direction).
 * @param {'UP'|'RIGHT'|'DOWN'|'LEFT'|null} dir
 * @param {boolean} mirror `tileScreen(row, col).mirror` / `view.prepField().mirror` of the render view
 */
export function boardDir(dir, mirror = false) {
  if (dir == null) return null;
  const d = normDir(dir, null);
  if (!d) return null;
  return mirror ? MIRROR[d] : d;
}

/** Whether the view draws the prep board mirrored (right-hand Final Assault prep); false for views without the hook. */
export function viewMirrored(view) {
  const raw = view && (view.raw || view);
  try { return !!(raw && typeof raw.prepField === 'function' && raw.prepField()?.mirror); } catch { return false; }
}

/** Direction of an arrow key (keyboard alternative of the swipe). */
export function dirFromKey(key) {
  return { ArrowUp: 'UP', ArrowRight: 'RIGHT', ArrowDown: 'DOWN', ArrowLeft: 'LEFT' }[key] || null;
}

const isObj = (v) => !!v && typeof v === 'object';

/** The piece's stored facing (m.private board pieces carry `dir`; absent ⇒ RIGHT, the server default). */
export const pieceDir = (piece) => normDir(isObj(piece) ? piece.dir : null);

/**
 * Range grid previewed by the wheel / on a selected unit: the operator's range at deployment (heal range for medics —
 * the data grid is the one the unit uses; an elite's equipped "攻击范围扩大" module grid, DESIGN §16, a selected
 * "被动效果：攻击范围扩大" skill, a module's 攻击距离 — shared/loadoutRecord.js attackRangeGrid, the prep card's range;
 * `chessRecord` resolves the player's loadout), a summon's grid, an Art's grid (画卷 `1-1`). Null when there is nothing
 * to show.
 * @param {{ getChess:(id:string)=>any, getToken:(id:string)=>any, getItem:(id:string)=>any, chessRecord?:(rec:any)=>any }} lookups
 */
export function previewGrid(lookups, piece) {
  if (!isObj(piece) || !lookups) return null;
  let rec = null;
  if (piece.kind === 'chess') {
    rec = lookups.getChess?.(piece.id);
    if (rec && typeof lookups.chessRecord === 'function') { try { rec = lookups.chessRecord(rec) || rec; } catch { /* the data record */ } }
  } else if (piece.kind === 'token') rec = lookups.getToken?.(piece.id);
  else if (piece.kind === 'item') { rec = lookups.getItem?.(piece.id); if (rec?.itemType !== 'MAGIC') return null; }
  const grid = !rec ? null : piece.kind === 'chess' ? attackRangeGrid(rec) : (Array.isArray(rec.rangeGrid) ? rec.rangeGrid : null);
  return grid && grid.length ? grid : null;
}

/** Whether an Art is placed with a direction (its range reaches beyond its own tile, e.g. 画卷 `[[0,0],[0,1]]`). */
export function artHasFacing(item) {
  const g = Array.isArray(item?.rangeGrid) ? item.rangeGrid : [];
  return g.some((x) => Array.isArray(x) && (x[0] !== 0 || x[1] !== 0));
}

/**
 * Whether dropping `uid` on `target` enters the direction step (instead of sending the intent at once): operators and
 * summons dropped on a board tile (move, swap or their own tile), and directional Arts used on a tile.
 * @param {{ pieces: Map<number, any>, getItem?: (id:string)=>any }} ctx placementContext (gameLogic.js)
 * @param {number} uid
 * @param {any} target
 * @param {{ ok: boolean, action?: string }} res canPlace(ctx, uid, target)
 */
export function needsFacing(ctx, uid, target, res) {
  if (!res || !res.ok || !isObj(target) || target.area !== 'board') return false;
  const piece = ctx?.pieces?.get(uid)?.piece;
  if (!piece) return false;
  if (piece.kind === 'chess' || piece.kind === 'token') return res.action === 'move' || res.action === 'swap' || res.action === 'orient';
  if (piece.kind === 'item' && res.action === 'art') return artHasFacing(ctx.getItem?.(piece.id));
  return false;
}

/**
 * The intent that commits a direction step. g.move carries the direction twice: top-level `dir` (the protocol field)
 * and `to.dir`, which server/match/PlayerState.move reads when the top-level one does not reach it — Match.handle
 * currently forwards only `msg.to` (`ps.move(msg.uid, msg.to)`), and without the copy every placement was stored
 * facing RIGHT and the model snapped back after the wheel. g.art has no such fallback (see the review report).
 * @returns {{ t: 'g.move', fields: { uid, to: { area, row, col, dir }, dir } } | { t: 'g.art', fields: { itemUid, row, col, dir } }}
 */
export function facingIntent(piece, target, dir) {
  const d = normDir(dir);
  if (piece?.kind === 'item') return { t: 'g.art', fields: { itemUid: piece.uid, row: target.row, col: target.col, dir: d } };
  return { t: 'g.move', fields: { uid: piece.uid, to: { area: 'board', row: target.row, col: target.col, dir: d }, dir: d } };
}

/**
 * Whether 销毁 may be offered for item `uid`: a loose item in the hand or the temp slots. Items equipped on an operator
 * (a piece's `items`, or an entry some other index marks `equipped`) are locked — g.destroy would be refused.
 * @param {{ pieces: Map<number, any> }} ctx placementContext / indexPieces view
 * @param {number} uid
 */
export function itemDestroyable(ctx, uid) {
  const e = ctx?.pieces?.get(uid);
  if (!e || e.piece?.kind !== 'item' || e.equipped) return false;
  if (e.area !== 'hand' && e.area !== 'temp') return false;
  for (const o of ctx.pieces.values()) {
    if (o.piece?.kind === 'chess' && Array.isArray(o.piece.items) && o.piece.items.some((it) => it && it.uid === uid)) return false;
  }
  return true;
}

/**
 * Underframe (selection diamond) of a tapped own piece (research 09 §1.2 / §5): the buttons it offers.
 *   board operator → 撤退 (to the bench) + 出售 +N · board summon → 撤退 · bench / temp operator → 出售 +N ·
 *   item or Art (bench / temp) → 销毁 · bench summon → nothing.
 * @param {{ pieces: Map<number, any>, getChess?: (id:string)=>any }} ctx
 * @returns {{ retreat: boolean, sell: number|null, destroy: boolean } | null} sell = the price shown ("+N")
 */
export function underframeActions(ctx, uid) {
  const e = ctx?.pieces?.get(uid);
  if (!e) return null;
  const p = e.piece;
  const onBoard = e.area === 'board';
  // only a loose item (bench / temp) can be destroyed: an equipped one is locked (the server refuses g.destroy —
  // research 04 §2; replacing it is the equip-replace dialog's job, g.equip replaceUid)
  if (p.kind === 'item') return itemDestroyable(ctx, uid) ? { retreat: false, sell: null, destroy: true } : null;
  if (p.kind === 'token') return onBoard ? { retreat: true, sell: null, destroy: false } : null;
  if (p.kind !== 'chess') return null;
  const price = ctx.getChess?.(p.id)?.sellPrice;
  return { retreat: onBoard, sell: Number.isFinite(price) ? price : 1, destroy: false };
}

/**
 * Where 撤退 puts a board piece: the first free bench slot (a summon goes back onto its stack — any slot works; an
 * operator whose own summon stacks sit on the bench frees them). Null when the bench is full.
 * @param {{ pieces: Map<number, any>, handAt: Map<number, any> }} ctx
 */
export function retreatSlot(ctx, uid) {
  const e = ctx?.pieces?.get(uid);
  if (!e || e.area !== 'board') return null;
  for (let i = 0; i < GEO.HAND_SIZE; i++) if (!ctx.handAt?.has(i)) return { area: 'hand', idx: i };
  if (e.piece.kind === 'token') return { area: 'hand', idx: 0 };
  for (const [i, h] of ctx.handAt || []) {
    if (h?.piece?.kind === 'token' && h.piece.ownerUid === e.piece.uid) return { area: 'hand', idx: i };
  }
  return null;
}
