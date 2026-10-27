// server/http/static.js — the static file server (routes.js hands it every GET / HEAD that is not an API route):
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//     /        → public/      (index.html for directories)
//     /data/   → data/        (generated game data)
//     /shared/ → shared/      (ESM shared with the browser)
//     /sim/    → server/sim/  (the battle simulation, read-only, `.js` only — client-side
//                              combat, DESIGN §14; the Node-only loader nodeData.js is not served)
//     /studio/… → never: the plugin studio's page (public/studio/) is served by server/studio/index.js behind its gate (this
//                machine and the local network only) — a path here that is the studio's, in any spelling, is a 404
//     /data.js → a generated browser stand-in of server/data.js (the sim's content modules
//                import `../../../data.js`; in the browser it serves the data injected with
//                /sim/simdata.js setSimData). No other server file is ever served.
//     /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 — the same audio files, addressed
//                **without** an extension so download managers (IDM / 迅雷 …) stop popping a
//                "下载文件信息" dialog for every BGM track (media.js, shared/media.js, public/js/media.js)
//     /packs/index.json → the language packs of this server (server/plugins/registry.js: public/i18n/, the pack
//                folders of packs/ and the lang plugins of plugins/, re-read when they change; never cached)
//     /packs/<id>/<file> → a file of a pack or lang plugin folder — only one its manifest names (registry servable)
//     /plugins/index.json → the plugin catalogue: every plugin and pack found, by class and status, and the vanilla
//                content hash (DESIGN §32; never cached). Of plugins/ only the files a lang manifest names (through
//                /packs/<id>/<file>), the files a loaded cosmetic overlay names and the frame files of a loaded ui
//                plugin (/p/…; a ui file also sends the frame Content-Security-Policy) are served
//     /cs/<cs16>/index.json → the manifest of the vanilla content set (server/plugins/identity.js contentIndexOf),
//                cached for good — for this server's vanilla `cs` (its first 16 hex digits) and, from P1c (DESIGN §32.6),
//                a content set with gameplay plugins a room uses or used lately (server/plugins/contentSets.js: the same
//                shape with `vanilla: false`, its plugins, settings and modes)
//     /cs/<cs16>/index.json, /cs/<cs16>/bounds/official.json of an official version this server enables (DESIGN §35.23,
//                server/versions.js file): its manifest (`version`, data URLs under /data/versions/<slug>/) and its
//                official-bounds snapshot, cached for good
//     /data/versions/<slug>/<file>.json → another official version's data — only an enabled version's directory
//                (versions.servedDirs(); the real path decides, in any spelling); `?v=` immutable like /data/. Every other
//                path under data/versions/ is a 404, as before M1
//     /cs/<cs16>/data/<file>.json, /cs/<cs16>/i18n/<lang>.json → a data or translation file that content set changed,
//                its served bytes from memory (cached for good; every other file of the set is named by its plain
//                /data/…?v=<8 hex> URL in the manifest)
//     /vs/<vs16>/overlay.json → a visual set of cosmetic plugins (server/plugins/visualSet.js): its composition and
//                its plugins' writes, which a page lays over the manifest it loaded itself (a room's set, a player's
//                personal plugin) — no-cache, the body's hash as ETag; 404 for a set this server does not know
//     /p/<id>/<hash8>/<path> → a file of a loaded cosmetic plugin — only one its overlay names — or a frame file of a
//                loaded ui plugin (html / js / css / png under entry.client). registry pluginFile is the whitelist
//                (no dot file, no `..`; only the very file the scan hashed — a symbolic link put in its place, or in place
//                of a folder on its way, is never followed, wherever it leads). A ui file's response carries
//                UI_FRAME_CSP (shared/plugins/ui.js); a cosmetic file does not. A hash naming its current bytes (its own
//                first 8 hex digits, or its Spine model's) answers `immutable` for a year while the file keeps the size,
//                mtime, inode and ctime it was hashed with; any other hash, or a file changed since the scan, the current
//                file with `no-cache` — as for /assets/~<hash>/ below — and a changed file has the registry read the
//                folders again. An audio file is also served without its extension — /p/<id>/<hash8>/<path without
//                .mp3 / .ogg> — for the same download managers as /media/ below (public/js/media.js mediaUrl; when both
//                a .mp3 and a .ogg are listed, the one whose hash the URL names)
//     /assets/~<hash>/…, /fonts/~<hash>/…, /media/~<hash>/… → the same files: the content-hash segment
//                (shared/assetPaths.js) is stripped. A hash that names the file's current bytes (assetIndex.js
//                urlHashOk: its own hash, or its Spine model's) answers `immutable` for a year; any other hash —
//                an old page, a URL derived from another file's — the current file with `no-cache`
//     /data/assets.json, /data/local-assets.json, /data/local-fx.json → the served manifests (assetViews.js: every
//                art URL with its content-hash segment; no-cache, the ETag of the view) once the asset index is ready,
//                the files as they are before that or without an index
//
// Files under public/assets/ and public/fonts/ get their content hash as ETag when the index has it (a file whose
// size or mtime changed since asks for a rescan), others size + mtime. Traversal & dotfile protection, a directory
// without its trailing slash → 301, 404 page; an absent data/local-assets.json or data/local-fx.json is answered with
// an empty manifest.
// Files go out through files.js serveFile.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_PREFIX } from '../../shared/media.js';
import { splitHashedPath } from '../../shared/assetPaths.js';
import { ROOT, noopLog } from './config.js';
import { sendError, sendJson } from './common.js';
import { MIME, CompressCache, IMMUTABLE_CACHE, isNotModified, serveFile, serveBuffer } from './files.js';
import { ASSET_INDEX_ROOTS, hashedFileOpts } from './assetIndex.js';
import { serveMedia } from './media.js';
import { createPluginRegistry, sameIdentity, statIdentity } from '../plugins/registry.js';
import { computeVanillaContent } from '../plugins/identity.js';
import { createVisualSets } from '../plugins/visualSet.js';
import { isStudioPath } from '../studio/paths.js';
import { PACKS_URL, PACK_INDEX_FILE } from '../../shared/packs.js';
import { PLUGINS_URL, PLUGIN_INDEX_VERSION, buildPluginIndex, extOf, isPackPath, isPluginId } from '../../shared/plugins/manifest.js';
import { csUrlPart } from '../../shared/plugins/identity.js';
import { FILE_URL_DIGITS, PLUGIN_AUDIO_EXTS, PLUGIN_FILES_URL, VISUAL_DOC_FILE, VISUAL_SETS_URL, VS_URL_DIGITS } from '../../shared/plugins/visual.js';
import { SIM_WORKER_CSP } from './csp.js';
import { UI_FRAME_CSP } from '../../shared/plugins/ui.js';

