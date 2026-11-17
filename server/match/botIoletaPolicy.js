// Opt-in Ioleta procurement heuristics. All numeric scores and stage targets are [ASSUMED].
// Reads own holdings, visible offers and public stock; no hidden shops or future waves.
import { computeBonds } from './bondsMeta.js';

export const IOLETA_ELITE_VALUE = 24;
export const IOLETA_PARAMS = Object.freeze({
  secondaryEarliestRound: 4,
  softenL1Round: 6,
  exitL1Round: 7,
  exitL2Round: 9,
  exitL3Round: 11,
  l4UpgradeRound: 10,
  l5UpgradeRound: 12,
  l1MissingAllowance: 2,
  coreFirst: 20,
  corePair: 30,
  coreMerge: 48,
  singleFirst: 16,
  surplusCopy: -160,
  fallbackTie: 'arcaneShip',
});

export const IOLETA_OPS = Object.freeze({
  hibiscus: 'chess_char_1_06_a', podenco: 'chess_char_1_13_a',
  jump: 'chess_char_1_09_a', matterhorn: 'chess_char_1_02_a', gummy: 'chess_char_1_10_a',
  indigo: 'chess_char_1_17_a', perfumer: 'chess_char_2_14_a', executor: 'chess_char_2_01_a',
  bough: 'chess_char_2_17_a', cuora: 'chess_char_3_16_a', skadi: 'chess_char_3_05_a',
});

const CORE = ['deputShip', 'steadShip', 'preciShip'];
const ALTERNATES = ['arcaneShip', 'swiftShip'];
const WEIGHT = { deputShip: 14, steadShip: 11, preciShip: 10, arcaneShip: 8, swiftShip: 8 };
const DATA_CACHE = new WeakMap();

// Both lists are public match information. Random disabled bonds are separate
// from static mode exclusions, and from chess bans derived for the shared pool.
const inactive = (m, gd, id) => gd.modeInactiveBonds.has(id)
  || (m.disabledBonds instanceof Set ? m.disabledBonds.has(id) : (m.disabledBonds || []).includes(id));

/** Public disabled-bond union, also used by guarded generic bot scoring. */
export const ioletaBondDisabled = (m, ps, id) => inactive(m, ps.gd || m.gd, id);

export const ioletaEnabled = (m, ps) => ps.bandId === 'band_ioleta';

// Static indexes are built once per data view, never once per hypothetical lineup.
function dataIndex(gd) {
  if (DATA_CACHE.has(gd)) return DATA_CACHE.get(gd);
  const records = gd.visibleChess.map((id) => gd.chess(id)).filter(Boolean);
  const byBond = new Map([...CORE, ...ALTERNATES].map((bond) => [bond,
    records.filter((c) => c.bonds.includes(bond)).map((c) => gd.baseIdOf(c.chessId))]));
  const result = { byBond };
  DATA_CACHE.set(gd, result);
  return result;
}

function holdings(gd, ps, ctx = {}) {
  const normal = ctx.copies || new Map();
  const elites = new Set();
  const pieces = ps.allChess();
  for (const p of pieces) {
    const base = gd.baseIdOf(p.id);
    if (gd.isGolden(p.id)) elites.add(base);
    else if (!ctx.copies) normal.set(base, (normal.get(base) || 0) + 1);
  }
  return { normal, elites, pieces };
}

function visibleCounts(gd, ps) {
  const out = new Map();
  for (const s of [...ps.shop.slots, ...(ps.offers || []).flatMap((o) => o.slots)]) {
    if (!s || s.sold || s.kind !== 'chess') continue;
    const base = gd.baseIdOf(s.id);
    // A shown card remains obtainable even when the public stock reaches zero.
    out.set(base, (out.get(base) || 0) + 1);
  }
  return out;
}

function stockOf(m, ps, base) {
  return typeof ps.poolOf === 'function' ? ps.poolOf(base) : m.pool;
}

