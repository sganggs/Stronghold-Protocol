import { readFxManifest as readPluginManifest } from '../plugins/fxAssets.js';
// server/studio/index.js — the plugin studio 插件工作台 (DESIGN §32.9, docs/PLUGINS.md §15; the 0.3.0 plan's interface C5):
// a page in the browser where someone who does not write code makes, previews and packs a cosmetic plugin, and an API
// that experienced authors and AI agents can use the same way. Only for this machine and the local network
// (server/studio/gate.js: a request from anywhere else gets the 404 of a page that does not exist); every file it touches
// is inside plugins/<id>/ (server/studio/files.js).
//
//   GET  /studio/                       the page (public/studio/index.html and its modules under /studio/)
//   GET  /studio/api/info               the version, the templates, the target kinds, the limits, the hot reload
//   GET  /studio/api/targets?q=&kinds=  what a plugin can change, by official name (server/studio/targets.js)
//   GET  /studio/api/slots?template=&target=   the places a template fills for a target (server/studio/templates/)
//   GET  /studio/api/suggest-id?name=&target=&template=   a free plugin id
//   GET  /studio/api/plugins            every plugin folder: name, version, class, loaded or skipped, its findings
//   POST /studio/api/plugins            a new plugin from a template { template, id, name, target, authors, license, credits }
//   POST /studio/api/plugins/remove     remove plugins { ids } (1–REMOVE_MAX): each folder moved to plugins/_removed/<id>-
//                                       <time>/ (never deleted: moving it back restores it); an id that is no plugin folder
//                                       right inside plugins/ (a '_' or dot folder, a symbolic link, a missing one), or a
//                                       plugin in use (an open room's plugin set; a running match plays its room's), is
//                                       refused alone → 200 { removed: [{ id, to }], refused: [{ id, error, params }] }
//                                       also when some or all are refused (removePlugins)
//   POST /studio/api/forge/preview      a Forge pack as { zip: base64 } or { files: [{ name, data: base64 }] } — the report,
//                                       no plugins written; needed official tables may be cached. No server path input.
//                                       noScripts: true leaves the sandboxed script plugin of kits/ out (--no-scripts).
//                                       offline: true forbids table downloads in preview/import (§34.33).
//   POST /studio/api/forge/import       the same body; writes plugins/<id>/ after the report's products pass check and pack
//   GET  /studio/api/plugins/<id>       its manifest, files, sections, findings (coded: shared/plugins/errors.js), lock
//   PUT  /studio/api/plugins/<id>/manifest     plugin.json as a whole (the advanced editor)
//   POST /studio/api/plugins/<id>/meta         basic fields { fields, lang }
//   POST /studio/api/plugins/<id>/sections     what the page edits { sections: [{ template, target }] }
//   POST /studio/api/plugins/<id>/slot         files for a slot { at, files: [{ name, data (base64), role? }], mode? }
//   POST /studio/api/plugins/<id>/ref          a slot borrows the installation's art { at, ref }
//   POST /studio/api/plugins/<id>/clear        a slot emptied { at }
//   POST /studio/api/plugins/<id>/fix          a one-click fix { code, at?, file?, params? }
//   POST /studio/api/plugins/<id>/pack         write plugin.lock.json, check (server/plugins/pack.js)
//   GET  /studio/api/plugins/<id>/zip          the folder as a zip (a download; packs nothing)
//   GET  /studio/api/plugins/<id>/preview      the temporary composition the page previews (server/studio/preview.js)
//   GET  /studio/api/plugins/<id>/f/<hash8>/<path>, …/files/<path>   a file of the folder (a draft's too)
//   PUT / DELETE /studio/api/plugins/<id>/files/<path>                write or remove one file (raw body)
//   POST /studio/api/authors            the page names its game sessions { tokens } — rooms they host apply plugin changes
//                                       by themselves
//   GET  /studio/api/events             server-sent events: { ids } of plugins whose state changed (hot reload)
//   POST /studio/api/catalog            list a community catalogue { url } or { text } / { catalog } (the server fetches
//                                       an https URL; the browser does not download a zip)
//   POST /studio/api/catalog/install    install one https zip { url, sha256, id?, bytes?, force? } — hash checked, no
//                                       code from the package is run (server/plugins/install.js)
// A change (POST, PUT, DELETE) carries the studio's key in the header X-SP-Studio (server/studio/key.js: printed with the
// studio's address when the server starts, kept in plugins/.studio-key; a wrong one → 403 PLUGIN_STUDIO_KEY) and answers
// with the plugin's state as GET /studio/api/plugins/<id> does. Errors: `{ error: <code>, params, detail }` with an HTTP
// status (codes of the error catalogue). Every change has the registry read the folders at once (server/studio/watch.js
// rescan) — the rooms using the plugin follow: re-applied by themselves where the host is the author (a session the
// studio's page named) or the only player, else their host is told (P1a's notice). The watch and that rule start with
// the first request that carries the key (activate): a server whose owner never opens the studio behaves as before.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { APP_VERSION, PLUGIN_API } from '../../shared/constants.js';
import { PLUGIN_MANIFEST, PLUGIN_LIMITS, PLUGIN_IMAGE_EXTS, PLUGIN_AUDIO_EXTS, extOf, isPackPath, isPluginId } from '../../shared/plugins/manifest.js';
import { LOCK_FILE, locateAssetPath, readPluginLock } from '../../shared/plugins/visual.js';
import { PLUGIN_ERRORS, isPluginErrorCode, issueList } from '../../shared/plugins/errors.js';
import { CATALOG_FETCH_MAX_BYTES, annotateCatalog, readCatalog } from '../../shared/plugins/catalog.js';
import { CATALOG_FETCH_TIMEOUT_MS, InstallError, fetchHttps, installFromUrl, installedPluginVersion, movePluginAside } from '../plugins/install.js';
import { sendError, sendJson } from '../http/common.js';
import { MIME, serveFile, CompressCache } from '../http/files.js';
import { checkPluginFolder, packPlugin, zipPlugin } from '../plugins/pack.js';
import { studioAllowed, isStudioChange, studioMode } from './gate.js';
import { createPluginFiles, StudioError, STUDIO_LIMITS, WRITABLE } from './files.js';
import { createTargetIndex, searchTargets, targetOf, targetSpec, TARGET_KINDS } from './targets.js';
import { TEMPLATES, templateById, createPlugin, manifestText } from './templates/index.js';
import { keyDir } from './templates/art.js';
import { openPlugin, editMeta, setSlot, clearSlot, filesOfOverlay, filesOfValue, atlasPages, FIXES, getIn, deleteIn } from './edit.js';
import { createPreviews } from './preview.js';
import { atlasInfo } from '../../tools/assets/atlas.mjs';
import { STUDIO_URL, STUDIO_API, isStudioPath } from './paths.js';
import { loadStudioKey, sameKey } from './key.js';
import { createTrialBench, TRIAL_LIMITS } from './trial.js';
import { trialOptions } from './trialOptions.js';
import { consoleOptions, buildConsoleScenario } from './console.js';
import { SCENARIO_BYTES } from '../../shared/studio/scenario.js';
import { readStudioData } from './gameData.js';
import { editMediaDraft } from './mediaDraft.js';
import { createAuthoring } from './authoring.js';
import { createPluginWatcher } from './watch.js';
import { importForge } from '../plugins/forgeImport.js';

/** Safety failures of a Forge import (the page shows the catalogue). A check failure stays in the report, HTTP 200. */
const FORGE_SAFETY = new Set(['PLUGIN_FORGE_INPUT', 'PLUGIN_FORGE_ZIP', 'PLUGIN_FORGE_JSON', 'PLUGIN_FORGE_ID', 'PLUGIN_FORGE_EXISTS']);

/**
 * A Forge pack uploaded by the page. A path on the server is never accepted.
 * @param {any} body
 * @returns {{ zip: Buffer } | { files: Map<string, Buffer> }}
 */
