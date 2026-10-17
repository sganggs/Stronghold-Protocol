// public/js/battle/simLoader.js — the page's parsed data adopted by the simulation (loadBrowserSim `reuse`).
// The match UI loads ten of the eleven simulation files on entering a room (ui/gameComponents GAME_FILES); the loader
// takes those objects as they are instead of fetching and parsing a second copy, freezes them (the sim's guarantee) and
// fetches only what the page does not hold (`waves`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadBrowserSim, SIM_DATA_FILES } from '../../public/js/battle/simLoader.js';

const ROOT = new URL('../../', import.meta.url);
const base = new URL('../../server/sim/', import.meta.url).href;
const read = (n) => JSON.parse(fs.readFileSync(new URL(`data/${n}.json`, ROOT), 'utf8'));

/** A page-like store: ten of the eleven files parsed, `waves` missing (as ui/gameComponents GAME_FILES). */
function pageFiles() {
  const have = {};
  for (const n of SIM_DATA_FILES) if (n !== 'waves') have[n] = read(n);
  return have;
}

test('a file the page already parsed is adopted, not fetched again', async () => {
  const have = pageFiles();
  const fetched = [];
  const fetchFn = async (url) => {
    const name = /([^/]+)\.json$/.exec(url)[1];
    fetched.push(name);
    return { ok: true, json: async () => read(name) };
  };
  const sim = await loadBrowserSim({ base, fetchFn, reuse: (n) => have[n] ?? null });
  assert.deepEqual(fetched, ['waves'], 'only the file the page does not hold is downloaded');
  assert.equal(sim.raw.chess, have.chess, 'the simulation runs on the page copy, not a second graph');
  assert.ok(Object.isFrozen(have.chess), 'the adopted copy is frozen like a downloaded one');
  assert.ok(Object.isFrozen(have.enemies), 'every adopted file is frozen');
  assert.equal(sim.raw.waves, sim.raw.waves, 'the fetched file is there too');
});

test('without a reuse hook every file is fetched (the studio, a plain page)', async () => {
  const fetched = [];
  const fetchFn = async (url) => {
    const name = /([^/]+)\.json$/.exec(url)[1];
    fetched.push(name);
    return { ok: true, json: async () => read(name) };
  };
  const sim = await loadBrowserSim({ base, fetchFn });
  assert.deepEqual([...fetched].sort(), [...SIM_DATA_FILES].sort());
  assert.ok(sim.raw.chess && typeof sim.raw.chess === 'object');
});
