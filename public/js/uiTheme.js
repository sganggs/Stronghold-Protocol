// public/js/uiTheme.js — local interface themes (docs/THEMES.md). This browser only: nothing is uploaded, the
// server never sees the pack, and other players do not. Blob URLs and CSS variables are written here; a pack
// file is never parsed as CSS, HTML or script.
//
// Storage is IndexedDB `sp-ui-themes` / `packs`. A private window that blocks it keeps the pack for this
// session and says so. The choice itself is `settings.uiTheme` (empty = the built-in 卫戍协议终端).

import { openZip, normalizePackPath } from './assetPack.js';
import {
  BUILTIN_ID, THEME_LIMITS, applyThemeTo, assessTheme, createVoiceGate, emptyCueState,
  installedOfficialThemes, officialAssetUrl, officialThemeById, stepThemeCues,
  stripThemePrefix, takeVoiceCues, themePathsOf, themeRelPath, themeRootOf, themeViewSnap,
} from '../../shared/uiTheme.js';

const DB_NAME = 'sp-ui-themes';
const DB_STORE = 'packs';
const DB_TIMEOUT = 4000;

const MIME = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  ogg: 'audio/ogg', mp3: 'audio/mpeg',
});

const extOf = (path) => {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
};

function bannerPath(banner) {
  if (typeof banner === 'string') return banner;
  return banner && typeof banner.path === 'string' ? banner.path : '';
}

function voiceStemOf(path) {
  const base = String(path || '').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return (dot < 0 ? base : base.slice(0, dot)).toLowerCase();
}

function withTimeout(p, ms, msg) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(msg), { timeout: true })), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

function defaultOpenDb() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('no IndexedDB'));
  return withTimeout(new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB'));
  }), DB_TIMEOUT, 'IndexedDB open timed out');
}

async function defaultMeasure(blob) {
  if (typeof createImageBitmap !== 'function') return { ok: false };
  try {
    const bmp = await createImageBitmap(blob);
    const width = bmp.width;
    const height = bmp.height;
    bmp.close?.();
    return { ok: width > 0 && height > 0, width, height };
  } catch {
    return { ok: false };
  }
}

function defaultCreateUrl(blob) {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') return URL.createObjectURL(blob);
  return null;
}

function defaultRevokeUrl(url) {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function' && typeof url === 'string' && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
  }
}

/**
 * @param {{ openDb?: () => Promise<any>, measure?: (blob: Blob) => Promise<{ ok: boolean, width?: number, height?: number }>, createUrl?: (blob: Blob) => string | null, revokeUrl?: (url: string) => void, now?: () => number }} [opts]
 */
