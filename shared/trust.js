// Result verification policy; transport only, never consumed by the simulation.
import { sha256Hex } from './sha256.js';

export const TRUST_LEVELS = Object.freeze(['L0', 'L1', 'L2']);
export const isTrustLevel = (value) => TRUST_LEVELS.includes(value);
export const atLeastTrust = (level, floor) => TRUST_LEVELS.indexOf(level) >= TRUST_LEVELS.indexOf(floor) ? level : floor;

/** Safety cap in game seconds, shared by server headless runs and the verification Worker. */
export const HARD_CAP_SECONDS = 3700;

/** An absent or unsupported setting preserves SP_VERIFY, including its existing all mode. */
export function resolveTrust(trust = null, verify = null) {
  const requested = String(trust ?? '').trim().toUpperCase();
  const explicit = isTrustLevel(requested);
  const level = explicit ? requested : 'L0';
  const legacy = String(verify ?? '').trim().toLowerCase();
  return { level, explicit,
    verify: explicit ? (level === 'L2' ? 'sample' : 'off') : (legacy === 'all' || legacy === 'sample' ? legacy : 'off') };
}

/** Stable JSON binding: object insertion order must not create a peer disagreement. */
export function canonicalTrust(value) {
  if (Array.isArray(value)) return value.map((v) => canonicalTrust(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter((k) => value[k] !== undefined).map((k) => [k, canonicalTrust(value[k])]));
  return value;
}

export const trustHash = (value) => sha256Hex(JSON.stringify(canonicalTrust(value)));
