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
//
// Language (docs/I18N.md): the files hold the official Chinese texts. `setLocale(lang, chain)` downloads (once each) the
// game-text overlays data/i18n/<code>.json of the chain — the language's own, its base's, a fallback's (ui/lang.js
// passes the languages of the pack's chain that have one; default: the language alone) — built by tools/build-i18n.mjs
// (the official texts by record id and field, shared/i18nData.js). From then on `get`, `lookup` and `list` — and every
// getter built on them — return the records with their texts in that language (a copy per file, built on first use):
// each text from the first overlay of the chain that has it, else the Chinese one. `setLocale('zh')` goes back. Each
// switch notifies the subscribers of every loaded file, so `useData` components re-render. `localeName(zh)` maps a
// Chinese game-data name to the current language (server messages name operators / items in Chinese).
//
// Views (DESIGN §32 P1a): `setView(name, fn)` shows a file through `fn` from then on — `get(name)` returns fn(the file);
// `getRaw`, `lookup` and `list` do not — and tells the file's subscribers. public/js/content.js shows the art manifest
// (`assets`) this way: with the room's cosmetic plugins and the player's own laid over it (public/js/assets.js
// cosmetics.apply), so every `data.get('assets')` of the interface draws what the room draws.
//
// Content sets (DESIGN §32.6 P1c): `setContent({ id, values, overlay })` makes the files of `values` (name → the JSON a
// page checked: public/js/content.js, every byte against the set's /cs/<cs16>/index.json) the store's files — `get`,
// `lookup`, `list` and every getter read the room's content set — and `overlay(lang)` the source of a language's game
// texts (the set's own i18n/<lang>.json: a plugin's operators named in that language); `setContent(null)` gives the
// server's files back (the entries the set replaced, kept meanwhile — nothing is downloaded again) and its overlays. The
// subscribers of every file that changed hands are told. One content set at a time: the next one replaces it.

