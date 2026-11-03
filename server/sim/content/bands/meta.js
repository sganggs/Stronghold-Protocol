// server/sim/content/bands/meta.js — prep side of the 40 strategies (bands, data/bands.json).
//
// Every band handler is assembled from the band's buffs by their official buff key (numbers from bb / bbStr, never
// hard-coded); keys that only act in battle (env_gbuff_new_with_verify, auto_chess_change_map) live in battle.js.
// Starting LP (totalHp) and 坎诺特's leftover funds are the match's own rules.
//
//   prep_finish_char_bond_add_layer {layer}            华法琳   prep end: per distinct board tier, 1 random op → its bonds +layer (无需激活)
//   band_first_self_refresh_present_char {count,bond}  杜遥夜   first 2 manual refreshes/round: ≥count <bond> chess (tier ≤ shop level)
//   band_shop_refresh_copy_max_lv_char {count}         梓兰     every manual refresh: highest-tier shop chess copied into another slot, copy frozen
//   preparation_start_gain_chess_from_round {round}    梓兰/小贾斯汀/昆图斯/马克维茨/变形者集群/Pith/夕/杰西卡/缪尔赛思/芬  prep start of `round`: bbStr.chess
//   preparation_start_gain_chess_every_n_round {round} 杜宾     prep start, every `round` rounds (round % n = 0): bbStr.chess
//   give_coin_in_round {round,coin}                    老鲤     income of round `round` = coin (R1/R2 0, R3 15)
//   prep_start_gain_chess_from_pool_in_round {round}   老鲤     prep start of `round`: 1 chess of pool
//   band_coin_cost_gain_random_char_by_shop_level      绮良     every coin_cnt funds spent → count random chess ≤ shop level
//   up_shop_next_refresh_must_present_bond_char        佩佩     level-up to a level of lvlist → the next manual refresh (its usual
//                                                               price) prefers <bond>
//   gain_bond_char_per_round {round,preround,bond}     哈洛德   rounds round, round+preround, …: a <bond> chess (≤ shop level, else any tier)
//   first_buy_in_round_char_price_change {price,bond}  休露丝   first <bond> chess of the round costs `price` (bought in the
//                                                               shop: onBuy — a free pick / grant never uses it up)
//   band_cost_coin_reach_cnt_gain_chess_from_pool      潘格尼尼 once coin_cnt funds spent in total: 1 chess of pool (elite 拉特兰 ≥ T4)
//   round_start_bond_check_gain_layer                  余       round start of `round`: exactly factioncount active bonds → +count1, else each active +count2
//                                                               — never to a bond without layers (noStack; the owner's decision of 2026-10-08)
//   up_shop_add_special_goods {count,choice,pool}      凯瑟琳   every level-up: pick 1 of `count` items of pool (free)
//   coin_carry_over {capital,interest,max}             坎诺特   leftover ≥ capital at round start → +min(max, ⌊left/capital⌋×interest) income
//   round_start_all_player_change_enemy_2              鸭爵     global: every alive player's battle from `round` (own + teammates;
//                                                                normal, Final Assault, Hidden Core — on the player's half of a
//                                                                pair field): 0–2 ground enemies → enemylist
//   round_start_activate_char_chess_effect_in_board    铃兰     round start: 获得时 traits of the right-most (then bottom-most) board op with one
//   first_sell_char_chess_exchange_char_chess_in_shop  巫恋     first sale of a normal op per round: swapped with a random shop chess (no funds)
//   round_start_gain_char_chess_in_shop_every_n_round  松桐     prep start, round % n = 0: a random shop chess for free (its slot empties)
//   round_start_gain_coin_by_bond_char_chess_buy       玛恩纳   each <bond> chess bought → +count funds next round (≤ max_count / round)
//   refresh_shop_count_gain_coin_bond_char_chess       贾维     every refresh_count manual refreshes (match total) → <bond> chess ≤ shop level (≤ max_count / round)
//   preparation_start_add_special_goods_every_n_round  娜仁图亚 prep start, round % n = 0: pick choice_cnt of refresh_cnt items of pool (free)
// "进入休整期时" / "休整期开始时" = onPrepStart: after the round's 机变 phase (research 01 §4.1: the 机变 choice is step 4, the
// 「进入休整期时」 effects step 6; official 「进入此阶段时，触发<进入休整期时>的效果」 of the 休整期). The five keys above whose text or key
// says so (老鲤 「第3回合进入休整期时」, 松桐 「偶数回合的休整期开始时」, 娜仁图亚 / 小贾斯汀 / 杰西卡 「进入休整期时」, the
// preparation_start_* keys of the rest) run there — GitHub #851: 老鲤's R3 operators showed before the R3 draft. The whole key
// moves, so 缪尔赛思's 「在第1回合开始时」 and the texts with no time (「第3回合获得」, 「每5回合获得」) follow their key [ASSUMED]. A
// 机变 round (config spRounds) meets 老鲤 / 昆图斯 at R3 and the even-round ones (杜宾, 松桐, 娜仁图亚) at R6 of NORMAL; elsewhere
// only the order around the round start changes. "回合开始时" (余, 铃兰) and 哈洛德's gain_bond_char_per_round stay onRoundStart.
// The operators' 「<进入休整期时>」 traits (SERVER_PREP_START garrisons) run on onPrepStart too (effectsMeta.js GARRISON_HOOK,
// DESIGN §35.53), after the strategy's grants of that dispatch (global → band → bonds → garrisons).

