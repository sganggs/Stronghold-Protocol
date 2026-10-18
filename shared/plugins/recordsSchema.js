// Schema source for schemas/records.schema.json; semantic references are checked after composition.
import { GRID_SCHEMA, MODS_SCHEMA, SKILL_SPEC_SCHEMA } from './skillSpec.js';
const str = { type: 'string', minLength: 1 }, obj = { type: 'object' };
const ids = { type: 'array', items: str };
const assetId = { ...str, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' };
export const OPERATOR_ART_SCHEMA = { type: 'object', minProperties: 1, additionalProperties: false,
  // art.ref is an installed character id, the same pattern as art.assets: never a path or a URL.
  properties: { ref: assetId, assets: { type: 'object', minProperties: 1, additionalProperties: false,
    properties: Object.fromEntries(['avatar', 'portrait', 'spine', 'voice', 'skillIcon', 'subProfIcon'].flatMap(k => [[k, assetId], [`${k}Golden`, assetId]])) } } };
export const OPERATOR_ORIGIN_SCHEMA = { type: 'object', minProperties: 1, additionalProperties: false, properties: { chessId: assetId, charId: assetId } };
const form = { type: 'object', required: ['stats', 'rangeGrid'], properties: { stats: obj, rangeGrid: GRID_SCHEMA, skills: { type: 'array' } }, additionalProperties: true };
export const RECORD_SCHEMA = {
  anyOf: [
    { type: 'object', required: ['op', 'charId', 'name', 'profession', 'subProfessionId', 'position', 'rarity', 'as', 'forms', 'skills'],
      additionalProperties: false, properties: {
        op: { enum: [1] }, charId: { ...str, pattern: '^char_x_[A-Za-z0-9_-]+$', maxLength: 64 }, name: str, appellation: str,
        profession: { enum: ['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL'] }, subProfessionId: str, subProfessionName: { type: 'string' },
        position: { enum: ['MELEE', 'RANGED'] }, rarity: { type: 'integer', minimum: 1, maximum: 6 }, as: { enum: ['chess', 'diy', 'both'] },
        forms: { type: 'object', required: ['normal', 'elite'], properties: { normal: form, elite: form }, additionalProperties: false },
        skills: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', required: ['skillId', 'default'], properties: { skillId: str, default: { type: 'boolean' }, skillSpec: SKILL_SPEC_SCHEMA }, additionalProperties: true } },
        chess: { type: 'object', required: ['tier', 'bonds'], properties: { tier: { type: 'integer', minimum: 1, maximum: 6 }, bonds: { ...ids, minItems: 1 },
          hidden: { type: 'boolean' }, ids: { type: 'object', required: ['normal', 'elite'], additionalProperties: false, properties: { normal: str, elite: str } } }, additionalProperties: true },
        kit: { anyOf: [{ enum: ['generic'] }, { type: 'object', required: ['ref'], properties: { ref: str }, additionalProperties: false },
          { type: 'object', required: ['spec'], properties: { spec: { anyOf: [str, SKILL_SPEC_SCHEMA] } }, additionalProperties: false },
          { type: 'object', required: ['dsl'], properties: { dsl: { $ref: 'dsl.schema.json' } }, additionalProperties: false }] },
        talentMods: MODS_SCHEMA, talents: { type: 'array', items: obj }, trait: obj,
        // [ASSUMED] Origin is provenance; art assets are exact manifest ids, not URLs or copied files.
        origin: OPERATOR_ORIGIN_SCHEMA, art: OPERATOR_ART_SCHEMA,
        nationId: { anyOf: [str, { type: 'null' }] }, powers: ids, dmgType: str, attackKind: str, projectile: str, canHitFly: { type: 'boolean' }, targetPriority: str,
      } },
    { type: 'object', required: ['file', 'id'], additionalProperties: false, properties: {
      file: { enum: ['enemies', 'waves', 'stages', 'modes', 'items', 'bands', 'garrisons', 'effects', 'choices', 'tokens'] },
      id: { ...str, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' }, base: str, set: obj, value: obj, special: str,
      kind: { enum: ['bounty', 'tactic'] }, effect: obj,
    } },
  ],
};
export const RECORDS_SCHEMA = { $schema: 'http://json-schema.org/draft-07/schema#', title: 'P1b compact records',
  anyOf: [RECORD_SCHEMA, { type: 'array', items: RECORD_SCHEMA },
    { type: 'object', required: ['records', 'entries'], additionalProperties: false, properties: { records: { enum: [1] }, entries: { type: 'array', items: RECORD_SCHEMA } } }],
};
