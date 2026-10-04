#!/usr/bin/env node
// aldus/build.mjs — the static build of the browser client for Aldus (an "imprint"; README.md in this folder).
//
//   node aldus/build.mjs            → aldus/dist/   (imprint.json: build.command / build.output)
//
// Aldus serves static files only, from the root of the imprint's own origin. The Node server answers the client's URLs
// from five places (server/index.js createStaticHandler); this script lays the same URLs out as one folder:
//
//     public/**            → dist/           but not public/dev (pages with inline scripts, dev only) and not the
//                                            machine-local downloads public/assets, public/fonts (see "Art" below);
//                                            fonts/fonts.css, which index.html links, is an empty stand-in
//     data/*.json          → dist/data/      data/local-assets.json is always the server's empty stand-in
//     shared/**            → dist/shared/
//     server/sim/**/*.js   → dist/sim/       without nodeData.js, the Node-only loader the server never serves either
//     DATA_SHIM_JS         → dist/data.js    the string server/index.js serves at /data.js, imported from it
//     LICENSE, NOTICE.md, THIRD-PARTY-NOTICES.md → dist/ (LICENSE as LICENSE.txt: every file needs an extension)
//
// This project is a fork: no file outside this folder is moved or changed, so the owner's updates merge as before.
// What the imprint contract needs and the sources do not give is done to the COPY, here:
//
//   * Inline event handlers (contract IMP-21; the CSP of an imprint refuses them). public/index.html has two. Each
//     known one becomes a data attribute plus a listener in one inline script (inline scripts are allowed in the
//     entry page, by hash). An inline handler this script does not know stops the build: silently dropping one
//     would change what the page does.
//   * PixiJS 7 builds its uniform uploads with `new Function`, which the CSP refuses (no 'unsafe-eval'): the renderer
//     would throw on its first shader. Its own patch for such pages, @pixi/unsafe-eval (same version, self-installing),
//     is appended to the copy of vendor/pixi.min.js, so render/app.js loads both with the one <script> it injects.
//     A PixiJS version that differs from the patch's stops the build.
//   * robots.txt refuses crawlers: the project asks that an address is given to friends only (README, NOTICE.md).
//   * The interface is Chinese in the sources. The i18n layer of aldus/i18n (a runtime module and the catalogs of
//     locales/) goes into dist/i18n, and the entry page loads it before the game's own module. The game data is not
//     translated: the simulation reads its Chinese text. The names of the operators come from the data itself
//     (`appellation`), so the build adds them to every catalog.
//
// Art: public/assets (~270 MB, ~4,000 files, © Hypergryph / Yostar) is over an imprint's limits (1,000 files, 100 MB,
// 25 MB a file) and is never part of this build; the client then draws its placeholder visuals, as it does on any
// install without the download. public/fonts is left out with it, so the build is the same on every machine.
//
// Not here: the game server. The page still opens its WebSocket at /ws of its own origin, which an imprint does not
// answer, so the title screen loads and nothing after it works until the backend is rebuilt for this platform.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (the parent of this folder). */
export const ROOT = path.resolve(HERE, '..');

/** Limits of one imprint version (contract IMP-14). */
export const LIMITS = Object.freeze({ files: 1000, bytes: 100 * 1024 * 1024, fileBytes: 25 * 1024 * 1024, pathChars: 1024 });

/** Top-level folders of public/ that never go into the build (see the header). */
export const PUBLIC_SKIP = Object.freeze(['dev', 'assets', 'fonts']);

/** What server/index.js answers for /data/local-assets.json on an install without local-client art. */
export const EMPTY_LOCAL_ART = JSON.stringify({ version: 1, source: 'none', count: 0, groups: {} });

export const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

/** The i18n layer of this folder (README.md there). */
const I18N_DIR = path.join(HERE, 'i18n');
export const I18N_TAG = '<script type="module" src="/i18n/runtime.js"></script>';

/** The entry page with the i18n runtime in its head: a module, so it runs before the game's module that follows it. */
export function injectI18n(html) {
  if (html.split('</head>').length !== 2) throw new Error('public/index.html: expected one </head> for the i18n runtime');
  return html.replace('</head>', `  ${I18N_TAG}\n</head>`);
}

/** Chinese operator name → the name the game data carries in Latin letters (`appellation`). */
export function operatorNames(root = ROOT) {
  const chess = JSON.parse(fs.readFileSync(path.join(root, 'data', 'chess.json'), 'utf8'));
  const names = {};
  for (const c of Object.values(chess)) {
    const latin = typeof c.appellation === 'string' ? c.appellation.trim() : '';
    if (c.name && latin && /^[\x20-\x7e\u00c0-\u024f\u2019]+$/.test(latin) && /[\u3400-\u9fff]/.test(c.name)) names[c.name] = latin;
  }
  return names;
}

