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

import { loadoutOptions, checkLoadout, resolveLoadout, MODULE_NONE, LOADOUT_LIMITS } from '../../../shared/protocol.js';
import { T } from '../i18n.js';
export { MODULE_NONE };

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const LOADOUT_PREF = 'loadout';
export const LOADOUT_VERSION = 1;

export const PROF_ORDER = ['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL'];
export const PROF_NAME = Object.freeze({ PIONEER: T('先锋'), WARRIOR: T('近卫'), TANK: T('重装'), SNIPER: T('狙击'), CASTER: T('术师'), MEDIC: T('医疗'), SUPPORT: T('辅助'), SPECIAL: T('特种') });
export const SP_TYPE = Object.freeze({ INCREASE_WITH_TIME: T('自动回复'), INCREASE_WHEN_ATTACK: T('攻击回复'), INCREASE_WHEN_TAKEN_DAMAGE: T('受击回复'), ON_DEPLOY: T('被动'), 8: T('被动') });
/** Module attribute keys (ModuleRecord.attr / battle_equip attributeBlackboard) → label + unit. */
export const ATTR_LABEL = Object.freeze({
  maxHp: [T('生命上限'), ''], max_hp: [T('生命上限'), ''], atk: [T('攻击力'), ''], def: [T('防御力'), ''], res: [T('法术抗性'), ''],
  magic_resistance: [T('法术抗性'), ''], aspd: [T('攻击速度'), ''], attack_speed: [T('攻击速度'), ''], cost: [T('部署费用'), ''],
  blockCnt: [T('阻挡数'), ''], block_cnt: [T('阻挡数'), ''], respawnTime: [T('再部署时间'), T('秒')], respawn_time: [T('再部署时间'), T('秒')],
  baseAttackTime: [T('攻击间隔'), T('秒')], base_attack_time: [T('攻击间隔'), T('秒')], moveSpeed: [T('移动速度'), ''], hpRecoveryPerSec: [T('每秒回复'), ''],
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

/** Serialised form for localStorage. */
export const toStored = (entries) => ({ v: LOADOUT_VERSION, entries: entries || {} });

// ---- export / import ----------------------------------------------------------------------------------------------

/**
 * `kind` of an exported loadout envelope: what a downloaded file / a copied payload carries. `entries` is exactly
 * `room.loadout.entries`, i.e. what `setEntries` + the sync already accept.
 */
export const LOADOUT_EXPORT_KIND = 'stronghold.loadout';

/** A picked file / pasted payload longer than this is refused before parsing (a real payload is a few KB). */
export const LOADOUT_IMPORT_MAX_BYTES = 256 * 1024;

/**
 * Portable payload of a loadout, as downloaded / copied by 导出.
 * @param {Record<string, any>} entries `room.loadout.entries`
 * @param {{ now?: number }} [o]
 */
export function exportPayload(entries, { now = Date.now() } = {}) {
  const clean = {};
  for (const [id, e] of Object.entries(entries || {})) if (isObj(e)) clean[id] = { ...e };
  return {
    kind: LOADOUT_EXPORT_KIND,
    v: LOADOUT_VERSION,
    exportedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
    count: Object.keys(clean).length,
    entries: clean,
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
 * @param {any} input payload object or serialised text
 * @returns {{ ok: true, entries: Record<string, any> } | { ok: false, error: string }}
 */
export function parseImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > LOADOUT_IMPORT_MAX_BYTES) return { ok: false, error: T('内容过长，无法导入') };
    const text = raw.trim();
    if (!text) return { ok: false, error: T('没有可导入的内容') };
    try { raw = JSON.parse(text); } catch { return { ok: false, error: T('无法识别的内容') }; }
  }
  if (!isObj(raw)) return { ok: false, error: T('无法识别的格式') };
  const v = isInt(raw.v) ? raw.v : null;
  // a newer envelope may reshuffle fields — refuse instead of silently reading it as something else
  if (v != null && v > LOADOUT_VERSION) return { ok: false, error: T('这份调配来自更新的版本（v{0}），请先更新游戏', v) };
  const kind = typeof raw.kind === 'string' ? raw.kind : null;
  if (kind && kind !== LOADOUT_EXPORT_KIND) return { ok: false, error: T('这不是干员调配的数据') };
  const entries = parseStored(raw);
  if (!Object.keys(entries).length) return { ok: false, error: T('里面没有有效的调配条目') };
  return { ok: true, entries };
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
 */
export function filterRoster(roster, f = {}, entries = {}, getChess = () => null, getBond = () => null) {
  const q = String(f.query || '').trim().toLowerCase();
  return roster.filter((c) => {
    if (f.tier && c.tier !== f.tier) return false;
    if (f.prof && c.profession !== f.prof) return false;
    if (f.bond && !(Array.isArray(c.bonds) && c.bonds.includes(f.bond))) return false;
    if (f.changedOnly) {
      const golden = c.goldenId ? getChess(c.goldenId) : null;
      if (!effectiveChoice(entries, c, golden).changed) return false;
    }
    if (q) {
      const hay = [c.name, c.appellation, c.subProfessionName, PROF_NAME[c.profession], ...(c.bonds || []).map((b) => getBond(b)?.name)]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Number of chess whose choice differs from the defaults (only loadout slots of the loaded data count: an entry of a
 *  retired / hidden chess is never sent nor applied). */
export function changedCount(entries, getChess) {
  let n = 0;
  for (const id of Object.keys(entries || {})) {
    const { base, golden } = recordsOf(id, getChess);
    if (isLoadoutSlot(base) && base.chessId === id && effectiveChoice(entries, base, golden).changed) n++;
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
    out.push({ key: k, label, text: `${v > 0 ? '+' : ''}${n}${unit}`, positive: k === 'cost' || k === 'respawnTime' || k === 'respawn_time' || k === 'baseAttackTime' || k === 'base_attack_time' ? v < 0 : v > 0 });
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
  if (rec.durationType === 'AMMO') duration = T('弹药');
  else if (Number(rec.duration) > 0) duration = T('{0}秒', Number(rec.duration));
  return {
    sp: SP_TYPE[rec.spType] || (passive ? T('被动') : T('技力')),
    spKind,
    init: passive ? null : Number.isFinite(rec.initSp) ? rec.initSp : 0,
    cost: passive ? null : Number.isFinite(rec.spCost) ? rec.spCost : 0,
    duration,
    charges: Number(rec.maxChargeTime) > 1 ? Number(rec.maxChargeTime) : null,
    passive,
  };
}
