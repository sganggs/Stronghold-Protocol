// tools/versions/layouts.mjs — 规程's level layout turned into the 盟约 one that tools/build-data.mjs, the sim and the client
// read (docs/DATA.md §11–§12, shared/constants.js GEO).
//
// A 盟约 level is one 19×21 grid per player, rows counted from the bottom: the boss field (rows 0–5, its benches in rows
// 0–1), the own board (hand row 7, temp row 8, the two road halves in rows 9–12 — a normal battle uses the left one) and
// the enemy preview pen (rows 14–18), with separators in rows 6 and 13; the round templates carry the same 19×21 grid.
// 规程 (act3autochess) builds every player's field in one scene instead (the 11-08 client's AutoChessMapAreaManager:
// CHAR_HAND_0…3 / EQUIP_HAND_0…3 per player on map layers A–D, BATTLE_BOSS_LEFT/RIGHT areas), so its levels are pieces:
//   level_<stage>.json            a 36×55 atlas of the pieces below (4 player blocks, 2 boss blocks, 1 joint board)
//   level_<stage>/…_sub_01.json   7×20 one player's block: the left road half, the preview pen beside it (cols 12–18),
//                                 the 5-slot equipment row (tile_acbag, cols 4–8) and the 10-slot hand row
//   level_<stage>/…_sub_02.json   6×21 both road halves (the 联防 board) and both hands
//   level_<stage>/…_sub_03.json   13×21 the preview pen over the boss field with its equipment rows and benches
//   round templates               the road only: 5×9 a normal round (the left half), 5×17 the 联防 rounds (both halves),
//                                 6×17 a boss round (the boss field without its benches)
// composeRegulationStage puts the pieces where a 盟约 level has them — rows 0–6 and 14–18 from sub_03, rows 9–13 from
// sub_02, rows 7–8 (hand, and the equipment row in place of 盟约's temp row) from sub_01 — and placeRegulationTemplate
// pastes a template at its 盟约 place (TEMPLATE_OFFSETS), moving every position with it. The two hand rows (0 and 7) get
// 盟约's isValidHand mark: 规程's hand tiles carry none (its client knows them by MapAreaType CHAR_HAND), and cells no piece
// covers are void tile_forbidden ('#'). test/versions-regulation.test.js pins the result against 盟约's cells.
//
// The sim keeps that 19×21 grid. The client draws the official arena (regulationArena): the 36×55 level itself and where
// each piece lies in it (its seven regions), with the place each piece takes in the 19×21 grid (PIECE_FIELD), so a field
// is drawn as the one official piece the player sees there — the own block with its pen beside the road, the 联防 board,
// the boss field with its pen above — instead of rows cut from three pieces.

import { createOfficialUnitBuilders } from '../../server/plugins/officialUnitBuilder.js';

const { bestCandidate } = createOfficialUnitBuilders();

/** The cannon's unlocked EnemyCannon00 talent defines its landing distance in range_table. */
export function cannonDistance(ctx, level) {
  const talents = ctx.charTable.trap_196_cnnon.talents;
  const talent = talents.map(t => bestCandidate(t.candidates, 0, level)).find(t => t?.prefabKey === 'EnemyCannon00');
  const grids = ctx.rangeTable[talent?.rangeId]?.grids;
  if (!grids?.length) throw new Error(`cannon: missing landing range at level ${level}`);
  return Math.max(...grids.map(g => g.col));
}

export const ROWS = 19;
export const COLS = 21;

/** Template size → where its bottom-left cell goes in the 19×21 grid (rows from the bottom). */
export const TEMPLATE_OFFSETS = Object.freeze({
  '5x9': Object.freeze({ dr: 9, dc: 2 }),  // a normal round: the left road half, rows 9–12 (+ the separator row 13)
  '5x17': Object.freeze({ dr: 9, dc: 2 }), // 联防 (escaped_single / _multi): both halves, objective (9,2), gates (9,10) (9,18)
  '6x17': Object.freeze({ dr: 1, dc: 2 }), // a boss round: the boss field, rows 1–6 (its E row is row 2, the teleports row 1)
});

