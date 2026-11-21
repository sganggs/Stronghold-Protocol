#!/usr/bin/env node
// tools/build-card-roster.mjs — writes data/card-roster.json, the cross-period 名片干员 roster (DESIGN §37.325, #877;
// the format and the rules: shared/cardRoster.js), from every official version's chess.json and backups.json
// (shared/versions.js VERSIONS; each in its server/data.js versionDataDir).
//
// Usage:  node tools/build-card-roster.mjs [--check] [--data <dir>]      (npm run build:roster)
//   --check   write nothing: exit 1 when the file differs from what the data gives (stale: run npm run build:roster)
//   --data    the data directory (default: <repo>/data)
// Unknown options are errors (exit code 2). tools/build-data.mjs calls writeCardRoster after it wrote a version's default
// output directory, so a data rebuild keeps the roster current; test/card-roster.test.js fails on a stale one.

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, ROOT, versionDataDir } from '../server/data.js';
import { VERSIONS } from '../shared/versions.js';
import { CARD_ROSTER, buildCardRoster, serializeCardRoster } from '../shared/cardRoster.js';

const USAGE = 'usage: node tools/build-card-roster.mjs [--check] [--data <dir>]';
const HOW = 'run npm run build:roster';

/** A path as the messages show it: relative to the repository when inside it. @param {string} abs */
const shown = (abs) => {
  const rel = path.relative(ROOT, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : abs;
};

/**
 * Every official version's card sources: { id, chess, backups }, in VERSIONS order. A missing or unreadable file throws.
 * @param {string} [dataDir] the data directory (default ROOT/data)
 * @returns {Promise<{ id: string, chess: any, backups: any }[]>}
 */
export async function readCardSources(dataDir = DATA_DIR) {
  const out = [];
  for (const v of VERSIONS) {
    const dir = /** @type {string} */ (versionDataDir(v.id, dataDir));
    const read = async (name) => {
      const file = path.join(dir, `${name}.json`);
      try {
        return JSON.parse(await readFile(file, 'utf8'));
      } catch (e) {
        throw new Error(`card roster: cannot read ${shown(file)} (${v.id}): ${e?.code || e?.message || e}`, { cause: e });
      }
    };
    out.push({ id: v.id, chess: await read('chess'), backups: await read('backups') });
  }
  return out;
}

/**
 * Write <dataDir>/card-roster.json (atomically: a temporary file renamed over it, as tools/build-data.mjs writes), or with
 * `check` compare it only — a missing or different file throws, naming `npm run build:roster`.
 * @param {{ dataDir?: string, check?: boolean }} [opts]
 * @returns {Promise<{ file: string, operators: number, bytes: number, written: boolean }>}
 */
export async function writeCardRoster({ dataDir = DATA_DIR, check = false } = {}) {
  const roster = buildCardRoster(await readCardSources(dataDir));
  const file = path.join(dataDir, `${CARD_ROSTER}.json`);
  const body = Buffer.from(serializeCardRoster(roster), 'utf8');
  const operators = roster.operators.length;
  if (check) {
    const was = await readFile(file).catch(() => null);
    if (!was) throw new Error(`${shown(file)} is missing: ${HOW}`);
    if (!was.equals(body)) throw new Error(`${shown(file)} is stale (it differs from the version data): ${HOW}`);
    return { file, operators, bytes: body.length, written: false };
  }
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, body);
  await rename(tmp, file);
  return { file, operators, bytes: body.length, written: true };
}

/** The command line. @param {string[]} argv */
function parseArgs(argv) {
  const opts = { check: false, dataDir: DATA_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
    if (a === '--check') { opts.check = true; continue; }
    if (a === '--data' || a.startsWith('--data=')) {
      const v = a.startsWith('--data=') ? a.slice('--data='.length) : argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`--data needs a directory\n${USAGE}`);
      opts.dataDir = path.resolve(v);
      continue;
    }
    throw new Error(`unknown option ${a}\n${USAGE}`);
  }
  return opts;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`build-card-roster: ${e.message}`);
    process.exit(2);
  }
  try {
    const r = await writeCardRoster(opts);
    console.log(`${r.written ? 'wrote' : 'checked'} ${shown(r.file)}: ${r.operators} operators, ${r.bytes} bytes`);
  } catch (e) {
    console.error(`build-card-roster: ${e?.message || e}`);
    process.exitCode = 1;
  }
}
