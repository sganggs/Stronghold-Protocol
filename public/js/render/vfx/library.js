// render/vfx/library.js — the official effects' files (DESIGN §33.1): the file list, index.json, textures.json, the
// prefab descriptors (compiled once, render/vfx/effect.js), meshes and textures, loaded on demand and cached.
//
//   const lib = new FxLibrary({ assets })        assets: the asset store (public/js/assets.js) — its local-art manifest
//                                                is the fallback file list of a Phase 1a extraction
//   await lib.init()  → lib.available            the file list: GET /data/local-fx.json (the served view: hashed URLs,
//                                                `{ groups: {} }` without effects), else the `fx*` groups of
//                                                data/local-assets.json; URLs always come from the list
//   await lib.index()                            index.json (units, projectiles, skills, skins, generic keys)
//   lib.def(key) / await lib.load(key)           a compiled prefab (null until loaded / when absent)
//   await lib.preload(keys, { half })            descriptors + their meshes and textures (a battle's set)
//   lib.mesh(key), lib.texture(key, half)        loaded data or null (and a load is started)
//
// Keys are lower case (§33.1). Built-in Unity meshes ('builtin:Quad', 'builtin:Plane', 'builtin:Cube',
// 'builtin:Sphere') are generated here.

import { compileEffect } from './effect.js';
import { FX_LIST_URL, loadFxList } from './available.js';
import { setIndexVersion } from './mounts.js';
import { mergePluginFx } from './pluginLibrary.js';
const MAX_PARALLEL = 8;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Unity's built-in meshes as fx-mesh records. */
export function builtinMesh(name) {
  if (name === 'Quad') {
    return { positions: [-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], normals: [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1],
      uv0: [0, 0, 1, 0, 0, 1, 1, 1], submeshes: [[0, 3, 1, 3, 0, 2]] };
  }
  if (name === 'Plane') {
    // 10 × 10 units in XZ, facing +Y, 11 × 11 vertices
    const P = [], N = [], U = [], I = [];
    for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) { P.push(5 - i, 0, 5 - j); N.push(0, 1, 0); U.push(i / 10, j / 10); }
    for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) { const a = j * 11 + i; I.push(a, a + 11, a + 1, a + 1, a + 11, a + 12); }
    return { positions: P, normals: N, uv0: U, submeshes: [I] };
  }
  if (name === 'Cube') {
    const P = [], N = [], U = [], I = [];
    const faces = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    for (const n of faces) {
      const u = Math.abs(n[1]) === 1 ? [1, 0, 0] : [0, 1, 0];
      const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      const b = P.length / 3;
      for (const [a, c] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        P.push((n[0] + u[0] * a + v[0] * c) / 2, (n[1] + u[1] * a + v[1] * c) / 2, (n[2] + u[2] * a + v[2] * c) / 2);
        N.push(...n); U.push((a + 1) / 2, (c + 1) / 2);
      }
      I.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    return { positions: P, normals: N, uv0: U, submeshes: [I] };
  }
  if (name === 'Sphere') {
    const P = [], N = [], U = [], I = [], R = 12, S = 24;
    for (let j = 0; j <= R; j++) for (let i = 0; i <= S; i++) {
      const th = (j / R) * Math.PI, ph = (i / S) * Math.PI * 2;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      P.push(x / 2, y / 2, z / 2); N.push(x, y, z); U.push(i / S, 1 - j / R);
    }
    for (let j = 0; j < R; j++) for (let i = 0; i < S; i++) { const a = j * (S + 1) + i; I.push(a, a + 1, a + S + 1, a + 1, a + S + 2, a + S + 1); }
    return { positions: P, normals: N, uv0: U, submeshes: [I] };
  }
  return null;
}

/**
 * A loaded mesh made ready for the runtime: vertex colours as 0…1 floats (the extracted files write them as bytes,
 * 0…255 — DESIGN §33.9 says 0…1; both are accepted).
 */
export function normalizeMesh(m) {
  if (!m || !Array.isArray(m.positions)) return null;
  const c = m.colors;
  if (Array.isArray(c) && c.length) {
    let max = 0;
    for (let i = 0; i < c.length; i++) if (c[i] > max) max = c[i];
    if (max > 1.0001) m.colors = c.map((x) => x / 255);
  }
  return m;
}