export function createThemeLibrary(opts = {}) {
  const openDb = opts.openDb || defaultOpenDb;
  const measure = opts.measure || defaultMeasure;
  const createUrl = opts.createUrl || defaultCreateUrl;
  const revokeUrl = opts.revokeUrl || defaultRevokeUrl;
  /** @type {Map<string, any>} */
  const mem = new Map();
  let sessionOnly = false;
  let lastReport = null;
  let lastNotice = null;
  let booted = null;
  /** @type {any} */
  let assetManifest = null;
  let manifestLoaded = false;
  /** @type {Map<string, string[]>} urls to revoke when that pack is replaced or deleted */
  const urls = new Map();

  function rememberUrl(id, url) {
    if (!url) return;
    const list = urls.get(id) || [];
    list.push(url);
    urls.set(id, list);
  }

  function revokePack(id) {
    for (const url of urls.get(id) || []) revokeUrl(url);
    urls.delete(id);
  }

  async function idb(mode, fn) {
    const db = await openDb();
    return withTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = fn(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || req?.error || new Error('IndexedDB'));
    }), DB_TIMEOUT, 'IndexedDB timed out');
  }

  function runtimeOf(rec) {
    /** @type {Record<string, { url: string, slice: number[] | null }>} */
    const images = {};
    for (const [slot, img] of Object.entries(rec.images || {})) {
      const blob = rec.files?.[img.path];
      const url = blob ? createUrl(blob) : null;
      if (!url) continue;
      rememberUrl(rec.id, url);
      images[slot] = { url, slice: img.slice || null };
    }
    /** @type {Record<string, { url: string, slice: number[] | null }>} */
    const banners = {};
    for (const [key, banner] of Object.entries(rec.banners || {})) {
      const path = bannerPath(banner);
      const blob = path ? rec.files?.[path] : null;
      const url = blob ? createUrl(blob) : null;
      if (!url) continue;
      rememberUrl(rec.id, url);
      banners[key] = { url, slice: banner && typeof banner === 'object' ? (banner.slice || null) : null };
    }
    /** @type {Record<string, string[]>} */
    const voice = {};
    /** @type {Record<string, string>} */
    const voiceStem = {};
    for (const [key, paths] of Object.entries(rec.voice || {})) {
      const lines = [];
      for (const path of paths) {
        const blob = rec.files?.[path];
        const url = blob ? createUrl(blob) : null;
        if (!url) continue;
        rememberUrl(rec.id, url);
        voiceStem[url] = voiceStemOf(path);
        lines.push(url);
      }
      if (lines.length) voice[key] = lines;
    }
    const thumbBlob = rec.thumbnail ? rec.files?.[rec.thumbnail] : null;
    const previewBlob = rec.preview ? rec.files?.[rec.preview] : null;
    const thumbnailUrl = thumbBlob ? createUrl(thumbBlob) : null;
    const previewUrl = previewBlob ? createUrl(previewBlob) : null;
    if (thumbnailUrl) rememberUrl(rec.id, thumbnailUrl);
    if (previewUrl) rememberUrl(rec.id, previewUrl);
    let character = null;
    const rawChar = rec.character;
    if (rawChar?.image?.path) {
      const blob = rec.files?.[rawChar.image.path];
      const url = blob ? createUrl(blob) : null;
      if (url) {
        rememberUrl(rec.id, url);
        character = { imageUrl: url, slice: rawChar.image.slice || null, anims: rawChar.anims || null };
      }
    } else if (rawChar?.spine && typeof rawChar.spine.skel === 'string' && rawChar.spine.skel.startsWith('/')) {
      // [ASSUMED] The skeleton stays a same-origin URL. A blob skel cannot find its atlas pages.
      character = {
        spine: {
          skel: rawChar.spine.skel,
          atlas: rawChar.spine.atlas,
          textures: rawChar.spine.textures || [],
          anims: { idle: rawChar.anims?.idle || 'Idle' },
        },
        anims: rawChar.anims || { idle: 'Idle' },
      };
    }
    return {
      id: rec.id,
      name: rec.name,
      author: rec.author,
      version: rec.version,
      description: rec.description,
      thumbnailUrl,
      previewUrl,
      colors: rec.colors || {},
      tokens: rec.tokens || {},
      images,
      banners,
      voice,
      voiceStem,
      character,
      official: rec.official === true,
      rev: rec.savedAt,
    };
  }

  function cardOf(rec) {
    const live = mem.get(rec.id);
    return {
      id: rec.id,
      name: rec.name,
      author: rec.author,
      version: rec.version,
      description: rec.description,
      thumbnailUrl: live?.thumbnailUrl || null,
    };
  }

  async function boot() {
    if (booted) return booted;
    booted = (async () => {
      try {
        const rows = await idb('readonly', (store) => store.getAll());
        const list = Array.isArray(rows) ? rows : [];
        for (const rec of list) {
          if (!rec || typeof rec.id !== 'string' || !rec.files) continue;
          if (mem.has(rec.id)) continue;
          mem.set(rec.id, runtimeOf(rec));
          mem.get(rec.id).files = rec.files;
          mem.get(rec.id).stored = rec;
        }
      } catch {
        sessionOnly = true;
        lastNotice = 'session';
      }
    })();
    try { await booted; } catch { booted = null; }
    return booted;
  }

  async function persist(rec) {
    try {
      await idb('readwrite', (store) => store.put(rec, rec.id));
      return true;
    } catch {
      sessionOnly = true;
      lastNotice = 'session';
      return false;
    }
  }

  async function persistDelete(id) {
    try { await idb('readwrite', (store) => store.delete(id)); } catch { sessionOnly = true; lastNotice = 'session'; }
  }

  /**
   * @param {{ path: string, size: number, read: () => Promise<Uint8Array> }[]} entries
   * @param {number} [packBytes]
   */
  async function importEntries(entries, packBytes = 0) {
    await boot();
    lastNotice = null;
    const paths = [];
    for (const entry of entries) {
      const norm = typeof normalizePackPath === 'function' ? normalizePackPath(entry.path) : entry.path;
      const rel = themeRelPath(norm || entry.path);
      if (!rel) return fail('bad-path');
      paths.push({ ...entry, rel });
    }
    const root = themeRootOf(paths.map((e) => e.rel));
    if (!root.ok) return fail(root.code);
    /** @type {Map<string, { rel: string, size: number, read: () => Promise<Uint8Array> }>} */
    const byRel = new Map();
    for (const entry of paths) {
      const rel = stripThemePrefix(entry.rel, root.prefix);
      if (!rel) continue;
      if (!byRel.has(rel)) byRel.set(rel, { rel, size: entry.size, read: entry.read });
    }
    const manifest = byRel.get('theme.json');
    if (!manifest) return fail('bad-json');
    if (manifest.size > THEME_LIMITS.json) return fail('too-big');
    let jsonText;
    try { jsonText = new TextDecoder('utf-8', { fatal: true }).decode(await manifest.read()); }
    catch { return fail('bad-json'); }
    const listed = [...byRel.values()].filter((f) => f.rel !== 'theme.json');
    if (listed.length + 1 > THEME_LIMITS.files) return fail('too-many-files');
    const sum = listed.reduce((n, f) => n + (Number(f.size) || 0), utf8Size(jsonText));
    if (sum > THEME_LIMITS.pack || packBytes > THEME_LIMITS.pack) return fail('too-big');

    let parsedId;
    try { parsedId = JSON.parse(jsonText).id; } catch { parsedId = null; }
    const replace = typeof parsedId === 'string' && mem.has(parsedId) && !mem.get(parsedId).official;
    if (!replace && importedCount() >= THEME_LIMITS.packs) return fail('too-many-packs');
    const draft = assessTheme({
      jsonText,
      files: listed.map((f) => ({ path: f.rel, size: f.size })),
      packBytes,
      storedCount: importedCount(),
      replace,
    });
    if (!draft.ok) return fail(draft.code);

    /** @type {Map<string, Blob>} */
    const blobs = new Map();
    /** @type {{ path: string, size: number, width?: number, height?: number, measured?: boolean }[]} */
    const measured = [];
    const want = new Set();
    for (const img of Object.values(draft.images)) want.add(img.path);
    for (const banner of Object.values(draft.banners)) {
      const path = bannerPath(banner);
      if (path) want.add(path);
    }
    if (draft.character?.image?.path) want.add(draft.character.image.path);
    if (draft.character?.spine) {
      want.add(draft.character.spine.skel);
      want.add(draft.character.spine.atlas);
      for (const tex of draft.character.spine.textures) want.add(tex);
    }
    if (draft.thumbnail) want.add(draft.thumbnail);
    if (draft.preview) want.add(draft.preview);
    for (const lines of Object.values(draft.voice)) for (const path of lines) want.add(path);
    // Every listed file keeps a size entry. Only a file the first pass accepted is decoded.
    for (const file of listed) {
      const image = ['png', 'jpg', 'jpeg', 'webp'].includes(extOf(file.rel));
      const audio = ['ogg', 'mp3'].includes(extOf(file.rel));
      const needed = want.has(file.rel);
      if ((image || audio) && needed && file.size > 0 && file.size <= (image ? THEME_LIMITS.image : THEME_LIMITS.audio)) {
        try {
          const bytes = await file.read();
          const type = MIME[extOf(file.rel)] || 'application/octet-stream';
          const blob = new Blob([bytes], { type });
          blobs.set(file.rel, blob);
          if (image) {
            const dim = await measure(blob);
            measured.push({ path: file.rel, size: file.size, width: dim.width, height: dim.height, measured: dim.ok === true });
            continue;
          }
        } catch {
          measured.push({ path: file.rel, size: file.size, measured: false });
          continue;
        }
      }
      measured.push({ path: file.rel, size: file.size });
    }
    const report = assessTheme({
      jsonText,
      files: measured,
      packBytes,
      storedCount: importedCount(),
      replace,
    });
    if (!report.ok) return fail(report.code);
    /** @type {Record<string, Blob>} */
    const files = {};
    const keep = new Set();
    for (const img of Object.values(report.images)) keep.add(img.path);
    for (const banner of Object.values(report.banners)) {
      const path = bannerPath(banner);
      if (path) keep.add(path);
    }
    if (report.character?.image?.path) keep.add(report.character.image.path);
    if (report.character?.spine) for (const tex of report.character.spine.textures) keep.add(tex);
    for (const lines of Object.values(report.voice)) for (const path of lines) keep.add(path);
    if (report.thumbnail) keep.add(report.thumbnail);
    if (report.preview) keep.add(report.preview);
    for (const path of keep) if (blobs.has(path)) files[path] = blobs.get(path);
    const rec = {
      id: report.id,
      name: report.name,
      author: report.author,
      version: report.version,
      description: report.description,
      colors: report.colors,
      tokens: report.tokens,
      images: report.images,
      banners: report.banners,
      voice: report.voice,
      character: report.character,
      thumbnail: report.thumbnail,
      preview: report.preview,
      files,
      savedAt: Date.now(),
    };
    const saved = await persist(rec);
    revokePack(rec.id);
    const live = runtimeOf(rec);
    live.files = files;
    live.stored = rec;
    mem.set(rec.id, live);
    lastReport = publicReport(report);
    if (!saved) lastNotice = 'session';
    return { ok: true, id: rec.id, report: lastReport, notice: lastNotice, saved };
  }

  async function importZip(file) {
    let bytes;
    try { bytes = await file.arrayBuffer(); } catch { return fail('bad-json'); }
    if (bytes.byteLength > THEME_LIMITS.pack) return fail('too-big');
    const zip = await openZip(bytes);
    if (!zip?.ok) return fail('bad-zip');
    /** @type {{ path: string, size: number, read: () => Promise<Uint8Array> }[]} */
    const entries = [];
    for (const entry of zip.entries) {
      if (entry.encrypted || (entry.method !== 0 && entry.method !== 8)) continue;
      const norm = normalizePackPath(entry.name);
      if (!norm) continue;
      const rel = themeRelPath(norm);
      if (!rel) return fail('bad-path');
      entries.push({
        path: rel,
        size: entry.uncompSize,
        read: async () => {
          const got = await zip.read(entry);
          if (!got?.ok) throw new Error(got?.code || 'bad-entry');
          return got.bytes;
        },
      });
    }
    return importEntries(entries, bytes.byteLength);
  }

  async function importFileList(fileList) {
    const files = [...fileList];
    let packBytes = 0;
    /** @type {{ path: string, size: number, read: () => Promise<Uint8Array> }[]} */
    const entries = [];
    for (const file of files) {
      const raw = file.webkitRelativePath || file.name;
      const rel = themeRelPath(raw);
      if (!rel) return fail('bad-path');
      packBytes += file.size || 0;
      entries.push({
        path: rel,
        size: file.size || 0,
        read: async () => new Uint8Array(await file.arrayBuffer()),
      });
    }
    return importEntries(entries, packBytes);
  }

  function importedCount() {
    let n = 0;
    for (const live of mem.values()) if (!live.official) n += 1;
    return n;
  }

  async function loadAssetManifest() {
    if (manifestLoaded) return assetManifest;
    manifestLoaded = true;
    const fetchFn = opts.fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') { assetManifest = null; return null; }
    try {
      const res = await fetchFn('/data/local-assets.json', { cache: 'no-cache' });
      if (!res?.ok) { assetManifest = null; return null; }
      const doc = await res.json();
      assetManifest = doc && typeof doc === 'object' ? doc : null;
    } catch {
      assetManifest = null;
    }
    return assetManifest;
  }

  /**
   * Fetch one installed official pack and keep it in memory. It is not written to IndexedDB and
   * it does not count toward the imported-pack limit. Spine files stay on their served URLs.
   * @param {{ id: string, group: string }} row
   * @param {{ groups?: Record<string, Record<string, { path?: string }>> }} manifest
   */
  async function loadOfficial(row, manifest) {
    const group = manifest?.groups?.[row.group];
    const themeUrl = officialAssetUrl(row.group, group?.['theme.json']);
    if (!themeUrl) return { ok: false, code: 'missing' };
    const fetchFn = opts.fetchImpl || globalThis.fetch;
    if (typeof fetchFn !== 'function') return { ok: false, code: 'missing' };
    let jsonText;
    try {
      const res = await fetchFn(themeUrl, { cache: 'no-cache' });
      if (!res?.ok) return { ok: false, code: 'broken' };
      jsonText = await res.text();
    } catch {
      return { ok: false, code: 'broken' };
    }
    let doc;
    try { doc = JSON.parse(jsonText); } catch { return { ok: false, code: 'broken' }; }
    /** @type {{ rel: string, size: number, bytes: Uint8Array, url: string }[]} */
    const fetched = [];
    for (const rel of themePathsOf(doc)) {
      const url = officialAssetUrl(row.group, group[rel]);
      if (!url) continue;
      try {
        const res = await fetchFn(url, { cache: 'no-cache' });
        if (!res?.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        fetched.push({ rel, size: bytes.byteLength, bytes, url });
      } catch { /* assess reports the hole */ }
    }
    /** @type {Record<string, Blob>} */
    const blobs = {};
    /** @type {{ path: string, size: number, width?: number, height?: number, measured?: boolean }[]} */
    const measured = [];
    for (const file of fetched) {
      const ext = extOf(file.rel);
      if (ext === 'skel' || ext === 'atlas') {
        measured.push({ path: file.rel, size: file.size });
        continue;
      }
      const image = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
      const audio = ['ogg', 'mp3'].includes(ext);
      if (image || audio) {
        const blob = new Blob([file.bytes], { type: MIME[ext] || 'application/octet-stream' });
        blobs[file.rel] = blob;
        if (image) {
          try {
            const dim = await measure(blob);
            measured.push({ path: file.rel, size: file.size, width: dim.width, height: dim.height, measured: dim.ok === true });
          } catch {
            measured.push({ path: file.rel, size: file.size, measured: false });
          }
          continue;
        }
      }
      measured.push({ path: file.rel, size: file.size });
    }
    const report = assessTheme({ jsonText, files: measured, storedCount: 0, replace: true });
    if (!report.ok || report.id !== row.id) return { ok: false, code: report.ok ? 'broken' : (report.code || 'broken') };
    const urlOf = (rel) => officialAssetUrl(row.group, group[rel]);
    let character = report.character || null;
    if (character?.spine) {
      const skel = urlOf(character.spine.skel);
      const atlas = urlOf(character.spine.atlas);
      const textures = character.spine.textures.map(urlOf);
      if (!skel || !atlas || textures.some((url) => !url)) character = null;
      else character = { spine: { skel, atlas, textures }, anims: character.anims };
    }
    /** @type {Record<string, Blob>} */
    const files = {};
    const keep = new Set();
    for (const img of Object.values(report.images)) keep.add(img.path);
    for (const banner of Object.values(report.banners)) {
      const path = bannerPath(banner);
      if (path) keep.add(path);
    }
    for (const lines of Object.values(report.voice)) for (const path of lines) keep.add(path);
    if (report.thumbnail) keep.add(report.thumbnail);
    if (report.preview) keep.add(report.preview);
    if (character?.image?.path) keep.add(character.image.path);
    for (const path of keep) if (blobs[path]) files[path] = blobs[path];
    const rec = {
      id: report.id,
      name: report.name,
      author: report.author,
      version: report.version,
      description: report.description,
      colors: report.colors,
      tokens: report.tokens,
      images: report.images,
      banners: report.banners,
      voice: report.voice,
      character,
      thumbnail: report.thumbnail,
      preview: report.preview,
      files,
      official: true,
      savedAt: Date.now(),
    };
    revokePack(rec.id);
    const live = runtimeOf(rec);
    live.official = true;
    mem.set(rec.id, live);
    return { ok: true, id: rec.id };
  }

  function officialCards() {
    return installedOfficialThemes(assetManifest).map((row) => ({
      id: row.id,
      name: row.name,
      author: '',
      version: '',
      description: row.description,
      thumbnailUrl: row.thumbnailUrl || null,
      official: true,
    }));
  }

  async function remove(id) {
    await boot();
    if (!mem.has(id) || id === BUILTIN_ID || mem.get(id).official) return false;
    mem.delete(id);
    revokePack(id);
    await persistDelete(id);
    return true;
  }

  function fail(code) {
    lastReport = { ok: false, code, used: emptyUsed(), unused: emptyUnused(), refused: [], ignored: [] };
    return { ok: false, code, report: lastReport, notice: lastNotice };
  }

  return {
    boot,
    importEntries,
    importZip,
    importFileList,
    remove,
    loadAssetManifest,
    loadOfficial,
    officialCards,
    list: () => [...mem.values()].map(cardOf),
    get: (id) => mem.get(id) || null,
    get sessionOnly() { return sessionOnly; },
    get lastReport() { return lastReport; },
    get lastNotice() { return lastNotice; },
    setNotice(code) { lastNotice = code; },
  };
}

