// Control messages may arrive while the real simulation loads or yields during catch-up. Keep those boundaries
// deterministic with a deferred loader and manual animation frames; no wall-clock sleeps or fake battle results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState, emptyMatch } from '../../public/js/store.js';
import * as specMod from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { validateC2S } from '../../shared/protocol.js';
import { runHeadless, validateClientResult } from '../../server/match/fields.js';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch } from './harness.js';

const DS = new DataSource(DATA, null);
const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7301, captureFrames: false, clientCombat: true, clients: false });
h.autoHumans();
h.m.start();
h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 2, { maxSteps: 3e6 });
const START = h.lastTo('p_0', 'b.start');
h.m.dispose();
assert.ok(START?.authoritative);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Drain promise continuations without letting the manual RAF queue run.
async function microtasks() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

function rig(t, { request = () => Promise.resolve({ t: 'ok' }), failBuild = false } = {}) {
  let time = 1000;
  let nextId = 0;
  let loadCalls = 0;
  const loaded = deferred();
  const frames = new Map();
  const intervals = new Map();
  const created = [];
  const sent = [];
  const fields = [];
  const handlers = new Map();
  const store = createStore(initialState);
  const sim = { ds: DS, spec: { ...specMod, createBattleFromSpec(...args) {
    if (failBuild) { failBuild = false; throw new Error('test construction failure'); }
    const battle = specMod.createBattleFromSpec(...args);
    created.push(battle);
    return battle;
  } } };
  const net = {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type).delete(fn);
    },
    emit(type, msg) { for (const fn of handlers.get(type) || []) fn({ t: type, ...msg }); },
    send(type, msg) { sent.push({ t: type, ...msg }); return true; },
    request(type, msg) { sent.push({ t: type, rid: 1, ...msg }); return request(type, msg); },
  };
  const runner = createBattleRunner({
    net, store, doc: { hidden: false, addEventListener() {} }, now: () => time,
    raf(fn) { const id = ++nextId; frames.set(id, fn); return id; },
    caf(id) { frames.delete(id); },
    setInterval(fn) { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    loadSim: () => ++loadCalls === 1 ? loaded.promise : Promise.resolve(sim),
    logger: { error() {}, warn() {}, info() {}, debug() {} },
  });
  runner.on('field', (f) => fields.push(f));
  t.after(() => runner.dispose());
  store.patch('match', { public: { phase: PHASE.COMBAT } });
  return {
    runner, net, store, created, sent, fields, frames, intervals,
    load() { loaded.resolve(sim); },
    failLoad() { loaded.reject(new Error('test loader failure')); },
    elapse(ms) { time += ms; },
    frame(ms = 0) {
      time += ms;
      const work = [...frames.values()];
      frames.clear();
      for (const fn of work) fn(time);
    },
  };
}

/** Start and stop at a precise boundary: loader pending, catch-up RAF pending, or already registered. */
async function begin(r, stage, msg = START) {
  const started = r.runner.onStart({ ...msg, elapsed: stage === 'catch-up' ? 30 : 0 });
  if (stage !== 'loading') {
    r.load();
    await microtasks();
  }
  if (stage === 'catch-up') {
    assert.equal(r.created.length, 1);
    assert.equal(r.runner._entries.size, 0, 'catch-up has not registered the battle');
    assert.ok(r.frames.size, 'catch-up yielded to an animation frame');
    assert.ok(r.created[0].tickCount > 0 && !r.created[0].finished);
  } else if (stage === 'ready') {
    await started;
    assert.equal(r.runner._entries.size, 1);
  } else {
    assert.equal(r.created.length, 0);
  }
  return { started };
}

async function settle(r, ...starts) {
  let done = false;
  const all = Promise.all(starts).then(() => { done = true; });
  r.load();
  for (let i = 0; i < 30 && !done; i++) {
    await microtasks();
    r.frame();
  }
  await microtasks();
  assert.ok(done, 'preparation completes within the manual frame budget');
  await all;
}

function end(r, reason, battleId = START.battleId) { r.net.emit('b.end', { battleId, reason }); }
function results(r, battleId = START.battleId) { return r.sent.filter((m) => m.t === 'b.result' && m.battleId === battleId); }
function validFrames(r) { for (const msg of r.sent) assert.equal(validateC2S(msg), null, `valid ${msg.t}`); }

