// §35.13, maintainer 2026-10-19; §37.71: a plan's protection of pieces against the legacy executor's sales.
// Prices, carry bands and freeze mechanics remain PlayerEconomy/GameData's official-data rules.
import { advisorPlan, planContains } from './aiPlan.js';
import { computeBonds } from './bondsMeta.js';
import { countFree } from './board.js';

/**
 * §37.71 [ASSUMED]: a piece the plan's fields protect from the legacy sales (the shed, the junk sale, the arrangement's
 * withdrawals, the temp row, 缪尔赛思 sold on arrival, the Final Assault's bench sale): an explicit `buy` target bought
 * this prep, an exact `keep` id, or a member whose removal lowers an active `bonds` tier (the real counting rules:
 * normal/elite deduplication, hand-counted bonds, morphs and count bonuses). From R9 with at most one free hand slot a
 * benched normal `keep` of tier ≤ 4 that completes no merge is no longer protected (§35.63: LLM benches filled with 3.6
 * keep-listed pieces and the shed fell through to tier 5/6 carries). The §35.14 classes of 2026-10-20 (every elite and
 * tier ≥ 4 piece of an advisor seat) are gone: legacy's own guards (pairs, fresh pieces, carriers, faKeeps, pagerKeeps)
 * hold for every seat. No plan, or a plan without these fields: nothing is protected (legacy).
 */
export function planProtected(m, ps, piece) {
  const plan = advisorPlan(m, ps), gd = ps.gd || m.gd;
  if (!plan || piece?.kind !== 'chess') return false;
  if (ps._advisorBought?.round === m.round && ps._advisorBought.uids.has(piece.uid)) return true;
  if (planContains(m, plan.keep, piece.id)) {
    const crowded = m.round >= 9 && countFree(ps.hand) <= 1 && ![...ps.board.values()].some(p => p.uid === piece.uid);
    if (!(crowded && !gd.isGolden(piece.id) && gd.tierOf(piece.id) <= 4 && !ps.completesChessMerge(piece.id))) return true;
  }
  if (!plan.bonds?.length) return false;
  const before = computeBonds(gd, ps);
  const after = computeBonds(gd, { m: ps.m, board: new Map([...ps.board].filter(([, p]) => p.uid !== piece.uid)),
    hand: ps.hand.filter(p => p?.uid !== piece.uid), layers: ps.layers, bondCountBonus: ps.bondCountBonus });
  return plan.bonds.some(b => before[b.id]?.active && after[b.id]?.tier < before[b.id].tier);
}