function emptyUsed() {
  return { colors: [], tokens: [], images: [], banners: [], voice: [] };
}
function emptyUnused() {
  return { colors: [], images: [], banners: [], voice: [], keys: [] };
}
function utf8Size(text) {
  return new TextEncoder().encode(text).length;
}
function publicReport(report) {
  return {
    ok: true,
    id: report.id,
    name: report.name,
    used: report.used,
    unused: report.unused,
    refused: report.refused,
    ignored: report.ignored,
  };
}

const library = createThemeLibrary();

let settingsGet = () => ({ uiTheme: '', voice: 0.8, muted: false });
let settingsSet = () => {};

/** settings.js owns the store. This module must not import it (the dialog imports us). */
export function bindThemeSettings(api) {
  settingsGet = api.get;
  settingsSet = api.set;
}

let appliedKey = '';
let voicePackId = '';
let cueState = emptyCueState();
let gate = createVoiceGate({ random: () => Math.random(), now: () => Date.now() / 1000 });
/** @type {HTMLAudioElement | null} */
let voiceEl = null;
let voiceGen = 0;
/** @type {((stem: string | null) => void) | null} */
let voiceListener = null;

/** themeCharacter.js registers this. uiTheme does not import that module. */
export function bindThemeCharacterVoice(fn) {
  voiceListener = typeof fn === 'function' ? fn : null;
}

