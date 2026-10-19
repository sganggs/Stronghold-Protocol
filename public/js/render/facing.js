// Operator model facing (owner request, upstream #730): an operator's MODEL turns toward the target it is attacking and
// goes back to its deployed direction once the attack animation is over and no further attack follows.
//
// Display only. `dir` is the deploy direction: it rotates the attack range, decides which model is drawn (Front / Back,
// research 07 §5.5) and drives every directional effect — none of that moves here. The renderer already receives every
// attack (`['atk', attacker, target, kind]`) and every unit's position, so the model can be turned from what the snapshot
// says, without asking the sim for it.
//
// This module is the plan the renderer follows (render/app.js windUpAttacks → UnitView.faceTarget):
//   * **one attack = one group.** A group is the attacks of ONE source stamped at ONE event time (one sim tick), not
//     "everything inside the look-ahead window": a fast single-target attacker fires several attacks inside the window, and
//     counting those as one area attack was the reported bug. An area attack's hits share the tick, so they land in one
//     group.
//   * **an attack with more than one DISTINCT target is 群攻 (area) → no turn at all**, not even for its first target: an
//     area attacker's targets differ every swing, so a turn would flicker. Two hits on the SAME target (a 连击 in one tick)
//     are still a single-target attack.
//   * the turn happens when the attack ANIMATION starts (render/app.js turns right after the wind-up was accepted), never
//     before it was accepted.
//   * no turn while the operator is stunned / frozen / asleep (`UnitView.statuses`), and none for an enemy: the stun clip
//     plays in the facing the model already had.
//   * the model goes back to the deployed direction when the attack animation is over and no next attack is coming.
//
// The turnaround itself is the official one: skeleton + mirror + animation, 0.15 s (render/units.js `_startTurn`).
export const FACING_TURN_S = 0.15;      // 换骨架 + 镜像 + 换动画 takes this long, in GAME seconds (the model's own clock)

/** Direction names as the sim / renderer spell them (UP is +row: the board's "up" is a bigger row). */
const UP = 'UP', DOWN = 'DOWN', LEFT = 'LEFT', RIGHT = 'RIGHT';

// --- the official four-direction resolution (docs/research/10-face-logic.md: disassembled from the shipped client) -----
// The official rule is NOT a one-shot threshold test. It is two axes with a HYSTERESIS band:
//
//   MapUtil.ParseDirection(v, addon)   argmax over the four directions of dot(v, dir) + (k & 1 ? addon : 0): the
//                                      horizontal entries (indices 1 and 3) carry the bias. Indices: 0 up, 1 right,
//                                      2 down, 3 left (the research note's table order; the table itself was not read).
//   _CalculateLOrRDirection(v, prevSign)
//                                      parsed = ParseDirection(v, 0); a horizontal parse is adopted outright; otherwise
//                                      v.x < -0.2 -> 3 (left), v.x > +0.2 -> 1 (right), else **prevSign** - that
//                                      carry-over is the dead zone that stops a model from flickering at the boundary.
//   _SetFourDirection(sign, uOrD)      sign = 1 right / 3 left (mirror), uOrD swaps the front and back configurations.
//
// `v` is the normalized target offset; the `too close` / `zero` guards run before any of it.
/** TOLERANCE_L_OR_R_DIRECTION: the dead zone on the normalized x (|x| <= 0.2 keeps the previous sign). */
export const FACING_TOLERANCE = 0.2;
/** ADDON_TO_L_OR_R_DIRECTION: the bias the horizontal directions get in ParseDirection. */
export const FACING_ADDON = 0.25;
/** TOO_CLOSE_TOLERANCE_SQR = 0.0625 = 0.25^2: closer than this the client judges no direction at all. */
export const FACING_TOO_CLOSE = 0.25;
/** DIRECTION_ZERO_TOLERANCE: a direction vector shorter than this is no direction. */
export const FACING_ZERO = 0.01;
/** ParseDirection's own |v| threshold (0x186e3fd88 = 1e-05, inlined in the method). */
export const FACING_PARSE_EPS = 1e-5;
/** The official sign encoding: 1 = right, 3 = left. */
export const FACE_SIGN_RIGHT = 1;
export const FACE_SIGN_LEFT = 3;
/** FaceSwitcher._defaultLOrR, the value every operator ships with. */
export const FACE_DEFAULT_SIGN = FACE_SIGN_LEFT;

// The direction table, in ParseDirection's order: 0 up, 1 right, 2 down, 3 left. This renderer's dy grows UPWARD
// (a bigger row is higher on the board), so "up" is +y here - the only place the official sign is adapted.
const FACE_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const FACE_DIR_NAMES = ['UP', 'RIGHT', 'DOWN', 'LEFT'];

