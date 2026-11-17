// Real local WebRTC + WebSocket integration. No game assets or external ICE service are needed.
// PowerShell: $env:SP_P2P_E2E='1'; node --test test/p2p.browser.test.js
// POSIX:      SP_P2P_E2E=1 node --test test/p2p.browser.test.js
// The browser is auto-detected (Edge / Chrome / Chromium); override it with CHROME_PATH.
/* global p2pTest */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const CHROMIUM_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'msedge'];

function fromPath() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const found = [];
  for (const dir of dirs) {
    for (const name of CHROMIUM_NAMES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
}

// A desktop run finds a browser in the usual place; CI and Linux images usually only have one on PATH.
function browserCandidates() {
  const override = process.env.CHROME_PATH || process.env.EDGE_PATH;
  if (override) return [override];
  const sys = platform();
  // the per-user installs; a missing HOME only drops those candidates (the file still loads and skips cleanly)
  let home = null;
  try { home = homedir(); } catch { /* no HOME */ }
  const inHome = (rel) => (home ? [path.join(home, rel)] : []);
  if (sys === 'win32') {
    return [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ...inHome('AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'),
    ];
  }
  if (sys === 'darwin') {
    return [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ...inHome('Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      ...inHome('Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ...fromPath(),
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', ...fromPath()];
}

const homedirPrefix = (c) => { try { return c.startsWith(homedir()); } catch { return false; } };
const candidates = browserCandidates();
const browserPath = candidates.find((candidate) => existsSync(candidate));
const skip = process.env.SP_P2P_E2E !== '1' ? 'set SP_P2P_E2E=1 to run real WebRTC integration'
  // the per-user candidates stay out of the message (they would print the account's home folder)
  : !browserPath ? `no Chromium browser found; set CHROME_PATH (looked at: ${candidates.filter((c) => !homedirPrefix(c)).join(', ')} and the per-user installs)`
    : false;

// Three of these keep an ICE-server-free, host-candidate-only connection working outside a desktop:
// - Chrome replaces local IPs with unresolvable `.local` names unless mDNS hiding is off (no mDNS responder in
//   most Linux images / containers), which leaves ICE connecting forever;
// - loopback candidates are dropped unless explicitly allowed;
// - /dev/shm is tiny in containers and makes headless Chromium stall or crash.
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--allow-loopback-in-peer-connection',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
];

// The product drops a link 12 s after it is created if the data channel is still not open (openLink in
// public/js/p2p.js), and nothing rebuilds it until a fresh config arrives — so past ~15 s the wait can only
// end in this test's diagnostic dump. Failing there is both faster and closer to the real cause.
const LINK_OPEN_TIMEOUT = 15000;

async function eventually(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await delay(25);
  }
}

// "It timed out" is useless on its own: report what each link actually reached, so a machine that cannot do
// local WebRTC is distinguishable from a regression in the relay itself.
async function linkDiagnostics(page) {
  return page.evaluate(() => p2pTest.clients.map((net, i) => ({
    client: i,
    playerId: net.playerId ?? null,
    relayId: net.peers.config?.relayId ?? null,
    configured: net.peers.config?.peers.length ?? 0,
    links: [...net.peers.links.values()].map((link) => ({
      to: link.id,
      closed: !!link.closed,
      channel: link.channel?.readyState ?? null,
      connection: link.pc?.connectionState ?? null,
      ice: link.pc?.iceConnectionState ?? null,
      gathering: link.pc?.iceGatheringState ?? null,
    })),
  })));
}

test('three real RTC clients receive signed public state with one WS copy and recover after channel loss', { skip, timeout: 120000 }, async (t) => {
  const { startServer } = await import('../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  t.after(() => srv.close());
  srv.lobby.peerRelay.enabled = true;
  srv.lobby.peerRelay.iceServers = [];
  // Fail on a wedged browser instead of idling until the test timeout: a protocol error names the step.
  const browser = await puppeteer.launch({
    executablePath: browserPath, headless: true, args: LAUNCH_ARGS, timeout: 30000, protocolTimeout: 60000,
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
      // A missing `welcome` (dead socket, rejected hello) must reject, not hang inside page.evaluate.
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`client ${i}: no welcome within 15 s`)), 15000);
        const done = (fn) => (value) => { clearTimeout(timer); fn(value); };
        net.on('welcome', done(resolve));
        net.on('helloError', done((error) => reject(new Error(`client ${i}: ${error?.message ?? error}`))));
        net.setName(`P2P ${i}`);
      });
    }
    await p2pTest.clients[0].request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
    const code = p2pTest.clients[0].roomCode;
    await p2pTest.clients[1].request('room.join', { code });
    await p2pTest.clients[2].request('room.join', { code });
  });
  try {
    await page.waitForFunction(() => p2pTest.clients.every((net) => net.peers.config?.peers.length === 3
      && net.peers.links.size === (net.playerId === net.peers.config.relayId ? 2 : 1)
      && [...net.peers.links.values()].every((link) => link.channel?.readyState === 'open')), { timeout: LINK_OPEN_TIMEOUT, polling: 100 });
  } catch (error) {
    const state = await linkDiagnostics(page).catch(() => null);
    error.message = `${error.message}\nRTC links never opened: ${JSON.stringify(state)}\n`
      + `Browser launch flags: ${LAUNCH_ARGS.join(' ')}\n`
      + 'This machine may not allow local WebRTC (no usable host candidates, mDNS .local names unresolvable, UDP blocked) — compare the flags above with what this image needs.';
    throw error;
  }
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
