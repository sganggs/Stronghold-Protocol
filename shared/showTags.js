// Official runtime display slots. These functions only read state; displaying text never fires a trait.
const finite = (n, fallback = 0) => typeof n === 'number' && Number.isFinite(n) ? n
  : typeof n === 'string' && n.trim() !== '' && Number.isFinite(+n) ? +n : fallback;

/** The next upgrade trigger's payout, using the existing cumulative allowance. @param {any} bb @param {any} state */
export function nextGarrisonUpgrade(bb, state = null) {
  const fired = finite(state?.fired) + 1, sum = finite(state?.sum);
  const base = finite(bb.count), delta = finite(bb.delta_count);
  const cap = base + (Object.hasOwn(bb, 'max_count') ? finite(bb.max_count) : Infinity);
  const want = Object.hasOwn(bb, 'n') ? (fired <= finite(bb.n) ? base : base + delta) : base + (fired - 1) * delta;
  return Math.max(0, Math.min(want, Math.max(0, cap - sum)));
}

/** Initial values without a match; current owner state when provided. @param {any} g @param {any} context */
export function garrisonShowTags(g, context = {}) {
  const round = context.round || {}, bb = g.bb || {};
  let value;
  switch (g.effectKey) {
    case 'SERVER_ADD_BOND_UPGRADE_LAYER':
    case 'SERVER_GAIN_FREE_REFRESH_UPGRADE_COUNT': value = nextGarrisonUpgrade(bb, context.state); break;
    case 'SERVER_ADD_BOND_METHOD':
      if (g.bbStr?.add_method === 'round_gain_char') value = finite(round.gainedChess);
      break;
    case 'SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER': value = finite(round.refreshes); break;
    case 'SERVER_ADD_BOND_ROUND_COIN_COST': value = finite(round.spent); break;
  }
  return Number.isFinite(value) ? { showtag_value_1: value } : undefined;
}

/** Passbook's actual equip payout (not a new counter). @param {any} item @param {number} grown */
export function itemShowTags(item, grown = 0) {
  const buff = item?.buffs?.find(b => b.key === 'equip_destory_gain_coin');
  return buff ? { showtag_value_1: finite(buff.bb?.value) + finite(grown) } : undefined;
}

/** Unknown runtime slots remain visibly unavailable instead of leaking raw template syntax. @param {any} source @param {any} values */
export function formatShowTags(source, values = null) {
  return String(source ?? '').replace(/\{(showtag_value_\d+)\}/g, (_token, key) =>
    Number.isFinite(values?.[key]) ? String(values[key]) : '—');
}
