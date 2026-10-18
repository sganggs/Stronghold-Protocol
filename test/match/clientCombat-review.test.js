// Client-side combat (DESIGN §14) — regression tests of the adversarial review:
//   * eliminated humans keep watching: at COMBAT start they get a display replica of the first field (research 09 §3.1
//     "Keep-watching auto-observes the first available field");
//   * stale battle reports after the match end are ignored, never answered with an error (a rid-less error frame
//     becomes an error toast in the browser) — Match.handle and the platform (server/net.js);
//   * forged results the old validator accepted: leaks marked `counted: false` (no LP loss, "perfect"), layer gains on
//     bonds the player's lineup does not name, 联防 survivors pinned on the wrong leaker;
//   * server-run fields (bots, takeovers) in wall-clock slices instead of one blocking run per field, and the boss
//     takeover's fast-forward spread over the pacing intervals (a low-power host keeps a responsive event loop);
//   * b.pool numbers are exact and a client that emptied the pool as it saw it ends the fight as cleared.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { buildBattleSpec, createBattleFromSpec, compactResult, resultDigest } from '../../server/sim/spec.js';
import { validateClientResult, specBounds, HeadlessPacer, HeadlessJob, runHeadless } from '../../server/match/fields.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { GameData } from '../../server/match/gamedata.js';
import { uniteSurvivors } from '../../server/match/unite.js';
import { startServer } from '../../server/index.js';
import { TestClient } from '../helpers/wsClient.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';

const gd = new GameData(DATA, 'mode_multi_hard');

test('client result names DIY and stand-in operators from the authoritative lineup, never the client or empty slot (#469)', () => {
  const ordinary = Object.values(DATA.chess).find(c => c.visible && !c.isGolden && gd.standIn(c.chessId));
  const cases = [
    { chessId: 'chess_char_6_diy1_a', diy: { charId: 'char_4231_clemnt', skillIndex: 2, uniEquipId: null }, expected: '克莱门莎' },
    { chessId: ordinary.chessId, standIn: true, expected: gd.standIn(ordinary.chessId).name },
  ];
  for (const { expected, ...unit } of cases) {
    const spec = buildBattleSpec({ battleId: 'names', fieldId: 'n:p', kind: 'normal', seed: 1, round: 3, timeLimit: 60,
      players: [{ playerId: 'p', units: [{ uid: 7, kind: 'chess', row: 10, col: 3, items: [], ...unit }], bonds: {} }],
      spawns: [{ enemyKey: plainKey, count: 1, time: 1 }], flags: { layerGainsEnabled: true } });
    const raw = { reason: 'cleared', time: 20, killed: 1, total: 1, errors: 0,
      perPlayer: { p: perPlayer({ killed: 1, total: 1, unitStats: [{ uid: 7, defId: 'forged', name: 'forged', kind: 'op', dmg: 1e6 }] }) } };
    const v = validateClientResult(spec, raw, { gd }); assert.ok(v.ok, v.reason);
    assert.equal(v.result.perPlayer.p.unitStats[0].name, expected);
  }
});

test('eliminated humans auto-observe the first field at COMBAT start (display replica) and may switch freely', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, bots: 1, seed: 9301, fake: true, clientCombat: true, instant: false, pace: 'paced',
    script: () => ({ duration: 6 }) }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  const dead = h.ps('p_2');
  dead.lp = 0;
  dead.eliminate(1);
  h.drive(() => m.phase === PHASE.COMBAT && m.round === 2);
  const starts = h.allTo('p_2', 'b.start').filter((s) => s.spec.round === 2);
  assert.equal(starts.length, 1, 'the eliminated player watches a field without asking');
  assert.equal(starts[0].fieldId, 'n:p_0', 'the first field');
  assert.equal(starts[0].watch, true);
  assert.equal(starts[0].authoritative, false, 'display only');
  assert.equal(m.watchers.get('p_2'), 'n:p_0');
  assert.ok(!m.fields.some((f) => f.players.includes('p_2')), 'no field of its own');
  // free switching (eliminated: anything) — including a bot's server-run field
  assert.deepEqual(m.handle('p_2', { t: 'g.watch', fieldId: 'n:ai_0' }), { ok: true });
  assert.equal(h.lastTo('p_2', 'b.start').fieldId, 'n:ai_0');
  // a reconnect resends the watched field
  m.onDisconnect('p_2');
  m.onReconnect('p_2');
  assert.equal(h.lastTo('p_2', 'b.start').fieldId, 'n:ai_0');
  h.run(() => m.phase === PHASE.SETTLE || h.ended != null);
  assert.equal(m.errorCount, 0);
  checkInvariants(m);
  m.dispose();
});

test('stale b.progress / b.result after the match ended are ignored (ok), other intents still fail', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9302, fake: true, clientCombat: true }).start();
  const m = h.m;
  h.toPrep(1);
  m.finish({ victory: false, reason: 'defeat' });
  assert.deepEqual(m.handle('p_0', { t: 'b.progress', battleId: '1.1.n:p_0', gt: 3, killed: 1, total: 4 }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'b.result', battleId: '1.1.n:p_0', result: { reason: 'cleared', time: 1, perPlayer: {} } }), { ok: true });
  assert.equal(m.handle('p_0', { t: 'g.ready', ready: true }).error, 'WRONG_PHASE');
  m.dispose();
  assert.deepEqual(m.handle('p_1', { t: 'b.progress', battleId: 'x', gt: 0, killed: 0, total: 0 }), { ok: true });
});

let srv = null;
after(async () => { if (srv) await srv.close(); });

