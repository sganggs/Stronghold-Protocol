#!/usr/bin/env node
// tools/setup.mjs — prepare a fresh clone in one command (docs/DEPLOY.md).
//
//   node tools/setup.mjs [options]
//
// Steps (each one is skipped when already done, so re-running is cheap — the start scripts run it on every start):
//   1. Node.js ≥ 22 check (clear message + download link otherwise).
//   2. Dependencies: `npm ci` (falls back to `npm install`) when node_modules is missing or incomplete.
//   3. Client libraries in public/vendor (tools/vendor.mjs) when any is missing.
//   4. Game data (data/*.json, committed) present and parseable.
//   5. Art/audio (tools/fetch-assets.mjs, ~720 MB into public/assets, resumable, mirror fallback) when public/assets
//      is missing or data/assets.json lists files that are not on disk. A failure is a warning: the game still runs
//      with fallback visuals and the next run resumes.
//   6. Optional: official board/UI art from a locally installed Arknights client (Windows native install, CrossOver
//      bottle or PlayCover on macOS, or --game <dir>) with tools/local-extract/extract.py in a project-local Python
//      venv (.venv-extract), then the board tile crops (tools/crop-board-atlas.mjs → tiles.json). Asked once on a
//      terminal (the answer is remembered in .cache/setup-state.json; without a terminal it is skipped); never fatal.
//   7. Optional: the eleven official battlefield scenes. The full release zip already contains
//      them when the maintainer extracted them. A lite package or a source install may download the in-season bundles
//      (tools/local-extract/fetch_scenes.py) and extract them (extract.py --only scene). Missing Python or
//      UnityPy / lz4 / Pillow is a warning: the 3D board keeps the metal tiles. --scenes does it without asking;
//      --no-scenes skips it. The answer is remembered like step 6. A manifest that is missing a group this version's
//      extractor writes, or an official-effects catalog (data/local-fx.json) whose groups, entry count or version
//      disagree, is reported. A non-scene gap names --local. A gap whose missing keys are all under scene/ names
//      --scenes when a client is present and the full-package copy sentence when it is not (--local never fetches
//      scene bundles). The effects row names the .venv-extract interpreter. A partial battlefield set does not start
//      extract.py unless --scenes or --yes; that prompt defaults to no. A scene group whose `scene` record (kind
//      Scene) is not this version's scene extract version, with every scene group present, asks that same question
//      once (default no). A typed yes runs extract.py --only scene, the same path as a first-time yes; a 否 is
//      remembered. It is not a second prompt. The art row is checked again after step 7.
//
// Options:
//   --check          report only, change nothing (exit 1 when something essential is missing)
//   --offline        same read-only checks as --check; --no-network is an alias
//   --no-assets      skip art/audio and optional plugin official-table downloads
//   --refresh-index  re-download needed official tables (otherwise existing tables are reused)
//   --asset-source=M direct (default) or mirror (opt-in; no public-IP lookup)
//                    SP_ASSET_SOURCE sets the default; SP_GITHUB_PROXY sets the HTTPS prefix (https://gh-proxy.com/)
//                    An empty SP_GITHUB_PROXY disables the proxy, including in mirror mode.
//   --no-local       skip the local-client detection and extraction (the scene step still runs unless --no-scenes)
//   --local          extract local art and used official effects, including installed plugin references
//   --scenes         download and extract the official battlefield scenes without asking
//   --no-scenes      do not download or extract battlefield scenes (the metal board stays)
//   --game <dir>     local client: the install directory (Arknights.exe / Arknights_Data, including "Arknights Game") or the AssetBundle root (…/StreamingAssets/AB/Windows, PlayCover …/Documents/Bundles). A path that still exists is remembered in .cache/setup-state.json.
//   -y, --yes        answer "yes" to every question
//   --quiet          fewer lines (used by scripts/launch.mjs)
//   -h, --help
//
// Exit code: 0 = ready to `npm start` (optional parts may have been skipped), 1 = something essential is missing.
// Helpers are exported for tools/doctor.mjs and scripts/launch.mjs; main() only runs when executed directly.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSource } from './assets/network.mjs';
import { EXPECTED_FX, EXPECTED_LOCAL_GROUPS, EXPECTED_SCENE } from './local-extract/expected.mjs';
import { installedFxReferences, pluginFxGap } from '../server/plugins/fxReferences.js';
import { pluginArtGap } from '../server/plugins/artReferences.js';
import { preparePluginOfficialTables } from './assets/official-tables.mjs';
import { restartForEnvProxy } from './assets/env-proxy.mjs';

export function checkPluginArt(root = ROOT) { return pluginArtGap(root); }

export function checkPluginFx(root = ROOT) {
  let index = null;
  try { index = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/local/fx/index.json'), 'utf8')); } catch { /* optional */ }
  return pluginFxGap(installedFxReferences(root), index);
}

/** [ASSUMED] A changed reference set may ask again; Enter/timeout never authorizes extraction. */
export function pluginFxExtractionAllowed(opts, missing, answer = false) {
  return !opts.check && opts.local !== 'no' && (opts.local === 'force' || missing.length > 0 && (opts.yes || answer === true));
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_NODE = 22;
export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
const NODE_URL = 'https://nodejs.org/zh-cn/download';

/** Data files the server expects (server/data.js DATA_FILES) + the emote catalogue used by the client. */
export const DATA_FILES = ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices',
  'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'assets', 'backups', 'emotes'];
/** Runtime packages that must be installed (package.json dependencies). */
export const RUNTIME_PACKAGES = ['ws', 'pixi.js', 'pixi-spine', 'preact', 'htm'];
/** Vendor files the client cannot run without (tools/vendor.mjs; three.js is optional there). */
export const VENDOR_REQUIRED = ['pixi.min.js', 'pixi-spine.js', 'preact.module.js', 'hooks.module.js', 'htm.module.js'];
export const VENDOR_OPTIONAL = ['three.core.js', 'three.module.js'];

const STATE_FILE = path.join(ROOT, '.cache', 'setup-state.json');
export const VENV_DIR = path.join(ROOT, '.venv-extract');
const EXTRACT_PY = path.join(ROOT, 'tools', 'local-extract', 'extract.py');
const FETCH_SCENES_PY = path.join(ROOT, 'tools', 'local-extract', 'fetch_scenes.py');
const EXTRACT_REQ = path.join(ROOT, 'tools', 'local-extract', 'requirements.txt');
const LOCAL_MANIFEST = path.join(ROOT, 'data', 'local-assets.json');
const LOCAL_BOARD_ATLAS = path.join(ROOT, 'public', 'assets', 'local', 'map', 'autochess', 'TX_autochessi_D.png');
const LOCAL_BOARD_TILES = path.join(ROOT, 'public', 'assets', 'local', 'map', 'autochess', 'tiles.json');

// ---------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { ok: paint('32'), warn: paint('33'), err: paint('31'), dim: paint('2'), bold: paint('1'), cyan: paint('36') };
export const mark = { ok: c.ok('✔'), warn: c.warn('!'), err: c.err('✘'), skip: c.dim('–') };

export const nodeMajor = () => Number(process.versions.node.split('.')[0]);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;
/** The art download when data/assets.json gives no size (missing, unreadable or without stats.bytes): the 0.2.2
 * manifest's stats.bytes, 548 MB (both voice dubs; 463 MB before the JP one), as README and docs/DEPLOY.md quote it.
 * 0.3.0 also plans the English, Korean and own-language dubs (about +180 MB; the coordinator checks after download).
 * This fallback stays the measured 0.2.2 figure until that manifest exists. */
const ART_DOWNLOAD_FALLBACK = '720 MB';
/** Terminal display width (CJK / full-width characters take two columns). */
export const displayWidth = (s) => [...String(s)].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x2e80 ? 2 : 1), 0);
export const padDisplay = (s, w) => s + ' '.repeat(Math.max(0, w - displayWidth(s)));

/** Run a command with inherited stdio. `.cmd` shims (npm) need a shell on Windows (Node ≥ 18.20 refuses them otherwise). */
function run(cmd, args, { cwd = ROOT, env, shell = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell });
  if (r.error) return { ok: false, code: -1, error: r.error };
  return { ok: r.status === 0, code: r.status };
}

