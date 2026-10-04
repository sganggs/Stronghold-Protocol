// server/sim/spec.js — BattleSpec: the JSON description of one battle, built by the server and simulated identically
// by the server (headless / takeover / verification) and by browsers (the authoritative client and display replicas).
// DESIGN §14. Pure ESM (served at /sim/spec.js): no Node API.
//
//   const spec = buildBattleSpec({ battleId, fieldId, kind, seed, modeId, round, stageId, rect, timeLimit, players,
//                                  spawns, routes, flags, enemyOverrides, waveId, bossId, content, boss })
//   const battle = createBattleFromSpec(spec, dataSource, { sharedBoss?, BattleClass?, logger?, recordEvents?, quiet? })
//
// A spec is JSON-safe by construction (it IS the JSON round trip of its inputs: `undefined` / functions vanish,
// Infinity / NaN become null), so the server builds its own battles from exactly what the clients receive. Object
// references (stage records, the shared boss pool, the data source) never travel: `stageId` names the stage, `boss`
// carries the pool numbers at battle start and the side that runs the battle attaches a pool object:
//   * server: the match's SharedBossPool (or a crediting wrapper on takeover, server/match/finalAssault.js),
//   * client: a LocalBossPool (below) reconciled with the server's `b.pool` broadcasts.
// Determinism: the sim uses no wall clock and no Math.random; the same spec + the same data give the same result on
// every machine (test/match/clientCombat.test.js compares result digests).
//
// Operator loadouts (DESIGN §16): every operator entry of `players[].units[]` may carry `skillIndex` (character skill
// slot, 0-based) and `moduleId` (uniEquipId or 'none'); buildBattleSpec keeps them when well-formed (else drops them =
// the default). createBattleFromSpec hands the Battle a per-battle data view (withUnitLoadouts) that resolves each
// operator def — and its summons — for the loadout of its chess (simdata getChess(id, loadout) / getToken(id, owner,
// ownerLoadout)); an explicit loadout argument always wins over the view's per-chess lookup.

import { Battle } from './Battle.js';
import { toDataSource, withUnitLoadouts } from './simdata.js';
import { BOSS_POOL_MIN_HP } from './constants.js';

export const SPEC_VERSION = 1;

/** Deep JSON round trip (exactly what a spec becomes on the wire). */
export function jsonClone(v) {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v));
}

// JSON has no Infinity: ±Infinity inputs become ±1e308 (still "larger than anything" for the sim's comparisons and
// caps) instead of null (which the sim would read as 0); NaN becomes null (the sim treats both as "missing").
const INF = 1e308;
const specReplacer = (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (Number.isNaN(v) ? null : v > 0 ? INF : -INF) : v);

/**
 * Build the JSON BattleSpec of one field (DESIGN §14). Inputs are the Battle options the match computed (DESIGN §5.1)
 * minus object references: `stageId` instead of a stage object, `boss: { poolHp, poolMax }` instead of a pool.
 * @returns {object} a fresh JSON-safe object
 */
export function buildBattleSpec(o = {}) {
  const bossLike = o.kind === 'boss' || o.kind === 'hidden';
  const tl = Number(o.timeLimit);
  const spec = {
    v: SPEC_VERSION,
    battleId: o.battleId ?? null,
    fieldId: o.fieldId ?? null,
    kind: o.kind ?? 'normal',
    seed: (Number(o.seed) >>> 0) || 1,
    modeId: o.modeId ?? null,
    round: Number.isInteger(o.round) ? o.round : 0,
    stageId: o.stageId ?? null,
    rect: o.rect ?? null,
    // boss / hidden fields end by the shared pool or the match (null = no limit)
    timeLimit: !bossLike && tl > 0 && Number.isFinite(tl) ? tl : null,
    players: Array.isArray(o.players) ? o.players : [],
    // a spawn at time Infinity never happens and is not counted (Battle._queueSpawn): leave it out
    spawns: (Array.isArray(o.spawns) ? o.spawns : []).filter((x) => !(x && Number(x.time) === Infinity)),
    routes: Array.isArray(o.routes) ? o.routes : [],
    flags: o.flags ?? {},
    enemyOverrides: o.enemyOverrides ?? {},
    waveId: o.waveId ?? null,
    bossId: o.bossId ?? null,
    content: o.content ?? 'full',
    boss: bossLike && o.boss ? { poolHp: Number(o.boss.poolHp) || 0, poolMax: Number(o.boss.poolMax) || 1 } : null,
  };
  const out = JSON.parse(JSON.stringify(spec, specReplacer));
  for (const p of out.players) for (const u of (p && Array.isArray(p.units) ? p.units : [])) if (u && typeof u === 'object') sanitizeUnitLoadout(u);
  return out;
}

