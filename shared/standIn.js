// shared/standIn.js — a chess fielded with another character's body: the 补位 stand-in (原型干员) of a NORMAL chess
// whose operator the player does not own, and the composition a 自选 (DIY) slot uses (shared/diy.js diyRecordOf calls
// composeUnitRecord with the pick). Pure ESM shared by the build
// (tools/build-data.mjs proves composeUnitRecord rebuilds every PRESET chess from its own unit form), the simulation and
// the client. Data: data/backups.json (docs/DATA.md §18).
//
// `backups.units[charId].forms[statusKey]` holds what a character is at one training status (stats, trait, talents,
// every skill unlocked there, the modules of that equip level) with nothing selected. composeUnitRecord joins a form to
// the identity of a chess record — chess id, tier, bonds, 特质 (garrisonIds), price, merge, status: PRTS 「卫戍协议」
// "原型干员会继承其补位干员的盟约 / 特质" — with a selected skill and module, and returns a record shaped exactly like a
// data/chess.json record whose `skill` / `module` defaults are that selection: normalizeChess, resolveLoadout /
// loadoutRecord and the detail card read it unchanged. A stand-in's skill and module are fixed by the chess
// (`backup.skillIndex` / `backup.uniEquipId`; Bilibili wiki 盟约: "对于补位干员其技能不可更改"), so a caller resolves it
// with no loadout. Sim kits are keyed by base chess id (server/sim/content/index.js setupUnitKit): a stand-in keeps the
// chess's ids, so its kit must be looked up by its `charId`, never by `baseId` (that is the replaced operator's kit).

import { composeStats, composeTalents } from './loadoutRecord.js';
import { stripPotential } from './potential.js';

/** The key of a unit form: a chess record's `status` as `${phase}/${level}/${skillLevel}/${equipLevel}`. */
export function statusKey(status) {
  const s = status && typeof status === 'object' ? status : {};
  return `${s.phase ?? 0}/${s.level ?? 1}/${s.skillLevel ?? 1}/${s.equipLevel ?? 0}`;
}

/**
 * Fields a composed record takes from the chess record (its identity); every other field comes from the character.
 * tools/build-data.mjs fails the build when a chess field is neither one of these nor set by composeUnitRecord.
 */
export const IDENTITY_FIELDS = Object.freeze([
  'chessId', 'baseId', 'goldenId', 'isGolden', 'tier', 'identifier', 'isHidden', 'isDiy', 'visible', 'chessType', 'backup',
  'shopSortId', 'bonds', 'garrisonIds', 'price', 'sellPrice', 'upgradeNum', 'upgradeChessId', 'status', 'diyRequirement',
]);

/** The form of `charId` at a chess `status`, or null. */
export function unitForm(backups, charId, status) {
  const forms = backups?.units?.[charId]?.forms;
  return (forms && Object.prototype.hasOwnProperty.call(forms, statusKey(status)) && forms[statusKey(status)]) || null;
}

const byNatural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

/**
 * A chess record fielded with the character of `unit` at `form`, with the selected skill and module (a new object).
 * The same rules as tools/build-data.mjs buildChess: stats = form stats + the module's `attr`, trait = the module's
 * `traitOverride` or the form's, talents = form talents + the module's `talentChanges`; `module` is active only when
 * `status.equipLevel > 0` and the module has that level; an elite with `equipLevel > 0` carries
 * `statsBase` / `traitBase` / `talentsBase` / `modules[]`; `tokens` are the summons the selection produces. The record is
 * composed at ONE potential: pass the form at the wanted potential (shared/potential.js atPotential — a stand-in has none)
 * and the result carries no potential annotation (`potDown`, chained talents).
 * @param {object} identity the data/chess.json record whose identity the unit takes (IDENTITY_FIELDS)
 * @param {object} unit backups.units[charId]
 * @param {object} form backups.units[charId].forms[statusKey(identity.status)]
 * @param {{ skillIndex?: number, moduleId?: string|null, standInFor?: string|null, bonds?: string[]|null }} [sel]
 *   `bonds` replaces the identity's (a DIY slot's are empty: the pick's derived bonds); `standInFor` = the replaced
 *   operator's charId (the official 补位 mark on the avatar)
 * @returns {object|null} null when a part is missing
 */
