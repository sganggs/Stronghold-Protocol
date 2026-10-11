// In-process transport (PRD M1 方案 A 基底): two WebSocket-shaped endpoints wired through a
// shared hub. Single-player hosts the in-page Match at a `loopback:` key; tests run the full
// Net ↔ host handshake without a network.
//
// URL: loopback:<key>. The hub is page-global by default (`loopbackHub`); tests pass their own
// `{ hub }` for isolation. Handlers are invoked from microtasks — construction never opens
// synchronously — so net.js can attach onopen/onmessage after `new WS(url)` (shared/transport.js
// documents the full contract).
//
// The host end is the same shape as the client end (readyState/onmessage/send/close), which is
// what the in-page host handler and M1 tests consume. The server/ws bridge for server/ code is M2.

import { chunkMessages, FrameAssembler } from './transportFrames.js';

const SCHEME = 'loopback:';

/** Run `fn` on a fresh microtask (Promise keeps shared/ free of host globals; typechecks as ES2022). */
const defer = (fn) => { Promise.resolve().then(fn); };

/**
 * Registry of in-page hosts. A host is `{ open(ep), close?(ep, code, reason) }` and the endpoint
 * it receives is WebSocket-shaped — `ep.onmessage = fn`, `ep.send(text)`, `ep.close(code)` — the
 * exact shape PeerHost hands to its `onConnection(ep)` (shared/transportWebRTC.js), so one host
 * implementation serves both transports. Chunks are reassembled before `onmessage` sees them, so
 * a handler always gets whole protocol frames.
 *
 * @typedef {{ open: (ep: any) => void, close?: (ep: any, code: number, reason: string) => void }} LoopbackHost
 */

export class LoopbackHub {
  constructor() {
    /** @type {Map<string, LoopbackHost>} */
    this.hosts = new Map();
  }

  /**
   * @param {string} key
   * @param {LoopbackHost} host
   * @returns {() => void} detach
   */
  attach(key, host) {
    if (!host || typeof host.open !== 'function') {
      throw new TypeError('LoopbackHub.attach: host needs open()');
    }
    if (this.hosts.has(key)) throw new Error(`LoopbackHub.attach: key "${key}" already has a host`);
    this.hosts.set(key, host);
    return () => { if (this.hosts.get(key) === host) this.hosts.delete(key); };
  }

  /** @param {string} key */
  detach(key) { this.hosts.delete(key); }
  clear() { this.hosts.clear(); }
  /** @param {string} key */
  get(key) { return this.hosts.get(key) || null; }
}

/** Default hub — single-player attaches here before creating the Net. */
export const loopbackHub = new LoopbackHub();

export class LoopbackTransport {
  /**
   * @param {string} url loopback:<key>
   * @param {{hub?: LoopbackHub, maxMessageSize?: number}} [opts] maxMessageSize 0 = unlimited (in-page)
   */
  constructor(url, opts = {}) {
    this.url = String(url);
    this.key = this.url.startsWith(SCHEME) ? this.url.slice(SCHEME.length) : this.url;
    this.hub = opts.hub || loopbackHub;
    this.maxMessageSize = opts.maxMessageSize || 0;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this._rx = new FrameAssembler();
    this._tx = new FrameAssembler();
    this._chunkId = 0;
    this._closed = false;
    this._ep = null;
    this._host = null;
    defer(() => this._open());
  }

  _open() {
    if (this._closed) return;
    const host = this.hub.get(this.key);
    if (!host) {
      this._close(1006, 'loopback: no host at "' + this.key + '"');
      return;
    }
    const client = this;
    const ep = {
      readyState: 1,
      peerId: 'loopback:' + this.key,
      onmessage: null,
      onclose: null,
      send: (text) => {
        if (client.readyState !== 1 || client._closed) return;
        const parts = chunkMessages(String(text), client.maxMessageSize, client._nextChunkId());
        defer(() => { for (const p of parts) client._deliver(p); });
      },
      close: (code, reason) => client._close(code || 1000, reason || 'closed by host'),
    };
    this._ep = ep;
    this._host = host;
    // OPEN before host.open so a host that greets synchronously in open() is not dropped;
    // ep.send defers delivery, so the consumer still sees onopen before the first message.
    this.readyState = 1;
    try {
      host.open(ep);
    } catch (err) {
      this.readyState = 0;
      this._close(1006, 'loopback: host.open failed: ' + (err && err.message));
      return;
    }
    if (this._closed) return;
    this.onopen?.();
  }

  _nextChunkId() {
    this._chunkId = (this._chunkId + 1) & 0x7fffffff;
    return this._chunkId;
  }

  /** One wire message in: reassemble, then hand the whole frame to the consumer. */
  _deliver(text) {
    const frame = this._rx.push(text);
    if (frame !== null) this.onmessage?.({ data: frame });
  }

  /** WebSocket-shaped send: throws while CONNECTING, discards once CLOSING/CLOSED. */
  send(text) {
    if (this.readyState === 0) throw new Error('InvalidStateError: loopback transport not open');
    if (this.readyState !== 1) return;
    const parts = chunkMessages(String(text), this.maxMessageSize, this._nextChunkId());
    const ep = this._ep;
    if (!ep) return;
    defer(() => {
      // No _closed guard: a frame queued before close() flushes to the host first (send runs
      // before the close callback in the same microtask queue), like a socket's write buffer.
      for (const p of parts) {
        const frame = this._tx.push(p);
        if (frame !== null) ep.onmessage?.({ data: frame });
      }
    });
  }

  /** @param {number} [code] @param {string} [reason] */
  close(code = 1000, reason = '') {
    this._close(code, reason);
  }

  _close(code, reason) {
    if (this._closed) return;
    this._closed = true;
    const c = code || 1000;
    const wasOpen = this.readyState === 1;
    this.readyState = 3;
    const host = this._host;
    const ep = this._ep;
    this._host = null;
    this._ep = null;
    defer(() => {
      if (wasOpen && host) { try { host.close?.(ep, c, reason); } catch { /* ignore */ } }
      if (c !== 1000) this.onerror?.(new Error(reason || 'loopback closed'));
      this.onclose?.({ code: c, reason, wasClean: c === 1000 });
    });
  }
}
