// ui/gameLogic/bonds.js — bond counts, members, harmony, 本局禁用. Re-exported from ../gameLogic.js.

import { int, isObj } from './shared.js';
import { diyPicks } from './diy.js';
import { t } from '../../../../shared/i18n.js';
import { grantedBondsByMorph } from '../../../../shared/plugins/rules.js';


// ---- bonds -------------------------------------------------------------------------------------------

/**
 * Sort bonds for the strip: active first, then layers desc, count desc, tier desc, core first, id; the mode-off bonds
 * (`off`: the server's entries for the bonds this mode never activates that the player has members of —
 * server/match/bondsMeta.js offBondCounts) after all the others.
 * @template {{bondId:string, active?:boolean, layers?:number, count?:number, tier?:number, off?:boolean}} B
 * @param {B[]} bonds
 * @param {(id:string)=>any} [getBond]
 * @returns {B[]}
 */
export function sortBonds(bonds, getBond = () => null) {
  const list = (Array.isArray(bonds) ? bonds : []).filter((b) => isObj(b) && typeof b.bondId === 'string');
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return [...list].sort((a, b) => (
    (a.off ? 1 : 0) - (b.off ? 1 : 0)
    || (b.active ? 1 : 0) - (a.active ? 1 : 0)
    || n(b.layers) - n(a.layers)
    || n(b.count) - n(a.count)
    || n(b.tier) - n(a.tier)
    || (getBond(b.bondId)?.isCore ? 1 : 0) - (getBond(a.bondId)?.isCore ? 1 : 0)
    || (a.bondId < b.bondId ? -1 : a.bondId > b.bondId ? 1 : 0)
  ));
}

/**
 * Tier reached for a member count against ascending thresholds (downward bonds: active while count ≤ max).
 * @param {number} count
 * @param {number[]} thresholds
 * @param {number|null} [maxCount]
 */
export function bondTier(count, thresholds, maxCount = null) {
  const c = Number.isFinite(count) ? count : 0;
  if (Number.isFinite(maxCount) && c > maxCount) return 0;
  let t = 0;
  for (const th of Array.isArray(thresholds) ? thresholds : []) if (c >= th) t += 1;
  return t;
}

/** Next threshold above the count, or null when maxed. */
export function nextThreshold(count, thresholds) {
  for (const th of Array.isArray(thresholds) ? thresholds : []) if (count < th) return th;
  return null;
}

/**
 * Bonds granted by 变形同构体: an item with `canGiveBond` worn together with an item that has a `giveBondId` makes the
 * wearer a member of that other item's bond (band 变形者集群 "与特定装备一同装备时装备者将视为特定盟约成员"; the item's
 * talent, character_table trap_1073_acarm073, lists the 14 pairings). The same rule as the server's count
 * (server/match/bondsMeta.js pieceBonds) and the battle's (server/sim/content/support unitBonds).
 * `mode` 'plus' is the room's morphPairing rule (shared/plugins/rules.js): one item is enough and only the leftmost
 * giveBondId grants. Omitted, the official rule (two items, every other giveBondId).
 * @param {Array<string|{id:string}>|null|undefined} items the carried items (ids or { id } pieces)
 * @param {(id:string)=>any} [getItem] items.json lookup
 * @param {'official'|'plus'} [mode]
 * @returns {string[]}
 */
export function grantedBonds(items, getItem = () => null, mode = 'official') {
  return grantedBondsByMorph(items, (id) => {
    const rec = getItem(id);
    return isObj(rec) ? rec : null;
  }, { mode });
}

/**
 * A chess piece's bonds: its record's + those its 变形同构体 pairing grants (grantedBonds) — the detail card's chips.
 * @param {any} chess chess.json record @param {Array<string|{id:string}>|null|undefined} items @param {(id:string)=>any} [getItem]
 * @param {'official'|'plus'} [mode] morphPairing (default official)
 * @returns {string[]}
 */
export function pieceBondIds(chess, items, getItem = () => null, mode = 'official') {
  const out = (Array.isArray(chess?.bonds) ? chess.bonds : []).filter((b) => typeof b === 'string');
  for (const b of grantedBonds(items, getItem, mode)) if (!out.includes(b)) out.push(b);
  return out;
}

