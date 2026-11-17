// test/ui/loadout-charid.test.js — the loadout, 干员持有 and 自选 settings by operator (DESIGN §35.23 M1; ui/loadoutModel.js,
// ui/ownershipModel.js, ui/diyModel.js, ui/loadoutSync.js): 第一期 reuses 第二期下半's chess ids for other operators
// (chess_char_1_02_a is 角峰 in 第二期下半 and 讯使 in 第一期下半, where 角峰 is chess_char_2_03_a), so the stored choices are
// keyed by charId and the screens read views by the chess ids of the data on screen:
//   * the v1 store (第二期下半's chess ids) migrates through 第二期下半's chess.json (fetched directly), an unmapped chess
//     dropped; nothing is sent before;
//   * the views for 第二期下半 and 第一期下半 follow the operator, not the id; an edit is written back through the map of
//     the view it was made on — an edit of a stale view is re-based, never filed under the other version's operator;
//   * 干员持有 likewise; 自选 per version (sp.pref.diy / sp.pref.diy.<slug>);
//   * the sync waits for the data the server checks against (canSendSettings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const DEF = readJson('data/chess.json');
const V1 = readJson('data/versions/act1autochess/chess.json');
const V21 = readJson('data/versions/act2autochess-v2_1/chess.json');
const listOf = (c) => Object.values(c);

const M = await import('../../public/js/ui/loadoutModel.js');
const O = await import('../../public/js/ui/ownershipModel.js');
const D = await import('../../public/js/ui/diyModel.js');
const S = await import('../../public/js/ui/loadoutSync.js');
const { data } = await import('../../public/js/data.js');
const { createStore } = await import('../../public/js/store.js');

const YAK = 'char_199_yak'; // 角峰: chess_char_1_02_a (第二期下半) / chess_char_2_03_a (第一期下半)
const BLACKD = 'char_198_blackd'; // 讯使: chess_char_1_02_a in 第一期下半 only
const ANGEL = 'char_103_angel'; // 能天使: chess_char_3_01_a in both
const show = (chess, id) => data.setContent({ id, values: new Map([['chess', chess]]) });

test('charKeyMap: chess ↔ charId per data set; a retired hidden chess maps to its operator, the slot is the view\'s', () => {
  const def = M.charKeyMap(listOf(DEF));
  const v1 = M.charKeyMap(listOf(V1));
  assert.equal(def.toChar.get('chess_char_1_02_a'), YAK);
  assert.equal(v1.toChar.get('chess_char_1_02_a'), BLACKD);
  assert.equal(v1.toChess.get(YAK), 'chess_char_2_03_a');
  assert.equal(def.toChess.has(BLACKD), false);
  // 第二期下半 keeps a retired hidden chess of some operators beside their slot: the view names the slot
  assert.equal(def.toChess.get('char_4151_tinman'), 'chess_char_2_19_a');
  assert.equal(def.toChar.get('chess_char_1_16_a'), 'char_4151_tinman');
  assert.ok(![...def.toChar.keys()].some((id) => DEF[id].isGolden), 'normal chess only');
});

