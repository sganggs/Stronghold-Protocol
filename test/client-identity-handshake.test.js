// Control delivery across two connections while using the real client and server hello handlers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, Net } from '../public/js/net.js';
import { Network, SessionRegistry } from '../server/net.js';
import { validateC2S } from '../shared/protocol.js';

function storage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function hub() {
  const members = new Set();
  return { create() {
    const channel = {
      listeners: [],
      postMessage(data) {
        for (const peer of members) if (peer !== channel) queueMicrotask(() => {
          if (members.has(peer)) for (const fn of peer.listeners) fn({ data: structuredClone(data) });
        });
      },
      addEventListener(type, fn) { if (type === 'message') this.listeners.push(fn); },
      close() { members.delete(channel); },
    };
    members.add(channel); return channel;
  } };
}
async function harness(t) {
  const local = storage(), ownerSession = storage(), guestSession = storage(), channels = hub();
  const registry = new SessionRegistry(), server = new Network({ registry, handler: { onMessage() {} } });
  const ownerSeat = registry.create('Owner'), guestSeat = registry.create('Guest'), clients = [];
  t.after(() => { for (const net of clients) net.close(); clearInterval(server.heartbeatTimer); clearInterval(server.sweepTimer); });
  const ownerChannel = channels.create();
  const owner = createIdentity({ local, session: ownerSession, channel: ownerChannel, tabId: 'z-owner', queryMs: 1, now: () => 100 });
  await owner.init(); owner.saveToken(ownerSeat.token); owner.rememberMatch({ name: 'Owner', code: 'ROOM1' });
  const guest = createIdentity({ local, session: guestSession, channel: channels.create(), tabId: 'a-guest', queryMs: 1, now: () => 200 });
  await guest.init(); guest.saveToken(guestSeat.token);
  const client = (identity) => {
    const sockets = [], welcomes = [], frames = [];
    class Socket {
      constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
      send(raw) { this.sent.push(JSON.parse(raw)); }
      // Client close need not reach the server before an already sent hello on this connection.
      close(code) { this.readyState = 3; this.onclose?.({ code }); }
      open() { this.readyState = 1; this.onopen?.(); }
    }
    const net = new Net({ WebSocket: Socket, getToken: () => identity.getToken(), getTokenClaim: () => identity.getTokenClaim() });
    clients.push(net);
    net.on('welcome', (m) => { welcomes.push(m); identity.saveToken(m.token); });
    net.setName('Owner');
    const ws = sockets[0]; ws.open();
    const conn = { session: null, ip: '?', key: null, ws: {
      readyState: 1, bufferedAmount: 0,
      send(raw) { frames.push(JSON.parse(raw)); ws.onmessage?.({ data: raw }); },
      close(code) { this.readyState = 3; ws.close(code); },
    } };
    return { net, ws, conn, welcomes, frames, sockets,
      hello: () => ws.sent.find((m) => m.t === 'hello'),
      deliver() {
        const msg = ws.sent.find((m) => m.t === 'hello');
        assert.equal(validateC2S(msg), null);
        server.onHelloMsg(conn, msg, Date.now());
      },
    };
  };
  return { local, ownerSession, guestSession, channels, ownerSeat, guestSeat, ownerChannel, owner, guest, client,
    async reload() {
      const id = createIdentity({ local, session: ownerSession, channel: channels.create(), tabId: 'zz-reloaded', queryMs: 1, now: () => 300 });
      assert.equal(await id.init(), ownerSeat.token); return id;
    },
  };
}

