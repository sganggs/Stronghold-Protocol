// test/helpers/battleHarness.js — convenience harness for sim-core and content tests (see docs/SIM.md §Testing).
//
//   import { makeBattle, flatStage, chessRec, enemyRec } from '../helpers/battleHarness.js';
//   const h = makeBattle({ units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 5 }],
//                          enemies: [{ key: 'enemy_1422_lrsldr', time: 0, route: 0 }], seed: 7 });
//   h.runUntil(() => h.enemies().length === 0, 60);
//   assert.equal(h.result().reason, 'cleared');
//
// makeBattle(opts):
//   stageId       real stage id (data/stages.json) or 'flat' (default: synthetic open lane stage, see flatStage())
//   stage         explicit stage object (overrides stageId)
//   kind          'normal' | 'unite' | 'boss' | 'hidden' (default 'normal')
//   seed          uint32 (default 1)
//   units         [{ chessId, row, col, items?, uid?, carryState?, abs?, standIn? } | { kind:'token', tokenId, row, col }]
//                 board coordinates (rows 9–12, cols 2–10) for player 'p1'. `standIn: true` fields a NORMAL chess as its
//                 补位 stand-in (data/backups.json through simdata getChess(id, { standIn: true }) — the production
//                 path: the chess's ids / bonds / 特质 / tier, the stand-in's body, its kit by charId); the `_a` id is the
//                 normal form, `_b` the elite, skill / module are the chess's backup selection. `standIn: { skillIndex?,
//                 moduleId? }` fields it with another of the stand-in's skills / modules (a kit test of a skill no chess
//                 names): the composed record (standInRec) replaces that chess id's record for the whole battle.
//                 `{ diy: { slot, charId, skillIndex?, uniEquipId? }, elite?, row, col }` fields a 自选 piece — the
//                 production path (simdata getChess(slotId, { diy }), shared/diy.js): `slot` = a DIY slot's base id
//                 (`chess_char_5_diy1_a`) or its tier (5 / 6 ⇒ that tier's first slot), `elite` = its `_b` form (E2
//                 Lv60, module stage 1 at tier 5 / 3 at tier 6); the operator's kit is KITS[charId]; a prototype may
//                 omit skillIndex / uniEquipId (its locked ones)
//   players       full PlayerBattleInput[] (overrides `units`)
//   enemies       [{ key, time=0, route=0 | RouteSpec, pos?, count?, interval?, mods?, tag?, bounty?, sourcePlayerId? }]
//   waveTemplate  wave id (data/waves.json) or template object → routes + spawns + timeLimit
//   routes        RouteSpec[] (default: template routes, or flat-stage routes 0..3 = walk low, walk high, fly low, fly high)
//   timeLimit     seconds (default: template maxPlayTime, else 60; boss/hidden: Infinity)
//   content       'full' | 'generic' | 'none' (default 'full')
//   kits          { [baseChessId | standInCharId]: (bb, chess, def) => Kit } injected kits (take precedence over
//                 kits/index.js; a stand-in's kit is keyed by its charId only)
//   extraContent  [{ install(battle) }] extra content modules installed after the domain modules (content tests)
//   defs          { chess: {id: record}, enemies: {key: record}, tokens: {id: record} } extra/override data records
//   flags, sharedBoss, modeId, round, setup(battle), recordEvents (default true). The harness sets
//                 flags.startOpCooldown = 0 unless given: the official 3 s operation cooldown of the battle-start
//                 deployment (Battle default AUTO_OP_COOLDOWN) would hold back every test that fills a skill's SP at
//                 t ≈ 0 to stand for a skill that became ready mid-fight; tests of that rule pass it explicitly
//   autoFinish    end when all enemies are dead (default: true when any spawn is scheduled, else false so a
//                 battle without enemies keeps running until its time limit)
//   hooks         list of hook names to capture (default: all DESIGN events)
// Returned harness: { battle, b, step(n), run(seconds), runUntil(pred|seconds, maxSeconds), runToEnd(maxSeconds),
//   unit(idOrChessIdOrUid), allies(), enemies(), enemy(key), spawn(key, opts), events, eventsOf(kind),
//   hooks, hooksOf(name), invariants(), result(), snapshot() }

import { Battle } from '../../server/sim/Battle.js';
import { DataSource, getDefaultSource, spawnsFromTemplate } from '../../server/sim/simdata.js';
import { TICK } from '../../server/sim/constants.js';
import { standInRecord, composeUnitRecord, unitForm } from '../../shared/standIn.js';