export class FxLibrary {
  /**
   * @param {{ assets?: any, fetch?: typeof fetch, listUrl?: string, list?: any, decode?: (blob: Blob) => Promise<any> }} [opts]
   */
  constructor(opts = {}) {
    this.assets = opts.assets || null;
    this._defaultFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
    this.fetch = opts.fetch || this._defaultFetch;
    this.listUrl = opts.listUrl || FX_LIST_URL;
    this.list = isObj(opts.list) ? opts.list : null;
    this.groups = null;
    this._init = null;
    this._index = null;
    this._texInfo = null;
    this.descs = new Map();     // key → Promise<descriptor|null>
    this.defs = new Map();      // key → compiled EffectDef | null
    this.meshes = new Map();    // key → data | null (loaded)
    this.meshLoads = new Map(); // key → Promise
    this.images = new Map();    // `${key}|${half}` → { image, flipped, info } | null
    this.imageLoads = new Map();
    this.onGpu = new Set();     // the same ids once FxGL holds them (their images were let go: not decoded again)
    this.queue = [];
    this.active = 0;
    this.failed = new Set();
    this.listeners = new Set();
  }

  /** Load the file list (once). Resolves to `available`. */
  init() {
    if (this._init) return this._init;
    this._init = (async () => {
      let list = this.list;
      if (!list && this.listUrl === FX_LIST_URL && this.fetch === this._defaultFetch) list = await loadFxList(this.fetch);
      else if (!list && this.fetch) {
        try {
          const res = await this.fetch(this.listUrl);
          if (res && res.ok) list = await res.json();
        } catch { /* no effects */ }
      }
      let groups = isObj(list?.groups) ? list.groups : null;
      if (!groups || !isObj(groups['fx/prefabs']) || !Object.keys(groups['fx/prefabs']).length) {
        // a Phase 1a extraction listed the effects in data/local-assets.json
        let local;
        try { local = this.assets?.local ? await this.assets.local() : null; } catch { local = null; }
        const g = isObj(local?.groups) ? local.groups : null;
        if (g && isObj(g['fx/prefabs']) && Object.keys(g['fx/prefabs']).length) groups = { fx: g.fx || {}, 'fx/prefabs': g['fx/prefabs'], 'fx/tex': g['fx/tex'] || {}, 'fx/mesh': g['fx/mesh'] || {} };
      }
      this.groups = groups && isObj(groups['fx/prefabs']) ? groups : null;
      this.pluginFx = mergePluginFx(null, this.assets?.manifest?.fx);
      if (this.pluginFx.descriptors.size) {
        this.groups ||= { fx: {}, 'fx/prefabs': {}, 'fx/tex': {}, 'fx/mesh': {} };
        this.groups = { ...this.groups, 'fx/tex': { ...this.groups['fx/tex'], ...this.pluginFx.textures } };
      }
      // computed once: the full set lists ~4,000 prefabs and `available` is read for every event
      this._available = false;
      if (this.groups) for (const _k in this.groups['fx/prefabs']) { this._available = true; break; }
      if (this.pluginFx.descriptors.size) this._available = true;
      return this._available;
    })();
    return this._init;
  }

  /** Effects were extracted (the file list names prefabs). */
  get available() { return !!this._available; }

  /** Missing optional mappings are one console note per view, including machines without an official index. */
  notePluginUnit(unit) {
    if (!unit || this.notedPluginUnit) return;
    this.checkedPluginUnits ||= new Set();
    if (this.checkedPluginUnits.has(unit)) return;
    this.checkedPluginUnits.add(unit);
    this.index().then(idx => {
      if (!idx?.units?.[unit] && !this.notedPluginUnit) {
        this.notedPluginUnit = true;
        console.info('[fx] plugin official unit missing locally; using fallback:', unit);
      }
    });
  }

