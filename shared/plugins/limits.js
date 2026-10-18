// Shared numeric bounds for data plugins (DESIGN §32.5). The battle imports these same numbers so a later
// writer cannot bypass validateData. [ASSUMED] each cap is above every official table and far below ±1e9.

/** Spawn rows in one wave, or in one branch phase. Official waves stay at or below 28. */
export const PLUGIN_SPAWN_ENTRIES = 64;
/**
 * Living enemies one wave or branch phase may ask for, and the per-row count. Must equal
 * server/sim/constants.js MAX_ALIVE_ENEMIES. Shared code does not import the server; the regression test locks the two.
 */
export const PLUGIN_SPAWN_TOTAL = 600;
/**
 * The most units one wave action fields: server/match/waves.js clamps templateSpawns' count, the faction generator's
 * replaced counts (factions.generation.minReplacedEnemyCount / maxReplacedEnemyCount) and a bounty plan's share to it,
 * and the check of a data plugin caps those two fields at it (officialBounds.js) — what passes is what the generator
 * plays. Official values: 1 and 5.
 */
export const PLUGIN_ACTION_UNITS = 50;
/**
 * The most slots a pick-one offer shows: server/match/player/common.js MAX_OFFER_SLOTS (a test locks the two). The
 * offer's count (config economy.rewardOffer.count, official 3) is capped at it by the game data and by the check of a data
 * plugin — a larger count only rolled the pool for slots nobody sees.
 */
export const PLUGIN_OFFER_SLOTS = 6;
/**
 * The longest interaction window a plugin may ask the host to open (shared/plugins/offers.js, PLUGIN API v2), and how
 * many such windows one plugin may declare. [ASSUMED] A minute is the longest window the official drafts ever show
 * (the strategy draft's turn is 50 s), and a room that waits longer than a few minutes is not playing.
 */
export const PLUGIN_OFFERS_MAX_WINDOW_SEC = 300;
export const PLUGIN_OFFERS_PER_PLUGIN = 32;
/** Enemy blackboard `times` / keys ending in `times`. Official values stay at or below 8. JSON SkillSpec hits stay at 100. */
export const PLUGIN_TIMES_MAX = 100;
/** Per-count card grants. Official `global_special_choice_gain_equip` and bond-chess counts stay at or below 2. */
export const PLUGIN_GAIN_COUNT_MAX = 32;
export const PLUGIN_GAIN_COUNT_KEYS = Object.freeze([
  'global_special_choice_gain_equip',
  'single_special_choice_gain_bond_chess',
]);
/**
 * Systematic cap for every other numeric blackboard key and the loop fields in officialBounds.js.
 * [ASSUMED] DESIGN §32.5: `|v| ≤ max(10 × official absolute max, 64)`. A key the official tables never
 * have uses the floor. Official inputs of the clamped loops are at or below 55, so the floor alone does
 * not change a vanilla fight.
 */
export const PLUGIN_BOUND_FACTOR = 10;
export const PLUGIN_BOUND_FLOOR = 64;

/**
 * Cap for one official absolute maximum. A missing or negative maximum uses the floor.
 * @param {unknown} officialMax
 * @returns {number}
 */
export function dataBound(officialMax) {
  const m = Number(officialMax);
  if (!Number.isFinite(m) || m < 0) return PLUGIN_BOUND_FLOOR;
  return Math.max(PLUGIN_BOUND_FACTOR * m, PLUGIN_BOUND_FLOOR);
}

/**
 * A finite count capped to [0, max] without flooring: a 2.5 loop still runs three times. Non-finite values use fallback.
 * @param {unknown} value
 * @param {number} max
 * @param {number} fallback
 */
export function boundedCount(value, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(0, n));
}

/**
 * A blackboard key used as an interval, a period, or a per-step cost.
 * [ASSUMED] `coin_cnt` is a spend step and does not match the name pattern, so it is listed.
 * @param {unknown} key
 */
export function isStepKey(key) {
  return typeof key === 'string' && (
    /(?:^|[.@])(?:interval|period)$/.test(key)
    || /(?:^|\.)cost$/.test(key)
    || key === 'coin_cnt'
  );
}
