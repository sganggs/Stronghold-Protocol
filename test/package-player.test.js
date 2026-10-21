// GitHub #531 / #530: the player zip must not ship a package.json whose `npm test` is a silent green, and the
// Markdown it ships must not keep relative links to files the zip does not contain. The repository copies stay as they
// are; tools/package.mjs rewrites the staged copies. These tests call that rewrite directly (no zip, no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PLAYER_MARKDOWN, PLAYER_NPM_SCRIPTS, playerPackageJson, playerPackageProblems, releaseTag, rewritePlayerDoc,
  selectTracked, trackedFiles,
} from '../tools/package.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DISHONEST = ['test', 'golden', 'golden:update', 'build-data', 'check:imports', 'ci', 'package', 'package:lite', 'lint', 'typecheck'];
const KEPT = [...PLAYER_NPM_SCRIPTS, 'dev'];

test('release tags drop a trailing -dev and keep an already released version', () => {
  assert.equal(releaseTag('0.2.5-dev'), 'v0.2.5');
  assert.equal(releaseTag('0.2.4'), 'v0.2.4');
  assert.equal(releaseTag('9.9.9'), 'v9.9.9');
});

test('the packaged package.json keeps only scripts whose node files ship', () => {
  const shipped = selectTracked(trackedFiles(ROOT)).keep;
  const next = playerPackageJson(pkg, shipped);
  for (const name of DISHONEST) assert.equal(next.scripts[name], undefined, name);
  for (const name of KEPT) assert.equal(next.scripts[name], pkg.scripts[name], name);
  assert.deepEqual(Object.keys(next), Object.keys(pkg));
  assert.deepEqual(playerPackageProblems(pkg, shipped), []);
  assert.equal(pkg.scripts.test, 'node tools/test-run.mjs',
    'the repository package.json still runs the suite (tools/test-run.mjs over tools/ci.mjs TEST_FILES)');
  assert.equal(pkg.scripts.lint, 'eslint .');
  const keys = Object.keys(next);
  assert.deepEqual(keys.filter((k) => k !== 'scripts'), Object.keys(pkg).filter((k) => k !== 'scripts'));
});

test('a script with no shipped node file is dropped, including a bare node --test', () => {
  const shipped = new Set(['server/index.js', 'tools/vendor.mjs']);
  const next = playerPackageJson({
    name: 'x', version: '1.0.0',
    scripts: {
      start: 'node server/index.js',
      dev: 'node --watch server/index.js',
      test: 'node --test',
      named: 'node --test test/a.test.js',
      lint: 'eslint .',
      both: 'node tools/vendor.mjs && node tools/missing.mjs',
      vendor: 'node tools/vendor.mjs',
    },
  }, shipped);
  assert.deepEqual(Object.keys(next.scripts).sort(), ['dev', 'start', 'vendor']);
  assert.ok(playerPackageProblems({ scripts: { start: 'node server/missing.js', setup: 'node tools/setup.mjs', doctor: 'node tools/doctor.mjs', launch: 'node scripts/launch.mjs', postinstall: 'node tools/vendor.mjs', vendor: 'node tools/vendor.mjs', assets: 'node tools/vendor.mjs' } }, shipped).length > 0);
});

function linkTarget(from, href) {
  const raw = href.split('#')[0];
  const dir = path.posix.dirname(from);
  return path.posix.normalize(path.posix.join(dir, raw));
}

test('packaged copies of the shipped docs point unshipped relative links at the release tag', () => {
  const shipped = new Set(selectTracked(trackedFiles(ROOT)).keep);
  const version = pkg.version;
  const tag = releaseTag(version);
  const host = 'https://github.com/sganggs/Stronghold-Protocol';
  const focus = new Set(['README.md', 'docs/PLAYING.md', 'docs/DEPLOY.md']);
  let fileRewrites = 0;
  assert.ok(PLAYER_MARKDOWN.includes('README.md') && PLAYER_MARKDOWN.includes('docs/PLAYING.md') && PLAYER_MARKDOWN.includes('docs/DEPLOY.md'));
  for (const rel of PLAYER_MARKDOWN) {
    const md = readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of md.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
      const target = linkTarget(rel, href);
      const onDisk = target.startsWith('..') ? null : path.join(ROOT, target);
      const releaseLatest = /^(?:\.\.\/)+releases\/latest$/.test(target);
      assert.ok(releaseLatest || (onDisk && existsSync(onDisk)), `${rel} source link ${href} (${target})`);
    }
    const next = rewritePlayerDoc(md, rel, shipped, version);
    assert.equal(rewritePlayerDoc(next, rel, shipped, version), next, `${rel} rewrite is idempotent`);
    const before = [...md.matchAll(/(!?\[[^\]]*\]\()([^)\s]+)\)/g)];
    const after = [...next.matchAll(/(!?\[[^\]]*\]\()([^)\s]+)\)/g)];
    assert.equal(before.length, after.length, rel);
    for (let i = 0; i < after.length; i++) {
      const href = after[i][2];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) {
        if (before[i][2] !== href) assert.ok(href.startsWith(`${host}/`), `${rel} ${before[i][2]} → ${href}`);
        continue;
      }
      const target = linkTarget(rel, href);
      assert.ok(!target.startsWith('..') && shipped.has(target), `${rel} still links to ${href} (${target}), which the zip does not ship`);
    }
    if (!focus.has(rel)) continue;
    for (let i = 0; i < before.length; i++) {
      if (before[i][2] === after[i][2]) continue;
      if (/\.(?:png|jpe?g|gif|webp|svg)(?:#|$)/i.test(before[i][2])) {
        assert.match(after[i][2], new RegExp(`^${host}/raw/${tag}/`));
      } else {
        fileRewrites++;
        assert.match(after[i][2], new RegExp(`^${host}/(?:blob/${tag}/|releases/)`));
      }
    }
  }
  assert.ok(fileRewrites >= 23, `README / PLAYING / DEPLOY rewrote ${fileRewrites} file links, want at least 23`);
});
