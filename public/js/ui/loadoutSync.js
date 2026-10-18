// Operator loadout + ownership + 自选编队 + 干员皮肤 state and server sync (DESIGN §16; 干员持有 — 0.2.0 补位; 自选编队 —
// 0.2.0 DIY; 干员皮肤 — docs/SKINS.md).
//
// `loadoutStore` holds the per-browser loadout (`entries`, persisted in localStorage through store.js savePref), the
// per-browser not-owned list of the 干员持有 tab (`notOwned`, likewise), the 自选编队 picks (`diy`, likewise; with
// `diyKitted` = the operators the server lets a DIY slot field, from every `welcome`) and the overlay's screen state
// (open / origin / tab / selection / filters). `installLoadoutSync()` / `installOwnershipSync()` / `installDiySync()` /
// `installSkinsSync()` (called once by main.js) keep the server's copies current — one sync engine (installPrefSync),
// four settings: after every `welcome` (new or resumed
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

import { createStore, loadPref, savePref, store } from '../store.js';
import { data } from '../data.js';
import { contentSet as appContentSet } from '../content.js';
import { LOADOUT_PREF, parseStored, parseStoredOps, toStored, sanitizeEntries, sanitizeOps } from './loadoutModel.js';
import { cultivationCharIds, charPotentialChanges, loadoutOptions } from '../../../shared/protocol.js';
import { PHASE } from '../../../shared/constants.js';
import { POTENTIAL_DEFAULT, CULTIVATE_DEFAULT } from '../../../shared/potential.js';
import { ruleOption } from '../../../shared/plugins/rules.js';
import { OWNERSHIP_PREF, parseStoredOwnership, toStoredOwnership, cleanIds, sanitizeNotOwned } from './ownershipModel.js';
import { DIY_PREF, parseStoredDiy, toStoredDiy, cleanPicks, sanitizeDiyPicks } from './diyModel.js';
import { skinsStore, SKINS_KEY, SKINS_SYNC_KEY, parseStoredSkins } from './skins.js';
import { toast } from './toasts.js';
import { t, N_ } from '../../../shared/i18n.js';

export const SYNC_DEBOUNCE_MS = 500;
export const RETRY_MS = 1500;

