/**
 * Object requests for the explicit settlement API (server/sim/attack.js).
 * Amounts are pre-mitigation values unless calculation explicitly says 'resolved'.
 * @typedef {import('./core.js').Unit} Unit
 * @typedef {import('./core.js').DamageInfo} DamageInfo
 */

/**
 * @typedef {Omit<DamageInfo, 'type'> & {
 * source?: Unit|null, credit?: Unit|null, target: Unit,
 * type?: 'phys'|'arts'|'true'|'elemental',
 * calculation?: 'base'|'resolved', dodgeMode?: 'normal'|'ignore'|'uncancellable'
 * }} DamageRequest
 */

/**
 * @typedef {Omit<DamageRequest, 'type'> & {
 * type?: 'phys'|'arts'|'true', noHitLimit?: boolean, silent?: boolean, origin?: DamageInfo
 * }} HPLossRequest
 */

/**
 * @typedef {Object} ElementDamageRequest
 * @property {Unit|null} [source]
 * @property {Unit|null} [credit]
 * @property {Unit} target
 * @property {number} amount
 * @property {string} element
 * @property {number} [mul]
 * @property {string[]} [tags]
 * @property {boolean} [ignoreSleep]
 * @property {boolean} [ignoreSelect]
 */

/**
 * @typedef {Object} HealRequest
 * @property {Unit|null} [source]
 * @property {Unit} target
 * @property {number} amount
 * @property {'heal'|'regen'|'restore'} [mode]
 * @property {boolean} [self]
 * @property {boolean} [silent]
 * @property {boolean} [ignoreHealFree]
 * @property {boolean} [overheal]
 * @property {number} [overhealDuration]
 */

/**
 * @typedef {Object} ElementHealRequest
 * @property {Unit} target
 * @property {number} amount recovered independently from each selected gauge
 * @property {string|null} [element] omitted/null selects every gauge
 */
export {};
