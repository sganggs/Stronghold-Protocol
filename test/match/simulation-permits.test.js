import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { simulationPermitCount, createSimulationBroker, SIMULATION_GRANT_MS, SIMULATION_ORPHAN_MS } from '../../server/rooms/simulationBroker.js';
import { createSimulationPermitClient } from '../../server/rooms/simulationClient.js';
import { configureSimulationSlices } from '../../shared/simulationSlices.js';
import { HeadlessJob, FieldRunner, HeadlessPacer } from '../../server/match/fields.js';
import { RehearsalRun } from '../../server/sim/rehearsal.js';
import { createPeer } from '../../server/rooms/peer.js';
import { createMatchHosts } from '../../server/match/host/index.js';
import { contentHashOf } from '../../shared/plugins/identity.js';
import { startServer } from '../../server/index.js';
import { writePlugin } from '../helpers/pluginFixtures.js';

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (check()) return; await pause(5); } // loop-cap: deadline
  throw new Error('condition timed out');
}
function oneStep(step = () => {}) {
  return { time: 0, tickCount: 0, finished: false,
    step() { step(); this.tickCount++; this.time += 1 / 30; this.finished = true; },
    result: () => ({ perPlayer: { p: { killed: 1, leaked: [] } }, time: 0 }),
    forceEnd() { this.finished = true; }, drainEvents: () => [],
  };
}

test('simulation permits are opt-in and each supervisor owns an independent broker', () => {
  assert.equal(simulationPermitCount(undefined), 0);
  assert.equal(simulationPermitCount(0), 0);
  for (const value of ['', 'invalid', 1.5, -1, 65]) {
    const warnings = [];
    assert.equal(simulationPermitCount(value, (warning) => warnings.push(warning)), 0);
    assert.equal(warnings.length, 1);
  }
  const a = createSimulationBroker(1), b = createSimulationBroker(1);
  a.register('room', process.pid); b.register('room', process.pid);
  const lease = a.acquire('room', { executor: 'main', pid: process.pid, request: 1 });
  assert.ok(lease);
  assert.equal(a.acquire('room', { executor: 'other', pid: process.pid, request: 1 }), null);
  assert.ok(b.acquire('room', { executor: 'other', pid: process.pid, request: 1 }));
  a.release('other-room', 'main', lease); a.cancel('room', 'main', 2);
  assert.equal(a.stats().held, 1, 'another owner or request cannot release this lease');
  a.cancel('room', 'main', 1);
  const replacement = a.acquire('room', { executor: 'main', pid: process.pid, request: 2 });
  a.release('room', 'main', lease);
  assert.equal(a.stats().held, 1, 'an obsolete release cannot free a replacement');
  a.release('room', 'main', replacement); a.release('room', 'main', replacement);
  assert.equal(a.stats().held, 0);
  const active = a.acquire('room', { executor: 'main', pid: process.pid, request: 3 });
  a.begin('room', 'main', active); a.cancel('room', 'main', 3);
  assert.equal(a.stats().held, 1, 'a cancellation cannot reclaim a begun slice');
  a.release('room', 'main', active);
  a.close(); b.close();
});

test('an environment value alone leaves standalone finite simulations direct', () => {
  const previous = process.env.SP_SIM_PERMITS;
  process.env.SP_SIM_PERMITS = '1';
  try { assert.equal(new HeadlessJob(oneStep()).run(1), true); }
  finally { if (previous === undefined) delete process.env.SP_SIM_PERMITS; else process.env.SP_SIM_PERMITS = previous; }
});

