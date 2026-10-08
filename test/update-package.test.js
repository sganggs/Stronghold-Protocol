// test/update-package.test.js — the update package's packaging side (tools/package.mjs --update, tools/package-update.mjs,
// docs/DEPLOY.md §7): the comparison with the bases, reading a base (full zip or folder) and refusing what cannot be one,
// the zip reader, MANIFEST.json / UPDATE.json in the personal-info scan, MANIFEST.json in every zip and a whole update
// round trip on a small temporary checkout (--no-install), finished by the boot step. No network, no npm install.
// Run: node --test test/update-package.test.js (the player's side: test/update-boot.test.js)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { APPLIED_FILE, MANIFEST_FILE, UPDATE_FILE, applyPendingUpdate, checkInstall, parseUpdate, removalProblem } from '../server/update.js';
import { compareVersions, diffBases, readBase, readZip } from '../tools/package-update.mjs';
import { FOLDER, readBases, scanFiles, stageProblems } from '../tools/package.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'package.mjs');
const ENV = { SP_PACKAGE_SCAN_USER: '0', SP_PACKAGE_SCAN_NAMES: 'plantedname' };

const sha = (body) => crypto.createHash('sha256').update(body).digest('hex');
const dg = (body) => ({ size: Buffer.byteLength(body), sha256: sha(body) });
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-update-${tag}-`));
const put = (dir, rel, body = `// ${rel}\n`) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const quiet = () => {
  const lines = [];
  return { lines, log: { log: (m) => lines.push(['log', m]), warn: (m) => lines.push(['warn', m]), error: (m) => lines.push(['error', m]) } };
};
const files = (obj) => new Map(Object.entries(obj).map(([rel, body]) => [rel, dg(body)]));

// ---------------------------------------------------------------------------------------------------------------------
// The comparison

test('diff: a file ships when it is new or differs from the base; removed = what the base shipped and the new one does not', () => {
  const next = files({ 'server/a.js': 'A2', 'server/b.js': 'B', 'server/new.js': 'N', 'public/assets/x.png': 'X' });
  const base = { version: '0.2.0', files: files({ 'server/a.js': 'A1', 'server/b.js': 'B', 'server/gone.js': 'G', 'public/assets/x.png': 'X' }) };
  const d = diffBases(next, [base]);
  assert.deepEqual(d.ship, ['server/a.js', 'server/new.js'], 'changed + added; unchanged files and art stay out');
  assert.deepEqual(d.removed, [{ path: 'server/gone.js', sha256: [sha('G')] }]);
  assert.deepEqual(d.perBase, [{ version: '0.2.0', added: 1, changed: 1, unchanged: 2, removed: 1 }]);
  assert.deepEqual(d.caseOnly, []);
  // same size, other bytes (a version string 0.2.0 → 0.2.1) still ships
  const same = diffBases(files({ 'shared/constants.js': "v='0.2.1'" }), [{ version: '0.2.0', files: files({ 'shared/constants.js': "v='0.2.0'" }) }]);
  assert.deepEqual(same.ship, ['shared/constants.js']);
});

