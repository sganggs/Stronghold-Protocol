// §35.12. [ASSUMED] Named combat recipes use catalogue reachability, not hidden stock or guaranteed offers.
// Official mechanics and the maintainer-supplied sources/disagreements stay in the versioned playbook.
const unique = xs => [...new Set(xs)];
const cheap = (a, b) => a.tier - b.tier || a.cost - b.cost || a.id.localeCompare(b.id);

export function communityCandidates(book, digest, { operators, disabled, held, teammates, bands, profile, previousMain }) {
  const all = [], draft = (digest.actions || []).filter(a => a.intent.t === 'g.band');
  const byId = new Map(operators.map(c => [c.id, c]));
  for (const build of book.community.builds.filter(b => b.available && b.coreGroups?.length)) {
    const main = build.bonds[0], bond = book.bonds.find(b => b.id === main);
    if (disabled.has(main) || !bond || bond.eliteOnly || bond.noStack) continue;
    // [ASSUMED] Plan future normal-shop access up to the mode limit; already held high-tier gifts are usable.
    // A reachable catalogue is not an assertion that any remaining copies can be bought this round.
    let minimumShopLevel = null;
    const reachable = (c, level) => held.has(c.id) || c.tier <= level;
    for (let level = 1; level <= book.maxShopLevel; level++) {
      if (build.coreGroups.every(g => g.options.some(id => byId.has(id) && reachable(byId.get(id), level))) &&
        operators.filter(c => c.bonds.includes(main) && reachable(c, level)).length >= bond.thresholds[0]?.count) {
        minimumShopLevel = level; break;
      }
    }
    if (minimumShopLevel === null) continue;
    const accessible = operators.filter(c => reachable(c, book.maxShopLevel));
    const members = build.members.filter(m => m.id && byId.has(m.id) && reachable(byId.get(m.id), book.maxShopLevel));
    const subs = build.subs.filter(id => !disabled.has(id) && book.bonds.some(b => b.id === id && !b.eliteOnly && !b.noStack &&
      accessible.filter(c => c.bonds.includes(id)).length >= b.thresholds[0]?.count)).slice(0, 2);
    const core = unique([...members.map(m => m.id), ...accessible.filter(c => c.bonds.some(id => [main, ...subs].includes(id))).map(c => c.id)])
      .map(id => byId.get(id));
    const missing = profile.needs.filter(need => !core.some(c => c.capabilities[need]));
    const repairs = profile.needs.map(need => ({ need, options: accessible.filter(c => c.capabilities[need]).sort(cheap).slice(0, 2).map(c => c.id) }));
    const heldCore = build.coreGroups.every(g => g.options.some(id => held.has(id) && byId.has(id)));
    for (const band of bands) {
      if (band.bondIds.some(id => disabled.has(id)) || (band.bondIds.length && !band.bondIds.includes(main))) continue;
      if (book.community.roles.some(r => r.band === band.id)) continue; // Preserve the explicit safety-net/supplier policy.
      // [ASSUMED] Specific actionable recipes compete with generic variants, but lose priority to public
      // contention and missing counters. These weights are not measured win-rate or official balance claims.
      const scoreParts = { recipe: 22, engine: band.bondIds.includes(main) ? 16 : 0,
        community: band.communityMain?.main === main ? 8 : 0,
        progress: Math.min(5, members.filter(m => held.has(m.id)).length) * 5,
        continuity: previousMain === main ? 14 : 0,
        access: -2 * Math.max(0, minimumShopLevel - (digest.economy?.level || 1)),
        contention: -24 * teammates.filter(t => t.mains.includes(main)).length
          -2 * members.filter(m => teammates.some(t => t.board.includes(m.id))).length,
        coverage: -9 * missing.length };
      all.push({ id: `${band.id}:${build.id}`, build: build.id, band: band.id,
        role: band.roleClasses.includes('economy') && !band.bondIds.length ? 'economy' : 'carry', archetype: build.archetype,
        main, subs, scoreParts, score: Object.values(scoreParts).reduce((a, b) => a + b, 0),
        ...(draft.length ? { choice: draft.find(a => a.intent.bandId === band.id)?.id } : {}),
        // Readiness is deliberately not asserted: placement, skill/loadout and actual combat triggers still need review.
        status: heldCore && digest.bonds?.some(b => b.bondId === main && b.active) ? 'core-held' : 'setup',
        minimumShopLevel, shopTiming: build.shopTiming, sources: build.sources, preconditions: build.preconditions,
        counters: build.counters, weaknesses: build.avoid, substitutes: build.substitutes, disagreements: build.disagreements,
        members: members.map(m => m.id), missingCoverage: missing, coverageRepairs: repairs, implications: band.insights,
        stages: build.stages.map(s => ({ stage: s.stage, goal: s.goal,
          keys: members.filter(m => s.roles.includes(m.role) && (s.stage !== 'R1-3' || m.tier <= 3)).map(m => m.id) })),
        pivotConditions: [...build.avoid, 'Core member or active threshold is banned/unreachable; preserve survival and consider the documented substitutes.',
          'Public teammate competition or observed leaks outweigh the investment; remaining stock is unknown.'],
      });
    }
  }
  return all;
}
