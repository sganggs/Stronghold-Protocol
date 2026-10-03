// test/build.test.js — the served-runtime build tag (server/index.js computeBuildTag / buildTag): the signal that lets
// an already-open page notice a deploy (public/js/ui/buildGuard.js; /healthz `build`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeBuildTag, buildTag, resetBuildTag, BUILD_INPUTS } from '../server/index.js';

/** A throwaway root with the browser runtime layout (one file per BUILD_INPUTS entry). */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-build-'));
  for (const rel of BUILD_INPUTS) {
    const abs = path.join(root, rel);
    if (path.extname(rel)) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x');
    } else {
      fs.mkdirSync(abs, { recursive: true });
      fs.writeFileSync(path.join(abs, 'file.js'), 'x');
    }
  }
  return root;
}

test('BUILD_INPUTS: only the runtime the browser loads (server/, data/ and shared/ are not part of it)', () => {
  assert.deepEqual([...BUILD_INPUTS], ['public/index.html', 'public/js', 'public/css']);
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
    const target = path.join(root, 'public/css/file.js');
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
    fs.writeFileSync(path.join(root, 'public/js/.DS_Store'), 'x');
    fs.writeFileSync(path.join(root, 'public/css/main.css~'), 'x');
    fs.mkdirSync(path.join(root, 'public/js/.cache'), { recursive: true });
    fs.writeFileSync(path.join(root, 'public/js/.cache/leftover.js'), 'x');
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