/** Rows (bottom = 0) of the 19×21 grid and the piece row they come from. */
const STAGE_ROWS = Object.freeze([
  ...[0, 1, 2, 3, 4, 5, 6].map((r) => ({ r, piece: 3, from: r })),     // boss field + benches + separator: sub_03 rows 0–6
  { r: 7, piece: 1, from: 0 },                                          // hand row: sub_01 row 0
  { r: 8, piece: 1, from: 1, cols: 12 },                                // equipment row: sub_01 row 1, cols 0–11 (the pen beside it is not 盟约's)
  ...[9, 10, 11, 12, 13].map((r) => ({ r, piece: 2, from: r - 8 })),   // the two road halves + separator: sub_02 rows 1–5
  ...[14, 15, 16, 17, 18].map((r) => ({ r, piece: 3, from: r - 7 })),  // preview pen: sub_03 rows 7–11
]);

const sizeOf = (lv) => `${lv.mapData.map.length}x${lv.mapData.map[0]?.length ?? 0}`;
/** A level's tile object at (row from the bottom, col), or undefined outside its grid. */
const tileAt = (lv, r, c) => {
  const m = lv.mapData.map;
  const row = m[m.length - 1 - r];
  return row && c >= 0 && c < row.length ? lv.mapData.tiles[row[c]] : undefined;
};
/** Every { row, col } object of a level outside its mapData (routes, checkpoints, predefines …). */
function positions(lv) {
  const out = [];
  const walk = (node, key) => {
    if (!node || typeof node !== 'object' || key === 'mapData') return;
    if (!Array.isArray(node) && Number.isInteger(node.row) && Number.isInteger(node.col) && Object.keys(node).length === 2) { out.push(node); return; }
    for (const [k, v] of Object.entries(node)) walk(v, k);
  };
  walk(lv, '');
  return out;
}

/**
 * A 19×21 mapData built cell by cell: `cellOf(r, c)` returns a tile object (rows from the bottom); identical tiles share
 * one entry of `tiles`, in first-use order.
 */
function gridOf(cellOf) {
  const tiles = [];
  const index = new Map();
  const map = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const t = cellOf(r, c);
      const key = JSON.stringify(t);
      if (!index.has(key)) { index.set(key, tiles.length); tiles.push(t); }
      row.push(index.get(key));
    }
    map.push(row);
  }
  return { map, tiles };
}

/**
 * The void tile of a piece — tile_forbidden that flying units cross (盟约's '#'), else its separator — fills cells a piece
 * does not cover.
 */
function fillerOf(lv) {
  const forbidden = lv.mapData.tiles.filter((t) => t?.tileKey === 'tile_forbidden');
  const t = forbidden.find((x) => x.passableMask !== 'NONE') ?? forbidden[0];
  if (!t) throw new Error(`layout: ${lv.levelId ?? '?'} has no tile_forbidden`);
  return t;
}

/** 盟约's hand slot: tile_achand marked isValidHand (its temp row's tiles carry no mark). */
const asHandSlot = (t) => (t?.tileKey !== 'tile_achand' || (Array.isArray(t.blackboard) && t.blackboard.some((b) => b.key === 'isValidHand')) ? t
  : { ...t, blackboard: [...(Array.isArray(t.blackboard) ? t.blackboard : []), { key: 'isValidHand', value: 1, valueStr: null }] });
const HAND_ROWS = new Set([0, 7]);

/**
 * 规程 stage → 盟约 level: the main atlas file keeps its options, runes and the rest; its map and predefines are rebuilt
 * from the three pieces (the atlas repeats them once per player).
 * @param {any} main level_<stage>.json
 * @param {[any, any, any]} pieces sub_01, sub_02, sub_03
 * @param {{ charTable: any, rangeTable: any }} [tables] official tables, required for pieces with cannons
 * @returns {any} a new level object
 */
