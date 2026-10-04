// server/match/Match.js — the match & meta engine: state machine, timers, round loop, co-op orchestration,
// broadcasting views (DESIGN §6, §8). Rules are documented in the module headers of ./PlayerState.js, ./pool.js,
// ./board.js, ./bondsMeta.js, ./effectsMeta.js, ./choices.js, ./waves.js, ./unite.js, ./finalAssault.js,
// ./results.js, ./bot.js and in docs/META.md.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// MATCH INTERFACE (platform contract: server/lobby.js ⇄ server/match/Match.js)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// new Match(opts)
//   opts.roomCode    string                     4-letter room code (logging only)
//   opts.mode        'solo' | 'coop'
//   opts.difficulty  'FUNNY'|'NORMAL'|'HARD'|'ABYSS'
//   opts.modeId      string                     modeIdFor(mode, difficulty), e.g. 'mode_multi_hard'
//   opts.seats       Array<{ seat: 0..3, playerId: string, name: string, isBot: boolean, connected: boolean,
//                            loadout?: { [baseChessId]: { skill: index, module: uniEquipId|'none'|null } } | null }>
//                    sorted by seat, 1–4 entries, ≥ 1 human; solo ⇒ exactly 1 human and no bots.
//                    Bot playerIds start with 'ai_'. Seat indexes may have gaps (e.g. seats 0 and 2).
//                    `loadout` (DESIGN §16, optional): the human's operator loadout, already checked by the lobby
//                    (shared/protocol.js checkLoadout); PlayerState re-checks it against opts.data and ignores it for bots.
//   opts.spectators  string[] (optional)        the room's spectator seats (remake feature, community report #26;
//                                              server/lobby.js): never players — see addSpectator below
//   opts.seed        uint32                     master seed for all match randomness
//   opts.matchNo     integer ≥ 1 (optional)     the room's match number (lobby: room.matchCount + 1); with the seed it
//                                              makes this match's battleIds unique within the room (DESIGN §14)
//   opts.data        frozen game data (server/data.js getData()); may lack keys while data is generated
//   opts.log         { info, warn, error, debug }
//   opts.now         () => ms epoch             injectable clock (Date.now in production)
//   opts.send(playerId, msg) → boolean          unicast; never throws; silently drops for bots, disconnected
//                                              or departed players (they get a full resync on reconnect).
//                                              `b.snap` frames may be dropped under backpressure.
//   opts.broadcast(msg) → void                  to every connected, non-departed human of the room.
//   opts.onEnd(summary) → void                  call EXACTLY ONCE when the match is over, after m.result was
//                                              sent. The platform then (synchronously) returns the room to
//                                              LOBBY and (asynchronously, next macrotask) calls dispose().
//                                              `summary` is free-form JSON (kept as room.lastSummary).
//
// start()                   Called once, right after construction. Must broadcast the first m.public and send
//                           each human its m.private. May call onEnd synchronously (the platform copes).
// handle(playerId, msg)     A validated 'g.*' intent or client-side combat report 'b.progress' / 'b.result'
//                           (msg passed validateC2S; never 'g.leave', which the
//   → { ok: true }          platform turns into onLeave). Return { error: ERR code (shared/constants.js),
//   | { error, detail? }    detail?: string } to reject. Must not throw (if it does, the platform logs and
//                           replies ERR.INTERNAL). Replies ('ok'/'error' with rid) are sent by the platform.
// onDisconnect(playerId)    A human's socket dropped. The seat is kept; apply the auto-play policy.
// onReconnect(playerId)     The human is back (new socket with its token) or re-sent hello on a live socket
//                           (a resync request). May be called without a preceding onDisconnect. Resend full
//                           state: m.public, m.private and, if a battle is on (client-side combat), the
//                           b.start of the field the player is on / watching (server-run mode: m.field + b.snap).
// setLoadout(playerId, loadout) → { ok } | { error, detail? }   (DESIGN §16; optional for the platform) a new checked
//                           operator loadout from room.loadout. Accepted only during INFO_CHECK (the briefing's
//                           干员调配 entry); afterwards the match's loadout is locked (WRONG_PHASE).
// onLeave(playerId)         The human quit permanently (g.leave, room.leave, or the 10-minute reconnect
//                           window expired). They will never return under this playerId in this match;
//                           treat as quit (AI takes over / eliminated per DESIGN). No onDisconnect follows.
// dispose()                 Stop every timer/interval and release resources. Idempotent. After dispose the
//                           platform ignores send/broadcast/onEnd from this instance.
// addSpectator(id)          (optional for the platform) A spectator seat joined during the match, came back or asked
//                           for a resync: register it (idempotent) and resend what an ELIMINATED player watching sees —
//                           m.public and, while a battle runs, the b.start (watch) of the field it watches (default: the
//                           first field; server-run mode: m.field + b.snap), or m.result once ended. A spectator gets
//                           every broadcast through the platform, never an m.private / m.toast / m.unitStats, is never
//                           a field's player or authority, and is shown fields like an eliminated player in every phase.
//                           handle(id, msg) answers only its 'g.watch' (anything else → SPECTATOR; the platform routes
//                           nothing else of it).
// removeSpectator(id)       The spectator left (room.leave / g.leave, removed by the host, reconnect window expired).
//
// Bot seats never produce intents or hooks: the match drives bots itself (server/match/bot.js).
// Messages the match emits are the S2C 'm.*' / 'b.*' frames of DESIGN §8.2 (room.* frames are platform-owned).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Client-side combat (DESIGN §14; the default): every battle is described by a JSON BattleSpec (server/sim/spec.js).
// A normal field's owner (a connected human) simulates it in the browser and reports b.progress / b.result; a 联防 or
// boss pair field is simulated by its lowest-seat connected human (the other humans run display-only replicas).
// Bots, departed / disconnected players and fields without a connected human are simulated by the server: normal and
// 联防 fields headlessly at once (the result is released at the battle's natural end for the teammates' progress UI),
// boss fields in real time without snapshots (they share the pool). A silent authority (deadline = time limit + 15 s)
// or a disconnected one loses the field to the server, which re-simulates the spec; an implausible b.result is
// replaced by the server's own simulation (fields.js validateClientResult). The shared boss pool, the team LP and the
// overtime drain live here (b.pool ≤ 4 Hz, b.end; m.public follows a boss fight at ~1 Hz); the first end condition the
// server registers decides the Final Assault (pool 0 → victory, team LP 0 → defeat; nothing reported after a defeat is
// credited — _finalEnding, user playtest #6 item 5). No b.snap / b.ev is sent in
// this mode; g.watch hands out specs. battleIds are `<seed36>[-<matchNo36>].<round>.<seq>[.<fieldId>]` (≤ 64 chars):
// unique across the matches of a room, so a report that crossed into the next match is ignored like any stale one; a
// duplicate b.result (a browser re-sending one it believes lost) is answered ok and changes nothing.
// Solo pause (g.pause { on }, setPause): freezes the field clocks, result deadlines, server release timers, the boss
// clock and the server pacers; m.public.paused; resume shifts every clock / deadline by the pause.
// Live LP (user playtest #3 item 2): during COMBAT / 联防 m.public players[].pendingLp = min(lpCapPerRound, the counted
// leaks of the player's own battle so far) (_pendingLpView; omitted when 0) — the teammates' rows of the team panel
// show lp − pendingLp; the settlement lands with the SETTLE view, where it is gone. 联防 (user playtest #6 item 7): a
// leaker's players[].uniteLeft = its enemies still standing on the 联防 field (not spawned yet, alive, or through again;
// uncapped, live: the authority's b.progress `left`, the server-run timeline or battle; exact once the field has its
// result — _uniteLeft) and pendingLp = min(lpCapPerRound, uniteLeft): the counter falls as the helpers kill them (and
// rises when one of them splits or summons — the children are billed to the same leaker).
// User playtest #4: a match with a single human (独立模拟, or a 同盟 room started alone / with AI teammates) times no
// phase outside its battles (soloUntimed); the co-op strategy draft has ONE countdown — BAND_TURN_SECONDS per turn,
// published as m.public.deadline — AI seats pick at once and a turn that runs out takes the highlighted strategy
// (g.bandFocus → timeoutBand); g.unitStats answers m.unitStats: the stats the board's units start their next battle with.
//   opts.clientCombat  default true (env SP_COMBAT=server → false: the legacy server-run + snapshot streaming mode)
//   opts.verify        'off' | 'sample' | 'all' (env SP_VERIFY, default 'off'): re-simulate accepted client results
//                      ('sample': ~1 in 8, in a later callback, mismatches logged; 'all': before accepting — the
//                      server's result wins on a mismatch)
//
// Engine-only extra options (tests / tools; the lobby never passes them):
//   opts.scheduler     RealScheduler (default, uses opts.now) | VirtualScheduler (./scheduler.js)
//   opts.registry      MetaRegistry (default: built-ins + content, ./effectsMeta.js getDefaultRegistry())
//   opts.BattleClass   Battle implementation (default server/sim/Battle.js; tests inject test/match/fakeBattle.js)
//   opts.battleContent 'full' | 'generic' | 'none' (sim content mode, default 'full')
//   opts.timerScale    multiplier on every real-time phase timer (default 1)
//   opts.combatSpeed   game seconds per real second while battles run in real time (default 2, the forced 2×)
//   opts.botRehearsal  candidate layouts a bot simulates per prep before placing (default 3, 0 = heuristic only;
//                      a whole battle per candidate: ~20–300 ms of CPU each, see server/match/bot.js createRehearsal)
//   opts.botSliceMs    wall-clock ms of rehearsal per scheduler callback (default 8 with a real scheduler, unbounded
//                      with a virtual one); the rest runs in later callbacks (scheduleBotPrep)
//   opts.headlessSliceMs  wall-clock ms per callback of a server-run normal / 联防 field (client-side combat: bots,
//                      takeovers; default 8 with a real scheduler, at once with a virtual one)
// Seats may be all bots (tools/matchrun.mjs); the lobby always has ≥ 1 human.
//
// Diagnostics: m.errors / m.errorCount (engine), m.dispatcher.errors / .errorsByKey (meta handlers), m.simErrors
// (count reported by battle results) and m.simErrorLog (Map key → { label, who, message, stack, battles, count }
// of the unique errors each finished battle recorded in battle.errors). tools/matchrun.mjs --errors prints them.
//
// Disconnect / leave policy (research 06 §10.3 + DESIGN §6.6):
//   * disconnected human: the seat keeps playing its last lineup; draft turns and prep auto-resolve at their
//     deadlines (band → 华法琳, 机变 → a random remaining card, prep → auto-ready with temp auto-resolved). Nothing is
//     bought for them unless they toggled "AI 托管" (g.autoplay { on: true }), which lets the bot play the seat.
//   * departed human (onLeave): 中途退出 counts as elimination (research 00-INDEX §3, 01 §9, 06 §7 / §10.3) — every
//     copy the seat holds returns to the shared pool at once, the seat leaves the round loop, the Final Assault
//     pairing and the boss pool; its own running normal battle is force-ended. The seat shows status 'left'. When no
//     human is left at all the match ends ('abandoned'); when nobody alive is left it ends as 'eliminated'.

import { C2S, unitStatsEntry } from '../../shared/protocol.js';
import { PHASE, ERR, EMOTES, EMOTE_COOLDOWN_MS, GEO, modeIdFor, layerGainRoom } from '../../shared/constants.js';
import { Battle } from '../sim/Battle.js';
import { DataSource } from '../sim/simdata.js';
import { createRng, deriveSeed } from '../sim/rng.js';
import { GameData } from './gamedata.js';
import { RealScheduler } from './scheduler.js';
import { SharedPool, drawDisabledBonds } from './pool.js';
import { PlayerState } from './PlayerState.js';
import { buildDeployMap, boardOrder, pieceDir } from './board.js';
import { bondList, offBondCounts } from './bondsMeta.js';
import { EffectDispatcher, getDefaultRegistry } from './effectsMeta.js';
import { generateDraft, applyCard, cardView, bountyBattles, isMultiRoundBounty } from './choices.js';
import { setupMatchWaves, buildNormalWave, buildBossWave, bountySpawns, withBounties, previewOf, weightedPick } from './waves.js';
import { planUnite, uniteBattleOpts, uniteSurvivors } from './unite.js';
import { pairPlayers, bossPoolHp, SharedBossPool, hiddenEligible, BOSS_HIT_STEPS } from './finalAssault.js';
import {
  FieldRunner, DeadBattle, GAME_SPEED, snapFrame, runHeadless, timelineAt, HeadlessPacer, syntheticResult,
  validateClientResult, RESULT_GRACE_MS, BOSS_SILENCE_MS, HARD_CAP_SECONDS, HeadlessJob, HEADLESS_SLICE_MS, CATCHUP_TICKS_PER_INTERVAL,
  uniteBillBounds,
} from './fields.js';
import { buildBattleSpec, createBattleFromSpec, resultDigest, compactResult as compactForVerify, battleProgress, uniteLeft } from '../sim/spec.js';
import { CreditPool } from './finalAssault.js';
import { buildResult } from './results.js';
import { botPrepBeginSteps, botPrepEndSteps, botPickBand, botPickCard } from './bot.js';

const BOT_REHEARSAL_DEFAULT = 3;
/** Wall-clock ms of bot layout rehearsal per scheduler callback (real time; virtual time runs it in one go). */
const BOT_SLICE_MS = 8;
/**
 * Ticker priority of the remake's match-flow notices (隐秘核心已解锁, 联防阶段, a player out or gone): the official lines
 * (research 06 §9.2) go BOSS_HIT 30 > CHAR_DAMAGE 20 > SHOP_LEVEL 11 > GOLDEN_CHAR 2 > CHAR_GIFT 1; ours sit under the
 * leader-damage lines [ASSUMED].
 */
export const FLOW_TICKER_PRIORITY = 25;
const GAME_TYPES = new Set(Object.keys(C2S).filter((t) => Object.hasOwn(C2S, t) && (t.startsWith('g.') || t.startsWith('b.'))));
const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);
/** Default combat mode: client-side unless SP_COMBAT=server. */
const envClientCombat = () => String(env('SP_COMBAT') || '').toLowerCase() !== 'server';
/** SP_VERIFY → 'off' | 'sample' | 'all'. */
export function parseVerify(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'all' || s === 'sample' ? s : 'off';
}
/** b.pool broadcasts at most this often (ms). */
const POOL_MIN_GAP_MS = 250;
/** Boss clock period (overtime drain, end checks, silence watchdog) in real ms. */
const BOSS_CLOCK_MS = 250;
/**
 * Final Assault / Hidden Core under client-side combat: m.public (boss HP, team LP, field progress) at most this often
 * (ms) — b.pool (≤ 4 Hz) already carries the exact pool / team LP, so a boss b.progress never re-marks the whole
 * public state.
 */
const BOSS_PUBLIC_MS = 1000;
/** How long the match waits for a boss field's b.result after it forced the end (real ms, × timerScale). */
const BOSS_RESULT_GRACE_MS = 6000;
/**
 * Plausibility of a boss field's client reports (b.progress bossDmg / leaks, the b.result damage), on the SERVER's
 * field clock — so no single frame decides the Final Assault: the credited pool damage of one field stays ≤ the whole
 * pool per BOSS_MIN_CLEAR_GS game seconds (20 % of the pool per game second; the balance model's fastest mean kills
 * take ≈ 18–20 s at ≈ 5 %/s per field, docs/BALANCE.md §3), the credited LP cost ≤ BOSS_LP_BURST + BOSS_LP_PER_GS per
 * game second (a leader's "扣除所有目标生命" comes after ≥ 200 s). Reports are cumulative: what exceeds the budget is
 * credited later as the budget grows (the boss clock re-applies the latest report), never lost — a 'cleared' b.result
 * whose report covers the pool waits for it too (`heldResult`; 999-layer kills take 2–4 game s), it is not handed over.
 */
const BOSS_MIN_CLEAR_GS = 5;
const BOSS_LP_BURST = 10;
const BOSS_LP_PER_GS = 1;
const OK = Object.freeze({ ok: true });
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
const fail = (error, detail) => (detail ? { error, detail } : { error });

/** Fixed presentation delays (real ms, × timerScale). */
export const DELAYS = Object.freeze({
  ROUND_START: 2000,
  COMBAT_END: 1500,
  SETTLE: 3000,
  BOT_ACTION: 900,
  BOT_STAGGER: 350,
  PUBLIC_THROTTLE: 100,
});

/**
 * Seconds of one turn of the co-op strategy draft (user playtest #4 item 4: the old 12 s per turn — research 06 §724,
 * itself [ASSUMED] — inside the 50 s step was far too little and counted apart from the header's 50 s). [ASSUMED]: the
 * official data only gives the whole BAND_CHECK step (autoChessData.enterStepList: 50 s, hint 15 s); the turn clock is
 * the remake's. It is also the step's only countdown (m.public.deadline = draft.turnDeadline). × timerScale.
 */
export const BAND_TURN_SECONDS = 30;

const dsCache = new WeakMap();
function dataSourceFor(data) {
  if (!data || typeof data !== 'object' || !data.chess) return undefined;
  let ds = dsCache.get(data);
  if (!ds) { ds = new DataSource(data, null); dsCache.set(data, ds); }
  return ds;
}