function stockLeft(m, ps, base) {
  return Math.max(0, stockOf(m, ps, base)?.left(base) || 0);
}

function obtainable(m, ps, base, held, visible) {
  return held.elites.has(base) || held.normal.has(base) || visible.has(base) || stockLeft(m, ps, base) > 0;
}

function thresholds(gd, bond) {
  const rec = gd.bond(bond);
  return Array.isArray(rec?.thresholds) && rec.thresholds.length ? rec.thresholds : [rec?.activeCount || 2];
}

function readyCount(bonds, bond) {
  // 助力's upper tier counts normal/elite variants, as computeBonds does.
  return bond === 'deputShip' && bonds[bond]?.tier >= 2
    ? Math.max(3, bonds[bond].count || 0) : bonds[bond]?.count || 0;
}

function makePlan(m, ps, previous = null) {
  const gd = ps.gd || m.gd;
  const index = dataIndex(gd);
  const held = holdings(gd, ps);
  const visible = visibleCounts(gd, ps);
  const allBoard = new Map(held.pieces.map((p, i) => [`owned${i}`, p]));
  const owned = computeBonds(gd, { board: allBoard, hand: [], layers: ps.layers, bondCountBonus: ps.bondCountBonus });
  const deployed = computeBonds(gd, ps);
  const active = (bond) => !inactive(m, gd, bond) && (index.byBond.get(bond) || [])
    .filter((base) => obtainable(m, ps, base, held, visible)).length >= thresholds(gd, bond)[0];
  const allCore = CORE.every(active);
  let framework = allCore ? 'primary' : 'fallback';
  if (allCore) {
    const primaryReady = readyCount(owned, 'deputShip') >= 3;
    const secondaryReady = readyCount(owned, 'deputShip') >= 2 && readyCount(owned, 'steadShip') >= 3
      && readyCount(owned, 'preciShip') >= 3;
    const secondaryStable = previous?.framework === 'secondary'
      && readyCount(deployed, 'deputShip') >= 2 && readyCount(deployed, 'steadShip') >= 3
      && readyCount(deployed, 'preciShip') >= 3;
    const deputyShown = (index.byBond.get('deputShip') || []).some((base) => visible.has(base)
      && !held.normal.has(base) && !held.elites.has(base));
    if (secondaryStable || (!primaryReady && secondaryReady && !deputyShown
      && m.round >= IOLETA_PARAMS.secondaryEarliestRound)) framework = 'secondary';
  }
  const goals = {};
  for (const bond of CORE) if (active(bond)) goals[bond] = bond === 'preciShip'
    ? framework === 'secondary' ? 3 : 2 : bond === 'deputShip' && framework === 'secondary' ? 2 : 3;
  let fallback = null;
  if (!allCore) {
    // [ASSUMED] Rank only one fallback by held investment, shown stock, public
    // supply and banked layers. Prefer 奥术 only on exact ties; do not chase both.
    let best = -Infinity;
    for (const bond of ALTERNATES) {
      if (!active(bond)) continue;
      let score = Math.min(40, ps.layers?.[bond] || 0) * 0.1;
      for (const base of index.byBond.get(bond) || []) {
        score += held.elites.has(base) ? 8 : held.normal.has(base) ? 4 : 0;
        if ((held.normal.get(base) || 0) >= 2) score += 3;
        if (visible.has(base)) score += 2;
        if (gd.tierOf(base) <= Math.max(2, ps.shop.level) && stockLeft(m, ps, base) > 0) score += 0.1;
      }
      if (score > best || (score === best && bond === IOLETA_PARAMS.fallbackTie)) { best = score; fallback = bond; }
    }
    if (fallback) {
      const th = thresholds(gd, fallback);
      const room = Math.max(th[0], ps.deployCap - Object.values(goals).reduce((a, b) => a + b, 0));
      goals[fallback] = Math.min(th.at(-1), room);
    }
  }
  const targets = [];
  const add = (base, bond, elite, stage = gd.tierOf(base)) => {
    if (!goals[bond] || !gd.chess(base) || !obtainable(m, ps, base, held, visible)) return;
    const existing = targets.find((t) => t.base === base);
    if (existing) {
      if (elite) { existing.elite = true; existing.copies = gd.mergeCount(base); }
      return;
    }
    targets.push({ base, bond, elite, stage, copies: elite ? gd.mergeCount(base) : 1 });
  };
  const o = IOLETA_OPS;
  const deputies = [o.hibiscus, o.podenco, o.perfumer];
  // [ASSUMED] In the secondary frame, retain the two most invested 助力 targets;
  // the removed target may still be fielded by ordinary whole-team evaluation.
  if (framework === 'secondary') deputies.sort((a, b) =>
    Number(held.elites.has(b)) - Number(held.elites.has(a))
    || (held.normal.get(b) || 0) - (held.normal.get(a) || 0)
    || gd.tierOf(a) - gd.tierOf(b));
  for (const base of deputies.slice(0, goals.deputShip || 0)) add(base, 'deputShip', true);
  add(o.jump, 'preciShip', true);
  add(o.matterhorn, 'steadShip', true);
  add(o.gummy, 'steadShip', true);
  add(o.executor, 'preciShip', true);
  add(o.indigo, 'preciShip', false);
  add(o.bough, 'steadShip', false);
  // [ASSUMED] Search until the elite, rather than merely the first copy, bounded
  // by exitL3Round. Disabled 坚守 removes both the turtle and Skadi from this plan.
  const turtle = obtainable(m, ps, o.cuora, held, visible) ? o.cuora : o.skadi;
  add(turtle, 'steadShip', true, 3);
  if (fallback) {
    const candidates = (index.byBond.get(fallback) || []).filter((base) => obtainable(m, ps, base, held, visible));
    const priority = (base) => (held.elites.has(base) ? 100 : 0) + (held.normal.get(base) || 0) * 12
      + (visible.has(base) ? 3 : 0) - gd.tierOf(base) * 5;
    candidates.sort((a, b) => priority(b) - priority(a) || a.localeCompare(b));
    for (const base of candidates.slice(0, goals[fallback])) add(base, fallback, gd.tierOf(base) <= 2);
  }
  return Object.freeze({ framework, fallback, goals: Object.freeze(goals),
    targets: Object.freeze(targets.map(Object.freeze)), round: m.round });
}

