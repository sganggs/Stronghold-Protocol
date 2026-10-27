// Operator loadout + ownership + 自选编队 + 干员皮肤 state and server sync (DESIGN §16; 干员持有 — 0.2.0 补位; 自选编队 —
// 0.2.0 DIY; 干员皮肤 — docs/SKINS.md).
//
// `loadoutStore` holds the per-browser loadout (`entries`, persisted in localStorage through store.js savePref), the
// per-browser not-owned list of the 干员持有 tab (`notOwned`, likewise), the 自选编队 picks (`diy`, likewise; with
// `diyKitted` = the operators the server lets a DIY slot field, from every `welcome`) and the overlay's screen state
// (open / origin / tab / selection / filters). `installLoadoutSync()` / `installOwnershipSync()` / `installDiySync()` /
// `installSkinsSync()` / `installCardSync()` (called once by main.js) keep the server's copies current — one sync engine
// (installPrefSync), five settings (the fifth, room.card — the 名片干员 of ui/seatArt.js —, is described at
// installCardSync): after every `welcome` (new or resumed
// session — the server keeps them on the session and on the seat, so joining a room needs no resend) and after every
// edit (debounced; a pending edit goes out at once when the overlay closes), they send `room.loadout { entries, ops }`
// (sanitised against the loaded data/chess.json: ui/loadoutModel.js sanitizeEntries — a stale entry is dropped, never
// the whole loadout; `ops` = the per-operator 潜能 / 练度 of 0.2.2, sanitizeOps against chess.json + backups.json), `room.ownership { notOwned }` (sent as stored: the server keeps the droppable chess and drops
// the rest, so no data is needed), `room.diy { picks }` (sent as stored, structurally clean: the server keeps the
// legal picks) and `room.skins { skins }` (ui/skins.js' own store; sent as stored, since an appearance lives in a
// cosmetic plugin's overlay and can only fail to resolve — and unlike the three above it is accepted in ANY phase, so a
// match takes it at once). Replies: RATE → retried later; WRONG_PHASE / ROOM_STARTED → the running match keeps what it
// took (the loadout locks when INFO_CHECK ends; the ownership and the 自选 picks never change during a match) — stored
// for the next match, not an error for the player; anything else is logged. `sync` / `ownSync` / `diySync` /
// `skinsSync` ∈ 'idle' | 'pending' | 'sending' | 'synced' | 'locked' | 'error' are mirrored into the store for the
// screen's status line.
// A room with gameplay plugins (DESIGN §32.6): data.js then shows the room's content set, so what goes out is checked
// against the room's data (its operators too); the stored settings keep every entry — one the room does not know is
// only left out of what is sent, never deleted. Whenever the room's content set arrives or goes (content.js contentSet)
// the three settings are sent again, and the 自选 picker's list (`diyKitted`) is the set's own (else welcome's).
// Official versions (DESIGN §35.23, M1): the loadout and the 干员持有 list are stored by operator (charId: `byChar`,
// `notOwnedChars` — every version reuses chess ids for other operators) and shown as views by the chess ids of the data
// on screen (`entries`, `notOwned`: refreshViews, rebuilt whenever that data changes — installSettingsViews); an edit is
// written back through the map of the view it was made on (setEntries / setNotOwned `base`). A v1 store is migrated
// through 第二期下半's chess.json (migrateSettings; nothing is sent before). The 自选 picks are the version's own
// (diyModel.js diyPrefKey). Every sync waits for the data the server checks against (canSendSettings): never while the
// page's content loads, in a room once the room's content is on the page, outside a room only on the server's default
// version (第二期下半's own files unless welcome.versions names another default);
// a room entered after the lobby could not send them sends them then (not at every room entry: the server keeps the
// session's copy, and the heavy-message budget is an edit's too).

import { createStore, loadPref, savePref, store } from '../store.js';
import { data, buildIndex } from '../data.js';
import { contentSet as appContentSet, pageVersion } from '../content.js';
import { LOADOUT_PREF, parseStored, parseStoredOps, parseStoredByChar, toStored, toStoredV1, sanitizeEntries, sanitizeOps, charKeyMap, entriesToChar,
  entriesView, rebaseByChar } from './loadoutModel.js';
import { cultivationCharIds, charPotentialChanges, loadoutOptions, operatorCharIds } from '../../../shared/protocol.js';
import { PHASE } from '../../../shared/constants.js';
import { POTENTIAL_DEFAULT, CULTIVATE_DEFAULT } from '../../../shared/potential.js';
import { ruleOption } from '../../../shared/plugins/rules.js';
import { OWNERSHIP_PREF, parseStoredOwnership, parseStoredOwnershipChars, toStoredOwnership, toStoredOwnershipV1, cleanIds, sanitizeNotOwned,
  notOwnedView, rebaseChars } from './ownershipModel.js';
import { parseStoredDiy, toStoredDiy, cleanPicks, sanitizeDiyPicks, diyPrefKey } from './diyModel.js';
import { skinsStore, SKINS_KEY, SKINS_SYNC_KEY, parseStoredSkins } from './skins.js';
import { cardStore, CARD_KEY, CARD_SYNC_KEY, cardOperators } from './seatArt.js';
import { needsContent, serverDefaultVersion } from '../versions.js';
import { DEFAULT_VERSION } from '../../../shared/versions.js';
import { toast } from './toasts.js';
import { t, N_ } from '../../../shared/i18n.js';

export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;

