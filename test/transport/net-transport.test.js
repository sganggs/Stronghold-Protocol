// test/transport/net-transport.test.js — net.js on the pluggable transport (PRD M1 acceptance).
//
// Net drives a LoopbackTransport against an in-page host that speaks the real protocol, so the
// whole path — pickTransport → transport contract → handshake → requests → reconnection — runs
// without a server. Every frame the host receives must pass shared/protocol.js validateC2S.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loopbackHub } from '../../shared/transport.js';
import { validateC2S } from '../../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, 'public/js', rel)).href);
const tick = () => new Promise((r) => setTimeout(r, 0));

const attached = [];
afterEach(() => { while (attached.length) attached.pop()(); });

/** net.js re-emits 'status' on every pong (latency UI); collapse runs of one status. */
const transitions = (list) => list.filter((s, i) => i === 0 || s !== list[i - 1]);

// ---- helpers ---------------------------------------------------------------------------------------

/** Deterministic timers (same shape as test/client-static.test.js). */
function fakeTimers(start = 1_000_000) {
  let now = start;
  let seq = 0;
  const q = new Map();
  const add = (fn, ms, every) => { const id = ++seq; q.set(id, { at: now + Math.max(0, ms | 0), fn, every }); return id; };
  return {
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, 0),
    clearTimeout: (id) => q.delete(id),
    setInterval: (fn, ms) => add(fn, ms, Math.max(1, ms | 0)),
    clearInterval: (id) => q.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of q) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else q.delete(id);
        t.fn();
      }
      now = end;
    },
  };
}

/**
 * In-page host implementing the minimal game protocol over the loopback hub.
 * Records every received (already reassembled) frame; validates none of them itself — the
 * assertions do, so a protocol violation fails the test rather than the host.
 */
function attachHost(key, { onHello = null } = {}) {
  const received = [];
  const eps = [];
  const detach = loopbackHub.attach(key, {
    open(ep) {
      eps.push(ep);
      ep.onmessage = (ev) => {
        received.push(ev.data);
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'hello') {
          if (onHello) onHello(ep, msg);
          else ep.send(JSON.stringify({ t: 'welcome', rid: msg.rid, playerId: 'p_1', token: 'tok-9', name: msg.name, serverNow: 1_000_000 }));
        } else if (msg.t === 'ping') {
          ep.send(JSON.stringify({ t: 'pong', c: msg.c, s: msg.c }));
        } else if (msg.rid != null) {
          ep.send(JSON.stringify({ t: 'ok', rid: msg.rid }));
        }
      };
    },
    close(ep, code, reason) { eps.push(['close', code, reason]); },
  });
  attached.push(detach);
  return { received, eps, lastEp: () => eps.filter((e) => !Array.isArray(e)).pop() };
}

async function makeNet(key, extra = {}) {
  const { Net } = await mod('net.js');
  const timers = fakeTimers();
  const net = new Net({
    url: `loopback:${key}`,
    timers,
    now: timers.now,
    random: () => 0.5,
    getToken: () => 'tok-1',
    ...extra,
  });
  const statuses = [];
  const events = [];
  net.on('status', (s) => statuses.push(s.status));
  net.on('replaced', (e) => events.push(['replaced', e]));
  return { net, timers, statuses, events };
}

// ---- tests -----------------------------------------------------------------------------------------

