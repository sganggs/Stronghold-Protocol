// test/shutdown-timeout.test.js — the graceful shutdown gets a configurable window instead of a hard 5 s.
//
// server/http/boot.js used to exit 0 five seconds after SIGINT/SIGTERM no matter what, so a shutdown that had not
// finished was hidden behind a success. The window is now SP_SHUTDOWN_TIMEOUT_MS (default 5 s, accepted 1–300 s), a
// shutdown that runs out of it exits 1, and a second signal still exits at once.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shutdownTimeoutMs, shutdownHandler } from '../server/http/boot.js';

/** A shutdown handler with the process effects replaced by recorders. */
function harness({ close = () => new Promise(() => {}), timeoutMs } = {}) {
  const exits = [];
  const logs = [];
  const errors = [];
  const timers = [];
  const handler = shutdownHandler({ close }, {
    exit: (code) => exits.push(code),
    setTimer: (ms, fn) => { timers.push({ ms, fn }); return { unref() {} }; },
    out: { log: (m) => logs.push(m), error: (m) => errors.push(m) },
    timeoutMs,
  });
  return { handler, exits, logs, errors, timers };
}

test('the shutdown window is 5 s by default and takes an explicit 1–300 s', () => {
  const saved = process.env.SP_SHUTDOWN_TIMEOUT_MS;
  try {
    delete process.env.SP_SHUTDOWN_TIMEOUT_MS;
    assert.equal(shutdownTimeoutMs(), 5_000, 'unset keeps the value the old timer used');
    process.env.SP_SHUTDOWN_TIMEOUT_MS = '45000';
    assert.equal(shutdownTimeoutMs(), 45_000, 'the environment variable is honoured');
    assert.equal(shutdownTimeoutMs('120000'), 120_000, 'an explicit value wins over the environment');
    assert.equal(shutdownTimeoutMs('1000'), 1_000, 'the lower bound itself is accepted');
    assert.equal(shutdownTimeoutMs('300000'), 300_000, 'the upper bound itself is accepted');
  } finally {
    if (saved === undefined) delete process.env.SP_SHUTDOWN_TIMEOUT_MS; else process.env.SP_SHUTDOWN_TIMEOUT_MS = saved;
  }
});

test('an unusable window falls back to 5 s instead of removing the guard', () => {
  for (const bad of ['0', '999', '300001', '-1', 'abc', '', '60000.5', 'Infinity', 'NaN', undefined]) {
    assert.equal(shutdownTimeoutMs(bad), 5_000, `${String(bad)} -> default`);
  }
});

test('a shutdown that finishes on its own exits 0 and the timer does nothing', async () => {
  const h = harness({ close: () => Promise.resolve() });
  h.handler('SIGTERM');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.exits, [0], 'the finished shutdown is a success');
  assert.equal(h.timers.length, 1, 'one window was armed');
  assert.equal(h.timers[0].ms, 5_000, 'with the default window');
  h.timers[0].fn();                                 // the process is already gone: the timer must not exit again
  assert.deepEqual(h.exits, [0], 'the timeout after a clean shutdown changes nothing');
  assert.deepEqual(h.errors, [], 'and logs no timeout');
});

test('a shutdown that never finishes exits 1 when the window runs out', () => {
  const h = harness({ timeoutMs: 20_000 });
  h.handler('SIGINT');
  assert.deepEqual(h.exits, [], 'still closing: nothing has exited yet');
  h.timers[0].fn();
  assert.deepEqual(h.exits, [1], 'the timeout is a failure, not a success');
  assert.equal(h.timers[0].ms, 20_000, 'the configured window is the one armed');
  assert.equal(h.errors.length, 1, 'and it is reported');
  assert.match(h.errors[0], /timeout/i, 'the message names the shutdown timeout');
  assert.doesNotMatch(h.errors[0], /save|persist|final state/i, 'and claims nothing about a save that is not here');
});

test('a second signal exits at once', () => {
  const h = harness({ timeoutMs: 30_000 });
  h.handler('SIGTERM');
  h.handler('SIGTERM');
  assert.deepEqual(h.exits, [1], 'the second signal does not wait for the window');
  assert.equal(h.timers.length, 1, 'and does not arm another one');
  assert.ok(h.logs.some((m) => /forced exit/.test(m)), 'it says why it left immediately');
});

test('a close that rejects is a failure too', async () => {
  const h = harness({ close: () => Promise.reject(new Error('close failed')) });
  h.handler('SIGTERM');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.exits, [1], 'a close that throws exits 1');
});
