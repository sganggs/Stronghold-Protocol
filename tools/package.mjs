#!/usr/bin/env node
// tools/package.mjs — the player release zips (docs/DEPLOY.md §7; README「方式一」says which one to pick).
//
//   npm run package        → Stronghold-Protocol-v<version>.zip         full: what runs the game + the game art
//   npm run package:lite   → Stronghold-Protocol-v<version>-lite.zip    the same without the art (`npm run setup`
//                            downloads it on the first start)
//   node tools/package.mjs --update --from <base>[,<base>…]
//                          → Stronghold-Protocol-v<version>-update.zip  only the files that differ from the earlier full
//                            zips given as bases, to extract over an install of one of them (server/update.js)
//   node tools/package.mjs [--lite | --update --from <bases>] [--dry-run [--list]] [--out <dir>] [--force] [--keep-stage]
//                          [--no-install] [--allow-dirty] [--allow-dev] [--root <dir>]
//
// The zips hold one folder, Stronghold-Protocol/, with only what a player runs — an allowlist over `git ls-files`, so
// untracked work, caches, logs and per-machine config never get in: server/, shared/, data/, public/ (not public/dev/),
// packs/ (the content packs that ship with the repository, docs/PACKS.md; a pack installed on this machine and not
// committed stays out),
// the start scripts, the tools a player runs (setup, vendor = the postinstall, fetch-assets + tools/assets, doctor, and
// what setup starts: tools/local-extract, crop-board-atlas), the research tables the Node server (server/sim/
// nodeData.js fallback) and fetch-assets read, package.json / package-lock.json, LICENSE / NOTICE.md /
// THIRD-PARTY-NOTICES.md, README.md, CHANGELOG.md, docs/PLAYING.md and docs/DEPLOY.md. `npm ci --omit=dev` in the
// stage adds the production node_modules and (postinstall) public/vendor. The full zip adds the git-ignored art: the
// files data/assets.json lists, public/fonts, and the local-client extraction (public/assets/local/,
// data/local-assets.json) when present — nothing else on disk, so art the data no longer lists (焰狐龙梓兰, left out of
// 自选 in 0.2.0, or files of an old mapping) never ships even when this machine still has it. FULL_ZIP_JP_VOICE (below)
// decides whether the full zip carries the Japanese voice dub too (default: yes).
// Left out: test/, the maintainer tools (build-data, golden, botbench, i18n, check-imports, this file …),
// scripts/make-windows-bundle.mjs, the other docs (DESIGN, SIM, the research notes, docs/img …), public/dev/, handoff/,
// .github/, types/, lint / editor / Docker files (Docker builds from a git clone).
//
// Checks, all of them in --dry-run too (which writes nothing): the refusal list below; every relative import of a
// shipped module and every `node <file>` of the player npm scripts resolves to a shipped file; a full zip has every file
// data/assets.json and data/local-assets.json list; no shipped file carries a home-directory path (/Users/…,
// C:\Users\…, /home/…) or this machine's account name (text and binary, art included; node_modules only for the name);
// no shipped tracked file has an uncommitted change (--allow-dirty skips that). A build also checks that the stage holds
// exactly the plan before zipping. Generated into the stage: packs/index.json, the pack index of the shipped packs
// (tools/packs.mjs writePackIndex — what the server's GET /packs/index.json answers, for a static host), when any pack
// ships (a language file of public/i18n/, a packs/<id>/pack.json).
// The account name comes from the OS at run time (never written in the repository): SP_PACKAGE_SCAN_USER=0 skips it
// (a name that is a common word), SP_PACKAGE_SCAN_NAMES=a,b adds more names to refuse.
//
// Every zip carries MANIFEST.json at its root (written after npm ci; server/update.js): the size and sha256 of each
// shipped file except the art setup manages (public/assets/, public/fonts/, data/assets.json, data/local-assets.json) —
// what npm run doctor and an update's boot step verify; the full, lite and update zips of one version list the same.
//
// --update builds the full stage as above (npm ci and all) in <out>/…-update/.full/, reads every base — an earlier
// release's full zip or the folder it was extracted to (tools/package-update.mjs: older than this version, not a lite or
// update zip, each version once) — and ships each file that is new or differs (size + sha256) from at least one base,
// plus MANIFEST.json and UPDATE.json (the base versions, what ships, and `removed`: the files a base shipped that this
// version does not, with the bytes each base had). The update stage gets the same checks (the refusal list, the
// personal-info scan; it must hold exactly that) before it is zipped. --dry-run reads and checks the bases; the
// comparison needs the built stage.
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
import { writePackIndex } from './packs.mjs';
import { compareVersions, diffBases, manifestText, readBase, updateText } from './package-update.mjs';
import {
  APPLIED_FILE, MANIFEST_FILE, UPDATE_FILE, affectsRuntime, digestFile, inManifest, isSetupArt, listedArtFiles,
  parseManifest, parseUpdate, pathProblem, removalProblem,
} from '../server/update.js';

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
export const RUNTIME_DIRS = ['server/', 'shared/', 'data/', 'public/', 'packs/'];
/** Written into the stage, never taken from the checkout: the pack index of the shipped packs. */
export const GENERATED_PACK_INDEX = 'packs/index.json';
/** Whether shipped files include a content pack (then the stage gets GENERATED_PACK_INDEX). @param {string[]} files */
export const shipsPacks = (files) => files.some((f) => /^public\/i18n\/[^/]+\.json$/.test(f) || /^packs\/[^/]+\/pack\.json$/.test(f));
/** Never from the tracked list: the dev pages, and what only the art plan adds (or npm ci writes). */
const NOT_TRACKED_SHIP = ['public/dev/', 'public/assets/', 'public/fonts/', 'public/vendor/'];
/** The npm scripts a player runs: each `node <file>` of them must ship. */
export const PLAYER_NPM_SCRIPTS = ['start', 'setup', 'doctor', 'launch', 'postinstall', 'vendor', 'assets'];

