// server/plugins/pack.js — checking and packing a plugin folder (DESIGN §32.3 and §32.9, docs/PLUGINS.md §8 / §15): the
// code behind `node tools/plugin.mjs check / pack` and the studio's 校验 / 打包 (server/studio/), here because the server
// ships and tools/plugin.mjs does not (tools/package.mjs).
//
//   checkPluginFolder(dir, where, { vanilla, dataDir })   the registry's rules (readPluginFolder — a cosmetic plugin's overlay too)
//                                                and every JSON file's content (valid, nesting ≤ 64, numbers within ±1e9)
//   buildPluginLock(dir, { vanilla })            plugin.lock.json: every file's SHA-256 and size, and each Spine model's
//                                                clip data (skeletonClipData) — null with the overlay's problems
//   skeletonClipData(dir, spine, containers)     one model's roles, durations, events, hits and bounds, parsed from the
//                                                skeleton the way tools/fetch-assets.mjs parses the game's
//                                                (tools/assets/skel.mjs, anim-roles.mjs), its atlas pages matched against
//                                                `textures` (the studio's preview of a model not packed yet uses it too)
//   packPlugin(dir, { vanilla })                 write the lock (when it has no problem), then check the folder
//   zipPlugin(dir)                               the folder as a deterministic zip (server/plugins/zip.js): `<id>/…`,
//                                                every file but dot files and links — the lock and the documents too
// Nothing here reads or writes through a symbolic link inside the folder (plainPath: the registry keeps a folder with a
// link out — PLUGIN_FILE_LINK —, and a link put in a plugin folder never makes the packer or the studio read a file
// elsewhere or write over one); the lock is written to a temporary file renamed over it.
// Every result carries `issues` beside its plain `problems` / `warnings` (shared/plugins/errors.js). The packer does not
// look for official game files (the owner's decision of 2026-10-13): a plugin's author answers for what it carries
// (docs/PLUGINS.md §1 still asks never to put them in one).

import fs from 'node:fs';
import { readFxAssets, readFxManifest as readPluginManifest } from './fxAssets.js';
import { pluginFxGap } from './fxReferences.js';
import { readInstalledAssetOverlay } from './artReferences.js';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readPluginFolder, listPluginFiles, walkProblem } from './registry.js';
import { PLUGIN_LIMITS, PLUGIN_MANIFEST, isPluginId, checkJsonLimits, extOf } from '../../shared/plugins/manifest.js';
import { LOCK_FILE, LOCK_VERSION } from '../../shared/plugins/visual.js';
import { issueList } from '../../shared/plugins/errors.js';
import { parseSkel } from '../../tools/assets/skel.mjs';
import { resolveRoles } from '../../tools/assets/anim-roles.mjs';
import { atlasInfo } from '../../tools/assets/atlas.mjs';
import { DATA_DIR } from '../data.js';
import { gameplayDataFiles } from './identity.js';
import { applyPatches, normalizeSettings } from '../../shared/plugins/patch.js';
import { appendOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { zipFiles } from './zip.js';
import { hasOperatorTrait } from './operatorTraits.js';
import { buildContentSet } from './contentSet.js';
import { operatorMetadataProblems } from '../../shared/plugins/records.js';

/** What packs a lock (its `generator`). */
export const LOCK_GENERATOR = 'tools/plugin.mjs pack';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * The path of `rel` (a plain relative path) inside the folder `dir`, never through a symbolic link: every part that exists
 * is lstat'ed, and a link throws an error with code 'ELINK' (a missing part is left to the read that follows: ENOENT).
 * @param {string} dir @param {string} rel
 */
export function plainPath(dir, rel) {
  const parts = String(rel).split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) throw Object.assign(new Error(`${String(rel).slice(0, 80)}: not a plain path`), { code: 'EPATH' });
  let cur = dir;
  for (const part of parts) {
    cur = path.join(cur, part);
    const st = fs.lstatSync(cur, { throwIfNoEntry: false });
    if (!st) break;
    if (st.isSymbolicLink()) throw Object.assign(new Error(`${String(rel).slice(0, 80)}: a symbolic link (a plugin's files are plain files inside its folder)`), { code: 'ELINK' });
  }
  return path.join(dir, ...parts);
}
const abs = plainPath;

