// WebSocket permessage-deflate (server/http/websocket.js WS_DEFLATE, host bandwidth layer 0): a browser-like client
// negotiates it with no server context takeover and a 2 KB server window, a large JSON frame goes out compressed, a
// frame under the 1 KB threshold and a client without the extension get plain frames, and an offer that caps the server
// window below ours is answered without compression instead of a refused handshake.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attachWebSocket, narrowDeflateOffer, WS_DEFLATE } from '../server/http/websocket.js';
import { startServer } from '../server/index.js';

const BIG = JSON.stringify({ t: 'm.public', players: Array.from({ length: 200 }, (_, i) => ({ playerId: `p_${i % 4}`, name: '阿米娅', lp: 30, phase: 'PREP' })) });
const SMALL = JSON.stringify({ t: 'pong', at: 12345 });

/** A bare http server whose /ws sends BIG then SMALL to every socket (a stand-in for net.js Network). */
async function fakeServer() {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const network = {
    admission: () => null,
    handleConnection: (ws) => { ws.send(BIG); ws.send(SMALL); },
  };
  const wss = attachWebSocket(server, { network, log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `ws://127.0.0.1:${server.address().port}/ws`, close: () => new Promise((r) => { wss.close(); server.close(() => r()); }) };
}

/** Connect, collect two messages, report the server's Sec-WebSocket-Extensions answer and the bytes the socket read. */
function receive(url, opts) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
    const msgs = [];
    let negotiated = '';
    ws.on('upgrade', (res) => { negotiated = res.headers['sec-websocket-extensions'] || ''; });
    ws.on('error', reject);
    ws.on('message', (data) => {
      msgs.push(String(data));
      if (msgs.length === 2) {
        const read = ws._socket.bytesRead;
        ws.close();
        resolve({ msgs, read, extensions: negotiated });
      }
    });
  });
}

describe('WebSocket permessage-deflate', () => {
  let srv;
  before(async () => { srv = await fakeServer(); });
  after(async () => { await srv.close(); });

  test('negotiated with no server context takeover and a small server window; a large frame is compressed', async () => {
    const r = await receive(srv.url);
    assert.match(r.extensions, /permessage-deflate/);
    assert.match(r.extensions, /server_no_context_takeover/);
    assert.match(r.extensions, new RegExp(`server_max_window_bits=${WS_DEFLATE.serverMaxWindowBits}`));
    assert.deepEqual(r.msgs, [BIG, SMALL], 'the payloads arrive intact');
    assert.ok(BIG.length > 10000);
    assert.ok(r.read < BIG.length / 4, `compressed on the wire: ${r.read} bytes read for ${BIG.length} of payload`);
    assert.equal(WS_DEFLATE.threshold, 1024);
  });

  test('a client without the extension gets the same messages uncompressed', async () => {
    const r = await receive(srv.url, { perMessageDeflate: false });
    assert.equal(r.extensions, '');
    assert.deepEqual(r.msgs, [BIG, SMALL]);
    assert.ok(r.read > BIG.length + SMALL.length, `plain frames: ${r.read}`);
  });

  test('an offer that caps the server window below ours connects uncompressed instead of a refused handshake', async () => {
    const r = await receive(srv.url, { perMessageDeflate: { serverMaxWindowBits: 9 } });
    assert.equal(r.extensions, '');
    assert.deepEqual(r.msgs, [BIG, SMALL]);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=9'), true);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=12; client_max_window_bits'), false);
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=9, permessage-deflate'), false, 'another offer is acceptable');
    assert.equal(narrowDeflateOffer('permessage-deflate; client_max_window_bits'), false);
    assert.equal(narrowDeflateOffer(undefined), false);
  });
});

test('the real server negotiates compression at /ws and keeps the 64 KB inflated frame limit', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    assert.match(ws.extensions, /permessage-deflate/);
    // a compressed client frame whose inflated size is over the limit closes the socket (1009), like a plain one
    const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ t: 'hello', name: 'x'.repeat(70 * 1024) }));
    assert.equal(await closed, 1009);
  } finally {
    await srv.close();
  }
});
