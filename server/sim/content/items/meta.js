// server/sim/content/items/meta.js — prep side of the items (docs/META.md registry API).
//
// The engine built-ins (server/match/builtinMeta.js) already implement most consume-on-equip items and Arts from the
// concrete item's params; they are reviewed and kept (盟约之币, 骑士储蓄罐, 随身身份牌, 精打细算玩偶, 简易通讯机 (tier ≤
// shop level), 见钱眼开玩偶, 人事部文档 (cap 9), 博士投影 (golden now / normal at the next round start), 拟态物质, 信标,
// 商业包装方案 (count from the concrete record: 8 / golden 7), 突变细胞 (after the battle the carrier is destroyed, its
// equipment — the cell too, which is not consumed (player feedback after 0.1.0) — returns to the hand, then a NORMAL
// random tier+1 operator, max 6, is gained into the hand, not onto the carrier's tile (PR #2)). The Arts' rangeGrid
// (画卷 = placed tile + the tile in front) and the per-round limit are engine rules.
// Overridden / added here (a built-in, when present, is wrapped — never re-implemented):
//   画卷         the copy keeps the target's items; a copied normal item that pairs with an owned one merges and the
//               golden stays in the hand (the built-in equipped the merged golden on the copy, and its live loop over
//               the target's items skipped the item after a merge)
//   紧急调度券   a shop operator leaves its slot only when it was actually granted (built-in cleared the slot first)
//   寻呼模块     the special refresh shows `refresh_cnt` DIFFERENT operators (fewer when the pool has no more)
//   教鞭       trap_create_self_choice {choice_event: hunter_band_1, choiceType PERSONAL_CHOOSE}: a personal choice of
//               one of THREE 战术特训 cards (choices.json cards.bounty payout `perfect`, e.g. 战术特训·飞行I "若各自行动阶段就
//               达成完美作战，获得1资金") whose enemy the mode can field — PRTS 卫戍协议：盟约 下半/PRTS盟约记录 §法术 教鞭
//               "使用后销毁，于3个战术特训的悬赏任务中选择一项", §机变阶段 "※以下悬赏任务仅由法术教鞭生成", and 杜宾 加练！
//               "<教鞭>：使用后为下场战斗添加额外敌人，若自身战斗完美作战可获得资金". onArt → ctx.offerBountyChoice
//               (Match.offerBountyChoice): the three cards go to the owner alone, who confirms one inside the PREP
//               (g.choice with the offer's id); the prep's deadline or an AI seat resolves it (docs/META.md §2.5). Until
//               0.2.2 the engine took one of the three at random (user playtest #6 item 4 review; the built-in drew any
//               tier ≤ II kill bounty, and research 04 §7 [ASSUMED] the band family `enemyeffect_b_*`).
//   “神秘顾客”  the same trap_create_self_choice ("选择一项特殊悬赏任务"; no band grants it in act2, research 04, and PRTS
//               lists no pool): still [ASSUMED simplification] 3 band bounties `enemyeffect_b_*` (research 04 §7 [ASSUMED]:
//               "adds 1 enemy to your next battle, killer gets `coin` funds") whose enemy can appear in the mode, one of them
//               taken at random; the built-in runs when the family is empty.
//   “神秘顾客”  trap_disney_special: when actively destroyed, +count funds and the Art passes to the next alive player
//               (seat order, cyclic)
//   天师古鼎     equip_with_another_gain_coin_when_gain_char: a 【炎】 carrier also holding 炎国短刀 (either quality)
//               gains `count` funds every time the player gains an operator, at most `max` times per round per item
//
// Each override is declared in OVERRIDES by its item's effectId, the buff key it reads and its default-data item key
// (wrapEffect; versions M0, docs/META.md §2.1). The default data and the plugin content sets built on it bind the
// default key, as before versions M0. Another official version's build (support isVersionData) gives these ids to
// other items: there an override binds the item keys whose normal record carries its effectId AND its buff (support
// itemIdsWithEffect), so an effectId whose mechanic differs there binds nothing. The registry keys stay
// `item:<item key>`, as builtinMeta and the dispatcher expect.

