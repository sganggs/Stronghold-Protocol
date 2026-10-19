import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPeer } from '../../server/rooms/peer.js';
import { createRoomUpdates } from '../../server/rooms/updates.js';
import { ignoreRoomSignals } from '../../server/rooms/signals.js';

test('room child signal handlers leave shutdown orchestration with the primary', () => {
  const signals = new EventEmitter();
  const remove = ignoreRoomSignals(signals);
  assert.equal(signals.emit('SIGINT'), true);
  assert.equal(signals.emit('SIGTERM'), true);
  remove();
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

for (const ending of ['close', 'disconnect']) test(`closed room IPC ignores late publication after ${ending}`, async () => {
  const channel = new EventEmitter(), sent = [], directory = new Map();
  channel.connected = true;
  channel.send = (value, done) => { sent.push(value); done(); };
  const peer = createPeer(channel, { publish: (value) => { directory.set(value.code, value); return true; } });
  const deliver = (code, id) => channel.emit('message', { channel: 'rooms', method: 'publish', id, value: { code } });
  deliver('LIVE', 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(directory.has('LIVE'), true, 'a live handler and reply remain available');
  assert.deepEqual(sent[0], { channel: 'rooms', reply: 1, value: true });
  const pending = peer.request('health');
  const rejection = assert.rejects(pending, /disconnected/);
  const request = sent.at(-1);
  if (ending === 'close') peer.close();
  else { channel.connected = false; channel.emit('disconnect'); }
  await rejection;
  const before = sent.length;
  // Injected EventEmitter delivery exercises a closed channel; it does not reproduce an operating-system race.
  deliver('LATE', 2);
  channel.emit('message', { channel: 'rooms', reply: request.id, value: 'obsolete' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(directory.has('LATE'), false, 'a closed peer cannot repopulate the directory');
  assert.equal(sent.length, before);
  await assert.rejects(peer.request('health'), /unavailable/);
  peer.close();
});

test('closed admission notifications bypass a full request queue', async () => {
  const channel = new EventEmitter(), sent = [];
  channel.connected = true;
  channel.send = (value, done) => { sent.push(value); done(); };
  const peer = createPeer(channel);
  const waiting = Array.from({ length: 1024 }, () => peer.request('held').catch(() => {}));
  await assert.rejects(peer.request('overflow'), /unavailable/);
  await peer.notify('closed', { admission: 17 });
  assert.deepEqual(sent.at(-1), { channel: 'rooms', method: 'closed', value: { admission: 17 } });
  for (let admission = 0; admission < 2048; admission++) await peer.notify('closed', { admission });
  assert.equal(sent.filter((m) => m.method === 'closed').length, 2049, 'mass disconnects cannot lose releases to the ordinary cap');
  const completed = peer.request('endBegin', { code: 'TEST' }, 1000, { critical: true });
  channel.emit('message', { channel: 'rooms', reply: sent.at(-1).id, value: true });
  assert.equal(await completed, true, 'critical admission cleanup remains available at the ordinary cap');
  peer.close(); await Promise.all(waiting);
});

test('incremental updates coalesce, retry failed delivery and retain newer changes', async (t) => {
  const sent = [];
  let rejectFirst, attempts = 0;
  const blocked = new Promise((_resolve, reject) => { rejectFirst = reject; });
  const updates = createRoomUpdates({ notify(method, value) {
    assert.equal(method, 'update'); sent.push(value);
    return ++attempts === 1 ? blocked : Promise.resolve();
  } }, { retryMs: 1 });
  t.after(() => updates.close());
  const wait = async (n) => {
    const until = Date.now() + 1000;
    while (sent.length < n && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(sent.length, n);
  };
  updates.session({ playerId: 'p_a', name: 'first', ws: {} });
  updates.session({ playerId: 'p_a', name: 'second', ws: {} });
  updates.session({ playerId: 'p_b', name: 'other', ws: {} });
  await wait(1);
  assert.deepEqual(sent[0].sessions, [['p_a', { playerId: 'p_a', name: 'second' }], ['p_b', { playerId: 'p_b', name: 'other' }]]);
  updates.session({ playerId: 'p_a', name: 'latest', ws: {} });
  assert.deepEqual(updates.snapshot().sessions, [['p_a', { playerId: 'p_a', name: 'latest' }], ['p_b', { playerId: 'p_b', name: 'other' }]],
    'a completion piggybacks both in-flight changes and newer dirty values');
  rejectFirst(new Error('IPC queue failure'));
  await wait(2);
  assert.equal(sent[1].sessions.find(([id]) => id === 'p_a')[1].name, 'latest');
  updates.session({ playerId: 'p_a', name: 'latest', ws: {} });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sent.length, 2, 'an unchanged identity produces no IPC update');
  updates.session({ playerId: 'p_b' }, true);
  await wait(3);
  assert.deepEqual(sent[2], { sessions: [['p_b', null]], rooms: [] });
});
