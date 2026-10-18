// server/sim/battle/combat.js — Battle methods: damage, heal and HP loss (the guarded entry points of the attack.js
// pipeline), projectiles and forced attacks (ai.js performAttack).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import * as attack from '../attack.js';
import { legacyDamage, legacyHeal, legacyHPLose } from '../attack/legacy.js';
import { makeDamageInfo } from '../attack/helpers.js';
import { effectiveProfile, performAttack, acquireTargets } from '../ai.js';

export class BattleCombat {
	dealDamage(source, target, dmg, opts = {}) {
		try { return target === undefined ? attack.dealDamage(this, source) : legacyDamage(this, source, target, dmg, opts); } catch (e) { this._internalError('dealDamage', e); return 0; }
	}

	heal(source, target, amount, opts = {}) {
		try { return target === undefined ? attack.heal(this, source) : legacyHeal(this, source, target, amount, opts); } catch (e) { this._internalError('heal', e); return 0; }
	}

	dealHPLose(target, amount, opts = {}) {
		return amount === undefined ? attack.dealHPLose(this, target) : legacyHPLose(this, target, amount, opts);
	}

	healElement(target, amount, element = null) { return attack.healElement(this, amount === undefined ? target : { target, amount, element }); }

	dealElementDamage(request) { return attack.dealElementDamage(this, request); }

	/** @deprecated Use dealHPLose. */
	loseHp(target, amount, opts = {}) { return this.dealHPLose(target, amount, opts); }
	/** @deprecated Use healElement. */
	reduceElement(target, amount, element = null) { return this.healElement(target, amount, element); }

	makeDamage(d) { return makeDamageInfo(d); }

	addProjectile(p) { return this.projectiles.add(p); }

	// exposed for ai/content convenience
	effectiveProfile(u) { return effectiveProfile(u); }

	/**
	 * Perform an immediate attack with a unit's current profile (content: "立即攻击", extra attacks, counters). It is an
	 * attack in every respect (hooks, attack SP, a running ammo skill's bullet) — except with `noAmmo: true`: an extra
	 * attack that spends no ammo (no `ammoUsed`, the skill never ends on it; 圣约送葬人 "不额外消耗弹药").
	 * Returns true when an attack was made.
	 */
	forceAttack(u, targets = null, { noAmmo = false } = {}) {
		if (!u || !u.alive || !u.profile) return false;
		const prof = effectiveProfile(u);
		const t = targets ?? acquireTargets(this, u, prof);
		if (!t || !t.length) return false;
		const n0 = u.stats.attacks;
		performAttack(this, u, prof, t, noAmmo ? { noAmmo: true } : null);
		return u.stats.attacks > n0;
	}
}
