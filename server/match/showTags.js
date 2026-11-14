import { garrisonUpgradeKey } from '../../shared/garrisonUpgrades.js';
import { garrisonShowTags as initialGarrisonTags, itemShowTags as initialItemTags } from '../../shared/showTags.js';

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
    const values = initialGarrisonTags(g, { round: ps.round, state, sharedUpgrade });
    if (values) result[id] = [values.showtag_value_1];
  }
  return Object.keys(result).length ? result : undefined;
}

export function pieceItemTags(ps, piece) {
  const values = piece.kind === 'item' ? initialItemTags(ps.gd.item(piece.id), ps.counters[`passbook:${piece.uid}`]) : undefined;
  return values ? [values.showtag_value_1] : undefined;
}

export const hasShowTag = text => typeof text === 'string' && /\{showtag_value_\d+\}/.test(text);
export const itemShowTags = pieceItemTags;
export const garrisonShowTags = pieceGarrisonTags;