const LOADOUT_ID = /^[A-Za-z0-9_\-]{1,64}$/;

/** Keep a unit's `skillIndex` / `moduleId` only when well-formed (the data layer checks legality). Mutates `u`. */
export function sanitizeUnitLoadout(u) {
  if ('skillIndex' in u && !(Number.isInteger(u.skillIndex) && u.skillIndex >= 0 && u.skillIndex <= 9)) delete u.skillIndex;
  if ('moduleId' in u && !(typeof u.moduleId === 'string' && LOADOUT_ID.test(u.moduleId))) delete u.moduleId;
  if (u.kind === 'token') { delete u.skillIndex; delete u.moduleId; }
  return u;
}

// withUnitLoadouts(ds, players) — the per-battle loadout data view — lives in simdata.js (content/index.js
// installContent applies it to every Battle, however constructed); re-exported here for spec users.
export { withUnitLoadouts };

/**
 * Construct the Battle a spec describes. The spec is deep-copied (one spec may build several battles: a display
 * replica, a takeover re-simulation, a verification run).
 * @param {object} spec BattleSpec
 * @param {any} dataSource DataSource (or raw data maps; default: the sim's default source)
 * @param {{ sharedBoss?: object|null, BattleClass?: Function, logger?: object, recordEvents?: boolean, quiet?: boolean,
 *           content?: string }} [opts]
 */
export function createBattleFromSpec(spec, dataSource, opts = {}) {
  if (!spec || typeof spec !== 'object') throw new TypeError('createBattleFromSpec: spec required');
  const s = jsonClone(spec);
  const bossLike = s.kind === 'boss' || s.kind === 'hidden';
  let sharedBoss = opts.sharedBoss ?? null;
  if (!sharedBoss && bossLike && s.boss) sharedBoss = new LocalBossPool(s.boss.poolMax, s.boss.poolHp);
  const BattleClass = typeof opts.BattleClass === 'function' ? opts.BattleClass : Battle;
  const battleOpts = {
    seed: s.seed,
    kind: s.kind,
    modeId: s.modeId,
    round: s.round,
    stageId: s.stageId,
    rect: s.rect ?? undefined,
    timeLimit: s.timeLimit == null ? (bossLike ? Infinity : undefined) : s.timeLimit,
    players: s.players ?? [],
    spawns: s.spawns ?? [],
    routes: s.routes ?? [],
    sharedBoss,
    flags: s.flags ?? {},
    fieldId: s.fieldId,
    enemyOverrides: s.enemyOverrides ?? {},
    waveId: s.waveId ?? null,
    data: BattleClass === Battle ? withUnitLoadouts(toDataSource(dataSource), s.players) : dataSource,
    content: opts.content ?? s.content ?? 'full',
  };
  if (s.bossId != null) battleOpts.bossId = s.bossId;
  if (opts.logger) battleOpts.logger = opts.logger;
  if (opts.recordEvents === false) battleOpts.recordEvents = false;
  if (opts.quiet) battleOpts.quiet = true;
  const b = new BattleClass(battleOpts);
  b.battleId = s.battleId ?? null;
  return b;
}

/**
 * Client-side view of the shared boss HP pool (DESIGN §14 b.pool): the server owns the pool; this field adds its own
 * damage locally and shows `server hp − local damage the server has not acknowledged yet`.
 *   damage(playerId, amount)  called by the sim; returns the damage dealt (≤ the remaining displayed hp; the hit that
 *                             would leave less than BOSS_POOL_MIN_HP (1) takes the rest)
 *   sync(serverHp, ackedCum)  a b.pool broadcast: the server's hp and how much of THIS field's cumulative damage
 *                             (`cum`) it has already counted
 *   cum / byPlayer            cumulative damage of this field (reported as b.progress.bossDmg / .by)
 * `hp` below 1 reads 0 (the leader is down; user playtest #6 item 5): the difference of the server's float hp and the
 * local counters can leave dust (3.6e-12) smaller than half an ulp of `cum`, which no hit could remove — `cum += dust`
 * changes nothing — so the leader stood at "0 HP" and the field never ended.
 */
export class LocalBossPool {
  constructor(maxHp, hp = maxHp) {
    this.maxHp = Math.max(1, Number(maxHp) || 1);
    const h = Number(hp);
    this.serverHp = Number.isFinite(h) ? Math.max(0, Math.min(this.maxHp, h)) : this.maxHp;
    this.cum = 0;
    this.acked = 0;
    /** @type {Record<string, number>} */
    this.byPlayer = {};
  }