import { GEO, gateOf } from '../../../../shared/constants.js';
import { bbCap } from '../../../../shared/plugins/officialBounds.js';
import { burstLimit } from '../../../../shared/plugins/steps.js';
import { createRng } from '../../rng.js';
import { buffsOf, num, bandRecord, bandEffectId, gameData, mutationCellIds } from '../support/index.js';
import { metaBonds } from '../support/meta.js';
import * as garrisons from '../garrisons.js';

const int = (v, d = 0) => Math.trunc(num(v, d));
// [ASSUMED] DESIGN §32.5: bb.count grant and slot loops share the official `count` cap. Read at call time.
const timesOf = (v, d = 1) => Math.min(bbCap('count'), Math.max(1, int(v, d)));
const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const hasBond = (ctx, id, bond) => { const c = ctx.gd.chess(id); return !!(c && Array.isArray(c.bonds) && c.bonds.includes(bond)); };
const isNormalChess = (ctx, id) => { const c = ctx.gd.chess(id); return !!(c && !c.isGolden); };

/** Per-round counter: reset lazily when the round changes. */
function roundCounter(ctx, key) {
  if (ctx.counter(`${key}:r`) !== ctx.round) { ctx.setCounter(`${key}:r`, ctx.round); ctx.setCounter(key, 0); }
  return ctx.counter(key);
}
const bumpRound = (ctx, key, n = 1) => { roundCounter(ctx, key); return ctx.incCounter(key, n); };

/** Grant a chess or an item by id. */
function grant(ctx, id, opts = {}) {
  if (ctx.gd.item(id)) return ctx.grantItem(id, opts);
  if (ctx.gd.chess(id)) return ctx.grantChess(id, opts);
  return null;
}

/** Indices of unsold chess slots of the shop. */
const chessSlots = (ctx) => ctx.shopSlots().map((s, i) => (s && s.kind === 'chess' && !s.sold ? i : -1)).filter((i) => i >= 0);

/** Up to `n` distinct item ids of an equip pool. */
function rollItems(ctx, poolId, n, exclude = []) {
  const out = [];
  if (exclude.length) {
    // [ASSUMED] After Cathy's allowance is used, sample eligible items without replacement, up to count (official
    // aceffect_band_26). Filter before drawing so forbidden/repeated ids cannot underfill a fresh offer.
    for (let k = 0; k < n; k++) {
      const r = ctx.rollPool(poolId, { exclude: [...exclude, ...out] });
      if (!r || r.kind !== 'item') break;
      out.push(r.id);
    }
    return out;
  }
  for (let k = 0; k < n * 6 && out.length < n; k++) {
    const r = ctx.rollPool(poolId);
    if (!r || r.kind !== 'item') break;
    if (!out.includes(r.id)) out.push(r.id);
  }
  return out;
}

/** Random chess of `bond`, tier ≤ shop level (fallback: any tier when `anyTier`). */
function rollBond(ctx, bond, { anyTier = false } = {}) {
  return ctx.rollChess({ bond, maxTier: Math.max(1, ctx.shopLevel()) }) || (anyTier ? ctx.rollChess({ bond, maxTier: 6 }) : null);
}

// ---------------------------------------------------------------------------------------------------------------
// buff key → (params[], bandId) → hooks

const K = {};

K.prep_finish_char_bond_add_layer = (ps) => ({
  onPrepEnd(ctx) {
    const n = int(ps[0].layer, 0);
    if (n <= 0) return;
    const byTier = new Map();
    for (const p of ctx.board()) {
      if (!p || p.kind !== 'chess') continue;
      const t = p.tier ?? ctx.gd.tierOf(p.id);
      if (!byTier.has(t)) byTier.set(t, []);
      byTier.get(t).push(p);
    }
    for (const t of [...byTier.keys()].sort((a, b) => a - b)) {
      const p = ctx.rng.pick(byTier.get(t));
      for (const b of metaBonds(ctx, p)) ctx.addLayers(b, n, { requireActive: false, reason: 'band' });
    }
  },
});

