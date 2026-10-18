// cosmetics.js — the cosmetic layers of the art a page draws with (DESIGN §32 P1a, docs/PLUGINS.md §9): the room's
// visual set and the player's personal cosmetic plugins, laid over the installation's art manifest (/data/assets.json as
// the page loaded it). public/js/content.js sets them; data.js's view of `assets` (every screen) and the asset store of
// the battlefield (public/js/assets.js `createAssets({ cosmetics })`) read them; audio.js reports the sounds that fail.
//
// Kept small and free of loaders, so the title page carries it at next to no cost (host bandwidth): what composes a set's
// document (shared/plugins/visual.js) is loaded only once there is one — loadVisual; content.js loads it before it fetches
// and sets a document —, and the asset store with its Spine cache (public/js/assets.js) still loads with the first match,
// as in 0.2.6. A page without plugins loads neither.

/** shared/plugins/visual.js, once something needed it (loadVisual). */
let visual = null;
let effects = null;

/**
 * Load what composes a set's document (shared/plugins/visual.js) — content.js before it fetches one, the tests before
 * they lay one. Resolves the module; the same promise again once it is there.
 * @returns {Promise<typeof import('../../shared/plugins/visual.js')>}
 */
export function loadVisual() {
  return visual ? Promise.resolve(visual) : Promise.all([import('../../shared/plugins/visual.js'), import('./render/vfx/pluginLibrary.js')]).then(([m, fx]) => { effects = fx; visual = m; return m; });
}

/** shared/plugins/visual.js when it is already there, else null (a caller that need not wait). */
export const visualNow = () => visual;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The manifest of a store that has none yet: one object, so the layers' memo holds for it too (public/js/assets.js). */
export const EMPTY_MANIFEST = Object.freeze({});

/**
 * A URL as the layers keep it: a same-origin path (with its query), whatever form a loader reports it in (an `<img>`'s
 * absolute `src`, the manifest's own path); null for another origin or no URL.
 * @param {unknown} url
 */
function plainUrl(url) {
  const s = typeof url === 'string' ? url : '';
  if (!s) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s.split('#')[0];
  try {
    const here = globalThis.location?.href || 'http://localhost/';
    const u = new URL(s, here);
    if (u.origin !== new URL(here).origin) return null;
    return u.pathname + u.search;
  } catch { return null; }
}

/**
 * The cosmetic layers of the art a page draws with, laid over the page's own manifest in this order:
 *   1. the installation's manifest — /data/assets.json as the page loaded it (its /assets/~<hash>/ URLs): the `base`
 *      apply() is given;
 *   2. the room's visual set (setRoom: its checked document, /vs/<vs16>/overlay.json; null outside a room or in a room
 *      without plugins: a room's art never stays behind or piles up);
 *   3. the player's personal plugins (setPersonal: `[{ id, doc }]`, in the order they apply) — over the room's art too.
 * Every plugin URL is built from a document's composition and every reference is copied out of `base` itself
 * (shared/plugins/visual.js prepareVisualDoc, layVisualOps), so what the page draws is exactly what the documents' `vs`
 * name; a write that does not fit is left out (its entry keeps the art beneath it) and told to `onDrop` (once per
 * document, and once per change for references the base lacks). A plugin URL that failed to load (fail: an image, a
 * model, a sound) is left out from then on: its entry falls back to the art beneath it — the installation's, or the
 * room's under a personal plugin [ASSUMED: for the rest of the page's life; a set with that file changed has another
 * URL]. `apply(base)` → the manifest to draw with: `base` itself without a layer, else the same object while neither the
 * base nor a layer changed (per base object). `subscribe(fn)` hears every change. A document set before
 * shared/plugins/visual.js is there (content.js loads it first) is laid once it is.
 */