const readPref = (key) => { try { return loadPref(key, null); } catch { return null; } };
const storedLoadout = readPref(LOADOUT_PREF);
const storedOwnership = readPref(OWNERSHIP_PREF);
/** A v1 store's choices / list (by 第二期下半's chess ids) — null when the store is v2 or empty (nothing to migrate). */
const legacyEntries = (() => { if (storedLoadout?.v === 2) return null; const e = parseStored(storedLoadout); return Object.keys(e).length ? e : null; })();
const legacyNotOwned = (() => { if (storedOwnership?.v === 2) return null; const l = parseStoredOwnership(storedOwnership); return l.length ? l : null; })();
function readStoredOps() {
  try { return parseStoredOps(storedLoadout); } catch { return {}; }
}
function readStoredDiy(version = DEFAULT_VERSION) {
  try { return parseStoredDiy(loadPref(diyPrefKey(version), null)); } catch { return {}; }
}

/**
 * Loadout + ownership + screen state (separate from the app store: it must survive room / match resets). By operator
 * (DESIGN §35.23): `byChar` / `notOwnedChars` are the stored settings (null while a v1 store waits for its migration);
 * `entries` / `notOwned` are their views by the chess ids of the data on screen (what the screens and the sync read);
 * `diy` is the picks of the version on screen (`diyVersion`).
 */
export const loadoutStore = createStore({
  entries: legacyEntries || {},
  byChar: legacyEntries ? null : parseStoredByChar(storedLoadout),
  ops: readStoredOps(), // 0.2.2 潜能 / 练度: { [charId]: { potential?, cultivate? } } ({} = every operator 潜能 6, 精英2 Lv.60)
  notOwned: legacyNotOwned || [], // 干员持有: base chess ids marked 未持有 (sorted; [] = every operator owned) — the view
  notOwnedChars: legacyNotOwned ? null : parseStoredOwnershipChars(storedOwnership),
  diy: readStoredDiy(), // 自选编队: { [slotBaseId]: { charId, skillIndex?, uniEquipId? } } ({} = every slot empty)
  diyVersion: DEFAULT_VERSION,
  diyKitted: null,     // the operators a DIY slot may field (welcome.diyKitted; null before the first welcome)
  open: false,
  from: null,          // 'lobby' | 'room' | 'briefing' | 'prep'
  tab: 'loadout',      // 'loadout' (干员调配) | 'ownership' (干员持有) | 'diy' (自选编队)
  sel: null,           // selected base chess id
  filters: { tier: null, prof: null, bond: null, query: '', changedOnly: false },
  sync: 'idle',
  ownSync: 'idle',
  diySync: 'idle',
});

// ---- by operator: views, migration (DESIGN §35.23) --------------------------------------------------------------------

