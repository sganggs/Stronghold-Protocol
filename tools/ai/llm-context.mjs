// §35.11. [ASSUMED] Advisor summaries/feasibility estimates, never authoritative gameplay or live stock.
// Counts/thresholds/costs come from the seat digest and knowledge generated from activity_table.json.
import { draftPriors, packMode, LEVEL_CAP } from '../../server/ai/strategy.js';
import { shortText } from './llm-plan.mjs';
const pick = (x, keys) => Object.fromEntries(keys.filter(k => x?.[k] !== undefined).map(k => [k, x[k]]));
// The plan addresses operator IDs, not piece UIDs. Static names/base IDs already live in the cached prefix.
const unit = p => ({ ...pick(p, ['id', 'name', 'stars', 'row', 'col', 'dir', 'class', 'caps']),
  ...(p.kind !== 'chess' ? pick(p, ['kind', 'count', 'name']) : {}),
  ...(p.items?.length ? { items: p.items.map(i => typeof i === 'string' ? i : pick(i, ['id', 'name'])) } : {}) });
const finite = x => typeof x === 'number' && Number.isFinite(x);
const shortId = x => typeof x === 'string' && x.length > 0 && x.length <= 128;

export function compactChoices(d) {
  return (d.actions || []).filter(a => ['g.band', 'g.bandSkip', 'g.choice', 'g.offer', 'g.reward'].includes(a.intent.t)).map(a => {
    const i = a.intent;
    const card = i.t === 'g.choice' ? (i.choiceId ? d.personalChoice?.cards?.[i.idx] : d.choices?.cards?.find(c => c.idx === i.idx))
      : i.t === 'g.reward' ? d.rewards?.[i.idx]
        : i.t === 'g.offer' ? d.choices?.offers?.find(w => w.id === i.offerId && w.pluginId === i.pluginId && w.seq === i.seq)
          ?.seats.find(s => s.playerId === d.playerId)?.slots.find(c => c.idx === i.idx) : null;
    return { ...a, ...(card ? { card: pick(card, ['id', 'name', 'desc', 'kind', 'price', 'tier', 'bonds', 'coin', 'payout', 'rounds', 'enemyKey', 'count', 'team', 'killChance', 'enemy']) } : {}) };
  });
}

// §35.63 [ASSUMED]: the seat's own copy counts and the shop arithmetic, computed here so the model does not have to
// (cycle 2: plans skipped third copies, and holds were justified by miscounted prices).
const baseOf = p => p.baseId || String(p.id).replace(/_b$/, '_a');
export function levelOptions(economy, mergeCosts) {
  const gold = economy?.gold, price = economy?.upgradePrice, level = economy?.level;
  if (!Number.isInteger(gold) || !Number.isInteger(price) || !Number.isInteger(level)) return undefined;
  const merges = mergeCosts.slice().sort((a, b) => a - b);
  const affordable = funds => { let n = 0, left = funds; for (const c of merges) if (c <= left) { left -= c; n++; } return n; };
  // Round 65: no level option past the bots' L5 cap (§37.38), the plan's economy.level is clamped to it as well.
  return [{ action: 'hold', fundsAfter: gold, mergesAffordable: affordable(gold), nextRoundPrice: Math.max(0, price - 1) },
    ...(gold >= price && level < LEVEL_CAP ? [{ action: 'level', toLevel: level + 1, fundsAfter: gold - price, mergesAffordable: affordable(gold - price) }] : [])];
}

/**
 * Round 65: the host's view of what the built-in bot would do (digest.bot; absent on older hosts). Band turn: `bands`
 * (its own draft weights normalised, top 6) and `forced` (a rule pick); prep: `focus` / `second` (its main and second
 * core bonds), `levelTarget` (≤ 5) and `route` ('pager': the solo 杰西卡 → 谢拉格 hunt). Only well-formed fields pass.
 */
export function compactBot(bot) {
  if (!bot || typeof bot !== 'object' || Array.isArray(bot)) return undefined;
  const out = {};
  if (Array.isArray(bot.bands)) {
    const bands = bot.bands.filter(b => shortId(b?.id) && finite(b.share) && b.share >= 0).slice(0, 8)
      .map(b => ({ id: b.id, share: +b.share.toFixed(3) }));
    if (bands.length) out.bands = bands;
  }
  for (const k of ['forced', 'focus', 'second', 'route']) if (shortId(bot[k]) || bot[k] === null) out[k] = bot[k];
  if (Number.isInteger(bot.levelTarget) && bot.levelTarget >= 0) out.levelTarget = Math.min(bot.levelTarget, LEVEL_CAP);
  return Object.keys(out).length ? out : undefined;
}

