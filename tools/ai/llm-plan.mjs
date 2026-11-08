// §35.11. [ASSUMED] Local repair policy for this example only. Server validPlan and human validators stay strict.
// Round 65 ("the bot is the floor, the LLM overrides"): the built-in bot executes every plan and an empty plan plays like
// it, so the repair also removes the overrides the bots measured as harmful (L6, refresh caps, shop equipment, wide keeps).
import { validPlan } from '../../server/match/aiPlan.js';
import { LEVEL_CAP } from '../../server/ai/strategy.js';
const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
export const shortText = (s, max = 360) => typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';
// §35.62 [ASSUMED]: a level hold is accepted only at or above the slow community curve (3-5-7-9: L3 by R5, L4 by R7,
// L5 by R9; handoff/round51 RESEARCH §3.2, BV19UXZBJExQ reply). Below it the price drop of one round (1 fund) never
// pays for a round of lower-tier rolls (§37.39: L3 one round late −13.8 ± 4.0 solo). A candidate's own shopHold is
// exempt. §35.63: L2 by R4, not R3 (the model read an R3 floor as an order to level and skipped third copies). Round 65:
// no L6 step at R11 any more — the bots stop at L5 (§37.38, LEVEL_CAP), so from R9 a hold at L5 is the bot's own level.
export const holdFloor = round => round >= 9 ? 5 : round >= 7 ? 4 : round >= 5 ? 3 : round >= 4 ? 2 : 1;
// Round 65 [ASSUMED]: §37.39's control capped the bots at 2 refreshes a prep from L5 and cost −12.5 ± 2.3 solo /
// −9.7 ± 4.2 co-op points (cycle 5 sent maxRefreshes 0 in 65 % of the plans): a cap of 2 or less stays only when
// economy.why says the prep saves funds (interest, a reserve, the next prep's level-up or merge).
export const REFRESH_FLOOR = 3;
const SAVING = /\b(sav(e|es|ed|ing)|interest|reserve|bank(ing)?|hoard)\b|攒|存钱|留钱|利息|储蓄|省钱|保留资金/i;
export const KEEP_CAP = 8;

/** Normal copies held per exact operator id, and the bonds each owned id counts for (morphs included). */
function holdings(digest) {
  const copies = new Map(), bonds = new Map(), items = new Map();
  for (const p of [...(digest.board || []), ...(digest.bench || []), ...(digest.overflow || [])]) {
    if (!p) continue;
    if (p.kind === 'item') { items.set(p.id, (items.get(p.id) || 0) + 1); continue; }
    if (p.kind !== 'chess') continue;
    copies.set(p.id, (copies.get(p.id) || 0) + 1);
    bonds.set(p.id, new Set([...(bonds.get(p.id) || []), ...(p.bonds || [])]));
    for (const i of p.items || []) { const id = typeof i === 'string' ? i : i?.id; if (id) items.set(id, (items.get(id) || 0) + 1); }
  }
  return { copies, bonds, items };
}

/**
 * Round 65: keep only the core of the build, at most KEEP_CAP owned ids — elites, pairs, and members of the plan's bonds or
 * the bot's focus / second. Cycle-5 keeps averaged 7.5 bases; protected singles took the bench room third copies need (§35.63
 * saw 3.2 protected tier-4+ singles and 3.6 keep-listed pieces on R9-R13 benches). `drop(path, value, reason)` reports it.
 */
export function filterKeep(plan, pack, digest, drop) {
  if (!plan.keep?.length) return;
  const held = holdings(digest);
  const core = new Set([...(plan.bonds || []).map(b => b.id), digest.bot?.focus, digest.bot?.second].filter(Boolean));
  const catalogue = new Map(pack.operators.map(o => [o.id, o]));
  const kept = [];
  for (const id of plan.keep) {
    const memberOf = [...(held.bonds.get(id) || catalogue.get(id)?.bonds || [])];
    const ok = held.copies.has(id) && (/_b$/.test(id) || catalogue.get(id)?.elite || held.copies.get(id) >= 2 || memberOf.some(b => core.has(b)));
    if (!ok) drop('keep', id, 'not an owned elite, pair or member of the plan\'s bonds');
    else if (kept.length >= KEEP_CAP) drop('keep', id, `keep cap ${KEEP_CAP}`);
    else kept.push(id);
  }
  plan.keep = kept;
}

