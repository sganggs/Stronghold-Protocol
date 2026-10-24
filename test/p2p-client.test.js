import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { PeerTransport } from '../public/js/p2p.js';
import { Net, DEAD_AFTER_MS } from '../public/js/net.js';

const encoder = new TextEncoder();
const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = await webcrypto.subtle.exportKey('jwk', keys.publicKey);

function fakeTimers() {
  let now = 1_000_000;
  let next = 0;
  const jobs = new Map();
  const add = (fn, ms, repeat = 0) => {
    const id = ++next;
    jobs.set(id, { fn, at: now + ms, repeat });
    return id;
  };
  return {
    jobs, now: () => now,
    setTimeout: (fn, ms) => add(fn, ms), clearTimeout: (id) => jobs.delete(id),
    setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: (id) => jobs.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const job = [...jobs].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!job) break;
        const [id, value] = job;
        now = value.at;
        if (value.repeat) value.at += value.repeat;
        else jobs.delete(id);
        value.fn();
      }
      now = end;
    },
  };
}

class FakeChannel {
  constructor() {
    this.label = 'public-state';
    this.readyState = 'connecting';
    this.bufferedAmount = 0;
    this.sent = [];
  }
  open() { this.readyState = 'open'; this.onopen?.(); }
  send(value) { this.sent.push(value); }
  close() { this.readyState = 'closed'; this.onclose?.(); }
  receive(frame) { this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) }); }
}

