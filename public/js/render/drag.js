// render/drag.js — prep-phase pointer interactions: hover, click, right-click / long-press detail, and
// drag & drop of pieces between hand, temp and board (DESIGN §9, §10). Pure logic (no PIXI, no DOM access):
// app.js feeds it canvas pointer events and supplies hit-testing callbacks, so the state machine and the drop
// target resolution are unit tested in Node.
//
// Drop targets (protocol g.move `to`): { area: 'board', row, col } | { area: 'hand', idx }, plus
// { area: 'outside', clientX, clientY } when the pointer is released off the stage grid or over DOM UI that
// covers the canvas (the UI decides what, if anything, that means). Releasing over a grid tile that is not a legal
// target (temp slot, enemy lane, `canPlace` false, or the piece's own bench slot) cancels the drag without a
// pieceDrop. A board piece released on its OWN tile is a drop (when `canPlace` allows it): the UI opens the
// direction wheel to re-orient it in place (research 09 §1.2 — "drag the unit onto its own tile and swipe").
// Everything is judged at the pointer (user playtest #4 item 1: the ground is drawn as tiles): a press / hover is on the
// piece standing on the tile under it (`hitPiece`, render/pick.js), and while dragging the target, `tileHover` and the
// legality are that tile — an item dropped on a unit's tile goes to that unit. app.js draws a dragged unit standing on
// that tile while it is a legal target (`dragStandTile`, the official deploy drag) and held under the pointer
// otherwise; an item plate stays on the pointer. A release over DOM UI covering the canvas (the shop bar) is 'outside'
// (mouse and touch alike).
//
// Events emitted through `emit(name, payload)`:
//   pieceHover     { uid, piece, clientX, clientY } | { uid: null }            (mouse/pen hover changes)
//   tileHover      { row, col, area, idx } | null                              (hover / drag target tile changes)
//   pieceClick     { uid, piece, button, detail, clientX, clientY }            (detail: right-click / long-press)
//   pieceDetail    { uid, piece, clientX, clientY }                            (right-click / long-press)
//   pieceDragStart { uid, piece, from }
//   pieceDragMove  { uid, piece, x, y, clientX, clientY, target, legal }       (for the ghost; high frequency)
//   pieceDrop      { uid, piece, from, target }
//   pieceDragEnd   { uid, piece, dropped, cancelled }

import { GEO } from '../../../shared/constants.js';

/** Where a piece currently sits, as a tile. `piece.area` 'board' uses row/col; 'hand'/'temp' use idx. */
export function pieceTile(piece) {
  if (!piece || typeof piece !== 'object') return null;
  if (piece.area === 'hand' && Number.isInteger(piece.idx)) return { row: GEO.HAND_ROW, col: piece.idx };
  if (piece.area === 'temp' && Number.isInteger(piece.idx)) return { row: GEO.TEMP_ROW, col: GEO.TEMP_C0 + piece.idx };
  if (Number.isInteger(piece.row) && Number.isInteger(piece.col)) return { row: piece.row, col: piece.col };
  return null;
}

/** The slot a piece occupies, in protocol target form (temp slots → { area: 'temp', idx }). */
export function pieceSlot(piece) {
  if (!piece || typeof piece !== 'object') return null;
  if (piece.area === 'hand' && Number.isInteger(piece.idx)) return { area: 'hand', idx: piece.idx };
  if (piece.area === 'temp' && Number.isInteger(piece.idx)) return { area: 'temp', idx: piece.idx };
  if (Number.isInteger(piece.row) && Number.isInteger(piece.col)) return { area: 'board', row: piece.row, col: piece.col };
  return null;
}

/**
 * Classify a grid tile as a potential drop slot.
 * @returns {{area:'board',row,col}|{area:'hand',idx}|{area:'temp',idx}|null}
 */
