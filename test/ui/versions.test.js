// test/ui/versions.test.js — which official version the page shows (public/js/versions.js, DESIGN §35.23 M1): the lobby's
// preference against welcome.versions (the server's default, else 第二期下半), a room's version, a result's after its room
// is gone, the preference saved; the difficulties a version offers and the server's fallback rule; needsContent; the
// season; the period lines; the welcome list sanitised. Plus a guard: the client renders no research texts of the data
// (`spec` / `implFormula` / `howToPlay` / `note` — research notes in English, carried by every version's build too), but
// 突变细胞's corrected rule line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const V = await import('../../public/js/versions.js');
const { createStore, initialState } = await import('../../public/js/store.js');
const { DIFFICULTIES } = await import('../../shared/constants.js');

const CS = (c) => c.repeat(64);
const LIST = V.sanitizeVersions([
  { id: 'act2autochess', cs: CS('a'), default: true, roomModes: ['solo', 'coop'] },
  { id: 'act1autochess', cs: CS('b'), roomModes: ['solo', 'coop'] },
  { id: 'act1autochess@V1_1', cs: CS('c') },
]);

test('sanitizeVersions: registry ids with a full cs, in order, the registry\'s label and family; junk dropped; null without any', () => {
  assert.deepEqual(LIST.map((e) => [e.id, e.cs[0], !!e.default]), [['act2autochess', 'a', true], ['act1autochess', 'b', false], ['act1autochess@V1_1', 'c', false]]);
  assert.equal(LIST[1].label, '第一期下半');
  assert.deepEqual(LIST[2].roomModes, ['solo', 'coop'], 'the registry\'s modes when the entry names none');
  assert.equal(V.sanitizeVersions(null), null);
  assert.equal(V.sanitizeVersions([]), null);
  assert.equal(V.sanitizeVersions([{ id: 'act1vautochess', cs: CS('d') }, { id: 'act1autochess', cs: 'short' }, 'x']), null, 'unknown ids and short hashes');
  assert.equal(V.sanitizeVersions([{ id: 'act1autochess', cs: CS('b') }, { id: 'act1autochess', cs: CS('e') }]).length, 1, 'an id once');
});

test('lobbyVersion: the preference when welcome lists it, else the server\'s default, else 第二期下半; no list = the default data', () => {
  assert.equal(V.lobbyVersion({ versions: null, lobbyVersion: 'act1autochess' }), 'act2autochess', 'the switch is off');
  assert.equal(V.lobbyVersion({ versions: LIST, lobbyVersion: 'act1autochess' }), 'act1autochess');
  assert.equal(V.lobbyVersion({ versions: LIST, lobbyVersion: 'act2autochess@V2_1' }), 'act2autochess', 'not enabled here: the server\'s default');
  const v1Default = V.sanitizeVersions([{ id: 'act1autochess', cs: CS('b'), default: true }, { id: 'act2autochess', cs: CS('a') }]);
  assert.equal(V.lobbyVersion({ versions: v1Default, lobbyVersion: null }), 'act1autochess', 'a server whose default is 第一期下半');
  assert.equal(V.serverDefaultVersion({ versions: v1Default }), 'act1autochess');
  assert.equal(V.lobbyVersion({ versions: V.sanitizeVersions([{ id: 'act1autochess', cs: CS('b') }]), lobbyVersion: null }), 'act2autochess', 'no default marked: 第二期下半');
});