K.band_first_self_refresh_present_char = (ps) => ({
  onRefresh(ctx) {
    const p = ps[0];
    if ((ctx.roundStats().refreshes || 0) > 2) return;
    const need = timesOf(p.count, 1);
    const idx = chessSlots(ctx);
    const slots = ctx.shopSlots();
    let have = idx.filter((i) => hasBond(ctx, slots[i].id, p.bond)).length;
    const others = ctx.rng.shuffle(idx.filter((i) => !hasBond(ctx, slots[i].id, p.bond)));
    for (const i of others) {
      if (have >= need) break;
      const id = rollBond(ctx, p.bond);
      if (!id) break;
      ctx.setShopSlot(i, { kind: 'chess', id });
      have++;
    }
  },
});

K.band_shop_refresh_copy_max_lv_char = () => ({
  onRefresh(ctx) {
    const slots = ctx.shopSlots();
    const idx = chessSlots(ctx);
    if (idx.length < 2) return;
    let best = -1;
    for (const i of idx) best = Math.max(best, ctx.gd.tierOf(slots[i].id));
    const src = ctx.rng.pick(idx.filter((i) => ctx.gd.tierOf(slots[i].id) === best));
    const dst = ctx.rng.pick(idx.filter((i) => i !== src));
    ctx.setShopSlot(dst, { kind: 'chess', id: slots[src].id, frozen: true });
  },
});

K.preparation_start_gain_chess_from_round = (ps) => ({
  onPrepStart(ctx) {
    for (const p of ps) {
      const id = p.chess ?? p.chess_id;
      if (ctx.round !== int(p.round, -1) || !id) continue;
      for (let k = 0; k < timesOf(p.count, 1); k++) grant(ctx, id, { requirePool: false, source: 'band' });
    }
  },
});

K.preparation_start_gain_chess_every_n_round = (ps) => ({
  onPrepStart(ctx) {
    for (const p of ps) {
      const n = int(p.round, 0);
      const id = p.chess ?? p.chess_id;
      if (n <= 0 || ctx.round % n !== 0 || !id) continue;
      for (let k = 0; k < timesOf(p.count, 1); k++) grant(ctx, id, { source: 'band' });
    }
  },
});

K.give_coin_in_round = (ps) => ({
  onIncome(ctx, ev) {
    for (const p of ps) if (ctx.round === int(p.round, -1)) ev.income = Math.max(0, int(p.coin, 0));
  },
});

K.prep_start_gain_chess_from_pool_in_round = (ps) => ({
  onPrepStart(ctx) {
    for (const p of ps) {
      if (ctx.round !== int(p.round, -1)) continue;
      for (let k = 0; k < timesOf(p.count, 1); k++) {
        const r = ctx.rollPool(p.pool);
        if (r) grant(ctx, r.id, { source: 'band' });
      }
    }
  },
});

K.band_coin_cost_gain_random_char_by_shop_level = (ps) => ({
  onSpend(ctx, ev) {
    const p = ps[0];
    const step = int(p.coin_cnt, 0);
    if (step <= 0 || !(ev.amount > 0)) return;
    let acc = ctx.incCounter('band:kirara:acc', ev.amount);
    let guard = 0;
    const limit = burstLimit(10000); // [ASSUMED] one spend cannot grant more than this many shop rolls
    while (acc >= step && guard++ < limit) { // loop-cap: coin_cnt
      acc = ctx.incCounter('band:kirara:acc', -step);
      for (let k = 0; k < timesOf(p.count, 1); k++) {
        const id = ctx.rollChess({ maxTier: Math.max(1, ctx.shopLevel()) });
        if (id) ctx.grantChess(id, { source: 'band' });
      }
    }
  },
});

