#!/usr/bin/env node
// tools/balance.mjs — difficulty MEASUREMENT: how a COMPETENT player's board fares against the official waves of every
// round (docs/BALANCE.md has the method, the curves' sources and the tables). Since research 08 the game uses the
// official numbers only (waves, counts, stat table, leader pool); this tool reports, it no longer tunes anything.
//
// For every mode (solo / multi) × difficulty × round r it builds representative boards for round r, samples many
// matches (stage, factions, bans, boss and lineups all vary with the seed), simulates the real wave of that round with
// the real Battle and FULL content (kits, talents, bonds incl. layers, IN_BATTLE garrisons, items, bands, tokens) and
// reports the leak distribution and clear time. Boss rounds (R14 / solo 标准 R9) and the Hidden Core (R15) run the
// real Final Assault fields (pairs, `_s` template for a lone player, shared boss HP pool = bloodPoint (co-op; × alive / 4
// only with config bossHpScale.aliveScaling; solo ×0.25 [ASSUMED]) — GameData.bossPoolHp —, team LP, overtime drain) and report the pool damage by 150 s, the kill time and the team LP spent.
//
// The competent board of round r (curves below, profile-scaled): shop level, deployed units, elites (精锐), equipment,
// 2–3 active bonds built around a core bond (3 members early, 6 from R11 when the pool allows it) and the layers those
// bonds carry (core ≈ 20 at R5, 80 at R10, 150 at R14; add-ons ≈ 60 % of that — the solo Hidden Core needs Σ active
// layers > 350 at R14, research 02 §2.3, which this pace reaches). Tier mix per shop level, role needs read from the
// wave preview (2 blockers, anti-air by the share of flyers, arts dealers by the enemies' armour — arts anti-air for
// armoured flyers such as 寒霜 —, one medic from R5, ≤ 2 healers) and item choice (passive combat equipment of tier
// ≤ shop level, golden from R7) follow the income / upgrade curve of research 00-INDEX §3. Co-op rounds field 4 boards
// against the same wave and run 联防 exactly like the match (server/match/unite.js). Placement = the bot's layout planner over the
// round's preview (server/match/bot.js arrange) with rehearsal of the best variants (a good player adapts the layout
// to the wave). Bounties are off; 机变 tactic cards and prep-only effects are not modeled (their value is folded
// into the curves).
//
// Usage:
//   node tools/balance.mjs [--mode solo|multi|all] [--difficulty FUNNY|NORMAL|HARD|ABYSS|ALL] [--rounds 1-15|3,8,12]
//                          [--samples N] [--boss-samples N] [--seed S] [--rehearsal N] [--profile weak|competent|strong|<x>]
//                          [--tuning on|off] [--boss-lp N] [--no-boss] [--boss-only] [--json] [--quiet] [--bots N]
//   --samples N       sampled matches per normal round (default solo 16, multi 6 — a multi match fields 4 boards, then
//                     联防 runs like the match; leak columns are per board, "LP/rd" is the LP loss after 联防)
//   --group N         boards per multi match (default 4; 1 = no 联防)
//   --boss-samples N  sampled matches per boss / hidden round (default 8)
//   --rehearsal N     layout variants a board rehearses (default 5 = every bot variant; 0 = heuristic planner only)
//   --profile         curve multiplier for elites, items and layers (weak 0.6, competent 1, strong 1.4, or a number;
//                     a bond's layers stop at BOND_LAYER_CAP, 999)
//   --tuning off      ignore data/tuning.json (it only holds title rules now: no effect on the numbers)
//   --legacy-time     read the combat limits as game seconds (the reading before the fix of docs/BALANCE.md §2.1)
//   --boss-lp N       team LP per alive player entering the Final Assault (default 15)
//   --bots N          also run N bot matches per mode × difficulty (tools/matchrun.mjs logic, 4 AI in multi, the
//                     match's default bot rehearsal) and print rounds survived / wins
//   --json            machine-readable output (the tables' numbers)
// Examples:
//   node tools/balance.mjs --mode multi --difficulty NORMAL
//   node tools/balance.mjs --mode all --difficulty ALL --samples 8 --json > /tmp/balance.json
//   node tools/balance.mjs --mode multi --difficulty HARD --rounds 12-15 --tuning off

import { pathToFileURL } from 'node:url';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { getData } from '../server/data.js';
import { buildNormalWave, buildBossWave } from '../server/match/waves.js';
import { arrange } from '../server/match/bot.js';
import { computeBonds } from '../server/match/bondsMeta.js';
import { basePositionClass } from '../server/match/board.js';
import { pairPlayers, bossPoolHp, SharedBossPool } from '../server/match/finalAssault.js';
import { planUnite, uniteBattleOpts, uniteSurvivors } from '../server/match/unite.js';
import { createRng, deriveSeed } from '../server/sim/rng.js';
import { GEO, PHASE, layerGainRoom } from '../shared/constants.js';
import { TICK } from '../server/sim/constants.js';

