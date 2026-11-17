// §35.12: acquisition-cycle evidence, generated from this version's special traits, not battle SP/DP text.
// Sources: chess.garrisonIds → garrisons.eventType/effectKey/bb/bbStr; garrisons/meta.js and effectsMeta.js.
// [ASSUMED] Classification is deliberately limited to recognized handlers; unknown effects retain raw evidence.
const ids = s => String(s || '').split(',').map(s => s.trim()).filter(Boolean);
const unique = xs => [...new Set(xs)];
const buff = (b, key) => b?.buffs?.find(x => x.key === key);

export function operatorEvents(data, chess) {
  return (chess?.garrisonIds || []).map(id => {
    const g = data.garrisons?.[id];
    if (!g) return null;
    const p = g.bb || {}, s = g.bbStr || {}, key = g.effectKey;
    const base = { id, event: g.eventType, key, description: g.desc, parameters: p, strings: s,
      boardOnly: s.conditionkey === 'character_target_inboard',
      source: `chess.${chess.chessId}.garrisonIds → garrisons.${id}; server/sim/content/garrisons/meta.js` };
    let effect = { kind: 'unreviewed' };
    if (['SERVER_ADD_BOND', 'SERVER_ADD_BOND_CHESS_ALL', 'SERVER_ADD_MULTIPLE_BOND', 'SERVER_ADD_BOND_METHOD',
      'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER'].includes(key)) {
      let bonds = key === 'SERVER_ADD_BOND_CHESS_ALL' ? chess.bonds || [] : ids(s.bond);
      // Same-event, same-text multiple grants supersede duplicate single grants (garrisons/meta.js SERVER_ADD_BOND).
      if (key === 'SERVER_ADD_BOND') {
        const covered = (chess.garrisonIds || []).map(id => data.garrisons[id]).filter(other => other
          && other.effectKey === 'SERVER_ADD_MULTIPLE_BOND' && other.eventType === g.eventType && other.desc === g.desc)
          .flatMap(other => ids(other.bbStr?.bond));
        bonds = bonds.filter(id => !covered.includes(id));
      }
      // Match the live handler's active requirement, rather than interpreting all layers as usable immediately.
      // i18n-ignore: official mechanic text parser, same rule as garrisons/meta.js requireActiveOf
      const requireActive = key === 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER' || (!g.desc?.includes('无需激活') && /已激活|激活且/.test(g.desc || ''));
      effect = { kind: 'layers', bonds, target: key === 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER' ? 'highest-active' : 'listed',
        count: p.count ?? null, counts: ids(s.count).map(Number), method: s.add_method || 'fixed', multiplier: p.multi ?? 1, requireActive };
    } else if (['SERVER_ONCE_GOLD', 'SERVER_ONCE_GOLD_WITH_BOND_CONDITION'].includes(key)) {
      effect = { kind: 'funds', count: p.count, payout: 'next-round', benchRequiresAnyBond: ids(s.bond) };
    } else if (key === 'SERVER_POOL_CHAR') {
      effect = { kind: 'operators', count: p.count, pool: s.pool,
        options: (data.choices?.pools?.[s.pool]?.weighted || []).map(([id, weight]) => ({ id, weight })), stock: 'pool-dependent' };
    } else if (key === 'SERVER_GAIN_EQUIP') effect = { kind: 'items', count: p.count, item: s.chess };
    else if (['SERVER_POOL_EQUIP', 'SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL'].includes(key)) effect = { kind: 'items', count: p.count, pool: s.pool };
    else if (key === 'SERVER_GAIN_FREE_REFRESH_COUNT') effect = { kind: 'refreshes', count: p.count };
    // Battle-only layer sources are evidence for growing the economy, never on-acquire effects.
    else if (g.eventType === 'IN_BATTLE' && s.bond_id && p.bond_add_count > 0)
      effect = { kind: 'layers', bonds: ids(s.bond_id), count: p.bond_add_count, method: 'battle-trigger', requireActive: true };
    return { ...base, ...effect };
  }).filter(e => e && (e.event !== 'IN_BATTLE' || e.kind === 'layers'));
}

