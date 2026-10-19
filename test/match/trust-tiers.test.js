import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { resolveTrust, trustHash } from '../../shared/trust.js';
import { trustResultHash } from '../../server/match/match/trust.js';
import { compactResult, createBattleFromSpec, fitResult, resultDigest } from '../../server/sim/spec.js';
import { runHeadless, validateClientResult } from '../../server/match/fields.js';
import { Match } from '../../server/match/Match.js';
import { runMatch, matchScenarios, loadGolden, storedDigests } from '../../tools/golden.mjs';
import { makeMatch, give, chessOfTier } from './harness.js';

function environment(t, trust, verify) {
  const previous = { SP_TRUST: process.env.SP_TRUST, SP_VERIFY: process.env.SP_VERIFY };
  for (const [key, value] of Object.entries({ SP_TRUST: trust, SP_VERIFY: verify })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

function combat(t, options = {}) {
  const h = makeMatch({ humans: 2, bots: 0, seed: 345, clientCombat: true, clients: false, trust: 'L1', ...options });
  t.after(() => h.m.dispose());
  h.start();
  assert.ok(h.drive(() => h.m.phase === PHASE.COMBAT));
  return h;
}
function resultFor(h, f) {
  const run = runHeadless(createBattleFromSpec(f.spec, h.m.ds, { quiet: true, recordEvents: false }), { players: f.players });
  const result = compactResult(run.result);
  const v = validateClientResult(f.spec, result, { gd: h.m.gd });
  assert.ok(v.ok, v.reason);
  return result;
}
function reply(h, f, digest, fields = {}) {
  const task = f.trustTask;
  h.m.handle(task.executor, { t: 'b.verifyResult', taskId: task.id, specHash: task.specHash, digest, ...fields });
}
const report = (h, f, result) => h.m.handle(f.authority, { t: 'b.result', battleId: f.battleId, result });
function forge(result, pid) {
  const out = structuredClone(result);
  out.killed = out.total;
  Object.assign(out.perPlayer[pid], { leaked: [], perfect: true, killed: out.perPlayer[pid].total });
  return out;
}

test('trust setting preserves default/legacy verification and accepts only L0-L2', () => {
  assert.deepEqual(resolveTrust(), { level: 'L0', explicit: false, verify: 'off' });
  assert.equal(resolveTrust(undefined, 'all').verify, 'all');
  assert.equal(resolveTrust(undefined, 'sample').verify, 'sample');
  assert.equal(resolveTrust('L0', 'all').verify, 'off');
  assert.equal(resolveTrust(' l2 ', 'all').verify, 'sample');
  assert.equal(resolveTrust('L9').level, 'L0');
  assert.equal(resolveTrust('L9', 'all').verify, 'all');
  assert.equal(resolveTrust('typo', 'sample').verify, 'sample');
  assert.equal(trustHash({ a: 1, b: 2 }), trustHash({ b: 2, a: 1 }));
});

test('default L0 adds no peer tasks and preserves normal client authority', (t) => {
  const h = combat(t, { trust: undefined });
  assert.equal(h.m.trustLevel, 'L0');
  assert.equal(h.sent.some(([, m]) => m.t === 'b.verify'), false);
  assert.ok(h.m.fields.every((f) => f.mode === 'client'));
});

test('peer replay counters equal the exact BattleSpec inputs available through teammate watching', (t) => {
  for (const trust of [undefined, 'L1']) {
    const h = makeMatch({ humans: 3, seed: 345, clientCombat: true, clients: false, trust });
    t.after(() => h.m.dispose());
    h.start().toPrep();
    const owner = h.ps('p_0');
    give(h.m, owner, chessOfTier(1)[0]);
    owner.funds = 73;
    Object.assign(owner.round, { refreshes: 2, buys: 3, sells: 4, spent: 5, gainedChess: 6, arts: 7 });
    const counters = {
      handUnits: owner.hand.filter(Boolean).length,
      handChess: owner.hand.filter((p) => p?.kind === 'chess').length,
      roundStats: { refreshes: 2, buys: 3, sells: 4, spent: 5, gainedChess: 6, arts: 7 },
    };
    assert.ok(h.drive(() => h.m.phase === PHASE.COMBAT));
    const f = h.m.fields.find((field) => field.authority === owner.playerId);
    const input = f.spec.players.find((p) => p.playerId === owner.playerId).contentInfo;
    assert.deepEqual({ handUnits: input.handUnits, handChess: input.handChess, roundStats: input.roundStats }, counters);
    assert.equal(Object.hasOwn(input, 'funds'), trust === undefined);
    if (trust) {
      const task = h.allTo(f.trustTask.executor, 'b.verify').find((msg) => msg.taskId === f.battleId);
      assert.deepEqual(task.spec.players, f.spec.players);
    } else assert.equal(h.sent.some(([, msg]) => msg.t === 'b.verify'), false);

    const watcher = h.ps(f.trustTask?.executor || 'p_1');
    assert.equal(h.m.handle(watcher.playerId, { t: 'g.watch', fieldId: f.fieldId }).error, 'WRONG_PHASE');
    const own = h.m.fields.find((field) => field.authority === watcher.playerId);
    report(h, own, resultFor(h, own));
    assert.deepEqual(h.m.handle(watcher.playerId, { t: 'g.watch', fieldId: f.fieldId }), { ok: true });
    const watched = h.lastTo(watcher.playerId, 'b.start');
    assert.equal(watched.watch, true);
    assert.deepEqual(watched.spec.players, f.spec.players);
    assert.deepEqual(watched.spec.players[0].contentInfo, input);
  }
});

test('explicit verify pins suppress ambient trust, while an explicit trust option remains intentional', (t) => {
  environment(t, 'L2', 'all');
  const h = makeMatch({ humans: 2, clientCombat: true, clients: false });
  t.after(() => h.m.dispose());
  assert.equal(h.m.opts.trust, undefined);
  assert.equal(h.m.opts.verify, 'off');
  assert.equal(h.m.trustExplicit, false);
  assert.equal(h.m.trustLevel, 'L0');
  assert.equal(h.m.verifyMode, 'off');
  h.start();
  assert.ok(h.drive(() => h.m.phase === PHASE.COMBAT));
  assert.ok(h.m.fields.every((f) => f.mode === 'client' && !f.trustTask));
  for (const verify of ['off', 'sample', 'all']) {
    const m = new Match({ ...h.m.opts, trust: undefined, verify });
    assert.equal(m.trustLevel, 'L0');
    assert.equal(m.trustExplicit, false);
    assert.equal(m.verifyMode, verify);
    m.dispose();
  }
  const intentional = new Match({ ...h.m.opts, trust: 'L1', verify: 'all' });
  assert.equal(intentional.trustLevel, 'L1');
  assert.equal(intentional.verifyMode, 'all');
  intentional.dispose();
});

test('legacy SP_VERIFY=sample differences remain diagnostic with SP_TRUST unset', (t) => {
  environment(t, undefined, 'sample');
  const h = combat(t, { trust: 'L0' });
  const source = h.m.fields[0], honest = resultFor(h, source), confirmed = [];
  const m = new Match({ ...h.m.opts, trust: undefined, verify: undefined, onTrustDispute: (id) => confirmed.push(id) });
  t.after(() => m.dispose());
  assert.equal(m.trustExplicit, false);
  const f = { ...source, trustLevel: m.trustLevel, verifyMode: m.verifyMode, trustTask: null };
  let n = 0;
  do { f.battleId = `legacy.${++n}`; } while ([...f.battleId].reduce((v, c) => (v * 31 + c.charCodeAt(0)) >>> 0, 0) % 8);
  const forged = forge(honest, source.authority);
  const validated = validateClientResult(f.spec, forged, { gd: m.gd });
  assert.ok(validated.ok);
  let accepted = 0;
  m._verifyResult(f, validated.result, () => accepted++, null, forged);
  assert.equal(accepted, 1, 'legacy diagnostic replay accepts immediately');
  h.sched.advance(0);
  assert.equal(m.verifyStats.checked, 1);
  assert.equal(m.verifyStats.mismatches, 1);
  assert.equal(m.trustLevel, 'L0');
  assert.equal(m.verifyMode, 'sample');
  assert.equal(m.trustStats.confirmed, 0);
  assert.deepEqual(confirmed, []);
});

test('the actual golden match runner pins L0 and reproduces its stored digest under ambient L2', { timeout: 60000 }, (t) => {
  environment(t, 'L2', 'all');
  const policies = [], start = Match.prototype.start;
  t.mock.method(Match.prototype, 'start', function () {
    policies.push({ level: this.trustLevel, verify: this.verifyMode });
    return start.call(this);
  });
  const scenario = matchScenarios().find((sc) => sc.id === 'solo-FUNNY-1');
  assert.ok(scenario);
  const digest = runMatch(scenario);
  assert.deepEqual(policies, [{ level: 'L0', verify: 'off' }]);
  assert.deepEqual(digest, storedDigests(loadGolden('matches'))[scenario.id]);
});

test('wire budget trimming does not turn an honest large result into a trust difference', () => {
  const battleId = 'long-field-identifier-for-result-budget';
  const result = compactResult({ reason: 'cleared', time: 10, total: 4, killed: 4,
    perPlayer: Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`p_${i}`, {
      total: 1, killed: 1, perfect: true,
      unitStats: Array.from({ length: 160 }, (_, uid) => ({ uid: uid + 1, defId: 'a'.repeat(64),
        dmg: 10000, kills: 1, heal: 1000, taken: 1000, attacks: 100 })),
    }])) });
  const reported = fitResult(result, { battleId });
  assert.equal(reported.perPlayer.p_0.unitStats.length, 0);
  assert.notEqual(trustHash(result), trustHash(reported));
  assert.equal(trustResultHash(result, battleId), trustResultHash(reported, battleId));
  const forged = structuredClone(reported);
  forged.perPlayer.p_0.coins = 1;
  assert.notEqual(trustResultHash(result, battleId), trustResultHash(forged, battleId));
});

