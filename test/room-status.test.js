import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { createStatusLimiter } from '../server/roomStatus.js';

test('code lookup follows room/match lifecycle without joining or exposing private state', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.close())); await srv.close(); });
  const player = async (name) => {
    const client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(client);
    const welcome = await client.hello(name);
    return { client, welcome };
  };
  const { client: host, welcome } = await player('房主');
  await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const state = await host.waitFor('room.state');
  const endpoint = `/api/rooms/${state.code}/status`;
  let requestNo = 0;
  const query = async (path = endpoint, options = {}) => {
    const response = await fetch(`${srv.url}${path}`, { headers: { 'X-Real-IP': `198.51.100.${++requestNo}` }, ...options });
    return { response, body: response.status === 200 && options.method === 'HEAD' ? null : await response.json() };
  };
  const initialStats = { ...srv.lobby.stats(), sessions: srv.registry.size, sockets: srv.network.connectionCount };
  const { response, body } = await query(endpoint.toLowerCase());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(body.code, state.code);
  assert.equal(body.phase, 'LOBBY');
  assert.equal(body.joinable, true);
  assert.equal(body.occupied, 1);
  assert.equal(body.connectedHumans, 1);
  assert.equal(body.seats[0].isHost, true);
  assert.deepEqual(Object.keys(body.seats[0]).sort(), ['connected', 'isBot', 'isHost', 'name', 'ready', 'seat']);
  assert.ok(!JSON.stringify(body).includes(welcome.playerId));
  assert.ok(!JSON.stringify(body).includes(welcome.token));
  assert.deepEqual({ ...srv.lobby.stats(), sessions: srv.registry.size, sockets: srv.network.connectionCount }, initialStats);
  const { client: guest } = await player('队友');
  await guest.request({ t: 'room.join', code: state.code });
  assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
  await host.request({ t: 'room.addBot' });
  const populated = (await query()).body;
  assert.equal(populated.occupied, 3);
  assert.equal(populated.humans, 2);
  assert.equal(populated.bots, 1);
  assert.equal(populated.seats[1].ready, true);
  await host.request({ t: 'room.addBot' });
  const full = (await query()).body;
  assert.equal(full.occupied, full.capacity);
  assert.equal(full.joinable, false);

  assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
  await host.waitFor('m.public');
  const running = (await query()).body;
  assert.equal(running.inMatch, true);
  assert.equal(running.joinable, false);
  assert.equal(running.phase, 'INFO_CHECK');
  assert.ok(running.deadline > running.serverNow);
  assert.equal(running.seats[0].lp, 0);
  assert.ok(!JSON.stringify(running).includes('playerId'));
  assert.ok(!JSON.stringify(running).includes('loadout'));

  // Inject a broadcast with sensitive fields to exercise the projection, not a second serializer.
  const room = srv.lobby.getRoom(state.code);
  const msg = room.match.publicView();
  msg.phase = 'COMBAT'; msg.round = 7; msg.paused = true;
  msg.players[0].lp = 30; msg.players[0].pendingLp = 3;
  msg.players[0].secret = welcome.token; msg.secret = welcome.token;
  room.match.broadcastFn(msg);
  const combat = (await query()).body;
  assert.equal(combat.round, 7);
  assert.equal(combat.phase, 'COMBAT');
  assert.equal(combat.paused, true);
  assert.equal(combat.seats[0].pendingLp, 3);
  assert.equal(combat.seats[0].lp, 30);
  assert.ok(!JSON.stringify(combat).includes(welcome.token));

  const head = (await query(endpoint, { method: 'HEAD' })).response;
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const missingHead = await fetch(`${srv.url}/api/rooms/IOIO/status`, { method: 'HEAD' });
  assert.equal(missingHead.status, 404);
  assert.equal(await missingHead.text(), '');
  for (const path of ['/api/rooms', '/api/rooms/', '/api/rooms/AB/status', '/api/rooms/AAAAA/status', '/api/rooms/IOIO/status']) {
    const missing = await query(path);
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: 'ROOM_NOT_FOUND' });
  }
  const post = await query(endpoint, { method: 'POST' });
  assert.equal(post.response.status, 405);
  assert.equal(post.response.headers.get('allow'), 'GET, HEAD');

  await host.request({ t: 'g.infoReady' });
  await guest.request({ t: 'g.infoReady' });
  await host.waitFor('room.state', (s) => !s.inMatch);
  const ended = (await query()).body;
  assert.equal(ended.phase, 'LOBBY');
  assert.equal(ended.round, 0);
  assert.equal(ended.paused, false);
  assert.equal(ended.seats[0].lp, undefined);
  await guest.close();
  await host.waitFor('room.state', (s) => s.seats[1]?.connected === false);
  assert.equal((await query()).body.connectedHumans, 1);
  await host.request({ t: 'room.leave' });
  // Dispose the remaining disconnected room to check that an old shared code stops resolving.
  srv.lobby.disposeRoom(room, 'empty');
  assert.equal((await query()).response.status, 404);
});

