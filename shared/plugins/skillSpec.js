// JSON-only subset of SIM.md §7.3. Functions and unknown members are rejected, never evaluated.
import { object, problem, jsonProblems } from './dataUtils.js';
export const MOD_KEYS = 'atkFlat atkPct atkFinal defFlat defPct hpFlat hpPct resFlat aspd batPct blockCnt rangeExtend defIgnoreFlat defIgnorePct resIgnoreFlat resIgnorePct dodgePhys dodgeArts spRecoveryFlat maxTargets taunt hpRegen hpRegenRatio spCostFlat moveFlat massFlat blockRadiusScale atkMul defMul hpMul resMul moveMul dmgDealtMul dmgTakenMul physTakenMul artsTakenMul trueTakenMul elemTakenMul elementalTakenMul healingDealtMul healingTakenMul spRecoveryMul costMul redeployMul atkScaleMul physDealtMul artsDealtMul'.split(' ');
export const FLAG_KEYS = 'stun freeze sleep silence disarm stealth invulnerable unblockable levitate fear cold reveal bind noHeal untargetable blockFly noMove noSp burstLock hidden noBlock tremble hitCount hitCountArts attract float noDisplace isolated camou liftoff selfBound healFree stealthOff groundbind'.split(' ');
const enums = s => ({ enum: s.split(' ') });
const number = { type: 'number', minimum: 0, maximum: 1e9 }, signed = { type: 'number', minimum: -1e9, maximum: 1e9 };
const count = { type: 'integer', minimum: 1, maximum: 100 }; // [ASSUMED] bounded per-attack work, DESIGN §32.5.
const bool = { type: 'boolean' };
const shape = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
// [ASSUMED] Range work bound: 1024 tile offsets, each within ±64 (DESIGN §32.5).
export const GRID_SCHEMA = { type: 'array', maxItems: 1024, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: -64, maximum: 64 } } };
export const MODS_SCHEMA = shape(Object.fromEntries(MOD_KEYS.map(k => [k, signed])));
const flags = shape(Object.fromEntries(FLAG_KEYS.map(k => [k, bool])));
/** The skill trigger rules the engine implements (server/sim/skills.js); tools/bb-audit.mjs lists a version's others. */
export const TRIGGER_RULES = Object.freeze('DEFAULT SKILL_RANGE ACTIVE_RANGE TAKE_DAMAGE SP_FULL ALWAYS CUSTOM_RANGE SEARCH MLYSS_WTRMAN GDGLOW_SKILL_2 AUTO_STOP NEVER MANUAL'.split(' '));
const rule = { enum: [...TRIGGER_RULES] };
export const SKILL_SPEC_SCHEMA = shape({
  kind: enums('duration ammo instant charges passive toggle'), activateOnDeploy: bool,
  duration: number, ammo: count, spCost: number, initSp: number, charges: count, spType: enums('time attack hurt none'),
  trigger: { anyOf: [rule, shape({ rule, grid: GRID_SCHEMA, allies: bool, hpAtMost: { ...number, maximum: 1 }, enemies: bool }, ['rule'])] },
  heal: bool, mods: MODS_SCHEMA, flags,
  targeting: shape({ maxTargets: count, rangeGrid: GRID_SCHEMA, rangeExtend: { type: 'integer', minimum: 0, maximum: 64 },
    priority: enums('default fly ranged lowDef highDef lowestHp highestHp lowestHpRatio highestAtk boss elite notBurst ground heaviest nearest farthest'), allInRange: bool, canHitFly: bool, noRangeExtend: bool, showOwnRange: bool }),
  attack: shape({ dmgType: enums('phys arts true heal elemental'), atkScale: number, healScale: number, splashRadius: number,
    splashScale: number, hits: count, funnelMul: number, funnelBodyHits: count,
    projectile: enums('none beam arrow bolt bomb lob orb drone boomerang'), maxTargets: count, dmgMul: number,
    chain: shape({ count, falloff: { ...number, maximum: 1 }, radius: number, sluggish: number }),
    heal: shape({ mode: enums('single multi chain all'), count, falloff: { ...number, maximum: 1 }, hpAtMost: { ...number, maximum: 1 } }),
    onHitStatus: shape({ key: enums('stun freeze cold sleep slow sluggish bind fragile artsFragile physFragile elemFragile silence fear tremble disarm stealth camou reveal invulnerable levitate groundbind palsy taunt weaken resist'), duration: number, value: signed }, ['key', 'duration']),
  }),
}, ['kind']);

/** Small shared schema interpreter for this JSON subset; the exported schema is also embedded in records.schema.json. */
export function matchesSchema(v, s) {
  if (s.anyOf) return s.anyOf.some(x => matchesSchema(v, x));
  if (s.enum) return s.enum.includes(v);
  if (s.type === 'object') return object(v) && (s.required || []).every(k => Object.hasOwn(v, k))
    && Object.keys(v).length >= (s.minProperties ?? 0)
    && Object.keys(v).every(k => s.properties?.[k] ? matchesSchema(v[k], s.properties[k]) : s.additionalProperties !== false);
  if (s.type === 'array') return Array.isArray(v) && v.length >= (s.minItems || 0) && v.length <= (s.maxItems ?? Infinity) && v.every(x => !s.items || matchesSchema(x, s.items));
  if (s.type === 'number' || s.type === 'integer') return typeof v === 'number' && Number.isFinite(v)
    && (s.type !== 'integer' || Number.isInteger(v)) && v >= (s.minimum ?? -Infinity) && v <= (s.maximum ?? Infinity);
  if (s.type === 'null') return v === null;
  if (s.type === 'string') return typeof v === 'string' && v.length >= (s.minLength ?? 0) && v.length <= (s.maxLength ?? Infinity) && (!s.pattern || new RegExp(s.pattern).test(v));
  return !s.type || typeof v === s.type;
}
export function validateSkillSpec(spec, path = 'skillSpec') {
  const problems = jsonProblems(spec, path);
  if (!matchesSchema(spec, SKILL_SPEC_SCHEMA)) problems.push(problem('PLUGIN_SKILL_SPEC', path, 'unknown, missing or ill-typed JSON SkillSpec field (SIM §7.3)'));
  return problems;
}