function noteVoiceStem(stem) {
  if (voiceListener) {
    try { voiceListener(stem); } catch { /* the portrait must not stop the line */ }
  }
}

function rootEl() {
  return globalThis.document?.documentElement || null;
}

export function themePack(id) {
  if (!id || id === BUILTIN_ID) return null;
  return library.get(id);
}

/**
 * Image slots drawn at their picture's own aspect (ui-theme.css `aspect-ratio: var(--sp-ar-<slot>)`): the top bar's two
 * 🔍 buttons keep the hand-made box's height, and a theme's picture — 可露希尔 100×68 / 88×56, 乌萨斯齐心团 and
 * ac_n_initial 73×41 (their layout.json sizes) — used to be stretched into the built-in 35:29 box (the owner,
 * 2026-11-14 「最顶上状态栏有图标有变形」, §37.201).
 */
export const ASPECT_SLOTS = Object.freeze(['img_check_player', 'img_check_enemy']);

/** Measure the pack's ASPECT_SLOTS pictures and set `--sp-ar-<slot>: w / h` on the root (cleared first; async). */
function applySlotAspects(root, pack, key) {
  for (const slot of ASPECT_SLOTS) root.style.removeProperty(`--sp-ar-${slot}`);
  if (!pack?.images || typeof Image !== 'function') return;
  for (const slot of ASPECT_SLOTS) {
    const url = pack.images[slot]?.url;
    if (!url) continue;
    const img = new Image();
    img.onload = () => {
      if (appliedKey !== key || !(img.naturalWidth > 0 && img.naturalHeight > 0)) return;
      root.style.setProperty(`--sp-ar-${slot}`, `${img.naturalWidth} / ${img.naturalHeight}`);
    };
    img.src = url;
  }
}

