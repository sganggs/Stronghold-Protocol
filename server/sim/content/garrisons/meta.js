// server/sim/content/garrisons/meta.js — prep-side ("SERVER_*") 特质 (docs/META.md §2.3).
//
// One registry handler per effectKey (`garrison:<effectKey>`); the dispatcher calls it on the garrison's eventType hook
// with ctx.source = { piece, garrisonId, garrison, bb, bbStr, where }. Numbers come from the garrison's own bb / bbStr
// (normal `_a` and elite `_b` records). Layer wording: "（无需激活盟约）" → requireActive false; "已激活" / "激活且" →
// requireActive true. The dispatcher already repeats onGain garrisons ×2 / ×3 under 投资人 and skips hand pieces for
// conditionkey character_target_inboard.
//
// Re-triggers (铃兰 SERVER_TRIGGER_*, 瑰盐, 塞雷娅 / 白面鸮 "特质与其相同") go through the engine's
// ctx.triggerGarrisons (same handlers, 投资人 repeat, per-handler isolation, shared depth cap).
// triggerGainEffects(ctx, piece) is exported for 铃兰-style effects of other modules (bands.js 铃兰 御守之力).
//
// Decisions (documented, see research 02 §4 / 03 §5.5):
//   * "同一行有3名干员" / "同一行每有1名干员" count the trait's owner (board chess of that row, self included).
//   * POSITION "使自身及身后/身前一格干员的已激活盟约分别各层数+N": per target operator (a shared bond gets +N twice).
//   * 瑰盐 "优先…更靠上的和更靠右的": highest row first (DESIGN §3.1: row 0 is the bottom), then highest column.
//   * 购买价格为N (SERVER_CHESS_PRICE): bb.price is a discount off the tier price — 至简 (Ⅲ, 3) has 2 → 1, 红豆 (Ⅰ, 2)
//     has 1 → 1, exactly the N both official texts give (user playtest #5: 至简 costs 1). The dispatcher runs it before
//     every other onPrice modifier, so 远见's discount (to 0 at 150 layers since 0.1.3) and strategy caps act on the
//     lowered price.
//   * [ASSUMED] 余 SERVER_MOST_BOND: ties between most-member bonds are shuffled; the chess is a copy-weighted pool roll
//     of any tier (the text gives no tier cap); a bond without an available chess falls through to the next tied one.
//   * [ASSUMED] 松果: the "免费特殊招募" is a free pick-one offer of `rewardOffer.count` (3) chess of the pool's tier.
//   * 拉普兰德 SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT "若为本回合首次主动刷新": per copy — the manual refreshes this copy
//     witnesses since its acquisition (or, for a copy held from an earlier round, since the round began — the card's
//     本回合首次; players' report after 0.1.0). A copy bought, granted or merged (an elite is a new piece, GitHub #169:
//     the refresh right after 合成金 fires even when the consumed copies already refreshed this round) starts at 0 and
//     fires on its own first witnessed refresh.
//     "本回合每刷新过1次" (SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER, 阿罗玛 / 安洁莉娜 / 售出时)
//     fires on another event and reads the player's refreshes of the round (roundStats), like 本回合每获得过 / 每花费.

import { metaBonds, frontPiece, behindPiece, distinctTiers } from '../support/meta.js';

const ids = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d);

/** "（无需激活盟约）" → false; "使已激活的…" / "当前激活且…" / "自身已激活的盟约" → true. */
export function requireActiveOf(g) {
  const d = (g && g.desc) || '';
  if (d.includes('无需激活')) return false;
  return /已激活|激活且/.test(d);
}

const bondOrder = (ctx) => (Array.isArray(ctx.gd && ctx.gd.bondIds) ? ctx.gd.bondIds : Object.keys(ctx.data.bonds || {}));

