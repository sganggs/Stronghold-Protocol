// The browser battle runner (public/js/battle/runner.js) under Node with a fake socket, a manual clock and manual
// animation frames: pacing (60 ticks per real second at 2×, ≤ 8 per frame), the b.snap / b.ev feed and the field meta,
// b.progress / b.result when authoritative (valid protocol frames, the same result as the server's simulation),
// fast-forward to `elapsed`, b.end (forced / takeover), the hidden-tab pump, the boss pool sync, phase clearing, the live
// leak count of normal fields (state().leaks, user playtest #3 item 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBattleRunner, ticksPerFrameCap } from '../../public/js/battle/runner.js';
import { buildDiagnostics } from '../../public/js/diag.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as specMod from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { validateC2S } from '../../shared/protocol.js';
import { validateClientResult, runHeadless } from '../../server/match/fields.js';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch } from './harness.js';

const DS = new DataSource(DATA, null);

function fakeNet() {
  const handlers = new Map();
  const n = {
    sent: [],
    on(t, fn) { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t).add(fn); return () => handlers.get(t).delete(fn); },
    emit(t, msg) { for (const fn of handlers.get(t) || []) fn({ t, ...msg }); },
    send(t, fields) { const msg = { ...fields, t }; assert.equal(validateC2S(msg), null, `invalid ${t}`); n.sent.push(msg); return true; },
    request(t, fields) { const msg = { ...fields, t, rid: 1 }; assert.equal(validateC2S(msg), null, `invalid ${t}`); n.sent.push(msg); return Promise.resolve({ t: 'ok' }); },
  };
  return n;
}

function rig({ hidden = false, combatMetrics = true, pinMetrics = true, createHost = null } = {}) {
  let t = 1000;
  const frames = [];
  const intervals = [];
  const doc = { hidden, addEventListener() {} };
  const net = fakeNet();
  const store = createStore(initialState);
  // Existing cases pin the meter on, which is what the PR asserted. pinMetrics false leaves the production default
  // (off) so a test can drive setCombatMetrics. createHost stands in for a Worker sim.
  const deps = {
    net, store, doc,
    now: () => t,
    raf: (fn) => { frames.push(fn); return frames.length; },
    caf: () => {},
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: () => {},
    loadSim: async () => ({ spec: specMod, ds: DS }),
    logger: { error() {}, warn() {}, info() {}, debug() {} },
  };
  if (pinMetrics) deps.combatMetrics = combatMetrics;
  if (createHost) deps.createHost = createHost;
  const runner = createBattleRunner(deps);
  const feed = { snaps: [], evs: [], fields: [] };
  runner.on('snap', (s) => feed.snaps.push(s));
  runner.on('ev', (e) => feed.evs.push(e));
  runner.on('field', (f) => feed.fields.push(f));
  const r = {
    runner, net, store, doc, feed,
    get t() { return t; },
    /** advance the clock by `ms` in animation frames of `step` ms (or pump intervals when hidden) */
    advance(ms, step = 1000 / 60) {
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + step);
        if (doc.hidden) { for (const fn of intervals) fn(); continue; }
        const q = frames.splice(0);
        for (const fn of q) fn(t);
      }
    },
    async settle() { for (let i = 0; i < 50; i++) { await new Promise((res) => setImmediate(res)); const q = frames.splice(0); for (const fn of q) fn(t); } },
  };
  return r;
}

/** A real b.start of round 2 (a board with operators) from a client-combat match. */
function realStart(seed = 7301) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans();
  h.m.start();
  h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 1);
  // round 1: the bot fights, the human (no client here) is taken over at the deadline; round 2 has a real board
  h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 2, { maxSteps: 3e6 });
  const msg = h.lastTo('p_0', 'b.start');
  h.m.dispose();
  return msg;
}

