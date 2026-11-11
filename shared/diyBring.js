// shared/diyBring.js — the 规程 选择自编 bring step (act3 constData.diyCharLimitForLevels, enter step CUSTOM_CHECK).
// Pure ESM, shared by the server and the client. No Node APIs, no randomness.
//
// Official (diyChessDict / shopLevelDisplayDataDict / constData.diyCharLimitForLevels, the 11-08 tutorial
// guide_auto_chess_mode_training_2_diy, PRTS 卫戍协议 2026-11-10): the roster has six slots at tier Ⅴ and six at Ⅵ.
// At the start of a simulation the player brings 0–2 operators from each tier (at most four). A slot whose core
// bond is banned cannot be selected. Operators left out do not enter the shop. Confirming none is 禁用自选.
// Seasons without both the enter step and the limit map do not use this step (the four 盟约 versions).

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Per-tier bring caps, or null when this data has no 选择自编 step.
 * Both gates are required: `timers.enterSteps` contains `CUSTOM_CHECK`, and `diyBringLimits` is a map of
 * non-negative integer caps keyed by shop tier (`constData.diyCharLimitForLevels`, `{"5":2,"6":2}` on 规程).
 * @param {any} config data/config.json
 * @returns {Record<number, number>|null}
 */
export function diyBringLimitsOf(config) {
  const steps = config?.timers?.enterSteps;
  if (!Array.isArray(steps) || !steps.some((s) => s && s.step === 'CUSTOM_CHECK')) return null;
  const raw = config?.diyBringLimits;
  if (!isObj(raw)) return null;
  /** @type {Record<number, number>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[0-9]+$/.test(k) || !Number.isInteger(v) || v < 0 || v > 12) continue;
    out[Number(k)] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The cap of `tier`, or null when the map does not name it. @param {Record<number, number>|null|undefined} limits */
export function diyBringCap(limits, tier) {
  if (!isObj(limits) || tier == null) return null;
  if (Object.prototype.hasOwnProperty.call(limits, tier) && Number.isInteger(limits[tier])) return limits[tier];
  const key = String(tier);
  if (Object.prototype.hasOwnProperty.call(limits, key) && Number.isInteger(limits[key])) return limits[key];
  return null;
}

/**
 * Strict check of a 选择自编 confirmation. `slots` is the roster slot ids the player brings (empty = 禁用自选).
 * Refuses a slot that is not in the roster, a duplicate, a bond-excluded slot, an unknown tier, or a tier over its cap.
 * @param {any} slots
 * @param {{ roster: Record<string, any>, banned: Iterable<string>, limits: Record<number, number>, tierOf: (id: string) => number|null }} ctx
 * @returns {{ ok: true, slots: string[] } | { error: 'BAD_MSG'|'BAD_TARGET', detail: string }}
 */
export function checkDiyBring(slots, { roster, banned, limits, tierOf }) {
  if (!Array.isArray(slots) || slots.length > 12) return { error: 'BAD_MSG', detail: 'bad diy bring' };
  const bad = new Set(banned || []);
  const seen = new Set();
  /** @type {Record<number, number>} */
  const counts = {};
  /** @type {string[]} */
  const kept = [];
  for (const id of slots) {
    if (typeof id !== 'string' || !roster || !Object.prototype.hasOwnProperty.call(roster, id)) {
      return { error: 'BAD_TARGET', detail: 'not in roster' };
    }
    if (seen.has(id)) return { error: 'BAD_TARGET', detail: 'duplicate' };
    if (bad.has(id)) return { error: 'BAD_TARGET', detail: 'banned bond' };
    const tier = tierOf(id);
    const cap = diyBringCap(limits, tier);
    if (cap == null) return { error: 'BAD_TARGET', detail: 'tier' };
    counts[tier] = (counts[tier] || 0) + 1;
    if (counts[tier] > cap) return { error: 'BAD_TARGET', detail: 'cap' };
    seen.add(id);
    kept.push(id);
  }
  return { ok: true, slots: kept };
}

/**
 * [ASSUMED] What a seat that does not choose brings: the legal roster slots in the given order (data order when the
 * caller passes `diySlotIds`), up to each tier's cap. A roster of at most the cap per tier therefore brings every
 * legal slot — the same set the shop stocked before this step existed. An empty roster brings nothing.
 * @param {string[]} slotIds
 * @param {{ roster: Record<string, any>, banned: Iterable<string>, limits: Record<number, number>, tierOf: (id: string) => number|null }} ctx
 * @returns {string[]}
 */
export function defaultDiyBring(slotIds, { roster, banned, limits, tierOf }) {
  const bad = new Set(banned || []);
  /** @type {Record<number, number>} */
  const counts = {};
  /** @type {string[]} */
  const out = [];
  for (const id of Array.isArray(slotIds) ? slotIds : []) {
    if (!roster || !Object.prototype.hasOwnProperty.call(roster, id) || bad.has(id)) continue;
    const tier = tierOf(id);
    const cap = diyBringCap(limits, tier);
    if (cap == null) continue;
    counts[tier] = counts[tier] || 0;
    if (counts[tier] >= cap) continue;
    counts[tier] += 1;
    out.push(id);
  }
  return out;
}

/**
 * [ASSUMED] A bot's bring from a roster it already has: legal slots ranked by how many of the operator's bonds are
 * still on this match (`rank(id).count`, higher first), then `charId`, then the slot id. At most the cap per tier.
 * No randomness. Synthesis of an empty bot roster lives on the server (`PlayerDiy.synthesizeBotRoster`); this only
 * chooses which of those slots to bring.
 * @param {string[]} slotIds
 * @param {{ roster: Record<string, any>, banned: Iterable<string>, limits: Record<number, number>,
 *   tierOf: (id: string) => number|null, rank: (id: string) => { count: number, charId: string } }} ctx
 * @returns {string[]}
 */
export function botPickDiy(slotIds, { roster, banned, limits, tierOf, rank }) {
  const bad = new Set(banned || []);
  const legal = [];
  for (const id of Array.isArray(slotIds) ? slotIds : []) {
    if (!roster || !Object.prototype.hasOwnProperty.call(roster, id) || bad.has(id)) continue;
    if (diyBringCap(limits, tierOf(id)) == null) continue;
    legal.push(id);
  }
  legal.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (rb.count !== ra.count) return rb.count - ra.count;
    if (ra.charId < rb.charId) return -1;
    if (ra.charId > rb.charId) return 1;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  /** @type {Record<number, number>} */
  const counts = {};
  /** @type {string[]} */
  const out = [];
  for (const id of legal) {
    const tier = tierOf(id);
    const cap = diyBringCap(limits, tier);
    counts[tier] = counts[tier] || 0;
    if (counts[tier] >= cap) continue;
    counts[tier] += 1;
    out.push(id);
  }
  return out;
}
