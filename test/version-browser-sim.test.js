// The page's simulation of another official version's set (versions M1, DESIGN §35.23): loadBrowserSim hands the
// content modules the version marker (config.version), so a 第一期 battle simulated on the page finds kits by charId and
// item behaviour by effectId exactly like the version host — before, the browser data had no `config` and every
// version branch took the default path (another operator's kit, another item's effect). The browser reads the content
// modules' gameData() through the /data.js stand-in (getSimData(), the injected data): here setGameData(sim.raw) does
// that, since a Node test otherwise reads server/data.js's default singleton. The default data stays without `config`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadBrowserSim, SIM_DATA_FILES } from '../public/js/battle/simLoader.js';
import { setGameData, isVersionData } from '../server/sim/content/support/index.js';
import { officialKitKey } from '../server/sim/content/index.js';
import { battleEffectOf } from '../server/sim/content/items/battle.js';
import { setSimData } from '../server/sim/simdata.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = pathToFileURL(path.join(ROOT, 'server/sim')).href + '/';
const readDir = (dir) => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(path.join(dir, f), 'utf8'))]));

after(() => { setGameData(null); setSimData(null); });

test('a 第一期下半 set simulated on the page runs the version host\'s kits and item behaviour', async () => {
  const full = readDir(path.join(ROOT, 'data/versions/act1autochess'));
  const sim = await loadBrowserSim({ base: BASE, data: full, cs: 'a'.repeat(64), bounds: null });
  assert.deepEqual(sim.raw.config, { version: full.config.version }, 'the version marker reaches the browser data');
  assert.ok(Object.isFrozen(sim.raw.config));
  setGameData(sim.raw); // the /data.js stand-in
  assert.equal(isVersionData(), true);
  // 50 chess ids of 第一期下半 name other operators than in 第二期下半: each gets the kit the host gives it
  let reused = 0;
  const def = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
  for (const [id, rec] of Object.entries(full.chess)) {
    if (!def[id] || def[id].charId === rec.charId) continue;
    reused++;
    assert.equal(officialKitKey(rec, sim.raw), officialKitKey(rec, full), `${id} (${rec.charId}) runs the host's kit`);
  }
  assert.ok(reused >= 50, `reused chess ids checked: ${reused}`);
  assert.equal(officialKitKey(full.chess.chess_char_1_04_a, sim.raw), 'chess_char_2_07_a', 'char_143_ghost: its own kit');
  // item ids 第一期下半 gives other effects (chess_item_1_02_e_a is 阿戈尔重刃 there, 坚守盾牌 in the default data): the
  // page dispatches every item to the behaviour the host dispatches it to
  const page = Object.fromEntries(Object.keys(full.items).map((id) => [id, battleEffectOf(id)]));
  setGameData(full); // the version host's data (with config)
  const host = Object.fromEntries(Object.keys(full.items).map((id) => [id, battleEffectOf(id)]));
  setGameData(null); // the default data
  const byDefaultKey = Object.fromEntries(Object.keys(full.items).map((id) => [id, battleEffectOf(id)]));
  assert.deepEqual(page, host);
  const differs = Object.keys(page).filter((id) => page[id] !== byDefaultKey[id]);
  assert.ok(differs.length > 0, 'some reused item ids run another behaviour than the default lookup');
});

test('the default data loaded on the page carries no config (unchanged)', async () => {
  const files = Object.fromEntries(SIM_DATA_FILES.map((n) => [n, JSON.parse(readFileSync(path.join(ROOT, 'data', `${n}.json`), 'utf8'))]));
  const sim = await loadBrowserSim({ base: BASE, data: { ...files, config: JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8')) }, cs: 'b'.repeat(64), bounds: null });
  assert.equal('config' in sim.raw, false);
  setGameData(sim.raw);
  assert.equal(isVersionData(), false);
  assert.deepEqual(Object.keys(sim.raw), SIM_DATA_FILES);
});
