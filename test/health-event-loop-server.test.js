// test/health-event-loop-server.test.js — the loop sampler as wired into a real server (server/index.js).
//
// The maintainer asked for a sampler that is off by default, needs no thread pool, and answers one question with a local
// log: is the stall the rehearsal / battle slice on this thread? These tests start the real server and check exactly that —
// the pool is never built, /healthz is untouched, and the window line carries the counts an operator needs.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';

let savedSample;
beforeEach(() => { savedSample = process.env.SP_LOOP_SAMPLE; process.env.SP_LOOP_SAMPLE = '1'; });
afterEach(() => { if (savedSample === undefined) delete process.env.SP_LOOP_SAMPLE; else process.env.SP_LOOP_SAMPLE = savedSample; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a real server samples the loop with no worker pool and leaves /healthz alone', async () => {
  const lines = [];
  const log = { info: (...a) => lines.push(a.join(' ')), warn: () => {}, error: () => {}, debug: () => {} };
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, log, loopSample: { windowMs: 40 } });
  try {
    assert.ok(srv.eventLoop, 'the explicitly enabled sampler exists');
    assert.equal(srv.eventLoop.stats().pools, 0, 'and it needs no worker pool');
    await sleep(140);
    const loopLines = lines.filter((l) => l.startsWith('[loop]'));
    assert.ok(loopLines.length >= 2, `the window line is printed (${loopLines.length})`);
    const [line] = loopLines;
    for (const field of ['p50=', 'p95=', 'p99=', 'max=', 'cpu=', 'mem=', 'rooms=', 'humans=', 'matches=', 'spectators=']) {
      assert.ok(line.includes(field), `the line carries ${field}: ${line}`);
    }
    // it is a local log, not a new public field
    const health = await (await fetch(`${srv.url}/healthz`)).json();
    assert.equal(health.ok, true);
    for (const key of ['loop', 'eventLoop', 'p99', 'delay']) assert.equal(health[key], undefined, `/healthz has no ${key}`);
  } finally {
    await srv.close();
  }
});

test('SP_LOOP_SAMPLE=0 switches the sampler off', async () => {
  const saved = process.env.SP_LOOP_SAMPLE;
  process.env.SP_LOOP_SAMPLE = '0';
  const lines = [];
  const log = { info: (...a) => lines.push(a.join(' ')), warn: () => {}, error: () => {}, debug: () => {} };
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, log });
  try {
    assert.equal(srv.eventLoop, null, 'no sampler at all');
    await sleep(120);
    assert.deepEqual(lines.filter((l) => l.startsWith('[loop]')), [], 'and no loop lines');
  } finally {
    await srv.close();
    if (saved == null) delete process.env.SP_LOOP_SAMPLE; else process.env.SP_LOOP_SAMPLE = saved;
  }
});

test('the sampler reports a phase for the window it is asked about', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, loopSample: { windowMs: 5000 } });
  try {
    srv.lobby.rooms.set('phase-test', { seats: [], spectators: [], match: { phase: 'BATTLE', _rehearsalTasks: new Map([['x', {}]]) } });
    const record = srv.eventLoop.report();
    srv.lobby.rooms.delete('phase-test');
    assert.equal(record.phase, 'BATTLE');
    assert.equal(record.rehearsals, 1);
    assert.equal(typeof record.p95, 'number');
    assert.equal(typeof record.cpu, 'number');
    assert.equal(typeof record.mem, 'number');
    assert.equal(typeof record.rooms, 'number');
    assert.equal(typeof record.humans, 'number');
  } finally {
    await srv.close();
  }
});

test('closing the server stops the sampler', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, loopSample: { windowMs: 30 } });
  const sampler = srv.eventLoop;
  assert.equal(sampler.running, true);
  await srv.close();
  assert.equal(sampler.running, false, 'no timer survives close');
});


test('an unset sample setting allocates no monitor', async () => {
  delete process.env.SP_LOOP_SAMPLE;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try { assert.equal(srv.eventLoop, null); } finally { await srv.close(); }
});
