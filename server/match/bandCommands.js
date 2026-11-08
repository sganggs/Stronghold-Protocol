// 规程 指令: official band.skills chains, owned state, prep targets and replacement drafts.
// No season/id switch: a band without skills keeps the existing strategy implementation.
// [ASSUMED] ROUND_RESET refills at prep start; cooldown N used in R is ready in R+N. Swapping away and back
// preserves the command's cost, cooldown and match stock, so an ALL_LIMIT command cannot be replenished by a draft.

import { ERR } from '../../shared/constants.js';
import { fieldTile, inField, tileKey } from './board.js';
import { bandMetaHandler } from '../sim/content/bands/meta.js';
import { commandPlan, commandPassive } from './bandCommandEffects.js';
import { OK, fail } from './player/common.js';

export const paramsOf = b => ({ ...b.bb, ...b.bbStr });
export const skillRows = ps => Object.values(ps.gd.raw.bands || {}).flatMap(b => b.skills || []);
export const commandSkill = ps => ps.command ? skillRows(ps).find(s => s.effectId === ps.command.currentEffectId) || null : null;
export const keepsFunds = ps => ps.command
  ? !!commandSkill(ps)?.buffs.some(b => b.key === 'coin_carry_over')
  : ps.gd.leftoverKeptBands.includes(ps.bandId);

function activate(ps, skill) {
  const c = ps.command;
  c.currentEffectId = skill.effectId;
  c.records[skill.effectId] ||= { currentCost: skill.cost, used: 0, round: ps.m.round, readyRound: 0, totalUsed: 0 };
  const state = c.records[skill.effectId];
  if (state.round !== ps.m.round) { state.round = ps.m.round; state.used = 0; }
  ps.dirty();
}

/** Called by state transitions, never by views. Upgrades are monotonic, including bond-count unlocks. */
export function syncCommand(ps) {
  const band = ps.gd.band(ps.bandId);
  if (!band?.skills?.length) { if (ps.command) ps.command = null; return; }
  if (!ps.command || ps.command.bandId !== ps.bandId) {
    ps.command = { bandId: ps.bandId, currentEffectId: null, records: {}, swapped: false };
    activate(ps, band.skills[0]);
  }
  for (let n = 0; n < 74; n++) {
    const s = commandSkill(ps);
    if (!s?.next) break;
    const [a, b] = s.unlockParam;
    const unlocked = s.unlockType === 'band_skill_load_by_round' ? ps.m.round >= Number(a)
      : s.unlockType === 'band_skill_load_by_shop_lv' ? ps.shop.level >= Number(a)
      : s.unlockType === 'band_skill_load_by_coin_cost' ? ps.stats.gold >= Number(a)
      : s.unlockType === 'band_skill_load_by_bond_act_count' ? (ps.bonds[a]?.count || 0) >= Number(b) : false;
    if (!unlocked) break;
    const next = skillRows(ps).find(row => row.effectId === s.next);
    if (!next) break;
    const old = ps.command.records[s.effectId];
    activate(ps, next);
    // [ASSUMED] Upgrading increases the round allowance without refunding uses already spent this round.
    if (old.round === ps.m.round) ps.command.records[next.effectId].used = old.used;
  }
}

export function beginCommandPrep(ps) {
  syncCommand(ps);
  if (!ps.command) return;
  for (const state of Object.values(ps.command.records)) {
    if (state.round !== ps.m.round) { state.round = ps.m.round; state.used = 0; }
  }
  // [ASSUMED] Marks last through this round's normal battle and its 联防, then expire; chests persist until touched.
  ps.commandMarks = (ps.commandMarks || []).filter(mark => mark.persistent || mark.round === ps.m.round);
}

/** Apply a validated battle receipt before the next field is built (a touched chest never reappears in 联防). */
export function reconcileCommandChests(ps, result) {
  const lost = new Set((result?.commandChests || []).filter(c => !c.alive).map(c => c.id));
  if (lost.size) ps.commandMarks = ps.commandMarks.filter(m => !lost.has(m.id));
}