test('broker-side idle expiry denies a delayed claim and never expires an active replacement', () => {
  const timers = [];
  const broker = createSimulationBroker(1, {
    setTimer: (fn, delay) => { const timer = { fn, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.cleared = true; },
  });
  broker.register('room', process.pid);
  const old = broker.acquire('room', { executor: 'main', pid: process.pid, request: 1 });
  assert.equal(timers[0].delay, SIMULATION_GRANT_MS);
  timers[0].fn(); assert.equal(broker.stats().held, 0);
  const replacement = broker.acquire('room', { executor: 'main', pid: process.pid, request: 2 });
  assert.equal(broker.begin('room', 'main', old), false);
  assert.equal(broker.begin('room', 'main', replacement), true);
  assert.equal(timers[1].cleared, true);
  timers[0].fn(); timers[1].fn();
  broker.cancel('room', 'main', 1); broker.release('room', 'main', old);
  assert.equal(broker.stats().held, 1);
  broker.release('room', 'main', replacement); broker.close();
});

test('dead room brokers retain live or uncertain independent executors until confirmed exit', () => {
  let status = false;
  const broker = createSimulationBroker(1, { hasExited: () => { if (status === 'unknown') throw new Error('EPERM'); return status; } });
  broker.register('room', 10);
  const lease = broker.acquire('room', { executor: 'content', pid: 11, request: 1 });
  assert.ok(lease);
  assert.equal(broker.begin('room', 'content', lease), true);
  broker.brokerExited('room');
  assert.deepEqual(broker.stats(), { limit: 1, held: 1, orphaned: 1 });
  status = 'unknown'; broker.prune();
  assert.equal(broker.stats().held, 1);
  status = true; broker.prune();
  assert.equal(broker.stats().held, 0);
  broker.close();
});

test('unclaimed deadlines are checked even while the expiry callback is delayed', () => {
  let clock = 0;
  const broker = createSimulationBroker(1, { now: () => clock, setTimer: () => null, clearTimer() {} });
  broker.register('room', process.pid);
  const lease = broker.acquire('room', { executor: 'main', pid: process.pid, request: 1 });
  clock = SIMULATION_GRANT_MS;
  assert.equal(broker.begin('room', 'main', lease), false);
  assert.equal(broker.stats().held, 0);
  broker.close();
});

test('orphan recovery has a bounded timeout despite ambiguous liveness or PID reuse', () => {
  let clock = 0;
  const broker = createSimulationBroker(1, { now: () => clock, hasExited: () => false,
    setTimer: () => null, clearTimer() {} });
  broker.register('room', 10);
  const lease = broker.acquire('room', { executor: 'content', pid: 11, request: 1 });
  broker.begin('room', 'content', lease);
  clock = 500; broker.brokerExited('room');
  clock += SIMULATION_ORPHAN_MS - 1; broker.prune();
  assert.equal(broker.stats().held, 1);
  broker.brokerExited('room'); // A duplicate notification must not extend the recovery deadline.
  clock++; broker.prune();
  assert.deepEqual(broker.stats(), { limit: 1, held: 0, orphaned: 0 });
  broker.close();
});

test('orphan expiry also runs without another acquisition or liveness notification', async (t) => {
  const broker = createSimulationBroker(1, { hasExited: () => false, orphanMs: 25 });
  t.after(() => broker.close());
  broker.register('room', 10);
  const lease = broker.acquire('room', { executor: 'content', pid: 11, request: 1 });
  broker.begin('room', 'content', lease); broker.brokerExited('room');
  await until(() => broker.stats().held === 0);
});

test('denied acquisition backs off from 25 to 200 ms while local pumps keep retrying', async (t) => {
  let clock = 0, attempts = 0, allow = false;
  const client = createSimulationPermitClient({ acquire: () => { attempts++; return allow ? attempts : null; },
    begin: () => true, cancel() {}, release() {} }, { now: () => clock });
  t.after(() => client.close());
  client.enter(); await pause();
  assert.equal(attempts, 1);
  for (const delay of [25, 50, 100, 200, 200]) {
    const before = attempts;
    for (let i = 1; i < delay; i++) { clock++; client.enter(); }
    await pause(); assert.equal(attempts, before, 'local polling does not send another IPC request');
    clock++; client.enter(); await pause(); assert.equal(attempts, before + 1);
  }
  allow = true; clock += 200; client.enter(); await pause();
  const finish = client.enter(); assert.equal(typeof finish, 'function'); finish();
  const before = attempts;
  client.enter(); await pause(); assert.equal(attempts, before + 1, 'a consumed grant resets backoff');
});

test('a delayed local timer cannot execute a grant past its deadline', async (t) => {
  let clock = 0;
  const releases = [];
  const client = createSimulationPermitClient({ acquire: () => 1, begin: () => true, cancel() {},
    release: (lease) => releases.push(lease) }, { now: () => clock });
  t.after(() => client.close());
  client.enter(); await pause(); assert.equal(client.stats().granted, true);
  clock = SIMULATION_GRANT_MS;
  assert.equal(client.enter(), null);
  assert.deepEqual(releases, [1]);
});

test('denial and synchronous transport errors reset waiting without throwing into a slice', async (t) => {
  let attempts = 0;
  const cancelled = [];
  const client = createSimulationPermitClient({
    acquire() { if (++attempts === 1) throw new Error('IPC unavailable'); return null; },
    cancel: (request) => cancelled.push(request), release() {},
  }, { retryMinMs: 0, retryMaxMs: 0 });
  t.after(() => client.close());
  assert.equal(client.enter(), null); assert.equal(client.enter(), null);
  await pause();
  assert.equal(client.stats().waiting, false);
  assert.deepEqual(cancelled, [1]);
  assert.equal(client.enter(), null); await pause();
  assert.equal(attempts, 2); assert.equal(client.stats().waiting, false);
});

test('waiting timeouts cancel only stale requests; idle grants expire and active slices retain their lease', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let clock = 0;
  const advance = (ms) => { clock += ms; t.mock.timers.tick(ms); };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  let resolveOld, attempts = 0;
  const releases = [], cancelled = [];
  const pending = new Promise((resolve) => { resolveOld = resolve; });
  const client = createSimulationPermitClient({
    acquire: () => ++attempts === 1 ? pending : Promise.resolve(attempts),
    begin: () => true,
    cancel: (request) => cancelled.push(request), release: (lease) => releases.push(lease),
  }, { timeoutMs: 10, idleMs: 20, retryMinMs: 0, retryMaxMs: 0, now: () => clock });
  t.after(() => client.close());
  client.enter(); await flush(); advance(30); await flush();
  assert.equal(client.stats().waiting, false); assert.deepEqual(cancelled, [1]);
  client.enter(); await flush();
  const release = client.enter(); assert.equal(typeof release, 'function');
  resolveOld(1); await flush(); advance(30); await flush();
  assert.deepEqual(releases, [1], 'a late reply is returned, while the consumed grant has no timer');
  release(); release(); assert.deepEqual(releases, [1, 2]);
  client.enter(); await flush(); advance(35); await flush();
  assert.deepEqual(releases, [1, 2, 3], 'an unused grant returns after the idle limit');
});

