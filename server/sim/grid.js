// server/sim/grid.js — field grid, tile queries, passability and the official ground pathfinding (DESIGN §3,
// research 08 §3).
//
// Coordinates: row 0 = bottom, col 0 = left. Tile (r,c) has world centre (x=c, y=r).
// Stage input: `{ id, rows: string[19] (bottom-first), legend?: {glyph: {...}}, devices?: [...] }`.
// Legend entries are normalised from either the research format (heightType/buildableType/passableMask/tileKey)
// or the build-data format (height/build/passable/terrain); missing glyphs fall back to DEFAULT_LEGEND.
// `build` is the EFFECTIVE deploy type: a tile whose mechanism refuses deployment (DEPLOY_REFUSED_TILES: 深水区
// tile_deepsea — PRTS 深水区 地形信息 "地形机制：拒绝部署（待补充）"; player report after 0.1.0: operators stood in
// 战场#08's pool and 突袭 members jumped into it) is NONE whatever its level buildableType (ALL), so `canStand` — every
// automatic placement: the 突袭 landing tile, tactical points, summon tiles — and the path tie-break below treat it as
// ground no operator can stand on. data/stages.json legends already carry the effective value (tools/build-data.mjs).
// Known limit [ASSUMED]: the 特制水上平台 that makes a 深水区 deployable (act1 m05, weight 0 this season) exists only in
// the match's deploy map; the sim does not model those canoes (content/devices.js), so here their tiles stay NONE.
//
// Pathfinding = the official client's (`Torappu.Battle.SPFA`, research 08 §3.1/§3.4): one FLOW FIELD per destination,
// a FIFO SPFA from the destination over the rect with the 4 neighbours UP (row+1), RIGHT, DOWN, LEFT (in that order,
// no diagonal edges), edge cost = the neighbour's move cost (1, or OBSTACLE_COST 1000 for an "obstacle-like" tile: a
// crate), strict-improvement relaxation (a tile keeps the first parent that reached it); then the parents are
// smoothed row-major in place — each tile's parent jumps to the farthest ancestor in Bresenham line of sight (every
// tile on the line walkable and not a crate; a diagonal step needs both orthogonal neighbours clear). A ground enemy
// walks straight toward `next[tile]` of its current tile (ai.js). Fields are cached per (destination, grid version).
//
// Blockable-ground preference (user playtest #2: "the lower-gate enemies of 战场#01 walk up the col-9 floor lane where
// no operator can block them"), kept to where the official route really walks over more floor (community report after
// 0.1.0: on 战场#04 活性源石 the lower-gate enemies must cross diagonally from row 9 into row 10 as officially, not
// walk two tiles left of the gate and then straight up). A tile is non-blockable when it is walkable but not LOW
// ground buildable for melee (floor / gate / goal / teleport / 深水区 tiles — `blockable()` false; no gate route of 战场#08
// changed when its 深水区 became non-buildable). Each field holds two candidate
// pointers per tile, both with the official `dist` (so the crate cost 1000 and every grid route length stay official):
//   * official: the plain algorithm above;
//   * preference (0.1.0's): the SPFA relaxes on (dist, pen) lexicographically, `pen` = non-blockable tiles on the chain
//     (among equal-length chains the fewest wins; remaining ties go to the first parent in SPFA order), and the line of
//     sight may cover a non-blockable tile — its Bresenham footprint, the corner tiles of a diagonal step included —
//     only on the tile's own raw chain between its two ends, so it never slips past a road tile beside floor its grid
//     route does not walk.
// `next[tile]` is the official pointer unless the preference pointer leads to a route CROSSING strictly fewer
// non-blockable tiles (`cost`, counted to the destination in increasing `dist` order) and no more 深水区 (`deep`): 深水区
// is non-blockable itself, so without that test the preference waded into the pool to dodge floor (GitHub #375: on
// 战场#08(下半) the patrolling 铳 / 卢西恩 took the lower road (3,9) → (2,3) through two water tiles, one floor tile fewer
// than the official upper road with one). A segment crosses the tiles
// whose interior it passes through (`crossTiles`, exact geometry); one it only touches at a corner point is not crossed
// — the first version counted the corner tiles there too and so bent official diagonals into L shapes (D5). On equal
// counts the official pointer stays, except where the preference one merely skips it (the official waypoint lies on
// the straight line to it and leads there: the same walk, one waypoint fewer). So the route from every tile crosses
// no more floor than the official one and leaves it only for a step that crosses less (test/sim/pathing-official.test.js
// lists the routes that still differ on every stage).
// Unavoidable non-blockable tiles (gates, goals, teleports and single-exit floor, e.g. (12,9) next to the upper
// gate) stay on the route; test/sim/pathing-blockable.test.js lists them per stage, gate and field.
//
// Obstacle layer (bit flags per tile): BLOCK (射击台 / mounds / `setObstacle(r, c, on)` — impassable [ASSUMED for
// platforms, research 08 §8 #1]) and CRATE (阻隔工事 devices — `setObstacle(r, c, on, 'crate')`: walkable at cost 1000,
// blocks line of sight; an enemy that must cross one is blocked by the device and breaks it). Any change bumps
// `version`, which invalidates the cached fields (enemies re-read their next step). `groundPassable` (placement,
// displacement, content) still treats both kinds as occupied unless `ignoreObstacles`. `straightClear` tells whether an
// off-centre unit may walk straight to a tile centre (ai.js planLeg, fear.js: else it steps back to its tile centre).

