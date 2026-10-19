import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { connect as connectTcp } from 'node:net';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { startServer } from '../../server/index.js';
import { getData } from '../../server/data.js';
import { Net } from '../../public/js/net.js';
import { PROTOCOL_VERSION } from '../../shared/constants.js';
import { roomProcessCount, startRoomSupervisor } from '../../server/rooms/supervisor.js';
import { writePlugin, cosmetic, png } from '../helpers/pluginFixtures.js';
import { createPeer } from '../../server/rooms/peer.js';
import { scriptFixture } from '../helpers/scriptFixtures.js';
import { decide as exampleAIDecision } from '../../tools/ai/policy.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function botEnvironment(values, run) {
  const keys = new Set([...Object.keys(process.env).filter((key) => key === 'SP_BOT_STRATEGY' || key.startsWith('SP_EXTERNAL_AI_')), ...Object.keys(values)]);
  const previous = new Map([...keys].map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  for (const [key, value] of Object.entries(values)) if (value != null) process.env[key] = value;
  try { return await run(); }
  finally {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
async function until(fn, ms = 12000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { // loop-cap: deadline
    const value = fn(); if (value) return value;
    await pause(10);
  }
  throw new Error('condition timed out');
}
async function client(t, srv, slot = null, token = null, wsOptions = {}) {
  let saved = token;
  const rawFrames = [], sent = [];
  class Socket extends WebSocket {
    constructor(url) { super(url, wsOptions); this.on('message', (raw) => rawFrames.push(JSON.parse(raw))); }
    send(raw, ...args) { sent.push(JSON.parse(raw)); return super.send(raw, ...args); }
  }
  const net = new Net({ url: `ws://127.0.0.1:${srv.port}/ws`, WebSocket: Socket, getToken: () => saved });
  net.roomSlot = slot;
  const frames = [];
  net.on('*', (m) => { frames.push(m); if (m.t === 'welcome') saved = m.token; });
  net.name = 'Player'; net.connect();
  t.after(() => net.close());
  await until(() => net.status === 'online' && saved);
  return { net, frames, rawFrames, sent, token: () => saved };
}
async function createRoom(player) {
  await player.net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
  return until(() => player.frames.findLast((m) => m.t === 'room.state'));
}
function holdAdmission(t, peer) {
  const request = peer.request;
  let release, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  peer.request = async (method, ...args) => {
    const result = await request(method, ...args);
    if (method === 'admit') { entered(result); await wait; }
    return result;
  };
  t.after(() => { peer.request = request; release(); });
  return { ready, release };
}
function holdReply(t, child, method) {
  const send = child.send.bind(child);
  let requestId, resume, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const capture = (msg) => { if (msg?.channel === 'rooms' && msg.method === method) requestId = msg.id; };
  child.on('message', capture);
  child.send = (msg, ...args) => {
    if (requestId != null && msg?.channel === 'rooms' && msg.reply === requestId) {
      resume = (overrides) => send({ ...msg, ...overrides }, ...args); entered(); return true;
    }
    return send(msg, ...args);
  };
  const release = (overrides = null) => { child.send = send; child.off('message', capture); const reply = resume; resume = null; reply?.(overrides); };
  t.after(() => release());
  return { ready, release };
}
async function gatedServer(t, opts) {
  const argv = process.execArgv;
  process.execArgv = [...argv, '--import', new URL('../helpers/room-update-gate.mjs', import.meta.url).href];
  let srv;
  try { srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false, ...opts }); }
  finally { process.execArgv = argv; }
  t.after(() => srv.close());
  return srv;
}
async function holdPublication(t, child) {
  const toggle = (hold) => new Promise((resolve, reject) => {
    const ready = (msg) => {
      if (msg?.type === 'fixture.roomUpdates' && msg.action === 'ready' && msg.hold === hold) { child.off('message', ready); resolve(); }
    };
    child.on('message', ready);
    child.send({ type: 'fixture.roomUpdates', hold }, (error) => { if (error) { child.off('message', ready); reject(error); } });
  });
  const blocked = new Promise((resolve) => {
    const observe = (msg) => {
      if (msg?.type === 'fixture.roomUpdates' && msg.action === 'blocked') { child.off('message', observe); resolve(msg.value); }
    };
    child.on('message', observe);
    t.after(() => child.off('message', observe));
  });
  await toggle(true);
  let released = false;
  const release = async () => { if (!released && child.connected) { released = true; await toggle(false); } };
  t.after(release);
  return { blocked, release };
}

test('room-process configuration warns and falls back to one process for invalid counts', () => {
  assert.equal(roomProcessCount(1), 1);
  for (const value of ['', ' ', 0, -1, 1.5, 33, 'invalid']) {
    const warnings = [];
    assert.equal(roomProcessCount(value, (warning) => warnings.push(warning)), 1);
    assert.equal(warnings.length, 1);
  }
});

test('supervisor startup failures close their resources', async () => {
  await assert.rejects(startRoomSupervisor({ roomProcs: 2 }, async () => { throw new Error('failed bind'); }), /failed bind/);
  await assert.rejects(startRoomSupervisor({ roomProcs: 2, MatchClass: class {} }, () => {}), /serializable/);
});

test('room-process startup validates bot strategy and external configuration before creating children', async () => {
  for (const [values, expected] of [
    [{ SP_BOT_STRATEGY: 'missing-room-strategy' }, /Invalid SP_BOT_STRATEGY.*missing-room-strategy/],
    [{ SP_BOT_STRATEGY: 'external' }, /SP_EXTERNAL_AI_TRANSPORT/],
  ]) await botEnvironment(values, async () => {
    // A supervisor would reject this constructor before binding or spawning if it ran before validation.
    await assert.rejects(startServer({ roomProcs: 2, MatchClass: class {}, quiet: true }), expected);
  });
});

test('room children use the configured external HTTP strategy and keep it after replacement', { timeout: 60000 }, async (t) => {
  const observations = [];
  const endpoint = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1048576) req.destroy(); });
    req.on('error', () => {});
    req.on('end', () => {
      try {
        const observation = JSON.parse(body), reply = exampleAIDecision(observation);
        observations.push({ observation, reply, authorization: req.headers.authorization });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(reply));
      } catch { res.writeHead(400).end(); }
    });
  });
  await new Promise((resolve, reject) => { endpoint.once('error', reject); endpoint.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { endpoint.closeAllConnections(); await new Promise((resolve) => endpoint.close(resolve)); });
  await botEnvironment({
    SP_BOT_STRATEGY: 'external', SP_EXTERNAL_AI_TRANSPORT: 'http',
    SP_EXTERNAL_AI_URL: `http://127.0.0.1:${endpoint.address().port}`,
    SP_EXTERNAL_AI_TOKEN: 'room-process-fixture', SP_EXTERNAL_AI_SEATS: '1',
    SP_EXTERNAL_AI_TIMEOUT_MS: '2000', SP_EXTERNAL_AI_MAX_INTENTS: '7',
  }, async () => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
    t.after(() => srv.close());
    try {
      for (let generation = 0; generation < 2; generation++) {
        const before = observations.length;
        const player = await client(t, srv, 0);
        const welcome = player.frames.findLast((frame) => frame.t === 'welcome');
        const request = async (type, value = {}) => assert.equal((await player.net.request(type, value)).t, 'ok', type);
        await request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
        await request('room.addBot');
        await request('room.start');
        await until(() => player.frames.findLast((frame) => frame.t === 'm.public' && frame.phase === 'INFO_CHECK'));
        await request('g.infoReady');
        const draft = await until(() => player.frames.findLast((frame) => frame.t === 'm.public'
          && frame.phase === 'BAND_DRAFT' && frame.draft.turn === welcome.playerId));
        const taken = new Set(Object.values(draft.draft.picks));
        const bandId = ['band_bldsk', 'band_amiya', 'band_duyaoy', 'band_sarkazb'].find((id) => !taken.has(id));
        assert.ok(bandId);
        await request('g.band', { bandId });
        await until(() => player.frames.findLast((frame) => frame.t === 'm.public' && frame.phase === 'PREP'
          && frame.round === 1 && frame.players.some((seat) => seat.isBot && seat.ready)), 15000);
        const received = observations.slice(before);
        assert.ok(received.some(({ observation }) => observation.context.kind === 'band'));
        assert.ok(received.some(({ observation, reply }) => observation.context.kind === 'prep'
          && reply.intents.some((intent) => intent.t === 'g.ready')));
        assert.ok(received.some(({ observation }) => observation.context.remaining === 7), 'the child inherited the configured intent limit');
        for (const { observation, authorization } of received) {
          assert.equal(authorization, 'Bearer room-process-fixture');
          assert.notEqual(observation.private.playerId, welcome.playerId, 'the human seat did not use the AI endpoint');
        }
        player.net.close();
        if (generation === 0) {
          const previous = srv.roomSupervisor.slots[0];
          await srv.roomSupervisor.restart(0, { force: true });
          assert.notEqual(srv.roomSupervisor.slots[0], previous);
        }
      }
    } finally { await srv.close(); }
  });
});

