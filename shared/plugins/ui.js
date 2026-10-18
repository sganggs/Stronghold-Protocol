// shared/plugins/ui.js — the interface-plugin bridge (DESIGN §32.8, docs/PLUGINS.md §14). No Node builtin: the registry,
// the static server and the page (public/js/ui/pluginFrame.js) share it. A ui plugin's page runs in a sandboxed iframe
// and may only talk to the host through this postMessage API (v: 1). It is read-only: nothing here is a match intent,
// and a message that looks like one is refused (shared/protocol.js C2S — the test pins every current key).
//
// [ASSUMED] limits, marked here and in DESIGN §32.8:
//   * 20 messages a second per plugin, a burst of 40
//   * battle pushes at 4 Hz, at most 40 events a batch. A snapshot whose JSON text is over 48 KB is omitted
//     (`truncated`). plainClone also sets `truncated` when it cuts a string (120), an array (32), an object's keys
//     (24) or a value past depth 4 — the partial snapshot is still sent when it fits. `truncated: false` means those
//     caps did not fire, not "every unit on the field".
//   * a plugin→host message over 8 KB is refused (JavaScript string length of the JSON, same as before)
//   * storage: key ^[A-Za-z0-9._-]{1,64}$, not __proto__ / prototype / constructor / ".."; the JSON text is counted in
//     UTF-8 bytes (TextEncoder), ≤ 4096 per value, ≤ 32 keys and ≤ 32 KB per plugin; namespaced
//     sp.plugin.<id>.<key> in the host page's localStorage
//   * iframe height clamped to 48–480 px; a notice ≤ 80 characters; a distinct notice at most once per 2 seconds
//     (the same text is still delivered, so the toast host can merge it)
//   * one slot per plugin; the protocol table grants one plugin per slot at a time (at most 8 mounted). When several
//     ask for the same slot, the match shows tabs and displays one (public/js/ui/pluginFrame.js). Slots are the four UI_SLOT_IDS
//   * the private subset is the allowlist in subsetPrivate (never loadout, ops, diy, effects, tokens, other hands)
//   * the public subset is the allowlist in subsetPublic
//   * [ASSUMED] a Forge panel also receives, still read-only: `result` (the settle allowlist in subsetResult; no lineup,
//     diy or seed), `net` (connection status; the latency field is `rtt`, never `ping`, because that key is a client
//     intent) at most once a second after the first change, and `state.room` (seats, null holes kept, plus plugin ids).
//     `welcome` may add version, lang, plugins and scalar prefs. None of these is a match intent, and a frame still
//     cannot send one.
//   * CSP UI_FRAME_CSP is on every ui /p/ response that carries the file headers (200, 206, 304), not on cosmetic
//     art, not site-wide. It includes `sandbox allow-scripts` (never `allow-same-origin`) so a top-level open of the
//     same URL is still an opaque origin. A <meta> sandbox is ignored by browsers; the response header is the one
//     that counts. 'self' may not match that opaque origin; inline scripts still run. Not measured in a browser.
//   * [ASSUMED] once a snapshot or a private view has been posted, the plugin can put it in the URL of the navigation
//     that leaves the entry. Nothing after that load gets another post. navigate-to was not measured and is not the fix.
//
// Error codes (PLUGIN_*) stay in this file. Claude merges them into shared/plugins/errors.js (C6) at integration.

import { UI_SLOT_IDS, isPackPath, isPluginId } from './manifest.js';
import { utf8 } from '../sha256.js';

export { UI_SLOT_IDS as UI_SLOTS };

/** postMessage API version. */
export const UI_API = 1;

/**
 * Content-Security-Policy on a ui plugin's files at /p/ (not on cosmetic art, not site-wide).
 * `sandbox allow-scripts` is a response directive: the document is opaque even when opened at the top level.
 * Do not add `allow-same-origin` — that would hand the plugin the game origin (and the reconnect tokens).
 * [ASSUMED] see the header — inline scripts run; a separate script file may not, under an opaque origin.
 * `navigate-to` is intentionally absent: it was not measured here, and it is not the navigation fix.
 */
export const UI_FRAME_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; sandbox allow-scripts; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

