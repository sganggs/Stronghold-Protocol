// server/match/builtinMeta.js — engine built-in prep effects registered BEFORE content (content overrides a key by
// registering it again). They cover the purely meta, data-driven pieces the match needs to be playable before the
// content phase lands: consume-on-equip items, Arts, a few persistent EffectRefs used by 机变 defaults.
//
// Items are matched by their official buff key (data/items.json buffs[].key), numbers come from the item's params
// (normal `_a` / golden `_b` record), never hard-coded:
//   equip_destory_gain_random_coin {min,max}              盟约之币 / 骑士储蓄罐   funds += rand[min,max]
//   use_equip_reward_char_chess_bond_layer {layer}        随身身份牌             layers of the target's bonds (无需激活)
//   use_equip_reward_random_char_chess_in_shop {count}    紧急调度券             take `count` random chess from the shop
//   gain_coin_when_round_start {count}                    精打细算玩偶           +count funds every round start
//   use_equip_reward_char_chess_with_same_bond {count}    简易通讯机             `count` random chess sharing a bond
//   use_equip_gain_coin_when_next_round_start {count}     见钱眼开玩偶           +count funds next round
//   equip_destory_deployment_cnt_change {count}           人事部文档             deploy cap = count
//   use_equip_upgrade_char / equip_round_start_upgrade_char 博士投影             promote (golden: now, normal: next round)
//   use_equip_reward_char_chess                           拟态物质               3rd copy or a same-bond chess
//   use_equip_reward_special_goods_char_chess {refresh_cnt} 寻呼模块             offer N same-bond chess (≤ shop level)
//   use_equip_recruit_new_char_and_give_char_to_player_most_bond {refresh_cnt} 信标 destroy target, offer N same-tier
//                                                                                chess, gift the original (an elite stays
//                                                                                elite) next prep, sender eliminated or not
//   sell_char_count_gain_equip_owner_bond {count}         商业包装方案           every `count` sells → same-bond chess
//   char_chess_transformation_equip                       突变细胞               after battle: holder destroyed, its equipment
//                                                                                (the cell included — not consumed) back to
//                                                                                the hand, then a random NORMAL tier+1 (max 6)
//                                                                                operator gained into the hand
//   trap_copy_front_char                                  画卷 (Art)            copy the chess on the tile / in front
//   trap_create_self_choice {choice_event}                教鞭 / 神秘顾客 (Art)  add a random bounty to your next battle
// [ASSUMED simplification, documented in docs/META.md: 教鞭/神秘顾客 pick the bounty for the player instead of opening
//  a personal choice overlay.]

import { getData } from '../data.js';
import { itemKey } from './gamedata.js';

const int = (v, d = 0) => (Number.isFinite(v) ? Math.trunc(v) : d);

/** item record params of the concrete (normal/golden) item */
const paramsOf = (ctx, item) => {
  const rec = item ? ctx.gd.item(item.id) : null;
  return rec && rec.params && typeof rec.params === 'object' ? rec.params : {};
};

/** random chess sharing at least one bond with `bonds`, tier ≤ maxTier */
function rollSameBond(ctx, bonds, maxTier, exclude = null) {
  const set = new Set(bonds);
  return ctx.rollChess({ maxTier, filter: (id) => { const c = ctx.gd.chess(id); return !!(c && Array.isArray(c.bonds) && c.bonds.some((b) => set.has(b))) && !(exclude && exclude.includes(id)); } });
}

/** 信标: the living teammate (not the caller) with the most members of `bonds` ("相应盟约人数最多"), ties at random; null without one. */
function mostBondMate(ctx, bonds) {
  const mates = ctx.teammates();
  if (!mates.length) return null;
  let best = -1;
  let pick = [];
  for (const t of mates) {
    const score = bonds.reduce((s, b) => s + t.bondCount(b), 0);
    if (score > best) { best = score; pick = [t]; } else if (score === best) pick.push(t);
  }
  return ctx.rng.pick(pick) || null;
}

