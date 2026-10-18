// shared/plugins/notices.js — plugin announcements (公告; DESIGN §34.14, docs/PLUGINS.md §9.2).
// Data on any plugin. Not gameplay: never a content-hash input, never a room's composition, never a match.
// Plain text only — the page renders the strings as text, so "<" and ">" stay characters [ASSUMED]. Links are
// not turned into anchors. Newlines in the body are kept.
// No Node builtin. The manifest check, the content set, the catalogue and the page share this file.

import { canonicalJson } from './identity.js';
import { canonicalLang } from '../i18nPacks.js';
import { langChain } from '../i18n.js';
import { utf8 } from '../sha256.js';

/** [ASSUMED] caps. catalogue / catalogueBytes bound all serialized notice arrays in the index, not other metadata. */
export const NOTICE_LIMITS = Object.freeze({
  perPlugin: 20,
  title: 80,
  body: 2000,
  catalogue: 100,
  catalogueBytes: 48 * 1024,
});

/** localStorage key of the notice ids this browser has opened. Every access is in try/catch. */
export const NOTICES_SEEN_KEY = 'sp.pref.notices-seen';
/** [ASSUMED] The seen list does not grow without a bound. */
const SEEN_CAP = 400;

const NOTICE_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NOTICE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTICE_KEYS = new Set(['id', 'title', 'body', 'date', 'i18n']);

