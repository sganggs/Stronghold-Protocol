// room-discovery.mjs — Room Discovery reporter + probe (v2.8.0, shell extra).
//
// Two independent capabilities, both additive to the upstream server (no lobby.js changes):
//
// 1) Presence (server self-report, unchanged from v2.7.2):
//    joinable-room transitions → POST {DIR}/presence/<code>  {serverId}   (needs SP_SERVER_ID)
//
// 2) Room probe endpoint (L1 discovery for servers that run this module):
//    GET /room-probe/<code> → {ok:true, exists, joinable} — no WS session, no room.join,
//    no seat side effects. Mounted by the shell patch in server/index.js.
//
// Env: SP_DIR_URL, SP_SERVER_ID (presence); probe needs nothing beyond being loaded.

const DIR = () => (process.env.SP_DIR_URL || '').replace(/\/+$/, '');
const SERVER_ID = () => String(process.env.SP_SERVER_ID || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
const CODE_RE = /^[A-HJ-NP-Z]{4}$/;

const pending = new Set();
const HEARTBEAT_MS = 30 * 1000;

/** Mirrors the upstream Lobby join rules: not disposed, not started, not solo, has a free seat. */
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
  if (pending.has(code)) return;
  pending.add(code);
  const op = joinable(room) ? register(code) : remove(code);
  op.finally(() => pending.delete(code));
}

/** Hooks the Lobby instance for presence transitions + periodic reconcile. */
export function startPresence({ lobby, intervalMs = HEARTBEAT_MS } = {}) {
  if (!lobby || typeof lobby.rooms?.values !== 'function') {
    console.error('[presence] no lobby handle — disabled');
    return () => {};
  }
  if (!DIR() || !SERVER_ID()) {
    console.log('[presence] SP_DIR_URL / SP_SERVER_ID not set — server self-report disabled');
    return () => {};
  }
  console.log(`[presence] reporting joinable rooms to ${DIR()} as server "${SERVER_ID()}"`);

  const known = new Map();
  const scanAll = () => { for (const room of lobby.rooms.values()) syncRoom(room); };
  const onChange = (room) => {
    const code = String(room.code).toUpperCase();
    const now = joinable(room);
    if (known.get(code) === now) return;
    known.set(code, now);
    syncRoom(room);
  };

  const origBroadcast = lobby.broadcastState.bind(lobby);
  lobby.broadcastState = (room) => { try { onChange(room); } catch { /* never break the game */ } return origBroadcast(room); };

  const timer = setInterval(() => { try { scanAll(); } catch { /* ignore */ } }, intervalMs);
  timer.unref();

  const removeAll = () => { for (const room of lobby.rooms.values()) if (room?.code) remove(String(room.code).toUpperCase()); };
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

/**
 * L1 probe handler for GET /room-probe/<code> (mounted by the shell patch).
 * Returns true when the request was handled. Read-only: lobby.getRoom() does not mutate.
 */
export function handleProbe(req, res, lobby, code, send) {
  const K = String(code || '').toUpperCase();
  if (!CODE_RE.test(K)) { send(req, res, 400, { ok: false, error: 'bad code' }); return true; }
  const room = typeof lobby?.getRoom === 'function' ? lobby.getRoom(K) : null;
  send(req, res, 200, { ok: true, exists: !!room, joinable: joinable(room) });
  return true;
}