test('platform: a rid-less b.progress that reaches no match gets no error frame (a request with a rid still does)', async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  try {
    await c.hello('Stale');
    c.send({ t: 'b.progress', battleId: 'gone', gt: 1, killed: 0, total: 1, rid: null }); // fire-and-forget, like the runner
    const pong = await c.request({ t: 'ping', c: 1 });
    assert.equal(pong.t, 'pong');
    assert.ok(!c.log.some((x) => x.t === 'error'), `no error frame for a stale fire-and-forget report (${JSON.stringify(c.log.filter((x) => x.t === 'error'))})`);
    const r = await c.request({ t: 'b.progress', battleId: 'gone', gt: 1, killed: 0, total: 1 });
    assert.equal(r.t, 'error', 'a request is always answered');
  } finally {
    await c.terminate().catch(() => {});
  }
});

// ---- validation -------------------------------------------------------------------------------------------------

/** A plain enemy key (spawn-only, counts in the total, no content-derived relatives). */
const plainKey = Object.keys(DATA.enemies).find((k) => {
  const e = gd.enemy(k);
  return e && !e.notCountInTotal && specBounds({ spawns: [{ enemyKey: k, count: 1 }] }, gd).derived.size === 0;
});
const uncountedKey = Object.keys(DATA.enemies).find((k) => gd.enemy(k) && gd.enemy(k).notCountInTotal);
const perPlayer = (o = {}) => ({ killed: 0, total: 4, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [], ...o });

test('validation: leaks marked counted:false are only accepted for enemies that never count', () => {
  assert.ok(plainKey && uncountedKey);
  const spec = buildBattleSpec({ battleId: 'v1', fieldId: 'n:p', kind: 'normal', seed: 1, round: 3, timeLimit: 60,
    players: [{ playerId: 'p', units: [], bonds: {} }], spawns: [{ enemyKey: plainKey, count: 2, time: 1 }, { enemyKey: uncountedKey, count: 1, time: 2 }], flags: { layerGainsEnabled: true } });
  const raw = (leaked, perfect) => ({ reason: 'timeout', time: 30, killed: 0, total: 3, perPlayer: { p: perPlayer({ total: 3, leaked, perfect }) }, errors: 0 });
  const honest = validateClientResult(spec, raw([{ enemyKey: plainKey, counted: true }, { enemyKey: uncountedKey, counted: false }], false), { gd });
  assert.ok(honest.ok, honest.reason);
  const forged = validateClientResult(spec, raw([{ enemyKey: plainKey, counted: false }, { enemyKey: plainKey, counted: false }], true), { gd });
  assert.deepEqual(forged, { ok: false, reason: 'uncounted leak' }, 'hiding leaks from the LP count');
  const tagged = buildBattleSpec({ ...spec, spawns: [{ enemyKey: plainKey, count: 1, time: 1, countInTotal: false }] });
  assert.ok(validateClientResult(tagged, raw([{ enemyKey: plainKey, counted: false }], true), { gd }).ok, 'a schedule entry that does not count');
});

test('validation: IN_BATTLE layer gains only on bonds the lineup / band / effects / items name', () => {
  const chess = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && Array.isArray(c.bonds) && c.bonds.length);
  assert.ok(chess);
  const text = JSON.stringify(chess);
  const own = Object.keys(DATA.bonds).find((b) => text.includes(b));
  const foreign = Object.keys(DATA.bonds).find((b) => !text.includes(b));
  assert.ok(own && foreign, 'a bond of the chess and one it does not name');
  const spec = buildBattleSpec({ battleId: 'v2', fieldId: 'n:p', kind: 'normal', seed: 1, round: 5, timeLimit: 60,
    players: [{ playerId: 'p', units: [{ uid: 7, kind: 'chess', chessId: chess.chessId, row: 10, col: 3, items: [] }], bonds: { [own]: { count: 1, active: true, tier: 1, layers: 0 } } }],
    spawns: [{ enemyKey: plainKey, count: 1, time: 1 }], flags: { layerGainsEnabled: true } });
  const raw = (layerGains) => ({ reason: 'cleared', time: 20, killed: 1, total: 1, perPlayer: { p: perPlayer({ killed: 1, total: 1, layerGains }) }, errors: 0 });
  assert.ok(validateClientResult(spec, raw({ [own]: 6 }), { gd }).ok);
  assert.deepEqual(validateClientResult(spec, raw({ [foreign]: 6 }), { gd }), { ok: false, reason: 'layer bond' });
  // a band that grants layers of a named bond (克莱门莎-style, requireActive false) makes that bond legal
  const band = Object.values(DATA.bands).find((b) => {
    const eff = b.effectId && DATA.effects ? DATA.effects[b.effectId] : null;
    return JSON.stringify([b, eff]).includes(foreign);
  });
  if (band) {
    const withBand = buildBattleSpec({ ...spec, players: [{ ...spec.players[0], bandId: band.bandId }] });
    assert.ok(validateClientResult(withBand, raw({ [foreign]: 6 }), { gd }).ok, `band ${band.bandId} names ${foreign}`);
  }
});

test('validation: 联防 survivors cannot be pinned on another leaker (per enemy and leaker, with the never-spawned re-entries)', () => {
  const spec = buildBattleSpec({ battleId: 'v3', fieldId: 'u', kind: 'unite', seed: 1, round: 6, timeLimit: 60,
    players: [{ playerId: 'h', units: [], bonds: {} }],
    spawns: [{ enemyKey: plainKey, count: 1, time: 1, sourcePlayerId: 'a' }, { enemyKey: plainKey, count: 2, time: 2, sourcePlayerId: 'b' }], flags: { layerGainsEnabled: false } });
  const raw = (srcs, unspawned = []) => ({
    reason: 'timeout', time: 60, killed: 0, total: 3, errors: 0, unspawned,
    perPlayer: { h: perPlayer({ total: 3, perfect: !srcs.length, leaked: srcs.map((s) => ({ enemyKey: plainKey, sourcePlayerId: s, counted: true })) }) },
  });
  const ok = validateClientResult(spec, raw(['a', 'b', 'b']), { gd });
  assert.ok(ok.ok, ok.reason);
  assert.deepEqual(ok.result.perPlayer.h.leaked.map((l) => l.sourcePlayerId), ['a', 'b', 'b']);
  assert.deepEqual(validateClientResult(spec, raw(['a', 'a']), { gd }), { ok: false, reason: 'leak source' }, 'b\'s survivor billed to a');
  assert.deepEqual(validateClientResult(spec, raw(['a'], [{ enemyKey: plainKey, sourcePlayerId: 'a', time: 50 }]), { gd }), { ok: false, reason: 'unspawned source' });
  assert.ok(validateClientResult(spec, raw(['b'], [{ enemyKey: plainKey, sourcePlayerId: 'a', time: 50 }, { enemyKey: plainKey, sourcePlayerId: 'b', time: 50 }]), { gd }).ok);
});