/**
 * The 变形同构体 pairings — the list its 天赋栏 shows (the item text: "具体对应关系可在模拟中查看本装备天赋栏"; character_table
 * trap_1073_acarm073 "“炎国短刀”→【炎】盟约 …", 14 bonds; GitHub issue #1: without it the item read as doing nothing).
 * Built from the same `giveBondId` the server counts with (server/match/bondsMeta.js pieceBonds, grantedBonds here): every
 * bond an item grants, in bonds.json order, with the items that grant it (one entry per item family — the normal and 进阶
 * copies share a name —, by tier, then data order). `off`: the mode never activates the bond (modeOffBonds: 本局禁用 — 标准
 * leaves 5 of the 14 off). `worn`: the wearer's items (`carried`, the card shows the 变形同构体 on an operator) pair it with
 * one of the bond's items — the pairing in effect on that operator (that item `worn` too).
 * @param {Iterable<any>} itemRecs items.json records (data.list('items'))
 * @param {Iterable<any>} bondRecs bonds.json records in data order (data.list('bonds'))
 * @param {{ off?: Set<string>|null, carried?: Array<string|{id:string}>|null, mode?: 'official'|'plus' }} [opts]
 * @returns {Array<{ bondId: string, name: string, off: boolean, worn: boolean, items: Array<{ id: string, name: string, worn: boolean }> }>}
 */
export function morphPairings(itemRecs, bondRecs, { off = null, carried = null, mode = 'official' } = {}) {
  const recs = [...(itemRecs || [])].filter(isObj);
  const byId = new Map(recs.map((r) => [r.id, r]));
  const getItem = (id) => byId.get(id) || null;
  const worn = new Set(grantedBonds(carried, getItem, mode));
  const carriedIds = new Set((Array.isArray(carried) ? carried : []).map((it) => (typeof it === 'string' ? it : it?.id)).filter((x) => typeof x === 'string'));
  const famOf = (r) => (typeof r.baseId === 'string' && r.baseId ? r.baseId : r.id);
  /** bondId → family id → { id, name, tier, order, ids } */
  const groups = new Map();
  recs.forEach((r, order) => {
    if (r.canGiveBond || typeof r.giveBondId !== 'string' || !r.giveBondId) return;
    let g = groups.get(r.giveBondId);
    if (!g) groups.set(r.giveBondId, (g = new Map()));
    const fam = famOf(r);
    const e = g.get(fam);
    if (e) { e.ids.push(r.id); return; }
    g.set(fam, { id: fam, name: typeof r.name === 'string' && r.name ? r.name : fam, tier: int(r.tier, 99), order, ids: [r.id] });
  });
  const out = [];
  for (const b of bondRecs || []) {
    const g = isObj(b) ? groups.get(b.bondId) : null;
    if (!g) continue;
    const bondWorn = worn.has(b.bondId);
    const items = [...g.values()].sort((x, y) => (x.tier - y.tier) || (x.order - y.order))
      .map((e) => ({ id: e.id, name: e.name, worn: bondWorn && e.ids.some((id) => carriedIds.has(id)) }));
    out.push({ bondId: b.bondId, name: typeof b.name === 'string' && b.name ? b.name : b.bondId, off: !!(off && typeof off.has === 'function' && off.has(b.bondId)), worn: bondWorn, items });
  }
  return out;
}

/**
 * Bond id of 调和 (bonds.json maniShip, "激活时使场上核心盟约的激活人数+1") — server/match/bondsMeta.js HARMONY_BOND; a test
 * pins the two. Only to name the 调和 operators: whether a bond's count holds the +1 is the server's word (the view
 * entry's `harmony`, DESIGN §21.26).
 */
export const HARMONY_BOND = 'maniShip';

/**
 * The 调和 operators on a board, distinct (normal and elite copies of one operator once): who activates the +1 a bond
 * entry's `harmony` reports (the bond popup's 调和 row names them — 缪尔赛思, the Pith strategy's 盟约·辅助干员).
 * @param {any} priv m.private — or a teammate's field operators (ui/watchBonds.js ownerBoard)
 * @param {(id:string)=>any} [getChess]
 * @returns {Array<{ id: string, name: string }>} base chess ids
 */
export function harmonyMembers(priv, getChess = () => null) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(priv?.board) ? priv.board : []) {
    if (p?.kind !== 'chess') continue;
    const c = getChess(p.id);
    if (!Array.isArray(c?.bonds) || !c.bonds.includes(HARMONY_BOND)) continue;
    const base = c.baseId || (typeof p.id === 'string' ? p.id.replace(/_b$/, '_a') : p.id);
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ id: base, name: getChess(base)?.name || c.name || base });
  }
  return out;
}

