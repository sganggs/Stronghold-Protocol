// public/js/battle/simLoader.js — the page's parsed data adopted by the simulation (loadBrowserSim `reuse`).
// The match UI loads ten of the eleven simulation files on entering a room (ui/gameComponents GAME_FILES); the loader
// takes those objects as they are instead of fetching and parsing a second copy, freezes them (the sim's guarantee) and
// fetches only what the page does not hold (`waves`). The store can change hands while a load is in flight, so the
// owner check (`reuseOwner`) decides per retrieval: a content set adopted mid-load is never handed to a simulation of
// the original content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadBrowserSim, SIM_DATA_FILES } from '../../public/js/battle/simLoader.js';
import { applyFileOverlay, buildRecordOverlay } from '../../shared/i18nData.js';

const ROOT = new URL('../../', import.meta.url);
const base = new URL('../../server/sim/', import.meta.url).href;
const read = (n) => JSON.parse(fs.readFileSync(new URL(`data/${n}.json`, ROOT), 'utf8'));

/** A page-like store: ten of the eleven files parsed, `waves` missing (as ui/gameComponents GAME_FILES). */
function pageFiles() {
  const have = {};
  for (const n of SIM_DATA_FILES) if (n !== 'waves') have[n] = read(n);
  return have;
}

/** A fetch stand-in that records what was asked for and answers from disk. */
function recorder() {
  const fetched = [];
  const fetchFn = async (url) => {
    const name = /([^/]+)\.json$/.exec(url)[1];
    fetched.push(name);
    return { ok: true, json: async () => read(name) };
  };
  return { fetched, fetchFn };
}

test('a file the page already parsed is adopted, not fetched again', async () => {
  const have = pageFiles();
  const { fetched, fetchFn } = recorder();
  const sim = await loadBrowserSim({ base, fetchFn, reuse: (n) => have[n] ?? null, reuseOwner: () => null });
  assert.deepEqual(fetched, ['waves'], 'only the file the page does not hold is downloaded');
  assert.equal(sim.raw.chess, have.chess, 'the simulation runs on the page copy, not a second graph');
  assert.ok(Object.isFrozen(have.chess), 'the adopted copy is frozen like a downloaded one');
  assert.ok(Object.isFrozen(have.enemies), 'every adopted file is frozen');
  assert.deepEqual(sim.raw.waves, read('waves'), 'the file the page lacks arrives with its content');
});

test('without a reuse hook every file is fetched (the studio, a plain page)', async () => {
  const { fetched, fetchFn } = recorder();
  const sim = await loadBrowserSim({ base, fetchFn });
  assert.deepEqual([...fetched].sort(), [...SIM_DATA_FILES].sort());
  assert.ok(sim.raw.chess && typeof sim.raw.chess === 'object');
});

test('a store that already holds a content set is never adopted for the original simulation', async () => {
  const have = pageFiles();
  const { fetched, fetchFn } = recorder();
  const sim = await loadBrowserSim({ base, fetchFn, reuse: (n) => have[n] ?? null, reuseOwner: () => 'cs_plugin1' });
  assert.deepEqual([...fetched].sort(), [...SIM_DATA_FILES].sort(), 'every file is fetched instead');
  assert.notEqual(sim.raw.chess, have.chess, 'nothing from the content set reached the simulation');
  assert.ok(!Object.isFrozen(have.chess), 'and the store was left alone');
});

test('a content set adopted while the load is in flight is never handed to the original simulation', async () => {
  const have = pageFiles();
  const { fetched, fetchFn } = recorder();
  let owner = null; // the store holds the original content
  const reuse = (n) => {
    owner = 'cs_plugin1'; // content.js adopts a room's plugin set between two retrievals
    return have[n] ?? null;
  };
  const sim = await loadBrowserSim({ base, fetchFn, reuse, reuseOwner: () => owner });
  assert.deepEqual([...fetched].sort(), [...SIM_DATA_FILES].sort(), 'the loader fell back to fetching every file');
  assert.notEqual(sim.raw.chess, have.chess, 'no borrowed object reached the simulation');
  assert.ok(!Object.isFrozen(have.chess), 'and the page copy was left alone');
});

