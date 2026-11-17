// Explicit settlement API. Each request carries actual source, target and independent credit.
import { makeDamageInfo } from './attack/helpers.js';
import { resolveDamage } from './attack/hit.js';
import { loseHp } from './attack/health.js';
import { mitigate } from './attack/calculation.js';
import { heal as applyHeal } from './attack/heal.js';
import { healElement as recoverElement } from './attack/element.js';

// Public helpers for content and engine callers; implementation paths stay private.
export { makeDamageInfo, mitigate };
export { hasHp, isHpLoss, periodicDamage, damageAttackType, damageApplyWay,
  damageDodgeMode, cancelDamage } from './attack/helpers.js';
export { attackInput } from './attack/calculation.js';
export { burstLocked, elementView, palsyBuff } from './attack/element.js';
export { reserveTransfer } from './attack/transfer.js';

/** Build one mutable instance; attribution is never smuggled into its source. */
function context(request, type = 'phys') {
  if (request.attackType != null && !['NONE', 'NORMAL', 'SPLASH', 'BUFF', 'ADDITION'].includes(request.attackType)) throw new TypeError('Unknown attack type');
  if (request.applyWay != null && !['NONE', 'MELEE', 'RANGED', 'ALL'].includes(request.applyWay)) throw new TypeError('Unknown damage application route');
  if (request.dodgeMode != null && !['normal', 'ignore', 'uncancellable'].includes(request.dodgeMode)) throw new TypeError('Unknown dodgeMode');
  if (request.calculation != null && !['base', 'precomputed', 'resolved'].includes(request.calculation)) throw new TypeError('Unknown calculation stage');
  if (request.onApplied != null && typeof request.onApplied !== 'function') throw new TypeError('onApplied must be a function');
  if (request.ignoreCancelReasons != null && (!Array.isArray(request.ignoreCancelReasons)
    || request.ignoreCancelReasons.some(reason => !['dodge', 'block', 'miss'].includes(reason)))) throw new TypeError('Unknown damage cancellation reason');
  const source = request.source ?? null;
  const credit = request.credit === undefined ? source : request.credit;
  const dmg = makeDamageInfo({ ...request, type: request.type ?? type, attackType: request.attackType ?? 'NORMAL', sourceless: source == null });
  return { source, credit, target: request.target, dmg, onApplied: request.onApplied ?? null };
}

/**
 * HP damage. amount is the pre-mitigation value (callers already include their attack scale).
 * @param {object} battle
 * @param {import('../../types/attack.js').DamageRequest} request
 */
export function dealDamage(battle, request) {
  if (request.type != null && !['phys', 'arts', 'true', 'elemental'].includes(request.type)) throw new TypeError('Use an HP damage type; gauges use dealElementDamage');
  return resolveDamage(battle, context(request));
}

/**
 * Gauge damage has its own unit and pipeline; never interprets amount as HP.
 * @param {object} battle
 * @param {import('../../types/attack.js').ElementDamageRequest} request
 */
export function dealElementDamage(battle, request) {
  return resolveDamage(battle, context({ ...request, type: 'element' }));
}

/**
 * Typed HP loss (流失): `type` 'phys' / 'arts' is first reduced by the target's DEF / RES, 'true' (the default) is not;
 * then 限伤 and HP bookkeeping — no barriers or damage-triggered SP. The positional Battle.dealHPLose(target, amount,
 * opts) is the same path (attack/health.js loseHp) with `opts.type`, 'true' by default.
 * @param {object} battle
 * @param {import('../../types/attack.js').HPLossRequest} request
 */
export function dealHPLose(battle, request) {
  if (request.type != null && !['phys', 'arts', 'true'].includes(request.type)) throw new TypeError('HP loss supports phys, arts or true');
  const ctx = context(request, 'true');
  const { dmg } = ctx;
  dmg.tags = [...new Set(['hpLoss', ...(request.origin?.tags ?? []), ...dmg.tags])];
  dmg.noSp = true;
  dmg.silent = !!request.silent;
  dmg.origin = request.origin ?? null;
  return loseHp(battle, ctx, dmg.amount, { noHitLimit: !!request.noHitLimit });
}

/**
 * Ordinary healing, regeneration attributes, or HP restoration.
 * @param {object} battle
 * @param {import('../../types/attack.js').HealRequest} request
 */
export function heal(battle, request) {
  if (request.mode != null && !['heal', 'regen', 'restore'].includes(request.mode)) throw new TypeError('Unknown healing mode');
  const { source = null, target, amount, ...opts } = request;
  return applyHeal(battle, source, target, amount, opts);
}

/**
 * Element recovery. Without element, each gauge independently recovers amount.
 * @param {object} _battle
 * @param {import('../../types/attack.js').ElementHealRequest} request
 */
export function healElement(_battle, request) {
  return recoverElement(request.target, request.amount, request.element ?? null);
}
