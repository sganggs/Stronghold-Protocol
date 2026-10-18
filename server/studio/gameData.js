// Authoring reads the installation's official tables, never the process's active simulation singleton.
import fs from 'node:fs';
import path from 'node:path';
import { gameplayDataFiles } from '../plugins/identity.js';
import { officialBbRange, rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { StudioError } from './files.js';

export function readStudioData(dataDir) {
  return Object.fromEntries(gameplayDataFiles(dataDir).map(f => [f.name, JSON.parse(fs.readFileSync(f.abs, 'utf8'))]));
}

export function officialOperator(data, key = 'char_102_texas') {
  const normal = Object.values(data.chess || {}).find(c => !c.isGolden && c.charId === key && !c.isDiy);
  if (normal) return { normal, elite: data.chess[normal.goldenId] || normal };
  const unit = data.backups?.units?.[key];
  const forms = Object.values(unit?.forms || {});
  if (forms.length) {
    const rec = f => ({ ...unit, ...f, skill: f.skills?.[0], skills: f.skills, bonds: [data.config.economy.fallbackBondId], tier: 1 });
    return { normal: rec(forms[0]), elite: rec(forms.at(-1)) };
  }
  throw new StudioError('PLUGIN_STUDIO_TARGET', 400, { target: key });
}

/** Only numeric attributes/blackboards are offered. Default skill copies are edited together. */
export function numericFields(data, target) {
  rememberOfficialBounds(data);
  const records = target?.kind === 'operator'
    ? Object.entries(data.chess).filter(([, c]) => c.charId === target.key && !c.isDiy)
    : Object.entries(data[{ enemy: 'enemies', bond: 'bonds', item: 'items' }[target?.kind]] || {})
      .filter(([id, r]) => id === target.key || r.key === target.key || r.bondId === target.key || r.iconId === target.key || r.trapId === target.key);
  const file = { operator: 'chess', enemy: 'enemies', bond: 'bonds', item: 'items' }[target?.kind];
  const out = [];
  for (const [id, rec] of records) {
    const walk = (node, at = [], numeric = false) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'skill' && Array.isArray(rec.skills)) continue;
        const p = [...at, Array.isArray(node) ? Number(key) : key];
        const enabled = numeric || ['stats', 'bb', 'blackboard'].includes(key);
        if (typeof value === 'number' && numeric) {
          const bb = at.includes('bb') || at.includes('blackboard');
          const bbKey = Array.isArray(node) ? node.key : key === 'value' && typeof node.key === 'string' ? node.key : key;
          const mirrors = [];
          if (at[0] === 'skills' && rec.skills[at[1]]?.skillId === rec.skill?.skillId) mirrors.push(['skill', ...p.slice(2)]);
          out.push({ key: JSON.stringify([file, id, p]), file, id, path: p, mirrors,
            name: rec.name, original: value, ...(bb ? officialBbRange(bbKey) : { max: 1e9, min: -1e9, positiveMin: 0, officialMax: null }), bounded: bb });
        } else if (value && typeof value === 'object') walk(value, p, enabled);
      }
    };
    walk(rec);
  }
  return out;
}

export const jsonText = value => `${JSON.stringify(value, null, 2)}\n`;
export const clone = value => JSON.parse(JSON.stringify(value));
export const localId = id => id.replaceAll('-', '_');
// Same flattening semantics as tools/build-data.mjs effectParams (including string precedence).
export function itemParams(buffs = []) {
  const params = {};
  for (const b of buffs) for (const [key, value] of Object.entries({ ...b.bb, ...b.bbStr }))
    if (!Object.hasOwn(params, key)) params[key] = value;
  return params;
}
export function templateFile(folder, rel, encoding = 'utf8') {
  // [ASSUMED] SP_PLUGIN_RESOURCES selects bundled author resources outside the writable plugins volume (DESIGN §32.9.2).
  if (process.env.SP_PLUGIN_RESOURCES) return fs.readFileSync(path.join(process.env.SP_PLUGIN_RESOURCES, '_template', folder, rel), encoding);
  return fs.readFileSync(new URL(`../../plugins/_template/${folder}/${rel}`, import.meta.url), encoding);
}
