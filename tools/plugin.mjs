#!/usr/bin/env node
import { TRAIT_SURFACE } from '../server/plugins/operatorTraits.js';
import { GAMEPLAY_RECORD_SURFACE } from '../server/plugins/gameplayRecords.js';
// tools/plugin.mjs — the plugins of a checkout (DESIGN §32, docs/PLUGINS.md §8 and §15; the registry the server runs is
// server/plugins/registry.js, the format shared/plugins/manifest.js, the checks and the packer server/plugins/pack.js,
// the explanations shared/plugins/errors.js):
//
//   node tools/plugin.mjs list [--json]                  every plugin and language pack the registry finds — plugins/,
//                                                        packs/, the language folders — by class with its status, what
//                                                        was skipped and why, the warnings, and the vanilla content hash
//   node tools/plugin.mjs check [<dir|id> …] [--strict] [--json] [--lang zh|en]
//                                                        check plugin folders (default: every folder of plugins/ but the
//                                                        `_` templates): the manifest (manifest 2, its class, the parts
//                                                        and permissions), the files (types by class, sizes, counts,
//                                                        every path the manifest names, inside the folder), every JSON
//                                                        file (valid, nesting ≤ 64, numbers finite within ±1e9) and a
//                                                        cosmetic plugin's asset overlay (shared/plugins/visual.js: its
//                                                        shape, files, references to this checkout's data/assets.json,
//                                                        permissions, plugin.lock.json for its Spine models). Each finding
//                                                        is its technical line and, under it, the same in plain words with
//                                                        what to do (the error catalogue; --lang en for English, default
//                                                        Chinese); --json prints them as data (code, where, params, plain
//                                                        words) for editors and AI agents. Exit 1 on a problem, with
//                                                        --strict on a warning too
//   node tools/plugin.mjs pack <dir|id> … [--zip] [--out <file|dir>]
//                                                        write plugin.lock.json for a cosmetic plugin: every file's
//                                                        SHA-256 and size, and each Spine model's clip data — the skeleton
//                                                        parsed like tools/fetch-assets.mjs parses the game's (roles,
//                                                        durations, events, hits, bounds), its atlas pages matched against
//                                                        `textures` — then check the folder; --zip also writes the folder
//                                                        as a zip (default plugins/_dist/<id>-<version>.zip; the same
//                                                        files give the same bytes). Run it again after a change to a
//                                                        skeleton: the server refuses a lock made from another one
//   node tools/plugin.mjs new [<template> <id>] [--name <名字>] [--target <官方名字|id>] [--author <名字>] [--license <x>]
//                             [--dir <folder>]           a new plugin folder plugins/<id>/ (or <folder>/<id>/) from a template
//                                                        (all templates in server/studio/templates/): plugin.json
//                                                        and a README; dsl also writes one operator and one prep spec
//                                                        (it passes check and pack as it is);
//                                                        without arguments the templates are listed
//   node tools/plugin.mjs test <id>                     run the installed plugin's author tests (executes local code;
//                                                        Node's spec report on every Node version)
//   node tools/plugin.mjs errors [--markdown] [--lang zh|en] [--write]
//                                                        the error catalogue (every code, its plain words, what to do);
//                                                        --markdown its symptom table, --write puts the tables into
//                                                        docs/PLUGINS.md (English) and docs/PLUGIN-GUIDE.md (Chinese)
//   node tools/plugin.mjs install <zip path | https URL> [--sha256 <hex>] [--force]
//                                                        install into plugins/<id>/. A local zip installs as it is. An
//                                                        https URL must carry --sha256 (the hash of the zip bytes). The
//                                                        hash is checked, the zip is extracted with the same protections
//                                                        as a plugin zip, check must pass, then the folder is renamed
//                                                        into place. The same id is not overwritten unless --force, which
//                                                        moves the old folder to plugins/_replaced/ and does not delete
//                                                        it. Nothing in the package is executed
//   node tools/plugin.mjs catalog <file | https URL> [--json]
//                                                        list a community catalogue and mark each entry installed,
//                                                        updatable or incompatible with this build. The URL must be https.
//                                                        The catalogue document itself is not pinned by a hash
//   node tools/plugin.mjs surface [--write]
//                                                        the frozen plugin API table (docs/PLUGIN-API.md). --write puts
//                                                        it between the markers in that file
//   node tools/plugin.mjs import-forge <dir|zip>         read a Forge workshop pack (pack.json and the files it names)
//          [--out plugins/<id>] [--id <id>]             and write one or more plugin folders (cosmetic, content, script,
//          [--dry-run] [--json] [--no-scripts]          ui, lang). Scripts in the pack are never run; kits/ whose imports
//                                                        map become one sandboxed script plugin (kits-<id>), which
//                                                        --no-scripts leaves out. --dry-run writes nothing. --json prints
//                                                        one stable report. IMPORT-REPORT.md lands in the primary folder.
//                                                        See docs/PLUGINS.md §16.
//   --root <dir>   another checkout or an unpacked release (default: this checkout)
//
// A language pack's strings are checked by node tools/i18n.mjs check <code> (docs/I18N.md); tools/packs.mjs keeps the
// pack commands of 0.2.0 (list, index, check). The studio (/studio/ of a running server, docs/PLUGIN-GUIDE.md) does all of
// this in the browser.

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildContentSet } from '../server/plugins/contentSet.js';
import { createPluginRegistry } from '../server/plugins/registry.js';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanPlugins, pluginIndexOf, readVanillaAssets, crossPluginFindings } from '../server/plugins/registry.js';
import { applyTrust } from '../server/plugins/trusted.js';
import { computeVanillaContent } from '../server/plugins/identity.js';
import { checkPluginFolder, buildPluginLock, packPlugin, zipPlugin } from '../server/plugins/pack.js';
import { DATA_SHIM_JS } from '../server/http/static.js';
import { PLUGIN_CLASSES, PLUGIN_MANIFEST, isPluginId } from '../shared/plugins/manifest.js';
import { LOCK_FILE } from '../shared/plugins/visual.js';
import { PLUGIN_ERRORS, TABLE_MARKERS, describeIssue, errorLang, issueLine, symptomTable } from '../shared/plugins/errors.js';
import { TEMPLATES, templateById, createPlugin, manifestText } from '../server/studio/templates/index.js';
import { readStudioData } from '../server/studio/gameData.js';
import { createTargetIndex, searchTargets, targetSpec } from '../server/studio/targets.js';
import { STUDIO_ROUTES } from '../server/studio/index.js';
import { annotateCatalog, readCatalog } from '../shared/plugins/catalog.js';
import { installFromFile, installFromUrl, installedPluginVersion, isRemoteAddress, loadCatalogText } from '../server/plugins/install.js';
import { buildSurface, surfaceMarkdown, SURFACE_MARKERS } from '../shared/plugins/surface.js';
import { pluginFxSurface } from '../public/js/render/vfx/pluginFormat.js';
import { importForge } from '../server/plugins/forgeImport.js';
import { restartForEnvProxy } from './assets/env-proxy.mjs';

