// server/http/config.js — where the server's settings come from. startServer() options win over the environment:
//
//   * PORT (default 3000), HOST (default '::', one dual-stack socket for IPv6 and IPv4);
//   * TRUST_PROXY ('auto' default: honour CF-Connecting-IP / X-Real-IP / X-Forwarded-For only from loopback/private
//     peers such as a local cloudflared; '1' always; '0' never) → net.js trustProxy;
//   * DEBUG → the console logger's debug level;
//   * SP_MAX_ROOMS, SP_MAX_ROOMS_PER_ADDR, SP_MAX_MATCHES_PER_ADDR, SP_MAX_CONNECTIONS and SP_MAX_CONNECTIONS_PER_ADDR
//     override the room / match / socket caps. A global cap of 0 (SP_MAX_ROOMS, SP_MAX_CONNECTIONS) rejects everything,
//     a per-network cap of 0 (the _PER_ADDR ones) is unlimited; a value that is not a non-negative integer is ignored
//     with a warning when the server starts, and an explicit startServer() option still wins over the environment;
//   * SP_ASSET_INDEX=0 (or the `assetIndex: false` option) → no content-hash index: plain asset URLs, size-mtime ETags
//     (assetIndex.js); the index of the default public/ persists in .cache/asset-hashes.json;
//   * the served directories (public/, data/, shared/, the content packs' packs/ and the plugins' plugins/ of this
//     repository unless the options name others), and which startServer() options are handed on to net.js Network and
//     lobby.js Lobby.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** startServer() options handed on to net.js Network / lobby.js Lobby (an absent one keeps that module's default). */
const NET_OPTION_KEYS = ['reconnectWindowMs', 'heartbeatMs', 'helloTimeoutMs', 'ratePerSec', 'rateBurst', 'maxConnections', 'abuseDropsPerSec',
  'maxConnectionsPerAddr', 'heavyPerSec', 'heavyBurst', 'trustProxy'];
const LOBBY_OPTION_KEYS = ['lobbyGraceMs', 'maxRooms', 'maxRoomsPerAddr', 'maxMatchesPerAddr', 'resyncMinGapMs', 'soloReconnectWindowMs'];

/**
 * Bind address used when neither the `host` option nor `HOST` says otherwise: one dual-stack socket, so the server
 * answers IPv6 and IPv4 alike without a second listener (Node keeps `ipv6Only` off for `::`).
 * `HOST=0.0.0.0` still means IPv4 only, `HOST=127.0.0.1` still means loopback only (a reverse proxy in front).
 */
export const DEFAULT_BIND_HOST = '::';

/**
 * Where to listen: the `port` / `host` options, else PORT / HOST, else port 3000 on DEFAULT_BIND_HOST.
 * An empty host is treated as unset.
 * @param {{ port?: number, host?: string }} opts
 * @returns {{ port: number, host: string }}
 * @throws {RangeError} when the port is not an integer in 0…65535
 */
export function listenAddress(opts) {
  const port = opts.port ?? (process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : 3000);
  const host = (opts.host || process.env.HOST) || DEFAULT_BIND_HOST;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError(`invalid PORT ${port}`);
  return { port, host };
}

/**
 * The hosts to try, in order, for a bind. Only the default is retried: a host with IPv6 switched off refuses `::`
 * with EAFNOSUPPORT / EADDRNOTAVAIL / EINVAL, and falling back to IPv4 beats not booting. An explicit HOST is literal.
 * @param {string} host a host out of listenAddress()
 * @returns {string[]}
 */
export function bindCandidates(host) {
  return host === DEFAULT_BIND_HOST ? [DEFAULT_BIND_HOST, '0.0.0.0'] : [host];
}

/**
 * The directories the static server reads (packsDir: the pack folders, pluginsDir: the plugin folders —
 * server/plugins/registry.js; default: the plugins/ folder beside packsDir, so a server given its own packs folder —
 * a test — never reads this checkout's plugins).
 * @param {{ publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string, pluginsDir?: string }} opts
 */
export function serveDirs(opts) {
  const packsDir = opts.packsDir || path.join(ROOT, 'packs');
  return {
    publicDir: opts.publicDir || path.join(ROOT, 'public'),
    dataDir: opts.dataDir || path.join(ROOT, 'data'),
    sharedDir: opts.sharedDir || path.join(ROOT, 'shared'),
    packsDir,
    pluginsDir: opts.pluginsDir || path.join(path.dirname(path.resolve(packsDir)), 'plugins'),
  };
}

