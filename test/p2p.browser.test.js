// Real local WebRTC + WebSocket integration. No game assets or external ICE service are needed.
// PowerShell: $env:SP_P2P_E2E='1'; node --test test/p2p.browser.test.js
/* global p2pTest */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const browserPath = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const skip = process.env.SP_P2P_E2E !== '1' ? 'set SP_P2P_E2E=1 to run real WebRTC integration'
  : !existsSync(browserPath) ? 'set CHROME_PATH to an installed Chromium browser' : false;

async function eventually(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(25);
  }
}

test('three real RTC clients receive signed public state with one WS copy and recover after channel loss', { skip, timeout: 90000 }, async (t) => {
  const { startServer } = await import('../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  t.after(() => srv.close());
  srv.lobby.peerRelay.enabled = true;
  srv.lobby.peerRelay.iceServers = [];
  const browser = await puppeteer.launch({
    executablePath: browserPath, headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-default-apps'],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  // This small same-origin page imports Net directly and never boots the game or downloads assets.
  await page.goto(`${srv.url}/healthz`);
  await page.setContent('<!doctype html><title>P2P transport integration</title>');
  await page.evaluate(async () => {
    const { Net } = await import('/js/net.js');
    const publicOf = (msg) => {
      if (msg?.t === 'm.public') return msg;
      if (msg?.t === 'p2p.frame' && typeof msg.payload === 'string') {
        try { return JSON.parse(msg.payload); } catch { return null; }
      }
      // The merged state-delta transport wraps the same view: a full frame carries it, a delta carries only patches.
      if (msg?.t === 'm.state' && msg.kind === 'm.public') return msg.full ?? null;
      return null;
    };
    globalThis.p2pTest = {
      clients: [], ws: [[], [], []], snapshots: [[], [], []], peerFrames: [[], [], []],
      // "Did this snapshot reach me over MY OWN authenticated WebSocket?" — whatever wrapper the lobby used.
      wsCarries(i, probe) {
        return this.ws[i].some((msg) => publicOf(msg)?.probe === probe
          || (msg?.t === 'm.state' && msg.kind === 'm.public' && JSON.stringify(msg).includes(`"${probe}"`)));
      },
    };
    for (let i = 0; i < 3; i++) {
      const net = new Net();
      p2pTest.clients.push(net);
      const onMessage = net._onMessage.bind(net);
      net._onMessage = (data) => {
        p2pTest.ws[i].push(JSON.parse(data));
        onMessage(data);
      };
      const receive = net.peers.receive.bind(net.peers);
      net.peers.receive = (frame, fromServer) => {
        if (!fromServer) p2pTest.peerFrames[i].push(frame);
        receive(frame, fromServer);
      };
      net.on('m.public', (msg) => p2pTest.snapshots[i].push(msg));
      net.on('room.state', (msg) => { net.roomCode = msg.code; });
      await new Promise((resolve, reject) => {
        net.on('welcome', resolve);
        net.on('helloError', reject);
        net.setName(`P2P ${i}`);
      });
    }
    await p2pTest.clients[0].request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
    const code = p2pTest.clients[0].roomCode;
    await p2pTest.clients[1].request('room.join', { code });
    await p2pTest.clients[2].request('room.join', { code });
  });
  await page.waitForFunction(() => p2pTest.clients.every((net) => net.peers.config?.peers.length === 3
    && net.peers.links.size === (net.playerId === net.peers.config.relayId ? 2 : 1)
    && [...net.peers.links.values()].every((link) => link.channel?.readyState === 'open')), { timeout: 15000 });
  const room = [...srv.lobby.rooms.values()][0];
  await eventually(() => srv.lobby.peerRelay.rooms.get(room)?.peers.every((peer) => peer.ready), 'all WebRTC readiness leases reach the server');
  const identities = await page.evaluate(() => p2pTest.clients.map((net) => ({ id: net.playerId, relay: net.peers.config.relayId })));
  const relayIndex = identities.findIndex(({ id, relay }) => id === relay);
  const receivers = identities.map((_, i) => i).filter((i) => i !== relayIndex);

  // Five broadcasts replace fifteen WS payload copies with five copies sent only to the relay.
  for (let i = 0; i < 5; i++) srv.lobby.broadcastRoom(room, { t: 'm.public', serverNow: Date.now(), probe: `fanout-${i}` });
  await page.waitForFunction(() => p2pTest.snapshots.every((messages) => messages.filter((msg) => msg.probe?.startsWith('fanout-')).length === 5));
  const copies = await page.evaluate(() => p2pTest.ws.map((messages) => messages.filter((msg) => msg.t === 'p2p.frame' && msg.payload.includes('fanout-')).length));
  assert.equal(copies[relayIndex], 5);
  assert.deepEqual(receivers.map((i) => copies[i]), [0, 0]);
  const received = await page.evaluate(() => p2pTest.snapshots.map((messages) => messages.filter((msg) => msg.probe?.startsWith('fanout-')).map((msg) => msg.probe)));
  for (const messages of received) assert.deepEqual(messages, ['fanout-0', 'fanout-1', 'fanout-2', 'fanout-3', 'fanout-4']);

  const resync = await page.evaluate(async (i) => {
    const net = p2pTest.clients[i];
    const generation = net.peers.generation;
    const epoch = net.peers.config.epoch;
    const links = [...net.peers.links.values()];
    const welcome = new Promise((resolve) => {
      const off = net.on('welcome', () => { off(); resolve(); });
    });
    net.setName('Resync');
    await welcome;
    return net.peers.generation === generation && net.peers.config?.epoch === epoch
      && links.every((link) => !link.closed && link.channel.readyState === 'open');
  }, relayIndex);
  assert.equal(resync, true, 'a repeated hello on the same session preserves healthy RTC links');

  const receiverIndex = receivers[0];
  // A malicious relay can send bytes, but cannot author or modify authoritative public snapshots.
  await page.evaluate(({ relayIndex, receiverIndex }) => {
    const relay = p2pTest.clients[relayIndex];
    const receiver = p2pTest.clients[receiverIndex];
    relay.peers.links.get(receiver.playerId).channel.send(JSON.stringify({
      t: 'p2p.frame', epoch: relay.peers.config.epoch, seq: 100000,
      payload: JSON.stringify({ t: 'm.public', serverNow: Date.now(), probe: 'forged' }),
      signature: btoa(String.fromCharCode(...new Uint8Array(64))),
    }));
  }, { relayIndex, receiverIndex });
  await page.waitForFunction((i) => p2pTest.peerFrames[i].some((frame) => frame.payload.includes('forged')), {}, receiverIndex);
  await page.evaluate((i) => p2pTest.clients[i].peers.incoming, receiverIndex);
  assert.equal(await page.evaluate((i) => p2pTest.snapshots[i].some((msg) => msg.probe === 'forged'), receiverIndex), false);

  await page.evaluate(({ relayIndex, receiverIndex }) => {
    const relay = p2pTest.clients[relayIndex];
    relay.peers.links.get(p2pTest.clients[receiverIndex].playerId).channel.close();
  }, { relayIndex, receiverIndex });
  const receiverId = identities[receiverIndex].id;
  await eventually(() => {
    const plan = srv.lobby.peerRelay.rooms.get(room);
    return plan?.peers.find((peer) => peer.session.playerId === receiverId)?.ready === false;
  }, 'closed data channel reports unready');
  srv.lobby.broadcastRoom(room, { t: 'm.public', serverNow: Date.now(), probe: 'fallback' });
  await page.waitForFunction(() => p2pTest.snapshots.every((messages) => messages.some((msg) => msg.probe === 'fallback')));
  const fallbackWs = await page.evaluate((i) => p2pTest.wsCarries(i, 'fallback'), receiverIndex);
  assert.equal(fallbackWs, true, 'the receiver keeps receiving state over its authenticated WebSocket');
  const fallbackPeer = await page.evaluate((i) => p2pTest.peerFrames[i].some((frame) => frame.payload.includes('fallback')), receiverIndex);
  assert.equal(fallbackPeer, false, 'and not over the channel that just closed');
  // The dangerous case: a relay whose data channel stays OPEN but stops forwarding. Receivers must not be
  // blackholed — and a receiver that still acknowledges a sequence it never received must not be believed —
  // so the lobby's watchdog re-sends the newest snapshot over each receiver's own WebSocket after ackMs (2.5 s).
  // The other receiver still holds a live channel, so it is the one we blackhole here. Let its acknowledgement
  // watermark catch up first: the watchdog arms against the watermark it sees at that moment, and a stale
  // "still moving" reading would let a silent relay look alive.
  const silentIndex = receivers[1];
  const silentId = identities[silentIndex].id;
  const silentPeer = () => srv.lobby.peerRelay.rooms.get(room)?.peers.find((p) => p.session.playerId === silentId);
  await page.waitForFunction(({ relayIndex, silentIndex }) => {
    const link = p2pTest.clients[relayIndex].peers.links.get(p2pTest.clients[silentIndex].playerId);
    return !!link?.channel && link.channel.readyState === 'open';
  }, { polling: 100 }, { relayIndex, silentIndex });
  await eventually(() => {
    const plan = srv.lobby.peerRelay.rooms.get(room);
    const peer = silentPeer();
    return !!plan && !!peer && peer.ack === plan.seq && peer.pending === null && !peer.timer;
  }, 'the receiver acknowledges the newest snapshot it holds and its previous watchdog has settled');
  const silentAt = Date.now();
  await page.evaluate(({ relayIndex, silentIndex }) => {
    const relay = p2pTest.clients[relayIndex];
    relay.peers.links.get(p2pTest.clients[silentIndex].playerId).channel.send = () => {};   // open, but silent
  }, { relayIndex, silentIndex });
  srv.lobby.broadcastRoom(room, { t: 'm.public', serverNow: Date.now(), probe: 'blackhole' });
  // The newest snapshot comes back over the receiver's own WebSocket even though its watermark kept moving, and the
  // frame is marked `fallback` so the client abandons the channel that stopped carrying data.
  await page.waitForFunction((i) => p2pTest.ws[i].some((msg) => msg.t === 'p2p.frame'
    && msg.fallback === true && msg.payload.includes('blackhole')), { timeout: 12000, polling: 100 }, silentIndex);
  const gap = Date.now() - silentAt;
  assert.ok(gap >= 2000 && gap < 6000, `the fallback landed inside the watchdog window (${gap} ms)`);
  const applied = await page.evaluate((i) => p2pTest.snapshots[i].some((msg) => msg.probe === 'blackhole'), silentIndex);
  assert.equal(applied, true, 'the receiver recovers sync from the authoritative WebSocket copy');
  const route = await page.evaluate((i) => ({
    links: p2pTest.clients[i].peers.links.size,
  }), silentIndex);
  assert.equal(route.links, 0, 'and abandons the silent route');

  assert.deepEqual(problems, []);
  await page.evaluate(() => p2pTest.clients.forEach((net) => net.close()));
});
