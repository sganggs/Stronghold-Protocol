// Compose a localized bond's display from the effect the battle actually uses.
// Never mutate the shared data records: two players may show different variants of the same bond.
import { formatBondEffect } from './richText.js';

/**
 * @param {any} bond
 * @param {any} effect
 * @param {number} [layers]
 */
export function bondEffectRecord(bond, effect, layers = 0) {
  if (!bond || !effect || effect.effectType !== 'BOND') return bond;
  // The bond's own effect is already the display record. Overlaying effect.params would replace bb
  // on every season, including when params is an empty object.
  if (effect.effectId === bond.effectId) return bond;
  const record = {
    ...bond,
    effectId: effect.effectId,
    effectDesc: effect.desc,
    effectDescRaw: effect.descRaw,
    effectDescParams: effect.effectDescParams || [],
    bb: effect.params && typeof effect.params === 'object' ? effect.params : bond.bb,
    thresholds: effect.displayThresholds || bond.thresholds,
  };
  // The replacement includes every threshold clause. Do not leave the base bond text under it.
  record.desc = record.descRaw = formatBondEffect(record, layers);
  return record;
}
