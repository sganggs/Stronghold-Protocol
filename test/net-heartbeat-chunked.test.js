// test/net-heartbeat-chunked.test.js — the heartbeat pass yields, and never overlaps itself.
//
// heartbeat() walks every connection on a 30 s interval. Done in one synchronous loop it holds the event loop for the
// whole sweep, so the pass now runs in chunks of 128 with a yield in between. The per-connection behaviour is
// unchanged (hello timeout, dead-socket terminate, ping), which is what these cases pin down.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Network } from '../server/net.js';

function fakeNet(count, { alive = true, session = {} } = {}) {
  const net = Object.create(Network.prototype);
  net.opts = { helloTimeoutMs: 1000 };
  net.log = { debug() {}, error() {}, info() {}, warn() {} };
  net.now = () => 10_000;
  net.closed = false;
  net.conns = new Map();
  for (let i = 0; i < count; i++) {
    const conn = {
      alive, closing: false, session, openedAt: 0, pings: 0, terminated: 0, closes: 0,
      ws: { ping() { conn.pings++; }, terminate() { conn.terminated++; } },
      close() { conn.closes++; },
    };
    net.conns.set('c' + i, conn);
  }
  return net;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a large pass pings every socket but yields instead of blocking', async () => {
  const net = fakeNet(300);
  net.heartbeat();
  const pingsAfterCall = [...net.conns.values()].reduce((n, c) => n + c.pings, 0);
  assert.ok(pingsAfterCall < 300, `the first chunk ran, the rest waits (${pingsAfterCall} of 300)`);
  assert.equal(pingsAfterCall, 128, 'the chunk is 128 connections');

  for (let i = 0; i < 10 && [...net.conns.values()].some((c) => c.pings === 0); i++) await settle();
  for (const c of net.conns.values()) {
    assert.equal(c.pings, 1, 'every connection is pinged exactly once');
    assert.equal(c.alive, false, 'and marked unanswered until the pong arrives');
  }
  assert.equal(net._heartbeatPending, false, 'the pass is finished');
});

test('a socket that did not answer is terminated, and a hello-less one is closed', async () => {
  const net = fakeNet(3, { alive: false });
  net.heartbeat();
  for (let i = 0; i < 5; i++) await settle();
  for (const c of net.conns.values()) assert.equal(c.terminated, 1, 'dead sockets are dropped');

  const hello = fakeNet(2, { session: null });
  hello.opts.helloTimeoutMs = 500;
  hello.heartbeat();
  for (let i = 0; i < 5; i++) await settle();
  for (const c of hello.conns.values()) {
    assert.equal(c.closes, 1, 'a connection that never said hello is closed');
    assert.equal(c.pings, 0, 'and is not pinged');
  }
});

test('a pass still yielding is not started a second time', async () => {
  const net = fakeNet(300);
  net.heartbeat();
  assert.equal(net._heartbeatPending, true);
  net.heartbeat();                                  // the next interval tick fires while the first pass is yielding
  for (let i = 0; i < 10; i++) await settle();
  for (const c of net.conns.values()) assert.equal(c.pings, 1, 'still exactly one ping, not two overlapping passes');
  assert.equal(net._heartbeatPending, false);
});

test('fewer connections than one chunk complete in the same tick, like the old loop', () => {
  const net = fakeNet(127);
  net.heartbeat();
  for (const c of net.conns.values()) assert.equal(c.pings, 1, 'all of them were pinged synchronously');
  assert.equal(net._heartbeatPending, true, 'nothing yielded, so the pass had already run when the caller resumed');
});

test('a closed server never starts a pass', () => {
  const net = fakeNet(10);
  net.closed = true;
  net.heartbeat();
  for (const c of net.conns.values()) assert.equal(c.pings, 0, 'a shut-down server pings nothing');
  assert.equal(net._heartbeatPending, undefined, 'and does not mark a pass pending');
});

test('a server that closes while the pass is yielding stops the rest of it', async () => {
  const net = fakeNet(300);
  net.heartbeat();
  net.closed = true;                                // shutdown lands after the first chunk, before the next one
  for (let i = 0; i < 10; i++) await settle();
  assert.equal([...net.conns.values()].filter((c) => c.pings === 1).length, 128, 'only the chunk that had already run');
  assert.equal(net._heartbeatPending, false, 'the pass ended rather than pinging the rest');
});

test('a connection removed or replaced while the pass yields is left to the next pass', async () => {
  const net = fakeNet(300);
  net.heartbeat();                                  // the first chunk is done, the pass is waiting on the yield

  const keys = [...net.conns.keys()];
  const removed = net.conns.get(keys[200]);
  net.conns.delete(keys[200]);
  const replaced = net.conns.get(keys[250]);
  const replacement = {
    alive: true, closing: false, session: {}, openedAt: 0, pings: 0, terminated: 0, closes: 0,
    ws: { ping() { replacement.pings++; }, terminate() { replacement.terminated++; } },
    close() { replacement.closes++; },
  };
  net.conns.set(keys[250], replacement);

  for (let i = 0; i < 10; i++) await settle();
  assert.equal(removed.pings, 0, 'a connection dropped mid-pass is not acted on after its owner let it go');
  assert.equal(replaced.pings, 0, 'the object that was replaced is not acted on either');
  assert.equal(replacement.pings, 0, 'the replacement waits for the next pass');
  assert.equal([...net.conns.values()].filter((c) => c.pings === 1).length, 298,
    'every other connection is still pinged exactly once');
});

test('each pass pings each connection once, however many passes run', async () => {
  const net = fakeNet(200);
  net.heartbeat();
  for (let i = 0; i < 10; i++) await settle();
  for (const c of net.conns.values()) c.alive = true;   // the pongs came back between the two ticks
  net.heartbeat();
  for (let i = 0; i < 10; i++) await settle();
  for (const c of net.conns.values()) assert.equal(c.pings, 2, 'one ping per pass, never two in one pass');
});
