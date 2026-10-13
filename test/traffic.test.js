// The server's traffic counters (server/http/traffic.js, GET /healthz?traffic=1; host bandwidth layer 0): the body
// bytes every HTTP response wrote, by category, 304s apart, and the WebSocket's wire and payload bytes both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { startServer } from '../server/index.js';
import { createTrafficCounter } from '../server/http/traffic.js';
import { TestClient } from './helpers/wsClient.js';

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('HTTP: body bytes by category as written (compressed), 304s counted, /healthz reports them only when asked', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-traffic-'));
  const w = (rel, content) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), content); };
  const js = `// app\n${'export const x = 1;\n'.repeat(400)}`;
  const png = randomBytes(3000);
  const mp3 = randomBytes(5000);
  w('public/index.html', '<!doctype html><p>hi</p>');
  w('public/js/app.js', js);
  w('public/assets/img/a.png', png);
  w('public/assets/audio/bgm/a.mp3', mp3);
  w('data/config.json', JSON.stringify({ a: 1 }));
  w('shared/x.js', 'export const y = 2;');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(tmp, 'public'), dataDir: path.join(tmp, 'data'), sharedDir: path.join(tmp, 'shared') });
  try {
    const plain = await get(srv.port, '/health');
    assert.equal(plain.status, 404);
    const gz = await get(srv.port, '/js/app.js', { 'accept-encoding': 'gzip' });
    assert.ok(gz.body.length < js.length, 'compressed');
    await get(srv.port, '/js/app.js', { 'if-none-match': (await get(srv.port, '/js/app.js')).headers.etag });
    await get(srv.port, '/assets/img/a.png');
    await get(srv.port, '/media/bgm/a');
    await get(srv.port, '/data/config.json');
    const before = await get(srv.port, '/healthz');
    assert.equal(JSON.parse(before.body).traffic, undefined, 'plain /healthz stays as it was');
    const t = JSON.parse((await get(srv.port, '/healthz?traffic=1')).body).traffic;
    assert.equal(t.http.code.requests, 3);
    assert.equal(t.http.code.bytes, gz.body.length + js.length, 'what was written: the gzip body, the plain body, nothing for the 304');
    assert.equal(t.http.code.notModified, 1);
    assert.deepEqual(t.http.assets, { requests: 1, bytes: png.length, notModified: 0 });
    assert.deepEqual(t.http.audio, { requests: 1, bytes: mp3.length, notModified: 0 });
    assert.equal(t.http.data.requests, 1);
    assert.equal(t.http.other.requests, 2, 'the 404 page and the first /healthz');
    assert.ok(t.http.other.bytes > 0);
    assert.equal(t.http.total.requests, 8);
    assert.equal(typeof t.since, 'string');
    assert.equal(srv.traffic.snapshot().http.total.requests, 9, 'the traffic request itself once it has finished');
  } finally {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('WebSocket: wire bytes both ways (after permessage-deflate) and the payloads, live and after the close', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    await c.hello('流量计数');
    const live = srv.traffic.snapshot().ws;
    assert.equal(live.connections, 1);
    assert.equal(live.open, 1);
    assert.ok(live.messagesOut >= 1 && live.payloadOut > 0, JSON.stringify(live));
    assert.ok(live.messagesIn >= 1 && live.payloadIn > 0);
    assert.ok(live.wireOut > 0 && live.wireIn > 0);
    await c.close();
    for (let i = 0; i < 50 && srv.traffic.snapshot().ws.open; i++) await new Promise((r) => setTimeout(r, 20));
    const done = srv.traffic.snapshot().ws;
    assert.equal(done.open, 0);
    assert.ok(done.wireOut >= live.wireOut, 'the closed socket\'s bytes stay in the totals');
  } finally {
    await srv.close();
  }
});

test('the counter on its own: a string body in another encoding, an aborted response, the payload of a fragmented message', () => {
  const tc = createTrafficCounter({ now: () => 1000 });
  const listeners = {};
  const res = { statusCode: 200, write() { return true; }, end() {}, once(ev, fn) { listeners[ev] = fn; } };
  tc.meter(res, '/data/x.json');
  res.write('aGk=', 'base64');
  res.end('é');
  listeners.close();
  const s = tc.snapshot();
  assert.deepEqual(s.http.data, { requests: 1, bytes: 2 + 2, notModified: 0 });
  tc.wsSent('{"t":"pong"}');
  tc.wsReceived([Buffer.alloc(3), Buffer.alloc(4)]);
  const ws = tc.snapshot().ws;
  assert.equal(ws.payloadOut, 12);
  assert.equal(ws.payloadIn, 7);
  assert.equal(tc.snapshot().seconds, 0);
});

test('/healthz?traffic=1 answers the counters to a loopback / LAN client only (maintainer, 2026-10-12)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-traffic-lan-'));
  fs.mkdirSync(path.join(tmp, 'public'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'public/index.html'), '<!doctype html><p>hi</p>');
  const dirs = { publicDir: path.join(tmp, 'public'), dataDir: path.join(tmp, 'data'), sharedDir: path.join(tmp, 'shared') };
  const has = async (port, headers) => {
    const r = await get(port, '/healthz?traffic=1', headers);
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.ok, true, 'the plain report still answers');
    return 'traffic' in body;
  };
  const auto = await startServer({ port: 0, host: '127.0.0.1', quiet: true, ...dirs });
  try {
    assert.equal(await has(auto.port), true, 'the host itself (loopback)');
    assert.equal(await has(auto.port, { 'x-forwarded-for': '192.168.1.20' }), true, 'a LAN client behind a local proxy');
    assert.equal(await has(auto.port, { 'x-forwarded-for': '100.101.102.103' }), true, 'a virtual-LAN (CGNAT range) address');
    assert.equal(await has(auto.port, { 'x-forwarded-for': '203.0.113.9' }), false, 'a public visitor through a tunnel / proxy on this machine');
    assert.equal(await has(auto.port, { 'cf-connecting-ip': '2001:db8::7' }), false, 'a public IPv6 visitor through cloudflared');
  } finally {
    await auto.close();
  }
  const ignore = await startServer({ port: 0, host: '127.0.0.1', quiet: true, trustProxy: false, ...dirs });
  try {
    assert.equal(await has(ignore.port, { 'x-forwarded-for': '203.0.113.9' }), true, 'TRUST_PROXY=0: the loopback peer itself counts');
  } finally {
    await ignore.close();
  }
});
