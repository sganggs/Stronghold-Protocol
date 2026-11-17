// Declarative operator-owned traits (#671), admitted outside the vanilla hashed engine.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { clone, object, problem } from '../../shared/plugins/dataUtils.js';
import { canonicalJson } from '../../shared/plugins/identity.js';
import { validateDsl } from '../sim/content/dsl/validate.js';
import { ELEMENTS } from '../sim/constants.js';

const runtime = new URL('../../public/js/battle/operatorTraits.js', import.meta.url);
export const operatorTraitRuntimeDigest = () => createHash('sha256').update(fs.readFileSync(runtime)).digest('hex');
export const TRAIT_EVENTS = Object.freeze(['gain', 'deploy', 'roundStart', 'buy', 'sell', 'merge', 'levelUp', 'battleResult']);
export const TRAIT_SURFACE = Object.freeze([
  'record.operator.trait.dsl', 'record.operator.overrides.trait', 'dsl.trait.on',
  'dsl.trigger.elementBurst', 'dsl.condition.element', 'dsl.condition.targetOnField', 'dsl.condition.selfOnField',
  'dsl.layers.maxPerBattle', 'dsl.layers.selfActive', 'dsl.gainItem.count', ...TRAIT_EVENTS.map(e => `dsl.trait.meta.${e}`),
].map(name => ({ name, group: 'trait', stability: 'stable', since: '0.3.1', anchor: 'server/plugins/operatorTraits.js#TRAIT_SURFACE' })));

export const hasOperatorTrait = r => r?.trait?.dsl !== undefined || r?.kit?.dsl?.trait?.on !== undefined
  || Object.values(r?.forms ?? {}).some(f => f?.trait?.dsl !== undefined);
/** Permissions consumed by record JSON, beyond what the manifest alone can see (check, registry and studio). */
export function operatorTraitPermissions(content, manifest) {
  const used = new Set();
  for (const part of ['operators', 'data']) for (const rel of manifest.parts[part]?.files ?? []) {
    const doc = content?.documents[rel];
    for (const r of Array.isArray(doc) ? doc : doc?.entries ?? [doc]) {
      if (r?.kit?.dsl != null) used.add('dsl');
      if (hasOperatorTrait(r)) {
        used.add('dsl');
        if (!r.charId?.startsWith('char_x_')) used.add('data.patch');
      }
    }
  }
  return used;
}
const fail = (path, message, code = 'PLUGIN_DSL_SHAPE') => { throw problem(code, path, message); };

/** Patches cannot rewrite compiled metadata, including through a declared dependency or a parent replacement. */
export function operatorTraitPatchProblems(before, after) {
  const ids = new Set([...Object.keys(before.garrisons ?? {}), ...Object.keys(after.garrisons ?? {})]);
  return [...ids].filter(id => canonicalJson(before.garrisons?.[id]?.operatorTrait ?? null)
    !== canonicalJson(after.garrisons?.[id]?.operatorTrait ?? null))
    .map(id => problem('PLUGIN_DSL_PLUGIN_ID', `garrisons.${id}.operatorTrait`, 'compiled traits may only be written by trait declarations'));
}

