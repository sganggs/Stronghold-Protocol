// test/transport/loopback.test.js — in-process transport (PRD M1 方案 A 基底).
//
// The LoopbackTransport must behave like the WebSocket net.js already speaks: asynchronous open,
// whole text frames both ways, real close codes across the pair (4001 replacement test hook),
// idempotent close. Handlers run from microtasks, so one `tick()` drains a full round trip.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pickTransport, LoopbackHub, LoopbackTransport } from '../../shared/transport.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Minimal in-page host: records everything, optionally greets on open. */
function makeHost({ greet = null, throws = false } = {}) {
  const log = [];
  let ep = null;
  const host = {
    open(e) {
      if (throws) throw new Error('boom');
      ep = e;
      log.push('open');
      e.onmessage = (ev) => log.push(['frame', ev.data]);
      if (greet) e.send(greet);
    },
    close(e, code, reason) { log.push(['close', code, reason]); },
    get ep() { return ep; },
    log,
    frames: () => log.filter((x) => x[0] === 'frame').map((x) => x[1]),
    closes: () => log.filter((x) => x[0] === 'close'),
  };
  return host;
}

/** Wire a client transport and capture its callbacks in order. */
function makeClient(url, opts = {}) {
  const events = [];
  const ws = new LoopbackTransport(url, opts);
  ws.onopen = () => events.push(['open']);
  ws.onmessage = (ev) => events.push(['message', ev.data]);
  ws.onerror = (err) => events.push(['error', err && err.message]);
  ws.onclose = (ev) => events.push(['close', ev.code, ev.reason]);
  return { ws, events, kinds: () => events.map((e) => e[0]) };
}

describe('transport: pickTransport', () => {
  test('dispatches on the URL scheme', async () => {
    const { WebRTCTransport } = await import('../../shared/transportWebRTC.js');
    assert.equal(pickTransport('loopback:room1'), LoopbackTransport);
    assert.equal(pickTransport('p2p:some-peer-id'), WebRTCTransport);
    assert.equal(pickTransport('ws://host/ws'), globalThis.WebSocket);
    assert.equal(pickTransport('wss://host/ws'), globalThis.WebSocket);
    assert.equal(pickTransport('http://host/ws'), globalThis.WebSocket);
  });
});

