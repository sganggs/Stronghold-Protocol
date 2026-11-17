// server/sim/battle/combat.js — Battle methods: damage, heal and HP loss (the guarded entry points of the attack.js
// pipeline), projectiles and forced attacks (ai.js performAttack).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import * as attack from '../attack.js';
import { legacyDamage, legacyHeal, legacyHPLose } from '../attack/legacy.js';
import { effectiveProfile, performAttack, acquireTargets } from '../ai.js';

export class BattleCombat {
  /** @overload
   * @param {import('../../../types/attack.js').DamageRequest} request
   * @returns {number}
   */
  /** Legacy positional signature; prefer dealDamage({source, target, amount, type, credit}).
   * @overload
   * @param {object|null} source
   * @param {object} target
   * @param {object} dmg
   * @param {object} [opts]
   * @returns {number}
   */
  dealDamage(source, target = undefined, dmg = undefined, opts = {}) {
    try { return arguments.length === 1 ? attack.dealDamage(this, source) : legacyDamage(this, source, target, dmg, opts); } catch (e) { this._internalError('dealDamage', e); return 0; }
  }

  /** @overload
   * @param {import('../../../types/attack.js').HealRequest} request
   * @returns {number}
   */
  /** Legacy positional signature; prefer heal({source, target, amount, mode}).
   * @overload
   * @param {object|null} source
   * @param {object} target
   * @param {number} amount
   * @param {object} [opts]
   * @returns {number}
   */
  heal(source, target = undefined, amount = undefined, opts = {}) {
    try { return arguments.length === 1 ? attack.heal(this, source) : legacyHeal(this, source, target, amount, opts); } catch (e) { this._internalError('heal', e); return 0; }
  }

  /** @overload
   * @param {import('../../../types/attack.js').HPLossRequest} request
   * @returns {number}
   */
  /** Legacy positional signature; prefer dealHPLose({source, credit, target, amount, type}). The same path: `opts.type`
   * 'phys' / 'arts' takes the target's DEF / RES, 'true' (the default) is an amount the caller already mitigated.
   * @overload
   * @param {object} target
   * @param {number} amount
   * @param {object} [opts]
   * @returns {number}
   */
  dealHPLose(target, amount = undefined, opts = {}) {
    try { return arguments.length === 1 ? attack.dealHPLose(this, target) : legacyHPLose(this, target, amount, opts); } catch (e) { this._internalError('dealHPLose', e); return 0; }
  }

  /** @overload
   * @param {import('../../../types/attack.js').ElementHealRequest} request
   * @returns {number}
   */
  /** Legacy positional signature; prefer healElement({target, amount, element}).
   * @overload
   * @param {object} target
   * @param {number} amount
   * @param {string|null} [element]
   * @returns {number}
   */
  healElement(target, amount = undefined, element = null) {
    try { return attack.healElement(this, arguments.length === 1 ? target : { target, amount, element }); } catch (e) { this._internalError('healElement', e); return 0; }
  }

  /** @param {import('../../../types/attack.js').ElementDamageRequest} request */
  dealElementDamage(request) {
    try { return attack.dealElementDamage(this, request); } catch (e) { this._internalError('dealElementDamage', e); return 0; }
  }

  /** @deprecated Use dealHPLose. */
  loseHp(target, amount, opts = {}) { return this.dealHPLose(target, amount, opts); }
  /** @deprecated Use healElement. */
  reduceElement(target, amount, element = null) { return this.healElement(target, amount, element); }

  makeDamage(d) { return attack.makeDamageInfo(d); }

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
