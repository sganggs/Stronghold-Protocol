// aldus/worker/engine/glue.js — the bridge between the Rust Worker and the match engine of the original project.
//
// The Rust code (src/) owns the sockets, the sessions, the rooms and the storage. It does not know one rule of the
// game: every rule stays in the original files, which this module imports unchanged. build-engine.mjs bundles this
// module with them and with the game data into engine.bundle.js; entry.mjs loads the bundle, which puts the functions
// below on `globalThis.SP_ENGINE`, where src/engine.rs finds them.
//
// The boundary is text: a message crosses it as the JSON string the socket carried, an answer as a JSON string. A
// Match crosses it as an opaque handle (the object itself), which Rust keeps and hands back.
//
//   init()                                  → JSON: the constants of the protocol and of the lobby
//   inspect(text)                           → JSON: { t, rid, detail } — `detail` non-null when the frame is refused
//   sanitizeName(raw)                       → the nickname as the server keeps it, '' when nothing is left
//   checkLoadout(entriesJson)               → JSON: { ok, loadout } | { error, detail }
//   randomHex(bytes) / randomU32()          → the server's randomness (tokens, ids, room codes, seeds)
//   createMatch(optsJson, send, broadcast, onEnd) → Match     (server/match/Match.js: the MATCH INTERFACE in its header)
//   matchStart(m) · matchHandle(m, playerId, msgJson) → JSON · matchCall(m, method, playerId)
//   matchSetLoadout(m, playerId, loadoutJson) → JSON · matchDispose(m) · matchDisposeLater(m)
//
// `send(playerId, json) → boolean`, `broadcast(json)` and `onEnd(json)` are Rust closures. The engine calls them while
// Rust is inside matchStart / matchHandle, and also from its own timers.

import { Match } from '../../../server/match/Match.js';
import { getData, lookup } from '../../../server/data.js';
import { setSimData } from '../../../server/sim/simdata.js';
import { sanitizeName as sanitize, NET_DEFAULTS } from '../../../server/net.js';
import { BOT_NAMES, CODE_ALPHABET, LOBBY_DEFAULTS, SOLO_RECONNECT_FALLBACK_SEC } from '../../../server/lobby.js';
import { C2S, validateC2S, checkLoadout as check } from '../../../shared/protocol.js';
import { ERR, ERR_TEXT, PROTOCOL_VERSION, APP_VERSION, MAX_SEATS, ROOM_CODE_LEN, modeIdFor } from '../../../shared/constants.js';

const log = {
  info() {},
  debug() {},
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};
const quiet = { info() {}, debug() {}, warn() {}, error: (...a) => console.error(...a) };

/** The game data, parsed on the first use (never while the Worker starts: the start has a short time limit). */
let data = null;
function gameData() {
  if (!data) {
    data = getData({ log: quiet });
    // the simulation is on its browser path here (no Node loader): it takes the data the same way a page gives it
    setSimData(data);
  }
  return data;
}

const isErr = (code) => typeof code === 'string' && Object.hasOwn(ERR, code);
const result = (r) => JSON.stringify(r && typeof r === 'object' && r.error
  ? { error: isErr(r.error) ? r.error : ERR.INTERNAL, detail: typeof r.detail === 'string' ? r.detail : null }
  : { ok: true });

function init() {
  const d = gameData();
  const solo = d?.config?.constants?.singleReconnectTime;
  return JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    appVersion: APP_VERSION,
    errText: ERR_TEXT,
    maxSeats: MAX_SEATS,
    roomCodeLen: ROOM_CODE_LEN,
    codeAlphabet: CODE_ALPHABET,
    botNames: BOT_NAMES,
    lobbyGraceMs: LOBBY_DEFAULTS.lobbyGraceMs,
    maxRooms: LOBBY_DEFAULTS.maxRooms,
    reconnectWindowMs: NET_DEFAULTS.reconnectWindowMs,
    helloTimeoutMs: NET_DEFAULTS.helloTimeoutMs,
    soloResumeMs: (typeof solo === 'number' && Number.isFinite(solo) && solo > 0 ? solo : SOLO_RECONNECT_FALLBACK_SEC) * 1000,
    dataFiles: Object.keys(d).length,
  });
}