test('L1 matches peers without self-verification and agrees without an extra server simulation', (t) => {
  const h = combat(t, { humans: 4 });
  const tasks = h.m.fields.map((f) => f.trustTask);
  assert.equal(tasks.filter(Boolean).length, 4);
  assert.equal(new Set(tasks.map((x) => x.executor)).size, 4);
  const f = h.m.fields[0], result = resultFor(h, f);
  assert.notEqual(f.trustTask.executor, f.authority);
  assert.ok(f.spec.players.every((p) => !Object.hasOwn(p.contentInfo || {}, 'funds')));
  reply(h, f, trustResultHash(result));
  report(h, f, result);
  assert.equal(f.done, true);
  assert.equal(h.m.trustStats.agreements, 1);
  assert.equal(h.m.verifyStats.checked, 0);
});

test('timely peer disagreement is sliced, server wins, and only the confirmed wrong authority is recorded', (t) => {
  const confirmed = [];
  const h = combat(t, { headlessSliceMs: 0.000001, onTrustDispute: (id) => confirmed.push(id) });
  const f = h.m.fields[0], authority = f.authority, result = resultFor(h, f);
  reply(h, f, trustResultHash(result));
  report(h, f, forge(result, authority));
  assert.equal(f.done, false);
  assert.ok(f.verifyJob);
  assert.deepEqual(confirmed, []);
  assert.ok(h.run(() => f.done));
  assert.equal(resultDigest(f.result).hash, resultDigest(result).hash);
  assert.deepEqual(confirmed, [authority]);
  assert.equal(h.m.trustStats.confirmed, 1);
});

