#!/usr/bin/env node
// tools/package.mjs — the two player release zips (docs/DEPLOY.md §7; README「方式一」says which one to pick).
//
//   npm run package        → Stronghold-Protocol-v<version>.zip       full: what runs the game + the game art
//   npm run package:lite   → Stronghold-Protocol-v<version>-lite.zip  the same without the art (`npm run setup`
//                            downloads it on the first start)
//   node tools/package.mjs [--lite] [--dry-run [--list]] [--out <dir>] [--force] [--keep-stage] [--no-install]
//                          [--allow-dirty] [--root <dir>]
//
// Both zips hold one folder, Stronghold-Protocol/, with only what a player runs — an allowlist over `git ls-files`, so
// untracked work, caches, logs and per-machine config never get in: server/, shared/, data/, public/ (not public/dev/),
// the start scripts, the tools a player runs (setup, vendor = the postinstall, fetch-assets + tools/assets, doctor, and
// what setup starts: tools/local-extract, crop-board-atlas), the research tables the Node server (server/sim/
// nodeData.js fallback) and fetch-assets read, package.json / package-lock.json, LICENSE / NOTICE.md /
// THIRD-PARTY-NOTICES.md, README.md, CHANGELOG.md, docs/PLAYING.md and docs/DEPLOY.md. `npm ci --omit=dev` in the
// stage adds the production node_modules and (postinstall) public/vendor. The full zip adds the git-ignored art: the
// files data/assets.json lists, public/fonts, and the local-client extraction (public/assets/local/,
// data/local-assets.json) when present — nothing else on disk, so art the data no longer lists (焰狐龙梓兰, left out of
// 自选 in 0.2.0, or files of an old mapping) never ships even when this machine still has it.
// Left out: test/, the maintainer tools (build-data, golden, botbench, i18n, check-imports, this file …),
// scripts/make-windows-bundle.mjs, the other docs (DESIGN, SIM, the research notes, docs/img …), public/dev/, handoff/,
// .github/, types/, lint / editor / Docker files (Docker builds from a git clone).
//
// Checks, all of them in --dry-run too (which writes nothing): the refusal list below; every relative import of a
// shipped module and every `node <file>` of the player npm scripts resolves to a shipped file; a full zip has every file
// data/assets.json and data/local-assets.json list; no shipped file carries a home-directory path (/Users/…,
// C:\Users\…, /home/…) or this machine's account name (text and binary, art included; node_modules only for the name);
// no shipped tracked file has an uncommitted change (--allow-dirty skips that). A build also checks that the stage holds
// exactly the plan before zipping.
// The account name comes from the OS at run time (never written in the repository): SP_PACKAGE_SCAN_USER=0 skips it
// (a name that is a common word), SP_PACKAGE_SCAN_NAMES=a,b adds more names to refuse.
//
// --out defaults to <tmp>/stronghold-protocol-release and must be outside the repository. --no-install skips npm ci
// (no node_modules, no public/vendor: a test build). Zipping needs `zip` (or a bsdtar `tar`, e.g. Windows 10+).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findSpecifiers } from './check-imports.mjs';
import { ResolverFactory } from 'oxc-resolver';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The one folder inside both zips (DEPLOY §1.1: "解压后把里面的 Stronghold-Protocol 文件夹放到…"). */
export const FOLDER = 'Stronghold-Protocol';

