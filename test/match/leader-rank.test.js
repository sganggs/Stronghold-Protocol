// 规程 leader ranking: per-operator damage from the reports the fields already send, clamped like the pool,
// top 3 on m.public during the fight. 盟约's public view grows no field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { validateC2S } from '../../shared/protocol.js';
import { makeMatch } from './harness.js';
import { leaderTopRows, syncFieldLeaderOps } from '../../server/match/leaderRank.js';

const act3 = getVersionData('act3autochess@V3_1');
const BOSS_IDS = Object.keys(act3.bosses);

function row(pid, uid, dmg, chess = `op_${uid}`, tier = 4) {
  return { pid, uid, chess, tier, dmg };
}

function regulation(extra = {}) {
  const h = makeMatch({
    humans: 4, difficulty: 'HARD', modeId: 'mode_multi_hard', data: act3,
    clientCombat: true, fake: true, instant: false, clients: false, ...extra,
  }).start();
  h.toPrep(1, { band: 'band_amiya' });
  return h;
}

function openBoss(h, hidden) {
  const m = h.m;
  m.round = hidden ? 15 : 14;
  m.teamLp = 50;
  m.bossId = BOSS_IDS.includes('boss_1') ? 'boss_1' : BOSS_IDS[0];
  m.hiddenBossId = BOSS_IDS.includes('boss_9') ? 'boss_9' : BOSS_IDS[Math.min(1, BOSS_IDS.length - 1)];
  m._planBossWaves();
  m.startFinalAssault(!!hidden);
  return m;
}

function report(m, f, rows) {
  const by = {};
  for (const r of rows) by[r.pid] = (by[r.pid] || 0) + r.dmg;
  const bossDmg = Object.values(by).reduce((s, n) => s + n, 0);
  const res = m.handle(f.authority, {
    t: 'b.progress', battleId: f.battleId, gt: 8, killed: 0, total: 0, bossDmg, by, ops: rows,
  });
  assert.deepEqual(res, { ok: true });
}

test('two pair fields: top 3 from the reports, the same player twice, a second read does not double', () => {
  const h = regulation();
  const m = openBoss(h, false);
  try {
    assert.deepEqual(m.publicView().leaderTop, [], 'the fight publishes an empty list before any damage');
    const [b1, b2] = m.fields;
    assert.equal(b1.players.length, 2);
    assert.equal(b2.players.length, 2);
    const [a, b] = b1.players;
    const [c, d] = b2.players;
    const other = b1.players.find((p) => p !== b1.authority);
    const hp = m.bossPool.hp;
    m.handle(other, {
      t: 'b.progress', battleId: b1.battleId, gt: 1, killed: 0, total: 0,
      bossDmg: 1e13, by: { [a]: 1e13 }, ops: [row(a, 1, 1e13)],
    });
    assert.equal(m.bossPool.hp, hp, 'a non-authority report credits nothing');
    assert.deepEqual(m.publicView().leaderTop, []);
    h.sched.advance(4000);
    report(m, b1, [row(a, 1, 5000, 'op_a', 5), row(a, 2, 1000, 'op_b', 4), row(b, 3, 800, 'op_c', 3)]);
    report(m, b2, [row(c, 4, 9000, 'op_d', 6), row(d, 5, 100, 'op_e', 2)]);
    const top = m.publicView().leaderTop;
    assert.deepEqual(top.map((r) => [r.pid, r.uid, r.dmg]), [[c, 4, 9000], [a, 1, 5000], [a, 2, 1000]]);
    assert.equal(top.filter((r) => r.pid === a).length, 2, 'one player can hold two of the three rows');
    assert.equal(top[0].chess, 'op_d');
    assert.equal(top[0].tier, 6);
    assert.deepEqual(m.publicView().leaderTop, top, 'reading the view again adds nothing');
    report(m, b2, [row(c, 4, 9000, 'op_d', 6), row(d, 5, 100, 'op_e', 2)]);
    assert.deepEqual(m.publicView().leaderTop, top, 'the same cumulative report does not double');
    const before = m.bossPool.hp;
    const snap = m.publicView().leaderTop;
    m._finalEnding = 'forced';
    m.handle(b1.authority, {
      t: 'b.progress', battleId: b1.battleId, gt: 9, killed: 0, total: 0,
      bossDmg: 1e13, by: { [a]: 1e13 }, ops: [row(a, 1, 1e13, 'op_a', 5)],
    });
    assert.equal(m.bossPool.hp, before);
    assert.deepEqual(m.publicView().leaderTop, snap, 'after a forced end a later report changes nothing');
  } finally { m.dispose(); }
});

