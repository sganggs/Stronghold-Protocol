// Imported art in Cache Storage, and the predicate the classic worker in public/sw.js duplicates.
//
// Keep IMPORTED_ASSET_CACHE, IMPORTED_ASSET_CACHE_PREFIX and IMPORTED_ASSET_PATH byte-for-byte in sync with
// public/sw.js. That file is a classic script (not a module) so Firefox 108 and Safari 16.4 can register it; it
// cannot import this module. A unit test fails if the two copies disagree.
//
// The worker serves only same-origin GET of a content-hashed /assets/, /fonts/ or /media/ URL. A hit comes from
// this cache. A miss goes to the network and is not written here. HTML, scripts, /data/, /sim/ and /ws are never
// matched. A Range request is left to the network so audio seeking still reaches the server. What an import stored is
// also listed in one index entry of the cache (IMPORTED_INDEX_URL): Chrome cannot list a cache that large.

/** Cache Storage name. Bump the suffix to drop previously imported bytes on the next activation. */
export const IMPORTED_ASSET_CACHE = 'sp-imported-assets-v1';

/** Prefix of every version of this cache. Activation deletes other names that start with it. */
export const IMPORTED_ASSET_CACHE_PREFIX = 'sp-imported-assets-';

/** Pathname of a URL this cache may answer. The hash is the same 16 hex digits as shared/assetPaths.js. */
export const IMPORTED_ASSET_PATH = /^\/(?:assets|fonts|media)\/~[0-9a-f]{16}\//;

/**
 * Whether a request should be answered from the import cache.
 * `pageOrigin` is the page (and the worker) origin. A relative URL is resolved against it.
 * @param {Request | { url?: string, method?: string, headers?: { get?: Function, range?: string } } | string} request
 * @param {string} [pageOrigin]
 */
export function shouldServeImportedAsset(request, pageOrigin) {
  const method = typeof request === 'string' ? 'GET' : (request?.method || 'GET');
  if (String(method).toUpperCase() !== 'GET') return false;
  if (request && typeof request === 'object' && request.headers) {
    const headers = request.headers;
    const range = typeof headers.get === 'function' ? headers.get('range') : (headers.range || headers.Range);
    if (range) return false;
  }
  const raw = typeof request === 'string' ? request : request?.url;
  if (!raw || !pageOrigin) return false;
  let url;
  try { url = new URL(raw, pageOrigin); } catch { return false; }
  if (url.origin !== pageOrigin) return false;
  return IMPORTED_ASSET_PATH.test(url.pathname);
}

/** Why import is unavailable, or `{ ok: true }` on a secure context that has the APIs. */
export function importSupport(nav = globalThis.navigator, secure = globalThis.isSecureContext) {
  if (!secure) return { ok: false, reason: 'insecure' };
  if (!nav?.serviceWorker || !globalThis.caches || !globalThis.crypto?.subtle) return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

/**
 * Register public/sw.js. Failures are swallowed: a missing worker must not stop the game.
 * Call only from boot. Unit tests import the downloader and must not register a worker as a side effect.
 * @returns {Promise<boolean>}
 */
export function registerImportedAssetWorker(nav = globalThis.navigator, secure = globalThis.isSecureContext) {
  if (!secure || !nav?.serviceWorker?.register) return Promise.resolve(false);
  return nav.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(() => true, () => false);
}

/** Content-Type stored with an imported response, chosen from the URL the game will request. */
export function contentTypeFor(url) {
  const path = String(url || '').split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.ogg') || path.endsWith('.oga')) return 'audio/ogg';
  if (path.endsWith('.m4a') || path.endsWith('.aac')) return 'audio/aac';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.opus')) return 'audio/ogg';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.woff')) return 'font/woff';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.atlas')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/** Put one body at each URL. Each put gets its own copy: Cache Storage consumes the body. */
export async function putImportedAsset(cache, urls, bytes, typeFor = contentTypeFor) {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  await Promise.all([...urls].map((url) => {
    const copy = body.slice();
    const response = new Response(copy, {
      status: 200,
      headers: { 'Content-Type': typeFor(url) },
    });
    return cache.put(url, response);
  }));
}

function pathnameOf(url) {
  try { return new URL(url, 'http://localhost').pathname; } catch { return ''; }
}

/**
 * The import's own list of the pathnames it stored: a JSON array kept in the import cache at this same-origin path,
 * which the worker never answers (not a hashed /assets/, /fonts/ or /media/ URL). Chrome refuses Cache.keys() for a
 * cache of more than about 15,000 entries ("Operation too large"); a whole pack stores some 43,000 (the audio twice).
 */
export const IMPORTED_INDEX_URL = '/sp-imported-index.json';

/** The index as a Set, or null without a readable one. */
async function readImportIndex(cache) {
  try {
    const hit = await cache.match(IMPORTED_INDEX_URL);
    if (!hit) return null;
    const list = await hit.json();
    return Array.isArray(list) ? new Set(list.filter((p) => typeof p === 'string' && p !== IMPORTED_INDEX_URL)) : null;
  } catch {
    return null;
  }
}

