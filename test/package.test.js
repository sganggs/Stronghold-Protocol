import { PACKAGE_SERVER } from './helpers/packageServer.js';
// test/package.test.js — tools/package.mjs, the player release zips (docs/DEPLOY.md §7). No network, no npm install, no
// zip of the repository: the selection rules on sample paths and on the real `git ls-files`, then the packager itself
// (--dry-run, the scans and guards, one --no-install build) on a small temporary git checkout with fake art.
// Run: node --test test/package.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_PACK_README, AUTHOR_TEST_FILES, FOLDER, REFUSE, RUNTIME_RESEARCH, assetPackName, assetPackPlan, assetPackReadme, entryProblems,
  importableArt, isRefused, packageOutIsUnsafe, parseArgs, plan, playerPackageJson, rewritePlayerDoc, resolveSpecifier, scanFiles,
  selectTracked,
} from '../tools/package.mjs';
import { hash16 } from '../server/http/assetIndex.js';
import { rewriteManifest } from '../server/http/assetViews.js';
import { IMPORTED_ASSET_CACHE } from '../public/js/assetCache.js';
import { createAssetImport } from '../public/js/assetPack.js';

// a fake home path, built at run time so the repository never contains one (the local push guard scans every patch)
const FAKE_HOME = ['', 'Users', 'someone'].join('/');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'package.mjs');

test('all install and favicon assets ship independently of optional game art', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.json'), 'utf8'));
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const urls = [...manifest.icons.map((i) => i.src),
    ...[...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]+href="([^"]+)"/g)].map((m) => m[1])];
  const files = [...new Set(['public/manifest.json', ...urls.map((url) => `public${url}`),
    ...[16, 32, 48].map((size) => `public/icons/favicon-${size}.png`)])].sort();
  for (const f of files) assert.ok(fs.statSync(path.join(ROOT, f)).size > 0, f);
  assert.deepEqual(selectTracked([...files, 'tools/export-app-icons.py', 'handoff/claude-review-023/icon/light.png']).keep,
    files, 'full and lite share the same tracked static-file allowlist');
});
// hermetic scans: not this machine's account name, but a planted one
const ENV = { SP_PACKAGE_SCAN_USER: '0', SP_PACKAGE_SCAN_NAMES: 'plantedname' };

test('selection: runtime files in; tests, maintainer tools, other docs, dev pages, private and config files out', () => {
  const { keep, drop } = selectTracked([
    'server/index.js', 'server/sim/rng.js', 'shared/constants.js', 'public/index.html', 'public/js/main.js', 'public/i18n/en.json',
    'data/chess.json', 'data/i18n/en.json', 'tools/setup.mjs', 'tools/vendor.mjs', 'tools/fetch-assets.mjs', 'tools/doctor.mjs',
    'tools/crop-board-atlas.mjs', 'tools/assets/plan.mjs', 'tools/assets/local-enemy-spines.json', 'tools/assets/local-token-spines.json',
    'tools/local-extract/extract.py',
    'tools/local-extract/LICENSE-Ark-Unpacker.txt', 'scripts/start.sh', 'scripts/start-windows.bat', 'scripts/start-windows-sandbox.bat', 'scripts/launch.mjs',
    'scripts/install-service-windows.ps1', 'docs/PLAYING.md', 'docs/DEPLOY.md', ...RUNTIME_RESEARCH, 'package.json',
    'package-lock.json', 'LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'README.md', 'CHANGELOG.md',
    // out
    'test/version.test.js', 'tools/golden.mjs', 'tools/build-data.mjs', 'tools/check-imports.mjs', 'tools/package.mjs',
    'tools/i18n/fallback-remake.json', 'scripts/make-windows-bundle.mjs', 'docs/DESIGN.md', 'docs/WINDOWS.md', 'docs/ASSETS.md',
    'docs/img/combat.jpg', 'docs/research/00-INDEX.md', 'docs/research/01-core-data.json', 'docs/research/03-operators.md',
    'docs/research/10-networking-hosting.md', 'public/dev/game-mock.html', 'public/assets/x.png', 'public/fonts/fonts.css',
    'public/vendor/pixi.min.js', 'data/local-assets.json', 'handoff/HANDOFF.md', '.github/workflows/ci.yml', 'types/core.js',
    'eslint.config.js', 'jsconfig.json', 'Dockerfile', '.dockerignore', '.gitignore', '.gitattributes', 'AGENTS.md', '.env',
    'server/.env.production', 'pv/clip.mp4', '3，9，11回合情况/note.txt', 'review/a.md', '.cache/x', 'server/__pycache__/a.pyc',
    'public/.DS_Store', 'tools/local-extract/.venv-extract/x.py', 'node_modules/ws/index.js',
  ]);
  for (const f of ['server/index.js', 'public/i18n/en.json', 'data/i18n/en.json', 'tools/assets/local-enemy-spines.json',
    'tools/assets/local-token-spines.json', 'tools/local-extract/LICENSE-Ark-Unpacker.txt', 'scripts/install-service-windows.ps1', 'scripts/start-windows-sandbox.bat',
    'docs/research/07-assets.json', 'CHANGELOG.md']) {
    assert.ok(keep.includes(f), `keeps ${f}`);
  }
  assert.equal(keep.length, 36, keep.join(' '));
  assert.equal(drop.length, 40, drop.join(' '));
  assert.ok(!keep.some((f) => drop.includes(f)));
});