/** Root files a player gets. */
export const ROOT_FILES = ['package.json', 'package-lock.json', 'LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'README.md', 'CHANGELOG.md'];
/** The player docs. */
export const PLAYER_DOCS = ['docs/PLAYING.md', 'docs/DEPLOY.md'];
/** Research tables read at run time: server/sim/nodeData.js (the Node sim's fallback) and tools/fetch-assets.mjs. */
export const RUNTIME_RESEARCH = ['docs/research/03-operators.json', 'docs/research/05-enemies.json', 'docs/research/05-maps.json', 'docs/research/07-assets.json'];
/** The start scripts (scripts/make-windows-bundle.mjs is the maintainer's Windows pack, docs/WINDOWS.md). */
export const PLAYER_SCRIPTS = ['scripts/install-service-windows.ps1', 'scripts/launch.mjs', 'scripts/open-browser.mjs',
  'scripts/run-server.cmd', 'scripts/start-windows.bat', 'scripts/start-windows.ps1', 'scripts/start.sh'];
/** The tools a player runs (npm run setup / doctor / assets, the postinstall) and the ones setup starts. */
export const PLAYER_TOOLS = ['tools/crop-board-atlas.mjs', 'tools/doctor.mjs', 'tools/fetch-assets.mjs', 'tools/setup.mjs', 'tools/vendor.mjs'];
/** Whole tool directories: fetch-assets' modules, the local-client extraction setup runs. */
export const PLAYER_TOOL_DIRS = ['tools/assets/', 'tools/local-extract/'];
/** Whole runtime directories (their tracked files). */
export const RUNTIME_DIRS = ['server/', 'shared/', 'data/', 'public/'];
/** Never from the tracked list: the dev pages, and what only the art plan adds (or npm ci writes). */
const NOT_TRACKED_SHIP = ['public/dev/', 'public/assets/', 'public/fonts/', 'public/vendor/'];
/** The npm scripts a player runs: each `node <file>` of them must ship. */
export const PLAYER_NPM_SCRIPTS = ['start', 'setup', 'doctor', 'launch', 'postinstall', 'vendor', 'assets'];

/**
 * Refused in a plan and in a stage: 0.1.x's list (owner-only notes, the promo project, caches, per-machine config) and
 * what 0.2.0 leaves out on purpose. A path is refused when it is one of these or lies under one.
 */
export const REFUSE = ['pv', '3，9，11回合情况', 'review', 'docs/research/10-networking-hosting.md', '.cache', '.claude', '.git',
  'logs', 'test/e2e/out', 'scripts/service.env.cmd', '.env', 'handoff',
  'test', '.github', 'AGENTS.md', 'public/dev', 'node_modules/.cache'];

/** Home-directory paths: macOS / Linux (case as the OS writes them) and Windows (any case; / or \, JSON-escaped too). */
const HOME_POSIX = /\/Users\/[A-Za-z]|\/home\/[A-Za-z]/;
const HOME_WIN = /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[A-Za-z]/i;
/** OS account names too generic to refuse (CI runners, containers). */
const GENERIC_USERS = new Set(['root', 'user', 'admin', 'node', 'runner', 'ubuntu', 'ci', 'guest', 'app', 'build']);

export const posixRel = (rel) => String(rel).split('\\').join('/');

/** True for a path the refusal list names (or lies under), a `.env` file or a `.venv*` directory anywhere. */
export function isRefused(rel) {
  const p = posixRel(rel);
  const parts = p.split('/');
  const base = parts[parts.length - 1];
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (parts.some((s) => s.startsWith('.venv'))) return true;
  return REFUSE.some((r) => p === r || p.startsWith(`${r}/`));
}

/** OS / editor / Python clutter that never ships (the old rsync excludes). */
export function isJunk(rel) {
  const parts = posixRel(rel).split('/');
  const base = parts[parts.length - 1];
  if (parts.includes('__pycache__')) return true;
  if (base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini' || base.startsWith('._')) return true;
  return /\.(?:py[cod]|log|tmp|swp)$/i.test(base);
}

/** Whether a tracked file belongs in the player package. */
export function isPlayerFile(rel) {
  const p = posixRel(rel);
  if (!p || isRefused(p) || isJunk(p) || p === 'data/local-assets.json') return false;
  if (NOT_TRACKED_SHIP.some((d) => p.startsWith(d))) return false;
  if (RUNTIME_DIRS.some((d) => p.startsWith(d)) || PLAYER_TOOL_DIRS.some((d) => p.startsWith(d))) return true;
  return ROOT_FILES.includes(p) || PLAYER_DOCS.includes(p) || RUNTIME_RESEARCH.includes(p) || PLAYER_SCRIPTS.includes(p) || PLAYER_TOOLS.includes(p);
}

/**
 * Split tracked paths into what ships and what is left out (both sorted).
 * @param {string[]} paths
 * @returns {{ keep: string[], drop: string[] }}
 */
export function selectTracked(paths) {
  const keep = [];
  const drop = [];
  for (const raw of paths) {
    const p = posixRel(raw);
    if (p) (isPlayerFile(p) ? keep : drop).push(p);
  }
  return { keep: keep.sort(), drop: drop.sort() };
}

export function trackedFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error('git ls-files failed: the package takes tracked files only, run it in a git checkout');
  return r.stdout.toString('utf8').split('\0').filter(Boolean);
}

/** Tracked files of `files` with uncommitted changes (staged or not). */
export function dirtyFiles(root, files) {
  const r = spawnSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=no'], { maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error('git status failed');
  const want = new Set(files);
  const out = [];
  const parts = r.stdout.toString('utf8').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    if (e[0] === 'R' || e[0] === 'C') i++; // the rename's source follows
    const p = e.slice(3);
    if (want.has(p)) out.push(p);
  }
  return out.sort();
}