/** The only policy-memory mutation. Call once at prep start, before lineup probes. */
export function refreshIoletaPlan(m, ps) {
  if (!ioletaEnabled(m, ps)) return null;
  const plan = makePlan(m, ps, ps.botStrategyState?.ioleta?.plan);
  (ps.botStrategyState ??= {}).ioleta = { plan };
  return plan;
}

/** Reading / evaluating a lineup never commits a framework change. */
export function ioletaPlan(m, ps) {
  return ioletaEnabled(m, ps) ? ps.botStrategyState?.ioleta?.plan || makePlan(m, ps) : null;
}

export function ioletaTarget(m, ps, id) {
  const gd = ps.gd || m.gd;
  return ioletaPlan(m, ps)?.targets.find((t) => t.base === gd.baseIdOf(id) && !inactive(m, gd, t.bond)) || null;
}

export function ioletaCore(m, ps, id) {
  const target = ioletaTarget(m, ps, id);
  return !!target?.elite && target.stage <= ps.shop.level;
}

function canFinish(m, ps, target, held, visible) {
  if (held.elites.has(target.base)) return true;
  const need = target.copies - (held.normal.get(target.base) || 0);
  return need <= stockLeft(m, ps, target.base) + (visible.get(target.base) || 0);
}

/** Only obtainable, unfinished targets at the current shop level justify rerolls. */
export function ioletaSearchTargets(m, ps) {
  const gd = ps.gd || m.gd;
  const plan = ioletaPlan(m, ps);
  if (!plan) return [];
  const held = holdings(gd, ps), visible = visibleCounts(gd, ps);
  return plan.targets.filter((t) => t.stage <= ps.shop.level && !inactive(m, gd, t.bond)
    && !held.elites.has(t.base) && (held.normal.get(t.base) || 0) < t.copies
    && canFinish(m, ps, t, held, visible));
}

