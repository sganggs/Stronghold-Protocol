// server/plugins/install.js — install a plugin zip into plugins/<id>/ (DESIGN §32.13, docs/PLUGINS.md §17). The CLI
// (tools/plugin.mjs install) and the studio (POST /studio/api/catalog/install) share it. A local zip is installed as it
// is; an https URL is downloaded by this process (the browser never uploads the zip), and only when a sha256 is given.
// The hash is checked on the bytes. The zip is extracted with readPluginZip (no traversal, no links, no bombs), written
// under plugins/_incoming/, and checkPluginFolder must pass. It is then renamed into plugins/<id>/. The same id is left
// untouched unless force: the old folder is renamed to plugins/_replaced/<id>-<time>/ and is not deleted (movePluginAside,
// which the studio's removal uses for plugins/_removed/ too). No file of the package is imported, spawned or otherwise run.
//
// [ASSUMED] a zip download waits 60 s and a catalogue document 20 s. That one deadline covers DNS, every redirect and
// the body. At most 5 redirects. Each hop must be https, port 443 (unless the operator allowlist names the host), and
// a public address: the literal host and, on the connection, every address it resolves to. A catalogue document is at
// most CATALOG_FETCH_MAX_BYTES (1 MB). The zip cap is PLUGIN_MAX_BYTES, the largest class ceiling (a cosmetic pack may
// be 512 MB); checkPluginFolder enforces the ceiling of the class plugin.json names. The operator allowlist is
// SP_PLUGIN_DOWNLOAD_ALLOW and plugins/config.json `allowDownloadHosts` (exact host, optional :port; no wildcards;
// default empty). A catalogue document cannot add itself to that list. A missing or broken config does not block a
// public download. The replaced-folder stamp is UTC YYYYMMDD-HHMMSS-mmm, with -2, -3, … if that name is taken.
// `bytes` on a catalogue entry, when install is told it, must equal the download. A failed check deletes only the
// temporary folder. A class this build will not load (script, trusted) may still be stored when the check passes; it
// is not executed. The installed folder name is the single wrapping folder when that folder is a plugin id, otherwise
// `id` in plugin.json. A leading // is a UNC file path, not a protocol-relative URL, and is never fetched.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PLUGIN_LIMITS, PLUGIN_MANIFEST, PLUGIN_MAX_BYTES, isPluginId } from '../../shared/plugins/manifest.js';
import { CATALOG_FETCH_MAX_BYTES, isCatalogUrl } from '../../shared/plugins/catalog.js';
import { isContentHash } from '../../shared/plugins/identity.js';
import { checkPluginFolder } from './pack.js';
import { readPluginZip } from './zip.js';

/** [ASSUMED] see the header. */
export const ZIP_FETCH_TIMEOUT_MS = 60 * 1000;
/** [ASSUMED] see the header. */
export const CATALOG_FETCH_TIMEOUT_MS = 20 * 1000;
/** [ASSUMED] see the header. */
export const MAX_REDIRECTS = 5;
/**
 * The zip cap install enforces before the archive is opened. It is the largest class ceiling (PLUGIN_MAX_BYTES): the
 * class is read from plugin.json only after extraction, and checkPluginFolder then enforces that class's own ceiling.
 * Tests assert this stays PLUGIN_MAX_BYTES.
 */
export const INSTALL_MAX_BYTES = PLUGIN_MAX_BYTES;

const STATUS = Object.freeze({
  PLUGIN_CATALOG_SHAPE: 400,
  PLUGIN_CATALOG_URL: 400,
  PLUGIN_CATALOG_HASH: 400,
  PLUGIN_CATALOG_ID: 400,
  PLUGIN_CATALOG_FIELD: 400,
  PLUGIN_CATALOG_SIZE: 413,
  PLUGIN_CATALOG_FETCH: 502,
  PLUGIN_INSTALL_URL: 400,
  PLUGIN_INSTALL_HASH: 422,
  PLUGIN_INSTALL_SIZE: 413,
  PLUGIN_INSTALL_TIMEOUT: 502,
  PLUGIN_INSTALL_FETCH: 502,
  PLUGIN_INSTALL_REDIRECT: 502,
  PLUGIN_INSTALL_ZIP: 422,
  PLUGIN_INSTALL_CHECK: 422,
  PLUGIN_INSTALL_EXISTS: 409,
});

/**
 * A coded install or catalogue-fetch failure. `status` is the HTTP status the studio uses.
 */