class FakeRTC {
  constructor(config) { this.config = config; this.connectionState = 'new'; this.closed = false; this.added = []; }
  createDataChannel() { this.channel = new FakeChannel(); return this.channel; }
  async createOffer() { return { type: 'offer', sdp: 'offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
  async setLocalDescription(value) { this.localDescription = value; }
  async setRemoteDescription(value) { this.remoteDescription = value; }
  async addIceCandidate(value) { this.added.push(value); }
  close() { this.closed = true; }
}

function config(overrides = {}) {
  return { t: 'p2p.config', enabled: true, epoch: 'epoch-1', relayId: 'relay', peers: ['relay', 'receiver'], publicKey, iceServers: [], ...overrides };
}

async function signed(seq, msg = { t: 'm.public', serverNow: seq * 100 }, epoch = 'epoch-1') {
  const payload = JSON.stringify(msg);
  const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey,
    encoder.encode(JSON.stringify([epoch, seq, payload])));
  return { t: 'p2p.frame', epoch, seq, payload, signature: Buffer.from(signature).toString('base64') };
}

function fixture(opts = {}) {
  const listeners = new Map();
  const net = {
    playerId: opts.playerId || 'receiver', timers: fakeTimers(), sent: [], snapshots: [],
    on(type, fn) { listeners.set(type, fn); },
    emit(type, value) { listeners.get(type)?.(value); },
    send(t, fields) { this.sent.push({ t, ...fields }); },
    acceptPeerSnapshot(msg) { this.snapshots.push(msg); },
  };
  const peer = new PeerTransport(net, { RTCPeerConnection: FakeRTC, crypto: webcrypto, ...opts });
  peer.configure(config(opts.config));
  return { net, peer, timers: net.timers };
}

function receiveChannel(peer) {
  const link = [...peer.links.values()][0];
  const channel = new FakeChannel();
  link.pc.ondatachannel({ channel });
  channel.open();
  return { link, channel };
}

test('peer snapshots require a genuine ECDSA signature over the epoch, sequence and bytes', async () => {
  const { net, peer } = fixture();
  const authentic = await signed(1);
  for (const frame of [
    { ...authentic, signature: undefined },
    { ...authentic, signature: 'not-base64!' },
    { ...authentic, signature: Buffer.alloc(64).toString('base64') },
    { ...authentic, payload: JSON.stringify({ t: 'm.public', serverNow: 100, injected: true }) },
    { ...authentic, seq: 2 },
    { ...authentic, epoch: 'epoch-other' },
  ]) {
    peer.receive(frame, false);
    await peer.incoming;
  }
  assert.equal(net.snapshots.length, 0);
  assert.equal(peer.seq, 0, 'rejected frames cannot advance the acknowledgement');
  peer.receive(authentic, false);
  await peer.incoming;
  assert.deepEqual(net.snapshots, [{ t: 'm.public', serverNow: 100 }]);
  peer.reset();
});

test('even signed peer payloads cannot inject private state, replies or commands', async () => {
  const { net, peer } = fixture();
  for (const msg of [
    { t: 'm.private', serverNow: 100 }, { t: 'ok', rid: 1, serverNow: 100 },
    { t: 'g.ready', serverNow: 100 }, { t: 'm.public', rid: 1, serverNow: 100 },
    { t: 'm.public' },
  ]) {
    peer.receive(await signed(1, msg), false);
    await peer.incoming;
  }
  assert.deepEqual(net.snapshots, []);
  peer.receive(await signed(2), false);
  await peer.incoming;
  assert.equal(net.snapshots.length, 1);
  peer.reset();
});

test('replays, old epochs and out-of-order snapshots never roll state back', async () => {
  const { net, peer } = fixture();
  const third = await signed(3);
  peer.receive(third, false);
  peer.receive(await signed(2), false);
  peer.receive(third, false);
  await peer.incoming;
  assert.deepEqual(net.snapshots.map((msg) => msg.serverNow), [300]);
  peer.configure(config({ epoch: 'epoch-2' }));
  peer.receive(await signed(4), false);
  peer.receive(await signed(1, { t: 'm.public', serverNow: 400 }, 'epoch-2'), false);
  await peer.incoming;
  assert.deepEqual(net.snapshots.map((msg) => msg.serverNow), [300, 400]);
  peer.reset();
});

test('the acknowledgement reports applied state, not merely received bytes', async () => {
  const { net, peer } = fixture();
  peer.receive(await signed(1, { t: 'm.public', serverNow: 200 }), false);
  await peer.incoming;
  assert.equal(peer.seq, 1, 'a snapshot that reached game state may be acknowledged');
  // A frame the state already supersedes is not applied, but the ACK still covers it: the state we hold is newer,
  // so "I am past this frame" is true — and the server does not treat it as proof either (it always re-sends).
  peer.receive(await signed(2, { t: 'm.public', serverNow: 100 }), false);
  await peer.incoming;
  assert.equal(net.snapshots.length, 1, 'the older snapshot is never applied');
  assert.equal(peer.seq, 2);
  // A payload that cannot be applied is not acknowledged at all: the lobby keeps it pending.
  peer.receive(await signed(3, { t: 'm.public' }), false);
  await peer.incoming;
  assert.equal(net.snapshots.length, 1);
  assert.equal(peer.seq, 2, 'no acknowledgement without an applied snapshot');
  peer.reset();
});

test('a newer direct WebSocket resync supersedes a peer frame still being verified', async () => {
  let release;
  let started;
  const verifying = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const crypto = { subtle: {
    importKey: (...args) => webcrypto.subtle.importKey(...args),
    async verify(...args) { started(); await blocked; return webcrypto.subtle.verify(...args); },
  } };
  const { net, peer } = fixture({ crypto });
  peer.receive(await signed(1), false);
  await verifying;
  peer.directSnapshot({ t: 'm.public', serverNow: 200 });
  release();
  await peer.incoming;
  assert.deepEqual(net.snapshots, []);
  peer.receive(await signed(2, { t: 'm.public', serverNow: 300 }), false);
  await peer.incoming;
  assert.equal(net.snapshots[0].serverNow, 300);
  peer.reset();
});

test('reset closes links, clears timers and invalidates in-flight crypto results', async () => {
  let release;
  let started;
  const verifying = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const { net, peer, timers } = fixture({ crypto: { subtle: {
    importKey: (...args) => webcrypto.subtle.importKey(...args),
    async verify(...args) { started(); await blocked; return webcrypto.subtle.verify(...args); },
  } } });
  const { link, channel } = receiveChannel(peer);
  peer.receive(await signed(1), false);
  await verifying;
  peer.reset();
  assert.equal(link.pc.closed, true);
  assert.equal(channel.readyState, 'closed');
  assert.equal(peer.links.size, 0);
  assert.equal(timers.jobs.size, 0);
  assert.equal(peer.config, null);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(net.snapshots.length, 0);
  assert.equal(peer.queued, 0);
});

test('offline, welcome and room.closed events discard the previous peer generation', () => {
  for (const event of ['status', 'welcome', 'room.closed']) {
    const { net, peer, timers } = fixture();
    const link = [...peer.links.values()][0];
    net.emit(event, { status: 'reconnecting' });
    assert.equal(peer.config, null, event);
    assert.equal(link.pc.closed, true, event);
    assert.equal(timers.jobs.size, 0, event);
    if (event === 'welcome') assert.deepEqual(net.sent.at(-1), { t: 'p2p.enable', enabled: true });
  }
});

test('verification queues and pending ICE candidates have fixed bounds', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let verifications = 0;
  const { net, peer } = fixture({ crypto: { subtle: {
    importKey: (...args) => webcrypto.subtle.importKey(...args),
    async verify(...args) { verifications++; await blocked; return webcrypto.subtle.verify(...args); },
  } } });
  const frames = await Promise.all(Array.from({ length: 30 }, (_, i) => signed(i + 1)));
  for (const frame of frames) peer.receive(frame, false);
  assert.equal(peer.queued, 16);
  const link = [...peer.links.values()][0];
  for (let i = 0; i < 150; i++) peer.signal({ epoch: 'epoch-1', from: 'relay', candidate: { candidate: String(i) } });
  await link.signals;
  assert.equal(link.candidates.length, 128);
  release();
  await peer.incoming;
  assert.equal(verifications, 16);
  assert.equal(net.snapshots.length, 16);
  assert.equal(peer.queued, 0);
  peer.reset();
});