/**
 * THE SWITCH for the Japanese voice dub in the full zip (`audio.voiceJp` of data/assets.json: 2674 files under
 * public/assets/audio/voice/jp/, 89,388,041 bytes = 85.2 MiB on disk, about 76 MB zipped). true (0.2.2): the full zip ships both
 * dubs, so it still runs with nothing to download. false: the full zip (and an update zip built from it) leaves the JP
 * files out — setup downloads them on the first start like the lite zip's art, the 日本語 setting plays the Chinese line
 * until then (public/js/audio.js voiceLine), and an update never deletes a player's copy (`held`). The lite zip carries
 * no art either way.
 */
export const FULL_ZIP_JP_VOICE = true;
/** Where the JP dub lies (plan.mjs voiceAlt: audio/voice/<lang>/<charId>/<file>). */
export const JP_VOICE_DIR = 'public/assets/audio/voice/jp/';

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
  if (!p || isRefused(p) || isJunk(p) || p === 'data/local-assets.json' || p === GENERATED_PACK_INDEX) return false;
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
export const manifestFiles = listedArtFiles;

/**
 * The art of a full package: every file data/assets.json lists, public/fonts, public/assets/local/ and
 * data/local-assets.json (when present). `missing`: listed files not on disk; `orphans`: files under public/assets
 * that nothing lists (left out); `held`: listed files the zip holds back on purpose — the JP voice dub when `jpVoice`
 * (FULL_ZIP_JP_VOICE) is off: neither shipped nor missing, and never deleted by an update.
 */
