#!/usr/bin/env node
// tools/golden.mjs — golden-result safety net for behaviour-preserving refactors (test/golden/README.md).
//
// Runs a fixed corpus of seeded, deterministic scenarios and reduces each one to a compact digest; the digests are
// stored in test/golden/<family>.json and test/golden.test.js recomputes and compares them. A refactor that reorders
// random draws, hook order or iteration order changes a digest and fails loudly (scenario, field, old → new).
//
// Usage:
//   node tools/golden.mjs                 compare the corpus with test/golden/*.json (exit 1 on a difference)
//   node tools/golden.mjs --update        recompute and rewrite test/golden/*.json   (npm run golden:update)
//   options: --family roster,bonds,fields,matches,standins   --fast (the test's default subset)   --only <id,id>
//            --jobs N (worker threads, default: up to 4)   --list   --coverage (skills cast, stages, enemies…)
//            --twice  determinism: compute twice in this process (the second pass in reverse order) and compare
//
// Families (all scenarios are generated from data/*.json in a fixed order — no randomness outside the seeds):
//   roster   49 battles: every visible chess record (normal + elite) with every selectable skill and module (DESIGN
//            §16; 575 loadouts), 12 per battle with distinct chess ids, on a real stage (all 11, in turn), against the
//            round's real wave (server/match/waves.js buildNormalWave: faction picks, enemy scale) three times over plus
//            every non-leader enemy kind of data/enemies.json twice as extra spawns (half of them bounties); melee
//            operators on the tiles the enemy paths cross, ranged ones beside them, every 7th facing UP / LEFT / DOWN;
//            placeable summons on the board; every equipment item, band, battle-side 机变 card and stage map card in
//            turn; bonds from the board (bondsMeta.computeBonds) with 0–120 layers
//   bonds    46 battles: every bond at its activation threshold (1 layer) and at its top tier (999 layers), 8 operators
//   fields   22 battles: every Final Assault / Hidden Core leader on its pair and its solo template (a shared boss pool,
//            ended at 200 game s) and 联防 fields (1 and 2 helpers on the round's stage — the helpers' boards laid out on
//            that same stage —, carried HP / SP, a knocked-out operator, two leakers' enemies with a summoned-only kind
//            and a bounty)
//   matches  18 matches run to the end in virtual time with the match's default bot rehearsal: 16 bot-only (solo 标准 /
//            险境 / 绝境 / 终极 ×2 seeds, co-op 2 / 3 / 4, one server-run combat match, two with LP and layers raised at the
//            first prep so they reach the Hidden Core), one co-op match whose human seat (AI 托管, offline: its
//            battles run on the server) does not own a few NORMAL chess — they fight as their 补位 stand-ins (0.2.0) — and
//            one whose human seat slots 自选 picks (推进之王 and prototypes; its 调度中心 at level 5 from the first prep):
//            its shop sells them and its AI fields them (0.2.0 自选编队, the digest's `diy`)
//   standins 10 battles: every NORMAL chess record (normal + elite, 110) fielded as its 补位 stand-in (PlayerBattleInput
//            standIn: true — DATA.md §18: the stand-in's body, its backup skill / module, its kit by charId; all 17
//            stand-ins and every skill a chess names for them), 12 per battle by strength band, laid out by the stand-in's
//            position on a real stage, against the round's real wave three times over, an item each, bonds from the board
//   diy      自选 pieces (PlayerBattleInput `diy`, shared/diy.js): every owned 6★ with an operator kit (kits/index.js
//            OPERATOR_KITS) in each form of tiers 5 and 6 — normal, elite with no module and with each module — under
//            each of its skills, then every prototype pick with a kit at its locked selection, both forms of each tier;
//            12 pieces per battle on a real stage against the round's real wave three times over (diyScenarios)
// Battles run through the production BattleSpec path (server/sim/spec.js buildBattleSpec → createBattleFromSpec, the
// path browsers and the server's headless fields use) with every option explicit; matches construct Match directly
// with a VirtualScheduler (as tools/botbench.mjs) — test-harness defaults never move a digest.
//
// Digest (battle): end time, ticks, reason, kills / total / leaks, per player (kills, leaks, coins, damage, boss
// damage, healing, deaths, layer gains), per ally unit (player, board uid or `~n` for units created in battle, def id,
// loadout, final HP, alive, deployments, kills, damage dealt / taken, healing, attacks, skill casts), per enemy kind
// (spawned, killed, leaked, damage dealt / taken), hook counts, client event counts (+ fx kinds), content errors, the
// number of draws of the battle's RNG, and a chained hash of a wire snapshot every game second (one 8-hex value per 10
// game seconds: the first differing value says when two runs parted). Digest (match): setup (stage, factions, leaders),
// per round at SETTLE per player [alive, lp, funds when the prep opened, funds, pending funds, shop level, deployed,
// board hash, activated layers, bonds, kills, total, counted leaks, gold spent], the m.result summary (final lineups,
// bonds, stats, titles), the draws of every match RNG stream, errors.
// Insensitive to what does not affect gameplay: object key order (every map is written with sorted keys), engine unit
// ids (snapshot ids are renumbered by first appearance; units are named by board uid / def id), board piece uids, the
// order of client events within a tick (counted, not hashed) and wall-clock time (matches run in virtual time).
// Damage / healing sums are rounded to integers and HP to 2 decimals (float dust from a reassociated sum is not a
// gameplay change; anything that changes a fight changes the snapshot hashes too).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { getData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { createRng, deriveSeed } from '../server/sim/rng.js';
import { GameData } from '../server/match/gamedata.js';
import { setupMatchWaves, buildNormalWave, buildBossWave, buildUniteWave, isFlyKey, routeByMotion } from '../server/match/waves.js';
import { buildDeployMap, positionClass, canPlace, ownerRangeKeys, tileKey } from '../server/match/board.js';
import { computeBonds, bondSnapshot } from '../server/match/bondsMeta.js';
import { Match } from '../server/match/Match.js';
import { VirtualScheduler } from '../server/match/scheduler.js';
import { resolveRecordLoadout, loadoutRecord, attackRangeGrid } from '../shared/loadoutRecord.js';
import { diyRecordOf, DIY_TIERS } from '../shared/diy.js';
import { unitForm } from '../shared/standIn.js';
import { OPERATOR_KITS, KITTED_CHARS } from '../server/sim/content/kits/index.js';
import { GEO } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GOLDEN_DIR = join(ROOT, 'test', 'golden');
export const FAMILY_NAMES = Object.freeze(['roster', 'bonds', 'fields', 'matches', 'standins', 'diy']);

const QUIET = Object.freeze({ warn() {}, error() {}, info() {}, log() {}, debug() {} });
const data = getData({ log: QUIET });
const ds = new DataSource(data, null); // what Match and browsers use (no research fallback)
const gdCache = new Map();
const gdFor = (modeId) => { let g = gdCache.get(modeId); if (!g) { g = new GameData(data, modeId); gdCache.set(modeId, g); } return g; };
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------------
// hashing / numbers

const FNV = 0x811c9dc5;
function fnv(str, h = FNV) {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const hex8 = (h) => (h >>> 0).toString(16).padStart(8, '0');
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v === Infinity ? 'inf' : null);
const int = (v) => (Number.isFinite(v) ? Math.round(v) : null);
const sorted = (obj) => { const o = {}; for (const k of Object.keys(obj).sort(byId)) o[k] = obj[k]; return o; };

// mulberry32 (server/sim/rng.js) adds 0x6d2b79f5 to its state per draw: draws = (state − initial) × inverse mod 2³²
const RNG_STEP = 0x6d2b79f5;
const RNG_INV = (() => { let x = RNG_STEP; for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(RNG_STEP, x)); return x >>> 0; })();
/** Number of values drawn from a createRng(seed) stream whose state is now `state`. */
export function rngDraws(seed, state) {
  const s0 = (Number(seed) >>> 0) || 0x9e3779b9;
  return Math.imul(((state >>> 0) - s0) >>> 0, RNG_INV) >>> 0;
}

// ---------------------------------------------------------------------------------------------------------------
// battle runner

/** The DESIGN hook events (counted per battle). Frozen here: a new engine hook never changes a digest by itself. */
export const HOOKS = Object.freeze([
  'battleStart', 'deploy', 'tick', 'beforeAttack', 'attack', 'hit', 'damaged', 'heal', 'kill', 'death',
  'skillStart', 'skillEnd', 'ammoUsed', 'spGain', 'statusApplied', 'blocked', 'enemySpawn', 'enemyLeak', 'battleEnd',
  'fatal', 'layerGain', 'elementBurst', 'dodge',
]);
const SNAP_EVERY = 30; // ticks (1 game second)
const HASH_WINDOW = 300; // ticks (10 game seconds) per published hash
const DRAIN_EVERY = 3; // ticks (the match's watcher cadence)

/**
 * Run one battle scenario to its end and digest it.
 * @param {object} sc { id, kind, modeId, round, stageId, seed, players, spawns, routes, timeLimit, flags, enemyOverrides,
 *   waveId, bossId, boss, rect, fieldId, cap (game seconds; boss / hidden fields end by the pool or here) }
 * @param {{ snapEvery?: number, drainEvery?: number, countHooks?: boolean, recordEvents?: boolean }} [probe] observation
 *   knobs for determinism probes (how often the battle is watched, hook listeners, the server's recordEvents: false);
 *   none of them may change the battle — only the digest fields that observe them (snaps, events, fx, hooks)
 */
