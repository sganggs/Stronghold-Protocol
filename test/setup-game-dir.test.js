// #572: --game accepts an install directory (and "Arknights Game"), and the next lookup reads the remembered path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  findClient, resolveGameDir, windowsCandidateSuffixes, inspectClientRoot,
} from '../tools/setup.mjs';

function marker(ab) {
  fs.mkdirSync(path.join(ab, 'ui', 'autochess'), { recursive: true });
}

function installTree(root, folder) {
  const install = path.join(root, folder);
  const ab = path.join(install, 'Arknights_Data', 'StreamingAssets', 'AB', 'Windows');
  fs.mkdirSync(install, { recursive: true });
  fs.writeFileSync(path.join(install, 'Arknights.exe'), '');
  marker(ab);
  return { install, ab };
}

test('#572 --game resolves an install directory, a parent, and an existing AssetBundle root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp572-'));
  try {
    const { install, ab } = installTree(root, 'Arknights Game');
    assert.equal(resolveGameDir(install), ab);
    assert.equal(resolveGameDir(root), ab);
    assert.equal(resolveGameDir(ab), ab);
    assert.equal(resolveGameDir(path.join(install, 'Arknights_Data')), ab);
    const found = findClient(install);
    assert.equal(found.path, ab);
    assert.equal(found.autochess, true);
    assert.equal(found.kind, '--game');
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sp572-empty-'));
    try {
      assert.equal(resolveGameDir(empty), null);
      assert.equal(inspectClientRoot(empty).autochess, false);
      assert.equal(findClient(empty).path, empty);
      assert.equal(findClient(empty).autochess, false);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#572 a PlayCover container resolves to Documents/Bundles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp572-pc-'));
  try {
    const container = path.join(root, 'com.hypergryph.arknights');
    const bundles = path.join(container, 'Data', 'Documents', 'Bundles');
    marker(bundles);
    assert.equal(resolveGameDir(container), bundles);
    assert.equal(findClient(path.join(container, 'Data')).path, bundles);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#572 the next lookup prefers a remembered path that still exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp572-mem-'));
  try {
    const { install, ab } = installTree(root, 'Arknights');
    const remembered = findClient(null, { state: { localExtractedFrom: ab } });
    assert.equal(remembered.path, ab);
    assert.equal(remembered.kind, 'remembered');
    const fromInstall = findClient(null, { state: { localExtractedFrom: install } });
    assert.equal(fromInstall.path, ab);
    assert.equal(fromInstall.kind, 'remembered');
    const gone = path.join(root, 'moved-away');
    const fallback = findClient(null, { state: { localExtractedFrom: gone } });
    assert.notEqual(fallback && fallback.path, gone);
    const explicit = findClient(install, { state: { localExtractedFrom: gone } });
    assert.equal(explicit.path, ab);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#572 extract.py resolves the same install directory and the same Windows list', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp572-py-'));
  try {
    const { install, ab } = installTree(root, 'Arknights Game');
    const parent = root;
    const script = [
      'import json, sys',
      'sys.path.insert(0, sys.argv[1])',
      'from extract import windows_candidate_suffixes, resolve_game_dir',
      'rows = [resolve_game_dir(p) for p in sys.argv[2:]]',
      'print(json.dumps({"suffixes": windows_candidate_suffixes(), "rows": [str(r) if r else None for r in rows]}))',
    ].join('\n');
    const py = spawnSync('python3', ['-c', script, path.join('tools', 'local-extract'), install, parent, ab], { encoding: 'utf8' });
    assert.equal(py.status, 0, py.stderr || py.stdout);
    const out = JSON.parse(py.stdout);
    const suffixes = windowsCandidateSuffixes();
    assert.ok(suffixes.includes('Program Files/Hypergryph Launcher/games/Arknights Game/Arknights_Data/StreamingAssets/AB/Windows'));
    assert.ok(suffixes.includes('Program Files/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows'));
    assert.deepEqual(out.suffixes, suffixes);
    assert.deepEqual(out.rows, [ab, ab, ab]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