// 佩佩 博学多通 "升级调度中心至2、4和6级后，获得1次特殊刷新：此次刷新出现的干员优先为<萨尔贡>干员": the special refresh is the
// player's next manual refresh, paid as usual — the text gives no 免费 (德克萨斯's trait says 「获得1次免费刷新」 for a free
// one), and the community report of 2026-10-06 「佩佩策略的特殊刷新也是要花钱的，不是免费」. Until 0.2.0 a free refresh came
// with it (blackboard `price` 0 read as its price) [ASSUMED: `cnt` / `price` 0 change nothing].
K.up_shop_next_refresh_must_present_bond_char = (ps) => ({
  onLevelUp(ctx, ev) {
    const p = ps[0];
    if (!list(p.lvlist).map(Number).includes(ev.level)) return;
    ctx.incCounter('band:pepe:special', 1);
  },
  onRefresh(ctx) {
    if (ctx.counter('band:pepe:special') <= 0) return;
    ctx.incCounter('band:pepe:special', -1);
    const bond = ps[0].bond;
    const slots = ctx.shopSlots();
    for (const i of chessSlots(ctx)) {
      if (hasBond(ctx, slots[i].id, bond)) continue;
      const id = rollBond(ctx, bond);
      if (!id) break;
      ctx.setShopSlot(i, { kind: 'chess', id });
    }
  },
});

K.gain_bond_char_per_round = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    const r0 = int(p.round, 1), every = Math.max(1, int(p.preround, 1));
    if (ctx.round < r0 || (ctx.round - r0) % every !== 0) return;
    for (let k = 0; k < timesOf(p.count, 1); k++) {
      const id = rollBond(ctx, p.bond, { anyTier: true });
      if (id) ctx.grantChess(id, { source: 'band' });
    }
  },
});

K.first_buy_in_round_char_price_change = (ps) => ({
  onPrice(ctx, ev) {
    const p = ps[0];
    if (ev.kind !== 'chess' || !hasBond(ctx, ev.id, p.bond)) return;
    if (ctx.counter('band:sciurus:r') === ctx.round) return;
    ctx.setPrice(Math.min(num(ev.price, 0), int(p.price, 1)));
  },
  onBuy(ctx, ev) {
    if (ev.kind === 'chess' && hasBond(ctx, ev.slot.id, ps[0].bond)) ctx.setCounter('band:sciurus:r', ctx.round);
  },
});

K.band_cost_coin_reach_cnt_gain_chess_from_pool = (ps) => ({
  onSpend(ctx, ev) {
    const p = ps[0];
    if (ctx.counter('band:paganini:done') > 0) return;
    const spent = ctx.incCounter('band:paganini:spent', Math.max(0, int(ev.amount, 0)));
    if (spent < int(p.coin_cnt, 0)) return;
    const r = ctx.rollPool(p.pool);
    if (r && grant(ctx, r.id, { source: 'band' })) ctx.setCounter('band:paganini:done', 1);
  },
});

/**
 * 余 【文火慢炖】 「第8回合开始时，若仅激活了1个盟约，使其增加36层；否则使所有已激活盟约增加12层」. The owner's decision of 2026-10-08
 * overrides PRTS here (下半/PRTS盟约记录: layers of a bond that shows none 「仍然对其生效」): a bond without layers — bonds.json
 * `noStack`: 绝技, 独行, 调和, 协防干员 — gets none. The count stays the sentence's (every active bond), so one active bond
 * that is such a bond means nothing is added, and with two active bonds a layered one still gets count2. Only this
 * strategy: 协防's 「使所有已激活的盟约层数」 (bonds/addon/meta.js) and 华法琳's 【重点监护】 keep adding to every bond they name.
 */
K.round_start_bond_check_gain_layer = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    if (ctx.round !== int(p.round, -1)) return;
    const active = Object.entries(ctx.bonds()).filter(([, b]) => b && b.active).map(([id]) => id);
    const n = active.length === int(p.factioncount, 1) ? int(p.count1, 0) : int(p.count2, 0);
    for (const b of active) {
      if (ctx.gd.bond(b)?.noStack) continue;
      ctx.addLayers(b, n, { requireActive: true, reason: 'band' });
    }
  },
});

// Official activity_table aceffect_band_26: count 3, choice 1, pool_equip_kathe; no cell limit is exposed.
// #677: maintainer decision 2026-10-17 (official play memory): Cathy gives the cell at most once per player/match.
// [ASSUMED] "given" means successfully taken, not shown; Quintus's independent grant does not use this allowance.
K.up_shop_add_special_goods = (ps, bandId) => ({
  onLevelUp(ctx) {
    const p = ps[0];
    // effectRef inherits the behaviour (DESIGN §32.5); concrete parameters still come from this band's buffs.
    const cathy = bandEffectId(bandId) === 'band_cathy';
    // the cell of the match's data (support mutationCellIds): chess_item_5_08_e_a, or on another version's build the
    // records of its effect (上半 gives it another id and tier)
    const exclude = cathy && ctx.counter('band:cathy:cellTaken') ? mutationCellIds(ctx.data ?? gameData()) : [];
    const ids = rollItems(ctx, p.pool, timesOf(p.count, 3), exclude);
    if (ids.length) ctx.offerItems(ids, { source: cathy ? 'band:band_cathy' : 'band' });
  },
});