test('the relay forwards authenticated WebSocket frames and rejects peer-origin traffic', async () => {
  const { net, peer } = fixture({ playerId: 'relay' });
  const link = [...peer.links.values()][0];
  const channel = link.channel;
  channel.open();
  const frame = await signed(1);
  channel.receive(frame);
  await peer.incoming;
  assert.equal(net.snapshots.length, 0);
  assert.equal(channel.sent.length, 0);
  peer.receive(frame, true);
  await peer.incoming;
  assert.deepEqual(JSON.parse(channel.sent[0]), frame);
  assert.equal(net.snapshots.length, 1);
  assert.equal(net.sent.findLast((msg) => msg.t === 'p2p.ready').ready, true);
  channel.bufferedAmount = 128 * 1024 + 1;
  peer.receive(await signed(2), true);
  await peer.incoming;
  assert.equal(peer.links.size, 0);
  assert.equal(channel.readyState, 'closed');
  assert.equal(net.sent.at(-1).ready, false);
  peer.reset();
});

test('invalid, binary and oversized channel frames close the link for WebSocket fallback', () => {
  for (const data of ['{broken', new Uint8Array([1]), 'a'.repeat(60 * 1024 + 1)]) {
    const { net, peer } = fixture();
    const { channel } = receiveChannel(peer);
    channel.onmessage({ data });
    assert.equal(peer.links.size, 0);
    assert.equal(channel.readyState, 'closed');
    assert.equal(net.sent.at(-1).ready, false);
    peer.reset();
  }
});

test('connection timeout and failed RTC negotiation report unready', async () => {
  const { net, peer, timers } = fixture();
  const link = [...peer.links.values()][0];
  timers.advance(12000);
  assert.equal(peer.links.size, 0);
  assert.equal(link.pc.closed, true);
  assert.equal(net.sent.at(-1).ready, false);
  peer.reset();
  class BrokenRTC extends FakeRTC { async createOffer() { throw new Error('RTC unavailable'); } }
  const failed = fixture({ playerId: 'relay', RTCPeerConnection: BrokenRTC });
  await [...failed.peer.links.values()][0].signals;
  assert.equal(failed.peer.links.size, 0);
  assert.equal(failed.net.sent.at(-1).ready, false);
  failed.peer.reset();
});

test('a WebSocket timeout fallback closes the peer link and accepts the authoritative snapshot', async () => {
  const { net, peer } = fixture();
  const { channel } = receiveChannel(peer);
  peer.receive({ ...await signed(1), fallback: true }, true);
  await peer.incoming;
  assert.equal(peer.links.size, 0);
  assert.equal(channel.readyState, 'closed');
  assert.equal(net.snapshots.length, 1);
  assert.equal(net.sent.at(-1).ready, false);
  peer.reset();
});