/**
 * An error in words for a finding: a parse error's own message, a file system error's code only (its message names the
 * absolute path — the account's name in it — and a finding may reach a page of the studio).
 * @param {any} e
 */
export const errorWords = (e) => (e instanceof SyntaxError ? e.message : e?.code ? String(e.code) : String(e?.message || e));

/**
 * @typedef {import('./registry.js').VanillaAssets} VanillaAssets
 * @typedef {import('../../shared/plugins/errors.js').PluginIssue} PluginIssue
 * @typedef {{ problems: string[], warnings: string[], issues: PluginIssue[] }} Findings
 */

/**
 * Check one plugin folder: the registry's rules (readPluginFolder — for a cosmetic plugin its asset overlay too) and
 * every JSON file's content.
 * @param {string} dir
 * @param {string} where how the folder is named in the output
 * @param {{ vanilla?: VanillaAssets, dataDir?: string }} [opts] vanilla: the art manifest references must name (default: none — they are
 *   not checked)
 * @returns {Findings & { where: string, plugin: import('./registry.js').Plugin | null }}
 */
export function checkPluginFolder(dir, where, { vanilla, dataDir = DATA_DIR } = {}) {
  const r = readPluginFolder(dir, { where, vanilla, dataDir });
  const list = issueList();
  list.take(r);
  if (fs.existsSync(path.join(dir, PLUGIN_MANIFEST))) {
    for (const f of listPluginFiles(dir)) {
      if (f.link || extOf(f.rel) !== '.json' || f.bytes > PLUGIN_LIMITS.jsonBytes) continue;
      let json;
      try { json = JSON.parse(fs.readFileSync(abs(dir, f.rel), 'utf8')); } catch (e) {
        const why = e instanceof SyntaxError ? e.message : String(e?.code || e);
        list.problem('PLUGIN_JSON', `${f.rel}: not valid JSON (${why})`, { file: f.rel, detail: why });
        continue;
      }
      const bad = checkJsonLimits(json);
      if (bad) list.problem('PLUGIN_JSON_LIMIT', `${f.rel}: ${bad}`, { file: f.rel, detail: bad });
    }
  }
  // Check patched official values with the same bounds as C1, without running any script/preflight.
  // Paths supplied only by dependencies still need the complete content-set check in C1.
  const p = r.plugin;
  if (p?.content) {
    let index = null;
    try { index = JSON.parse(fs.readFileSync(path.join(dataDir, '../public/assets/local/fx/index.json'), 'utf8')); } catch { /* optional local extraction */ }
    const refs = new Set();
    const walk = v => { if (!v || typeof v !== 'object') return; if (typeof v.fx?.unit === 'string') refs.add(v.fx.unit); for (const x of Object.values(v)) walk(x); };
    for (const doc of Object.values(p.content.documents)) walk(doc);
    for (const id of pluginFxGap([...refs], index)) list.warning('PLUGIN_ASSET_IGNORED', `Official effects ${id} are absent locally; setup --local can extract them.`, { at: ['fx'], detail: id });
  }
  const operators = [...(p?.manifest.parts.operators?.files || []), ...(p?.manifest.parts.data?.files || [])]
    .flatMap(rel => { const doc = p.content?.documents[rel]; return Array.isArray(doc) ? doc : doc?.entries ?? [doc]; });
  if (!list.problems.length && operators.some(op => op?.origin)) {
    const official = Object.fromEntries(gameplayDataFiles(dataDir).map(f => [f.name, JSON.parse(fs.readFileSync(f.abs, 'utf8'))]));
    for (const op of operators) for (const e of operatorMetadataProblems(op, p.id, official)) list.problem(e.code, e.message, { where: e.path, detail: e.message });
  }
  if (!list.problems.length && operators.some(hasOperatorTrait)) {
    // [ASSUMED] Folder checks resolve required plugins beside this folder, as installed plugin folders do.
    // readPluginFolder snapshots JSON/scripts as text; checkDataOnly stops before any script preflight.
    const available = new Map([[p.id, p]]);
    const registry = { contentDirs: { dataDir }, plugin(id) {
      if (!available.has(id)) {
        const safe = isPluginId(id) && available.size < 256;
        const sibling = path.join(path.dirname(dir), id);
        const plain = safe && fs.existsSync(sibling) && !fs.lstatSync(sibling).isSymbolicLink();
        available.set(id, plain ? readPluginFolder(sibling, { vanilla }).plugin : null);
      }
      return available.get(id);
    } };
    const checked = buildContentSet({ registry, ids: [p.id], checkDataOnly: true });
    for (const e of checked.problems) list.problem(e.code, e.message, { where: e.path, detail: e.message });
  }
  const patches = (p?.manifest.parts.data?.files || []).map(rel => p.content?.documents[rel]).filter(doc => doc?.patch === 1);
  if (!list.problems.length && patches.length) {
    const official = Object.fromEntries(gameplayDataFiles(dataDir).map(f => [f.name, JSON.parse(fs.readFileSync(f.abs, 'utf8'))]));
    let data = official;
    const settings = normalizeSettings(p.manifest.settings);
    for (const doc of patches) for (const op of doc.ops) {
      const applied = applyPatches(data, [op], { pluginId: p.id, settings });
      if (!applied.problems.length) data = applied.data;
    }
    appendOfficialBounds(data, official, (where, detail, code) => list.problem(code, detail, { where, detail }));
  }
  return { where, plugin: list.problems.length ? null : r.plugin, problems: list.problems, warnings: list.warnings, issues: list.issues };
}