/** Every catalog of aldus/i18n/locales, by locale, with the operator names added (a catalog's own entry wins). */
export function buildCatalogs(root = ROOT) {
  const names = operatorNames(root);
  const out = {};
  for (const f of fs.readdirSync(path.join(I18N_DIR, 'locales')).filter((n) => n.endsWith('.json')).sort()) {
    const cat = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'locales', f), 'utf8'));
    if (!cat.locale || typeof cat.messages !== 'object') throw new Error(`aldus/i18n/locales/${f}: a catalog needs "locale" and "messages"`);
    for (const [re] of cat.patterns || []) new RegExp(re);
    out[cat.locale] = { name: cat.name || cat.locale, messages: { ...names, ...cat.messages }, patterns: cat.patterns || [] };
  }
  return out;
}

/** public/fonts is not shipped, but index.html links its stylesheet: an empty one instead of a 404 on every visit. */
export const EMPTY_FONTS_CSS = '/* The downloaded fonts are not part of this build (aldus/build.mjs); theme.css names the fallbacks. */\n';

/**
 * The inline event handlers of public/index.html this build knows how to keep. `tag` and `attr` are lower-case,
 * `value` is the handler's exact source; `mark` is the data attribute the copy carries instead.
 */
export const KNOWN_HANDLERS = Object.freeze([
  // the Google Fonts stylesheet, loaded without blocking the first paint
  { tag: 'link', attr: 'onload', value: "this.media='all'", mark: 'data-sp-onload="media-all"' },
  // the module graph failed to load: the boot screen says so
  { tag: 'script', attr: 'onerror', value: "window.__spBootFail && window.__spBootFail('load')", mark: 'data-sp-onerror="boot-fail"' },
]);

/** The listeners that stand in for KNOWN_HANDLERS. `load` / `error` of an element do not bubble: they are captured. */
export const HANDLER_SCRIPT = `<script>
    // Added by aldus/build.mjs: the page's inline event handlers, as listeners (an imprint's CSP refuses inline ones).
    document.addEventListener('load', function (ev) {
      var t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-sp-onload') === 'media-all') t.media = 'all';
    }, true);
    document.addEventListener('error', function (ev) {
      var t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-sp-onerror') === 'boot-fail' && window.__spBootFail) window.__spBootFail('load');
    }, true);
  </script>`;

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*?)?>/g;
const HANDLER_ATTR_RE = /\s(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Every inline event handler of `html` outside comments, as `{ tag, attr, value }`. */
export function inlineHandlers(html) {
  const found = [];
  for (const m of html.replace(COMMENT_RE, '').matchAll(TAG_RE)) {
    for (const a of (m[2] || '').matchAll(HANDLER_ATTR_RE)) {
      found.push({ tag: m[1].toLowerCase(), attr: a[1].toLowerCase(), value: a[2] ?? a[3] ?? '' });
    }
  }
  return found;
}

/**
 * public/index.html as an imprint's entry page: every known inline handler becomes its data attribute, and
 * HANDLER_SCRIPT goes in right after `<meta charset>` (before the elements it listens for). Throws on an inline
 * handler it does not know, on a `<base>` element (IMP-12) and on a `javascript:` URL (IMP-21).
 * @param {string} html
 * @returns {string}
 */
export function transformEntry(html) {
  const unknown = [];
  let replaced = 0;
  // comments are kept as they are: a tag inside one is never an element
  const parts = html.split(/(<!--[\s\S]*?-->)/);
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(TAG_RE, (whole, tag, attrs = '') => {
      const next = attrs.replace(HANDLER_ATTR_RE, (attrText, attr, dq, sq) => {
        const value = dq ?? sq ?? '';
        const known = KNOWN_HANDLERS.find((k) => k.tag === tag.toLowerCase() && k.attr === attr.toLowerCase() && k.value === value);
        if (!known) { unknown.push(`<${tag} ${attr.toLowerCase()}="${value}">`); return attrText; }
        replaced += 1;
        return ` ${known.mark}`;
      });
      return `<${tag}${next}>`;
    });
  }).join('');
  if (unknown.length) {
    throw new Error(`public/index.html has inline event handlers this build does not know:\n  ${unknown.join('\n  ')}\n`
      + 'Add each one to KNOWN_HANDLERS and HANDLER_SCRIPT in aldus/build.mjs (an imprint refuses inline handlers).');
  }
  const bare = out.replace(COMMENT_RE, '');
  if (/<base[\s>]/i.test(bare)) throw new Error('public/index.html has a <base> element: Aldus sets its own (IMP-12)');
  if (/(?:href|src|action)\s*=\s*["']?\s*javascript:/i.test(bare)) throw new Error('public/index.html has a javascript: URL (IMP-21)');
  if (!replaced) return out;
  const charset = /<meta\s+charset=[^>]*>/i;
  if (!charset.test(out)) throw new Error('public/index.html has no <meta charset>: nowhere to put the handler script');
  return out.replace(charset, (m) => `${m}\n  ${HANDLER_SCRIPT}`);
}

/** Names the static server never serves, so the build never copies: dot files and editor backups. */
const isIgnoredName = (name) => name.startsWith('.') || name.endsWith('~');

/** Every regular file under `dir` as a `/`-separated path relative to it, sorted. Symbolic links are not followed. */
export function listFiles(dir, keep = () => true, rel = '') {
  const out = [];
  let names;
  try { names = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const d of names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (isIgnoredName(d.name)) continue;
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (!keep(childRel, d.isDirectory())) continue;
    if (d.isDirectory()) out.push(...listFiles(dir, keep, childRel));
    else if (d.isFile()) out.push(childRel);
  }
  return out;
}

/** `pixi.js - vX.Y.Z` of a PixiJS browser bundle, or null. */
export function pixiVersion(source) {
  const m = /pixi\.js - v(\d+\.\d+\.\d+)/.exec(source.slice(0, 400));
  return m ? m[1] : null;
}

/**
 * vendor/pixi.min.js with @pixi/unsafe-eval behind it (see the header). The patch's source map comment goes: the map
 * is not shipped.
 */
export function patchPixi(pixiSource, patchSource, patchVersion) {
  const version = pixiVersion(pixiSource);
  if (!version) throw new Error('public/vendor/pixi.min.js: no "pixi.js - vX.Y.Z" banner; is it still PixiJS?');
  if (version !== patchVersion) {
    throw new Error(`PixiJS is ${version} but aldus/package.json pins @pixi/unsafe-eval ${patchVersion}: `
      + 'set the same version there and run `npm install` in aldus/ (PixiJS 8 needs no patch: then remove this step).');
  }
  if (!/ShaderSystem/.test(patchSource) || !/selfInstall|systemCheck/.test(patchSource)) {
    throw new Error('@pixi/unsafe-eval: the bundle no longer patches ShaderSystem by itself; read its README');
  }
  const patch = patchSource.replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '\n');
  return `${pixiSource.replace(/\s*$/, '')}\n${patch}`;
}

