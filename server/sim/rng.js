// server/sim/rng.js — seeded PRNG (mulberry32) + helpers. The ONLY source of randomness in the sim.

/**
 * Create a deterministic PRNG. Returns a function producing floats in [0, 1) with helper methods.
 * @param {number} seed uint32 (any number is coerced)
 */
export function createRng(seed = 1) {
  return rngFromState((Number(seed) >>> 0) || 0x9e3779b9);
}

function rngFromState(s) {
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
  /** weighted pick: items with weightFn(item) */
  rng.weighted = (arr, weightFn) => {
    let total = 0;
    for (const x of arr) total += Math.max(0, weightFn(x));
    if (total <= 0) return undefined;
    let r = next() * total;
    for (const x of arr) { r -= Math.max(0, weightFn(x)); if (r < 0) return x; }
    return arr[arr.length - 1];
  };
  /** current internal state (for debugging / hashing) */
  rng.state = () => s;
  /** Independent stream at the same position, including internal state zero. */
  rng.clone = () => rngFromState(s);
  return rng;
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
