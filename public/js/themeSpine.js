// public/js/themeSpine.js — a theme character's Spine model from the bytes of an imported pack (§37.232).
//
// The battle loader asks PIXI.Assets for a served `.skel` URL and finds the atlas beside it. An imported pack has no
// URL of its own: its files are Blobs in IndexedDB, and the page's connect-src ('self') does not allow fetching a
// `blob:` URL. So the model is built here without a request: the atlas text and the skeleton come from the Blobs, each
// atlas page is an <img> of its blob URL (img-src allows blob:), and pixi-spine's own load parser — the one PIXI.Assets
// uses for a `.skel` / skeleton `.json` — reads the skeleton with that atlas (its `data.spineAtlas`), so the version
// detection (Spine 3.7 / 3.8 / 4.x) is pixi-spine's.

/** The base name of an atlas page or a pack path. @param {string} path */
function baseName(path) {
  const parts = String(path || '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

/**
 * pixi-spine's load parser in PIXI.Assets: the one that tests `.skel` and parses skeleton data. Null when this build
 * has none.
 * @param {any} PIXI
 */
export function spineLoadParser(PIXI) {
  const list = PIXI?.Assets?.loader?.parsers;
  if (!Array.isArray(list)) return null;
  return list.find((p) => {
    try { return typeof p?.parse === 'function' && typeof p?.testParse === 'function' && p.test?.('character.skel') === true; } catch { return false; }
  }) || null;
}

/** @param {any} PIXI @param {string} url */
async function pageTexture(PIXI, url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return PIXI.BaseTexture.from(img);
}

/**
 * Build the skeleton data of `blobs` with the page's PIXI and pixi-spine. Throws when something is missing.
 * @param {{ skel: Blob, skelName: string, atlas: Blob, pages: Record<string, string> }} blobs  `pages`: atlas page
 *   name (its base name) → the blob URL of that picture
 * @param {any} [PIXI]
 */
export async function loadSpineFromBlobs(blobs, PIXI = globalThis.PIXI) {
  if (!PIXI?.spine?.TextureAtlas || !PIXI?.BaseTexture) throw new Error('PIXI / pixi-spine not loaded');
  const parser = spineLoadParser(PIXI);
  if (!parser) throw new Error('no pixi-spine load parser');
  if (!blobs?.skel || !blobs?.atlas) throw new Error('no skeleton or atlas');
  const atlasText = await blobs.atlas.text();
  /** @type {Map<string, any>} */
  const textures = new Map();
  for (const [name, url] of Object.entries(blobs.pages || {})) {
    if (typeof url === 'string' && url) textures.set(baseName(name), await pageTexture(PIXI, url));
  }
  // a page by its name in the atlas; with one picture and one name that differs (a renamed export), that picture
  const only = textures.size === 1 ? [...textures.values()][0] : null;
  const spineAtlas = await new Promise((resolve, reject) => {
    try {
      // the callback gets the atlas, or null when a page had no texture (it may run before the constructor returns)
      new PIXI.spine.TextureAtlas(atlasText, (page, done) => done(textures.get(baseName(page)) || only || null),
        (atlas) => (atlas ? resolve(atlas) : reject(new Error('an atlas page has no picture'))));
    } catch (err) { reject(err); }
  });
  const json = /\.json$/i.test(blobs.skelName || '');
  const raw = json ? JSON.parse(await blobs.skel.text()) : await blobs.skel.arrayBuffer();
  const src = json ? 'theme-character.json' : 'theme-character.skel';
  const res = await parser.parse(raw, { src, data: { spineAtlas } }, PIXI.Assets.loader);
  const data = res && (res.spineData || res);
  if (!data || !Array.isArray(data.animations)) throw new Error('bad spine data');
  return data;
}