/** Bonus on top of ordinary unit, role and economy scoring, replacing the old Ioleta bonus. */
export function ioletaBuyBonus(m, ps, id, ctx = {}) {
  if (!ioletaEnabled(m, ps)) return 0;
  const gd = ps.gd || m.gd;
  const rec = gd.chess(id);
  if (!rec) return 0;
  const base = gd.baseIdOf(id);
  const held = holdings(gd, ps, ctx);
  const n = held.normal.get(base) || 0;
  const target = ioletaTarget(m, ps, id);
  if (!rec.isGolden && (held.elites.has(base) || (target && n >= target.copies))) return IOLETA_PARAMS.surplusCopy;
  let score = rec.isGolden ? IOLETA_ELITE_VALUE : 0;
  if (target && !inactive(m, gd, target.bond) && !held.elites.has(base)) {
    if (rec.isGolden) score += target.elite ? IOLETA_PARAMS.coreMerge : IOLETA_PARAMS.singleFirst;
    else if (target.elite && canFinish(m, ps, target, held, visibleCounts(gd, ps))) score += n + 1 >= target.copies
      ? IOLETA_PARAMS.coreMerge : n ? IOLETA_PARAMS.corePair : IOLETA_PARAMS.coreFirst;
    else if (!target.elite && !n) score += IOLETA_PARAMS.singleFirst;
  }
  const plan = ioletaPlan(m, ps);
  if (!held.elites.has(base) && !n) {
    for (const bond of rec.bonds) {
      if (inactive(m, gd, bond) || !plan.goals[bond]) continue;
      const count = ctx.owned?.counts.get(bond) || 0;
      if (count < plan.goals[bond]) score += WEIGHT[bond] * (thresholds(gd, bond).includes(count + 1) ? 1.5 : 0.5);
    }
  }
  // [ASSUMED] Natural non-core pairs retain generic value; they get no merge
  // premium here. Singles used only for transition do not become reroll targets.
  return score;
}

/** Pure eligibility + affordability; the caller performs one validated level-up. */
export function ioletaCanLevel(m, ps) {
  if (!ioletaEnabled(m, ps)) return true;
  const gd = ps.gd || m.gd;
  if (ps.shop.level >= gd.maxShopLevel || ps.funds < Math.max(0, ps.shop.upgradePrice)) return false;
  // [ASSUMED] Resume a deliberately slower curve after the staged cores. This
  // prevents free prices from turning one prep into an immediate rush to L6.
  if (ps.shop.level >= 4) return m.round >= (ps.shop.level === 4
    ? IOLETA_PARAMS.l4UpgradeRound : IOLETA_PARAMS.l5UpgradeRound);
  const plan = ioletaPlan(m, ps);
  const held = holdings(gd, ps), visible = visibleCounts(gd, ps);
  const stage = ps.shop.level;
  const targets = plan.targets.filter((t) => t.elite && t.stage === stage && !inactive(m, gd, t.bond)
    && canFinish(m, ps, t, held, visible));
  const missing = targets.filter((t) => !held.elites.has(t.base)).length;
  if (stage === 1) return m.round >= IOLETA_PARAMS.exitL1Round || missing === 0
    || (m.round >= IOLETA_PARAMS.softenL1Round && missing <= IOLETA_PARAMS.l1MissingAllowance);
  // [ASSUMED] L2's core completion allows early L3; R9 limits unsuccessful
  // searches. Likewise L3 seeks Cuora/Skadi's elite, with an R11 exit.
  return missing === 0 || m.round >= (stage === 2 ? IOLETA_PARAMS.exitL2Round : IOLETA_PARAMS.exitL3Round);
}
