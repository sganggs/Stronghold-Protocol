// §35.12. [ASSUMED] Reproducible candidate policy, not an optimizer or official build prescription.
// Only a static playbook and the existing seat-visible digest enter this module. No Match/GameData/live pool.
import { cycleCandidates } from './cycle-candidates.js';
import { communityCandidates, finalAssaultScore } from './community-candidates.js';

// Round 65: the built-in bot's measured priors for the example advisor ("the bot is the floor, the LLM overrides"),
// copied from server/match/bot.js so the advisor never imports the executor; test/match/llm-adapter-v2.test.js keeps them
// equal. Static catalogue data only: no match, live shared pool, private view or RNG.
/**
 * §37.46: the bots' own strength with each band of the default version — 终极 solo pool completion (%) of 80 forced games
 * per band (bot.js BAND_STRENGTH, dev 17a075f1, handoff/round57). The bot's 终极 draft weight multiplies the LP weight by
 * ((mean + 0.7 × (strength − mean)) / 50)^6; a band missing from the table (plugin data) counts as the mean.
 */
export const BAND_STRENGTH = Object.freeze({
  band_amiya: 51.8, band_bldsk: 51.2, band_sciurus: 48.1, band_quintus: 47.7, band_ermengard: 47.2, band_qalaisa: 47.2,
  band_sarkazb: 47.1, band_mlyss: 46.5, band_cannot: 45.1, band_amedic: 44.6, band_ioleta: 43.0, band_harold: 42.9,
  band_chen: 42.3, band_makiri: 42.2, band_emperor: 41.6, band_dusk: 40.5, band_ducklord: 40.2, band_kirara: 39.9,
  band_yu: 39.9, band_jesica: 39.3, band_doberm: 39.2, band_orchid: 39.2, band_cathy: 38.8, band_chiave: 38.2,
  band_duyaoy: 35.8, band_mberry: 35.6, band_damaztic: 34.2, band_paganini: 33.8, band_humus: 32.0, band_malkie: 31.9,
  band_fang: 31.4, band_narant: 31.4, band_lisa: 31.3, band_pepe: 30.6, band_vodfox: 29.5, band_lmlee: 29.2,
  band_pith: 28.5, band_justin: 28.3, band_mlynar: 25.1, band_clementia: 18.6,
});
const STRENGTH_MEAN = Object.values(BAND_STRENGTH).reduce((s, v) => s + v, 0) / Object.keys(BAND_STRENGTH).length;
const STRENGTH_SHRINK = 0.7, STRENGTH_POWER = 6;

/** §37.46: bot.js bandStrength — the 终极 pick multiplier of band `id`, 1 on every other difficulty. */
export function bandStrength(difficulty, id) {
  if (difficulty !== 'ABYSS') return 1;
  const s = Object.hasOwn(BAND_STRENGTH, id) ? BAND_STRENGTH[id] : STRENGTH_MEAN;
  return ((STRENGTH_MEAN + STRENGTH_SHRINK * (s - STRENGTH_MEAN)) / 50) ** STRENGTH_POWER;
}

/** §37.34 / §37.39: bot.js botPickBand's LP weight, max(1, (LP − 18)²), cubed on 终极 (solo and co-op). */
export const lpWeight = (lp, difficulty) => Math.max(1, (lp - 18) ** (difficulty === 'ABYSS' ? 3 : 2));

/**
 * §37.41: the bots' 终极 solo pool completion (%) by final focus bond (17155c3c, seeds 1–80), the data behind bot.js
 * FOCUS_PRIOR ((share − 45) / 3 points in solo). Bonds not listed were never a final focus often enough to measure.
 */
export const FOCUS_SHARE = Object.freeze({ sargonShip: 65.8, kjeragShip: 60.1, lateranoShip: 47.4, victoriaShip: 47.0,
  kazimierzShip: 41.4, egirShip: 35.9, siracusaShip: 34.9, yanShip: 26.6 });

/** §37.38: the bots' shop level cap (bot.js BOT_MAX_LEVEL). L6 measured solo −7.8 ± 1.5, co-op −4.4 ± 2.0 points. */
export const LEVEL_CAP = 5;

// §37.63 / §37.65 / §37.69: the rule picks of bot.js botPickBand (teamMedicBoost, pagerPick).
export const TEAM_MEDIC = 'band_amedic', TEAM_ANCHOR = 'band_sarkazb', PAGER_BAND = 'band_jesica';

