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

/** The repository folders a report's `file` can name a test file from: the suite's two roots. */
const TEST_ROOTS = ['test/', 'plugins/'];

/**
 * A report's `file` as a path inside the repository. A report made by another machine (CI checks out to
 * /home/runner/work/… and D:\a\…) is still ours: its path inside the repository is taken from the suite root on, and
 * only a file that names none of them is dropped.
 * @param {string} file @param {string} root
 */
function relOf(file, root) {
  const norm = file.split('\\').join('/');
  const absolute = norm.startsWith('/') || /^[A-Za-z]:\//.test(norm);
  // a relative path: the report was made in this checkout
  if (!absolute) return path.posix.normalize(norm);
  // an absolute path: this checkout, or another machine's — the file is still ours by the path inside the repository
  const here = root.split('\\').join('/').replace(/\/*$/, '/');
  if (norm.toLowerCase().startsWith(here.toLowerCase())) return norm.slice(here.length);
  for (const k of TEST_ROOTS) {
    const at = norm.lastIndexOf(`/${k}`);
    if (at >= 0) return norm.slice(at + 1);
  }
  return ''; // an absolute path with no suite root in it: not one of ours
}

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
    const rel = relOf(file, root);
    if (!rel || rel.startsWith('..')) continue; // not a test file of this repository
    out[rel] = (out[rel] || 0) + time * 1000;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

/**
 * The time each test file took, in milliseconds, from several JUnit reports: one value per file, the median of the
 * reports that mention it. A file is measured once per CI job that ran it (ubuntu and windows, node 22 and 24), so the
 * median is what one runner takes without trusting a single slow or fast job — and a file a report does not mention
 * (a shard that did not run, a report cut short) keeps the others' value instead of vanishing.
 * @param {string[]} xmls
 * @param {string} [root]
 * @returns {Record<string, number>}
 */
export function perFileMsOf(xmls, root = ROOT) {
  const per = xmls.map((x) => perFileMs(x, root));
  const files = [...new Set(per.flatMap((m) => Object.keys(m)))].sort();
  /** @type {Record<string, number>} */
  const out = {};
  for (const f of files) {
    const seen = per.map((m) => m[f]).filter((v) => v !== undefined).sort((a, b) => a - b);
    out[f] = seen[(seen.length - 1) >> 1];
  }
  return out;
}

// The command line: a report, and where the JSON goes (stdout by default).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const reports = [];
  let out = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i] ?? '';
    else reports.push(args[i]);
  }
  if (!reports.length) {
    console.error('usage: node tools/test-timings.mjs <report.xml…> [--out <file.json>]');
    process.exit(2);
  }
  const texts = reports.map((f) => fs.readFileSync(f, 'utf8'));
  // A JUnit report without `file` weighs nothing: `<testcase name time>` alone does not say which file a case ran in.
  // Node 22's reporter writes no file attribute (22.22.0 measured), node 24's does, so a report from a node 22 run can
  // only ever add nothing — say so instead of quietly returning an empty or half-filled table.
  for (let i = 0; i < texts.length; i++) {
    const cases = (texts[i].match(/<testcase\b/g) ?? []).length;
    const withFile = (texts[i].match(/<testcase\b[^>]*\bfile="/g) ?? []).length;
    if (cases && !withFile) {
      console.error(`${reports[i]}: ${cases} <testcase> and none with file="…" — this Node.js version's JUnit reporter does not write the file attribute (node 22 does not, node 24 does), so this report weighs nothing`);
    }
  }
  const ms = perFileMsOf(texts);
  const json = `${JSON.stringify(ms, null, 2)}\n`;
  if (out) fs.writeFileSync(out, json);
  else process.stdout.write(json);
  if (!Object.keys(ms).length) {
    console.error(`${reports.join(', ')}: no <testcase file="…"> found — was the report made with --test-reporter=junit?`);
    process.exit(1);
  }
}
