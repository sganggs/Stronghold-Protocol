// server/plugins/identity.js — the content identity of this server (DESIGN §32; the format: shared/plugins/identity.js):
// the vanilla content hash `cs`, computed once at start from the bytes the server serves —
//
//   /sim/      server/sim/**/*.js but nodeData.js (under any spelling), no dot file — server/http/static.js's rules
//   /shared/   shared/**/*.js, no dot file
//   /data.js   the browser stand-in of server/data.js (server/http/static.js DATA_SHIM_JS, passed in as `shim`)
//   data/      every data/<name>.json that server/data.js loads, but the presentation files (PRESENTATION_DATA:
//              assets — the art manifest —, local-assets / local-fx — this machine's extracted art and official
//              effects —, emotes)
//
// Until rooms can choose gameplay plugins (P1c) it is the identity of every room — a room's cosmetic plugins change no
// battle, so they leave it (DESIGN §32.3): welcome.content, room.state.content, /healthz
// `content`, BattleSpec `cs` (the sim never reads it) and the content line of a diagnostic report. GET
// /cs/<first 16 hex digits>/index.json answers its manifest (contentIndexOf): every code file's hash, every data file's
// URL (`?v=` its hash: cached for good), hash and size — what a browser needs to check what it downloaded (P1c).
// Like the build tag (server/http/buildTag.js) it describes the files at start: a file changed on disk afterwards is
// not seen before the next start (every update restarts the server, DEPLOY.md). Line endings are part of the bytes;
// .gitattributes checks code and data out with LF everywhere, so a Windows clone has the same `cs` as Linux.
// An official version's content (DESIGN §35.23, M1; server/versions.js): versionContentOf — the same code files, the
// version's own data/versions/<slug>/ files, a `cs` of its own; its manifest names the version and its data URLs.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { APP_VERSION } from '../../shared/constants.js';
import { CONTENT_HASH_VERSION, contentHashOf, simHashOf } from '../../shared/plugins/identity.js';

/** data/*.json files that only the browser's presentation reads (never part of `cs`). */
export const PRESENTATION_DATA = Object.freeze(['assets', 'local-assets', 'local-fx', 'emotes']);
/** server/sim files that are never served (lower-case; static.js SIM_PRIVATE). */
const SIM_PRIVATE = new Set(['nodedata.js']);
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** SHA-256 of bytes with node:crypto (the browser computes the same with shared/sha256.js). @param {Buffer} buf */
export const nodeSha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Every `.js` file under `dir`, recursively (links followed, as the static server does), dot entries left out.
 * @param {string} dir
 * @param {string} prefix the URL path of `dir` without the leading '/' ('sim', 'shared')
 * @param {Set<string>} [deny] lower-case file names never served
 * @returns {{ path: string, abs: string }[]}
 */
function jsFiles(dir, prefix, deny = new Set()) {
  const out = [];
  const walk = (abs, rel) => {
    let names;
    try { names = fs.readdirSync(abs); } catch { return; }
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue;
      const child = path.join(abs, name);
      let st;
      try { st = fs.statSync(child); } catch { continue; }
      if (st.isDirectory()) { walk(child, `${rel}/${name}`); continue; }
      if (!st.isFile() || path.extname(name).toLowerCase() !== '.js' || deny.has(name.toLowerCase())) continue;
      if (deny.size) {
        // the on-disk name decides (case-insensitive file systems, Windows 8.3 short names) — static.js does the same
        try { if (deny.has(path.basename(fs.realpathSync(child)).toLowerCase())) continue; } catch { continue; }
      }
      out.push({ path: `${rel}/${name}`, abs: child });
    }
  };
  walk(dir, prefix);
  return out;
}

/**
 * The code files a browser may load, by URL path: /sim/ and /shared/ (see the header; /data.js is added by the caller).
 * @param {{ simDir: string, sharedDir: string }} dirs
 * @returns {{ path: string, abs: string }[]} sorted by path
 */