test('status HTTP limit covers failed lookups and sends retry/no-cache headers', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  t.after(() => srv.close());
  // Concurrent requests make this independent of slow CI machines refilling the bucket between requests.
  const replies = await Promise.all(Array.from({ length: 30 }, () => fetch(`${srv.url}/api/rooms/`)));
  assert.ok(replies.some((r) => r.status === 404));
  assert.ok(replies.every((r) => r.status === 404 || r.status === 429));
  const limited = replies.find((r) => r.status === 429);
  assert.ok(limited, 'failed lookups are rate limited too');
  assert.equal(limited.headers.get('retry-after'), '1');
  assert.equal(limited.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await limited.json(), { error: 'RATE_LIMITED' });
  assert.equal(srv.registry.size, 0);
});

test('solo status reports one playable seat and never advertises vacant multiplayer slots', async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  t.after(() => srv.close());
  const host = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(() => host.close());
  await host.hello('独立模拟');
  await host.request({ t: 'room.create', mode: 'solo', difficulty: 'FUNNY' });
  const state = await host.waitFor('room.state');
  const endpoint = `${srv.url}/api/rooms/${state.code}/status`;
  const waiting = await (await fetch(endpoint)).json();
  assert.equal(waiting.capacity, 1);
  assert.equal(waiting.occupied, 1);
  assert.equal(waiting.seats.length, 1);
  assert.equal(waiting.joinable, false);
  assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
  const published = await host.waitFor('m.public');
  const running = await (await fetch(endpoint)).json();
  assert.equal(running.phase, 'INFO_CHECK');
  assert.equal(running.lastRound, 9);
  assert.equal(running.seats[0].lp, published.players[0].lp);
  assert.equal(running.deadline, 0, 'real solo match is untimed at INFO_CHECK');
  assert.equal(running.capacity, 1);
  assert.equal(running.joinable, false);
});

test('status limiter honours trusted proxies, groups IPv6, refills and bounds memory', () => {
  let now = 0;
  const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers });
  const limiter = createStatusLimiter({ now: () => now, maxKeys: 2 });
  for (let i = 0; i < 10; i++) assert.equal(limiter(req('127.0.0.1', { 'x-real-ip': '2001:db8:a:b::1' })), true);
  assert.equal(limiter(req('127.0.0.1', { 'x-real-ip': '2001:db8:a:b::2' })), false);
  now = 500;
  assert.equal(limiter(req('2001:db8:a:b::3', { 'x-real-ip': '198.51.100.1' })), true);
  assert.equal(limiter(req('2001:db8:a:b::4', { 'x-real-ip': '198.51.100.2' })), false, 'untrusted headers cannot bypass a limit');
  assert.equal(limiter(req('198.51.100.3')), true);
  assert.equal(limiter(req('198.51.100.4')), false, 'memory bounded');
  now = 61_000;
  assert.equal(limiter(req('198.51.100.4')), true, 'idle buckets expire');
  const untrusted = createStatusLimiter({ trustProxy: false, now: () => now });
  for (let i = 0; i < 10; i++) assert.equal(untrusted(req('127.0.0.1', { 'x-real-ip': `198.51.100.${i}` })), true);
  assert.equal(untrusted(req('127.0.0.1', { 'x-real-ip': '198.51.100.20' })), false, 'TRUST_PROXY=0 ignores even local forwarding headers');
});
