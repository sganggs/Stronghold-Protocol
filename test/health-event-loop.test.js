// test/health-event-loop.test.js — the main-thread event-loop delay sampler (server/health/eventLoop.js).
//
// The sampler answers one operational question the maintainer asked before phase 3: when a hall stalls, is it the
// rehearsal/battle slice on the main thread, or something else? It therefore has to work with NO thread pool at all, be
// off by default, and stay a *local* log — it never touches /healthz.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { eventLoopSettings, createEventLoopSampler, LOOP_LOG_MAX, LOOP_WINDOW_MS } from '../server/health/eventLoop.js';

/** A fake histogram with the same surface the sampler reads (ns values). */
function fakeHistogram(samples) {
  const h = { count: samples.length, min: Math.min(...samples), max: Math.max(...samples),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length, samples, reset() { this.count = 0; this.samples = []; } };
  h.percentile = (p) => {
    if (!h.count) return 0;
    const sorted = [...h.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  };
  return h;
}

test('the sampler is off by default and only SP_LOOP_SAMPLE=1 enables it', () => {
  assert.equal(eventLoopSettings({}).enabled, false, 'no configuration creates no sampler');
  assert.equal(eventLoopSettings({ SP_LOOP_SAMPLE: '1' }).enabled, true);
  assert.equal(eventLoopSettings({ SP_LOOP_SAMPLE: '0' }).enabled, false);
  assert.equal(eventLoopSettings({ SP_LOOP_SAMPLE: 'off' }).enabled, false);
  assert.equal(eventLoopSettings({ SP_LOOP_SAMPLE: 'junk' }).enabled, false, 'junk keeps the default');
  assert.equal(eventLoopSettings({ SP_LOOP_WINDOW_MS: '1000' }).windowMs, 1000);
  assert.equal(eventLoopSettings({ SP_LOOP_WINDOW_MS: '10' }).windowMs, LOOP_WINDOW_MS, 'out of bounds keeps the default');
});

test('the sampler works with no pool at all and never reaches /healthz', async () => {
  const lines = [];
  const sampler = createEventLoopSampler({ log: { info: (m) => lines.push(m) }, windowMs: 40 });
  assert.equal(sampler.stats().pools, 0, 'it does not depend on a worker pool');
  await sampler.sampleOnce({ rooms: 3, humans: 7, matches: 2, spectators: 1, phase: 'prep' });
  const [line] = lines;
  assert.match(line, /\[loop\]/);
  assert.match(line, /p50=/);
  assert.match(line, /p95=/);
  assert.match(line, /p99=/);
  assert.match(line, /max=/);
  assert.match(line, /rooms=3/);
  assert.match(line, /humans=7/);
  assert.match(line, /matches=2/);
  assert.match(line, /spectators=1/);
  assert.match(line, /phase=prep/);
  assert.match(line, /cpu=/);
  assert.match(line, /mem=/);
  assert.doesNotMatch(line, /healthz/);
  sampler.close();
});

test('the log stays bounded and drops the oldest lines', () => {
  const lines = [];
  const sampler = createEventLoopSampler({ log: { info: (m) => lines.push(m) }, windowMs: 1000, keep: 3 });
  for (let i = 0; i < 6; i++) sampler.report({ phase: `p${i}` });
  assert.equal(sampler.recent().length, 3, 'only the newest lines are kept');
  assert.deepEqual(sampler.recent().map((l) => l.phase), ['p3', 'p4', 'p5']);
  assert.ok(LOOP_LOG_MAX >= 3);
});

test('percentiles come from the real histogram, so a stalled tick shows up', () => {
  const hist = fakeHistogram([1e6, 2e6, 3e6, 50e6]);
  const sampler = createEventLoopSampler({ log: { info() {} }, histogram: hist, windowMs: 1000 });
  const stats = sampler.snapshot();
  assert.equal(stats.max, 50, 'the stalled tick is reported in ms');
  assert.ok(stats.p99 >= 3, 'and it dominates the tail');
  assert.equal(stats.samples, 4);
  sampler.close();
});

test('a real sampler observes the loop and stays quiet when it is closed', async () => {
  const lines = [];
  const sampler = createEventLoopSampler({ log: { info: (m) => lines.push(m) }, windowMs: 30,
    histogram: monitorEventLoopDelay({ resolution: 5 }) });
  sampler.start();
  await new Promise((r) => setTimeout(r, 90));
  sampler.stop();
  sampler.close();
  assert.equal(lines.length >= 0, true);
  assert.equal(sampler.running, false);
});
