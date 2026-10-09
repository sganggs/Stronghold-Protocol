// Operator loadout model (DESIGN §16) — pure logic of the 干员调配 screen (screens/loadout.js), shared with the sync
// (ui/loadoutSync.js) and usable by the in-match UI (shop cards / detail panel: `effectiveChoice`, `selectedSkill`).
//
// The per-browser loadout is `{ [baseChessId]: { skill?: skillIndex, module?: uniEquipId | 'none' } }`, persisted in
// localStorage (`sp.pref.loadout` = { v: 1, entries }) and sent with C2S `room.loadout { entries }`. Only choices that
// differ from the chess's defaults are kept. The legal choices come from data/chess.json (DESIGN §16): every chess has
// `skills[]` (SkillRecord at its own skill level — the normal chess Lv4, the elite Lv7) and elites `modules[]`
// (ModuleRecord: uniEquipId, name, typeName, attr, traitOverride, talentChanges, isDefault) — while the data lacks
// them only the default skill / module is offered. The option rules are shared with the server
// (shared/protocol.js loadoutOptions / checkLoadout), so a sanitised loadout is always accepted.
// 潜能 / 练度 (0.2.2, the owner's decision of 2026-10-08): `ops` = `{ [charId]: { potential?: 1–6, cultivate?: 0–3 } }` —
// per operator, so the normal, elite and 自选 forms share them; only values that differ from the defaults (潜能 6,
// 精英2 Lv.60) are kept; stored beside the entries (`sp.pref.loadout` = { v: 1, entries, ops }; an older stored loadout
// has none = the defaults) and sent with `room.loadout { entries, ops }` (shared/protocol.js checkLoadoutOps).

import { voiceOverrideOf } from './gameLogic/operatorVoice.js';

import { loadoutOptions, checkLoadout, checkLoadoutOps, resolveLoadout, MODULE_NONE, LOADOUT_LIMITS } from '../../../shared/protocol.js';
import { isPotential, isCultivate, POTENTIAL_DEFAULT, CULTIVATE_DEFAULT } from '../../../shared/potential.js';
import { t, N_ } from '../../../shared/i18n.js';

export { MODULE_NONE };

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const LOADOUT_PREF = 'loadout';
export const LOADOUT_VERSION = 1;

