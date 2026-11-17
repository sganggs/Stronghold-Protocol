// test/workers-room.test.js — the shared simulation pool every room submits its rehearsals into
// (server/workers/roomPool.js).
//
// Two things are checked here: it is ONE pool (no lane and no room can add threads of its own), and the work it runs —
// a bot prep's layout rehearsal — picks exactly the candidate the main thread picks from the same candidates. That
// second one is the maintainer's comparison: one real prep's candidates, two places to run them, one answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { RoomWorkerPool, createRoomWorkerPool } from '../server/workers/roomPool.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { DataSource } from '../server/sim/simdata.js';
import { HeadlessJob } from '../server/match/fields.js';
import { RehearsalRun } from '../server/sim/rehearsal.js';
import { makeMatch, DATA } from './match/harness.js';

const fixture = new URL('./fixtures/pool-worker.mjs', import.meta.url);

test('every room submits into the one pool and the pool never exceeds its size', async (t) => {
  const pool = new RoomWorkerPool({ data: DATA, totalWorkers: 2, maxQueue: 16, workerUrl: fixture });
  t.after(() => pool.close());
  const first = pool.assign('room:A');
  const same = pool.assign('room:A');
  const second = pool.assign('room:B');
  assert.equal(first, same, 'a room keeps resolving to the same pool');
  assert.equal(first, second, 'and every room submits into that one pool');
  let stats = pool.stats();
  assert.equal(stats.kind, 'room-pool');
  assert.equal(stats.size, 2, 'the size is the whole pool, not a size per room');
  assert.equal(stats.rooms, 2);

  const runs = ['room:A', 'room:B', 'room:C', 'room:D'].map((key, i) => pool.assign(key).submit('burn', { ms: 60, value: i }));
  await delay(20);
  assert.ok(pool.stats().threads <= 2, `four rooms must not create four threads (got ${pool.stats().threads})`);
  assert.deepEqual((await Promise.all(runs.map((r) => r.promise))).sort(), [0, 1, 2, 3]);

  stats = pool.stats();
  assert.equal(stats.rooms, 4);
  pool.release('room:A');
  assert.equal(pool.stats().rooms, 3, 'release only forgets the key');
  for (const key of ['room:B', 'room:C', 'room:D']) pool.release(key);
  assert.equal(pool.stats().rooms, 0);
});

test('an overloaded pool refuses the task instead of starting another thread', async (t) => {
  const pool = new RoomWorkerPool({ data: DATA, totalWorkers: 1, maxQueue: 0, workerUrl: fixture });
  t.after(() => pool.close());
  const busy = pool.assign('room:A').submit('burn', { ms: 80, value: 1 });
  await assert.rejects(pool.assign('room:B').submit('burn', { value: 2 }).promise, { code: 'POOL_FULL' });
  assert.equal(await busy.promise, 1);
  assert.equal(pool.stats().threads, 1);
});

test('no pool is created unless SP_WORKERS says which size', async () => {
  assert.equal(createRoomWorkerPool({ data: DATA, env: {} }), null, 'unset starts no pool');
  assert.equal(createRoomWorkerPool({ data: DATA, env: { SP_WORKERS: 'junk' } }), null);
  assert.equal(createRoomWorkerPool({ data: DATA, env: { SP_WORKERS: '0' } }), null);
  const pool = createRoomWorkerPool({ data: DATA, env: { SP_WORKERS: '2' }, workerUrl: fixture });
  assert.ok(pool instanceof RoomWorkerPool);
  assert.equal(pool.stats().size, 2);
  return pool.close();
});

/**
 * A real bot prep's rehearsal candidates and the answer the main thread gets for them.
 *
 * The counters the rehearsal compares are the ones the match itself would use: the candidates are built by the match's
 * own `newBattle(…, { preview: true })` from the very inputs it hands its rehearsal, so the expected index below is
 * produced by the same code path an inline rehearsal runs.
 * @returns {{ playerId: string, cap: number, inputs: object[], pick: number }}
 */
function capturedPrep() {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
    { seat: 2, playerId: 'ai_1', name: 'AI1', isBot: true, connected: true },
  ];
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 3, botRehearsal: 3, hostId: 'p_0', botRehearsalDelegate: true }).start();
  const frames = [];
  h.onSend.push((pid, msg) => { if (msg.t === 'b.rehearsal') frames.push(msg); });
  try {
    // one human alone is untimed: drive its decisions so the AI seats reach their rehearsals
    h.drive(() => frames.length >= 1 || h.ended != null, { ready: true });
    assert.ok(frames.length >= 1, 'the match delegated a rehearsal');
    const frame = frames[0];
    // the specs the browser is handed are built from the job's own inputs; rebuild the inputs from them, so the pool and
    // the main thread below start from exactly the bytes the match produced
    const inputs = frame.specs.map((spec) => specToOpts(spec));
    const inline = new RehearsalRun(inputs.map((o) => () => h.m.newBattle(o, { preview: true })), frame.playerId, frame.cap);
    inline.run();
    return { playerId: frame.playerId, cap: frame.cap, inputs, pick: inline.score.index };
  } finally {
    h.m.dispose();
  }
}

/**
 * A BattleSpec back into the Battle options it was built from (server/sim/spec.js buildBattleSpec). Only the fields a
 * rehearsal candidate needs; the worker builds its Battle from these.
 */