/** The checks server/net.js onFrame does before it acts on a frame, in the same order and with the same texts. */
function inspect(text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return JSON.stringify({ t: null, rid: null, detail: 'invalid json' }); }
  const rid = msg && typeof msg === 'object' && Number.isInteger(msg.rid) && msg.rid >= 0 && msg.rid <= 2 ** 31 ? msg.rid : null;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string' || !Object.hasOwn(C2S, msg.t)) {
    const t = msg && typeof msg === 'object' ? String(msg.t).slice(0, 32) : typeof msg;
    return JSON.stringify({ t: null, rid, detail: `unknown type ${t}` });
  }
  return JSON.stringify({ t: msg.t, rid, detail: validateC2S(msg) });
}

const sanitizeName = (raw) => sanitize(raw) || '';

function checkLoadout(entriesJson) {
  let entries;
  try { entries = JSON.parse(entriesJson); } catch { return JSON.stringify({ error: ERR.BAD_MSG, detail: 'bad loadout entries' }); }
  const d = gameData();
  const res = check(entries, (id) => lookup('chess', id, d));
  if (!res || res.error) return JSON.stringify({ error: res && isErr(res.error) ? res.error : ERR.BAD_MSG, detail: (res && res.detail) || null });
  return JSON.stringify({ ok: true, loadout: res.loadout });
}

const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomU32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

function createMatch(optsJson, send, broadcast, onEnd) {
  const o = JSON.parse(optsJson);
  const freeze = (l) => (l ? Object.freeze(Object.fromEntries(Object.entries(l).map(([id, e]) => [id, Object.freeze({ skill: e.skill, module: e.module ?? null })]))) : null);
  return new Match({
    roomCode: o.roomCode,
    mode: o.mode,
    difficulty: o.difficulty,
    modeId: modeIdFor(o.mode, o.difficulty),
    seats: o.seats.map((s) => ({ ...s, loadout: s.isBot ? null : freeze(s.loadout) })),
    seed: o.seed >>> 0,
    matchNo: o.matchNo,
    data: gameData(),
    log,
    now: Date.now,
    send: (playerId, msg) => { try { return !!send(playerId, JSON.stringify(msg)); } catch (e) { console.error('[glue] send', e); return false; } },
    broadcast: (msg) => { try { broadcast(JSON.stringify(msg)); } catch (e) { console.error('[glue] broadcast', e); } },
    onEnd: (summary) => { try { onEnd(JSON.stringify(summary ?? null)); } catch (e) { console.error('[glue] onEnd', e); } },
  });
}

const matchStart = (m) => m.start();

function matchHandle(m, playerId, msgJson) {
  let res;
  try { res = m.handle(playerId, JSON.parse(msgJson)); } catch (e) { console.error('[glue] match.handle threw', e); return result({ error: ERR.INTERNAL }); }
  return result(res);
}

/** onDisconnect / onReconnect / onLeave; onLeave falls back to onDisconnect (server/lobby.js callMatch). */
function matchCall(m, method, playerId) {
  let fn = m[method];
  if (typeof fn !== 'function' && method === 'onLeave') fn = m.onDisconnect;
  if (typeof fn !== 'function') return;
  try { fn.call(m, playerId); } catch (e) { console.error(`[glue] match.${method} threw`, e); }
}

function matchSetLoadout(m, playerId, loadoutJson) {
  if (typeof m.setLoadout !== 'function') return result({ error: ERR.ROOM_STARTED, detail: 'stored for the next match' });
  try { return result(m.setLoadout(playerId, JSON.parse(loadoutJson))); } catch (e) { console.error('[glue] match.setLoadout threw', e); return result({ error: ERR.INTERNAL }); }
}

const matchDispose = (m) => { try { m.dispose?.(); } catch (e) { console.error('[glue] match.dispose threw', e); } };
/** The lobby disposes an ended match on the next macrotask, so the match can finish the call that ended it. */
const matchDisposeLater = (m) => { setTimeout(() => matchDispose(m), 0); };

globalThis.SP_ENGINE = {
  init, inspect, sanitizeName, checkLoadout, randomHex, randomU32,
  createMatch, matchStart, matchHandle, matchCall, matchSetLoadout, matchDispose, matchDisposeLater,
};