const ITEM_HANDLERS = {
  equip_destory_gain_random_coin: {
    onEquip(ctx, ev) {
      const p = paramsOf(ctx, ev.item);
      const lo = int(p.min, 1);
      const hi = Math.max(lo, int(p.max, lo));
      ctx.addFunds(lo + ctx.rng.int(hi - lo + 1), 'item');
    },
  },
  use_equip_reward_char_chess_bond_layer: {
    onEquip(ctx, ev) {
      const n = int(paramsOf(ctx, ev.item).layer, 3);
      for (const b of ctx.pieceBonds(ev.target.uid)) ctx.addLayers(b, n, { requireActive: false, reason: 'item' });
    },
  },
  use_equip_reward_random_char_chess_in_shop: {
    onEquip(ctx, ev) {
      const n = Math.max(1, int(paramsOf(ctx, ev.item).count, 1));
      for (let k = 0; k < n; k++) {
        const slots = ctx.shopSlots();
        const idx = slots.map((s, i) => (s && s.kind === 'chess' && !s.sold ? i : -1)).filter((i) => i >= 0);
        if (!idx.length) break;
        const i = ctx.rng.pick(idx);
        const id = slots[i].id;
        ctx.setShopSlot(i, null);
        ctx.grantChess(id);
      }
    },
  },
  gain_coin_when_round_start: {
    onEquip(ctx, ev) {
      const n = int(paramsOf(ctx, ev.item).count, 1);
      const rec = ctx.gd.item(ev.item.id);
      ctx.addEffect({
        id: `doll:${ev.item.uid}`, key: 'effect:builtin_round_coin', name: rec ? rec.name : '精打细算玩偶', desc: rec ? rec.desc : '',
        iconKind: 'item', iconId: rec ? rec.iconId || rec.id : ev.item.id, battle: false, params: { count: n },
      });
    },
  },
  use_equip_reward_char_chess_with_same_bond: {
    onEquip(ctx, ev) {
      const n = Math.max(1, int(paramsOf(ctx, ev.item).count, 1));
      const bonds = ctx.pieceBonds(ev.target.uid);
      for (let k = 0; k < n; k++) {
        const id = rollSameBond(ctx, bonds, ctx.shopLevel());
        if (id) ctx.grantChess(id);
      }
    },
  },
  use_equip_gain_coin_when_next_round_start: {
    onEquip(ctx, ev) { ctx.addPendingFunds(int(paramsOf(ctx, ev.item).count, 2)); },
  },
  equip_destory_deployment_cnt_change: {
    onEquip(ctx, ev) { ctx.setDeployCapAtLeast(int(paramsOf(ctx, ev.item).count, 9)); },
  },
  use_equip_upgrade_char: {
    onEquip(ctx, ev) {
      if (ctx.gd.isGolden(ev.target.id)) { ev.error = 'BAD_TARGET'; ev.detail = 'already elite'; return; }
      ctx.promote(ev.target.uid);
    },
  },
  equip_round_start_upgrade_char: {
    onEquip(ctx, ev) {
      if (ctx.gd.isGolden(ev.target.id)) { ev.error = 'BAD_TARGET'; ev.detail = 'already elite'; return; }
      ev.keep = true; // stays equipped until the next round start
    },
    onRoundStart(ctx) {
      const { piece, holder } = ctx.source;
      if (!piece || !holder) return;
      ctx.destroyPiece(piece.uid);
      ctx.promote(holder.uid);
    },
  },
  use_equip_reward_char_chess: {
    onEquip(ctx, ev) {
      const base = ctx.gd.baseIdOf(ev.target.id);
      const owned = [...ctx.board(), ...ctx.hand(), ...ctx.temp()].filter((p) => p && p.kind === 'chess' && !p.golden && ctx.gd.baseIdOf(p.id) === base).length;
      if (owned >= 2) { if (ctx.grantChess(base)) return; }
      const id = rollSameBond(ctx, ctx.pieceBonds(ev.target.uid), 6);
      if (id) ctx.grantChess(id);
    },
  },
  use_equip_reward_special_goods_char_chess: {
    onEquip(ctx, ev) {
      const n = Math.max(1, int(paramsOf(ctx, ev.item).refresh_cnt, 3));
      const bonds = ctx.pieceBonds(ev.target.uid);
      const ids = [];
      // a pick-one offer never shows one operator twice (user playtest #6 item 19); fewer cards when the pool runs out
      for (let k = 0; k < n; k++) { const id = rollSameBond(ctx, bonds, ctx.shopLevel(), ids); if (id) ids.push(id); }
      if (ids.length) ctx.offerChess(ids, { source: 'item' });
    },
  },
  // 信标 (act2autochess eff_acarm109 / eff_acgarm109 "装备时，目标干员和本装备销毁并进行一次特殊刷新，出现两名与携带者同等阶的
  // 干员，免费获取其中一名 / 若在同盟模拟中且存在其他队友，下个休整期向相应盟约人数最多的队友发送1个原干员 / 相应盟约人数相同则
  // 随机发送"; 芬 band_fang "原干员在下回合传递给对应盟约人数最多的队友"). The gift is the ORIGINAL operator: an elite carrier
  // is sent as that elite (community report #6 after 0.1.2: it arrived as the normal card — the gift carried baseIdOf).
  // Destroying the carrier returns its pool copies (an elite's 3) at once; the gift takes them again when it is granted
  // (effect:builtin_gift: grantChess → acquireChess, an elite takes up to goldenCopies, as every effect grant).
  use_equip_recruit_new_char_and_give_char_to_player_most_bond: {
    onEquip(ctx, ev) {
      const target = ctx.piece(ev.target.uid);
      if (!target) return;
      const tier = ctx.gd.tierOf(target.id);
      const n = Math.max(1, int(paramsOf(ctx, ev.item).refresh_cnt, 2));
      const bonds = ctx.pieceBonds(target.uid);
      const original = target.id; // the elite id for an elite (report #6)
      ctx.destroyPiece(target.uid);
      const ids = [];
      // different operators of the target's tier, topped up from the tier below like the promotion reward (item 19)
      for (let k = 0; k < n; k++) {
        let id = null;
        for (let t = tier; t >= 1 && !id; t--) id = ctx.rollChess({ tier: t, filter: (x) => !ids.includes(x) });
        if (id) ids.push(id);
      }
      if (ids.length) ctx.offerChess(ids, { source: 'item', tier });
      // co-op: next prep, send the original chess to the teammate with the most members of its bonds
      const to = mostBondMate(ctx, bonds);
      if (to) ctx.addEffect({ id: `gift:${ev.item.uid}`, key: 'effect:builtin_gift', hidden: true, battle: false, params: { toPlayerId: to.playerId, chessId: original, bonds } });
    },
  },
  sell_char_count_gain_equip_owner_bond: {
    onSold(ctx) {
      const { piece, holder } = ctx.source;
      if (!piece || !holder) return;
      const need = Math.max(1, int(paramsOf(ctx, piece).count, 8));
      const k = `pack:${piece.uid}`;
      if (ctx.incCounter(k) >= need) {
        ctx.setCounter(k, 0);
        const id = rollSameBond(ctx, ctx.pieceBonds(holder.uid), ctx.shopLevel());
        if (id) ctx.grantChess(id);
      }
    },
  },
  // 突变细胞 "战斗结束后，装备者替换为高一阶的随机干员": PRTS 卫戍协议：盟约 下半/PRTS盟约记录 备注 "生效时，原干员销毁，获得
  // 一名高一阶的随机初始干员（最高六阶）" — the carrier (deployed or on the bench) is destroyed and a random NORMAL operator
  // one tier higher (at most 6; an elite carrier too) is gained like any gained operator: into the 整备区 (overflow temp),
  // never onto the carrier's tile — official footage (bilibili BV1vzyVBuEN9 ≈ 8:24, BV1Qkw1zMEoR ≈ 7:25): at the next
  // prep the tile is empty, one more deployment is left and the new operator waits on the bench (pointed out in PR #2).
  // The destroyed operator's equipment, the cell included, returns to the hand first (PRTS 卫戍协议/帮助 "佩戴的装备无法
  // 手动卸除，在失去该干员（干员出售、销毁、合并等）或装备合并为进阶品质时自动卸除"; the official text never says 销毁 for the
  // cell — unlike every consumable item —, and players re-inject it every round: "之后就是一直打针，扎到核心卡…就换人扎",
  // bilibili cv47000418; player feedback after 0.1.0). PlayerState.transformChess.
  char_chess_transformation_equip: {
    onBattleResult(ctx) {
      const { piece, holder } = ctx.source;
      if (!piece || !holder || !ctx.piece(holder.uid)) return;
      const tier = Math.min(6, ctx.gd.tierOf(holder.id) + 1);
      const id = ctx.rollChess({ tier });
      if (!id) return;
      ctx.transform(holder.uid, ctx.gd.baseIdOf(id));
    },
  },
  trap_copy_front_char: {
    onArt(ctx, ev) {
      const target = ev.targets.find((p) => p.kind === 'chess');
      if (!target) { ev.error = 'BAD_TARGET'; ev.detail = 'no operator in range'; return; }
      const copy = ctx.grantChess(target.id, { requirePool: false });
      if (!copy) { ev.error = 'HAND_FULL'; return; }
      for (const it of target.items || []) {
        const itemPiece = ctx.grantItem(it.id);
        if (itemPiece) ctx.equipDirect(itemPiece.uid, copy.uid);
      }
    },
  },
  trap_create_self_choice: {
    onArt(ctx, ev) {
      const rec = ctx.gd.item(ev.item.id);
      const perfectOnly = !!(rec && typeof rec.desc === 'string' && rec.desc.includes('完美'));
      const cards = ((ctx.data.choices && ctx.data.choices.cards && ctx.data.choices.cards.bounty) || [])
        .filter((c) => c && c.tier <= 2 && (perfectOnly ? c.payout === 'perfect' : c.payout === 'kill') && ctx.gd.enemy(c.enemyKey) && !ctx.gd.inactiveEnemies.has(c.enemyKey));
      const card = ctx.rng.pick(cards);
      if (!card) { ev.error = 'BAD_TARGET'; ev.detail = 'no bounty available'; return; }
      ctx.addBounty(card);
    },
  },
};