/**
 * Round 65: the Final Assault arithmetic (digest.fa, from the round before it on): the leader pool of the seats alive,
 * the seconds before the drain (120 solo / 150 co-op), the drain per second and the team's LP. [ASSUMED] Added here:
 * `budgetSec` = clockSec + teamLp / drainPerSec (the fight ends when the drain empties the LP; leaks ignored, they barely
 * happen in a Final Assault) and `dpsNeeded` = pool / budgetSec.
 */
export function compactFa(fa) {
  if (!fa || typeof fa !== 'object') return undefined;
  const out = pick(fa, ['pool', 'alive', 'clockSec', 'drainPerSec', 'teamLp']);
  for (const [k, v] of Object.entries(out)) if (!finite(v) || v < 0) delete out[k];
  if (!Object.keys(out).length) return undefined;
  if (finite(out.clockSec) && finite(out.teamLp) && out.drainPerSec > 0) {
    out.budgetSec = Math.round(out.clockSec + out.teamLp / out.drainPerSec);
    if (out.pool > 0 && out.budgetSec > 0) out.dpsNeeded = Math.round(out.pool / out.budgetSec);
  }
  return out;
}

/**
 * §37.29 report, round 65 for the LLM too: the seat's last own battle — per unit damage / kills / taken / healing (the
 * 12 that dealt most) and the leaks per enemy kind with the gates the round's preview showed for it.
 */
export function compactBattle(b) {
  if (!b || typeof b !== 'object') return undefined;
  return { ...pick(b, ['round', 'boss', 'lp', 'lpLoss', 'killed', 'total']),
    leaks: (b.leaks || []).slice(0, 12).map(l => pick(l, ['enemyKey', 'name', 'count', 'counted', 'gates'])),
    units: (b.units || []).slice(0, 12).map(u => ({ ...pick(u, ['id', 'name', 'dmg', 'kills', 'taken', 'heal']),
      ...(u.kind && u.kind !== 'chess' ? { kind: u.kind } : {}) })) };
}

const coreBondIds = pack => new Set((pack.bonds || []).filter(b => b.core).map(b => b.id));
const bandBond = (pack, bandId) => (pack.playbook?.bands || []).find(b => b.id === bandId)?.bondIds?.find(id => coreBondIds(pack).has(id));

/** Co-op teammates as human scouting shows them; a seat that has not drafted yet is `drafted:false`, not "0 LP". */
export function teammateRows(d, pack) {
  const core = coreBondIds(pack);
  return (d.opponents || []).map(p => {
    if (!p.bandId) return { playerId: p.playerId, drafted: false };
    const main = (p.bonds || []).filter(b => core.has(b.bondId) && b.count >= 2).sort((a, b) => b.count - a.count || a.bondId.localeCompare(b.bondId))[0];
    const supplied = bandBond(pack, p.bandId);
    return { playerId: p.playerId, lp: p.lp, bandId: p.bandId, ...(supplied ? { bandBond: supplied } : {}), ...(main ? { main: main.bondId } : {}),
      bonds: (p.bonds || []).filter(b => b.active).map(b => ({ id: b.bondId, count: b.count })) };
  });
}

/**
 * §37.84: digest.team as the model reads it: per teammate its main (the plan's highest-priority bond), its other bonds,
 * what it buys, keeps and sells (at most 8 ids each) and its note, with the round of each. Older hosts send none.
 */
export function compactTeam(team) {
  if (!Array.isArray(team) || !team.length) return undefined;
  const ids = list => (Array.isArray(list) ? list.slice(0, 8) : undefined);
  return team.map(t => {
    const bonds = (Array.isArray(t.bonds) ? t.bonds : []).slice().sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id)));
    return { playerId: t.playerId, ...(t.round !== undefined ? { round: t.round } : {}), ...(bonds[0] ? { main: bonds[0].id } : {}),
      ...(bonds.length > 1 ? { subs: bonds.slice(1).map(b => b.id) } : {}), ...(t.buy ? { buy: ids(t.buy) } : {}), ...(t.keep ? { keep: ids(t.keep) } : {}),
      ...(t.sell ? { sell: ids(t.sell) } : {}), ...(t.note ? { note: shortText(t.note, 300), noteRound: t.noteRound } : {}) };
  });
}