/**
 * The asset index options out of the startServer() options and the environment, or null for none: `assetIndex: false`
 * or SP_ASSET_INDEX=0 / off / false / no switches it off; `assetIndex: { cacheFile, delayMs }` overrides the defaults.
 * The hashes persist in .cache/asset-hashes.json only for the repository's own public/ (a test's temporary folder keeps
 * them in memory).
 * @param {{ assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number } }} opts
 * @param {string} publicDir
 * @returns {{ cacheFile: string | null, delayMs?: number } | null}
 */
export function assetIndexOptionsFrom(opts, publicDir) {
  if (opts.assetIndex === false) return null;
  const env = String(process.env.SP_ASSET_INDEX ?? '').trim().toLowerCase();
  if (opts.assetIndex == null && ['0', 'off', 'false', 'no'].includes(env)) return null;
  const o = typeof opts.assetIndex === 'object' && opts.assetIndex ? opts.assetIndex : {};
  const own = path.resolve(publicDir) === path.join(ROOT, 'public');
  const cacheFile = o.cacheFile !== undefined ? o.cacheFile : (own ? path.join(ROOT, '.cache', 'asset-hashes.json') : null);
  return { cacheFile, ...(Number.isFinite(o.delayMs) ? { delayMs: o.delayMs } : {}) };
}

/**
 * net.js Network options out of the startServer() options; `trustProxy` falls back to TRUST_PROXY.
 * @param {Record<string, any>} opts @param {{ warn?: (m: string) => void } | null} [log] the server logger, for a junk SP_MAX_*
 */
export function netOptionsFrom(opts, log = null) {
  const netOptions = {};
  for (const k of NET_OPTION_KEYS) {
    if (opts[k] != null) netOptions[k] = opts[k];
  }
  if (netOptions.trustProxy == null) netOptions.trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  applyEnvLimits(netOptions, NET_LIMIT_ENV, log);
  return netOptions;
}

/**
 * lobby.js Lobby options out of the startServer() options.
 * @param {Record<string, any>} opts @param {{ warn?: (m: string) => void } | null} [log] the server logger, for a junk SP_MAX_*
 */
export function lobbyOptionsFrom(opts, log = null) {
  const lobbyOptions = {};
  for (const k of LOBBY_OPTION_KEYS) {
    if (opts[k] != null) lobbyOptions[k] = opts[k];
  }
  applyEnvLimits(lobbyOptions, LOBBY_LIMIT_ENV, log);
  return lobbyOptions;
}

/** Socket caps that SP_MAX_CONNECTIONS / SP_MAX_CONNECTIONS_PER_ADDR may override (net.js). */
const NET_LIMIT_ENV = [['maxConnections', 'SP_MAX_CONNECTIONS'], ['maxConnectionsPerAddr', 'SP_MAX_CONNECTIONS_PER_ADDR']];
/** Room / match caps that SP_MAX_ROOMS / SP_MAX_ROOMS_PER_ADDR / SP_MAX_MATCHES_PER_ADDR may override (lobby.js). */
const LOBBY_LIMIT_ENV = [['maxRooms', 'SP_MAX_ROOMS'], ['maxRoomsPerAddr', 'SP_MAX_ROOMS_PER_ADDR'], ['maxMatchesPerAddr', 'SP_MAX_MATCHES_PER_ADDR']];

/**
 * One limit out of the environment: an empty or absent value keeps `fallback`; an unusable one warns and keeps it too,
 * because a typo must never silently drop a protection. '0' is meaningful, not junk: on a global cap it rejects
 * everything, on a per-network cap it is unlimited.
 * @param {string | undefined} raw @param {number | null} fallback @param {string} name @param {any} [log]
 * @returns {number | null}
 */
export function parseEnvLimit(raw, fallback, name, log = null) {
  const s = String(raw ?? '').trim();
  if (s === '') return fallback;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000) {
    log?.warn?.(`[http] ${name}=${s} ignored: a non-negative integer is required, keeping the default`);
    return fallback;
  }
  return n;
}

/** Fills each cap from its SP_MAX_* variable unless an explicit startServer() option already set it. */
function applyEnvLimits(target, table, log) {
  for (const [key, envName] of table) {
    if (target[key] != null) continue;
    const v = parseEnvLimit(process.env[envName], null, envName, log);
    if (v != null) target[key] = v;
  }
}

/** TRUST_PROXY env → net.js trustProxy ('auto' unless explicitly on/off). @param {string | undefined} v */
export function parseTrustProxy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'always'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', 'never'].includes(s)) return false;
  return 'auto';
}

/** The console logger (`quiet` → silent; debug lines only with DEBUG set). */
export function makeLogger(quiet) {
  if (quiet) return noopLog;
  return {
    info: (...a) => console.log(...a),
    warn: (...a) => console.warn(...a),
    error: (...a) => console.error(...a),
    debug: process.env.DEBUG ? (...a) => console.debug(...a) : () => {},
  };
}