export function runBattle(sc, probe = {}) {
  const snapEvery = probe.snapEvery ?? SNAP_EVERY;
  const drainEvery = probe.drainEvery ?? DRAIN_EVERY;
  const spec = buildBattleSpec({
    battleId: sc.id, fieldId: sc.fieldId ?? 'g', kind: sc.kind, seed: sc.seed, modeId: sc.modeId, round: sc.round,
    stageId: sc.stageId, rect: sc.rect, timeLimit: sc.timeLimit, players: sc.players, spawns: sc.spawns, routes: sc.routes,
    flags: sc.flags, enemyOverrides: sc.enemyOverrides ?? {}, waveId: sc.waveId ?? null, bossId: sc.bossId ?? null,
    boss: sc.boss ?? null, content: 'full',
  });
  const b = createBattleFromSpec(spec, ds, { quiet: true, logger: QUIET, recordEvents: probe.recordEvents !== false });
  const hooks = {};
  for (const name of HOOKS) { hooks[name] = 0; if (probe.countHooks !== false) b.on(name, () => { hooks[name]++; }, { priority: -1000 }); }
  const ev = {};
  const fx = {};
  const drain = () => {
    for (const e of b.drainEvents()) {
      ev[e[0]] = (ev[e[0]] || 0) + 1;
      if (e[0] === 'fx') fx[e[1]] = (fx[e[1]] || 0) + 1;
    }
  };
  const ids = new Map(); // engine id → order of first appearance in the snapshots
  const cid = (id) => { let v = ids.get(id); if (v == null) { v = ids.size; ids.set(id, v); } return v; };
  const snaps = [];
  let chain = FNV;
  let win = FNV;
  const cap = Number.isFinite(sc.cap) ? sc.cap : 1e9;
  let ticks = 0;
  while (!b.finished) {
    if (b.time >= cap - 1e-9) { b.forceEnd('forced'); break; }
    b.step();
    ticks++;
    if (drainEvery > 0 && ticks % drainEvery === 0) drain();
    if (snapEvery > 0 && ticks % snapEvery === 0) {
      const s = b.snapshot();
      const canon = {
        t: s.t, dp: s.dp, dps: s.dps ?? null, killed: s.killed, total: s.total, boss: s.boss ?? null,
        units: s.units.map((u) => [cid(u[0]), ...u.slice(1)]),
        down: (s.down || []).map((d) => [cid(d[0]), ...d.slice(1)]),
        elem: (s.elem || []).map((d) => [cid(d[0]), ...d.slice(1)]),
      };
      win = fnv(JSON.stringify(canon), win);
    }
    if (ticks % HASH_WINDOW === 0) { chain = fnv(hex8(win), chain); snaps.push(hex8(chain)); win = FNV; }
  }
  drain();
  if (win !== FNV) { chain = fnv(hex8(win), chain); snaps.push(hex8(chain)); }
  return digestBattle(sc, b, { hooks, ev, fx, snaps, ticks });
}

function digestBattle(sc, b, { hooks, ev, fx, snaps, ticks }) {
  const res = b.result();
  const players = {};
  for (const pid of Object.keys(res.perPlayer || {}).sort(byId)) {
    const pp = res.perPlayer[pid];
    const leaked = pp.leaked || [];
    players[pid] = {
      killed: pp.killed, total: pp.total, perfect: !!pp.perfect,
      leaks: leaked.filter((l) => l.counted !== false).length, leaksUncounted: leaked.filter((l) => l.counted === false).length,
      coins: pp.coins, dmg: int(pp.damageDealt), bossDmg: int(pp.bossDamage), heal: int(pp.healingDone), deaths: pp.deaths,
      layerGains: sorted({ ...(pp.layerGains || {}) }),
    };
  }
  // ally units in creation order, named by board uid (pieces) or `~n` (the n-th unit of that def created in battle)
  const seen = new Map();
  const units = [];
  for (const u of b.allyUnits) {
    let ref;
    if (u.uid != null) ref = u.uid;
    else { const k = `${u.ownerId}|${u.defId}`; const n = (seen.get(k) || 0) + 1; seen.set(k, n); ref = `~${n}`; }
    const lo = u.def && u.def.loadout ? u.def.loadout : null;
    const s = u.stats || {};
    units.push([
      u.ownerId ?? '-', ref, u.kind, u.defId, lo && lo.skillIndex != null ? lo.skillIndex : null, lo && lo.moduleId != null ? lo.moduleId : null,
      r2(u.hp), u.alive ? 1 : 0, u.deploySeq, s.kills ?? 0, int(s.dmg ?? 0), int(s.taken ?? 0), int(s.heal ?? 0), s.attacks ?? 0,
      u.skill && !u.skill.noSkill ? u.skill.activations : null,
    ]);
  }
  const enemies = {};
  for (const u of b.units) {
    if (u.side !== 'enemy') continue;
    const e = enemies[u.defId] || (enemies[u.defId] = [0, 0, 0, 0, 0]);
    e[0]++;
    if (u.removeReason === 'killed') e[1]++;
    else if (u.removeReason === 'leak') e[2]++;
    e[3] += (u.stats && u.stats.dmg) || 0;
    e[4] += (u.stats && u.stats.taken) || 0;
  }
  for (const e of Object.values(enemies)) { e[3] = int(e[3]); e[4] = int(e[4]); }
  const errors = [...new Set((b.errors || []).map((e) => `${e.label}|${e.who}|${e.message}`.slice(0, 120)))].sort(byId);
  return {
    kind: sc.kind, stageId: sc.stageId, modeId: sc.modeId, round: sc.round, seed: sc.seed, waveId: sc.waveId ?? null,
    time: r2(res.time), ticks, reason: res.reason, killed: res.killed, total: res.total,
    unspawned: (res.unspawned || []).length, bossHpLeft: res.bossHpLeft != null ? int(res.bossHpLeft) : null,
    rngDraws: rngDraws(b.seed, b.rng.state()),
    errors: { count: b.errorCount ?? (b.errors || []).length, kinds: errors },
    players,
    units,
    enemies: sorted(enemies),
    hooks: HOOKS.map((name) => hooks[name]),
    events: sorted(ev),
    fx: sorted(fx),
    snaps: snaps.join(' '),
  };
}
const UNIT_COLS = Object.freeze(['player', 'ref', 'kind', 'def', 'skill', 'module', 'hp', 'alive', 'deploys', 'kills', 'dmg', 'taken', 'heal', 'attacks', 'casts']);
const ENEMY_COLS = Object.freeze(['spawned', 'killed', 'leaked', 'dmg', 'taken']);

// ---------------------------------------------------------------------------------------------------------------
// corpus helpers (pure functions of data/*.json)

const CHESS = Object.values(data.chess).sort((a, b) => byId(a.chessId, b.chessId));
const VISIBLE = CHESS.filter((c) => c.visible);
// the battle stages (the two 联防 records, stages.json kind 'unite', are that template level's record: the 联防 field
// itself is the round's stage, server/match/match/unitePhase.js)
const STAGES = Object.keys(data.stages).filter((id) => data.stages[id].kind !== 'unite').sort(byId);
const BANDS = Object.keys(data.bands).sort(byId);
const EQUIPS = Object.values(data.items).filter((i) => i.itemType === 'EQUIP').map((i) => i.id).sort(byId);
const BOSSES = Object.keys(data.bosses).sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
const LEADER_KEYS = new Set();
for (const bo of Object.values(data.bosses)) { LEADER_KEYS.add(bo.enemyKey); for (const p of bo.parts || []) LEADER_KEYS.add(typeof p === 'string' ? p : p.enemyKey ?? p.key); }
const ACLOON = 'enemy_9012_acloon'; // the 炎 bond's summon, never an enemy
const EXTRA_ENEMIES = Object.keys(data.enemies).filter((k) => !LEADER_KEYS.has(k) && k !== ACLOON).sort(byId);
/** 机变 cards with a battle part (content/choices.js battlePlanOf: 战术决策 operator / enemy / heal effects). */
const BATTLE_CARD_KEYS = new Set(['global_special_choice_all_activated', 'env_gbuff_new_with_verify', 'env_gbuff_new', 'char_respawntime_mul', 'enemy_attribute_mul', 'enemy_attribute_add', 'global_special_choice_prep_finish_same_row_at_least', 'global_special_choice_prep_finish_bench_at_least', 'global_special_choice_prep_finish_bench_at_most']);
const BATTLE_CARDS = Object.values(data.effects)
  .filter((e) => e.effectType === 'BUFF_GAIN' && (e.buffs || []).some((b) => BATTLE_CARD_KEYS.has(b.key)) && !(e.buffs || []).some((b) => b.key === 'auto_chess_change_map'))
  .map((e) => e.effectId).sort(byId);
/** 模拟战场演变 map cards (auto_chess_change_map): { id, overrides: { alias: bool } }, used on the stages that have every alias. */
const MAP_CARDS = Object.values(data.effects)
  .filter((e) => e.effectType === 'BUFF_GAIN' && (e.buffs || []).some((b) => b.key === 'auto_chess_change_map'))
  .map((e) => ({ id: e.effectId, overrides: Object.fromEntries(Object.entries(e.buffs.find((b) => b.key === 'auto_chess_change_map').bb || {}).map(([k, v]) => [k, !!v])) }))
  .sort((a, b) => byId(a.id, b.id));
const mapCardsFor = (stageId) => {
  const st = data.stages[stageId];
  const aliases = new Set((st && st.devices ? st.devices : []).map((d) => d.alias).filter(Boolean));
  return MAP_CARDS.filter((c) => Object.keys(c.overrides).length && Object.keys(c.overrides).every((a) => aliases.has(a)));
};

/** Loadout variants of a chess record: default first; every skill and every module (+ 'none') at least once. */
function variantsOf(rec) {
  const skills = Array.isArray(rec.skills) && rec.skills.length ? rec.skills.map((s) => s.index) : [null];
  const defSkill = rec.skill && Number.isInteger(rec.skill.index) ? rec.skill.index : skills[0];
  const S = [defSkill, ...skills.filter((i) => i !== defSkill)];
  let M = [null];
  if (Array.isArray(rec.modules) && rec.modules.length) {
    const def = rec.modules.find((m) => m.isDefault)?.uniEquipId ?? 'none';
    M = [def, ...rec.modules.map((m) => m.uniEquipId).filter((id) => id !== def)];
    if (!M.includes('none')) M.push('none');
  }
  const n = Math.max(S.length, M.length);
  const out = [];
  for (let v = 0; v < n; v++) out.push({ chessId: rec.chessId, skillIndex: S[v % S.length], moduleId: M[v % M.length], v });
  return out;
}

/** Cursor over a list (deterministic round robin). */
function cursor(list) {
  let i = 0;
  return { next() { const x = list[i % list.length]; i++; return x; } };
}

const placeName = (unitList) => unitList.map((u) => u.chessId ?? u.tokenId);

/** Board tiles of a deploy field's enemy ground paths (stages.json groundPaths) → number of paths through each tile. */
function pathTraffic(stageId, field, colOffset = 0) {
  const st = data.stages[stageId];
  const out = new Map();
  for (const [key, tiles] of Object.entries((st && st.groundPaths) || {})) {
    const [tr, tc] = key.split('->')[1].split(',').map(Number);
    let toBoard = null;
    if (field === 'normal' && tr >= 9) toBoard = ([r, c]) => [r, c - colOffset];
    else if (field === 'bossL' && tr < 7 && tc <= 10) toBoard = ([r, c]) => [r + 7, c];
    else if (field === 'bossR' && tr < 7 && tc > 10) toBoard = ([r, c]) => [r + 7, 20 - c];
    if (!toBoard) continue;
    for (const t of tiles) {
      const [r, c] = toBoard(t);
      if (r >= 9 && r <= 12 && c >= 2 && c <= 10) out.set(tileKey(r, c), (out.get(tileKey(r, c)) || 0) + 1);
    }
  }
  return out;
}

