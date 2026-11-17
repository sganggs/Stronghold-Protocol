// test/state-delta-format.test.js — the delta state wire format (shared/stateDelta.js) on its own.
// Extracted verbatim from test/state-delta.test.js (authored by @xinhai-ai) so that the format can be merged
// and reviewed before the lobby / client wiring that consumes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffState, applyStatePatch, StateReceiver } from '../shared/stateDelta.js';
import { prepareStateFrame, negotiateStateDelta, resetStateDelta } from '../server/stateTransport.js';

const makeView = (extra = {}) => ({ t: 'm.private', playerId: 'p1', funds: 10,
  board: [{ uid: 1, row: 2, col: 3, items: [] }], padding: 'unchanged'.repeat(300), ...extra });

test('JSON exactness: object deletes/adds, nulls, array length/type changes, nested player/board fields', () => {
  const before = { t: 'm.public', removed: 2, nullable: { x: 1 }, players: [{ hp: 12, board: [null, { col: 4 }] }], empty: [] };
  const after = { t: 'm.public', added: false, nullable: null, players: [{ hp: 8, board: [null, { col: 5, dir: 'UP' }] }], empty: [1] };
  const saved = structuredClone(before);
  assert.deepEqual(applyStatePatch(before, diffState(before, after)), after);
  assert.deepEqual(before, saved);
  let seed = 17;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const value = (depth) => {
    const n = random();
    if (!depth) return [null, true, false, n, String(n)][n % 5];
    if (n % 3 === 0) return Array.from({ length: n % 5 }, () => value(depth - 1));
    if (n % 3 === 1) return Object.fromEntries(Array.from({ length: n % 5 }, (_, i) => ['k' + i, value(depth - 1)]));
    return value(0);
  };
  for (let i = 0; i < 500; i++) {
    const a = { t: 'm.private', data: value(4) }, b = { t: 'm.private', data: value(4) };
    assert.deepEqual(applyStatePatch(a, diffState(a, b)), b);
  }
});

test('unsafe/malformed patches are rejected atomically; previous views and prototypes stay intact', () => {
  const base = makeView();
  for (const op of [
    [['__proto__', 'polluted'], true], [['constructor', 'prototype', 'polluted'], true],
    [['board', -1], null], [['board', '0'], null], [['board', 0]], [['absent', 'x'], 1],
    [['t'], 'm.public'], [[], null], [['funds'], 1, 2],
  ]) {
    assert.throws(() => applyStatePatch(base, [[['funds'], 0], op]));
    assert.equal(base.funds, 10);
    assert.equal({}.polluted, undefined);
  }
  assert.equal(diffState({}, JSON.parse('{"__proto__":{"x":1}}')), null);
  assert.equal(diffState({ t: 'm.private' }, {
    t: 'm.private', ...Object.fromEntries(Array.from({ length: 4097 }, (_, i) => ['k' + i, i])),
  }), null, 'bounded op count falls back to full');
  const deep = (leaf) => { for (let i = 0; i < 70; i++) leaf = { value: leaf }; return { t: 'm.private', nested: leaf }; };
  assert.equal(diffState(deep(1), deep(2)), null, 'bounded path depth falls back to full');
});

const wire = (text) => JSON.parse(text);
const fakeWs = () => ({});

test('every frame a connection is given moves its sequence forward, full frames included', () => {
  const ws = fakeWs();
  negotiateStateDelta(ws, 1);
  const msg = { t: 'm.public', players: [{ hp: 10 }], padding: 'x'.repeat(500) };
  const first = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.equal(wire(first.data).seq, 1);
  assert.ok('full' in wire(first.data), 'the first frame of a connection is a full one');
  first.commit();

  // the same content again is still a full frame — and its number still moves forward
  const repeated = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.equal(wire(repeated.data).seq, 2);
  assert.ok('full' in wire(repeated.data));
  repeated.commit();

  // new content: a delta based on the frame the client actually holds
  msg.players[0].hp = 11;
  const delta = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.equal(wire(delta.data).seq, 3);
  assert.equal(wire(delta.data).base, 2);
  delta.commit();

  // content that goes back to an earlier encoding must not reuse that encoding's old number
  msg.players[0].hp = 10;
  const back = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.equal(wire(back.data).seq, 4, 'the number never rewinds to a snapshot created earlier');
});

test('a state frame older than the channel baseline is dropped, never applied as a new baseline', () => {
  const receiver = new StateReceiver();
  const newer = { t: 'm.public', round: 3 };
  assert.equal(receiver.receive({ kind: 'm.public', seq: 9, full: newer }).message, newer);
  // a reordered / re-sent full frame from before that baseline would rewind it and fail every following delta
  const stale = { t: 'm.public', round: 1 };
  const older = receiver.receive({ kind: 'm.public', seq: 4, full: stale });
  assert.equal(older.message, null, 'an older full frame is not a baseline');
  assert.equal(older.resync, true, 'and it blocks the channel like any other gap');
  assert.equal(receiver.receive({ kind: 'm.public', seq: 10, base: 9, patch: [] }).message, null,
    'the channel waits for a full frame instead of applying deltas to a mixed baseline');
  const recovered = { t: 'm.public', round: 4 };
  assert.equal(receiver.receive({ kind: 'm.public', seq: 11, full: recovered }).message, recovered,
    'a full frame ahead of the baseline puts it back in service');
  const next = { t: 'm.public', round: 5 };
  assert.deepEqual(receiver.receive({ kind: 'm.public', seq: 12, base: 11, patch: diffState(recovered, next) }).message, next);
  // the same number is a duplicate, and never re-emitted
  assert.equal(receiver.receive({ kind: 'm.public', seq: 12, full: next }).message, null);
});