function readStored() {
  try { return parseStored(loadPref(LOADOUT_PREF, null)); } catch { return {}; }
}
function readStoredOps() {
  try { return parseStoredOps(loadPref(LOADOUT_PREF, null)); } catch { return {}; }
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
  ops: readStoredOps(), // 0.2.2 潜能 / 练度: { [charId]: { potential?, cultivate? } } ({} = every operator 潜能 6, 精英2 Lv.60)
  notOwned: readStoredOwnership(), // 干员持有: base chess ids marked 未持有 (sorted; [] = every operator owned)
  diy: readStoredDiy(), // 自选编队: { [slotBaseId]: { charId, skillIndex?, uniEquipId? } } ({} = every slot empty)
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

/** Replace the stored entries (persisted at once with the settings; the sync picks the change up). */
export function setEntries(entries) {
  const next = entries && typeof entries === 'object' ? entries : {};
  savePref(LOADOUT_PREF, toStored(next, loadoutStore.get().ops));
  loadoutStore.set({ entries: next });
}

/** Replace the stored per-operator 潜能 / 练度 (0.2.2; persisted at once with the entries; the sync picks it up). */
export function setOpsMap(ops) {
  const next = ops && typeof ops === 'object' ? ops : {};
  savePref(LOADOUT_PREF, toStored(loadoutStore.get().entries, next));
  loadoutStore.set({ ops: next });
}

/**
 * Apply a parsed entry map (an imported preset). Sanitised against the loaded data first, then persisted and synced
 * like any ordinary edit — so a preset from another build never sends the server an entry it would refuse. An import
 * that keeps nothing (every chess unknown, or every choice already the default) changes NOTHING: wiping the current
 * loadout over it would be a loss the player never asked for.
 * With `ops` (an import that carries the per-operator 潜能 / 练度, 0.2.2: `isOperator` from the loaded data) those are
 * sanitised and replace the current ones as well; without, the current ones stay.
 * @param {Record<string, any>} entries `parseImport(...).entries`
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
    setEntries(applied ? clean : loadoutStore.get().entries);
  }
  const dropped = Math.max(0, asked - applied) + Math.max(0, askedOps - nOps);
  return cleanOps ? { applied, dropped, ops: nOps } : { applied, dropped };
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
  loadoutStore.set({ open: true, from, ...(sel ? { sel } : {}), ...(from === 'prep' ? { tab: 'loadout', sync: 'idle' } : {}), ...(tab === 'loadout' || tab === 'ownership' || tab === 'diy' ? { tab } : {}) });
}
export const closeLoadout = () => loadoutStore.set({ open: false });

/**
 * One setting kept in sync with the server (see the header): `key` = the store field (or a list of them: the loadout's
 * `entries` and `ops`), `stateKey` = its sync state field, `msgType` / `field` = the C2S message (`field` null: the payload
 * is the message body), `prepare()` → the payload to send (may await data; null = the data is missing: nothing is sent,
 * state 'error'), `lockedText` = what a refused edit tells the player.
 */
function installPrefSync({ net, timers, target, notify, key, stateKey, msgType, field, prepare, lockedText, tag, content = appContentSet }) {
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
          if (wasEdit) tell(lockedText);
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
  // the room's content set arrived or went (DESIGN §32.6): sent again, checked against the data the room plays now
  let contentKey = content ? `${content.get().cs}|${content.get().status}` : '';
  const offContent = content ? content.subscribe((c) => {
    const k = `${c.cs}|${c.status}`;
    if (k === contentKey) return;
    contentKey = k;
    if (c.status === 'ready' || c.status === 'idle') { revision++; lastSent = null; schedule(50); }
  }) : null;

  return {
    flush,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      offWelcome?.();
      offStore?.();
      offRoom?.();
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
export function installLoadoutSync({ net, getChessReady, getBackupsReady, lookupChess, operatorIds, timers, target = loadoutStore, notify, matchState = () => store.get() } = {}) {
  const ready = getChessReady || (() => data.load('chess'));
  const readyBackups = getBackupsReady || (() => data.load('backups'));
  const lookup = lookupChess || ((id) => data.lookup('chess', id));
  // the operators a 潜能 / 练度 may name (shared/protocol.js cultivationCharIds: the roster + the 自选 owned pool)
  const opIds = operatorIds || (() => cultivationCharIds(data.get('chess'), data.get('backups')));
  return installPrefSync({
    net, timers, target, notify, key: ['entries', 'ops'], stateKey: 'sync', msgType: 'room.loadout', field: null, tag: 'loadout',
    lockedText: N_('本局的干员调配已锁定，修改将在下一局生效'),
    async prepare() {
      const current = target.get().entries;
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
      const entries = sanitizeEntries(target.get().entries, lookup);
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
export function installOwnershipSync({ net, timers, target = loadoutStore, notify } = {}) {
  return installPrefSync({
    net, timers, target, notify, key: 'notOwned', stateKey: 'ownSync', msgType: 'room.ownership', field: 'notOwned', tag: 'ownership',
    lockedText: N_('干员持有是局外设置，修改将在下一局生效'),
    prepare: async () => cleanIds(target.get().notOwned),
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
 * @param {{ net: any, timers?: { setTimeout: Function, clearTimeout: Function }, target?: ReturnType<typeof createStore>,
 *   notify?: (text: string) => void }} deps
 */
export function installSkinsSync({ net, timers, target = skinsStore, notify } = {}) {
  return installPrefSync({
    net, timers, target, notify, key: SKINS_KEY, stateKey: SKINS_SYNC_KEY, msgType: 'room.skins', field: 'skins', tag: 'skins',
    lockedText: N_('这台服务器不接受皮肤选择，只有本机保存'),
    prepare: async () => parseStoredSkins(target.get()[SKINS_KEY]),
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
export function installDiySync({ net, timers, target = loadoutStore, notify, content = appContentSet } = {}) {
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
    net, timers, target, notify, key: 'diy', stateKey: 'diySync', msgType: 'room.diy', field: 'picks', tag: 'diy',
    lockedText: N_('自选编队是局外设置，修改将在下一局生效'),
    prepare: async () => cleanPicks(target.get().diy),
  });
  return { flush: sync.flush, dispose() { offKit?.(); offKitContent?.(); sync.dispose(); } };
}