/** Own board/bench operators, shop offers, or tiles. These exact server-approved targets drive client highlights. */
export function commandTargets(ps, skill = commandSkill(ps)) {
  if (!skill) return [];
  const buffs = skill.buffs || [];
  const has = key => buffs.some(b => b.key === key);
  if (skill.targetType === 'NO_TARGET') return [{}];
  if (skill.targetType === 'COMMON_CHESS') {
    return [...ps.board.values(), ...ps.hand].filter(p => p?.kind === 'chess').filter(p => {
      if (has('skill_upgrade_char') || buffs.some(b => b.key === 'skill_mark_char_inst_tag' && paramsOf(b).cond === 'gold')) {
        if (ps.gd.isGolden(p.id) || !ps.gd.goldenIdOf(p.id)) return false;
      }
      if (has('skill_trigger_garr_event') || has('skill_garr_event_extra_exec')) {
        const buff = buffs.find(b => ['skill_trigger_garr_event', 'skill_garr_event_extra_exec'].includes(b.key));
        if (!(ps.gd.chess(p.id)?.garrisonIds || []).some(id => ps.gd.garrison(id)?.eventType === paramsOf(buff).event)) return false;
      }
      return true;
    }).map(p => ({ uid: p.uid }));
  }
  if (skill.targetType === 'SHOP_SLOT') {
    return ps.shop.slots.flatMap((s, slot) => {
      if (!s || s.sold || s.kind !== (skill.targetFilterType === 'EQUIP' ? 'item' : 'chess')) return [];
      if (has('skill_mark_shop_equip_tag')) {
        const item = ps.gd.item(s.id);
        if (!item || item.itemType !== 'EQUIP' || /装备时销毁/.test(item.desc || '')) return [];
      }
      return [{ slot }];
    });
  }
  if (skill.targetType !== 'MAP_TILE') return [];
  const stage = ps.gd.stage(ps.m.stageId), field = ps.m.deployFieldOf(ps), out = [];
  const deploy = ps.deployMap();
  for (let row = 9; row <= 12; row++) for (let col = 2; col <= 10; col++) {
    const [r, c] = fieldTile(field, row, col);
    const tile = stage?.tiles?.[stage.rows?.[r]?.[c]];
    if (!inField(row, col) || !tile || tile.passable !== 'ALL') continue;
    if (skill.targetFilterType === 'PASSABLE_AND_BUILDABLE' && (!deploy.has(tileKey(row, col)) || ps.board.has(tileKey(row, col)))) continue;
    if ((ps.commandMarks || []).some(m => m.row === row && m.col === col && (m.persistent || m.round === ps.m.round))) continue;
    out.push({ row, col });
  }
  return out;
}

export function commandView(ps) {
  const s = commandSkill(ps);
  if (!s) return null;
  const state = ps.command.records[s.effectId];
  const used = state.round === ps.m.round ? state.used : 0;
  const usesLeft = s.availType === 'ALL_LIMIT' ? Math.max(0, s.availCount - state.totalUsed)
    : s.availType === 'ROUND_RESET' ? Math.max(0, s.availCount - used) : null;
  const cooldown = Math.max(0, state.readyRound - ps.m.round);
  // [ASSUMED] A queued special-recruit/reward offer is the local special-recruit state.
  const specialRecruit = s.unusableAtSpecialRecruit && ps.offers.length > 0;
  const reason = s.type === 'NONE' ? 'locked' : s.type !== 'ACTIVE' ? 'passive'
    : cooldown ? 'cooldown' : usesLeft === 0 ? 'exhausted' : specialRecruit ? 'specialRecruit'
    : ps.funds < state.currentCost ? 'funds' : null;
  const band = Object.values(ps.gd.raw.bands).find(b => b.skills?.some(row => row.effectId === s.effectId));
  return {
    effectId: s.effectId, bandId: band?.bandId, iconId: band?.iconId,
    type: s.type, baseCost: s.cost, currentCost: state.currentCost, availType: s.availType,
    usesLeft, cooldown, reason, usable: !reason && !ps._gate(),
    unlockType: s.unlockType, unlockParam: [...s.unlockParam], next: s.next,
    targetType: s.targetType, targetFilterType: s.targetFilterType, targetTip: s.targetTip,
    desc: s.desc, descRaw: s.descRaw, targets: s.type === 'ACTIVE' ? commandTargets(ps, s) : [],
  };
}

/** Validate first, prepare all random draws second, then pay and commit the effect once. */
export function useCommand(ps, effectId, target, ctx) {
  const gate = ps._gate(); if (gate) return gate;
  syncCommand(ps);
  const s = commandSkill(ps), view = commandView(ps);
  if (!s || effectId !== s.effectId) return fail(ERR.BAD_TARGET);
  if (view.reason) return fail(view.reason === 'funds' ? ERR.NO_FUNDS : ERR.BAD_TARGET, view.reason);
  if (!target || typeof target !== 'object' || !view.targets.some(t => Object.keys(t).length === Object.keys(target).length
    && Object.entries(t).every(([k, v]) => target[k] === v))) return fail(ERR.BAD_TARGET);
  const plan = commandPlan(ps, s, target || {}, ctx);
  if (!plan) return fail(ERR.BAD_TARGET);
  const state = ps.command.records[s.effectId], cost = state.currentCost;
  ps.spend(cost);
  state.used++;
  state.totalUsed++;
  if (s.availType === 'COOLDOWN') state.readyRound = ps.m.round + (plan.cooldown ?? s.availCount);
  for (const b of s.buffs) {
    if (['skill_cost_round_grow_reset_on_use', 'skill_cost_reduce_on_buy_bond'].includes(b.key)) state.currentCost = s.cost;
    if (b.key === 'skill_cost_grow_per_use') state.currentCost += paramsOf(b).count;
  }
  plan.apply();
  ps._afterSpend(cost, 'command');
  ps.recompute();
  return OK;
}

/**
 * ITEMS integration: openSkillChangeDraft(player, 'skill_change_1', ctx) opens the 投机骰子 three-command choice.
 * skill_change_2 is the two-command prep choice. Returns false without changing state for an unknown choice or
 * a season without commands. ctx is optional; its RNG is used when supplied. g.commandChoice resolves the first
 * queued draft. [ASSUMED] Pool = all other ACTIVE skill rows, including upgraded rows; no filter exists in the data.
 */
