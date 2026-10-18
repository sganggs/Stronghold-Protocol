// C1 immutable content compositions (DESIGN §32.5). HTTP and room ownership are handled by contentSets.js and roomSets.js.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR, deepFreeze } from '../data.js';
import { DATA_SHIM_JS } from '../http/static.js';
import { computeVanillaContent, gameplayDataFiles, nodeSha256 } from './identity.js';
import { contentHashOf, canonicalJson, csUrlPart } from '../../shared/plugins/identity.js';
import { manifestTextWithoutNotices } from '../../shared/plugins/notices.js';
import { resolvePluginOrder } from '../../shared/plugins/order.js';
import { applyPatches, normalizeSettings } from '../../shared/plugins/patch.js';
import { expandGameplayRecords, reconcilePluginBonds, reconcilePluginTokens, validateGameplayData } from './gameplayRecords.js';
import { expandTraitRecords, operatorTraitPatchProblems } from './operatorTraits.js';
import { expandFxRecords } from './fxRecords.js';
import { object, own, clone, problem, RECORD_MAPS, recordId, namespaceCollisions } from '../../shared/plugins/dataUtils.js';
import { buildRecordOverlay, walkOverlay, getPath, applyRecordOverlay } from '../../shared/i18nData.js';
import { computeGroundPaths, computeDeployTiles } from '../sim/groundPaths.js';
import { officialKit } from '../sim/content/index.js';
import { KITTED_CHARS } from '../sim/content/kits/index.js';
import { exportOfficialBounds, rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { browserScriptSources } from '../../shared/plugins/scriptLoad.js';
import { preflightScripts } from './scriptPreflight.js';
import { bossCentreWarnings } from './stageWarnings.js';
import { validateDsl, validatePrepSpec } from '../sim/content/dsl/validate.js';
import { composeRules } from '../../shared/plugins/rules.js';
import { offerReferenceProblems } from './offerData.js';

const bases = new WeakMap(), buffers = new WeakMap(), caches = new WeakMap();
function baseFor(registry) {
  if (bases.has(registry)) return bases.get(registry);
  const dirs = registry.contentDirs ?? {};
  const dataDir = dirs.dataDir ?? DATA_DIR;
  const identity = computeVanillaContent({ dataDir, simDir: dirs.simDir ?? path.join(ROOT, 'server/sim'), sharedDir: dirs.sharedDir ?? path.join(ROOT, 'shared'), shim: DATA_SHIM_JS });
  const data = {}, files = new Map();
  for (const f of gameplayDataFiles(dataDir)) {
    const body = fs.readFileSync(f.abs);
    data[f.name] = JSON.parse(body.toString('utf8'));
    files.set(`data/${f.file}`, body);
  }
  const i18n = {};
  const langDir = path.join(dataDir, 'i18n');
  if (fs.existsSync(langDir)) for (const file of fs.readdirSync(langDir).sort()) if (/^[A-Za-z0-9-]+\.json$/.test(file)) {
    const body = fs.readFileSync(path.join(langDir, file));
    i18n[file.slice(0, -5)] = JSON.parse(body.toString('utf8'));
    files.set(`i18n/${file}`, body);
  }
  const base = { identity, data: deepFreeze(data), files, i18n };
  bases.set(registry, base);
  return base;
}
const maps = data => ({ ...Object.fromEntries(Object.keys(RECORD_MAPS).map(k => [k, data[k]])),
  bonds: data.bonds, modes: data.config?.modes, units: data.backups?.units, operators: data.backups?.diy?.operators });
const prefixes = { ...Object.fromEntries(Object.entries(RECORD_MAPS).map(([k, v]) => [k, v[0]])), bonds: 'bond_x', modes: 'mode_x', units: 'char_x', operators: 'char_x' };
/** All map replacements are checked too, so a root merge cannot bypass addition/dependency/deletion rules. */
function writesAllowed(before, after, plugin, owners) {
  const problems = [], prev = maps(before), next = maps(after), id = plugin.id;
  for (const [file, map] of Object.entries(prev)) {
    for (const key of Object.keys(map ?? {})) {
      if (!own(next[file], key) || !object(next[file][key])) problems.push(problem('PLUGIN_RECORD_DELETE', `${file}.${key}`, 'records cannot be deleted'));
      else if (owners.get(`${file}.${key}`) && owners.get(`${file}.${key}`) !== id && canonicalJson(map[key]) !== canonicalJson(next[file][key])
        && !own(plugin.manifest.requires, owners.get(`${file}.${key}`))) problems.push(problem('PLUGIN_DEPENDENCY', `${file}.${key}`, 'requires must declare the plugin whose record is changed'));
    }
    for (const key of Object.keys(next[file] ?? {})) if (!own(map, key)) {
      if (!prefixes[file] || !recordId(key, id, prefixes[file])) problems.push(problem('PLUGIN_RECORD_ID', `${file}.${key}`, 'new record is outside this plugin namespace'));
      else owners.set(`${file}.${key}`, id);
    }
  }
  return problems;
}

function translations(data, initial, plugins) {
  const out = clone(initial), problems = [];
  for (const p of plugins) for (const [lang, rel] of Object.entries(p.manifest.parts.i18n?.langs ?? {})) {
    const doc = p.content.documents[rel];
    if (doc?.version !== 1 || doc.lang !== lang || !object(doc.files)) { problems.push(problem('PLUGIN_I18N', rel, 'version:1, matching lang and files required')); continue; }
    const dest = out[lang] ??= { version: 1, lang, names: {}, files: {} };
    for (const [file, records] of Object.entries(doc.files)) for (const [id, overlay] of Object.entries(records ?? {})) {
      const base = data[file]?.[id], leaves = new Map();
      if (base === undefined) { problems.push(problem('PLUGIN_I18N', `${file}.${id}`, 'translation target does not exist')); continue; }
      const old = dest.files?.[file]?.[id];
      // Keep only still-valid official leaves, then apply the plugin's translations and rebuild all source hashes.
      if (old) {
        const applied = applyRecordOverlay(base, old).value;
        const oldOv = typeof base === 'string' ? old._s : old;
        walkOverlay(oldOv, (path, en) => { const zh = getPath(base, path); if (typeof zh === 'string' && getPath(applied, path) === en) leaves.set(JSON.stringify(path), { path, zh, en }); });
      }
      walkOverlay(typeof base === 'string' ? overlay?._s ?? overlay : overlay, (path, en) => {
        const zh = getPath(base, path);
        if (typeof zh !== 'string') problems.push(problem('PLUGIN_I18N', `${file}.${id}.${path.join('.')}`, 'overlay may replace existing text only'));
        else { leaves.set(JSON.stringify(path), { path, zh, en }); if (path.at(-1) === 'name') dest.names[zh] = en; }
      });
      dest.files[file] ??= {};
      dest.files[file][id] = buildRecordOverlay([...leaves.values()]);
    }
  }
  for (const g of Object.values(data.garrisons ?? {})) for (const [lang, text] of Object.entries(g.operatorTrait?.translations ?? {})) {
    const dest = out[lang] ??= { version: 1, lang, names: {}, files: {} };
    dest.files.garrisons ??= {};
    dest.files.garrisons[g.garrisonId] = buildRecordOverlay(['desc', 'descRaw'].map(key => ({ path: [key], zh: g[key], en: text })));
  }
  return { out, problems };
}

/** Explicit DSL values on chess records, backup units, and backup forms. The owner key is the record, not the form. */
function dslSites(data) {
  const out = new Map();
  const put = (path, owner, value) => { if (value !== undefined) out.set(path, { owner, json: canonicalJson(value) }); };
  for (const [id, rec] of Object.entries(data?.chess ?? {})) {
    if (rec && rec.dsl != null) put(`chess.${id}.dsl`, `chess.${id}`, rec.dsl);
  }
  for (const [id, rec] of Object.entries(data?.backups?.units ?? {})) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec.dsl != null) put(`units.${id}.dsl`, `units.${id}`, rec.dsl);
    if (rec.forms && typeof rec.forms === 'object') {
      for (const [status, form] of Object.entries(rec.forms)) {
        if (form && form.dsl != null) put(`units.${id}.forms.${status}.dsl`, `units.${id}`, form.dsl);
      }
    }
  }
  return out;
}