  /** Visual-set changes invalidate plugin descriptors; official cached resources remain valid. */
  reloadPlugins() {
    this.pluginRevision = (this.pluginRevision || 0) + 1;
    for (const map of [this.descs, this.defs, this.images, this.imageLoads]) for (const key of map.keys()) if (key.startsWith('plugin:')) {
      if (map === this.images) map.get(key)?.image?.close?.();
      map.delete(key);
    }
    this._init = null; this._index = null; this.pluginFx = null;
    return this.init();
  }

  /** URL of a file-list entry. */
  url(group, key) {
    const e = this.groups?.[group]?.[key];
    return isObj(e) && typeof e.path === 'string' ? e.path : null;
  }

  has(key) { return this.pluginFx?.descriptors.has(String(key || '').toLowerCase()) || !!this.url('fx/prefabs', String(key || '').toLowerCase()); }

  async _json(url) {
    if (!url || !this.fetch) return null;
    const res = await this.fetch(url);
    if (!res || !res.ok) throw new Error(`fx ${res ? res.status : 'no response'} ${url}`);
    return res.json();
  }

  /** index.json (null without one); its version tells mounts.js whether skins still need skinShift. */
  index() {
    if (this._index) return this._index;
    this._index = this.init().then(() => this._json(this.url('fx', 'index')).catch(() => null)).then((j) => {
      setIndexVersion(j?.version);
      if (Object.keys(this.assets?.manifest?.fx || {}).length) { this.pluginFx = mergePluginFx(j, this.assets.manifest.fx); return this.pluginFx.index; }
      return j;
    }).catch(() => null);
    return this._index;
  }

  /** textures.json entries (wrap / filter / mips by texture key). */
  texInfo() {
    if (this._texInfo) return this._texInfo;
    this._texInfo = this.init().then(() => this._json(this.url('fx', 'textures'))).then((j) => (isObj(j?.textures) ? j.textures : {})).catch(() => ({}));
    return this._texInfo;
  }

