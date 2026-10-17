// The bot layout rehearsal delegated to the room's host (DESIGN §14; Match.botRehearsalDelegate / SP_BOT_REHEARSAL=host):
// the server hands the current host the candidate BattleSpecs of one bot prep, the host's browser answers with the index
// of its pick, and the match applies exactly the layout the server's own rehearsal would have applied. A host that is
// absent, silent (timeout), disconnected, replaced or unable to run the task makes the server rehearse the same
// candidates itself; a late or repeated answer of a task the server took over changes nothing, and a rehearsal still
// waiting when the prep ends never reaches the board. The shared comparison itself (scoring, early stop, tick cap, the
// candidate boundaries a slice stops on) is unit-tested in test/sim/rehearsal.test.js, next to its module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { deriveSeed } from '../../server/sim/rng.js';
import { RehearsalRun, rehearsalLimits } from '../../server/sim/rehearsal.js';
import { ADAPTIVE_STAGE, ADAPTIVE_CAPS } from '../../server/match/bot.js';
import { makeMatch, checkInvariants } from './harness.js';
import { attachRehearsalHost, simulateRehearsal } from './simClient.js';

/** Answers never arrive within these tests' runs (a task is still in flight when the test acts). */
const NEVER = 1e9;

/** A co-op match with two humans (the host and a teammate) and two AI seats — every seat played by the engine. */
function coopMatch(o = {}) {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true },
    { seat: 2, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
    { seat: 3, playerId: 'ai_1', name: 'AI1', isBot: true, connected: true },
  ];
  const { host, disconnect, ...opts } = o;
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 5, botRehearsal: 3, ...opts }).start();
  h.autoHumans(); // both humans play as bots, so every seat rehearses its layout
  return h;
}

/** One human (its own prep played by hand) and three AI seats — the shape the callback-order cases were reported with. */
const SOLO_SEATS = [
  { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true },
  { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
  { seat: 2, playerId: 'ai_1', name: 'AI1', isBot: true, connected: true },
  { seat: 3, playerId: 'ai_2', name: 'AI2', isBot: true, connected: true },
];
/** A slicing budget of a wall-clock nanosecond: every prep step and every 4 ticks of a rehearsal gets its own callback,
 *  so a host's answer really interleaves with the generator that offered the task — not a performance measurement. */
const TINY_SLICE = 1e-9;

/** The state a rehearsal choice shows up in: every seat's board, funds and level. */
const stateOf = (m) => JSON.stringify([...m.players.values()].map((ps) => ({
  board: [...ps.board.entries()].map(([k, p]) => [k, p.id, p.dir ?? null]).sort(),
  hand: ps.hand.map((p) => p && p.id), funds: ps.funds, level: ps.shop.level, lp: ps.lp,
})));

/**
 * Record every rehearsal Battle the server builds: the seat it belongs to (`r:<seat>`), the round and the scheduler
 * callback it was built in (`sched.executed`) — enough to tell a construction spread over the slices from one batch.
 */
function recordBuilds(h) {
  const built = [];
  const newBattle = h.m.newBattle.bind(h.m);
  h.m.newBattle = (input) => {
    if (input && String(input.fieldId).startsWith('r:')) built.push({ fieldId: String(input.fieldId), round: h.m.round, at: h.sched.executed });
    return newBattle(input);
  };
  return built;
}

/** The seats whose candidates the server built, deduplicated. */
const serverSeats = (built) => [...new Set(built.map((b) => b.fieldId))].sort();

/** Play a match to the SETTLE view of round `round`, recording every rehearsal Battle the server builds. */
function playRecording(round, o = {}, hostOpts = {}) {
  const h = coopMatch(o);
  const built = recordBuilds(h);
  const host = attachRehearsalHost(h, hostOpts);
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === round), { maxSteps: 8e6 });
  assert.ok(h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === round), `round ${round} reached`);
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  checkInvariants(h.m);
  return { h, host, built };
}