test('create completion commits dirty directory state before releasing its reserved code', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const host = await client(t, srv, 0);
  const published = new Set(), completions = [];
  const child = srv.roomSupervisor.slots[0].child;
  const inspect = (msg) => {
    if (msg?.channel !== 'rooms') return;
    if (msg.method === 'update') for (const [code, value] of msg.value.rooms) if (value) published.add(code);
    if (msg.method === 'finish') {
      const changed = msg.value.update.rooms.find(([, value]) => value?.humans.includes(host.net.playerId));
      if (changed) completions.push({ code: changed[0], beforePublish: !published.has(changed[0]),
        reserved: srv.roomSupervisor.rooms.get(changed[0])?.reserved });
    }
  };
  child.on('message', inspect);
  t.after(() => child.off('message', inspect));
  const room = await createRoom(host);
  await until(() => completions.length);
  assert.deepEqual(completions[0], { code: room.code, beforePublish: true, reserved: false });
  const guest = await client(t, srv, 1);
  await guest.net.request('room.join', { code: room.code });
  assert.equal(guest.net.roomSlot, 0);
});

test('a failed local start releases global start admission through its completion event', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, maxMatchesPerAddr: 1, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const wsOptions = { headers: { 'X-Real-IP': '198.51.100.1' } };
  const a = await client(t, srv, 0, null, wsOptions), b = await client(t, srv, 1, null, wsOptions);
  const first = await createRoom(a); await createRoom(b);
  const guest = await client(t, srv, 0);
  await guest.net.request('room.join', { code: first.code });
  await assert.rejects(a.net.request('room.start'), (error) => error.code === 'NOT_READY');
  await b.net.request('room.start');
});

test('a failed admission-completion reply preserves the applied intent result before retiring its slot', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const host = await client(t, srv, 0);
  const slot = srv.roomSupervisor.slots[0], child = slot.child, send = child.send.bind(child);
  let completion, rid;
  const capture = (msg) => {
    if (msg?.channel === 'rooms' && msg.method === 'finish') completion = msg.id;
    if (msg?.channel === 'rooms' && msg.method === 'prepare') rid = msg.value.msg.rid;
  };
  child.on('message', capture);
  child.send = (msg, ...args) => send(msg?.channel === 'rooms' && msg.reply === completion ? { ...msg, error: 'forced completion failure' } : msg, ...args);
  t.after(() => { child.send = send; child.off('message', capture); });
  await host.net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
  assert.ok(host.frames.some((m) => m.t === 'room.state'));
  await until(() => slot.dead);
  assert.equal(host.frames.some((m) => m.t === 'error' && m.rid === rid && m.code === 'INTERNAL'), false);
});

test('cross-slot entry is acknowledged before routing and is applied without a client retry', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const host = await client(t, srv, 0), moving = await client(t, srv, 1);
  const destination = await createRoom(host);
  const before = moving.rawFrames.length;
  await moving.net.request('room.join', { code: destination.code });
  assert.equal(moving.net.roomSlot, 0);
  assert.equal(moving.net.status, 'online');
  await moving.net.request('room.ready', { ready: true });
  const request = moving.sent.find((m) => m.t === 'room.join');
  const frames = moving.rawFrames.slice(before);
  const acknowledged = frames.findIndex((m) => m.t === 'ok' && m.rid === request.rid);
  const welcomed = frames.findIndex((m) => m.t === 'welcome');
  assert.ok(acknowledged >= 0 && welcomed > acknowledged, JSON.stringify(frames));
  assert.equal(frames[acknowledged].routeSlot, 0);
  assert.equal(moving.sent.filter((m) => m.t === 'room.join').length, 1);
  assert.ok(moving.sent.some((m) => m.t === 'room.ready'));
  assert.equal(srv.roomSupervisor.rooms.get(destination.code).humans.length, 2);
});

function routeClient(t) {
  const sockets = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.({ code: 4000 }); }
    frame(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    welcome() {
      this.readyState = 1; this.onopen?.();
      this.frame({ t: 'welcome', playerId: 'p_test', token: 'token', rid: this.sent.findLast((m) => m.t === 'hello').rid });
    }
  }
  const net = new Net({ url: 'wss://example.invalid/ws', WebSocket: Socket });
  t.after(() => net.close());
  net.setName('Player'); sockets[0].welcome();
  return { net, sockets };
}

test('accepted transfer waits for destination welcome, queues later intents and ignores stale source frames', async (t) => {
  const { net, sockets } = routeClient(t);
  let completed = false;
  const accepted = net.request('room.join', { code: 'TEST' }).then((value) => { completed = true; return value; });
  const request = sockets[0].sent.find((m) => m.t === 'room.join'), old = sockets[0], stale = old.onmessage;
  old.frame({ t: 'ok', rid: request.rid, routeSlot: 1 });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(net.status, 'connecting');
  const next = net.request('room.ready', { ready: true });
  assert.equal(old.sent.some((m) => m.t === 'room.ready'), false);
  stale({ data: JSON.stringify({ t: 'room.route', slot: 2 }) });
  net._onMessage(JSON.stringify({ t: 'ok', rid: request.rid, routeSlot: 2 }), old);
  sockets[1].frame({ t: 'ok', rid: request.rid, routeSlot: 3 });
  assert.equal(sockets.length, 2);
  assert.equal(net.roomSlot, 1);
  sockets[1].welcome();
  assert.equal((await accepted).rid, request.rid);
  assert.equal(net.status, 'online');
  assert.equal(sockets[1].sent.some((m) => m.t === 'room.join'), false);
  const ready = sockets[1].sent.find((m) => m.t === 'room.ready');
  assert.ok(ready);
  sockets[1].frame({ t: 'ok', rid: ready.rid }); await next;
  assert.equal(net.pendingCount, 0);
});

for (const ending of ['close', 'hello-error', 'timeout', 'reconnect']) test(`held transfer acknowledgment settles correctly on destination ${ending}`, async (t) => {
  const { net, sockets } = routeClient(t);
  const accepted = net.request('room.join', { code: 'TEST' }, { timeout: ending === 'timeout' ? 20 : 1000 });
  const expected = { close: 'CLOSED', 'hello-error': 'OFFLINE', timeout: 'TIMEOUT' }[ending];
  const rejected = expected ? assert.rejects(accepted, (error) => error.code === expected) : null;
  const request = sockets[0].sent.find((m) => m.t === 'room.join');
  sockets[0].frame({ t: 'ok', rid: request.rid, routeSlot: 1 });
  if (ending === 'close') net.close();
  if (ending === 'hello-error') {
    sockets[1].readyState = 1; sockets[1].onopen();
    sockets[1].frame({ t: 'error', rid: sockets[1].sent.find((m) => m.t === 'hello').rid, code: 'INTERNAL' });
  }
  if (ending === 'reconnect') {
    sockets[1].close();
    assert.equal(net.pendingCount, 1);
    net.retryNow(); sockets[2].welcome(); await accepted;
  } else await rejected;
  assert.equal(net.pendingCount, 0);
  assert.equal(sockets.slice(1).some((socket) => socket.sent.some((m) => m.t === 'room.join')), false);
});

test('a route hint on another intent cannot reroute the socket', async (t) => {
  const { net, sockets } = routeClient(t);
  const ready = net.request('room.ready', { ready: true });
  const request = sockets[0].sent.find((m) => m.t === 'room.ready');
  sockets[0].frame({ t: 'ok', rid: request.rid, routeSlot: 1 });
  await ready;
  assert.equal(sockets.length, 1);
  assert.equal(net.roomSlot, undefined);
});