test('authoritative battle: 2× pacing, ≤ max(8, 4·speed) ticks per frame, b.snap / b.ev feed, field meta in the store, progress ~1 Hz, the server-identical result', async () => {
  const start = realStart();
  assert.ok(start && start.authoritative);
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  assert.equal(r.feed.fields.length, 1);
  const field = r.store.get().match.field;
  assert.equal(field.fieldId, start.fieldId);
  assert.equal(field.local, true);
  assert.equal(field.battleId, start.battleId);
  assert.ok(Array.isArray(field.units), 'unit infos (none deployed before the first tick)');
  assert.deepEqual(r.store.get().match.battle && [r.store.get().match.battle.authoritative, r.store.get().match.battle.own], [true, true]);
  const e = r.runner._entries.get(start.battleId);
  r.advance(1000);
  assert.ok(Math.abs(e.battle.tickCount - 60) <= 2, `60 ticks per real second at 2× (${e.battle.tickCount})`);
  assert.ok(r.feed.snaps.length >= 55, 'a snapshot per frame');
  const snap = r.feed.snaps[r.feed.snaps.length - 1];
  assert.equal(snap.t, 'b.snap');
  assert.equal(snap.fieldId, start.fieldId);
  assert.equal(typeof snap.gt, 'number');
  assert.ok(r.feed.evs.every((x) => x.t === 'b.ev' && Array.isArray(x.ev) && typeof x.gt === 'number'));
  const spawnedOf = () => r.feed.evs.flatMap((x) => x.ev).filter((x) => x[0] === 'spawn').map((x) => x[1]);
  assert.ok(spawnedOf().some((u) => u.side === 'ally' && /^chess_/.test(u.defId)), 'the board arrives as spawn events at the first tick');
  // a slow frame never steps more than the cap
  const before = e.battle.tickCount;
  r.advance(100, 100);
  assert.ok(e.battle.tickCount - before <= ticksPerFrameCap(2), 'cap per frame');
  // run to the end
  for (let i = 0; i < 400 && !e.done; i++) r.advance(1000, 50);
  assert.ok(e.done, 'finished');
  assert.ok(spawnedOf().some((u) => u.side === 'enemy'), 'the enemies arrive as spawn events');
  await r.settle();
  const prog = r.net.sent.filter((x) => x.t === 'b.progress');
  const secs = e.battle.time / 2;
  assert.ok(prog.length >= secs * 0.8 && prog.length <= secs + 3, `~1 progress per real second (${prog.length} over ${secs.toFixed(1)} s)`);
  assert.equal(prog[prog.length - 1].done, true);
  const res = r.net.sent.filter((x) => x.t === 'b.result');
  assert.equal(res.length, 1);
  const server = runHeadless(specMod.createBattleFromSpec(start.spec, DS, { recordEvents: false }), { players: start.spec.players.map((p) => p.playerId) }).result;
  const a = validateClientResult(start.spec, res[0].result, {});
  const b = validateClientResult(start.spec, specMod.compactResult(server), {});
  assert.ok(a.ok && b.ok);
  assert.equal(specMod.resultDigest(a.result).hash, specMod.resultDigest(b.result).hash, 'the browser result equals the server simulation');
  const metrics = r.runner.combatMetrics();
  const hpDamage = e.battle.allyUnits.reduce((n, u) => n + u.stats.dmg, 0);
  assert.ok(Math.abs(metrics.damage - hpDamage) < 1e-6, 'local accounting matches unrounded simulation totals');
  const finalMetrics = structuredClone(metrics);
  await r.runner.onStart(start);
  assert.deepEqual(r.runner.combatMetrics(), finalMetrics, 'resending a finished battle does not count it twice');
  r.store.patch('match', { public: { phase: PHASE.PREP, round: 3 } });
  assert.deepEqual(r.runner.combatMetrics(), finalMetrics, 'match totals survive next-round prep');
  assert.equal(r.runner.combatMetrics({ scope: 'battle' }).rows.length, 0, 'current battle clears at prep');
  r.store.patch('match', { public: null });
  assert.equal(r.runner.combatMetrics().rows.length, 0, 'leaving the match clears totals');
  r.runner.dispose();
});

test('fast-forward to `elapsed` before showing; display replicas never report; b.end takeover demotes; hidden tab keeps an authoritative battle going', async () => {
  const start = realStart(7302);
  // observing a running field 20 game s in
  const r = rig();
  r.net.emit('b.start', { ...start, authoritative: false, watch: true, elapsed: 20 });
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  assert.ok(e.battle.time >= 19.8, `caught up to the field clock (${e.battle.time})`);
  assert.ok(Math.abs(r.runner.combatMetrics().damage - e.battle.allyUnits.reduce((n, u) => n + u.stats.dmg, 0)) < 1e-6,
    'initial silent catch-up records all damage');
  assert.equal(r.feed.fields.length, 1, 'shown once, after the catch-up');
  r.advance(3000);
  assert.equal(r.net.sent.length, 0, 'a display replica never reports');
  // the same battleId again (e.g. back from watching): no rebuild
  r.net.emit('b.start', { ...start, authoritative: false, watch: true, elapsed: 30 });
  await r.settle();
  assert.equal(r.runner._entries.get(start.battleId), e);
  r.runner.dispose();

  // authoritative, then the server takes the field over
  const r2 = rig();
  r2.net.emit('b.start', start);
  await r2.settle();
  r2.advance(1500);
  r2.net.emit('b.end', { battleId: start.battleId, fieldId: start.fieldId, reason: 'takeover' });
  const n = r2.net.sent.length;
  for (let i = 0; i < 200; i++) r2.advance(1000, 50);
  assert.equal(r2.net.sent.length, n, 'no more reports after a takeover');
  r2.runner.dispose();

  // hidden tab: the interval pump advances the authoritative battle without rendering
  const r3 = rig({ hidden: true });
  r3.net.emit('b.start', start);
  await r3.settle();
  const e3 = r3.runner._entries.get(start.battleId);
  const snaps = r3.feed.snaps.length;
  r3.advance(2000, 1000);
  assert.ok(e3.battle.tickCount >= 110, `pumped while hidden (${e3.battle.tickCount})`);
  assert.ok(Math.abs(r3.runner.combatMetrics().damage - e3.battle.allyUnits.reduce((n, u) => n + u.stats.dmg, 0)) < 1e-6,
    'hidden-tab damage is recorded before visual events are discarded');
  assert.equal(r3.feed.snaps.length, snaps, 'nothing rendered while hidden');
  r3.runner.dispose();
});

