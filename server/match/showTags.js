// server/match/showTags.js — the live numbers behind the official cards' {showtag_value_N} placeholders (§37.201).
// 规程's tables write a running value into some texts — 定期存折 "装备时销毁，获得{showtag_value_1}资金（持有时每回合+1）",
// the 特质 of 风絮 / 可露希尔 / 夕 "本回合每获得过一名干员(已获得{showtag_value_1}名)", 安洁莉娜 "(已刷新{showtag_value_1}次)",
// 溯光星源 "(已消耗{showtag_value_1}资金)", 极光 "【谢拉格】层数+{showtag_value_1}（每次触发后升级…）", 忍冬 "获得
// {showtag_value_1}次免费刷新（触发2次后升级…）" — that the client cannot know: the passbook's growth, the round's
// counters, an upgrading 特质's next grant. The owner saw the raw placeholder on the 定期存折 card (2026-11-14 「装备定期存折的文案错误的把函数写进去了」).
// The player's own piece views carry the values (player/views.js pieceView: `showTag` on an item, `garrisonTags` keyed by
// garrison id on an operator); records without such a text add nothing, so every other version's views stay as they
// were. Presentation only: never advances a counter. A shop card or a catalog entry shows the record's starting value
// (public/js/ui/showTags.js).

import { upgradeGive } from '../sim/content/garrisons/meta.js';

const SHOW_TAG = /\{showtag_value_\d+\}/;

/** Does an official text carry a {showtag_value_N} placeholder? */
export const hasShowTag = (text) => typeof text === 'string' && SHOW_TAG.test(text);

const int = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

/**
 * An item piece's values: 定期存折 pays its `value` plus what it grew while held (builtinMeta.js equip_destory_gain_coin /
 * passbook_hold: the counter `passbook:<uid>`).
 * @param {any} ps PlayerState
 * @param {{ id: string, uid: number }} item
 * @returns {number[]|undefined}
 */
export function itemShowTags(ps, item) {
  const rec = ps.gd.item(item.id);
  if (!rec || !hasShowTag(rec.descRaw || rec.desc)) return undefined;
  if (Array.isArray(rec.buffs) && rec.buffs.some((b) => b && b.key === 'equip_destory_gain_coin')) {
    return [int(rec.params?.value) + int(ps.counters[`passbook:${item.uid}`])];
  }
  return undefined;
}

/**
 * One 特质's value, read the way its handler (server/sim/content/garrisons/meta.js) counts: the round's operators gained
 * (add_method round_gain_char), refreshes, funds spent, or what an upgrading 特质's next trigger grants. null: no value
 * known for that effect (the text keeps the record's starting value on the client).
 */
function garrisonValue(ps, piece, g) {
  const r = ps.round || {};
  switch (g.effectKey) {
    case 'SERVER_ADD_BOND_METHOD': return g.bbStr?.add_method === 'round_gain_char' ? int(r.gainedChess) : null;
    case 'SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER': return int(r.refreshes);
    case 'SERVER_ADD_BOND_ROUND_COIN_COST': return int(r.spent);
    case 'SERVER_ADD_BOND_UPGRADE_LAYER':
    case 'SERVER_GAIN_FREE_REFRESH_UPGRADE_COUNT': return upgradeGive(piece.meta?.gar?.[g.garrisonId], g.bb || {});
    default: return null;
  }
}

/**
 * An operator piece's 特质 values, keyed by garrison id.
 * @param {any} ps PlayerState
 * @param {{ id: string, meta?: any }} piece
 * @returns {Record<string, number[]>|undefined}
 */
export function garrisonShowTags(ps, piece) {
  const rec = ps.gd.chess(piece.id);
  if (!rec || !Array.isArray(rec.garrisonIds)) return undefined;
  let out;
  for (const gid of rec.garrisonIds) {
    const g = ps.gd.garrison(gid);
    if (!g || !hasShowTag(g.descRaw || g.desc)) continue;
    const v = garrisonValue(ps, piece, g);
    if (v == null) continue;
    (out ||= {})[gid] = [v];
  }
  return out;
}