test('views and write-back (pure): the same operator under each version\'s id; an edit through the view\'s own map', () => {
  const def = M.charKeyMap(listOf(DEF));
  const v1 = M.charKeyMap(listOf(V1));
  const byChar = { [YAK]: { skill: 0 }, [BLACKD]: { skill: 1 }, char_x_gone: { skill: 2 } };
  assert.deepEqual(M.entriesView(byChar, def), { chess_char_1_02_a: { skill: 0 } }, '第二期下半: 角峰 only');
  assert.deepEqual(M.entriesView(byChar, v1), { chess_char_2_03_a: { skill: 0 }, chess_char_1_02_a: { skill: 1 } }, '第一期下半: 角峰 and 讯使 by their own ids');
  // an edit on the 第一期下半 view: chess_char_1_02_a is 讯使 there — 角峰 untouched, the operator of no view kept
  const next = M.rebaseByChar(byChar, M.entriesView(byChar, v1), { chess_char_2_03_a: { skill: 0 } }, (id) => v1.toChar.get(id));
  assert.deepEqual(next, { [YAK]: { skill: 0 }, char_x_gone: { skill: 2 } }, '讯使 cleared, 角峰 and the unknown operator kept');
  // the same edit read through the wrong map would have cleared 角峰: never
  const wrong = M.rebaseByChar(byChar, M.entriesView(byChar, v1), { chess_char_2_03_a: { skill: 0 } }, (id) => def.toChar.get(id));
  assert.notDeepEqual(wrong, next, '(the map matters)');
  assert.deepEqual(M.entriesToChar({ chess_char_1_02_a: { skill: 1 }, chess_nope: { skill: 0 } }, (id) => def.toChar.get(id)), { [YAK]: { skill: 1 } }, 'v1 → v2: an unmapped chess dropped');
  // ownership
  assert.deepEqual(O.notOwnedView([YAK, BLACKD], def), ['chess_char_1_02_a']);
  assert.deepEqual(O.notOwnedView([YAK, BLACKD], v1), ['chess_char_1_02_a', 'chess_char_2_03_a']);
  assert.deepEqual(O.rebaseChars([YAK, BLACKD], ['chess_char_1_02_a', 'chess_char_2_03_a'], ['chess_char_2_03_a'], (id) => v1.toChar.get(id)), [YAK]);
});

test('migration: a v1 store moves to v2 through 第二期下半\'s chess.json (fetched directly); a failed fetch keeps it and tries again', async () => {
  // chess_char_5_18_a is 第二期下半's hidden droppable chess of an operator whose visible one is chess_char_4_23_a: a v1
  // mark on it showed nothing, and must not mark the visible chess now
  const target = createStore({ entries: { chess_char_1_02_a: { skill: 1 }, chess_nope_99: { skill: 0 } }, byChar: null, ops: {}, notOwned: ['chess_char_3_01_a', 'chess_char_5_18_a'], notOwnedChars: null, diy: {}, diyVersion: 'act2autochess' });
  let calls = 0;
  const failing = async () => { calls++; return { ok: false, status: 503 }; };
  assert.equal(await S.migrateSettings({ fetch: failing, target }), false);
  assert.equal(target.get().byChar, null, 'kept as v1');
  const fetchFn = async (url) => { calls++; assert.equal(url, '/data/chess.json'); return { ok: true, json: async () => DEF }; };
  assert.equal(await S.migrateSettings({ fetch: fetchFn, target }), true);
  assert.deepEqual(target.get().byChar, { [YAK]: { skill: 1 } });
  assert.deepEqual(target.get().notOwnedChars, [ANGEL]);
  // the v2 stores also carry the v1 fields by 第二期下半's chess ids, which an older build on the same origin reads
  assert.deepEqual(JSON.parse(mem.get('sp.pref.loadout')), { v: 2, byChar: { [YAK]: { skill: 1 } }, ops: {}, entries: { chess_char_1_02_a: { skill: 1 } } });
  assert.deepEqual(JSON.parse(mem.get('sp.pref.ownership')), { v: 2, notOwnedChars: [ANGEL], notOwned: ['chess_char_3_01_a'] });
  assert.deepEqual(M.parseStored(JSON.parse(mem.get('sp.pref.loadout'))), { chess_char_1_02_a: { skill: 1 } }, 'what an older build reads');
  assert.equal(await S.migrateSettings({ fetch: fetchFn, target }), true, 'done: at once');
  assert.equal(calls, 2);
  assert.equal(S.defaultCharMap().toChar.get('chess_char_1_02_a'), YAK, 'the map stays for a v1 import');
});