/**
 * Lay out operators on a player's board (board coordinates rows 9–12, cols 2–10) for deploy field `field` of the
 * stage: melee operators (most blockers first) on the deployable tiles the enemy ground paths cross most, ranged ones
 * next to the paths; operators that do not fit are returned in `rest`. Every 7th operator faces UP / LEFT / DOWN.
 * Placeable summons (gamedata.placeableTokens: 赫默's drone on S2, 斯卡蒂's 海嗣, the tacticians' packs inside the
 * owner's range, 凯瑟琳's shields) take free tiles after the operators.
 */
function layout(gd, stageId, wanted, { field = 'normal', colOffset = 0, max = 12, dirs = true, uid0 = 1 } = {}) {
  const map = buildDeployMap(data.stages[stageId], { field });
  const traffic = pathTraffic(stageId, field, colOffset);
  const pathList = [...traffic.keys()].map((k) => k.split(',').map(Number));
  const dist = (r, c) => (pathList.length ? Math.min(...pathList.map(([pr, pc]) => Math.max(Math.abs(pr - r), Math.abs(pc - c)))) : 9);
  const used = new Set();
  const units = [];
  const rest = [];
  const tiles = (cls) => {
    const out = [];
    for (let r = 12; r >= 9; r--) for (let c = 2; c <= 10; c++) if (!used.has(tileKey(r, c)) && canPlace(map, cls, r, c)) out.push([r, c]);
    if (cls === 'melee') return out.sort((a, b) => (traffic.get(tileKey(b[0], b[1])) || 0) - (traffic.get(tileKey(a[0], a[1])) || 0));
    const rank = (r, c) => { const d = dist(r, c); return d === 0 ? 1.5 : d; }; // beside a path first, then on it
    return out.sort((a, b) => rank(a[0], a[1]) - rank(b[0], b[1]));
  };
  // a 补位 unit (`standIn`) is laid out by its stand-in's body (position, block count); every other by its chess record
  const recOf = (w) => (w.standIn ? gd.standIn(w.chessId) || data.chess[w.chessId] : data.chess[w.chessId]);
  const isMelee = (w) => positionClass(recOf(w)) === 'melee';
  const order = wanted.slice().sort((a, b) => (isMelee(b) - isMelee(a)) || (isMelee(a) ? (recOf(b).stats.blockCnt || 0) - (recOf(a).stats.blockCnt || 0) : 0));
  let uid = uid0;
  for (const w of order) {
    const rec = recOf(w);
    const free = units.length < max ? tiles(positionClass(rec)) : [];
    if (!free.length) { rest.push(w); continue; }
    const [r, c] = free[0];
    used.add(tileKey(r, c));
    const dir = dirs && units.length % 7 === 6 ? ['UP', 'LEFT', 'DOWN'][Math.floor(units.length / 7) % 3] : 'RIGHT';
    const u = { uid: uid++, kind: 'chess', chessId: w.chessId, row: r, col: c, dir, items: w.items ?? [] };
    if (w.skillIndex != null) u.skillIndex = w.skillIndex;
    if (w.moduleId != null) u.moduleId = w.moduleId;
    if (w.standIn) u.standIn = true;
    if (w.carryState) u.carryState = w.carryState;
    units.push(u);
  }
  // placeable summons of the placed operators (a stand-in makes none: none of the 17 has one)
  const tokens = [];
  for (const u of units) {
    if (u.standIn) continue;
    for (const { tokenId, count } of gd.placeableTokens(u.chessId, { skillIndex: u.skillIndex ?? null })) {
      const trec = data.tokens[tokenId];
      let allowed = null;
      if (trec && trec.ownerRange) {
        const rec = data.chess[u.chessId];
        const lo = resolveRecordLoadout(rec, { skillIndex: u.skillIndex, moduleId: u.moduleId });
        allowed = ownerRangeKeys(attackRangeGrid(loadoutRecord(rec, lo)), u.row, u.col, u.dir);
      }
      for (let k = 0; k < Math.min(count, 2); k++) {
        const free = tiles(positionClass(trec)).filter(([r, c]) => !allowed || allowed.has(tileKey(r, c)));
        if (!free.length) break;
        const [r, c] = free[0];
        used.add(tileKey(r, c));
        tokens.push({ uid: uid++, kind: 'token', tokenId, ownerUid: u.uid, row: r, col: c, dir: u.dir });
      }
    }
  }
  return { units: units.concat(tokens), rest, nextUid: uid };
}

/** Bond snapshot of a board (bondsMeta.computeBonds over a stand-in PlayerState) with `layers` on every bond. */
function bondsOf(gd, units, layers) {
  const board = new Map();
  for (const u of units) if (u.kind === 'chess') board.set(tileKey(u.row, u.col), { kind: 'chess', id: u.chessId, items: (u.items || []).map((id) => ({ id })) });
  const L = {};
  for (const id of gd.bondIds) L[id] = typeof layers === 'function' ? layers(id) : layers;
  return bondSnapshot(computeBonds(gd, { board, hand: [], layers: L, bondCountBonus: {} }));
}

/** A real round wave of `modeId` (faction picks from a seeded match setup) for the normal field. */
function normalWave(gd, round, seed) {
  const setup = setupMatchWaves(gd, createRng(deriveSeed(seed, 'setup')));
  return buildNormalWave(gd, createRng(deriveSeed(seed, 'waves')), setup, round);
}

const playerInput = (pid, seat, units, { side = 'L', colOffset = 0, bonds = {}, bandId = null, effects = [], deviceOverrides = {}, extra = {} } = {}) => ({
  playerId: pid, seat, side, colOffset, units, bonds, bandId, playerEffects: effects, deviceOverrides, ...extra,
});
const cardRef = (effectId, n = 1) => ({ id: `choice:${effectId}#${n}`, key: `choice:${effectId}`, source: 'choice', params: { prepOk: true }, data: { effectId }, counter: null });

/** Extra spawns: enemy kinds outside the round template, every other one as a kill bounty (waves.js bountySpawns). */
function extraSpawns(gd, routes, keys, round, pid, t0 = 8, step = 5) {
  const scale = gd.enemyScale(round);
  return keys.map((key, i) => {
    const fly = isFlyKey(gd, key);
    let routeIndex = routeByMotion(routes, fly);
    if (!(routeIndex >= 0)) routeIndex = 0;
    const s = { time: t0 + i * step, enemyKey: key, routeIndex, count: 1, interval: 0, mods: { hpMul: scale.hpMul, atkMul: scale.atkMul, speedMul: scale.speedMul, slot: fly ? 'NF' : 'N' }, ownerPlayerId: pid };
    if (i % 2 === 0) { s.tag = 'bounty'; s.bounty = { coins: 2, ownerPlayerId: pid }; s.mods.bountyCoins = 2; }
    return s;
  });
}

const ROSTER_MODES = Object.freeze(['mode_multi_normal', 'mode_multi_hard', 'mode_single_normal', 'mode_multi_abyss', 'mode_multi_funny', 'mode_single_hard']);
/** Round by strength: normal tier t ↔ elite tier t − 1 (band = tier + elite). */
const BAND_ROUND = Object.freeze({ 1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 13 });
const LAYER_STEPS = Object.freeze([0, 2, 10, 40, 120]);

// ---------------------------------------------------------------------------------------------------------------
// family: roster

export function rosterScenarios() {
  // every loadout variant of every visible record, by variant pass, then strength band (tier + elite), then id; a
  // battle takes up to 12 of them with distinct chess ids and bands within one of the first waiting instance's
  const queue = [];
  for (const rec of VISIBLE) for (const v of variantsOf(rec)) queue.push({ ...v, band: rec.tier + (rec.isGolden ? 1 : 0) });
  queue.sort((a, b) => a.v - b.v || a.band - b.band || byId(a.chessId, b.chessId));
  const items = cursor(EQUIPS);
  const bands = cursor(BANDS);
  const cards = cursor(BATTLE_CARDS);
  const scenarios = [];
  let n = 0;
  while (queue.length) {
    const i = n++;
    const stageId = STAGES[i % STAGES.length];
    const modeId = ROSTER_MODES[i % ROSTER_MODES.length];
    const gd = gdFor(modeId);
    const first = queue[0];
    const picked = [];
    const ids = new Set();
    for (const w of queue) {
      if (picked.length >= 12) break;
      if (ids.has(w.chessId) || Math.abs(w.band - first.band) > 1) continue;
      picked.push(w);
      ids.add(w.chessId);
    }
    const chunk = picked.map((w, j) => ({ ...w, items: j % 3 === 2 ? [items.next(), items.next()] : [items.next()] }));
    const { units } = layout(gd, stageId, chunk, { max: 12 });
    if (!units.length) throw new Error(`roster: nothing fits on ${stageId}`);
    const placed = new Set(units.filter((u) => u.kind === 'chess').map((u) => u.chessId));
    for (let q = queue.length - 1; q >= 0; q--) if (picked.includes(queue[q]) && placed.has(queue[q].chessId)) queue.splice(q, 1);
    const band = Math.max(...picked.filter((w) => placed.has(w.chessId)).map((w) => w.band));
    const round = BAND_ROUND[band];
    const seed = deriveSeed(20261005, `roster:${i}`);
    const wave = normalWave(gd, round, seed);
    const pid = 'p1';
    // every other battle on a stage with 模拟战场演变 map cards plays the next of them (deviceOverrides)
    const visit = Math.floor(i / STAGES.length);
    const maps = mapCardsFor(stageId);
    const deviceOverrides = maps.length && visit % 2 === 1 ? maps[((visit - 1) / 2) % maps.length].overrides : {};
    const effects = [cardRef(cards.next(), 1), cardRef(cards.next(), 2)];
    scenarios.push({
      id: `roster-${String(i + 1).padStart(3, '0')}`, family: 'roster', kind: 'normal', modeId, round, stageId, seed, pass: first.v,
      rect: { ...GEO.NORMAL_RECT }, timeLimit: wave.timeLimit, routes: wave.routes, waveId: wave.templateId, enemyOverrides: wave.overrides,
      flags: { layerGainsEnabled: true, ...gd.dp },
      players: [playerInput(pid, 0, units, { bonds: bondsOf(gd, units, LAYER_STEPS[i % LAYER_STEPS.length]), bandId: bands.next(), effects, deviceOverrides })],
      // the round's wave three times (a quarter of the time limit apart): the operators fight long enough to cast their
      // skills (one copy is cleared in ~40–80 s by 12 operators)
      spawns: [0, 1, 2].flatMap((k) => wave.spawns.map((s) => ({ ...s, time: s.time + k * Math.round(wave.timeLimit / 4), ownerPlayerId: pid }))),
      about: `pass ${first.v} band ${band}: ${placeName(units).join(' ')}`,
    });
  }
  // every non-leader enemy kind joins one pass-0 roster battle (default loadouts) as an extra spawn — and, a second
  // time, one of the other battles (the operators of the later passes need the enemies as much)
  const pass0 = scenarios.filter((sc) => sc.pass === 0);
  const later = scenarios.filter((sc) => sc.pass > 0);
  EXTRA_ENEMIES.forEach((key, j) => {
    for (const sc of [pass0[j % pass0.length], later[(j * 7) % later.length]]) if (sc) (sc._extra || (sc._extra = [])).push(key);
  });
  for (const sc of scenarios) {
    if (!sc._extra) continue;
    sc.spawns = sc.spawns.concat(extraSpawns(gdFor(sc.modeId), sc.routes, sc._extra, sc.round, 'p1'));
    delete sc._extra;
  }
  return scenarios;
}

