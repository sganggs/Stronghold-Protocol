// Server-side compact additions. The browser consumes composed DATA.md records, so vanilla code bytes stay intact.
import { createHash } from 'node:crypto';
import { expandRecords } from '../../shared/plugins/records.js';
import { clone, object, recordId, problem, jsonProblems, mergeData } from '../../shared/plugins/dataUtils.js';
import { validateData } from '../../shared/plugins/validate.js';
import { officialBbMax, rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';
import { isStepKey } from '../../shared/plugins/limits.js';
import { PLUGIN_LIMITS } from '../../shared/plugins/manifest.js';

export const GAMEPLAY_RECORDS = Object.freeze({ bonds: 'bond_x', items: 'item_x' });
export const GAMEPLAY_RECORD_SURFACE = Object.freeze([
  ...Object.keys(GAMEPLAY_RECORDS).map(file => ({ name: `record.file.${file}`, group: 'record', stability: 'stable', since: '0.3.1', anchor: 'server/plugins/gameplayRecords.js#GAMEPLAY_RECORDS' })),
  ...['tags', 'tokens'].map(field => ({ name: `record.operator.forms.${field}`, group: 'record', stability: 'stable', since: '0.3.1', anchor: 'server/plugins/gameplayRecords.js#expandGameplayRecords' })),
]);

/** New bonds and complete item pairs; all legacy records retain their original expansion and hash. */
export function expandGameplayRecords(data, records, opts) {
  const formExtras = r => r?.op === 1 && Object.values(r.forms ?? {}).some(f => f?.tags !== undefined || f?.tokens !== undefined);
  if (!Array.isArray(records) || !records.some(r => formExtras(r) || r?.file === 'bonds' || r?.file === 'items' && !r.base && !r.set?.effectRef && !r.value?.effectRef)) return expandRecords(data, records, opts);
  const problems = jsonProblems(records, 'records');
  if (problems.length) return { data, problems };
  let out = clone(data);
  for (const r of records) {
    if (r?.file !== 'bonds' && !(r?.file === 'items' && !r.base && !r.set?.effectRef && !r.value?.effectRef)) {
      const expanded = expandRecords(out, [r], opts);
      problems.push(...expanded.problems); out = expanded.data;
      if (!expanded.problems.length && formExtras(r)) {
        for (const which of ['normal', 'elite']) for (const field of ['tags', 'tokens']) {
          const value = r.forms[which][field];
          if (value === undefined) continue;
          if (!Array.isArray(value) || value.length > 64 || value.some(id => typeof id !== 'string' || field === 'tokens' && !out.tokens[id])) {
            problems.push(problem('PLUGIN_DATA_REFERENCE', `forms.${which}.${field}`, 'bounded string list with existing token ids required')); continue;
          }
          for (const c of Object.values(out.chess)) if (c.charId === r.charId && c.isGolden === (which === 'elite')) c[field] = clone(value);
          // DIY forms can use several economy statuses. Match the normal/elite form by equipLevel.
          for (const f of Object.values(out.backups?.units?.[r.charId]?.forms ?? {})) if ((f.status.equipLevel > 0) === (which === 'elite')) f[field] = clone(value);
        }
      }
      continue;
    }
    const bad = (message, code = 'PLUGIN_RECORD_TYPE') => problems.push(problem(code, `${r.file}.${r.id}`, message));
    if (!recordId(r.id, opts.pluginId, GAMEPLAY_RECORDS[r.file])) { bad('record outside plugin namespace', 'PLUGIN_RECORD_ID'); continue; }
    if (Object.hasOwn(out[r.file], r.id)) { bad('record already exists', 'PLUGIN_RECORD_EXISTS'); continue; }
    if (Object.keys(r).some(k => !['file', 'id', 'value', 'set', 'base'].includes(k)) || !object(r.value ?? r.set)) { bad('value/set object required'); continue; }
    const v = mergeData(r.base ? out[r.file][r.base] ?? {} : {}, r.value ?? r.set);
    if (r.file === 'bonds') {
      if (r.base && !out.bonds[r.base]) { bad('bond base missing', 'PLUGIN_DATA_REFERENCE'); continue; }
      // [ASSUMED] Compact metadata bounds: at most 16 ascending thresholds in 1..100 and finite display order.
      if (typeof v.name !== 'string' || !v.name || typeof v.desc !== 'string' || !Array.isArray(v.thresholds) || !v.thresholds.length || v.thresholds.length > 16
        || v.thresholds.some((n, i) => !Number.isInteger(n) || n < 1 || n > 100 || i > 0 && n <= v.thresholds[i - 1])
        || !['BOARD', 'BOARD_AND_DECK', 'BOARD_ALL_CHESS'].includes(v.countMode ?? 'BOARD') || typeof (v.isCore ?? false) !== 'boolean'
        || ['identifier', 'bondOrder'].some(k => v[k] != null && !Number.isFinite(v[k]))) { bad('name, desc, ascending positive thresholds, countMode, isCore and numeric order required'); continue; }
      // [ASSUMED] Data alone has no behavior. DSL prep specs and member talents / script kits supply it.
      const effectId = v.effectId ?? r.id.replace(/^bond_x_/, 'effect_x_');
      if (!out.effects[effectId]) {
        if (!recordId(effectId, opts.pluginId, 'effect_x')) { bad('effect outside plugin namespace', 'PLUGIN_RECORD_ID'); continue; }
        out.effects[effectId] = { effectId, name: v.name, desc: v.desc, buffs: [], params: {} };
      }
      out.bonds[r.id] = { identifier: 10000, bondOrder: 10000, isCore: false, bondType: v.isCore ? 'SEASON' : 'REGULAR', iconId: r.id,
        countMode: 'BOARD', thresholdTemplate: 'count_threshold_upward', maxCount: null, bb: {}, bbStr: {},
        layerMilestones: [], effectDescParams: [], members: [], visibleMembers: [], ...v, bondId: r.id, effectId,
        activeCount: v.thresholds[0], countsHand: v.countMode === 'BOARD_AND_DECK', countsGoldenOnly: v.countMode === 'BOARD_ALL_CHESS' };
    } else {
      // Complete items use the existing buff interpreter, never a new behavior name hidden in prose.
      const known = new Set(Object.values(data.items).flatMap(it => (it.buffs ?? []).map(b => `${b.key}:${b.bbStr?.key ?? ''}`)));
      if (!v.name || !['EQUIP', 'TRAP'].includes(v.itemType) || !Number.isInteger(v.tier) || v.tier < 1 || v.tier > 6
        || !Number.isFinite(v.price) || v.price < 0 || !Array.isArray(v.buffs) || !v.buffs.length
        || v.buffs.some(b => !known.has(`${b.key}:${b.bbStr?.key ?? ''}`))) { bad('complete item needs name, type, tier, price and supported buffs'); continue; }
      out.items[r.id] = { ...v, id: r.id };
    }
  }
  return { data: problems.length ? data : out, problems };
}

/** Membership is authoritative on chess, including patches to official pieces. */
export function reconcilePluginBonds(data) {
  const ids = Object.keys(data.bonds).filter(id => id.startsWith('bond_x_'));
  if (!ids.length) return data;
  const out = { ...data, bonds: { ...data.bonds } };
  for (const id of ids) {
    const members = Object.values(data.chess).filter(c => !c.isGolden && c.bonds.includes(id));
    out.bonds[id] = { ...data.bonds[id], members: members.map(c => c.chessId), visibleMembers: members.filter(c => c.visible).map(c => c.chessId) };
  }
  return out;
}

/** Server-only admission extension; shared validators and vanilla content bytes retain their original contract. */
export function validateGameplayData(data, options = {}) {
  const problems = validateData(data, options);
  if (!options.vanilla || !problems.some(p => p.code === 'PLUGIN_DATA_BOUND')) return problems;
  rememberOfficialBounds(options.vanilla);
  const checked = clone(data), boundedPaths = new Set(problems.filter(p => p.code === 'PLUGIN_DATA_BOUND').map(p => p.path));
  const admitted = new Set();
  const skill = (s, path) => {
    for (const [key, value] of Object.entries(s?.bb ?? {})) {
      // [ASSUMED] Only new operators' finite, non-step skill values without an official key use the general ±1e9 bound.
      // Match exact diagnostic paths: official keys (including zero maxima), steps, talents and other limits still fail.
      if (officialBbMax(key) === null && !isStepKey(key) && typeof value === 'number' && Number.isFinite(value)
        && Math.abs(value) <= PLUGIN_LIMITS.number && boundedPaths.has(`${path}.bb.${key}`)) {
        s.bb[key] = 0; admitted.add(`${path}.bb.${key}`);
      }
    }
  };
  const form = (f, path) => {
    skill(f.skill, `${path}.skill`);
    if (Array.isArray(f.skills)) f.skills.forEach((s, i) => skill(s, `${path}.skills[${i}]`));
  };
  for (const [id, c] of Object.entries(checked.chess ?? {})) if (typeof c?.charId === 'string' && c.charId.startsWith('char_x_')) form(c, `chess.${id}`);
  for (const [id, u] of Object.entries(checked.backups?.units ?? {})) if (id.startsWith('char_x_')) {
    for (const [status, f] of Object.entries(u.forms ?? {})) form(f, `backups.units.${id}.forms.${status}`);
  }
  // Validate a copy with only admitted scalars neutralized. Rerun every check: filtering early bounds diagnostics
  // alone would skip validateData's later reference checks. The composed data keeps the original skill values.
  if (!admitted.size) return problems;
  const remaining = problems.filter(p => p.code !== 'PLUGIN_DATA_BOUND' || !admitted.has(p.path));
  return remaining.length ? remaining : validateData(checked, options);
}

/** DIY summons live in backups.tokens with variants per training status (DATA §18), not the shop token table. */
export function reconcilePluginTokens(data) {
  const units = Object.values(data.backups?.units ?? {}).filter(u => u.charId.startsWith('char_x_') && Object.values(u.forms ?? {}).some(f => f.tokens?.length));
  if (!units.length) return data;
  const out = clone(data);
  for (const u of units) for (const [status, original] of Object.entries(u.forms)) for (const id of original.tokens ?? []) {
    const token = out.tokens[id];
    if (!token) continue;
    // [ASSUMED] Distinct ids keep a token usable by both a shop piece and a DIY unit. The full id is retained in variants.
    const prefix = u.charId.replace(/^char_x_/, 'token_x_').slice(0, 35);
    const alias = `${prefix}_diy_${createHash('sha256').update(`${u.charId}\0${id}`).digest('hex').slice(0, 24)}`;
    if (!out.backups.tokens[alias]) out.backups.tokens[alias] = { ...clone(token), tokenId: alias, variants: {} };
    const candidates = Object.entries(token.variants ?? {}).filter(([key]) => key.endsWith(`@${status}`));
    const chessId = original.chessId ?? Object.values(out.chess).find(c => c.charId === u.charId
      && c.isGolden === (original.status?.equipLevel > 0))?.chessId;
    // [ASSUMED] A unique status variant wins. With no status match, use this form's chess variant, then the complete base.
    // Ambiguous status variants still fall back to the base rather than choosing another owner's stats.
    const variant = candidates.length === 1 ? candidates[0][1] : candidates.length === 0 ? token.variants?.[chessId] ?? token : token;
    out.backups.tokens[alias].variants[`${u.charId}@${status}`] = { ...clone(variant), tokenId: alias, sources: variant.sources ?? ['skill'] };
    const form = out.backups.units[u.charId].forms[status];
    form.tokens = form.tokens.map(t => t === id ? alias : t);
    form.displayTokens = (form.displayTokens ?? []).map(t => t === id ? alias : t);
    for (const s of form.skills) if (s.overrideTokenKey === id) s.overrideTokenKey = alias;
    for (const t of form.talents) if (t.tokenKey === id) t.tokenKey = alias;
  }
  return out;
}