export { checkPluginFolder, buildPluginLock };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/plugin.mjs list [--json] | check [<dir|id> …] [--strict] [--json] [--lang zh|en] | pack <dir|id> … [--zip] [--out <path>] | new [<template> <id>] [--name … --target … --author … --license … --dir … --options <json-file>] | import-forge <dir|zip> [--out plugins/<id>] [--id <id>] [--dry-run] [--json] [--no-scripts] [--offline|--no-network] [--asset-source=direct|mirror] [--refresh-index] | test <id> | errors [--markdown] [--lang zh|en] [--write] | install <zip|https> [--sha256 <hex>] [--force] | catalog <file|https> [--json] | surface [--write]   [--root <dir>]';
/** The documents whose symptom table `errors --write` keeps: path, language. */
export const TABLE_DOCS = Object.freeze([['docs/PLUGINS.md', 'en'], ['docs/PLUGIN-GUIDE.md', 'zh']]);

/** The folders the registry reads in a checkout. @param {string} root */
export const pluginDirs = (root) => ({
  publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'plugins'),
});

/** The vanilla content of a checkout (server/plugins/identity.js). @param {string} root */
export const vanillaOf = (root) => computeVanillaContent({
  simDir: path.join(root, 'server', 'sim'), sharedDir: path.join(root, 'shared'), dataDir: path.join(root, 'data'), shim: DATA_SHIM_JS,
});

