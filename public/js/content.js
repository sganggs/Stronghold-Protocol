// content.js — what this page shows beyond the installation's own art (DESIGN §32 P1a, docs/PLUGINS.md §9): the room's
// visual set — the cosmetic plugins its host switched on, named by room.state.content.vs — and the player's personal
// cosmetic plugins (设置 → 外观插件, kept in this browser only: `sp.pref.cosmetics`), laid over the art manifest every
// screen reads (cosmetics.js `cosmetics`; data.js shows `assets` through them, so `data.get('assets')` is the art the room
// draws). Nothing here changes a battle: a room's `cs` stays the vanilla one, and nobody else sees a personal plugin.
//
//   * The room: whenever room.state.content.vs changes, /vs/<vs16>/overlay.json is fetched as text, parsed and checked
//     (shared/plugins/visual.js checkVisualDoc — its composition hashes to the `vs` the room named) and becomes the room
//     layer: the page composes the art itself, on the manifest it loaded — every plugin URL built from that composition's
//     file table, every reference copied out of its own manifest, a write that does not fit left out (cosmetics.js
//     createCosmeticLayers) —, never a manifest the server put together. What checks and composes a document
//     (shared/plugins/visual.js) is loaded only when there is one (cosmetics.js loadVisual): a page without plugins never
//     loads it. Leaving the room, or a room without plugins,
//     takes the layer away again: one room's art never stays behind or piles up. A document that fails the check or
//     will not download (two retries; an attempt is given up after VISUAL_TIMEOUT_MS) leaves the original art; that, a
//     write left out or a plugin file that will not load is said once (a toast). A plugin file that will not load — an
//     `<img>` of the interface (caught here, for every image of the page), an image or a model of the board (assets.js
//     reports its own), a sound (audio.js, through main.js) — makes its entry fall back to the art beneath it: the
//     installation's, or the room's under a personal plugin (cosmetics.js createCosmeticLayers fail).
//   * Personal plugins: the catalogue (/plugins/index.json — loadCatalog) names each loaded cosmetic plugin of scope
//     `personal` with the `vs` of the set of it alone and what the load order reads of it (requires, conflicts,
//     loadAfter / loadBefore, priority). The plugins the player switched on are ordered exactly like a room's set
//     (shared/plugins/order.js: their requirements switched on too — 「自动」 —, a conflict refused) — personalSet; a
//     switch that would make a conflict or needs a plugin the server lacks is refused with the room's message
//     (setPersonalPlugin → PLUGIN_CONFLICT / PLUGIN_DEPENDENCY), and a choice that turned bad since (the server's
//     plugins changed) keeps what still fits, by id [ASSUMED]. Each plugin of the set is fetched as
//     /vs/<vs16>/overlay.json of its catalogue `vs`, checked the same way (side by side) and applied after the room's,
//     in that order. A plugin this server does not have is skipped and stays switched on here (it shows again when the
//     server has it).
//   * The room's content set (DESIGN §32.6, P1c): when room.state.content names a content set with gameplay plugins
//     (`vanilla: false`, its own cs), the page downloads /cs/<cs16>/index.json and every data file it lists — a file the
//     set did not change at its plain /data/<file>?v=<8 hex> URL (cached for good), a patched one at /cs/<cs16>/… — and
//     checks them: every file's BYTES hash to its entry (shared/sha256.js, before decoding: `res.text()` would drop a
//     BOM), the manifest's composition — its data and translation files' hashes, its plugins and their settings — hashes
//     to the room's cs (shared/plugins/identity.js contentHashOf), and it names no address but those two. Then data.js
//     shows those files (setContent: every screen reads the room's data — its operators, its modes), the battle runner
//     simulates on them (simContent / contentFor) and the page tells the room (room.contentReady { cs }; again whenever
//     its seat shows it not ready — a reconnect); a check that fails is said once (a toast) and told too ({ ok: false }).
//     Leaving the room, or a room back on the original content, gives data.js the server's files again. One content set
//     at a time (contentSet: its state for the screens — loading with its progress, ready, failed).
//   * The catalogue is fetched only on a server that has plugins — `content.plugins` > 0 in /healthz (the build guard's
//     first check, before any hello) or welcome (main.js keeps it as the store's `installedPlugins`: installedCount; a
//     server without any sends none, and its page never asks for /plugins/index.json) — and only when something needs
//     it: a switched-on personal plugin, the room's 插件 panel (ui/pluginPanel.js), 设置's 外观插件 (ui/settings.js) or
//     the list behind the title screen's 「本服务器安装了 N 个插件」 (that count is the server's).

import { createStore, loadPref, savePref, store as appStore } from './store.js';
import { data as dataStore } from './data.js';
import { net as appNet } from './net.js';
import { cosmetics, loadVisual, visualNow } from './cosmetics.js';
import { PLUGINS_URL } from '../../shared/plugins/manifest.js';
import { contentHashOf, csUrlPart, isContentHash, isContentHash as isVisualHash } from '../../shared/plugins/identity.js';
import { resolveThemeVars, themeVarsOf } from '../../shared/plugins/theme.js';
import { applyThemeProperties } from './themeVars.js';
import { sha256Hex } from '../../shared/sha256.js';
import { getLang, langChain, t, N_ } from '../../shared/i18n.js';
import { DEV_BUILD } from '../../shared/constants.js';

