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
//   5. Art/audio (tools/fetch-assets.mjs, ~550 MB into public/assets, resumable, mirror fallback) when public/assets
//      is missing or data/assets.json lists files that are not on disk. A failure is a warning: the game still runs
//      with fallback visuals and the next run resumes.
//   6. Optional: official board/UI art from a locally installed Arknights client (Windows native install, CrossOver
//      bottle or PlayCover on macOS, or --game <dir>) with tools/local-extract/extract.py in a project-local Python
//      venv (.venv-extract), then the board tile crops (tools/crop-board-atlas.mjs → tiles.json). Asked once on a
//      terminal (the answer is remembered in .cache/setup-state.json; without a terminal it is skipped); never fatal.
//   7. Optional: the eleven official battlefield scenes (0.2.5 asset pack). The full release zip already contains
//      them when the maintainer extracted them. A lite package or a source install may download the in-season bundles
//      (tools/local-extract/fetch_scenes.py) and extract them (extract.py --only scene). Missing Python or
//      UnityPy / lz4 / Pillow is a warning: the 3D board keeps the metal tiles. --scenes does it without asking;
//      --no-scenes skips it. The answer is remembered like step 6.
//
// Options:
//   --check          report only, change nothing (exit 1 when something essential is missing)
//   --no-assets      skip the art/audio download
//   --asset-source=M direct (default) or mirror (opt-in; no public-IP lookup)
//                    SP_ASSET_SOURCE sets the default; SP_GITHUB_PROXY sets the HTTPS prefix (https://gh-proxy.com/)
//                    An empty SP_GITHUB_PROXY disables the proxy, including in mirror mode.
//   --no-local       skip the local-client detection and extraction (the scene step still runs unless --no-scenes)
//   --local          extract from the local client without asking (re-extracts when already done)
//   --scenes         download and extract the official battlefield scenes without asking
//   --no-scenes      do not download or extract battlefield scenes (the metal board stays)
//   --game <dir>     the local client: its install folder (the one holding Arknights.exe), its Arknights_Data folder or
//                    the AssetBundle root (…/StreamingAssets/AB/Windows, PlayCover …/Documents/Bundles). A folder that
//                    holds the autochess art is remembered (.cache/setup-state.json clientPath), so it is given once.
//                    Lookup order without it: SP_ARKNIGHTS_AB → the remembered folder → the usual install locations
//                    (no drive is scanned). When none has a client, a terminal run asks once for the folder (60 s,
//                    Enter = skip and stop asking); --check, --quiet, -y and a run without a terminal never ask.
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
 * manifest's stats.bytes, 548 MB (both voice dubs; 463 MB before the JP one), as README and docs/DEPLOY.md quote it. */
const ART_DOWNLOAD_FALLBACK = '550 MB';
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

