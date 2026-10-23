import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { DATA, makeMatch, give, chessOfTier } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { planUnite } from '../../server/match/unite.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { startUniteFastJob } from '../../server/match/uniteFastJob.js';

function fixture({ clientCombat = true, helpers = 2, bots = 0, enabled = true, count = 14, limit = 60, armed = false, speed = false } = {}) {
  const h = makeMatch({ humans: 4 - bots, bots, clientCombat, clients: false, instant: false,
    rules: { ...(enabled ? { uniteFastForward: 'unanimous' } : {}), ...(speed ? { battleSpeedControl: 'unanimous' } : {}) }, seed: 4141 });
  h.m.start();
  h.toPrep(1);
  const m = h.m;
  m.cancel(m._phaseTimer);
  m.wave = { ...m.wave, timeLimit: limit };
  const enemyKey = Object.keys(DATA.enemies).find(k => k.includes('slime')) ?? Object.keys(DATA.enemies)[0];
  for (const [i, ps] of m.order.entries()) {
    const helper = i >= 4 - helpers;
    if (helper && armed) {
      const id = chessOfTier(6, c => c.position === 'MELEE').find(x => m.pool.has(x));
      if (id) give(m, ps, id, 'board', [...ps.deployMap()].find(([, v]) => v === 'melee')[0].split(',').map(Number));
    }
    m.lastResults.set(ps.playerId, { killed: 0, total: helper ? 0 : count, perfect: helper, unitsEnd: [],
      leaked: helper ? [] : Array.from({ length: count }, () => ({ enemyKey, counted: true, lpr: 1, mods: { bountyCoins: 3 } })) });
  }
  const plan = planUnite(m, m.lastResults);
  assert.ok(plan);
  m.startUnite(plan);
  return h;
}
const vote = (m, pid, agree = true, extra = {}) => m.handle(pid, {
  t: 'g.uniteFast', round: m.round, phaseId: m.uniteFast?.phaseId ?? 'absent', agree, ...extra,
});
const approve = m => { for (const p of m._uniteVoters()) vote(m, p.playerId); };
const outcome = m => ({ phase: m.phase, round: m.round, unite: m.uniteResultView,
  players: m.order.map(p => ({ id: p.playerId, lp: p.lp, alive: p.alive, funds: p.pendingFunds, stats: p.stats })) });

test('Unite votes validate phase and authenticated seat; withdrawal, disconnection and reconnect', () => {
  const h = fixture();
  const m = h.m;
  try {
    assert.equal(validateC2S({ t: 'g.uniteFast', round: 1, phaseId: m.uniteFast.phaseId, agree: true }), null);
    assert.ok(validateC2S({ t: 'g.uniteFast', round: 1, phaseId: m.uniteFast.phaseId, agree: 'yes' }));
    assert.ok(vote(m, 'p_0').error);
    assert.ok(vote(m, 'p_2', true, { round: 2 }).error);
    assert.ok(vote(m, 'p_2', true, { phaseId: 'stale' }).error);
    vote(m, 'p_2'); vote(m, 'p_2');
    assert.deepEqual(m._uniteFastView().votes, ['p_2']);
    vote(m, 'p_2', false);
    assert.equal(m.uniteFast.votes.size, 0);
    vote(m, 'p_2');
    m.onDisconnect('p_2');
    assert.equal(m.uniteFast.votes.size, 0);
    assert.ok(vote(m, 'p_2').error);
    vote(m, 'p_3');
    assert.equal(m.uniteFast.status, 'waiting');
    m.onReconnect('p_2');
    assert.deepEqual(m._uniteFastView().votes, ['p_3']);
  } finally { m.dispose(); }
});

