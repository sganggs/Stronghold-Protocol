// The Aldus imprint build (aldus/build.mjs): the entry page without inline event handlers, PixiJS patched for a CSP
// without 'unsafe-eval', the server's URL layout as one folder, the art at the asset origin, and the limits of the
// imprint contract. The full build runs only where the client libraries are installed (`npm install` at the root and
// in aldus/); it skips otherwise, like the suites that need downloaded art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ROOT, LIMITS, KNOWN_HANDLERS, HANDLER_SCRIPT, EMPTY_LOCAL_ART, EMPTY_FONTS_CSS, ASSET_ORIGIN,
  inlineHandlers, transformEntry, patchPixi, pixiVersion, contractProblems, build, injectI18n, I18N_TAG,
  withAssetOrigin, fontsCss, injectCorsImages, CORS_IMG_SCRIPT, allowSpineOrigin, SPINE_CHECK,
} from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const PATCH_DIR = path.join(HERE, 'node_modules', '@pixi', 'unsafe-eval');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8');
const ASSETS_JS = fs.readFileSync(path.join(ROOT, 'public', 'js', 'assets.js'), 'utf8');
const HAS_LIBS = fs.existsSync(path.join(ROOT, 'public', 'vendor', 'pixi.min.js')) && fs.existsSync(path.join(PATCH_DIR, 'dist', 'unsafe-eval.min.js'));

test('every inline event handler of public/index.html is one this build knows', () => {
  const found = inlineHandlers(ENTRY);
  assert.ok(found.length > 0, 'the page still has inline handlers (else KNOWN_HANDLERS can go)');
  for (const h of found) {
    assert.ok(KNOWN_HANDLERS.some((k) => k.tag === h.tag && k.attr === h.attr && k.value === h.value), `unknown: <${h.tag} ${h.attr}="${h.value}">`);
  }
});