test('an absent or denied claim cannot make a grant runnable', async (t) => {
  const releases = [], clients = [];
  t.after(() => clients.forEach((client) => client.close()));
  for (const begin of [undefined, () => false]) {
    const client = createSimulationPermitClient({ acquire: () => 1, begin, cancel() {}, release: (lease) => releases.push(lease) });
    clients.push(client); client.enter(); await pause();
    assert.equal(client.stats().granted, false); assert.equal(client.stats().claiming, false);
  }
  assert.deepEqual(releases, [1, 1]);
});

for (const delayed of ['claim', 'ack']) test(`an expired ${delayed} continuation cannot execute after a replacement lease starts`, async (t) => {
  const broker = createSimulationBroker(1);
  broker.register('room', process.pid);
  let resumeFirst, claims = 0;
  const client = createSimulationPermitClient({
    acquire: (request) => broker.acquire('room', { executor: 'main', pid: process.pid, request }),
    begin: (lease) => {
      if (++claims !== 1) return broker.begin('room', 'main', lease);
      const accepted = delayed === 'ack' ? broker.begin('room', 'main', lease) : null;
      return new Promise((resolve) => { resumeFirst = () => resolve(delayed === 'claim' ? broker.begin('room', 'main', lease) : accepted); });
    },
    cancel: (request) => broker.cancel('room', 'main', request),
    release: (lease) => broker.release('room', 'main', lease),
  }, { timeoutMs: 1000, idleMs: 30, retryMinMs: 0, retryMaxMs: 0 });
  t.after(() => { client.close(); broker.close(); });
  assert.equal(client.enter(), null);
  await until(() => resumeFirst);
  assert.equal(client.enter(), null, 'claim acknowledgement is required before any slice');
  await until(() => broker.stats().held === 0);
  assert.equal(client.enter(), null);
  await until(() => client.stats().granted);
  const finish = client.enter(); assert.equal(typeof finish, 'function');
  assert.equal(broker.stats().held, 1);
  resumeFirst(); await pause();
  broker.cancel('room', 'main', 1); broker.cancel('room', 'main', 2);
  assert.equal(client.stats().granted, false, 'a stale acknowledgement cannot make work runnable');
  assert.equal(broker.stats().held, 1, 'stale cleanup and cancellation preserve the active replacement');
  client.close(); assert.equal(broker.stats().held, 1, 'closing a client does not release its running slice');
  finish(); assert.equal(broker.stats().held, 0);
});

