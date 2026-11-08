// server/sim/content/bonds/addon/meta.js — prep side of the add-on bonds (research 02 §3.14–§3.17, §3.20).
//
//   助力 deputShip  onPrepEnd: every currently active bond +`layer` (tier 2 = 3 助力 by name or elite state:
//                  +`more_layer`) — buff bond_activated_add_layer
//   远见 visiShip   every `layer` layers +`count` funds (bond_layer_gain_coin); first time at `layer1`: 远见 chess cost
//                  −`discount`; first time at `layer2`: every chess costs −`discount` instead (latched, permanent)
//   奇迹 miraShip   manual refresh with no free refresh pending → p = min(1, baseprob + prob·L) the next refresh is free;
//                  every 100 layers +20 funds (bond_layer_gain_coin). `probk` has no known meaning and is unused.
//   投资人          ×2 / ×3 "获得时" garrisons: EffectDispatcher.investRepeat (server/match/effectsMeta.js).
//   调和            +1 member count for core bonds: server/match/bondsMeta.js.
//
// Milestones read the persistent layers and pay only while the bond is active; payouts owed for layers gained while it
// was inactive ("无需激活" sources) are caught up as soon as it lights up (research 02 §8 Q7 [ASSUMED]): the onActiveBonds
// hook of the recompute that activated it — a hand gain, a temp → hand move, an effect — like 维多利亚's hammers (the
// maintainer's report of 2026-10-15 for the hammer; [ASSUMED] the same timing for these funds and 远见's discount latch,
// which share its rule), and the other hooks below catch up anything a capped nested dispatch skipped.
// Funds earned after the prep phase ended (助力 / 寒檀 / 号角 … prep-end layers — the match wipes leftover funds right
// after onPrepEnd) are paid as pending funds, credited at the next round start, so "获得…资金" is never silently lost
// [ASSUMED]; `global:bondaddon_prepend` (first in every dispatch) marks the round whose prep has ended.
// 远见's −1 (「购买价格永久-1资金」) has no floor but 0: a price of 1 (至简 / 红豆's 购买价格为1 特质, run first on onPrice;
// 休露丝's first 谢拉格) becomes 0 — the text names none (owner's decision 2026-10-04; before 0.1.3 research 02 §3.15
// assumed 1).
// Latched state lives in player counters (prefix `bondaddon:`); onPrice only reads them (pure).

import { msg, dn } from '../../../../../shared/i18n.js';

const C_VISI_PAID = 'bondaddon:visi:paid';
const C_VISI_DISC = 'bondaddon:visi:disc';
const C_MIRA_PAID = 'bondaddon:mira:paid';
const C_PREP_ENDED = 'bondaddon:prepEndedRound';
/** Hooks on which owed milestones are caught up (besides the bond's own onLayers): onActiveBonds when the bond lights up. */
const SETTLE_HOOKS = Object.freeze(['onActiveBonds', 'onRoundStart', 'onPrepStart', 'onPrepEnd', 'onBuy', 'onGain', 'onSold', 'onMerge']);

const n = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** `{ ...bb, ...bbStr }` of a bond buff from the match data (ctx.data), or {}. */
function buff(ctx, bondId, key) {
  const rec = ctx.data && ctx.data.bonds ? ctx.data.bonds[bondId] : null;
  for (const b of (rec && Array.isArray(rec.buffs) ? rec.buffs : [])) {
    if (b && b.key === key) return { ...(b.bb || {}), ...(b.bbStr || {}) };
  }
  return {};
}