/**
 * A changed DSL value needs the dsl permission and must be written by the record's owner.
 * Another plugin cannot rewrite it, even with requires. An official record has no owner.
 */
function dslWriterProblems(before, after, plugin, owners) {
  const problems = [];
  const prev = dslSites(before), next = dslSites(after);
  const has = plugin.manifest.permissions.includes('dsl');
  for (const path of new Set([...prev.keys(), ...next.keys()])) {
    const a = prev.get(path), b = next.get(path);
    if (a && b && a.json === b.json) continue;
    const ownerKey = (b ?? a).owner;
    if (!has) problems.push({ ...problem('PLUGIN_CONTENT_PERMISSION', path, 'DSL requires the dsl permission'), plugin: plugin.id });
    if (owners.get(ownerKey) !== plugin.id) problems.push({ ...problem('PLUGIN_DSL_PLUGIN_ID', path, 'only the record owner may write its DSL'), plugin: plugin.id });
  }
  return problems;
}

/** potDown leaves whose path writes dsl or pluginId. Unchanged official leaves are not reported. */
function potDownSites(data) {
  const out = new Map();
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${path}[${i}]`);
      return;
    }
    if (object(node.potDown)) {
      for (const [rank, step] of Object.entries(node.potDown)) {
        if (!object(step)) continue;
        for (const [leaf, value] of Object.entries(step)) {
          if (String(leaf).split('.').some((seg) => seg === 'dsl' || seg === 'pluginId')) out.set(`${path}.potDown.${rank}.${leaf}`, canonicalJson(value));
        }
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'potDown' || !v || typeof v !== 'object') continue;
      walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(data, '');
  return out;
}

function potDownProblems(before, after, plugin) {
  const problems = [];
  const prev = potDownSites(before), next = potDownSites(after);
  const bad = (path) => problems.push({ ...problem('PLUGIN_DSL_PLUGIN_ID', path, 'potDown cannot write dsl or pluginId'), plugin: plugin.id });
  for (const [path, json] of next) if (prev.get(path) !== json) bad(path);
  for (const path of prev.keys()) if (!next.has(path)) bad(path);
  return problems;
}

/** Prep specs from the manifest dsl part. A bad spec, a foreign key, or an empty meta.on refuses the whole set. */
function prepSpecs(plugin) {
  const problems = [], specs = [];
  for (const rel of plugin.manifest.parts.dsl?.files ?? []) {
    if (!plugin.manifest.permissions.includes('dsl')) {
      problems.push(problem('PLUGIN_CONTENT_PERMISSION', rel, 'dsl files require the dsl permission'));
      continue;
    }
    const doc = plugin.content.documents[rel];
    const checked = validatePrepSpec(doc, plugin.id);
    if (!checked.ok) {
      for (const p of checked.problems) problems.push(problem(p.code, p.path ? `${rel}.${p.path}` : rel, p.zh));
      continue;
    }
    specs.push(doc);
  }
  return { problems, specs };
}

function routesChanged(before, after) {
  if (!before || !after) return true;
  return canonicalJson(before.routes ?? []) !== canonicalJson(after.routes ?? [])
    || canonicalJson(before.extraRoutes ?? []) !== canonicalJson(after.extraRoutes ?? []);
}

/** Wave ids a mode can field: each round's template, plus any bossTemplates. */
function wavesUsedByMode(mode) {
  const ids = [];
  for (const rd of Object.values(mode?.rounds ?? {})) {
    if (typeof rd?.template === 'string') ids.push(rd.template);
    for (const id of Object.values(rd?.bossTemplates ?? {})) if (typeof id === 'string') ids.push(id);
  }
  return ids;
}

/** C1. ids accepts ids or {id, settings}; failures return only {problems}, never a usable cs/data. */
function composeContentSet({ registry, ids = [], checkDataOnly = false }) {
  if (!registry || !Array.isArray(ids)) return { problems: [problem('PLUGIN_CONTENT_FORMAT', 'ids', 'registry and plugin ids required')] };
  let base;
  try { base = baseFor(registry); } catch (e) { return { problems: [problem('PLUGIN_CONTENT_FILE', 'data', e.message)] }; }
  const selected = ids.map(v => typeof v === 'string' ? { id: v } : v);
  const usable = id => {
    const p = registry.plugin(id);
    // Data-only checks may read a script dependency's JSON without granting it execution permission.
    const readable = p?.status === 'loaded' || checkDataOnly && p?.status === 'disabled' && p.script && p.content;
    return readable && p.manifest.scope.includes('room')
      && (['content','script','trusted'].includes(p.class) && p.manifest.compatible !== false && p.content || p.class === 'cosmetic' && p.visual) ? p : null;
  };
  const resolved = resolvePluginOrder(selected.map(v => v?.id), id => usable(id)?.manifest ?? null);
  if ('error' in resolved) return { problems: [problem(resolved.error, 'ids', resolved.detail)] };
  const collisions = namespaceCollisions(resolved.order);
  if (collisions.length) return { problems: collisions };
  const plugins = resolved.order.map(usable).filter(p => ['content','script','trusted'].includes(p.class)), settings = {}, owners = new Map();
  let data = base.data;
  // Install the vanilla snapshot before expand/validate so a DSL literal uses the real cap, not the floor.
  rememberOfficialBounds(base.data);
  const problems = [], warnings = [], writes = new Map(), prepById = new Map();
  for (const p of plugins) {
    settings[p.id] = normalizeSettings(p.manifest.settings, selected.find(v => v.id === p.id)?.settings);
    const before = data;
    for (const part of ['data', 'operators', 'enemies', 'stages', 'modes']) for (const rel of p.manifest.parts[part]?.files ?? []) {
      const doc = p.content.documents[rel];
      let r;
      if (part === 'data' && doc.patch === 1) {
        // data.dsl is attached only after every ordinary patch. A patch must not write that reserved table.
        if (Array.isArray(doc.ops) && doc.ops.some((op) => op && op.file === 'dsl')) {
          problems.push({ ...problem('PLUGIN_DSL_PLUGIN_ID', rel, 'data patches cannot write the reserved dsl table'), plugin: p.id });
          continue;
        }
        if (doc.ops.some(op => !p.manifest.permissions.includes(op.op === 'add' ? 'data.add' : 'data.patch'))) { problems.push(problem('PLUGIN_CONTENT_PERMISSION', rel, 'patch operation lacks permission')); continue; }
        for (const op of doc.ops) {
          const at = [op.file, op.id, ...(op.path ?? [])].filter(x => x !== undefined).join('.');
          if (writes.has(at) && writes.get(at) !== p.id) warnings.push({ code: 'PLUGIN_PATCH_OVERRIDE', path: at, plugins: [writes.get(at), p.id] });
          writes.set(at, p.id);
        }
        r = applyPatches(data, doc.ops, { pluginId: p.id, settings: settings[p.id] });
        r.problems.push(...operatorTraitPatchProblems(data, r.data));
      } else {
        if (!p.manifest.permissions.includes('data.add')) { problems.push(problem('PLUGIN_CONTENT_PERMISSION', rel, 'records require data.add')); continue; }
        const entries = part === 'data' ? doc.entries : (Array.isArray(doc) ? doc : [doc]).map(v => part === 'operators' ? v : { ...v, file: part });
        r = expandTraitRecords(data, entries, { pluginId: p.id, validateDsl, permissions: p.manifest.permissions },
          (d, rs, opts) => expandFxRecords(d, rs, opts, expandGameplayRecords));
      }
      problems.push(...r.problems.map(e => ({ ...e, plugin: p.id, file: rel })));
      data = r.data;
    }
    problems.push(...writesAllowed(before, data, p, owners));
    problems.push(...dslWriterProblems(before, data, p, owners));
    problems.push(...potDownProblems(before, data, p));
    const prep = prepSpecs(p);
    problems.push(...prep.problems.map(e => ({ ...e, plugin: p.id })));
    if (prep.specs.length) prepById.set(p.id, prep.specs);
  }
  if (problems.length) return { problems };
  if (prepById.size) {
    const table = {};
    for (const [id, specs] of prepById) {
      if (!Array.isArray(specs)) { problems.push(problem('PLUGIN_DSL_SHAPE', `dsl.${id}`, 'prep specs must be an array')); continue; }
      for (const spec of specs) {
        const checked = validatePrepSpec(spec, id);
        if (!checked.ok) for (const item of checked.problems) problems.push(problem(item.code, item.path ? `dsl.${id}.${item.path}` : `dsl.${id}`, item.zh));
      }
      table[id] = specs;
    }
    if (problems.length) return { problems };
    // A dsl-only plugin never clones. base.data is frozen; attach the private table only after ordinary patches.
    if (data === base.data || Object.isFrozen(data)) data = clone(data);
    data.dsl = table;
  }
  if (plugins.length) {
    data = reconcilePluginTokens(reconcilePluginBonds(data));
    for (const p of plugins) if (p.offers?.length) problems.push(...offerReferenceProblems(p.offers, p.manifest, p.content.documents, base.data, data));
    problems.push(...validateGameplayData(data, { kitExists: ref => !!officialKit(ref), vanilla: base.data, owners, validateDsl }));
    if (problems.length) return { problems };
    warnings.push(...bossCentreWarnings(data));
    data = { ...data, stages: { ...data.stages } };
    const routes = Object.values(data.waves).flatMap(w => [...(w.routes ?? []), ...(w.extraRoutes ?? [])]);
    const changedWaves = new Set();
    for (const [id, wave] of Object.entries(data.waves)) if (routesChanged(base.data.waves[id], wave)) changedWaves.add(id);
    const stagesFromWaves = new Set();
    if (changedWaves.size) for (const mode of Object.values(data.config.modes ?? {})) {
      if (wavesUsedByMode(mode).some(id => changedWaves.has(id))) for (const sid of mode.stages ?? []) stagesFromWaves.add(sid);
    }
    for (const [id, stage] of Object.entries(data.stages)) {
      const stageChanged = canonicalJson(stage) !== canonicalJson(base.data.stages[id] ?? null);
      // A route-only change keeps the stage's own deployTiles. [ASSUMED] bots then read the new paths; deployment lists stay the stage's.
      if (stageChanged) data.stages[id] = { ...stage, ...computeGroundPaths(stage, routes), deployTiles: computeDeployTiles(stage) };
      else if (stagesFromWaves.has(id)) data.stages[id] = { ...stage, ...computeGroundPaths(stage, routes) };
    }
  }
  const tr = translations(data, base.i18n, plugins);
  if (tr.problems.length) return { problems: tr.problems };
  // Checking declarative references must never execute a dependency's script setup/preflight.
  if (checkDataOnly) return { data, problems: [] };
  const bodies = new Map(base.files), files = {}, hashes = {};
  for (const [name, rec] of Object.entries(data)) {
    const rel = `data/${name}.json`;
    // A new table (data/dsl.json) has no base bytes. canonicalJson(undefined) throws, so a missing key is always written.
    if (!Object.hasOwn(base.data, name) || canonicalJson(rec) !== canonicalJson(base.data[name])) bodies.set(rel, Buffer.from(JSON.stringify(rec)));
    const body = bodies.get(rel); hashes[name] = nodeSha256(body);
  }
  for (const [lang, doc] of Object.entries(tr.out)) if (canonicalJson(doc) !== canonicalJson(base.i18n[lang] ?? null)) bodies.set(`i18n/${lang}.json`, Buffer.from(JSON.stringify(doc)));
  const boundsSnap = exportOfficialBounds(rememberOfficialBounds(base.data));
  if (plugins.length) bodies.set('bounds/official.json', Buffer.from(canonicalJson(boundsSnap)));
  // Notices and personal theme values are not gameplay. Use the same canonical snapshot whether those fields
  // are absent or present. The registry retains the raw manifest and lock for owner admission.
  const noticeFree = new Map(plugins.flatMap(p => {
    const source = manifestTextWithoutNotices(p.content?.documents?.['plugin.json']);
    return source ? [[p.id, { source, hash: nodeSha256(Buffer.from(source)) }]] : [];
  }));
  const scripts = plugins.filter(p => p.script).map(p => ({ id:p.id, version:p.manifest.version, class:p.class,
    // [ASSUMED] For every script, identify the checked gameplay snapshot rather than its raw lock
    // (the latter includes the notice bytes). Owner admission still checks the complete, original lock hash.
    execution:p.script.execution || 'trusted', hash: noticeFree.has(p.id)
      ? nodeSha256(Buffer.from(canonicalJson({ ...p.content.files, 'plugin.json': noticeFree.get(p.id).hash })))
      : p.script.lockHash, permissions:p.manifest.permissions, authors:p.manifest.authors,
    manifestSource: noticeFree.get(p.id)?.source ?? p.script.manifestSource, sources:p.script.sources }));
  // [ASSUMED] Any trusted member makes the whole composition native; sandbox mode cannot enable trusted classes.
  if (scripts.some(p => p.class === 'trusted')) for (const p of scripts) p.execution = 'trusted';
  for (const p of scripts) if (p.execution === 'trusted') p.browserSources = browserScriptSources(p);
  const execution = scripts[0]?.execution;
  const scriptHashes = {};
  for (const p of scripts) {
    const body = Buffer.from(JSON.stringify(p));
    bodies.set(`scripts/${p.id}.json`,body); scriptHashes[p.id] = nodeSha256(body);
  }
  if ([...bodies.values()].reduce((n, b) => n + b.length, 0) > 300 * 1024 * 1024) return { problems: [problem('PLUGIN_DATA_LIMIT', 'content', 'set exceeds 300 MB')] };
  const parts = plugins.map(p => ({ id: p.id, version: p.manifest.version,
    files: {...p.content.files, ...(noticeFree.has(p.id) ? {'plugin.json': noticeFree.get(p.id).hash} : {}), ...(scriptHashes[p.id] ? {'@script':scriptHashes[p.id]} : {})} }));
  const i18n = {};
  if (plugins.length) for (const [rel, body] of bodies) {
    const m = /^i18n\/([A-Za-z0-9-]+)\.json$/.exec(rel);
    if (m) i18n[m[1]] = nodeSha256(body);
  }
  const composed = composeRules(plugins.map((p) => ({ id: p.id, rules: p.manifest.rules })));
  if (composed.problems.length) return { problems: composed.problems };
  const rules = composed.rules;
  const cs = contentHashOf({ app: base.identity.app, sim: base.identity.sim, data: hashes, plugins: parts, settings, ...(Object.keys(i18n).length ? { i18n } : {}), ...(rules ? { rules } : {}) });
  const cache = caches.get(registry) ?? new Map(); caches.set(registry, cache);
  if (cache.has(cs)) return cache.get(cs);
  if (scripts.length) {
    const report = preflightScripts(registry,scripts,{plugins:parts,settings});
    if (report) return {problems:[problem(report.code,'scripts',report.message)]};
  }
  for (const [rel, body] of bodies) files[rel] = { sha256: nodeSha256(body), bytes: body.length };
  const vanilla = plugins.length === 0;
  // The interaction windows of the set (PLUGIN API v2, docs/PLUGINS.md §10b): the registry already checked each
  // file, including transitive option sources in content.files: every offer byte participates in cs.
  const offers = plugins.flatMap(p => (p.offers || []).map(o => ({ pluginId: p.id, ...o })));
  const index = vanilla ? base.identity.index : { ...base.identity.index, cs, vanilla: false, plugins: parts, settings, data: {}, i18n: {}, bounds: {}, ...(scripts.length ? {scripts:{}, execution} : {}), ...(rules ? { rules } : {}) };
  if (!vanilla) for (const [rel, f] of Object.entries(files)) {
    const url = base.files.get(rel)?.equals(bodies.get(rel)) ? `/data/${rel.replace(/^(data\/)/, '')}?v=${f.sha256.slice(0, 8)}` : `/cs/${csUrlPart(cs)}/${rel}`;
    const [section, name] = rel.split('/');
    index[section][name.slice(0, -5)] = { url, ...f };
  }
  const set = deepFreeze({ cs, vanilla, plugins: plugins.map(p => ({ id: p.id, version: p.manifest.version, hash: p.content.hash })),
    data, files, ...(scripts.length ? {scripts, execution} : {}), ...(rules ? { rules } : {}), modes: Object.values(data.config.modes), problems: [], warnings, index, settings, bounds: boundsSnap,
    kitted: [...KITTED_CHARS, ...Object.keys(data.backups.units).filter(id => !own(base.data.backups.units, id))],
    // PLUGIN API v2 (docs/PLUGINS.md §10b): the interaction windows the set declares, tagged with their plugin. Data
    // only and already checked by the registry; a set without one omits the field, so nothing downstream changes.
    ...(offers.length ? { offers } : {}) });
  // Executable routes use the descriptor's already hashed browser bytes; keep the JSON index table unchanged.
  if (execution === 'trusted') for (const p of scripts) {
    const m = JSON.parse(p.manifestSource);
    for (const rel of new Set([m.entry?.sim, m.entry?.meta, m.entry?.client].filter(Boolean)))
      bodies.set(`scripts/${p.id}/${rel}`, Buffer.from(p.browserSources[rel]));
  }
  bodies.set('index.json', Buffer.from(JSON.stringify(index)));
  buffers.set(set, bodies); cache.set(cs, set);
  // [ASSUMED] Keep 32 recently constructed sets per registry. Callers may retain a set and its files indefinitely.
  if (cache.size > 32) cache.delete(cache.keys().next().value);
  return set;
}

/** Route adapter: Map<relative path, {body: Buffer, sha256, bytes}>. Copies protect cached immutable snapshots. */
export function contentSetFiles(set) {
  return new Map([...(buffers.get(set) ?? [])].map(([rel, body]) => [rel, { body: Buffer.from(body), sha256: nodeSha256(body), bytes: body.length }]));
}

/** C1 failures are data diagnostics, including invalid nested stage/translation input. */
export function buildContentSet(options) {
  try { return composeContentSet(options ?? {}); }
  catch (e) { return { problems: [problem('PLUGIN_CONTENT_FORMAT', 'content', e.message)] }; }
}