/** Persistent EffectRef handlers used by built-ins and 机变 defaults. */
const EFFECT_HANDLERS = {
  builtin_round_coin: {
    onRoundStart(ctx) {
      const n = int(ctx.source.ref && ctx.source.ref.params && ctx.source.ref.params.count, 0);
      if (n > 0) ctx.addFunds(n, 'doll');
    },
  },
  // 信标's gift: at the next round start (下个休整期) the original operator goes to the teammate picked at equip time. It
  // hangs on the SENDER and runs even when the sender was eliminated in between (`afterElimination`: Match.startRound →
  // EffectDispatcher.dispatchEliminated) — an eliminated player gets no onRoundStart, so the gift was lost (GitHub #86).
  // A receiver eliminated meanwhile is replaced by the living teammate with the most members of the operator's bonds
  // (ties at random) [ASSUMED]; with no teammate left alive the gift is dropped. The effect is removed only after the
  // operator was granted: a grant that fails (no copy of it left in the shared pool, the receiver's 整备区 and temp
  // full) keeps it for the next round start — the official text names no refund [ASSUMED].
  builtin_gift: {
    afterElimination: true,
    onRoundStart(ctx) {
      const ref = ctx.source.ref;
      const p = ref.params || {};
      const rec = p.chessId ? ctx.gd.chess(p.chessId) : null;
      if (!rec) { ctx.removeEffect(ref.id); return; }
      const to = ctx.player(p.toPlayerId) || mostBondMate(ctx, Array.isArray(p.bonds) ? p.bonds : rec.bonds || []);
      if (!to) { ctx.removeEffect(ref.id); return; }
      if (!to.grantChess(p.chessId)) return;
      ctx.removeEffect(ref.id);
      to.giftTicker(ctx.name, p.chessId);
    },
  },
  // 整备: the next purchased item becomes advanced (golden)
  builtin_next_buy_golden_item: {
    onBuy(ctx, ev) {
      const ref = ctx.source.ref;
      if (ev.kind !== 'item' || !ev.piece || ctx.gd.isGolden(ev.piece.id)) return;
      if (ctx.upgradeItem(ev.piece.uid)) {
        ref.counter = Math.max(0, (ref.counter || 1) - 1);
        if (ref.counter <= 0) ctx.removeEffect(ref.id);
      }
    },
  },
  // 升华: the next purchased operator becomes elite
  builtin_next_buy_elite: {
    onBuy(ctx, ev) {
      const ref = ctx.source.ref;
      if (ev.kind !== 'chess' || !ev.piece || ctx.gd.isGolden(ev.piece.id)) return;
      if (ctx.promote(ev.piece.uid)) {
        ref.counter = Math.max(0, (ref.counter || 1) - 1);
        if (ref.counter <= 0) ctx.removeEffect(ref.id);
      }
    },
  },
};

