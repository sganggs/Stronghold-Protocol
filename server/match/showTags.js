import { garrisonUpgradeKey } from '../../shared/garrisonUpgrades.js';
import { garrisonShowTags, itemShowTags } from '../../shared/showTags.js';

// Derived presentation only: no meta initialisation, lazy reset or new persisted counter.
export function pieceGarrisonTags(ps, piece) {
  if (piece.kind !== 'chess') return undefined;
  const result = {};
  for (const id of ps.gd.chess(piece.id)?.garrisonIds || []) {
    const g = ps.gd.garrison(id);
    if (!g || !/\{showtag_value_\d+\}/.test(g.descRaw || g.desc || '')) continue;
    const key = garrisonUpgradeKey(g, ps.gd.baseIdOf(piece.id));
    const sharedUpgrade = key && Object.hasOwn(ps.counters, key);
    const state = sharedUpgrade ? { fired: ps.counters[key] } : piece.meta?.gar?.[id];
    const values = garrisonShowTags(g, { round: ps.round, state, sharedUpgrade });
    if (values) result[id] = values;
  }
  return Object.keys(result).length ? result : undefined;
}

export function pieceItemTags(ps, piece) {
  return piece.kind === 'item' ? itemShowTags(ps.gd.item(piece.id), ps.counters[`passbook:${piece.uid}`]) : undefined;
}
