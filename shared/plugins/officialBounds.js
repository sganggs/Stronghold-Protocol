// (i18n-ignore-file: author-facing PLUGIN_DATA_BOUND text stays Chinese until the integrator merges the code; not player UI)
// Official absolute maxima for plugin blackboard values and the few non-blackboard fields that drive loops
// (DESIGN §32.5). Official data is immutable, so the table is cached by object identity. The battle reads the
// same cache; a direct kit built before getData() falls back to PLUGIN_BOUND_FLOOR, which still sits at or
// above every official input of the clamped loops. [ASSUMED] factor 10 and floor 64.
// Minima of step keys and maxima of description-text counts live in the same cache. A content set ships the
// snapshot (`bounds`) so a worker or a page that never calls getData() installs the same numbers.

import { PLUGIN_ACTION_UNITS, PLUGIN_OFFER_SLOTS, dataBound, isStepKey } from './limits.js';
import { TEXT_COUNT_PATTERNS } from './textPatterns.js';
import { createTextFiniteReader } from './textNumber.js';

const STEP_TICK = 1 / 30;

/**
 * Tables walked for both the maximum and the check. choices, garrisons and tokens are included so a higher
 * official value is not missed; that only loosens a cap. [ASSUMED]
 */
export const BOUND_TABLES = Object.freeze([
  'chess', 'backups', 'enemies', 'bands', 'bonds', 'effects', 'items', 'waves', 'choices', 'garrisons', 'tokens',
]);

/** Skill fields that schedule charges or repeats. Durations and cooldowns are not in this list. */
const SKILL_FIELDS = Object.freeze(['spCost', 'initSp', 'maxChargeTime', 'increment', 'charges', 'maxCharges']);
const ENEMY_SP_FIELDS = Object.freeze(['maxSp', 'initSp', 'increment']);

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @type {object|null} */
let cachedSource = null;
/**
 * @type {{ bb: Map<string, number>, fields: Map<string, number>, bbMin: Map<string, number>,
 *   fieldMin: Map<string, number>, text: Map<string, number> }|null}
 */
let cached = null;

function bump(map, key, abs) {
  const prev = map.get(key);
  if (prev == null || abs > prev) map.set(key, abs);
}

function bumpMin(map, key, value) {
  if (!(value > 0)) return;
  const prev = map.get(key);
  if (prev == null || value < prev) map.set(key, value);
}

function emitBb(bb, path, fn) {
  if (Array.isArray(bb)) {
    bb.forEach((row, i) => {
      if (isPlain(row) && typeof row.key === 'string' && typeof row.value === 'number' && Number.isFinite(row.value)) {
        fn({ kind: 'bb', key: row.key, value: row.value, path: `${path}[${i}].value` });
      }
    });
    return;
  }
  if (!isPlain(bb)) return;
  for (const [k, v] of Object.entries(bb)) {
    if (typeof v === 'number' && Number.isFinite(v)) fn({ kind: 'bb', key: k, value: v, path: `${path}.${k}` });
    else if (v && typeof v === 'object') emitBb(v, `${path}.${k}`, fn);
  }
}

function isSkill(node) {
  return typeof node.skillId === 'string' || typeof node.prefabKey === 'string' || typeof node.skillType === 'string';
}

function isEnemySp(node, table) {
  return isPlain(node.sp) && (table === 'enemies' || table === 'waves') && (isPlain(node.stats) || table === 'waves');
}

function visit(node, table, path, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => visit(v, table, `${path}[${i}]`, fn));
    return;
  }
  if (node.bb && typeof node.bb === 'object') emitBb(node.bb, `${path}.bb`, fn);
  if (Array.isArray(node.blackboard)) emitBb(node.blackboard, `${path}.blackboard`, fn);
  if (isSkill(node)) {
    for (const k of SKILL_FIELDS) {
      const v = node[k];
      if (typeof v === 'number' && Number.isFinite(v)) fn({ kind: 'field', field: `skill.${k}`, value: v, path: `${path}.${k}` });
    }
  }
  if (isEnemySp(node, table)) {
    for (const k of ENEMY_SP_FIELDS) {
      const v = node.sp[k];
      if (typeof v === 'number' && Number.isFinite(v)) fn({ kind: 'field', field: `enemy.sp.${k}`, value: v, path: `${path}.sp.${k}` });
    }
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'bb' || k === 'blackboard' || k === 'sp') continue;
    if (v && typeof v === 'object') visit(v, table, `${path}.${k}`, fn);
  }
}