/**
 * MapUtil.ParseDirection: the four-direction argmax with the horizontal bias.
 *
 * `best = dot(v, dirs[0]) + (0 & 1) * addon`, then for k = 1..3 `d = dot(v, dirs[k]) + ((k & 1) * addon)`: only the
 * horizontal entries (k = 1, 3) get `addon`, and ties keep the earlier index (the loop's comparison is a strict `>`).
 *
 * @param {number} dx any offset (it is normalized here)
 * @param {number} dy
 * @param {number} [addon] 0 for the sign decision, ADDON_TO_L_OR_R_DIRECTION for the axis decision
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
 * The official direction for one target offset: `ParseDirection` (the axis, biased toward horizontal) plus
 * `_CalculateLOrRDirection` (the mirror sign, with its hysteresis dead zone).
 *
 * @param {number} dx the target's offset in tiles (the sim's y grows downward, so "up" is a negative dy)
 * @param {number} dy
 * @param {number} [prevSign] the sign the model had (1 right / 3 left); the dead zone carries it over
 * @returns {{ dir: 'UP'|'DOWN'|'LEFT'|'RIGHT'|null, sign: number, uOrD: boolean }}
 *          `dir` null = no direction at all (too close / zero offset): keep everything
 */
export function facingDir(dx, dy, prevSign = FACE_DEFAULT_SIGN) {
  const x = Number(dx) || 0, y = Number(dy) || 0;
  const prev = prevSign === FACE_SIGN_RIGHT ? FACE_SIGN_RIGHT : prevSign === FACE_SIGN_LEFT ? FACE_SIGN_LEFT : FACE_DEFAULT_SIGN;
  if (x * x + y * y < FACING_TOO_CLOSE * FACING_TOO_CLOSE) return { dir: null, sign: prev, uOrD: false };
  if (Math.abs(x) < FACING_ZERO && Math.abs(y) < FACING_ZERO) return { dir: null, sign: prev, uOrD: false };
  const m = Math.hypot(x, y);
  const nx = x / m, ny = y / m;
  const axis = parseDirection(nx, ny, FACING_ADDON);          // UP / DOWN (the Back model) vs LEFT / RIGHT
  const parsed = parseDirection(nx, ny, 0);                   // _CalculateLOrRDirection's own parse
  let sign;
  if (parsed === FACE_SIGN_RIGHT || parsed === FACE_SIGN_LEFT) sign = parsed;
  else if (nx < -FACING_TOLERANCE) sign = FACE_SIGN_LEFT;
  else if (nx > FACING_TOLERANCE) sign = FACE_SIGN_RIGHT;
  else sign = prev;                                            // the dead zone: keep the sign the model had
  const uOrD = axis === 0 || axis === 2;
  return { dir: FACE_DIR_NAMES[axis], sign, uOrD };
}

/** The official direction for one unit attacking another (both `{ x, y }` in tiles), with the carried-over sign. */
export function facingToward(unit, target, prevSign = FACE_DEFAULT_SIGN) {
  if (!unit || !target) return { dir: null, sign: prevSign, uOrD: false };
  return facingDir(Number(target.x) - Number(unit.x), Number(target.y) - Number(unit.y), prevSign);
}

/** Attack kinds whose "source" is the previous target of a bounce, not an attacker (render/app.js CHAIN_KINDS). */
const BOUNCE = new Set(['chain', 'chainHeal']);

/** Live-facing states in which the official client keeps the model exactly as it is (its stun clip plays in place). */
export const HELD_FACING = ['stun', 'sleep', 'freeze'];

// --- the per-ability face modes (10-face-modes.json, generated into render/faceModes.js) -------------------------------
// Every operator's facing is not one rule: the official client stores, per ability animation, how the model is driven
// while that animation plays. The flags below are the parts of that table this renderer uses.
//   Target            turn the model toward the target of the attack (the default)
//   none              never turn (the animation plays in whatever facing the model has)
//   Default           keep the deployed facing while the clip plays
//   Front             never use the Back model, even when facing up (mirror only)
//   ForceToDirection  play the direction-specific clip (row `up` / `down`) instead of turning
//   FirstCastTarget   keep facing the first target the clip was cast at
//   CheckDownAttack   with FirstCastTarget: a target below plays the `down` clip
/**
 * The flags of a table `mode` string (`'Default+ForceToDirection'` → `{ default: true, forceDir: true, … }`).
 * @param {string} mode
 * @returns {{ target: boolean, none: boolean, def: boolean, front: boolean, forceDir: boolean, firstCast: boolean, checkDown: boolean }}
 */
export function faceModeFlags(mode) {
  const m = String(mode || 'Target');
  const has = (k) => m === k || m.split('+').includes(k);
  const target = has('Target');
  return {
    target,
    none: has('none'),
    def: has('Default'),
    front: has('Front'),
    forceDir: has('ForceToDirection'),
    firstCast: has('FirstCastTarget'),
    checkDown: has('CheckDownAttack'),
  };
}