function finish(r, e) {
  for (let i = 0; i < 500 && !e.battle.finished; i++) r.frame(1000);
  assert.ok(e.battle.finished, 'the real battle reaches its natural end');
}

for (const stage of ['loading', 'catch-up', 'ready']) {
  test(`b.end takeover during ${stage}: demote before further progress or result, including a duplicate`, async (t) => {
    const r = rig(t);
    const { started } = await begin(r, stage);
    end(r, 'takeover');
    end(r, 'takeover');
    const before = r.sent.length;
    await settle(r, started);
    const e = r.runner._entries.get(START.battleId);
    assert.ok(e);
    assert.equal(e.authoritative, false);
    finish(r, e);
    assert.equal(r.sent.length, before, 'no report after authority was handed over');
    assert.equal(results(r).length, 0);
    validFrames(r);
  });

  for (const reason of ['forced', 'timeout']) {
    test(`b.end ${reason} during ${stage}: finish once and preserve the server end reason`, async (t) => {
      const r = rig(t);
      const { started } = await begin(r, stage);
      end(r, reason);
      end(r, reason);
      await settle(r, started);
      const e = r.runner._entries.get(START.battleId);
      assert.ok(e?.battle.finished);
      assert.equal(e.battle.result().reason, reason);
      assert.equal(results(r).length, 1);
      assert.equal(results(r)[0].result.reason, reason);
      const before = r.sent.length;
      r.frame(10000);
      end(r, reason);
      assert.equal(r.sent.length, before, 'a duplicate end cannot send a second result');
      validFrames(r);
    });
  }

  const cleanups = {
    clear: (r) => r.runner.clear(),
    PREP: (r) => r.store.patch('match', { public: { phase: PHASE.PREP } }),
    RESULT: (r) => r.store.patch('match', { public: { phase: PHASE.RESULT } }),
    exit: (r) => r.store.set({ match: emptyMatch() }),
    dispose: (r) => r.runner.dispose(),
  };
  for (const [name, cleanup] of Object.entries(cleanups)) {
    test(`${name} during ${stage}: old async work cannot register, run, or report again`, async (t) => {
      const r = rig(t);
      const { started } = await begin(r, stage);
      cleanup(r);
      const before = r.sent.length;
      const ticks = r.created.map((b) => b.tickCount);
      await settle(r, started);
      r.frame(10000);
      end(r, 'forced');
      assert.equal(r.runner._entries.size, 0);
      assert.equal(r.runner.state(), null);
      assert.equal(r.store.get().match.battle, null);
      assert.equal(r.sent.length, before, 'no late progress or result after cleanup');
      assert.deepEqual(r.created.map((b) => b.tickCount), ticks, 'no construction or stepping after cleanup');
      assert.equal(r.intervals.size, 0, 'no stale background pump');
      assert.equal(r.frames.size, 0, 'no stale animation loop');
    });
  }
}

for (const stage of ['loading', 'catch-up']) {
  test(`duplicate b.start during ${stage}: one real battle and ordered authority updates`, async (t) => {
    const r = rig(t);
    const { started } = await begin(r, stage);
    end(r, 'takeover');
    const duplicate = r.runner.onStart({ ...START, elapsed: 30 });
    await settle(r, started, duplicate);
    assert.equal(r.created.length, 1, 'one simulation per battleId while pending');
    const e = r.runner._entries.get(START.battleId);
    assert.equal(e.authoritative, true, 'a later explicit b.start can grant authority again');
    assert.equal(r.fields.length, 1, 'a duplicate pending start does not race to show two instances');
    end(r, 'takeover');
    const before = r.sent.length;
    r.frame(1000);
    assert.equal(r.sent.length, before, 'the latest takeover still wins');
    assert.equal(e.authoritative, false);
  });

  test(`forced end followed by duplicate b.start during ${stage}: keep the first terminal reason`, async (t) => {
    const r = rig(t);
    const { started } = await begin(r, stage);
    end(r, 'forced');
    const duplicate = r.runner.onStart({ ...START, elapsed: 30 });
    end(r, 'timeout');
    await settle(r, started, duplicate);
    assert.equal(r.created.length, 1);
    assert.equal(r.runner._entries.get(START.battleId).battle.result().reason, 'forced');
    assert.equal(results(r).length, 1);
    assert.equal(results(r)[0].result.reason, 'forced');
    validFrames(r);
  });

  test(`takeover then forced end during ${stage}: retain message order without an authoritative result`, async (t) => {
    const r = rig(t);
    const { started } = await begin(r, stage);
    end(r, 'takeover');
    end(r, 'forced');
    const before = r.sent.length;
    await settle(r, started);
    const e = r.runner._entries.get(START.battleId);
    assert.equal(e.authoritative, false);
    assert.ok(e.battle.finished);
    assert.equal(e.battle.result().reason, 'forced');
    assert.equal(r.sent.length, before);
  });
}

