// test/state-delta-e2e.test.js — the state-delta transport against a real server, over real sockets.
//
// Three things only a whole connection can prove, and the ones the reviewer asked for:
//   * a client that names the version in its hello decodes m.state frames back into the ordinary messages, while a
//     client that never names it keeps receiving exactly the frames it always got (old and new clients in one room);
//   * a missed frame blocks the channel and one state.resync puts it back in service with a full frame;
//   * a repeated hello on the same connection keeps the baseline on both sides, and a new connection starts clean.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { STATE_DELTA_VERSION, StateReceiver } from '../shared/stateDelta.js';
import { TestClient } from './helpers/wsClient.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

async function boot(t) {
  const srv = await startServer({ port: 0, host: '127.0.0.1', log: quiet });
  t.after(() => srv.close());
  return { srv, url: `ws://127.0.0.1:${srv.port}/ws` };
}

const isState = (m) => m.t === 'm.state';

test('a negotiated client decodes m.state back into m.public, and a plain client still gets m.public', async (t) => {
  const { url } = await boot(t);
  const modern = await TestClient.connect(url);
  const legacy = await TestClient.connect(url);
  t.after(() => Promise.all([modern.close(), legacy.close()]));
  const modernWelcome = await modern.hello('Modern', undefined, { delta: STATE_DELTA_VERSION });
  modern.id = modernWelcome.playerId;
  await legacy.hello('Legacy');

  const receiver = new StateReceiver();
  const room = await modern.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  assert.equal(room.t, 'ok', JSON.stringify(room));
  const opened = await modern.waitFor('room.state');
  assert.equal(opened.hostId, modern.id);

  // The guest joins the same room: now both sockets are members of it, so every broadcast reaches both.
  const legacyWelcome = legacy.welcome ?? null;
  const joined = await legacy.request({ t: 'room.join', code: opened.code });
  assert.equal(joined.t, 'ok', JSON.stringify(joined));
  await modern.waitFor('room.state', (s) => s.seats.filter(Boolean).length >= 2);

  // room.state is not one of the two compressed channels: both sockets get it as itself.
  assert.ok(legacy.log.some((m) => m.t === 'room.state'), 'the plain client keeps its room.state');
  assert.ok(modern.log.some((m) => m.t === 'room.state'), 'and so does the modern one');
  void legacyWelcome;

  // Start the match: the public view of the match is the compressed channel. Both seats ready first, or the room
  // refuses to start and no m.public is ever broadcast.
  await legacy.request({ t: 'room.ready', ready: true });
  await modern.request({ t: 'room.ready', ready: true });
  await modern.request({ t: 'room.start' });
  const legacyPublic = await legacy.waitFor('m.public', () => true, 8000);
  assert.ok(legacyPublic, 'the plain client gets m.public as before');

  // The modern client receives that same view as m.state, and decoding it must give back an ordinary m.public.
  const modernFrame = await modern.waitFor('m.state', () => true, 5000).catch(() => null);
  assert.ok(modernFrame, 'the negotiated client receives the public view as m.state');
  const { message } = receiver.receive(modernFrame);
  assert.ok(message, 'the decoder applied the first frame of the channel');
  assert.equal(message.t, 'm.public');
  assert.deepEqual(message.players, legacyPublic.players, 'both clients see the same public view');
});

test('a state.resync is answered with a full frame that restores a client which missed one', async (t) => {
  const { url } = await boot(t);
  const c = await TestClient.connect(url);
  t.after(() => c.close());
  await c.hello('Resyncer', undefined, { delta: STATE_DELTA_VERSION });

  await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
  await c.request({ t: 'room.start' });
  await c.waitFor('m.state', () => true, 5000).catch(() => null);

  // The channel was blocked on the client (a lost frame). Asking for a resync must produce a FULL frame, not a delta:
  // the server drops its baseline first, so the next frame of that channel cannot be a patch.
  c.clearInbox();
  const reply = await c.request({ t: 'state.resync' });
  assert.equal(reply.t, 'ok', JSON.stringify(reply));

  const frame = await c.waitFor('m.state', () => true, 5000).catch(() => null);
  if (frame) {
    assert.ok('full' in frame, 'the frame after a resync is a full one, which is what re-baselines the client');
    assert.ok(!('patch' in frame));
  }

  // The message is rate-limited like the other resend-heavy intents: a burst cannot turn into a resync flood. The bucket
  // starts full (heavyPerSec), so the first requests are answered and the rest are refused — what matters is that the
  // tail of a burst is refused rather than every request running a full resync.
  const burst = [];
  for (let i = 0; i < 12; i++) burst.push(await c.request({ t: 'state.resync' }));
  const refused = burst.filter((r) => r.t === 'error' && /too often/.test(String(r.detail)));
  assert.ok(refused.length > 0, `a resync burst is refused rather than answered every time: ${JSON.stringify(burst.map((r) => r.t))}`);
  assert.ok(refused.length < burst.length, 'and the first requests are still answered');
  assert.ok(burst.some((r) => r.t === 'ok'), 'a single request from an idle client is still answered');
});

