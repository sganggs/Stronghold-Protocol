// ui/gameLogic/loadout.js — skill / module loadout shown on cards. Re-exported from ../gameLogic.js.

import { MODULE_NONE, loadoutOptions, resolveLoadout } from '../../../../shared/protocol.js';
import { loadoutRecord, resolveRecordLoadout } from '../../../../shared/loadoutRecord.js';
import { isObj } from './shared.js';
import { t } from '../../../../shared/i18n.js';

/** The summon owner's variant: exact chess id, normal sibling, then the first available variant. */
export function tokenVariantFor(token, ownerId = null) {
  const vs = token?.variants || {};
  if (typeof ownerId === 'string') {
    const v = vs[ownerId] || vs[ownerId.replace(/_b$/, '_a')];
    if (v) return v;
  }
  return Object.values(vs)[0] || null;
}

// ---- operator loadout (DESIGN §16) ----------------------------------------------------------------------------------

/**
 * The skill / module a chess fights with under the player's loadout (m.private.loadout, DESIGN §16) — what the shop
 * card and the detail panel show. Works with data that already lists every selectable skill (`skills[]`, elite
 * `modules[]`) and with older data (only the default `skill` / `module`).
 * @param {any} chess the chess record (normal or elite)
 * @param {any} loadout m.private.loadout `{ [baseChessId]: { skill, module } }` (entries equal to the defaults may be
 *   missing); null → defaults
 * @param {(id: string) => any} [getChess]
 * @returns {{ skill: any, skillIndex: number|null, defaultSkill: boolean, module: { id: string, name: string, typeName: string, none: boolean }|null,
 *   defaultModule: boolean, changed: boolean, choices: number } | null}
 */
export function chessLoadout(chess, loadout, getChess = () => null) {
  if (!isObj(chess)) return null;
  const lo = isObj(loadout) && !Array.isArray(loadout) ? loadout : null;
  let r = { skillIndex: null, moduleId: null };
  try { r = resolveLoadout(lo, chess, getChess); } catch { /* defaults */ }
  const skills = Array.isArray(chess.skills) && chess.skills.length ? chess.skills.filter(isObj) : (isObj(chess.skill) ? [chess.skill] : []);
  const skill = skills.find((s) => s.index === r.skillIndex) || (isObj(chess.skill) ? chess.skill : null) || skills[0] || null;
  const base = chess.isGolden ? (getChess(chess.baseId) || chess) : chess;
  let opt = { defaultSkill: null, defaultModule: null, skills: [] };
  try { opt = loadoutOptions(base, chess.isGolden ? chess : null); } catch { /* defaults */ }
  const defIdx = opt.defaultSkill ?? chess.skill?.index ?? null;
  const defaultSkill = !skill || skill.index == null || defIdx == null || skill.index === defIdx;
  let module = null;
  let defaultModule = true;
  if (chess.isGolden) {
    const id = r.moduleId ?? (chess.module?.active ? chess.module.id : MODULE_NONE);
    if (id === MODULE_NONE) module = { id: MODULE_NONE, name: t('未装备模组'), typeName: '', none: true };
    else {
      const rec = (Array.isArray(chess.modules) ? chess.modules : []).find((m) => isObj(m) && m.uniEquipId === id)
        || (isObj(chess.module) && chess.module.id === id ? { uniEquipId: id, name: chess.module.name, typeName: chess.module.type } : null);
      module = { id, name: rec?.name || id, typeName: rec?.typeName || rec?.type || '', none: false };
    }
    defaultModule = opt.defaultModule == null || id === opt.defaultModule;
  }
  // the record the unit fights with (stats / 特性 / talents of the chosen module or none — the battle's own composition,
  // shared/loadoutRecord.js): the detail card must show what the sim runs
  let record = chess;
  try { record = loadoutRecord(chess, resolveRecordLoadout(chess, { skillIndex: r.skillIndex, moduleId: r.moduleId })) || chess; } catch { /* the record as is */ }
  return { skill, skillIndex: skill?.index ?? null, defaultSkill, module, defaultModule, changed: !defaultSkill || !defaultModule,
    choices: Math.max(skills.length, opt.skills?.length || 0), record };
}

/**
 * The loadout (m.private.loadout shape) a battle / scouting unit fights with, from the unit itself — a teammate's
 * operator shows ITS owner's skill / module (DESIGN §16), not the viewer's nor the defaults: UnitInfo `skillIndex`
 * (sim units, prep scouting m.field units) and `moduleId` (elite only), keyed by the chess's base id for chessLoadout.
 * Null when the unit carries neither (the defaults).
 * @param {any} chess the unit's chess record (normal or elite)
 * @param {any} unit UnitInfo
 * @returns {Record<string, { skill?: number, module?: string }> | null}
 */
export function unitLoadout(chess, unit) {
  if (!isObj(chess) || !isObj(unit)) return null;
  const baseId = chess.baseId || chess.chessId;
  if (typeof baseId !== 'string' || !baseId) return null;
  const e = {};
  if (Number.isInteger(unit.skillIndex) && unit.skillIndex >= 0) e.skill = unit.skillIndex;
  if (chess.isGolden && typeof unit.moduleId === 'string' && unit.moduleId) e.module = unit.moduleId;
  return Object.keys(e).length ? { [baseId]: e } : null;
}