  get hp() {
    const h = this.serverHp - Math.max(0, this.cum - this.acked);
    return h < BOSS_POOL_MIN_HP ? 0 : h;
  }

  /** Only used by the sim's fallback path when damage() throws. */
  set hp(v) {
    const n = Number(v);
    if (Number.isFinite(n)) this.serverHp = Math.max(0, n) + Math.max(0, this.cum - this.acked);
  }

  damage(playerId, amount) {
    const a = Number(amount);
    const left = this.hp;
    if (!Number.isFinite(a) || a <= 0 || left <= 0) return 0;
    const dealt = left - a < BOSS_POOL_MIN_HP ? left : a;
    this.cum += dealt;
    if (playerId != null) this.byPlayer[playerId] = (this.byPlayer[playerId] || 0) + dealt;
    return dealt;
  }

  sync(serverHp, ackedCum) {
    const h = Number(serverHp);
    if (Number.isFinite(h)) this.serverHp = Math.max(0, Math.min(this.maxHp, h));
    const a = Number(ackedCum);
    if (Number.isFinite(a) && a >= 0) this.acked = a;
  }
}

/**
 * LP meter of a battle: cumulative LP the field cost its team so far — enemy leaks weighted by `lpr` (data
 * lifePointReduce; 0 for harmless units, 1 when absent) plus leader "扣除目标生命" effects (the sim's 'lpLoss' hook).
 * Boss / hidden fields report it as b.progress.leaks; the server charges the team LP with the deltas.
 * @returns {{ lp: number, detach: () => void }}
 */
export function attachLpMeter(battle) {
  const meter = { lp: 0, detach() {} };
  if (!battle || typeof battle.on !== 'function') return meter;
  const h1 = battle.on('enemyLeak', (ctx) => {
    const e = ctx && ctx.enemy;
    if (!e) return;
    const lpr = Number.isFinite(e.lpr) && e.lpr >= 0 ? e.lpr : 1;
    meter.lp += lpr;
  }, { priority: -1000, owner: 'lpMeter' });
  const h2 = battle.on('lpLoss', (ctx) => {
    const n = Number(ctx && ctx.amount);
    if (Number.isFinite(n) && n > 0) meter.lp += n;
  }, { priority: -1000, owner: 'lpMeter' });
  meter.detach = () => { try { battle.off?.(h1); battle.off?.(h2); } catch { /* ignore */ } };
  return meter;
}

/**
 * 联防 (user playtest #6 item 7): each source player's enemies still standing on a unite field — not spawned yet,
 * alive, or already through the objective again — i.e. what settlement would charge them if the battle ended now
 * (server/match/unite.js uniteSurvivors: the unite result's counted leaks + unspawned entries by `sourcePlayerId`;
 * alive enemies become leaks on a timeout, keyed like Battle._recordLeak). It falls as the helpers strike them down and
 * rises when one splits or summons (content-spawned children inherit the parent's sourcePlayerId).
 * `{ [playerId]: n }` (a player with none left is absent), or null for a battle without the sim's state (a stand-in).
 * @returns {Record<string, number> | null}
 */
export function uniteLeft(battle) {
  if (!battle) return null;
  const out = {};
  const add = (pid) => { if (typeof pid === 'string' && pid) out[pid] = (out[pid] || 0) + 1; };
  if (battle.finished && typeof battle.result === 'function') {
    const r = battle.result();
    if (!r || !r.perPlayer) return null;
    for (const pp of Object.values(r.perPlayer)) for (const l of (pp && pp.leaked) || []) if (l && l.counted !== false) add(l.sourcePlayerId);
    for (const u of r.unspawned || []) if (u) add(u.sourcePlayerId);
    return out;
  }
  if (!battle._perPlayer || !Array.isArray(battle._pending) || !Array.isArray(battle.enemies)) return null;
  for (const p of battle._pending) if (p) add(p.sourcePlayerId);
  for (const e of battle.enemies) if (e && e.alive && e.counted) add(e.sourcePlayerId ?? e.ownerId);
  for (const pp of Object.values(battle._perPlayer)) for (const l of (pp && pp.leaked) || []) if (l && l.counted !== false) add(l.sourcePlayerId);
  return out;
}

/**
 * Progress numbers of a battle for b.progress / the teammates' waiting UI: game time, kills, total, counted leaks
 * (normal / unite), the boss pool damage of this field and — unite fields — `left` (uniteLeft: each leaker's enemies
 * still standing).
 */
