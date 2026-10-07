// server/sim/Battle.js — one field simulation (normal / unite / boss / hidden). Public API: DESIGN §5.1.
//
//   const b = new Battle({ seed, kind, modeId, round, stage|stageId, rect, timeLimit, players, spawns, routes,
//                          sharedBoss, flags, fieldId?, data?, content?, recordEvents?, logger? })
//   b.step(); b.finished; b.forceEnd(reason); b.time; b.result(); b.snapshot(); b.drainEvents(); b.on/off(...)
//
// Construction creates every ally unit (undeployed) and installs content (kits + domain modules). The first
// step() (or an explicit start()) deploys everything (operators by column from the left, top to bottom within a
// column — mirrored for the right boss side —, then the summon pieces the same way — except a piece content flags
// `deferDeploy`, which waits on its tile; the players of a shared field side by side), fires `deploy` (initial) for
// each unit, forces out the operators that enter already knocked out (`carryState.down`, 联防: constants.js
// FORCED_EXIT — down on their tile, redeploy timer running) and then fires `battleStart`.
// An operator that left the field — knocked out, or forced out by its own effects (史尔特尔's 余烬 …, GitHub #60) — lies
// on its `body` tile — where it fell, or its own home when it fell on another board piece's home — and redeploys there;
// no ally deploys or moves onto that tile meanwhile (PRTS 卫戍协议/帮助 §作战阶段 单位部署; `isDown`, `_layBody`, `downOn`,
// `restTile`, `isReservedTile`; docs/SIM.md §1).
// Tick order: scheduled callbacks → spawns → DP → buffs → enemies (attack, move, block) → enemy index →
//   allies (skill tick, attack) → projectiles → redeploys → boss sync → `tick` hook → release hooks of removed units →
//   time += TICK → end checks. A forceEnd() requested mid-step ends the step after the current phase (docs/SIM.md §1.4).
// Board → field coordinates: units are given in board coordinates (rows 9–12, cols 2–10). Normal/unite:
//   (row, col + colOffset). Boss/hidden: row − 7 when row ≥ 7 (board rows → boss rows 2–5); side 'R' mirrors
//   the column (col → 20 − col) and mirrors the direction (RIGHT ↔ LEFT, UP / DOWN kept). Every ally has a direction
//   `dir` (UP|RIGHT|DOWN|LEFT, default RIGHT — PlayerBattleInput unit `dir`, sim/dir.js) that rotates its range grid.
//   `abs: true` on a unit (or player `coords: 'field'`) = field tiles (and field directions).
// Robustness: every content callback and every step phase is wrapped; errors are logged once per key and the
// battle continues. After MAX_INTERNAL_ERRORS the battle force-ends as a timeout.
//
// Code layout: this file keeps the constructor (fields, players, spawn queue, content install); the methods live in
// server/sim/battle/, one module per concern, and are installed on Battle.prototype below in a fixed order, with the
// descriptors of class methods (non-enumerable; `this` is the battle, subclasses and `super` calls work as before):
//   players.js       board → field tiles / directions, ally creation, kit / profile / skill setup
//   lifecycle.js     start (the battle-start deployment), step (the tick order above), end checks, BattleResult
//   hooks.js         hook bus (on / off / emit), timers (after / every), content-callback isolation and errors
//   spawns.js        spawn queue, routes, spawnEnemy; hidden enemies, boss pool sync, field clamp, list compaction
//   deploy.js        deploy, kill, retreat, removal bookkeeping, redeploys, leaks
//   blocking.js      contact blocking, block release, the 隐匿 switch-off after a block
//   status.js        buffs, catalogue statuses (抵抗, 寒冷 → 冻结, 诱导, 恐惧 …), "同名效果取最高", the buff tick
//   combat.js        damage / heal / HP loss (damage.js pipeline), projectiles, forced attacks
//   queries.js       enemy tile index, unit queries (tiles, grid, radius, selectability), players, range rebuilds
//   summons.js       tokens (summons), devices, stage devices
//   tiles.js         obstacles, relocation / 【移动】, knocked-out bodies, reserved tiles, tactical points, ground paths
//   displacement.js  push / pull / displace (受力等级 = force − weight); pushTiles
//   economy.js       DP, IN_BATTLE bond layers, bounty coins
//   events.js        client events, snapshot, field meta, fx, the sim log
//   util.js          fin / clone

