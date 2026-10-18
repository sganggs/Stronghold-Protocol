// shared/plugins/identity.js — the content identity of the plugin system (DESIGN §32, docs/PLUGINS.md): the format of
// the content hash `cs` that names exactly what a room plays — the simulation's code, the game data and (from P1 on)
// the plugins and their settings. No Node builtin: the server (server/plugins/identity.js reads the files it serves),
// the browser (it will check what it downloaded, P1c) and the tools compute it alike, with shared/sha256.js.
//
//   cs = sha256(canonical({ v, app, sim, data, plugins, settings, i18n?, rules? }))
//     v         CONTENT_HASH_VERSION (1)
//     app       the app version (shared/constants.js APP_VERSION)
//     sim       simHashOf(entries) = sha256(canonical(entries)), entries = [[path, sha256 of its bytes] …] sorted by
//               path: every served /sim/**.js (server/sim/, never nodeData.js), every /shared/**.js and the /data.js
//               stand-in, each named by its URL path without the leading '/' ('sim/Battle.js', 'shared/protocol.js',
//               'data.js')
//     data      { <name>: sha256 of data/<name>.json } — every data file the match or the simulation reads; not the
//               presentation files (assets, local-assets, local-fx, emotes) and not data/i18n/
//     plugins   [{ id, version, files: { <path>: sha256 } } …] in load order, their gameplay files only ([] = vanilla)
//     settings  { <id>: { <key>: value } } — the plugins' normalised settings ({} = vanilla)
//     i18n      omitted for vanilla and for a cosmetic-only selection, so the P0 hash stays bit-identical. A content
//               composition passes { <lang>: sha256 of the served i18n/<lang>.json } (a hex string, or { sha256 } as an
//               index entry stores it). index.json is not an input: it embeds cs. [ASSUMED] the index cannot diverge
//               while these inputs stay the same.
//     rules     omitted unless a composition passes at least one switch a plugin declared (DESIGN §34.15). Only those
//               switches are hashed; an undeclared switch is not filled with its default. Vanilla and a plugin that
//               does not declare rules stay byte-identical.
//   canonical(x) = JSON with the keys of every object sorted (UTF-16 code-unit order) and no white space; the string is
//   hashed as UTF-8.
// Bytes are the bytes served: a file as it lies on disk; a patched data file (P1b) as the JSON.stringify of the merged
// result, served from memory — so a client hashes exactly what it received, with no canonical form of its own. URLs
// carry the first CS_URL_DIGITS (16) hex digits, the interface CS_SHORT_DIGITS (8), a diagnostic report all 64.
// The vanilla `cs` changes with every code or data change — that is the point: two machines with the same `cs` run
// the same battles bit for bit.

import { sha256Hex } from '../sha256.js';

/** The version of the composition above (a change of it changes every `cs`). */
export const CONTENT_HASH_VERSION = 1;
/** Hex digits of `cs` in a URL (/cs/<16 hex>/index.json). */
export const CS_URL_DIGITS = 16;
/** Hex digits of `cs` the interface shows. */
export const CS_SHORT_DIGITS = 8;

/** A full content hash: 64 lowercase hex digits. @param {unknown} v */
export const isContentHash = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** The URL form of a content hash: its first CS_URL_DIGITS digits. @param {string} cs */
export const csUrlPart = (cs) => String(cs).slice(0, CS_URL_DIGITS);

/**
 * Canonical JSON: object keys sorted, no white space; strings and numbers as JSON.stringify writes them (identical in
 * every engine). A key whose value is undefined is left out, as JSON.stringify does; anything else without a JSON form
 * (undefined in an array, a function, a non-finite number, a bigint) throws — a hash input is always plain data.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonicalJson: a number that is not finite');
    const s = typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' ? undefined : JSON.stringify(value);
    if (s === undefined) throw new TypeError(`canonicalJson: a ${typeof value} has no JSON form`);
    return s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = /** @type {Record<string, unknown>} */ (value);
  const parts = [];
  for (const k of Object.keys(o).sort()) if (o[k] !== undefined) parts.push(`${JSON.stringify(k)}:${canonicalJson(o[k])}`);
  return `{${parts.join(',')}}`;
}

/**
 * The `sim` part: the hash of the sorted [path, sha256] list of the served code files.
 * @param {Iterable<[string, string]> | Record<string, string>} files [path, sha256] pairs, or { path: sha256 }
 * @returns {string}
 */
export function simHashOf(files) {
  const list = Symbol.iterator in Object(files) ? [.../** @type {Iterable<[string, string]>} */ (files)] : Object.entries(files);
  const sorted = list.map(([p, h]) => [String(p), String(h)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) if (sorted[i][0] === sorted[i - 1][0]) throw new Error(`simHashOf: ${sorted[i][0]} twice`);
  return sha256Hex(canonicalJson(sorted));
}

/**
 * @typedef {{ id: string, version: string, files: Record<string, string> }} ContentPlugin
 * @typedef {{ app: string, sim: string, data: Record<string, string>, plugins?: ContentPlugin[],
 *   settings?: Record<string, Record<string, unknown>>,
 *   i18n?: Record<string, string | { sha256?: string }>,
 *   rules?: Record<string, string> }} ContentParts
 */

/** A served-file hash: the hex string itself, or the sha256 field of an index entry. */
function hashRef(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof v.sha256 === 'string') return v.sha256;
  return null;
}

/**
 * The input of the content hash (see the header), in its canonical shape. `i18n` is included only when the caller
 * passes at least one language hash. `rules` is included only when the caller passes at least one declared switch.
 * Vanilla `computeVanillaContent` passes neither, so P0 stays unchanged.
 * @param {ContentParts} parts
 */
export function contentHashInput({ app, sim, data, plugins = [], settings = {}, i18n, rules } = /** @type {ContentParts} */ ({})) {
  const input = { v: CONTENT_HASH_VERSION, app: String(app), sim: String(sim), data: { ...data }, plugins: [...plugins], settings: { ...settings } };
  if (i18n && typeof i18n === 'object' && !Array.isArray(i18n)) {
    const langs = {};
    for (const k of Object.keys(i18n)) {
      const hex = hashRef(i18n[k]);
      if (hex) langs[k] = hex;
    }
    if (Object.keys(langs).length) input.i18n = langs;
  }
  if (rules && typeof rules === 'object' && !Array.isArray(rules) && Object.keys(rules).length) input.rules = { ...rules };
  return input;
}

/**
 * The content hash `cs` of a content set (see the header).
 * @param {ContentParts} parts
 * @returns {string} 64 lowercase hex digits
 */
export const contentHashOf = (parts) => sha256Hex(canonicalJson(contentHashInput(parts)));
