// server/match/waves.js — per-match enemy setup and per-round spawn generation: the OFFICIAL generator decoded from
// the client (`RandomEnemyGenerater`, research 08 §2; DESIGN §14 "Corrections from research 08/09"). No custom balance:
// counts, kinds, timing and stat scaling are the official ones.
//
// Per match (setupMatchWaves):
//   * stage: weighted (stages[id].weight) among mode.stages that are active with weight > 0 — official mode data:
//     标准 (FUNNY) / 入门 = 战场#01 only, 险境 = 8 stages, 绝境 / 终极 = 7 (no 战场#01), weight 50 each, so the match seed
//     picks uniformly (test/match/stagepick.test.js)
//   * factions: `specialEnemyNum` (3) distinct types among the involveRandom ones (FLY/TIMES/ELEMENT/DOT/INVISIBLE/
//     REFLECTION), uniform (shuffle, take 3)
//   * type schedule: each chosen type owns `count` (3) of the `maxLevelCnt` (15) round slots, SPECIAL fills the other 6;
//     the slots are shuffled — typeSlots[r-1] = the ONE type of round r (the briefing shows the 3 types, the order
//     stays hidden)
//   * picks: for every round 1..15, generated now (so the preview and every battle agree): half = r ≤ 7; a weighted
//     (entry.weight) special entry of the round's type and half whose SPECIAL key is not in the mode's
//     inactiveEnemyKeys (attached keys are never filtered); normal / elite = a random attached key
//   * boss: weighted mode.bossWeights; hidden boss: weighted mode.hiddenBossWeights (independent)
// Per round (buildNormalWave / buildBossWave; one composition shared by every player):
//   * every template SPAWN action whose key is a placeholder (N/E/S walk, NF/EF/SF fly) becomes the pick's
//     normal / elite / special key — or is SKIPPED (not spawned, not previewed) when the new key's movement class differs
//     from the placeholder's (ground rounds drop NF/EF/SF, FLY rounds drop N/E/S);
//     n' = clamp(roundHalfEven(f32(f32(n·P(tpl))/f(tpl)) / f32(P(new)/f(new))), 1, 5) per ACTION (P = enemies.json
//     attrPower, f = beFactor), unit i spawning at time + i·max(n·interval/n', 0.05·n·interval) (same window);
//     literal keys (R1 源石虫, leader escorts) and T/TF tokens are kept; 炎佑 (enemy_9012_acloon) is never an enemy
//   * leader / hidden rounds use the pick of their own slot (14, 15; solo 标准 9), so only E or EF escorts spawn
//   * stat scaling: mods = config.modes[m].enemyScale[r] (the PRTS table = the ENEMY effects 攻坚装备 / 补给线 / 急行军,
//     which hit every enemy but 炎佑 — no other multiplier), also for bounty enemies and leader parts; the leader takes
//     the ATK / speed multipliers but never HP (its HP is the shared server pool)
//   * every SpawnSpec = one action ({ time, enemyKey, routeIndex, count, interval, mods, actionIndex, preview }):
//     `mods.slot` (placeholder class) lets 联防 route leaks, `preview` = { gate, start, fly, elite, boss } feeds previewOf
// Bounties (bountySpawns / withBounties): each bounty unit joins the round template's first `lrsldr` (walker) / `yokai`
// (flyer) action (else action 0), inserted among that action's own units at floor((i+1)·len/(n+1)), and the whole list
// is spread over the action window (client `_InsertSpActionToNormal` + `_CalculateActionPredelay`, decoded).
// 联防 (buildUniteWave): walkers → the escaped template's `lrsldr` action, flyers → `yokai`, tokens → `gopro_2` /
// `lazerd` (else action 0); owner k starts 0.5·k s after the action, units step min(max(W/M, 0.05·W), 5 s) with M the
// largest owner group (client `_CalculateActionPredelayConsiderUid`, decoded).

import { createRng, deriveSeed } from '../sim/rng.js';

const ACLOON = 'enemy_9012_acloon';
const DEFAULT_PLACEHOLDERS = Object.freeze({
  N: { cls: 'normal', fly: false }, E: { cls: 'elite', fly: false }, S: { cls: 'special', fly: false },
  NF: { cls: 'normal', fly: true }, EF: { cls: 'elite', fly: true }, SF: { cls: 'special', fly: true },
});
const MIN_ACTION_INTERVAL_RATIO = 0.05;
/** 联防 timing (client `_CalculateActionPredelayConsiderUid`): owner offset ACTION_INTERVAL_FOR_UID, unit step cap
 * MAX_ACTION_INTERVAL_FOR_UID. */
const UNITE_OWNER_STEP = 0.5;
const UNITE_MAX_UNIT_STEP = 5;

/** Weighted pick of [id, weight] pairs with the rng. */
export function weightedPick(rng, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += Math.max(0, Number(w) || 0);
  if (total <= 0) return pairs.length ? pairs[0][0] : null;
  let r = rng() * total;
  for (const [id, w] of pairs) { r -= Math.max(0, Number(w) || 0); if (r < 0) return id; }
  return pairs[pairs.length - 1][0];
}

