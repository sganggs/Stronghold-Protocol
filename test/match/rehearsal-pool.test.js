// The bot layout rehearsal handed to the server's own simulation pool (server/workers/roomPool.js) instead of being
// simulated in this thread — the lobby's real prep path (MatchPrep.scheduleBotPrep → botPrepBeginSteps →
// MatchRehearsal.poolRehearsal), not just the pool module on its own.
//
// What has to hold here, and what the maintainer's review asked for:
//   - submitted: the candidates go to the pool, its pick reaches the board, and the match plays out exactly like the
//     run that rehearsed on this thread (the pool changes where the CPU is spent, never what is compared);
//   - cancelled: a prep that ends, or a match that is disposed, cancels the task at the pool — nothing of it applies
//     afterwards, and no host is told anything (a pool task has no executor);
//   - overloaded: a pool that answers POOL_FULL makes the server rehearse those same candidates itself;
//   - failed: a task that fails after it was accepted falls back the same way, with the pool's reason in the log.
// The comparison itself (the real pool picking the same index, and a battle matching byte for byte) is in
// test/workers-room.test.js, next to the module.
//
// The stand-in below answers on the match's own virtual scheduler and hands its result back through a thenable, so the
// whole match stays a synchronous, deterministic run: a real `Promise` would only settle on the process' microtask
// queue, which a synchronous scheduler loop never drains — that would make the ordering (and the boards) depend on the
// harness rather than on the pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { RehearsalRun } from '../../server/sim/rehearsal.js';
import { makeMatch, checkInvariants } from './harness.js';

