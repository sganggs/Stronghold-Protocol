// test/ui/card-sync.test.js — the 名片干员 sync (ui/loadoutSync.js installCardSync, review of PR #813): room.card goes out
// after a pick, after every welcome and when the room's content set arrives or goes; a pick the shown data does not list
// goes out as '' (默认, as one's own card draws it) while the pref keeps it; RATE / TIMEOUT / OFFLINE are retried (the
// room screen's own effect used to give up after them, so teammates kept the old card); BAD_MSG is final. The list is
// the picker's (ui/seatArt.js cardOperators): the 自选编队 pool joins it through backups.json (#877, review of PR #894).
// Controlled timers and a fake net; the real screen route is the same engine (installPrefSync).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../public/js/store.js';
import { installCardSync, SYNC_DEBOUNCE_MS, RETRY_MS } from '../../public/js/ui/loadoutSync.js';
import { CARD_KEY, CARD_SYNC_KEY } from '../../public/js/ui/seatArt.js';

const ticks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const CHESS = [
  { chessId: 'chess_a', charId: 'char_1_a', rarity: 6, name: 'A' },
  { chessId: 'chess_b', charId: 'char_2_b', rarity: 5, name: 'B' },
  { chessId: 'chess_h', charId: 'char_3_h', rarity: 6, name: 'H', visible: false },
];
// 自选编队 pool (#877): an operator outside chess.json, named and rated by backups.diy.operators
const BACKUPS = { diy: { ownedPool: ['char_9_pool'], operators: { char_9_pool: { name: 'P', rarity: 6 } } } };

function harness({ card = '', chess = CHESS, backups = BACKUPS } = {}) {
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
    status: 'online', sent: [], failures: [],
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); },
    emit(name, msg = {}) { listeners.get(name)?.(msg); },
    async request(t, fields) {
      net.sent.push({ t, ...fields });
      const code = net.failures.shift();
      if (code) throw Object.assign(new Error(code), { code });
      return { t: 'ok' };
    },
  };
  let list = chess;
  let bk = backups;
  const content = createStore({ cs: null, status: 'idle' });
  const target = createStore({ [CARD_KEY]: card, [CARD_SYNC_KEY]: 'idle' });
  const sync = installCardSync({
    net, timers, target, content,
    getChessReady: async () => list, listChess: () => list,
    getBackupsReady: async () => bk, listBackups: () => bk,
  });
  return { net, timers, target, content, setList: (l) => { list = l; }, setBackups: (b) => { bk = b; }, ...sync };
}

test('card sync: a pick goes out after the debounce; a welcome sends it again', async (t) => {
  const h = harness();
  t.after(h.dispose);
  h.target.set({ [CARD_KEY]: 'char_1_a' });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.deepEqual(h.net.sent, [{ t: 'room.card', charId: 'char_1_a' }]);
  assert.equal(h.target.get()[CARD_SYNC_KEY], 'synced');
  h.net.emit('welcome');
  await h.timers.advance(50);
  assert.deepEqual(h.net.sent.at(-1), { t: 'room.card', charId: 'char_1_a' }, 'a new or resumed session gets it again');
  assert.equal(h.net.sent.length, 2);
});

test('card sync: RATE, TIMEOUT and OFFLINE are retried until the server takes the pick', async (t) => {
  const h = harness();
  t.after(h.dispose);
  h.net.failures.push('RATE', 'TIMEOUT', 'OFFLINE');
  h.target.set({ [CARD_KEY]: 'char_2_b' });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  for (let i = 0; i < 3; i++) await h.timers.advance(RETRY_MS);
  assert.equal(h.net.sent.length, 4, JSON.stringify(h.net.sent));
  assert.ok(h.net.sent.every((m) => m.t === 'room.card' && m.charId === 'char_2_b'));
  assert.equal(h.target.get()[CARD_SYNC_KEY], 'synced');
});

test('card sync: BAD_MSG is final — no retry loop, the state says error', async (t) => {
  const h = harness();
  t.after(h.dispose);
  h.net.failures.push('BAD_MSG');
  const warn = console.warn;
  console.warn = () => {};
  t.after(() => { console.warn = warn; });
  h.target.set({ [CARD_KEY]: 'char_1_a' });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  await h.timers.advance(RETRY_MS * 3);
  assert.equal(h.net.sent.length, 1);
  assert.equal(h.target.get()[CARD_SYNC_KEY], 'error');
});

