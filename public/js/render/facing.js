// Operator model facing (DESIGN §37.329; ported from PR #730 by @Seals-awa to the rules the maintainer fixed on 2026-10-21
// and 2026-10-23): an operator's MODEL turns toward the target of an attack when that attack starts, and keeps that
// facing until the next attack starts. There is no turn back at the end of the action, when the target dies or leaves,
// or after a delay: the official recordings the maintainer measured on 10-21 show the model turning back exactly on the
// frame the next attack starts, and 凯尔希 staying turned for ~1.7 game s after killing the enemy behind her with
// nothing left in range. [ASSUMED] a long idle (no target for longer than the recordings show) keeps the facing too.
//
// Display only. `dir`, the deploy direction, still rotates the attack range, decides blocking and every directional
// effect, and nothing here reaches the sim: the renderer already has every attack (`['atk', attacker, target, kind]`)
// and every unit's position.
//
// What drives a turn (render/units.js UnitView._faceTurn):
//   * the start of an attack: the look-ahead's wind-up once it was accepted (render/app/windup.js → UnitView.windUp), or
//     the strike of an attack no wind-up started (UnitView.onAttack: a late batch, a lead too short for the clip);
//   * the target of THAT attack, read from its 'atk' event;
//   * no turn for an area attack (more than one distinct target in the attack's batch, `markAreaAttacks`) — the PR's rule
//     the maintainer asked for on the review of 2026-10-18 ("群攻的首个目标也仍可能触发转身") [ASSUMED: no recording of a
//     multi-target attack];
//   * no turn while stunned / frozen / asleep (the model cannot start an attack then);
//   * the official per-ability face mode of the clip that plays (render/faceModes.js, `faceModeFor`).
//
// The turn itself is the official FaceSwitcher: mirror (left / right) and, for a target above or below, the Front ⇄ Back
// skeleton, over `_switchTime` = 0.15 game s (`FACING_TURN_S`).

import { CHAIN_KINDS } from './app/tune.js';

/**
 * FaceSwitcher._switchTime, in game seconds: 0.15 on every operator. Read from the local official client
 * (`chararts/char_*.ab`, the MonoBehaviour of the `FaceSwitcher` GameObject: float 0.15, int 3 = `_defaultLOrR`; 471 of
 * 471 bundles, tools/local-extract/face_switcher.py, 2026-11-21); the maintainer measured ~0.13 game s in the official
 * recordings (PR #730, 2026-10-21).
 */
export const FACING_TURN_S = 0.15;

// --- the official four-direction resolution -----------------------------------------------------------------------------
// From @Seals-awa's disassembly of the shipped client (docs/research/10-face-logic.md; the metadata tools it names are not
// in this repository). Two axes with a hysteresis band, not a one-shot threshold:
//   MapUtil.ParseDirection(v, addon)    argmax over the four directions of dot(v, dir) + (k & 1 ? addon : 0): only the
//                                       horizontal entries (k = 1, 3) carry the bias.
//   _CalculateLOrRDirection(v, prev)    ParseDirection(v, 0); a horizontal result is adopted; otherwise v.x < -0.2 → left,
//                                       v.x > +0.2 → right, else the previous sign (the dead zone).
//   _SetFourDirection(sign, uOrD)       the mirror, and the Front / Back configuration.
// The dead zone compares the x of `v` as the method gets it (research 10 §3: `movq xmm6, rdx`, then MathUtil.LT(v.x,
// -0.2); ParseDirection normalizes only its own copy). [ASSUMED] the caller hands it the raw offset to the target in
// tiles, not a unit vector: its body (DoUpdateFaceSign, research 10 §5 / §8) was not read, but the TOO_CLOSE check
// (|v|² < 0.0625) and DIRECTION_ZERO_TOLERANCE only mean anything on the raw offset. So the band is |dx| <= 0.2 tile.
/** TOLERANCE_L_OR_R_DIRECTION: the dead zone on the target's x offset in tiles (|dx| <= 0.2 keeps the previous sign). */
export const FACING_TOLERANCE = 0.2;
/** ADDON_TO_L_OR_R_DIRECTION: the bias the horizontal directions get in ParseDirection. */
export const FACING_ADDON = 0.25;
/** TOO_CLOSE_TOLERANCE_SQR = 0.0625 = 0.25²: closer than this no direction is judged at all. */
export const FACING_TOO_CLOSE = 0.25;
/** DIRECTION_ZERO_TOLERANCE: an offset shorter than this on both axes is no direction. */
export const FACING_ZERO = 0.01;
/** ParseDirection's own |v| threshold (an inlined 1e-05). */
export const FACING_PARSE_EPS = 1e-5;
/** The official sign encoding: 1 = right, 3 = left (FaceSwitcher._defaultLOrR is 3). */
export const FACE_SIGN_RIGHT = 1;
export const FACE_SIGN_LEFT = 3;