/**
 * The options a model's roles are resolved with, by the containers whose entries use it (as fetch-assets does): an
 * operator's three skill slots, an enemy's numbered skill clips — a skeleton several kinds of entry use gets both.
 * @param {Set<string>} containers
 */
const roleOptions = (containers) => ({ skillIndices: containers.has('chars') ? [0, 1, 2] : [0], numberedSkills: containers.has('enemies') });

/**
 * One Spine model's clip data, parsed from its files in the plugin folder (see the header) — the lock's `spine` entry of
 * its skeleton — or null with the problems.
 * @param {string} dir the plugin folder
 * @param {{ skel: string, atlas: string, textures: string[] }} spine the model (shared/plugins/visual.js SpineOp)
 * @param {Set<string>} containers the containers of the entries that use it ('chars', 'enemies', 'tokens')
 * @returns {Findings & { entry: Record<string, any> | null }}
 */
export function skeletonClipData(dir, spine, containers) {
  const list = issueList();
  const s = spine;
  try {
    const info = atlasInfo(fs.readFileSync(abs(dir, s.atlas), 'utf8'));
    const folder = s.atlas.replace(/[^/]*$/, '');
    const pages = info.pages.map((p) => folder + p);
    for (const p of pages) if (!s.textures.includes(p)) list.problem('PLUGIN_SPINE_PAGES', `${s.atlas}: its page ${p} is not in "textures" (a page the server is not told about is never served)`, { file: s.atlas, page: p, pages });
    for (const t of s.textures) if (!pages.includes(t)) list.warning('PLUGIN_SPINE_NOTE', `${s.skel}: "textures" names ${t}, which its atlas does not use`, { file: s.skel, detail: `"textures" names ${t}, which its atlas does not use` });
    const bytes = fs.readFileSync(abs(dir, s.skel));
    const sk = parseSkel(new Uint8Array(bytes), info.regions);
    if (!sk.animations.length) {
      list.problem('PLUGIN_SPINE_PARSE', `${s.skel}: the skeleton has no animations`, { file: s.skel });
      return { entry: null, problems: list.problems, warnings: list.warnings, issues: list.issues };
    }
    if (sk.missingRegions.length) list.warning('PLUGIN_SPINE_NOTE', `${s.skel}: ${sk.missingRegions.length} attachment(s) not in its atlas (e.g. ${sk.missingRegions[0]})`, { file: s.skel, detail: `${sk.missingRegions.length} attachment(s) not in its atlas (e.g. ${sk.missingRegions[0]})` });
    const entry = {
      sha256: sha256(bytes), anims: resolveRoles(sk.animations, { ...roleOptions(containers), durations: sk.durations }),
      animations: sk.durations, events: sk.events, hits: sk.hits, bounds: sk.bounds,
    };
    return { entry, problems: list.problems, warnings: list.warnings, issues: list.issues };
  } catch (e) {
    const why = errorWords(e).slice(0, 120);
    list.problem('PLUGIN_SPINE_PARSE', `${s.skel}: not a Spine 3.8 skeleton the client can read (${why})`, { file: s.skel, detail: why });
    return { entry: null, problems: list.problems, warnings: list.warnings, issues: list.issues };
  }
}

