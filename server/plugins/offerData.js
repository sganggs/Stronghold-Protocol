// Offer references are checked at discovery, then again against the composed room snapshot.
import { getData } from '../data.js';
import { problem, recordId } from '../../shared/plugins/dataUtils.js';

const refs = { item: ['items', 'item_x'], chess: ['chess', 'chess_x'], layers: ['bonds', 'bond_x'] };

export function offerReferenceProblems(offers, manifest, documents, official = getData(), composed = null) {
  const declared = new Map(Object.values(refs).map(([table]) => [table, new Set()]));
  const add = (table, id) => declared.get(table)?.add(id);
  for (const part of ['data', 'operators']) for (const rel of manifest.parts[part]?.files ?? []) {
    const doc = documents[rel];
    if (part === 'data' && doc?.patch === 1) {
      for (const op of doc.ops || []) if (op.op === 'add') add(op.file, op.id);
    } else for (const r of part === 'data' ? doc?.entries || [] : Array.isArray(doc) ? doc : [doc]) {
      if (!r) continue;
      if (r.op === 1) {
        const stem = r.chess?.id ?? r.charId?.replace(/^char_x_/, 'chess_x_');
        const normal = r.chess?.ids?.normal ?? stem?.replace(/_[ab]$/, '') + '_a';
        if (r.as !== 'diy') {
          add('chess', normal);
          add('chess', r.chess?.ids?.elite ?? normal.replace(/_a$/, '_b'));
        }
      } else add(r.file, r.id);
    }
  }
  const problems = [];
  for (const o of offers) for (const effect of [o.apply, ...o.cards.map(c => c.effect)].filter(Boolean)) {
    const [kind] = Object.keys(effect);
    if (!refs[kind]) continue;
    const [table, prefix] = refs[kind];
    const id = kind === 'layers' ? effect.layers.bond : effect[kind];
    const allowed = Object.hasOwn(official[table] || {}, id)
      || recordId(id, manifest.id, prefix) && declared.get(table).has(id) && manifest.permissions.includes('data.add');
    const record = (composed || official)[table]?.[id];
    // A static grant cannot bind an official DIY placeholder to a player's loadout.
    const unresolved = kind === 'chess' && record?.isDiy && !record.diyFor;
    if (!allowed || unresolved || composed && !Object.hasOwn(composed[table] || {}, id)) {
      problems.push(problem('PLUGIN_OFFER_REFERENCE', `${o.rel}.apply`, `${table}.${id} must exist in official data or this plugin's own room records and cannot be an unresolved DIY slot`));
    }
  }
  return problems;
}
