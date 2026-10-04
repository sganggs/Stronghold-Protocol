// shared/highGround.js — which MELEE chess may stand on a 高台 (a ranged deploy tile).
//
// Owner's decision 2026-10-04, reversing DESIGN §22.6. The branch trait 「可以放置于远程位」 is written on
// every 钩索师 / 推击手 variant (歌蕾蒂娅, 崖心, 见行者, normal and elite) and is not trusted. Only elite
// 歌蕾蒂娅 carrying module HOK-Y 淡金坠饰 may use a ranged tile. 崖心 (HOK-X only), 见行者, a normal
// record, any other module, and no module are ground-only. The golden record is the elite (`isGolden`);
// the same module test applies to it. A missing module id is ground-only.

/** char_474_glady — 歌蕾蒂娅. */
export const GLADIIA_CHAR_ID = 'char_474_glady';
/** HOK-Y 淡金坠饰 (data/chess.json chess_char_4_12_b.modules, typeName HOK-Y). */
export const GLADIIA_HOK_Y = 'uniequip_003_glady';

/**
 * @param {object|null} rec a chess record (normal or golden)
 * @param {string|null|undefined} moduleId the equipped module (`resolveLoadout().moduleId`)
 * @returns {boolean}
 */
export function meleeOnHighGround(rec, moduleId) {
  return !!(rec && rec.isGolden === true && rec.charId === GLADIIA_CHAR_ID && moduleId === GLADIIA_HOK_Y);
}
