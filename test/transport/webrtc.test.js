// test/transport/webrtc.test.js — WebRTC/PeerJS transport (PRD M1).
//
// PeerJS needs a signalling server and WebRTC, neither of which exists in `node --test`, so the
// Peer class is injected (the transport never imports peerjs statically — the browser loads the
// vendored UMD build and the transport reads globalThis.Peer). FakePeer is an in-memory stand-in
// for the PeerJS API surface the transport uses: open/connection/error/close, connect() with an
// immediate DataConnection object, ordered string send/close.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pickTransport, WebRTCTransport, PeerHost } from '../../shared/transport.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- FakePeer --------------------------------------------------------------------------------------

class FakeDataConnection {
  constructor(peer, local, remote) {
    this.peer = peer;            // the other side's id (PeerJS semantics)
    this.local = local;
    this.remote = remote;
    this.open = false;
    this.dead = false;
    this.handlers = new Map();
    this.meta = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, arg) {
    for (const fn of this.handlers.get(type) || []) fn(arg);
  }

  send(data) {
    if (!this.open || this.dead) return;
    const peer = FakePeer.registry.get(this.remote);
    const other = peer && peer.conns.get(this.local);
    Promise.resolve().then(() => { if (other && !other.dead) other.emit('data', data); });
  }

  close() {
    if (this.dead) return;
    const peer = FakePeer.registry.get(this.remote);
    const other = peer && peer.conns.get(this.local);
    this.dead = true;
    if (other) other.dead = true;
    Promise.resolve().then(() => {
      if (other && other.open) other.emit('close');
      if (this.open) this.emit('close');
      if (peer) peer.conns.delete(this.local);
      const me = FakePeer.registry.get(this.local);
      if (me) me.conns.delete(this.remote);
    });
  }
}

class FakePeer {
  static registry = new Map();
  static seq = 0;
  /** false = never emit 'open' (used by the connect-timeout test). */
  static opens = true;

  constructor(id, opts = {}) {
    this.id = id || `anon-${++FakePeer.seq}`;
    this.opts = opts;
    this.handlers = new Map();
    this.conns = new Map();
    this.destroyed = false;
    FakePeer.registry.set(this.id, this);
    if (FakePeer.opens) Promise.resolve().then(() => this.emit('open', this.id));
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, arg) {
    if (this.destroyed && type !== 'close') return;
    for (const fn of this.handlers.get(type) || []) fn(arg);
  }

  connect(remoteId, opts = {}) {
    const conn = new FakeDataConnection(remoteId, this.id, remoteId);
    conn.meta = opts.metadata;
    this.conns.set(remoteId, conn);
    Promise.resolve().then(() => {
      if (this.destroyed) return;
      const dst = FakePeer.registry.get(remoteId);
      if (!dst || dst.destroyed) {
        this.emit('error', { type: 'peer-unavailable', message: `Could not connect to peer ${remoteId}` });
        return;
      }
      const server = new FakeDataConnection(this.id, remoteId, this.id);
      dst.conns.set(this.id, server);
      dst.emit('connection', server);   // handlers are wired here, before either side opens
      server.open = true;
      conn.open = true;
      server.emit('open');
      conn.emit('open');
    });
    return conn;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    FakePeer.registry.delete(this.id);
    for (const conn of this.conns.values()) conn.close();
    this.conns.clear();
    this.emit('close');
  }
}

/** Fresh registry/world for every test. */
afterEach(() => {
  FakePeer.registry.clear();
  FakePeer.opens = true;
  delete globalThis.Peer;
});

// ---- helpers ---------------------------------------------------------------------------------------

/** A PeerJS host that speaks the minimal game protocol (welcome / pong / ok-echo). */
function startHost(peerId) {
  const seen = [];
  const host = new PeerHost({
    peerId,
    Peer: FakePeer,
    onConnection(ep) {
      ep.onmessage = (ev) => {
        seen.push(ev.data);
        const msg = JSON.parse(ev.data);
        if (msg.t === 'hello') ep.send(JSON.stringify({ t: 'welcome', rid: msg.rid, playerId: 'p_1', token: 't', name: msg.name, serverNow: 1 }));
        else if (msg.t === 'ping') ep.send(JSON.stringify({ t: 'pong', c: msg.c, s: msg.c }));
        else ep.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
      };
    },
  });
  return { host, seen, eps: [] };
}