export function tileSlot(tile, geo = GEO) {
  if (!tile || !Number.isInteger(tile.row) || !Number.isInteger(tile.col)) return null;
  const { row, col } = tile;
  if (row === geo.HAND_ROW && col >= 0 && col < geo.HAND_SIZE) return { area: 'hand', idx: col };
  if (row === geo.TEMP_ROW && col >= geo.TEMP_C0 && col < geo.TEMP_C0 + geo.TEMP_SIZE) return { area: 'temp', idx: col - geo.TEMP_C0 };
  const F = geo.FIELD;
  if (row >= F.r0 && row <= F.r1 && col >= F.c0 && col <= F.c1) return { area: 'board', row, col };
  return null;
}

export const sameSlot = (a, b) => !!a && !!b && a.area === b.area &&
  (a.area === 'board' ? a.row === b.row && a.col === b.col : a.idx === b.idx);

/**
 * Decide what a release does.
 * @param {{ piece, from, tile, overCanvas: boolean, clientX: number, clientY: number,
 *           canPlace?: (piece, row, col, target) => boolean, geo? }} p
 * @returns {{ kind: 'drop', target } | { kind: 'cancel', reason: string }}
 */
export function resolveDrop(p) {
  const { piece, from, tile, overCanvas, clientX, clientY } = p;
  if (!overCanvas || !tile) {
    return { kind: 'drop', target: { area: 'outside', clientX: Number(clientX) || 0, clientY: Number(clientY) || 0 } };
  }
  const slot = tileSlot(tile, p.geo || GEO);
  if (!slot) return { kind: 'cancel', reason: 'notTarget' };
  if (slot.area === 'temp' && !isLegal(p.canPlace, piece, slot)) return { kind: 'cancel', reason: 'temp' };
  if (sameSlot(slot, from) && slot.area !== 'board') return { kind: 'cancel', reason: 'same' };
  if (!isLegal(p.canPlace, piece, slot)) return { kind: 'cancel', reason: 'illegal' };
  return { kind: 'drop', target: slot };
}

/**
 * The tile a dragged UNIT is drawn standing on, from a `pieceDragMove` payload: the drop target under the pointer while
 * it is legal — a board tile, or a bench slot (row HAND_ROW) — as `{ row, col, bench }` in board space; null otherwise
 * (no target, an illegal tile, a temp slot, the pointer over DOM UI such as the shop bar): the unit is then held under
 * the pointer. As in the official deploy drag (the owner's recording of 2026-10-09) the model stands on the tile the
 * finger is on, and moving within that tile leaves it where it is. app.js never snaps an item plate.
 */
export function dragStandTile(move, geo = GEO) {
  const t = move && move.legal === true ? move.target : null;
  if (!t) return null;
  if (t.area === 'board' && Number.isInteger(t.row) && Number.isInteger(t.col)) return { row: t.row, col: t.col, bench: false };
  if (t.area === 'hand' && Number.isInteger(t.idx)) return { row: geo.HAND_ROW, col: t.idx, bench: true };
  return null;
}

/** Legality via the UI callback (board → (piece,row,col); hand → (piece, HAND_ROW, idx)). Throwing ⇒ illegal. */
export function isLegal(canPlace, piece, slot) {
  if (!slot || slot.area === 'outside') return false;
  if (slot.area === 'temp') {
    if (typeof canPlace !== 'function') return false;
    try { return canPlace(piece, GEO.TEMP_ROW, GEO.TEMP_C0 + slot.idx, slot) === true; } catch { return false; }
  }
  if (typeof canPlace !== 'function') return true;
  const row = slot.area === 'board' ? slot.row : GEO.HAND_ROW;
  const col = slot.area === 'board' ? slot.col : slot.idx;
  try { return canPlace(piece, row, col, slot) !== false; } catch { return false; }
}

const DEFAULTS = { threshold: 6, touchThreshold: 10, longPressMs: 480 };