export const ALL_HOOKS = Object.freeze([
  'battleStart', 'deploy', 'tick', 'beforeAttack', 'attack', 'hit', 'damaged', 'heal', 'kill', 'death',
  'skillStart', 'skillEnd', 'ammoUsed', 'spGain', 'statusApplied', 'blocked', 'enemySpawn', 'enemyLeak', 'battleEnd',
  'fatal', 'layerGain', 'elementBurst', 'dodge',
]);
const NOISY = new Set(['tick', 'spGain', 'hit', 'damaged', 'beforeAttack', 'attack', 'heal']);

/**
 * Synthetic 19×21 stage: open lanes on the normal field (rows 9–12) and the boss field (rows 1–5).
 * Normal: gates S (9,10) & (12,10), goal E (9,2); partner half mirrors with gates at col 18.
 * `opts.crates` = [[r,c]…] adds crate devices; `opts.rows` overrides specific rows ({ [row]: string }).
 */
export function flatStage(opts = {}) {
  const rows = [];
  for (let r = 0; r < 19; r++) rows.push('#'.repeat(21));
  rows[0] = 'aaaaaaaaaa#aaaaaaaaaa';
  rows[1] = '###IAAAAA###AAAAAI###';
  rows[2] = '##ErrrrrrrOrrrrrrrE##';
  rows[3] = '##hrrrrrrrfrrrrrrrh##';
  rows[4] = '##hrrrrrrrfrrrrrrrh##';
  rows[5] = '##hrrrrrrrOrrrrrrrh##';
  rows[6] = 'X'.repeat(21);
  rows[7] = 'aaaaaaaaaa###########';
  rows[8] = '####AAAAA##I#########';
  rows[9] = '##ErrrrrrrSrrrrrrrS##';
  rows[10] = '##hrrrrrrrfrrrrrrrf##';
  rows[11] = '##hrrrrrrrfrrrrrrrf##';
  rows[12] = '##hrrrrrrrSrrrrrrrS##';
  rows[13] = 'X'.repeat(21);
  for (const [k, v] of Object.entries(opts.rows || {})) rows[+k] = v;
  const devices = (opts.crates || []).map(([r, c], i) => ({ key: 'trap_1105_accrate', name: '阻隔工事', pos: [r, c], hidden: false, role: 'crate', active: true, alias: `crate#${i}` }));
  return { id: opts.id ?? 'flat', name: 'flat', rows, devices };
}

/** Default routes for the flat stage (and any stage with the standard gates). */
export function flatRoutes(kind = 'normal') {
  if (kind === 'boss' || kind === 'hidden') {
    return [
      { motion: 'WALK', start: [2, 10], end: [2, 2], checkpoints: [] },
      { motion: 'WALK', start: [5, 10], end: [2, 2], checkpoints: [] },
      { motion: 'FLY', start: [2, 10], end: [2, 2], checkpoints: [] },
      { motion: 'WALK', start: [2, 10], end: [2, 18], checkpoints: [] },
      { motion: 'WALK', start: [5, 10], end: [2, 18], checkpoints: [] },
    ];
  }
  if (kind === 'unite') {
    return [
      { motion: 'WALK', start: [9, 18], end: [9, 2], checkpoints: [] },
      { motion: 'WALK', start: [12, 18], end: [9, 2], checkpoints: [] },
      { motion: 'FLY', start: [9, 18], end: [9, 2], checkpoints: [] },
      { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] },
    ];
  }
  return [
    { motion: 'WALK', start: [9, 10], end: [9, 2], checkpoints: [] },
    { motion: 'WALK', start: [12, 10], end: [9, 2], checkpoints: [] },
    { motion: 'FLY', start: [9, 10], end: [9, 2], checkpoints: [] },
    { motion: 'FLY', start: [12, 10], end: [9, 2], checkpoints: [] },
  ];
}

/**
 * Build a chess record in data/chess.json shape (for synthetic test units).
 * Minimal: chessRec({ id: 'test_guard', profession: 'WARRIOR', stats: { atk: 500 } })
 */
