#!/usr/bin/env node
// tools/vfx-missing-fx.mjs — operator skills and enemy effects whose visuals would not play.
//
// Read-only. Prints one row per gap: name, id, skill, reason, key. 规程·序列Ⅰ first, then the other
// versions. The same gap in several versions is one row.
//
// Buckets (kept apart on purpose):
//   official-unmapped — index.json's used set HAS the prefab, and no client signal plays it
//     (skillPlan's unmapped reasons other than no-prefab and bound). This is "the official client
//     has an fx we do not map / nothing emits the event the wiring listens for".
//   missing-asset — a row the client does play (a plan row, a binding, an attack, a death or a birth)
//     whose prefab is absent from data/local-fx.json groups['fx/prefabs'] or whose file is not on disk.
//     The effect library loads from that list (render/vfx/library.js has()).
//   not-extracted — the unit or the skill is not in the used-set index, or the skill graph names a key
//     with no extracted prefab (no-prefab). This is NOT proof the official client has no effect.
//
// A trailing section lists sim `fx` calls whose archetype is still a cast flash (skillfx.js FLASH) and
// which carry a skill tag. Most of those are intentional: the official skill effect stands for the flash.
// `heatwave` is listed there only if it is still a cast flash.
//
// Usage: node tools/vfx-missing-fx.mjs [--version <id>|all] [--summary]
//   --version   default `all`. An official id or its slug, as tools/vfx-skill-coverage.mjs.
//   --summary   counts only, no rows.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLASH } from '../public/js/render/vfx/skillfx.js';
import { fxSpec } from '../public/js/render/fx/kinds.js';
import { resolveSkill, skillPlan, unitKeyOf, UNMAPPED, bindingKeys, enemyBindingKeys } from '../public/js/render/vfx/skills.js';
import { loadRosterData, resolveVersion, roster } from './vfx-skill-coverage.mjs';
import { VERSIONS } from '../shared/versions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');
const LIST = path.join(ROOT, 'data/local-fx.json');
const USAGE = 'usage: node tools/vfx-missing-fx.mjs [--version <id>|all] [--summary]';
/** 规程 first, then the covenant periods (shared/versions.js). */
const VERSION_ORDER = ['act3autochess@V3_1', 'act2autochess', 'act2autochess@V2_1', 'act1autochess', 'act1autochess@V1_1'];

const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : '');

function parseArgs(argv) {
  const o = { version: 'all', summary: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--summary') o.summary = true;
    else if (a === '--version') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) return null;
      o.version = v;
      i++;
    } else return null;
  }
  return o;
}

function versionsOf(id) {
  if (id === 'all') {
    const byId = new Map(VERSIONS.map((v) => [v.id, v]));
    const ordered = VERSION_ORDER.map((k) => byId.get(k)).filter(Boolean);
    for (const v of VERSIONS) if (!ordered.includes(v)) ordered.push(v);
    return ordered;
  }
  const one = resolveVersion(id);
  return one ? [one] : null;
}

function nameMap(data) {
  const m = new Map();
  const put = (id, name) => { if (id && typeof name === 'string' && name && !m.has(id)) m.set(id, name); };
  for (const c of Object.values(data.chess || {})) put(c?.charId, c?.name);
  for (const [id, u] of Object.entries(data.backups?.units || {})) put(u?.charId || id, u?.name);
  for (const [id, e] of Object.entries(data.enemies || {})) put(id, e?.name || e?.enemyName);
  const toks = { ...(data.backups?.tokens || {}), ...(data.tokens || {}) };
  for (const [id, t] of Object.entries(toks)) put(id, t?.name);
  return m;
}