/**
 * Pointer state machine.
 * @param {{
 *   hitPiece: (x, y) => (object|null),            // piece on the tile under canvas point (render/pick.js); piece.uid required
 *   pickTile: (x, y) => ({row, col}|null),        // grid tile under canvas point
 *   isOverCanvas?: (clientX, clientY) => boolean, // false when DOM UI covers the point (default true)
 *   canPlace?: (piece, row, col, target) => boolean,
 *   emit: (name, payload) => void,
 *   setTimeout?, clearTimeout?, threshold?, touchThreshold?, longPressMs?
 * }} hooks
 */
export function createDragController(hooks) {
  const h = { ...DEFAULTS, ...hooks };
  const setT = h.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = h.clearTimeout || ((id) => clearTimeout(id));
  let editable = false;
  let canPlace = typeof h.canPlace === 'function' ? h.canPlace : null;
  /** @type {null | { mode: 'pressed'|'dragging'|'held', pointerId, pointerType, piece, from, sx, sy, timer, last? }} */
  let st = null;
  let hoverUid = null;
  let hoverTileKey = '';

  const emit = (name, payload) => { try { h.emit(name, payload); } catch (err) { console.error('[drag] listener failed', err); } };
  const draggable = (piece) => !!piece && piece.draggable !== false && piece.uid != null;
  const tileAt = (x, y) => { try { return h.pickTile(x, y); } catch { return null; } };
  const pieceAt = (x, y) => { try { return h.hitPiece(x, y); } catch { return null; } };
  const overCanvas = (cx, cy) => { try { return h.isOverCanvas ? h.isOverCanvas(cx, cy) !== false : true; } catch { return true; } };

  function setHoverTile(tile) {
    const slot = tile ? tileSlot(tile) : null;
    const key = tile ? `${tile.row},${tile.col}` : '';
    if (key === hoverTileKey) return;
    hoverTileKey = key;
    emit('tileHover', tile ? { row: tile.row, col: tile.col, area: slot ? slot.area : null, idx: slot && slot.area !== 'board' ? slot.idx : undefined } : null);
  }

  function setHoverPiece(piece, e) {
    const uid = piece ? piece.uid : null;
    if (uid === hoverUid) return;
    hoverUid = uid;
    emit('pieceHover', piece ? { uid, piece, clientX: e.clientX, clientY: e.clientY } : { uid: null });
  }

  function clearTimer() { if (st && st.timer != null) { clearT(st.timer); st.timer = null; } }

  function startDrag(e) {
    clearTimer();
    st.mode = 'dragging';
    setHoverPiece(null, e);
    emit('pieceDragStart', { uid: st.piece.uid, piece: st.piece, from: st.from });
    moveDrag(e);
  }

  function moveDrag(e) {
    st.last = e;
    const tile = tileAt(e.x, e.y);
    const over = overCanvas(e.clientX, e.clientY);
    const slot = over && tile ? tileSlot(tile) : null;
    const legal = !!slot && (slot.area === 'board' || !sameSlot(slot, st.from)) && isLegal(canPlace, st.piece, slot);
    setHoverTile(over ? tile : null);
    emit('pieceDragMove', { uid: st.piece.uid, piece: st.piece, x: e.x, y: e.y, clientX: e.clientX, clientY: e.clientY, target: slot, legal });
  }

  function endDrag(e, cancelled) {
    const s = st;
    st = null;
    if (!s) return;
    let dropped = false;
    if (!cancelled) {
      const tile = tileAt(e.x, e.y);
      const d = resolveDrop({ piece: s.piece, from: s.from, tile, overCanvas: overCanvas(e.clientX, e.clientY), clientX: e.clientX, clientY: e.clientY, canPlace });
      if (d.kind === 'drop') {
        dropped = true;
        emit('pieceDrop', { uid: s.piece.uid, piece: s.piece, from: s.from, target: d.target });
      }
    }
    emit('pieceDragEnd', { uid: s.piece.uid, piece: s.piece, dropped, cancelled: !dropped });
  }

  return {
    get editable() { return editable; },
    get dragging() { return !!st && st.mode === 'dragging'; },
    get dragPiece() { return st && st.mode === 'dragging' ? st.piece : null; },
    get hoverUid() { return hoverUid; },

    setEditable(v) {
      editable = !!v;
      if (!editable && st && st.mode === 'dragging') endDrag(null, true);
    },
    setCanPlace(fn) { canPlace = typeof fn === 'function' ? fn : null; },

    /** e: { pointerId, pointerType, button, x, y (canvas CSS px), clientX, clientY } */
    pointerDown(e) {
      if (st) return false; // one pointer at a time
      const piece = pieceAt(e.x, e.y);
      if (!piece) { setHoverTile(tileAt(e.x, e.y)); return false; }
      if (e.button === 2) {
        emit('pieceClick', { uid: piece.uid, piece, button: 2, detail: true, clientX: e.clientX, clientY: e.clientY });
        emit('pieceDetail', { uid: piece.uid, piece, clientX: e.clientX, clientY: e.clientY });
        return true;
      }
      if (e.button != null && e.button !== 0) return false;
      st = { mode: 'pressed', pointerId: e.pointerId, pointerType: e.pointerType || 'mouse', piece, from: pieceSlot(piece), sx: e.x, sy: e.y, cx: e.clientX, cy: e.clientY, timer: null };
      if (st.pointerType === 'touch' || st.pointerType === 'pen') {
        const snapshot = st;
        st.timer = setT(() => {
          if (st !== snapshot || st.mode !== 'pressed') return;
          st.timer = null;
          st.mode = 'held';
          emit('pieceClick', { uid: piece.uid, piece, button: 0, detail: true, clientX: snapshot.cx, clientY: snapshot.cy });
          emit('pieceDetail', { uid: piece.uid, piece, clientX: snapshot.cx, clientY: snapshot.cy });
        }, h.longPressMs);
      }
      return true;
    },

    pointerMove(e) {
      if (!st) {
        if (e.pointerType === 'touch') return;
        setHoverPiece(pieceAt(e.x, e.y), e);
        setHoverTile(tileAt(e.x, e.y));
        return;
      }
      if (e.pointerId !== st.pointerId) return;
      if (st.mode === 'pressed') {
        const th = st.pointerType === 'touch' ? h.touchThreshold : h.threshold;
        if (Math.hypot(e.x - st.sx, e.y - st.sy) >= th) {
          if (editable && draggable(st.piece)) startDrag(e);
          else { clearTimer(); st.mode = 'held'; }
        }
      } else if (st.mode === 'dragging') moveDrag(e);
    },

    pointerUp(e) {
      if (!st || e.pointerId !== st.pointerId) return;
      if (st.mode === 'dragging') { endDrag(e, false); return; }
      const s = st;
      clearTimer();
      st = null;
      if (s.mode === 'pressed') emit('pieceClick', { uid: s.piece.uid, piece: s.piece, button: 0, detail: false, clientX: e.clientX, clientY: e.clientY });
    },

    pointerCancel(e) {
      if (!st || (e && e.pointerId !== st.pointerId)) return;
      if (st.mode === 'dragging') { endDrag(e, true); return; }
      clearTimer();
      st = null;
    },

    pointerLeave(e) {
      if (st) return;
      setHoverPiece(null, e || {});
      setHoverTile(null);
    },

    /**
     * Judge the drag again at the last pointer position: the ground under a still pointer changes while the camera
     * moves (the shop-collapsed zoom of a deploy, GitHub #602), so the target tile, its legality and the dragged
     * piece's place (pieceDragMove, tileHover) follow the camera, not only the pointer. No-op unless dragging.
     */
    refresh() {
      if (st && st.mode === 'dragging' && st.last) moveDrag(st.last);
    },

    /** Abort any interaction (piece list replaced, view destroyed…). */
    reset() {
      if (st && st.mode === 'dragging') endDrag(null, true);
      else { clearTimer(); st = null; }
      hoverUid = null;
      hoverTileKey = '';
    },
  };
}
