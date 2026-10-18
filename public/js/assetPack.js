// Import a local asset pack (a folder or a zip) and keep only bytes the server manifest already names.
//
// Nothing in this file uploads. The only network reads are the three served manifests, once an import starts. A file
// is stored only when the first 16 hex digits of its SHA-256 equal the hash in the served URL. A Spine model is stored
// only when the whole group is present and the model hash matches server/http/assetIndex.js (the file hashes joined
// by '\n', no trailing newline). The default page is `<skel>.png` when the served object lists no textures: the server
// includes that page in the model hash without adding a textures field to the JSON. A zip File is read slice by slice
// (openZip), never whole.
//
// What a run stored is added to one index entry of the import cache as the run ends (assetCache.js IMPORTED_INDEX_URL):
// Chrome cannot list a cache of a whole pack's size with Cache.keys().
//
// [ASSUMED] One prefix is chosen for the whole pack. A path the manifest does not list is skipped, not failed.
// An incomplete Spine group is not stored under the model URL. A member that also has its own file-hash URL can
// still match that URL. Paths are case-sensitive. Empty files are rejected. ZIP64 entry counts and offsets are
// read; multi-disk archives are not. Caps: 500_000 entries, 64 MB central directory, 256 MB per entry.

import { splitHashedPath } from '../../shared/assetPaths.js';
import { mediaUrl } from './media.js';
import { IMPORTED_ASSET_CACHE, addImportedPaths, putImportedAsset, pruneImportedPaths } from './assetCache.js';

export const MAX_ZIP_ENTRIES = 500_000;
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
export const MAX_CD_BYTES = 64 * 1024 * 1024;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

/** IEEE CRC-32 of `data`. Exported so tests can build a zip the reader will accept. */
export function crc32(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function u64(bytes, offset) {
  const lo = u32(bytes, offset);
  const hi = u32(bytes, offset + 4);
  if (hi > 0x1fffff) return Number.POSITIVE_INFINITY;
  return hi * 0x100000000 + lo;
}

async function toBytes(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  return null;
}

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - (22 + 65535));
  for (let i = bytes.length - 22; i >= min; i--) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x05 || bytes[i + 3] !== 0x06) continue;
    const comment = u16(bytes, i + 20);
    if (i + 22 + comment === bytes.length) return i;
  }
  return -1;
}

function zip64Extra(extra, need) {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = u16(extra, offset);
    const size = u16(extra, offset + 2);
    offset += 4;
    if (offset + size > extra.length) return null;
    if (id === 0x0001) {
      let p = offset;
      const take = () => {
        if (p + 8 > offset + size) return Number.NaN;
        const n = u64(extra, p);
        p += 8;
        return n;
      };
      const out = {};
      if (need.uncomp) out.uncomp = take();
      if (need.comp) out.comp = take();
      if (need.offset) out.offset = take();
      if (need.disk) {
        if (p + 4 > offset + size) return null;
        out.disk = u32(extra, p);
      }
      if (Object.values(out).some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
      return out;
    }
    offset += size;
  }
  return null;
}

/**
 * Random access to an archive: `size`, and `read(offset, length)` → the bytes. A Blob (the File a player picks or drops)
 * is read slice by slice and its deflated entries stream from their slice, so a whole-pack zip (some 700 MB) never sits
 * in memory at once; bytes already in memory are read in place.
 * @param {Blob | ArrayBuffer | Uint8Array} data
 */
async function zipSource(data) {
  if (data && typeof data.slice === 'function' && typeof data.arrayBuffer === 'function' && typeof data.stream === 'function'
    && Number.isFinite(data.size)) {
    return {
      size: data.size,
      read: async (offset, length) => new Uint8Array(await data.slice(offset, offset + length).arrayBuffer()),
      part: (offset, length) => data.slice(offset, offset + length),
      copies: true,
    };
  }
  const bytes = await toBytes(data);
  if (!bytes) return null;
  return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length), part: null, copies: false };
}