import { useEffect, useReducer } from '../vendor/hooks.module.js';
import { applyFileOverlay } from '../../shared/i18nData.js';
import { canonicalLang } from '../../shared/i18nPacks.js';

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
  // 补位 stand-ins (DATA.md §18): the bodies the 干员持有 screen, the cards and the detail card compose (shared/standIn.js)
  backups: 'backups.json',
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
  /** Current locale ('zh' = the files as they are) and the downloaded overlays by language (shared/i18nData.js). */
  let locale = 'zh';
  /** The languages whose overlays apply, best first (a subset of the chain setLocale got: those that downloaded). */
  let chain = [];
  /** setLocale calls so far: a slower earlier call never overrides a later one. */
  let switches = 0;
  /** @type {Map<string, Promise<any>>} */
  const overlayLoads = new Map();
  /** @type {Map<string, any>} */
  const overlays = new Map();
  /** name → { lang, value, index } localized copy of a ready file (dropped on every switch / reload of the file) */
  const localized = new Map();
  /** name → the view `get` shows the file through (setView; the art manifest with the cosmetic plugins) */
  const views = new Map();
  /**
   * The content set the files come from (setContent: `values` name → JSON, `overlay(lang)` → a language's game texts or
   * null), or null: the files at `base`.
   * @type {{ id: string, values: Map<string, any>, overlay: ((lang: string) => Promise<any>) | null, langs: Set<string> } | null}
   */
  let content = null;
  /** name → the entry of the server's file a content set replaced (given back by setContent(null)) */
  const stash = new Map();
  /** the last setLocale's language and chain (applied again when a content set brings its own game texts) */
  let lastLocale = null;
  /** the content set whose overlays the chain in effect came from ('' = the server's) */
  let chainSource = '';

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

  /**
   * The localized copy of a ready file (null in Chinese or without an overlay for the file): the overlays of the chain
   * applied from the last to the first, each text checked against the Chinese file, so the best overlay wins per text.
   */
  function localizedEntry(name) {
    if (locale === 'zh' || !chain.length) return null;
    const e = entries.get(name);
    if (!e || e.status !== 'ready') return null;
    const fileOverlays = chain.flatMap((c) => [overlays.get(c)?.pluginOverlay?.files?.[name], overlays.get(c)?.files?.[name]]).filter(Boolean);
    if (!fileOverlays.length) return null;
    let l = localized.get(name);
    if (!l || l.lang !== locale || l.base !== e.value) {
      let value = e.value;
      for (const fo of fileOverlays.reverse()) {
        try { value = applyFileOverlay(e.value, fo, value).value; } catch (err) { console.warn(`[data] ${name}: overlay not applied`, err); }
      }
      l = { lang: locale, base: e.value, value, index: null };
      localized.set(name, l);
    }
    return l;
  }

  function index(name) {
    const e = entries.get(name);
    if (!e || e.status !== 'ready') return null;
    const l = localizedEntry(name);
    if (l) {
      if (!l.index) l.index = buildIndex(name, l.value);
      return l.index;
    }
    if (!e.index) e.index = buildIndex(name, e.value);
    return e.index;
  }

  /**
   * Download (once per language and source) a game-text overlay — `url` (a pack folder's file, from the pack index) or
   * the language folder's data/i18n/<lang>.json, or — a content set with texts of its own for the language (setContent) —
   * the set's i18n/<lang>.json through its `overlay` loader; resolves to it, or null when unavailable.
   */
  function loadOverlay(lang, url = `${base}i18n/${lang}.json`, overlayUrl = null) {
    const own = content && content.overlay && content.langs.has(lang) ? content : null;
    const key = own ? `${own.id}|${lang}` : lang;
    if (overlayLoads.has(key)) return overlayLoads.get(key);
    const p = (async () => {
      if (own) {
        let json = null;
        try { json = await own.overlay(lang); } catch (err) { console.warn(`[data] the content set's ${lang} texts are not applied`, err); }
        if (json && typeof json === 'object' && json.files) { overlays.set(lang, json); return json; }
        overlayLoads.delete(key);
        return null;
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await doFetch(url, { cache: 'no-cache' });
          if (!res || !res.ok) throw Object.assign(new Error(`HTTP ${res ? res.status : '???'}`), { status: res ? res.status : null });
          const json = await res.json();
          if (!json || typeof json !== 'object' || !json.files) throw Object.assign(new Error('not an overlay'), { badJson: true });
          let pluginOverlay = null;
          if (overlayUrl) {
            try {
              const extra = await doFetch(overlayUrl, { cache: 'no-cache' });
              const value = extra?.ok ? await extra.json() : null;
              if (value?.version === 1 && value.lang === lang && value.files) pluginOverlay = value;
            } catch { /* [ASSUMED] A missing overlay leaves built-in text available. */ }
          }
          const result = pluginOverlay ? { ...json, pluginOverlay } : json;
          overlays.set(lang, result);
          return result;
        } catch (err) {
          if (transientFailure(err) && attempt < retryDelays.length) { await wait(retryDelays[attempt]); continue; }
          console.warn(`[data] ${url} unavailable (${err?.message || err}); its game texts are not applied`);
          overlayLoads.delete(key); // a later switch may try again
          return null;
        }
      }
    })();
    overlayLoads.set(key, p);
    return p;
  }

  /**
   * The content set's files become the store's (see the header), or the server's again (null). Every file that changes
   * hands is told to its subscribers; the current language's game texts are taken from the new source.
   * @param {{ id: string, values: Map<string, any> | Record<string, any>, overlay?: ((lang: string) => Promise<any>) | null,
   *   langs?: Iterable<string> } | null} next
   */
  function setContent(next) {
    const prev = content;
    const values = next ? (next.values instanceof Map ? next.values : new Map(Object.entries(next.values || {}))) : null;
    content = next && values ? { id: String(next.id), values, overlay: typeof next.overlay === 'function' ? next.overlay : null, langs: new Set(next.langs || []) } : null;
    if ((prev?.id ?? null) === (content?.id ?? null) && prev?.values === content?.values) return;
    const names = new Set([...(prev ? prev.values.keys() : []), ...(content ? content.values.keys() : [])]);
    for (const name of names) {
      if (content && content.values.has(name)) {
        // keep the server's entry while the set shows its own (given back by setContent(null), never downloaded again)
        const cur = entries.get(name);
        if (!(prev && prev.values.has(name)) && cur) stash.set(name, cur);
        const value = content.values.get(name);
        entries.set(name, { status: 'ready', promise: Promise.resolve(value), value, index: null });
      } else {
        entries.delete(name);
        const old = stash.get(name);
        stash.delete(name);
        if (old) entries.set(name, old);
      }
      localized.delete(name);
    }
    for (const name of names) notify(name);
    // the game texts: the new source's overlays for the language in effect
    const langs = new Set([...(prev ? prev.langs : []), ...(content ? content.langs : [])]);
    if (langs.size && lastLocale && locale !== 'zh') api.setLocale(lastLocale.lang, lastLocale.items).catch(() => {});
  }

  const api = {
    /** Fetch (once) and return a file's JSON, or null when missing. */
    load,
    /** A content set's files instead of the server's, or the server's again (null) — see the header. */
    setContent,
    /** The id of the content set the files come from (its cs), or null. */
    contentId: () => content?.id ?? null,
    /** Load several files; resolves when all settled. */
    loadAll: (...names) => Promise.all(names.flat().map(load)),
    /** JSON of a loaded file in the current locale, through its view (setView); null when missing / not loaded yet. */
    get: (name) => {
      const v = localizedEntry(name)?.value ?? entries.get(name)?.value ?? null;
      const view = views.get(name);
      return view && v != null ? view(v) : v;
    },
    /** The file exactly as downloaded (Chinese texts), whatever the locale. */
    getRaw: (name) => entries.get(name)?.value ?? null,
    /** 'idle' | 'loading' | 'ready' | 'missing' */
    status: (name) => entries.get(name)?.status ?? 'idle',
    /** Record by id from a loaded file (null when unknown / not loaded). */
    lookup(name, id) {
      if (id == null) return null;
      return index(name)?.get(String(id)) ?? null;
    },
    /**
     * Record by id from a loaded file exactly as downloaded (its Chinese texts), whatever the locale — what the server
     * copied into a message, to compare with what it sent (ui/lang.js sentText).
     */
    lookupRaw(name, id) {
      if (id == null) return null;
      const e = entries.get(name);
      if (!e || e.status !== 'ready') return null;
      if (!e.index) e.index = buildIndex(name, e.value);
      return e.index.get(String(id)) ?? null;
    },
    /** All records of a loaded file as an array (empty when not loaded). */
    list: (name) => [...(index(name)?.values() ?? [])],
    /** Drop a cached file and refetch it now (subscribers are notified when it settles). */
    invalidate(name) {
      if (!entries.has(name)) return Promise.resolve(null);
      // a content set's file is the checked one the page holds: nothing to fetch again
      if (content && content.values.has(name)) return Promise.resolve(content.values.get(name));
      entries.delete(name);
      localized.delete(name);
      warned.delete(name);
      const p = load(name);
      notify(name); // status is 'loading' again, never a stuck 'idle'
      return p;
    },
    /**
     * Show a file through `fn` from now on (`get` returns fn(file); `fn` should return the same object while its inputs
     * stay — content.js's does), or as downloaded again (null). The file's subscribers are notified: call it again after
     * the view's own inputs changed (see the header).
     * @param {string} name
     * @param {((value: any) => any) | null} fn
     */
    setView(name, fn) {
      if (typeof fn === 'function') views.set(name, fn);
      else views.delete(name);
      notify(name);
    },
    /** Called with the file name whenever a file finishes loading (or is invalidated, or the locale changes). */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Current game-text locale ('zh' or the language of the last switch). */
    locale: () => locale,
    /** The languages whose overlays apply now, best first (empty in Chinese). */
    localeChain: () => [...chain],
    /**
     * Switch the game texts' language: 'zh' at once; another language once the overlays of `chain` (default: the
     * language alone) have downloaded — those that fail are left out. When every overlay of a non-empty chain fails the
     * locale does not change (the texts stay as they are); an empty chain (a pack without game texts) switches with
     * the Chinese texts. Every loaded file's subscribers are notified. Resolves to the locale in effect.
     * @param {string} lang
     * @param {(string | { code: string, url?: string, overlayUrl?: string })[]} [chainIn] overlay languages, best first (with the URL of
     *   each overlay when it is not the language folder's data/i18n/<code>.json)
     * @returns {Promise<string>}
     */
    async setLocale(lang, chainIn) {
      lastLocale = { lang, items: chainIn };
      const code = canonicalLang(lang);
      const want = code && code === lang ? code : 'zh';
      const items = (Array.isArray(chainIn) ? chainIn : [want]).map((c) => (typeof c === 'string' ? { code: c, url: undefined } : c));
      const seen = new Set();
      const asked = want === 'zh' ? [] : items.filter((c) => c && canonicalLang(c.code) === c.code && c.code !== 'zh' && !seen.has(c.code) && seen.add(c.code));
      const ask = asked.map((c) => c.code);
      const seq = ++switches;
      const got = await Promise.all(asked.map((c) => loadOverlay(c.code, typeof c.url === 'string' && c.url ? c.url : undefined, c.overlayUrl)));
      if (seq !== switches) return locale; // a later switch is under way
      // each language's overlay from the source in effect now (a content set's, or the server's again — a cached load
      // of either is not set again by loadOverlay)
      asked.forEach((c, i) => { if (got[i]) overlays.set(c.code, got[i]); });
      const next = ask.filter((_, i) => got[i]);
      if (ask.length && !next.length) return locale;
      // (the same chain from another source — a content set's texts came or went — applies again)
      const source = content?.id ?? '';
      if (want === locale && next.join('|') === chain.join('|') && source === chainSource) return locale;
      locale = want;
      chain = next;
      chainSource = source;
      localized.clear();
      for (const name of [...entries.keys()]) notify(name);
      return locale;
    },
    /**
     * A Chinese game-data name (operator, item, bond, token …) in the current locale: the first overlay of the chain
     * that knows it, else the name itself (also in Chinese).
     * @param {string} zh
     * @returns {string}
     */
    localeName(zh) {
      if (locale === 'zh' || typeof zh !== 'string') return zh;
      for (const c of chain) {
        for (const names of [overlays.get(c)?.pluginOverlay?.names, overlays.get(c)?.names]) {
          if (names && Object.prototype.hasOwnProperty.call(names, zh) && typeof names[zh] === 'string' && names[zh]) return names[zh];
        }
      }
      return zh;
    },
  };
  return api;
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
  }, [key]);
  return names.every((n) => {
    const s = data.status(n);
    return s === 'ready' || s === 'missing';
  });
}