const files = (n) => `${n} file${n === 1 ? '' : 's'}`;
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

/**
 * The findings of a check as lines: each technical line, and under it the plain words of its code (the error catalogue).
 * @param {{ problems: string[], warnings: string[], issues?: import('../shared/plugins/errors.js').PluginIssue[] }} r
 * @param {string} lang
 * @returns {string[]}
 */
export function findingLines(r, lang) {
  const out = [];
  const issues = Array.isArray(r.issues) && r.issues.length === r.problems.length + r.warnings.length ? r.issues : null;
  const each = issues || [...r.problems.map((text) => ({ level: 'problem', text })), ...r.warnings.map((text) => ({ level: 'warning', text }))];
  for (const level of ['problem', 'warning']) {
    for (const i of each.filter((x) => x.level === level)) {
      out.push(`  ${level.padEnd(7)}  ${i.text}`);
      if (issues) out.push(`           ↳ ${issueLine(/** @type {any} */ (i), lang)}`);
    }
  }
  return out;
}

/** Rewrite the generated symptom tables of the documents (errors --write). Which documents changed. @param {string} root */
export function writeErrorTables(root) {
  const changed = [];
  for (const [rel, lang] of TABLE_DOCS) {
    const abs = path.join(root, rel);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const a = text.indexOf(TABLE_MARKERS.start);
    const b = text.indexOf(TABLE_MARKERS.end);
    if (a < 0 || b < a) continue;
    const next = `${text.slice(0, a + TABLE_MARKERS.start.length)}\n${symptomTable(/** @type {'zh' | 'en'} */ (lang))}\n${text.slice(b)}`;
    if (next !== text) { fs.writeFileSync(abs, next); changed.push(rel); }
  }
  return changed;
}

/** A flag's value (`--name x`) out of the arguments. */
function takeValue(rest, i, name) {
  const v = rest[i + 1];
  if (v === undefined || v.startsWith('--')) throw Object.assign(new Error(`--${name} needs a value`), { usage: true });
  return v;
}