/**
 * Read a zip's central directory. Stored entries are copied; method 8 is inflated with
 * `DecompressionStream('deflate-raw')`. Encryption and any other method are skipped per entry (`unsupported`).
 * A broken archive returns `{ ok: false, code: 'bad-zip' }` and does not throw. A Blob is read in slices (zipSource).
 * @param {Blob | ArrayBuffer | Uint8Array} data
 */
export async function openZip(data) {
  let src;
  try { src = await zipSource(data); } catch { return { ok: false, code: 'bad-zip' }; }
  if (!src || src.size < 22) return { ok: false, code: 'bad-zip' };
  try {
    return await readDirectory(src);
  } catch {
    return { ok: false, code: 'bad-zip' };
  }
}

async function readDirectory(src) {
  const tailStart = Math.max(0, src.size - (22 + 65535));
  const tail = await src.read(tailStart, src.size - tailStart);
  const at = findEocd(tail);
  if (at < 0) return { ok: false, code: 'bad-zip' };
  const eocd = tailStart + at;

  let disk = u16(tail, at + 4);
  let cdDisk = u16(tail, at + 6);
  let entries = u16(tail, at + 10);
  let cdSize = u32(tail, at + 12);
  let cdOffset = u32(tail, at + 16);
  const needZip64 = disk === 0xffff || cdDisk === 0xffff || entries === 0xffff
    || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  if (needZip64) {
    const loc = eocd - 20;
    if (loc < 0) return { ok: false, code: 'bad-zip' };
    const locator = await src.read(loc, 20);
    if (u32(locator, 0) !== 0x07064b50) return { ok: false, code: 'bad-zip' };
    const zoff = u64(locator, 8);
    if (!Number.isFinite(zoff) || zoff < 0 || zoff + 56 > src.size) return { ok: false, code: 'bad-zip' };
    const record = await src.read(zoff, 56);
    if (u32(record, 0) !== 0x06064b50) return { ok: false, code: 'bad-zip' };
    disk = u32(record, 16);
    cdDisk = u32(record, 20);
    entries = u64(record, 32);
    cdSize = u64(record, 40);
    cdOffset = u64(record, 48);
  }
  if (disk !== 0 || cdDisk !== 0) return { ok: false, code: 'bad-zip' };
  if (!Number.isFinite(entries) || !Number.isFinite(cdSize) || !Number.isFinite(cdOffset)) return { ok: false, code: 'bad-zip' };
  if (entries > MAX_ZIP_ENTRIES || cdSize > MAX_CD_BYTES) return { ok: false, code: 'bad-zip' };
  if (cdOffset < 0 || cdOffset + cdSize > src.size) return { ok: false, code: 'bad-zip' };

  const cd = await src.read(cdOffset, cdSize);
  const list = [];
  let p = 0;
  const end = cdSize;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > end || u32(cd, p) !== 0x02014b50) return { ok: false, code: 'bad-zip' };
    const flags = u16(cd, p + 8);
    const method = u16(cd, p + 10);
    const crc = u32(cd, p + 16);
    let compSize = u32(cd, p + 20);
    let uncompSize = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let diskStart = u16(cd, p + 34);
    let localOffset = u32(cd, p + 42);
    const nameStart = p + 46;
    if (nameStart + nameLen + extraLen + commentLen > end) return { ok: false, code: 'bad-zip' };
    const name = new TextDecoder('utf-8').decode(cd.subarray(nameStart, nameStart + nameLen));
    const extra = cd.subarray(nameStart + nameLen, nameStart + nameLen + extraLen);
    const need = {
      uncomp: uncompSize === 0xffffffff,
      comp: compSize === 0xffffffff,
      offset: localOffset === 0xffffffff,
      disk: diskStart === 0xffff,
    };
    if (need.uncomp || need.comp || need.offset || need.disk) {
      const extraValues = zip64Extra(extra, need);
      if (!extraValues) return { ok: false, code: 'bad-zip' };
      if (need.uncomp) uncompSize = extraValues.uncomp;
      if (need.comp) compSize = extraValues.comp;
      if (need.offset) localOffset = extraValues.offset;
      if (need.disk) diskStart = extraValues.disk;
    }
    if (diskStart !== 0) return { ok: false, code: 'bad-zip' };
    list.push({
      name,
      method,
      flags,
      crc,
      compSize,
      uncompSize,
      localOffset,
      encrypted: (flags & 1) === 1,
    });
    p = nameStart + nameLen + extraLen + commentLen;
  }

  return {
    ok: true,
    entries: list,
    read: (entry) => readEntry(src, entry),
  };
}

