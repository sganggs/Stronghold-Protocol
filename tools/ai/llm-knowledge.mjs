// §35.15. [ASSUMED] System-prompt view of an sp-knowledge/1 pack. The pack itself is unchanged: third-party agents still
// receive the full hello pack. Round 65: 182 045 → under 50 000 characters with the strategy prompt (llm-agent.mjs
// SYSTEM_BUDGET; 93 % of each cycle-5 request was this prefix). Out: the enemy table (the round's upcoming list names the
// enemies), community build prose, the bond graph and pairings, the duplicate band insights, the level schedules and
// legacy reference (both still said L6), the cycles. Rows are column arrays: one operator row is id, name, tier, bonds,
// class, caps and the first trait clipped to 90 characters (skills and stats only lived in the old 120 k view).
import { BAND_STRENGTH } from '../../server/ai/strategy.js';
const clip = (s, n) => {
  const t = String(s ?? '').replace(/<@[^>]*>|<\/>/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const CAPS = ['air', 'block', 'sustain', 'elementRecovery', 'reveal'];

export function slimKnowledge(pack, { maxChars = Infinity } = {}) {
  // [ASSUMED] Shed detail in steps when a content set (plugins, a long translation) would exceed the budget.
  for (const limits of [{ trait: 90, item: 60, bond: 140, band: 110 }, { trait: 60, item: 0, bond: 100, band: 80 },
    { trait: 0, item: 0, bond: 60, band: 50 }]) {
    const view = slimView(pack, limits);
    if (JSON.stringify(view).length <= maxChars || !limits.trait) return view;
  }
  return null; // unreachable: the last step always returns
}

function slimView(pack, limits) {
  const pb = pack.playbook || {};
  const caps = new Map((pb.operators || []).map(o => [o.id, o.capabilities || {}]));
  const core = new Set((pack.bonds || []).filter(b => b.core).map(b => b.id));
  const bands = new Map((pb.bands || []).map(b => [b.id, b]));
  const mode = (pack.difficulties || []).find(d => d.id === pack.modeId);
  const e = pack.economy || {};
  return {
    schema: pack.schema, version: pack.version, language: pack.language, modeId: pack.modeId,
    ...(mode ? { difficulty: mode.difficulty, bossRound: mode.bossRound } : {}),
    rulesSummary: pack.rulesSummary,
    economy: { incomeByRound: e.incomeByRound, upgradePrices: e.upgradePrices, upgradeDiscountPerRound: e.upgradeDiscountPerRound,
      refreshPrice: e.refreshPrice, deployCap: e.deployCap, benchSize: e.benchSize, equipCap: e.equipCap, carryBands: e.carryBands,
      shop: (e.shop || []).map(l => ({ level: l.level, slots: l.slots,
        tierShares: (l.initialTierSharesBeforeBans || []).map(t => +Number(t.probability).toFixed(3)) })) },
    inactiveBonds: pb.inactiveBonds || [],
    bonds: { columns: ['id', 'name', 'kind', 'thresholds', 'effect'],
      rows: (pack.bonds || []).map(b => [b.id, b.name, b.core ? 'core' : 'class', b.thresholds, clip(b.effect, limits.bond)]) },
    // Normal pool forms only; an elite's id ends in _b. Pieces outside the pool (gifts, summons) carry names in the digest.
    operators: { columns: ['id', 'name', 'tier', 'bonds', 'class', 'caps', ...(limits.trait ? ['trait'] : [])],
      rows: (pack.operators || []).filter(o => o.poolEligible && !o.elite).map(o => [o.id, o.name, o.tier, o.bonds || [], o.class || '',
        CAPS.filter(k => caps.get(o.id)?.[k]).join('+'), ...(limits.trait ? [clip((o.traits || [])[0], limits.trait)] : [])]) },
    // strength: the bots' forced solo 终极 pool completion % with the band (§37.46, measured on the default version only:
    // another official version's pack, gameVersion, gets null); bond: the core bond the band supplies.
    bands: { columns: ['id', 'name', 'lp', 'bond', 'strength', 'carriesFunds', 'effect'],
      rows: (pack.bands || []).filter(b => !bands.size || bands.has(b.id)).map(b => [b.id, b.name, b.lp,
        (bands.get(b.id)?.bondIds || []).find(id => core.has(id)) || '', pack.gameVersion ? null : BAND_STRENGTH[b.id] ?? null,
        b.carriesFunds ? 1 : 0, clip(b.effect, limits.band)]) },
    items: { columns: ['id', 'name', 'tier', 'mergeCopies', ...(limits.item ? ['effect'] : [])],
      rows: (pack.items || []).map(i => [i.id, i.name, i.tier, i.mergeCopies || 0, ...(limits.item ? [clip(i.effect, limits.item)] : [])]) },
    // The maintainer's usual sub-bonds per main (2026-10-19, strategy-community.js); not measured on the bots (§37.41 F6).
    subBonds: Object.fromEntries((pb.community?.pairs || []).map(p => [p.main, p.subs])),
    leaderHitLimit: pb.leaderHitLimit,
  };
}
