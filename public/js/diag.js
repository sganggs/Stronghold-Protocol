// public/js/diag.js — the client's error log and the diagnostics a player copies into a bug report (设置 → 问题反馈).
//
// Nothing leaves the browser. The log is kept in memory (the last LOG_MAX entries, an identical error in a row counted
// on its entry); the report is plain text the player copies and pastes into a GitHub issue, with the player names,
// the room code and the reconnect token replaced and the page's host cut from every URL. A secret is a whole token in
// the prose and an exact string value in the attached battle JSON, so a name never rewrites a longer id. The battle
// on screen can be attached as its BattleSpec (the b.start a browser receives: player ids, no names), which the dev
// tools replay. The report's `traffic:` line sums what this page downloaded (Resource Timing `transferSize`: bytes
// on the wire, 0 for a response from the browser cache) by the categories of shared/assetPaths.js trafficCategory,
// other sites apart as `external` (host bandwidth, layer 0; the server's own counters: /healthz?traffic=1).
//
//   recordError(source, err, detail?)  source: 'error' (uncaught) | 'rejection' (unhandled promise) | 'sim' (a content
//                                      error the battle isolated) | 'runner' (the local battle runner) | 'request'
//                                      (a failed request or error push the player was shown)
//   errorLog() / errorCount() / clearErrorLog()
//   setBattleSource(fn)                the battle runner registers how to read the battle on screen
//   installTrafficMeter() / recordResourceEntry(entry) / trafficSummary() / clearTraffic()   the page's download totals
//   buildDiagnostics(input)            the report text (pure: the state, the environment and the battle are passed in)
//   diagnosticsText({ state, settings, attachBattle })  the report of this page (this browser, the battle on screen)
//
// Report keys are English on purpose: the text is read by developers and searched in issues, whatever the UI language.

import { APP_VERSION } from '../../shared/constants.js';
import { TRAFFIC_CATEGORIES, trafficCategory } from '../../shared/assetPaths.js';

export const LOG_MAX = 40;
export const STACK_LINES = 6;
const MESSAGE_MAX = 300;

/** @type {{ source: string, message: string, stack: string|null, detail: string|null, at: number, lastAt: number, count: number }[]} */
const log = [];
let total = 0;
let dropped = 0;
const pageStart = Date.now();

/** `name: message (code)` of an Error, a NetError, a {code, msg} push, a string or anything else. */
export function messageOf(err) {
  let s;
  if (err == null) s = String(err);
  else if (typeof err === 'string') s = err;
  else if (typeof err === 'object') {
    const name = typeof err.name === 'string' && err.name && err.name !== 'Error' ? `${err.name}: ` : '';
    const text = typeof err.message === 'string' && err.message ? err.message : typeof err.msg === 'string' ? err.msg : '';
    const code = typeof err.code === 'string' || typeof err.code === 'number' ? String(err.code) : '';
    if (text) s = `${name}${text}${code && !text.includes(code) ? ` (${code})` : ''}`;
    else if (code) s = `${name}${code}`;
    else { try { s = JSON.stringify(err); } catch { s = Object.prototype.toString.call(err); } }
  } else s = String(err);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX - 1)}…` : s;
}

/** The first STACK_LINES frames of `err.stack`, each without the page's scheme and host (`/js/ui/x.js:12:5`). */
export function stackOf(err) {
  const raw = err && typeof err === 'object' && typeof err.stack === 'string' ? err.stack : '';
  if (!raw) return null;
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  // V8 starts with "Name: message"; Firefox / Safari list frames only
  const frames = lines.filter((l, i) => !(i === 0 && !/^at |@|:\d+:\d+\)?$/.test(l)));
  const out = frames.slice(0, STACK_LINES).map(stripHosts);
  return out.length ? out.join('\n') : null;
}

/** Cut `scheme://host[:port]` from every URL (a LAN server's address, a domain): the path is what locates the code. */
export const stripHosts = (s) => String(s).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^/\s)]+/gi, '');

/**
 * Record an error. An entry identical to the newest one (same source, message and stack) raises its count instead.
 * @param {string} source @param {any} err @param {string|null} [detail] @param {number} [at] epoch ms
 */
export function recordError(source, err, detail = null, at = Date.now()) {
  const message = stripHosts(messageOf(err));
  const stack = stackOf(err);
  const det = detail == null ? null : stripHosts(String(detail)).slice(0, MESSAGE_MAX);
  total++;
  const last = log[log.length - 1];
  if (last && last.source === source && last.message === message && last.stack === stack && last.detail === det) {
    last.count++;
    last.lastAt = at;
    return last;
  }
  const e = { source: String(source), message, stack, detail: det, at, lastAt: at, count: 1 };
  log.push(e);
  while (log.length > LOG_MAX) { log.shift(); dropped++; }
  return e;
}

