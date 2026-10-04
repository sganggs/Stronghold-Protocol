// Operator loadout state + server sync (DESIGN §16).
//
// `loadoutStore` holds the per-browser loadout (`entries`, persisted in localStorage through store.js savePref) and the
// 干员调配 screen state (open / origin / selection / filters). `installLoadoutSync()` (called once by main.js) keeps the
// server's copy current: after every `welcome` (new or resumed session — the server keeps it on the session and on the
// seat, so joining a room needs no resend) and after every edit (debounced; a pending edit goes out at once when the
// overlay closes), it sends `room.loadout { entries }` with
// the entries sanitised against the loaded data/chess.json (ui/loadoutModel.js sanitizeEntries: a stale entry is
// dropped, never the whole loadout). Replies: RATE → retried later; WRONG_PHASE / ROOM_STARTED → the running match has
// locked its loadout (it applies to the next match, the server stored it) — not an error for the player; anything else
// is logged. `sync.state` ∈ 'idle' | 'pending' | 'sending' | 'synced' | 'locked' | 'error' is mirrored into the store
// for the screen's status line.

import { createStore, loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import { LOADOUT_PREF, parseStored, toStored, sanitizeEntries } from './loadoutModel.js';
import { toast } from './toasts.js';
import { T } from '../i18n.js';
export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;

function readStored() {
  try { return parseStored(loadPref(LOADOUT_PREF, null)); } catch { return {}; }
}

/** Loadout + screen state (separate from the app store: it must survive room / match resets). */
export const loadoutStore = createStore({
  entries: readStored(),
  open: false,
  from: null,          // 'lobby' | 'room' | 'briefing'
  sel: null,           // selected base chess id
  filters: { tier: null, prof: null, bond: null, query: '', changedOnly: false },
  sync: 'idle',
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

/** Open the 干員调配 screen. @param {'lobby'|'room'|'briefing'} from @param {string|null} [sel] */
export function openLoadout(from = 'lobby', sel = null) {
  data.load('chess');
  data.load('bonds');
  data.load('assets');
  data.load('local');
  loadoutStore.set({ open: true, from, ...(sel ? { sel } : {}) });
}
export const closeLoadout = () => loadoutStore.set({ open: false });

/**
 * Wire the sync once. Dependencies are injectable for tests.
 * @param {{ net: any, getChessReady?: () => Promise<any>, lookupChess?: (id: string) => any,
 *   timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore> }} deps
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installLoadoutSync({ net, getChessReady, lookupChess, timers, target = loadoutStore, notify } = {}) {
  const tm = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const ready = getChessReady || (() => data.load('chess'));
  const lookup = lookupChess || ((id) => data.lookup('chess', id));
  const tell = notify || ((text) => toast(text, 'warn'));
  let timer = null;
  let seq = 0;            // room.loadout requests sent (the reply of an older one never overrides a newer one's state)
  let pendingJson = null; // JSON of the newest request still awaiting its reply
  let lastSent = null;    // JSON of the last entries the server accepted (on this session)
  let edited = false;     // an edit is waiting to be sent (a lock refusal is then worth telling the player)
  let disposed = false;

  const setState = (sync) => { if (target.get().sync !== sync) target.set({ sync }); };

  const schedule = (ms = SYNC_DEBOUNCE_MS) => {
    if (disposed) return;
    tm.clearTimeout(timer);
    setState('pending');
    timer = tm.setTimeout(() => { timer = null; void flush(); }, ms);
  };

  // Review fix: a send is never held back behind one still in flight. The socket is ordered and the server applies
  // room.loadout frames in order, so the newest entries always win; holding the edit until the previous reply arrived let
  // a click right after closing the overlay (准备就绪 → INFO_CHECK ends) overtake it, and the edit silently missed the match.
  async function flush() {
    if (disposed) return;
    if (net.status !== 'online') { setState('idle'); return; } // the next welcome resends
    try {
      const current = target.get().entries;
      // an empty loadout needs no data (nothing to sanitise): a player who never opened 干员调配 does not download
      // chess.json in the lobby just for this
      const empty = !current || Object.keys(current).length === 0;
      const loaded = empty ? true : await ready();
      if (disposed) return;
      // never sanitise against missing data: every entry would be dropped and the server's copy cleared
      if (loaded == null) { setState('error'); return; }
      const entries = empty ? {} : sanitizeEntries(target.get().entries, lookup);
      const json = JSON.stringify(entries);
      if (json === pendingJson) return; // the same content is already on its way
      if (json === lastSent && pendingJson == null) { edited = false; setState('synced'); return; }
      const my = ++seq;
      const wasEdit = edited;
      edited = false;
      pendingJson = json;
      setState('sending');
      try {
        await net.request('room.loadout', { entries });
        if (my !== seq) return;
        pendingJson = null;
        lastSent = json;
        setState('synced');
      } catch (err) {
        if (my !== seq) return;
        pendingJson = null;
        const code = err && err.code;
        if (code === 'WRONG_PHASE' || code === 'ROOM_STARTED') {
          // the server stored it for the next match; the running one keeps the loadout it locked
          lastSent = json;
          setState('locked');
          if (wasEdit) tell(T('本局的干员调配已锁定，修改将在下一局生效'));
        } else if (code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE') { edited = edited || wasEdit; schedule(RETRY_MS); }
        else { console.warn('[loadout] room.loadout refused', code, err && err.detail); setState('error'); }
      }
    } catch (e) {
      console.warn('[loadout] sync failed', e);
      setState('error');
    }
  }

  const offWelcome = net.on('welcome', () => { lastSent = null; pendingJson = null; seq++; schedule(50); });
  const offStore = target.subscribe((s, prev) => {
    if (s.entries !== prev.entries) { edited = true; schedule(); }
    // closing the overlay sends a pending edit at once (review fix): the player's next click — 准备就绪 in the solo
    // briefing, 开始模拟 in the room — must not overtake the debounced room.loadout (the match locks its loadout when
    // INFO_CHECK ends, so a late edit would silently only apply to the next match). Same socket ⇒ ordered.
    if (prev.open && !s.open && timer != null) { tm.clearTimeout(timer); timer = null; void flush(); }
  });
  // a match leaving INFO_CHECK locks the loadout; a new match (the room back in LOBBY / a new INFO_CHECK) accepts it again
  const offRoom = net.on('room.state', (msg) => { if (msg && !msg.inMatch && target.get().sync === 'locked') { lastSent = null; schedule(); } });

  return {
    flush,
    dispose() {
      disposed = true;
      tm.clearTimeout(timer);
      offWelcome?.();
      offStore?.();
      offRoom?.();
    },
  };
}