test('card sync: a pick the shown data does not list goes out as 默认 (\'\'), and as itself once a content set lists it', async (t) => {
  const h = harness({ card: 'char_x_plugin' });
  t.after(h.dispose);
  await h.flush();
  assert.deepEqual(h.net.sent, [{ t: 'room.card', charId: '' }], 'unknown here: one\'s own card draws the default too');
  assert.equal(h.target.get()[CARD_KEY], 'char_x_plugin', 'the pref keeps the pick');
  // the room's content set arrives with the operator: sent again
  h.setList([...CHESS, { chessId: 'chess_x', charId: 'char_x_plugin', rarity: 6, name: 'X' }]);
  h.content.set({ cs: 'c'.repeat(64), status: 'ready' });
  await h.timers.advance(50);
  assert.deepEqual(h.net.sent.at(-1), { t: 'room.card', charId: 'char_x_plugin' });
  // a hidden preset is no seat card either (the server's whitelist: visible, non-自选)
  h.target.set({ [CARD_KEY]: 'char_3_h' });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.deepEqual(h.net.sent.at(-1), { t: 'room.card', charId: '' });
  // 默认 needs no data at all
  h.target.set({ [CARD_KEY]: '' });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.equal(h.net.sent.at(-1).charId, '');
});

test('card sync: offline it waits for the next welcome (no request)', async (t) => {
  const h = harness();
  t.after(h.dispose);
  h.net.status = 'offline';
  h.target.set({ [CARD_KEY]: 'char_1_a' });
  await h.timers.advance(SYNC_DEBOUNCE_MS);
  assert.equal(h.net.sent.length, 0);
  h.net.status = 'online';
  h.net.emit('welcome');
  await h.timers.advance(50);
  assert.deepEqual(h.net.sent, [{ t: 'room.card', charId: 'char_1_a' }]);
});

test('card sync: a content change (a version switch, a room\'s set) with the same payload sends nothing — the session keeps the card (DESIGN §35.23)', async (t) => {
  const h = harness({ card: 'char_1_a' });
  t.after(h.dispose);
  await h.flush();
  assert.equal(h.net.sent.length, 1);
  h.content.set({ cs: 'd'.repeat(64), status: 'loading' });
  h.content.set({ cs: 'd'.repeat(64), status: 'ready' });
  await h.timers.advance(50);
  h.content.set({ cs: null, status: 'idle' });
  await h.timers.advance(50);
  assert.equal(h.net.sent.length, 1, 'no heavy message spent on an unchanged card');
  assert.equal(h.target.get()[CARD_SYNC_KEY], 'synced');
  // the set no longer lists the operator: the payload changed, so it goes out
  h.setList(CHESS.filter((c) => c.charId !== 'char_1_a'));
  h.content.set({ cs: 'e'.repeat(64), status: 'ready' });
  await h.timers.advance(50);
  assert.deepEqual(h.net.sent.at(-1), { t: 'room.card', charId: '' });
});

// ---- #877 (review of PR #894): a 自选编队 operator is a card like any other --------------------------------
test('card sync: a 自选编队 pick with no chess record goes out as itself, not as 默认 (#877)', async (t) => {
  const h = harness({ card: 'char_9_pool' });
  t.after(h.dispose);
  await h.flush();
  assert.deepEqual(h.net.sent, [{ t: 'room.card', charId: 'char_9_pool' }], 'the teammates and the draft see the pool operator');
  assert.equal(h.target.get()[CARD_SYNC_KEY], 'synced');
  assert.equal(h.target.get()[CARD_KEY], 'char_9_pool', 'the pref keeps it');
});

test('card sync: an id outside the chess list and outside the pool still goes out as 默认 (#877)', async (t) => {
  // a hidden preset and an unknown operator are no seat cards: the server refuses both, so the room sees 默认
  for (const card of ['char_3_h', 'char_8_notpool']) {
    const h = harness({ card });
    t.after(h.dispose);
    await h.flush();
    assert.deepEqual(h.net.sent, [{ t: 'room.card', charId: '' }], card);
    assert.equal(h.target.get()[CARD_KEY], card, 'the pref keeps the pick');
  }
});

test('card sync: a pool pick waits for backups.json; a chess pick needs no backups at all (#877)', async (t) => {
  // backups missing: the pool list is unknown, so a pool pick is never sent as 默认 (that would clear the seat card)
  const pool = harness({ card: 'char_9_pool', backups: null });
  t.after(pool.dispose);
  await pool.flush();
  assert.equal(pool.net.sent.length, 0, 'nothing sent while the list that names it is missing');
  assert.equal(pool.target.get()[CARD_SYNC_KEY], 'error');
  // once backups arrives it goes out
  pool.setBackups(BACKUPS);
  await pool.flush();
  assert.deepEqual(pool.net.sent.at(-1), { t: 'room.card', charId: 'char_9_pool' });
  // a chess operator is the common case and must not wait on backups
  const chess = harness({ card: 'char_1_a', backups: null });
  t.after(chess.dispose);
  await chess.flush();
  assert.deepEqual(chess.net.sent, [{ t: 'room.card', charId: 'char_1_a' }], 'no backups.json download for a chess pick');
});