export class InstallError extends Error {
  /**
   * @param {string} code @param {string} [detail] @param {Record<string, unknown>} [params] @param {number} [status]
   */
  constructor(code, detail = '', params = {}, status = STATUS[code] || 400) {
    super(detail || code);
    this.code = code;
    this.params = params;
    this.status = status;
  }
}

const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');

/** Constant-time compare of two hex digests. Different lengths are not equal and are not compared. */
function hashEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * An address the CLI treats as remote (a URI scheme). A filesystem path is not one: a Windows drive (`C:/…`, `C:\…`)
 * and a UNC path (`\\server\…` or `//server/…`) are classified before the scheme test.
 * [ASSUMED] a leading `//` is a UNC file path, not a protocol-relative URL, and is never fetched.
 * @param {string} value
 */
export function isRemoteAddress(value) {
  if (typeof value !== 'string' || !value) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.startsWith('\\\\') || value.startsWith('//')) return false;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

const CODES = Object.freeze({
  zip: { url: 'PLUGIN_INSTALL_URL', size: 'PLUGIN_INSTALL_SIZE', timeout: 'PLUGIN_INSTALL_TIMEOUT', fetch: 'PLUGIN_INSTALL_FETCH', redirect: 'PLUGIN_INSTALL_REDIRECT' },
  catalog: { url: 'PLUGIN_CATALOG_URL', size: 'PLUGIN_CATALOG_SIZE', timeout: 'PLUGIN_CATALOG_FETCH', fetch: 'PLUGIN_CATALOG_FETCH', redirect: 'PLUGIN_CATALOG_FETCH' },
});

const PUBLIC_REFUSAL = 'only a public https address on port 443, with no user or password, is accepted';

/** Addresses that are not a public destination. [ASSUMED] 2001::/32 (Teredo) and the whole 2002::/16 (6to4). */
const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
  ['2001:db8::', 32], ['100::', 64], ['2001::', 32], ['2002::', 16],
]) BLOCKED.addSubnet(addr, prefix, 'ipv6');

const isRedirectStatus = (status) => status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

/** Hostname without a trailing dot or the brackets Node's URL keeps around an IPv6 literal. @param {string} hostname */
function bareHost(hostname) {
  const h = String(hostname || '').replace(/\.$/, '');
  const m = /^\[(.*)\]$/.exec(h);
  return m ? m[1] : h;
}

/** An IPv4-mapped IPv6 address, including one whose embedded IPv4 is public. @param {string} ip */
function isIpv4Mapped(ip) {
  if (net.isIP(ip) !== 6) return false;
  if (ip.toLowerCase().includes('::ffff:')) return true;
  try { return new URL(`https://[${ip}]`).hostname.toLowerCase().includes('::ffff:'); } catch { return false; }
}

/**
 * True when `ip` is not a public unicast address. An unparseable string is not public.
 * Every `::ffff:` form is refused, including a public embedded IPv4.
 * @param {string} ip
 */
export function isNonPublicAddress(ip) {
  const bare = bareHost(ip);
  const kind = net.isIP(bare);
  if (!kind) return true;
  if (kind === 6 && isIpv4Mapped(bare)) return true;
  return BLOCKED.check(bare, kind === 4 ? 'ipv4' : 'ipv6');
}

/** `.local` / `.localhost` / `localhost`, after URL parsing. @param {string} hostname */
function isLocalName(hostname) {
  const h = bareHost(hostname).toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local');
}

/**
 * A dotted or single-label decimal/hex form `new URL` did not turn into an IP. Fail closed.
 * @param {string} hostname
 */
function isNumericHost(hostname) {
  return /^(?:\d+|0x[0-9a-f]+)(?:\.(?:\d+|0x[0-9a-f]+))*$/i.test(hostname);
}

/**
 * One operator allowlist entry. `host` is any port; `host:port` is that port; IPv6 is `[addr]` or `[addr]:port`.
 * A wildcard does not match. Comparison is case-insensitive and exact.
 * @param {string} entry
 * @returns {{ host: string, port: string | null } | null}
 */
function parseAllowEntry(entry) {
  const s = String(entry).trim();
  if (!s || /\s/.test(s) || s.includes('*')) return null;
  const v6 = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(s);
  if (v6) {
    if (v6[2] && (Number(v6[2]) < 1 || Number(v6[2]) > 65535)) return null;
    return { host: v6[1].toLowerCase(), port: v6[2] || null };
  }
  const hp = /^([^[\]]+):(\d{1,5})$/.exec(s);
  if (hp && !hp[1].includes(':')) {
    if (Number(hp[2]) < 1 || Number(hp[2]) > 65535) return null;
    return { host: hp[1].toLowerCase().replace(/\.$/, ''), port: hp[2] };
  }
  if (s.includes(':') || s.includes('[') || s.includes(']')) return null;
  return { host: s.toLowerCase().replace(/\.$/, ''), port: null };
}