  /** Run fn under the parallel-load limit. */
  _limit(fn) {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.active++;
        Promise.resolve().then(fn).then(resolve, reject).finally(() => { this.active--; const next = this.queue.shift(); if (next) next(); });
      };
      if (this.active < MAX_PARALLEL) run(); else this.queue.push(run);
    });
  }

  /** The descriptor of a prefab key (null when absent / failed). */
  descriptor(key) {
    const k = String(key || '').toLowerCase();
    let p = this.descs.get(k);
    if (!p) {
      p = this.init().then(() => {
        if (this.pluginFx?.descriptors.has(k)) return this.pluginFx.descriptors.get(k);
        const url = this.url('fx/prefabs', k);
        return url ? this._limit(() => this._json(url)) : null;
      }).catch((err) => { this.failed.add(k); console.warn('[fx] prefab failed', k, err?.message || err); return null; });
      this.descs.set(k, p);
    }
    return p;
  }

  /** A compiled prefab if already loaded (else null; see load). */
  def(key) { return this.defs.get(String(key || '').toLowerCase()) || null; }

  /** Load and compile a prefab (with its meshes; textures load on first draw or through preload). */
  async load(key) {
    const k = String(key || '').toLowerCase();
    const revision = this.pluginRevision || 0;
    if (this.defs.has(k)) return this.defs.get(k);
    const desc = await this.descriptor(k);
    if (k.startsWith('plugin:') && revision !== (this.pluginRevision || 0)) return null;
    if (this.defs.has(k)) return this.defs.get(k);
    if (!desc) { this.defs.set(k, null); return null; }
    await Promise.all((desc.meshes || []).map((m) => this.loadMesh(m)));
    if (k.startsWith('plugin:') && revision !== (this.pluginRevision || 0)) return null;
    const def = compileEffect(desc, this);
    this.defs.set(k, def);
    return def;
  }

  /** Mesh data (sync; null while loading — the load is started). */
  mesh(key) {
    if (!key) return null;
    if (this.meshes.has(key)) return this.meshes.get(key);
    if (key.startsWith('builtin:')) { const m = builtinMesh(key.slice(8)); this.meshes.set(key, m); return m; }
    this.loadMesh(key);
    return null;
  }

  loadMesh(key) {
    if (!key) return Promise.resolve(null);
    if (this.meshes.has(key)) return Promise.resolve(this.meshes.get(key));
    if (key.startsWith('builtin:')) return Promise.resolve(this.mesh(key));
    let p = this.meshLoads.get(key);
    if (!p) {
      p = this.init().then(() => {
        const url = this.url('fx/mesh', key);
        return url ? this._limit(() => this._json(url)) : null;
      }).then((m) => { const d = normalizeMesh(m); this.meshes.set(key, d); return d; }, () => { this.meshes.set(key, null); return null; });
      this.meshLoads.set(key, p);
    }
    return p;
  }

  /** A texture's image (sync; null while it loads — the load is started). */
  texture(key, half) {
    const id = `${key}|${half ? 1 : 0}`;
    const r = this.images.get(id);
    if (r !== undefined) return r;
    this.loadTexture(key, half);
    return null;
  }

  loadTexture(key, half) {
    const id = `${key}|${half ? 1 : 0}`;
    const revision = this.pluginRevision || 0;
    const stale = () => key.startsWith('plugin:') && revision !== (this.pluginRevision || 0);
    if (this.images.has(id)) return Promise.resolve(this.images.get(id));
    if (this.onGpu.has(id)) return Promise.resolve(null);
    let p = this.imageLoads.get(id);
    if (!p) {
      p = Promise.all([this.init(), this.texInfo()]).then(async ([, infos]) => {
        const e = this.groups?.['fx/tex']?.[key];
        const url = isObj(e) ? (half && typeof e.half === 'string' ? e.half : e.path) : null;
        if (!url) return null;
        const img = await this._limit(() => this._image(url));
        return img ? { image: img.image, flipped: img.flipped, info: infos[key] || {} } : null;
      }).then((r) => {
        if (stale()) { r?.image?.close?.(); return null; }
        this.images.set(id, r); this._notify(); return r;
      }, (err) => {
        if (stale()) return null;
        console.warn('[fx] texture failed', key, err?.message || err);
        this.images.set(id, null);
        return null;
      });
      this.imageLoads.set(id, p);
    }
    return p;
  }

  /** Decode an image: an ImageBitmap flipped for GL (v = 0 at the bottom row), else an HTMLImageElement. */
  async _image(url) {
    if (typeof createImageBitmap === 'function' && this.fetch) {
      const res = await this.fetch(url);
      if (!res.ok) throw new Error(`fx ${res.status} ${url}`);
      const blob = await res.blob();
      const image = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      return { image, flipped: true };
    }
    if (typeof Image === 'undefined') return null;
    const image = await new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`fx image ${url}`));
      im.src = url;
    });
    return { image, flipped: false };
  }

  /** Load prefabs (and the effects they chain), their meshes and textures. */
  async preload(keys, o = {}) {
    const seen = new Set();
    const loadKey = async (k) => {
      const key = String(k || '').toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const def = await this.load(key);
      if (!def) return;
      const jobs = def.textures.map((t) => this.loadTexture(t, !!o.half));
      if (o.refs !== false) for (const r of def.refs) jobs.push(loadKey(r));
      await Promise.all(jobs);
    };
    await Promise.all([...new Set(keys)].map(loadKey));
    return seen.size;
  }

  /** Let a decoded image go once it is on the GPU (see FxGL.texture). */
  release(key, half) {
    const id = `${key}|${half ? 1 : 0}`;
    const r = this.images.get(id);
    if (r && r.image && typeof r.image.close === 'function') r.image.close();
    this.images.delete(id);
    this.imageLoads.delete(id);
    this.onGpu.add(id);
  }

  /** The GPU let its textures go (FxGL destroyed): they load again when drawn. */
  forgetGpu() { this.onGpu.clear(); }

  onLoad(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _notify() { for (const fn of this.listeners) { try { fn(); } catch { /* ignore */ } } }

  /** Release decoded images (a context loss, the end of a session). */
  dropImages() {
    for (const r of this.images.values()) if (r && r.image && typeof r.image.close === 'function') r.image.close();
    this.images.clear();
    this.imageLoads.clear();
    this.onGpu.clear();
  }
}
