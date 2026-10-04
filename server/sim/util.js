// server/sim/util.js — the single home of the dependency-free scalar helpers used across `server/sim/*`
// and `server/match/*`.
//
// This file is served to the browser under /sim/, exactly like the rest of server/sim, so it MUST stay
// pure (no Node APIs, no imports). It deliberately exposes several *different* numeric semantics under
// distinct names — the previous 15+ copies each coerced differently, and collapsing them into one
// `num()` would silently change behaviour:
//   * numOr      — a finite `number`, else the default (the old waves/units/professions strict form)
//   * coerceNum  — like numOr but also coerces a numeric string via `Number()` (the old Battle `fin`)
//   * toNum      — a number or a non-empty numeric string, else the default (the old simdata/support form)
//   * intOr      — truncate a finite number, else the default
//   * posIntOr   — a positive integer, else the default
//   * posNumOr   — a positive finite number, else the default
//   * finiteIn   — whether v is a finite number inside [lo, hi]

/** Clamp `v` into [lo, hi]. */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Clamp `v` into [0, 1]. */
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A finite `number`, else `d` (default 0). Non-numbers (including numeric strings) fall back. */
export const numOr = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Like `numOr`, but a non-empty coercible string is accepted (`Number(v)`). */
export const coerceNum = (v, d) => {
  const n = typeof v === 'number' ? v : (v == null || v === '' ? NaN : Number(v));
  return Number.isFinite(n) ? n : d;
};

/** A number or a non-empty numeric string, else `d`. */
export const toNum = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v)
  ? v
  : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));

/** Like `toNum`, but `undefined` (not a default) when not coercible. */
export const toNumOrUndef = (v) => {
  const n = toNum(v, NaN);
  return Number.isFinite(n) ? n : undefined;
};

/** Truncate a finite number, else `d`. */
export const intOr = (v, d = 0) => (Number.isFinite(v) ? Math.trunc(v) : d);

/** A positive integer, else `d`. */
export const posIntOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

/** A positive finite number, else `d`. */
export const posNumOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);

/** True when `v` is a finite number inside [lo, hi]. */
export const finiteIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** C# `Math.Round(double)`: banker's rounding (half to even). */
export function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.floor(x + 0.5);
}

/**
 * Number of leaks that count against LP: every entry except `counted: false` (notCountInTotal / unharmful / parts).
 * The single implementation behind the old `(l) => l && l.counted !== false` filter that was copied ~15×.
 * @param {Array<{counted?: boolean}> | null | undefined} leaked
 * @returns {number}
 */
export function countedLeaks(leaked) {
  let n = 0;
  for (const l of leaked || []) if (l && l.counted !== false) n++;
  return n;
}