for (const clientCombat of [false, true]) for (const helpers of [1, 2]) {
  test(`Unite replay equals normal settlement: client=${clientCombat}, helpers=${helpers}`, async t => {
    const normal = fixture({ clientCombat, helpers, armed: true });
    const fast = fixture({ clientCombat, helpers, armed: true });
    try {
      const m = fast.m;
      const spec = m.uniteFast.spec;
      const expected = createBattleFromSpec(spec, m.ds, { recordEvents: false }).runToEnd(3700);
      // Different initial LP exercises elimination and the existing 10-LP cap.
      normal.m.order[0].lp = m.order[0].lp = 1;
      const started = performance.now();
      approve(m);
      const job = m.uniteFast.job;
      assert.equal(m.uniteFast.status, 'running');
      approve(m);
      assert.equal(m.uniteFast.job, job, 'duplicates share one job');
      assert.ok(m.handle(m._uniteVoters()[0].playerId, { t: 'g.autoplay', on: true }).error);
      const result = await job.promise;
      await nextTurn();
      assert.deepEqual(result, expected, 'entire result: owners, summons, kills, coins, stats');
      if (clientCombat) normal.m._runOnServer(normal.m.fields[0], 'test-normal');
      normal.run(() => normal.m.phase === PHASE.SETTLE);
      fast.run(() => m.phase === PHASE.SETTLE);
      assert.deepEqual(outcome(m), outcome(normal.m));
      const once = structuredClone(outcome(m));
      m._finishUniteClient();
      m._completeUniteServer(result);
      assert.deepEqual(outcome(m), once, 'late completion does not charge twice');
      assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
      t.diagnostic(`worker + settlement ${Math.round(performance.now() - started)} ms; normal battle ${expected.time / m.gameSpeed}s`);
    } finally { normal.m.dispose(); fast.m.dispose(); }
  });
}

test('natural completion wins before consent; a new phase clears old votes', () => {
  const h = fixture({ clientCombat: false });
  try {
    const m = h.m;
    vote(m, 'p_2');
    const old = m.uniteFast.phaseId;
    h.run(() => m.uniteFast.completed);
    assert.equal(m.uniteFast.votes.size, 0);
    vote(m, 'p_3');
    assert.equal(m.uniteFast.job, null);
    h.run(() => m.phase === PHASE.SETTLE);
    assert.ok(vote(m, 'p_2', true, { phaseId: old }).error);
  } finally { h.m.dispose(); }
});

test('worker failure/cancellation restores normal execution without partial settlement', async () => {
  const h = fixture();
  try {
    const m = h.m;
    const before = m.order.map(p => p.lp);
    approve(m);
    const job = m.uniteFast.job;
    job.cancel();
    await assert.rejects(job.promise);
    await nextTurn();
    assert.deepEqual(m.order.map(p => p.lp), before);
    assert.equal(m.uniteFast.status, 'waiting');
    assert.equal(m.uniteFast.votes.size, 0);
    h.run(() => m.phase === PHASE.SETTLE);
    assert.equal(m.errorCount, 0);
  } finally { h.m.dispose(); }
});

test('worker wall timeout terminates independently of simulation clock', async () => {
  const h = fixture();
  try {
    const job = startUniteFastJob({ spec: h.m.uniteFast.spec, data: DATA }, { timeoutMs: 1 });
    await assert.rejects(job.promise, /timeout/);
  } finally { h.m.dispose(); }
});

test('single human plus AI needs only human consent; AI-only never starts a job', async () => {
  for (const bots of [1, 2]) {
    const h = fixture({ bots });
    try {
      const m = h.m;
      assert.equal(m._uniteVoters().length, 2 - bots);
      approve(m);
      if (bots === 1) { await m.uniteFast.job.promise; await nextTurn(); assert.equal(m.uniteFast.status, 'complete'); }
      else assert.equal(m.uniteFast.job, null);
    } finally { h.m.dispose(); }
  }
});

test('disabled rule leaves vanilla Unite unchanged', () => {
  const h = fixture({ enabled: false });
  try { assert.equal(h.m.uniteFast, null); assert.ok(vote(h.m, 'p_2').error); }
  finally { h.m.dispose(); }
});

test('golden Unite boards: carried HP/SP, summons, bounties and main-loop responsiveness', async t => {
  const { fieldScenarios } = await import('../../tools/golden.mjs');
  for (const sc of fieldScenarios().filter(s => s.kind === 'unite')) {
    const h = fixture();
    try {
      const spec = buildBattleSpec({ ...sc, content: 'full' });
      const battle = createBattleFromSpec(spec, h.m.ds, { recordEvents: true });
      // Replay up to a trigger inside the battle, then continue at the same fixed step.
      for (let i = 0; i < 75 && !battle.finished; i++) battle.step();
      const expected = battle.runToEnd(3700);
      let beats = 0;
      const timer = setInterval(() => { beats++; }, 5);
      const start = performance.now();
      let result;
      try { result = await startUniteFastJob({ spec, data: DATA }).promise; }
      finally { clearInterval(timer); }
      assert.deepEqual(result, expected);
      assert.ok(beats > 0, 'other room event-loop work continues during replay');
      t.diagnostic(`${sc.id}: ${Math.round(performance.now() - start)} ms, ${beats} event-loop heartbeats`);
    } finally { h.m.dispose(); }
  }
});