/**
 * The reported shape, played to the SETTLE view of round `round`: a co-op match of one human and three AI teammates
 * whose preps run in `botSliceMs` slices (TINY_SLICE by default), the human's own decisions driven by the harness (its
 * prep is no bot prep, so only the AI seats rehearse). `o` overrides the match options, `hostOpts` the scripted host.
 */
function playSolo(round, o = {}, hostOpts = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats: SOLO_SEATS, seed: 6, botRehearsal: 3, botSliceMs: TINY_SLICE, ...o }).start();
  const built = recordBuilds(h);
  const host = attachRehearsalHost(h, hostOpts);
  const reached = h.drive(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === round), { ready: true, maxSteps: 8e6 });
  assert.ok(reached && (h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === round)), `round ${round} reached (${h.m.phase} R${h.m.round})`);
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  checkInvariants(h.m);
  return { h, host, built };
}

/** A match played to the SETTLE view of round `round` (every prep rehearsed), with a scripted host. */
function playTo(round, o = {}) {
  const hostOpts = o.host ?? {};
  const h = coopMatch(o);
  const host = attachRehearsalHost(h, hostOpts);
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === round), { maxSteps: 8e6 });
  assert.ok(h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === round), `round ${round} reached`);
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  checkInvariants(h.m);
  return { h, host, state: stateOf(h.m) };
}

test('delegation off (the default): no rehearsal is ever offered to a browser', () => {
  const { h, host } = playTo(3, { hostId: 'p_0' });
  assert.equal(h.m.botRehearsalDelegate, false);
  assert.equal(host.tasks.length, 0);
  assert.deepEqual(h.m.rehearsalStats, { delegated: 0, answered: 0, takeovers: 0 });
  h.m.dispose();
});

test('an answered delegation plays exactly the match the server rehearsal plays', () => {
  const local = playTo(4, { hostId: 'p_0' });
  const delegated = playTo(4, { hostId: 'p_0', botRehearsalDelegate: true });
  assert.ok(delegated.host.tasks.length >= 4, `several preps rehearsed (${delegated.host.tasks.length} tasks)`);
  assert.equal(delegated.host.answered, delegated.host.tasks.length);
  const stats = delegated.h.m.rehearsalStats;
  assert.equal(stats.delegated, delegated.host.tasks.length);
  assert.equal(stats.answered, delegated.host.tasks.length);
  assert.equal(stats.takeovers, 0);
  assert.equal(delegated.state, local.state, 'the same boards, funds and levels as the server-only run');
  local.h.m.dispose();
  delegated.h.m.dispose();
});

test('the browser\'s pick on a task is the pick the server\'s own rehearsal makes of the same candidates', () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0' });
  /** frame + the server job it belongs to (the candidates' battle inputs), answered with the browser's pick */
  const seen = [];
  h.onSend.push((pid, msg) => {
    if (msg.t !== 'b.rehearsal') return;
    const job = h.m._rehearsalTasks.get(msg.taskId)?.job;
    assert.ok(job, 'the task is registered before the frame goes out');
    const choice = simulateRehearsal(msg, h.m.ds);
    // the server's own path: its Battle class over the very inputs the spec was built from
    const serverPick = (() => {
      const run = new RehearsalRun(job.inputs.map((o) => () => h.m.newBattle(o)), msg.playerId, msg.cap);
      run.run();
      return run.score.index;
    })();
    assert.equal(choice, serverPick, `candidate pick of ${msg.taskId}`);
    assert.ok(Number.isInteger(choice) && choice >= 0 && choice < msg.specs.length);
    seen.push(msg.taskId);
    h.sched.setTimeout(() => h.m.handle(pid, { t: 'b.rehearsalResult', taskId: msg.taskId, choice }), 0);
  });
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 4), { maxSteps: 8e6 });
  assert.ok(seen.length >= 4, `several candidates compared (${seen.length})`);
  assert.equal(h.m.rehearsalStats.takeovers, 0);
  assert.equal(h.m.errorCount, 0);
  checkInvariants(h.m);
  h.m.dispose();
});

