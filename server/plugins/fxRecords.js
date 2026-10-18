// Optional presentation metadata is compiled outside shared/ and sim/: old content identities remain byte-identical.
import { expandRecords } from '../../shared/plugins/records.js';
import { operatorFxProblems, fxId, fxNamespace } from '../../public/js/render/vfx/pluginFormat.js';
import { problem } from '../../shared/plugins/dataUtils.js';
import { RECORDS_SCHEMA } from '../../shared/plugins/recordsSchema.js';

/** Editor schema for the loader's extension; legacy shared schema bytes remain part of the unchanged sim identity. */
export const FX_RECORDS_SCHEMA = JSON.parse(JSON.stringify(RECORDS_SCHEMA));
const effectId = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,95}$', not: { enum: ['constructor', 'prototype', '__proto__'] } };
const fxSchema = { type: 'object', required: ['unit'], additionalProperties: false, properties: {
  unit: effectId,
  skills: { type: 'object', maxProperties: 10, propertyNames: effectId, additionalProperties: effectId },
} };
// The schema contains three copies: a single record, an array, and records:1/entries.
for (const record of [FX_RECORDS_SCHEMA.anyOf[0], FX_RECORDS_SCHEMA.anyOf[1].items, FX_RECORDS_SCHEMA.anyOf[2].properties.entries.items]) record.anyOf[0].properties.fx = fxSchema;

/** Compile the plugin-only spelling to the existing fx(kind, {id, skill, dur}) event, without new sim code. */
export function compilePluginFxDsl(doc, pluginId) {
  const walk = (v, depth = 0) => {
    if (depth > 24) throw problem('PLUGIN_DSL_ACTION', 'fx', 'effect DSL nesting exceeds 24');
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => walk(x, depth + 1));
    const out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, depth + 1)]));
    if (out.fx?.kind === 'plugin') {
      const body = out.fx;
      if (!fxId(body.id)) throw problem('PLUGIN_DSL_ACTION', 'fx.id', 'plugin fx requires a local effect id');
      if (body.skill !== undefined) throw problem('PLUGIN_DSL_ACTION', 'fx.skill', 'skill is reserved for the compiled effect address');
      out.fx = { ...body, id: true, skill: fxNamespace(pluginId) + body.id };
    }
    return out;
  };
  return walk(doc);
}

export function expandFxRecords(data, records, options, expand = expandRecords) {
  const problems = records.flatMap((r, i) => operatorFxProblems(r?.fx).map(s => problem('PLUGIN_RECORD_TYPE', `records[${i}].fx`, s)));
  if (problems.length) return { data, problems };
  const clean = records.map(r => { if (r.fx === undefined) return r; const { fx: _fx, ...rest } = r; return rest; });
  const result = expand(data, clean, options);
  if (result.problems.length) return result;
  for (const r of records) if (r.op === 1 && r.fx !== undefined) {
    const fx = JSON.parse(JSON.stringify(r.fx));
    const unit = result.data.backups?.units?.[r.charId];
    if (unit) unit.fx = fx;
    for (const rec of Object.values(result.data.chess || {})) if (rec.charId === r.charId) rec.fx = fx;
  }
  return result;
}
