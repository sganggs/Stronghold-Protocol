// Import/setup only. Maintainer decision 2026-10-17, DESIGN §34.33: fetch on demand, never in gameplay.
// Shapes/sizes: .cache/gamedata/excel, Kengxxiao/ArknightsGameData zh_CN (2026-10-17 inspection).
import fs from 'node:fs';
import path from 'node:path';
import { cachedJson } from './cache.mjs';
import { RAW } from './sources.mjs';
import { MirrorPolicy } from './network.mjs';
import { installedFxReferences } from '../../server/plugins/fxReferences.js';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const rows = (v, field) => object(v) && Object.keys(v).length > 0
  && Object.values(v).every(row => object(row) && Array.isArray(row[field]));
// [ASSUMED] Rounded uncompressed MB estimates, with per-table caps allowing upstream growth.
const TABLES = [
  ['character_table', 15.1, 32, v => rows(v, 'phases')],
  ['skill_table', 11.6, 32, v => rows(v, 'levels')],
  ['range_table', 0.1, 2, v => rows(v, 'grids')],
  ['uniequip_table', 3.4, 16, v => object(v) && object(v.equipDict) && object(v.charEquip)],
  ['battle_equip_table', 5.8, 16, v => rows(v, 'phases')],
  ['activity_table', 14.1, 32, v => object(v) && object(v.autoChessData)],
];
const pending = new Map();

/** Internal installer options, not a plugin API.
 * @typedef {object} TableOptions
 * @property {boolean} [offline]
 * @property {boolean} [refresh]
 * @property {'direct'|'mirror'} [source]
 * @property {string} [proxyPrefix]
 * @property {typeof fetch} [fetchImpl]
 * @property {MirrorPolicy} [mirrorPolicy]
 * @property {(line:string)=>void} [log]
 * @property {number} [backoffMs]
 * @property {number} [timeoutMs]
 */

/** [ASSUMED] Fetch the fixed W3/W5/P10 table set only after a caller discovers a need.
 * [ASSUMED] Concurrent studio requests share a per-install queue; present files, even corrupt ones,
 * are never replaced without --refresh-index. Failures leave the local-only derivation/extraction fallback.
 * @param {string} root
 * @param {string} reason
 * @param {TableOptions} [opts]
 * @param {string[]} [charIds] verify discovered candidates against the first table before fetching the rest
 */
export async function ensureOfficialTables(root, reason, opts = {}, charIds) {
  const key = path.resolve(root);
  const previous = pending.get(key) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(() => ensureTables(key, reason, opts, charIds));
  pending.set(key, job);
  try { return await job; } finally { if (pending.get(key) === job) pending.delete(key); }
}

async function ensureTables(root, reason, opts, charIds) {
  const lines = [], failures = [];
  const log = line => { lines.push(line); opts.log?.(line); };
  const dir = path.join(root, '.cache/gamedata/excel');
  const needed = TABLES.filter(([name]) => opts.refresh || !fs.existsSync(path.join(dir, `${name}.json`)));
  if (needed.length) log(`[official tables] ${opts.offline ? 'Download refused (offline/no-network)' : 'Downloading as needed'}: ${needed.map(([name]) => `${name}.json`).join(', ')} (up to ~${needed.reduce((n, row) => n + Number(row[1]), 0).toFixed(1)} MB); ${reason}.`);
  try {
    const mirrorPolicy = opts.mirrorPolicy ?? new MirrorPolicy({ ...opts, source: opts.source ?? process.env.SP_ASSET_SOURCE ?? 'direct', log: opts.log ?? (() => {}) });
    for (const [name, , cap, shape] of TABLES) {
      const cacheFile = path.join(dir, `${name}.json`);
      const present = fs.existsSync(cacheFile);
      try {
        const json = await cachedJson({ ...opts, mirrorPolicy, cacheFile, url: `${RAW.gamedata}excel/${name}.json`,
          log: opts.log ?? (() => {}), maxBytes: Number(cap) * 1024 * 1024,
          offline: !!opts.offline || !opts.refresh && present,
          validate: json => { if (!shape(json)) throw new Error(`${name}.json: invalid table shape`); },
        });
        // Syntax bootstraps discovery only. A known non-official reference needs no other official tables.
        if (name === 'character_table' && charIds && !charIds.some(id => Object.hasOwn(json, id))) {
          log('[official tables] No referenced operator is in character_table.json; remaining tables not requested.');
          break;
        }
      } catch (e) {
        failures.push(`${name}.json: ${e.message}${present && !opts.refresh ? '; existing table kept; use --refresh-index to replace it online' : ''}`);
      }
    }
  } catch (e) { failures.push(e.message); }
  if (failures.length) log(`[official tables] Unavailable; keeping local fallback: ${failures.join('; ')}`);
  return { lines, failures };
}

const read = (root, file) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { return {}; }
};

/** Called by setup before its W5/P10 gap checks (also reached by startup/update setup).
 * [ASSUMED] Without the official index, syntactically official references outside the shipped roster
 * trigger the table fetch; P10 still requires an own table entry before permitting art extraction.
 * @param {string} root
 * @param {TableOptions & {check?:boolean, assets?:boolean}} [opts]
 */
export async function preparePluginOfficialTables(root, opts = {}) {
  const chess = read(root, 'data/chess.json'), backups = read(root, 'data/backups.json');
  const roster = new Set([...Object.values(chess ?? {}).map(r => r?.charId), ...Object.keys(backups?.units ?? {})]);
  const refs = installedFxReferences(root, { artPhases: true }).filter(id => !roster.has(id));
  if (!refs.length) return { lines: [], failures: [] };
  return ensureOfficialTables(root, `installed plugins reference operators outside the roster (${refs.join(', ')}); official derivation, art and effects discovery`,
    { ...opts, offline: !!opts.offline || !!opts.check || opts.assets === false }, refs);
}