const isFile = (abs) => { try { return fs.statSync(abs).isFile(); } catch { return false; } };
const fileBytes = (abs) => { try { return fs.statSync(abs).size; } catch { return 0; } };
const readJson = (abs) => { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } };

/** Files under root/rel (following symlinks), as posix paths relative to root; junk left out unless `junk`. */
export function listTree(root, rel, { junk = false } = {}) {
  const out = [];
  const walk = (abs, r) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const child = r ? `${r}/${e.name}` : e.name;
      if (!junk && isJunk(child)) continue;
      const a = path.join(abs, e.name);
      let st;
      try { st = fs.statSync(a); } catch { continue; }
      if (st.isDirectory()) walk(a, child);
      else if (st.isFile()) out.push(child);
    }
  };
  walk(path.join(root, rel), posixRel(rel));
  return out.sort();
}

/** The '/assets/…' and '/fonts/…' URLs of a manifest, as public/… paths (the walk of tools/setup.mjs checkAssets). */
export function manifestFiles(manifest) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (/^\/(?:assets|fonts)\//.test(v)) out.add(`public/${v.split('/').filter(Boolean).map(decodeURIComponent).join('/')}`);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(manifest);
  return out;
}

/**
 * The art of a full package: every file data/assets.json lists, public/fonts, public/assets/local/ and
 * data/local-assets.json (when present). `missing`: listed files not on disk; `orphans`: files under public/assets
 * that nothing lists (left out).
 */
export function artPlan(root, { lite = false } = {}) {
  if (lite) return { files: [], missing: [], orphans: [], local: false };
  const listed = manifestFiles(readJson(path.join(root, 'data', 'assets.json')) ?? {});
  const local = isFile(path.join(root, 'data', 'local-assets.json'));
  if (local) for (const f of manifestFiles(readJson(path.join(root, 'data', 'local-assets.json')) ?? {})) listed.add(f);
  const files = new Set();
  const missing = [];
  for (const f of listed) {
    if (isFile(path.join(root, f))) files.add(f);
    else missing.push(f);
  }
  for (const f of listTree(root, 'public/fonts')) files.add(f);
  if (local) {
    for (const f of listTree(root, 'public/assets/local')) files.add(f);
    files.add('data/local-assets.json');
  }
  // without case: on Windows / macOS a file whose name differs only in case is the listed one (fetch-assets orphanFiles)
  const lower = new Set([...files].map((f) => f.toLowerCase()));
  const orphans = listTree(root, 'public/assets').filter((f) => !lower.has(f.toLowerCase()));
  return { files: [...files].sort(), missing: missing.sort(), orphans, local };
}

const URL_MOUNTS = [['/data/', 'data/'], ['/shared/', 'shared/'], ['/sim/', 'server/sim/']];

/** The repository path an import specifier of `fromRel` names, or null (an npm package or a Node builtin). */
export function resolveSpecifier(fromRel, spec) {
  const s = spec.replace(/[?#].*$/, '');
  if (s.startsWith('./') || s.startsWith('../')) return path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), s));
  if (!s.startsWith('/')) return null;
  for (const [prefix, dir] of URL_MOUNTS) if (s.startsWith(prefix)) return dir + s.slice(prefix.length);
  return `public${s}`; // the server's static mounts (server/http/static.js)
}

