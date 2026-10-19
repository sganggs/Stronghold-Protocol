import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { installTrustVerifier } from '../../public/js/battle/trust.js';
import { trustHash } from '../../shared/trust.js';
import { trustResultHash } from '../../server/match/match/trust.js';
import { compactResult, createBattleFromSpec } from '../../server/sim/spec.js';
import { runHeadless } from '../../server/match/fields.js';
import { makeMatch, DATA } from './harness.js';

const sourceUrl = new URL('../../public/js/battle/trustWorker.js', import.meta.url);
async function workerSource() {
  const source = (await fs.readFile(sourceUrl, 'utf8')).replaceAll("'/sim/", `'${new URL('../../server/sim/', import.meta.url).href}`)
    .replaceAll("'/shared/", `'${new URL('../../shared/', import.meta.url).href}`);
  return new URL(`data:text/javascript,${encodeURIComponent(`import { parentPort } from 'node:worker_threads';
    globalThis.self = { postMessage: (data) => parentPort.postMessage(data) };
    parentPort.on('message', (data) => self.onmessage?.({ data }));\n${source}`)}`);
}
function netStub() {
  const handlers = new Map();
  return { sent: [], on(t, fn) { handlers.set(t, fn); return () => handlers.delete(t); },
    push(t, m) { handlers.get(t)?.(m); }, send(t, m) { this.sent.push({ t, ...m }); } };
}
const flush = () => delay(0);

test('actual module Worker returns the same bound terminal digest as the server and rejects bad input', { timeout: 10000 }, async (t) => {
  const h = makeMatch({ humans: 1, clientCombat: true, clients: false });
  t.after(() => h.m.dispose());
  h.start();
  assert.ok(h.drive(() => h.m.phase === 'COMBAT'));
  const spec = h.m.fields[0].spec;
  const expected = compactResult(runHeadless(createBattleFromSpec(spec, h.m.ds, { quiet: true, recordEvents: false }), { players: ['p_0'] }).result);
  const worker = new Worker(await workerSource());
  t.after(() => worker.terminate());
  assert.equal((await once(worker, 'message'))[0].t, 'ready');
  let message = once(worker, 'message');
  worker.postMessage({ t: 'verify', taskId: 'one', spec, specHash: trustHash(spec), raw: DATA });
  let reply = (await message)[0];
  assert.deepEqual(reply, { t: 'done', taskId: 'one', specHash: trustHash(spec), digest: trustResultHash(expected) });
  for (const input of [{ specHash: '0'.repeat(64) }, { spec: { ...spec, cs: 'a'.repeat(64) } }, { spec: { ...spec, kind: 'boss' } }]) {
    message = once(worker, 'message');
    worker.postMessage({ t: 'verify', taskId: 'bad', spec, specHash: trustHash(spec), raw: DATA, ...input });
    reply = (await message)[0];
    assert.deepEqual(reply, { t: 'error', taskId: 'bad' });
  }
  for (const kind of ['normal', 'unite']) {
    const frame = JSON.parse(await fs.readFile(new URL(`../../public/dev/perf/hard-${kind}-r13.json`, import.meta.url), 'utf8'));
    const spec = frame.spec;
    const expected = compactResult(runHeadless(createBattleFromSpec(spec, h.m.ds, { quiet: true, recordEvents: false }),
      { players: spec.players.map((p) => p.playerId) }).result);
    message = once(worker, 'message');
    worker.postMessage({ t: 'verify', taskId: kind, spec, specHash: trustHash(spec), raw: DATA });
    assert.deepEqual((await message)[0], { t: 'done', taskId: kind, specHash: trustHash(spec), digest: trustResultHash(expected) });
  }
});

test('receiver waits for module readiness/data, refuses excess work, and terminates cancelled workers', async () => {
  const net = netStub();
  const workers = [];
  const control = installTrustVerifier({ net, runner: { ensureSim: async () => ({ raw: {} }) }, createWorker: () => {
    const worker = { messages: [], terminated: false, onmessage: null, onerror: null,
      postMessage(msg) { this.messages.push(msg); }, terminate() { this.terminated = true; } };
    workers.push(worker);
    return worker;
  } });
  const task = (id) => ({ taskId: id, specHash: 'a'.repeat(64), spec: {} });
  net.push('b.verify', task('one'));
  await flush();
  assert.equal(workers[0].messages.length, 0);
  net.push('b.verify', task('busy'));
  assert.deepEqual(net.sent.pop(), { t: 'b.verifyResult', taskId: 'busy', error: true });
  workers[0].onmessage({ data: { t: 'ready' } });
  assert.equal(workers[0].messages.length, 1);
  net.push('b.verifyCancel', { taskId: 'other' });
  assert.equal(workers[0].terminated, false);
  net.push('b.verifyCancel', { taskId: 'one' });
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { t: 'done', taskId: 'one', digest: 'b'.repeat(64) } });
  assert.equal(net.sent.length, 0, 'a dead worker cannot send a late reply');
  net.push('b.verify', task('two'));
  net.push('status', { status: 'offline' });
  assert.equal(workers[1].terminated, true);
  control.dispose();
});

test('unavailable Worker or plugin simulation data declines the task', async () => {
  for (const unavailable of [true, false]) {
    const net = netStub();
    const control = installTrustVerifier({ net, runner: { ensureSim: async () => ({ raw: {}, cs: 'a'.repeat(64) }) },
      createWorker() { if (unavailable) throw new Error('unavailable'); return { terminate() {} }; } });
    net.push('b.verify', { taskId: 'one', specHash: 'a'.repeat(64), spec: {} });
    await flush();
    assert.deepEqual(net.sent, [{ t: 'b.verifyResult', taskId: 'one', error: true }]);
    control.dispose();
  }
});