/**
 * The asset overlay of a cosmetic plugin as written (inline or its .json file), read with readAssetOverlay against the
 * folder's files — for the lock and the studio's preview.
 * @param {string} dir @param {import('../../shared/plugins/manifest.js').PluginManifest} manifest
 * @param {{ vanilla?: VanillaAssets, has?: (rel: string) => boolean }} [opts]
 * @returns {import('../../shared/plugins/visual.js').AssetOverlay | null} null for a plugin without an `assets` part
 */
export function readOverlayOf(dir, manifest, { vanilla, has } = {}) {
  const part = manifest.parts.assets;
  if (!part) return null;
  let assets = part.inline;
  const pre = issueList();
  if (!assets) {
    try { assets = JSON.parse(fs.readFileSync(abs(dir, part.files[0]), 'utf8')); } catch (e) {
      pre.problem('PLUGIN_JSON', `${part.files[0]}: ${errorWords(e)}`, { file: part.files[0], detail: errorWords(e) });
      assets = undefined; // read as nothing (the overlay's own problem follows, as the packer of 0.2 reported it)
    }
  }
  let effects = null;
  if (assets?.fx !== undefined) {
    try { effects = readFxAssets(dir, assets.fx, [manifest.id, ...Object.keys(manifest.requires || {})], listPluginFiles(dir)); }
    catch (e) { pre.problem('PLUGIN_PART_SHAPE', `fx: ${e.message}`, { at: ['assets', 'fx'], detail: e.message }); }
  }
  const plain = assets && { ...assets }; if (plain) delete plain.fx;
  const ov = readInstalledAssetOverlay(plain, { has: has || ((rel) => { try { return fs.statSync(abs(dir, rel)).isFile(); } catch { return false; } }), vanilla, permissions: manifest.permissions });
  if (effects) { ov.files.push(...effects.files); ov.ops.push({ at: ['fx', manifest.id], effects: effects.value }); }
  if (!pre.issues.length) return ov;
  const list = issueList();
  list.take(pre);
  list.take(ov);
  return { ...ov, problems: list.problems, warnings: list.warnings, issues: list.issues };
}

/**
 * The lock file of a plugin folder (see the header): every file's SHA-256 and size (not the lock's own, no dot file),
 * and — for a cosmetic plugin — the clip data of each Spine model its overlay names. A problem of the overlay (with
 * `vanilla`: its references and permissions too) leaves the lock unwritten.
 * @param {string} dir
 * @param {{ vanilla?: VanillaAssets }} [opts] the art manifest references must name
 * @returns {Findings & { lock: Record<string, unknown> | null }}
 */
export function buildPluginLock(dir, { vanilla } = {}) {
  const list = issueList();
  const done = (lock) => ({ lock, problems: list.problems, warnings: list.warnings, issues: list.issues });
  let raw;
  try { raw = JSON.parse(fs.readFileSync(abs(dir, PLUGIN_MANIFEST), 'utf8')); } catch (e) {
    if (e?.code === 'ELINK') { list.problem('PLUGIN_FILE_LINK', e.message, { file: PLUGIN_MANIFEST }); return done(null); }
    const why = e instanceof SyntaxError ? `not valid JSON (${e.message})` : String(e?.code || e);
    list.problem(e instanceof SyntaxError ? 'PLUGIN_JSON' : 'PLUGIN_NO_MANIFEST', `${PLUGIN_MANIFEST}: ${why}`, { file: PLUGIN_MANIFEST, detail: why });
    return done(null);
  }
  const read = readPluginManifest(raw, { id: path.basename(dir) });
  if (!read.manifest) { list.take(read, { warningsToo: false }); return done(null); }
  const manifest = read.manifest;
  const all = listPluginFiles(dir);
  const walked = walkProblem(all);
  if (walked) { list.problem('PLUGIN_FILE_SIZE', walked.text, { where: walked.where }); return done(null); }
  const listed = all.filter((f) => !f.link && f.rel !== LOCK_FILE);
  /** @type {Record<string, { sha256: string, bytes: number }>} */
  const files = {};
  for (const f of listed) files[f.rel] = { sha256: sha256(fs.readFileSync(abs(dir, f.rel))), bytes: f.bytes };
  /** @type {Record<string, any>} */
  const spine = {};
  if (manifest.class === 'cosmetic' && manifest.parts.assets) {
    const ov = readOverlayOf(dir, manifest, { vanilla, has: (rel) => Object.hasOwn(files, rel) });
    if (ov) list.take(ov, { warningsToo: false });
    /** @type {Map<string, Set<string>>} skeleton → the containers of the entries that use it */
    const users = new Map();
    for (const op of ov?.ops || []) if (op.spine) { if (!users.has(op.spine.skel)) users.set(op.spine.skel, new Set()); users.get(op.spine.skel).add(op.at[0]); }
    for (const op of ov?.ops || []) {
      if (!op.spine || spine[op.spine.skel]) continue;
      const c = skeletonClipData(dir, op.spine, users.get(op.spine.skel));
      list.take(c);
      if (c.entry) spine[op.spine.skel] = c.entry;
    }
  }
  return done({ lock: LOCK_VERSION, id: manifest.id, version: manifest.version, generator: LOCK_GENERATOR, files, spine });
}