test('b.end forced ends the local battle and reports at once; a new prep clears every battle', async () => {
  const start = realStart(7303);
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  r.advance(2000);
  r.net.emit('b.end', { battleId: start.battleId, fieldId: start.fieldId, reason: 'forced' });
  await r.settle();
  const res = r.net.sent.filter((x) => x.t === 'b.result');
  assert.equal(res.length, 1);
  assert.equal(res[0].result.reason, 'forced');
  r.store.patch('match', { public: { phase: 'SETTLE' } });
  assert.equal(r.runner._entries.size, 1, 'the finished field stays on screen through SETTLE');
  r.store.patch('match', { public: { phase: 'PREP' } });
  assert.equal(r.runner._entries.size, 0);
  assert.equal(r.store.get().match.battle, null);
  r.runner.dispose();
});

test('own battle statistics stay available when viewing a teammate; owner filtering excludes teammate damage', async () => {
  const start = realStart(7311);
  const r = rig();
  await r.runner.onStart(start);
  r.advance(5000, 50);
  const ownerId = start.spec.players[0].playerId;
  const own = r.runner.combatMetrics({ scope: 'battle', ownerId });
  assert.ok(own.rows.length > 0);
  const teammate = structuredClone(start);
  teammate.battleId = 'metrics-teammate';
  teammate.fieldId = 'n:metrics-teammate';
  teammate.authoritative = false;
  teammate.watch = true;
  for (const player of teammate.spec.players) player.playerId = 'metrics-teammate';
  await r.runner.onStart(teammate);
  assert.deepEqual(r.runner.combatMetrics({ scope: 'battle', ownerId }), own, 'own field is selected instead of the watched field');
  assert.ok(r.runner.combatMetrics({ scope: 'battle', ownerId }).rows.every((row) => row.ownerId === ownerId));
  assert.deepEqual(r.runner.combatMetrics({ scope: 'match', ownerId }), own, 'match view remains restricted to self');
  assert.equal(r.runner.combatMetrics({ scope: 'battle', ownerId: 'unavailable-player' }).rows.length, 0);
  r.runner.dispose();
});

test('evicted observed battles keep match totals; replaying one replaces its snapshot without double counting', async () => {
  const start = realStart(7310);
  const r = rig();
  const recorded = new Map();
  for (let i = 0; i < 5; i++) {
    const battleId = `metrics-replica-${i}`;
    await r.runner.onStart({ ...start, battleId, authoritative: false, watch: true });
    r.advance(10000, 50);
    const b = r.runner._entries.get(battleId).battle;
    recorded.set(battleId, b.allyUnits.reduce((n, u) => n + u.stats.dmg, 0));
  }
  assert.ok(!r.runner._entries.has('metrics-replica-0'), 'first replica was evicted');
  const expected = [...recorded.values()].reduce((n, v) => n + v, 0);
  assert.ok(expected > 0);
  assert.ok(Math.abs(r.runner.combatMetrics().damage - expected) < 1e-6);
  await r.runner.onStart({ ...start, battleId: 'metrics-replica-0', authoritative: false, watch: true });
  assert.ok(Math.abs(r.runner.combatMetrics().damage - expected) < 1e-6, 'replay at time zero retains prior totals');
  r.advance(12000, 50);
  const replay = r.runner._entries.get('metrics-replica-0').battle;
  const updated = expected - recorded.get('metrics-replica-0') + replay.allyUnits.reduce((n, u) => n + u.stats.dmg, 0);
  assert.ok(Math.abs(r.runner.combatMetrics().damage - updated) < 1e-6, 'same battle contributes only its newer snapshot');
  r.runner.dispose();
});

test('上一场战斗: the most recent ended battle, never the running one; resets with the match totals', async () => {
  const r = rig();
  await r.runner.onStart(realStart(7312));
  r.advance(6000, 50);
  const first = structuredClone(r.runner.combatMetrics({ scope: 'battle' }));
  assert.ok(first.rows.length > 0);
  r.store.patch('match', { public: { phase: PHASE.PREP, round: 3 } });
  assert.deepEqual(r.runner.combatMetrics({ scope: 'last' }), first, 'the battle a prep just dropped is 上一场');
  const second = realStart(7313);
  second.battleId = 'metrics-last-second';
  second.fieldId = 'n:metrics-last-second';
  await r.runner.onStart(second);
  r.advance(4000, 50);
  const secondLive = structuredClone(r.runner.combatMetrics({ scope: 'battle' }));
  assert.deepEqual(r.runner.combatMetrics({ scope: 'last' }), first, 'a running battle is 当前战斗, not 上一场');
  r.store.patch('match', { public: { phase: PHASE.RESULT, round: 3 } });
  assert.deepEqual(r.runner.combatMetrics({ scope: 'last' }), secondLive, 'the battle RESULT just dropped replaces 上一场');
  r.store.patch('match', { public: { phase: PHASE.PREP, round: 4 } });
  assert.deepEqual(r.runner.combatMetrics({ scope: 'last' }), secondLive, '上一场 survives the next round prep');
  assert.ok(r.runner.combatMetrics({ scope: 'match' }).damage >= r.runner.combatMetrics({ scope: 'last' }).damage);
  r.store.patch('match', { public: null });
  assert.equal(r.runner.combatMetrics({ scope: 'last' }).rows.length, 0, 'leaving the match clears 上一场');
  r.runner.dispose();
});

