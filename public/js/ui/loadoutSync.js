// Operator loadout + ownership + 自选编队 state and server sync (DESIGN §16; 干员持有 — 0.2.0 补位; 自选编队 — 0.2.0 DIY).
//
// `loadoutStore` holds the per-browser loadout (`entries`, persisted in localStorage through store.js savePref), the
// per-browser not-owned list of the 干员持有 tab (`notOwned`, likewise), the 自选编队 picks (`diy`, likewise; with
// `diyKitted` = the operators the server lets a DIY slot field, from every `welcome`) and the overlay's screen state
// (open / origin / tab / selection / filters). `installLoadoutSync()` / `installOwnershipSync()` / `installDiySync()`
// (called once by main.js) keep the server's copies current — one sync engine (installPrefSync), three settings: after
// every `welcome` (new or resumed
// session — the server keeps them on the session and on the seat, so joining a room needs no resend) and after every
// edit (debounced; a pending edit goes out at once when the overlay closes), they send `room.loadout { entries }`
// (sanitised against the loaded data/chess.json: ui/loadoutModel.js sanitizeEntries — a stale entry is dropped, never
// the whole loadout), `room.ownership { notOwned }` (sent as stored: the server keeps the droppable chess and drops
// the rest, so no data is needed) and `room.diy { picks }` (sent as stored, structurally clean: the server keeps the
// legal picks). Replies: RATE → retried later; WRONG_PHASE / ROOM_STARTED → the running match keeps what it took (the
// loadout locks when INFO_CHECK ends; the ownership and the 自选 picks never change during a match) — stored for the
// next match, not an error for the player; anything else is logged. `sync` / `ownSync` / `diySync` ∈ 'idle' |
// 'pending' | 'sending' | 'synced' | 'locked' | 'error' are mirrored into the store for the screen's status line.

import { createStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import { LOADOUT_PREF, parseStored, toStored, sanitizeEntries } from './loadoutModel.js';
import { OWNERSHIP_PREF, parseStoredOwnership, toStoredOwnership, cleanIds, sanitizeNotOwned } from './ownershipModel.js';
import { DIY_PREF, parseStoredDiy, toStoredDiy, cleanPicks, sanitizeDiyPicks } from './diyModel.js';
import { toast } from './toasts.js';
import { t, N_ } from '../../../shared/i18n.js';

export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;

function readStored() {
  try { return parseStored(loadPref(LOADOUT_PREF, null)); } catch { return {}; }
}
function readStoredOwnership() {
  try { return parseStoredOwnership(loadPref(OWNERSHIP_PREF, null)); } catch { return []; }
}
function readStoredDiy() {
  try { return parseStoredDiy(loadPref(DIY_PREF, null)); } catch { return {}; }
}

/** Loadout + ownership + screen state (separate from the app store: it must survive room / match resets). */
export const loadoutStore = createStore({
  entries: readStored(),
  notOwned: readStoredOwnership(), // 干员持有: base chess ids marked 未持有 (sorted; [] = every operator owned)
  diy: readStoredDiy(), // 自选编队: { [slotBaseId]: { charId, skillIndex?, uniEquipId? } } ({} = every slot empty)
  diyKitted: null,     // the operators a DIY slot may field (welcome.diyKitted; null before the first welcome)
  open: false,
  from: null,          // 'lobby' | 'room' | 'briefing'
  tab: 'loadout',      // 'loadout' (干员调配) | 'ownership' (干员持有) | 'diy' (自选编队)
  sel: null,           // selected base chess id
  filters: { tier: null, prof: null, bond: null, query: '', changedOnly: false },
  sync: 'idle',
  ownSync: 'idle',
  diySync: 'idle',
});

/** Replace the stored entries (persisted at once; the sync picks the change up). */
export function setEntries(entries) {
  const next = entries && typeof entries === 'object' ? entries : {};
  savePref(LOADOUT_PREF, toStored(next));
  loadoutStore.set({ entries: next });
}

/**
 * Apply a parsed entry map (an imported preset). Sanitised against the loaded data first, then persisted and synced
 * like any ordinary edit — so a preset from another build never sends the server an entry it would refuse. An import
 * that keeps nothing (every chess unknown, or every choice already the default) changes NOTHING: wiping the current
 * loadout over it would be a loss the player never asked for.
 * @param {Record<string, any>} entries `parseImport(...).entries`
 * @param {(id: string) => any} lookup chess lookup
 * @returns {{ applied: number, dropped: number }} entries kept / entries that were not imported
 */
export function applyLoadoutEntries(entries, lookup) {
  const asked = Object.keys(entries || {}).length;
  const clean = sanitizeEntries(entries, lookup);
  const applied = Object.keys(clean).length;
  if (applied) setEntries(clean);
  return { applied, dropped: Math.max(0, asked - applied) };
}

/** Replace the stored not-owned list (干员持有; persisted at once, the sync picks the change up). */
export function setNotOwned(list) {
  const next = cleanIds(list);
  savePref(OWNERSHIP_PREF, toStoredOwnership(next));
  loadoutStore.set({ notOwned: next });
}

/**
 * Apply an imported not-owned list (parseOwnershipImport(...).notOwned), sanitised against the loaded data (droppable
 * chess only), persisted and synced like an edit. An empty list is a valid import (= every operator owned).
 * @param {string[]} list @param {(id: string) => any} lookup chess lookup
 * @returns {{ applied: number, dropped: number }}
 */
export function applyOwnershipImport(list, lookup) {
  const asked = cleanIds(list).length;
  const clean = sanitizeNotOwned(list, lookup);
  setNotOwned(clean);
  return { applied: clean.length, dropped: Math.max(0, asked - clean.length) };
}

/** Replace the stored 自选编队 picks (persisted at once, the sync picks the change up). */
export function setDiyPicks(picks) {
  const next = cleanPicks(picks);
  try { savePref(DIY_PREF, toStoredDiy(next)); } catch { /* private mode: the session keeps it */ }
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
 * Open the 干员调配 overlay. @param {'lobby'|'room'|'briefing'} from @param {string|null} [sel]
 * @param {'loadout'|'ownership'|'diy'|null} [tab] the tab to show (default: the last one)
 */
export function openLoadout(from = 'lobby', sel = null, tab = null) {
  data.load('chess');
  data.load('bonds');
  data.load('assets');
  data.load('local');
  data.load('backups');
  loadoutStore.set({ open: true, from, ...(sel ? { sel } : {}), ...(tab === 'loadout' || tab === 'ownership' || tab === 'diy' ? { tab } : {}) });
}
export const closeLoadout = () => loadoutStore.set({ open: false });

/**
 * One setting kept in sync with the server (see the header): `key` = the store field, `stateKey` = its sync state field,
 * `msgType` / `field` = the C2S message, `prepare()` → the payload to send (may await data; null = the data is missing:
 * nothing is sent, state 'error'), `lockedText` = what a refused edit tells the player.
 */
function installPrefSync({ net, timers, target, notify, key, stateKey, msgType, field, prepare, lockedText, tag, persist }) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  // (`lockedText` is a msgid: the toast is translated when it shows — docs/I18N.md)
  const tell = notify || ((text) => toast(t(text), 'warn'));
  let timer = null;
  let seq = 0;            // requests sent (the reply of an older one never overrides a newer one's state)
  let pendingJson = null; // JSON of the newest request still awaiting its reply
  let lastSent = null;    // JSON of the last payload the server accepted (on this session)
  let edited = false;     // an edit is waiting to be sent (a lock refusal is then worth telling the player)
  let disposed = false;

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
    try {
      const payload = await prepare();
      if (disposed) return;
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
        await net.request(msgType, { [field]: payload });
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
          if (wasEdit) tell(lockedText);
        } else if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { edited = edited || wasEdit; schedule(RETRY_MS); }
        else { edited = edited || wasEdit; console.warn(`[${tag}] ${msgType} refused`, code, err && err.detail); setState('error'); }
      }
    } catch (e) {
      console.warn(`[${tag}] sync failed`, e);
      setState('error');
    }
  }

  const offWelcome = net.on('welcome', (msg) => {
    // A saved server copy wins on page load. Keep edits made while this page was offline.
    const saved = msg?.preferences?.[key];
    if (saved != null && !edited && pendingJson == null) {
      persist(saved);
      target.set({ [key]: saved });
      edited = false;
    }
    lastSent = null; pendingJson = null; seq++; schedule(50);
  });
  const offStore = target.subscribe((s, prev) => {
    if (s[key] !== prev[key]) { edited = true; schedule(); }
    // closing the overlay sends a pending edit at once (review fix): the player's next click — 准备就绪 in the solo
    // briefing, 开始模拟 in the room — must not overtake the debounced message (the match locks its loadout when
    // INFO_CHECK ends, so a late edit would silently only apply to the next match). Same socket ⇒ ordered.
    if (prev.open && !s.open && timer != null) { T.clearTimeout(timer); timer = null; void flush(); }
  });
  // a match leaving INFO_CHECK locks the loadout; a new match (the room back in LOBBY / a new INFO_CHECK) accepts it again
  const offRoom = net.on('room.state', (msg) => { if (msg && !msg.inMatch && target.get()[stateKey] === 'locked') { lastSent = null; schedule(); } });

  return {
    flush,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      offWelcome?.();
      offStore?.();
      offRoom?.();
    },
  };
}