export const DIFFS = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
export const DIFF_NAMES = { FUNNY: '标准', NORMAL: '险境', HARD: '绝境', ABYSS: '终极' };

// ---- the competent-player model (index = round; see the header and docs/BALANCE.md §1.1) --------------------------
export const CURVES = Object.freeze({
  //            R0 R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 R13 R14 R15
  level:       [1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 6],
  units:       [0, 2, 4, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
  elites:      [0, 0, 0, 0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 6, 6.5, 7],
  items:       [0, 0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 5.5, 6, 7, 8, 9, 9],
  coreCount:   [0, 0, 0, 3, 3, 3, 3, 3, 3, 4, 5, 6, 6, 6, 6, 6],
  addons:      [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  coreLayers:  [0, 0, 2, 6, 12, 20, 28, 38, 50, 65, 80, 95, 110, 130, 150, 170],
  addonLayers: [0, 0, 1, 4, 8, 12, 17, 23, 30, 38, 46, 55, 65, 75, 90, 100],
});
/** Tier weights (T1…T6) of the units a competent player fields at each shop level. */
export const TIER_MIX = Object.freeze({
  1: [1],
  2: [0.5, 0.5],
  3: [0.2, 0.35, 0.45],
  4: [0.08, 0.2, 0.37, 0.35],
  5: [0.04, 0.08, 0.23, 0.35, 0.3],
  6: [0.02, 0.05, 0.15, 0.25, 0.3, 0.23],
});
/** Add-on bonds with a battle effect (economy / special counting bonds are left to chance). */
export const BATTLE_ADDONS = Object.freeze(['preciShip', 'swiftShip', 'skillfulShip', 'arcaneShip', 'steadShip', 'deputShip', 'raidShip', 'indomShip']);
export const PROFILES = Object.freeze({ weak: 0.6, competent: 1, strong: 1.4 });

const QUIET_LOG = { info() {}, debug() {}, warn() {}, error() {} };
const curve = (name, r) => { const a = CURVES[name]; return a[Math.max(0, Math.min(a.length - 1, r))]; };
const frac = (x, rng) => Math.max(0, Math.floor(x + rng()));

// ---- chess helpers ----------------------------------------------------------------------------------------------
const isHealer = (c) => !!c && (c.dmgType === 'heal' || c.attackKind === 'heal');
// the record's own position (bot.js isBlocker): a 钩索师 / 推击手 still blocks on a ground tile
const isBlocker = (c) => !!c && basePositionClass(c) === 'melee' && (c.stats?.blockCnt ?? 1) > 0 && c.attackKind !== 'none' && !isHealer(c);
const hitsFly = (c) => !!c && !!c.canHitFly && !isHealer(c) && c.attackKind !== 'none';
const isDealer = (c) => !!c && !isHealer(c) && c.attackKind !== 'none';

/** Data view without data/tuning.json (title rules only; kept for the --tuning flag and the tests). */
export function withoutTuning(data) {
  const { tuning, ...rest } = data; // eslint-disable-line no-unused-vars
  return Object.freeze(rest);
}

export function makeMatch({ data, mode, difficulty, seed, players = 1, rehearsal = 3 }) {
  const seats = [];
  for (let i = 0; i < players; i++) seats.push({ seat: i, playerId: `p${i}`, name: `P${i + 1}`, isBot: false, connected: true });
  const m = new Match({
    roomCode: 'BAL', mode, difficulty, seats, seed, data, log: QUIET_LOG, scheduler: new VirtualScheduler(),
    send: () => true, broadcast: () => {}, onEnd: () => {}, botRehearsal: rehearsal,
  });
  return m;
}

/**
 * What a player reads from the wave preview: the share of flyers (anti-air needs) and the HP-weighted armour of the
 * ground enemies (arts needs). `spawns` = SpawnSpec[] of the round (normal wave or the player's boss field).
 */
export function waveNeeds(gd, spawns) {
  let fly = 0;
  let total = 0;
  let defHp = 0;
  let hp = 0;
  let flyDefHp = 0;
  let flyHp = 0;
  for (const s of spawns || []) {
    const e = gd.enemy(s.enemyKey);
    if (!e || s.tag === 'part') continue;
    const n = Math.max(1, s.count || 1);
    const isFly = !!((e.stats && e.stats.motion === 'FLY') || e.isFlyEnemy);
    const h = (e.stats?.maxHp || 1000) * (s.mods?.hpMul || 1) * n;
    total += n;
    if (isFly) { fly += n; flyHp += h; flyDefHp += h * (e.stats?.def || 0); } else { hp += h; defHp += h * (e.stats?.def || 0); }
  }
  return { flyShare: total ? fly / total : 0, armour: hp ? defHp / hp : 0, flyArmour: flyHp ? flyDefHp / flyHp : 0 };
}

/**
 * Lineup of a competent player for round r: base chess ids + which ones are elite, the bond plan and the items.
 * @returns {{ level: number, units: string[], elites: Set<string>, core: string|null, addons: string[], items: string[] }}
 */
export function planBoard(m, r, rng, { profile = 1, spawns = null } = {}) {
  const gd = m.gd;
  const level = Math.min(gd.maxShopLevel, curve('level', r));
  const mix = TIER_MIX[level] || TIER_MIX[6];
  const rec = (id) => gd.chess(id);
  const avail = gd.visibleChess.filter((id) => m.pool.has(id) && gd.tierOf(id) <= level);
  const n = Math.min(curve('units', r), gd.deployCap, avail.length);
  const chosen = [];
  const bondsOf = (id) => (rec(id) && Array.isArray(rec(id).bonds) ? rec(id).bonds : []);
  const members = (b) => avail.filter((id) => bondsOf(id).includes(b));
  const count = (b) => chosen.filter((id) => bondsOf(id).includes(b)).length;
  const tierW = (id) => mix[gd.tierOf(id) - 1] ?? 0.01;
  const planned = new Set();
  // role needs from the wave preview (a competent player reads the enemies before buying)
  const needs = waveNeeds(gd, spawns || (m.wave ? m.wave.spawns : []));
  const isArts = (c) => isDealer(c) && (c.dmgType === 'arts' || c.profession === 'CASTER');
  const roleNeed = [
    [isBlocker, n >= 4 ? 2 : 1],
    [hitsFly, needs.flyShare > 0 ? Math.max(1, Math.min(n - 2, Math.round(n * (0.2 + 0.6 * needs.flyShare)))) : 0],
    [isArts, needs.armour > 900 ? 3 : needs.armour > 450 ? 2 : n >= 6 ? 1 : 0],
    // armoured flyers (寒霜 DEF 600 …) need arts anti-air
    [(c) => isArts(c) && hitsFly(c), needs.flyShare > 0 && needs.flyArmour > 350 ? Math.min(2, Math.max(1, n - 4)) : 0],
    [isHealer, r >= 5 && n >= 6 ? 1 : 0],
  ];
  const unmet = (id) => roleNeed.filter(([pred, k]) => k > 0 && pred(rec(id)) && chosen.filter((x) => pred(rec(x))).length < k).length;
  const synergy = (id) => (1 + 2 * bondsOf(id).filter((b) => planned.has(b)).length) * (1 + 1.5 * unmet(id));
  const add = (list, w = () => 1) => {
    const pool = list.filter((id) => !chosen.includes(id));
    if (!pool.length || chosen.length >= n) return null;
    const id = rng.weighted(pool, (x) => tierW(x) * w(x));
    if (id) chosen.push(id);
    return id;
  };
  // 1. core bond
  let core = null;
  const coreTarget = Math.min(n, curve('coreCount', r));
  if (coreTarget > 0) {
    const cores = gd.bondIds.filter((b) => gd.bond(b).isCore && !gd.modeInactiveBonds.has(b) && members(b).length >= 3);
    core = cores.length ? rng.weighted(cores, (b) => members(b).length) : null;
    if (core) {
      planned.add(core);
      const target = Math.min(coreTarget, members(core).length);
      for (let g = 0; g < 20 && count(core) < target; g++) if (!add(members(core), synergy)) break;
    }
  }
  // 2. add-on bonds (their first threshold; the second one late when it exists)
  const addons = [];
  for (let k = 0; k < curve('addons', r); k++) {
    const cands = BATTLE_ADDONS.filter((b) => gd.bond(b) && !gd.modeInactiveBonds.has(b) && !addons.includes(b) && members(b).length >= 2);
    if (!cands.length) break;
    const b = rng.weighted(cands, (x) => 1 + 3 * count(x));
    addons.push(b);
    planned.add(b);
    const th = gd.bond(b).thresholds || [2];
    const target = r >= 9 && th.length > 1 ? th[1] : th[0];
    for (let g = 0; g < 10 && count(b) < target && chosen.length < n; g++) if (!add(members(b), synergy)) break;
  }
  // 3. roles, then fill (bond synergy preferred)
  const need = (pred, k, list = avail) => { for (let g = 0; g < 10 && chosen.filter((id) => pred(rec(id))).length < k && chosen.length < n; g++) if (!add(list.filter((id) => pred(rec(id))), synergy)) break; };
  for (const [pred, k] of roleNeed) need(pred, Math.min(k, n - 1));
  for (let g = 0; g < 30 && chosen.length < n; g++) {
    const healers = chosen.filter((id) => isHealer(rec(id))).length;
    if (!add(avail, (id) => (isHealer(rec(id)) && healers >= (r >= 9 ? 2 : 1) ? 0.01 : synergy(id)))) break;
  }
  // 4. elites (easier to triple at lower tiers; the core bond's carries first)
  const nElite = Math.min(chosen.length, frac(curve('elites', r) * profile, rng));
  const elites = new Set();
  for (let g = 0; g < nElite; g++) {
    const pool = chosen.filter((id) => !elites.has(id) && gd.goldenIdOf(id));
    if (!pool.length) break;
    elites.add(rng.weighted(pool, (id) => (core && bondsOf(id).includes(core) ? 2 : 1) * (gd.tierOf(id) <= Math.max(1, level - 1) ? 1 : 0.35)));
  }
  // 5. equipment: passive combat items of tier ≤ shop level (higher tiers preferred), golden from R7
  const itemPool = [];
  for (let t = 1; t <= level; t++) {
    for (const id of gd.shopItemsByTier[t] || []) {
      const it = gd.item(id);
      if (!it || it.canGiveBond || !(it.kind === 'passive' || it.kind === 'passive_counter')) continue;
      itemPool.push(id);
    }
  }
  const items = [];
  const nItems = Math.min(chosen.length * 2, frac(curve('items', r) * profile, rng));
  for (let i = 0; i < nItems && itemPool.length; i++) {
    let id = rng.weighted(itemPool, (x) => gd.tierOf(x));
    const golden = r >= 7 && rng() < 0.25 ? gd.item(id.replace(/_a$/, '_b')) : null;
    if (golden) id = golden.id;
    items.push(id);
  }
  return { level, units: chosen, elites, core, addons, items };
}

/**
 * Put a planned board on a player: pieces into the hand, items equipped on the damage dealers, layers on the active
 * bonds, band, then the bot's placement (with rehearsal when the match allows it).
 */
export function applyBoard(m, ps, plan, r, rng, { profile = 1 } = {}) {
  const gd = m.gd;
  m.phase = PHASE.PREP;
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.effects = [];
  ps.bounties = [];
  ps.layers = {};
  ps.shop.level = plan.level;
  const bands = gd.bandIds();
  ps.bandId = bands.length ? rng.pick(bands) : gd.defaultBandId;
  const pieces = plan.units.map((id, i) => {
    const cid = plan.elites.has(id) ? gd.goldenIdOf(id) || id : id;
    const p = ps.newPiece('chess', cid);
    ps.hand[i] = p;
    return p;
  });
  // items: best carriers are damage dealers (elites / higher tiers first), two each
  const carriers = pieces.filter((p) => isDealer(gd.chess(p.id))).sort((a, b) => gd.tierOf(b.id) + (gd.isGolden(b.id) ? 2 : 0) - gd.tierOf(a.id) - (gd.isGolden(a.id) ? 2 : 0));
  const order = carriers.concat(pieces.filter((p) => !carriers.includes(p)));
  let ci = 0;
  for (const id of plan.items) {
    while (ci < order.length && order[ci].items.length >= gd.equipPerChess) ci++;
    if (ci >= order.length) break;
    order[ci].items.push(ps.newPiece('item', id));
  }
  ps.recompute();
  // layers: the core bond on the core curve, every other bond the full lineup activates on the add-on curve (±20 %
  // jitter); computed with every planned piece on the board (they are still in the hand here)
  const jit = () => 0.8 + 0.4 * rng();
  const all = new Map(pieces.map((p, i) => [`x${i}`, p]));
  const planned = computeBonds(gd, { board: all, hand: [], layers: {}, bondCountBonus: {} });
  for (const [id, b] of Object.entries(planned)) {
    if (!b.active) continue;
    const base = id === plan.core ? curve('coreLayers', r) : curve('addonLayers', r);
    const v = layerGainRoom(0, Math.round(base * profile * jit())); // ≤ BOND_LAYER_CAP (999) for any --profile
    if (v > 0) ps.layers[id] = v;
  }
  ps.recompute();
  arrange(m, ps, { final: true });
  ps.recompute();
  return ps;
}

// ---- one normal round -------------------------------------------------------------------------------------------
function stepToEnd(b, limit) {
  const cap = Math.ceil(((limit || 60) + 10) / TICK);
  for (let t = 0; t < cap && !b.finished; t++) b.step();
  if (!b.finished) b.forceEnd('timeout');
  return b.result();
}

/**
 * One normal round of one match with `players` competent boards (co-op: 4 — every board fights the same wave, then
 * 联防 runs exactly like the match: ≤ 2 perfect helpers keep HP / SP and fight the union of the leaks; only the
 * survivors cost their source LP). Returns one row per player.
 */
export function runRound({ data, mode, difficulty, round, seed, rehearsal = 5, profile = 1, players = 1 }) {
  const n = mode === 'solo' ? 1 : Math.max(1, Math.min(4, players));
  const m = makeMatch({ data, mode, difficulty, seed, players: n, rehearsal });
  const rng = createRng(deriveSeed(seed, `board:${round}`));
  m.round = round;
  m.wave = buildNormalWave(m.gd, m.rngWaves, m.factions, round);
  m.lastResults = new Map();
  const cap = m.gd.lpCapPerRound;
  const rows = [];
  for (const ps of m.order) {
    ps.lp = 20;
    const plan = planBoard(m, round, rng, { profile });
    applyBoard(m, ps, plan, round, rng, { profile });
    let goal = 0;
    const b = m._normalBattle(ps);
    b.on('enemyLeak', () => { goal++; }, { priority: -1000, owner: 'balance' });
    const res = stepToEnd(b, m.wave.timeLimit);
    const pp = res.perPlayer[ps.playerId] || { leaked: [], killed: 0, total: 0, deaths: 0, perfect: true };
    m.lastResults.set(ps.playerId, pp);
    const leakedList = (pp.leaked || []).filter((l) => l && l.counted !== false);
    const leaks = leakedList.length;
    const leakKeys = {};
    for (const l of leakedList) leakKeys[l.enemyKey] = (leakKeys[l.enemyKey] || 0) + 1;
    rows.push({
      round, seed, playerId: ps.playerId, stageId: m.stageId, factions: m.factions.slice(), bandId: ps.bandId, level: plan.level,
      units: ps.deployCount, elites: [...ps.board.values()].filter((p) => p.kind === 'chess' && m.gd.isGolden(p.id)).length,
      items: [...ps.board.values()].reduce((sum, p) => sum + (p.items ? p.items.length : 0), 0),
      bonds: Object.entries(ps.bonds).filter(([, x]) => x.active).map(([id, x]) => ({ id, count: x.count, tier: x.tier, layers: x.layers })),
      activatedLayers: ps.activatedLayers(),
      leaks, lpLoss: Math.min(leaks, cap), goalLeaks: goal, killed: pp.killed, total: pp.total,
      time: res.time, timeLimit: m.wave.timeLimit, cleared: res.reason === 'cleared', deaths: pp.deaths || 0, leakKeys, unite: false,
    });
  }
  // 联防 (co-op): the Match's own planning / battle options / LP attribution
  const plan = n > 1 ? planUnite(m, m.lastResults) : null;
  if (plan) {
    const limit = m.wave.timeLimit;
    const { wave, players: inputs } = uniteBattleOpts(m, plan, limit);
    const b = m.newBattle({
      seed: deriveSeed(m.seed, `u:${round}`), kind: 'unite', modeId: m.modeId, round, stageId: m.stageId, rect: { ...GEO.UNITE_RECT },
      timeLimit: limit, players: inputs, spawns: m._sanitizeSpawns(wave.spawns), routes: wave.routes, sharedBoss: null,
      flags: { layerGainsEnabled: false, ...m.gd.dp }, fieldId: 'u', enemyOverrides: m.wave.overrides || {}, waveId: wave.templateId,
    });
    const survivors = uniteSurvivors(plan, stepToEnd(b, limit));
    for (const row of rows) {
      if (!plan.leakers.some((p) => p.playerId === row.playerId)) continue;
      row.unite = true;
      row.lpLoss = Math.min(cap, survivors.get(row.playerId) || 0);
    }
  }
  m.dispose();
  return rows;
}

/** One competent board, one normal round (solo, or one co-op seat without 联防). */
export function runNormal(opts) {
  return runRound({ ...opts, players: 1 })[0];
}

// ---- boss / hidden round ----------------------------------------------------------------------------------------
/**
 * Final Assault (or Hidden Core) with competent boards: every alive player (4 in multi, 1 in solo) fields a board of
 * the round, fields are built exactly like Match.startFinalAssault, stepped in lockstep until the pool dies, the team
 * LP runs out (leaks' lifePointReduce + 1 LP/s overtime after 150 s) or `tMax`.
 */
export function runBoss({ data, mode, difficulty, round, seed, profile = 1, bossLp = 15, tMax = 420, bossId = null }) {
  const players = mode === 'solo' ? 1 : 4;
  const m = makeMatch({ data, mode, difficulty, seed, players, rehearsal: 0 });
  const gd = m.gd;
  const hidden = round === gd.hiddenRound && round !== gd.bossRound;
  const id = bossId || (hidden ? m.hiddenBossId : m.bossId);
  const rng = createRng(deriveSeed(seed, `boss:${round}`));
  m.round = round;
  m.wave = null;
  // the boss fields are known during the prep (Match.startRound), so the boards are placed against them
  const groups = pairPlayers(m.alivePlayers());
  m.bossWaves = groups.map((g) => ({ players: g.map((p) => p.playerId), wave: buildBossWave(gd, m.rngWaves, m.factions, round, { bossId: id, solo: m.isSolo || g.length === 1 }) }));
  for (const [i, g] of groups.entries()) {
    for (const ps of g) {
      ps.lp = bossLp;
      applyBoard(m, ps, planBoard(m, round, rng, { profile, spawns: m.bossWaves[i].wave.spawns }), round, rng, { profile });
    }
  }
  const alive = m.alivePlayers();
  // the official pool (co-op = bloodPoint, × alive / 4 only with aliveScaling, DESIGN §20.10; solo ×0.25) — the match's own rule
  const pool = new SharedBossPool(bossPoolHp(gd, id, alive.length));
  let teamLp = alive.reduce((s, p) => s + p.lp, 0);
  const teamLp0 = teamLp;
  let leakLp = 0;
  const battles = groups.map((g, i) => {
    const wave = m.bossWaves[i].wave;
    const spawns = wave.spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    const inputs = g.map((ps, j) => {
      const input = ps.battleInput({ side: j === 0 ? 'L' : 'R', colOffset: j === 0 ? 0 : 8 });
      input.lpForBoss = teamLp;
      const ev = { input, kind: hidden ? 'hidden' : 'boss', round, spawns };
      m.dispatch(ps, 'onBattleStart', ev);
      return ev.input && typeof ev.input === 'object' ? ev.input : input;
    });
    const fieldId = `b${i + 1}`;
    const b = m.newBattle({
      seed: deriveSeed(m.seed, `${fieldId}:${round}`), kind: hidden ? 'hidden' : 'boss', modeId: m.modeId, round, stageId: m.stageId,
      rect: { ...GEO.BOSS_RECT }, timeLimit: Infinity, players: inputs, spawns: m._sanitizeSpawns(spawns), routes: wave.routes,
      sharedBoss: pool, flags: { layerGainsEnabled: false, ...gd.dp }, fieldId, enemyOverrides: wave.overrides, waveId: wave.templateId, bossId: id,
    });
    b.on('enemyLeak', (ctx) => {
      const e = ctx && ctx.enemy;
      const lpr = e && Number.isFinite(e.lpr) && e.lpr >= 0 ? e.lpr : 1;
      if (lpr > 0) { teamLp -= lpr; leakLp += lpr; }
    }, { priority: -1000, owner: 'balance' });
    return b;
  });
  const after = gd.bossOvertimeAfter;
  let dmg150 = null;
  let killTime = null;
  let t = 0;
  let drained = 0;
  const cap = Math.ceil(tMax / TICK);
  for (let k = 0; k < cap; k++) {
    for (const b of battles) if (!b.finished) b.step();
    t = (k + 1) * TICK;
    if (dmg150 == null && t >= after) dmg150 = pool.maxHp - pool.hp;
    const over = t - after;
    if (over >= 1) { const due = Math.floor(over) * gd.bossOvertimeDrain; if (due > drained) { teamLp -= due - drained; drained = due; } }
    if (pool.hp <= 0) { killTime = t; break; }
    if (teamLp <= 0) break;
    if (battles.every((b) => b.finished)) break;
  }
  if (dmg150 == null) dmg150 = pool.maxHp - pool.hp;
  const dmg = pool.maxHp - pool.hp;
  const out = {
    round, seed, hidden, bossId: id, stageId: m.stageId, players: alive.length, pool: pool.maxHp, dmg150, dmg,
    ratio150: dmg150 / pool.maxHp, killTime, victory: pool.hp <= 0 && teamLp > 0, teamLp0, teamLpEnd: Math.max(0, teamLp), leakLp,
    time: t, dps: dmg / Math.max(1, killTime ?? t),
  };
  for (const b of battles) if (!b.finished) b.forceEnd('forced');
  m.dispose();
  return out;
}

// ---- aggregation -------------------------------------------------------------------------------------------------
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

export function summarizeNormal(rows) {
  const leaks = rows.map((x) => x.leaks);
  return {
    round: rows[0]?.round, n: rows.length, level: rows[0]?.level,
    elites: avg(rows.map((x) => x.elites)), items: avg(rows.map((x) => x.items)), layers: avg(rows.map((x) => x.activatedLayers)),
    leaksAvg: avg(leaks), leaksP50: pct(leaks, 0.5), leaksP90: pct(leaks, 0.9), lpAvg: avg(rows.map((x) => x.lpLoss)),
    // what a board alone would lose: leaks capped at the per-round LP cap (the balance targets use this)
    leaksCapped: avg(rows.map((x) => Math.min(x.leaks, 10))),
    uniteShare: rows.filter((x) => x.unite).length / Math.max(1, rows.length),
    perfect: rows.filter((x) => x.leaks === 0).length / Math.max(1, rows.length),
    goalShare: avg(rows.map((x) => (x.leaks ? x.goalLeaks / x.leaks : 0))),
    killRate: avg(rows.map((x) => (x.total ? x.killed / x.total : 1))),
    clearTime: avg(rows.filter((x) => x.cleared).map((x) => x.time)), cleared: rows.filter((x) => x.cleared).length / Math.max(1, rows.length),
    timeLimit: rows[0]?.timeLimit, deaths: avg(rows.map((x) => x.deaths)),
    topLeakers: topLeakers(rows),
  };
}

/** The enemies that leak most often over a set of samples: [[enemyKey, leaks per sample]] (top 4). */
function topLeakers(rows) {
  const t = {};
  for (const x of rows) for (const [k, n] of Object.entries(x.leakKeys || {})) t[k] = (t[k] || 0) + n;
  return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => [k, n / Math.max(1, rows.length)]);
}

export function summarizeBoss(rows) {
  const kills = rows.filter((x) => x.killTime != null);
  return {
    round: rows[0]?.round, n: rows.length, hidden: rows[0]?.hidden,
    ratio150: avg(rows.map((x) => x.ratio150)), ratio150Min: Math.min(...rows.map((x) => x.ratio150)),
    killRate: kills.length / Math.max(1, rows.length), killTime: avg(kills.map((x) => x.killTime)),
    victory: rows.filter((x) => x.victory).length / Math.max(1, rows.length),
    leakLp: avg(rows.map((x) => x.leakLp)), pool: avg(rows.map((x) => x.pool)),
    byBoss: Object.fromEntries([...new Set(rows.map((x) => x.bossId))].sort().map((id) => {
      const rs = rows.filter((x) => x.bossId === id);
      return [id, { n: rs.length, pool: rs[0].pool, ratio150: avg(rs.map((x) => x.ratio150)), victory: rs.filter((x) => x.victory).length / rs.length, killTime: avg(rs.filter((x) => x.killTime != null).map((x) => x.killTime)) }];
    })),
  };
}

/** Run the model for one mode × difficulty. */
export function runMode({ data, mode, difficulty, rounds = null, samples = 12, bossSamples = 8, seed = 1, rehearsal = 5, profile = 1, bossLp = 15, boss = true, normal = true, groupSize = 4, onRow = null }) {
  const modeKey = mode === 'solo' ? 'solo' : 'coop';
  const probe = makeMatch({ data, mode: modeKey, difficulty, seed: 1, players: 1, rehearsal: 0 });
  const gd = probe.gd;
  const last = gd.hiddenRound || gd.lastRound;
  const bossRound = gd.bossRound;
  const hiddenRound = gd.hiddenRound;
  probe.dispose();
  const list = (rounds || Array.from({ length: last }, (_, i) => i + 1)).filter((r) => r >= 1 && r <= last);
  const out = { mode: modeKey, modeId: gd.modeId, difficulty, normal: [], boss: [] };
  for (const r of list) {
    const isBoss = r === bossRound || r === hiddenRound;
    if (isBoss && !boss) continue;
    if (!isBoss && !normal) continue;
    const rows = [];
    const n = isBoss ? bossSamples : samples;
    for (let i = 0; i < n; i++) {
      const s = deriveSeed(seed, `${gd.modeId}:${r}:${i}`) || 1;
      if (isBoss) rows.push(runBoss({ data, mode: modeKey, difficulty, round: r, seed: s, profile, bossLp }));
      else rows.push(...runRound({ data, mode: modeKey, difficulty, round: r, seed: s, rehearsal, profile, players: modeKey === 'solo' ? 1 : groupSize }));
    }
    const sum = isBoss ? summarizeBoss(rows) : summarizeNormal(rows);
    (isBoss ? out.boss : out.normal).push(sum);
    if (onRow) onRow(isBoss ? 'boss' : 'normal', sum, out);
  }
  return out;
}

// ---- bots (tools/matchrun.mjs essentials) -------------------------------------------------------------------------
export function runBots({ data, mode, difficulty, seeds = 10, seed = 1, rehearsal = undefined }) {
  const players = mode === 'solo' ? 1 : 4;
  const res = [];
  for (let i = 0; i < seeds; i++) {
    const sched = new VirtualScheduler();
    let summary = null;
    const seats = [];
    for (let k = 0; k < players; k++) seats.push({ seat: k, playerId: `ai_${k}`, name: `AI-${k + 1}`, isBot: true, connected: true });
    const m = new Match({
      roomCode: 'BOT', mode: mode === 'solo' ? 'solo' : 'coop', difficulty, seats, seed: seed + i, data, log: QUIET_LOG, scheduler: sched,
      botRehearsal: rehearsal, send: () => true, broadcast: () => {}, onEnd: (s) => { summary = s; },
    });
    m.start();
    sched.runUntil(() => summary != null, { maxSteps: 5e6 });
    m.dispose();
    res.push({ victory: !!summary?.victory, roundsPassed: summary?.roundsPassed ?? 0, hidden: !!summary?.hiddenReached });
  }
  return {
    n: res.length, wins: res.filter((x) => x.victory).length, hidden: res.filter((x) => x.hidden).length,
    roundsAvg: avg(res.map((x) => x.roundsPassed)), rounds: res.map((x) => x.roundsPassed),
  };
}

// ---- CLI --------------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    opt[k] = v;
  }
  return opt;
}

