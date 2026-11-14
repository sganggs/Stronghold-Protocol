// public/js/ui/showTags.js — the numbers of the official {showtag_value_N} placeholders (§37.201). 规程's 定期存折 and some
// 特质 write a running value into their text; the server sends the player's own pieces' values (server/match/showTags.js:
// piece `showTag`, operator `garrisonTags[garrisonId]`), and everything else — a shop card, the loadout screen, another
// player's piece — shows the record's starting value: the passbook's `value` (0: it grows while held), an upgrading 特质's
// first grant (`count`), a round counter's 0. Never the raw placeholder (the owner's report of 2026-11-14:
// 「装备定期存折的文案错误的把函数写进去了」).

const SHOW_TAG = /\{showtag_value_(\d+)\}/g;

const num = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);

/**
 * Replace each {showtag_value_N} with values[N − 1] (an integer), else the matching fallback, else 0.
 * @param {string|null|undefined} text official rich text
 * @param {Array<number|null|undefined>|null|undefined} values live values (the server's)
 * @param {Array<number|null|undefined>|null|undefined} [fallback] the record's starting values
 * @returns {string}
 */
export function fillShowTags(text, values, fallback = null) {
  if (text == null) return '';
  const s = String(text);
  if (!s.includes('{showtag_value_')) return s;
  return s.replace(SHOW_TAG, (_, n) => {
    const i = Number(n) - 1;
    const live = Array.isArray(values) ? num(values[i]) : null;
    if (live != null) return String(live);
    const start = Array.isArray(fallback) ? num(fallback[i]) : null;
    return String(start ?? 0);
  });
}

/** An item record's starting values: 定期存折 → [params.value]. */
export function itemShowStart(rec) {
  return Array.isArray(rec?.buffs) && rec.buffs.some((b) => b && b.key === 'equip_destory_gain_coin') ? [num(rec.params?.value) ?? 0] : null;
}

/** A 特质 record's starting values: an upgrading one's first grant (`count`); the round counters start at 0. */
export function garrisonShowStart(g) {
  if (g?.effectKey === 'SERVER_ADD_BOND_UPGRADE_LAYER' || g?.effectKey === 'SERVER_GAIN_FREE_REFRESH_UPGRADE_COUNT') return [num(g.bb?.count) ?? 0];
  return null;
}

/** The text of an item record, its placeholders filled from the piece's live values (or the record's start). */
export const itemText = (rec, piece = null) => fillShowTags(rec?.descRaw || rec?.desc || '', piece?.showTag, itemShowStart(rec));

/** The text of a 特质 record, filled from the operator piece's `garrisonTags` (or the record's start). */
export const garrisonText = (g, piece = null) => fillShowTags(g?.descRaw || g?.desc || '', piece?.garrisonTags?.[g?.garrisonId], garrisonShowStart(g));
