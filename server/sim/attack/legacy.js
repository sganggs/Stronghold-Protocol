// Compatibility boundary for existing positional Battle calls. New code uses attack.js object requests.
import { makeDamageInfo } from './helpers.js';
import { resolveDamage } from './hit.js';
import { applyHpLoss, leaderHitCancelled } from './health.js';
import { heal as applyHeal } from './heal.js';

export function legacyDamage(battle, source, target, damage, opts = {}) {
	if (!target || !target.alive || target.removed || target.hidden || !target.deployed) return 0;
	const dmg = damage && damage._norm ? damage : makeDamageInfo(damage);
	if (source == null && opts.credit !== undefined) dmg.sourceless = true;
	const credit = opts.credit === undefined ? source : opts.credit;
	return resolveDamage(battle, { source: dmg.sourceless ? null : source, credit, target, dmg });
}

export function legacyHeal(battle, source, target, amount, opts = {}) {
	return applyHeal(battle, source, target, amount, opts);
}

/** Old amounts have already been mitigated by their callers. Never mitigate them again. */
export function legacyHPLose(battle, target, amount, { source = null, silent = false, tags = [], from = null, sourceless = false, noHitLimit = false } = {}) {
	if (!target || !target.alive || !(amount > 0)) return 0;
	if (!noHitLimit && leaderHitCancelled(battle, target, amount)) return 0;
	const dmg = { type: 'true', tags: [...new Set(['hpLoss', ...(from?.tags ?? []), ...(tags ?? [])])], noSp: true,
		silent, origin: from, sourceless: !!sourceless || !!from?.sourceless };
	return applyHpLoss(battle, { source: dmg.sourceless ? null : source, credit: source, target, dmg, kind: 'hpLoss' }, amount);
}
