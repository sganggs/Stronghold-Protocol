// Pure arithmetic: callers supply stat snapshots. No hooks, RNG, shields or HP mutation.
import { MIN_DAMAGE_RATIO } from '../constants.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Pure mitigation formula (exported for tests). `target` = the target's stats; `ign.elementalRes` = its 元素抗性
 * (epDamageResistance) for 'elemental' damage.
 */
export function mitigate(amount, type, target, ign = {}) {
	if (type === 'phys') {
		const D = target.def ?? 0;
		const eff = Math.max(0, D * (1 - clamp01(ign.defIgnorePct ?? 0)) - (ign.defIgnoreFlat ?? 0));
		return Math.max(amount - eff, MIN_DAMAGE_RATIO * amount);
	}
	if (type === 'arts') {
		const R = target.res ?? 0;
		const eff = Math.max(0, R * (1 - clamp01(ign.resIgnorePct ?? 0)) - (ign.resIgnoreFlat ?? 0));
		return Math.max(amount * (1 - Math.min(100, eff) / 100), MIN_DAMAGE_RATIO * amount);
	}
	if (type === 'elemental') {
		const D = Math.max(0, Math.min(100, Number.isFinite(ign.elementalRes) ? ign.elementalRes : 0));
		return Math.max(amount * (1 - D / 100), MIN_DAMAGE_RATIO * amount);
	}
	return amount;
}

/**
 * Expected damage for the red-number test. Same mitigation as the hit, without DEF/RES penetration and without
 * the multipliers applied after mitigation (source dmgDealtMul / phys/artsDealtMul, target dmgTakenMul and the
 * type-taken multipliers, shields, hpDamage rewrites, hit-count replacement).
 * [ASSUMED] `dmg.amount` is already the attack's stated ATK × 攻击倍率 — callers bake `atkScaleMul` in, and this
 * does not divide it back out. `dmg.mul` stays on both sides (the instance's own scale, including a skill-hit
 * fraction). Cached-ATK expected damage (raw ATK only), forced red, blue numbers and yellow BLOCK have no
 * DamageInfo flag here and are not applied.
 */
export function officialExpectedAmount(dmg, type, ts, target) {
	const base = mitigate(dmg.amount, type, ts, {
		defIgnorePct: 0, defIgnoreFlat: 0, resIgnorePct: 0, resIgnoreFlat: 0,
		elementalRes: type === 'elemental' ? (target.def?.epDamageResistance ?? 0) : 0,
	});
	const mul = Number.isFinite(dmg.mul) ? dmg.mul : 1;
	const exp = base * mul;
	return Number.isFinite(exp) && exp > 0 ? exp : 0;
}

/** Pre-shield damage after mitigation and the post-mitigation multipliers. Identical to the inline formula it replaced. */
export function calculateDamage(dmg, type, ts, ss, target) {
	let final = dmg.calculation === 'resolved' ? dmg.amount : mitigate(dmg.amount, type, ts, {
		defIgnorePct: dmg.defIgnorePct + (ss ? ss.defIgnorePct : 0),
		defIgnoreFlat: dmg.defIgnoreFlat + (ss ? ss.defIgnoreFlat : 0),
		resIgnorePct: dmg.resIgnorePct + (ss ? ss.resIgnorePct : 0),
		resIgnoreFlat: dmg.resIgnoreFlat + (ss ? ss.resIgnoreFlat : 0),
		elementalRes: type === 'elemental' ? (target.def?.epDamageResistance ?? 0) : 0,
	});
	let mul = dmg.mul * (type === 'elemental' ? 1 : ts.dmgTakenMul);
	if (ss && dmg.calculation !== 'resolved') mul *= ss.dmgDealtMul * (type === 'phys' ? ss.physDealtMul : type === 'arts' ? ss.artsDealtMul : 1);
	mul *= type === 'phys' ? ts.physTakenMul : type === 'arts' ? ts.artsTakenMul : type === 'elemental' ? ts.elementalTakenMul : ts.trueTakenMul;
	final *= mul;
	if (!(final > 0) || !Number.isFinite(final)) final = 0;
	return final;
}