/**
 * Wire the loadout sync once. Dependencies are injectable for tests.
 * @param {{ net: any, getChessReady?: () => Promise<any>, lookupChess?: (id: string) => any,
 *   timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore> }} deps
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installLoadoutSync({ net, getChessReady, lookupChess, timers, target = loadoutStore, notify } = {}) {
  const ready = getChessReady || (() => data.load('chess'));
  const lookup = lookupChess || ((id) => data.lookup('chess', id));
  return installPrefSync({
    net, timers, target, notify, key: 'entries', stateKey: 'sync', msgType: 'room.loadout', field: 'entries', tag: 'loadout',
    lockedText: N_('本局的干员调配已锁定，修改将在下一局生效'),
    persist: (entries) => savePref(LOADOUT_PREF, toStored(entries)),
    async prepare() {
      const current = target.get().entries;
      // an empty loadout needs no data (nothing to sanitise): a player who never opened 干员调配 does not download
      // chess.json in the lobby just for this
      if (!current || Object.keys(current).length === 0) return {};
      const loaded = await ready();
      if (loaded == null) return null;
      return sanitizeEntries(target.get().entries, lookup);
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
export function installOwnershipSync({ net, timers, target = loadoutStore, notify } = {}) {
  return installPrefSync({
    net, timers, target, notify, key: 'notOwned', stateKey: 'ownSync', msgType: 'room.ownership', field: 'notOwned', tag: 'ownership',
    lockedText: N_('干员持有是局外设置，修改将在下一局生效'),
    persist: (list) => savePref(OWNERSHIP_PREF, toStoredOwnership(list)),
    prepare: async () => cleanIds(target.get().notOwned),
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
export function installDiySync({ net, timers, target = loadoutStore, notify } = {}) {
  const offKit = net.on('welcome', (msg) => {
    const list = msg && Array.isArray(msg.diyKitted) ? msg.diyKitted.filter((x) => typeof x === 'string') : null;
    target.set({ diyKitted: list });
  });
  const sync = installPrefSync({
    net, timers, target, notify, key: 'diy', stateKey: 'diySync', msgType: 'room.diy', field: 'picks', tag: 'diy',
    lockedText: N_('自选编队是局外设置，修改将在下一局生效'),
    persist: (picks) => savePref(DIY_PREF, toStoredDiy(picks)),
    prepare: async () => cleanPicks(target.get().diy),
  });
  return { flush: sync.flush, dispose() { offKit?.(); sync.dispose(); } };
}