function specToOpts(spec) {
  return {
    seed: spec.seed,
    kind: spec.kind,
    modeId: spec.modeId,
    round: spec.round,
    stageId: spec.stageId,
    rect: spec.rect,
    timeLimit: spec.timeLimit,
    players: spec.players,
    spawns: spec.spawns,
    routes: spec.routes,
    sharedBoss: spec.sharedBoss ?? null,
    flags: spec.flags,
    fieldId: spec.fieldId,
    enemyOverrides: spec.enemyOverrides,
    waveId: spec.waveId,
  };
}

test('the pool picks exactly the candidate the main thread picks, from the same prep', async (t) => {
  const prep = capturedPrep();
  const pool = new RoomWorkerPool({ data: DATA, totalWorkers: 2, maxQueue: 8 });
  t.after(() => pool.close());
  const value = await pool.submit('rehearsal', {
    specs: prep.inputs.map((o) => buildBattleSpec(o)), playerId: prep.playerId, cap: prep.cap,
  }).promise;
  assert.equal(typeof value.bestIndex, 'number');
  assert.equal(value.bestIndex, prep.pick, `the pool must pick ${prep.pick}, picked ${value.bestIndex}`);
});

test('a whole battle run in the pool matches the main thread byte for byte', async (t) => {
  const opts = {
    battleId: 'pool-compare', fieldId: 'n:p_0', kind: 'normal', seed: 424242, modeId: 'mode_single_normal',
    round: 1, stageId: 1, rect: { x: 0, y: 0, w: 1920, h: 1080 }, timeLimit: 60,
    players: [{ playerId: 'p_0', side: 'L', colOffset: 0 }], spawns: [], routes: [], flags: {}, content: 'full',
  };
  const spec = buildBattleSpec(opts);
  const local = new HeadlessJob(createBattleFromSpec(spec, new DataSource(DATA, null), { quiet: true, recordEvents: false }),
    { players: ['p_0'] });
  while (!local.run(4));
  const want = local.output();

  const pool = new RoomWorkerPool({ data: DATA, totalWorkers: 1, maxQueue: 4 });
  t.after(() => pool.close());
  const got = await pool.assign('room:A').submit('battle', { spec, players: ['p_0'] }).promise;
  assert.deepEqual(got.timeline, want.timeline, 'the sampled timeline is identical');
  assert.deepEqual(got.result, want.result, 'so is the final result');
  assert.equal(got.time, want.battle.time);
  assert.equal(got.crashed, false, `the battle must not crash (errors: ${JSON.stringify(got.errors)})`);
  assert.equal(got.errors.length, 0);
});

test('the simulation worker loads with the real module graph (a wrong export name fails here)', async () => {
  const worker = new Worker(new URL('../server/workers/simulation.js', import.meta.url), { workerData: { data: DATA } });
  try {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the worker never answered')), 20000);
      worker.once('message', (msg) => { clearTimeout(timer); resolve(msg); });
      worker.once('error', (err) => { clearTimeout(timer); reject(err); });
      worker.postMessage({ id: 1, type: 'not-a-task', payload: {}, cancel: new Int32Array(new SharedArrayBuffer(4)).buffer });
    });
    assert.deepEqual(reply, { id: 1, error: 'unknown simulation task: not-a-task', memory: reply.memory });
    assert.ok(reply.memory && reply.memory.heapUsed > 0);
  } finally {
    await worker.terminate();
  }
});


test('boss specs cross the real pool, preserve the cap and obey adaptive tick limits', async (t) => {
  const pool = new RoomWorkerPool({ data: DATA, totalWorkers: 1 });
  t.after(() => pool.close());
  const { SharedBossPool } = await import('../server/match/finalAssault.js');
  const sharedBoss = new SharedBossPool(1000000);
  const spec = buildBattleSpec({ kind: 'boss', seed: 42, modeId: 'mode_single_normal', round: 14,
    timeLimit: Infinity, players: [{ playerId: 'p_0', side: 'L', colOffset: 0 }], spawns: [], routes: [],
    sharedBoss, boss: { poolHp: sharedBoss.hp, poolMax: sharedBoss.maxHp }, flags: {} });
  assert.equal(spec.sharedBoss, undefined);
  assert.ok(spec.boss.poolHp > 0);
  for (const limits of [null, { stage: 3, tickBudget: 2 }]) {
    const cap = 7, specs = [spec, spec];
    const local = new RehearsalRun(specs.map((s) => () => createBattleFromSpec(s, new DataSource(DATA, null))), 'p_0', cap, limits || {});
    local.run();
    const got = await pool.submit('rehearsal', { specs, playerId: 'p_0', cap, limits }).promise;
    assert.equal(got.bestIndex, local.score.index);
    assert.equal(got.stats.totalTicks, local.totalTicks);
    assert.ok(local.totalTicks > 0, 'the boss actually steps under the supplied limits');
    assert.equal(got.stats.completed, local.completed);
    assert.ok(got.stats.totalTicks <= (limits?.tickBudget || 2 * cap));
  }
  const threadId = pool.stats().memory[0].threadId;
  const pending = pool.submit('rehearsal', { specs: [spec], playerId: 'p_0', cap: 1e9 });
  const rejected = assert.rejects(pending.promise, { code: 'TASK_CANCELLED' });
  await delay(20);
  pending.cancel();
  await rejected;
  await pool.submit('rehearsal', { specs: [spec], playerId: 'p_0', cap: 1 }).promise;
  assert.equal(pool.stats().memory[0].threadId, threadId, 'cooperative cancellation reuses the worker');
});
