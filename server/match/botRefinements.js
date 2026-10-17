// Historical benchmark labels from c24e17ee. Preview, capacity and cheap are now upstream baseline behavior.
// Only guards/medics select additional local repair candidates; archived ablations predate the 0.3.0 merge.
// [ASSUMED] AI heuristics only; no game rules or boss-layout changes.
export const BOT_REFINEMENTS = ['preview', 'capacity', 'guards', 'medics', 'cheap'];
export const RECOMMENDED_REFINEMENTS = Object.freeze(['preview', 'capacity']);
export function defaultBotRefinements(m) {
  return m.botIoletaPolicy === 'experimental' && m.botFormationEnabled === false ? RECOMMENDED_REFINEMENTS : [];
}
export function botRefinement(m, key) {
  return (m.botRefinements ?? defaultBotRefinements(m)).includes(key);
}
