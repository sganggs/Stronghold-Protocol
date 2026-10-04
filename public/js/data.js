// Lazy loader + cache for the generated game data served at /data/*.json.
//
// Files are fetched on first use and cached for the page's lifetime (the Promise is shared, so concurrent callers
// trigger a single request): every text of the game (operators, skills, bonds, items, enemies …) is static data loaded
// once — nothing is fetched from the server during a match. main.js warms the in-match files (gameComponents
// GAME_FILES) in the background once the player is in a room, and the match screen waits for them, so no text of the
// match UI ever appears late. A transient failure (network error, HTTP 5xx) is retried twice (RETRY_DELAYS_MS); files
// that stay unavailable (404, repeated failures, bad JSON) resolve to `null` and are reported once on the console — the
// UI must degrade gracefully while data is being generated. The emote manifests (`local`, `assets`) are the exception:
// one attempt is abandoned after ART_MANIFEST_TIMEOUT_MS (GitHub #99) and reported `missing` at once, so the 交流 button
// draws its glyph instead of staying blank; a later retry that succeeds replaces the glyph. Other files stay `loading`
// across their retries.
//
// Each file is indexed tolerantly so the getters work whether a file is
//   - an array of records carrying an id field (id / chessId / bondId / itemId / …),
//   - an object map { id: record },
//   - or either of those wrapped as { <name>: … } / { list: … } / { data: … }.
// Synchronous getters (getChess, getBond, …) return null until the file has loaded; use
// `loadData(...)` to await, or the `useData(...)` hook to re-render when files arrive.

import { useEffect, useReducer } from '../vendor/hooks.module.js';

/** Known data files (name → URL basename). Unknown names are allowed too (`/data/<name>.json`). */
export const DATA_FILES = Object.freeze({
  chess: 'chess.json',
  bonds: 'bonds.json',
  items: 'items.json',
  bands: 'bands.json',
  enemies: 'enemies.json',
  bosses: 'bosses.json',
  stages: 'stages.json',
  tokens: 'tokens.json',
  choices: 'choices.json',
  config: 'config.json',
  assets: 'assets.json',
  // Optional art extracted from a local game client (DESIGN §13): { groups: { '<subdir>': { name: { path, w, h } } } }.
  // The emotes and the 玩法说明 pages are in data/assets.json too (downloaded from the mirror): artUrls().
  local: 'local-assets.json',
});

const ID_KEYS = ['id', 'chessId', 'bondId', 'itemId', 'bandId', 'enemyKey', 'enemyId', 'stageId', 'bossId', 'tokenId', 'choiceId', 'key'];
const WRAPPER_KEYS = ['list', 'data', 'records', 'entries'];

function idOf(rec) {
  if (!rec || typeof rec !== 'object') return null;
  for (const k of ID_KEYS) {
    const v = rec[k];
    if ((typeof v === 'string' && v) || Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Build an id → record Map from a data file's JSON, tolerating the shapes listed in the header.
 * @param {string} name file name (used to unwrap `{ [name]: … }`)
 * @param {any} json
 * @returns {Map<string, any>}
 */
export function buildIndex(name, json) {
  const map = new Map();
  let src = json;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const k of [name, ...WRAPPER_KEYS]) {
      const inner = src[k];
      if (inner && typeof inner === 'object') { src = inner; break; }
    }
  }
  if (Array.isArray(src)) {
    for (const rec of src) {
      const id = idOf(rec);
      if (id != null && !map.has(id)) map.set(id, rec);
    }
  } else if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object') map.set(k, v);
    }
  }
  return map;
}

/** Waits (ms) before retrying a data file whose download failed transiently (network error, HTTP 5xx / 408 / 429). */
export const RETRY_DELAYS_MS = Object.freeze([600, 2000]);

/**
 * How long one attempt at an emote manifest (`local`, `assets`) may hang before it counts as a failure.
 * [ASSUMED] 8 s: long enough for a slow link, short enough that the 交流 button does not stay blank for the session
 * (GitHub #99). Other files are not on this clock.
 */
export const ART_MANIFEST_TIMEOUT_MS = 8000;

/** Manifests the emote button waits on. A hang here used to leave every cell blank (GitHub #99). */
const ART_MANIFESTS = new Set(['local', 'assets']);

/**
 * A failed load worth retrying: the request itself failed (network error) or the server answered 5xx / 408 / 429 — not a
 * definite 4xx (the file is not there) nor a delivered file that is not valid JSON (`badJson`).
 */
const transientFailure = (err) => {
  if (!err || err.badJson) return false;
  const s = err.status;
  return !(Number.isInteger(s) && s >= 400 && s < 500 && s !== 408 && s !== 429);
};