test('a target crash before ownership transition leaves the healthy source room intact', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, roomRestart: { baseMs: 1000 }, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const host = await client(t, srv, 0), moving = await client(t, srv, 1);
  const destination = await createRoom(host), source = await createRoom(moving);
  const gate = holdReply(t, srv.roomSupervisor.slots[1].child, 'prepare');
  const rejected = assert.rejects(moving.net.request('room.join', { code: destination.code }), (error) => error.code === 'INTERNAL');
  await gate.ready;
  const target = srv.roomSupervisor.slots[0];
  const exited = new Promise((resolve) => target.child.once('exit', resolve));
  target.child.kill('SIGKILL'); await exited;
  gate.release(); await rejected;
  assert.equal(srv.registry.byId(moving.net.playerId).roomSlot, 1);
  assert.equal(srv.registry.byId(moving.net.playerId).roomCode, source.code);
  assert.deepEqual(srv.roomSupervisor.rooms.get(source.code).humans, [moving.net.playerId]);
  await moving.net.request('room.addBot');
});

for (const failure of ['rejected', 'expired', 'target-crashed']) test(`a ${failure} ownership acknowledgment rolls back before leaving the source`, { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const host = await client(t, srv, 0), moving = await client(t, srv, 1);
  const destination = await createRoom(host), source = await createRoom(moving);
  const gate = holdReply(t, srv.roomSupervisor.slots[1].child, 'move');
  const rejected = assert.rejects(moving.net.request('room.join', { code: destination.code }), (error) => error.code === 'INTERNAL');
  await gate.ready;
  assert.equal(srv.registry.byId(moving.net.playerId).roomSlot, 0, 'primary ownership changed while the source seat still exists');
  assert.deepEqual(srv.roomSupervisor.rooms.get(source.code).humans, [moving.net.playerId]);
  if (failure === 'target-crashed') {
    const target = srv.roomSupervisor.slots[0];
    const exited = new Promise((resolve) => target.child.once('exit', resolve));
    target.child.kill('SIGKILL'); await exited;
  }
  gate.release(failure === 'expired' ? { value: { expiresAt: 0 } } : { error: 'forced move rejection' });
  await rejected;
  assert.equal(srv.registry.byId(moving.net.playerId).roomSlot, 1);
  assert.equal(srv.registry.byId(moving.net.playerId).roomCode, source.code);
  if (failure === 'target-crashed') assert.equal(srv.roomSupervisor.rooms.has(destination.code), false);
  else await until(() => srv.roomSupervisor.rooms.get(destination.code)?.humans.length === 1);
  await moving.net.request('room.addBot');
});

test('hello cannot adopt provisional target ownership and resolves after rollback', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const target = await client(t, srv, 0), moving = await client(t, srv, 1);
  const destination = await createRoom(target), source = await createRoom(moving);
  const gate = holdReply(t, srv.roomSupervisor.slots[1].child, 'move');
  const rejected = assert.rejects(moving.net.request('room.join', { code: destination.code }), (error) => error.code === 'INTERNAL');
  await gate.ready;
  const child = srv.roomSupervisor.slots[0].child;
  let observed;
  const received = new Promise((resolve) => { observed = (msg) => { if (msg?.channel === 'rooms' && msg.method === 'hello' && msg.value.token === moving.token()) resolve(); }; });
  child.on('message', observed);
  t.after(() => child.off('message', observed));
  const frames = [], ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?roomSlot=0`);
  t.after(() => ws.terminate());
  ws.on('message', (raw) => frames.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ t: 'hello', token: moving.token(), name: 'Resume', version: PROTOCOL_VERSION }));
  await received;
  await srv.roomSupervisor.slots[0].peer.request('health');
  assert.equal(frames.length, 0, 'real IPC continues while this hello waits for ownership completion');
  gate.release({ error: 'forced move rejection' }); await rejected;
  await until(() => frames.some((m) => m.t === 'room.route'));
  assert.equal(frames.find((m) => m.t === 'room.route').slot, 1);
  assert.equal(srv.registry.byId(moving.net.playerId).roomCode, source.code);
});

test('a source match starting while ownership ACK is held rolls back the target', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const target = await client(t, srv, 0), host = await client(t, srv, 1), moving = await client(t, srv, 1);
  const destination = await createRoom(target), source = await createRoom(host);
  await moving.net.request('room.join', { code: source.code });
  await moving.net.request('room.ready', { ready: true });
  const gate = holdReply(t, srv.roomSupervisor.slots[1].child, 'move');
  const rejected = assert.rejects(moving.net.request('room.join', { code: destination.code }), (error) => error.code === 'ROOM_STARTED');
  await gate.ready;
  await host.net.request('room.start');
  gate.release(); await rejected;
  assert.equal(srv.registry.byId(moving.net.playerId).roomSlot, 1);
  assert.equal(srv.registry.byId(moving.net.playerId).roomCode, source.code);
  await until(() => srv.roomSupervisor.rooms.get(destination.code)?.humans.length === 1);
  await moving.net.request('g.infoReady');
});

test('a source disconnect while ownership ACK is held restores its resumable source identity', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const target = await client(t, srv, 0), host = await client(t, srv, 1), moving = await client(t, srv, 1);
  const destination = await createRoom(target), source = await createRoom(host);
  await moving.net.request('room.join', { code: source.code });
  const id = moving.net.playerId, token = moving.token();
  const gate = holdReply(t, srv.roomSupervisor.slots[1].child, 'move');
  const rejected = assert.rejects(moving.net.request('room.join', { code: destination.code }));
  await gate.ready;
  moving.net.close(); await rejected;
  await until(() => host.frames.findLast((m) => m.t === 'room.state')?.seats.some((s) => s?.playerId === id && !s.connected));
  gate.release();
  await until(() => srv.registry.byId(id)?.roomSlot === 1 && srv.roomSupervisor.rooms.get(destination.code)?.humans.length === 1);
  const resumed = await client(t, srv, 1, token);
  assert.equal(resumed.net.playerId, id);
  await until(() => resumed.frames.some((m) => m.t === 'room.state' && m.code === source.code));
});

test('replacement credit is rechecked after the ownership acknowledgment', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, maxRoomsPerAddr: 1, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const host = await client(t, srv, 0, null, { headers: { 'X-Real-IP': '198.51.100.1' } }), guest = await client(t, srv, 0);
  const source = await createRoom(host);
  const gate = holdReply(t, srv.roomSupervisor.slots[0].child, 'move');
  const rejected = assert.rejects(host.net.request('room.create', { mode: 'coop', difficulty: 'HARD' }), (error) => error.code === 'RATE');
  await gate.ready;
  await guest.net.request('room.join', { code: source.code });
  gate.release(); await rejected;
  assert.equal(srv.registry.byId(host.net.playerId).roomSlot, 0);
  assert.equal(srv.registry.byId(host.net.playerId).roomCode, source.code);
  await until(() => srv.roomSupervisor.rooms.size === 1);
});

for (const exact of [true, false]) test(`room.route retries ${exact ? 'the exact pending request' : 'no server-supplied replacement intent'}`, async (t) => {
  const sockets = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.({ code: 4000 }); }
    welcome() {
      this.readyState = 1; this.onopen?.();
      this.onmessage?.({ data: JSON.stringify({ t: 'welcome', playerId: 'p_test', token: 'token', rid: this.sent.find((m) => m.t === 'hello').rid }) });
    }
  }
  const net = new Net({ url: 'wss://example.invalid/ws?existing=1', WebSocket: Socket });
  t.after(() => net.close());
  net.setName('Player'); sockets[0].welcome();
  const pending = net.request('room.join', { code: 'TEST' });
  const original = sockets[0].sent.find((m) => m.t === 'room.join');
  const refused = exact ? null : assert.rejects(pending, (error) => error.code === 'DISCONNECTED');
  net._onMessage(JSON.stringify({ t: 'room.route', slot: 1, retry: exact ? original : { ...original, code: 'ELSE' } }));
  assert.equal(sockets.length, 2);
  const url = new URL(sockets[1].url);
  assert.equal(url.origin, 'wss://example.invalid'); assert.equal(url.searchParams.get('existing'), '1');
  assert.equal(url.searchParams.get('roomSlot'), '1');
  sockets[1].welcome();
  const retried = sockets[1].sent.filter((m) => m.t === 'room.join');
  if (exact) {
    assert.deepEqual(retried, [original]);
    net._onMessage(JSON.stringify({ t: 'ok', rid: original.rid })); await pending;
  } else { assert.deepEqual(retried, []); await refused; }
});

for (const n of [1, 2]) test(`N=${n}: 400 fresh sockets send hello immediately, every hello is answered`, { timeout: 60000 }, async (t) => {
  const boot = performance.now();
  const child = fork(fileURLToPath(new URL('../helpers/room-server-child.mjs', import.meta.url)), [], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const peer = createPeer(child);
  const sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const timer = setTimeout(() => child.kill(), 5000);
    try { await peer.request('stop'); if (child.connected) child.disconnect(); await exited; }
    finally { clearTimeout(timer); peer.close(); }
  });
  const srv = await peer.request('init', { port: 0, host: '127.0.0.1', roomProcs: n, quiet: true, studio: false, assetIndex: false });
  const bootMs = performance.now() - boot;
  const start = performance.now();
  const outcomes = await Promise.allSettled(Array.from({ length: 400 }, () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`, { perMessageDeflate: false });
    sockets.push(ws);
    const timer = setTimeout(() => reject(new Error('unanswered hello')), 25000);
    ws.on('error', (error) => { clearTimeout(timer); reject(error); });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Player', version: PROTOCOL_VERSION })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.t === 'welcome') { clearTimeout(timer); resolve(msg); }
      if (msg.t === 'error') { clearTimeout(timer); reject(new Error(JSON.stringify(msg))); }
    });
  })));
  const results = outcomes.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const errors = outcomes.filter((r) => r.status === 'rejected').map((r) => r.reason);
  const stats = await peer.request('stats');
  t.diagnostic(`N=${n}: answered=${results.length}, unanswered=${errors.length}, burstWallMs=${(performance.now() - start).toFixed(1)}, bootMs=${bootMs.toFixed(1)}, roomChildren=${stats.children}`);
  assert.equal(errors.length, 0, `all fresh hello attempts complete: ${errors.map((e) => e.code || e.message).join(', ')}`);
  assert.equal(new Set(results.map((m) => m.playerId)).size, 400);
  assert.equal(stats.connections, 400);
  assert.equal(stats.children, n === 1 ? 0 : n);
});