export function deriveCycles(data, operators, builds) {
  const build = builds.find(b => b.id === 'meter-backwards');
  if (!build) return null;
  if (build.status === 'unresolved' || !Array.isArray(build.variants)) return {
    build: build.id, available: false, reason: 'Community cycle variants are not specified for this version.', variants: [], disagreements: [],
  };
  const foresight = Object.entries(data.bonds || {}).find(([, b]) => buff(b, 'bond_multi_layer_char_goods_price_bond_discount'));
  const investor = Object.entries(data.bonds || {}).find(([, b]) => b.buffs?.some(x =>
    x.key === 'bond_layer_char_garrison_bonus' && x.bbStr?.event === 'SERVER_GAIN'));
  if (!foresight || !investor) return { build: build.id, available: false, reason: 'Missing economy bond mechanics.', variants: [], disagreements: [] };
  const [fid, f] = foresight, [iid, inv] = investor;
  const discount = buff(f, 'bond_multi_layer_char_goods_price_bond_discount').bb;
  const income = buff(f, 'bond_layer_gain_coin')?.bb;
  const repeats = inv.buffs.filter(b => b.key === 'bond_layer_char_garrison_bonus' && b.bbStr?.event === 'SERVER_GAIN')
    .map(b => ({ layers: b.bb.layer, count: b.bb.count })).sort((a, b) => a.layers - b.layers);
  const engine = [fid, iid].map(id => ({ id, need: data.bonds[id].activeCount ?? data.bonds[id].thresholds[0],
    countMode: data.bonds[id].countMode, members: operators.filter(c => c.bonds.includes(id)).map(c => c.id) }));
  const gain = c => c.events.filter(e => e.event === 'SERVER_GAIN');
  const growers = id => operators.filter(c => c.events.some(e => e.kind === 'layers' && e.bonds.includes(id))).map(c => c.id);
  const packages = Object.entries(data.items || {}).flatMap(([id, item]) => (item.buffs || [])
    .filter(b => b.key === 'sell_char_count_gain_equip_owner_bond').map(b => ({ id, tier: item.tier, sales: b.bb.count,
      grants: 'One random normal sharing any carrier bond, at or below shop level; subject to pool availability.' })));
  const variants = build.variants.map(v => {
    const direct = operators.filter(c => gain(c).some(e => e.kind === 'layers' &&
      (e.target === 'highest-active' || e.bonds.some(id => v.damageBonds.includes(id)))));
    const copies = operators.filter(c => gain(c).some(e => e.kind === 'operators' && e.options.some(o => direct.some(c => c.id === o.id))));
    const present = v.namedMembers.flatMap(name => operators.filter(c => c.name === name).map(c => c.id));
    const missing = v.namedMembers.filter(name => !operators.some(c => c.name === name));
    return { ...v, present, missing, cycleMembers: unique([...direct, ...copies].map(c => c.id)),
      // [ASSUMED] Acquisition-count prep-end traits can feed these bonds without being gain-event listeners.
      acquisitionSupport: operators.filter(c => c.events.some(e => e.event === 'SERVER_PREP_FIN' && e.method === 'round_gain_char'
        && e.bonds.some(id => [...v.damageBonds, iid].includes(id)))).map(c => c.id) };
  });
  const actual = { foresightGlobalDiscount: discount.layer2, investorTriple: repeats.find(r => r.count === 3)?.layers ?? null };
  const disagreements = (build.claims || []).filter(c => c.value !== actual[c.rule]).map(c => ({ ...c, actual: actual[c.rule] }));
  const minimumShopLevel = Math.max(...engine.map(e => operators.filter(c => e.members.includes(c.id))
    .sort((a, b) => a.tier - b.tier)[e.need - 1]?.tier ?? Infinity));
  if (minimumShopLevel > build.shopHold) disagreements.push({ rule: 'naturalShopHold', claimed: build.shopHold, actual: Number.isFinite(minimumShopLevel) ? minimumShopLevel : null,
    source: build.variants[0].source, detail: 'Distinct natural engine members need this tier; higher-tier owned gifts can change match feasibility.' });
  for (const v of variants) if (v.missing.length) disagreements.push({ rule: 'missing-roster-members', variant: v.id, names: v.missing, source: v.source });
  for (const claim of build.eventClaims || []) {
    const c = operators.find(c => c.name === claim.operator);
    if (c && !c.events.some(e => e.event === claim.event)) disagreements.push({ ...claim, rule: 'event-timing',
      actual: c.events.map(e => ({ event: e.event, method: e.method ?? null, payout: e.payout ?? null })) });
  }
  return { build: build.id, available: engine.every(e => e.members.length >= e.need), engine,
    minimumShopLevel: Number.isFinite(minimumShopLevel) ? minimumShopLevel : null,
    source: 'data/bonds.json buffs; effectsMeta.js investRepeat; bonds/addon/meta.js; player/economy.js; builtinMeta.js',
    foresight: { id: fid, income: income ? { every: income.layer, funds: income.count } : null,
      discounts: [{ layers: discount.layer1, scope: fid, amount: discount.discount }, { layers: discount.layer2, scope: 'all', amount: discount.discount }],
      growers: growers(fid), permanent: true, floor: 0 },
    investor: { id: iid, repeats, growers: growers(iid) }, packages, variants, disagreements,
    fundsSources: operators.filter(c => c.events.some(e => e.kind === 'funds')).map(c => c.id),
    saleRule: 'Sale refunds sellPrice and returns only the piece\'s accounted copies to its pool, not to hand or guaranteed shop slots. Packaging checks every N sales; no guaranteed Ethan/Yan return.',
    acquisitionRule: 'Only the gained operator\'s SERVER_GAIN traits fire; a completing merge fires the elite\'s traits. Existing board traits do not all fire on every acquisition.',
  };
}
