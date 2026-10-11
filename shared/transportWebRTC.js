// WebRTC DataChannel transport over a PeerJS signalling server (PRD M1 方案 A: LAN play without
// a game server — the host is also a peer, only signalling is hosted).
//
// URL: p2p:<hostPeerId>. Client side: WebRTCTransport. Host side: PeerHost + WebSocket-shaped
// HostEndpoint (shared/transportLoopback.js documents the same handler contract), so the in-page
// match code consumes Loopback and WebRTC ends identically.
//
// PeerJS is never imported statically: `opts.Peer` (tests) or globalThis.Peer (vendor UMD
// dist/peerjs.min.js loaded by a script tag — public/vendor/peerjs.min.js). Without a Peer
// constructor the transport throws synchronously; net.js (connect) catches and backs off.
//
// close codes: WebRTC has none — an unexpected remote drop reaches us as 'close' → 1006 (not
// clean), a local close() is 1000. Connection-id replacement lives above this layer (net.js).

import { chunkMessages, FrameAssembler } from './transportFrames.js';

const SCHEME = 'p2p:';
export const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024;
export const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
export const DEFAULT_PEER_OPTIONS = {
  debug: 0,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
};

const defer = (fn) => { Promise.resolve().then(fn); };

/** @type {any} */ const g = globalThis;

/**
 * @param {any} err PeerJS error object — `{ type }` (e.g. 'peer-unavailable') plus a message, or a bare string.
 */
const errText = (err) => {
  if (!err) return String(err);
  const type = typeof err === 'object' && err.type ? `${err.type}: ` : '';
  const msg = typeof err === 'object' ? (err.message || '') : String(err);
  return type + (msg || String(err));
};

export class WebRTCTransport {
  /**
   * @param {string} url p2p:<hostPeerId>
   * @param {{Peer?: any, peerOptions?: any, hostPeerId?: string, maxMessageSize?: number,
   *   connectTimeoutMs?: number, metadata?: any, iceServers?: any[]}} [opts]
   */
  constructor(url, opts = {}) {
    this.url = String(url);
    this.hostPeerId = opts.hostPeerId
      || (this.url.startsWith(SCHEME) ? this.url.slice(SCHEME.length) : this.url);
    if (!this.hostPeerId) throw new Error('p2p transport: missing host peer id');
    const Peer = opts.Peer || g.Peer;
    if (typeof Peer !== 'function') throw new Error('p2p transport: PeerJS not loaded (globalThis.Peer missing)');
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._closed = false;
    this._rx = new FrameAssembler();
    this._tx = new FrameAssembler();
    this._chunkId = 0;
    this._conn = null;
    this._peer = null;
    this._timer = null;
    this.maxBytes = opts.maxMessageSize || DEFAULT_MAX_MESSAGE_BYTES;
    const peerOptions = opts.peerOptions || DEFAULT_PEER_OPTIONS;
    if (opts.iceServers) peerOptions.config = { ...peerOptions.config, iceServers: opts.iceServers };
    const timeout = opts.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS;
    defer(() => {
      if (this._closed) return;
      let peer;
      try {
        peer = new Peer(undefined, peerOptions);
      } catch (err) {
        this._fail('p2p transport: Peer constructor failed: ' + errText(err), 1006, true);
        return;
      }
      this._peer = peer;
      peer.on('error', (err) => {
        if (this.readyState === 0) this._fail('p2p transport: signalling error: ' + errText(err), 1006, true);
        else this.onerror?.(new Error(errText(err)));
      });
      peer.on('open', () => {
        if (this._closed || this.readyState !== 0) return;
        let conn;
        try {
          conn = peer.connect(this.hostPeerId, {
            reliable: true,
            ordered: true,
            metadata: opts.metadata,
          });
        } catch (err) {
          this._fail('p2p transport: peer.connect failed: ' + errText(err), 1006, true);
          return;
        }
        if (!conn) { this._fail('p2p transport: peer.connect returned nothing', 1006, true); return; }
        this._conn = conn;
        conn.on('open', () => {
          if (this._closed) return;
          this._clearTimer();
          this.readyState = 1;
          this.onopen?.();
        });
        conn.on('data', (data) => this._onData(data));
        conn.on('error', (err) => {
          if (this.readyState === 0) this._fail('p2p transport: data channel error: ' + errText(err), 1006, true);
          else this.onerror?.(new Error(errText(err)));
        });
        conn.on('close', () => {
          if (this.readyState === 0) this._fail('p2p transport: closed before open', 1006, true);
          else this._close(1006, 'remote closed');
        });
      });
      // Timer via the globalThis cast: shared/ typechecks with lib ES2022 + types:[] (no DOM timer types).
      this._timer = g.setTimeout(() => {
        if (this.readyState === 0) this._fail('p2p transport: connect timeout', 1006, true);
      }, timeout);
    });
  }

