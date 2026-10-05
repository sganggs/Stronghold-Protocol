// render/boardArt.js — optional real board art from the local game client (DESIGN §13).
//
//   const art = await loadBoardArt(assets)   // null when the art (or its crop table) is not installed
//   → { key, tiles, images: { D, common?, BG? } }   (tiles = tiles.json of tools/crop-board-atlas.mjs)
//
// Discovery never guesses URLs: the local-art manifest (data/local-assets.json, assets.local()) must list the atlas
// `map/autochess → TX_autochessi_D`; its crop table `tiles.json` sits next to it (written by
// tools/crop-board-atlas.mjs). Every image referenced by the table is loaded through the shared image cache; a
// missing image drops only the materials that use it. Everything is cached per page (one load for every view).
// A table image is fetched at the URL the manifest lists for the same texture (sourceUrl), so the 3D board
// (board3d/load.js, which reads the manifest only) and this art share one download — also when the manifest lists
// the WebP copy tools/local-extract writes and the table still names the PNG.

let cached = null;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The manifest group of the board textures (and of their crop table). */
export const BOARD_GROUP = 'map/autochess';

/**
 * URL of a crop-table image: the local-art manifest's entry for the same texture (group `BOARD_GROUP`, name = the
 * file name without its extension), else the table's own path.
 * @param {any} assets store of public/js/assets.js
 * @param {string} path tiles.json `source[k].path`
 */
export function sourceUrl(assets, path) {
  const name = path.replace(/^.*\//, '').replace(/\.[^.]*$/, '');
  const listed = name && typeof assets?.localUrl === 'function' ? assets.localUrl(BOARD_GROUP, name) : null;
  return typeof listed === 'string' && listed ? listed : path;
}

/** @param {any} assets store of public/js/assets.js (needs local(), localUrl(), image()) */
export function loadBoardArt(assets) {
  if (cached) return cached;
  cached = (async () => {
    if (!assets || typeof assets.local !== 'function' || typeof assets.image !== 'function') return null;
    const manifest = await assets.local().catch(() => null);
    if (!manifest) return null;
    const atlasUrl = assets.localUrl ? assets.localUrl(BOARD_GROUP, 'TX_autochessi_D') : null;
    if (!atlasUrl) return null;
    const dir = atlasUrl.replace(/\/[^/]*$/, '');
    let tiles = null;
    try {
      const res = await fetch(`${dir}/tiles.json`, { cache: 'no-cache' });
      tiles = res.ok ? await res.json() : null;
    } catch { tiles = null; }
    if (!isObj(tiles) || !isObj(tiles.materials) || !isObj(tiles.source)) return null;
    const images = {};
    await Promise.all(Object.entries(tiles.source).map(async ([k, s]) => {
      const url = isObj(s) && typeof s.path === 'string' && s.path ? sourceUrl(assets, s.path) : null;
      if (!url) return;
      const img = await assets.image(url).catch(() => null);
      if (img && img.width > 0) images[k] = img;
    }));
    if (!images.D) return null;
    return { key: `${atlasUrl}#${tiles.version || 0}`, tiles, images };
  })().catch(() => null);
  return cached;
}

/** Forget the cached art (tests / hot reload). */
export function resetBoardArt() { cached = null; }