test('refusal list: 0.1.x\'s entries and what 0.2.0 leaves out, at the path or under it; .env and .venv anywhere', () => {
  for (const r of ['pv', '3，9，11回合情况', 'review', 'docs/research/10-networking-hosting.md', '.cache', '.claude', '.git', 'logs',
    'test/e2e/out', 'scripts/service.env.cmd', '.env', 'handoff', 'test', '.github']) assert.ok(REFUSE.includes(r), r);
  for (const r of REFUSE) {
    assert.ok(isRefused(r), r);
    assert.ok(isRefused(`${r}/x`), `${r}/x`);
  }
  for (const p of ['data/.env', 'server/.env.local', '.venv-extract/lib/a.py', 'tools/.venv/x']) assert.ok(isRefused(p), p);
  for (const p of ['server/index.js', 'docs/research/03-operators.json', 'testing.md', 'public/js/review.js']) assert.ok(!isRefused(p), p);
});

test('the real tracked tree: runtime in, the rest out; every shipped import, npm entry point, research table and spawned tool ships', () => {
  const p = plan(ROOT, { lite: true, allowDirty: true, scan: false, measure: false });
  assert.deepEqual(p.problems, []);
  const got = new Set(p.files);
  for (const f of ['server/index.js', 'tools/setup.mjs', 'tools/fetch-assets.mjs', 'scripts/start.sh', 'docs/PLAYING.md', 'docs/DEPLOY.md',
    'package-lock.json', 'NOTICE.md', ...RUNTIME_RESEARCH]) assert.ok(got.has(f), f);
  for (const f of ['tools/golden.mjs', 'tools/package.mjs', 'scripts/make-windows-bundle.mjs', 'docs/DESIGN.md', 'eslint.config.js', 'Dockerfile']) {
    assert.ok(!got.has(f), f);
  }
  // the design document (the index docs/DESIGN.md and its parts in docs/design/, docs/history/) stays out too
  for (const f of got) if (!AUTHOR_TEST_FILES.includes(f)) assert.ok(!/^(?:test|handoff|\.github|types|public\/dev|docs\/img|docs\/design|docs\/history)\//.test(f), f);
  const code = [...got].filter((f) => /\.(?:m?js|py)$/.test(f));
  for (const f of code) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // research tables named in shipped code (nodeData.js, fetch-assets.mjs, plan.mjs …)
    for (const m of src.matchAll(/\b(\d\d-[a-z-]+\.json)\b/g)) assert.ok(got.has(`docs/research/${m[1]}`), `${f} names ${m[1]}`);
    // files a shipped script starts or reads by path.join(ROOT, 'dir', …, 'file.ext') — setup's tools, launch's setup
    for (const m of src.matchAll(/path\.join\(ROOT,\s*((?:'[^']+',\s*)*'[^']+\.[a-z]+')\)/g)) {
      const rel = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).join('/');
      if (/^(?:tools|scripts|server|shared|docs)\//.test(rel)) assert.ok(got.has(rel), `${f} starts ${rel}`);
    }
  }
});

test('import specifiers resolve like the server mounts; npm entry points must ship', () => {
  assert.equal(resolveSpecifier('public/js/ui/a.js', '../b.js'), 'public/js/b.js');
  assert.equal(resolveSpecifier('public/js/a.js', '/sim/battle.js?v=2'), 'server/sim/battle.js');
  assert.equal(resolveSpecifier('public/js/a.js', '/shared/constants.js'), 'shared/constants.js');
  assert.equal(resolveSpecifier('public/js/a.js', '/js/store.js'), 'public/js/store.js');
  assert.equal(resolveSpecifier('server/a.js', 'node:fs'), null);
  assert.equal(resolveSpecifier('server/a.js', 'ws'), null);
  const pkg = { main: 'server/index.js', scripts: { start: 'node server/index.js', setup: 'node tools/setup.mjs', doctor: 'node tools/golden.mjs',
    launch: 'node scripts/launch.mjs', postinstall: 'node tools/vendor.mjs', vendor: 'node tools/vendor.mjs', assets: 'node tools/vendor.mjs && node tools/fetch-assets.mjs' } };
  const shipped = ['server/index.js', 'tools/setup.mjs', 'scripts/launch.mjs', 'tools/vendor.mjs', 'tools/fetch-assets.mjs'];
  assert.deepEqual(entryProblems(pkg, shipped), ['npm run doctor: tools/golden.mjs is not shipped']);
  assert.deepEqual(entryProblems({ ...pkg, scripts: { ...pkg.scripts, doctor: undefined } }, shipped), ['npm script "doctor" is missing']);
});

test('output directory: never the repository, inside it or a parent of it', () => {
  assert.equal(packageOutIsUnsafe(ROOT, ROOT), true);
  assert.equal(packageOutIsUnsafe(path.dirname(ROOT), ROOT), true);
  assert.equal(packageOutIsUnsafe(path.join(ROOT, 'dist'), ROOT), true);
  assert.equal(packageOutIsUnsafe(path.join(os.tmpdir(), 'sp-release'), ROOT), false);
});

// ---------------------------------------------------------------------------------------------------------------------
// A temporary checkout: tracked runtime and non-runtime files, git-ignored fake art (one listed file with a URL-encoded
// name, an orphan like 焰狐龙梓兰's old files, the local-client extraction, fonts, OS clutter), private files.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

function fakeCheckout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-package-test-'));
  const put = (rel, body = `// ${rel}\n`) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  const scripts = { start: 'node server/index.js', setup: 'node tools/setup.mjs', doctor: 'node tools/doctor.mjs', launch: 'node scripts/launch.mjs',
    postinstall: 'node tools/vendor.mjs', vendor: 'node tools/vendor.mjs', assets: 'node tools/vendor.mjs && node tools/fetch-assets.mjs',
    test: 'node --test', golden: 'node tools/golden.mjs', package: 'node tools/package.mjs' };
  put('package.json', JSON.stringify({ name: 'sp-test', version: '9.9.9', main: 'server/index.js', scripts, dependencies: {} }));
  put('package-lock.json', JSON.stringify({ name: 'sp-test', version: '9.9.9', lockfileVersion: 3, packages: { '': { name: 'sp-test' } } }));
  put('server/index.js', PACKAGE_SERVER);
  put('server/sim/rng.js');
  put('shared/constants.js');
  put('public/index.html', '<!doctype html>\n');
  put('public/js/main.js', "import { u } from './util.js';\nimport { h } from '../vendor/preact.module.js';\n");
  put('public/js/util.js', 'export const u = 1;\n');
  put('public/dev/mock.js');
  put('data/chess.json', '{}\n');
  put('data/assets.json', JSON.stringify({ chars: { a: { avatar: '/assets/char/a.png' } }, ui: { b: '/assets/ui/b%20c.png' }, fonts: { css: '/fonts/fonts.css' } }));
  put('tools/setup.mjs', "import { n } from './assets/network.mjs';\n");
  for (const f of ['tools/assets/network.mjs', 'tools/vendor.mjs', 'tools/fetch-assets.mjs', 'tools/doctor.mjs', 'tools/crop-board-atlas.mjs',
    'tools/local-extract/extract.py', 'tools/golden.mjs', 'tools/build-data.mjs', 'tools/package.mjs', 'scripts/launch.mjs',
    'scripts/make-windows-bundle.mjs', 'test/a.test.js', 'handoff/HANDOFF.md', '.github/workflows/ci.yml', 'types/core.js', 'eslint.config.js',
    'Dockerfile', 'AGENTS.md', 'review/notes.md', 'docs/DESIGN.md', 'docs/research/00-INDEX.md', 'docs/research/10-networking-hosting.md']) put(f);
  put('scripts/start.sh', '#!/usr/bin/env bash\nexec node scripts/launch.mjs\n');
  fs.chmodSync(path.join(dir, 'scripts/start.sh'), 0o755);
  for (const f of ['README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'docs/PLAYING.md', 'docs/DEPLOY.md']) put(f, `# ${f}\n`);
  for (const f of [...RUNTIME_RESEARCH, 'docs/research/01-core-data.json']) put(f, '{}\n');
  put('docs/img/x.jpg', PNG);
  put('.gitignore', 'public/assets/\npublic/fonts/\npublic/vendor/\ndata/local-assets.json\n.cache/\npv/\n');
  // git-ignored: the art, the local extraction, fonts, caches, the promo folder
  put('public/assets/char/a.png', PNG);
  put('public/assets/ui/b c.png', PNG);
  put('public/assets/char/char_1048_orchd2.png', PNG);
  put('public/assets/local/g/x.webp', PNG);
  put('public/assets/local/g/x.png', PNG);
  put('public/assets/local/spine/token/token_x/token_x.skel', 'skel');   // a token model only the local client has (0.2.0)
  put('public/assets/.DS_Store', 'junk');
  put('public/fonts/fonts.css', '@font-face{}\n');
  put('public/fonts/x.woff2', PNG);
  put('data/local-assets.json', JSON.stringify({ version: 1, groups: { g: { x: { path: '/assets/local/g/x.webp' } },
    'spine/token/token_x': { 'token_x.skel': { path: '/assets/local/spine/token/token_x/token_x.skel' } } } }));
  put('.cache/assets-report.json', '{}');
  put('pv/clip.txt', 'promo');
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  assert.equal(git('add', '-A').status, 0);
  return { dir, put, rm: (rel) => fs.rmSync(path.join(dir, rel), { force: true }) };
}

const runTool = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env: { ...process.env, ...ENV }, maxBuffer: 16 * 1024 * 1024 });
const listed = (stdout) => stdout.split('\n').filter((l) => l.startsWith('file ')).map((l) => l.slice(5));