function watchedStart() {
  const fieldId = `${START.fieldId}_watch`;
  return { ...START, battleId: `${START.battleId}_watch`, fieldId, spec: { ...START.spec, fieldId }, authoritative: false, watch: true, elapsed: 0 };
}

for (const stage of ['loading', 'catch-up', 'ready']) {
  test(`switch field during ${stage}: keep the authority and send its server-identical natural result`, async (t) => {
    const r = rig(t);
    const { started } = await begin(r, stage);
    const watched = watchedStart();
    const next = r.runner.onStart(watched);
    await settle(r, started, next);
    assert.equal(r.runner.state().battleId, watched.battleId, 'the latest view stays selected');
    const e = r.runner._entries.get(START.battleId);
    assert.ok(e?.authoritative, 'the earlier authority remains responsible for its result');
    finish(r, e);
    await microtasks();
    assert.equal(results(r).length, 1);
    assert.equal(results(r, watched.battleId).length, 0, 'the display replica never reports');
    assert.equal(r.runner.state().battleId, watched.battleId);
    const server = runHeadless(specMod.createBattleFromSpec(START.spec, DS, { recordEvents: false }), { players: START.spec.players.map((p) => p.playerId) }).result;
    const actual = validateClientResult(START.spec, results(r)[0].result, {});
    const expected = validateClientResult(START.spec, specMod.compactResult(server), {});
    assert.ok(actual.ok && expected.ok);
    assert.equal(specMod.resultDigest(actual.result).hash, specMod.resultDigest(expected.result).hash);
    validFrames(r);
  });
}

for (const stage of ['loading', 'catch-up']) {
  test(`switch field during replica ${stage}: the superseded replica never takes the view back`, async (t) => {
    const r = rig(t);
    const { started } = await begin(r, stage, { ...START, authoritative: false, watch: true });
    const watched = watchedStart();
    const next = r.runner.onStart(watched);
    await settle(r, started, next);
    r.frame(1000);
    assert.equal(r.runner.state().battleId, watched.battleId);
    assert.ok(r.fields.every((f) => f.battleId === watched.battleId));
    assert.equal(r.sent.length, 0);
  });
}

test('an offscreen authority ended during catch-up publishes its final leaks when registered', async (t) => {
  const r = rig(t);
  const { started } = await begin(r, 'catch-up');
  const watched = watchedStart();
  // Show the new field without resuming the old authority's pending catch-up frame.
  await r.runner.onStart(watched);
  assert.equal(r.runner.state().battleId, watched.battleId);
  end(r, 'timeout');
  assert.ok(r.created[0].finished);
  assert.equal(r.runner._entries.has(START.battleId), false, 'the ended authority is still pending');
  const leaks = specMod.battleProgress(r.created[0]).leaks;
  assert.ok(leaks > 0, 'the real timeout has counted leaks to publish');
  r.frame();
  await started;
  assert.ok(r.runner._entries.get(START.battleId)?.done);
  assert.equal(r.store.get().match.battle.battleId, watched.battleId, 'the watched field stays selected');
  assert.equal(r.store.get().match.battle.leaks[START.fieldId], leaks, 'registration publishes the finished offscreen field even with no further ticks');
  assert.equal(results(r).length, 1);
  validFrames(r);
});