test('上一场战斗 with ownerId skips a watched battle that never included the player', async () => {
  const start = realStart(7314);
  const r = rig();
  await r.runner.onStart(start);
  r.advance(6000, 50);
  const ownerId = start.spec.players[0].playerId;
  const own = structuredClone(r.runner.combatMetrics({ scope: 'battle', ownerId }));
  assert.ok(own.rows.length > 0);
  r.store.patch('match', { public: { phase: PHASE.PREP, round: 3 } });
  assert.deepEqual(r.runner.combatMetrics({ scope: 'last', ownerId }), own, 'own battle is 上一场 once it ends');
  // A spectated replica of someone else's field: none of its owners is the own player, and it enters the history later
  // than the own battle, so an order-only pick would select it and then filter every row away.
  const watched = structuredClone(start);
  watched.battleId = 'metrics-last-watch';
  watched.fieldId = 'n:metrics-last-watch';
  watched.authoritative = false;
  watched.watch = true;
  for (const player of watched.spec.players) player.playerId = 'metrics-last-watch';
  await r.runner.onStart(watched);
  r.advance(3000, 50);
  r.store.patch('match', { public: { phase: PHASE.PREP, round: 4 } });
  assert.deepEqual(r.runner.combatMetrics({ scope: 'last', ownerId }), own,
    'the watched replica does not replace the own 上一场');
  assert.ok(r.runner.combatMetrics({ scope: 'match', ownerId }).rows.every((row) => row.ownerId === ownerId));
  r.runner.dispose();
});

test('boss field: the local pool follows b.pool (server hp − unacknowledged local damage); progress carries bossDmg / by / leaks at 4 Hz', async () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 7304, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans();
  h.m.start();
  h.run(() => h.ended != null || h.m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 5e6 });
  if (h.m.phase !== PHASE.FINAL_ASSAULT) { h.m.dispose(); return; } // (the seed did not reach the boss round)
  const start = h.lastTo('p_0', 'b.start');
  h.m.dispose();
  assert.equal(start.kind, 'boss');
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  const pool = e.battle.sharedBoss;
  // the pool's cumulative damage at the instant of each report (damage dealt after the last report of the window is
  // reported by the next one)
  const cumAtSend = [];
  const send = r.net.send;
  r.net.send = (t, fields) => { if (t === 'b.progress') cumAtSend.push(pool.cum); return send(t, fields); };
  r.advance(3000);
  const first = r.net.sent.filter((x) => x.t === 'b.progress');
  assert.ok(first.length >= 10 && first.length <= 14, `4 Hz (${first.length} in 3 s)`);
  // how soon the operators reach the leader depends on the board the autoplayed match built
  for (let i = 0; i < 30 && !(pool.cum > 0); i++) r.advance(1000);
  assert.ok(pool.cum > 0, 'local damage to the pool');
  const prog = r.net.sent.filter((x) => x.t === 'b.progress');
  const last = prog[prog.length - 1];
  assert.equal(last.bossDmg, cumAtSend[cumAtSend.length - 1]);
  assert.ok(last.bossDmg <= pool.cum);
  assert.ok(last.by && typeof last.by === 'object');
  assert.equal(typeof last.leaks, 'number');
  // the per-player split of the leak LP (the server holds the result's leaked lists to it, Match._bossLeaksAgree): the
  // leaks of every player of the field, never more than the field's LP cost (leader effects make up the rest)
  assert.ok(last.leaksBy && typeof last.leaksBy === 'object', 'boss progress carries leaksBy');
  assert.deepEqual(Object.keys(last.leaksBy).sort(), start.spec.players.map((p) => p.playerId).sort());
  assert.ok(Object.values(last.leaksBy).every((n) => Number.isFinite(n) && n >= 0));
  assert.ok(Object.values(last.leaksBy).reduce((a, b) => a + b, 0) <= last.leaks + 1e-9);
  r.net.emit('b.pool', { hp: pool.maxHp * 0.5, max: pool.maxHp, teamLp: 20, acked: { [start.fieldId]: pool.cum } });
  assert.ok(Math.abs(pool.hp - pool.maxHp * 0.5) < 1e-6, 'server hp when everything is acknowledged');
  r.runner.dispose();
});