/** Problems of a built folder against the limits and names of the contract (IMP-13, IMP-14, IMP-16, IMP-20). */
export function contractProblems(out) {
  const problems = [];
  const files = listFiles(out);
  let bytes = 0;
  for (const rel of files) {
    const size = fs.statSync(path.join(out, rel)).size;
    bytes += size;
    if (size > LIMITS.fileBytes) problems.push(`${rel}: ${size} bytes, over ${LIMITS.fileBytes} a file`);
    if (rel.length > LIMITS.pathChars) problems.push(`${rel}: path over ${LIMITS.pathChars} characters`);
    if (!path.extname(rel)) problems.push(`${rel}: no extension (a path without a dot loads the entry page)`);
    if (rel.endsWith('.html') && rel !== 'index.html') {
      const html = fs.readFileSync(path.join(out, rel), 'utf8');
      if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html.replace(COMMENT_RE, ''))) problems.push(`${rel}: inline <script> outside the entry page`);
      if (inlineHandlers(html).length) problems.push(`${rel}: inline event handlers`);
    }
  }
  for (const name of fs.readdirSync(out)) if (name.startsWith('_')) problems.push(`${name}: a top-level name starting with "_" belongs to Aldus`);
  if (files.length > LIMITS.files) problems.push(`${files.length} files, over ${LIMITS.files}`);
  if (bytes > LIMITS.bytes) problems.push(`${bytes} bytes, over ${LIMITS.bytes}`);
  if (!files.includes('index.html')) problems.push('no index.html');
  else if (inlineHandlers(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).length) problems.push('index.html: inline event handlers left');
  return { problems, files: files.length, bytes };
}

function copyTree(fromDir, toDir, keep) {
  const files = listFiles(fromDir, keep);
  for (const rel of files) {
    const to = path.join(toDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(fromDir, rel), to);
  }
  return files.length;
}

/**
 * Build the imprint into `out` (emptied first).
 * @param {{ root?: string, out?: string, patchDir?: string, log?: (line: string) => void }} [opts]
 * @returns {Promise<{ out: string, files: number, bytes: number, counts: Record<string, number>, skipped: string[] }>}
 */
