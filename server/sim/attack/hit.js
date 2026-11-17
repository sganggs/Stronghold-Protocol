// HP-damage pipeline: hit → calculation → limit → ordered injury effects → hpDamage → HP application.
import { sleepBlocks, liftoffEvades, damageDodgeMode } from './helpers.js';
import { leaderHitCancelled, applyHpDecrease } from './health.js';
import { applyElement } from './element.js';

export { mitigate } from './calculation.js';
import { attackInput, calculateBaseDamage, estimateTargetDamage, officialExpectedAmount } from './calculation.js';

import { injuryEffects, settleEffects } from './effects.js';
import { applyTransfers } from './transfer.js';

/**
 * Official red-number test (PRTS 作战机制 「伤害红字（暴击）」, https://prts.wiki/w/作战机制).
 * A red integer is shown when 最终伤害 ≥ 期望伤害 × 1.5. `1e-9` only absorbs a binary rounding crumb.
 * 0 ≥ 0 × 1.5 is red: an invulnerable hit still shows red 0 in the official client. This function reports that;
 * `dealDamage` does not emit a new event for it (a new `dmg` tuple would change golden counts and play an impact).
 * @returns {'r'|null}
 */
export function officialDamageMark(finalAmount, expectedAmount) {
  const fin = Number.isFinite(finalAmount) ? Math.max(0, finalAmount) : 0;
  const exp = Number.isFinite(expectedAmount) ? Math.max(0, expectedAmount) : 0;
  return fin + 1e-9 >= exp * 1.5 ? 'r' : null;
}

/**
 * Full damage pipeline. Returns HP actually removed, or gauge gain for element damage (0 when refused).
 */
export function resolveDamage(battle, ctx) {
  const { source, credit, target, dmg } = ctx;
  if (!target || !target.alive || target.removed || target.hidden || !target.deployed) return 0;
  if (dmg.type === 'element') return applyElement(battle, ctx);
  // 无来源 (dmg.sourceless, element bursts): hooks see no source — nothing keyed on "damage dealt by X" (ATK-up vs a
  // tag, 伤害提升 items / bonds / modules, reflect, "受到来自…的伤害") can recognise it; `credit` names the unit that still
  // gets the stats and the kill (PRTS 伤害分类 无来源 ③)
  const hs = source;
  let ts = target.s;
  if (ts.flags.invulnerable || sleepBlocks(target, hs, dmg) || liftoffEvades(target, hs, dmg)) return 0;
  if (battle._hooks.hit) {
    battle.emit('hit', { source: hs, target, dmg, credit });
    if (dmg.cancel || !target.alive || !target.deployed) return 0;
    if (dmg.type === 'element') return applyElement(battle, ctx);
    ts = target.s; // handlers may have changed the target's buffs (fragile, invulnerable, dodge…): never use stale stats
    if (ts.flags.invulnerable || sleepBlocks(target, hs, dmg)) return 0;
  }
  // PRTS 伤害分类: precomputed damage omits the source calculation event; resolved damage omits calculation.
  // Target-side pre-calculation effects remain part of computing a precomputed ATK input (e.g. Logos's mark).
  if (dmg.calculation !== 'resolved') {
    if (source && dmg.calculation !== 'precomputed' && battle._hooks.damageCalculate) {
      battle.emit('damageCalculate', { ...ctx });
      if (dmg.cancel || !target.alive || !target.deployed) return 0;
    }
    if (battle._hooks.damageCalculateTarget) {
      battle.emit('damageCalculateTarget', { ...ctx });
      if (dmg.cancel || !target.alive || !target.deployed) return 0;
    }
    if (dmg.type === 'element') return applyElement(battle, ctx);
    ts = target.s;
    dmg.amount = attackInput(dmg.amount, dmg.type, ts);
    if (ts.flags.invulnerable || sleepBlocks(target, source, dmg)) return 0;
  }
  const type = dmg.type;
  const dodgeMode = damageDodgeMode(dmg);
  const effects = amount => injuryEffects(battle, target, amount, type, { dodgeMode, context: ctx, onDodge(cancelled, amount) {
    const red = cancelled && officialDamageMark(amount, expected) === 'r';
    battle.fx('dodge', red ? { x: target.x, y: target.y, id: target.id, num: 'm' } : { x: target.x, y: target.y, id: target.id });
    if (battle._hooks.dodge) battle.emit('dodge', { source, target, dmg, credit, cancelled });
  }, onBlock(cancelled) {
    if (battle._hooks.block) battle.emit('block', { source, target, dmg, credit, cancelled });
  } });
  // 无来源 damage (element bursts) takes nothing from its source's stats; the source still gets the credit below
  const ss = source ? source.s : null;
  let final = calculateBaseDamage(dmg, type, ts, ss, target);
  // Keep the penetration-free expectation separate from the final ordered injury/HP-guard result.
  if (battle._hooks.damageOutput) {
    const calculated = { ...ctx, amount: final };
    battle.emit('damageOutput', calculated);
    final = Number.isFinite(calculated.amount) ? Math.max(0, calculated.amount) : 0;
    if (dmg.cancel || !target.alive || !target.deployed) return 0;
  }
  const expected = officialExpectedAmount(dmg, type, ts, target);
  // Source ON_BEFORE_TARGET_APPLY_MODIFIER follows calculation/output but precedes target injury.
  // Attribute changes here affect later instances; the already calculated damage is not recalculated.
  if (source && battle._hooks.damageBeforeApply) {
    const applying = { ...ctx, amount: final };
    battle.emit('damageBeforeApply', applying);
    final = Number.isFinite(applying.amount) ? Math.max(0, applying.amount) : 0;
    if (dmg.cancel || !target.alive || !target.deployed) return 0;
    ts = target.s;
  }
  // Target ON_APPLYING_MODIFIER (damage only), including source-less instances, before ON_TAKE_DAMAGE.
  if (battle._hooks.damageApplying) {
    const applying = { ...ctx, amount: final };
    battle.emit('damageApplying', applying);
    final = Number.isFinite(applying.amount) ? Math.max(0, applying.amount) : 0;
    if (dmg.cancel || !target.alive || !target.deployed) return 0;
    ts = target.s;
  }
  const estimate = estimateTargetDamage(final, type, ts);
  // 限伤 cancels the whole hit. [ASSUMED] Its position relative to native injury effects is unverified; use one
  // pre-injury check for every shield kind (research 12 S43), preserving earlier attack/hit/gauge effects.
  if (estimate > 0 && leaderHitCancelled(battle, target, estimate)) return 0;
  return settleEffects(battle, effects(final), amount => applyDamage(battle, ctx, amount, expected));
}

/** After ordered injury effects: HP guards and transfers, then shared HP bookkeeping. */
function applyDamage(battle, ctx, final, expected) {
  const { source, target, dmg, credit } = ctx;
  if (final > 0 && battle._hooks.hpDamage) {
    const hctx = { source, target, amount: final, dmg, credit };
    battle.emit('hpDamage', hctx);
    if (Number.isFinite(hctx.amount)) final = Math.max(0, Math.min(final, hctx.amount));
    applyTransfers(battle, hctx);
  }
  return applyHpDecrease(battle, ctx, final, officialDamageMark(final, expected));
}
