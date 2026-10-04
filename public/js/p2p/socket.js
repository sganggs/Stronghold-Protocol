// Sockets the existing client (`public/js/net.js`) and the in-browser authority (`server/net.js`)
// already know how to speak. The host player's UI and the host's Lobby talk through an in-process
// pair. Each guest is a WebRTC data channel that looks like a WebSocket to the host's Network.

import { createReassembler, decodeData, framedSend } from './frame.js';

/**
 * In-process socket pair.
 * `client` is the browser Net socket (onopen / onmessage / send / close).
 * `server` is the ws-like socket Network.handleConnection expects.
 * Call `open()` only after the server side is attached and the client handlers are assigned.
 */
export function createLoopback() {
  /** @type {Map<string, Set<Function>>} */
  const serverHandlers = new Map();
  const client = {
    readyState: 0,
    bufferedAmount: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    /** @param {string} data */
    send(data) {
      if (client.readyState !== 1) return;
      emit(serverHandlers, 'message', String(data), false);
    },
    /** @param {number} [code] @param {string} [reason] */
    close(code = 1000, reason = '') {
      if (client.readyState === 3) return;
      client.readyState = 3;
      server.readyState = 3;
      emit(serverHandlers, 'close', code, reason);
      client.onclose?.({ code, reason });
    },
  };
  const server = {
    readyState: 0,
    bufferedAmount: 0,
    /** @param {string} data @param {Function} [cb] */
    send(data, cb) {
      try {
        if (client.readyState === 1 && server.readyState === 1) client.onmessage?.({ data: String(data) });
        cb?.();
      } catch { /* the client listener already logged */ }
    },
    /** @param {number} [code] @param {string} [reason] */
    close(code = 1000, reason = '') {
      if (server.readyState === 3) return;
      server.readyState = 3;
      client.readyState = 3;
      client.onclose?.({ code, reason });
      emit(serverHandlers, 'close', code, reason);
    },
    terminate() { this.close(1006, 'terminate'); },
    ping() { emit(serverHandlers, 'pong'); },
    /** @param {string} ev @param {Function} fn */
    on(ev, fn) {
      let set = serverHandlers.get(ev);
      if (!set) serverHandlers.set(ev, (set = new Set()));
      set.add(fn);
    },
  };

  return {
    client,
    server,
    open() {
      if (client.readyState !== 0) return;
      client.readyState = 1;
      server.readyState = 1;
      client.onopen?.();
    },
  };
}

/** @param {Map<string, Set<Function>>} map @param {string} ev @param {...any} args */
function emit(map, ev, ...args) {
  const set = map.get(ev);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(...args); } catch (err) { console.error('[p2p] socket listener failed', err); }
  }
}

/**
 * Browser end of a data channel, shaped like a WebSocket for public/js/net.js.
 * `close()` detaches this Net socket but leaves the channel up, so a hello retry can reuse it.
 * The channel's own close is reported as a socket close.
 * @param {{
 *   bind(ch: RTCDataChannel, consume: (data: unknown) => void): void,
 * }} bridge
 */
export function createChannelClient(bridge) {
  /** @type {RTCDataChannel | null} */
  let channel = null;
  const reasm = createReassembler((frame) => api.onmessage?.({ data: frame }));
  const api = {
    readyState: 0,
    get bufferedAmount() { return channel?.bufferedAmount || 0; },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    /** @param {string} data */
    send(data) {
      if (!channel || channel.readyState !== 'open' || api.readyState !== 1) return;
      framedSend((text) => channel.send(text), data);
    },
    /** @param {number} [code] @param {string} [reason] */
    close(code = 1000, reason = '') {
      if (api.readyState === 3) return;
      api.readyState = 3;
      api.onclose?.({ code, reason });
    },
    /** @param {RTCDataChannel} ch */
    attach(ch) {
      if (api.readyState === 3) return;
      channel = ch;
      try { ch.binaryType = 'arraybuffer'; } catch { /* already open */ }
      bridge.bind(ch, (data) => reasm(decodeData(data)));
      const onGone = () => {
        if (api.readyState === 3) return;
        api.readyState = 3;
        api.onclose?.({ code: 1006, reason: 'channel closed' });
      };
      if (typeof ch.addEventListener === 'function') ch.addEventListener('close', onGone);
      else ch.onclose = onGone;
      if (ch.readyState === 'closed' || ch.readyState === 'closing') { onGone(); return; }
      api.readyState = 1;
      api.onopen?.();
    },
  };
  return api;
}

