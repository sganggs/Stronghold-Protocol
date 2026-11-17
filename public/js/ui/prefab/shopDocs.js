// Theme documents for the WebGL shop, on the existing official theme pack.
//
// The product already carries everything the shop needs in the local theme group (data/local-assets.json →
// groups[<group>][<file>], resolved by shared/uiTheme.js officialAssetUrl): prefabs.json for the prefab HUD
// and its bitmap fonts, card.json for the full card document, and shop.json for the full panel document
// (the shop_prefab extractor's output, registered by autochess_themes.py). This module is the only new
// interface the WebGL renderer adds: it reads those group entries and hands the parsed documents to the
// renderer. It never fetches /data or builds a theme path itself.

import { officialAssetUrl, officialThemeById } from '../../../../shared/uiTheme.js';
import { localAsset } from '../../data.js';
import { makePack, packJson } from './view.js';

/** The capability the WebGL shop needs: the theme group lists all three documents. */
export function shopDocsCapability(groups, themeId) {
  const group = officialThemeById(themeId)?.group;
  const entries = group && groups && groups[group];
  if (!entries) return false;
  return !!(entries['prefabs.json'] && entries['card.json'] && entries['shop.json']);
}

/**
 * Runtime files the shop documents name but the theme pack does not carry as its own sprites. The product's
 * local ui/battle extraction has the same art (data/local-assets.json group `ui/battle`).
 */
const BATTLE_ART = Object.freeze({
  'sprites/bg_money.png': 'bg_money',
  'sprites/bg_money.webp': 'bg_money',
  'sprites/fx_mask_1.png': 'fx_mask_1',
  'sprites/fx_mask_2.png': 'fx_mask_2',
  'sprites/fx_mask_3.png': 'fx_mask_3',
});

/**
 * @param {Record<string, any>|null|undefined} groups data.get('local').groups
 * @param {string} themeId settings.uiTheme
 * @returns {Promise<null|{ themeId: string, group: string, shop: any, card: any, prefabs: any,
 *   pack: any, url: (file: string|null|undefined) => string|null }>}
 */
export async function themeShopDocs(groups, themeId) {
  const theme = officialThemeById(themeId);
  const group = theme && theme.group;
  const entries = group && groups && groups[group];
  if (!entries || !entries['shop.json'] || !entries['card.json'] || !entries['prefabs.json']) return null;
  const [shop, card, prefabs] = await Promise.all([
    packJson(officialAssetUrl(group, entries['shop.json'])),
    packJson(officialAssetUrl(group, entries['card.json'])),
    packJson(officialAssetUrl(group, entries['prefabs.json'])),
  ]);
  if (!shop || !card || !prefabs) return null;
  const pack = makePack(groups, group, prefabs);
  const url = (file) => {
    const value = String(file || '');
    if (!value) return null;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(value)) return value;
    const entry = entries[value];
    if (entry) return officialAssetUrl(group, entry);
    const art = BATTLE_ART[value];
    return art ? localAsset('ui/battle', art) || null : null;
  };
  return { themeId, group, shop, card, prefabs, pack, url };
}

/**
 * The @font-face declarations of the group's font entries (`data/local-assets.json` `fonts` group), and the
 * document font families they should serve. The theme's text fonts are OTF/TTF assets like any other local
 * art: their URLs come from the manifest, not from a hard-coded /assets/local/fonts path.
 * @param {Record<string, any>|null|undefined} groups
 */
export function themeFonts(groups) {
  const entries = (groups && groups.fonts) || {};
  const faces = [];
  for (const [name, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== 'object' || !entry.path || entry.kind !== 'Font') continue;
    faces.push({ family: String(entry.family || name), url: String(entry.path), weight: Number(entry.weight) || 400 });
  }
  return faces;
}

/**
 * A value that can sit inside a quoted CSS string. A manifest family name or path is data like any other: a
 * quote, backslash, semicolon, brace, newline or control character would end the declaration and let a pack style
 * the page, so such a face is refused. A URL also may not carry whitespace or parentheses (an unquoted url()
 * stops at `)`, and a quoted one cannot span lines).
 */
