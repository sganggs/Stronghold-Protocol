#!/usr/bin/env node
// make-bundle.mjs — the two content bundles the shell publishes.
//
//   content-bundle-<upstreamTag>.zip   full upstream integration zip (self-hosted mirror)
//   content-slim-<buildTag>.zip        RAW SLIM = pure upstream L1 content, NO shell extras,
//                                      NO shell patches, NO CDN manifest rewrite
//
// RAW SLIM semantics (locked 2026-10-03, P0 fix): the on-device Updater re-applies the shell's
// own overlay (assets/shell/extras + assets/shell/patches) after extraction. A slim bundle that
// already contained the overlay would fail the patch-anchor assertions ("锚点未命中") — the hot
// update could never succeed. Therefore the slim bundle is assembled from the EXTRACTED UPSTREAM
// TREE ONLY and must never be built from the assembled webroot.
//
//   node tools/apk/make-bundle.mjs --tag shell-v2.7.1           # both bundles
//   node tools/apk/make-bundle.mjs --slim-only --tag shell-v2.7.1
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM_API = 'https://api.github.com/repos/sganggs/Stronghold-Protocol/releases/latest';

/** The slim (L1) set the on-device hot update downloads — mirrors build-webroot's SLIM_TOP. */
const SLIM_TOP = ['index.html', 'data.js', 'js', 'css', 'vendor', 'fonts', 'shared', 'sim', 'data',
  'server', 'package.json', 'node_modules'];

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const staging = path.resolve(repo, '..', 'dl-cache', 'upstream-extracted');
const dist = path.resolve(repo, '..', 'dl-cache', 'dist');

/** buildTag default = the built-in manifest's, so CI (which never passes --tag) stays aligned:
 *  manifest.buildTag → slim filename → GitHub release asset all name the same file. */
function builtinBuildTag() {
  const m = path.join(here, 'shell', 'manifest.json');
  if (fs.existsSync(m)) {
    try {
      const tag = JSON.parse(fs.readFileSync(m, 'utf8')).buildTag;
      if (typeof tag === 'string' && tag.startsWith('shell-v')) return tag;
    } catch { /* fall through to upstream tag */ }
  }
  return null;
}

async function main() {
  const slimOnly = process.argv.includes('--slim-only');
  fs.mkdirSync(dist, { recursive: true });

  const tag = argvValue('--tag') || builtinBuildTag() || (await upstreamTagSafe());
  if (!tag) throw new Error('no tag: pass --tag or bake tools/apk/shell/manifest.json first');

  // RAW SLIM is assembled from the EXTRACTED UPSTREAM TREE. When the staging dir has been
  // cleaned (fresh machine, interrupted build), fetch + extract just the upstream zip — the
  // node_modules are always taken from the assembled webroot (host deps {ws, werift} only).
  const hasStaging = fs.readdirSync(staging).some((n) => fs.statSync(path.join(staging, n)).isDirectory());
  if (!hasStaging) {
    if (slimOnly && process.env.SP_UPSTREAM_ZIP) {
      const zip = process.env.SP_UPSTREAM_ZIP;
      console.log(`staging empty — extracting ${zip}`);
      if (process.platform === 'win32') execFileSync('C:/Windows/System32/tar.exe', ['-xf', zip, '-C', staging]);
      else execFileSync('unzip', ['-q', zip, '-d', staging]);
    } else {
      throw new Error(`nothing extracted under ${staging} — run build-webroot.mjs first (it populates this staging), or set SP_UPSTREAM_ZIP`);
    }
  }

  const [root] = fs.readdirSync(staging).filter((n) => fs.statSync(path.join(staging, n)).isDirectory());
  const src = path.join(staging, root);

  if (!slimOnly) {
    const out = path.join(dist, `content-bundle-${await upstreamTagSafe()}.zip`);
    fs.rmSync(out, { force: true });
    if (process.platform === 'win32') {
      execFileSync('C:/Windows/System32/tar.exe', ['-a', '-c', '-f', out, '-C', staging, root]);
    } else {
      execFileSync('zip', ['-qr', out, root], { cwd: staging });
    }
    console.log(`content bundle: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(0)} MB)`);
  }

  // RAW SLIM: from the extracted upstream tree, mirroring the slim-entry mapper in Updater.java
  const tmp = path.resolve(repo, '..', 'dl-cache', 'raw-slim');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  // public/ → root (minus dev/ and assets/ — L2 art never rides the slim)
  for (const name of fs.readdirSync(path.join(src, 'public'))) {
    if (name === 'dev' || name === 'assets') continue;
    fs.cpSync(path.join(src, 'public', name), path.join(tmp, name), { recursive: true });
  }
  for (const dir of ['data', 'shared', 'server']) {
    fs.cpSync(path.join(src, dir), path.join(tmp, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(src, 'package.json'), path.join(tmp, 'package.json'));
  fs.cpSync(path.join(src, 'server', 'sim'), path.join(tmp, 'sim'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'data.js'), DATA_JS);
  // node_modules: the raw slim carries the SAME trimmed host deps the webroot installed
  // ({ws, werift}; the on-device updater has no npm). Always taken from the webroot.
  const webrootNM = path.resolve(repo, 'android', 'app', 'src', 'main', 'assets', 'webroot', 'node_modules');
  if (!fs.existsSync(webrootNM)) {
    throw new Error('webroot node_modules missing — run build-webroot.mjs first');
  }
  fs.cpSync(webrootNM, path.join(tmp, 'node_modules'), { recursive: true });

  const tops = SLIM_TOP.filter((t) => fs.existsSync(path.join(tmp, t)));
  if (!tops.length) throw new Error('no slim paths assembled');
  const slimOut = path.join(dist, `content-slim-${tag}.zip`);
  fs.rmSync(slimOut, { force: true });
  if (process.platform === 'win32') {
    execFileSync('C:/Windows/System32/tar.exe', ['-a', '-c', '-f', slimOut, '-C', tmp, ...tops]);
  } else {
    execFileSync('zip', ['-qr', slimOut, ...tops], { cwd: tmp });
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(slimOut)).digest('hex');
  console.log(`raw slim bundle: ${slimOut} (${(fs.statSync(slimOut).size / 1024 / 1024).toFixed(1)} MB, buildTag ${tag})`);
  console.log(`  sha256 ${sha}`);
  console.log('  NO shell extras / patches / CDN rewrite — the Updater overlays those on-device.');
  fs.rmSync(tmp, { recursive: true, force: true });
}

/** Upstream tag is only needed for the FULL bundle filename; slim-only mode must not die on 403. */
async function upstreamTagSafe() {
  try {
    return await latestTag();
  } catch (e) {
    console.warn(`upstream tag unavailable (${e.message}) — pass --tag/--slim-only to skip`);
    return null;
  }
}

const DATA_JS = `// Generated by server/index.js — browser stand-in for server/data.js (DESIGN §14 client-side combat).
// The simulation's content modules (/sim/content/support/index.js) import getData() from here; it returns the game data
// the page injected with /sim/simdata.js setSimData(data).
import { getSimData } from './sim/simdata.js';
export function getData() { return getSimData() || {}; }
export function resetData() {}
`;

function argvValue(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

async function latestTag() {
  // GH_TOKEN (present in CI) lifts the 60 req/h unauthenticated per-IP limit —
  // the 2026-10-03 failure was exactly that 403 on a shared runner.
  const headers = { 'User-Agent': 'stronghold-shell' };
  if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const res = await fetch(UPSTREAM_API, { headers });
  if (!res.ok) throw new Error(`upstream API HTTP ${res.status}`);
  return (await res.json()).tag_name;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
