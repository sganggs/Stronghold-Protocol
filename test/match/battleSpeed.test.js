import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';

function fixture(options = {}) {
  const h = makeMatch({ humans: 2, clients: false, clientCombat: true, instant: false,
    rules: { battleSpeedControl: 'unanimous' }, ...options });
  h.m.start(); h.toPrep(1); h.m.cancel(h.m._phaseTimer); h.m.startCombat();
  return h;
}
function request(m, pid, action, target) {
  return m.handle(pid, { t: 'g.battleSpeed', phaseId: m.speedControl?.phaseId || 'absent',
    revision: m.speedControl?.revision || 0, action, ...(target ? { target } : {}),
    ...(m.speedControl?.vote ? { voteId: m.speedControl.vote.id } : {}) });
}
function pass(m, target) {
  const voters = m._speedVoters();
  assert.ok(!request(m, voters[0].playerId, 'propose', target).error);
  for (const p of voters.slice(1)) assert.ok(!request(m, p.playerId, 'agree').error);
}

test('speed: unanimous changes including downshift; unique proposal, revision and vote identity', () => {
  const h = fixture(); const m = h.m;
  try {
    const msg = { t: 'g.battleSpeed', phaseId: m.speedControl.phaseId, revision: 0, action: 'propose', target: 4 };
    assert.equal(validateC2S(msg), null);
    assert.ok(validateC2S({ ...msg, target: 8 }));
    m.handle('p_0', msg);
    assert.equal(m.gameSpeed, 2);
    assert.ok(request(m, 'p_1', 'propose', 2).error);
    assert.ok(m.handle('p_1', { ...msg, action: 'agree', voteId: 'stale' }).error);
    request(m, 'p_1', 'agree');
    assert.equal(m.gameSpeed, 8);
    assert.ok(m.handle('p_0', msg).error);
    request(m, 'p_0', 'propose', 1);
    assert.equal(m.gameSpeed, 8);
    request(m, 'p_1', 'agree');
    assert.equal(m.gameSpeed, 2);
    assert.equal(m.speedControl.revision, 2);
  } finally { m.dispose(); }
});

for (const action of ['reject', 'withdraw', 'cancel']) test(`speed: ${action} cancels without changing current speed`, () => {
  const h = fixture(); const m = h.m;
  try {
    pass(m, 2); request(m, 'p_0', 'propose', 4);
    request(m, action === 'reject' ? 'p_1' : 'p_0', action);
    assert.equal(m.speedControl.vote, null); assert.equal(m.gameSpeed, 4);
  } finally { m.dispose(); }
});

test('speed: vote expires after 15 wall seconds', () => {
  const h = fixture(); const m = h.m;
  try {
    request(m, 'p_0', 'propose', 4);
    h.sched.advance(14999); assert.ok(m.speedControl.vote);
    h.sched.advance(1); assert.equal(m.speedControl.vote, null);
    assert.equal(m.speedControl.outcome, 'expired'); assert.equal(m.gameSpeed, 2);
  } finally { m.dispose(); }
});

test('speed: disconnect and membership changes cancel, never silently lower active speed', () => {
  const h = fixture(); const m = h.m;
  try {
    pass(m, 2); request(m, 'p_0', 'propose', 1);
    m.onDisconnect('p_1');
    assert.equal(m.speedControl.vote, null); assert.equal(m.gameSpeed, 4);
    assert.ok(request(m, 'p_0', 'propose', 1).error);
    m.onReconnect('p_1'); request(m, 'p_0', 'propose', 1);
    m.players.get('p_1').alive = false; m.flush();
    assert.equal(m.speedControl.vote, null); assert.equal(m.gameSpeed, 4);
    pass(m, 1); assert.equal(m.gameSpeed, 2);
  } finally { m.dispose(); }
});

test('speed: client field clock and deadline rebase continuously', () => {
  const h = fixture(); const m = h.m;
  try {
    h.sched.advance(1000);
    const f = m.fields[0];
    const before = m._fieldElapsed(f), remaining = m.deadline - h.sched.now();
    pass(m, 4);
    assert.ok(Math.abs(m._fieldElapsed(f) - before) < 0.00001);
    assert.equal(m.deadline - h.sched.now(), remaining / 4);
    h.sched.advance(500); assert.ok(Math.abs(m._fieldElapsed(f) - before - 4) < 0.00001);
    const gt = m._fieldElapsed(f); pass(m, 1);
    assert.ok(Math.abs(m._fieldElapsed(f) - gt) < 0.00001);
    assert.equal(m._startMsg(f, 'p_0').speed, 2);
    assert.equal(m._startMsg(f, 'p_0').speedRevision, 2);
    const msg = h.bc.filter(x => x.t === 'b.speed');
    assert.equal(msg.length, 4);
    assert.ok(msg.every(x => x.elapsed >= before));
  } finally { m.dispose(); }
});