/** C# Math.Round(double): banker's rounding (half to even). */
export function roundHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.floor(x + 0.5);
}

const gen = (gd) => (gd.factions.generation && typeof gd.factions.generation === 'object' ? gd.factions.generation : {});
const intOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

/** Official movement class of an enemy key (randomEnemyAttributeDict.isFlyEnemy, else its motion). */
export function isFlyKey(gd, key) {
  const e = gd.enemy(key);
  if (!e) return false;
  if (typeof e.isFlyEnemy === 'boolean') return e.isFlyEnemy;
  return !!(e.stats && e.stats.motion === 'FLY');
}

/** Official attribute power P(k) (float32), enemies.json `attrPower`; derived from the stats when absent. */
export function attrPower(gd, key) {
  const e = gd.enemy(key);
  if (!e) return 0;
  if (typeof e.attrPower === 'number' && Number.isFinite(e.attrPower)) return e.attrPower;
  const s = e.stats || {};
  const f = Math.fround;
  const bf = gen(gd).beFactors || {};
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let p = f(f(f(n(s.atk) * (bf.atk ?? 5)) + f(n(s.maxHp) * (bf.hp ?? 1))) + f(n(s.def) * (bf.def ?? 3)));
  p = f(p + f((bf.res ?? 3) * n(s.res)));
  return p;
}

const beFactor = (gd, key) => {
  const v = gd.enemy(key)?.beFactor;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
};

/**
 * Units a placeholder action of `n` template enemies becomes (client `_CalculateEnemyCountByBattleEffectiveness`):
 * clamp(roundHalfEven(f32(f32(f32(n·P(t))/f(t)) / f32(P(new)/f(new)))), min, max).
 */
export function replacedCount(gd, tplKey, n, newKey) {
  const g = gen(gd);
  const min = Number.isInteger(g.minReplacedEnemyCount) ? g.minReplacedEnemyCount : 1;
  const max = Number.isInteger(g.maxReplacedEnemyCount) ? g.maxReplacedEnemyCount : 5;
  const f = Math.fround;
  const origin = f(f(n * attrPower(gd, tplKey)) / beFactor(gd, tplKey));
  const unit = f(attrPower(gd, newKey) / beFactor(gd, newKey));
  if (!(unit > 0)) return min;
  const ratio = f(origin / unit);
  return Math.max(min, Math.min(max, roundHalfEven(ratio)));
}

/** Placeholder key → { slot, cls, fly } (factions.generation.placeholders, else built from templateSlots). */
function placeholderMap(gd) {
  const g = gen(gd);
  if (g.placeholders && typeof g.placeholders === 'object') return g.placeholders;
  const out = {};
  const ts = gd.factions.templateSlots && typeof gd.factions.templateSlots === 'object' ? gd.factions.templateSlots : {};
  for (const [slot, key] of Object.entries(ts)) if (DEFAULT_PLACEHOLDERS[slot]) out[key] = { slot, ...DEFAULT_PLACEHOLDERS[slot] };
  return out;
}

const firstHalfMax = (gd) => intOr(gen(gd).firstHalfMaxRound, Math.floor(intOr(gen(gd).maxLevelCnt, 15) / 2));

/** The special entry list (factions.json entries) sorted by key. */
function entryList(gd) {
  const e = gd.factions.entries && typeof gd.factions.entries === 'object' ? Object.values(gd.factions.entries) : [];
  return e.filter((x) => x && typeof x.key === 'string').sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The round pick of a type (client `_GenerateRandomEnemyData`): weighted entry of that type and half whose SPECIAL key
 * is allowed in the mode, plus a random attached normal / elite key (never filtered by the mode).
 * @returns {null | { round: number, type: string, key: string, normal: string|null, elite: string|null, fly: boolean, firstHalf: boolean }}
 */
export function pickRoundEntry(gd, rng, type, round) {
  const half = round <= firstHalfMax(gd);
  const ok = (e) => e.type === type && !!e.firstHalf === half && e.key !== ACLOON && !!gd.enemy(e.key) && !gd.inactiveEnemies.has(e.key);
  let cands = entryList(gd).filter(ok);
  if (!cands.length && type !== 'SPECIAL') return pickRoundEntry(gd, rng, 'SPECIAL', round);
  if (!cands.length) return null;
  const idx = weightedPick(rng, cands.map((e, i) => [i, e.weight ?? 1]));
  const e = cands[Number(idx) || 0];
  const pickKey = (list) => {
    const keys = (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x && x.key)).filter((k) => typeof k === 'string' && gd.enemy(k) && k !== ACLOON);
    return keys.length ? keys[Math.floor(rng() * keys.length)] : null;
  };
  return { round, type: e.type, key: e.key, normal: pickKey(e.N), elite: pickKey(e.E), fly: typeof e.fly === 'boolean' ? e.fly : isFlyKey(gd, e.key), firstHalf: half };
}

