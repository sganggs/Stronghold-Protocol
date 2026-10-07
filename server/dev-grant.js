// server/dev-grant.js — DEVELOPMENT-ONLY chess grant channel (SP_DEV_GRANT=1). Off by default.
//
//   GET /dev/grant?chess=chess_char_1_09_a,chess_char_5_02_a[&count=N][&room=CODE][&player=ID][&toTemp=1]
//
// Why it exists: a match lives in this process's memory and the wire protocol (shared/protocol.js) has no grant /
// debug / admin message, so there is no supported way to hand a piece to a player mid-match. This endpoint adds one
// for testing and for the owner's own sessions. It is deliberately NOT a cheat vector for a public server:
//
//   * the process must have been started with SP_DEV_GRANT=1 (nothing registers otherwise — server/index.js);
//   * the request must come from a loopback peer (this machine only — no LAN, no internet);
//   * it goes through PlayerState.acquireChess (server/match/player/acquire.js), the same door as buys, rewards and
//     effects, so the shared pool is taken, hand/temp overflow applies, merges still invent an elite, and onGain
//     fires. Nothing is written into the board or the battle input directly, so the invariants (match/invariants.js)
//     and the audit (match/audit.js) still hold.
//
// The one thing acquireChess cannot make safe is a grant that COMPLETES A MERGE during a battle: _mergeChess then
// forces the elite onto a board tile while the client is running that round, and the audit checks the board. So the
// phase gate below refuses everything except PREP and SETTLE — the same reason a SETTLE-time merge defers its copy.

import { getChess } from './data.js';
import { PHASE, APP_VERSION } from '../shared/constants.js';

/** The only path this module serves. */
export const DEV_GRANT_PATH = '/dev/grant';

/** Phases a grant may land in: a battle is not running, so the board cannot be forced under the client. */
const SAFE_PHASES = new Set([PHASE.PREP, PHASE.SETTLE]);

/** SP_DEV_GRANT → register the route or not. Anything but an explicit yes leaves it off. */
export function parseDevGrant(v) {
  return ['1', 'true', 'yes', 'on', 'always'].includes(String(v ?? '').trim().toLowerCase());
}

/** Is this peer the machine itself? `::1`, `127.0.0.0/8`, and their IPv4-mapped forms. */
function isLoopback(addr) {
  const s = String(addr ?? '');
  return s === '::1' || /^127\./.test(s) || /^::ffff:127\./.test(s);
}