test('an answered delegation leaves the server no candidate to simulate', () => {
  // the human's own prep is played by hand (no bot prep, no rehearsal); all three AI seats are delegated and answered
  const r = playSolo(3, { botRehearsalDelegate: true, hostId: 'p_0' });
  assert.ok(r.host.tasks.length >= 3, `several preps delegated (${r.host.tasks.length})`);
  assert.equal(r.h.m.rehearsalStats.takeovers, 0);
  assert.deepEqual(r.built, [], 'the server built no rehearsal Battle at all: that CPU is the point of the delegation');
  r.h.m.dispose();
});

test('a silent host times out: the server rehearses the same candidates and the match is unchanged', () => {
  const local = playTo(3, { hostId: 'p_0' });
  const silent = playTo(3, { hostId: 'p_0', botRehearsalDelegate: true, host: { mute: true } });
  assert.ok(silent.host.tasks.length > 0, 'the tasks were sent');
  assert.equal(silent.h.m.rehearsalStats.answered, 0);
  assert.ok(silent.h.m.rehearsalStats.takeovers > 0, 'the server took the silent tasks over');
  assert.equal(silent.state, local.state);
  local.h.m.dispose();
  silent.h.m.dispose();
});

test('what the host never ran, the server rehearses itself: the takeover builds the candidates', () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0' });
  const built = [];
  const newBattle = h.m.newBattle.bind(h.m);
  h.m.newBattle = (o) => { if (o && String(o.fieldId).startsWith('r:')) built.push(o.fieldId); return newBattle(o); };
  attachRehearsalHost(h, { mute: true });
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 2), { maxSteps: 8e6 });
  assert.ok(built.length > 0, 'a takeover simulates the candidates the browser did not');
  h.m.dispose();
});

test('an answer that lands before the driver subscribed to the job is applied, never recomputed', () => {
  // the reported race: the task is offered, the host answers, and only then does the prep driver receive the job — with
  // `pending` already false. `sync` is the extreme of that order (the answer beats the offering call's own return).
  const r = playSolo(3, { hostId: 'p_0', botRehearsalDelegate: true }, { sync: true });
  assert.ok(r.host.tasks.length >= 3, `several preps delegated (${r.host.tasks.length} tasks)`);
  assert.equal(r.host.answered, r.host.tasks.length, 'the host answered every task');
  assert.equal(r.h.m.rehearsalStats.answered, r.host.tasks.length);
  assert.equal(r.h.m.rehearsalStats.takeovers, 0);
  assert.deepEqual(r.built, [], 'a picked candidate is never simulated again, whatever the callback order');
  assert.deepEqual(r.host.cancels, [], 'an answered task is not cancelled');
  r.h.m.dispose();
});

test('delegation under the finest slicing: every prep is answered and the server builds no candidate', () => {
  // the reported scenario: every prep step and every 4 rehearsed ticks in its own callback (TINY_SLICE), the answer on
  // the next one — the delegated path must leave the server without a single candidate to build
  const r = playSolo(3, { hostId: 'p_0', botRehearsalDelegate: true });
  assert.ok(r.host.tasks.length >= 3, `several preps delegated (${r.host.tasks.length} tasks)`);
  assert.equal(r.host.answered, r.host.tasks.length, 'the host answered every task');
  assert.equal(r.h.m.rehearsalStats.answered, r.host.tasks.length);
  assert.equal(r.h.m.rehearsalStats.takeovers, 0);
  assert.deepEqual(r.built, [], 'the server built no candidate of an answered task');
  r.h.m.dispose();
});

