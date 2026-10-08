// server/http/buildTag.js — the build tag of the browser runtime this process serves (/healthz `build`).

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './config.js';

// ---------------------------------------------------------------------------------------------------
// build tag — the "your page is stale" signal (public/js/ui/buildGuard.js)
// ---------------------------------------------------------------------------------------------------

/**
 * The files that make up the runtime the BROWSER loads. A change in any of them is a new build: an already-open page
 * keeps the modules it imported at load time (ES modules live in the page's module map for its whole lifetime), so
 * without this signal a deployed fix could never reach a player who does not reload — a client-only battle fix
 * shipped exactly that way and stayed invisible on a page that had been opened before the deploy.
 *
 * The browser also imports `/sim/` from `server/sim/` and `/shared/`, and caches JSON from `/data/`. Include those
 * trees so a simulation-only or data-only deploy reaches old pages after the server restarts. `buildTag()` caches
 * this fingerprint for the process lifetime: files changing on disk do not advertise a new build before restart.
 * The rest of `server/` and downloaded media are not included.
 */
export const BUILD_INPUTS = Object.freeze(['public/index.html', 'public/js', 'public/css', 'server/sim', 'shared', 'data']);

/** Names the static server never serves: dot files (`.DS_Store`, `.main.js.swp`) and editor backups (`main.js~`). */
const isIgnoredBuildName = (name) => name.startsWith('.') || name.endsWith('~');

/** @type {{ tag: string|null }|null} */
let buildCache = null;

/** Every file under `abs` (or `abs` itself), as `[relative path, size, mtimeMs]`, sorted by path. Missing → []. */
function buildEntries(abs, rel, out) {
  let stat;
  try { stat = fs.statSync(abs); } catch { return; }
  if (stat.isFile()) { out.push([rel, stat.size, stat.mtimeMs]); return; }
  if (!stat.isDirectory()) return;
  let names;
  try { names = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const d of names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (isIgnoredBuildName(d.name)) continue;
    const child = path.join(abs, d.name);
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) buildEntries(child, childRel, out);
    else if (d.isFile()) { try { const s = fs.statSync(child); out.push([childRel, s.size, s.mtimeMs]); } catch { /* ignore */ } }
  }
}

/** Short hash of the served browser runtime (size + mtime of every BUILD_INPUTS file); null when nothing is readable. */
export function computeBuildTag(root = ROOT) {
  const out = [];
  for (const rel of BUILD_INPUTS) buildEntries(path.join(root, rel), rel, out);
  if (!out.length) return null;
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const h = createHash('sha1');
  for (const [rel, size, mtime] of out) h.update(`${rel}\0${size}\0${Math.floor(mtime)}\n`);
  return h.digest('hex').slice(0, 12);
}

/**
 * The build tag of THIS process. Computed once (`startServer` warms it at startup): the tag describes the files the
 * process is actually serving, every update restarts the server (DEPLOY.md), and re-reading the tree on a timer would
 * let a half-finished deploy — or a file that changed while the process kept running — move the tag under a page.
 * @param {string} [root] used by the first call only (tests)
 */
export function buildTag(root = ROOT) {
  if (buildCache === null) buildCache = { tag: computeBuildTag(root) };
  return buildCache.tag;
}

/** Drop the cache: the next `buildTag()` re-reads the tree (tests, and `startServer`). */
export function resetBuildTag() { buildCache = null; }
