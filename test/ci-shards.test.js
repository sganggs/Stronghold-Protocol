// test/ci-shards.test.js — tools/ci-shards.mjs and tools/test-timings.mjs: the shard table covers every test file
// `npm test` runs, exactly once, and the shards are balanced. Nothing here runs the suite: the weights are in
// ci-shards.json and the split is a pure function of them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TEST_FILES } from '../tools/ci.mjs';
import { MAX_IMBALANCE, SHARD_COUNT, TABLE, assignShards, loadTable, shardsOf, testFileList } from '../tools/ci-shards.mjs';
import { perFileMs } from '../tools/test-timings.mjs';

const files = testFileList();
const table = loadTable();
const split = shardsOf();

test('every test file of npm test is in exactly one shard, and the shards are the ci.yml matrix', () => {
  // the same expansion of TEST_FILES that test/ci.test.js checks against the tree, so a file cannot be in no shard
  // (it never runs) or in two (it runs twice and the full run is not the sum of the shards)
  const expanded = fs.globSync(TEST_FILES, { cwd: ROOT, exclude: (p) => path.basename(String(p?.name ?? p)) === 'node_modules' })
    .map((f) => f.split(path.sep).join('/')).sort();
  assert.deepEqual(files, expanded, 'testFileList expands TEST_FILES the way node --test does');
  const flat = split.files.flat();
  assert.deepEqual([...flat].sort(), files, 'the shards are a partition of the test files');
  assert.equal(new Set(flat).size, flat.length, 'no file in two shards');
  assert.equal(split.files.length, SHARD_COUNT);
  assert.ok(files.length > 800, `${files.length} test files — the glob found the suite`);
});

test('the shards are balanced by the measured weights, and most files are measured', () => {
  assert.ok(split.imbalance <= MAX_IMBALANCE, `imbalance ${split.imbalance.toFixed(2)} > ${MAX_IMBALANCE}: re-measure ${TABLE}`);
  // a file added after the last measurement is weighed with defaultMs; a few are fine, a burst means the table is stale
  const weighed = new Set(Object.keys(table.measured));
  const unmeasured = files.filter((f) => !weighed.has(f));
  const share = (unmeasured.length * table.defaultMs) / Object.values(split.ms).reduce((a, b) => a + b, 0);
  assert.ok(share <= 0.1, `${unmeasured.length} files (${(share * 100).toFixed(0)}% of the time) are unmeasured: re-measure ${TABLE}`);
  // a stale key is a renamed or deleted test: it hides the file's weight in the table while the split ignores it
  const stale = Object.keys(table.measured).filter((f) => !files.includes(f));
  assert.deepEqual(stale, [], `${TABLE} weighs files that are not test files`);
});

test('the split is a function of the weights only: same table, same shards, whatever order the files come in', () => {
  assert.deepEqual(assignShards(files, table), split);
  const reversed = [...files].reverse();
  assert.deepEqual(assignShards(reversed, table), split, 'the input order does not change the split');
});

test('assignShards: the heaviest files spread over the shards, the lightest fill the gaps', () => {
  const synthetic = {
    shards: 2,
    defaultMs: 10,
    measured: { 'test/a.test.js': 500, 'test/b.test.js': 400, 'test/c.test.js': 90, 'test/d.test.js': 90 },
  };
  const s = assignShards(['test/a.test.js', 'test/b.test.js', 'test/c.test.js', 'test/d.test.js', 'test/e.test.js'], synthetic);
  assert.deepEqual(s.files.map((f) => f.length), [2, 3]);
  assert.deepEqual(s.ms, {
    'test/a.test.js': 500, 'test/b.test.js': 400, 'test/c.test.js': 90, 'test/d.test.js': 90, 'test/e.test.js': 10,
  });
  assert.equal(s.load[0] + s.load[1], 1090);
  assert.ok(s.imbalance <= MAX_IMBALANCE);
});

test('perFileMs: a file sums its cases, other checkouts are dropped, paths are relative and whole milliseconds', () => {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>', '<testsuites>',
    `<testcase name="one" time="0.5" classname="test" file="${ROOT}/test/a.test.js"/>`,
    `<testcase name="two" time="0.25" classname="test" file="${ROOT}/test/a.test.js"/>`,
    '<testcase name="three" time="1.5" classname="test" file="/elsewhere/test/b.test.js"/>',
    '<testcase name="suite" time="9" classname="test"/>',
    '</testsuites>',
  ].join('\n');
  assert.deepEqual(perFileMs(xml), { 'test/a.test.js': 750 });
});

test('the command line: --print <n> is that shard\'s list, a shard number outside the matrix is an error', () => {
  const printed = spawnSync(process.execPath, ['tools/ci-shards.mjs', '--print', '0'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(printed.status, 0, printed.stderr);
  assert.deepEqual(printed.stdout.trim().split('\n'), split.files[0]);
  const bad = spawnSync(process.execPath, ['tools/ci-shards.mjs', '--run', '9'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /shard number 0\.\.3/);
});