/**
 * Imports of shipped modules that name a repository file the package lacks. public/vendor/ is npm ci's postinstall
 * output. Only existing files participate in this closure check.
 */
export function importProblems(root, files) {
  const shipped = new Set(files);
  const out = [];
  // Native ESM URLs need exact files: do not infer extensions or directory indexes.
  const resolver = new ResolverFactory({ fullySpecified: true, extensions: [], mainFiles: [], symlinks: false });
  for (const rel of files) {
    if (!/\.(?:m?js|cjs)$/.test(rel)) continue;
    let src;
    try { src = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    for (const { spec, line } of findSpecifiers(src)) {
      const target = resolveSpecifier(rel, spec);
      if (!target || shipped.has(target) || target.startsWith('public/vendor/')) continue;
      const resolved = resolver.sync(root, `./${target}`);
      if (!resolved.path) continue;
      out.push(`${rel}:${line} imports ${spec} (not shipped)`);
    }
  }
  return out;
}

/** The player npm scripts (and `main`) must start shipped files. */
export function entryProblems(pkg, files) {
  const shipped = new Set(files);
  const out = [];
  if (pkg?.main && !shipped.has(pkg.main)) out.push(`package.json main ${pkg.main} is not shipped`);
  for (const name of PLAYER_NPM_SCRIPTS) {
    const cmd = pkg?.scripts?.[name];
    if (!cmd) { out.push(`npm script "${name}" is missing`); continue; }
    for (const m of cmd.matchAll(/\bnode\s+(?:--[\w-]+\s+)*([\w./-]+\.m?js)\b/g)) {
      if (!shipped.has(m[1])) out.push(`npm run ${name}: ${m[1]} is not shipped`);
    }
  }
  return out;
}

/**
 * Names refused in the personal scan: this machine's account name (unless SP_PACKAGE_SCAN_USER=0, a generic or short
 * one) and SP_PACKAGE_SCAN_NAMES (comma-separated).
 */
export function scanNames(env = process.env) {
  const names = [];
  if (env.SP_PACKAGE_SCAN_USER !== '0') {
    let user = '';
    try { user = os.userInfo().username; } catch { /* no passwd entry */ }
    if (user.length >= 3 && !GENERIC_USERS.has(user.toLowerCase())) names.push(user);
  }
  for (const n of String(env.SP_PACKAGE_SCAN_NAMES || '').split(',')) if (n.trim().length >= 3) names.push(n.trim());
  return [...new Set(names)];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Files whose bytes (read as latin1, so binaries are scanned too) carry a home-directory path (`home`) or one of
 * `names` (case-insensitive). Returns "path (what)" lines, never the matched text.
 */
export function scanFiles(root, files, { home = true, names = [] } = {}) {
  const nameRe = names.length ? new RegExp(names.map((n) => escapeRe(Buffer.from(n, 'utf8').toString('latin1'))).join('|'), 'i') : null;
  const hits = [];
  for (const rel of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel)).toString('latin1'); } catch { continue; }
    if (home && (HOME_POSIX.test(text) || HOME_WIN.test(text))) hits.push(`${rel} (home-directory path)`);
    else if (nameRe && nameRe.test(text)) hits.push(`${rel} (account name)`);
  }
  return hits;
}

/** Production lockfile entries present under root/node_modules, as file lists relative to root. */
function prodModuleFiles(root, lock) {
  const out = [];
  for (const [key, entry] of Object.entries(lock?.packages || {})) {
    if (!key.startsWith('node_modules/') || entry.dev || entry.link) continue;
    for (const f of listTree(root, key)) if (!f.slice(key.length + 1).includes('node_modules/')) out.push(f);
  }
  return out;
}

const sumBytes = (root, files) => files.reduce((n, f) => n + fileBytes(path.join(root, f)), 0);

/** Group left-out paths for the summary: `test/`, `tools/`, `docs/research/`, `(root)` … */
function groupOf(rel) {
  const s = rel.split('/');
  if (s.length === 1) return '(root)';
  if ((s[0] === 'docs' || s[0] === 'public') && s.length > 2) return `${s[0]}/${s[1]}/`;
  return `${s[0]}/`;
}