/**
 * Whether the operator allowlist permits `hostname` on `port` (and therefore a non-public resolution of that name).
 * @param {string} hostname @param {string | number} port @param {readonly string[]} allow
 */
export function hostAllowed(hostname, port, allow) {
  const host = bareHost(hostname).toLowerCase();
  const p = String(port || '443');
  for (const entry of allow || []) {
    const parsed = parseAllowEntry(entry);
    if (parsed && parsed.host === host && (parsed.port === null || parsed.port === p)) return true;
  }
  return false;
}

/**
 * The operator download allowlist. An explicit array passed to fetchHttps replaces this.
 * `SP_PLUGIN_DOWNLOAD_ALLOW` is a comma-separated list. `plugins/config.json` `allowDownloadHosts` is a string array
 * in the same file as the room policy; policy.js ignores the key. Missing, unreadable, or the wrong type means no
 * extra hosts (a public download still works). [ASSUMED] those two names.
 * @param {string} [pluginsDir] @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function readDownloadAllow(pluginsDir, env = process.env) {
  /** @type {string[]} */
  const out = [];
  const fromEnv = env && typeof env.SP_PLUGIN_DOWNLOAD_ALLOW === 'string' ? env.SP_PLUGIN_DOWNLOAD_ALLOW : '';
  for (const part of fromEnv.split(',')) if (part.trim()) out.push(part.trim());
  if (!pluginsDir) return out;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'config.json'), 'utf8'));
    const list = raw && raw.allowDownloadHosts;
    if (Array.isArray(list)) for (const item of list) if (typeof item === 'string' && item.trim()) out.push(item.trim());
  } catch { /* no file, or not JSON: the safe list is empty */ }
  return out;
}

/**
 * `lookup` for `https.request`. Every address is classified before any address is returned, so the socket is never
 * connected to one this function refused. `lookupImpl` has dns.lookup's shape; tests inject it and do not use the network.
 * @param {string} port @param {readonly string[]} allow @param {Function} [lookupImpl]
 */
export function pinningLookup(port, allow, lookupImpl = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    lookupImpl(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) { callback(err); return; }
      /** @type {{ address: string, family: number }[]} */
      const list = [];
      const push = (address, family) => {
        if (typeof address === 'string' && address) list.push({ address, family: family || net.isIP(address) || 4 });
      };
      if (typeof addresses === 'string') push(addresses, 4);
      else if (Array.isArray(addresses)) {
        for (const a of addresses) {
          if (typeof a === 'string') push(a, net.isIP(a));
          else if (a && typeof a.address === 'string') push(a.address, a.family);
        }
      }
      if (!list.length) { callback(Object.assign(new Error('no address'), { code: 'ENONPUBLIC' })); return; }
      if (!hostAllowed(hostname, port, allow)) {
        for (const a of list) {
          if (isNonPublicAddress(a.address)) {
            callback(Object.assign(new Error(`refusing non-public address for ${hostname}`), { code: 'ENONPUBLIC' }));
            return;
          }
        }
      }
      if (options && options.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

/**
 * Refuse a hop that is not public https on port 443, unless `allow` names that host (and port, when the entry has one).
 * `new URL` has already folded short, octal, hex and decimal IPv4 into a dotted address.
 * @param {string} target @param {{ codes: typeof CODES.zip, redirect: boolean, allow: readonly string[] }} ctx
 * @returns {URL}
 */
function assertDownloadTarget(target, { codes, redirect, allow }) {
  const code = redirect ? codes.redirect : codes.url;
  let u;
  try { u = new URL(target); } catch {
    throw new InstallError(code, redirect ? 'a redirect to an unreadable address' : PUBLIC_REFUSAL, {});
  }
  if (u.protocol !== 'https:' || u.username || u.password || !isCatalogUrl(target)) {
    throw new InstallError(code, redirect ? 'a redirect left https' : PUBLIC_REFUSAL, {});
  }
  const host = bareHost(u.hostname);
  const port = u.port === '' ? '443' : u.port;
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new InstallError(code, redirect ? 'a redirect left https' : PUBLIC_REFUSAL, {});
  const allowed = hostAllowed(host, port, allow);
  const literal = net.isIP(host) ? isNonPublicAddress(host) : (isLocalName(host) || isNumericHost(host));
  if (literal && !allowed) throw new InstallError(code, redirect ? 'a redirect named a non-public address' : PUBLIC_REFUSAL, {});
  if (port !== '443' && !allowed) throw new InstallError(code, redirect ? 'a redirect left port 443' : PUBLIC_REFUSAL, {});
  return u;
}

/** @param {Promise<T>} promise @param {AbortSignal | undefined} signal @param {() => unknown} [cancel] @template T */
function raceAbort(promise, signal, cancel) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      Promise.resolve()
        .then(() => cancel?.())
        .catch(() => {})
        .then(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        else resolve(v);
      },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

async function cancelBody(res) {
  try { await res?.body?.cancel?.(); } catch { /* already closed */ }
}

/**
 * Read a response body, stopping once it passes `maxBytes` (the rest is cancelled, not buffered).
 * `signal` aborts a read that never ends. An InstallError (the size cap) is not rewritten as a timeout.
 * @param {Response} res @param {number} maxBytes @param {typeof CODES.zip} codes @param {AbortSignal} [signal]
 */
async function readCapped(res, maxBytes, codes, signal) {
  const len = res.headers.get('content-length');
  if (len && /^\d+$/.test(len.trim()) && Number(len) > maxBytes) {
    await cancelBody(res);
    throw new InstallError(codes.size, `content-length ${len} is over the limit`, { max: maxBytes });
  }
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await raceAbort(res.arrayBuffer(), signal, () => cancelBody(res)));
    if (buf.length > maxBytes) throw new InstallError(codes.size, `${buf.length} bytes is over the limit`, { max: maxBytes });
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    let step;
    try {
      step = await raceAbort(reader.read(), signal, () => reader.cancel());
    } catch (e) {
      if (e instanceof InstallError) throw e;
      await reader.cancel().catch(() => {});
      if (signal?.aborted || e?.name === 'AbortError') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      throw new InstallError(codes.fetch, 'the download failed', {});
    }
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (step.done) break;
    n += step.value.byteLength;
    if (n > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new InstallError(codes.size, `the download passed ${maxBytes} bytes`, { max: maxBytes });
    }
    chunks.push(Buffer.from(step.value));
  }
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  return Buffer.concat(chunks);
}