/** Prefab keys a plan actually plays. */
function placedKeys(plan) {
  const out = [];
  const add = (e) => {
    if (!e || typeof e !== 'object') return;
    if (e.key) out.push(lc(e.key));
    if (Array.isArray(e.slots)) for (const s of e.slots) if (s) out.push(lc(s));
  };
  for (const role of ['start', 'loop', 'end', 'ready', 'range', 'trigger']) for (const e of plan[role] || []) add(e);
  for (const e of plan.targets || []) add(e);
  for (const e of plan.cond || []) add(e);
  for (const e of plan.pulse || []) add(e);
  for (const e of plan.each?.cast || []) add(e);
  for (const g of plan.each?.hit || []) for (const e of g || []) add(e);
  for (const a of plan.attacks || []) {
    for (const e of [...(a.cast || []), ...(a.range || []), ...(a.aim || [])]) add(e);
    for (const g of a.hit || []) for (const e of g || []) add(e);
  }
  return out;
}

/**
 * Attack / death / birth keys on an index unit, outside its skill nodes (those are audited per skill).
 * @param {any} unit
 * @param {(key: string, role: string) => void} add
 */
function walkBodyFx(unit, add) {
  const see = (node, role, depth) => {
    if (!node || depth > 7) return;
    if (Array.isArray(node)) { for (const x of node) see(x, role, depth + 1); return; }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'skills') continue;
      if (typeof v === 'string' && (k === 'deadEffect' || k === 'startEffect' || k === 'overrideDeadEffect' || k === 'overrideStartEffect' || k === 'main')) add(v, k);
      else if ((k === 'effects' || k === 'onReached' || k === 'onHit') && Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === 'string') add(item, k);
          else see(item, role, depth + 1);
        }
      } else if (v && typeof v === 'object') see(v, role, depth + 1);
    }
  };
  see(unit, 'body', 0);
}

/** 'ok' when the effect library can load the prefab. */
function assetState(key, manifest, root) {
  const hit = manifest.get(lc(key));
  if (!hit) return 'no-manifest';
  const rel = typeof hit === 'string' && hit.startsWith('/assets/') ? path.join(root, 'public' + hit) : null;
  if (rel && !fs.existsSync(rel)) return 'no-file';
  return 'ok';
}

function skillLabel(s) {
  const sid = s?.prefabId || s?.skillId || s?.prefabKey || '';
  return s?.name ? `${s.name} (${sid})` : String(sid);
}

/**
 * @param {any} idx
 * @param {{ group: string, id: string, skill: any }} r
 * @param {string} version
 * @param {Map<string, string>} names
 * @param {(key: string) => string} assets
 */