for (const buffered of ['head', 'stream']) test(`TCP handoff preserves a hello buffered in the upgrade ${buffered}`, { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.destroy(); await srv.close(); });
  const hello = Buffer.from(JSON.stringify({ t: 'hello', name: 'Player', version: PROTOCOL_VERSION }));
  const mask = Buffer.from([1, 2, 3, 4]);
  assert.ok(hello.length < 126);
  const frame = Buffer.concat([Buffer.from([0x81, 0x80 | hello.length]), mask, Buffer.from(hello.map((v, i) => v ^ mask[i % 4]))]);
  let drained = 0;
  if (buffered === 'stream') {
    // Put the frame in the real paused Socket's readable buffer, independently of HTTP packet coalescing.
    srv.server.prependListener('upgrade', (_req, socket, head) => {
      assert.equal(head.length, 0);
      socket.pause(); socket.unshift(frame);
      assert.equal(socket.readableLength, frame.length);
    });
    srv.server.on('upgrade', (_req, socket) => { assert.equal(socket.readableLength, 0); drained++; });
  }
  await Promise.all(Array.from({ length: 16 }, (_, i) => new Promise((resolve, reject) => {
    const socket = connectTcp({ host: '127.0.0.1', port: srv.port }); sockets.push(socket);
    let bytes = Buffer.alloc(0), upgraded = false;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('buffered hello unanswered')); }, 10000);
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
    socket.on('connect', () => socket.write(Buffer.concat([Buffer.from(`GET /ws?roomSlot=${i % 2} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`), buffered === 'head' ? frame : Buffer.alloc(0)])));
    socket.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (!upgraded) {
        const end = bytes.indexOf('\r\n\r\n'); if (end < 0) return;
        assert.match(bytes.subarray(0, end).toString(), /^HTTP\/1\.1 101/);
        bytes = bytes.subarray(end + 4); upgraded = true;
      }
      while (bytes.length >= 2) { // loop-cap: buffered complete frames
        const opcode = bytes[0] & 15;
        let size = bytes[1] & 127, offset = 2;
        if (size === 126) { if (bytes.length < 4) return; size = bytes.readUInt16BE(2); offset = 4; }
        if (size === 127) { clearTimeout(timer); reject(new Error('unexpected oversized frame')); return; }
        if (bytes.length < offset + size) return;
        const payload = bytes.subarray(offset, offset + size); bytes = bytes.subarray(offset + size);
        if (opcode !== 1) continue;
        const msg = JSON.parse(payload);
        if (msg.t === 'welcome') { clearTimeout(timer); resolve(); return; }
        if (msg.t === 'error') { clearTimeout(timer); reject(new Error(JSON.stringify(msg))); return; }
      }
    });
  })));
  assert.equal(srv.network.connectionCount, 16);
  if (buffered === 'stream') assert.equal(drained, 16);
});

test('cross-slot join, spectator, reconnect, directory, aggregate admission and drain/restart', { timeout: 60000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false, maxConnections: 8 });
  t.after(() => srv.close());
  const a = await client(t, srv, 0), b = await client(t, srv, 1);
  await a.net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
  const state = await until(() => a.frames.find((m) => m.t === 'room.state'));
  await b.net.request('room.join', { code: state.code });
  await until(() => b.net.roomSlot === 0 && b.net.status === 'online');
  const viewer = await client(t, srv, 1);
  await viewer.net.request('room.spectate', { code: state.code });
  await until(() => a.frames.some((m) => m.t === 'room.state' && m.seats.filter(Boolean).length === 2));
  assert.equal(srv.roomSupervisor.rooms.get(state.code).slot, 0);
  await until(() => srv.lobby.stats().spectators === 1);
  const health = await (await fetch(`${srv.url}/healthz`)).json();
  assert.equal(health.rooms, 1); assert.equal(health.humans, 2); assert.equal(health.spectators, 1);
  const id = b.net.playerId, token = b.token();
  b.net.close();
  const resumed = await client(t, srv, 1, token);
  assert.equal(resumed.net.playerId, id);
  assert.equal(resumed.net.roomSlot, 0);
  await until(() => resumed.frames.some((m) => m.t === 'room.state' && m.code === state.code));
  srv.roomSupervisor.drain(0);
  const other = await client(t, srv, 1);
  await other.net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
  const otherState = await until(() => other.frames.find((m) => m.t === 'room.state'));
  assert.equal(srv.roomSupervisor.rooms.get(otherState.code).slot, 1);
  await assert.rejects(srv.roomSupervisor.restart(0), /still owns rooms/);
  assert.equal(srv.roomSupervisor.slots[0].draining, true, 'a refusal preserves an existing drain');
  await srv.roomSupervisor.restart(0, { force: true });
  assert.equal(srv.roomSupervisor.rooms.has(state.code), false);
  assert.equal(srv.roomSupervisor.slots[0].ready, true);
  const old = srv.roomSupervisor.slots[0];
  const exited = new Promise((resolve) => old.child.once('exit', resolve));
  old.child.kill('SIGKILL'); await exited;
  await until(() => old.dead);
  // Inject late delivery through the old EventEmitter, rather than claiming an observed IPC ordering race.
  const late = () => old.child.emit('message', { channel: 'rooms', method: 'publish', id: 'late', value: [{ code: state.code }] });
  late(); await pause(0);
  assert.equal(srv.roomSupervisor.rooms.has(state.code), false, 'dead-slot IPC cannot restore a removed room');
  await srv.roomSupervisor.restart(0);
  assert.notEqual(srv.roomSupervisor.slots[0].child.pid, old.child.pid);
  late(); await pause(0);
  assert.equal(srv.roomSupervisor.rooms.has(state.code), false, 'the previous generation cannot publish after restart');
});