/**
 * Round 65 main-bond progress panel (seat-visible only: own pieces, the shop, the public catalogue and bans; never the
 * live pool): the members owned (normal copies, elite), the missing members by tier — tier 6 only through merge rewards
 * and offers at the L5 cap — and the members the current shop shows.
 */
export function bondPanel(d, pack, bondId) {
  const bond = (pack.bonds || []).find(b => b.id === bondId);
  if (!bond) return null;
  const banned = new Set([...(d.availability?.bannedChess || []), ...(d.availability?.diyBanned || [])]);
  const catalogue = new Map((pack.operators || []).map(o => [o.id, o]));
  const owned = new Map();
  for (const p of [...(d.board || []), ...(d.bench || []), ...(d.overflow || [])]) {
    if (p?.kind !== 'chess' || !(p.bonds || catalogue.get(p.id)?.bonds || []).includes(bondId)) continue;
    const base = baseOf(p), row = owned.get(base) || { id: base, name: p.name || catalogue.get(base)?.name, tier: catalogue.get(base)?.tier, copies: 0 };
    if (p.stars === 2) row.elite = true; else row.copies++;
    owned.set(base, row);
  }
  const missing = {};
  for (const o of pack.operators || []) {
    if (!o.poolEligible || o.elite || !(o.bonds || []).includes(bondId) || owned.has(o.id) || banned.has(o.id) || banned.has(o.baseId)) continue;
    (missing[o.tier] ||= []).push({ id: o.id, name: o.name });
  }
  const current = (d.bonds || []).find(b => b.bondId === bondId);
  const inShop = (d.shop || []).filter(s => s && !s.sold && s.kind === 'chess' && (s.bonds || catalogue.get(s.id)?.bonds || []).includes(bondId))
    .map(s => ({ id: s.id, name: s.name, slot: s.slot, cost: s.price, ...(owned.has(baseOf(s)) ? {} : { missing: true }) }));
  return { id: bondId, name: bond.name, ...((d.availability?.drawnBonds || []).includes(bondId) ? { drawn: true } : {}), count: current?.count || 0,
    ...(current?.layers ? { layers: current.layers } : {}), thresholds: bond.thresholds, owned: [...owned.values()], missing, inShop };
}

/**
 * The panels the model sees in prep: the previous plan's main, the bot's focus and its second (core bonds only, at most
 * three); without either, the band's 职业队 bond or the core bond with the most owned members.
 */
export function mainBondPanels(d, pack, previousPlan = null) {
  const core = coreBondIds(pack), owned = new Map();
  for (const p of [...(d.board || []), ...(d.bench || [])]) for (const b of p?.kind === 'chess' ? p.bonds || [] : []) {
    if (core.has(b)) owned.set(b, (owned.get(b) || new Set()).add(baseOf(p)));
  }
  const planMain = (previousPlan?.bonds || []).slice().sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).map(b => b.id).find(id => core.has(id));
  const ids = [planMain, d.bot?.focus, d.bot?.second].filter(id => core.has(id));
  if (!ids.length) {
    const best = [...owned].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0]?.[0];
    ids.push(...[bandBond(pack, d.band?.id), best].filter(Boolean));
  }
  return [...new Set(ids)].slice(0, 3).map(id => bondPanel(d, pack, id)).filter(Boolean);
}

