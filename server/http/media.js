// server/http/media.js — the extension-less audio route /media/… → public/assets/audio (see serveMedia).
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)

import fsp from 'node:fs/promises';
import path from 'node:path';
import { AUDIO_EXTS } from '../../shared/media.js';
import { sendError } from './common.js';
import { serveFile } from './files.js';
import { hashedFileOpts } from './assetIndex.js';

/**
 * Extension-less audio route: `/media/bgm/act1` → `public/assets/audio/bgm/act1.mp3`.
 *
 * Clients ask for audio through this path because download managers (IDM, 迅雷, FDM …) hijack XHR/fetch whose
 * URL ends in a media extension and pop a "下载文件信息" dialog for every BGM track — see `public/js/media.js`.
 * Requests for the direct `/assets/audio/…` URLs keep working (they are the fallback for plain static hosts).
 * `MEDIA_PREFIX` / `AUDIO_EXTS` live in `shared/media.js`: the browser decides which URLs to rewrite with the
 * same two values, and they must not drift apart.
 * `/media/~<hash>/bgm/act1` (a served manifest's `/assets/~<hash>/audio/bgm/act1.mp3`, public/js/media.js): static.js
 * strips the segment and hands it over as `urlHash`; the answer is `immutable` when it names the resolved file's bytes
 * (assetIndex.js), else `no-cache`, and the ETag is the file's content hash when the index has it.
 * @param {{ urlHash?: string | null, assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null }} [hashing]
 */
export async function serveMedia(req, res, rest, query, publicDir, gzipCache, log, { urlHash = null, assetIndex = null } = {}) {
  const root = path.join(path.resolve(publicDir), 'assets', 'audio');
  const segments = String(rest || '').split('/').filter((s) => s.length > 0);
  if (!segments.length || rest.endsWith('/')) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
  if (segments.some((s) => s === '..' || s === '.')) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }
  // A leading or trailing dot would address something else (dotfiles, "x..mp3") — and the client never asks for it.
  if (segments.some((s) => s.startsWith('.') || s.endsWith('.'))) { sendError(req, res, 404, '页面不存在 · Not found'); return; }

  const last = segments[segments.length - 1];
  const given = path.extname(last).toLowerCase();
  const wanted = AUDIO_EXTS.includes(given) ? given : '';
  const stem = wanted ? last.slice(0, -wanted.length) : last;
  if (!stem || stem.startsWith('.')) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
  const dir = path.join(root, ...segments.slice(0, -1));
  if (dir !== root && !dir.startsWith(root + path.sep)) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }

  // An explicit extension wins (`/media/bgm.ogg` → bgm.ogg), otherwise the usual order decides.
  const order = wanted ? [wanted, ...AUDIO_EXTS.filter((e) => e !== wanted)] : AUDIO_EXTS;
  for (const ext of order) {
    const absPath = path.join(dir, stem + ext);
    if (!absPath.startsWith(root + path.sep)) continue;
    let stat;
    try {
      // eslint-disable-next-line no-await-in-loop
      stat = await fsp.stat(absPath);
    } catch { continue; }
    if (!stat.isFile()) continue;
    // serveFile decides Content-Type from the resolved name (`.mp3` → audio/mpeg) — Range/ETag handling is shared.
    // Cache policy is that of the public path the client would otherwise have asked for (`/assets/audio/…`, 1 day),
    // or that of its content-hashed form.
    const rel = ['assets', 'audio', ...segments.slice(0, -1), stem + ext].join('/');
    // eslint-disable-next-line no-await-in-loop
    await serveFile(req, res, absPath, stat, 'public', ['assets', 'audio', ...segments], query, gzipCache, log, hashedFileOpts(assetIndex, rel, stat, urlHash));
    return;
  }
  sendError(req, res, 404, '页面不存在 · Not found');
}
