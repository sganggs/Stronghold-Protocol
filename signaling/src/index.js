// Cloudflare Durable Object version of server/signaling.js.
// One Hub holds every room. Seat metadata is stored on the socket (serializeAttachment) so a
// hibernated object can still forward SDP after it wakes.

const ROOM_RE = /^[A-Z0-9]{4,8}$/;
const PEER_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PEERS = 8;
const RELAY_MAX = 65536;

function send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); } catch { /* closing */ }
}

export class Hub {
  /** @param {DurableObjectState} state */
  constructor(state) { this.state = state; }

  /** @param {Request} request */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('stronghold signaling', { status: 200 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** @param {WebSocket} ws @param {string} raw */
  webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'join') this._join(ws, msg);
    else if (msg.type === 'signal') this._signal(ws, msg);
    else if (msg.type === 'relay') this._relay(ws, msg);
    else if (msg.type === 'leave') this._remove(ws);
  }

  /** @param {WebSocket} ws */
  webSocketClose(ws) { this._remove(ws); }

  /** @param {string} room @param {string} [except] */
  _seats(room, except) {
    const out = [];
    for (const sock of this.state.getWebSockets()) {
      const seat = sock.deserializeAttachment();
      if (!seat || seat.room !== room || seat.peerId === except) continue;
      out.push({ ws: sock, ...seat });
    }
    return out;
  }

  /** @param {WebSocket} ws @param {any} msg */
  _join(ws, msg) {
    const room = String(msg.room || '').trim().toUpperCase();
    const peerId = String(msg.peerId || '');
    const role = msg.role === 'host' ? 'host' : 'guest';
    if (!ROOM_RE.test(room) || !PEER_RE.test(peerId)) { send(ws, { type: 'error', error: 'bad join' }); return; }
    const prev = this._seats(room).find((s) => s.peerId === peerId);
    const size = this._seats(room).length;
    if (!prev && size >= MAX_PEERS) { send(ws, { type: 'error', error: 'room full' }); return; }
    const old = ws.deserializeAttachment();
    if (old) this._remove(ws);
    ws.serializeAttachment({ room, peerId, role });
    if (prev && prev.ws !== ws) { try { prev.ws.close(4000, 'replaced'); } catch { /* ignore */ } }
    const peers = [];
    for (const seat of this._seats(room, peerId)) {
      peers.push({ peerId: seat.peerId, role: seat.role });
      send(seat.ws, { type: 'peer-joined', peerId, role });
    }
    send(ws, { type: 'joined', room, peers });
  }

  /** @param {WebSocket} ws @param {any} msg */
  _signal(ws, msg) {
    const self = ws.deserializeAttachment();
    if (!self) return;
    const target = this._seats(self.room).find((s) => s.peerId === String(msg.to || ''));
    if (!target || target.ws === ws) return;
    send(target.ws, { type: 'signal', from: self.peerId, data: msg.data ?? null });
  }

  /** Game traffic used when the browsers' direct channel never opens. @param {WebSocket} ws @param {any} msg */
  _relay(ws, msg) {
    const self = ws.deserializeAttachment();
    if (!self || typeof msg.data !== 'string' || msg.data.length > RELAY_MAX) return;
    const target = this._seats(self.room).find((s) => s.peerId === String(msg.to || ''));
    if (!target || target.ws === ws) return;
    send(target.ws, { type: 'relay', from: self.peerId, data: msg.data });
  }

  /** @param {WebSocket} ws */
  _remove(ws) {
    const self = ws.deserializeAttachment();
    if (!self) return;
    ws.serializeAttachment(null);
    for (const seat of this._seats(self.room)) send(seat.ws, { type: 'peer-left', peerId: self.peerId });
  }
}

export default {
  /** @param {Request} request @param {{ HUB: DurableObjectNamespace }} env */
  async fetch(request, env) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('stronghold signaling', { status: 200 });
    }
    const id = env.HUB.idFromName('hub');
    return env.HUB.get(id).fetch(request);
  },
};
