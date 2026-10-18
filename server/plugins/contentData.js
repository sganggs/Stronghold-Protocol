// Read declared P1b JSON once at scan time. A set never rereads changed plugin files under an old hash.
import fs from 'node:fs';
import path from 'node:path';
import { nodeSha256 } from './identity.js';
import { jsonProblems, object, problem } from '../../shared/plugins/dataUtils.js';
import { isPackPath, PLUGIN_LIMITS } from '../../shared/plugins/manifest.js';
import { deepFreeze } from '../data.js';
import { validateDsl } from '../sim/content/dsl/validate.js';
import { operatorMetadataProblems } from '../../shared/plugins/records.js';
import { hasOperatorTrait, validateTraitSpec } from './operatorTraits.js';
import { compilePluginFxDsl } from './fxRecords.js';
import { operatorFxProblems } from '../../public/js/render/vfx/pluginFormat.js';
import { manifestTextWithoutNotices } from '../../shared/plugins/notices.js';

export function readContentData(dir, manifest) {
  const documents = {}, files = {}, problems = [];
  const read = rel => {
    if (Object.hasOwn(documents, rel)) return documents[rel];
    if (!isPackPath(rel) || path.extname(rel).toLowerCase() !== '.json') throw problem('PLUGIN_CONTENT_FILE', rel, 'declared JSON path required');
    const abs = path.join(dir, ...rel.split('/'));
    const root = fs.realpathSync.native(dir), real = fs.realpathSync.native(abs);
    if (!real.startsWith(root + path.sep) || fs.lstatSync(abs).isSymbolicLink()) throw problem('PLUGIN_CONTENT_FILE', rel, 'file escapes plugin directory');
    const bytes = fs.readFileSync(abs);
    if (bytes.length > PLUGIN_LIMITS.jsonBytes) throw problem('PLUGIN_DATA_LIMIT', rel, 'JSON exceeds 8 MB');
    const doc = JSON.parse(bytes.toString('utf8'));
    // Compiled marker is host-only; data patches cannot forge ownership, runtime pins or trait code.
    if (/"operatorTrait"\s*:/.test(JSON.stringify(doc))) throw problem('PLUGIN_DSL_SHAPE', rel, 'operatorTrait is reserved for the content builder');
    const errors = jsonProblems(doc, rel);
    if (errors.length) throw errors[0];
    files[rel] = nodeSha256(bytes);
    documents[rel] = doc;
    return doc;
  };
  try {
    // [ASSUMED] Pin manifest text and translation bytes too: one cs serves one immutable snapshot (DESIGN §32.5).
    read('plugin.json');
    for (const part of ['data', 'operators', 'enemies', 'modes', 'stages', 'dsl']) for (const rel of manifest.parts[part]?.files ?? []) {
      const doc = read(rel);
      if (part === 'dsl') {
        const checked = validateDsl(doc);
        if (!checked.ok) {
          const p = checked.problems[0];
          throw problem(p.code, p.path ? `${rel}.${p.path}` : rel, p.zh);
        }
        // [ASSUMED] A manifest dsl file is a prep spec and must carry meta. A battle kit lives on the operator record (DESIGN §32.7).
        if (doc.meta == null) throw problem('PLUGIN_DSL_META', rel, 'prep DSL file needs a meta block');
        if (doc.pluginId != null && doc.pluginId !== manifest.id) throw problem('PLUGIN_DSL_PLUGIN_ID', rel, 'spec pluginId must match the host plugin');
      }
      if (part === 'data' && !(object(doc) && (doc.patch === 1 && Array.isArray(doc.ops) || doc.records === 1 && Array.isArray(doc.entries)))) throw problem('PLUGIN_CONTENT_FORMAT', rel, 'expected patch:1/ops or records:1/entries');
    }
    for (const rel of Object.values(manifest.parts.i18n?.langs ?? {})) read(rel);
    // Offers and their transitive sources are immutable, hashed JSON, just like kit.spec.
    for (const rel of manifest.parts.offers?.files ?? []) {
      const doc = read(rel);
      if (typeof doc?.options?.source === 'string') read(doc.options.source);
    }
    // kit.spec may point at a JSON file; it is declared transitively by its compact operator record.
    const resolveSpec = r => {
      const fxErrors = operatorFxProblems(r?.fx);
      if (fxErrors.length) throw problem('PLUGIN_RECORD_TYPE', 'fx', fxErrors[0]);
      const errors = operatorMetadataProblems(r, manifest.id);
      if (errors.length) throw errors[0];
      if (typeof r?.kit?.spec === 'string') r.kit.spec = read(r.kit.spec);
      if (hasOperatorTrait(r)) {
        for (const tr of [r.trait, ...Object.values(r.forms ?? {}).map(f => f.trait)]) if (tr?.dsl !== undefined) {
          if (typeof tr.dsl === 'string') tr.dsl = read(tr.dsl);
          validateTraitSpec(tr.dsl, manifest.id);
        }
      }
    };
    for (const rel of manifest.parts.operators?.files ?? []) for (const r of Array.isArray(documents[rel]) ? documents[rel] : [documents[rel]]) resolveSpec(r);
    for (const rel of manifest.parts.data?.files ?? []) for (const r of documents[rel].entries ?? []) resolveSpec(r);
    // Keep the raw file hashes; only new fx actions change the compiled data the content set serves.
    for (const [rel, doc] of Object.entries(documents)) if (rel !== 'plugin.json' && /"kind"\s*:\s*"plugin"/.test(JSON.stringify(doc))) documents[rel] = compilePluginFxDsl(doc, manifest.id);
  } catch (e) { problems.push(e?.code?.startsWith('PLUGIN_') ? e : problem('PLUGIN_CONTENT_FILE', dir, e.message)); }
  // Keep raw files for lock verification. Room identity and stale detection always use the canonical snapshot without notices or personal themes.
  const source = manifestTextWithoutNotices(documents['plugin.json']);
  const gameplayFiles = source ? { ...files, 'plugin.json': nodeSha256(Buffer.from(source)) } : files;
  return { content: problems.length ? null : deepFreeze({ documents, files,
    ...(source ? { gameplayFiles } : {}), hash: nodeSha256(Buffer.from(JSON.stringify(gameplayFiles))) }), problems };
}