import { itemKeyOf, itemRecord, itemIdsWithEffect, isVersionData, isCoreBond } from '../support/index.js';
import { metaBonds } from '../support/meta.js';
import { msg, dn } from '../../../../shared/i18n.js';

const int = (v, d = 0) => (Number.isFinite(v) ? Math.trunc(v) : d);

/** Params `{ ...bb, ...bbStr }` of the concrete record's buff with official key `key` (null when absent). */
function buffP(ctx, itemId, key) {
  const rec = itemId ? ctx.gd.item(itemId) : null;
  for (const b of (rec && Array.isArray(rec.buffs) ? rec.buffs : [])) if (b && b.key === key) return { ...(b.bb || {}), ...(b.bbStr || {}) };
  return null;
}

/** 【X】盟约干员 on the prep side: own bonds + 变形同构体 grants, or 调和 (maniShip) members while both bonds are active. */
function pieceIsMember(ctx, piece, bondId) {
  const bonds = metaBonds(ctx, piece);
  if (bonds.includes(bondId)) return true;
  return bonds.includes('maniShip') && isCoreBond(bondId) && ctx.bondActive('maniShip') && ctx.bondActive(bondId);
}

/** Cards drawn before “神秘顾客” takes one at random. */
const OFFER_SIZE = 3;
/** cards.bounty entries matching `test` whose enemy can appear in this mode. */
function bountyCards(ctx, test) {
  const all = ctx.data && ctx.data.choices && ctx.data.choices.cards && Array.isArray(ctx.data.choices.cards.bounty) ? ctx.data.choices.cards.bounty : [];
  const inactive = ctx.gd.inactiveEnemies instanceof Set ? ctx.gd.inactiveEnemies : new Set();
  return all.filter((c) => c && test(c) && ctx.gd.enemy(c.enemyKey) && !inactive.has(c.enemyKey));
}
/** The 战术特训 cards (perfect payout: the chooser's own phase perfect) — what 教鞭 offers. */
const isTraining = (c) => c.payout === 'perfect';
/** The band bounty family `enemyeffect_b_*` — what “神秘顾客” offers [ASSUMED]. */
const isBandBounty = (c) => /^enemyeffect_b_\d+$/.test(String(c.effectId));

function wrap(registry, key, hooks) {
  const base = registry.get(`item:${key}`) || {};
  registry.item(key, { ...base, ...hooks(base) });
}

/**
 * The overrides registerMeta installs, in registration order: the item's effectId, the buff key the override reads
 * and the item's key in the default data. 上半's 寻呼模块 (eff_acarm075) is one special refresh of same-bond operators
 * (use_equip_add_goods_rule_with_refresh_shop), not this pick of one of `refresh_cnt`: on that build `pager` binds nothing.
 */
const OVERRIDES = Object.freeze({
  dispatchTicket: Object.freeze({ effectId: 'eff_acarm115', buff: 'use_equip_reward_random_char_chess_in_shop', key: 'chess_item_2_02_e' }),
  pager: Object.freeze({ effectId: 'eff_acarm075', buff: 'use_equip_reward_special_goods_char_chess', key: 'chess_item_4_01_e' }),
  pointer: Object.freeze({ effectId: 'eff_acchal', buff: 'trap_create_self_choice', key: 'chess_item_6_03_m' }),
  customerBounty: Object.freeze({ effectId: 'eff_acdisney', buff: 'trap_create_self_choice', key: 'chess_item_6_01_m' }),
  scroll: Object.freeze({ effectId: 'eff_accopy', buff: 'trap_copy_front_char', key: 'chess_item_6_02_m' }),
  customerDestroy: Object.freeze({ effectId: 'eff_acdisney', buff: 'trap_disney_special', key: 'chess_item_6_01_m' }),
  cauldron: Object.freeze({ effectId: 'eff_acarm077', buff: 'equip_with_another_gain_coin_when_gain_char', key: 'chess_item_6_03_e' }),
});

const carriesBuff = (id, buff) => (itemRecord(id)?.buffs ?? []).some((b) => b && b.key === buff);

/**
 * The item keys an override binds in the loaded data: its default key, or on another version's build the keys whose
 * normal record carries its effectId and its buff, in data order (none: nothing is bound).
 */