function parseRounds(s) {
  if (!s || s === true) return null;
  const out = new Set();
  for (const part of String(s).split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let r = Math.min(a, b); r <= Math.max(a, b); r++) out.add(r);
  }
  return [...out].sort((a, b) => a - b);
}

let ENEMY_NAME = (k) => k;
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const p0 = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-');
const k0 = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : `${Math.round(x / 1000)}k`);

function printNormalHeader() {
  console.log('  R  lv  el  it  layers | leaks capped  avg  p50  p90  perfect  LP/rd 联防% | kill%  goal%  cleared  clear s / limit  deaths  top leakers');
}
function printNormal(s) {
  console.log(`  ${String(s.round).padStart(2)}  ${s.level}  ${f1(s.elites).padStart(3)} ${f1(s.items).padStart(3)} ${String(Math.round(s.layers)).padStart(6)} | ${f2(s.leaksCapped).padStart(12)} ${f2(s.leaksAvg).padStart(5)} ${String(s.leaksP50).padStart(4)} ${String(s.leaksP90).padStart(4)} ${p0(s.perfect).padStart(8)} ${f2(s.lpAvg).padStart(6)} ${p0(s.uniteShare).padStart(4)} | ${p0(s.killRate).padStart(5)} ${p0(s.goalShare).padStart(6)} ${p0(s.cleared).padStart(8)}  ${f1(s.clearTime).padStart(6)} / ${String(s.timeLimit).padStart(3)}   ${f1(s.deaths).padStart(5)}  ${(s.topLeakers || []).map(([k, v]) => `${ENEMY_NAME(k)} ${f1(v)}`).join(', ')}`);
}
function printBoss(s) {
  console.log(`  R${s.round}${s.hidden ? ' (隐秘核心)' : ' (最终攻势)'} pool ${k0(s.pool)} · dmg by 150 s ${p0(s.ratio150)} of the pool (min ${p0(s.ratio150Min)}) · killed ${p0(s.killRate)} in ${f1(s.killTime)} s · victory ${p0(s.victory)} · leak LP ${f1(s.leakLp)}`);
  for (const [id, b] of Object.entries(s.byBoss)) console.log(`      ${id.padEnd(8)} n${b.n} pool ${k0(b.pool).padStart(6)} · @150 s ${p0(b.ratio150).padStart(5)} · victory ${p0(b.victory).padStart(4)} · kill ${f1(b.killTime)} s`);
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) {
    const fs = await import('node:fs');
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return;
  }
  const full = getData({ log: QUIET_LOG });
  ENEMY_NAME = (k) => (full.enemies && full.enemies[k] ? full.enemies[k].name : k);
  let data = opt.tuning === 'off' ? withoutTuning(full) : full;
  // --legacy-time: combat limits read as game seconds (the pre-fix reading, docs/BALANCE.md §2.1)
  if (opt['legacy-time']) data = Object.freeze({ ...data, config: { ...data.config, combatTimeScale: 1 } });
  const modes = opt.mode === 'all' ? ['solo', 'multi'] : [opt.mode === 'solo' ? 'solo' : 'multi'];
  const dArg = String(opt.difficulty || 'NORMAL').toUpperCase();
  const diffs = dArg === 'ALL' ? DIFFS : [DIFFS.includes(dArg) ? dArg : 'NORMAL'];
  const profile = PROFILES[opt.profile] ?? (Number(opt.profile) > 0 ? Number(opt.profile) : 1);
  const common = {
    data, rounds: parseRounds(opt.rounds), samples: Number(opt.samples) > 0 ? Number(opt.samples) : null, bossSamples: Math.max(1, Number(opt['boss-samples']) || 8),
    groupSize: Number(opt.group) > 0 ? Math.min(4, Number(opt.group)) : 4,
    seed: Number(opt.seed) || 1, rehearsal: opt.rehearsal != null && opt.rehearsal !== true ? Math.max(0, Math.floor(Number(opt.rehearsal) || 0)) : 5,
    profile, bossLp: Number(opt['boss-lp']) > 0 ? Number(opt['boss-lp']) : 15, boss: !opt['no-boss'], normal: !opt['boss-only'],
  };
  const all = [];
  for (const mode of modes) {
    for (const difficulty of diffs) {
      const t0 = Date.now();
      if (!opt.json) {
        console.log(`\n== ${mode} ${difficulty} (${DIFF_NAMES[difficulty]}) · profile ${profile} · samples ${common.samples ?? (mode === 'solo' ? 16 : 6)}${mode === 'solo' ? '' : `×${common.groupSize} boards`}/${common.bossSamples} · rehearsal ${common.rehearsal} · tuning ${opt.tuning === 'off' ? 'off' : 'on'}`);
        printNormalHeader();
      }
      const res = runMode({
        ...common, mode, difficulty, samples: common.samples ?? (mode === 'solo' ? 16 : 6),
        onRow: opt.json || opt.quiet ? null : (kind, s) => (kind === 'boss' ? printBoss(s) : printNormal(s)),
      });
      if (Number(opt.bots) > 0) {
        res.bots = runBots({ data, mode, difficulty, seeds: Number(opt.bots), seed: common.seed });
        if (!opt.json) console.log(`  bots (${mode === 'solo' ? 1 : 4} AI): wins ${res.bots.wins}/${res.bots.n} · rounds passed avg ${f1(res.bots.roundsAvg)} [${res.bots.rounds.join(' ')}] · hidden ${res.bots.hidden}`);
      }
      if (!opt.json) {
        const late = res.normal.filter((s) => s.round >= 8);
        console.log(`  → capped leaks per round: avg ${f2(avg(res.normal.map((s) => s.leaksCapped)))} · R8+ ${f2(avg(late.map((s) => s.leaksCapped)))} · worst round ${f2(Math.max(0, ...res.normal.map((s) => s.leaksCapped)))} · LP/rd ${f2(avg(res.normal.map((s) => s.lpAvg)))} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      }
      all.push(res);
    }
  }
  if (opt.json) console.log(JSON.stringify(all, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