export function compactDigest(d, pack, { previousPlan = null } = {}) {
  const board = (d.board || []).map(unit), bench = (d.bench || []).map(unit), overflow = (d.overflow || []).map(unit);
  const offers = (d.shop || []).filter(s => s && !s.sold);
  const held = [...(d.board || []), ...(d.bench || [])].filter(p => p.kind === 'chess');
  const copies = new Map(), elites = new Set();
  for (const p of [...held, ...(d.overflow || []).filter(p => p.kind === 'chess')]) {
    if (p.stars === 2) elites.add(baseOf(p)); else copies.set(baseOf(p), (copies.get(baseOf(p)) || 0) + 1);
  }
  const mergeCopies = new Map((pack.operators || []).map(o => [o.id, o.mergeCopies || 3]));
  const shop = offers.map(s => {
    const row = { ...pick(s, ['id', 'name', 'kind', 'slot', 'bonds', 'frozen', 'class', 'caps']), cost: s.price, tier: s.tier };
    if (s.kind !== 'chess' || s.stars === 2) return row;
    const n = copies.get(baseOf(s)) || 0;
    return { ...row, copiesHeld: n, ...(elites.has(baseOf(s)) ? { eliteHeld: true } : {}),
      completesMerge: !elites.has(baseOf(s)) && n + 1 >= (mergeCopies.get(s.id) || mergeCopies.get(baseOf(s)) || 3) };
  });
  // Round 65: a drawn ban (availability.drawnBonds) removes only the bond's single-bond members; the bond still counts
  // its other members, so it stays in the list, marked `drawn`. Older hosts send no drawnBonds: every listed bond is off.
  const drawn = new Set(d.availability?.drawnBonds || []);
  const disabled = new Set((d.availability?.disabledBonds || []).filter(id => !drawn.has(id)));
  const banned = new Set([...(d.availability?.bannedChess || []), ...(d.availability?.diyBanned || [])]);
  const pool = pack.operators.filter(p => p.poolEligible && !p.elite && p.tier <= d.economy?.level
    && !banned.has(p.id) && !banned.has(p.baseId));
  const counts = new Map((d.bonds || []).map(b => [b.bondId, b]));
  const bonds = pack.bonds.filter(b => !disabled.has(b.id)).map(b => {
    const current = counts.get(b.id);
    const golden = b.countMode === 'BOARD_ALL_CHESS' || b.countsGoldenOnly;
    const members = held.filter(p => golden ? p.stars === 2 : p.bonds?.includes(b.id));
    const owned = new Set(members.map(p => p.baseId || p.id));
    const shown = offers.filter(p => p.kind === 'chess' && (golden ? p.stars === 2 : p.bonds?.includes(b.id)));
    const eligible = pool.filter(p => !golden && p.bonds?.includes(b.id));
    const count = current?.count || 0;
    const nextThreshold = current?.nextThreshold ?? b.thresholds.find(n => n > count) ?? null;
    // Bench pieces are potential, not activated count. Cap estimates by deployment slots except deck-counting bonds.
    // Golden-only bonds require already owned elites; never claim ordinary shop pieces activate them directly.
    const potential = golden ? members.length : new Set([...owned, ...shown.map(p => p.baseId || p.id), ...eligible.map(p => p.baseId || p.id)]).size;
    const capacity = b.countMode === 'BOARD_AND_DECK' ? potential : Math.min(potential, d.deployCap || 0);
    const reachable = !!current?.active || (nextThreshold !== null && Math.max(count, capacity) >= nextThreshold);
    // Preserve actual accumulated investment when assessing pivots; never infer layers from member counts.
    return { id: b.id, kind: b.core ? 'core' : 'class', ...(drawn.has(b.id) ? { drawn: true } : {}), count, nextThreshold, ...(current?.layers ? { layers: current.layers } : {}),
      ...(current?.tier ? { tier: current.tier } : {}), held: members.length,
      shopOptions: new Set(shown.map(p => p.baseId || p.id)).size, poolOptions: eligible.length,
      candidate: members.length > 0 && reachable };
  }).filter(b => b.count || b.held || b.shopOptions || b.layers || b.drawn); // banked layers stay visible (round 65: they win the FA)
  // Official mode data (config enemyScale): the catalogue rows above are unscaled, co-op R7-R10 enemies have 3.6-4.3x HP.
  const scale = (pack.difficulties || []).find(x => x.id === pack.modeId)?.enemyScale?.[d.round];
  const options = levelOptions(d.economy, shop.filter(s => s.completesMerge).map(s => s.cost));
  const bot = compactBot(d.bot), fa = compactFa(d.fa), lastBattle = compactBattle(d.lastBattle);
  const mainBonds = mainBondPanels(d, pack, previousPlan);
  return { ...pick(d, ['round', 'phase', 'lp', 'deployCap', 'factions']), band: d.band?.id,
    economy: { ...pick(d.economy, ['gold', 'interest', 'level', 'upgradePrice', 'refreshPrice', 'expiringFunds', 'frozenSlots']),
      ...(options ? { levelOptions: options } : {}) },
    ...(scale ? { enemyScale: pick(scale, ['atk', 'hp']) } : {}),
    ...(bot ? { bot } : {}), ...(fa ? { fa } : {}),
    board, bench, overflow, shop, bonds, ...(mainBonds.length ? { mainBonds } : {}),
    upcoming: (d.upcoming || []).map(e => pick(e, ['enemyKey', 'name', 'count', 'gate', 't', 'fly', 'elite', 'boss', 'source', 'mods'])),
    boss: pick(d.boss, ['id', 'name', 'round']),
    ...(lastBattle ? { lastBattle } : {}),
    teammates: teammateRows(d, pack), ...(compactTeam(d.team) ? { team: compactTeam(d.team) } : {}) };
}

