// The room screen's 「AI 队友最后选择」 switch (GitHub #338; server: room.setAiPicksLast, room.state.aiPicksLast): co-op
// rooms only, the host toggles it, everybody else sees its state read-only; the texts go through t() with English in
// public/i18n/en.json. Remembered (#995, §37.334): the switch the server took is this browser's default
// (`sp.pref.lobby.aiPicksLast`), and 创建同盟 sends a remembered "on" right after room.create through room.setAiPicksLast.
// The browser side: test/ui/room-settings.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const LOBBY = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
const mod = () => import(pathToFileURL(path.join(ROOT, 'public/js/screens/room.js')).href);
const lobbyMod = () => import(pathToFileURL(path.join(ROOT, 'public/js/screens/lobby.js')).href);

const room = (o = {}) => ({
  code: 'ABCD', hostId: 'h', mode: 'coop', difficulty: 'NORMAL', aiPicksLast: false,
  seats: [{ seat: 0, playerId: 'h', name: 'Host', isBot: false, ready: false, connected: true }, { seat: 1, playerId: 'g', name: 'G', isBot: false, ready: false, connected: true }, null, null],
  ...o,
});

test('aiLastOption: hidden in solo, editable by the host only, the state from room.state (off when absent)', async () => {
  const { aiLastOption } = await mod();
  assert.equal(aiLastOption(room({ mode: 'solo' }), 'h'), null, 'solo: no AI teammates');
  assert.deepEqual(aiLastOption(room(), 'h'), { on: false, editable: true });
  assert.deepEqual(aiLastOption(room({ aiPicksLast: true }), 'h'), { on: true, editable: true });
  assert.deepEqual(aiLastOption(room({ aiPicksLast: true }), 'g'), { on: true, editable: false });
  assert.deepEqual(aiLastOption(room({ aiPicksLast: undefined }), 'g'), { on: false, editable: false }, 'an older server');
  assert.equal(aiLastOption(null, 'h'), null);
});

test('room.js sends room.setAiPicksLast { on } and shows the switch through t(); en.json has the English', () => {
  assert.match(SRC, /net\.request\('room\.setAiPicksLast', \{ on \}\)/);
  for (const zh of ['AI 队友最后选择', '策略与机变轮选时，所有博士先于 AI 队友选择', '由创建者设置']) {
    assert.ok(SRC.includes(`t('${zh}')`), zh);
    assert.equal(typeof EN[zh], 'string', `en.json: ${zh}`);
    assert.ok(EN[zh].length > 0 && !/[一-鿿]/.test(EN[zh]), `English for ${zh}`);
  }
});

/** A recording net.request: `refuse` makes every call reject like a server error. */
function requests({ refuse = false } = {}) {
  const sent = [];
  const request = (t, fields) => { sent.push([t, fields]); return refuse ? Promise.reject(Object.assign(new Error('NOT_HOST'), { code: 'NOT_HOST' })) : Promise.resolve({ t: 'ok' }); };
  return { sent, request };
}

test('#995 sendRememberedAiLast: a remembered "on" follows a new co-op room; off, unset, junk or solo send nothing', async () => {
  const { AI_LAST_PREF, sendRememberedAiLast } = await lobbyMod();
  assert.equal(AI_LAST_PREF, 'lobby.aiPicksLast');
  const prefs = (v) => (key, fallback) => (key === AI_LAST_PREF && v !== undefined ? v : fallback);

  let r = requests();
  assert.equal(await sendRememberedAiLast('coop', r.request, prefs(true)), true);
  assert.deepEqual(r.sent, [['room.setAiPicksLast', { on: true }]], 'the existing message, nothing new in room.create');

  for (const [mode, v, why] of [['coop', false, 'off: a new room is off already'], ['coop', undefined, 'never switched'],
    ['coop', 'true', 'junk in storage'], ['coop', 1, 'junk in storage'], ['solo', true, 'a solo room has no AI teammates']]) {
    r = requests();
    assert.equal(await sendRememberedAiLast(mode, r.request, prefs(v)), false, why);
    assert.deepEqual(r.sent, [], why);
  }

  // a refusal (an older room, a lost race) leaves the room off and never rejects into the lobby's error toast
  r = requests({ refuse: true });
  assert.equal(await sendRememberedAiLast('coop', r.request, prefs(true)), false);
  assert.equal(r.sent.length, 1);
});

test('#995 the pref lives in localStorage (store.js loadPref), so it survives a reload; no storage means off', async () => {
  const { AI_LAST_PREF, sendRememberedAiLast } = await lobbyMod();
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } });
  try {
    let r = requests();
    assert.equal(await sendRememberedAiLast('coop', r.request), false, 'a fresh browser');
    mem.set(`sp.pref.${AI_LAST_PREF}`, 'true'); // what store.js savePref writes for `true`
    r = requests();
    assert.equal(await sendRememberedAiLast('coop', r.request), true);
    assert.deepEqual(r.sent, [['room.setAiPicksLast', { on: true }]]);
    mem.set(`sp.pref.${AI_LAST_PREF}`, 'not json');
    r = requests();
    assert.equal(await sendRememberedAiLast('coop', r.request), false, 'unreadable storage counts as off');
    globalThis.localStorage = { getItem: () => { throw new Error('SecurityError'); }, setItem() {} };
    assert.equal(await sendRememberedAiLast('coop', requests().request), false, 'blocked storage counts as off');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
});

test('#995 wiring: the room saves only a switch the server took; 创建同盟 sends the remembered value after room.create', () => {
  // room.js: the host's accepted switch (on or off) becomes the pref; a refused one (or a guest, who sends nothing) does not
  assert.match(SRC, /const sent = await run\('ailast', \(\) => net\.request\('room\.setAiPicksLast', \{ on \}\)\);\n\s*if \(sent\) savePref\(AI_LAST_PREF, on === true\);/);
  assert.match(SRC, /import \{ AI_LAST_PREF, [^}]*\} from '\.\/lobby\.js';/);
  // lobby.js: chained after room.create resolved (a refused create leaves the player's old room untouched), for the mode
  // just created; room.create itself carries no new key
  assert.match(LOBBY, /\.\.\.\(lobbyRoomPlugins !== undefined \? \{ plugins: lobbyRoomPlugins \} : \{\}\),\n {2}\}\)\.then\(\(\) => sendRememberedAiLast\(mode, \(type, fields\) => net\.request\(type, fields\)\)\)\);/);
  const createCall = LOBBY.slice(LOBBY.indexOf("net.request('room.create', {"), LOBBY.indexOf('}).then(() => sendRememberedAiLast'));
  assert.ok(createCall.includes('mode, difficulty') && !createCall.includes('aiPicksLast'), 'no aiPicksLast key in room.create');
  assert.equal((LOBBY.match(/sendRememberedAiLast\(/g) || []).length, 2, 'defined once, called once (创建同盟 only, never on join)');
});