/** A fake net whose b.result requests follow a script: 'ok' | 'lost' (DISCONNECTED) | 'offline' | 'timeout' | 'refused'. */
function scriptResults(r, script) {
  r.net.request = (t, fields) => {
    const msg = { ...fields, t, rid: 1 };
    assert.equal(validateC2S(msg), null, `invalid ${t}`);
    r.net.sent.push(msg);
    const mode = script.shift() || 'ok';
    if (mode === 'ok') return Promise.resolve({ t: 'ok' });
    const code = { lost: 'DISCONNECTED', offline: 'OFFLINE', timeout: 'TIMEOUT', refused: 'WRONG_PHASE' }[mode];
    return Promise.reject(Object.assign(new Error(code), { code }));
  };
}

test('a b.result lost with the socket is sent again when the session resumes and on an authoritative b.start of the finished battle; a refusal is final', async () => {
  const start = realStart(7305);
  const results = (r) => r.net.sent.filter((x) => x.t === 'b.result');
  const warn = console.warn;
  console.warn = () => {};
  try {
    // DISCONNECTED around the end of the battle
    const r = rig();
    scriptResults(r, ['lost']);
    r.net.emit('b.start', start);
    await r.settle();
    r.advance(1500);
    r.net.emit('b.end', { battleId: start.battleId, fieldId: start.fieldId, reason: 'forced' });
    await r.settle();
    const e = r.runner._entries.get(start.battleId);
    assert.equal(results(r).length, 1);
    assert.equal(e.delivery, 'undelivered');
    r.net.emit('status', { status: 'reconnecting' });
    await r.settle();
    assert.equal(results(r).length, 1, 'not while reconnecting');
    r.net.emit('status', { status: 'online' });
    await r.settle();
    assert.equal(results(r).length, 2, 're-sent on resume');
    assert.deepEqual(results(r)[1].result, results(r)[0].result, 'the same result');
    assert.equal(results(r)[1].battleId, start.battleId);
    assert.equal(e.delivery, 'delivered');
    r.net.emit('status', { status: 'online' });
    await r.settle();
    assert.equal(results(r).length, 2, 'a delivered result is not sent again on resume');
    // the server resyncs the finished field as still waiting for its authority's result: sent again
    r.net.emit('b.start', { ...start, authoritative: true, elapsed: 3 });
    await r.settle();
    assert.equal(results(r).length, 3);
    assert.equal(r.runner._entries.get(start.battleId), e, 'no rebuild');
    // a display resend does not
    r.net.emit('b.start', { ...start, authoritative: false, watch: false, elapsed: 3 });
    await r.settle();
    assert.equal(results(r).length, 3);
    r.runner.dispose();

    // two timeouts (retried once) → undelivered; OFFLINE → undelivered; both go out on resume
    const r2 = rig();
    scriptResults(r2, ['timeout', 'timeout']);
    r2.net.emit('b.start', start);
    await r2.settle();
    r2.net.emit('b.end', { battleId: start.battleId, fieldId: start.fieldId, reason: 'forced' });
    await r2.settle();
    assert.equal(results(r2).length, 2, 'one retry on a timeout');
    assert.equal(r2.runner._entries.get(start.battleId).delivery, 'undelivered');
    r2.net.emit('status', { status: 'online' });
    await r2.settle();
    assert.equal(results(r2).length, 3);
    r2.runner.dispose();

    // the server answered with a refusal (stale battle, match over): never sent again
    const r3 = rig();
    scriptResults(r3, ['refused']);
    r3.net.emit('b.start', start);
    await r3.settle();
    r3.net.emit('b.end', { battleId: start.battleId, fieldId: start.fieldId, reason: 'forced' });
    await r3.settle();
    r3.net.emit('status', { status: 'online' });
    await r3.settle();
    assert.equal(results(r3).length, 1);
    r3.runner.dispose();
  } finally {
    console.warn = warn;
  }
});

test('solo pause: m.public.paused freezes every local battle clock (no ticks, no reports); resume continues where it stopped', async () => {
  const start = realStart(7306);
  const r = rig();
  r.store.patch('match', { public: { phase: 'COMBAT', paused: false } });
  r.net.emit('b.start', start);
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  r.advance(1000);
  const t1 = e.battle.tickCount;
  assert.ok(Math.abs(t1 - 60) <= 2, `running (${t1})`);
  r.store.patch('match', { public: { phase: 'COMBAT', paused: true } });
  assert.equal(r.runner.state().paused, true);
  assert.equal(r.store.get().match.battle.paused, true, 'published for the HUD');
  const reports = r.net.sent.length;
  const beforePause = r.runner.combatMetrics();
  r.advance(5000);
  assert.equal(e.battle.tickCount, t1, 'no tick while paused');
  assert.equal(r.net.sent.length, reports, 'no report while paused');
  assert.deepEqual(r.runner.combatMetrics(), beforePause, 'damage, healing and rates all freeze while paused');
  // a resend while paused (reconnect) keeps the clock frozen
  r.net.emit('b.start', { ...start, elapsed: t1 / 30 });
  await r.settle();
  r.advance(1000);
  assert.equal(e.battle.tickCount, t1);
  r.store.patch('match', { public: { phase: 'COMBAT', paused: false } });
  assert.equal(r.runner.state().paused, false);
  r.advance(1000);
  assert.ok(Math.abs(e.battle.tickCount - (t1 + 60)) <= 2, `resumed on the same clock, no catch-up burst (${e.battle.tickCount})`);
  r.runner.dispose();
});

