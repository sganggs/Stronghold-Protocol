// shared/highGround.js — which MELEE chess may stand on a 高台 (a ranged deploy tile).
//
// 歌蕾蒂娅's 「可以放置于远程位」 is a base 钩索师 trait, not a module effect.
// Normal / elite forms and every loadout keep this placement permission.
// This correction covers 歌蕾蒂娅 in the current roster; other operators' rules are unchanged.
// Do not read moduleDesc: deployment effects added by modules (e.g. 教官 Y) do not apply to prep.
// PRTS: https://prts.wiki/w/歌蕾蒂娅 (特性), https://prts.wiki/w/卫戍协议/帮助 (战斗部署).

/** char_474_glady — 歌蕾蒂娅. */
export const GLADIIA_CHAR_ID = 'char_474_glady';
/** HOK-Y 淡金坠饰 (data/chess.json chess_char_4_12_b.modules, typeName HOK-Y). */
export const GLADIIA_HOK_Y = 'uniequip_003_glady';

/**
 * @param {object|null} rec a chess record (normal or golden)
 * @returns {boolean}
 */
export function meleeOnHighGround(rec) {
  return !!(rec && rec.charId === GLADIIA_CHAR_ID && rec.position === 'MELEE' && typeof rec.trait?.desc === 'string'
    && rec.trait.desc.includes('可以放置于远程位'));
}