test('refused restart restores room placement and children respawn with health information', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, roomRestart: { baseMs: 50 }, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const player = await client(t, srv, 0);
  const state = await createRoom(player);
  await until(() => srv.roomSupervisor.rooms.get(state.code)?.humans?.length === 1);
  await assert.rejects(srv.roomSupervisor.restart(0), /still owns rooms/);
  assert.equal(srv.roomSupervisor.slots[0].draining, false);
  const old = srv.roomSupervisor.slots[0];
  const exited = new Promise((resolve) => old.child.once('exit', resolve));
  old.child.kill('SIGKILL'); await exited;
  const degraded = await (await fetch(`${srv.url}/healthz`)).json();
  assert.equal(degraded.roomProcesses.requested, 2);
  assert.equal(degraded.roomProcesses.slots[0].ready, false);
  assert.equal(degraded.roomProcesses.slots[0].failures, 1);
  await until(() => srv.roomSupervisor.slots[0] !== old && srv.roomSupervisor.slots[0].ready);
  const recovered = await (await fetch(`${srv.url}/healthz`)).json();
  assert.equal(recovered.roomProcesses.ready, 2);
});

test('drain remains in force after crash recovery and manual replacement', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, roomRestart: { baseMs: 25 }, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  srv.roomSupervisor.drain(0);
  const old = srv.roomSupervisor.slots[0], exited = new Promise((resolve) => old.child.once('exit', resolve));
  old.child.kill('SIGKILL'); await exited;
  await until(() => srv.roomSupervisor.slots[0] !== old && srv.roomSupervisor.slots[0].ready);
  assert.equal(srv.roomSupervisor.slots[0].draining, true);
  const host = await client(t, srv, 0), room = await createRoom(host);
  assert.equal(srv.roomSupervisor.rooms.get(room.code).slot, 1, 'replacement keeps new rooms away from the drained slot');
  await srv.roomSupervisor.restart(0);
  assert.equal(srv.roomSupervisor.slots[0].draining, true);
});

test('three consecutive health misses retire a child, while a successful probe resets the count', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2,
    roomRestart: { baseMs: 25, healthIntervalMs: 25 }, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const slot = srv.roomSupervisor.slots[0], request = slot.peer.request, pending = [];
  slot.peer.request = (method, ...args) => method === 'health'
    ? new Promise((resolve, reject) => pending.push({ resolve, reject })) : request(method, ...args);
  t.after(() => { slot.peer.request = request; for (const probe of pending) probe.resolve({ ready: true }); });
  const miss = async (count, notReady = false) => {
    const probe = await until(() => pending.shift());
    if (notReady) probe.resolve({ ready: false }); else probe.reject(new Error('probe timed out'));
    await until(() => slot.healthMisses === count);
  };
  await miss(1); await miss(2, true);
  assert.equal(srv.roomSupervisor.slots[0], slot);
  assert.equal(slot.dead, false, 'one or two missed probes leave this generation running');
  assert.equal(srv.roomSupervisor.health().roomProcesses.slots[0].healthMisses, 2);
  (await until(() => pending.shift())).resolve({ ready: true });
  await until(() => slot.healthMisses === 0);
  await miss(1); await miss(2); await miss(3);
  await until(() => slot.dead);
  await until(() => srv.roomSupervisor.slots[0] !== slot && srv.roomSupervisor.slots[0].ready);
  assert.equal(srv.roomSupervisor.health().roomProcesses.slots[0].healthMisses, 0);
});

test('a rejected replacement init retires that generation and recovers automatically', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, roomRestart: { baseMs: 50 }, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const slots = srv.roomSupervisor.slots, original = slots[0];
  let current = original, rejected, inject = true;
  // Observe the documented slot list at assignment, before its real IPC peer handles initialization replies.
  Object.defineProperty(slots, '0', { configurable: true, enumerable: true,
    get: () => current,
    set(slot) {
      current = slot;
      if (!inject) return;
      inject = false;
      rejected = slot;
      slot.child.on('message', (msg) => {
        if (msg?.channel === 'rooms' && msg.reply != null && msg.value?.port) msg.error = 'forced replacement init rejection';
      });
    },
  });
  t.after(() => Object.defineProperty(slots, '0', { configurable: true, enumerable: true, writable: true, value: current }));
  await assert.rejects(srv.roomSupervisor.restart(0), /forced replacement init rejection/);
  assert.ok(rejected.dead);
  assert.equal(rejected.child.exitCode !== null || rejected.child.signalCode !== null, true);
  await until(() => slots[0] !== rejected && slots[0].ready);
  assert.equal(srv.roomSupervisor.health().roomProcesses.ready, 2);
  assert.equal(slots[0].failures, 1);
});

test('shutdown while a dead-slot manual restart awaits exit cannot spawn a replacement', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const slots = srv.roomSupervisor.slots, old = slots[0], child = old.child;
  const kill = child.kill.bind(child), disconnect = child.disconnect.bind(child);
  let stops = 0;
  // Hold this generation alive after disconnect detection so both operations really await the same exit.
  child.kill = () => { stops++; return true; };
  child.disconnect = () => {};
  t.after(() => { child.kill = kill; child.disconnect = disconnect; if (child.exitCode === null && child.signalCode === null) kill('SIGKILL'); });
  child.emit('disconnect');
  assert.equal(old.dead, true);
  const restarting = srv.roomSupervisor.restart(0);
  assert.ok(stops >= 2, 'manual restart is waiting for the failed generation to exit');
  const closing = srv.close();
  assert.equal(srv.roomSupervisor.health().roomProcesses.stopping, true);
  child.kill = kill; child.disconnect = disconnect;
  kill('SIGKILL');
  await Promise.all([restarting, closing]);
  assert.equal(slots[0], old, 'shutdown must not install another child generation');
  assert.equal(slots.every((slot) => slot.child.exitCode !== null || slot.child.signalCode !== null), true);
});

test('a child crash gives roomless identities no shutdown notice', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const idle = await client(t, srv, 0);
  await until(() => srv.registry.byId(idle.net.playerId)?.connected);
  idle.net.close();
  const old = srv.roomSupervisor.slots[0];
  const exited = new Promise((resolve) => old.child.once('exit', resolve));
  old.child.kill('SIGKILL'); await exited;
  assert.equal(srv.registry.byId(idle.net.playerId).notice, null);
});

test('unrecoverable room crash loops close the listener and exit nonzero', { timeout: 30000 }, async (t) => {
  const child = fork(fileURLToPath(new URL('../helpers/room-server-child.mjs', import.meta.url)), [], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const peer = createPeer(child);
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  t.after(async () => { peer.close(); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  const srv = await peer.request('init', { port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false,
    exitOnRoomFailure: true, roomRestart: { baseMs: 10, maxMs: 10, maxFailures: 2 } });
  await peer.request('crash');
  let stats;
  const deadline = Date.now() + 15000;
  // kill() requests termination; wait for both exit events and the replacement generation's readiness.
  const recovered = () => stats.health.roomProcesses.ready === 2 && stats.health.roomProcesses.slots.every((s) => s.failures === 1);
  do { await pause(20); stats = await peer.request('stats'); } while (!recovered() && Date.now() < deadline);
  assert.equal(stats.health.roomProcesses.ready, 2);
  assert.equal(stats.health.roomProcesses.slots.every((s) => s.failures === 1), true);
  await peer.request('crash');
  assert.equal(await exited, 1);
  await assert.rejects(fetch(`http://127.0.0.1:${srv.port}/healthz`));
});

test('primary drain sends room.closed shutdown followed by close code 1001', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  const frames = [];
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  t.after(async () => { ws.terminate(); await srv.close(); });
  ws.on('message', (data) => frames.push(JSON.parse(data)));
  const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ t: 'hello', name: 'Player', version: PROTOCOL_VERSION }));
  await until(() => frames.some((m) => m.t === 'welcome'));
  ws.send(JSON.stringify({ t: 'room.create', mode: 'coop', difficulty: 'HARD' }));
  await until(() => frames.some((m) => m.t === 'room.state'));
  await srv.close();
  assert.ok(frames.some((m) => m.t === 'room.closed' && m.reason === 'shutdown'));
  assert.equal(await closed, 1001);
});

