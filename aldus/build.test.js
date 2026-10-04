// The Aldus imprint build (aldus/build.mjs): the entry page without inline event handlers, PixiJS patched for a CSP
// without 'unsafe-eval', the server's URL layout as one folder, and the limits of the imprint contract. The full build
// runs only where the client libraries are installed (`npm install` at the root and in aldus/); it skips otherwise,
// like the suites that need downloaded art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, LIMITS, KNOWN_HANDLERS, HANDLER_SCRIPT, EMPTY_LOCAL_ART,
  inlineHandlers, transformEntry, patchPixi, pixiVersion, contractProblems, build, injectI18n, I18N_TAG,
} from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const PATCH_DIR = path.join(HERE, 'node_modules', '@pixi', 'unsafe-eval');
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
    assert.equal(read('index.html'), injectI18n(transformEntry(ENTRY)));
    // the i18n runtime is a module in the head, so it runs before the game's module
    assert.ok(read('index.html').indexOf(I18N_TAG) < read('index.html').indexOf('src="/js/main.js"'));
    for (const f of ['i18n/runtime.js', 'i18n/translator.js', 'i18n/catalog.js']) assert.ok(has(f), f);

    // what the server never serves, and what an imprint cannot hold
    for (const f of ['sim/nodeData.js', 'dev', 'assets', 'match', 'index.js', 'net.js', 'lobby.js']) assert.ok(!has(f), `${f} is not in the build`);
    assert.deepEqual(fs.readdirSync(path.join(out, 'fonts')), ['fonts.css'], 'the fonts folder holds the empty stand-in only');
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
  assert.ok(imprint.csp.hosts.length <= 10);
  assert.ok(fs.readFileSync(path.join(HERE, '.gitignore'), 'utf8').split('\n').includes('dist/'), 'the output is never committed');
});