/**
 * Everything a package would hold, with every check: no copying, no install. `scan: false` skips the personal-info
 * scan and `measure: false` the node_modules / public/vendor sizes (tests that only want the selection).
 * @param {string} root
 * @param {{ lite?: boolean, paths?: string[], allowDirty?: boolean, env?: object, scan?: boolean, measure?: boolean }} [opts]
 */
export function plan(root, opts = {}) {
  const lite = !!opts.lite;
  const all = (opts.paths || trackedFiles(root)).map(posixRel);
  const { keep, drop } = selectTracked(all);
  const art = artPlan(root, { lite });
  const pkg = readJson(path.join(root, 'package.json')) || {};
  const lock = readJson(path.join(root, 'package-lock.json')) || {};
  const files = [...keep, ...art.files];
  const problems = [];
  for (const f of files) if (isRefused(f) || isJunk(f)) problems.push(`refused: ${f}`);
  const byCase = new Map();
  for (const f of files) {
    const k = f.toLowerCase();
    if (byCase.has(k)) problems.push(`paths differ only in case (one file on Windows / macOS): ${byCase.get(k)} / ${f}`);
    else byCase.set(k, f);
  }
  for (const f of keep) if (!isFile(path.join(root, f))) problems.push(`missing tracked file: ${f}`);
  for (const f of art.missing) problems.push(`missing art: ${f} (data/assets.json lists it; run npm run setup, or build --lite)`);
  if (!lite && !art.files.some((f) => f.startsWith('public/assets/'))) problems.push('no art under public/assets: run npm run setup first, or build --lite');
  for (const p of importProblems(root, keep)) problems.push(p);
  for (const p of entryProblems(pkg, keep)) problems.push(p);
  if (!opts.allowDirty) for (const f of dirtyFiles(root, keep)) problems.push(`uncommitted change: ${f} (commit it, or --allow-dirty)`);
  const names = scanNames(opts.env || process.env);
  const modules = opts.measure !== false || (opts.scan !== false && names.length) ? prodModuleFiles(root, lock) : [];
  let scanned = 0;
  if (opts.scan !== false) {
    for (const h of scanFiles(root, files, { home: true, names })) problems.push(`personal info: ${h}`);
    for (const h of scanFiles(root, modules, { home: false, names })) problems.push(`personal info: ${h}`);
    scanned = files.length + (names.length ? modules.length : 0);
  }
  const dropped = {};
  for (const f of drop) {
    const g = groupOf(f);
    dropped[g] ??= { files: 0, bytes: 0 };
    dropped[g].files++;
    dropped[g].bytes += fileBytes(path.join(root, f));
  }
  const trackedBytes = sumBytes(root, keep);
  const artBytes = sumBytes(root, art.files);
  const orphanBytes = sumBytes(root, art.orphans);
  const modulesBytes = sumBytes(root, modules);
  const vendorBytes = opts.measure !== false ? sumBytes(root, listTree(root, 'public/vendor')) : 0;
  const dropBytes = Object.values(dropped).reduce((n, g) => n + g.bytes, 0);
  return {
    version: pkg.version || '0.0.0', lite, tracked: keep, art: art.files, files, dropped, orphans: art.orphans,
    localArt: art.local, problems, names: names.length, scanned,
    bytes: {
      tracked: trackedBytes, art: artBytes, modules: modulesBytes, vendor: vendorBytes,
      total: trackedBytes + artBytes + modulesBytes + vendorBytes,
      // what 0.1.x's whole-tree layout adds on top: every other tracked file and (full) the art nothing lists
      leftOut: dropBytes + (lite ? 0 : orphanBytes), orphans: orphanBytes,
    },
  };
}

const MB = (n) => `${(n / 1048576).toFixed(1)} MB`;

