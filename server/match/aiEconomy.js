// §35.13, maintainer 2026-10-19. [ASSUMED] Procurement/bank policy, not a gameplay rule.
// Prices, carry bands and freeze mechanics remain PlayerEconomy/GameData's official-data rules.
import { advisorPlan, planContains, planBuyTarget, planCopyUseful, ownsElite } from './aiPlan.js';
import { computeBonds } from './bondsMeta.js';

// An explicitly empty plan remains the legacy delegation escape hatch (§35.9).
export function economyPlan(m, ps) {
  const plan = advisorPlan(m, ps);
  return plan && Object.keys(plan).length ? plan : null;
}

export function advisorWanted(m, ps, id) {
  const plan = economyPlan(m, ps);
  if (!plan || planContains(m, plan.sell, id)) return false;
  if (planBuyTarget(m, ps, id)) return true;
  const gd = ps.gd || m.gd;
  return planCopyUseful(m, ps, id)
    && !!plan.bonds?.some(b => !gd.modeInactiveBonds.has(b.id) && gd.chess(id)?.bonds?.includes(b.id));
}

// Maintainer 2026-10-20 (§35.14), [ASSUMED] execution policy: incidental bond/keep matches never freeze.
export function advisorFreezeTarget(m, ps, id) {
  return !ownsElite(m, ps, id) && (planBuyTarget(m, ps, id) || ps.completesChessMerge(id));
}

export function advisorProtected(m, ps, piece) {
  const plan = economyPlan(m, ps), gd = ps.gd || m.gd;
  if (!plan || piece?.kind !== 'chess') return false;
  if (gd.isGolden(piece.id) || gd.tierOf(piece.id) >= 4 || planContains(m, plan.keep, piece.id)
    || (ps._advisorBought?.round === m.round && ps._advisorBought.uids.has(piece.uid))) return true;
  if (!plan.bonds?.length) return false;
  // Use the real counting rules (normal/elite deduplication, hand-counted bonds, morphs and count bonuses).
  const before = computeBonds(gd, ps);
  const after = computeBonds(gd, { m: ps.m, board: new Map([...ps.board].filter(([, p]) => p.uid !== piece.uid)),
    hand: ps.hand.filter(p => p?.uid !== piece.uid), layers: ps.layers, bondCountBonus: ps.bondCountBonus });
  return plan.bonds.some(b => before[b.id]?.active && after[b.id]?.tier < before[b.id].tier);
}

// [ASSUMED] Within a class use the executor's piece value, then UID for a stable tie break.
export function advisorSaleRank(m, ps, p) {
  if (ownsElite(m, ps, p.id)) return 0;
  if (ps._advisorBankUids?.has(p.uid)) return 1;
  const plan = economyPlan(m, ps);
  return (ps.gd || m.gd).tierOf(p.id) <= 3 && !advisorWanted(m, ps, p.id)
    && !planContains(m, plan?.keep, p.id) ? 2 : 3;
}

export function advisorBanks(m, ps) {
  // A bank promoted into the lineup, equipped, wanted by a newer plan or part of a merge is no longer disposable.
  const gd = ps.gd || m.gd;
  return ps.hand.filter(p => p?.kind === 'chess' && ps._advisorBankUids?.has(p.uid)
    && !gd.isGolden(p.id) && !p.items?.length && !advisorWanted(m, ps, p.id) && !advisorProtected(m, ps, p)
    && !ps.completesChessMerge(p.id));
}

export function fundAdvisorPurchase(m, ps, slot) {
  if (!slot || slot.sold || slot.kind !== 'chess' || !advisorWanted(m, ps, slot.id)) return;
  const banks = advisorBanks(m, ps);
  // [ASSUMED] Keep stored value if even all base refunds cannot fund this purchase; sale hooks can only be
  // evaluated by making the real sale, so do not speculate about their additional proceeds.
  if (ps.funds + banks.reduce((n, p) => n + ps.gd.sellPrice(p.id), 0) < ps.priceOf(slot)) return;
  for (const p of banks) {
    if (ps.funds >= ps.priceOf(slot) && ps.hand.some(p => !p)) break;
    if (ps.sell(p.uid)?.ok) ps._advisorBankUids.delete(p.uid);
  }
}