K.coin_carry_over = (ps) => ({
  onIncome(ctx, ev) {
    const p = ps[0];
    const cap = int(p.capital, 0), left = ctx.funds();
    if (cap <= 0 || left < cap) return;
    const bonus = Math.min(int(p.max, Infinity), Math.floor(left / cap) * int(p.interest, 0));
    if (bonus > 0) ev.income = int(ev.income, 0) + bonus;
  },
});

K.round_start_activate_char_chess_effect_in_board = (ps) => ({
  onRoundStart(ctx) {
    const p = ps[0];
    const event = p.event_type || 'SERVER_GAIN';
    const cands = ctx.board().filter((v) => v && v.kind === 'chess' && ctx.garrisonsOf(v.uid).some((g) => g.eventType === event));
    if (!cands.length) return;
    cands.sort((a, b) => (b.col - a.col) || (a.row - b.row));
    for (const v of cands.slice(0, timesOf(p.count, 1))) {
      if (event === 'SERVER_GAIN' && typeof garrisons.triggerGainEffects === 'function') garrisons.triggerGainEffects(ctx, v);
      else ctx.triggerGarrisons(v.uid, event);
    }
  },
});

K.first_sell_char_chess_exchange_char_chess_in_shop = (ps) => ({
  onSold(ctx, ev) {
    const piece = ev.piece;
    if (!piece || piece.kind !== 'chess' || !isNormalChess(ctx, piece.id)) return;
    if (roundCounter(ctx, 'band:vodfox') >= Math.max(1, int(ps[0].count, 1))) return;
    const slots = ctx.shopSlots();
    const idx = chessSlots(ctx);
    if (!idx.length) return;
    const i = ctx.rng.pick(idx);
    const got = ctx.grantChess(slots[i].id, { source: 'band' });
    if (!got) return;
    ctx.setShopSlot(i, { kind: 'chess', id: piece.id });
    ev.gain = 0;
    bumpRound(ctx, 'band:vodfox');
  },
});

K.round_start_gain_char_chess_in_shop_every_n_round = (ps) => ({
  onPrepStart(ctx) {
    const p = ps[0];
    const n = int(p.round, 0);
    if (n <= 0 || ctx.round % n !== 0) return;
    for (let k = 0; k < timesOf(p.count, 1); k++) {
      const idx = chessSlots(ctx);
      if (!idx.length) return;
      const i = ctx.rng.pick(idx);
      if (ctx.grantChess(ctx.shopSlots()[i].id, { source: 'band' })) ctx.setShopSlot(i, null);
    }
  },
});

K.round_start_gain_coin_by_bond_char_chess_buy = (ps) => ({
  onBuy(ctx, ev) {
    const p = ps[0];
    if (ev.kind !== 'chess' || !hasBond(ctx, ev.slot.id, p.bond)) return;
    const n = int(p.count, 1), max = int(p.max_count, Infinity);
    const used = roundCounter(ctx, 'band:mlynar');
    const add = Math.min(n, max - used);
    if (add <= 0) return;
    ctx.addPendingFunds(add);
    bumpRound(ctx, 'band:mlynar', add);
  },
});

K.refresh_shop_count_gain_coin_bond_char_chess = (ps) => ({
  onRefresh(ctx) {
    const p = ps[0];
    const every = int(p.refresh_count, 0);
    if (every <= 0) return;
    if (ctx.incCounter('band:chiave:refreshes', 1) % every !== 0) return;
    if (roundCounter(ctx, 'band:chiave') >= int(p.max_count, Infinity)) return;
    const id = rollBond(ctx, p.bond);
    if (id && ctx.grantChess(id, { source: 'band' })) bumpRound(ctx, 'band:chiave');
  },
});

K.preparation_start_add_special_goods_every_n_round = (ps) => ({
  onPrepStart(ctx) {
    const p = ps[0];
    const n = int(p.round, 0);
    if (n <= 0 || ctx.round % n !== 0) return;
    const ids = rollItems(ctx, p.pool, Math.min(bbCap('refresh_cnt'), Math.max(1, int(p.refresh_cnt, 2))));
    const choices = Math.min(bbCap('choice_cnt'), Math.max(1, int(p.choice_cnt, 1)));
    for (let k = 0; k < choices && ids.length; k++) ctx.offerItems(ids, { source: 'band' });
  },
});

