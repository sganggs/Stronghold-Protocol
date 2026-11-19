// render/arenaView.js — the field a view draws on a 规程 stage (data/stages.json `arena`, tools/versions/layouts.mjs
// regulationArena; DESIGN §15). The sim and the server keep the composed 19×21 stage; the client draws the one official
// piece a view shows, placed where that piece's cells are in the 19×21 grid (`region.field`):
//
//   'normal'  a player block (sub_01): hand row 7, equipment row 8, the road rows 9–12 cols 0–10 — the sim's normal
//             field, cell for cell — and the enemy preview pen BESIDE the road (rows 8–12, cols 12–18) as the 11-08
//             client draws it, instead of 盟约's pen above the board (rows 14–18)
//   'unite'   the 联防 board (sub_02): both hands in row 8, both road halves rows 9–12 (the sim's 联防 field)
//   'boss'    a boss field (sub_03): the benches and the boss field rows 0–6 (the sim's boss field) and its pen above
//             (rows 7–11)
//
// arenaField(stage, view) returns the stage the renderer draws for that view: the piece's cells copied into a void
// ('#') 19×21 grid, the arena devices standing on that piece moved with it (each keeps the stats and skill
// of the stage's own device of the same key), the pen rect of the piece in `config.enemy_place_rect` (render/pen.js
// lays the preview out on it), and `scenePiece` — the scene group of that piece and its shift (board3d/scene.js draws
// that group alone). A stage without `arena` (every 盟约 stage, a plugin stage) is returned as it is.
//
// Which player block: [ASSUMED] seat s draws the block whose `ownerSeat` is s, else the first player block — the four
// blocks are the same piece, so this only picks which copy of the arena's devices is drawn.

/** View of a camera kind ('prep' | 'normal' | 'pen' | 'unite' | 'boss' | 'hidden' | 'bossPrep'). */
export function arenaViewOf(kind, from = null) {
  // Previewing enemies is a camera detour within the originating piece, including boss prep.
  if (kind === 'pen') return arenaViewOf(from);
  if (kind === 'unite') return 'unite';
  if (kind === 'boss' || kind === 'hidden' || kind === 'bossPrep') return 'boss';
  return 'normal';
}

const ROLE_OF_VIEW = Object.freeze({ normal: 'player', unite: 'unite', boss: 'boss' });
const ROWS = 19, COLS = 21;
const EMPTY = '#'; // outside the piece: void (style.js GLYPH '#', drawn only as the ring around the piece)

/** The region of the arena a view draws (null without an arena or such a region). */
export function arenaRegion(stage, view, seat = null) {
  const regions = Array.isArray(stage?.arena?.regions) ? stage.arena.regions : null;
  if (!regions) return null;
  const role = ROLE_OF_VIEW[view] || 'player';
  const list = regions.filter((r) => r && r.role === role && Array.isArray(r.rect) && r.rect.length === 4 && r.field);
  if (!list.length) return null;
  if (role === 'player' && Number.isInteger(seat)) return list.find((r) => r.ownerSeat === seat) ?? list[0];
  if (role === 'boss') return list.find((r) => r.side === 'L') ?? list[0];
  return list[0];
}

/** The pen rect (`enemy_place_rect`) of a piece in grid cells: the tile_floor block that holds two tile_start anchors. */
function penRectOf(rows, legend) {
  const isPen = (g) => {
    const t = legend[g];
    return !!t && (t.tileKey === 'tile_floor' || t.tileKey === 'tile_start');
  };
  // the pen is the floor block whose row carries the previewNotAlloed mark; it spans two rows on each side of it
  for (let r = 0; r < rows.length; r++) {
    const line = rows[r];
    for (let c = 0; c < line.length; c++) {
      if (!legend[line[c]]?.bb?.previewNotAlloed) continue;
      let c1 = c;
      while (c1 + 1 < line.length && legend[line[c1 + 1]]?.bb?.previewNotAlloed) c1++;
      const r0 = r - 2, r1 = r + 2;
      if (r0 < 0 || r1 >= rows.length) return null;
      for (let rr = r0; rr <= r1; rr++) for (let cc = c; cc <= c1; cc++) if (rr !== r && !isPen(rows[rr][cc])) return null;
      return { r0, r1, c0: c, c1 };
    }
  }
  return null;
}

const cache = new WeakMap(); // stage → Map(view|seat → field stage)

/**
 * The stage a view draws (see the header). Same object for the same stage, view and seat.
 * @param {any} stage a data/stages.json entry
 * @param {'normal'|'unite'|'boss'} view
 * @param {{ seat?: number|null }} [o]
 */
export function arenaField(stage, view, { seat = null } = {}) {
  const arena = stage?.arena;
  if (!arena || !Array.isArray(arena.rows)) return stage;
  const region = arenaRegion(stage, view, seat);
  if (!region) return stage;
  let byKey = cache.get(stage);
  if (!byKey) cache.set(stage, (byKey = new Map()));
  const key = `${view}|${region.id}`;
  if (byKey.has(key)) return byKey.get(key);
  const [r0, r1, c0, c1] = region.rect;
  const { dr, dc } = region.field;
  const toGrid = (r, c) => [r - r0 + dr, c - c0 + dc];
  const inRegion = (r, c) => r >= r0 && r <= r1 && c >= c0 && c <= c1;
  const onGrid = ([r, c]) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
  for (let r = r0; r <= r1; r++) {
    const line = arena.rows[r] || '';
    for (let c = c0; c <= c1; c++) {
      const [gr, gc] = toGrid(r, c);
      if (onGrid([gr, gc])) grid[gr][gc] = line[c] ?? EMPTY;
    }
  }
  const rows = grid.map((line) => line.join(''));
  const tiles = { ...(stage.tiles || {}), ...(arena.tiles || {}) };
  const own = new Map();
  for (const d of Array.isArray(stage.devices) ? stage.devices : []) if (d?.key && !own.has(d.key)) own.set(d.key, d);
  const devices = (Array.isArray(arena.devices) ? arena.devices : []).filter((d) => Array.isArray(d?.pos) && inRegion(d.pos[0], d.pos[1])).map((d) => {
    const pos = toGrid(d.pos[0], d.pos[1]);
    const rangeTiles = Array.isArray(d.rangeTiles) ? d.rangeTiles.filter((p) => inRegion(p[0], p[1])).map((p) => toGrid(p[0], p[1])).filter(onGrid) : null;
    return { ...(own.get(d.key) || {}), ...d, pos, rangeTiles };
  }).filter((d) => onGrid(d.pos));
  const pen = penRectOf(rows, tiles);
  const out = {
    ...stage,
    rows,
    tiles,
    devices,
    mapChars: [],
    config: { ...(stage.config || {}), ...(pen ? { enemy_place_rect: `((${pen.r0},${pen.c0}),(${pen.r1},${pen.c1}))` } : {}) },
    arenaView: view,
    scenePiece: { group: `sub_0${region.piece}`, dr, dc },
  };
  byKey.set(key, out);
  return out;
}
