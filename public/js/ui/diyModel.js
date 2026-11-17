// 自选编队 (0.2.0 DIY; research 0.2.0 §2, the owner's decisions of 2026-10-05) — pure logic of the 自选编队 tab of the
// 干员调配 overlay (screens/diy.js), shared with the sync (ui/loadoutSync.js), the match UI (ui/gameLogic/diy.js) and
// the tests. Four DIY slots (data/backups.json `diy.slots`: two at tier 5, two at tier 6, sold from 调度中心 level 5 / 6);
// each takes an operator: a 6★ the player owns outside the chess pool (`diy.ownedPool`) — any of its three skills and
// any module of its elite form but one of another game mode (集成战略 / 生息演算: shared/diy.js isDiyModule) — or a
// prototype (原型干员) with its locked
// skill / module; only operators with a kit are offered (`kitted`: the server's `welcome.diyKitted`). A prototype may
// fill a tier-5 and a tier-6 slot, an owned operator one slot; the picks of a tier differ (shared/diy.js
// validateDiyPicks).
//
// The per-browser setting is `{ [slotBaseId]: { charId, skillIndex?, uniEquipId? } }`, persisted in localStorage
// (`sp.pref.diy` = { v: 1, picks }) and sent with C2S `room.diy { picks }` (the server keeps the legal picks and drops
// the rest — shared/protocol.js checkDiyPicks — so a stale pick never gets the roster refused). Out of match: the next
// match takes it. 导出 / 导入 use a versioned envelope like the 干员持有 list.
// Per version (DESIGN §35.23, M1): each official version has its own slots and pools, so its picks are kept apart —
// `sp.pref.diy` for 第二期下半 (unchanged) and `sp.pref.diy.<slug>` for another version (diyPrefKey); the export names its
// version (`version`, only a non-default one).

import { DIY_LIMITS, checkDiyPicks } from '../../../shared/protocol.js';
import { diySlotIds, diySlot, diyPool, isPrototypePick, lockedSelection, isDiyModule, diyRecord } from '../../../shared/diy.js';
import { unitForm } from '../../../shared/standIn.js';
import { N_ } from '../../../shared/i18n.js';
import { DEFAULT_VERSION, versionById, versionSlug } from '../../../shared/versions.js';

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const DIY_PREF = 'diy';
export const DIY_VERSION = 1;
/** `kind` of an exported 自选编队 envelope. */
export const DIY_EXPORT_KIND = 'stronghold.diy';
/** A picked file / pasted payload longer than this is refused before parsing (a real payload is under 1 KB). */
export const DIY_IMPORT_MAX_BYTES = 64 * 1024;

const ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && ID_RE.test(v) && !UNSAFE_IDS.has(v);

/**
 * The structurally valid picks of a raw map (junk dropped, empty slots left out; at most DIY_LIMITS.slots): each pick
 * `{ charId, skillIndex?, uniEquipId? }` (skill 0–9, module an id; absent / null = the locked or no module).
 * @param {any} raw
 * @returns {Record<string, { charId: string, skillIndex?: number, uniEquipId?: string|null }>}
 */
export function cleanPicks(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [slotId, p] of Object.entries(raw)) {
    if (Object.keys(out).length >= DIY_LIMITS.slots) break;
    if (!isId(slotId) || !isObj(p) || !isId(p.charId)) continue;
    const pick = { charId: p.charId };
    if (Number.isInteger(p.skillIndex) && p.skillIndex >= 0 && p.skillIndex <= 9) pick.skillIndex = p.skillIndex;
    if (isId(p.uniEquipId)) pick.uniEquipId = p.uniEquipId;
    else if (p.uniEquipId === null) pick.uniEquipId = null;
    out[slotId] = pick;
  }
  return out;
}

/** Parse a stored setting (any junk → {}): `{ v, picks }`. @param {any} raw */
export function parseStoredDiy(raw) {
  return isObj(raw) ? cleanPicks(raw.picks) : {};
}

/** Serialised form for localStorage. */
export const toStoredDiy = (picks) => ({ v: DIY_VERSION, picks: cleanPicks(picks) });