test('speed: single human can change during pause; resume uses new rate without advancing paused ticks', () => {
  const h = fixture({ mode: 'solo', humans: 1 }); const m = h.m;
  try {
    h.sched.advance(1000); m.setPause(m.order[0], true);
    const f = m.fields[0], gt = m._fieldElapsed(f);
    h.sched.advance(1000); pass(m, 4);
    h.sched.advance(1000); assert.equal(m._fieldElapsed(f), gt);
    m.setPause(m.order[0], false); h.sched.advance(500);
    assert.equal(m._fieldElapsed(f), gt + 4);
  } finally { m.dispose(); }
});

test('speed: Unite voters are helpers only; locked fast settlement cancels vote and preserves rate', () => {
  const h = fixture({ humans: 3 }); const m = h.m;
  try {
    m._stopClientCombat(); m.phase = PHASE.UNITE;
    m.unitePlan = { helpers: [m.order[1], m.order[2]] };
    m._initBattleSpeed();
    assert.ok(request(m, 'p_0', 'propose', 4).error);
    pass(m, 2); request(m, 'p_1', 'propose', 4);
    m.uniteFast = { status: 'running' }; m.flush();
    assert.equal(m.speedControl.vote, null); assert.equal(m.gameSpeed, 4);
    assert.ok(request(m, 'p_2', 'propose', 1).error);
    m.uniteFast.status = 'waiting'; pass(m, 1);
    assert.equal(m.gameSpeed, 2);
  } finally { m.dispose(); }
});

test('speed: disabled rule, observers and other phases cannot control speed; phase reset cancels vote', () => {
  const h = fixture(); const m = h.m;
  try {
    assert.ok(request(m, 'outsider', 'propose', 4).error);
    pass(m, 4); request(m, 'p_0', 'propose', 1);
    const old = m.speedControl.phaseId;
    m.phase = PHASE.SETTLE; m.flush();
    assert.equal(m.speedControl, null); assert.equal(m.gameSpeed, 2);
    m.phase = PHASE.COMBAT; m._initBattleSpeed();
    assert.notEqual(m.speedControl.phaseId, old); assert.equal(m.speedControl.vote, null);
    m._leaveBattleSpeed(); m.rules = {}; m._initBattleSpeed();
    assert.equal(m.speedControl, null); assert.ok(request(m, 'p_0', 'propose', 4).error);
  } finally { m.dispose(); }
});

for (const rate of [1, 2, 4]) test(`speed: real paced simulation has identical settlement at multiplier ${rate}`, () => {
  const a = fixture({ clientCombat: false }), b = fixture({ clientCombat: false });
  try {
    if (rate !== 1) pass(b.m, rate);
    a.sched.runUntil(() => !a.m.fields.some(f => f.live), { maxMs: 120000 });
    b.sched.runUntil(() => !b.m.fields.some(f => f.live), { maxMs: 120000 });
    assert.deepEqual([...b.m.lastResults], [...a.m.lastResults]);
    assert.equal(b.m.errorCount, 0); assert.deepEqual(b.sched.errors, []);
  } finally { a.m.dispose(); b.m.dispose(); }
});

test('speed: changing rate after the simulation limit never rescales network grace', () => {
  const h = fixture(); const m = h.m;
  try {
    const f = m.fields[0];
    // Advance the field origin to the grace interval without triggering its timeout.
    f.startAt = h.sched.now() - (f.spec.timeLimit + 1) / m.gameSpeed * 1000;
    m._armDeadline(f);
    const at = f.resultDeadlineAt;
    pass(m, 4);
    assert.equal(f.resultDeadlineAt, at);
    pass(m, 1);
    assert.equal(f.resultDeadlineAt, at);
  } finally { m.dispose(); }
});

test('speed: finished battle owners still vote in normal combat; bots never vote', () => {
  const h = fixture({ bots: 1 }); const m = h.m;
  try {
    m.fields[0].live = false; m.fields[0].done = true;
    request(m, 'p_0', 'propose', 4);
    assert.deepEqual(m.speedControl.vote.eligible, ['p_0', 'p_1']);
    assert.equal(m.gameSpeed, 2);
    request(m, 'p_1', 'agree'); assert.equal(m.gameSpeed, 8);
  } finally { m.dispose(); }
});
