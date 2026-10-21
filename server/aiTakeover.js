// Game-owned spectator-to-AI handover. No monitor or administrator API dependency.
import { ERR } from '../shared/constants.js';
const fail = detail => ({ error: ERR.BAD_TARGET, detail });
const pending = new WeakMap();
export function resetAiTakeover(room) {
  const votes = pending.get(room);
  if (votes) { for (const vote of votes.values()) clearTimeout(vote.timer); votes.clear(); }
  room.aiTakeoverVotes = [];
}
export function takeoverVoters(room) {
  const m = room.match;
  const seats = room.seats.filter(s => s && !s.isBot && !s.left && s.connected);
  const ids = seats.filter(s => !m.players.get(s.playerId)?.autoplay).map(s => s.playerId);
  if (!ids.length && room.seatOf(room.hostId)?.connected) ids.push(room.hostId);
  return ids;
}
export function transferAiSeat(lobby, room, applicantId, botId) {
  const m = room.match, session = lobby.registry.byId(applicantId), spectator = room.spectatorOf(applicantId);
  const ps = m?.players?.get(botId), seat = room.seatOf(botId);
  if (!session?.connected || !session.ws || !spectator || !ps?.isBot || ps.left || !ps.alive || !seat || m.phase !== 'PREP' || m.ended || m.disposed || m.emergencyFrozen) return fail('AI handover unavailable');
  if (room.modded || m.hosted) return fail('AI handover is unavailable in isolated plugin matches');
  if (lobby.registry.byId(botId)) return fail('AI seat already has a session');
  const conn = lobby.network.conns.get(session.ws);
  if (!conn || conn.closing) return fail('connection unavailable');
  lobby.removeMember(room, applicantId); lobby.clearResync(applicantId);
  lobby.registry.byPlayerId.delete(applicantId); session.playerId = botId; lobby.registry.byPlayerId.set(botId, session);
  session.roomCode = room.code; session.notice = null; session.pendingResult = null; session.resyncAt = -Infinity;
  ps._botPrepToken = (ps._botPrepToken || 0) + 1;
  Object.assign(ps, { isBot: false, autoplay: false, connected: true, ready: false, name: session.name });
  Object.assign(seat, { isBot: false, connected: true, left: false, ready: false, name: session.name });
  m.loneHuman = m.order.filter(p => !p.isBot && !p.left).length === 1;
  ps.aiTakeoverRound = m.round;
  session.aiTakeoverFrom = applicantId; m.markPublic(); ps.dirty();
  lobby.network.onHelloMsg(conn, { t: 'hello', version: 1, name: session.name, token: session.token }, Date.now());
  lobby.broadcastState(room); return { ok: true };
}
// [ASSUMED] Any electorate change cancels rather than lowering the approval threshold.
function drop(votes, id) {
  clearTimeout(votes.get(id)?.timer);
  votes.delete(id);
}
function snapshot(room, votes) {
  room.aiTakeoverVotes = [...votes.values()].map(v => ({ id: v.id, applicantId: v.applicantId,
    applicantName: v.applicantName, botId: v.botId, expiresAt: v.expiresAt, eligible: v.eligible,
    yes: [...v.yes], no: [...v.no] }));
}
export function reconcileAiTakeover(lobby, room) {
  const votes = pending.get(room);
  if (!votes?.size) return false;
  const m = room.match;
  const eligible = m ? takeoverVoters(room) : [];
  let changed = false;
  for (const [id, v] of votes) {
    const applicant = lobby.registry.byId(v.applicantId), bot = m?.players?.get(v.botId);
    if (m !== v.match || m.phase !== 'PREP' || m.round !== v.round || m.ended || m.disposed || m.emergencyFrozen
      || !room.spectatorOf(v.applicantId)?.connected || !applicant?.connected || applicant.roomCode !== room.code
      || !bot?.isBot || !bot.alive || bot.left || Date.now() >= v.expiresAt
      || eligible.length !== v.eligible.length || eligible.some((id, i) => id !== v.eligible[i])) {
      drop(votes, id); changed = true;
    }
  }
  if (changed) snapshot(room, votes);
  return changed;
}
export function aiTakeover(lobby, session, msg) {
  const room = lobby.roomOf(session), m = room?.match;
  if (room && reconcileAiTakeover(lobby, room)) lobby.broadcastState(room);
  if (!room || !m || m.hosted || room.modded || m.phase !== 'PREP' || m.ended || m.disposed || m.emergencyFrozen) return fail('AI handover requires preparation in an original-content match');
  let votes = pending.get(room); if (!votes) pending.set(room, votes = new Map());
  const sync = () => { snapshot(room, votes); lobby.broadcastState(room); };
  if (msg.t === 'room.aiRequest') {
    const bot = m.players.get(msg.botId);
    if (!room.spectatorOf(session.playerId) || !session.connected || !bot?.isBot || bot.left || !bot.alive) return fail('a spectator must select an active AI');
    if ([...votes.values()].some(v => v.applicantId === session.playerId || v.botId === msg.botId)) return fail('request already pending');
    const eligible = takeoverVoters(room);
    if (!eligible.length) return fail('no online voter available');
    const id = String(room.aiTakeoverSeq = (room.aiTakeoverSeq || 0) + 1);
    const vote = { id, applicantId: session.playerId, applicantName: session.name, botId: msg.botId,
      match: m, round: m.round, eligible, expiresAt: Date.now() + 30000, yes: new Set(), no: new Set() };
    votes.set(id, vote);
    vote.timer = setTimeout(() => { if (votes.get(id) === vote) { drop(votes, id); sync(); } }, 30000);
    vote.timer.unref?.(); sync(); return { ok: true };
  }
  const vote = votes.get(msg.voteId);
  if (!vote) return fail('request expired');
  if (!vote.eligible.includes(session.playerId)) return fail('only online human room teammates can vote');
  (msg.approve ? vote.no : vote.yes).delete(session.playerId);
  (msg.approve ? vote.yes : vote.no).add(session.playerId);
  const required = Math.floor(vote.eligible.length / 2) + 1;
  if (vote.no.size >= required) { drop(votes, vote.id); sync(); return { ok: true }; }
  if (vote.yes.size >= required) {
    drop(votes, vote.id);
    const result = transferAiSeat(lobby, room, vote.applicantId, vote.botId); sync(); return result;
  }
  sync(); return { ok: true };
}
