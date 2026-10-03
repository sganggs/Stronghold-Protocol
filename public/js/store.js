// Minimal observable store for the browser client.
//
// One app-wide store holds everything the UI renders from:
//   connection  – socket status + latency (fed by net.js via main.js)
//   me          – { playerId, name, token } from `welcome`
//   session     – { entered } (the player pressed 开始 on the title screen in this tab)
//   room        – last `room.state` payload (without `t`) or null
//   match       – { public, private, field, result } from the `m.*` pushes; `battle` = the local battle runner's
//                 state (client-side combat, public/js/battle/runner.js): { battleId, fieldId, kind, authoritative,
//                 watch, done, own, members, loading, speed, paused, leaks } | null — `paused`: the solo pause holds
//                 every local clock; `leaks`: { [fieldId]: counted leaks so far } of every normal field simulated
//                 locally (the live LP of ui/hud.js liveLp, user playtest #3 item 2). Under client-side combat `field`
//                 is published by the runner (the m.field shape of the battle on screen, `local: true`).
//   ticker      – recent `m.ticker` lines, emotes – recent `m.emote` events
//   clock       – { offset, rtt } server clock correction: serverNow ≈ Date.now() + offset
//   ui          – small bits of local UI state shared between screens
//
// The store is framework-agnostic (get/set/subscribe); `useStore(selector)` binds it to Preact.
// Updates are immutable at the top level: `set` shallow-merges a patch object, `patch(key, obj)`
// shallow-merges into one nested object. Subscribers are notified synchronously.

import { useLayoutEffect, useReducer, useRef } from '../vendor/hooks.module.js';
import { PHASE } from '../../shared/constants.js';

/**
 * Create an observable store.
 * @template S
 * @param {S} initial initial state object
 * @returns {{ get: () => S, set: (patch: Partial<S> | ((s: S) => Partial<S>)) => void,
 *             patch: (key: keyof S, value: object | ((prev: any) => object)) => void,
 *             subscribe: (fn: (s: S, prev: S) => void) => () => void, reset: () => void }}
 */
export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Set();

  const notify = (prev) => {
    for (const fn of [...listeners]) {
      try { fn(state, prev); } catch (err) { console.error('[store] listener failed', err); }
    }
  };

  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      if (!p || typeof p !== 'object') return;
      const prev = state;
      state = { ...state, ...p };
      notify(prev);
    },
    patch(key, value) {
      const cur = state[key];
      const p = typeof value === 'function' ? value(cur) : value;
      if (!p || typeof p !== 'object') return;
      const prev = state;
      state = { ...state, [key]: { ...(cur && typeof cur === 'object' ? cur : {}), ...p } };
      notify(prev);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reset() {
      const prev = state;
      state = { ...initial };
      notify(prev);
    },
  };
}

/** Fresh (empty) match slice. */
export const emptyMatch = () => ({ public: null, private: null, field: null, result: null, battle: null });

/** Initial app state (exported for tests and resets). */
export const initialState = Object.freeze({
  connection: { status: 'idle', ping: null, attempt: 0, retryAt: 0, lastError: null, everOnline: false },
  me: { playerId: null, name: '', token: null },
  session: { entered: false },
  room: null,
  match: emptyMatch(),
  ticker: [],
  emotes: [],
  clock: { offset: 0, rtt: null, synced: false },
  ui: { pendingJoin: null, restoring: false, buildStale: false },
});

/** The app-wide store singleton. */
export const store = createStore(initialState);

/**
 * Which screen the router shows for a given app state:
 * not entered → title; m.public.phase ≠ LOBBY or room.inMatch → game; in a room → room; else lobby.
 * @param {any} s store state
 * @returns {'title'|'lobby'|'room'|'game'}
 */
export function selectRoute(s) {
  if (!s?.session?.entered) return 'title';
  const phase = s.match?.public?.phase;
  if (phase && phase !== PHASE.LOBBY) return 'game';
  if (s.room?.inMatch) return 'game'; // match starting: m.public is on its way
  if (s.room) return 'room';
  return 'lobby';
}

/**
 * The notice after a `welcome` that starts a brand-new server session (the server restarted, or this session expired
 * on it: a new playerId) while a room or a match was on screen — everything shown is gone. Null when nothing is lost
 * (the first welcome, a resumed session, only the title / lobby on screen).
 * @param {any} prev store state before the welcome
 * @param {string|null|undefined} playerId the welcome's playerId
 * @returns {string|null}
 */
export function sessionResetNotice(prev, playerId) {
  const prevId = prev?.me?.playerId;
  if (prevId == null || prevId === playerId) return null;
  if (prev?.match?.public || prev?.room?.inMatch) return '服务器会话已重置，上一局模拟已结束';
  if (prev?.room) return '服务器会话已重置，已返回大厅';
  return null;
}

/**
 * Current server time in ms since epoch, corrected by the measured clock offset.
 * @returns {number}
 */
export function serverNow() {
  const off = store.get().clock?.offset;
  return Date.now() + (Number.isFinite(off) ? off : 0);
}

/**
 * Shallow equality for plain objects / arrays (use as `useStore(sel, shallowEqual)`).
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
  return true;
}

// ---- tiny persisted preferences (localStorage, failure-tolerant) --------------------------------

/**
 * Read a JSON preference from localStorage.
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function loadPref(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(`sp.pref.${key}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Write a JSON preference to localStorage (silently ignores quota/privacy errors).
 * @param {string} key
 * @param {any} value
 */
export function savePref(key, value) {
  try { globalThis.localStorage?.setItem(`sp.pref.${key}`, JSON.stringify(value)); } catch { /* ignore */ }
}

const identity = (s) => s;

/**
 * Preact hook: subscribe to a slice of a store. Re-renders only when the selected value changes
 * (by `isEqual`, default `Object.is`).
 * @template S, T
 * @param {(s: S) => T} [selector]
 * @param {(a: T, b: T) => boolean} [isEqual]
 * @param {ReturnType<typeof createStore>} [target] store to read (defaults to the app store)
 * @returns {T}
 */
export function useStore(selector = identity, isEqual = Object.is, target = store) {
  const [, force] = useReducer((c) => c + 1, 0);
  const selRef = useRef(selector);
  const eqRef = useRef(isEqual);
  selRef.current = selector;
  eqRef.current = isEqual;

  let value;
  try { value = selector(target.get()); } catch (err) { console.error('[store] selector failed', err); value = undefined; }
  const valRef = useRef(value);
  valRef.current = value;

  useLayoutEffect(() => {
    const check = (s) => {
      let next;
      try { next = selRef.current(s); } catch { return; }
      if (!eqRef.current(next, valRef.current)) force();
    };
    const unsub = target.subscribe(check);
    check(target.get()); // catch updates between render and subscription
    return unsub;
  }, [target]);

  return value;
}
