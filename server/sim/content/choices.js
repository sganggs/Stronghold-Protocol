// server/sim/content/choices.js — 机变 (SP draft) card content (DESIGN §6.1 / §7; research 01 §12 + Addendum A4,
// 04 Addendum, 05 §3.2 step 8, 06 §4.4 / §8 / §11.5). Card GENERATION (family per SP round, 6 shared / 3 solo cards,
// pick order, timers) lives in server/match/choices.js; this module owns what a picked card DOES.
//
// Prep side — registerMeta(registry) registers one `choice:<id>` handler per card id the draft can produce
// (docs/META.md §2.6; the handler replaces the match's family default):
//   悬赏决策 (129 ENEMY_GAIN effects, data/effects.json): the effect's own bounty buff is read —
//     add_enemy_kill_gain_coin {count, coin, round, enemy_id}          kill bounty: `count` enemies on the picker's
//                                                                       next `round` battles (99 = all remaining); the
//                                                                       KILLER gets `coin` (a 联防 helper too)
//     add_enemy_selfbattle_win_gain_coin / next_battle_add_enemy_win_gain_coin   战术特训: `coin` only when the picker's
//                                                                       own 各自行动阶段 is perfect (settlement, match)
//     enemyeffect_1 lists both perfect keys with different counts (4 / 3): the add_enemy_* buff wins (its text says
//     "添加3只"). The bounty goes to the picker only; spawns, kill payout, perfect payout and the solo ×0.7 of
//     战术特训 enemies are applied by the match (waves.js bountySpawns / Match settlement / Battle kill payout).
//   道具补给 / 机密商店 (item cards; id = the normal EQUIP item id): the item goes to the picker's hand (temp on
//     overflow; merges with an identical normal copy) — free ("无需消耗资金").
//   战术决策 (43 BUFF_GAIN effects), by buff key (numbers from the blackboard):
//     global_special_choice_gain_equip {count, pool}        列装      `count` items rolled from the server pool
//     global_special_choice_bond_addlayer {count, bond_list} …的盟誓 layers +count on every listed bond (无需激活)
//     global_special_choice_gain_coin {count}               财富      funds now
//     global_special_choice_refresh_free {count}            补给      free refreshes (stack)
//     single_special_choice_gloden_equip_chess {count}      整备      next `count` purchased items → 进阶 (EffectRef
//                                                                     effect:builtin_next_buy_golden_item)
//     single_special_choice_gloden_char_chess {count}       升华      next `count` purchased operators → 精锐 (EffectRef
//                                                                     effect:builtin_next_buy_elite)
//     single_special_choice_gain_bond_chess {count, bond}   …驰援     `count` random chess of the bond from the shared
//                                                                     pool (tier ≤ shop level, else any tier) [ASSUMED tier rule]
//     auto_chess_change_map {alias: 0|1}                    模拟战场演变  the picker's own board: prep legality
//                                                                     (setDeviceActive) + battle devices (devices.js
//                                                                     reads the EffectRef params)
//     everything else → a battle EffectRef `{ key: 'choice:<id>', params: { …, prepOk }, data: { effectId } }` read by
//     install() below. Prep conditions are evaluated by this handler on onPrepEnd (the ref's own dispatch):
//       global_special_choice_prep_finish_bench_at_least {count}  火力  "休整期结束时若手牌区至少有N个单位"
//       global_special_choice_prep_finish_bench_at_most {count}   锐利  "休整期结束时若手牌区为空"
//       [ASSUMED] both count every card of the 手牌区 (10 regular + 5 temporary slots: operators, items, summon
//       stacks) — the two cards share one bench count and 锐利 reads "为空".
//   Cards whose text says "若存在其他队友则他们也获得" (team: true, icon_team_buff) reach every alive teammate
//   (server/match/choices.js applyCard runs this handler once per recipient). Re-picking a card stacks.
//
// Battle side — install(battle) reads each player's playerEffects (key 'choice:<effectId>'):
//   global_special_choice_all_activated                  always on
//   …prep_finish_bench_at_least / _at_most               on when params.prepOk (fallback: contentInfo.handUnits)
//   global_special_choice_prep_finish_same_row_at_least  征召: on when, at battle start, some row holds ≥ count of
//                                                        the player's deployed operators ([ASSUMED] an operator
//                                                        forced out at the start of 联防 — down on its tile — does
//                                                        not count; the −50 % still covers its timer, Battle.start)
//   env_gbuff_new_with_verify act1autochess_debuff_3 {value}   自愈: every damage instance an own unit (operator or
//                                                        summon) takes heals it `value` (not HP loss 流失, not gauge
//                                                        fills, not while a 禁疗 status is on)
//   env_gbuff_new_with_verify act1autochess_debuff_9 {atk, def} 无瑕: operators at full HP get ATK/DEF +x
//   env_gbuff_new halfIdle_magic_resist_penetration {magic_resist_penetrate_fixed}  火力: operators ignore N RES
//   env_gbuff_new halfIdle_def_penetration {def_penetrate}                        锐利: operators ignore x DEF
//   char_respawntime_mul {scale}                         征召: operators' redeploy time × scale
//   enemy_attribute_mul / enemy_attribute_add {atk|def|magic_resistance|max_hp|attack_speed|move_speed}
//     (+ bbStr enemy_level_type ELITE / BOSS)            排斥/责罚/裁决: enemies of the player's half (ownerId)
//                                                        of that rank get the debuff at spawn (all ranks without a type)
//   Operator attribute bonuses are 直接乘算 (support directMods: additive with every other percentage, PRTS 盟约记录 /
//   游戏数据基础); flat values stay flat; the enemies' enemy_attribute_mul stays a multiplier.