/** Inflate raw deflate data: bytes, or a Blob slice streamed as it is read. */
async function inflateRaw(comp) {
  const Stream = globalThis.DecompressionStream;
  if (typeof Stream !== 'function') return null;
  try {
    const blob = typeof comp?.stream === 'function' ? comp : new Blob([comp]);
    const stream = blob.stream().pipeThrough(new Stream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function readEntry(src, entry) {
  if (!entry || entry.encrypted || (entry.method !== 0 && entry.method !== 8)) {
    return { ok: false, code: 'unsupported' };
  }
  if (!Number.isFinite(entry.compSize) || !Number.isFinite(entry.uncompSize)
    || entry.compSize < 0 || entry.uncompSize <= 0
    || entry.compSize > MAX_ENTRY_BYTES || entry.uncompSize > MAX_ENTRY_BYTES) {
    return { ok: false, code: 'bad-entry' };
  }
  const offset = entry.localOffset;
  if (!Number.isFinite(offset) || offset < 0 || offset + 30 > src.size) return { ok: false, code: 'bad-entry' };
  const head = await src.read(offset, 30);
  if (u32(head, 0) !== 0x04034b50) return { ok: false, code: 'bad-entry' };
  const nameLen = u16(head, 26);
  const extraLen = u16(head, 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compSize;
  if (dataEnd > src.size) return { ok: false, code: 'bad-entry' };
  let raw;
  if (entry.method === 0) {
    if (entry.compSize !== entry.uncompSize) return { ok: false, code: 'bad-entry' };
    const comp = await src.read(dataStart, entry.compSize);
    raw = src.copies ? comp : comp.slice();
  } else {
    raw = await inflateRaw(src.part ? src.part(dataStart, entry.compSize) : await src.read(dataStart, entry.compSize));
    if (!raw || raw.byteLength !== entry.uncompSize) return { ok: false, code: 'bad-entry' };
  }
  if (entry.crc !== 0 && crc32(raw) !== entry.crc) return { ok: false, code: 'bad-entry' };
  return { ok: true, bytes: raw };
}

/**
 * A pack path relative to the archive root: slashes, no leading `./` or `/`, no `..`, no NUL.
 * A directory name (trailing slash) is null. `:` is kept so `C:/.../public/assets/a.png` can still match.
 * @param {string} name
 * @returns {string | null}
 */
export function normalizePackPath(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return null;
  let path = name.replace(/\\/g, '/');
  if (path.endsWith('/')) return null;
  while (path.startsWith('./')) path = path.slice(2);
  while (path.startsWith('/')) path = path.slice(1);
  if (!path) return null;
  const segs = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    segs.push(seg);
  }
  return segs.length ? segs.join('/') : null;
}

/**
 * Pick one way to turn pack paths into manifest rels (`assets/…`, `fonts/…`).
 * Highest score wins. A tie keeps the earlier strategy: strip `public/`, as-is, prepend `assets/`, prepend `fonts/`.
 * Score 0 does not guess.
 * @param {Iterable<string>} paths
 * @param {{ has: (rel: string) => boolean } | Set<string>} rels
 */
export function detectAssetPrefix(paths, rels) {
  const known = (rel) => (rels && typeof rels.has === 'function' ? rels.has(rel) : false);
  const strategies = [
    {
      id: 'strip',
      map(path) {
        const at = path.lastIndexOf('public/');
        return at >= 0 ? path.slice(at + 'public/'.length) : null;
      },
    },
    { id: 'as-is', map: (path) => path },
    {
      id: 'assets',
      map: (path) => (path.startsWith('assets/') || path.startsWith('fonts/') ? null : `assets/${path}`),
    },
    {
      id: 'fonts',
      map: (path) => (path.startsWith('assets/') || path.startsWith('fonts/') ? null : `fonts/${path}`),
    },
  ];
  let best = null;
  let bestScore = 0;
  for (const strategy of strategies) {
    let score = 0;
    for (const path of paths) {
      const rel = strategy.map(path);
      if (rel && known(rel)) score++;
    }
    if (score > bestScore) {
      best = strategy;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

/** First 16 hex digits of SHA-256, the same truncation as server/http/assetIndex.js `hash16`. */
export async function sha256Hex16(data) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let hex = '';
  for (let i = 0; i < 8; i++) hex += digest[i].toString(16).padStart(2, '0');
  return hex;
}

/** Model hash: SHA-256 of the members' file hashes joined by newlines, then the first 16 hex digits. */
export async function modelHashOf(parts) {
  return sha256Hex16(new TextEncoder().encode(parts.join('\n')));
}

/**
 * A served art URL → `{ rel, hash, url }`, or null when it has no content-hash segment or an unsafe path.
 * The hash segment is removed before `decodeURIComponent`, matching the manifest's plain rel (`assets/a b.png`).
 */
export function plainRel(url) {
  if (typeof url !== 'string' || /[?#\\]/.test(url) || url.includes('\0')) return null;
  const split = splitHashedPath(url);
  if (!split.hash) return null;
  let path;
  try { path = decodeURIComponent(split.path); } catch { return null; }
  if (path.includes('\0') || path.includes('\\')) return null;
  if (!path.startsWith('/assets/') && !path.startsWith('/fonts/')) return null;
  const segs = path.slice(1).split('/');
  if (segs.some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  return { rel: segs.join('/'), hash: split.hash, url };
}

function isObj(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSpine(value) {
  return isObj(value) && typeof value.skel === 'string' && value.skel.startsWith('/') && /\.skel$/.test(value.skel);
}

/** Skeleton, atlas, then pages. No pages listed → the default `<skel>.png` under the same hash, as the server does. */
function spineMemberUrls(obj) {
  const out = [obj.skel];
  if (typeof obj.atlas === 'string' && obj.atlas) out.push(obj.atlas);
  const pages = Array.isArray(obj.textures) ? obj.textures.filter((url) => typeof url === 'string' && url) : [];
  out.push(...(pages.length ? pages : [obj.skel.replace(/\.skel$/, '.png')]));
  return out;
}

/**
 * The import plan of the served manifests (already hashed). Unhashed URLs are left out: they cannot be checked.
 * `files` is the standalone map. `groups` are Spine models in server member order. `rels` is every rel either names.
 * @param {object | null} assets served /data/assets.json
 * @param {object | null} local served /data/local-assets.json
 */
export function planFromManifests(assets, local) {
  return planFrom(assets, local);
}

/**
 * The local groups of /data/local-assets.json and /data/local-fx.json (the official battle effects, DESIGN §33) as one
 * `{ groups }` manifest: their group names never overlap (fx groups are `fx…`); null when the host has neither.
 * @param {object | null} local
 * @param {object | null} fx
 */
export function mergeLocalManifests(local, fx) {
  if (!local && !fx) return null;
  return { groups: { ...((local && local.groups) || {}), ...((fx && fx.groups) || {}) } };
}

function planFrom(assets, local) {
  /** @type {Map<string, { hash: string, url: string, alts: { hash: string, url: string }[] }>} */
  const files = new Map();
  /** @type {{ hash: string, members: { rel: string, url: string }[] }[]} */
  const groups = [];

  const addStandalone = (url) => {
    const info = plainRel(url);
    if (!info) return;
    const cur = files.get(info.rel);
    if (!cur) {
      files.set(info.rel, { hash: info.hash, url: info.url, alts: [] });
      return;
    }
    if (cur.hash === info.hash || cur.alts.some((alt) => alt.hash === info.hash && alt.url === info.url)) return;
    cur.alts.push({ hash: info.hash, url: info.url });
  };

  const considerSpine = (urls) => {
    const members = [];
    let hash = null;
    for (const url of urls) {
      const info = plainRel(url);
      if (!info) return;
      if (hash == null) hash = info.hash;
      else if (hash !== info.hash) return;
      members.push({ rel: info.rel, url: info.url });
    }
    if (members.length) groups.push({ hash, members });
  };

  const walkPlain = (value) => {
    if (typeof value === 'string') { addStandalone(value); return; }
    if (Array.isArray(value)) { value.forEach(walkPlain); return; }
    if (!isObj(value)) return;
    for (const child of Object.values(value)) walkPlain(child);
  };

  const walkAssets = (value) => {
    if (typeof value === 'string') { addStandalone(value); return; }
    if (Array.isArray(value)) { value.forEach(walkAssets); return; }
    if (!isObj(value)) return;
    if (isSpine(value)) {
      considerSpine(spineMemberUrls(value));
      for (const [key, child] of Object.entries(value)) {
        if (key === 'skel' || key === 'atlas' || key === 'textures') continue;
        walkAssets(child);
      }
      return;
    }
    for (const child of Object.values(value)) walkAssets(child);
  };

  if (isObj(assets)) walkAssets(assets);
  if (isObj(local)) {
    const groupsDoc = local.groups;
    const rest = { ...local };
    delete rest.groups;
    walkPlain(rest);
    if (isObj(groupsDoc)) {
      for (const [name, entries] of Object.entries(groupsDoc)) {
        if (name.startsWith('spine/') && isObj(entries)) {
          const names = Object.keys(entries)
            .filter((key) => isObj(entries[key]) && typeof entries[key].path === 'string')
            .sort();
          if (names.length) considerSpine(names.map((key) => entries[key].path));
          for (const [key, entry] of Object.entries(entries)) {
            if (names.includes(key)) {
              for (const [field, child] of Object.entries(entry)) if (field !== 'path') walkPlain(child);
            } else walkPlain(entry);
          }
        } else walkPlain(entries);
      }
    }
  }

  const rels = new Set(files.keys());
  for (const group of groups) for (const member of group.members) rels.add(member.rel);
  return { files, groups, rels };
}

/**
 * One served manifest: null for a 404 of an optional one, else its JSON; any other answer throws `{ code: 'manifest' }`
 * (an HTML page instead of JSON included — a proxy's error page must never read as an empty manifest).
 */
async function readServedManifest(doFetch, url, optional) {
  const response = await doFetch(url, { cache: 'no-store' });
  if (optional && response.status === 404) {
    await response.body?.cancel?.();
    return null;
  }
  if (!response.ok) throw Object.assign(new Error('manifest'), { code: 'manifest' });
  const type = response.headers.get('content-type') || '';
  if (/text\/html/i.test(type)) {
    await response.body?.cancel?.();
    throw Object.assign(new Error('manifest'), { code: 'manifest' });
  }
  try {
    return await response.json();
  } catch (cause) {
    throw Object.assign(new Error('manifest'), { code: 'manifest', cause });
  }
}

/** The three served manifests an import reads (/data/assets.json, and local-assets / local-fx when the host has them). */
async function readServedManifests(doFetch) {
  const assets = await readServedManifest(doFetch, '/data/assets.json', false);
  const local = await readServedManifest(doFetch, '/data/local-assets.json', true);
  const fx = await readServedManifest(doFetch, '/data/local-fx.json', true);
  const badLocal = (m) => m !== null && (!m || typeof m !== 'object' || Array.isArray(m) || !m.groups);
  if (!assets || typeof assets !== 'object' || Array.isArray(assets) || badLocal(local) || badLocal(fx)) {
    throw Object.assign(new Error('manifest'), { code: 'manifest' });
  }
  return { assets, local, fx };
}

/**
 * The pathnames a fresh import from these manifests would store: every planned file and model member (an alternative
 * hash of a file included), each with its /media alias (cacheUrlsFor). What the import cache holds beyond them is a copy
 * no request of this server's version names.
 */
export function importedKeepSet(assets, local, fx) {
  const plan = planFromManifests(assets, mergeLocalManifests(local, fx));
  const keep = new Set();
  const add = (url) => { for (const u of cacheUrlsFor(url)) keep.add(new URL(u, 'http://localhost').pathname); };
  for (const f of plan.files.values()) { add(f.url); for (const alt of f.alts) add(alt.url); }
  for (const g of plan.groups) for (const m of g.members) add(m.url);
  return keep;
}

/**
 * 设置 → 素材存储 → 清理旧版本素材 (0.3.1): delete the imported copies the server's current manifests no longer name. A
 * manifest that cannot be read deletes nothing (throws `{ code: 'manifest' }`).
 * @returns {Promise<{ removed: number, removedFiles: number, kept: number }>}
 */
export async function pruneImportedAssets({ fetch: doFetch = (...args) => globalThis.fetch(...args), caches: cachesApi = globalThis.caches } = {}) {
  const { assets, local, fx } = await readServedManifests(doFetch);
  return pruneImportedPaths(importedKeepSet(assets, local, fx), cachesApi);
}

/** The cache keys of one served URL: itself, plus the `/media/~hash/…` alias when playback would request it. */
export function cacheUrlsFor(url) {
  const out = [];
  if (typeof url === 'string' && url) out.push(url);
  const media = mediaUrl(url);
  if (typeof media === 'string' && media && media !== url) out.push(media);
  return out;
}

const idleState = () => ({
  phase: 'idle',
  total: 0,
  done: 0,
  accepted: 0,
  rejected: 0,
  skipped: 0,
  failed: 0,
  unsupported: 0,
  error: null,
});

/**
 * A cancellable importer.
 * `source` is `{ type: 'zip', data }` or `{ type: 'files', files: [{ path, read }] }`.
 * `read` resolves to bytes or `{ ok: false, code }`. Already accepted cache entries are kept on cancel.
 */
export function createAssetImport({
  fetch: doFetch = (...args) => globalThis.fetch(...args),
  caches: cachesApi = globalThis.caches,
} = {}) {
  let state = idleState();
  let phase = 'idle';
  let error = null;
  let total = 0;
  let done = 0;
  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  let failed = 0;
  let unsupported = 0;
  let cancelFlag = false;
  let running = null;
  let lastNotice = 0;
  const listeners = new Set();

  const snapshot = () => ({
    phase, total, done, accepted, rejected, skipped, failed, unsupported, error,
  });

  const publish = (force = false) => {
    state = snapshot();
    const now = Date.now();
    if (!force && now - lastNotice < 100) return;
    lastNotice = now;
    for (const listener of listeners) listener(state);
  };

  const finish = (kind) => {
    done++;
    if (kind === 'accepted') accepted++;
    else if (kind === 'rejected') rejected++;
    else if (kind === 'failed') failed++;
    else {
      skipped++;
      if (kind === 'unsupported') unsupported++;
    }
    publish();
  };

  const readManifest = (url, optional) => readServedManifest(doFetch, url, optional);

  async function loadZip(data) {
    const zip = await openZip(data);
    if (!zip.ok) throw Object.assign(new Error('bad-zip'), { code: 'bad-zip' });
    const list = [];
    for (const entry of zip.entries) {
      const path = normalizePackPath(entry.name);
      if (!path) continue;
      list.push({
        path,
        read: async () => {
          try { return await zip.read(entry); } catch { return { ok: false, code: 'bad-entry' }; }
        },
      });
    }
    return list;
  }

  async function loadFiles(files) {
    const list = [];
    for (const file of files || []) {
      const path = normalizePackPath(file?.path || file?.name || '');
      if (!path || typeof file.read !== 'function') continue;
      list.push({
        path,
        read: async () => {
          try {
            const data = await file.read();
            if (data && data.ok === false) return { ok: false, code: data.code || 'bad-entry' };
            const bytes = await toBytes(data);
            if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_ENTRY_BYTES) return { ok: false, code: 'bad-entry' };
            return { ok: true, bytes };
          } catch {
            return { ok: false, code: 'bad-entry' };
          }
        },
      });
    }
    return list;
  }

  async function run(source) {
    let cache = null;
    /** Pathnames this run stored: added to the import's index as it ends (assetCache.js addImportedPaths). */
    const storedPaths = new Set();
    phase = 'reading';
    error = null;
    total = 0;
    done = 0;
    accepted = 0;
    rejected = 0;
    skipped = 0;
    failed = 0;
    unsupported = 0;
    publish(true);
    try {
      const assets = await readManifest('/data/assets.json', false);
      const local = await readManifest('/data/local-assets.json', true);
      const fx = await readManifest('/data/local-fx.json', true);
      if (cancelFlag) { phase = 'cancelled'; return; }
      const badLocal = (m) => m !== null && (!m || typeof m !== 'object' || Array.isArray(m) || !m.groups);
      if (!assets || typeof assets !== 'object' || Array.isArray(assets) || badLocal(local) || badLocal(fx)) {
        throw Object.assign(new Error('manifest'), { code: 'manifest' });
      }
      const plan = planFromManifests(assets, mergeLocalManifests(local, fx));
      let list;
      if (source?.type === 'zip') list = await loadZip(source.data);
      else if (source?.type === 'files') list = await loadFiles(source.files);
      else throw Object.assign(new Error('source'), { code: 'unknown' });
      if (list.length > MAX_ZIP_ENTRIES) throw Object.assign(new Error('source'), { code: 'unknown' });
      if (cancelFlag) { phase = 'cancelled'; return; }

      const prefix = detectAssetPrefix(list.map((entry) => entry.path), plan.rels);
      const packByRel = new Map();
      if (!prefix) {
        skipped += list.length;
        phase = 'empty';
        return;
      }
      for (const entry of list) {
        const rel = prefix.map(entry.path);
        if (!rel || !plan.rels.has(rel) || packByRel.has(rel)) { skipped++; continue; }
        packByRel.set(rel, entry);
      }

      const spineOnly = new Set();
      for (const group of plan.groups) {
        for (const member of group.members) {
          if (!plan.files.has(member.rel)) spineOnly.add(member.rel);
        }
      }

      total = packByRel.size;
      phase = 'importing';
      publish(true);
      const outcome = new Set();
      const reads = new Map();
      const readRel = (rel) => {
        if (!reads.has(rel)) reads.set(rel, packByRel.get(rel).read());
        return reads.get(rel);
      };
      const settle = (rel, kind) => {
        if (outcome.has(rel)) return;
        outcome.add(rel);
        finish(kind);
      };

      const store = async (urls, bytes) => {
        if (!cache) {
          if (!cachesApi?.open) throw Object.assign(new Error('cache'), { code: 'unknown' });
          cache = await cachesApi.open(IMPORTED_ASSET_CACHE);
        }
        await putImportedAsset(cache, urls, bytes);
        for (const url of urls) {
          try { storedPaths.add(new URL(url, 'http://localhost').pathname); } catch { /* not a URL: never stored */ }
        }
      };

      for (const group of plan.groups) {
        if (cancelFlag) break;
        const present = group.members.filter((member) => packByRel.has(member.rel));
        if (present.length !== group.members.length) {
          for (const member of present) {
            if (spineOnly.has(member.rel)) settle(member.rel, 'skipped');
          }
          continue;
        }
        let bad = null;
        const loaded = new Map();
        for (const member of group.members) {
          if (cancelFlag) break;
          const got = await readRel(member.rel);
          if (!got?.ok || !got.bytes?.byteLength) {
            bad = got?.code === 'unsupported' ? 'unsupported' : 'failed';
            break;
          }
          loaded.set(member.rel, got.bytes);
        }
        if (cancelFlag) break;
        if (bad) {
          for (const member of group.members) {
            if (!spineOnly.has(member.rel)) continue;
            const got = reads.has(member.rel) ? await reads.get(member.rel) : null;
            if (got && !got.ok) settle(member.rel, got.code === 'unsupported' ? 'unsupported' : 'failed');
            else if (!got) settle(member.rel, 'skipped');
            else settle(member.rel, 'skipped');
          }
          continue;
        }
        const hashes = [];
        for (const member of group.members) hashes.push(await sha256Hex16(loaded.get(member.rel)));
        if (cancelFlag) break;
        const model = await modelHashOf(hashes);
        if (model === group.hash) {
          for (let i = 0; i < group.members.length; i++) {
            if (cancelFlag) break;
            const member = group.members[i];
            const urls = new Set(cacheUrlsFor(member.url));
            const spec = plan.files.get(member.rel);
            if (spec && spec.hash === hashes[i]) for (const url of cacheUrlsFor(spec.url)) urls.add(url);
            if (spec) {
              for (const alt of spec.alts) {
                if (alt.hash === hashes[i]) for (const url of cacheUrlsFor(alt.url)) urls.add(url);
              }
            }
            await store(urls, loaded.get(member.rel));
            settle(member.rel, 'accepted');
            loaded.delete(member.rel);
            reads.delete(member.rel);
          }
        } else {
          for (const member of group.members) {
            if (spineOnly.has(member.rel)) settle(member.rel, 'rejected');
          }
        }
      }

      for (const [rel, spec] of plan.files) {
        if (cancelFlag) break;
        if (outcome.has(rel) || !packByRel.has(rel)) continue;
        const got = await readRel(rel);
        if (cancelFlag) break;
        if (!got?.ok || !got.bytes?.byteLength) {
          settle(rel, got?.code === 'unsupported' ? 'unsupported' : 'failed');
          reads.delete(rel);
          continue;
        }
        const hash = await sha256Hex16(got.bytes);
        const urls = [];
        if (hash === spec.hash) urls.push(...cacheUrlsFor(spec.url));
        for (const alt of spec.alts) if (hash === alt.hash) urls.push(...cacheUrlsFor(alt.url));
        if (urls.length) {
          await store(urls, got.bytes);
          settle(rel, 'accepted');
        } else settle(rel, 'rejected');
        reads.delete(rel);
      }

      if (!cancelFlag) {
        for (const rel of packByRel.keys()) if (!outcome.has(rel)) settle(rel, 'skipped');
      }

      if (cancelFlag) phase = 'cancelled';
      else if (accepted > 0 && rejected === 0 && failed === 0) phase = 'complete';
      else if (accepted === 0 && rejected === 0 && failed === 0) phase = 'empty';
      else phase = 'partial';
    } catch (cause) {
      if (cancelFlag) phase = 'cancelled';
      else {
        phase = 'error';
        error = cause?.code === 'bad-zip' || cause?.code === 'manifest' ? cause.code : 'unknown';
      }
    } finally {
      // before the end is published: the dialog's count and the download queue read the index as the import ends
      if (cache && storedPaths.size) {
        try { await addImportedPaths(cache, storedPaths); } catch { /* the entries stay; Cache.keys() may still list them */ }
      }
      publish(true);
    }
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(source) {
      if (running) return running;
      cancelFlag = false;
      running = run(source).finally(() => { running = null; });
      return running;
    },
    cancel() { cancelFlag = true; },
  };
}

export const assetImport = createAssetImport();
