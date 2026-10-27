// Real quitMatch/store; only request replies are adapted. No browser or natural outage claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quitMatch } from '../../public/js/ui/matchChrome.js';
import { net } from '../../public/js/net.js';
import { store, initialState, emptyMatch } from '../../public/js/store.js';

function setup(t, reply) {
  const previous = store.get();
  const room = { code: 'QTES', mode: 'solo', inMatch: true };
  const match = { ...emptyMatch(), public: { phase: 'INFO_CHECK', players: [] } };
  store.set({ ...initialState, room, match });
  t.after(() => store.set(previous));
  const sent = [];
  t.mock.method(net, 'request', async (type) => { sent.push(type); return reply(type); });
  return { room, match, sent };
}
const refuse = (code) => { throw Object.assign(new Error(code), { code }); };

test('a timed-out match leave keeps the current match and does not proceed to room leave', async (t) => {
  const s = setup(t, () => refuse('TIMEOUT'));
  await quitMatch();
  assert.equal(store.get().room, s.room);
  assert.equal(store.get().match.public, s.match.public);
  assert.deepEqual(s.sent, ['g.leave']);
});

test('offline is a failed request, not evidence that the server already released the seat', async (t) => {
  const s = setup(t, () => refuse('OFFLINE'));
  await quitMatch();
  assert.equal(store.get().room, s.room);
  assert.equal(store.get().match.public, s.match.public);
  assert.deepEqual(s.sent, ['g.leave']);
});

test('failed room leave after WRONG_PHASE preserves the latest waiting-room state', async (t) => {
  const waiting = { code: 'QTES', mode: 'solo', inMatch: false };
  const s = setup(t, (type) => {
    if (type === 'g.leave') { store.set({ room: waiting, match: emptyMatch() }); return refuse('WRONG_PHASE'); }
    return refuse('TIMEOUT');
  });
  await quitMatch();
  assert.equal(store.get().room, waiting, 'do not clear the latest view or restore the old match');
  assert.equal(store.get().match.public, null);
  assert.deepEqual(s.sent, ['g.leave', 'room.leave']);
});

test('an acknowledged match leave clears context without a redundant room request', async (t) => {
  const s = setup(t, () => ({ t: 'ok' }));
  await quitMatch();
  assert.equal(store.get().room, null);
  assert.equal(store.get().match.public, null);
  assert.deepEqual(s.sent, ['g.leave']);
});

test('already absent server context remains an idempotent successful exit', async (t) => {
  const s = setup(t, () => refuse('NOT_IN_ROOM'));
  await quitMatch();
  assert.equal(store.get().room, null);
  assert.equal(store.get().match.public, null);
  assert.deepEqual(s.sent, ['g.leave']);
});

test('wrong match phase followed by an accepted room leave still clears context', async (t) => {
  const s = setup(t, type => type === 'g.leave' ? refuse('WRONG_PHASE') : { t: 'ok' });
  await quitMatch();
  assert.equal(store.get().room, null);
  assert.equal(store.get().match.public, null);
  assert.deepEqual(s.sent, ['g.leave', 'room.leave']);
});

test('an acknowledged departure is conclusive even when a redundant request would disconnect', async (t) => {
  const s = setup(t, type => type === 'g.leave' ? { t: 'ok' } : refuse('DISCONNECTED'));
  await quitMatch();
  assert.equal(store.get().room, null);
  assert.equal(store.get().match.public, null);
  assert.deepEqual(s.sent, ['g.leave']);
});
