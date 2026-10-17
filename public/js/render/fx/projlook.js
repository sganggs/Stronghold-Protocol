// public/js/render/fx/projlook.js — content-owned projectile looks (docs/ASSETS.md "特效: 投射物外观").
//
// A content pack (a plugin) may describe how its own projectiles look without touching this repository: the manifest
// carries `fx.proj[<kind>]`, one object mirroring an entry of style.js PROJ, and projSpec() lays it over the built-in
// entry of that kind. A kind the built-in table does not know at all is allowed too — the pack then supplies the whole
// look, built on FALLBACK below.
//
// The manifest is untrusted input: every field is checked here and a value that does not parse keeps the built-in one,
// so a broken pack degrades to a stock-looking projectile instead of an invisible or infinite-lifetime one.

import { PROJ } from '../style.js';

const LOOKS = new Set(['tracer', 'orb', 'shell', 'dart', 'boomerang']);
const HITS = new Set(['spark', 'arts', 'heal', 'boom', 'splash', 'zap', 'enemy']);
/** Field → [min, max]; tiles per second for the speeds, tiles for the sizes. */
const NUM = Object.freeze({
  speed: [0.1, 40], back: [0.1, 40], len: [0, 6], width: [0.02, 3], head: [0.02, 4], arc: [0, 8],
});
const COLOURS = ['tint', 'glow', 'trail', 'muzzle', 'smoke'];

/**
 * What a pack's kind with no built-in entry starts from: a small glowing orb, a sane speed and the generic spark burst.
 * Deliberately dull — a pack should say what it looks like, and a typo should not look like a feature.
 */
export const FALLBACK = Object.freeze({
  look: 'orb', speed: 12, tint: 0xffffff, glow: 0x9ff0dc, len: 0.6, width: 0.28, head: 0.44, hit: 'spark',
});

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const colour = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 0xffffff) return null;
  return Math.round(v);
};

/**
 * One manifest entry laid over a built-in PROJ entry. Unknown keys, wrong types and out-of-range numbers are dropped;
 * neither argument is mutated (the result is a new object, or `base` itself when `ext` is not an object).
 * @param {any} base style.js PROJ entry (may be FALLBACK)
 * @param {any} ext  manifest `fx.proj.<kind>` entry
 * @returns {any} the merged spec
 */
export function mergeProjSpec(base, ext) {
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) return base;
  const out = { ...base };
  if (typeof ext.look === 'string' && LOOKS.has(ext.look)) out.look = ext.look;
  if (typeof ext.hit === 'string' && HITS.has(ext.hit)) out.hit = ext.hit;
  if (ext.once === true) out.once = true;
  for (const [k, [lo, hi]] of Object.entries(NUM)) {
    const v = num(ext[k], lo, hi);
    if (v != null) out[k] = v;
  }
  for (const k of COLOURS) {
    const v = colour(ext[k]);
    if (v != null) out[k] = v;
  }
  return out;
}

/**
 * The spec of a projectile kind as this client should draw it: the pack's `fx.proj.<kind>` over the built-in entry of
 * `style.js` PROJ. Kinds the built-in table does not know are drawn from FALLBACK, but only when the manifest really
 * describes them — an unknown kind with no entry is still "no projectile look" (null), exactly as before.
 * @param {string} kind b.ev 'atk' projKind
 * @param {any} [manifest] data/assets.json (`{ fx?: { proj?: { [kind]: object } } }`)
 * @returns {any|null}
 */
export function projSpec(kind, manifest = null) {
  if (typeof kind !== 'string' || !kind) return null;
  const ext = manifest?.fx?.proj?.[kind];
  const base = PROJ[kind];
  if (base) return mergeProjSpec(base, ext);
  return ext && typeof ext === 'object' ? mergeProjSpec(FALLBACK, ext) : null;
}