/** Paint `id`, or the built-in look when the id is empty or the pack is gone. */
export function applyUiTheme(id) {
  const pack = themePack(id);
  const key = pack ? `${pack.id}:${pack.rev}` : '';
  if (key === appliedKey && (pack ? voicePackId === pack.id : voicePackId === '')) return pack;
  appliedKey = key;
  const root = rootEl();
  if (root) {
    applyThemeTo(root, pack);
    applySlotAspects(root, pack, key);
  }
  if (!pack) {
    stopVoice();
    voicePackId = '';
  } else if (voicePackId !== pack.id) {
    stopVoice();
    voicePackId = pack.id;
    gate = createVoiceGate({ random: () => Math.random(), now: () => Date.now() / 1000 });
  }
  return pack;
}

function stopVoice() {
  voiceGen += 1;
  gate.finish();
  noteVoiceStem(null);
  if (voiceEl) {
    try { voiceEl.pause(); } catch { /* ignore */ }
    voiceEl.removeAttribute('src');
  }
}

function voiceVolume() {
  const s = settingsGet() || {};
  if (s.muted || !(Number(s.voice) > 0)) return 0;
  return Number(s.voice) ** 2;
}

/** The settings dialog calls this beside the audio volumes. A line already playing follows the slider. */
export function syncThemeVoiceVolume() {
  if (voiceEl) voiceEl.volume = voiceVolume();
}

