// Upstream asset sources (GitHub dumps of the official client), URL helpers and
// local-path helpers shared by the asset pipeline (tools/fetch-assets.mjs).
//
// Every URL we download from is a raw.githubusercontent.com URL; mirrorUrl()
// maps it to the equivalent jsDelivr URL used as a fallback when GitHub raw
// fails. jsDelivr 404s on the ArknightsAssets2 `voice` branch, so no mirror is
// offered for audio. See docs/ASSETS.md for the full source list and credits.

/** Raw base URLs (always end with '/'). */
export const RAW = Object.freeze({
  yuanyan: 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/',
  fexli: 'https://raw.githubusercontent.com/fexli/ArknightsResource/main/',
  arkModels: 'https://raw.githubusercontent.com/isHarryh/Ark-Models/main/',
  aa2: 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/cn/assets/dyn/',
  aa2voice: 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/',
  fonts: 'https://raw.githubusercontent.com/TimWangZi/The-font-of-Arknights/master/font/',
  gamedata: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/',
});

const RAW_RE = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;

/**
 * Map a raw.githubusercontent.com URL to its jsDelivr mirror.
 * @param {string} url
 * @returns {string|null} mirror URL, or null when no usable mirror exists
 */
export function mirrorUrl(url) {
  const m = RAW_RE.exec(String(url));
  if (!m) return null;
  const [, owner, repo, branch, path] = m;
  // jsDelivr does not serve the (huge) voice branch of ArknightsAssets2.
  if (owner === 'ArknightsAssets' && branch === 'voice') return null;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
}

/**
 * Percent-encode each segment of a repo-relative path ('[uc]x/a b.png' → '%5Buc%5Dx/a%20b.png').
 * @param {string} relPath
 * @returns {string}
 */
export function encodePath(relPath) {
  return String(relPath).split('/').map((s) => encodeURIComponent(s)).join('/');
}

/**
 * Join a base URL and a *decoded* repo-relative path, encoding the path.
 * @param {string} base  base URL ending with '/'
 * @param {string} relPath decoded path
 * @returns {string}
 */
export function joinUrl(base, relPath) {
  return base + encodePath(relPath);
}

export { safeName } from '../../shared/assetPath.js';

/**
 * Site-root URL path for a file under public/assets.
 * @param {string} rel path relative to public/assets (forward slashes)
 * @returns {string} e.g. '/assets/char/avatar/char_002_amiya.png'
 */
export function assetUrl(rel) {
  return '/assets/' + rel;
}

/**
 * Directory part of a URL (everything up to and including the last '/').
 * @param {string} url
 * @returns {string}
 */
export function urlDir(url) {
  const i = String(url).lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}

/**
 * Last path component of a URL, percent-decoded.
 * @param {string} url
 * @returns {string}
 */
export function urlBase(url) {
  const s = String(url).split('?')[0];
  const last = s.slice(s.lastIndexOf('/') + 1);
  try { return decodeURIComponent(last); } catch { return last; }
}