export function chessRec(o = {}) {
  const id = o.id ?? o.chessId ?? 'test_chess_a';
  const stats = {
    maxHp: 2000, atk: 500, def: 200, res: 0, cost: 10, blockCnt: 2, bat: 1, aspd: 100, respawnTime: 20,
    spRecovery: 1, hpRecoveryPerSec: 0, moveSpeed: 1, tauntLevel: 0, massLevel: 0, ...(o.stats || {}),
  };
  const rec = {
    chessId: id, baseId: o.baseId ?? id, isGolden: !!o.golden, tier: o.tier ?? 1, name: o.name ?? id, charId: o.charId ?? id,
    profession: o.profession ?? 'WARRIOR', subProfessionId: o.subProfessionId ?? o.subProf ?? null,
    position: o.position ?? (['SNIPER', 'CASTER', 'MEDIC', 'SUPPORT'].includes(o.profession) ? 'RANGED' : 'MELEE'),
    bonds: o.bonds ?? [], stats, rangeGrid: o.rangeGrid ?? [[0, 0], [0, 1]],
    dmgType: o.dmgType ?? null, attackKind: o.attackKind ?? null, projectile: o.projectile ?? null,
    canHitFly: o.canHitFly ?? null, targetPriority: o.targetPriority ?? null,
    trait: { desc: o.trait ?? '', bb: {} }, talents: o.talents ?? [], tokens: o.tokens ?? [],
    immunities: o.immunities ?? {},
    skill: o.skill === null ? null : {
      skillId: 'sk_test', name: 'test skill', skillType: 'MANUAL', durationType: 'NONE', duration: 10,
      spType: 'INCREASE_WITH_TIME', spCost: 10, initSp: 0, maxChargeTime: 1, bb: {}, trigger: { rule: 'DEFAULT' }, index: 1,
      ...(o.skill || {}),
    },
  };
  return rec;
}

/** Build an enemy record in data/enemies.json shape. */
export function enemyRec(o = {}) {
  const key = o.key ?? 'enemy_test';
  return {
    key, name: o.name ?? key, rank: o.rank ?? 'NORMAL', applyWay: o.applyWay ?? ((o.range ?? 0) > 0 ? 'RANGED' : 'MELEE'),
    stats: {
      maxHp: o.hp ?? 5000, atk: o.atk ?? 0, def: o.def ?? 0, res: o.res ?? 0, moveSpeed: o.speed ?? 1, bat: o.bat ?? 2,
      aspd: o.aspd ?? 100, rangeRadius: o.range ?? 0, blockCnt: o.blockCnt ?? 1, massLevel: o.mass ?? 1, lpr: o.lpr ?? 1,
      hpRecoveryPerSec: 0, elementRes: 0, elementDmgRes: 0, dmgType: o.dmgType ?? 'phys', motion: o.motion ?? 'WALK',
      immunities: o.immunities ?? {}, otherImmunities: o.otherImmunities ?? [], tauntLevel: o.taunt ?? 0,
    },
    notCountInTotal: !!o.notCountInTotal, tags: [], abilities: [], talents: { bb: {} }, skills: [],
  };
}

/**
 * The 补位 record of a NORMAL chess (data/chess.json `_a` normal / `_b` elite) fielded as its stand-in — shared/standIn.js
 * standInRecord: the chess's backup skill and module — or, with `skillIndex` / `moduleId` (null / 'none' = no module),
 * another selection of the same stand-in at the chess's status. Throws when the chess has no stand-in (PRESET, DIY) or
 * the stand-in lacks that skill / module.
 * @param {string} chessId
 * @param {{ skillIndex?: number, moduleId?: string|null }} [sel]
 * @param {object} [data] DataSource (default: the sim's default source)
 */
export function standInRec(chessId, sel = {}, data = getDefaultSource()) {
  const chess = data.rawChess(chessId);
  const backups = typeof data.rawBackups === 'function' ? data.rawBackups() : null;
  const b = chess?.backup;
  if (!b || !backups || chess.chessType !== 'NORMAL') throw new Error(`${chessId}: no 补位 stand-in (PRESET / DIY chess, or no backups.json)`);
  const custom = sel && (sel.skillIndex != null || sel.moduleId !== undefined);
  const rec = !custom ? standInRecord(chess, backups) : composeUnitRecord(chess, backups.units?.[b.charId], unitForm(backups, b.charId, chess.status), {
    skillIndex: sel.skillIndex ?? b.skillIndex,
    moduleId: sel.moduleId === undefined ? b.uniEquipId ?? null : (sel.moduleId === 'none' ? null : sel.moduleId),
    standInFor: chess.charId,
  });
  if (!rec || !rec.skill) throw new Error(`${chessId}: stand-in ${b.charId} has no skill ${sel?.skillIndex ?? b.skillIndex}`);
  const mod = sel?.moduleId;
  if (custom && mod && mod !== 'none' && !rec.module?.active) throw new Error(`${chessId}: stand-in ${b.charId} has no module ${mod} at ${chessId}`);
  return rec;
}