export const PROF_ORDER = ['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL'];
export const PROF_NAME = Object.freeze({ PIONEER: N_('先锋'), WARRIOR: N_('近卫'), TANK: N_('重装'), SNIPER: N_('狙击'), CASTER: N_('术师'), MEDIC: N_('医疗'), SUPPORT: N_('辅助'), SPECIAL: N_('特种') });
export const SP_TYPE = Object.freeze({ INCREASE_WITH_TIME: N_('自动回复'), INCREASE_WHEN_ATTACK: N_('攻击回复'), INCREASE_WHEN_TAKEN_DAMAGE: N_('受击回复'), ON_DEPLOY: N_('被动'), 8: N_('被动') });
/** Module attribute keys (ModuleRecord.attr / battle_equip attributeBlackboard) → label + unit. */
export const ATTR_LABEL = Object.freeze({
  maxHp: [N_('生命上限'), ''], max_hp: [N_('生命上限'), ''], atk: [N_('攻击力'), ''], def: [N_('防御力'), ''], res: [N_('法术抗性'), ''],
  magic_resistance: [N_('法术抗性'), ''], aspd: [N_('攻击速度'), ''], attack_speed: [N_('攻击速度'), ''], cost: [N_('部署费用'), ''],
  blockCnt: [N_('阻挡数'), ''], block_cnt: [N_('阻挡数'), ''], respawnTime: [N_('再部署时间'), N_('秒')], respawn_time: [N_('再部署时间'), N_('秒')],
  baseAttackTime: [N_('攻击间隔'), N_('秒')], base_attack_time: [N_('攻击间隔'), N_('秒')], moveSpeed: [N_('移动速度'), ''], hpRecoveryPerSec: [N_('每秒回复'), ''],
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
/** id keys a parsed payload must never inject into an entry map: `{ "__proto__": … }` would rewrite the prototype. */
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);

// ---- storage -----------------------------------------------------------------------------------------------------

/**
 * Parse a stored loadout (any junk → {}): keeps structurally valid entries only (ids, skill ints, module ids).
 * @param {any} raw `{ v, entries }` (or a bare entries map from an older build)
 * @returns {Record<string, { skill?: number, module?: string }>}
 */
export function parseStored(raw) {
  const src = isObj(raw) && isObj(raw.entries) ? raw.entries : isObj(raw) && raw.v == null ? raw : null;
  const out = {};
  if (!src) return out;
  for (const [id, e] of Object.entries(src)) {
    if (Object.keys(out).length >= LOADOUT_LIMITS.entries) break;
    if (UNSAFE_IDS.has(id) || !/^[A-Za-z0-9_\-.:]{1,64}$/.test(id) || !isObj(e)) continue;
    const x = {};
    if (isInt(e.skill) && e.skill >= 0 && e.skill <= LOADOUT_LIMITS.skillIndex) x.skill = e.skill;
    if (typeof e.module === 'string' && /^[A-Za-z0-9_\-.:]{1,64}$/.test(e.module)) x.module = e.module;
    if (Object.keys(x).length) out[id] = x;
  }
  return out;
}

/**
 * Parse the stored per-operator 潜能 / 练度 (0.2.2; any junk → {}): structurally valid entries only, defaults dropped.
 * An older stored loadout (no `ops`) gives {} — every operator at the defaults.
 * @param {any} raw `{ v, entries, ops }`
 * @returns {Record<string, { potential?: number, cultivate?: number }>}
 */
export function parseStoredOps(raw) {
  const src = isObj(raw) && isObj(raw.ops) ? raw.ops : null;
  const out = {};
  if (!src) return out;
  for (const [id, e] of Object.entries(src)) {
    if (Object.keys(out).length >= LOADOUT_LIMITS.ops) break;
    if (UNSAFE_IDS.has(id) || !/^[A-Za-z0-9_\-.:]{1,64}$/.test(id) || !isObj(e)) continue;
    const x = {};
    if (isPotential(e.potential) && e.potential !== POTENTIAL_DEFAULT) x.potential = e.potential;
    if (isCultivate(e.cultivate) && e.cultivate !== CULTIVATE_DEFAULT) x.cultivate = e.cultivate;
    if (Object.keys(x).length) out[id] = x;
  }
  return out;
}

/** Serialised form for localStorage (`ops`: the per-operator 潜能 / 练度, 0.2.2). */
export const toStored = (entries, ops = {}) => ({ v: LOADOUT_VERSION, entries: entries || {}, ops: ops || {} });

// ---- 潜能 / 练度 (0.2.2) ------------------------------------------------------------------------------------------------

/**
 * The effective 潜能 / 练度 of operator `charId` under the stored settings (the defaults for a missing entry or field).
 * @param {Record<string, any>|null|undefined} ops @param {string|null|undefined} charId
 * @returns {{ potential: number, cultivate: number, changed: boolean }}
 */
export function opsOf(ops, charId) {
  const e = charId && isObj(ops) && Object.hasOwn(ops, charId) && isObj(ops[charId]) ? ops[charId] : null;
  const potential = e && isPotential(e.potential) ? e.potential : POTENTIAL_DEFAULT;
  const cultivate = e && isCultivate(e.cultivate) ? e.cultivate : CULTIVATE_DEFAULT;
  return { potential, cultivate, changed: potential !== POTENTIAL_DEFAULT || cultivate !== CULTIVATE_DEFAULT };
}

/**
 * Set (part of) one operator's 潜能 / 练度; an entry equal to the defaults is removed. Returns a new map.
 * @param {Record<string, any>} ops @param {string} charId @param {{ potential?: number, cultivate?: number }} patch
 */
export function setOps(ops, charId, patch) {
  if (typeof charId !== 'string' || !charId) return ops;
  const cur = opsOf(ops, charId);
  const potential = patch && isPotential(patch.potential) ? patch.potential : cur.potential;
  const cultivate = patch && isCultivate(patch.cultivate) ? patch.cultivate : cur.cultivate;
  const out = { ...(ops || {}) };
  delete out[charId];
  const e = {};
  if (potential !== POTENTIAL_DEFAULT) e.potential = potential;
  if (cultivate !== CULTIVATE_DEFAULT) e.cultivate = cultivate;
  if (Object.keys(e).length) out[charId] = e;
  return out;
}

/** Remove one operator's 潜能 / 练度 (恢复默认). */
export function resetOps(ops, charId) {
  if (!ops || !Object.hasOwn(ops, charId)) return ops;
  const out = { ...ops };
  delete out[charId];
  return out;
}

/**
 * The settings to send (`room.loadout.ops`): every stored entry the server would keep for the loaded data (an operator
 * of the 干员调配 roster or the 自选 owned pool, `isOperator` — shared/protocol.js cultivationCharIds), the rest dropped one
 * by one; defaults dropped.
 * @param {Record<string, any>} ops @param {(charId: string) => boolean} isOperator
 * @returns {Record<string, { potential?: number, cultivate?: number }>}
 */
export function sanitizeOps(ops, isOperator) {
  const out = {};
  for (const [id, e] of Object.entries(ops || {})) {
    if (Object.keys(out).length >= LOADOUT_LIMITS.ops) break;
    const one = {};
    if (isPotential(e?.potential)) one.potential = e.potential;
    if (isCultivate(e?.cultivate)) one.cultivate = e.cultivate;
    if (!Object.keys(one).length) continue;
    const res = checkLoadoutOps({ [id]: one }, isOperator);
    if (res.ok && res.ops[id]) {
      const x = {};
      if (res.ops[id].potential !== POTENTIAL_DEFAULT) x.potential = res.ops[id].potential;
      if (res.ops[id].cultivate !== CULTIVATE_DEFAULT) x.cultivate = res.ops[id].cultivate;
      out[id] = x;
    }
  }
  return out;
}

// ---- export / import ----------------------------------------------------------------------------------------------

/**
 * `kind` of an exported loadout envelope: what a downloaded file / a copied payload carries. `entries` is exactly
 * `room.loadout.entries`, i.e. what `setEntries` + the sync already accept.
 */
export const LOADOUT_EXPORT_KIND = 'stronghold.loadout';

/** A picked file / pasted payload longer than this is refused before parsing (a real payload is a few KB). */
export const LOADOUT_IMPORT_MAX_BYTES = 256 * 1024;

/**
 * Portable payload of a loadout, as downloaded / copied by 导出 — with the per-operator 潜能 / 练度 (`ops`, 0.2.2; an
 * older build reading it ignores the field).
 * @param {Record<string, any>} entries `room.loadout.entries`
 * @param {{ now?: number, ops?: Record<string, any> }} [o]
 */
export function exportPayload(entries, { now = Date.now(), ops = {} } = {}) {
  const clean = {};
  for (const [id, e] of Object.entries(entries || {})) if (isObj(e)) clean[id] = { ...e };
  const cleanOps = {};
  for (const [id, e] of Object.entries(ops || {})) if (isObj(e)) cleanOps[id] = { ...e };
  return {
    kind: LOADOUT_EXPORT_KIND,
    v: LOADOUT_VERSION,
    exportedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
    count: Object.keys(clean).length,
    entries: clean,
    ops: cleanOps,
  };
}

/** Pretty JSON of `exportPayload` — one preset per file / clipboard payload. */
export function serializeExport(entries, opts) {
  return JSON.stringify(exportPayload(entries, opts), null, 2);
}

/**
 * Parse an imported loadout. Tolerant by design: the envelope, the stored `{ v, entries }` form and a bare
 * `{ [chessId]: { skill, module } }` map all work, as does the serialised text of any of them. Parsing is STRUCTURAL
 * only — the caller still runs `sanitizeEntries` against the loaded data, because a preset from another season may name
 * chess / skills / modules this build does not have. `__proto__` / `constructor` keys are skipped (see parseStored).
 * A payload with `ops` (0.2.2) brings the per-operator 潜能 / 练度 too (`ops` in the result — absent when the payload has
 * none: an older export leaves the current settings alone); a payload of settings only imports.
 * @param {any} input payload object or serialised text
 * @returns {{ ok: true, entries: Record<string, any>, ops?: Record<string, any> } | { ok: false, error: string }}
 */
export function parseImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > LOADOUT_IMPORT_MAX_BYTES) return { ok: false, error: t('内容过长，无法导入') };
    const text = raw.trim();
    if (!text) return { ok: false, error: t('没有可导入的内容') };
    try { raw = JSON.parse(text); } catch { return { ok: false, error: t('无法识别的内容') }; }
  }
  if (!isObj(raw)) return { ok: false, error: t('无法识别的格式') };
  const v = isInt(raw.v) ? raw.v : null;
  // a newer envelope may reshuffle fields — refuse instead of silently reading it as something else
  if (v != null && v > LOADOUT_VERSION) return { ok: false, error: t('这份调配来自更新的版本（v{v}），请先更新游戏', { v }) };
  const kind = typeof raw.kind === 'string' ? raw.kind : null;
  if (kind && kind !== LOADOUT_EXPORT_KIND) return { ok: false, error: t('这不是干员调配的数据') };
  const entries = parseStored(raw);
  const ops = isObj(raw.ops) ? parseStoredOps(raw) : null;
  if (!Object.keys(entries).length && !(ops && Object.keys(ops).length)) return { ok: false, error: t('里面没有有效的调配条目') };
  return ops ? { ok: true, entries, ops } : { ok: true, entries };
}