import { TICK, ROWS, COLS, DP_DEFAULTS, MAX_HOOK_DEPTH, AUTO_OP_COOLDOWN } from './constants.js';
import { GEO } from '../../shared/constants.js';
import { createRng } from './rng.js';
import { Grid } from './grid.js';
import { ProjectileSystem } from './projectiles.js';
import { remainingDistance } from './ai.js';
import { toDataSource, normalizeRoute, normalizeStage } from './simdata.js';
import { installContent } from './content/index.js';
import { BattlePlayers } from './battle/players.js';
import { BattleLifecycle } from './battle/lifecycle.js';
import { BattleHooks } from './battle/hooks.js';
import { BattleSpawns } from './battle/spawns.js';
import { BattleDeploy } from './battle/deploy.js';
import { BattleBlocking } from './battle/blocking.js';
import { BattleStatus } from './battle/status.js';
import { BattleCombat } from './battle/combat.js';
import { BattleQueries } from './battle/queries.js';
import { BattleSummons } from './battle/summons.js';
import { BattleTiles } from './battle/tiles.js';
import { BattleDisplacement } from './battle/displacement.js';
import { BattleEconomy } from './battle/economy.js';
import { BattleEvents } from './battle/events.js';

export { pushTiles } from './battle/displacement.js';

const DEFAULT_RECTS = { normal: GEO.NORMAL_RECT, unite: GEO.UNITE_RECT, boss: GEO.BOSS_RECT, hidden: GEO.BOSS_RECT };

export class Battle {
  constructor(opts = {}) {
    this.opts = opts;
    this.seed = (Number(opts.seed) >>> 0) || 1;
    this.rng = createRng(this.seed);
    this.kind = opts.kind ?? 'normal';
    this.modeId = opts.modeId ?? null;
    this.round = opts.round ?? 0;
    this.fieldId = opts.fieldId ?? null;
    this.logger = opts.logger ?? console;
    this.recordEvents = opts.recordEvents !== false;
    /** When false the battle only ends by time limit / boss pool / forceEnd (tests, sandboxes). */
    this.autoFinish = opts.autoFinish !== false;
    this.data = toDataSource(opts.data);
    let stage = opts.stage ?? (opts.stageId ? this.data.getStage(opts.stageId) : null);
    if (stage && !stage._norm) stage = normalizeStage(stage.id ?? opts.stageId, stage);
    this.stage = stage || { id: 'empty', rows: [], devices: [] };
    this.stageId = this.stage.id ?? opts.stageId ?? null;
    this.rect = { ...(opts.rect ?? DEFAULT_RECTS[this.kind] ?? GEO.NORMAL_RECT) };
    { // a malformed rect (non-integers, inverted, off the stage) falls back to the kind's default field
      const R = this.rect;
      const ok = [R.r0, R.r1, R.c0, R.c1].every(Number.isInteger) && R.r0 >= 0 && R.c0 >= 0 && R.r1 < ROWS && R.c1 < COLS && R.r0 <= R.r1 && R.c0 <= R.c1;
      if (!ok) this.rect = { ...(DEFAULT_RECTS[this.kind] ?? GEO.NORMAL_RECT) };
    }
    this.grid = new Grid(this.stage, this.rect);
    const bossLike = this.kind === 'boss' || this.kind === 'hidden';
    // A bad limit (0, negative, NaN — e.g. a missing config row) must not turn a normal round into an endless one:
    // non-boss kinds fall back to 60 s; only boss/hidden (or an explicit Infinity) run without a limit.
    const tl = Number(opts.timeLimit);
    this.timeLimit = opts.timeLimit == null || !(tl > 0) ? (bossLike ? Infinity : 60) : tl;
    // startOpCooldown: the operation cooldown of the battle-start deployment (skills.js AUTO_OP_COOLDOWN)
    this.flags = { layerGainsEnabled: this.kind === 'normal', ...DP_DEFAULTS, startOpCooldown: AUTO_OP_COOLDOWN, ...(opts.flags || {}) };
    const soc = Number(this.flags.startOpCooldown);
    this.flags.startOpCooldown = this.flags.startOpCooldown != null && Number.isFinite(soc) && soc >= 0 ? soc : AUTO_OP_COOLDOWN;
    // DP knobs may arrive as undefined/null/strings (e.g. a template without `dp`): never let them poison DP with NaN.
    for (const k of ['dpInit', 'dpPerSec', 'dpMax']) {
      const v = Number(this.flags[k]);
      this.flags[k] = this.flags[k] != null && Number.isFinite(v) && v >= 0 ? v : DP_DEFAULTS[k];
    }
    this.sharedBoss = opts.sharedBoss ?? null;
    this.routes = (opts.routes ?? []).map((r) => normalizeRoute(r));
    /** Per-template enemy overrides `{ [enemyKey]: { stats: {…partial} } }` (waves.json `overrides`). */
    this.enemyOverrides = opts.enemyOverrides ?? {};
    this.dt = TICK;
    this.time = 0;
    this.tickCount = 0;
    this.finished = false;
    this.reason = null;
    this.started = false;
    this._startDeploying = false;
    /** @type {import('./units.js').Unit[]} every unit ever created */
    this.units = [];
    /** @type {import('./units.js').Unit[]} alive enemies (compacted each tick) */
    this.enemies = [];
    /** @type {import('./units.js').Unit[]} every ally unit (ops, tokens, devices; dead included) */
    this.allyUnits = [];
    this._hooks = Object.create(null);
    this._emitDepth = 0;
    this._frameName = new Array(MAX_HOOK_DEPTH).fill(null);   // open hook/callback frames (diagnostics, _chain)
    this._frameOwner = new Array(MAX_HOOK_DEPTH).fill(null);
    this._frameCtx = new Array(MAX_HOOK_DEPTH).fill(null);
    this._toRelease = [];   // permanently removed units whose hooks / periodic timers are dropped at step end
    this._sched = [];
    this._evq = [];
    this.projectiles = new ProjectileSystem(this);
    this._occ = new Array(ROWS * COLS).fill(null);
    this._eb = new Array(ROWS * COLS);
    for (let i = 0; i < this._eb.length; i++) this._eb[i] = [];
    this._ebUsed = [];
    this._idSeq = 0;
    this._attackSeq = 0;   // DamageInfo.attackId of normal attacks (one id per attack, all its damage instances)
    this._deploySeq = 0;
    this._spawnSeq = 0;
    this._enemiesDirty = false;
    this.killed = 0;
    this.total = 0;
    this.leakedCount = 0;
    // The HUD capsule's own counters (DESIGN §14, PR #157 semantics): only the enemies the field itself scheduled
    // (`inTotal`, spawns.js `_queueSpawn` — `total` is their denominator) count here. `killed` / `leakedCount` above keep
    // the official LP / 完美作战 reading: every `counted` enemy, runtime splits and summons included.
    this.killedInTotal = 0;
    this.leakedInTotal = 0;
    this.errors = [];
    this.errorCount = 0;
    this._errKeys = new Set();
    this._result = null;
    this._skills = { onDamaged: (u) => { if (u.skill) u.skill.onDamaged(); } };
    this.remainingDistance = (e) => remainingDistance(this, e);

    // ---- players
    this.players = [];
    this._perPlayer = Object.create(null);
    for (const p of opts.players ?? []) if (p && typeof p === 'object') this._addPlayer(p);

    // ---- spawns
    this._pending = [];
    for (const s of opts.spawns ?? []) if (s && typeof s === 'object') this._safe(() => this._queueSpawn(s, true), 'queueSpawn');
    this._pending.sort((a, b) => a.time - b.time || a.seq - b.seq);

    // ---- content
    this.contentMode = opts.content ?? 'full';
    this._safe(() => installContent(this, { mode: this.contentMode, extra: opts.extraContent }), 'installContent');
    for (const u of this.allyUnits) if (!u.kit) this._setupUnit(u);
    if (typeof opts.setup === 'function') this._safe(() => opts.setup(this), 'opts.setup');
  }

