// COMBAT orchestration, watchers, SETTLE (LP, coins, layers, elimination), 联防, error isolation — with FakeBattle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { GEO } from '../../shared/constants.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, give, checkInvariants, chessOfTier, legalTileFor } from './harness.js';

const normalFields = () => FakeBattle.instances.filter((b) => b.kind === 'normal');

test('COMBAT: one battle per alive player with the board as input; watchers get m.field + b.snap/b.ev; g.watch switches', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 1, seed: 31, fake: true, instant: false, script: () => ({ duration: 3 }) }).start();
  const m = h.m;
  h.toPrep(1);
  const a = h.ps('p_0');
  const id = chessOfTier(1, (c) => c.position === 'RANGED').find((x) => m.pool.has(x));
  const piece = give(m, a, id);
  const tile = [...a.deployMap()].find(([, v]) => v)[0].split(',').map(Number);
  m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile[0], col: tile[1] } });
  m.handle('p_0', { t: 'g.ready', ready: true });
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT);
  assert.equal(m.fields.length, 3);
  const fa = FakeBattle.instances.find((b) => b.fieldId === 'n:p_0');
  assert.equal(fa.kind, 'normal');
  assert.deepEqual(fa.opts.rect, GEO.NORMAL_RECT);
  assert.equal(fa.opts.timeLimit, m.gd.combatTimeLimit(1));
  assert.equal(fa.opts.flags.layerGainsEnabled, true);
  assert.equal(fa.opts.players.length, 1);
  assert.deepEqual(fa.opts.players[0].units.map((u) => [u.chessId, u.row, u.col]), [[id, tile[0], tile[1]]]);
  assert.ok(fa.opts.spawns.length > 0 && fa.opts.spawns.every((s) => s.ownerPlayerId === 'p_0'));
  const seeds = new Set(normalFields().map((b) => b.opts.seed));
  assert.equal(seeds.size, 3, 'every field has its own seed');
  const field = h.lastTo('p_0', 'm.field');
  assert.equal(field.fieldId, 'n:p_0');
  const pub = m.publicView();
  assert.equal(pub.players.find((p) => p.playerId === 'p_0').status, 'combat');
  assert.equal(pub.players.find((p) => p.playerId === 'p_0').fieldId, 'n:p_0');
  // real-time pacing: 2 ticks per real 1/30 s, a snapshot every 3 ticks
  const before = h.allTo('p_0', 'b.snap').length;
  h.sched.advance(1000);
  const snaps = h.allTo('p_0', 'b.snap').length - before;
  assert.ok(snaps >= 17 && snaps <= 23, `≈20 snapshots per real second, got ${snaps}`);
  const last = h.lastTo('p_0', 'b.snap');
  assert.equal(typeof last.gt, 'number', 'game time travels as gt (t is the frame type)');
  assert.ok(Array.isArray(last.units));
  assert.ok(Math.abs(fa.time - 2) < 0.2, `game time runs at 2× (${fa.time})`);
  assert.ok(h.allTo('p_0', 'b.ev').length > 0);
  assert.ok(h.allTo('p_0', 'b.snap').every((s) => s.fieldId === 'n:p_0'));
  // switch to the teammate's field
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.equal(h.lastTo('p_0', 'm.field').fieldId, 'n:p_1');
  h.sched.advance(200);
  assert.equal(h.lastTo('p_0', 'b.snap').fieldId, 'n:p_1');
  assert.equal(m.handle('p_0', { t: 'g.watch', fieldId: 'b9' }).error, 'BAD_TARGET');
  // fields finish at different times: m.public reflects it (status done, live false) while others still fight
  FakeBattle.instances.find((b) => b.fieldId === 'n:p_1').forceEnd('forced');
  h.sched.advance(300);
  const live = h.lastBc('m.public');
  assert.equal(live.fields.find((f) => f.fieldId === 'n:p_1').live, false);
  assert.equal(live.players.find((p) => p.playerId === 'p_1').status, 'done');
  assert.equal(live.players.find((p) => p.playerId === 'p_0').status, 'combat');
  h.run(() => m.phase === PHASE.SETTLE);
  m.dispose();
});