test('validation: 联防 survivors that content spawned (splits) are billed only to the leaker who sent the parent in, within the parent\'s offspring count', () => {
  const parent = 'enemy_1195_sfyin'; // 磨砻: DeadSpawn 2 × 木制瑞印
  const child = 'enemy_1196_msfyin';
  assert.ok(specBounds({ spawns: [{ enemyKey: parent, count: 1 }] }, gd).derived.has(child), 'data: the parent spawns the child');
  assert.equal(DATA.enemies[parent].talents.bb['DeadSpawn.cnt'], 2);
  const spec = buildBattleSpec({ battleId: 'v5', fieldId: 'u', kind: 'unite', seed: 1, round: 5, timeLimit: 120,
    players: [{ playerId: 'h', units: [], bonds: {} }],
    spawns: [{ enemyKey: parent, count: 1, time: 1, sourcePlayerId: 'p_1', mods: {} }, { enemyKey: plainKey, count: 1, time: 2, sourcePlayerId: 'p_2' }], flags: { layerGainsEnabled: false } });
  const raw = (srcs) => ({ reason: 'timeout', time: 120, killed: 0, total: 1 + srcs.length, errors: 0,
    perPlayer: { h: perPlayer({ total: 1 + srcs.length, perfect: !srcs.length, leaked: srcs.map((src) => ({ enemyKey: child, sourcePlayerId: src, counted: true })) }) } });
  const honest = validateClientResult(spec, raw(['p_1', 'p_1']), { gd });
  assert.ok(honest.ok, honest.reason);
  assert.deepEqual(honest.result.perPlayer.h.leaked.map((l) => l.sourcePlayerId), ['p_1', 'p_1']);
  assert.deepEqual(validateClientResult(spec, raw(Array(10).fill('p_1')), { gd }), { ok: false, reason: 'leak source' }, '10 survivors of one 磨砻 (the LP cap) billed to p_1');
  assert.deepEqual(validateClientResult(spec, raw(['p_1', 'p_1', 'p_1']), { gd }), { ok: false, reason: 'leak source' }, 'one parent leaves 2');
  assert.deepEqual(validateClientResult(spec, raw(['p_2']), { gd }), { ok: false, reason: 'leak source' }, 'p_2 sent no 磨砻 in');
});

test('validation: a leak born on the 联防 field survives the round trip and is what stops the 联防 from billing it', () => {
  const parent = 'enemy_1195_sfyin'; // 磨砻: DeadSpawn 2 × 木制瑞印
  const child = 'enemy_1196_msfyin';
  assert.ok(specBounds({ spawns: [{ enemyKey: parent, count: 1 }] }, gd).derived.has(child), 'data: the parent spawns the child');
  const spec = buildBattleSpec({ battleId: 'v6', fieldId: 'u', kind: 'unite', seed: 1, round: 5, timeLimit: 120,
    players: [{ playerId: 'h', units: [], bonds: {} }],
    spawns: [{ enemyKey: parent, count: 1, time: 1, sourcePlayerId: 'p_1' }], flags: { layerGainsEnabled: false } });
  // the helper struck the 磨砻 down on the field and both children walked out: real enemies of the fight (`counted`), but
  // tagged `uniteRuntime` — the flag uniteSurvivors filters, so the leaker pays nothing for what he never sent in
  const leaked = [0, 1].map(() => ({ enemyKey: child, lpr: 1, sourcePlayerId: 'p_1', tag: null, counted: true, uniteRuntime: true }));
  const raw = { reason: 'timeout', time: 120, killed: 1, total: 1, errors: 0,
    perPlayer: { h: perPlayer({ killed: 1, total: 1, perfect: false, leaked }) } };
  const v = validateClientResult(spec, raw, { gd });
  assert.ok(v.ok, v.reason);
  assert.deepEqual(v.result.perPlayer.h.leaked.map((l) => [l.counted, l.uniteRuntime]), [[true, true], [true, true]], 'the flag is kept, not dropped');
  const plan = { notReentered: new Map(), leaked: [{ enemyKey: parent, sourcePlayerId: 'p_1' }], leakers: [] };
  assert.equal(uniteSurvivors(plan, v.result).get('p_1') || 0, 0, 'nothing to charge the leaker');
  // …and it is not a laundromat: the same two children WITHOUT the tag are survivors of a 磨砻 and are billed
  const untagged = leaked.map(({ uniteRuntime, ...l }) => l);
  const billed = validateClientResult(spec, { ...raw, perPlayer: { h: perPlayer({ killed: 1, total: 1, perfect: false, leaked: untagged }) } }, { gd });
  assert.ok(billed.ok, billed.reason);
  assert.equal(uniteSurvivors(plan, billed.result).get('p_1'), 2, 'the leaker pays for both');
  assert.notEqual(resultDigest(billed.result).hash, resultDigest(v.result).hash, 'the flag is part of the digest (SP_VERIFY re-simulation)');
  assert.equal(resultDigest(validateClientResult(spec, raw, { gd }).result).hash, resultDigest(v.result).hash);
  // the compact form is what actually travels to the server in client mode
  assert.equal(compactResult(v.result).perPlayer.h.leaked.find((l) => l.uniteRuntime).uniteRuntime, true, 'the compact form keeps it');
  // one more than the parent's data allows (DeadSpawn 2) is not an offspring the wave can have produced
  const over = leaked.concat([{ enemyKey: child, lpr: 1, sourcePlayerId: 'p_1', counted: true, uniteRuntime: true }]);
  const tooMany = validateClientResult(spec, { ...raw, perPlayer: { h: perPlayer({ killed: 1, total: 1, perfect: false, leaked: over }) } }, { gd });
  assert.deepEqual(tooMany, { ok: false, reason: 'unite runtime' }, 'the third flagged child is past the offspring budget');
});