/** [ASSUMED] see the header. */
export const UI_LIMITS = Object.freeze({
  rate: 20,
  burst: 40,
  battleHz: 4,
  battleBatch: 40,
  snapshotBytes: 48 * 1024,
  messageBytes: 8 * 1024,
  storageValueBytes: 4096,
  storageKeys: 32,
  storageBytes: 32 * 1024,
  heightMin: 48,
  heightMax: 480,
  noticeChars: 80,
  /** Distinct notices, per plugin. The same text is not delayed (the toast host merges it). */
  noticeIntervalMs: 2000,
  maxPlugins: 8,
  /** [ASSUMED] connection pushes, after the first, at most once a second. */
  netHz: 1,
  api: UI_API,
});

/** Local error codes (C6). Not the shared catalogue yet. */
export const UI_ERRORS = Object.freeze({
  PLUGIN_SLOT: 'PLUGIN_SLOT',
  PLUGIN_RATE: 'PLUGIN_RATE',
  PLUGIN_STORAGE: 'PLUGIN_STORAGE',
  PLUGIN_INTENT: 'PLUGIN_INTENT',
  PLUGIN_SHAPE: 'PLUGIN_SHAPE',
  PLUGIN_LIMIT: 'PLUGIN_LIMIT',
});

/** Plugin → host, postMessage API v1. Anything else is refused. `stats` is a read of the battle on screen, never `g.unitStats`. */
export const UI_PLUGIN_MESSAGES = Object.freeze(['ready', 'slot', 'resize', 'storage', 'notice', 'stats']);
/** Host → plugin, postMessage API v1. */
export const UI_HOST_MESSAGES = Object.freeze(['welcome', 'state', 'battle', 'stats', 'storage', 'limit', 'slot', 'rejected', 'result', 'net']);
const PLUGIN_TYPES = new Set(UI_PLUGIN_MESSAGES);
const HOST_TYPES = new Set(UI_HOST_MESSAGES);

/**
 * A client→server type (shared/protocol.js C2S): hello, ping, room.*, g.*, b.*.
 * The unit test asserts every current C2S key matches.
 * @param {unknown} s
 */
export const isIntentType = (s) => typeof s === 'string' && /^(?:hello|ping|room\.[A-Za-z][A-Za-z0-9]*|g\.[A-Za-z][A-Za-z0-9]*|b\.[A-Za-z][A-Za-z0-9]*)$/.test(s);

/**
 * Whether `value` is, or carries, a match intent. A plugin must not send one (no auto-play, no cheat).
 * @param {unknown} value
 * @param {number} [depth]
 */
