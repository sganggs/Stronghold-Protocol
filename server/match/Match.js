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
//   opts.aiPicksLast boolean (optional)         the co-op room option 「AI 队友最后选择」 (room.setAiPicksLast, GitHub #338):
//                                              the strategy and 机变 drafts put every human seat before every AI seat
//                                              (MatchPhases.humansFirst); only `true` turns it on; ignored in solo
//   opts.seats       Array<{ seat: 0..3, playerId: string, name: string, isBot: boolean, connected: boolean,
//                            loadout?: { [baseChessId]: { skill: index, module: uniEquipId|'none'|null } } | null,
//                            ops?: { [charId]: { potential: 1–6, cultivate: 0–3 } } | null,
//                            notOwned?: string[] | null,
//                            diy?: { [slotBaseId]: { charId, skillIndex, uniEquipId } } | null }>
//                    sorted by seat, 1–4 entries, ≥ 1 human; solo ⇒ exactly 1 human and no bots.
//                    Bot playerIds start with 'ai_'. Seat indexes may have gaps (e.g. seats 0 and 2).
//                    `loadout` (DESIGN §16, optional): the human's operator loadout, already checked by the lobby
//                    (shared/protocol.js checkLoadout); PlayerState re-checks it against opts.data and ignores it for bots.
//                    `ops` (0.2.2, optional): the human's per-operator 潜能 / 练度 (checkLoadoutOps; missing = 潜能 6, 精英2
//                    Lv.60 — the owner's decision of 2026-10-08), re-checked and changed like the loadout (INFO_CHECK);
//                    bots fight with the defaults.
//                    `notOwned` (0.2.0 补位, optional): the base chess ids the human marked as not owned (干员持有) — fixed
//                    for the match; those chess fight as their stand-ins (PlayerState setNotOwned; bots own everything).
//                    `diy` (0.2.0 自选编队, optional): the human's 自选 picks (shared/protocol.js checkDiyPicks) — fixed for
//                    the match; the slotted operators join the human's own shop (PlayerState setDiy / initDiyStock).
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
// setLoadout(playerId, loadout, ops?) → { ok } | { error, detail? }   (DESIGN §16; optional for the platform) a new
//                           checked operator loadout (and its 潜能 / 练度 `ops`, 0.2.2) from room.loadout. Accepted only
//                           during INFO_CHECK (the briefing's 干员调配 entry); afterwards the match's loadout is locked
//                           (WRONG_PHASE).
// onLeave(playerId)         The human quit permanently (g.leave, room.leave, or the 10-minute reconnect
//                           window expired). They will never return under this playerId in this match;
//                           treat as quit (AI takes over / eliminated per DESIGN). No onDisconnect follows.
// dispose()                 Stop every timer/interval and release resources. Idempotent. After dispose the
//                           platform ignores send/broadcast/onEnd from this instance.
// addSpectator(id)          (optional for the platform) A spectator seat joined during the match, came back or asked
//                           for a resync: register it (idempotent) and resend what an ELIMINATED player watching sees —
//                           m.public and, while a battle runs, the b.start (watch) of the field it watches (default: the
//                           field of the player it follows — the one it last watched, else the first player still in;
//                           server-run mode: m.field + b.snap), in a prep phase that player's board (m.field prep), or
//                           m.result once ended. A spectator gets
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
//                      ('sample': ~1 in 8, in later slices, mismatches logged; 'all': before accepting — the
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
//                      takeovers, result verification; default 8 with a real scheduler, at once with a virtual one)
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
//
// Code layout: this file keeps the constructor (options, seats, the per-match setup, the state fields); the methods
// live in server/match/match/, one module per concern, and are installed on Match.prototype below in a fixed order,
// with the descriptors of class methods (non-enumerable; `this` is the match, subclasses and `super` calls work as
// before):
//   platform.js      the interface above: start, handle, setLoadout, disconnect / reconnect / resync, leave, dispose
//   infra.js         error isolation, timers and the phase deadline, player lists, bonds in the pool, deploy field,
//                    meta dispatch
//   messaging.js     send / broadcast / toasts / tickers, dirty marks, flush (m.private per player, m.public throttled)
//   views.js         m.public (statuses, field progress, pendingLp / uniteLeft), the nextEnemies preview, the prep
//                    scout's m.field
//   watch.js         spectator seats, g.watch, who is shown which field, resend on reconnect, prep-scout pushes
//   intents.js       the g.* / b.* router, emotes, AI 托管, g.unitStats
//   pause.js         the solo pause
//   phases.js        INFO_CHECK, BAND_DRAFT (the strategy draft), BATTLE_CHECK, ROUND_START
//   spDraft.js       SP_DRAFT (机变) and the rolls the meta effects ask for (bounties, item ids, pools)
//   prep.js          PREP: its start, the AI seats' sliced preps, Ready, the deadline, its end
//   combat.js        battle construction, COMBAT (both modes), the per-field results, then 联防 or SETTLE
//   clientCombat.js  client-side combat bookkeeping: field records, the field clock, authority, b.start, result
//                    deadlines and releases, server runs, field completion
//   reports.js       b.progress / b.result (validation, held boss results), SP_VERIFY
//   unitePhase.js    联防 (UNITE) in both modes and the leakers' live counts
//   bossRounds.js    FINAL_ASSAULT / HIDDEN_CORE: boss fields, the shared pool, plausibility budgets, the boss clock,
//                    b.pool, the merged team LP, overtime, bounties after a boss field
//   settle.js        SETTLE and RESULT
//   common.js        what the modules share (FLOW_TICKER_PRIORITY, DELAYS, BAND_TURN_SECONDS — re-exported here, OK,
//                    fail, BOSS_CLOCK_MS)

