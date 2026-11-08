// Game-owned spectator-to-AI handover. No monitor or administrator API dependency.
// A 第二期下半 match answers here synchronously. An official non-default version's match runs in its
// version host: the lobby asks aiHandoverView / acceptAiHandover and keeps sessions, seats, tokens,
// votes and timers in this process. Gameplay-plugin rooms stay refused.
import { ERR, PROTOCOL_VERSION } from '../shared/constants.js';
import { DEFAULT_VERSION } from '../shared/versions.js';
import { resetStateDelta, stateDeltaVersion } from './stateTransport.js';
const fail = detail => ({ error: ERR.BAD_TARGET, detail });
const pending = new WeakMap();

/** A real official-version match host. A forged `hosted` flag on an in-process match is not this. */
function hostView(room) {
  return !!room && room.match?.hosted === true && room.version !== DEFAULT_VERSION && !room.modded;
}

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

function votersFromView(room, view) {
  const row = (id) => view?.players?.find(p => p && p.playerId === id);
  const seats = room.seats.filter(s => s && !s.isBot && !s.left && s.connected);
  const ids = seats.filter(s => !row(s.playerId)?.autoplay).map(s => s.playerId);
  if (!ids.length && room.seatOf(room.hostId)?.connected) ids.push(room.hostId);
  return ids;
}

function hostSnap(raw) {
  if (!raw || raw.ok !== true || typeof raw.phase !== 'string' || !Array.isArray(raw.players)) return null;
  return raw;
}

export function transferAiSeat(lobby, room, applicantId, botId) {
  if (hostView(room)) return transferOnHost(lobby, room, applicantId, botId);
  const m = room.match, session = lobby.registry.byId(applicantId), spectator = room.spectatorOf(applicantId);
  const ps = m?.players?.get(botId), seat = room.seatOf(botId);
  if (room.aiTakeoverEnabled !== true || room.mode !== 'coop' || room.version !== DEFAULT_VERSION) return fail('AI handover is disabled');
  if (!session?.connected || !session.ws || !spectator || !ps?.isBot || ps.left || !ps.alive || !seat || m.phase !== 'PREP' || m.ended || m.disposed || m.emergencyFrozen) return fail('AI handover unavailable');
  if (room.modded || m.hosted) return fail('AI handover is unavailable in isolated plugin matches');
  if (lobby.registry.byId(botId)) return fail('AI seat already has a session');
  const conn = lobby.network?.conns.get(session.ws);
  if (!conn || conn.closing) return fail('connection unavailable');
  lobby.removeMember(room, applicantId); lobby.clearResync(applicantId);
  lobby.registry.byPlayerId.delete(applicantId); session.playerId = botId; lobby.registry.byPlayerId.set(botId, session);
  session.roomCode = room.code; session.notice = null; session.pendingResult = null; session.resyncAt = -Infinity;
  // The match method repeats the seat checks above and then does what this function used to write on the player.
  const accepted = m.acceptAiHandover(botId, session.name);
  if (!accepted || accepted.ok !== true) return accepted && accepted.error ? accepted : fail('AI handover unavailable');
  Object.assign(seat, { isBot: false, connected: true, left: false, ready: false, name: session.name });
  session.aiTakeoverFrom = applicantId;
  resetStateDelta(conn.ws);
  lobby.network.onHelloMsg(conn, { t: 'hello', version: PROTOCOL_VERSION, delta: stateDeltaVersion(conn.ws), name: session.name, token: session.token }, lobby.now());
  lobby.broadcastState(room); return { ok: true };
}

function bindInheritedSeat(lobby, room, session, conn, applicantId, botId) {
  lobby.removeMember(room, applicantId); lobby.clearResync(applicantId);
  lobby.registry.byPlayerId.delete(applicantId); session.playerId = botId; lobby.registry.byPlayerId.set(botId, session);
  session.roomCode = room.code; session.notice = null; session.pendingResult = null; session.resyncAt = -Infinity;
  const seat = room.seatOf(botId);
  if (seat) Object.assign(seat, { isBot: false, connected: true, left: false, ready: false, name: session.name });
  session.aiTakeoverFrom = applicantId;
  resetStateDelta(conn.ws);
  lobby.network.onHelloMsg(conn, { t: 'hello', version: PROTOCOL_VERSION, delta: stateDeltaVersion(conn.ws), name: session.name, token: session.token }, lobby.now());
  lobby.broadcastState(room);
}