/** Round type schedule: each chosen type × its slot count, filled with SPECIAL to maxLevelCnt, shuffled. */
export function makeTypeSchedule(gd, rng, factions) {
  const g = gen(gd);
  const max = intOr(g.maxLevelCnt, 15);
  const fill = typeof g.fillType === 'string' ? g.fillType : (typeof g.alwaysIncludedType === 'string' ? g.alwaysIncludedType : 'SPECIAL');
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const slots = [];
  for (const t of factions) {
    const n = intOr(types[t]?.count, 3);
    for (let i = 0; i < n && slots.length < max; i++) slots.push(t);
  }
  while (slots.length < max) slots.push(fill);
  rng.shuffle(slots);
  return slots;
}

function scheduleRng(rng) {
  const seed = typeof rng.state === 'function' ? deriveSeed(rng.state(), 'waves:schedule') : Math.floor(rng() * 4294967296);
  return createRng(seed);
}

/**
 * @param {import('./gamedata.js').GameData} gd
 * @param {Function} rng
 * @returns {{ stageId: string|null, factions: string[], bossId: string|null, hiddenBossId: string|null, typeSlots: string[], picks: object[] }}
 *   `factions` also carries the schedule as a non-enumerable `schedule` property ({ typeSlots, picks }), so callers
 *   that keep only the factions array (Match: buildNormalWave(gd, rng, this.factions, r)) get the official rounds.
 */
export function setupMatchWaves(gd, rng) {
  // stage
  const stageIds = Array.isArray(gd.mode.stages) ? gd.mode.stages : [];
  const stagePairs = stageIds.map((id) => [id, gd.stage(id)]).filter(([, s]) => s && s.active !== false && Number(s.weight) > 0).map(([id, s]) => [id, s.weight]);
  let stageId = stagePairs.length ? weightedPick(rng, stagePairs) : null;
  if (!stageId) {
    const any = Object.keys(gd.raw.stages || {}).filter((id) => gd.stage(id) && gd.stage(id).active);
    stageId = any.length ? any.sort()[0] : null;
  }
  // factions
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const n = Number.isInteger(gen(gd).specialEnemyNum) ? gen(gd).specialEnemyNum : 3;
  const random = Object.values(types).filter((t) => t && t.involveRandom).map((t) => t.type).sort();
  const shuffled = random.slice();
  rng.shuffle(shuffled);
  const chosen = shuffled.slice(0, Math.min(n, shuffled.length));
  const factions = chosen.slice().sort((a, b) => (types[a]?.sortId ?? 9) - (types[b]?.sortId ?? 9));
  // bosses
  const bw = gd.bossWeights(false);
  const bossId = bw.length ? weightedPick(rng, bw) : null;
  const hw = gd.bossWeights(true);
  const hiddenBossId = hw.length && gd.hiddenRound ? weightedPick(rng, hw) : null;
  // the 15-round schedule and picks (own rng stream derived from the setup rng's state: the draws above and whatever
  // the caller draws next from `rng` are unchanged)
  const srng = scheduleRng(rng);
  const typeSlots = makeTypeSchedule(gd, srng, chosen);
  const picks = [null];
  for (let r = 1; r <= typeSlots.length; r++) picks.push(pickRoundEntry(gd, srng, typeSlots[r - 1], r));
  Object.defineProperty(factions, 'schedule', { value: Object.freeze({ typeSlots: typeSlots.slice(), picks }), enumerable: false });
  return { stageId, factions, bossId, hiddenBossId, typeSlots, picks };
}

/**
 * The pick of round r: from a setup object ({ picks }), a factions array carrying the hidden schedule, or — for a plain
 * factions array (tools, tests) — drawn now: the round's type from the schedule's marginal distribution (each faction
 * 3 of 15 slots, SPECIAL the rest), then its entry.
 */
export function roundPick(gd, rng, factionsOrSetup, round) {
  const src = factionsOrSetup;
  const picks = src && !Array.isArray(src) && Array.isArray(src.picks) ? src.picks : (src && src.schedule && Array.isArray(src.schedule.picks) ? src.schedule.picks : null);
  if (picks) return picks[round] ?? null;
  const factions = Array.isArray(src) ? src : (src && Array.isArray(src.factions) ? src.factions : []);
  const g = gen(gd);
  const types = gd.factions.types && typeof gd.factions.types === 'object' ? gd.factions.types : {};
  const max = intOr(g.maxLevelCnt, 15);
  const pairs = factions.map((t) => [t, intOr(types[t]?.count, 3)]);
  const used = pairs.reduce((s, [, w]) => s + w, 0);
  pairs.push([typeof g.fillType === 'string' ? g.fillType : 'SPECIAL', Math.max(1, max - used)]);
  return pickRoundEntry(gd, rng, weightedPick(rng, pairs), round);
}

/** Enemy scale mods for round r (bosses excluded by the caller). */
export function scaleFor(gd, r) {
  return gd.enemyScale(r);
}

/** Slot class of an enemy that has no placeholder slot (literal template keys, bounty adds). */
export function classOf(gd, enemyKey) {
  const e = gd.enemy(enemyKey);
  const fly = isFlyKey(gd, enemyKey);
  const elite = !!(e && e.rank === 'ELITE');
  if (fly) return elite ? 'EF' : 'NF';
  return elite ? 'E' : 'N';
}

