// One cached picture of a stage's 3D board for the 规程 briefing map (ui/stagePreview.js).
//
// INFO_CHECK renders BriefingScreen only (screens/game.js). MatchScreen, and the live BoardScene
// under it, is not mounted, so there is no match GL context to snapshot. This builds one offscreen
// BoardScene, draws a single prep frame (no units, no HUD), reads it into a JPEG, and destroy()s
// the scene — that releases the context (forceContextLoss). loadScenePack / loadBoardPack are the
// same caches the match uses later, so a briefing that loads a scene warms the match.
//
// Calls are queued: one extra WebGL context at a time. A failure is cached too, so a remount does
// not open another context. The magnifier scales this same bitmap (stagePreview.js).

import { stagePreviewCamera, stagePreviewFrame, stagePreviewSize } from './stagePreview.js';

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * @param {string} stageId
 * @param {{ quality?: string, width: number, height: number }} size
 */
export function stageThumbKey(stageId, size) {
  const q = size?.quality || 'medium';
  const w = size?.width || 0;
  const h = size?.height || 0;
  return `${stageId}|${q}|${w}x${h}`;
}

/**
 * Session cache of thumbnail promises. `render` injects the drawer (tests pass one that throws).
 * The real drawer is renderStageThumb.
 */
export function createStageThumbCache() {
  const cache = new Map();
  let tail = Promise.resolve();
  /**
   * @param {string} stageId
   * @param {{ quality?: string, dpr?: number, size?: object, stage?: any, seat?: number|null,
   *   renderer?: string, render?: (stageId: string, opts: object) => Promise<object|null>,
   *   assets?: object }} [opts]
   * @returns {Promise<{ url: string, width: number, height: number, renderMs: number|null, ms: number }|null>}
   */
  function load(stageId, opts) {
    const id = String(stageId || '');
    const o = opts && typeof opts === 'object' ? opts : {};
    const size = o.size || stagePreviewSize(o.quality, o.dpr ?? 1);
    const key = stageThumbKey(id, size);
    const hit = cache.get(key);
    if (hit) return hit;
    const job = () => runThumb(id, { ...o, size });
    const queued = tail.then(job, job);
    tail = queued.then(() => {}, () => {});
    const stored = queued.then((shot) => shot || null, () => null);
    cache.set(key, stored);
    return stored;
  }
  return {
    load,
    reset() { cache.clear(); },
    get size() { return cache.size; },
  };
}

const session = createStageThumbCache();

/** The page's cache. One entry per stage + quality + buffer size, including failures. */
export function loadStageThumb(stageId, opts) { return session.load(stageId, opts); }

/** Forget the session cache (tests). In-flight draws still finish; their result is not stored again. */
export function resetStageThumbCache() { session.reset(); }

/**
 * @returns {Promise<{ url: string, width: number, height: number, renderMs: number|null, ms: number }|null>}
 */
async function runThumb(stageId, opts) {
  if (!stageId) return null;
  const render = typeof opts.render === 'function' ? opts.render : renderStageThumb;
  const t0 = now();
  let shot;
  try { shot = await render(stageId, opts); } catch { return null; }
  if (!shot || shot.lost || typeof shot.url !== 'string' || !shot.url.startsWith('data:image/')) return null;
  const renderMs = typeof shot.renderMs === 'number' && Number.isFinite(shot.renderMs) ? shot.renderMs : null;
  return {
    url: shot.url,
    width: shot.width || opts.size.width,
    height: shot.height || opts.size.height,
    renderMs,
    ms: now() - t0,
  };
}

/** Adopt the game data's manifests so loadScenePack does not download them again (fieldHost seedAssets). */
function seedThumbAssets(assetsApi, dataApi) {
  try {
    const local = dataApi.getRaw?.('local');
    if (local) assetsApi.seedLocal?.(local);
    const manifest = dataApi.getRaw?.('assets');
    if (manifest) assetsApi.seed?.(manifest);
  } catch { /* the store fetches on its own */ }
}

/** The lit-field uniform eases inside BoardScene.render, and the first frame has dt 0, so snap it. */
function snapFocus(board) {
  const tg = board?.focusTarget;
  const u = board?.focus?.uFocus?.value;
  if (!tg || !u || typeof u.set !== 'function') return;
  u.set(tg[0], tg[1], tg[2], tg[3]);
}

/**
 * Draw one prep frame of `stageId` and return a JPEG data URL. Null when there is no document,
 * no WebGL, no scene, or the draw fails — the caller keeps the cell thumbnail.
 * Every GPU resource of this draw is released before the promise resolves.
 * [ASSUMED] shadows stay off. The official scene is lit by its lightmaps; the match's 2048² shadow
 * map is the cost that misses the thumbnail budget. Antialias and the PMREM environment follow
 * quality the way the match does (off on 'low').
 * @param {string} stageId
 * @param {{ size: { width: number, height: number, quality?: string }, stage?: any, seat?: number|null,
 *   renderer?: string, assets?: object }} opts
 */
export async function renderStageThumb(stageId, opts) {
  if (typeof document === 'undefined') return null;
  const id = String(stageId || '');
  const size = opts?.size;
  if (!id || !size || !(size.width > 0) || !(size.height > 0)) return null;
  const [{ loadThree, loadBoardPack, loadScenePack }, { BoardScene }, { AREAS }, assetsMod, dataMod] = await Promise.all([
    import('../render/board3d/load.js'),
    import('../render/board3d/scene.js'),
    import('../render/board3d/layout.js'),
    import('../assets.js'),
    import('../data.js'),
  ]);
  const assetsApi = opts.assets || assetsMod.assets;
  const dataApi = dataMod.data;
  seedThumbAssets(assetsApi, dataApi);
  const stage = opts.stage && opts.stage.id === id ? opts.stage : dataApi.lookup?.('stages', id);
  if (!stage || stage.id !== id) return null;
  const [THREE, pack, scene] = await Promise.all([
    loadThree(),
    loadBoardPack(assetsApi),
    loadScenePack(assetsApi, id),
  ]);
  if (!THREE || !pack || !scene) return null;
  const quality = size.quality === 'low' || size.quality === 'high' || size.quality === 'medium' ? size.quality : 'medium';
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  let board = null;
  try {
    board = new BoardScene(THREE, pack, {
      canvas,
      antialias: quality !== 'low',
      // [ASSUMED] no shadow map on the thumbnail (see the function comment).
      shadows: false,
      environment: quality !== 'low',
      preserveDrawingBuffer: true,
    });
    board.setArea(AREAS.normal);
    // Same order as the match (render/app.js: setStage, then useOfficialScene → setScenePack).
    board.setStage(stage);
    board.setScenePack(id, scene);
    board.setBattleRect(null);
    const frame = stagePreviewFrame(opts.seat);
    board.setFocus(frame);
    snapFocus(board);
    board.resize(size.width, size.height, 1);
    const cam = stagePreviewCamera(
      { width: size.width, height: size.height },
      { seat: opts.seat, shop: true, config: stage.config || null },
    );
    const t0 = now();
    const drew = board.render(cam, 0);
    const renderMs = now() - t0;
    if (!drew || board.lost) return null;
    let url = '';
    try { url = canvas.toDataURL('image/jpeg', 0.85); } catch { return null; }
    if (!url || !url.startsWith('data:image/')) return null;
    return { url, width: size.width, height: size.height, renderMs };
  } catch {
    return null;
  } finally {
    try { board?.destroy(); } catch { /* the context is already gone */ }
  }
}