/** JSON reply without needing the request object (the callers only pass `req` for HEAD handling). */
function reply(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

/** One-line summary of a match for discovery and logs. */
function describeMatch(m) {
  return {
    roomCode: m.roomCode,
    modeId: m.modeId,
    phase: m.phase,
    round: m.round,
    matchNo: m.matchNo,
    players: m.order.map((ps) => ({
      playerId: ps.playerId,
      seat: ps.seat,
      isBot: ps.isBot,
      connected: !!ps.connected,
      left: !!ps.left,
    })),
  };
}

/**
 * @param {{
 *   log?: { info?: Function, warn?: Function },
 *   lobby: { rooms: Map<string, any> },
 * }} deps
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, query: string) => void}
 */
export function createDevGrantHandler({ log, lobby }) {
  /** The room holding a running match: the named one, else the only one, else a helpful error. */
  const pickMatch = (wantedCode) => {
    const live = [...lobby.rooms.values()].filter((r) => r.match);
    if (wantedCode) {
      const room = [...lobby.rooms.values()].find((r) => String(r.code).toUpperCase() === wantedCode.toUpperCase());
      return room ? room.match : null;
    }
    return live.length === 1 ? live[0].match : null;
  };

  return function handleDevGrant(req, res, query) {
    if (!isLoopback(req.socket && req.socket.remoteAddress)) {
      reply(res, 403, { ok: false, error: 'loopback only', detail: 'SP_DEV_GRANT 只接受来自本机的请求。' });
      return;
    }
    const q = new URLSearchParams(query || '');

    // Discovery: no `chess` lists what can be granted where (room / player ids are what the grant needs).
    const chessArg = (q.get('chess') || q.get('id') || '').trim();
    // Any of the acting parameters suppresses discovery, so `?funds=99` on its own works without `chess=`.
    const acts = chessArg || (q.get('funds') || '').trim() || (q.get('fundsAdd') || '').trim();
    if (!acts) {
      reply(res, 200, {
        ok: true, app: APP_VERSION, devGrant: true,
        usage: `${DEV_GRANT_PATH}?chess=<id>[,<id>…][&count=N][&funds=N | &fundsAdd=N][&room=CODE][&player=ID][&toTemp=1]`,
        matches: [...lobby.rooms.values()].filter((r) => r.match).map((r) => describeMatch(r.match)),
      });
      return;
    }

    const wantedRoom = (q.get('room') || '').trim();
    const m = pickMatch(wantedRoom);
    if (!m) {
      const live = [...lobby.rooms.values()].filter((r) => r.match).map((r) => r.code);
      reply(res, 404, {
        ok: false,
        error: live.length ? 'room not found or ambiguous' : 'no running match',
        detail: live.length ? `带上 room=<CODE>；正在进行的房间：${live.join(', ')}` : '先开一局再发牌。',
        rooms: live,
      });
      return;
    }
    if (!SAFE_PHASES.has(m.phase)) {
      reply(res, 409, {
        ok: false, error: 'phase', detail: `现在是对局阶段「${m.phase}」，作战进行中不能发牌（会打乱棋盘校验）。等休整期。`,
        phase: m.phase, round: m.round, roomCode: m.roomCode,
      });
      return;
    }

    // Target player: an explicit id, else the only human still in the match.
    const wantedPlayer = (q.get('player') || '').trim();
    const humans = m.order.filter((ps) => ps.isHumanActive);
    let ps = null;
    if (wantedPlayer) ps = m.players.get(wantedPlayer) || null;
    else if (humans.length === 1) ps = humans[0];
    if (!ps) {
      reply(res, 404, {
        ok: false, error: 'player not found or ambiguous',
        detail: wantedPlayer ? `这个对局里没有 ${wantedPlayer}` : `有多名玩家，带上 player=<id>；可选：${humans.map((p) => p.playerId).join(', ')}`,
        players: m.order.map((p) => p.playerId),
      });
      return;
    }

    const ids = chessArg.split(',').map((s) => s.trim()).filter(Boolean);
    const count = Math.max(0, Math.min(50, Number(q.get('count')) || 1));
    const toTemp = q.get('toTemp') === '1';

    const granted = [];
    const failed = [];
    for (const id of ids) {
      const rec = getChess(id, m.data);
      if (!rec) { failed.push({ id, error: 'unknown chess id' }); continue; }
      let got = 0;
      for (let i = 0; i < count; i++) {
        const piece = ps.acquireChess(id, { source: 'dev', toTemp, fromPool: true });
        if (!piece) { failed.push({ id, error: i === 0 ? 'refused (hand and temp full?)' : `stopped after ${got}` }); break; }
        got++;
      }
      if (got) granted.push({ id, count: got, name: rec.name });
    }

    // Funds, through addFunds (server/match/player/economy.js — the same door as every gain: fundsGained, dirty).
    // `funds=N` sets the exact amount; `fundsAdd=N` adds. A `+` cannot express "add" in a query string — it decodes
    // to a space, so `funds=+50` would read as "set to 50" — so a value carrying `+`, whitespace or anything else
    // non-numeric is REJECTED rather than guessed at, and nothing is written. NB `economy.leftoverFundsLost` still
    // applies: unspent funds are cleared when the prep ends unless the band is one of `leftoverFundsKeptByBands`, so
    // a top-up lasts that prep only.
    let funds = null;
    const rawSet = q.get('funds');
    const rawAdd = q.get('fundsAdd') ?? q.get('fundsadd');
    const rawFund = rawSet !== null ? rawSet : rawAdd;
    if (rawFund !== null && rawFund.trim() !== '') {
      // Test the RAW value: a `+` in a query decodes to a space, so trimming first would turn `funds=+50` into a
      // perfectly valid "50" and silently set funds to 50 instead of adding. Only `fundsAdd=-N` may carry a sign.
      const problem = /^[+\s]/.test(rawFund) ? 'sign or space not allowed (use fundsAdd=N to add)'
        : !/^-?\d+$/.test(rawFund) ? 'not a whole number'
          : (rawFund.startsWith('-') && rawSet !== null) ? 'funds= takes no sign (use fundsAdd=-N to spend down)'
            : null;
      if (problem) {
        failed.push({ id: `${rawSet !== null ? 'funds' : 'fundsAdd'}=${rawFund}`, error: problem });
      } else {
        const want = Number(rawFund);
        const before = ps.funds;
        const applied = ps.addFunds(rawSet !== null ? want - before : want, { reason: 'dev' });
        funds = { before, after: ps.funds, delta: applied };
      }
    }

    // Land it in the client now: combat flushes once a second, but a grant should be visible immediately.
    ps.dirty();
    try { m.flush(true); } catch (e) { log?.warn?.('[dev-grant] flush', e); }

    const did = granted.length > 0 || funds !== null;
    log?.info?.(`[dev-grant] room ${m.roomCode} player ${ps.playerId} phase ${m.phase}: granted ${granted.map((g) => `${g.id}×${g.count}`).join(', ') || 'nothing'}${funds ? `; funds ${funds.before}→${funds.after}` : ''}${failed.length ? `; failed ${failed.map((f) => `${f.id} (${f.error})`).join(', ')}` : ''}`);
    reply(res, did ? 200 : 409, {
      ok: did, roomCode: m.roomCode, playerId: ps.playerId, phase: m.phase, round: m.round,
      granted, ...(funds ? { funds } : {}), failed,
    });
  };
}