test('transformEntry: handlers become data attributes and one listener script, nothing else changes', () => {
  const out = transformEntry(ENTRY);
  assert.deepEqual(inlineHandlers(out), [], 'no inline handler left');
  for (const k of KNOWN_HANDLERS) assert.ok(out.includes(k.mark), k.mark);
  assert.equal(out.split(HANDLER_SCRIPT).length, 2, 'the listener script, once');
  assert.ok(out.indexOf(HANDLER_SCRIPT) < out.indexOf('data-sp-onload'), 'the listeners are there before the elements they wait for');
  // the copy is the source plus the script, with each handler swapped for its mark
  let expected = ENTRY;
  for (const k of KNOWN_HANDLERS) expected = expected.replace(`${k.attr}="${k.value}"`, k.mark);
  assert.equal(out.replace(`\n  ${HANDLER_SCRIPT}`, ''), expected);
  // every data attribute a mark sets is one the script reads
  for (const k of KNOWN_HANDLERS) {
    const [name, value] = k.mark.replace(/"/g, '').split('=');
    assert.ok(HANDLER_SCRIPT.includes(`getAttribute('${name}') === '${value}'`), `${k.mark} has its listener`);
  }
});

test('transformEntry refuses what an imprint refuses', () => {
  assert.throws(() => transformEntry(ENTRY.replace('<div id="app">', '<div id="app" onclick="go()">')), /does not know[\s\S]*onclick="go\(\)"/);
  // a known handler on another element, or with other code, is unknown
  assert.throws(() => transformEntry(ENTRY.replace("this.media='all'", "this.media='screen'")), /does not know/);
  assert.throws(() => transformEntry(ENTRY.replace('<head>', '<head><base href="/x/">')), /<base>/);
  assert.throws(() => transformEntry(ENTRY.replace('<div id="app">', '<a href="javascript:void(0)">x</a><div id="app">')), /javascript:/);
  // a handler inside a comment is not an element
  const commented = ENTRY.replace('<div id="app">', '<!-- <button onclick="x()"> --><div id="app">');
  assert.ok(transformEntry(commented).includes('<!-- <button onclick="x()"> -->'));
  // a page without handlers is left alone
  const plain = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  assert.equal(transformEntry(plain), plain);
});

test('patchPixi: the patch goes behind PixiJS of the same version only', () => {
  const pixi = '/*!\n * pixi.js - v7.4.2\n */var PIXI=function(){}();\n';
  const patch = '/*! @pixi/unsafe-eval */var _p=function(){Object.assign(core.ShaderSystem.prototype,{systemCheck(){}})}();\n//# sourceMappingURL=unsafe-eval.min.js.map\n';
  assert.equal(pixiVersion(pixi), '7.4.2');
  const out = patchPixi(pixi, patch, '7.4.2');
  assert.ok(out.startsWith('/*!\n * pixi.js - v7.4.2') && out.includes('systemCheck'));
  assert.ok(!out.includes('sourceMappingURL'), 'the map is not shipped');
  assert.throws(() => patchPixi(pixi, patch, '7.4.1'), /PixiJS is 7\.4\.2 but .* 7\.4\.1/);
  assert.throws(() => patchPixi('var x;', patch, '7.4.2'), /no "pixi\.js - vX\.Y\.Z" banner/);
  assert.throws(() => patchPixi(pixi, 'var nothing;', '7.4.2'), /no longer patches ShaderSystem/);
});

test('withAssetOrigin: each "/assets/…" address of the manifest gets the origin, and nothing else changes', () => {
  const src = JSON.parse(MANIFEST);
  const out = JSON.parse(withAssetOrigin(MANIFEST, ASSET_ORIGIN));
  let addresses = 0;
  const same = (a, b, where) => {
    if (typeof a === 'string' && a.startsWith('/assets/')) { addresses++; assert.equal(b, ASSET_ORIGIN + a, where); return; }
    if (a && typeof a === 'object') {
      assert.deepEqual(Object.keys(b), Object.keys(a), where);
      for (const k of Object.keys(a)) same(a[k], b[k], `${where}.${k}`);
      return;
    }
    assert.equal(b, a, where);
  };
  same(src, out, 'manifest');
  assert.ok(addresses > 1000, `${addresses} addresses`);
  // the art, the Spine files and the audio all go: the client takes each address from the manifest as it is
  const one = Object.values(out.chars)[0];
  assert.ok(one.avatar.startsWith(`${ASSET_ORIGIN}/assets/char/avatar/`) && one.spine.front.skel.startsWith(`${ASSET_ORIGIN}/assets/spine/`));
  assert.ok(out.audio.bgm.lobby.loop.startsWith(`${ASSET_ORIGIN}/assets/audio/`));
  // public/js/media.js leaves an address of another origin alone, so the audio is fetched from the bucket
  assert.equal(out.fonts.css, '/fonts/fonts.css', 'the stylesheet of the fonts stays a file of the imprint');

  assert.equal(withAssetOrigin(MANIFEST, null), MANIFEST, 'no origin: the manifest as it is');
  for (const bad of ['http://assets.example', 'https://assets.example/', 'https://assets.example/art', '//assets.example', 'assets.example']) {
    assert.throws(() => withAssetOrigin(MANIFEST, bad), /asset origin must be/, bad);
  }
  assert.throws(() => withAssetOrigin('{"chars":{}}', ASSET_ORIGIN), /no "\/assets\/…" address/);
});

test('allowSpineOrigin: the client takes a Spine model at the asset origin, and at no other host', () => {
  assert.equal(ASSETS_JS.split(SPINE_CHECK).length, 2, 'validSpine of public/js/assets.js has the check this build knows, once');
  const out = allowSpineOrigin(ASSETS_JS, ASSET_ORIGIN);
  assert.ok(!out.includes(SPINE_CHECK) && out.length > ASSETS_JS.length);
  // nothing else changes: the copy is the source with that one expression swapped
  const check = out.slice(ASSETS_JS.indexOf(SPINE_CHECK), out.length - (ASSETS_JS.length - ASSETS_JS.indexOf(SPINE_CHECK) - SPINE_CHECK.length));
  assert.equal(out.replace(check, SPINE_CHECK), ASSETS_JS);
  const re = new RegExp(/^\/(.*)\/\.test\(sp\.skel\)$/.exec(check)[1]);
  assert.ok(re.test('/assets/spine/op/x/front/x.skel'), 'a path of the page still passes');
  assert.ok(re.test(`${ASSET_ORIGIN}/assets/spine/op/x/front/x.skel`), 'an address at the asset origin passes');
  for (const bad of ['https://other.example/assets/x.skel', `${ASSET_ORIGIN}.evil.example/x.skel`, `${ASSET_ORIGIN.replace(/\./g, 'x')}/x.skel`, `${ASSET_ORIGIN}/x.png`, `${ASSET_ORIGIN}/a b.skel`, 'assets/x.skel']) {
    assert.ok(!re.test(bad), bad);
  }
  assert.equal(allowSpineOrigin(ASSETS_JS, null), ASSETS_JS, 'no origin: the file as it is');
  assert.throws(() => allowSpineOrigin(ASSETS_JS.replace(SPINE_CHECK, 'isPath(sp.skel)'), ASSET_ORIGIN), /no longer checks the Spine address/);
});

test('injectCorsImages: with an asset origin, each <img> that a script makes asks with CORS', () => {
  const out = injectCorsImages(transformEntry(ENTRY), ASSET_ORIGIN);
  assert.equal(out.split(CORS_IMG_SCRIPT).length, 2, 'the script, once');
  assert.equal(out.replace(`  ${CORS_IMG_SCRIPT}\n`, ''), transformEntry(ENTRY), 'nothing else changes');
  assert.equal(injectCorsImages(ENTRY, null), ENTRY, 'no origin: the page as it is');
  // the script covers the images a script makes, so an <img> in the page itself stops the build
  assert.throws(() => injectCorsImages(ENTRY.replace('<div id="app">', '<img src="/x.png"><div id="app">'), ASSET_ORIGIN), /an <img> of its own/);

  // the script itself, on a stand-in for the document
  const HTML = 'http://www.w3.org/1999/xhtml';
  const SVG = 'http://www.w3.org/2000/svg';
  const Document = function () {};
  Document.prototype.createElement = (name, options) => ({ localName: String(name).toLowerCase(), namespaceURI: HTML, options });
  Document.prototype.createElementNS = (ns, name, options) => ({ localName: name, namespaceURI: ns, options });
  new Function('Document', CORS_IMG_SCRIPT.replace(/^<script>|<\/script>$/g, ''))(Document);
  const doc = new Document();
  assert.equal(doc.createElement('img').crossOrigin, 'anonymous');
  assert.equal(doc.createElement('IMG').crossOrigin, 'anonymous');
  assert.equal(doc.createElementNS(HTML, 'img').crossOrigin, 'anonymous', 'Preact makes its elements with createElementNS');
  assert.equal(doc.createElement('div').crossOrigin, undefined, 'only images');
  assert.equal(doc.createElementNS(SVG, 'img').crossOrigin, undefined, 'only HTML images');
  assert.equal(doc.createElementNS(SVG, 'image').crossOrigin, undefined);
  assert.deepEqual(doc.createElement('x-a', { is: 'x-b' }).options, { is: 'x-b' }, 'the arguments pass through');
  assert.deepEqual(doc.createElementNS(HTML, 'x-a', { is: 'x-b' }).options, { is: 'x-b' });
});

test('fontsCss: one @font-face for each face of the manifest, each file at the origin', () => {
  const css = fontsCss(MANIFEST, ASSET_ORIGIN);
  const faces = JSON.parse(MANIFEST).fonts.faces;
  assert.equal(css.split('@font-face {').length - 1, Object.keys(faces).length);
  for (const f of Object.values(faces)) {
    assert.ok(css.includes(`font-family: '${f.family}';`) && css.includes(`font-weight: ${f.weight};`), f.family);
    assert.ok(css.includes(`url('${ASSET_ORIGIN}${f.woff2}') format('woff2')`), f.woff2);
    assert.ok(css.includes(`url('${ASSET_ORIGIN}${f.original}')`), f.original);
  }
  assert.ok(!/url\('\//.test(css), 'no font file of the imprint itself');
  assert.equal(fontsCss(MANIFEST, null), EMPTY_FONTS_CSS, 'no origin: the empty stand-in');
  // a face the build cannot read stops it: nothing from the data goes into the stylesheet unchecked
  const face = (f) => JSON.stringify({ fonts: { faces: { x: { family: 'X', weight: 400, woff2: '/fonts/x.woff2', ...f } } } });
  assert.match(fontsCss(face({}), ASSET_ORIGIN), /font-family: 'X';/);
  assert.throws(() => fontsCss(face({ family: "X'; } body { display: none" }), ASSET_ORIGIN), /plain "family"/);
  assert.throws(() => fontsCss(face({ weight: 'bold' }), ASSET_ORIGIN), /integer "weight"/);
  assert.throws(() => fontsCss(face({ woff2: "/fonts/x.woff2') , url('https://other.example/x" }), ASSET_ORIGIN), /not a font file/);
  assert.throws(() => fontsCss(face({ woff2: '/fonts/x.exe' }), ASSET_ORIGIN), /not a font file/);
  assert.throws(() => fontsCss('{}', ASSET_ORIGIN), /no fonts\.faces/);
});

test('the full build is the server\'s URL layout as one folder, inside the limits of an imprint', { skip: !HAS_LIBS && 'client libraries not installed (npm install at the root and in aldus/)' }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-aldus-'));
  try {
    const r = await build({ out });
    const has = (rel) => fs.existsSync(path.join(out, rel));
    const read = (rel) => fs.readFileSync(path.join(out, rel), 'utf8');

    // the five places the server answers from
    for (const f of ['index.html', 'js/main.js', 'css/theme.css', 'data/chess.json', 'data/assets.json', 'shared/protocol.js', 'sim/Battle.js', 'sim/content/index.js', 'data.js']) assert.ok(has(f), f);
    const { DATA_SHIM_JS } = await import('../server/index.js');
    assert.equal(read('data.js'), DATA_SHIM_JS, '/data.js is the server\'s own shim');
    assert.equal(read('data/local-assets.json'), EMPTY_LOCAL_ART);
    // the art is not in the imprint: the manifest and the font stylesheet name the asset origin
    assert.equal(read('data/assets.json'), withAssetOrigin(MANIFEST, ASSET_ORIGIN));
    assert.equal(read('fonts/fonts.css'), fontsCss(MANIFEST, ASSET_ORIGIN));
    assert.equal(read('js/assets.js'), allowSpineOrigin(ASSETS_JS, ASSET_ORIGIN));
    // what the page does with the two: the built client finds a Spine model, an avatar and a sound for each unit that
    // the project's own client finds one for, and each address is at the asset origin
    const built = await import(pathToFileURL(path.join(out, 'js', 'assets.js')).href);
    const own = await import('../public/js/assets.js');
    const before = JSON.parse(MANIFEST);
    const after = JSON.parse(read('data/assets.json'));
    let models = 0;
    for (const id of [...Object.keys(before.chars), ...Object.keys(before.enemies), ...Object.keys(before.tokens)]) {
      for (const opts of [undefined, { back: true }]) {
        const a = own.spineEntry(before, id, opts);
        const b = built.spineEntry(after, id, opts);
        assert.equal(!!b, !!a, `${id}: a Spine model in the build when the project has one`);
        if (!a) continue;
        models++;
        assert.equal(b.skel, ASSET_ORIGIN + a.skel, id);
        assert.equal(b.atlas, ASSET_ORIGIN + a.atlas, id);
        assert.deepEqual(b.anims, a.anims, id);
      }
      assert.equal(built.unitPictureUrl(after, id), own.unitPictureUrl(before, id) && ASSET_ORIGIN + own.unitPictureUrl(before, id), `${id}: picture`);
    }
    assert.ok(models > 500, `${models} Spine models checked`);
    assert.equal(built.hasBackSpine(after, Object.keys(before.chars)[0]), own.hasBackSpine(before, Object.keys(before.chars)[0]));
    // every other data file is the project's own, byte for byte
    for (const f of fs.readdirSync(path.join(ROOT, 'data')).filter((n) => n.endsWith('.json') && !['assets.json', 'local-assets.json'].includes(n))) {
      assert.equal(read(`data/${f}`), fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'), `data/${f}`);
    }
    assert.equal(read('index.html'), injectI18n(injectCorsImages(transformEntry(ENTRY), ASSET_ORIGIN)));
    // the i18n runtime is a module in the head, so it runs before the game's module
    assert.ok(read('index.html').indexOf(I18N_TAG) < read('index.html').indexOf('src="/js/main.js"'));
    // and the image script is a classic script before both: it is there when the first image is made
    assert.ok(read('index.html').indexOf(CORS_IMG_SCRIPT) > 0 && read('index.html').indexOf(CORS_IMG_SCRIPT) < read('index.html').indexOf(I18N_TAG));
    for (const f of ['i18n/runtime.js', 'i18n/translator.js', 'i18n/catalog.js']) assert.ok(has(f), f);

    // what the server never serves, and what an imprint cannot hold
    for (const f of ['sim/nodeData.js', 'dev', 'assets', 'match', 'index.js', 'net.js', 'lobby.js']) assert.ok(!has(f), `${f} is not in the build`);
    assert.deepEqual(fs.readdirSync(path.join(out, 'fonts')), ['fonts.css'], 'the fonts folder holds the stylesheet only, no font file');
    assert.ok(fs.readdirSync(out).every((n) => !n.startsWith('_') && !n.startsWith('.')), 'no top-level "_" or dot name');

    // every module under sim/ is a file of server/sim, byte for byte
    for (const rel of fs.readdirSync(path.join(out, 'sim')).filter((n) => n.endsWith('.js'))) {
      assert.equal(read(`sim/${rel}`), fs.readFileSync(path.join(ROOT, 'server', 'sim', rel), 'utf8'), `sim/${rel}`);
    }

    // PixiJS + its patch, one file
    const pixi = read('vendor/pixi.min.js');
    assert.ok(pixi.startsWith(fs.readFileSync(path.join(ROOT, 'public', 'vendor', 'pixi.min.js'), 'utf8').trimEnd()));
    assert.match(pixi, /@pixi\/unsafe-eval - v7/);
    assert.ok(has('vendor/pixi-unsafe-eval.LICENSE.txt') && has('LICENSE.txt') && has('NOTICE.md') && has('THIRD-PARTY-NOTICES.md'));
    assert.match(read('robots.txt'), /Disallow: \//);

    // the contract
    assert.deepEqual(contractProblems(out).problems, []);
    assert.ok(r.files <= LIMITS.files && r.bytes <= LIMITS.bytes, `${r.files} files, ${r.bytes} bytes`);
    assert.ok(r.files < LIMITS.files / 2, 'room left: a build near the limit needs a look before it fails a deploy');

    // the project itself is untouched: the build writes into its own folder only
    assert.throws(() => contractProblems(path.join(out, 'nope')));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a build without an asset origin is the page without art', { skip: !HAS_LIBS && 'client libraries not installed' }, async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-aldus-'));
  try {
    await build({ out, assetOrigin: null });
    assert.equal(fs.readFileSync(path.join(out, 'data', 'assets.json'), 'utf8'), MANIFEST);
    assert.equal(fs.readFileSync(path.join(out, 'fonts', 'fonts.css'), 'utf8'), EMPTY_FONTS_CSS);
    assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), injectI18n(transformEntry(ENTRY)));
    assert.equal(fs.readFileSync(path.join(out, 'js', 'assets.js'), 'utf8'), ASSETS_JS);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('build refuses to empty a folder that holds the project', { skip: !HAS_LIBS && 'client libraries not installed' }, async () => {
  await assert.rejects(() => build({ out: ROOT }), /refusing to empty/);
  await assert.rejects(() => build({ out: path.dirname(ROOT) }), /refusing to empty/);
});

test('imprint.json builds with this script into dist, and lists every outside host of the page', () => {
  const imprint = JSON.parse(fs.readFileSync(path.join(HERE, 'imprint.json'), 'utf8'));
  assert.equal(imprint.build.command, 'node build.mjs');
  assert.equal(imprint.build.output, 'dist');
  assert.equal(imprint.entry, 'index.html');
  assert.deepEqual(imprint.blocks, [], 'no backend yet: the game server is not on this platform');
  // every https origin index.html loads from is allowed by the CSP (IMP-23); the w3.org namespace in the icon is no request
  const origins = new Set([...ENTRY.matchAll(/(?:href|src)="(https:\/\/[^/"]+)/g)].map((m) => m[1]));
  for (const o of origins) assert.ok(imprint.csp.hosts.includes(o), `${o} is in csp.hosts`);
  // and the origin of the art: without it the policy refuses each image, Spine file, sound and font
  assert.ok(imprint.csp.hosts.includes(ASSET_ORIGIN), `${ASSET_ORIGIN} is in csp.hosts`);
  assert.ok(imprint.csp.hosts.length <= 10);
  assert.ok(fs.readFileSync(path.join(HERE, '.gitignore'), 'utf8').split('\n').includes('dist/'), 'the output is never committed');
});