function transferOnHost(lobby, room, applicantId, botId) {
  const m = room.match, session = lobby.registry.byId(applicantId), spectator = room.spectatorOf(applicantId);
  const seat = room.seatOf(botId);
  if (room.aiTakeoverEnabled !== true || room.mode !== 'coop' || !hostView(room)) return fail('AI handover is disabled');
  if (!session?.connected || !session.ws || !spectator || !seat) return fail('AI handover unavailable');
  if (lobby.registry.byId(botId)) return fail('AI seat already has a session');
  const conn = lobby.network?.conns.get(session.ws);
  if (!conn || conn.closing) return fail('connection unavailable');
  // The child re-checks the bot and the phase, then mutates. Rebind only after it accepts.
  return m.acceptAiHandover(botId, session.name).then((accepted) => {
    if (!accepted || accepted.ok !== true) return accepted && accepted.error ? accepted : fail('AI handover unavailable');
    if (lobby.registry.byId(applicantId) !== session || !session.connected || !session.ws || conn.closing || !room.spectatorOf(applicantId)) {
      // The host already made the seat human (the socket dropped during the round trip). [ASSUMED] It stays the
      // applicant's as a disconnected seat — their token resumes it, the match's disconnect rules apply meanwhile — and
      // an applicant whose session is gone has left it: never a human seat the lobby does not know.
      const seat = room.seatOf(botId);
      if (lobby.registry.byId(applicantId) === session && room.spectatorOf(applicantId)) {
        lobby.removeMember(room, applicantId); lobby.clearResync(applicantId);
        lobby.registry.byPlayerId.delete(applicantId); session.playerId = botId; lobby.registry.byPlayerId.set(botId, session);
        session.roomCode = room.code; session.aiTakeoverFrom = applicantId;
        if (seat) Object.assign(seat, { isBot: false, connected: false, left: false, ready: false, name: session.name });
        lobby.callMatch(room, 'onDisconnect', botId);
      } else {
        if (seat) Object.assign(seat, { isBot: false, connected: false, left: true, ready: false });
        lobby.callMatch(room, 'onLeave', botId);
      }
      lobby.broadcastState(room);
      return fail('connection unavailable');
    }
    bindInheritedSeat(lobby, room, session, conn, applicantId, botId);
    return { ok: true };
  });
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
  if (hostView(room)) return reconcileOnHost(lobby, room);
  const m = room.match;
  const eligible = m ? takeoverVoters(room) : [];
  let changed = false;
  for (const [id, v] of votes) {
    const applicant = lobby.registry.byId(v.applicantId), bot = m?.players?.get(v.botId);
    if (room.aiTakeoverEnabled !== true || room.modded || m?.hosted || room.version !== DEFAULT_VERSION
      || m !== v.match || m.phase !== 'PREP' || m.round !== v.round || m.ended || m.disposed || m.emergencyFrozen
      || !room.spectatorOf(v.applicantId)?.connected || !applicant?.connected || applicant.roomCode !== room.code
      || !bot?.isBot || !bot.alive || bot.left || Date.now() >= v.expiresAt
      || eligible.length !== v.eligible.length || eligible.some((pid, i) => pid !== v.eligible[i])) {
      drop(votes, id); changed = true;
    }
  }
  if (changed) snapshot(room, votes);
  return changed;
}

function reconcileWith(lobby, room, view) {
  const votes = pending.get(room);
  if (!votes?.size) return false;
  const m = room.match;
  const eligible = view ? votersFromView(room, view) : [];
  const row = (id) => view?.players?.find(p => p && p.playerId === id);
  let changed = false;
  for (const [id, v] of votes) {
    const applicant = lobby.registry.byId(v.applicantId), bot = row(v.botId);
    if (room.aiTakeoverEnabled !== true || room.modded || !hostView(room)
      || m !== v.match || view?.phase !== 'PREP' || view?.round !== v.round || view?.ended || view?.disposed || view?.emergencyFrozen
      || !room.spectatorOf(v.applicantId)?.connected || !applicant?.connected || applicant.roomCode !== room.code
      || !bot?.isBot || !bot.alive || bot.left || Date.now() >= v.expiresAt
      || eligible.length !== v.eligible.length || eligible.some((pid, i) => pid !== v.eligible[i])) {
      drop(votes, id); changed = true;
    }
  }
  if (changed) snapshot(room, votes);
  return changed;
}