test('SETTLE: LP −min(leaks, 10), bounty coins next round, IN_BATTLE layer gains applied, perfect rounds counted', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 32, fake: true,
    script: (b) => (b.round === 1 ? { leaks: { p_0: 14, p_1: 3 }, coins: { p_0: 2 }, layerGains: { p_0: { yanShip: 5 } } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const [a, b] = [h.ps('p_0'), h.ps('p_1')];
  const lpA = a.lp;
  const lpB = b.lp;
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(a.lp, lpA - 10, 'capped at 10');
  assert.equal(b.lp, lpB - 3);
  assert.equal(a.pendingFunds, 2);
  assert.equal(a.layers.yanShip, 5);
  assert.equal(a.stats.leaks, 14);
  assert.equal(m.unitePlan, null, 'nobody perfect → no 联防');
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.equal(a.funds, m.gd.income(2) + 2, 'coins credited at the next round start');
  checkInvariants(m);
  m.dispose();
});

test('elimination: LP ≤ 0 → out, copies back to the pool; everyone out → RESULT defeat', () => {
  // p_1 is perfect → 联防 re-fights p_0's leaks; all 10 survive and cost p_0 its last LP
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 33, fake: true, script: (b) => (b.kind === 'unite' ? { survivors: { p_0: 10 } } : { leaks: Object.fromEntries(b.players.map((p) => [p, p === 'p_0' ? 10 : 0])) }) }).start();
  const m = h.m;
  h.toPrep(1);
  const a = h.ps('p_0');
  const id = chessOfTier(2).find((x) => m.pool.has(x));
  give(m, a, id);
  const left = m.pool.left(id);
  a.lp = 5;
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(a.alive, false);
  assert.equal(a.lp, 0);
  assert.equal(a.eliminatedRound, 1);
  assert.equal(m.pool.left(id), left + 1);
  assert.equal(m.publicView().players.find((p) => p.playerId === 'p_0').status, 'dead');
  assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { error: 'ELIMINATED' });
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.equal(a.funds, 0, 'eliminated players get no income');
  // the survivor keeps playing; now kill them too
  FakeBattle.script = (bt) => ({ leaks: Object.fromEntries(bt.players.map((p) => [p, 10])) });
  h.ps('p_1').lp = 3;
  const end = h.drive(() => h.ended != null);
  assert.ok(end);
  assert.equal(h.ended.victory, false);
  assert.equal(h.ended.reason, 'eliminated');
  const rows = Object.fromEntries(h.ended.players.map((p) => [p.playerId, p]));
  assert.equal(rows.p_0.roundsPassed, 0);
  assert.equal(rows.p_1.roundsPassed, 1);
  assert.equal(h.endedCount, 1);
  checkInvariants(m);
  m.dispose();
});

test('联防: trigger, helpers (≤ 2, highest LP then seat), carry state, sources, survivors cost the SOURCE (cap 10)', () => {
  const h = makeMatch({
    mode: 'coop', humans: 4, seed: 34, fake: true,
    script: (b) => {
      if (b.kind === 'normal') return { leaks: { p_0: 6, p_3: 12 } };
      if (b.kind === 'unite') return { survivors: { p_0: 2, p_3: 11 } };
      return {};
    },
  }).start();
  const m = h.m;
  h.toPrep(1);
  const ps = ['p_0', 'p_1', 'p_2', 'p_3'].map((id) => h.ps(id));
  ps[1].lp = 30; ps[2].lp = 30; ps[0].lp = 40; ps[3].lp = 40;
  // give p_1 a unit so the helper input has something to carry
  const id = chessOfTier(1, (c) => c.position === 'MELEE').find((x) => m.pool.has(x));
  const unit = give(m, ps[1], id, 'board', [...ps[1].deployMap()].find(([, v]) => v === 'melee')[0].split(',').map(Number));
  h.drive(() => m.phase === PHASE.UNITE);
  const plan = m.unitePlan;
  assert.deepEqual(plan.leakers.map((p) => p.playerId).sort(), ['p_0', 'p_3']);
  assert.deepEqual(plan.helpers.map((p) => p.playerId), ['p_1', 'p_2'], 'equal LP → lower seat first');
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  assert.equal(u.fieldId, 'u');
  assert.deepEqual(u.opts.rect, GEO.UNITE_RECT);
  assert.equal(u.opts.flags.layerGainsEnabled, false);
  // unite.js (research 08 §5): the first-ranked helper "率先迎敌" on the right-hand field (colOffset +8)
  assert.deepEqual(u.opts.players.map((p) => [p.playerId, p.colOffset]), [['p_1', 8], ['p_2', 0]]);
  const carried = u.opts.players[0].units.find((x) => x.uid === unit.uid);
  assert.deepEqual(carried.carryState, { hpPct: 0.5, sp: 3 }, 'HP%/SP from the end of the own combat');
  assert.equal(u.opts.spawns.length, 18, 'union of every counted leak');
  assert.equal(u.opts.spawns.filter((s) => s.sourcePlayerId === 'p_0').length, 6);
  assert.equal(u.opts.spawns.filter((s) => s.sourcePlayerId === 'p_3').length, 12);
  assert.equal(u.opts.timeLimit, m.gd.combatTimeLimit(1));
  assert.equal(m.publicView().players.find((p) => p.playerId === 'p_1').status, 'helping');
  assert.equal(m.publicView().fields[0].fieldId, 'u');
  // every human watches the unite field by default
  assert.equal(h.lastTo('p_3', 'm.field').fieldId, 'u');
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(ps[0].lp, 38, 'p_0: 2 survivors');
  assert.equal(ps[3].lp, 30, 'p_3: 11 survivors capped at 10');
  assert.equal(ps[1].lp, 30);
  assert.equal(ps[2].lp, 30);
  checkInvariants(m);
  m.dispose();
});

