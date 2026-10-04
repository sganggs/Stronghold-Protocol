// P2P signaling, frame splitting, and the in-process socket the host's UI uses to reach Lobby.
// A real WebRTC data channel needs two browsers (see the manual steps).

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';

import { startServer } from '../server/index.js';
import { Network, SessionRegistry } from '../server/net.js';
import { createLoopback } from '../public/js/p2p/socket.js';
import { createReassembler, framedSend } from '../public/js/p2p/frame.js';
import { createJournal } from '../public/js/p2p/journal.js';
import { SimpleP2PSync, shouldOffer } from '../public/js/p2p/sync.js';
import { parseCandidate, stunVerdict, peerVerdict, probeSignaling, iceServerList } from '../public/js/p2p/probe.js';
import { formatProbeReport } from '../public/js/ui/linkProbe.js';
import { createAssetSession, splitBlob, createAssembler } from '../public/js/p2p/assetWire.js';
import { sourceUrl } from '../tools/build-asset-index.mjs';
import { Lobby } from '../server/lobby.js';

function httpGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function openSignal(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/signal`);
    const inbox = [];
    const waiters = [];
    const pump = () => {
      for (let i = 0; i < inbox.length; i++) {
        const idx = waiters.findIndex((w) => w.pred(inbox[i]));
        if (idx < 0) continue;
        const [msg] = inbox.splice(i, 1);
        const w = waiters.splice(idx, 1)[0];
        w.resolve(msg);
        pump();
        return;
      }
    };
    ws.on('message', (buf) => { inbox.push(JSON.parse(buf.toString())); pump(); });
    ws.once('error', reject);
    ws.once('open', () => resolve({
      ws,
      inbox,
      send(obj) { ws.send(JSON.stringify(obj)); },
      wait(pred, ms = 2000) {
        const hit = inbox.findIndex(pred);
        if (hit >= 0) return Promise.resolve(inbox.splice(hit, 1)[0]);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error(`timeout, inbox=${JSON.stringify(inbox)}`)), ms);
          waiters.push({ pred, resolve: (m) => { clearTimeout(t); res(m); } });
        });
      },
    }));
  });
}

describe('asset transfer', () => {
  test('chunks reassemble, and a peer can hand a file to the requester', async () => {
    const payload = new Uint8Array(20000);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 255;
    const asm = createAssembler();
    let done = null;
    for (const part of splitBlob(7, payload, 1000)) {
      const got = asm(part);
      if (got) done = got;
    }
    assert.equal(done.id, 7);
    assert.deepEqual(done.bytes, payload);

    const store = new Map([['/assets/a.png', payload]]);
    /** @type {Map<string, ReturnType<typeof createAssetSession>>} */
    const sessions = new Map();
    function send(from, to, data) {
      const target = sessions.get(to);
      if (!target) return false;
      queueMicrotask(() => target.onData(from, data));
      return true;
    }
    sessions.set('a', createAssetSession({
      sendTo: (peerId, data) => send('a', peerId, data),
      loadLocal: async () => null,
    }));
    sessions.set('b', createAssetSession({
      sendTo: (peerId, data) => send('b', peerId, data),
      loadLocal: async (filePath) => store.get(filePath) || null,
    }));
    const got = await sessions.get('a').request('/assets/a.png', ['b']);
    assert.deepEqual(got, payload);
    const miss = await sessions.get('a').request('/assets/missing.png', ['b']);
    assert.equal(miss, null);
  });

  test('picture mirrors go to jsDelivr, voice stays on GitHub raw', () => {
    const png = sourceUrl('https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/avatar/char_1019_siege2.png');
    assert.equal(png, 'https://cdn.jsdelivr.net/gh/yuanyan3060/ArknightsGameResource@main/avatar/char_1019_siege2.png');
    const voice = sourceUrl('https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/dyn/audio/sound_beta_2/player/p_atk/p_atk_knifethrow_n.mp3');
    assert.match(voice, /^https:\/\/raw\.githubusercontent\.com\/ArknightsAssets\/ArknightsAssets2\/voice\//);
  });
});

describe('p2p helpers', () => {
  test('frames over the data-channel limit reassemble, small frames stay raw', () => {
    const small = [];
    framedSend((t) => small.push(t), '{"t":"ping"}');
    assert.deepEqual(small, ['{"t":"ping"}']);

    const parts = [];
    const payload = `{"t":"m.public","pad":"${'x'.repeat(20000)}"}`;
    framedSend((t) => parts.push(t), payload);
    assert.ok(parts.length > 1);
    let got = '';
    const push = createReassembler((frame) => { got = frame; });
    for (const part of parts) push(part);
    assert.equal(got, payload);
  });

  test('loopback socket speaks hello to the real session layer', async () => {
    const network = new Network({
      registry: new SessionRegistry(),
      handler: { onHello() {}, onMessage() { return { ok: true }; } },
      log: { info() {}, warn() {}, error() {}, debug() {} },
    });
    try {
      const pair = createLoopback();
      const got = [];
      pair.client.onmessage = (ev) => got.push(JSON.parse(ev.data));
      network.handleConnection(pair.server, { socket: { remoteAddress: '127.0.0.1' }, headers: {} });
      pair.open();
      pair.client.send(JSON.stringify({ t: 'hello', name: 'Doctor', rid: 1 }));
      await new Promise((r) => setImmediate(r));
      assert.equal(got[0]?.t, 'welcome');
      assert.equal(got[0].name, 'Doctor');
      assert.equal(got[0].rid, 1);
      assert.equal(typeof got[0].playerId, 'string');
    } finally {
      network.close();
    }
  });
});

describe('p2p request log', () => {
  test('smaller peer id offers, and a request is stored once', () => {
    assert.equal(shouldOffer('peer_a', 'peer_b'), true);
    assert.equal(shouldOffer('peer_b', 'peer_a'), false);

    const journal = createJournal({ now: () => 1000 });
    const hello = JSON.stringify({ t: 'hello', name: 'Doctor', rid: 1 });
    assert.equal(journal.addOp('peer_a', hello), true);
    assert.equal(journal.addOp('peer_a', hello), false);
    assert.equal(journal.addOp('peer_a', JSON.stringify({ t: 'ping', rid: 2 })), false);
    journal.noteFrame('peer_a', JSON.stringify({ t: 'welcome', playerId: 'p_1', token: 'tok', name: 'Doctor' }));
    journal.noteFrame('peer_a', JSON.stringify({ t: 'room.state', code: 'abcd', mode: 'coop' }));
    assert.equal(journal.roomCode, 'ABCD');
    assert.equal(journal.welcome('peer_a')?.token, 'tok');

    const other = createJournal({ now: () => 2000 });
    const fresh = other.merge(journal.wire());
    assert.equal(fresh.length, 1);
    assert.equal(other.merge(journal.wire()).length, 0);
    assert.equal(other.welcome('peer_a')?.playerId, 'p_1');
  });

  test('replaying saved requests rebuilds the same player and room code', async () => {
    const journal = createJournal({ now: () => 1_700_000_000_000 });
    const origin = new SessionRegistry();
    const session = origin.create('Doctor');
    journal.noteFrame('peer_a', JSON.stringify({
      t: 'welcome', playerId: session.playerId, token: session.token, name: 'Doctor',
    }));
    journal.addOp('peer_a', JSON.stringify({ t: 'hello', name: 'Doctor', rid: 1 }));
    journal.addOp('peer_a', JSON.stringify({ t: 'room.create', mode: 'coop', difficulty: 'FUNNY', rid: 2 }));
    journal.roomCode = 'ABCD';

    const registry = new SessionRegistry();
    const lobby = new Lobby({
      registry,
      codeFor: () => journal.roomCode,
      MatchClass: class {},
      getData: () => ({}),
      log: { info() {}, warn() {}, error() {}, debug() {} },
    });
    const network = new Network({
      registry,
      handler: lobby,
      log: { info() {}, warn() {}, error() {}, debug() {} },
    });
    try {
      for (const saved of journal.wire().welcomes) assert.ok(registry.importSession(saved));
      const pair = createLoopback();
      const got = [];
      pair.client.onmessage = (ev) => got.push(JSON.parse(ev.data));
      network.handleConnection(pair.server, { socket: { remoteAddress: '127.0.0.1' }, headers: {} });
      pair.open();
      for (const op of journal.ops()) {
        let text = op.d;
        const welcome = journal.welcome(op.from);
        if (welcome) {
          const msg = JSON.parse(text);
          if (msg.t === 'hello' && !msg.token) {
            msg.token = welcome.token;
            text = JSON.stringify(msg);
          }
        }
        pair.client.send(text);
        await new Promise((r) => setImmediate(r));
      }
      assert.equal(got.find((m) => m.t === 'welcome')?.playerId, session.playerId);
      assert.equal(got.find((m) => m.t === 'welcome')?.resumed, true);
      assert.equal(lobby.getRoom('ABCD')?.hostId, session.playerId);
    } finally {
      network.close();
      lobby.shutdown('leave');
    }
  });
});

describe('link probe', () => {
  test('three STUN servers are used together', () => {
    const urls = iceServerList().map((item) => item.urls);
    assert.deepEqual(urls, [
      'stun:stun.l.google.com:19302',
      'stun:stun.miwifi.com:3478',
      'stun:stun.chat.bilibili.com:3478',
    ]);
  });

  test('a public STUN address passes, and a host-only result names the missing stage', () => {
    const line = 'candidate:1 1 udp 1 203.0.113.8 54321 typ srflx raddr 192.168.1.5 rport 54321';
    assert.equal(parseCandidate(line).type, 'srflx');
    assert.equal(parseCandidate(line).address, '203.0.113.8:54321');
    assert.equal(stunVerdict([line], false).ok, true);
    const hostOnly = stunVerdict(['candidate:1 1 udp 1 192.168.1.5 9 typ host'], true);
    assert.equal(hostOnly.ok, false);
    assert.match(hostOnly.detail, /只有内网地址/);
    const none = stunVerdict([], true);
    assert.match(none.detail, /没有收集到任何地址/);
  });

  test('peer verdict distinguishes no partner, unfinished exchange, and a failed hole punch', () => {
    assert.match(peerVerdict({ sawPeer: false }).detail, /没有第二台浏览器/);
    assert.match(peerVerdict({ sawPeer: true, sentOffer: true, candidates: ['candidate:1 1 udp 1 192.168.0.2 9 typ host'] }).detail, /没有交换完/);
    const punched = peerVerdict({
      sawPeer: true, sentOffer: true, gotAnswer: true, connectionState: 'failed',
      candidates: ['candidate:1 1 udp 1 192.168.0.2 9 typ host'],
    });
    assert.equal(punched.ok, false);
    assert.match(punched.detail, /UDP 打洞失败/);
    assert.match(punched.detail, /内网/);
    const ok = peerVerdict({
      pong: true,
      pair: { localType: 'srflx', remoteType: 'srflx', rtt: 40 },
    });
    assert.equal(ok.ok, true);
    assert.match(ok.detail, /公网/);
    assert.match(ok.detail, /40ms/);
  });

  test('the copied report keeps each stage', () => {
    const text = formatProbeReport({
      room: 'ABCD',
      rows: [{ id: 'signal', label: '信令', state: 'ok', detail: '已收到 joined' }],
    });
    assert.match(text, /测试号 ABCD/);
    assert.match(text, /信令：通/);
  });

  test('signaling probe reports joined from a fake socket', async () => {
    class FakeWS {
      constructor() { queueMicrotask(() => this.onopen?.()); }
      send(raw) {
        const msg = JSON.parse(raw);
        if (msg.type === 'join') {
          queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'joined', room: msg.room, peers: [] }) }));
        }
      }
      close() {}
    }
    const result = await probeSignaling('ws://probe.invalid/signal', {
      room: 'ABCD', peerId: 'probe_test01', timeoutMs: 1000, WebSocket: FakeWS,
    });
    assert.equal(result.ok, true);
    assert.match(result.detail, /joined/);
  });
});

describe('relay fallback', () => {
  test('holds game envelopes until the direct channel is given up', () => {
    const sent = [];
    const sync = new SimpleP2PSync({ peerId: 'peer_b', signalingUrl: 'ws://unused', now: () => 5000 });
    sync.ws = { readyState: 1, send(raw) { sent.push(JSON.parse(raw)); } };
    sync.roomPeers.add('peer_a');
    try {
      assert.equal(sync.channelOpen('peer_a'), false);
      assert.equal(sync.sendTo('peer_a', { k: 'op', d: '1' }), true);
      assert.equal(sent.length, 0);
      let up = 0;
      sync.onUp = () => { up += 1; };
      sync._engageRelay('peer_a');
      assert.equal(up, 1);
      assert.equal(sync.channelOpen('peer_a'), true);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].type, 'relay');
      assert.equal(sent[0].to, 'peer_a');
      assert.equal(sent[0].data, '{"k":"op","d":"1"}');
      sync.sendTo('peer_a', { k: 'op', d: '2' });
      assert.equal(sent[1].data, '{"k":"op","d":"2"}');
    } finally {
      sync.leave();
    }
  });

  test('a relayed envelope is delivered to the game handler', () => {
    const sync = new SimpleP2PSync({ peerId: 'peer_b', signalingUrl: 'ws://unused', now: () => 5000 });
    /** @type {{ from: string, d: string } | null} */
    let got = null;
    sync.onGame = (from, d) => { got = { from, d }; };
    try {
      sync._onSignaling({ type: 'relay', from: 'peer_a', data: '{"k":"game","d":"ping"}' });
      assert.deepEqual(got, { from: 'peer_a', d: 'ping' });
      assert.equal(sync.roomPeers.has('peer_a'), true);
    } finally {
      sync.leave();
    }
  });
});

describe('p2p signaling on the game server', () => {
  let srv;
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true }); });
  after(async () => { await srv?.close(); });

  test('serves the host authority under /engine and still hides /server', async () => {
    const lobby = await httpGet(srv.port, '/engine/lobby.js');
    assert.equal(lobby.status, 200);
    assert.match(lobby.headers['content-type'], /javascript/);
    assert.match(lobby.body, /export class Lobby/);

    const hidden = await httpGet(srv.port, '/engine/index.js');
    assert.equal(hidden.status, 404);
    const nodeData = await httpGet(srv.port, '/engine/sim/nodeData.js');
    assert.equal(nodeData.status, 404);
    const serverEntry = await httpGet(srv.port, '/server/index.js');
    assert.ok([400, 403, 404].includes(serverEntry.status));

    const health = JSON.parse((await httpGet(srv.port, '/healthz')).body);
    assert.equal(health.signaling, true);
  });

  test('introduces two peers and forwards one offer', async () => {
    const a = await openSignal(srv.port);
    const b = await openSignal(srv.port);
    try {
      a.send({ type: 'join', room: 'ABCD', peerId: 'peer_a', role: 'host' });
      const joinedA = await a.wait((m) => m.type === 'joined');
      assert.equal(joinedA.room, 'ABCD');
      assert.deepEqual(joinedA.peers, []);

      b.send({ type: 'join', room: 'abcd', peerId: 'peer_b', role: 'guest' });
      const seen = await a.wait((m) => m.type === 'peer-joined' && m.peerId === 'peer_b');
      assert.equal(seen.role, 'guest');
      const joinedB = await b.wait((m) => m.type === 'joined');
      assert.deepEqual(joinedB.peers, [{ peerId: 'peer_a', role: 'host' }]);

      a.send({ type: 'signal', to: 'peer_b', data: { kind: 'offer', sdp: { type: 'offer', sdp: 'v=0' } } });
      const sig = await b.wait((m) => m.type === 'signal');
      assert.equal(sig.from, 'peer_a');
      assert.equal(sig.data.kind, 'offer');

      a.send({ type: 'relay', to: 'peer_b', data: '{"k":"op","d":"hi"}' });
      const relayed = await b.wait((m) => m.type === 'relay');
      assert.equal(relayed.from, 'peer_a');
      assert.equal(relayed.data, '{"k":"op","d":"hi"}');
      a.send({ type: 'relay', to: 'peer_b', data: 'x'.repeat(70000) });
      a.send({ type: 'relay', to: 'nobody', data: '{"k":"op"}' });
      a.send({ type: 'relay', to: 'peer_b', data: '{"k":"beat"}' });
      const next = await b.wait((m) => m.type === 'relay' && m.data === '{"k":"beat"}');
      assert.equal(next.from, 'peer_a');
      assert.equal(b.inbox.some((m) => m.type === 'relay' && String(m.data).length > 65536), false);

      const bad = await openSignal(srv.port);
      bad.send({ type: 'join', room: 'NO', peerId: 'x', role: 'guest' });
      const err = await bad.wait((m) => m.type === 'error');
      assert.equal(err.error, 'bad join');
      bad.ws.close();
    } finally {
      a.ws.close();
      b.ws.close();
    }
  });

  test('a peer leaving is announced, and /ws is unchanged', async () => {
    const a = await openSignal(srv.port);
    const b = await openSignal(srv.port);
    a.send({ type: 'join', room: 'WXYZ', peerId: 'peer_a', role: 'host' });
    await a.wait((m) => m.type === 'joined');
    b.send({ type: 'join', room: 'WXYZ', peerId: 'peer_b', role: 'guest' });
    await b.wait((m) => m.type === 'joined');
    b.send({ type: 'leave' });
    const left = await a.wait((m) => m.type === 'peer-left');
    assert.equal(left.peerId, 'peer_b');
    a.ws.close();
    b.ws.close();

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/nope`);
      ws.once('open', () => { ws.close(); reject(new Error('unexpected open')); });
      ws.once('error', () => resolve());
    });
    const game = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await new Promise((resolve, reject) => { game.once('open', resolve); game.once('error', reject); });
    game.close();
  });

  test('two peers exchange a game envelope once relay takes over', async () => {
    const a = new SimpleP2PSync({ peerId: 'peer_a', signalingUrl: `ws://127.0.0.1:${srv.port}/signal` });
    const b = new SimpleP2PSync({ peerId: 'peer_b', signalingUrl: `ws://127.0.0.1:${srv.port}/signal` });
    /** @type {(value: { from: string, d: string }) => void} */
    let resolveGot;
    const received = new Promise((resolve) => { resolveGot = resolve; });
    b.onGame = (from, d) => resolveGot({ from, d });
    try {
      await a.join('RELAY1');
      await b.join('RELAY1');
      await new Promise((r) => setTimeout(r, 80));
      a._engageRelay('peer_b');
      b._engageRelay('peer_a');
      assert.equal(a.sendGame('peer_b', 'hello'), true);
      const msg = await Promise.race([
        received,
        new Promise((_, reject) => setTimeout(() => reject(new Error('relay envelope was not delivered')), 2000)),
      ]);
      assert.deepEqual(msg, { from: 'peer_a', d: 'hello' });
    } finally {
      a.leave();
      b.leave();
      a.ws?.close();
      b.ws?.close();
    }
  });

  test('signaling probe receives joined from /signal', async () => {
    const result = await probeSignaling(`ws://127.0.0.1:${srv.port}/signal`, {
      room: 'PROBE1', peerId: 'probe_live01', timeoutMs: 4000, WebSocket,
    });
    assert.equal(result.ok, true);
    assert.match(result.detail, /joined/);
  });
});