describe('net over loopback transport', () => {
  test('full handshake: status flow, welcome, heartbeat, every frame validates', async () => {
    const host = attachHost('n1');
    const { net, statuses } = await makeNet('n1');
    net.connect();
    assert.equal(net.status, 'connecting');
    await tick();
    assert.equal(net.status, 'connected', 'open with no name yet');
    net.setName('\u51ef\u5c14\u5e0c');
    await tick();
    assert.equal(net.status, 'online');
    assert.equal(net.playerId, 'p_1');
    assert.equal(net.serverName, '\u51ef\u5c14\u5e0c');
    assert.ok(net.ping != null, 'pong measured latency');
    assert.deepEqual(transitions(statuses).slice(0, 4), ['connecting', 'connected', 'handshaking', 'online']);
    assert.ok(host.received.length >= 2, 'hello + ping went out');
    for (const frame of host.received) {
      const bad = validateC2S(JSON.parse(frame));
      assert.equal(bad, null, `invalid C2S frame ${frame}: ${bad}`);
    }
    net.close();
    assert.equal(net.status, 'closed');
    await tick();
    assert.equal(host.eps.filter((e) => Array.isArray(e)).length, 1, 'host told about the close');
  });

  test('request/response round trip resolves over the transport', async () => {
    attachHost('n2');
    const { net } = await makeNet('n2');
    net.connect();
    net.setName('A');
    await tick();
    const reply = await net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
    assert.equal(reply.t, 'ok');
    assert.equal(net.pendingCount, 0);
    net.close();
  });

  test('silent host → reconnecting, then back online after the backoff', async () => {
    const host = attachHost('n3');
    const { net, timers, statuses } = await makeNet('n3');
    net.connect();
    net.setName('A');
    await tick();
    assert.equal(net.status, 'online');
    assert.equal(host.eps.filter((e) => !Array.isArray(e)).length, 1);

    host.lastEp().close(1006, 'dropped');
    await tick();
    assert.equal(net.status, 'reconnecting');
    assert.ok(net.retryAt > timers.now(), 'a backoff is scheduled');

    timers.advance(600);
    await tick();
    assert.equal(net.status, 'online', `status=${net.status}`);
    assert.equal(host.eps.filter((e) => !Array.isArray(e)).length, 2, 'a fresh connection');
    assert.deepEqual(transitions(statuses).slice(-3), ['reconnecting', 'handshaking', 'online']);
    net.close();
  });

  test('close 4001 (session replaced) stops reconnection and reports REPLACED', async () => {
    const host = attachHost('n4');
    const { net, timers, events } = await makeNet('n4');
    net.connect();
    net.setName('A');
    await tick();
    assert.equal(net.status, 'online');

    host.lastEp().close(4001, 'session replaced');
    await tick();
    assert.equal(net.status, 'closed');
    assert.equal(net.lastError && net.lastError.code, 'REPLACED');
    assert.equal(events.length, 1, 'replaced event emitted');
    assert.equal(events[0][1].code, 'REPLACED');

    timers.advance(60_000);
    await tick();
    assert.equal(host.eps.filter((e) => !Array.isArray(e)).length, 1, 'never reconnects');
    assert.equal(net.status, 'closed');
  });

  test('a missing host answers like a down server (1006 → backoff, no throw)', async () => {
    const { net, timers } = await makeNet('n5');
    net.connect();
    net.setName('A');
    await tick();
    assert.equal(net.status, 'reconnecting', 'loopback with no host closes abnormally');
    assert.ok(net.retryAt > 0, 'reconnect scheduled');
    timers.advance(600);
    await tick();
    assert.equal(net.status, 'reconnecting', 'still retrying');
    net.close();
    assert.equal(net.status, 'closed');
    timers.advance(60_000);
    await tick();
    assert.equal(net.status, 'closed', 'manual close is final');
  });

  test('host not answering hello → backoff (hello timer path through the transport)', async () => {
    const host = attachHost('n6', { onHello: () => {} }); // receives hello, never welcomes
    const { net, timers } = await makeNet('n6');
    net.connect();
    net.setName('A');
    await tick();
    assert.equal(net.status, 'handshaking');
    timers.advance(8000); // HELLO_TIMEOUT_MS
    await tick();
    assert.equal(net.status, 'reconnecting');
    assert.ok(host.received.some((f) => JSON.parse(f).t === 'hello'), 'hello did arrive');
    net.close();
  });
});