/** The log, oldest first (copies). */
export const errorLog = () => log.map((e) => ({ ...e }));
/** Errors recorded on this page (repeats included). */
export const errorCount = () => total;
export function clearErrorLog() { log.length = 0; total = 0; dropped = 0; }

// ---- traffic: what this page downloaded ---------------------------------------------------------------------

/** @type {Map<string, { requests: number, bytes: number, cached: number }>} category → totals */
const traffic = new Map();
let trafficMeter = null;

/**
 * Add one Resource Timing entry (a PerformanceResourceTiming, or the page's own navigation entry) to the totals: bytes
 * on the wire (`transferSize`; headers included, 0 when the browser cache answered — counted as `cached`). A same-origin
 * URL counts under trafficCategory(path), another site's under `external`; data: / blob: URLs are not downloads.
 * @param {{ name?: string, transferSize?: number, decodedBodySize?: number }} entry
 * @param {string} [origin] the page's origin
 */
export function recordResourceEntry(entry, origin = globalThis.location?.origin) {
  if (!entry || typeof entry.name !== 'string') return;
  let u;
  try { u = new URL(entry.name, origin || 'http://localhost'); } catch { return; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
  const cat = origin && u.origin !== origin ? 'external' : trafficCategory(u.pathname);
  let t = traffic.get(cat);
  if (!t) traffic.set(cat, (t = { requests: 0, bytes: 0, cached: 0 }));
  const bytes = Number(entry.transferSize) || 0;
  t.requests++;
  t.bytes += bytes;
  if (bytes === 0 && (Number(entry.decodedBodySize) || 0) > 0) t.cached++;
}

/**
 * Start summing this page's downloads (main.js at boot): the entries already in the Resource Timing buffer, then
 * every new one (a PerformanceObserver also gets the entries a full buffer drops). False where unsupported.
 * @param {any} [win]
 */
export function installTrafficMeter(win = globalThis) {
  if (trafficMeter) return true;
  const PO = win?.PerformanceObserver;
  if (typeof PO !== 'function') return false;
  try {
    const origin = win.location?.origin;
    for (const e of win.performance?.getEntriesByType?.('navigation') || []) recordResourceEntry(e, origin);
    trafficMeter = new PO((list) => { for (const e of list.getEntries()) recordResourceEntry(e, origin); });
    trafficMeter.observe({ type: 'resource', buffered: true });
    return true;
  } catch {
    trafficMeter = null;
    return false;
  }
}

/** The totals so far: `{ [category]: { requests, bytes, cached } }` in report order, plus `total`. */
export function trafficSummary() {
  const out = {};
  const total = { requests: 0, bytes: 0, cached: 0 };
  for (const cat of [...TRAFFIC_CATEGORIES, 'external']) {
    const t = traffic.get(cat);
    if (!t) continue;
    out[cat] = { ...t };
    if (cat !== 'external') { total.requests += t.requests; total.bytes += t.bytes; total.cached += t.cached; }
  }
  out.total = total;
  return out;
}
export function clearTraffic() { traffic.clear(); }

const sizeOf = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
/** `assets 9.7 MB (254, 41 cached) | … | host total 21.4 MB (869)` — the report's traffic line; null when nothing was recorded. */
export function trafficLine(summary) {
  if (!summary || !summary.total || !(summary.total.requests > 0)) return null;
  const parts = Object.entries(summary).filter(([k]) => k !== 'total')
    .map(([k, t]) => `${k} ${sizeOf(t.bytes)} (${t.requests}${t.cached ? `, ${t.cached} cached` : ''})`);
  return `${parts.join(' | ')} | host total ${sizeOf(summary.total.bytes)} (${summary.total.requests})`;
}

let battleSource = null;
/** @param {() => ({ battleId: string, fieldId?: string, kind?: string, spec: object, time?: number }|null)} fn */
export function setBattleSource(fn) { battleSource = typeof fn === 'function' ? fn : null; }
/** The battle on screen for a report, or null. */
export function currentBattle() {
  try { return battleSource ? battleSource() || null : null; } catch { return null; }
}

/** Secrets worth replacing: non-empty strings, later pair winning when the same value is listed twice. */
function secretMap(pairs) {
  const map = new Map();
  for (const [v, ph] of pairs) {
    if (typeof v === 'string' && v.trim()) map.set(v, ph);
  }
  return map;
}

/**
 * Replace each secret only as a whole token, longest first, in one pass (a placeholder is never scanned again).
 * A token is bounded by the start or end of the text, or by anything that is not a letter, a digit or `_`, so
 * "char" does not eat `chess_char_…`, "player" does not eat "players", and "W" does not eat "Windows". "W-W" is
 * two tokens. The left boundary is a consumed character (or the start): a lookbehind is a SyntaxError in Safari
 * before 16.4.
 * @param {string} text @param {[string, string][]} pairs [value, placeholder]
 */
export function redact(text, pairs) {
  const map = secretMap(pairs);
  const list = [...map.keys()].sort((a, b) => b.length - a.length);
  if (!list.length) return String(text);
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = '[\\p{L}\\p{N}_]';
  const re = new RegExp(`(?<pre>^|(?!${word})[\\s\\S])(?<hit>${list.map(esc).join('|')})(?!${word})`, 'gu');
  return String(text).replace(re, (...args) => {
    const g = args[args.length - 1];
    return `${g.pre}${map.get(g.hit)}`;
  });
}

/**
 * Copy `value`, replacing a string only when it is exactly a secret (object keys included). A longer string that
 * merely contains the secret, such as a chess id or a note, is kept. This is what the attached battle JSON uses;
 * token replacement would still rewrite `"charge the char"` when the name is `char`.
 * @param {any} value @param {[string, string][]} pairs
 */
export function redactValues(value, pairs) {
  const map = secretMap(pairs);
  const walk = (v) => {
    if (typeof v === 'string') return map.has(v) ? map.get(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[map.has(k) ? map.get(k) : k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}

/** [value, placeholder] pairs of what a report must not show: player names, the room code, the reconnect token. */
export function secretsOf(state) {
  const pairs = [];
  const names = new Map();
  const addName = (n) => {
    if (typeof n !== 'string' || !n.trim() || names.has(n)) return;
    names.set(n, n === state?.me?.name ? '<me>' : `<player${names.size + 1}>`);
  };
  addName(state?.me?.name);
  for (const s of state?.room?.seats || []) addName(s?.name);
  for (const s of state?.room?.spectators || []) addName(s?.name);
  for (const p of state?.match?.public?.players || []) addName(p?.name);
  for (const [n, ph] of names) pairs.push([n, ph]);
  if (state?.room?.code) pairs.push([String(state.room.code), '<room>']);
  if (state?.me?.token) pairs.push([String(state.me.token), '<token>']);
  return pairs;
}

const pad2 = (n) => String(n).padStart(2, '0');
const clockOf = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`; };
const spanOf = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${pad2(Math.floor(s / 60) % 60)}m` : `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
};
const join = (...parts) => parts.filter((p) => p != null && p !== '' && p !== false).join(' | ');

/**
 * The report text: a ```text block (version, time, browser, screen, connection, where the player is, settings, the
 * error log newest first) and, with `battle`, a ```json block of its spec. Secrets of `state` are whole tokens in the
 * prose and exact string values in the JSON.
 * @param {{ state: any, env?: any, settings?: any, battle?: any, entries?: any[], dropped?: number, total?: number,
 *   now?: number, pageStart?: number, version?: string, traffic?: ReturnType<typeof trafficSummary> | null }} input
 */
export function buildDiagnostics(input) {
  const { state = {}, env = {}, settings = null, battle = null, traffic: trafficTotals = null } = input;
  const entries = input.entries ?? errorLog();
  const now = input.now ?? Date.now();
  const lines = [];
  lines.push('Stronghold-Protocol diagnostics');
  lines.push(`version: ${input.version ?? APP_VERSION}`);
  lines.push(`time: ${new Date(now).toISOString()} | page open ${spanOf(now - (input.pageStart ?? pageStart))}`);
  if (env.ua) lines.push(`browser: ${env.ua}`);
  if (env.gpu) lines.push(`gpu: ${env.gpu}`);
  lines.push(`device: ${join(env.viewport, env.dpr ? `@${env.dpr}x` : null, env.touch ? 'touch' : null, env.cores ? `${env.cores} threads` : null,
    env.memoryGB ? `${env.memoryGB} GB` : null, env.lang ? `lang ${env.lang}` : null, env.uiLang ? `ui ${env.uiLang}` : null) || 'unknown'}`);
  const c = state.connection || {};
  lines.push(`connection: ${join(c.status || 'unknown', Number.isFinite(c.ping) ? `ping ${Math.round(c.ping)} ms` : null,
    c.attempt ? `retry ${c.attempt}` : null, c.lastError ? `last error ${messageOf(c.lastError)}` : null)}`);
  const pub = state.match?.public || null;
  const room = state.room || null;
  lines.push(`where: ${join(pub?.phase ? `phase ${pub.phase}` : room ? 'room' : state.session?.entered ? 'lobby' : 'title',
    Number.isFinite(pub?.round) ? `round ${pub.round}` : null, room?.mode ? `mode ${room.mode}` : null,
    room?.difficulty ? `difficulty ${room.difficulty}` : null,
    Array.isArray(pub?.players) ? `players ${pub.players.length}` : Array.isArray(room?.seats) ? `seats ${room.seats.filter(Boolean).length}` : null)}`);
  const b = state.match?.battle || null;
  if (b) {
    lines.push(`battle: ${join(b.kind, b.fieldId ? `field ${b.fieldId}` : null, b.authoritative ? 'authoritative' : b.watch ? 'watching' : null,
      b.done ? 'done' : b.loading ? 'loading' : 'running', b.paused ? 'paused' : null, Number.isFinite(b.speed) ? `${b.speed}x` : null)}`);
  }
  if (settings) {
    lines.push(`settings: ${join(`quality ${settings.quality}`, settings.damageNumbers ? 'damage numbers' : null, settings.officialDamageNumbers ? 'official damage numbers' : null, settings.ammoCount ? 'ammo count' : null, settings.muted ? 'muted' : null)}`);
  }
  const tl = trafficLine(trafficTotals);
  if (tl) lines.push(`traffic: ${tl}`);
  const shown = entries.slice().reverse();
  const tot = input.total ?? total;
  const drop = input.dropped ?? dropped;
  lines.push('');
  lines.push(`errors: ${tot ? `${tot} recorded${drop ? `, ${drop} oldest entries dropped` : ''}` : 'none recorded'}`);
  shown.forEach((e, i) => {
    lines.push(`#${i + 1} ${clockOf(e.at)}${e.count > 1 ? ` (x${e.count}, last ${clockOf(e.lastAt)})` : ''} ${e.source}: ${e.message}`);
    if (e.detail) lines.push(`   ${e.detail}`);
    if (e.stack) for (const l of e.stack.split('\n')) lines.push(`   ${l}`);
  });
  const pairs = secretsOf(state);
  let text = redact(`\`\`\`text\n${lines.join('\n')}\n\`\`\``, pairs);
  if (battle && battle.spec) {
    const head = join(`battle ${battle.battleId}`, battle.kind, Number.isFinite(battle.spec.round) ? `round ${battle.spec.round}` : null,
      Number.isFinite(battle.time) ? `copied at ${battle.time.toFixed(2)} s` : null);
    const payload = redactValues({
      t: 'b.start', battleId: battle.battleId, fieldId: battle.fieldId, kind: battle.kind, spec: battle.spec,
    }, pairs);
    text += `\n\n${redact(head, pairs)}\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  }
  return text;
}

let gpuName;
/** What the report says about this browser and device (null fields stay out). */
export function browserEnv() {
  const g = globalThis;
  if (gpuName === undefined) {
    gpuName = null;
    try {
      const cv = g.document?.createElement('canvas');
      const gl = cv && (cv.getContext('webgl2') || cv.getContext('webgl'));
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      gpuName = gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL';
    } catch { gpuName = null; }
  }
  let uiLang = null;
  try { uiLang = g.document?.documentElement?.lang || null; } catch { /* ignore */ }
  return {
    ua: g.navigator?.userAgent ?? null,
    gpu: gpuName,
    viewport: Number.isFinite(g.innerWidth) ? `${g.innerWidth}x${g.innerHeight}` : null,
    dpr: g.devicePixelRatio ?? null,
    touch: !!(g.matchMedia && g.matchMedia('(pointer: coarse)').matches),
    cores: g.navigator?.hardwareConcurrency ?? null,
    memoryGB: g.navigator?.deviceMemory ?? null,
    lang: g.navigator?.language ?? null,
    uiLang,
  };
}

/**
 * The report of this page: the given store state and settings, this browser, the log and, with `attachBattle`, the
 * battle on screen.
 * @param {{ state: any, settings?: any, attachBattle?: boolean }} opts
 */
export function diagnosticsText({ state, settings = null, attachBattle = false }) {
  return buildDiagnostics({ state, settings, env: browserEnv(), battle: attachBattle ? currentBattle() : null, traffic: trafficSummary() });
}