/**
 * One GET on the production transport. `lookup` is the pinning lookup, so the connected address is one it accepted.
 * @param {URL} u @param {{ signal: AbortSignal, lookup: Function, request?: typeof https.request }} opts
 */
function httpsGet(u, { signal, lookup, request }) {
  const requestFn = request || https.request;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
    const host = bareHost(u.hostname);
    const req = requestFn({
      protocol: 'https:',
      hostname: host,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      headers: { accept: '*/*', 'user-agent': 'stronghold-protocol' },
      servername: net.isIP(host) ? undefined : host,
      lookup,
      signal,
    }, (res) => {
      resolve({
        status: res.statusCode || 0,
        type: '',
        headers: {
          get(name) {
            const v = res.headers[String(name).toLowerCase()];
            if (Array.isArray(v)) return v.join(', ');
            return v == null ? null : String(v);
          },
        },
        body: {
          getReader() {
            const iter = res[Symbol.asyncIterator]();
            return {
              async read() {
                const n = await iter.next();
                if (n.done) return { done: true, value: undefined };
                const value = Buffer.isBuffer(n.value) ? n.value : Buffer.from(n.value);
                return { done: false, value };
              },
              cancel() { res.destroy(); },
            };
          },
          cancel() { res.destroy(); },
        },
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * GET an https URL. Redirects are followed only when the next URL is still a public https address, at most
 * MAX_REDIRECTS. One AbortController covers DNS, every redirect and the body. An injected `fetch` is used only by
 * tests; with no `lookup` it skips DNS (the literal address and the port are still checked). With a `lookup`, that
 * lookup runs before `fetch` and a refused address is never passed to it. The production path (no `fetch`) is
 * `https.request` with {@link pinningLookup}, so the connected address is the one that was checked.
 * @param {string} url
 * @param {{ fetch?: typeof fetch | null, maxBytes?: number, timeoutMs?: number, kind?: 'zip' | 'catalog',
 *   signal?: AbortSignal, lookup?: Function | null, allowDownloadHosts?: readonly string[], pluginsDir?: string,
 *   request?: typeof https.request }} [opts]
 *   `allowDownloadHosts`, when an array (including empty), replaces the operator list.
 * @returns {Promise<Buffer>}
 */
export async function fetchHttps(url, { fetch: fetchImpl = null, maxBytes = INSTALL_MAX_BYTES, timeoutMs, kind = 'zip', signal, lookup: lookupImpl = null, allowDownloadHosts, pluginsDir, request } = {}) {
  const codes = CODES[kind] || CODES.zip;
  const wait = timeoutMs ?? (kind === 'catalog' ? CATALOG_FETCH_TIMEOUT_MS : ZIP_FETCH_TIMEOUT_MS);
  const allow = Array.isArray(allowDownloadHosts) ? allowDownloadHosts : readDownloadAllow(pluginsDir);
  if (!isCatalogUrl(url)) throw new InstallError(codes.url, PUBLIC_REFUSAL, {});
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), wait);
  const onAbort = () => ac.abort();
  signal?.addEventListener('abort', onAbort);
  /** @param {unknown} e @param {boolean} redirect */
  const fail = (e, redirect) => {
    if (e instanceof InstallError) throw e;
    if (ac.signal.aborted || signal?.aborted || e?.name === 'AbortError') throw new InstallError(codes.timeout, `timed out after ${wait} ms`, {});
    if (e?.code === 'ENONPUBLIC' || /non-public address/.test(String(e?.message || ''))) {
      throw new InstallError(redirect ? codes.redirect : codes.url, redirect ? 'a redirect named a non-public address' : PUBLIC_REFUSAL, {});
    }
    throw new InstallError(codes.fetch, 'the download failed', {});
  };
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const redirect = hop > 0;
      let u;
      try { u = assertDownloadTarget(current, { codes, redirect, allow }); } catch (e) { fail(e, redirect); }
      const port = u.port === '' ? '443' : u.port;
      const host = bareHost(u.hostname);
      if (fetchImpl && lookupImpl) {
        try {
          await new Promise((resolve, reject) => pinningLookup(port, allow, lookupImpl)(host, {}, (err) => (err ? reject(err) : resolve())));
        } catch (e) { fail(e, redirect); }
      }
      let res;
      try {
        if (fetchImpl) res = await fetchImpl(current, { redirect: 'manual', signal: ac.signal });
        else res = await httpsGet(u, { signal: ac.signal, lookup: pinningLookup(port, allow, lookupImpl || dns.lookup), request });
      } catch (e) { fail(e, redirect); }
      if (res.type === 'opaqueredirect' || res.status === 0) {
        await cancelBody(res);
        throw new InstallError(codes.redirect, 'a redirect hid its target', {});
      }
      if (isRedirectStatus(res.status)) {
        const loc = res.headers.get('location');
        await cancelBody(res);
        if (hop === MAX_REDIRECTS) throw new InstallError(codes.redirect, `more than ${MAX_REDIRECTS} redirects`, {});
        if (!loc) throw new InstallError(codes.redirect, 'a redirect without a location', {});
        try { current = new URL(loc, current).href; } catch {
          throw new InstallError(codes.redirect, 'a redirect to an unreadable address', {});
        }
        continue;
      }
      if (res.status !== 200) {
        await cancelBody(res);
        throw new InstallError(codes.fetch, `HTTP ${res.status}`, { status: res.status });
      }
      return await readCapped(res, maxBytes, codes, ac.signal);
    }
    throw new InstallError(codes.redirect, `more than ${MAX_REDIRECTS} redirects`, {});
  } catch (e) {
    if (e instanceof InstallError) throw e;
    fail(e, false);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The version in plugins/<id>/plugin.json. Undefined when the id is not installed. Null when the folder is there
 * (including a symbolic link, which is not followed) but the version cannot be read.
 * @param {string} pluginsDir @param {string} id
 * @returns {string | null | undefined}
 */
export function installedPluginVersion(pluginsDir, id) {
  if (!isPluginId(id)) return undefined;
  const dir = path.join(pluginsDir, id);
  let st;
  try { st = fs.lstatSync(dir); } catch { return undefined; }
  if (st.isSymbolicLink()) return null;
  if (!st.isDirectory()) return undefined;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, PLUGIN_MANIFEST), 'utf8'));
    return typeof m.version === 'string' ? m.version : null;
  } catch { return null; }
}

