// Finite two-hop IPC comparison, using production broker/client/peer modules.
// node tools/measure-simulation-permits.mjs
import { createPeer } from '../server/rooms/peer.js';
import { createSimulationPermitClient, remoteSimulationAuthority } from '../server/rooms/simulationClient.js';
import { createSimulationBroker } from '../server/rooms/simulationBroker.js';
import { observeHostLoad } from './lib/measure-load.mjs';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus, availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const option = (key, fallback) => { const at = argv.indexOf(key); return at < 0 ? fallback : argv[at + 1]; };
const experiment = option('--experiment', 'saturation');
const role = option('--role', 'campaign');
const durationMs = Number(option('--duration-ms', experiment === 'saturation' ? '3000' : '2400'));
const lagMs = Number(option('--lag-ms', '250'));
const retryMinMs = Number(option('--retry-ms', '25'));
const grantMs = Number(option('--grant-ms', '1000'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sources = {};
for (const name of ['simulationBroker.js', 'simulationClient.js', 'peer.js']) {
  const raw = await readFile(new URL('../server/rooms/' + name, import.meta.url));
  sources[name] = { bytes: raw.length, sha256: sha256(raw) };
}

function counters() { return { sent: {}, received: {}, successfulWrites: {}, failedWrites: 0 }; }
function wire(raw, count) {
  const add = (store, message) => {
    if (message?.channel !== 'rooms') return;
    const key = message.method || (message.reply != null ? 'reply' : 'other');
    store[key] = (store[key] || 0) + 1;
  };
  return {
    get connected() { return raw.connected; },
    on(event, listener) {
      raw.on(event, (...values) => { if (event === 'message') add(count.received, values[0]); listener(...values); });
    },
    send(message, done) {
      add(count.sent, message);
      raw.send(message, (error) => {
        if (error) count.failedWrites++; else add(count.successfulWrites, message);
        done(error);
      });
    },
  };
}

function child(kind, index) {
  const process = fork(SELF, ['--role', kind, '--index', String(index), '--retry-ms', String(retryMinMs), '--grant-ms', String(grantMs),
    '--experiment', experiment, '--duration-ms', String(durationMs), '--lag-ms', String(lagMs)],
  { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [], serialization: 'json', env: { ...globalThis.process.env } });
  let stderr = '';
  process.stderr.on('data', (chunk) => { if (stderr.length < 65536) stderr += chunk; });
  const exited = new Promise((resolve) => process.once('exit', (code, signal) => resolve({ pid: process.pid, code, signal })));
  const ready = deferred();
  process.once('error', ready.reject);
  const timer = setTimeout(() => ready.reject(new Error(kind + ' readiness deadline exceeded')), 15000);
  ready.promise.finally(() => clearTimeout(timer)).catch(() => {});
  return { process, exited, ready, stderr: () => stderr };
}

async function awaitExit(entry) {
  let timer;
  const result = await Promise.race([entry.exited, new Promise((resolve) => {
    timer = setTimeout(() => { entry.process.kill(); resolve(null); }, 5000);
  })]);
  clearTimeout(timer);
  return result || await entry.exited;
}

function block(ms) {
  const start = performance.now();
  while (performance.now() - start < ms) { /* finite relay event-loop stall */ }
  return performance.now() - start;
}

async function executor() {
  const index = Number(option('--index', '0'));
  const executorId = 'executor-' + index;
  const traffic = counters();
  const metrics = { executor: executorId, pid: process.pid, pumps: 0, completions: 0, errors: [] };
  let pump, peer, client, stopping = false;
  const stop = async () => {
    clearInterval(pump); pump = null;
    client.close();
    await sleep(30);
    return { ...metrics, traffic, client: client.stats() };
  };
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await stop();
    peer.close();
    if (process.connected) process.disconnect();
  };
  peer = createPeer(wire(process, traffic), {
    benchStart() {
      assert.equal(pump, undefined);
      pump = setInterval(() => {
        metrics.pumps++;
        try {
          const release = client.enter();
          if (release) { metrics.completions++; release(); }
        } catch (error) { metrics.errors.push(error.message); }
      }, 1);
      return { started: true, pid: process.pid };
    },
    benchStop: stop,
    benchShutdown: shutdown,
  }, 10000);
  const remote = remoteSimulationAuthority(peer, (error) => metrics.errors.push(error?.message || String(error)));
  client = createSimulationPermitClient({
    acquire: (request) => remote.acquire(executorId, process.pid, request),
    begin: (lease) => remote.begin(executorId, lease),
    release: (lease) => remote.release(executorId, lease),
    cancel: (request) => remote.cancel(executorId, request),
  }, { retryMinMs, retryMaxMs: retryMinMs === 0 ? 0 : 200 });
  process.on('disconnect', () => void shutdown());
  await peer.notify('benchReady', { role, pid: process.pid, sources });
}

async function relay() {
  const traffic = counters();
  const metrics = { acquireRequests: 0, beginRequests: 0, positiveAcquireReplies: 0, stallDurationsMs: [] };
  const entries = [];
  let parentPeer, stopping = false;
  const remote = () => remoteSimulationAuthority(parentPeer, () => {});
  const stop = async () => {
    const executorStats = await Promise.all(entries.map((entry) => entry.peer.request('benchStop', {}, 10000)));
    return { ...metrics, traffic, executors: executorStats,
      executorTraffic: entries.map((entry) => ({ pid: entry.process.pid, traffic: entry.traffic })) };
  };
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await Promise.allSettled(entries.map((entry) => entry.peer.notify('benchShutdown', {})));
      const exits = await Promise.all(entries.map(awaitExit));
      await parentPeer.notify('benchChildrenClosed', { exits });
    } finally {
      for (const entry of entries) entry.peer.close();
      parentPeer.close();
      if (process.connected) process.disconnect();
    }
  };
  parentPeer = createPeer(wire(process, traffic), {
    async benchStart() {
      return await Promise.all(entries.map((entry) => entry.peer.request('benchStart', {}, 10000)));
    },
    benchStop: stop,
    benchShutdown: shutdown,
  }, 10000);
  process.on('disconnect', () => void shutdown());
  try {
    for (let index = 0; index < 4; index++) {
      const entry = child('executor', index);
      entry.traffic = counters();
      entry.peer = createPeer(wire(entry.process, entry.traffic), {
        benchReady: (value) => entry.ready.resolve(value),
        async simAcquire(value) {
          metrics.acquireRequests++;
          const lease = await remote().acquire(value.executor, value.pid, value.request);
          if (Number.isSafeInteger(lease) && lease > 0) {
            metrics.positiveAcquireReplies++;
            if (experiment === 'lag') metrics.stallDurationsMs.push(block(lagMs));
          }
          return lease;
        },
        simBegin(value) { metrics.beginRequests++; return remote().begin(value.executor, value.lease); },
        simRelease(value) { return remote().release(value.executor, value.lease); },
        simCancel(value) { return remote().cancel(value.executor, value.request); },
        simExited(value) { return remote().exited(value.executor); },
      }, 10000);
      entries.push(entry);
    }
    const ready = await Promise.all(entries.map((entry) => entry.ready.promise));
    for (const value of ready) assert.deepEqual(value.sources, sources, 'executor source snapshot changed');
    await parentPeer.notify('benchReady', { role, pid: process.pid, sources, executors: ready.map((value) => value.pid) });
  } catch (error) { await shutdown(); throw error; }
}