export function isMatchIntent(value, depth = 0) {
  if (depth > 8) return true;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((x) => isMatchIntent(x, depth + 1));
  for (const k of Object.keys(value)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
    if (isIntentType(k)) return true;
    // `b.snap` is the host's own label on a battle snapshot (runner frameOf), not a client→server intent
    // (it is S2C). Storing the snapshot the host just sent must not come back as PLUGIN_INTENT.
    // Any other field, including a nested g.* / room.* / b.progress, is still an intent.
    if (k === 't' && value[k] !== 'b.snap' && isIntentType(value[k])) return true;
    if (isMatchIntent(value[k], depth + 1)) return true;
  }
  return false;
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

/**
 * @param {unknown} raw
 * @returns {{ ok: true, msg: Record<string, unknown> } | { ok: false, reason: 'intent' | 'shape' | 'version' | 'size' }}
 */
export function validatePluginMessage(raw) {
  if (!isObj(raw)) return { ok: false, reason: 'shape' };
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch { return { ok: false, reason: 'shape' }; }
  if (size > UI_LIMITS.messageBytes) return { ok: false, reason: 'size' };
  if (isMatchIntent(raw)) return { ok: false, reason: 'intent' };
  if (raw.v !== UI_API) return { ok: false, reason: 'version' };
  const t = raw.t;
  if (typeof t !== 'string' || !PLUGIN_TYPES.has(t)) return { ok: false, reason: 'shape' };
  const keys = Object.keys(raw);
  const allow = (list) => keys.every((k) => list.includes(k));
  if (t === 'ready') {
    if (!allow(['v', 't'])) return { ok: false, reason: 'shape' };
    return { ok: true, msg: { v: 1, t } };
  }
  if (t === 'slot') {
    if (!allow(['v', 't', 'slot']) || typeof raw.slot !== 'string' || !UI_SLOT_IDS.includes(raw.slot)) return { ok: false, reason: 'shape' };
    return { ok: true, msg: { v: 1, t, slot: raw.slot } };
  }
  if (t === 'resize') {
    if (!allow(['v', 't', 'height']) || finite(raw.height) === null) return { ok: false, reason: 'shape' };
    return { ok: true, msg: { v: 1, t, height: /** @type {number} */ (raw.height) } };
  }
  if (t === 'notice') {
    if (!allow(['v', 't', 'text']) || typeof raw.text !== 'string') return { ok: false, reason: 'shape' };
    return { ok: true, msg: { v: 1, t, text: raw.text } };
  }
  if (t === 'stats') {
    if (!allow(['v', 't', 'unitId', 'fieldId'])) return { ok: false, reason: 'shape' };
    if (!Number.isInteger(raw.unitId)) return { ok: false, reason: 'shape' };
    if (raw.fieldId !== undefined && typeof raw.fieldId !== 'string') return { ok: false, reason: 'shape' };
    return { ok: true, msg: { v: 1, t, unitId: raw.unitId, fieldId: typeof raw.fieldId === 'string' ? raw.fieldId : null } };
  }
  if (!allow(['v', 't', 'op', 'key', 'value'])) return { ok: false, reason: 'shape' };
  if (raw.op !== 'get' && raw.op !== 'set' && raw.op !== 'delete' && raw.op !== 'keys') return { ok: false, reason: 'shape' };
  if (raw.op !== 'keys' && raw.key !== undefined && typeof raw.key !== 'string') return { ok: false, reason: 'shape' };
  if ((raw.op === 'get' || raw.op === 'set' || raw.op === 'delete') && typeof raw.key !== 'string') return { ok: false, reason: 'shape' };
  if (raw.op === 'set' && !Object.prototype.hasOwnProperty.call(raw, 'value')) return { ok: false, reason: 'shape' };
  return { ok: true, msg: { v: 1, t, op: raw.op, key: raw.key, value: raw.op === 'set' ? raw.value : undefined } };
}

/**
 * Token bucket. [ASSUMED] `rate` tokens a second, capacity `burst`.
 * @param {{ rate?: number, burst?: number, now?: () => number }} [opts]
 */
export function createRateLimiter({ rate = UI_LIMITS.rate, burst = UI_LIMITS.burst, now = Date.now } = {}) {
  /** @type {Map<string, { tokens: number, t: number }>} */
  const buckets = new Map();
  return {
    /** @param {string} id @returns {boolean} */
    allow(id) {
      const t = now();
      let b = buckets.get(id);
      if (!b) b = { tokens: burst, t };
      else {
        b.tokens = Math.min(burst, b.tokens + (Math.max(0, t - b.t) / 1000) * rate);
        b.t = t;
      }
      buckets.set(id, b);
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
    /** @param {string} id */
    reset(id) { buckets.delete(id); },
  };
}

/** UTF-8 bytes of a JavaScript string (shared/sha256.js utf8, as TextEncoder encodes). Storage quotas use this, not `s.length` (UTF-16 code units). @param {string} s */
const utf8Bytes = (s) => utf8(s).length;

/**
 * Distinct notices, one per `noticeIntervalMs`. The same text is allowed again so the toast host can merge it,
 * and repeating it does not move the window (a plugin cannot rotate a new line by echoing the previous one).
 * [ASSUMED] 2 seconds. This does not replace the token bucket.
 * @param {{ intervalMs?: number, now?: () => number }} [opts]
 */
export function createNoticeLimiter({ intervalMs = UI_LIMITS.noticeIntervalMs, now = Date.now } = {}) {
  /** @type {Map<string, { t: number, text: string }>} */
  const last = new Map();
  return {
    /**
     * @param {string} id
     * @param {string} text already clamped
     * @param {number} [at]
     * @returns {boolean}
     */
    allow(id, text, at = now()) {
      const prev = last.get(id);
      if (prev && text !== prev.text && at - prev.t < intervalMs) return false;
      if (!prev || text !== prev.text) last.set(id, { t: at, text });
      return true;
    },
    /** @param {string} id */
    reset(id) { last.delete(id); },
  };
}

/** @param {unknown} key */
export function storageKeyOk(key) {
  return typeof key === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(key)
    && key !== '__proto__' && key !== 'prototype' && key !== 'constructor' && !key.includes('..');
}

/**
 * The localStorage key the host uses. null when `id` or `key` is not allowed (the plugin never chooses the prefix).
 * @param {string} id @param {string} key
 * @returns {string | null}
 */
export function namespacedStorageKey(id, key) {
  if (!isPluginId(id) || !storageKeyOk(key)) return null;
  return `sp.plugin.${id}.${key}`;
}

/**
 * Whether `value` may be stored. `entries` maps key → the JSON text already stored (a null-prototype object is safest).
 * @param {Record<string, string>} entries
 * @param {string} key
 * @param {unknown} value
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function checkStorageWrite(entries, key, value) {
  if (!storageKeyOk(key)) return { ok: false, error: UI_ERRORS.PLUGIN_STORAGE };
  if (isMatchIntent(value)) return { ok: false, error: UI_ERRORS.PLUGIN_INTENT };
  let text;
  try { text = JSON.stringify(value); } catch { return { ok: false, error: UI_ERRORS.PLUGIN_STORAGE }; }
  if (typeof text !== 'string' || utf8Bytes(text) > UI_LIMITS.storageValueBytes) return { ok: false, error: UI_ERRORS.PLUGIN_STORAGE };
  const keys = new Set(Object.keys(entries).filter((k) => storageKeyOk(k) && k !== key));
  keys.add(key);
  let bytes = 0;
  for (const k of keys) bytes += utf8Bytes(k) + utf8Bytes(k === key ? text : String(entries[k]));
  if (keys.size > UI_LIMITS.storageKeys || bytes > UI_LIMITS.storageBytes) return { ok: false, error: UI_ERRORS.PLUGIN_STORAGE };
  return { ok: true, text };
}

/**
 * One slot per plugin, and one holder per slot in this table. The match shows tabs when several plugins ask for one slot. `allowed` is the plugin's declared slots.
 * @returns {{ request: (pluginId: string, slot: string, allowed: string[]) => { ok: true, slot: string } | { ok: false, error: string },
 *   release: (pluginId: string) => void, slotOf: (pluginId: string) => string | null, holder: (slot: string) => string | null }}
 */
export function createSlotTable() {
  /** @type {Map<string, string>} */
  const byPlugin = new Map();
  /** @type {Map<string, string>} */
  const bySlot = new Map();
  return {
    request(pluginId, slot, allowed) {
      if (!UI_SLOT_IDS.includes(slot) || !Array.isArray(allowed) || !allowed.includes(slot)) return { ok: false, error: UI_ERRORS.PLUGIN_SLOT };
      const cur = byPlugin.get(pluginId);
      if (cur === slot) return { ok: true, slot };
      const holder = bySlot.get(slot);
      if (holder && holder !== pluginId) return { ok: false, error: UI_ERRORS.PLUGIN_SLOT };
      if (cur) bySlot.delete(cur);
      byPlugin.set(pluginId, slot);
      bySlot.set(slot, pluginId);
      return { ok: true, slot };
    },
    release(pluginId) {
      const cur = byPlugin.get(pluginId);
      if (cur && bySlot.get(cur) === pluginId) bySlot.delete(cur);
      byPlugin.delete(pluginId);
    },
    slotOf: (pluginId) => byPlugin.get(pluginId) || null,
    holder: (slot) => bySlot.get(slot) || null,
  };
}

/** @param {number} n @returns {number | null} clamped, or null when it is not a finite number */
export function clampHeight(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(UI_LIMITS.heightMin, Math.min(UI_LIMITS.heightMax, Math.round(n)));
}

/** @param {unknown} notice @returns {string | null} */
export function clampNotice(notice) {
  if (typeof notice !== 'string') return null;
  const s = notice.replace(/\s+/g, ' ').trim();
  if (!s || s.length > UI_LIMITS.noticeChars) return null;
  return s;
}

const pick = (obj, keys) => {
  if (!isObj(obj)) return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : null);

/**
 * What a plugin may see of `m.public`. [ASSUMED] allowlist — no hidden boss, no hands, no tokens.
 * @param {unknown} pub
 */
export function subsetPublic(pub) {
  if (!isObj(pub)) return null;
  const players = Array.isArray(pub.players) ? pub.players.slice(0, 8).map((p) => {
    const row = pick(p, ['playerId', 'seat', 'name', 'alive', 'lp', 'shopLevel']);
    return row || {};
  }) : [];
  return {
    phase: str(pub.phase, 32),
    round: num(pub.round),
    lastRound: num(pub.lastRound),
    modeId: str(pub.modeId, 64),
    difficulty: str(pub.difficulty, 32),
    paused: pub.paused === true,
    players,
  };
}

const cardOf = (c) => {
  const row = pick(c, ['uid', 'kind', 'id', 'chessId', 'level']);
  return row || {};
};

/**
 * What a plugin may see of the player's own `m.private`. [ASSUMED] allowlist. Dropped on purpose: loadout, ops, diy,
 * effects, nextEnemies, personalChoice, rewardOffer, tokens, anything that is not the player's own view.
 * @param {unknown} priv
 */
export function subsetPrivate(priv) {
  if (!isObj(priv)) return null;
  const shop = isObj(priv.shop) ? {
    level: num(priv.shop.level),
    slots: Array.isArray(priv.shop.slots) ? priv.shop.slots.slice(0, 16).map((s) => pick(s, ['kind', 'id', 'price', 'sold']) || {}) : [],
  } : null;
  const stats = pick(priv.stats, ['dmgDealt', 'kills', 'leaks', 'gold']);
  return {
    playerId: str(priv.playerId),
    seat: num(priv.seat),
    alive: priv.alive === true,
    lp: num(priv.lp),
    funds: num(priv.funds),
    bandId: str(priv.bandId),
    ready: priv.ready === true,
    shop,
    hand: Array.isArray(priv.hand) ? priv.hand.slice(0, 16).map(cardOf) : [],
    board: Array.isArray(priv.board) ? priv.board.slice(0, 32).map(cardOf) : [],
    stats,
    bonds: Array.isArray(priv.bonds) ? priv.bonds.slice(0, 32).map((b) => pick(b, ['bondId', 'count', 'tier']) || {}) : [],
  };
}

const EVENT_KEYS = ['t', 'type', 'kind', 'amount', 'dmg', 'damage', 'sourceId', 'targetId', 'unitId', 'defId', 'id'];

/**
 * Numeric slots of a sim tuple. damage.js writes `['dmg', target.id, amount, kind]` and
 * `['heal', target.id, amount]` — the first number is the unit id, not the HP. `atk` has no amount
 * (source id, target id, kind). Anything not listed keeps the tag only: a `spawn` payload is a
 * unitInfo object and can carry loadout / diy, so it is never copied.
 * @type {Record<string, Record<number, string>>}
 */
const TUPLE_FIELDS = {
  dmg: { 1: 'unitId', 2: 'amount' },
  heal: { 1: 'unitId', 2: 'amount' },
  atk: { 1: 'sourceId', 2: 'targetId' },
  skill: { 1: 'unitId' },
  deploy: { 1: 'unitId' },
  die: { 1: 'unitId' },
  leak: { 1: 'unitId' },
  engage: { 1: 'unitId' },
  cast: { 1: 'unitId', 2: 'slot' },
  status: { 1: 'unitId' },
};

const finiteAt = (ev, i) => (typeof ev[i] === 'number' && Number.isFinite(ev[i]) ? ev[i] : null);

/**
 * A battle event reduced to plain fields. Tuples are mapped by position (never "the first number").
 * Object messages keep the allowlisted keys. Object payloads inside a tuple are dropped.
 */
export function sanitizeEvent(ev) {
  if (Array.isArray(ev)) {
    const tag = ev[0];
    if (typeof tag !== 'string' || tag.length === 0) return null;
    const t = tag.slice(0, 32);
    /** @type {Record<string, string | number | boolean>} */
    const o = { t };
    const spec = TUPLE_FIELDS[t];
    if (spec) {
      for (const idx of Object.keys(spec)) {
        const n = finiteAt(ev, Number(idx));
        if (n != null) o[spec[idx]] = n;
      }
    }
    if ((t === 'dmg' || t === 'atk') && typeof ev[3] === 'string') o.kind = ev[3].slice(0, 32);
    if (t === 'dmg' && ev[4] === 'r') o.crit = true;
    return o;
  }
  if (!isObj(ev)) return null;
  /** @type {Record<string, string | number | boolean>} */
  const o = {};
  for (const k of EVENT_KEYS) {
    const v = ev[k];
    if (typeof v === 'string') o[k] = v.slice(0, 64);
    else if (typeof v === 'number' && Number.isFinite(v)) o[k] = v;
    else if (typeof v === 'boolean') o[k] = v;
  }
  return Object.keys(o).length ? o : null;
}

/**
 * @param {unknown} v
 * @param {number} depth
 * @param {WeakSet<object>} seen
 * @param {{ truncated: boolean }} flag set when a cap drops or cuts something the plugin would otherwise see
 */
function plainClone(v, depth, seen, flag) {
  if (v == null) return undefined;
  if (depth > 4) { flag.truncated = true; return undefined; }
  const kind = typeof v;
  if (typeof v === 'string') {
    if (v.length > 120) { flag.truncated = true; return v.slice(0, 120); }
    return v;
  }
  if (kind === 'number') return Number.isFinite(v) ? v : undefined;
  if (kind === 'boolean') return v;
  if (kind !== 'object') return undefined;
  if (seen.has(v)) return undefined;
  seen.add(v);
  if (Array.isArray(v)) {
    if (v.length > 32) flag.truncated = true;
    const a = [];
    for (const x of v.slice(0, 32)) {
      const c = plainClone(x, depth + 1, seen, flag);
      if (c !== undefined) a.push(c);
    }
    return a;
  }
  /** @type {Record<string, unknown>} */
  const o = {};
  let kept = 0;
  for (const k of Object.keys(v)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    kept += 1;
    if (kept > 24) { flag.truncated = true; break; }
    const c = plainClone(v[k], depth + 1, seen, flag);
    if (c !== undefined) o[k] = c;
  }
  return o;
}

/**
 * The battle push.
 * [ASSUMED] a snapshot whose JSON text is longer than snapshotBytes (JavaScript string length) is omitted
 * (`truncated`). A clone that hit a plainClone cap is still sent when it fits, with `truncated` true.
 * The host's `t: 'b.snap'` label is removed: the message's own `t` is already `battle`.
 * @param {{ fieldId?: unknown, gt?: unknown, events?: unknown, snap?: unknown }} part
 */
export function battlePayload({ fieldId, gt, events, snap }) {
  const list = (Array.isArray(events) ? events : []).map(sanitizeEvent).filter(Boolean).slice(-UI_LIMITS.battleBatch);
  let snapOut = null;
  let truncated = false;
  if (snap && typeof snap === 'object') {
    const flag = { truncated: false };
    const cloned = plainClone(snap, 0, new WeakSet(), flag);
    if (cloned && typeof cloned === 'object' && !Array.isArray(cloned) && cloned.t === 'b.snap') delete cloned.t;
    let text = '';
    try { text = JSON.stringify(cloned); } catch { text = ''; }
    if (text && text.length <= UI_LIMITS.snapshotBytes) snapOut = cloned;
    else truncated = true;
    if (flag.truncated) truncated = true;
  }
  return {
    v: UI_API, t: 'battle',
    fieldId: typeof fieldId === 'string' ? fieldId.slice(0, 64) : null,
    gt: finite(gt),
    events: list, snap: snapOut, truncated,
  };
}

/**
 * The iframe's `src` for one plugin file: its own `/p/<id>/<hash8>/<entry>` (the response carries the frame CSP,
 * `sandbox allow-scripts` included). `sha256` is the file's hash (the URL carries the first 8 hex digits). No redirect
 * page: a page that navigates away from inside its own load handler gets no iframe `load` event in Chrome, which
 * made a redirect step uncountable.
 * @param {string} id @param {string} entry a path inside the plugin (`ui/index.html`) @param {string} sha256
 * @returns {string | null}
 */
export function framePageUrl(id, entry, sha256) {
  if (!isPluginId(id) || !isPackPath(entry) || typeof sha256 !== 'string' || !/^[0-9a-f]{8}/.test(sha256)) return null;
  const path = `/p/${id}/${sha256.slice(0, 8)}/${entry}`;
  return frameEntryAllowed(id, path) ? path : null;
}

/**
 * What the host does with the iframe's Nth `load` (1-based).
 * 1 — the entry HTML. `welcome` may be posted, and `ready` may be accepted.
 * anything else — the frame navigated away from the entry. Destroy it, clear `ready`, post nothing.
 * `postMessage(..., 'null')` cannot tell the entry document from a later opaque one, so the count is the check.
 * @param {number} loadCount
 * @returns {'entry' | 'destroy'}
 */
export function frameLoadDecision(loadCount) {
  return loadCount === 1 ? 'entry' : 'destroy';
}

/**
 * A frame entry the host may load: a same-site path under `/p/<same id>/<hash8>/….html`, no scheme, no `..`, no
 * second host.
 * @param {string} id @param {string} entry
 */
export function frameEntryAllowed(id, entry) {
  if (!isPluginId(id) || typeof entry !== 'string') return false;
  if (entry.includes('\\') || entry.includes('..') || entry.includes('?') || entry.includes('#') || entry.includes('//') || /\s/.test(entry)) return false;
  const m = /^\/p\/([a-z0-9][a-z0-9-]{1,31})\/([0-9a-f]{8})\/(.+\.html)$/.exec(entry);
  return !!m && m[1] === id && isPackPath(m[3]);
}

const RESULT_STATS = ['dmgDealt', 'bossDamage', 'kills', 'leaks', 'lpLost', 'merges', 'itemsEquipped', 'activatedLayers', 'refreshes', 'perfectRounds', 'gold'];

/**
 * Room seats, content identity and plugin ids. Null holes stay, so a 4-seat room reports length 4.
 * The join code, consent and loadouts are dropped. No plugin list and no seats → null.
 * @param {unknown} room
 */
export function subsetRoom(room) {
  if (!isObj(room)) return null;
  const hasSeats = Array.isArray(room.seats);
  /** @type {string[] | null} */
  let plugins = null;
  const listed = isObj(room.content) && Array.isArray(room.content.plugins) ? room.content.plugins : null;
  if (listed) {
    plugins = [];
    for (const p of listed) {
      if (plugins.length >= 32) break;
      const id = isObj(p) && typeof p.id === 'string' ? p.id : typeof p === 'string' ? p : '';
      if (!id || isIntentType(id)) continue;
      plugins.push(id.slice(0, 64));
    }
  }
  if (!hasSeats && !plugins) return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  if (isObj(room.content) && typeof room.content.cs === 'string' && /^[0-9a-f]{64}$/.test(room.content.cs)) out.cs = room.content.cs;
  if (hasSeats) {
    out.seats = room.seats.slice(0, 8).map((s) => {
      if (!isObj(s)) return null;
      /** @type {Record<string, unknown>} */
      const row = {};
      if (typeof s.seat === 'number' && Number.isFinite(s.seat)) row.seat = s.seat;
      if (typeof s.playerId === 'string') row.playerId = s.playerId.slice(0, 64);
      if (typeof s.name === 'string') row.name = s.name.slice(0, 64);
      if (typeof s.isBot === 'boolean') row.isBot = s.isBot;
      if (typeof s.ready === 'boolean') row.ready = s.ready;
      if (typeof s.connected === 'boolean') row.connected = s.connected;
      return row;
    });
  }
  if (plugins) out.plugins = plugins;
  return out;
}

/**
 * Settle stats the result screen already shows. Lineup, diy, seed and the hidden-boss id are not copied.
 * Numbers stay exact (plainClone's caps would cut a damage total).
 * @param {unknown} result
 */
export function subsetResult(result) {
  if (!isObj(result)) return null;
  const players = Array.isArray(result.players) ? result.players.slice(0, 8).map((p) => {
    if (!isObj(p)) return {};
    const statsIn = isObj(p.stats) ? p.stats : {};
    /** @type {Record<string, number>} */
    const stats = {};
    for (const k of RESULT_STATS) {
      const n = num(statsIn[k]);
      if (n != null) stats[k] = n;
    }
    /** @type {Record<string, unknown>} */
    const row = {
      playerId: str(p.playerId, 64),
      seat: num(p.seat),
      name: str(p.name, 64),
      isBot: p.isBot === true,
      left: p.left === true,
      alive: p.alive === true,
      victory: p.victory === true,
      roundsPassed: num(p.roundsPassed),
      creditedKills: num(p.creditedKills),
      eliminatedRound: num(p.eliminatedRound),
      lp: num(p.lp),
      bandId: str(p.bandId, 64),
      stats,
    };
    if (typeof p.title === 'string') row.title = p.title.slice(0, 64);
    if (num(p.trophies) != null) row.trophies = num(p.trophies);
    if (num(p.reward) != null) row.reward = num(p.reward);
    return row;
  }) : [];
  return {
    victory: result.victory === true,
    roundsPassed: num(result.roundsPassed),
    hiddenReached: result.hiddenReached === true,
    hiddenCleared: result.hiddenCleared === true,
    reason: str(result.reason, 64),
    teamLp: num(result.teamLp),
    modeId: str(result.modeId, 64),
    difficulty: str(result.difficulty, 32),
    stageId: str(result.stageId, 64),
    bossId: str(result.bossId, 64),
    durationMs: num(result.durationMs),
    players,
  };
}

/**
 * First change sends immediately (`lastAt` null). A later change inside the interval waits the rest of it.
 * @param {number | null} lastAt @param {number} now @param {number} intervalMs
 * @returns {{ send: boolean, wait: number }}
 */
export function netSlot(lastAt, now, intervalMs) {
  const interval = typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : 1000;
  if (lastAt == null || typeof now !== 'number' || !Number.isFinite(now)) return { send: true, wait: 0 };
  const elapsed = now - lastAt;
  if (elapsed >= interval) return { send: true, wait: 0 };
  return { send: false, wait: Math.max(0, interval - elapsed) };
}

const scalarPref = (v) => {
  if (typeof v === 'string') return v.slice(0, 4096);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  return undefined;
};

/**
 * @param {string} id
 * @param {string[]} slots
 * @param {{ version?: unknown, lang?: unknown, plugins?: unknown, prefs?: unknown, cs?: unknown }} [info]
 *   Omitted: the message stays `{ v, t, id, slots }`.
 */
export function hostWelcome(id, slots, info) {
  const msg = { v: UI_API, t: 'welcome', id, slots: [...slots] };
  if (!isObj(info)) return msg;
  if (typeof info.version === 'number' && Number.isFinite(info.version)) msg.version = info.version;
  if (typeof info.lang === 'string' && info.lang) msg.lang = info.lang.slice(0, 16);
  if (typeof info.cs === 'string' && /^[0-9a-f]{64}$/.test(info.cs)) msg.cs = info.cs;
  if (Array.isArray(info.plugins)) {
    msg.plugins = info.plugins.filter((x) => typeof x === 'string' && !isIntentType(x)).slice(0, 32).map((x) => x.slice(0, 64));
  }
  if (isObj(info.prefs)) {
    /** @type {Record<string, string | number | boolean>} */
    const prefs = {};
    let n = 0;
    for (const k of Object.keys(info.prefs)) {
      if (n >= 32) break;
      if (k === '__proto__' || k === 'constructor' || k === 'prototype' || k.includes('..') || isIntentType(k)) continue;
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(k)) continue;
      const v = scalarPref(info.prefs[k]);
      if (v === undefined) continue;
      prefs[k] = v;
      n += 1;
    }
    msg.prefs = prefs;
  }
  return msg;
}

/**
 * @param {unknown} pub @param {unknown} priv @param {unknown} [room]
 *   A third argument attaches `room` only when subsetRoom keeps seats or plugin ids.
 */
export function hostState(pub, priv, room) {
  const msg = { v: UI_API, t: 'state', public: subsetPublic(pub), private: subsetPrivate(priv) };
  if (arguments.length >= 3) {
    const sub = subsetRoom(room);
    if (sub) msg.room = sub;
    else if (room === null) msg.room = null;
  }
  return msg;
}

/** @param {unknown} result */
export const hostResult = (result) => ({ v: UI_API, t: 'result', result: subsetResult(result) });

/**
 * Connection snapshot. Latency is `rtt` (the store's `ping`). The key `ping` is a client intent and is not used.
 * @param {unknown} conn
 */
export function hostNet(conn) {
  const c = isObj(conn) ? conn : {};
  const err = isObj(c.lastError) ? {
    code: typeof c.lastError.code === 'string' ? c.lastError.code.slice(0, 64) : '',
    text: typeof c.lastError.text === 'string' ? c.lastError.text.slice(0, 120) : '',
  } : null;
  return {
    v: UI_API,
    t: 'net',
    status: typeof c.status === 'string' ? c.status.slice(0, 32) : null,
    attempt: typeof c.attempt === 'number' && Number.isFinite(c.attempt) ? c.attempt : 0,
    retryAt: typeof c.retryAt === 'number' && Number.isFinite(c.retryAt) ? c.retryAt : null,
    rtt: typeof c.ping === 'number' && Number.isFinite(c.ping) ? c.ping : null,
    lastError: err && (err.code || err.text) ? err : null,
  };
}

/** @param {string} reason */
export const hostRejected = (reason) => ({ v: UI_API, t: 'rejected', reason });

/** @param {string} reason @param {string} [text] */
export const hostLimit = (reason, text) => ({ v: UI_API, t: 'limit', reason, ...(text ? { text } : {}) });

/**
 * @param {unknown} raw
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateHostMessage(raw) {
  if (!isObj(raw) || raw.v !== UI_API || typeof raw.t !== 'string' || !HOST_TYPES.has(raw.t)) return { ok: false, reason: 'shape' };
  if (isMatchIntent(raw)) return { ok: false, reason: 'intent' };
  return { ok: true };
}