/** Validate extensions, then delegate the remaining closed grammar to the unchanged DSL validator. */
export function validateTraitSpec(spec, pluginId, data = null) {
  if (!object(spec)) fail('trait.dsl', 'trait DSL must be an object');
  const clean = clone(spec);
  if (clean.pluginId !== undefined && clean.pluginId !== pluginId) fail('trait.dsl.pluginId', 'host plugin id differs', 'PLUGIN_DSL_PLUGIN_ID');
  if (Object.keys(clean).some(k => !['dsl', 'pluginId', 'budget', 'talents', 'meta'].includes(k))) fail('trait.dsl', 'traits accept talents and meta, not skills or class traits');
  const walk = (v, depth = 0) => {
    if (depth > 64) fail('trait.dsl', 'nesting exceeds 64', 'PLUGIN_DSL_LOOP');
    if (!v || typeof v !== 'object') return;
    if (data && v.bondActive !== undefined && !Object.hasOwn(data.bonds ?? {}, typeof v.bondActive === 'string' ? v.bondActive : v.bondActive?.id)) fail('if.bondActive', 'unknown bond', 'PLUGIN_DATA_REFERENCE');
    if (v.layers) {
      const b = v.layers;
      if (!object(b) || typeof b.bond !== 'string' || !b.bond || b.amount === undefined) fail('layers', 'bond and amount required', 'PLUGIN_DSL_ACTION');
      if (data && b.bond !== 'selfActive' && !Object.hasOwn(data.bonds ?? {}, b.bond)) fail('layers.bond', 'unknown bond', 'PLUGIN_DATA_REFERENCE');
      if ((b.maxPerBattle !== undefined || b.bond === 'selfActive') && (!Number.isInteger(b.amount) || b.amount < 1 || b.amount > 1000000)) fail('layers.amount', 'capped/selfActive amount must be an integer 1..1000000', 'PLUGIN_DSL_NUMBER');
      if (b.maxPerBattle !== undefined) {
        // [ASSUMED] A cap is a literal integer 1..1000000, per holder/action/bond, not reset by redeploy.
        if (!Number.isInteger(b.maxPerBattle) || b.maxPerBattle < 1 || b.maxPerBattle > 1000000) fail('layers.maxPerBattle', 'integer 1..1000000 required', 'PLUGIN_DSL_NUMBER');
        delete b.maxPerBattle;
      }
    }
    for (const x of Object.values(v)) walk(x, depth + 1);
  };
  for (const entry of clean.talents ?? []) {
    if (!object(entry)) continue;
    const burst = entry.when === 'elementBurst';
    if (burst) entry.when = 'battleStart';
    if (object(entry.if)) {
      const c = entry.if;
      // [ASSUMED] Closed vocabulary: only the five elements the sim's gauges implement (server/sim/attack/element.js).
      if (c.element !== undefined && !ELEMENTS.includes(c.element)) fail('if.element', 'unknown element', 'PLUGIN_DSL_CONDITION');
      for (const key of ['targetOnField', 'selfOnField']) if (c[key] !== undefined && typeof c[key] !== 'boolean') fail(`if.${key}`, 'boolean required', 'PLUGIN_DSL_CONDITION');
      // Field conditions on always would bypass a callback when installed on a living unit.
      if (!burst && ['element', 'targetOnField', 'selfOnField'].some(k => c[k] !== undefined)) fail('if', 'field/element conditions require elementBurst', 'PLUGIN_DSL_CONDITION');
      delete c.element; delete c.targetOnField; delete c.selfOnField;
    }
    walk(entry);
  }
  if (clean.meta !== undefined) {
    if (!object(clean.meta) || Object.keys(clean.meta).some(k => k !== 'on') || !Array.isArray(clean.meta.on)) fail('trait.meta', 'operator meta needs on, without a registry key', 'PLUGIN_DSL_META');
    for (const entry of clean.meta.on) {
      if (!object(entry) || !TRAIT_EVENTS.includes(entry.when)) fail('trait.meta.when', 'unknown operator event', 'PLUGIN_DSL_TRIGGER');
      walk(entry.if);
      entry.when = 'roundStart';
      for (const action of entry.do ?? []) {
        if (action?.layers?.maxPerBattle !== undefined || action?.layers?.bond === 'selfActive') fail('meta.layers', 'battle-only layers fields', 'PLUGIN_DSL_ACTION');
        if (action?.gainItem) {
          const b = action.gainItem;
          if (typeof b.item !== 'string' || !b.item || data && !Object.hasOwn(data.items ?? {}, b.item)) fail('gainItem.item', 'existing item required', 'PLUGIN_DATA_REFERENCE');
          // [ASSUMED] Bounded grants, same inventory/pool/merge rules as official item acquisition.
          if (b.count !== undefined && (!Number.isInteger(b.count) || b.count < 1 || b.count > 64)) fail('gainItem.count', 'integer 1..64 required', 'PLUGIN_DSL_NUMBER');
          delete b.count;
        }
        walk(action);
      }
    }
  }
  const result = validateDsl(clean, { bounds: !!data });
  if (!result.ok) { const p = result.problems[0]; fail(p.path, p.zh, p.code); }
  return spec;
}