test('validation: uniteRuntime on scheduled escaped-wave leaks without offspring budget is refused', () => {
  const parent = 'enemy_1195_sfyin';
  const spec = buildBattleSpec({ battleId: 'v7', fieldId: 'u', kind: 'unite', seed: 1, round: 6, timeLimit: 60,
    players: [{ playerId: 'h', units: [], bonds: {} }],
    spawns: [
      { enemyKey: plainKey, count: 3, time: 1, sourcePlayerId: 'p_1' },
      { enemyKey: parent, count: 1, time: 2, sourcePlayerId: 'p_1' },
    ], flags: { layerGainsEnabled: false } });
  const leaked = [
    ...[0, 1, 2].map(() => ({ enemyKey: plainKey, lpr: 1, sourcePlayerId: 'p_1', counted: true, uniteRuntime: true })),
    { enemyKey: parent, lpr: 1, sourcePlayerId: 'p_1', counted: true, uniteRuntime: true },
  ];
  const raw = { reason: 'timeout', time: 60, killed: 0, total: 4, errors: 0, perPlayer: { h: perPlayer({ killed: 0, total: 4, perfect: false, leaked }) } };
  assert.deepEqual(validateClientResult(spec, raw, { gd }), { ok: false, reason: 'unite runtime' });
  const honest = leaked.map(({ uniteRuntime, ...l }) => l);
  const billed = validateClientResult(spec, { ...raw, perPlayer: { h: perPlayer({ killed: 0, total: 4, perfect: false, leaked: honest }) } }, { gd });
  assert.ok(billed.ok, billed.reason);
  const plan = { notReentered: new Map(), leaked: spec.spawns, leakers: [] };
  assert.equal(uniteSurvivors(plan, billed.result).get('p_1'), 4, 'the same leaks without the flag are the wave settlement bills');
});

test('validation: overlapping scheduled and child keys have separate sent and runtime budgets ([ASSUMED] residual)', () => {
  const parent = 'enemy_1195_sfyin';
  const child = 'enemy_1196_msfyin';
  // [ASSUMED] Residual: the budget cannot distinguish a scheduled body from a runtime child with the same key.
  const overlap = buildBattleSpec({ battleId: 'v7b', fieldId: 'u', kind: 'unite', seed: 1, round: 5, timeLimit: 60,
    players: [{ playerId: 'h', units: [], bonds: {} }],
    spawns: [{ enemyKey: parent, count: 1, time: 1, sourcePlayerId: 'p_1' }, { enemyKey: child, count: 2, time: 2, sourcePlayerId: 'p_1' }],
    flags: { layerGainsEnabled: false } });
  const flaggedKids = [0, 1].map(() => ({ enemyKey: child, lpr: 1, sourcePlayerId: 'p_1', counted: true, uniteRuntime: true }));
  const ov = validateClientResult(overlap, { reason: 'timeout', time: 60, killed: 1, total: 3, errors: 0, perPlayer: { h: perPlayer({ killed: 1, total: 3, perfect: false, leaked: flaggedKids }) } }, { gd });
  assert.ok(ov.ok, ov.reason);
  assert.equal(uniteSurvivors({ notReentered: new Map(), leaked: overlap.spawns, leakers: [] }, ov.result).get('p_1') || 0, 0);
  const scheduledKids = flaggedKids.map(({ uniteRuntime, ...l }) => l);
  for (const leaked of [[...flaggedKids, ...scheduledKids], [...scheduledKids, ...flaggedKids]]) {
    const v = validateClientResult(overlap, { reason: 'timeout', time: 60, killed: 1, total: 3, errors: 0,
      perPlayer: { h: perPlayer({ killed: 1, total: 3, perfect: false, leaked }) } }, { gd });
    assert.ok(v.ok, v.reason);
    assert.equal(uniteSurvivors({ notReentered: new Map(), leaked: overlap.spawns, leakers: [] }, v.result).get('p_1'), 2,
      'runtime children spend only the offspring budget; scheduled leaks still spend the sent budget, in either order');
  }
});

test('validation: a forged uniteRuntime flag on a normal field is dropped', () => {
  const normal = buildBattleSpec({ battleId: 'v7n', fieldId: 'n', kind: 'normal', seed: 1, round: 1, timeLimit: 30,
    players: [{ playerId: 'p', units: [], bonds: {} }],
    spawns: [{ enemyKey: plainKey, count: 1, time: 1 }], flags: { layerGainsEnabled: false } });
  const nv = validateClientResult(normal, { reason: 'timeout', time: 10, killed: 0, total: 1, errors: 0, perPlayer: { p: perPlayer({ total: 1, perfect: false, leaked: [{ enemyKey: plainKey, counted: true, uniteRuntime: true, lpr: 1 }] }) } }, { gd });
  assert.ok(nv.ok, nv.reason);
  assert.equal(nv.result.perPlayer.p.leaked[0].uniteRuntime, undefined, 'a forged flag on a normal field is dropped, not stored');
  assert.equal(nv.result.perPlayer.p.leaked[0].counted, true);
  assert.equal(nv.result.perPlayer.p.perfect, false);
});