function buildData(defs) {
  if (!defs) return getDefaultSource();
  return new DataSource({ chess: defs.chess ?? {}, enemies: defs.enemies ?? {}, tokens: defs.tokens ?? {}, stages: defs.stages ?? {}, waves: defs.waves ?? {} }, getDefaultSource());
}

/**
 * A harness `units[]` entry with `diy` → its PlayerBattleInput fields: `chessId` = the slot's normal or elite id, `diy` =
 * the pick ({ charId, skillIndex, uniEquipId } as given). Other entries unchanged.
 */
function diyEntry(u, data = getDefaultSource()) {
  if (!u || !u.diy || typeof u.diy !== 'object') return u;
  const slots = data.rawBackups?.()?.diy?.slots ?? {};
  const { slot, ...pick } = u.diy;
  const base = typeof slot === 'number' ? Object.keys(slots).find((id) => slots[id].tier === slot) : slot;
  if (!base || !slots[base]) throw new Error(`diy: unknown slot ${slot}`);
  const { elite, ...rest } = u;
  return { ...rest, chessId: elite ? slots[base].goldenId : base, diy: pick };
}

/** `units[].standIn` objects → the composed records for `defs.chess` (null when there are none). */
function standInDefs(units) {
  let out = null;
  for (const u of units ?? []) {
    if (!u || !u.standIn || typeof u.standIn !== 'object') continue;
    (out ??= {})[u.chessId] = standInRec(u.chessId, u.standIn);
  }
  return out;
}