test('only an AI teammate is delegated: a human seat under AI 托管 keeps the server\'s rehearsal', () => {
  const r = playRecording(3, { hostId: 'p_0', botRehearsalDelegate: true });
  assert.ok(r.host.tasks.length >= 3, `AI seats are delegated (${r.host.tasks.length} tasks)`);
  for (const t of r.host.tasks) assert.equal(r.h.m.players.get(t.frame.playerId).isBot, true, `${t.frame.playerId} is an AI teammate`);
  assert.equal(r.h.m.rehearsalStats.delegated, r.host.tasks.length);
  assert.equal(r.h.m.rehearsalStats.takeovers, 0);
  // the humans play the same bot prep (autoHumans) but rehearse on the server: their candidates are the ones built here
  assert.deepEqual(serverSeats(r.built), ['r:p_0', 'r:p_1'], 'the server rehearsed the two human seats itself');
  r.h.m.dispose();
});

test('a task the server takes over is cancelled on its host, an answered one is not', () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0', botRehearsalDelegateMs: NEVER });
  const host = attachRehearsalHost(h, { manual: true });
  h.run(() => host.tasks.length > 0, { maxSteps: 3e6 });
  const task = host.tasks[0];
  assert.deepEqual(host.cancels, [], 'nothing is cancelled while the host may still answer');
  h.m.prepDeadline();
  assert.deepEqual(host.cancels, [task.frame.taskId], 'the host is told to stop the task the server released');
  // an accepted answer is the host being done with the task: no cancel frame for it
  const next = attachRehearsalHost(h, { manual: true });
  h.run(() => next.tasks.length > 0, { maxSteps: 3e6 });
  const answered = next.tasks[0];
  next.answer(answered, { choice: simulateRehearsal(answered.frame, h.m.ds) });
  assert.equal(h.m.rehearsalStats.answered, 1);
  assert.deepEqual(next.cancels, []);
  h.m.dispose();
});

test('a bot prep builds its candidates inside the slices, not all of them at once', () => {
  const r = playSolo(3);
  /** per AI prep (one seat and round) the scheduler callback each of its candidates was built in */
  const preps = new Map();
  for (const b of r.built) {
    const key = `${b.fieldId}@${b.round}`;
    preps.set(key, [...(preps.get(key) || []), b.at]);
  }
  const several = [...preps.values()].filter((calls) => calls.length > 1);
  assert.ok(several.length > 0, 'several candidates were rehearsed');
  for (const calls of several) assert.equal(new Set(calls).size, calls.length, `candidate builds share a scheduler callback: ${calls}`);
  r.h.m.dispose();
});

test('a host that cannot run the task (error) hands it back at once', () => {
  const local = playTo(3, { hostId: 'p_0' });
  const failing = playTo(3, { hostId: 'p_0', botRehearsalDelegate: true, host: { error: true, botRehearsalDelegateMs: NEVER } });
  assert.equal(failing.h.m.rehearsalStats.answered, 0);
  assert.equal(failing.h.m.rehearsalStats.takeovers, failing.host.tasks.length);
  assert.equal(failing.state, local.state);
  local.h.m.dispose();
  failing.h.m.dispose();
});

test('an invalid or malformed answer is refused: the server rehearses the candidates itself', () => {
  for (const bad of [() => 99, () => -1, () => 1.5, () => 'best', () => null]) {
    const local = playTo(3, { hostId: 'p_0' });
    const wrong = playTo(3, { hostId: 'p_0', botRehearsalDelegate: true, botRehearsalDelegateMs: NEVER, host: { tamper: bad } });
    assert.equal(wrong.h.m.rehearsalStats.answered, 0, String(bad));
    assert.equal(wrong.h.m.rehearsalStats.takeovers, wrong.host.tasks.length, String(bad));
    assert.equal(wrong.state, local.state, String(bad));
    local.h.m.dispose();
    wrong.h.m.dispose();
  }
});