/** Preview pen upper zone anchor row ((18,7); the lower anchor is (15,7)) and the client's row offsets. */
const PEN_UPPER_ROW = 18;
const PREVIEW_ROW_OFFSET = 6;
const PREVIEW_ROW_OFFSET_LEADER = 13;

/**
 * 'upper' | 'lower' preview zone of a route start (client `AutoChessEnemyPreviewManager`, research 08 §4.2): target row =
 * start row + 6 (leader rounds: + 13); the zone is the Manhattan-nearest anchor among those with anchor row ≤ target
 * row — (18,7) upper, (15,7) lower — so only a target row ≥ 18 reaches the upper zone: normal fields row 12 (upper
 * gate (12,10); rows 9–11 lower), boss fields row 5 (rows 2–4 lower: the leaders at (3,x)/(4,x) and the (2,10) gate).
 * A target below row 15 has no zone (the client picks a random pen tile) and is reported 'lower'.
 * @param {number[]|null} start [row, col]
 * @param {boolean} [leader] leader / hidden round (default: a boss-field row, ≤ 8)
 */
export function gateOf(start, leader) {
  const r = Array.isArray(start) ? start[0] : null;
  if (!Number.isFinite(r)) return 'lower';
  const lead = typeof leader === 'boolean' ? leader : r <= 8;
  const target = r + (lead ? PREVIEW_ROW_OFFSET_LEADER : PREVIEW_ROW_OFFSET);
  // both anchors share col 7, so with target ≥ 18 the upper one is always the nearer; below it only (15,7) qualifies
  return target >= PEN_UPPER_ROW ? 'upper' : 'lower';
}

const isLeaderTemplate = (tpl) => !!tpl && (tpl.kind === 'boss' || tpl.kind === 'hidden');

function previewInfo(gd, key, route, boss = false, leader = undefined) {
  const e = gd.enemy(key);
  const start = route && Array.isArray(route.start) ? route.start.slice(0, 2) : null;
  return { gate: gateOf(start, leader), start, fly: isFlyKey(gd, key), elite: !!(e && e.rank && e.rank !== 'NORMAL'), boss };
}

/**
 * The actions of a template with the round pick applied.
 * @returns {{ spawns: object[], actions: object[] }} actions[i] = { index, key, tplKey, slot, time, count, tplCount, window, routeIndex, valid,
 *   server } (`server` = client ShouldActionUpToServer: valid, not the leader, no random spawn group)
 */
function templateSpawns(gd, tpl, round, pick) {
  const scale = scaleFor(gd, round);
  const ph = placeholderMap(gd);
  const routes = Array.isArray(tpl.routes) ? tpl.routes : [];
  const leader = isLeaderTemplate(tpl);
  const spawns = [];
  const actions = [];
  const list = Array.isArray(tpl.spawns) ? tpl.spawns : [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || (s.action && String(s.action).toUpperCase() !== 'SPAWN')) continue;
    const key0 = s.key ?? s.enemyKey;
    if (typeof key0 !== 'string' || key0 === ACLOON) continue;
    const tag = s.tag ?? null;
    const isBoss = tag === 'boss';
    const isPart = tag === 'part';
    const n = Math.max(1, Math.min(50, Number.isInteger(s.count) ? s.count : 1));
    const interval = Math.max(0, Number(s.interval) || 0);
    const time = Math.max(0, Number(s.time) || 0);
    const routeIndex = Number.isInteger(s.routeIndex) ? s.routeIndex : 0;
    const window = n * interval;
    let key = key0;
    let count = n;
    let step = interval;
    const p = !isBoss && !isPart ? ph[key0] : null;
    if (p && pick) {
      const newKey = p.cls === 'special' ? pick.key : p.cls === 'elite' ? pick.elite : pick.normal;
      if (typeof newKey === 'string' && gd.enemy(newKey)) {
        if (isFlyKey(gd, newKey) !== !!p.fly) {
          // the other movement class: not spawned, not sent, not previewed (isValid = false)
          actions.push({ index: i, key: null, tplKey: key0, slot: p.slot ?? s.slot ?? null, time, count: 0, tplCount: n, window, routeIndex, valid: false, server: false });
          continue;
        }
        count = replacedCount(gd, key0, n, newKey);
        step = Math.max(window / count, MIN_ACTION_INTERVAL_RATIO * window);
        key = newKey;
      }
    }
    if (!gd.enemy(key)) continue;
    const slot = s.slot || classOf(gd, key);
    const spec = {
      time,
      enemyKey: key,
      routeIndex,
      count,
      interval: count > 1 ? step : 0,
      // the round multipliers are ENEMY effects on every enemy but 炎佑 (aceffect_enemy_1–5 `enemy_attribute_mul`,
      // enemy_exclude = enemy_9012_acloon): leader parts take them all; the leader takes ATK / speed but not HP — its HP
      // is the server pool, "领袖单位于服务器的生命值加成不受上述加成影响" (PRTS 下半)
      mods: isBoss ? { atkMul: scale.atkMul, speedMul: scale.speedMul, slot } : { hpMul: scale.hpMul, atkMul: scale.atkMul, speedMul: scale.speedMul, slot },
      actionIndex: i,
      preview: previewInfo(gd, key, routes[routeIndex], isBoss, leader),
    };
    if (tag) spec.tag = tag;
    if (s.unharmful || isPart) spec.countInTotal = false;
    spawns.push(spec);
    // client ShouldActionUpToServer: valid, not the leader, no randomSpawnGroupKey — only those units are in the list a
    // bounty is inserted into (the others spawn locally on their own timing)
    actions.push({ index: i, key, tplKey: key0, slot: s.slot ?? null, time, count, tplCount: n, window, routeIndex, valid: true, server: !isBoss && !s.group });
  }
  return { spawns, actions };
}