test('a forged uniteRuntime on the escaped wave is refused and the server re-simulates the 联防 with verification off', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 712, clientCombat: true, clients: false, instant: false, verify: 'off' });
  h.start();
  h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 1, { ready: false });
  const m = h.m;
  m.phase = PHASE.COMBAT;
  m.fields = [];
  const n = 4;
  const results = new Map();
  for (const ps of m.alivePlayers()) {
    const leaked = ps.playerId === 'p_1'
      ? Array.from({ length: n }, () => ({ enemyKey: plainKey, mods: null, lpr: 1, sourcePlayerId: 'p_1', tag: null, counted: true }))
      : [];
    results.set(ps.playerId, { leaked, perfect: leaked.length === 0, coins: 0, layerGains: {}, killed: 0, total: n, damageDealt: 0, unitsEnd: [] });
  }
  m.lastResults = results;
  m._afterCombat();
  assert.equal(m.phase, PHASE.UNITE);
  const f = m.fields.find((x) => x.kind === 'unite');
  assert.equal(f.mode, 'client');
  const leaked = [];
  for (const s of f.spec.spawns) {
    const count = Math.max(1, s.count || 1);
    for (let i = 0; i < count; i++) leaked.push({ enemyKey: s.enemyKey, lpr: 1, sourcePlayerId: s.sourcePlayerId, counted: true, uniteRuntime: true });
  }
  const owner = f.spec.players[0].playerId;
  const per = {};
  for (const p of f.spec.players) {
    const mine = p.playerId === owner;
    per[p.playerId] = perPlayer({ killed: 0, total: mine ? leaked.length : 0, leaked: mine ? leaked : [], perfect: !mine });
  }
  const raw = { reason: 'timeout', time: Math.min(30, f.spec.timeLimit), killed: 0, total: leaked.length, errors: 0, perPlayer: per };
  assert.equal(validateClientResult(f.spec, raw, { gd: m.gd }).reason, 'unite runtime');
  const auth = f.authority;
  const rejected = m.verifyStats.rejected;
  assert.deepEqual(m.handle(auth, { t: 'b.result', battleId: f.battleId, result: raw }), { ok: true });
  assert.equal(m.verifyStats.rejected, rejected + 1);
  assert.equal(f.mode, 'server');
  assert.ok(h.sent.some(([id, msg]) => id === auth && msg.t === 'b.end' && msg.reason === 'takeover'), 'the authority is told the server took the field');
  assert.ok(h.run(() => f.resultSource === 'server', { maxTime: 1000 }), 'the refused result is replaced by the server re-simulation');
  const forged = Object.values(f.result.perPlayer).flatMap((p) => p.leaked || []).filter((l) => l && l.uniteRuntime);
  assert.equal(forged.length, 0, 'the re-simulation does not keep the forged flag on the escaped wave');
  m.dispose();
});

test('validation: a leaked split / summon keeps the mods of its parent (round multipliers, bounty id) for its 联防 re-entry', () => {
  const parent = 'enemy_1203_sfhu';
  const child = 'enemy_1204_msfhu';
  assert.ok(specBounds({ spawns: [{ enemyKey: parent, count: 1 }] }, gd).derived.has(child), 'data: the parent spawns the child');
  const mods = { hpMul: 1.728, atkMul: 1.331, speedMul: 1, slot: 'N', bountyId: 'bounty:21' };
  const spec = buildBattleSpec({ battleId: 'v4', fieldId: 'n:p', kind: 'normal', seed: 1, round: 4, timeLimit: 60,
    players: [{ playerId: 'p', units: [], bonds: {} }],
    spawns: [{ enemyKey: plainKey, count: 2, time: 1, mods: { hpMul: 1.728, atkMul: 1.331, speedMul: 1, slot: 'N' } }, { enemyKey: parent, count: 1, time: 5, mods, tag: 'bounty', bounty: { coins: 2, ownerPlayerId: 'p' } }],
    flags: { layerGainsEnabled: true } });
  const raw = { reason: 'timeout', time: 60, killed: 1, total: 4, errors: 0,
    perPlayer: { p: perPlayer({ killed: 1, total: 4, perfect: false, leaked: [{ enemyKey: child, mods: { ...mods }, lpr: 1, sourcePlayerId: 'p', tag: null, counted: true }] }) } };
  const v = validateClientResult(spec, raw, { gd });
  assert.ok(v.ok, v.reason);
  assert.deepEqual(v.result.perPlayer.p.leaked[0].mods, mods, 'the parent\'s mods, not null');
  assert.equal(v.result.perPlayer.p.leaked[0].tag, null, 'the child\'s own tag (as the sim reports it)');
  // mods that no schedule entry has are still not taken from the client
  const odd = validateClientResult(spec, { ...raw, perPlayer: { p: { ...raw.perPlayer.p, leaked: [{ enemyKey: child, mods: { hpMul: 0.01, slot: 'N' }, counted: true }] } } }, { gd });
  assert.ok(odd.ok);
  assert.equal(odd.result.perPlayer.p.leaked[0].mods, null);
  // SP_VERIFY compares digests: leak mods are part of them
  assert.notEqual(resultDigest(v.result).hash, resultDigest(odd.result).hash);
  assert.equal(resultDigest(v.result).hash, resultDigest(validateClientResult(spec, raw, { gd }).result).hash);
});

test('client-side combat stays outcome-identical when a bounty enemy splits and its child leaks into the 联防 (seed 403)', () => {
  const trace = (clientCombat) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 3, bots: 1, seed: 403, captureFrames: false, clientCombat });
    h.autoHumans();
    const m = h.m;
    const out = [];
    let last = '';
    m.start();
    h.run(() => {
      const k = `${m.phase}:${m.round}`;
      if (k !== last) { last = k; if (m.phase === PHASE.SETTLE) out.push(`${k} ${m.order.map((p) => `${p.lp}/${p.funds}+${p.pendingFunds}/${JSON.stringify(p.layers)}`).join(' ')}`); }
      return h.ended != null || m.round >= 5;
    }, { maxSteps: 5e6 });
    assert.equal(m.errorCount, 0);
    m.dispose();
    return out;
  };
  const server = trace(false);
  assert.ok(server.length >= 4);
  assert.deepEqual(trace(true), server);
});

