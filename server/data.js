// server/data.js — loads the generated game data (data/*.json, produced by tools/build-data.mjs) once.
//
// Every `*.json` file in the data directory becomes a top-level key named after its basename
// (config, chess, bonds, garrisons, items, bands, effects, choices, enemies, factions, waves, stages,
// bosses, tokens, assets, backups, …). The result is deep-frozen so no module can mutate shared data by accident.
// Missing or unparsable files are tolerated with a warning (data is generated in parallel with the
// server); consumers must cope with an absent key.
//
// Index getters (DESIGN §2; same names as public/js/data.js): getChess, getBond, getGarrison, getItem, getBand,
// getEffect, getEnemy, getWave, getStage, getBoss, getToken, getConfig, getMode. The id-keyed files are already
// `{ [id]: record }` maps (docs/DATA.md), so a getter is an OWN-property lookup: ids that come from client
// intents (e.g. `g.band {bandId: "constructor"}`) can never resolve to inherited Object.prototype members.
// Every getter returns null for unknown ids / missing files and takes an optional data object (default:
// the process-wide getData() singleton).
//
// Official versions (shared/versions.js; docs/DATA.md "Official versions (M0)"): the default version is data/*.json, read by
// getData(); another version's data lies in data/versions/<slug>/ (tools/build-data.mjs --version) and loads on demand
// with getVersionData(id). loadData(DATA_DIR) reads the top level only, so it never sees data/versions/. Nothing in the
// game reads a non-default version yet (M0).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgetOfficialBounds, rememberOfficialBounds } from '../shared/plugins/officialBounds.js';
import { DEFAULT_VERSION, versionById } from '../shared/versions.js';

/** Repository root (…/Stronghold-Protocol). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Default data directory. */
export const DATA_DIR = path.join(ROOT, 'data');

/** Files the game expects (a warning lists the missing ones). */
export const DATA_FILES = Object.freeze([
  'config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices',
  'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'assets', 'backups',
]);

/**
 * Recursively freeze an object graph (iterative; safe for deep JSON). Returns the same object.
 * @template T
 * @param {T} root
 * @returns {Readonly<T>}
 */
export function deepFreeze(root) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const o = stack.pop();
    if (o === null || typeof o !== 'object' || seen.has(o)) continue;
    seen.add(o);
    for (const v of Object.values(o)) if (v !== null && typeof v === 'object') stack.push(v);
    Object.freeze(o);
  }
  return root;
}

/** data/*.json files the server never reads, so never loads: the official effects' file list (data/local-fx.json, written
 * by tools/local-extract/fx.py, DESIGN §33 — ~1 MB the browser alone fetches, through its served view). */
export const UNLOADED_DATA = Object.freeze(['local-fx.json']);

/**
 * Read every `*.json` in `dir` into `{ [basename]: parsed }`, deep-frozen (but UNLOADED_DATA).
 * Never throws: an unreadable directory yields `{}`; bad files are skipped with an error log.
 * @param {string} [dir] data directory (default ROOT/data)
 * @param {{ log?: { warn: Function, error: Function, info?: Function }, expected?: readonly string[] }} [opts]
 * @returns {Readonly<Record<string, any>>}
 */
export function loadData(dir = DATA_DIR, { log = console, expected = DATA_FILES } = {}) {
  /** @type {Record<string, any>} */
  const out = {};
  let names = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.json') && !UNLOADED_DATA.includes(d.name.toLowerCase()))
      .map((d) => d.name)
      .sort();
  } catch (e) {
    log.warn(`[data] cannot read ${dir}: ${e.code || e.message} — running without game data`);
  }
  for (const file of names) {
    const key = file.slice(0, -'.json'.length);
    try {
      out[key] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      log.error(`[data] skipping ${file}: ${e.message}`);
    }
  }
  const missing = expected.filter((k) => !(k in out));
  if (missing.length) log.warn(`[data] missing data files: ${missing.map((k) => k + '.json').join(', ')}`);
  return deepFreeze(out);
}

/** @type {Readonly<Record<string, any>> | null} */
let singleton = null;

/**
 * Process-wide data singleton; loads on first call (later calls ignore the options).
 * @param {{ dir?: string, log?: object }} [opts]
 * @returns {Readonly<Record<string, any>>}
 */
export function getData({ dir = DATA_DIR, log = console } = {}) {
  if (!singleton) {
    singleton = loadData(dir, { log });
    rememberOfficialBounds(singleton);
  }
  return singleton;
}

/** Drop the singleton so the next getData() reloads (tests / hot reload). */
export function resetData() {
  singleton = null;
  forgetOfficialBounds();
}

/** The files a non-default version's directory holds: DATA_FILES but the art manifest, which stays top-level only. */
export const VERSION_DATA_FILES = Object.freeze(DATA_FILES.filter((f) => f !== 'assets'));

/**
 * The data directory of an official version: `root` itself for the default, root/<entry.dir> for another, null for an
 * unknown id.
 * @param {string} [id] a shared/versions.js id
 * @param {string} [root] the default data directory
 * @returns {string | null}
 */
export function versionDataDir(id = DEFAULT_VERSION, root = DATA_DIR) {
  const entry = versionById(id);
  if (!entry) return null;
  return entry.dir ? path.join(root, ...entry.dir.split('/').filter(Boolean)) : root;
}