const SHIPPED_TRACKED = ['CHANGELOG.md', 'LICENSE', 'NOTICE.md', 'README.md', 'THIRD-PARTY-NOTICES.md', 'data/assets.json', 'data/chess.json',
  'docs/DEPLOY.md', 'docs/PLAYING.md', ...RUNTIME_RESEARCH, 'package-lock.json', 'package.json', 'public/index.html', 'public/js/main.js',
  'public/js/util.js', 'scripts/launch.mjs', 'scripts/start.sh', 'server/index.js', 'server/sim/rng.js', 'shared/constants.js',
  'tools/assets/network.mjs', 'tools/crop-board-atlas.mjs', 'tools/doctor.mjs', 'tools/fetch-assets.mjs', 'tools/local-extract/extract.py',
  'tools/setup.mjs', 'tools/vendor.mjs', 'server/release-without-llm'].sort();
const ART = ['data/local-assets.json', 'public/assets/char/a.png', 'public/assets/local/g/x.png', 'public/assets/local/g/x.webp',
  'public/assets/local/spine/token/token_x/token_x.skel', 'public/assets/ui/b c.png', 'public/fonts/fonts.css', 'public/fonts/x.woff2'];

test('dry-run on a temporary checkout: the full and the lite file lists, the summary, nothing written', () => {
  const { dir } = fakeCheckout();
  try {
    const before = fs.readdirSync(dir).sort();
    const full = runTool(['--root', dir, '--dry-run', '--list', '--allow-dirty']);
    assert.equal(full.status, 0, full.stdout + full.stderr);
    assert.deepEqual(listed(full.stdout).sort(), [...SHIPPED_TRACKED, ...ART].sort());
    assert.match(full.stdout, /^package: full · version 9\.9\.9$/m);
    assert.match(full.stdout, /^left out art: 1 files under public\/assets that nothing lists/m, 'the orphan (an excluded operator\'s old file)');
    assert.match(full.stdout, /^left out: .*test\/ 1 .*$/m);
    assert.match(full.stdout, /^checks: ok$/m);
    const lite = runTool(['--root', dir, '--dry-run', '--list', '--lite', '--allow-dirty']);
    assert.equal(lite.status, 0, lite.stdout + lite.stderr);
    assert.deepEqual(listed(lite.stdout).sort(), SHIPPED_TRACKED, 'lite: the same runtime files, no art, fonts or local manifest');
    assert.match(lite.stdout, /^package: lite \(no game art\)/m);
    assert.deepEqual(fs.readdirSync(dir).sort(), before, 'a dry-run writes nothing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scans and guards: home paths and the account name in shipped files (art too), missing art, a stray import, uncommitted files', () => {
  const { dir, put, rm } = fakeCheckout();
  const check = (opts = {}) => plan(dir, { allowDirty: true, env: ENV, ...opts }).problems;
  try {
    assert.deepEqual(check(), []);
    assert.deepEqual(check({ lite: true }), []);
    put('public/js/util.js', `export const u = "${FAKE_HOME}/game";\n`);
    assert.deepEqual(check(), ['personal info: public/js/util.js (home-directory path)']);
    put('public/js/util.js', 'export const u = 1;\n');
    put('data/chess.json', '{"p": "C:\\\\Users\\\\Someone\\\\x"}\n');
    assert.deepEqual(check({ lite: true }), ['personal info: data/chess.json (home-directory path)'], 'Windows path, JSON-escaped');
    put('data/chess.json', '{}\n');
    put('public/assets/char/a.png', Buffer.concat([PNG, Buffer.from('..PlantedName..')]));
    assert.deepEqual(check(), ['personal info: public/assets/char/a.png (account name)'], 'binary art, any case');
    assert.deepEqual(check({ lite: true }), [], 'the lite zip has no art');
    put('public/assets/char/a.png', PNG);
    put('test/a.test.js', `// ${FAKE_HOME} plantedname\n`);
    assert.deepEqual(check(), [], 'files that never ship are not scanned');
    rm('public/assets/ui/b c.png');
    assert.match(check().join('\n'), /^missing art: public\/assets\/ui\/b c\.png/);
    assert.deepEqual(check({ lite: true }), []);
    put('public/assets/ui/b c.png', PNG);
    put('public/js/main.js', "import { u } from './util.js';\nimport '../dev/mock.js';\n");
    assert.deepEqual(check({ lite: true }), ['public/js/main.js:2 imports ../dev/mock.js (not shipped)']);
    assert.ok(plan(dir, { lite: true, env: ENV, scan: false }).problems.some((x) => x.startsWith('uncommitted change: server/index.js')),
      'staged, never committed: refused without --allow-dirty');
    const cli = runTool(['--root', dir, '--dry-run', '--lite', '--allow-dirty']);
    assert.equal(cli.status, 1, 'a problem fails the dry-run');
    assert.match(cli.stdout, /^PROBLEMS \(1\):\n {2}public\/js\/main\.js:2 imports \.\.\/dev\/mock\.js/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// tools/package.mjs zips with `zip`, else with a bsdtar `tar --format zip` (Windows 10+, macOS; GNU tar cannot)
const hasZipTool = !spawnSync('zip', ['-v'], { encoding: 'utf8' }).error
  || /bsdtar/.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout || '');
const hasUnzip = !spawnSync('unzip', ['-h'], { encoding: 'utf8' }).error;

test('a --no-install build of the temporary checkout zips exactly the plan in one Stronghold-Protocol/ folder', { skip: !hasZipTool && 'no zip / tar' }, () => {
  const { dir } = fakeCheckout();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-package-out-'));
  try {
    const r = runTool(['--root', dir, '--out', out, '--no-install', '--allow-dirty']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const zip = path.join(out, `${FOLDER}-v9.9.9.zip`);
    assert.ok(fs.statSync(zip).size > 0);
    assert.deepEqual(fs.readdirSync(out).sort(), [path.basename(zip), `${path.basename(zip)}.smoke.log`], 'only the archive and smoke log remain');
    if (hasUnzip) {
      const entries = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l && !l.endsWith('/'));
      // and MANIFEST.json, written after npm ci (server/update.js; test/update-package.test.js checks its content)
      assert.deepEqual(entries.sort(), [...SHIPPED_TRACKED, ...ART, 'MANIFEST.json'].map((f) => `${FOLDER}/${f}`).sort());
    }
    const again = runTool(['--root', dir, '--out', out, '--no-install', '--allow-dirty']);
    assert.equal(again.status, 1, 'an existing zip is not replaced without --force');
    assert.match(again.stderr, /already exists \(--force replaces it\)/);
    const inRepo = runTool(['--root', dir, '--out', path.join(dir, 'dist'), '--no-install', '--allow-dirty', '--lite']);
    assert.equal(inRepo.status, 1);
    assert.match(inRepo.stderr, /refusing to write into the repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('content packs ship: every committed pack of both layouts, never one only on this machine; the stage gets packs/index.json listing exactly them', { skip: !hasZipTool && 'no zip / tar' }, () => {
  const { dir, put } = fakeCheckout();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-package-out-'));
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    const PACK_FILES = ['public/i18n/en.json', 'public/i18n/qaa.json', 'data/i18n/qaa.json', 'packs/README.md', 'packs/qab/pack.json', 'packs/qab/ui.json'];
    put('public/i18n/en.json', JSON.stringify({ _meta: { name: 'English', complete: true }, 开始: 'Start' }));
    put('public/i18n/qaa.json', JSON.stringify({ _meta: { name: 'Qaa', fallback: ['en'] }, 开始: 'Los' }));
    put('data/i18n/qaa.json', JSON.stringify({ version: 1, lang: 'qaa', names: {}, files: {} }));
    put('packs/README.md', '# packs\n');
    put('packs/qab/pack.json', JSON.stringify({ type: 'lang', lang: 'qab', name: 'Qab', files: { ui: 'ui.json' } }));
    put('packs/qab/ui.json', JSON.stringify({ 开始: 'Q' }));
    assert.equal(git('add', ...PACK_FILES).status, 0);
    // installed here, never committed: stays out; a stale index on disk is never shipped as it is
    put('packs/local/pack.json', JSON.stringify({ type: 'lang', lang: 'qac', files: { ui: 'ui.json' } }));
    put('packs/local/ui.json', JSON.stringify({ 开始: 'L' }));
    put('packs/index.json', '{ "stale": true }\n');
    const dry = runTool(['--root', dir, '--dry-run', '--list', '--lite', '--allow-dirty']);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.deepEqual(listed(dry.stdout).sort(), [...SHIPPED_TRACKED, ...PACK_FILES, 'packs/index.json'].sort());
    assert.match(dry.stdout, /^generated: packs\/index\.json, server\/release-without-llm \(the pack index of the shipped packs, for a static host; the release marker that keeps external AI off the package\)$/m);
    const r = runTool(['--root', dir, '--out', out, '--no-install', '--allow-dirty', '--lite', '--keep-stage']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const stage = path.join(out, `${FOLDER}-v9.9.9-lite`, FOLDER);
    const index = JSON.parse(fs.readFileSync(path.join(stage, 'packs/index.json'), 'utf8'));
    assert.deepEqual(index.packs.map((x) => [x.id, x.type, x.files]), [
      ['en', 'lang', { ui: '/i18n/en.json' }],
      ['qaa', 'lang', { ui: '/i18n/qaa.json', data: '/data/i18n/qaa.json' }],
      ['qab', 'lang', { ui: '/packs/qab/ui.json' }],
    ]);
    assert.ok(!fs.existsSync(path.join(stage, 'packs/local')), 'a pack only on this machine is not in the zip');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the stage drops dishonest npm scripts and rewrites unshipped doc links', { skip: !hasZipTool && 'no zip / tar' }, () => {
  const { dir, put } = fakeCheckout();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-package-out-'));
  const readme = '# r\n\n[design](docs/DESIGN.md)\n[play](docs/PLAYING.md)\n[rel](../../releases/latest)\n![shot](docs/img/x.jpg)\n';
  try {
    put('README.md', readme);
    put('docs/PLAYING.md', '# p\n\n[idx](research/00-INDEX.md)\n[home](../README.md#操作)\n');
    put('docs/DEPLOY.md', '# d\n\n[packs](PACKS.md)\n[win](WINDOWS.md)\n[notice](../NOTICE.md)\n');
    const r = runTool(['--root', dir, '--out', out, '--no-install', '--allow-dirty', '--lite', '--keep-stage']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const stage = path.join(out, `${FOLDER}-v9.9.9-lite`, FOLDER);
    const stagedPkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
    assert.deepEqual(Object.keys(stagedPkg.scripts).sort(), ['assets', 'doctor', 'launch', 'postinstall', 'setup', 'start', 'vendor']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts.test, 'node --test');
    const host = 'https://github.com/sganggs/Stronghold-Protocol';
    const got = fs.readFileSync(path.join(stage, 'README.md'), 'utf8');
    assert.equal(got, `# r\n\n[design](${host}/blob/v9.9.9/docs/DESIGN.md)\n[play](docs/PLAYING.md)\n[rel](${host}/releases/latest)\n![shot](${host}/raw/v9.9.9/docs/img/x.jpg)\n`);
    assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), readme, 'the git checkout keeps its relative links');
    const playing = fs.readFileSync(path.join(stage, 'docs/PLAYING.md'), 'utf8');
    assert.match(playing, new RegExp(`\\(${host}/blob/v9.9.9/docs/research/00-INDEX.md\\)`));
    assert.match(playing, /\(\.\.\/README\.md#操作\)/);
    const deploy = fs.readFileSync(path.join(stage, 'docs/DEPLOY.md'), 'utf8');
    assert.match(deploy, new RegExp(`\\(${host}/blob/v9.9.9/docs/PACKS.md\\)`));
    assert.match(deploy, new RegExp(`\\(${host}/blob/v9.9.9/docs/WINDOWS.md\\)`));
    assert.match(deploy, /\(\.\.\/NOTICE\.md\)/);
    const shipped = new Set(plan(dir, { lite: true, allowDirty: true, scan: false, measure: false }).tracked);
    assert.equal(rewritePlayerDoc(readme, 'README.md', shipped, '9.9.9'), got);
    assert.equal(playerPackageJson(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')), shipped).scripts.test, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the personal scan reads bytes, never reports the matched text, and skips files it cannot read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-package-scan-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.bin'), Buffer.from([0, 1, 2, ...Buffer.from('/home/someone'), 3]));
    fs.writeFileSync(path.join(dir, 'b.txt'), `see https://github.com/${'users'}/x and /usr/lib`);
    fs.writeFileSync(path.join(dir, 'c.txt'), 'Built by PLANTEDNAME');
    assert.deepEqual(scanFiles(dir, ['a.bin', 'b.txt', 'c.txt', 'missing.txt'], { names: ['plantedname'] }),
      ['a.bin (home-directory path)', 'c.txt (account name)']);
    assert.deepEqual(scanFiles(dir, ['a.bin', 'c.txt'], { home: false, names: [] }), [], 'node_modules: the names only');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// --assets: the example asset pack for the title screen's 导入素材包 (docs/history/0.3.0.md §32.14.39). The selection is
// the importer's own plan of the served manifests; the built zip goes through the real importer (assetPack.js) below.

test('importableArt: what the import checks — files, whole Spine models with their default page, local groups and effects; nothing it skips', () => {
  const art = importableArt({
    chars: { a: { avatar: '/assets/char/a.png', front: { skel: '/assets/spine/a/a.skel', atlas: '/assets/spine/a/a.atlas', textures: ['/assets/spine/a/a.png', '/assets/spine/a/a_2.png'] } } },
    tokens: { t: { skel: '/assets/spine/t/t.skel', atlas: '/assets/spine/t/t.atlas' } },   // no textures: the default t.png counts
    ui: { b: '/assets/ui/b%20c.png', q: '/assets/ui/q.png?v=2', dots: '/assets/ui/../x.png', remote: 'https://cdn.test/assets/y.png' },
    audio: { bgm: '/assets/audio/bgm/a.mp3' },
    fonts: { css: '/fonts/fonts.css' },
  }, {
    version: 1, stray: '/assets/local/stray.png',                                   // outside groups: the importer never reads it
    groups: {
      'spine/token/x': { 'x.skel': { path: '/assets/local/spine/x/x.skel' }, 'x.atlas': { path: '/assets/local/spine/x/x.atlas' } },
      scene: { a: { path: '/assets/local/scene/a/scene.bin' } },
    },
  }, { format: 'fx-manifest', groups: { 'fx/tex': { t: { path: '/assets/local/fx/tex/t.webp' } } } });
  assert.deepEqual(art, [
    'public/assets/audio/bgm/a.mp3', 'public/assets/char/a.png',
    'public/assets/local/fx/tex/t.webp', 'public/assets/local/scene/a/scene.bin',
    'public/assets/local/spine/x/x.atlas', 'public/assets/local/spine/x/x.skel',
    'public/assets/spine/a/a.atlas', 'public/assets/spine/a/a.png', 'public/assets/spine/a/a.skel', 'public/assets/spine/a/a_2.png',
    'public/assets/spine/t/t.atlas', 'public/assets/spine/t/t.png', 'public/assets/spine/t/t.skel',
    'public/assets/ui/b c.png', 'public/fonts/fonts.css',
  ]);
  assert.deepEqual(importableArt(null, null, null), []);
});

/** fakeCheckout() plus what the asset pack looks at: an effects manifest, a model without textures, leftovers no manifest lists. */
function assetCheckout() {
  const co = fakeCheckout();
  const assets = JSON.parse(fs.readFileSync(path.join(co.dir, 'data/assets.json'), 'utf8'));
  assets.tokens = { t: { skel: '/assets/spine/t/t.skel', atlas: '/assets/spine/t/t.atlas' } };
  co.put('data/assets.json', JSON.stringify(assets));
  co.put('public/assets/spine/t/t.skel', 'token-skel');
  co.put('public/assets/spine/t/t.atlas', 't.png\nsize: 1,1\n');
  co.put('public/assets/spine/t/t.png', Buffer.concat([PNG, Buffer.from('t')]));
  co.put('data/local-fx.json', JSON.stringify({ version: 1, format: 'fx-manifest', groups: { 'fx/prefabs': { hit: { path: '/assets/local/fx/prefabs/hit.json' } } } }));
  co.put('public/assets/local/fx/prefabs/hit.json', '{"hit":1}');
  co.put('public/assets/local/fx/prefabs/unused.json', '{"old":1}');                  // extracted, not listed
  const git = (...args) => spawnSync('git', ['-C', co.dir, ...args], { encoding: 'utf8' });
  assert.equal(git('add', 'data/assets.json').status, 0);
  assert.equal(git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'fake').status, 0);
  return co;
}

const PACK_ART = ['public/assets/char/a.png', 'public/assets/local/fx/prefabs/hit.json', 'public/assets/local/g/x.webp',
  'public/assets/local/spine/token/token_x/token_x.skel', 'public/assets/spine/t/t.atlas', 'public/assets/spine/t/t.png',
  'public/assets/spine/t/t.skel', 'public/assets/ui/b c.png', 'public/fonts/fonts.css'];

test('asset pack plan: the listed art with the effects and the default page; manifests, leftovers and unlisted fonts stay out', () => {
  const { dir, put, rm } = assetCheckout();
  try {
    const p = assetPackPlan(dir, { env: ENV });
    assert.deepEqual(p.problems, []);
    assert.equal(p.name, 'Stronghold-Protocol-v9.9.9-assets');
    assert.equal(assetPackName('0.3.0'), 'Stronghold-Protocol-v0.3.0-assets');
    assert.deepEqual(p.files, PACK_ART);
    assert.deepEqual(p.notListed, ['public/assets/local/fx/prefabs/unused.json', 'public/assets/local/g/x.png', 'public/fonts/x.woff2'],
      'the full zip ships them; the import would skip them');
    assert.ok(!p.files.some((f) => f.startsWith('data/')), 'the browser reads the host\'s manifests, never the pack\'s');
    assert.equal(p.scanned, p.files.length);
    assert.deepEqual(assetPackPlan(dir, { env: ENV, fx: false, scan: false }).files, PACK_ART.filter((f) => !f.includes('/fx/')), 'FULL_ZIP_FX off');
    const noJp = assetPackPlan(dir, { env: ENV, scan: false, jpVoice: false });
    assert.deepEqual(noJp.held, []);
    // the checks: missing art, personal info in art, an uncommitted manifest
    rm('public/assets/spine/t/t.png');
    assert.match(assetPackPlan(dir, { env: ENV }).problems.join('\n'), /^missing art: public\/assets\/spine\/t\/t\.png/);
    put('public/assets/spine/t/t.png', Buffer.concat([PNG, Buffer.from('..PlantedName..')]));
    assert.deepEqual(assetPackPlan(dir, { env: ENV }).problems, ['personal info: public/assets/spine/t/t.png (account name)']);
    put('public/assets/spine/t/t.png', Buffer.concat([PNG, Buffer.from('t')]));
    put('data/assets.json', `${fs.readFileSync(path.join(dir, 'data/assets.json'), 'utf8')}\n`);
    assert.deepEqual(assetPackPlan(dir, { env: ENV, scan: false }).problems,
      ['uncommitted change: data/assets.json (the pack must match the released manifest: commit it, or --allow-dirty)']);
    assert.deepEqual(assetPackPlan(dir, { env: ENV, scan: false, allowDirty: true }).problems, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--assets: a dry run lists the pack and writes nothing; it never combines with --lite or --update', () => {
  const { dir } = assetCheckout();
  try {
    const before = fs.readdirSync(dir).sort();
    const dry = runTool(['--root', dir, '--assets', '--dry-run', '--list']);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.deepEqual(listed(dry.stdout), [...PACK_ART, ASSET_PACK_README]);
    assert.match(dry.stdout, /^asset pack: Stronghold-Protocol-v9\.9\.9-assets\.zip · version 9\.9\.9/m);
    assert.match(dry.stdout, /^left out: 3 files the full zip ships from public\/ that no manifest lists/m);
    assert.match(dry.stdout, /^checks: ok$/m);
    assert.deepEqual(fs.readdirSync(dir).sort(), before, 'a dry-run writes nothing');
    for (const bad of [['--assets', '--lite'], ['--assets', '--update', '--from', dir]]) {
      assert.throws(() => parseArgs(bad), /--assets builds the asset pack alone/);
      assert.equal(runTool(['--root', dir, ...bad, '--dry-run']).status, 2);
    }
    assert.equal(parseArgs(['--assets']).assets, true);
    assert.equal(parseArgs([]).assets, false, 'the normal modes are unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the README names the version, the manifests it matches, how to import, and the notice', () => {
  const text = assetPackReadme({ version: '0.3.0', files: ['a', 'b'], bytes: { art: 3 * 1048576 }, local: true, fx: true });
  assert.ok(text.startsWith('\ufeff卫戍协议：盟约 v0.3.0 素材包\n'), 'UTF-8 with a BOM');
  for (const s of ['data/assets.json、data/local-assets.json、data/local-fx.json', '「导入素材包」', '「选择 zip」', '「跳过 1 个」',
    'HTTPS', 'localhost', '"Import asset pack"', 'files that version does not list are skipped', '2 files (3.0 MB)',
    'https://github.com/sganggs/Stronghold-Protocol/blob/v0.3.0/NOTICE.md']) assert.ok(text.includes(s), s);
  const dev = assetPackReadme({ version: '0.3.1-dev', files: [], bytes: { art: 0 }, local: false, fx: false });
  assert.ok(dev.includes('/blob/v0.3.1/NOTICE.md') && !dev.includes('local-fx.json'));
});

/** The served manifests of `dir` as the server builds them (assetViews.js), with the real content hashes of its files. */
function servedViews(dir) {
  const hashOf = (rel) => {
    try { return hash16(fs.readFileSync(path.join(dir, 'public', rel))); } catch { return null; }
  };
  const index = {
    hashOf,
    modelHash(rels) {
      const parts = rels.map(hashOf);
      return parts.every(Boolean) ? hash16(parts.join('\n')) : null;
    },
  };
  const view = (name) => {
    const file = path.join(dir, 'data', name);
    return fs.existsSync(file) ? rewriteManifest(JSON.parse(fs.readFileSync(file, 'utf8')), name, index).doc : null;
  };
  return { 'assets.json': view('assets.json'), 'local-assets.json': view('local-assets.json'), 'local-fx.json': view('local-fx.json') };
}

function memoryCaches() {
  const store = new Map();
  return {
    store,
    caches: {
      async open(name) {
        assert.equal(name, IMPORTED_ASSET_CACHE);
        return {
          async put(url, response) { store.set(String(url), new Uint8Array(await response.arrayBuffer())); },
          async keys() { return [...store.keys()].map((url) => ({ url })); },
        };
      },
    },
  };
}

test('a --assets build zips exactly the plan and README.txt in one folder, and the real importer accepts every file', { skip: !hasZipTool && 'no zip / tar' }, async () => {
  const { dir } = assetCheckout();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-package-out-'));
  try {
    const r = runTool(['--root', dir, '--assets', '--out', out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^not a release asset: offer it for download elsewhere/m);
    const name = 'Stronghold-Protocol-v9.9.9-assets';
    const zip = path.join(out, `${name}.zip`);
    assert.deepEqual(fs.readdirSync(out), [`${name}.zip`], 'the stage is removed after zipping');
    if (hasUnzip) {
      const entries = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l && !l.endsWith('/'));
      assert.deepEqual(entries.sort(), [...PACK_ART, ASSET_PACK_README].map((f) => `${name}/${f}`).sort());
    }
    const again = runTool(['--root', dir, '--assets', '--out', out]);
    assert.equal(again.status, 1, 'an existing zip is not replaced without --force');
    assert.match(again.stderr, /already exists \(--force replaces it\)/);
    assert.equal(runTool(['--root', dir, '--assets', '--out', out, '--force']).status, 0);
    const inRepo = runTool(['--root', dir, '--assets', '--out', path.join(dir, 'dist')]);
    assert.equal(inRepo.status, 1);
    assert.match(inRepo.stderr, /refusing to write into the repository/);

    // the title screen's import (public/js/assetPack.js) of this zip against the same checkout's served manifests
    const views = servedViews(dir);
    const fetched = [];
    const fetch = async (url) => {
      fetched.push(url);
      const name = url.replace(/^\/data\//, '');
      if (!Object.hasOwn(views, name)) throw new Error(`unexpected fetch ${url}`);
      return views[name] ? Response.json(views[name]) : new Response('', { status: 404 });
    };
    const { caches, store } = memoryCaches();
    const imp = createAssetImport({ fetch, caches });
    await imp.start({ type: 'zip', data: new Uint8Array(fs.readFileSync(zip)) });
    const got = imp.get();
    assert.deepEqual({ phase: got.phase, accepted: got.accepted, rejected: got.rejected, skipped: got.skipped, failed: got.failed },
      { phase: 'complete', accepted: PACK_ART.length, rejected: 0, skipped: 1, failed: 0 }, 'every file accepted; the README is the one skip');
    assert.deepEqual(fetched, ['/data/assets.json', '/data/local-assets.json', '/data/local-fx.json'], 'only the manifests are read');
    for (const f of PACK_ART) {
      const hit = [...store.keys()].find((url) => url.endsWith(`/${f.split('/').slice(2).map(encodeURIComponent).join('/')}`)
        || url.endsWith(`/${f.split('/').slice(2).join('/')}`));
      assert.ok(hit && /^\/(?:assets|fonts)\/~[0-9a-f]{16}\//.test(hit), `${f} is stored at its hashed URL`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a --assets build of a development version needs --allow-dev', { skip: !hasZipTool && 'no zip / tar' }, () => {
  const { dir, put } = assetCheckout();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-package-out-'));
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    put('package.json', JSON.stringify({ ...pkg, version: '9.9.9-dev' }));
    const refused = runTool(['--root', dir, '--assets', '--out', out]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /development version/);
    assert.deepEqual(fs.readdirSync(out), []);
    const dev = runTool(['--root', dir, '--assets', '--out', out, '--allow-dev']);
    assert.equal(dev.status, 0, dev.stdout + dev.stderr);
    assert.ok(fs.existsSync(path.join(out, 'Stronghold-Protocol-v9.9.9-dev-assets.zip')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