// ---------------------------------------------------------------------------------------------------------------
// family: bonds

const BOND_MODES = Object.freeze(['mode_multi_normal', 'mode_multi_hard', 'mode_single_normal', 'mode_single_hard']);

export function bondScenarios() {
  const scenarios = [];
  const bondIds = Object.keys(data.bonds).sort(byId);
  const items = cursor(EQUIPS.filter((id) => /_b$/.test(id)));
  const fillLow = cursor(VISIBLE.filter((c) => !c.isGolden && c.tier >= 3 && c.tier <= 4).map((c) => c.chessId));
  const fillHigh = cursor(VISIBLE.filter((c) => c.isGolden && c.tier >= 4 && c.tier <= 5).map((c) => c.chessId));
  let n = 0;
  for (const bondId of bondIds) {
    const bond = data.bonds[bondId];
    const th = Array.isArray(bond.thresholds) && bond.thresholds.length ? bond.thresholds : [bond.activeCount || 1];
    const golden = bond.countMode === 'BOARD_ALL_CHESS' || bond.thresholdTemplate === 'count_threshold_upward_golden';
    const downward = bond.thresholdTemplate === 'count_threshold_downward';
    // members by base id (visible records first); 绝技 counts every elite on the board
    const bases = [];
    const pool = golden ? VISIBLE.filter((c) => c.isGolden) : CHESS.filter((c) => (c.bonds || []).includes(bondId));
    for (const c of pool.sort((a, b) => (b.visible - a.visible) || byId(a.chessId, b.chessId))) if (!bases.includes(c.baseId)) bases.push(c.baseId);
    for (const level of ['low', 'high']) {
      const i = n++;
      const modeId = BOND_MODES.find((m, k) => k >= i % BOND_MODES.length && !gdFor(m).modeInactiveBonds.has(bondId)) ?? BOND_MODES.find((m) => !gdFor(m).modeInactiveBonds.has(bondId));
      const gd = gdFor(modeId);
      const stageId = STAGES[(i * 3) % STAGES.length];
      const round = level === 'low' ? 5 : 10;
      const seed = deriveSeed(20261005, `bond:${bondId}:${level}`);
      const want = level === 'low' || downward ? th[0] : Math.min(th[th.length - 1], 10);
      const picks = [];
      for (const base of bases.slice(0, want)) {
        const ids = CHESS.filter((c) => c.baseId === base).map((c) => c.chessId).sort(byId);
        picks.push((level === 'high' || golden) && ids.length > 1 ? ids[ids.length - 1] : ids[0]);
      }
      // 助力: the upper tier counts operators that differ in name OR elite state — add the other copy of two members
      if (bondId === 'deputShip' && level === 'high') {
        for (const base of bases.slice(0, 2)) for (const c of CHESS.filter((x) => x.baseId === base)) if (!picks.includes(c.chessId)) picks.push(c.chessId);
      }
      // 调和: two 炎 members next to it, so its +1 lifts a core bond to its threshold
      if (bondId === 'maniShip') picks.push(...VISIBLE.filter((c) => !c.isGolden && (c.bonds || []).includes('yanShip')).slice(0, 2).map((c) => c.chessId));
      // fill the board to 8 operators with non-members (normal records only when elites are what the bond counts)
      const fill = level === 'low' || golden ? fillLow : fillHigh;
      for (let guard = 0; picks.length < 8 && guard < 200; guard++) {
        const id = fill.next();
        const rec = data.chess[id];
        if (picks.some((p) => data.chess[p].baseId === rec.baseId) || (rec.bonds || []).includes(bondId) || (golden && rec.isGolden)) continue;
        picks.push(id);
      }
      const wanted = picks.map((id, j) => ({ chessId: id, items: level === 'high' && j < 4 ? [items.next()] : [] }));
      const { units } = layout(gd, stageId, wanted, { max: 12, dirs: false });
      const wave = normalWave(gd, round, seed);
      const bonds = bondsOf(gd, units, (id) => (id === bondId ? (level === 'low' ? 1 : 999) : 0));
      const pid = 'p1';
      scenarios.push({
        id: `bond-${bondId}-${level}`, family: 'bonds', kind: 'normal', modeId, round, stageId, seed,
        rect: { ...GEO.NORMAL_RECT }, timeLimit: wave.timeLimit, routes: wave.routes, waveId: wave.templateId, enemyOverrides: wave.overrides,
        flags: { layerGainsEnabled: true, ...gd.dp },
        players: [playerInput(pid, 0, units, { bonds, bandId: null })],
        spawns: wave.spawns.map((s) => ({ ...s, ownerPlayerId: pid })),
        about: `${bond.name} ${level}: tier ${bonds[bondId] ? bonds[bondId].tier : 0} layers ${bonds[bondId] ? bonds[bondId].layers : 0}; ${placeName(units).join(' ')}`,
      });
    }
  }
  return scenarios;
}

// ---------------------------------------------------------------------------------------------------------------
// family: fields (Final Assault / Hidden Core leaders, 联防)

const ELITES = VISIBLE.filter((c) => c.isGolden && c.tier >= 4).sort((a, b) => b.tier - a.tier || byId(a.chessId, b.chessId));

export function fieldScenarios() {
  const scenarios = [];
  const teams = cursor(ELITES.map((c) => c.chessId));
  const items = cursor(EQUIPS.filter((id) => /_b$/.test(id)));
  const bands = cursor(BANDS.slice().reverse());
  const team = (gd, stageId, field, uid0, n = 10, colOffset = 0) => {
    const wanted = [];
    for (let k = 0; k < n; k++) wanted.push({ chessId: teams.next(), items: k < 6 ? [items.next(), items.next()] : [] });
    const seenIds = new Set();
    const uniq = wanted.filter((w) => (seenIds.has(w.chessId) ? false : (seenIds.add(w.chessId), true)));
    return layout(gd, stageId, uniq, { field, colOffset, max: n, uid0 });
  };
  let n = 0;
  for (const bossId of BOSSES) {
    const hidden = !!data.bosses[bossId].hidden;
    for (const solo of [false, true]) {
      const i = n++;
      const modeId = solo ? (i % 4 < 2 ? 'mode_single_hard' : 'mode_single_abyss') : (i % 4 < 2 ? 'mode_multi_hard' : 'mode_multi_abyss');
      const gd = gdFor(modeId);
      const round = hidden ? gd.hiddenRound : gd.bossRound;
      const stageId = STAGES[(i * 5) % STAGES.length];
      const seed = deriveSeed(20261005, `boss:${bossId}:${solo ? 's' : 'p'}`);
      const setup = setupMatchWaves(gd, createRng(deriveSeed(seed, 'setup')));
      const wave = buildBossWave(gd, createRng(deriveSeed(seed, 'waves')), setup, round, { bossId, solo });
      const pids = solo ? ['p1'] : ['p1', 'p2'];
      let uid = 1;
      const players = pids.map((pid, j) => {
        const t = team(gd, stageId, j === 0 ? 'bossL' : 'bossR', uid);
        uid = t.nextUid;
        const input = playerInput(pid, j, t.units, { side: j === 0 ? 'L' : 'R', colOffset: j === 0 ? 0 : 8, bonds: bondsOf(gd, t.units, 20 * (j + 1)), bandId: bands.next() });
        input.lpForBoss = 60;
        return input;
      });
      const pool = gd.bossPoolHp(bossId, pids.length);
      scenarios.push({
        id: `${hidden ? 'hidden' : 'boss'}-${bossId}-${solo ? 'solo' : 'pair'}`, family: 'fields', kind: hidden ? 'hidden' : 'boss', modeId, round, stageId, seed,
        rect: { ...GEO.BOSS_RECT }, timeLimit: Infinity, routes: wave.routes, waveId: wave.templateId, enemyOverrides: wave.overrides,
        flags: { layerGainsEnabled: false, ...gd.dp }, bossId, boss: { poolHp: pool, poolMax: pool }, fieldId: 'b1', cap: 200,
        players, spawns: wave.spawns.map((s) => ({ ...s })),
        about: `${data.bosses[bossId].name} ${solo ? 'solo' : 'pair'} pool ${pool}: ${players.map((p) => placeName(p.units).join(' ')).join(' | ')}`,
      });
    }
  }
  // 联防: 1 and 2 helpers; the leakers' enemies (walkers, flyers, a summoned-only kind, a bounty) re-enter
  for (const helpers of [1, 2]) {
    const i = n++;
    const modeId = helpers === 1 ? 'mode_multi_normal' : 'mode_multi_hard';
    const gd = gdFor(modeId);
    const round = helpers === 1 ? 7 : 11;
    // the helpers' boards are laid out on the round's stage, and the 联防 battle runs on that same stage
    const boardStageId = STAGES[(i * 5) % STAGES.length];
    const stageId = boardStageId;
    const seed = deriveSeed(20261005, `unite:${helpers}`);
    const src = normalWave(gd, round, seed);
    const leakers = helpers === 1 ? ['p2', 'p3'] : ['p3', 'p4'];
    const keys = [...new Set(src.spawns.map((s) => s.enemyKey))];
    const tokenOnly = Object.keys(data.enemies).filter((k) => data.enemies[k].tokenOnly).sort(byId);
    const leaked = [];
    keys.forEach((k, j) => { leaked.push({ enemyKey: k, mods: { ...(src.spawns.find((s) => s.enemyKey === k).mods || {}) }, sourcePlayerId: leakers[j % 2] }); });
    for (let j = 0; j < 6; j++) leaked.push({ enemyKey: keys[j % keys.length], mods: { ...(src.spawns[0].mods || {}) }, sourcePlayerId: leakers[j % 2] });
    leaked.push({ enemyKey: tokenOnly[helpers - 1], mods: null, sourcePlayerId: leakers[0], isToken: true });
    leaked.push({ enemyKey: keys[0], mods: { ...(src.spawns[0].mods || {}), bountyCoins: 3 }, sourcePlayerId: leakers[1], bounty: { coins: 3, ownerPlayerId: leakers[1] }, tag: 'bounty' });
    const wave = buildUniteWave(gd, leaked, helpers, src.timeLimit);
    let uid = 1;
    const players = [];
    for (let h = 0; h < helpers; h++) {
      const t = team(gd, boardStageId, 'normal', uid, 8, helpers > 1 && h === 0 ? 8 : 0);
      uid = t.nextUid;
      // carried end state of the helper's own battle: HP ratio + SP, one knocked out, summons with SP only
      t.units.forEach((u, k) => {
        if (u.kind === 'token') { u.carryState = { sp: 3 }; return; }
        u.carryState = k === 2 ? { down: true } : { hpPct: [1, 0.55, 1, 0.3, 0.8][k % 5], sp: (k * 7) % 20 };
      });
      players.push(playerInput(`p${h + 1}`, h, t.units, { colOffset: helpers > 1 && h === 0 ? 8 : 0, bonds: bondsOf(gd, t.units, 5 + 30 * h), bandId: bands.next() }));
    }
    scenarios.push({
      id: `unite-${helpers}`, family: 'fields', kind: 'unite', modeId, round, stageId, seed,
      rect: { ...GEO.UNITE_RECT }, timeLimit: src.timeLimit, routes: wave.routes, waveId: wave.templateId, enemyOverrides: src.overrides,
      flags: { layerGainsEnabled: false, ...gd.dp }, fieldId: 'u', players, spawns: wave.spawns,
      about: `联防 ${helpers} helper(s), ${leaked.length} leaked: ${players.map((p) => placeName(p.units).join(' ')).join(' | ')}`,
    });
  }
  return scenarios;
}

