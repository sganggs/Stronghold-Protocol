// shared/plugins/catalog.js — a community plugin catalogue (DESIGN §32.13, docs/PLUGINS.md §17). No Node builtin:
// the CLI, the studio page and the schema test share it. A catalogue is a document someone else publishes. This project
// does not host plugins and does not run a market; installing still means the server downloads one https zip and checks
// its SHA-256 (server/plugins/install.js). Nothing here fetches or runs a package.
//
// [ASSUMED] field limits (CATALOG_LIMITS): name 80, description 400, url / homepage 500, license 80, one author 80,
// at most 16 authors, app range 80, at most 500 entries. A catalogue document fetched over https is at most 1 MB
// (CATALOG_FETCH_MAX_BYTES). Unknown fields are problems, so the JSON Schema and this check agree, including duplicate
// ids (`uniqueItemProperties`, a keyword only this repository's validator reads) and an `app` that is not a version
// range. A missing `app` is compatible. An empty or whitespace-only `app` is not. `bytes`, when present, is a whole
// number from 0 through the largest class ceiling (PLUGIN_MAX_BYTES, 512 MB: the zip is bounded before its class is
// read, and the folder check applies the class's own afterwards); install refuses a download whose length differs.

import { APP_VERSION } from '../constants.js';
import { PLUGIN_CLASSES, PLUGIN_MAX_BYTES, appVersionMatches, isPluginId, isSemver, isVersionRange } from './manifest.js';
import { isContentHash } from './identity.js';

/** [ASSUMED] see the header. */
export const CATALOG_LIMITS = Object.freeze({
  name: 80,
  description: 400,
  url: 500,
  license: 80,
  author: 80,
  authors: 16,
  app: 80,
  plugins: 500,
});

/** [ASSUMED] a fetched catalogue document, not a plugin zip. */
export const CATALOG_FETCH_MAX_BYTES = 1024 * 1024;

/** Top-level fields. `$schema` is optional; the other three are required. */
export const CATALOG_FIELDS = Object.freeze(['$schema', 'catalog', 'name', 'plugins']);
/** Entry fields. Required: id, name, version, class, url, sha256. The rest are checked when present. */
export const CATALOG_ENTRY_FIELDS = Object.freeze(['id', 'name', 'version', 'class', 'description', 'url', 'sha256', 'bytes', 'homepage', 'license', 'authors', 'app']);
export const CATALOG_ENTRY_REQUIRED = Object.freeze(['id', 'name', 'version', 'class', 'url', 'sha256']);

/**
 * https URL this catalogue accepts: a dotted hostname, no user or password, optional port and path.
 * [ASSUMED] a single-label host such as `localhost` is refused; `example.invalid` and dotted IPs pass this syntax.
 * The download (server/plugins/install.js) then refuses a non-public address, a non-443 port, and `.local`.
 * The schema's `pattern` is this source.
 */
export const HTTPS_URL_SOURCE = '^https:\\/\\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?::[0-9]{1,5})?(?:\\/[A-Za-z0-9._~:/?#\\[\\]@!$&\'()*+,;=%-]*)?$';
export const HTTPS_URL_RE = new RegExp(HTTPS_URL_SOURCE);

/**
 * An `app` range, the same language as isVersionRange, anchored, with optional surrounding whitespace.
 * An empty string is not a range here (isVersionRange treats empty as "any"; a present empty `app` is invalid).
 * [ASSUMED] the schema pattern is this source. A stock editor that does not know `uniqueItemProperties` still
 * enforces this pattern.
 */
const APP_RANGE_CMP = '(?:\\^|~|>=|<=|>|<|=)?v?\\d+(?:\\.(?:\\d+|[xX*]))?(?:\\.(?:\\d+|[xX*]))?';
const APP_RANGE_ALT = `(?:\\*|x|${APP_RANGE_CMP}(?:\\s+${APP_RANGE_CMP})*)`;
export const APP_RANGE_PATTERN = `^\\s*${APP_RANGE_ALT}(?:\\s*\\|\\|\\s*${APP_RANGE_ALT})*\\s*$`;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const chars = (s) => [...s].length;

/**
 * @typedef {{ code: string, detail: string, path: string, level: 'problem' | 'warning' }} CatalogIssue
 * @typedef {{ ok: boolean, catalog: { catalog: 1, name: string, plugins: Record<string, unknown>[] } | null,
 *   problems: CatalogIssue[], warnings: CatalogIssue[] }} CatalogRead
 */

/**
 * Compare two versions by MAJOR.MINOR.PATCH only. A pre-release counts as its release (1.0.0-beta and 1.0.0 are equal),
 * the same rule as appVersionMatches. An unreadable version compares equal, so it is not treated as an upgrade.
 * @param {unknown} a @param {unknown} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const core = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = core(a);
  const pb = core(b);
  if (!pa || !pb) return 0;
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

/** Whether `value` is an https URL the catalogue accepts. @param {unknown} value */
export const isCatalogUrl = (value) => typeof value === 'string' && chars(value) <= CATALOG_LIMITS.url && HTTPS_URL_RE.test(value);