function scanText(data) {
  const text = new Map();
  // Each scan has a fixed phrase table; reuse its private patterns for all description strings.
  const readers = TEXT_COUNT_PATTERNS.map(p => ({ id: p.id, read: createTextFiniteReader(p.re) }));
  const walk = (node) => {
    if (typeof node === 'string') {
      for (const p of readers) {
        const n = p.read(node, NaN);
        if (Number.isFinite(n) && n >= 0) bump(text, p.id, n);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    for (const v of Object.values(node)) walk(v);
  };
  for (const table of BOUND_TABLES) walk(data?.[table]);
  return text;
}

function scan(data) {
  const bb = new Map();
  const fields = new Map();
  const bbMin = new Map();
  const fieldMin = new Map();
  for (const table of BOUND_TABLES) {
    visit(data?.[table], table, table, (ev) => {
      if (ev.kind === 'bb') {
        bump(bb, ev.key, Math.abs(ev.value));
        bumpMin(bbMin, ev.key, ev.value);
      } else {
        bump(fields, ev.field, Math.abs(ev.value));
        bumpMin(fieldMin, ev.field, ev.value);
      }
    });
  }
  return { bb, fields, bbMin, fieldMin, text: scanText(data) };
}

function emptyBounds() {
  return { bb: new Map(), fields: new Map(), bbMin: new Map(), fieldMin: new Map(), text: new Map() };
}

function mapOf(obj) {
  const out = new Map();
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out.set(k, v);
  }
  return out;
}

function objOf(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Cache official maxima for `data`. The same object is not scanned again. A different object replaces the cache.
 * @param {object} data vanilla tables (getData() or the content set's base)
 */
export function rememberOfficialBounds(data) {
  if (!data || typeof data !== 'object') {
    cachedSource = null;
    cached = emptyBounds();
    return cached;
  }
  if (cachedSource === data && cached) return cached;
  cached = scan(data);
  cachedSource = data;
  return cached;
}

/** Drop the cache (server/data.js resetData). The next read uses the floor until remember or install runs again. */
export function forgetOfficialBounds() {
  cachedSource = null;
  cached = null;
}

/** True after rememberOfficialBounds or installOfficialBounds. An empty cache is not installed. */
export function officialBoundsReady() {
  return cached != null;
}

/**
 * Plain snapshot of a bounds cache. Sorted keys, so the served file is stable.
 * @param {{ bb: Map<string, number>, fields: Map<string, number>, bbMin: Map<string, number>,
 *   fieldMin: Map<string, number>, text: Map<string, number> }} bounds
 */
export function exportOfficialBounds(bounds) {
  const src = bounds && bounds.bb ? bounds : emptyBounds();
  return {
    v: 1,
    bb: objOf(src.bb),
    fields: objOf(src.fields),
    bbMin: objOf(src.bbMin),
    fieldMin: objOf(src.fieldMin),
    text: objOf(src.text),
  };
}

/**
 * The snapshot of `data`'s official maxima (exportOfficialBounds of a fresh scan) — an official version's own bounds
 * (DESIGN §35.23: its match host and its pages install them). Never reads or fills the cache.
 * @param {object} data
 */
export function officialBoundsOf(data) {
  return exportOfficialBounds(scan(data));
}

/**
 * Install a snapshot computed from vanilla data. Does not scan `data` (a plugin must not raise its own cap).
 * @param {object} snapshot exportOfficialBounds result
 */
export function installOfficialBounds(snapshot) {
  if (!snapshot || snapshot.v !== 1) {
    cachedSource = null;
    cached = emptyBounds();
    return cached;
  }
  cached = {
    bb: mapOf(snapshot.bb),
    fields: mapOf(snapshot.fields),
    bbMin: mapOf(snapshot.bbMin),
    fieldMin: mapOf(snapshot.fieldMin),
    text: mapOf(snapshot.text),
  };
  cachedSource = null;
  return cached;
}

/** Install `set.bounds` when a content set is in hand. A set without the snapshot leaves the cache alone. */
export function applyContentBounds(set) {
  if (set && set.bounds && set.bounds.v === 1) return installOfficialBounds(set.bounds);
  return current();
}

function current() {
  return cached;
}

/** Official absolute maximum of a blackboard key, or null when the cached tables never use it. */
export function officialBbMax(key) {
  const map = current()?.bb;
  return map && map.has(key) ? map.get(key) : null;
}

/** Official absolute maximum of a loop field (`enemy.sp.maxSp`, `skill.spCost`, …), or null. */
export function officialFieldMax(name) {
  const map = current()?.fields;
  return map && map.has(name) ? map.get(name) : null;
}

/** Runtime cap for a blackboard key. Call at use time: the cache may be filled after import. */
export function bbCap(key) {
  return dataBound(officialBbMax(key));
}

/** Runtime cap for a documented loop field. */
export function fieldCap(name) {
  return dataBound(officialFieldMax(name));
}

/** Official maximum of a description-text count pattern, or null when vanilla text never matches it. */
export function officialTextMax(patternId) {
  const map = current()?.text;
  return map && map.has(patternId) ? map.get(patternId) : null;
}

/**
 * Smallest positive official value of a blackboard key, else of a loop field, else 0.
 * Step floors use this so an official interval below one tick is not raised.
 */
export function officialPositiveMin(key) {
  const c = current();
  if (!c || typeof key !== 'string') return 0;
  if (c.bbMin && c.bbMin.has(key)) return c.bbMin.get(key);
  if (c.fieldMin && c.fieldMin.has(key)) return c.fieldMin.get(key);
  return 0;
}

function boundMessage(label, key, value, cap, known, officialMax) {
  const tail = known ? `原版最大 ${officialMax}` : '原版没有这个键';
  return `${label} ${key} 的值 ${value} 超过上限 ${cap}（${tail}）`;
}

/** Editor and admission bounds for one blackboard key, from the same official snapshot. */
export function officialBbRange(key) {
  const max = officialBbMax(key);
  return { max: dataBound(max), min: -dataBound(max), officialMax: max ?? 0,
    positiveMin: isStepKey(key) ? minimumStep(officialPositiveMin(key)) : 0 };
}
const minimumStep = officialMin => officialMin > 0 ? officialMin / 10 : STEP_TICK / 10;

function exceed(bad, ev, map, minMap, label, key) {
  const known = map.has(key);
  const officialMax = known ? map.get(key) : null;
  const cap = dataBound(known ? officialMax : null);
  if (Math.abs(ev.value) > cap) bad(ev.path, boundMessage(label, key, ev.value, cap, known, officialMax), 'PLUGIN_DATA_BOUND');
  if (!(ev.value > 0) || !isStepKey(key)) return;
  const officialMin = minMap && minMap.has(key) ? minMap.get(key) : 0;
  const tenth = minimumStep(officialMin);
  if (ev.value < tenth) {
    const tail = officialMin > 0 ? `原版最小正值 ${officialMin}` : '原版没有这个键的正值';
    bad(ev.path, `${label} ${key} 的值 ${ev.value} 低于最小步长 ${tenth}（${tail}）`, 'PLUGIN_DATA_BOUND');
  }
}

/**
 * Report PLUGIN_DATA_BOUND for numeric blackboard values and the documented loop fields.
 * Maxima come from `vanilla`, never from `data` (a bomb must not raise its own cap).
 * @param {object} data composed tables
 * @param {object} vanilla official tables
 * @param {(path: string, message: string, code?: string) => void} bad
 */
export function appendOfficialBounds(data, vanilla, bad) {
  const bounds = rememberOfficialBounds(vanilla);
  for (const table of BOUND_TABLES) {
    visit(data?.[table], table, table, (ev) => {
      if (ev.kind === 'bb') exceed(bad, ev, bounds.bb, bounds.bbMin, '黑板', ev.key);
      else exceed(bad, ev, bounds.fields, bounds.fieldMin, '字段', ev.field);
    });
  }
  appendFactionBounds(data, vanilla, bad);
  appendConfigBounds(data, bad);
}

/**
 * The numbers of `config` the game reads as counts (DESIGN §32.5): the pick-one offer's count — at most the slots
 * an offer shows (PLUGIN_OFFER_SLOTS, the game data's own cap), a positive whole number.
 * @param {object} data @param {(path: string, message: string, code?: string) => void} bad
 */
function appendConfigBounds(data, bad) {
  const offer = data?.config?.economy?.rewardOffer;
  if (!isPlain(offer) || offer.count === undefined) return;
  const v = offer.count;
  if (!Number.isInteger(v) || v < 1 || v > PLUGIN_OFFER_SLOTS) {
    bad('config.economy.rewardOffer.count', `字段 config.economy.rewardOffer.count 的值 ${v} 不是 1 到 ${PLUGIN_OFFER_SLOTS} 的整数（一次招募最多显示 ${PLUGIN_OFFER_SLOTS} 个）`, 'PLUGIN_DATA_BOUND');
  }
}

/**
 * The numbers of `factions` the wave generator reads as counts and weights (server/match/waves.js): every number of
 * `generation` (maxLevelCnt, specialEnemyNum, the typeSlots, the replaced counts, beFactors …), each type's count and
 * weight, each entry's weight — the same rule, from the official `factions` (integration note 11, DESIGN §32.5). The
 * replaced counts also stay within PLUGIN_ACTION_UNITS, the generator's own clamp. A value that is not a finite number
 * is out of bounds too (a patch can write 1e400).
 * @param {object} data @param {object} vanilla @param {(path: string, message: string, code?: string) => void} bad
 */
function appendFactionBounds(data, vanilla, bad) {
  const f = data?.factions;
  if (!isPlain(f)) return;
  const v = isPlain(vanilla?.factions) ? vanilla.factions : {};
  const maxOf = (values) => {
    let m = null;
    for (const x of values) if (typeof x === 'number' && Number.isFinite(x)) m = Math.max(m ?? 0, Math.abs(x));
    return m;
  };
  const check = (path, key, value, official, hard = Infinity) => {
    if (typeof value !== 'number') return;
    const cap = Math.min(dataBound(official), hard);
    if (!Number.isFinite(value) || Math.abs(value) > cap) bad(path, boundMessage('字段', key, value, cap, official != null, official), 'PLUGIN_DATA_BOUND');
  };
  const g = isPlain(f.generation) ? f.generation : {};
  const vg = isPlain(v.generation) ? v.generation : {};
  for (const [k, val] of Object.entries(g)) {
    if (isPlain(val)) {
      const official = maxOf(Object.values(isPlain(vg[k]) ? vg[k] : {}));
      for (const [sub, n] of Object.entries(val)) check(`factions.generation.${k}.${sub}`, `factions.generation.${k}`, n, official);
      continue;
    }
    const hard = k === 'minReplacedEnemyCount' || k === 'maxReplacedEnemyCount' ? PLUGIN_ACTION_UNITS : Infinity;
    check(`factions.generation.${k}`, `factions.generation.${k}`, val, maxOf([vg[k]]), hard);
  }
  const vTypes = Object.values(isPlain(v.types) ? v.types : {}).filter(isPlain);
  const vEntries = Object.values(isPlain(v.entries) ? v.entries : {}).filter(isPlain);
  for (const field of ['count', 'weight']) {
    const official = maxOf(vTypes.map((t) => t[field]));
    for (const [id, t] of Object.entries(isPlain(f.types) ? f.types : {})) if (isPlain(t)) check(`factions.types.${id}.${field}`, `factions.types.${field}`, t[field], official);
  }
  const officialWeight = maxOf(vEntries.map((e) => e.weight));
  for (const [id, e] of Object.entries(isPlain(f.entries) ? f.entries : {})) if (isPlain(e)) check(`factions.entries.${id}.weight`, 'factions.entries.weight', e.weight, officialWeight);
}