import { PHASE, modeIdFor } from '../../shared/constants.js';
import { Battle } from '../sim/Battle.js';
import { DataSource } from '../sim/simdata.js';
import { createRng, deriveSeed } from '../sim/rng.js';
import { GameData } from './gamedata.js';
import { RealScheduler } from './scheduler.js';
import { SharedPool, drawDisabledBonds } from './pool.js';
import { PlayerState } from './PlayerState.js';
import { EffectDispatcher, getDefaultRegistry } from './effectsMeta.js';
import { setupMatchWaves } from './waves.js';
import { GAME_SPEED, HEADLESS_SLICE_MS } from './fields.js';
import { MatchPlatform } from './match/platform.js';
import { MatchInfra } from './match/infra.js';
import { MatchMessaging } from './match/messaging.js';
import { MatchViews } from './match/views.js';
import { MatchWatch } from './match/watch.js';
import { MatchIntents } from './match/intents.js';
import { MatchPause } from './match/pause.js';
import { MatchPhases } from './match/phases.js';
import { MatchSetupVote } from './match/setupVote.js';
import { MatchSpDraft } from './match/spDraft.js';
import { MatchPrep } from './match/prep.js';
import { MatchCombat } from './match/combat.js';
import { MatchClientCombat } from './match/clientCombat.js';
import { MatchReports } from './match/reports.js';
import { MatchUnite } from './match/unitePhase.js';
import { MatchBoss } from './match/bossRounds.js';
import { MatchSettle } from './match/settle.js';

export { FLOW_TICKER_PRIORITY, DELAYS, BAND_TURN_SECONDS } from './match/common.js';

const BOT_REHEARSAL_DEFAULT = 3;
/** Wall-clock ms of bot layout rehearsal per scheduler callback (real time; virtual time runs it in one go). */
const BOT_SLICE_MS = 8;
const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);
/** Default combat mode: client-side unless SP_COMBAT=server. */
const envClientCombat = () => String(env('SP_COMBAT') || '').toLowerCase() !== 'server';
/** SP_VERIFY → 'off' | 'sample' | 'all'. */
export function parseVerify(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'all' || s === 'sample' ? s : 'off';
}
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

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
    /** 「AI 队友最后选择」 (opts.aiPicksLast, GitHub #338): humans draft before AI seats (MatchPhases.humansFirst) */
    this.aiPicksLast = !this.isSolo && opts.aiPicksLast === true;
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
    // 自选编队 (0.2.0): each human's slotted DIY pieces get their own stock — none for one whose bonds are all off this
    // match (player/diy.js initDiyStock); no randomness is drawn here
    const off = new Set([...bans.drawn, ...bans.staticOff]);
    for (const ps of this.order) ps.initDiyStock(off);

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
    this._infoAdvanceTimer = null;
    this.setupRevision = 0;
    this.setupVote = null;
    this._setupVoteSeq = 0;
    this._lastSetupVoteAt = -Infinity;
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
    /**
     * Watch preference (community report of 2026-10-06, item 56; the idea of PR #189): viewer playerId → the player it
     * last chose to watch with a manual g.watch. Every phase reset starts an eliminated human or a spectator seat on that
     * player again (its prep board, its battle field) — else the first player still in — instead of its own empty board.
     */
    this.watchPref = new Map();
    this.lastResults = new Map();
    this.unitePlan = null;
    /** 联防 outcome for the SETTLE view: { through, helpers, leakers, losses } (settle()), null when no 联防 resolved */
    this.uniteResultView = null;
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
}

// the method modules, in this order (a name defined twice is an error, never a silent override)
for (const part of [MatchPlatform, MatchInfra, MatchMessaging, MatchViews, MatchWatch, MatchIntents, MatchPause, MatchPhases, MatchSetupVote, MatchSpDraft, MatchPrep, MatchCombat, MatchClientCombat, MatchReports, MatchUnite, MatchBoss, MatchSettle]) {
  for (const key of Reflect.ownKeys(part.prototype)) {
    if (key === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Match.prototype, key)) throw new Error(`Match.${String(key)} is defined twice`);
    Object.defineProperty(Match.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
  }
}
