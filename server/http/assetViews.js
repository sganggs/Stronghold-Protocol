// server/http/assetViews.js — the served manifests (host bandwidth, layer 1; docs/ASSETS.md "The served manifests"):
// data/assets.json and data/local-assets.json as this server hands them out, every art URL carrying the content hash
// of its file as its first segment (shared/assetPaths.js) — `/assets/char/avatar/x.png` →
// `/assets/~<hash>/char/avatar/x.png`, `/fonts/~<hash>/…` — so the browser keeps the file for a year and asks again
// only when the bytes change. Audio keeps the `/assets/~<hash>/audio/….mp3` form: public/js/media.js turns it into
// `/media/~<hash>/…` when it fetches it.
//
//   * A Spine model's skeleton, atlas and pages carry ONE hash, that of the model (assetIndex.js models): pixi-spine
//     finds the atlas by the skeleton's name and the pages next to the atlas, so their URLs share a folder. A model is
//     every `{ skel, atlas, textures }` object of data/assets.json (chars' front / back, tokens, enemies) and every
//     `spine/…` group of data/local-assets.json (the files a `spineLocal` record names).
//   * A URL the index has no hash for (not on disk, not hashed yet) stays as it is.
//   * The committed data/assets.json is never written: a view is built in memory from the file and the index, again
//     when either changes (the file's size / mtime, the index's generation), and once after every index build, so the
//     index knows the model lists before any page asks.
//   * No index, or not ready yet: no view (`get` → null) and the files go out as they are.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { hashedPath } from '../../shared/assetPaths.js';
import { hash16 } from './assetIndex.js';
import { noopLog } from './config.js';

