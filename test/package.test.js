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
  FOLDER, REFUSE, RUNTIME_RESEARCH, entryProblems, isRefused, packageOutIsUnsafe, plan, resolveSpecifier, scanFiles,
  selectTracked,
} from '../tools/package.mjs';

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
    'tools/local-extract/LICENSE-Ark-Unpacker.txt', 'scripts/start.sh', 'scripts/start-windows.bat', 'scripts/launch.mjs',
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
    'tools/assets/local-token-spines.json', 'tools/local-extract/LICENSE-Ark-Unpacker.txt', 'scripts/install-service-windows.ps1',
    'docs/research/07-assets.json', 'CHANGELOG.md']) {
    assert.ok(keep.includes(f), `keeps ${f}`);
  }
  assert.equal(keep.length, 35, keep.join(' '));
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
  for (const f of got) assert.ok(!/^(?:test|handoff|\.github|types|public\/dev|docs\/img|docs\/design|docs\/history)\//.test(f), f);
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
  put('server/index.js', "import './sim/rng.js';\n");
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
  'tools/setup.mjs', 'tools/vendor.mjs'].sort();
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
    assert.deepEqual(listed(lite.stdout), SHIPPED_TRACKED, 'lite: the same runtime files, no art, fonts or local manifest');
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
    assert.deepEqual(fs.readdirSync(out), [path.basename(zip)], 'the stage is removed after zipping');
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
    assert.match(dry.stdout, /^generated: packs\/index\.json \(the pack index of the shipped packs, for a static host\)$/m);
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