test('roomVersion / shownVersion: a room plays its version; a result keeps its frames\' version once the room is gone; a stats replay its own; else the lobby', () => {
  assert.equal(V.roomVersion(null), 'act2autochess');
  assert.equal(V.roomVersion({ code: 'A' }), 'act2autochess', 'absent = 第二期下半');
  assert.equal(V.roomVersion({ version: 'act1autochess' }), 'act1autochess');
  const s = { versions: LIST, lobbyVersion: 'act1autochess@V1_1' };
  assert.equal(V.shownVersion(s), 'act1autochess@V1_1');
  assert.equal(V.shownVersion({ ...s, room: { code: 'A' } }), 'act2autochess', 'a default room overrides the lobby');
  assert.equal(V.shownVersion({ ...s, room: { code: 'A', version: 'act1autochess' } }), 'act1autochess');
  assert.equal(V.shownVersion({ ...s, room: null, match: { public: { phase: 'RESULT', version: 'act1autochess' } } }), 'act1autochess', 'a result after the room is gone');
  // a freshly loaded page that never saw the room (the lobby's replay after a kick / grace timeout): the frames say it
  assert.equal(V.shownVersion({ ...s, room: null, match: { public: null, result: { victory: true, version: 'act1autochess' } } }), 'act1autochess', 'a replayed result on a fresh page');
  assert.equal(V.shownVersion({ ...s, room: null, match: { public: { phase: 'RESULT' }, result: { victory: true } } }), 'act2autochess', 'frames without `version`: 第二期下半, not the lobby\'s');
  assert.equal(V.shownVersion({ ...s, room: null, match: { public: null, result: { version: 'act9' } } }), 'act2autochess', 'an unknown id: the default');
  assert.equal(V.shownVersion({ ...s, room: null, match: { public: null, result: null } }), 'act1autochess@V1_1', 'the result closed: the lobby again');
  // 统计数据's replay: a transient override, the lobby preference untouched; a room still wins
  assert.equal(V.shownVersion({ ...s, replayVersion: 'act2autochess@V2_1' }), 'act2autochess@V2_1', 'a stats replay of another version');
  assert.equal(V.shownVersion({ ...s, replayVersion: 'act2autochess@V2_1', room: { code: 'A', version: 'act1autochess' } }), 'act1autochess', 'a room wins over a replay');
  assert.equal(V.shownVersion({ ...s, replayVersion: 'act9' }), 'act1autochess@V1_1', 'an unknown replay id is ignored');
  assert.equal(V.matchFrameVersion({ result: { version: 'act1autochess@V1_1' }, public: { version: 'act1autochess' } }), 'act1autochess@V1_1', 'the result\'s own first');
  assert.equal(V.matchFrameVersion(null), 'act2autochess');
});

test('setLobbyVersion: saved as sp.pref.lobby.version and shown at once; an unknown id is ignored', () => {
  const store = createStore(initialState);
  V.setLobbyVersion('act1autochess', { store });
  assert.equal(store.get().lobbyVersion, 'act1autochess');
  assert.equal(mem.get('sp.pref.lobby.version'), '"act1autochess"');
  assert.equal(V.storedLobbyVersion(), 'act1autochess');
  V.setLobbyVersion('act9', { store });
  assert.equal(store.get().lobbyVersion, 'act1autochess');
  mem.set('sp.pref.lobby.version', '"nope"');
  assert.equal(V.storedLobbyVersion(), null);
});

test('offeredDifficulties / fallbackDifficulty: a version\'s modes; the server\'s rule — the highest offered below, else the lowest', () => {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  assert.deepEqual(V.offeredDifficulties(read('data/config.json'), 'solo'), DIFFICULTIES, '第二期下半: all four');
  assert.deepEqual(V.offeredDifficulties(read('data/versions/act1autochess/config.json'), 'solo'), ['FUNNY', 'NORMAL', 'HARD'], '第一期下半: no 终极');
  assert.deepEqual(V.offeredDifficulties(read('data/versions/act2autochess-v2_1/config.json'), 'coop'), ['FUNNY', 'NORMAL', 'HARD'], '第二期上半: no 终极');
  assert.deepEqual(V.offeredDifficulties(null, 'coop'), DIFFICULTIES, 'no config yet: all four');
  assert.equal(V.fallbackDifficulty(['FUNNY', 'NORMAL', 'HARD'], 'ABYSS'), 'HARD');
  assert.equal(V.fallbackDifficulty(['FUNNY', 'NORMAL', 'HARD'], 'NORMAL'), 'NORMAL', 'offered: itself');
  assert.equal(V.fallbackDifficulty(['NORMAL', 'HARD'], 'FUNNY'), 'NORMAL', 'nothing below: the lowest offered');
  assert.equal(V.fallbackDifficulty(['FUNNY', 'HARD'], 'NORMAL'), 'FUNNY');
});