test('a malicious peer cannot replace an honest result or blame the authority', (t) => {
  const confirmed = [];
  const h = combat(t, { onTrustDispute: (id) => confirmed.push(id) });
  const f = h.m.fields[0], peer = f.trustTask.executor, result = resultFor(h, f);
  reply(h, f, 'f'.repeat(64));
  report(h, f, result);
  assert.equal(f.done, true);
  assert.equal(resultDigest(f.result).hash, resultDigest(result).hash);
  assert.deepEqual(confirmed, [peer]);
  assert.equal(h.m.verifyStats.mismatches, 0);
});

test('explicit trust raises future fields to L2 while active fields and a pinned all replay mode stay fixed', (t) => {
  const measured = {};
  for (const legacyAll of [false, true]) {
    const h = combat(t, legacyAll ? { trust: 'L0', verify: 'all' } : {});
    const m = h.m, [f, active] = m.fields;
    const initial = f.trustLevel, honest = resultFor(h, f);
    if (!legacyAll) reply(h, f, trustResultHash(honest, f.battleId));
    report(h, f, forge(honest, f.authority));
    assert.equal(f.done, true);
    assert.equal(m.trustStats.confirmed, 1);
    assert.equal(m.trustLevel, 'L2');
    assert.equal(m.verifyMode, legacyAll ? 'all' : 'sample');
    assert.equal(active.trustLevel, initial);
    assert.equal(active.verifyMode, legacyAll ? 'all' : 'off');
    // This active field is selected by the L2 sampler, but its original policy still governs receipt.
    let n = 0;
    do { active.battleId = `active.${++n}`; } while ([...active.battleId].reduce((v, c) => (v * 31 + c.charCodeAt(0)) >>> 0, 0) % 8);
    report(h, active, resultFor(h, active));
    h.sched.advance(0);
    assert.equal(m.verifyStats.checked, legacyAll ? 2 : 1);
    const future = m._ccField({ fieldId: 'future', kind: 'normal', players: f.players, opts: f.spec });
    m._launch([future]);
    assert.equal(future.trustLevel, 'L2');
    assert.equal(future.verifyMode, legacyAll ? 'all' : 'sample');
    assert.ok(future.trustTask);
    assert.equal(m._authorityFor({ ...future, kind: 'boss' }), null);
    measured[legacyAll ? 'legacyAll' : 'peerDispute'] = {
      initial, active: active.trustLevel, future: future.trustLevel, verify: future.verifyMode,
    };
  }
  t.diagnostic(`TRUST_FIELD_MEASUREMENT ${JSON.stringify(measured)}`);
});

