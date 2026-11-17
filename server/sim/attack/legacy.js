// Compatibility boundary for existing positional Battle calls. New code uses attack.js object requests.
import { makeDamageInfo } from './helpers.js';
import { resolveDamage } from './hit.js';
import { loseHp } from './health.js';
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

/**
 * The positional HP loss: `type` as in the object request (attack.js dealHPLose) — 'true' by default, an amount the
 * caller already mitigated, which is never mitigated again; 'phys' / 'arts' take the target's DEF / RES (attack/health.js
 * loseHp, the one path of both forms).
 */
export function legacyHPLose(battle, target, amount, { source = null, silent = false, tags = [], from = null, sourceless = false, noHitLimit = false, type = 'true' } = {}) {
  if (!['phys', 'arts', 'true'].includes(type)) throw new TypeError('HP loss supports phys, arts or true');
  const dmg = { type, tags: [...new Set(['hpLoss', ...(from?.tags ?? []), ...(tags ?? [])])], noSp: true,
    silent, origin: from, sourceless: !!sourceless || !!from?.sourceless };
  return loseHp(battle, { source: dmg.sourceless ? null : source, credit: source, target, dmg }, amount, { noHitLimit });
}