/** The localStorage preference (`sp.pref.<key>`) of the personal cosmetic plugins: their ids. */
export const PERSONAL_PREF = 'cosmetics';
/** Waits (ms) before a visual set's document is fetched again after a transient failure (like data.js). */
export const VISUAL_RETRY_MS = Object.freeze([600, 2000]);
/** How long one attempt at a visual set's document may take before it counts as a transient failure [ASSUMED]. */
export const VISUAL_TIMEOUT_MS = 30000;
/** What the page says (once) when a set's document will not load, or when writes were left out / a file failed. */
const NOT_LOADED = N_('外观插件没有载入，显示原版素材');
const PARTLY = N_('部分外观插件素材无法使用，相应位置显示原版素材');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isIds = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{1,31}$/.test(x));
const defaultFetch = (...a) => globalThis.fetch(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The plugin catalogue (GET /plugins/index.json): `status` 'idle' | 'loading' | 'ready' | 'failed', `plugins` its
 * entries (shared/plugins/manifest.js pluginIndexEntry), `app` the server's version.
 */
export const catalog = createStore({ status: 'idle', plugins: [], app: null, at: 0 });
let catalogLoad = null;

/** shared/plugins/order.js — loaded with the catalogue (a page of a server without plugins never needs it). */
let orderModule = null;
/** Load the load-order function (with the catalogue; tests). @returns {Promise<boolean>} whether it is there */
export const loadPluginOrder = () => (orderModule ? Promise.resolve(true)
  : import('../../shared/plugins/order.js').then((m) => { orderModule = m; return true; }, () => false));

/**
 * Fetch the catalogue (never cached by the browser: the server lists what its plugins/ holds now) — and the load-order
 * function the personal plugins need with it (loadPluginOrder). Shared while one is on its way; `force` fetches again
 * even when one is there (a panel opened later sees a plugin dropped in meanwhile).
 * @param {{ force?: boolean, fetch?: typeof fetch }} [opts]
 * @returns {Promise<any[]>} the entries ([] when it is unavailable)
 */
export function loadCatalog({ force = false, fetch: doFetch = defaultFetch } = {}) {
  const cur = catalog.get();
  if (catalogLoad) return catalogLoad;
  if (cur.status === 'ready' && !force) return Promise.resolve(cur.plugins);
  catalog.set({ status: cur.status === 'ready' ? 'ready' : 'loading' });
  catalogLoad = (async () => {
    try {
      const res = await doFetch(`${PLUGINS_URL}index.json`, { cache: 'no-store' });
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '???'}`);
      const body = await res.json();
      const plugins = isObj(body) && Array.isArray(body.plugins) ? body.plugins.filter(isObj) : [];
      await loadPluginOrder();
      catalog.set({ status: 'ready', plugins, app: typeof body?.app === 'string' ? body.app : null, at: Date.now() });
      return plugins;
    } catch (err) {
      console.warn(`[content] ${PLUGINS_URL}index.json unavailable (${err?.message || err})`);
      catalog.set({ status: cur.status === 'ready' ? 'ready' : 'failed' });
      return catalog.get().plugins;
    } finally {
      catalogLoad = null;
    }
  })();
  return catalogLoad;
}

/**
 * How many unofficial plugins the server has (/healthz or welcome `content.plugins`, kept by main.js as the store's
 * `installedPlugins`; 0 when it sent none): the title screen's count, and whether the catalogue is ever worth fetching.
 * @param {any} s the app store's state
 */
export const installedCount = (s) => (Number.isInteger(s?.installedPlugins) && s.installedPlugins > 0 ? s.installedPlugins : 0);

/** The catalogue's unofficial entries — every plugin but a language (the title screen's count, §7.4). @param {any[]} plugins */
export const unofficialPlugins = (plugins) => (Array.isArray(plugins) ? plugins.filter((p) => p && p.unofficial) : []);

/**
 * The loaded cosmetic plugins of the catalogue (of `scope`, when given): what a room's host (room) or a player (personal)
 * may switch on, in the catalogue's order (by id).
 * @param {any[]} plugins @param {'room' | 'personal'} [scope]
 */
export const cosmeticPlugins = (plugins, scope) => (Array.isArray(plugins) ? plugins : [])
  .filter((p) => p && p.class === 'cosmetic' && p.status === 'loaded' && (!scope || (Array.isArray(p.scope) && p.scope.includes(scope))));

/** A catalogue entry sets at least one theme variable this page would write. */
export function hasThemeVars(p) {
  const vars = themeVarsOf(p);
  return !!vars && Object.keys(vars).length > 0;
}

/**
 * A personal cosmetic the 外观插件 switch lists and this page applies: art (`vs`) or theme variables.
 * [ASSUMED] A cosmetic that is only announcements is not listed — its switch would change nothing on the page.
 */
export function isPersonalCosmetic(p) {
  return isVisualHash(p?.vs) || hasThemeVars(p);
}

/**
 * A plugin's name in the interface language: its name in the first language of the chain it has, else its own name.
 * @param {any} p a catalogue entry
 */
export function pluginName(p) {
  const names = isObj(p?.names) ? p.names : {};
  for (const code of [...langChain(getLang()), 'zh']) if (typeof names[code] === 'string' && names[code]) return names[code];
  return typeof p?.name === 'string' && p.name ? p.name : String(p?.id ?? '');
}

// ---- personal plugins -----------------------------------------------------------------------------------------------

/** The personal cosmetic plugins switched on in this browser: `{ ids }` (persisted as PERSONAL_PREF). */
export const personal = createStore({ ids: (() => { const v = loadPref(PERSONAL_PREF, []); return isIds(v) ? v : []; })() });
personal.subscribe((s) => savePref(PERSONAL_PREF, s.ids));

/** What the load order reads of a catalogue entry (shared/plugins/order.js OrderEntry). @param {any} p */
const orderEntry = (p) => ({
  id: p.id, version: typeof p.version === 'string' ? p.version : '0.0.0',
  requires: isObj(p.requires) ? p.requires : {}, optional: isObj(p.optional) ? p.optional : {}, conflicts: isObj(p.conflicts) ? p.conflicts : {},
  loadAfter: Array.isArray(p.loadAfter) ? p.loadAfter : [], loadBefore: Array.isArray(p.loadBefore) ? p.loadBefore : [],
  priority: Number.isInteger(p.priority) ? p.priority : 0,
});

/**
 * The personal set of the plugins `ids` switched on, among the catalogue's personal cosmetic plugins `entries` (see the
 * header): ordered like a room's set — their requirements switched on too (`auto`) — or, when the choice as a whole is
 * refused (a conflict, a requirement gone: the server's plugins changed since), what still fits, taken by id
 * [ASSUMED]; `skipped`: the chosen ones left out that way. Ids the catalogue does not offer are ignored (kept switched on).
 * @param {string[]} ids @param {any[]} entries all loaded personal cosmetics, including hidden notice-only dependencies
 * @returns {{ order: string[], auto: string[], skipped: string[] }}
 */
export function personalSet(ids, entries) {
  const byId = new Map((Array.isArray(entries) ? entries : []).filter((p) => p && typeof p.id === 'string').map((p) => [p.id, orderEntry(p)]));
  const lookup = (id) => byId.get(id) || null;
  const chosen = [...new Set(ids)].filter((id) => byId.has(id)).sort();
  // (the function comes with the catalogue — without it, which never happens once the catalogue is there: as chosen)
  const resolvePluginOrder = orderModule?.resolvePluginOrder;
  if (!resolvePluginOrder) return { order: chosen, auto: [], skipped: [] };
  const full = resolvePluginOrder(chosen, lookup);
  if (!('error' in full)) return { order: full.order, auto: full.auto, skipped: [] };
  let kept = [];
  let best = { order: [], auto: [] };
  for (const id of chosen) {
    const r = resolvePluginOrder([...kept, id], lookup);
    if ('error' in r) continue;
    kept = [...kept, id];
    best = r;
  }
  return { order: best.order, auto: best.auto, skipped: chosen.filter((id) => !kept.includes(id)) };
}

/**
 * Switch a personal cosmetic plugin on or off (this browser only). Switching one on that would conflict with the others
 * or needs a plugin this server lacks is refused (the catalogue loaded: the room's PLUGIN_CONFLICT / PLUGIN_DEPENDENCY);
 * off always works (a plugin another one needs stays in the set, 「自动」).
 * @param {string} id @param {boolean} on
 * @returns {{ ok: true } | { error: string, detail: string }}
 */
export function setPersonalPlugin(id, on) {
  const ids = personal.get().ids.filter((x) => x !== id);
  if (on) {
    const cat = catalog.get();
    if (cat.status === 'ready' && orderModule) {
      const entries = cosmeticPlugins(cat.plugins, 'personal');
      if (entries.some((p) => p.id === id)) {
        const byId = new Map(entries.map((p) => [p.id, orderEntry(p)]));
        const r = orderModule.resolvePluginOrder([...new Set([...ids, id])].filter((x) => byId.has(x)).sort(), (x) => byId.get(x) || null);
        if ('error' in r) return { error: r.error, detail: r.detail };
      }
    }
    ids.push(id);
  }
  personal.set({ ids: ids.sort() });
  return { ok: true };
}

/**
 * Fetch a visual set's document (/vs/<vs16>/overlay.json) as text, parse it and check it against `vs`
 * (shared/plugins/visual.js checkVisualDoc). A network error, an attempt over `timeoutMs` (VISUAL_TIMEOUT_MS) or HTTP 5xx
 * / 408 / 429 is tried again (VISUAL_RETRY_MS).
 * @param {string} vs the full visual hash the room (or the catalogue) named
 * @param {{ fetch?: typeof fetch, retryDelays?: readonly number[], wait?: (ms: number) => Promise<void>, timeoutMs?: number }} [opts]
 * @returns {Promise<{ doc: any } | { error: string }>}
 */
export async function fetchVisualDoc(vs, { fetch: doFetch = defaultFetch, retryDelays = VISUAL_RETRY_MS, wait = sleep, timeoutMs = VISUAL_TIMEOUT_MS } = {}) {
  if (!isVisualHash(vs)) return { error: 'no visual hash' };
  let visual = visualNow();
  if (!visual) { try { visual = await loadVisual(); } catch { return { error: 'shared/plugins/visual.js did not load' }; } }
  const { VISUAL_SETS_URL, VISUAL_DOC_FILE, vsUrlPart, checkVisualDoc } = visual;
  const url = `${VISUAL_SETS_URL}${vsUrlPart(vs)}/${VISUAL_DOC_FILE}`;
  for (let attempt = 0; ; attempt++) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => { ctrl?.abort(); resolve(null); }, timeoutMs); });
    let res;
    let text = null;
    try {
      res = await Promise.race([doFetch(url, { cache: 'no-cache', signal: ctrl?.signal }), timedOut]);
      if (res && res.ok) text = await Promise.race([res.text(), timedOut]);
    } catch { res = null; }
    clearTimeout(timer);
    const transient = !res || res.status >= 500 || res.status === 408 || res.status === 429 || (res.ok && text === null);
    if (res && res.ok && text !== null) {
      let doc;
      try { doc = JSON.parse(text); } catch { return { error: `${url}: not JSON` }; }
      const bad = checkVisualDoc(doc, vs);
      return bad ? { error: `${url}: ${bad}` } : { doc };
    }
    if (transient && attempt < retryDelays.length) { await wait(retryDelays[attempt]); continue; }
    return { error: `${url}: ${res ? `HTTP ${res.status}` : 'unreachable'}` };
  }
}

/**
 * Keep the page's cosmetic layers in step with the room and the personal plugins (see the header): data.js shows
 * `assets` through them from now on. Idempotent per store; returns the uninstall.
 * @param {{ store?: typeof appStore, data?: typeof dataStore, layers?: typeof cosmetics, fetch?: typeof fetch,
 *   toast?: ((text: string, kind?: string) => void) | null, retryDelays?: readonly number[] }} [opts]
 */
export function installContent({ store = appStore, data = dataStore, layers = cosmetics, fetch: doFetch = defaultFetch, toast = null,
  retryDelays = VISUAL_RETRY_MS } = {}) {
  const view = (v) => layers.apply(v);
  data.setView('assets', view);
  // every layer change: data.js tells the `assets` subscribers (useData('assets') re-renders the interface's art)
  const offLayers = layers.subscribe(() => data.setView('assets', view));
  // the page says it once, whatever the trouble: a document that will not load, writes left out, a file that failed
  let told = false;
  const tell = (why, text = NOT_LOADED) => {
    console.warn(`[content] ${why}`);
    if (!told && toast) { told = true; toast(t(text), 'warn'); }
  };
  layers.onDrop((reasons, count) => tell(`${count} write(s) of a visual set left out: ${reasons.join('; ')}`, PARTLY));
  let failedTold = layers.failed?.length || 0;
  const offFailed = layers.subscribe(() => {
    const now = layers.failed?.length || 0;
    if (now > failedTold) { failedTold = now; tell(`a plugin file did not load: ${layers.failed[now - 1]}`, PARTLY); }
  });
  // an <img> of the interface (a card, a portrait, an icon) whose plugin file will not load: its entry falls back (error
  // events do not bubble — caught on the way down)
  const doc = globalThis.document;
  const onImgError = (e) => { const el = e?.target; if (el && el.tagName === 'IMG') layers.fail?.(el.currentSrc || el.src); };
  doc?.addEventListener?.('error', onImgError, true);

  // the room's visual set
  let roomVs = null;
  let roomReq = 0;
  const syncRoom = (s) => {
    const vs = isVisualHash(s?.room?.content?.vs) ? s.room.content.vs : null;
    if (vs === roomVs) return;
    roomVs = vs;
    const req = ++roomReq;
    if (!vs) { layers.setRoom(null); return; }
    fetchVisualDoc(vs, { fetch: doFetch, retryDelays }).then((r) => {
      if (req !== roomReq) return; // another room (or none) meanwhile
      if ('error' in r) { layers.setRoom(null); tell(r.error); return; }
      layers.setRoom(r.doc);
    });
  };

  // the personal plugins: each one's overlay, kept by its vs (a set's document never changes for one vs)
  /** @type {Map<string, Promise<{ doc: any } | { error: string }>>} */
  const overlays = new Map();
  let personalReq = 0;
  /** Names this install wrote onto the document, so switching a plugin off removes them. */
  let themeApplied = new Set();
  const syncTheme = (order, offered) => {
    const root = globalThis.document?.documentElement;
    const winners = resolveThemeVars((order || []).map((id) => {
      const p = offered?.find((x) => x.id === id);
      return { id, vars: themeVarsOf(p) };
    }));
    themeApplied = applyThemeProperties(root, winners, themeApplied);
  };
  const syncPersonal = async () => {
    const req = ++personalReq;
    const ids = personal.get().ids;
    // none switched on, or a server without plugins (never even asked for its catalogue)
    if (!ids.length || !installedCount(store.get())) { layers.setPersonal([]); syncTheme([], []); return; }
    // Keep hidden notice-only cosmetics in dependency lookup; filter switches and overlay fetches separately.
    const offered = cosmeticPlugins(await loadCatalog({ fetch: doFetch }), 'personal');
    if (req !== personalReq) return;
    // the set as a room's would be (requirements switched on, a conflict refused — what still fits), in its load order.
    // Theme variables are then taken in plugin-id order (the later id wins), on this page only.
    const set = personalSet(ids, offered);
    if (set.skipped.length) console.warn(`[content] personal plugins left out (a conflict or a missing requirement): ${set.skipped.join(', ')}`);
    syncTheme(set.order, offered);
    const entries = set.order.map((id) => offered.find((p) => p.id === id)).filter((p) => p && isVisualHash(p.vs));
    // side by side; applied in that order. A theme-only plugin has no overlay to fetch.
    for (const p of entries) if (!overlays.has(p.vs)) overlays.set(p.vs, fetchVisualDoc(p.vs, { fetch: doFetch, retryDelays }));
    const results = await Promise.all(entries.map((p) => overlays.get(p.vs)));
    const list = [];
    entries.forEach((p, i) => {
      const r = results[i];
      if ('error' in r) { overlays.delete(p.vs); tell(r.error); return; }
      list.push({ id: p.id, doc: r.doc });
    });
    if (req === personalReq) layers.setPersonal(list);
  };

  // the server's plugin count arrives with welcome (or changes on a reconnect): the personal plugins follow it
  let installed = installedCount(store.get());
  const offStore = store.subscribe((s) => {
    syncRoom(s);
    const n = installedCount(s);
    if (n !== installed) { installed = n; if (personal.get().ids.length) syncPersonal(); }
  });
  syncRoom(store.get());
  const offPersonal = personal.subscribe(() => { syncPersonal(); });
  // a catalogue fetched again may name a plugin's new `vs` (its files changed): the switched-on ones follow
  let catalogAt = catalog.get().at;
  const offCatalog = catalog.subscribe((c) => { if (c.at !== catalogAt) { catalogAt = c.at; if (personal.get().ids.length) syncPersonal(); } });
  if (personal.get().ids.length) syncPersonal();
  return () => {
    ++personalReq; ++roomReq; // Drop in-flight answers before removing this install's properties and layers.
    offStore(); offPersonal(); offCatalog(); offLayers(); offFailed(); layers.onDrop(null);
    doc?.removeEventListener?.('error', onImgError, true);
    data.setView('assets', null); layers.setRoom(null); layers.setPersonal([]);
    themeApplied = applyThemeProperties(globalThis.document?.documentElement, [], themeApplied);
  };
}

/**
 * What the diagnostics name of this page's personal plugins (public/js/diag.js contentLine): `[{ id }]` of the
 * switched-on ones the page applies now.
 */
export const personalApplied = () => cosmetics.personal.map((p) => ({ id: p.id }));

// ---- the room's content set (P1c) -----------------------------------------------------------------------------------

/** Waits (ms) before a content file is fetched again after a transient failure. */
export const CONTENT_RETRY_MS = Object.freeze([600, 2000]);
/** How long one attempt at one content file may take before it counts as a transient failure [ASSUMED]. */
export const CONTENT_TIMEOUT_MS = 60000;
/** Files of a content set fetched at once. [ASSUMED] */
const CONTENT_PARALLEL = 4;
/** What the page says (once) when the room's content set will not load or check. */
const CONTENT_FAILED = N_('房间的插件内容未能通过校验，请刷新页面重试');

/**
 * The room's content set as this page has it (header "The room's content set"): `cs` (null: the original content),
 * `status` 'idle' | 'loading' | 'ready' | 'failed', `loaded` / `total` bytes of its files, `error` (why it failed),
 * `kitted` (the operators its plugins add to a 自选 slot's list — room.state.content.kittedExtra; null: none, the server's
 * list alone).
 */
export const contentSet = createStore({ cs: null, status: 'idle', loaded: 0, total: 0, error: null, kitted: null });
/** The checked set the page holds: { cs, index, values: Map<name, JSON>, bounds } (the runner's data), or null. */
let held = null;
/** Pages waiting for a content set (contentFor): cs → resolvers. */
const waiting = new Map();

/**
 * One file of a content set as bytes, checked against its manifest entry (size and SHA-256 of the bytes), then decoded
 * and parsed. Transient failures (network, a timeout, HTTP 5xx / 408 / 429) are tried again.
 * @param {string} url @param {{ sha256?: string, bytes?: number } | null} want null: the manifest itself (checked later)
 * @param {{ fetch: typeof fetch, retryDelays?: readonly number[], wait?: (ms: number) => Promise<void>, timeoutMs?: number,
 *   onBytes?: (n: number) => void }} opts
 * @returns {Promise<any>} the parsed JSON (rejects with the reason)
 */
export async function fetchChecked(url, want, { fetch: doFetch, retryDelays = CONTENT_RETRY_MS, wait = sleep, timeoutMs = CONTENT_TIMEOUT_MS, onBytes = null }) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const timedOut = new Promise((resolve) => { timer = setTimeout(() => { ctrl?.abort(); resolve(null); }, timeoutMs); });
    let res;
    let buf = null;
    try {
      res = await Promise.race([doFetch(url, { cache: 'default', signal: ctrl?.signal }), timedOut]);
      if (res && res.ok) buf = await Promise.race([res.arrayBuffer(), timedOut]);
    } catch { res = null; }
    clearTimeout(timer);
    if (res && res.ok && buf) {
      const bytes = new Uint8Array(buf);
      if (want) {
        if (Number.isFinite(want.bytes) && bytes.length !== want.bytes) throw new Error(`${url}: ${bytes.length} bytes, not ${want.bytes}`);
        if (sha256Hex(bytes) !== want.sha256) throw new Error(`${url}: its bytes do not hash to the content set's entry`);
      }
      onBytes?.(bytes.length);
      // decoded after the check (a BOM is part of the bytes, not of the JSON)
      try { return JSON.parse(new TextDecoder('utf-8').decode(bytes)); } catch { throw new Error(`${url}: not JSON`); }
    }
    const transient = !res || res.status >= 500 || res.status === 408 || res.status === 429 || (res.ok && !buf);
    if (transient && attempt < retryDelays.length) { await wait(retryDelays[attempt]); continue; }
    throw new Error(`${url}: ${res ? `HTTP ${res.status}` : 'unreachable'}`);
  }
}