function forgeUpload(body) {
  if (typeof body.zip === 'string' && body.zip) {
    const buf = Buffer.from(body.zip, 'base64');
    if (!buf.length) throw new StudioError('PLUGIN_FORGE_INPUT', 400, { detail: 'empty zip' }, 'empty zip');
    if (buf.length > PLUGIN_LIMITS.pluginBytes) throw new StudioError('PLUGIN_FORGE_ZIP', 400, { detail: 'zip is larger than 200 MB' }, 'zip is larger than 200 MB');
    return { zip: buf };
  }
  if (Array.isArray(body.files)) {
    if (!body.files.length) throw new StudioError('PLUGIN_FORGE_INPUT', 400, { detail: 'no files' }, 'no files');
    if (body.files.length > PLUGIN_LIMITS.files) throw new StudioError('PLUGIN_FORGE_ZIP', 400, { detail: `more than ${PLUGIN_LIMITS.files} files` }, `more than ${PLUGIN_LIMITS.files} files`);
    const map = new Map();
    let total = 0;
    for (const f of body.files) {
      const name = typeof f?.name === 'string' ? f.name.replace(/\\/g, '/') : '';
      if (!name || typeof f?.data !== 'string') throw new StudioError('PLUGIN_FORGE_INPUT', 400, { detail: 'each file needs a name and base64 data' }, 'each file needs a name and base64 data');
      const data = Buffer.from(f.data, 'base64');
      total += data.length;
      if (data.length > PLUGIN_LIMITS.pluginBytes || total > PLUGIN_LIMITS.pluginBytes) throw new StudioError('PLUGIN_FORGE_ZIP', 400, { detail: 'files are larger than 200 MB' }, 'files are larger than 200 MB');
      if (map.has(name)) throw new StudioError('PLUGIN_FORGE_ZIP', 400, { detail: `${name.slice(0, 80)}: duplicate name` }, `${name.slice(0, 80)}: duplicate name`);
      map.set(name, data);
    }
    return { files: map };
  }
  throw new StudioError('PLUGIN_FORGE_INPUT', 400, { detail: 'send a zip or a file list, not a path on the server' }, 'send a zip or a file list, not a path on the server');
}

/** The page's URL prefix and its API's. */
/** The studio's own notes of a plugin folder (a dot file: never listed, served, checked or packed). */
export const SIDECAR = '.studio.json';
export { STUDIO_URL, STUDIO_API, isStudioPath };

/** How long a game session the page named counts as the author's after the page last named it (ms) [ASSUMED]. */
export const AUTHOR_TTL_MS = 10 * 60 * 1000;
/** Types of the page's own files under public/studio/. */
const PAGE_TYPES = new Set(['.html', '.js', '.css', '.png', '.svg', '.json']);
/** One-click fixes the API runs itself (they move files or pack), beside the manifest edits of edit.js FIXES. */
export const API_FIXES = Object.freeze(['pack', 'moveOut']);
/** At most this many plugins in one removal (POST /studio/api/plugins/remove; the page sends more in turns) [ASSUMED]. */
export const REMOVE_MAX = 100;
/** The folder of plugins/ a removed plugin is moved into (a '_' folder: the registry never reads it). */
export const REMOVED_DIR = '_removed';

/**
 * Studio API routes (method and path). Frozen in docs/PLUGIN-API.md. Local and LAN only. HEAD answers as GET.
 * A new route literal in api() belongs in this list (test/plugins/surface.test.js).
 */
export const STUDIO_ROUTES = Object.freeze([
  'GET /studio/api/info',
  'GET /studio/api/trial-options',
  'POST /studio/api/trial',
  'POST /studio/api/console/options',
  'POST /studio/api/console/build',
  'GET /studio/api/authoring',
  'GET /studio/api/dsl-example',
  'POST /studio/api/validate-dsl',
  'POST /studio/api/plugins/:id/authoring',
  'GET /studio/api/targets',
  'GET /studio/api/slots',
  'GET /studio/api/suggest-id',
  'POST /studio/api/authors',
  'GET /studio/api/events',
  'GET /studio/api/plugins',
  'POST /studio/api/plugins',
  'POST /studio/api/plugins/remove',
  'GET /studio/api/plugins/:id',
  'GET /studio/api/plugins/:id/preview',
  'GET /studio/api/plugins/:id/zip',
  'GET /studio/api/plugins/:id/f/:hash8/*',
  'GET /studio/api/plugins/:id/files/*',
  'PUT /studio/api/plugins/:id/manifest',
  'PUT /studio/api/plugins/:id/files/*',
  'DELETE /studio/api/plugins/:id/files/*',
  'POST /studio/api/plugins/:id/slot',
  'POST /studio/api/plugins/:id/meta',
  'POST /studio/api/plugins/:id/sections',
  'POST /studio/api/plugins/:id/ref',
  'POST /studio/api/plugins/:id/clear',
  'POST /studio/api/plugins/:id/fix',
  'POST /studio/api/plugins/:id/pack',
  'POST /studio/api/catalog',
  'POST /studio/api/catalog/install',
  'POST /studio/api/forge/preview',
  'POST /studio/api/forge/import',
]);

const noopLog = { info() {}, warn() {}, error() {} };
/**
 * At most this many pages listen to the change events at once, and at most MAX_STREAMS_PER_CLIENT from one address (a new
 * one ends the oldest): a browser keeps about six connections to a server, and streams of pages it no longer shows (its
 * back / forward cache) must never take them all.
 */
const MAX_STREAMS = 16;
const MAX_STREAMS_PER_CLIENT = 3;
/**
 * The headers of a plugin's file served to the page: never a document of the server's origin — a file put in a plugin
 * folder by hand (an .html, an .svg) cannot run a script there, also when someone is led to open its URL.
 */
const FILE_HEADERS = Object.freeze({ 'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'", 'Cross-Origin-Resource-Policy': 'same-origin' });
/** A request's text field: a string (or a number) as it is, anything else as nothing. @param {unknown} v @param {number} [max] */
const text = (v, max = 200) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').slice(0, max);
/** A request's path of keys (`at`): strings and numbers, anything else as '?'. @param {unknown} v */
const keyList = (v) => (Array.isArray(v) ? v.slice(0, 16).map((k) => (typeof k === 'string' || typeof k === 'number' ? String(k) : '?')) : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Read a request body of at most `limit` bytes (413 beyond it).
 * @param {import('node:http').IncomingMessage} req @param {number} limit
 * @returns {Promise<Buffer>}
 */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > limit) { reject(new StudioError('PLUGIN_STUDIO_SIZE', 413, { max: `${Math.round(limit / 1048576)} MB` })); req.resume(); return; }
    const chunks = [];
    let n = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return; // the rest is let through unread: the answer (413) closes the connection (handle)
      n += c.length;
      if (n > limit) { over = true; chunks.length = 0; reject(new StudioError('PLUGIN_STUDIO_SIZE', 413, { max: `${Math.round(limit / 1048576)} MB` })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** A JSON request body (an object). @param {import('node:http').IncomingMessage} req @param {number} [limit] */
async function readJson(req, limit = 1024 * 1024) {
  const body = await readBody(req, limit);
  let v;
  try { v = JSON.parse(body.toString('utf8') || '{}'); } catch { throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'the body is not JSON' }); }
  if (!isObj(v)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'the body is not a JSON object' });
  return v;
}

/** The kind of a file for the page's file list. @param {string} rel */
function fileKind(rel) {
  const e = extOf(rel);
  if (PLUGIN_IMAGE_EXTS.includes(e)) return 'image';
  if (PLUGIN_AUDIO_EXTS.includes(e)) return 'audio';
  if (e === '.skel' || e === '.atlas') return 'spine';
  if (e === '.json') return 'json';
  if (e === '.md' || e === '.txt' || !e) return 'doc';
  return 'other';
}

/**
 * A free plugin id for a new plugin (see GET /studio/api/suggest-id): from the name when it has Latin letters, else from
 * the target's key (char_102_texas → texas) and the template — lower case, digits and '-', 2–32, with -2, -3 … when taken.
 * @param {{ name?: string, target?: { key: string } | null, template?: string }} what @param {Set<string>} taken (lower case)
 */
export function suggestId({ name = '', target = null, template = '' }, taken) {
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  let base = slug(name);
  if (base.length < 2 && target) {
    const k = String(target.key).replace(/^(char|enemy|token|trap|band|skchr|sktok)_(\d+_)?/, '');
    base = slug(`${k}${template ? `-${template}` : ''}`);
  }
  if (base.length < 2) base = `plugin${template ? `-${template}` : ''}`;
  base = base.replace(/^-+/, '');
  if (!/^[a-z0-9]/.test(base)) base = `p-${base}`;
  base = base.slice(0, 28).replace(/-+$/, '');
  for (let n = 1; n < 1000; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(id.toLowerCase()) && /^[a-z0-9][a-z0-9-]{1,31}$/.test(id)) return id;
  }
  return null;
}

/**
 * The studio of one server (see the header).
 * @param {{ publicDir: string, pluginsDir: string, dataDir: string,
 *   registry: ReturnType<typeof import('../plugins/registry.js').createPluginRegistry>,
 *   lobby?: { autoApplyPlugins?: Function | null, rooms?: Map<string, any> } | null, sessions?: { byToken?: (t: string) => any } | null,
 *   log?: object, mode?: 'lan' | 'local' | 'off', watch?: Function }} opts
 *   lobby: the rooms (its autoApplyPlugins is set to the studio's rule; their plugin sets tell which plugins are in use);
 *   sessions: the session registry (a token the page names → its player)
 */