export function servedCodeFiles({ simDir, sharedDir }) {
  const list = [...jsFiles(simDir, 'sim', SIM_PRIVATE), ...jsFiles(sharedDir, 'shared')];
  return list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * The data files of `cs`: the top-level `*.json` files server/data.js loads (plain files), but PRESENTATION_DATA.
 * @param {string} dataDir
 * @returns {{ name: string, file: string, abs: string }[]} sorted by name
 */
export function gameplayDataFiles(dataDir) {
  let entries;
  try { entries = fs.readdirSync(dataDir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.json'))
    .map((d) => ({ name: d.name.slice(0, -'.json'.length), file: d.name, abs: path.join(dataDir, d.name) }))
    .filter((f) => !PRESENTATION_DATA.includes(f.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * @typedef {{ cs: string, app: string, vanilla: true, sim: string, simFiles: Record<string, string>,
 *   data: Record<string, { file: string, sha256: string, bytes: number }>, index: Record<string, unknown> }} VanillaContent
 *   index: the body of GET /cs/<cs16>/index.json (contentIndexOf)
 */

/**
 * The vanilla content of this server: every served code file's and data file's hash, and `cs` (see the header).
 * @param {{ simDir: string, sharedDir: string, dataDir: string, shim: string, app?: string,
 *   hash?: (bytes: Buffer) => string, log?: { warn: Function } }} opts
 *   shim: the /data.js stand-in's text; hash: SHA-256 of bytes as hex (default node:crypto)
 * @returns {VanillaContent}
 */
export function computeVanillaContent({ simDir, sharedDir, dataDir, shim, app = APP_VERSION, hash = nodeSha256, log = noopLog }) {
  if (typeof shim !== 'string') throw new TypeError('computeVanillaContent: shim (the /data.js text) required');
  /** @type {Record<string, string>} */
  const simFiles = {};
  for (const f of servedCodeFiles({ simDir, sharedDir })) {
    try { simFiles[f.path] = hash(fs.readFileSync(f.abs)); } catch (e) { log.warn(`[content] cannot read ${f.path}: ${e?.code || e?.message || e}`); }
  }
  simFiles['data.js'] = hash(Buffer.from(shim));
  /** @type {VanillaContent['data']} */
  const data = {};
  for (const f of gameplayDataFiles(dataDir)) {
    try {
      const buf = fs.readFileSync(f.abs);
      data[f.name] = { file: f.file, sha256: hash(buf), bytes: buf.length };
    } catch (e) { log.warn(`[content] cannot read data/${f.file}: ${e?.code || e?.message || e}`); }
  }
  const sorted = Object.fromEntries(Object.entries(simFiles).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
  const sim = simHashOf(sorted);
  const cs = contentHashOf({ app, sim, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.sha256])) });
  /** @type {VanillaContent} */
  const content = { cs, app, vanilla: true, sim, simFiles: sorted, data, index: null };
  content.index = contentIndexOf(content);
  return content;
}

/**
 * The manifest of a content set (GET /cs/<cs16>/index.json): enough to recompute `cs` (shared/plugins/identity.js
 * contentHashOf over app, sim, data's hashes, plugins, settings, and, for a content selection, the sha256 fields of
 * index.i18n) and to check every data file a browser downloads. Vanilla omits i18n. index.json itself is not an input.
 * A file the set does not change points at its plain URL with `?v=` (the first 8 digits of its hash: immutable there).
 * An official version's manifest (DESIGN §35.23; server/versions.js) passes `dataUrl` (its data/versions/<slug>/ URL),
 * `version` (its registry id) and `bounds` (its official-bounds snapshot's { url, sha256, bytes }); neither key is
 * written without them, so the vanilla manifest is unchanged.
 * @param {VanillaContent} content
 * @param {{ dataUrl?: string, version?: string | null, bounds?: { url: string, sha256: string, bytes: number } | null }} [opts]
 */
export function contentIndexOf(content, { dataUrl = '/data/', version = null, bounds = null } = {}) {
  const data = {};
  for (const [name, f] of Object.entries(content.data)) data[name] = { url: `${dataUrl}${encodeURIComponent(f.file)}?v=${f.sha256.slice(0, 8)}`, sha256: f.sha256, bytes: f.bytes };
  return {
    v: CONTENT_HASH_VERSION, cs: content.cs, app: content.app, vanilla: true,
    ...(version ? { version } : {}),
    sim: content.sim, simFiles: { ...content.simFiles }, data, plugins: [], settings: {},
    ...(bounds ? { bounds: { official: { ...bounds } } } : {}),
  };
}

/**
 * The content of an official version (DESIGN §35.23, M1): the vanilla content's code (`app`, `sim`, `simFiles` — the
 * browser runs the same sim) with the version's own data files (gameplayDataFiles of its directory: the 16 gameplay
 * tables, no art manifest) and `cs = contentHashOf({ app, sim, data })`. Hashes the bytes only (no JSON parse). No index:
 * server/versions.js writes it (contentIndexOf with the version's URL and bounds). Null when the directory has no data file.
 * @param {{ vanilla: VanillaContent, dataDir: string, dataUrl: string, version: string, hash?: (bytes: Buffer) => string,
 *   log?: { warn: Function } }} opts dataDir: the version's directory; dataUrl: its URL prefix ('/data/versions/<slug>/')
 * @returns {(Omit<VanillaContent, 'index'> & { version: string, dataUrl: string }) | null}
 */
export function versionContentOf({ vanilla, dataDir, dataUrl, version, hash = nodeSha256, log = noopLog }) {
  /** @type {VanillaContent['data']} */
  const data = {};
  for (const f of gameplayDataFiles(dataDir)) {
    try {
      const buf = fs.readFileSync(f.abs);
      data[f.name] = { file: f.file, sha256: hash(buf), bytes: buf.length };
    } catch (e) { log.warn(`[versions] cannot read ${version} ${f.file}: ${e?.code || e?.message || e}`); }
  }
  if (!Object.keys(data).length) return null;
  const cs = contentHashOf({ app: vanilla.app, sim: vanilla.sim, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.sha256])) });
  return { cs, app: vanilla.app, vanilla: true, sim: vanilla.sim, simFiles: { ...vanilla.simFiles }, data, version, dataUrl };
}