/**
 * Host end of a guest's data channel, shaped like a ws socket for server/net.js.
 * Messages that arrive before `arm()` are queued (the guest can say hello as the channel opens).
 * @param {RTCDataChannel} channel
 */
export function createChannelServer(channel) {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();
  /** @type {string[]} */
  const queue = [];
  let armed = false;
  let closed = false;
  try { channel.binaryType = 'arraybuffer'; } catch { /* ignore */ }
  const reasm = createReassembler((frame) => {
    if (!armed) queue.push(frame);
    else emit(handlers, 'message', frame, false);
  });
  channel.onmessage = (ev) => reasm(decodeData(ev.data));
  const markClosed = () => {
    if (closed) return;
    closed = true;
    api.readyState = 3;
    emit(handlers, 'close');
  };
  if (typeof channel.addEventListener === 'function') channel.addEventListener('close', markClosed);
  else channel.onclose = markClosed;

  const api = {
    readyState: channel.readyState === 'open' ? 1 : 0,
    get bufferedAmount() { return channel.bufferedAmount || 0; },
    /** @param {string} data @param {Function} [cb] */
    send(data, cb) {
      try {
        if (channel.readyState !== 'open') return;
        framedSend((text) => channel.send(text), data);
        cb?.();
      } catch { /* channel went away */ }
    },
    close() { try { channel.close(); } catch { /* ignore */ } markClosed(); },
    terminate() { this.close(); },
    ping() { emit(handlers, 'pong'); },
    /** @param {string} ev @param {Function} fn */
    on(ev, fn) {
      let set = handlers.get(ev);
      if (!set) handlers.set(ev, (set = new Set()));
      set.add(fn);
    },
    /** Network is listening; deliver anything that raced ahead of the handshake. */
    arm() {
      if (armed || closed) return;
      armed = true;
      api.readyState = 1;
      for (const frame of queue) emit(handlers, 'message', frame, false);
      queue.length = 0;
    },
  };
  return api;
}

/**
 * A peer's seat on the local match, not tied to one RTC channel.
 * `push` is a client request. `send` is a server frame, handed to `transport.send`.
 * Frames that arrive before `arm()` wait until Network is listening.
 * @param {{ send: (data: string) => void }} transport
 */
export function createVirtualPeer(transport) {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();
  /** @type {string[]} */
  const queue = [];
  let armed = false;
  let closed = false;
  const markClosed = () => {
    if (closed) return;
    closed = true;
    api.readyState = 3;
    emit(handlers, 'close');
  };
  const api = {
    readyState: 1,
    bufferedAmount: 0,
    /** @param {string} data @param {Function} [cb] */
    send(data, cb) {
      try {
        if (closed) return;
        transport.send(String(data));
        cb?.();
      } catch { /* peer went away */ }
    },
    /** @param {number} [code] @param {string} [reason] */
    close(code = 1000, reason = '') { void code; void reason; markClosed(); },
    terminate() { this.close(); },
    ping() { emit(handlers, 'pong'); },
    /** @param {string} ev @param {Function} fn */
    on(ev, fn) {
      let set = handlers.get(ev);
      if (!set) handlers.set(ev, (set = new Set()));
      set.add(fn);
    },
    arm() {
      if (armed || closed) return;
      armed = true;
      for (const frame of queue) emit(handlers, 'message', frame, false);
      queue.length = 0;
    },
    /** @param {string} frame client JSON */
    push(frame) {
      if (closed) return;
      if (!armed) queue.push(String(frame));
      else emit(handlers, 'message', String(frame), false);
    },
    remoteClose() { markClosed(); },
  };
  return api;
}

/**
 * The local UI's socket when the match is running in another browser.
 * Stays CONNECTING until `markOpen()` so Net can assign handlers first.
 */
export function createRemoteClient() {
  const api = {
    readyState: 0,
    bufferedAmount: 0,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    /** @type {((data: string) => void) | null} */
    _send: null,
    /** @param {string} data */
    send(data) {
      if (api.readyState !== 1) return;
      api._send?.(String(data));
    },
    /** @param {number} [code] @param {string} [reason] */
    close(code = 1000, reason = '') {
      if (api.readyState === 3) return;
      api.readyState = 3;
      api.onclose?.({ code, reason });
    },
    markOpen() {
      if (api.readyState !== 0) return;
      api.readyState = 1;
      api.onopen?.();
    },
    /** @param {string} frame */
    deliver(frame) {
      if (api.readyState === 1) api.onmessage?.({ data: String(frame) });
    },
  };
  return api;
}