const CSS_STRING_UNSAFE = /['"\\;{}\u0000-\u001f\u007f]/;
const CSS_URL_UNSAFE = /['"\\;{}\s()\u0000-\u001f\u007f]/;
/** A font URL this page may load: the manifest's same-origin path, or a `blob:` of an imported pack. */
const FONT_URL = /^(?:blob:|\/(?!\/))/i;

/**
 * One @font-face rule for a manifest face, or null when the face cannot be written into a stylesheet safely.
 * @param {{ family?: any, url?: any, weight?: any }} face
 * @returns {string|null}
 */
function fontFaceRule(face) {
  const family = typeof face?.family === 'string' ? face.family : '';
  const url = typeof face?.url === 'string' ? face.url : '';
  if (!family || CSS_STRING_UNSAFE.test(family)) return null;
  if (!url || CSS_URL_UNSAFE.test(url) || !FONT_URL.test(url)) return null;
  const raw = Number(face?.weight);
  const weight = Number.isFinite(raw) && raw >= 1 && raw <= 1000 ? raw : 400;
  const format = /\.ttf(?:[?#]|$)/i.test(url) ? 'truetype' : 'opentype';
  return `@font-face { font-family: '${family}'; src: url('${url}') format('${format}'); font-weight: ${weight}; font-display: swap; }`;
}

/**
 * Install the manifest font faces once (the family names the shop documents ask for). A face this module cannot
 * write safely is left out: its text falls back like a missing face.
 * @param {{ family: string, url: string, weight?: number }[]} faces
 * @param {Document|null} [doc]
 * @returns {boolean} whether the sheet carries at least one face
 */
export function installThemeFontFaces(faces, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !Array.isArray(faces) || !faces.length) return false;
  const rules = [];
  for (const face of faces) {
    const rule = fontFaceRule(face);
    if (rule) rules.push(rule);
  }
  if (!rules.length) return false;
  const id = 'shop-theme-fonts';
  const css = rules.join('\n');
  let style = doc.getElementById(id);
  if (!style) {
    style = doc.createElement('style');
    style.id = id;
    (doc.head || doc.documentElement).append(style);
  }
  if (style.textContent !== css) style.textContent = css;
  return true;
}

/**
 * Remove the theme @font-face sheet (ui/shop/host.js calls this from its dispose, so a theme switch or the DOM bar
 * coming back does not keep a previous theme's faces). Idempotent: a second call, or a page that never installed
 * fonts, finds nothing and returns false.
 * @param {Document|null} [doc]
 * @returns {boolean} whether a sheet was removed
 */
export function uninstallThemeFontFaces(doc = typeof document !== 'undefined' ? document : null) {
  const style = doc && typeof doc.getElementById === 'function' ? doc.getElementById('shop-theme-fonts') : null;
  if (!style) return false;
  if (typeof style.remove === 'function') style.remove();
  else if (style.parentNode) style.parentNode.removeChild(style);
  return true;
}

/** Every `text.font` family the shop/card documents name, including sub-prefabs and prefab maps. */
export function documentFontFamilies(...docs) {
  const families = new Set();
  const seen = new WeakSet();
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (value.text && typeof value.text.font === 'string' && value.text.font) families.add(value.text.font);
    for (const child of value.children || []) walk(child);
    // The documents keep their templates in `sub` (card sub-prefabs, shop sub-panels) and `prefabs`
    // (panel/money/card prefab docs); walk every object value so those text nodes are covered.
    for (const child of Object.values(value)) walk(child);
  };
  for (const doc of docs) walk(doc);
  return [...families];
}

/**
 * Wait for the document font families and for the installed faces of those families only — loading every manifest
 * face would fetch fonts the documents never draw (Novecento on a CJK-only panel, above all). A missing face falls
 * back like the old text did; never throws. The weight in the load query matches the @font-face weight, otherwise
 * a weighted face (Bold 700 / Heavy 900 / Medium 500) can stay unloaded while the canvas asks for it.
 * @param {string[]} families
 * @param {number} [timeoutMs]
 * @param {{ family: string, weight: number }[]} [faces]
 */
export async function loadDocumentFonts(families, timeoutMs = 4000, faces = []) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts) return [];
  /** @type {Set<string>} */
  const wanted = new Set();
  for (const family of families || []) {
    if (typeof family === 'string' && family && !CSS_STRING_UNSAFE.test(family)) wanted.add(family);
  }
  /** @type {string[]} */
  const queries = [];
  for (const face of faces || []) {
    if (!face || typeof face.family !== 'string' || !wanted.has(face.family)) continue;
    const raw = Number(face.weight);
    const weight = Number.isFinite(raw) && raw >= 1 && raw <= 1000 ? raw : 400;
    queries.push(`${weight} 1em "${face.family}"`);
  }
  for (const family of wanted) queries.push(`1em "${family}"`);
  if (!queries.length) return [];
  const timeout = new Promise((resolve) => { setTimeout(resolve, timeoutMs); });
  const loads = [...new Set(queries)].map((query) => fonts.load(query).catch(() => null));
  await Promise.race([Promise.all(loads), timeout]);
  return families || [];
}