/**
 * The localStorage key (store.js prefix `sp.pref.`) of a version's picks: 'diy' for 第二期下半, 'diy.<slug>' else.
 * @param {string|null|undefined} version a registry id
 */
export function diyPrefKey(version) {
  const v = versionById(version);
  return !v || v.id === DEFAULT_VERSION ? DIY_PREF : `${DIY_PREF}.${versionSlug(v)}`;
}

/** Number of filled slots. */
export const diyCount = (picks) => Object.keys(cleanPicks(picks)).length;

/**
 * The legal picks of a stored roster against the loaded data and the kit list (checkDiyPicks: what the server keeps).
 * @param {any} picks @param {any} data `{ chess, backups }` @param {Iterable<string>|null} kitted
 * @returns {Record<string, { charId: string, skillIndex: number, uniEquipId: string|null }>}
 */
export function sanitizeDiyPicks(picks, data, kitted) {
  const res = checkDiyPicks(cleanPicks(picks), { data, kitted });
  return res && 'ok' in res ? res.picks : {};
}

/**
 * The four slots in data order: [{ slotId, goldenId, tier, shopLevel }].
 * @param {any} data
 */
export function diySlotList(data) {
  return diySlotIds(data).map((id) => diySlot(id, data)).filter(Boolean)
    .map((s) => ({ slotId: s.baseId, goldenId: s.goldenId, tier: s.tier, shopLevel: s.shopLevel }));
}

const backupsOf = (data) => (isObj(data?.backups) ? data.backups : null);

/**
 * What a slot's tier offers of an operator: its two forms (normal E2 Lv1 skill rank 4; elite E2 Lv60 rank 7, module
 * stage 1 at tier 5 / 3 at tier 6), the skills (normal + elite record per index), the modules it may carry (the elite
 * form's, 集成战略 ones left out) and, for a prototype, its locked selection. Null when the data lacks a form.
 * @param {string} charId @param {string} slotId a slot base id @param {any} data
 */
export function pickChoices(charId, slotId, data) {
  const slot = diySlot(slotId, data);
  const backups = backupsOf(data);
  if (!slot || !backups || !slot.normal || !slot.golden) return null;
  const normal = unitForm(backups, charId, slot.normal.status);
  const elite = unitForm(backups, charId, slot.golden.status);
  if (!normal || !elite) return null;
  const proto = isPrototypePick(data, slot.tier, charId);
  const skills = (normal.skills || []).filter(Boolean).map((s) => ({ index: s.index, normal: s, elite: (elite.skills || []).find((e) => e && e.index === s.index) || s }));
  const modules = (elite.modules || []).filter(isDiyModule).map((m) => ({ uniEquipId: m.uniEquipId, rec: m }));
  return { tier: slot.tier, stage: slot.golden.status?.equipLevel ?? 0, proto, locked: proto ? lockedSelection(data, slot.tier, charId) : null, skills, modules, normal, elite };
}

/**
 * The pick a newly chosen operator starts with: a prototype's locked selection (`{ charId }` — the server completes it),
 * an owned operator's third skill (its last) and the first module it may carry (none when it has none).
 * @param {string} charId @param {string} slotId @param {any} data
 */
export function defaultPick(charId, slotId, data) {
  const ch = pickChoices(charId, slotId, data);
  if (!ch) return { charId };
  if (ch.proto) return { charId };
  const last = ch.skills.length ? ch.skills[ch.skills.length - 1].index : 0;
  return { charId, skillIndex: last, uniEquipId: ch.modules[0]?.uniEquipId ?? null };
}

/**
 * The operators a slot lists (shared/diy.js diyPool of its tier with the kit list — prototypes first, then the owned
 * 6★), each with what the picker card shows and whether another slot holds it: `taken` names that slot (an owned
 * operator fills one slot; the two picks of a tier differ).
 * @param {string} slotId @param {Record<string, any>} picks the current roster @param {any} data
 * @param {Iterable<string>|null} kitted
 * @returns {Array<{ charId: string, unit: any, bonds: string[], proto: boolean, taken: string|null }>}
 */