/** Browser stand-in of server/data.js, served at /data.js (see the header). Served byte for byte: its first line names the entry, server/index.js. */
export const DATA_SHIM_JS = `// Generated by server/index.js — browser stand-in for server/data.js (DESIGN §14 client-side combat).
// The simulation's content modules (/sim/content/support/index.js) import getData() from here; it returns the game data
// the page injected with /sim/simdata.js setSimData(data).
import { getSimData } from './sim/simdata.js';
export function getData() { return getSimData() || {}; }
export function resetData() {}
`;
/** Files under server/sim that are never served (Node-only). */
const SIM_PRIVATE = new Set(['nodedata.js']); // lower-case (compared case-insensitively)

// ---------------------------------------------------------------------------------------------------
// Static file handler
// ---------------------------------------------------------------------------------------------------

/** Optional per-machine art manifests (tools/local-extract: the local art, the official effects' files — DESIGN §33)
 * and the empty stand-in served when one is absent. */
const LOCAL_ART_MANIFESTS = new Set(['local-assets.json', 'local-fx.json']);
const EMPTY_LOCAL_ART = Buffer.from(JSON.stringify({ version: 1, source: 'none', count: 0, groups: {} }));

/** The content-set manifest's cache policy: its URL names its content (the `cs`), so it never changes. */
const IMMUTABLE_JSON = 'public, max-age=31536000, immutable';
/** /vs/<vs16>/overlay.json */
const VISUAL_DOC = new RegExp(`^${VISUAL_SETS_URL}([0-9a-f]{${VS_URL_DIGITS}})/${VISUAL_DOC_FILE.replace('.', '\\.')}$`);
/** A plugin file URL's hash segment. */
const FILE_HASH = new RegExp(`^[0-9a-f]{${FILE_URL_DIGITS}}$`);
/** /cs/<cs16>/<path> of a content set with gameplay plugins (DESIGN §32.6). */
const CS_FILE = /^\/cs\/([0-9a-f]{16})\/([A-Za-z0-9._\/-]{1,200})$/;