test('a saved dead slot reconnects through a healthy child without an operator restart', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const player = await client(t, srv, 0);
  await createRoom(player);
  const playerId = player.net.playerId, before = player.frames.length;
  const dead = srv.roomSupervisor.slots[0];
  const exited = new Promise((resolve) => dead.child.once('exit', resolve));
  dead.child.kill('SIGKILL'); await exited;
  await until(() => player.frames.slice(before).some((m) => m.t === 'welcome' && m.playerId === playerId));
  await until(() => player.frames.slice(before).some((m) => m.t === 'room.closed' && m.reason === 'shutdown'));
  assert.equal(srv.registry.byId(playerId).roomSlot, 1);
  assert.equal(dead.dead, true);
  await player.net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
  assert.equal(srv.lobby.stats().rooms, 1);
});

test('a room.socket without its handle releases admission exactly once', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2,
    maxConnections: 1, maxConnectionsPerAddr: 1, quiet: true, studio: false, assetIndex: false });
  const slot = srv.roomSupervisor.slots[0], send = slot.child.send.bind(slot.child);
  let admission, dropped;
  t.after(async () => { slot.child.send = send; dropped?.destroy(); await srv.close(); });
  slot.child.send = (msg, ...args) => {
    if (msg?.type !== 'room.socket' || admission != null) return send(msg, ...args);
    admission = msg.admission; dropped = args[0];
    return send(msg, (error) => { dropped.destroy(); args[2]?.(error); });
  };
  const wsOptions = { headers: { 'X-Real-IP': '198.51.100.1' } };
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?roomSlot=0`, wsOptions);
    t.after(() => ws.terminate());
    ws.once('open', () => { ws.terminate(); reject(new Error('missing handle unexpectedly upgraded')); });
    ws.once('error', resolve);
  });
  await until(() => srv.network.connectionCount === 0);
  assert.ok(admission != null);
  assert.equal(slot.connections, 0);
  const player = await client(t, srv, 0, null, wsOptions);
  assert.equal(slot.connections, 1, 'both total and per-network admission are available again');
  slot.child.emit('message', { channel: 'rooms', method: 'closed', value: { admission } });
  await pause(0);
  assert.equal(slot.connections, 1, 'a duplicate old close preserves the current admission');
  player.net.close();
  await until(() => srv.network.connectionCount === 0);
  assert.equal(slot.connections, 0);
});

test('socket routing balances connection counters and skips a slot awaiting intentional stop', { timeout: 30000 }, async (t) => {
  let release;
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(async () => { release?.(); await srv.close(); });
  const a = await client(t, srv), b = await client(t, srv), c = await client(t, srv);
  assert.deepEqual(srv.roomSupervisor.slots.map((slot) => slot.connections), [2, 1]);
  const preferred = await client(t, srv, 0);
  assert.deepEqual(srv.roomSupervisor.slots.map((slot) => slot.connections), [3, 1]);
  for (const player of [a, b, c, preferred]) player.net.close();
  await until(() => srv.network.connectionCount === 0);
  const old = srv.roomSupervisor.slots[0], request = old.peer.request;
  let entered = false;
  const held = new Promise((resolve) => { release = resolve; });
  old.peer.request = async (method, ...args) => {
    if (method === 'stop') { entered = true; await held; }
    return request(method, ...args);
  };
  t.after(() => { old.peer.request = request; });
  const replacing = srv.roomSupervisor.restart(0);
  await until(() => entered);
  assert.equal(old.ready, true, 'the test holds the ready generation before its stop request is delivered');
  assert.equal(srv.roomSupervisor.health().roomProcesses.ready, 1);
  const newcomer = await client(t, srv, 0);
  assert.equal(srv.registry.byId(newcomer.net.playerId).roomSlot, 1);
  assert.deepEqual(srv.roomSupervisor.slots.map((slot) => slot.connections), [0, 1]);
  release(); await replacing;
  assert.equal(srv.roomSupervisor.slots[0].connections, 0);
  assert.equal(srv.roomSupervisor.slots[0].draining, false, 'a normal restart restores ordinary room placement');
  newcomer.net.close();
  await until(() => srv.network.connectionCount === 0);
  assert.deepEqual(srv.roomSupervisor.slots.map((slot) => slot.connections), [0, 0]);
});

for (const [name, options, wsOptions, status] of [
  ['global', { maxConnections: 2 }, {}, '503'],
  ['per-network', { maxConnectionsPerAddr: 2 }, { headers: { 'X-Real-IP': '198.51.100.1' } }, '429'],
]) test(`${name} connection admission is shared across slots and releases closed handles`, { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, ...options, quiet: true, studio: false, assetIndex: false });
  const sockets = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); await srv.close(); });
  for (let slot = 0; slot < 2; slot++) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?roomSlot=${slot}`, wsOptions);
      sockets.push(ws); ws.once('open', resolve); ws.once('error', reject);
    });
  }
  assert.deepEqual(srv.roomSupervisor.health().roomProcesses.slots.map((slot) => slot.connections), [1, 1]);
  await new Promise((resolve, reject) => {
    const extra = new WebSocket(`ws://127.0.0.1:${srv.port}/ws?roomSlot=0`, wsOptions);
    extra.once('open', () => { extra.terminate(); reject(new Error('aggregate limit bypassed')); });
    extra.once('error', (error) => { assert.ok(error.message.includes(status), error.message); resolve(); });
  });
  for (const ws of sockets) ws.terminate();
  await until(() => srv.network.connectionCount === 0);
  assert.deepEqual(srv.roomSupervisor.slots.map((slot) => slot.connections), [0, 0]);
});

for (const kind of ['room.join', 'room.spectate']) test(`${kind}: target capacity is committed before routing and a failed competitor keeps its source`, { timeout: 45000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const target = await client(t, srv, 0), moving = await client(t, srv, 1), competitor = await client(t, srv, 0);
  const destination = await createRoom(target), source = await createRoom(moving), otherSource = await createRoom(competitor);
  if (kind === 'room.join') {
    await target.net.request('room.addBot'); await target.net.request('room.addBot');
  } else {
    const viewer = await client(t, srv, 0);
    await viewer.net.request('room.spectate', { code: destination.code });
  }
  const gate = holdAdmission(t, srv.roomSupervisor.slots[0].peer);
  const routed = moving.net.request(kind, { code: destination.code });
  assert.equal((await gate.ready).error, undefined);
  assert.equal(srv.registry.byId(moving.net.playerId).roomCode, source.code, 'source is retained until target admission succeeds');
  await assert.rejects(competitor.net.request(kind, { code: destination.code }), (error) => error.code === 'ROOM_FULL');
  assert.equal(srv.registry.byId(competitor.net.playerId).roomCode, otherSource.code);
  if (kind === 'room.join') {
    await assert.rejects(target.net.request('room.addBot'), (error) => error.code === 'ROOM_FULL');
    await assert.rejects(target.net.request('room.start'), (error) => error.code === 'NOT_READY');
  } else await target.net.request('room.start');
  gate.release(); await routed;
  await until(() => moving.net.roomSlot === 0 && moving.net.status === 'online');
  assert.equal(srv.registry.byId(moving.net.playerId).roomCode, destination.code);
  assert.equal(srv.roomSupervisor.rooms.has(source.code), false);
});

test('a source match starting during target admission rolls back the target and retains the source seat', { timeout: 45000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const target = await client(t, srv, 0), sourceHost = await client(t, srv, 1), moving = await client(t, srv, 1);
  const destination = await createRoom(target), source = await createRoom(sourceHost);
  await moving.net.request('room.join', { code: source.code });
  await moving.net.request('room.ready', { ready: true });
  const gate = holdAdmission(t, srv.roomSupervisor.slots[0].peer);
  const refused = assert.rejects(moving.net.request('room.join', { code: destination.code }), (error) => error.code === 'ROOM_STARTED');
  await gate.ready;
  await sourceHost.net.request('room.start');
  gate.release(); await refused;
  assert.equal(moving.net.roomSlot, 1);
  assert.equal(srv.registry.byId(moving.net.playerId).roomCode, source.code);
  await until(() => srv.roomSupervisor.rooms.get(destination.code)?.humans.length === 1);
  assert.equal(srv.roomSupervisor.rooms.get(source.code).humans.length, 2);
  await moving.net.request('g.infoReady');
});

