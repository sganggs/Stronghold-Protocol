#!/usr/bin/env node
// tools/bb-audit.mjs — blackboard audit of another official version's data against the default (versions M0,
// DESIGN §35.22.5, docs/SIM.md §7.2).
//
// The hand-written content reads blackboard fields with a default for a missing one (`num(bb.no_attack_duration, 10)`).
// When another version's record lacks a field the default data has, that default — the 下半 meaning — silently applies
// (上半's 突袭 has no no_attack_duration, so its members would gain 下半's "10 s without attacking" trigger). This tool
// lists, per version directory:
//   * gaps: a field present in the base data and missing in the version, for the same behaviour key — bonds by bondId,
//     bands by bandId, items by the normal record's effectId (item ids are reused for other effects), garrisons by
//     (effectKey, bbStr.key) (garrison ids are season-local), effects by effectId; per buff (bbStr.key || key). Only the
//     gaps the code reads are reported, each with the code's reads; a read whose default is not neutral (0, null,
//     undefined, false, '' or Infinity) is flagged.
//   * code-named buff keys absent in the version: a buff key the code names (string literals, BY_BUFF / K.* / object
//     keys) that the base data has and the version lacks — its behaviour then never runs there.
//   * unknown trigger rules: a skill trigger rule of the version's chess / backups / tokens records that the engine does
//     not implement (shared/plugins/skillSpec.js TRIGGER_RULES) — 上半's 斩业星熊 S3 uses AUTO_STOP.
//   * version-only keys no code names: a buff key / bbStr.key (bands, bonds, items, effects) or a garrison effectType /
//     effectKey / battleRuneKey / bbStr.key the version carries, the base data lacks and no code under server/ or
//     shared/ names (kits included) — a mechanic that is silently inert there (garrisons/meta.js runs H[effectType] and
//     garrisons/battle.js INSTALLERS[key] only when a handler exists). The by-id comparisons above never see these: 上半's
//     煌 SERVER_GAIN_CHAR, the 标准模拟 clause act1autochess_band31_buff on bands 下半 also has.
//   * version-only fields: a field the version carries and the base lacks, for the same behaviour key and buff (the
//     gaps the other way round), with the code's reads of that name. A neutral default for a field the version lacks is
//     harmless only when the version lacks the mechanic: 上半's 维多利亚 6-member clause carries power_atk where 下半 has
//     atk_normal_equip / atk_golden_equip (read with default 0), so the gap looks neutral and the clause is inert. Not
//     filtered by the reads: a field name the code reads elsewhere (silence, power_atk) is no proof its handler reads it.
// Not seen by any class: a record whose text changed under the same keys and blackboard fields (下半 V2_1's 陈
// 以己之长 reaches 高台 operators only, the code every operator as in V2_2); DESIGN §35.22.5 lists those by hand.
// Code reads: server/sim/content/**/*.js (but the operator kits, which read skill blackboards) and server/match/**/*.js
// — `num|int|numOr(<expr>.<field>, <default>)`, `<expr>.<field> ?? <default>`, and plain mentions (`.field`,
// `'field'`, no default). Field names are matched by name, so a read of the same name in another table is listed too.
// Buff keys also come from server/ai/**/*.js and shared/*.js.
//
// Usage: node tools/bb-audit.mjs [--base data] --data <dir> [--data <dir>…] [--json] [--strict]
//   --base    the reference data directory (default: data/)
//   --data    a version's data directory (repeatable; omitted: all historical versions)
//   --json    machine-readable report on stdout: [{ dir, findings: [...], missingBuffKeys: [...], unknownTriggerRules: [...],
//             versionOnlyKeys: [...], versionOnlyFields: [...] }]
//   --strict  exit code 1 when any finding, missing buff key, unknown trigger rule, version-only key or version-only
//             field is listed (M2: every one reviewed)
// Unknown options are errors (exit code 2).

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadData } from '../server/data.js';
import { VERSIONS } from '../shared/versions.js';
import { TRIGGER_RULES } from '../shared/plugins/skillSpec.js';
import { maskComments } from './check-imports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/bb-audit.mjs [--base data] --data <dir> [--data <dir>…] [--json] [--strict]';
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });

