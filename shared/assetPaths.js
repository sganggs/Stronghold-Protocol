// Asset URL paths shared by the server and the browser (host bandwidth, docs/ASSETS.md "The served manifests"):
//
//   * the content-hash segment. The server hands out data/assets.json and data/local-assets.json with every file URL
//     carrying the first 16 hex digits of the file's SHA-256 (of the model's files for a Spine model) as its first
//     segment — `/assets/char/avatar/x.png` → `/assets/~0123456789abcdef/char/avatar/x.png`, audio at
//     `/media/~<hash>/…` (shared/media.js) — so a browser may keep it for a year. The server strips the segment and
//     serves the file at the plain path (server/http/static.js, media.js). A path segment, never `?v=`: several
//     loaders look at the URL's ending (`.skel`, `.mp3`) and pixi-spine finds the atlas and its pages next to the
//     skeleton, which a query string would not survive.
//   * trafficCategory: the category a request path counts under in the traffic counters (server/http/traffic.js,
//     /healthz?traffic=1; public/js/diag.js for the browser's own totals).

/** Hex digits of a content hash in a URL. */
export const ASSET_HASH_HEX = 16;

/** The content-hash segment: `~` + ASSET_HASH_HEX lower-case hex digits. */
export const HASH_SEGMENT_RE = /^~([0-9a-f]{16})$/;

/** URL roots whose first segment may be a content hash. */
export const HASHED_ROOTS = Object.freeze(['/assets/', '/fonts/', '/media/']);

/**
 * Split the content-hash segment off a URL path.
 * '/assets/~0123456789abcdef/x.png' → { hash: '0123456789abcdef', path: '/assets/x.png' }; any other path (no segment,
 * a malformed one, another root) → { hash: null, path } unchanged.
 * @param {string} path a URL path (no query)
 * @returns {{ hash: string | null, path: string }}
 */
export function splitHashedPath(path) {
  const p = String(path ?? '');
  for (const root of HASHED_ROOTS) {
    if (!p.startsWith(root)) continue;
    const slash = p.indexOf('/', root.length);
    if (slash < 0) break;
    const m = HASH_SEGMENT_RE.exec(p.slice(root.length, slash));
    return m ? { hash: m[1], path: root + p.slice(slash + 1) } : { hash: null, path: p };
  }
  return { hash: null, path: p };
}

/**
 * The URL path with the content-hash segment after its root ('/assets/x.png', 'abc…' → '/assets/~abc…/x.png'). A
 * path outside HASHED_ROOTS, one that already has a segment, or no valid hash → the path unchanged.
 * @param {string} path
 * @param {string | null | undefined} hash
 */
export function hashedPath(path, hash) {
  const p = String(path ?? '');
  if (typeof hash !== 'string' || !HASH_SEGMENT_RE.test(`~${hash}`)) return p;
  const root = HASHED_ROOTS.find((r) => p.startsWith(r));
  if (!root || p.length === root.length || splitHashedPath(p).hash) return p;
  return `${root}~${hash}/${p.slice(root.length)}`;
}

/** The URL with its content-hash segment removed (a URL derived from a hashed one names another file). */
export const unhashedUrl = (url) => (typeof url === 'string' ? splitHashedPath(url).path : url);

/** Traffic categories, in report order. */
export const TRAFFIC_CATEGORIES = Object.freeze(['assets', 'audio', 'code', 'data', 'other']);

/**
 * The traffic category of a request path (the content-hash segment does not matter): `audio` (/media/,
 * /assets/audio/), `assets` (/assets/, /fonts/, /icons/, the art of a content pack), `data` (/data/*.json, the UI
 * language packs /i18n/, the pack index, other JSON), `code` (the page, scripts, styles: /, *.js, *.css, *.html,
 * /vendor/, /sim/, /shared/), `other` (/healthz, error pages for anything else).
 * @param {string} path a URL path (no query)
 * @returns {'assets'|'audio'|'code'|'data'|'other'}
 */
export function trafficCategory(path) {
  const p = splitHashedPath(path).path;
  if (p.startsWith('/media/') || p.startsWith('/assets/audio/')) return 'audio';
  if (p.startsWith('/assets/') || p.startsWith('/fonts/') || p.startsWith('/icons/')) return 'assets';
  if (p.startsWith('/packs/')) return /\.json$/i.test(p) ? 'data' : 'assets';
  if (p.startsWith('/data/') || p.startsWith('/i18n/') || /\.json$/i.test(p)) return 'data';
  if (p === '/' || p.endsWith('/') || /\.(?:m?js|css|html?|map|webmanifest)$/i.test(p)
    || p.startsWith('/vendor/') || p.startsWith('/sim/') || p.startsWith('/shared/')) return 'code';
  return 'other';
}
