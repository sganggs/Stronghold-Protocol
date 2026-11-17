// test/ui/skins-sync.test.js — the 干员皮肤 sync on a content change (ui/loadoutSync.js installSkinsSync, versions M1):
// the server keeps only the operators of the data the room plays (server/lobby.js skins), on the session too, so the
// page sends the map filtered to the operators of the data on screen. A skin for an operator only one version has
// (char_198_blackd: 第一期, not 第二期下半) reaches room.skins after the switch to that version; a content change that
// keeps the same operators spends no heavy message. Controlled timers and a fake net (as test/ui/card-sync.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../public/js/store.js';
import { installSkinsSync, SYNC_DEBOUNCE_MS } from '../../public/js/ui/loadoutSync.js';
import { SKINS_KEY, SKINS_SYNC_KEY } from '../../public/js/ui/skins.js';

const ticks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const BOTH = 'char_003_kalts', V1_ONLY = 'char_198_blackd';
const DEFAULT_OPS = new Set([BOTH, 'char_2_b']);
const V1_OPS = new Set([BOTH, V1_ONLY]);
const SKINS = { [BOTH]: `${BOTH}@s#1`, [V1_ONLY]: `${V1_ONLY}@s#2` };

function harness({ skins = SKINS, ops = DEFAULT_OPS } = {}) {
  const listeners = new Map(), pending = new Map();
  let time = 0, timerId = 0;
  const timers = {
    setTimeout(fn, ms) { const id = ++timerId; pending.set(id, { fn, at: time + ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms) {
      time += ms;
      for (const [id, task] of [...pending]) if (task.at <= time) { pending.delete(id); task.fn(); await ticks(); }
      await ticks();
    },
  };
  const net = {
    status: 'online', sent: [],
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    emit(name, msg = {}) { listeners.get(name)?.(msg); },
    async request(t, fields) { net.sent.push({ t, ...fields }); return { t: 'ok' }; },
  };
  let shown = ops;
  const content = createStore({ cs: null, status: 'idle' });
  const target = createStore({ [SKINS_KEY]: skins, [SKINS_SYNC_KEY]: 'idle' });
  const sync = installSkinsSync({ net, timers, target, content, operatorsReady: async () => shown });
  return { net, timers, target, content, show: (o) => { shown = o; }, ...sync };
}

test('skins sync: a skin for an operator only the new version has reaches room.skins after the switch', async (t) => {
  const h = harness();
  t.after(h.dispose);
  await h.flush();
  assert.deepEqual(h.net.sent, [{ t: 'room.skins', skins: { [BOTH]: SKINS[BOTH] } }], '第二期下半: only its operators (the server keeps the same)');
  // the room switches to 第一期下半 (or the player joins one): its set arrives with char_198_blackd
  h.content.set({ cs: 'a'.repeat(64), status: 'loading' });
  h.show(V1_OPS);
  h.content.set({ cs: 'a'.repeat(64), status: 'ready' });
  await h.timers.advance(50);
  assert.deepEqual(h.net.sent.at(-1), { t: 'room.skins', skins: SKINS }, 'the 第一期 operator\'s skin goes out');
  assert.equal(h.net.sent.length, 2);
  assert.deepEqual(h.target.get()[SKINS_KEY], SKINS, 'the pref keeps every skin');
  // back to 第二期下半: the kept set changes again
  h.show(DEFAULT_OPS);
  h.content.set({ cs: null, status: 'idle' });
  await h.timers.advance(50);
  assert.deepEqual(h.net.sent.at(-1), { t: 'room.skins', skins: { [BOTH]: SKINS[BOTH] } });
  assert.equal(h.target.get()[SKINS_SYNC_KEY], 'synced');
});

test('skins sync: a content change that keeps the same operators sends nothing (heavy-message budget)', async (t) => {
  const h = harness();
  t.after(h.dispose);
  await h.flush();
  assert.equal(h.net.sent.length, 1);
  h.show(new Set([...DEFAULT_OPS, 'char_9_other']));
  h.content.set({ cs: 'b'.repeat(64), status: 'ready' });
  await h.timers.advance(50);
  assert.equal(h.net.sent.length, 1, 'same kept map: not sent again');
  // an edit still goes out
  h.target.set({ [SKINS_KEY]: { [BOTH]: `${BOTH}@s#3` } });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.deepEqual(h.net.sent.at(-1), { t: 'room.skins', skins: { [BOTH]: `${BOTH}@s#3` } });
});

test('skins sync: without the data the map goes whole (the server filters it); an empty map needs no data', async (t) => {
  const h = harness({ ops: null });
  t.after(h.dispose);
  await h.flush();
  assert.deepEqual(h.net.sent.at(-1), { t: 'room.skins', skins: SKINS });
  let asked = 0;
  const e = harness({ skins: {} });
  t.after(e.dispose);
  e.show({ has: () => { asked++; return true; } });
  await e.flush();
  assert.deepEqual(e.net.sent, [{ t: 'room.skins', skins: {} }]);
  assert.equal(asked, 0);
});