import { ROWS, COLS } from './constants.js';
import { hypot } from './detmath.js';

/** Move cost of an obstacle-like tile (client `Tile.get_moveCost`: obstacle-like ? 1000 : 1). */
export const OBSTACLE_COST = 1000;
/** Obstacle-layer bits. */
export const OB_BLOCK = 1;
export const OB_CRATE = 2;
/** Official neighbour order `GridPosition.GRID_FOUR_WAYS`: UP (row+1), RIGHT, DOWN, LEFT — do not reorder. */
const FOUR_WAYS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** Cached flow fields per grid version (destinations: route ends, checkpoints, attract points). */
const FIELD_CACHE_MAX = 64;

/** Built-in legend (research 05 §2.3) used when a stage has no legend entry for a glyph. */
export const DEFAULT_LEGEND = Object.freeze({
  '#': { height: 'HIGH', build: 'NONE', pass: 'FLY', key: 'tile_forbidden' },
  X: { height: 'HIGH', build: 'NONE', pass: 'NONE', key: 'tile_forbidden' },
  r: { height: 'LOW', build: 'ALL', pass: 'ALL', key: 'tile_road' },
  R: { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_road' },
  f: { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_floor' },
  p: { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_floor' },
  h: { height: 'HIGH', build: 'RANGED', pass: 'FLY', key: 'tile_wall' },
  b: { height: 'LOW', build: 'ALL', pass: 'FLY', key: 'tile_fence_bound' },
  a: { height: 'HIGH', build: 'NONE', pass: 'FLY', key: 'tile_achand' },
  A: { height: 'HIGH', build: 'NONE', pass: 'FLY', key: 'tile_achand' },
  S: { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_start', special: 'start' },
  E: { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_end', special: 'end' },
  I: { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_telin', special: 'telin' },
  O: { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_telout', special: 'telout' },
  m: { height: 'LOW', build: 'ALL', pass: 'ALL', key: 'tile_mire', terrain: 'mire' },
  g: { height: 'LOW', build: 'ALL', pass: 'ALL', key: 'tile_smog', terrain: 'smog' },
  d: { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_deepsea', terrain: 'deepsea' },
  i: { height: 'LOW', build: 'ALL', pass: 'ALL', key: 'tile_infection', terrain: 'infection' },
  // 规程 (act3autochess): m12 tile_speedup — a ground unit standing on it gains ASPD +attack_speed and move ×move_speed
  // (devices.js reads stage.special.speedup, official 25 / 1.5). Flyers skip it like every other ground terrain.
  // m09 tile_duel_grassland has no blackboard [ASSUMED] plain deployable ground, no extra mechanism.
  z: { height: 'LOW', build: 'ALL', pass: 'ALL', key: 'tile_speedup', terrain: 'speedup' },
  w: { height: 'LOW', build: 'ALL', pass: 'ALL', key: 'tile_duel_grassland' },
});

/**
 * Tile keys whose mechanism refuses deployment although the level's buildableType allows it: 深水区 tile_deepsea (PRTS
 * 深水区 地形信息 "部署类型 全部位 … 地形机制 拒绝部署（待补充）"; PRTS 作战机制: the 地形标记 AdvancedBuildableMask —
 * 深水 among them — "限制玩家仅能部署匹配的单位于其上"; the season-1 战场#05 puts a 特制水上平台 — "在水上建立可以部署
 * 任意单位的平台" — on every one of its 深水区 tiles). Shared with tools/build-data.mjs (the stages.json legend's
 * `buildable`).
 */
export const DEPLOY_REFUSED_TILES = Object.freeze(new Set(['tile_deepsea']));

const TERRAIN_BY_KEY = { tile_mire: 'mire', tile_smog: 'smog', tile_deepsea: 'deepsea', tile_infection: 'infection', tile_deepwater: 'deepsea', tile_speedup: 'speedup' };
const SPECIAL_BY_KEY = { tile_start: 'start', tile_end: 'end', tile_telin: 'telin', tile_telout: 'telout' };

function normPass(v) {
  if (v === true) return 'ALL';
  if (v === false) return 'NONE';
  const s = String(v ?? '').toUpperCase();
  if (s === 'ALL' || s === 'GROUND' || s === 'WALK') return 'ALL';
  if (s.includes('FLY')) return 'FLY';
  if (s === 'NONE' || s === '') return 'NONE';
  return 'ALL';
}

/** Normalise one legend entry (any known format) into `{ height, build, pass, key, terrain, special }`. */
export function normalizeLegendEntry(glyph, e) {
  const base = DEFAULT_LEGEND[glyph] || { height: 'LOW', build: 'NONE', pass: 'ALL', key: 'tile_floor' };
  if (!e || typeof e !== 'object') return { ...base, glyph };
  const key = e.tileKey ?? e.key ?? e.tile ?? base.key;
  const heightRaw = e.height ?? e.heightType;
  const height = heightRaw == null ? base.height : (/HIGH/i.test(String(heightRaw)) ? 'HIGH' : 'LOW');
  const buildRaw = e.build ?? e.buildable ?? e.buildableType;
  const build = DEPLOY_REFUSED_TILES.has(key) ? 'NONE'
    : buildRaw == null ? base.build : (buildRaw === true ? 'ALL' : buildRaw === false ? 'NONE' : String(buildRaw).toUpperCase());
  let pass;
  if (e.pass != null) pass = normPass(e.pass);
  else if (e.passable != null || e.passableMask != null) pass = normPass(e.passable ?? e.passableMask);
  else if (e.groundPassable != null) pass = e.groundPassable ? 'ALL' : (e.flyPassable === false ? 'NONE' : 'FLY');
  else pass = base.pass;
  const terrain = e.terrain ?? TERRAIN_BY_KEY[key] ?? base.terrain ?? null;
  const special = e.special ?? SPECIAL_BY_KEY[key] ?? base.special ?? null;
  return { glyph, key, height, build, pass, terrain, special };
}

const EMPTY_TILE = Object.freeze({ glyph: 'X', key: 'tile_forbidden', height: 'HIGH', build: 'NONE', pass: 'NONE', terrain: null, special: null });

/**
 * A melee operator may stand on this terrain: LOW ground buildable for ALL or MELEE. It blocks ground enemies there only
 * where ground units can pass — never on a fenced 围墙 / 围栏 tile (Battle._blockerFor, DESIGN §21.23).
 */
function isBlockableTile(t) { return t.height === 'LOW' && (t.build === 'ALL' || t.build === 'MELEE'); }

export class Grid {
  /**
   * @param {object} stage stage entry (rows bottom-first)
   * @param {{r0:number,r1:number,c0:number,c1:number}} rect inclusive simulation bounds
   */
  constructor(stage, rect) {
    this.stage = stage || {};
    this.rect = rect;
    this.rows = ROWS;
    this.cols = COLS;
    const rows = Array.isArray(this.stage.rows) ? this.stage.rows : [];
    const legend = this.stage.legend || {};
    const cache = new Map();
    const info = (g) => {
      if (!cache.has(g)) cache.set(g, Object.freeze(normalizeLegendEntry(g, legend[g])));
      return cache.get(g);
    };
    /** @type {object[]} */
    this.tiles = new Array(ROWS * COLS);
    for (let r = 0; r < ROWS; r++) {
      const line = typeof rows[r] === 'string' ? rows[r] : (Array.isArray(rows[r]) ? rows[r].join('') : '');
      for (let c = 0; c < COLS; c++) {
        const g = line[c];
        this.tiles[r * COLS + c] = g ? info(g) : EMPTY_TILE;
      }
    }
    /** 1 = walkable terrain an operator cannot block on (floor, gate, goal, teleport…): the path tie-break penalty */
    this.unblockable = new Uint8Array(ROWS * COLS);
    /** 1 = walkable 深水区 (terrain 'deepsea': tile_deepsea / tile_deepwater): the tie-break never walks into more of it */
    this.deepWater = new Uint8Array(ROWS * COLS);
    for (let k = 0; k < ROWS * COLS; k++) {
      const t = this.tiles[k];
      this.unblockable[k] = t.pass === 'ALL' && !isBlockableTile(t) ? 1 : 0;
      this.deepWater[k] = t.pass === 'ALL' && t.terrain === 'deepsea' ? 1 : 0;
    }
    /** obstacle bits per tile (OB_BLOCK | OB_CRATE) */
    this.obstacle = new Uint8Array(ROWS * COLS);
    this.version = 0;
    /** @type {Map<string, FlowField>} */
    this._fields = new Map();
  }

  key(r, c) { return r * COLS + c; }
  inBounds(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
  inRect(r, c) { const R = this.rect; return r >= R.r0 && r <= R.r1 && c >= R.c0 && c <= R.c1; }
  /** Tile info (frozen) or an impassable placeholder outside the stage. */
  tile(r, c) { return this.inBounds(r, c) ? this.tiles[r * COLS + c] : EMPTY_TILE; }

  /** Ground units may stand / be placed here (inside the rect, terrain passable, no obstacle of any kind). */
  groundPassable(r, c, ignoreObstacles = false) {
    if (!this.inRect(r, c)) return false;
    const t = this.tiles[r * COLS + c];
    if (t.pass !== 'ALL') return false;
    return ignoreObstacles || !this.obstacle[r * COLS + c];
  }

  /** Walkable for the flow field: in the rect, terrain passable for WALK, not hard-blocked (crates ARE walkable). */
  walkable(r, c, ignoreObstacles = false) {
    if (!this.inRect(r, c)) return false;
    const k = r * COLS + c;
    if (this.tiles[k].pass !== 'ALL') return false;
    return ignoreObstacles || !(this.obstacle[k] & OB_BLOCK);
  }

  flyPassable(r, c) { return this.inRect(r, c) && this.tile(r, c).pass !== 'NONE'; }

  /**
   * Whether a unit may be placed on this tile (every automatic placement: the 突袭 landing tile, tactical points, summon
   * tiles). `ranged` units may also use LOW ALL/MELEE tiles (DESIGN §3). The effective `build` refuses the 深水区
   * (DEPLOY_REFUSED_TILES); a hard-blocked tile (OB_BLOCK: a 射击台 switched on by a map card, a mound) takes no melee
   * unit — the match's deploy map makes a 射击台 ranged-only (server/match/board.js).
   */
  canStand(r, c, { ranged = false } = {}) {
    const t = this.tile(r, c);
    if (t.build === 'NONE') return false;
    if (ranged) return t.build === 'ALL' || t.build === 'RANGED' || (t.height === 'LOW' && t.build === 'MELEE');
    if (this.inBounds(r, c) && (this.obstacle[r * COLS + c] & OB_BLOCK)) return false;
    return t.height === 'LOW' && (t.build === 'ALL' || t.build === 'MELEE');
  }

  isLow(r, c) { return this.tile(r, c).height === 'LOW'; }

  /** Ground a melee operator can be deployed on (LOW, buildable ALL / MELEE) — terrain only; blocking: isBlockableTile. */
  blockable(r, c) { return isBlockableTile(this.tile(r, c)); }

  /**
   * Toggle an obstacle. `kind` 'block' (default: impassable — platforms, mounds, content) or 'crate' (obstacle-like:
   * walkable at OBSTACLE_COST, blocks line of sight). Each kind is its own bit, so a crate turned into a platform on
   * the same tile (map cards) stays consistent whatever the order of the two calls.
   */
  setObstacle(r, c, on, kind = 'block') {
    if (!this.inBounds(r, c)) return;
    const k = r * COLS + c;
    const bit = kind === 'crate' ? OB_CRATE : OB_BLOCK;
    const v = on ? (this.obstacle[k] | bit) : (this.obstacle[k] & ~bit);
    if (this.obstacle[k] === v) return;
    this.obstacle[k] = v;
    this.version++;
    this._fields.clear();
  }

  /** Any obstacle (crate or block) on the tile. */
  isObstacle(r, c) { return this.inBounds(r, c) && this.obstacle[r * COLS + c] !== 0; }
  /** An obstacle-like (cost-1000) crate on the tile. */
  isCrate(r, c) { return this.inBounds(r, c) && (this.obstacle[r * COLS + c] & OB_CRATE) !== 0; }
  /** A hard block (platform / mound / content) on the tile. */
  isBlocked(r, c) { return this.inBounds(r, c) && (this.obstacle[r * COLS + c] & OB_BLOCK) !== 0; }

  /** List tiles of a given special kind ('start'|'end'|'telin'|'telout') inside the rect. */
  specialTiles(kind) {
    const out = [];
    const R = this.rect;
    for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) if (this.tile(r, c).special === kind) out.push([r, c]);
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // official flow field (research 08 §3.4)

  /**
   * Flow field toward (er, ec). `allowDiagonal` false ⇒ line of sight only along a row or a column (every autochess
   * route allows diagonals). `ignoreObstacles` ⇒ blocks and crates are ignored (fallback when the goal is walled off).
   * @returns {FlowField}
   */
  flowField(er, ec, { allowDiagonal = true, ignoreObstacles = false } = {}) {
    er |= 0; ec |= 0;
    const ck = `${er},${ec},${allowDiagonal ? 1 : 0},${ignoreObstacles ? 1 : 0}`;
    const hit = this._fields.get(ck);
    if (hit) return hit;
    const f = this._buildField(er, ec, allowDiagonal, ignoreObstacles);
    if (this._fields.size >= FIELD_CACHE_MAX) this._fields.delete(this._fields.keys().next().value);
    this._fields.set(ck, f);
    return f;
  }

  _buildField(er, ec, allowDiagonal, ignore) {
    const N = ROWS * COLS;
    const f = { dest: -1, dist: null, parent: null, pen: null, next: null, official: null, cost: null, deep: null, len: null, version: this.version, allowDiagonal, ignore };
    if (!this.inBounds(er, ec)) {
      const none = new Int32Array(N).fill(-1);
      return Object.assign(f, { dist: none, parent: none, next: none, official: none, pen: new Int32Array(N), cost: new Int32Array(N), deep: new Int32Array(N) });
    }
    const dest = er * COLS + ec;
    f.dest = dest;
    const unb = this.unblockable;
    const official = this._spfa(dest, ignore, null);
    const pref = this._spfa(dest, ignore, unb);
    const dist = pref.dist; // the lexicographic relaxation leaves every distance the official one
    const walk = (r, c) => this.walkable(r, c, ignore) && (ignore || !(this.obstacle[r * COLS + c] & OB_CRATE));
    const ray = allowDiagonal ? bresenhamClear : segmentClear;
    const nextO = smoothChains(official.parent, dist, (a, b) => ray(a, b, walk), null);
    // preference smoothing (0.1.0's, playtest #2): the line of sight from n toward ancestor `to` may also cover a
    // non-blockable tile — the Bresenham footprint, corner tiles of a diagonal step included — only when that tile is on
    // n's own raw chain between n and `to`; the jump stops at the first ancestor not visible under that rule
    const onChain = new Int32Array(N).fill(-1);
    let from = -1, to = -1;
    const walkP = (r, c) => {
      if (!walk(r, c)) return false;
      const k = r * COLS + c;
      return !unb[k] || (onChain[k] === from && dist[k] >= dist[to]);
    };
    const nextP = smoothChains(pref.parent, dist, (a, b) => { from = a; to = b; return ray(a, b, walkP); },
      (n) => { for (let x = n, g = N; x >= 0 && g-- > 0; x = pref.parent[x]) onChain[x] = n; });
    // per tile, in increasing distance: the official pointer unless the preference one crosses strictly fewer
    // non-blockable tiles on the way to the destination — or as few while only skipping the official waypoint o, which
    // then lies on the straight line to it and leads there (the same walk, one waypoint fewer) — and no more 深水区
    // than the official one (GitHub #375)
    const order = [];
    for (let k = 0; k < N; k++) if (dist[k] >= 0) order.push(k);
    order.sort((a, b) => dist[a] - dist[b] || a - b);
    const through = (a, b) => { let n = -unb[a]; crossTiles(a, b, (r, c) => { n += unb[r * COLS + c]; }); return n; };
    const deepW = this.deepWater;
    const wet = (a, b) => { let n = -deepW[a]; crossTiles(a, b, (r, c) => { n += deepW[r * COLS + c]; }); return n; };
    const next = new Int32Array(N).fill(-1);
    const cost = new Int32Array(N);
    const deep = new Int32Array(N);
    for (const k of order) {
      const o = nextO[k], p = nextP[k];
      if (o < 0) continue; // the destination
      let use = o, best = through(k, o) + cost[o], bestWet = wet(k, o) + deep[o];
      if (p >= 0 && p !== o) {
        const cp = through(k, p) + cost[p], wp = wet(k, p) + deep[p];
        if (wp <= bestWet && (cp < best || (cp === best && next[o] === p && onSegment(k, o, p)))) { use = p; best = cp; bestWet = wp; }
      }
      next[k] = use;
      cost[k] = best;
      deep[k] = bestWet;
    }
    return Object.assign(f, { dist, parent: pref.parent, pen: pref.pen, next, official: nextO, cost, deep });
  }

  /**
   * FIFO SPFA from `dest` (walkable or not) with the official neighbour order and move costs. With `penalty` (per-tile
   * 0/1) the relaxation is lexicographic on (dist, pen): equal-length chains keep the fewest penalised tiles.
   */
  _spfa(dest, ignore, penalty) {
    const N = ROWS * COLS;
    const dist = new Int32Array(N).fill(-1);
    const parent = new Int32Array(N).fill(-1);
    /** penalised tiles on the raw chain (tile included, destination excluded) */
    const pen = new Int32Array(N);
    const inQ = new Uint8Array(N);
    const q = new Int32Array(N * 4 + 8);
    let qh = 0, qt = 0;
    const push = (k) => {
      if (qt >= q.length) { q.copyWithin(0, qh, qt); qt -= qh; qh = 0; }
      q[qt++] = k;
    };
    dist[dest] = 0;
    push(dest);
    inQ[dest] = 1;
    while (qh < qt) { // loop-cap: BFS queue
      const cur = q[qh++];
      inQ[cur] = 0;
      const r = (cur / COLS) | 0, c = cur - r * COLS;
      for (let i = 0; i < 4; i++) {
        const nr = r + FOUR_WAYS[i][0], nc = c + FOUR_WAYS[i][1];
        if (!this.walkable(nr, nc, ignore)) continue;
        const nb = nr * COLS + nc;
        const nd = dist[cur] + (!ignore && (this.obstacle[nb] & OB_CRATE) ? OBSTACLE_COST : 1);
        const np = penalty ? pen[cur] + penalty[nb] : 0;
        if (dist[nb] < 0 || nd < dist[nb] || (nd === dist[nb] && np < pen[nb])) {
          dist[nb] = nd;
          pen[nb] = np;
          parent[nb] = cur;
          if (!inQ[nb]) { push(nb); inQ[nb] = 1; }
        }
      }
    }
    return { dist, parent, pen };
  }

  /** Geometric length (tiles) of the smoothed route from tile key k to the field's destination (memoised). */
  fieldLength(f, k) {
    if (!f || k < 0 || f.dist[k] < 0) return Infinity;
    if (!f.len) f.len = new Float64Array(ROWS * COLS).fill(-1);
    const stack = [];
    let x = k;
    while (x >= 0 && f.len[x] < 0) { // loop-cap: flow parent chain
      if (x === f.dest || f.next[x] < 0) { f.len[x] = 0; break; }
      stack.push(x);
      x = f.next[x];
      if (stack.length > ROWS * COLS) return Infinity; // cannot happen (dist strictly decreases); defensive
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      const a = stack[i], b = f.next[a];
      const ar = (a / COLS) | 0, ac = a - ar * COLS, br = (b / COLS) | 0, bc = b - br * COLS;
      f.len[a] = f.len[b] + hypot(br - ar, bc - ac);
    }
    return f.len[k];
  }

  /**
   * Smoothed waypoints [[r,c]…] from (sr,sc) to (er,ec) along the flow field (start and goal included), or null when
   * the start cannot reach the goal. With `ignoreObstacles` the field ignores blocks and crates.
   */
  waypoints(sr, sc, er, ec, { ignoreObstacles = false, allowDiagonal = true } = {}) {
    if (!this.inBounds(sr, sc) || !this.inBounds(er, ec)) return null;
    const start = sr * COLS + sc;
    const goal = er * COLS + ec;
    if (start === goal) return [[sr, sc]];
    const f = this.flowField(er, ec, { ignoreObstacles, allowDiagonal });
    if (f.dist[start] < 0) return null;
    const out = [[sr, sc]];
    let k = start, guard = ROWS * COLS;
    while (k !== goal && guard-- > 0) { // loop-cap: path guard
      k = f.next[k];
      if (k < 0) return null;
      out.push([(k / COLS) | 0, k % COLS]);
    }
    return out;
  }

  /**
   * Tiles crossed by the enemy route from (sr,sc) to (er,ec): the smoothed waypoints joined by their Bresenham lines
   * (start and goal included; consecutive tiles are 8-neighbours). null when unreachable (unless ignoreObstacles).
   */
  findPath(sr, sc, er, ec, { ignoreObstacles = false } = {}) {
    const wp = this.waypoints(sr, sc, er, ec, { ignoreObstacles });
    if (!wp) return null;
    const out = [wp[0]];
    for (let i = 1; i < wp.length; i++) {
      const seg = bresenhamTiles(wp[i - 1], wp[i]);
      for (let j = 1; j < seg.length; j++) out.push(seg[j]);
    }
    return out;
  }

  /** Length (tiles) of a polyline of [r,c] points. */
  static pathLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return len;
  }
}

/**
 * @typedef {object} FlowField
 * @property {number} dest destination tile key (-1 outside the grid)
 * @property {Int32Array} dist SPFA distance to the destination (-1 = unreachable; the official one)
 * @property {Int32Array} parent raw SPFA parent of the preference chain (fewest non-blockable tiles among equal `dist`)
 * @property {Int32Array} pen non-blockable tiles on that raw chain (tile included, destination excluded)
 * @property {Int32Array} official smoothed parent of the pure official algorithm
 * @property {Int32Array} next the tile to walk straight toward (official, or the preference pointer when it crosses fewer
 *   non-blockable tiles and no more 深水区 — see the module header)
 * @property {Int32Array} cost non-blockable tiles the route of `next` crosses from the tile (excluded) to the destination
 * @property {Int32Array} deep 深水区 tiles the route of `next` crosses from the tile (excluded) to the destination
 * @property {Float64Array|null} len memoised smoothed length (fieldLength)
 */

/**
 * Row-major, in-place smoothing (client `_PostprocessAndMakeNextMapSmoothly`): each tile's pointer jumps along its chain
 * (already smoothed pointers for tiles processed earlier) while `los(tile, ancestor)` holds; `begin(tile)`, when given,
 * runs before the tile's jump. Returns the smoothed pointers.
 */
function smoothChains(parent, dist, los, begin) {
  const N = parent.length;
  const next = new Int32Array(parent);
  for (let n = 0; n < N; n++) {
    if (dist[n] < 0 || next[n] < 0) continue;
    if (begin) begin(n);
    let b = next[n];
    while (next[b] >= 0 && los(n, next[b])) b = next[b]; // loop-cap: line-of-sight chain on the grid
    next[n] = b;
  }
  return next;
}

/** Whether tile key b lies strictly inside the straight segment between tile keys a and c. */
function onSegment(a, b, c) {
  const ar = (a / COLS) | 0, ac = a - ar * COLS, br = (b / COLS) | 0, bc = b - br * COLS, cr = (c / COLS) | 0, cc = c - cr * COLS;
  return (br - ar) * (cc - ac) === (bc - ac) * (cr - ar) && (br - ar) * (cr - br) + (bc - ac) * (cc - bc) > 0;
}

/** Bresenham line of sight between tile keys a → b (client `_RaycastBresenhamLine`). */
function bresenhamClear(a, b, clear) {
  let r = (a / COLS) | 0, c = a - r * COLS;
  const r1 = (b / COLS) | 0, c1 = b - r1 * COLS;
  const dr = Math.abs(r1 - r), dc = Math.abs(c1 - c);
  const sr = r1 > r ? 1 : -1, sc = c1 > c ? 1 : -1;
  let err = dc - dr;
  if (!clear(r, c)) return false;
  while (r !== r1 || c !== c1) { // loop-cap: one cell per step on a grid segment
    const e2 = 2 * err;
    let nr = r, nc = c;
    if (e2 > -dr) { err -= dr; nc += sc; }
    if (e2 < dc) { err += dc; nr += sr; }
    if (nr !== r && nc !== c && !(clear(nr, c) && clear(r, nc))) return false;
    r = nr; c = nc;
    if (!clear(r, c)) return false;
  }
  return true;
}

/** Row / column line of sight (client `_RaycastSegmentLine`, routes without diagonal moves). */
function segmentClear(a, b, clear) {
  let r = (a / COLS) | 0, c = a - r * COLS;
  const r1 = (b / COLS) | 0, c1 = b - r1 * COLS;
  if (r !== r1 && c !== c1) return false;
  const sr = Math.sign(r1 - r), sc = Math.sign(c1 - c);
  if (!clear(r, c)) return false;
  while (r !== r1 || c !== c1) { // loop-cap: one cell per step on a grid segment
    r += sr; c += sc;
    if (!clear(r, c)) return false;
  }
  return true;
}

/** Tiles of the Bresenham line [r0,c0] → [r1,c1] (same stepping as bresenhamClear). */
export function bresenhamTiles(a, b) {
  let [r, c] = a;
  const [r1, c1] = b;
  const dr = Math.abs(r1 - r), dc = Math.abs(c1 - c);
  const sr = r1 > r ? 1 : -1, sc = c1 > c ? 1 : -1;
  let err = dc - dr;
  const out = [[r, c]];
  let guard = 256;
  while ((r !== r1 || c !== c1) && guard-- > 0) { // loop-cap: cell walk guard
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c += sc; }
    if (e2 < dc) { err += dc; r += sr; }
    out.push([r, c]);
  }
  return out;
}

/**
 * Exact traversal of the straight segment between the centres of tile keys a → b: calls `fn(r, c)` for every tile whose
 * interior the segment crosses, a and b included, in order — a tile it only touches at a corner point (the segment
 * passes exactly through a lattice corner) is skipped. Stops early and returns false when `fn` returns false.
 * Integer arithmetic: the k-th column boundary is crossed at t = (2k − 1) / 2dx, the m-th row boundary at
 * (2m − 1) / 2dy.
 */
function crossTiles(a, b, fn) {
  let r = (a / COLS) | 0, c = a - r * COLS;
  const r1 = (b / COLS) | 0, c1 = b - r1 * COLS;
  const dy = Math.abs(r1 - r), dx = Math.abs(c1 - c);
  const sr = r1 > r ? 1 : -1, sc = c1 > c ? 1 : -1;
  if (fn(r, c) === false) return false;
  for (let kx = 1, ky = 1; r !== r1 || c !== c1;) {
    const tx = kx <= dx ? (2 * kx - 1) * dy : Infinity;
    const ty = ky <= dy ? (2 * ky - 1) * dx : Infinity;
    if (tx === ty) { c += sc; r += sr; kx++; ky++; } else if (tx < ty) { c += sc; kx++; } else { r += sr; ky++; }
    if (fn(r, c) === false) return false;
  }
  return true;
}

/** Tiles [[r,c]…] whose interior the segment between the centres of tiles a = [r,c] and b crosses (crossTiles). */
export function segmentTiles(a, b) {
  const out = [];
  crossTiles(a[0] * COLS + a[1], b[0] * COLS + b[1], (r, c) => { out.push([r, c]); });
  return out;
}

/**
 * Whether a straight move from (x, y) to the centre of tile p = {x: col, y: row} only crosses ground-walkable,
 * crate-free tiles (the start and end tiles excepted). Exact grid traversal (tile (r,c) spans c ± 0.5, r ± 0.5); a
 * line through a tile corner needs both side tiles clear (as the grid's Bresenham smoothing).
 */
export function straightClear(g, x, y, p) {
  let c = Math.round(x), r = Math.round(y);
  const dx = p.x - x, dy = p.y - y;
  const sc = dx > 0 ? 1 : -1, sr = dy > 0 ? 1 : -1;
  const ddx = dx !== 0 ? Math.abs(1 / dx) : Infinity, ddy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tx = dx !== 0 ? (c + 0.5 * sc - x) / dx : Infinity;
  let ty = dy !== 0 ? (r + 0.5 * sr - y) / dy : Infinity;
  const clear = (rr, cc) => (rr === p.y && cc === p.x) || (g.walkable(rr, cc) && !(g.obstacle[rr * COLS + cc] & OB_CRATE));
  for (let guard = 4 * COLS; guard > 0 && (r !== p.y || c !== p.x); guard--) {
    if (tx >= 1 && ty >= 1) break;
    if (Math.abs(tx - ty) < 1e-9) {
      if (!clear(r, c + sc) || !clear(r + sr, c)) return false;
      c += sc; r += sr; tx += ddx; ty += ddy;
    } else if (tx < ty) { c += sc; tx += ddx; } else { r += sr; ty += ddy; }
    if (!clear(r, c)) return false;
  }
  return true;
}
