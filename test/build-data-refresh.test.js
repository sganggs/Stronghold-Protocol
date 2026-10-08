// Issue #344: a failed --refresh must not feed an unverified stale table into the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = fileURLToPath(new URL('../tools/build-data.mjs', import.meta.url));
const source = await readFile(SCRIPT, 'utf8');
// Exercise the real downloader without running the CLI or needing full official game tables.
const begin = source.indexOf('async function ensureGamedata(');
const end = source.indexOf('/** Load (and cache in memory)', begin);
assert.ok(begin >= 0 && end > begin, 'locate the official-data downloader');
const downloaderSource = source.slice(begin, end);
const TABLES = ['excel/character_table.json', 'excel/skill_table.json'];
const OLD = '{"revision":"old"}';
const NEW = '{"revision":"new"}';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sp-data-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cache = join(dir, 'cache');
  await mkdir(join(cache, 'excel'), { recursive: true });
  for (const rel of TABLES) await writeFile(join(cache, rel), OLD);
  return { dir, cache };
}

function downloader(cache, fetchImpl, opts = { refresh: true }) {
  const requests = [], warnings = [];
  const env = {
    CACHE_DIR: cache, OPTS: { refresh: false, offline: false, ...opts },
    GAMEDATA_URL: 'https://example.invalid/gamedata/',
    existsSync, mkdir, dirname, join, writeFile, rename, process, AbortSignal,
    log: () => {}, warn: (message) => warnings.push(message),
    // Skip only retry delays; all attempts, JSON validation and file writes are real.
    setTimeout: (callback) => callback(),
    fetch: async (url) => { requests.push(url); return fetchImpl(url); },
  };
  const ensure = new Function(...Object.keys(env), `${downloaderSource}\nreturn ensureGamedata;`)(...Object.values(env));
  return { ensure, requests, warnings };
}

test('refresh rejects mixed fresh/stale inputs after one table exhausts its retries', async (t) => {
  const { cache } = await fixture(t);
  const { ensure, requests, warnings } = downloader(cache, async (url) => {
    if (url.endsWith('skill_table.json')) throw new Error('simulated outage');
    return new Response(NEW);
  });
  const results = await Promise.allSettled(TABLES.map(ensure));
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected', 'an old cache cannot satisfy a refresh');
  assert.match(results[1].reason.message, /cannot obtain excel\/skill_table.json: simulated outage/);
  assert.equal(requests.filter((url) => url.endsWith('skill_table.json')).length, 4);
  assert.equal(await readFile(join(cache, TABLES[0]), 'utf8'), NEW);
  assert.equal(await readFile(join(cache, TABLES[1]), 'utf8'), OLD);
  assert.deepEqual(warnings, [], 'download failure is fatal, not a stale-cache warning');
});

for (const [name, response] of [
  ['HTTP failure', () => new Response('', { status: 503 })],
  ['invalid JSON', () => new Response('{truncated')],
]) {
  test(`refresh rejects ${name} even with an existing cache`, async (t) => {
    const { cache } = await fixture(t);
    const { ensure, requests } = downloader(cache, response);
    await assert.rejects(ensure(TABLES[1]), /cannot obtain excel\/skill_table.json:/);
    assert.equal(requests.length, 4);
    assert.equal(await readFile(join(cache, TABLES[1]), 'utf8'), OLD);
  });
}

test('refresh without a cached table reports the download failure', async (t) => {
  const { cache } = await fixture(t);
  await rm(join(cache, TABLES[1]));
  const { ensure, requests } = downloader(cache, () => { throw new Error('simulated outage'); });
  await assert.rejects(ensure(TABLES[1]), /cannot obtain excel\/skill_table.json: simulated outage/);
  assert.equal(requests.length, 4);
  assert.equal(existsSync(join(cache, TABLES[1])), false);
});

test('successful refresh replaces every cached table', async (t) => {
  const { cache } = await fixture(t);
  const { ensure, requests, warnings } = downloader(cache, () => new Response(NEW));
  const files = await Promise.all(TABLES.map(ensure));
  assert.deepEqual(await Promise.all(files.map((file) => readFile(file, 'utf8'))), [NEW, NEW]);
  assert.equal(requests.length, 2);
  assert.deepEqual(warnings, []);
});

test('refresh can recover on the final retry', async (t) => {
  const { cache } = await fixture(t);
  let attempts = 0;
  const { ensure, warnings } = downloader(cache, () => {
    if (++attempts < 4) throw new Error('temporary outage');
    return new Response(NEW);
  });
  assert.equal(await readFile(await ensure(TABLES[1]), 'utf8'), NEW);
  assert.equal(attempts, 4);
  assert.deepEqual(warnings, []);
});

for (const offline of [false, true]) {
  test(`${offline ? 'offline' : 'normal'} mode reuses cached tables without a request`, async (t) => {
    const { cache } = await fixture(t);
    const { ensure, requests } = downloader(cache, () => { throw new Error('unexpected request'); }, { offline });
    assert.equal(await readFile(await ensure(TABLES[1]), 'utf8'), OLD);
    assert.deepEqual(requests, []);
  });
}

test('offline mode rejects a missing table without a request', async (t) => {
  const { cache } = await fixture(t);
  await rm(join(cache, TABLES[1]));
  const { ensure, requests } = downloader(cache, () => { throw new Error('unexpected request'); }, { offline: true });
  await assert.rejects(ensure(TABLES[1]), /missing cached file excel\/skill_table.json \(offline mode\)/);
  assert.deepEqual(requests, []);
});

for (const force of [false, true]) {
  test(`CLI refresh failure leaves generated files untouched${force ? ' even with --force' : ''}`, async (t) => {
    const { dir, cache } = await fixture(t);
    const out = join(dir, 'data');
    const report = join(dir, 'report.json');
    await mkdir(out);
    for (const name of ['chess.json', 'config.json']) await writeFile(join(out, name), OLD);
    await writeFile(report, OLD);
    const preload = join(dir, 'mock-fetch.mjs');
    await writeFile(preload, `
      globalThis.fetch = async (url) => {
        if (url.endsWith('/skill_table.json')) throw new Error('simulated outage');
        return new Response(${JSON.stringify(NEW)});
      };
    `);
    const result = spawnSync(process.execPath, [
      '--import', pathToFileURL(preload).href, SCRIPT,
      '--refresh', '--cache', cache, '--out', out, '--report', report,
      ...(force ? ['--force'] : []),
    ], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    // A schema error from these tiny fixtures would also exit 1: require the actual download error.
    assert.match(result.stderr, /cannot obtain excel\/skill_table.json: simulated outage/);
    assert.doesNotMatch(result.stdout + result.stderr, /using stale cache|building…/);
    assert.equal(await readFile(join(cache, TABLES[0]), 'utf8'), NEW, 'another download succeeded');
    assert.equal(await readFile(join(cache, TABLES[1]), 'utf8'), OLD);
    assert.deepEqual((await readdir(out)).sort(), ['chess.json', 'config.json']);
    for (const name of ['chess.json', 'config.json']) assert.equal(await readFile(join(out, name), 'utf8'), OLD);
    assert.equal(await readFile(report, 'utf8'), OLD);
  });
}
