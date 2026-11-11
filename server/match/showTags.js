import { garrisonShowTags, itemShowTags } from '../../shared/showTags.js';

// Derived presentation only: no meta initialisation, lazy reset or new persisted counter.
export function pieceGarrisonTags(ps, piece) {
  if (piece.kind !== 'chess') return undefined;
  const result = {};
  for (const id of ps.gd.chess(piece.id)?.garrisonIds || []) {
    const g = ps.gd.garrison(id);
    if (!g || !/\{showtag_value_\d+\}/.test(g.descRaw || g.desc || '')) continue;
    const values = garrisonShowTags(g, { round: ps.round, state: piece.meta?.gar?.[id] });
    if (values) result[id] = values;
  }
  return Object.keys(result).length ? result : undefined;
}

export function pieceItemTags(ps, piece) {
  return piece.kind === 'item' ? itemShowTags(ps.gd.item(piece.id), ps.counters[`passbook:${piece.uid}`]) : undefined;
}