test('the hidden round starts a fresh tally', () => {
  const h = regulation();
  const m = openBoss(h, false);
  try {
    h.sched.advance(4000);
    const f = m.fields[0];
    const pid = f.players[0];
    report(m, f, [row(pid, 1, 4000, 'op_a', 5)]);
    assert.equal(m.publicView().leaderTop[0].uid, 1);
    const pool = m.bossPool;
    m.teamLp = 50;
    openBoss(h, true);
    assert.notEqual(m.bossPool, pool);
    assert.equal(m.phase, 'HIDDEN_CORE');
    assert.deepEqual(m.publicView().leaderTop, []);
    const g = m.fields[0];
    h.sched.advance(4000);
    report(m, g, [row(g.players[0], 7, 250, 'op_h', 4)]);
    assert.deepEqual(m.publicView().leaderTop.map((r) => r.uid), [7]);
  } finally { m.dispose(); }
});

test('a short clock clamps a huge report, a duplicate uid keeps the max, and a stranger is ignored', () => {
  const h = regulation();
  const m = openBoss(h, false);
  try {
    h.sched.advance(200);
    const f = m.fields[0];
    const [a, b] = f.players;
    const budget = m._bossDmgBudget(f);
    assert.ok(budget < m.bossPool.maxHp, '200 ms is not the whole pool');
    report(m, f, [
      row(a, 1, 1e13, 'op_a', 5),
      row(a, 1, 10, 'op_other', 1),
      row(a, 2, 1e13, 'op_b', 4),
      row('p_nope', 9, 1e13, 'op_z', 1),
      row(b, 3, 1e13, 'op_c', 3),
    ]);
    assert.ok((f.bossBy[a] || 0) <= budget + 1e-6);
    assert.ok((f.bossBy[b] || 0) <= budget + 1e-6);
    assert.ok((f.bossBy[a] || 0) + (f.bossBy[b] || 0) <= budget + 1e-6);
    let clientA = 0;
    for (const row of m.bossPool.ops.values()) {
      assert.notEqual(row.pid, 'p_nope');
      if (row.pid === a) clientA += row.client.get(f.fieldId) || 0;
      if (row.uid === 1) assert.equal(row.chess, 'op_a', 'the larger of the two reports for one uid');
    }
    assert.ok(Math.abs(clientA - (f.bossBy[a] || 0)) < 1e-6, 'the units sum to the damage already credited');
    const once = m.publicView().leaderTop;
    assert.deepEqual(m.publicView().leaderTop, once);
  } finally { m.dispose(); }
});

test('盟约 accepts ops and publishes no leaderTop', () => {
  const h = makeMatch({ humans: 4, difficulty: 'HARD', clientCombat: true, fake: true, instant: false, clients: false }).start();
  h.toPrep(1);
  const m = h.m;
  try {
    m.round = 14;
    m.teamLp = 50;
    m.bossId = 'boss_1';
    m.hiddenBossId = 'boss_9';
    m._planBossWaves();
    m.startFinalAssault(false);
    assert.equal(m.bossPool.ops, undefined);
    h.sched.advance(4000);
    const f = m.fields[0];
    const pid = f.players[0];
    report(m, f, [row(pid, 1, 500)]);
    assert.ok(m.bossPool.hp < m.bossPool.maxHp, 'the pool still takes the report');
    assert.equal(Object.hasOwn(m.publicView(), 'leaderTop'), false);
    assert.equal(m.bossPool.ops, undefined);
  } finally { m.dispose(); }
});

test('a server-run field folds leaderHits once; a new battle adds only its own hits', () => {
  const h = makeMatch({
    humans: 4, difficulty: 'HARD', modeId: 'mode_multi_hard', data: act3,
    clientCombat: false, fake: true, instant: false,
  }).start();
  h.toPrep(1, { band: 'band_amiya' });
  const m = openBoss(h, false);
  try {
    const f = m.fields[0];
    assert.notEqual(f.mode, 'client');
    const pid = f.players[0];
    let dmg = 100;
    f.battle.leaderHits = () => [{ pid, uid: 1, chess: 'op_a', tier: 5, dmg }, { pid: 'p_nope', uid: 9, chess: 'op_z', tier: 1, dmg: 9999 }];
    const first = m.publicView().leaderTop;
    assert.deepEqual(first, [{ pid, uid: 1, chess: 'op_a', tier: 5, dmg: 100 }]);
    assert.deepEqual(m.publicView().leaderTop, first);
    dmg = 150;
    assert.equal(m.publicView().leaderTop[0].dmg, 150);
    f.battle = { leaderHits: () => [{ pid, uid: 1, chess: 'op_a', tier: 5, dmg: 40 }] };
    assert.equal(m.publicView().leaderTop[0].dmg, 190, 'the new battle starts its cursor at zero and adds 40');
    assert.equal(m.publicView().leaderTop[0].dmg, 190);
  } finally { m.dispose(); }
});