export class Match {
  /** @param {object} opts see MATCH INTERFACE above */
  constructor(opts) {
    if (!opts || !Array.isArray(opts.seats) || opts.seats.length === 0) throw new TypeError('Match: seats required');
    if (typeof opts.send !== 'function' || typeof opts.broadcast !== 'function' || typeof opts.onEnd !== 'function') {
      throw new TypeError('Match: send/broadcast/onEnd callbacks required');
    }
    this.opts = opts;
    this.roomCode = opts.roomCode ?? '----';
    this.mode = opts.mode === 'solo' ? 'solo' : 'coop';
    this.difficulty = opts.difficulty;
    this.modeId = opts.modeId || modeIdFor(this.mode, opts.difficulty);
    this.seed = (Number(opts.seed) >>> 0) || 1;
    this.log = opts.log || noopLog;
    this.sendFn = opts.send;
    this.broadcastFn = opts.broadcast;
    this.onEndFn = opts.onEnd;
    this.data = opts.data && typeof opts.data === 'object' ? opts.data : {};
    this.gd = new GameData(this.data, this.modeId);
    if (!this.difficulty) this.difficulty = this.gd.difficulty;
    this.isSolo = this.mode === 'solo' || this.gd.isSolo;
    this.ownsScheduler = !opts.scheduler;
    this.sched = opts.scheduler || new RealScheduler({ now: opts.now || Date.now, onError: (e) => this.reportError('timer', e) });
    this.registry = opts.registry || getDefaultRegistry();
    this.dispatcher = new EffectDispatcher(this, this.registry);
    this.BattleClass = typeof opts.BattleClass === 'function' ? opts.BattleClass : Battle;
    this.battleContent = opts.battleContent || 'full';
    this.timerScale = Number.isFinite(opts.timerScale) && opts.timerScale >= 0 ? opts.timerScale : 1;
    this.gameSpeed = Number.isFinite(opts.combatSpeed) && opts.combatSpeed > 0 ? Math.min(opts.combatSpeed, 200) : GAME_SPEED;
    /** layouts a bot rehearses per prep with the real simulation (bot.js; 0 = heuristic placement only) */
    this.botRehearsal = Number.isInteger(opts.botRehearsal) && opts.botRehearsal >= 0 ? Math.min(opts.botRehearsal, 8) : BOT_REHEARSAL_DEFAULT;
    /** wall-clock budget of one rehearsal slice (scheduleBotPrep) */
    this.botSliceMs = Number.isFinite(opts.botSliceMs) && opts.botSliceMs > 0 ? opts.botSliceMs : this.sched.virtual ? Infinity : BOT_SLICE_MS;
    this.ds = dataSourceFor(this.data);
    /** client-side combat (DESIGN §14) — see the header */
    this.clientCombat = opts.clientCombat != null ? !!opts.clientCombat : envClientCombat();
    this.verifyMode = parseVerify(opts.verify ?? env('SP_VERIFY'));
    /** wall-clock ms per slice of a server-run normal / 联防 field (virtual time: at once) */
    this.headlessSliceMs = Number.isFinite(opts.headlessSliceMs) && opts.headlessSliceMs > 0 ? opts.headlessSliceMs : this.sched.virtual ? Infinity : HEADLESS_SLICE_MS;
    this.verifyStats = { checked: 0, mismatches: 0, rejected: 0, takeovers: 0 };
    this._battleSeq = 0;
    /** solo pause (g.pause, DESIGN §14): the field clocks / deadlines are frozen while true (m.public.paused) */
    this.paused = false;
    this._pausedAt = 0;
    /** real ms spent paused this match (diagnostics) */
    this.pausedMs = 0;
    /** boss rounds (client-side combat): the throttled m.public refresh (_bossPublic) */
    this._bossPubTimer = null;
    this._bossPubAt = -Infinity;
    this._bossClockOn = false;
    /**
     * battleId prefix (DESIGN §14): the seed (+ the room's match number) — a b.progress / b.result that crossed into the
     * next match of the room (the same socket, the same field ids) never names a battle of this match.
     */
    this.battlePrefix = `${this.seed.toString(36)}${Number.isInteger(opts.matchNo) && opts.matchNo > 0 ? `-${opts.matchNo.toString(36)}` : ''}`;
    this._progressTimer = null;
    this._bossClock = null;
    this._lastPoolAt = -Infinity;
    this._poolTimer = null;
    this._lastPoolKey = '';
    this.pacer = null;

    const rng = (name) => createRng(deriveSeed(this.seed, name));
    this.rngSetup = rng('setup');
    this.rngShop = rng('shop');
    this.rngWaves = rng('waves');
    this.rngDraft = rng('draft');
    this.rngBots = rng('bots');
    this.rngMeta = rng('meta');

    /** @type {Map<string, PlayerState>} */
    this.players = new Map();
    const seen = new Set();
    for (const s of opts.seats) {
      if (!s || typeof s.playerId !== 'string' || seen.has(s.playerId)) continue;
      seen.add(s.playerId);
      this.players.set(s.playerId, new PlayerState(this, s));
    }
    if (!this.players.size) throw new TypeError('Match: seats required');
    this.order = [...this.players.values()].sort((a, b) => a.seat - b.seat);
    /**
     * Spectator seats (opts.spectators / addSpectator): playerId → a stand-in every watch path treats like an eliminated
     * human (alive false; no PlayerState, never a field's player or authority).
     * @type {Map<string, { playerId: string, isBot: false, left: false, alive: false, connected: true, spectator: true }>}
     */
    this.spectators = new Map();
    for (const id of Array.isArray(opts.spectators) ? opts.spectators : []) this._spectator(id);
    /**
     * Exactly one human seat at the start (独立模拟, or a 同盟 room started alone / with AI teammates only): nobody waits
     * on anybody, so no phase outside a battle is timed — soloUntimed (user playtest #4 item 3). The mode's own rules
     * (draft order and skip, 6 机变 cards, 联防 …) stay.
     */
    this.loneHuman = this.order.filter((p) => !p.isBot).length === 1;

    // per-match setup (DESIGN §6.5)
    const setup = setupMatchWaves(this.gd, this.rngSetup);
    this.stageId = setup.stageId;
    this.stage = this.stageId ? this.gd.stage(this.stageId) : null;
    this.factions = setup.factions;
    this.bossId = setup.bossId;
    this.hiddenBossId = setup.hiddenBossId;
    const bans = drawDisabledBonds(this.gd, this.rngSetup);
    this.disabledBonds = bans.drawn;
    this.staticInactiveBonds = bans.staticOff;
    this.bannedChess = bans.banned;
    this.pool = new SharedPool(this.gd, { banned: bans.banned });

    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.deadline = 0;
    /** Final Assault / Hidden Core: ms epoch when the overtime drain starts (m.public.overtimeAt) */
    this.overtimeAt = 0;
    this.uidSeq = 0;
    this.ended = false;
    this.disposed = false;
    this.startedAt = this.sched.now();
    /** @type {Set<any>} */
    this._timers = new Set();
    this._phaseTimer = null;
    this._turnTimer = null;
    this._pubDirty = false;
    this._pubTimer = null;
    this._lastPubAt = -Infinity;
    this._lastPubJson = '';
    /** @type {Set<PlayerState>} */
    this._privDirty = new Set();
    this.errors = [];
    this.errorCount = 0;
    this.simErrors = 0;
    /** @type {Map<string, { label: string, who: string, message: string, stack: string|null, battles: number, count: number }>} */
    this.simErrorLog = new Map();
    this._prepEndQueued = false;

    this.draft = null;
    this.sp = null;
    this.wave = null;
    this.bossWaves = null;
    this.fields = [];
    this.runner = null;
    /** playerId → fieldId */
    this.watchers = new Map();
    this.lastResults = new Map();
    this.unitePlan = null;
    /** server-run 联防: the leakers' counts last published (_uniteTick) */
    this._uniteLeftKey = null;
    /** 联防: { plan, bounds } — per leaker the most survivors settlement can bill (_uniteLeft's clamp) */
    this._uniteBounds = null;
    this.teamLp = null;
    this.bossPool = null;
    this.hiddenLayerSum = 0;
    this.hiddenReached = false;
    this.outcome = null;
    this._turnToken = 0;
  }

  // ===================================================================================================
  // platform interface

  start() {
    if (this.disposed || this.ended || this.phase !== PHASE.LOBBY) return;
    this.guard(() => {
      if (!this.gd.visibleChess.length || this.pool.entries.size === 0) {
        this.log.error?.(`[match ${this.roomCode}] game data unusable (no chess pool) — ending the match`);
        this.phase = PHASE.INFO_CHECK;
        this.markPublic();
        this.flush(true);
        this.finish({ victory: false, reason: 'error' });
        return;
      }
      this.enterInfoCheck();
    });
  }

  /**
   * @param {string} playerId
   * @param {{ t: string }} msg validated intent
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  handle(playerId, msg) {
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    if (!ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    // a spectator seat only watches (the platform routes nothing else of it)
    if (ps.spectator && (!msg || msg.t !== 'g.watch')) return fail(ERR.SPECTATOR);
    if (this.disposed || this.ended) {
      // a battle report that crossed the match end (the last b.progress of a field) is stale: ignored, never an error
      // (DESIGN §14 — an error frame without a rid would surface as a toast in the browser)
      return this.clientCombat && msg && (msg.t === 'b.progress' || msg.t === 'b.result') ? OK : fail(ERR.WRONG_PHASE);
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string' || !GAME_TYPES.has(msg.t)) return fail(ERR.BAD_MSG);
    let res;
    try {
      res = this._handle(ps, msg);
    } catch (e) {
      this.reportError(`handle ${msg.t}`, e);
      res = fail(ERR.INTERNAL);
    }
    try { this.flush(); } catch (e) { this.reportError('flush', e); }
    if (res && typeof res === 'object' && res.error) return res;
    return OK;
  }

  /**
   * room.loadout during the match (DESIGN §16): only while INFO_CHECK runs (the briefing's 干员调配 entry); the lobby
   * already checked it against the data (PlayerState.setLoadout re-checks it).
   * @param {string} playerId
   * @param {Record<string, { skill: number, module: string|null }> | null} loadout
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  setLoadout(playerId, loadout) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    if (this.disposed || this.ended || this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE, 'loadout locked for this match');
    let res = OK;
    this.guard(() => {
      if (!ps.setLoadout(loadout)) { res = fail(ERR.BAD_TARGET, 'loadout does not match the game data'); return; }
      this.markPrivate(ps);
    });
    return res;
  }

  onDisconnect(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || this.disposed) return;
    this.guard(() => {
      ps.connected = false;
      // a paused solo battle resumes (the server takes the field over; nobody is left to resume it)
      this._resume();
      if (this.clientCombat) this._authorityLost(ps, 'disconnect');
      this.markPublic();
    });
  }

  onReconnect(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || this.disposed) return;
    this.guard(() => {
      const was = ps.connected;
      ps.connected = true;
      this._resync(ps);
      if (!was) this.markPublic();
    });
  }

  /**
   * The full state of one human (a reconnect, a resync, a spectator seat): m.public, its m.private (players only), the
   * field it is on / watches — a spectator, like an eliminated player, the first field — or the result once ended.
   */
  _resync(ps) {
    const playerId = ps.playerId;
    this.sendTo(playerId, this.publicView());
    if (!this.ended) {
      if (!ps.spectator) {
        ps._lastPriv = null;
        this._sendPrivate(ps, true);
      }
      if (this.clientCombat) this._resendBattle(ps);
      else {
        let fid = this.watchers.get(playerId);
        if (!fid && ps.spectator && this.fields.length) { fid = this.fields[0].fieldId; this.watchers.set(playerId, fid); }
        if (fid) this._sendField(playerId, fid);
      }
    } else if (this.lastResultMsg) {
      this.sendTo(playerId, { ...this.lastResultMsg, playerId });
    }
  }

  /**
   * A spectator seat (community report #26; server/lobby.js spectate) joined during the match, came back or asked for a
   * resync: registered once, then resent what an eliminated player watching sees (_resync — never an m.private).
   */
  addSpectator(playerId) {
    if (this.disposed) return;
    const s = this._spectator(playerId);
    if (s) this.guard(() => this._resync(s));
  }

  /** The spectator left (room.leave / g.leave, removed by the host, reconnect window expired). */
  removeSpectator(playerId) {
    if (this.spectators.delete(playerId)) this.watchers.delete(playerId);
  }

  /** The stand-in of a spectator seat, created once (null for a player's id or a bad id). */
  _spectator(playerId) {
    if (typeof playerId !== 'string' || !playerId || this.players.has(playerId)) return null;
    let s = this.spectators.get(playerId);
    if (!s) {
      s = Object.freeze({ playerId, isBot: false, left: false, alive: false, connected: true, spectator: true });
      this.spectators.set(playerId, s);
    }
    return s;
  }

  /** Everyone shown fields: the seated humans still in (seat order), then the spectator seats' stand-ins. */
  _viewers() {
    const out = this.order.filter((ps) => !ps.isBot && !ps.left);
    for (const s of this.spectators.values()) out.push(s);
    return out;
  }