async function parent() {
  assert.ok(['saturation', 'lag'].includes(experiment));
  assert.ok(Number.isFinite(durationMs) && durationMs > 0 && durationMs <= 10000);
  assert.ok(Number.isFinite(lagMs) && lagMs >= 0 && lagMs <= 1000);
  assert.ok([0, 25].includes(retryMinMs));
  assert.ok([100, 1000].includes(grantMs));
  const broker = createSimulationBroker(1, { grantMs });
  const traffic = counters();
  const grants = new Map();
  const metrics = { acquireRequests: 0, positiveGrants: 0, beginRequests: 0, beginsAccepted: 0, beginsDenied: 0,
    releases: 0, cancels: 0, grantToBegin: [] };
  const entry = child('relay', 0);
  const childrenClosed = deferred();
  const peer = createPeer(wire(entry.process, traffic), {
    benchReady: (value) => entry.ready.resolve(value),
    benchChildrenClosed: (value) => childrenClosed.resolve(value),
    simAcquire(value) {
      metrics.acquireRequests++;
      const lease = broker.acquire('room', value);
      if (Number.isSafeInteger(lease) && lease > 0) {
        metrics.positiveGrants++;
        grants.set(lease, { grantedAt: performance.now(), executor: value.executor });
      }
      return lease;
    },
    simBegin(value) {
      metrics.beginRequests++;
      const accepted = broker.begin('room', value.executor, value.lease);
      if (accepted) metrics.beginsAccepted++; else metrics.beginsDenied++;
      const grant = grants.get(value.lease);
      metrics.grantToBegin.push({ lease: value.lease, executor: value.executor, accepted,
        ageMs: grant ? performance.now() - grant.grantedAt : null });
      return accepted;
    },
    simRelease(value) { metrics.releases++; broker.release('room', value.executor, value.lease); },
    simCancel(value) { metrics.cancels++; broker.cancel('room', value.executor, value.request); },
    simExited(value) { broker.executorExited('room', value.executor); },
  }, 10000);
  broker.register('room', entry.process.pid);
  let result, error, holder = null;
  const started = performance.now();
  try {
    const ready = await entry.ready.promise;
    assert.deepEqual(ready.sources, sources, 'relay source snapshot changed');
    if (experiment === 'saturation') {
      holder = broker.acquire('room', { executor: 'fixture-holder', pid: process.pid, request: 1 });
      assert.ok(holder > 0 && broker.begin('room', 'fixture-holder', holder));
    }
    const hostLoad = observeHostLoad();
    const measurementStart = performance.now();
    await peer.request('benchStart', {}, 10000);
    await sleep(durationMs);
    const measurementStop = performance.now();
    const relayStats = await peer.request('benchStop', {}, 10000);
    const observationStop = performance.now();
    const seconds = (observationStop - measurementStart) / 1000;
    const completions = relayStats.executors.reduce((sum, item) => sum + item.completions, 0);
    const pumps = relayStats.executors.reduce((sum, item) => sum + item.pumps, 0);
    result = { experiment, retryMinMs, grantMs, hostLoad: hostLoad(), sources, fixtureSha256: sha256(await readFile(SELF)),
      topology: { brokers: 1, relayProcesses: 1, executorProcesses: 4, brokerLimit: 1, pumpIntervalMs: 1, serialization: 'json' },
      requestedDurationMs: durationMs, pumpWindowMs: measurementStop - measurementStart,
      measuredDurationMs: observationStop - measurementStart,
      countScope: 'Includes draining requests already issued before executor pumps stopped; rates use the complete observation interval.',
      relayLagMs: experiment === 'lag' ? lagMs : 0,
      holder: experiment === 'saturation' ? { activeDuringMeasurement: true, excludedFromIpcCounts: true } : null,
      parent: { ...metrics, traffic }, relay: relayStats,
      rates: { executorToRelayAcquireRequestsPerSecond: relayStats.acquireRequests / seconds,
        relayToParentAcquireRequestsPerSecond: metrics.acquireRequests / seconds,
        relayToParentBeginRequestsPerSecond: metrics.beginRequests / seconds,
        positiveGrantsPerSecond: metrics.positiveGrants / seconds, completionsPerSecond: completions / seconds },
      completions, pumps, brokerBeforeCleanup: broker.stats() };
    if (experiment === 'saturation') assert.equal(completions, 0, 'active holder must exclude all executors');
  } catch (caught) { error = caught; }
  finally {
    if (holder != null) broker.release('room', 'fixture-holder', holder);
    await peer.notify('benchShutdown', {}).catch(() => {});
    const exited = await awaitExit(entry);
    peer.close(); broker.close();
    const cleanup = await Promise.race([childrenClosed.promise, sleep(1000).then(() => null)]);
    result ||= { experiment, retryMinMs, grantMs, sources };
    result.cleanup = { relay: exited, executors: cleanup?.exits || [], stderr: entry.stderr(), elapsedTotalMs: performance.now() - started };
    result.ok = !error && exited.code === 0 && result.cleanup.executors.length === 4
      && result.cleanup.executors.every((item) => item.code === 0);
    if (error) result.error = { message: error.message, stack: error.stack };
  }
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

async function campaign() {
  const runs = [];
  for (const [experiment, retry, window] of [
    ['saturation', 0, 1000], ['saturation', 25, 1000], ['lag', 25, 100], ['lag', 25, 1000],
  ]) {
    const run = fork(SELF, ['--role', 'parent', '--experiment', experiment, '--retry-ms', String(retry),
      '--grant-ms', String(window), '--duration-ms', String(experiment === 'saturation' ? 3000 : 2400),
      '--lag-ms', '250'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] });
    let stdout = '', stderr = '';
    run.stdout.on('data', (chunk) => { stdout += chunk; });
    run.stderr.on('data', (chunk) => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { run.once('exit', resolve); run.once('error', reject); });
    assert.equal(code, 0, stderr || stdout);
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.ok(result.relay.executors.every((item) => item.errors.length === 0));
    assert.equal(result.parent.traffic.failedWrites, 0);
    assert.equal(result.relay.traffic.failedWrites, 0);
    assert.equal(result.parent.acquireRequests, result.relay.acquireRequests);
    runs.push(result);
  }
  const [poll, backoff, shortWindow, longWindow] = runs;
  console.log(JSON.stringify({ logicalCores: cpus().length, availableParallelism: availableParallelism(), runs,
    ratios: { backoffAcquireRate: backoff.rates.relayToParentAcquireRequestsPerSecond / poll.rates.relayToParentAcquireRequestsPerSecond,
      shortWindowAcceptance: shortWindow.parent.beginsAccepted / shortWindow.parent.beginRequests,
      longWindowAcceptance: longWindow.parent.beginsAccepted / longWindow.parent.beginRequests },
    scope: 'One observation per condition. Four executor processes poll every 1 ms through a relay and broker using JSON IPC. Saturation holds one active lease; lag blocks the relay for 250 ms after each positive grant. Controls configure retry and broker grant windows on the same modules. Rates cover shutdown draining. These synthetic observations describe retry traffic and grant acceptance.' }, null, 2));
}

try {
  if (role === 'campaign') await campaign();
  else if (role === 'parent') await parent();
  else if (role === 'relay') await relay();
  else if (role === 'executor') await executor();
  else throw new Error('unknown role');
} catch (error) { console.error(error.stack); process.exitCode = 1; }