test('per-network replacement credit is rechecked after target admission', { timeout: 45000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, maxRoomsPerAddr: 1, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const host = await client(t, srv, 0, null, { headers: { 'X-Real-IP': '198.51.100.1' } });
  const guest = await client(t, srv, 0);
  const source = await createRoom(host);
  const gate = holdAdmission(t, srv.roomSupervisor.slots[1].peer);
  const refused = assert.rejects(host.net.request('room.create', { mode: 'coop', difficulty: 'HARD' }), (error) => error.code === 'RATE');
  await gate.ready;
  await guest.net.request('room.join', { code: source.code });
  gate.release(); await refused;
  assert.equal(srv.registry.byId(host.net.playerId).roomCode, source.code);
  await until(() => srv.roomSupervisor.rooms.size === 1);
  await guest.net.request('room.leave');
  await host.net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
  await until(() => host.net.roomSlot === 1 && host.net.status === 'online');
  assert.equal(srv.roomSupervisor.rooms.size, 1);
});

test('replacement admission refreshes dirty source membership before enforcing shared room limits', { timeout: 30000 }, async (t) => {
  const srv = await gatedServer(t, { maxRoomsPerAddr: 1 });
  const network = { headers: { 'X-Real-IP': '198.51.100.1' } };
  const host = await client(t, srv, 0, null, network), guest = await client(t, srv, 0), competitor = await client(t, srv, 1, null, network);
  const source = await createRoom(host);
  await guest.net.request('room.join', { code: source.code });
  await until(() => srv.roomSupervisor.rooms.get(source.code)?.humans.length === 2);
  await assert.rejects(competitor.net.request('room.create', { mode: 'coop', difficulty: 'HARD' }), (error) => error.code === 'RATE');
  const child = srv.roomSupervisor.slots[0].child;
  const publication = await holdPublication(t, child);
  try {
    await guest.net.request('room.leave');
    await publication.blocked;
    assert.equal(srv.roomSupervisor.rooms.get(source.code).humans.length, 2, 'ordinary publication is still held after the successful leave');
    let prepared;
    const observe = (msg) => { if (msg?.channel === 'rooms' && msg.method === 'prepare' && msg.value.playerId === host.net.playerId) prepared = msg.value; };
    child.on('message', observe);
    t.after(() => child.off('message', observe));
    await host.net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
    assert.deepEqual(prepared.update.rooms.find(([code]) => code === source.code)[1].humans, [host.net.playerId]);
    const replacement = srv.registry.byId(host.net.playerId).roomCode;
    assert.notEqual(replacement, source.code);
    await until(() => srv.roomSupervisor.rooms.has(replacement) && !srv.roomSupervisor.rooms.has(source.code));
    await assert.rejects(competitor.net.request('room.create', { mode: 'coop', difficulty: 'HARD' }), (error) => error.code === 'RATE');
    assert.equal(srv.roomSupervisor.rooms.size, 1);
  } finally { await publication.release(); }
});

test('rollback completion removes a published target room before immediate replacement retry', { timeout: 30000 }, async (t) => {
  const srv = await gatedServer(t, { maxRoomsPerAddr: 1 });
  const network = { headers: { 'X-Real-IP': '198.51.100.1' } };
  const host = await client(t, srv, 0, null, network), guest = await client(t, srv, 0);
  const source = await createRoom(host);
  const target = srv.roomSupervisor.slots[1], admission = holdAdmission(t, target.peer);
  const refused = assert.rejects(host.net.request('room.create', { mode: 'coop', difficulty: 'HARD' }), (error) => error.code === 'RATE');
  await admission.ready;
  const pending = await until(() => [...srv.roomSupervisor.rooms.values()].find((room) => room.slot === 1 && !room.reserved));
  await target.peer.request('health');
  const publication = await holdPublication(t, target.child);
  try {
    await guest.net.request('room.join', { code: source.code });
    admission.release(); await refused;
    const blocked = await publication.blocked;
    assert.ok(blocked.rooms.some(([code, value]) => code === pending.code && value === null), 'target rollback removal has not been published');
    await guest.net.request('room.leave');
    await host.net.request('room.create', { mode: 'coop', difficulty: 'HARD' });
    const replacement = srv.registry.byId(host.net.playerId).roomCode;
    assert.notEqual(replacement, source.code);
    assert.notEqual(replacement, pending.code);
    await publication.release();
    await until(() => srv.roomSupervisor.rooms.has(replacement) && srv.roomSupervisor.rooms.size === 1);
    assert.equal(srv.roomSupervisor.rooms.has(pending.code), false);
    assert.equal(srv.roomSupervisor.rooms.has(source.code), false);
  } finally { await publication.release(); }
});

test('failed rollback cleanup retires the target without rewriting the source rejection', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, maxRoomsPerAddr: 1, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const host = await client(t, srv, 0, null, { headers: { 'X-Real-IP': '198.51.100.1' } }), guest = await client(t, srv, 0);
  const source = await createRoom(host), target = srv.roomSupervisor.slots[1];
  const gate = holdAdmission(t, target.peer);
  const refused = assert.rejects(host.net.request('room.create', { mode: 'coop', difficulty: 'HARD' }), (error) => error.code === 'RATE');
  await gate.ready;
  const request = target.peer.request;
  let cleanup;
  target.peer.request = (method, ...args) => {
    if (method === 'releaseEntry') { cleanup = args; return Promise.reject(new Error('forced target cleanup failure')); }
    return request(method, ...args);
  };
  t.after(() => { target.peer.request = request; });
  await guest.net.request('room.join', { code: source.code });
  gate.release(); await refused;
  assert.equal(cleanup[0].rollback, true);
  assert.equal(cleanup[1], 10000);
  assert.equal(cleanup[2].critical, true);
  await until(() => target.dead && (target.child.exitCode !== null || target.child.signalCode !== null));
  assert.equal(srv.registry.byId(host.net.playerId).roomSlot, 0);
  assert.equal(srv.registry.byId(host.net.playerId).roomCode, source.code);
  assert.equal(srv.roomSupervisor.rooms.get(source.code).humans.length, 2);
});

test('a stale room publication cannot erase global pending match-start admission', { timeout: 45000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, maxMatchesPerAddr: 1, quiet: true, studio: false, assetIndex: false });
  t.after(() => srv.close());
  const options = { headers: { 'X-Real-IP': '198.51.100.1' } };
  const a = await client(t, srv, 0, null, options), b = await client(t, srv, 1, null, options);
  const first = await createRoom(a); await createRoom(b);
  const gate = holdReply(t, srv.roomSupervisor.slots[0].child, 'begin');
  const started = a.net.request('room.start');
  await gate.ready;
  const viewer = await client(t, srv, 0, null, options);
  await viewer.net.request('room.spectate', { code: first.code });
  await until(() => srv.roomSupervisor.rooms.get(first.code)?.spectators.length === 1);
  assert.equal(srv.roomSupervisor.rooms.get(first.code).running, false);
  await assert.rejects(b.net.request('room.start'), (error) => error.code === 'RATE');
  gate.release(); await started;
  await a.net.request('g.leave');
  await until(() => !srv.roomSupervisor.rooms.has(first.code));
  await b.net.request('room.start');
});