import { gameData, num, buffsOf, passiveBuff, effectRecord, directMods } from './support/index.js';
import { isShopItem } from '../simdata.js';
import { isHpLoss } from '../damage.js';
import { intOr } from '../util.js';

// =====================================================================================================================
// data helpers

const BOUNTY_KEYS = Object.freeze(['add_enemy_kill_gain_coin', 'add_enemy_selfbattle_win_gain_coin', 'next_battle_add_enemy_win_gain_coin']);
const KEY = Object.freeze({
  gainEquip: 'global_special_choice_gain_equip',
  addLayer: 'global_special_choice_bond_addlayer',
  gainCoin: 'global_special_choice_gain_coin',
  freeRefresh: 'global_special_choice_refresh_free',
  goldenItem: 'single_special_choice_gloden_equip_chess',
  eliteChess: 'single_special_choice_gloden_char_chess',
  bondChess: 'single_special_choice_gain_bond_chess',
  map: 'auto_chess_change_map',
  always: 'global_special_choice_all_activated',
  benchAtLeast: 'global_special_choice_prep_finish_bench_at_least',
  benchAtMost: 'global_special_choice_prep_finish_bench_at_most',
  sameRow: 'global_special_choice_prep_finish_same_row_at_least',
});
/** Buff keys resolved on the prep side (no battle part). */
const PREP_KEYS = new Set([KEY.gainEquip, KEY.addLayer, KEY.gainCoin, KEY.freeRefresh, KEY.goldenItem, KEY.eliteChess, KEY.bondChess]);
/** Condition (gate) keys of battle cards. */
const GATE_KEYS = new Set([KEY.always, KEY.benchAtLeast, KEY.benchAtMost, KEY.sameRow]);
export const BUILTIN_REFS = Object.freeze({ goldenItem: 'effect:builtin_next_buy_golden_item', eliteChess: 'effect:builtin_next_buy_elite' });

const int = (v, d = 0) => intOr(num(v, NaN), d);
const own = (o, k) => (o && typeof o === 'object' && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);

/** choices.json cards.<family> entry of an effect id (display name, tier, team flag, tactic kind), or null. */
function cardRecord(data, family, id) {
  const list = data && data.choices && data.choices.cards && Array.isArray(data.choices.cards[family]) ? data.choices.cards[family] : [];
  return list.find((c) => c && c.effectId === id) ?? null;
}

/**
 * The bounty a 悬赏 effect adds (from its own buff blackboard), in the choices.json card shape used by the match
 * (`m.addBounty`), or null when the effect has no bounty buff.
 * @param {object} effect data/effects.json ENEMY_GAIN record
 * @param {object|null} [card] choices.json cards.bounty entry (tier)
 */