export function artPlan(root, { lite = false, jpVoice = FULL_ZIP_JP_VOICE } = {}) {
  if (lite) return { files: [], missing: [], orphans: [], held: [], local: false };
  const listed = manifestFiles(readJson(path.join(root, 'data', 'assets.json')) ?? {});
  const local = isFile(path.join(root, 'data', 'local-assets.json'));
  if (local) for (const f of manifestFiles(readJson(path.join(root, 'data', 'local-assets.json')) ?? {})) listed.add(f);
  const files = new Set();
  const missing = [];
  const held = [];
  for (const f of listed) {
    if (!jpVoice && f.startsWith(JP_VOICE_DIR)) held.push(f);
    else if (isFile(path.join(root, f))) files.add(f);
    else missing.push(f);
  }
  for (const f of listTree(root, 'public/fonts')) files.add(f);
  if (local) {
    for (const f of listTree(root, 'public/assets/local')) files.add(f);
    files.add('data/local-assets.json');
  }
  // without case: on Windows / macOS a file whose name differs only in case is the listed one (fetch-assets orphanFiles)
  const lower = new Set([...files, ...held].map((f) => f.toLowerCase()));
  const orphans = listTree(root, 'public/assets').filter((f) => !lower.has(f.toLowerCase()));
  return { files: [...files].sort(), missing: missing.sort(), orphans, held: held.sort(), local };
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
 * `names` (case-insensitive). Returns "path (what)" lines, never the matched text. `strip`: text removed before the
 * scan (the sha256 values of MANIFEST.json / UPDATE.json, which a hex-only name would match).
 */
export function scanFiles(root, files, { home = true, names = [], strip = null } = {}) {
  const nameRe = names.length ? new RegExp(names.map((n) => escapeRe(Buffer.from(n, 'utf8').toString('latin1'))).join('|'), 'i') : null;
  const hits = [];
  for (const rel of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel)).toString('latin1'); } catch { continue; }
    if (strip) text = text.replace(strip, '');
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
 * @param {{ lite?: boolean, paths?: string[], allowDirty?: boolean, env?: object, scan?: boolean, measure?: boolean,
 *   jpVoice?: boolean }} [opts] jpVoice: the full zip's JP dub (default FULL_ZIP_JP_VOICE)
 */
