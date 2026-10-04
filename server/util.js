// server/util.js — tiny server-only shared helpers (never served to the browser).
//
// This is the single home of the `noopLog` logger, the platform reply shapes `OK` / `fail` and any other
// dependency-free scalar helper used across `server/*` and `server/match/*`. It must NOT import anything
// that the browser loads (no `server/sim/*`, no `shared/protocol.js`): its consumers (index/net/lobby/Match)
// are Node-only. Scalar helpers that `server/sim/*` (browser-served) needs live in `server/sim/util.js`.

/** No-op logger with the same shape as the real one (info/warn/error/debug). */
export const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** Shared success reply of an intent handler: `{ ok: true }` (frozen). */
export const OK = Object.freeze({ ok: true });

/**
 * Shared failure reply of an intent handler.
 * @param {string} error ERR code (shared/constants.js)
 * @param {string} [detail] developer-facing reason
 * @returns {{ error: string, detail?: string }}
 */
export const fail = (error, detail) => (detail ? { error, detail } : { error });