test('validation: every honest result of real client-combat matches (normal + 联防) still passes the tightened checks', () => {
  let n = 0;
  for (const seed of [9311, 9312]) {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 3, bots: 1, seed, captureFrames: false, clientCombat: true });
    h.autoHumans();
    const specs = [];
    h.onSend.push((pid, msg) => { if (msg.t === 'b.start' && msg.authoritative && (msg.kind === 'normal' || msg.kind === 'unite')) specs.push(msg.spec); });
    h.m.start();
    h.run(() => h.ended != null || h.m.phase === PHASE.FINAL_ASSAULT, { maxSteps: 5e6 });
    assert.equal(h.m.verifyStats.rejected, 0, 'no honest client result rejected in the match');
    for (const spec of specs.slice(0, 40)) {
      const res = createBattleFromSpec(spec, h.m.ds, { recordEvents: false, quiet: true }).runToEnd(4000);
      const v = validateClientResult(spec, compactResult(res), { gd: h.m.gd });
      assert.ok(v.ok, `${spec.fieldId} R${spec.round}: ${v.reason}`);
      n++;
    }
    h.m.dispose();
  }
  assert.ok(n >= 20, `results checked (${n})`);
});

// ---- server CPU on a low-power host ----------------------------------------------------------------------------

test('server-run fields (bots) run in wall-clock slices, never in one blocking call, with the same outcome', () => {
  const trace = (headlessSliceMs) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 3, seed: 9321, captureFrames: false, clientCombat: true, headlessSliceMs });
    h.autoHumans();
    const m = h.m;
    let runs = 0;
    const orig = HeadlessJob.prototype.run;
    HeadlessJob.prototype.run = function run(...a) { runs++; return orig.apply(this, a); };
    const pending = [];
    const start = m._startCombatClient.bind(m);
    m._startCombatClient = () => {
      start();
      pending.push(m.fields.filter((f) => f.mode === 'server').map((f) => (f.result ? 'done' : f.job ? 'job' : '?')).join(','));
    };
    const out = [];
    let last = '';
    try {
      m.start();
      h.run(() => {
        const k = `${m.phase}:${m.round}`;
        if (k !== last) { last = k; if (m.phase === PHASE.SETTLE) out.push(`${k} ${m.order.map((p) => `${p.lp}/${p.funds}+${p.pendingFunds}/${JSON.stringify(p.layers)}`).join(' ')}`); }
        return h.ended != null || m.round >= 4;
      }, { maxSteps: 5e6 });
    } finally {
      HeadlessJob.prototype.run = orig;
    }
    assert.equal(m.errorCount, 0, JSON.stringify(m.errors.slice(0, 2)));
    m.dispose();
    return { out, runs, pending };
  };
  const once = trace(undefined);
  const sliced = trace(0.02);
  assert.ok(once.pending.every((p) => p === 'done,done,done'), `virtual time default: at once (${once.pending})`);
  assert.ok(sliced.pending.every((p) => p === 'job,job,job'), `sliced: nothing simulated inside the COMBAT start (${sliced.pending})`);
  assert.ok(sliced.runs > once.runs * 3, `several slices per field (${sliced.runs} vs ${once.runs})`);
  assert.ok(once.out.length >= 3);
  assert.deepEqual(sliced.out, once.out, 'identical rounds');
});

test('HeadlessJob: sliced run = one-shot run (result digest, timeline); a budget stops it early', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 1, seed: 9322, captureFrames: false, clientCombat: true });
  h.autoHumans();
  let spec = null;
  h.onSend.push((pid, msg) => { if (!spec && msg.t === 'b.start' && msg.authoritative) spec = msg.spec; });
  h.m.start();
  h.run(() => spec != null, { maxSteps: 5e6 });
  const whole = runHeadless(createBattleFromSpec(spec, h.m.ds, { recordEvents: false, quiet: true }), { players: ['p_0'] });
  const job = new HeadlessJob(createBattleFromSpec(spec, h.m.ds, { recordEvents: false, quiet: true }), { players: ['p_0'] });
  let t = 0;
  const fakeNow = () => (t += 0.01); // every clock read advances 0.01 ms
  let slices = 0;
  while (!job.run(0.05, fakeNow)) slices++;
  assert.ok(slices > 5, `stopped by the budget (${slices} slices)`);
  assert.equal(resultDigest(job.output().result).hash, resultDigest(whole.result).hash);
  assert.deepEqual(job.output().timeline, whole.timeline);
  h.m.dispose();
});

test('HeadlessPacer: a takeover fast-forward is spread over the pacing intervals (≤ budget + pacing per interval), then paces normally', () => {
  const sched = new VirtualScheduler({ instantCombat: false });
  const errs = [];
  const m = { sched, gameSpeed: 2, guard: (fn) => fn(), reportError: (l, e) => errs.push(`${l}: ${e && e.message}`) };
  FakeBattle.reset();
  const battle = new FakeBattle({ kind: 'boss', fieldId: 'b1', players: [], timeLimit: Infinity });
  const pacer = new HeadlessPacer(m);
  let done = 0;
  const entry = pacer.add({ battle, onDone: () => { done++; } });
  pacer.skipTo(entry, 100, { budgetTicks: 240 }); // 100 game s = 3000 ticks behind
  assert.equal(battle.tickCount, 0, 'nothing stepped synchronously');
  const perInterval = [];
  let prev = 0;
  for (let i = 0; i < 40; i++) {
    sched.advance(34);
    perInterval.push(battle.tickCount - prev);
    prev = battle.tickCount;
  }
  assert.ok(Math.max(...perInterval) <= 240 + 8, `bounded per interval (${Math.max(...perInterval)})`);
  const target = 3000 + Math.floor((40 * 34 / 1000) * 2 * 30);
  assert.ok(Math.abs(battle.tickCount - target) <= 8, `caught up with the moving field clock (${battle.tickCount} vs ${target})`);
  assert.equal(entry.skipTicks, null, 'back to normal pacing');
  sched.advance(34);
  assert.ok(battle.tickCount - prev <= 8 + 240 && battle.tickCount - prev >= 1);
  const before = battle.tickCount;
  sched.advance(1000);
  assert.ok(Math.abs(battle.tickCount - before - 60) <= 8, `2× real time afterwards (${battle.tickCount - before} ticks / s)`);
  assert.deepEqual(errs, []);
  assert.equal(done, 0);
  pacer.stop();
});

