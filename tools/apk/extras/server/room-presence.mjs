// room-presence.mjs — Room Presence reporter (v2.7.2, shell extra; loaded by server/index.js
// via the /_sp_* shell patch when SP_DIR_URL and SP_SERVER_ID are set).
//
// Discovery ≠ joinability: this module only tells the directory WHICH server currently has a
// joinable lobby room under a given code. The target server's own Lobby remains the final
// authority on ROOM_NOT_FOUND / ROOM_FULL / ROOM_STARTED — the client re-checks by joining.
//
//   room created            → POST {DIR}/presence/<code>        {serverId}
//   room state changed      → register again if joinable / remove if not
//   room disposed           → POST {DIR}/presence/<code>/remove
//   every 30 s              → re-register all joinable rooms (heartbeat; directory TTL 90 s)
//   process shutdown        → remove all
//
//joinable definition mirrors the upstream Lobby: in the lobby (not started), has a free seat,
// and is not solo (the upstream join handler rejects solo rooms with ROOM_FULL).
// Requires env: SP_DIR_URL, SP_SERVER_ID; optional SP_DIR_TOKEN (sent as x-server-token).

const DIR = () => (process.env.SP_DIR_URL || '').replace(/\/+$/, '');
const SERVER_ID = () => String(process.env.SP_SERVER_ID || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);

const HEARTBEAT_MS = 30 * 1000;
const pending = new Set(); // codes with an in-flight transition, de-duped

function joinable(room) {
  return !!room && !room.disposed && !room.inMatch && room.mode !== 'solo'
    && typeof room.freeSeat === 'function' && room.freeSeat() >= 0;
}

async function post(path, body) {
  const dir = DIR();
  if (!dir) return;
  try {
    await fetch(dir + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.SP_DIR_TOKEN ? { 'x-server-token': process.env.SP_DIR_TOKEN } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });
  } catch (e) {
    console.error('[presence]', path, String(e && e.message || e).slice(0, 80));
  }
}

const register = (code) => post(`/presence/${encodeURIComponent(code)}`, { code, serverId: SERVER_ID() });
const remove = (code) => post(`/presence/${encodeURIComponent(code)}/remove`, { code });

function syncRoom(room) {
  if (!room || !room.code) return;
  const code = String(room.code).toUpperCase();
  if (pending.has(code)) return; // one in-flight request per code is enough
  pending.add(code);
  const op = joinable(room) ? register(code) : remove(code);
  op.finally(() => pending.delete(code));
}

/** Hooks the upstream Lobby instance without touching its protocol or source. */
export function startPresence({ lobby, intervalMs = HEARTBEAT_MS } = {}) {
  if (!lobby || typeof lobby.rooms?.values !== 'function') {
    console.error('[presence] no lobby handle — disabled');
    return () => {};
  }
  if (!DIR() || !SERVER_ID()) {
    console.log('[presence] SP_DIR_URL / SP_SERVER_ID not set — room presence disabled');
    return () => {};
  }
  console.log(`[presence] reporting joinable rooms to ${DIR()} as server "${SERVER_ID()}"`);

  const known = new Map(); // code → lastJoinable, so we only fire on transitions

  const scanAll = () => { for (const room of lobby.rooms.values()) syncRoom(room); };
  const onChange = (room) => {
    const code = String(room.code).toUpperCase();
    const now = joinable(room);
    if (known.get(code) === now) return; // only transitions hit the network
    known.set(code, now);
    syncRoom(room);
  };

  // broadcastState fires on every visible room change (join/leave/ready/start/host migration)
  const origBroadcast = lobby.broadcastState.bind(lobby);
  lobby.broadcastState = (room) => { try { onChange(room); } catch { /* never break the game */ } return origBroadcast(room); };

  // full reconcile each heartbeat (covers missed transitions + renews TTL)
  const timer = setInterval(() => { try { scanAll(); } catch { /* ignore */ } }, intervalMs);
  timer.unref();

  // graceful shutdown: remove everything we own
  const removeAll = () => {
    for (const room of lobby.rooms.values()) {
      if (room && room.code) remove(String(room.code).toUpperCase());
    }
  };
  const onExit = () => { try { removeAll(); } catch { /* best effort */ } };
  process.once('SIGINT', onExit);
  process.once('SIGTERM', onExit);
  process.once('beforeExit', onExit);

  scanAll();
  return () => {
    clearInterval(timer);
    lobby.broadcastState = origBroadcast;
    process.off('SIGINT', onExit);
    process.off('SIGTERM', onExit);
    process.off('beforeExit', onExit);
  };
}