/** Active bond with the most layers (ties → bond data order), or null. */
export function topActiveBondMeta(ctx) {
  let best = null, bl = -1;
  for (const id of bondOrder(ctx)) {
    if (!ctx.bondActive(id)) continue;
    const l = ctx.layers(id);
    if (l > bl) { bl = l; best = id; }
  }
  return best;
}

/** Fresh view of the source piece (with row/col on the board). */
function selfView(ctx) {
  const p = ctx.source && ctx.source.piece;
  if (!p) return null;
  const v = Number.isInteger(p.uid) && p.uid > 0 ? ctx.piece(p.uid) : null;
  return v || p;
}
const onBoard = (v) => !!v && v.area === 'board' && Number.isInteger(v.row);
const chessOnBoard = (ctx) => ctx.board().filter((p) => p && p.kind === 'chess');

function addAll(ctx, bonds, n, requireActive) {
  let total = 0;
  if (!(n > 0)) return 0;
  for (const b of bonds) if (b) total += ctx.addLayers(b, n, { requireActive });
  return total;
}

function sameRowCount(ctx, me) {
  if (!onBoard(me)) return 0;
  return chessOnBoard(ctx).filter((p) => p.row === me.row).length;
}
function rowCondition(ctx, me) {
  const { bb, bbStr } = ctx.source;
  if (bbStr.conditionkey === 'character_same_row') return sameRowCount(ctx, me) >= num(bb.check_count, 0);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// handlers

const H = {};

H.SERVER_ADD_BOND = {
  run(ctx) {
    const { bb, bbStr, garrison, piece } = ctx.source;
    const bonds = ids(bbStr.bond);
    // 录武官 (hidden 4_15) carries garrison_157 (【奇迹】+3) next to garrison_156 (【炎】+6、【奇迹】+3) with the same text:
    // the text grants 奇迹 once, so a bond already covered by the piece's SERVER_ADD_MULTIPLE_BOND is skipped.
    const rec = piece ? ctx.chessRecord(piece.id) : null;
    const covered = new Set();
    for (const gid of (rec && Array.isArray(rec.garrisonIds) ? rec.garrisonIds : [])) {
      const g = ctx.gd.garrison(gid);
      if (g && g !== garrison && g.effectType === 'SERVER_ADD_MULTIPLE_BOND' && g.eventType === garrison.eventType && g.desc === garrison.desc) for (const b of ids(g.bbStr && g.bbStr.bond)) covered.add(b);
    }
    addAll(ctx, bonds.filter((b) => !covered.has(b)), num(bb.count), requireActiveOf(garrison));
  },
};

H.SERVER_ADD_BOND_CHESS_ALL = {
  run(ctx) {
    const { bb, garrison } = ctx.source;
    addAll(ctx, metaBonds(ctx, ctx.source.piece), num(bb.count), requireActiveOf(garrison));
  },
};

H.SERVER_ADD_BOND_METHOD = {
  run(ctx) {
    const { bb, bbStr, garrison } = ctx.source;
    const multi = num(bb.multi, 1);
    const bonds = ids(bbStr.bond);
    const ra = requireActiveOf(garrison);
    const me = selfView(ctx);
    switch (bbStr.add_method) {
      case 'shoplv': addAll(ctx, bonds, ctx.shopLevel() * multi, ra); break;
      case 'round_gain_char': addAll(ctx, bonds, (ctx.roundStats().gainedChess | 0) * multi, ra); break;
      case 'hand_count': addAll(ctx, bonds, ctx.hand().filter((p) => p && p.kind === 'chess').length * multi, ra); break;
      case 'same_row': addAll(ctx, bonds, sameRowCount(ctx, me) * multi, ra); break;
      case 'same_bond_diff_lv':
        for (const b of bonds) addAll(ctx, [b], distinctTiers(ctx, (p) => metaBonds(ctx, p).includes(b)).size * multi, ra);
        break;
      default: break;
    }
  },
};

H.SERVER_ADD_MULTIPLE_BOND = {
  run(ctx) {
    const { bbStr, garrison } = ctx.source;
    const bonds = ids(bbStr.bond);
    const counts = ids(bbStr.count).map((x) => num(x));
    bonds.forEach((b, i) => addAll(ctx, [b], counts[i] ?? counts[counts.length - 1] ?? 0, requireActiveOf(garrison)));
  },
};

H.SERVER_ADD_BOND_ACTIVATED_MOST_LAYER = {
  run(ctx) {
    const b = topActiveBondMeta(ctx);
    if (b) ctx.addLayers(b, num(ctx.source.bb.count), { requireActive: true });
  },
};

H.SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER = {
  run(ctx) {
    const b = topActiveBondMeta(ctx);
    if (!b) return;
    const n = distinctTiers(ctx, (p) => metaBonds(ctx, p).includes(b)).size;
    ctx.addLayers(b, n * num(ctx.source.bb.multi, 1), { requireActive: true });
  },
};

H.SERVER_ADD_BOND_IN_HAND = {
  run(ctx) {
    const n = num(ctx.source.bb.count);
    for (const p of ctx.hand()) {
      if (!p || p.kind !== 'chess') continue;
      for (const b of metaBonds(ctx, p)) if (ctx.bondActive(b)) ctx.addLayers(b, n, { requireActive: true });
    }
  },
};

// "使自身及身后/身前一格干员的已激活盟约分别各层数+N": the trait's 付与对象 are two operators (PRTS 下半 更新记录 on
// 断崖: "自身外的付与对象从 身前一格干员 调整至 身后一格干员"); each target's active bonds get +N, so a bond both
// operators share gets +N twice (same per-operator reading as 流明 "每名干员所在的已激活盟约分别层数+N").
H.SERVER_ADD_BOND_POSITION = {
  run(ctx) {
    const { bb, bbStr } = ctx.source;
    const me = selfView(ctx);
    if (!onBoard(me)) return;
    const other = bbStr.dir === 'behind' ? behindPiece(ctx, me) : frontPiece(ctx, me);
    const targets = [me];
    if (other && other.kind === 'chess' && other.uid !== me.uid) targets.push(other);
    for (const t of targets) for (const b of metaBonds(ctx, t)) if (ctx.bondActive(b)) ctx.addLayers(b, num(bb.count), { requireActive: true });
  },
};

H.SERVER_ADD_BOND_ROUND_COIN_COST = {
  run(ctx) {
    const { bb, bbStr, garrison } = ctx.source;
    const per = Math.max(1, num(bb.count, 1));
    addAll(ctx, ids(bbStr.bond), Math.floor((ctx.roundStats().spent | 0) / per) * num(bb.layer), requireActiveOf(garrison));
  },
};

H.SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER = {
  run(ctx) {
    const { bb, bbStr, garrison } = ctx.source;
    let n = (ctx.roundStats().refreshes | 0) * num(bb.multiplier);
    if (num(bb.max_layer, 0) > 0) n = Math.min(n, num(bb.max_layer));
    addAll(ctx, ids(bbStr.bond), n, requireActiveOf(garrison));
  },
};

// 拉普兰德 "<刷新时>若为本回合首次主动刷新…，此干员在整备区时也有效": the refresh count is the operator's own — the
// manual refreshes this copy witnessed (board or hand) since it was acquired or, for a copy held from an earlier
// round, since the round began (players' report after 0.1.0: "获得该干员后该回合的首次刷新" also stacks; GitHub #169:
// the count starts at the acquisition, so the refresh right after 合成金 fires even when the consumed copies already
// refreshed this round). Read as each trait instance counting its own SERVER_REFRESH_SHOP triggers against
// bb.refresh_cnt: a re-triggered trait (ev.trigger) is no manual refresh — it neither fires nor counts. The counter
// lives per piece uid in the player's content counters (uids are never reused): a new copy (bought, granted, a
// merge's elite) starts at 0, and a copy kept across rounds is reset when the round turns (the card's 本回合首次).
const REFRESH_CNT_KEY = 'garrison:SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT:refreshes'; // per-piece counter (module-prefixed)
H.SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT = {
  onRefresh(ctx, ev) {
    if (ev && ev.trigger) return;
    const { bb, bbStr, garrison, piece } = ctx.source;
    if (!piece || !Number.isInteger(piece.uid) || piece.uid <= 0) return;
    const countKey = `${REFRESH_CNT_KEY}:${piece.uid}`;
    const roundKey = `${REFRESH_CNT_KEY}:round:${piece.uid}`;
    if (ctx.counter(roundKey) !== ctx.round) { ctx.setCounter(roundKey, ctx.round); ctx.setCounter(countKey, 0); }
    if (ctx.incCounter(countKey) !== num(bb.refresh_cnt, 1)) return;
    addAll(ctx, ids(bbStr.bond), num(bb.layer), requireActiveOf(garrison));
  },
};

// "购买价格为N": bb.price is the discount off the chess's tier price — 至简 (Ⅲ, 3 资金) carries 2 and 红豆 (Ⅰ, 2 资金)
// carries 1, and both texts say 购买价格为1 (read as the new price, 至简 cost 2; user playtest #5). The dispatcher runs
// this first on onPrice (effectsMeta.js), so bonds (远见 −1: 1 → 0) and strategies see the lowered price.
H.SERVER_CHESS_PRICE = {
  onPrice(ctx, ev) {
    const p = ctx.source.bb.price;
    if (!Number.isFinite(p) || !ev) return;
    ctx.modifyPrice(-p);
  },
};

H.SERVER_GAIN_EQUIP = {
  run(ctx) {
    const { bb, bbStr } = ctx.source;
    if (!ctx.gd.item(bbStr.chess)) return;
    for (let i = 0; i < Math.min(10, num(bb.count, 1)); i++) ctx.grantItem(bbStr.chess);
  },
};

H.SERVER_GAIN_FREE_REFRESH_COUNT = {
  run(ctx) { ctx.grantFreeRefresh(num(ctx.source.bb.count, 1)); },
};

H.SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL = {
  run(ctx) {
    const { bb, bbStr } = ctx.source;
    const rounds = ids(bbStr.round_list).map((x) => num(x, -1));
    if (rounds.length && !rounds.includes(ctx.round)) return;
    for (let i = 0; i < Math.min(10, num(bb.count, 1)); i++) {
      const r = ctx.rollPool(bbStr.pool);
      const id = r && r.kind === 'item' ? r.id : ctx.rollItem({ maxTier: ctx.shopLevel() });
      if (id) ctx.grantItem(id);
    }
  },
};

/** Weighted item roll of an equip pool; elite garrisons use the pool's `goldenWeights` when present. */
function rollEquip(ctx, poolId, golden) {
  const pool = ctx.data.choices && ctx.data.choices.pools ? ctx.data.choices.pools[poolId] : null;
  if (golden && pool && Array.isArray(pool.weighted) && Array.isArray(pool.goldenWeights) && pool.goldenWeights.length === pool.weighted.length) {
    const pairs = pool.weighted.map((x, i) => [x[0], Math.max(0, num(pool.goldenWeights[i]))]).filter(([id, w]) => w > 0 && ctx.gd.item(id));
    let total = 0;
    for (const [, w] of pairs) total += w;
    if (total > 0) {
      let r = ctx.rng() * total;
      for (const [id, w] of pairs) { r -= w; if (r < 0) return id; }
      return pairs[pairs.length - 1][0];
    }
  }
  const r = ctx.rollPool(poolId);
  return r && r.kind === 'item' ? r.id : null;
}

H.SERVER_POOL_EQUIP = {
  run(ctx) {
    const { bb, bbStr, garrisonId } = ctx.source;
    const golden = /_b$/.test(garrisonId);
    for (let i = 0; i < Math.min(10, num(bb.count, 1)); i++) {
      const id = rollEquip(ctx, bbStr.pool, golden);
      if (id) ctx.grantItem(id);
    }
  },
};

H.SERVER_POOL_CHAR = {
  run(ctx) {
    const { bb, bbStr } = ctx.source;
    if (!rowCondition(ctx, selfView(ctx))) return;
    for (let i = 0; i < Math.min(10, num(bb.count, 1)); i++) {
      const r = ctx.rollPool(bbStr.pool);
      if (r && r.kind === 'chess') ctx.grantChess(r.id, { golden: !!r.golden });
    }
  },
};

H.SERVER_MOST_BOND = {
  run(ctx) {
    if (!rowCondition(ctx, selfView(ctx))) return;
    let best = [], bc = 0;
    for (const id of bondOrder(ctx)) {
      const c = ctx.bondCount(id);
      if (c > bc) { bc = c; best = [id]; } else if (c === bc && c > 0) best.push(id);
    }
    const order = best.length > 1 ? ctx.rng.shuffle(best.slice()) : best;
    for (const bond of order) {
      const id = ctx.rollChess({ bond, maxTier: 6 });
      if (id && ctx.grantChess(id)) return;
    }
  },
};

H.SERVER_ONCE_GOLD = {
  run(ctx) { ctx.addPendingFunds(num(ctx.source.bb.count)); },
};

H.SERVER_ONCE_GOLD_WITH_BOND_CONDITION = {
  run(ctx) {
    const { bb, bbStr, where } = ctx.source;
    if (where === 'hand' && !ids(bbStr.bond).some((b) => ctx.bondActive(b))) return;
    ctx.addPendingFunds(num(bb.count));
  },
};

H.SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS = {
  onSold(ctx) {
    const { bbStr } = ctx.source;
    const poolId = bbStr[`pool${ctx.shopLevel()}`] || bbStr.max_pool;
    const pool = ctx.data.choices && ctx.data.choices.pools ? ctx.data.choices.pools[poolId] : null;
    const tier = pool && Number.isInteger(pool.tier) ? pool.tier : null;
    const count = Math.max(1, num(ctx.gd.rewardOffer ? ctx.gd.rewardOffer().count : 3, 3));
    const list = [];
    for (let i = 0; i < count * 4 && list.length < count; i++) {
      const r = ctx.rollPool(poolId);
      if (r && r.kind === 'chess' && !list.includes(r.id)) list.push(r.id);
    }
    if (list.length) ctx.offerChess(list, { tier });
    else if (tier) ctx.offerChess(null, { tier });
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// re-triggers — through the engine's ctx.triggerGarrisons (dispatcher: same handlers, 投资人 repeat for SERVER_GAIN,
// per-handler error isolation, shared depth cap)

const garrisonsOfPiece = (ctx, piece) => {
  const rec = piece ? ctx.chessRecord(piece.id) : null;
  return (rec && Array.isArray(rec.garrisonIds) ? rec.garrisonIds : []).map((gid) => ctx.gd.garrison(gid)).filter(Boolean);
};
const hasEvent = (ctx, piece, eventType) => garrisonsOfPiece(ctx, piece).some((g) => g.eventType === eventType);

/**
 * Run the garrisons of the owned chess `piece` whose eventType is `eventType` once more (ctx.triggerGarrisons).
 * `asPiece` runs them as that piece's own trait (塞雷娅 / 白面鸮 "特质与其相同"). SERVER_GAIN repeats ×投资人.
 * Returns the number of garrison effects run.
 */
export function runGarrisonsOf(ctx, piece, eventType, { asPiece = null } = {}) {
  if (!ctx || typeof ctx.triggerGarrisons !== 'function' || !piece || piece.kind !== 'chess' || !Number.isInteger(piece.uid)) return 0;
  const opts = asPiece && Number.isInteger(asPiece.uid) ? { asUid: asPiece.uid } : {};
  return ctx.triggerGarrisons(piece.uid, eventType, opts) | 0;
}

/** Run the 获得时 (SERVER_GAIN) garrisons of an owned chess piece once more (×投资人). Returns the effects run. */
export function triggerGainEffects(ctx, piece) {
  const p = piece && Number.isInteger(piece.uid) && piece.uid > 0 ? (ctx.piece(piece.uid) || piece) : piece;
  if (!p || p.kind !== 'chess') return 0;
  return runGarrisonsOf(ctx, p, 'SERVER_GAIN');
}

// 铃兰 60_a: "<进入休整期时>触发身前一格的其他干员的“获得时”类效果" (scope front)
// 瑰盐 82: "<售出时>触发场上一名拥有“休整期结束时”的干员的特质（优先触发部署位置更靠上的和更靠右的）" (scope farright).
// DESIGN §3.1: row 0 is the bottom, so "更靠上" = the highest row; then the highest column ("更靠右").
H.SERVER_TRIGGER_ANOTHER = {
  run(ctx) {
    const { bbStr } = ctx.source;
    const event = bbStr.event || 'SERVER_GAIN';
    const self = selfView(ctx);
    if (bbStr.scope === 'front') {
      if (!onBoard(self)) return;
      const f = frontPiece(ctx, self);
      if (f && f.kind === 'chess' && f.uid !== self.uid) runGarrisonsOf(ctx, f, event);
      return;
    }
    const cands = chessOnBoard(ctx).filter((p) => (!self || p.uid !== self.uid) && hasEvent(ctx, p, event));
    cands.sort((a, b) => (b.row - a.row) || (b.col - a.col));
    if (cands.length) runGarrisonsOf(ctx, cands[0], event);
  },
};

// 铃兰 60_b: "<进入休整期时>触发身前两格的其他干员的“获得时”类效果" (the two tiles in front, nearest first)
H.SERVER_TRIGGER_FRONT_COUNT = {
  run(ctx) {
    const { bb, bbStr } = ctx.source;
    const self = selfView(ctx);
    if (!onBoard(self)) return;
    for (let k = 1; k <= Math.min(8, num(bb.count, 1)); k++) {
      const f = frontPiece(ctx, self, k);
      if (f && f.kind === 'chess' && f.uid !== self.uid) runGarrisonsOf(ctx, f, bbStr.event || 'SERVER_GAIN');
    }
  },
};

// 塞雷娅 / 白面鸮: "身前一格干员若为“X”特质，本干员的特质与其相同" — the front operator's X garrisons run as the copier's
// own (self-relative effects use the copier's tile / bonds). A copier of the same kind in front copies what that one
// copies (the chain is followed, bounded).
function copyFront(ctx, eventType, selfKey) {
  const self = selfView(ctx);
  if (!onBoard(self)) return;
  let target = frontPiece(ctx, self);
  for (let i = 0; i < 8 && target && target.kind === 'chess'; i++) {
    const gs = garrisonsOfPiece(ctx, target).filter((g) => g.eventType === eventType);
    if (!gs.length) return;
    if (!gs.every((g) => g.effectKey === selfKey)) break;
    target = frontPiece(ctx, target);
  }
  if (!target || target.kind !== 'chess' || target.uid === self.uid) return;
  runGarrisonsOf(ctx, target, eventType, { asPiece: self });
}

H.SERVER_FRONT_SAME_EFFECT_PREP_FIN = {
  run(ctx) { copyFront(ctx, 'SERVER_PREP_FIN', 'SERVER_FRONT_SAME_EFFECT_PREP_FIN'); },
};
H.SERVER_FRONT_SAME_EFFECT_PREP_START = {
  run(ctx) { copyFront(ctx, 'SERVER_PREP_START', 'SERVER_FRONT_SAME_EFFECT_PREP_START'); },
};


/** effectKey → handler (the registered objects). */
export const HANDLERS = Object.freeze(H);

export function registerMeta(registry) {
  for (const [key, h] of Object.entries(H)) registry.garrison(key, h);
}