test('clear between old and new pending starts: the old task cannot remove or replace the new task', async (t) => {
  const r = rig(t);
  const { started } = await begin(r, 'catch-up');
  r.runner.clear();
  const watched = watchedStart();
  const next = r.runner.onStart(watched);
  const before = r.sent.length;
  await settle(r, started, next);
  r.frame(1000);
  assert.equal(r.runner._entries.size, 1);
  assert.equal(r.runner.state().battleId, watched.battleId);
  assert.equal(r.sent.length, before);
});

test('clear cancels a pending result timeout retry from the old battle', async (t) => {
  const response = deferred();
  const r = rig(t, { request: () => response.promise });
  const { started } = await begin(r, 'ready');
  end(r, 'forced');
  assert.equal(results(r).length, 1);
  r.runner.clear();
  response.reject({ code: 'TIMEOUT' });
  await settle(r, started);
  r.net.emit('status', { status: 'online' });
  await microtasks();
  assert.equal(results(r).length, 1, 'a discarded battle cannot retry its in-flight result');
  assert.equal(r.runner._entries.size, 0);
});

test('clear followed by the same battleId: the old continuation cannot replace the fresh start', async (t) => {
  const r = rig(t);
  const { started } = await begin(r, 'catch-up');
  const old = r.created[0];
  const tick = old.tickCount;
  r.runner.clear();
  const next = r.runner.onStart({ ...START, elapsed: 0 });
  await settle(r, started, next);
  assert.equal(r.created.length, 2);
  assert.equal(r.runner._entries.size, 1);
  assert.equal(r.runner._entries.get(START.battleId).battle, r.created[1]);
  assert.equal(old.tickCount, tick);
});

test('pause and resume during catch-up: exclude the paused interval from the pending battle clock', async (t) => {
  const r = rig(t);
  const { started } = await begin(r, 'catch-up');
  r.store.patch('match', { public: { phase: PHASE.COMBAT, paused: true } });
  r.elapse(5000);
  r.store.patch('match', { public: { phase: PHASE.COMBAT, paused: false } });
  await settle(r, started);
  const e = r.runner._entries.get(START.battleId);
  assert.ok(Math.abs(e.battle.time - 30) < 0.3, 'catch-up excludes the five paused real seconds');
  assert.equal(r.runner.state().paused, false);
});

let bossStart;
function realBossStart() {
  if (bossStart) return bossStart;
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 7304, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans();
  h.m.start();
  h.run(() => h.ended != null || h.m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 5e6 });
  bossStart = h.lastTo('p_0', 'b.start');
  h.m.dispose();
  assert.equal(bossStart.kind, 'boss');
  return bossStart;
}

for (const stage of ['loading', 'catch-up']) {
  test(`b.pool during ${stage}: the pending boss field keeps the latest server pool`, async (t) => {
    const start = realBossStart();
    const r = rig(t);
    const { started } = await begin(r, stage, start);
    const hp = start.spec.boss.poolMax * 0.75;
    const acked = r.created[0]?.sharedBoss?.cum || 0;
    r.net.emit('b.pool', { hp: hp + 1, acked: { [start.fieldId]: acked } });
    r.net.emit('b.pool', { hp, acked: { [start.fieldId]: acked } });
    if (stage === 'catch-up') assert.equal(r.created[0].sharedBoss.hp, hp, 'update reaches the yielded pending battle immediately');
    await settle(r, started);
    const pool = r.runner._entries.get(start.battleId).battle.sharedBoss;
    assert.equal(pool.hp, Math.max(0, hp - Math.max(0, pool.cum - acked)));
  });
}

for (const failure of ['loader', 'construction']) {
  test(`${failure} failure removes preparation state so a new b.start can retry`, async (t) => {
    const r = rig(t, { failBuild: failure === 'construction' });
    const { started } = await begin(r, 'loading');
    if (failure === 'loader') r.failLoad();
    else r.load();
    await started;
    assert.equal(r.runner.state(), null);
    assert.equal(r.runner._entries.size, 0);
    assert.equal(r.sent.length, 0);
    const next = r.runner.onStart(START);
    await settle(r, next);
    assert.equal(r.created.length, 1);
    assert.equal(r.runner._entries.get(START.battleId).authoritative, true);
    r.frame(1000);
    assert.ok(r.sent.some((m) => m.t === 'b.progress'));
    validFrames(r);
  });
}
