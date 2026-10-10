import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from './client.mjs';

test('closing an exited browser releases stderr even when a helper inherited its pipe', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const helper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'],
      { stdio: ['ignore', 'ignore', 2], detached: true });
    helper.unref();
    process.send({ pid: helper.pid }, () => process.exit(0));
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const exited = once(child, 'exit');
  let helperPid;
  try {
    [{ pid: helperPid }] = await once(child, 'message');
    child.stderr.resume();
    await exited;
    assert.equal(child.exitCode, 0);
    assert.equal(child.stderr.destroyed, false, 'the helper still holds the other end of stderr');
    const client = new Client(null, '', 'cleanup');
    client.browser = { process: () => child, close: async () => {} };
    await client.close();
    assert.equal(child.stderr.destroyed, true, 'the exited browser no longer keeps this test alive');
  } finally {
    if (helperPid) { try { process.kill(helperPid, 'SIGTERM'); } catch { /* already exited */ } }
    for (const stream of child.stdio) stream?.destroy?.();
    if (child.exitCode == null && child.signalCode == null) child.kill();
  }
});

test('a failed shutdown leaves a live browser and its pipes alone', async () => {
  let destroyed = 0;
  const child = { exitCode: null, signalCode: null, stdio: [{ destroy: () => destroyed++ }] };
  const client = new Client(null, '', 'cleanup');
  client.browser = { process: () => child, close: async () => { throw new Error('not closed'); } };
  await client.close();
  assert.equal(destroyed, 0);
});

test('a browser terminated by a signal releases only its owned pipes; an absent browser is harmless', async () => {
  let destroyed = 0;
  const client = new Client(null, '', 'cleanup');
  await client.close();
  client.browser = { process: () => ({ exitCode: null, signalCode: 'SIGTERM', stdio: [null, { destroy: () => destroyed++ }] }),
    close: async () => {} };
  await client.close();
  assert.equal(destroyed, 1);
});