/** Run a command and capture its output (never throws). */
export function capture(cmd, args, { timeout = 15000, shell = false, env } = {}) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout, shell, windowsHide: true, env: env ? { ...process.env, ...env } : process.env });
    return { ok: !r.error && r.status === 0, status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  } catch (e) {
    return { ok: false, status: -1, out: String(e?.message || e) };
  }
}

function npmCommand() {
  const execPath = process.env.npm_execpath; // set when started through `npm run …`
  if (execPath && /npm-cli\.js$/i.test(execPath) && exists(execPath)) return { cmd: process.execPath, pre: [execPath], shell: false };
  return { cmd: IS_WIN ? 'npm.cmd' : 'npm', pre: [], shell: IS_WIN };
}

function loadState() { return readJson(STATE_FILE) || {}; }
function saveState(patch) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...loadState(), ...patch }, null, 1) + '\n');
  } catch { /* best effort */ }
}

/** Ask a yes/no question on a TTY (default on Enter / timeout = `def`). Non-TTY → null (nobody to ask). */
async function ask(question, def, timeoutMs = 60000) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = def ? '[Y/n]' : '[y/N]';
  try {
    return await new Promise((resolve) => {
      const t = setTimeout(() => { process.stdout.write(c.dim(`\n  (${timeoutMs / 1000} 秒无输入，按默认处理)\n`)); resolve(def); }, timeoutMs);
      rl.question(`  ${question} ${hint} `, (a) => {
        clearTimeout(t);
        const s = String(a || '').trim().toLowerCase();
        resolve(s === '' ? def : /^(y|yes|是|好|1)$/.test(s));
      });
    });
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// Checks (exported for tools/doctor.mjs)
// ---------------------------------------------------------------------------------------------------

/** Node.js version check. */
export function checkNode() {
  const major = nodeMajor();
  return { ok: major >= MIN_NODE, version: process.versions.node, major, recommended: major >= MIN_NODE };
}

/** Runtime dependencies installed? */
export function checkDeps() {
  const missing = RUNTIME_PACKAGES.filter((p) => !exists(path.join(ROOT, 'node_modules', ...p.split('/'), 'package.json')));
  return { ok: missing.length === 0, missing, hasNodeModules: exists(path.join(ROOT, 'node_modules')) };
}

/** public/vendor files present? */
export function checkVendor() {
  const dir = path.join(ROOT, 'public', 'vendor');
  const missing = VENDOR_REQUIRED.filter((f) => !exists(path.join(dir, f)));
  const optionalMissing = VENDOR_OPTIONAL.filter((f) => !exists(path.join(dir, f)));
  return { ok: missing.length === 0, missing, optionalMissing };
}

/** data/*.json present and parseable? */
export function checkData() {
  const missing = [];
  const broken = [];
  for (const name of DATA_FILES) {
    const p = path.join(ROOT, 'data', `${name}.json`);
    if (!exists(p)) { missing.push(name); continue; }
    if (readJson(p) == null) broken.push(name);
  }
  return { ok: !missing.length && !broken.length, missing, broken };
}

/** Every '/assets/…' or '/fonts/…' URL of the manifest (same walk as test/assets.test.js). */
function manifestUrls(node, out = []) {
  if (typeof node === 'string') { if (/^\/(assets|fonts)\//.test(node)) out.push(node); }
  else if (Array.isArray(node)) for (const x of node) manifestUrls(x, out);
  else if (node && typeof node === 'object') for (const x of Object.values(node)) manifestUrls(x, out);
  return out;
}

/**
 * Downloaded art/audio complete? Compares data/assets.json with public/.
 * @returns {{ ok: boolean, present: boolean, manifest: boolean, total: number, missing: number, sample: string[], bytes: number }}
 */
export function checkAssets() {
  const pub = path.join(ROOT, 'public');
  const present = exists(path.join(pub, 'assets'));
  const m = readJson(path.join(ROOT, 'data', 'assets.json'));
  if (!m) return { ok: false, present, manifest: false, total: 0, missing: 0, sample: [], bytes: 0 };
  const urls = [...new Set(manifestUrls(m))];
  const missing = [];
  for (const u of urls) {
    let st = null;
    try { st = fs.statSync(path.join(pub, ...u.split('/').filter(Boolean).map(decodeURIComponent))); } catch { /* missing */ }
    if (!st || !st.isFile() || !st.size) missing.push(u);
  }
  return { ok: present && missing.length === 0 && urls.length > 0, present, manifest: true, total: urls.length, missing: missing.length, sample: missing.slice(0, 5), bytes: Number(m.stats?.bytes) || 0 };
}

/**
 * What the game draws instead when the local-client art is absent (DESIGN §13, docs/DEPLOY.md §6). The battle emotes and
 * the 玩法说明 pages are not in the list: step 5 downloads them from the public mirror with the other assets (GitHub
 * issue #42). Shown by setup and doctor.
 */
export const LOCAL_ART_FALLBACK = '3D 棋盘改用 2D，部分官方界面图标、灼热/炽焰源石虫模型和多数自选召唤物模型用替代样式';
/** Where a machine without the client gets the local art (docs/DEPLOY.md §6「本地客户端素材」); shown by doctor (setup's row,
 * printed on every start by scripts/launch.mjs, only points to that section). */
export const LOCAL_ART_COPY_HINT = '没有客户端的服务器可以从同一版本的整合包（完整包）复制 public/assets/local 和 data/local-assets.json';

const LOCAL_FX = path.join(ROOT, 'data', 'local-fx.json');
/** Scene groups a full extract writes: one `scene/<stageId>` per battlefield, plus the shared `scene/tex`. */
const EXPECTED_SCENE_GROUPS = EXPECTED_LOCAL_GROUPS.filter((g) => g.startsWith('scene/'));
const EXPECTED_SCENE_STAGES = EXPECTED_SCENE_GROUPS.filter((g) => g !== 'scene/tex');
const LOCAL_REEXTRACT = 'node tools/setup.mjs --local';
const SCENE_REEXTRACT = 'node tools/setup.mjs --scenes';

function groupEntryCount(groups) {
  if (!groups || typeof groups !== 'object') return 0;
  let n = 0;
  for (const g of Object.values(groups)) if (g && typeof g === 'object') n += Object.keys(g).length;
  return n;
}

/** Up to three group keys, then 「等 N 个」 when more are missing. */
function formatMissing(keys) {
  const shown = keys.slice(0, 3);
  return shown.join('、') + (keys.length > shown.length ? ` 等 ${keys.length} 个` : '');
}

/**
 * Compare a local-assets manifest and an optional fx catalog with the groups this version's extractor writes
 * (tools/local-extract/expected.mjs, from extract.py --print-jobs; no game client). Does not touch the disk.
 *
 * [ASSUMED] A job-table group key is expected after a full extract. A missing non-scene group is still
 * "re-run --local". Missing keys that are all under scene/ name --scenes when the caller passes a client,
 * and the full-package copy sentence otherwise (extract.py skips a missing scene bundle; --local does not
 * run fetch_scenes.py). Extra local-assets groups are leftovers from an earlier --only merge and are not stale.
 * There is no canonical file count (it depends on the client): compare group keys, and report the entry count
 * the user has. A numeric `count` that disagrees with the listed entries is stale; a missing `count` is not.
 * fx or fx/* keys left inside local-assets do not satisfy the fx catalog. See fxCatalogReport for the catalog.
 * A present `scene` record (kind Scene) on a battlefield group whose `version` is not EXPECTED_SCENE.version is
 * stale even when every group key is there (an extract from before lossless data maps and emission). A group
 * with no such record is not a version problem. scene.json's mesh version is not read.
 */
export function assessLocal(manifest, fxDoc) {
  const groups = manifest && manifest.groups && typeof manifest.groups === 'object' ? Object.keys(manifest.groups) : [];
  const have = new Set(groups);
  const missingGroups = EXPECTED_LOCAL_GROUPS.filter((g) => !have.has(g));
  const count = groupEntryCount(manifest && manifest.groups);
  const countField = manifest && Number.isFinite(manifest.count) ? manifest.count : null;
  const countMismatch = !!(manifest && countField !== null && countField !== count);
  const missingSceneGroups = missingGroups.filter((g) => g.startsWith('scene/'));
  const sceneVersions = sceneRecordVersions(manifest);
  const sceneVersionStale = sceneVersions.length > 0 && sceneVersions.some((v) => v !== EXPECTED_SCENE.version);
  const enemyIds = EXPECTED_LOCAL_GROUPS.filter((g) => g.startsWith('spine/enemy/'));
  const tokenIds = EXPECTED_LOCAL_GROUPS.filter((g) => g.startsWith('spine/token/'));
  return {
    manifest: !!manifest,
    count,
    groupCount: groups.length,
    expectedGroupCount: EXPECTED_LOCAL_GROUPS.length,
    missingGroups,
    countMismatch,
    countField,
    sceneVersionStale,
    sceneVersionHave: sceneVersionLabel(sceneVersions),
    sceneVersionExpected: EXPECTED_SCENE.version,
    scenes: !!manifest && missingSceneGroups.length === 0 && !sceneVersionStale,
    sceneStagesHave: EXPECTED_SCENE_STAGES.filter((g) => have.has(g)).length,
    sceneStagesExpected: EXPECTED_SCENE_STAGES.length,
    sceneGroupHave: EXPECTED_SCENE_GROUPS.filter((g) => have.has(g)).length,
    sceneGroupExpected: EXPECTED_SCENE_GROUPS.length,
    missingSceneGroups,
    enemySpines: enemyIds.length > 0 && enemyIds.every((g) => have.has(g)),
    tokenSpines: tokenIds.length > 0 && tokenIds.every((g) => have.has(g)),
    // No manifest is "not extracted" (skip), not a stale extract. Callers warn only when manifest is set.
    stale: !manifest || missingGroups.length > 0 || countMismatch || sceneVersionStale,
    fx: fxCatalogReport(fxDoc),
  };
}

/**
 * Official-effects catalog (data/local-fx.json). Absent is opt-in: state skip, and it does not make the art row stale.
 * [ASSUMED] Present-but-wrong groups, entry count, wrapper version, format or index version is a warning. The group
 * set must be exactly FX_GROUPS (an extra fx group is stale: a full fx run rewrites the catalog to those four keys).
 * The catalog's index version is the version check; mesh and prefab files are not opened for MESH_VERSION /
 * FORMAT_VERSION. The hint names the effects-only command (a full `--local` also extracts effects). The interpreter is the
 * project venv (`.venv-extract`), not `python` on PATH: setup installs UnityPy there.
 */
export function fxCatalogReport(doc) {
  const expectGroups = EXPECTED_FX.groups;
  const expectN = expectGroups.length;
  const indexExpect = EXPECTED_FX.indexVersion;
  if (!doc || typeof doc !== 'object') {
    return {
      present: false, stale: false, state: 'skip', groupCount: 0, listed: 0,
      detail: `未提取：已有 0 个分组、0 项，这一版期望 ${expectN} 个分组（${expectGroups.join('、')}）、索引版本 ${indexExpect}。需要时 ${fxReextractCommand()}`,
    };
  }
  const raw = doc.groups && typeof doc.groups === 'object' ? doc.groups : {};
  const groups = Object.keys(raw);
  const listed = groupEntryCount(raw);
  const missing = expectGroups.filter((g) => !Object.hasOwn(raw, g));
  const extra = groups.filter((g) => !expectGroups.includes(g));
  const indexVersion = raw.fx && raw.fx.index ? raw.fx.index.version : undefined;
  const problems = [];
  if (missing.length || extra.length || groups.length !== expectN) {
    const bits = [`分组 ${groups.length} 个，期望 ${expectN} 个（${expectGroups.join('、')}）`];
    if (missing.length) bits.push(`缺少 ${formatMissing(missing)}`);
    if (extra.length) bits.push(`多出 ${formatMissing(extra)}`);
    problems.push(bits.join('，'));
  }
  if (indexVersion !== indexExpect) problems.push(`索引版本 ${indexVersion ?? '无'}，期望 ${indexExpect}`);
  if (doc.version !== EXPECTED_FX.manifestVersion) problems.push(`清单版本 ${doc.version ?? '无'}，期望 ${EXPECTED_FX.manifestVersion}`);
  if (doc.format !== 'fx-manifest') problems.push(`格式 ${doc.format ?? '无'}，期望 fx-manifest`);
  // [ASSUMED] The extractor always writes `count`. A missing or disagreeing count is stale; the number itself is not fixed.
  const countField = Number.isFinite(doc.count) ? doc.count : null;
  if (countField !== listed) problems.push(`清单写 ${countField ?? '无'} 项，分组里是 ${listed} 项`);
  if (!problems.length) {
    return {
      present: true, stale: false, state: 'ok', listed, groupCount: groups.length, indexVersion,
      detail: `已提取 ${listed} 项，${groups.length} 个分组，索引版本 ${indexVersion}`,
    };
  }
  return {
    present: true, stale: true, state: 'warn', listed, groupCount: groups.length, indexVersion,
    detail: `已有 ${groups.length} 个分组、${listed} 项，这一版期望 ${expectN} 个分组、索引版本 ${indexExpect}（${problems.join('；')}），请重新运行 ${fxReextractCommand()}`,
  };
}

/**
 * Local-client art (optional): manifest entry count, whether the 3D board atlas is on disk, and whether the
 * manifest's group keys are the set this version's extractor writes (enemy and token models included). Also reads
 * data/local-fx.json. Disk flags (board3d, tiles, dirPresent) are added here; assessLocal is the pure comparison.
 */
export function checkLocal() {
  const assessed = assessLocal(readJson(LOCAL_MANIFEST), readJson(LOCAL_FX));
  return {
    ...assessed,
    board3d: exists(LOCAL_BOARD_ATLAS),
    tiles: exists(LOCAL_BOARD_TILES),
    dirPresent: exists(path.join(ROOT, 'public', 'assets', 'local')),
  };
}

/**
 * Repair for a gap whose missing keys are all under `scene/`.
 * `--scenes` only when the caller says a usable client is present. Otherwise the full-package copy
 * sentence: there is no client to read scene textures from, and `--local` does not fetch scene bundles.
 * [ASSUMED] `client !== true` (omitted, false, or 'incomplete') is not a usable client. An incomplete
 * directory has no mode bundles, and those bundles are where the scene materials come from.
 */
function sceneRepairClause(client) {
  return client === true ? `请重新运行 ${SCENE_REEXTRACT}` : LOCAL_ART_COPY_HINT;
}

/** Versions of battlefield `scene` records (kind Scene). A missing version is `undefined`. No record → omitted. */
function sceneRecordVersions(manifest) {
  const groups = manifest && manifest.groups;
  if (!groups || typeof groups !== 'object') return [];
  const out = [];
  for (const g of EXPECTED_SCENE_STAGES) {
    const rec = groups[g] && groups[g].scene;
    if (!rec || rec.kind !== 'Scene') continue;
    out.push(Object.hasOwn(rec, 'version') ? rec.version : undefined);
  }
  return out;
}

/** One label for the records above: the shared version, 无 when none of them wrote one, 不一致 when they differ. */
function sceneVersionLabel(versions) {
  if (!versions.length) return null;
  const shown = versions.map((v) => (v === undefined || v === null ? null : v));
  const first = shown[0];
  if (!shown.every((v) => v === first)) return '不一致';
  return first == null ? '无' : String(first);
}

/** Version-only scene gap (every group key is present). One repair clause, no "metal tiles" tail. */
function sceneVersionDetail(o = {}) {
  const have = o.sceneVersionHave ?? '无';
  const exp = o.sceneVersionExpected ?? EXPECTED_SCENE.version;
  const repair = sceneRepairClause(o.client);
  const join = o.client === true ? '，' : '。';
  return `场景版本 ${have}，期望 ${exp}${join}${repair}`;
}

function sceneOnlyGap(local) {
  const keys = local && local.missingGroups;
  return Array.isArray(keys) && keys.length > 0 && keys.every((g) => String(g).startsWith('scene/'));
}

/**
 * What an extraction is missing, for setup's 本地客户端美术 row.
 * An object with `missingGroups` (what checkLocal / assessLocal return) names group counts and up to three keys.
 * An older caller that only sets the prefix flags still gets the flag sentence.
 * `opt.client === true` means a client with the mode's bundles. See sceneRepairClause.
 */
export function localGaps(local, opt = {}) {
  if (local && Array.isArray(local.missingGroups)) {
    if (!local.missingGroups.length && !local.countMismatch) {
      return local.sceneVersionStale ? `，${sceneVersionDetail({ ...local, client: opt.client })}` : '';
    }
    const groupCount = local.groupCount ?? 0;
    const count = local.count ?? 0;
    const expected = local.expectedGroupCount ?? EXPECTED_LOCAL_GROUPS.length;
    let s = `，已有 ${groupCount} 个分组、${count} 项，这一版期望 ${expected} 个分组`;
    if (local.missingGroups.length) s += `（缺少 ${formatMissing(local.missingGroups)}）`;
    if (local.countMismatch) s += `，清单写 ${local.countField} 项，分组里是 ${count} 项`;
    if (!sceneOnlyGap(local)) return `${s}，请重新运行 ${LOCAL_REEXTRACT}`;
    // A scene-only key list is not fixed by --local. A count mismatch is still named above.
    return opt.client === true ? `${s}，${sceneRepairClause(true)}` : `${s}。${sceneRepairClause(false)}`;
  }
  const gaps = [];
  if (local && !local.enemySpines) gaps.push('灼热/炽焰源石虫模型');
  if (local && !local.tokenSpines) gaps.push('自选召唤物模型');
  if (local && local.scenes === false) gaps.push('各战场官方场景');
  return gaps.length ? `，缺少新版的${gaps.join('和')}` : '';
}

/** skip when nothing was extracted; warn when the manifest is present but stale; otherwise ok. */
export function localArtState(local) {
  if (!local?.manifest) return 'skip';
  return local.stale ? 'warn' : 'ok';
}

/**
 * The 已提取 row. A non-empty localGaps already names the repair, so the fresh-extract hint is not repeated.
 * `verb` is 「提取」 on the row printed immediately after a run, 「已提取」 when the files were already there.
 * `opt.client` is forwarded to localGaps (scene-only gaps).
 */
export function localArtDetail(local, tail = '', verb = '已提取', opt = {}) {
  const gap = localGaps(local, opt);
  const again = verb === '已提取' ? '（重新提取：--local）' : '';
  return `${verb} ${local.count} 项${tail}${gap}${gap ? '' : again}`;
}

/**
 * Replace a manifest-based art row with a fresh checkLocal() result.
 * Step 6 records the row before step 7 can fill a scene-only gap; without this the row stays warn.
 */
export function artRowAfterScenes(row, local, { client = false, tail = '', verb = '已提取' } = {}) {
  if (!row || !local?.manifest) return row;
  return {
    state: localArtState(local),
    label: row.label,
    detail: localArtDetail(local, tail, verb, { client }),
  };
}

/** Partial battlefield extract: have/expect battlefields, and scene/tex when that shared group is missing.
 * `o.client === true` names `--scenes`. Any other value names the full-package copy sentence. */
export function scenePartialDetail(o = {}) {
  if (o.sceneVersionStale && !(Array.isArray(o.missingSceneGroups) && o.missingSceneGroups.length)) {
    return sceneVersionDetail(o);
  }
  const have = o.sceneStagesHave ?? 0;
  const expect = o.sceneStagesExpected ?? EXPECTED_SCENE_STAGES.length;
  const missing = Array.isArray(o.missingSceneGroups) ? o.missingSceneGroups : [];
  const stages = missing.filter((g) => g !== 'scene/tex');
  let s = `已有 ${have} 个战场，这一版期望 ${expect} 个`;
  if (stages.length) s += `（缺少 ${formatMissing(stages)}）`;
  if (missing.includes('scene/tex')) s += '，缺少共用贴图 scene/tex';
  const repair = sceneRepairClause(o.client);
  const join = o.client === true ? '，' : '。';
  return `${s}${join}${repair}。没有的战场仍用金属地块`;
}

/**
 * Doctor's scene clause: complete, partial (have/expect), or none.
 * `opt.client === true` is a usable client. Omitted keeps the older `--scenes` sentence for the
 * none branch (callers that have not looked). false uses the copy sentence.
 */
export function scenePresencePhrase(local, opt = {}) {
  if (local?.scenes) return '，已提取各战场官方场景';
  if ((local?.sceneGroupHave || 0) > 0) return `，${scenePartialDetail({ ...local, client: opt.client })}`;
  if (opt.client === false) return `，无各战场官方场景（3D 棋盘用金属地块；${LOCAL_ART_COPY_HINT}）`;
  return '，无各战场官方场景（3D 棋盘用金属地块；node tools/setup.mjs --scenes）';
}

/**
 * Doctor glues the scene clause and the art gap into one cell. A scene-only partial gap is already
 * the scene clause, so the art gap (which used to add a second, wrong `--local`) is left off.
 * A count mismatch is not scene-only and is still appended.
 */
export function doctorLocalDetail(local, clientUsable) {
  const versionOnly = !!(local && local.sceneVersionStale && !local.missingGroups?.length && !local.countMismatch);
  const sceneOnlyPartial = (sceneOnlyGap(local) || versionOnly) && !local.countMismatch && (local.sceneGroupHave || 0) > 0;
  const gaps = sceneOnlyPartial ? '' : localGaps(local, { client: clientUsable });
  return `${scenePresencePhrase(local, { client: clientUsable })}${gaps}`;
}

/**
 * Whether setup should download and extract the official battlefield scenes.
 * The full release zip already contains them when the maintainer extracted them before packaging.
 * A lite package or a source install may fetch the in-season bundles on this machine and extract them.
 * Missing Python or UnityPy / lz4 / Pillow is not fatal: the 3D board keeps the metal tiles.
 * `client` is true (autochess bundles present), 'incomplete' (a client dir without them) or false.
 * `hasScenes` means every expected scene group is present, including scene/tex — not merely a scene/act prefix.
 * A partial set (some scene groups present and some missing, not force/yes) warns when the fetch is blocked
 * and asks otherwise. That ask defaults to no, and a yes on it does not start extract.py — only `--scenes`
 * (force) or `--yes` does (§34.11). A version-only gap (every scene group present, record version stale) uses
 * the same ask and also defaults to no. A typed yes there is not partial: the caller runs extract.py --only scene
 * the same way as a first-time yes. A 否 is remembered.
 * With no usable client the partial detail is the copy sentence, not `--scenes` (the old branch returned
 * before the no-client sentence). Callers that omit `sceneGroupHave` keep the older branches.
 * @param {{ hasScenes?: boolean, sceneStagesHave?: number, sceneStagesExpected?: number, sceneGroupHave?: number, missingSceneGroups?: string[], client?: boolean|string, python?: boolean, deps?: boolean, check?: boolean, declined?: boolean, force?: boolean, yes?: boolean }} o
 * @returns {{ run: boolean, state: 'ok'|'skip'|'warn'|'ask', detail: string }}
 */
export function sceneInstallPlan(o = {}) {
  if (o.hasScenes && !o.force) {
    const n = o.sceneStagesExpected ?? EXPECTED_SCENE_STAGES.length;
    return { run: false, state: 'ok', detail: `已提取各战场官方场景（${n} 个战场；某个战场没有文件时仍用金属地块）` };
  }
  if (!o.hasScenes && (o.sceneGroupHave || 0) > 0 && !o.force && !o.yes) {
    const detail = scenePartialDetail(o);
    const blocked = o.check || o.client === 'incomplete' || !o.client || !o.python || o.deps === false || o.declined;
    return { run: false, state: blocked ? 'warn' : 'ask', detail };
  }
  if (o.check) {
    return { run: false, state: 'skip', detail: '未提取各战场官方场景：3D 棋盘用金属地块（node tools/setup.mjs --scenes 可在本机下载并提取）' };
  }
  if (o.client === 'incomplete') {
    return { run: false, state: 'warn', detail: '客户端缺少卫戍协议资源，战场场景未提取。3D 棋盘继续用金属地块' };
  }
  if (!o.client) {
    return { run: false, state: 'skip', detail: '没有本机客户端，不能提取战场场景（贴图仍取自客户端）。3D 棋盘用金属地块；完整包已带场景时可复制 public/assets/local 和 data/local-assets.json' };
  }
  if (!o.python) {
    return { run: false, state: 'warn', detail: '没有 Python 3.8+，战场场景未提取。3D 棋盘继续用金属地块' };
  }
  if (o.deps === false) {
    return { run: false, state: 'warn', detail: '提取依赖（UnityPy / lz4 / Pillow）没装好，战场场景未提取。3D 棋盘继续用金属地块' };
  }
  if (o.declined && !o.force && !o.yes) {
    return { run: false, state: 'skip', detail: '已跳过战场场景（node tools/setup.mjs --scenes）。3D 棋盘用金属地块' };
  }
  if (!o.force && !o.yes) {
    return { run: false, state: 'ask', detail: '可以下载赛季场景包并提取（约 23 MB）。失败或跳过时 3D 棋盘仍用金属地块' };
  }
  return { run: true, state: 'ok', detail: '将下载赛季场景包并提取；失败时 3D 棋盘仍用金属地块' };
}

/**
 * Some battlefield groups are on disk and some expected scene groups are not.
 * A version-stale extract that still has every scene group is not this (§34.12).
 * §34.11 / #665: this prompt defaults to no, and a typed yes does not start extract.py.
 */
export function sceneFilesPartial(local) {
  const missing = local?.missingSceneGroups;
  return (local?.sceneGroupHave || 0) > 0 && Array.isArray(missing) && missing.length > 0;
}

/**
 * Every scene group is present and a battlefield `scene` record is not this version.
 * Not a missing-file partial set, and not a first extract (no records → not stale).
 */
export function sceneVersionOnlyGap(local) {
  return !!(local?.sceneVersionStale && !(local?.missingSceneGroups?.length) && (local?.sceneGroupHave || 0) > 0);
}

/**
 * Default for 「现在下载并提取吗？」. An existing extract — missing scene files, or a version-only
 * gap — defaults to no: Enter and the 60s timeout must not start extract.py. The first-time prompt
 * (no scene group yet) keeps yes.
 */
export function sceneAskDefault(existing) {
  return !existing;
}

/**
 * May this run start extract.py --only scene against the client?
 * `--scenes` (force) and `--yes` may. `partial` means some scene groups are missing (§34.11 / #665):
 * that prompt never starts extract.py, including a typed yes. A version-only gap is not partial: the
 * caller passes partial false, so a typed yes runs, the same as a first-time yes. A 否 (answer false)
 * does not run; the caller remembers it as sceneDeclined.
 */
export function sceneClientExtractAllowed({ partial = false, force = false, yes = false, answer = false } = {}) {
  if (force || yes) return true;
  if (partial) return false;
  return answer === true;
}

/**
 * Board tile crops of the extracted atlas (tools/crop-board-atlas.mjs → tiles.json, read by the 2D and 3D board
 * renderers; without it the client requests a missing file and keeps the procedural tiles). Output only on failure.
 */
function cropBoardTiles(log) {
  const r = capture(process.execPath, [path.join(ROOT, 'tools', 'crop-board-atlas.mjs')], { timeout: 120000 });
  if (!r.ok) log(c.warn(`  棋盘贴图裁切失败（node tools/crop-board-atlas.mjs）：${r.out.split(/\r?\n/).slice(-3).join(' ')}`));
  return r.ok && exists(LOCAL_BOARD_TILES);
}

// ---------------------------------------------------------------------------------------------------
// Local Arknights client detection
// ---------------------------------------------------------------------------------------------------

const CLIENT_SPEC_FILE = path.join(ROOT, 'tools', 'local-extract', 'client-candidates.json');
let clientSpecCache = null;

/** Shared with tools/local-extract/extract.py (the same JSON). */
export function clientSpec() {
  if (!clientSpecCache) {
    const raw = fs.readFileSync(CLIENT_SPEC_FILE, 'utf8');
    const spec = JSON.parse(raw);
    if (!Array.isArray(spec.abTail) || !spec.abTail.length) throw new Error(`client candidate spec has no abTail: ${CLIENT_SPEC_FILE}`);
    if (!Array.isArray(spec.gameFolders) || !spec.gameFolders.length) throw new Error(`client candidate spec has no gameFolders: ${CLIENT_SPEC_FILE}`);
    clientSpecCache = spec;
  }
  return clientSpecCache;
}

/** Windows install suffixes, `Arknights` and `Arknights Game` included. extract.py prints the same list. */
export function windowsCandidateSuffixes() {
  const spec = clientSpec();
  const out = [];
  for (const base of spec.windowsBases) {
    for (const game of spec.gameFolders) out.push([...base, game, ...spec.abTail].join('/'));
  }
  return out;
}

/** Candidate AssetBundle roots for this OS (existence not checked). */
export function clientCandidates() {
  const spec = clientSpec();
  const home = os.homedir();
  const out = [];
  const add = (p, kind) => out.push({ path: p, kind });
  const ab = spec.abTail;
  if (IS_WIN) {
    for (const d of spec.windowsDrives) {
      for (const base of spec.windowsBases) {
        for (const game of spec.gameFolders) add(path.win32.join(`${d}:\\`, ...base, game, ...ab), 'Windows');
      }
    }
  }
  if (IS_MAC) {
    const bottles = path.join(home, ...spec.crossoverBottles);
    let names = [];
    try { names = fs.readdirSync(bottles); } catch { /* no CrossOver */ }
    const prefer = spec.defaultCrossoverBottle;
    names.sort((a, b) => (b === prefer) - (a === prefer));
    for (const n of names) {
      for (const pf of spec.crossoverProgramFiles) {
        for (const game of spec.gameFolders) {
          add(path.join(bottles, n, 'drive_c', pf, ...spec.crossoverGameTail, game, ...ab), `CrossOver (${n})`);
        }
      }
    }
    add(path.join(home, ...spec.playcoverTail), 'PlayCover');
  }
  if (!IS_WIN) {
    for (const prefix of spec.winePrefixes) {
      for (const game of spec.gameFolders) {
        add(path.join(home, prefix, 'drive_c', 'Program Files', ...spec.crossoverGameTail, game, ...ab), 'Wine');
      }
    }
  }
  return out;
}

/** Does the directory look like an AssetBundle root holding the autochess bundles? */
export function inspectClientRoot(dir) {
  if (!dir || !exists(dir)) return { exists: false, autochess: false };
  const autochess = exists(path.join(dir, 'ui', 'autochess')) || exists(path.join(dir, 'arts', 'maps', 'map_autochess'));
  return { exists: true, autochess };
}

function endsWithAbTail(dir, spec) {
  const norm = String(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  return norm.endsWith(spec.abTail.join('/'));
}

function hasInstallMarker(dir) {
  return exists(path.join(dir, 'Arknights.exe')) || exists(path.join(dir, 'Arknights_Data'));
}

/** [ASSUMED] A parent of the install is searched one level down; a path inside the install walks up at most 8 levels. */
function findInstallRoot(start, spec) {
  const named = (dir) => {
    for (const game of spec.gameFolders) {
      const child = path.join(dir, game);
      if (hasInstallMarker(child)) return child;
    }
    return null;
  };
  if (hasInstallMarker(start)) return start;
  const atStart = named(start);
  if (atStart) return atStart;
  try {
    for (const name of fs.readdirSync(start)) {
      if (spec.gameFolders.includes(name)) continue;
      const child = path.join(start, name);
      if (hasInstallMarker(child)) return child;
    }
  } catch { /* not a readable directory */ }
  let cur = start;
  for (let i = 0; i < 8; i++) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
    if (hasInstallMarker(cur)) return cur;
  }
  return null;
}

function playcoverBundles(dir, spec) {
  const playcover = String(dir).includes(`${path.sep}com.hypergryph.arknights${path.sep}`)
    || String(dir).endsWith(`${path.sep}com.hypergryph.arknights`);
  for (const rel of spec.playcoverBundleRels) {
    const bundles = path.join(dir, ...rel);
    if (inspectClientRoot(bundles).autochess) return bundles;
    if (playcover && exists(bundles)) return bundles;
  }
  return null;
}

/**
 * AssetBundle root for a --game directory. An existing AB root (the autochess marker, or a path that already ends in
 * the AB tail) is returned as-is. An install directory — or [ASSUMED] one level above it, or a directory inside it —
 * becomes Arknights_Data/StreamingAssets/AB/Windows. A PlayCover container becomes its Documents/Bundles.
 * Null when `dir` is not a client location.
 */
export function resolveGameDir(dir) {
  if (!dir) return null;
  const abs = path.resolve(String(dir));
  if (!exists(abs)) return null;
  const spec = clientSpec();
  if (inspectClientRoot(abs).autochess || endsWithAbTail(abs, spec)) return abs;
  const bundles = playcoverBundles(abs, spec);
  if (bundles) return bundles;
  const install = findInstallRoot(abs, spec);
  if (!install) return null;
  return path.join(install, ...spec.abTail);
}

function describeClient(dir, kind) {
  if (!dir) return null;
  const info = inspectClientRoot(dir);
  if (!info.exists) return null;
  return { path: dir, kind, ...info };
}

/**
 * First installed client. An explicit directory is resolved (install dir or AB root). With no explicit directory,
 * `.cache/setup-state.json` `localExtractedFrom` wins when that directory is still there, then the OS candidates.
 * `opts.state` replaces the state file (tests).
 */
export function findClient(explicit, opts = {}) {
  const state = opts.state !== undefined ? opts.state : loadState();
  if (explicit) {
    const abs = path.resolve(explicit);
    const resolved = resolveGameDir(abs);
    const described = describeClient(resolved, '--game');
    if (described) return described;
    if (resolved && exists(abs)) return { path: resolved, kind: '--game', exists: false, autochess: false };
    return describeClient(abs, '--game');
  }
  const list = [];
  const remembered = state && state.localExtractedFrom;
  if (remembered) {
    const resolved = resolveGameDir(remembered) || (exists(remembered) ? path.resolve(remembered) : null);
    if (resolved) list.push({ path: resolved, kind: 'remembered' });
  }
  list.push(...clientCandidates());
  let partial = null;
  for (const cand of list) {
    const info = inspectClientRoot(cand.path);
    if (info.exists && info.autochess) return { ...cand, ...info };
    if (info.exists && !partial) partial = { ...cand, ...info };
  }
  return partial;
}

// ---------------------------------------------------------------------------------------------------
// Python (optional)
// ---------------------------------------------------------------------------------------------------

/** A usable Python ≥ 3.8 launcher: { cmd, args, version } or null. Windows Store stubs are skipped (no version). */
export function findPython() {
  const cands = IS_WIN ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [cmd, pre] of cands) {
    const r = capture(cmd, [...pre, '--version'], { timeout: 10000 });
    const m = /Python (\d+)\.(\d+)(?:\.(\d+))?/.exec(r.out);
    if (!r.ok || !m) continue;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (major === 3 && minor >= 8) return { cmd, args: pre, version: `${m[1]}.${m[2]}${m[3] ? '.' + m[3] : ''}`, minor };
  }
  return null;
}

export function venvPython() {
  return IS_WIN ? path.join(VENV_DIR, 'Scripts', 'python.exe') : path.join(VENV_DIR, 'bin', 'python');
}

/** User-facing fx re-extract. The venv interpreter, relative to the repo, not `python` on PATH.
 * Windows prints `Scripts\\python.exe`. `win` is for tests; the default follows this process. */
export function fxReextractCommand(win = IS_WIN) {
  const py = win ? '.venv-extract\\Scripts\\python.exe' : '.venv-extract/bin/python';
  return `${py} tools/local-extract/extract.py --only fx --fx-set used`;
}

const PY_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' };

/** Create .venv-extract and install tools/local-extract/requirements.txt (skipped when the imports already work). */
function ensureVenv(py, log) {
  const vpy = venvPython();
  if (!exists(vpy)) {
    log(`  创建 Python 虚拟环境 ${path.relative(ROOT, VENV_DIR)} …`);
    const r = run(py.cmd, [...py.args, '-m', 'venv', VENV_DIR], { env: PY_ENV });
    if (!r.ok || !exists(vpy)) return { ok: false, why: 'python -m venv 失败（Debian/Ubuntu 需要 `sudo apt install python3-venv`）' };
  }
  if (capture(vpy, ['-c', 'import UnityPy, lz4, PIL'], { env: PY_ENV }).ok) return { ok: true, python: vpy };
  log('  安装 UnityPy / lz4 / Pillow（首次约 1–3 分钟）…');
  const r = run(vpy, ['-m', 'pip', 'install', '-r', EXTRACT_REQ], { env: PY_ENV });
  if (!r.ok || !capture(vpy, ['-c', 'import UnityPy, lz4, PIL'], { env: PY_ENV }).ok) {
    return { ok: false, why: 'pip 安装依赖失败（若 Python 版本过新导致没有预编译包，请安装 Python 3.12 后删除 .venv-extract 重试）' };
  }
  return { ok: true, python: vpy };
}

// ---------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = { check: false, offline: false, refresh: false, assets: true, local: 'ask', scenes: 'ask', game: null, yes: false, quiet: false, help: false, source: process.env.SP_ASSET_SOURCE || 'direct' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--offline' || a === '--no-network') { o.offline = true; o.check = true; }
    else if (a === '--refresh-index') o.refresh = true;
    else if (a === '--no-assets') o.assets = false;
    else if (a === '--asset-source') o.source = argv[++i];
    else if (a.startsWith('--asset-source=')) o.source = a.slice('--asset-source='.length);
    else if (a === '--no-local') o.local = 'no';
    else if (a === '--local') o.local = 'force';
    else if (a === '--no-scenes') o.scenes = 'no';
    else if (a === '--scenes') o.scenes = 'force';
    else if (a === '--game') { o.game = argv[++i] || null; if (o.local !== 'no') o.local = 'force'; }
    else if (a.startsWith('--game=')) { o.game = a.slice(7) || null; if (o.local !== 'no') o.local = 'force'; }
    else if (a === '-y' || a === '--yes') o.yes = true;
    else if (a === '--quiet' || a === '-q') o.quiet = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`未知参数 / unknown option: ${a}（--help 查看用法）`);
  }
  if (!o.help) validateSource(o.source);
  return o;
}

