// server/match/StubMatch.js — the platform STUB match, kept for platform tests (test/lobby.test.js) and as a
// minimal reference implementation of the lobby⇄match interface documented at the top of server/match/Match.js.
// It is NOT used in production (server/lobby.js imports the real Match from ./Match.js).
//
//
// This file exists so the platform (http/ws/lobby) runs end to end before the real match engine lands.
// The real implementation (DESIGN §6) MUST keep exactly the interface documented below; server/lobby.js
// is the only caller.
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
//   opts.seats       Array<{ seat: 0..3, playerId: string, name: string, isBot: boolean, connected: boolean }>
//                    sorted by seat, 1–4 entries, ≥ 1 human; solo ⇒ exactly 1 human and no bots.
//                    Bot playerIds start with 'ai_'. Seat indexes may have gaps (e.g. seats 0 and 2).
//   opts.seed        uint32                     master seed for all match randomness
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
// handle(playerId, msg)     A validated 'g.*' intent (msg passed validateC2S; never 'g.leave', which the
//   → { ok: true }          platform turns into onLeave). Return { error: ERR code (shared/constants.js),
//   | { error, detail? }    detail?: string } to reject. Must not throw (if it does, the platform logs and
//                           replies ERR.INTERNAL). Replies ('ok'/'error' with rid) are sent by the platform.
// onDisconnect(playerId)    A human's socket dropped. The seat is kept; apply the auto-play policy.
// onReconnect(playerId)     The human is back (new socket with its token) or re-sent hello on a live socket
//                           (a resync request). May be called without a preceding onDisconnect. Resend full
//                           state: m.public, m.private and, if the player is watching a battle, m.field
//                           (+ next b.snap).
// onLeave(playerId)         The human quit permanently (g.leave, room.leave, or the 10-minute reconnect
//                           window expired). They will never return under this playerId in this match;
//                           treat as quit (AI takes over / eliminated per DESIGN). No onDisconnect follows.
// dispose()                 Stop every timer/interval and release resources. Idempotent. After dispose the
//                           platform ignores send/broadcast/onEnd from this instance.
//
// Bot seats never produce intents or hooks: the match drives bots itself (server/match/bot.js).
// Messages the match emits are the S2C 'm.*' / 'b.*' frames of DESIGN §8.2 (room.* frames are platform-owned).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
//
// STUB behaviour: start() enters INFO_CHECK (duration from data/config.json → timers.infoCheck, default 25 s)
// and sends m.public / m.private in the §8.2/§8.3 shapes (empty shop/hand/board) so UI code can render them.
// Every known 'g.*' intent is accepted; 'g.infoReady' marks the player ready. Once every human is ready
// (departed humans count as ready) or the INFO_CHECK deadline passes, the stub sends m.result and calls
// onEnd — so the lobby's "play again" loop can be exercised, also from a browser that has no briefing UI.
// 'g.emote' is relayed as m.emote (1 s cooldown) so clients can test broadcast plumbing.

import { C2S } from '../../shared/protocol.js';
import { PHASE, ERR, EMOTE_COOLDOWN_MS, GEO, modeIdFor } from '../../shared/constants.js';
import { getConfig, getMode } from '../data.js';
import { noopLog } from '../util.js';
import { posNumOr as posNum } from '../sim/util.js';

const GAME_TYPES = new Set(Object.keys(C2S).filter((t) => Object.hasOwn(C2S, t) && t.startsWith('g.')));
const DEFAULT_INFO_CHECK_S = 25;
const MAX_TIMER_MS = 2 ** 31 - 1;

// STUB — replaced in Core phase
export class StubMatch {
  /** @param {object} opts see MATCH INTERFACE above */
  constructor(opts) {
    if (!opts || !Array.isArray(opts.seats) || opts.seats.length === 0) throw new TypeError('Match: seats required');
    if (typeof opts.send !== 'function' || typeof opts.broadcast !== 'function' || typeof opts.onEnd !== 'function') {
      throw new TypeError('Match: send/broadcast/onEnd callbacks required');
    }
    this.roomCode = opts.roomCode;
    this.mode = opts.mode;
    this.difficulty = opts.difficulty;
    this.modeId = opts.modeId || modeIdFor(opts.mode, opts.difficulty);
    this.seed = opts.seed >>> 0;
    this.log = opts.log || noopLog;
    this.now = opts.now || Date.now;
    this.sendFn = opts.send;
    this.broadcastFn = opts.broadcast;
    this.onEndFn = opts.onEnd;
    const data = opts.data && typeof opts.data === 'object' ? opts.data : {};
    const config = getConfig(data) || {};
    const modeCfg = getMode(this.modeId, data) || {};
    this.lastRound = Number.isInteger(modeCfg.lastRound) && modeCfg.lastRound > 0
      ? modeCfg.lastRound
      : (this.modeId === 'mode_single_funny' ? 9 : 14);
    this.infoCheckMs = Math.min(MAX_TIMER_MS, posNum(config.timers && config.timers.infoCheck, DEFAULT_INFO_CHECK_S) * 1000);
    /** @type {Map<string, {seat:number, playerId:string, name:string, isBot:boolean, connected:boolean, left:boolean, ready:boolean, lastEmoteAt:number}>} */
    this.players = new Map();
    for (const s of opts.seats) {
      this.players.set(s.playerId, { ...s, left: false, ready: !!s.isBot, lastEmoteAt: -Infinity });
    }
    this.phase = PHASE.LOBBY;
    this.deadline = 0;
    this.timer = null;
    this.ended = false;
    this.disposed = false;
  }