test('diff with two bases: cumulative — one update works over each; a file changed in the later base and reverted ships', () => {
  const v020 = { version: '0.2.0', files: files({ a: 'a0', b: 'b0', c: 'c0', d: 'd0', g: 'g0', 'P/x.png': 'p' }) };
  const v021 = { version: '0.2.1', files: files({ a: 'a1', b: 'b0', c: 'c1', e: 'e1', g: 'g1', 'P/x.png': 'p' }) };
  // 0.2.2: a reverted to 0.2.0's bytes, b unchanged everywhere, c new bytes, d re-added after 0.2.1 dropped it,
  // e (only 0.2.1 had it) and g (both had it, with other bytes) dropped, P/X.png renamed by case only
  const next = files({ a: 'a0', b: 'b0', c: 'c2', d: 'd0', 'P/X.png': 'p' });
  const d = diffBases(next, [v020, v021]);
  assert.deepEqual(d.ship, ['P/X.png', 'a', 'c', 'd'], 'a differs from 0.2.1, d is missing in 0.2.1, c differs from both');
  assert.ok(!d.ship.includes('b'), 'the same in every base: not shipped');
  assert.deepEqual(d.removed, [
    { path: 'e', sha256: [sha('e1')] },
    { path: 'g', sha256: [sha('g0'), sha('g1')].sort() },
  ], 'each base\'s bytes, so the copy of either install is recognised');
  assert.deepEqual(d.caseOnly, ['P/x.png'], 'one file on Windows / macOS: never deleted');
  assert.deepEqual(d.perBase.map((b) => [b.version, b.added, b.changed, b.unchanged, b.removed]), [
    ['0.2.0', 1, 1, 3, 2], // P/X.png is new to both bases (compared case-sensitively); removed: g and P/x.png
    ['0.2.1', 2, 2, 1, 3], // added: d and P/X.png; changed: a and c; removed: e, g and P/x.png
  ]);
});

test('diff: a name no update deletes (node_modules/x/.env.example) is left out of removed and listed as left', () => {
  const base = { version: '0.2.0', files: files({ 'node_modules/x/index.js': 'x', 'node_modules/x/.env.example': 'E=1', 'server/a.js': 'a' }) };
  const d = diffBases(files({ 'server/a.js': 'a' }), [base], { removable: (rel) => !removalProblem(rel) });
  assert.deepEqual(d.removed.map((r) => r.path), ['node_modules/x/index.js']);
  assert.deepEqual(d.left, ['node_modules/x/.env.example']);
  assert.deepEqual(diffBases(files({}), [base]).left, [], 'everything is removable by default');
});