describe('transportLoopback', () => {
  test('open is asynchronous; the greeting arrives after onopen', async () => {
    const hub = new LoopbackHub();
    const host = makeHost({ greet: 'hello-from-host' });
    hub.attach('a', host);
    const { ws, events, kinds } = makeClient('loopback:a', { hub });
    assert.equal(ws.readyState, 0, 'CONNECTING right after construction');
    assert.deepEqual(kinds(), [], 'open must not fire synchronously');
    await tick();
    assert.equal(ws.readyState, 1);
    assert.deepEqual(kinds(), ['open', 'message'], 'open first, queued greeting second');
    assert.equal(events[1][1], 'hello-from-host');
    assert.equal(host.log[0], 'open');
  });

  test('send throws while CONNECTING and discards after close', async () => {
    const hub = new LoopbackHub();
    hub.attach('b', makeHost());
    const { ws } = makeClient('loopback:b', { hub });
    assert.throws(() => ws.send('early'), /not open/, 'send before open throws');
    await tick();
    ws.send('after-open');
    ws.close();
    assert.equal(ws.readyState, 3);
    ws.send('after-close', 1000);
    await tick();
    const host = hub.get('b');
    assert.deepEqual(host.frames(), ['after-open'], 'queued frame arrived, post-close frame dropped');
    assert.equal(host.closes().length, 1, 'host told once');
  });

  test('both directions deliver whole frames in order', async () => {
    const hub = new LoopbackHub();
    const host = makeHost();
    hub.attach('c', host);
    const { ws, events } = makeClient('loopback:c', { hub });
    await tick();
    ws.send(JSON.stringify({ t: 'ping', c: 1 }));
    ws.send(JSON.stringify({ t: 'ping', c: 2 }));
    await tick();
    assert.deepEqual(host.frames(), ['{"t":"ping","c":1}', '{"t":"ping","c":2}']);
    host.ep.send('{"t":"pong","c":1}');
    host.ep.send('{"t":"pong","c":2}');
    await tick();
    const got = events.filter((e) => e[0] === 'message').map((e) => e[1]);
    assert.deepEqual(got, ['{"t":"pong","c":1}', '{"t":"pong","c":2}']);
  });

  test('no host at the key closes with 1006 and reports an error', async () => {
    const { ws, kinds, events } = makeClient('loopback:missing', { hub: new LoopbackHub() });
    await tick();
    assert.equal(ws.readyState, 3);
    assert.deepEqual(kinds(), ['error', 'close'], 'error before close');
    assert.equal(events[1][1], 1006, 'abnormal closure');
  });

  test('host close code propagates (4001 replacement hook)', async () => {
    const hub = new LoopbackHub();
    const host = makeHost();
    hub.attach('d', host);
    const { ws, kinds, events } = makeClient('loopback:d', { hub });
    await tick();
    host.ep.close(4001, 'session replaced');
    await tick();
    assert.deepEqual(kinds(), ['open', 'error', 'close']);
    const close = events[events.length - 1];
    assert.equal(close[1], 4001, 'net.js CLOSE_REPLACED survives the hop');
    assert.equal(close[2], 'session replaced');
    assert.equal(ws.readyState, 3);
    assert.equal(host.closes().length, 1, 'host told once');
  });

  test('clean close: no onerror, wasClean, idempotent', async () => {
    const hub = new LoopbackHub();
    const host = makeHost();
    hub.attach('e', host);
    const { ws, kinds } = makeClient('loopback:e', { hub });
    await tick();
    ws.close(1000, 'bye');
    ws.close(1000, 'bye again');
    await tick();
    assert.deepEqual(kinds(), ['open', 'close'], 'no error on a clean close');
    assert.equal(host.closes().length, 1, 'host told once');
  });

  test('close during CONNECTING completes without opening the host', async () => {
    const hub = new LoopbackHub();
    const host = makeHost();
    hub.attach('f', host);
    const { ws, kinds } = makeClient('loopback:f', { hub });
    ws.close();
    await tick();
    assert.deepEqual(kinds(), ['close'], 'never opened');
    assert.equal(host.log.length, 0, 'host never saw the client');
    assert.equal(ws.readyState, 3);
  });

  test('a throwing host.open closes the client with 1006', async () => {
    const hub = new LoopbackHub();
    hub.attach('g', makeHost({ throws: true }));
    const { ws, kinds } = makeClient('loopback:g', { hub });
    await tick();
    assert.deepEqual(kinds(), ['error', 'close']);
    assert.equal(ws.readyState, 3);
  });

  test('hub: duplicate attach throws, detach and clear remove the host', async () => {
    const hub = new LoopbackHub();
    const detach = hub.attach('h', makeHost());
    assert.throws(() => hub.attach('h', makeHost()), /already has a host/, 'one host per key');
    detach();
    const { kinds } = makeClient('loopback:h', { hub });
    await tick();
    assert.deepEqual(kinds(), ['error', 'close'], 'detached key answers like a missing host');
    hub.attach('j', makeHost());
    hub.clear();
    assert.equal(hub.get('i'), null);
    assert.throws(() => hub.attach('j', {}), /needs open/, 'open() is required');
  });

  test('maxMessageSize chunks an oversized frame and reassembles it whole', async () => {
    const hub = new LoopbackHub();
    const host = makeHost();
    hub.attach('j', host);
    const { ws } = makeClient('loopback:j', { hub, maxMessageSize: 256 });
    await tick();
    const big = JSON.stringify({ t: 'b.snap', pad: '\u4e2d'.repeat(400) });
    assert.ok(Buffer.byteLength(big, 'utf8') > 500, 'actually oversized');
    ws.send(big);
    await tick();
    assert.deepEqual(host.frames(), [big], 'client -> host reassembled into one frame');
  });

  test('a chunked reply reaches the client reassembled', async () => {
    const hub = new LoopbackHub();
    const host = makeHost();
    hub.attach('k', host);
    const { ws, events } = makeClient('loopback:k', { hub, maxMessageSize: 256 });
    await tick();
    const big = JSON.stringify({ t: 'b.snap', pad: '\u{1f389}'.repeat(200) });
    host.ep.send(big);
    ws.send(big); // sanity: the same path works client -> host
    await tick();
    const got = events.filter((e) => e[0] === 'message').map((e) => e[1]);
    assert.deepEqual(got, [big], 'client received one whole frame');
    assert.deepEqual(host.frames(), [big]);
  });

  test('unlimited by default: a multi-megabyte frame is one wire message', async () => {
    const hub = new LoopbackHub();
    const host = makeHost();
    hub.attach('l', host);
    const { ws, events } = makeClient('loopback:l', { hub });
    await tick();
    const huge = JSON.stringify({ t: 'b.snap', pad: 'x'.repeat(2_000_000) });
    ws.send(huge);
    await tick();
    assert.deepEqual(host.frames(), [huge]);
    host.ep.send(huge);
    await tick();
    assert.equal(events.filter((e) => e[0] === 'message')[0][1], huge);
  });
});
