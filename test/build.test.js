// test/build.test.js — the served-runtime build tag (server/http/buildTag.js computeBuildTag / buildTag, exported by
// server/index.js): the signal that lets an already-open page notice a deploy (public/js/ui/buildGuard.js;
// /healthz `build`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeBuildTag, buildTag, resetBuildTag } from '../server/index.js';
import { checkBuildOnce } from '../public/js/ui/buildGuard.js';

/** A throwaway browser runtime, independent of the build tag's input list. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-build-'));
  for (const rel of [
    'public/index.html', 'public/js/file.js', 'public/css/file.css',
    'server/sim/content/kits/skill.js', 'shared/protocol.js', 'data/chess.json',
  ]) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  return root;
}

for (const rel of ['server/sim/content/kits/skill.js', 'shared/protocol.js', 'data/chess.json']) {
  test(`buildTag: an update to ${rel} is visible to an old page after restart only`, async () => {
    const root = fixture();
    try {
      resetBuildTag();
      const known = buildTag(root);
      const fetchFn = async () => ({ ok: true, json: async () => ({ build: buildTag(root) }) });
      fs.writeFileSync(path.join(root, rel), 'updated runtime');
      assert.notEqual(computeBuildTag(root), known, 'the updated file changes the startup fingerprint');
      assert.equal(buildTag(root), known, 'the running process keeps its startup tag');
      assert.equal((await checkBuildOnce({ known, fetchFn })).status, 'current');
      resetBuildTag(); // The next process computes its tag from the deployed files.
      assert.equal((await checkBuildOnce({ known, fetchFn })).status, 'new');
    } finally {
      resetBuildTag();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('computeBuildTag: server-only code and downloaded media do not change the browser build', () => {
  const root = fixture();
  try {
    const known = computeBuildTag(root);
    for (const rel of ['server/index.js', 'server/http/routes.js', 'server/data.js', 'public/assets/sprite.png']) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'changed');
    }
    assert.equal(computeBuildTag(root), known);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('computeBuildTag: stable for one tree, different when a runtime file changes (size or mtime)', () => {
  const root = fixture();
  try {
    const a = computeBuildTag(root);
    assert.match(a, /^[0-9a-f]{12}$/);
    assert.equal(computeBuildTag(root), a, 'same tree → same tag');
    // a changed file (new size) is a new build
    fs.writeFileSync(path.join(root, 'public/js/file.js'), 'yy');
    const b = computeBuildTag(root);
    assert.notEqual(b, a, 'a changed runtime file is a new build');
    // …and so is a rewrite with the same size but a new mtime (a deploy of identical bytes keeps its timestamp)
    const target = path.join(root, 'public/css/file.css');
    const st = fs.statSync(target);
    fs.utimesSync(target, st.atime, new Date(st.mtimeMs + 5000));
    assert.notEqual(computeBuildTag(root), b);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('computeBuildTag: dot files and editor backups are ignored (the static server never serves them)', () => {
  const root = fixture();
  try {
    const a = computeBuildTag(root);
    for (const rel of ['public/js', 'server/sim', 'shared', 'data']) {
      fs.writeFileSync(path.join(root, rel, '.DS_Store'), 'x');
      fs.writeFileSync(path.join(root, rel, 'file.js~'), 'x');
      fs.mkdirSync(path.join(root, rel, '.cache'), { recursive: true });
      fs.writeFileSync(path.join(root, rel, '.cache/leftover.js'), 'x');
    }
    assert.equal(computeBuildTag(root), a, 'a .DS_Store / backup / dot directory in the tree is not a new build');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('computeBuildTag: nothing readable → null (an unknown build never reloads a page)', () => {
  assert.equal(computeBuildTag(path.join(os.tmpdir(), 'sp-does-not-exist-xyz')), null);
});

test('buildTag: computed once per process — a file that changes afterwards does not move it until the next process', () => {
  const root = fixture();
  try {
    resetBuildTag();
    const first = buildTag(root);
    assert.match(String(first), /^[0-9a-f]{12}$/);
    fs.writeFileSync(path.join(root, 'public/js/file.js'), 'changed while the process ran');
    assert.equal(buildTag(root), first, 'the tag describes what this process is serving, not whatever appears on disk');
    resetBuildTag();                                           // a restart recomputes it
    assert.notEqual(buildTag(root), first);
  } finally {
    resetBuildTag();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
