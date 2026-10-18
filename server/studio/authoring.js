// The wizard owns only visible fields. Validate the complete merged folder before saving.
import fs from 'node:fs';
import path from 'node:path';
import { stageUploads, commitDocuments, snapshotDocuments, writeDocuments, captureLockChange } from './mediaDraft.js';
import { officialEffects } from './presentationData.js';
import { inventory, folderRevision, createCandidateAsync, commitCandidate } from './candidate.js';
import { checkCandidate } from './check.js';
import { createPlugin, templateById, manifestText } from './templates/index.js';
import { createTargetIndex, targetOf } from './targets.js';
import { numericFields, officialOperator, readStudioData, itemParams } from './gameData.js';
import { dslExample } from './dslExamples.js';
import { validateDsl } from '../sim/content/dsl/validate.js';
import { bbCap, officialBbRange, rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { MOD_KEYS } from '../../shared/plugins/skillSpec.js';
import { dslBoundForPath } from '../sim/content/dsl/bounds.js';
import { jsonProblems } from '../../shared/plugins/dataUtils.js';
import { StudioError } from './files.js';
import { PRESENTATION_TEMPLATES } from '../../public/studio/js/presentation.js';
import { GAMEPLAY_TEMPLATES, gameplayDefaults } from '../../public/studio/js/gameplayModel.js';
import { checkGameplayDraft } from './gameplayCheck.js';
import { mergeAuthorText, mergeAuthorValue, reviseJson, mergeWidgetText, removeAuthorOwned } from './authorMerge.js';
import { readPresentationOptions, readAuthorOptions } from './authorOptions.js';

export function authorRevision(files, id) {
  return folderRevision(inventory(files.root(id)));
}

export function createAuthoring({ files, dataDir, publicDir = path.join(dataDir, '../public') }) {
  let data;
  const official = () => (data ||= readStudioData(dataDir));
  const targets = createTargetIndex(dataDir);
  const read = id => {
    let side;
    try { side = JSON.parse(files.readSidecar(id, '.studio.json') || '{}'); } catch { side = {}; }
    if (!side.authoring) return null;
    const revision = authorRevision(files, id), documents = snapshot(id);
    const manifest = JSON.parse(documents['plugin.json'].toString());
    let options = side.authoring.options;
    if (GAMEPLAY_TEMPLATES.includes(side.authoring.template)) options = readAuthorOptions(id, side.authoring, documents, manifest, official());
    else options = readPresentationOptions(id, side.authoring, documents, manifest, side.authoring.template === 'fx' ? official() : null);
    return { ...side.authoring, options, revision };
  };
  const details = (template, target) => {
    const t = targetOf(targets().targets, target);
    const d = official();
    if (template === 'fx') {
      const indexed = officialEffects(publicDir);
      const { normal, elite } = officialOperator(d, t?.key || 'char_102_texas');
      const normalSkills = normal.skills?.length ? normal.skills : [normal.skill];
      const eliteSkills = elite.skills?.length ? elite.skills : [elite.skill];
      return { units: indexed.map(u => ({ ...u, kind: 'operator', name: targets().targets.find(t => t.kind === 'operator' && t.key === u.key)?.name || u.key })),
        slots: Array.from({ length: Math.max(normalSkills.length, eliteSkills.length) }, (_, i) => ({ id: String(i), name: `S${i + 1}: ${(normalSkills[i] || eliteSkills[i])?.name || (normalSkills[i] || eliteSkills[i])?.skillId || ''}` })) };
    }
    if (GAMEPLAY_TEMPLATES.includes(template)) {
      const defaults = gameplayDefaults(template, 'draft-plugin');
      if (template === 'trait' && t) defaults.charId = t.key;
      if (template === 'item' && t) defaults.base = Object.values(d.items).find(r => !r.isGolden && (r.id === t.key || r.iconId === t.key))?.id || defaults.base;
      rememberOfficialBounds(d);
      const keys = [...new Set(Object.values(d.items).flatMap(r => (r.buffs || []).flatMap(b => Object.keys(b.bb || {}))))];
      return { defaults, items: d.items, bounds: Object.fromEntries(keys.map(k => [k, officialBbRange(k)])),
        dslBounds: Object.fromEntries(MOD_KEYS.map(k => [k, bbCap(dslBoundForPath(`mods.${k}`).key)])) };
    }
    if (template === 'numbers') return { fields: numericFields(d, t || { kind: 'operator', key: 'char_102_texas' }) };
    if (['operator', 'dsl'].includes(template)) {
      const source = officialOperator(d, t?.key || 'char_102_texas');
      return { source, branches: [...new Map(Object.values(d.chess).map(r => [r.subProfessionId, { id: r.subProfessionId, profession: r.profession, name: r.subProfessionName || r.subProfessionId }])).values()], bonds: Object.entries(d.bonds).map(([id, r]) => ({ id, name: r.name })) };
    }
    return { modes: Object.values(d.config.modes).filter(m => m.inScope).map(m => ({ id: m.modeId, name: m.name })) };
  };
  const generate = (id, input, manifest = null, { validate = true, previous = false } = {}) => {
    const tpl = templateById(input.template);
    if (!tpl?.build || !input.options || typeof input.options !== 'object' || Array.isArray(input.options)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400, { detail: 'wizard template and options required' });
    const problems = jsonProblems(input.options, 'options');
    if (problems.length) throw new StudioError(problems[0].code, 400, { where: problems[0].path, detail: problems[0].message });
    const target = tpl.id === 'skins' && typeof input.target === 'string' && input.target.startsWith('operator:')
      ? { kind: 'operator', key: input.target.slice(9) } : input.target ? targetOf(targets().targets, input.target) : null;
    if (input.target && (!target || !tpl.kinds.includes(target.kind))) throw new StudioError('PLUGIN_STUDIO_TARGET', 400, { target: input.target });
    const name = typeof manifest?.name === 'string' ? manifest.name : manifest?.name?.zh || manifest?.name?.en || id;
    const made = createPlugin(tpl, { id, name, target, options: input.options, data: tpl.class === 'cosmetic' ? null : official(), publicDir, previous });
    if (validate && [...GAMEPLAY_TEMPLATES, ...PRESENTATION_TEMPLATES].includes(tpl.id)) {
      stageUploads(input, made.files, made.manifest);
      const result = checkGameplayDraft(id, made, { dataDir, strict: PRESENTATION_TEMPLATES.includes(tpl.id) });
      if (!result.ok) {
        const p = result.problems[0];
        throw new StudioError(p.code, 400, { where: p.path || p.params?.where || '', detail: p.message || p.text || p.zh });
      }
    }
    return made;
  };
  const snapshot = id => snapshotDocuments(files, id);
  const prepare = (id, input, { validate = true, allowUntracked = false, validateMedia = true } = {}) => {
    // Existing trial API also previews templates in folders without a studio sidecar; only trials allow that.
    const old = read(id) || (allowUntracked ? { template: input.template, target: input.target, options: {} } : null);
    if (!old || old.template === 'script' || input.template !== old.template) throw new StudioError('PLUGIN_STUDIO_REQUEST', 409, { detail: 'this plugin is not editable with this wizard' });
    if (input.revision !== undefined && input.revision !== old.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
    const documents = snapshot(id), present = new Set(files.list(id).map(f => f.rel)), source = documents['plugin.json'].toString(), manifest = JSON.parse(source);
    const before = generate(id, old, manifest, { validate: false, previous: true });
    const made = generate(id, input, manifest, { validate: false });
    for (const [rel, text] of Object.entries(made.files)) {
      if (rel === 'README.md') continue;
      if (rel === 'assets/studio-bond.png' && manifest.assets?.bonds?.[`bond_x_${id.replaceAll('-', '_')}_one`] !== rel) continue;
      if (documents[rel] && rel.endsWith('.json') && before.files[rel]) {
        let previous = JSON.parse(before.files[rel]), next = JSON.parse(text);
        if (input.template === 'fx' && rel === 'data/operator.json' && Array.isArray(JSON.parse(documents[rel].toString()))) {
          previous = [previous]; next = [next];
        }
        documents[rel] = Buffer.from(mergeAuthorText(documents[rel].toString(), previous, next));
      } else if (documents[rel] && input.template === 'ui' && rel === 'ui/index.html') {
        documents[rel] = Buffer.from(mergeWidgetText(documents[rel].toString(), String(before.files[rel]), String(text)));
      } else if (!present.has(rel)) documents[rel] = Buffer.from(text);
      // Existing binary assets and hand-authored non-JSON files are not form fields.
    }
    for (const [rel, text] of Object.entries(before.files)) {
      if (!rel.endsWith('.json') || made.files[rel] || !documents[rel]) continue;
      const source = documents[rel].toString(), remaining = removeAuthorOwned(JSON.parse(source), JSON.parse(text));
      if (remaining === undefined) continue;
      documents[rel] = Buffer.from(reviseJson(source, remaining));
      for (const key of ['operators', 'data', 'dsl', 'modes', 'offers']) if (before.manifest[key]?.includes(rel))
        (made.manifest[key] ||= []).push(rel);
    }
    if (input.template === 'item') {
      const rel = 'data/item.json', text = documents[rel].toString(), doc = JSON.parse(text);
      for (const r of doc.entries || doc.ops || []) if (r.file === 'items' &&
        ['a', 'b'].some(suffix => r.id === `item_x_${id.replaceAll('-', '_')}_${suffix}`)) {
        const value = r.value || r.set;
        value.params = itemParams(value.buffs || []);
      }
      documents[rel] = Buffer.from(reviseJson(text, doc));
    }
    mergeAuthorManifest(manifest, made.manifest, before.manifest, documents);
    documents['plugin.json'] = Buffer.from(reviseJson(source, manifest));
    stageUploads(input, documents, manifest, { validate: validateMedia });
    const result = { ...made, manifest, files: documents, sourceDir: files.root(id) };
    if (validate) {
      const checked = checkGameplayDraft(id, result, { dataDir, pluginsDir: files.base, strict: PRESENTATION_TEMPLATES.includes(input.template) });
      if (!checked.ok) {
        const p = checked.problems[0];
        throw new StudioError(p.code, 400, { where: p.path || '', detail: p.message || p.text || p.zh });
      }
    }
    return result;
  };
  const save = (id, input) => {
    const old = read(id);
    if (input.revision !== old?.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
    const made = prepare(id, input);
    if (authorRevision(files, id) !== old.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
    const side = JSON.parse(files.readSidecar(id, '.studio.json') || '{}');
    commitDocuments(files, id, made.files, Buffer.from(manifestText({ ...side, authoring: made.authoring })));
  };
  // HTTP saves/checks use a disposable checker so large media never blocks the game loop.
  const checkedCandidate = async (id, input, save) => {
    const made = prepare(id, input, { validate: false, validateMedia: false }), candidate = await createCandidateAsync(files, id);
    try {
      if (input.revision !== undefined && input.revision !== candidate.revision) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
      writeDocuments(candidate, id, made.files);
      const checked = await checkCandidate({ dir: candidate.dir, dataDir, pluginsDir: files.base,
        strict: PRESENTATION_TEMPLATES.includes(input.template), uploads: (input.uploads || []).map(u => u.path) });
      if (!checked.ok) { const p = checked.problems[0]; throw new StudioError(p.code, 400, { where: p.path, detail: p.message }); }
      captureLockChange(candidate);
      if (save) {
        const side = JSON.parse(files.readSidecar(id, '.studio.json') || '{}');
        commitCandidate(files, id, candidate, Buffer.from(manifestText({ ...side, authoring: made.authoring })));
      }
      return { ok: true, problems: [] };
    } finally { await candidate.cleanupAsync(); }
  };
  return { read, save, generate, prepare, details,
    saveAsync: (id, input) => {
      if (input.revision !== authorRevision(files, id)) throw new StudioError('PLUGIN_STUDIO_CHANGED', 409);
      return checkedCandidate(id, input, true);
    },
    async validateDraftAsync(input) {
      try {
        if (files.ids().includes(input.id)) return await checkedCandidate(input.id, input, false);
        generate(input.id, input); return { ok: true, problems: [] };
      } catch (e) { return { ok: false, problems: [{ code: e.code || 'PLUGIN_STUDIO_REQUEST', path: e.params?.where || '', message: e.params?.detail || e.message }] }; }
    },
    validateDraft(input) {
      try {
        if (files.ids().includes(input.id)) prepare(input.id, input);
        else generate(input.id, input);
        return { ok: true, problems: [] };
      } catch (e) { return { ok: false, problems: [{ code: e.code || 'PLUGIN_STUDIO_REQUEST', path: e.params?.where || '',
        message: e.params?.detail || e.message, params: e.params }] }; }
    },
    example: dslExample,
    // the official caps the build applies (contentSet.js), or a literal over them would pass here and fail on save
    validate: spec => { rememberOfficialBounds(official()); return validateDsl(spec, { bounds: true }); },
    source(id) {
      const manifest = JSON.parse(fs.readFileSync(files.stat(id, 'plugin.json').abs, 'utf8'));
      const rel = manifest.entry?.sim;
      return typeof rel === 'string' ? { rel, text: fs.readFileSync(files.stat(id, rel).abs, 'utf8').slice(0, 100000) } : null;
    },
  };
}

/** Preserve metadata, settings, dependencies and other unowned parts in both save and unsaved trials. */
export function mergeAuthorManifest(manifest, generated, before, documents) {
  const paths = value => typeof value === 'string' ? [value] : value || [];
  for (const key of ['operators', 'data', 'dsl', 'modes', 'slots', 'entry', 'offers', 'rules']) {
    if (Array.isArray(before[key]) || Array.isArray(generated[key])) {
      const retained = paths(manifest[key]).filter(x => !(before[key] || []).includes(x) || (generated[key] || []).includes(x));
      const next = [...retained];
      for (const rel of generated[key] || []) if (!next.includes(rel)) next.push(rel);
      if (next.length) {
        if (!(typeof manifest[key] === 'string' && next.length === 1 && next[0] === manifest[key])) manifest[key] = next;
      } else delete manifest[key];
    } else if (before[key] !== undefined || generated[key] !== undefined) {
      manifest[key] = mergeAuthorValue(manifest[key], before[key], generated[key]);
      if (manifest[key] === undefined) delete manifest[key];
    }
  }
  // Presentation payloads merge field by field too, so edits made outside the form survive a save.
  for (const key of ['theme', 'notices']) if (before[key] !== undefined || generated[key] !== undefined) {
    manifest[key] = mergeAuthorValue(manifest[key], before[key], generated[key]);
    if (manifest[key] === undefined) delete manifest[key];
  }
  if (before.assets !== undefined || generated.assets !== undefined) {
    if (typeof manifest.assets === 'string') throw new StudioError('PLUGIN_STUDIO_REQUEST', 409, { detail: 'wizard assets must be inline' });
    manifest.assets = mergeAuthorValue(manifest.assets || {}, before.assets || {}, generated.assets || {});
    if (!Object.keys(manifest.assets).length) delete manifest.assets;
  }
  // Retained declarations still need their permissions. Never infer ownership from a template's class.
  const needed = p => p === 'dsl' ? manifest.dsl?.length || [...paths(manifest.operators), ...paths(manifest.data)].some(rel => {
    const d = JSON.parse(documents[rel]?.toString() || 'null');
    return (Array.isArray(d) ? d : d?.entries || [d]).some(r => r?.kit?.dsl || r?.trait?.dsl);
  }) : p === 'data.patch' || p === 'data.add' ? manifest.data?.length || manifest.operators?.length || manifest.modes?.length
    : p === 'offers' ? manifest.offers?.length : p === 'assets.add' ? manifest.assets && Object.keys(manifest.assets).length : true;
  const permissions = (manifest.permissions || []).filter(p =>
    !(before.permissions || []).includes(p) || (generated.permissions || []).includes(p) || needed(p));
  for (const permission of generated.permissions || []) if (!permissions.includes(permission)) permissions.push(permission);
  if (manifest.permissions !== undefined || permissions.length) manifest.permissions = permissions;
  return manifest;
}