/**
 * The CLI.
 * @param {string[]} argv
 * @param {{fetchImpl?:typeof fetch}} [io]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, io = {}) {
  const [cmd, ...rest] = argv;
  let root = REPO;
  const flags = new Set();
  /** @type {Record<string, string>} */
  const values = {};
  const targets = [];
  try {
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a.startsWith('--asset-source=')) values['asset-source'] = a.slice('--asset-source='.length);
      else if (['--asset-source', '--root', '--lang', '--out', '--name', '--target', '--author', '--license', '--credits', '--dir', '--options', '--sha256', '--id'].includes(a)) {
        values[a.slice(2)] = takeValue(rest, i, a.slice(2));
        i++;
      } else if (a.startsWith('--')) flags.add(a.slice(2));
      else targets.push(a);
    }
  } catch (e) {
    console.error(`plugin: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (values.root) root = path.resolve(values.root);
  const lang = errorLang(values.lang || process.env.SP_LANG || 'zh');
  const dirs = pluginDirs(root);

  if (cmd === 'test') {
    if (targets.length !== 1 || !isPluginId(targets[0])) { console.error('plugin test needs one installed plugin id'); return 2; }
    const id = targets[0];
    const registry = createPluginRegistry(dirs);
    // Explicit author test is authorization to execute locally; production owner gates still apply to servers.
    const lookup = registry.plugin;
    const testing = {...registry, plugin: key => { const p = lookup(key); return p ? {...p,status:'loaded',
      ...(p.script ? {script:{...p.script,execution:'trusted'}} : {})} : null; }};
    const set = buildContentSet({registry:testing,ids:[id]});
    if (!set.cs) { console.error(JSON.stringify(set.problems)); return 1; }
    const testDir = path.join(dirs.pluginsDir,id,'test');
    const tests = fs.existsSync(testDir) ? fs.readdirSync(testDir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(testDir,f)) : [];
    if (!tests.length) { console.error('no test/*.test.js files'); return 1; }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'sp-plugin-test-'));
    try {
      const file = path.join(tmp,'set.json'); fs.writeFileSync(file,JSON.stringify(set));
      const env = {...process.env,SP_PLUGIN_TEST_SET:file}; delete env.NODE_TEST_CONTEXT;
      // --import takes a module specifier: a file URL, never a path (on Windows `C:\…` reads as the URL scheme `c:`)
      const setup = pathToFileURL(path.join(REPO,'server/plugins/scriptTestSetup.js')).href;
      // One report everywhere: Node's default is spec in a terminal but TAP when the output is not one on Node 22
      // (an IDE console, a redirect, CI) and spec there too from Node 23
      const r = spawnSync(process.execPath,['--import',setup,'--test-reporter=spec','--test',...tests],{
        stdio:'inherit',env,timeout:120000,
      });
      return r.status ?? 1;
    } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
  }

  if (cmd === 'list') {
    if (targets.length) { console.error(`plugin: list takes no folder\n${USAGE}`); return 2; }
    const scan = scanPlugins(dirs);
    // The same gate the server uses (registry create → applyTrust). Sandbox with a valid lock is loaded; trusted
    // with no pin stays disabled.
    applyTrust(scan.plugins, { pluginsDir: dirs.pluginsDir, mode: process.env.SP_PLUGIN_SCRIPTS });
    const content = vanillaOf(root);
    if (flags.has('json')) {
      console.log(JSON.stringify({ index: pluginIndexOf(scan.plugins, { vanilla: content.cs }), skipped: scan.skipped, warnings: scan.warnings }, null, 2));
      return 0;
    }
    console.log(`vanilla content: ${content.cs} (${Object.keys(content.simFiles).length} code files, ${Object.keys(content.data).length} data files)`);
    for (const [cls, kind] of Object.entries(PLUGIN_CLASSES)) {
      const list = scan.plugins.filter((p) => p.class === cls);
      console.log(`${cls} (${kind.status}: ${kind.summary}): ${list.length ? '' : 'none'}`);
      for (const p of list) {
        const m = p.manifest;
        const langInfo = cls === 'lang' ? ` ${m.lang}${m.fallback?.length ? ` → ${m.fallback.join(' → ')}` : ''}` : '';
        const extra = [m.version && `v${m.version}`, m.app && `app ${m.app}${m.compatible ? '' : ' (not this version)'}`, p.status !== 'loaded' && p.status,
          kind.unofficial && 'unofficial', p.strings !== undefined && `${p.strings} strings`, p.files.data && 'game texts',
          Number.isFinite(p.count) && `${files(p.count)}, ${kb(p.bytes)}`].filter(Boolean).join(', ');
        console.log(`  ${p.id.padEnd(16)} ${m.name}${m.englishName !== m.name ? ` (${m.englishName})` : ''}${langInfo}  — ${p.where}${extra ? `; ${extra}` : ''}`);
      }
    }
    for (const k of scan.skipped) console.log(`skipped  ${k.where}: ${k.problems.join('; ')}`);
    for (const w of scan.warnings) console.log(`warning  ${w.where}: ${w.warning}`);
    return 0;
  }

  if (cmd === 'pack') {
    if (!targets.length) { console.error(`plugin: pack needs a plugin folder\n${USAGE}`); return 2; }
    let failed = 0;
    const vanilla = readVanillaAssets(dirs.dataDir);
    for (const t of targets) {
      const asDir = path.resolve(t);
      const inPlugins = path.join(dirs.pluginsDir, t);
      const dir = fs.existsSync(path.join(asDir, PLUGIN_MANIFEST)) ? asDir : fs.existsSync(path.join(inPlugins, PLUGIN_MANIFEST)) ? inPlugins : null;
      if (!dir) { console.error(`plugin: ${t} is not a plugin folder (no ${PLUGIN_MANIFEST})`); return 2; }
      const r = packPlugin(dir, { vanilla, dataDir: dirs.dataDir, where: `${t}/` });
      for (const line of findingLines(r.build, lang)) console.log(line);
      if (!r.wrote) { console.log(`${t}: ${LOCK_FILE} not written`); failed++; continue; }
      const nFiles = Object.keys(/** @type {any} */ (r.lock).files).length;
      const nModels = Object.keys(/** @type {any} */ (r.lock).spine).length;
      console.log(`${t}: wrote ${LOCK_FILE} (${files(nFiles)}, ${nModels} Spine model${nModels === 1 ? '' : 's'})`);
      const c = /** @type {NonNullable<typeof r.check>} */ (r.check);
      for (const line of findingLines(c, lang)) console.log(line);
      if (c.problems.length) { failed++; continue; }
      console.log('  check: ok');
      if (flags.has('zip')) {
        const z = zipPlugin(dir);
        let out = values.out ? path.resolve(values.out) : path.join(dirs.pluginsDir, '_dist', z.name);
        if (values.out && (values.out.endsWith('/') || (fs.existsSync(out) && fs.statSync(out).isDirectory()))) out = path.join(out, z.name);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, z.body);
        console.log(`  zip: ${path.relative(process.cwd(), out) || out} (${files(z.files.length)}, ${kb(z.body.length)})`);
      }
    }
    return failed ? 1 : 0;
  }

  if (cmd === 'check') {
    /** @type {{ dir: string, where: string }[]} */
    const folders = [];
    if (!targets.length) {
      let names = [];
      try { names = fs.readdirSync(dirs.pluginsDir).sort(); } catch { /* no plugins/ */ }
      for (const n of names) {
        if (n.startsWith('_') || n.startsWith('.')) continue;
        const dir = path.join(dirs.pluginsDir, n);
        try { if (fs.statSync(dir).isDirectory()) folders.push({ dir, where: `plugins/${n}/` }); } catch { /* gone */ }
      }
    }
    for (const t of targets) {
      const asDir = path.resolve(t);
      const inPlugins = path.join(dirs.pluginsDir, t);
      const dir = fs.existsSync(asDir) && fs.statSync(asDir).isDirectory() ? asDir : fs.existsSync(inPlugins) && fs.statSync(inPlugins).isDirectory() ? inPlugins : null;
      if (!dir) { console.error(`plugin: ${t} is neither a folder nor a plugin in ${path.relative(process.cwd(), dirs.pluginsDir) || dirs.pluginsDir}`); return 2; }
      const rel = path.relative(root, dir).split(path.sep).join('/');
      folders.push({ dir, where: `${rel && !rel.startsWith('..') ? rel : dir}/` });
    }
    const json = flags.has('json');
    if (!folders.length) { console.log(json ? JSON.stringify({ folders: [], problems: 0, warnings: 0 }) : 'no plugin folders to check (plugins/ holds none)'); return 0; }
    let problems = 0;
    let warnings = 0;
    const vanilla = readVanillaAssets(dirs.dataDir);
    const report = [];
    const checks = [];
    /** @type {import('../server/plugins/registry.js').Plugin[]} */
    const loaded = [];
    for (const { dir, where } of folders) {
      const r = checkPluginFolder(dir, where, { vanilla, dataDir: dirs.dataDir });
      const p = r.plugin;
      if (p) loaded.push(p);
      problems += r.problems.length;
      warnings += r.warnings.length;
      checks.push({ dir, where, r });
    }
    // Same owner gate as list and the server; inspect status without executing plugin code.
    applyTrust(loaded, { pluginsDir: dirs.pluginsDir, mode: process.env.SP_PLUGIN_SCRIPTS });
    // The same rules the registry applies across folders. Named targets arrive in argument order; the registry
    // walks plugins/ with readDirSorted (folder name, default UTF-16). Sort that way before the cross-plugin rules.
    // A folder this run keeps is not also recorded as the loser of another order. A folder checked alone can still
    // lose to a pack or the built-in language file, which this plugins-only pass cannot see.
    const folderName = (where) => {
      const s = String(where || '').replace(/\/+$/, '');
      const cut = s.lastIndexOf('/');
      return cut >= 0 ? s.slice(cut + 1) : s;
    };
    const byName = new Map();
    for (const p of loaded) {
      const name = folderName(p.where);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(p);
    }
    loaded.length = 0;
    for (const name of [...byName.keys()].sort()) loaded.push(...byName.get(name));
    const ordered = new Set(loaded.map((p) => p.where));
    const winnerWhere = (issue) => {
      const raw = issue && issue.params && issue.params.where;
      if (typeof raw !== 'string') return '';
      const m = raw.match(/\(([^()]*)\)\s*$/);
      return m ? m[1] : '';
    };
    const cross = crossPluginFindings(loaded);
    const interested = new Set(folders.map((f) => f.where));
    const seenDup = new Set(cross.skipped.map((s) => s.where));
    if (folders.length > 1 || !targets.length) {
      const scan = scanPlugins(dirs);
      for (const s of scan.skipped) {
        if (!interested.has(s.where) || seenDup.has(s.where)) continue;
        if (!s.issues?.some((i) => i.code === 'PLUGIN_DUPLICATE')) continue;
        if (s.issues.some((i) => i.code === 'PLUGIN_DUPLICATE' && ordered.has(winnerWhere(i)))) continue;
        cross.skipped.push(s);
        seenDup.add(s.where);
      }
    }
    const crossIssues = [
      ...cross.skipped.flatMap((s) => s.issues.map((i) => ({ ...i, where: s.where }))),
      ...cross.warnings.map((w) => ({ ...w.issue, text: w.warning, where: w.where })),
    ];
    problems += cross.skipped.reduce((n, s) => n + s.problems.length, 0);
    warnings += cross.warnings.length;
    // Resolve cross-folder winners before showing each folder's status (DESIGN §34.21).
    const skippedByWhere = new Map(cross.skipped.map(s => [s.where, s]));
    for (const { dir, where, r } of checks) {
      const p = r.plugin, skipped = skippedByWhere.get(where);
      const status = skipped ? 'skipped' : p?.status ?? null;
      if (json) {
        report.push({ where, id: path.basename(dir), loadable: !!p && !skipped, class: p?.class ?? null, status, version: p?.manifest.version ?? null,
          ...(skipped ? { skipped: skipped.problems } : {}), issues: r.issues.map(i => ({ ...i, ...describeIssue(i, lang) })) });
        continue;
      }
      const head = p ? `${p.id} ${p.manifest.version} · ${p.class} (${status}) · ${files(p.count)}, ${kb(p.bytes)}` : 'not loadable';
      console.log(`${where}  ${head}${skipped ? ` · ${skipped.problems.join('; ')}` : ''}`);
      for (const line of findingLines(r, lang)) console.log(line);
      if (!skipped && !r.problems.length && !r.warnings.length) console.log('  ok');
    }
    if (!json && crossIssues.length) {
      console.log('cross-plugin');
      for (const s of cross.skipped) {
        console.log(`${s.where}`);
        for (const line of findingLines({ problems: s.problems, warnings: [], issues: s.issues }, lang)) console.log(line);
      }
      for (const w of cross.warnings) {
        console.log(`${w.where}`);
        for (const line of findingLines({ problems: [], warnings: [w.warning], issues: [w.issue] }, lang)) console.log(line);
      }
    }
    if (json) {
      if (crossIssues.length) report.push({ where: '(cross-plugin)', id: null, loadable: false, class: null, status: null, version: null, issues: crossIssues.map((i) => ({ ...i, ...describeIssue(i, lang) })) });
      console.log(JSON.stringify({ folders: report, problems, warnings }, null, 2));
    }
    else console.log(`${folders.length} folder(s): ${problems} problem(s), ${warnings} warning(s)`);
    return problems || (flags.has('strict') && warnings) ? 1 : 0;
  }

  if (cmd === 'new') {
    if (!targets.length) {
      console.log('templates (node tools/plugin.mjs new <template> <id> [--name …] [--target <官方名字|id>]):');
      for (const t of TEMPLATES) console.log(`  ${t.id.padEnd(7)} ${t.class} · targets: ${t.kinds.join(', ')}`);
      return 0;
    }
    const [tid, id] = targets;
    const tpl = templateById(tid);
    if (!tpl) { console.error(`plugin: no template "${tid}" (${TEMPLATES.map((t) => t.id).join(', ')})`); return 2; }
    if (!isPluginId(id)) { console.error(`plugin: "${id ?? ''}" is not a plugin id (2–32 lower-case letters, digits and -, e.g. texas-red)`); return 2; }
    const dir = path.join(values.dir ? path.resolve(values.dir) : dirs.pluginsDir, id);
    if (fs.existsSync(dir)) { console.error(`plugin: ${path.relative(process.cwd(), dir) || dir} exists already`); return 2; }
    let target = null;
    if (values.target) {
      const found = searchTargets(createTargetIndex(dirs.dataDir)().targets, values.target, { kinds: tpl.kinds, limit: 5 });
      if (!found.length) { console.error(`plugin: nothing named "${values.target}" for the template ${tpl.id} (${tpl.kinds.join(', ')})`); return 2; }
      target = found[0];
      if (found.length > 1 && found[1].name === target.name) console.log(`  (several match "${values.target}": took ${targetSpec(target)})`);
    }
    const made = createPlugin(tpl, { id, name: values.name, target, authors: values.author ? [values.author] : [], license: values.license, credits: values.credits, lang, data: tpl.build ? readStudioData(dirs.dataDir) : null, options: values.options ? JSON.parse(fs.readFileSync(values.options, 'utf8')) : {} });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, PLUGIN_MANIFEST), manifestText(made.manifest));
    for (const [rel, text] of Object.entries(made.files)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); }
    if (made.authoring) fs.writeFileSync(path.join(dir, '.studio.json'), manifestText({ v: 1, authoring: made.authoring }));
    if (target && !made.authoring) fs.writeFileSync(path.join(dir, '.studio.json'), `${JSON.stringify({ v: 1, sections: [{ template: tpl.id, target: targetSpec(target) }] }, null, 2)}\n`);
    const shown = path.relative(process.cwd(), dir) || dir;
    console.log(`${shown}: a ${tpl.class} plugin from the template ${tpl.id}${target ? ` for ${target.name} (${target.key})` : ''}`);
    console.log(lang === 'zh'
      ? `下一步：在工作台（服务器的 /studio/）里把文件拖到格子上，或者按 ${shown}/README.md 手动放文件；然后 node tools/plugin.mjs check ${id}`
      : `next: drop files on its places in the studio (/studio/ of the server), or follow ${shown}/README.md; then node tools/plugin.mjs check ${id}`);
    return 0;
  }

  const STATUS_WORD = {
    zh: { installed: '已安装', updatable: '可更新', incompatible: '不适配', available: '可安装' },
    en: { installed: 'installed', updatable: 'updatable', incompatible: 'incompatible', available: 'available' },
  };

  if (cmd === 'install') {
    if (targets.length !== 1) { console.error(`plugin: install needs one zip path or one https URL\n${USAGE}`); return 2; }
    const target = targets[0];
    try {
      const opts = { pluginsDir: dirs.pluginsDir, force: flags.has('force'), sha256: values.sha256 || '' };
      const r = isRemoteAddress(target) ? await installFromUrl(target, opts) : installFromFile(path.resolve(target), opts);
      const moved = r.replaced ? path.relative(dirs.pluginsDir, r.replaced).split(path.sep).join('/') : '';
      console.log(lang === 'zh'
        ? `已安装 plugins/${r.id}/${moved ? `（旧文件夹挪到 ${moved}，没有删除）` : ''}`
        : `installed plugins/${r.id}/${moved ? ` (old folder moved to ${moved}, not deleted)` : ''}`);
      return 0;
    } catch (e) {
      console.error(`plugin: ${e.code || 'PLUGIN_INSTALL_ZIP'} ${e.message}`);
      return 1;
    }
  }

  if (cmd === 'catalog') {
    if (targets.length !== 1) { console.error(`plugin: catalog needs one catalogue file or one https URL\n${USAGE}`); return 2; }
    try {
      const text = await loadCatalogText(targets[0], { pluginsDir: dirs.pluginsDir });
      let json;
      try { json = JSON.parse(text); } catch (e) { console.error(`plugin: PLUGIN_CATALOG_SHAPE ${e.message}`); return 1; }
      const read = readCatalog(json);
      if (!read.ok || !read.catalog) {
        const p = read.problems[0] || read.warnings[0];
        console.error(`plugin: ${p.code} ${p.detail}`);
        return 1;
      }
      const rows = annotateCatalog(read.catalog, (id) => installedPluginVersion(dirs.pluginsDir, id));
      if (flags.has('json')) { console.log(JSON.stringify({ name: read.catalog.name, catalog: read.catalog.catalog, plugins: rows }, null, 2)); return 0; }
      console.log(`${read.catalog.name} (${rows.length})`);
      const words = STATUS_WORD[lang] || STATUS_WORD.zh;
      for (const e of rows) {
        const have = e.installedVersion ? ` (${e.installedVersion})` : '';
        console.log(`  ${String(e.id).padEnd(16)} ${String(e.version).padEnd(10)} ${String(e.class).padEnd(10)} ${words[e.status] || e.status}${have}  ${e.name}`);
      }
      return 0;
    } catch (e) {
      console.error(`plugin: ${e.code || 'PLUGIN_CATALOG_SHAPE'} ${e.message}`);
      return 1;
    }
  }

  if (cmd === 'surface') {
    const vocab = await import('../server/sim/content/dsl/vocab.js');
    const rows = [...buildSurface({ dsl: vocab, studioRoutes: STUDIO_ROUTES }), ...GAMEPLAY_RECORD_SURFACE, ...pluginFxSurface(), ...TRAIT_SURFACE];
    const table = surfaceMarkdown(rows);
    if (!flags.has('write')) { console.log(table); return 0; }
    const abs = path.join(root, 'docs/PLUGIN-API.md');
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { console.error('plugin: docs/PLUGIN-API.md is missing'); return 2; }
    const a = text.indexOf(SURFACE_MARKERS.start);
    const b = text.indexOf(SURFACE_MARKERS.end);
    if (a < 0 || b < a) { console.error('plugin: docs/PLUGIN-API.md has no surface markers'); return 2; }
    const next = `${text.slice(0, a + SURFACE_MARKERS.start.length)}\n${table}\n${text.slice(b)}`;
    if (next !== text) fs.writeFileSync(abs, next);
    console.log(next === text ? 'the API table is up to date' : 'wrote docs/PLUGIN-API.md');
    return 0;
  }

  if (cmd === 'import-forge') {
    if (targets.length !== 1) { console.error(`plugin: import-forge needs one Forge pack (a folder or a zip)\n${USAGE}`); return 2; }
    const result = await importForge(path.resolve(targets[0]), {
      out: values.out ? path.resolve(values.out) : undefined,
      id: values.id, dryRun: flags.has('dry-run'), root, pluginsDir: dirs.pluginsDir, dataDir: dirs.dataDir,
      vanilla: readVanillaAssets(dirs.dataDir), scripts: !flags.has('no-scripts'),
      officialTables: { offline: flags.has('offline') || flags.has('no-network'), refresh: flags.has('refresh-index'),
        source: values['asset-source'] || process.env.SP_ASSET_SOURCE || 'direct', fetchImpl: io.fetchImpl, log: line => console.error(line) },
    });
    if (flags.has('json')) console.log(JSON.stringify(result.report));
    else console.log(result.markdown);
    return result.ok ? 0 : 1;
  }

  if (cmd === 'errors') {
    if (flags.has('write')) {
      const changed = writeErrorTables(root);
      console.log(changed.length ? `wrote the symptom table of ${changed.join(', ')}` : 'the symptom tables are up to date');
      return 0;
    }
    if (flags.has('markdown')) { console.log(symptomTable(lang)); return 0; }
    for (const [code, e] of Object.entries(PLUGIN_ERRORS)) console.log(`${code.padEnd(26)} ${e.level.padEnd(8)} ${e[lang]}${e.autofix ? `  [${e.autofix}]` : ''}`);
    return 0;
  }

  console.log(USAGE);
  return cmd ? 2 : 0;
}

const invoked = (() => { try { return pathToFileURL(fs.realpathSync(process.argv[1] || '')).href; } catch { return null; } })();
if (invoked === import.meta.url) {
  const argv = process.argv.slice(2);
  const restart = argv[0] === 'import-forge' && !argv.includes('--offline') && !argv.includes('--no-network') && restartForEnvProxy();
  if (!restart) main(argv).then((code) => { process.exitCode = code; }, (e) => { console.error(`plugin: ${e.message}`); process.exitCode = 2; });
}
