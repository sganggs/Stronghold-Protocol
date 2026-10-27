// Presentation of existing strategy counters; content handlers remain their only writers.
export function bandProgressView(ps) {
  const band = ps.bandId ? ps.gd.band(ps.bandId) : null;
  const buff = band?.buffs?.find(b => b.key === 'refresh_shop_count_gain_coin_bond_char_chess');
  if (!buff) return null;
  const params = { ...buff.bb, ...buff.bbStr };
  const positive = n => Number.isFinite(n) && Math.trunc(n) > 0 ? Math.trunc(n) : null;
  const count = key => Number.isFinite(ps.counters[key]) ? Math.max(0, Math.trunc(ps.counters[key])) : 0;
  const total = positive(params.refresh_count), limit = positive(params.max_count);
  if (!total) return null;
  // Round counters reset lazily in the content handler. Reading a view must not reset them.
  const rewards = ps.counters['band:chiave:r'] === ps.m.round ? count('band:chiave') : 0;
  return {
    progress: { current: count('band:chiave:refreshes') % total, total },
    ...(limit ? { roundProgress: { current: rewards, total: limit } } : {}),
  };
}
