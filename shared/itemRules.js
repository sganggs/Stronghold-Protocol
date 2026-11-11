// shared/itemRules.js — item restrictions the official text states and the match enforces.
// Pure ESM: the data build, the server and the browser share one predicate.

/** Official sentences 「无法装备给自编干员」 (later seasons) and 「无法装备给自选干员」 (act1). */
export const NO_DIY_RE = /无法装备给自[编选]干员/;

/**
 * Whether an item's Chinese effect text forbids a 自选 / 自编 carrier.
 * @param {unknown} desc
 * @param {unknown} descRaw
 * @returns {boolean}
 */
export function itemTextForbidsDiy(desc, descRaw) {
  return NO_DIY_RE.test(typeof desc === 'string' ? desc : '') || NO_DIY_RE.test(typeof descRaw === 'string' ? descRaw : '');
}

/**
 * Whether this item must not be equipped on a 自选 operator.
 * `noDiy` is the build-time flag (it survives a locale overlay). The text check covers data built before the flag
 * and a plugin item that copies the official sentence into its Chinese description.
 * @param {any} item
 * @returns {boolean}
 */
export function itemForbidsDiy(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.noDiy === true) return true;
  return itemTextForbidsDiy(item.desc, item.descRaw);
}

/**
 * A chess record that is a 自选 slot or a composed 自选 piece (`diyFor` is the slot).
 * @param {any} rec
 * @returns {boolean}
 */
export function chessIsDiy(rec) {
  return !!(rec && (rec.isDiy === true || typeof rec.diyFor === 'string'));
}