/**
 * Download and check a content set (header "The room's content set"): its manifest (its composition must hash to `cs`)
 * and every data file it lists (each one's bytes to its entry), and the official-bounds snapshot it lists (bounds.official:
 * the table the server validated the set against and its match host installs — the battle runner installs the same one,
 * public/js/battle/runner.js loadBrowserSim; checked by its bytes like a data file; null when the manifest lists none).
 * @param {string} cs
 * @param {{ fetch?: typeof fetch, retryDelays?: readonly number[], wait?: (ms: number) => Promise<void>, timeoutMs?: number,
 *   onProgress?: (loaded: number, total: number) => void }} [opts]
 * @returns {Promise<{ cs: string, index: any, values: Map<string, any>, bounds: any }>} (rejects with the reason)
 */
export async function loadContentSet(cs, { fetch: doFetch = defaultFetch, retryDelays = CONTENT_RETRY_MS, wait = sleep, timeoutMs = CONTENT_TIMEOUT_MS, onProgress = null, consent = false } = {}) {
  if (!isContentHash(cs)) throw new Error('no content hash');
  const index = await fetchChecked(`/cs/${csUrlPart(cs)}/index.json`, null, { fetch: doFetch, retryDelays, wait, timeoutMs });
  if (!isObj(index) || index.cs !== cs || index.vanilla !== false || !isObj(index.data)) throw new Error('the manifest is not the room\'s content set');
  const listed = (files) => (isObj(files) ? Object.entries(files).filter(([, f]) => isObj(f) && typeof f.url === 'string' && isContentHash(f.sha256)) : []);
  const entries = listed(index.data);
  const hashes = Object.fromEntries(entries.map(([name, f]) => [name, f.sha256]));
  // its translation files (a plugin's operators named per language): the cs covers their hashes too
  const langs = listed(index.i18n);
  const i18n = Object.fromEntries(langs.map(([lang, f]) => [lang, f.sha256]));
  let again;
  try {
    again = contentHashOf({ app: index.app, sim: index.sim, data: hashes, plugins: index.plugins, settings: index.settings, ...(langs.length ? { i18n } : {}), ...(isObj(index.rules) ? { rules: index.rules } : {}) });
  } catch { again = null; }
  if (again !== cs) throw new Error('the manifest does not hash to the room\'s cs');
  // the URLs a manifest may name: this server's data files and this set's own files
  const own = `/cs/${csUrlPart(cs)}/`;
  for (const [name, f] of [...entries, ...langs]) if (!(f.url.startsWith('/data/') || f.url.startsWith(own)) || f.url.includes('..')) throw new Error(`${name}: an address outside this server's data`);
  const official = listed(index.bounds).find(([name]) => name === 'official')?.[1] ?? null;
  if (official && (!official.url.startsWith(own) || official.url.includes('..'))) throw new Error('bounds: an address outside this content set');
  const total = entries.reduce((n, [, f]) => n + (Number(f.bytes) || 0), 0);
  let loaded = 0;
  onProgress?.(0, total);
  const values = new Map();
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const [name, f] = entries[next++];
      values.set(name, await fetchChecked(f.url, f, { fetch: doFetch, retryDelays, wait, timeoutMs, onBytes: (n) => { loaded += n; onProgress?.(loaded, total); } }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONTENT_PARALLEL, entries.length) }, worker));
  const bounds = official ? await fetchChecked(official.url, official, { fetch: doFetch, retryDelays, wait, timeoutMs }) : null;
  if (official && (!isObj(bounds) || bounds.v !== 1)) throw new Error('bounds: not an official-bounds snapshot');
  const scripts = [];
  const scriptEntries = (index.plugins || []).filter(p => p.files?.['@script']).map(p => [p.id,index.scripts?.[p.id]]);
  if (scriptEntries.some(([,f]) => !isObj(f)) || scriptEntries.length !== listed(index.scripts).length) throw new Error('script list does not match cs');
  const sandbox = index.execution === 'sandbox';
  if (consent || sandbox) for (const [id,f] of scriptEntries) {
    if (f.url !== `${own}scripts/${id}.json` || index.plugins.find(p => p.id === id)?.files?.['@script'] !== f.sha256) throw new Error('script descriptor not pinned by cs');
    scripts.push(await fetchChecked(f.url,f,{fetch:doFetch,retryDelays,wait,timeoutMs}));
  }
  let nativeVerified = false;
  if (scripts.length) {
    const {verifyScripts,scriptExecution,checkBrowserScripts} = await import('../../shared/plugins/scriptLoad.js');
    verifyScripts(scripts,index);
    if (scriptExecution(scripts) !== (sandbox ? 'sandbox' : 'trusted')) throw new Error('script execution mode mismatch');
    if (!sandbox) { await checkBrowserScripts(scripts,cs,doFetch); nativeVerified = true; }
  }
  return { cs, index, values, bounds, scripts, nativeVerified, canSim: !listed(index.scripts).length || consent || sandbox };
}