  /**
   * The HUD capsule's numerator (DESIGN §14): the field's own scheduled enemies (`inTotal`) that are 已解决 — knocked
   * down (`killedInTotal`) or leaked (`leakedInTotal`) — never above the denominator `total`. The official reading:
   * 开局 0/3 → 漏一个 1/3 → 打死一个 2/3 → 打死会分裂的 3/3; a leaked split child still costs LP (`leakedCount`) and breaks
   * 完美作战, but it is no enemy of the stage's own list and moves no capsule number.
   */
  get resolved() {
    return Math.min(this.total, this.killedInTotal + this.leakedInTotal);
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Battle<${this.kind} seed=${this.seed} t=${this.time.toFixed(2)} units=${this.units.length}${this.finished ? ' ' + this.reason : ''}>`;
  }
}

// the method modules, in this order (a name defined twice is an error, never a silent override)
for (const part of [BattlePlayers, BattleLifecycle, BattleHooks, BattleSpawns, BattleDeploy, BattleBlocking, BattleStatus, BattleCombat, BattleQueries, BattleSummons, BattleTiles, BattleDisplacement, BattleEconomy, BattleEvents]) {
  for (const key of Reflect.ownKeys(part.prototype)) {
    if (key === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Battle.prototype, key)) throw new Error(`Battle.${String(key)} is defined twice`);
    Object.defineProperty(Battle.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
  }
}

export default Battle;
