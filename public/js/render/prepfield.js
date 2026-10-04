// render/prepfield.js — where the prep board is shown (research 09 §1.2, DESIGN §3 / §15): normally the own board
// (rows 7–12, the stage grid as is); in the Final Assault / Hidden Core prep the player's pieces stand on THEIR half of
// the boss field — the sim's mapping (server/match/finalAssault.js bossFieldPlacement, sim Battle.mapTile / mapDir):
// board rows ≥ 7 → row − 7 (board 9–12 → boss 2–5, the bench row 7 → 0, the temp row 8 → 1); the right-hand player
// (side 'R') is mirrored col c → 20 − c with RIGHT ↔ LEFT (UP / DOWN unchanged, ConvertChessPositionInfoToBossMap).
// Pieces only ever stand on rows ≥ 7; other board rows (range tiles reaching past the field) shift the same way, so a
// DOWN range below the bench falls off the grid (row < 0) instead of landing on the boss rows, and `tilesToDisp` drops
// every tile that is not on the boss field (rows 0–6) — e.g. an UP range past the top wall onto the normal board.
//
// The view keeps every public coordinate in BOARD space (the server's, g.move targets, canPlace, highlightTiles,
// tileScreen, holdPiece, setPieceDir): only what is drawn and picked goes through this transform. Pure functions.
//
// The round's leader (community report #12, owner's decision 2026-10-04: research 09 §2.2's "the leader stands by its
// spawn point" over research 08 §4.1's pen): `leaderStand` finds it in m.private.nextEnemies (an entry with `start`, the
// leader's spawn tile on the boss field, server/match/waves.js previewOf) — the Final Assault prep shows it standing
// there instead of in the pen, and lights its hit tiles in red beside an operator's orange range preview (render/app.js).

/** Board row → display (boss-field) row: row − 7 (server/match/board.js BOARD_ROWS_ABOVE_BOSS is +7, the inverse). */
export const BOSS_ROW_SHIFT = -7;
export const MAX_COL = 20;

const MIRROR = Object.freeze({ RIGHT: 'LEFT', LEFT: 'RIGHT', UP: 'UP', DOWN: 'DOWN' });

/** RIGHT ↔ LEFT (UP / DOWN unchanged); unknown values pass through. */
export function mirrorDir(d) {
  return typeof d === 'string' && MIRROR[d.toUpperCase()] ? MIRROR[d.toUpperCase()] : d;
}

/** The identity transform (normal prep). */
export const IDENTITY = Object.freeze({
  kind: 'board', side: 'L', mirror: false,
  toDisp: (row, col) => ({ row, col }),
  toBoard: (row, col) => ({ row, col }),
  dirToDisp: (d) => d,
  dirToBoard: (d) => d,
});

/**
 * Transform of the Final Assault prep on side 'L' | 'R' of the boss field. `toBoard` returns null for display tiles
 * that are not on the player's half of the boss rows (0–5) — nothing of the board is there.
 */
export function bossPrepField(side) {
  const R = side === 'R';
  const lo = R ? 10 : 0, hi = R ? MAX_COL : 10;
  return Object.freeze({
    kind: 'bossPrep', side: R ? 'R' : 'L', mirror: R,
    toDisp: (row, col) => ({ row: row + BOSS_ROW_SHIFT, col: R ? MAX_COL - col : col }),
    toBoard: (row, col) => {
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 5 || col < lo || col > hi) return null;
      return { row: row - BOSS_ROW_SHIFT, col: R ? MAX_COL - col : col };
    },
    dirToDisp: (d) => (R ? mirrorDir(d) : d),
    dirToBoard: (d) => (R ? mirrorDir(d) : d),
  });
}

/** Last display row of the boss field band (rows 0–5 + the wall row 6) in the Final Assault prep. */
export const BOSS_DISP_MAX_ROW = 6;

/**
 * Map a list of board tiles ([[r,c]] or [{row,col}]) to display tiles ([[r,c]]). In the Final Assault prep tiles that
 * do not land on the boss field (display rows 0–6, cols 0–20) are dropped.
 */
export function tilesToDisp(xf, tiles) {
  const out = [];
  if (!Array.isArray(tiles)) return out;
  const boss = xf && xf.kind === 'bossPrep';
  for (const t of tiles) {
    const r = Array.isArray(t) ? t[0] : t?.row, c = Array.isArray(t) ? t[1] : t?.col;
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
    const d = xf.toDisp(r, c);
    if (boss && (d.row < 0 || d.row > BOSS_DISP_MAX_ROW || d.col < 0 || d.col > MAX_COL)) continue;
    out.push([d.row, d.col]);
  }
  return out;
}

/**
 * The leader standing on the boss field in its prep (see the header): the first `nextEnemies` entry flagged `boss` with
 * a spawn tile `start` ([row, col], boss-field rows 0–5) → { entry, row, col, tiles } — `tiles` its hit tiles there
 * (render/pick.js hitTiles: the sim's hit rectangle, data/enemies.json `hitArea` through `hitAreaOf(enemyKey)`; a point
 * leader its own tile) — or null.
 * @param {Array<object>|null} list m.private.nextEnemies
 * @param {(enemyKey: string) => any} hitAreaOf
 * @param {(x: number, y: number, a: any) => number[][]} hitTilesOf render/pick.js hitTiles
 */
export function leaderStand(list, hitAreaOf, hitTilesOf) {
  if (!Array.isArray(list)) return null;
  const entry = list.find((e) => e && e.boss && typeof e.enemyKey === 'string' && Array.isArray(e.start)
    && Number.isInteger(e.start[0]) && Number.isInteger(e.start[1]) && e.start[0] >= 0 && e.start[0] <= BOSS_DISP_MAX_ROW
    && e.start[1] >= 0 && e.start[1] <= MAX_COL);
  if (!entry) return null;
  const [row, col] = entry.start;
  let area = null;
  try { area = hitAreaOf ? hitAreaOf(entry.enemyKey) : null; } catch { area = null; }
  const tiles = (typeof hitTilesOf === 'function' ? hitTilesOf(col, row, area) : [[row, col]])
    .filter(([r, c]) => r >= 0 && r <= BOSS_DISP_MAX_ROW && c >= 0 && c <= MAX_COL);
  return { entry, row, col, tiles };
}
