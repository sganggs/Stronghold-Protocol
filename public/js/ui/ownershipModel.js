// 干员持有 (operator ownership, 0.2.0 补位) — pure logic of the 干员持有 tab of the 干员调配 overlay (screens/ownership.js),
// shared with the sync (ui/loadoutSync.js) and the tests. The approved plan (owner's decision 2026-10-05): a player marks
// operators as not owned ("下掉"); only the 55 NORMAL chess can be dropped (shared/standIn.js isDroppableChess — the 74
// PRESET chess always field their own operator); default = everything owned; out of match (the next match takes it);
// co-op: the player's own pieces only; no friend borrowing. A dropped chess is deployed and shown as its official
// stand-in (data/backups.json; the owner's recall of 2026-10-06: cards, pieces and the result show the stand-in) while
// its bonds, 特质, tier, price and merge stay the chess's.
//
// The per-browser setting is a sorted list of base chess ids, persisted in localStorage (`sp.pref.ownership` =
// { v: 1, notOwned }) and sent with C2S `room.ownership { notOwned }` (the server keeps the droppable ids and drops the
// rest — shared/protocol.js checkNotOwned — so a stale list never gets refused). 导出 / 导入 use a versioned envelope
// like the loadout presets.
// By operator (DESIGN §35.23, M1): stored as charIds — `sp.pref.ownership` = { v: 2, notOwnedChars } — so 第一期's reused
// chess ids never mark another operator; ui/loadoutSync.js shows `notOwned` (chess ids of the data on screen) as a view
// (notOwnedView) and writes an edit back by operator (rebaseChars). A v1 list (chess ids of 第二期下半) is migrated
// through 第二期下半's chess.json; 导出 writes v2, 导入 reads v1 and v2. A v2 store also carries `notOwned` (the same list by
// 第二期下半's chess ids, when the page has that map) for an older build on the same origin; this build ignores it.

import { checkNotOwned, OWNERSHIP_LIMITS } from '../../../shared/protocol.js';
import { isDroppableChess, standInRecord } from '../../../shared/standIn.js';
import { t } from '../../../shared/i18n.js';

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const OWNERSHIP_PREF = 'ownership';
export const OWNERSHIP_VERSION = 2;
/** `kind` of an exported ownership envelope. */
export const OWNERSHIP_EXPORT_KIND = 'stronghold.ownership';
/** A picked file / pasted payload longer than this is refused before parsing (a real payload is under 4 KB). */
export const OWNERSHIP_IMPORT_MAX_BYTES = 64 * 1024;

const ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Structurally valid, deduplicated, sorted ids of a raw list (junk dropped; at most OWNERSHIP_LIMITS.notOwned).
 * @param {any} list
 * @returns {string[]}
 */
export function cleanIds(list) {
  const out = new Set();
  for (const id of Array.isArray(list) ? list : []) {
    if (out.size >= OWNERSHIP_LIMITS.notOwned) break;
    if (typeof id === 'string' && ID_RE.test(id) && !UNSAFE_IDS.has(id)) out.add(id);
  }
  return [...out].sort();
}

/**
 * Parse a stored v1 setting (any junk → []): `{ v: 1, notOwned }` or a bare array from an older build — chess ids of
 * 第二期下半 (the migration's input).
 * @param {any} raw
 * @returns {string[]}
 */
export function parseStoredOwnership(raw) {
  if (Array.isArray(raw)) return cleanIds(raw);
  return isObj(raw) && raw.v !== 2 ? cleanIds(raw.notOwned) : [];
}

/** Parse a stored v2 setting: the operators marked not owned (charIds; any junk → []). @param {any} raw */
export function parseStoredOwnershipChars(raw) {
  return isObj(raw) && raw.v === 2 ? cleanIds(raw.notOwnedChars) : [];
}

/** Serialised form for localStorage (v2: charIds; `notOwned`: the copy by 第二期下半's chess ids for older builds, when given). */
export const toStoredOwnership = (notOwnedChars, notOwned = undefined) => ({ v: OWNERSHIP_VERSION, notOwnedChars: cleanIds(notOwnedChars),
  ...(Array.isArray(notOwned) ? { notOwned: cleanIds(notOwned) } : {}) });
/** The v1 form (chess ids), written only while a v1 store still waits for its migration. */
export const toStoredOwnershipV1 = (notOwned) => ({ v: 1, notOwned: cleanIds(notOwned) });

/**
 * The view of the operators marked not owned for a data set (`map`: ui/loadoutModel.js charKeyMap): their chess ids.
 * @param {string[]} chars @param {{ toChess: Map<string, string> }} map
 */
export function notOwnedView(chars, map) {
  return cleanIds((chars || []).map((c) => map?.toChess?.get(c)).filter(Boolean));
}

/**
 * Write an edit of a view back by operator (like ui/loadoutModel.js rebaseByChar) — only what the edit changed: chess it
 * removed clear their operator, chess it added add theirs; operators the view did not show stay.
 * @param {string[]} chars @param {string[]} prev @param {string[]} next @param {(chessId: string) => string|null|undefined} charOf
 */
export function rebaseChars(chars, prev, next, charOf) {
  const out = new Set(chars || []);
  const keep = new Set(next || []);
  const had = new Set(prev || []);
  for (const id of had) if (!keep.has(id)) { const c = charOf(id); if (c) out.delete(c); }
  for (const id of keep) if (!had.has(id)) { const c = charOf(id); if (typeof c === 'string' && c) out.add(c); }
  return cleanIds([...out]);
}