// ---------------------------------------------------------------------------------------------------------------
// 鸭爵 “神秘顾客”: "从第5回合起，你和队友遭遇的部分敌人可能会替换为<鸭爵><高普尼克><流泪小子><圆仔>，击倒这些敌人者获得1资金奖励
// （包括联防阶段）". A global handler rewrites the battle spawn list of every alive player while the band is held by that
// player or a teammate: from round `round`, in the normal battle, the Final Assault and the Hidden Core (PRTS 卫戍协议：盟约
// 下半/PRTS盟约记录 鸭爵 备注 "每回合将有0~2名敌人被替换为上述敌人之一…且在最终回合和隐秘核心回合中仍然生效"; the 联防 phase
// replaces nothing: its enemies are leaks, which keep their bounty). One draw per round for every player (GitHub #839:
// 「每回合…被替换」, the key's `all_player`): min..max (0–2, uniform [ASSUMED]) ground enemies of the round's own wave
// (`ev.waveSpawns`: before the player's bounty units, which differ per player) from the `minweight`–`maxweight` share of
// that wave's units in time order, the leader and its parts left out of the share [ASSUMED reading of the two weights] —
// any wave enemy but the leader, its parts and uncounted units —, with a stream of its own from the match seed
// (`ctx.seedFor('duck:<round>')`: no player's meta stream, the same in the previews), so every player has the same count
// and the same units [ASSUMED: the same units]; each player's list swaps the k-th own unit of the picked action at its own
// (bounty-re-timed) time and route. Only units of the lower lane are drawn: a route starting at the lower gate
// (shared/constants.js gateOf — normal fields (9,10), not (12,10)). The swapped-in kind is drawn per player, one per round
// (a stream of its own, `duck:<round>:<playerId>`), so a player's two swaps are the same kind while players can differ.
// All three from the reporter's recordings of the official game (GitHub #839, 2026-10-23: four players 2鼠 / 2狗 / 2鼠 /
// 2鸭 in one wave, all on the lower lane; a 联防 of 6熊 = three teammates' 2熊 each; the maintainer's decision of
// 2026-11-01). Elites are eligible
// too [ASSUMED: the text names no rank; one rule for every battle; about two thirds of the leader rounds' escorts in that
// share are elites, so a NORMAL-only rule would leave most Final Assault halves without a candidate — ≈ 80 % instead of
// ≈ 36 % of the R14 pair-field halves over 40 seeds]. Flyers are never swapped [ASSUMED: the four are ground units and a
// FLY action's route is a FLY route]. A swapped unit becomes a random enemylist enemy (the act2 `_2` versions) at the
// replaced unit's time and route, worth DUCK_COINS to its killer (bounty, also in 联防). A pair boss field has one spawn
// list that its two players' handlers edit in turn; each player's 0–2 come from the enemies whose route ends on that
// player's half (`ev.side` + `ev.routes`, the half rule of the field's bounties, server/match/waves.js routeByMotion), the
// share taken over that half [ASSUMED: "你和队友遭遇的敌人" — the enemies heading for the player's own protection point;
// each official client simulates its own battle, docs/research/08 appendix A], with the same round stream on both halves
// (no side salt [ASSUMED]): halves that line up pick mirrored units; a half of three or fewer units has none in the share.
// The originals never exist, so none of
// their death / kill / leak effects happen. Reaching the protection point costs 1 LP ("但进入保护目标点将减少1点目标生命值":
// the enemies' data lpr, tools/build-data.mjs). The swaps carry the spawn tag 'duck': their 隐匿 (流泪小子) comes back no
// sooner than 1 s after a block ends, not the official 0 s (content/enemies/helpers.js DUCK_STEALTH_RESTORE — the owner's
// decision of 2026-10-07, a deliberate deviation).

export const DUCK_BAND = 'band_ducklord';
/** "击倒这些敌人者获得1资金奖励" (the blackboard's `count` is 1 too). */
export const DUCK_COINS = 1;
/** Battle kinds the swap applies to (PRTS: the Final Assault and the Hidden Core too). */
const DUCK_KINDS = new Set(['normal', 'boss', 'hidden']);
/** Boss-field column between the left ('L') and the right ('R') player's half (the goals are at cols 2–3 / 17). */
const BOSS_MID_COL = (GEO.BOSS_RECT.c0 + GEO.BOSS_RECT.c1) / 2;

function duckParams(bandId = DUCK_BAND) {
  for (const b of buffsOf(bandRecord(bandId))) if (b.key === 'round_start_all_player_change_enemy_2') return b.p;
  return null;
}