// ---------------------------------------------------------------------------------------------------------------
// family: standins (0.2.0 补位)

/** The NORMAL chess records (normal + elite) that have a stand-in (shared/standIn.js: PRESET / 自选 have none). */
const STANDIN_CHESS = CHESS.filter((c) => c.chessType === 'NORMAL' && !c.isDiy && c.backup && c.backup.charId && c.backup.charId !== c.charId);

export function standInScenarios() {
  // normal records first, then the elites; within them by strength band (tier + elite) and id; a battle takes up to 12
  // with distinct chess ids and bands within one of the first waiting record's
  const queue = STANDIN_CHESS.map((rec) => ({ chessId: rec.chessId, standIn: true, elite: rec.isGolden ? 1 : 0, band: rec.tier + (rec.isGolden ? 1 : 0) }));
  queue.sort((a, b) => a.elite - b.elite || a.band - b.band || byId(a.chessId, b.chessId));
  // every battle also gets 8 ground enemy kinds as extra spawns: a 飞行 round wave would leave the melee stand-ins
  // nobody to block, and their skills (cast with an enemy in range) uncast
  const ground = cursor(EXTRA_ENEMIES.filter((k) => !data.enemies[k].tokenOnly && !isFlyKey(gdFor('mode_multi_normal'), k)));
  const items = cursor(EQUIPS);
  const bands = cursor(BANDS.slice().reverse());
  const scenarios = [];
  let n = 0;
  while (queue.length) {
    const i = n++;
    const stageId = STAGES[(i * 3 + 1) % STAGES.length];
    const modeId = ROSTER_MODES[(i + 2) % ROSTER_MODES.length];
    const gd = gdFor(modeId);
    const first = queue[0];
    const picked = [];
    for (const w of queue) {
      if (picked.length >= 12) break;
      if (picked.some((x) => x.chessId === w.chessId) || Math.abs(w.band - first.band) > 1 || w.elite !== first.elite) continue;
      picked.push(w);
    }
    const chunk = picked.map((w) => ({ ...w, items: [items.next()] }));
    const { units } = layout(gd, stageId, chunk, { max: 12 });
    if (!units.length) throw new Error(`standins: nothing fits on ${stageId}`);
    const placed = new Set(units.map((u) => u.chessId));
    for (let q = queue.length - 1; q >= 0; q--) if (picked.includes(queue[q]) && placed.has(queue[q].chessId)) queue.splice(q, 1);
    if (!placed.size) throw new Error('standins: no progress');
    const band = Math.max(...picked.filter((w) => placed.has(w.chessId)).map((w) => w.band));
    const round = BAND_ROUND[band];
    const seed = deriveSeed(20261005, `standins:${i}`);
    const wave = normalWave(gd, round, seed);
    const pid = 'p1';
    scenarios.push({
      id: `standin-${String(i + 1).padStart(2, '0')}`, family: 'standins', kind: 'normal', modeId, round, stageId, seed, pass: first.elite,
      rect: { ...GEO.NORMAL_RECT }, timeLimit: wave.timeLimit, routes: wave.routes, waveId: wave.templateId, enemyOverrides: wave.overrides,
      flags: { layerGainsEnabled: true, ...gd.dp },
      players: [playerInput(pid, 0, units, { bonds: bondsOf(gd, units, LAYER_STEPS[i % LAYER_STEPS.length]), bandId: bands.next() })],
      spawns: [0, 1, 2].flatMap((k) => wave.spawns.map((sp) => ({ ...sp, time: sp.time + k * Math.round(wave.timeLimit / 4), ownerPlayerId: pid })))
        .concat(extraSpawns(gd, wave.routes, Array.from({ length: 8 }, () => ground.next()), round, pid, 6, 6)),
      about: `${first.elite ? 'elite' : 'normal'} band ${band} as stand-ins: ${units.map((u) => `${u.chessId}→${gd.standIn(u.chessId)?.charId ?? '?'}`).join(' ')}`,
    });
  }
  return scenarios;
}

// ---------------------------------------------------------------------------------------------------------------
// family: matches

export function matchScenarios() {
  const out = [];
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) for (const seed of [1, 2]) out.push({ id: `solo-${difficulty}-${seed}`, mode: 'solo', difficulty, bots: 1, seed });
  out.push({ id: 'coop2-NORMAL-3', mode: 'coop', difficulty: 'NORMAL', bots: 2, seed: 3 });
  out.push({ id: 'coop2-HARD-4', mode: 'coop', difficulty: 'HARD', bots: 2, seed: 4 });
  out.push({ id: 'coop3-ABYSS-5', mode: 'coop', difficulty: 'ABYSS', bots: 3, seed: 5 });
  out.push({ id: 'coop4-FUNNY-6', mode: 'coop', difficulty: 'FUNNY', bots: 4, seed: 6 });
  out.push({ id: 'coop4-ABYSS-7', mode: 'coop', difficulty: 'ABYSS', bots: 4, seed: 7 });
  out.push({ id: 'coop2-NORMAL-8-serverrun', mode: 'coop', difficulty: 'NORMAL', bots: 2, seed: 8, clientCombat: false });
  // LP and every bond's layers raised at the first prep (as the boosted runs of test/match/fullmatch.test.js): the
  // match reaches the Final Assault and — Σ activated layers over the threshold — the Hidden Core
  out.push({ id: 'solo-HARD-9-boosted', mode: 'solo', difficulty: 'HARD', bots: 1, seed: 9, boost: { lp: 400, layers: 300 } });
  out.push({ id: 'coop2-ABYSS-10-boosted', mode: 'coop', difficulty: 'ABYSS', bots: 2, seed: 10, boost: { lp: 400, layers: 300 } });
  // 0.2.0 补位: a human seat (AI 托管, offline: its battles run on the server) that does not own a few NORMAL chess
  out.push({ id: 'coop2-NORMAL-14-standins', mode: 'coop', difficulty: 'NORMAL', bots: 1, seed: 14, human: { notOwned: MATCH_NOT_OWNED } });
  // 0.2.0 自选编队: a human seat (AI 托管, offline) that slots 推进之王 and prototypes into the four DIY slots
  // (its 调度中心 starts at level 5, like the boosted runs' raised LP: the 自选 pieces are sold from level 5 / 6, which the
  // AI otherwise reaches only with a full board, where a single new operator rarely improves its lineup)
  out.push({ id: `coop2-NORMAL-${MATCH_DIY_SEED}-diy`, mode: 'coop', difficulty: 'NORMAL', bots: 1, seed: MATCH_DIY_SEED, human: { diy: MATCH_DIY, shopLevel: 5 } });
  const humanAbout = (h) => (h.notOwned ? ` + 1 human seat (AI 托管) without ${h.notOwned.length} operators (补位 stand-ins)`
    : ` + 1 human seat (AI 托管) with ${Object.keys(h.diy || {}).length} 自选 picks${h.shopLevel ? ` and its 调度中心 at level ${h.shopLevel} from the first prep` : ''}`);
  return out.map((m) => ({ ...m, family: 'matches', kind: 'match', about: `${m.mode} ${m.difficulty}, ${m.bots} bot seat(s)${m.human ? humanAbout(m.human) : ''}, seed ${m.seed}${m.clientCombat === false ? ', server-run combat' : ''}${m.boost ? `, LP ${m.boost.lp} and ${m.boost.layers} layers per bond from the first prep` : ''}` }));
}

/**
 * The 自选 match's human seat (0.2.0 自选编队, shared/diy.js): 推进之王 (an owned 6★ with its operator kit; S3 and SOL-X) in a
 * tier-5 slot, Sharp (a prototype: its locked S3 + SOL-X) in the other tier-5 slot and a tier-6 one, 领主·Sharp in the last
 * — its shop sells them from 调度中心 level 5 / 6 and its AI fields them (the digest's `diy` lists the shop draws and the
 * fielded pieces per round).
 */
