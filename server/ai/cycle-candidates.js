// §35.12. [ASSUMED] Conservative economy-cycle eligibility and scores; no hidden stock, trade execution or profit promise.
const unique = xs => [...new Set(xs)];
const cheap = (a, b) => a.tier - b.tier || a.cost - b.cost || a.id.localeCompare(b.id);

export function cycleCandidates(book, digest, { operators, disabled, held, teammates, bands, profile, previousMain }) {
  const cycle = book.cycles, build = book.community.builds.find(b => b.id === cycle?.build);
  if (!cycle?.available || !build || cycle.engine.some(e => disabled.has(e.id))) return [];
  const byId = new Map(operators.map(c => [c.id, c]));
  const currentLevel = digest.economy?.level || 1, round = digest.round || 1;
  const draft = (digest.actions || []).filter(a => a.intent.t === 'g.band');
  if (!draft.length && !Number.isFinite(digest.economy?.gold)) return []; // Budget is unknown in an incomplete digest.
  const state = id => digest.bonds?.find(b => b.bondId === id);
  const active = cycle.engine.every(e => state(e.id)?.active);
  const ownBoard = (digest.board || []).map(p => byId.get(p.baseId || p.id.replace(/_b$/, '_a'))).filter(Boolean);
  const missing = profile.needs.filter(k => !ownBoard.some(c => c.capabilities[k]));
  const battle = digest.feedback?.lastBattle;
  // [ASSUMED] Do not start an engine after R10; LP <=10, >=3 leaks, or leaks with uncovered counters block early setup.
  if (!draft.length && ((!active && round > 10) || (round <= 7 && ((digest.lp != null && digest.lp <= 10)
    || battle?.leaks >= 3 || (battle?.leaks > 0 && missing.length))))) return [];
  const engineIds = cycle.engine.map(e => e.id);
  const cheapEngine = operators.filter(c => c.tier <= build.shopHold && c.bonds.some(id => engineIds.includes(id))).map(c => c.id);
  const conflicts = teammates.filter(t => t.mains.some(id => engineIds.includes(id)) || t.board.filter(id => cheapEngine.includes(id)).length >= 2);
  if (conflicts.length) return []; // Public contest over the engine's cheap pool; no inference about remaining copies.
  const all = [];
  for (const variant of cycle.variants) {
    const main = variant.damageBonds.find(id => !disabled.has(id));
    if (!main || teammates.some(t => t.mains.includes(main))) continue;
    const feeds = variant.cycleMembers.map(id => byId.get(id)).filter(Boolean).filter(c => c.events.some(e => e.event === 'SERVER_GAIN' &&
      (e.kind === 'layers' && (e.target === 'highest-active' || e.bonds.includes(main)) || e.kind === 'operators')));
    if (!feeds.length) continue;
    // Hold is a level-up ceiling, NOT g.freeze. Adapt the old L4 recipe only to data/known owned exceptions.
    let hold = null;
    for (let level = Math.max(build.shopHold, currentLevel); level <= book.maxShopLevel; level++) {
      if (cycle.engine.every(e => operators.filter(c => e.members.includes(c.id) && (held.has(c.id) || c.tier <= level)).length >= e.need)
        && feeds.some(c => c.tier <= level)
        && (cycle.foresight.income?.funds > 0 || cycle.fundsSources.some(id => byId.has(id) && (byId.get(id).tier <= level || held.has(id))))
        && cycle.foresight.growers.some(id => byId.has(id) && (byId.get(id).tier <= level || held.has(id)))
        && cycle.investor.growers.some(id => byId.has(id) && (byId.get(id).tier <= level || held.has(id)))) { hold = level; break; }
    }
    if (hold === null) continue;
    const engineMembers = unique(cycle.engine.flatMap(e => operators.filter(c => e.members.includes(c.id) && (c.tier <= hold || held.has(c.id))).map(c => c.id)));
    const funds = cycle.fundsSources.filter(id => byId.has(id) && (byId.get(id).tier <= hold || held.has(id)));
    const growth = unique([...cycle.foresight.growers, ...cycle.investor.growers]).filter(id => byId.has(id) && (byId.get(id).tier <= hold || held.has(id)));
    const cycleMembers = feeds.filter(c => c.tier <= hold).sort(cheap).map(c => c.id);
    const support = variant.acquisitionSupport.filter(id => byId.has(id) && (byId.get(id).tier <= hold || held.has(id)));
    for (const band of bands) {
      if (band.bondIds.some(id => disabled.has(id)) || (band.bondIds.length && !band.bondIds.includes(main))) continue;
      if (variant.band && band.id !== variant.band) continue;
      const heldItems = [...(digest.bench || []), ...(digest.board || []), ...(digest.overflow || [])]
        .flatMap(p => [p.id, ...(p.items || []).map(i => i.id)]);
      const packageOwned = cycle.packages.some(p => heldItems.includes(p.id));
      // Current visible catalogue or this band's publicly specified starting grant; never assume a random gift.
      const packageReachable = !variant.package || packageOwned || cycle.packages.some(p => p.tier <= hold) || band.grantedItems?.some(id => cycle.packages.some(p => p.id === id));
      if (!packageReachable) continue;
      const ownFunds = Number(digest.economy?.gold) > 0;
      const prepIncome = state(cycle.foresight.id)?.active && state(cycle.foresight.id)?.layers >= cycle.foresight.income?.every;
      const offered = (digest.shop || []).filter(s => s && !s.sold).map(s => s.id);
      const ready = active && currentLevel >= hold && ownFunds && (!variant.package || packageOwned)
        && cycleMembers.some(id => held.has(id) || offered.includes(id));
      const investment = engineMembers.filter(id => held.has(id)).length;
      const engineLayers = cycle.engine.reduce((n, e) => n + (state(e.id)?.layers || 0), 0);
      const scoreParts = { cycle: 18, engine: band.bondIds.includes(main) ? 16 : 0,
        progress: Math.min(6, investment) * 3, active: active ? 14 : 0, layers: Math.min(12, engineLayers / 20),
        support: (variant.band === band.id ? 8 : 0) + (variant.package && band.grantedItems?.some(id => cycle.packages.some(p => p.id === id)) ? 6 : 0),
        continuity: previousMain === main || engineIds.includes(previousMain) ? 14 : 0,
        setup: -2 * Math.max(0, hold - currentLevel), pressure: -4 * missing.length,
        funds: ownFunds ? 3 : 0, dilution: -3 * Math.max(0, currentLevel - build.shopHold),
      };
      const early = unique([...engineMembers, ...growth, ...funds]).map(id => byId.get(id)).filter(c => c.tier <= 3).sort(cheap).map(c => c.id);
      all.push({ id: `${band.id}:meter-backwards:${variant.id}:${main}`, build: build.id, variant: variant.id,
        band: band.id, role: 'economy', archetype: 'cycle', main, subs: engineIds,
        score: +Object.values(scoreParts).reduce((a, b) => a + b, 0).toFixed(2), scoreParts,
        ...(draft.length ? { choice: draft.find(a => a.intent.bandId === band.id)?.id } : {}),
        status: ready ? 'ready' : 'setup', shopHold: hold, source: variant.source, adaptation: hold !== build.shopHold || variant.missing.length > 0,
        preconditions: { investors: { active: !!state(cycle.investor.id)?.active, need: cycle.engine.find(e => e.id === cycle.investor.id).need },
          foresight: { active: !!state(cycle.foresight.id)?.active, discounts: cycle.foresight.discounts },
          shop: { current: currentLevel, hold, naturalMinimum: cycle.minimumShopLevel },
          funds: { spendableNow: ownFunds, milestoneEngineActive: !!prepIncome, sources: funds, timing: 'Operator funds are next-round; milestone payouts need new crossings.' },
          package: { required: !!variant.package, owned: packageOwned, reachable: packageReachable } },
        members: { engine: engineMembers, cycle: cycleMembers, acquisitionSupport: support, growth, funds },
        damageBonds: variant.damageBonds.filter(id => !disabled.has(id)), missingCoverage: missing,
        coverageRepairs: profile.needs.map(need => ({ need, options: operators.filter(c => c.capabilities[need]).sort(cheap).slice(0, 2).map(c => c.id) })),
        implications: band.insights,
        stages: [
          { stage: 'R1-3', keys: early, goal: build.stages[0] },
          { stage: 'R4-7', keys: unique([...engineMembers, ...growth]), goal: `Reach shop ${hold} if survival permits; activate the engine before buy/sell cycling.` },
          { stage: 'R8-10', keys: unique([...cycleMembers, ...support]), goal: build.stages[2] },
          { stage: 'late', keys: cycleMembers, goal: build.stages[3] },
        ],
        pivotConditions: [...build.avoid, 'Cannot maintain distinct engine members, usable funds and a survival board.',
          'Observed purchase/refund costs or available stock do not sustain the cycle; stop, do not assume infinite profit.'],
        safeguards: [cycle.saleRule, cycle.acquisitionRule, 'Keep engine members and packaging carrier; cycle only surplus acquisitions.',
          'Pending income is not spendable this round. Three priority bonds do not restrict incidental damage bonds.',
          'Advice only: ID-level plans do not express an automated repeated buy/sell loop.'],
      });
    }
  }
  return all;
}