export function auditSkill(idx, r, version, names, assets) {
  const name = names.get(r.id) || r.id;
  const skill = skillLabel(r.skill);
  const base = { name, id: r.id, skill, group: r.group, version };
  const row = (bucket, reason, key) => ({ ...base, bucket, reason, key: key || '' });
  const unitKey = unitKeyOf(idx, [r.id]);
  let plan = null;
  let skillId = null;
  if (r.group === 'enemies') {
    const ekey = lc(r.skill?.prefabKey);
    const unit = unitKey ? idx.units?.[unitKey] : null;
    if (!ekey || !unit?.skills?.[ekey]) {
      return [row('not-extracted', !unitKey ? 'unit-not-in-extracted-index' : 'skill-not-in-extracted-index', ekey || skill)];
    }
    skillId = ekey;
    plan = skillPlan(idx, unitKey, ekey, { rec: r.skill });
  } else {
    const res = resolveSkill(idx, { unitKey, rec: { charId: r.id, skill: r.skill, skills: [r.skill] }, skillIndex: r.skill?.index });
    if (!res.skill) {
      return [row('not-extracted', !res.unitKey ? 'unit-not-in-extracted-index' : (res.reason || 'skill-not-in-extracted-index'), res.skillId || skill)];
    }
    skillId = res.skillId;
    plan = skillPlan(idx, res.unitKey, res.skillId, { rec: r.skill });
  }
  const rows = [];
  const seen = new Set();
  for (const key of placedKeys(plan)) {
    if (!key || seen.has(`p:${key}`)) continue;
    seen.add(`p:${key}`);
    const st = assets(key);
    if (st !== 'ok') rows.push(row('missing-asset', `placed-but-${st}`, key));
  }
  for (const u of plan.unmapped || []) {
    const key = lc(u.key);
    if (!key || seen.has(`u:${u.reason}:${key}`)) continue;
    seen.add(`u:${u.reason}:${key}`);
    if (u.reason === 'bound') {
      const st = assets(key);
      if (st !== 'ok') rows.push(row('missing-asset', `binding-but-${st}`, key));
      continue;
    }
    if (u.reason === 'no-prefab') {
      rows.push(row('not-extracted', 'referenced-key-has-no-extracted-prefab', key));
      continue;
    }
    const gloss = UNMAPPED[u.reason] ? `${u.reason}` : u.reason || 'unmapped';
    const st = assets(key);
    rows.push(row('official-unmapped', st === 'ok' ? gloss : `${gloss}+${st}`, key));
  }
  // A projectile the skill lists and no attack of the plan flies. Skip one a binding already plays, and one
  // the switched mode's own attack fires (the attack wiring, not this plan).
  if ((plan.projectiles || []).length && (plan.attacks || []).length === 0) {
    const bound = new Set(bindingKeys(idx, skillId));
    if (r.group === 'enemies' && unitKey) for (const k of enemyBindingKeys(idx, unitKey)) bound.add(k);
    const modeProj = lc(idx.units?.[unitKey]?.modes?.[plan.mode]?.attack?.projectileKey);
    const idle = [];
    for (const pk of plan.projectiles) {
      if (pk === modeProj) continue;
      const p = idx.projectiles?.[pk];
      const keys = [pk, p?.main, ...(Array.isArray(p?.onReached) ? p.onReached : []), ...(Array.isArray(p?.onHit) ? p.onHit : [])].map(lc).filter(Boolean);
      if (keys.some((k) => bound.has(k))) continue;
      idle.push(pk);
    }
    if (idle.length) rows.push(row('official-unmapped', 'index-lists-projectiles-and-the-skill-has-no-attack-to-fly-them', idle.join(',')));
  }
  if (!rows.length && skillId && !(plan.projectiles || []).length && !(plan.start.length || plan.loop.length || plan.range.length || plan.end.length || plan.attacks.length || plan.ready.length || (plan.pulse || []).length || (plan.targets || []).length)) {
    rows.push(row('not-extracted', 'extracted-skill-has-no-effect-keys', skillId));
  }
  return rows;
}

/** Death, birth and attack prefabs of one roster unit. */
function auditBody(idx, id, group, version, names, assets, seenUnits) {
  const unitKey = unitKeyOf(idx, [id]);
  if (!unitKey || seenUnits.has(`${version}|${unitKey}`)) return [];
  seenUnits.add(`${version}|${unitKey}`);
  const unit = idx.units[unitKey];
  const rows = [];
  const seen = new Set();
  walkBodyFx(unit, (key, role) => {
    const k = lc(key);
    if (!k || seen.has(k)) return;
    seen.add(k);
    if (!idx.prefabs?.[k]) return;
    const st = assets(k);
    if (st === 'ok') return;
    rows.push({
      name: names.get(id) || id, id, skill: role, group, version,
      bucket: 'missing-asset', reason: `${role}-mapped-but-${st}`, key: k,
    });
  });
  return rows;
}

/** Sim fx calls that are still cast flashes and name a skill. */
function flashCalls(root) {
  const out = [];
  const dir = path.join(root, 'server/sim');
  const files = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.js')) files.push(p);
    }
  };
  walk(dir);
  const re = /\.fx\(\s*['"]([A-Za-z0-9_]+)['"]\s*,\s*\{([^{}]{0,500})\}/g;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const kind = m[1];
      const skill = /skill:\s*['"]([^'"]+)['"]/.exec(m[2]);
      if (!skill) continue;
      const a = fxSpec(kind).a;
      if (!FLASH.has(a)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      out.push({ kind, skill: skill[1], archetype: a, file: path.relative(root, file), line });
    }
  }
  return out;
}

function merge(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = [r.bucket, r.group, r.id, r.skill, r.reason, r.key].join('\t');
    let hit = map.get(k);
    if (!hit) { hit = { ...r, versions: [] }; map.set(k, hit); }
    if (!hit.versions.includes(r.version)) hit.versions.push(r.version);
    if (hit.name === hit.id && r.name !== r.id) hit.name = r.name;
  }
  return [...map.values()];
}