/** Pathnames of Cache.keys() (throws for a cache too large to list). */
async function keyPaths(cache) {
  const out = new Set();
  for (const req of await cache.keys()) {
    const path = pathnameOf(typeof req === 'string' ? req : req.url);
    if (path && path !== IMPORTED_INDEX_URL) out.add(path);
  }
  return out;
}

/**
 * Pathnames currently stored for imported art (assets, fonts and the audio /media/ alias): the import's index, else
 * the cache's keys (a cache written without an index); an empty set when neither can be read.
 */
export async function listImportedPaths(cachesApi = globalThis.caches) {
  if (!cachesApi?.open) return new Set();
  try {
    const cache = await cachesApi.open(IMPORTED_ASSET_CACHE);
    return (await readImportIndex(cache)) ?? await keyPaths(cache);
  } catch {
    return new Set();
  }
}

/**
 * Add the pathnames an import stored to the index (assetPack.js, as an import ends — finished, cancelled or failed).
 * Without an index yet, the cache's keys seed it when Cache.keys() still answers.
 * @param {Cache} cache the open import cache
 * @param {Iterable<string>} paths
 */
export async function addImportedPaths(cache, paths) {
  let all = await readImportIndex(cache);
  if (!all) {
    try { all = await keyPaths(cache); } catch { all = new Set(); }
  }
  for (const p of paths) if (typeof p === 'string' && p && p !== IMPORTED_INDEX_URL) all.add(p);
  await cache.put(IMPORTED_INDEX_URL, new Response(JSON.stringify([...all].sort()), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
}

/** How many imported files are stored, counting /assets/ and /fonts/ only (not the /media/ alias). */
export async function countImportedFiles(cachesApi = globalThis.caches) {
  const paths = await listImportedPaths(cachesApi);
  let n = 0;
  for (const path of paths) {
    if (path.startsWith('/assets/') || path.startsWith('/fonts/')) n++;
  }
  return n;
}

/**
 * Delete the stored pathnames that `wanted` does not name and rewrite the index to what remains (设置 → 素材存储 →
 * 清理旧版本素材, 0.3.1). A file that changed got a new hash, so its old copy is never served again (shared/assetPaths.js)
 * but stayed here. `removedFiles` counts /assets/ and /fonts/ only, like countImportedFiles (an audio file is stored twice).
 * @param {Set<string>} wanted pathnames the server's current manifests name, their /media aliases included
 * @returns {Promise<{ removed: number, removedFiles: number, kept: number }>}
 */
export async function pruneImportedPaths(wanted, cachesApi = globalThis.caches) {
  const cache = await cachesApi.open(IMPORTED_ASSET_CACHE);
  // no index yet: the keys, when Cache.keys() still answers (a whole pack always wrote an index)
  const stored = (await readImportIndex(cache)) ?? await keyPaths(cache);
  const stale = [...stored].filter((p) => !wanted.has(p));
  const kept = [...stored].filter((p) => wanted.has(p));
  let removed = 0, removedFiles = 0;
  for (let i = 0; i < stale.length; i += 32) {
    await Promise.all(stale.slice(i, i + 32).map(async (p) => {
      let gone;
      try { gone = await cache.delete(p); } catch { kept.push(p); return; }
      if (!gone) return; // listed but absent: it leaves the index
      removed++;
      if (p.startsWith('/assets/') || p.startsWith('/fonts/')) removedFiles++;
    }));
  }
  await cache.put(IMPORTED_INDEX_URL, new Response(JSON.stringify(kept.sort()), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));
  return { removed, removedFiles, kept: kept.length };
}

/** Delete every version of the import cache. The worker stays registered. */
export async function clearImportedAssets(cachesApi = globalThis.caches) {
  if (!cachesApi?.delete) return false;
  try {
    if (cachesApi.keys) {
      const names = await cachesApi.keys();
      const ours = names.filter((name) => String(name).startsWith(IMPORTED_ASSET_CACHE_PREFIX));
      if (ours.length) {
        await Promise.all(ours.map((name) => cachesApi.delete(name)));
        return true;
      }
    }
    return await cachesApi.delete(IMPORTED_ASSET_CACHE);
  } catch {
    return false;
  }
}

/** `navigator.storage.estimate()`, or null. `usage` is the whole origin, not only this cache. */
export async function storageEstimate(nav = globalThis.navigator) {
  try {
    const est = await nav?.storage?.estimate?.();
    if (!est) return null;
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch {
    return null;
  }
}

/**
 * Whether the browser already keeps the origin's storage (`navigator.storage.persisted()`), or null where it cannot say:
 * StorageManager exists only in a secure context, so plain http to a LAN IP reads null too. 设置 → 素材存储 shows it.
 * @returns {Promise<boolean | null>}
 */
export async function storagePersisted(nav = globalThis.navigator) {
  try {
    if (!nav?.storage?.persisted) return null;
    return await nav.storage.persisted();
  } catch {
    return null;
  }
}

/**
 * Ask the browser to keep the origin's storage. The return value is not a promise that the bytes will survive
 * eviction (iOS may still drop them after about seven days).
 * @returns {Promise<boolean | null>}
 */
export async function askPersistStorage(nav = globalThis.navigator) {
  try {
    if (!nav?.storage?.persist) return null;
    return await nav.storage.persist();
  } catch {
    return null;
  }
}