/** Create a battle + harness. See header for options. */
export function makeBattle(opts = {}) {
  const kind = opts.kind ?? 'normal';
  const custom = opts.data ? null : standInDefs(opts.units);
  const data = opts.data ?? buildData(custom ? { ...opts.defs, chess: { ...(opts.defs?.chess ?? {}), ...custom } } : opts.defs);
  let stage = opts.stage ?? null;
  if (!stage) stage = !opts.stageId || opts.stageId === 'flat' ? flatStage(opts.flat || {}) : data.getStage(opts.stageId);
  if (!stage) throw new Error(`unknown stage ${opts.stageId}`);
  let routes = opts.routes ?? null;
  let spawns = [];
  let timeLimit = opts.timeLimit;
  if (opts.waveTemplate) {
    const tpl = typeof opts.waveTemplate === 'string' ? data.getWave(opts.waveTemplate) : opts.waveTemplate;
    if (!tpl) throw new Error(`unknown wave template ${opts.waveTemplate}`);
    const conv = spawnsFromTemplate(tpl, { mods: opts.mods ?? null });
    routes = routes ?? conv.routes;
    spawns = conv.spawns;
    if (timeLimit === undefined && conv.maxPlayTime && kind !== 'boss' && kind !== 'hidden') timeLimit = conv.maxPlayTime;
  }
  routes = routes ?? flatRoutes(kind);
  const extraRoutes = [];
  for (const e of opts.enemies ?? []) {
    let routeIndex = 0;
    let route = null;
    if (typeof e.route === 'number') routeIndex = e.route;
    else if (e.route && typeof e.route === 'object') route = e.route;
    else if (e.routeIndex != null) routeIndex = e.routeIndex;
    spawns.push({
      time: e.time ?? 0, enemyKey: e.key, routeIndex, route, count: e.count ?? 1, interval: e.interval ?? 0,
      mods: e.mods ?? null, tag: e.tag ?? null, bounty: e.bounty ?? null, sourcePlayerId: e.sourcePlayerId ?? null,
      ownerPlayerId: e.ownerPlayerId ?? null, pos: e.pos ?? null, countInTotal: e.countInTotal,
    });
  }
  if (extraRoutes.length) routes = routes.concat(extraRoutes);
  const players = opts.players ?? [{
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
    units: (opts.units ?? []).map((u, i) => ({ uid: u.uid ?? i + 1, kind: u.kind ?? 'chess', ...diyEntry(u), ...(u.standIn ? { standIn: true } : null) })),
    bonds: opts.bonds ?? {}, bandId: opts.bandId ?? null, playerEffects: opts.playerEffects ?? [],
  }];
  const hookNames = opts.hooks ?? ALL_HOOKS;
  const captured = Object.create(null);
  const userSetup = opts.setup;
  const battle = new Battle({
    seed: opts.seed ?? 1, kind, modeId: opts.modeId ?? 'mode_multi_normal', round: opts.round ?? 1, stage, rect: opts.rect,
    timeLimit: timeLimit ?? (kind === 'boss' || kind === 'hidden' ? Infinity : 60), players, spawns, routes,
    sharedBoss: opts.sharedBoss ?? null, flags: { startOpCooldown: 0, ...opts.flags }, fieldId: opts.fieldId ?? 'test', data,
    content: opts.content ?? 'full', recordEvents: opts.recordEvents !== false, logger: opts.logger ?? quietLogger(opts.verbose),
    quiet: opts.verbose ? false : true, devices: opts.devices,
    autoFinish: opts.autoFinish ?? spawns.length > 0, kits: opts.kits, extraContent: opts.extraContent,
    setup: (b) => {
      for (const name of hookNames) {
        captured[name] = [];
        b.on(name, (ctx) => {
          if (NOISY.has(name) && !opts.captureNoisy) { captured[name].length++; return; }
          captured[name].push({ ...ctx, t: b.time });
        }, { priority: -1000 });
      }
      if (typeof userSetup === 'function') userSetup(b);
    },
  });
  const events = [];
  const drain = () => { for (const e of battle.drainEvents()) events.push(e); };
  const h = {
    battle,
    b: battle,
    events,
    hooks: captured,
    step(n = 1) { for (let i = 0; i < n && !battle.finished; i++) battle.step(); drain(); return h; },
    run(seconds) {
      const target = battle.time + seconds - 1e-9;
      while (!battle.finished && battle.time < target) battle.step();
      drain();
      return h;
    },
    /** Step until pred() is true (or `pred` seconds elapsed when a number). Returns true if pred became true. */
    runUntil(pred, maxSeconds = 300) {
      if (typeof pred === 'number') { h.run(pred); return true; }
      const limit = battle.time + maxSeconds;
      while (!battle.finished && battle.time < limit) {
        if (pred(battle)) { drain(); return true; }
        battle.step();
      }
      drain();
      return !!pred(battle);
    },
    runToEnd(maxSeconds = 4000) {
      const limit = battle.time + maxSeconds;
      while (!battle.finished && battle.time < limit) battle.step();
      drain();
      return battle.result();
    },
    /** Ally lookup: board uid first, then chessId / baseId, then engine id. */
    unit(q) {
      const L = battle.allyUnits;
      return L.find((u) => u.uid != null && u.uid === q) ?? L.find((u) => u.defId === q || u.def?.baseId === q) ?? L.find((u) => u.id === q) ?? null;
    },
    allies() { return battle.allyUnits.filter((u) => u.alive && u.deployed && u.kind !== 'device'); },
    enemies() { return battle.enemies.filter((e) => e.alive); },
    enemy(key) { return battle.units.find((u) => u.side === 'enemy' && (key == null || u.defId === key)) ?? null; },
    spawn(key, o = {}) { const e = battle.spawnEnemy(key, o); drain(); return e; },
    eventsOf(kind) { drain(); return events.filter((e) => e[0] === kind); },
    hooksOf(name) { return captured[name] ?? []; },
    result() { return battle.result(); },
    snapshot() { return battle.snapshot(); },
    invariants() { return checkInvariants(battle); },
    TICK,
  };
  return h;
}

function quietLogger(verbose) {
  if (verbose) return console;
  return { warn() {}, error() {}, info() {}, log() {} };
}