function entriesView(gd, pick) {
  if (!pick) return { ground: null, fly: null };
  const e = gd.factions.entries && gd.factions.entries[pick.key];
  const view = e ? { ...e, pick } : { key: pick.key, type: pick.type, firstHalf: pick.firstHalf, pick };
  return pick.fly ? { ground: null, fly: view } : { ground: view, fly: null };
}

/**
 * Shared composition of a normal round.
 * @param {string[]|object} factions setupMatchWaves().factions (carries the schedule), the setup object, or a plain
 *   factions array (the round's type is then drawn with `rng`)
 * @returns {{ templateId: string|null, spawns: object[], routes: object[], extraRoutes: object[], timeLimit: number,
 *   overrides: object, pick: object|null, entries: { ground: object|null, fly: object|null }, actions: object[] }}
 */
export function buildNormalWave(gd, rng, factions, round) {
  const rc = gd.roundCfg(round);
  const templateId = rc && typeof rc.template === 'string' ? rc.template : null;
  const tpl = templateId ? gd.wave(templateId) : null;
  const timeLimit = gd.combatTimeLimit(round);
  if (!tpl) return { templateId, spawns: [], routes: [], extraRoutes: [], timeLimit, overrides: {}, pick: null, entries: { ground: null, fly: null }, actions: [] };
  const pick = roundPick(gd, rng, factions, round);
  const { spawns, actions } = templateSpawns(gd, tpl, round, pick);
  return {
    templateId,
    spawns,
    routes: Array.isArray(tpl.routes) ? tpl.routes : [],
    extraRoutes: Array.isArray(tpl.extraRoutes) ? tpl.extraRoutes : [],
    timeLimit,
    overrides: tpl.overrides && typeof tpl.overrides === 'object' ? tpl.overrides : {},
    pick,
    entries: entriesView(gd, pick),
    actions,
  };
}

/**
 * Boss / hidden round template for one boss field; escorts follow the pick of the round's own slot.
 * @param {{ bossId: string, solo: boolean }} opts solo → `_s` template (lone player or solo mode)
 */
export function buildBossWave(gd, rng, factions, round, { bossId, solo }) {
  const rc = gd.roundCfg(round);
  const map = rc && rc.bossTemplates && typeof rc.bossTemplates === 'object' ? rc.bossTemplates : {};
  let templateId = typeof map[bossId] === 'string' ? map[bossId] : null;
  if (!templateId) {
    const first = Object.values(map).find((v) => typeof v === 'string');
    templateId = first || null;
  }
  if (templateId && solo && !/_s$/.test(templateId) && gd.wave(`${templateId}_s`)) templateId = `${templateId}_s`;
  if (templateId && !solo && /_s$/.test(templateId) && gd.wave(templateId.replace(/_s$/, ''))) templateId = templateId.replace(/_s$/, '');
  const tpl = templateId ? gd.wave(templateId) : null;
  if (!tpl) return { templateId, spawns: [], routes: [], extraRoutes: [], timeLimit: Infinity, overrides: {}, pick: null, entries: { ground: null, fly: null }, actions: [] };
  const pick = roundPick(gd, rng, factions, round);
  const { spawns, actions } = templateSpawns(gd, tpl, round, pick);
  return {
    templateId,
    spawns,
    routes: Array.isArray(tpl.routes) ? tpl.routes : [],
    extraRoutes: Array.isArray(tpl.extraRoutes) ? tpl.extraRoutes : [],
    timeLimit: Infinity,
    overrides: tpl.overrides && typeof tpl.overrides === 'object' ? tpl.overrides : {},
    pick,
    entries: entriesView(gd, pick),
    actions,
  };
}

/** Boss-field column that splits the left (L) and the right (R) player's half (the goals are at cols 2–3 / 17). */
const BOSS_MID_COL = 10;

/**
 * Route index of the first template route with the requested motion (fallback 0). `side` ('L' | 'R') prefers a route
 * that ends on that player's half of a boss field (pair templates route to both goals).
 */
