// Real BroadcastChannel election followed by real client/server session handshakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { BroadcastChannel } from 'node:worker_threads';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { CLAIM_QUERY_MS, createIdentity, Net } from '../public/js/net.js';

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function nextEvent(net, type) {
  return new Promise((resolve, reject) => {
    const off = net.on(type, (value) => { clearTimeout(timer); off(); resolve(value); });
    const timer = setTimeout(() => { off(); reject(new Error(`Timed out waiting for ${type}`)); }, 2000);
  });
}

async function harness(t) {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const clients = [], channels = [], replaced = [];
  const local = storage();
  const channelName = `sp.identity.test.${process.pid}.${srv.port}`;
  t.after(async () => {
    clients.forEach((net) => net.close());
    channels.forEach((channel) => channel.close());
    await srv.close();
  });
  return {
    local, replaced,
    tab(tabId, session = storage(), setTimeout) {
      const channel = new BroadcastChannel(channelName);
      channels.push(channel);
      const id = createIdentity({ local, session, channel, tabId, setTimeout });
      return { id, session, channel };
    },
    async connect(name, tab) {
      const net = new Net({ url: `ws://127.0.0.1:${srv.port}/ws`, WebSocket, getToken: () => tab?.id.getToken() ?? null });
      clients.push(net);
      net.on('replaced', (error) => replaced.push({ name, code: error.code }));
      net.on('welcome', (welcome) => tab?.id.saveToken(welcome.token));
      const welcome = nextEvent(net, 'welcome');
      net.setName(name);
      return { net, welcome: await welcome };
    },
  };
}

async function closeClient(net) {
  const closed = once(net.ws, 'close');
  net.close();
  await closed;
}

async function assertOnline(h, clients) {
  // A round trip from each socket also lets a queued replacement close reach the client.
  const replies = await Promise.allSettled(clients.map(({ net }) => net.request('ping', { c: Date.now() })));
  assert.deepEqual(h.replaced, [], 'no client is replaced by another tab');
  for (const [index, client] of clients.entries()) {
    assert.equal(client.net.status, 'online');
    assert.equal(client.net.lastError, null);
    assert.equal(replies[index].status, 'fulfilled');
    assert.equal(replies[index].value.t, 'pong');
  }
}

for (const [firstId, secondId] of [['a-tab', 'b-tab'], ['b-tab', 'a-tab']]) {
  test(`staggered tabs ${firstId} then ${secondId} keep separate server sessions`, { timeout: 5000 }, async (t) => {
    const h = await harness(t);
    const seed = await h.connect('Seed');
    await closeClient(seed.net);
    h.local.setItem('sp.tokens', JSON.stringify([seed.welcome.token]));

    const deadlines = [];
    const holdDeadline = (fn, ms) => { assert.equal(ms, CLAIM_QUERY_MS); deadlines.push(fn); };
    const first = h.tab(firstId, storage(), holdDeadline);
    const firstInit = first.id.init();
    // The first who has already been sent when the second channel is created.
    const second = h.tab(secondId, storage(), holdDeadline);
    const delivered = new Promise((resolve) => {
      second.channel.addEventListener('message', (event) => {
        if (event.data.type === 'test.barrier') resolve();
      });
    });
    first.channel.addEventListener('message', (event) => {
      if (event.data.type === 'who') first.channel.postMessage({ type: 'test.barrier' });
    });
    const secondInit = second.id.init();
    // FIFO delivery puts this barrier after any real reply to the later who. Both default
    // 150 ms deadlines remain pending, without relying on sleeps or a fake channel hub.
    await delivered;
    assert.equal(deadlines.length, 2);
    deadlines[0]();
    await firstInit;
    deadlines[1]();
    await secondInit;

    const a = await h.connect('First', first);
    const b = await h.connect('Second', second);
    await assertOnline(h, [a, b]);
    assert.notEqual(a.welcome.token, b.welcome.token);
    assert.notEqual(a.welcome.playerId, b.welcome.playerId);
    const resumed = firstId < secondId ? a : b;
    assert.equal(resumed.welcome.token, seed.welcome.token);
    assert.equal(resumed.welcome.playerId, seed.welcome.playerId);
  });
}

test('live token ownership survives a duplicated tab, reload and reconnect', { timeout: 5000 }, async (t) => {
  const h = await harness(t);
  const owner = h.tab('z-owner');
  await owner.id.init();
  const a = await h.connect('Owner', owner);

  // A duplicated tab copies sessionStorage, but its smaller tab ID cannot evict a live owner.
  const duplicate = h.tab('a-duplicate', storage({ 'sp.token': a.welcome.token }));
  await duplicate.id.init();
  const b = await h.connect('Duplicate', duplicate);
  assert.notEqual(a.welcome.token, b.welcome.token);
  assert.notEqual(a.welcome.playerId, b.welcome.playerId);
  await assertOnline(h, [a, b]);

  await closeClient(a.net);
  owner.channel.close();
  const reloaded = h.tab('z-reloaded', owner.session);
  await reloaded.id.init();
  const a2 = await h.connect('Owner', reloaded);
  assert.equal(a2.welcome.token, a.welcome.token);
  assert.equal(a2.welcome.playerId, a.welcome.playerId);
  const reconnected = nextEvent(a2.net, 'welcome');
  a2.net.reconnectNow();
  const welcome = await reconnected;
  assert.equal(welcome.token, a.welcome.token);
  assert.equal(welcome.playerId, a.welcome.playerId);
  await assertOnline(h, [a2, b]);
});