/** realStart() with an empty board: every enemy of the wave walks into the blue gate. */
function leakingStart(seed = 7307) {
  const start = realStart(seed);
  const spec = JSON.parse(JSON.stringify(start.spec));
  for (const p of spec.players) p.units = [];
  return { ...start, spec };
}

test('live leaks (user playtest #3 item 2): state().leaks carries the own field\'s counted leaks as they happen — authoritative or display — published in the frame of each leak; the settle rule\'s count at the end', async () => {
  const start = leakingStart();
  const r = rig();
  const seen = [];
  r.store.subscribe((s, prev) => {
    const n = s.match.battle && s.match.battle.leaks ? s.match.battle.leaks[start.fieldId] : undefined;
    const was = prev.match.battle && prev.match.battle.leaks ? prev.match.battle.leaks[start.fieldId] : undefined;
    if (n !== was && n !== undefined) seen.push(n);
  });
  r.net.emit('b.start', start);
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  assert.deepEqual(r.store.get().match.battle.leaks, { [start.fieldId]: 0 }, 'published with the field, 0 before any leak');
  // step frame by frame: whenever the battle recorded a counted leak, the store has it after that same frame
  for (let i = 0; i < 200 * 60 && !e.done; i++) {
    r.advance(1000 / 60);
    const now = specMod.battleProgress(e.battle).leaks;
    assert.equal(r.store.get().match.battle.leaks[start.fieldId], now, `frame ${i}: the store follows the battle`);
  }
  assert.ok(e.done, 'finished');
  const res = e.battle.result();
  const counted = Object.values(res.perPlayer).reduce((n, pp) => n + pp.leaked.filter((l) => l && l.counted !== false).length, 0);
  assert.ok(counted >= 3, `the empty board leaks (${counted})`);
  assert.equal(r.store.get().match.battle.leaks[start.fieldId], counted, 'the settle rule\'s count (Match.settle: counted !== false)');
  assert.equal(seen[seen.length - 1], counted, 'the last publish carries the final count');
  assert.ok(seen.every((n, i) => i === 0 || n > seen[i - 1]), `one publish per new count, increasing (${seen})`);
  r.runner.dispose();

  // a display replica of the own field (the server simulates it: reconnect after a takeover) counts the same
  const r2 = rig();
  r2.net.emit('b.start', { ...start, authoritative: false, watch: false, elapsed: 30 });
  await r2.settle();
  const e2 = r2.runner._entries.get(start.battleId);
  assert.equal(r2.store.get().match.battle.leaks[start.fieldId], specMod.battleProgress(e2.battle).leaks, 'counted during the silent catch-up');
  for (let i = 0; i < 200 && !e2.done; i++) r2.advance(1000, 50);
  assert.equal(r2.store.get().match.battle.leaks[start.fieldId], counted);
  assert.equal(r2.net.sent.length, 0, 'still never reports');
  // the round moves on: the next prep drops the battles and their counts
  r2.store.patch('match', { public: { phase: 'SETTLE' } });
  assert.equal(r2.store.get().match.battle.leaks[start.fieldId], counted, 'kept through SETTLE (the top bar resets on the settled m.private)');
  r2.store.patch('match', { public: { phase: 'PREP' } });
  assert.equal(r2.store.get().match.battle, null);
  r2.runner.dispose();
});

test('live leaks: a boss field is not counted (the merged team LP moves through b.pool); b.end forced publishes the final count', async () => {
  const start = leakingStart(7308);
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  r.advance(1500);
  r.net.emit('b.end', { battleId: start.battleId, fieldId: start.fieldId, reason: 'timeout' });
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  assert.ok(e.done);
  const res = e.battle.result();
  const counted = Object.values(res.perPlayer).reduce((n, pp) => n + pp.leaked.filter((l) => l && l.counted !== false).length, 0);
  assert.equal(r.store.get().match.battle.leaks[start.fieldId], counted, 'timeout leaks (the enemies left on the field) are counted at once');
  r.runner.dispose();
  const r2 = rig();
  r2.net.emit('b.start', { ...start, kind: 'boss', fieldId: 'b1', battleId: `${start.battleId}x` });
  await r2.settle();
  assert.deepEqual(r2.store.get().match.battle.leaks, {}, 'only normal fields');
  r2.runner.dispose();
});

