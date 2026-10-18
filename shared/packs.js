// shared/packs.js — content packs (docs/PACKS.md): the language packs and their index. The owner's decision of 2026-10-07
// made the language pack the first type of a general mechanism; since the plugin system (DESIGN §32, docs/PLUGINS.md)
// that mechanism is the plugin manifest (shared/plugins/manifest.js): a pack.json is its manifest 1, type "lang" is its
// class lang, and the planned types "assets" and "data" became the classes cosmetic and content of manifest 2
// (plugins/<id>/plugin.json). This file keeps what the language menu reads — GET /packs/index.json, exactly as in
// 0.2.0 — and forwards the manifest helpers. No Node builtin: the browser, the server (server/plugins/registry.js,
// server/packs.js) and the tools share it.
//
// Three places, read by the same registry (server/plugins/registry.js) and listed alike:
//   packs/<id>/pack.json + its files     a folder pack — any type; the manifest names its files (`files`)
//   public/i18n/<code>.json              a single-file language pack — its manifest is the file's `_meta` block
//                                        (+ data/i18n/<code>.json, its game texts, when present)
//   plugins/<id>/plugin.json + files     a lang plugin: manifest 2, `"class": "lang"`, the same language fields and files
//
// Manifest (pack.json, or `_meta` of a single-file language pack; every field but type / lang optional):
//   id            a folder pack: its folder name; a single-file language pack: its language code (a manifest that names
//                 another id is reported; the place decides). Letters, digits, '.', '_', '-', ≤ 64; unique across types
//   type          "lang" (a single-file language pack may leave it out); planned: "assets", "data"
//   version       the pack's own version (e.g. "1.2.0")
//   app           the app versions it is made for, a range: ">=0.2.0", ">=0.2.0 <0.3.0", "0.2.x", "^0.2.0", "~0.2.1", "*"
//                 (a pre-release such as 0.2.0-dev counts as its release). Outside it a language pack still loads —
//                 what it lacks falls back — and is flagged `compatible: false`
//   name          the pack's name in its own language (a language pack: the language's own name, shown in the menu)
//   englishName   its English name
//   authors       a string or a list;  credits  free text;  license  an SPDX id or free text
//   files         a folder pack: role → path inside the folder (type "lang": { "ui": "ui.json", "data": "data.json" })
//   …             the type's own fields (type "lang": lang, base, fallback, complete, machineTranslated, numberUnits —
//                 shared/i18nPacks.js; a machineTranslated that is not a boolean is warned about and reads as false)
//
// Index (GET /packs/index.json — the server's live list; `node tools/packs.mjs index` writes packs/index.json for a
// static host): { version: 1, app: "<the server's app version>", packs: [entry …] } — the packs of supported types,
// sorted by type then id. An entry: id, type, name, englishName, version?, app?, compatible, authors?, credits?,
// license?, files (role → URL on this server) and the type's fields; a language entry: lang, base?, fallback,
// complete?, machineTranslated?, numberUnits?, strings (how many translations its UI file holds).

import { APP_VERSION } from './constants.js';
import { SOURCE_LANG, isLangCode, languageName, langFields } from './i18nPacks.js';
import { PACK_TYPES, PACK_MANIFEST, isPackId, isPackPath, isVersionRange, appVersionMatches, readPackManifest } from './plugins/manifest.js';

// The manifest itself — its types, ids, paths, app ranges and reading — lives in shared/plugins/manifest.js since the
// plugin system (DESIGN §32): a pack.json is its manifest 1, read exactly as before. Re-exported for the callers of
// this file.
export { PACK_TYPES, PACK_MANIFEST, isPackId, isPackPath, isVersionRange, appVersionMatches };

export const PACK_INDEX_VERSION = 1;
/** The index file next to the pack folders (packs/index.json, URL /packs/index.json). */
export const PACK_INDEX_FILE = 'index.json';
/** Where pack folders are served (server/http/static.js): /packs/<id>/<file>. */
export const PACKS_URL = '/packs/';

/**
 * @typedef {import('./plugins/manifest.js').FileRole} FileRole
 * @typedef {import('./plugins/manifest.js').PackType} PackType
 * @typedef {import('./plugins/manifest.js').PackManifest} PackManifest
 */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

