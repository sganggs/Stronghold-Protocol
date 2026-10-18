/**
 * Object requests for the explicit settlement API (server/sim/attack.js).
 * Amounts are pre-mitigation values unless calculation explicitly says 'resolved'.
 * @typedef {import('./core.js').Unit} Unit
 * @typedef {import('./core.js').DamageInfo} DamageInfo
 */

/**
 * @typedef {Omit<DamageInfo, 'type'|'sourceless'|'cancel'|'missed'|'atkScale'> & {
 * source?: Unit|null, credit?: Unit|null, target: Unit,
 * type?: 'phys'|'arts'|'true'|'elemental',
 * calculation?: 'base'|'precomputed'|'resolved', dodgeMode?: 'normal'|'ignore'|'uncancellable',
 * onApplied?: (result: AppliedDamage) => void
 * }} DamageRequest
 */

/**
 * Positive ordinary damage after settlement and fatal/kill handling. HP removed can be zero under special HP.
 * @typedef {Object} AppliedDamage
 * @property {Unit|null} source
 * @property {Unit|null} credit
 * @property {Unit} target
 * @property {DamageInfo} dmg
 * @property {'damage'} kind
 * @property {number} amount
 * @property {number} hpRemoved
 */

/**
 * HP loss has mitigation inputs, attribution and bookkeeping options only.
 * It does not advertise ignored ordinary-damage options such as dodgeMode or calculation.
 * @typedef {Object} HPLossRequest
 * @property {Unit|null} [source]
 * @property {Unit|null} [credit]
 * @property {Unit} target
 * @property {number} amount
 * @property {'phys'|'arts'|'true'} [type]
 * @property {number} [defIgnoreFlat]
 * @property {number} [defIgnorePct]
 * @property {number} [resIgnoreFlat]
 * @property {number} [resIgnorePct]
 * @property {string[]} [tags]
 * @property {DamageInfo} [origin]
 * @property {boolean} [noHitLimit]
 * @property {boolean} [silent]
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