/** Directories whose code reads blackboards (relative to the repo), and the parts skipped. */
export const READ_DIRS = Object.freeze(['server/sim/content', 'server/match']);
const SKIP = [/^server\/sim\/content\/kits\//];
/** Further directories scanned for buff keys only. */
export const KEY_DIRS = Object.freeze(['server/ai', 'shared']);
/** Directories scanned (nothing skipped) for the names of version-only keys. */
export const NAME_DIRS = Object.freeze(['server', 'shared']);

const IDENT = '[A-Za-z_][A-Za-z0-9_@]*';
const FIELD = `(?:\\.(${IDENT})|\\[['"]([^'"\\]]+)['"]\\])`;
const CALL_RE = new RegExp(`\\b(?:num|int|numOr)\\(\\s*[A-Za-z_$][\\w$.?\\[\\]'"]*?${FIELD}\\s*,\\s*([^,()]+?)\\s*\\)`, 'g');
const NULLISH_RE = new RegExp(`${FIELD}\\s*\\?\\?\\s*([^,;)\\]}?:]+)`, 'g');
const MENTION_RE = /\.([a-z][a-z0-9_@]*)\b|'([a-z][a-z0-9_@]*)'/g;
const KEY_RE = /['"`]([A-Za-z][A-Za-z0-9_]*(?:\[[a-z0-9_]+\])?)['"`]|\bK\.([A-Za-z0-9_]+)|^\s+([a-z][a-z0-9_]+)\s*[(:]|\.([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/g;

/** Every `.js` file under `dir` (recursive, sorted), as paths relative to `root`. */
function jsFiles(root, dir) {
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && e.name.endsWith('.js')) out.push(r);
    }
  };
  walk(dir);
  return out;
}

/** The repo's sources: [{ file, text }] of `dirs` (comments masked, line numbers kept). */
export function repoSources(root = ROOT, dirs = READ_DIRS, skip = SKIP) {
  return dirs.flatMap((d) => jsFiles(root, d)).filter((f) => !skip.some((re) => re.test(f)))
    .map((file) => ({ file, text: maskComments(readFileSync(path.join(root, file), 'utf8')) }));
}

/** A default's source text → its value (a literal), or the text itself (an expression). */
export function parseDefault(text) {
  if (text === undefined) return undefined;
  const t = String(text).trim();
  if (t === 'null') return null;
  if (t === 'undefined') return undefined;
  if (t === 'false') return false;
  if (t === 'true') return true;
  if (t === "''" || t === '""') return '';
  if (t === 'Infinity') return Infinity;
  if (t === '-Infinity') return -Infinity;
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?$/i.test(t)) return Number(t);
  return t;
}

/** Whether a missing field read with this default changes nothing (0, null, undefined, false, '' or Infinity). */
export const isNeutral = (d) => d === 0 || d === null || d === undefined || d === false || d === '' || d === Infinity;

/**
 * Blackboard field reads of `sources` ([{ file, text }], default: the repo): Map field → [{ default, file, line }]
 * (a plain mention has `default: undefined`; one entry per field and line, the read with a default first).
 */
export function codeReads(sources = repoSources()) {
  const out = new Map();
  const add = (field, def, file, line) => {
    if (!field) return;
    let list = out.get(field);
    if (!list) { list = []; out.set(field, list); }
    const same = list.find((r) => r.file === file && r.line === line);
    if (same) { if (same.default === undefined && def !== undefined) same.default = def; return; }
    list.push({ default: def, file, line });
  };
  for (const { file, text } of sources) {
    const lines = String(text).split('\n');
    lines.forEach((src, i) => {
      const line = i + 1;
      for (const m of src.matchAll(CALL_RE)) add(m[1] ?? m[2], parseDefault(m[3]), file, line);
      for (const m of src.matchAll(NULLISH_RE)) add(m[1] ?? m[2], parseDefault(m[3]), file, line);
      for (const m of src.matchAll(MENTION_RE)) add(m[1] ?? m[2], undefined, file, line);
    });
  }
  return out;
}

/**
 * Buff keys the code names: Map key → [{ file, line }] (string literals, `K.<key>`, object keys at a line start,
 * `<expr>.<UPPER_KEY>` such as garrisons/meta.js `H.SERVER_ADD_BOND`).
 */