function playUrl(url) {
  if (typeof Audio !== 'function') { gate.finish(); return; }
  const gen = ++voiceGen;
  if (!voiceEl) {
    voiceEl = new Audio();
    voiceEl.preload = 'auto';
  }
  voiceEl.onended = () => { if (gen === voiceGen) { gate.finish(); noteVoiceStem(null); } };
  voiceEl.onerror = () => { if (gen === voiceGen) { gate.finish(); noteVoiceStem(null); } };
  voiceEl.volume = voiceVolume();
  voiceEl.src = url;
  const pack = themePack(settingsGet().uiTheme);
  noteVoiceStem(pack?.voiceStem?.[url] || null);
  const started = voiceEl.play();
  if (started && typeof started.catch === 'function') {
    started.catch(() => { if (gen === voiceGen) { gate.finish(); noteVoiceStem(null); } });
  }
}

function linesOf(id) {
  const pack = themePack(settingsGet().uiTheme);
  return pack?.voice?.[id] || [];
}

function playCues(cues) {
  if (!settingsGet().uiTheme) return;
  const played = takeVoiceCues(gate, cues, linesOf);
  if (played.length) playUrl(played[played.length - 1]);
}

/**
 * Match view → voice cues. Safe to call on every snapshot; an unchanged view adds nothing.
 * The cue memory advances even when no theme is selected, so a switch mid-match does not replay the start.
 * @param {Record<string, any>} view
 */