// ---- options & choices ---------------------------------------------------------------------------------------------

/**
 * The chess records of one loadout slot.
 * @param {string} baseId normal chess id
 * @param {(id: string) => any} getChess
 * @returns {{ base: any, golden: any }}
 */
export function recordsOf(baseId, getChess) {
  const base = getChess(baseId) || null;
  const golden = base && base.goldenId ? getChess(base.goldenId) || null : null;
  return { base, golden };
}

/** SkillRecord of a chess record by skill index (data `skills[]`, else the default `skill`). */
export function skillRecord(chess, index) {
  if (!chess) return null;
  if (Array.isArray(chess.skills)) {
    const s = chess.skills.find((x) => x && x.index === index);
    if (s) return s;
  }
  return chess.skill && chess.skill.index === index ? chess.skill : null;
}

/** ModuleRecord of an elite by uniEquipId (data `modules[]`, else a minimal record from the default `module`). */
export function moduleRecord(golden, id) {
  if (!golden || !id || id === MODULE_NONE) return null;
  if (Array.isArray(golden.modules)) {
    const m = golden.modules.find((x) => x && x.uniEquipId === id);
    if (m) return m;
  }
  const d = golden.module;
  return d && d.id === id ? { uniEquipId: d.id, name: d.name, typeName: d.type, isDefault: true, attr: null, traitOverride: null, talentChanges: [] } : null;
}