export function formatSummary(p) {
  const lines = [
    `package: ${p.lite ? 'lite (no game art)' : 'full'} · version ${p.version}`,
    `tracked: ${p.tracked.length} files, ${MB(p.bytes.tracked)}`,
  ];
  if (!p.lite) {
    lines.push(`art: ${p.art.length} files, ${MB(p.bytes.art)} (data/assets.json, public/fonts${p.localArt ? ', public/assets/local + data/local-assets.json' : '; no local-client art here'})`);
  }
  lines.push(`production node_modules: ${MB(p.bytes.modules)} · public/vendor: ${MB(p.bytes.vendor)} (npm ci --omit=dev and its postinstall)`);
  lines.push(`uncompressed: ${MB(p.bytes.total)}; a 0.1.x whole-tree copy would add ${MB(p.bytes.leftOut)}`);
  const groups = Object.entries(p.dropped).sort((a, b) => b[1].bytes - a[1].bytes);
  if (groups.length) lines.push(`left out: ${groups.map(([g, v]) => `${g} ${v.files} (${MB(v.bytes)})`).join(', ')}`);
  if (!p.lite && p.orphans.length) lines.push(`left out art: ${p.orphans.length} files under public/assets that nothing lists (${MB(p.bytes.orphans)})`);
  lines.push(`personal-info scan: ${p.scanned} files, ${p.names ? `home paths + ${p.names} account name(s)` : 'home paths only (no account name to refuse)'}`);
  lines.push(p.problems.length ? `PROBLEMS (${p.problems.length}):\n${p.problems.map((x) => `  ${x}`).join('\n')}` : 'checks: ok');
  return lines.join('\n') + '\n';
}

/** True when `out` is the repository, inside it, or a parent of it. */
export function packageOutIsUnsafe(out, root = REPO) {
  const r = path.resolve(root);
  const o = path.resolve(out);
  if (o === r) return true;
  const inside = (a, b) => { const rel = path.relative(a, b); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
  return inside(r, o) || inside(o, r);
}

function zipFolder(cwd, zipPath) {
  // deflate everything: storing PNG / MP3 as they are made the full zip 8.5 MB larger and saved no real time
  const z = spawnSync('zip', ['-q', '-r', '-X', zipPath, FOLDER], { cwd, stdio: 'inherit' });
  if (!z.error && z.status === 0) return;
  const t = spawnSync('tar', ['-c', '--format', 'zip', '-f', zipPath, FOLDER], { cwd, stdio: 'inherit' }); // bsdtar (Windows 10+, macOS)
  if (t.error || t.status !== 0 || !isFile(zipPath)) throw new Error('zipping failed: install `zip` (or a bsdtar `tar`)');
}

/** Copy the plan into <out>/<name>/Stronghold-Protocol, npm ci, check the stage, zip it. */
export function build(root, p, { out, install = true, force = false, keepStage = false, env = process.env, log = console.log } = {}) {
  if (p.problems.length) throw new Error('refusing to build: the plan has problems (see the summary)');
  const dest = path.resolve(out);
  if (packageOutIsUnsafe(dest, root)) throw new Error(`refusing to write into the repository or a parent of it: ${dest}`);
  const name = `${FOLDER}-v${p.version}${p.lite ? '-lite' : ''}`; // 0.1.x's release asset names
  const work = path.join(dest, name);
  const stage = path.join(work, FOLDER);
  const zipPath = path.join(dest, `${name}.zip`);
  for (const t of [work, zipPath]) {
    if (!fs.existsSync(t)) continue;
    if (!force) throw new Error(`${t} already exists (--force replaces it)`);
    fs.rmSync(t, { recursive: true, force: true });
  }
  log(`copying ${p.files.length} files → ${stage}`);
  for (const rel of p.files) {
    const src = path.join(root, rel);
    const to = path.join(stage, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(src, to, fs.constants.COPYFILE_FICLONE);
    fs.chmodSync(to, fs.statSync(src).mode & 0o777);
  }
  if (install) {
    log('npm ci --omit=dev …');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const r = spawnSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.error || r.status !== 0) throw new Error('npm ci --omit=dev failed in the stage');
    fs.rmSync(path.join(stage, 'node_modules', '.cache'), { recursive: true, force: true });
    if (!isFile(path.join(stage, 'public', 'vendor', 'pixi.min.js'))) throw new Error('public/vendor/pixi.min.js missing after npm ci (postinstall tools/vendor.mjs)');
  }
  const problems = [];
  const planned = new Set(p.files);
  const staged = listTree(stage, '', { junk: true });
  const rest = staged.filter((f) => !f.startsWith('node_modules/') && !f.startsWith('public/vendor/'));
  for (const f of rest) if (!planned.has(f)) problems.push(`in the stage but not planned: ${f}`);
  const have = new Set(rest);
  for (const f of p.files) if (!have.has(f)) problems.push(`planned but not staged: ${f}`);
  for (const r of REFUSE) if (fs.existsSync(path.join(stage, r))) problems.push(`refused: ${r} is in the stage`);
  const names = scanNames(env);
  for (const h of scanFiles(stage, rest, { home: true, names })) problems.push(`personal info: ${h}`);
  const libs = staged.filter((f) => f.startsWith('node_modules/') || f.startsWith('public/vendor/'));
  for (const h of scanFiles(stage, libs, { home: false, names })) problems.push(`personal info: ${h}`);
  if (problems.length) throw new Error(`refusing to zip ${stage}:\n${problems.map((x) => `  ${x}`).join('\n')}`);
  log(`zipping ${staged.length} files (${MB(sumBytes(stage, staged))}) → ${zipPath}`);
  zipFolder(work, zipPath);
  if (!keepStage) fs.rmSync(work, { recursive: true, force: true });
  return { zipPath, zipBytes: fileBytes(zipPath), files: staged.length, stage: keepStage ? stage : null };
}

const USAGE = 'usage: node tools/package.mjs [--lite] [--dry-run [--list]] [--out <dir>] [--force] [--keep-stage] [--no-install] [--allow-dirty] [--allow-dev] [--root <dir>]';

/** Whether `version` is a development (pre-release) version, e.g. 0.2.0-dev. */
export const isDevVersion = (version) => /-/.test(String(version || ''));

export function parseArgs(argv) {
  const o = { lite: false, dryRun: false, list: false, out: '', force: false, keepStage: false, install: true, allowDirty: false, allowDev: false, root: REPO, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lite') o.lite = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--list') o.list = true;
    else if (a === '--force') o.force = true;
    else if (a === '--keep-stage') o.keepStage = true;
    else if (a === '--no-install') o.install = false;
    else if (a === '--allow-dirty') o.allowDirty = true;
    else if (a === '--allow-dev') o.allowDev = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--out' || a === '--root') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a directory\n${USAGE}`);
      o[a.slice(2)] = path.resolve(v);
    } else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  return o;
}