/**
 * Member rows of a bond popup: every visible member with owned / on-board / in-hand / banned state, plus the player's
 * operators that are members through 变形同构体 (grantedBonds; `granted: true` and `items`: the item ids of the copy that
 * wears the pair — the card the row opens shows them; one row per operator — normal and elite copies are one member,
 * like the count's distinct members), so "成员 x/y" agrees with the count the server reports (在场; memberHeadCount).
 * 0.2.0 自选编队: the 自选 pieces of the bond (a DIY slot filled with an operator, whose bonds come from its factions — the
 * own pieces through `getChess` (gameLogic/diy.js diyGetter), a teammate's through `pieceRecord` (its UnitInfo `diy`
 * pick) are rows too (`diy: true`, the operator's name and record `rec`: its normal form, one row per slot like a
 * member's; `pick`: a teammate's piece's pick — the card the row opens composes the operator from it). Since 0.2.1
 * (the owner's report of 2026-10-07 「自选编队的干员在局内对应盟约展开的名单里没有显示出来」) every 自选 pick of the
 * player (m.private.diy: the V and VI slots) is a row of each bond its operator carries, owned or not — an unowned one
 * (not bought, or not in the shop yet: the slot's 调度中心 level) dimmed like an unowned member, one whose bonds are all
 * off this match (m.private.diyBanned: no stock, it never shows in the shop) `banned` like a banned member. A
 * teammate's board carries no picks (m.public sends none): their 自选 pieces on the field only.
 * `inHand`: in the 整备区 (hand), not the 5 temporary slots — what BOARD_AND_DECK bonds (投资人 远见 奇迹) count.
 * @param {any} bond bonds.json record
 * @param {any} priv m.private (hand/board/temp, the 自选 picks `diy` / `diyBanned`) — or a teammate's field operators
 *   (ui/watchBonds.js ownerBoard)
 * @param {Set<string>|string[]} [banned] banned base chess ids
 * @param {(id:string)=>any} [getChess]
 * @param {(id:string)=>any} [getItem] items.json lookup (the 变形同构体 pairings)
 * @param {((p: any) => any)|null} [pieceRecord] the record of one of the pieces (default: getChess(p.id))
 * @param {'official'|'plus'} [mode] morphPairing (default official)
 */