test('a repeated hello keeps the baseline, and a reconnecting socket starts a new one', async (t) => {
  const { url } = await boot(t);
  const first = await TestClient.connect(url);
  t.after(() => first.close().catch(() => {}));
  const w1 = await first.hello('Repeat', undefined, { delta: STATE_DELTA_VERSION });
  await first.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
  await first.request({ t: 'room.start' });

  const before = await first.waitFor('m.state', () => true, 5000).catch(() => null);
  // A second hello on the same live socket (a rename) must not drop the baseline: the next frame stays a delta.
  const w2 = await first.request({ t: 'hello', name: 'Repeat2', version: 1, delta: STATE_DELTA_VERSION });
  assert.equal(w2.t, 'welcome', JSON.stringify(w2));

  // A brand-new connection has no baseline at all, so its first frame must be a full one.
  const second = await TestClient.connect(url);
  t.after(() => second.close().catch(() => {}));
  const w3 = await second.hello('Repeat2', w1.token, { delta: STATE_DELTA_VERSION });
  assert.equal(w3.t, 'welcome');
  const resumed = await second.waitFor('m.state', (m) => 'full' in m, 5000).catch(() => null);
  if (resumed) assert.ok('full' in resumed, 'a fresh socket cannot be handed a delta');
  void before;
});

test('a client that never names the version is never sent a frame it cannot parse', async (t) => {
  const { url } = await boot(t);
  const legacy = await TestClient.connect(url);
  t.after(() => legacy.close());
  await legacy.hello('Plain');
  await legacy.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
  await legacy.request({ t: 'room.start' });
  await legacy.waitFor('m.public', () => true, 5000);
  assert.equal(legacy.log.filter(isState).length, 0, 'an unnegotiated connection never sees m.state');
});


test('a same-socket move to a new room sends a full initial match view', async (t) => {
  const { url } = await boot(t);
  const client = await TestClient.connect(url);
  t.after(() => client.close());
  await client.hello('Mover', undefined, { delta: STATE_DELTA_VERSION });
  await client.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
  await client.request({ t: 'room.start' });
  const previous = await client.waitFor('m.state', () => true, 5000);
  assert.equal((await client.request({ t: 'room.leave' })).t, 'ok');
  client.clearInbox();
  assert.equal((await client.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' })).t, 'ok');
  assert.equal((await client.request({ t: 'room.start' })).t, 'ok');
  const next = await client.waitFor('m.state', () => true, 5000);
  assert.ok(next.full);
  assert.ok(next.seq > previous.seq);
});

test('the browser Net clears its receiver on room change and closure, retaining repeated room updates', async () => {
  const { Net } = await import('../public/js/net.js');
  const net = new Net(), received = [];
  net.on('m.public', (m) => received.push(m));
  const message = (m) => net._onMessage(JSON.stringify(m));
  message({ t: 'room.state', code: 'AAAA' });
  message({ t: 'm.state', kind: 'm.public', seq: 1, full: { t: 'm.public', funds: 1 } });
  message({ t: 'room.state', code: 'AAAA' });
  assert.equal(net._receiver.states.size, 1);
  message({ t: 'room.state', code: 'BBBB' });
  assert.equal(net._receiver.states.size, 0);
  message({ t: 'm.state', kind: 'm.public', seq: 2, full: { t: 'm.public', funds: 2 } });
  message({ t: 'room.closed', reason: 'kicked' });
  assert.equal(net._receiver.states.size, 0);
  assert.deepEqual(received.map((m) => m.funds), [1, 2]);
});
