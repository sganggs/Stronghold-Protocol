// WebSocket permessage-deflate (server/http/websocket.js WS_DEFLATE, host bandwidth layer 0). A browser-like client
// negotiates it with server context takeover and an 8 KB server window; a large JSON frame goes out compressed and the
// same frame again costs a fraction (the window is kept); a frame under the 1 KB threshold stays plain even though the
// context is kept, on its own RSV1 bit; a client that requires `server_no_context_takeover` gets no such saving, which
// is what makes the "context is kept" assertion meaningful; every connection has its own window.
// Frame sizes come from a raw client that parses the frames itself (test/helpers/wsRawClient.js): a socket byte counter
// merges frames that TCP coalesces, so it cannot answer "how big was that frame".
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { attachWebSocket, narrowDeflateOffer, WS_DEFLATE } from '../server/http/websocket.js';
import { startServer } from '../server/index.js';
import { rawClient } from './helpers/wsRawClient.js';

const BIG = JSON.stringify({ t: 'm.public', players: Array.from({ length: 200 }, (_, i) => ({ playerId: `p_${i % 4}`, name: '阿米娅', lp: 30, phase: 'PREP' })) });
const SMALL = JSON.stringify({ t: 'pong', at: 12345 });

/** A bare http server whose /ws hands the socket to the test (a stand-in for net.js Network). */
async function fakeServer() {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const peers = [];
  const network = { admission: () => null, handleConnection: (ws) => { peers.push(ws); } };
  const wss = attachWebSocket(server, { network, log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    get peer() { return peers[peers.length - 1]; },
    peers,
    close: () => new Promise((r) => { wss.close(); server.close(() => r()); }),
  };
}

/** Connect, send `messages` through the server socket, collect the frames and close (one frame per message). */
async function exchange(srv, messages, opts = {}) {
  const before = srv.peers.length;
  const client = await rawClient({ port: srv.port, ...opts });
  try {
    // the client's handshake answer can arrive before the server's 'connection' event: wait for this socket, not the
    // previous one (a second exchange would otherwise send into a closed socket)
    while (srv.peers.length <= before) await new Promise((r) => setTimeout(r, 5));
    const peer = srv.peers[before];
    for (const m of messages) peer.send(m);
    const frames = [];
    for (let i = 0; i < messages.length; i++) frames.push(await client.next());
    return { response: client.response, frames };
  } finally { client.close(); }
}

/** How much the second copy of a frame costs relative to the first: below 1 when the window is reused. */
const repeatRatio = (frames) => frames[1].bytes / frames[0].bytes;

describe('WebSocket permessage-deflate', () => {
  let srv;
  before(async () => { srv = await fakeServer(); });
  after(async () => { await srv.close(); });

  test('negotiated with server context takeover and an 8 KB server window; small frames stay plain', async () => {
    const { response, frames } = await exchange(srv, [SMALL, BIG]);
    assert.match(response, /sec-websocket-extensions: permessage-deflate/i);
    assert.doesNotMatch(response, /server_no_context_takeover/);
    assert.match(response, new RegExp(`server_max_window_bits=${WS_DEFLATE.serverMaxWindowBits}`));
    assert.equal(WS_DEFLATE.threshold, 1024);

    const [small, big] = frames;
    assert.equal(small.text, SMALL, 'a small payload arrives intact');
    assert.equal(small.rsv1, false, 'under 1 KB: no compressed bit, even with the context kept');
    assert.ok(small.bytes < 1024, `and it is not inflated: ${small.bytes} B`);
    assert.equal(big.text, BIG, 'a large payload arrives intact');
    assert.equal(big.rsv1, true, 'from 1 KB up: compressed');
    assert.ok(BIG.length > 10000);
    assert.ok(big.bytes < BIG.length / 4, `compressed on the wire: ${big.bytes} B for ${BIG.length} of payload`);
  });

  test('the 1 KB threshold is decided on UTF-8 bytes: 1,023 stays plain, 1,024 is compressed', async () => {
    const exact = (n) => {
      const head = '{"t":"pad","s":"';
      const tail = '"}';
      return head + 'x'.repeat(n - Buffer.byteLength(head) - Buffer.byteLength(tail)) + tail;
    };
    const under = exact(1023);
    const at = exact(1024);
    assert.equal(Buffer.byteLength(under, 'utf8'), 1023);
    assert.equal(Buffer.byteLength(at, 'utf8'), 1024);
    const { frames } = await exchange(srv, [under, at]);
    assert.equal(frames[0].text, under);
    assert.equal(frames[0].rsv1, false, '1,023 B: below the threshold, no compressed bit');
    assert.equal(frames[0].bytes, 1023 + 4, 'and sent as-is (2 + 2 bytes of header)');
    assert.equal(frames[1].text, at);
    assert.equal(frames[1].rsv1, true, '1,024 B: at the threshold, compressed');
  });

  test('the window is kept across frames: the same frame twice costs less the second time', async () => {
    const { frames } = await exchange(srv, [BIG, BIG]);
    assert.equal(frames[0].text, BIG);
    assert.equal(frames[1].text, BIG);
    // The stated comparison is against the same frame with the window reset (next test): there the repeat costs what
    // the first copy did, here it is a fraction. 0.75 is far from both sides of that gap.
    const r = repeatRatio(frames);
    assert.ok(r < 0.75, `the repeated frame reuses the window: ${frames[0].bytes} B then ${frames[1].bytes} B (ratio ${r.toFixed(2)})`);
  });

  test('a client that requires server_no_context_takeover gets no saving (the assertion above is not a tautology)', async () => {
    const kept = await exchange(srv, [BIG, BIG]);
    const reset = await exchange(srv, [BIG, BIG],
      { extensions: 'permessage-deflate; client_max_window_bits; server_no_context_takeover' });
    assert.match(reset.response, /server_no_context_takeover/);
    assert.equal(reset.frames[0].rsv1, true, 'large frames are still compressed, each on its own');
    const rReset = repeatRatio(reset.frames);
    assert.ok(rReset > 0.9, `no window to reuse: ${reset.frames[0].bytes} B then ${reset.frames[1].bytes} B (ratio ${rReset.toFixed(2)})`);
    assert.ok(repeatRatio(kept.frames) < rReset - 0.15, 'keeping the window is what the saving comes from');
  });

  test('a mixed stream keeps every small frame plain and every large one compressed', async () => {
    const messages = [];
    for (let i = 0; i < 10; i++) messages.push(SMALL, BIG);
    const { frames } = await exchange(srv, messages);
    frames.forEach((f, i) => {
      assert.equal(f.text, messages[i], `frame ${i} arrives intact`);
      assert.equal(f.rsv1, i % 2 === 1, `frame ${i} (${i % 2 ? 'large' : 'small'}) carries the expected RSV1`);
    });
  });

  test('each connection has its own window: a second client pays the first frame in full', async () => {
    const a = await exchange(srv, [BIG]);
    const b = await exchange(srv, [BIG]);
    assert.ok(b.frames[0].bytes > a.frames[0].bytes * 0.8,
      `no cross-connection savings: ${a.frames[0].bytes} B vs ${b.frames[0].bytes} B`);
  });

  test('a client without the extension gets the same messages uncompressed', async () => {
    const { response, frames } = await exchange(srv, [BIG, SMALL], { extensions: '' });
    assert.doesNotMatch(response, /sec-websocket-extensions/i);
    assert.deepEqual(frames.map((f) => f.text), [BIG, SMALL]);
    assert.equal(frames[0].rsv1, false);
    assert.ok(frames[0].bytes > BIG.length, `plain frame: ${frames[0].bytes} B for ${BIG.length}`);
  });

  test('an offer that caps the server window below ours connects uncompressed instead of a refused handshake', async () => {
    const { response, frames } = await exchange(srv, [BIG], { extensions: 'permessage-deflate; server_max_window_bits=9' });
    assert.doesNotMatch(response, /sec-websocket-extensions: permessage/i);
    assert.equal(frames[0].text, BIG);
    assert.equal(frames[0].rsv1, false);
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