export function noteThemeView(view) {
  const snap = themeViewSnap(view);
  const step = stepThemeCues(cueState, snap);
  cueState = step.state;
  if (step.cues.length) playCues(step.cues);
}

/**
 * A purchase that the server accepted. `ownedCopies` is the count before the buy.
 * @param {{ tier?: number, ownedCopies?: number, trigger: string }} buy
 */
export function noteThemeBuy(buy) {
  if (!buy?.trigger) return;
  playCues([buy.trigger]);
}

export async function bootUiThemes() {
  try { await library.boot(); } catch { /* session only */ }
  let manifest;
  try { manifest = await library.loadAssetManifest(); } catch { manifest = null; }
  const id = settingsGet().uiTheme;
  if (id && officialThemeById(id)) {
    const installed = installedOfficialThemes(manifest).some((row) => row.id === id);
    // A lite zip has no group. Fall back quietly: the pack was never stored here.
    if (!installed) {
      settingsSet({ uiTheme: '' });
      applyUiTheme('');
      return;
    }
    if (!library.get(id)?.official) {
      const loaded = await library.loadOfficial(officialThemeById(id), manifest);
      if (!loaded.ok) {
        settingsSet({ uiTheme: '' });
        library.setNotice('broken');
        applyUiTheme('');
        return;
      }
    }
    applyUiTheme(id);
    return;
  }
  if (id && !library.get(id)) {
    settingsSet({ uiTheme: '' });
    library.setNotice('broken');
    applyUiTheme('');
    return;
  }
  applyUiTheme(id);
}