export function createStudio({ publicDir, pluginsDir, dataDir, registry, lobby = null, sessions = null, log = noopLog, mode = studioMode(), watch, trialSpawn, fetch: fetchImpl = globalThis.fetch }) {
  const pageDir = path.join(path.resolve(publicDir), 'studio');
  // the key every change carries (key.js; X-SP-Studio) — read or made when first needed (the boot banner, a studio
  // request: a server that only runs tests or never shows its banner writes no key file); none when the studio is off
  /** @type {ReturnType<typeof loadStudioKey> | null | undefined} */
  let studioKey;
  const keyOf = () => {
    if (studioKey === undefined) studioKey = mode === 'off' ? null : loadStudioKey(pluginsDir, { log });
    return studioKey;
  };
  /** Does a request carry the studio's key? @param {import('node:http').IncomingMessage} req */
  const keyed = (req) => { const k = keyOf(); return !!k && sameKey(req.headers?.['x-sp-studio'], k.key); };
  /**
   * May this request change something? Not the studio's own (no X-SP-Studio, another origin: gate.js) → false, and the
   * request gets the 404 page; the header without the key → PLUGIN_STUDIO_KEY (the page asks for the key).
   * @param {import('node:http').IncomingMessage} req
   */
  const mayChange = (req) => {
    if (!isStudioChange(req)) return false;
    if (!keyed(req)) throw new StudioError('PLUGIN_STUDIO_KEY', 403, {});
    return true;
  };
  const files = createPluginFiles(pluginsDir);
  const targets = createTargetIndex(dataDir);
  const authoring = createAuthoring({ files, dataDir, publicDir });
  const trials = createTrialBench({ registry, files, spawn: trialSpawn });
  const previews = createPreviews({ vanilla: () => registry.vanillaAssets() });
  const compress = new CompressCache();
  /** @type {Map<string, number>} playerId → when the page last named the session */
  const authors = new Map();
  /** @type {Set<import('node:http').ServerResponse>} the event streams of open pages */
  const streams = new Set();
  /** @type {WeakMap<import('node:http').ServerResponse, string>} the address of each stream's page */
  const streamFrom = new WeakMap();
  const send = (ids) => {
    const data = `event: change\ndata: ${JSON.stringify({ ids })}\n\n`;
    for (const res of [...streams]) { try { res.write(data); } catch { streams.delete(res); } }
  };
  const watcher = createPluginWatcher({ pluginsDir, registry, log, onChange: (ids) => { send(ids); refreshAutoRooms(ids); }, ...(watch ? { watch } : {}) });
  const heartbeat = setInterval(() => { for (const res of [...streams]) { try { res.write(': keep-alive\n\n'); } catch { streams.delete(res); } } }, 25000);
  heartbeat.unref?.();

  /**
   * The rooms that apply a change of their plugins by themselves (server/lobby.js autoApplyPlugins): one whose host is
   * the author — a game session this machine's studio page named (POST /studio/api/authors) within AUTHOR_TTL_MS — or
   * whose only player is its host (a single-player room, or a room the host is alone in).
   * @param {{ hostId: string, humans: number }} room
   */
  function autoApply(room) {
    if (!room) return false;
    if (Number(room.humans) <= 1) return true;
    const at = authors.get(room.hostId);
    return at !== undefined && Date.now() - at < AUTHOR_TTL_MS;
  }
  /**
   * The studio in use (its first request through the gate): plugins/ is watched (hot reload) and the lobby follows the
   * studio's rule for its rooms (autoApply) — a server whose owner never opens the studio keeps P1a's behaviour exactly:
   * no watch, every host told.
   */
  let active = false;
  function activate() {
    if (active) return;
    active = true;
    watcher.start();
    if (lobby && 'autoApplyPlugins' in lobby) lobby.autoApplyPlugins = autoApply;
  }

  /**
   * The rooms the players `ids` host apply their plugins as they are on disk now (server/lobby.js refreshPlugins: a new
   * set only when the files changed) — a change their host was told about before the studio's page named the session.
   * @param {Set<string>} ids
   */
  function refreshRoomsOf(ids) {
    if (!lobby || typeof lobby.refreshPlugins !== 'function' || !(lobby.rooms instanceof Map)) return;
    for (const room of lobby.rooms.values()) {
      if (room.disposed || !room.content?.vs || !ids.has(room.hostId)) continue;
      try { lobby.refreshPlugins(room); } catch (e) { log.warn?.(`[studio] applying the plugins of ${room.code} again failed: ${e?.message || e}`); }
    }
  }

  /**
   * After a rescan: the rooms the studio's rule names (autoApply) that use a plugin whose state changed apply their
   * plugins again (server/lobby.js refreshPlugins: a new set only when the files changed). The visual sets tell a held set
   * once (onStale) — a plugin broken for a moment while its author saves it, then mended, is followed here.
   * @param {string[]} ids
   */
  function refreshAutoRooms(ids) {
    if (!active || !lobby || typeof lobby.refreshPlugins !== 'function' || !(lobby.rooms instanceof Map)) return;
    const changedIds = new Set(ids);
    for (const room of lobby.rooms.values()) {
      if (room.disposed || !room.content?.vs || !room.content.plugins?.some((p) => changedIds.has(p.id))) continue;
      let humans;
      try { humans = room.activeHumans().length; } catch { continue; }
      if (!autoApply({ hostId: room.hostId, humans })) continue;
      try { lobby.refreshPlugins(room); } catch (e) { log.warn?.(`[studio] applying the plugins of ${room.code} again failed: ${e?.message || e}`); }
    }
  }

  /** The sections a plugin's page edits: its sidecar's, else read off its overlay (a plugin made by hand). */
  function sectionsOf(id, overlay) {
    try {
      const side = JSON.parse(files.readSidecar(id, SIDECAR) ?? 'null');
      if (isObj(side) && Array.isArray(side.sections)) {
        return side.sections.filter((s) => isObj(s) && templateById(s.template) && typeof s.target === 'string').slice(0, 64).map((s) => ({ template: s.template, target: s.target }));
      }
    } catch { /* none yet */ }
    return inferSections(overlay);
  }

  /** Sections read off an overlay: for each entry it writes, the templates whose slots hold its fields. @param {any} overlay */
  function inferSections(overlay) {
    const { targets: list } = targets();
    const out = [];
    const seen = new Set();
    const add = (template, t) => { const k = `${template}|${targetSpec(t)}`; if (!seen.has(k)) { seen.add(k); out.push({ template, target: targetSpec(t) }); } };
    for (const t of list) {
      const v = getIn(overlay, [...t.container, t.key]);
      if (v === undefined) continue;
      for (const tpl of TEMPLATES) {
        if (!tpl.kinds.includes(t.kind)) continue;
        const slots = tpl.slots(t, targets().manifest);
        if (slots.some((s) => getIn(overlay, s.at) !== undefined)) add(tpl.id, t);
      }
    }
    // voices and unit sounds live under audio, keyed by the operator
    for (const [book, tpl] of [[['audio', 'voice'], 'voice'], [['audio', 'sfx', 'units'], 'audio']]) {
      for (const key of Object.keys(isObj(getIn(overlay, book)) ? getIn(overlay, book) : {})) {
        const t = list.find((x) => x.key === key && ['operator', 'token', 'enemy'].includes(x.kind));
        if (t) add(tpl, t);
      }
    }
    return out;
  }

  /** Save the sections a page edits. */
  function saveSections(id, sections) {
    const clean = (Array.isArray(sections) ? sections : []).filter((s) => isObj(s) && templateById(s.template) && targetOf(targets().targets, s.target))
      .slice(0, 64).map((s) => ({ template: s.template, target: s.target }));
    let side = {};
    try { side = JSON.parse(files.readSidecar(id, SIDECAR) || '{}'); } catch { /* first sections */ }
    files.writeSidecar(id, SIDECAR, Buffer.from(`${JSON.stringify({ ...side, v: 1, sections: clean }, null, 2)}\n`));
    return clean;
  }

  /**
   * The check of a folder that holds links: the links alone — the registry keeps such a folder out, and its own check
   * reads the files a manifest names wherever a link leads; the page gets nothing of a file outside the folder.
   * @param {string[]} links
   */
  function linkedCheck(links) {
    const list = issueList();
    for (const rel of links) list.problem('PLUGIN_FILE_LINK', `${rel}: a symbolic link (a plugin's files are plain files inside its folder)`, { file: rel });
    return { problems: list.problems, warnings: list.warnings, issues: list.issues };
  }

  /**
   * A plugin's state (GET /studio/api/plugins/<id>): manifest, its raw text, files (used by the overlay or not), sections,
   * the folder's check with coded issues, the registry's view (loaded, vs), the lock.
   * @param {string} id
   */
  function stateOf(id, includeSource = false) {
    const dir = files.root(id);
    let text = null;
    let manifest;
    // plugin.json as a plain file of the folder only (files.stat: never through a link put in its place — the page shows
    // its text), and a folder that holds links checked for them alone (linkedCheck)
    try { text = fs.readFileSync(files.stat(id, PLUGIN_MANIFEST).abs, 'utf8'); manifest = JSON.parse(text); } catch { manifest = null; }
    const vanilla = registry.vanillaAssets();
    const links = files.list(id).filter((f) => f.link).map((f) => f.rel);
    const check = links.length ? linkedCheck(links) : checkPluginFolder(dir, `plugins/${id}/`, { vanilla, dataDir });
    const read = isObj(manifest) ? readPluginManifest(manifest, { id }) : null;
    const draft = read?.manifest || read?.draft || null;
    let overlay = isObj(manifest?.assets) ? manifest.assets : {};
    if (typeof manifest?.assets === 'string' && isPackPath(manifest.assets)) {
      try { overlay = JSON.parse(fs.readFileSync(files.resolve(id, manifest.assets), 'utf8')); } catch { overlay = {}; }
    }
    const used = filesOfOverlay(overlay);
    const list = files.list(id).filter((f) => !f.link).map((f) => ({ rel: f.rel, bytes: f.bytes, kind: fileKind(f.rel), used: used.has(f.rel) || f.rel === PLUGIN_MANIFEST }));
    const entry = registry.plugin(id);
    let lock = { present: false, fresh: false };
    if (list.some((f) => f.rel === LOCK_FILE)) {
      lock = { present: true, fresh: !check.issues.some((i) => i.code === 'PLUGIN_LOCK_STALE' || i.code === 'PLUGIN_LOCK_MISSING' || i.code === 'PLUGIN_LOCK') };
      try { if (!readPluginLock(JSON.parse(fs.readFileSync(files.stat(id, LOCK_FILE).abs, 'utf8'))).lock) lock.fresh = false; } catch { lock.fresh = false; }
    }
    return {
      id, manifest, text, overlay, authoring: authoring.read(id),
      ...(includeSource && draft?.class === 'script' ? { source: authoring.source(id) } : {}),
      ...(draft?.class === 'ui' ? { frame: registry.pluginIndex().plugins.find(p => p.id === id) || null } : {}), class: draft?.class || manifest?.class || null,
      names: draft?.names || {}, version: draft?.version || null, files: list, sections: sectionsOf(id, overlay),
      check: { ok: !check.problems.length, problems: check.problems.length, warnings: check.warnings.length, issues: check.issues },
      loaded: !!(entry && entry.source === 'plugins' && entry.status === 'loaded'), vs: entry?.visual?.vs ?? entry?.ui?.vs ?? null, lock,
      bytes: list.reduce((n, f) => n + f.bytes, 0),
    };
  }

  /** Every plugin folder for the list (GET /studio/api/plugins). */
  function listPlugins() {
    const report = registry.report();
    // a plugin folder that is a symbolic link: listed by its id with the registry's word on it, never opened (files.js)
    const linked = files.links().map((id) => {
      const entry = registry.plugin(id);
      const skipped = report.skipped.find((k) => k.where === `plugins/${id}/`);
      return {
        id, name: id, version: null, class: null, linked: true, status: entry && entry.source === 'plugins' ? entry.status : 'skipped',
        problems: skipped ? skipped.problems.length : 0, warnings: 0, codes: skipped ? [...new Set((skipped.issues || []).map((i) => i.code))] : [],
      };
    });
    return [...files.ids().map((id) => {
      let name = id;
      let version = null;
      let cls = null;
      try {
        const m = JSON.parse(fs.readFileSync(files.stat(id, PLUGIN_MANIFEST).abs, 'utf8'));
        const r = readPluginManifest(m, { id });
        const d = r.manifest || r.draft;
        if (d) { name = d.name; version = d.version || null; cls = d.class; }
      } catch { /* no readable manifest: listed by its id */ }
      const entry = registry.plugin(id);
      const skipped = report.skipped.find((k) => k.where === `plugins/${id}/`);
      const loaded = !!(entry && entry.source === 'plugins');
      return {
        id, name, version, class: cls, status: loaded ? entry.status : 'skipped',
        problems: skipped ? skipped.problems.length : 0, warnings: report.warnings.filter((w) => w.where === `plugins/${id}/`).length,
        codes: skipped ? [...new Set((skipped.issues || []).map((i) => i.code))] : [],
      };
    }), ...linked].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** After a change: read the folders now (hot reload) and answer with the plugin's state. */
  const changed = (id) => { watcher.rescan(); return stateOf(id, true); };

  /**
   * The open rooms that use the plugin `id` now, each with whether its match runs. The lobby is what knows it: each room's
   * plugin set, room.content.plugins (server/lobby.js — the plugins its host switched on and the ones switched on for them,
   * 「自动」), which a running match plays (a gameplay set never changes while it runs; a cosmetic room is re-applied with
   * the same chosen plugins, refreshPlugins). A player's personal plugins live in that player's browser alone
   * (localStorage, public/js/content.js): no use the server could see, so none here.
   * @param {string} id @returns {{ code: string, match: boolean }[]}
   */
  function roomsUsing(id) {
    if (!lobby || !(lobby.rooms instanceof Map)) return [];
    const out = [];
    for (const room of lobby.rooms.values()) {
      if (room.disposed || !Array.isArray(room.content?.plugins)) continue;
      if (room.content.plugins.some((p) => p?.id === id)) out.push({ code: String(room.code), match: !!room.match });
    }
    return out;
  }

  /**
   * Remove plugins (POST /studio/api/plugins/remove, see the header): each id of `body.ids`, once and in their order, must
   * be a plugin folder right inside plugins/ — a plugin id (never a '_' template or a dot folder), a real folder under
   * exactly that name (files.root: lstat'ed, never a symbolic link; the disk's own spelling, not another case of it) —
   * that no room uses (roomsUsing); it is then moved to plugins/_removed/<id>-<time>/ (server/plugins/install.js
   * movePluginAside, the forced install's move: nothing is deleted). Any other id is refused alone with its code and
   * params. Afterwards the registry reads the folders (the watch's rescan): the page's change event names the removed ids.
   * @param {any} body
   * @returns {{ removed: { id: string, to: string }[], refused: { id: string, error: string, params: Record<string, unknown> }[] }}
   */
  function removePlugins(body) {
    const ids = body.ids;
    if (!Array.isArray(ids) || !ids.length || !ids.every((x) => typeof x === 'string')) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'ids: a list of plugin ids' });
    if (ids.length > REMOVE_MAX) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: `at most ${REMOVE_MAX} plugins at once` });
    const removed = [];
    const refused = [];
    for (const id of [...new Set(ids)]) {
      const refuse = (error, params) => { refused.push({ id: id.slice(0, 64), error, params }); };
      let dir;
      try { dir = files.root(id); } catch (e) {
        if (e instanceof StudioError) refuse(e.code, e.params);
        else if (e?.code === 'ENOENT') refuse('PLUGIN_UNKNOWN', { id }); // no plugins/ folder at all
        else refuse('PLUGIN_STUDIO_REMOVE', { id, detail: String(e?.code || 'unreadable') });
        continue;
      }
      if (path.basename(dir) !== id) { refuse('PLUGIN_UNKNOWN', { id }); continue; }
      const rooms = roomsUsing(id);
      if (rooms.length) {
        refuse('PLUGIN_STUDIO_IN_USE', { id, rooms: `${rooms.slice(0, 8).map((r) => r.code).join(', ')}${rooms.length > 8 ? ' …' : ''}`, matches: rooms.filter((r) => r.match).length });
        continue;
      }
      try {
        const to = `${REMOVED_DIR}/${path.basename(movePluginAside(path.dirname(dir), id, REMOVED_DIR))}`;
        removed.push({ id, to });
        log.info?.(`[studio] ${id}: removed — moved to plugins/${to}/`);
      } catch (e) {
        // an install error's own words, else the code only (a file system's message names the absolute path)
        refuse('PLUGIN_STUDIO_REMOVE', { id, detail: e instanceof InstallError ? e.message : String(e?.code || 'the move failed') });
      }
    }
    if (removed.length) {
      // the change event, as after any change of the studio: the rescan names what it saw go; a folder the registry had
      // not read yet is named all the same
      const told = new Set(watcher.rescan());
      const rest = removed.map((r) => r.id).filter((id) => !told.has(id));
      if (rest.length) send(rest);
    }
    return { removed, refused };
  }

  /** A slot of the plugin's sections at `at` (its dir and base), else one made from the path. */
  function slotAt(id, overlay, at) {
    const loc = locateAssetPath(at);
    if (!loc) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: `${at.join('.')} is not something a cosmetic plugin changes` });
    const { targets: list, manifest } = targets();
    for (const s of sectionsOf(id, overlay)) {
      const t = targetOf(list, s.target);
      const tpl = templateById(s.template);
      const hit = t && tpl ? tpl.slots(t, manifest).find((x) => x.at.join('\u0001') === at.join('\u0001')) : null;
      if (hit) return hit;
    }
    if (at[0] === 'chars' && at[2] === 'skins' && ['image', 'spine'].includes(loc.kind)) {
      // Full UTF-8 hex preserves distinct keys containing @ # + .; sanitizing them would collide.
      const field = at.at(-1);
      return { at, kind: loc.kind, field, dir: `skins/${keyDir(at[1])}/${Buffer.from(at[3]).toString('hex')}${loc.kind === 'spine' ? `/${field}` : ''}`, base: field };
    }
    const kind = typeof loc.kind === 'string' ? loc.kind : null;
    if (!kind) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: `${at.join('.')} is a whole record, not one place` });
    return { at, kind, field: at[at.length - 1], dir: `assets/${keyDir(loc.key)}`, base: keyDir(at[at.length - 1]) };
  }

  /** Decode the files of a slot request (base64), each within the limits. */
  function decodeFiles(list) {
    if (!Array.isArray(list) || !list.length || list.length > 24) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'no files' });
    return list.map((f) => {
      const name = text(f?.name, 400).split(/[\\/]/).pop() || '';
      const ext = extOf(name);
      if (!name || name.length > 120) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'a file without a name' });
      const data = Buffer.from(typeof f?.data === 'string' ? f.data : '', 'base64');
      if (data.length > STUDIO_LIMITS.fileBytes) throw new StudioError('PLUGIN_STUDIO_SIZE', 413, { max: `${STUDIO_LIMITS.fileBytes / 1048576} MB`, file: name });
      return { name, ext, data, role: f?.role === 'intro' ? 'intro' : f?.role === 'loop' ? 'loop' : null };
    });
  }

  /**
   * Put dropped files into a slot (POST …/slot): written into the slot's folder under its name (a model's skeleton and
   * atlas under one name, its pages by theirs), the slot set to them, the files it named before removed when nothing
   * else names them.
   */
  async function putSlot(id, body) {
    // The skins template's slots stage, check and commit the whole change (uploads add no new problem, §34.30); the
    // 0.3.0 slots (art, models, voice, audio, a bond's icon) write directly as before, their check shown afterwards.
    if (body.at?.[0] === 'chars' && body.at?.[2] === 'skins') await editMediaDraft(files, id, staged => writeSlot(id, body, staged), { dataDir });
    else writeSlot(id, body, files);
    return changed(id);
  }

  function writeSlot(id, body, files) {
    const at = body.at;
    if (!Array.isArray(at) || !at.every((k) => typeof k === 'string')) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'no slot' });
    const p = openPlugin(files, id);
    const slot = { ...slotAt(id, p.overlay, at) };
    const got = decodeFiles(body.files);
    const kindName = { image: '.png / .jpg / .webp', audio: '.mp3 / .ogg', audioList: '.mp3 / .ogg', track: '.mp3 / .ogg', spine: '.skel + .atlas + .png' }[slot.kind];
    const expect = (ok, f) => { if (!ok) throw new StudioError('PLUGIN_STUDIO_FILE_KIND', 400, { kind: kindName, ext: f.ext || f.name }, `${f.name}: not ${kindName}`); };
    const before = filesOfValue(getIn(p.overlay, at));
    // A rename may leave the old key's media referenced by another skin. Copy on write, also for partial Spine uploads.
    if (at[0] === 'chars' && at[2] === 'skins') {
      const others = structuredClone(p.overlay); deleteIn(others, at);
      const used = filesOfOverlay(others), current = getIn(p.overlay, at);
      if ([...used].some(rel => rel.startsWith(`${slot.dir}/`)) || [...before].some(rel => used.has(rel))) {
        const base = slot.dir, existing = files.list(id).map(f => f.rel);
        // [ASSUMED] A numeric suffix isolates the complete model directory, including its atlas page names.
        for (let n = 1; n <= existing.length + used.size + 1; n++) {
          const dir = `${base}-${n}`;
          if (![...existing, ...used].some(rel => rel.startsWith(`${dir}/`))) { slot.dir = dir; break; }
        }
        if (slot.kind === 'spine' && current?.skel) {
          const relocated = { skel: `${slot.dir}/${slot.base}.skel`, atlas: `${slot.dir}/${slot.base}.atlas`,
            textures: current.textures.map(rel => `${slot.dir}/${path.basename(rel)}`) };
          for (const [old, rel] of [[current.skel, relocated.skel], [current.atlas, relocated.atlas], ...current.textures.map((rel, i) => [rel, relocated.textures[i]])])
            files.write(id, rel, fs.readFileSync(files.stat(id, old).abs));
          setSlot(p, at, relocated);
        }
      }
    }
    const written = [];
    const put = (rel, data) => { files.write(id, rel, data); written.push(rel); return rel; };
    let value;
    if (slot.kind === 'image' || slot.kind === 'audio') {
      const exts = slot.kind === 'image' ? PLUGIN_IMAGE_EXTS : PLUGIN_AUDIO_EXTS;
      if (got.length !== 1) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'one file for this place' });
      expect(exts.includes(got[0].ext), got[0]);
      value = put(`${slot.dir}/${slot.base}${got[0].ext}`, got[0].data);
    } else if (slot.kind === 'audioList') {
      for (const f of got) expect(PLUGIN_AUDIO_EXTS.includes(f.ext), f);
      const prev = body.mode === 'append' ? (Array.isArray(getIn(p.overlay, at)) ? getIn(p.overlay, at) : typeof getIn(p.overlay, at) === 'string' ? [getIn(p.overlay, at)] : []) : [];
      const start = prev.length;
      if (start + got.length > 16) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'at most 16 files in one line' });
      const rels = got.map((f, i) => put(`${slot.dir}/${slot.base}${start + i === 0 && got.length === 1 && !start ? '' : `_${start + i + 1}`}${f.ext}`, f.data));
      const all = [...prev, ...rels];
      value = all.length === 1 ? all[0] : all;
    } else if (slot.kind === 'track') {
      for (const f of got) expect(PLUGIN_AUDIO_EXTS.includes(f.ext), f);
      // the part not sent stays: an intro added to the track's loop, a new loop keeping its intro
      const cur = getIn(p.overlay, at);
      const track = isObj(cur) && typeof cur.loop === 'string' ? cur : null;
      if (got.length > 2) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'a track is a loop and an optional intro' });
      let intro = got.find((f) => f.role === 'intro');
      // two files dropped at once without roles: the one named intro (or 前奏) is the intro — never one silently dropped
      if (got.length === 2 && !intro && !got.some((f) => f.role === 'loop')) {
        const named = got.filter((f) => /intro|前奏/i.test(f.name));
        if (named.length !== 1) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'two files for a track: name the intro "intro…" (or put it with 放入前奏)' });
        intro = named[0];
      }
      const loop = got.find((f) => f.role === 'loop') || got.find((f) => f !== intro);
      if (!loop && !track) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'put the loop of the track first, then its intro' });
      const introRel = intro ? put(`${slot.dir}/intro${intro.ext}`, intro.data) : typeof track?.intro === 'string' ? track.intro : null;
      value = { loop: loop ? put(`${slot.dir}/loop${loop.ext}`, loop.data) : track.loop, ...(introRel ? { intro: introRel } : {}) };
    } else if (slot.kind === 'spine') {
      const skel = got.filter((f) => f.ext === '.skel');
      const atlas = got.filter((f) => f.ext === '.atlas');
      const pages = got.filter((f) => PLUGIN_IMAGE_EXTS.includes(f.ext));
      for (const f of got) expect(f.ext === '.skel' || f.ext === '.atlas' || PLUGIN_IMAGE_EXTS.includes(f.ext), f);
      const now = getIn(p.overlay, at);
      const cur = isObj(now) && typeof now.skel === 'string' ? now : null;
      if (skel.length > 1 || atlas.length > 1) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'one model at a time: one .skel and one .atlas' });
      if (!skel.length && !cur) throw new StudioError('PLUGIN_STUDIO_FILE_KIND', 400, { kind: kindName, ext: got.map((f) => f.ext).join(' ') });
      // a new skeleton goes under the slot's own name: it comes with its atlas, unless the model there already is (its
      // atlas and pages stay) — a lone .skel never leaves a model without its atlas
      const own = `${slot.dir}/${slot.base}.skel`;
      if (skel.length && !atlas.length && cur?.skel !== own) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'a new .skel comes with its .atlas (and the .png pages the atlas names)' });
      const skelRel = skel.length ? own : cur.skel;
      const atlasRel = skelRel.replace(/\.skel$/, '.atlas');
      const folder = skelRel.replace(/[^/]*$/, '');
      // the atlas finds its pages next to it by the names it gives: plain names, each page written under its own
      let named = [];
      if (atlas.length) { try { named = atlasInfo(atlas[0].data.toString('utf8')).pages; } catch { named = []; } }
      for (const n of [...named, ...pages.map((f) => f.name)]) {
        if (n.includes('/') || !isPackPath(`${folder}${n}`)) throw new StudioError('PLUGIN_FILE_NAME', 400, { where: String(n).slice(0, 80) });
      }
      if (skel.length) put(skelRel, skel[0].data);
      if (atlas.length) put(atlasRel, atlas[0].data);
      for (const f of pages) put(`${folder}${f.name}`, f.data);
      let textures;
      try { textures = atlasPages(files, id, atlasRel); } catch { textures = cur?.textures?.length ? cur.textures : pages.map((f) => `${folder}${f.name}`); }
      value = { skel: skelRel, atlas: atlasRel, textures };
    } else throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: `${slot.kind} is not a place for files` });
    setSlot(p, at, value);
    p.save();
    // files the slot named before and nothing names now (another file type replaced them)
    const still = filesOfOverlay(p.overlay);
    for (const rel of before) if (!still.has(rel) && !written.includes(rel)) { try { files.remove(id, rel); } catch { /* gone or not a file */ } }
  }

  /** Run a one-click fix (POST …/fix). */
  function fix(id, body) {
    const code = text(body.code, 64);
    const name = isPluginErrorCode(code) ? PLUGIN_ERRORS[code].autofix : null;
    if (!name) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: `${code.slice(0, 40)} has no one-click fix` });
    const issue = { at: Array.isArray(body.at) ? keyList(body.at) : undefined, file: typeof body.file === 'string' ? body.file : undefined, params: isObj(body.params) ? body.params : {} };
    let did;
    if (name === 'pack') {
      const r = packPlugin(files.root(id), { vanilla: registry.vanillaAssets(), dataDir });
      did = r.wrote ? 'packed' : 'not packed';
    } else if (name === 'moveOut') {
      if (!issue.file || !isPackPath(issue.file)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'no file' });
      const flagged = checkPluginFolder(files.root(id), `plugins/${id}/`, { vanilla: registry.vanillaAssets(), dataDir }).issues.some((i) => i.code === 'PLUGIN_FILE_TYPE' && i.file === issue.file);
      if (!flagged) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: `${issue.file.slice(0, 80)} is a file the plugin may carry` });
      did = `moved to plugins/${files.moveOut(id, issue.file)}`;
    } else {
      const p = openPlugin(files, id);
      did = FIXES[name](p, issue, { files, id });
      p.save();
    }
    log.info?.(`[studio] ${id}: fix ${code} — ${did}`);
    return { ...changed(id), fixed: { code, did } };
  }

  /** Serve a file of the page (public/studio/). */
  async function servePage(req, res, rel, query) {
    const segments = rel.split('/').filter(Boolean);
    if (!segments.length) segments.push('index.html');
    if (segments.some((s) => s === '..' || s === '.' || s.startsWith('.')) || !PAGE_TYPES.has(path.extname(segments[segments.length - 1]).toLowerCase())) return false;
    const abs = path.join(pageDir, ...segments);
    if (!abs.startsWith(pageDir + path.sep)) return false;
    const st = await fsp.stat(abs).catch(() => null);
    if (!st || !st.isFile()) return false;
    await serveFile(req, res, abs, st, 'studio', segments, query, compress, log, { cacheControl: 'no-cache' });
    return true;
  }

  /**
   * Serve a file of a plugin folder (a draft's too) to the page: only the file types the studio writes (art, models,
   * audio, fonts, JSON, documents — never a page or a script put there by hand), sandboxed (FILE_HEADERS).
   */
  async function servePluginFile(req, res, id, rel, query) {
    const { abs, st } = files.stat(id, rel);
    if (!WRITABLE.includes(extOf(rel)) || (!MIME[path.extname(abs).toLowerCase()] && extOf(rel) !== '.skel')) throw new StudioError('PLUGIN_STUDIO_PATH', 404, { detail: rel });
    for (const [k, v] of Object.entries(FILE_HEADERS)) res.setHeader(k, v);
    await serveFile(req, res, abs, st, 'studio', rel.split('/'), query, compress, log, { cacheControl: 'no-cache' });
  }

  /** An InstallError as the studio's error shape. @param {unknown} e */
  function asStudio(e) {
    if (e instanceof InstallError) throw new StudioError(e.code, e.status, { ...e.params, detail: e.message }, e.message);
    throw e;
  }

  /**
   * POST /studio/api/catalog — a community list. The zip is not downloaded here. An https URL is fetched by this
   * process; `{ text }` or `{ catalog }` is the owner's local file (the browser read it). No filesystem path is accepted.
   */
  async function catalogList(req) {
    try {
      const body = await readJson(req, CATALOG_FETCH_MAX_BYTES);
      let text;
      if (typeof body.text === 'string') {
        if (Buffer.byteLength(body.text) > CATALOG_FETCH_MAX_BYTES) throw new InstallError('PLUGIN_CATALOG_SIZE', 'the catalogue is over 1 MB', {});
        text = body.text;
      } else if (isObj(body.catalog)) text = JSON.stringify(body.catalog);
      else if (typeof body.url === 'string' && body.url) {
        const buf = await fetchHttps(body.url, { fetch: fetchImpl, maxBytes: CATALOG_FETCH_MAX_BYTES, timeoutMs: CATALOG_FETCH_TIMEOUT_MS, kind: 'catalog', pluginsDir });
        text = buf.toString('utf8');
      } else throw new InstallError('PLUGIN_CATALOG_SHAPE', 'send a catalogue url or the catalogue text', {});
      let json;
      try { json = JSON.parse(text); } catch {
        throw new InstallError('PLUGIN_CATALOG_SHAPE', 'the catalogue is not JSON', {});
      }
      const read = readCatalog(json);
      if (!read.ok || !read.catalog) {
        const p = read.problems[0] || read.warnings[0] || { code: 'PLUGIN_CATALOG_SHAPE', detail: 'the catalogue was refused' };
        throw new InstallError(p.code, p.detail, {});
      }
      const plugins = annotateCatalog(read.catalog, (id) => installedPluginVersion(pluginsDir, id));
      return { name: read.catalog.name, catalog: read.catalog.catalog, plugins };
    } catch (e) { asStudio(e); }
  }

  /**
   * POST /studio/api/catalog/install — the server downloads the https zip, checks sha256, and installs it.
   * The browser does not upload the zip. `id`, when sent, must be the id inside the zip.
   */
  async function catalogInstall(req) {
    try {
      const body = await readJson(req, 64 * 1024);
      const url = typeof body.url === 'string' ? body.url : '';
      const sha256 = typeof body.sha256 === 'string' ? body.sha256 : '';
      const expectedId = typeof body.id === 'string' ? body.id : '';
      const expectedBytes = Number.isInteger(body.bytes) ? body.bytes : undefined;
      const installed = await installFromUrl(url, {
        pluginsDir, sha256, force: body.force === true, expectedId, expectedBytes, fetch: fetchImpl,
      });
      watcher.rescan();
      let plugin = null;
      try { plugin = stateOf(installed.id); } catch { plugin = null; }
      return { id: installed.id, replaced: installed.replaced ? path.basename(installed.replaced) : null, plugin };
    } catch (e) { asStudio(e); }
  }

  /** The API (see the header). @returns {Promise<boolean>} whether it answered */
  async function api(req, res, route, query) {
    const q = new URLSearchParams(query);
    const method = req.method;
    /** A read (HEAD answers as GET does, without the body). */
    const read = method === 'GET' || method === 'HEAD';
    const json = (status, obj) => { sendJson(req, res, status, obj); return true; };
    if (route === 'info' && read) {
      return json(200, {
        // key: whether this request carried the studio's key ('ok'), another value ('wrong') or none ('missing')
        key: keyed(req) ? 'ok' : req.headers['x-sp-studio'] ? 'wrong' : 'missing',
        app: APP_VERSION, api: PLUGIN_API, mode, watching: watcher.active, limits: { ...STUDIO_LIMITS, pluginBytes: PLUGIN_LIMITS.pluginBytes, trial: TRIAL_LIMITS, removeMax: REMOVE_MAX },
        templates: TEMPLATES.map((t) => ({ id: t.id, class: t.class, kinds: t.kinds })), kinds: Object.keys(TARGET_KINDS),
      });
    }
    if ((route === 'console/options' || route === 'console/build') && method === 'POST') {
      if (!mayChange(req)) return false;
      const body = await readJson(req, SCENARIO_BYTES);
      const data = readStudioData(dataDir);
      return json(200, route === 'console/options' ? consoleOptions(data) : buildConsoleScenario(body, data));
    }
    if (route === 'trial-options' && read) return json(200, trialOptions(dataDir));
    if (route === 'trial' && method === 'POST') {
      if (!mayChange(req)) return false;
      const abort = new AbortController();
      // IncomingMessage closes normally once the body has been read. Only an incomplete body is a disconnect;
      // the response close covers a client that leaves while a fully-read trial is running.
      const requestClosed = () => { if (req.complete === false) abort.abort(); };
      const responseClosed = () => { if (!res.writableEnded) abort.abort(); };
      req.on('close', requestClosed);
      res.on?.('close', responseClosed);
      try {
        const body = await readJson(req, STUDIO_LIMITS.bodyBytes);
        if (req.aborted || res.destroyed) abort.abort();
        return json(200, await trials.run(body, { signal: abort.signal }));
      } finally {
        req.off('close', requestClosed);
        res.off?.('close', responseClosed);
      }
    }
    if (route === 'authoring' && read) return json(200, authoring.details(q.get('template'), q.get('target')));
    if (route === 'dsl-example' && read) return json(200, authoring.example(q.get('name'), q.get('id') || 'draft-plugin'));
    if (route === 'validate-dsl' && method === 'POST') {
      if (!mayChange(req)) return false;
      const body = await readJson(req, STUDIO_LIMITS.bodyBytes);
      return json(200, body.draft ? await authoring.validateDraftAsync(body.draft) : authoring.validate(body.spec));
    }
    if (route === 'targets' && read) {
      const kinds = (q.get('kinds') || '').split(',').filter((k) => Object.hasOwn(TARGET_KINDS, k));
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 40));
      return json(200, { targets: searchTargets(targets().targets, q.get('q') || '', { kinds: kinds.length ? kinds : null, limit }) });
    }
    if (route === 'slots' && read) {
      const tpl = templateById(q.get('template'));
      if (!tpl) throw new StudioError('PLUGIN_STUDIO_TEMPLATE', 404, { template: text(q.get('template'), 40) });
      const t = targetOf(targets().targets, q.get('target') || '');
      if (!t) throw new StudioError('PLUGIN_STUDIO_TARGET', 404, { target: text(q.get('target'), 80) });
      return json(200, { template: tpl.id, target: t, slots: tpl.kinds.includes(t.kind) ? tpl.slots(t, targets().manifest) : [] });
    }
    if (route === 'suggest-id' && read) {
      const t = q.get('target') ? targetOf(targets().targets, q.get('target')) : null;
      const taken = new Set(files.ids().map((x) => x.toLowerCase()));
      try { for (const n of fs.readdirSync(files.base)) taken.add(n.toLowerCase()); } catch { /* no plugins/ yet */ }
      return json(200, { id: suggestId({ name: q.get('name') || '', target: t, template: q.get('template') || '' }, taken) });
    }
    if (route === 'authors' && method === 'POST') {
      if (!mayChange(req)) return false;
      const body = await readJson(req, 16 * 1024);
      const ids = [];
      for (const tok of (Array.isArray(body.tokens) ? body.tokens : []).slice(0, 8)) {
        const s = typeof tok === 'string' && tok.length <= 64 ? sessions?.byToken?.(tok) : null;
        if (s?.playerId) { authors.set(s.playerId, Date.now()); ids.push(s.playerId); }
      }
      for (const [pid, at] of authors) if (Date.now() - at > AUTHOR_TTL_MS) authors.delete(pid);
      // a room such a player hosts applies its plugins as they are now (a change it was told about meanwhile)
      if (ids.length) refreshRoomsOf(new Set(ids));
      return json(200, { players: ids.length });
    }
    if (route === 'events' && read) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      if (method === 'HEAD') { res.end(); return true; }
      res.write(`event: hello\ndata: ${JSON.stringify({ watching: watcher.active })}\n\n`);
      // a bounded number of listeners, in all and from one address: the oldest goes (its page reconnects when it is shown)
      const from = String(req.socket?.remoteAddress || '');
      const drop = (old) => { streams.delete(old); try { old.end(); } catch { /* gone */ } };
      for (let mine = [...streams].filter((x) => streamFrom.get(x) === from); mine.length >= MAX_STREAMS_PER_CLIENT; mine = mine.slice(1)) drop(mine[0]);
      while (streams.size >= MAX_STREAMS) drop(streams.values().next().value);
      streams.add(res);
      streamFrom.set(res, from);
      req.on('close', () => streams.delete(res));
      return true;
    }
    if ((route === 'catalog' || route === 'catalog/install') && method === 'POST') {
      if (!mayChange(req)) return false;
      const body = route === 'catalog' ? await catalogList(req) : await catalogInstall(req);
      return json(route === 'catalog' ? 200 : 201, body);
    }
    if (route === 'plugins' && read) return json(200, { plugins: listPlugins() });
    if (route === 'plugins' && method === 'POST') {
      if (!mayChange(req)) return false;
      const body = await readJson(req, 64 * 1024);
      const tpl = templateById(body.template);
      if (!tpl) throw new StudioError('PLUGIN_STUDIO_TEMPLATE', 404, { template: text(body.template, 40) });
      const id = text(body.id, 64);
      if (!isPluginId(id)) throw new StudioError('PLUGIN_ID', 400, { id: id.slice(0, 40) });
      const t = body.target ? targetOf(targets().targets, text(body.target, 200)) : null;
      if (body.target && !t) throw new StudioError('PLUGIN_STUDIO_TARGET', 404, { target: text(body.target, 80) });
      if (t && !tpl.kinds.includes(t.kind)) throw new StudioError('PLUGIN_STUDIO_TARGET', 400, { target: targetSpec(t) });
      const made = createPlugin(tpl, { id, name: body.name, target: t, authors: body.authors, license: body.license, credits: body.credits, options: body.options || {}, data: tpl.build && tpl.class !== 'cosmetic' ? readStudioData(dataDir) : null, publicDir, lang: body.lang === 'en' ? 'en' : 'zh' });
      if (['bond', 'item', 'trait', 'offers', 'rules', 'theme', 'notices', 'fx', 'skins'].includes(tpl.id)) authoring.generate(id, { template: tpl.id, target: body.target, options: body.options || {} }, made.manifest);
      files.root(id, { create: true });
      files.write(id, PLUGIN_MANIFEST, Buffer.from(manifestText(made.manifest)));
      for (const [rel, text] of Object.entries(made.files)) files.write(id, rel, Buffer.from(text), { generated: true });
      if (made.authoring) files.writeSidecar(id, SIDECAR, Buffer.from(manifestText({ v: 1, authoring: made.authoring })));
      else if (t) saveSections(id, [{ template: tpl.id, target: targetSpec(t) }]);
      log.info?.(`[studio] new plugin ${id} (${tpl.id}${t ? `, ${targetSpec(t)}` : ''})`);
      return json(201, changed(id));
    }
    // (before the plugin id routes: POST plugins/<id> itself is none, so a plugin named "remove" keeps all of its own)
    if (route === 'plugins/remove' && method === 'POST') {
      if (!mayChange(req)) return false;
      return json(200, removePlugins(await readJson(req, 16 * 1024)));
    }
    if ((route === 'forge/preview' || route === 'forge/import') && method === 'POST') {
      if (!mayChange(req)) return false;
      const body = await readJson(req, STUDIO_LIMITS.bodyBytes);
      const result = await importForge(forgeUpload(body), {
        id: typeof body.id === 'string' && body.id ? body.id.slice(0, 64) : undefined,
        dryRun: route === 'forge/preview', pluginsDir, dataDir, root: path.dirname(path.resolve(publicDir)),
        vanilla: registry.vanillaAssets(), scripts: body.noScripts !== true,
        officialTables: { offline: body.offline === true, fetchImpl, log: line => log.info?.(line) },
      });
      const safety = result.issues.find((i) => FORGE_SAFETY.has(i.code));
      if (safety) throw new StudioError(safety.code, 400, { detail: safety.detail }, safety.detail);
      if (route === 'forge/import' && result.wrote) watcher.rescan();
      const products = Array.isArray(result.report?.products) ? result.report.products : [];
      return json(200, { report: result.report, plugins: products.map((p) => ({ id: p.id, class: p.class })) });
    }
    const m = /^plugins\/([^/]+)(?:\/(.*))?$/.exec(route);
    if (!m) return false;
    const id = decodeURIComponent(m[1]);
    const sub = m[2] ?? '';
    if (!isPluginId(id)) throw new StudioError('PLUGIN_ID', 400, { id: id.slice(0, 40) });
    if (method === 'GET' || method === 'HEAD') {
      if (sub === '') return json(200, stateOf(id, keyed(req)));
      if (sub === 'preview') return json(200, previews.preview(id, files.root(id)));
      if (sub === 'zip') {
        if (method === 'HEAD') { files.root(id); res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' }); res.end(); return true; }
        let z;
        try { z = zipPlugin(files.root(id)); } catch (e) {
          if (e?.code === 'PLUGIN_FILE_SIZE') throw new StudioError('PLUGIN_FILE_SIZE', 413, { where: e.where || '' }, e.message);
          throw e;
        }
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': z.body.length, 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${z.name}"` });
        res.end(method === 'HEAD' ? undefined : z.body);
        return true;
      }
      const f = /^(?:f\/[0-9a-f]{8}|files)\/(.+)$/.exec(sub);
      if (f) { await servePluginFile(req, res, id, f[1].split('/').map(decodeURIComponent).join('/'), query); return true; }
      return false;
    }
    if (!mayChange(req)) return false;
    if (method === 'PUT' && sub === 'manifest') {
      const body = await readBody(req, STUDIO_LIMITS.manifestBytes);
      let v;
      try { v = JSON.parse(body.toString('utf8')); } catch (e) { throw new StudioError('PLUGIN_JSON', 400, { file: PLUGIN_MANIFEST, detail: String(e?.message || e) }); }
      if (!isObj(v)) throw new StudioError('PLUGIN_MANIFEST_SHAPE', 400, {});
      files.root(id);
      files.write(id, PLUGIN_MANIFEST, Buffer.from(manifestText(v)));
      return json(200, changed(id));
    }
    const fileRoute = /^files\/(.+)$/.exec(sub);
    if (fileRoute && (method === 'PUT' || method === 'DELETE')) {
      const rel = fileRoute[1].split('/').map(decodeURIComponent).join('/');
      if (method === 'DELETE') files.remove(id, rel);
      else {
        const bytes = await readBody(req, STUDIO_LIMITS.fileBytes);
        // Resolve paths/links before looking at bytes; the candidate refuses links elsewhere too.
        files.resolve(id, rel, { forWrite: true });
        await editMediaDraft(files, id, staged => staged.write(id, rel, bytes), { dataDir });
      }
      return json(200, changed(id));
    }
    if (method !== 'POST') return false;
    if (sub === 'slot') return json(200, await putSlot(id, await readJson(req, STUDIO_LIMITS.bodyBytes)));
    const body = await readJson(req, sub === 'authoring' ? STUDIO_LIMITS.bodyBytes : 256 * 1024);
    if (sub === 'authoring') { await authoring.saveAsync(id, body); return json(200, changed(id)); }
    if (sub === 'meta') { const p = openPlugin(files, id); editMeta(p, body.fields, typeof body.lang === 'string' ? body.lang : 'zh'); p.save(); return json(200, changed(id)); }
    if (sub === 'sections') { files.root(id); saveSections(id, body.sections); return json(200, stateOf(id)); }
    if (sub === 'ref') {
      const key = text(body.ref, 200);
      const at = keyList(body.at);
      const p = openPlugin(files, id);
      const before = filesOfValue(getIn(p.overlay, at));
      setSlot(p, at, { ref: key });
      p.save();
      // the files the slot named before go when nothing names them now (as clear and a new file do)
      const still = filesOfOverlay(p.overlay);
      for (const rel of before) if (!still.has(rel)) { try { files.remove(id, rel); } catch { /* gone */ } }
      return json(200, changed(id));
    }
    if (sub === 'clear') {
      const at = keyList(body.at);
      const p = openPlugin(files, id);
      const before = filesOfValue(getIn(p.overlay, at));
      clearSlot(p, at);
      p.save();
      const still = filesOfOverlay(p.overlay);
      for (const rel of before) if (!still.has(rel)) { try { files.remove(id, rel); } catch { /* gone */ } }
      return json(200, changed(id));
    }
    if (sub === 'fix') return json(200, fix(id, body));
    if (sub === 'pack') {
      const r = packPlugin(files.root(id), { vanilla: registry.vanillaAssets(), dataDir });
      const list = issueList();
      list.take(r.build);
      log.info?.(`[studio] ${id}: pack — ${r.wrote ? 'plugin.lock.json written' : 'not written'}`);
      return json(200, { ...changed(id), pack: { wrote: r.wrote, issues: list.issues } });
    }
    return false;
  }

  /**
   * Answer a request whose path is the studio's (handles): the gate, then the page or the API. A request the gate refuses,
   * or one nothing here answers, gets the 404 page.
   * @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res
   * @param {string} rawPath @param {string} query
   */
  async function handle(req, res, rawPath, query) {
    const notFound = () => sendError(req, res, 404, '页面不存在 · Not found', rawPath.length <= 200 ? rawPath : ''); // i18n-ignore (the bilingual 404 page of server/http/common.js)
    const gate = studioAllowed(req, { mode });
    if (!gate.ok) { notFound(); return; }
    // only the exact spelling (another case, doubled slashes or percent-encoding of the prefix: a 404, see isStudioPath)
    if (rawPath !== '/studio' && !rawPath.startsWith(STUDIO_URL)) { notFound(); return; }
    // the studio in use: a request with its key (the page's, an author's tools) — never a mere visit or a page of another
    // site, which cannot send the header (activate)
    if (keyed(req)) activate();
    // never inside a frame of another page (its buttons change files)
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    if (rawPath === '/studio') { res.writeHead(301, { Location: `/studio/${query ? `?${query}` : ''}`, 'Cache-Control': 'no-cache', 'Content-Length': 0 }); res.end(); return; }
    try {
      if (rawPath.startsWith(STUDIO_API)) {
        let route;
        try { route = rawPath.slice(STUDIO_API.length); decodeURIComponent(route); } catch { notFound(); return; }
        if (!(await api(req, res, route, query))) notFound();
        return;
      }
      let rel;
      try { rel = decodeURIComponent(rawPath.slice(STUDIO_URL.length)); } catch { notFound(); return; }
      if ((req.method === 'GET' || req.method === 'HEAD') && (await servePage(req, res, rel, query))) return;
      notFound();
    } catch (e) {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof StudioError) {
        // a body over the limit is not read: the connection closes after the answer (its rest never reaches a next request)
        if (e.status === 413) res.setHeader('Connection', 'close');
        sendJson(req, res, e.status, { error: e.code, params: e.params, detail: e.message });
        return;
      }
      if (e?.code === 'ENOSPC' || e?.code === 'EACCES' || e?.code === 'EPERM' || e?.code === 'EROFS') {
        // the code only: a file system's message names the absolute path (the account's name in it) — that stays in the log
        log.warn?.(`[studio] ${req.method} ${rawPath.slice(0, 120)}: ${e.message}`);
        sendJson(req, res, 500, { error: 'PLUGIN_UNREADABLE', params: { detail: e.code }, detail: e.code });
        return;
      }
      log.error?.('[studio] request failed', e);
      sendJson(req, res, 500, { error: 'PLUGIN_STUDIO_REQUEST', params: { detail: 'internal error' }, detail: 'internal error' });
    }
  }

  return {
    /** Is this path the studio's (any spelling: isStudioPath)? @param {string} rawPath */
    handles: isStudioPath,
    handle,
    autoApply,
    watcher,
    activate,
    /** Whether the studio has been used (activate). */
    get active() { return active; },
    /** The studio's key (key.js): what a change carries; null when the studio is off. */
    get key() { return keyOf()?.key ?? null; },
    /** The address of the studio's page with its key, on the server at `base` (http://localhost:3000): the boot banner's. @param {string} base */
    pageUrl: (base) => { const k = keyOf(); return k ? `${String(base).replace(/\/+$/, '')}${STUDIO_URL}#key=${k.key}` : null; },
    /** Stop watching and close the event streams. */
    close() {
      active = false;
      watcher.stop();
      trials.close();
      clearInterval(heartbeat);
      for (const res of streams) { try { res.end(); } catch { /* gone */ } }
      streams.clear();
      if (lobby && lobby.autoApplyPlugins === autoApply) lobby.autoApplyPlugins = null;
    },
  };
}