export function openSkillChangeDraft(player, choiceId, ctx = null) {
  if (!['skill_change_1', 'skill_change_2'].includes(choiceId)) return false;
  syncCommand(player);
  if (!player.command) return false;
  const pool = skillRows(player).filter(s => s.type === 'ACTIVE' && s.effectId !== player.command.currentEffectId);
  const cards = (ctx?.rng || player.m.rngMeta).shuffle(pool).slice(0, choiceId === 'skill_change_1' ? 3 : 2).map(s => s.effectId);
  if (!cards.length) return false;
  (player.commandDrafts ||= []).push({ id: `command.${player.m.nextUid()}`, choiceId, cards });
  player.dirty();
  return true;
}

export function pickCommandDraft(ps, id, idx) {
  const gate = ps._gate(); if (gate) return gate;
  const draft = ps.commandDrafts?.[0];
  if (!draft || draft.id !== id || !Number.isInteger(idx) || !draft.cards[idx]) return fail(ERR.BAD_TARGET);
  const skill = skillRows(ps).find(s => s.effectId === draft.cards[idx]);
  if (!skill) return fail(ERR.BAD_TARGET);
  activate(ps, skill);
  ps.command.swapped = true;
  ps.commandDrafts.shift();
  syncCommand(ps);
  ps.dirty();
  return OK;
}

export function commandDraftView(ps) {
  const draft = ps.commandDrafts?.[0];
  if (!draft) return null;
  return { ...draft, cards: draft.cards.map(id => {
    const s = skillRows(ps).find(row => row.effectId === id);
    return { effectId: id, desc: s.desc, descRaw: s.descRaw, cost: s.cost };
  }) };
}

/** Existing prep keys follow the live row too, so Warfarin's upgrades and command swaps replace old hooks. */
export function commandMetaHandler(ps) {
  const s = commandSkill(ps);
  if (!s) return null;
  const old = bandMetaHandler(ps.bandId, s);
  const out = {};
  const hooks = new Set([...Object.keys(old || {}), ...Object.keys(commandPassive)]);
  for (const hook of hooks) out[hook] = (ctx, ev) => {
    old?.[hook]?.(ctx, ev);
    commandPassive[hook]?.(ps, s, ctx, ev);
  };
  return out;
}

/** Battle-only inputs: no owned piece is promoted or equipped by a temporary mark. */
export function commandBattleInput(ps, units) {
  const skill = commandSkill(ps);
  if (!skill) return {};
  const marks = (ps.commandMarks || []).filter(m => m.persistent || m.round === ps.m.round).map(m => ({ ...m }));
  const reserves = [];
  for (const mark of marks) {
    const unit = units.find(u => u.uid === mark.uid);
    if (unit && mark.layerCapBonus) unit.commandLayerCapBonus = (unit.commandLayerCapBonus || 0) + mark.layerCapBonus;
    for (const b of ps.gd.raw.effects?.[mark.tag]?.buffs || []) {
      if (b.key === 'auto_chess_battle_chess_upgrade' && unit) {
        unit.chessId = ps.gd.goldenIdOf(unit.chessId) || unit.chessId;
        const lo = ps.loadoutFor(ps.gd.chess(unit.chessId));
        unit.skillIndex = lo.skillIndex; unit.moduleId = lo.moduleId;
      }
      if (b.key === 'auto_chess_battle_give_all_equip' && mark.itemId) {
        for (const u of units) if (u.kind === 'chess' && u.items.length < ps.gd.equipPerChess) u.items.push(mark.itemId);
      }
      if (paramsOf(b).key === 'act3autochess_band22_buff' && unit) {
        // [ASSUMED] Read the bench at battle start, selecting the rightmost operator legal on the target's tile.
        const p = [...ps.hand].reverse().find(p => p?.kind === 'chess' && ps._legal(p, unit.row, unit.col));
        if (!p) continue;
        const rec = ps.gd.chess(p.id), lo = ps.loadoutFor(rec);
        reserves.push({
          uid: p.uid, kind: 'chess', chessId: p.id, row: unit.row, col: unit.col, dir: unit.dir,
          items: (p.items || []).map(i => i.id), skillIndex: lo.skillIndex, moduleId: lo.moduleId,
          ...(ps.diyPickOf(p.id) ? { diy: ps.diyPickOf(p.id) } : {}),
          ...(ps.fieldsStandIn(p.id) ? { standIn: true } : ps.cultivationFor(rec) || {}),
          commandReserveFor: unit.uid,
        });
      }
    }
  }
  // auto_chess_effect_replace maps EFFECT ids, in either direction. Bond modules consume the selected record.
  const overrides = {};
  for (const b of skill.buffs) if (b.key === 'auto_chess_effect_replace') Object.assign(overrides, paramsOf(b));
  return { commandEffectId: skill.effectId, commandMarks: marks, commandReserves: reserves, bondEffectOverrides: overrides };
}