/**
 * The content set the battle runner simulates on now (public/js/battle/runner.js): `{ cs, data, bounds }` of the checked
 * set the page holds, or null (the original content: the runner loads /data/ itself).
 */
export const simContent = () => (held && held.canSim !== false ? { scripts:held.scripts || [], hashInput:held.index, nativeVerified:held.nativeVerified,
  cs: held.cs, data: Object.fromEntries(held.values), bounds: held.bounds ?? null } : null);

/**
 * The content set `cs` once this page holds it — at once when it does, when its download is done when it is the one
 * loading; null when it failed, or when the room plays another (or none).
 * @param {string} cs
 * @returns {Promise<{ cs: string, data: Record<string, any>, bounds: any } | null>}
 */
export function contentFor(cs) {
  if (held && held.cs === cs) return Promise.resolve(simContent());
  const s = contentSet.get();
  if (s.cs !== cs || s.status !== 'loading') return Promise.resolve(null);
  return new Promise((resolve) => { const list = waiting.get(cs) || []; list.push(resolve); waiting.set(cs, list); });
}

/** Settle the pages waiting for `cs` (contentFor). */
function settleWaiting(cs) {
  for (const [key, list] of [...waiting]) {
    if (cs && key !== cs) continue;
    waiting.delete(key);
    const v = held && held.cs === key ? simContent() : null;
    for (const r of list) r(v);
  }
}