test('the app\'s views follow the data on screen; a write-back on a stale view is re-based', () => {
  const { loadoutStore, setEntries, setNotOwned, refreshViews } = S;
  loadoutStore.set({ byChar: { [YAK]: { skill: 0 }, [BLACKD]: { skill: 1 } }, notOwnedChars: [YAK], entries: {}, notOwned: [] });
  show(DEF, 'def');
  refreshViews();
  assert.deepEqual(loadoutStore.get().entries, { chess_char_1_02_a: { skill: 0 } }, '第二期下半');
  assert.deepEqual(loadoutStore.get().notOwned, ['chess_char_1_02_a']);
  const stale = loadoutStore.get().entries;
  const staleOwn = loadoutStore.get().notOwned;
  show(V1, 'v1');
  refreshViews();
  assert.deepEqual(loadoutStore.get().entries, { chess_char_2_03_a: { skill: 0 }, chess_char_1_02_a: { skill: 1 } }, '第一期下半: the same 角峰, 讯使 too');
  assert.deepEqual(loadoutStore.get().notOwned, ['chess_char_2_03_a']);
  // an edit made on the 第二期下半 view after the data changed: chess_char_1_02_a there is 角峰 — never 讯使
  setEntries({ chess_char_1_02_a: { skill: 2 } }, { base: stale });
  assert.deepEqual(loadoutStore.get().byChar, { [YAK]: { skill: 2 }, [BLACKD]: { skill: 1 } }, 're-based: 角峰 changed');
  assert.deepEqual(loadoutStore.get().entries, { chess_char_2_03_a: { skill: 2 }, chess_char_1_02_a: { skill: 1 } }, 'the view on screen rebuilt');
  setNotOwned([], { base: staleOwn });
  assert.deepEqual(loadoutStore.get().notOwnedChars, [], '角峰 owned again');
  // an edit on the view on screen
  setEntries({ chess_char_2_03_a: { skill: 2 } });
  assert.deepEqual(loadoutStore.get().byChar, { [YAK]: { skill: 2 } }, '讯使 reset from the 第一期下半 view');
  setNotOwned(['chess_char_1_02_a']);
  assert.deepEqual(loadoutStore.get().notOwnedChars, [BLACKD]);
  assert.deepEqual(JSON.parse(mem.get('sp.pref.ownership')), { v: 2, notOwnedChars: [BLACKD], notOwned: [] }, '讯使 has no chess in 第二期下半: an older build sees everyone owned');
  // a v1 import (第二期下半's chess ids) as entries of the view on screen is importedEntries' job; a v2 one maps directly
  assert.deepEqual(S.importedEntries({ byChar: { [YAK]: { skill: 1 } } }), { chess_char_2_03_a: { skill: 1 } });
  assert.deepEqual(S.importedEntries({ entries: { chess_char_1_02_a: { skill: 1 } } }, 'act1autochess'), { chess_char_2_03_a: { skill: 1 } }, 'a v1 entry: by its operator');
  // a v1 import with entries on both of an operator's 第二期下半 chess — the visible chess_char_4_23_a and the hidden
  // droppable chess_char_5_18_a (see the migration) — files the visible chess's choice under the operator, whatever the
  // key order (importedEntries' ownChessOf: the slot's entry first); in 第二期上半 that operator (char_1026_gvial2) is
  // chess_char_5_18_a itself, visible
  show(V21, 'v21');
  assert.deepEqual(S.importedEntries({ entries: { chess_char_5_18_a: { skill: 1 }, chess_char_4_23_a: { skill: 0 } } }, 'act2autochess@V2_1'),
    { chess_char_5_18_a: { skill: 0 } }, 'the visible chess\'s choice, not the hidden chess\'s');
  show(DEF, 'def');
  refreshViews();
  assert.deepEqual(loadoutStore.get().entries, { chess_char_1_02_a: { skill: 2 } });
  assert.deepEqual(loadoutStore.get().notOwned, [], '讯使 is not in 第二期下半');
  // a v1 ownership import: a hidden chess (see the migration) is dropped, not filed under the visible chess's operator
  assert.deepEqual(S.importedNotOwned({ notOwned: ['chess_char_5_18_a', 'chess_char_6_10_a', 'chess_char_3_01_a'] }), ['chess_char_3_01_a']);
  data.setContent(null);
});