function counts(rows) {
  const by = {};
  for (const r of rows) {
    by[r.bucket] = by[r.bucket] || {};
    by[r.bucket][r.reason] = (by[r.bucket][r.reason] || 0) + 1;
  }
  return by;
}

function printRows(rows) {
  const order = { 'official-unmapped': 0, 'missing-asset': 1, 'not-extracted': 2 };
  const list = rows.slice().sort((a, b) => (order[a.bucket] - order[b.bucket]) || a.group.localeCompare(b.group) || a.id.localeCompare(b.id) || a.skill.localeCompare(b.skill) || a.key.localeCompare(b.key));
  let bucket = '';
  for (const r of list) {
    if (r.bucket !== bucket) {
      bucket = r.bucket;
      console.log(`\n# ${bucket}`);
      console.log('name\tid\tskill\treason\tkey\tgroup\tversions');
    }
    console.log([r.name, r.id, r.skill, r.reason, r.key, r.group, r.versions.join(',')].join('\t'));
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { console.error(USAGE); process.exit(2); }
  const versions = versionsOf(args.version);
  if (!versions) { console.error(`unknown version ${args.version}\n${USAGE}`); process.exit(2); }
  const idx = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
  const groups = list?.groups?.['fx/prefabs'] || {};
  const manifest = new Map();
  for (const [k, e] of Object.entries(groups)) if (e && typeof e.path === 'string') manifest.set(lc(k), e.path);
  const cache = new Map();
  const assets = (key) => {
    const k = lc(key);
    if (!cache.has(k)) cache.set(k, assetState(k, manifest, ROOT));
    return cache.get(k);
  };
  const raw = [];
  for (const v of versions) {
    const data = loadRosterData(v.id);
    if (!data) continue;
    const names = nameMap(data);
    const listR = roster(data);
    const seenUnits = new Set();
    for (const r of listR) {
      try { raw.push(...auditSkill(idx, r, v.id, names, assets)); }
      catch (err) { raw.push({ bucket: 'not-extracted', name: names.get(r.id) || r.id, id: r.id, skill: skillLabel(r.skill), group: r.group, version: v.id, reason: 'audit-error', key: String(err && err.message || err) }); }
      try { raw.push(...auditBody(idx, r.id, r.group, v.id, names, assets, seenUnits)); }
      catch { /* a bad unit still leaves its skill rows */ }
    }
  }
  const rows = merge(raw);
  const by = counts(rows);
  const heat = fxSpec('heatwave');
  console.log(`# vfx missing-fx  index=${idx.source?.client || '?'} v${idx.version} units=${Object.keys(idx.units || {}).length} manifestPrefabs=${manifest.size}`);
  console.log(`# versions ${versions.map((v) => v.id).join(', ')}`);
  console.log(`# heatwave archetype=${heat.a} castFlash=${FLASH.has(heat.a)} (lanes are drawn; the stance aura does not swallow them)`);
  console.log('# counts (unique across the versions listed)');
  for (const bucket of ['official-unmapped', 'missing-asset', 'not-extracted']) {
    const reasons = by[bucket] || {};
    const n = Object.values(reasons).reduce((s, x) => s + x, 0);
    console.log(`# ${bucket}\t${n}`);
    for (const [reason, c] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`#   ${reason}\t${c}`);
  }
  if (!args.summary) printRows(rows);
  const flashes = flashCalls(ROOT);
  const flashKey = new Map();
  for (const f of flashes) {
    const k = `${f.kind}\t${f.skill}`;
    if (!flashKey.has(k)) flashKey.set(k, f);
  }
  console.log(`\n# sim cast-flash fx with a skill tag (often intentional — the official skill effect stands for them): ${flashKey.size}`);
  if (!args.summary) {
    console.log('kind\tskill\tarchetype\tfile\tline');
    for (const f of flashKey.values()) console.log([f.kind, f.skill, f.archetype, `${f.file}:${f.line}`].join('\t'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
