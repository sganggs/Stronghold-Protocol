// §35.11. [ASSUMED] Local repair policy for this example only. Server validPlan and human validators stay strict.
import { validPlan } from '../../server/match/aiPlan.js';
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
export const shortText = (s, max = 360) => typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function repairPlan(input, pack, digest, choices) {
  if (!object(input)) throw new Error('plan');
  const repairs = [], plan = {};
  const drop = (path, value, reason = 'unknown ID or invalid value') => repairs.push({ path, value: shortText(String(value), 128), reason });
  const fields = ['bonds', 'buy', 'keep', 'sell', 'economy', 'items', 'placements', 'choice'];
  if (Object.keys(input).length && !Object.keys(input).some(k => fields.includes(k))) throw new Error('plan');
  const cleanKeys = (x, allowed, path) => { for (const k of Object.keys(x)) if (!allowed.includes(k)) drop(`${path}${k}`, x[k], 'unknown field'); };
  cleanKeys(input, fields, '');
  const pieces = [...(digest.board || []), ...(digest.bench || []), ...(digest.overflow || []), ...(digest.shop || []).filter(Boolean)];
  const ops = new Set([...pack.operators.map(p => p.id), ...pieces.filter(p => p.kind === 'chess').map(p => p.id)]);
  const items = new Set(pack.items.map(p => p.id)), bonds = new Set(pack.bonds.map(p => p.id));
  // Shop rows cover plugin items absent from the static pack. Chess ids are not item buys.
  const buyableItems = new Set(items);
  for (const s of [...(digest.shop || []), ...(digest.rewards || [])].filter(Boolean)) {
    if (s.kind === 'item' || items.has(s.id) || (s.kind !== 'chess' && !ops.has(s.id) && s.id)) buyableItems.add(s.id);
  }
  const num = (value, min, max, path) => {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n)) { drop(path, value); return undefined; }
    const fixed = Math.max(min, Math.min(max, Math.trunc(n)));
    if (fixed !== value) drop(path, value, `clamped to ${fixed}`);
    return fixed;
  };
  const list = (value, path, cap, map) => {
    if (!Array.isArray(value)) throw new Error('plan');
    const out = [];
    for (const v of value) {
      const item = map(v);
      if (item === undefined) { drop(path, v?.id ?? v); continue; }
      if (out.length >= cap || out.some(x => JSON.stringify(x) === JSON.stringify(item))) { drop(path, v?.id ?? v, 'list cap or duplicate'); continue; }
      out.push(item);
    }
    return out;
  };
  const ids = (value, known, path) => list(value, path, 32, v => known.has(v) ? v : undefined);
  for (const key of ['buy', 'keep', 'sell']) if (input[key] !== undefined) plan[key] = ids(input[key], ops, key);
  if (input.bonds !== undefined) {
    const seen = new Set();
    plan.bonds = list(input.bonds, 'bonds', 8, b => {
      if (!object(b) || !bonds.has(b.id) || seen.has(b.id)) return;
      cleanKeys(b, ['id', 'priority'], 'bonds.');
      const priority = num(b.priority, 1, 5, 'bonds.priority');
      if (priority === undefined) return;
      seen.add(b.id); return { id: b.id, priority };
    });
  }
  if (input.economy !== undefined) {
    if (!object(input.economy)) throw new Error('plan');
    plan.economy = {};
    cleanKeys(input.economy, ['saveForInterest', 'reserve', 'level', 'holdLevel', 'why', 'maxRefreshes', 'refreshAbove', 'freezeSearch'], 'economy.');
    for (const [k, max] of Object.entries({ reserve: 100, level: 6, maxRefreshes: 16, refreshAbove: 100 })) {
      if (input.economy[k] === undefined) continue;
      const value = num(input.economy[k], 0, max, `economy.${k}`);
      if (value !== undefined) plan.economy[k] = value;
    }
    if (typeof input.economy.saveForInterest === 'boolean') plan.economy.saveForInterest = input.economy.saveForInterest;
    else if (input.economy.saveForInterest !== undefined) drop('economy.saveForInterest', input.economy.saveForInterest);
    const why = shortText(input.economy.why);
    if (why) plan.economy.why = why;
    if (typeof input.economy.holdLevel === 'boolean' && (!input.economy.holdLevel || (why && plan.economy.level >= 1)))
      plan.economy.holdLevel = input.economy.holdLevel;
    else if (input.economy.holdLevel !== undefined) drop('economy.holdLevel', input.economy.holdLevel, 'hold requires level >= 1 and economy.why');
    if (typeof input.economy.freezeSearch === 'boolean') plan.economy.freezeSearch = input.economy.freezeSearch;
    else if (input.economy.freezeSearch !== undefined) drop('economy.freezeSearch', input.economy.freezeSearch);
  }
  if (input.items !== undefined) {
    if (!object(input.items)) throw new Error('plan');
    plan.items = {}; cleanKeys(input.items, ['keep', 'equip', 'buy'], 'items.');
    if (input.items.keep !== undefined) plan.items.keep = ids(input.items.keep, items, 'items.keep');
    if (input.items.buy !== undefined) plan.items.buy = list(input.items.buy, 'items.buy', 8, v => buyableItems.has(v) ? v : undefined);
    if (input.items.equip !== undefined) plan.items.equip = list(input.items.equip, 'items.equip', 16, e => {
      if (!object(e) || !items.has(e.id) || !ops.has(e.target)) return;
      cleanKeys(e, ['id', 'target'], 'items.equip.'); return { id: e.id, target: e.target };
    });
  }
  if (input.placements !== undefined) plan.placements = list(input.placements, 'placements', 16, p => {
    if (!object(p) || !ops.has(p.id)) return;
    cleanKeys(p, ['id', 'row', 'col', 'dir'], 'placements.');
    const row = num(p.row, 0, 12, 'placements.row'), col = num(p.col, 0, 10, 'placements.col');
    if (row === undefined || col === undefined) return;
    const dir = typeof p.dir === 'string' ? p.dir.toUpperCase() : undefined;
    if (p.dir !== undefined && dir !== p.dir) drop('placements.dir', p.dir, `normalized to ${dir}`);
    const validDir = ['UP', 'DOWN', 'LEFT', 'RIGHT'].includes(dir);
    if (p.dir !== undefined && !validDir) drop('placements.dir', p.dir);
    return { id: p.id, row, col, ...(validDir ? { dir } : {}) };
  });
  if (input.choice !== undefined) {
    if (choices.some(c => c.id === input.choice)) plan.choice = input.choice;
    else drop('choice', input.choice);
  }
  if (!validPlan(plan)) throw new Error('plan');
  return { plan, repairs };
}