test('peer digest covers leak LP costs omitted by the legacy summary', (t) => {
  const confirmed = [];
  const h = combat(t, { onTrustDispute: (id) => confirmed.push(id) });
  const f = h.m.fields[0], authority = f.authority, result = resultFor(h, f), forged = structuredClone(result);
  assert.ok(result.perPlayer[authority].leaked.length > 0);
  for (const leak of forged.perPlayer[authority].leaked) leak.lpr = 0;
  assert.equal(resultDigest(forged).hash, resultDigest(result).hash);
  assert.notEqual(trustResultHash(forged), trustResultHash(result));
  reply(h, f, trustResultHash(result));
  report(h, f, forged);
  assert.equal(f.done, true);
  assert.deepEqual(confirmed, [authority]);
  assert.ok(f.result.perPlayer[authority].leaked.some((l) => l.lpr > 0));
});

test('the first peer reply is immutable, and a server simulation error never confirms blame', (t) => {
  const confirmed = [];
  const h = combat(t, { onTrustDispute: (id) => confirmed.push(id) });
  const f = h.m.fields[0], result = resultFor(h, f);
  reply(h, f, trustResultHash(result));
  reply(h, f, 'f'.repeat(64));
  report(h, f, result);
  assert.equal(h.m.trustStats.agreements, 1);
  assert.equal(h.m.verifyStats.checked, 0);
  const other = h.m.fields.find((field) => field !== f), otherResult = resultFor(h, other);
  reply(h, other, 'f'.repeat(64));
  const create = h.m._specBattle.bind(h.m);
  h.m._specBattle = (spec) => {
    const battle = create(spec), output = battle.result.bind(battle);
    battle.result = () => ({ ...output(), errors: 1 });
    return battle;
  };
  report(h, other, otherResult);
  assert.equal(h.m.verifyStats.checked, 1);
  assert.equal(h.m.trustStats.confirmed, 0);
  assert.equal(h.m.trustLevel, 'L1', 'an unsuccessful server replay cannot elevate future fields');
  assert.deepEqual(confirmed, []);
});