/** Pay "every `layer` layers +`count` funds" up to the current layers (only while active). */
function settleCoins(ctx, bondId, counterKey, label) {
  if (!ctx.bondActive(bondId)) return 0;
  const p = buff(ctx, bondId, 'bond_layer_gain_coin');
  const step = n(p.layer), count = n(p.count);
  if (!(step > 0) || !(count > 0)) return 0;
  const due = Math.floor(ctx.layers(bondId) / step);
  const paid = ctx.counter(counterKey);
  if (due <= paid) return 0;
  ctx.setCounter(counterKey, due);
  const gain = (due - paid) * count;
  if (prepEnded(ctx)) {
    ctx.addPendingFunds(gain);
    ctx.toast(msg('【{label}】层数达成，下回合开始时获得{gain}资金', { label: dn(label), gain }), 'info');
  } else {
    ctx.addFunds(gain, `bond:${bondId}`);
    ctx.toast(msg('【{label}】层数达成，获得{gain}资金', { label: dn(label), gain }), 'info');
  }
  return gain;
}

/** True between this round's onPrepEnd and the end of its PREP phase (leftover funds are about to be wiped). */
const prepEnded = (ctx) => ctx.phase === 'PREP' && ctx.counter(C_PREP_ENDED) === ctx.round;

function latchVisiDiscount(ctx) {
  if (!ctx.bondActive('visiShip')) return;
  const p = visiDiscount(ctx);
  const L = ctx.layers('visiShip');
  const cur = ctx.counter(C_VISI_DISC);
  if (p.mode === 'tier2') {
    // [ASSUMED] each reached tier in layer_list stacks another −discount, and only on 远见 operators.
    // layer_list is a comma-separated string in the season tables ("80,150"); n() only accepts numbers.
    const tiers = String(p.list).split(',').map((s) => Number(String(s).trim())).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    let reached = 0;
    for (const layer of tiers) if (L >= layer) reached++;
    if (reached > cur) {
      ctx.setCounter(C_VISI_DISC, reached);
      ctx.toast(reached >= 2 ? '【远见】远见干员购买价格再次永久降低' : '【远见】远见干员购买价格永久降低', 'info');
    }
    return;
  }
  const t = L >= n(p.layer2, Infinity) ? 2 : L >= n(p.layer1, Infinity) ? 1 : 0;
  if (t > cur) {
    ctx.setCounter(C_VISI_DISC, t);
    ctx.toast(t >= 2 ? '【远见】所有干员购买价格永久降低' : '【远见】远见干员购买价格永久降低', 'info');
  }
}

function visiDiscount(ctx) {
  const tier2 = buff(ctx, 'visiShip', 'bond_goods_disc_tier2');
  if (tier2.layer_list != null) return { mode: 'tier2', list: tier2.layer_list, discount: tier2.discount, bond: tier2.bond || 'visiShip' };
  const modern = buff(ctx, 'visiShip', 'bond_multi_layer_char_goods_price_bond_discount');
  if (modern.layer1 != null) return modern;
  const own = buff(ctx, 'visiShip', 'bond_layer_char_goods_price_bond_discount');
  const all = buff(ctx, 'visiShip', 'bond_layer_char_goods_price_discount');
  return { layer1: own.layer, layer2: all.layer, discount: all.discount ?? own.discount, bond: own.bond };
}

function visiSettle(ctx) {
  settleCoins(ctx, 'visiShip', C_VISI_PAID, '远见');
  latchVisiDiscount(ctx);
}
const miraSettle = (ctx) => { settleCoins(ctx, 'miraShip', C_MIRA_PAID, '奇迹'); };

/** 规程 奇迹: once layers reach bond_layer_shop_same_tier, every manual refresh forces the first unsold chess slot. */
function forceShopTier(ctx) {
  const p = buff(ctx, 'miraShip', 'bond_layer_shop_same_tier');
  if (p.layer == null || !ctx.bondActive('miraShip')) return;
  if (ctx.layers('miraShip') < n(p.layer, Infinity)) return;
  if (typeof ctx.rollChess !== 'function' || typeof ctx.shopSlots !== 'function' || typeof ctx.setShopSlot !== 'function') return;
  const tier = typeof ctx.shopLevel === 'function' ? ctx.shopLevel() : null;
  if (tier == null) return;
  const slots = ctx.shopSlots();
  // [ASSUMED] the first unsold chess slot, every refresh after the threshold, via rollChess({ tier: shopLevel }).
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot && slot.kind === 'chess' && !slot.sold) {
      const id = ctx.rollChess({ tier });
      if (id) ctx.setShopSlot(i, { ...slot, id, kind: 'chess' });
      return;
    }
  }
}

