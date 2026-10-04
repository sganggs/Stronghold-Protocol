// server/match/bondsMeta.js — bond member counting, activation tiers and persistent layers (DESIGN §6.3,
// research 02 §2.1–§2.2).
//
// Counting modes (data/bonds.json `countMode`):
//   BOARD            distinct base chess (normal/elite of one operator count once) on the board carrying the bond
//   BOARD_AND_DECK   BOARD + the hand (整备区; the 5 temporary slots do not count) — 远见 / 奇迹 / 投资人
//   BOARD_ALL_CHESS  every elite (精锐) chess on the board, duplicates included — 绝技 (thresholdTemplate *_golden)
// Membership = the chess's own `bonds` + bonds granted by 变形同构体 (an item with `canGiveBond`) worn together with
// an item that has a `giveBondId` (research 02 §2.1).
// Special rules:
//   调和 (maniShip): while active, every CORE bond that already has ≥ 1 real member on the board gets count +1
//                    (one +1 total, research 02 §2.1 [ASSUMED]). Such a state carries `harmony: 1` — the views send it
//                    (bondList: m.private bonds, m.public players[].bonds), so the client's bond popup can say where the
//                    extra count comes from without re-deriving the rule (DESIGN §21.26); the battle input does not
//                    (bondSnapshot).
//   助力 (deputShip): tier 1 needs `thresholds[0]` distinct operators; the upper tiers count operators that differ
//                    in name OR elite state (PRTS 修正).
//   独行 (soloShip, count_threshold_downward): active iff 1 ≤ count ≤ maxCount (distinct 独行 operators).
//   Bonds in the mode's static inactive list (FUNNY) never activate and are omitted from computeBonds (the battle
//                    input never sees them); the views list the ones the player has members of as `off: true`
//                    (offBondCounts → bondList: count only, never active, after the others) so the strip can say
//                    本局禁用 (community reports 「投资人…不生效」 / 「…不会触发斯卡蒂与异德的突袭」, 0.1.3).
// `tier` = number of thresholds reached (downward: 1 when active); `active = tier ≥ 1`.
// Layers (`ps.layers[bondId]`) persist the whole match; they are reported for every bond but only matter while active.

import { layerGainRoom } from '../../shared/constants.js';

export const HARMONY_BOND = 'maniShip';
export const DEPUTY_BOND = 'deputShip';

/**
 * Bonds of a chess piece: own bonds ∪ bonds granted by 变形同构体 pairings.
 * @param {import('./gamedata.js').GameData} gd
 * @param {{ id: string, items?: Array<{ id: string }> }} piece
 * @returns {string[]}
 */
export function pieceBonds(gd, piece) {
  const c = gd.chess(piece.id);
  const out = c && Array.isArray(c.bonds) ? c.bonds.slice() : [];
  const items = Array.isArray(piece.items) ? piece.items : [];
  if (items.length >= 2) {
    const recs = items.map((it) => gd.item(it.id)).filter(Boolean);
    if (recs.some((r) => r.canGiveBond)) {
      for (const r of recs) {
        if (r.canGiveBond) continue;
        if (typeof r.giveBondId === 'string' && gd.bond(r.giveBondId) && !out.includes(r.giveBondId)) out.push(r.giveBondId);
      }
    }
  }
  return out;
}

/**
 * Who carries which bond (computeBonds' and offBondCounts' shared first step): bondId → Set(baseId) on the board / in
 * the hand (the 5 temporary slots never count), bondId → Set(baseId|golden) on the board, and the elite chess on the board.
 */
function membership(gd, ps) {
  const boardChess = [];
  for (const p of ps.board.values()) if (p && p.kind === 'chess') boardChess.push(p);
  const handChess = ps.hand.filter((p) => p && p.kind === 'chess');
  const onBoard = new Map();
  const onBoardVariant = new Map();
  const inHand = new Map();
  const add = (m, bond, key) => { let s = m.get(bond); if (!s) m.set(bond, (s = new Set())); s.add(key); };
  for (const p of boardChess) {
    const base = gd.baseIdOf(p.id);
    const golden = gd.isGolden(p.id);
    for (const b of pieceBonds(gd, p)) { add(onBoard, b, base); add(onBoardVariant, b, `${base}|${golden ? 1 : 0}`); }
  }
  for (const p of handChess) {
    const base = gd.baseIdOf(p.id);
    for (const b of pieceBonds(gd, p)) add(inHand, b, base);
  }
  return { onBoard, onBoardVariant, inHand, goldenOnBoard: boardChess.filter((p) => gd.isGolden(p.id)).length };
}

