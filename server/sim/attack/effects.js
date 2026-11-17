// PRTS 伤判效果: higher priority first, then the buff's actual acquisition order.
// Injury observers retain their ordered position even after a previous effect cancels the damage.
import { ignoresDamageCancellation } from './helpers.js';

export function injuryEffects(battle, target, amount, type, { dodgeMode = 'ignore', onDodge = null, onBlock = null, context = null } = {}) {
  let rest = amount;
  const after = [];
  let changed = false;
  let cancelled = false;
  let notifyZero = false;
  let outcome = amount > 0 ? null : 'zero';
  const blockUncancellable = ignoresDamageCancellation(context?.dmg, 'block');
  const invoke = (label, buff, fn) => battle._safe(() => {
    try { fn(); } catch (error) { battle._internalError(label, error); }
  }, label, buff.source ?? target);
  const succeeds = probability => probability === undefined || (Number.isFinite(probability) && probability > 0
    && battle.rng() < Math.min(1, probability));
  const block = probability => {
    if (cancelled || !(rest > 0) || !succeeds(probability)) return false;
    cancelled = !blockUncancellable;
    if (cancelled) { rest = 0; outcome = 'blocked'; }
    if (onBlock) onBlock(cancelled);
    return true;
  };
  const dodge = probability => {
    if (cancelled || !(rest > 0) || dodgeMode === 'ignore') return false;
    if (!succeeds(probability)) return false;
    const beforeDodge = rest;
    cancelled = dodgeMode !== 'uncancellable';
    if (cancelled) { rest = 0; outcome = 'dodged'; }
    if (onDodge) onDodge(cancelled, beforeDodge);
    return true;
  };
  const takenKey = type === 'phys' ? 'physTakenMul' : type === 'arts' ? 'artsTakenMul' : type === 'elemental' ? 'elementalTakenMul' : 'trueTakenMul';
  const buffs = target.buffs.filter(b => typeof b.injury === 'function' || typeof b.observeInjury === 'function' || b.damageReduction?.[type] > 0 || b.shieldHits > 0 || b.shield > 0 || b.mods?.dodgePhys > 0 || b.mods?.dodgeArts > 0
    || b.mods?.dmgTakenMul != null || b.mods?.[takenKey] != null).sort((a, b) => (b.injuryPriority ?? 0) - (a.injuryPriority ?? 0) || a.seq - b.seq);
  // PRTS 伤害减免: same-named reductions take the highest value independently for each HP damage type; differently
  // named ones stack. The name is the buff's `reductionGroup`, else its key; only the strongest of a name subtracts.
  const strongest = new Map();
  for (const buff of buffs) {
    const v = buff.damageReduction?.[type];
    if (!Number.isFinite(v) || !(v > 0)) continue;
    const name = buff.reductionGroup ?? buff.key;
    const held = strongest.get(name);
    if (!held || v > held.damageReduction[type]) strongest.set(name, buff);
  }
  const reductions = new Set(strongest.values());
  for (const buff of buffs) {
    // An earlier callback may have removed an effect from this instance's snapshot.
    if (!target.buffs.includes(buff)) continue;
    if (rest > 0 && !cancelled) {
      let consumed = false;
      const mod = key => Number.isFinite(buff.mods?.[key]) ? buff.mods[key] : 1;
      const multiplier = (type === 'elemental' ? 1 : mod('dmgTakenMul')) * mod(takenKey);
      for (let i = 0; i < buff.stacks; i++) rest *= multiplier;
      if (!Number.isFinite(rest) || rest < 0) rest = 0;
      if (reductions.has(buff)) rest = Math.max(0, rest - buff.damageReduction[type]);
      const absorbs = !buff.shieldType || (Array.isArray(buff.shieldType) ? buff.shieldType.includes(type) : buff.shieldType === type);
      const beforeShield = rest;
      if (rest > 0 && absorbs && buff.shieldHits > 0) {
        buff.shieldHits--;
        rest = 0;
        changed = consumed = true;
      } else if (rest > 0 && absorbs && buff.shield > 0) {
        const take = Math.min(buff.shield, rest);
        buff.shield -= take;
        rest -= take;
        if (buff.shield <= 1e-9) buff.shield = 0;
        changed = consumed = true;
      }
      if (consumed && !(rest > 0)) {
        // A full shield tries to cancel; a partial barrier merely reduces the amount. Only the former
        // is counteracted by the native block-cancellation mask, after consuming its count/pool.
        if (blockUncancellable) rest = beforeShield;
        else {
          cancelled = true;
          outcome = 'blocked';
          // Preserve legacy absorbed-zero bookkeeping independently of the cancellation state.
          notifyZero = true;
        }
        if (onBlock) onBlock(!blockUncancellable);
      }
      if (consumed && !buff.keepEmptyShield && !(buff.shield > 0) && !(buff.shieldHits > 0) && !buff.mods && !buff.flags && !buff.injury && !buff.observeInjury && !buff.damageReduction) {
        battle._removeBuffAt(target, target.buffs.indexOf(buff));
      }
      if (rest > 0 && typeof buff.injury === 'function') {
        const event = { ...context, battle, target, buff, amount: rest, type, dodge, block,
          defer: callback => { if (typeof callback === 'function') after.push(callback); } };
        invoke('injury', buff, () => buff.injury(event));
        rest = cancelled ? 0 : Number.isFinite(event.amount) ? Math.max(0, event.amount) : 0;
      }
      const probability = type === 'phys' ? buff.mods?.dodgePhys : type === 'arts' ? buff.mods?.dodgeArts : 0;
      // one roll per stack until one succeeds: a success under a cancellation mask cancels nothing, and a second one
      // would only repeat onDodge (another MISS, another 'dodge' hook) for the same hit (DESIGN §35.47)
      if (rest > 0 && !cancelled && probability > 0) for (let i = 0; i < buff.stacks; i++) {
        if (dodge(probability)) break;
      }
      if (!(rest > 0) && outcome == null) outcome = 'zero';
    }
    if (typeof buff.observeInjury === 'function') {
      // A value snapshot: observer writes cannot revive or change this instance's damage.
      const event = { ...context, battle, target, buff, amount: rest, type, cancelled, outcome };
      invoke('injury.observe', buff, () => buff.observeInjury(event));
    }
  }
  if (changed) target.markDirty();
  return { amount: rest, cancelled, outcome, notifyZero, after };
}

/** Complete deferred effect cleanup even when a later effect cancels the instance. */
export function settleEffects(battle, result, apply) {
  try { return result.cancelled && !result.notifyZero ? 0 : apply(result.amount); }
  finally {
    for (const callback of result.after) {
      try { callback(); } catch (error) { battle._internalError('injury.cleanup', error); }
    }
  }
}