/** The identity of a wave unit: its action (`actionIndex`), else the spec's place among the list's own specs. */
const unitAction = (s, pos) => (Number.isInteger(s.actionIndex) ? s.actionIndex : `#${pos}`);
/** A spawn the swap never counts as the wave's own: bounty units (per player) and earlier swaps. */
const notOwn = (s) => !s || s.tag === 'bounty' || s.tag === 'duck';

/**
 * The round's swaps (exported for tests): `{ action, k, enemyKey }` — the k-th unit of a wave action becomes enemyKey.
 * Drawn from `base`, the round's own wave (no bounty units: they differ per player), so every player who uses the same
 * `rng` stream on the same wave gets the same count and the same units (GitHub #839); only units whose route
 * (`routes[routeIndex]`) starts at the lower gate (gateOf; `leader`: a boss / hidden field's rows). The 鸭爵 enemy is one
 * per call, drawn with `typeRng` (the player's own stream; default `rng`). `side` ('L' | 'R', a pair boss field) limits
 * the draw to the units whose route ends on that half.
 */
export function duckPicks(gd, rng, base, p, { routes = null, side = null, leader = false, typeRng = rng } = {}) {
  const ducks = list(p.enemylist).filter((k) => gd.enemy(k));
  if (!ducks.length || !Array.isArray(base)) return [];
  const lo = Math.max(0, int(p.min, 0)), hi = Math.max(lo, int(p.max, lo));
  const want = lo + rng.int(hi - lo + 1);
  if (want <= 0) return [];
  const half = side === 'L' || side === 'R';
  const onHalf = (s) => {
    if (!half) return true;
    const r = Array.isArray(routes) ? routes[s.routeIndex] : null;
    const c = r && Array.isArray(r.end) ? Number(r.end[1]) : NaN;
    return side === 'R' ? c > BOSS_MID_COL : c < BOSS_MID_COL;
  };
  // one entry per enemy of the wave (split multi-count specs), in spawn-time order
  const flat = [];
  const seen = new Map();
  let pos = -1;
  for (let i = 0; i < base.length; i++) {
    const s = base[i];
    if (notOwn(s)) continue;
    pos++;
    const action = unitAction(s, pos);
    const cnt = Math.max(1, int(s.count, 1));
    const k0 = seen.get(action) ?? 0;
    seen.set(action, k0 + cnt);
    // the leader and its parts are not in the share either [ASSUMED: the client never sends the leader's action to the
    // server (ShouldActionUpToServer, waves.js templateSpawns), so a draw for every player sees the escorts only; it
    // also keeps a pair field's two halves alike — the leader's route ends on one of them]
    if (!onHalf(s) || s.tag === 'boss' || s.tag === 'part') continue;
    for (let k = 0; k < cnt; k++) flat.push({ i, action, k: k0 + k, t: num(s.time, 0) + k * num(s.interval, 0) });
  }
  flat.sort((a, b) => a.t - b.t || a.i - b.i || a.k - b.k);
  const w0 = num(p.minweight, 0), w1 = num(p.maxweight, 1);
  const n = flat.length;
  const ok = flat.filter((f, j) => {
    const s = base[f.i];
    const e = gd.enemy(s.enemyKey);
    const frac = n > 1 ? j / (n - 1) : 0;
    const route = Array.isArray(routes) ? routes[s.routeIndex] : null;
    return !s.tag && s.countInTotal !== false && e && e.rank !== 'BOSS' && !e.notCountInTotal && e.stats?.motion !== 'FLY'
      && frac >= w0 - 1e-9 && frac <= w1 + 1e-9 && gateOf(route?.start, leader) === 'lower';
  });
  const picked = rng.shuffle(ok).slice(0, want);
  if (!picked.length) return [];
  const enemyKey = typeRng.pick(ducks);
  return picked.map((f) => ({ action: f.action, k: f.k, enemyKey }));
}

/**
 * Apply the round's swaps to a player's spawn list in place (exported for tests): the k-th own unit of each picked
 * action — counted over the list's own specs of that action in list order, so a run re-timed around bounty units
 * (waves.js withBounties) still finds it — becomes the swap at that player's own time and route. Returns the swaps.
 */
