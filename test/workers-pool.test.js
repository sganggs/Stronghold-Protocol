// test/workers-pool.test.js — the bounded CPU pool (server/workers/pool.js) on its own.
// Extracted verbatim from test/workers.test.js (authored by @xinhai-ai) so that the pool module can be
// reviewed and merged independently of the room / match worker pools that build on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SimulationPool, createSimulationPool, workerSettings } from '../server/workers/pool.js';

const fixture = new URL('./fixtures/pool-worker.mjs', import.meta.url);
const fixturePool = (opts = {}) => new SimulationPool({ size: 1, workerUrl: fixture, ...opts });
async function until(pred) {
  const deadline = Date.now() + 10000;
  while (!pred()) {
    if (Date.now() > deadline) assert.fail('condition did not complete');
    await delay(5);
  }
}

test('worker settings are opt-in: no SP_WORKERS means no pool', () => {
  // The pool starts threads only when the operator asked for them. Unset, empty, junk and 0 all mean "off".
  assert.equal(workerSettings({}, 1).size, 0, 'unset starts nothing');
  assert.equal(workerSettings({}, 32).size, 0);
  assert.equal(workerSettings({ SP_WORKERS: '' }, 8).size, 0);
  assert.equal(workerSettings({ SP_WORKERS: '0' }, 8).size, 0);
  assert.equal(workerSettings({ SP_WORKERS: '-1' }, 8).size, 0, 'out of range falls back to off, not to the CPU budget');
  assert.equal(workerSettings({ SP_WORKERS: 'junk' }, 8).size, 0);
  assert.equal(workerSettings({ SP_WORKERS: '33' }, 32).size, 0);
  assert.equal(workerSettings({ SP_WORKERS: '1' }, 8).size, 1);
  assert.equal(workerSettings({ SP_WORKERS: '8' }, 32).size, 8);
  assert.deepEqual(workerSettings({ SP_WORKERS: '3', SP_WORKER_QUEUE: '9', SP_WORKER_TIMEOUT_MS: '456' }),
    { size: 3, maxQueue: 9, timeoutMs: 456 });
  assert.deepEqual(workerSettings({}, 8), { size: 0, maxQueue: 256, timeoutMs: 120000 }, 'the queue bounds keep their defaults');
});

test('bounded queue, priority, queued cancellation, and thread reuse', async (t) => {
  const pool = fixturePool({ maxQueue: 2 });
  t.after(() => pool.close());
  const active = pool.submit('burn', { ms: 100, value: 'active' });
  const cancelled = pool.submit('burn', { value: 'cancelled' });
  const cancellation = assert.rejects(cancelled.promise, { code: 'TASK_CANCELLED' });
  cancelled.cancel();
  await cancellation;
  const order = [];
  const low = pool.submit('burn', { value: 'low' });
  const high = pool.submit('burn', { value: 'high' }, { priority: 2 });
  low.promise.then((x) => order.push(x));
  high.promise.then((x) => order.push(x));
  await assert.rejects(pool.submit('burn', {}).promise, { code: 'POOL_FULL' });
  assert.equal(await active.promise, 'active');
  await Promise.all([low.promise, high.promise]);
  assert.deepEqual(order, ['high', 'low']);
  assert.equal(pool.stats().threads, 1);
  assert.equal(pool.stats().completed, 3);
  assert.ok(pool.stats().avgComputeMs > 0);
  assert.equal(pool.stats().avgComputeMs, pool.stats().computeMs / pool.stats().completed);
});

test('worker CPU does not block the parent event loop', async (t) => {
  const pool = fixturePool();
  t.after(() => pool.close());
  await pool.submit('burn', {}).promise; // exclude startup
  let done = false;
  const work = pool.submit('burn', { ms: 150 }).promise.then(() => { done = true; });
  await delay(20);
  assert.equal(done, false, 'the main thread handles timers while a worker computes');
  await work;
});