export function plan(root, opts = {}) {
  const lite = !!opts.lite;
  const all = (opts.paths || trackedFiles(root)).map(posixRel);
  const { keep, drop } = selectTracked(all);
  const art = artPlan(root, { lite, jpVoice: opts.jpVoice ?? FULL_ZIP_JP_VOICE });
  const pkg = readJson(path.join(root, 'package.json')) || {};
  const lock = readJson(path.join(root, 'package-lock.json')) || {};
  const generated = shipsPacks(keep) ? [GENERATED_PACK_INDEX] : [];
  const files = [...keep, ...art.files, ...generated];
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
    version: pkg.version || '0.0.0', lite, tracked: keep, art: art.files, generated, files, dropped, orphans: art.orphans,
    held: art.held, localArt: art.local, problems, names: names.length, scanned,
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
  if (p.generated?.length) lines.push(`generated: ${p.generated.join(', ')} (the pack index of the shipped packs, for a static host)`);
  lines.push(`production node_modules: ${MB(p.bytes.modules)} · public/vendor: ${MB(p.bytes.vendor)} (npm ci --omit=dev and its postinstall)`);
  lines.push(`uncompressed: ${MB(p.bytes.total)}; a 0.1.x whole-tree copy would add ${MB(p.bytes.leftOut)}`);
  const groups = Object.entries(p.dropped).sort((a, b) => b[1].bytes - a[1].bytes);
  if (groups.length) lines.push(`left out: ${groups.map(([g, v]) => `${g} ${v.files} (${MB(v.bytes)})`).join(', ')}`);
  if (!p.lite && p.orphans.length) lines.push(`left out art: ${p.orphans.length} files under public/assets that nothing lists (${MB(p.bytes.orphans)})`);
  if (!p.lite && p.held?.length) lines.push(`held back: ${p.held.length} files of the JP voice dub (FULL_ZIP_JP_VOICE off: setup downloads them on the first start)`);
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

/**
 * Zip `cwd`/FOLDER into `zipPath`: Info-ZIP `zip`, else a bsdtar `tar --format zip` (Windows 10+, macOS). bsdtar writes
 * the names in UTF-8 (flag bit 11) only when told: its default is the system code page, which loses a name it cannot
 * spell (卫戍 becomes ?? on Windows code page 1252) and leaves no UTF-8 copy for a reader.
 */
export function zipFolder(cwd, zipPath) {
  // deflate everything: storing PNG / MP3 as they are made the full zip 8.5 MB larger and saved no real time
  const z = spawnSync('zip', ['-q', '-r', '-X', zipPath, FOLDER], { cwd, stdio: 'inherit' });
  if (!z.error && z.status === 0) return;
  const t = spawnSync('tar', ['-c', '--format', 'zip', '--options', 'zip:hdrcharset=UTF-8', '-f', zipPath, FOLDER], { cwd, stdio: 'inherit' });
  if (t.error || t.status !== 0 || !isFile(zipPath)) throw new Error('zipping failed: install `zip` (or a bsdtar `tar`)');
}

const isLib = (f) => f.startsWith('node_modules/') || f.startsWith('public/vendor/');
const META_FILES = new Set([MANIFEST_FILE, UPDATE_FILE]);
const HASHES = /[0-9a-f]{64}/g;

/**
 * What is wrong with a stage before it is zipped: a file not planned, a planned one missing (node_modules and
 * public/vendor, npm ci's output, only count when `libsPlanned`), a refused path, personal info (home paths and names
 * in every file, names only in the libraries; MANIFEST.json / UPDATE.json without their sha256 values).
 * @param {string} stage
 * @param {Set<string>} planned
 * @returns {{ staged: string[], problems: string[] }}
 */
export function stageProblems(stage, planned, { env = process.env, libsPlanned = false } = {}) {
  const problems = [];
  const staged = listTree(stage, '', { junk: true });
  const held = libsPlanned ? staged : staged.filter((f) => !isLib(f));
  for (const f of held) if (!planned.has(f)) problems.push(`in the stage but not planned: ${f}`);
  const have = new Set(held);
  for (const f of planned) if (!have.has(f)) problems.push(`planned but not staged: ${f}`);
  for (const r of REFUSE) if (fs.existsSync(path.join(stage, r))) problems.push(`refused: ${r} is in the stage`);
  const names = scanNames(env);
  const rest = staged.filter((f) => !isLib(f));
  for (const h of scanFiles(stage, rest.filter((f) => !META_FILES.has(f)), { home: true, names })) problems.push(`personal info: ${h}`);
  for (const h of scanFiles(stage, rest.filter((f) => META_FILES.has(f)), { home: true, names, strip: HASHES })) problems.push(`personal info: ${h}`);
  for (const h of scanFiles(stage, staged.filter(isLib), { home: false, names })) problems.push(`personal info: ${h}`);
  return { staged, problems };
}

function digestOf(root, rel) {
  const d = digestFile(path.join(root, rel));
  if (!d) throw new Error(`cannot read ${path.join(root, rel)}`);
  return d;
}

function copyInto(from, to, rel) {
  const src = path.join(from, rel);
  const dst = path.join(to, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst, fs.constants.COPYFILE_FICLONE);
  fs.chmodSync(dst, fs.statSync(src).mode & 0o777);
}

function freshTargets(targets, force) {
  for (const t of targets) {
    if (!fs.existsSync(t)) continue;
    if (!force) throw new Error(`${t} already exists (--force replaces it)`);
    fs.rmSync(t, { recursive: true, force: true });
  }
}

/**
 * Copy the plan into `stage`, write the pack index, npm ci (node_modules, public/vendor), write MANIFEST.json, check the
 * stage: what `build` zips and `buildUpdate` compares. Throws on a problem. Returns the staged files.
 */
function makeStage(root, p, stage, { install, env, log }) {
  const generated = new Set(p.generated || []);
  log(`copying ${p.files.length - generated.size} files → ${stage}`);
  for (const rel of p.files) if (!generated.has(rel)) copyInto(root, stage, rel);
  if (generated.has(GENERATED_PACK_INDEX)) {
    const index = writePackIndex(stage, path.join(stage, GENERATED_PACK_INDEX));
    log(`${GENERATED_PACK_INDEX}: ${index.packs.map((x) => `${x.type} ${x.id}`).join(', ') || 'no pack'}`);
  }
  if (install) {
    log('npm ci --omit=dev …');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const r = spawnSync(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.error || r.status !== 0) throw new Error('npm ci --omit=dev failed in the stage');
    fs.rmSync(path.join(stage, 'node_modules', '.cache'), { recursive: true, force: true });
    if (!isFile(path.join(stage, 'public', 'vendor', 'pixi.min.js'))) throw new Error('public/vendor/pixi.min.js missing after npm ci (postinstall tools/vendor.mjs)');
  }
  const files = new Map();
  for (const f of listTree(stage, '', { junk: true })) if (inManifest(f)) files.set(f, digestOf(stage, f));
  fs.writeFileSync(path.join(stage, MANIFEST_FILE), manifestText({ app: p.version, files }));
  parseManifest(fs.readFileSync(path.join(stage, MANIFEST_FILE), 'utf8')); // as doctor and an update read it back
  log(`${MANIFEST_FILE}: ${files.size} files (the art is setup's)`);
  const { staged, problems } = stageProblems(stage, new Set([...p.files, MANIFEST_FILE]), { env });
  if (problems.length) throw new Error(`refusing to zip ${stage}:\n${problems.map((x) => `  ${x}`).join('\n')}`);
  return staged;
}

/** Copy the plan into <out>/<name>/Stronghold-Protocol, npm ci, write MANIFEST.json, check the stage, zip it. */
export function build(root, p, { out, install = true, force = false, keepStage = false, env = process.env, log = console.log } = {}) {
  if (p.problems.length) throw new Error('refusing to build: the plan has problems (see the summary)');
  const dest = path.resolve(out);
  if (packageOutIsUnsafe(dest, root)) throw new Error(`refusing to write into the repository or a parent of it: ${dest}`);
  const name = `${FOLDER}-v${p.version}${p.lite ? '-lite' : ''}`; // 0.1.x's release asset names
  const work = path.join(dest, name);
  const stage = path.join(work, FOLDER);
  const zipPath = path.join(dest, `${name}.zip`);
  freshTargets([work, zipPath], force);
  const staged = makeStage(root, p, stage, { install, env, log });
  log(`zipping ${staged.length} files (${MB(sumBytes(stage, staged))}) → ${zipPath}`);
  zipFolder(work, zipPath);
  if (!keepStage) fs.rmSync(work, { recursive: true, force: true });
  return { zipPath, zipBytes: fileBytes(zipPath), files: staged.length, stage: keepStage ? stage : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// The update zip

/** OS clutter a folder can gather (a release zip has none; the extension rules of isJunk would hit node_modules files). */
const isClutter = (rel) => {
  const parts = posixRel(rel).split('/');
  const base = parts[parts.length - 1];
  return parts.includes('__pycache__') || base === '.DS_Store' || base === 'Thumbs.db' || base === 'desktop.ini' || base.startsWith('._');
};
/**
 * Never part of a base: the update files, and outside node_modules / public/vendor (npm's output, which the stage takes
 * as npm writes it) per-machine files (the refusal list) and OS clutter.
 */
const baseSkip = (rel) => rel === MANIFEST_FILE || rel === UPDATE_FILE || rel === APPLIED_FILE || (!isLib(rel) && (isRefused(rel) || isClutter(rel)));

/**
 * Read and check the bases of an update to `version`: each an earlier release's full zip or its extracted folder, older
 * than `version`, with art (not a lite zip), not an update zip, each version once. Sorted by version.
 * @param {string[]} sources
 * @param {string} version
 */
export function readBases(sources, version, { log = () => {} } = {}) {
  const bases = [];
  for (const src of sources) {
    log(`reading base ${src} …`);
    const b = readBase(src, { folder: FOLDER, skip: baseSkip });
    if (b.update) throw new Error(`base ${src} is an update package: pass the earlier release's full zip`);
    if (!b.art) throw new Error(`base ${src} has no game art (a lite zip?): pass the full zip, ${FOLDER}-v${b.version}.zip`);
    if (compareVersions(b.version, version) >= 0) throw new Error(`base ${src} is v${b.version}, not older than v${version}`);
    const twin = bases.find((x) => x.version === b.version);
    if (twin) throw new Error(`two bases are v${b.version}: ${twin.source} and ${b.source}`);
    bases.push(b);
  }
  return bases.sort((a, b) => compareVersions(a.version, b.version));
}

/**
 * The update zip: build the full stage (as `build` does) in <out>/<name>/.full/, compare every file with each base, copy
 * what is new or differs from at least one base into <out>/<name>/Stronghold-Protocol with MANIFEST.json and
 * UPDATE.json, check that stage and zip it as <name>.zip (<name> = Stronghold-Protocol-v<version>-update).
 */
export function buildUpdate(root, p, bases, { out, install = true, force = false, keepStage = false, env = process.env, log = console.log } = {}) {
  if (p.problems.length) throw new Error('refusing to build: the plan has problems (see the summary)');
  if (p.lite) throw new Error('an update is compared from the full stage (no --lite)');
  if (!bases.length) throw new Error('an update needs at least one base (--from)');
  const dest = path.resolve(out);
  if (packageOutIsUnsafe(dest, root)) throw new Error(`refusing to write into the repository or a parent of it: ${dest}`);
  const name = `${FOLDER}-v${p.version}-update`;
  const work = path.join(dest, name);
  const full = path.join(work, '.full', FOLDER);
  const stage = path.join(work, FOLDER);
  const zipPath = path.join(dest, `${name}.zip`);
  freshTargets([work, zipPath], force);
  const staged = makeStage(root, p, full, { install, env, log });
  log(`comparing ${staged.length} files with ${bases.map((b) => `v${b.version}`).join(', ')} …`);
  const next = new Map();
  for (const f of staged) if (f !== MANIFEST_FILE) next.set(f, digestOf(full, f));
  // without npm ci the stage has no node_modules / public/vendor, and the update would delete the bases' copies
  for (const lib of ['node_modules/', 'public/vendor/']) {
    const inBase = bases.find((b) => [...b.files.keys()].some((f) => f.startsWith(lib)));
    if (inBase && ![...next.keys()].some((f) => f.startsWith(lib))) {
      throw new Error(`v${inBase.version} ships ${lib} but this build has none (--no-install?): an update built so would delete it from every install`);
    }
  }
  // a path no update deletes (a per-machine name such as node_modules/x/.env.example) stays behind, named in the summary
  // …nor a file this zip holds back on purpose (the JP dub with FULL_ZIP_JP_VOICE off): the manifest still lists it
  const heldBack = new Set(p.held || []);
  const diff = diffBases(next, bases, { removable: (rel) => !removalProblem(rel) && !heldBack.has(rel) });
  for (const rel of diff.left) {
    const bad = pathProblem(rel);
    if (bad) throw new Error(`a base ships ${rel}, which is ${bad}`);
  }
  for (const rel of diff.ship) copyInto(full, stage, rel);
  copyInto(full, stage, MANIFEST_FILE);
  const update = { app: p.version, from: bases.map((b) => b.version), files: new Map(diff.ship.map((f) => [f, next.get(f)])), removed: diff.removed };
  fs.writeFileSync(path.join(stage, UPDATE_FILE), updateText(update));
  // what the player's server will read back
  parseUpdate(fs.readFileSync(path.join(stage, UPDATE_FILE), 'utf8'));
  parseManifest(fs.readFileSync(path.join(stage, MANIFEST_FILE), 'utf8'));
  const { staged: held, problems } = stageProblems(stage, new Set([...diff.ship, MANIFEST_FILE, UPDATE_FILE]), { env, libsPlanned: true });
  if (problems.length) throw new Error(`refusing to zip ${stage}:\n${problems.map((x) => `  ${x}`).join('\n')}`);
  log(`zipping ${held.length} files (${MB(sumBytes(stage, held))}) → ${zipPath}`);
  zipFolder(work, zipPath);
  if (!keepStage) fs.rmSync(work, { recursive: true, force: true });
  return {
    zipPath, zipBytes: fileBytes(zipPath), files: held.length, diff, bytes: diff.ship.reduce((n, f) => n + next.get(f).size, 0),
    stage: keepStage ? stage : null, full: keepStage ? full : null,
  };
}

/** The bases as the summary lists them. */
export function formatBases(bases) {
  return bases.map((b) => `base: v${b.version} · ${b.files.size} files (${b.art} art) · ${b.source}\n`).join('');
}

/** What an update ships, by kind, and what it removes. */
export function formatUpdate(r, version) {
  const kinds = { 'code / data': 0, node_modules: 0, 'public/vendor': 0, art: 0, 'docs / scripts / tools': 0 };
  for (const f of r.diff.ship) {
    if (isSetupArt(f)) kinds.art++;
    else if (f.startsWith('node_modules/')) kinds.node_modules++;
    else if (f.startsWith('public/vendor/')) kinds['public/vendor']++;
    else if (!affectsRuntime(f)) kinds['docs / scripts / tools']++;
    else kinds['code / data']++;
  }
  const lines = [`update: v${version} over ${r.diff.perBase.map((b) => `v${b.version}`).join(', ')}`];
  for (const b of r.diff.perBase) lines.push(`  vs v${b.version}: ${b.changed} changed, ${b.added} added, ${b.unchanged} unchanged, ${b.removed} removed`);
  lines.push(`ships: ${r.diff.ship.length} files, ${MB(r.bytes)} — ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')} (+ ${MANIFEST_FILE}, ${UPDATE_FILE})`);
  const gone = r.diff.removed.map((x) => x.path);
  lines.push(`removed: ${gone.length} file(s)${gone.length ? ` (${gone.slice(0, 8).join(', ')}${gone.length > 8 ? ' …' : ''})` : ''}`);
  if (r.diff.caseOnly.length) lines.push(`not removed (a new file differs only in case): ${r.diff.caseOnly.join(', ')}`);
  if (r.diff.left.length) lines.push(`not removed (an update never deletes these names): ${r.diff.left.join(', ')}`);
  return lines.join('\n') + '\n';
}

const USAGE = 'usage: node tools/package.mjs [--lite | --update --from <base zip or folder>[,<…>]] [--dry-run [--list]] [--out <dir>] [--force] [--keep-stage] [--no-install] [--allow-dirty] [--allow-dev] [--root <dir>]';

/** Whether `version` is a development (pre-release) version, e.g. 0.2.0-dev. */
export const isDevVersion = (version) => /-/.test(String(version || ''));

export function parseArgs(argv) {
  const o = { lite: false, update: false, from: [], dryRun: false, list: false, out: '', force: false, keepStage: false, install: true, allowDirty: false, allowDev: false, root: REPO, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lite') o.lite = true;
    else if (a === '--update') o.update = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--list') o.list = true;
    else if (a === '--force') o.force = true;
    else if (a === '--keep-stage') o.keepStage = true;
    else if (a === '--no-install') o.install = false;
    else if (a === '--allow-dirty') o.allowDirty = true;
    else if (a === '--allow-dev') o.allowDev = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--from') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`--from needs an earlier release's full zip or its folder\n${USAGE}`);
      for (const one of v.split(',')) if (one.trim()) o.from.push(path.resolve(one.trim()));
    } else if (a === '--out' || a === '--root') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a directory\n${USAGE}`);
      o[a.slice(2)] = path.resolve(v);
    } else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  if (!o.help) {
    if (o.from.length && !o.update) throw new Error(`--from goes with --update\n${USAGE}`);
    if (o.update && !o.from.length) throw new Error(`--update needs --from <earlier full zip or folder>[,<…>]\n${USAGE}`);
    if (o.update && o.lite) throw new Error(`--update is compared from the full stage: no --lite\n${USAGE}`);
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
  let bases = [];
  if (o.update) {
    try { bases = readBases(o.from, p.version, { log: (m) => console.log(m) }); } catch (e) { console.error(`package: ${e.message}`); return 1; }
    process.stdout.write(formatBases(bases));
  }
  if (o.dryRun) {
    if (o.list) for (const f of p.files) process.stdout.write(`file ${f}\n`);
    if (o.update) console.log('update: the bases are fine; which files ship is known after the build (it compares the npm ci stage)');
    return p.problems.length ? 1 : 0;
  }
  if (p.problems.length) return 1;
  // a development version (0.2.0-dev on the public dev branch) never becomes a release zip by accident: its name carries
  // the version, and building one needs --allow-dev (a test build, not a release)
  if (isDevVersion(p.version) && !o.allowDev) {
    console.error(`package: v${p.version} is a development version — a release zip needs a release version; --allow-dev builds a test zip named after it`);
    return 1;
  }
  const opts = { out: o.out || path.join(os.tmpdir(), 'stronghold-protocol-release'), install: o.install, force: o.force, keepStage: o.keepStage };
  try {
    if (o.update) {
      const r = buildUpdate(o.root, p, bases, opts);
      process.stdout.write(formatUpdate(r, p.version));
      console.log(`zip: ${r.zipPath} (${MB(r.zipBytes)}, ${r.files} files)${r.stage ? ` · stages kept: ${r.stage}, ${r.full}` : ''}`);
      return 0;
    }
    const r = build(o.root, p, opts);
    console.log(`zip: ${r.zipPath} (${MB(r.zipBytes)}, ${r.files} files)${r.stage ? ` · stage kept: ${r.stage}` : ''}`);
    return 0;
  } catch (e) {
    console.error(`package: ${e.message}`);
    return 1;
  }
}

const invoked = (() => { try { return pathToFileURL(fs.realpathSync(process.argv[1] || '')).href; } catch { return null; } })();
if (invoked === import.meta.url) process.exitCode = main(process.argv.slice(2));