const MATCH_DIY = Object.freeze({
  chess_char_5_diy1_a: { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' },
  chess_char_5_diy2_a: { charId: 'char_609_acguad' },
  chess_char_6_diy1_a: { charId: 'char_609_acguad' },
  chess_char_6_diy2_a: { charId: 'char_617_sharp2' },
});
const MATCH_DIY_SEED = 70;

/**
 * The NORMAL chess the 补位 match's human seat does not own: operators its AI fields with seed 14 (the digest's `standIns`
 * lists them per round; test/golden-standins.test.js wants at least 3 different ones). 缄默德克萨斯 and 铃兰 joined in 0.2.0
 * when the 调度中心 upgrade's new card (DESIGN §25.19) changed the seat's shop: 忍冬 → Sharp from round 4, 缄默德克萨斯 →
 * Misery from round 7, 铃兰 → 预备干员-辅助 from round 9, 安洁莉娜 → Raidian in round 12.
 */
const MATCH_NOT_OWNED = Object.freeze([
  'chess_char_3_12_a', 'chess_char_3_18_a', 'chess_char_4_16_a', 'chess_char_5_10_a', 'chess_char_5_20_a', 'chess_char_6_05_a', 'chess_char_6_06_a',
  'chess_char_6_17_a', 'chess_char_6_19_a',
]);

const pieceStr = (p, r, c) => `${p.id.replace(/^chess_char_/, '')}@${r},${c}${p.dir && p.dir !== 'RIGHT' ? p.dir[0] : ''}${p.items && p.items.length ? `[${p.items.map((i) => i.id.replace(/^chess_item_/, '')).join('+')}]` : ''}`;
function boardStr(ps) {
  const out = [];
  for (const [k, p] of ps.board) { const [r, c] = k.split(',').map(Number); out.push(pieceStr(p, r, c)); }
  return out.sort(byId).join(' ');
}
const bondsStr = (bonds) => Object.entries(bonds || {}).filter(([, b]) => b && (b.active || b.layers > 0)).map(([id, b]) => `${id} ${b.tier}/${b.layers}`).sort(byId).join(', ');
const MATCH_ROW_COLS = Object.freeze(['alive', 'lp', 'prepFunds', 'funds', 'pending', 'level', 'deployed', 'board', 'layers', 'bonds', 'killed', 'total', 'leaks', 'gold']);

export function runMatch(cfg) {
  const sched = new VirtualScheduler();
  const seats = [];
  // a human seat (cfg.human): offline (its battles run on the server) and on AI 托管 from the start; its not-owned chess
  // fight as their 补位 stand-ins, its 自选 picks join its shop
  if (cfg.human) {
    seats.push({
      seat: 0, playerId: 'h_0', name: 'H-1', isBot: false, connected: false,
      ...(cfg.human.notOwned ? { notOwned: [...cfg.human.notOwned] } : null),
      ...(cfg.human.diy ? { diy: JSON.parse(JSON.stringify(cfg.human.diy)) } : null),
    });
  }
  for (let i = 0; i < cfg.bots; i++) seats.push({ seat: seats.length, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true });
  let summary = null;
  const logged = [];
  const log = { info() {}, debug() {}, warn() {}, error: (...a) => logged.push(a.map(String).join(' ').slice(0, 120)) };
  const m = new Match({
    roomCode: 'GOLD', mode: cfg.mode, difficulty: cfg.difficulty, seats, seed: cfg.seed, data, log, scheduler: sched,
    send: () => true, broadcast: () => {}, onEnd: (s) => { summary = s; },
    clientCombat: cfg.clientCombat !== false, verify: 'off',
  });
  if (cfg.human) m.players.get('h_0').autoplay = true;
  const rounds = [];
  // 补位: per round at SETTLE, the human's board pieces that fought as stand-ins (chess id → stand-in charId)
  const standIns = [];
  // 自选编队: per round, the human's shop draws of its 自选 pieces and, at SETTLE, its board pieces that fought as their
  // operators (slot id → charId) — an instance wrapper that only observes (as server/match/audit.js does)
  const diyRounds = [];
  const diyRolls = new Map();
  if (cfg.human?.diy) {
    const h = m.players.get('h_0');
    const roll = h._rollChessSlot.bind(h);
    h._rollChessSlot = () => {
      const slot = roll();
      if (slot && h.diyPickOf(slot.id)) diyRolls.set(m.round, [...(diyRolls.get(m.round) || []), slot.id.replace(/^chess_char_/, '')]);
      return slot;
    };
  }
  let last = '';
  m.start();
  const setup = { stageId: m.stageId, bossId: m.bossId, hiddenBossId: m.hiddenBossId, factions: [...(m.factions || [])] };
  let boosted = !cfg.boost;
  let levelled = !cfg.human?.shopLevel;
  const prepFunds = {};
  sched.runUntil(() => {
    const key = `${m.phase}:${m.round}`;
    if (key !== last) {
      last = key;
      if (!boosted && m.phase === 'PREP') {
        boosted = true;
        for (const ps of m.order) {
          ps.lp = cfg.boost.lp;
          for (const id of m.gd.bondIds) ps.layers[id] = cfg.boost.layers;
          ps.recompute();
        }
      }
      // the human's 调度中心 raised at the first prep (its shop rerolled there; the next level's price follows)
      if (!levelled && m.phase === 'PREP') {
        levelled = true;
        const h = m.players.get('h_0');
        h.shop.level = cfg.human.shopLevel;
        h.shop.upgradePrice = m.gd.upgradeBase(h.shop.level) ?? 0;
        h.rollShop({ keepFrozen: false });
      }
      // funds when the prep opens (income in, nothing bought yet: the bots play their prep in later callbacks)
      if (m.phase === 'PREP') for (const ps of m.order) prepFunds[ps.playerId] = ps.funds;
      if (m.phase === 'SETTLE') {
        const row = { round: m.round };
        for (const ps of m.order) {
          const r = m.lastResults.get(ps.playerId);
          row[ps.playerId] = [
            ps.alive ? 1 : 0, ps.lp, prepFunds[ps.playerId] ?? null, ps.funds, ps.pendingFunds, ps.shop.level, ps.deployCount, hex8(fnv(boardStr(ps))), ps.activatedLayers(),
            bondsStr(ps.bonds), r ? r.killed ?? null : null, r ? r.total ?? null : null,
            r ? (r.leaked || []).filter((l) => l && l.counted !== false).length : null, ps.stats.gold,
          ];
        }
        rounds.push(row);
        if (cfg.human?.notOwned) {
          const h = m.players.get('h_0');
          const fielded = [...h.board.values()].filter((p) => p.kind === 'chess' && h.fieldsStandIn(p.id)).map((p) => `${p.id.replace(/^chess_char_/, '')}→${m.gd.standIn(p.id)?.charId}`).sort(byId);
          standIns.push([m.round, fielded.join(' ')]);
        }
        if (cfg.human?.diy) {
          const h = m.players.get('h_0');
          const fielded = [...h.board.values()].filter((p) => p.kind === 'chess' && h.diyPickOf(p.id)).map((p) => `${p.id.replace(/^chess_char_/, '')}→${h.diyPickOf(p.id).charId}`).sort(byId);
          diyRounds.push([m.round, (diyRolls.get(m.round) || []).sort(byId).join(' '), fielded.join(' ')]);
        }
      }
    }
    return summary != null;
  }, { maxSteps: 5e6 });
  const rng = {};
  for (const [name, key] of [['setup', 'rngSetup'], ['shop', 'rngShop'], ['waves', 'rngWaves'], ['draft', 'rngDraft'], ['bots', 'rngBots'], ['meta', 'rngMeta']]) {
    rng[name] = m[key] && typeof m[key].state === 'function' ? rngDraws(deriveSeed(m.seed, name), m[key].state()) : null;
  }
  const s = summary || {};
  const players = {};
  for (const p of s.players || []) {
    players[p.playerId] = {
      alive: p.alive, victory: p.victory, roundsPassed: p.roundsPassed, eliminatedRound: p.eliminatedRound ?? null, lp: p.lp,
      bandId: p.bandId, title: p.title, trophies: p.trophies, reward: p.reward, stats: sorted({ ...p.stats }),
      lineup: (p.lineup || []).map((x) => `${x.id.replace(/^chess_char_/, '')}@${x.row},${x.col}${x.items && x.items.length ? `[${x.items.map((i) => i.replace(/^chess_item_/, '')).join('+')}]` : ''}`),
      bonds: (p.bonds || []).map((bo) => `${bo.bondId ?? bo.id} ${bo.tier}/${bo.layers}`).sort(byId),
    };
  }
  const digest = {
    mode: cfg.mode, difficulty: cfg.difficulty, seats: cfg.bots, seed: cfg.seed, combat: cfg.clientCombat === false ? 'server' : 'client', boost: cfg.boost ?? null,
    setup,
    end: {
      victory: s.victory ?? null, roundsPassed: s.roundsPassed ?? null, hiddenReached: s.hiddenReached ?? null, hiddenCleared: s.hiddenCleared ?? null,
      reason: s.reason ?? null, teamLp: s.teamLp ?? null, bossPoolLeft: m.bossPool ? int(m.bossPool.hp) : null, virtualMs: s.durationMs ?? null,
    },
    rng,
    errors: { engine: m.errorCount, logged: logged.length, sim: m.simErrors ?? null, dispatcher: m.dispatcher ? m.dispatcher.errors : null },
    rounds,
    players,
  };
  if (cfg.human?.notOwned) digest.standIns = { notOwned: [...m.players.get('h_0').standIns], rounds: standIns };
  if (cfg.human?.diy) {
    const h = m.players.get('h_0');
    // [round, this round's shop draws of its 自选 pieces (slot ids), the 自选 pieces fielded at SETTLE (slot → operator)];
    // the stock left at the end
    digest.diy = { picks: JSON.parse(JSON.stringify(h.diy)), banned: [...h.diyBanned], rounds: diyRounds, stock: h.diyStock.snapshot() };
  }
  m.dispose();
  return digest;
}

// ---------------------------------------------------------------------------------------------------------------
// family: diy (自选 pieces: a DIY slot fielded with its `diy` pick — simdata getDiy, shared/diy.js)

const DIY_SLOTS = data.backups?.diy?.slots ?? {};
/** The slot record of a tier's first slot, normal or elite (the forms every slot of the tier shares). */
const diySlotRec = (tier, elite) => {
  const base = Object.keys(DIY_SLOTS).find((id) => DIY_SLOTS[id].tier === tier);
  return base ? data.chess[elite ? DIY_SLOTS[base].goldenId : base] : null;
};

/**
 * The 自选 configurations of the corpus, in a fixed order: every owned 6★ with an operator kit (OPERATOR_KITS, file
 * order) in each form of both tiers — normal (no module: none is active), elite with no module and with each module of
 * the form — under each skill; then every prototype pick with a kit (KITTED_CHARS: its stand-in kit, a 预备干员's generic
 * kit) at its locked selection, normal and elite, per tier. `{ tier, elite, pick, group }`.
 */
function diyConfigs() {
  const diy = data.backups?.diy;
  if (!diy) return [];
  const out = [];
  for (const charId of Object.keys(OPERATOR_KITS)) {
    if (!diy.ownedPool.includes(charId)) continue;
    for (const tier of DIY_TIERS) {
      for (const elite of [false, true]) {
        const form = unitForm(data.backups, charId, diySlotRec(tier, elite)?.status);
        if (!form) continue;
        for (const uniEquipId of elite ? [null, ...(form.modules ?? []).map((m) => m.uniEquipId)] : [null]) {
          for (const s of form.skills) out.push({ tier, elite, pick: { charId, skillIndex: s.index, uniEquipId }, group: 'operator' });
        }
      }
    }
  }
  for (const tier of DIY_TIERS) {
    for (const charId of diy.prototypes?.[tier] ?? []) {
      if (!KITTED_CHARS.includes(charId)) continue;
      for (const elite of [false, true]) out.push({ tier, elite, pick: { charId }, group: 'prototype' });
    }
  }
  return out;
}

/**
 * Lay 自选 pieces on a player's board like `layout` (melee — most blockers first — on the deployable tiles the enemy
 * ground paths cross most, ranged ones beside the paths, every 7th one facing UP / LEFT / DOWN), their class read from
 * the composed record (`w.rec`, shared/diy.js diyRecordOf). No summons are placed (the 自选 hand pieces come with the
 * per-player shop).
 */
function diyLayout(stageId, wanted) {
  const map = buildDeployMap(data.stages[stageId], { field: 'normal' });
  const traffic = pathTraffic(stageId, 'normal', 0);
  const pathList = [...traffic.keys()].map((k) => k.split(',').map(Number));
  const dist = (r, c) => (pathList.length ? Math.min(...pathList.map(([pr, pc]) => Math.max(Math.abs(pr - r), Math.abs(pc - c)))) : 9);
  const used = new Set();
  const tiles = (cls) => {
    const out = [];
    for (let r = 12; r >= 9; r--) for (let c = 2; c <= 10; c++) if (!used.has(tileKey(r, c)) && canPlace(map, cls, r, c)) out.push([r, c]);
    if (cls === 'melee') return out.sort((a, b) => (traffic.get(tileKey(b[0], b[1])) || 0) - (traffic.get(tileKey(a[0], a[1])) || 0));
    const rank = (r, c) => { const d = dist(r, c); return d === 0 ? 1.5 : d; };
    return out.sort((a, b) => rank(a[0], a[1]) - rank(b[0], b[1]));
  };
  const cls = (w) => positionClass(w.rec);
  const order = wanted.slice().sort((a, b) => ((cls(b) === 'melee') - (cls(a) === 'melee')) || (cls(a) === 'melee' ? (b.rec.stats.blockCnt || 0) - (a.rec.stats.blockCnt || 0) : 0));
  const units = [];
  let uid = 1;
  for (const w of order) {
    const free = tiles(cls(w));
    if (!free.length) continue;
    const [r, c] = free[0];
    used.add(tileKey(r, c));
    const dir = units.length % 7 === 6 ? ['UP', 'LEFT', 'DOWN'][Math.floor(units.length / 7) % 3] : 'RIGHT';
    units.push({ uid: uid++, kind: 'chess', chessId: w.chessId, diy: { ...w.diy }, row: r, col: c, dir, items: [] });
  }
  return units;
}

/**
 * The diy family: the configurations (diyConfigs) 12 per battle, each on the next of its tier's two slots (the elite
 * twin for an elite form); a real stage and mode in turn, the round of the strongest piece (BAND_ROUND), the round's
 * real wave three times over, no bonds / items / band (the 自选 bonds come with the per-player roster). `pass` 0 = the
 * first battle of each group (operator kits, prototypes): the fast subset.
 */
export function diyScenarios() {
  const configs = diyConfigs();
  const scenarios = [];
  const firstOf = new Set();
  for (let i = 0, n = 0; i < configs.length; i += 12, n++) {
    const chunk = configs.slice(i, i + 12);
    const stageId = STAGES[n % STAGES.length];
    const modeId = ROSTER_MODES[n % ROSTER_MODES.length];
    const gd = gdFor(modeId);
    const turn = {};
    const wanted = chunk.map((c) => {
      const ids = Object.keys(DIY_SLOTS).filter((id) => DIY_SLOTS[id].tier === c.tier);
      turn[c.tier] = (turn[c.tier] ?? -1) + 1;
      const base = ids[turn[c.tier] % ids.length];
      const chessId = c.elite ? DIY_SLOTS[base].goldenId : base;
      const rec = diyRecordOf(data.chess[chessId], c.pick, data);
      if (!rec) throw new Error(`diy: ${c.pick.charId} is no legal pick of ${chessId}`);
      return { chessId, diy: c.pick, rec, band: c.tier + (c.elite ? 1 : 0) };
    });
    const units = diyLayout(stageId, wanted);
    if (units.length !== wanted.length) throw new Error(`diy: ${wanted.length - units.length} pieces do not fit on ${stageId}`);
    const round = BAND_ROUND[Math.max(...wanted.map((w) => w.band))];
    const seed = deriveSeed(20261005, `diy:${n}`);
    const wave = normalWave(gd, round, seed);
    const pid = 'p1';
    const groups = [...new Set(chunk.map((c) => c.group))];
    const pass = groups.some((g) => !firstOf.has(g)) ? 0 : 1;
    for (const g of groups) firstOf.add(g);
    scenarios.push({
      id: `diy-${String(n + 1).padStart(3, '0')}`, family: 'diy', kind: 'normal', modeId, round, stageId, seed, pass,
      rect: { ...GEO.NORMAL_RECT }, timeLimit: wave.timeLimit, routes: wave.routes, waveId: wave.templateId, enemyOverrides: wave.overrides,
      flags: { layerGainsEnabled: true, ...gd.dp },
      players: [playerInput(pid, 0, units)],
      spawns: [0, 1, 2].flatMap((k) => wave.spawns.map((s) => ({ ...s, time: s.time + k * Math.round(wave.timeLimit / 4), ownerPlayerId: pid }))),
      about: `${units.map((u) => `${u.chessId.replace(/^chess_char_/, '')}=${u.diy.charId.replace(/^char_\d+_/, '')}${u.diy.skillIndex != null ? `/S${u.diy.skillIndex + 1}` : ''}${u.diy.uniEquipId ? `/${u.diy.uniEquipId.replace(/^uniequip_/, '')}` : ''}`).join(' ')}`,
    });
  }
  return scenarios;
}

// ---------------------------------------------------------------------------------------------------------------
// families, fast subset, comparison

const GENERATORS = { roster: rosterScenarios, bonds: bondScenarios, fields: fieldScenarios, matches: matchScenarios, standins: standInScenarios, diy: diyScenarios };
const ABOUT = {
  roster: 'every visible chess record × every selectable skill / module, every stage, every non-leader enemy kind, items, bands, 机变 cards, map cards, placeable summons',
  bonds: 'every bond at its activation threshold (layers 1) and at its top tier (layers 999)',
  fields: 'Final Assault / Hidden Core leaders (pair + solo templates, shared pool, 200 s cap) and 联防 fields (1 / 2 helpers)',
  matches: 'matches run to the end in virtual time: bot-only (solo ×4 difficulties ×2 seeds, co-op 2/3/4, one server-run, two boosted to the Hidden Core) and one co-op match whose human seat fields 补位 stand-ins',
  standins: 'every NORMAL chess record (normal + elite) fielded as its 补位 stand-in (all 17 stand-ins and the skills the chess name for them), 12 per battle on real stages and waves',
  diy: '自选 pieces: every kitted owned 6★ × form (tiers 5 / 6, normal / elite × module) × skill, every kitted prototype at its locked selection',
};
/**
 * The default test subset (GOLDEN_FULL=1 runs everything): the pass-0 roster battles (every chess record with its
 * default loadout, every stage, every non-leader enemy kind), every bond at its top tier, both 联防 fields, four leader
 * fields (one of them a Hidden Core), six matches (solo 标准 / 绝境, co-op 2 / 4, the boosted Hidden Core run, the 补位
 * match) and the normal-record stand-in battles.
 */
const FAST_MATCHES = new Set(['solo-FUNNY-1', 'solo-HARD-1', 'coop2-NORMAL-3', 'coop4-ABYSS-7', 'solo-HARD-9-boosted', 'coop2-NORMAL-14-standins', `coop2-NORMAL-${MATCH_DIY_SEED}-diy`]);
const FAST_FIELDS = new Set(['boss-boss_1-pair', 'boss-boss_4-solo', 'boss-boss_7-pair', 'hidden-boss_9-pair', 'unite-1', 'unite-2']);
export function isFast(sc) {
  if (sc.family === 'matches') return FAST_MATCHES.has(sc.id);
  if (sc.family === 'standins') return sc.pass === 0; // the normal records (the elites with GOLDEN_FULL)
  if (sc.family === 'fields') return FAST_FIELDS.has(sc.id);
  if (sc.family === 'bonds') return sc.id.endsWith('-high');
  return sc.pass === 0;
}

const scenarioCache = new Map();
/** Scenario list of a family (generated once per process). */
export function scenariosOf(family) {
  if (!scenarioCache.has(family)) {
    const gen = GENERATORS[family];
    if (!gen) throw new Error(`unknown golden family ${family}`);
    const list = gen();
    for (const sc of list) sc.fast = isFast(sc);
    scenarioCache.set(family, list);
  }
  return scenarioCache.get(family);
}

/** Digest of one scenario. */
export function runScenario(sc) {
  return sc.kind === 'match' ? runMatch(sc) : runBattle(sc);
}

export function goldenPath(family) { return join(GOLDEN_DIR, `${family}.json`); }

export function loadGolden(family) {
  try { return JSON.parse(readFileSync(goldenPath(family), 'utf8')); } catch { return null; }
}

/** The digests of a stored golden document (its per-scenario `about` / `fast` notes removed): id → digest. */
export function storedDigests(doc) {
  const out = {};
  for (const [id, d] of Object.entries((doc && doc.scenarios) || {})) { const { about, fast, ...rest } = d; out[id] = rest; } // eslint-disable-line no-unused-vars
  return out;
}

/** Column names of the digests' rows (documented once per golden file): units, enemies, hooks, match rounds. */
export const COLUMNS = Object.freeze({ units: UNIT_COLS, enemies: ENEMY_COLS, hooks: HOOKS, rounds: MATCH_ROW_COLS });
const colsFor = (path) => (/\.hooks$/.test(path) ? HOOKS : /\.enemies\.[^.[]+$/.test(path) ? ENEMY_COLS : /\.units\[[^\]]+\]$/.test(path) ? UNIT_COLS : /\.rounds\[\d+\]\.[^.[]+$/.test(path) ? MATCH_ROW_COLS : null);
const rowName = (r) => `${r[0]}#${r[1]}:${r[3]}`;

/**
 * Field-level differences between two digests: [{ path, old, new }] — unit rows by their name (player#ref:def),
 * row cells, enemy entries, hooks and match round rows by their column names.
 * @returns {Array<{ path: string, old: any, new: any }>}
 */
export function diffDigest(a, b, path = '', out = [], limit = 40) {
  if (out.length >= limit) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a)) {
      const cols = colsFor(path);
      if (cols && a.length === b.length && a.every((x) => x === null || typeof x !== 'object')) {
        for (let i = 0; i < a.length && out.length < limit; i++) if (a[i] !== b[i]) out.push({ path: `${path}.${cols[i] ?? i}`, old: a[i], new: b[i] });
        return out;
      }
      if (/\.units$/.test(path) && a.every(Array.isArray) && b.every(Array.isArray)) {
        const A = new Map(a.map((r) => [rowName(r), r]));
        const B = new Map(b.map((r) => [rowName(r), r]));
        for (const [k, r] of A) {
          if (!B.has(k)) out.push({ path: `${path}[${k}]`, old: r, new: '(missing)' });
          else diffDigest(r, B.get(k), `${path}[${k}]`, out, limit);
          if (out.length >= limit) return out;
        }
        for (const [k, r] of B) if (!A.has(k) && out.length < limit) out.push({ path: `${path}[${k}]`, old: '(missing)', new: r });
        return out;
      }
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n && out.length < limit; i++) diffDigest(a[i], b[i], `${path}[${i}]`, out, limit);
      return out;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    for (const k of keys) {
      if (!(k in a)) out.push({ path: `${path}.${k}`, old: '(missing)', new: b[k] });
      else if (!(k in b)) out.push({ path: `${path}.${k}`, old: a[k], new: '(missing)' });
      else diffDigest(a[k], b[k], `${path}.${k}`, out, limit);
      if (out.length >= limit) return out;
    }
    return out;
  }
  out.push({ path: path || '.', old: a, new: b });
  return out;
}

