#!/usr/bin/env node
// tools/ci-shards.mjs — how `npm test` is split across CI jobs: every test file belongs to exactly one shard, and the
// shards carry about the same measured time (ci-shards.json holds the weights).
//
//   node tools/ci-shards.mjs --check                    the shards' loads and the imbalance; exit 1 above MAX_IMBALANCE
//   node tools/ci-shards.mjs --print <n>                the files of shard n, one per line
//   node tools/ci-shards.mjs --run <n>                  node --test over exactly those files (one CI job, locally)
//   node tools/ci-shards.mjs --write --timings <r.xml>  re-weigh the table from a JUnit report and write it
//   node tools/ci-shards.mjs --list                     one line per shard: the files it runs
//
// The assignment is the same everywhere and every time: no clock, no network, no randomness — sort the files by weight
// (measured milliseconds, the default for a file nobody timed), then give each file to the shard that is lightest so
// far, ties to the lowest shard number. Two runs of this file, on any machine, produce the same split, so a CI job can
// name its own files and test/ci-shards.test.js can check the same split without a runner.
//
// Adding a test file does not need a new measurement: it is weighed with `defaultMs` and lands in the lightest shard.
// A file that has grown a lot should be re-measured (`--write --timings`) — test/ci-shards.test.js fails while the
// shards drift past MAX_IMBALANCE, which is what a stale table looks like.
//
// The weights are a file's test time as a full concurrent run reports it (the sum of its cases), so a shard's load is
// work, not wall clock: the runner overlaps files within one job, and the sum of all files is several times the run's
// wall time. Equal loads therefore mean equal jobs, which is all the split is for.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_FILES } from './ci.mjs';
import { perFileMsOf } from './test-timings.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The table that holds the weights. @type {string} */
export const TABLE = 'ci-shards.json';

/** How many test jobs one OS runs (ci.yml's matrix `shard`). @type {number} */
export const SHARD_COUNT = 4;

/** The slowest shard may take this many times the fastest. Past it the split is worth re-measuring. @type {number} */
export const MAX_IMBALANCE = 1.3;

/**
 * The test files of `npm test`, the way Node's test runner expands it (node_modules left out, forward slashes, sorted),
 * so a shard is a partition of exactly what the single full run executes.
 * @param {string} root
 * @returns {string[]}
 */
export function testFileList(root = ROOT) {
  return fs.globSync(TEST_FILES, { cwd: root, exclude: (p) => path.basename(String(p?.name ?? p)) === 'node_modules' })
    .map((f) => f.split(path.sep).join('/')).sort();
}

/**
 * ci-shards.json: the shard count, the weight of a file nobody timed, and the measured weights.
 * @param {string} root
 * @returns {{ shards: number, defaultMs: number, measured: Record<string, number> }}
 */
export function loadTable(root = ROOT) {
  const table = JSON.parse(fs.readFileSync(path.join(root, TABLE), 'utf8'));
  if (table.shards !== SHARD_COUNT) throw new Error(`${TABLE}: ${table.shards} shards, but ci.yml runs ${SHARD_COUNT}`);
  return table;
}

/**
 * The split: each file's shard, the files of each shard and the load of each shard.
 * @param {string[]} files the test files (testFileList)
 * @param {{ shards: number, defaultMs: number, measured: Record<string, number> }} table
 * @returns {{ ms: Record<string, number>, files: string[][], load: number[], imbalance: number }}
 */
export function assignShards(files, table) {
  const ms = Object.fromEntries(files.map((f) => [f, table.measured[f] ?? table.defaultMs]));
  const heaviestFirst = [...files].sort((a, b) => ms[b] - ms[a] || (a < b ? -1 : 1));
  const files_ = Array.from({ length: table.shards }, () => /** @type {string[]} */ ([]));
  const load = Array.from({ length: table.shards }, () => 0);
  for (const f of heaviestFirst) {
    let lightest = 0;
    for (let i = 1; i < table.shards; i++) if (load[i] < load[lightest]) lightest = i;
    files_[lightest].push(f);
    load[lightest] += ms[f];
  }
  return { ms, files: files_.map((s) => s.sort()), load, imbalance: Math.max(...load) / Math.max(1, Math.min(...load)) };
}

/** The whole table's split, read from disk. @param {string} root */
export const shardsOf = (root = ROOT) => assignShards(testFileList(root), loadTable(root));

const usage = `usage: node tools/ci-shards.mjs <command>

  --check                    the shards' loads and the imbalance; exit 1 above ${MAX_IMBALANCE}
  --print <n>                the files of shard n, one per line
  --run <n>                  node --test over the files of shard n
  --list                     one line per shard: its load and its files
  --write --timings <file…>  re-weigh ${TABLE} from JUnit reports (node --test --test-reporter=junit), one per job:
                             a file's weight is the median of the jobs that ran it`;

const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  const shards = shardsOf();
  const shardArg = () => {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 0 || n >= SHARD_COUNT) {
      console.error(`--print/--run needs a shard number 0..${SHARD_COUNT - 1}`);
      process.exit(2);
    }
    return n;
  };
  if (cmd === '--check') {
    for (let i = 0; i < SHARD_COUNT; i++) console.log(`shard ${i}  ${shards.files[i].length} files  ${fmt(shards.load[i])} of test time`);
    console.log(`imbalance ${shards.imbalance.toFixed(2)} (max ${MAX_IMBALANCE})`);
    process.exit(shards.imbalance <= MAX_IMBALANCE ? 0 : 1);
  } else if (cmd === '--print') {
    process.stdout.write(shards.files[shardArg()].map((f) => `${f}\n`).join(''));
  } else if (cmd === '--run') {
    const r = spawnSync(process.execPath, ['--test', ...shards.files[shardArg()]], { cwd: ROOT, stdio: 'inherit' });
    process.exit(r.status ?? 1);
  } else if (cmd === '--list') {
    for (let i = 0; i < SHARD_COUNT; i++) console.log(`shard ${i}  ${fmt(shards.load[i])}  ${shards.files[i].join(' ')}`);
  } else if (cmd === '--write') {
    const at = process.argv.indexOf('--timings');
    // every JUnit report given: one per CI job, which is how the table is re-weighed from the runners' own times
    const reports = at >= 0 ? process.argv.slice(at + 1).filter((a) => !a.startsWith('--')) : [];
    if (!reports.length) {
      console.error(usage);
      process.exit(2);
    }
    const old = loadTable();
    const fresh = perFileMsOf(reports.map((r) => fs.readFileSync(r, 'utf8')), ROOT);
    if (!Object.keys(fresh).length) {
      console.error(`${reports.join(', ')}: no usable <testcase file="…"> timings; table unchanged`);
      process.exit(1);
    }
    const known = new Set(testFileList());
    // a file the report does not mention keeps its old weight: a partial report must not silently re-weigh the rest
    const measured = Object.fromEntries([...known].sort().map((f) => [f, fresh[f] ?? old.measured[f] ?? old.defaultMs]));
    const table = { shards: SHARD_COUNT, defaultMs: old.defaultMs, measured };
    fs.writeFileSync(path.join(ROOT, TABLE), `${JSON.stringify(table, null, 2)}\n`);
    const after = assignShards([...known], table);
    console.log(`wrote ${TABLE}: ${known.size} files, imbalance ${after.imbalance.toFixed(2)}`);
  } else {
    console.log(usage);
    process.exit(cmd === undefined || cmd === '--help' || cmd === '-h' ? 0 : 2);
  }
}