// ParseDirection's table, in index order 0 up, 1 right, 2 down, 3 left. [ASSUMED] the order: the disassembly gives the
// table's address, not its contents. The board's row 0 is the bottom (server/sim/dir.js: UP = +row), so up is +y here.
const FACE_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const FACE_DIR_NAMES = /** @type {const} */ (['UP', 'RIGHT', 'DOWN', 'LEFT']);

/**
 * MapUtil.ParseDirection: the four-direction argmax with the horizontal bias. Ties keep the earlier index (strict `>`).
 * @param {number} dx
 * @param {number} dy
 * @param {number} [addon] 0 for the sign decision, FACING_ADDON for the axis decision
 * @returns {number} 0..3 (up / right / down / left)
 */
export function parseDirection(dx, dy, addon = 0) {
  let x = Number(dx) || 0, y = Number(dy) || 0;
  let m = Math.hypot(x, y);
  if (m < FACING_PARSE_EPS) { x = FACE_DIRS[0][0]; y = FACE_DIRS[0][1]; m = 1; }   // the default direction
  x /= m; y /= m;
  let best = 0;
  let bestDot = x * FACE_DIRS[0][0] + y * FACE_DIRS[0][1];
  for (let k = 1; k < 4; k++) {
    const d = x * FACE_DIRS[k][0] + y * FACE_DIRS[k][1] + ((k & 1) ? Number(addon) || 0 : 0);
    if (d > bestDot) { bestDot = d; best = k; }
  }
  return best;
}

/**
 * The official direction for one target offset (tiles, +y = up the board): the axis from ParseDirection(v, ADDON), the
 * mirror sign from _CalculateLOrRDirection with its dead zone (on the raw dx [ASSUMED]: FACING_TOLERANCE).
 * @param {number} dx
 * @param {number} dy
 * @param {number} [prevSign] the sign the model has (1 right / 3 left); the dead zone keeps it
 * @returns {{ dir: 'UP'|'RIGHT'|'DOWN'|'LEFT'|null, sign: number }} dir null = too close / no offset: keep everything
 */
export function facingDir(dx, dy, prevSign = FACE_SIGN_LEFT) {
  const x = Number(dx) || 0, y = Number(dy) || 0;
  const prev = prevSign === FACE_SIGN_RIGHT ? FACE_SIGN_RIGHT : FACE_SIGN_LEFT;
  if (x * x + y * y < FACING_TOO_CLOSE * FACING_TOO_CLOSE) return { dir: null, sign: prev };
  if (Math.abs(x) < FACING_ZERO && Math.abs(y) < FACING_ZERO) return { dir: null, sign: prev };
  const m = Math.hypot(x, y);
  const nx = x / m, ny = y / m;
  const axis = parseDirection(nx, ny, FACING_ADDON);
  const parsed = parseDirection(nx, ny, 0);
  let sign;
  if (parsed === FACE_SIGN_RIGHT || parsed === FACE_SIGN_LEFT) sign = parsed;
  // the raw x, not nx: the method compares the v.x it was given [ASSUMED: a raw offset, see above]
  else if (x < -FACING_TOLERANCE) sign = FACE_SIGN_LEFT;
  else if (x > FACING_TOLERANCE) sign = FACE_SIGN_RIGHT;
  else sign = prev;
  return { dir: FACE_DIR_NAMES[axis], sign };
}

const smooth = (k) => k * k * (3 - 2 * k);
const isDir = (d) => d === 'UP' || d === 'RIGHT' || d === 'DOWN' || d === 'LEFT';

