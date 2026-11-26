// render/vfx/lanes.js — 塔露拉 S3 日冕重烈's 簇火 lanes (history §37.354): where the shots of one volley start and leave,
// from the kit's one 'heatwave' event per volley ({ x, y, dir, n } at the caster: server/sim/content/kits/ops/op-oxi.js
// `volley`) and the battle's field rect. The sim moves the shots itself and sends no event per shot (one per tick would
// move the goldens' fx counts), so the client rebuilds their paths here. Pure functions (Node tests): the official
// flights (render/vfx/skillfx.js `_lanes`: projectile_chr_oxi_s_3_heatwave's trail) and the procedural streaks
// (render/fx/simfx.js archetype 'lanes') draw the same paths.
//
//   heatwaveLanes(ev, rect, { back, exit })   [{ x0, y0, x1, y1, len, lane }…] in board coordinates (x column, y row)

/**
 * Tiles behind the caster a lane starts at most: op-oxi.js WAVE_MAX_BACK — the client's oxi_s_3_wave
 * EmitDirectionalMapEdgeProjectileVolley `_maxBackDistance` 11 (the skill's blackboard has no wave_max_back_distance;
 * PRTS "最远只会尝试在自身身后11格").
 */
export const LANE_BACK = 11;
/**
 * Tiles past the field's far edge a shot flies to: the skill's wave_exit_distance (data/backups.json 塔露拉 S3: 5), used
 * when our skill record has none (the volley node's own `_forwardExtension` is 2).
 */
export const LANE_EXIT = 5;
/** The shots' speed in tiles per second: the skill's wave_speed (data/backups.json: 2.3) when our record has none. */
export const LANE_SPEED = 2.3;
/** The most lanes a volley has (the 21-column board). */
const MAX_LANES = 21;
/** The whole board when no field rect is known (shared/constants.js GEO: 19 rows × 21 columns). */
const BOARD = Object.freeze({ r0: 0, r1: 18, c0: 0, c1: 20 });
/** Forward vector [dRow, dCol] per facing (server/sim/dir.js DIR_VEC: row 0 is the bottom row, UP = +row). */
const FACE = Object.freeze({ UP: [1, 0], RIGHT: [0, 1], DOWN: [-1, 0], LEFT: [0, -1] });

const finite = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * The lanes of one volley, as the kit builds them (op-oxi.js `volley`): the rows across the caster's facing (columns
 * when she faces up or down) — `n` of them (the event's count: floor((n − 1) / 2) on her lower side), the window shifted
 * inside the field at its edge (`_shiftLaneWindowAtMapEdge`; the whole field when it is narrower) — each from the tile
 * centre `back` tiles behind her (no farther than the field's back edge) to `exit` tiles past the field's far edge.
 * Returns [{ x0, y0, x1, y1, len, lane }] in board coordinates (x = column, y = row, as the sim's units), in lane order;
 * [] without a finite caster point. A junk facing is RIGHT; `n` is clamped to 1…21; no rect: the whole board.
 * @param {{ x: number, y: number, dir?: string, n?: number }} ev the 'heatwave' fx (its x, y: the caster's tile)
 * @param {{ r0: number, r1: number, c0: number, c1: number }|null} rect the battle's field (inclusive tile bounds)
 * @param {{ back?: number, exit?: number }} [o]
 */
export function heatwaveLanes(ev, rect, o = {}) {
  const x = Number(ev?.x), y = Number(ev?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  const R = rect && ['r0', 'r1', 'c0', 'c1'].every((k) => Number.isFinite(Number(rect[k]))) ? rect : BOARD;
  const r0 = Math.min(R.r0, R.r1), r1 = Math.max(R.r0, R.r1), c0 = Math.min(R.c0, R.c1), c1 = Math.max(R.c0, R.c1);
  const [fr, fc] = FACE[typeof ev.dir === 'string' ? ev.dir.toUpperCase() : ''] || FACE.RIGHT;
  const back = Math.max(0, finite(o.back, LANE_BACK)), exit = finite(o.exit, LANE_EXIT);
  const across = fr === 0;                          // facing left / right: the lanes are rows
  const row = Math.round(y), col = Math.round(x);
  const lo = across ? r0 : c0, hi = across ? r1 : c1, mine = across ? row : col;
  const n = Math.max(1, Math.min(MAX_LANES, Math.round(finite(ev.n, 1))));
  let a = mine - Math.floor((n - 1) / 2), b = a + n - 1;
  if (hi - lo < b - a) { a = lo; b = hi; } else if (a < lo) { b += lo - a; a = lo; } else if (b > hi) { a -= b - hi; b = hi; }
  const sign = across ? fc : fr, at = across ? col : row;
  const backEdge = sign > 0 ? (across ? c0 : r0) : (across ? c1 : r1);
  const farEdge = sign > 0 ? (across ? c1 : r1) : (across ? c0 : r0);
  const from = sign > 0 ? Math.max(backEdge, at - back) : Math.min(backEdge, at + back);
  const to = farEdge + sign * exit;
  const len = Math.abs(to - from);
  const out = [];
  for (let lane = a; lane <= b; lane++) {
    out.push(across ? { x0: from, y0: lane, x1: to, y1: lane, len, lane } : { x0: lane, y0: from, x1: lane, y1: to, len, lane });
  }
  return out;
}