export async function build({ root = ROOT, out = path.join(HERE, 'dist'), patchDir = path.join(HERE, 'node_modules', '@pixi', 'unsafe-eval'), log = () => {} } = {}) {
  const pub = path.join(root, 'public');
  const vendorPixi = path.join(pub, 'vendor', 'pixi.min.js');
  if (!fs.existsSync(vendorPixi)) {
    throw new Error('public/vendor/pixi.min.js is missing: run `npm install` at the repository root (its postinstall copies the client libraries)');
  }
  const patchFile = path.join(patchDir, 'dist', 'unsafe-eval.min.js');
  if (!fs.existsSync(patchFile)) throw new Error('@pixi/unsafe-eval is missing: run `npm install` in aldus/');
  const patchVersion = JSON.parse(fs.readFileSync(path.join(patchDir, 'package.json'), 'utf8')).version;

  // the output is this script's own: never empty anything that could be the project
  const outAbs = path.resolve(out);
  const rel = path.relative(outAbs, path.resolve(root));
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error(`refusing to empty ${outAbs}: it holds the project`);
  fs.rmSync(outAbs, { recursive: true, force: true });
  fs.mkdirSync(outAbs, { recursive: true });

  const counts = {};
  counts.public = copyTree(pub, outAbs, (r) => !PUBLIC_SKIP.includes(r.split('/')[0]));
  counts.data = copyTree(path.join(root, 'data'), path.join(outAbs, 'data'), (r, isDir) => isDir || r.endsWith('.json'));
  counts.shared = copyTree(path.join(root, 'shared'), path.join(outAbs, 'shared'));
  counts.sim = copyTree(path.join(root, 'server', 'sim'), path.join(outAbs, 'sim'),
    (r, isDir) => isDir || (r.endsWith('.js') && path.basename(r).toLowerCase() !== 'nodedata.js'));

  // the entry page, and the files the server makes up
  fs.writeFileSync(path.join(outAbs, 'index.html'), injectI18n(transformEntry(fs.readFileSync(path.join(pub, 'index.html'), 'utf8'))));
  fs.mkdirSync(path.join(outAbs, 'i18n'), { recursive: true });
  for (const f of ['runtime.js', 'translator.js']) fs.copyFileSync(path.join(I18N_DIR, f), path.join(outAbs, 'i18n', f));
  fs.writeFileSync(path.join(outAbs, 'i18n', 'catalog.js'), `// Generated by aldus/build.mjs from aldus/i18n/locales.\nexport default ${JSON.stringify(buildCatalogs(root))};\n`);
  const { DATA_SHIM_JS } = await import(pathToFileURL(path.join(root, 'server', 'index.js')).href);
  if (typeof DATA_SHIM_JS !== 'string' || !DATA_SHIM_JS) throw new Error('server/index.js no longer exports DATA_SHIM_JS: how is /data.js served now?');
  fs.writeFileSync(path.join(outAbs, 'data.js'), DATA_SHIM_JS);
  fs.writeFileSync(path.join(outAbs, 'data', 'local-assets.json'), EMPTY_LOCAL_ART);
  fs.writeFileSync(path.join(outAbs, 'robots.txt'), ROBOTS_TXT);
  fs.mkdirSync(path.join(outAbs, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(outAbs, 'fonts', 'fonts.css'), EMPTY_FONTS_CSS);

  // PixiJS under a CSP without 'unsafe-eval'
  fs.writeFileSync(path.join(outAbs, 'vendor', 'pixi.min.js'),
    patchPixi(fs.readFileSync(vendorPixi, 'utf8'), fs.readFileSync(patchFile, 'utf8'), patchVersion));
  fs.copyFileSync(path.join(patchDir, 'LICENSE'), path.join(outAbs, 'vendor', 'pixi-unsafe-eval.LICENSE.txt'));

  // licences and notices travel with the code
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(outAbs, 'LICENSE.txt'));
  for (const f of ['NOTICE.md', 'THIRD-PARTY-NOTICES.md']) fs.copyFileSync(path.join(root, f), path.join(outAbs, f));

  const skipped = PUBLIC_SKIP.filter((d) => fs.existsSync(path.join(pub, d)));
  const { problems, files, bytes } = contractProblems(outAbs);
  log(`public ${counts.public} · data ${counts.data} · shared ${counts.shared} · sim ${counts.sim} → ${files} files, ${(bytes / 1048576).toFixed(1)} MB in ${path.relative(root, outAbs) || outAbs}`);
  if (skipped.length) log(`left out of public/: ${skipped.join(', ')}`);
  if (problems.length) throw new Error(`the build breaks the imprint contract:\n  ${problems.join('\n  ')}`);
  return { out: outAbs, files, bytes, counts, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ log: (line) => console.log(line) }).catch((e) => {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  });
}
