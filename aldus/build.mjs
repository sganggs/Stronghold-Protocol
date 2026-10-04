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
//                                            fonts/fonts.css, which index.html links, is written here
//     data/*.json          → dist/data/      data/local-assets.json is always the server's empty stand-in, and
//                                            data/assets.json names each file at the asset origin ("Art" below)
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
// 25 MB a file) and is never part of this build. public/fonts is left out with it, so the build is the same on every
// machine, with or without the download. The files are in a bucket instead (aldus/sync-art.sh copies them there), and
// the build points the page at it: ASSET_ORIGIN, the public address of that bucket.
//   * The client takes every address of the art and the audio from the manifest, data/assets.json, and uses it as it
//     is. So the copy of the manifest gets the origin in front of each "/assets/…" address; no script is changed.
//     Audio at another origin is fetched from there directly (public/js/media.js leaves such an address alone).
//   * One check of the client refuses such an address: validSpine (public/js/assets.js) takes a Spine model only
//     when its address is a path of the page's own origin, and each unit would stay an avatar. The copy of that file
//     takes an address at the asset origin too (allowSpineOrigin). A check this script does not know stops the build.
//   * fonts/fonts.css is written from the manifest's `fonts.faces`, with each font file at the origin.
//   * imprint.json must list the origin in `csp.hosts`, and the bucket must allow the page's origin (CORS, GET):
//     the renderer reads the images and the Spine files with CORS.
//   * Each <img> of the interface asks with CORS too (CORS_IMG_SCRIPT, one inline script in the entry page). The
//     bucket answers a request that has no Origin without the CORS header, and Chrome keeps that answer for the file:
//     the renderer's later load of the same file (the avatar the shop showed) is then refused from the cache.
// The art of a local game client (public/assets/local, data/local-assets.json) is not in the bucket: its manifest
// stays the empty stand-in. Without an origin (`build({ assetOrigin: null })`) the page draws its placeholders, as on
// any install without the download.
//
// Not here: the game server. The page opens its WebSocket at /ws of its own origin; aldus/worker answers there.

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
 * Where the art, the audio and the fonts are (header, "Art"): the public address of the bucket that aldus/sync-art.sh
 * fills. A key of the bucket is an address of the manifest without its first slash.
 */
export const ASSET_ORIGIN = 'https://assets.apps.vikala.io';

/** An origin an imprint may load from (`csp.hosts`): https, a host name, no path. */
const ORIGIN_RE = /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const checkOrigin = (origin) => {
  if (!ORIGIN_RE.test(origin)) throw new Error(`the asset origin must be "https://<host>" with no path: ${JSON.stringify(origin)}`);
};

/**
 * The asset manifest (data/assets.json) with `origin` in front of each "/assets/…" address. Nothing else changes: the
 * animation names, the sizes and the `fonts` entry stay as they are.
 * @param {string} manifestText the JSON text of data/assets.json
 * @param {string|null} origin  null: the text comes back as it is
 * @returns {string}
 */
export function withAssetOrigin(manifestText, origin) {
  if (!origin) return manifestText;
  checkOrigin(origin);
  let count = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      if (!v.startsWith('/assets/')) return v;
      count++;
      return origin + v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(JSON.parse(manifestText));
  if (!count) throw new Error('data/assets.json has no "/assets/…" address: how does the manifest name its files now?');
  return JSON.stringify(out);
}

/** The check of a Spine address in validSpine (public/js/assets.js): a path of the page's own origin. */
export const SPINE_CHECK = String.raw`/^\/[^\s]*\.skel$/.test(sp.skel)`;

/**
 * public/js/assets.js for a build with an asset origin: validSpine takes a Spine address at `origin` too (header,
 * "Art"). Only that origin: an address of another host stays refused.
 * @param {string} js the text of public/js/assets.js
 * @param {string|null} origin null: the text comes back as it is
 * @returns {string}
 */
export function allowSpineOrigin(js, origin) {
  if (!origin) return js;
  checkOrigin(origin);
  if (js.split(SPINE_CHECK).length !== 2) {
    throw new Error('public/js/assets.js: validSpine no longer checks the Spine address the way aldus/build.mjs knows (SPINE_CHECK). '
      + 'See how it takes an address now, and make sure that a model at the asset origin still loads.');
  }
  const host = origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return js.replace(SPINE_CHECK, () => String.raw`/^(?:${host})?\/[^\s]*\.skel$/.test(sp.skel)`);
}

/**
 * Every <img> that a script makes asks with CORS (header, "Art"). An image of the page's own origin and a data: or
 * blob: address load as before. Both calls are covered: Preact makes each element with createElementNS. It is an
 * inline script: it must run before the game's module makes its first image.
 */
export const CORS_IMG_SCRIPT = `<script>
  (function () {
    var proto = Document.prototype, make = proto.createElement, makeNS = proto.createElementNS;
    var cors = function (el) {
      if (el && el.localName === 'img' && el.namespaceURI === 'http://www.w3.org/1999/xhtml') el.crossOrigin = 'anonymous';
      return el;
    };
    proto.createElement = function (name, options) { return cors(make.call(this, name, options)); };
    proto.createElementNS = function (ns, name, options) { return cors(makeNS.call(this, ns, name, options)); };
  })();
  </script>`;

/**
 * The entry page for a build with an asset origin: CORS_IMG_SCRIPT in its head, before every module.
 * @param {string} html
 * @param {string|null} origin null: the page as it is
 */
