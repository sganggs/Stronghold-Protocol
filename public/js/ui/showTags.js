import { formatShowTags, garrisonShowTags, itemShowTags } from '../../../shared/showTags.js';

/**
 * Replace each {showtag_value_N} with values[N − 1] (an integer), else the matching fallback, else 0.
 * @param {string|null|undefined} text official rich text
 * @param {Array<number|null|undefined>|null|undefined} values live values (the server's)
 * @param {Array<number|null|undefined>|null|undefined} [fallback] the record's starting values
 * @returns {string}
 */
export function fillShowTags(text, values, fallback = null) {
  const slots = {};
  for (const [, key] of String(text ?? '').matchAll(/\{(showtag_value_\d+)\}/g)) {
    const i = Number(key.slice(14)) - 1;
    const live = Array.isArray(values) ? values[i] : values?.[key];
    const start = Array.isArray(fallback) ? fallback[i] : fallback?.[key];
    slots[key] = Number.isFinite(live) ? live : start;
  }
  return formatShowTags(text, slots);
}

/** An item record's starting values: 定期存折 → [params.value]. */
export const itemShowStart = rec => {
  const v = itemShowTags(rec);
  return v ? [v.showtag_value_1] : null;
};

export const garrisonShowStart = g => {
  const v = garrisonShowTags(g);
  return v ? [v.showtag_value_1] : null;
};

/** The text of an item record, its placeholders filled from the piece's live values (or the record's start). */
export const itemText = (rec, piece = null) => fillShowTags(rec?.descRaw || rec?.desc || '', piece?.showTag, itemShowStart(rec));

/** The text of a 特质 record, filled from the operator piece's `garrisonTags` (or the record's start). */
export const garrisonText = (g, piece = null) => fillShowTags(g?.descRaw || g?.desc || '', piece?.garrisonTags?.[g?.garrisonId], garrisonShowStart(g));