test('a claim acknowledgement timeout resets the client and returns only its never-executed lease', async (t) => {
  const broker = createSimulationBroker(1);
  broker.register('room', process.pid);
  let attempts = 0;
  const client = createSimulationPermitClient({
    acquire: (request) => broker.acquire('room', { executor: 'main', pid: process.pid, request }),
    begin: (lease) => { const accepted = broker.begin('room', 'main', lease); return ++attempts === 1 ? new Promise(() => {}) : accepted; },
    cancel: (request) => broker.cancel('room', 'main', request),
    release: (lease) => broker.release('room', 'main', lease),
  }, { timeoutMs: 10, idleMs: 1000, retryMinMs: 0, retryMaxMs: 0 });
  t.after(() => { client.close(); broker.close(); });
  client.enter(); await until(() => attempts === 1);
  await until(() => broker.stats().held === 0);
  assert.equal(client.stats().claiming, false);
  client.enter(); await until(() => client.stats().granted);
  const finish = client.enter(); assert.equal(typeof finish, 'function');
  await pause(25); assert.equal(broker.stats().held, 1, 'the expired previous claim timer cannot reclaim this running lease');
  finish(); assert.equal(broker.stats().held, 0);
});

test('explicit slice hooks share nested work and leave synchronous tools direct', () => {
  let acquired = 0, released = 0, allowed = false, steps = 0;
  const remove = configureSimulationSlices(() => { acquired++; return allowed ? () => released++ : null; });
  try {
    const inner = new HeadlessJob(oneStep(() => steps++));
    const rehearsal = new RehearsalRun([() => oneStep(() => assert.equal(inner.run(1), true))], 'p', 30);
    const outer = new HeadlessJob(oneStep(() => assert.equal(rehearsal.run(() => false), true)));
    assert.equal(outer.run(1), false); assert.equal(steps, 0);
    allowed = true;
    assert.equal(outer.run(1), true);
    assert.equal(steps, 1); assert.equal(acquired, 2); assert.equal(released, 1);
    allowed = false;
    assert.equal(new HeadlessJob(oneStep()).run(Infinity), true);
    assert.equal(new RehearsalRun([() => oneStep()], 'p', 30).run(), true);
    assert.equal(acquired, 2, 'synchronous calls do not enter the live cooperative scheduler');
    const m = { sched: { now: () => 30, clearInterval() {} }, paused: false, markPublic() {},
      reportError: (where, error) => { throw new Error(where, { cause: error }); }, watchersOf: () => [] };
    const runner = new FieldRunner(m, [{ fieldId: 'f', players: ['p'], battle: oneStep() }], { onDone() {} });
    runner._pump(); assert.equal(runner.ticks, 0);
    allowed = true; runner._pump(); assert.equal(runner.ticks, 1);
    const pacer = new HeadlessPacer(m), battle = oneStep();
    pacer.entries.add({ battle, onDone() {} });
    allowed = false; pacer._pump(); assert.equal(battle.tickCount, 0);
    allowed = true; pacer._pump(); assert.equal(battle.tickCount, 1);
  } finally { remove(); }
});

test('acquire and release exceptions cannot escape a slice or prevent its next continuation', () => {
  let attempts = 0;
  const remove = configureSimulationSlices(() => {
    if (++attempts === 1) throw new Error('unavailable broker');
    return () => { throw new Error('closed channel'); };
  });
  try {
    const job = new HeadlessJob(oneStep());
    assert.equal(job.run(1), false);
    assert.equal(job.done, false);
    assert.equal(job.run(1), true);
    assert.equal(job.done, true);
  } finally { remove(); }
});

