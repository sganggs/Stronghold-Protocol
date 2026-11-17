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
//   * SP_VERSIONS ('all' or a comma list of shared/versions.js ids), SP_VERSION_DEFAULT and SP_MAX_VERSION_HOSTS (or the
//     `versions: { enabled, default, maxHosts }` option, which wins) → the official versions this server offers
//     (DESIGN §35.23, versionsFrom): every registry id unless one of them narrows the list (SP_VERSIONS=act2autochess
//     is 第二期下半 alone, the switch off);
//   * the served directories (public/, data/, shared/, the content packs' packs/ and the plugins' plugins/ of this
//     repository unless the options name others), and which startServer() options are handed on to net.js Network and
//     lobby.js Lobby.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOM_CODE_LEN } from '../../shared/constants.js';

import { DEFAULT_VERSION, LOBBY_DEFAULT_VERSION, VERSIONS, versionById } from '../../shared/versions.js';

/** Repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** startServer() options handed on to net.js Network / lobby.js Lobby (an absent one keeps that module's default). */
const NET_OPTION_KEYS = ['reconnectWindowMs', 'heartbeatMs', 'helloTimeoutMs', 'ratePerSec', 'rateBurst', 'maxConnections', 'maxOnline', 'abuseDropsPerSec',
  'maxConnectionsPerAddr', 'heavyPerSec', 'heavyBurst', 'trustProxy'];
const LOBBY_OPTION_KEYS = ['lobbyGraceMs', 'maxRooms', 'maxRoomsPerAddr', 'maxMatchesPerAddr', 'resyncMinGapMs', 'soloReconnectWindowMs', 'versionVoteMs', 'versionRetryMs'];

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
 * A fixed alliance key passed to one server instance: four letters or digits, upper-cased, or null for the random
 * code every room gets. `--room-code` (server/index.js) and startServer({ roomCode }) share this parser; a blank value
 * means random. Anything else is refused at boot instead of silently falling back to random — a private server that
 * expects the same key should not start with a different one. There is no environment variable: the value lives only
 * in the process that was started with it, so stopping the server ends it.
 * @param {unknown} v
 * @returns {string | null}
 * @throws {RangeError} a value that is neither blank nor ROOM_CODE_LEN letters or digits
 */
export function parseRoomCode(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const code = s.toUpperCase();
  if (code.length !== ROOM_CODE_LEN || !/^[A-Z0-9]+$/.test(code)) {
    throw new RangeError(`invalid fixed alliance key: use ${ROOM_CODE_LEN} letters or digits (A-Z, 0-9)`);
  }
  return code;
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
  // Per instance only: startServer({ roomCode }) or the --room-code argument parsed by server/index.js. No environment
  // variable is read here, so a stop / restart without the argument is random again.
  const roomCode = parseRoomCode(opts.roomCode);
  if (roomCode) lobbyOptions.roomCode = roomCode;
  return lobbyOptions;
}

/** Socket caps that SP_MAX_CONNECTIONS / SP_MAX_CONNECTIONS_PER_ADDR may override (net.js). */
const NET_LIMIT_ENV = [['maxConnections', 'SP_MAX_CONNECTIONS'], ['maxConnectionsPerAddr', 'SP_MAX_CONNECTIONS_PER_ADDR'], ['maxOnline', 'SP_MAX_ONLINE']];
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

/**
 * The official versions this server offers (DESIGN §35.23): the `versions` option, else SP_VERSIONS ('all' or a comma
 * list of registry ids), SP_VERSION_DEFAULT and SP_MAX_VERSION_HOSTS. Nothing set enables every registry id (the lobby
 * switch on; the lobby preselects shared/versions.js LOBBY_DEFAULT_VERSION, 规程·序列Ⅰ, else act2autochess). SP_VERSIONS
 * or `versions.enabled` narrows that list — SP_VERSIONS=act2autochess is 第二期下半 alone, the switch off. An unknown id is warned about and dropped; nothing left
 * keeps act2autochess alone; a default that is not enabled is warned about and replaced by the first enabled id in
 * registry order. `enabled` comes out in registry order. `maxHosts` caps the version match hosts (server/match/host,
 * kind 'version' — forked on the first match of a version, never at boot): by default one per enabled non-default
 * version, and at least 1 whenever there is one.
 * @param {{ versions?: { enabled?: 'all' | string[], default?: string, maxHosts?: number } }} opts
 * @param {{ warn?: (m: string) => void } | null} [log]
 * @returns {{ enabled: string[], default: string, maxHosts: number }}
 */
export function versionsFrom(opts, log = null) {
  const o = opts.versions && typeof opts.versions === 'object' ? opts.versions : {};
  const envList = String(process.env.SP_VERSIONS ?? '').trim();
  /** @type {unknown} */
  let wanted = o.enabled ?? (envList === '' ? null : (envList.toLowerCase() === 'all' ? 'all' : envList.split(',')));
  // Nothing set: every official version (registry order). A set list, including one id, narrows it.
  if (wanted == null) wanted = 'all';
  let ids;
  if (wanted === 'all') ids = VERSIONS.map((v) => v.id);
  else {
    const list = Array.isArray(wanted) ? wanted : [wanted];
    ids = [];
    for (const raw of list) {
      const id = String(raw ?? '').trim();
      if (id === '') continue;
      if (!versionById(id)) log?.warn?.(`[versions] unknown version "${id}" ignored (shared/versions.js lists ${VERSIONS.map((v) => v.id).join(', ')})`);
      else if (!ids.includes(id)) ids.push(id);
    }
  }
  if (!ids.length) {
    log?.warn?.(`[versions] no known version enabled, keeping ${DEFAULT_VERSION}`);
    ids = [DEFAULT_VERSION];
  }
  const enabled = VERSIONS.map((v) => v.id).filter((id) => ids.includes(id));
  const envDefault = String(process.env.SP_VERSION_DEFAULT ?? '').trim();
  const want = o.default != null ? String(o.default).trim() : (envDefault || null);
  // unset: the lobby preselects the running season (LOBBY_DEFAULT_VERSION) when enabled, else 第二期下半, else the first
  let def = want ?? [LOBBY_DEFAULT_VERSION, DEFAULT_VERSION].find((id) => enabled.includes(id)) ?? enabled[0];
  if (!enabled.includes(def)) {
    log?.warn?.(`[versions] default version "${def}" is not enabled, using ${enabled[0]}`);
    def = enabled[0];
  }
  const nonDefault = enabled.filter((id) => id !== DEFAULT_VERSION).length;
  let maxHosts = Number.isSafeInteger(o.maxHosts) && /** @type {number} */ (o.maxHosts) >= 0 ? /** @type {number} */ (o.maxHosts)
    : parseEnvLimit(process.env.SP_MAX_VERSION_HOSTS, nonDefault, 'SP_MAX_VERSION_HOSTS', log) ?? nonDefault;
  if (nonDefault > 0 && maxHosts < 1) {
    log?.warn?.(`[versions] maxHosts ${maxHosts} raised to 1: ${nonDefault} non-default version(s) need a match host`);
    maxHosts = 1;
  }
  return { enabled, default: def, maxHosts };
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