function keysOf(o) {
  if (!isVersionData()) return [o.key];
  return [...new Set(itemIdsWithEffect(o.effectId, { normalOnly: true }).filter((id) => carriesBuff(id, o.buff)).map((id) => itemKeyOf(id)))];
}

/** wrap() on every item key override `o` binds in the loaded data (keysOf). */
function wrapEffect(registry, o, hooks) {
  for (const key of keysOf(o)) wrap(registry, key, hooks);
}

/** Tests: each override (OVERRIDES, registration order) with the item keys of the loaded data it binds to. */
export function itemMetaBindings() {
  return Object.entries(OVERRIDES).map(([name, o]) => ({ name, effectId: o.effectId, buff: o.buff, defaultKey: o.key, keys: keysOf(o) }));
}

export function registerMeta(registry) {
  // 紧急调度券 — use_equip_reward_random_char_chess_in_shop {count}
  wrapEffect(registry, OVERRIDES.dispatchTicket, () => ({
    onEquip(ctx, ev) {
      const p = buffP(ctx, ev.item && ev.item.id, 'use_equip_reward_random_char_chess_in_shop') || {};
      const n = Math.max(1, int(p.count, 1));
      const tried = new Set();
      for (let k = 0; k < n; k++) {
        const slots = ctx.shopSlots();
        const idx = slots.map((s, i) => (s && s.kind === 'chess' && !s.sold && !tried.has(i) ? i : -1)).filter((i) => i >= 0);
        if (!idx.length) break;
        const i = ctx.rng.pick(idx);
        const got = ctx.grantChess(slots[i].id);
        if (got) ctx.setShopSlot(i, null);
        else { tried.add(i); k--; }
      }
    },
  }));

  // 寻呼模块 — use_equip_reward_special_goods_char_chess {refresh_cnt, choice_cnt}
  wrapEffect(registry, OVERRIDES.pager, () => ({
    onEquip(ctx, ev) {
      const p = buffP(ctx, ev.item && ev.item.id, 'use_equip_reward_special_goods_char_chess') || {};
      const n = Math.max(1, int(p.refresh_cnt, 3));
      const bonds = new Set(ctx.pieceBonds(ev.target.uid));
      const maxTier = ctx.shopLevel();
      const shares = (id) => { const c = ctx.gd.chess(id); return !!(c && Array.isArray(c.bonds) && c.bonds.some((b) => bonds.has(b))); };
      const ids = [];
      for (let k = 0; k < n; k++) {
        // never the same operator twice (user playtest #6 item 19): fewer cards when the pool has no other one
        const id = ctx.rollChess({ maxTier, filter: (x) => shares(x) && !ids.includes(x) });
        if (id) ids.push(id);
      }
      if (ids.length) ctx.offerChess(ids, { source: 'item' });
      // nothing to offer (e.g. 缪尔赛思's 调和 below shop level 6): still destroyed — say why (GitHub #401, builtinMeta toastNothing)
      else ctx.toast(msg('{who}：没有可获得的同盟约干员', { who: dn(ctx.gd.item(ev.item?.id)?.name || '') }), 'warn');
    },
  }));

  // 教鞭 — trap_create_self_choice {choice_event}: the server keeps the offered 战术特训 cards until confirmed.
  wrapEffect(registry, OVERRIDES.pointer, () => ({
    onArt(ctx, ev) {
      const result = ctx.offerBountyChoice(bountyCards(ctx, isTraining), ev.item.id);
      if (!result.ok) { ev.error = result.error; ev.detail = result.detail; }
    },
  }));

  // “神秘顾客” — a random band bounty (enemyeffect_b_*).
  wrapEffect(registry, OVERRIDES.customerBounty, (base) => ({
    onArt(ctx, ev) {
      const cards = bountyCards(ctx, isBandBounty);
      if (!cards.length) { if (typeof base.onArt === 'function') base.onArt.call(base, ctx, ev); return; }
      const offer = ctx.rng.shuffle(cards.slice()).slice(0, OFFER_SIZE);
      const card = ctx.rng.pick(offer);
      if (!card || !ctx.addBounty(card)) { ev.error = 'BAD_TARGET'; ev.detail = 'no bounty available'; }
    },
  }));

  // 画卷 — trap_copy_front_char: copy the operator in range (elite status included) and its equipment. The copied items
  // are gained unequipped, like any gained item — the hand, overflow temp, destroyed with the usual toast when both are
  // full — never put on the copy (PRTS 画卷 备注 "使用后销毁，获得的装备为未装备状态"; until 0.2.2 a copied item that did
  // not merge was equipped onto the copy). A copied normal item that completes a pair with an owned one merges at once,
  // the golden in the hand (research 04 addendum "两个同名道具（无论是否被装备）会自动合并…并自动返回整备区"). A copy that
  // completes a three-copy merge (GitHub #389, PR #390): the promotion returns the copies' equipment to the hand too
  // (PRTS 帮助 "在失去该干员（…合并等）…时自动卸除"), so the elite wears nothing and a copied normal item merges with the
  // returned original.
  wrapEffect(registry, OVERRIDES.scroll, () => ({
    onArt(ctx, ev) {
      const target = (ev.targets || []).find((p) => p && p.kind === 'chess');
      if (!target) { ev.error = 'BAD_TARGET'; ev.detail = 'no operator in range'; return; }
      // snapshot before the gain: a gain that completes a merge consumes the target and empties `target.items`, and an
      // item merge detaches the original's copy from `target.items` while we iterate (the built-in's live loop then
      // skipped the next item)
      const itemIds = (target.items || []).map((it) => it.id);
      const copy = ctx.grantChess(target.id, { requirePool: false, source: 'item:chess_item_6_02_m' });
      if (!copy) { ev.error = 'HAND_FULL'; return; }
      for (const itemId of itemIds) ctx.grantItem(itemId, { source: 'item:chess_item_6_02_m' });
    },
  }));

  // “神秘顾客” — trap_create_self_choice (bounty above) + trap_disney_special {count}
  wrapEffect(registry, OVERRIDES.customerDestroy, () => ({
    onDestroy(ctx, ev) {
      if (!ev || ev.reason !== 'player') return;
      const item = ev.item || ctx.source.piece;
      const p = buffP(ctx, item && item.id, 'trap_disney_special') || {};
      const n = int(p.count, 1);
      if (n > 0) ctx.addFunds(n, 'item');
      const mates = ctx.teammates();
      if (!mates.length || !item) return;
      const seat = Number.isInteger(ctx.seat) ? ctx.seat : 0;
      const dist = (t) => { const s = Number.isInteger(t.seat) ? t.seat : 0; return ((s - seat) % 64 + 64) % 64 || 64; };
      const next = mates.slice().sort((a, b) => dist(a) - dist(b))[0];
      if (next) next.grantItem(item.id, { source: 'item' });
    },
  }));

  // 天师古鼎 — equip_with_another_gain_coin_when_gain_char {count, max} {other_equip, bond}
  wrapEffect(registry, OVERRIDES.cauldron, (base) => ({
    onGain(ctx, ev) {
      if (typeof base.onGain === 'function') base.onGain.call(base, ctx, ev);
      if (!ev || ev.kind !== 'chess' || !ev.piece) return;
      const { piece, holder } = ctx.source;
      if (!piece || !holder) return;
      const p = buffP(ctx, piece.id, 'equip_with_another_gain_coin_when_gain_char');
      if (!p) return;
      const bond = typeof p.bond === 'string' && p.bond ? p.bond : 'yanShip';
      const others = String(p.other_equip || '').split(',').map((s) => itemKeyOf(s.trim())).filter(Boolean);
      const fresh = ctx.piece(holder.uid) || holder;
      const carries = (fresh.items || []).some((it) => it && it.uid !== piece.uid && others.includes(itemKeyOf(it.id)));
      if (!carries || !pieceIsMember(ctx, fresh, bond)) return;
      const k = `cauldron:${piece.uid}:${ctx.round}`;
      if (ctx.counter(k) >= Math.max(0, int(p.max, 3))) return;
      ctx.incCounter(k);
      ctx.addFunds(int(p.count, 2), 'item');
    },
  }));
}