/**
 * Read a manifest (manifest 1, shared/plugins/manifest.js readPackManifest): the common fields, the type's fields, a
 * folder pack's file roles. `problems` keep the pack from loading (manifest null); `warnings` do not.
 * @param {unknown} raw pack.json, or the `_meta` of a single-file language pack (undefined: none)
 * @param {{ id: string, type?: string, lang?: string, folder?: boolean, app?: string }} ctx
 *   id: the folder name / the file's code; type: the type of the layout (a single-file language pack: 'lang');
 *   lang: a single file's language code; folder: a folder pack (its `files` are read); app: the app version
 * @returns {{ manifest: PackManifest | null, problems: string[], warnings: string[] }}
 */
export const normalizeManifest = (raw, ctx) => readPackManifest(raw, ctx);

// ---- the index ----------------------------------------------------------------------------------------------------

/**
 * The index entry of a pack (what a client may know): its manifest without the folder paths, `files` as URLs, plus the
 * type's extras (a language pack: `strings`).
 * @param {PackManifest} manifest
 * @param {{ files: Record<string, string>, strings?: number }} extra files: role → URL
 */
export function packIndexEntry(manifest, extra) {
  /** @type {Record<string, unknown>} */
  const e = { id: manifest.id, type: manifest.type, name: manifest.name, englishName: manifest.englishName };
  if (manifest.version) e.version = manifest.version;
  if (manifest.app) e.app = manifest.app;
  e.compatible = manifest.compatible;
  if (manifest.authors.length) e.authors = manifest.authors;
  if (manifest.credits) e.credits = manifest.credits;
  if (manifest.license) e.license = manifest.license;
  if (manifest.type === 'lang') {
    e.lang = manifest.lang;
    if (manifest.base !== undefined) e.base = manifest.base;
    e.fallback = manifest.fallback || [];
    if (manifest.complete) e.complete = true;
    if (manifest.machineTranslated) e.machineTranslated = true;
    if (manifest.numberUnits) e.numberUnits = manifest.numberUnits;
    e.strings = extra.strings ?? 0;
  }
  e.files = { ...extra.files };
  return e;
}

/**
 * The index body from the entries of supported packs (packIndexEntry), sorted by type then id.
 * @param {Record<string, unknown>[]} entries
 * @param {{ app?: string }} [opts]
 */
export function buildPackIndex(entries, { app = APP_VERSION } = {}) {
  const key = (e) => `${e.type}\u0000${e.id}`;
  return { version: PACK_INDEX_VERSION, app, packs: [...entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)) };
}

/** A URL a client may fetch from an index: a path on this server ('/…', never '//host' or a scheme). */
const isLocalUrl = (u) => typeof u === 'string' && /^\/(?!\/)[^\s\\]*$/.test(u) && u.length <= 300;

/**
 * Read a received index (the client): the entries of supported types whose fields check out; anything else is dropped.
 * Optionally only one type.
 * @param {unknown} json
 * @param {string} [type]
 * @returns {Record<string, any>[]}
 */
export function readPackIndex(json, type) {
  const list = isObj(json) && Array.isArray(/** @type {any} */ (json).packs) ? /** @type {any} */ (json).packs : [];
  const out = [];
  for (const e of list) {
    if (!isObj(e) || !isPackId(e.id) || PACK_TYPES[e.type]?.status !== 'supported' || (type && e.type !== type)) continue;
    const files = {};
    for (const [role, url] of Object.entries(isObj(e.files) ? e.files : {})) if (isLocalUrl(url)) files[role] = url;
    if (e.type === 'lang' && (!isLangCode(e.lang) || e.lang === SOURCE_LANG || !files.ui)) continue;
    out.push({ ...e, files });
  }
  return out;
}

/**
 * The language a client registers for a language entry of the index (shared/i18n.js registerLangs).
 * @param {Record<string, any>} e a 'lang' entry of readPackIndex
 * @returns {import('./i18nPacks.js').LangMeta}
 */
export function langMetaOf(e) {
  const f = langFields(e.lang, e);
  return {
    ...f,
    code: e.lang,
    name: str(e.name, 60) || languageName(e.lang),
    englishName: str(e.englishName, 60) || languageName(e.lang, 'en'),
    authors: Array.isArray(e.authors) ? e.authors.map((a) => str(a)).filter(Boolean).slice(0, 32) : [],
    version: str(e.version, 40),
    app: str(e.app, 60),
    compatible: e.compatible !== false,
    strings: Number.isFinite(e.strings) ? e.strings : undefined,
    data: !!(e.files?.data || e.files?.dataOverlay),
    ui: e.files?.ui,
    uiOverlay: e.files?.uiOverlay,
    dataUrl: e.files?.data,
    dataOverlayUrl: e.files?.dataOverlay,
    packId: e.id,
  };
}