/** Calendar dates sort chronologically as strings; reject impossible dates without relying on a clock. */
export function isNoticeDate(value) {
  if (typeof value !== 'string' || !NOTICE_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Control characters other than newline and tab. */
const controls = (s) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);

/**
 * @param {unknown} raw
 * @param {string[]} at
 * @param {{ code: string, text: string, at: string[] }[]} problems
 * @param {boolean} title
 * @returns {string | null}
 */
function readText(raw, at, problems, title) {
  if (typeof raw !== 'string' || !raw.trim() || controls(raw) || (title && /[\r\n]/.test(raw))) {
    problems.push({ code: 'PLUGIN_NOTICE_TEXT', text: '"notices" has a title or a body that is empty or not plain text', at });
    return null;
  }
  const max = title ? NOTICE_LIMITS.title : NOTICE_LIMITS.body;
  if ([...raw].length > max) {
    problems.push({ code: 'PLUGIN_NOTICE_LIMIT', text: '"notices" exceeds 20 notices, 80 characters of title or 2000 of body', at });
    return null;
  }
  return raw;
}

/**
 * Read a manifest's `notices` array. Any problem refuses the whole list (`notices` null): a plugin does not
 * publish a partial announcement. [ASSUMED] Unknown keys on a notice are refused. `date` is kept only as YYYY-MM-DD.
 * @param {unknown} raw
 * @returns {{ notices: { id: string, title: string, body: string, date?: string, i18n?: Record<string, { title: string, body: string }> }[] | null,
 *   problems: { code: string, text: string, at: string[] }[] }}
 */
export function readNotices(raw) {
  /** @type {{ code: string, text: string, at: string[] }[]} */
  const problems = [];
  if (!Array.isArray(raw)) {
    problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" is not a list of { id, title, body }', at: ['notices'] });
    return { notices: null, problems };
  }
  if (raw.length > NOTICE_LIMITS.perPlugin) {
    problems.push({ code: 'PLUGIN_NOTICE_LIMIT', text: '"notices" exceeds 20 notices, 80 characters of title or 2000 of body', at: ['notices'] });
  }
  /** @type {{ id: string, title: string, body: string, date?: string, i18n?: Record<string, { title: string, body: string }> }[]} */
  const notices = [];
  const seen = new Set();
  const rows = raw.length > NOTICE_LIMITS.perPlugin ? raw.slice(0, NOTICE_LIMITS.perPlugin) : raw;
  rows.forEach((row, i) => {
    const at = ['notices', String(i)];
    if (!isObj(row)) {
      problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" is not a list of { id, title, body }', at });
      return;
    }
    for (const k of Object.keys(row)) if (!NOTICE_KEYS.has(k)) {
      problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" is not a list of { id, title, body }', at: [...at, k] });
    }
    const id = typeof row.id === 'string' ? row.id : '';
    if (!NOTICE_ID.test(id) || seen.has(id)) {
      problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" is not a list of { id, title, body }', at: [...at, 'id'] });
    } else seen.add(id);
    const title = readText(row.title, [...at, 'title'], problems, true);
    const body = readText(row.body, [...at, 'body'], problems, false);
    /** @type {{ id: string, title: string, body: string, date?: string, i18n?: Record<string, { title: string, body: string }> }} */
    const item = { id, title: title || '', body: body || '' };
    if (row.date !== undefined) {
      if (!isNoticeDate(row.date)) {
        problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" is not a list of { id, title, body }', at: [...at, 'date'] });
      } else item.date = row.date;
    }
    if (row.i18n !== undefined) {
      if (!isObj(row.i18n)) {
        problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" is not a list of { id, title, body }', at: [...at, 'i18n'] });
      } else {
        /** @type {Record<string, { title: string, body: string }>} */
        const i18n = {};
        for (const [k, v] of Object.entries(row.i18n)) {
          const code = canonicalLang(k);
          if (!code) {
            problems.push({ code: 'PLUGIN_NOTICE_LANG', text: '"notices" names a language this game does not know', at: [...at, 'i18n', k] });
            continue;
          }
          if (Object.hasOwn(i18n, code)) {
            problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" is not a list of { id, title, body }', at: [...at, 'i18n', k] });
            continue;
          }
          if (!isObj(v)) {
            problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" is not a list of { id, title, body }', at: [...at, 'i18n', k] });
            continue;
          }
          if (Object.keys(v).some((key) => key !== 'title' && key !== 'body')) {
            problems.push({ code: 'PLUGIN_NOTICE_SHAPE', text: '"notices" translation only accepts title and body', at: [...at, 'i18n', k] });
          }
          const trTitle = readText(v.title, [...at, 'i18n', code, 'title'], problems, true);
          const trBody = readText(v.body, [...at, 'i18n', code, 'body'], problems, false);
          if (trTitle && trBody) i18n[code] = { title: trTitle, body: trBody };
        }
        if (Object.keys(i18n).length) item.i18n = i18n;
      }
    }
    if (id && title && body) notices.push(item);
  });
  if (problems.length) return { notices: null, problems };
  return { notices, problems };
}

/**
 * Canonical plugin.json without notices or personal theme values. Always canonicalize, including when both
 * keys are absent: introducing or removing the first notice must use exactly the same identity input.
 * Raw manifest bytes remain available separately for lock verification.
 * @param {unknown} doc parsed plugin.json
 * @returns {string | null}
 */
export function manifestTextWithoutNotices(doc) {
  if (!isObj(doc)) return null;
  const rec = /** @type {Record<string, unknown>} */ (doc);
  const copy = { ...rec };
  delete copy.notices;
  delete copy.theme;
  return canonicalJson(copy);
}

/**
 * Newest first. [ASSUMED] A dated notice (YYYY-MM-DD) is newer than an undated one. Equal dates break by
 * plugin id, then notice id.
 * @param {{ date?: string, pluginId?: string, id?: string }} a
 * @param {{ date?: string, pluginId?: string, id?: string }} b
 */
export function compareNotices(a, b) {
  const ad = typeof a?.date === 'string' ? a.date : '';
  const bd = typeof b?.date === 'string' ? b.date : '';
  if (ad !== bd) {
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? 1 : -1;
  }
  const ap = String(a?.pluginId || '');
  const bp = String(b?.pluginId || '');
  if (ap !== bp) return ap < bp ? -1 : 1;
  const ai = String(a?.id || '');
  const bi = String(b?.id || '');
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/** Full serialized UTF-8 size, including escapes, keys, ids, dates and translations. */
function noticeBytes(n) {
  return utf8(JSON.stringify(n)).length;
}

/**
 * Drop notices until the catalogue is within both caps. [ASSUMED] Walk newest-first, skipping any notice
 * that would not fit so a large entry cannot suppress smaller entries from other plugins.
 * Entries with no notices are returned unchanged, and a
 * catalogue that already fits is the same array.
 * @param {Record<string, any>[]} entries catalogue entries
 */
export function capCatalogueNotices(entries) {
  if (!Array.isArray(entries) || !entries.some((e) => Array.isArray(e?.notices) && e.notices.length)) return entries;
  /** @type {{ entryId: string, notice: any }[]} */
  const flat = [];
  for (const e of entries) {
    if (!Array.isArray(e?.notices)) continue;
    for (const n of e.notices) flat.push({ entryId: String(e.id), notice: n });
  }
  flat.sort((a, b) => compareNotices({ ...a.notice, pluginId: a.entryId }, { ...b.notice, pluginId: b.entryId }));
  const keep = new Set();
  let bytes = 0;
  const withNotices = new Set();
  for (const row of flat) {
    if (keep.size >= NOTICE_LIMITS.catalogue) break;
    // Each plugin contributes an array's brackets, and each subsequent notice a comma.
    const b = noticeBytes(row.notice) + (withNotices.has(row.entryId) ? 1 : 2);
    if (bytes + b > NOTICE_LIMITS.catalogueBytes) continue;
    keep.add(`${row.entryId}/${row.notice.id}`);
    withNotices.add(row.entryId);
    bytes += b;
  }
  if (keep.size === flat.length) return entries;
  return entries.map((e) => {
    if (!Array.isArray(e.notices)) return e;
    const notices = e.notices.filter((n) => keep.has(`${e.id}/${n.id}`));
    if (notices.length === e.notices.length) return e;
    if (!notices.length) {
      const copy = { ...e };
      delete copy.notices;
      return copy;
    }
    return { ...e, notices };
  });
}

/**
 * Notices of loaded catalogue entries (a missing status counts as loaded), newest first.
 * @param {any[]} plugins
 */
export function collectNotices(plugins) {
  /** @type {any[]} */
  const out = [];
  // The page enforces its own byte/count caps even if a server sends an uncapped catalogue.
  const loaded = (Array.isArray(plugins) ? plugins : []).filter((p) => p && (!p.status || p.status === 'loaded'));
  for (const p of capCatalogueNotices(loaded)) {
    if (!p || typeof p !== 'object') continue;
    if (p.status && p.status !== 'loaded') continue;
    if (!Array.isArray(p.notices)) continue;
    for (const n of p.notices) if (n && typeof n === 'object') out.push({ ...n, pluginId: p.id });
  }
  out.sort(compareNotices);
  return out;
}

/**
 * Title and body in the player's language, else the notice's own text (the source language).
 * @param {any} notice @param {string} lang
 */
export function localizeNotice(notice, lang) {
  const own = { title: typeof notice?.title === 'string' ? notice.title : '', body: typeof notice?.body === 'string' ? notice.body : '' };
  if (!isObj(notice?.i18n)) return own;
  const pick = (code) => {
    if (typeof code !== 'string' || !code) return null;
    const tr = notice.i18n[code];
    if (tr && typeof tr.title === 'string' && tr.title && typeof tr.body === 'string' && tr.body) return { title: tr.title, body: tr.body };
    return null;
  };
  // langChain is what to try after the requested language (shared/i18n.js). The player's own code is not in that list.
  const asked = canonicalLang(lang) || (typeof lang === 'string' ? lang : '');
  const direct = pick(asked);
  if (direct) return direct;
  for (const code of langChain(lang)) {
    const tr = pick(code);
    if (tr) return tr;
  }
  return own;
}

/**
 * What the popup lists. `nameOf` is the plugin's name in the interface language.
 * @param {any[]} plugins @param {string} lang @param {Set<string>} seen @param {(p: any) => string} [nameOf]
 */
export function noticeView(plugins, lang, seen, nameOf = (p) => (typeof p?.name === 'string' && p.name ? p.name : String(p?.id ?? ''))) {
  const byId = new Map((Array.isArray(plugins) ? plugins : []).filter((p) => p && p.id).map((p) => [p.id, p]));
  const have = seen instanceof Set ? seen : new Set();
  const notices = collectNotices(plugins).map((n) => {
    const text = localizeNotice(n, lang);
    const key = `${n.pluginId}/${n.id}`;
    return { key, pluginId: n.pluginId, id: n.id, date: typeof n.date === 'string' ? n.date : '', pluginName: nameOf(byId.get(n.pluginId) || { id: n.pluginId }), title: text.title, body: text.body, unread: !have.has(key) };
  });
  return { notices, unread: notices.some((n) => n.unread) };
}

/** @typedef {{ getItem?: (k: string) => string | null, setItem?: (k: string, v: string) => void }} NoticeStore */
/** Ids this browser has opened. A broken store reads as none. @param {NoticeStore | null} [storage] */
export function readSeen(storage) {
  try {
    storage = storage === undefined ? globalThis.localStorage : storage;
    const raw = storage?.getItem?.(NOTICES_SEEN_KEY);
    const v = JSON.parse(String(raw ?? '[]'));
    if (!Array.isArray(v)) return new Set();
    return new Set(v.filter((x) => typeof x === 'string' && x.length <= 80).slice(0, SEEN_CAP));
  } catch { return new Set(); }
}

/** @param {Set<string>} ids @param {NoticeStore | null} [storage] */
export function writeSeen(ids, storage) {
  try {
    storage = storage === undefined ? globalThis.localStorage : storage;
    const list = [...ids].slice(-SEEN_CAP);
    storage?.setItem?.(NOTICES_SEEN_KEY, JSON.stringify(list));
    return true;
  } catch { return false; }
}

/**
 * Mark these ids seen. The returned set includes them even when the store throws [ASSUMED]: the dot clears
 * for this page, and the next successful write keeps them.
 * @param {Iterable<string>} ids
 */
export function markSeen(ids, storage) {
  const seen = readSeen(storage);
  for (const id of ids) if (typeof id === 'string' && id) seen.add(id);
  writeSeen(seen, storage);
  return seen;
}
