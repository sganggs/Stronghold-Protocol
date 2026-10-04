// WebRTC signaling for P2P rooms (see /p2p-simplified.md).
//
// This process only introduces peers. It does not see game commands: those travel on the data
// channel between browsers. Rooms live in this process (one Node server), not inside a single
// WebSocket callback — a per-connection map cannot introduce two players to each other.
//
//   join    { type:'join', room, peerId, role:'host'|'guest' }
//   signal  { type:'signal', to, data }          forwarded as { type:'signal', from, data }
//   leave   { type:'leave' }
//
//   joined      { type:'joined', room, peers:[{ peerId, role }] }
//   peer-joined { type:'peer-joined', peerId, role }
//   peer-left   { type:'peer-left', peerId }

const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const PEER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PEERS = 8;

/** @param {import('ws').WebSocket | { readyState: number, send: Function }} ws @param {object} obj */
function send(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* closing */ }
}

/**
 * In-memory room directory. `handle(ws)` is the connection listener.
 * @param {{ log?: { warn?: Function } }} [opts]
 */
export function createSignaling(opts = {}) {
  const log = opts.log || {};
  /** @type {Map<string, Map<string, { ws: any, role: string }>>} */
  const rooms = new Map();

  /** @param {string} code */
  function roomOf(code) {
    let room = rooms.get(code);
    if (!room) rooms.set(code, (room = new Map()));
    return room;
  }

  /**
   * @param {string} code
   * @param {string} peerId
   * @param {any} ws
   */
  function detach(code, peerId, ws) {
    const room = rooms.get(code);
    if (!room) return;
    const cur = room.get(peerId);
    if (!cur || cur.ws !== ws) return;
    room.delete(peerId);
    for (const peer of room.values()) send(peer.ws, { type: 'peer-left', peerId });
    if (room.size === 0) rooms.delete(code);
  }

  /** @param {any} ws */
  function handle(ws) {
    /** @type {string | null} */
    let roomCode = null;
    /** @type {string | null} */
    let peerId = null;

    const leave = () => {
      if (roomCode && peerId) detach(roomCode, peerId, ws);
      roomCode = null;
      peerId = null;
    };

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(typeof data === 'string' ? data : data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'join') {
        const room = String(msg.room || '').trim().toUpperCase();
        const id = String(msg.peerId || '');
        const role = msg.role === 'host' ? 'host' : 'guest';
        if (!ROOM_RE.test(room) || !PEER_RE.test(id)) {
          send(ws, { type: 'error', error: 'bad join' });
          return;
        }
        if (roomCode && (roomCode !== room || peerId !== id)) leave();
        const bucket = roomOf(room);
        const prev = bucket.get(id);
        if (!prev && bucket.size >= MAX_PEERS) {
          send(ws, { type: 'error', error: 'room full' });
          return;
        }
        // Install the new socket before closing the old one, so the old close cannot drop the new seat.
        bucket.set(id, { ws, role });
        if (prev && prev.ws !== ws) {
          try { prev.ws.close(4000, 'replaced'); } catch { /* ignore */ }
        }
        roomCode = room;
        peerId = id;
        const peers = [];
        for (const [otherId, peer] of bucket) {
          if (otherId === id || peer.ws.readyState !== 1) continue;
          peers.push({ peerId: otherId, role: peer.role });
          send(peer.ws, { type: 'peer-joined', peerId: id, role });
        }
        send(ws, { type: 'joined', room, peers });
        return;
      }

      if (msg.type === 'signal') {
        if (!roomCode || !peerId) return;
        const target = rooms.get(roomCode)?.get(String(msg.to || ''));
        if (!target || target.ws === ws) return;
        send(target.ws, { type: 'signal', from: peerId, data: msg.data ?? null });
        return;
      }

      if (msg.type === 'leave') leave();
    });

    ws.on('close', () => leave());
    ws.on('error', (e) => { log.warn?.('[signal] socket error', e?.message || e); });
  }

  return { handle, rooms };
}