test('versions compare numerically, a pre-release before its release', () => {
  assert.equal(compareVersions('0.2.0', '0.2.1'), -1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.2.1-test', '0.2.1'), -1);
  assert.equal(compareVersions('0.2.0', '0.2.1-test'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.throws(() => compareVersions('x', '1.0.0'));
});

// ---------------------------------------------------------------------------------------------------------------------
// The checks MANIFEST.json and UPDATE.json pass

test('MANIFEST.json and UPDATE.json pass the personal-info scan: paths are scanned, sha256 values (a hex-only name could match) are not', () => {
  const dir = tmp('scan');
  try {
    const hex = `${'0'.repeat(30)}beef${'0'.repeat(30)}`;
    fs.writeFileSync(path.join(dir, MANIFEST_FILE), `{"format":1,"app":"9.9.9","files":{\n"a.js":{"size":1,"sha256":"${hex}"}\n}}\n`);
    assert.deepEqual(scanFiles(dir, [MANIFEST_FILE], { names: ['beef'] }), [`${MANIFEST_FILE} (account name)`], 'the plain scan would refuse it');
    assert.deepEqual(scanFiles(dir, [MANIFEST_FILE], { names: ['beef'], strip: /[0-9a-f]{64}/g }), []);
    assert.deepEqual(stageProblems(dir, new Set([MANIFEST_FILE]), { env: { SP_PACKAGE_SCAN_USER: '0', SP_PACKAGE_SCAN_NAMES: 'beef' } }).problems, []);
    fs.writeFileSync(path.join(dir, UPDATE_FILE), `{"removed":[{"path":"${['', 'home', 'someone'].join('/')}/x"}]}`);
    assert.deepEqual(stageProblems(dir, new Set([MANIFEST_FILE, UPDATE_FILE]), { env: ENV }).problems, [`personal info: ${UPDATE_FILE} (home-directory path)`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Bases and a whole round trip on a temporary checkout (tools/package.mjs, --no-install)

const hasZipTool = !spawnSync('zip', ['-v'], { encoding: 'utf8' }).error
  || /bsdtar/.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout || '');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function fakeCheckout(version) {
  const dir = tmp('co');
  const scripts = { start: 'node server/index.js', setup: 'node tools/setup.mjs', doctor: 'node tools/doctor.mjs', launch: 'node scripts/launch.mjs',
    postinstall: 'node tools/vendor.mjs', vendor: 'node tools/vendor.mjs', assets: 'node tools/vendor.mjs && node tools/fetch-assets.mjs' };
  put(dir, 'package.json', JSON.stringify({ name: 'sp-test', version, main: 'server/index.js', scripts, dependencies: {} }));
  put(dir, 'package-lock.json', JSON.stringify({ name: 'sp-test', version, lockfileVersion: 3, packages: { '': { name: 'sp-test', version } } }));
  put(dir, 'server/index.js', "import './sim/rng.js';\n");
  put(dir, 'server/sim/rng.js', 'export const rng = 1;\n');
  put(dir, 'server/old.js', 'export const old = 1;\n');
  put(dir, 'shared/constants.js', `export const APP_VERSION = '${version}';\n`);
  put(dir, 'public/index.html', '<!doctype html>\n');
  put(dir, 'data/chess.json', '{}\n');
  put(dir, 'data/assets.json', JSON.stringify({ chars: { a: { avatar: '/assets/char/a.png' } }, fonts: { css: '/fonts/fonts.css' } }));
  for (const f of ['tools/setup.mjs', 'tools/vendor.mjs', 'tools/fetch-assets.mjs', 'tools/doctor.mjs', 'scripts/launch.mjs', 'tools/golden.mjs']) put(dir, f);
  put(dir, 'README.md', '# readme\n');
  put(dir, '.gitignore', 'public/assets/\npublic/fonts/\ndata/local-assets.json\n');
  put(dir, 'public/assets/char/a.png', PNG);
  put(dir, 'public/fonts/fonts.css', '@font-face{}\n');
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  assert.equal(git('add', '-A').status, 0);
  return { dir, git };
}

function bump({ dir }, version) {
  for (const f of ['package.json', 'package-lock.json']) put(dir, f, read(dir, f).replaceAll(/"version":"[^"]+"/g, `"version":"${version}"`));
  put(dir, 'shared/constants.js', `export const APP_VERSION = '${version}';\n`);
}

const runTool = (args, env = ENV) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 });

/** Extract a release zip into `dir` (over what is there), as a player would: readZip writes every file. */
function extract(zipPath, dir) {
  readZip(zipPath, (name, data) => {
    const to = path.join(dir, ...name.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, data);
  });
}

test('a whole update: base zip v9.9.8 → --update v9.9.9 ships only what changed, the boot step finishes it over the extracted base', { skip: !hasZipTool && 'no zip / tar' }, () => {
  const co = fakeCheckout('9.9.8');
  const out = tmp('out');
  const inst = tmp('player');
  try {
    let r = runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const baseZip = path.join(out, `${FOLDER}-v9.9.8.zip`);
    // the next version: a code change, a new module, a dropped one, other art, the version
    bump(co, '9.9.9');
    put(co.dir, 'server/sim/rng.js', 'export const rng = 2;\n');
    put(co.dir, 'server/new.js', 'export const n = 1;\n');
    put(co.dir, 'public/assets/char/a.png', Buffer.concat([PNG, Buffer.from('v2')]));
    fs.rmSync(path.join(co.dir, 'server/old.js'));
    assert.equal(co.git('add', '-A').status, 0);

    r = runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty', '--update', '--from', baseZip]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^base: v9\.9\.8 · \d+ files \(1 art\) · /m);
    assert.match(r.stdout, /^update: v9\.9\.9 over v9\.9\.8$/m);
    assert.match(r.stdout, /^ {2}vs v9\.9\.8: 5 changed, 1 added, \d+ unchanged, 1 removed$/m);
    assert.match(r.stdout, /^removed: 1 file\(s\) \(server\/old\.js\)$/m);
    const upZip = path.join(out, `${FOLDER}-v9.9.9-update.zip`);
    assert.deepEqual(fs.readdirSync(out).sort(), [`${FOLDER}-v9.9.8.zip`, `${FOLDER}-v9.9.9-update.zip`], 'both stages removed');
    const got = new Map();
    readZip(upZip, (name, data) => got.set(name, data));
    const SHIP = ['package-lock.json', 'package.json', 'public/assets/char/a.png', 'server/new.js', 'server/sim/rng.js', 'shared/constants.js'];
    assert.deepEqual([...got.keys()].sort(), [...SHIP, MANIFEST_FILE, UPDATE_FILE].map((f) => `${FOLDER}/${f}`).sort());
    const u = parseUpdate(got.get(`${FOLDER}/${UPDATE_FILE}`).toString('utf8'));
    assert.deepEqual([u.app, u.from, u.count, [...u.files.keys()]], ['9.9.9', ['9.9.8'], 6, SHIP]);
    assert.equal(u.bytes, SHIP.reduce((n, f) => n + got.get(`${FOLDER}/${f}`).length, 0));
    assert.deepEqual(u.removed, [{ path: 'server/old.js', sha256: [sha('export const old = 1;\n')] }]);

    // the full and lite zips of the same version carry the same MANIFEST.json, listing the non-art files
    r = runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    r = runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty', '--lite']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const manifestOf = (zip) => { let m = null; readZip(path.join(out, zip), (n, d) => { if (n === `${FOLDER}/${MANIFEST_FILE}`) m = d.toString('utf8'); }); return m; };
    const m = manifestOf(`${FOLDER}-v9.9.9.zip`);
    assert.equal(manifestOf(`${FOLDER}-v9.9.9-lite.zip`), m);
    assert.equal(got.get(`${FOLDER}/${MANIFEST_FILE}`).toString('utf8'), m);
    const listed = JSON.parse(m);
    assert.equal(listed.app, '9.9.9');
    assert.deepEqual(Object.keys(listed.files).sort(), ['README.md', 'data/chess.json', 'package-lock.json', 'package.json', 'public/index.html',
      'scripts/launch.mjs', 'server/index.js', 'server/new.js', 'server/sim/rng.js', 'shared/constants.js', 'tools/doctor.mjs',
      'tools/fetch-assets.mjs', 'tools/setup.mjs', 'tools/vendor.mjs'], 'no art, no data/assets.json');
    assert.deepEqual(listed.files['server/new.js'], dg('export const n = 1;\n'));

    // the player: the base extracted, a pack of their own, the update extracted over it, the server started
    extract(baseZip, inst);
    const root = path.join(inst, FOLDER);
    put(root, 'packs/mine/pack.json', '{"type":"lang"}');
    extract(upZip, inst);
    assert.equal(checkInstall(root).state, 'ok', 'the extracted update already matches its manifest');
    const q = quiet();
    const done = applyPendingUpdate(root, { log: q.log });
    assert.equal(done.state, 'applied', JSON.stringify(q.lines));
    assert.deepEqual(done.deleted, ['server/old.js']);
    assert.ok(!has(root, 'server/old.js') && has(root, APPLIED_FILE) && !has(root, UPDATE_FILE) && has(root, 'packs/mine/pack.json'));
    assert.equal(read(root, 'shared/constants.js'), "export const APP_VERSION = '9.9.9';\n");
    // the bases a later update may name: the full zip and the folder it was extracted to read the same
    const asZip = readBase(path.join(out, `${FOLDER}-v9.9.9.zip`));
    const fresh = tmp('fresh');
    try {
      extract(path.join(out, `${FOLDER}-v9.9.9.zip`), fresh);
      put(fresh, `${FOLDER}/.DS_Store`, 'finder');
      const asFolder = readBases([fresh], '9.9.10')[0];
      assert.deepEqual([...asFolder.files.keys()].sort(), [...asZip.files.keys()].filter((f) => f !== MANIFEST_FILE).sort(), 'MANIFEST.json and clutter left out');
      assert.equal(asFolder.version, '9.9.9');
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  } finally {
    for (const d of [co.dir, out, inst]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('bases are refused when they cannot be one: lite, an update zip, not older, twice, not a release; the options go together', { skip: !hasZipTool && 'no zip / tar' }, () => {
  const co = fakeCheckout('9.9.8');
  const out = tmp('out');
  try {
    assert.equal(runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty']).status, 0);
    assert.equal(runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty', '--lite']).status, 0);
    const full = path.join(out, `${FOLDER}-v9.9.8.zip`);
    const lite = path.join(out, `${FOLDER}-v9.9.8-lite.zip`);
    bump(co, '9.9.9');
    put(co.dir, 'server/sim/rng.js', 'export const rng = 2;\n');
    assert.equal(co.git('add', '-A').status, 0);
    assert.equal(runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty', '--update', '--from', full]).status, 0);
    const update = path.join(out, `${FOLDER}-v9.9.9-update.zip`);
    const refuse = (from, re) => {
      const r = runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty', '--update', '--force', '--dry-run', '--from', from]);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, re);
    };
    refuse(lite, /has no game art \(a lite zip\?\): pass the full zip, Stronghold-Protocol-v9\.9\.8\.zip/);
    refuse(update, /is an update package: pass the earlier release's full zip/);
    refuse(`${full},${full}`, /two bases are v9\.9\.8/);
    refuse(path.join(out, 'nothing.zip'), /not found/);
    fs.writeFileSync(path.join(out, 'other.zip'), 'not a zip');
    refuse(path.join(out, 'other.zip'), /not a zip file/);
    assert.throws(() => readBases([full], '9.9.8'), /is v9\.9\.8, not older than v9\.9\.8/);
    const dry = runTool(['--root', co.dir, '--out', out, '--allow-dirty', '--update', '--dry-run', '--from', full]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /^update: the bases are fine/m);
    for (const args of [['--from', full], ['--update'], ['--update', '--lite', '--from', full]]) {
      const r = runTool(['--root', co.dir, '--dry-run', ...args]);
      assert.equal(r.status, 2, args.join(' '));
    }
  } finally {
    fs.rmSync(co.dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a base folder: npm\'s files are compared like the stage\'s, per-machine and clutter files left out; no update without npm ci', { skip: !hasZipTool && 'no zip / tar' }, () => {
  const co = fakeCheckout('9.9.8');
  const out = tmp('out');
  const base = tmp('base');
  try {
    assert.equal(runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty']).status, 0);
    extract(path.join(out, `${FOLDER}-v9.9.8.zip`), base);
    const root = path.join(base, FOLDER);
    put(root, 'logs/server.log', 'a log');                  // per-machine: never part of a base
    put(root, 'scripts/service.env.cmd', 'set PORT=3000');
    put(root, 'public/.DS_Store', 'finder');
    put(root, 'node_modules/ws/.DS_Store', 'npm ships what it ships');
    const b = readBases([root], '9.9.9')[0];
    assert.ok(![...b.files.keys()].some((f) => /^(?:logs|scripts\/service|public\/\.DS)/.test(f)));
    assert.ok(b.files.has('node_modules/ws/.DS_Store'), 'node_modules is taken as npm wrote it, like the stage');
    // a base with node_modules and a build without npm ci: refused, it would delete them everywhere
    bump(co, '9.9.9');
    assert.equal(co.git('add', '-A').status, 0);
    const r = runTool(['--root', co.dir, '--out', out, '--no-install', '--allow-dirty', '--update', '--from', root]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /v9\.9\.8 ships node_modules\/ but this build has none \(--no-install\?\): an update built so would delete it from every install/);
  } finally {
    for (const d of [co.dir, out, base]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the zip reader: stored and deflated entries, zip64, UTF-8 names; damaged and foreign zips are refused', { skip: !hasZipTool && 'no zip / tar' }, () => {
  const dir = tmp('zip');
  try {
    put(dir, `${FOLDER}/package.json`, '{"version":"0.2.0"}');
    put(dir, `${FOLDER}/public/assets/卫戍 a.png`, Buffer.alloc(5000, 7));
    put(dir, `${FOLDER}/server/empty.js`, '');
    const zipped = [];
    const make = (name, args) => {
      const z = spawnSync('zip', ['-q', '-r', ...args, name, FOLDER], { cwd: dir });
      if (!z.error && z.status === 0) zipped.push(name);
    };
    make('plain.zip', ['-X']);
    make('stored.zip', ['-X', '-0']);
    make('zip64.zip', ['-X', '-fz']);
    if (!zipped.length) {
      const t = spawnSync('tar', ['-c', '--format', 'zip', '-f', 'plain.zip', FOLDER], { cwd: dir });
      if (!t.error && t.status === 0) zipped.push('plain.zip');
    }
    assert.ok(zipped.length > 0);
    for (const z of zipped) {
      const b = readBase(path.join(dir, z));
      assert.deepEqual([b.version, b.art, b.update], ['0.2.0', 1, false], z);
      // The entry name is asserted as UTF-8 only when the platform's zip tool round-trips it: Windows' bsdtar (the `tar`
      // fallback, and the `zip` some Git-for-Windows installs put on PATH) writes names in the local codepage and drops
      // the UTF-8 flag, so 卫戍 comes back as ?? / ???? — that is the writer's behaviour, not the reader's (the Linux
      // `zip -X` the CI's ubuntu legs use does write UTF-8, so the reader's UTF-8 path stays covered there).
      const names = [...b.files.keys()].sort();
      const utf8Name = 'public/assets/卫戍 a.png';
      if (names.includes(utf8Name)) {
        assert.deepEqual(names, ['package.json', utf8Name, 'server/empty.js'], z);
        assert.deepEqual(b.files.get(utf8Name), dg(Buffer.alloc(5000, 7)), z);
      } else {
        // the non-ASCII entry is still there — under whatever spelling the tool wrote — with its bytes intact
        const nonAscii = names.filter((n) => n.startsWith('public/assets/'));
        assert.equal(nonAscii.length, 1, `${z}: the non-ASCII entry (${names.join(', ')})`);
        assert.ok(nonAscii[0].endsWith(' a.png'), `${z}: ${nonAscii[0]}`);
        assert.deepEqual(b.files.get(nonAscii[0]), dg(Buffer.alloc(5000, 7)), z);
      }
      assert.deepEqual(b.files.get('server/empty.js'), dg(''), z);
    }
    // one damaged byte in a stored entry: the CRC refuses it (zlib.crc32, Node ≥ 22.2)
    if (zipped.includes('stored.zip') && typeof zlib.crc32 === 'function') {
      const bytes = fs.readFileSync(path.join(dir, 'stored.zip'));
      bytes[bytes.indexOf(Buffer.alloc(64, 7)) + 100] ^= 0xff;
      fs.writeFileSync(path.join(dir, 'bad.zip'), bytes);
      assert.throws(() => readBase(path.join(dir, 'bad.zip')), /bad\.zip: Stronghold-Protocol\/public\/assets\/卫戍 a\.png: CRC mismatch/);
    }
    const cut = fs.readFileSync(path.join(dir, zipped[0]));
    fs.writeFileSync(path.join(dir, 'cut.zip'), cut.subarray(0, cut.length - 30));
    assert.throws(() => readBase(path.join(dir, 'cut.zip')), /cut\.zip: (?:not a zip file|damaged|unexpected end)/, 'a truncated download');
    // entries outside the one folder: not a release zip
    put(dir, 'other/x.txt', 'x');
    const z = spawnSync('zip', ['-q', '-r', 'foreign.zip', 'other'], { cwd: dir });
    if (!z.error && z.status === 0) assert.throws(() => readBase(path.join(dir, 'foreign.zip')), /outside the Stronghold-Protocol\/ folder/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
