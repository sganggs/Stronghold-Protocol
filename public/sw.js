// Cache /assets and /fonts. Same-origin files win (a local Node server, or the
// small fonts shipped with the Worker). Otherwise ask room peers, then the
// GitHub / jsDelivr URL in /asset-index.json. Spine atlases get size: / pma:
// filled in here so the bytes match the hash of the processed file.

import { atlasInfo, normalizeAtlas, parseAtlas } from '/shared/atlasText.js';
import { safeName } from '/shared/assetPath.js';
import { pngSize } from '/shared/pngSize.js';

const CACHE = 'sp-assets-v1';
/** @type {Map<string, { ans: (buf: Uint8Array) => void, miss: () => void }>} */
const pending = new Map();
/** @type {Map<string, Promise<Uint8Array | null>>} */
const inflight = new Map();
/** @type {Promise<{ files?: Record<string, { src?: string, sha256?: string, atlas?: boolean, pma?: boolean }> }> | null} */
let indexPromise = null;

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const msg = event.data;
  const box = msg && pending.get(msg.id);
  if (!box) return;
  if (msg.type === 'sp-asset-ans' && msg.buf) box.ans(new Uint8Array(msg.buf));
  else if (msg.type === 'sp-asset-miss') box.miss();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;
  if (!url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/fonts/')) return;
  event.respondWith(serve(url.pathname));
});

function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch('/data/asset-index.json').then((res) => (res.ok ? res.json() : { files: {} })).catch(() => ({ files: {} }));
  }
  return indexPromise;
}

/**
 * @param {string} filePath
 * @returns {Promise<Uint8Array | null>}
 */
function askPeers(filePath) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => new Promise((resolve) => {
    if (!clients.length) { resolve(null); return; }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let misses = 0;
    const timer = setTimeout(() => { pending.delete(id); resolve(null); }, 4000);
    pending.set(id, {
      ans(buf) { clearTimeout(timer); pending.delete(id); resolve(buf); },
      miss() {
        if (++misses >= clients.length) { clearTimeout(timer); pending.delete(id); resolve(null); }
      },
    });
    for (const client of clients) client.postMessage({ type: 'sp-asset-ask', id, path: filePath });
  })).catch(() => null);
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * @param {string} filePath
 * @param {Uint8Array} bytes
 */
function looksOk(filePath, bytes) {
  if (!bytes || !bytes.length) return false;
  if (filePath.endsWith('.png')) return !!pngSize(bytes);
  if (filePath.endsWith('.atlas')) return bytes.length > 20;
  if (filePath.endsWith('.mp3')) return bytes.length > 128;
  return bytes.length > 16;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function mime(filePath) {
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.gif')) return 'image/gif';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.mp3')) return 'audio/mpeg';
  if (filePath.endsWith('.ogg')) return 'audio/ogg';
  if (filePath.endsWith('.wav')) return 'audio/wav';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.atlas')) return 'text/plain; charset=utf-8';
  if (filePath.endsWith('.skel')) return 'application/octet-stream';
  return 'application/octet-stream';
}

/**
 * @param {Uint8Array} bytes
 * @param {string} filePath
 */
function responseFrom(bytes, filePath) {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': mime(filePath),
      'Cache-Control': 'public, max-age=31536000',
    },
  });
}

/**
 * @param {Cache} cache
 * @param {string} filePath
 * @param {Uint8Array | null} bytes
 * @param {{ sha256?: string } | null} meta
 * @returns {Promise<Uint8Array | null>}
 */
async function acceptAndStore(cache, filePath, bytes, meta) {
  if (!bytes || !bytes.length) return null;
  if (meta?.sha256) {
    if (await sha256(bytes) !== meta.sha256) return null;
  } else if (!looksOk(filePath, bytes)) return null;
  await cache.put(filePath, responseFrom(bytes, filePath));
  return bytes;
}

/**
 * @param {string} atlasPath
 * @param {Uint8Array} raw
 * @param {{ pma?: boolean }} meta
 */
async function fixAtlas(atlasPath, raw, meta) {
  const text = new TextDecoder().decode(raw);
  const { pages } = parseAtlas(text);
  /** @type {Map<string, { width: number, height: number }>} */
  const sizes = new Map();
  const slash = atlasPath.lastIndexOf('/');
  const dir = slash >= 0 ? atlasPath.slice(0, slash + 1) : '/';
  for (const page of pages) {
    const png = await loadBytes(dir + safeName(page.name));
    const size = png ? pngSize(png) : null;
    if (size) sizes.set(page.name, size);
  }
  const norm = normalizeAtlas(text, {
    pageSize: (name) => sizes.get(name) || null,
    pma: !!meta.pma,
    renamePage: safeName,
  });
  return new TextEncoder().encode(norm.text);
}

/**
 * @param {string} filePath
 * @returns {Promise<Uint8Array | null>}
 */
function loadBytes(filePath) {
  const existing = inflight.get(filePath);
  if (existing) return existing;
  const job = loadBytesInner(filePath).finally(() => { inflight.delete(filePath); });
  inflight.set(filePath, job);
  return job;
}

/**
 * @param {string} filePath
 * @returns {Promise<Uint8Array | null>}
 */
async function loadBytesInner(filePath) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(filePath);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const index = await loadIndex();
  const meta = index.files?.[filePath] || null;

  const peer = await consider(cache, filePath, await askPeers(filePath), meta);
  if (peer) return peer;

  const local = await fetch(filePath, { cache: 'no-store' });
  if (local.ok) {
    const stored = await consider(cache, filePath, new Uint8Array(await local.arrayBuffer()), meta);
    if (stored) return stored;
  }

  if (meta?.src) {
    try {
      const remote = await fetch(meta.src, { mode: 'cors', credentials: 'omit' });
      if (remote.ok) {
        const stored = await consider(cache, filePath, new Uint8Array(await remote.arrayBuffer()), meta);
        if (stored) return stored;
      }
    } catch { /* offline, or the mirror blocked this file */ }
  }
  return null;
}

/**
 * Keep bytes that already match the index. Atlases that still lack `size:` are
 * normalized and checked again.
 * @param {Cache} cache
 * @param {string} filePath
 * @param {Uint8Array | null} raw
 * @param {{ sha256?: string, atlas?: boolean, pma?: boolean } | null} meta
 * @returns {Promise<Uint8Array | null>}
 */
async function consider(cache, filePath, raw, meta) {
  if (!raw || !raw.length) return null;
  if (meta?.atlas) {
    const info = atlasInfo(new TextDecoder().decode(raw));
    const ready = info.hasSize && (!meta.pma || info.hasPma);
    if (ready) {
      const stored = await acceptAndStore(cache, filePath, raw, meta);
      if (stored) return stored;
    }
    return acceptAndStore(cache, filePath, await fixAtlas(filePath, raw, meta), meta);
  }
  return acceptAndStore(cache, filePath, raw, meta);
}

/**
 * @param {string} filePath
 */
async function serve(filePath) {
  const bytes = await loadBytes(filePath);
  if (!bytes) return new Response('missing asset', { status: 404 });
  return responseFrom(bytes, filePath);
}