test('without a host (no room host, or a bot / disconnected one) the server rehearses locally', () => {
  for (const o of [{ hostId: null }, { hostId: 'ai_0' }, { hostId: 'p_0', disconnect: 'p_0' }]) {
    const h = coopMatch({ botRehearsalDelegate: true, ...o });
    if (o.disconnect) h.m.onDisconnect(o.disconnect);
    const host = attachRehearsalHost(h);
    h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 2), { maxSteps: 8e6 });
    assert.equal(h.m.errorCount, 0);
    assert.equal(host.tasks.length, 0, JSON.stringify(o));
    assert.equal(h.m.rehearsalStats.delegated, 0, JSON.stringify(o));
    assert.equal(h.m.rehearsalStats.takeovers, 0, JSON.stringify(o));
    checkInvariants(h.m);
    h.m.dispose();
  }
});

test('a host that disconnects mid-task falls back to the server; its late answer is ignored', () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0', botRehearsalDelegateMs: NEVER });
  const host = attachRehearsalHost(h, { manual: true });
  h.run(() => host.tasks.length > 0, { maxSteps: 3e6 });
  const task = host.tasks[0];
  assert.ok(h.m._rehearsalTasks.has(task.frame.taskId), 'the task is in flight');
  h.m.onDisconnect('p_0');
  assert.equal(h.m._rehearsalTasks.size, 0, 'the task was dropped');
  assert.equal(h.m.rehearsalStats.takeovers, 1);
  h.m.onReconnect('p_0');
  const before = stateOf(h.m);
  host.answer(task, { choice: 0 });
  assert.equal(h.m.rehearsalStats.answered, 0, 'the answer of a dead task counts for nothing');
  assert.equal(stateOf(h.m), before, 'a late answer changes nothing');
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 2), { maxSteps: 8e6 });
  assert.equal(h.m.errorCount, 0);
  checkInvariants(h.m);
  h.m.dispose();
});

test('a host change mid-task falls back to the server, and later tasks ask the new host', () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0', botRehearsalDelegateMs: NEVER });
  const host = attachRehearsalHost(h, { manual: true });
  h.run(() => host.tasks.length > 0, { maxSteps: 3e6 });
  const first = host.tasks[0];
  assert.equal(first.playerId, 'p_0');
  h.m.setHost('p_1');
  assert.equal(h.m.rehearsalStats.takeovers, 1);
  assert.equal(h.m._rehearsalTasks.size, 0);
  host.answer(first, { choice: 0 }); // the previous host's answer: no task of it is left
  assert.equal(h.m.rehearsalStats.answered, 0);
  const before = host.tasks.length;
  h.run(() => host.tasks.length > before, { maxSteps: 3e6 });
  assert.ok(host.tasks.length > before, 'the new host is asked');
  assert.equal(host.tasks[host.tasks.length - 1].playerId, 'p_1');
  h.m.dispose();
});

test('the prep deadline drops a rehearsal nobody answered; nothing of it runs after the phase', () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0', botRehearsalDelegateMs: NEVER });
  const host = attachRehearsalHost(h, { manual: true });
  h.run(() => host.tasks.length > 0, { maxSteps: 3e6 });
  const task = host.tasks[0];
  const bot = h.m.players.get(task.frame.playerId);
  assert.ok(h.m._rehearsalTasks.has(task.frame.taskId), 'the task is in flight');
  h.m.prepDeadline();
  assert.equal(h.m.phase, PHASE.COMBAT);
  assert.equal(h.m._rehearsalTasks.size, 0, 'the task died with the prep');
  assert.equal(h.m.rehearsalStats.takeovers, 0, 'nothing of it ran after the phase ended');
  const before = stateOf(h.m);
  host.answer(task, { choice: 0 });
  assert.equal(stateOf(h.m), before, 'the late answer of the dead task changes nothing');
  assert.ok(bot.deployCount <= bot.deployCap);
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 2), { maxSteps: 8e6 });
  assert.equal(h.m.errorCount, 0);
  checkInvariants(h.m);
  h.m.dispose();
});