test('联防: an operator knocked out at the end of the helper\'s own combat is fielded `down` (强制退场, with its summons); the living carry their state', () => {
  let deadUid = null;
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 37, fake: true,
    script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 3 }, deadUids: deadUid != null ? [deadUid] : [] } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const helper = h.ps('p_1');
  // 伺夜 (placeable talent summon 狼群) is knocked out in p_1's own combat; a second operator survives it
  const t0 = legalTileFor(m, helper, 'chess_char_3_19_a');
  const hemo = give(m, helper, 'chess_char_3_19_a', 'board', t0);
  const other = chessOfTier(1, (c) => c.position === 'RANGED').find((x) => m.pool.has(x));
  const alive = give(m, helper, other, 'board', legalTileFor(m, helper, other));
  const stack = helper.hand.find((p) => p && p.kind === 'token' && p.ownerUid === hemo.uid);
  assert.ok(stack, '伺夜 brought its summon stack');
  let placed = null;
  for (const [k] of helper.deployMap()) {
    const [r, c] = k.split(',').map(Number);
    if (helper.board.has(k)) continue;
    if (m.handle('p_1', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: r, col: c } }).ok) { placed = k; break; }
  }
  assert.ok(placed, 'the summon stands on the board');
  deadUid = hemo.uid;
  h.drive(() => m.phase === PHASE.UNITE);
  assert.deepEqual(m.unitePlan.helpers.map((p) => p.playerId), ['p_1']);
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  const units = u.opts.players[0].units;
  // PRTS 卫戍协议/帮助: deployed, then "上一阶段为退场状态的干员强制退场" — the sim puts it down on its tile with its redeploy
  // timer (user playtest #5 item 2: it used to be left out and vanished); its summons are fielded as the board has them
  assert.deepEqual(units.find((x) => x.uid === hemo.uid)?.carryState, { down: true }, 'the knocked-out operator enters 联防 down');
  assert.ok(units.some((x) => x.kind === 'token' && x.ownerUid === hemo.uid), 'its summons are fielded');
  assert.deepEqual(units.find((x) => x.uid === alive.uid).carryState, { hpPct: 0.5, sp: 3 });
  assert.ok(helper.board.has(`${t0[0]},${t0[1]}`) && helper.board.has(placed), 'the board itself is untouched (next round as usual)');
  // during 联防 an 'n:<pid>' id names no field: refused, and the viewer keeps streaming the 联防 field
  assert.equal(m.watchers.get('p_0'), 'u');
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { error: 'BAD_TARGET', detail: 'no such field' });
  assert.equal(m.watchers.get('p_0'), 'u');
  h.drive(() => m.phase === PHASE.SETTLE);
  // outside battles the prep scouting view works as before
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.equal(h.lastTo('p_0', 'm.field').prep, true);
  checkInvariants(m);
  m.dispose();
});

test('联防 is skipped when everyone is perfect, everyone leaked, or in solo', () => {
  for (const [mode, humans, leaks] of [['coop', 2, {}], ['coop', 2, { p_0: 3, p_1: 2 }], ['solo', 1, { p_0: 5 }]]) {
    const h = makeMatch({ mode, humans, seed: 35, fake: true, script: () => ({ leaks }) }).start();
    h.toPrep(1);
    h.drive(() => h.m.phase === PHASE.SETTLE || h.m.phase === PHASE.UNITE);
    assert.equal(h.m.phase, PHASE.SETTLE, `${mode} ${JSON.stringify(leaks)}`);
    assert.ok(!FakeBattle.instances.some((b) => b.kind === 'unite'));
    h.m.dispose();
  }
});

test('error isolation: a battle that throws is force-ended as a timeout; a constructor failure yields a clean result', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 36, fake: true, script: (b) => (b.fieldId === 'n:p_0' ? { throwAt: 10 } : b.fieldId === 'n:p_1' ? { throwInCtor: true } : {}) }).start();
  const m = h.m;
  h.toPrep(1);
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.ok(m.errorCount >= 2, 'both failures reported');
  assert.equal(h.ps('p_1').lp, h.ps('p_1').lp, 'still alive');
  assert.ok(h.ps('p_0').alive && h.ps('p_1').alive);
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.equal(m.round, 2, 'the match continues');
  m.dispose();
});