/** Ask for a free-text answer on a TTY. Non-TTY, or no answer within `timeoutMs` → null; an empty answer → ''. */
async function askText(question, timeoutMs = 60000) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => {
      const t = setTimeout(() => { process.stdout.write(c.dim(`\n  (${timeoutMs / 1000} 秒无输入，本次跳过)\n`)); resolve(null); }, timeoutMs);
      rl.question(`  ${question} `, (a) => { clearTimeout(t); resolve(String(a || '').trim().replace(/^["']|["']$/g, '')); });
    });
  } finally {
    rl.close();
  }
}

/**
 * The local client for this run. --game: the given folder, remembered in setup-state.json (`clientPath`) when it
 * holds the autochess art. Otherwise findClient's order; when that finds no usable client, a terminal run asks once
 * for the install folder (with askText's timeout): a valid answer is remembered as `clientPath`, an empty one as
 * `clientDeclined` (setup stops asking; --game still works), no answer in time changes nothing. Never asks with
 * --check, --quiet (scripts/launch.mjs starts the game through it), --yes or without a terminal, and --check never
 * writes the state file. `find`, `prompt`, `state`, `tty` and `log` are replaceable for the tests.
 */
export async function locateClient(explicit, o = {}) {
  const { yes = false, quiet = false, check = false, find = findClient, prompt = askText,
    state = { load: loadState, save: saveState }, tty = !!(process.stdin.isTTY && process.stdout.isTTY), log = console.log } = o;
  const found = find(explicit);
  if (explicit) {
    if (found?.autochess && !check && state.load().clientPath !== found.path) state.save({ clientPath: found.path, clientDeclined: false });
    return found;
  }
  if (found?.autochess || yes || quiet || check || !tty || state.load().clientDeclined) return found;
  log(`\n${c.cyan('▶')} 没有找到可用的明日方舟客户端（已查看常见安装位置和上次记住的路径；不扫描磁盘）。`);
  log('  若游戏装在别处，请输入安装目录（里面有 Arknights.exe 的文件夹，例如 D:\\Games\\Arknights Game），也可以直接输入 Arknights_Data\\StreamingAssets\\AB\\Windows。');
  log(c.dim('  直接回车跳过；跳过后不再询问，之后可用 --game <目录> 指定，或设置环境变量 SP_ARKNIGHTS_AB。'));
  const typed = await prompt('客户端安装目录：');
  if (typed === null) return found;
  if (!typed) { state.save({ clientDeclined: true }); return found; }
  const root = resolveAbRoot(typed);
  const info = inspectClientRoot(root);
  if (info.exists && info.autochess) {
    state.save({ clientPath: root, clientDeclined: false });
    log(`  ${c.ok('✔')} 已记住：${root}`);
    return { path: root, kind: '手动输入', ...info };
  }
  log(`  ${c.warn('!')} ${typed} 里没有找到卫戍协议需要的美术（${info.exists ? '缺少 ui/autochess 或 arts/maps/map_autochess，请在游戏内下载全部资源' : '路径不存在'}）。`);
  return found;
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
    if (!st || !st.size) missing.push(u);
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

/**
 * Local-client art (optional): manifest entry count, whether the 3D board atlas is on disk and whether the extraction
 * has the enemy and token models only the client has (`spine/enemy/*` groups, extract.py ENEMY_SPINES — added after
 * 0.1.0; `spine/token/*` groups, TOKEN_SPINES — added in 0.2.0).
 */
export function checkLocal() {
  const m = readJson(LOCAL_MANIFEST);
  const count = m && m.groups ? Object.values(m.groups).reduce((n, g) => n + Object.keys(g || {}).length, 0) : 0;
  const has = (prefix) => !!(m && m.groups && Object.keys(m.groups).some((g) => g.startsWith(prefix)));
  return {
    manifest: !!m, count, board3d: exists(LOCAL_BOARD_ATLAS), tiles: exists(LOCAL_BOARD_TILES), enemySpines: has('spine/enemy/'),
    tokenSpines: has('spine/token/'), scenes: has('scene/act'), dirPresent: exists(path.join(ROOT, 'public', 'assets', 'local')),
  };
}

/** What an extraction made by an older extract.py lacks (setup's 本地客户端美术 row; re-extract with --local). */
export function localGaps(local) {
  const gaps = [];
  if (local && !local.enemySpines) gaps.push('灼热/炽焰源石虫模型');
  if (local && !local.tokenSpines) gaps.push('自选召唤物模型');
  if (local && local.scenes === false) gaps.push('各战场官方场景');
  return gaps.length ? `，缺少新版的${gaps.join('和')}` : '';
}

/**
 * Whether setup should download and extract the official battlefield scenes (0.2.5 asset pack).
 * The full release zip already contains them when the maintainer extracted them before packaging.
 * A lite package or a source install may fetch the in-season bundles on this machine and extract them.
 * Missing Python or UnityPy / lz4 / Pillow is not fatal: the 3D board keeps the metal tiles.
 * `client` is true (autochess bundles present), 'incomplete' (a client dir without them) or false.
 * @param {{ hasScenes?: boolean, client?: boolean|string, python?: boolean, deps?: boolean, check?: boolean, declined?: boolean, force?: boolean, yes?: boolean }} o
 * @returns {{ run: boolean, state: 'ok'|'skip'|'warn'|'ask', detail: string }}
 */
export function sceneInstallPlan(o = {}) {
  if (o.hasScenes && !o.force) {
    return { run: false, state: 'ok', detail: '已提取各战场官方场景（0.2.5 素材；某个战场没有文件时仍用金属地块）' };
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

const AB_TAIL = ['Arknights_Data', 'StreamingAssets', 'AB', 'Windows'];

/**
 * Accept an install folder (…\Arknights Game, holding Arknights.exe), its Arknights_Data folder or the AssetBundle
 * root itself; return the AssetBundle root (or the input as given when none of the layouts exists).
 */
export function resolveAbRoot(p) {
  if (!p) return null;
  const abs = path.resolve(p);
  const layouts = [path.join(abs, ...AB_TAIL), path.join(abs, 'StreamingAssets', 'AB', 'Windows'), abs];
  return layouts.find((c) => exists(c)) || abs;
}

/** Windows: the launcher's own install folder names used for the game ("Arknights" and "Arknights Game"). */
const WIN_GAME_DIRS = ['Arknights', 'Arknights Game'];

/** Candidate AssetBundle roots for this OS (existence not checked). */
export function clientCandidates() {
  const home = os.homedir();
  const out = [];
  const add = (p, kind) => out.push({ path: p, kind });
  if (IS_WIN) {
    const drives = ['C', 'D', 'E', 'F', 'G', 'H'];
    const bases = [];
    for (const g of WIN_GAME_DIRS) bases.push(
      ['Program Files', 'Hypergryph Launcher', 'games', g],
      ['Program Files (x86)', 'Hypergryph Launcher', 'games', g],
      ['Hypergryph Launcher', 'games', g],
      ['Games', 'Hypergryph Launcher', 'games', g],
      ['Program Files', 'Hypergryph', g],
      [g],
    );
    for (const d of drives) for (const b of bases) add(path.win32.join(`${d}:\\`, ...b, ...AB_TAIL), 'Windows');
  }
  if (IS_MAC) {
    const bottles = path.join(home, 'Library', 'Application Support', 'CrossOver', 'Bottles');
    let names = [];
    try { names = fs.readdirSync(bottles); } catch { /* no CrossOver */ }
    names.sort((a, b) => (b === 'Arknights') - (a === 'Arknights'));
    for (const n of names) {
      for (const pf of ['Program Files', 'Program Files (x86)']) {
        add(path.join(bottles, n, 'drive_c', pf, 'Hypergryph Launcher', 'games', 'Arknights', ...AB_TAIL), `CrossOver (${n})`);
      }
    }
    add(path.join(home, 'Library', 'Containers', 'com.hypergryph.arknights', 'Data', 'Documents', 'Bundles'), 'PlayCover');
  }
  if (!IS_WIN) {
    for (const prefix of [path.join(home, '.wine'), path.join(home, 'Games', 'arknights')]) {
      add(path.join(prefix, 'drive_c', 'Program Files', 'Hypergryph Launcher', 'games', 'Arknights', ...AB_TAIL), 'Wine');
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

/** A remembered client root (setup-state.json `clientPath`), set by --game or by the typed answer (locateClient). */
function savedClientPath() { return loadState().clientPath || null; }

/**
 * First installed client, in this order: explicit dir (--game) → SP_ARKNIGHTS_AB → the remembered path → the known
 * install locations. No drive is scanned: the answer comes from these, or from the user (locateClient asks). Returns a client with `autochess`
 * when it holds the autochess art, else the first existing root (partial), else null.
 */
export function findClient(explicit) {
  const pick = (list) => {
    let partial = null;
    for (const cand of list) {
      const info = inspectClientRoot(cand.path);
      if (info.exists && info.autochess) return { ...cand, ...info };
      if (info.exists && !partial) partial = { ...cand, ...info };
    }
    return partial;
  };
  if (explicit) return pick([{ path: resolveAbRoot(explicit), kind: '--game' }]);
  const env = process.env.SP_ARKNIGHTS_AB || process.env.SP_ARKNIGHTS_GAME;
  const saved = savedClientPath();
  const first = [];
  if (env) first.push({ path: resolveAbRoot(env), kind: 'SP_ARKNIGHTS_AB' });
  if (saved) first.push({ path: resolveAbRoot(saved), kind: '已记住的路径' });
  return pick([...first, ...clientCandidates().map((c) => ({ ...c, path: resolveAbRoot(c.path) }))]);
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
  const o = { check: false, assets: true, local: 'ask', scenes: 'ask', game: null, yes: false, quiet: false, help: false, source: process.env.SP_ASSET_SOURCE || 'direct' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
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
  const log = (s = '') => console.log(s);
  const say = (s) => { if (!opts.quiet) log(s); };
  // steps 6 and 7 share one lookup (and at most one question)
  let clientLookup = null;
  const theClient = () => (clientLookup ||= locateClient(opts.game, { yes: opts.yes, quiet: opts.quiet, check: opts.check }));
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

  // 6. local client (optional)
  const local = checkLocal();
  const state = loadState();
  if (opts.local === 'no') add(local.manifest ? 'ok' : 'skip', '本地客户端美术（可选）', local.manifest ? `已提取 ${local.count} 项` : '已跳过（--no-local）');
  else {
    const client = await theClient();
    const already = local.manifest && local.dirPresent;
    if (!client) {
      if (already && local.board3d && !local.tiles && !opts.check) cropBoardTiles(log);
      add(already ? 'ok' : 'skip', '本地客户端美术（可选）', already ? `已提取 ${local.count} 项`
        : `${opts.game ? `找不到 ${opts.game}` : '未检测到本机明日方舟客户端'}：${LOCAL_ART_FALLBACK}（见 docs/DEPLOY.md 第 6 节）`);
    } else if (!client.autochess) {
      add(already ? 'ok' : 'warn', '本地客户端美术（可选）', `${client.kind} 客户端缺少卫戍协议资源（请在游戏内下载全部资源）：${client.path}`);
    } else if (already && opts.local !== 'force') {
      if (local.board3d && !local.tiles && !opts.check) cropBoardTiles(log);
      add('ok', '本地客户端美术（可选）', `已提取 ${local.count} 项${local.board3d ? '，3D 棋盘可用' : ''}${localGaps(local)}（重新提取：--local）`);
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
            const r = run(venv.python, [EXTRACT_PY, '--game', client.path], { env: PY_ENV });
            if (r.ok) cropBoardTiles(log);
            const after = checkLocal();
            if (r.ok && after.manifest) { add('ok', '本地客户端美术（可选）', `提取 ${after.count} 项${after.board3d ? '，3D 棋盘可用' : ''}`); saveState({ localDeclined: false, localExtractedFrom: client.path }); }
            else add('warn', '本地客户端美术（可选）', `提取未成功（退出码 ${r.code}）：游戏照常运行，${LOCAL_ART_FALLBACK}；可稍后重试 node tools/setup.mjs --local`);
          }
        }
      }
    }
  }

  // 7. official battlefield scenes (optional; the full zip ships them, a lite / source install may fetch them)
  if (opts.scenes !== 'no') {
    const sceneLocal = checkLocal();
    const sceneClient = await theClient();
    const scenePy = findPython();
    const clientFlag = sceneClient?.autochess ? true : (sceneClient ? 'incomplete' : false);
    let decision = sceneInstallPlan({
      hasScenes: sceneLocal.scenes, client: clientFlag, python: !!scenePy, check: opts.check,
      declined: !!loadState().sceneDeclined, force: opts.scenes === 'force', yes: opts.yes,
    });
    if (decision.state === 'ask') {
      log(`\n${c.cyan('▶')} 各战场的官方场景还没提取（11 个战场；赛季场景包约 23 MB，贴图仍取自本机客户端）。`);
      log('  下载并提取后，3D 棋盘按战场显示官方场景。没有提取依赖、下载失败或跳过时，仍用现在的金属地块。');
      const answer = await ask('现在下载并提取吗？', true);
      if (answer === null) decision = { run: false, state: 'skip', detail: '无终端，未询问、未提取战场场景。3D 棋盘用金属地块（需要时 node tools/setup.mjs --scenes）' };
      else if (!answer) {
        saveState({ sceneDeclined: true });
        decision = { run: false, state: 'skip', detail: '已跳过战场场景（node tools/setup.mjs --scenes）。3D 棋盘用金属地块' };
      } else decision = { run: true, state: 'ok', detail: decision.detail };
    }
    if (!decision.run) add(decision.state === 'ok' ? 'ok' : decision.state, '各战场官方场景（可选）', decision.detail);
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