test('自选 per version: sp.pref.diy for 第二期下半, sp.pref.diy.<slug> for another; the export names a non-default version', () => {
  assert.equal(D.diyPrefKey('act2autochess'), 'diy');
  assert.equal(D.diyPrefKey(null), 'diy');
  assert.equal(D.diyPrefKey('act1autochess'), 'diy.act1autochess');
  assert.equal(D.diyPrefKey('act1autochess@V1_1'), 'diy.act1autochess-v1_1');
  const { loadoutStore, setDiyPicks } = S;
  loadoutStore.set({ diyVersion: 'act1autochess@V1_1' });
  setDiyPicks({ chess_diy_5_a: { charId: 'char_x' } });
  assert.deepEqual(JSON.parse(mem.get('sp.pref.diy.act1autochess-v1_1')).picks, { chess_diy_5_a: { charId: 'char_x' } });
  assert.equal(mem.has('sp.pref.diy'), false, '第二期下半\'s picks untouched');
  assert.equal(D.exportDiy({}, { version: 'act1autochess@V1_1' }).version, 'act1autochess@V1_1');
  assert.equal('version' in D.exportDiy({}, { version: 'act2autochess' }), false);
  loadoutStore.set({ diyVersion: 'act2autochess', diy: {} });
});

test('the sync waits for the data the server checks against (canSendSettings)', () => {
  const app = (room) => ({ get: () => ({ room }) });
  const content = (c) => ({ get: () => ({ cs: null, status: 'idle', kind: null, ...c }) });
  const CS = 'ab'.repeat(32);
  const v1Room = { code: 'A', version: 'act1autochess', content: { cs: CS, vanilla: true, version: 'act1autochess' } };
  assert.equal(S.canSendSettings({ store: app(null), content: content({}), contentId: () => null }), true, 'the lobby on 第二期下半\'s own files');
  assert.equal(S.canSendSettings({ store: app(null), content: content({ cs: CS, kind: 'version', status: 'ready' }), contentId: () => CS }), false, 'a lobby of another version: never (the server checks its default, 第二期下半)');
  assert.equal(S.canSendSettings({ store: app(null), content: content({ cs: CS, kind: 'version', status: 'loading' }), contentId: () => null }), false, 'while loading');
  assert.equal(S.canSendSettings({ store: app(v1Room), content: content({ cs: CS, kind: 'version', status: 'loading' }), contentId: () => null }), false, 'a version room before its data');
  assert.equal(S.canSendSettings({ store: app(v1Room), content: content({ cs: CS, kind: 'version', status: 'ready' }), contentId: () => CS }), true, 'a version room once it is on the page');
  const plain = { code: 'B', content: { cs: 'cd'.repeat(32), vanilla: true, plugins: [] } };
  assert.equal(S.canSendSettings({ store: app(plain), content: content({ cs: CS, kind: 'version', status: 'ready' }), contentId: () => CS }), false, 'a 第二期下半 room while the lobby\'s version is still shown');
  assert.equal(S.canSendSettings({ store: app(plain), content: content({}), contentId: () => null }), true);
  // A server whose default is another version (SP_VERSIONS=act1autochess SP_VERSION_DEFAULT=act1autochess) checks the
  // lobby's settings against that version's data (lobby.js dataFor / csOf): the lobby sends once that set is shown.
  const v1Default = { get: () => ({ room: null, versions: [{ id: 'act1autochess', cs: CS, default: true }] }) };
  assert.equal(S.canSendSettings({ store: v1Default, content: content({ cs: CS, kind: 'version', version: 'act1autochess', status: 'ready' }), contentId: () => CS }), true, 'the server\'s default version shown');
  assert.equal(S.canSendSettings({ store: v1Default, content: content({}), contentId: () => null }), false, 'the server\'s own files are not its default version');
  assert.equal(S.canSendSettings({ store: v1Default, content: content({ cs: 'ef'.repeat(32), kind: 'version', version: 'act1autochess', status: 'ready' }), contentId: () => 'ef'.repeat(32) }), false, 'another cs');
});