/** A bond's member count by its counting mode (before 调和's +1), with the effects' per-bond count bonus. */
function rawCount(gd, id, mem, ps) {
  const bond = gd.bond(id);
  let count;
  if (bond.countMode === 'BOARD_ALL_CHESS' || bond.thresholdTemplate === 'count_threshold_upward_golden') {
    count = mem.goldenOnBoard;
  } else if (bond.countMode === 'BOARD_AND_DECK') {
    const s = new Set([...(mem.onBoard.get(id) || []), ...(mem.inHand.get(id) || [])]);
    count = s.size;
  } else {
    count = (mem.onBoard.get(id) || new Set()).size;
  }
  const bonus = ps.bondCountBonus || {};
  return Math.max(0, count + (Number.isInteger(bonus[id]) ? bonus[id] : 0));
}

const layersIn = (ps, id) => {
  const v = ps.layers && ps.layers[id];
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/**
 * Compute every bond's state for a player. `harmony` (only present when it applies) = the +1 that 调和 added to `count`.
 * @param {import('./gamedata.js').GameData} gd
 * @param {{ board: Map<string, any>, hand: Array<any>, layers: Record<string, number>, bondCountBonus?: Record<string, number> }} ps
 * @returns {Record<string, { count: number, active: boolean, tier: number, layers: number, harmony?: number }>}
 */
export function computeBonds(gd, ps) {
  const mem = membership(gd, ps);
  const { onBoard, onBoardVariant } = mem;

  /** @type {Record<string, { count: number, active: boolean, tier: number, layers: number, harmony?: number }>} */
  const out = {};
  const layersOf = (id) => layersIn(ps, id);
  const bonus = ps.bondCountBonus || {};
  const bonusOf = (id) => (Number.isInteger(bonus[id]) ? bonus[id] : 0);

  // first pass: raw counts
  const raw = {};
  for (const id of gd.bondIds) {
    if (gd.modeInactiveBonds.has(id)) continue;
    raw[id] = rawCount(gd, id, mem, ps);
  }
  // 调和: +1 to core bonds with ≥ 1 real board member while it is active
  const harmony = gd.bond(HARMONY_BOND);
  const harmonyActive = harmony && raw[HARMONY_BOND] != null && tierFor(harmony, raw[HARMONY_BOND]) >= 1;
  for (const id of Object.keys(raw)) {
    const bond = gd.bond(id);
    const harmonyBonus = harmonyActive && bond.isCore && (onBoard.get(id)?.size ?? 0) >= 1 ? 1 : 0;
    const count = raw[id] + harmonyBonus;
    let tier = tierFor(bond, count);
    if (id === DEPUTY_BOND && tier >= 1) {
      // upper tiers: operators differing in name OR elite state
      const variants = (onBoardVariant.get(id)?.size ?? 0) + bonusOf(id);
      const th = thresholdsOf(bond);
      let t = 1;
      for (let i = 1; i < th.length; i++) if (variants >= th[i]) t = i + 1;
      tier = t;
    }
    out[id] = { count, active: tier >= 1, tier, layers: layersOf(id) };
    if (harmonyBonus) out[id].harmony = harmonyBonus;
  }
  return out;
}

/**
 * The bonds this mode never activates (the static inactive list — 标准模拟's 拉特兰 阿戈尔 卡西米尔 灵巧 奥术 奇迹 投资人 突袭
 * 独行 绝技) that the player has members of, counted like computeBonds would (投资人 / 奇迹 with the hand): { [bondId]:
 * { count, layers } }, null when the mode switches nothing off. Only the views use it (bondList `off`) — the strip shows
 * such a bond as a grey 本局禁用 disc instead of leaving the player to wonder why it does nothing (0.1.3).
 * @param {import('./gamedata.js').GameData} gd
 * @param {{ board: Map<string, any>, hand: Array<any>, layers: Record<string, number>, bondCountBonus?: Record<string, number> }} ps
 * @returns {Record<string, { count: number, layers: number }>|null}
 */
export function offBondCounts(gd, ps) {
  if (!gd.modeInactiveBonds || !gd.modeInactiveBonds.size) return null;
  const mem = membership(gd, ps);
  let out = null;
  for (const id of gd.bondIds) {
    if (!gd.modeInactiveBonds.has(id)) continue;
    const count = rawCount(gd, id, mem, ps);
    if (!(count > 0)) continue;
    (out ??= {})[id] = { count, layers: layersIn(ps, id) };
  }
  return out;
}

/** Ascending member-count thresholds of a bond (fallback: activeCount). */
export function thresholdsOf(bond) {
  if (Array.isArray(bond.thresholds) && bond.thresholds.length) return bond.thresholds.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (Number.isFinite(bond.activeCount)) return [bond.activeCount];
  return [2];
}

/** Tier for a member count (downward bonds: 1 while 1 ≤ count ≤ maxCount). */
export function tierFor(bond, count) {
  const th = thresholdsOf(bond);
  if (bond.thresholdTemplate === 'count_threshold_downward') {
    const max = Number.isFinite(bond.maxCount) ? bond.maxCount : th[0];
    return count >= th[0] && count <= max ? 1 : 0;
  }
  let t = 0;
  for (const n of th) if (count >= n) t++;
  return t;
}

/** Σ layers over active bonds (hidden-core check, 不朽盟约 title). */
export function activatedLayers(bonds) {
  let n = 0;
  for (const b of Object.values(bonds || {})) if (b.active) n += b.layers || 0;
  return n;
}

/**
 * View list for m.private / m.public: bonds with members or layers, active first, then layers desc, then data order.
 * An entry whose count includes 调和's +1 carries `harmony: 1` (both views; absent otherwise). `off` (offBondCounts): the
 * mode-off bonds the player has members of follow, in data order, as `{ bondId, count, active: false, tier: 0, layers,
 * off: true }` — the strip's grey 本局禁用 discs; never in computeBonds, so never in the battle input.
 * @param {import('./gamedata.js').GameData} gd
 * @param {ReturnType<typeof computeBonds>} bonds
 * @param {{ full?: boolean, off?: ReturnType<typeof offBondCounts> }} [opts] full → include thresholds/countsHand (m.private)
 */
export function bondList(gd, bonds, { full = false, off = null } = {}) {
  const order = new Map(gd.bondIds.map((id, i) => [id, i]));
  const list = [];
  const extras = (e) => {
    if (!full) return e;
    const bond = gd.bond(e.bondId);
    e.thresholds = bond ? thresholdsOf(bond) : [];
    e.countsHand = !!(bond && bond.countMode === 'BOARD_AND_DECK');
    return e;
  };
  for (const [bondId, b] of Object.entries(bonds || {})) {
    if (!(b.count > 0 || b.layers > 0 || b.active)) continue;
    const e = { bondId, count: b.count, active: b.active, tier: b.tier, layers: b.layers };
    if (b.harmony > 0) e.harmony = b.harmony;
    list.push(extras(e));
  }
  list.sort((a, b) => (b.active - a.active) || (b.layers - a.layers) || ((order.get(a.bondId) ?? 99) - (order.get(b.bondId) ?? 99)));
  if (off) {
    for (const bondId of gd.bondIds) {
      const o = off[bondId];
      if (!o || !(o.count > 0) || (bonds && bonds[bondId])) continue;
      list.push(extras({ bondId, count: o.count, active: false, tier: 0, layers: Number.isFinite(o.layers) && o.layers > 0 ? o.layers : 0, off: true }));
    }
  }
  return list;
}

/**
 * The bond states the views show (m.private / m.public players[].bonds, DESIGN §20.15): `bonds` with this round's
 * IN_BATTLE gains of a finished normal battle (`gains` = the result's layerGains, PlayerState.pendingLayerGains, set
 * when the COMBAT phase ends) added the way settle() will add them — at most up to BOND_LAYER_CAP — so the strip of a
 * player (and of a teammate watching him) keeps the layers his battle reached through the 联防 until the settlement
 * makes them persistent. `bonds` itself when there is nothing to add; the persistent state is never touched.
 * @param {ReturnType<typeof computeBonds>} bonds
 * @param {Record<string, number>|null|undefined} gains
 */
export function bondsWithGains(bonds, gains) {
  if (!gains || typeof gains !== 'object') return bonds;
  let out = null;
  for (const [id, n] of Object.entries(gains)) {
    const b = bonds && bonds[id];
    if (!b) continue;
    const add = layerGainRoom(b.layers, Math.floor(Number(n) || 0));
    if (!(add > 0)) continue;
    if (!out) out = { ...bonds };
    out[id] = { ...b, layers: (b.layers || 0) + add };
  }
  return out || bonds;
}

/** Snapshot for PlayerBattleInput.bonds: { [bondId]: { count, active, tier, layers } } (plain copy). */
export function bondSnapshot(bonds) {
  const o = {};
  for (const [id, b] of Object.entries(bonds || {})) o[id] = { count: b.count, active: b.active, tier: b.tier, layers: b.layers };
  return o;
}