/**
 * The facing state of one operator's model: which way it is mirrored, which skeleton it shows, and the 0.15 s turn
 * between two of them. Pure (no PIXI, no assets): render/units.js asks it at every attack start (`turn` / `toDeploy`),
 * advances it every frame (`step`) and draws with `drawSign` / `drawScale`. Nothing turns it back on its own.
 *
 * The skeleton: a target ABOVE (UP) asks for the Back model, one BELOW (DOWN) for the Front model, a horizontal one keeps
 * the skeleton on screen — the official client only mirrors there (@Seals-awa's comparison with the official game, PR
 * #730 reply of 2026-10-19 [ASSUMED: not re-measured]). The skeleton change is owed at the middle of the turn, where the
 * model is edge-on.
 */
export class FacingState {
  /** @param {string|null|undefined} dir the deploy direction */
  constructor(dir) {
    /** @type {'UP'|'RIGHT'|'DOWN'|'LEFT'} */
    this.deployDir = 'RIGHT';
    /** @type {'UP'|'RIGHT'|'DOWN'|'LEFT'|null} the direction of the last turn; null = the deployed facing */
    this.view = null;
    this.restSign = FACE_SIGN_RIGHT;
    this.sign = FACE_SIGN_RIGHT;
    this.back = false;
    this.shownBack = false;
    this._from = 1; this._to = 1; this._k = 1; this._squash = false; this._swapOwed = false;
    this.reset(dir);
  }

  /** Settle on the deployment at once (a placement, a re-orientation, a redeploy): no turn animation. */
  reset(dir) {
    this.deployDir = isDir(dir) ? /** @type {'UP'|'RIGHT'|'DOWN'|'LEFT'} */ (dir) : 'RIGHT';
    this.restSign = this.deployDir === 'LEFT' ? FACE_SIGN_LEFT : FACE_SIGN_RIGHT;
    this.view = null;
    this.sign = this.restSign;
    this.back = this.deployDir === 'UP';        // the skeleton the facing asks for
    this.shownBack = this.back;                 // the skeleton the model is asked to show now (changes mid-turn)
    this._to = this.sign === FACE_SIGN_LEFT ? -1 : 1;
    this._from = this._to;
    this._k = 1;
    this._squash = false;
    this._swapOwed = false;
  }

  /** A turn is running. */
  get turning() { return this._k < 1; }

  /**
   * Turn toward a target offset (tiles, +y = up). `front`: the ability's `Front` mode — mirror only, the skeleton stays
   * [ASSUMED reading of the flag]; `canBack`: the model has a Back skeleton at all (without one nothing is owed).
   * @param {number} dx
   * @param {number} dy
   * @param {{ front?: boolean, canBack?: boolean }} [opts]
   * @returns {boolean} whether the drawn model changes (a turn started)
   */
  turn(dx, dy, opts = {}) {
    const f = facingDir(dx, dy, this.sign);
    if (!f.dir) return false;
    let back = f.dir === 'UP' ? true : f.dir === 'DOWN' ? false : this.back;
    if (opts.front || opts.canBack === false) back = this.back;
    return this._go(f.dir, f.sign, back);
  }

  /** The ability's `Default` mode: the deployed facing (sign and skeleton). @returns {boolean} whether a turn started */
  toDeploy() {
    return this._go(null, this.restSign, this.deployDir === 'UP');
  }

  _go(view, sign, back) {
    this.view = view;
    // the drawn model is the pair (mirror, skeleton): two targets both UP but on either side of the dead zone differ
    // by the mirror alone and still turn (the maintainer's review of 2026-10-21); the same pair is no turn
    if (sign === this.sign && back === this.back) return false;
    const from = this.drawValue();
    this.sign = sign;
    this.back = back;
    this._from = from;
    this._to = sign === FACE_SIGN_LEFT ? -1 : 1;
    this._swapOwed = back !== this.shownBack;
    // a skeleton change without a mirror change still passes edge-on, where the swap hides
    this._squash = this._swapOwed && (from >= 0) === (this._to > 0);
    this._k = 0;
    return true;
  }