/**
 * Create a data store bound to a fetch implementation (injectable for tests).
 * A file is downloaded once per page (the texts of the game are static data, never fetched again during a match —
 * user playtest #3 item 9); a transient failure is retried (RETRY_DELAYS_MS) while the file stays 'loading', so a
 * network hiccup does not leave the texts of a whole session missing. `local` and `assets` are reported `missing` on
 * the first failure or timeout (the emote glyph) and stay that way through a retry; a later success is `ready`.
 * @param {{ fetch?: typeof fetch, base?: string, retryDelays?: number[], wait?: (ms: number) => Promise<void>, timeoutMs?: number, setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} [opts]
 *   `timeoutMs` 0 turns the art-manifest clock off. `setTimeout` / `clearTimeout` let a test fire that clock.
 */
export function createDataStore(opts = {}) {
  const base = opts.base ?? '/data/';
  const doFetch = opts.fetch || ((...a) => globalThis.fetch(...a));
  const retryDelays = Array.isArray(opts.retryDelays) ? opts.retryDelays : RETRY_DELAYS_MS;
  const wait = opts.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutMs === undefined ? ART_MANIFEST_TIMEOUT_MS : Number(opts.timeoutMs);
  const armTimer = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const disarmTimer = opts.clearTimeout || ((id) => clearTimeout(id));
  /** @type {Map<string, { status: 'loading'|'ready'|'missing', promise: Promise<any>, value: any, index: Map<string, any>|null }>} */
  const entries = new Map();
  const listeners = new Set();
  const warned = new Set();

  const notify = (name) => {
    for (const fn of [...listeners]) {
      try { fn(name); } catch (err) { console.error('[data] listener failed', err); }
    }
  };

  const urlFor = (name) => base + (DATA_FILES[name] || `${name}.json`);

  /**
   * One attempt at a file. Art manifests reject with a transient `{ timeout: true }` when the clock fires; a response
   * that arrives after that is ignored (the retry is a new request). [ASSUMED]
   */
  function readJson(name) {
    const run = async () => {
      const res = await doFetch(urlFor(name), { cache: 'no-cache' });
      if (!res || !res.ok) throw Object.assign(new Error(`HTTP ${res ? res.status : '???'}`), { status: res ? res.status : null });
      try {
        return await res.json();
      } catch (err) {
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), { badJson: true });
      }
    };
    if (!ART_MANIFESTS.has(name) || !(timeoutMs > 0)) return run();
    let timer = null;
    let done = false;
    const finish = () => {
      if (done) return false;
      done = true;
      if (timer != null) disarmTimer(timer);
      return true;
    };
    const timed = new Promise((_, reject) => {
      timer = armTimer(() => {
        if (!finish()) return;
        reject(Object.assign(new Error('timeout'), { timeout: true }));
      }, timeoutMs);
    });
    const req = run().then(
      (json) => { finish(); return json; },
      (err) => { finish(); throw err; },
    );
    return Promise.race([req, timed]);
  }

  function load(name) {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(name)) return Promise.resolve(null);
    const cur = entries.get(name);
    if (cur) return cur.promise;
    const entry = { status: 'loading', promise: null, value: null, index: null };
    const art = ART_MANIFESTS.has(name);
    entry.promise = (async () => {
      let toldMissing = false;
      for (let attempt = 0; ; attempt++) {
        try {
          entry.value = await readJson(name);
          entry.status = 'ready';
          break;
        } catch (err) {
          const current = entries.get(name) === entry;
          // Decided before notify. Invalidating inside that notify leaves `again` true; the wait then sees
          // the superseded entry and stops, so this attempt does not fetch again.
          const again = transientFailure(err) && attempt < retryDelays.length && current;
          // Emote art: glyph now. Stay `missing` through the retry wait — flipping back to `loading` blanks the button.
          if (art && current && entry.status !== 'missing') {
            entry.value = null;
            entry.index = null;
            entry.status = 'missing';
            toldMissing = true;
            notify(name);
          }
          if (again) {
            await wait(retryDelays[attempt]);
            if (entries.get(name) === entry) continue;
            break;
          }
          if (current) {
            if (!warned.has(name)) {
              warned.add(name);
              console.warn(`[data] ${urlFor(name)} unavailable (${err?.message || err}); continuing without it`);
            }
            entry.value = null;
            entry.index = null;
            entry.status = 'missing';
          }
          break;
        }
      }
      // A load superseded by invalidate() must not announce itself (its entry is no longer cached).
      // An art manifest already announced `missing` does not announce that same status again.
      if (entries.get(name) === entry && !(toldMissing && entry.status === 'missing')) notify(name);
      return entry.value;
    })();
    entries.set(name, entry);
    return entry.promise;
  }

  function index(name) {
    const e = entries.get(name);
    if (!e || e.status !== 'ready') return null;
    if (!e.index) e.index = buildIndex(name, e.value);
    return e.index;
  }

  return {
    /** Fetch (once) and return a file's JSON, or null when missing. */
    load,
    /** Load several files; resolves when all settled. */
    loadAll: (...names) => Promise.all(names.flat().map(load)),
    /** Raw JSON of a loaded file (null when missing / not loaded yet). */
    get: (name) => entries.get(name)?.value ?? null,
    /** 'idle' | 'loading' | 'ready' | 'missing' */
    status: (name) => entries.get(name)?.status ?? 'idle',
    /** Record by id from a loaded file (null when unknown / not loaded). */
    lookup(name, id) {
      if (id == null) return null;
      return index(name)?.get(String(id)) ?? null;
    },
    /** All records of a loaded file as an array (empty when not loaded). */
    list: (name) => [...(index(name)?.values() ?? [])],
    /** Drop a cached file and refetch it now (subscribers are notified when it settles). */
    invalidate(name) {
      if (!entries.has(name)) return Promise.resolve(null);
      entries.delete(name);
      warned.delete(name);
      const p = load(name);
      notify(name); // status is 'loading' again, never a stuck 'idle'
      return p;
    },
    /** Called with the file name whenever a file finishes loading (or is invalidated). */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Browser data store singleton. */
export const data = createDataStore();

/** @param {...string} names @returns {Promise<any[]>} */
export const loadData = (...names) => data.loadAll(...names);

/** @param {string} id chess id (normal or elite) */
export const getChess = (id) => data.lookup('chess', id);
/** @param {string} id bond id, e.g. 'yanShip' */
export const getBond = (id) => data.lookup('bonds', id);
/** @param {string} id item (trap) id */
export const getItem = (id) => data.lookup('items', id);
/** @param {string} id band (strategy) id */
export const getBand = (id) => data.lookup('bands', id);
/** @param {string} key enemy key */
export const getEnemy = (key) => data.lookup('enemies', key);
/** @param {string} id boss id */
export const getBoss = (id) => data.lookup('bosses', id);
/** @param {string} id stage id */
export const getStage = (id) => data.lookup('stages', id);
/** @param {string} id token id */
export const getToken = (id) => data.lookup('tokens', id);
/** @returns {any|null} data/config.json */
export const getConfig = () => data.get('config');

/**
 * URL of a local-client art entry (data/local-assets.json, DESIGN §13), or null when the manifest / entry is missing
 * (callers draw their own fallback). Load it first with `data.load('local')` / `useData('local')`.
 * @param {string} group e.g. 'ui/battle', 'emoticon/basic', 'guide'
 * @param {string} name entry name without extension
 */
export function localAsset(group, name) {
  const g = data.get('local')?.groups?.[group];
  const e = g && typeof g === 'object' ? g[name] : null;
  return e && typeof e.path === 'string' && e.path ? e.path : null;
}

/**
 * Candidate URLs, best first, of art that both the local client and the public mirror have — the 36 battle emotes and
 * the 19 玩法说明 pages (GitHub issue #42: a server without the client showed default emote icons): the local-client
 * entry (`localAsset(group, name)`), then the copy tools/fetch-assets.mjs downloads, which data/assets.json lists under
 * the same group and name as `ui['<group>/<name>']` (tools/assets/plan.mjs UI_EXTRAS). Empty when neither manifest
 * lists it (callers draw their own fallback); a caller skips a URL that fails to load and tries the next. Load both
 * files first (`useData('local', 'assets')`).
 * @param {string} group e.g. 'emoticon/basic', 'guide'
 * @param {string} name entry name without extension
 * @returns {string[]}
 */
export function artUrls(group, name) {
  const out = [];
  const local = localAsset(group, name);
  if (local) out.push(local);
  const ui = data.get('assets')?.ui;
  const key = `${group}/${name}`;
  const web = ui && typeof ui === 'object' && Object.hasOwn(ui, key) ? ui[key] : null;
  if (typeof web === 'string' && web && web !== local) out.push(web);
  return out;
}

/**
 * The URL to show from an artUrls() list: the first one that has not failed to load (a local file listed by a copied
 * data/local-assets.json without its files falls through to the mirror copy), or null when none is left.
 * @param {string[]} urls
 * @param {Set<string>} [failed] URLs whose image fired an error
 */
export function nextArtUrl(urls, failed) {
  for (const u of Array.isArray(urls) ? urls : []) if (typeof u === 'string' && u && !failed?.has(u)) return u;
  return null;
}

/**
 * Mode record from config.json (`modes[modeId]`), or null.
 * @param {string} modeId e.g. 'mode_multi_hard'
 */
export function getMode(modeId) {
  const cfg = getConfig();
  const modes = cfg && typeof cfg === 'object' ? (cfg.modes || cfg.modeDataDict) : null;
  if (!modes || typeof modes !== 'object') return null;
  if (Array.isArray(modes)) return modes.find((m) => m && (m.modeId === modeId || m.id === modeId)) || null;
  return modes[modeId] || null;
}

/**
 * Preact hook: start loading the given files and re-render when any of them settles.
 * @param {...string} names
 * @returns {boolean} true once every file is settled (ready or missing)
 */
export function useData(...names) {
  const [, force] = useReducer((c) => c + 1, 0);
  const key = names.join('|');
  useEffect(() => {
    let alive = true;
    const unsub = data.subscribe((n) => { if (alive && names.includes(n)) force(); });
    for (const n of names) data.load(n);
    return () => { alive = false; unsub(); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return names.every((n) => {
    const s = data.status(n);
    return s === 'ready' || s === 'missing';
  });
}