test('room-child plugin content and visual sets are available through the original HTTP origin', { timeout: 45000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-room-content-'));
  const pluginsDir = path.join(directory, 'plugins');
  writePlugin(path.join(pluginsDir, 'room-art'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png() });
  writePlugin(path.join(pluginsDir, 'room-art-extra'), cosmetic({ assets: { chars: { char_103_angel: { avatar: 'b.png' } } } }), { 'b.png': png() });
  writePlugin(path.join(pluginsDir, 'room-data'), { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'content', scope: ['room'],
    permissions: ['data.patch'], data: ['patch.json'] }, { 'patch.json': { patch: 1, ops: [
    { op: 'set', file: 'bonds', id: 'deputShip', path: ['bb', 'base_def'], value: 0.31 },
    { op: 'set', file: 'bonds', id: 'deputShip', path: ['buffs', 0, 'bb', 'base_def'], value: 0.31 },
  ] } });
  let srv;
  t.after(async () => { await srv?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  srv = await gatedServer(t, { pluginsDir,
    matchHost: { matchOptions: { clientCombat: false, botRehearsal: 0 } } });
  const host = await client(t, srv, 0); await createRoom(host);
  await srv.roomSupervisor.slots[0].peer.request('health');
  const publication = await holdPublication(t, srv.roomSupervisor.slots[0].child);
  let lookups = 0;
  for (const slot of srv.roomSupervisor.slots) {
    const request = slot.peer.request;
    slot.peer.request = (method, ...args) => { if (method === 'publicSet') lookups++; return request(method, ...args); };
    t.after(() => { slot.peer.request = request; });
  }
  await host.net.request('room.setPlugins', { plugins: [{ id: 'room-art' }, { id: 'room-art-extra' }, { id: 'room-data' }] });
  const state = await until(() => host.frames.findLast((m) => m.t === 'room.state' && m.content?.vanilla === false));
  await publication.blocked;
  assert.equal(srv.contents.get(state.content.cs), null, 'the set belongs to the room child');
  assert.notEqual(srv.roomSupervisor.rooms.get(state.code).cs, state.content.cs, 'directory publication remains held after the intent replies');
  assert.equal(await srv.visual.doc(state.content.vs.slice(0, 16)), null, 'the combined visual set also belongs to a child');
  const url = `${srv.url}/cs/${state.content.cs.slice(0, 16)}/index.json`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.cs, state.content.cs);
  const data = await (await fetch(srv.url + manifest.data.bonds.url)).json();
  assert.equal(data.deputShip.bb.base_def, 0.31);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const etag = response.headers.get('etag');
  assert.ok(etag);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': etag } })).status, 304);
  const visualUrl = `${srv.url}/vs/${state.content.vs.slice(0, 16)}/overlay.json`;
  const visualResponse = await fetch(visualUrl);
  assert.equal(visualResponse.status, 200);
  const visual = await visualResponse.json();
  assert.equal(visual.visual.vs, state.content.vs);
  assert.equal((await fetch(visualUrl, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(visualUrl, { headers: { 'If-None-Match': visualResponse.headers.get('etag') } })).status, 304);
  assert.ok(lookups > 0, 'new content is discovered independently of ordinary directory publication');
  await publication.release();
  await until(() => srv.roomSupervisor.rooms.get(state.code)?.cs === state.content.cs);
  const afterDiscovery = lookups;
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${srv.url}/cs/${srv.content.cs.slice(0, 16)}/index.json`)).status, 200);
  const localVisual = srv.visual.resolve(['room-art']);
  assert.equal(localVisual.ok, true);
  assert.equal((await fetch(`${srv.url}/vs/${localVisual.set.vs.slice(0, 16)}/overlay.json`)).status, 200);
  assert.equal(lookups, afterDiscovery, 'known owners and primary vanilla sets bypass discovery');
  await host.net.request('room.contentReady', { cs: state.content.cs });
  await host.net.request('room.start');
  await until(() => host.frames.some((m) => m.t === 'm.public' && m.phase === 'INFO_CHECK'));
  await host.net.request('g.infoReady');
  await until(() => host.frames.some((m) => m.t === 'm.public' && m.phase === 'BAND_DRAFT'));
  const band = Object.values(getData().bands).find((b) => !Array.isArray(b.modeTypeList) || b.modeTypeList.includes('MULTI'));
  await host.net.request('g.band', { bandId: band.bandId });
  await until(() => host.frames.some((m) => m.t === 'm.public' && m.phase === 'PREP'));
  await host.net.request('g.ready', { ready: true });
  await until(() => host.frames.some((m) => m.t === 'b.snap' && m.gt > 0));
  assert.equal((await (await fetch(`${srv.url}/healthz`)).json()).content.sets, 1);
});

test('public set discovery bounds concurrent misses and preserves unavailable and local responses', { timeout: 30000 }, async (t) => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: 2, quiet: true, studio: false, assetIndex: false });
  const queries = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(async () => { release(); await srv.close(); });
  for (const slot of srv.roomSupervisor.slots) {
    const request = slot.peer.request;
    slot.peer.request = (method, ...args) => {
      if (method !== 'publicSet') return request(method, ...args);
      queries.push(args); return gate.then(() => false);
    };
    t.after(() => { slot.peer.request = request; });
  }
  const urls = [1, 2, 3, 4, 5].map((id) => `${srv.url}/cs/${id.toString(16).padStart(16, '0')}/index.json`);
  let firstSeen = 0;
  const observe = (req) => { if (req.url === new URL(urls[0]).pathname) firstSeen++; };
  srv.server.on('request', observe);
  t.after(() => srv.server.off('request', observe));
  const pending = urls.slice(0, 4).map((url) => fetch(url));
  await until(() => queries.length === 8);
  const duplicate = fetch(urls[0]);
  await until(() => firstSeen === 2);
  assert.equal((await fetch(urls[4])).status, 503);
  assert.equal((await fetch(`${srv.url}/cs/${srv.content.cs.slice(0, 16)}/index.json`)).status, 200);
  assert.equal(queries.length, 8, 'four misses fan out once each; a duplicate and the primary set add no lookup');
  assert.ok(queries.every((args) => args[1] > 0 && args[1] <= 1000), 'each child query has a bounded deadline');
  release();
  for (const response of await Promise.all([...pending, duplicate])) assert.equal(response.status, 404);
  const slot = srv.roomSupervisor.slots[0], request = slot.peer.request;
  slot.peer.request = (method, ...args) => method === 'publicSet' ? Promise.reject(new Error('lookup unavailable')) : request(method, ...args);
  assert.equal((await fetch(urls[4])).status, 503);
  assert.equal(srv.roomSupervisor.health().roomProcesses.ready, 2, 'lookup failure does not retire a responsive child');
});

test('private child listeners retain the public listener test-mode gate', { timeout: 30000 }, async (t) => {
  const previous = process.env.SP_TEST_MODE;
  process.env.SP_TEST_MODE = '1';
  let srv;
  try { srv = await startServer({ port: 0, host: '0.0.0.0', roomProcs: 2, quiet: true, studio: false, assetIndex: false }); }
  finally { if (previous === undefined) delete process.env.SP_TEST_MODE; else process.env.SP_TEST_MODE = previous; }
  t.after(() => srv.close());
  const player = await client(t, srv, 0);
  assert.equal(player.frames.find((m) => m.t === 'welcome').testMode === true, srv.lobby.testEnabled);
  const create = player.net.request('room.create', { mode: 'coop', difficulty: 'HARD', test: true });
  if (srv.lobby.testEnabled) await create;
  else await assert.rejects(create, (error) => error.code === 'TEST_DISABLED');
});

for (const mode of ['trusted', 'trusted-force']) test(`${mode}: script owner gates and server activation stay in the primary`, { timeout: 45000 }, async (t) => {
  const fixture = scriptFixture(t, { mode });
  const activations = path.join(fixture.root, 'activations');
  fixture.put('service', 'export default () => {};', { class: 'trusted', scope: ['server'], permissions: ['trusted.server'], entry: { server: 'server.js' } }, {
    'server.js': `import fs from 'node:fs'; export function activate(api) {
      fs.appendFileSync(${JSON.stringify(activations)}, 'started\\n');
      let rooms = 0; api.lobby.on('roomCreated', () => { rooms++; api.health.extend({ rooms }); });
      api.http.route('/x/service/status', () => ({ rooms })); api.health.extend({ rooms });
    }`,
  });
  const previous = process.env.SP_PLUGIN_SCRIPTS;
  process.env.SP_PLUGIN_SCRIPTS = mode;
  let srv;
  try { srv = await startServer({ port: 0, host: '0.0.0.0', roomProcs: 2, pluginsDir: fixture.pluginsDir, quiet: true, studio: false, assetIndex: false }); }
  finally { if (previous === undefined) delete process.env.SP_PLUGIN_SCRIPTS; else process.env.SP_PLUGIN_SCRIPTS = previous; }
  t.after(() => srv.close());
  const a = await client(t, srv, 0), b = await client(t, srv, 1);
  await createRoom(a); await createRoom(b);
  if (mode === 'trusted') {
    assert.equal(fs.existsSync(activations), false);
    await assert.rejects(a.net.request('room.setPlugins', { plugins: [{ id: 'service' }] }), (error) => error.code === 'PLUGIN_TRUST_PUBLIC');
  } else {
    assert.equal(fs.readFileSync(activations, 'utf8').trim().split('\n').length, 1);
    const status = await (await fetch(`http://127.0.0.1:${srv.port}/x/service/status`)).json();
    assert.equal(status.rooms, 2, 'the primary service receives both children lobby events');
  }
});