export function pickOptions(slotId, picks, data, kitted) {
  const slot = diySlot(slotId, data);
  const backups = backupsOf(data);
  if (!slot || !backups) return [];
  const kit = kitted ? [...kitted] : [];
  const tierOf = (id) => diySlot(id, data)?.tier ?? null;
  const roster = cleanPicks(picks);
  return diyPool(slot.tier, { data, kitted: kit }).map((charId) => {
    const proto = isPrototypePick(data, slot.tier, charId);
    let taken = null;
    for (const [other, p] of Object.entries(roster)) {
      if (other === slot.baseId || p.charId !== charId) continue;
      // the same tier: never twice; another tier: an owned operator only once (a prototype may repeat across tiers)
      if (tierOf(other) === slot.tier || !isPrototypePick(data, tierOf(other), charId)) { taken = other; break; }
    }
    return { charId, unit: backups.units?.[charId] ?? null, bonds: backups.diy?.operators?.[charId]?.bonds ?? [], proto, taken };
  });
}

/**
 * The record a slot shows for a pick (shared/diy.js diyRecord: the operator at the slot's normal form, or the elite).
 * @param {string} slotId @param {any} pick @param {any} data @param {{ elite?: boolean }} [opts]
 */
export function slotRecord(slotId, pick, data, { elite = false, potential = null } = {}) {
  if (!isObj(pick)) return null;
  try { return diyRecord(slotId, pick, { elite, data, potential }); } catch { return null; }
}

/** Set (or with null, clear) one slot. Returns a new roster (the input is not changed). */
export function setPick(picks, slotId, pick) {
  const next = { ...cleanPicks(picks) };
  if (isObj(pick) && isId(pick.charId)) next[slotId] = cleanPicks({ [slotId]: pick })[slotId];
  else delete next[slotId];
  return next;
}

// ---- export / import -------------------------------------------------------------------------------------------------

/** Portable payload of a roster, as downloaded / copied by 导出 (`version`: its version, only a non-default one). */
export function exportDiy(picks, { now = Date.now(), version = null } = {}) {
  const clean = cleanPicks(picks);
  return {
    kind: DIY_EXPORT_KIND,
    v: DIY_VERSION,
    exportedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
    ...(version && version !== DEFAULT_VERSION && versionById(version) ? { version } : {}),
    count: Object.keys(clean).length,
    picks: clean,
  };
}

/** Pretty JSON of `exportDiy`. */
export const serializeDiy = (picks, opts) => JSON.stringify(exportDiy(picks, opts), null, 2);

/**
 * Parse an imported roster: the envelope, the stored `{ v, picks }` form, or the text of either. STRUCTURAL only — the
 * caller sanitises against the loaded data (sanitizeDiyPicks). An envelope may hold no picks (= every slot empty).
 * Errors are msgids (shown through t()).
 * @param {any} input payload or text
 * @returns {{ ok: true, picks: Record<string, any> } | { ok: false, error: string, params?: Record<string, any> }}
 */
export function parseDiyImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > DIY_IMPORT_MAX_BYTES) return { ok: false, error: N_('内容过长，无法导入') };
    const text = raw.trim();
    if (!text) return { ok: false, error: N_('没有可导入的内容') };
    try { raw = JSON.parse(text); } catch { return { ok: false, error: N_('无法识别的内容') }; }
  }
  if (!isObj(raw)) return { ok: false, error: N_('无法识别的格式') };
  const v = Number.isInteger(raw.v) ? raw.v : null;
  if (v != null && v > DIY_VERSION) return { ok: false, error: N_('这份数据来自更新的版本（v{v}），请先更新游戏'), params: { v } };
  const kind = typeof raw.kind === 'string' ? raw.kind : null;
  if (kind && kind !== DIY_EXPORT_KIND) return { ok: false, error: N_('这不是自选编队的数据') };
  if (!isObj(raw.picks)) return { ok: false, error: N_('里面没有自选编队的数据') };
  return { ok: true, picks: cleanPicks(raw.picks) };
}