export function repairPlan(input, pack, digest, choices, { holds = [], deferKeep = false } = {}) {
  if (!object(input)) throw new Error('plan');
  const repairs = [], plan = {};
  const drop = (path, value, reason = 'unknown ID or invalid value') => repairs.push({ path, value: shortText(String(value), 128), reason });
  const fields = ['bonds', 'buy', 'keep', 'sell', 'economy', 'items', 'placements', 'choice'];
  if (Object.keys(input).length && !Object.keys(input).some(k => fields.includes(k))) throw new Error('plan');
  const cleanKeys = (x, allowed, path) => { for (const k of Object.keys(x)) if (!allowed.includes(k)) drop(`${path}${k}`, x[k], 'unknown field'); };
  cleanKeys(input, fields, '');
  const pieces = [...(digest.board || []), ...(digest.bench || []), ...(digest.overflow || []), ...(digest.shop || []).filter(Boolean)];
  const ops = new Set([...pack.operators.map(p => p.id), ...pieces.filter(p => p.kind === 'chess').map(p => p.id)]);
  const items = new Set(pack.items.map(p => p.id)), bonds = new Set(pack.bonds.map(p => p.id));
  // Shop rows cover plugin items absent from the static pack. Chess ids are not item buys.
  const buyableItems = new Set(items);
  for (const s of [...(digest.shop || []), ...(digest.rewards || [])].filter(Boolean)) {
    if (s.kind === 'item' || items.has(s.id) || (s.kind !== 'chess' && !ops.has(s.id) && s.id)) buyableItems.add(s.id);
  }
  const num = (value, min, max, path) => {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    if (!Number.isFinite(n)) { drop(path, value); return undefined; }
    const fixed = Math.max(min, Math.min(max, Math.trunc(n)));
    if (fixed !== value) drop(path, value, `clamped to ${fixed}`);
    return fixed;
  };
  const list = (value, path, cap, map) => {
    if (!Array.isArray(value)) throw new Error('plan');
    const out = [];
    for (const v of value) {
      const item = map(v);
      if (item === undefined) { drop(path, v?.id ?? v); continue; }
      if (out.length >= cap || out.some(x => JSON.stringify(x) === JSON.stringify(item))) { drop(path, v?.id ?? v, 'list cap or duplicate'); continue; }
      out.push(item);
    }
    return out;
  };
  const ids = (value, known, path) => list(value, path, 32, v => known.has(v) ? v : undefined);
  // Item IDs written into the operator buy list go to items.buy (they were dropped before and never bought).
  const misplaced = Array.isArray(input.buy) ? input.buy.filter(v => !ops.has(v) && buyableItems.has(v)) : [];
  for (const key of ['buy', 'keep', 'sell']) if (input[key] !== undefined) {
    plan[key] = ids(key === 'buy' ? input[key].filter(v => !misplaced.includes(v)) : input[key], ops, key);
  }
  if (input.bonds !== undefined) {
    const seen = new Set();
    plan.bonds = list(input.bonds, 'bonds', 8, b => {
      if (!object(b) || !bonds.has(b.id) || seen.has(b.id)) return;
      cleanKeys(b, ['id', 'priority'], 'bonds.');
      const priority = num(b.priority, 1, 5, 'bonds.priority');
      if (priority === undefined) return;
      seen.add(b.id); return { id: b.id, priority };
    });
  }
  const held = holdings(digest);
  if (!deferKeep) filterKeep(plan, pack, digest, drop);
  if (input.economy !== undefined) {
    if (!object(input.economy)) throw new Error('plan');
    plan.economy = {};
    cleanKeys(input.economy, ['saveForInterest', 'reserve', 'level', 'holdLevel', 'why', 'maxRefreshes', 'refreshAbove', 'freezeSearch'], 'economy.');
    // Round 65: economy.level is a floor clamped to the bots' L5 cap (§37.38: L6 solo −7.8 ± 1.5, co-op −4.4 ± 2.0).
    for (const [k, max] of Object.entries({ reserve: 100, level: LEVEL_CAP, maxRefreshes: 16, refreshAbove: 100 })) {
      if (input.economy[k] === undefined) continue;
      const value = num(input.economy[k], 0, max, `economy.${k}`);
      if (value !== undefined) plan.economy[k] = value;
    }
    if (typeof input.economy.saveForInterest === 'boolean') plan.economy.saveForInterest = input.economy.saveForInterest;
    else if (input.economy.saveForInterest !== undefined) drop('economy.saveForInterest', input.economy.saveForInterest);
    const why = shortText(input.economy.why);
    if (why) plan.economy.why = why;
    if (plan.economy.maxRefreshes !== undefined && plan.economy.maxRefreshes < REFRESH_FLOOR && !SAVING.test(why)) {
      drop('economy.maxRefreshes', plan.economy.maxRefreshes, 'a cap below 3 cuts the bot\'s refresh search; kept only when economy.why says the prep saves');
      delete plan.economy.maxRefreshes;
    }
    // The level held is the higher of the current level and economy.level (legacy first levels up to economy.level).
    const now = digest.economy?.level, floor = holdFloor(digest.round || 1);
    const level = Number.isInteger(now) ? Math.max(now, plan.economy.level ?? 0) : undefined;
    const belowCurve = input.economy.holdLevel === true && Number.isInteger(level) && level < floor && !holds.includes(level);
    if (typeof input.economy.holdLevel === 'boolean' && !belowCurve && (!input.economy.holdLevel || (why && plan.economy.level >= 1)))
      plan.economy.holdLevel = input.economy.holdLevel;
    else if (belowCurve) drop('economy.holdLevel', true, `held level ${level} is below the R${digest.round} floor L${floor}`);
    else if (input.economy.holdLevel !== undefined) drop('economy.holdLevel', input.economy.holdLevel, 'hold requires level >= 1 and economy.why');
    if (typeof input.economy.freezeSearch === 'boolean') plan.economy.freezeSearch = input.economy.freezeSearch;
    else if (input.economy.freezeSearch !== undefined) drop('economy.freezeSearch', input.economy.freezeSearch);
  }
  if (input.items !== undefined || misplaced.length) {
    if (input.items !== undefined && !object(input.items)) throw new Error('plan');
    const given = input.items || {};
    plan.items = {}; cleanKeys(given, ['keep', 'equip', 'buy'], 'items.');
    if (given.keep !== undefined) plan.items.keep = ids(given.keep, items, 'items.keep');
    if (given.buy !== undefined && !Array.isArray(given.buy)) throw new Error('plan');
    for (const v of misplaced) drop('buy', v, 'item id moved to items.buy');
    if (given.equip !== undefined) plan.items.equip = list(given.equip, 'items.equip', 16, e => {
      if (!object(e) || !items.has(e.id) || !ops.has(e.target)) return;
      cleanKeys(e, ['id', 'target'], 'items.equip.'); return { id: e.id, target: e.target };
    });
    if (given.buy !== undefined || misplaced.length) {
      // Round 65 (§37.39: no shop equipment, solo +1.7, co-op +3.8, 职业队 +4.5 points): an item buy stays only when it
      // completes an equipment merge with the copies the seat holds, or [ASSUMED] in the Final Assault prep (digest.fa,
      // or from the round before the leader's) for a carrier the plan names in items.equip. The bot buys the elite
      // makers (博士投影, 拟态物质) and the Final Assault damage items itself (§37.41, §37.67).
      const merge = new Map(pack.items.map(i => [i.id, i.mergeCopies || 0]));
      const bossRound = digest.boss?.round, round = digest.round;
      const faPrep = !!digest.fa || (Number.isInteger(bossRound) && Number.isInteger(round) && round >= bossRound - 1);
      const owned = base => [...held.copies.keys()].some(id => id === base || id.replace(/_b$/, '_a') === base.replace(/_b$/, '_a'));
      const carried = new Set(faPrep ? (plan.items.equip || []).filter(e => owned(e.target)).map(e => e.id) : []);
      plan.items.buy = list([...(given.buy || []), ...misplaced], 'items.buy', 8, v => buyableItems.has(v) ? v : undefined).filter(id => {
        if (merge.get(id) > 1 && (held.items.get(id) || 0) + 1 >= merge.get(id)) return true;
        if (carried.has(id)) return true;
        drop('items.buy', id, 'no equipment merge and no declared Final Assault carrier (§37.39)');
        return false;
      });
    }
  }
  // Round 65: placements are left to the bot's rehearsal (a matching tile was worth 0.05 of exposure, aiPlan.js).
  if (input.placements !== undefined) drop('placements', Array.isArray(input.placements) ? input.placements.length : input.placements, 'placements are left to the bot\'s rehearsal');
  if (input.choice !== undefined) {
    if (choices.some(c => c.id === input.choice)) plan.choice = input.choice;
    else drop('choice', input.choice);
  }
  if (!validPlan(plan)) throw new Error('plan');
  return { plan, repairs };
}
