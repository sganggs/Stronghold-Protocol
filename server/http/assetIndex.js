// server/http/assetIndex.js — the content hashes of the served art (host bandwidth, layer 1; docs/ASSETS.md "The served
// manifests"):
//
//   * built in the background shortly after the start (ASSET_INDEX_DELAY_MS): every file under public/assets/ and
//     public/fonts/ (dot names skipped like the static server does, linked folders followed once), the first 16 hex
//     digits of the SHA-256 of its bytes (WebCrypto, off the main thread);
//   * remembered in .cache/asset-hashes.json by path + size + mtime: a restart only stats the files and reads none of
//     the unchanged ones again; a file whose size or mtime changed is hashed again (a re-extraction, `setup --force`,
//     a Docker rebuild then costs the players only the files whose bytes changed);
//   * never trusted beyond what it checked: `hashOf(rel, stat)` answers only while the file still has the size and
//     mtime it was hashed with, else null — the caller then serves the plain way (1-day cache, size-mtime ETag) and
//     the miss asks for a rescan (at most one every RESCAN_GAP_MS);
//   * models: lists of files that share one URL hash — a Spine skeleton, its atlas and its pages (pixi-spine finds the
//     atlas next to the skeleton and the pages next to the atlas, so all their URLs carry the same segment). A model's
//     hash is the SHA-256 of its members' hashes; assetViews.js hands the lists over (`setModels`), read from the
//     manifests. `urlHashOk` accepts a file's own hash or the hash of a model it belongs to.
//
// Rel paths are POSIX and relative to public/ ('assets/char/avatar/x.png', 'fonts/bender-regular.woff2'). A rel that
// differs from a file's name only in case finds that file when no other name matches it that way (Windows and macOS
// serve `wah-y.png` from `WAH-Y.png`; on Linux the request is a 404 anyway).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { ASSET_HASH_HEX } from '../../shared/assetPaths.js';
import { noopLog } from './config.js';
import { IMMUTABLE_CACHE } from './files.js';

/** Folders of public/ whose files are hashed. */
export const ASSET_INDEX_ROOTS = Object.freeze(['assets', 'fonts']);
/** The first build waits this long after the start (a server that is only started and stopped again — tests — reads nothing). */
export const ASSET_INDEX_DELAY_MS = 1000;
/** Shortest time between two rescans a stale or unknown file asks for. */
export const RESCAN_GAP_MS = 10_000;
/** Version of .cache/asset-hashes.json. */
export const HASH_CACHE_VERSION = 1;
const STAT_CONCURRENCY = 64;
const HASH_CONCURRENCY = 4;

const hex = (bytes) => Buffer.from(bytes).toString('hex').slice(0, ASSET_HASH_HEX);

/** First ASSET_HASH_HEX hex digits of the SHA-256 of `data` (synchronous; model hashes, manifests, tests). */
export function hash16(data) {
  return createHash('sha256').update(data).digest('hex').slice(0, ASSET_HASH_HEX);
}

/** The same for a file's bytes, computed off the main thread (WebCrypto runs in libuv's thread pool). */
async function digest16(buf) {
  return hex(await webcrypto.subtle.digest('SHA-256', buf));
}

/** Run `fn` over `items` with at most `n` at a time; stops early when `stop()` says so. */
async function eachLimit(items, n, fn, stop) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !stop()) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/**
 * The asset index of one server.
 * @param {{ publicDir: string, roots?: readonly string[], cacheFile?: string | null, log?: object, delayMs?: number,
 *           rescanGapMs?: number, now?: () => number }} opts
 *   cacheFile: where the hashes persist (null: in memory only — a test's temporary public/)
 */