function makeClient(url, opts = {}) {
  const events = [];
  const ws = new WebRTCTransport(url, { Peer: FakePeer, ...opts });
  ws.onopen = () => events.push(['open']);
  ws.onmessage = (ev) => events.push(['message', ev.data]);
  ws.onerror = (err) => events.push(['error', err && err.message]);
  ws.onclose = (ev) => events.push(['close', ev.code, ev.reason]);
  return { ws, events, kinds: () => events.map((e) => e[0]) };
}

// ---- tests -----------------------------------------------------------------------------------------

describe('transportWebRTC', () => {
  test('missing Peer constructor throws synchronously (net.js catches and backs off)', () => {
    assert.throws(() => new WebRTCTransport('p2p:nobody', {}), /PeerJS not loaded/);
    assert.throws(() => new PeerHost({ peerId: 'x', Peer: undefined, onConnection() {} }), /PeerJS not loaded/);
    assert.throws(() => new WebRTCTransport('p2p:', { Peer: FakePeer }), /missing host peer id/);
  });

  test('pickTransport hands p2p: URLs to WebRTCTransport', () => {
    assert.equal(pickTransport('p2p:abc'), WebRTCTransport);
    assert.equal(pickTransport('loopback:x').name, 'LoopbackTransport');
  });

  test('connects, completes the handshake and echoes through PeerHost', async () => {
    const { seen } = startHost('host-1');
    const { ws, kinds } = makeClient('p2p:host-1');
    assert.equal(ws.readyState, 0, 'CONNECTING right after construction');
    assert.deepEqual(kinds(), [], 'open is asynchronous');
    await tick();
    assert.equal(ws.readyState, 1);
    assert.deepEqual(kinds(), ['open']);
    ws.send(JSON.stringify({ t: 'hello', rid: 1, name: '\u51ef\u5c14\u5e0c', version: 1 }));
    ws.send(JSON.stringify({ t: 'ping', c: 123 }));
    await tick();
    assert.equal(seen.length, 2, 'host saw both frames, whole');
    const msgs = seen.map((s) => JSON.parse(s));
    assert.deepEqual(msgs.map((m) => m.t), ['hello', 'ping'], 'order preserved');
    assert.equal(msgs[0].name, '\u51ef\u5c14\u5e0c', 'unicode survives the wire');
    const { events } = makeClient('p2p:host-1');
    await tick();
    assert.ok(events.some((e) => e[0] === 'open'), 'a second client connects too');
    ws.close();
    await tick();
    assert.equal(ws.readyState, 3);
  });

  test('replies from the host reach the client in order', async () => {
    startHost('host-2');
    const { ws, events } = makeClient('p2p:host-2');
    await tick();
    ws.send(JSON.stringify({ t: 'ping', c: 1 }));
    ws.send(JSON.stringify({ t: 'ping', c: 2 }));
    await tick();
    const got = events.filter((e) => e[0] === 'message').map((e) => JSON.parse(e[1]));
    assert.deepEqual(got.map((m) => m.c), [1, 2]);
    assert.ok(got.every((m) => m.t === 'pong'), 'host answered each ping');
  });

  test('no such host → error then close(1006)', async () => {
    const { ws, kinds, events } = makeClient('p2p:ghost-host');
    await tick();
    assert.equal(ws.readyState, 3);
    assert.deepEqual(kinds(), ['error', 'close'], 'error before close');
    assert.equal(events[1][1], 1006, 'no wire codes over WebRTC: abnormal closure');
    assert.match(events[0][1], /peer-unavailable/, 'the PeerJS error surfaces');
  });

  test('connect timeout closes with 1006 when signalling never opens', async () => {
    FakePeer.opens = false;
    const { ws, kinds, events } = makeClient('p2p:host-slow', { connectTimeoutMs: 5 });
    await tick();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(ws.readyState, 3);
    assert.deepEqual(kinds(), ['error', 'close']);
    assert.match(events[0][1], /timeout/);
    assert.equal(events[1][1], 1006);
  });

  test('an oversized frame is chunked on the wire and reassembled whole', async () => {
    const { seen } = startHost('host-3');
    const { ws } = makeClient('p2p:host-3', { maxMessageSize: 512 });
    await tick();
    const big = JSON.stringify({ t: 'b.snap', pad: '\u4e2d'.repeat(400) });
    assert.ok(Buffer.byteLength(big, 'utf8') > 1000, 'actually oversized');
    ws.send(big);
    await tick();
    assert.deepEqual(seen, [big], 'host received one whole frame');
    assert.ok(seen[0].length === big.length, 'no slicing damage');
  });

  test('oversized replies are chunked too (host -> client)', async () => {
    const eps = [];
    const host = new PeerHost({
      peerId: 'host-4',
      Peer: FakePeer,
      maxMessageSize: 512,
      onConnection(ep) {
        eps.push(ep);
        ep.onmessage = () => ep.send(JSON.stringify({ t: 'b.snap', pad: '\u{1f389}'.repeat(300) }));
      },
    });
    const { ws, events } = makeClient('p2p:host-4', { maxMessageSize: 512 });
    await tick();
    ws.send('{"t":"ping","c":1}');
    await tick();
    const got = events.filter((e) => e[0] === 'message');
    assert.equal(got.length, 1, 'one whole reply');
    assert.equal(JSON.parse(got[0][1]).t, 'b.snap');
    assert.equal(eps.length, 1);
    host.destroy();
  });

  test('host closes the channel → client sees 1006; local close is clean 1000', async () => {
    const eps = [];
    new PeerHost({ peerId: 'host-5', Peer: FakePeer, onConnection: (ep) => eps.push(ep) });
    const { ws, kinds, events } = makeClient('p2p:host-5');
    await tick();
    assert.equal(eps.length, 1);
    eps[0].close(4001, 'replaced');
    await tick();
    assert.equal(ws.readyState, 3);
    assert.equal(events[events.length - 1][1], 1006, 'WebRTC drops carry no code');
    assert.ok(kinds().includes('close'));
  });

  test('client close() is clean, closes the peer and tells the host', async () => {
    const eps = [];
    new PeerHost({ peerId: 'host-6', Peer: FakePeer, onConnection: (ep) => {
      eps.push(ep);
      ep.onclose = (ev) => eps.push(['close', ev.code, ev.reason]);
    } });
    const { ws, events } = makeClient('p2p:host-6');
    await tick();
    ws.close(1000, 'bye');
    ws.close(1000, 'again');
    await tick();
    const closes = events.filter((e) => e[0] === 'close');
    assert.equal(closes.length, 1, 'onclose fires once');
    assert.equal(closes[0][1], 1000, 'local close is clean');
    assert.equal(events.filter((e) => e[0] === 'error').length, 0, 'no error on a clean close');
    const hostClose = eps.find((e) => Array.isArray(e));
    assert.ok(hostClose, 'host endpoint saw the drop');
    assert.equal(hostClose[1], 1006, 'the far side cannot see a close code');
    assert.equal(FakePeer.registry.size, 1, 'only the host peer is left');
    assert.ok(FakePeer.registry.has('host-6'), 'client peer destroyed its own id');
  });

  test('Net runs the full handshake over p2p: (net.js → pickTransport → PeerJS)', async () => {
    startHost('host-net');
    const { Net } = await import('../../public/js/net.js');
    globalThis.Peer = FakePeer;
    const net = new Net({ url: 'p2p:host-net' });
    try {
      net.connect();
      net.setName('\u51ef\u5c14\u5e0c');
      await tick();
      assert.equal(net.status, 'online', `status=${net.status} err=${net.lastError && net.lastError.code}`);
      assert.equal(net.playerId, 'p_1');
      const reply = await net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
      assert.equal(reply.t, 'ok');
    } finally {
      net.close();
      delete globalThis.Peer;
      await tick();
    }
  });
});