export function createCosmeticLayers() {
  /** @typedef {{ doc: any, prep: import('../../shared/plugins/visual.js').PreparedSet }} Layer */
  /** @type {Layer | null} */
  let room = null;
  /** @type {(Layer & { id: string })[]} */
  let personal = [];
  /** @type {Set<string>} plugin URLs that failed to load */
  const failed = new Set();
  let gen = 0;
  // the manifest drawn with, per base object (data.js's copy and the asset store's may be two: each keeps its own)
  let memo = new WeakMap(); // base → { gen, value }
  const listeners = new Set();
  /** @type {((why: string[], count: number) => void) | null} */
  let dropFn = null;
  let toldLay = -1;
  // what was set while shared/plugins/visual.js was still loading (the last one wins)
  let pendingRoom;
  let pendingPersonal;
  const prepared = new WeakMap(); // document → its PreparedSet (a document never changes)
  const prepare = (doc) => {
    let p = prepared.get(doc);
    if (!p) {
      const fxOps = effects.preparePluginFx(doc, visual);
      const plain = { ...doc, writes: (doc.writes || []).map(w => ({ ...w, ops: (w.ops || []).filter(op => !op.effects) })) };
      p = visual.prepareVisualDoc(plain);
      p.ops.push(...fxOps);
      for (const op of fxOps) for (const url of op.urls) p.urls.add(url);
      prepared.set(doc, p);
      if (p.droppedCount) { try { dropFn?.(p.dropped, p.droppedCount); } catch { /* the listener's own trouble */ } }
    }
    return p;
  };
  const changed = () => {
    gen++;
    memo = new WeakMap();
    for (const fn of [...listeners]) { try { fn(); } catch (err) { console.warn('[cosmetics] layer listener failed', err); } }
  };
  const later = (what) => loadVisual().then(what, (err) => console.warn('[cosmetics] shared/plugins/visual.js did not load', err));
  return {
    /** The room's visual set: its checked document (/vs/<vs16>/overlay.json), or null (no room, a room without plugins). */
    setRoom(doc) {
      const next = isObj(doc) ? doc : null;
      if (next && !visual) { pendingRoom = next; later(() => { if (pendingRoom === next) { pendingRoom = undefined; this.setRoom(next); } }); return; }
      pendingRoom = undefined;
      if (next === (room ? room.doc : null)) return;
      room = next ? { doc: next, prep: prepare(next) } : null;
      changed();
    },
    /** The player's personal plugins: `[{ id, doc }]` — each its checked document —, in the order they apply. */
    setPersonal(list) {
      const next = (Array.isArray(list) ? list : []).filter((p) => isObj(p) && typeof p.id === 'string' && isObj(p.doc));
      if (next.length && !visual) { pendingPersonal = next; later(() => { if (pendingPersonal === next) { pendingPersonal = undefined; this.setPersonal(next); } }); return; }
      pendingPersonal = undefined;
      if (next.length === personal.length && next.every((p, i) => p.id === personal[i].id && p.doc === personal[i].doc)) return;
      personal = next.map((p) => ({ id: p.id, doc: p.doc, prep: prepare(p.doc) }));
      changed();
    },
    /** The room's document, or null. */
    get room() { return room ? room.doc : null; },
    /** The personal plugins applied: `[{ id, doc }]`. */
    get personal() { return personal; },
    /** Is any layer on (a room set or a personal plugin)? */
    get active() { return !!room || personal.length > 0; },
    /**
     * A file of a layer failed to load (an image, a Spine model — any of its files —, a sound): its writes are left out
     * from now on and the listeners are told (the entry draws the art beneath it). Whether it was one of the layers'.
     * @param {unknown} url as the loader reports it (absolute or a path)
     * @returns {boolean}
     */
    fail(url) {
      const u = plainUrl(url);
      if (!u || failed.has(u)) return false;
      if (!(room && room.prep.urls.has(u)) && !personal.some((p) => p.prep.urls.has(u))) return false;
      failed.add(u);
      console.warn(`[cosmetics] ${u} did not load: its entry falls back to the art beneath it`);
      changed();
      return true;
    },
    /** The plugin URLs that failed to load (diagnostics, tests). */
    get failed() { return [...failed]; },
    /** `fn(reasons, count)` when writes had to be left out (see above); one listener. */
    onDrop(fn) { dropFn = typeof fn === 'function' ? fn : null; },
    apply(base) {
      if (!room && !personal.length) return base;
      const key = isObj(base) ? base : EMPTY_MANIFEST;
      const hit = memo.get(key);
      if (hit && hit.gen === gen) return hit.value;
      // (a layer is only ever set with shared/plugins/visual.js there)
      const { manifest, dropped } = visual.layVisualOps(key, [...(room ? [room.prep] : []), ...personal.map((p) => p.prep)], { failed });
      // a reference the page's manifest lacks (told once per change, for a manifest that is loaded)
      if (dropped.length && key !== EMPTY_MANIFEST && toldLay !== gen) {
        toldLay = gen;
        try { dropFn?.(dropped, dropped.length); } catch { /* the listener's own trouble */ }
      }
      memo.set(key, { gen, value: manifest });
      return manifest;
    },
    /** `fn()` after every change; returns the unsubscribe. */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** The page's cosmetic layers (public/js/content.js sets them; data.js's view and the asset store read them). */
export const cosmetics = createCosmeticLayers();