/**
 * Create the static request handler.
 * @param {{ publicDir: string, dataDir: string, sharedDir: string, simDir?: string, packsDir?: string, pluginsDir?: string,
 *   packs?: ReturnType<typeof createPluginRegistry>, content?: import('../plugins/identity.js').VanillaContent | null,
 *   log?: object,
 *   assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *   views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null,
 *   visual?: ReturnType<typeof createVisualSets> | null,
 *   contents?: ReturnType<typeof import('../plugins/contentSets.js').createContentSets> | null,
 *   versions?: { file: (cs16: string, rel: string) => ({ body: Buffer, sha256: string, type: string } | null), servedDirs: () => string[] } | null }} dirs
 *   packs: the server's plugin registry (default: one over publicDir, dataDir, packsDir and pluginsDir — ROOT/packs, and
 *   the plugins/ folder beside packsDir); content: the vanilla content (default: computed from simDir, sharedDir and
 *   dataDir on first use); assetIndex / views: the content hashes and the served manifests (none: plain URLs,
 *   size-mtime ETags); visual: the visual sets (default: one over the registry — a registry of 0.2.0's shape has none:
 *   /vs/ and /p/ answer 404); contents: the content sets with gameplay plugins (DESIGN §32.6; none: only the vanilla
 *   set's /cs/ manifest); versions: the official versions this server enables (server/versions.js; none: /data/versions/ is
 *   never served)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, rawPath: string, query: string) => Promise<void>}
 */