export function routeByMotion(routes, fly, side = null) {
  const ok = (r) => r && (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
  if (side === 'L' || side === 'R') {
    const j = routes.findIndex((r) => ok(r) && Array.isArray(r.end) && (side === 'R' ? r.end[1] > BOSS_MID_COL : r.end[1] < BOSS_MID_COL));
    if (j >= 0) return j;
  }
  const i = routes.findIndex(ok);
  return i >= 0 ? i : 0;
}

/**
 * The template action an added enemy joins (client `_GetSpEnemyActionData`): the first SPAWN action of the round's
 * ORIGINAL template whose key is the normal placeholder of the enemy's movement class (`templateEnemyNormal` /
 * `…NormalFly`; tokens `templateEnemyToken` / `…TokenFly`), else the first SPAWN action.
 */
function hostAction(gd, wave, { fly, token = false }) {
  const tpl = wave && wave.templateId ? gd.wave(wave.templateId) : null;
  const list = tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [];
  const ts = gd.factions.templateSlots || {};
  const want = token ? ts[fly ? 'TF' : 'T'] : ts[fly ? 'NF' : 'N'];
  let first = -1;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || (s.action && String(s.action).toUpperCase() !== 'SPAWN')) continue;
    if (first < 0) first = i;
    if ((s.key ?? s.enemyKey) === want) return { index: i, s };
  }
  return first >= 0 ? { index: first, s: list[first] } : null;
}

/**
 * Bounty spawns for one player's battle (悬赏 / 战术特训 / 教鞭 / “神秘顾客”): kill bounties pay the killer (Battle
 * bounty), perfect bounties are paid by the match at settlement. No bounty-specific stat change (the solo 70 % is the
 * global base already in enemyScale). Client timing (`GenerateSelfBattleEnemyData` → `_GetSpEnemyActionData` →
 * `_InsertSpActionToNormal` → `_CalculateActionPredelay`, decoded): every bounty unit joins the ORIGINAL template's
 * first `lrsldr` (walker) / `yokai` (flyer) action (else action 0); the n bounty units of a host action are INSERTED
 * among its own n' units — unit i at index floor((i+1)·len/(n+1)), len = the list length so far — (the bounty list
 * alone when the host spawns nothing, e.g. a walker bounty in a FLY round), then the whole list is spread over the
 * action window: unit j at preDelay + j·max(W/total, 0.05·W). Returned here: the bounty specs only (a bounty's
 * consecutive units share a spec); the host action's own units are NOT re-timed — `withBounties` gives the exact
 * combined list. Bounties of several battles (`rounds` > 1: "接下来两场作战", and the multi-round cards, which last
 * choices.js MULTI_ROUND_BOUNTY_BATTLES) spawn in every battle of the player while they last — the Final Assault and the
 * Hidden Core included (`side`: the player's half of the boss field, see routeByMotion).
 * @param {Array<{ id: string, card: object }>} bounties
 */
export function bountySpawns(gd, round, wave, bounties, playerId, { solo = false, side = null } = {}) { // eslint-disable-line no-unused-vars
  return bountyPlan(gd, round, wave, bounties, playerId, side).specs;
}

/** Runs of consecutive equal markers: [{ v, start, len }]. */
function runsOf(list) {
  const out = [];
  for (let j = 0; j < list.length; j++) {
    const last = out[out.length - 1];
    if (last && last.v === list[j]) last.len++;
    else out.push({ v: list[j], start: j, len: 1 });
  }
  return out;
}