/**
 * Compare computed digests (id → digest) with stored ones (storedDigests of the golden document).
 * @returns {Array<{ scenario: string, diffs: Array<{ path: string, old: any, new: any }> }>}
 */
export function compareFamily(stored, computed) {
  const out = [];
  for (const [id, dg] of Object.entries(computed)) {
    const old = stored ? stored[id] : undefined;
    if (old === undefined) { out.push({ scenario: id, diffs: [{ path: '.', old: '(not in the golden file)', new: '(computed)' }] }); continue; }
    const diffs = diffDigest(old, dg);
    if (diffs.length) out.push({ scenario: id, diffs });
  }
  return out;
}

export function formatDiffs(family, list, { maxScenarios = 12, maxDiffs = 8 } = {}) {
  const fmt = (v) => { const s = typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v)); return s.length > 160 ? `${s.slice(0, 157)}…` : s; };
  const lines = [`golden ${family}: ${list.length} scenario(s) differ`];
  for (const { scenario, diffs } of list.slice(0, maxScenarios)) {
    lines.push(`  ${scenario}:`);
    for (const d of diffs.slice(0, maxDiffs)) lines.push(`    ${d.path}: ${fmt(d.old)} → ${fmt(d.new)}`);
    if (diffs.length > maxDiffs) lines.push(`    … ${diffs.length - maxDiffs} more`);
  }
  if (list.length > maxScenarios) lines.push(`  … ${list.length - maxScenarios} more scenario(s)`);
  return lines.join('\n');
}

