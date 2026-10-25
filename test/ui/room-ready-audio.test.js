// Room readiness is a shared cue: every client hears an accepted false -> true transition,
// while snapshots, cancellations and room/match lifecycle changes stay silent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audio, installAudio } from '../../public/js/audio.js';
import { createStore } from '../../public/js/store.js';

const seat = (playerId, ready = false, extra = {}) => ({ playerId, ready, isBot: false, ...extra });
const room = (seats, extra = {}) => ({ code: 'ABCD', mode: 'coop', inMatch: false, seats, ...extra });

function listen(initialRoom, check, extra = {}) {
  const store = createStore({ connection: { status: 'online' }, ui: { restoring: false }, room: initialRoom, ...extra });
  const calls = [];
  const oldSfx = audio.sfx, oldBgm = audio.playBgm;
  audio.sfx = (key) => calls.push(key);
  audio.playBgm = () => {};
  const stop = installAudio({ getManifest: () => null, getState: store.get, subscribe: store.subscribe, selectRoute: () => 'room' });
  try { check(store, calls); } finally { stop(); audio.sfx = oldSfx; audio.playBgm = oldBgm; }
}

test('each room member hears the ready cue once, including the player who readied', () => {
  for (const me of ['host', 'guest', 'spectator']) {
    listen(room([seat('host'), seat('guest')]), (s, calls) => {
      s.set({ room: room([seat('host'), seat('guest', true)]) });
      assert.deepEqual(calls, ['ready'], me);
      s.set({ room: room([seat('host'), seat('guest', true)]) });
      s.set({ connection: { status: 'online', ping: 12 } });
      assert.deepEqual(calls, ['ready'], 'duplicate room snapshots and ping updates do not replay');
      s.set({ room: room([seat('host'), seat('guest')]) });
      assert.deepEqual(calls, ['ready'], 'cancelling is silent');
      s.set({ room: room([seat('host'), seat('guest', true)]) });
      assert.deepEqual(calls, ['ready', 'ready'], 'a later accepted ready is heard again');
    }, { me: { playerId: me } });
  }
});

test('initial and other-room snapshots do not announce an existing ready state', () => {
  listen(room([seat('host'), seat('guest', true)]), (s, calls) => {
    assert.deepEqual(calls, []);
    s.set({ room: room([seat('host'), seat('guest', true)]) });
    s.set({ room: null });
    s.set({ room: room([seat('host'), seat('guest', true)]) });
    s.set({ room: room([seat('host'), seat('guest', true)], { code: 'EFGH' }) });
    assert.deepEqual(calls, []);
  });
});

test('rapid cancel/re-ready cycles have no time-based cooldown', () => {
  listen(room([seat('host'), seat('guest')]), (s, calls) => {
    for (let i = 0; i < 25; i++) {
      s.set({ room: room([seat('host'), seat('guest', true)]) });
      s.set({ room: room([seat('host'), seat('guest')]) });
    }
    assert.deepEqual(calls, Array(25).fill('ready'), 'all accepted edges sound in the same synchronous turn');
  });
});

test('adding AI, joining ready seats and replacing a seat do not sound like a ready action', () => {
  listen(room([seat('host'), seat('guest')]), (s, calls) => {
    s.set({ room: room([seat('host'), seat('guest'), seat('ai', true, { isBot: true })]) });
    s.set({ room: room([seat('host'), seat('guest'), seat('new', true)]) });
    s.set({ room: room([seat('host'), seat('replacement', true), seat('new', true)]) });
    s.set({ room: room([seat('host'), seat('replacement', true, { connected: false }), seat('new', true)]) });
    s.set({ room: room([seat('host'), seat('replacement', true, { connected: true }), seat('new', true)]) });
    assert.deepEqual(calls, []);
  });
});

test('offline changes and post-welcome restoration do not replay missed ready actions', () => {
  listen(room([seat('host'), seat('guest')]), (s, calls) => {
    s.set({ connection: { status: 'offline' } });
    s.set({ room: room([seat('host'), seat('guest', true)]) });
    s.set({ connection: { status: 'online' }, room: room([seat('host'), seat('guest')]) });
    s.set({ ui: { restoring: true } });
    s.set({ room: room([seat('host'), seat('guest', true)]) });
    s.set({ ui: { restoring: false }, room: room([seat('host'), seat('guest')]) });
    assert.deepEqual(calls, []);
    s.set({ room: room([seat('host'), seat('guest', true)]) });
    assert.deepEqual(calls, ['ready'], 'live actions after restoration still sound');
  });
});

test('match start, return from a match and solo rooms do not use the waiting-room cue', () => {
  listen(room([seat('host'), seat('guest')]), (s, calls) => {
    s.set({ room: room([seat('host', true), seat('guest', true)], { inMatch: true }) });
    s.set({ room: room([seat('host'), seat('guest')]) });
    s.set({ room: room([seat('host'), seat('guest')], { mode: 'solo' }) });
    s.set({ room: room([seat('host'), seat('guest', true)], { mode: 'solo' }) });
    assert.deepEqual(calls, []);
  });
});