export function codeBuffKeys(sources = repoSources(ROOT, [...READ_DIRS, ...KEY_DIRS])) {
  const out = new Map();
  for (const { file, text } of sources) {
    String(text).split('\n').forEach((src, i) => {
      for (const m of src.matchAll(KEY_RE)) {
        const key = m[1] ?? m[2] ?? m[3] ?? m[4];
        if (!key) continue;
        let list = out.get(key);
        if (!list) { list = []; out.set(key, list); }
        if (!list.some((r) => r.file === file && r.line === i + 1)) list.push({ file, line: i + 1 });
      }
    });
  }
  return out;
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const buffFields = (b) => Object.keys({ ...obj(b?.bb), ...obj(b?.bbStr) }).filter((k) => k !== 'key');
const buffId = (b) => (typeof b?.bbStr?.key === 'string' && b.bbStr.key) || b?.key || null;

/** `{ [buffId]: Set(field) }` of a record's buffs (fields of buffs sharing an id are merged). */
function buffsOfRecord(rec) {
  const out = {};
  for (const b of Array.isArray(rec?.buffs) ? rec.buffs : []) {
    const id = buffId(b);
    if (!id) continue;
    (out[id] ??= new Set());
    for (const f of buffFields(b)) out[id].add(f);
  }
  return out;
}

/** Whether an item record is an official normal one (not golden, not a plugin's, no effectRef). */
const officialNormalItem = (id, rec) => !!rec && rec.effectRef == null && !String(id).startsWith('item_x_') && (!rec.baseId || rec.baseId === id);

/**
 * Behaviour key → { buffId → Set(field) } per table of `data`: bonds by bondId, bands by bandId, items by the normal
 * record's effectId, garrisons by `effectKey|bbStr.key` (the record's own bb / bbStr; buff id = battleRuneKey ||
 * effectKey), effects by effectId.
 */
export function behaviourFields(data) {
  const d = obj(data);
  const out = { bonds: {}, bands: {}, items: {}, garrisons: {}, effects: {} };
  const merge = (table, key, buffs) => {
    const t = (out[table][key] ??= {});
    for (const [id, set] of Object.entries(buffs)) {
      t[id] ??= new Set();
      for (const f of set) t[id].add(f);
    }
  };
  for (const [id, rec] of Object.entries(obj(d.bonds))) merge('bonds', id, buffsOfRecord(rec));
  for (const [id, rec] of Object.entries(obj(d.bands))) merge('bands', id, buffsOfRecord(rec));
  for (const [id, rec] of Object.entries(obj(d.items))) {
    if (officialNormalItem(id, rec) && typeof rec.effectId === 'string') merge('items', rec.effectId, buffsOfRecord(rec));
  }
  for (const rec of Object.values(obj(d.garrisons))) {
    if (!rec || typeof rec.effectKey !== 'string') continue;
    const key = `${rec.effectKey}|${typeof rec.bbStr?.key === 'string' ? rec.bbStr.key : ''}`;
    merge('garrisons', key, { [rec.battleRuneKey || rec.effectKey]: new Set(buffFields(rec)) });
  }
  for (const [id, rec] of Object.entries(obj(d.effects))) merge('effects', id, buffsOfRecord(rec));
  return out;
}

/**
 * Fields the base data has and the version lacks, for the same behaviour key and buff:
 * [{ table, key, buff, field }] (sorted). A behaviour or buff the version lacks entirely is not a field gap.
 */
export function gaps(base, version) {
  const a = behaviourFields(base), b = behaviourFields(version);
  const out = [];
  for (const table of Object.keys(a)) {
    for (const [key, buffs] of Object.entries(a[table])) {
      const vb = b[table][key];
      if (!vb) continue;
      for (const [buff, fields] of Object.entries(buffs)) {
        const vf = vb[buff];
        if (!vf) continue;
        for (const field of fields) if (!vf.has(field)) out.push({ table, key, buff, field });
      }
    }
  }
  return out.sort((x, y) => `${x.table}|${x.key}|${x.buff}|${x.field}`.localeCompare(`${y.table}|${y.key}|${y.buff}|${y.field}`));
}

/** Every buff key of `data` (buff keys and bbStr.key of every record, garrison effectKey / battleRuneKey). */
export function dataBuffKeys(data) {
  const d = obj(data);
  const out = new Set();
  for (const table of ['bonds', 'bands', 'items', 'effects']) {
    for (const rec of Object.values(obj(d[table]))) {
      for (const b of Array.isArray(rec?.buffs) ? rec.buffs : []) {
        if (typeof b?.key === 'string') out.add(b.key);
        if (typeof b?.bbStr?.key === 'string') out.add(b.bbStr.key);
      }
    }
  }
  for (const g of Object.values(obj(d.garrisons))) {
    for (const k of [g?.effectKey, g?.battleRuneKey, g?.bbStr?.key]) if (typeof k === 'string' && k) out.add(k);
  }
  return out;
}

/**
 * Every behaviour key of `data` with the records carrying it: Map key → [{ table, id }] (sorted) — the buff key and
 * bbStr.key of every band, bond, item and effect buff, and each garrison's effectType, effectKey, battleRuneKey and
 * bbStr.key.
 */
export function dataKeyRecords(data) {
  const d = obj(data);
  const out = new Map();
  const add = (key, table, id) => {
    if (typeof key !== 'string' || !key) return;
    let list = out.get(key);
    if (!list) { list = []; out.set(key, list); }
    if (!list.some((r) => r.table === table && r.id === id)) list.push({ table, id });
  };
  for (const table of ['bands', 'bonds', 'items', 'effects']) {
    for (const [id, rec] of Object.entries(obj(d[table]))) {
      for (const b of Array.isArray(rec?.buffs) ? rec.buffs : []) { add(b?.key, table, id); add(b?.bbStr?.key, table, id); }
    }
  }
  for (const [id, g] of Object.entries(obj(d.garrisons))) {
    for (const k of [g?.effectType, g?.effectKey, g?.battleRuneKey, g?.bbStr?.key]) add(k, 'garrisons', id);
  }
  for (const list of out.values()) list.sort((x, y) => `${x.table}|${x.id}`.localeCompare(`${y.table}|${y.id}`));
  return out;
}

/**
 * Keys the version carries that the base data lacks and `named` (a Map / Set of the keys the code names) does not hold:
 * [{ key, records: [{ table, id }] }] sorted by key.
 */
export function versionOnlyKeys(base, version, named) {
  const inBase = dataKeyRecords(base);
  const out = [];
  for (const [key, records] of dataKeyRecords(version)) {
    if (!inBase.has(key) && !named.has(key)) out.push({ key, records });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

/**
 * Fields the version carries and the base lacks, for the same behaviour key and buff (gaps the other way round), each
 * with the code's reads of that field name (`reads`, possibly none): [{ table, key, buff, field, reads }] (sorted).
 */
export function versionOnlyFields(base, version, reads = codeReads()) {
  return gaps(version, base).map((g) => ({ ...g, reads: reads.get(g.field) ?? [] }));
}

/** The data files whose records carry skills with a `trigger` (chess, backup forms, tokens). */
const SKILL_TABLES = Object.freeze(['chess', 'backups', 'tokens']);

/**
 * Skill trigger rules of `data` outside `known` (default: the engine's TRIGGER_RULES): [{ rule, table, skillId,
 * owners }] sorted, one entry per rule, table and skill; `owners` = the records that carry it (the record id, for
 * backups the unit / token id under its group).
 */
export function unknownTriggerRules(data, known = TRIGGER_RULES) {
  const ok = new Set(known);
  const found = new Map();
  const walk = (v, table, owner, skillId) => {
    if (Array.isArray(v)) { for (const x of v) walk(x, table, owner, skillId); return; }
    if (!v || typeof v !== 'object') return;
    const sid = typeof v.skillId === 'string' ? v.skillId : skillId;
    const rule = v.trigger && typeof v.trigger === 'object' ? v.trigger.rule : null;
    if (typeof rule === 'string' && !ok.has(rule)) {
      const k = `${rule}|${table}|${sid ?? ''}`;
      if (!found.has(k)) found.set(k, { rule, table, skillId: sid ?? null, owners: new Set() });
      found.get(k).owners.add(owner);
    }
    for (const x of Object.values(v)) walk(x, table, owner, sid);
  };
  const d = obj(data);
  for (const table of SKILL_TABLES) {
    for (const [id, rec] of Object.entries(obj(d[table]))) {
      if (table === 'backups') { for (const [sub, r] of Object.entries(obj(rec))) walk(r, table, sub, null); }
      else walk(rec, table, id, null);
    }
  }
  return [...found.values()].map((f) => ({ ...f, owners: [...f.owners].sort() }))
    .sort((x, y) => `${x.rule}|${x.table}|${x.skillId}`.localeCompare(`${y.rule}|${y.table}|${y.skillId}`));
}

/**
 * The audit of one version against the base: `findings` = the gaps the code reads ([{ table, key, buff, field, reads,
 * nonNeutral }]), `missingBuffKeys` = the code-named buff keys of the base the version lacks ([{ key, refs }]),
 * `unknownTriggerRules` = the version's trigger rules the engine does not implement (unknownTriggerRules),
 * `versionOnlyKeys` = the version's keys the base lacks and no code names (versionOnlyKeys; only with `names`, the
 * codeBuffKeys of NAME_DIRS), `versionOnlyFields` = the version's fields the base lacks under a shared key and buff
 * (versionOnlyFields).
 */
export function audit(base, version, { reads = codeReads(), keys = null, names = null } = {}) {
  const findings = [];
  for (const g of gaps(base, version)) {
    const r = reads.get(g.field);
    if (!r || !r.length) continue;
    findings.push({ ...g, reads: r, nonNeutral: r.some((x) => !isNeutral(x.default)) });
  }
  const missingBuffKeys = [];
  if (keys) {
    const inBase = dataBuffKeys(base), inVersion = dataBuffKeys(version);
    for (const [key, refs] of [...keys].sort(([x], [y]) => x.localeCompare(y))) {
      if (inBase.has(key) && !inVersion.has(key)) missingBuffKeys.push({ key, refs });
    }
  }
  return {
    findings, missingBuffKeys, unknownTriggerRules: unknownTriggerRules(version),
    versionOnlyKeys: names ? versionOnlyKeys(base, version, names) : [],
    versionOnlyFields: versionOnlyFields(base, version, reads),
  };
}

function parseArgs(argv) {
  const o = { base: path.join(ROOT, 'data'), data: [], json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base' && argv[i + 1]) o.base = path.resolve(argv[++i]);
    else if (a === '--data' && argv[i + 1]) o.data.push(path.resolve(argv[++i]));
    else if (a === '--json') o.json = true;
    else if (a === '--strict') o.strict = true;
    else return { error: `unknown option ${a}` };
  }
  if (!o.data.length) o.data = VERSIONS.filter((v) => v.dir).map((v) => path.join(ROOT, 'data', v.dir));
  return o;
}

const fmtDefault = (d) => (typeof d === 'string' ? d : String(d));
const fmtRead = (r) => `${r.file}:${r.line}${r.default === undefined ? '' : ` (default ${fmtDefault(r.default)})`}`;

function main(argv) {
  const o = parseArgs(argv);
  if (o.error) { console.error(`${o.error}\n${USAGE}`); return 2; }
  for (const d of [o.base, ...o.data]) {
    try { if (!statSync(d).isDirectory()) throw new Error(); } catch { console.error(`not a directory: ${d}`); return 2; }
  }
  const base = loadData(o.base, { log: QUIET });
  const reads = codeReads();
  const keys = codeBuffKeys();
  const names = codeBuffKeys(repoSources(ROOT, NAME_DIRS, []));
  const reports = o.data.map((dir) => ({ dir: path.relative(ROOT, dir) || dir, ...audit(base, loadData(dir, { log: QUIET }), { reads, keys, names }) }));
  if (o.json) console.log(JSON.stringify(reports, (k, v) => (v === Infinity ? 'Infinity' : v), 2));
  else {
    for (const r of reports) {
      const flagged = r.findings.filter((f) => f.nonNeutral).length;
      console.log(`${r.dir}: ${r.findings.length} field gap(s) the code reads (${flagged} with a non-neutral default), ${r.missingBuffKeys.length} code-named buff key(s) absent, ${r.unknownTriggerRules.length} unknown trigger rule(s), ${r.versionOnlyKeys.length} version-only key(s) no code names, ${r.versionOnlyFields.length} version-only field(s)`);
      for (const f of r.findings) {
        console.log(`  ${f.nonNeutral ? '!' : ' '} ${f.table} ${f.key} ${f.buff} .${f.field}: ${f.reads.slice(0, 4).map(fmtRead).join(', ')}${f.reads.length > 4 ? ` … +${f.reads.length - 4}` : ''}`);
      }
      for (const k of r.missingBuffKeys) {
        console.log(`  - buff key ${k.key} absent: ${k.refs.slice(0, 3).map((x) => `${x.file}:${x.line}`).join(', ')}${k.refs.length > 3 ? ` … +${k.refs.length - 3}` : ''}`);
      }
      for (const u of r.unknownTriggerRules) console.log(`  ? trigger rule ${u.rule} (${u.table} ${u.skillId ?? '-'}): ${u.owners.join(', ')}`);
      for (const v of r.versionOnlyKeys) {
        console.log(`  + key ${v.key} (no code): ${v.records.slice(0, 4).map((x) => `${x.table} ${x.id}`).join(', ')}${v.records.length > 4 ? ` … +${v.records.length - 4}` : ''}`);
      }
      for (const f of r.versionOnlyFields) {
        console.log(`  * ${f.table} ${f.key} ${f.buff} .${f.field} (version only): ${f.reads.length ? `${f.reads.slice(0, 3).map(fmtRead).join(', ')}${f.reads.length > 3 ? ` … +${f.reads.length - 3}` : ''}` : 'no read of that name'}`);
      }
    }
  }
  const any = reports.some((r) => r.findings.length || r.missingBuffKeys.length || r.unknownTriggerRules.length || r.versionOnlyKeys.length || r.versionOnlyFields.length);
  return o.strict && any ? 1 : 0;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (invoked) process.exit(main(process.argv.slice(2)));
