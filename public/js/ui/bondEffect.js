// Compose a localized bond's display from the authoritative effect identity of its owner.
// Never mutate the shared data records: two players may use different variants of the same bond.
import { formatBondEffect } from './richText.js';

/** @param {any} bond @param {any} effect @param {number} [layers] */
export function bondEffectRecord(bond, effect, layers = 0) {
  if (!bond || !effect || effect.effectType !== 'BOND') return bond;
  const record = {
    ...bond,
    effectId: effect.effectId,
    effectDesc: effect.desc,
    effectDescRaw: effect.descRaw,
    effectDescParams: effect.effectDescParams || bond.effectDescParams,
    bb: effect.params || bond.bb,
    thresholds: effect.displayThresholds || bond.thresholds,
  };
  if (effect.effectId !== bond.effectId) {
    // The complete replacement effect includes every threshold; do not leave the base six-person clause below it.
    record.desc = record.descRaw = formatBondEffect(record, layers);
  }
  return record;
}
