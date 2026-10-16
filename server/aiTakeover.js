// Game-owned spectator-to-AI handover. No monitor or administrator API dependency.
import { ERR } from '../shared/constants.js';
const fail = detail => ({ error: ERR.BAD_TARGET, detail });
const pending = new WeakMap();
export function resetAiTakeover(room) {
  const votes = pending.get(room);
  if (votes) { for (const vote of votes.values()) clearTimeout(vote.timer); votes.clear(); }
  room.aiTakeoverVotes = [];
}
export function takeoverVoters(room, _botId) {
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
  session.aiTakeoverFrom = applicantId; m.markPublic(); ps.dirty();
  lobby.network.onHelloMsg(conn, { t: 'hello', version: 1, name: session.name, token: session.token }, Date.now());
  lobby.broadcastState(room); return { ok: true };
}
export function aiTakeover(lobby, session, msg) {
  const room = lobby.roomOf(session), m = room?.match;
  if (!room || !m || m.hosted || room.modded || m.phase !== 'PREP' || m.ended || m.disposed || m.emergencyFrozen) return fail('AI handover requires preparation in an original-content match');
  let votes = pending.get(room); if (!votes) pending.set(room, votes = new Map());
  for (const [id, v] of votes) if (v.match !== m || v.expiresAt <= Date.now() || !room.spectatorOf(v.applicantId)) votes.delete(id);
  const sync = () => { room.aiTakeoverVotes = [...votes.values()].map(v => ({ id: v.id, applicantId: v.applicantId, applicantName: v.applicantName, botId: v.botId, expiresAt: v.expiresAt, eligible: takeoverVoters(room, v.botId), yes: [...v.yes], no: [...v.no] })); lobby.broadcastState(room); };
  if (msg.t === 'room.aiRequest') {
    const bot = m.players.get(msg.botId);
    if (!room.spectatorOf(session.playerId) || !session.connected || !bot?.isBot || bot.left || !bot.alive) return fail('a spectator must select an active AI');
    if ([...votes.values()].some(v => v.applicantId === session.playerId || v.botId === msg.botId)) return fail('request already pending');
    const id = String(room.aiTakeoverSeq = (room.aiTakeoverSeq || 0) + 1);
    const vote = { id, applicantId: session.playerId, applicantName: session.name, botId: msg.botId, match: m, expiresAt: Date.now() + 30000, yes: new Set(), no: new Set() }; votes.set(id, vote);
    const timer = setTimeout(() => { if (votes.get(id) === vote) { votes.delete(id); sync(); } }, 30000); vote.timer = timer; timer.unref?.(); sync(); return { ok: true };
  }
  const vote = votes.get(msg.voteId);
  if (!vote || vote.match !== m || Date.now() >= vote.expiresAt) return fail('request expired');
  const eligible = takeoverVoters(room, vote.botId);
  if (!eligible.includes(session.playerId)) return fail('only online human teammates can vote');
  (msg.approve ? vote.no : vote.yes).delete(session.playerId);
  (msg.approve ? vote.yes : vote.no).add(session.playerId);
  if (eligible.filter(id => vote.no.has(id)).length >= Math.floor(eligible.length / 2) + 1) { votes.delete(vote.id); sync(); return { ok: true }; }
  if (eligible.filter(id => vote.yes.has(id)).length >= Math.floor(eligible.length / 2) + 1) {
    votes.delete(vote.id); room.aiTakeoverVotes = [];
    const result = transferAiSeat(lobby, room, vote.applicantId, vote.botId); sync(); return result;
  }
  sync(); return { ok: true };
}