test('a duplicate authenticated fallback still closes the failed peer route', async () => {
  const { net, peer } = fixture();
  const { channel } = receiveChannel(peer);
  const frame = await signed(1);
  channel.receive(frame);
  await peer.incoming;
  peer.receive({ ...frame, fallback: true }, true);
  assert.equal(channel.readyState, 'closed');
  assert.equal(peer.links.size, 0);
  assert.equal(net.snapshots.length, 1, 'the fallback instruction does not emit a duplicate snapshot');
  peer.reset();
});

test('trusted WebSocket fallback bypasses a full queue of unverified peer work', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const { net, peer } = fixture({ crypto: { subtle: {
    importKey: (...args) => webcrypto.subtle.importKey(...args),
    async verify(...args) { await blocked; return webcrypto.subtle.verify(...args); },
  } } });
  const { channel } = receiveChannel(peer);
  const frames = await Promise.all(Array.from({ length: 20 }, (_, i) => signed(i + 1)));
  for (const frame of frames) peer.receive(frame, false);
  assert.equal(peer.queued, 16);
  peer.receive({ ...await signed(99), fallback: true }, true);
  assert.deepEqual(net.snapshots.map((msg) => msg.serverNow), [9900]);
  assert.equal(channel.readyState, 'closed');
  release();
  await peer.incoming;
  assert.equal(peer.queued, 0);
  assert.equal(net.snapshots.length, 1);
  peer.reset();
});