function helpText() {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const start = src.findIndex((l) => l.startsWith('//   node tools/setup.mjs'));
  const end = src.findIndex((l, i) => i > start && l.startsWith('// Exit code'));
  return src.slice(start, end + 1).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); return 2; }
  if (opts.help) { console.log(helpText()); return 0; }
  if (!opts.check && opts.assets && restartForEnvProxy()) return 0;
  const log = (s = '') => console.log(s);
  const say = (s) => { if (!opts.quiet) log(s); };
  const summary = [];
  const add = (state, label, detail = '') => summary.push({ state, label, detail });
  let fatal = false;

  say(c.bold('\n卫戍协议：盟约 · setup') + c.dim(`  (${ROOT})`));

  // 1. Node
  const node = checkNode();
  if (!node.ok) {
    log(`${mark.err} Node.js ${node.version} 太旧：需要 ${MIN_NODE} 或更高（22 / 24 LTS）。`);
    log(`  下载：${NODE_URL}` + (IS_WIN ? '   或在终端运行：winget install OpenJS.NodeJS.LTS' : IS_MAC ? '   或：brew install node@22' : ''));
    return 1;
  }
  add('ok', 'Node.js', `v${node.version}${node.recommended ? '' : '（可用；推荐 22 / 24 LTS）'}`);

  // 2. npm dependencies
  let deps = checkDeps();
  if (!deps.ok && !opts.check) {
    log(`\n${c.cyan('▶')} 安装依赖（npm ci）…`);
    const npm = npmCommand();
    let r = run(npm.cmd, [...npm.pre, 'ci', '--no-audit', '--no-fund'], { shell: npm.shell });
    if (!r.ok) {
      log(c.warn('  npm ci 失败，改用 npm install …'));
      r = run(npm.cmd, [...npm.pre, 'install', '--no-audit', '--no-fund'], { shell: npm.shell });
    }
    deps = checkDeps();
  }
  if (deps.ok) add('ok', '依赖 node_modules');
  else { add('err', '依赖 node_modules', `缺少 ${deps.missing.join(', ')} → 运行 npm install`); fatal = true; }

  // 3. vendor
  let vendor = checkVendor();
  if (!vendor.ok && deps.ok && !opts.check) {
    log(`\n${c.cyan('▶')} 复制前端库到 public/vendor …`);
    run(process.execPath, [path.join(ROOT, 'tools', 'vendor.mjs')]);
    vendor = checkVendor();
  }
  if (vendor.ok) add('ok', '前端库 public/vendor', vendor.optionalMissing.length ? '（three.js 缺失：3D 棋盘回退为 2D）' : '');
  else { add('err', '前端库 public/vendor', `缺少 ${vendor.missing.join(', ')} → 运行 node tools/vendor.mjs`); fatal = true; }

  // 4. data
  const data = checkData();
  if (data.ok) add('ok', '游戏数据 data/*.json');
  else {
    add('err', '游戏数据 data/*.json', [data.missing.length && `缺少 ${data.missing.join(', ')}`, data.broken.length && `无法解析 ${data.broken.join(', ')}`].filter(Boolean).join('；') + ' → git checkout -- data/ 或 node tools/build-data.mjs');
    if (data.missing.some((n) => n !== 'assets' && n !== 'emotes') || data.broken.length > 0) fatal = true;
  }

  // 5. assets
  let assets = checkAssets();
  if (!opts.assets) add(assets.ok ? 'ok' : 'skip', '美术/音频 public/assets', assets.ok ? `${assets.total} 个文件` : '已跳过（--no-assets）');
  else if (!assets.ok && deps.ok && !opts.check) {
    const what = !assets.present ? `首次下载约 ${assets.bytes ? mb(assets.bytes) : ART_DOWNLOAD_FALLBACK}，可随时中断，重新运行会续传`
      : `补全缺失的 ${assets.missing} 个文件`;
    log(`\n${c.cyan('▶')} 下载美术与音频素材（${what}）…`);
    const r = run(process.execPath, [path.join(ROOT, 'tools', 'fetch-assets.mjs'), `--asset-source=${opts.source}`]);
    assets = checkAssets();
    if (!r.ok && !assets.ok) log(c.warn('  素材下载未完成（网络问题？）。游戏仍可运行（使用占位图），稍后重新运行 setup 即可续传。'));
  }
  if (opts.assets) {
    if (assets.ok) add('ok', '美术/音频 public/assets', `${assets.total} 个文件`);
    else if (!assets.present) add('warn', '美术/音频 public/assets', '未下载（游戏会用占位图）→ node tools/fetch-assets.mjs');
    else add('warn', '美术/音频 public/assets', `缺 ${assets.missing}/${assets.total} 个文件 → 重新运行 setup 续传`);
  }

  // Startup/update launchers run this same setup before starting the game. No runtime downloader.
  await preparePluginOfficialTables(ROOT, { ...opts, log });

  // 6. local client (optional)
  const local = checkLocal();
  const state = loadState();
  // §34.28: resolve art consent before a full run; its ordinary default-yes prompt is only for vanilla art.
  const missingArt = checkPluginArt();
  const artClient = opts.local === 'no' ? null : findClient(opts.game);
  const artKey = missingArt.join(',');
  let artAnswer = false;
  if (missingArt.length && artClient && !opts.check && opts.local !== 'no' && opts.local !== 'force' && !opts.yes && state.pluginArtDeclined !== artKey) {
    log(`Plugin operator art missing locally: ${missingArt.join(', ')}`);
    artAnswer = await ask('Extract referenced official operator art from the local game now?', false);
    if (artAnswer === false) saveState({ pluginArtDeclined: artKey });
  }
  const artAllowed = artClient && pluginFxExtractionAllowed(opts, missingArt, artAnswer);
  // Manifest assessments are replaced after step 7 (a scene extract in this run must not leave the art row on warn).
  let artRefresh = null;
  const pushArt = (snap, tail, verb, hasClient) => {
    add(localArtState(snap), '本地客户端美术（可选）', localArtDetail(snap, tail, verb, { client: hasClient }));
    artRefresh = { index: summary.length - 1, tail, verb, client: hasClient };
  };
  if (opts.local === 'no') {
    // [ASSUMED] --no-local still looks up a client so a scene-only gap names --scenes or the copy sentence. It does not extract.
    const hinted = findClient(opts.game)?.autochess === true;
    if (local.manifest) pushArt(local, '', '已提取', hinted);
    else add('skip', '本地客户端美术（可选）', '已跳过（--no-local）');
  } else {
    const client = findClient(opts.game);
    const already = local.manifest && local.dirPresent;
    if (!client) {
      if (already && local.board3d && !local.tiles && !opts.check) cropBoardTiles(log);
      if (already) pushArt(local, local.board3d ? '，3D 棋盘可用' : '', '已提取', false);
      else add('skip', '本地客户端美术（可选）', `${opts.game ? `找不到 ${opts.game}` : '未检测到本机明日方舟客户端'}：${LOCAL_ART_FALLBACK}（见 docs/DEPLOY.md 第 6 节）`);
    } else if (!client.autochess) {
      add(already ? localArtState(local) : 'warn', '本地客户端美术（可选）', `${client.kind} 客户端缺少卫戍协议资源（请在游戏内下载全部资源）：${client.path}${already ? localGaps(local, { client: false }) : ''}`);
    } else if (already && opts.local !== 'force') {
      if (local.board3d && !local.tiles && !opts.check) cropBoardTiles(log);
      pushArt(local, local.board3d ? '，3D 棋盘可用' : '', '已提取', true);
    } else if (opts.check) {
      add('skip', '本地客户端美术（可选）', `检测到 ${client.kind} 客户端，可运行 node tools/setup.mjs --local 提取`);
    } else {
      const py = findPython();
      if (!py) {
        add('skip', '本地客户端美术（可选）', `检测到 ${client.kind} 客户端，但没有 Python 3.8+（${IS_WIN ? 'winget install Python.Python.3.12' : 'https://www.python.org/downloads/'}）`);
      } else {
        let go = opts.local === 'force' || opts.yes;
        if (go || !state.localDeclined) {
          log(`\n${c.cyan('▶')} 检测到本机明日方舟客户端（${client.kind}）：\n  ${c.dim(client.path)}`);
          log('  可以从中提取官方 3D 棋盘贴图、界面图标等（仅本机使用；通常 1–5 分钟，Python 依赖约 40 MB，装在项目内的 .venv-extract）。');
        }
        let unattended = false;
        if (!go && !state.localDeclined) {
          const answer = await ask('现在提取吗？', true);
          if (answer === null) unattended = true; // no terminal (service, pipe): don't install Python packages unasked
          else if (!answer) { saveState({ localDeclined: true }); log(c.dim('  已记住选择，之后不再询问；需要时运行 node tools/setup.mjs --local')); }
          go = answer === true;
        }
        if (!go) add('skip', '本地客户端美术（可选）', unattended ? '无终端，未询问、未提取（需要时运行 node tools/setup.mjs --local）' : '已跳过（需要时运行 node tools/setup.mjs --local）');
        else {
          const venv = ensureVenv(py, log);
          if (!venv.ok) add('warn', '本地客户端美术（可选）', venv.why);
          else {
            log(`  ${c.cyan('▶')} 提取中（python tools/local-extract/extract.py --game …）`);
            const r = run(venv.python, [EXTRACT_PY, '--game', client.path, ...(artAllowed ? ['--plugin-art'] : [])], { env: PY_ENV });
            if (r.ok) cropBoardTiles(log);
            const after = checkLocal();
            if (r.ok && after.manifest) { pushArt(after, after.board3d ? '，3D 棋盘可用' : '', '提取', true); saveState({ localDeclined: false, localExtractedFrom: client.path }); }
            else add('warn', '本地客户端美术（可选）', `提取未成功（退出码 ${r.code}）：游戏照常运行，${LOCAL_ART_FALLBACK}；可稍后重试 node tools/setup.mjs --local`);
          }
        }
      }
    }
  }
  // [ASSUMED] --local includes used effects. A new plugin reference is a separate opt-in gap on update/startup.
  const missingFx = checkPluginFx();
  const fxClient = opts.local === 'no' ? null : findClient(opts.game);
  const gapKey = missingFx.join(',');
  let fxAnswer = false;
  if (missingFx.length && fxClient && !opts.check && opts.local !== 'no' && opts.local !== 'force' && !opts.yes && state.pluginFxDeclined !== gapKey) {
    log(`Plugin effects missing locally: ${missingFx.join(', ')}`);
    fxAnswer = await ask('Extract referenced official effects from the local game now?', false);
    if (fxAnswer === false) saveState({ pluginFxDeclined: gapKey });
  }
  if (fxClient && pluginFxExtractionAllowed(opts, missingFx, fxAnswer)) {
    const py = findPython(), venv = py && ensureVenv(py, log);
    if (venv?.ok) {
      const r = run(venv.python, [EXTRACT_PY, '--game', fxClient.path, '--only', 'fx', '--fx-set', 'used'], { env: PY_ENV });
      if (r.ok) saveState({ pluginFxDeclined: '' });
    }
  }
  const fxAfter = checkLocal().fx;
  add(fxAfter.state, '官方特效清单（可选）', fxAfter.detail);
  const fxGap = checkPluginFx();
  if (fxGap.length) add('warn', 'Plugin official effects', `Missing ${fxGap.join(', ')}; run node tools/setup.mjs --local with a local game install.`);

  // Reuse the consent resolved before full extraction; retry only remaining operator gaps.
  if (artAllowed && checkPluginArt().length) {
    const py = findPython(), venv = py && ensureVenv(py, log);
    if (venv?.ok) {
      const r = run(venv.python, [EXTRACT_PY, '--game', artClient.path, '--only', 'plugin-art'], { env: PY_ENV });
      if (r.ok) saveState({ pluginArtDeclined: '' });
    }
  }
  const artGap = checkPluginArt();
  if (artGap.length) add('warn', 'Plugin official operator art', `Missing ${artGap.join(', ')}; run node tools/setup.mjs --local with a local game install. Plugin artwork still takes priority.`);

  // 7. official battlefield scenes (optional; the full zip ships them, a lite / source install may fetch them)
  if (opts.scenes !== 'no') {
    const sceneLocal = checkLocal();
    const sceneClient = findClient(opts.game);
    const scenePy = findPython();
    const clientFlag = sceneClient?.autochess ? true : (sceneClient ? 'incomplete' : false);
    let decision = sceneInstallPlan({
      hasScenes: sceneLocal.scenes,
      sceneStagesHave: sceneLocal.sceneStagesHave,
      sceneStagesExpected: sceneLocal.sceneStagesExpected,
      sceneGroupHave: sceneLocal.sceneGroupHave,
      missingSceneGroups: sceneLocal.missingSceneGroups,
      sceneVersionStale: sceneLocal.sceneVersionStale,
      sceneVersionHave: sceneLocal.sceneVersionHave,
      sceneVersionExpected: sceneLocal.sceneVersionExpected,
      client: clientFlag, python: !!scenePy, check: opts.check,
      declined: !!loadState().sceneDeclined, force: opts.scenes === 'force', yes: opts.yes,
    });
    const filesPartial = sceneFilesPartial(sceneLocal);
    const versionOnly = sceneVersionOnlyGap(sceneLocal);
    if (decision.state === 'ask') {
      if (filesPartial || versionOnly) log(`\n${c.cyan('▶')} ${decision.detail}`);
      else {
        log(`\n${c.cyan('▶')} 各战场的官方场景还没提取（${sceneLocal.sceneStagesExpected} 个战场；赛季场景包约 23 MB，贴图仍取自本机客户端）。`);
        log('  下载并提取后，3D 棋盘按战场显示官方场景。没有提取依赖、下载失败或跳过时，仍用现在的金属地块。');
      }
      const answer = await ask('现在下载并提取吗？', sceneAskDefault(filesPartial || versionOnly));
      const allow = sceneClientExtractAllowed({ partial: filesPartial, force: opts.scenes === 'force', yes: opts.yes, answer });
      if (answer === null) decision = { run: false, state: 'skip', detail: '无终端，未询问、未提取战场场景。3D 棋盘用金属地块（需要时 node tools/setup.mjs --scenes）' };
      else if (!allow) {
        // A partial set (some scenes missing) never starts extract.py from this prompt.
        // Enter, the timeout, and a typed yes do not. A version-only 否 is remembered here too.
        if (answer) log(c.dim('  这一步不会从客户端提取。需要时运行 node tools/setup.mjs --scenes，或加上 --yes'));
        else saveState({ sceneDeclined: true });
        decision = answer
          ? { run: false, state: 'warn', detail: decision.detail }
          : { run: false, state: 'skip', detail: '已跳过战场场景（node tools/setup.mjs --scenes）。3D 棋盘用金属地块' };
      } else decision = { run: true, state: 'ok', detail: decision.detail };
    }
    // Second gate: extract.py --only scene runs only when the plan's run is allowed for this manifest.
    // filesPartial, not a version-only gap: a typed yes on the version prompt already set run.
    const mayExtract = decision.run && sceneClientExtractAllowed({
      partial: filesPartial, force: opts.scenes === 'force', yes: opts.yes, answer: true,
    });
    if (!mayExtract) add(decision.state === 'ok' ? 'ok' : decision.state, '各战场官方场景（可选）', decision.detail);
    else {
      const venv = ensureVenv(scenePy, log);
      if (!venv.ok) add('warn', '各战场官方场景（可选）', `${venv.why}。3D 棋盘继续用金属地块`);
      else {
        log(`  ${c.cyan('▶')} 下载赛季场景包（python tools/local-extract/fetch_scenes.py，约 23 MB）`);
        const fr = run(venv.python, [FETCH_SCENES_PY], { env: PY_ENV });
        if (!fr.ok) add('warn', '各战场官方场景（可选）', `场景包下载未完成（退出码 ${fr.code}）。3D 棋盘继续用金属地块；稍后可重试 node tools/setup.mjs --scenes`);
        else {
          log(`  ${c.cyan('▶')} 提取战场场景（extract.py --only scene）`);
          const er = run(venv.python, [EXTRACT_PY, '--game', sceneClient.path, '--only', 'scene'], { env: PY_ENV });
          const afterScenes = checkLocal();
          if (er.ok && afterScenes.scenes) {
            add('ok', '各战场官方场景（可选）', '已提取；进入对局时按战场显示，没有的战场仍用金属地块');
            saveState({ sceneDeclined: false });
          } else add('warn', '各战场官方场景（可选）', `提取未成功（退出码 ${er.code}）。3D 棋盘继续用金属地块`);
        }
      }
    }
  }
  if (artRefresh) summary[artRefresh.index] = artRowAfterScenes(summary[artRefresh.index], checkLocal(), artRefresh);

  // summary
  log(c.bold('\n── 准备情况 ──────────────────────────────'));
  const width = Math.max(...summary.map((s) => displayWidth(s.label))) + 2;
  for (const s of summary) log(`${mark[s.state]} ${padDisplay(s.label, width)}${s.detail ? c.dim(s.detail) : ''}`);
  if (fatal) {
    log(c.err('\n还不能启动：请先解决上面标 ✘ 的问题（node tools/doctor.mjs 可做更详细的诊断）。'));
    return 1;
  }
  if (!opts.quiet) {
    log(`\n${c.ok('可以开始了：')} npm start   ${c.dim('（Windows 可直接双击 scripts\\start-windows.bat）')}`);
    log(c.dim('浏览器打开 http://localhost:3000 ；同一局域网的朋友用终端里打印的 LAN 地址。'));
  }
  return 0;
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.error(`${mark.err} setup 出错：${e?.stack || e}`);
    process.exitCode = 1;
  });
}