/** @type {Map<string, Readonly<Record<string, any>>>} */
const versionCache = new Map();

/**
 * The data of an official version: getData() for the default; for another, its directory loaded once and cached
 * (deep-frozen). The official-bounds cache is never filled from it: a plugin's caps follow the server's own data, and
 * per-version caps are a matter of the version's match host (M1).
 * @param {string} id a shared/versions.js id
 * @param {{ log?: { warn: Function, error: Function, info?: Function } }} [opts]
 * @returns {Readonly<Record<string, any>>}
 */
export function getVersionData(id, { log = console } = {}) {
  if (id === DEFAULT_VERSION) return getData({ log });
  const dir = versionDataDir(id);
  if (!dir) throw new RangeError(`unknown version ${JSON.stringify(id)}`);
  let data = versionCache.get(id);
  if (!data) {
    data = loadData(dir, { log, expected: VERSION_DATA_FILES });
    versionCache.set(id, data);
  }
  return data;
}

/** Drop every cached non-default version (tests). */
export function resetVersionData() {
  versionCache.clear();
}

/**
 * Make `data` the process-wide singleton (deep-frozen) — a match host worker (server/match/host/entry.js, DESIGN §32
 * P1c) calls it with its content set's merged data before it imports the match: every module of that worker that reads
 * getData() (the content modules' gameData(), builtinMeta, the sim's default DataSource) then sees the content set,
 * never the vanilla files. The main process never calls it. The official-bounds cache (shared/plugins/officialBounds.js,
 * filled by getData() from the vanilla files in the main process) is never filled from `data` (a plugin must not raise its
 * own caps): the match host installs the content set's snapshot after this (entry.js), as its pages do (runner.js).
 * @param {Record<string, any>} data
 * @returns {Readonly<Record<string, any>>}
 */
export function setData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TypeError('setData: a data object { <file>: record map } is required');
  singleton = deepFreeze(data);
  return singleton;
}

// ---------------------------------------------------------------------------------------------------
// Index getters
// ---------------------------------------------------------------------------------------------------

/** Data files that are `{ [id]: record }` maps, with the getter name exported for each. */
export const INDEXED_FILES = Object.freeze({
  chess: 'getChess', bonds: 'getBond', garrisons: 'getGarrison', items: 'getItem', bands: 'getBand',
  effects: 'getEffect', enemies: 'getEnemy', waves: 'getWave', stages: 'getStage', bosses: 'getBoss', tokens: 'getToken',
});

/** Own-property record lookup in a plain-object map; null for anything else. */
function ownRecord(map, id) {
  if (typeof id !== 'string' || id.length === 0) return null;
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.hasOwn(map, id)) return null;
  const rec = map[id];
  return rec !== null && typeof rec === 'object' ? rec : null;
}

/**
 * Record by id from an id-keyed data file (own properties only; never throws).
 * @param {string} file data file basename, e.g. 'chess'
 * @param {unknown} id record id
 * @param {Readonly<Record<string, any>>} [data] data object (default: getData())
 * @returns {any | null}
 */
export function lookup(file, id, data = getData()) {
  if (!data || typeof data !== 'object' || typeof file !== 'string' || !Object.hasOwn(data, file)) return null;
  return ownRecord(data[file], id);
}

/** @param {unknown} id chess id (normal `_a` or elite `_b`) @param {object} [data] */
export const getChess = (id, data) => lookup('chess', id, data);
/** @param {unknown} id bond id, e.g. 'yanShip' @param {object} [data] */
export const getBond = (id, data) => lookup('bonds', id, data);
/** @param {unknown} id garrison (特质) id @param {object} [data] */
export const getGarrison = (id, data) => lookup('garrisons', id, data);
/** @param {unknown} id item chess id @param {object} [data] */
export const getItem = (id, data) => lookup('items', id, data);
/** @param {unknown} id band (strategy) id @param {object} [data] */
export const getBand = (id, data) => lookup('bands', id, data);
/** @param {unknown} id effect id @param {object} [data] */
export const getEffect = (id, data) => lookup('effects', id, data);
/** @param {unknown} key enemy key @param {object} [data] */
export const getEnemy = (key, data) => lookup('enemies', key, data);
/** @param {unknown} id wave template id @param {object} [data] */
export const getWave = (id, data) => lookup('waves', id, data);
/** @param {unknown} id stage id @param {object} [data] */
export const getStage = (id, data) => lookup('stages', id, data);
/** @param {unknown} id boss id @param {object} [data] */
export const getBoss = (id, data) => lookup('bosses', id, data);
/** @param {unknown} id token id @param {object} [data] */
export const getToken = (id, data) => lookup('tokens', id, data);

/**
 * data/config.json, or null when missing.
 * @param {Readonly<Record<string, any>>} [data]
 * @returns {any | null}
 */
export function getConfig(data = getData()) {
  const cfg = data && typeof data === 'object' && Object.hasOwn(data, 'config') ? data.config : null;
  return cfg !== null && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : null;
}

/**
 * Mode record `config.modes[modeId]` (e.g. 'mode_multi_hard'), or null.
 * @param {unknown} modeId
 * @param {Readonly<Record<string, any>>} [data]
 * @returns {any | null}
 */
export function getMode(modeId, data = getData()) {
  const cfg = getConfig(data);
  return cfg ? ownRecord(cfg.modes, modeId) : null;
}
