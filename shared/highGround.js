// shared/highGround.js — which MELEE chess may stand on a 高台 (a ranged deploy tile).
//
// 歌蕾蒂娅's branch trait allows ranged tiles in both normal and elite forms (#187).
// This is not a module effect: HOK-X, HOK-Y, no module and the default all permit it.
// Other operators retain their existing placement rules; this fix is scoped to 歌蕾蒂娅.

/** char_474_glady — 歌蕾蒂娅. */
export const GLADIIA_CHAR_ID = 'char_474_glady';
/** HOK-Y 淡金坠饰 (data/chess.json chess_char_4_12_b.modules, typeName HOK-Y). */
export const GLADIIA_HOK_Y = 'uniequip_003_glady';

/**
 * @param {object|null} rec a chess record (normal or golden)
 * @returns {boolean}
 */
export function meleeOnHighGround(rec) {
  return !!(rec && rec.charId === GLADIIA_CHAR_ID);
}