test('live unit stats (user playtest #4 item 7): unitStats(id) reads the battle on screen — the sim\'s last computed stats, never unit.s (no recompute from the UI)', async () => {
  const start = realStart(7305);
  const r = rig();
  r.net.emit('b.start', start);
  await r.settle();
  const e = r.runner._entries.get(start.battleId);
  r.advance(2000);
  const ally = e.battle.allyUnits.find((u) => u.alive && u.deployed && u.kind === 'op');
  assert.ok(ally, 'a deployed operator');
  // a trap on the lazy getter: reading the live stats must not recompute them (it would move the sim's floats)
  const s = ally._s;
  Object.defineProperty(ally, 's', { configurable: true, get() { throw new Error('unit.s read by the UI'); } });
  const got = r.runner.unitStats(ally.id);
  delete ally.s;
  assert.ok(got, 'the unit of the battle on screen');
  assert.equal(got.id, ally.id);
  assert.equal(got.uid, ally.uid);
  assert.equal(got.defId, ally.defId);
  assert.equal(got.atk, Math.round(s.atk));
  assert.equal(got.maxHp, Math.round(s.maxHp));
  assert.equal(got.def, Math.round(s.def));
  assert.equal(got.interval, Math.round(s.interval * 100) / 100);
  assert.equal(got.blockCnt, s.blockCnt);
  assert.equal(got.hp, Math.round(ally.hp));
  // the unit's own numbers: its base with its 练度 (0.2.2: the match states 精英2 Lv.60 by default — ×1.1)
  assert.equal(ally.cultivate, 3);
  assert.equal(got.base.atk, Math.round(ally.base.atk * ally.cultMul.atk));
  assert.equal(got.base.maxHp, Math.round(ally.base.maxHp * ally.cultMul.hp));
  assert.equal(r.runner.unitStats(ally.id, start.fieldId)?.id, ally.id, 'on the named field');
  assert.equal(r.runner.unitStats(ally.id, 'n:someone_else'), null, 'another field: nothing');
  assert.equal(r.runner.unitStats(999999), null, 'unknown unit');
  // an own board piece's card left open into the battle: its unit by uid and owner
  assert.equal(r.runner.unitIdOf(ally.uid, ally.ownerId), ally.id);
  assert.equal(r.runner.unitIdOf(ally.uid, ally.ownerId, start.fieldId), ally.id);
  assert.equal(r.runner.unitIdOf(ally.uid, 'someone_else'), null, 'another player\'s piece');
  assert.equal(r.runner.unitIdOf(ally.uid, ally.ownerId, 'n:someone_else'), null, 'another field');
  assert.equal(r.runner.unitIdOf(null, ally.ownerId), null);
  assert.equal(r.runner.unitStats('x'), null);
  // a teammate's bond popup reads the owner's operators with their equipment (a 变形同构体 wearer is a member of the bond
  // it grants: test/ui/morph-bonds.test.js); an operator without items keeps the plain shape
  const saved = ally.items;
  ally.items = ['chess_item_6_09_e_a', 'chess_item_1_01_e_a'];
  const op = r.runner.ownerOps(ally.ownerId, start.fieldId).find((o) => o.defId === ally.defId);
  assert.deepEqual(op, { kind: 'op', ownerId: ally.ownerId, defId: ally.defId, items: ['chess_item_6_09_e_a', 'chess_item_1_01_e_a'] });
  ally.items = [];
  assert.deepEqual(r.runner.ownerOps(ally.ownerId, start.fieldId).find((o) => o.defId === ally.defId), { kind: 'op', ownerId: ally.ownerId, defId: ally.defId });
  ally.items = saved;
  assert.deepEqual(r.runner.ownerOps(ally.ownerId, 'n:someone_else'), [], 'another field');
  // enemies too, once one is out
  for (let i = 0; i < 60 && !e.battle.enemies.some((x) => x.alive); i++) r.advance(500, 50);
  const foe = e.battle.enemies.find((x) => x.alive);
  if (foe) {
    const fs = r.runner.unitStats(foe.id);
    assert.ok(fs && fs.maxHp > 0 && fs.base.maxHp > 0, 'an enemy\'s live stats');
    assert.equal(fs.moveSpeed, Math.round((foe._s || foe.base).moveSpeed * 100) / 100);
  }
  r.runner.clear();
  assert.equal(r.runner.unitStats(ally.id), null, 'nothing on screen after the battles were dropped');
  assert.equal(r.runner.unitIdOf(ally.uid, ally.ownerId), null);
  r.runner.dispose();
});