for (const reason of ['absent', 'error', 'wrong-input', 'wrong-sender', 'disconnect']) {
  test(`L1 ${reason} peer falls back immediately, and late reports are inert`, (t) => {
    const h = combat(t);
    const f = h.m.fields[0], task = f.trustTask, result = resultFor(h, f);
    if (reason === 'error') reply(h, f, undefined, { error: true });
    if (reason === 'wrong-input') reply(h, f, trustResultHash(result), { specHash: '0'.repeat(64) });
    if (reason === 'wrong-sender') h.m.handle(f.authority, { t: 'b.verifyResult', taskId: task.id, specHash: task.specHash, digest: 'f'.repeat(64) });
    if (reason === 'disconnect') h.m.onDisconnect(task.executor);
    report(h, f, result);
    assert.equal(f.done, true);
    assert.equal(h.m.verifyStats.checked, 0);
    h.m.handle(task.executor, { t: 'b.verifyResult', taskId: task.id, specHash: task.specHash, digest: 'f'.repeat(64) });
    assert.equal(h.m.verifyStats.checked, 0);
    assert.equal(h.m.trustStats.confirmed, 0);
  });
}

test('completed peer reply survives disconnect; a takeover cancels outstanding peer work', (t) => {
  const h = combat(t);
  const f = h.m.fields[0], peer = f.trustTask.executor, result = resultFor(h, f);
  reply(h, f, trustResultHash(result));
  h.m.onDisconnect(peer);
  report(h, f, result);
  assert.equal(h.m.trustStats.agreements, 1);
  const other = h.m.fields.find((x) => x !== f);
  assert.equal(other.trustTask, null);
  assert.ok(h.sent.some(([, m]) => m.t === 'b.verifyCancel'));
});

test('solo and plugin-content L1 use L0 fallback; explicit trust keeps boss/hidden on coupled server path', (t) => {
  for (const options of [{ humans: 1 }, { requireCs: true, cs: 'a'.repeat(64) }]) {
    const h = combat(t, options);
    assert.ok(h.m.fields.every((f) => !f.trustTask));
  }
  for (const trust of ['L0', 'L1', 'L2']) {
    const h = combat(t, { trust });
    for (const kind of ['boss', 'hidden']) {
      assert.equal(h.m._authorityFor({ kind, players: ['p_0'], spec: { players: [], spawns: [] } }), trust === 'L0' ? 'p_0' : null);
    }
  }
});

test('actual boss and hidden launch retain L0 clients and use one shared server pool at L1/L2', (t) => {
  for (const trust of ['L0', 'L1', 'L2']) for (const hidden of [false, true]) {
    const h = makeMatch({ humans: 4, clientCombat: true, clients: false, instant: false, trust });
    t.after(() => h.m.dispose());
    h.start();
    const m = h.m;
    m.setDeadline(0);
    m.round = hidden ? m.gd.hiddenRound : m.gd.bossRound;
    for (const ps of m.order) ps.lp = 40;
    if (hidden) m.teamLp = 160;
    m.startFinalAssault(hidden);
    assert.equal(m.fields.length, 2);
    assert.ok(m.fields.every((f) => f.mode === (trust === 'L0' ? 'client' : 'server')));
    assert.ok(m.fields.every((f) => !f.trustTask), 'coupled fields are never peer replayed');
    if (trust !== 'L0') {
      assert.ok(m.runner, 'existing group runner owns the coupled fields');
      assert.ok(m.fields.every((f) => f.credit.pool === m.bossPool));
    }
    assert.equal(m.errorCount, 0);
  }
});

test('L2 audit confirms colluding results after acceptance without rollback', (t) => {
  const confirmed = [];
  const h = combat(t, { trust: 'L2', onTrustDispute: (id) => confirmed.push(id) });
  const f = h.m.fields[0], authority = f.authority, peer = f.trustTask.executor, honest = resultFor(h, f), forged = forge(honest, authority);
  let n = 0;
  do { f.battleId = `audit.${++n}`; } while ([...f.battleId].reduce((v, c) => (v * 31 + c.charCodeAt(0)) >>> 0, 0) % 8);
  reply(h, f, trustResultHash(forged));
  report(h, f, forged);
  assert.equal(f.done, true);
  assert.equal(f.result.perPlayer[authority].perfect, true);
  assert.ok(h.run(() => h.m.verifyStats.checked === 1));
  assert.equal(h.m.verifyStats.mismatches, 1);
  assert.deepEqual(confirmed, [authority, peer]);
  assert.equal(f.result.perPlayer[authority].perfect, true, 'a diagnostic audit never rolls back settlement');
});