/**
 * Pack a folder: write plugin.lock.json when it has no problem, then check the folder (checkPluginFolder).
 * @param {string} dir
 * @param {{ vanilla?: VanillaAssets, where?: string, dataDir?: string }} [opts]
 * @returns {{ wrote: boolean, lock: Record<string, any> | null, build: Findings, check: ReturnType<typeof checkPluginFolder> | null }}
 *   build: what building the lock found; check: the folder's check after the write (null when nothing was written)
 */
export function packPlugin(dir, { vanilla, dataDir = DATA_DIR, where = `plugins/${path.basename(dir)}/` } = {}) {
  const r = buildPluginLock(dir, { vanilla });
  const build = { problems: r.problems, warnings: r.warnings, issues: r.issues };
  if (!r.lock || r.problems.length) return { wrote: false, lock: r.lock, build, check: null };
  // a temporary file renamed over the lock: a link put in its place is replaced, never written through; a reader sees
  // the old lock or the new one
  const tmp = path.join(dir, `.lock-${randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(r.lock, null, 2)}\n`, { flag: 'wx' });
  try { fs.renameSync(tmp, path.join(dir, LOCK_FILE)); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
  return { wrote: true, lock: r.lock, build, check: checkPluginFolder(dir, where, { vanilla, dataDir }) };
}

/**
 * The folder as a zip (see the header): `{ name: '<id>-<version>.zip', body, files }` — every file but dot files and
 * links, under `<id>/`. The version from the manifest ('0.0.0' when it cannot be read).
 * @param {string} dir
 * @returns {{ name: string, body: Buffer, files: string[] }}
 */
export function zipPlugin(dir) {
  const id = path.basename(dir);
  let version = '0.0.0';
  try {
    const m = JSON.parse(fs.readFileSync(abs(dir, PLUGIN_MANIFEST), 'utf8'));
    if (typeof m?.version === 'string' && /^[0-9A-Za-z.+-]{1,64}$/.test(m.version)) version = m.version;
  } catch { /* the folder's own check says why */ }
  // a folder within the walk and plugin limits only (its files are read into memory)
  const all = listPluginFiles(dir);
  const walked = walkProblem(all);
  const listed = all.filter((f) => !f.link);
  const bytes = listed.reduce((n, f) => n + f.bytes, 0);
  const over = walked ? walked.where : listed.length > PLUGIN_LIMITS.files ? `more than ${PLUGIN_LIMITS.files} files` : bytes > PLUGIN_LIMITS.pluginBytes ? `more than ${PLUGIN_LIMITS.pluginBytes / 1048576} MB` : null;
  if (over) throw Object.assign(new Error(`${id}: ${over} — not zipped`), { code: 'PLUGIN_FILE_SIZE', where: over });
  const files = listed.map((f) => f.rel);
  const body = zipFiles(files.map((rel) => ({ name: `${id}/${rel}`, data: fs.readFileSync(abs(dir, rel)) })));
  return { name: `${id}-${version}.zip`, body, files };
}