/**
 * The ids to keep / send against the loaded data: droppable chess only (checkNotOwned), sorted.
 * @param {any} notOwned @param {(id: string) => any} getChess
 * @returns {string[]}
 */
export function sanitizeNotOwned(notOwned, getChess) {
  const res = checkNotOwned(cleanIds(notOwned), getChess);
  return res && res.ok ? res.notOwned : [];
}

/** Whether a chess is owned under a not-owned list (its base id is absent). */
export function isOwned(notOwned, chessId) {
  return !(Array.isArray(notOwned) && notOwned.includes(chessId));
}

/**
 * Toggle one chess: owned ↔ not owned. Returns a new sorted list (the input is not changed).
 * @param {string[]} notOwned @param {string} chessId base chess id
 * @param {boolean} [owned] the wanted state (default: the other one)
 */
export function setOwned(notOwned, chessId, owned = !isOwned(notOwned, chessId)) {
  const set = new Set(cleanIds(notOwned));
  if (owned) set.delete(chessId); else set.add(chessId);
  return [...set].sort();
}

// ---- roster -------------------------------------------------------------------------------------------------------

/**
 * The chess the screen lists: droppable chess in this season's shop (visible), in shop order (tier, shopSortId).
 * @param {any[]} list data.list('chess')
 */
export function ownershipRoster(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => isDroppableChess(c) && c.visible !== false && !c.isHidden)
    .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0) || String(a.chessId).localeCompare(String(b.chessId)));
}

/** The roster grouped by tier: [{ tier, list }] in tier order. */
export function rosterByTier(roster) {
  const by = new Map();
  for (const c of roster) {
    if (!by.has(c.tier)) by.set(c.tier, []);
    by.get(c.tier).push(c);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([tier, list]) => ({ tier, list }));
}

/**
 * What the screen shows of a chess's stand-in: the composed record (shared/standIn.js — the stand-in at the chess's
 * normal status with its backup skill) reduced to the card's fields; null without the data.
 * @param {any} chess normal chess record @param {any} backups data/backups.json
 * @returns {{ charId: string, name: string, appellation: string, profession: string, subProfessionName: string,
 *   rarity: number, skill: any, record: any } | null}
 */
export function standInSummary(chess, backups) {
  let rec;
  try { rec = standInRecord(chess, backups); } catch { rec = null; }
  if (!rec) return null;
  return {
    charId: rec.charId, name: rec.name, appellation: rec.appellation || '', profession: rec.profession,
    subProfessionName: rec.subProfessionName || '', rarity: rec.rarity, skill: rec.skill, record: rec,
  };
}

/** Number of listed chess marked as not owned (ids of retired / unknown chess do not count). */
export function notOwnedCount(notOwned, roster) {
  const ids = new Set(Array.isArray(notOwned) ? notOwned : []);
  let n = 0;
  for (const c of roster || []) if (ids.has(c.chessId)) n++;
  return n;
}

// ---- export / import -------------------------------------------------------------------------------------------------

/** Portable payload of the operators marked not owned (v2: charIds), as downloaded / copied by 导出. */
export function exportOwnership(notOwnedChars, { now = Date.now() } = {}) {
  const list = cleanIds(notOwnedChars);
  return {
    kind: OWNERSHIP_EXPORT_KIND,
    v: OWNERSHIP_VERSION,
    exportedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
    count: list.length,
    notOwnedChars: list,
  };
}

/** Pretty JSON of `exportOwnership`. */
export const serializeOwnership = (notOwned, opts) => JSON.stringify(exportOwnership(notOwned, opts), null, 2);

/**
 * Parse an imported list: the envelope, the stored `{ v, notOwned }` form, a bare array of ids, or the text of any of
 * them. STRUCTURAL only — the caller sanitises against the loaded data (sanitizeNotOwned). An envelope may hold an empty
 * list (= every operator owned). A v2 payload gives `notOwnedChars` (charIds) instead of `notOwned` (v1: chess ids of
 * 第二期下半 — the caller maps them, ui/loadoutSync.js).
 * @param {any} input payload or text
 * @returns {{ ok: true, notOwned?: string[], notOwnedChars?: string[] } | { ok: false, error: string }}
 */
export function parseOwnershipImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > OWNERSHIP_IMPORT_MAX_BYTES) return { ok: false, error: t('内容过长，无法导入') };
    const text = raw.trim();
    if (!text) return { ok: false, error: t('没有可导入的内容') };
    try { raw = JSON.parse(text); } catch { return { ok: false, error: t('无法识别的内容') }; }
  }
  if (Array.isArray(raw)) return { ok: true, notOwned: cleanIds(raw) };
  if (!isObj(raw)) return { ok: false, error: t('无法识别的格式') };
  const v = Number.isInteger(raw.v) ? raw.v : null;
  if (v != null && v > OWNERSHIP_VERSION) return { ok: false, error: t('这份数据来自更新的版本（v{v}），请先更新游戏', { v }) };
  const kind = typeof raw.kind === 'string' ? raw.kind : null;
  if (kind && kind !== OWNERSHIP_EXPORT_KIND) return { ok: false, error: t('这不是干员持有的数据') };
  if (v === 2) return Array.isArray(raw.notOwnedChars) ? { ok: true, notOwnedChars: cleanIds(raw.notOwnedChars) } : { ok: false, error: t('里面没有干员持有的数据') };
  if (!Array.isArray(raw.notOwned)) return { ok: false, error: t('里面没有干员持有的数据') };
  return { ok: true, notOwned: cleanIds(raw.notOwned) };
}
