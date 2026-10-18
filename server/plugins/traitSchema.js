// Author schemas extend the server-only records schema; legacy /shared bytes stay unchanged.
import fs from 'node:fs';
import { FX_RECORDS_SCHEMA } from './fxRecords.js';
import { TRAIT_EVENTS } from './operatorTraits.js';
import { ELEMENTS } from '../sim/constants.js';
const copy = x => JSON.parse(JSON.stringify(x));
export const OPERATOR_TRAIT_SCHEMA = JSON.parse(fs.readFileSync(new URL('../../schemas/dsl.schema.json', import.meta.url), 'utf8'));
const s = OPERATOR_TRAIT_SCHEMA, d = s.definitions;
s.$id = 'operator-trait.schema.json'; s.title = 'Operator trait DSL';
s.$comment = 'validateTraitSpec additionally checks references, host ownership, expression depth and action nesting.';
for (const k of ['skill', 'skills', 'trait']) delete s.properties[k];
d.trigger.enum.push('elementBurst');
d.condition.enum.push('element', 'targetOnField', 'selfOnField');
Object.assign(d.cond.properties, { element: { enum: [...ELEMENTS] }, targetOnField: { type: 'boolean' }, selfOnField: { type: 'boolean' } });
d.talent.allOf.push({ if: { properties: { when: { not: { const: 'elementBurst' } } } }, then: { properties: { if: {
  not: { anyOf: ['element', 'targetOnField', 'selfOnField'].map(k => ({ required: [k] })) },
} } } });
d.layersBody.required = ['bond', 'amount']; d.layersBody.properties.bond.minLength = 1;
d.layersBody.properties.maxPerBattle = { type: 'integer', minimum: 1, maximum: 1000000 };
d.layersBody.allOf = [{ if: { anyOf: [{ required: ['maxPerBattle'] }, { required: ['bond'], properties: { bond: { const: 'selfActive' } } }] },
  then: { properties: { amount: { type: 'integer', minimum: 1, maximum: 1000000 } } } }];
d.metaTrigger.enum = [...TRAIT_EVENTS]; delete d.meta.properties.key; d.meta.required = ['on'];
d.gainBody.properties.count = { type: 'integer', minimum: 1, maximum: 64 }; d.gainBody.properties.item.minLength = 1;
d.prepLayersBody.required = ['bond', 'amount']; d.prepLayersBody.properties.bond = { type: 'string', minLength: 1, not: { const: 'selfActive' } };

export const TRAIT_RECORDS_SCHEMA = copy(FX_RECORDS_SCHEMA);
const trait = { type: 'object', additionalProperties: false, required: ['dsl'], properties: {
  dsl: { anyOf: [{ type: 'string', minLength: 1 }, { $ref: 'operator-trait.schema.json' }] },
  desc: { type: 'string', minLength: 1, maxLength: 8192 },
  text: { type: 'object', required: ['zh'], additionalProperties: false, properties: { zh: { type: 'string', minLength: 1, maxLength: 8192 } } },
  translations: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['en', 'ja', 'ko', 'zh-TW'].map(k => [k, { type: 'string', maxLength: 8192 }])) },
}, anyOf: [{ required: ['desc'] }, { required: ['text'] }] };
for (const r of [TRAIT_RECORDS_SCHEMA.anyOf[0], TRAIT_RECORDS_SCHEMA.anyOf[1].items, TRAIT_RECORDS_SCHEMA.anyOf[2].properties.entries.items]) {
  const op = r.anyOf[0];
  op.properties.trait = { anyOf: [{ type: 'object', not: { required: ['dsl'] } }, trait] };
  for (const form of Object.values(op.properties.forms.properties)) form.properties.trait = op.properties.trait;
  r.anyOf.push({ type: 'object', additionalProperties: false, required: ['op', 'charId'], properties: {
    op: { const: 1 }, charId: { type: 'string', pattern: '^char_(?!x_)[A-Za-z0-9_]+$' }, trait,
    forms: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['normal', 'elite'].map(k => [k, { type: 'object', required: ['trait'], additionalProperties: false, properties: { trait } }])) },
    overrides: { type: 'array', maxItems: 1, items: { type: 'string', pattern: '^trait:char_(?!x_)[A-Za-z0-9_]+$' } },
  }, anyOf: [{ required: ['trait'] }, { required: ['forms'] }] });
  // Existing skill grammar plus the distinct operator-trait block.
  const kitDsl = op.properties.kit.anyOf.find(x => x.required?.includes('dsl'));
  kitDsl.properties.dsl = { anyOf: [kitDsl.properties.dsl, { type: 'object', additionalProperties: false, required: ['dsl', 'trait'], properties: {
    ...Object.fromEntries(['dsl', 'pluginId', 'budget', 'skill', 'skills', 'talents', 'meta'].map(k => [k, { $ref: 'dsl.schema.json#/properties/' + k }])), trait: { type: 'object', additionalProperties: false, required: ['on', 'desc'], properties: {
      desc: { type: 'string', minLength: 1 }, on: { type: 'array', items: { $ref: 'operator-trait.schema.json#/definitions/talent' } },
      meta: { $ref: 'operator-trait.schema.json#/definitions/meta' },
    } },
  } }] };
}