test('entering a room after a shut gate sends at once, not after the debounce (开始模拟 must not overtake it)', async () => {
  const sent = [];
  const listeners = new Map();
  const net = { status: 'online', on: (t, fn) => { listeners.set(t, fn); return () => listeners.delete(t); }, request: async (t, f) => { sent.push({ t, ...f }); return { t: 'ok' }; } };
  // timers that never fire: only a send that does not wait for the debounce can happen
  const timers = { setTimeout: () => 1, clearTimeout() {} };
  const content = createStore({ cs: null, kind: null, status: 'idle' });
  const app = createStore({ room: null });
  const target = createStore({ notOwned: ['chess_char_3_01_a'], ownSync: 'idle' });
  let open = false;
  const sync = S.installOwnershipSync({ net, timers, target, content, app, gate: () => open });
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  await sync.flush();
  assert.equal(sent.length, 0, 'the lobby\'s gate is shut');
  open = true;
  app.set({ room: { code: 'ROOM' } });
  await flush();
  assert.equal(sent.length, 1, 'sent on entering the room, with no timer');
  sync.dispose();
});

test('the sync engine: no send while the gate is shut; the content\'s arrival, and entering a room after a shut gate, send it', async () => {
  const sent = [];
  const listeners = new Map();
  const net = { status: 'online', on: (t, fn) => { listeners.set(t, fn); return () => listeners.delete(t); }, request: async (t, f) => { sent.push({ t, ...f }); return { t: 'ok' }; } };
  const timers = { setTimeout: (fn) => { Promise.resolve().then(fn); return 1; }, clearTimeout() {} };
  const content = createStore({ cs: null, kind: null, status: 'loading' });
  const app = createStore({ room: null });
  const target = createStore({ notOwned: ['chess_char_3_01_a'], ownSync: 'idle' });
  let open = false;
  const sync = S.installOwnershipSync({ net, timers, target, content, app, gate: () => open });
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  listeners.get('welcome')?.({});
  await flush();
  assert.equal(sent.length, 0, 'the gate is shut');
  open = true;
  content.set({ cs: 'x', status: 'ready' });
  await flush();
  assert.equal(sent.length, 1, 'the content arrived');
  app.set({ room: { code: 'ROOM' } });
  await flush();
  assert.equal(sent.length, 1, 'sent already: entering a room sends nothing more (the server keeps the session\'s copy)');
  // the lobby could not send (another version on screen): entering a room sends it
  app.set({ room: null });
  open = false;
  target.set({ notOwned: ['chess_char_3_02_a'] });
  await flush();
  assert.equal(sent.length, 1, 'the gate is shut');
  open = true;
  app.set({ room: { code: 'ROOM2' } });
  await flush();
  assert.equal(sent.length, 2, 'entering a room after a shut gate sends it');
  assert.deepEqual(sent[1].notOwned, ['chess_char_3_02_a']);
  app.set({ room: { code: 'ROOM2', seats: [] } });
  await flush();
  assert.equal(sent.length, 2, 'not on every push of the same room');
  sync.dispose();
});

test('a write-back changes only what the edit changed: an edit made on an older copy of the view never undoes a newer one', () => {
  const map = M.charKeyMap(listOf(DEF));
  const charOf = (id) => map.toChar.get(id);
  const older = { chess_char_1_02_a: { skill: 0 } };
  // meanwhile 能天使 got a choice (a newer edit); the older copy then changes 角峰 only
  const byChar = { [YAK]: { skill: 0 }, [ANGEL]: { skill: 1 } };
  assert.deepEqual(M.rebaseByChar(byChar, older, { chess_char_1_02_a: { skill: 2 } }, charOf), { [YAK]: { skill: 2 }, [ANGEL]: { skill: 1 } });
  // 干员持有: the older copy marked 角峰 not owned; 能天使 was marked since and stays so
  assert.deepEqual(O.rebaseChars([YAK, ANGEL], ['chess_char_1_02_a'], [], charOf), [ANGEL]);
  assert.deepEqual(O.rebaseChars([ANGEL], [], ['chess_char_1_02_a'], charOf), [ANGEL, YAK].sort());
});