for (const succeed of [false, true]) test(`normal completion during worker: success=${succeed}, one settlement`, async () => {
  const h = fixture({ clientCombat: false });
  try {
    const m = h.m;
    approve(m);
    const job = m.uniteFast.job;
    h.run(() => !!m.uniteFast.normalResult);
    assert.equal(m.phase, PHASE.UNITE, 'normal result is held without charging LP');
    if (!succeed) job.cancel();
    await job.promise.catch(() => {});
    await nextTurn();
    h.run(() => m.phase === PHASE.SETTLE);
    const lp = m.order.map(p => p.lp);
    m._completeUniteServer(m.uniteFast.normalResult);
    assert.deepEqual(m.order.map(p => p.lp), lp);
    assert.equal(m.errorCount, 0);
  } finally { h.m.dispose(); }
});

test('split children, summoned enemies and periodic damage survive worker replay', async () => {
  const { fieldScenarios } = await import('../../tools/golden.mjs');
  const sc = fieldScenarios().find(s => s.id === 'unite-2');
  const h = fixture();
  try {
    for (const key of ['enemy_1195_sfyin', 'enemy_1321_wdarft', 'enemy_1272_nhtank']) {
      const spec = buildBattleSpec({ ...sc, timeLimit: 120,
        spawns: sc.spawns.map((s, i) => ({ ...s, enemyKey: key, time: i * 0.5,
          mods: { ...s.mods, hpMul: key === 'enemy_1195_sfyin' ? 0.001 : 1 } })) });
      const battle = createBattleFromSpec(spec, h.m.ds, { recordEvents: true });
      let dot = 0;
      battle.on('damaged', c => { if (c.dmg?.tags?.some(tag => ['dot', 'pollution', 'bleed'].includes(tag))) dot++; });
      const expected = battle.runToEnd(3700);
      if (key !== 'enemy_1272_nhtank') assert.ok(expected.killed > expected.total, 'runtime children really spawned and died');
      else assert.ok(dot > 0, 'periodic damage really occurred');
      const result = await startUniteFastJob({ spec, data: DATA }).promise;
      assert.deepEqual(result, expected, key);
    }
  } finally { h.m.dispose(); }
});

test('spectators, eliminated players and other battle phases cannot vote', () => {
  const h = fixture();
  try {
    const m = h.m;
    m.spectators.set('viewer', { playerId: 'viewer', spectator: true, connected: true });
    assert.ok(vote(m, 'viewer').error);
    m.players.get('p_2').alive = false;
    assert.ok(vote(m, 'p_2').error);
    for (const phase of [PHASE.COMBAT, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]) {
      m.phase = phase;
      assert.ok(vote(m, 'p_3').error);
      assert.equal(m._uniteFastView(), null);
    }
  } finally { h.m.dispose(); }
});

test('speed and Unite fast settlement: real worker cancellation retains speed and cancels pending vote', async () => {
  const h = fixture({ speed: true }); const m = h.m;
  const send = (pid, action, target) => m.handle(pid, { t: 'g.battleSpeed', phaseId: m.speedControl.phaseId,
    revision: m.speedControl.revision, action, target, voteId: m.speedControl.vote?.id });
  try {
    send('p_2', 'propose', 4); send('p_3', 'agree');
    assert.equal(m.gameSpeed, 8);
    send('p_2', 'propose', 1);
    approve(m);
    assert.equal(m.speedControl.vote, null);
    assert.ok(send('p_2', 'propose', 1).error);
    const job = m.uniteFast.job; job.cancel();
    await job.promise.catch(() => {}); await nextTurn();
    assert.equal(m.phase, PHASE.UNITE);
    assert.equal(m.gameSpeed, 8);
    send('p_2', 'propose', 1); send('p_3', 'agree');
    assert.equal(m.gameSpeed, 2);
  } finally { m.dispose(); }
});