test('two real executor processes cannot overlap one supervisor permit', { timeout: 30000 }, async (t) => {
  const broker = createSimulationBroker(1), children = [], intervals = [];
  t.after(async () => {
    for (const { child, peer } of children) {
      peer.close();
      if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    }
    broker.close();
  });
  await Promise.all([0, 1].map(async (index) => {
    const child = fork(fileURLToPath(new URL('../helpers/simulation-client-child.mjs', import.meta.url)), ['client'], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const key = `room-${index}`;
    broker.register(key, child.pid);
    const peer = createPeer(child, {
      acquire: ({ request }) => broker.acquire(key, { executor: 'main', pid: child.pid, request }),
      cancel: ({ request }) => broker.cancel(key, 'main', request),
      begin: ({ lease }) => broker.begin(key, 'main', lease),
      release: ({ lease }) => broker.release(key, 'main', lease),
      done: (value) => { intervals.push(...value); return true; },
    });
    children.push({ child, peer });
    child.once('exit', () => broker.brokerExited(key));
    await peer.request('run');
  }));
  assert.equal(intervals.length, 32);
  intervals.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i][0] >= intervals[i - 1][1], 'bounded simulation slices overlap');
  await until(() => broker.stats().held === 0);
});

test('a killed broker cannot free a real independent executor still inside its slice', { timeout: 15000 }, async (t) => {
  const children = [], broker = createSimulationBroker(1);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sim-orphan-')), release = path.join(directory, 'release');
  const launch = (mode) => {
    const child = fork(fileURLToPath(new URL('../helpers/simulation-orphan-child.mjs', import.meta.url)), [mode, release],
      { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    children.push(child); return child;
  };
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    }
    broker.close(); fs.rmSync(directory, { recursive: true, force: true });
  });
  const executor = launch('executor'); await once(executor, 'message');
  const owner = launch('broker'); await once(owner, 'message');
  broker.register('room', owner.pid);
  const lease = broker.acquire('room', { executor: 'content', pid: executor.pid, request: 1 });
  assert.ok(lease); assert.equal(broker.begin('room', 'content', lease), true);
  const started = once(executor, 'message'), completed = once(executor, 'exit');
  executor.send({ type: 'run' }); assert.equal((await started)[0].started, true);
  const exited = once(owner, 'exit'); owner.kill('SIGKILL'); await exited;
  broker.brokerExited('room');
  assert.equal(broker.stats().held, 1);
  assert.equal(process.kill(executor.pid, 0), true);
  fs.writeFileSync(release, 'complete');
  await completed; broker.prune();
  assert.equal(broker.stats().held, 0, 'the actual executor exit makes its orphan lease reclaimable');
});

for (const transport of ['process', 'worker']) test(`${transport}: a stopped content host retains its lease until actual executor exit`, { timeout: 30000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sim-host-'));
  const started = path.join(directory, 'started'), release = path.join(directory, 'release');
  const broker = createSimulationBroker(1);
  broker.register('room', process.pid);
  const simulation = {
    acquire: (executor, pid, request) => broker.acquire('room', { executor, pid, request }),
    cancel: (executor, request) => broker.cancel('room', executor, request),
    begin: (executor, lease) => broker.begin('room', executor, lease),
    release: (executor, lease) => broker.release('room', executor, lease),
    exited: (executor) => broker.executorExited('room', executor),
  };
  const files = { config: Buffer.from('{}') };
  const hashInput = { app: 'test', sim: 'test', data: { config: createHash('sha256').update(files.config).digest('hex') } };
  const cs = contentHashOf(hashInput), set = { hashInput, plugins: [] };
  const hosts = createMatchHosts({ contents: { get: () => set, dataBytes: () => files }, simulation,
    options: { transport, watchdogMs: 20000, matchModule: fileURLToPath(new URL('./fixtures/simulationMatch.js', import.meta.url)), matchOptions: { started, release } } });
  let executor, kill;
  t.after(async () => {
    if (kill) kill();
    await hosts.close();
    broker.close(); fs.rmSync(directory, { recursive: true, force: true });
  });
  const match = hosts.create(cs, { roomCode: 'TEST', seats: [], send() {}, broadcast() {}, onEnd() {} });
  const host = hosts._host(cs); executor = host.child || host.worker; kill = host.kill;
  match.start();
  assert.deepEqual(await match.handle('p', {}), { ok: true });
  await until(() => fs.existsSync(started));
  assert.equal(broker.stats().held, 1);
  host.kill = () => {};
  host.stop('plugin-hang', 'delayed termination test');
  assert.equal(broker.stats().held, 1);
  executor.emit('message', { channel: 'rooms', method: 'release', value: { lease: 1 } });
  executor.emit('message', { channel: 'rooms', method: 'acquire', id: 999, value: { request: 999 } });
  assert.equal(broker.stats().held, 1, 'buffered messages after stop cannot release or acquire');
  let closed = false;
  const closing = hosts.close().then(() => { closed = true; });
  await pause(30);
  assert.equal(closed, false, 'shutdown awaits an already-stopped host removed from the active map');
  const exited = once(executor, 'exit'); kill(); await exited; await closing;
  assert.equal(closed, true);
  assert.equal(broker.stats().held, 0);
});