test('unavailable WebCrypto degrades safely to the authenticated WebSocket', async () => {
  for (const importKey of [() => { throw new Error('disabled'); }, () => Promise.reject(new Error('disabled'))]) {
    const { net, peer, timers } = fixture({ crypto: { subtle: { importKey } } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(peer.enabled, false);
    assert.equal(peer.config, null);
    assert.equal(peer.links.size, 0);
    assert.equal(timers.jobs.size, 0);
    assert.deepEqual(net.sent.at(-1), { t: 'p2p.enable', enabled: false });
  }
});

function onlineNet(p2p = {}, extra = {}) {
  const timers = fakeTimers();
  class FakeWS {
    constructor() { this.readyState = 0; this.sent = []; }
    send(value) { this.sent.push(JSON.parse(value)); }
    close(code) { this.readyState = 3; this.closeCode = code; }
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  const net = new Net({ url: 'ws://test/ws', WebSocket: FakeWS, timers, now: timers.now, ...extra,
    p2p: { RTCPeerConnection: FakeRTC, crypto: webcrypto, ...p2p } });
  net.setName('P2P test');
  const ws = net.ws;
  ws.readyState = 1;
  ws.onopen();
  ws.receive({ t: 'welcome', playerId: 'receiver', name: 'P2P test', serverNow: timers.now() });
  return { net, ws, timers };
}

test('unsupported RTC and explicit opt-out keep normal WebSocket snapshots', () => {
  for (const opts of [{ RTCPeerConnection: false }, { enabled: false }]) {
    const { net, ws } = onlineNet(opts);
    const snapshots = [];
    net.on('m.public', (msg) => snapshots.push(msg));
    assert.equal(ws.sent.some((msg) => msg.t === 'p2p.enable'), false);
    ws.receive(config());
    assert.equal(net.peers.config, null);
    ws.receive({ t: 'm.public', serverNow: 1_000_100 });
    assert.equal(snapshots.length, 1);
    net.close();
  }
});

test('a common delivery order suppresses stale WS and peer state even at identical timestamps', async () => {
  const { net, ws, timers } = onlineNet();
  ws.receive(config());
  const snapshots = [];
  net.on('m.public', (msg) => snapshots.push(msg.deliverySeq));
  const snapshot = (deliverySeq) => ({ t: 'm.public', serverNow: timers.now(), deliveryEpoch: 'room-1', deliverySeq });
  net.peers.receive(await signed(1, snapshot(2)), false);
  await net.peers.incoming;
  ws.receive(snapshot(1));
  ws.receive(snapshot(3));
  net.peers.receive(await signed(2, snapshot(2)), false);
  await net.peers.incoming;
  assert.deepEqual(snapshots, [2, 3]);
  ws.receive(config({ epoch: 'epoch-2' }));
  net.peers.receive(await signed(1, snapshot(2), 'epoch-2'), false);
  net.peers.receive(await signed(2, snapshot(4), 'epoch-2'), false);
  await net.peers.incoming;
  ws.receive(snapshot(4));
  assert.deepEqual(snapshots, [2, 3, 4], 'topology changes preserve the latest room delivery order');
  net.close();
  assert.equal(net.peers.deliveryEpoch, null);
  assert.equal(net.peers.deliverySeq, 0);
});

test('repeated hello and handshaking on the same WebSocket preserve healthy peer links', () => {
  const { net, ws } = onlineNet();
  ws.receive(config());
  const { link, channel } = receiveChannel(net.peers);
  const generation = net.peers.generation;
  net.peers.directSnapshot({ t: 'm.public', deliveryEpoch: 'room-1', deliverySeq: 5, serverNow: 1_000_000 });
  net.setName('Renamed');
  assert.equal(net.status, 'handshaking');
  assert.equal(link.pc.closed, false);
  ws.receive({ t: 'welcome', playerId: 'receiver', name: 'Renamed', serverNow: 1_000_100 });
  assert.equal(net.peers.generation, generation);
  assert.equal(net.peers.config.epoch, 'epoch-1');
  assert.equal(net.peers.deliverySeq, 5);
  assert.equal(channel.readyState, 'open');
  assert.equal(ws.sent.filter((msg) => msg.t === 'p2p.enable').length, 1);
  ws.receive({ t: 'welcome', playerId: 'different-player', name: 'Renamed', serverNow: 1_000_200 });
  assert.equal(link.pc.closed, true, 'a changed authenticated identity resets the old generation');
  assert.equal(net.peers.config, null);
  assert.equal(net.peers.deliverySeq, 0);
  net.close();
});

test('same-session handshaking keeps verified public snapshots flowing while new sockets await welcome', async () => {
  const { net, ws, timers } = onlineNet();
  ws.receive(config());
  const { channel } = receiveChannel(net.peers);
  const snapshots = [];
  net.on('m.public', (msg) => snapshots.push(msg.deliverySeq));
  const snapshot = (deliverySeq) => ({ t: 'm.public', serverNow: timers.now(), deliveryEpoch: 'room-1', deliverySeq });
  net.setName('Renamed');
  assert.equal(net.status, 'handshaking');
  channel.receive(await signed(1, snapshot(1)));
  await net.peers.incoming;
  assert.deepEqual(snapshots, [1], 'rename/resync cannot consume a snapshot without publishing it');
  net.reconnectNow();
  const next = net.ws;
  next.readyState = 1;
  next.onopen();
  assert.equal(net.status, 'handshaking');
  channel.receive(await signed(2, snapshot(2)));
  await net.peers.incoming;
  net.acceptPeerSnapshot(snapshot(2));
  assert.deepEqual(snapshots, [1], 'the new socket cannot publish prior-session peer state before welcome');
  next.receive({ t: 'welcome', playerId: 'receiver', name: 'Renamed', serverNow: timers.now() });
  next.receive(config({ epoch: 'epoch-new' }));
  const current = receiveChannel(net.peers).channel;
  current.receive(await signed(1, snapshot(2), 'epoch-new'));
  await net.peers.incoming;
  assert.deepEqual(snapshots, [1, 2]);
  net.close();
});

test('a revoked token discards stale welcome and peer state before reconnecting with the new claim', async () => {
  let token = 'owned-token';
  const { net, ws } = onlineNet({}, { getToken: () => token, getTokenClaim: () => ({ noReplace: true }) });
  ws.receive(config());
  const { link, channel } = receiveChannel(net.peers);
  net.peers.directSnapshot({ t: 'm.public', deliveryEpoch: 'old-room', deliverySeq: 5, serverNow: 1_000_000 });
  const welcomes = [];
  const statuses = [];
  net.on('welcome', (msg) => welcomes.push(msg));
  net.on('status', ({ status }) => statuses.push(status));
  net.setName('Recover');
  const action = net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
  assert.equal(ws.sent.findLast((msg) => msg.t === 'hello').token, 'owned-token');
  token = 'new-token';
  ws.receive({ t: 'welcome', playerId: 'receiver', name: 'Recover', token: 'owned-token', serverNow: 1_000_100 });
  assert.equal(welcomes.length, 0, 'the rejected welcome never reaches identity or P2P listeners');
  assert.equal(statuses.includes('online'), false);
  assert.equal(link.pc.closed, true);
  assert.equal(channel.readyState, 'closed');
  assert.equal(net.peers.config, null);
  assert.equal(net.peers.deliveryEpoch, null);
  assert.equal(ws.sent.some((msg) => msg.t === 'room.create'), false);
  const next = net.ws;
  assert.notEqual(next, ws);
  next.readyState = 1;
  next.onopen();
  const hello = next.sent.find((msg) => msg.t === 'hello');
  assert.equal(hello.token, 'new-token');
  assert.equal(hello.noReplace, true);
  next.receive({ t: 'welcome', rid: hello.rid, playerId: 'new-player', name: 'Recover', token: 'new-token', serverNow: 1_000_200 });
  assert.equal(welcomes.length, 1);
  assert.equal(net.peers.sessionWs, next);
  assert.equal(net.peers.sessionPlayerId, 'new-player');
  assert.equal(next.sent.filter((msg) => msg.t === 'p2p.enable').length, 1);
  const sent = next.sent.find((msg) => msg.t === 'room.create');
  assert.ok(sent, 'the queued action runs only after a welcome for the current token');
  next.receive({ t: 'ok', rid: sent.rid });
  await action;
  net.close();
});

test('a claimed same-player reconnect negotiates a fresh peer generation on the new socket', () => {
  const { net, ws } = onlineNet({}, {
    getToken: () => 'owned-token', getTokenClaim: () => ({ noReplace: false, claimAt: 100 }),
  });
  ws.receive(config());
  const { link } = receiveChannel(net.peers);
  net.peers.directSnapshot({ t: 'm.public', deliveryEpoch: 'room-1', deliverySeq: 5, serverNow: 1_000_000 });
  net.reconnectNow();
  assert.equal(link.pc.closed, true);
  assert.equal(net.peers.config, null);
  const next = net.ws;
  next.readyState = 1;
  next.onopen();
  const hello = next.sent.find((msg) => msg.t === 'hello');
  assert.equal(hello.token, 'owned-token');
  assert.equal(hello.claimAt, 100);
  assert.equal(hello.noReplace, undefined);
  next.receive({ t: 'welcome', rid: hello.rid, playerId: 'receiver', token: 'owned-token', serverNow: 1_000_100 });
  assert.equal(net.peers.sessionWs, next);
  assert.equal(next.sent.filter((msg) => msg.t === 'p2p.enable').length, 1);
  assert.equal(net.peers.deliveryEpoch, null, 'the new server session will rehydrate its room snapshot');
  next.receive(config({ epoch: 'epoch-new' }));
  assert.equal(net.peers.config.epoch, 'epoch-new');
  net.close();
});

test('verified peer traffic cannot answer a WebSocket heartbeat or pending request', async () => {
  const { net, ws, timers } = onlineNet();
  ws.receive(config());
  const { channel } = receiveChannel(net.peers);
  net.probe();
  const snapshots = [];
  net.on('m.public', (msg) => snapshots.push(msg));
  const request = net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }, { timeout: DEAD_AFTER_MS * 2 });
  const rejected = assert.rejects(request, { code: 'DISCONNECTED' });
  const rid = ws.sent.at(-1).rid;
  const lastRx = net._lastRx;
  const unansweredSince = net._unansweredSince;
  channel.receive(await signed(1, { t: 'm.public', serverNow: timers.now() + 100, rid }));
  await net.peers.incoming;
  channel.receive(await signed(2, { t: 'm.public', serverNow: timers.now() + 200 }));
  await net.peers.incoming;
  assert.equal(snapshots.length, 1);
  assert.equal(net.pendingCount, 1);
  assert.equal(net._lastRx, lastRx);
  assert.equal(net._unansweredSince, unansweredSince);
  timers.advance(DEAD_AFTER_MS + 1001);
  await rejected;
  assert.equal(ws.closeCode, 4000);
  assert.equal(net.status, 'reconnecting');
  net.close();
});