/**
 * Everything the screen shows for one chess: its skill options (normal Lv4 + elite Lv7 records) and module options.
 * @param {any} base normal chess record
 * @param {any} golden elite record (or null)
 */
export function chessOptions(base, golden) {
  const opt = loadoutOptions(base, golden);
  const skills = opt.skills.map((index) => ({
    index,
    normal: skillRecord(base, index),
    elite: skillRecord(golden, index),
    isDefault: index === opt.defaultSkill,
  }));
  const modules = opt.modules.map((id) => ({
    id,
    rec: moduleRecord(golden, id),
    isDefault: id === opt.defaultModule,
  }));
  return { ...opt, skillOptions: skills, moduleOptions: modules };
}

/**
 * The effective choice of a chess under a stored loadout (defaults for missing / unavailable choices).
 * @returns {{ skill: number|null, module: string|null, changed: boolean }}
 */
export function effectiveChoice(entries, base, golden) {
  const opt = loadoutOptions(base, golden);
  const e = base && entries && Object.hasOwn(entries, base.chessId) ? entries[base.chessId] : null;
  const skill = e && opt.skills.includes(e.skill) ? e.skill : opt.defaultSkill;
  const module = golden ? (e && opt.modules.includes(e.module) ? e.module : opt.defaultModule) : null;
  return { skill, module, changed: skill !== opt.defaultSkill || module !== opt.defaultModule };
}