/**
 * Keep the page's data in step with the room's content set (header "The room's content set"). Returns the uninstall.
 * @param {{ store?: typeof appStore, data?: typeof dataStore, net?: { request: Function } | null, fetch?: typeof fetch,
 *   toast?: ((text: string, kind?: string) => void) | null, retryDelays?: readonly number[], wait?: (ms: number) => Promise<void> }} [opts]
 */
export function installContentSet({ store = appStore, data = dataStore, net = appNet, fetch: doFetch = defaultFetch, toast = null,
  retryDelays = CONTENT_RETRY_MS, wait = sleep } = {}) {
  let req = 0;
  let told = false;
  /** room.contentReady on its way (one at a time) and the cs it named */
  let telling = null;
  const roomCs = (s) => (s?.room?.content && s.room.content.vanilla === false && isContentHash(s.room.content.cs) ? s.room.content.cs : null);
  const mySeat = (s) => {
    const id = s?.me?.playerId;
    const room = s?.room;
    if (id == null || !room) return null;
    return (Array.isArray(room.seats) ? room.seats : []).find((x) => x && x.playerId === id)
      || (Array.isArray(room.spectators) ? room.spectators : []).find((x) => x && x.playerId === id) || null;
  };
  /** Tell the room what this page made of its content set — again when its seat does not show it (a reconnect). */
  const tell = (cs, ok) => {
    if (!net || telling === cs) return;
    telling = cs;
    Promise.resolve().then(() => net.request('room.contentReady', ok ? { cs } : { cs, ok: false }))
      .catch((err) => console.warn('[content] room.contentReady', err?.code || err))
      .finally(() => { if (telling === cs) telling = null; });
  };
  const drop = () => {
    req++;
    if (held) { held = null; data.setContent(null); }
    settleWaiting(null);
    if (contentSet.get().cs !== null || contentSet.get().status !== 'idle') contentSet.set({ cs: null, status: 'idle', loaded: 0, total: 0, error: null, kitted: null });
  };
  const load = (cs, consent = false) => {
    const mine = ++req;
    if (held) { held = null; data.setContent(null); }
    settleWaiting(null);
    contentSet.set({ cs, status: 'loading', loaded: 0, total: 0, error: null, kitted: null });
    loadContentSet(cs, { consent, fetch: doFetch, retryDelays, wait, onProgress: (loaded, total) => { if (mine === req) contentSet.set({ loaded, total }); } })
      .then(async (set) => {
        if (mine !== req) return;
        if (consent && set.scripts.length) {
          const {verifyScripts,scriptUrl} = await import('../../shared/plugins/scriptLoad.js');
          verifyScripts(set.scripts,set.index);
          for (const p of set.scripts) {
            const m = JSON.parse(p.manifestSource);
            if (m.entry?.client && !pageScripts.has(cs+':'+p.id)) {
              if (!set.nativeVerified) throw new Error('page script bytes not checked');
              await import(scriptUrl(cs,p.id,m.entry.client));
              pageScripts.add(cs+':'+p.id);
            }
          }
        }
        if (mine !== req) return;
        held = set;
        const i18n = isObj(set.index.i18n) ? set.index.i18n : {};
        // the set's own game texts per language (a plugin's operators named in it): checked like the data files
        const overlay = (lang) => (isObj(i18n[lang]) ? fetchChecked(i18n[lang].url, i18n[lang], { fetch: doFetch, retryDelays, wait }) : Promise.resolve(null));
        data.setContent({ id: cs, values: set.values, overlay, langs: Object.keys(i18n) });
        const extra = store.get()?.room?.content?.kittedExtra;
        contentSet.set({ status: 'ready', error: null, kitted: Array.isArray(extra) ? extra.filter((x) => typeof x === 'string').slice(0, 200) : null });
        settleWaiting(cs);
        if (set.canSim || !store.get()?.room?.seats?.some(s => s?.playerId === store.get()?.me?.playerId)) tell(cs, true);
      }).catch((err) => {
        if (mine !== req) return;
        console.warn(`[content] the room's content set ${cs.slice(0, 8)} did not load or check: ${err?.message || err}`);
        contentSet.set({ status: 'failed', error: String(err?.message || err).slice(0, 200) });
        settleWaiting(cs);
        if (!told && toast) { told = true; toast(t(CONTENT_FAILED), 'error'); }
        tell(cs, false);
      });
  };
  const sync = (s) => {
    const cs = roomCs(s);
    const cur = contentSet.get();
    if (!cs) { if (cur.cs || held) drop(); return; }
    const consent = !!s.room.content.trusted && hasScriptConsent(cs);
    if (cur.cs !== cs || (held?.cs === cs && held.canSim === false && consent)) { load(cs,consent); return; }
    // the page holds the room's set, its seat does not show it (the room changed its set and back, a reconnect): again
    const seat = mySeat(s);
    if (seat && cur.status === 'ready' && seat.content !== 'ready' && (!s.room.content.trusted || consent || !s.room.seats?.includes(seat))) tell(cs, true);
    else if (seat && cur.status === 'failed' && seat.content !== 'failed') tell(cs, false);
  };
  const off = store.subscribe((s) => sync(s));
  sync(store.get());
  if (typeof window !== 'undefined') globalThis.__SP_CONTENT__ = contentHooks();
  return () => { off(); drop(); };
}

