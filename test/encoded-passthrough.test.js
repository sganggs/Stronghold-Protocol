// test/encoded-passthrough.test.js — already-encoded frames go out as they are, and state kinds keep their baseline.
//
// Two costs sat on the same line of every match frame: encoding an object the sender already had bytes for, and (for
// m.state) recomputing a delta against a baseline nobody recorded. send(ws, msg, encoded) takes the bytes as given and
// hands state kinds to the delta transport, which only advances a connection's baseline after the frame was queued.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { send, sendSession } from '../server/net.js';
import { negotiateStateDelta, resetStateDelta } from '../server/stateTransport.js';

const socket = () => ({ readyState: 1, bufferedAmount: 0, frames: [], send(data) { this.frames.push(data); } });
const poison = (obj) => ({ ...obj, toJSON() { throw new Error('main thread re-encoded an already encoded frame'); } });

test('an encoded frame is sent verbatim and never re-serialized', () => {
  const ws = socket();
  const bytes = '{"t":"m.public","marker":"worker-encoded"}';
  assert.equal(send(ws, poison({ t: 'm.public', marker: 'worker-encoded' }), bytes), true);
  assert.equal(ws.frames[0], bytes);
  assert.equal(ws.frames.length, 1);
});

test('without encoded bytes the object is still encoded as before', () => {
  const ws = socket();
  assert.equal(send(ws, { t: 'm.public', marker: 'x' }), true);
  assert.deepEqual(JSON.parse(ws.frames[0]), { t: 'm.public', marker: 'x' });
});

test('sendSession forwards the encoded bytes to the current socket', () => {
  const ws = socket();
  const bytes = '{"t":"m.private","playerId":"p_0"}';
  assert.equal(sendSession({ connected: true, ws }, poison({ t: 'm.private' }), bytes), true);
  assert.equal(ws.frames[0], bytes);
  assert.equal(sendSession({ connected: false, ws }, { t: 'm.private' }, bytes), false, 'disconnected sessions stay a no-op');
});

test('a negotiated connection gets a delta and only advances its baseline after a successful send', () => {
  const ws = socket();
  negotiateStateDelta(ws, 1);
  const first = { t: 'm.public', funds: 10, board: [1, 2, 3] };
  assert.equal(send(ws, first), true);
  const full = JSON.parse(ws.frames[0]);
  assert.equal(full.t, 'm.state');
  assert.deepEqual(full.full, { t: 'm.public', funds: 10, board: [1, 2, 3] }, 'the first frame is a full snapshot');

  const second = { t: 'm.public', funds: 11, board: [1, 2, 3] };
  assert.equal(send(ws, second), true);
  const patch = JSON.parse(ws.frames[1]);
  assert.equal(patch.t, 'm.state');
  assert.ok(Array.isArray(patch.patch) && patch.patch.length, 'the second frame is a patch');
  assert.ok(!('full' in patch));

  // a socket that refuses the frame must not move the baseline: the next frame is still relative to the last good one
  const dead = { readyState: 3, bufferedAmount: 0, frames: [], send() { throw new Error('closed'); } };
  negotiateStateDelta(dead, 1);
  assert.equal(send(dead, first), false);
  assert.equal(send(dead, second), false);
  assert.equal(dead.frames.length, 0);

  resetStateDelta(ws);
});

test('pre-encoded bytes that are not JSON fall back to a full frame instead of breaking the send path', () => {
  const ws = socket();
  negotiateStateDelta(ws, 1);
  // a lane worker can hand back anything: it must not throw here, and the client still gets a usable frame
  assert.equal(send(ws, { t: 'm.public', funds: 10 }, 'not json at all'), true);
  assert.deepEqual(JSON.parse(ws.frames[0]), { t: 'm.public', funds: 10 }, 'the full frame is encoded here instead');

  // and no baseline was taken from the garbage: the next frame starts the connection at seq 1
  assert.equal(send(ws, { t: 'm.public', funds: 11 }, '{"t":"m.public","funds":11}'), true);
  const frame = JSON.parse(ws.frames[1]);
  assert.equal(frame.t, 'm.state');
  assert.equal(frame.seq, 1);
  assert.ok('full' in frame, 'the first usable frame of the connection is a full one');
});

test('valid JSON that is not this state object is treated the same way', () => {
  const ws = socket();
  negotiateStateDelta(ws, 1);
  assert.equal(send(ws, { t: 'm.public', funds: 1 }, '[1,2,3]'), true);
  assert.deepEqual(JSON.parse(ws.frames[0]), { t: 'm.public', funds: 1 });
  assert.equal(send(ws, { t: 'm.public', funds: 2 }, 'null'), true);
  assert.deepEqual(JSON.parse(ws.frames[1]), { t: 'm.public', funds: 2 });
});

test('a connection that never negotiated still gets the bytes it was handed, valid or not', () => {
  const ws = socket();
  assert.equal(send(ws, { t: 'm.public', funds: 1 }, 'not json'), true);
  assert.equal(ws.frames[0], 'not json', 'nothing is re-encoded for a connection that did not negotiate');
});


test('the same socket changing rooms starts a full baseline without rewinding its sequence', () => {
  const ws = socket(), session = { connected: true, ws, roomCode: 'AAAA' };
  negotiateStateDelta(ws, 1);
  const pub = (funds) => ({ t: 'm.public', funds, padding: 'x'.repeat(500) });
  sendSession(session, pub(10));
  sendSession(session, pub(11));
  const last = JSON.parse(ws.frames.at(-1));
  assert.ok(last.patch);
  session.roomCode = 'BBBB';
  sendSession(session, pub(12));
  const next = JSON.parse(ws.frames.at(-1));
  assert.ok(next.full);
  assert.ok(next.seq > last.seq);
});