export function bountyOf(effect, card = null) {
  if (!effect || !Array.isArray(effect.buffs)) return null;
  const list = effect.buffs.filter((b) => b && BOUNTY_KEYS.includes(b.key) && b.bbStr && typeof b.bbStr.enemy_id === 'string');
  if (!list.length) return null;
  list.sort((a, b) => BOUNTY_KEYS.indexOf(a.key) - BOUNTY_KEYS.indexOf(b.key));
  const b = list[0];
  const bb = b.bb || {};
  const coin = Math.max(0, int(bb.coin, int(effect.enemyPrice, 0)));
  const rounds = b.key === 'next_battle_add_enemy_win_gain_coin' ? 1 : Math.max(1, Math.min(99, int(bb.round, 1)));
  const tier = card && Number.isInteger(card.tier) ? card.tier : Math.max(1, Math.min(3, coin || 1));
  return {
    effectId: effect.effectId ?? null,
    name: effect.name ?? card?.name ?? '悬赏',
    desc: effect.desc ?? card?.desc ?? '',
    tier,
    coin,
    payout: b.key === 'add_enemy_kill_gain_coin' ? 'kill' : 'perfect',
    rounds,
    multiRound: rounds > 1,
    enemyKey: b.bbStr.enemy_id,
    count: Math.max(1, int(bb.count, 1)),
  };
}

/** Device aliases (`trap_…#nnn` → on/off) of every auto_chess_change_map buff of an effect. */
export function mapAliases(effect) {
  const out = {};
  for (const b of buffsOf(effect)) {
    if (b.key !== KEY.map) continue;
    for (const [k, v] of Object.entries(b.p)) if (k.includes('#')) out[k] = num(v, 0) !== 0 ? 1 : 0;
  }
  return out;
}

/** Gate of a battle card: { kind: 'always'|'benchAtLeast'|'benchAtMost'|'sameRow', count }. */
export function gateOf(effect) {
  for (const b of buffsOf(effect)) {
    if (b.key === KEY.benchAtLeast) return { kind: 'benchAtLeast', count: Math.max(0, int(b.p.count, 0)) };
    if (b.key === KEY.benchAtMost) return { kind: 'benchAtMost', count: Math.max(0, int(b.p.count, 0)) };
    if (b.key === KEY.sameRow) return { kind: 'sameRow', count: Math.max(1, int(b.p.count, 3)) };
  }
  return { kind: 'always', count: 0 };
}

/** Whether a prep bench gate holds for `n` cards in the 手牌区. */
export function benchGate(gate, n) {
  if (!gate) return true;
  if (gate.kind === 'benchAtLeast') return n >= gate.count;
  if (gate.kind === 'benchAtMost') return n <= gate.count;
  return true;
}

/** Does a 战术决策 effect have a battle part (anything besides the prep-side keys)? */
export function hasBattlePart(effect) {
  return buffsOf(effect).some((b) => b.key && !PREP_KEYS.has(b.key) && !GATE_KEYS.has(b.key));
}

/** Ids of every 机变 card the draft can produce (bounty / tactic effects, supply & shop items) — the coverage target. */
export function choiceCardIds(data = gameData()) {
  const bounty = [];
  const tactic = [];
  for (const [id, e] of Object.entries((data && data.effects) || {})) {
    if (!e || typeof e !== 'object') continue;
    if (e.effectType === 'ENEMY_GAIN') bounty.push(id);
    else if (e.effectType === 'BUFF_GAIN') tactic.push(id);
  }
  const cards = (data && data.choices && data.choices.cards) || {};
  for (const c of Array.isArray(cards.bounty) ? cards.bounty : []) if (c && c.effectId && !bounty.includes(c.effectId)) bounty.push(c.effectId);
  for (const c of Array.isArray(cards.tactic) ? cards.tactic : []) if (c && c.effectId && !tactic.includes(c.effectId)) tactic.push(c.effectId);
  const items = [];
  // the 道具补给 / 机密商店 cards draw shop items only (never the effect-only special 维式重锤 / 突变细胞)
  for (const [id, it] of Object.entries((data && data.items) || {})) if (isShopItem(it)) items.push(id);
  return { bounty: bounty.sort(), tactic: tactic.sort(), items: items.sort() };
}

// =====================================================================================================================
// prep side

/** Cards currently in the 手牌区 (regular + temporary slots; operators, items, summon stacks). */
function benchCount(ctx) {
  let n = 0;
  for (const p of ctx.hand()) if (p) n++;
  for (const p of ctx.temp()) if (p) n++;
  return n;
}

