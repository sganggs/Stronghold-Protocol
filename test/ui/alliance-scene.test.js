// test/ui/alliance-scene.test.js — the 卫戍协议：盟约 entry film and lobby scene (ui/allianceScene.js, ui/entryFilm.js):
// the night / dusk cycle keeps the recording's moments (lobby clock = video seconds - 3.12), the measured tracks never
// overshoot between their keys, the soundtrack offsets are the recording's, every sprite the scenes ask for exists in
// data/assets.json, and the film's two texts are in every shipped language pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lobbyState, curve, CYC, INTRO_AUDIO, INTRO_SPAN } from '../../public/js/ui/allianceScene.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lobbyAt = (videoS) => lobbyState(videoS - 3.12);

test('the lobby cycle: night, the switch to dusk at video 5.05 s, back to night at 17.47–18.10 s, every 20 s', () => {
  assert.equal(CYC, 20);
  for (const v of [3.2, 4.4, 5.0]) assert.deepEqual([lobbyAt(v).night, lobbyAt(v).dusk], [1, 0], `night at ${v}`);
  // the dusk band sweeps in left to right (5.08–5.35 s) over a dim grid
  const mid = lobbyAt(5.2);
  assert.equal(mid.dusk, 1);
  assert.ok(mid.front > 0 && mid.front < 1280 + 970, 'the wipe front is on screen');
  for (const v of [5.5, 10, 17.3]) assert.deepEqual([lobbyAt(v).night, lobbyAt(v).dusk, lobbyAt(v).front], [0, 1, 1e4], `dusk at ${v}`);
  // the cross-fade back to night
  const xf = lobbyAt(17.8);
  assert.ok(xf.night === 1 && xf.dusk > 0 && xf.dusk < 1);
  assert.deepEqual([lobbyAt(18.2).night, lobbyAt(18.2).dusk], [1, 0]);
  // the next switch, one cycle later
  assert.deepEqual(lobbyAt(25.2), lobbyAt(5.2));
});

test('measured tracks: monotone cubic, no overshoot between keys', () => {
  const keys = [[1.40, 2.06], [1.80, 1.57], [2.0, 1.24], [2.6, 1.03], [2.867, 1.0], [3.3, 1.0]];
  const f = curve(keys);
  for (const [x, y] of keys) assert.ok(Math.abs(f(x) - y) < 1e-9);
  for (let x = 1.40; x <= 3.3; x += 0.01) {
    const v = f(x);
    assert.ok(v <= 2.06 + 1e-9 && v >= 1.0 - 1e-9, `inside the keys' range at ${x.toFixed(2)}`);
  }
  assert.equal(f(0), 2.06);
  assert.equal(f(9), 1.0);
});

test('the soundtrack and the span are the recording\'s', () => {
  // entry cue act1autochess_g_ui_load (r 0.988) and the lobby music from its start (r 0.998)
  assert.deepEqual(INTRO_AUDIO, { sfxAt: 1.6856, bgmAt: 2.1444 });
  assert.ok(INTRO_SPAN.from < 1.267 && INTRO_SPAN.fadeAt < INTRO_SPAN.to);
});

test('every sprite the scenes ask for is in data/assets.json', () => {
  const ui = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).ui || {};
  const src = readFileSync(path.join(ROOT, 'public/js/ui/allianceScene.js'), 'utf8');
  const keys = [...src.matchAll(/'((?:entry|prepareBkg)\/[a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 8);
  for (const k of keys) assert.ok(ui[k], `${k} in assets.json ui`);
  for (const f of ['act1autochess_g_ui_load']) assert.match(readFileSync(path.join(ROOT, 'public/js/ui/entryFilm.js'), 'utf8'), new RegExp(f));
});

test('the film\'s texts are in every shipped language pack', () => {
  const dir = path.join(ROOT, 'public/i18n');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const pack = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    for (const id of ['点击进入', '点击跳过', '卫戍协议', '盟约']) assert.ok(pack[id], `${id} in ${file}`);
  }
});