  start() {
    if (this.disposed || this.ended || this.phase !== PHASE.LOBBY) return;
    this.phase = PHASE.INFO_CHECK;
    this.deadline = this.now() + this.infoCheckMs;
    this.timer = setTimeout(() => { this.timer = null; this.maybeFinish(true); }, this.infoCheckMs);
    this.timer.unref?.();
    this.broadcastFn(this.publicView());
    for (const p of this.players.values()) if (!p.isBot) this.sendFn(p.playerId, this.privateView(p));
  }

  /**
   * @param {string} playerId
   * @param {{ t: string }} msg validated intent
   * @returns {{ ok: true } | { error: string }}
   */
  handle(playerId, msg) {
    const p = this.players.get(playerId);
    if (!p || p.isBot || p.left) return { error: ERR.NOT_IN_ROOM };
    if (this.disposed || this.ended || !msg || !GAME_TYPES.has(msg.t)) return { error: ERR.WRONG_PHASE };
    if (msg.t === 'g.infoReady') {
      if (this.phase !== PHASE.INFO_CHECK) return { error: ERR.WRONG_PHASE };
      if (!p.ready) {
        p.ready = true;
        this.broadcastFn(this.publicView());
        this.maybeFinish(false);
      }
    } else if (msg.t === 'g.emote') {
      const now = this.now();
      if (now - p.lastEmoteAt >= EMOTE_COOLDOWN_MS) {
        p.lastEmoteAt = now;
        this.broadcastFn({ t: 'm.emote', playerId, id: msg.id });
      }
    }
    return { ok: true };
  }

  onDisconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.isBot || this.disposed) return;
    p.connected = false;
    if (!this.ended) this.broadcastFn(this.publicView());
  }

  onReconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.isBot || p.left || this.disposed) return;
    const wasConnected = p.connected;
    p.connected = true;
    this.sendFn(playerId, this.publicView());
    this.sendFn(playerId, this.privateView(p));
    if (!this.ended && !wasConnected) this.broadcastFn(this.publicView());
  }

  onLeave(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.isBot || p.left || this.disposed) return;
    p.left = true;
    p.connected = false;
    if (this.ended) return;
    this.broadcastFn(this.publicView());
    this.maybeFinish(false);
  }

  dispose() {
    this.disposed = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  // ---- stub internals ------------------------------------------------------------------------------

  /** End the stub match when every human is ready (or unconditionally once the deadline passed). */
  maybeFinish(deadlinePassed) {
    if (this.ended || this.disposed) return;
    if (!deadlinePassed) {
      for (const p of this.players.values()) if (!p.isBot && !p.left && !p.ready) return;
    }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const humansLeft = [...this.players.values()].some((p) => !p.isBot && !p.left);
    this.ended = true;
    this.phase = PHASE.RESULT;
    this.deadline = 0;
    const summary = {
      stub: true, victory: false, roundsPassed: 0, modeId: this.modeId, difficulty: this.difficulty, seed: this.seed,
      reason: deadlinePassed ? 'timeout' : 'confirmed',
      players: [...this.players.values()].map((p) => ({ playerId: p.playerId, seat: p.seat, name: p.name, isBot: p.isBot, lp: 0, title: null })),
    };
    if (humansLeft) {
      this.broadcastFn(this.publicView());
      this.broadcastFn({ t: 'm.result', ...summary });
    }
    this.onEndFn(summary);
  }

  /** DESIGN §8.2 m.public (players[].status uses the §8.3 enum). */
  publicView() {
    return {
      t: 'm.public',
      phase: this.phase,
      round: 0,
      lastRound: this.lastRound,
      deadline: this.phase === PHASE.INFO_CHECK ? this.deadline : 0,
      serverNow: this.now(),
      modeId: this.modeId,
      difficulty: this.difficulty,
      stageId: null,
      factions: [],
      disabledBonds: [],
      bannedChess: [],
      bossId: null,
      players: [...this.players.values()].map((p) => ({
        playerId: p.playerId, seat: p.seat, name: p.name, isBot: p.isBot, connected: p.isBot || (p.connected && !p.left),
        alive: true, lp: 0, bandId: null, shopLevel: 1, boardCount: 0, ready: p.ready, bonds: [], fieldId: null,
        status: p.left ? 'left' : p.ready ? 'ready' : 'deciding',
      })),
      fields: [],
      stub: true,
      message: '对局核心尚未实现（平台占位 STUB）：全员确认本局信息或倒计时结束后将直接结算。',
    };
  }

  /** DESIGN §8.3 m.private with an empty economy. */
  privateView(p) {
    return {
      t: 'm.private',
      playerId: p.playerId,
      seat: p.seat,
      alive: true,
      lp: 0,
      funds: 0,
      bandId: null,
      ready: p.ready,
      canReady: true,
      shop: {
        level: 1, maxLevel: 6, upgradePrice: 0, refreshPrice: 0, freeRefreshes: 0, frozen: false,
        slots: [], rewardOffer: null,
      },
      hand: new Array(GEO.HAND_SIZE).fill(null),
      temp: new Array(GEO.TEMP_SIZE).fill(null),
      board: [],
      deployCap: 0,
      deployCount: 0,
      bonds: [],
      effects: [],
      nextEnemies: [],
      stats: { dmgDealt: 0, kills: 0, leaks: 0, gold: 0, refreshes: 0, merges: 0 },
      stub: true,
    };
  }
}


/** Alias so tests can `import { Match } from './StubMatch.js'`. */
export { StubMatch as Match };