/**
 * Register the built-ins on a registry. Item keys are resolved from the loaded data by buff key.
 * @param {import('./effectsMeta.js').MetaRegistry} reg
 * @param {Readonly<Record<string, any>>} [data]
 */
export function registerBuiltins(reg, data = null) {
  let d = data;
  if (!d) { try { d = getData({ log: { warn() {}, error() {}, info() {} } }); } catch { d = {}; } }
  const items = d && d.items && typeof d.items === 'object' ? d.items : {};
  const done = new Set();
  for (const [id, rec] of Object.entries(items)) {
    if (!rec || !Array.isArray(rec.buffs)) continue;
    const key = itemKey(id);
    if (done.has(key)) continue;
    // golden and normal share the key; prefer the normal record's buff (博士投影 differs: handled by a merged handler)
    const buffKeys = new Set();
    for (const sib of [items[`${key}_a`], items[`${key}_b`], items[key]]) {
      if (sib && Array.isArray(sib.buffs)) for (const b of sib.buffs) if (b && typeof b.key === 'string') buffKeys.add(b.key);
    }
    const handlers = [...buffKeys].map((k) => ITEM_HANDLERS[k]).filter(Boolean);
    if (!handlers.length) continue;
    done.add(key);
    reg.register(`item:${key}`, mergeHandlers(handlers, buffKeys));
  }
  for (const [k, h] of Object.entries(EFFECT_HANDLERS)) reg.register(`effect:${k}`, h);
  return reg;
}