/** No changes at all for records without new fields, including their serialized content hash. */
export function expandTraitRecords(data, records, options, expand) {
  const plain = (d, rs, opts) => {
    const result = expand(d, rs, opts);
    return { ...result, problems: [...result.problems, ...operatorTraitPatchProblems(d, result.data)] };
  };
  if (!records.some(hasOperatorTrait)) return plain(data, records, options);
  try {
    let out = clone(data);
    for (const original of records) {
      if (!hasOperatorTrait(original)) {
        const r = plain(out, [original], options); if (r.problems.length) return r; out = r.data; continue;
      }
      const r = clone(original), pluginId = options.pluginId;
      if (!options.permissions?.includes('dsl')) fail('trait', 'dsl permission required', 'PLUGIN_CONTENT_PERMISSION');
      const official = !r.charId?.startsWith('char_x_');
      if (official && (!options.permissions.includes('data.patch') || r.op !== 1 || !Object.values(out.chess).some(c => c.charId === r.charId) && !out.backups?.units?.[r.charId])) fail('charId', 'existing operator and data.patch permission required', 'PLUGIN_DATA_REFERENCE');
      if (official && Object.keys(r).some(k => !['op', 'charId', 'trait', 'forms', 'overrides'].includes(k))) fail('operator', 'official trait record may only declare trait, forms and overrides');
      if (r.forms !== undefined && !object(r.forms)) fail('forms', 'forms must be an object');
      const overrides = r.overrides ?? [];
      if (!Array.isArray(overrides) || overrides.length > 1 || overrides.some(x => x !== `trait:${r.charId}`) || overrides.length && !official) fail('overrides', 'only trait:<this official charId> is allowed', 'PLUGIN_SCRIPT_OVERRIDE');
      delete r.overrides;
      const inline = r.kit?.dsl?.trait?.on !== undefined ? r.kit.dsl.trait : null;
      if (inline) {
        if (Object.keys(inline).some(k => !['on', 'meta', 'desc'].includes(k))) fail('kit.dsl.trait', 'unknown operator trait field');
        if (r.trait?.dsl !== undefined) fail('trait', 'choose trait.dsl or kit.dsl.trait.on');
        delete r.kit.dsl.trait;
      }
      const traits = {};
      for (const which of ['normal', 'elite']) {
        const tr = original.forms?.[which]?.trait ?? original.trait;
        if (tr?.dsl !== undefined && Object.keys(tr).some(k => !['dsl', 'desc', 'text', 'translations'].includes(k))) fail('trait', 'unknown operator trait field');
        if (tr?.text !== undefined && (!object(tr.text) || Object.keys(tr.text).some(k => k !== 'zh') || typeof tr.text.zh !== 'string')) fail('trait.text', 'text must contain only zh');
        const spec = tr?.dsl ?? (inline ? { dsl: 1, ...(r.kit.dsl.budget !== undefined ? { budget: r.kit.dsl.budget } : {}), talents: inline.on, ...(inline.meta ? { meta: inline.meta } : {}) } : null);
        if (!spec) fail('trait.dsl', 'both forms need a trait DSL');
        const desc = tr?.text?.zh ?? tr?.desc ?? inline?.desc;
        if (typeof desc !== 'string' || !desc || desc.length > 8192) fail('trait.desc', 'Chinese trait text required, at most 8192 characters');
        const translations = tr?.translations ?? {};
        if (!object(translations) || Object.entries(translations).some(([k, v]) => !['en', 'ja', 'ko', 'zh-TW'].includes(k) || typeof v !== 'string' || v.length > 8192)) fail('trait.translations', 'supported language to text map required');
        validateTraitSpec(spec, pluginId, out);
        traits[which] = { spec, desc, translations };
        // Operator gameplay traits are distinct from the class trait consumed by generic professions.
        if (r.forms?.[which]?.trait?.dsl !== undefined) delete r.forms[which].trait;
      }
      if (r.trait?.dsl !== undefined) delete r.trait;
      if (!official) {
        const expanded = plain(out, [r], options); if (expanded.problems.length) return expanded; out = expanded.data;
      } else if (r.forms && (Object.keys(r.forms).some(k => !['normal', 'elite'].includes(k)) || Object.values(r.forms).some(f => !object(f) || Object.keys(f).some(k => k !== 'trait')))) fail('forms', 'official forms may only supply trait');
      for (const [which, tr] of Object.entries(traits)) {
        const elite = which === 'elite';
        const id = `garrison_x_${pluginId.replace(/-/g, '_')}_${createHash('sha256').update(r.charId + which).digest('hex').slice(0, 16)}`;
        if (out.garrisons[id]) fail('trait', 'duplicate operator trait', 'PLUGIN_RECORD_EXISTS');
        out.garrisons[id] = { garrisonId: id, effectKey: 'NONE', eventType: tr.spec.meta?.on?.some(e => e.when === 'gain') ? 'SERVER_GAIN' : 'NONE', bb: {}, bbStr: {}, desc: tr.desc, descRaw: tr.desc,
          operatorTrait: { pluginId, charId: r.charId, elite, spec: tr.spec, translations: tr.translations, runtime: operatorTraitRuntimeDigest() } };
        for (const c of Object.values(out.chess)) if (c.charId === r.charId && c.isGolden === elite) {
          // [ASSUMED] Replaces mode garrisons only, never the class/module trait or combat talents.
          c.garrisonIds = [...(overrides.length ? (c.garrisonIds ?? []).filter(gid => out.garrisons[gid]?.operatorTrait) : c.garrisonIds ?? []), id];
        }
      }
    }
    return { data: out, problems: [] };
  } catch (e) { return { data, problems: [e.code ? e : problem('PLUGIN_DSL_SHAPE', 'trait', e.message)] }; }
}

/** Host adapter: the same app-owned runtime as the browser, with its bytes checked against composed data. */
export async function installServerOperatorTraits(data, base) {
  const hash = operatorTraitRuntimeDigest();
  for (const g of Object.values(data.garrisons ?? {})) if (g.operatorTrait && g.operatorTrait.runtime !== hash) {
    throw new Error('PLUGIN_DSL_SHAPE operator trait runtime hash mismatch');
  }
  const { installOperatorTraits } = await import('../../public/js/battle/operatorTraits.js');
  await installOperatorTraits(data, base);
}