export function composeRegulationStage(main, [sub1, sub2, sub3], tables) {
  const want = { 1: '7x20', 2: '6x21', 3: '13x21' };
  const piece = { 1: sub1, 2: sub2, 3: sub3 };
  for (const k of [1, 2, 3]) if (sizeOf(piece[k]) !== want[k]) throw new Error(`layout: ${main.levelId} sub_0${k} is ${sizeOf(piece[k])}, expected ${want[k]}`);
  const filler = fillerOf(sub1);
  const byRow = new Map(STAGE_ROWS.map((x) => [x.r, x]));
  const { map, tiles } = gridOf((r, c) => {
    const x = byRow.get(r);
    if (x.cols !== undefined && c >= x.cols) return filler;
    const t = tileAt(piece[x.piece], x.from, c) ?? filler;
    return HAND_ROWS.has(r) ? asHandSlot(t) : t;
  });
  // predefines: the board's from sub_02 (rows 1–5 → 9–13), the boss field's and the pen's from sub_03; sub_01 repeats
  // sub_02's left half, its own copies are left out
  const moved = (lv, shift) => {
    const out = structuredClone(lv.predefines ?? {});
    for (const t of out.tokenInsts || []) {
      if (t.inst?.characterKey !== 'trap_196_cnnon') continue;
      // Each arena piece owns the cannon's landing route. Its branch actions share placeholder indices across
      // pieces; resolve the actual extraRoute at this cannon's landing point before moving it into battle space.
      const distance = cannonDistance(tables, t.inst.level || 1);
      const [dr, dc] = { UP: [1, 0], DOWN: [-1, 0], LEFT: [0, -1], RIGHT: [0, 1] }[t.direction];
      const route = (lv.extraRoutes || []).find(r => r.startPosition.row === t.position.row + dr * distance
        && r.startPosition.col === t.position.col + dc * distance);
      if (!route) throw new Error(`layout: ${lv.levelId} cannon has no landing route`);
      t.cannonRoute = structuredClone(route);
    }
    for (const p of positions(out)) { const to = shift(p.row); if (to === null) throw new Error(`layout: ${lv.levelId} has a predefine at row ${p.row} outside the rows it lends`); p.row = to; }
    return out;
  };
  const p2 = moved(sub2, (r) => (r >= 1 && r <= 5 ? r + 8 : null));
  const p3 = moved(sub3, (r) => (r <= 6 ? r : r <= 11 ? r + 7 : null));
  const predefines = {};
  for (const k of new Set([...Object.keys(p2), ...Object.keys(p3)])) {
    const a = p2[k], b = p3[k];
    predefines[k] = Array.isArray(a) || Array.isArray(b) ? [...(a || []), ...(b || [])] : (a ?? b);
  }
  return { ...main, mapData: { ...main.mapData, map, tiles }, predefines };
}

/**
 * 规程 round template → 盟约 template: its road grid pasted at its 盟约 place in a 19×21 grid of its own separator tile,
 * every position moved with it. A 19×21 level (the 盟约 training templates the tutorial mode borrows, the season's
 * level_autochess_enemy_data) is returned as it is.
 * @param {any} lv
 * @returns {any}
 */
export function placeRegulationTemplate(lv) {
  const size = sizeOf(lv);
  if (size === `${ROWS}x${COLS}`) return lv;
  const off = TEMPLATE_OFFSETS[size];
  if (!off) throw new Error(`layout: template ${lv.levelId} is ${size}, no known place (${Object.keys(TEMPLATE_OFFSETS).join(', ')})`);
  const out = structuredClone(lv);
  const filler = fillerOf(lv);
  const { map, tiles } = gridOf((r, c) => tileAt(lv, r - off.dr, c - off.dc) ?? filler);
  out.mapData = { ...out.mapData, map, tiles };
  for (const p of positions(out)) { p.row += off.dr; p.col += off.dc; }
  return out;
}

/**
 * Where each piece's bottom-left cell lies in the 19×21 grid (rows from the bottom) — the same shifts as STAGE_ROWS:
 * sub_01's hand row is grid row 7 (its road rows 2–5 are the normal field, rows 9–12, and its pen cols 12–18 sit
 * beside it in rows 8–12), sub_02's road rows 1–5 are grid rows 9–13 (its hand row 0 is row 8), sub_03 is rows 0–12
 * (boss field 0–6, its pen 7–11).
 */
export const PIECE_FIELD = Object.freeze({
  1: Object.freeze({ dr: 7, dc: 0 }),
  2: Object.freeze({ dr: 8, dc: 0 }),
  3: Object.freeze({ dr: 0, dc: 0 }),
});
const PIECE_ROLE = Object.freeze({ 1: 'player', 2: 'unite', 3: 'boss' });

/** What makes two official cells the same cell (the atlas writes an empty blackboard as null, the pieces as []). */
const cellKey = (t) => (t ? JSON.stringify([t.tileKey, t.heightType, t.buildableType, t.passableMask, t.blackboard?.length ? t.blackboard : null]) : '');

/**
 * Every place where `piece` lies in `level` cell for cell, as [r0, c0] (rows from the bottom). A piece cell is matched
 * against the level's cell of the same kind, height, buildable / passable masks and blackboard.
 */