test('a repeated answer of the same task applies one layout, never two', () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0', botRehearsalDelegateMs: NEVER });
  const host = attachRehearsalHost(h, { manual: true });
  h.run(() => host.tasks.length > 0, { maxSteps: 3e6 });
  const task = host.tasks[0];
  const choice = simulateRehearsal(task.frame, h.m.ds);
  host.answer(task, { choice });
  const state = stateOf(h.m);
  assert.equal(h.m.rehearsalStats.answered, 1);
  for (let i = 0; i < 3; i++) host.answer(task, { choice: 0 });
  assert.equal(h.m.rehearsalStats.answered, 1, 'only the first answer counts');
  assert.equal(stateOf(h.m), state, 'a duplicate answer changes nothing');
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 2), { maxSteps: 8e6 });
  assert.equal(h.m.errorCount, 0);
  checkInvariants(h.m);
  h.m.dispose();
});

for (const mode of ['legacy', 'learned', 'combined']) test(`the ${mode} task carries the server's own candidates: seeds, wave, cap and scoring player`, () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0', botRehearsalDelegateMs: NEVER });
  h.m.botFormationEnabled = mode !== 'legacy';
  h.m.botFormationMode = mode;
  const host = attachRehearsalHost(h, { manual: true });
  h.run(() => host.tasks.length > 0, { maxSteps: 3e6 });
  const frame = host.tasks[0].frame;
  assert.equal(typeof frame.taskId, 'string');
  assert.equal(frame.cap, Math.ceil(((h.m.wave.timeLimit || 60) + 5) * 30));
  assert.ok(frame.specs.length >= 2 && frame.specs.length <= (mode === 'combined' ? 6 : mode === 'learned' ? 4 : 3));
  for (const spec of frame.specs) {
    assert.equal(spec.v, 1);
    assert.equal(spec.kind, 'normal');
    assert.equal(spec.stageId, h.m.stageId);
    assert.equal(spec.players.length, 1);
    assert.equal(spec.players[0].playerId, frame.playerId);
    assert.ok(spec.spawns.length > 0 && spec.routes.length > 0);
    // 0.3.0 preview inputs (DESIGN §32.14.5): the normal field seed and layer gains, not the 0.2.6 rehearse: seed
    const bot = h.m.players.get(frame.playerId);
    assert.equal(spec.seed, deriveSeed(h.m.seed, `n:${h.m.round}:${bot.seat}`));
    assert.equal(spec.flags.layerGainsEnabled, true);
    assert.equal(spec.cs, undefined, 'a vanilla rehearsal spec names no content set');
    assert.equal(spec.timeLimit, h.m.wave.timeLimit);
  }
  h.m.dispose();
});

test('a gameplay-plugin room never delegates, even when the flag is on', () => {
  const cs = 'ab'.repeat(32);
  const h = coopMatch({ hostId: 'p_0', botRehearsalDelegate: true, cs, requireCs: true });
  const host = attachRehearsalHost(h);
  h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 2), { maxSteps: 8e6 });
  assert.equal(h.m.requireCs, true);
  assert.equal(host.tasks.length, 0, 'the host is not asked');
  assert.equal(h.m.rehearsalStats.delegated, 0);
  assert.equal(h.m.rehearsalStats.takeovers, 0);
  assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
  checkInvariants(h.m);
  h.m.dispose();
});

