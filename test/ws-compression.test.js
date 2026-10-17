// WebSocket permessage-deflate (server/http/websocket.js WS_DEFLATE, host bandwidth layer 0): a browser-like client
// negotiates it with server context takeover and an 8 KB server window, a large JSON frame goes out compressed and a
// second one much smaller (the window is kept), a frame under the 1 KB threshold and a client without the extension get
// plain frames, and an offer that caps the server window below ours is answered without compression instead of a
// refused handshake.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attachWebSocket, narrowDeflateOffer, WS_DEFLATE } from '../server/http/websocket.js';
import { startServer } from '../server/index.js';

const BIG = JSON.stringify({ t: 'm.public', players: Array.from({ length: 200 }, (_, i) => ({ playerId: `p_${i % 4}`, name: '阿米娅', lp: 30, phase: 'PREP' })) });
const SMALL = JSON.stringify({ t: 'pong', at: 12345 });

/** A bare http server whose /ws sends BIG then SMALL to every socket (a stand-in for net.js Network). `twice` sends a
 *  second, identical BIG in between: with the deflate context kept, its compressed size collapses. */
async function fakeServer({ twice = false } = {}) {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const network = {
    admission: () => null,
    handleConnection: (ws) => { ws.send(BIG); if (twice) ws.send(BIG); ws.send(SMALL); },
  };
  const wss = attachWebSocket(server, { network, log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `ws://127.0.0.1:${server.address().port}/ws`, close: () => new Promise((r) => { wss.close(); server.close(() => r()); }) };
}

/** Connect, collect `count` messages, report the server's Sec-WebSocket-Extensions answer, the bytes the socket read
 *  and the bytes each message cost (the second frame's window for the context-takeover test). */
function receive(url, opts, count = 2) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts);
    const msgs = [];
    const marks = [];
    let negotiated = '';
    ws.on('upgrade', (res) => { negotiated = res.headers['sec-websocket-extensions'] || ''; });
    ws.on('error', reject);
    ws.on('message', (data) => {
      msgs.push(String(data));
      marks.push(ws._socket.bytesRead);
      if (msgs.length === count) {
        const read = ws._socket.bytesRead;
        ws.close();
        resolve({ msgs, read, marks, extensions: negotiated });
      }
    });
  });
}

describe('WebSocket permessage-deflate', () => {
  let srv;
  before(async () => { srv = await fakeServer(); });
  after(async () => { await srv.close(); });

  test('negotiated with server context takeover and an 8 KB server window; a large frame is compressed', async () => {
    const r = await receive(srv.url);
    assert.match(r.extensions, /permessage-deflate/);
    assert.doesNotMatch(r.extensions, /server_no_context_takeover/);
    assert.match(r.extensions, new RegExp(`server_max_window_bits=${WS_DEFLATE.serverMaxWindowBits}`));
    assert.deepEqual(r.msgs, [BIG, SMALL], 'the payloads arrive intact');
    assert.ok(BIG.length > 10000);
    assert.ok(r.read < BIG.length / 4, `compressed on the wire: ${r.read} bytes read for ${BIG.length} of payload`);
    assert.equal(WS_DEFLATE.threshold, 1024);
  });

  test('the deflate context is kept: the same frame twice costs a fraction the second time', async () => {
    const twice = await fakeServer({ twice: true });
    try {
      const r = await receive(twice.url, {}, 3);
      assert.deepEqual(r.msgs, [BIG, BIG, SMALL]);
      const first = r.marks[0];
      const second = r.marks[1] - r.marks[0];
      assert.ok(second < first / 3, `the repeated frame reuses the window: ${first} B then ${second} B`);
    } finally { await twice.close(); }
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
    assert.equal(narrowDeflateOffer('permessage-deflate; server_max_window_bits=12; client_max_window_bits'), true);
    assert.equal(narrowDeflateOffer(`permessage-deflate; server_max_window_bits=${WS_DEFLATE.serverMaxWindowBits}`), false);
    assert.equal(narrowDeflateOffer(`permessage-deflate; server_max_window_bits=${WS_DEFLATE.serverMaxWindowBits + 1}`), false);
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
