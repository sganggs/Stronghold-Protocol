#!/usr/bin/env node
// tools/apk/transform-assets.mjs — rewrites asset-manifest JSONs so heavy assets are fetched from a
// CDN base (weishucdn/R2) instead of the serving host. The SAME transform is applied in three places
// (single implementation here): the box deployment, the APK-embedded bundle (build-webroot), and the
// device-side hot updater (Updater.java mirrors this as plain string ops).
//   node tools/apk/transform-assets.mjs [--base https://art-cdn.example.com]
// Output (CLI mode): <repo>/../dl-cache/cdn-manifests/{assets.json,local-assets.json}
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const dataDir = path.join(repo, 'android', 'app', 'src', 'main', 'assets', 'webroot', 'data');
const out = path.resolve(repo, '..', 'dl-cache', 'cdn-manifests');

export const MANIFEST_FILES = ['assets.json', 'local-assets.json'];

/** Pure text transform: "/assets/..." → "<base>/assets/..."; returns count of rewritten URLs. */
export function transformManifestText(text, base) {
  const b = String(base).replace(/\/+$/, '');
  let count = 0;
  const transformed = text.replace(/"\/assets\//g, () => {
    count++;
    return `"${b}/assets/`;
  });
  return { text: transformed, count };
}

/**
 * Rewrites the manifest files in `dir` in place (returns per-file rewritten counts).
 * Used by build-webroot for the APK-embedded bundle and by the CLI for the box deployment.
 */
export function transformManifestsDir(dir, base) {
  const counts = {};
  for (const f of MANIFEST_FILES) {
    const src = path.join(dir, f);
    if (!fs.existsSync(src)) {
      counts[f] = -1;
      continue;
    }
    const { text, count } = transformManifestText(fs.readFileSync(src, 'utf-8'), base);
    fs.writeFileSync(src, text);
    counts[f] = count;
  }
  return counts;
}

async function main() {
  const argBase = process.argv.indexOf('--base');
  const BASE = (argBase > 0 ? process.argv[argBase + 1] : 'https://art-cdn.example.com')
    .replace(/\/+$/, '');

  fs.mkdirSync(out, { recursive: true });
  for (const f of MANIFEST_FILES) {
    const src = path.join(dataDir, f);
    if (!fs.existsSync(src)) {
      console.log(`skip (absent): ${f}`);
      continue;
    }
    const { text, count } = transformManifestText(fs.readFileSync(src, 'utf-8'), BASE);
    fs.writeFileSync(path.join(out, f), text);
    console.log(`${f}: rewrote ${count} asset URLs -> ${BASE}/assets/`);
  }
  console.log(`cdn manifests ready: ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