test('only the connected host can answer, and an out-of-range or late choice changes nothing', () => {
  const h = coopMatch({ botRehearsalDelegate: true, hostId: 'p_0', botRehearsalDelegateMs: NEVER });
  const host = attachRehearsalHost(h, { manual: true });
  h.run(() => host.tasks.length > 0, { maxSteps: 3e6 });
  const task = host.tasks[0];
  const forged = h.m.handle('p_1', { t: 'b.rehearsalResult', taskId: task.frame.taskId, choice: 0 });
  assert.deepEqual(forged, { ok: true });
  assert.equal(h.m.rehearsalStats.answered, 0, 'a teammate is not the executor');
  assert.ok(h.m._rehearsalTasks.has(task.frame.taskId), 'the task is still the host\'s');
  h.m.handle('p_0', { t: 'b.rehearsalResult', taskId: task.frame.taskId, choice: 99 });
  assert.equal(h.m.rehearsalStats.answered, 0);
  assert.equal(h.m.rehearsalStats.takeovers, 1, 'an out-of-range choice hands the candidates back');
  assert.equal(h.m._rehearsalTasks.size, 0);
  // the takeover may already have rehearsed and applied a layout; a late answer must not move that state again
  const before = stateOf(h.m);
  host.answer(task, { choice: 0 });
  assert.equal(h.m.rehearsalStats.answered, 0, 'the answer of a taken-over task counts for nothing');
  assert.equal(stateOf(h.m), before);
  h.m.dispose();
  assert.deepEqual(h.m.handle('p_0', { t: 'b.rehearsalResult', taskId: task.frame.taskId, choice: 0 }), { ok: true });
});

test('protocol rejects a forged, out-of-range or non-boolean rehearsal answer', () => {
  assert.equal(validateC2S({ t: 'b.rehearsalResult', taskId: 's.1.0.1', choice: 2 }), null);
  assert.equal(validateC2S({ t: 'b.rehearsalResult', taskId: 's.1.0.1', error: true }), null);
  assert.equal(validateC2S({ t: 'b.rehearsalResult', taskId: 's.1.0.1' }), null);
  for (const choice of [8, -1, 1.5, '0', null]) {
    assert.equal(typeof validateC2S({ t: 'b.rehearsalResult', taskId: 's.1.0.1', choice }), 'string', String(choice));
  }
  assert.equal(typeof validateC2S({ t: 'b.rehearsalResult', taskId: 's.1.0.1', error: false }), 'string');
  assert.equal(typeof validateC2S({ t: 'b.rehearsalResult', taskId: '../x', choice: 0 }), 'string');
  assert.equal(typeof validateC2S({ t: 'b.rehearsalResult', taskId: '', choice: 0 }), 'string');
});

test('an adaptive rehearsal sends its limits; the browser stops where the server does and the match is the same', () => {
  /** The co-op match with the adaptive formation mode on a taught map. */
  const adaptive = (o) => {
    const h = coopMatch(o).setStage('act2autochess_m03');
    h.m.botFormationEnabled = true;
    h.m.botFormationMode = 'adaptive';
    return h;
  };
  const play = (h) => {
    h.run(() => h.ended != null || (h.m.phase === PHASE.SETTLE && h.m.round === 4), { maxSteps: 8e6 });
    assert.equal(h.m.errorCount, 0, h.logs.error.join('\n'));
    checkInvariants(h.m);
    return stateOf(h.m);
  };
  const local = adaptive({ hostId: 'p_0' });
  attachRehearsalHost(local);
  const localState = play(local);
  const h = adaptive({ hostId: 'p_0', botRehearsalDelegate: true });
  const frames = [];
  h.onSend.push((pid, msg) => {
    if (msg.t !== 'b.rehearsal') return;
    const job = h.m._rehearsalTasks.get(msg.taskId)?.job;
    frames.push(msg);
    assert.equal(msg.stage, ADAPTIVE_STAGE);
    assert.equal(msg.tickBudget, ADAPTIVE_CAPS * msg.cap);
    const serverPick = (() => {
      const run = new RehearsalRun(job.inputs.map((o) => () => h.m.newBattle(o)), msg.playerId, msg.cap, rehearsalLimits(msg));
      run.run();
      return run.score.index;
    })();
    assert.equal(simulateRehearsal(msg, h.m.ds), serverPick, `candidate pick of ${msg.taskId}`);
  });
  const host = attachRehearsalHost(h);
  const state = play(h);
  assert.ok(frames.length >= 2, `adaptive tasks were delegated (${frames.length})`);
  assert.equal(host.answered, host.tasks.length);
  assert.equal(state, localState, 'the same boards, funds and levels as the server-only adaptive run');
  local.m.dispose();
  h.m.dispose();
});