/** UTC stamp for a replaced folder: YYYYMMDD-HHMMSS-mmm. [ASSUMED] */
function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds(), 3)}`;
}

/** A real directory, never a symbolic link. @param {string} dir */
function assertRealDir(dir) {
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!st || st.isSymbolicLink() || !st.isDirectory()) throw new InstallError('PLUGIN_INSTALL_ZIP', 'refusing to write through a symbolic link', {});
  return st;
}

/**
 * `parent` must be a real directory. Create `name` inside it (one level, not recursive) and return the new path.
 * @param {string} parent @param {string} name
 */
function mkdirChild(parent, name) {
  assertRealDir(parent);
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new InstallError('PLUGIN_INSTALL_ZIP', 'a path escapes the plugin folder', {});
  const dir = path.join(parent, name);
  fs.mkdirSync(dir);
  assertRealDir(dir);
  return dir;
}

/**
 * @param {{ name: string, data: Buffer }[]} entries
 * @returns {{ hint: string | null, files: { name: string, data: Buffer }[] }}
 */
function normalizeLayout(entries) {
  const files = entries.filter((e) => !e.name.endsWith('/'));
  if (!files.length) throw new InstallError('PLUGIN_INSTALL_ZIP', 'the zip has no files', {});
  if (files.some((f) => f.name === PLUGIN_MANIFEST)) return { hint: null, files };
  const tops = new Set(files.map((f) => f.name.split('/')[0]));
  if (tops.size !== 1) throw new InstallError('PLUGIN_INSTALL_ZIP', 'the zip must contain plugin.json, or one folder that contains it', {});
  const top = [...tops][0];
  if (!isPluginId(top) || !files.some((f) => f.name === `${top}/${PLUGIN_MANIFEST}`)) {
    throw new InstallError('PLUGIN_INSTALL_ZIP', 'the wrapping folder must be a plugin id and contain plugin.json', {});
  }
  return { hint: top, files: files.map((f) => ({ name: f.name.slice(top.length + 1), data: f.data })) };
}

/**
 * @param {{ name: string, data: Buffer }[]} files @param {string | null} hint
 */
function chooseId(files, hint) {
  const man = files.find((f) => f.name === PLUGIN_MANIFEST);
  if (!man) throw new InstallError('PLUGIN_INSTALL_ZIP', 'no plugin.json', {});
  let json;
  try { json = JSON.parse(man.data.toString('utf8')); } catch {
    throw new InstallError('PLUGIN_INSTALL_ZIP', 'plugin.json is not JSON', {});
  }
  const fromFile = json && typeof json.id === 'string' ? json.id : '';
  const id = isPluginId(hint) ? hint : (isPluginId(fromFile) ? fromFile : '');
  if (!isPluginId(id)) throw new InstallError('PLUGIN_INSTALL_ZIP', 'the zip has no plugin id (name the folder with the id, or set id in plugin.json)', {});
  return id;
}

/**
 * @param {string} dir @param {{ name: string, data: Buffer }[]} files
 */
function writeTree(dir, files) {
  assertRealDir(dir);
  for (const f of files) {
    const parts = f.name.split('/');
    if (!parts.length || parts.some((s) => !s || s === '.' || s === '..')) throw new InstallError('PLUGIN_INSTALL_ZIP', 'a path escapes the plugin folder', {});
    let cur = dir;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = path.join(cur, parts[i]);
      const st = fs.lstatSync(next, { throwIfNoEntry: false });
      if (st?.isSymbolicLink()) throw new InstallError('PLUGIN_INSTALL_ZIP', 'refusing to write through a symbolic link', {});
      if (!st) cur = mkdirChild(cur, parts[i]);
      else if (!st.isDirectory()) throw new InstallError('PLUGIN_INSTALL_ZIP', 'a path is not a folder', {});
      else cur = next;
    }
    const abs = path.join(cur, parts[parts.length - 1]);
    const fileSt = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (fileSt) throw new InstallError('PLUGIN_INSTALL_ZIP', 'a file in the zip is not a plain new file', {});
    const fh = fs.openSync(abs, 'wx');
    try { fs.writeSync(fh, f.data); } finally { fs.closeSync(fh); }
  }
}

/**
 * Move plugins/<id> to plugins/<into>/<id>-<stamp>/ (the stamp of the header, -2, -3 … when that name is taken): the old
 * folder of a forced install (`_replaced`) and a plugin the studio removes (`_removed`, POST /studio/api/plugins/remove:
 * server/studio/index.js). `into` is a folder of plugins/ whose name starts with '_' — the registry never reads it — made
 * when missing and refused when it is not a real folder (a symbolic link). The rename moves the entry itself: it never
 * follows a symbolic link, and nothing is deleted.
 * @param {string} pluginsDir @param {string} id @param {string} [into]
 * @returns {string} the new path
 */
export function movePluginAside(pluginsDir, id, into = '_replaced') {
  if (!/^_[a-z0-9-]+$/.test(into)) throw new InstallError('PLUGIN_INSTALL_ZIP', `${String(into).slice(0, 40)} is not a folder for moved plugins`, {});
  const src = path.join(pluginsDir, id);
  const root = path.join(pluginsDir, into);
  fs.mkdirSync(root, { recursive: true });
  const rst = fs.lstatSync(root);
  if (rst.isSymbolicLink() || !rst.isDirectory()) throw new InstallError('PLUGIN_INSTALL_ZIP', `plugins/${into} is not a real folder`, {});
  const base = `${id}-${stamp()}`;
  let dest = path.join(root, base);
  for (let n = 2; fs.lstatSync(dest, { throwIfNoEntry: false }); n++) {
    if (n > 50) throw new InstallError('PLUGIN_INSTALL_EXISTS', `${id} could not be moved aside`, { id });
    dest = path.join(root, `${base}-${n}`);
  }
  fs.renameSync(src, dest);
  return dest;
}

/**
 * Install zip bytes into plugins/<id>/. See the header. Never runs code from the package.
 * @param {Buffer | Uint8Array} bytes
 * @param {{ pluginsDir: string, force?: boolean, expectedId?: string, maxBytes?: number }} opts
 * @returns {{ id: string, dir: string, replaced: string | null }}
 */
export function installPluginBytes(bytes, { pluginsDir, force = false, expectedId = '', maxBytes = INSTALL_MAX_BYTES } = {}) {
  if (!pluginsDir) throw new InstallError('PLUGIN_INSTALL_ZIP', 'no plugins directory', {});
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length > maxBytes) throw new InstallError('PLUGIN_INSTALL_SIZE', `${buf.length} bytes is over the limit`, { max: maxBytes });
  let top;
  try { top = fs.lstatSync(pluginsDir); } catch {
    throw new InstallError('PLUGIN_INSTALL_ZIP', 'the plugins directory cannot be read', {});
  }
  if (top.isSymbolicLink() || !top.isDirectory()) throw new InstallError('PLUGIN_INSTALL_ZIP', 'the plugins directory is not a real directory', {});
  let entries;
  try { entries = readPluginZip(buf, { maxBytes, maxFiles: PLUGIN_LIMITS.files }); } catch (e) {
    if (e instanceof InstallError) throw e;
    throw new InstallError('PLUGIN_INSTALL_ZIP', e?.code === 'PLUGIN_INSTALL_ZIP' ? String(e.message).slice(0, 300) : String(e?.code || 'PLUGIN_INSTALL_ZIP'), {});
  }
  const layout = normalizeLayout(entries);
  const id = chooseId(layout.files, layout.hint);
  if (expectedId && id !== expectedId) throw new InstallError('PLUGIN_INSTALL_ZIP', `the zip is ${id}, not ${expectedId}`, { id, expected: expectedId });
  const incomingRoot = path.join(pluginsDir, '_incoming');
  const incomingExisting = fs.lstatSync(incomingRoot, { throwIfNoEntry: false });
  if (incomingExisting?.isSymbolicLink()) throw new InstallError('PLUGIN_INSTALL_ZIP', 'plugins/_incoming is not a real folder', {});
  if (!incomingExisting) fs.mkdirSync(incomingRoot);
  assertRealDir(incomingRoot);
  /** @type {string | null} */
  let incoming = null;
  /** @type {string | null} */
  let tempPlugin = null;
  let committed = false;
  /** @type {string | null} */
  let replaced = null;
  try {
    incoming = mkdirChild(incomingRoot, randomBytes(8).toString('hex'));
    tempPlugin = mkdirChild(incoming, id);
    writeTree(tempPlugin, layout.files);
    const checked = checkPluginFolder(tempPlugin, `plugins/${id}/`);
    if (checked.problems.length) throw new InstallError('PLUGIN_INSTALL_CHECK', checked.problems[0], { id });
    const finalDir = path.join(pluginsDir, id);
    const existing = fs.lstatSync(finalDir, { throwIfNoEntry: false });
    if (existing) {
      if (!force) throw new InstallError('PLUGIN_INSTALL_EXISTS', `${id} is already installed`, { id });
      replaced = movePluginAside(pluginsDir, id);
    }
    try {
      fs.renameSync(tempPlugin, finalDir);
    } catch (e) {
      if (replaced) {
        try { fs.renameSync(replaced, finalDir); } catch { /* the old folder stays in plugins/_replaced */ }
      }
      throw new InstallError('PLUGIN_INSTALL_ZIP', String(e?.code || 'rename failed'), { id });
    }
    committed = true;
    return { id, dir: finalDir, replaced };
  } finally {
    if (incoming) fs.rmSync(incoming, { recursive: true, force: true });
  }
}

/**
 * Download an https zip and install it. `sha256` is required. `expectedBytes`, when set, must match the download.
 * @param {string} url
 * @param {{ pluginsDir: string, sha256: string, force?: boolean, expectedId?: string, expectedBytes?: number,
 *   fetch?: typeof fetch, maxBytes?: number, timeoutMs?: number, lookup?: Function,
 *   allowDownloadHosts?: readonly string[] }} opts
 */
export async function installFromUrl(url, opts) {
  if (!isCatalogUrl(url)) throw new InstallError('PLUGIN_INSTALL_URL', 'only a public https address on port 443, with no user or password, is accepted', {});
  if (!isContentHash(opts.sha256)) throw new InstallError('PLUGIN_INSTALL_HASH', 'an https install needs a sha256', {}, 400);
  const maxBytes = opts.maxBytes ?? INSTALL_MAX_BYTES;
  const buf = await fetchHttps(url, {
    fetch: opts.fetch, maxBytes, timeoutMs: opts.timeoutMs, kind: 'zip', lookup: opts.lookup,
    allowDownloadHosts: opts.allowDownloadHosts, pluginsDir: opts.pluginsDir,
  });
  if (opts.expectedBytes !== undefined && buf.length !== opts.expectedBytes) {
    throw new InstallError('PLUGIN_INSTALL_SIZE', `the zip is ${buf.length} bytes, the catalogue says ${opts.expectedBytes}`, { bytes: buf.length, expected: opts.expectedBytes });
  }
  const got = sha256Of(buf);
  if (!hashEqual(got, opts.sha256)) throw new InstallError('PLUGIN_INSTALL_HASH', 'the zip sha256 does not match', { sha256: got });
  return installPluginBytes(buf, opts);
}

/**
 * Install a zip that is already a file. `sha256`, when given, is checked. It is not required for a local file.
 * @param {string} file
 * @param {{ pluginsDir: string, sha256?: string, force?: boolean, expectedId?: string, maxBytes?: number }} opts
 */
export function installFromFile(file, opts) {
  const maxBytes = opts.maxBytes ?? INSTALL_MAX_BYTES;
  let st;
  try { st = fs.lstatSync(file); } catch {
    throw new InstallError('PLUGIN_INSTALL_ZIP', 'the zip cannot be read', {});
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new InstallError('PLUGIN_INSTALL_ZIP', 'the zip is not a plain file', {});
  if (st.size > maxBytes) throw new InstallError('PLUGIN_INSTALL_SIZE', `${st.size} bytes is over the limit`, { max: maxBytes });
  const buf = fs.readFileSync(file);
  if (opts.sha256) {
    if (!isContentHash(opts.sha256)) throw new InstallError('PLUGIN_INSTALL_HASH', 'sha256 must be 64 lowercase hex digits', {}, 400);
    if (!hashEqual(sha256Of(buf), opts.sha256)) throw new InstallError('PLUGIN_INSTALL_HASH', 'the zip sha256 does not match', {});
  }
  return installPluginBytes(buf, { ...opts, maxBytes });
}

/**
 * The text of a catalogue file or an https URL. The document is capped at 1 MB. The URL is not required to carry a hash.
 * @param {string} spec a filesystem path or an https URL
 * @param {{ fetch?: typeof fetch, timeoutMs?: number, pluginsDir?: string, lookup?: Function,
 *   allowDownloadHosts?: readonly string[] }} [opts]
 * @returns {Promise<string>}
 */
export async function loadCatalogText(spec, { fetch: fetchImpl, timeoutMs, pluginsDir, lookup, allowDownloadHosts } = {}) {
  if (isRemoteAddress(spec)) {
    const buf = await fetchHttps(spec, {
      fetch: fetchImpl, maxBytes: CATALOG_FETCH_MAX_BYTES, timeoutMs: timeoutMs ?? CATALOG_FETCH_TIMEOUT_MS,
      kind: 'catalog', pluginsDir, lookup, allowDownloadHosts,
    });
    return buf.toString('utf8');
  }
  const abs = path.resolve(spec);
  let st;
  try { st = fs.lstatSync(abs); } catch {
    throw new InstallError('PLUGIN_CATALOG_FETCH', 'the catalogue file cannot be read', {});
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new InstallError('PLUGIN_CATALOG_FETCH', 'the catalogue is not a plain file', {});
  if (st.size > CATALOG_FETCH_MAX_BYTES) throw new InstallError('PLUGIN_CATALOG_SIZE', 'the catalogue is over 1 MB', {});
  return fs.readFileSync(abs, 'utf8');
}