test('the combat meter stays off unless the setting asks, and turning it off detaches it', async () => {
  const start = realStart(7312);
  const off = rig({ pinMetrics: false });
  const on = rig();
  off.net.emit('b.start', start);
  on.net.emit('b.start', start);
  await off.settle();
  await on.settle();
  const eOff = off.runner._entries.get(start.battleId);
  const eOn = on.runner._entries.get(start.battleId);
  assert.equal(eOff.combatMetrics, null, 'default off does not attach');
  assert.equal(typeof eOn.combatMetrics, 'function');
  assert.equal(eOff.battle._hooks.damaged.length + 1, eOn.battle._hooks.damaged.length, 'no damaged hook when the meter is off');
  assert.equal(Object.prototype.hasOwnProperty.call(eOff.battle, 'heal'), false, 'heal is not wrapped when the meter is off');
  off.advance(1000);
  assert.equal(off.runner.combatMetrics().rows.length, 0);
  // turning it on does not backfill the battle already prepared
  off.runner.setCombatMetrics(true);
  off.advance(500);
  assert.equal(eOff.combatMetrics, null, 'a battle prepared while the meter was off is not backfilled');
  const next = {
    ...start,
    battleId: `${String(start.battleId).slice(0, 58)}-m2`,
    fieldId: `${String(start.fieldId).slice(0, 28)}-m2`,
  };
  await off.runner.onStart(next);
  const eNext = off.runner._entries.get(next.battleId);
  assert.equal(typeof eNext.combatMetrics, 'function', 'the next battle prepared after the switch is tracked');
  let live = 0;
  for (let i = 0; i < 40 && live <= 0 && !eNext.battle.finished; i++) {
    off.advance(500, 50);
    live = (eNext.battle.allyUnits || []).reduce((n, u) => n + (u.stats?.dmg || 0), 0);
  }
  const seen = off.runner.combatMetrics().damage;
  assert.ok(live > 0, `operators dealt no damage by t=${eNext.battle.time}`);
  assert.ok(Math.abs(seen - live) < 1e-6, `meter ${seen} vs sim ${live}`);
  const hooks = eNext.battle._hooks.damaged.length;
  off.runner.setCombatMetrics(false);
  assert.equal(eNext.combatMetrics, null);
  assert.equal(eNext.battle._hooks.damaged.length, hooks - 1, 'turning the meter off removes its damaged hook');
  assert.equal(Object.prototype.hasOwnProperty.call(eNext.battle, 'heal'), false, 'heal is restored');
  off.advance(2000, 50);
  assert.equal(off.runner.combatMetrics().damage, seen, 'damage stops accumulating once the meter is off');
  for (const msg of on.net.sent) {
    assert.equal(msg.rows, undefined);
    assert.equal(msg.combatMetrics, undefined);
  }
  off.runner.dispose();
  on.runner.dispose();
});

test('a Worker host never attaches the combat meter, even when the setting is on', async () => {
  let hooked = 0;
  const battle = {
    finished: true, time: 0, tickCount: 0, leakedCount: 0, flags: {}, allyUnits: [],
    snapshot: () => ({ t: 0 }),
    drainEvents: () => [],
    fieldMeta: () => ({ units: [] }),
    getPlayer: () => null,
    on() { hooked += 1; throw new Error('trackCombat must not attach to a Worker battle'); },
    heal() { return 0; },
  };
  const host = {
    remote: true,
    battle,
    meter: { lp: 0 },
    async load() {},
    async start() {},
    async syncPool() {},
    stop() {},
    progress: () => ({ gt: 0, killed: 0, total: 0, done: true, leaks: 0 }),
    compactResult: () => null,
    step: () => Promise.resolve({ ticks: 0, slices: [] }),
    forceEnd: () => Promise.resolve(),
  };
  const r = rig({ createHost: () => host });
  const spec = { fieldId: 'n:worker', kind: 'normal', players: [{ playerId: 'p_0' }] };
  r.net.emit('b.start', { battleId: 'worker-1', fieldId: 'n:worker', kind: 'normal', spec, authoritative: true, speed: 2 });
  await r.settle();
  const e = r.runner._entries.get('worker-1');
  assert.ok(e && !e.failed, 'the Worker battle was prepared');
  assert.equal(e.combatMetrics, null);
  assert.equal(hooked, 0);
  const prog = r.net.sent.filter((m) => m.t === 'b.progress');
  assert.ok(prog.length >= 1, 'progress is still the battle report');
  for (const msg of r.net.sent) {
    assert.equal(msg.rows, undefined);
    assert.equal(msg.combatMetrics, undefined);
    assert.notEqual(msg.t, 'b.result', 'a null compact result is not sent');
  }
  r.runner.dispose();
});

test('settings expose 作战统计 off by default and the match hides the button unless it is on', () => {
  const settings = readFileSync(new URL('../../public/js/ui/settings.js', import.meta.url), 'utf8');
  const game = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  const logic = readFileSync(new URL('../../public/js/ui/gameLogic/settings.js', import.meta.url), 'utf8');
  assert.match(logic, /combatMetrics: false/);
  assert.match(settings, /label=\$\{t\('作战统计'\)\} micro="COMBAT STATS" value=\$\{s\.combatMetrics\}/);
  assert.match(game, /setCombatMetrics\(s\?\.combatMetrics === true\)/);
  assert.match(game, /const showMetrics = metricsSetting && !modRoom && !spectator/);
  assert.match(game, /data-ui-slot="hud\.right"/);
  const state = { me: {}, room: null, match: { public: null, battle: null }, connection: { status: 'online' } };
  const line = (s) => buildDiagnostics({ state, env: {}, settings: s }).split('\n').find((l) => l.startsWith('settings:'));
  assert.equal(line({ quality: 'high', damageNumbers: true, combatMetrics: true }), 'settings: quality high | damage numbers | combat metrics');
  assert.equal(line({ quality: 'high', damageNumbers: true, combatMetrics: false }), 'settings: quality high | damage numbers');
});