test('a recovery hello already in flight cannot displace the original window after its reload welcome', async (t) => {
  const h = await harness(t);
  h.ownerChannel.close();
  assert.equal(await h.guest.resume(h.guest.recoverable()[0].id), true);
  const pending = h.client(h.guest);
  assert.equal(pending.hello().noReplace, true);
  const owner = h.client(await h.reload()); owner.deliver();
  assert.equal(h.guest.getToken(), h.guestSeat.token);
  pending.deliver();
  assert.equal(pending.frames.at(-1).code, 'SESSION_IN_USE');
  assert.equal(owner.net.status, 'online'); assert.equal(owner.net.lastError, null);
  assert.equal(h.ownerSeat.ws, owner.conn.ws);
  assert.equal(pending.welcomes.length, 0);
  assert.equal(h.guestSession.getItem('sp.token'), h.guestSeat.token);
});

test('a later welcomed holder also yields; its buffered reconnect cannot override the earlier welcome', async (t) => {
  const h = await harness(t);
  h.ownerChannel.close();
  assert.equal(await h.guest.resume(h.guest.recoverable()[0].id), true);
  const recovered = h.client(h.guest); recovered.deliver();
  assert.equal(recovered.net.status, 'online');
  const delayedReconnect = h.client(h.guest);
  assert.equal(delayedReconnect.hello().claimAt, 200);
  assert.equal(delayedReconnect.hello().noReplace, undefined);
  const owner = h.client(await h.reload()); owner.deliver();
  assert.equal(h.guest.getToken(), null);
  assert.equal(h.guestSession.getItem('sp.token'), null);
  delayedReconnect.deliver();
  assert.equal(delayedReconnect.frames.at(-1).code, 'SESSION_IN_USE');
  assert.equal(owner.net.status, 'online'); assert.equal(owner.net.lastError, null);
  assert.equal(h.ownerSeat.ws, owner.conn.ws);
  assert.equal(h.ownerSeat.claimAt, 100);
});

test('shared recovery can bind an offline seat and a same-stamp reconnect can replace its own socket', async (t) => {
  const h = await harness(t);
  h.ownerChannel.close();
  assert.equal(await h.guest.resume(h.guest.recoverable()[0].id), true);
  const first = h.client(h.guest); first.deliver();
  assert.equal(first.welcomes[0].playerId, h.ownerSeat.playerId);
  const reconnect = h.client(h.guest); reconnect.deliver();
  assert.equal(reconnect.welcomes[0].playerId, h.ownerSeat.playerId);
  const again = h.client(h.guest); again.deliver();
  assert.equal(again.net.status, 'online');
  assert.equal(again.welcomes[0].playerId, h.ownerSeat.playerId);
  assert.equal(h.ownerSeat.claimAt, 200);
});

test('a stale welcome is discarded before online status, queued actions or welcome listeners', async (t) => {
  const h = await harness(t);
  h.ownerChannel.close();
  assert.equal(await h.guest.resume(h.guest.recoverable()[0].id), true);
  const pending = h.client(h.guest), published = [], statuses = [];
  pending.net.on('*', (m) => published.push(m));
  pending.net.on('status', (s) => statuses.push(s.status));
  const action = pending.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
  const rejected = assert.rejects(action, (e) => e.code === 'CLOSED');
  h.guest.rejectToken();
  pending.deliver();
  assert.equal(pending.welcomes.length, 0);
  assert.equal(published.length, 0);
  assert.ok(!statuses.includes('online'));
  assert.ok(!pending.ws.sent.some((m) => m.t === 'room.create'));
  assert.equal(pending.sockets.length, 2, 'retry uses a new connection, never a repeat hello on the old session');
  assert.equal(h.guestSession.getItem('sp.token'), h.guestSeat.token);
  pending.net.close(); await rejected;
});

test('hello ownership fields reject malformed inputs but remain optional', () => {
  const hello = { t: 'hello', name: 'Owner', token: 'seat' };
  for (const fields of [{}, { noReplace: true }, { noReplace: false, claimAt: 100 }]) assert.equal(validateC2S({ ...hello, ...fields }), null);
  for (const fields of [{ noReplace: 'yes' }, { claimAt: -1 }, { claimAt: Infinity }, { claimAt: '100' }]) assert.equal(typeof validateC2S({ ...hello, ...fields }), 'string');
});