const effectOf = (ctx, id) => own(ctx.data && ctx.data.effects, id) ?? effectRecord(id);

/** 悬赏决策: the picker's bounty (personal: never given to teammates). */
const BOUNTY = {
  onChoicePick(ctx, ev) {
    if (ctx.source.kind !== 'choice' || !ev || !ev.card || ev.forTeammate) return;
    const id = ev.card.id;
    const spec = bountyOf(effectOf(ctx, id), cardRecord(ctx.data, 'bounty', id)) ?? cardRecord(ctx.data, 'bounty', id);
    if (!spec || !ctx.gd.enemy(spec.enemyKey)) return;
    ctx.addBounty(spec);
  },
};

/** 道具补给 / 机密商店: the item, free. */
const ITEM = {
  onChoicePick(ctx, ev) {
    if (ctx.source.kind !== 'choice' || !ev || !ev.card || ev.forTeammate) return;
    if (!ctx.gd.item(ev.card.id)) return;
    ctx.grantItem(ev.card.id, { source: 'choice' });
  },
};

function refIdFor(ctx, effectId) {
  const n = ctx.incCounter('choices:refSeq', 1);
  return `choice:${effectId}#${n}`;
}

function applyTactic(ctx, ev) {
  const id = ev.card.id;
  const eff = effectOf(ctx, id);
  if (!eff || !Array.isArray(eff.buffs)) return;
  const card = cardRecord(ctx.data, 'tactic', id);
  const team = !!(card ? card.team : ev.card.team);
  const name = eff.name ?? ev.card.name ?? id;
  const desc = eff.desc ?? ev.card.desc ?? '';
  const iconKind = team ? 'team' : 'choice';
  const iconId = eff.decoIconId || id;
  const data = { effectId: id, tacticKind: card ? card.kind ?? null : ev.card.tacticKind ?? null, team, round: ctx.round };
  for (const b of buffsOf(eff)) {
    const p = b.p;
    const count = Math.max(0, int(p.count, 1));
    switch (b.key) {
      case KEY.gainEquip: {
        for (let i = 0; i < count; i++) {
          const r = typeof p.pool === 'string' ? ctx.rollPool(p.pool) : null;
          const itemId = r && r.kind === 'item' ? r.id : ctx.rollItem({ tier: 1 });
          if (itemId) ctx.grantItem(itemId, { source: 'choice' });
        }
        break;
      }
      case KEY.addLayer: {
        const bonds = String(p.bond_list ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        for (const bondId of bonds) ctx.addLayers(bondId, count, { requireActive: false, reason: 'choice' });
        break;
      }
      case KEY.gainCoin:
        ctx.addFunds(count, 'choice');
        break;
      case KEY.freeRefresh:
        ctx.grantFreeRefresh(count);
        break;
      case KEY.goldenItem:
        if (count > 0) ctx.addEffect({ id: refIdFor(ctx, id), key: BUILTIN_REFS.goldenItem, name, desc, iconKind, iconId, counter: count, battle: false, params: { count }, data });
        break;
      case KEY.eliteChess:
        if (count > 0) ctx.addEffect({ id: refIdFor(ctx, id), key: BUILTIN_REFS.eliteChess, name, desc, iconKind, iconId, counter: count, battle: false, params: { count }, data });
        break;
      case KEY.bondChess: {
        const bond = typeof p.bond === 'string' ? p.bond : null;
        if (!bond) break;
        for (let i = 0; i < count; i++) {
          const chessId = ctx.rollChess({ bond, maxTier: Math.max(1, ctx.shopLevel()) }) ?? ctx.rollChess({ bond });
          if (chessId) ctx.grantChess(chessId, { source: 'choice' });
        }
        break;
      }
      default:
        break;
    }
  }
  const aliases = mapAliases(eff);
  const aliasList = Object.entries(aliases);
  for (const [alias, on] of aliasList) ctx.setDeviceActive(alias, on !== 0);
  if (aliasList.length || hasBattlePart(eff)) {
    const gate = gateOf(eff);
    const params = { ...aliases };
    if (gate.kind === 'benchAtLeast' || gate.kind === 'benchAtMost') params.prepOk = benchGate(gate, benchCount(ctx));
    ctx.addEffect({ id: refIdFor(ctx, id), key: `choice:${id}`, name, desc, iconKind, iconId, battle: true, params, data });
  }
}

/** 战术决策 handler: application on pick; bench conditions re-evaluated at every prep end (the ref's own dispatch). */
const TACTIC = {
  onChoicePick(ctx, ev) {
    if (ctx.source.kind !== 'choice' || !ev || !ev.card) return;
    applyTactic(ctx, ev);
  },
  onPrepEnd(ctx) {
    if (ctx.source.kind !== 'effect' || !ctx.source.ref) return;
    const ref = ctx.source.ref;
    const effectId = ref.data && typeof ref.data.effectId === 'string' ? ref.data.effectId : String(ref.key || '').replace(/^choice:/, '');
    const gate = gateOf(effectOf(ctx, effectId));
    if (gate.kind !== 'benchAtLeast' && gate.kind !== 'benchAtMost') return;
    const n = benchCount(ctx);
    ctx.addEffect({ id: ref.id, params: { ...(ref.params || {}), prepOk: benchGate(gate, n), bench: n } });
  },
};

export function registerMeta(registry) {
  const ids = choiceCardIds();
  for (const id of ids.bounty) registry.choice(id, BOUNTY);
  for (const id of ids.tactic) registry.choice(id, TACTIC);
  for (const id of ids.items) registry.choice(id, ITEM);
}

// =====================================================================================================================
// battle side

const RUNE = Object.freeze({ heal: 'act1autochess_debuff_3', flawless: 'act1autochess_debuff_9' });

/** Operator mods of an env_gbuff blackboard (numbers only; 直接乘算 for attributes — support directMods). */
function opModsOf(p) {
  const mods = {};
  const direct = { atk: 0, def: 0, hp: 0 };
  const add = (k, v) => { if (Number.isFinite(v) && v !== 0) mods[k] = (mods[k] ?? 0) + v; };
  const mul = (k, v) => { if (Number.isFinite(v) && v !== 0) mods[k] = (mods[k] ?? 1) * (1 + v); };
  for (const [k, raw] of Object.entries(p || {})) {
    const v = num(raw, NaN);
    if (!Number.isFinite(v)) continue;
    switch (k) {
      case 'magic_resist_penetrate_fixed': add('resIgnoreFlat', v); break;
      case 'magic_resist_penetrate': add('resIgnorePct', v); break;
      case 'def_penetrate': add('defIgnorePct', v); break;
      case 'def_penetrate_fixed': add('defIgnoreFlat', v); break;
      case 'atk': direct.atk += v; break;
      case 'def': direct.def += v; break;
      case 'max_hp': direct.hp += v; break;
      case 'attack_speed': add('aspd', Math.abs(v) < 1 ? v * 100 : v); break;
      case 'damage_scale': mul('dmgDealtMul', v); break;
      default: break;
    }
  }
  return directMods(direct, mods);
}

/** Enemy mods of an enemy_attribute_mul / _add blackboard. */
function enemyModsOf(p, isMul) {
  const mods = {};
  const MUL = { atk: 'atkMul', def: 'defMul', max_hp: 'hpMul', magic_resistance: 'resMul', move_speed: 'moveMul' };
  const ADD = { atk: 'atkFlat', def: 'defFlat', max_hp: 'hpFlat', magic_resistance: 'resFlat', move_speed: 'moveFlat', attack_speed: 'aspd' };
  for (const [k, raw] of Object.entries(p || {})) {
    const v = num(raw, NaN);
    if (!Number.isFinite(v)) continue;
    if (isMul) {
      if (k === 'attack_speed') { if (v !== 1) mods.aspd = (mods.aspd ?? 0) + (v - 1) * 100; continue; }
      if (MUL[k] && v > 0 && v !== 1) mods[MUL[k]] = (mods[MUL[k]] ?? 1) * v;
    } else if (ADD[k] && v !== 0) {
      mods[ADD[k]] = (mods[ADD[k]] ?? 0) + v;
    }
  }
  return mods;
}

/**
 * Battle plan of one card EffectRef: { effectId, key, gate, heal, flawless, opMods, enemy: [{ rank, mods }] } or null.
 * @param {object} ref playerEffects entry
 */
export function battlePlanOf(ref) {
  const effectId = ref && ref.data && typeof ref.data.effectId === 'string' ? ref.data.effectId
    : ref && typeof ref.key === 'string' && ref.key.startsWith('choice:') ? ref.key.slice(7) : null;
  if (!effectId) return null;
  const eff = effectRecord(effectId);
  if (!eff || !Array.isArray(eff.buffs)) return null;
  // buff key: the ref id (`choice:<effectId>#<n>`, unique per pick) — one buff per picked card, so re-picks stack
  const key = typeof ref.id === 'string' && ref.id.startsWith(`choice:${effectId}#`) ? ref.id : `choice:${effectId}#${ref.id ?? ''}`;
  const plan = { effectId, key, gate: gateOf(eff), heal: 0, flawless: null, opMods: null, enemy: [] };
  const mergeOp = (mods) => {
    if (!mods || !Object.keys(mods).length) return;
    plan.opMods = plan.opMods ?? {};
    for (const [k, v] of Object.entries(mods)) plan.opMods[k] = k.endsWith('Mul') ? (plan.opMods[k] ?? 1) * v : (plan.opMods[k] ?? 0) + v;
  };
  for (const b of buffsOf(eff)) {
    if (!b.key || PREP_KEYS.has(b.key) || GATE_KEYS.has(b.key) || b.key === KEY.map) continue;
    if (b.key === 'env_gbuff_new' || b.key === 'env_gbuff_new_with_verify') {
      if (b.bbKey === RUNE.heal) plan.heal += Math.max(0, num(b.p.value, 0));
      else if (b.bbKey === RUNE.flawless) plan.flawless = opModsOf({ atk: b.p.atk, def: b.p.def });
      else mergeOp(opModsOf(b.p));
    } else if (b.key === 'char_respawntime_mul') {
      const s = num(b.p.scale, NaN);
      if (Number.isFinite(s) && s >= 0) mergeOp({ redeployMul: s });
    } else if (b.key === 'enemy_attribute_mul' || b.key === 'enemy_attribute_add') {
      const mods = enemyModsOf(b.p, b.key === 'enemy_attribute_mul');
      const rank = typeof b.p.enemy_level_type === 'string' && b.p.enemy_level_type ? b.p.enemy_level_type.toUpperCase() : null;
      if (Object.keys(mods).length) plan.enemy.push({ rank, mods });
    }
  }
  return plan.heal > 0 || plan.flawless || plan.opMods || plan.enemy.length ? plan : null;
}

const rankOf = (e) => String(e?.def?.rank ?? e?.def?.raw?.rank ?? 'NORMAL').toUpperCase();
const isOwnOp = (u, pid) => !!u && u.kind === 'op' && u.side === 'ally' && u.ownerId === pid;

/** Whether a prep-gated card is on in this battle (params.prepOk from the match; contentInfo as a fallback). */
function prepGateOn(battle, ps, ref, gate) {
  if (gate.kind !== 'benchAtLeast' && gate.kind !== 'benchAtMost') return true;
  const p = ref && ref.params;
  if (p && typeof p.prepOk === 'boolean') return p.prepOk;
  const ci = ps && ps.input && ps.input.contentInfo;
  const n = ci && Number.isFinite(ci.handUnits) ? ci.handUnits : null;
  return n == null ? false : benchGate(gate, n);
}

/**
 * Largest number of the player's deployed operators sharing one row ([ASSUMED] a knocked-out operator lying on its tile —
 * one forced out at the start of 联防 — is not deployed and does not count).
 */
function maxRowOps(battle, pid) {
  const rows = new Map();
  for (const u of battle.allyUnits) if (isOwnOp(u, pid) && u.alive && u.deployed) rows.set(u.tileR, (rows.get(u.tileR) ?? 0) + 1);
  let best = 0;
  for (const n of rows.values()) best = Math.max(best, n);
  return best;
}

export function install(battle) {
  const cards = [];
  for (const ps of battle.players || []) {
    for (const ref of ps.playerEffects || []) {
      if (!ref || typeof ref.key !== 'string' || !ref.key.startsWith('choice:')) continue;
      const plan = battlePlanOf(ref);
      if (!plan || !prepGateOn(battle, ps, ref, plan.gate)) continue;
      cards.push({ pid: ps.playerId, ref, plan });
    }
  }
  if (!cards.length) return;
  const heal = new Map();      // pid → HP per damage instance (自愈)
  const flawless = new Map();  // pid → [{ key, mods }] (无瑕)
  const enemy = new Map();     // pid → [{ key, rank, mods }] (排斥 / 责罚 / 裁决)
  const opCards = [];          // cards with operator mods, applied at battle start
  const enable = (c) => {
    const { pid, plan } = c;
    if (plan.heal > 0) heal.set(pid, (heal.get(pid) ?? 0) + plan.heal);
    if (plan.flawless && Object.keys(plan.flawless).length) {
      if (!flawless.has(pid)) flawless.set(pid, []);
      flawless.get(pid).push({ key: plan.key, mods: plan.flawless });
    }
    if (plan.enemy.length) {
      if (!enemy.has(pid)) enemy.set(pid, []);
      for (const e of plan.enemy) enemy.get(pid).push({ key: plan.key, rank: e.rank, mods: e.mods });
    }
    if (plan.opMods) opCards.push(c);
  };
  // 征召's row check needs the deployed board (battle start); every other card is on from the first tick
  const late = cards.filter((c) => c.plan.gate.kind === 'sameRow');
  for (const c of cards) if (c.plan.gate.kind !== 'sameRow') enable(c);
  const wantsHeal = cards.some((c) => c.plan.heal > 0);
  const wantsFlawless = cards.some((c) => c.plan.flawless);

  battle.on('battleStart', () => {
    for (const c of late) {
      c.rowOk = maxRowOps(battle, c.pid) >= c.plan.gate.count;
      if (c.rowOk) enable(c);
    }
    for (const c of opCards) for (const u of battle.allyUnits) if (isOwnOp(u, c.pid)) passiveBuff(battle, u, c.plan.key, { ...c.plan.opMods });
    if (flawless.size) for (const u of battle.allyUnits) syncFlawless(u);
  }, { priority: -10 });

  // 无瑕: operators at full HP (checked on damage, and every tick for heals / redeploys / max-HP changes)
  function syncFlawless(u) {
    if (!u || u.kind !== 'op' || u.side !== 'ally') return;
    const list = flawless.get(u.ownerId);
    if (!list) return;
    const full = u.alive && u.deployed && u.hp >= u.s.maxHp - 1e-6;
    for (const f of list) {
      const has = !!u.findBuff(f.key);
      if (full && !has) battle.addBuff(u, { key: f.key, mods: { ...f.mods } });
      else if (!full && has) battle.removeBuff(u, f.key);
    }
  }

  if (wantsHeal || wantsFlawless) {
    battle.on('damaged', (ctx) => {
      const t = ctx && ctx.target;
      if (!t || t.side !== 'ally' || (t.kind !== 'op' && t.kind !== 'token')) return;
      // 自愈: every damage instance an own unit takes (not HP loss 流失, not element gauge fills, not under 禁疗)
      const amt = heal.get(t.ownerId);
      if (amt > 0 && ctx.amount > 0 && ctx.type !== 'element' && !isHpLoss(ctx.dmg)
        && t.alive && t.deployed && t.hp > 0 && !t.s.flags.noHeal) {
        battle.heal(null, t, amt, { self: true });
      }
      if (flawless.size && t.kind === 'op') syncFlawless(t);
    });
  }
  if (wantsFlawless) {
    battle.on('tick', () => {
      if (!flawless.size) return;
      for (const u of battle.allyUnits) if (u.kind === 'op' && flawless.has(u.ownerId)) syncFlawless(u);
    });
  }

  // enemy debuffs: enemies of the player's half (ownerId) with the card's rank, at spawn
  if (cards.some((c) => c.plan.enemy.length)) {
    battle.on('enemySpawn', (ctx) => {
      const e = ctx && ctx.enemy;
      if (!e || !e.alive || !enemy.size) return;
      const pid = e.ownerId ?? (battle.players.length === 1 ? battle.players[0].playerId : null);
      const list = pid != null ? enemy.get(pid) : null;
      if (!list) return;
      const rank = rankOf(e);
      for (const d of list) if (!d.rank || d.rank === rank) battle.addBuff(e, { key: d.key, mods: { ...d.mods }, persist: true });
    });
  }
}
