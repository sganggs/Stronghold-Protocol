// Explicit settlement API. Each request carries actual source, target and independent credit.
import { makeDamageInfo } from './attack/helpers.js';
import { resolveDamage } from './attack/hit.js';
import { applyHpLoss, leaderHitCancelled } from './attack/health.js';
import { mitigate } from './attack/calculation.js';
import { heal as applyHeal } from './attack/heal.js';
import { healElement as recoverElement } from './attack/element.js';

/** Build one mutable instance; attribution is never smuggled into its source. */
function context(request, type = 'phys') {
	if (request.dodgeMode != null && !['normal', 'ignore', 'uncancellable'].includes(request.dodgeMode)) throw new TypeError('Unknown dodgeMode');
	if (request.calculation != null && !['base', 'resolved'].includes(request.calculation)) throw new TypeError('Unknown calculation stage');
	const source = request.source ?? null;
	const credit = request.credit === undefined ? source : request.credit;
	const dmg = makeDamageInfo({ ...request, type: request.type ?? type, sourceless: source == null });
	return { source, credit, target: request.target, dmg };
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
 * Typed HP loss: mitigation only, then HP bookkeeping; no barriers or damage-triggered SP.
 * @param {object} battle
 * @param {import('../../types/attack.js').HPLossRequest} request
 */
export function dealHPLose(battle, request) {
	if (request.type != null && !['phys', 'arts', 'true'].includes(request.type)) throw new TypeError('HP loss supports phys, arts or true');
	const ctx = context(request, 'true');
	const { target, dmg } = ctx;
	if (!target || !target.alive || !(dmg.amount > 0)) return 0;
	const amount = mitigate(dmg.amount, dmg.type, target.s, dmg);
	if (!Number.isFinite(amount) || !(amount > 0)) return 0;
	if (!request.noHitLimit && leaderHitCancelled(battle, target, amount)) return 0;
	dmg.tags = [...new Set(['hpLoss', ...(request.origin?.tags ?? []), ...dmg.tags])];
	dmg.noSp = true;
	dmg.silent = !!request.silent;
	dmg.origin = request.origin ?? null;
	return applyHpLoss(battle, { ...ctx, kind: 'hpLoss' }, amount);
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