test('crashed / timed out workers are replaced; running cancellation and shutdown settle promises', async (t) => {
  const pool = fixturePool({ timeoutMs: 5000 });
  t.after(() => pool.close());
  await assert.rejects(pool.submit('crash', {}).promise, { code: 'WORKER_FAILED' });
  assert.equal(await pool.submit('burn', { value: 7 }).promise, 7);
  pool.timeoutMs = 50;
  await assert.rejects(pool.submit('hang', {}).promise, { code: 'TASK_TIMEOUT' });
  pool.timeoutMs = 5000;
  assert.equal(await pool.submit('burn', { value: 8 }).promise, 8);
  const active = pool.submit('burn', { ms: 100 });
  const cancelled = assert.rejects(active.promise, { code: 'TASK_CANCELLED' });
  active.cancel();
  await cancelled;
  const queued = pool.submit('burn', {});
  const closed = assert.rejects(queued.promise, { code: 'POOL_CLOSED' });
  await pool.close();
  await closed;
  await assert.rejects(pool.submit('burn', {}).promise, { code: 'POOL_CLOSED' });
});

test('no pool is created unless SP_WORKERS says which size', async () => {
  // Unset, empty, junk and the explicit 0 all leave the work inline; the server behaves exactly as before the pool existed.
  assert.equal(createSimulationPool({ data: {}, env: {} }), null, 'unset starts no pool');
  assert.equal(createSimulationPool({ data: {}, env: { SP_WORKERS: '' } }), null);
  assert.equal(createSimulationPool({ data: {}, env: { SP_WORKERS: 'junk' } }), null);
  assert.equal(createSimulationPool({ data: {}, env: { SP_WORKERS: '0' } }), null, 'no pool, the work stays inline');
  const pool = createSimulationPool({ data: {}, env: { SP_WORKERS: '1' }, workerUrl: fixture });
  try {
    assert.ok(pool instanceof SimulationPool, 'a size of 1 is an ordinary pool');
    assert.equal(pool.size, 1);
  } finally {
    await pool.close();
  }
});

test('a retiring thread keeps its place until terminate() resolves', async (t) => {
  const pool = fixturePool();
  t.after(() => pool.close());
  let release;
  const stopping = new Promise((resolve) => { release = resolve; });
  const stub = { worker: { terminate: () => stopping, threadId: 999, ref() {}, unref() {} }, task: null, retired: false };
  pool.slots.add(stub);                             // the one thread of this pool, sent into retirement
  pool._retire(stub);
  assert.equal(pool.stats().threads, 1, 'the terminating thread still counts against the size');
  assert.equal(pool.slots.size, 1);

  const run = pool.submit('burn', { value: 9 });
  assert.equal(pool.stats().threads, 1, 'and no thread beyond the size is started while it stops');
  assert.equal(pool.stats().busy, 0, 'the queued task waits for the slot instead of over-subscribing');

  release();                                        // terminate() resolves: the slot is released and the queue drains
  assert.equal(await run.promise, 9);
  await until(() => pool.terminations.size === 0);
  assert.equal(pool.stats().threads, 1);
});

test('a stuck terminate() cannot make repeated submits overrun the queue', async (t) => {
  // The maintainer's case: one thread is retiring, terminate() never settles, its task is already null. A submit() that
  // counted that slot as free would let the queue grow past SP_WORKER_QUEUE on every call.
  const pool = fixturePool({ maxQueue: 2 });
  t.after(() => pool.close());
  let release;
  const stopping = new Promise((resolve) => { release = resolve; });
  const stub = { worker: { terminate: () => stopping, threadId: 998, ref() {}, unref() {} }, task: null, retired: false };
  pool.slots.add(stub);
  pool._retire(stub);
  assert.equal(pool.slots.size, 1, 'the slot still occupies the size budget');
  assert.equal(pool.stats().busy, 0, 'and it is not busy — which is exactly what used to look free');

  const first = pool.submit('burn', { value: 1 });
  const second = pool.submit('burn', { value: 2 });
  assert.equal(pool.queue.length, 2, 'the queue fills to its bound');
  // Repeated submits while terminate() hangs are all refused instead of pushing the queue past the bound.
  for (let i = 0; i < 20; i++) {
    const over = pool.submit('burn', { value: 100 + i });
    await assert.rejects(over.promise, { code: 'POOL_FULL' });
    assert.equal(pool.queue.length, 2, `submit ${i} did not grow the queue`);
  }
  assert.equal(pool.stats().rejected, 20, 'every refused submit is counted');
  assert.equal(pool.stats().threads, 1, 'and no thread beyond the size was started');

  release();
  assert.equal(await first.promise, 1);
  assert.equal(await second.promise, 2);
  await until(() => pool.terminations.size === 0);
  assert.equal(pool.stats().threads, 1);
});