/**
 * Set (part of) one chess's choice; an entry equal to the defaults is removed. Returns a new entries map.
 * @param {Record<string, any>} entries
 * @param {any} base @param {any} golden
 * @param {{ skill?: number, module?: string }} patch
 */
export function setChoice(entries, base, golden, patch) {
  if (!base) return entries;
  const opt = loadoutOptions(base, golden);
  const cur = effectiveChoice(entries, base, golden);
  const skill = patch && patch.skill !== undefined && opt.skills.includes(patch.skill) ? patch.skill : cur.skill;
  const module = golden && patch && patch.module !== undefined && opt.modules.includes(patch.module) ? patch.module : cur.module;
  const out = { ...(entries || {}) };
  delete out[base.chessId];
  const e = {};
  if (skill !== opt.defaultSkill && skill != null) e.skill = skill;
  if (golden && module !== opt.defaultModule && module != null) e.module = module;
  if (Object.keys(e).length) out[base.chessId] = e;
  return out;
}

/** Remove one chess's entry (恢复默认). */
export function resetChoice(entries, baseId) {
  if (!entries || !Object.hasOwn(entries, baseId)) return entries;
  const out = { ...entries };
  delete out[baseId];
  return out;
}

/**
 * The entries to send (`room.loadout.entries`): every stored entry that is still legal for the loaded data, the
 * rest dropped one by one (a stale browser loadout never gets the whole message refused). Defaults are dropped.
 * @param {Record<string, any>} entries
 * @param {(id: string) => any} getChess
 * @returns {Record<string, { skill?: number, module?: string }>}
 */
export function sanitizeEntries(entries, getChess) {
  const out = {};
  for (const [id, e] of Object.entries(entries || {})) {
    if (Object.keys(out).length >= LOADOUT_LIMITS.entries) break;
    const one = {};
    if (isInt(e?.skill)) one.skill = e.skill;
    if (typeof e?.module === 'string') one.module = e.module;
    if (!Object.keys(one).length) continue;
    const res = checkLoadout({ [id]: one }, getChess);
    if (!res.ok) {
      // keep the part that is still legal (e.g. the skill when a module disappeared)
      for (const k of ['skill', 'module']) {
        if (one[k] === undefined) continue;
        const r = checkLoadout({ [id]: { [k]: one[k] } }, getChess);
        if (r.ok && r.loadout[id]) out[id] = { ...(out[id] || {}), [k]: one[k] };
      }
      continue;
    }
    if (res.loadout[id]) out[id] = one;
  }
  return out;
}

/** Selected SkillRecord of a board / shop chess under a loadout (the elite gets its Lv7 record). */
export function selectedSkill(loadout, chess, getChess) {
  const r = resolveLoadout(loadout, chess, getChess);
  return skillRecord(chess, r.skillIndex) || chess?.skill || null;
}

/** Selected ModuleRecord of an elite under a loadout (null: none / normal chess). */
export function selectedModule(loadout, chess, getChess) {
  if (!chess || !chess.isGolden) return null;
  const r = resolveLoadout(loadout, chess, getChess);
  return moduleRecord(chess, r.moduleId);
}

// ---- roster & filters ------------------------------------------------------------------------------------------------

/**
 * Visible normal chess (the loadout slots), in shop order: tier, then shopSortId.
 * @param {any[]} list data.list('chess')
 */
/** Whether a chess record is a loadout slot (a visible normal chess — what the server's checkLoadout accepts). */
export const isLoadoutSlot = (c) => !!c && !c.isGolden && c.visible !== false && !c.isHidden && !c.isDiy && (!c.baseId || c.baseId === c.chessId);

