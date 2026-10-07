// test/e2e/client.mjs waitForFunctionLong (Node, no browser): a long wait of the real-server browser suites polls in
// slices shorter than the CDP protocol timeout. A plain page.waitForFunction runs its whole poll inside one
// Runtime.callFunctionOn, which the 90 s protocol timeout cut off: watch-bonds.e2e's "own battle over" wait (240 s) failed
// with a bare "Waiting failed" whenever the own battle at 1× lasted longer than 90 s (0.1.4 release candidate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, PROTOCOL_TIMEOUT_MS, waitForFunctionLong } from './client.mjs';

const timeoutError = (ms) => Object.assign(new Error(`Waiting failed: ${ms}ms exceeded`), { name: 'TimeoutError' });

/**
 * A page whose predicate turns true after `trueAfter` ms; each waitForFunction slice behaves like puppeteer's.
 *
 * ⚠️ The clock is VIRTUAL — `spent` advances by the length of each slice, not by the wall clock. Reading the wall clock
 * (`left = t0 + trueAfter - Date.now()`) makes the slice COUNT depend on how punctual `setTimeout` is: a slice asked for
 * 30 ms lands at 30–37 ms on Windows (its timer tick is ~15.6 ms; Linux and macOS resolve sub-millisecond), so two
 * slices can eat 67 ms instead of 60, the 95 ms wait below then fits in 3 slices instead of 4, and the `>= 4` assertion
 * fails on every run there. The real timer still holds each slice, so the overall-timeout test's wall-clock assertions
 * keep meaning what they say.
 */
function fakePage(trueAfter) {
  let spent = 0;
  const calls = [];
  return {
    calls,
    waitForFunction(fn, opts, ...args) {
      calls.push({ fn, opts, args });
      const left = trueAfter - spent;
      const hold = Math.max(0, Math.min(opts.timeout, left));
      spent += hold;
      return new Promise((resolve, reject) => setTimeout(
        () => (left <= opts.timeout ? resolve({ handle: 'ok', args }) : reject(timeoutError(opts.timeout))),
        hold,
      ));
    },
  };
}

test('a wait longer than one slice keeps polling the same predicate until it holds', async () => {
  const page = fakePage(95);
  const fn = () => true;
  const got = await waitForFunctionLong(page, fn, { timeout: 1000, polling: 200, slice: 30 }, 'a', 2);
  assert.deepEqual(got, { handle: 'ok', args: ['a', 2] });
  assert.ok(page.calls.length >= 4, `sliced (${page.calls.length} calls)`);
  for (const c of page.calls) {
    assert.equal(c.fn, fn);
    assert.deepEqual(c.args, ['a', 2]);
    assert.equal(c.opts.polling, 200);
    assert.ok(c.opts.timeout > 0 && c.opts.timeout <= 30, `slice ${c.opts.timeout}`);
  }
});

test('the overall timeout still ends the wait with a TimeoutError naming it; the last slice is the remainder', async () => {
  const page = fakePage(10_000);
  const t0 = Date.now();
  await assert.rejects(waitForFunctionLong(page, () => false, { timeout: 70, slice: 30 }), (e) => e.name === 'TimeoutError' && /70ms exceeded/.test(e.message));
  assert.ok(Date.now() - t0 >= 65, 'not before the deadline');
  assert.ok(page.calls.at(-1).opts.timeout <= 30);
  assert.ok(page.calls.reduce((n, c) => n + c.opts.timeout, 0) <= 75, 'the slices add up to the timeout');
});

test('any other failure is not retried (a page error, a detached frame, the protocol timeout itself)', async () => {
  for (const err of [new Error('Waiting failed'), Object.assign(new Error('boom'), { name: 'ProtocolError' })]) {
    let n = 0;
    const page = { waitForFunction: () => { n++; return Promise.reject(err); } };
    await assert.rejects(waitForFunctionLong(page, () => true, { timeout: 1000, slice: 30 }), (e) => e === err);
    assert.equal(n, 1);
  }
});

test('the default slice stays well under the protocol timeout every Client launches with', async () => {
  const page = fakePage(0);
  await waitForFunctionLong(page, () => true, { timeout: 240000 });
  assert.ok(page.calls[0].opts.timeout < PROTOCOL_TIMEOUT_MS / 2, `slice ${page.calls[0].opts.timeout}`);
  const client = readFileSync(path.join(ROOT, 'test/e2e/client.mjs'), 'utf8');
  assert.match(client, /protocolTimeout: PROTOCOL_TIMEOUT_MS \}/, 'Client.open launches with the exported constant');
});

test('no Client suite has a plain page.waitForFunction as long as the protocol timeout (use waitForFunctionLong)', () => {
  const files = [];
  for (const dir of ['test/ui', 'test/e2e']) {
    for (const f of readdirSync(path.join(ROOT, dir))) if (/\.(m?js)$/.test(f)) files.push(path.join(dir, f));
  }
  const long = [];
  for (const f of files) {
    const src = readFileSync(path.join(ROOT, f), 'utf8');
    if (!/from '\.\.\/e2e\/client\.mjs'|from '\.\/client\.mjs'/.test(src)) continue;
    for (let i = src.indexOf('.waitForFunction('); i >= 0; i = src.indexOf('.waitForFunction(', i + 1)) {
      const next = src.indexOf('.waitForFunction(', i + 1);
      const m = src.slice(i, next < 0 ? undefined : next).match(/\{ timeout: ([0-9_]+)/);
      if (m && Number(m[1].replace(/_/g, '')) >= PROTOCOL_TIMEOUT_MS) long.push(`${f}:${src.slice(0, i).split('\n').length} (${m[1]} ms)`);
    }
  }
  assert.deepEqual(long, []);
});