export function applyDuckPicks(spawns, picks, ownerPlayerId) {
  if (!Array.isArray(spawns) || !picks.length) return [];
  const byAction = new Map();
  for (const pk of picks) { if (!byAction.has(pk.action)) byAction.set(pk.action, new Map()); byAction.get(pk.action).set(pk.k, pk.enemyKey); }
  const seen = new Map();
  const out = [];
  const next = [];
  let pos = -1;
  for (const s of spawns) {
    if (notOwn(s)) { if (s) next.push(s); continue; }
    pos++;
    const action = unitAction(s, pos);
    const cnt = Math.max(1, int(s.count, 1));
    const k0 = seen.get(action) ?? 0;
    seen.set(action, k0 + cnt);
    const ks = byAction.get(action);
    if (!ks || ![...ks.keys()].some((k) => k >= k0 && k < k0 + cnt)) { next.push(s); continue; }
    const one = (j) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined, count: 1, interval: 0, time: num(s.time, 0) + j * num(s.interval, 0) });
    for (let j = 0; j < cnt; j++) {
      const key = ks.get(k0 + j);
      if (key == null) { next.push(one(j)); continue; } // the unreplaced copies of a multi-count spec, at their own times
      const d = { ...one(j), enemyKey: key, tag: 'duck', bounty: { coins: DUCK_COINS, ownerPlayerId } };
      if (d.mods) delete d.mods.slot;
      out.push(d);
    }
  }
  spawns.length = 0;
  spawns.push(...next, ...out);
  return out;
}

/**
 * Rewrite `spawns` in place (exported for tests): draw the swaps from `base` (default: `spawns` without its bounty
 * units) with `rng` (default ctx.rng) and apply them. Returns the replaced spawn specs.
 */
export function duckReplace(ctx, spawns, p, ownerPlayerId, { routes = null, side = null, leader = false, base = null, rng = ctx.rng, typeRng = rng } = {}) {
  if (!Array.isArray(spawns)) return [];
  const picks = duckPicks(ctx.gd, rng, Array.isArray(base) ? base : spawns.filter((s) => !notOwn(s)), p, { routes, side, leader, typeRng });
  return applyDuckPicks(spawns, picks, ownerPlayerId);
}

const duckGlobal = {
  onBattleStart(ctx, ev) {
    if (!ev || !DUCK_KINDS.has(ev.kind) || !Array.isArray(ev.spawns)) return;
    const holder = [ctx, ...ctx.teammates()].find(t => (t.gd.band(t.bandId())?.effectRef ?? t.bandId()) === DUCK_BAND);
    if (!holder) return;
    const p = duckParams(holder.bandId());
    if (!p || ctx.round < int(p.round, 1)) return;
    // one draw per round for every player (GitHub #839): its own stream from the match seed — no player's meta stream,
    // the same in the stats preview and the bot rehearsals — on the wave before the player's bounties (ev.waveSpawns);
    // the kind from the player's own stream
    const seeded = typeof ctx.seedFor === 'function';
    const rng = seeded ? createRng(ctx.seedFor(`duck:${ctx.round}`)) : ctx.rng;
    const typeRng = seeded ? createRng(ctx.seedFor(`duck:${ctx.round}:${ctx.playerId}`)) : rng;
    duckReplace(ctx, ev.spawns, p, ctx.playerId, { routes: ev.routes, side: ev.side, leader: ev.kind !== 'normal', base: ev.waveSpawns, rng, typeRng });
  },
};

// ---------------------------------------------------------------------------------------------------------------

/** Merge hook objects (same hook → called in order). */
function merge(parts) {
  const out = {};
  for (const h of parts) {
    for (const [name, fn] of Object.entries(h)) {
      if (typeof fn !== 'function') continue;
      const prev = out[name];
      out[name] = prev ? function merged(ctx, ev) { prev(ctx, ev); fn(ctx, ev); } : fn;
    }
  }
  return out;
}

/** Hooks of one band (null when it has no prep effect). */
export function bandMetaHandler(bandId) {
  const groups = new Map();
  for (const b of buffsOf(bandRecord(bandId))) {
    if (!b.key || !K[b.key]) continue;
    if (!groups.has(b.key)) groups.set(b.key, []);
    groups.get(b.key).push(b.p);
  }
  if (!groups.size) return null;
  return merge([...groups].map(([k, ps]) => K[k](ps, bandId)));
}

export function registerMeta(registry) {
  for (const id of Object.keys(gameData().bands || {})) {
    const h = bandMetaHandler(id);
    if (h) registry.band(id, h);
  }
  registry.global('bands_ducklord', duckGlobal);
  registry.global('bands_devices', {
    onRoundStart(ctx) {
      for (const holder of [ctx, ...ctx.teammates()]) {
        for (const b of buffsOf(bandRecord(holder.bandId()))) {
          if (b.key !== 'auto_chess_change_map') continue;
          for (const [alias, on] of Object.entries(b.p)) if (alias.startsWith('trap_') && alias.includes('#')) ctx.setDeviceActive(alias, !!on);
        }
      }
    },
  });
}