/** The charKeyMap a view was built from (view object → map): an edit is written back through it. */
const viewMaps = new WeakMap();
let shownMap = { raw: null, map: null };
/** charKeyMap of the chess on screen (data.js `chess` as downloaded), or null before it is loaded. */
export function shownCharMap() {
  const raw = data.getRaw('chess');
  if (!raw) return null;
  if (shownMap.raw !== raw) shownMap = { raw, map: charKeyMap([...buildIndex('chess', raw).values()]) };
  return shownMap.map;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Rebuild the views for the data on screen (`entries` / `notOwned` from byChar / notOwnedChars, `diy` from the version's
 * own key) — whenever the shown data changes (installSettingsViews) and before a send (the sync's prepare).
 * @param {{ target?: typeof loadoutStore }} [opts]
 */
export function refreshViews({ target = loadoutStore } = {}) {
  const s = target.get();
  const patch = {};
  const map = shownCharMap();
  if (map && s.byChar) {
    const view = entriesView(s.byChar, map);
    if (!same(view, s.entries)) patch.entries = view;
    viewMaps.set(patch.entries || s.entries, map);
  }
  if (map && s.notOwnedChars) {
    const view = notOwnedView(s.notOwnedChars, map);
    if (!same(view, s.notOwned)) patch.notOwned = view;
    viewMaps.set(patch.notOwned || s.notOwned, map);
  }
  const version = pageVersion();
  if (version !== s.diyVersion) { patch.diy = readStoredDiy(version); patch.diyVersion = version; }
  if (Object.keys(patch).length) target.set(patch);
}

/** 第二期下半's chess → charId (the v1 migration and a v1 import), fetched once directly — never through data.js, which may show another version. */
let defaultMapLoad = null;
let defaultMap = null;
/** @param {{ fetch?: typeof fetch }} [opts] @returns {Promise<{ toChar: Map<string, string>, toChess: Map<string, string> } | null>} */
export function loadDefaultCharMap({ fetch: doFetch = (...a) => globalThis.fetch(...a) } = {}) {
  if (defaultMap) return Promise.resolve(defaultMap);
  if (!defaultMapLoad) {
    defaultMapLoad = (async () => {
      try {
        const res = await doFetch('/data/chess.json', { cache: 'default' });
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '???'}`);
        defaultMap = charKeyMap([...buildIndex('chess', await res.json()).values()]);
        return defaultMap;
      } catch (err) {
        console.warn('[loadout] 第二期下半 chess.json unavailable for the settings by operator', err?.message || err); // i18n-ignore (log)
        return null;
      } finally { defaultMapLoad = null; }
    })();
  }
  return defaultMapLoad;
}
/** The map loaded so far (null until loadDefaultCharMap resolved). */
export const defaultCharMap = () => defaultMap;

/**
 * The v1 copy a v2 store also carries for older builds (ui/loadoutModel.js toStored, ownershipModel.js toStoredOwnership):
 * the settings by 第二期下半's chess ids through its map when the page has it (loaded for the migration or a v1 import, or
 * the server's own files on screen), else the copy stored before (undefined when there is none).
 * @param {string} key @param {string} field @param {(map: { toChar: Map<string, string>, toChess: Map<string, string> }) => any} view
 */
function legacyCopy(key, field, view) {
  const map = defaultCharMap() || (appContentSet.get().kind == null ? shownCharMap() : null);
  if (map) return view(map);
  const prev = readPref(key);
  return prev && prev.v === 2 && prev[field] != null ? prev[field] : undefined;
}
const storeLoadout = (byChar, ops) => savePref(LOADOUT_PREF, toStored(byChar, ops, legacyCopy(LOADOUT_PREF, 'entries', (m) => entriesView(byChar, m))));
const storeOwnership = (chars) => savePref(OWNERSHIP_PREF, toStoredOwnership(chars, legacyCopy(OWNERSHIP_PREF, 'notOwned', (m) => notOwnedView(chars, m))));
/**
 * A v1 id that is its operator's own chess in 第二期下半 (toChess(toChar(id)) === id): two operators also have a hidden
 * droppable chess there (chess_char_5_18_a, chess_char_6_10_a — the visible ones of 第二期上半), and a mark on it, which
 * showed nothing before, must not become a mark on the visible chess of that operator.
 * @param {{ toChar: Map<string, string>, toChess: Map<string, string> }} map
 */
const ownChessOf = (map) => (id) => map.toChess.get(map.toChar.get(id)) === id;

let migration = null;
/**
 * Migrate a v1 store (chess ids of 第二期下半) to v2 by operator (see the header of ui/loadoutModel.js): resolves true
 * once both settings are by operator (at once when they are), false when 第二期下半's chess.json is unavailable (the v1
 * store stays; the next call tries again). Nothing is sent before it settles (the sync's prepare waits).
 * @param {{ fetch?: typeof fetch, target?: typeof loadoutStore }} [opts]
 */
export function migrateSettings({ fetch: doFetch, target = loadoutStore } = {}) {
  const s = target.get();
  if (s.byChar && s.notOwnedChars) return Promise.resolve(true);
  if (migration) return migration;
  migration = loadDefaultCharMap(doFetch ? { fetch: doFetch } : {}).then((map) => {
    migration = null;
    if (!map) return false;
    const cur = target.get();
    const charOf = (id) => map.toChar.get(id);
    const patch = {};
    if (!cur.byChar) {
      patch.byChar = entriesToChar(cur.entries, charOf, ownChessOf(map));
      storeLoadout(patch.byChar, cur.ops);
    }
    if (!cur.notOwnedChars) {
      patch.notOwnedChars = cleanIds(cur.notOwned.filter(ownChessOf(map)).map(charOf).filter(Boolean));
      storeOwnership(patch.notOwnedChars);
    }
    target.set(patch);
    if (target === loadoutStore) refreshViews({ target });
    return true;
  });
  return migration;
}

/**
 * Keep the views in step with the data on screen (main.js, once): every change of the chess or the config data (a
 * version set, a gameplay plugin room's set, the server's files again). Returns the uninstall.
 */
export function installSettingsViews() {
  const off = data.subscribe((name) => { if (name === 'chess' || name === 'config') refreshViews(); });
  void migrateSettings();
  refreshViews();
  return off;
}

/** The charId of a chess id: the view's map, else `lookup` (a caller's chess lookup), else the data on screen. */
function charOfFor(map, lookup) {
  return (id) => map?.toChar?.get(id) ?? (lookup ? lookup(id)?.charId : null) ?? data.lookupRaw('chess', id)?.charId ?? null;
}

function persistLoadout(s) {
  if (s.byChar) storeLoadout(s.byChar, s.ops); else savePref(LOADOUT_PREF, toStoredV1(s.entries, s.ops));
}

/**
 * Replace the stored entries (persisted at once with the settings; the sync picks the change up). `next` is keyed by the
 * chess ids of the view it was edited from (`base`, the current view by default): written back by operator through
 * that view's map — an edit of a view that is no longer on screen (the data changed meanwhile) is re-based, never
 * filed under another version's operator. `lookup`: a chess lookup for ids the map lacks (an import).
 * @param {Record<string, any>} entries @param {{ base?: Record<string, any>, lookup?: (id: string) => any }} [opts]
 */
export function setEntries(entries, { base, lookup } = {}) {
  const next = entries && typeof entries === 'object' ? entries : {};
  const s = loadoutStore.get();
  const from = base || s.entries;
  if (!s.byChar) {
    // a v1 store still waiting for its migration: by chess id, as before
    savePref(LOADOUT_PREF, toStoredV1(next, s.ops));
    loadoutStore.set({ entries: next });
    return;
  }
  const map = viewMaps.get(from) || (from === s.entries ? shownCharMap() : null);
  const byChar = rebaseByChar(s.byChar, from, next, charOfFor(map, lookup));
  storeLoadout(byChar, s.ops);
  if (from === s.entries) {
    if (map) viewMaps.set(next, map);
    loadoutStore.set({ entries: next, byChar });
  } else {
    loadoutStore.set({ byChar });
    refreshViews();
  }
}

/** Replace the stored per-operator 潜能 / 练度 (0.2.2; persisted at once with the entries; the sync picks it up). */
export function setOpsMap(ops) {
  const next = ops && typeof ops === 'object' ? ops : {};
  persistLoadout({ ...loadoutStore.get(), ops: next });
  loadoutStore.set({ ops: next });
}

/**
 * The choices by operator of an import as entries of the view on screen (DESIGN §35.23): a v2 payload's `byChar`
 * through the shown data's map, a v1 payload's `entries` (第二期下半's chess ids) through 第二期下半's map — loaded by
 * openLoadout; until then (and on the server's own files, where the ids are the same) as they are.
 * @param {{ entries?: Record<string, any>, byChar?: Record<string, any> }} parsed ui/loadoutModel.js parseImport's result
 * @param {string} [version] the version on screen (content.js pageVersion; tests give it)
 */
export function importedEntries(parsed, version = pageVersion()) {
  const map = shownCharMap();
  if (parsed?.byChar) return map ? entriesView(parsed.byChar, map) : {};
  const entries = parsed?.entries || {};
  const def = defaultCharMap();
  if (!map || !def || version === DEFAULT_VERSION) return entries;
  return entriesView(entriesToChar(entries, (id) => def.toChar.get(id), ownChessOf(def)), map);
}

/** Like importedEntries for a 干员持有 import: chess ids of the view on screen. @param {{ notOwned?: string[], notOwnedChars?: string[] }} parsed */
export function importedNotOwned(parsed) {
  const map = shownCharMap();
  if (parsed?.notOwnedChars) return map ? notOwnedView(parsed.notOwnedChars, map) : [];
  const def = defaultCharMap();
  // a v1 list's hidden chess (see ownChessOf) is dropped, here too on 第二期下半: setNotOwned would file it under the operator
  const list = (parsed?.notOwned || []).filter((id) => !def || !def.toChar.has(id) || ownChessOf(def)(id));
  if (!map || !def || pageVersion() === DEFAULT_VERSION) return list;
  return notOwnedView(list.map((id) => def.toChar.get(id)).filter(Boolean), map);
}

/**
 * Apply a parsed entry map (an imported preset). Sanitised against the loaded data first, then persisted and synced
 * like any ordinary edit — so a preset from another build never sends the server an entry it would refuse. An import
 * that keeps nothing (every chess unknown, or every choice already the default) changes NOTHING: wiping the current
 * loadout over it would be a loss the player never asked for.
 * With `ops` (an import that carries the per-operator 潜能 / 练度, 0.2.2: `isOperator` from the loaded data) those are
 * sanitised and replace the current ones as well; without, the current ones stay.
 * @param {Record<string, any>} entries `parseImport(...).entries` (chess ids of the data on screen: importedEntries)
 * @param {(id: string) => any} lookup chess lookup
 * @param {{ ops?: Record<string, any>|null, isOperator?: (charId: string) => boolean }} [o]
 * @returns {{ applied: number, dropped: number, ops?: number }} entries kept / entries (and settings) not imported / settings
 *   kept (only with `ops`)
 */
export function applyLoadoutEntries(entries, lookup, { ops = null, isOperator = null } = {}) {
  const asked = Object.keys(entries || {}).length;
  const clean = sanitizeEntries(entries, lookup);
  const applied = Object.keys(clean).length;
  const cleanOps = ops && isOperator ? sanitizeOps(ops, isOperator) : null;
  const nOps = cleanOps ? Object.keys(cleanOps).length : 0;
  const askedOps = ops ? Object.keys(ops).length : 0;
  if (applied || nOps) {
    if (cleanOps) loadoutStore.set({ ops: cleanOps });
    setEntries(applied ? clean : loadoutStore.get().entries, { lookup });
  }
  const dropped = Math.max(0, asked - applied) + Math.max(0, askedOps - nOps);
  return cleanOps ? { applied, dropped, ops: nOps } : { applied, dropped };
}

/**
 * Replace the stored not-owned list (干员持有; persisted at once, the sync picks the change up) — chess ids of the view
 * it was edited from (`base`), written back by operator like setEntries.
 * @param {string[]} list @param {{ base?: string[], lookup?: (id: string) => any }} [opts]
 */
export function setNotOwned(list, { base, lookup } = {}) {
  const next = cleanIds(list);
  const s = loadoutStore.get();
  const from = base || s.notOwned;
  if (!s.notOwnedChars) {
    savePref(OWNERSHIP_PREF, toStoredOwnershipV1(next));
    loadoutStore.set({ notOwned: next });
    return;
  }
  const map = viewMaps.get(from) || (from === s.notOwned ? shownCharMap() : null);
  const chars = rebaseChars(s.notOwnedChars, from, next, charOfFor(map, lookup));
  storeOwnership(chars);
  if (from === s.notOwned) {
    if (map) viewMaps.set(next, map);
    loadoutStore.set({ notOwned: next, notOwnedChars: chars });
  } else {
    loadoutStore.set({ notOwnedChars: chars });
    refreshViews();
  }
}

/**
 * Apply an imported not-owned list (chess ids of the data on screen: importedNotOwned), sanitised against the loaded
 * data (droppable chess only), persisted and synced like an edit. An empty list is a valid import (= every operator owned).
 * @param {string[]} list @param {(id: string) => any} lookup chess lookup
 * @returns {{ applied: number, dropped: number }}
 */
export function applyOwnershipImport(list, lookup) {
  const asked = cleanIds(list).length;
  const clean = sanitizeNotOwned(list, lookup);
  setNotOwned(clean, { lookup });
  return { applied: clean.length, dropped: Math.max(0, asked - clean.length) };
}

/** Replace the stored 自选编队 picks of the version on screen (its own key: diyModel.js diyPrefKey; the sync picks the change up). */
export function setDiyPicks(picks) {
  const next = cleanPicks(picks);
  try { savePref(diyPrefKey(loadoutStore.get().diyVersion), toStoredDiy(next)); } catch { /* private mode: the session keeps it */ }
  loadoutStore.set({ diy: next });
}

/**
 * Apply an imported roster (parseDiyImport(...).picks), sanitised against the loaded data and the kit list (the picks
 * the server would keep), persisted and synced like an edit. An empty roster is a valid import (= every slot empty).
 * @param {Record<string, any>} picks @param {any} data `{ chess, backups }` @param {Iterable<string>|null} kitted
 * @returns {{ applied: number, dropped: number }}
 */
export function applyDiyImport(picks, data, kitted) {
  const asked = Object.keys(cleanPicks(picks)).length;
  const clean = sanitizeDiyPicks(picks, data, kitted);
  setDiyPicks(clean);
  const applied = Object.keys(clean).length;
  return { applied, dropped: Math.max(0, asked - applied) };
}

/**
 * Open the 干员调配 overlay. @param {'lobby'|'room'|'briefing'|'prep'} from @param {string|null} [sel]
 * @param {'loadout'|'ownership'|'diy'|null} [tab] the tab to show (default: the last one)
 */
export function openLoadout(from = 'lobby', sel = null, tab = null) {
  data.load('chess');
  data.load('bonds');
  data.load('assets');
  data.load('local');
  data.load('backups');
  data.load('effects'); // 0.2.2: the 练度 multipliers of the 局内数值 (effects.json CHAR_MAP)
  data.load('garrisons'); // the 特质 at the top of the detail (PR #301)
  void loadDefaultCharMap(); // a v1 导入 (第二期下半's chess ids) maps through it (DESIGN §35.23)
  loadoutStore.set({ open: true, from, ...(sel ? { sel } : {}), ...(from === 'prep' ? { tab: 'loadout', sync: 'idle' } : {}), ...(tab === 'loadout' || tab === 'ownership' || tab === 'diy' ? { tab } : {}) });
}
export const closeLoadout = () => loadoutStore.set({ open: false });

/**
 * Whether the page may send its settings now (DESIGN §35.23; the server checks them against the data of the room, or
 * outside a room against the server's default version's — lobby.js dataFor / csOf: 第二期下半's own files unless
 * welcome.versions names another default): never while the page's content is loading; in a room once the room's content
 * is on the page (its version or plugin set checked, or a room of the server's own files showing them); outside a room
 * only while the page shows the server's default version (its own files, or that version's checked set).
 * @param {{ store?: typeof store, content?: typeof appContentSet, contentId?: () => string|null }} [deps]
 */
export function canSendSettings({ store: app = store, content = appContentSet, contentId = () => data.contentId() } = {}) {
  const c = content?.get?.();
  if (c && c.status === 'loading') return false;
  const room = app?.get?.()?.room;
  if (room && needsContent(room)) return !!c && c.status === 'ready' && c.cs === room.content?.cs && contentId() === c.cs;
  if (!room) {
    // A server whose default is another version checks outside-room settings against that version's data.
    const s = app?.get?.();
    const def = serverDefaultVersion(s);
    if (def !== DEFAULT_VERSION) {
      const entry = Array.isArray(s?.versions) ? s.versions.find((e) => e.id === def) : null;
      return !!c && !!entry && c.status === 'ready' && c.kind === 'version' && c.version === def && c.cs === entry.cs && contentId() === c.cs;
    }
  }
  return contentId() == null;
}

/**
 * One setting kept in sync with the server (see the header): `key` = the store field (or a list of them: the loadout's
 * `entries` and `ops`), `stateKey` = its sync state field, `msgType` / `field` = the C2S message (`field` null: the payload
 * is the message body), `prepare()` → the payload to send (may await data; null = the data is missing: nothing is sent,
 * state 'error'), `lockedText` = what a refused edit tells the player. `seatBound` (default true): the server keeps the
 * setting per room data — it checks it against the room's content and drops it on a version switch —, so a content
 * change sends it again; false (skins, the card: their payload follows the data on screen — the skins filtered to its
 * operators, the card '' when it lacks the operator — so it changes whenever what the server keeps would) sends it on a
 * content change only when the payload changed (a version switch or a room's arrival then spends no heavy-message budget
 * on them).
 */
function installPrefSync({ net, timers, target, notify, key, stateKey, msgType, field, prepare, lockedText, tag, content = appContentSet, gate = null, app = store, seatBound = true }) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  // (`lockedText` is a msgid: the toast is translated when it shows — docs/I18N.md)
  const tell = notify || ((text) => toast(t(text), 'warn'));
  let timer = null;
  let seq = 0;            // requests sent (the reply of an older one never overrides a newer one's state)
  let revision = 0;       // edits and welcome invalidate a preparation still awaiting game data (GitHub #540)
  let pendingJson = null; // JSON of the newest request still awaiting its reply
  let lastSent = null;    // JSON of the last payload the server accepted (on this session)
  let edited = false;     // an edit is waiting to be sent (a lock refusal is then worth telling the player)
  let disposed = false;
  let gated = false;      // the last send waited for the data the server checks against (canSendSettings)

  const setState = (sync) => { if (target.get()[stateKey] !== sync) target.set({ [stateKey]: sync }); };

  const schedule = (ms = SYNC_DEBOUNCE_MS) => {
    if (disposed) return;
    T.clearTimeout(timer);
    setState('pending');
    timer = T.setTimeout(() => { timer = null; void flush(); }, ms);
  };

  // Review fix: a send is never held back behind one still in flight. The socket is ordered and the server applies
  // the frames in order, so the newest payload always wins; holding the edit until the previous reply arrived let a
  // click right after closing the overlay (准备就绪 → INFO_CHECK ends) overtake it, and the edit silently missed the match.
  async function flush() {
    if (disposed) return;
    if (net.status !== 'online') { setState('idle'); return; } // the next welcome resends
    // the data the server checks against is not on the page (yet): the content's arrival sends it (DESIGN §35.23)
    if (!(gate || canSendSettings)({ store: app, content })) { gated = true; setState('idle'); return; }
    gated = false;
    const preparing = revision;
    try {
      const payload = await prepare();
      // a newer edit or welcome happened while prepare awaited chess/backups: do not send, and do not touch the
      // sync state that newer flush owns (an older skill must not overwrite a restore-defaults)
      if (disposed || preparing !== revision) return;
      // never sanitise against missing data: every entry would be dropped and the server's copy cleared
      if (payload == null) { setState('error'); return; }
      const json = JSON.stringify(payload);
      if (json === pendingJson) return; // the same content is already on its way
      if (json === lastSent && pendingJson == null) { edited = false; setState('synced'); return; }
      const my = ++seq;
      const wasEdit = edited;
      edited = false;
      pendingJson = json;
      setState('sending');
      try {
        await net.request(msgType, field ? { [field]: payload } : payload);
        if (my !== seq) return;
        pendingJson = null;
        lastSent = json;
        setState('synced');
      } catch (err) {
        if (my !== seq) return;
        pendingJson = null;
        const code = err && err.code;
        if (code === 'WRONG_PHASE' || code === 'ROOM_STARTED') {
          // the server stored it for the next match; the running one keeps what it took
          lastSent = json;
          setState('locked');
          if (wasEdit && lockedText) tell(lockedText);
        } else if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { edited = edited || wasEdit; schedule(RETRY_MS); }
        else { console.warn(`[${tag}] ${msgType} refused`, code, err && err.detail); setState('error'); }
      }
    } catch (e) {
      if (disposed || preparing !== revision) return;
      console.warn(`[${tag}] sync failed`, e);
      setState('error');
    }
  }

  const offWelcome = net.on('welcome', () => { revision++; lastSent = null; pendingJson = null; seq++; schedule(50); });
  const keys = Array.isArray(key) ? key : [key];
  const offStore = target.subscribe((s, prev) => {
    if (keys.some((k) => s[k] !== prev[k])) { revision++; edited = true; schedule(); }
    // closing the overlay sends a pending edit at once (review fix): the player's next click — 准备就绪 in the solo
    // briefing, 开始模拟 in the room — must not overtake the debounced message (the match locks its loadout when
    // INFO_CHECK ends, so a late edit would silently only apply to the next match). Same socket ⇒ ordered.
    if (prev.open && !s.open && timer != null) { T.clearTimeout(timer); timer = null; void flush(); }
  });
  // a match leaving INFO_CHECK locks the loadout; a new match (the room back in LOBBY / a new INFO_CHECK) accepts it again
  const offRoom = net.on('room.state', (msg) => { if (msg && !msg.inMatch && target.get()[stateKey] === 'locked') { lastSent = null; schedule(); } });
  // entering a room (DESIGN §35.23) after the lobby could not send them (another version on screen there): sent now.
  // (A room of another version sends them once its content arrives — below —; otherwise the server keeps the session's
  // copy, and five settings sent at every room entry would spend the server's heavy-message budget an edit needs.)
  let roomCode = app?.get?.()?.room?.code ?? null;
  const offApp = app?.subscribe ? app.subscribe((s) => {
    const code = s?.room?.code ?? null;
    if (code === roomCode) return;
    roomCode = code;
    if (code && gated) { revision++; lastSent = null; schedule(50); }
  }) : null;
  // the room's content set arrived or went (DESIGN §32.6): sent again, checked against the data the room plays now (a
  // setting that is not seat-bound only when its payload changed: `seatBound`)
  let contentKey = content ? `${content.get().cs}|${content.get().status}` : '';
  const offContent = content ? content.subscribe((c) => {
    const k = `${c.cs}|${c.status}`;
    if (k === contentKey) return;
    contentKey = k;
    if (c.status === 'ready' || c.status === 'idle') { revision++; if (seatBound) lastSent = null; schedule(50); }
  }) : null;

  return {
    flush,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      offWelcome?.();
      offStore?.();
      offRoom?.();
      offApp?.();
      offContent?.();
    },
  };
}

/**
 * Wire the loadout sync once. Dependencies are injectable for tests.
 * @param {{ net: any, getChessReady?: () => Promise<any>, lookupChess?: (id: string) => any,
 *   timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore> }} deps
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installLoadoutSync({ net, getChessReady, getBackupsReady, lookupChess, operatorIds, timers, target = loadoutStore, notify, matchState = () => store.get(),
  content = appContentSet, app = store, gate = null } = {}) {
  const ready = getChessReady || (() => data.load('chess'));
  const readyBackups = getBackupsReady || (() => data.load('backups'));
  const lookup = lookupChess || ((id) => data.lookup('chess', id));
  // the operators a 潜能 / 练度 may name (shared/protocol.js cultivationCharIds: the roster + the 自选 owned pool)
  const opIds = operatorIds || (() => cultivationCharIds(data.get('chess'), data.get('backups')));
  return installPrefSync({
    net, timers, target, notify, content, app, gate, key: ['entries', 'ops'], stateKey: 'sync', msgType: 'room.loadout', field: null, tag: 'loadout',
    lockedText: N_('本局的干员调配已锁定，修改将在下一局生效'),
    async prepare() {
      // by operator (DESIGN §35.23): a v1 store migrates first; the view is rebuilt for the data on screen
      if (target === loadoutStore) { await migrateSettings(); await ready(); refreshViews(); }
      // a v1 store that could not migrate holds 第二期下半's chess ids: never sent against another version's data
      const unmapped = target === loadoutStore && !target.get().byChar && pageVersion() !== DEFAULT_VERSION;
      const current = unmapped ? {} : target.get().entries;
      const ops = target.get().ops;
      const state = matchState();
      const prep = state.match?.public?.phase === PHASE.PREP && ruleOption(state.room?.content?.rules, 'prepLoadout') === 'prep';
      const live = prep ? state.match?.private : null;
      const hasOps = (!!ops && Object.keys(ops).length > 0) || !!Object.keys(live?.ops || {}).length;
      // an empty loadout needs no data (nothing to sanitise): a player who never opened 干员调配 does not download
      // chess.json in the lobby just for this
      if ((!current || Object.keys(current).length === 0) && !Object.keys(live?.loadout || {}).length && !hasOps) return { entries: {}, ops: {} };
      const loaded = await ready();
      if (loaded == null) return null;
      const entries = sanitizeEntries(current, lookup);
      // A prep submission merges by name. Send explicit defaults for removed choices so restoring defaults works.
      if (live) for (const id of Object.keys(live.loadout || {})) {
        if (Object.hasOwn(entries, id)) continue;
        const base = lookup(id);
        if (!base) continue;
        const opt = loadoutOptions(base, base.goldenId ? lookup(base.goldenId) : null);
        entries[id] = { skill: opt.defaultSkill, ...(typeof opt.defaultModule === 'string' ? { module: opt.defaultModule } : {}) };
      }
      if (!hasOps) return { entries, ops: {} };
      if ((await readyBackups()) == null) return null;
      const ids = opIds();
      const cleanOps = sanitizeOps(target.get().ops, (id) => ids.has(id), (id) => charPotentialChanges({ chess: data.get('chess'), backups: data.get('backups') }, id));
      if (live) for (const id of Object.keys(live.ops || {})) if (ids.has(id) && !Object.hasOwn(cleanOps, id)) cleanOps[id] = { potential: POTENTIAL_DEFAULT, cultivate: CULTIVATE_DEFAULT };
      return { entries, ops: cleanOps };
    },
  });
}

/**
 * Wire the 干员持有 sync once (0.2.0 补位): `room.ownership { notOwned }` after every welcome and edit. The list goes as
 * stored (structurally clean); the server keeps its droppable chess. During a match the server stores it for the next
 * one (ROOM_STARTED → 'locked'): the setting is out of match.
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore>,
 *   notify?: (text: string) => void }} deps
 */
export function installOwnershipSync({ net, timers, target = loadoutStore, notify, content = appContentSet, app = store, gate = null } = {}) {
  return installPrefSync({
    net, timers, target, notify, content, app, gate, key: 'notOwned', stateKey: 'ownSync', msgType: 'room.ownership', field: 'notOwned', tag: 'ownership',
    lockedText: N_('干员持有是局外设置，修改将在下一局生效'),
    async prepare() {
      if (target === loadoutStore) {
        await migrateSettings();
        // the view by the chess ids of the data on screen (the server checks them against it)
        if (target.get().notOwnedChars?.length) await data.load('chess');
        refreshViews();
        if (!target.get().notOwnedChars && pageVersion() !== DEFAULT_VERSION) return [];
      }
      return cleanIds(target.get().notOwned);
    },
  });
}

/**
 * Wire the 干员皮肤 sync once (docs/SKINS.md): `room.skins { skins }` after every welcome and edit, from `skinsStore`
 * (ui/skins.js — its own store, like the loadout's: a skin choice belongs to no screen).
 *
 * The selection goes as stored, structurally clean (ui/skins.js parseStoredSkins): the appearance it names lives in a
 * cosmetic plugin's overlay, which is no part of the room's content set, so there is nothing to check it against — an
 * unknown id can only fail to resolve in `spineEntry()` and draw the default model. During a match the server takes it
 * at once (`Match.setSkins`, any phase: a skin is cosmetic and public) instead of storing it for the next one, so the
 * one refusal that can still arrive is 'locked' — a build whose server predates the message.
 *
 * The server keeps only the operators of the data the room plays (server/lobby.js skins: operatorCharIds), on the
 * session too, so the map goes filtered to the operators of the data on screen (the same set): a content change that
 * changes the kept set (a 第一期-only operator's skin on joining or switching to a 第一期 room, a plugin operator's)
 * changes the payload and is sent; one that does not spends no heavy-message budget (`seatBound: false`). Without the data
 * (it failed to load) the map goes whole and the server filters it.
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore>,
 *   notify?: (text: string) => void, operatorsReady?: () => Promise<Set<string>|null> }} deps
 */
export function installSkinsSync({ net, timers, target = skinsStore, notify, content = appContentSet, app = store, gate = null, operatorsReady } = {}) {
  const operators = operatorsReady || (async () => {
    const [chess, backups] = await Promise.all([data.load('chess'), data.load('backups')]);
    return chess == null || backups == null ? null : operatorCharIds({ chess: data.getRaw('chess'), backups: data.getRaw('backups') });
  });
  return installPrefSync({
    net, timers, target, notify, content, app, gate, seatBound: false, key: SKINS_KEY, stateKey: SKINS_SYNC_KEY, msgType: 'room.skins', field: 'skins', tag: 'skins',
    lockedText: N_('这台服务器不接受皮肤选择，只有本机保存'),
    async prepare() {
      const all = parseStoredSkins(target.get()[SKINS_KEY]);
      if (!Object.keys(all).length) return all; // nothing to filter: no data download for it
      const ids = await operators();
      return ids ? Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id))) : all;
    },
  });
}

/**
 * Wire the 名片干员 sync once (PR #643 split 6, ui/seatArt.js): `room.card { charId }` after every welcome, every pick
 * and whenever the room's content set arrives or goes — the server keeps it on the session, so it follows the player
 * into every room (server/lobby.js card / humanSeat), and the room sees it as room.state seats[].card. The list is the
 * room's picker's (ui/seatArt.js cardOperators): the visible chess operators plus the room version's 自选编队 pool (#877).
 * A pick the data shown now does not list (a plugin operator, the room left) goes out as '' (默认), as one's own card
 * draws it; the pref
 * keeps it. The engine retries RATE / TIMEOUT / OFFLINE (review fix of PR #813: the room's own effect gave up after
 * them, so teammates kept the old card); BAD_MSG is final ('error', logged).
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore>,
 *   getChessReady?: () => Promise<any>, getBackupsReady?: () => Promise<any>, listChess?: () => any[],
 *   listBackups?: () => any, notify?: (text: string) => void, content?: any }} deps
 */
export function installCardSync({ net, timers, target = cardStore, getChessReady, getBackupsReady, listChess, listBackups, notify, content = appContentSet, app = store, gate = null } = {}) {
  const ready = getChessReady || (() => data.load('chess'));
  const readyBackups = getBackupsReady || (() => data.load('backups'));
  const list = listChess || (() => data.list('chess'));
  const backupsOf = listBackups || (() => data.get('backups'));
  return installPrefSync({
    net, timers, target, notify, key: CARD_KEY, stateKey: CARD_SYNC_KEY, msgType: 'room.card', field: null, tag: 'card',
    lockedText: null, // room.card has no phase gate: never WRONG_PHASE / ROOM_STARTED
    content, app, gate, seatBound: false,
    async prepare() {
      const want = target.get()[CARD_KEY];
      if (!want) return { charId: '' };
      if (await ready() == null) return null;
      // a chess operator needs nothing more: the common pick goes out before backups.json is asked for
      if (cardOperators(list()).some((c) => c.charId === want)) return { charId: want };
      // 自选编队 operator (#877): no chess record of its own, listed only through backups.diy.ownedPool — the same list
      // the room's picker draws (cardOperators(chess, backups)), so a pool pick goes out as itself, never as 默认
      if ((await readyBackups()) == null) return null;
      return { charId: cardOperators(list(), backupsOf()).some((c) => c.charId === want) ? want : '' };
    },
  });
}

/**
 * Wire the 自选编队 sync once (0.2.0 DIY): `room.diy { picks }` after every welcome and edit. The picks go as stored
 * (structurally clean); the server keeps the legal ones. During a match the server stores them for the next one
 * (ROOM_STARTED → 'locked'): the setting is out of match. Every `welcome` also brings the operators a DIY slot may field
 * (`diyKitted`, the picker's list).
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore>,
 *   notify?: (text: string) => void }} deps
 */
export function installDiySync({ net, timers, target = loadoutStore, notify, content = appContentSet, app = store, gate = null } = {}) {
  // the picker's list: welcome's, and the operators the room's content set adds while it plays one (DESIGN §32.6)
  let welcomeList = null;
  let joined = { base: null, extra: null, list: null };
  const pickList = () => {
    const extra = content?.get().status === 'ready' ? content.get().kitted : null;
    if (!welcomeList || !Array.isArray(extra) || !extra.length) return welcomeList;
    if (joined.base !== welcomeList || joined.extra !== extra) joined = { base: welcomeList, extra, list: [...new Set([...welcomeList, ...extra])] };
    return joined.list;
  };
  const offKit = net.on('welcome', (msg) => {
    welcomeList = msg && Array.isArray(msg.diyKitted) ? msg.diyKitted.filter((x) => typeof x === 'string') : null;
    target.set({ diyKitted: pickList() });
  });
  const offKitContent = content ? content.subscribe(() => { const l = pickList(); if (l !== target.get().diyKitted) target.set({ diyKitted: l }); }) : null;
  const sync = installPrefSync({
    net, timers, target, notify, content, app, gate, key: 'diy', stateKey: 'diySync', msgType: 'room.diy', field: 'picks', tag: 'diy',
    lockedText: N_('自选编队是局外设置，修改将在下一局生效'),
    async prepare() {
      if (target === loadoutStore) refreshViews(); // the picks of the version on screen
      return cleanPicks(target.get().diy);
    },
  });
  return { flush: sync.flush, dispose() { offKit?.(); offKitContent?.(); sync.dispose(); } };
}