export function composeUnitRecord(identity, unit, form, { skillIndex, moduleId = null, standInFor = null, bonds = null } = {}) {
  if (!identity || typeof identity !== 'object' || !unit || !form) return null;
  const out = {};
  for (const k of IDENTITY_FIELDS) if (Object.prototype.hasOwnProperty.call(identity, k)) out[k] = identity[k];
  if (Array.isArray(bonds)) out.bonds = [...bonds];
  const equipLevel = identity.status?.equipLevel || 0;
  const skills = Array.isArray(form.skills) ? form.skills : [];
  const skill = skills.find((s) => s && s.index === skillIndex) ?? null;
  const mods = Array.isArray(form.modules) ? form.modules : null;
  const mod = moduleId && mods ? mods.find((m) => m && m.uniEquipId === moduleId) ?? null : null;
  const talents = composeTalents(form.talents, mod ? mod.talentChanges : null);
  // summons: listed by the character, produced by the selected skill or a talent (buildChess `tokens`)
  const known = new Set(form.tokens || []);
  const tokenIds = new Set([...(form.displayTokens || []), skill?.overrideTokenKey, ...(talents || []).map((t) => t?.tokenKey)]
    .filter((id) => id && known.has(id)));
  const info = moduleId ? unit.moduleNames?.[moduleId] ?? null : null;
  const golden = !!identity.isGolden;
  const a = unit.assets || {};
  Object.assign(out, {
    charId: unit.charId, name: unit.name, appellation: unit.appellation, rarity: unit.rarity, profession: unit.profession,
    subProfessionId: unit.subProfessionId, subProfessionName: unit.subProfessionName, position: unit.position,
    nationId: unit.nationId,
    stats: mod ? composeStats(form.stats, mod.attr) : form.stats,
    immunities: form.immunities, rangeId: form.rangeId, rangeGrid: form.rangeGrid,
    dmgType: form.dmgType, attackKind: form.attackKind, projectile: form.projectile, canHitFly: form.canHitFly,
    targetPriority: form.targetPriority,
    // The Chinese branch trait as a boolean (build-data). A localized form keeps it after the trait text is
    // translated, so a 自选 推击手 still stands on a 高台 (GitHub #676). Absent when the form has no flag.
    ...(form.placeOnRanged === true ? { placeOnRanged: true } : {}),
    trait: (mod && mod.traitOverride) || form.trait,
    skill: skill ? { ...skill } : null,
    talents,
    tokens: [...tokenIds].sort(byNatural),
    module: moduleId
      ? { id: moduleId, name: info?.name ?? null, type: info?.typeName ?? null, level: equipLevel, active: equipLevel > 0 && !!mod }
      : (equipLevel > 0 ? { id: null, name: null, type: null, level: equipLevel, active: false } : null),
    assets: {
      avatar: golden ? a.avatarGolden : a.avatar, portrait: golden ? a.portraitGolden : a.portrait, spine: golden ? a.spineGolden ?? a.spine : a.spine,
      skillIcon: (golden ? a.skillIconGolden : null) ?? a.skillIcon ?? skill?.iconId ?? null,
      subProfIcon: golden ? a.subProfIconGolden ?? a.subProfIcon : a.subProfIcon,
      ...(a.voice || a.voiceGolden ? { voice: golden ? a.voiceGolden ?? a.voice : a.voice } : {}),
    },
    skills: skills.map((s) => ({ ...s, isDefault: s.index === skillIndex })),
  });
  if (golden && equipLevel > 0) {
    out.statsBase = form.stats;
    out.traitBase = form.trait;
    out.talentsBase = stripPotential(form.talents);
    out.modules = (mods || []).map((m) => ({ ...stripPotential(m), isDefault: m.uniEquipId === moduleId }));
  }
  for (const k of ['kitRef', 'skillSpec', 'talentMods', 'dsl', 'pluginId', 'origin']) if (Object.hasOwn(form, k) || Object.hasOwn(unit, k)) out[k] = form[k] ?? unit[k];
  if (standInFor) out.standInFor = standInFor;
  return out;
}

/**
 * Whether a player may mark chess record `chess` as not owned (干员持有 → 下掉, the approved 0.2.0 补位 plan, owner's
 * decision 2026-10-05): a NORMAL base chess (not the elite, not a 自选 slot) whose official stand-in is another
 * character — the 55 chess of DATA.md §18 (53 of them in this season's shop; the hidden 百炼嘉维尔 t5 / 妮芙 t6 forms are
 * retired). A PRESET (特许) chess always fields its own operator ("预设棋子…无论是否持有都由本人上场").
 * @param {any} chess data/chess.json record
 */
export function isDroppableChess(chess) {
  const b = chess && typeof chess === 'object' ? chess.backup : null;
  return !!(b && !chess.isGolden && !chess.isDiy && chess.chessType === 'NORMAL'
    && (!chess.baseId || chess.baseId === chess.chessId)
    && typeof b.charId === 'string' && b.charId && b.charId !== chess.charId);
}

/**
 * The 补位 record of a chess: a NORMAL chess (normal or elite) fielded as its official stand-in — `backup.charId` at
 * the chess's own status, skill `backup.skillIndex`, module `backup.uniEquipId` (none when null), full potential like
 * every unit form (the 原型干员 have no potential ranks) — with the chess's bonds, 特质, tier, price and merge. Null for a
 * PRESET (特许: always the real operator) or DIY chess, or when the data lacks the unit / form.
 * @param {object} chess data/chess.json record
 * @param {object} backups data/backups.json
 */
export function standInRecord(chess, backups) {
  const b = chess?.backup;
  if (!b || chess.chessType !== 'NORMAL' || !b.charId || b.charId === chess.charId) return null;
  const unit = backups?.units?.[b.charId] ?? null;
  return composeUnitRecord(chess, unit, unitForm(backups, b.charId, chess.status),
    { skillIndex: b.skillIndex, moduleId: b.uniEquipId ?? null, standInFor: chess.charId });
}
