// Transport layer (PRD M1): one WebSocket-shaped interface, three implementations.
// net.js talks only to this shape — `new (pickTransport(url))(url, opts)` replaces
// `new WebSocket(url)` and everything above it (handshake, reconnection, netbus) is unchanged.
//
// Contract (all implementations):
//   - readyState: 0 CONNECTING / 1 OPEN / 2 CLOSING / 3 CLOSED (WebSocket constants).
//   - onopen / onmessage({ data }) / onerror / onclose({ code, reason, wasClean }) handlers.
//   - open is asynchronous: attached handlers are set after construction and still fire.
//   - send(text): throws while CONNECTING (net.js checks readyState first), discards once closing.
//   - close(code = 1000, reason = ''): idempotent; close during CONNECTING completes the close.
//   - Messages are whole UTF-8 text frames; the layer above never sees transport chunks
//     (chunking/reassembly is internal — WebRTC data channels have 64 KiB message limits).
//   - close codes: WebRTC has no wire codes — unexpected remote drop = 1006, local close = 1000.
//     Loopback propagates real codes in-page (4001 CLOSE_REPLACED etc. — the net.js replacement
//     protocol test hook).
//
// URL schemes: p2p:<peerId> → WebRTC/PeerJS, loopback:<key> → in-process hub, anything else
// (ws:/wss:/http:) → globalThis.WebSocket. Node tests keep injecting `opts.WebSocket`, which
// takes priority over scheme dispatch.

import { LoopbackTransport, loopbackHub, LoopbackHub } from './transportLoopback.js';
import { WebRTCTransport, PeerHost } from './transportWebRTC.js';

/** @type {any} */ const g = globalThis;

/**
 * Pick the transport class for `url`. `ws:`/`wss:`/`http:`/`https:` fall back to the ambient
 * WebSocket (browser native; Node tests inject one via opts.WebSocket).
 * @param {string} url
 * @returns {any} constructor with the WebSocket-shaped contract above
 */
export function pickTransport(url) {
  const u = String(url);
  if (u.startsWith('loopback:')) return LoopbackTransport;
  if (u.startsWith('p2p:')) return WebRTCTransport;
  return g.WebSocket;
}

export { LoopbackTransport, loopbackHub, LoopbackHub, WebRTCTransport, PeerHost };