export function battleProgress(battle) {
  const r = battle && typeof battle.result === 'function' && battle.finished ? battle.result() : null;
  let leaks = 0;
  let resolvedLeaks = 0;
  const pp = battle && battle._perPlayer ? battle._perPlayer : (r && r.perPlayer) || {};
  for (const k of Object.keys(pp)) {
    for (const l of pp[k].leaked || []) {
      if (!l || l.counted === false) continue;
      leaks++;
      // the HUD capsule's numerator also counts the round's own enemies that leaked (official: 漏一个 1/3) — a runtime
      // split / summon is `inTotal: false` and never moves it
      if (l.inTotal !== false) resolvedLeaks++;
    }
  }
  const pool = battle && battle.sharedBoss;
  const gt = Number(battle && battle.time) || 0;
  const killed = Math.max(0, Math.trunc(Number(battle && battle.killed) || 0));
  const total = Math.max(0, Math.trunc(Number(battle && battle.total) || 0));
  const out = {
    gt: Math.round(gt * 1000) / 1000,
    killed,
    total,
    resolved: Math.min(total, killed + resolvedLeaks),
    leaks,
    bossDmg: pool && Number.isFinite(pool.cum) ? pool.cum : 0,
    done: !!(battle && battle.finished),
  };
  if (battle && battle.kind === 'unite') {
    const left = uniteLeft(battle);
    if (left) out.left = left;
  }
  return out;
}

const r4 = (v) => Math.round((Number(v) || 0) * 1e4) / 1e4;
const modsKey = (m) => (m && typeof m === 'object' ? JSON.stringify(Object.keys(m).filter((k) => m[k] !== undefined).sort().map((k) => [k, m[k]])) : '');

/**
 * Canonical summary of a BattleResult (everything the match consumes): used to compare a client's result with the
 * server's re-simulation (SP_VERIFY) and by the determinism tests. Returns `{ json, hash }`.
 */
export function resultDigest(result) {
  const res = result && typeof result === 'object' ? result : {};
  const per = res.perPlayer && typeof res.perPlayer === 'object' ? res.perPlayer : {};
  const players = Object.keys(per).sort().map((pid) => {
    const p = per[pid] || {};
    const lg = p.layerGains && typeof p.layerGains === 'object' ? p.layerGains : {};
    return [
      pid,
      p.killed | 0, p.total | 0, !!p.perfect, r4(p.coins),
      Object.keys(lg).sort().map((k) => [k, r4(lg[k])]),
      // mods included: a leak re-enters the 联防 with them (round multipliers, bounty id)
      (Array.isArray(p.leaked) ? p.leaked : []).map((l) => `${l && l.enemyKey}|${l && l.counted === false ? 0 : 1}|${(l && l.sourcePlayerId) || ''}|${modsKey(l && l.mods)}`).sort(),
      Math.round(Number(p.damageDealt) || 0), Math.round(Number(p.bossDamage) || 0),
      (Array.isArray(p.unitsEnd) ? p.unitsEnd : []).map((u) => [u && u.uid, r4(u && u.hpPct), r4(u && u.sp), !!(u && u.alive)]),
    ];
  });
  const json = JSON.stringify([res.reason ?? null, r4(res.time), res.killed | 0, res.total | 0, players]);
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return { json, hash: h.toString(16).padStart(8, '0') };
}

const fnum = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const cap = (list, n) => (Array.isArray(list) ? list.slice(0, n) : []);
const isKey = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[A-Za-z0-9_\-.:]+$/.test(v);
const uidOr = (v) => (Number.isInteger(v) && v >= 1 && v <= 2 ** 31 ? v : null);
const keyOr = (v) => (isKey(v) ? v : null);

function compactMods(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(m)) {
    if (n >= 16 || k.length > 32) break;
    const v = m[k];
    if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 64) || v === null) { out[k] = v; n++; }
  }
  return out;
}

/**
 * The part of a BattleResult the server consumes, in the b.result wire shape (shared/protocol.js isBattleResult):
 * numbers only where the match reads them, list sizes capped, names dropped (the server names units from its data).
 */