export function bondMembers(bond, priv, banned = [], getChess = () => null, getItem = () => null, pieceRecord = null, mode = 'official') {
  const bannedSet = banned instanceof Set ? banned : new Set(Array.isArray(banned) ? banned : []);
  // visibleMembers is the drawn list whenever it is an array, including [] (a bond whose only
  // catalogue members are hidden). members still names those hidden ids for grants. Missing
  // visibleMembers (older payloads) falls back to members.
  const members = Array.isArray(bond?.visibleMembers) ? bond.visibleMembers : (Array.isArray(bond?.members) ? bond.members : []);
  const baseOf = (id) => getChess(id)?.baseId || (typeof id === 'string' ? id.replace(/_b$/, '_a') : id);
  const onBoard = new Set();
  const owned = new Set();
  const inHand = new Set();
  const memberSet = new Set(members);
  /** base id → { on: on the board?, hand: in the hand?, items: the wearer's item ids } — operators of the player that join this bond through 变形同构体 */
  const granted = new Map();
  const grants = (p) => typeof bond?.bondId === 'string' && grantedBonds(p.items, getItem, mode).includes(bond.bondId);
  const recOf = (p) => (pieceRecord ? pieceRecord(p) : getChess(p.id));
  /** a composed 自选 record whose operator carries this bond */
  const diyOfBond = (rec) => isObj(rec) && typeof rec.diyFor === 'string' && Array.isArray(rec.bonds) && rec.bonds.includes(bond?.bondId);
  /** slot base id → { on, hand, owned, rec, pick } — the player's 自选 pieces and picks whose operator carries this bond */
  const diy = new Map();
  const diyOf = (p, on, hand) => {
    const rec = recOf(p);
    if (!diyOfBond(rec)) return false;
    const g = diy.get(rec.diyFor);
    if (g) { g.on = g.on || on; g.hand = g.hand || hand; return true; }
    // the row draws the normal form, as a member row its base chess (an elite copy is the same member)
    const pick = isObj(p.diy) && typeof p.diy.charId === 'string' ? p.diy : null;
    const normal = rec.isGolden ? recOf(pick ? { kind: 'chess', id: rec.diyFor, diy: pick } : { kind: 'chess', id: rec.diyFor }) : rec;
    diy.set(rec.diyFor, { on, hand, owned: true, rec: diyOfBond(normal) && normal.diyFor === rec.diyFor ? normal : rec, pick });
    return true;
  };
  const itemIds = (p) => p.items.map((it) => (typeof it === 'string' ? it : it?.id)).filter((x) => typeof x === 'string');
  for (const p of Array.isArray(priv?.board) ? priv.board : []) {
    if (p?.kind !== 'chess') continue;
    const base = baseOf(p.id);
    onBoard.add(base); owned.add(base);
    if (diyOf(p, true, false)) continue;
    if (!memberSet.has(base) && !granted.has(base) && grants(p)) granted.set(base, { on: true, hand: false, items: itemIds(p) });
  }
  for (const [list, hand] of [[priv?.hand, true], [priv?.temp, false]]) {
    for (const p of Array.isArray(list) ? list : []) {
      if (p?.kind !== 'chess') continue;
      const base = baseOf(p.id);
      owned.add(base);
      if (hand) inHand.add(base);
      if (diyOf(p, false, hand)) continue;
      if (memberSet.has(base) || !grants(p)) continue;
      const g = granted.get(base);
      if (!g) granted.set(base, { on: false, hand, items: itemIds(p) });
      else if (hand) g.hand = true;
    }
  }
  // the player's picks not owned (the slot's record through the own getter: gameLogic/diy.js diyGetter) — rows like an
  // unowned member's (counted by neither 在场 nor the 成员 header)
  for (const slotId of Object.keys(diyPicks(priv))) {
    if (diy.has(slotId)) continue;
    const rec = recOf({ kind: 'chess', id: slotId });
    if (diyOfBond(rec) && rec.diyFor === slotId) diy.set(slotId, { on: false, hand: false, owned: false, rec, pick: null });
  }
  const diyBanned = new Set(Array.isArray(priv?.diyBanned) ? priv.diyBanned : []);
  const rows = members.map((id) => {
    const c = getChess(id);
    return { id, tier: c?.tier ?? 0, name: c?.name ?? id, onBoard: onBoard.has(id), owned: owned.has(id), inHand: inHand.has(id), banned: bannedSet.has(id) };
  });
  for (const [id, g] of granted) {
    const c = getChess(id);
    rows.push({ id, tier: c?.tier ?? 0, name: c?.name ?? id, onBoard: g.on, owned: true, inHand: g.hand, banned: false, granted: true, items: g.items });
  }
  for (const [id, g] of diy) {
    rows.push({ id, tier: g.rec.tier ?? 0, name: g.rec.name ?? id, onBoard: g.on, owned: g.owned, inHand: g.hand, banned: bannedSet.has(id) || diyBanned.has(id), diy: true, rec: g.rec, ...(g.pick ? { pick: g.pick } : {}) });
  }
  return rows.sort((a, b) => (b.onBoard - a.onBoard) || (b.owned - a.owned) || (a.tier - b.tier) || (a.id < b.id ? -1 : 1));
}

/**
 * The member count of a bond popup's 成员 header: the rows on the board — and, for a bond that counts the hand
 * (`countsHand`: BOARD_AND_DECK — 投资人 远见 奇迹; the server's 在场 says （含整备区）), those in the hand too (the 5
 * temporary slots never count), so the header agrees with 在场 (community report 「投资人等在休整区就能生效的盟约不生效」:
 * the header said 0/n with the members in the hand while 在场 said 3/3).
 * @param {Array<{ onBoard?: boolean, inHand?: boolean }>} rows bondMembers rows @param {boolean} [countsHand]
 * @returns {number}
 */
export function memberHeadCount(rows, countsHand = false) {
  let n = 0;
  for (const r of Array.isArray(rows) ? rows : []) if (r && (r.onBoard || (countsHand && r.inHand))) n++;
  return n;
}

/**
 * Banned-member count per bond (briefing / info drawer red badge).
 * @param {any[]} bonds bonds.json records
 * @param {string[]} bannedChess
 * @returns {Map<string, number>}
 */
export function bannedPerBond(bonds, bannedChess) {
  const banned = new Set(Array.isArray(bannedChess) ? bannedChess : []);
  const out = new Map();
  for (const b of Array.isArray(bonds) ? bonds : []) {
    if (!isObj(b)) continue;
    const members = Array.isArray(b.visibleMembers) ? b.visibleMembers : [];
    out.set(b.bondId, members.filter((id) => banned.has(id)).length);
  }
  return out;
}