test('needsContent / seasonOf / versionLabel / periodLine', () => {
  assert.equal(V.needsContent(null), false);
  assert.equal(V.needsContent({ content: { vanilla: true } }), false, 'a default room');
  assert.equal(V.needsContent({ content: { vanilla: false } }), true, 'gameplay plugins');
  assert.equal(V.needsContent({ version: 'act1autochess', content: { vanilla: true } }), true, 'another version');
  assert.equal(V.seasonOf('act1autochess@V1_1'), 'act1autochess');
  assert.equal(V.seasonOf('act2autochess@V2_1'), 'act2autochess');
  assert.equal(V.seasonOf('nope'), 'act2autochess');
  assert.equal(V.versionLabel('act1autochess'), '第一期下半');
  assert.equal(V.versionLabel('zzz'), 'zzz');
  assert.match(V.periodLine('act1autochess@V1_1'), /盟约·上半.*V1_1.*2025-11-14.*2025-11-25/);
  assert.match(V.periodLine('act2autochess'), /盟约·下半.*V2_2.*2026-03-27/);
  assert.equal(V.periodLine('zzz'), '');
  assert.equal(V.isDefaultVersion(null), true);
  assert.equal(V.isDefaultVersion('act1autochess'), false);
});

test('the client renders no research texts of the data (spec / implFormula / howToPlay / note)', () => {
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(path.join(ROOT, 'public/js'));
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\.(spec|implFormula|howToPlay|note)\b(?!\s*[=(])/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      const text = src.split('\n')[line - 1];
      // `spec` is the battle runner's BattleSpec (b.start), never a data record's research text
      if (m[1] === 'spec' && /\b(e|entry|msg|cur|battle|b|s|x|loading|pending|task|t|current)\.spec\b|spec\.(cs|seed|fieldId)|\.spec\b\s*\?\?|\bspec\b\s*[,)]/.test(text)) continue;
      if (/^\s*(\/\/|\*)/.test(text)) continue;
      // path.relative uses the platform separator; the allow-list below is a POSIX path (Windows CI
      // reported public\js\ui\detailPanel.js, and this line names item.note twice)
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      hits.push(`${rel}:${line}: ${text.trim().slice(0, 100)}`);
    }
  }
  // the one allowed: 突变细胞's rule line (data/items.json `note`, tools/build-data.mjs ITEM_RULES — a corrected Chinese rule,
  // the same in every version's build), shown on the detail card on purpose
  const allowed = (h) => /^public\/js\/ui\/detailPanel\.js:\d+: \$\{item\.note \?/.test(h);
  assert.deepEqual(hits.filter((h) => /\.(implFormula|howToPlay|note)\b/.test(h) && !allowed(h)), [], 'no research text is read');
});

test('versionContentStatus: settles both vanilla version sets and matching modded room/preview content sets', () => {
  const reg = 'act3autochess-2026-09';
  assert.equal(V.versionContentStatus(null, 'act2autochess'), 'ready');
  assert.equal(V.versionContentStatus(null, reg), 'loading');
  assert.equal(V.versionContentStatus({ kind: 'version', version: reg, status: 'ready' }, reg), 'ready');
  assert.equal(V.versionContentStatus({ kind: 'version', version: reg, status: 'failed' }, reg), 'failed');
  assert.equal(V.versionContentStatus({ kind: 'version', version: 'act1autochess', status: 'ready' }, reg), 'loading');
  assert.equal(V.versionContentStatus({ kind: 'plugins', cs: CS('a'), version: reg, status: 'ready' }, reg, CS('a')), 'ready');
  assert.equal(V.versionContentStatus({ kind: 'plugins', cs: CS('a'), version: 'act2autochess', status: 'ready' }, reg, CS('a')), 'loading');
  assert.equal(V.versionContentStatus({ kind: 'plugins', cs: CS('a'), version: null, status: 'loading' }, reg, CS('a')), 'loading');
  assert.equal(V.versionContentStatus({ kind: 'plugins', cs: CS('a'), version: null, status: 'failed' }, reg, CS('a')), 'failed');
  assert.equal(V.versionContentStatus({ kind: 'plugins', cs: CS('a'), version: reg, status: 'ready' }, reg, CS('b')), 'loading');
});