function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`package: ${e.message}`); return 2; }
  if (o.help) { console.log(USAGE); return 0; }
  let p;
  try { p = plan(o.root, { lite: o.lite, allowDirty: o.allowDirty }); } catch (e) { console.error(`package: ${e.message}`); return 1; }
  process.stdout.write(formatSummary(p));
  if (o.dryRun) {
    if (o.list) for (const f of p.files) process.stdout.write(`file ${f}\n`);
    return p.problems.length ? 1 : 0;
  }
  if (p.problems.length) return 1;
  // a development version (0.2.0-dev on the public dev branch) never becomes a release zip by accident: its name carries
  // the version, and building one needs --allow-dev (a test build, not a release)
  if (isDevVersion(p.version) && !o.allowDev) {
    console.error(`package: v${p.version} is a development version — a release zip needs a release version; --allow-dev builds a test zip named after it`);
    return 1;
  }
  try {
    const r = build(o.root, p, { out: o.out || path.join(os.tmpdir(), 'stronghold-protocol-release'), install: o.install, force: o.force, keepStage: o.keepStage });
    console.log(`zip: ${r.zipPath} (${MB(r.zipBytes)}, ${r.files} files)${r.stage ? ` · stage kept: ${r.stage}` : ''}`);
    return 0;
  } catch (e) {
    console.error(`package: ${e.message}`);
    return 1;
  }
}

const invoked = (() => { try { return pathToFileURL(fs.realpathSync(process.argv[1] || '')).href; } catch { return null; } })();
if (invoked === import.meta.url) process.exitCode = main(process.argv.slice(2));