  /**
   * Advance the turn by `gdt` game seconds.
   * @param {number} gdt
   * @returns {boolean} true once, when the skeleton change is due (the middle of the turn)
   */
  step(gdt) {
    if (this._k >= 1) return false;
    this._k = Math.min(1, this._k + (gdt > 0 ? gdt / FACING_TURN_S : 0));
    if (this._swapOwed && this._k >= 0.5) {
      this._swapOwed = false;
      this.shownBack = this.back;
      return true;
    }
    return false;
  }

  /** The signed horizontal scale the model is drawn with now: −1 … 1, passing 0 (edge-on) mid-turn. */
  drawValue() {
    if (this._k >= 1) return this._to;
    const e = smooth(this._k);
    if (this._squash) return this._to * (e < 0.5 ? Math.min(1, Math.abs(this._from)) * (1 - 2 * e) : 2 * e - 1);
    return this._from + (this._to - this._from) * e;
  }

  /** The mirror the model is drawn with now: −1 (left) or 1. It flips where the turn is edge-on. */
  drawSign() {
    const v = this.drawValue();
    if (v > 0) return 1;
    if (v < 0) return -1;
    return this._k >= 0.5 ? this._to : (this._from < 0 ? -1 : this._from > 0 ? 1 : this._to);
  }

  /** The mirror the turn ends on (the current one when no turn runs): −1 (left) or 1. */
  endSign() { return this.sign === FACE_SIGN_LEFT ? -1 : 1; }

  /** The horizontal squeeze of the turn now, 0 … 1 (1 when no turn runs). */
  drawScale() { return Math.abs(this.drawValue()); }
}

// --- area attacks -------------------------------------------------------------------------------------------------------

/**
 * Mark the area attacks of one b.ev batch (render/app.js pushEvents): every 'atk' of a source that attacked more than one
 * DISTINCT target in the batch goes into `out`, so neither the look-ahead nor a late strike turns the model for it. The
 * server sends one 'atk' per target and drains a field's events every 3 ticks under one `gt` stamp (server/match/fields.js),
 * so a batch is the PR's "one source at one event time"; two hits on the same target stay a single-target attack. Chain
 * bounces (`CHAIN_KINDS`: the "source" is the previous target) are left out.
 * @param {any[]} list
 * @param {WeakSet<any[]>} out
 * @returns {number} how many events were marked
 */
export function markAreaAttacks(list, out) {
  if (!Array.isArray(list)) return 0;
  /** @type {Map<any, { targets: Set<any>, evs: any[][] }>|null} */
  let bySrc = null;
  for (const e of list) {
    if (!Array.isArray(e) || e[0] !== 'atk' || e[1] == null || e[2] == null || CHAIN_KINDS.has(e[3])) continue;
    if (!bySrc) bySrc = new Map();
    let s = bySrc.get(e[1]);
    if (!s) bySrc.set(e[1], (s = { targets: new Set(), evs: [] }));
    s.targets.add(e[2]);
    s.evs.push(e);
  }
  if (!bySrc) return 0;
  let n = 0;
  for (const s of bySrc.values()) {
    if (s.targets.size < 2) continue;
    for (const e of s.evs) { out.add(e); n++; }
  }
  return n;
}

// --- the per-ability face modes (render/faceModes.js) -------------------------------------------------------------------
// The official client stores, per ability animation, how the model is driven while that animation plays. The flags this
// renderer reads:
//   Target            turn toward the attack's target (also the default for an operator or clip without a row)
//   none              do not turn: the clip plays in the facing the model has
//   Default           the deployed facing [ASSUMED: applied when the attack starts, like every other turn]
//   Front             turn by the mirror only, never change the skeleton [ASSUMED reading]
//   FirstCastTarget   while a skill runs, keep facing the target of its first attack [ASSUMED reading]
// ForceToDirection / CheckDownAttack (a direction-specific clip, the row's `up` / `down`) are not played: their facing
// part is what the other flags say (Default+ForceToDirection = Default).

/**
 * The flags of a table `mode` string ('Default+ForceToDirection' → { def: true, forceDir: true, … }).
 * @param {string|null|undefined} mode
 */