/** A knowledge pack's difficulty ('ABYSS' for 终极) and whether its mode is solo, from the pack's own mode rows. */
export function packMode(pack) {
  const modeId = typeof pack?.modeId === 'string' ? pack.modeId : '';
  const row = (pack?.difficulties || []).find(d => d.id === modeId);
  return { difficulty: row?.difficulty || modeId.split('_').pop()?.toUpperCase() || null,
    solo: modeId.startsWith('mode_single_'), coop: modeId.startsWith('mode_multi_') };
}

/**
 * The draft prior of the `offered` bands: the bot's own normalised weights when the host sends them (digest.bot.bands,
 * top 6; an offered band outside them gets 0), otherwise [ASSUMED] the two measured parts of its weight, LP³ × §37.46
 * strength (LP² off 终极), normalised over the offered bands. A band whose bond the mode or room switches off weighs 0
 * (DESIGN §21.26). The bot's smaller factors (老鲤's withheld funds alone, 鸭爵's teammate burden, a teammate's soft
 * reservation) are not repeated here. `forced`: the host's rule pick, else [ASSUMED] the one rule seat-visible data can
 * check — co-op 终极 Touch once a teammate holds 歌利亚 and nobody holds Touch (§37.63); solo 杰西卡 (§37.69) needs the
 * live pool, so only the host can name it.
 * bands: playbook band rows {id, lp, bondIds}; teammates: [{bandId}]; disabled: Set of switched-off bond ids.
 */
export function draftPriors({ bands = [], offered = [], difficulty = null, coop = false, teammates = [], disabled = new Set(), bot = null } = {}) {
  const byId = new Map(bands.map(b => [b.id, b]));
  const ids = offered.filter(id => byId.has(id) || bot?.bands?.some(b => b.id === id));
  const off = id => (byId.get(id)?.bondIds || []).some(b => disabled.has(b));
  const shares = new Map();
  let source = 'prior';
  if (Array.isArray(bot?.bands) && bot.bands.length) {
    source = 'bot';
    for (const id of ids) {
      const share = Number(bot.bands.find(b => b?.id === id)?.share);
      shares.set(id, Number.isFinite(share) && share > 0 && !off(id) ? share : 0);
    }
  } else {
    const weight = id => off(id) || !byId.has(id) ? 0 : lpWeight(byId.get(id).lp, difficulty) * bandStrength(difficulty, id);
    const total = ids.reduce((n, id) => n + weight(id), 0);
    for (const id of ids) shares.set(id, total > 0 ? weight(id) / total : 0);
  }
  let forced = typeof bot?.forced === 'string' && ids.includes(bot.forced) ? bot.forced : null;
  if (!forced && source === 'prior' && coop && difficulty === 'ABYSS' && ids.includes(TEAM_MEDIC) && !off(TEAM_MEDIC)) {
    const held = new Set(teammates.map(t => t?.bandId).filter(Boolean));
    // as teamMedicBoost: at once in a mode without 歌利亚, never while a teammate already holds Touch
    if (!held.has(TEAM_MEDIC) && (held.has(TEAM_ANCHOR) || !byId.has(TEAM_ANCHOR))) forced = TEAM_MEDIC;
  }
  return { shares, forced, source };
}

const unique = xs => [...new Set(xs)];
const rank = (a, b) => b.score - a.score || a.id.localeCompare(b.id);
// Round 65: at the draft the band's measured prior (score) decides, a direction's own fit only orders one band's variants.
const rankDraft = (a, b) => b.score - a.score || b.fit - a.fit || a.id.localeCompare(b.id);
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

