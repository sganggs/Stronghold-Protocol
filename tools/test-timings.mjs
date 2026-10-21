#!/usr/bin/env node
// tools/test-timings.mjs — per-file test times from a test-run report, the weights tools/ci-shards.mjs balances the
// shards with.
//
//   node --test --test-reporter=junit --test-reporter-destination=report.xml "test/**/*.test.js" …
//   node tools/test-timings.mjs report.xml            the times as JSON on stdout: { "test/ui/hud.test.js": 1234, … }
//   node tools/test-timings.mjs report.xml --out f    the same, written to f
//
// JUnit, not TAP: a JUnit `<testcase>` carries `file` (the test file it belongs to) and `time` (seconds), while TAP
// prints the test names only. A file's time is the sum of its cases: the runner runs one file's tests one after another,
// so the sum is the file's share of the run. Paths are relative to the repository root, whatever the runner's absolute
// prefix was. Rounded to whole milliseconds: the shard table is a balance, not a benchmark.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** One attribute of a tag, or undefined. @param {string} attrs @param {string} name */
const attr = (attrs, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

/**
 * The time each test file took, in milliseconds, from a JUnit report (`--test-reporter=junit`).
 * @param {string} xml
 * @param {string} [root] the repository root the paths are made relative to
 * @returns {Record<string, number>}
 */
export function perFileMs(xml, root = ROOT) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const m of xml.matchAll(/<testcase\b([^>]*)>/g)) {
    const file = attr(m[1], 'file');
    const time = Number(attr(m[1], 'time'));
    if (!file || !Number.isFinite(time)) continue;
    const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
    if (rel.startsWith('..')) continue; // another checkout's file: not one of ours
    out[rel] = (out[rel] || 0) + time * 1000;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

// The command line: a report, and where the JSON goes (stdout by default).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('-'));
  const outAt = args.indexOf('--out');
  if (!file) {
    console.error('usage: node tools/test-timings.mjs <report.xml> [--out <file.json>]');
    process.exit(2);
  }
  const ms = perFileMs(fs.readFileSync(file, 'utf8'));
  const json = `${JSON.stringify(ms, null, 2)}\n`;
  if (outAt >= 0) fs.writeFileSync(args[outAt + 1], json);
  else process.stdout.write(json);
  if (!Object.keys(ms).length) {
    console.error(`${file}: no <testcase file="…"> found — was the report made with --test-reporter=junit?`);
    process.exit(1);
  }
}
