// Presentation of existing per-item counters; never advances or persists another counter.
export function itemProgress(ps, item) {
  const rec = ps.gd.item(item.id);
  const buff = rec?.buffs?.find(b => b.key === 'sell_char_count_gain_equip_owner_bond'
    || b.key === 'sell_char_count_gain_equip_owner_original');
  if (!buff) return undefined;
  const total = Math.max(1, Math.trunc(Number.isFinite(rec.params?.count) ? rec.params.count : 8));
  const count = ps.counters[`pack:${item.uid}`];
  return { current: Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0, total };
}

export function equippedItemProgress(ps, piece) {
  const rows = (piece.items || []).flatMap(it => {
    const progress = itemProgress(ps, it);
    return progress ? [{ uid: it.uid, id: it.id, ...progress }] : [];
  });
  return rows.length ? rows : undefined;
}