/**
 * Round 65: the band draft as a choice-only table. One row per offered band: its action id, starting LP, the built-in
 * bot's share (digest.bot.bands, else the LP³ × strength prior of server/ai/strategy.js draftPriors) and its 职业队 bond; the bot's rule pick is
 * `forced` and comes first. A skip (co-op, once) is listed separately. No leader: drafting for the leader is rejected.
 */
export function bandTable(d, pack) {
  const pb = pack.playbook || {};
  const { difficulty, coop } = packMode(pack);
  const offered = (d.actions || []).filter(a => a.intent?.t === 'g.band');
  const drawn = new Set(d.availability?.drawnBonds || []);
  const disabled = new Set([...(pb.inactiveBonds || []), ...(d.availability?.disabledBonds || []).filter(id => !drawn.has(id))]);
  const { shares, forced, source } = draftPriors({ bands: pb.bands || [], offered: offered.map(a => a.intent.bandId),
    difficulty, coop, teammates: d.opponents || [], disabled, bot: d.bot });
  const names = new Map((pack.bands || []).map(b => [b.id, b]));
  const lpOf = id => names.get(id)?.lp ?? (pb.bands || []).find(b => b.id === id)?.lp;
  const rows = offered.map(a => {
    const id = a.intent.bandId, bond = bandBond(pack, id);
    // round 65: the effect says how a 职业队 band helps its bond (members, an elite, a discount, layers, funds or items)
    const effect = shortText((pb.bands || []).find(b => b.id === id)?.effect || '', 140);
    return { choice: a.id, id, name: names.get(id)?.name || id, lp: lpOf(id), share: +(100 * (shares.get(id) || 0)).toFixed(1),
      ...(bond ? { bond, ...(disabled.has(bond) ? { bondOff: true } : drawn.has(bond) ? { bondDrawn: true } : {}) } : {}),
      ...(effect ? { effect } : {}), ...(forced === id ? { forced: true } : {}) };
  }).sort((a, b) => Number(!!b.forced) - Number(!!a.forced) || b.share - a.share || a.id.localeCompare(b.id));
  const skip = (d.actions || []).find(a => a.intent?.t === 'g.bandSkip')?.id;
  return { rows, ...(skip ? { skip } : {}), prior: source };
}

/** The band draft's digest: the mode, the bans that touch bonds and members, and the teammates' public picks. */
export function draftDigest(d, pack) {
  const { difficulty, solo } = packMode(pack);
  return { round: d.round, mode: solo ? 'solo' : 'coop', ...(difficulty ? { difficulty } : {}),
    // round 65: disabledBonds = the bonds that never activate; a drawn ban is listed apart (it stays in play)
    availability: { ...pick(d.availability, ['drawnBonds', 'bannedChess']),
      disabledBonds: (d.availability?.disabledBonds || []).filter(id => !(d.availability?.drawnBonds || []).includes(id)) },
    teammates: teammateRows(d, pack),
    ...(compactTeam(d.team) ? { team: compactTeam(d.team) } : {}) };
}

/**
 * Round 65: the cadence's continuity — `carried` holds the ids of preps answered without a model call (the last plan's
 * bonds/keep): the host accepting one of them still confirms the model's own last plan as the baseline.
 */