  onLeave(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || this.disposed) return;
    this.guard(() => {
      ps.left = true;
      ps.connected = false;
      ps.autoplay = false;
      this.watchers.delete(playerId);
      if (this.ended) return;
      this._resume();
      if (this.clientCombat) this._authorityLost(ps, 'left');
      this.markPublic();
      if (!this.order.some((p) => !p.isBot && !p.left)) {
        this.finish({ victory: false, reason: 'abandoned' });
        return;
      }
      this._quit(ps);
    });
  }

  /**
   * 中途退出 counts as elimination (research 00-INDEX §3, 01 §9, 06 §7 / §10.3): every copy the player holds goes back
   * to the shared pool at once, and the seat has no place in later rounds, the Final Assault pairing or the boss pool
   * (alive × 25 %). Rounds passed = the rounds the player had survived when leaving.
   */
  _quit(ps) {
    this.maybeEndInfo();
    if (!ps.alive) return;
    const phase = this.phase;
    const d = this.draft;
    if (phase === PHASE.BAND_DRAFT && d && !d.picks[ps.playerId]) {
      // the departed seat passes its turn with the default band (never one a teammate holds — defaultBand)
      const turn = this.draftTurn() === ps.playerId;
      d.picks[ps.playerId] = this.defaultBand(ps.playerId);
      ps.bandId = d.picks[ps.playerId];
      if (turn) this.startDraftTurn();
    }
    const passedRound = phase === PHASE.SETTLE ? this.round + 1 : Math.max(1, this.round);
    // its own normal battle has nobody left to fight for
    for (const f of this.fields) {
      if (f.live && f.kind === 'normal' && f.players.length === 1 && f.players[0] === ps.playerId) {
        if (this.clientCombat && f.cc) {
          if (!f.result) f.result = syntheticResult(f.players);
          this._fieldDone(f);
          continue;
        }
        try { f.battle.forceEnd('left'); } catch (e) { this.reportError('quit forceEnd', e); }
      }
    }
    ps.lp = 0;
    ps.eliminate(passedRound);
    this.tickerText(`${ps.name}博士中途退出了模拟`, FLOW_TICKER_PRIORITY);
    if (this.bossWaves && (phase === PHASE.ROUND_START || phase === PHASE.SP_DRAFT || phase === PHASE.PREP)) {
      // before the boss fight: pair the players left again (the prep preview shows the new partner / template); a
      // player moved to the other half re-checks its board there at once (recompute → deployMap, marks it private)
      this._planBossWaves();
      for (const p of this.alivePlayers()) p.recompute();
    }
    this.markPublic();
    if (this.teamLp != null) this._syncTeamLp();
    if (!this.alivePlayers().length) {
      // only eliminated spectators are left
      this.finish({ victory: false, reason: 'eliminated' });
      return;
    }
    if (phase === PHASE.SP_DRAFT && this.sp && this.spTurn() === ps.playerId) this.startSpTurn();
    else if (phase === PHASE.PREP) this.maybeEndPrep();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.runner) { try { this.runner.stop(); } catch { /* ignore */ } }
    this._stopClientCombat();
    for (const h of this._timers) { try { this.sched.clearTimeout(h); } catch { /* ignore */ } }
    this._timers.clear();
    if (this._pubTimer) { try { this.sched.clearTimeout(this._pubTimer); } catch { /* ignore */ } this._pubTimer = null; }
    if (this.ownsScheduler) this.sched.dispose();
  }

  // ===================================================================================================
  // infrastructure

  /** Run a callback with error isolation, then flush the views. */
  guard(fn) {
    if (this.disposed) return;
    try { fn(); } catch (e) { this.reportError('guard', e); }
    try { this.flush(); } catch (e) { this.reportError('flush', e); }
  }

  reportError(label, e) {
    this.errorCount++;
    const msg = `${label}: ${e && e.message ? e.message : e}`;
    if (this.errors.length < 50) this.errors.push({ label, message: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack).split('\n').slice(0, 6).join('\n') : null });
    this.log.error?.(`[match ${this.roomCode}] ${msg}`, e && e.stack ? String(e.stack).split('\n').slice(1, 4).join(' | ') : '');
  }

  /** Schedule a guarded callback (tracked for dispose). */
  later(ms, fn) {
    if (this.disposed) return null;
    let h = null;
    h = this.sched.setTimeout(() => {
      this._timers.delete(h);
      if (this.disposed) return;
      this.guard(fn);
    }, ms);
    if (h) this._timers.add(h);
    return h;
  }

  cancel(h) {
    if (!h) return;
    this.sched.clearTimeout(h);
    this._timers.delete(h);
  }

  scaled(ms) { return Math.max(0, Math.round(ms * this.timerScale)); }

  /**
   * Set the phase deadline (seconds; null/0 ⇒ untimed) and its timeout callback. `silent`: the timer runs but no
   * deadline is published (m.public.deadline 0 ⇒ no countdown) — the fixed presentation steps of a solo match.
   */
  setDeadline(seconds, fn, { silent = false } = {}) {
    this.cancel(this._phaseTimer);
    this._phaseTimer = null;
    if (!(seconds > 0) || typeof fn !== 'function') { this.deadline = 0; return; }
    const ms = this.scaled(seconds * 1000);
    this.deadline = silent ? 0 : this.sched.now() + ms;
    this._phaseTimer = this.later(ms, () => { this._phaseTimer = null; fn(); });
  }

  /**
   * Solo timers (research 01 §843 / 06 §3: 下半 独立模拟 has no time limit on 休整期 / 机变 — "休整期及机变阶段没有时间
   * 限制"; the strategy draft is free too): a solo match publishes a deadline ONLY for its battles. INFO_CHECK waits
   * for 准备就绪 (co-op keeps the official 25 s guard), BAND_DRAFT / SP_DRAFT / PREP are untimed, and the fixed
   * presentation steps (BATTLE_CHECK, ROUND_START, SETTLE) run silently (no countdown). The same holds for any match
   * with a single human (loneHuman: a 同盟 room started alone or with AI teammates only — user playtest #4 item 3):
   * the timers only ever made humans wait on each other; AI seats act at once.
   */
  get soloUntimed() { return this.isSolo || this.loneHuman; }

  nextUid() { return ++this.uidSeq; }

  alivePlayers() { return this.order.filter((p) => p.alive); }

  /** Whether any chess of a bond is in this match's pool (a 驰援 card of a fully banned bond is never offered). */
  bondInPool(bondId) {
    for (const id of this.pool.entries.keys()) {
      const c = this.gd.chess(id);
      if (c && Array.isArray(c.bonds) && c.bonds.includes(bondId)) return true;
    }
    return false;
  }

  /**
   * Whether a bond can matter in this match: not in the mode's static inactive list (标准: 拉特兰 / 阿戈尔 / 卡西米尔 /
   * 奥术 … never activate, research 02 §2.1) and still with chess in the pool. 机变 tactic cards whose every target bond
   * is dead are not offered (choices.js).
   */
  bondLive(bondId) {
    return !this.gd.modeInactiveBonds.has(bondId) && this.bondInPool(bondId);
  }
  humans() { return this.order.filter((p) => !p.isBot && !p.left); }

  /**
   * The boss-round group of a player (`bossWaves`: the seat pairs of finalAssault.js pairPlayers, planned in startRound
   * before the players' round start) and its side — 'L', or 'R' for the second player of a pair (the mirrored right
   * half) — or null outside a boss round / for a player without a field.
   * @returns {{ wave: object, players: string[], side: 'L'|'R' } | null}
   */
  bossGroupOf(ps) {
    if (!ps || !Array.isArray(this.bossWaves)) return null;
    const g = this.bossWaves.find((x) => Array.isArray(x.players) && x.players.includes(ps.playerId));
    return g ? { wave: g.wave, players: g.players, side: g.players.indexOf(ps.playerId) === 1 ? 'R' : 'L' } : null;
  }

  /**
   * The field a player deploys on (server/match/board.js DEPLOY_FIELDS): in a boss round (最终攻势 / 隐秘核心, from its
   * ROUND_START on — the pairing exists before PlayerState.startRound's recompute) the player's half of the boss field,
   * 'bossL' or 'bossR' (bossGroupOf); otherwise its own normal board. User playtest #5 item 7.
   * @returns {'normal'|'bossL'|'bossR'}
   */
  deployFieldOf(ps) {
    const g = this.bossGroupOf(ps);
    return !g ? 'normal' : g.side === 'R' ? 'bossR' : 'bossL';
  }

  /**
   * A fresh deploy map of a player on `field` (default: the field it deploys on now) under its device / tile overrides.
   * Pure — no PlayerState cache is touched (the read-only checker invariants.js uses it; PlayerState.deployMap caches).
   */
  deployMapFor(ps, field = this.deployFieldOf(ps)) {
    return buildDeployMap(this.stage, { deviceOverrides: ps.deviceOverrides, tileOverrides: ps.tileOverrides, field });
  }

  dispatch(ps, hook, ev = {}, opts = {}) {
    try { return this.dispatcher.dispatch(ps, hook, ev, opts); } catch (e) { this.reportError(`dispatch ${hook}`, e); return ev; }
  }

  dispatchItem(ps, item, holder, hook, ev) {
    try { return this.dispatcher.dispatchItem(ps, item, holder, hook, ev); } catch (e) { this.reportError(`dispatchItem ${hook}`, e); return ev; }
  }

  // ---- messaging

  sendTo(playerId, msg) {
    if (this.disposed) return false;
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    if (!ps || ps.isBot || ps.left) return false;
    try { return !!this.sendFn(playerId, msg); } catch (e) { this.reportError('send', e); return false; }
  }

  broadcast(msg) {
    if (this.disposed) return;
    try { this.broadcastFn(msg); } catch (e) { this.reportError('broadcast', e); }
  }

  toast(ps, kind, text) {
    if (!ps || ps.isBot || ps.left || !ps.connected) return;
    this.sendTo(ps.playerId, { t: 'm.toast', kind, text });
  }

  /** Broadcast ticker from config.broadcasts by type; `param` picks the variant (SHOP_LEVEL level, BOSS_HIT share…). */
  tickerFor(type, args = [], { playerId = null, to = null, param = null } = {}) {
    const list = Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts.filter((b) => b && b.type === type) : [];
    let b = list[0];
    if (param != null) b = list.find((x) => Array.isArray(x.params) && x.params.includes(String(param))) || b;
    const tpl = b && typeof b.text === 'string' ? b.text : null;
    if (!tpl) return;
    const text = tpl.replace(/\{(\d)\}/g, (_, i) => (args[Number(i)] != null ? String(args[Number(i)]) : ''));
    const msg = { t: 'm.ticker', text, id: b.id, type, priority: Number(b.priority) || 0, playerId };
    if (to) this.sendTo(to, msg);
    else this.broadcast(msg);
  }

  /**
   * A ticker line of the remake's own (type CUSTOM). `priority`: the match-flow notices (隐秘核心已解锁, 联防阶段, a player out
   * or gone) take FLOW_TICKER_PRIORITY so the strip does not hold them behind shop-level lines; other lines 0.
   */
  tickerText(text, priority = 0) {
    if (!text) return;
    this.broadcast({ t: 'm.ticker', text: String(text).slice(0, 200), id: null, type: 'CUSTOM', priority: Number(priority) || 0, playerId: null });
  }

  markPublic() { this._pubDirty = true; }
  /** A player's state changed: its m.private and (throttled, deduplicated) m.public (level, board, bonds…). */
  markPrivate(ps) { if (ps) { this._privDirty.add(ps); this._pubDirty = true; } }

  /** Send pending m.private (per player, only when changed) and m.public (throttled ≤ 10/s). */
  flush(forcePublic = false) {
    if (this.disposed) return;
    if (this._privDirty.size) {
      const list = [...this._privDirty];
      this._privDirty.clear();
      for (const ps of list) {
        if (!(ps.isBot || ps.left || !ps.connected)) this._sendPrivate(ps, false);
        this._notifyPrepScouts(ps);
      }
    }
    if (this._pubDirty || forcePublic) this._maybeSendPublic(forcePublic);
  }

  _sendPrivate(ps, force) {
    let view;
    try { view = ps.privateView(); } catch (e) { this.reportError('privateView', e); return; }
    const json = JSON.stringify(view);
    if (!force && json === ps._lastPriv) return;
    ps._lastPriv = json;
    this.sendTo(ps.playerId, view);
  }

  _maybeSendPublic(force) {
    const now = this.sched.now();
    if (!force && now - this._lastPubAt < DELAYS.PUBLIC_THROTTLE) {
      if (!this._pubTimer) {
        const wait = Math.max(1, DELAYS.PUBLIC_THROTTLE - (now - this._lastPubAt));
        this._pubTimer = this.sched.setTimeout(() => {
          this._pubTimer = null;
          if (this.disposed) return;
          try { this._maybeSendPublic(false); } catch (e) { this.reportError('public', e); }
        }, wait);
      }
      return;
    }
    this._pubDirty = false;
    let view;
    try { view = this.publicView(); } catch (e) { this.reportError('publicView', e); return; }
    const { serverNow, ...rest } = view;
    const json = JSON.stringify(rest);
    if (!force && json === this._lastPubJson) return;
    this._lastPubJson = json;
    this._lastPubAt = now;
    this.broadcast(view);
  }

  // ===================================================================================================
  // views

  statusOf(ps) {
    if (ps.left) return 'left';
    if (!ps.alive) return 'dead';
    switch (this.phase) {
      case PHASE.INFO_CHECK: return ps.infoReady ? 'ready' : 'deciding';
      case PHASE.BAND_DRAFT:
        if (this.draft && this.draft.picks[ps.playerId]) return 'ready';
        return this.draft && this.draftTurn() === ps.playerId ? 'deciding' : 'acting';
      case PHASE.SP_DRAFT:
        if (this.sp && this.sp.picks[ps.playerId] != null) return 'ready';
        return this.sp && this.spTurn() === ps.playerId ? 'deciding' : 'acting';
      case PHASE.PREP: return ps.ready ? 'ready' : 'acting';
      case PHASE.COMBAT: case PHASE.FINAL_ASSAULT: case PHASE.HIDDEN_CORE: {
        const f = this.fields.find((x) => x.players.includes(ps.playerId));
        return f && f.live ? 'combat' : 'done';
      }
      case PHASE.UNITE: return this.unitePlan && this.unitePlan.helpers.includes(ps) ? 'helping' : 'done';
      case PHASE.ROUND_START: return 'acting';
      default: return 'done';
    }
  }

  fieldOf(ps) {
    const f = this.fields.find((x) => x.players.includes(ps.playerId));
    return f ? f.fieldId : null;
  }

  publicView() {
    const v = {
      t: 'm.public',
      phase: this.phase,
      round: this.round,
      lastRound: this.gd.lastRound,
      deadline: this.deadline,
      serverNow: this.sched.now(),
      modeId: this.modeId,
      difficulty: this.difficulty,
      stageId: this.stageId,
      factions: this.factions.slice(),
      disabledBonds: [...new Set([...this.disabledBonds, ...this.staticInactiveBonds])].sort(),
      drawnDisabledBonds: this.disabledBonds.slice(),
      bannedChess: this.bannedChess.slice(),
      bossId: this.bossId,
      hiddenBossId: this.hiddenBossId,
      bossRound: this.gd.bossRound,
      hiddenRound: this.gd.hiddenRound,
      spRound: this.gd.spRounds().includes(this.round),
      // DESIGN §14: 'client' = battles are simulated by the browsers (b.start specs), 'server' = legacy streaming
      combatMode: this.clientCombat ? 'client' : 'server',
      // solo pause (g.pause, DESIGN §14): the battle, its field clock and every deadline are frozen while true
      paused: !!this.paused,
      players: this.order.map((ps) => ({
        playerId: ps.playerId,
        seat: ps.seat,
        name: ps.name,
        isBot: ps.isBot,
        connected: ps.isBot || (ps.connected && !ps.left),
        alive: ps.alive,
        lp: Math.max(0, ps.lp),
        bandId: ps.bandId,
        shopLevel: ps.shop.level,
        boardCount: ps.deployCount,
        ready: this.phase === PHASE.INFO_CHECK ? ps.infoReady : ps.ready,
        // the strip of a teammate watching this player (DESIGN §20.15): every bond with members, layers or an active tier
        // (= the player's own m.private list without thresholds / countsHand — the client reads those from bonds.json),
        // this round's in-battle gains included once the COMBAT phase ended (PlayerState.bondsView); [] once eliminated —
        // nobody can watch an eliminated player (g.watch refuses them, they have no field) and the result screen reads
        // m.result's own bonds, so their layers would only cost every m.public bytes for the rest of the match
        // (the mode-off bonds with members included, `off: true`, as in m.private — bondsMeta.offBondCounts)
        bonds: ps.alive ? bondList(this.gd, ps.bondsView(), { off: offBondCounts(this.gd, ps) }) : [],
        fieldId: this.fieldOf(ps),
        status: this.statusOf(ps),
        autoplay: ps.autoplay,
        // the LP this round's own battle will cost at settlement so far (COMBAT / 联防 only, omitted when 0)
        ...this._pendingLpView(ps),
      })),
      fields: this.fields.map((f) => {
        const v = { fieldId: f.fieldId, kind: f.kind, players: f.players.slice(), live: !!f.live };
        const pr = this._fieldProgress(f);
        if (pr) v.progress = pr;
        return v;
      }),
    };
    if (this.teamLp != null) v.teamLp = Math.max(0, Math.round(this.teamLp));
    // 最终攻势 / 隐秘核心: when the overtime drain starts (ms epoch; `deadline` is the level's 120 s countdown)
    if ((this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) && this.overtimeAt) v.overtimeAt = this.overtimeAt;
    if (this.bossPool) v.bossHp = { hp: Math.max(0, Math.round(this.bossPool.hp)), max: Math.round(this.bossPool.maxHp) };
    if (this.phase === PHASE.BAND_DRAFT && this.draft) {
      const d = this.draft;
      // turnSeconds: the length of a turn (the countdown gauge's total; 0 when untimed) — deadline = turnDeadline
      v.draft = {
        order: d.order.slice(), turn: this.draftTurn(), picks: { ...d.picks }, skipsLeft: { ...d.skipsLeft }, turnDeadline: d.turnDeadline || 0,
        turnSeconds: d.untimed ? 0 : this.bandTurnMs() / 1000, untimed: !!d.untimed,
      };
    }
    if (this.phase === PHASE.SP_DRAFT && this.sp) {
      const s = this.sp;
      v.sp = {
        family: s.family, name: s.name, desc: s.desc, eventId: s.eventId, cards: s.cards.map(cardView), order: s.order.slice(),
        turn: this.spTurn(), picks: { ...s.picks }, taken: { ...s.taken }, untimed: !!s.untimed,
      };
    }
    if (this.phase === PHASE.UNITE && this.unitePlan) v.unite = { helpers: this.unitePlan.helpers.map((p) => p.playerId), leakers: this.unitePlan.leakers.map((p) => p.playerId) };
    return v;
  }

  /** nextEnemies preview for m.private. */
  nextEnemiesFor(ps) {
    if (!ps.alive) return [];
    if (this.bossWaves) {
      const g = this.bossGroupOf(ps);
      if (!g) return [];
      return previewOf([...g.wave.spawns, ...bountySpawns(this.gd, this.round, g.wave, ps.bounties, ps.playerId, { solo: this.isSolo, side: g.side })]);
    }
    if (!this.wave) return [];
    const bounty = bountySpawns(this.gd, this.round, this.wave, ps.bounties, ps.playerId, { solo: this.isSolo });
    return previewOf([...this.wave.spawns, ...bounty]);
  }

  /** UnitInfo list of a player's board (prep scouting). */
  prepFieldMeta(ps) {
    const units = [];
    for (const { r, c, piece } of boardOrder(ps.board)) {
      const rec = piece.kind === 'token' ? this.gd.token(piece.id) : this.gd.chess(piece.id);
      const assets = (rec && rec.assets) || {};
      // DESIGN §16: the skill / module THIS player's operator fights with (the scout's detail card shows it, like the
      // sim's UnitInfo in a shared field); moduleId only for an elite
      const lo = piece.kind === 'chess' && rec ? ps.loadoutFor(rec) : null;
      units.push({
        id: piece.uid, uid: piece.uid, kind: piece.kind === 'token' ? 'token' : 'op', side: 'ally', ownerId: ps.playerId, defId: piece.id,
        name: rec ? rec.name : piece.id, tier: rec && Number.isInteger(rec.tier) ? rec.tier : 1, golden: !!(rec && rec.isGolden),
        spine: assets.spine || (rec && rec.charId) || piece.id, avatar: assets.avatar || (rec && rec.charId) || piece.id,
        x: c, y: r, dir: pieceDir(piece), facing: pieceDir(piece) === 'LEFT' ? -1 : 1, maxHp: rec && rec.stats && Number.isFinite(rec.stats.maxHp) ? rec.stats.maxHp : 1,
        skillIndex: lo && Number.isInteger(lo.skillIndex) ? lo.skillIndex : undefined,
        moduleId: lo && typeof lo.moduleId === 'string' ? lo.moduleId : undefined,
        // the equipped items (like the sim's UnitInfo): a 变形同构体 wearer shows as a member of the bond it grants
        items: piece.kind === 'chess' && Array.isArray(piece.items) && piece.items.length ? piece.items.map((it) => it.id) : undefined,
      });
    }
    // `nextEnemies`: the scouted player's coming enemies — their preview pen shows on the scouting board too (research 09
    // §2.2 "Teammates"; render/app.js enterBattle({ prep: true, nextEnemies }))
    let nextEnemies = [];
    try { nextEnemies = this.nextEnemiesFor(ps); } catch (e) { this.reportError('nextEnemies', e); }
    return { t: 'm.field', fieldId: `n:${ps.playerId}`, kind: 'normal', rect: { ...GEO.NORMAL_RECT }, stageId: this.stageId, units, prep: true, nextEnemies };
  }

  /** Board signature of a prep scout view (units only: a shop or funds change is not a board change). */
  _prepScoutSig(ps) {
    const parts = [];
    for (const { r, c, piece } of boardOrder(ps.board)) {
      const items = piece.kind === 'chess' && Array.isArray(piece.items) ? piece.items.map((it) => `${it.uid}:${it.id}`).join(',') : '';
      parts.push(`${piece.uid}:${piece.id}@${r},${c}:${pieceDir(piece)}:${items}`);
    }
    return parts.join(';');
  }

  /**
   * Push prepFieldMeta to whoever is scouting `ps` during prep (GitHub #87). `to` always receives the current board
   * (the player who just asked to watch); everyone scouting it receives a new `m.field` only when the board changed.
   * A live battle field owns the `n:<pid>` id, so this stays quiet once fields exist.
   */
  _notifyPrepScouts(ps, { to = null } = {}) {
    if (!ps || !ps.alive || this.fields.length) return;
    const fid = `n:${ps.playerId}`;
    const watchers = this.watchersOf(fid);
    if (!watchers.length) return;
    const sig = this._prepScoutSig(ps);
    const changed = sig !== ps._prepScoutSig;
    ps._prepScoutSig = sig;
    const dest = changed ? watchers : (to ? [to] : []);
    if (!dest.length) return;
    const meta = this.prepFieldMeta(ps);
    for (const pid of dest) this.sendTo(pid, meta);
  }

  _sendField(playerId, fieldId) {
    const f = this.fields.find((x) => x.fieldId === fieldId);
    if (f) {
      let meta;
      try { meta = f.battle.fieldMeta(); } catch (e) { this.reportError('fieldMeta', e); return; }
      this.sendTo(playerId, { t: 'm.field', ...meta, fieldId: f.fieldId, kind: f.kind, live: !!f.live });
      try { this.sendTo(playerId, snapFrame(f.fieldId, f.battle.snapshot())); } catch (e) { this.reportError('snapshot', e); }
      return;
    }
    if (typeof fieldId === 'string' && fieldId.startsWith('n:')) {
      const target = this.players.get(fieldId.slice(2));
      if (target && target.alive) this.sendTo(playerId, this.prepFieldMeta(target));
    }
  }

  watchersOf(fieldId) {
    const out = [];
    for (const [pid, fid] of this.watchers) if (fid === fieldId) out.push(pid);
    return out;
  }

  // ===================================================================================================
  // intents

  _handle(ps, msg) {
    switch (msg.t) {
      case 'g.infoReady':
        if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
        if (!ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
        return OK;
      case 'g.band': return this.pickBand(ps, msg.bandId);
      case 'g.bandSkip': return this.skipBand(ps);
      // the strategy highlighted in the draft screen (what a timed-out turn takes, timeoutBand)
      case 'g.bandFocus': return this.bandFocus(ps, msg.bandId ?? null);
      case 'g.buy': return ps.buy(msg.slot);
      case 'g.refresh': return ps.refresh();
      case 'g.freeze': return ps.freeze();
      case 'g.levelUp': return ps.levelUp();
      case 'g.sell': return ps.sell(msg.uid);
      // dir: the deploy wheel's facing (DESIGN §3; absent ⇒ PlayerState reads to.dir, then RIGHT)
      case 'g.move': return ps.move(msg.uid, msg.to, msg.dir);
      case 'g.equip': return ps.equip(msg.itemUid, msg.targetUid, msg.replaceUid ?? null);
      case 'g.art': return ps.useArt(msg.itemUid, msg.row, msg.col, msg.dir);
      case 'g.destroy': return ps.destroy(msg.uid);
      case 'g.reward': return ps.pickReward(msg.idx);
      case 'g.choice': return this.pickCard(ps, msg.idx);
      case 'g.ready': return ps.setReady(!!msg.ready);
      case 'g.emote': return this.emote(ps, msg.id);
      case 'g.watch': return this.watch(ps, msg.fieldId);
      case 'g.autoplay': return this.setAutoplay(ps, !!msg.on);
      case 'g.pause': return this.setPause(ps, !!msg.on);
      // the stats the board's units start their next battle with (the detail card in prep, user playtest #4 item 7)
      case 'g.unitStats': return this.unitStats(ps, msg.seq ?? null);
      case 'g.leave': this.onLeave(ps.playerId); return OK;
      case 'b.progress': return this._onProgress(ps, msg);
      case 'b.result': return this._onResult(ps, msg);
      default: return fail(ERR.BAD_MSG);
    }
  }

  emote(ps, id) {
    if (!EMOTES.includes(id)) return fail(ERR.BAD_MSG, 'unknown emote');
    const now = this.sched.now();
    if (now - ps.lastEmoteAt < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
    ps.lastEmoteAt = now;
    this.broadcast({ t: 'm.emote', playerId: ps.playerId, id });
    return OK;
  }

  watch(ps, fieldId) {
    if (typeof fieldId !== 'string') return fail(ERR.BAD_TARGET);
    if (this.clientCombat && this.fields.length && this.fields.some((x) => x.cc)) return this._watchClient(ps, fieldId);
    const f = this.fields.find((x) => x.fieldId === fieldId);
    if (f) {
      // 最终攻势 / 隐秘核心: "两名参与者会处于同一个战场，但无法查看另一组队友的战场情况" — a fighting player sees its own
      // boss field only (eliminated / departed players spectate freely)
      const own = this.fieldOf(ps);
      if ((f.kind === 'boss' || f.kind === 'hidden') && own && own !== f.fieldId) return fail(ERR.BAD_TARGET, 'other group hidden');
      this.watchers.set(ps.playerId, fieldId);
      this._sendField(ps.playerId, fieldId);
      return OK;
    }
    if (fieldId.startsWith('n:')) {
      // prep scouting, only while no battle field is up: during 各自行动 / 联防 / 最终攻势 / 隐秘核心 an 'n:<pid>' id
      // must name a live field (else the boss-group rule above could be bypassed, and the viewer would stop receiving
      // its own field's snapshots). The scout stays in `watchers` so a later board change pushes prepFieldMeta again
      // (GitHub #87); combat start clears the map and reassigns live fields, spectators included.
      if (this.fields.length) return fail(ERR.BAD_TARGET, 'no such field');
      const target = this.players.get(fieldId.slice(2));
      if (!target || !target.alive) return fail(ERR.BAD_TARGET);
      this.watchers.set(ps.playerId, fieldId);
      this._notifyPrepScouts(target, { to: ps.playerId });
      return OK;
    }
    return fail(ERR.BAD_TARGET);
  }

  setAutoplay(ps, on) {
    if (ps.autoplay === on) return OK;
    ps.autoplay = on;
    this.markPublic();
    if (on) this.kickBot(ps);
    return OK;
  }

  /**
   * g.unitStats { seq? } (user playtest #4 item 7: the detail card showed fixed record stats): the stats every unit of
   * the player's board will fight with at the start of its next battle — equipment, bonds and their layers, 特质, the
   * band and 机变 effects — computed exactly by the shared sim. The player's battle input after the onBattleStart meta
   * handlers (`ev.preview: true`, no enemies — those handlers must not change the match for a preview) builds a Battle
   * of the battle's options that is started (initial deployment + battleStart hooks), read and dropped: it is never
   * stepped, so skills and timed effects do not show. Pushed to the player as `m.unitStats { seq, round, units }`
   * (units: shared/protocol.js unitStatsEntry, board operators and summons by uid); cached per input (a build costs
   * ≈ 0.3–0.7 ms). Prep phases only (ROUND_START, 机变, PREP); a battle's live stats come from the browser's own sim.
   * @param {PlayerState} ps @param {number|null} seq echoed (the client keeps the newest answer)
   */
  unitStats(ps, seq = null) {
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.ROUND_START && this.phase !== PHASE.SP_DRAFT && this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    const units = this._unitStatsOf(ps);
    this.sendTo(ps.playerId, { t: 'm.unitStats', seq: Number.isInteger(seq) ? seq : null, round: this.round, units });
    return OK;
  }

  /** The start-of-battle stats of a player's board units (see unitStats); [] when the preview battle cannot be built. */
  _unitStatsOf(ps) {
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const ev = { input, kind: 'normal', round: this.round, preview: true };
    this.dispatch(ps, 'onBattleStart', ev);
    const players = [ev.input && typeof ev.input === 'object' ? ev.input : input];
    let key = null;
    try { key = JSON.stringify([this.round, this.stageId, this.battleContent, players]); } catch { key = null; }
    if (!this._unitStatsCache) this._unitStatsCache = new WeakMap(); // PlayerState → { key, units } (the last preview)
    const cached = this._unitStatsCache.get(ps);
    if (key && cached && cached.key === key) return cached.units;
    const units = [];
    // the flags of the battle it previews: a normal round gains IN_BATTLE layers from its start (a <战斗开始时> layer gain
    // raises bond stats at t = 0 there too); the Final Assault / Hidden Core fight without (previewed as a normal field)
    const bossRound = this.round === this.gd.bossRound || this.round === this.gd.hiddenRound;
    const b = this.newBattle({
      seed: deriveSeed(this.seed, `preview:${this.round}:${ps.seat}`), kind: 'normal', modeId: this.modeId, round: this.round,
      stageId: this.stageId, rect: { ...GEO.NORMAL_RECT }, timeLimit: 60, players, spawns: [], routes: this.wave ? this.wave.routes : [],
      sharedBoss: null, flags: { layerGainsEnabled: !bossRound, ...this.gd.dp }, fieldId: `n:${ps.playerId}`, recordEvents: false,
    });
    try {
      if (typeof b.start === 'function') b.start();
      for (const u of Array.isArray(b.allyUnits) ? b.allyUnits : []) {
        if (u && Number.isInteger(u.uid) && (u.kind === 'op' || u.kind === 'token')) units.push(unitStatsEntry(u, u.s));
      }
    } catch (e) { this.reportError('unitStats', e); }
    this._unitStatsCache.set(ps, { key, units });
    return units;
  }

  /**
   * Solo pause (official PauseUp / ResumeUp; DESIGN §14 "Solo pause"): g.pause { on } freezes the running battle — the
   * field clock (b.start `elapsed`, the boss budgets and overtime), the result deadline / server release timers, the
   * boss clock, the HUD `deadline` / `overtimeAt` (shifted by the pause on resume) and the server-run pacers
   * (FieldRunner / HeadlessPacer skip their intervals) — and the browser's runner stops its local clock while
   * `m.public.paused` is true. Solo matches only (co-op battles never pause: WRONG_PHASE) and only while a battle runs;
   * `{ on: false }` is always accepted. A disconnect / leave, or the battle phase ending, resumes.
   */
  setPause(ps, on) {
    void ps;
    if (!this.isSolo) return fail(ERR.WRONG_PHASE, 'co-op battles never pause');
    if (!on) { this._resume(); return OK; }
    if (this.paused) return OK;
    const battlePhase = this.phase === PHASE.COMBAT || this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE;
    if (!battlePhase || this._finalEnding || !this.fields.some((f) => f.live && !f.done)) return fail(ERR.WRONG_PHASE, 'no battle running');
    this.paused = true;
    this._pausedAt = this.sched.now();
    for (const f of this.fields) {
      if (!f.cc) continue;
      if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; f.rearmDeadline = true; }
      if (f.doneTimer) { this.cancel(f.doneTimer); f.doneTimer = null; f.rearmRelease = true; }
    }
    if (this._bossClock) { this.cancel(this._bossClock); this._bossClock = null; }
    this.markPublic();
    return OK;
  }

  /** End a solo pause: every clock and deadline moves on by the paused time (no-op when not paused). */
  _resume() {
    if (!this.paused) return;
    const d = Math.max(0, this.sched.now() - this._pausedAt);
    this.paused = false;
    this._pausedAt = 0;
    this.pausedMs += d;
    if (this.deadline) this.deadline += d;
    if (this.overtimeAt) this.overtimeAt += d;
    if (this._bossStartAt != null) this._bossStartAt += d;
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      f.startAt += d;
      f.lastProgressAt += d;
      if (f.rearmDeadline && f.mode === 'client') this._armDeadline(f);
      if (f.rearmRelease && f.mode === 'server') this._armRelease(f);
      f.rearmDeadline = false;
      f.rearmRelease = false;
    }
    if (this._bossClockOn && !this._bossClock && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE)) {
      this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    }
    this.markPublic();
  }

  /** The battle phase is over: drop the pause without shifting anything (its timers are gone). */
  _clearPause() {
    if (!this.paused) return;
    this.pausedMs += Math.max(0, this.sched.now() - this._pausedAt);
    this.paused = false;
    this._pausedAt = 0;
    this.markPublic();
  }

  /** The field clocks' "now": frozen at the pause instant while paused. */
  _clockNow() { return this.paused ? this._pausedAt : this.sched.now(); }

  /** Let the bot act for a (newly) bot-controlled seat in the current phase. */
  kickBot(ps) {
    if (!ps.botControlled || this.ended) return;
    if (this.phase === PHASE.INFO_CHECK && !ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
    else if (this.phase === PHASE.BAND_DRAFT && this.draftTurn() === ps.playerId) this.scheduleBandBot();
    else if (this.phase === PHASE.SP_DRAFT && this.spTurn() === ps.playerId) this.scheduleSpBot();
    else if (this.phase === PHASE.PREP && ps.alive && !ps.ready) this.scheduleBotPrep(ps, 0);
  }

  // ===================================================================================================
  // INFO_CHECK

  enterInfoCheck() {
    this.phase = PHASE.INFO_CHECK;
    for (const ps of this.order) if (ps.botControlled) ps.infoReady = true;
    // solo: no time limit (the player confirms); co-op: the official 25 s guard
    this.setDeadline(this.soloUntimed ? 0 : this.gd.timer('infoCheck'), () => this.enterBandDraft());
    this.markPublic();
    for (const ps of this.order) this.markPrivate(ps);
    this.flush(true);
    this.maybeEndInfo();
  }

  maybeEndInfo() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    if (this.order.every((p) => p.isBot || p.left || p.infoReady)) {
      this.setDeadline(0);
      this.later(0, () => { if (this.phase === PHASE.INFO_CHECK) this.enterBandDraft(); });
    }
  }

  // ===================================================================================================
  // BAND_DRAFT

  /**
   * The strategy draft (user playtest #4 item 4): ONE countdown — every turn has the same clock, BAND_TURN_SECONDS, and
   * m.public.deadline is the current turn's end (= draft.turnDeadline; the step header and the turn indicator show the
   * same number). No separate step cap: the turns bound the step (≤ (seats + skips) × turn). AI seats pick at once. A
   * turn that runs out takes the strategy the player has highlighted (g.bandFocus) while it is free, else the default
   * (timeoutBand). Solo, and any single-human match (soloUntimed): untimed. Solo also keeps seat order and has no skip.
   */
  enterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    this.phase = PHASE.BAND_DRAFT;
    const order = this.order.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    const skips = this.isSolo ? 0 : this.gd.bandDraft.skipsPerPlayer;
    const untimed = this.soloUntimed;
    this.draft = {
      order, idx: 0, picks: {}, skipsLeft: Object.fromEntries(order.map((pid) => [pid, skips])), untimed, turnDeadline: 0,
      /** playerId → the strategy highlighted in the draft screen (g.bandFocus) */
      focus: new Map(),
    };
    this.setDeadline(0);
    this.startDraftTurn();
    this.markPublic();
  }

  draftTurn() {
    const d = this.draft;
    if (!d) return null;
    return d.order[d.idx] ?? null;
  }

  /** Real ms of one strategy-draft turn (BAND_TURN_SECONDS × timerScale). */
  bandTurnMs() { return this.scaled(BAND_TURN_SECONDS * 1000); }

  startDraftTurn() {
    const d = this.draft;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    while (d.idx < d.order.length && d.picks[d.order[d.idx]]) d.idx++;
    if (d.idx >= d.order.length) {
      d.turnDeadline = 0;
      this.deadline = 0;
      this.later(0, () => this.finishBandDraft(false));
      return;
    }
    const token = ++this._turnToken;
    if (!d.untimed) {
      const ms = this.bandTurnMs();
      d.turnDeadline = this.sched.now() + ms;
      // the step's countdown IS the turn's (one number everywhere)
      this.deadline = d.turnDeadline;
      this._turnTimer = this.later(ms, () => {
        if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
        const pid = this.draftTurn();
        if (pid) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
      });
    } else {
      d.turnDeadline = 0;
      this.deadline = 0;
    }
    const cur = this.players.get(this.draftTurn());
    if (cur && cur.botControlled) this.scheduleBandBot();
    this.markPublic();
  }

  /** An AI seat's (or an AI 托管 seat's) turn: it picks at once (user playtest #4 item 4 — nobody waits on the AI). */
  scheduleBandBot() {
    const token = this._turnToken;
    this.later(0, () => {
      if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
      const ps = this.players.get(this.draftTurn());
      if (!ps || !ps.botControlled) return;
      // a strategy a teammate already took is not selectable (队友已选): the bot re-draws, else the first free one
      let id = botPickBand(this, ps);
      for (let k = 0; k < 8 && this.bandTaken(id, ps.playerId); k++) id = botPickBand(this, ps);
      if (this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
      this._applyBand(ps, id, { dedupe: true });
    });
  }

  /**
   * Whether `bandId` was already picked by another player of this draft. Research 09 §5 / DESIGN §14 corrections:
   * the strategy draft marks a teammate's pick as 队友已选 and it cannot be chosen again (co-op). The automatic
   * assignments — a turn that runs out and a departing seat — obey the same rule: see timeoutBand / defaultBand.
   */
  bandTaken(bandId, playerId) {
    const picks = this.draft?.picks || {};
    for (const [pid, id] of Object.entries(picks)) if (pid !== playerId && id === bandId) return true;
    return false;
  }

  /**
   * The strategy an automatic assignment gives `playerId` (a departing seat; a timed-out turn without a usable
   * highlight, timeoutBand): the official default 「华法琳」 (bandDraft.timeoutBandId) while no teammate holds it, else the
   * first strategy of the mode (sortId order, gd.bandIds) that nobody else picked — never a duplicate (队友已选; the
   * client shows the same choice: public/js/screens/bandDraft.js timeoutBand). Solo drafts have no teammates, so it is
   * always the default.
   * @param {string} playerId
   */
  defaultBand(playerId) {
    const def = this.gd.bandDraft.timeoutBandId;
    if (!this.bandTaken(def, playerId)) return def;
    return this.gd.bandIds().find((b) => !this.bandTaken(b, playerId)) || def;
  }

  /**
   * What a turn that runs out assigns (user playtest #4 item 4): the strategy the player has highlighted in the draft
   * screen (g.bandFocus — the detail pane's band, the one 确认选择 would take) while it is allowed and no teammate holds
   * it, else defaultBand.
   * @param {string} playerId
   */
  timeoutBand(playerId) {
    const f = this.draft && this.draft.focus instanceof Map ? this.draft.focus.get(playerId) : null;
    if (typeof f === 'string' && this.gd.bandAllowed(f) && !this.bandTaken(f, playerId)) return f;
    return this.defaultBand(playerId);
  }

  /**
   * g.bandFocus { bandId? }: the strategy the player highlights in the draft screen (any time before its pick; also
   * while waiting for its turn). A missing / null bandId clears it. Only a timed-out turn reads it (timeoutBand).
   */
  bandFocus(ps, bandId) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (!(d.focus instanceof Map)) d.focus = new Map();
    if (bandId == null) { d.focus.delete(ps.playerId); return OK; }
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    d.focus.set(ps.playerId, bandId);
    return OK;
  }

  pickBand(ps, bandId) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    if (this.draft.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    if (this.bandTaken(bandId, ps.playerId)) return fail(ERR.BAD_TARGET, '队友已选');
    this._applyBand(ps, bandId);
    return OK;
  }

  _applyBand(ps, bandId, { dedupe = false } = {}) {
    const d = this.draft;
    if (!d || !ps || d.picks[ps.playerId]) return;
    let id = this.gd.bandAllowed(bandId) ? bandId : this.defaultBand(ps.playerId);
    if (dedupe && this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    d.picks[ps.playerId] = id;
    ps.bandId = id;
    ps.lp = this.gd.startLp(id);
    this.markPrivate(ps);
    this.markPublic();
    this.startDraftTurn();
  }

  skipBand(ps) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (this.isSolo) return fail(ERR.WRONG_PHASE, 'no skip in solo');
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!(d.skipsLeft[ps.playerId] > 0)) return fail(ERR.ALREADY, 'no skip left');
    if (d.order.length - d.idx <= 1) return fail(ERR.BAD_TARGET, 'nobody to pass to');
    d.skipsLeft[ps.playerId]--;
    d.order.splice(d.idx, 1);
    d.order.push(ps.playerId);
    this.startDraftTurn();
    return OK;
  }

  finishBandDraft(timeout) {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    for (const ps of this.order) {
      if (!this.draft.picks[ps.playerId]) {
        // one after another in seat order, so each default sees the ones assigned before it (no duplicates)
        const id = this.defaultBand(ps.playerId);
        this.draft.picks[ps.playerId] = id;
        ps.bandId = id;
        ps.lp = this.gd.startLp(id);
      }
      this.markPrivate(ps);
    }
    void timeout;
    this.enterBattleCheck();
  }

  // ===================================================================================================
  // BATTLE_CHECK → rounds

  enterBattleCheck() {
    this.phase = PHASE.BATTLE_CHECK;
    this.setDeadline(this.gd.timer('battleCheck'), () => this.startRound(1), { silent: this.soloUntimed });
    this.markPublic();
  }

  startRound(r) {
    this.phase = PHASE.ROUND_START;
    this.round = r;
    this.fields = [];
    this.watchers.clear();
    this.unitePlan = null;
    this.sp = null;
    this.wave = null;
    this.bossWaves = null;
    const alive = this.alivePlayers();
    // the round's enemies (shared composition, generated now so the prep preview is exact). Planned BEFORE the players'
    // round start: its recompute() checks the board on the field the player deploys on this round (deployFieldOf reads
    // the boss pairing), so R14 → R15 never re-checks a boss-field board against the normal field (user playtest #5
    // item 7). rngWaves is used only here, so the order leaves every random stream unchanged.
    const isBoss = r === this.gd.bossRound || r === this.gd.hiddenRound;
    if (isBoss) {
      this._planBossWaves();
    } else {
      this.wave = buildNormalWave(this.gd, this.rngWaves, this.factions, r);
    }
    for (const ps of alive) ps.startRound(r);
    for (const ps of alive) this.dispatch(ps, 'onRoundStart', { round: r });
    // an eliminated player's pending 信标 gift still goes to its teammate (effects flagged afterElimination; GitHub #86)
    for (const ps of this.order) {
      if (ps.alive) continue;
      try { this.dispatcher.dispatchEliminated(ps, 'onRoundStart', { round: r }); } catch (e) { this.reportError('dispatch onRoundStart (eliminated)', e); }
    }
    for (const ps of alive) ps.recompute();
    this.setDeadline(DELAYS.ROUND_START / 1000, () => this.afterRoundStart(), { silent: this.soloUntimed });
    this.markPublic();
  }

  /** The boss round's fields (seat pairs of the alive players) and their templates, generated for the prep preview. */
  _planBossWaves() {
    const r = this.round;
    const bossId = r === this.gd.hiddenRound && r !== this.gd.bossRound ? this.hiddenBossId : this.bossId;
    this.bossWaves = pairPlayers(this.alivePlayers()).map((g) => ({
      players: g.map((p) => p.playerId),
      wave: buildBossWave(this.gd, this.rngWaves, this.factions, r, { bossId, solo: this.isSolo || g.length === 1 }),
    }));
  }

  afterRoundStart() {
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.enterPrep();
  }

  // ===================================================================================================
  // SP_DRAFT (机变)

  enterSpDraft() {
    const draft = generateDraft(this.gd, this.rngDraft, this.round, { stageId: this.stageId, bondAvailable: (bondId) => this.bondLive(bondId) });
    const alive = this.alivePlayers();
    if (!draft || !alive.length) { this.enterPrep(); return; }
    this.phase = PHASE.SP_DRAFT;
    const order = alive.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    // untimed: solo and any single-human match (soloUntimed); the co-op order / 6 cards stay
    const untimed = this.soloUntimed;
    this.sp = { ...draft, order, idx: 0, picks: {}, taken: {}, untimed, turnDeadline: 0 };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
  }

  spTurn() {
    const s = this.sp;
    if (!s) return null;
    return s.order[s.idx] ?? null;
  }

  startSpTurn() {
    const s = this.sp;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    while (s.idx < s.order.length) {
      const ps = this.players.get(s.order[s.idx]);
      if (ps && ps.alive && s.picks[ps.playerId] == null) break;
      s.idx++;
    }
    const available = s.cards.map((c) => c.idx).filter((i) => s.taken[i] == null);
    if (s.idx >= s.order.length || !available.length) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); return; }
    const token = ++this._turnToken;
    if (!s.untimed) {
      const first = s.idx === 0;
      const secs = first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken) return;
        const ps = this.players.get(this.spTurn());
        if (!ps) return;
        const avail = s.cards.map((c) => c.idx).filter((i) => s.taken[i] == null);
        if (!avail.length) { this.finishSpDraft(); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      s.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    const cur = this.players.get(this.spTurn());
    if (cur && cur.botControlled) this.scheduleSpBot();
    this.markPublic();
  }

  scheduleSpBot() {
    const token = this._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken || !this.sp) return;
      const ps = this.players.get(this.spTurn());
      if (!ps || !ps.botControlled) return;
      const avail = this.sp.cards.map((c) => c.idx).filter((i) => this.sp.taken[i] == null);
      if (!avail.length) return;
      this._applyCard(ps, botPickCard(this, ps, this.sp.cards, avail));
    });
  }

  pickCard(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (this.spTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    if (this.sp.taken[idx] != null) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    if (!s || s.picks[ps.playerId] != null || s.taken[idx] != null) return;
    const card = s.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    s.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    this.startSpTurn();
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    this.enterPrep();
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) },
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items. */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6 } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]));
        let total = 0;
        for (const [, w] of pairs) total += Math.max(0, Number(w) || 0);
        let r = rng() * total;
        for (const [id, w] of pairs) { r -= Math.max(0, Number(w) || 0); if (r < 0) return id; }
        return pairs.length ? pairs[pairs.length - 1][0] : null;
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return items.length ? items[Math.floor(rng() * items.length)] : null;
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return list.length ? list[Math.floor(rng() * list.length)] : null;
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return list.length ? list[Math.floor(rng() * list.length)] : null;
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
  rollPool(poolId, { shopLevel = 6 } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !this.pool.has(base) || this.pool.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      id = this.pool.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(this.gd.chess(cid)?.bonds) && this.gd.chess(cid).bonds.includes(bond))),
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }

  // ===================================================================================================
  // PREP

  enterPrep() {
    this.phase = PHASE.PREP;
    this.sp = null;
    const alive = this.alivePlayers();
    for (const ps of alive) {
      ps.ready = false;
      // Items gained as the previous prep ended waited unmerged (acquireItem deferMerge). Merge them now, before
      // this prep's onPrepStart grants and before the player acts — not in endPrep, which runs in the same prep
      // that granted them and would take an equipped copy off for the fight about to start.
      ps.checkItemMerges();
      ps.recompute();
      this.dispatch(ps, 'onPrepStart', { round: this.round });
      ps.recompute();
    }
    // solo / single-human matches: untimed (soloUntimed); co-op: the round's prepTime
    const secs = this.soloUntimed ? null : this.gd.prepTime(this.round);
    this.setDeadline(secs, () => this.prepDeadline());
    let i = 0;
    for (const ps of alive) if (ps.botControlled) this.scheduleBotPrep(ps, i++);
    this.markPublic();
    this.maybeEndPrep();
  }

  /**
   * The bot plays a prep in three stages, every one in slices of ≤ botSliceMs wall-clock ms (one scheduler callback
   * each, so other rooms' battles and every player's requests keep flowing): economy + the default layout
   * (bot.js botPrepBeginSteps — shop decisions and layout planning, 50–120 ms late in a 4-bot match), the layout
   * rehearsal (whole simulated battles, 0.2–1 s of CPU per bot late in a match), then botPrepEndSteps (the rehearsed
   * layout, temp, Ready). The step generators run the same actions in the same order as the one-shot routine (same
   * rng draws, same decisions); in virtual time (botSliceMs unbounded) each stage runs at once. The prep ending first
   * (deadline) or a newer schedule for the seat drops the job (a step never leaves a transient board behind).
   */
  scheduleBotPrep(ps, i = 0) {
    const round = this.round;
    const token = (ps._botPrepToken = (ps._botPrepToken || 0) + 1);
    const valid = () => this.phase === PHASE.PREP && this.round === round && ps.alive && !ps.ready && ps.botControlled && ps._botPrepToken === token;
    const bounded = Number.isFinite(this.botSliceMs);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    /** Step a generator until done or the slice budget is used; `then(value)` once it is done (null on an error). */
    const drive = (gen, label, then) => {
      const t0 = now();
      let r = null;
      try {
        do r = gen.next(); while (!r.done && !(bounded && now() - t0 >= this.botSliceMs));
      } catch (e) {
        this.reportError(`bot ${ps.playerId}${label}`, e);
        then(null);
        return;
      }
      if (r.done) { then(r.value); return; }
      this.later(0, () => { if (valid()) drive(gen, label, then); });
    };
    const ready = () => {
      if (!ps.ready) {
        ps.resolveTemp();
        ps.setReady(true);
      }
    };
    const end = (job) => {
      let gen = null;
      try { gen = botPrepEndSteps(this, ps, job); } catch (e) { this.reportError(`bot ${ps.playerId}`, e); }
      if (!gen) { ready(); return; }
      drive(gen, '', ready);
    };
    this.later(this.scaled(DELAYS.BOT_ACTION + i * DELAYS.BOT_STAGGER), () => {
      if (!valid()) return;
      drive(botPrepBeginSteps(this, ps), '', (job) => {
        if (!job) { end(null); return; }
        const slice = () => {
          if (!valid()) return;
          let done = true;
          try { done = job.run(this.botSliceMs); } catch (e) { this.reportError(`bot ${ps.playerId} rehearsal`, e); }
          if (done) { if (bounded) this.later(0, () => { if (valid()) end(job); }); else end(job); }
          else this.later(0, slice);
        };
        // bounded slices start in a callback of their own (the economy + default layout above already used this one)
        if (bounded) this.later(0, slice);
        else slice();
      });
    });
  }

  onReadyChanged(ps) {
    this.markPublic();
    void ps;
    this.maybeEndPrep();
  }

  maybeEndPrep() {
    if (this.phase !== PHASE.PREP || this._prepEndQueued) return;
    const allReady = () => { const alive = this.alivePlayers(); return alive.length > 0 && alive.every((p) => p.ready); };
    if (!allReady()) return;
    const round = this.round;
    this._prepEndQueued = true;
    // the prep deadline stays armed until the phase really ends: a player may un-ready before this runs
    this.later(0, () => {
      this._prepEndQueued = false;
      if (this.phase === PHASE.PREP && this.round === round && allReady()) this.endPrep();
    });
  }

  prepDeadline() {
    if (this.phase !== PHASE.PREP) return;
    for (const ps of this.alivePlayers()) {
      if (ps.ready) continue;
      ps.resolveTemp();
      ps.ready = true;
      ps.dirty();
    }
    this.endPrep();
  }

  endPrep() {
    if (this.phase !== PHASE.PREP) return;
    this.setDeadline(0);
    const alive = this.alivePlayers();
    for (const ps of alive) this.dispatch(ps, 'onPrepEnd', { round: this.round });
    for (const ps of alive) ps.endPrep();
    const r = this.round;
    if (r === this.gd.bossRound) {
      this.hiddenLayerSum = alive.reduce((s, p) => s + p.activatedLayers(), 0);
      this.startFinalAssault(false);
    } else if (r === this.gd.hiddenRound) {
      this.startFinalAssault(true);
    } else {
      this.startCombat();
    }
  }

  // ===================================================================================================
  // battles

  /** Construct a battle; a constructor failure yields a finished stand-in (clean result) and is logged. */
  newBattle(opts) {
    const full = { data: this.ds, content: this.battleContent, logger: this.log, ...opts };
    try {
      return new this.BattleClass(full);
    } catch (e) {
      this.reportError(`battle ${opts.fieldId} construct`, e);
      return new DeadBattle(full, 'forced');
    }
  }

  /**
   * Spawn list of a field after the onBattleStart handlers (which may edit `ev.spawns`): malformed entries are dropped
   * and a kill bounty is copied into `mods.bountyCoins`, so a leaked bounty enemy keeps paying its killer in 联防.
   */
  _sanitizeSpawns(list, ownerPlayerId = null) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || typeof s !== 'object' || typeof s.enemyKey !== 'string' || !this.gd.enemy(s.enemyKey)) continue;
      const spec = { ...s, mods: s.mods && typeof s.mods === 'object' ? { ...s.mods } : {} };
      if (ownerPlayerId && spec.ownerPlayerId == null) spec.ownerPlayerId = ownerPlayerId;
      const coins = spec.bounty && typeof spec.bounty === 'object' ? Math.trunc(Number(spec.bounty.coins) || 0) : 0;
      if (coins > 0 && spec.mods.bountyId == null && spec.mods.bountyCoins == null) spec.mods.bountyCoins = coins;
      out.push(spec);
    }
    return out;
  }

  _normalBattle(ps) { return this.newBattle(this._normalOpts(ps)); }

  /** Battle options of a player's normal field (after the onBattleStart handlers). */
  _normalOpts(ps) {
    const wave = this.wave;
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    // the client's list: bounty units inserted among their host action's own units, which are re-timed around them
    const spawns = withBounties(this.gd, this.round, wave, ps.bounties, ps.playerId).map((s) => ({ ...s, ownerPlayerId: ps.playerId }));
    const ev = { input, kind: 'normal', round: this.round, spawns };
    this.dispatch(ps, 'onBattleStart', ev);
    return {
      seed: deriveSeed(this.seed, `n:${this.round}:${ps.seat}`),
      kind: 'normal',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.NORMAL_RECT },
      timeLimit: wave.timeLimit,
      players: [ev.input && typeof ev.input === 'object' ? ev.input : input],
      spawns: this._sanitizeSpawns(Array.isArray(ev.spawns) ? ev.spawns : spawns, ps.playerId),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: true, ...this.gd.dp },
      fieldId: `n:${ps.playerId}`,
      enemyOverrides: wave.overrides,
      waveId: wave.templateId,
    };
  }

  _defaultWatch() {
    this.watchers.clear();
    for (const ps of this._viewers()) {
      const own = this.fields.find((f) => f.players.includes(ps.playerId));
      const f = own || this.fields[0];
      if (!f) continue;
      this.watchers.set(ps.playerId, f.fieldId);
      if (ps.connected) this._sendField(ps.playerId, f.fieldId);
    }
  }

  startCombat() {
    if (this.clientCombat) { this._startCombatClient(); return; }
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    this.lastResults = new Map();
    this.fields = alive.map((ps) => ({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], battle: this._normalBattle(ps), live: true }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, { onDone: (runner) => this.combatDone(runner) });
    this.runner.start();
  }

  /** Aggregate a finished field's content/engine errors (battle.errors: unique records) for diagnostics. */
  _collectSimErrors(f, res) {
    this.simErrors += Number(res && res.errors) || 0;
    const list = f && f.battle && Array.isArray(f.battle.errors) ? f.battle.errors : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const key = `${e.label}|${e.who || ''}|${e.message}`;
      let rec = this.simErrorLog.get(key);
      if (!rec) {
        if (this.simErrorLog.size >= 500) continue;
        rec = { label: String(e.label), who: String(e.who || ''), message: String(e.message), stack: e.stack ? String(e.stack) : null, battles: 0, count: 0 };
        this.simErrorLog.set(key, rec);
      }
      rec.battles++;
      rec.count++;
    }
  }

  combatDone(runner) { this._finishCombat((f) => runner.resultOf(f)); }

  /** Every normal field has its result: record them, then 联防 or SETTLE. */
  _finishCombat(resultOf) {
    if (this.phase !== PHASE.COMBAT) return;
    this._stopClientCombat();
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        this.lastResults.set(pid, pp || { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, unitsEnd: [], unitStats: [] });
        // the views show the layers the battle reached until settle() makes them persistent (DESIGN §20.15)
        const ps = this.players.get(pid);
        const gains = pp && pp.layerGains && typeof pp.layerGains === 'object' ? pp.layerGains : null;
        if (ps && gains && Object.keys(gains).length) { ps.pendingLayerGains = { ...gains }; ps.dirty(); }
      }
    }
    for (const f of this.fields) f.live = false;
    this.deadline = 0;
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterCombat());
  }

  /**
   * After the COMBAT_END pause: 联防 or SETTLE. The plan is made now, from the players still in — a player who quit
   * during the last field or the pause (中途退出 = eliminated, board cleared) is neither a helper nor a leaker whose
   * enemies re-enter.
   */
  _afterCombat() {
    if (this.phase !== PHASE.COMBAT) return;
    const plan = planUnite(this, this.lastResults);
    if (plan) this.startUnite(plan);
    else this.settle(null, null);
  }

  startUnite(plan) {
    if (this.clientCombat) { this._startUniteClient(plan); return; }
    this.phase = PHASE.UNITE;
    this.unitePlan = plan;
    const limit = this.wave ? this.wave.timeLimit : 60;
    const battle = this.newBattle(this._uniteOpts(plan, limit));
    this.fields = [{ fieldId: 'u', kind: 'unite', players: plan.helpers.map((p) => p.playerId), battle, live: true }];
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.tickerText(`联防阶段：${plan.helpers.map((p) => p.name).join('、')} 迎战突破防线的敌人`, FLOW_TICKER_PRIORITY);
    this._uniteLeftKey = null;
    this.runner = new FieldRunner(this, this.fields, {
      onTick: (runner) => this._uniteTick(runner),
      onDone: (runner) => {
        if (this.phase !== PHASE.UNITE) return;
        const res = runner.resultOf(this.fields[0]);
        this._collectSimErrors(this.fields[0], res);
        this.fields[0].live = false;
        this.deadline = 0;
        this.markPublic();
        this.later(this.scaled(DELAYS.COMBAT_END), () => this.settle(plan, res));
      },
    });
    this.runner.start();
  }

  /** Battle options of the 联防 field (helpers' carried end state, the leakers' enemies). */
  _uniteOpts(plan, limit) {
    const { wave, players } = uniteBattleOpts(this, plan, limit);
    return {
      seed: deriveSeed(this.seed, `u:${this.round}`),
      kind: 'unite',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.UNITE_RECT },
      timeLimit: limit,
      players,
      spawns: this._sanitizeSpawns(wave.spawns),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: false, ...this.gd.dp },
      fieldId: 'u',
      // leaked enemies re-enter with the stats they had: the round template's stat overrides apply again
      enemyOverrides: this.wave && this.wave.overrides ? this.wave.overrides : {},
      waveId: wave.templateId,
    };
  }

  // ===================================================================================================
  // client-side combat (DESIGN §14)

  /** Stop every client-combat timer and the headless pacer (phase end, finish, dispose). */
  _stopClientCombat() {
    if (this._progressTimer) { this.cancel(this._progressTimer); this._progressTimer = null; }
    if (this._bossClock) { this.cancel(this._bossClock); this._bossClock = null; }
    this._bossClockOn = false;
    // a pending throttled boss refresh: the merged team LP is written back now (m.result / settlement read it)
    if (this._bossPubTimer) { this.cancel(this._bossPubTimer); this._bossPubTimer = null; this._syncTeamLp(); this.markPublic(); }
    this._clearPause();
    if (this._poolTimer) { this.cancel(this._poolTimer); this._poolTimer = null; }
    if (this.pacer) { try { this.pacer.stop(); } catch { /* ignore */ } this.pacer = null; }
    for (const f of this.fields) this._clearFieldTimers(f);
  }

  _clearFieldTimers(f) {
    if (!f || !f.cc) return;
    for (const k of ['deadlineTimer', 'doneTimer', 'waitTimer', 'sliceTimer']) if (f[k]) { this.cancel(f[k]); f[k] = null; }
    f.job = null;
  }

  /** A client-combat field record: the JSON BattleSpec of its Battle options plus the authority / result state. */
  _ccField({ fieldId, kind, players, opts, boss = null }) {
    const seq = `${this.battlePrefix}.${this.round}.${++this._battleSeq}`;
    // protocol ids are ≤ 64 chars (shared/protocol.js isId): the field id is informational, the sequence is unique
    const battleId = seq.length + 1 + String(fieldId).length <= 64 ? `${seq}.${fieldId}` : seq;
    const spec = buildBattleSpec({ ...opts, battleId, fieldId, kind, content: this.battleContent, boss });
    let total = 0;
    for (const x of spec.spawns) if (x && x.tag !== 'boss' && x.tag !== 'part') total += Math.max(1, Math.floor(Number(x.count) || 1));
    return {
      cc: true, fieldId, kind, players: players.slice(), battleId, spec, battle: null, live: true, done: false,
      mode: null, authority: null, startAt: this.sched.now(), result: null, resultSource: null, timeline: null, endGt: null,
      progress: { gt: 0, killed: 0, total, leaks: 0, done: false }, lastProgressAt: this.sched.now(),
      bossAcked: 0, bossBy: {}, lpAcked: 0, lpCum: 0, deadlineTimer: null, doneTimer: null, waitTimer: null,
      // boss fields: the latest client reports (re-credited as the plausibility budget grows), the server run's
      // CreditPool, humans demoted for an implausible result (never the authority of this field again), a 'cleared'
      // b.result waiting for the budget to credit the pool it emptied (`heldResult`, _onResult)
      bossReported: null, lpReported: 0, credit: null, demoted: new Set(), heldResult: null,
    };
  }

  /** A battle built from a spec on the server (headless / takeover / verification); never throws. */
  _specBattle(spec, { sharedBoss = null } = {}) {
    try {
      return createBattleFromSpec(spec, this.ds, { BattleClass: this.BattleClass, sharedBoss, logger: this.log, recordEvents: false });
    } catch (e) {
      this.reportError(`battle ${spec && spec.fieldId} construct`, e);
      return new DeadBattle({ fieldId: spec && spec.fieldId, kind: spec && spec.kind, players: (spec && spec.players) || [], rect: spec && spec.rect, stageId: spec && spec.stageId }, 'forced');
    }
  }

  /** Game seconds a field has run (its clock; a finished field: its final time). */
  _fieldElapsed(f) {
    if (f.done && f.result && Number.isFinite(f.result.time)) return f.result.time;
    const gt = Math.max(0, ((this._clockNow() - f.startAt) / 1000) * this.gameSpeed);
    if (f.endGt != null) return Math.min(gt, f.endGt);
    const lim = f.spec && f.spec.timeLimit > 0 ? f.spec.timeLimit : HARD_CAP_SECONDS;
    return Math.min(gt, lim);
  }

  /** m.public.fields[].progress: { killed, total, done } (teammates' waiting UI). */
  _fieldProgress(f) {
    if (!f) return null;
    if (!f.cc) {
      const b = f.battle;
      if (!b) return null;
      return { killed: Number(b.killed) || 0, total: Number(b.total) || 0, done: !f.live };
    }
    if (f.done && f.result) {
      let killed = 0, total = 0;
      for (const pp of Object.values(f.result.perPlayer || {})) { killed += Number(pp && pp.killed) || 0; total += Number(pp && pp.total) || 0; }
      if (f.result.synthetic) { killed = f.progress.killed; total = f.progress.total; }
      return { killed, total, done: true };
    }
    if (f.mode === 'server' && f.timeline) {
      const [, killed, total] = timelineAt(f.timeline, this._fieldElapsed(f));
      return { killed, total, done: false };
    }
    return { killed: f.progress.killed, total: f.progress.total, done: false };
  }

  /**
   * LP a player's own battle of this normal round will cost at settlement so far — settle()'s min(lpCapPerRound,
   * counted leaks) — for the teammates' live LP (m.public players[].pendingLp, user playtest #3 item 2; the own client
   * counts its local battle itself). COMBAT: the recorded result once every field is done, else the field's result, else
   * the authority's b.progress leaks (a server-run field reports none before its result is released); 联防: a leaker's
   * enemies still standing on the 联防 field (_uniteLeft, uncapped in `uniteLeft`, user playtest #6 item 7), anyone
   * else's own battle count (0: they were perfect). Omitted when 0 and in every other phase (boss rounds charge the
   * merged team LP live).
   * @returns {{ pendingLp?: number, uniteLeft?: number }}
   */
  _pendingLpView(ps) {
    if (!ps || !ps.alive || (this.phase !== PHASE.COMBAT && this.phase !== PHASE.UNITE)) return {};
    const counted = (r) => (r && Array.isArray(r.leaked) ? r.leaked.filter((l) => l && l.counted !== false).length : 0);
    // 联防: a leaker's enemies still standing on the 联防 field (uncapped), the loss capped like settle()
    const left = this._uniteLeft(ps);
    if (left != null) {
      const loss = Math.min(this.gd.lpCapPerRound, left);
      return loss > 0 ? { uniteLeft: left, pendingLp: loss } : { uniteLeft: left };
    }
    let n = 0;
    if (this.lastResults.has(ps.playerId)) n = counted(this.lastResults.get(ps.playerId));
    else if (this.phase === PHASE.COMBAT) {
      const f = this.fields.find((x) => x && x.kind === 'normal' && Array.isArray(x.players) && x.players.includes(ps.playerId));
      if (f && f.cc) n = f.done && f.result ? counted(f.result.perPlayer && f.result.perPlayer[ps.playerId]) : Number(f.progress && f.progress.leaks) || 0;
      else if (f && f.battle) { try { n = battleProgress(f.battle).leaks; } catch { n = 0; } }
    }
    const loss = Math.min(this.gd.lpCapPerRound, Math.max(0, Math.trunc(Number(n) || 0)));
    return loss > 0 ? { pendingLp: loss } : {};
  }

  /**
   * 联防 (user playtest #6 item 7; PRTS 卫戍协议/帮助 "防卫失败的玩家可通过上方信息栏确认自身所属敌人的剩余数量"): how many of
   * a leaker's enemies are still standing on the 联防 field — not spawned yet, alive, or through the objective again —
   * plus its leaks that could not re-enter: what settle() charges it (before the per-round cap) if the 联防 ended now.
   * It falls as the helpers strike them down and rises when one splits or summons (the children carry the leaker).
   * Live from the field (client run: the authority's b.progress `left`; server run: the headless timeline on the field
   * clock, or the streamed battle itself), clamped to what settlement can bill that leaker (fields.js uniteBillBounds:
   * sent in + the offspring bound, validateClientResult's budget); exact once the field has its result (unite.js
   * uniteSurvivors; a synthetic result charges the own leaks, as settle()). null for anyone but a leaker of the running
   * 联防.
   * @returns {number|null}
   */
  _uniteLeft(ps) {
    const plan = this.unitePlan;
    if (this.phase !== PHASE.UNITE || !plan || !ps || !plan.leakers.includes(ps)) return null;
    const pid = ps.playerId;
    const f = this.fields.find((x) => x && x.kind === 'unite') || null;
    let res = null;
    if (f && f.cc) res = f.done ? f.result : null;
    else if (f && f.battle && f.battle.finished) { try { res = f.battle.result(); } catch { res = null; } }
    if (res && res.synthetic) {
      const own = this.lastResults.get(pid);
      return own && Array.isArray(own.leaked) ? own.leaked.filter((l) => l && l.counted !== false).length : 0;
    }
    if (res) return uniteSurvivors(plan, res).get(pid) || 0;
    const sent = plan.leaked.filter((l) => l.sourcePlayerId === pid).length;
    let live = null;
    if (f && f.cc) {
      if (f.mode === 'server' && f.timeline) {
        const sample = timelineAt(f.timeline, this._fieldElapsed(f));
        live = sample && sample[3] && typeof sample[3] === 'object' ? sample[3] : null;
      } else live = f.progress && f.progress.left && typeof f.progress.left === 'object' ? f.progress.left : null;
    } else if (f && f.battle) {
      try { live = uniteLeft(f.battle); } catch { live = null; }
    }
    if (!this._uniteBounds || this._uniteBounds.plan !== plan) this._uniteBounds = { plan, bounds: uniteBillBounds(plan.leaked, this.gd) };
    const bound = this._uniteBounds.bounds.get(pid) ?? sent;
    const standing = live ? Math.min(bound, Math.max(0, Math.trunc(Number(live[pid]) || 0))) : sent;
    return standing + (plan.notReentered.get(pid) || 0);
  }

  /** Server-run 联防 (streaming mode): refresh m.public about once a game second when a leaker's count moved. */
  _uniteTick(runner) {
    const f = runner && runner.fields ? runner.fields[0] : null;
    if (!f || !f.battle || runner.ticks % 30 !== 0) return;
    let key = '';
    try { key = JSON.stringify(uniteLeft(f.battle)); } catch { key = ''; }
    if (key === this._uniteLeftKey) return;
    this._uniteLeftKey = key;
    this.markPublic();
  }

  /** The connected human who simulates a field: lowest seat among its players (normal: the owner). */
  _authorityFor(f, exclude = null) {
    let best = null;
    for (const pid of f.players) {
      if (pid === exclude || (f.demoted && f.demoted.has(pid))) continue;
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left || !ps.connected) continue;
      if (!best || ps.seat < best.seat) best = ps;
    }
    return best ? best.playerId : null;
  }

  /**
   * The spec a spectator seat is shown: the field's own, minus the players' `contentInfo.funds` — a private number (the
   * player's funds at the battle start) that no battle effect reads, so the replica still plays the same battle. The
   * other contentInfo counters stay: battle effects read them (sim/content: handUnits, roundStats.gainedChess).
   */
  _spectatorSpec(f) {
    if (!f.spectatorSpec) {
      const s = f.spec;
      const strip = (p) => {
        if (!p || !p.contentInfo || !Object.hasOwn(p.contentInfo, 'funds')) return p;
        const { funds, ...contentInfo } = p.contentInfo;
        void funds;
        return { ...p, contentInfo };
      };
      f.spectatorSpec = s && Array.isArray(s.players) ? { ...s, players: s.players.map(strip) } : s;
    }
    return f.spectatorSpec;
  }

  /** b.start of a field for one recipient (`watch`: not a player of the field). */
  _startMsg(f, pid, { watch = false } = {}) {
    return {
      t: 'b.start', battleId: f.battleId, fieldId: f.fieldId, kind: f.kind,
      spec: this.spectators.has(pid) ? this._spectatorSpec(f) : f.spec,
      authoritative: !!(!f.done && f.mode === 'client' && f.authority === pid && !watch),
      startAt: f.startAt, serverNow: this.sched.now(), elapsed: Math.round(this._fieldElapsed(f) * 1000) / 1000,
      speed: this.gameSpeed, watch: !!watch, done: !!f.done,
    };
  }

  _sendStart(pid, f, opts = {}) {
    const ps = this.players.get(pid) || this.spectators.get(pid);
    if (!ps || ps.isBot || ps.left || !ps.connected) return false;
    return this.sendTo(pid, this._startMsg(f, pid, opts));
  }

  /** Humans currently shown a field (its players and its watchers, spectator seats included). */
  _humansShowing(f) {
    const out = new Set();
    for (const pid of f.players) out.add(pid);
    for (const [pid, fid] of this.watchers) if (fid === f.fieldId) out.add(pid);
    return [...out].filter((pid) => { const ps = this.players.get(pid) || this.spectators.get(pid); return ps && !ps.isBot && !ps.left; });
  }

  /** Give every field its authority (a connected human) or run it on the server. */
  _launch(fields) {
    const now = this.sched.now();
    this.fields = fields;
    for (const f of fields) { f.startAt = now; f.lastProgressAt = now; }
    for (const f of fields) {
      const auth = this._authorityFor(f);
      if (auth) this._assignClient(f, auth);
      else this._runOnServer(f, 'no-human');
    }
  }

  _assignClient(f, pid) {
    f.mode = 'client';
    f.authority = pid;
    f.lastProgressAt = this.sched.now();
    if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; }
    if (f.kind === 'boss' || f.kind === 'hidden') return; // the pool / team LP / silence watchdog end those
    if (this.paused) { f.rearmDeadline = true; return; }
    this._armDeadline(f);
  }

  /** A client field's result deadline: its time limit on the field clock + RESULT_GRACE_MS (then the server takes over). */
  _armDeadline(f) {
    if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; }
    const lim = f.spec.timeLimit > 0 ? f.spec.timeLimit : 60;
    const at = f.startAt + Math.round((lim / this.gameSpeed) * 1000) + RESULT_GRACE_MS;
    f.deadlineTimer = this.later(Math.max(0, at - this.sched.now()), () => {
      f.deadlineTimer = null;
      if (f.done || f.mode !== 'client') return;
      this._runOnServer(f, 'timeout');
    });
  }

  /** A server-run normal / 联防 field's result is released at the battle's natural end on the field clock. */
  _armRelease(f) {
    if (f.doneTimer) { this.cancel(f.doneTimer); f.doneTimer = null; }
    if (f.done || f.result == null) return;
    if (this.paused) { f.rearmRelease = true; return; }
    const doneAt = f.startAt + Math.round(((f.endGt || 0) / this.gameSpeed) * 1000);
    const wait = this.sched.instant ? 0 : Math.max(0, doneAt - this.sched.now());
    f.doneTimer = this.later(wait, () => { f.doneTimer = null; this._fieldDone(f); });
  }

  /**
   * The server simulates a field: normal / 联防 headlessly at once (the result is released at the battle's natural end
   * on the field's clock, so the teammates' progress UI and the round pacing stay as if it ran live); boss fields in
   * real time on the pacer (they share the pool), fast-forwarded to the field's clock on a takeover.
   */
  _runOnServer(f, reason) {
    const prev = f.mode === 'client' ? f.authority : null;
    if (prev) {
      this.verifyStats.takeovers++;
      this.log.info?.(`[match ${this.roomCode}] ${f.fieldId} R${this.round}: server takeover from ${prev} (${reason})`);
    }
    f.mode = 'server';
    f.authority = null;
    if (f.deadlineTimer) { this.cancel(f.deadlineTimer); f.deadlineTimer = null; }
    // the former authority (still online after a timeout / an invalid result) stops reporting and keeps its view
    if (prev) this.sendTo(prev, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'takeover' });
    if (f.kind === 'boss' || f.kind === 'hidden') { this._bossServerRun(f); return; }
    const job = new HeadlessJob(this._specBattle(f.spec), { onError: (e) => this.reportError(`field ${f.fieldId} step`, e), players: f.players });
    f.job = job;
    f.battle = job.battle;
    f.timeline = job.timeline; // grows while the job runs (the teammates' progress UI reads it on the field clock)
    if (f.sliceTimer) { this.cancel(f.sliceTimer); f.sliceTimer = null; }
    const complete = () => {
      if (f.job !== job || f.done) return;
      f.job = null;
      const run = job.output();
      f.battle = run.battle;
      f.result = run.result;
      f.resultSource = 'server';
      f.timeline = run.timeline;
      f.endGt = Number(run.battle.time) || 0;
      this._armRelease(f);
    };
    if (!Number.isFinite(this.headlessSliceMs)) {
      job.run(Infinity);
      complete();
    } else {
      // a real host: wall-clock-bounded slices in callbacks of their own (3 bot fields at combat start would otherwise
      // block the event loop for ~0.2–0.5 s here, seconds on a low-power mini PC)
      const slice = () => {
        f.sliceTimer = null;
        if (f.job !== job || f.done) return;
        if (job.run(this.headlessSliceMs)) complete();
        else f.sliceTimer = this.later(0, slice);
      };
      f.sliceTimer = this.later(0, slice);
    }
    this._armProgressTicker();
  }

  /** m.public ~1 Hz while server-run fields progress along their timelines. */
  _armProgressTicker() {
    if (this._progressTimer || this.sched.instant) return;
    const tick = () => {
      this._progressTimer = null;
      if (!this.fields.some((f) => f.cc && f.mode === 'server' && !f.done && f.timeline)) return;
      this.markPublic();
      this._progressTimer = this.later(1000, tick);
    };
    this._progressTimer = this.later(1000, tick);
  }

  /** A field has its final result. */
  _fieldDone(f) {
    if (!f || f.done) return;
    f.done = true;
    f.live = false;
    this._clearFieldTimers(f);
    if (!f.result) f.result = syntheticResult(f.players, { bossBy: f.bossBy });
    f.progress.done = true;
    this.markPublic();
    this._maybeFieldsDone();
  }

  _maybeFieldsDone() {
    if (!this.fields.length || this.fields.some((f) => f.cc && !f.done)) return;
    if (!this.fields.every((f) => f.cc)) return;
    if (this.phase === PHASE.COMBAT) this._finishCombat((f) => f.result);
    else if (this.phase === PHASE.UNITE) this._finishUniteClient();
    else if (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) this._finishFinal(this.phase === PHASE.HIDDEN_CORE, (f) => f.result);
  }

  /** An authoritative human disconnected / left: normal & 联防 fields → server takeover; boss → the partner or the server. */
  _authorityLost(ps, why) {
    for (const f of this.fields) {
      if (!f.cc || f.done || f.mode !== 'client' || f.authority !== ps.playerId) continue;
      if (f.kind === 'boss' || f.kind === 'hidden') this._bossHandover(f, why);
      else this._runOnServer(f, why);
    }
  }

  // ---- COMBAT / UNITE

  _startCombatClient() {
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    this.lastResults = new Map();
    this.watchers.clear();
    const fields = alive.map((ps) => this._ccField({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], opts: this._normalOpts(ps) }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._launch(fields);
    // every fighting human runs its own field; eliminated humans (and spectator seats) keep watching (research 09 §3.1
    // "Keep-watching auto-observes the first available field", switching freely with 前往查看): a replica of the first field
    for (const f of fields) for (const pid of f.players) {
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left) continue;
      this.watchers.set(pid, f.fieldId);
      this._sendStart(pid, f);
    }
    const first = fields.find((f) => f.mode === 'client') || fields[0] || null;
    if (first) {
      for (const ps of this._viewers()) {
        if (ps.alive || this.watchers.has(ps.playerId)) continue;
        this.watchers.set(ps.playerId, first.fieldId);
        this._sendStart(ps.playerId, first, { watch: true });
      }
    }
    this.markPublic();
  }

  _startUniteClient(plan) {
    this.phase = PHASE.UNITE;
    this.unitePlan = plan;
    const limit = this.wave ? this.wave.timeLimit : 60;
    const f = this._ccField({ fieldId: 'u', kind: 'unite', players: plan.helpers.map((p) => p.playerId), opts: this._uniteOpts(plan, limit) });
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this.watchers.clear();
    this._launch([f]);
    // helpers and everyone else (as observers, spectator seats included) simulate the same 联防 spec locally
    for (const ps of this._viewers()) {
      this.watchers.set(ps.playerId, 'u');
      this._sendStart(ps.playerId, f, { watch: !f.players.includes(ps.playerId) });
    }
    this.markPublic();
    this.tickerText(`联防阶段：${plan.helpers.map((p) => p.name).join('、')} 迎战突破防线的敌人`, FLOW_TICKER_PRIORITY);
  }

  _finishUniteClient() {
    if (this.phase !== PHASE.UNITE) return;
    const f = this.fields[0];
    const res = f.result;
    this._collectSimErrors(f, res);
    this._stopClientCombat();
    f.live = false;
    this.deadline = 0;
    this.markPublic();
    const plan = this.unitePlan;
    this.later(this.scaled(DELAYS.COMBAT_END), () => this.settle(plan, res));
  }

  // ---- reports

  _fieldByBattle(battleId) {
    return typeof battleId === 'string' ? this.fields.find((f) => f.cc && f.battleId === battleId) || null : null;
  }

  /** b.progress from a field's authority (anything else — a stale battle, a demoted client — is ignored). */
  _onProgress(ps, msg) {
    if (!this.clientCombat) return fail(ERR.WRONG_PHASE, 'server-run combat');
    const f = this._fieldByBattle(msg.battleId);
    if (!f || f.done || f.mode !== 'client' || f.authority !== ps.playerId) return OK;
    const p = f.progress;
    const maxTotal = Math.max(p.total, (f.spec.spawns.length + 1) * 400);
    p.gt = Math.max(p.gt, Math.min(Number(msg.gt) || 0, HARD_CAP_SECONDS));
    // the latest total (spawns never reached before the limit leave it at the end)
    p.total = Math.min(maxTotal, Math.max(0, msg.total | 0));
    p.killed = Math.min(p.total, Math.max(p.killed, msg.killed | 0));
    f.lastProgressAt = this.sched.now();
    if (f.kind === 'boss' || f.kind === 'hidden') {
      this._creditBoss(f, msg.bossDmg, msg.by);
      this._creditLp(f, msg.leaks, true);
      this._checkFinalEnd();
      this._broadcastPool(false);
      // 4 Hz per field: b.pool carries the exact pool / team LP; m.public (boss HP, LP, progress) follows at ~1 Hz
      this._bossPublic();
      return OK;
    }
    if (Number.isFinite(msg.leaks)) p.leaks = Math.max(p.leaks, msg.leaks);
    // 联防: the leakers' enemies still standing (the latest report; clamped where it is read, _uniteLeft)
    if (f.kind === 'unite' && msg.left && typeof msg.left === 'object') p.left = { ...msg.left };
    this.markPublic();
    return OK;
  }

  /** b.result from a field's authority: validated against the spec; an implausible one is replaced by the server's run. */
  _onResult(ps, msg) {
    if (!this.clientCombat) return fail(ERR.WRONG_PHASE, 'server-run combat');
    const f = this._fieldByBattle(msg.battleId);
    if (!f || f.done || f.heldResult || f.mode !== 'client' || f.authority !== ps.playerId) return OK;
    const bossLike = f.kind === 'boss' || f.kind === 'hidden';
    const v = validateClientResult(f.spec, msg.result, { gd: this.gd });
    if (!v.ok) {
      this.verifyStats.rejected++;
      this.log.warn?.(`[match ${this.roomCode}] ${f.fieldId}: rejected client result from ${ps.playerId} (${v.reason}) — server re-simulation`);
      if (bossLike && this._finalEnding) { f.result = syntheticResult(f.players, { bossBy: f.bossBy, time: this._fieldElapsed(f) }); this._fieldDone(f); this._checkFinalEnd(); }
      else if (bossLike) this._bossHandover(f, 'invalid', { demote: true });
      else this._runOnServer(f, 'invalid');
      return OK;
    }
    let result = v.result;
    if (bossLike) {
      // the final b.progress normally carried everything; the result's per-player damage is a lower bound
      const by = {};
      let sum = 0;
      for (const pid of f.players) { const d = Number(result.perPlayer[pid] && result.perPlayer[pid].bossDamage) || 0; by[pid] = d; sum += d; }
      if (sum > f.bossAcked) this._creditBoss(f, sum, by);
      // the client emptied the pool as it saw it (server hp − its unacknowledged damage): what is left on the server is
      // float dust from summing the fields' reports in another order — the boss is down (pools never hold less than
      // BOSS_POOL_MIN_HP, finalAssault.js: this only catches a noise-level disagreement at that boundary)
      const pool = this.bossPool;
      if (result.reason === 'cleared' && this._finalEnding !== 'forced' && pool && pool.hp > 0 && pool.hp < 1 + 1e-6) pool.damage(f.players[0] ?? null, pool.hp);
      // a boss field ends only when the shared pool is empty (the client saw it reach 0) or the match forced the end
      // (b.end): any other result — 'forced' / 'timeout' at t = 0, 'cleared' while the pool still holds — would stop
      // the pair's fight (and, with every field done, end the Final Assault as a defeat). The field is handed to the
      // partner's replica or the server instead, and the sender never reports it again.
      if (!this._finalEnding && !(pool && pool.hp <= 0)) {
        // 'cleared' while the budget still holds part of the client's cumulative report back: when that report covers
        // what the pool holds, the client emptied the pool as it saw it, only faster than BOSS_MIN_CLEAR_GS lets the
        // server credit (999-layer boards kill a 绝境 leader in 2–4 game s; official "boss一秒死", DESIGN §20.10). The
        // result waits: the boss clock credits the report as the budget grows and the pool's end (_endFinal) completes
        // the field with it — no takeover, nothing credited faster than the budget (a forged report gains nothing a
        // b.progress could not already get). The 1 HP slack is the pool's dust floor (BOSS_POOL_MIN_HP).
        const reported = Math.max(sum, f.bossReported ? f.bossReported.cum : 0);
        if (result.reason === 'cleared' && pool && reported - f.bossAcked >= pool.hp - 1) {
          f.heldResult = result;
          return OK;
        }
        this.verifyStats.rejected++;
        this.log.warn?.(`[match ${this.roomCode}] ${f.fieldId}: implausible boss result from ${ps.playerId} (${result.reason} while the pool holds ${pool ? Math.round(pool.hp) : '?'}) — handed over`);
        this._bossHandover(f, 'invalid', { demote: true });
        return OK;
      }
      this._bossResultDamage(f, result);
    } else {
      result = this._verifyResult(f, result);
    }
    f.result = result;
    f.resultSource = 'client';
    this._fieldDone(f);
    if (bossLike) { this._checkFinalEnd(); this._broadcastPool(false); }
    return OK;
  }

  /** A boss field's accepted client result: each player's bossDamage is at least what the server credited them. */
  _bossResultDamage(f, result) {
    for (const pid of f.players) if (result.perPlayer[pid]) result.perPlayer[pid].bossDamage = Math.max(result.perPlayer[pid].bossDamage || 0, f.bossBy[pid] || 0);
  }

  /**
   * SP_VERIFY: re-simulate an accepted client result ('all': now, the server's result wins on a mismatch; 'sample':
   * ~1 battle in 8 in a later callback, mismatches are only logged).
   */
  _verifyResult(f, result) {
    if (this.verifyMode === 'off') return result;
    const check = () => {
      const run = runHeadless(this._specBattle(f.spec), { players: f.players });
      const mine = validateClientResult(f.spec, compactForVerify(run.result), { gd: this.gd });
      const server = mine.ok ? mine.result : run.result;
      this.verifyStats.checked++;
      if (resultDigest(server).hash !== resultDigest(result).hash) {
        this.verifyStats.mismatches++;
        this.log.warn?.(`[match ${this.roomCode}] ${f.fieldId}: client result differs from the server's simulation`);
        return server;
      }
      return null;
    };
    if (this.verifyMode === 'all') return check() || result;
    let h = 0;
    for (let i = 0; i < f.battleId.length; i++) h = (h * 31 + f.battleId.charCodeAt(i)) >>> 0;
    if (h % 8 === 0) this.later(0, () => { try { check(); } catch (e) { this.reportError('verify', e); } });
    return result;
  }

  // ---- watching (research 09 §3.1 / §6.3)

  /**
   * g.watch under client-side combat: the watcher gets the field's spec (b.start, display only) and runs a local
   * replica fast-forwarded to the field's clock. No watching while the own normal battle runs; the other pair's boss
   * field is never shown to a fighting player; eliminated players may watch anything.
   */
  _watchClient(ps, fieldId) {
    const f = this.fields.find((x) => x.fieldId === fieldId) || null;
    if (!f) return fail(ERR.BAD_TARGET, 'no such field');
    const own = this.fields.find((x) => x.players.includes(ps.playerId)) || null;
    if (ps.alive) {
      if ((f.kind === 'boss' || f.kind === 'hidden') && own && own !== f) return fail(ERR.BAD_TARGET, 'other group hidden');
      if (f.kind === 'normal' && own && own !== f && own.live) return fail(ERR.WRONG_PHASE, 'own battle running');
    }
    this.watchers.set(ps.playerId, f.fieldId);
    this.sendTo(ps.playerId, this._startMsg(f, ps.playerId, { watch: !f.players.includes(ps.playerId) }));
    return OK;
  }

  /** Reconnect / resync: the spec of the field the player is on (fast-forwarded by the client). */
  _resendBattle(ps) {
    if (!this.fields.some((f) => f.cc)) return;
    const fid = this.watchers.get(ps.playerId);
    let f = fid ? this.fields.find((x) => x.fieldId === fid) : null;
    if (!f) f = this.fields.find((x) => x.players.includes(ps.playerId)) || (this.phase === PHASE.UNITE ? this.fields[0] : null);
    if (!f && !ps.alive) f = this.fields[0] || null;
    if (!f) return;
    this.watchers.set(ps.playerId, f.fieldId);
    this.sendTo(ps.playerId, this._startMsg(f, ps.playerId, { watch: !f.players.includes(ps.playerId) }));
  }

  // ---- Final Assault / Hidden Core

  _startFinalClient(hidden) {
    const pool = this.bossPool;
    const recs = this.fields.map((x) => this._ccField({ fieldId: x.fieldId, kind: x.kind, players: x.players, opts: x.opts, boss: { poolHp: pool.hp, poolMax: pool.maxHp } }));
    this._finalEnding = null;
    this._bossStartAt = this.sched.now();
    this.watchers.clear();
    if (!recs.some((f) => this._authorityFor(f))) {
      // nobody to simulate on a client: the server runs every boss field (FieldRunner, no streaming)
      this.fields = recs;
      for (const f of recs) {
        f.mode = 'server';
        // a CreditPool with nothing acknowledged credits everything; it counts this field's damage for b.pool `acked`
        f.credit = new CreditPool(pool);
        f.battle = this._specBattle(f.spec, { sharedBoss: f.credit });
        try {
          f.battle.on('enemyLeak', (ctx) => this._bossLeak(ctx && ctx.enemy), { priority: -1000, owner: 'match' });
          f.battle.on('lpLoss', (ctx) => this._teamLpLoss(ctx && ctx.amount), { priority: -1000, owner: 'match' });
        } catch (e) { this.reportError('boss leak hook', e); }
      }
      this._watchBossFields(recs);
      this.markPublic();
      this.runner = new FieldRunner(this, recs, {
        onTick: (runner) => this._bossTick(runner),
        onDone: (runner) => this._finalDone(runner, hidden),
        emit: false,
      });
      this.runner.start();
      return;
    }
    this._launch(recs);
    this._watchBossFields(recs);
    this.markPublic();
    this._broadcastPool(true);
    this._bossClockOn = true;
    this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
  }

  /** b.start of the boss fields: players get their own pair field, eliminated humans and spectator seats the first. */
  _watchBossFields(fields) {
    for (const ps of this._viewers()) {
      const own = fields.find((f) => f.players.includes(ps.playerId)) || null;
      const f = own || fields[0];
      if (!f) continue;
      this.watchers.set(ps.playerId, f.fieldId);
      this._sendStart(ps.playerId, f, { watch: !own });
    }
  }

  /** The most shared-pool damage a boss field's client reports may have credited by now (server field clock). */
  _bossDmgBudget(f) {
    return this.bossPool ? (this.bossPool.maxHp * this._fieldElapsed(f)) / BOSS_MIN_CLEAR_GS : 0;
  }

  /** The most team LP a boss field's client reports may have cost by now (server field clock). */
  _bossLpBudget(f) {
    return BOSS_LP_BURST + BOSS_LP_PER_GS * this._fieldElapsed(f);
  }

  /**
   * A boss field's shared-pool damage, as reported cumulatively by its client (`by`: per player) — credited up to the
   * plausibility budget of the field clock; the rest is credited by later reports / the boss clock (`bossReported`).
   */
  _creditBoss(f, cum, by) {
    const pool = this.bossPool;
    const reported = Number(cum);
    // the team LP ran out first: the run failed at that moment (PRTS "…使目标生命值扣除至0，则无视倒计时直接失败"), so
    // damage reported afterwards — in flight, or rounded up in the final b.result — changes nothing (user playtest #6)
    if (!pool || !Number.isFinite(reported) || this._finalEnding === 'forced') return;
    if (!f.bossReported || reported > f.bossReported.cum) f.bossReported = { cum: reported, by: by && typeof by === 'object' ? { ...by } : null };
    const c = Math.min(reported, this._bossDmgBudget(f));
    if (!(c > f.bossAcked)) return;
    const delta = c - f.bossAcked;
    f.bossAcked = c;
    let attributed = 0;
    if (by && typeof by === 'object') {
      for (const pid of f.players) {
        const v = Number(by[pid]);
        const prev = f.bossBy[pid] || 0;
        if (!Number.isFinite(v) || v <= prev) continue;
        const d = Math.min(delta - attributed, v - prev);
        if (d > 0) { f.bossBy[pid] = prev + d; pool.damage(pid, d); attributed += d; }
      }
    }
    if (delta - attributed > 0) {
      const pid = by ? null : f.players[0];
      if (pid) f.bossBy[pid] = (f.bossBy[pid] || 0) + (delta - attributed);
      pool.damage(pid, delta - attributed);
    }
  }

  /** A boss field's LP cost (leaks × lpr + leader LP effects): `cumulative` totals from its client, deltas from the server run. */
  _creditLp(f, amount, cumulative = false) {
    let n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    if (cumulative) {
      // a client's cumulative report: credited up to the field clock's plausibility budget (the rest later)
      if (n > f.lpReported) f.lpReported = n;
      n = Math.min(n, this._bossLpBudget(f));
      if (n <= f.lpAcked) return;
      const d = n - f.lpAcked;
      f.lpAcked = n;
      this._teamLpLoss(d);
      return;
    }
    const before = f.lpCum;
    f.lpCum += n;
    const credit = Math.max(0, f.lpCum - Math.max(before, f.lpAcked));
    if (credit > 0) this._teamLpLoss(credit);
  }

  /** The server runs a boss field in real time (no client left): credits only what exceeds the client's reports. */
  _bossServerRun(f) {
    const credit = new CreditPool(this.bossPool, { acked: f.bossAcked, ackedBy: f.bossBy });
    const battle = this._specBattle(f.spec, { sharedBoss: credit });
    f.battle = battle;
    f.credit = credit;
    f.lpCum = 0;
    try {
      battle.on('enemyLeak', (ctx) => { const e = ctx && ctx.enemy; if (e) this._creditLp(f, Number.isFinite(e.lpr) && e.lpr >= 0 ? e.lpr : 1); }, { priority: -1000, owner: 'match' });
      battle.on('lpLoss', (ctx) => this._creditLp(f, ctx && ctx.amount), { priority: -1000, owner: 'match' });
    } catch (e) { this.reportError('boss leak hook', e); }
    if (!this.pacer) this.pacer = new HeadlessPacer(this);
    const entry = this.pacer.add({
      battle,
      onDone: () => {
        if (f.done) return;
        let res = null;
        try { res = battle.result(); } catch (e) { this.reportError('boss result', e); }
        f.result = res && res.perPlayer ? res : syntheticResult(f.players, { bossBy: f.bossBy });
        f.resultSource = 'server';
        this._fieldDone(f);
        this._checkFinalEnd();
      },
      onTick: () => this._checkFinalEnd(),
    });
    const gt = this._fieldElapsed(f);
    // the fast-forward to the field clock is spread over the pacing intervals on a real host (virtual time: at once)
    if (gt > 0 && !entry.done) this.pacer.skipTo(entry, gt, { budgetTicks: this.sched.virtual ? Infinity : CATCHUP_TICKS_PER_INTERVAL });
  }

  /**
   * A boss field's authority left, went silent or sent an implausible result (`demote`: never its authority again):
   * its partner (a replica already running) takes over, else the server.
   */
  _bossHandover(f, why, { demote = false } = {}) {
    if (f.done || f.mode !== 'client' || f.heldResult) return; // a held 'cleared' result is in: nothing left to run
    const prev = f.authority;
    if (demote && prev) f.demoted.add(prev);
    const next = this._authorityFor(f, prev);
    if (next) {
      f.authority = next;
      f.lastProgressAt = this.sched.now();
      if (prev) this.sendTo(prev, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'takeover' });
      this._sendStart(next, f);
      return;
    }
    this._runOnServer(f, why);
  }

  _bossClockTick() {
    this._bossClock = null;
    if (this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return;
    if (this.paused) return; // re-armed by _resume
    const now = this.sched.now();
    this._applyOvertime(((now - this._bossStartAt) / 1000) * this.gameSpeed);
    for (const f of this.fields) {
      // reports held back by the plausibility budget are credited as the field clock advances
      if (f.cc && !f.done && f.mode === 'client') {
        if (f.bossReported && f.bossReported.cum > f.bossAcked) this._creditBoss(f, f.bossReported.cum, f.bossReported.by);
        if (f.lpReported > f.lpAcked) this._creditLp(f, f.lpReported, true);
      }
      if (f.cc && !f.done && f.mode === 'client' && !f.heldResult && now - f.lastProgressAt > BOSS_SILENCE_MS) {
        this.log.info?.(`[match ${this.roomCode}] ${f.fieldId}: no progress from ${f.authority} — handing the field over`);
        this._bossHandover(f, 'silent');
      }
    }
    this._checkFinalEnd();
    this._broadcastPool(false);
    if (this.fields.some((f) => f.cc && !f.done)) this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    else this._bossClockOn = false;
  }

  /** Pool depleted → victory; team LP 0 → defeat: every boss field is ended. */
  _checkFinalEnd() {
    if (this._finalEnding || !this.bossPool || !this.fields.some((f) => f.cc)) return;
    if (this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return;
    if (this.bossPool.hp <= 0) this._endFinal('cleared');
    else if (this.teamLp != null && this.teamLp <= 0) this._endFinal('forced');
  }

  _endFinal(reason) {
    if (this._finalEnding) return;
    this._finalEnding = reason;
    this._broadcastPool(true);
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      if (f.mode === 'server' && f.battle) {
        try { f.battle.forceEnd('forced'); } catch (e) { this.reportError('boss forceEnd', e); }
        let res = null;
        try { res = f.battle.result(); } catch (e) { this.reportError('boss result', e); }
        f.result = res && res.perPlayer ? res : syntheticResult(f.players, { bossBy: f.bossBy });
        f.resultSource = 'server';
        continue; // _fieldDone below (after every field was told)
      }
      for (const pid of this._humansShowing(f)) this.sendTo(pid, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason });
      if (f.heldResult) {
        // its authority already reported 'cleared' (_onResult): that result completes the field
        f.result = f.heldResult;
        this._bossResultDamage(f, f.result);
        f.resultSource = 'client';
        continue; // _fieldDone below
      }
      f.waitTimer = this.later(this.scaled(BOSS_RESULT_GRACE_MS), () => {
        f.waitTimer = null;
        if (f.done) return;
        f.result = syntheticResult(f.players, { bossBy: f.bossBy, time: this._fieldElapsed(f) });
        this._fieldDone(f);
      });
    }
    if (this.pacer) { this.pacer.stop(); this.pacer = null; }
    for (const f of this.fields) if (f.cc && !f.done && (f.mode === 'server' || f.heldResult)) this._fieldDone(f);
  }

  /** b.pool { hp, max, teamLp, acked } to everyone (≤ 4 Hz; `force` skips the dedupe, never the rate). */
  _broadcastPool(force) {
    if (!this.bossPool || this.disposed) return;
    const now = this.sched.now();
    if (now - this._lastPoolAt < POOL_MIN_GAP_MS) {
      if (!this._poolTimer) {
        this._poolTimer = this.later(Math.max(1, POOL_MIN_GAP_MS - (now - this._lastPoolAt)), () => { this._poolTimer = null; this._broadcastPool(force); });
      }
      return;
    }
    // exact numbers: a client shows `hp − (its cumulative damage − acked)` and ends its battle as 'cleared' when that
    // reaches 0 — rounded values could show 0 while the server's pool still holds a fraction of a point
    // a server-run field (no client left, or none at all): what its battle has put into the pool so far — a display
    // replica (a reconnecting / watching human) subtracts only its local damage beyond that from the server hp
    const acked = {};
    for (const f of this.fields) if (f.cc) acked[f.fieldId] = f.mode === 'server' && f.credit ? Math.max(f.bossAcked, f.credit.cum) : f.bossAcked;
    const msg = {
      t: 'b.pool', hp: Math.max(0, this.bossPool.hp), max: this.bossPool.maxHp,
      teamLp: this.teamLp == null ? null : Math.max(0, Math.round(this.teamLp)), acked,
    };
    const key = JSON.stringify(msg);
    if (!force && key === this._lastPoolKey) return;
    this._lastPoolKey = key;
    this._lastPoolAt = now;
    this.broadcast(msg);
  }

  // ===================================================================================================
  // SETTLE

  settle(plan, uniteResult) {
    this.phase = PHASE.SETTLE;
    this.runner = null;
    this._stopClientCombat();
    // the pending in-battle gains the views showed become persistent below (alive players) or lapse (DESIGN §20.15)
    for (const ps of this.order) if (ps.pendingLayerGains) { ps.pendingLayerGains = null; ps.dirty(); }
    const cap = this.gd.lpCapPerRound;
    // a 联防 battle that could not run at all (synthetic result) must not wipe the leakers' losses: charge their own leaks
    const uniteRan = !!(plan && uniteResult && !uniteResult.synthetic);
    const survivors = uniteRan ? uniteSurvivors(plan, uniteResult) : null;
    const alive = this.alivePlayers();
    for (const ps of alive) {
      const r = this.lastResults.get(ps.playerId) || { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0 };
      const counted = (r.leaked || []).filter((l) => l && l.counted !== false).length;
      const loss = uniteRan && plan.leakers.includes(ps) ? Math.min(cap, survivors.get(ps.playerId) || 0) : Math.min(cap, counted);
      ps.lp -= loss;
      ps.stats.lpLost += loss;
      ps.stats.leaks += counted;
      ps.stats.kills += Number(r.killed) || 0;
      ps.stats.dmgDealt += Number(r.damageDealt) || 0;
      ps.stats.healing += Number(r.healingDone) || 0;
      if (r.perfect !== false && counted === 0) ps.stats.perfectRounds++;
      // bounty coins (own battle + unite kills) are credited to the next prep
      let coins = Math.max(0, Math.trunc(Number(r.coins) || 0));
      const up = uniteResult && uniteResult.perPlayer && uniteResult.perPlayer[ps.playerId];
      if (up) {
        coins += Math.max(0, Math.trunc(Number(up.coins) || 0));
        ps.stats.dmgDealt += Number(up.damageDealt) || 0;
        ps.stats.kills += Number(up.killed) || 0;
      }
      // perfect-payout bounties (战术特训): own phase perfect
      for (const b of ps.bounties) if (b.card.payout === 'perfect' && counted === 0 && r.perfect !== false) coins += b.card.coin;
      if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
      for (const b of ps.bounties) b.roundsLeft--;
      ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
      // IN_BATTLE layer gains (normal battles only), at most the room left under BOND_LAYER_CAP (999, as the battle's
      // live copy: Battle.addLayers); a bond at the cap gains nothing and dispatches nothing
      for (const [bondId, n] of Object.entries(r.layerGains || {})) {
        if (!this.gd.bond(bondId) || !(n > 0)) continue;
        const before = ps.layers[bondId] || 0;
        const add = layerGainRoom(before, Math.floor(n));
        if (!(add > 0)) continue;
        ps.layers[bondId] = before + add;
        this.dispatch(ps, 'onLayers', { bondId, from: before, to: ps.layers[bondId], reason: 'battle' });
      }
      this._charDamageTickers(ps, r);
      this.dispatch(ps, 'onBattleResult', { result: r, lpLoss: loss, perfect: counted === 0 && r.perfect !== false, unite: uniteResult || null });
      ps.recompute();
    }
    for (const ps of alive) {
      if (ps.lp <= 0) {
        ps.lp = 0;
        ps.eliminate(this.round);
        this.toast(ps, 'error', '你的目标生命值耗尽，已被淘汰');
        this.tickerText(`${ps.name}博士的目标生命值已耗尽`, FLOW_TICKER_PRIORITY);
      }
    }
    this.fields = [];
    this.watchers.clear();
    this.markPublic();
    this.setDeadline(DELAYS.SETTLE / 1000, () => this.afterSettle(), { silent: this.soloUntimed });
  }

  /**
   * CHAR_DAMAGE tickers: one per board unit of the battle (its highest threshold); units created in battle (summons,
   * no board uid) count once per unit type (the highest of them) — a result can never announce more units than the
   * lineup has kinds of.
   */
  _charDamageTickers(ps, r) {
    const steps = (Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts : []).filter((b) => b.type === 'CHAR_DAMAGE' && Array.isArray(b.params)).map((b) => Number(b.params[0])).filter((n) => n > 0).sort((a, b) => b - a);
    if (!steps.length) return;
    const board = new Set();
    for (const p of ps.board.values()) board.add(p.uid);
    const best = new Map();
    for (const u of r.unitStats || []) {
      if (!u) continue;
      const key = Number.isInteger(u.uid) && board.has(u.uid) ? `uid:${u.uid}` : `def:${u.defId}`;
      const cur = best.get(key);
      if (!cur || (Number(u.dmg) || 0) > (Number(cur.dmg) || 0)) best.set(key, u);
    }
    for (const u of best.values()) {
      const hit = steps.find((s) => (u.dmg || 0) >= s);
      if (hit) this.tickerFor('CHAR_DAMAGE', [ps.name, u.name || u.defId, String(hit)], { playerId: ps.playerId, param: String(hit) });
    }
  }

  afterSettle() {
    if (!this.alivePlayers().length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    this.startRound(this.round + 1);
  }

  // ===================================================================================================
  // FINAL_ASSAULT / HIDDEN_CORE

  startFinalAssault(hidden) {
    const alive = this.alivePlayers();
    if (!alive.length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    this.phase = hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT;
    this.lastResults = new Map();
    if (!hidden) {
      this.teamLp = alive.reduce((s, p) => s + Math.max(0, p.lp), 0);
      for (const ps of alive) ps.lpAtFinal = Math.max(0, ps.lp);
    }
    const bossId = hidden ? this.hiddenBossId : this.bossId;
    // BOSS_HIT tickers ("对敌方领袖造成的伤害超过20% / 50% / 80%"): the player's damage to THIS leader over its pool —
    // the pool's own per-player tally, one pool per boss round. stats.bossDamage (the result's 领袖伤害) adds up both
    // rounds, so it would credit the Final Assault's damage to the hidden leader ("隐藏boss还没打就出了50%播报").
    const hitSteps = new Map();
    const pool = new SharedBossPool(bossPoolHp(this.gd, bossId, alive.length), {
      onHit: (pid, dmg) => {
        const ps = this.players.get(pid);
        if (!ps) return;
        ps.stats.bossDamage += dmg;
        const share = (pool.byPlayer.get(pid) || 0) / pool.maxHp;
        const done = hitSteps.get(pid) || 0;
        let reached = done;
        BOSS_HIT_STEPS.forEach((s, i) => { if (share >= s) reached = Math.max(reached, i + 1); });
        if (reached > done) {
          hitSteps.set(pid, reached);
          this.tickerFor('BOSS_HIT', [ps.name], { playerId: pid, param: String(BOSS_HIT_STEPS[reached - 1]) });
        }
      },
    });
    this.bossPool = pool;
    const groups = pairPlayers(alive);
    const reuse = this.bossWaves && this.bossWaves.length === groups.length && this.bossWaves.every((w, i) => w.players.join() === groups[i].map((p) => p.playerId).join());
    this.fields = groups.map((g, i) => {
      const solo = this.isSolo || g.length === 1;
      const wave = reuse ? this.bossWaves[i].wave : buildBossWave(this.gd, this.rngWaves, this.factions, this.round, { bossId, solo });
      // one spawn list per field, shared by the field's players' onBattleStart handlers (edit it in place)
      const spawns = wave.spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
      // bounties with battles left (a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES) follow their player into the
      // boss field, on the player's half
      g.forEach((ps, j) => {
        for (const b of bountySpawns(this.gd, this.round, wave, ps.bounties, ps.playerId, { solo: this.isSolo, side: j === 0 ? 'L' : 'R' })) spawns.push(b);
      });
      const inputs = g.map((ps, j) => {
        const input = ps.battleInput({ side: j === 0 ? 'L' : 'R', colOffset: j === 0 ? 0 : 8 });
        input.lpForBoss = this.teamLp;
        // `side` + `routes`: the player's half of a pair field (spawn-list edits for one player, e.g. 鸭爵's swap)
        const ev = { input, kind: hidden ? 'hidden' : 'boss', round: this.round, spawns, routes: wave.routes, side: g.length > 1 ? (j === 0 ? 'L' : 'R') : null };
        this.dispatch(ps, 'onBattleStart', ev);
        return ev.input && typeof ev.input === 'object' ? ev.input : input;
      });
      const fieldId = `b${i + 1}`;
      const bopts = {
        seed: deriveSeed(this.seed, `${fieldId}:${this.round}`),
        kind: hidden ? 'hidden' : 'boss',
        modeId: this.modeId,
        round: this.round,
        stageId: this.stageId,
        rect: { ...GEO.BOSS_RECT },
        timeLimit: Infinity,
        players: inputs,
        spawns: this._sanitizeSpawns(spawns),
        routes: wave.routes,
        sharedBoss: this.bossPool,
        flags: { layerGainsEnabled: false, ...this.gd.dp },
        fieldId,
        enemyOverrides: wave.overrides,
        waveId: wave.templateId,
        bossId,
      };
      if (this.clientCombat) return { fieldId, kind: hidden ? 'hidden' : 'boss', players: g.map((p) => p.playerId), opts: bopts, battle: null, live: true };
      const battle = this.newBattle(bopts);
      try {
        battle.on('enemyLeak', (ctx) => this._bossLeak(ctx && ctx.enemy), { priority: -1000, owner: 'match' });
        // leader "扣除目标生命" effects (boss_7 Doom, 斥退 …: server/sim/content/bosses.js lpLoss) hit the team pool
        battle.on('lpLoss', (ctx) => this._teamLpLoss(ctx && ctx.amount), { priority: -1000, owner: 'match' });
      } catch (e) { this.reportError('boss leak hook', e); }
      return { fieldId, kind: hidden ? 'hidden' : 'boss', players: g.map((p) => p.playerId), battle, live: true };
    });
    this.overtimeApplied = 0;
    // HUD: the boss level's countdown (maxPlayTime, 120 real s — the battle goes on past it) and the moment the
    // overtime drain starts (150 real s), both on the field clock
    const onClock = (realS) => this.sched.now() + Math.round(((realS * this.gd.combatTimeScale) / this.gameSpeed) * 1000);
    const levelTime = this.gd.bossLevelTime(this.round);
    this.deadline = this.sched.instant || !levelTime ? 0 : onClock(levelTime);
    this.overtimeAt = this.sched.instant ? 0 : onClock(this.gd.bossOvertimeAfterReal);
    if (this.clientCombat) { this._startFinalClient(hidden); return; }
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, {
      onTick: (runner) => this._bossTick(runner),
      onDone: (runner) => this._finalDone(runner, hidden),
    });
    this.runner.start();
  }

  /**
   * Bounties after a boss field: kill-bounty coins go to pending funds (spent in the Hidden Core's prep) and every
   * bounty used one of its battles, exactly like SETTLE does for normal rounds.
   */
  _settleBossBounties(ps, pp) {
    const coins = Math.max(0, Math.trunc(Number(pp.coins) || 0));
    if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
    if (!ps.bounties.length) return;
    for (const b of ps.bounties) b.roundsLeft--;
    ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
    ps.dirty();
  }

  _bossLeak(enemy) {
    if (!enemy || this.teamLp == null) return;
    // lifePointReduce from data: 0 for harmless enemies (e.g. 装置 / unharmful escorts), 1 when absent
    const lpr = Number.isFinite(enemy.lpr) && enemy.lpr >= 0 ? enemy.lpr : 1;
    this._teamLpLoss(lpr);
  }

  _teamLpLoss(amount) {
    const n = Number(amount);
    if (this.teamLp == null || !Number.isFinite(n) || !(n > 0)) return;
    this.teamLp = Math.max(0, this.teamLp - n);
    if (this._bossLazyPublic()) { this._bossPublic(); return; }
    this._syncTeamLp();
    this.markPublic();
  }

  /** Boss rounds under client-side combat: m.public / the per-player LP shares refresh at ~1 Hz (b.pool is live). */
  _bossLazyPublic() {
    return this.clientCombat && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) && this.fields.some((f) => f.cc);
  }

  /** Throttled (BOSS_PUBLIC_MS) refresh of m.public and the players' LP shares during a boss round. */
  _bossPublic() {
    if (this._bossPubTimer || this.disposed || this.ended) return;
    const wait = Math.max(0, BOSS_PUBLIC_MS - (this.sched.now() - this._bossPubAt));
    this._bossPubTimer = this.later(wait, () => {
      this._bossPubTimer = null;
      this._bossPubAt = this.sched.now();
      this._syncTeamLp();
      this.markPublic();
    });
  }

  /**
   * The merged team LP (Final Assault / Hidden Core, research 01 §9) written back to the alive players as shares of
   * what each brought in (`lpAtFinal`, largest remainder, ties → seat), so m.public / m.private / m.result never show
   * the pre-merge LP of a team that lost LP in the boss fight (Σ alive lp = round(teamLp)).
   */
  _syncTeamLp() {
    if (this.teamLp == null) return;
    const alive = this.alivePlayers().filter((p) => p.lpAtFinal != null);
    if (!alive.length) return;
    const total = Math.max(0, Math.round(this.teamLp));
    const base = alive.reduce((s, p) => s + Math.max(0, p.lpAtFinal), 0);
    const rows = alive.map((p) => {
      const v = base > 0 ? (total * Math.max(0, p.lpAtFinal)) / base : total / alive.length;
      const n = Math.floor(v + 1e-9);
      return { p, n, frac: v - n };
    });
    let left = total - rows.reduce((s, x) => s + x.n, 0);
    for (const x of rows.slice().sort((a, b) => b.frac - a.frac || a.p.seat - b.p.seat)) {
      if (left <= 0) break;
      x.n++;
      left--;
    }
    for (const x of rows) if (x.p.lp !== x.n) { x.p.lp = x.n; x.p.dirty(); }
  }

  /**
   * Overtime drain on the boss field clock (`gt` game seconds): 1 team LP per real second from the 150 real-second mark
   * (bossTurnHpReduceTime, gamedata.js bossOvertimeDue).
   */
  _applyOvertime(gt) {
    const due = this.gd.bossOvertimeDue(gt);
    if (due > this.overtimeApplied) {
      const loss = due - this.overtimeApplied;
      this.overtimeApplied = due;
      this._teamLpLoss(loss);
    }
  }

  _bossTick(runner) {
    this._applyOvertime(runner.time);
    if (this.teamLp <= 0 && this.bossPool.hp > 0) runner.forceAll('forced');
    // client-side combat with every boss field on the server: humans that reconnect / watch run display replicas
    // whose LocalBossPool follows b.pool
    if (this.fields.some((f) => f.cc)) { this._broadcastPool(false); this._bossPublic(); }
    else if (runner.ticks % 6 === 0) this.markPublic();
    if (runner.ticks % 30 === 0) this.flush();
  }

  _finalDone(runner, hidden) { this._finishFinal(hidden, (f) => runner.resultOf(f)); }

  /** Every boss field is over: stats, bounties, then the Hidden Core or RESULT. */
  _finishFinal(hidden, resultOf) {
    if (this.phase !== (hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT)) return;
    this._stopClientCombat();
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      f.live = false;
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        const ps = this.players.get(pid);
        if (pp) this.lastResults.set(pid, pp);
        if (pp && ps) {
          ps.stats.dmgDealt += Number(pp.damageDealt) || 0;
          ps.stats.kills += Number(pp.killed) || 0;
          ps.dirty(); // m.private.stats
          this._charDamageTickers(ps, pp);
        }
        if (pp && ps) this._settleBossBounties(ps, pp);
        if (pp && ps) this.dispatch(ps, 'onBattleResult', { result: pp, lpLoss: 0, perfect: !!pp.perfect, boss: true });
      }
    }
    // the end condition the server registered first decides (client-side combat: _endFinal — pool 0 → victory, team LP 0
    // → defeat); a boss field's final result may never turn a defeat into a victory (user playtest #6 item 5)
    const victory = this._finalEnding ? this._finalEnding === 'cleared' : this.bossPool.hp <= 0;
    this._syncTeamLp();
    this.deadline = 0;
    this.overtimeAt = 0;
    this.markPublic();
    this.runner = null;
    if (!hidden) {
      const eligible = victory && !!this.hiddenBossId && hiddenEligible(this.gd, { layerSum: this.hiddenLayerSum, teamLp: this.teamLp });
      this.later(this.scaled(DELAYS.SETTLE), () => {
        if (eligible) {
          this.hiddenReached = true;
          this.bossPool = null;
          this.tickerText('隐秘核心已解锁', FLOW_TICKER_PRIORITY);
          this.startRound(this.gd.hiddenRound);
        } else {
          this.finish({ victory, reason: victory ? 'victory' : 'defeat' });
        }
      });
    } else {
      this.later(this.scaled(DELAYS.SETTLE), () => this.finish({ victory: true, hiddenCleared: victory, reason: 'victory' }));
    }
  }

  // ===================================================================================================
  // RESULT

  finish({ victory, hiddenCleared = false, reason = 'defeat' }) {
    if (this.ended || this.disposed) return;
    this.ended = true;
    if (this.runner) { try { this.runner.stop(); } catch { /* ignore */ } this.runner = null; }
    this._stopClientCombat();
    this.cancel(this._phaseTimer);
    this.cancel(this._turnTimer);
    for (const h of this._timers) { try { this.sched.clearTimeout(h); } catch { /* ignore */ } }
    this._timers.clear();
    this.phase = PHASE.RESULT;
    this.deadline = 0;
    for (const f of this.fields) f.live = false;
    this.outcome = { victory: !!victory, hiddenReached: this.hiddenReached, hiddenCleared: !!hiddenCleared, reason };
    let result;
    try {
      result = buildResult(this, this.outcome);
    } catch (e) {
      this.reportError('buildResult', e);
      result = { t: 'm.result', victory: !!victory, roundsPassed: 0, reason, modeId: this.modeId, difficulty: this.difficulty, players: [] };
    }
    this.lastResultMsg = result;
    this.markPublic();
    try { this.flush(true); } catch (e) { this.reportError('flush', e); }
    // every human still here gets the settlement — the spectator seats the same public rows (none of them their own)
    for (const ps of this._viewers()) this.sendTo(ps.playerId, { ...result, playerId: ps.playerId });
    const { t, ...summary } = result;
    void t;
    summary.errors = this.errorCount;
    try { this.onEndFn(summary); } catch (e) { this.reportError('onEnd', e); }
  }
}