// ---- boss pool ---------------------------------------------------------------------------------------------------

test('Final Assault: b.pool carries exact numbers; a client that emptied the pool as it saw it clears the fight (float dust on the server)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 4, seed: 9331, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'boss' ? { bossDps: 1234.567 } : { duration: 2 }) }).start();
  const m = h.m;
  const seen = [];
  h.onBroadcast.push((msg) => { if (msg.t === 'b.pool') seen.push([msg.hp, m.bossPool.hp, msg.acked.b1, m.fields[0].bossAcked]); });
  h.autoHumans();
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  h.sched.advance(2000);
  const [b1] = m.fields;
  assert.ok(seen.length > 3);
  for (const [hp, serverHp, acked, serverAcked] of seen) {
    assert.equal(hp, serverHp, 'hp is the server value (not rounded)');
    assert.equal(acked, serverAcked, 'acked is the counted cumulative damage (not floored)');
  }
  assert.ok(seen.some(([, , acked]) => acked % 1 !== 0), 'fractional damage travels as is');
  // the pool is (almost) empty: 0.004 left from summing both fields' reports
  m.bossPool.hp = 0.004;
  const res = { reason: 'cleared', time: 10, killed: 0, total: 0, errors: 0, perPlayer: {} };
  for (const pid of b1.players) res.perPlayer[pid] = perPlayer({ total: 0 });
  assert.deepEqual(m.handle(b1.authority, { t: 'b.result', battleId: b1.battleId, result: res }), { ok: true });
  assert.equal(m.bossPool.hp, 0, 'the boss is down');
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  m.dispose();
});

// ---- frame size ------------------------------------------------------------------------------------------------

test('fitResult: an oversized b.result is trimmed under the frame budget without touching what settles a normal field', async () => {
  const { fitResult, RESULT_FRAME_BUDGET } = await import('../../server/sim/spec.js');
  const { isBattleResult } = await import('../../shared/protocol.js');
  const mods = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`mod_${i}`, 'x'.repeat(40)]));
  const big = {
    reason: 'timeout', time: 60, killed: 10, total: 400, errors: 0,
    perPlayer: { p: perPlayer({ killed: 10, total: 400, perfect: false, coins: 3, layerGains: { yanShip: 4 },
      leaked: Array.from({ length: 150 }, () => ({ enemyKey: plainKey, mods, lpr: 1, sourcePlayerId: 'p', tag: null, counted: true, spawned: true })),
      unitStats: Array.from({ length: 160 }, (_, i) => ({ uid: i + 1, defId: 'char_x', kind: 'op', dmg: 123456, kills: 3, heal: 0, taken: 999, attacks: 77 })) }) },
  };
  const size = (r) => JSON.stringify({ t: 'b.result', battleId: 'b', result: r, rid: 2147483647 }).length;
  assert.ok(size(big) > 64 * 1024, `the sample is oversized (${size(big)})`);
  const fit = fitResult(big, { battleId: 'b' });
  assert.ok(size(fit) <= RESULT_FRAME_BUDGET, `trimmed (${size(fit)})`);
  assert.ok(isBattleResult(fit));
  const p = fit.perPlayer.p;
  assert.equal(p.leaked.length, 150, 'every leak kept (LP)');
  assert.deepEqual([p.coins, p.layerGains, p.perfect, p.killed, p.total], [3, { yanShip: 4 }, false, 10, 400]);
  assert.equal(big.perPlayer.p.unitStats.length, 160, 'the input is not mutated');
  const small = { ...big, perPlayer: { p: perPlayer() } };
  assert.equal(fitResult(small), small, 'a normal-size result passes unchanged');
  const longLeak = { ...big.perPlayer.p.leaked[0], sourcePlayerId: 'q'.repeat(60), tag: 'x'.repeat(16) };
  const boss = fitResult({ ...big, perPlayer: { p: { ...big.perPlayer.p, leaked: Array.from({ length: 400 }, () => longLeak) } } }, { bossLike: true });
  assert.ok(size(boss) <= RESULT_FRAME_BUDGET && boss.perPlayer.p.leaked.length === 0, 'boss leaks go (they cost LP through b.progress)');
});

// ---- browser loader (runs last: it injects the data into this process' sim like a page does) ------------------------

test('loadBrowserSim: a data file that cannot be fetched fails the loader (no battle on partial data); all files → a working sim', async () => {
  const { loadBrowserSim, SIM_DATA_FILES } = await import('../../public/js/battle/runner.js');
  const base = new URL('../../server/sim/', import.meta.url).href;
  const served = (fail = new Set()) => async (url) => {
    const name = String(url).replace(/^.*\//, '').replace(/\.json$/, '');
    if (fail.has(name)) return { ok: false, status: 503, json: async () => null };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(DATA[name])) };
  };
  let calls = 0;
  const flaky = served(new Set(['bonds']));
  await assert.rejects(loadBrowserSim({ base, fetchFn: (u, o) => { calls++; return flaky(u, o); } }), /simulation data unavailable: bonds/);
  assert.equal(calls, SIM_DATA_FILES.length + 1, 'one retry for the failed file');
  // a transient failure is retried once
  let first = true;
  const once = served();
  const sim = await loadBrowserSim({ base, fetchFn: (u, o) => { if (first && /enemies/.test(u)) { first = false; return Promise.reject(new Error('net')); } return once(u, o); } });
  assert.ok(sim.spec && sim.ds);
  const spec = buildBattleSpec({ battleId: 'l1', fieldId: 'n:p', kind: 'normal', seed: 5, round: 1, stageId: Object.keys(DATA.stages)[0], timeLimit: 30,
    players: [{ playerId: 'p', units: [], bonds: {} }], spawns: [{ enemyKey: plainKey, count: 1, time: 1 }], flags: { layerGainsEnabled: true } });
  const b = sim.spec.createBattleFromSpec(spec, sim.ds, { quiet: true, recordEvents: false });
  b.runToEnd(100);
  assert.ok(b.finished);
});