export function createAssetIndex({ publicDir, roots = ASSET_INDEX_ROOTS, cacheFile = null, log = noopLog, delayMs = ASSET_INDEX_DELAY_MS,
  rescanGapMs = RESCAN_GAP_MS, now = Date.now }) {
  const base = path.resolve(publicDir);
  /** @type {Map<string, { size: number, mtimeMs: number, hash: string }>} */
  let records = new Map();
  /** @type {Map<string, string | null>} lower-case rel → the rel (null: two names differ only in case) */
  let lower = new Map();
  /** @type {string[][]} */
  let modelLists = [];
  /** @type {Map<string, Set<string>>} rel → hashes of the models it belongs to */
  let modelOf = new Map();
  let generation = 0;
  let ready = false;
  let closed = false;
  let building = null;          // the build in flight (a promise)
  let again = false;            // another build was asked for while one ran
  let startTimer = null;
  let rescanTimer = null;
  let lastBuildAt = -Infinity;
  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });
  const listeners = new Set();
  const last = { files: 0, bytes: 0, hashed: 0, reused: 0, ms: 0, at: null, error: null };

  /** The cache file's records ({} when absent, unreadable or another version). */
  function loadCache() {
    if (!cacheFile) return new Map();
    try {
      const doc = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (!doc || doc.version !== HASH_CACHE_VERSION || typeof doc.files !== 'object' || !doc.files) return new Map();
      const out = new Map();
      for (const [rel, v] of Object.entries(doc.files)) {
        if (Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) && typeof v[2] === 'string' && v[2].length === ASSET_HASH_HEX) {
          out.set(rel, { size: v[0], mtimeMs: v[1], hash: v[2] });
        }
      }
      return out;
    } catch {
      return new Map();
    }
  }

  /** Write the records (temp file + rename: a concurrent reader never sees half a file). Failures only log. */
  async function saveCache(map) {
    if (!cacheFile) return;
    const files = {};
    for (const [rel, r] of [...map].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) files[rel] = [r.size, r.mtimeMs, r.hash];
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
      await fsp.writeFile(tmp, JSON.stringify({ version: HASH_CACHE_VERSION, algo: 'sha256/16', files }));
      await fsp.rename(tmp, cacheFile);
    } catch (e) {
      log.debug?.('[assets] hash cache not saved', e?.code || e?.message);
      fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }

  /** Every file under the roots: [rel, abs] (dot names skipped, a folder reached twice — a link loop — walked once). */
  async function listFiles() {
    const out = [];
    const seen = new Set();
    const walk = async (abs, rel) => {
      let real;
      try { real = await fsp.realpath(abs); } catch { return; }
      if (seen.has(real)) return;
      seen.add(real);
      let ents;
      try { ents = await fsp.readdir(abs, { withFileTypes: true }); } catch { return; }
      for (const d of ents) {
        if (closed) return;
        if (d.name.startsWith('.')) continue;
        const childAbs = path.join(abs, d.name);
        const childRel = `${rel}/${d.name}`;
        if (d.isDirectory()) await walk(childAbs, childRel);
        else if (d.isFile()) out.push([childRel, childAbs]);
        else if (d.isSymbolicLink()) {
          const st = await fsp.stat(childAbs).catch(() => null);
          if (st?.isDirectory()) await walk(childAbs, childRel);
          else if (st?.isFile()) out.push([childRel, childAbs]);
        }
      }
    };
    for (const root of roots) await walk(path.join(base, root), root);
    return out;
  }

  /** Model hashes from the current records (a model with a member the index does not know has none). */
  function computeModels() {
    const next = new Map();
    for (const list of modelLists) {
      const h = modelHashOf(list);
      if (!h) continue;
      for (const rel of list) {
        const c = canonical(rel);
        let set = next.get(c);
        if (!set) next.set(c, (set = new Set()));
        set.add(h);
      }
    }
    modelOf = next;
  }

  /** The indexed name of `rel`: itself, or the one file whose name differs from it only in case (else null). */
  function canonical(rel) {
    if (typeof rel !== 'string') return null;
    if (records.has(rel)) return rel;
    return lower.get(rel.toLowerCase()) || null;
  }

  function recordOf(rel) {
    const c = canonical(rel);
    return c ? records.get(c) : null;
  }

  function modelHashOf(list) {
    if (!Array.isArray(list) || !list.length) return null;
    const parts = [];
    for (const rel of list) {
      const r = recordOf(rel);
      if (!r) return null;
      parts.push(r.hash);
    }
    return hash16(parts.join('\n'));
  }

  /** One build; true when the records changed (a new generation). */
  async function build() {
    const t0 = now();
    const known = records.size ? records : loadCache();
    const next = new Map();
    let hashed = 0;
    let reused = 0;
    let bytes = 0;
    const files = await listFiles();
    const toHash = [];
    await eachLimit(files, STAT_CONCURRENCY, async ([rel, abs]) => {
      const st = await fsp.stat(abs).catch(() => null);
      if (!st || !st.isFile()) return;
      bytes += st.size;
      const k = known.get(rel);
      if (k && k.size === st.size && k.mtimeMs === st.mtimeMs) { next.set(rel, k); reused++; } else toHash.push([rel, abs, st]);
    }, () => closed);
    await eachLimit(toHash, HASH_CONCURRENCY, async ([rel, abs, st]) => {
      try {
        const buf = await fsp.readFile(abs);
        const after = await fsp.stat(abs);
        // changed while it was read: hashed again by the next build
        if (after.size !== st.size || after.mtimeMs !== st.mtimeMs || buf.length !== st.size) return;
        next.set(rel, { size: st.size, mtimeMs: st.mtimeMs, hash: await digest16(buf) });
        hashed++;
      } catch { /* vanished or unreadable: not in the index */ }
    }, () => closed);
    if (closed) return false;
    // commit: records, model hashes and the generation change together (one synchronous step)
    let changed = next.size !== records.size;
    if (!changed) for (const [rel, r] of next) { const o = records.get(rel); if (!o || o.hash !== r.hash || o.size !== r.size || o.mtimeMs !== r.mtimeMs) { changed = true; break; } }
    const cacheChanged = hashed > 0 || next.size !== known.size;
    records = next;
    lower = new Map();
    for (const rel of next.keys()) { const k = rel.toLowerCase(); lower.set(k, lower.has(k) ? null : rel); }
    if (changed) { generation++; computeModels(); }
    Object.assign(last, { files: next.size, bytes, hashed, reused, ms: now() - t0, at: new Date().toISOString(), error: null });
    lastBuildAt = now();
    if (cacheChanged) await saveCache(next);
    if (hashed) log.info?.(`[assets] content hashes: ${next.size} files, ${hashed} hashed, ${reused} unchanged (${Math.round(last.ms)} ms)`);
    return changed;
  }

  function markReady() {
    if (ready) return;
    ready = true;
    readyResolve();
  }

  function notify() {
    for (const fn of [...listeners]) { try { fn(generation); } catch (e) { log.error?.('[assets] index listener failed', e); } }
  }

  /** Build now (or once more after the build in flight). */
  function refresh() {
    if (closed) return Promise.resolve();
    if (building) { again = true; return building; }
    building = (async () => {
      try {
        do {
          again = false;
          const changed = await build();
          if (closed) break;
          markReady();
          if (changed) notify();
        } while (again && !closed);
      } catch (e) {
        last.error = e?.message || String(e);
        log.warn?.('[assets] content hash index failed', e?.message || e);
      } finally {
        building = null;
        if (!closed) markReady();
      }
    })();
    return building;
  }

  return {
    /** Start the background build (after `delayMs`); returns at once. Idempotent. */
    start() {
      if (closed || startTimer || building || ready) return;
      if (!(delayMs > 0)) { refresh(); return; }
      startTimer = setTimeout(() => { startTimer = null; refresh(); }, delayMs);
      startTimer.unref?.();
    },
    refresh,
    /** Resolves once the first build is done (never rejects). */
    whenReady() { return readyPromise; },
    get ready() { return ready; },
    get generation() { return generation; },
    /** Files with a hash. */
    get size() { return records.size; },
    /**
     * The file's content hash while it still has the size and mtime it was hashed with (`stat` given), else null.
     * Without `stat`: the hash of the last build.
     * @param {string} rel @param {{ size: number, mtimeMs: number }} [stat]
     */
    hashOf(rel, stat) {
      const r = recordOf(rel);
      if (!r) return null;
      if (stat && (stat.size !== r.size || stat.mtimeMs !== r.mtimeMs)) return null;
      return r.hash;
    },
    /** Does `urlHash` name exactly these bytes: the file's own hash, or the hash of a model it belongs to? */
    urlHashOk(rel, stat, urlHash) {
      if (typeof urlHash !== 'string') return false;
      const own = this.hashOf(rel, stat);
      if (!own) return false;
      return own === urlHash || !!modelOf.get(canonical(rel))?.has(urlHash);
    },
    /** The hash of a model (its members' hashes hashed), null while a member is unknown. */
    modelHash: (list) => modelHashOf(list),
    /** Replace the model lists (assetViews.js, from the manifests). */
    setModels(lists) {
      modelLists = Array.isArray(lists) ? lists.filter((l) => Array.isArray(l) && l.length) : [];
      computeModels();
    },
    /** A file was served that the index does not know, or no longer matches: rescan (at most one per rescanGapMs). */
    noteMiss() {
      if (closed || !ready || rescanTimer || building) return;
      const wait = Math.max(0, lastBuildAt + rescanGapMs - now());
      rescanTimer = setTimeout(() => { rescanTimer = null; refresh(); }, wait);
      rescanTimer.unref?.();
    },
    /** `fn(generation)` after a build changed the records; returns the unsubscribe. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    stats() {
      return { ready, building: !!building, generation, files: records.size, models: modelLists.length, last: { ...last } };
    },
    /** Stop: timers cleared, a build in flight abandoned. */
    close() {
      closed = true;
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      if (rescanTimer) { clearTimeout(rescanTimer); rescanTimer = null; }
      readyResolve(); // a waiter is let go; `ready` stays as it was
    },
  };
}

/**
 * The ETag source and cache policy of a file of the asset index's folders (public/assets, public/fonts), for
 * serveFile: its content hash when the index has it for these bytes (a miss asks for a rescan); for a URL with a hash
 * segment `immutable` when that hash names these bytes, else `no-cache`.
 * @param {ReturnType<typeof createAssetIndex> | null} assetIndex
 * @param {string} rel the file under public/ ('assets/…', POSIX)
 * @param {import('node:fs').Stats} stat
 * @param {string | null} urlHash the URL's hash segment
 * @returns {{ contentHash?: string | null, cacheControl?: string }}
 */
export function hashedFileOpts(assetIndex, rel, stat, urlHash) {
  if (!assetIndex) return urlHash ? { cacheControl: 'no-cache' } : {};
  const contentHash = assetIndex.hashOf(rel, stat);
  if (!contentHash) assetIndex.noteMiss(rel);
  if (!urlHash) return { contentHash };
  return { contentHash, cacheControl: contentHash && assetIndex.urlHashOk(rel, stat, urlHash) ? IMMUTABLE_CACHE : 'no-cache' };
}
