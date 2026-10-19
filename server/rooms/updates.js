// Coalesce only changed identities and rooms. Publishing never participates in an intent's result.
export function createRoomUpdates(peer, { retryMs = 100 } = {}) {
  const sessions = new Map(), rooms = new Map(), sentSessions = new Map(), sentRooms = new Map();
  let timer = null, sending = false, closed = false, flight = null;
  function schedule(delay = 0) {
    if (closed || timer || sending) return;
    timer = setTimeout(flush, delay);
    timer.unref?.();
  }
  function select(dirty, previous) {
    const selected = [], stamps = [];
    for (const [key, value] of dirty) {
      const stamp = JSON.stringify(value);
      if (previous.get(key) !== stamp) { selected.push([key, value]); stamps.push([key, stamp]); }
    }
    dirty.clear();
    return { selected, stamps };
  }
  async function flush() {
    timer = null;
    if (closed || sending) return;
    const s = select(sessions, sentSessions), r = select(rooms, sentRooms);
    if (!s.selected.length && !r.selected.length) return;
    sending = true;
    flight = { sessions: s.selected, rooms: r.selected };
    let retry = 0;
    try {
      await peer.notify('update', { sessions: s.selected, rooms: r.selected });
      for (const [key, stamp] of s.stamps) { if (stamp === 'null') sentSessions.delete(key); else sentSessions.set(key, stamp); }
      for (const [key, stamp] of r.stamps) { if (stamp === 'null') sentRooms.delete(key); else sentRooms.set(key, stamp); }
    } catch {
      for (const [key, value] of s.selected) if (!sessions.has(key)) sessions.set(key, value);
      for (const [key, value] of r.selected) if (!rooms.has(key)) rooms.set(key, value);
      retry = retryMs;
    } finally {
      sending = false;
      flight = null;
      if (sessions.size || rooms.size) schedule(retry);
    }
  }
  return {
    // Admission completions carry pending changes before the primary releases their reservation.
    snapshot() {
      return { sessions: [...new Map([...(flight?.sessions || []), ...sessions])],
        rooms: [...new Map([...(flight?.rooms || []), ...rooms])] };
    },
    session(session, removed = false) {
      const { ws: _ws, ...value } = session;
      sessions.set(session.playerId, removed ? null : value);
      schedule();
    },
    room(room, removed = false) {
      rooms.set(room.code, removed ? null : { code: room.code, ownerKey: room.ownerKey, matchKey: room.matchKey,
        running: !!room.match, humans: room.activeHumans().map((s) => s.playerId),
        cs: room.content?.vanilla === false ? room.content.cs : null, vs: room.content?.vs ?? null,
        bots: room.seats.filter((s) => s?.isBot && !s.left).length,
        spectators: room.spectators.map((s) => s.playerId) });
      schedule();
    },
    close() { closed = true; clearTimeout(timer); sessions.clear(); rooms.clear(); },
  };
}