export function createStaticHandler({ publicDir, dataDir, sharedDir, simDir = path.join(ROOT, 'server', 'sim'), packsDir = path.join(ROOT, 'packs'),
  pluginsDir = path.join(path.dirname(path.resolve(packsDir)), 'plugins'), packs = null, content = null, log = noopLog,
  assetIndex = null, views = null, visual = null, contents = null, versions = null }) {
  const registry = packs || createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log: /** @type {any} */ (log) });
  const sets = visual || (typeof registry.pluginFile === 'function' ? createVisualSets({ registry, log }) : null);
  let vanilla = content;
  const vanillaContent = () => (vanilla ||= computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log: /** @type {any} */ (log) }));
  const mounts = [
    { prefix: '/data/', name: 'data', dir: path.resolve(dataDir) },
    { prefix: '/shared/', name: 'shared', dir: path.resolve(sharedDir) },
    // the simulation: ES modules only (no directory listings, no other file types, no Node-only loader)
    { prefix: '/sim/', name: 'sim', dir: path.resolve(simDir), only: new Set(['.js']), deny: SIM_PRIVATE },
    { prefix: '/', name: 'public', dir: path.resolve(publicDir) },
  ];
  // the real path of public/studio/ (the plugin studio's page — never a static file, in whatever spelling the disk folds:
  // /ſtudio/ on a case-insensitive macOS disk, /studio./ on Windows)
  let studioReal;
  const studioRealPath = async () => {
    if (studioReal === undefined) studioReal = await fsp.realpath(path.join(path.resolve(publicDir), 'studio')).catch(() => null);
    return studioReal;
  };
  // another official version's data (data/versions/<slug>/, DESIGN §35.22, §35.23): the release carries every version,
  // but only the directories of the versions this server enables are served (versions.servedDirs()); the on-disk path
  // decides (case-insensitive disks, Windows short names), as for the studio below
  let versionsReal = null;
  /** @type {string[] | null} the real paths of the served version directories */
  let servedReal = null;
  /** Is `abs` another version's data that may not be served (under data/versions/, outside every served directory)? */
  const isVersionData = async (abs) => {
    versionsReal ||= await fsp.realpath(path.join(path.resolve(dataDir), 'versions')).catch(() => null);
    if (!versionsReal) return false;
    const real = await fsp.realpath(abs).catch(() => null);
    if (!real || !real.startsWith(versionsReal + path.sep)) return false;
    servedReal ||= (await Promise.all((versions?.servedDirs() || []).map((d) => fsp.realpath(d).catch(() => null)))).filter((d) => typeof d === 'string');
    return !servedReal.some((d) => real.startsWith(d + path.sep));
  };
  const shimBody = Buffer.from(DATA_SHIM_JS);
  const shimTag = `"shim-${shimBody.length.toString(16)}"`;
  const gzipCache = new CompressCache(); // brotli and gzip bodies (files.js)

  return async function serveStatic(req, res, rawPath, query) {
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) {
      sendError(req, res, 400, '请求地址无效 · Bad request');
      return;
    }
    // #603: serve only this root document, including after an update-zip overlay; never mount the repo root.
    if (decoded === '/CHANGELOG.md') {
      const abs = path.resolve(publicDir, '..', 'CHANGELOG.md');
      const st = await fsp.stat(abs).catch(() => null);
      if (!st?.isFile()) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      await serveFile(req, res, abs, st, 'release', ['CHANGELOG.md'], query, gzipCache, log, {
        cacheControl: 'no-cache', headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
      return;
    }
    // the plugin studio's page is never a static file (server/studio/index.js isStudioPath: any spelling of /studio/)
    if (isStudioPath(decoded)) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
    // /assets/~<hash>/x → /assets/x (the hash decides the cache policy below)
    const hashed = splitHashedPath(decoded);
    const urlHash = hashed.hash;
    decoded = hashed.path;
    if (decoded === '/data.js') {
      const headers = { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache', ETag: shimTag, 'Content-Length': shimBody.length };
      if (isNotModified(req, shimTag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : shimBody);
      return;
    }
    // The plugin catalogue (server/plugins/registry.js; never cached) and the vanilla content set's manifest
    if (decoded === `${PLUGINS_URL}index.json`) {
      const vanilla = vanillaContent().cs;
      // a registry of 0.2.0's shape (a caller's own `packs`) has no catalogue: an empty one
      sendJson(req, res, 200, typeof registry.pluginIndex === 'function' ? registry.pluginIndex({ vanilla }) : buildPluginIndex([], { vanilla }));
      return;
    }
    if (decoded.startsWith('/cs/')) {
      const c = vanillaContent();
      if (decoded !== `/cs/${csUrlPart(c.cs)}/index.json`) {
        // an official version's manifest and bounds (DESIGN §35.23, server/versions.js), else a content set with gameplay
        // plugins (DESIGN §32.6, server/plugins/contentSets.js): its manifest and its patched data files — a URL naming
        // its content, so cached for good; 404 for a set this server does not keep
        const m = CS_FILE.exec(decoded);
        const safe = !!m && !m[2].split('/').some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'));
        const f = safe && m ? (versions?.file(m[1], m[2]) || (contents ? contents.file(m[1], m[2]) : null)) : null;
        if (!f) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
        await serveBuffer(req, res, { body: f.body, hash: `cs-${m[1]}-${(f.sha256 || 'index').slice(0, 8)}`, type: f.type || MIME['.json'], cacheControl: IMMUTABLE_JSON, key: `cs:${decoded}`, cache: gzipCache });
        return;
      }
      const body = Buffer.from(JSON.stringify(c.index));
      const tag = `"cs-${csUrlPart(c.cs)}-v${PLUGIN_INDEX_VERSION}"`;
      const headers = { 'Content-Type': MIME['.json'], 'Cache-Control': IMMUTABLE_JSON, ETag: tag, 'Content-Length': body.length };
      if (isNotModified(req, tag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // Visual sets (server/plugins/visualSet.js): a set's composition and writes
    if (decoded.startsWith(VISUAL_SETS_URL)) {
      const m = VISUAL_DOC.exec(decoded);
      const doc = m && sets ? await sets.doc(m[1]) : null;
      if (!doc) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
      await serveBuffer(req, res, { body: doc.body, hash: doc.hash, type: MIME['.json'], cacheControl: 'no-cache', key: `vs:${decoded}`, cache: gzipCache });
      return;
    }
    // A cosmetic plugin's files, or a ui plugin's frame files, at the hash of their bytes (see the header)
    if (decoded.startsWith(PLUGIN_FILES_URL)) {
      const [id, hash, ...segments] = decoded.slice(PLUGIN_FILES_URL.length).split('/');
      const rel = segments.join('/');
      const ok = isPluginId(id) && FILE_HASH.test(hash || '') && segments.length > 0 && isPackPath(rel)
        && !segments.some((x) => x === '' || x === '.' || x === '..' || x.startsWith('.'));
      let f = ok && sets ? sets.file(id, rel) : null;
      // extension-less audio (download managers: shared/media.js): the listed audio file of that name — the one whose
      // hash the URL names when there are two
      if (!f && ok && sets && !extOf(rel)) {
        const found = PLUGIN_AUDIO_EXTS.map((e) => sets.file(id, rel + e)).filter(Boolean);
        f = found.find((x) => x.urlHashes.has(hash)) || found[0] || null;
      }
      // the very file the scan hashed: a symbolic link put in its place is never followed (wherever it leads — another
      // file of the folder, a dot file, outside), nor is one put in place of a folder on its way (its real path changed)
      const st = f ? await fsp.lstat(f.abs).catch(() => null) : null;
      const real = st && st.isFile() ? await fsp.realpath(f.abs).catch(() => null) : null;
      if (!st || !st.isFile() || !real || real !== f.real) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
      // still the bytes that were hashed: the same size, mtime, inode and ctime (registry.js statIdentity) — else the
      // current file goes out with no-cache and the folders are read again
      const same = sameIdentity(statIdentity(st), f);
      if (!same) sets.noteChanged();
      await serveFile(req, res, f.abs, st, 'plugins', segments, query, gzipCache, log, {
        // the ETag: the content hash of the bytes the scan hashed — of a changed file, its stat identity (size and mtime
        // alone would revalidate a rewrite that kept them: a 304 for other bytes)
        contentHash: same ? f.sha256.slice(0, 16) : `${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${st.ino.toString(16)}-${Math.floor(st.ctimeMs * 1000).toString(16)}`,
        cacheControl: same && f.urlHashes.has(hash) ? IMMUTABLE_CACHE : 'no-cache',
        // [ASSUMED] the frame CSP is only on a ui plugin's /p/ files (f.frame), including its sandbox
        // allow-scripts (no allow-same-origin). serveFile puts it on 200, 206 and 304. 'self' may not match
        // the opaque origin.
        headers: f.frame ? { 'Content-Security-Policy': UI_FRAME_CSP } : null,
      });
      return;
    }
    // Language packs (server/plugins/registry.js): the live index, and only the files a lang manifest names
    if (decoded.startsWith(PACKS_URL)) {
      const parts = decoded.slice(PACKS_URL.length).split('/');
      if (parts.length === 1 && parts[0] === PACK_INDEX_FILE) { sendJson(req, res, 200, registry.index()); return; }
      const abs = parts.length >= 2 && !parts.some((s) => s === '' || s === '.' || s === '..') ? registry.servable(parts[0], parts.slice(1).join('/')) : null;
      const st = abs ? await fsp.stat(abs).catch(() => null) : null;
      if (!st || !st.isFile()) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
      await serveFile(req, res, abs, st, 'packs', parts, query, gzipCache, log);
      return;
    }
    // Extension-less audio (download-manager avoidance): /media/bgm/act1 → /assets/audio/bgm/act1.mp3
    if (decoded.startsWith(MEDIA_PREFIX)) {
      await serveMedia(req, res, decoded.slice(MEDIA_PREFIX.length), query, publicDir, gzipCache, log, { urlHash, assetIndex });
      return;
    }
    // The served manifests: every art URL with its content hash (assetViews.js), once the index is ready
    if (views && (decoded === '/data/assets.json' || decoded === '/data/local-assets.json' || decoded === '/data/local-fx.json')) {
      const view = await views.get(decoded.slice('/data/'.length));
      if (view) {
        await serveBuffer(req, res, { body: view.body, hash: view.hash, type: MIME['.json'], cacheControl: 'no-cache', key: `view:${decoded}`, cache: gzipCache });
        return;
      }
    }
    // Bare mount paths (e.g. "/data") → treat as the mount directory.
    const mount = mounts.find((m) => decoded.startsWith(m.prefix) || decoded === m.prefix.slice(0, -1)) || mounts[mounts.length - 1];
    const rest = decoded.length > mount.prefix.length ? decoded.slice(mount.prefix.length) : '';
    const segments = rest.split('/').filter((s) => s.length > 0);
    if (segments.some((s) => s === '..' || s === '.')) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }
    if (segments.some((s) => s.startsWith('.'))) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
    if (mount.only && (!segments.length || !mount.only.has(path.extname(segments[segments.length - 1]).toLowerCase())
      // (case-insensitive: the host may be Windows / macOS, where NODEDATA.JS opens nodeData.js)
      || (mount.deny && mount.deny.has(segments[segments.length - 1].toLowerCase())))) {
      sendError(req, res, 404, '页面不存在 · Not found');
      return;
    }
    let absPath = path.join(mount.dir, ...segments);
    if (absPath !== mount.dir && !absPath.startsWith(mount.dir + path.sep)) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }

    let stat;
    let viaDirectory = false;
    try {
      stat = await fsp.stat(absPath);
      if (stat.isDirectory()) {
        if (!decoded.endsWith('/')) {
          // Built from normalized segments (never from the raw path) so "//host" can't become an open redirect.
          const loc = (mount.prefix + segments.map(encodeURIComponent).join('/') + '/').replace(/\/{2,}/g, '/');
          res.writeHead(301, { Location: loc + (query ? `?${query}` : ''), 'Cache-Control': 'no-cache', 'Content-Length': 0 });
          res.end();
          return;
        }
        absPath = path.join(absPath, 'index.html');
        segments.push('index.html');
        viaDirectory = true;
        stat = await fsp.stat(absPath);
      }
      // Not a regular file, or a file addressed like a directory ("/app.js/") → 404.
      if (!stat.isFile() || (decoded.endsWith('/') && !viaDirectory)) {
        throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      }
      if (mount.deny) {
        // the on-disk name decides (case-insensitive file systems, Windows 8.3 short names like NODEDA~1.JS)
        const real = await fsp.realpath(absPath);
        if (mount.deny.has(path.basename(real).toLowerCase())) throw Object.assign(new Error('private'), { code: 'ENOENT' });
      }
      if (mount.name === 'data' && segments.length > 1 && await isVersionData(absPath)) {
        throw Object.assign(new Error('version data'), { code: 'ENOENT' });
      }
    } catch (e) {
      if (e && e.code === 'ENOENT' && mount.name === 'data' && segments.length === 1 && LOCAL_ART_MANIFESTS.has(segments[0])) {
        // Optional local-client art (DESIGN §13): an install without it gets an empty manifest instead of a 404,
        // so browsers don't log an error on every page load. Clients treat empty groups as "no local art".
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', 'Content-Length': EMPTY_LOCAL_ART.length });
        res.end(req.method === 'HEAD' ? undefined : EMPTY_LOCAL_ART);
      } else if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EISDIR' || e.code === 'ENAMETOOLONG')) {
        sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : '');
      } else if (e && (e.code === 'EACCES' || e.code === 'EPERM')) {
        sendError(req, res, 403, '禁止访问 · Forbidden');
      } else {
        log.error('[http] stat failed', e);
        sendError(req, res, 500, '服务器内部错误 · Internal error');
      }
      return;
    }
    const first = segments[0] || '';
    if (mount.name === 'public' && (first.toLowerCase().startsWith('studio') || /[^\x00-\x7f]/.test(first))) {
      const studio = await studioRealPath();
      const real = studio ? await fsp.realpath(absPath).catch(() => null) : null;
      if (studio && (!real || real === studio || real.startsWith(studio + path.sep))) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
    }
    // Compare the actual file, including case-insensitive / encoded aliases, before every 200/206/304.
    if (mount.name === 'public' && path.basename(absPath).toLowerCase() === 'simworker.js') {
      const real = await fsp.realpath(absPath);
      const worker = await fsp.realpath(path.join(publicDir, 'js/battle/simWorker.js')).catch(() => null);
      if (real === worker) res.setHeader('Content-Security-Policy', SIM_WORKER_CSP);
    }
    const indexed = mount.name === 'public' && segments.length > 1 && ASSET_INDEX_ROOTS.includes(segments[0]);
    const opts = indexed ? hashedFileOpts(assetIndex, segments.join('/'), stat, urlHash) : (urlHash ? { cacheControl: 'no-cache' } : {});
    await serveFile(req, res, absPath, stat, mount.name, segments, query, gzipCache, log, opts);
  };
}