// ---- 中途退出 around the 联防 plan ----------------------------------------------------------------------------------

test('a player who quits while its field is the last one running is never picked as a 联防 helper (the plan is made after the pause)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, seed: 4243, fake: true, clientCombat: true, instant: false,
    perPlayer: { p_1: { mute: true } },
    script: (b) => (b.kind === 'normal' ? (b.players[0] === 'p_0' ? { duration: 2, leaks: { p_0: 3 } } : b.players[0] === 'p_1' ? { duration: 50 } : { duration: 3 }) : { duration: 5 }) }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.COMBAT && m.round >= 3);
  h.sched.advance(4000);
  assert.deepEqual(m.fields.filter((f) => !f.done).map((f) => f.fieldId), ['n:p_1'], 'p_1\'s field is the last one running');
  const before = h.bc.length;
  m.onLeave('p_1');
  h.run(() => m.phase !== PHASE.COMBAT);
  assert.equal(m.phase, PHASE.UNITE);
  assert.deepEqual(m.unitePlan.helpers.map((p) => p.playerId), ['p_2'], 'only the perfect player still in helps');
  assert.deepEqual(m.fields[0].spec.players.map((p) => [p.playerId, p.colOffset]), [['p_2', 0]], 'a lone helper on its own field (escaped_single)');
  const tickers = h.bc.slice(before).filter((x) => x.t === 'm.ticker').map((x) => x.text);
  assert.ok(!tickers.some((t) => t.startsWith('联防阶段') && t.includes(h.ps('p_1').name)), 'the departed player is not announced as a helper');
  checkInvariants(m);
  m.dispose();
});

test('the only leaker quits during the COMBAT_END pause: no 联防 for leaks nobody can be charged for', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, seed: 4244, fake: true, clientCombat: true, instant: false,
    script: (b) => (b.kind === 'normal' ? (b.players[0] === 'p_0' ? { duration: 2, leaks: { p_0: 3 } } : { duration: 3 }) : { duration: 5 }) }).start();
  const m = h.m;
  h.autoHumans();
  h.drive(() => m.phase === PHASE.COMBAT);
  h.run(() => m.fields.every((f) => f.done));
  assert.equal(m.phase, PHASE.COMBAT, 'in the pause');
  m.onLeave('p_0');
  h.run(() => m.phase !== PHASE.COMBAT);
  assert.equal(m.phase, PHASE.SETTLE, 'straight to SETTLE');
  assert.equal(m.unitePlan == null || !m.unitePlan.leakers.some((p) => p.playerId === 'p_0'), true);
  checkInvariants(m);
  m.dispose();
});

test('CHAR_DAMAGE tickers: a client result names only its own unit types (board, their summons, bond / band summons); summons count once per type', async () => {
  const { give, legalTileFor } = await import('./harness.js');
  const vigil = 'chess_char_3_19_a'; // 伺夜 → 狼群
  const wolf = 'token_10028_vigil_wolf';
  const foreign = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.chessId !== vigil).map((c) => c.chessId).slice(0, 100);
  const stat = (defId) => ({ uid: null, defId, kind: 'op', dmg: 1e12, kills: 0, heal: 0, taken: 0, attacks: 1 });
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 77, fake: true, clientCombat: true, instant: false,
    perPlayer: { p_0: { tamper: (r) => { r.perPlayer.p_0.unitStats = [...foreign.map(stat), ...Array.from({ length: 50 }, () => stat(wolf))]; return r; } } },
    script: () => ({ duration: 2 }) }).start();
  const m = h.m;
  h.toPrep(1);
  const ps = h.ps('p_0');
  give(m, ps, vigil, 'board', legalTileFor(m, ps, vigil));
  const before = h.bc.length;
  h.drive(() => m.phase === PHASE.SETTLE);
  const t = h.bc.slice(before).filter((x) => x.t === 'm.ticker' && x.type === 'CHAR_DAMAGE');
  assert.equal(t.length, 1, t.map((x) => x.text).join(' | '));
  assert.ok(t[0].text.includes(DATA.tokens[wolf].name), t[0].text);
  // the validator: foreign operators dropped, the own summon and the ownerless bond summon (炎佑) kept
  const spec = buildBattleSpec({ battleId: 'v6', fieldId: 'n:p', kind: 'normal', seed: 1, round: 3, timeLimit: 60,
    players: [{ playerId: 'p', units: [{ uid: 7, kind: 'chess', chessId: vigil, row: 10, col: 3, items: [] }], bonds: {} }],
    spawns: [{ enemyKey: plainKey, count: 1, time: 1 }], flags: { layerGainsEnabled: true } });
  const raw = { reason: 'cleared', time: 20, killed: 1, total: 1, errors: 0,
    perPlayer: { p: perPlayer({ killed: 1, total: 1, unitStats: [{ ...stat(vigil), uid: 7 }, stat(foreign[0]), stat(wolf), stat('enemy_9012_acloon')] }) } };
  const v = validateClientResult(spec, raw, { gd });
  assert.ok(v.ok, v.reason);
  assert.deepEqual(v.result.perPlayer.p.unitStats.map((u) => u.defId), [vigil, wolf, 'enemy_9012_acloon']);
  m.dispose();
});
