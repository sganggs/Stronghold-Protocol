// test/match/harness.js — helpers for the match-engine tests (test/match/*.test.js).
//
//   const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7, fake: true });
//   h.start(); h.runToPhase('PREP'); const ps = h.ps('p_0'); …; h.invariants();
//
// Options: mode, difficulty, humans (count) | seats (explicit), bots, spectators (spectator seat ids, opts.spectators),
// seed, matchNo (the room's match number: part of the battleId prefix), data (default: real data/*.json),
// fake (true → test/match/fakeBattle.js as BattleClass), script (FakeBattle.script), registry, instant (virtual
// scheduler runs battles synchronously; default true), timerScale, battleContent, botRehearsal (default 0),
// botSliceMs (bot rehearsal slice budget; default: unbounded in virtual time).
// Combat mode: clientCombat (default false here: the legacy server-run mode most suites were written for; production
// defaults to client-side combat, DESIGN §14). With clientCombat: true every human gets a scripted browser
// (test/match/simClient.js SimClient: h.clients) unless clients: false; pace 'instant' | 'paced', perPlayer
// { [playerId]: SimClient options } (tamper / mute / stall …), verify ('off' | 'sample' | 'all'), headlessSliceMs
// (server-run fields in wall-clock slices even in virtual time).
// Hooks: h.onSend [(playerId, msg) => void], h.onBroadcast [(msg) => void].
// Captures: h.sent [[playerId, msg]], h.bc [msg], h.ended (summary), h.logs { error: [], warn: [] }.

import assert from 'node:assert/strict';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { getData } from '../../server/data.js';
import { FIELD, canPlace, placeClass, positionClass, tileKey } from '../../server/match/board.js';
import { FakeBattle } from './fakeBattle.js';
import { GEO } from '../../shared/constants.js';
import { collectViolations } from '../../server/match/invariants.js';
import { attachSimClients } from './simClient.js';

export const DATA = getData({ log: { warn() {}, error() {}, info() {} } });

