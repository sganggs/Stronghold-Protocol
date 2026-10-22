// §35.12. [ASSUMED] Reproducible candidate policy, not an optimizer or official build prescription.
// Only a static playbook and the existing seat-visible digest enter this module. No Match/GameData/live pool.
import { cycleCandidates } from './cycle-candidates.js';
import { communityCandidates } from './community-candidates.js';
const unique = xs => [...new Set(xs)];
const rank = (a, b) => b.score - a.score || a.id.localeCompare(b.id);
const cheap = (a, b) => a.tier - b.tier || a.cost - b.cost || a.id.localeCompare(b.id);

function collapseDirections(list) {
  const groups = new Map(), named = [];
  for (const c of list) {
    if (c.build) { named.push(c); continue; }
    const key = `${c.band}:${c.main}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const collapsed = [];
  for (const [key, group] of groups) {
    group.sort(rank);
    const best = group[0];
    collapsed.push({ ...best, id: key, subOptions: group.map(c => ({ subs: c.subs, score: c.score })) });
  }
  return [...collapsed, ...named];
}

export function enemyProfile(playbook, digest) {
  const types = new Set(digest.factions || []), ids = new Set((digest.upcoming || []).map(e => e.enemyKey));
  const boss = playbook.bosses.find(b => b.id === digest.boss?.id);
  if (boss) for (const id of [boss.enemyKey, ...boss.escorts]) ids.add(id);
  const enemies = playbook.enemies.filter(e => ids.has(e.id));
  for (const e of enemies) for (const type of e.types) types.add(type);
  if (enemies.some(e => e.fly) || digest.upcoming?.some(e => e.fly)) types.add('FLY');
  const needs = [];
  if (types.has('FLY')) needs.push('air');
  if (types.has('INVISIBLE')) needs.push('reveal');
  if (types.has('ELEMENT')) needs.push('elementRecovery');
  return { types: [...types].sort(), needs, boss: boss?.id || null,
    // [ASSUMED] These warning cutoffs are planning heuristics, not damage rules.
    highDef: enemies.some(e => e.def >= 500), highRes: types.has('REFLECTION') || enemies.some(e => e.res >= 50),
    repeatedHits: types.has('TIMES') || !!boss,
    checks: ['Blocking and healing before extra damage.',
      ...(types.has('INVISIBLE') ? ['Reveal hints depend on range/skill; blocking can expose blockable stealth enemies.'] : []),
      ...(types.has('ELEMENT') ? ['Element offense is not element recovery; check healing range and burst timing.'] : []),
      ...(types.has('DOT') ? ['Sustain and spacing against damage over time.'] : []),
      ...(types.has('TIMES') ? ['Hit-count enemies require attack frequency; raw attack power is insufficient.'] : []),
      ...(boss ? [playbook.lateRule, ...boss.abilities] : [])] };
}

// [ASSUMED] Band draft returns at most eight directions and keeps every uncontended community/maintainer
// main that still fits. Prep collapses same band+main sub variants into one stable id. Scores stay decomposed.
const DRAFT_CAP = 8, PREP_CAP = 4;
export function strategyCandidates(playbook, digest, previousPlan = null) {
  if (!playbook) return { candidates: [], reason: 'No versioned playbook in this knowledge pack.' };
  const disabled = new Set([...playbook.inactiveBonds, ...(digest.availability?.disabledBonds || [])]);
  const banned = new Set([...(digest.availability?.bannedChess || []), ...(digest.availability?.diyBanned || [])]);
  const operators = playbook.operators.filter(c => !banned.has(c.id));
  const byId = new Map(operators.map(c => [c.id, c]));
  const held = new Set([...(digest.board || []), ...(digest.bench || [])].map(p => p.baseId || p.id.replace(/_b$/, '_a')));
  const previousMain = previousPlan?.bonds?.slice().sort((a, b) => b.priority - a.priority)[0]?.id;
  const teammates = (digest.opponents || []).map(t => {
    const band = playbook.bands.find(b => b.id === t.bandId);
    return { playerId: t.playerId, bandId: t.bandId,
      mains: unique([...(band?.bondIds || []), ...(band?.communityMain ? [band.communityMain.main] : []),
        ...(t.bonds || []).filter(b => b.active).map(b => b.bondId)]),
      board: (t.board || []).map(p => p.id.replace(/_b$/, '_a')) };
  });
  const profile = enemyProfile(playbook, digest);
  const contested = id => teammates.filter(t => t.mains.includes(id)).length;
  const taken = id => teammates.filter(t => t.board.includes(id)).length;
  const legal = playbook.bonds.filter(b => !disabled.has(b.id) && !b.eliteOnly && !b.noStack &&
    operators.filter(c => c.bonds.includes(b.id)).length >= b.thresholds[0]?.count);
  const draft = (digest.actions || []).filter(a => a.intent.t === 'g.band');
  const bands = playbook.bands.filter(b => draft.length ? draft.some(a => a.intent.bandId === b.id) : b.id === digest.band?.id);
  const earlyWeakTeammates = teammates.filter(t => t.mains.some(id => {
    const members = operators.filter(c => c.bonds.includes(id) && c.tier <= 3);
    return members.length < 3 || profile.needs.some(k => !members.some(c => c.capabilities[k]));
  })).length;
  const all = [];
  for (const band of bands) {
    if (band.bondIds.some(id => disabled.has(id))) continue;
    for (const main of legal) {
      // Explicit data engines stay tied to their mechanic. Community advice never overwrites that constraint.
      if (band.bondIds.length && !band.bondIds.includes(main.id)) continue;
      const members = operators.filter(c => c.bonds.includes(main.id));
      const communityRole = playbook.community.roles.find(r => r.band === band.id);
      const role = communityRole?.role === 'supplier' && !teammates.length ? 'carry'
        : communityRole?.role || (band.roleClasses.includes('economy') && !band.bondIds.length ? 'economy' : 'carry');
      const preferred = playbook.community.pairs.find(p => p.main === main.id)?.subs || [];
      const options = legal.filter(b => b.id !== main.id).map(b => {
        const edge = playbook.graph.find(e => e.bonds.includes(main.id) && e.bonds.includes(b.id));
        return { id: b.id, score: (edge?.weight || 0) * 4 + (preferred.includes(b.id) ? 3 : 0) - contested(b.id) * 3,
          shared: (edge?.operators || []).filter(id => byId.has(id)) };
      }).filter(p => p.score > 0).sort(rank).slice(0, 3);
      const variants = options.length >= 3 ? [[options[0], options[1]], [options[0], options[2]], [options[1], options[2]], [options[0]]]
        : options.length === 2 ? [options, [options[0]], [options[1]]] : [options];
      for (const pairings of variants) {
        const subs = pairings.map(p => p.id), core = operators.filter(c => c.bonds.some(id => [main.id, ...subs].includes(id)));
        const early = members.filter(c => c.tier <= 3);
        const missing = profile.needs.filter(k => !core.some(c => c.capabilities[k]));
        const earlyMissing = profile.needs.filter(k => !early.some(c => c.capabilities[k]));
        const progress = members.filter(c => held.has(c.id)).length;
        const scoreParts = {
          engine: band.bondIds.includes(main.id) ? 16 : 0,
          community: band.communityMain?.main === main.id ? 8 : 0,
          earlyAccess: Math.min(early.length, 5) * 2,
          timing: -(main.thresholds[0]?.estimatedRound ?? 16),
          progress: progress * 5, continuity: previousMain === main.id ? 14 : 0,
          contention: -24 * contested(main.id) - members.filter(c => taken(c.id)).length * 2,
          coverage: (profile.needs.length - missing.length) * 4 - missing.length * 9 - earlyMissing.length * 3,
          pairing: Math.min(6, pairings.reduce((n, p) => n + p.score, 0)),
          role: communityRole?.main === main.id ? 6 + earlyWeakTeammates * 4
            : role === 'supplier' ? earlyWeakTeammates * 5 : 0,
          defense: (profile.highDef && core.some(c => c.dmgType === 'arts') ? 2 : 0)
            + (profile.highRes && core.some(c => c.dmgType === 'phys') ? 2 : 0),
        };
        const keyOrder = (a, b) => Number(held.has(b.id)) - Number(held.has(a.id)) ||
          Number(b.bonds.includes(main.id)) - Number(a.bonds.includes(main.id)) || taken(a.id) - taken(b.id) || cheap(a, b);
        const keys = (min, max) => core.filter(c => c.tier >= min && c.tier <= max).sort(keyOrder).slice(0, 4).map(c => c.id);
        const single = band.insights.find(i => i.kind === 'single-bond');
        const repair = profile.needs.map(need => ({ need, options: operators.filter(c => c.capabilities[need])
          .sort((a, b) => taken(a.id) - taken(b.id) || cheap(a, b)).slice(0, 2).map(c => c.id) }));
        const supplierTargets = role === 'supplier' ? teammates.map(t => ({ playerId: t.playerId,
          operators: operators.filter(c => c.bonds.some(id => t.mains.includes(id)) && !t.board.includes(c.id))
            .sort(cheap).slice(0, 3).map(c => c.id) })) : [];
        all.push({ id: `${band.id}:${main.id}:${subs.join('+')}`, band: band.id, role, main: main.id, subs,
          score: +Object.values(scoreParts).reduce((a, b) => a + b, 0).toFixed(2), scoreParts,
          ...(draft.length ? { choice: draft.find(a => a.intent.bandId === band.id)?.id } : {}),
          currentStage: digest.round <= 3 ? 'R1-3' : digest.round <= 7 ? 'R4-7' : digest.round <= 10 ? 'R8-10' : 'late',
          stages: [
            { stage: 'R1-3', keys: keys(1, 3), goal: 'Survive with cheap blockers, air coverage and healing; merge offered pairs.' },
            { stage: 'R4-7', keys: keys(1, 4), goal: single ? `Enter R${single.parameters.round} with exactly ${single.parameters.factioncount} active stacking bond; watch incidental activations.` : 'Reach main thresholds; upgrade when survival permits.' },
            { stage: 'R8-10', keys: keys(2, 6), goal: 'Complete elites and sub-bonds; widen only after any single-bond check.' },
            { stage: 'late', keys: keys(4, 6), goal: 'Leader/hidden core: repeated sub-limit hits, sustain and announced enemy counters.' },
          ],
          missingCoverage: missing, earlyMissingCoverage: earlyMissing, coverageRepairs: repair, supplierTargets,
          implications: band.insights, thresholdEstimates: main.thresholds, pairings,
          pivotConditions: ['Announced ban or no feasible threshold after purchases.',
            'Public teammate competition outweighs existing layers and merges.',
            'Observed leaks or announced enemy/boss counters remain uncovered.',
            'An offered elite/merge materially improves survival; explain lost investment.'],
        });
      }
    }
  }
  all.push(...cycleCandidates(playbook, digest, { operators, disabled, held, teammates, bands, profile, previousMain }));
  all.push(...communityCandidates(playbook, digest, { operators, disabled, held, teammates, bands, profile, previousMain }));
  all.sort(rank);
  const preparing = draft.length === 0;
  // Named builds and cycles keep their own ids. Only the generic sub-variants (same band and main, different
  // subs, identical stages) collapse. The id is band:main so a later sub reorder does not look like a new direction.
  // Collapse appends named builds after the generics. Sort again so a higher-scoring recipe still
  // occupies its main's slot the way the pre-collapse ranking did.
  const pool = (preparing ? collapseDirections(all) : all).sort(rank);
  const cap = preparing ? PREP_CAP : DRAFT_CAP;
  const selected = [], chosen = new Set(), mains = new Set();
  if (!preparing) {
    const wanted = new Set();
    for (const band of playbook.bands) {
      if (band.communityMain?.main) wanted.add(`${band.id}:${band.communityMain.main}`);
      for (const role of playbook.community?.roles || []) if (role.band === band.id && role.main) wanted.add(`${role.band}:${role.main}`);
    }
    const best = new Map();
    for (const c of pool) {
      const key = `${c.band}:${c.main}`;
      if (!wanted.has(key) || contested(c.main) > 0) continue;
      const prev = best.get(key);
      if (!prev || rank(c, prev) < 0) best.set(key, c);
    }
    for (const c of [...best.values()].sort(rank)) {
      if (selected.length >= cap) break;
      selected.push(c); chosen.add(c.id); mains.add(c.main);
    }
  }
  for (const c of pool) if (!mains.has(c.main) && selected.length < cap && !chosen.has(c.id)) {
    selected.push(c); mains.add(c.main); chosen.add(c.id);
  }
  // Draft may still show another band once every uncontended community main that fits is present.
  // Prep does not refill with another copy of the same generic direction; a named build may still take a free slot.
  if (!preparing) {
    for (const c of pool) if (selected.length < cap && !chosen.has(c.id)) { selected.push(c); chosen.add(c.id); }
  } else {
    for (const c of pool) if (c.build && selected.length < cap && !chosen.has(c.id)) { selected.push(c); chosen.add(c.id); }
  }
  for (const c of selected) {
    // [ASSUMED] Cost/discount schedule supplies timing; stage keys supply required shop access. Public copy
    // shares, not fixed tier odds: staying low gives ZERO normal-roll chance for a higher-tier key operator.
    c.levelCurve = [4, 7, 10, 13].map(round => {
      const stage = c.stages.find(s => s.stage === (round <= 7 ? 'R4-7' : round <= 10 ? 'R8-10' : 'late'));
      const requiredTier = Math.max(1, ...(stage?.keys || []).map(id => byId.get(id)?.tier || 1));
      const baseline = playbook.recommendedSchedule.find(r => r.round === round)?.level || 1;
      // Include future main/sub members and proposed counter repairs: a short cheap stage-key list alone
      // must not recommend staying at L2 while the same build still needs a T5/6 member.
      const targetTier = Math.max(requiredTier, ...operators.filter(op => op.bonds.some(b => [c.main, ...c.subs].includes(b)))
        .map(op => op.tier), ...(c.coverageRepairs || []).flatMap(r => r.options.map(id => byId.get(id)?.tier || 1)));
      const level = Math.min(c.shopHold || playbook.maxShopLevel, targetTier, baseline);
      const eligible = operators.filter(op => op.tier <= level), total = eligible.reduce((n, op) => n + op.poolCopies, 0);
      return { round, level, requiredTier, targetTier, inaccessibleKeys: (stage?.keys || []).filter(id => (byId.get(id)?.tier || 1) > level),
        keyDrawShareBeforePurchases: total ? eligible.filter(op => stage?.keys?.includes(op.id)).reduce((n, op) => n + op.poolCopies, 0) / total : 0,
        basis: '[ASSUMED] maintainer tempo with data income/upgrade discounts, stage-key tiers and public copy shares after bans; no live stock. Explain delays or a deliberate level hold in why' };
    });
  }
  return { policy: '[ASSUMED] heuristic scores; public catalogue only, remaining copies unknown',
    profile, teammates, candidates: selected.sort(rank),
    ...(selected.length < 2 ? { reason: 'Fewer than two legal distinct archetypes in this observation.' } : {}) };
}