export function injectCorsImages(html, origin) {
  if (!origin) return html;
  if (html.split('</head>').length !== 2) throw new Error('public/index.html: expected one </head> for the image script');
  if (/<img\b/i.test(html.replace(/<!--[\s\S]*?-->/g, ''))) throw new Error('public/index.html has an <img> of its own: CORS_IMG_SCRIPT covers only the images that a script makes');
  return html.replace('</head>', `  ${CORS_IMG_SCRIPT}\n</head>`);
}

const FONT_FORMATS = Object.freeze({ '.woff2': 'woff2', '.woff': 'woff', '.otf': 'opentype', '.ttf': 'truetype' });

/**
 * fonts/fonts.css for the build: the @font-face rules of the manifest's `fonts.faces`, each file at `origin`. It is
 * what tools/fetch-assets.mjs writes as public/fonts/fonts.css, made from the committed manifest and not from the
 * download. A face this function cannot read stops the build.
 * @param {string} manifestText the JSON text of data/assets.json
 * @param {string|null} origin  null: the empty stand-in
 * @returns {string}
 */
export function fontsCss(manifestText, origin) {
  if (!origin) return EMPTY_FONTS_CSS;
  checkOrigin(origin);
  const faces = JSON.parse(manifestText).fonts?.faces;
  if (!faces || typeof faces !== 'object' || !Object.keys(faces).length) throw new Error('data/assets.json has no fonts.faces: how does the manifest name its fonts now?');
  const src = (file) => {
    const format = typeof file === 'string' && /^\/fonts\/[A-Za-z0-9._-]+$/.test(file) ? FONT_FORMATS[path.extname(file).toLowerCase()] : null;
    if (!format) throw new Error(`data/assets.json fonts.faces: not a font file this build knows: ${JSON.stringify(file)}`);
    return `url('${origin}${file}') format('${format}')`;
  };
  const rules = Object.entries(faces).map(([id, f]) => {
    if (!f || !/^[A-Za-z0-9 ]+$/.test(f.family) || !Number.isInteger(f.weight)) throw new Error(`data/assets.json fonts.faces.${id}: a face needs a plain "family" and an integer "weight"`);
    return `@font-face {\n  font-family: '${f.family}';\n  font-style: normal;\n  font-weight: ${f.weight};\n  font-display: swap;\n  src: ${[f.woff2, f.original].filter((x) => x != null).map(src).join(',\n       ')};\n}\n`;
  });
  return `/* Generated by aldus/build.mjs from data/assets.json (fonts.faces). The font files are at ${origin};\n * THIRD-PARTY-NOTICES.md has their credits. */\n\n${rules.join('\n')}`;
}

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
 * @param {{ root?: string, out?: string, patchDir?: string, assetOrigin?: string|null, log?: (line: string) => void }} [opts]
 * `assetOrigin`: where the art is (ASSET_ORIGIN); null builds a page without art
 * @returns {Promise<{ out: string, files: number, bytes: number, counts: Record<string, number>, skipped: string[] }>}
 */
export async function build({ root = ROOT, out = path.join(HERE, 'dist'), patchDir = path.join(HERE, 'node_modules', '@pixi', 'unsafe-eval'), assetOrigin = ASSET_ORIGIN, log = () => {} } = {}) {
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
  fs.writeFileSync(path.join(outAbs, 'index.html'), injectI18n(injectCorsImages(transformEntry(fs.readFileSync(path.join(pub, 'index.html'), 'utf8')), assetOrigin)));
  fs.mkdirSync(path.join(outAbs, 'i18n'), { recursive: true });
  for (const f of ['runtime.js', 'translator.js']) fs.copyFileSync(path.join(I18N_DIR, f), path.join(outAbs, 'i18n', f));
  fs.writeFileSync(path.join(outAbs, 'i18n', 'catalog.js'), `// Generated by aldus/build.mjs from aldus/i18n/locales.\nexport default ${JSON.stringify(buildCatalogs(root))};\n`);
  const { DATA_SHIM_JS } = await import(pathToFileURL(path.join(root, 'server', 'index.js')).href);
  if (typeof DATA_SHIM_JS !== 'string' || !DATA_SHIM_JS) throw new Error('server/index.js no longer exports DATA_SHIM_JS: how is /data.js served now?');
  fs.writeFileSync(path.join(outAbs, 'data.js'), DATA_SHIM_JS);
  fs.writeFileSync(path.join(outAbs, 'data', 'local-assets.json'), EMPTY_LOCAL_ART);
  fs.writeFileSync(path.join(outAbs, 'robots.txt'), ROBOTS_TXT);
  // the art, the audio and the fonts are at the asset origin, not in the imprint (header, "Art")
  const manifest = fs.readFileSync(path.join(root, 'data', 'assets.json'), 'utf8');
  fs.writeFileSync(path.join(outAbs, 'data', 'assets.json'), withAssetOrigin(manifest, assetOrigin));
  fs.mkdirSync(path.join(outAbs, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(outAbs, 'fonts', 'fonts.css'), fontsCss(manifest, assetOrigin));
  fs.writeFileSync(path.join(outAbs, 'js', 'assets.js'), allowSpineOrigin(fs.readFileSync(path.join(pub, 'js', 'assets.js'), 'utf8'), assetOrigin));

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
  log(assetOrigin ? `art, audio and fonts: ${assetOrigin}` : 'no asset origin: the page draws its placeholders');
  if (problems.length) throw new Error(`the build breaks the imprint contract:\n  ${problems.join('\n  ')}`);
  return { out: outAbs, files, bytes, counts, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ log: (line) => console.log(line) }).catch((e) => {
    console.error(`✖ ${e.message}`);
    process.exit(1);
  });
}