export function makeMatch(o = {}) {
  const mode = o.mode ?? 'coop';
  const difficulty = o.difficulty ?? 'NORMAL';
  let seats = o.seats;
  if (!seats) {
    seats = [];
    const humans = o.humans ?? 1;
    const bots = mode === 'solo' ? 0 : (o.bots ?? 0);
    for (let i = 0; i < humans; i++) seats.push({ seat: seats.length, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true });
    for (let i = 0; i < bots; i++) seats.push({ seat: seats.length, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true });
  }
  const sched = new VirtualScheduler({ instantCombat: o.instant !== false });
  const logs = { error: [], warn: [] };
  const log = { info() {}, debug() {}, warn: (...a) => logs.warn.push(a.map(String).join(' ')), error: (...a) => logs.error.push(a.map(String).join(' ')) };
  const h = { sent: [], bc: [], ended: null, endedCount: 0, logs, sched, frames: 0, badFrames: [], onSend: [], onBroadcast: [], clients: null };
  const captureFrames = o.captureFrames !== false;
  const checkFrame = (msg) => {
    // every frame must be JSON-safe: no NaN/Infinity, no undefined-only structures, serializable
    if (!o.checkFrames) return;
    const s = JSON.stringify(msg);
    if (s == null || /NaN|Infinity/.test(s.replace(/"[^"]*"/g, ''))) h.badFrames.push(msg.t);
  };
  if (o.fake) {
    FakeBattle.reset();
    if (o.script) FakeBattle.script = o.script;
  }
  h.m = new Match({
    roomCode: 'TEST', mode, difficulty, seats, spectators: o.spectators, seed: o.seed ?? 1, matchNo: o.matchNo, data: o.data ?? DATA, log,
    send: (id, msg) => {
      for (const fn of h.onSend) fn(id, msg);
      if (msg.t === 'b.snap' || msg.t === 'b.ev') { h.frames++; if (!captureFrames) return true; }
      checkFrame(msg);
      h.sent.push([id, msg]);
      return true;
    },
    broadcast: (msg) => { for (const fn of h.onBroadcast) fn(msg); checkFrame(msg); h.bc.push(msg); },
    onEnd: (s) => { h.ended = s; h.endedCount++; },
    scheduler: sched,
    registry: o.registry,
    BattleClass: o.fake ? FakeBattle : undefined,
    battleContent: o.battleContent,
    timerScale: o.timerScale,
    // bot layout rehearsal (extra simulated battles per bot prep) is off unless a test asks for it: it multiplies the
    // simulation work of full-match suites; test/match/bot.test.js covers it
    botRehearsal: o.botRehearsal ?? 0,
    botSliceMs: o.botSliceMs,
    clientCombat: o.clientCombat ?? false,
    verify: o.verify ?? 'off',
    headlessSliceMs: o.headlessSliceMs,
  });
  const m = h.m;
  if (m.clientCombat && o.clients !== false) {
    h.clients = attachSimClients(h, { BattleClass: o.fake ? FakeBattle : undefined, pace: o.pace, perPlayer: o.perPlayer });
  }
  h.start = () => { m.start(); return h; };
  h.ps = (id) => m.players.get(id);
  h.run = (pred, opts = {}) => sched.runUntil(pred, { maxSteps: 3e6, ...opts });
  /** run until the phase (and round) is reached */
  h.runToPhase = (phase, round = null, opts = {}) => {
    const ok = h.run(() => h.ended != null || (m.phase === phase && (round == null || m.round === round)), opts);
    assert.ok(ok && m.phase === phase && (round == null || m.round === round), `expected ${phase}${round != null ? ' R' + round : ''}, got ${m.phase} R${m.round}${h.ended ? ' (ended)' : ''}`);
    return h;
  };
  h.runToEnd = (opts = {}) => { h.run(() => h.ended != null, opts); assert.ok(h.ended, `match did not end (phase ${m.phase} R${m.round})`); return h.ended; };
  /** last message of a type sent to a player (unicast) */
  h.lastTo = (id, type) => { for (let i = h.sent.length - 1; i >= 0; i--) if (h.sent[i][0] === id && h.sent[i][1].t === type) return h.sent[i][1]; return null; };
  h.lastBc = (type) => { for (let i = h.bc.length - 1; i >= 0; i--) if (h.bc[i].t === type) return h.bc[i]; return null; };
  h.allTo = (id, type) => h.sent.filter(([pid, msg]) => pid === id && msg.t === type).map(([, msg]) => msg);
  h.flushAll = () => { sched.advance(200); m.flush(true); };
  /** give the human every draft decision automatically (humans otherwise wait for timers) */
  h.autoHumans = () => { for (const ps of m.players.values()) if (!ps.isBot) ps.autoplay = true; return h; };
  h.invariants = () => checkInvariants(m);
  /** force the stage (tests need known geometry) */
  h.setStage = (stageId) => {
    m.stageId = stageId;
    m.stage = m.gd.stage(stageId);
    m._botPath = null;
    for (const ps of m.players.values()) ps.invalidateDeployMap();
    return h;
  };
  /** drive human decisions (info, band, 机变, ready) until `pred` holds */
  h.drive = (pred, { ready = true, band = 'band_bldsk', maxSteps = 3e6 } = {}) => {
    for (let i = 0; i < maxSteps; i++) {
      if (pred()) return true;
      if (h.ended) return !!pred();
      for (const ps of m.players.values()) {
        if (ps.isBot || ps.left) continue;
        if (m.phase === 'INFO_CHECK' && !ps.infoReady) m.handle(ps.playerId, { t: 'g.infoReady' });
        if (m.phase === 'BAND_DRAFT' && m.draftTurn() === ps.playerId) m.handle(ps.playerId, { t: 'g.band', bandId: band });
        if (m.phase === 'SP_DRAFT' && m.spTurn() === ps.playerId) {
          const idx = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null);
          if (idx != null) m.handle(ps.playerId, { t: 'g.choice', idx });
        }
        if (ready && m.phase === 'PREP' && ps.alive && !ps.ready) {
          if (!ps.tempEmpty) ps.resolveTemp();
          m.handle(ps.playerId, { t: 'g.ready', ready: true });
        }
      }
      if (pred()) return true;
      if (!sched.runNext()) return !!pred();
    }
    return !!pred();
  };
  /** reach PREP of round r (humans confirm/draft/ready automatically) */
  h.toPrep = (r = 1, opts = {}) => {
    const ok = h.drive(() => m.phase === 'PREP' && m.round === r, { ...opts, ready: true, stopAtPrep: r });
    assert.ok(ok, `could not reach PREP R${r} (phase ${m.phase} R${m.round}${h.ended ? ', ended' : ''})`);
    return h;
  };
  return h;
}

/** Engine invariants (DESIGN §11). Throws an AssertionError listing every violation (server/match/invariants.js). */
export function checkInvariants(m) {
  const violations = collectViolations(m);
  assert.deepEqual(violations, [], `invariants violated (${m.phase} R${m.round}):\n  ${violations.join('\n  ')}`);
  return legacyInvariants(m);
}

/** The original harness checks (kept alongside collectViolations; they must agree). */
function legacyInvariants(m) {
  const pool = m.pool;
  const held = new Map();
  const uids = new Set();
  const note = (p) => {
    assert.ok(Number.isInteger(p.uid) && p.uid > 0, `bad uid ${p.uid}`);
    assert.ok(!uids.has(p.uid), `duplicate uid ${p.uid}`);
    uids.add(p.uid);
  };
  for (const ps of m.players.values()) {
    assert.ok(Number.isInteger(ps.funds) && ps.funds >= 0, `${ps.playerId} funds ${ps.funds}`);
    assert.ok(Number.isInteger(ps.pendingFunds) && ps.pendingFunds >= 0, `${ps.playerId} pending ${ps.pendingFunds}`);
    assert.equal(ps.hand.length, GEO.HAND_SIZE);
    assert.equal(ps.temp.length, GEO.TEMP_SIZE);
    assert.ok(ps.shop.level >= 1 && ps.shop.level <= m.gd.maxShopLevel);
    assert.ok(ps.shop.upgradePrice >= 0);
    assert.ok(ps.shop.freeRefreshes >= 0);
    if (!ps.alive) {
      assert.equal(ps.board.size, 0, 'eliminated player keeps no board');
      assert.ok(ps.hand.every((x) => x == null) && ps.temp.every((x) => x == null), 'eliminated player keeps nothing');
    }
    const chessUids = new Set();
    const all = [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)];
    for (const p of all) if (p.kind === 'chess') chessUids.add(p.uid);
    let deployed = 0;
    const dmap = m.deployMapFor(ps); // a pure read (as server/match/invariants.js): no PlayerState cache touched
    for (const [k, p] of ps.board) {
      const [r, c] = k.split(',').map(Number);
      assert.ok(r >= FIELD.r0 && r <= FIELD.r1 && c >= FIELD.c0 && c <= FIELD.c1, `piece outside the board ${k}`);
      const rec = p.kind === 'token' ? m.gd.token(p.id) : m.gd.chess(p.id);
      assert.ok(rec, `unknown board piece ${p.id}`);
      const cls = p.kind === 'chess' ? placeClass(ps, rec) : positionClass(rec);
      assert.ok(canPlace(dmap, cls, r, c), `illegal tile ${p.id} @ ${k}`);
      assert.notEqual(p.kind, 'item', 'items never stand on the board');
      if (p.kind === 'chess') deployed++;
      if (p.kind === 'token') assert.ok(chessUids.has(p.ownerUid), `orphan token ${p.uid}`);
    }
    assert.ok(deployed <= ps.deployCap, `${ps.playerId} deployCount ${deployed} > cap ${ps.deployCap}`);
    for (const p of all) {
      note(p);
      if (p.kind === 'chess') {
        const rec = m.gd.chess(p.id);
        assert.ok(rec, `unknown chess ${p.id}`);
        assert.ok(Array.isArray(p.items) && p.items.length <= m.gd.equipPerChess, `${p.id} carries ${p.items && p.items.length} items`);
        for (const it of p.items) { note(it); assert.equal(it.kind, 'item'); assert.ok(m.gd.item(it.id), `unknown item ${it.id}`); }
        assert.ok(Number.isInteger(p.poolCopies) && p.poolCopies >= 0);
        const base = m.gd.baseIdOf(p.id);
        held.set(base, (held.get(base) || 0) + p.poolCopies);
      } else if (p.kind === 'item') {
        assert.ok(m.gd.item(p.id), `unknown item ${p.id}`);
      } else if (p.kind === 'token') {
        assert.ok(p.count >= 1, 'token stack count');
        assert.ok(chessUids.has(p.ownerUid), `orphan token ${p.uid}`);
      }
    }
    // merges are immediate: never 3 normal copies (风丸 2) of one chess owned at once
    const counts = new Map();
    for (const p of all) if (p.kind === 'chess' && !m.gd.isGolden(p.id)) { const b = m.gd.baseIdOf(p.id); counts.set(b, (counts.get(b) || 0) + 1); }
    for (const [b, n] of counts) {
      const need = m.gd.mergeCount(b);
      if (need > 1 && m.gd.goldenIdOf(b)) assert.ok(n < need, `${ps.playerId} owns ${n} copies of ${b} (merge ${need})`);
    }
  }
  for (const [base, e] of pool.entries) {
    assert.ok(e.left >= 0 && e.left <= e.cap, `pool ${base} left ${e.left} cap ${e.cap}`);
    assert.equal(e.left + (held.get(base) || 0), e.cap, `pool accounting ${base}: left ${e.left} + held ${held.get(base) || 0} != cap ${e.cap}`);
  }
  for (const [base, n] of held) if (!pool.has(base)) assert.equal(n, 0, `non-pool chess ${base} holds copies`);
  return true;
}