function bountyPlan(gd, round, wave, bounties, playerId, side) {
  const scale = scaleFor(gd, round);
  const routes = (wave && wave.routes) || [];
  const acts = Array.isArray(wave && wave.actions) ? wave.actions : [];
  const leader = isLeaderTemplate(wave && wave.templateId ? gd.wave(wave.templateId) : null);
  const groups = new Map(); // host action index → { host, items: [{ b, c, fly, count }] }
  for (const b of bounties || []) {
    const c = b && b.card ? b.card : {};
    if (!gd.enemy(c.enemyKey)) continue;
    const fly = isFlyKey(gd, c.enemyKey);
    const host = hostAction(gd, wave, { fly });
    const key = host ? host.index : -1;
    if (!groups.has(key)) groups.set(key, { host, items: [] });
    groups.get(key).items.push({ b, c, fly, count: Math.max(1, Math.min(20, Number.isInteger(c.count) ? c.count : 1)) });
  }
  const specs = [];
  const retime = new Map(); // host action index → { time, step, ownRuns: [{ start, len }] }
  const OWN = 0;
  for (const { host, items } of groups.values()) {
    const hs = host ? host.s : null;
    const time = hs ? Math.max(0, Number(hs.time) || 0) : 4;
    const window = hs ? Math.max(1, Number.isInteger(hs.count) ? hs.count : 1) * Math.max(0, Number(hs.interval) || 0) : 0;
    const act = host ? acts.find((a) => a.index === host.index) : null;
    // the host's own units: only a server-sent action has any (a leader / random-group / invalid host spawns the
    // bounty list alone over its window — client _InsertSpActionToNormal finds no normal list for it)
    const own = act && act.valid && act.server !== false ? act.count : 0;
    const sp = [];
    for (const it of items) for (let k = 0; k < it.count; k++) sp.push(it);
    // _InsertSpActionToNormal: insert the bounty units among the action's own units (list.Insert(FloorToInt(...)))
    let list;
    if (own > 0) {
      list = new Array(own).fill(OWN);
      for (let i = 0; i < sp.length; i++) list.splice(Math.floor(((i + 1) * list.length) / (sp.length + 1)), 0, sp[i]);
    } else {
      list = sp.slice();
    }
    const step = window > 0 ? Math.max(window / list.length, MIN_ACTION_INTERVAL_RATIO * window) : 0;
    const runs = runsOf(list);
    if (host && own > 0) retime.set(host.index, { time, step, ownRuns: runs.filter((r) => r.v === OWN) });
    for (const run of runs) {
      if (run.v === OWN) continue;
      const { b, c, fly } = run.v;
      let routeIndex = hs && Number.isInteger(hs.routeIndex) ? hs.routeIndex : routeByMotion(routes, fly, side);
      const r = routes[routeIndex];
      const motionOk = r && (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
      const sideOk = !(side === 'L' || side === 'R') || (r && Array.isArray(r.end) && (side === 'R' ? r.end[1] > BOSS_MID_COL : r.end[1] < BOSS_MID_COL));
      if (!motionOk || !sideOk) routeIndex = routeByMotion(routes, fly, side);
      const spec = {
        time: time + run.start * step,
        enemyKey: c.enemyKey,
        routeIndex,
        count: run.len,
        interval: run.len > 1 ? step : 0,
        mods: { hpMul: scale.hpMul, atkMul: scale.atkMul, speedMul: scale.speedMul, slot: classOf(gd, c.enemyKey), bountyId: b.id },
        tag: 'bounty',
        ownerPlayerId: playerId,
        preview: previewInfo(gd, c.enemyKey, routes[routeIndex], false, leader),
      };
      if (host) spec.actionIndex = host.index;
      if (c.payout !== 'perfect' && Number(c.coin) > 0) spec.bounty = { coins: Math.trunc(c.coin), ownerPlayerId: playerId };
      specs.push(spec);
    }
  }
  return { specs, retime };
}

/**
 * A player's full spawn list for the round, exactly like the client: the wave's specs (copied; the own units of an
 * action that bounties join are re-timed around the inserted bounty units — one spec per run of consecutive own units)
 * followed by the bounty specs. Use it instead of `[...wave.spawns, ...bountySpawns(…)]`, which keeps the host
 * action's own spacing.
 */
export function withBounties(gd, round, wave, bounties, playerId, { side = null } = {}) {
  const { specs, retime } = bountyPlan(gd, round, wave, bounties, playerId, side);
  const out = [];
  for (const s of wave.spawns || []) {
    const rt = s.tag !== 'bounty' && Number.isInteger(s.actionIndex) ? retime.get(s.actionIndex) : null;
    if (!rt) { out.push({ ...s, mods: s.mods ? { ...s.mods } : undefined }); continue; }
    for (const run of rt.ownRuns) {
      out.push({ ...s, mods: s.mods ? { ...s.mods } : undefined, time: rt.time + run.start * rt.step, count: run.len, interval: run.len > 1 ? rt.step : 0 });
    }
  }
  return out.concat(specs);
}

/**
 * nextEnemies preview (m.private.nextEnemies): one entry per spawn action (research 08 §4.2 input), in spawn order:
 * `{ enemyKey, count, gate: 'upper'|'lower', t, fly, elite, boss, source: 'wave'|'bounty', tag, start? }` — `tag` 'boss' /
 * 'bounty' / null kept for the drawer's grouping; Σ count = the enemies of the round (HUD). Boss parts are omitted.
 * The client places the models in the gate's pen zone (≤ 50 shown, elites and bosses always) — except a leader: its
 * entry carries its spawn tile `start` ([row, col] on the boss field) and the Final Assault / Hidden Core prep shows it
 * standing there (render/app.js, community report #12; display only).
 */
export function previewOf(spawns) {
  const out = [];
  let seq = 0;
  for (const s of spawns || []) {
    if (!s || typeof s.enemyKey !== 'string' || s.tag === 'part') continue;
    const tag = s.tag === 'boss' ? 'boss' : s.tag === 'bounty' ? 'bounty' : null;
    const pv = s.preview && typeof s.preview === 'object' ? s.preview : {};
    out.push({
      enemyKey: s.enemyKey,
      count: Math.max(1, Math.trunc(Number(s.count) || 1)),
      gate: pv.gate === 'upper' ? 'upper' : 'lower',
      t: Math.max(0, Number(s.time) || 0),
      fly: !!pv.fly,
      elite: !!pv.elite || tag === 'boss',
      boss: tag === 'boss',
      source: tag === 'bounty' ? 'bounty' : 'wave',
      tag,
      ...(tag === 'boss' && Array.isArray(pv.start) && pv.start.length >= 2 && pv.start.every(Number.isFinite) ? { start: [pv.start[0], pv.start[1]] } : {}),
      _seq: seq++,
    });
  }
  out.sort((a, b) => a.t - b.t || a._seq - b._seq);
  for (const e of out) delete e._seq;
  return out;
}

/**
 * 联防 spawns from the union of leaked enemies (research 08 §5; client `GenerateHelpBattleEnemyData` /
 * `_GetSpEnemyActionData` / `_CalculateActionPredelayConsiderUid`, decoded): every leak becomes a 1-unit action on the
 * route of the escaped template's host action — walkers the first `lrsldr` action, flyers `yokai`, tokens (enemies
 * only ever summoned — enemies.json tokenOnly, or `isToken` on the leak) `gopro_2` / `lazerd`, else action 0; elites
 * and specials are NOT routed through the E / S actions. Per host action the units are grouped by owner (source
 * player, first-leak order); with W = count·interval of the host action and M = the largest owner group,
 * step = min(max(W / M, 0.05·W), MAX_ACTION_INTERVAL_FOR_UID 5 s), and unit i of the k-th owner spawns at
 * preDelay + k·ACTION_INTERVAL_FOR_UID (0.5 s) + i·step.
 * @param {Array<{ enemyKey: string, mods: object|null, sourcePlayerId: string, bounty?: object|null, isToken?: boolean }>} leaked
 * @param {number} helperCount 1 | 2
 * @returns {{ templateId: string|null, spawns: object[], routes: object[] }}
 */
export function buildUniteWave(gd, leaked, helperCount, timeLimit) { // eslint-disable-line no-unused-vars
  const templates = gd.unite.templates;
  const templateId = templates[String(helperCount)] || templates[helperCount] || null;
  const tpl = templateId ? gd.wave(templateId) : null;
  const routes = tpl && Array.isArray(tpl.routes) ? tpl.routes : [];
  const ts = gd.factions.templateSlots || {};
  const list = tpl && Array.isArray(tpl.spawns) ? tpl.spawns : [];
  const isSpawn = (s) => s && !(s.action && String(s.action).toUpperCase() !== 'SPAWN');
  /** client `_GetSpEnemyActionData`: the first action whose key is the class placeholder, else action 0 */
  const hostIndex = (fly, token) => {
    const want = token ? ts[fly ? 'TF' : 'T'] : ts[fly ? 'NF' : 'N'];
    for (let i = 0; i < list.length; i++) if (isSpawn(list[i]) && (list[i].key ?? list[i].enemyKey) === want) return i;
    return list.length ? 0 : -1;
  };
  const groups = new Map(); // host action index → Map(owner → leaks), insertion order
  const flyOf = new Map();
  for (const l of leaked || []) {
    if (!l || !gd.enemy(l.enemyKey)) continue;
    const fly = isFlyKey(gd, l.enemyKey);
    const token = l.isToken === true || gd.enemy(l.enemyKey).tokenOnly === true;
    const idx = hostIndex(fly, token);
    if (!groups.has(idx)) { groups.set(idx, new Map()); flyOf.set(idx, fly); }
    const owners = groups.get(idx);
    const owner = l.sourcePlayerId ?? '';
    if (!owners.has(owner)) owners.set(owner, []);
    owners.get(owner).push(l);
  }
  const spawns = [];
  for (const [idx, owners] of groups) {
    const a = idx >= 0 ? list[idx] : null;
    const t0 = a ? Math.max(0, Number(a.time) || 0) : 3;
    const window = a ? Math.max(1, Number.isInteger(a.count) ? a.count : 1) * Math.max(0, Number(a.interval) || 0) : 40;
    let most = 1;
    for (const units of owners.values()) most = Math.max(most, units.length);
    const step = Math.min(Math.max(window / most, MIN_ACTION_INTERVAL_RATIO * window), UNITE_MAX_UNIT_STEP);
    let routeIndex = a && Number.isInteger(a.routeIndex) ? a.routeIndex : routeByMotion(routes, flyOf.get(idx));
    if (routeIndex < 0 || routeIndex >= routes.length) routeIndex = 0;
    let k = 0;
    for (const units of owners.values()) {
      const start = t0 + k * UNITE_OWNER_STEP;
      units.forEach((l, i) => {
        const spec = {
          time: start + i * step, enemyKey: l.enemyKey, routeIndex, count: 1, interval: 0,
          mods: l.mods ? { ...l.mods } : { slot: classOf(gd, l.enemyKey) }, sourcePlayerId: l.sourcePlayerId,
          preview: previewInfo(gd, l.enemyKey, routes[routeIndex]),
        };
        if (idx >= 0) spec.actionIndex = idx;
        if (l.bounty && l.bounty.coins > 0) spec.bounty = { coins: l.bounty.coins, ownerPlayerId: l.bounty.ownerPlayerId ?? l.sourcePlayerId };
        if (l.tag === 'bounty') spec.tag = 'bounty';
        spawns.push(spec);
      });
      k++;
    }
  }
  spawns.sort((a, b) => a.time - b.time);
  return { templateId, spawns, routes };
}
