// Regulation's briefing choice. No extra RNG: ties keep the seeded first group.
import { planMain } from './aiPlan.js';

export function botPickBondGroup(m, ps) {
  const main = planMain(m, ps)
    ?? m.gd.bandBondIds(ps.bandId).find(id => m.gd.bond(id)?.isCore)
    ?? ps._botFocusId;
  const idx = m.bondChoice?.groups.findIndex(group => group.includes(main)) ?? -1;
  return idx < 0 ? 0 : idx;
}

/** Covenant's drawn bonds still have members; regulation's unavailable pool must guide its plans and draft. */
export function botBondUnavailable(m, id) {
  return m.gd.modeInactiveBonds.has(id) || (m.gd.regulationBondDraw && !m.bondLive(id));
}