function reconcileOnHost(lobby, room) {
  const m = room.match;
  if (!m || m.ended || m.disposed) return Promise.resolve(reconcileWith(lobby, room, null));
  return m.aiHandoverView().then((raw) => {
    const view = hostSnap(raw);
    // [ASSUMED] A failed host read does not cancel the vote. The next public snapshot, or the match ending, does.
    if (!view) return false;
    return reconcileWith(lobby, room, view);
  });
}

/** When reconcile read a version host, broadcast only after that read settles. A boolean stays synchronous. */
function afterReconcile(lobby, room, rec) {
  if (rec && typeof rec.then === 'function') {
    rec.then((changed) => { if (changed && room && !room.disposed) lobby.broadcastState(room); }, (e) => {
      lobby.log?.error?.(`[lobby] ${room?.code} AI handover reconcile failed`, e);
    });
    return;
  }
  if (rec && room) lobby.broadcastState(room);
}

export function aiTakeover(lobby, session, msg) {
  const room = lobby.roomOf(session);
  if (hostView(room)) return aiTakeoverOnHost(lobby, session, room, msg);
  if (room && reconcileAiTakeover(lobby, room)) lobby.broadcastState(room);
  return aiTakeoverInProcess(lobby, session, msg);
}

function aiTakeoverInProcess(lobby, session, msg) {
  const room = lobby.roomOf(session), m = room?.match;
  if (!room || room.aiTakeoverEnabled !== true || room.mode !== 'coop' || room.version !== DEFAULT_VERSION || !m || m.hosted || room.modded || m.phase !== 'PREP' || m.ended || m.disposed || m.emergencyFrozen) return fail('AI handover requires preparation in an original-content match');
  let votes = pending.get(room); if (!votes) pending.set(room, votes = new Map());
  const sync = () => { snapshot(room, votes); lobby.broadcastState(room); };
  if (msg.t === 'room.aiRequest') {
    const bot = m.players.get(msg.botId);
    if (!room.spectatorOf(session.playerId) || !session.connected || !bot?.isBot || bot.left || !bot.alive) return fail('a spectator must select an active AI');
    if ([...votes.values()].some(v => v.applicantId === session.playerId || v.botId === msg.botId)) return fail('request already pending');
    const eligible = takeoverVoters(room);
    if (!eligible.length) return fail('no online voter available');
    const id = String(room.aiTakeoverSeq = (room.aiTakeoverSeq || 0) + 1);
    // [ASSUMED] A 30-second vote expires without approval; the whole room elects by strict majority.
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

function aiTakeoverOnHost(lobby, session, room, msg) {
  return room.match.aiHandoverView().then((raw) => {
    const view = hostSnap(raw);
    if (view && reconcileWith(lobby, room, view)) lobby.broadcastState(room);
    return decideOnHost(lobby, session, room, msg, view);
  });
}

function decideOnHost(lobby, session, room, msg, view) {
  const m = room.match;
  if (room.aiTakeoverEnabled !== true || room.mode !== 'coop' || !hostView(room) || !m || !view || view.phase !== 'PREP' || view.ended || view.disposed || view.emergencyFrozen) {
    return fail('AI handover requires preparation in an original-content match');
  }
  let votes = pending.get(room); if (!votes) pending.set(room, votes = new Map());
  const sync = () => { snapshot(room, votes); lobby.broadcastState(room); };
  if (msg.t === 'room.aiRequest') {
    const bot = view.players.find(p => p && p.playerId === msg.botId);
    if (!room.spectatorOf(session.playerId) || !session.connected || !bot?.isBot || bot.left || !bot.alive) return fail('a spectator must select an active AI');
    if ([...votes.values()].some(v => v.applicantId === session.playerId || v.botId === msg.botId)) return fail('request already pending');
    const eligible = votersFromView(room, view);
    if (!eligible.length) return fail('no online voter available');
    const id = String(room.aiTakeoverSeq = (room.aiTakeoverSeq || 0) + 1);
    const vote = { id, applicantId: session.playerId, applicantName: session.name, botId: msg.botId,
      match: m, round: view.round, eligible, expiresAt: Date.now() + 30000, yes: new Set(), no: new Set() };
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
    const result = transferAiSeat(lobby, room, vote.applicantId, vote.botId);
    if (result && typeof result.then === 'function') return result.then((r) => { sync(); return r; });
    sync(); return result;
  }
  sync(); return { ok: true };
}

export { afterReconcile };
