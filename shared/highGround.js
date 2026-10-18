// shared/highGround.js — which MELEE chess may stand on a 高台 (a ranged deploy tile).
//
// The owner's decision of 2026-10-05, reversing the one of 2026-10-04 (elite 歌蕾蒂娅 with HOK-Y only): follow PRTS. A
// MELEE chess whose trait reads 「可以放置于远程位」 may stand on a 高台 as well as on the ground. The line is the 钩索师 /
// 推击手 branch trait (PRTS 歌蕾蒂娅 · 特性, raised with the PRTS source in PR #69 by @sunstricken; PRTS 新人入门: both
// branches "可部署在高台和地面"): 歌蕾蒂娅, 崖心 and 见行者, normal and elite, and the 自选 推击手 温蒂. It is the branch's
// own text, not a module effect — every module of the three keeps it — so the loadout does not matter: any module, or
// none. The text read is the record's trait without a module (`traitBase`, which an elite with modules carries; else
// `trait`). build-data stores that Chinese reading as `placeOnRanged` (GitHub #676): the client looks up the localized
// record, and en / ja / ko / zh-TW (which writes 於) no longer contain the Simplified line. A module talent such as the
// 教官's Y module ("可以额外部署在远程位") is a 部署效果, which 卫戍协议 switches off (PRTS 卫戍协议/帮助 §战斗部署), and
// is not read. The battle keeps position MELEE: on a 高台 the unit attacks and blocks nothing.

/** The trait line that lets a MELEE chess stand on a ranged (高台) tile. */
export const PLACE_ON_RANGED = '可以放置于远程位'; // i18n-ignore: matched against the data's trait text

/**
 * The record's trait text without a module ('' when it has none).
 * @param {object|null} rec a chess record
 * @returns {string}
 */
export function baseTraitText(rec) {
  const t = rec ? rec.traitBase || rec.trait : null;
  return t && typeof t.desc === 'string' ? t.desc : '';
}

/**
 * Whether a MELEE chess record may also stand on a 高台. Normal or elite, any module.
 * The build-time flag `placeOnRanged` is the Chinese trait without a module (tools/build-data.mjs). It is what a
 * localized record still carries after the overlay replaces the trait text (GitHub #676). A record without the flag —
 * the Chinese data before the flag, or a plugin record — still matches the Simplified line.
 * [ASSUMED] A plugin may set `placeOnRanged: true` without that line. The compact expander copies a MELEE form's
 * `true` onto the built form (`shared/plugins/records.js`). A record with neither the flag nor the line
 * stays ground-only, including a plugin whose trait text is only a translation.
 * @param {object|null} rec a chess record (normal or golden)
 * @returns {boolean}
 */
export function meleeOnHighGround(rec) {
  if (!rec || rec.position !== 'MELEE') return false;
  if (rec.placeOnRanged === true) return true;
  return baseTraitText(rec).includes(PLACE_ON_RANGED);
}