test('a set that is switched back to the original before the load starts is reused again', async () => {
  const have = pageFiles();
  const { fetched, fetchFn } = recorder();
  let owner = 'cs_plugin1';
  owner = null; // content.js setContent(null): the original files are back in the store
  const sim = await loadBrowserSim({ base, fetchFn, reuse: (n) => have[n] ?? null, reuseOwner: () => owner });
  assert.deepEqual(fetched, ['waves']);
  assert.equal(sim.raw.chess, have.chess);
});

test('the adopted copy stays localizable: a language overlay does not write into the frozen tree', async () => {
  const have = pageFiles();
  const { fetchFn } = recorder();
  await loadBrowserSim({ base, fetchFn, reuse: (n) => have[n] ?? null, reuseOwner: () => null });
  assert.ok(Object.isFrozen(have.chess));
  const first = Object.keys(have.chess)[0];
  const zh = have.chess[first].name;
  const before = JSON.stringify(have.chess[first]);
  // the real overlay shape: the English texts plus the hash of the Chinese ones they replace
  const overlay = { [first]: buildRecordOverlay([{ path: ['name'], zh, en: 'Insider (localized)' }]) };
  const out = applyFileOverlay(have.chess, overlay, have.chess);
  assert.ok(out.applied >= 1, 'the overlay applied');
  assert.notEqual(out.value, have.chess, 'the localized view is a new object');
  assert.equal(out.value[first].name, 'Insider (localized)');
  assert.equal(JSON.stringify(have.chess[first]), before, 'the frozen source is untouched');
});

test('a missing file still goes through the retry of the fetch path', async () => {
  const have = pageFiles();
  const asked = [];
  let wavesCalls = 0;
  const fetchFn = async (url) => {
    const name = /([^/]+)\.json$/.exec(url)[1];
    asked.push(name);
    if (name === 'waves' && ++wavesCalls === 1) return { ok: false, json: async () => null }; // first try fails
    return { ok: true, json: async () => read(name) };
  };
  const sim = await loadBrowserSim({ base, fetchFn, reuse: (n) => have[n] ?? null, reuseOwner: () => null });
  assert.equal(wavesCalls, 2, 'the second attempt fetched it again');
  assert.deepEqual(sim.raw.waves, read('waves'), 'and the retry produced the data');
  assert.deepEqual(asked.filter((n) => n !== 'waves'), [], 'nothing the page held was requested');
});

test('an explicit content set uses its own files and never the reuse hook', async () => {
  const have = pageFiles();
  let reuseCalls = 0;
  const set = {};
  for (const n of SIM_DATA_FILES) set[n] = { marker: n };
  const { fetched, fetchFn } = recorder();
  const sim = await loadBrowserSim({ base, fetchFn, data: set, cs: 'cs_plugin1',
    reuse: (n) => { reuseCalls++; return have[n] ?? null; }, reuseOwner: () => 'cs_plugin1' });
  assert.equal(reuseCalls, 0, 'the content set owns its records; the page store was not consulted');
  assert.deepEqual(fetched, [], 'and nothing was fetched');
  assert.notEqual(sim.raw.chess, set.chess, 'the set’s files are copied, not adopted');
  assert.deepEqual(sim.raw.chess, { marker: 'chess' });
});

test('a reuse hook without an ownership check is ignored', async () => {
  const have = pageFiles();
  const { fetched, fetchFn } = recorder();
  const sim = await loadBrowserSim({ base, fetchFn, reuse: () => { throw new Error('unowned reuse'); } });
  assert.deepEqual([...fetched].sort(), [...SIM_DATA_FILES].sort());
  assert.notEqual(sim.raw.chess, have.chess);
});
