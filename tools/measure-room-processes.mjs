// Finite N=1/N=2 comparison: real four-bot matches and WebSocket operations in light lobby rooms.
// node tools/measure-room-processes.mjs --heavy 4 --light 2 --duration-ms 30000
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { cpus, availableParallelism } from 'node:os';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { Net } from '../public/js/net.js';
import { startServer } from '../server/index.js';
import { resetDelay, readDelay, startHeavy, loadStats, stopHeavy } from './lib/room-load.mjs';
import { observeHostLoad } from './lib/measure-load.mjs';

const argv = process.argv.slice(2);
const option = (key, fallback) => argv.includes(key) ? argv[argv.indexOf(key) + 1] : fallback;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const heavy = Number(option('--heavy', '4')), light = Number(option('--light', '2'));
const durationMs = Number(option('--duration-ms', '30000'));
assert.ok(Number.isInteger(heavy) && heavy >= 1 && heavy <= 32);
assert.ok(Number.isInteger(light) && light >= 1 && light <= 8);
assert.ok(Number.isInteger(durationMs) && durationMs >= 1000 && durationMs <= 120000);

function rpc(child, type) {
  let seq = 0;
  return (action, fields = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { child.off('message', reply); reject(new Error(`${action} timeout`)); }, 30000);
    const reply = (m) => {
      if (m?.type !== type + '.reply' || m.id !== id) return;
      clearTimeout(timer); child.off('message', reply);
      if (m.error) reject(new Error(m.error)); else resolve(m.value);
    };
    child.on('message', reply);
    child.send({ type, id, action, ...fields });
  });
}

async function serverRole() {
  const count = Number(option('--processes', '1'));
  process.env.SP_ROOM_LOAD_PROBE = '1';
  const preload = new URL('./lib/room-load.mjs', import.meta.url).href;
  const previous = process.execArgv;
  let srv;
  process.execArgv = [...previous, '--import', preload];
  try {
    srv = await startServer({ port: 0, host: '127.0.0.1', roomProcs: count, quiet: true, studio: false,
      assetIndex: false, maxRoomsPerAddr: 0, maxMatchesPerAddr: 0 });
  } finally { process.execArgv = previous; }
  const probe = count === 2 ? rpc(srv.roomSupervisor.slots[0].child, 'measure.roomLoad') : null;
  const lightProbe = count === 2 ? rpc(srv.roomSupervisor.slots[1].child, 'measure.roomLoad') : null;
  // Deliberately concentrate the heavy matches in slot 0 and place light rooms in slot 1.
  // This measures event-loop isolation for that placement; ordinary deployments choose their own room mix.
  if (count === 2) srv.roomSupervisor.drain(0);
  const handlers = {
    async start() {
      if (probe) return probe('start', { count: heavy });
      return startHeavy(heavy);
    },
    async reset() { return lightProbe ? lightProbe('reset') : resetDelay(); },
    async read() { return lightProbe ? { ...await lightProbe('read'), heavyLoad: await probe('load') }
      : { delay: readDelay(), heavyLoad: loadStats() }; },
    async stop() { if (probe) await probe('stop'); else stopHeavy(); await srv.close(); },
  };
  process.on('message', async (m) => {
    if (m?.type !== 'measure.server') return;
    let value, error;
    try { value = await handlers[m.action](); } catch (caught) { error = caught.message; }
    process.send?.({ type: 'measure.server.reply', id: m.id, value, error });
  });
  process.on('disconnect', async () => { stopHeavy(); await srv.close(); });
  process.send({ type: 'measure.ready', port: srv.port });
}

function percentile(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}
async function campaign(count) {
  const child = fork(fileURLToPath(import.meta.url), ['--server', '--processes', String(count),
    '--heavy', String(heavy), '--light', String(light), '--duration-ms', String(durationMs)],
  { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [], env: { ...process.env, SP_COMBAT: 'server' } });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = once(child, 'exit');
  const request = rpc(child, 'measure.server'), clients = [];
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server startup timeout')), 30000);
      child.on('message', (m) => { if (m?.type === 'measure.ready') { clearTimeout(timer); resolve(m); } });
      child.once('error', reject);
    });
    for (let i = 0; i < light; i++) {
      let token;
      const net = new Net({ url: `ws://127.0.0.1:${ready.port}/ws`, WebSocket, getToken: () => token,
        setToken: (value) => { token = value; } });
      if (count === 2) net.roomSlot = 1;
      clients.push(net);
      const online = new Promise((resolve) => net.on('welcome', resolve));
      net.name = `Light${i}`; net.connect(); await online;
      await net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
    }
    const workload = await request('start');
    await sleep(2000);
    await request('reset');
    const latencies = [], errors = [], hostLoad = observeHostLoad();
    const start = performance.now(), deadline = start + durationMs;
    await Promise.all(clients.map(async (net) => {
      let operation = 0;
      while (performance.now() < deadline) {
        const t0 = performance.now();
        try { await net.request('room.setDifficulty', { difficulty: operation++ % 2 ? 'NORMAL' : 'HARD' });
          latencies.push(performance.now() - t0); }
        catch (error) { errors.push(error.message); }
        await sleep(50);
      }
    }));
    const measuredMs = performance.now() - start;
    const metrics = await request('read');
    assert.ok(latencies.length > 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(metrics.heavyLoad.errors, []);
    assert.ok(metrics.heavyLoad.matches.every((m) => m.errors === 0 && m.simErrors === 0));
    assert.ok(metrics.delay.samples > 0);
    return { roomProcesses: count, workload, measuredMs, lightRooms: light, operation: 'room.setDifficulty',
      operationLatency: { p50Ms: percentile(latencies, .5), p99Ms: percentile(latencies, .99), samples: latencies.length },
      ...metrics, hostLoad: hostLoad(), errors, stderr };
  } finally {
    for (const net of clients) net.close();
    try { await request('stop'); } finally { if (child.connected) child.disconnect(); }
    const timer = setTimeout(() => child.kill(), 5000);
    await exited; clearTimeout(timer);
  }
}

if (argv.includes('--server')) await serverRole();
else {
  const one = await campaign(1), two = await campaign(2);
  console.log(JSON.stringify({ logicalCores: cpus().length, availableParallelism: availableParallelism(),
    heavyMatches: heavy, lightRooms: light, requestedDurationMs: durationMs, runs: [one, two],
    ratiosN2OverN1: { delayP50: two.delay.p50Ms / one.delay.p50Ms, delayP99: two.delay.p99Ms / one.delay.p99Ms,
      latencyP50: two.operationLatency.p50Ms / one.operationLatency.p50Ms,
      latencyP99: two.operationLatency.p99Ms / one.operationLatency.p99Ms },
    scope: 'One observation per condition; seeded heavy matches constructed in one process through the production Match API, light rooms use the real lobby and WebSocket. Phase timers scaled to 5%; bot fields run headlessly. Ratios describe this placement and workload.' }, null, 2));
}