/**
 * Read a catalogue value (already parsed). `ok` is true only when there is neither a problem nor a warning, which is
 * also when schemas/catalog.schema.json accepts it (the repository validator understands `uniqueItemProperties`).
 * @param {unknown} raw
 * @returns {CatalogRead}
 */
export function readCatalog(raw) {
  /** @type {CatalogIssue[]} */
  const problems = [];
  /** @type {CatalogIssue[]} */
  const warnings = [];
  const bad = (code, detail, path) => problems.push({ code, detail, path, level: 'problem' });
  const done = (catalog) => ({ ok: problems.length === 0 && warnings.length === 0, catalog: problems.length ? null : catalog, problems, warnings });
  if (!isObj(raw)) {
    bad('PLUGIN_CATALOG_SHAPE', 'the catalogue is not a JSON object', '$');
    return done(null);
  }
  for (const k of Object.keys(raw)) if (!CATALOG_FIELDS.includes(k)) bad('PLUGIN_CATALOG_SHAPE', `unknown field ${k}`, k);
  if (Object.hasOwn(raw, '$schema') && (typeof raw.$schema !== 'string' || chars(raw.$schema) > 200)) bad('PLUGIN_CATALOG_FIELD', '"$schema" must be a string of at most 200 characters', '$schema');
  if (raw.catalog !== 1) bad('PLUGIN_CATALOG_SHAPE', '"catalog" must be 1', 'catalog');
  if (typeof raw.name !== 'string' || chars(raw.name) < 1 || chars(raw.name) > CATALOG_LIMITS.name) bad('PLUGIN_CATALOG_FIELD', `"name" must be 1–${CATALOG_LIMITS.name} characters`, 'name');
  if (!Array.isArray(raw.plugins)) bad('PLUGIN_CATALOG_SHAPE', '"plugins" must be an array', 'plugins');
  else if (raw.plugins.length > CATALOG_LIMITS.plugins) bad('PLUGIN_CATALOG_FIELD', `${raw.plugins.length} plugins, more than ${CATALOG_LIMITS.plugins}`, 'plugins');
  /** @type {Record<string, unknown>[]} */
  const plugins = [];
  const seen = new Set();
  if (Array.isArray(raw.plugins)) {
    raw.plugins.forEach((entry, i) => {
      const at = `plugins[${i}]`;
      if (!isObj(entry)) { bad('PLUGIN_CATALOG_SHAPE', `${at} is not an object`, at); return; }
      for (const k of Object.keys(entry)) if (!CATALOG_ENTRY_FIELDS.includes(k)) bad('PLUGIN_CATALOG_FIELD', `${at}.${k} is not a catalogue field`, `${at}.${k}`);
      for (const k of CATALOG_ENTRY_REQUIRED) if (!Object.hasOwn(entry, k)) {
        const code = k === 'id' ? 'PLUGIN_CATALOG_ID' : k === 'sha256' ? 'PLUGIN_CATALOG_HASH' : k === 'url' ? 'PLUGIN_CATALOG_URL' : 'PLUGIN_CATALOG_FIELD';
        bad(code, `${at} lacks ${k}`, `${at}.${k}`);
      }
      if (Object.hasOwn(entry, 'id') && !isPluginId(entry.id)) bad('PLUGIN_CATALOG_ID', `${at}.id is not a plugin id`, `${at}.id`);
      if (isPluginId(entry.id)) {
        if (seen.has(entry.id)) bad('PLUGIN_CATALOG_ID', `${entry.id} is listed twice`, `${at}.id`);
        seen.add(entry.id);
      }
      if (Object.hasOwn(entry, 'name') && (typeof entry.name !== 'string' || chars(entry.name) < 1 || chars(entry.name) > CATALOG_LIMITS.name)) bad('PLUGIN_CATALOG_FIELD', `${at}.name must be 1–${CATALOG_LIMITS.name} characters`, `${at}.name`);
      if (Object.hasOwn(entry, 'version') && !isSemver(entry.version)) bad('PLUGIN_CATALOG_FIELD', `${at}.version is not semver`, `${at}.version`);
      if (Object.hasOwn(entry, 'class') && (typeof entry.class !== 'string' || !Object.hasOwn(PLUGIN_CLASSES, entry.class))) bad('PLUGIN_CATALOG_FIELD', `${at}.class is not a plugin class`, `${at}.class`);
      if (Object.hasOwn(entry, 'description')) {
        if (typeof entry.description !== 'string' || chars(entry.description) < 1 || chars(entry.description) > CATALOG_LIMITS.description) bad('PLUGIN_CATALOG_FIELD', `${at}.description must be 1–${CATALOG_LIMITS.description} characters`, `${at}.description`);
      }
      if (Object.hasOwn(entry, 'url') && !isCatalogUrl(entry.url)) bad('PLUGIN_CATALOG_URL', `${at}.url must be an https address with no user or password`, `${at}.url`);
      if (Object.hasOwn(entry, 'sha256') && !isContentHash(entry.sha256)) bad('PLUGIN_CATALOG_HASH', `${at}.sha256 must be 64 lowercase hex digits`, `${at}.sha256`);
      if (Object.hasOwn(entry, 'bytes')) {
        // the zip: bounded by the largest class ceiling (PLUGIN_MAX_BYTES), the same bound install and the zip reader use;
        // the class's own ceiling is enforced on the extracted folder (checkPluginFolder)
        if (!Number.isInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > PLUGIN_MAX_BYTES) bad('PLUGIN_CATALOG_FIELD', `${at}.bytes must be a whole number from 0 to ${PLUGIN_MAX_BYTES}`, `${at}.bytes`);
      }
      if (Object.hasOwn(entry, 'homepage') && !isCatalogUrl(entry.homepage)) bad('PLUGIN_CATALOG_URL', `${at}.homepage must be an https address`, `${at}.homepage`);
      if (Object.hasOwn(entry, 'license') && (typeof entry.license !== 'string' || chars(entry.license) < 1 || chars(entry.license) > CATALOG_LIMITS.license)) bad('PLUGIN_CATALOG_FIELD', `${at}.license must be 1–${CATALOG_LIMITS.license} characters`, `${at}.license`);
      if (Object.hasOwn(entry, 'authors')) {
        const list = typeof entry.authors === 'string' ? [entry.authors] : entry.authors;
        if (typeof entry.authors !== 'string' && !Array.isArray(entry.authors)) bad('PLUGIN_CATALOG_FIELD', `${at}.authors must be a string or a list of strings`, `${at}.authors`);
        else if (!list.length || list.length > CATALOG_LIMITS.authors || list.some((a) => typeof a !== 'string' || chars(a) < 1 || chars(a) > CATALOG_LIMITS.author)) bad('PLUGIN_CATALOG_FIELD', `${at}.authors must be 1–${CATALOG_LIMITS.authors} names of 1–${CATALOG_LIMITS.author} characters`, `${at}.authors`);
      }
      if (Object.hasOwn(entry, 'app')) {
        const app = entry.app;
        if (typeof app !== 'string' || chars(app) < 1 || chars(app) > CATALOG_LIMITS.app || app.trim() === '' || !isVersionRange(app)) bad('PLUGIN_CATALOG_FIELD', `${at}.app is not a version range`, `${at}.app`);
      }
      if (!problems.some((p) => p.path === at || p.path.startsWith(`${at}.`))) plugins.push(entry);
    });
  }
  if (problems.length) return done(null);
  return done({ catalog: 1, name: raw.name, plugins });
}

