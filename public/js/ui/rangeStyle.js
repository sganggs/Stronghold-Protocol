// Battlefield range colours follow ability purpose, not operator profession.
// PRTS: 作战机制 / 攻击范围. UI palette values, not extracted client constants.
// [ASSUMED] No official client RGB for this remake's healing highlight. Cyan stays
// distinct from the orange attack range (0xff9c33).
export const HEAL_RANGE_COLOR = 0x33cfff; // [ASSUMED]
export const HEAL_STRIPE_COLOR = 0x8ae5ff; // [ASSUMED]

/** Normal healing ranges; damaging incantation medics remain orange. */
export function isHealingRange(record) {
  return record?.dmgType === 'heal' || record?.attackKind === 'heal';
}

/** Preserve the caller's highlight group and opacity. */
export function rangeStyle(style, healing = false) {
  return healing ? { ...style, color: HEAL_RANGE_COLOR, stripeColor: HEAL_STRIPE_COLOR } : style;
}