/**
 * The page's introspection hooks (window.__SP_CONTENT__, like __SP_RUNNER__): `state()` — the content set as this page
 * has it — always; `forgeHeldCs(cs)` — a page that claims to hold another set than the one it checked, so the runner's
 * cs check can be watched refusing the authority (test/ui/plugins-content.e2e.test.js) — only in a dev build or a
 * browser under automation (navigator.webdriver: the browser tests' Chrome), never on a release page.
 * @param {{ dev?: boolean, nav?: { webdriver?: boolean } | null }} [opts]
 */
export function contentHooks({ dev = DEV_BUILD, nav = globalThis.navigator ?? null } = {}) {
  /** @type {{ state: () => object, forgeHeldCs?: (cs: string) => void }} */
  const hooks = { state: () => ({ ...contentSet.get(), held: held ? held.cs : null }) };
  if (dev || nav?.webdriver === true) hooks.forgeHeldCs = (cs) => { if (held && isContentHash(cs)) held = { ...held, cs }; };
  return hooks;
}

// Consent is this browser's explicit choice, independent of other seats and of server assertions.
const pageScripts = new Set(), pageConsent = new Set();
export function hasScriptConsent(cs, storage) {
  try { return pageConsent.has(cs) || (storage ?? globalThis.localStorage)?.getItem('sp.plugin.consent.'+cs) === 'yes'; } catch { return pageConsent.has(cs); }
}
export function rememberScriptConsent(cs, accept, storage) {
  if (accept) pageConsent.add(cs); else pageConsent.delete(cs);
  try { storage ??= globalThis.localStorage; if (accept) storage?.setItem('sp.plugin.consent.'+cs,'yes'); else storage?.removeItem('sp.plugin.consent.'+cs); } catch { /* storage unavailable */ }
}