/**
 * Pretty JSON for review in a diff: a value whose one-line form fits (≤ 160 characters; a map of numbers ≤ 400) stays
 * on one line — unit rows, enemy entries, small objects — anything larger gets one entry per line.
 */
export function stringifyGolden(v, indent = '') {
  const one = JSON.stringify(v);
  if (v === null || typeof v !== 'object') return one;
  const scalars = Object.values(v).every((x) => x === null || typeof x !== 'object');
  if (indent.length >= 6 && (one.length <= 160 || (scalars && one.length <= 400))) return one;
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    if (scalars) return one;
    return `[\n${v.map((x) => inner + stringifyGolden(x, inner)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(v);
  if (!keys.length) return '{}';
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${stringifyGolden(v[k], inner)}`).join(',\n')}\n${indent}}`;
}

// ---------------------------------------------------------------------------------------------------------------
// running (optionally in worker threads)

/**
 * Compute digests. `select(sc)` filters scenarios; `jobs` > 1 spreads them over worker threads (results are keyed by
 * scenario id, so the split never changes a digest).
 * @returns {Promise<Record<string, Record<string, object>>>} family → id → digest
 */
export async function computeDigests(families, { select = () => true, jobs = 1, reverse = false } = {}) {
  const tasks = [];
  for (const f of families) for (const sc of scenariosOf(f)) if (select(sc)) tasks.push([f, sc.id]);
  if (reverse) tasks.reverse();
  const out = {};
  for (const f of families) out[f] = {};
  if (jobs <= 1 || tasks.length < 2) {
    for (const [f, id] of tasks) out[f][id] = runScenario(scenariosOf(f).find((s) => s.id === id));
    return order(out, families);
  }
  // heaviest first (matches), then the rest in order; each worker takes the next task when it is free
  const queue = tasks.slice().sort((a, b) => (a[0] === 'matches' ? 0 : 1) - (b[0] === 'matches' ? 0 : 1));
  await new Promise((resolve, reject) => {
    let live = 0;
    let failed = null;
    const n = Math.min(jobs, queue.length);
    for (let w = 0; w < n; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { golden: true } });
      live++;
      const feed = () => { const t = queue.shift(); if (t) worker.postMessage(t); else worker.postMessage(null); };
      worker.on('message', (msg) => {
        if (msg.error) { failed = failed || new Error(`${msg.id}: ${msg.error}`); worker.postMessage(null); return; }
        out[msg.family][msg.id] = msg.digest;
        feed();
      });
      worker.on('error', (e) => { failed = failed || e; });
      worker.on('exit', () => { if (--live === 0) (failed ? reject(failed) : resolve()); });
      feed();
    }
  });
  return order(out, families);
}

/** Digests in the scenario order of each family (stable files whatever finished first). */
function order(out, families) {
  const res = {};
  for (const f of families) {
    res[f] = {};
    for (const sc of scenariosOf(f)) if (out[f][sc.id] !== undefined) res[f][sc.id] = out[f][sc.id];
  }
  return res;
}

export function goldenDocument(family, digests) {
  const list = scenariosOf(family);
  return {
    family,
    about: ABOUT[family],
    note: 'Generated by `npm run golden:update` (tools/golden.mjs). A refactor must never change this file; see test/golden/README.md.',
    columns: family === 'matches' ? { rounds: MATCH_ROW_COLS } : { units: UNIT_COLS, enemies: ENEMY_COLS, hooks: HOOKS },
    scenarios: Object.fromEntries(list.filter((sc) => digests[sc.id] !== undefined).map((sc) => [sc.id, { about: sc.about ?? null, fast: !!sc.fast, ...digests[sc.id] }])),
  };
}

/** Coverage of a battle family's digests (skills cast, records, stages, enemy kinds) for --coverage. */
export function coverage(digests) {
  const recs = new Set();
  const lo = new Set();
  const cast = new Set();
  const loCast = new Set();
  const stages = new Set();
  const enemies = new Set();
  let units = 0;
  for (const dg of Object.values(digests)) {
    if (!dg.units) continue;
    stages.add(dg.stageId);
    for (const k of Object.keys(dg.enemies || {})) enemies.add(k);
    for (const u of dg.units) {
      if (u[2] !== 'op') continue;
      units++;
      recs.add(u[3]);
      const key = `${u[3]}|${u[4]}|${u[5]}`;
      lo.add(key);
      if (u[14] > 0) { cast.add(`${u[3]}|${u[4]}`); loCast.add(key); }
    }
  }
  const skillsWanted = new Set();
  for (const rec of VISIBLE) for (const s of rec.skills || []) if (s.skillType !== 'PASSIVE') skillsWanted.add(`${rec.chessId}|${s.index}`);
  const skillsCast = [...skillsWanted].filter((k) => cast.has(k));
  return {
    operatorUnits: units, chessRecords: recs.size, loadouts: lo.size, loadoutsCast: loCast.size,
    activeSkills: skillsWanted.size, skillsCast: skillsCast.length, skillsNeverCast: [...skillsWanted].filter((k) => !cast.has(k)),
    stages: stages.size, enemyKinds: enemies.size,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// worker / CLI

if (!isMainThread && workerData && workerData.golden) {
  parentPort.on('message', (t) => {
    if (!t) { parentPort.close(); return; }
    const [family, id] = t;
    try {
      const sc = scenariosOf(family).find((s) => s.id === id);
      parentPort.postMessage({ family, id, digest: runScenario(sc) });
    } catch (e) {
      parentPort.postMessage({ family, id, error: String(e && e.stack || e) });
    }
  });
}

const isMain = isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    opt[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  const families = opt.family ? String(opt.family).split(',') : FAMILY_NAMES.slice();
  const only = opt.only ? new Set(String(opt.only).split(',')) : null;
  const select = (sc) => (!only || only.has(sc.id)) && (!opt.fast || sc.fast);
  const jobs = Math.max(1, Number(opt.jobs) || Math.min(4, Math.max(1, availableParallelism() - 1)));
  if (opt.list) {
    for (const f of families) for (const sc of scenariosOf(f)) if (select(sc)) console.log(`${f}\t${sc.id}\t${sc.fast ? 'fast' : ''}\t${sc.about ?? ''}`.slice(0, 220));
    process.exit(0);
  }
  const t0 = performance.now();
  const digests = await computeDigests(families, { select, jobs: opt.twice ? 1 : jobs });
  const ms = Math.round(performance.now() - t0);
  let bad = 0;
  if (opt.twice) {
    const t1 = performance.now();
    const again = await computeDigests(families, { select, jobs: 1, reverse: true });
    for (const f of families) {
      const d = compareFamily(digests[f], again[f]);
      if (d.length) { bad++; console.log(formatDiffs(`${f} (second in-process run, reverse order)`, d)); }
    }
    console.log(`determinism (in-process, twice, second pass reversed): ${bad ? 'DIFFERENT' : 'identical'} · ${ms} + ${Math.round(performance.now() - t1)} ms`);
  }
  if (opt.coverage) for (const f of families) if (f !== 'matches') console.log(f, JSON.stringify(coverage(digests[f]), null, 1));
  if (opt.update) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    for (const f of families) {
      const merged = only || opt.fast ? { ...storedDigests(loadGolden(f)), ...digests[f] } : digests[f];
      writeFileSync(goldenPath(f), `${stringifyGolden(goldenDocument(f, merged))}\n`);
      console.log(`wrote ${goldenPath(f).slice(ROOT.length + 1)} (${Object.keys(digests[f]).length} scenarios computed)`);
    }
    console.log(`computed in ${ms} ms (jobs ${opt.twice ? 1 : jobs})`);
  } else if (!opt.twice) {
    for (const f of families) {
      const d = compareFamily(storedDigests(loadGolden(f)), digests[f]);
      if (d.length) { bad++; console.log(formatDiffs(f, d)); } else console.log(`golden ${f}: ${Object.keys(digests[f]).length} scenarios match`);
    }
    console.log(`${bad ? 'MISMATCH' : 'ok'} · ${ms} ms (jobs ${jobs})`);
  }
  process.exit(bad ? 1 : 0);
}
