// Build data/asset-index.json: each manifest path → jsDelivr (or GitHub raw) URL
// and the sha256 of the bytes the game should use. Atlases are hashed after the
// pipeline's size:/pma rewrite, which the service worker repeats in the browser.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mirrorUrl } from './assets/sources.mjs';
import { atlasInfo, normalizeAtlas } from '../shared/atlasText.js';
import { pngSize } from '../shared/pngSize.js';
import { safeName } from '../shared/assetPath.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'data', 'assets.json');
const LEDGER = path.join(ROOT, '.cache', 'assets-ledger.json');
const OUT = path.join(ROOT, 'data', 'asset-index.json');

// These two avatars are on disk but were not recorded in the download ledger.
const EXTRA_SRC = {
  'char/avatar/char_1012_skadi2.png': 'https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/avatar/char_1012_skadi2.png',
  'char/avatar/char_1016_agoat2.png': 'https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/avatar/char_1016_agoat2.png',
};

/**
 * Prefer the jsDelivr mirror. Voice files have no mirror, so the raw URL stays.
 * @param {string | undefined} raw
 * @returns {string | null}
 */
export function sourceUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  return mirrorUrl(raw) || raw;
}

/**
 * @param {unknown} node
 * @param {Set<string>} out
 */
function walkUrls(node, out) {
  if (typeof node === 'string') {
    if (node.startsWith('/assets/')) out.add(node);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const value of Object.values(node)) walkUrls(value, out);
}

/**
 * @param {unknown} node
 * @param {Set<string>} out
 */
function walkPma(node, out) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.atlas === 'string' && node.pma === true) out.add(node.atlas);
  for (const value of Object.values(node)) walkPma(value, out);
}

/**
 * @param {string} abs
 * @returns {Promise<string>}
 */
function sha256File(abs) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(abs);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Hash the bytes the page will actually use. An atlas missing `size:` is
 * normalized the same way the service worker normalizes a fresh download.
 * @param {string} fileAbs
 * @param {string} urlPath
 * @param {boolean} pma
 */
function hashGameBytes(fileAbs, urlPath, pma) {
  if (!urlPath.endsWith('.atlas')) return sha256File(fileAbs);
  const raw = readFileSync(fileAbs, 'utf8');
  const info = atlasInfo(raw);
  if (info.hasSize && (!pma || info.hasPma)) {
    return Promise.resolve(createHash('sha256').update(raw).digest('hex'));
  }
  const dir = path.dirname(fileAbs);
  const norm = normalizeAtlas(raw, {
    pageSize(name) {
      try { return pngSize(readFileSync(path.join(dir, safeName(name)))); }
      catch { return null; }
    },
    pma,
    renamePage: safeName,
  });
  return Promise.resolve(createHash('sha256').update(norm.text).digest('hex'));
}

/**
 * @param {string[]} items
 * @param {number} limit
 * @param {(item: string) => Promise<void>} fn
 */
async function pool(items, limit, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

export async function buildAssetIndex() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  /** @type {Record<string, { url?: string }>} */
  const ledger = existsSync(LEDGER) ? JSON.parse(await readFile(LEDGER, 'utf8')).files || {} : {};
  const paths = new Set();
  walkUrls(manifest, paths);
  const pma = new Set();
  walkPma(manifest, pma);
  /** @type {Record<string, { src?: string, sha256?: string, atlas?: true, pma?: true }>} */
  const files = {};
  let missingSrc = 0;
  let missingFile = 0;
  const list = [...paths].sort();
  await pool(list, 32, async (urlPath) => {
    const rel = urlPath.slice('/assets/'.length);
    const src = sourceUrl(ledger[rel]?.url) || EXTRA_SRC[rel] || null;
    /** @type {{ src?: string, sha256?: string, atlas?: true, pma?: true }} */
    const entry = {};
    if (src) entry.src = src;
    else missingSrc++;
    if (urlPath.endsWith('.atlas')) {
      entry.atlas = true;
      if (pma.has(urlPath)) entry.pma = true;
    }
    const fileAbs = path.join(ROOT, 'public', 'assets', rel);
    if (existsSync(fileAbs)) entry.sha256 = await hashGameBytes(fileAbs, urlPath, !!entry.pma);
    else missingFile++;
    if (entry.src || entry.sha256) files[urlPath] = entry;
  });
  const body = { version: 1, files };
  const tmp = OUT + '.tmp';
  await writeFile(tmp, JSON.stringify(body));
  await rename(tmp, OUT);
  return {
    count: Object.keys(files).length,
    missingSrc,
    missingFile,
    bytes: (await readFile(OUT)).length,
  };
}

async function main() {
  const stats = await buildAssetIndex();
  console.log(`[asset-index] ${stats.count} files, ${stats.bytes} bytes, missing src ${stats.missingSrc}, missing file ${stats.missingFile}`);
  console.log(`[asset-index] ${OUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