/**
 * The two kinds of greyed bonds of a match (research 01 A2, 06 addendum D):
 *   drawn  — the per-match drawn set D (m.public drawnDisabledBonds): only operators whose EVERY bond is in D leave
 *            the pool, so these bonds stay activatable (multi-bond members, 变形同构体, 调和) — "部分盟约所含干员阵容不完整";
 *   off    — the mode's static inactive list (FUNNY): never activates this match — "本局禁用".
 * Older payloads without drawnDisabledBonds: disabledBonds minus the static list.
 * @param {any} pub m.public
 * @param {string[]} [staticInactive] config.modes[modeId].inactiveBondIds
 * @returns {{ drawn: Set<string>, off: Set<string> }}
 */
export function disabledBondSets(pub, staticInactive = []) {
  const off = new Set(Array.isArray(staticInactive) ? staticInactive : []);
  const src = Array.isArray(pub?.drawnDisabledBonds) ? pub.drawnDisabledBonds : Array.isArray(pub?.disabledBonds) ? pub.disabledBonds : [];
  const drawn = new Set(src.filter((b) => typeof b === 'string' && !off.has(b)));
  return { drawn, off };
}

/**
 * Briefing tooltip of a bond disc.
 * @param {string} name
 * @param {'off'|'drawn'|null} state from disabledBondSets
 * @param {number} bannedN banned operators of the bond
 */
export function briefingBondTip(name, state, bannedN = 0) {
  if (state === 'off') return t('{name}：本局禁用（该盟约不会激活）', { name });
  if (state === 'drawn' || bannedN > 0) return bannedN ? t('{name}：部分盟约所含干员阵容不完整（{bannedN} 名干员无法出现）', { name, bannedN }) : t('{name}：部分盟约所含干员阵容不完整', { name });
  return name;
}

/**
 * The bonds a mode never activates (config.json modes[modeId].inactiveBondIds = the official modeDataDict
 * inactiveBondIdList: 标准模拟 leaves 拉特兰 阿戈尔 卡西米尔 灵巧 奥术 奇迹 投资人 突袭 独行 绝技 off). Operators that also carry an
 * enabled bond stay in the pool (server pool.js drawDisabledBonds) — 标准's 深靛 洛洛 阿罗玛 夕 圣聆初雪 still show 奥术 — and
 * the server left such a bond out of m.private.bonds, so without a mark a card read "奥术 0/2 未激活" with three 奥术
 * operators deployed (player report after 0.1.0: "奥术盟约不生效"). The shop / reward cards, the detail card's bond chips
 * and the bond popup mark these 本局禁用 (briefingBondTip 'off'); since 0.1.3 the server also lists such a bond the player
 * has members of (`off: true`, server/match/bondsMeta.js offBondCounts) and the strip shows it as a grey 本局禁用 disc.
 * @param {any} mode config.json modes[modeId] (data.js getMode), or null
 * @returns {Set<string>}
 */
export function modeOffBonds(mode) {
  const list = isObj(mode) && Array.isArray(mode.inactiveBondIds) ? mode.inactiveBondIds : [];
  return new Set(list.filter((b) => typeof b === 'string'));
}

/**
 * The bonds a strategy is built around that this mode switches off: bands.json `bondIds` (shared/bandBonds.js at build
 * time — the field the server's bot reads too, GameData.bandBondIds) ∩ `off` (modeOffBonds). 标准: 潘格尼尼 → 拉特兰,
 * 克莱门莎 → 阿戈尔, 玛恩纳 → 卡西米尔; the strategy draft marks such a band 本局禁用 (still selectable, DESIGN §21.26).
 * @param {any} band bands.json record @param {Set<string>|null} off
 * @returns {string[]}
 */
export function bandOffBonds(band, off) {
  if (!(off instanceof Set) || !off.size || !Array.isArray(band?.bondIds)) return [];
  return band.bondIds.filter((b) => typeof b === 'string' && off.has(b));
}

/**
 * The strategy draft's note for such a band: "本局禁用【拉特兰】盟约，此策略效果可能无法发挥".
 * @param {string[]} names the switched-off bonds' names
 */
export function bandOffLine(names) {
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n);
  return list.length ? t('本局禁用{names}盟约，此策略效果可能无法发挥', { names: list.map((n) => t('【{name}】', { name: n })).join('') }) : '';
}
