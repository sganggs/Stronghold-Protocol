// server/sim/rng.js — seeded PRNG (mulberry32) + helpers. The ONLY source of randomness in the sim.

/**
 * Create a deterministic PRNG. Returns a function producing floats in [0, 1) with helper methods.
 * @param {number} seed uint32 (any number is coerced)
 */
export function createRng(seed = 1) {
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  /** integer in [0, n) */
  rng.int = (n) => Math.floor(next() * Math.max(0, n));
  /** float in [a, b) */
  rng.range = (a, b) => a + next() * (b - a);
  /** true with probability p */
  rng.chance = (p) => next() < p;
  /** random element (undefined for empty) */
  rng.pick = (arr) => (arr && arr.length ? arr[Math.floor(next() * arr.length)] : undefined);
  /** in-place Fisher–Yates shuffle, returns arr */
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  };
  /** current internal state (for debugging / hashing) */
  rng.state = () => s;
  return rng;
}

/**
 * Weighted pick of `[id, weight]` pairs with the rng (the one weighted-draw primitive; `rng` is any
 * `() => [0,1)` function). The empty list returns null, a non-positive total returns the first id.
 * @param {() => number} rng
 * @param {Array<[any, number]>} pairs
 */
export function weightedPick(rng, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += Math.max(0, Number(w) || 0);
  if (total <= 0) return pairs.length ? pairs[0][0] : null;
  let r = rng() * total;
  for (const [id, w] of pairs) { r -= Math.max(0, Number(w) || 0); if (r < 0) return id; }
  return pairs[pairs.length - 1][0];
}

/** Derive a child seed deterministically (e.g. per field). */
export function deriveSeed(seed, salt) {
  let h = (Number(seed) >>> 0) ^ 0x85ebca6b;
  const str = String(salt);
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b1);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