export function continuity(d, previous, carried = null) {
  const feedback = d.feedback;
  // The host's acknowledgement prevents a timed-out/rejected reply being described as an executed plan.
  const accepted = feedback?.acceptedPlan;
  const confirmed = previous && (!feedback || accepted?.id === previous.id || carried?.has(accepted?.id)) ? previous : null;
  const plan = confirmed?.plan || accepted?.plan;
  if (!plan) return null;
  const before = new Map((confirmed?.digest.bonds || []).map(b => [b.id, b.count]));
  const after = new Map((d.bonds || []).map(b => [b.bondId, b.count]));
  const cursor = confirmed?.through;
  const events = (feedback?.events || []).filter(e => cursor === undefined ? e.round >= accepted.round : e.seq > cursor);
  const { choice, ...priorPlan } = plan; void choice; // observation-local choice IDs must never be reused
  return { round: confirmed?.round ?? accepted.round, previousPlan: priorPlan,
    ...(confirmed && carried?.has(accepted?.id) ? { carriedSince: true } : {}),
    outcome: { events, eventsComplete: cursor !== undefined && (!events.length || events[0].seq === cursor + 1),
      bonds: [...new Set([...before.keys(), ...after.keys()])].map(id => ({ id, before: confirmed ? before.get(id) || 0 : null, after: after.get(id) || 0 })),
      lp: { before: confirmed?.digest.lp ?? null, after: d.lp ?? null }, lastBattle: feedback?.lastBattle || null } };
}

// §35.62 [ASSUMED]: the band draft sets a direction before any member is owned (玛恩纳 → 卡西米尔 waited until R6 for a
// first copy). `intent` lists the mains the seat may lead with before a member is held (round 65: the bot's focus and
// second, the band's 职业队 bond, the main-bond panels). A primary change still needs pivot:true and a reason.
export function focusPlan(plan, meta, digest, previousPlan, repairs, intent = []) {
  // §35.9's explicit empty-plan delegation remains unweighted, even when an earlier plan had targets.
  if (!Object.keys(plan).length) return { pivot: false, pivotReason: '' };
  // §37.75: no bonds array leaves this prep's main to the bot (aiPlan advisorPlan); continuity binds a bonds array the model sent
  if (plan.bonds === undefined) return { pivot: false, pivotReason: '' };
  const candidates = new Set([...digest.bonds.filter(b => b.candidate).map(b => b.id), ...intent]);
  const select = bonds => (bonds || []).filter(b => candidates.has(b.id)).sort((a, b) => b.priority - a.priority).slice(0, 3);
  const proposed = select(plan.bonds);
  for (const b of plan.bonds || []) if (!proposed.includes(b)) repairs.push({ path: 'bonds', id: b.id, reason: 'no held/reachable progress or three-bond cap' });
  const old = previousPlan?.bonds || [], viable = select(old);
  // Only the highest-priority bond is the direction. Adding, dropping or reordering sub-bonds is not a pivot.
  const primaryId = bonds => (bonds || []).slice().sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0]?.id || '';
  let pivot = false, pivotReason = '';
  let bonds = proposed;
  if (old.length && primaryId(old) !== primaryId(proposed)) {
    if (meta.pivot === true && meta.pivotReason) { pivot = true; pivotReason = meta.pivotReason; }
    else {
      bonds = viable;
      repairs.push({ path: 'bonds', reason: 'unexplained primary-bond change; retain viable previous targets' });
      if (primaryId(viable) !== primaryId(old)) { pivot = true; pivotReason = 'Previous targets no longer have held, publicly reachable progress.'; }
    }
  }
  plan.bonds = bonds;
  return { pivot, pivotReason };
}

// Round 65 (§37.75): the plan's main (its highest-priority core bond) plays at priority 5, the weight the co-op bot gives
// its own focus (+9.4 co-op points, +7.1 solo against the old executor); cycle-5 / v2 mains came at priority 1-3 and would replace
// the bot's main with a weaker one. Subs keep their priority.
export function mainAtFive(plan, pack, repairs) {
  const core = new Set((pack.bonds || []).filter(b => b.core).map(b => b.id));
  const main = (plan.bonds || []).filter(b => core.has(b.id)).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
  if (!main || main.priority >= 5) return;
  repairs.push({ path: 'bonds.priority', id: main.id, reason: `main raised from ${main.priority} to 5 (the bot's own main weight)` });
  plan.bonds = plan.bonds.map(b => (b === main ? { ...b, priority: 5 } : b));
}