// [ASSUMED] Band draft returns at most eight directions, one per band first, ranked by the band's measured draft prior
// (round 65: the bot's own shares when the host sends digest.bot.bands, else LP³ × §37.46 strength; draftPriors above). A
// direction whose main a teammate publicly claims is left out while others remain. Prep collapses same band+main sub
// variants into one stable id. Scores stay decomposed: at the draft scoreParts is the prior, fitParts the direction.
const DRAFT_CAP = 8, PREP_CAP = 4;
export function strategyCandidates(playbook, digest, previousPlan = null) {
  if (!playbook) return { candidates: [], reason: 'No versioned playbook in this knowledge pack.' };
  // a drawn ban stays in play (round 65, maintainer 2026-11-04): only its single-bond members left the pool
  const drawn = new Set(digest.availability?.drawnBonds || []);
  const disabled = new Set([...playbook.inactiveBonds, ...(digest.availability?.disabledBonds || []).filter(id => !drawn.has(id))]);
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
      // §35.63 [ASSUMED]: a carry's main is a core faction bond (thresholds 3/6). A class bond (迅捷 2, 精准 2/3 …) has
      // nothing past its first threshold to build toward: in cycle 2 every 迅捷 / 精准 / 坚守 main dealt 2-6 % of the
      // leader pool. A band engine tied to a class bond and the safety-net / supplier / economy roles keep theirs.
      if (role === 'carry' && main.core === false && !band.bondIds.includes(main.id)) continue;
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
        // Round 65: no survival (LP) term and no leader counter: the draft ranks bands by the measured prior below.
        const scoreParts = {
          engine: band.bondIds.includes(main.id) ? 16 : 0,
          community: band.communityMain?.main === main.id ? 8 : 0,
          earlyAccess: Math.min(early.length, 5) * 2,
          timing: -(main.thresholds[0]?.estimatedRound ?? 16),
          finalAssault: finalAssaultScore(main, members, preferred),
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
  const preparing = draft.length === 0;
  let prior = null;
  if (!preparing) {
    const modeId = String(playbook.modeId || '');
    const { shares, forced, source } = draftPriors({ bands: playbook.bands, offered: bands.map(b => b.id),
      difficulty: playbook.difficulty || modeId.split('_').pop().toUpperCase(), coop: modeId.startsWith('mode_multi_'),
      teammates: digest.opponents || [], disabled, bot: digest.bot });
    prior = { source, forced };
    for (const c of all) {
      c.fitParts = c.scoreParts; c.fit = c.score;
      c.scoreParts = { prior: +((shares.get(c.band) || 0) * 100).toFixed(2), ...(forced === c.band ? { forced: 100 } : {}) };
      c.score = +Object.values(c.scoreParts).reduce((a, b) => a + b, 0).toFixed(2);
    }
  }
  // Named builds and cycles keep their own ids. Only the generic sub-variants (same band and main, different
  // subs, identical stages) collapse. The id is band:main so a later sub reorder does not look like a new direction.
  // Collapse appends named builds after the generics. Sort again so a higher-scoring recipe still
  // occupies its main's slot the way the pre-collapse ranking did.
  const pool = preparing ? collapseDirections(all).sort(rank) : all.sort(rankDraft);
  const cap = preparing ? PREP_CAP : DRAFT_CAP;
  const selected = [], chosen = new Set(), mains = new Set();
  const take = c => { selected.push(c); chosen.add(c.id); mains.add(preparing ? c.main : `${c.band}:${c.main}`); };
  if (!preparing) {
    const open = pool.filter(c => contested(c.main) === 0);
    const ordered = open.length ? open : pool;
    const listed = new Set();
    for (const c of ordered) if (selected.length < cap && !listed.has(c.band)) { take(c); listed.add(c.band); }
    for (const c of ordered) if (selected.length < cap && !chosen.has(c.id) && !mains.has(`${c.band}:${c.main}`)) take(c);
    for (const c of ordered) if (selected.length < cap && !chosen.has(c.id)) take(c);
  } else {
    for (const c of pool) if (!mains.has(c.main) && selected.length < cap && !chosen.has(c.id)) take(c);
    // Prep does not refill with another copy of the same generic direction; a named build may still take a free slot.
    for (const c of pool) if (c.build && selected.length < cap && !chosen.has(c.id)) take(c);
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
      // §37.38: never above the bots' L5 cap (L6 measured solo −7.8, co-op −4.4 points).
      const level = Math.min(LEVEL_CAP, c.shopHold || playbook.maxShopLevel, targetTier, baseline);
      const eligible = operators.filter(op => op.tier <= level), total = eligible.reduce((n, op) => n + op.poolCopies, 0);
      return { round, level, requiredTier, targetTier, inaccessibleKeys: (stage?.keys || []).filter(id => (byId.get(id)?.tier || 1) > level),
        keyDrawShareBeforePurchases: total ? eligible.filter(op => stage?.keys?.includes(op.id)).reduce((n, op) => n + op.poolCopies, 0) / total : 0,
        basis: '[ASSUMED] maintainer tempo with data income/upgrade discounts, stage-key tiers and public copy shares after bans; no live stock. Explain delays or a deliberate level hold in why' };
    });
  }
  return { policy: preparing ? '[ASSUMED] heuristic direction scores; public catalogue only, remaining copies unknown'
    : 'band score = measured draft prior (share %, +100 for the bot\'s rule pick); fit = [ASSUMED] direction heuristics',
    ...(prior ? { prior } : {}), profile, teammates, candidates: selected.sort(preparing ? rank : rankDraft),
    ...(selected.length < 2 ? { reason: 'Fewer than two legal distinct archetypes in this observation.' } : {}) };
}
