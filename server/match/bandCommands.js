// 规程 指令: official band.skills chains, owned state, prep targets and replacement drafts.
// No season/id switch: a band without skills keeps the existing strategy implementation.
// [ASSUMED] ROUND_RESET refills at prep start; cooldown N used in R is ready in R+N. A manual draft pick starts a
// fresh command instance; an automatic next-row upgrade remains the same instance. Previously produced effects persist.

import { ERR } from '../../shared/constants.js';
import { fieldTile, inField, tileKey } from './board.js';
import { bandMetaHandler } from '../sim/content/bands/meta.js';
import { commandPlan, commandPassive } from './bandCommandEffects.js';
import { OK, fail } from './player/common.js';
import { commandCandidatePool, commandRuntimeSkill, commandSkillRows, nextUnlockedCommandSkill } from './commandLevels.js';

export const paramsOf = b => ({ ...b.bb, ...b.bbStr });
export const skillRows = commandSkillRows;
export const commandSkill = ps => ps.command ? skillRows(ps).find(s => s.effectId === ps.command.currentEffectId) || null : null;
const commandOwnerBand = (ps, skill) => Object.values(ps.gd.raw.bands || {}).find(row => row.skills?.some(s => s.effectId === skill?.effectId)) || null;

const FRESH_INSTANCE_BAND_COUNTERS = [
  'band:sciurus:r', 'band:mlynar', 'band:mlynar:r', 'band:chiave', 'band:chiave:r', 'band:vodfox', 'band:vodfox:r',
];

function resetCommandInstance(ps, skill) {
  const c = ps.command;
  const owner = commandOwnerBand(ps, skill);
  const round = ps.m.round;
  const acquiredRound = Math.max(1, Math.trunc(Number(round) || 1));
  const rows = owner?.skills?.length ? owner.skills : [skill];
  for (const row of rows) {
    c.records[row.effectId] = {
      currentCost: row.cost, used: 0, round, readyRound: 0, totalUsed: 0, gainedRound: acquiredRound,
    };
  }

  // These keys are command-instance quotas. Do not clear produced effects (marks, offers, discounts, pending funds)
  // or factual counters such as band:chiave:refreshes and band:pepe:special's already-granted refresh credit.
  for (const key of Object.keys(ps.counters || {})) {
    if (key.startsWith('command:')) delete ps.counters[key];
  }
  for (const key of FRESH_INSTANCE_BAND_COUNTERS) delete ps.counters[key];
  for (const key of Object.keys(ps.round || {})) {
    if (key.startsWith('command:')) delete ps.round[key];
  }
}

/** [ASSUMED] Bond replacements stay with the selected strategy; command passives stay with the live row. */
export function commandBondOverrides(ps) {
  const overrides = {};
  for (const b of ps.gd.band(ps.bandId)?.buffs || [])
    if (b.key === 'auto_chess_effect_replace') Object.assign(overrides, paramsOf(b));
  return overrides;
}

export const keepsFunds = ps => ps.command
  ? !!commandSkill(ps)?.buffs.some(b => b.key === 'coin_carry_over')
  : ps.gd.leftoverKeptBands.includes(ps.bandId);

function activate(ps, skill, freshInstance = false) {
  const c = ps.command;
  if (freshInstance) resetCommandInstance(ps, skill);
  c.currentEffectId = skill.effectId;
  c.records[skill.effectId] ||= { currentCost: skill.cost, used: 0, round: ps.m.round, readyRound: 0, totalUsed: 0 };
  const state = c.records[skill.effectId];
  if (!Number.isInteger(state.gainedRound)) state.gainedRound = Math.max(1, Math.trunc(Number(ps.m.round) || 1));
  if (state.round !== ps.m.round) { state.round = ps.m.round; state.used = 0; }
  ps.dirty();
}

/** Called by state transitions, never by views. Upgrades are monotonic, including bond-count unlocks. */
export function syncCommand(ps) {
  const band = ps.gd.band(ps.bandId);
  if (!band?.skills?.length) { if (ps.command) ps.command = null; return; }
  if (!ps.command || ps.command.bandId !== ps.bandId) {
    ps.command = { bandId: ps.bandId, currentEffectId: null, records: {}, swapped: false };
    activate(ps, band.skills[0], true);
  }
  const rowsById = new Map(skillRows(ps).map(row => [row.effectId, row]));
  for (let n = 0; n < 74; n++) {
    const s = rowsById.get(ps.command.currentEffectId) || null;
    if (!s?.next) break;
    const next = nextUnlockedCommandSkill(ps, s, rowsById);
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
    if (!inField(row, col) || !tile || (skill.targetFilterType === 'PASSABLE' && ['tile_start', 'tile_end'].includes(tile.tileKey)) || tile.passable !== 'ALL') continue;
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
 * queued draft. [ASSUMED] Pool = each strategy's one row unlocked by the player's current state, excluding the live row,
 * `NONE` rows and rows carrying auto_chess_effect_replace or gain_band_skill_from_pool_in_prep; the complete official
 * pool rule is unverified and needs maintainer review.
 */
export function openSkillChangeDraft(player, choiceId, ctx = null) {
  if (!['skill_change_1', 'skill_change_2'].includes(choiceId)) return false;
  syncCommand(player);
  if (!player.command) return false;
  const pool = commandCandidatePool(player);
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
  activate(ps, skill, true);
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
  const band = commandOwnerBand(ps, s);
  const acquiredRound = ps.command.records[s.effectId]?.gainedRound;
  const liveSkill = commandRuntimeSkill(ps, band, s, acquiredRound);
  const old = bandMetaHandler(band?.bandId || ps.bandId, liveSkill);
  // Pepe's next-refresh credit is already earned state. Keep its original one-shot consumer alive after a swap,
  // while letting the live Pepe hook consume it exactly once when Pepe is currently selected.
  const retainedPepeRefresh = band?.bandId === 'band_pepe' ? null : bandMetaHandler('band_pepe');
  const out = {};
  const hooks = new Set([...Object.keys(old || {}), ...Object.keys(commandPassive)]);
  for (const hook of hooks) out[hook] = (ctx, ev) => {
    old?.[hook]?.(ctx, ev);
    if (hook === 'onRefresh' && ps.counters?.['band:pepe:special'] > 0) retainedPepeRefresh?.onRefresh?.(ctx, ev);
    commandPassive[hook]?.(ps, liveSkill, ctx, ev);
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
  return {
    commandEffectId: skill.effectId, commandMarks: marks, commandReserves: reserves,
    bondEffectOverrides: commandBondOverrides(ps),
  };
}