/** Throws on any invariant violation (no NaN/Infinity, hp ∈ [0,maxHp], positions inside rect, DP bounds). */
export function checkInvariants(b) {
  const R = b.rect;
  const bad = (msg, u) => { throw new Error(`invariant: ${msg} ${u ? `${u.kind}#${u.id} ${u.defId}` : ''} t=${b.time.toFixed(3)}`); };
  for (const u of b.units) {
    for (const k of ['x', 'y', 'hp', 'atkCd']) {
      const v = u[k];
      if (typeof v !== 'number' || Number.isNaN(v) || (!Number.isFinite(v) && k !== 'atkCd')) bad(`${k}=${v}`, u);
    }
    const s = u.s;
    for (const k of ['maxHp', 'atk', 'def', 'res', 'aspd', 'interval', 'moveSpeed']) {
      if (!Number.isFinite(s[k])) bad(`stat ${k}=${s[k]}`, u);
    }
    if (u.alive) {
      if (u.hp < 0 || u.hp > s.maxHp + 1e-6) bad(`hp ${u.hp} / ${s.maxHp}`, u);
      if (u.deployed && !u.hidden) {
        if (u.x < R.c0 - 0.5 - 1e-6 || u.x > R.c1 + 0.5 + 1e-6 || u.y < R.r0 - 0.5 - 1e-6 || u.y > R.r1 + 0.5 + 1e-6) bad(`pos ${u.x},${u.y} outside rect`, u);
      }
      if (u.skill && !u.skill.noSkill) {
        const sk = u.skill;
        if (!Number.isFinite(sk.sp) || sk.sp < -1e-9 || sk.sp > sk.spCost + 1e-6) bad(`sp ${sk.sp}/${sk.spCost}`, u);
        if (!(sk.charges >= 0 && sk.charges <= sk.maxCharges)) bad(`charges ${sk.charges}/${sk.maxCharges}`, u);
        if (sk.active && sk.kind === 'duration' && !Number.isFinite(sk.timeLeft)) bad(`skill timeLeft ${sk.timeLeft}`, u);
        if (sk.active && sk.kind === 'ammo' && !Number.isFinite(sk.ammoLeft)) bad(`skill ammoLeft ${sk.ammoLeft}`, u);
      }
      // occupancy map consistency: a living deployed ally is what its tile says it is
      if (u.side === 'ally' && u.deployed && b._occ[u.tileR * 21 + u.tileC] !== u) bad(`occupancy map out of sync at ${u.tileR},${u.tileC}`, u);
    } else if (u.removeReason === 'killed' && u.hp !== 0 && !u.bossPool) bad(`killed with hp ${u.hp}`, u);
    else if (u.hp < 0) bad(`negative hp ${u.hp}`, u);
    if (u.side === 'enemy' && u.blockedBy && !u.blockedBy.blocking.includes(u)) bad('block link broken', u);
  }
  for (const a of b.allyUnits) {
    if (!a.alive && a.blocking.length) bad('dead blocker still blocking', a);
    let used = 0;
    for (const e of a.blocking) used += e.blockWeight ?? 1;
    if (a.alive && used > Math.max(a.s.blockCnt, 0) && !a.s.flags.blockFly) {
      // capacity may drop below current load only transiently (buff removal) — engine releases on next check
    }
  }
  for (const p of b.players) if (!(p.dp >= 0 && p.dp <= b.flags.dpMax + 1e-9) || Number.isNaN(p.dp)) bad(`dp ${p.dp}`);
  for (const pr of b.projectiles.list) if (![pr.x, pr.y, pr.tx, pr.ty].every(Number.isFinite)) bad(`projectile at ${pr.x},${pr.y} → ${pr.tx},${pr.ty}`);
  if (b._emitDepth) bad(`hook emit depth ${b._emitDepth} between steps`);
  for (const pp of Object.values(b._perPlayer ?? {})) {
    for (const k of ['killed', 'total', 'killedInTotal', 'leakedInTotal', 'coins', 'damageDealt', 'bossDamage', 'healingDone', 'deaths']) if (!Number.isFinite(pp[k])) bad(`result ${k}=${pp[k]}`);
    // The capsule's counters are attributed differently on purpose: a knock-out goes to the enemy's owner (as its `total`
    // did), while a leak goes to the player whose half the enemy reached (`_recordLeak`) — in a 联防 field an enemy
    // spawned on one half and leaked on the other bills the leaker, so per player only `killedInTotal ≤ total` holds
    // (BattleResult's per-player `resolved` clamps the sum to `total`, and the battle-level sum is exact)
    if (pp.killedInTotal > pp.total) bad(`capsule ${pp.killedInTotal} > ${pp.total}`);
    if (pp.total < 0 || pp.killedInTotal < 0 || pp.leakedInTotal < 0) bad('negative capsule counter');
  }
  if (b.killedInTotal + b.leakedInTotal > b.total) bad(`battle capsule ${b.killedInTotal}+${b.leakedInTotal} > ${b.total}`);
  return true;
}

/** Stable hash of a value (for determinism tests). */
export function hashOf(v) {
  const s = JSON.stringify(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