/** Put a chess piece straight into a player's hand/board for scenario setup (takes pool copies like a buy). */
export function give(m, ps, chessId, where = 'hand', at = null) {
  const rec = m.gd.chess(chessId);
  assert.ok(rec, `unknown chess ${chessId}`);
  const base = m.gd.baseIdOf(chessId);
  const taken = m.pool.take(base, rec.isGolden ? m.gd.goldenCopies : 1);
  const piece = ps.newPiece('chess', chessId, { poolCopies: taken });
  if (where === 'board') {
    ps.board.set(tileKey(at[0], at[1]), piece);
    ps.grantTokensFor(piece);
  } else if (where === 'temp') {
    const i = at ?? ps.temp.findIndex((x) => x == null);
    ps.temp[i] = piece;
  } else {
    const i = at ?? ps.hand.findIndex((x) => x == null);
    ps.hand[i] = piece;
  }
  ps.recompute();
  return piece;
}

export function giveItem(m, ps, itemId, where = 'hand', at = null) {
  assert.ok(m.gd.item(itemId), `unknown item ${itemId}`);
  const piece = ps.newPiece('item', itemId);
  if (where === 'temp') ps.temp[at ?? ps.temp.findIndex((x) => x == null)] = piece;
  else ps.hand[at ?? ps.hand.findIndex((x) => x == null)] = piece;
  ps.recompute();
  return piece;
}

/** Visible chess ids of a tier (sorted), optionally filtered. */
export function chessOfTier(tier, filter = () => true) {
  return Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === tier && filter(c)).map((c) => c.chessId).sort();
}

/** First legal board tile for a chess (reading order). */
export function legalTileFor(m, ps, chessId, skip = new Set()) {
  const pos = placeClass(ps, m.gd.chess(chessId));
  const map = ps.deployMap();
  for (let r = FIELD.r1; r >= FIELD.r0; r--) for (let c = FIELD.c0; c <= FIELD.c1; c++) {
    if (skip.has(tileKey(r, c)) || ps.board.has(tileKey(r, c))) continue;
    if (canPlace(map, pos, r, c)) return [r, c];
  }
  return null;
}