/**
 * The table row that drives a given clip: an exact `animKey` match wins, then the ability's default row (`animKey: ''`),
 * so a skill animation uses that operator's own default when the table has no row for its exact clip.
 * @param {any[][]|undefined|null} rows the operator's rows (`FACE_MODES[charId]`)
 * @param {string} [clip] the clip playing now (SpineActor.current)
 * @returns {any[]|null}
 */
export function faceModeRow(rows, clip) {
  return faceModeFor(rows, [clip]);
}

/**
 * The row that drives the clip set running now, from a list of candidate animation names in priority order: the first exact
 * match wins, then the ability default (`animKey: ''`). Several candidates are needed because the official table names the
 * CLIP of an ability 鈥?a skill's row may be `Skill_2` while the loop that actually plays is `Skill_2_Loop` (閲庨瑑 S2), and an
 * attack row may name `Attack` while the clip is `Attack_A`.
 * @param {any[][]|undefined|null} rows the operator's rows (FACE_MODES[charId])
 * @param {string[]} candidates animation names, most specific first
 * @returns {any[]|null}
 */
export function faceModeFor(rows, candidates, wantKind = '', opts = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let fallback = null;
  for (const row of rows) {
    if (Array.isArray(row) && !row[0] && !fallback) { fallback = row; break; }
  }
  // More than one ability can name the SAME animation with different modes (char_1052_kalts2's Skill_3_Attack is both
  // `FirstCastTarget+CheckDownAttack` and `Target`): collect every match and pick the row whose kind is what is running,
  // instead of letting the first row win.
  const pick = (list) => {
    if (!list.length) return null;
    let pool = list;
    if (wantKind) {
      const byKind = pool.filter((r) => String(r[5] || '') === wantKind);
      if (byKind.length) pool = byKind;
    }
    if (pool.length > 1) {
      // the same animation driven by two abilities of one kind: a `FirstCastTarget` row is the ability's FIRST attack,
      // so it drives the first attack of the running skill and the plain row the later ones (char_1052_kalts2 S3).
      const isFirst = (r) => /FirstCastTarget/.test(String(r[1] || ''));
      const first = pool.find(isFirst);
      const later = pool.find((r) => !isFirst(r));
      if (opts.firstCast === true && first) return first;
      if (opts.firstCast === false && later) return later;
      return first || later;
    }
    return pool[0];
  };
  for (const cand of candidates) {
    const name = String(cand || '').toLowerCase();
    if (!name) continue;
    const hits = rows.filter((row) => Array.isArray(row) && String(row[0]).toLowerCase() === name);
    const hit = pick(hits);
    if (hit) return hit;
  }
  // soft match: a row whose animKey is a prefix of a candidate (Skill_2 covers Skill_2_Loop), longest row key first
  const list = candidates.map((c) => String(c || '')).filter(Boolean);
  let best = [];
  for (const row of rows) {
    if (!Array.isArray(row) || !row[0]) continue;
    for (const cand of list) {
      if (cand === row[0] || cand.startsWith(row[0] + '_')) {
        if (!best.length || row[0].length > best[0][0].length) best = [row];
        else if (row[0].length === best[0][0].length) best.push(row);
      }
    }
  }
  return pick(best) || fallback;
}

/**
 * Plan the look-ahead window: every queued event in ascending time order, with the ATTACKS grouped by **one attack** and
 * the area ones marked.
 *
 * One group = one source at one event time (one sim tick). More than one distinct target inside a group means the attack
 * hit several units at once (群攻) — its model must not turn, including its first target.
 *
 * Non-attack events (`skill` on/off, `fx`, …) are part of the plan so the renderer can read them in order — the official
 * cast effects of a wind-up need the skill state just before its attack. They carry `group: null` and `multi: false`.
 *
 * @param {{ forEachUpcoming: (from: number, to: number, fn: (ev: any[], t: number) => void) => void }} interp the
 *   interpolation buffer (render/interp.js SnapshotBuffer)
 * @param {number} from
 * @param {number} to
 * @returns {{ ev: any[], t: number, group: string|null, multi: boolean }[]} ascending by time
 */
export function attackGroups(interp, from, to) {
  const seen = new Map();                       // group key -> Set of distinct target ids
  const list = [];
  interp.forEachUpcoming(from, to, (ev, t) => {
    if (!Array.isArray(ev) || ev[1] == null) return;
    if (ev[0] !== 'atk' || (ev[3] != null && BOUNCE.has(ev[3]))) {
      // not this unit's own attack: a skill toggle rides along, a bounce belongs to the previous target
      list.push({ ev, t, group: null, multi: false });
      return;
    }
    const group = `${ev[1]}|${t}`;
    let targets = seen.get(group);
    if (!targets) seen.set(group, (targets = new Set()));
    if (ev[2] != null) targets.add(ev[2]);
    list.push({ ev, t, group, multi: false });
  });
  for (const entry of list) if (entry.group) entry.multi = (seen.get(entry.group)?.size ?? 0) > 1;
  return list;
}