/**
 * One entry's install status against this build.
 * `installed` is the version string in plugins/<id>/, null when the folder is there but the version cannot be read,
 * and undefined when it is not installed. Incompatible wins over installed / updatable, and the installed version is
 * still reported. [ASSUMED] every class, including cosmetic, uses appVersionMatches. A missing `app` is compatible.
 * A present `app` that is empty, whitespace, or not a range (including one appVersionMatches would treat as a match
 * because it cannot read it) is incompatible.
 * @param {Record<string, unknown>} entry
 * @param {string | null | undefined} installed
 * @param {string} [appVersion]
 * @returns {{ status: 'installed' | 'updatable' | 'incompatible' | 'available', installedVersion: string | null }}
 */
export function entryStatus(entry, installed, appVersion = APP_VERSION) {
  const app = entry.app;
  const incompatible = Object.hasOwn(entry, 'app') && (typeof app !== 'string' || app.trim() === '' || !isVersionRange(app) || !appVersionMatches(app, appVersion));
  const installedVersion = installed === undefined ? null : installed;
  if (incompatible) return { status: 'incompatible', installedVersion };
  if (installed === undefined) return { status: 'available', installedVersion: null };
  if (installed !== null && compareSemver(installed, entry.version) < 0) return { status: 'updatable', installedVersion: installed };
  return { status: 'installed', installedVersion };
}

/**
 * Annotate a catalogue readCatalog accepted.
 * @param {{ plugins: Record<string, unknown>[] }} catalog
 * @param {(id: string) => string | null | undefined} installed
 * @param {string} [appVersion]
 */
export function annotateCatalog(catalog, installed, appVersion = APP_VERSION) {
  return catalog.plugins.map((entry) => ({ ...entry, ...entryStatus(entry, installed(String(entry.id)), appVersion) }));
}
