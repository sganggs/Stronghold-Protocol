// Read-only projections: room codes are shared explicitly, never listed by this API.
import { PHASE } from '../shared/constants.js';
import { TokenBucket, clientAddress, limitKeyOf } from './net.js';

/** Keep only the match fields needed by a status display, including live LP loss. */
export function matchStatus(msg) {
  return {
    phase: msg.phase,
    round: msg.round ?? 0,
    lastRound: msg.lastRound ?? null,
    deadline: msg.deadline ?? 0,
    paused: !!msg.paused,
    players: (msg.players || []).map((p) => ({
      seat: p.seat, ready: !!p.ready,
      alive: p.alive ?? true, lp: p.lp ?? null, pendingLp: p.pendingLp ?? 0,
    })),
  };
}

/** A fresh status snapshot, without session/player IDs, loadouts or private match data. */
export function roomStatus(room, now = Date.now()) {
  const match = room.match ? room.matchCtx?.status : null;
  // Lobby internally pads solo rooms to four slots too; their actual playable capacity is one.
  const seats = room.seats.slice(0, room.mode === 'solo' ? 1 : room.seats.length).map((s) => {
    if (!s) return null;
    const p = match?.players.find((p) => p.seat === s.seat);
    return {
      seat: s.seat, name: s.name, isBot: s.isBot, isHost: s.playerId === room.hostId,
      connected: s.connected && !s.left, ready: p ? p.ready : s.ready,
      ...(p ? { alive: p.alive, lp: p.lp, pendingLp: p.pendingLp } : {}),
    };
  });
  const occupied = seats.filter(Boolean);
  return {
    code: room.code, mode: room.mode, difficulty: room.difficulty,
    inMatch: !!room.match, joinable: room.mode === 'coop' && !room.match && seats.includes(null),
    capacity: seats.length, occupied: occupied.length,
    humans: occupied.filter((s) => !s.isBot).length,
    bots: occupied.filter((s) => s.isBot).length,
    connectedHumans: occupied.filter((s) => !s.isBot && s.connected).length,
    phase: match?.phase ?? PHASE.LOBBY, round: match?.round ?? 0,
    lastRound: match?.lastRound ?? null, deadline: match?.deadline ?? 0,
    paused: match?.paused ?? false, seats, serverNow: now,
  };
}

/** Bound both query frequency and limiter memory; use the same proxy policy as WebSockets. */
export function createStatusLimiter({ trustProxy = 'auto', now = Date.now, maxKeys = 4096 } = {}) {
  const buckets = new Map();
  let sweptAt = now();
  return (req) => {
    const at = now();
    if (at - sweptAt >= 60_000) {
      for (const [key, bucket] of buckets) if (at - bucket.at >= 60_000) buckets.delete(key);
      sweptAt = at;
    }
    const { ip } = clientAddress(req, trustProxy);
    const key = limitKeyOf(ip);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxKeys) return false;
      bucket = new TokenBucket(2, 10, at);
      buckets.set(key, bucket);
    }
    return bucket.take(at);
  };
}