test('a permit-enabled room server waits for its content process to exit during shutdown', { timeout: 30000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-sim-shutdown-'));
  const started = path.join(directory, 'started'), release = path.join(directory, 'release');
  const pluginsDir = path.join(directory, 'plugins');
  writePlugin(path.join(pluginsDir, 'shutdown'), { manifest: 2, version: '1.0.0', app: '*', api: 1,
    class: 'content', scope: ['room'], permissions: ['data.patch'], data: ['patch.json'] }, {
    'patch.json': { patch: 1, ops: [{ op: 'set', file: 'bonds', id: 'deputShip', path: ['bb', 'base_def'], value: 0.35 }] },
  });
  const broker = createSimulationBroker(1);
  broker.register('room', process.pid);
  const simulationAuthority = {
    acquire: (executor, pid, request) => broker.acquire('room', { executor, pid, request }),
    cancel: (executor, request) => broker.cancel('room', executor, request),
    begin: (executor, lease) => broker.begin('room', executor, lease),
    release: (executor, lease) => broker.release('room', executor, lease),
    exited: (executor) => broker.executorExited('room', executor),
  };
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, roomProcs: 1, roomChild: true,
    pluginsDir, assetIndex: false, studio: false, simulationAuthority,
    matchHost: { transport: 'process', matchModule: fileURLToPath(new URL('./fixtures/simulationMatch.js', import.meta.url)),
      matchOptions: { started, release } } });
  let host, kill;
  t.after(async () => {
    if (host && kill) { host.kill = kill; kill(); }
    await srv.close(); broker.close(); fs.rmSync(directory, { recursive: true, force: true });
  });
  const result = srv.contents.resolve(['shutdown']); assert.ok(result.ok, JSON.stringify(result));
  const match = srv.hosts.create(result.set.cs, { roomCode: 'TEST', seats: [], send() {}, broadcast() {}, onEnd() {} });
  host = srv.hosts._host(result.set.cs); kill = host.kill;
  const exited = once(host.child, 'exit');
  match.start(); assert.deepEqual(await match.handle('p', {}), { ok: true });
  await until(() => fs.existsSync(started));
  host.kill = () => {};
  let closed = false;
  const closing = srv.close().then(() => { closed = true; });
  await pause(30);
  assert.equal(closed, false); assert.equal(broker.stats().held, 1);
  kill(); await exited; await closing;
  assert.equal(closed, true); assert.equal(broker.stats().held, 0);
});

test('permit-enabled host shutdown completes when a content process cannot spawn', { timeout: 5000 }, async () => {
  const files = { config: Buffer.from('{}') };
  const hashInput = { app: 'test', sim: 'test', data: { config: createHash('sha256').update(files.config).digest('hex') } };
  const cs = contentHashOf(hashInput);
  const hosts = createMatchHosts({ contents: { get: () => ({ hashInput, plugins: [] }), dataBytes: () => files },
    simulation: { exited() {}, acquire() {}, cancel() {}, begin() {}, release() {} } });
  const original = process.execPath;
  try {
    process.execPath = path.join(os.tmpdir(), 'absent-simulation-executor.exe');
    hosts.create(cs, { roomCode: 'TEST', seats: [], send() {}, broadcast() {}, onEnd() {} });
  } finally { process.execPath = original; }
  await hosts.close();
  assert.equal(hosts.stats().workers, 0);
});