export function faceModeFlags(mode) {
  const m = String(mode || 'Target');
  const parts = m.split('+');
  const has = (k) => parts.includes(k);
  return {
    target: has('Target'),
    none: has('none'),
    def: has('Default'),
    front: has('Front'),
    forceDir: has('ForceToDirection'),
    firstCast: has('FirstCastTarget'),
    checkDown: has('CheckDownAttack'),
  };
}

/**
 * What a face mode does at an attack start: 'none' (keep the facing), 'deploy' (the deployed facing) or 'target'.
 * `Target` wins over `Default` when a row names both (one row in the table, char_4083_chimes's) [ASSUMED].
 * @param {ReturnType<typeof faceModeFlags>} flags
 * @returns {'none'|'deploy'|'target'}
 */
export function faceAction(flags) {
  if (flags.none && !flags.target) return 'none';
  if (flags.def && !flags.target) return 'deploy';
  return 'target';
}

/**
 * The row a conflict draws as (`faceModeFor`): `Target`, the mode of every operator and clip without a row. Frozen.
 */
export const FACE_CONFLICT_ROW = Object.freeze(['', 'Target', '', '', 0, 'unspecified']);

/**
 * The table row that drives the clip set running now, from candidate animation names in priority order: the first exact
 * name match wins (several abilities may name the same animation: the row of the running `wantKind` — 'skill' or
 * 'attack' — is taken, and among those a `FirstCastTarget` row drives the skill's first attack, a plain row the later
 * ones, `opts.firstCast`), then the longest row name that is a prefix of a candidate (`Skill_2` covers `Skill_2_Loop`),
 * then the ability's default rows (`animKey` '').
 *
 * Rows left after that which still disagree on what the model does (`faceAction`: none / deploy / target) resolve to
 * `Target` [ASSUMED]: nothing in the table says which ability's row is the clip's — they share the name and the kind, or
 * are default rows with no name (kind 'unspecified') — and the table's order is the extraction's, not a priority.
 * `Target` is what an operator or clip without a row does, and the turn the maintainer saw in the official game
 * (2026-10-18). 13 operators have such rows (test/render/face-modes.test.js lists them; DESIGN §37.329); the review of
 * 2026-10-19 asked that same-name rows not be settled by their order.
 * @param {any[][]|null|undefined} rows the operator's rows (FACE_MODES[charId])
 * @param {string[]} candidates
 * @param {string} [wantKind]
 * @param {{ firstCast?: boolean }} [opts]
 * @returns {any[]|null}
 */
export function faceModeFor(rows, candidates, wantKind = '', opts = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const actionOf = (r) => faceAction(faceModeFlags(r[1]));
  const pick = (list) => {
    if (!list.length) return null;
    let pool = list;
    if (wantKind) {
      const byKind = pool.filter((r) => String(r[5] || '') === wantKind);
      if (byKind.length) pool = byKind;
    }
    if (pool.length > 1) {
      const isFirst = (r) => /FirstCastTarget/.test(String(r[1] || ''));
      const first = pool.filter(isFirst);
      const later = pool.filter((r) => !isFirst(r));
      if (opts.firstCast === true && first.length) pool = first;
      else if (opts.firstCast === false && later.length) pool = later;
      else pool = first.length ? first : later;
    }
    const act = actionOf(pool[0]);
    if (pool.every((r) => actionOf(r) === act)) return pool[0];
    // the rows disagree: Target [ASSUMED] — the first of them that says so, else the default row
    return pool.find((r) => actionOf(r) === 'target') || FACE_CONFLICT_ROW;
  };
  for (const cand of candidates) {
    const name = String(cand || '').toLowerCase();
    if (!name) continue;
    const hit = pick(rows.filter((row) => Array.isArray(row) && String(row[0]).toLowerCase() === name));
    if (hit) return hit;
  }
  const list = candidates.map((c) => String(c || '')).filter(Boolean);
  /** @type {any[][]} */
  let best = [];
  for (const row of rows) {
    if (!Array.isArray(row) || !row[0]) continue;
    for (const cand of list) {
      if (cand === row[0] || cand.startsWith(row[0] + '_')) {
        if (!best.length || row[0].length > best[0][0].length) best = [row];
        else if (row[0].length === best[0][0].length && !best.includes(row)) best.push(row);
      }
    }
  }
  return pick(best) || pick(rows.filter((row) => Array.isArray(row) && !row[0]));
}