function findPiece(level, piece) {
  const m = level.mapData.map, pm = piece.mapData.map;
  const H = m.length, W = m[0]?.length ?? 0, h = pm.length, w = pm[0]?.length ?? 0;
  const want = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) want.push([r, c, cellKey(tileAt(piece, r, c))]);
  const at = [];
  for (let r0 = 0; r0 + h <= H; r0++) {
    for (let c0 = 0; c0 + w <= W; c0++) {
      if (want.every(([r, c, k]) => cellKey(tileAt(level, r0 + r, c0 + c)) === k)) at.push([r0, c0]);
    }
  }
  return at;
}

/**
 * 规程's arena: the stage's 36×55 level (the hand rows marked like composeRegulationStage marks them) and its regions —
 * every place one of the three pieces lies in it, found cell for cell, never a fixed rect:
 *   { id, role: 'player' | 'unite' | 'boss', piece: 1 | 2 | 3, rect: [r0, r1, c0, c1], field: { dr, dc }, ownerSeat? , side? }
 * rect is inclusive, in arena rows from the bottom; field is PIECE_FIELD (arena cell (r, c) of the region is grid cell
 * (r − r0 + dr, c − c0 + dc)). Region ids follow the rects (bottom row first, then left col). The 11-08 client puts one
 * player per player block (map layers A–D) and the two boss fields on BATTLE_BOSS_LEFT / RIGHT; which seat takes which
 * block is not in the data: [ASSUMED] seats 0–3 take the player blocks in id order (bottom left, bottom right, top left,
 * top right), and `side` is 'L' / 'R' by column. The arena must be the three pieces and nothing else: four player
 * blocks, one 联防 board, two boss fields, every other cell tile_acempty — anything else throws.
 * @param {any} main level_<stage>.json
 * @param {[any, any, any]} pieces sub_01, sub_02, sub_03
 * @returns {{ level: any, regions: any[] }}
 */
export function regulationArena(main, pieces) {
  const want = { 1: 4, 2: 1, 3: 2 };
  const found = [];
  pieces.forEach((piece, i) => {
    const n = i + 1;
    const at = findPiece(main, piece);
    if (at.length !== want[n]) throw new Error(`layout: ${main.levelId} holds sub_0${n} ${at.length} times, expected ${want[n]}`);
    const [h, w] = sizeOf(piece).split('x').map(Number);
    for (const [r0, c0] of at) found.push({ piece: n, rect: [r0, r0 + h - 1, c0, c0 + w - 1] });
  });
  found.sort((a, b) => a.rect[0] - b.rect[0] || a.rect[2] - b.rect[2]);
  const m = main.mapData.map;
  const H = m.length, W = m[0]?.length ?? 0;
  const inside = (r, c) => found.some(({ rect: [r0, r1, c0, c1] }) => r >= r0 && r <= r1 && c >= c0 && c <= c1);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (!inside(r, c) && tileAt(main, r, c)?.tileKey !== 'tile_acempty') {
        throw new Error(`layout: ${main.levelId} cell (${r},${c}) is ${tileAt(main, r, c)?.tileKey}, outside every piece`);
      }
    }
  }
  let seat = 0;
  const bossCols = found.filter((x) => x.piece === 3).map((x) => x.rect[2]);
  const regions = found.map((x, id) => ({
    id, role: PIECE_ROLE[x.piece], piece: x.piece, rect: x.rect, field: { ...PIECE_FIELD[x.piece] },
    ...(x.piece === 1 ? { ownerSeat: seat++ } : {}),
    ...(x.piece === 3 ? { side: x.rect[2] === Math.min(...bossCols) ? 'L' : 'R' } : {}),
  }));
  const { map, tiles } = (() => {
    const out = { map: [], tiles: [] };
    const index = new Map();
    for (let r = H - 1; r >= 0; r--) {
      const row = [];
      for (let c = 0; c < W; c++) {
        const t = asHandSlot(tileAt(main, r, c));
        const key = JSON.stringify(t);
        if (!index.has(key)) { index.set(key, out.tiles.length); out.tiles.push(t); }
        row.push(index.get(key));
      }
      out.map.push(row);
    }
    return out;
  })();
  return { level: { ...main, mapData: { ...main.mapData, map, tiles } }, regions };
}
