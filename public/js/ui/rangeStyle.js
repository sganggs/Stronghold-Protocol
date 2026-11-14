// Battlefield range colours follow ability purpose, not operator profession.
// PRTS: 作战机制 / 攻击范围. UI palette values, not extracted client constants.
export const HEAL_RANGE_COLOR = 0x33cfff;
export const HEAL_STRIPE_COLOR = 0x8ae5ff;

/** Normal healing ranges; damaging incantation medics remain orange. */
export function isHealingRange(record) {
  return record?.dmgType === 'heal' || record?.attackKind === 'heal';
}

/** Preserve the caller's highlight group and opacity. */
export function rangeStyle(style, healing = false) {
  return healing ? { ...style, color: HEAL_RANGE_COLOR, stripeColor: HEAL_STRIPE_COLOR } : style;
}