/**
 * Load an official pack before selectTheme. selectTheme stays synchronous: an import paints
 * in the same turn the zip returns. Missing official group is `missing` (no damage notice).
 */
export async function prepareTheme(id) {
  if (!id || id === BUILTIN_ID || !officialThemeById(id)) return { ok: true };
  if (library.get(id)?.official) return { ok: true };
  const manifest = await library.loadAssetManifest();
  if (!installedOfficialThemes(manifest).some((row) => row.id === id)) return { ok: false, code: 'missing' };
  return library.loadOfficial(officialThemeById(id), manifest);
}

export function selectTheme(id) {
  const next = id && id !== BUILTIN_ID ? id : '';
  settingsSet({ uiTheme: next });
  applyUiTheme(next);
}

export async function importThemeZip(file) {
  const result = await library.importZip(file);
  if (result.ok) selectTheme(result.id);
  return result;
}

export async function importThemeFiles(fileList) {
  const result = await library.importFileList(fileList);
  if (result.ok) selectTheme(result.id);
  return result;
}

export async function deleteTheme(id) {
  const removed = await library.remove(id);
  if (removed && settingsGet().uiTheme === id) selectTheme('');
  return removed;
}

export function themeCards() {
  const official = library.officialCards();
  const officialIds = new Set(official.map((card) => card.id));
  // [ASSUMED] An imported zip that reuses an installed official id is hidden while that group is listed.
  const imported = library.list().filter((card) => !officialIds.has(card.id));
  return [...official, ...imported];
}

export function themeStatus() {
  return { sessionOnly: library.sessionOnly, notice: library.lastNotice, report: library.lastReport };
}

export { BUILTIN_ID, THEME_LIMITS };