/** The manifests that have a view, by their name under data/. */
export const VIEW_MANIFESTS = Object.freeze(['assets.json', 'local-assets.json']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ART_URL = /^\/(?:assets|fonts)\/./;

/** URL path of a manifest → the index's rel path ('/assets/a%20b.png' → 'assets/a b.png'), or null. */
export function relOf(url) {
  if (typeof url !== 'string' || !ART_URL.test(url) || /[?#]/.test(url)) return null;
  let p;
  try { p = decodeURIComponent(url); } catch { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  const segs = p.slice(1).split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return null;
  return segs.join('/');
}

/** Is `o` a Spine object of data/assets.json (`{ skel: '/….skel', atlas, textures? }`)? */
const isSpine = (o) => isObj(o) && typeof o.skel === 'string' && o.skel.startsWith('/') && /\.skel$/.test(o.skel);

/** The URLs of a Spine object: skeleton, atlas, pages (the `<skel name>.png` when it lists none). */
function spineUrls(o) {
  const out = [o.skel];
  if (typeof o.atlas === 'string' && o.atlas) out.push(o.atlas);
  const pages = Array.isArray(o.textures) ? o.textures.filter((u) => typeof u === 'string' && u) : [];
  out.push(...(pages.length ? pages : [o.skel.replace(/\.skel$/, '.png')]));
  return out;
}

/**
 * The served copy of a manifest and its model lists. `index`: hashOf(rel) / modelHash(rels) of assetIndex.js.
 * @param {any} doc the parsed manifest (not changed)
 * @param {'assets.json'|'local-assets.json'} name
 * @param {{ hashOf: (rel: string) => string | null, modelHash: (rels: string[]) => string | null }} index
 * @returns {{ doc: any, models: string[][], hashed: number, plain: number }}
 */
export function rewriteManifest(doc, name, index) {
  const models = [];
  let hashed = 0;
  let plain = 0;
  const own = (url) => {
    const rel = relOf(url);
    const h = rel ? index.hashOf(rel) : null;
    if (h) { hashed++; return hashedPath(url, h); }
    if (rel) plain++;
    return url;
  };
  /** All URLs of one model with the model's hash (or all left plain when a member is unknown). */
  const model = (urls) => {
    const rels = urls.map(relOf);
    if (rels.some((r) => !r)) return null;
    models.push(rels);
    const h = index.modelHash(rels);
    if (!h) { plain += urls.length; return null; }
    hashed += urls.length;
    return h;
  };
  const walk = (v) => {
    if (typeof v === 'string') return ART_URL.test(v) ? own(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (!isObj(v)) return v;
    if (name === 'assets.json' && isSpine(v)) {
      const h = model(spineUrls(v));
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (h && k === 'skel') out[k] = hashedPath(x, h);
        else if (h && k === 'atlas' && typeof x === 'string') out[k] = hashedPath(x, h);
        else if (h && k === 'textures' && Array.isArray(x)) out[k] = x.map((u) => (typeof u === 'string' ? hashedPath(u, h) : u));
        else out[k] = walk(x);
      }
      return out;
    }
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x);
    return out;
  };
  if (name === 'local-assets.json' && isObj(doc) && isObj(doc.groups)) {
    const groups = {};
    for (const [g, entries] of Object.entries(doc.groups)) {
      if (g.startsWith('spine/') && isObj(entries)) {
        const names = Object.keys(entries).filter((n) => isObj(entries[n]) && typeof entries[n].path === 'string').sort();
        const h = names.length ? model(names.map((n) => entries[n].path)) : null;
        groups[g] = {};
        for (const [n, e] of Object.entries(entries)) {
          groups[g][n] = h && isObj(e) && typeof e.path === 'string' ? { ...e, path: hashedPath(e.path, h) } : walk(e);
        }
      } else groups[g] = walk(entries);
    }
    return { doc: { ...walk({ ...doc, groups: null }), groups }, models, hashed, plain };
  }
  return { doc: walk(doc), models, hashed, plain };
}

/**
 * The views of one server.
 * @param {{ dataDir: string, index: ReturnType<typeof import('./assetIndex.js').createAssetIndex>, log?: object }} opts
 */
export function createManifestViews({ dataDir, index, log = noopLog }) {
  const dir = path.resolve(dataDir);
  /** @type {Map<string, { key: string, view: { body: Buffer, hash: string, hashed: number, plain: number } | null, models: string[][] }>} */
  const cache = new Map();
  /** @type {Map<string, Promise<any>>} */
  const pending = new Map();
  const warned = new Set();

  const pushModels = () => index.setModels([...cache.values()].flatMap((c) => c.models));

  /** Build (or reuse) the view of `name`; null without the file, while the index is not ready or empty, or for a broken file. */
  async function build(name) {
    if (!index.ready || !index.size) return null;
    const file = path.join(dir, name);
    const st = await fsp.stat(file).catch(() => null);
    if (!st || !st.isFile()) {
      if (cache.delete(name)) pushModels();
      return null;
    }
    const key = `${index.generation}|${st.size}|${st.mtimeMs}`;
    const hit = cache.get(name);
    if (hit && hit.key === key) return hit.view;
    let doc;
    try {
      doc = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch (e) {
      if (!warned.has(name)) { warned.add(name); log.warn?.(`[assets] data/${name} unreadable (${e?.message || e}); served as it is`); }
      cache.set(name, { key, view: null, models: [] });
      pushModels();
      return null;
    }
    // one synchronous step: the view and the model lists the index checks a model's URLs against
    const { doc: out, models, hashed, plain } = rewriteManifest(doc, name, index);
    const body = Buffer.from(JSON.stringify(out));
    const view = { body, hash: hash16(body), hashed, plain };
    cache.set(name, { key, view, models });
    pushModels();
    return view;
  }

  /** The view of `name` (one build at a time per manifest). */
  function get(name) {
    if (!VIEW_MANIFESTS.includes(name)) return Promise.resolve(null);
    const running = pending.get(name);
    if (running) return running;
    const p = build(name).catch((e) => { log.error?.('[assets] manifest view failed', e); return null; }).finally(() => pending.delete(name));
    pending.set(name, p);
    return p;
  }

  const rebuildAll = () => Promise.all(VIEW_MANIFESTS.map(get));
  // after every build that changed the hashes (and the first one): the views, and with them the index's model lists
  index.onChange(() => { rebuildAll(); });
  index.whenReady().then(() => rebuildAll(), () => {});

  return {
    get,
    rebuildAll,
    stats() {
      const out = {};
      for (const [name, c] of cache) out[name] = c.view ? { bytes: c.view.body.length, hashed: c.view.hashed, plain: c.view.plain } : null;
      return out;
    },
  };
}