/**
 * Combine several buff-key handlers of one item family (e.g. 博士投影 normal = delayed, golden = immediate): each hook
 * dispatches to the handler whose buff key belongs to the concrete item (normal/golden) in the event.
 */
function mergeHandlers(handlers, buffKeys) {
  if (handlers.length === 1) return handlers[0];
  const byKey = [...buffKeys].filter((k) => ITEM_HANDLERS[k]).map((k) => [k, ITEM_HANDLERS[k]]);
  const out = {};
  const hooks = new Set();
  for (const [, h] of byKey) for (const name of Object.keys(h)) hooks.add(name);
  for (const hook of hooks) {
    out[hook] = function (ctx, ev) {
      const item = (ev && ev.item) || (ctx.source && ctx.source.piece);
      const rec = item ? ctx.gd.item(item.id) : null;
      const own = new Set(rec && Array.isArray(rec.buffs) ? rec.buffs.map((b) => b.key) : []);
      for (const [k, h] of byKey) if (own.has(k) && typeof h[hook] === 'function') h[hook](ctx, ev);
    };
  }
  return out;
}

export const BUILTIN_ITEM_BUFF_KEYS = Object.freeze(Object.keys(ITEM_HANDLERS));
export const BUILTIN_EFFECT_KEYS = Object.freeze(Object.keys(EFFECT_HANDLERS).map((k) => `effect:${k}`));