  _onData(data) {
    if (this.readyState !== 1) return;
    const text = typeof data === 'string' ? data : String(data);
    const frame = this._rx.push(text);
    if (frame !== null) this.onmessage?.({ data: frame });
  }

  _nextChunkId() {
    this._chunkId = (this._chunkId + 1) & 0x7fffffff;
    return this._chunkId;
  }

  send(text) {
    if (this.readyState === 0) throw new Error('InvalidStateError: p2p transport not open');
    if (this.readyState !== 1 || !this._conn) return;
    const parts = chunkMessages(String(text), this.maxBytes, this._nextChunkId());
    const conn = this._conn;
    defer(() => {
      for (const p of parts) {
        if (this.readyState !== 1) return;
        const frame = this._tx.push(p);
        if (frame !== null) conn.send(frame);
      }
    });
  }

  close(code = 1000, reason = '') { this._close(code, reason); }

  _fail(reason, code, reportError) {
    if (this._closed) return;
    // WebSocket order: error first, close second (defer before _close queues its own callback).
    if (reportError) defer(() => this.onerror?.(new Error(reason)));
    this._close(code, reason);
  }

  _close(code, reason) {
    if (this._closed) return;
    this._closed = true;
    this._clearTimer();
    const c = code || 1000;
    const wasOpen = this.readyState === 1;
    this.readyState = 3;
    const conn = this._conn;
    const peer = this._peer;
    this._conn = null;
    this._peer = null;
    defer(() => {
      if (conn) { try { conn.close(); } catch { /* ignore */ } }
      if (peer) { try { peer.destroy(); } catch { /* ignore */ } }
      if (c !== 1000 && wasOpen) this.onerror?.(new Error(reason || 'p2p closed'));
      this.onclose?.({ code: c, reason, wasClean: c === 1000 });
    });
  }

  _clearTimer() {
    if (this._timer !== null) { g.clearTimeout(this._timer); this._timer = null; }
  }
}

/**
 * Host side: owns one Peer, accepts data channels, hands each connection a WebSocket-shaped
 * endpoint (same handler contract as LoopbackHub: `onConnection(ep)`, `ep.onmessage = …`,
 * `ep.send(text)`, `ep.close(code, reason)`). Chunks are reassembled per endpoint.
 */
export class PeerHost {
  /**
   * @param {{peerId?: string, Peer?: any, peerOptions?: any, onConnection: (ep: any) => void,
   *   maxMessageSize?: number}} opts
   */
  constructor(opts) {
    const Peer = opts.Peer || g.Peer;
    if (typeof Peer !== 'function') throw new Error('PeerHost: PeerJS not loaded (globalThis.Peer missing)');
    if (typeof opts.onConnection !== 'function') throw new TypeError('PeerHost: needs onConnection()');
    this._connIds = new Set();
    this._max = opts.maxMessageSize || DEFAULT_MAX_MESSAGE_BYTES;
    this._onConnection = opts.onConnection;
    this._peer = new Peer(opts.peerId, opts.peerOptions || DEFAULT_PEER_OPTIONS);
    this._peer.on('connection', (conn) => this._accept(conn));
  }

  get peerId() { return this._peer && this._peer.id; }

  _accept(conn) {
    const host = this;
    const rx = new FrameAssembler();
    const ep = {
      readyState: 0,
      peerId: conn.peer,
      onmessage: null,
      send(text) {
        if (ep.readyState !== 1) return;
        const parts = chunkMessages(String(text), host._max, host._chunkId());
        defer(() => { for (const p of parts) if (ep.readyState === 1) conn.send(p); });
      },
      close(code = 1000, reason = '') {
        if (ep.readyState === 3) return;
        ep.readyState = 3;
        defer(() => {
          try { conn.close(); } catch { /* ignore */ }
          ep.onclose?.({ code, reason, wasClean: code === 1000 });
        });
      },
      onclose: null,
    };
    conn.on('open', () => {
      if (ep.readyState === 3) return;
      ep.readyState = 1;
      this._connIds.add(conn.peer);
      this._onConnection(ep);
    });
    conn.on('data', (data) => {
      if (ep.readyState !== 1) return;
      const frame = rx.push(typeof data === 'string' ? data : String(data));
      if (frame !== null) ep.onmessage?.({ data: frame });
    });
    conn.on('close', () => {
      if (ep.readyState === 3) return;
      ep.readyState = 3;
      this._connIds.delete(conn.peer);
      ep.onclose?.({ code: 1006, reason: 'remote closed', wasClean: false });
    });
    conn.on('error', () => {
      if (ep.readyState === 3) return;
      ep.readyState = 3;
      try { conn.close(); } catch { /* ignore */ }
      ep.onclose?.({ code: 1006, reason: 'channel error', wasClean: false });
    });
  }

  _chunkId() {
    this._cid = ((this._cid || 0) + 1) & 0x7fffffff;
    return this._cid;
  }

  destroy() {
    try { this._peer.destroy(); } catch { /* ignore */ }
  }
}