/** A handler object running `fn(ctx)` on every catch-up hook and on the bond's own layer gains. */
function settler(bondId, fn) {
  const h = { onLayers(ctx, ev) { if (ev && ev.bondId === bondId) fn(ctx); } };
  for (const hook of SETTLE_HOOKS) h[hook] = (ctx) => fn(ctx);
  return h;
}

export function registerMeta(registry) {
  registry.global('bondaddon_prepend', {
    onPrepEnd(ctx) { ctx.setCounter(C_PREP_ENDED, ctx.round); },
  });

  registry.bond('deputShip', {
    onPrepEnd(ctx) {
      const me = ctx.bond('deputShip');
      if (!me || !me.active) return;
      const p = buff(ctx, 'deputShip', 'bond_activated_add_layer');
      const add = me.tier >= 2 ? n(p.more_layer, n(p.layer)) : n(p.layer);
      if (!(add > 0)) return;
      const active = Object.entries(ctx.bonds()).filter(([, b]) => b && b.active).map(([id]) => id);
      for (const id of active) ctx.addLayers(id, add, { requireActive: true, reason: 'bond:deputShip' });
    },
  });

  registry.bond('visiShip', {
    ...settler('visiShip', visiSettle),
    onPrice(ctx, ev) {
      if (!ev || ev.kind !== 'chess') return;
      const t = ctx.counter(C_VISI_DISC);
      if (t <= 0) return;
      const p = visiDiscount(ctx);
      const disc = n(p.discount);
      if (!(disc > 0)) return;
      if (p.mode === 'tier2') {
        const rec = ctx.chessRecord(ev.id);
        if (!rec || !Array.isArray(rec.bonds) || !rec.bonds.includes(p.bond || 'visiShip')) return;
        ctx.modifyPrice(-disc * t);
        return;
      }
      if (t < 2) {
        const rec = ctx.chessRecord(ev.id);
        if (!rec || !Array.isArray(rec.bonds) || !rec.bonds.includes(p.bond || 'visiShip')) return;
      }
      ctx.modifyPrice(-disc); // never below 0 (ctx.modifyPrice); 1 → 0 like any price (owner's decision 2026-10-04)
    },
  });

  registry.bond('miraShip', {
    ...settler('miraShip', miraSettle),
    onRefresh(ctx, ev) {
      if (!ev || ev.trigger || !ctx.bondActive('miraShip')) return;
      forceShopTier(ctx);
      if (ctx.grantFreeRefresh(0) > 0) return;
      const p = buff(ctx, 'miraShip', 'bond_refresh_shop_next_free');
      const chance = Math.max(0, Math.min(1, n(p.baseprob) + n(p.prob) * ctx.layers('miraShip')));
      if (ctx.rng() < chance) {
        ctx.grantFreeRefresh(1);
        ctx.toast('【奇迹】下次刷新不消耗资金', 'info');
      }
    },
  });

  registry.bond('skillfulShip', {
    onRefresh(ctx, ev) {
      if (ev?.trigger || !ctx.bondActive('skillfulShip') || ctx.roundStats().refreshes !== 1) return;
      const p = buff(ctx, 'skillfulShip', 'bond_layer_refresh_shop_award_equip');
      if (ctx.layers('skillfulShip') < n(p.layer, Infinity)) return;
      let left = n(p.count);
      for (const [i, slot] of ctx.shopSlots().entries()) {
        if (left <= 0) break;
        if (slot?.kind === 'item' && !slot.sold) { ctx.setShopSlot(i, { ...slot, price: n(p.price) }); left--; }
      }
    },
  });
}