export function compactResult(res) {
  const r = res && typeof res === 'object' ? res : {};
  const perPlayer = {};
  for (const pid of Object.keys(r.perPlayer || {}).slice(0, 4)) {
    const p = r.perPlayer[pid] || {};
    const layerGains = {};
    for (const [k, v] of Object.entries(p.layerGains || {}).slice(0, 40)) if (isKey(k) && fnum(v) > 0) layerGains[k] = Math.min(1e4, fnum(v));
    const total = Math.max(0, Math.trunc(fnum(p.total)));
    perPlayer[pid] = {
      killed: Math.min(total, Math.max(0, Math.trunc(fnum(p.killed)))),
      total,
      leaked: cap(p.leaked, 400).filter((l) => l && isKey(l.enemyKey)).map((l) => {
        const o = { enemyKey: l.enemyKey, mods: compactMods(l.mods), lpr: Math.max(0, Math.min(1000, fnum(l.lpr, 1))), sourcePlayerId: keyOr(l.sourcePlayerId), tag: typeof l.tag === 'string' && l.tag.length <= 16 ? l.tag : null, counted: l.counted !== false };
        if (l.boss) o.boss = true;
        if (l.spawned) o.spawned = true;
        return o;
      }),
      perfect: !!p.perfect,
      layerGains,
      coins: Math.max(0, fnum(p.coins)),
      damageDealt: Math.max(0, Math.round(fnum(p.damageDealt))),
      bossDamage: Math.max(0, Math.round(fnum(p.bossDamage))),
      healingDone: Math.max(0, Math.round(fnum(p.healingDone))),
      deaths: Math.max(0, Math.trunc(fnum(p.deaths))),
      unitsEnd: cap(p.unitsEnd, 64).filter(Boolean).map((u) => ({
        uid: uidOr(u.uid), defId: keyOr(u.defId), hpPct: Math.max(0, Math.min(1, fnum(u.hpPct))), sp: Math.max(0, Math.min(1e5, fnum(u.sp))),
        skillActive: !!u.skillActive, alive: !!u.alive,
      })),
      unitStats: cap(p.unitStats, 160).filter(Boolean).map((u) => ({
        uid: uidOr(u.uid), defId: keyOr(u.defId), kind: typeof u.kind === 'string' && u.kind.length <= 16 ? u.kind : 'op',
        dmg: Math.max(0, Math.round(fnum(u.dmg))), kills: Math.max(0, Math.trunc(fnum(u.kills))), heal: Math.max(0, Math.round(fnum(u.heal))),
        taken: Math.max(0, Math.round(fnum(u.taken))), attacks: Math.max(0, Math.trunc(fnum(u.attacks))),
      })),
    };
  }
  const out = {
    reason: ['cleared', 'timeout', 'forced'].includes(r.reason) ? r.reason : 'forced',
    time: Math.max(0, Math.min(1e5, fnum(r.time))),
    killed: Math.max(0, Math.trunc(fnum(r.killed))),
    total: Math.max(0, Math.trunc(fnum(r.total))),
    perPlayer,
    errors: Math.max(0, Math.min(1e9, Math.trunc(fnum(r.errors)))),
  };
  if (out.killed > out.total) out.killed = out.total;
  if (Array.isArray(r.unspawned) && r.unspawned.length) {
    out.unspawned = cap(r.unspawned, 400).filter((u) => u && isKey(u.enemyKey)).map((u) => ({
      enemyKey: u.enemyKey, sourcePlayerId: keyOr(u.sourcePlayerId), tag: typeof u.tag === 'string' && u.tag.length <= 16 ? u.tag : null,
      time: Math.max(0, Math.min(1e6, fnum(u.time))),
    }));
  }
  return out;
}

/** Bytes a b.result frame may use (the socket's inbound limit is 64 KB; headroom for the envelope). */
export const RESULT_FRAME_BUDGET = 60 * 1024;

/**
 * Keep a compact result under the frame budget (a larger frame closes the socket: the server would take the field over
 * at the very end). Never touches what settles LP / funds / layers of a normal field. In order: drop the per-unit
 * statistics, drop the leaks' `mods` (the server rebuilds them from the spec), and — boss fields only, whose leaks cost
 * team LP through b.progress — drop leak entries. Returns the (possibly) trimmed copy.
 * @param {object} result compactResult(...) output
 * @param {{ bossLike?: boolean, budget?: number, battleId?: string }} [o]
 */
export function fitResult(result, { bossLike = false, budget = RESULT_FRAME_BUDGET, battleId = '' } = {}) {
  const size = (r) => JSON.stringify({ t: 'b.result', battleId, result: r, rid: 2147483647 }).length;
  if (!result || typeof result !== 'object' || size(result) <= budget) return result;
  const r = { ...result, perPlayer: {} };
  for (const [pid, p] of Object.entries(result.perPlayer || {})) r.perPlayer[pid] = { ...p, unitStats: [] };
  if (size(r) <= budget) return r;
  for (const p of Object.values(r.perPlayer)) p.leaked = (p.leaked || []).map((l) => ({ ...l, mods: null }));
  if (size(r) <= budget || !bossLike) return r;
  for (const p of Object.values(r.perPlayer)) p.leaked = [];
  if (Array.isArray(r.unspawned)) r.unspawned = [];
  return r;
}
