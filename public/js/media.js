// audio URL rewriting for download managers (IDM / 迅雷 / FDM …) — see shared/media.js for the why.
//
// The game plays audio with fetch() + Web Audio (`audio.js`): it never uses <audio src>, <a download> or a
// navigation. Download managers do not care — their browser integration hooks XHR/fetch whose URL ends in a
// media extension and (usually above ~1 MB) pops up "下载文件信息" for every BGM track. That dialog has nothing
// to do with the game, but players see it and blame the game.
//
// So audio is fetched through a same-origin, extension-less path instead:
//
//     /assets/audio/bgm/act1.mp3   →   /media/bgm/act1
//
// `server/http/media.js` resolves /media/… back to the real file under public/assets/audio and still answers with
// `Content-Type: audio/mpeg` + range support; Web Audio sniffs the container, so the URL is all the same to it.
// A served manifest's content-hashed URL keeps its segment (shared/assetPaths.js; host bandwidth, layer 1):
//
//     /assets/~0123456789abcdef/audio/bgm/act1.mp3   →   /media/~0123456789abcdef/bgm/act1
// A host that does not implement /media/ keeps working: `audio.js` falls back to the original URL whenever the
// /media/ response is unusable (a 404, or a 200 that is not audio at all — some static hosts answer a missing
// path with the SPA's index.html).
import { MEDIA_PREFIX, AUDIO_EXTS } from '../../shared/media.js';
import { splitHashedPath } from '../../shared/assetPaths.js';

const AUDIO_PATH = /^\/assets\/audio\/(.+)$/i;

/**
 * Rewrite an audio URL to its extension-less `/media/…` form.
 *
 * Returns the input unchanged when the URL is not one of our audio assets, points at another origin (a CDN
 * serves media itself, so the download-manager problem is not ours to solve there), or would produce a path the
 * server refuses (empty / dot segments).
 * @param {string} url
 * @param {string} [origin] origin of the page; defaults to `location.origin`
 * @returns {string} a URL safe to pass to fetch()
 */
export function mediaUrl(url, origin = globalThis.location?.origin) {
  if (typeof url !== 'string' || !url) return url;
  let u;
  // No origin known (Node / tests): parse relative URLs against a placeholder, absolute ones are rejected below.
  try { u = new URL(url, origin || 'http://localhost'); } catch { return url; }
  // Cross-origin (or absolute while the page origin is unknown) stays untouched: that host serves its own media.
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
  if (origin ? u.origin !== origin : absolute) return url;
  const { hash, path: plain } = splitHashedPath(u.pathname);
  const m = AUDIO_PATH.exec(plain);
  if (!m) return url;
  let rest = m[1];
  const ext = AUDIO_EXTS.find((e) => rest.toLowerCase().endsWith(e));
  if (!ext) return url;             // not a file we serve as audio (e.g. "x.mp3.bak") — leave it alone
  rest = rest.slice(0, -ext.length);
  const segments = rest.split('/');
  if (!rest || segments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.'))) return url;
  return `${MEDIA_PREFIX}${hash ? `~${hash}/` : ''}${rest}${u.search}`;
}