export function rosterOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter(isLoadoutSlot)
    .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0) || String(a.chessId).localeCompare(String(b.chessId)));
}

/**
 * Apply the screen's filters.
 * @param {any[]} roster rosterOf(...)
 * @param {{ tier?: number|null, prof?: string|null, bond?: string|null, query?: string, changedOnly?: boolean }} f
 * @param {Record<string, any>} entries stored loadout (for changedOnly)
 * @param {(id: string) => any} getChess
 * @param {(id: string) => any} [getBond] bond lookup (the search also matches bond names)
 * @param {Record<string, any>|null} [ops] the per-operator 潜能 / 练度 (changedOnly counts them too)
 * @param {Record<string, string>|null} [voiceOverrides] local voice preferences (changedOnly counts them too)
 */
export function filterRoster(roster, f = {}, entries = {}, getChess = () => null, getBond = () => null, ops = null, voiceOverrides = null) {
  const q = String(f.query || '').trim().toLowerCase();
  return roster.filter((c) => {
    if (f.tier && c.tier !== f.tier) return false;
    if (f.prof && c.profession !== f.prof) return false;
    if (f.bond && !(Array.isArray(c.bonds) && c.bonds.includes(f.bond))) return false;
    if (f.changedOnly) {
      const golden = c.goldenId ? getChess(c.goldenId) : null;
      if (!effectiveChoice(entries, c, golden).changed && !opsOf(ops, c.charId).changed && !voiceOverrideOf(voiceOverrides, c.charId)) return false;
    }
    if (q) {
      const hay = [c.name, c.appellation, c.subProfessionName, t(PROF_NAME[c.profession]), ...(c.bonds || []).map((b) => getBond(b)?.name)]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Number of chess whose choice differs from the defaults (only loadout slots of the loaded data count: an entry of a
 *  retired / hidden chess is never sent nor applied). Also counts 潜能 / 练度 and explicit local voice preferences once. */
export function changedCount(entries, getChess, ops = null, roster = null, voiceOverrides = null) {
  const ids = new Set(Object.keys(entries || {}));
  if (Array.isArray(roster)) for (const c of roster) if (opsOf(ops, c.charId).changed || voiceOverrideOf(voiceOverrides, c.charId)) ids.add(c.chessId);
  let n = 0;
  for (const id of ids) {
    const { base, golden } = recordsOf(id, getChess);
    if (isLoadoutSlot(base) && base.chessId === id && (effectiveChoice(entries, base, golden).changed || opsOf(ops, base.charId).changed || voiceOverrideOf(voiceOverrides, base.charId))) n++;
  }
  return n;
}

// ---- display helpers -----------------------------------------------------------------------------------------------------

/** "S2" style label of a skill index. */
export const skillLabel = (index) => (isInt(index) ? `S${index + 1}` : '—');

/** Short type badge of a module ("MAR-X" → "X", "ISW-α" → "α"); 'none' → "—". */
export function moduleBadge(rec, id = null) {
  if (!rec) return id === MODULE_NONE || id == null ? '—' : '?';
  const t = String(rec.typeName || rec.type || '');
  const m = t.match(/-([^-\s]+)$/);
  return m ? m[1] : t.slice(-1) || '?';
}

/**
 * The two lines of a trait record (data `trait` / `traitBase`, ModuleRecord `traitOverride`, DATA.md §2): `base` = the
 * 特性 the unit fights with — the class trait, or the module's own wording where the module rewrites it (official
 * `overrideDescripton`) — and `added` = the module's extra line (official `additionalDescription`), or null. The extra
 * line comes after the class trait, never instead of it: PRTS flags it 「特性追加」 on every such module, and the sim keeps
 * the class trait with the module equipped (community report of 2026-10-06, item 16.2: until 0.2.0 the 干员调配 module
 * card, its 局内数值 and the detail card showed the extra line alone on 114 of the 164 modules the screen offers).
 * @param {any} trait
 * @returns {{ base: string, added: string|null }}
 */
export function traitLines(trait) {
  if (!isObj(trait)) return { base: '', added: null };
  const base = String(trait.descRaw || trait.desc || '');
  const added = trait.moduleDescRaw || trait.moduleDesc || null;
  return { base, added: added ? String(added) : null };
}

/** The whole 特性 text of a trait record: its base line, then the module's extra line (`\n` between; RichText breaks it). */
export function fullTraitText(trait) {
  const { base, added } = traitLines(trait);
  return base && added ? `${base}\n${added}` : base || added || '';
}

/**
 * Module stat bonus as display rows (non-zero entries only).
 * @param {Record<string, number> | null | undefined} attr
 * @returns {Array<{ key: string, label: string, text: string, positive: boolean }>}
 */
export function attrRows(attr) {
  const out = [];
  if (!isObj(attr)) return out;
  for (const [k, v] of Object.entries(attr)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
    const [label, unit] = ATTR_LABEL[k] || [k, ''];
    const n = Math.abs(v) < 10 && !Number.isInteger(v) ? Number(v.toFixed(2)) : Math.round(v);
    out.push({ key: k, label: t(label), text: `${v > 0 ? '+' : ''}${n}${t(unit)}`, positive: k === 'cost' || k === 'respawnTime' || k === 'respawn_time' || k === 'baseAttackTime' || k === 'base_attack_time' ? v < 0 : v > 0 });
  }
  return out;
}

/**
 * Tags of a SkillRecord: SP recovery, SP numbers, duration / ammo, charges.
 * @returns {{ sp: string, spKind: 'time'|'atk'|'def'|'passive', init: number|null, cost: number|null, duration: string|null, charges: number|null, passive: boolean }}
 */
export function skillTags(rec) {
  if (!rec) return { sp: '—', spKind: 'time', init: null, cost: null, duration: null, charges: null, passive: false };
  const passive = rec.skillType === 'PASSIVE' || rec.spType === 'ON_DEPLOY' || rec.spType === 8;
  const spKind = passive ? 'passive' : rec.spType === 'INCREASE_WHEN_ATTACK' ? 'atk' : rec.spType === 'INCREASE_WHEN_TAKEN_DAMAGE' ? 'def' : 'time';
  let duration = null;
  if (rec.durationType === 'AMMO') duration = t('弹药');
  else if (Number(rec.duration) > 0) duration = t('{n}秒', { n: Number(rec.duration) });
  return {
    sp: t(SP_TYPE[rec.spType]) || (passive ? t('被动') : t('技力')),
    spKind,
    init: passive ? null : Number.isFinite(rec.initSp) ? rec.initSp : 0,
    cost: passive ? null : Number.isFinite(rec.spCost) ? rec.spCost : 0,
    duration,
    charges: Number(rec.maxChargeTime) > 1 ? Number(rec.maxChargeTime) : null,
    passive,
  };
}

/** Compact skill preview; SP and duration come from the selected form's generated record. */
export function quickSkillTags(rec) {
  const tags = skillTags(rec);
  if (!rec) return { ...tags, recovery: '—', duration: '—' };
  // ON_DEPLOY covers constant passives too. A finite duration distinguishes the deploy-and-expire skills;
  // some older records carry it only in the blackboard. Never infer it from a localized description.
  const seconds = Number(rec.duration) > 0 ? Number(rec.duration) : tags.passive ? Number(rec.bb?.duration) : 0;
  const deployment = tags.passive && seconds > 0;
  const recovery = deployment ? '—' : tags.passive ? t('被动') : tags.spKind === 'atk' ? t('攻回') : tags.spKind === 'def' ? t('受回') : t('自回');
  const duration = rec.durationType === 'AMMO' ? t('弹药') : seconds > 0 ? `${seconds}s`
    : tags.passive ? t('常驻') : Number(rec.duration) < 0 ? '∞' : t('瞬发');
  return { ...tags, sp: deployment ? t('部署触发') : tags.sp, recovery, duration };
}