test('only the public view is compressed today; a private view keeps the bytes it is given', () => {
  const ws = fakeWs();
  negotiateStateDelta(ws, 1);
  const view = { t: 'm.private', playerId: 'p1', funds: 10, padding: 'q'.repeat(500) };
  const encoded = JSON.stringify(view);
  const first = prepareStateFrame(ws, view, encoded);
  assert.equal(first.data, encoded, 'm.private is not a delta channel yet');
  first.commit();
  view.funds = 11;
  const next = JSON.stringify(view);
  assert.equal(prepareStateFrame(ws, view, next).data, next, 'still plain on the second frame');
});

test('a repeated hello keeps the baseline, and a reset never rewinds the sequence', () => {
  const ws = fakeWs();
  negotiateStateDelta(ws, 1);
  const msg = { t: 'm.public', players: [{ hp: 1 }], padding: 'y'.repeat(500) };
  const first = prepareStateFrame(ws, msg, JSON.stringify(msg));
  first.commit();

  negotiateStateDelta(ws, 1);                       // a repeated hello on the same connection
  msg.players[0].hp = 2;
  const second = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.equal(wire(second.data).base, wire(first.data).seq, 'the baseline survived the repeated hello');
  second.commit();

  resetStateDelta(ws);                              // a new negotiation, or a client asking for a resync
  msg.players[0].hp = 3;
  const third = prepareStateFrame(ws, msg, JSON.stringify(msg));
  assert.ok('full' in wire(third.data), 'after a reset the client gets a full frame');
  assert.ok(wire(third.data).seq > wire(second.data).seq, 'and its number is still ahead of the last one');
});

test('the browser decoder applies deltas, asks for one resync after a gap, and resumes on a full frame', () => {
  const receiver = new StateReceiver();
  const view = { t: 'm.private', funds: 10, padding: 'z'.repeat(300) };
  assert.equal(receiver.receive({ kind: 'm.private', seq: 1, full: view }).message, view);
  const next = { ...view, funds: 11 };
  const applied = receiver.receive({ kind: 'm.private', seq: 2, base: 1, patch: diffState(view, next) });
  assert.deepEqual(applied.message, next);
  assert.equal(applied.resync, false);
  const after = { ...next, funds: 12 };
  assert.deepEqual(receiver.receive({ kind: 'm.private', seq: 3, base: 2, patch: diffState(next, after) }).message, after);
  assert.equal(receiver.receive({ kind: 'm.private', seq: 3, base: 2, patch: diffState(next, after) }).message, null,
    'the same frame twice is never emitted twice');

  // a lost frame: the next delta cannot be applied, so the channel waits for a full frame
  const lost = receiver.receive({ kind: 'm.private', seq: 6, base: 5, patch: [] });
  assert.equal(lost.message, null);
  assert.equal(lost.resync, true, 'the gap asks for a resync');
  assert.equal(receiver.receive({ kind: 'm.public', seq: 9, base: 8, patch: [] }).resync, false,
    'one resync request covers every channel');
  assert.equal(receiver.receive({ kind: 'm.private', seq: 7, base: 6, patch: [] }).resync, false,
    'and further deltas do not ask again while the channel is blocked');

  const resumed = receiver.receive({ kind: 'm.private', seq: 8, full: after });
  assert.equal(resumed.message, after, 'the full frame puts the channel back in service');
  const later = { ...after, funds: 13 };
  assert.deepEqual(receiver.receive({ kind: 'm.private', seq: 9, base: 8, patch: diffState(after, later) }).message, later);
});

test('a connection that did not negotiate keeps the frames it gets today', () => {
  const ws = fakeWs();
  const encoded = JSON.stringify({ t: 'm.private', funds: 1 });
  const plain = prepareStateFrame(ws, { t: 'm.private' }, encoded);
  assert.equal(plain.data, encoded, 'the encoded message goes out untouched');
  plain.commit();                                   // a no-op: nothing was baselined

  negotiateStateDelta(ws, 2);                       // a version this server does not speak
  assert.equal(prepareStateFrame(ws, { t: 'm.private' }, encoded).data, encoded);

  const receiver = new StateReceiver();
  assert.deepEqual(receiver.receive({ t: 'm.private', funds: 1 }), { message: null, resync: false },
    'a message without a kind/seq is not a state frame');
  assert.deepEqual(receiver.receive({ kind: 'm.private' }), { message: null, resync: true },
    'a state frame that cannot be used blocks the channel and asks for a full one');
});