test('top 3 orders by float damage, then seat, then uid', () => {
  const pool = { ops: new Map() };
  const add = (pid, uid, dmg) => {
    pool.ops.set(`${pid}\0${uid}`, { pid, uid, chess: 'op_a', tier: 4, dmg, client: new Map(), server: dmg });
  };
  add('p1', 2, 10);
  add('p2', 1, 10);
  add('p1', 1, 10);
  add('p3', 9, 10);
  const seats = { p1: 0, p2: 1, p3: 5 };
  const top = leaderTopRows(pool, (pid) => (Number.isInteger(seats[pid]) ? seats[pid] : 1e9));
  assert.deepEqual(top.map((r) => [r.pid, r.uid]), [['p1', 1], ['p1', 2], ['p2', 1]]);
  pool.ops.clear();
  add('a', 1, 10.6);
  add('b', 2, 10.4);
  const rounded = leaderTopRows(pool, () => 0);
  assert.deepEqual(rounded.map((r) => [r.uid, r.dmg]), [[1, 11], [2, 10]]);
});

test('client rows scale into the credited cap; the last uid absorbs the dust; a client field ignores server hits', () => {
  const pool = { ops: new Map() };
  const f = {
    fieldId: 'b1', mode: 'client', players: ['p0'], bossBy: { p0: 100 },
    opsReport: [row('p0', 1, 300, 'op_a', 5), row('p0', 2, 100, 'op_b', 4)],
    battle: { leaderHits: () => [row('p0', 9, 999, 'op_z', 1)] },
  };
  syncFieldLeaderOps(pool, f);
  const rows = [...pool.ops.values()].sort((a, b) => a.uid - b.uid);
  assert.deepEqual(rows.map((r) => r.uid), [1, 2]);
  assert.equal(rows[0].dmg, 75);
  assert.equal(rows[1].dmg, 25);
  assert.equal(rows[0].dmg + rows[1].dmg, 100);
  syncFieldLeaderOps(pool, f);
  const again = [...pool.ops.values()].reduce((s, r) => s + r.dmg, 0);
  assert.equal(again, 100);
  const dust = { ops: new Map() };
  const g = {
    fieldId: 'b1', mode: 'client', players: ['p0'], bossBy: { p0: 1 },
    opsReport: [row('p0', 1, 1), row('p0', 2, 1), row('p0', 3, 1)],
  };
  syncFieldLeaderOps(dust, g);
  const sum = [...dust.ops.values()].reduce((s, r) => s + r.dmg, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('b.progress ops is optional and strict', () => {
  const base = { t: 'b.progress', battleId: 'a.1.1.b1', gt: 3, killed: 0, total: 0, leaks: 0, bossDmg: 10, by: { p_0: 10 } };
  const good = { uid: 1, pid: 'p_0', chess: 'op_a', tier: 5, dmg: 10 };
  assert.equal(validateC2S({ ...base, ops: [good] }), null);
  assert.equal(validateC2S(base), null, 'a message without ops still validates');
  assert.equal(validateC2S({ ...base, ops: [] }), null);
  const many = Array.from({ length: 49 }, (_, i) => ({ uid: i + 1, pid: 'p_0', chess: 'op_a', tier: 1, dmg: 1 }));
  for (const bad of [
    [{ ...good, tier: 11 }],
    [{ ...good, tier: -1 }],
    [{ ...good, tier: 1.5 }],
    [{ ...good, uid: 0 }],
    [{ ...good, dmg: -1 }],
    [{ ...good, pid: 'a b' }],
    [{ ...good, extra: 1 }],
    many,
    'ops',
  ]) assert.notEqual(validateC2S({ ...base, ops: bad }), null, JSON.stringify(bad).slice(0, 80));
});