/** Co-op, two humans (both played by the engine) and two AI seats: every seat rehearses its layout. */
const SEATS = [
  { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
  { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true },
  { seat: 2, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
  { seat: 3, playerId: 'ai_1', name: 'AI1', isBot: true, connected: true },
];

/** A wall-clock nanosecond of slice: every prep step and every few rehearsal ticks gets its own callback. */
const TINY_SLICE = 1e-9;

/** The state a rehearsal choice shows up in: every seat's board, funds and level. */
const stateOf = (m) => JSON.stringify([...m.players.values()].map((ps) => ({
  board: [...ps.board.entries()].map(([k, p]) => [k, p.id, p.dir ?? null]).sort(),
  hand: ps.hand.map((p) => p && p.id), funds: ps.funds, level: ps.shop.level, lp: ps.lp,
})));

/**
 * A stand-in for the simulation pool, answering on the match's virtual scheduler.
 * `answer(payload)` returns `{ bestIndex }` or throws; the answer (or the error) reaches the match through the
 * thenable the submit() handle exposes, exactly as `pool.submit(...).promise` would.
 * @param {{ sched: { setTimeout: Function } }} h the harness whose virtual clock delivers the answer
 * @param {(payload: object) => { bestIndex: number }} answer
 * @param {{ delayMs?: number | null }} [o] when the answer arrives (virtual ms); null never answers
 */
function stubPool(h, answer, { delayMs = 0 } = {}) {
  const pool = { submits: [], cancels: [], rejections: 0, received: 0 };
  pool.submit = (type, payload) => {
    pool.submits.push({ type, payload });
    const ok = [], bad = [];
    const settle = () => {
      pool.received++;
      let value;
      try { value = answer(payload); } catch (err) { pool.rejections++; for (const fn of bad) fn(err); return; }
      for (const fn of ok) fn(value);
    };
    if (delayMs == null) {
      // never answers: the task is still in flight for the rest of the match
    } else h.sched.setTimeout(settle, delayMs);
    return {
      // a thenable, not a Promise: the match's `.then` is called as soon as the virtual clock delivers the answer
      promise: { then: (fn, onError) => { ok.push(fn); if (onError) bad.push(onError); } },
      cancel: () => pool.cancels.push(payload.playerId),
    };
  };
  return pool;
}

/** A match of the reported shape; the pool is attached before start, as the lobby does with Match options. */
function play({ simPool = null, log = null } = {}) {
  const h = makeMatch({
    mode: 'coop', difficulty: 'NORMAL', seats: SEATS, seed: 5, botRehearsal: 3, botSliceMs: TINY_SLICE,
    ...(log ? { log } : {}),
  });
  if (simPool) h.m.simPool = simPool;
  h.start();
  h.autoHumans(); // both humans play as bots, so every seat rehearses its layout
  return h;
}

const reached = (h, round) => () => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === round);

test('a prep rehearsal is submitted to the pool and its pick reaches the board', () => {
  const plain = play();
  assert.ok(plain.run(reached(plain, 4), { maxSteps: 8e6 }), `round 4 reached (${plain.m.phase} R${plain.m.round})`);
  const want = stateOf(plain.m);
  plain.m.dispose();

  // the stand-in answers exactly what this thread's own rehearsal would: the same candidates, the same comparison
  let reference = null;
  const h = play();
  const pool = stubPool(h, (payload) => {
    const run = new RehearsalRun(
      payload.specs.map((spec) => () => createBattleFromSpec(spec, h.m.ds)), payload.playerId, payload.cap,
    );
    run.run();
    reference = run.score.index;
    return { bestIndex: run.score.index };
  });
  h.m.simPool = pool;
  assert.ok(h.run(reached(h, 4), { maxSteps: 8e6 }), `round 4 reached (${h.m.phase} R${h.m.round})`);

  assert.ok(pool.submits.length > 0, 'the pool was handed the bot rehearsals');
  assert.equal(pool.submits[0].type, 'rehearsal');
  assert.ok(Array.isArray(pool.submits[0].payload.specs) && pool.submits[0].payload.specs.length >= 2);
  assert.ok(Number.isInteger(pool.submits[0].payload.cap) && pool.submits[0].payload.cap > 0);
  assert.equal(pool.received, pool.submits.length, 'every submitted task was answered');
  const stats = h.m.rehearsalPoolStats;
  assert.equal(stats.pooled, pool.submits.length);
  assert.equal(stats.accepted, pool.submits.length, 'every answered pick was applied');
  assert.equal(stats.fallbacks, 0, 'nothing had to run on this thread');
  assert.equal(typeof reference, 'number');
  assert.equal(h.m.rehearsalStats.takeovers, 0, 'the delegation counters stay untouched');
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  checkInvariants(h.m);
  assert.equal(stateOf(h.m), want, 'the same boards, funds and levels as the thread-only run');
  h.m.dispose();
});

test('a prep that ends while the pool is still working cancels the task and applies nothing of it', () => {
  const h = play();
  const pool = stubPool(h, () => ({ bestIndex: 0 }), { delayMs: null }); // never answers
  h.m.simPool = pool;
  // the bot's planning steps come first and the rehearsal is offered at the end of them: run until the pool holds one
  assert.ok(h.run(() => pool.submits.length > 0, { maxSteps: 4e6 }), 'a rehearsal reached the pool');
  assert.ok(h.m._rehearsalTasks.size > 0, 'the match is waiting on that task');
  // let the prep run out: the bots place their default layouts and the phase moves on
  assert.ok(h.run(() => h.m.phase !== PHASE.PREP || h.m.round !== 1 || h.ended != null, { maxSteps: 4e6 }), 'the prep ended');
  assert.ok(pool.submits.length >= 1);
  assert.equal(pool.cancels.length, pool.submits.length, 'every task still in flight was cancelled at the pool');
  assert.equal(h.m.rehearsalPoolStats.accepted, 0, 'no unanswered pick was applied');
  assert.equal(h.m.rehearsalPoolStats.fallbacks, 0, 'nor did anything else run as a fallback');
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  assert.equal(h.m._rehearsalTasks.size, 0, 'no task outlives the prep');
  h.m.dispose();
});

test('an overloaded pool (POOL_FULL) makes the server rehearse the candidates itself', () => {
  const plain = play();
  assert.ok(plain.run(reached(plain, 4), { maxSteps: 8e6 }), `round 4 reached (${plain.m.phase} R${plain.m.round})`);
  const want = stateOf(plain.m);
  plain.m.dispose();

  const h = play();
  const pool = stubPool(h, () => { throw Object.assign(new Error('simulation pool unavailable'), { code: 'POOL_FULL' }); });
  h.m.simPool = pool;
  assert.ok(h.run(reached(h, 4), { maxSteps: 8e6 }), `round 4 reached (${h.m.phase} R${h.m.round})`);
  assert.ok(pool.submits.length > 0, 'the pool was asked first');
  assert.equal(pool.rejections, pool.submits.length, 'every task was refused');
  assert.equal(h.m.rehearsalPoolStats.fallbacks, pool.submits.length, 'and every one ran on this thread instead');
  assert.equal(h.m.rehearsalPoolStats.accepted, 0);
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  checkInvariants(h.m);
  assert.equal(stateOf(h.m), want, 'a refused pool costs latency, never a different layout');
  h.m.dispose();
});

test('a task that fails after acceptance falls back to this thread, with the pool reason in the log', () => {
  const plain = play();
  assert.ok(plain.run(reached(plain, 4), { maxSteps: 8e6 }), `round 4 reached (${plain.m.phase} R${plain.m.round})`);
  const want = stateOf(plain.m);
  plain.m.dispose();

  const lines = [];
  const h = play({ log: { info: (line) => lines.push(String(line)) } });
  const pool = stubPool(h, () => { throw new Error('worker exited with code 1'); });
  h.m.simPool = pool;
  assert.ok(h.run(reached(h, 4), { maxSteps: 8e6 }), `round 4 reached (${h.m.phase} R${h.m.round})`);
  assert.ok(h.m.rehearsalPoolStats.fallbacks > 0, 'a failed task falls back');
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  assert.ok(lines.some((l) => l.includes('rehearsal ← server (pool unavailable)')), `the log names the fallback:\n${lines.join('\n')}`);
  assert.equal(stateOf(h.m), want, 'the fallback applies the layout the thread-only run applies');
  h.m.dispose();
});

test('without a pool nothing is submitted anywhere and every rehearsal stays on this thread', () => {
  const h = play();
  assert.ok(h.run(reached(h, 3), { maxSteps: 8e6 }), `round 3 reached (${h.m.phase} R${h.m.round})`);
  assert.equal(h.m.simPool, null);
  assert.deepEqual(h.m.rehearsalPoolStats, { pooled: 0, accepted: 0, fallbacks: 0 });
  assert.deepEqual(h.m.rehearsalStats, { delegated: 0, answered: 0, takeovers: 0 });
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  h.m.dispose();
});


test('plugin and historical matches reject the default-data pool before building specs', () => {
  const h = play();
  let submitted = 0;
  h.m.simPool = { submit() { submitted++; } };
  const inputs = [{ get players() { throw new Error('must not serialize'); } }, {}];
  const args = { ps: h.m.order[0], chosen: [], plans: [new Map(), new Map()], inputs };
  h.m.requireCs = true;
  assert.equal(h.m.poolRehearsal(args), null);
  h.m.requireCs = false;
  h.m.version = 'act1autochess';
  assert.equal(h.m.poolRehearsal(args), null);
  assert.equal(submitted, 0);
  h.m.dispose();
});
