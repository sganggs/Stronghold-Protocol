// test/sim/downelem.test.js — user playtest #4 items 8 and 9, sim side (server/sim/Battle.js snapshot / fieldMeta,
// attack/element.js elementView): b.snap `down` lists the knocked-out operators waiting to redeploy on the tile they lie on (the
// client keeps them there knocked down with a redeploy countdown) and `elem` the element gauge each unit shows
// (PRTS 元素: the fullest gauge, its 爆发冷却) — entries, states, and what is left out. User playtest #5 item 2: an
// operator entering a battle knocked out (联防 carryState `down`, constants.js FORCED_EXIT) is down the same way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { DOWN_STATE, ELEMENT, ELEMENT_ORDER, FORCED_EXIT } from '../../server/sim/constants.js';
import { elementView } from '../../server/sim/attack.js';
import { unitStatsEntry } from '../../shared/protocol.js';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const op = (id, stats = {}) => chessRec({ id, profession: 'WARRIOR', stats: { atk: 0, maxHp: 1000, def: 0, blockCnt: 0, cost: 12, respawnTime: 6, ...stats }, skill: null });
const TOKEN = { name: '测试召唤物', stats: { maxHp: 100, atk: 0, def: 0, res: 0, blockCnt: 0, cost: 0, respawnTime: 0 } };
const downOf = (h, id) => (h.snapshot().down || []).find((d) => d[0] === id) || null;

test('a knocked-out operator is `down` until it redeploys: its timer, then waiting for the DP (no ally takes its tile); then back', () => {
  const h = makeBattle({
    defs: { chess: { t_a: op('t_a'), t_b: op('t_b') } }, units: [{ chessId: 't_a', row: 9, col: 5 }, { chessId: 't_b', row: 10, col: 5 }],
    content: 'none', autoFinish: false, timeLimit: 120, flags: { dpInit: 0, dpPerSec: 1, dpMax: 99 },
  });
  h.step();
  const a = h.unit('t_a');
  assert.equal(h.snapshot().down, undefined, 'no entry while everyone stands');
  const t0 = h.b.time;
  h.b.kill(a);
  let d = downOf(h, a.id);
  assert.ok(d, 'down right after the knock-out');
  approx(d[1], Math.round((t0 + 6) * 100) / 100, 0.011);
  approx(d[2], 6, 0.011);
  assert.equal(d[3], DOWN_STATE.COUNTING);
  assert.deepEqual(d.slice(4), [9, 5], 'the tile it lies on (player report F5 after 0.1.0)');
  assert.ok(h.b.fieldMeta().units.some((u) => u.id === a.id), 'a client joining now gets its UnitInfo');
  h.run(6.5);
  assert.equal(downOf(h, a.id)[3], DOWN_STATE.WAIT_DP, 'timer done, 6.5 DP < cost 12');
  // "倒地干员所在地块视为可部署，但所有我方单位在此处的部署行为将被阻止" (PRTS 卫戍协议/帮助): WAIT_TILE (its tile taken)
  // is a safeguard only — no summon (or any ally) is deployed on the tile it lies on
  assert.equal(h.b.spawnToken('p1', 'token_test', 9, 5, { def: TOKEN }), null, 'no summon on its tile');
  assert.equal(h.b.isReservedTile(9, 5), true);
  h.run(5);
  assert.ok(!a.alive, 'no redeploy while the DP is short (11.5 < 12)');
  assert.equal(downOf(h, a.id)[3], DOWN_STATE.WAIT_DP);
  h.run(1);
  assert.ok(a.alive && a.deployed, 'redeployed on its tile once the DP is there (12.5 ≥ 12)');
  assert.deepEqual([a.tileR, a.tileC], [9, 5]);
  assert.equal(downOf(h, a.id), null);
  assert.equal(h.snapshot().down, undefined);
  assert.ok(h.eventsOf('deploy').some((e) => e[1] === a.id));
});

test('summons, devices, enemies, operators removed for good and the 突袭 retreat are never `down`; an operator forced out is (GitHub #60)', () => {
  const h = makeBattle({
    defs: { chess: { t_a: op('t_a'), t_b: op('t_b'), t_c: op('t_c'), t_d: op('t_d') }, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100, speed: 0 }) } },
    units: [{ chessId: 't_a', row: 9, col: 5 }, { chessId: 't_b', row: 10, col: 5 }, { chessId: 't_c', row: 11, col: 5 }, { chessId: 't_d', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none', autoFinish: false, timeLimit: 120,
  });
  h.step();
  const tok = h.b.spawnToken('p1', 'token_test', 12, 5, { def: TOKEN });
  h.b.kill(tok);
  h.b.retreat(h.unit('t_b'), { reason: 'expired', permanent: true });
  h.b.retreat(h.unit('t_d'), { reason: 'raid' });      // 突袭: redeployed at once on its landing tile (here: nowhere)
  h.b.kill(h.enemy('enemy_dummy'));
  assert.equal(h.snapshot().down, undefined);
  // PRTS 卫戍协议/帮助 "干员退场后…原地留下一个“倒地干员”…": a forced exit (史尔特尔's 余烬 …) lies down like a knock-out
  h.b.retreat(h.unit('t_a'), { reason: 'retreat' });
  h.b.kill(h.unit('t_c'));
  assert.deepEqual(h.snapshot().down.map((d) => d[0]), [h.unit('t_a').id, h.unit('t_c').id], 'the forced-out and the knocked-out operator');
  const ids = new Set(h.b.fieldMeta().units.map((u) => u.id));
  assert.ok(ids.has(h.unit('t_c').id) && ids.has(h.unit('t_a').id) && !ids.has(h.unit('t_b').id) && !ids.has(h.unit('t_d').id) && !ids.has(tok.id));
});

test('carryState.down (联防): deployed with everyone, forced out at once — down on its tile without the knock-out hooks — then back after its timer', () => {
  // PRTS 卫戍协议/帮助 §联防阶段: "部署完成后…上一阶段为退场状态的干员强制退场"
  const h = makeBattle({
    kind: 'unite', defs: { chess: { t_a: op('t_a'), t_b: op('t_b') } },
    units: [{ chessId: 't_a', row: 9, col: 5, carryState: { down: true } }, { chessId: 't_b', row: 10, col: 5, carryState: { hpPct: 0.5, sp: 0 } }],
    content: 'none', autoFinish: false, timeLimit: 120, flags: { dpInit: 0, dpPerSec: 1, dpMax: 99 },
  });
  h.step();
  const a = h.unit('t_a'), b = h.unit('t_b');
  assert.ok(!a.alive && h.b.isDown(a), 'down from the start');
  assert.equal(a.removeReason, FORCED_EXIT);
  assert.equal(a.hp, 0, 'HP 0 while down, like a knocked-out operator (the live detail card reads unit.hp)');
  assert.equal(unitStatsEntry(a).hp, 0);
  assert.deepEqual([a.tileR, a.tileC], [9, 5], 'on its own tile');
  const d = downOf(h, a.id);
  approx(d[1], 6, 0.011);
  approx(d[2], 6, 0.011);
  assert.equal(d[3], DOWN_STATE.COUNTING, 'its whole redeploy timer, counting');
  assert.ok(h.b.fieldMeta().units.some((u) => u.id === a.id), 'a client joining shows it down');
  assert.ok(b.alive && Math.abs(b.hp - 500) < 1e-6, 'the standing operator keeps its HP ratio');
  // deployed (deploy effects fire), then withdrawn before battleStart; no `kill`, no 'killed' death, no death counted
  const dep = h.hooksOf('deploy').find((x) => x.unit === a);
  assert.ok(dep && dep.initial === true, 'initial deploy hook');
  const deaths = h.hooksOf('death').filter((x) => x.unit === a);
  assert.deepEqual(deaths.map((x) => x.reason), [FORCED_EXIT]);
  assert.equal(h.hooksOf('kill').length, 0);
  assert.equal(h.hooksOf('battleStart').length, 1);
  assert.deepEqual(h.eventsOf('die').filter((e) => e[1] === a.id), [['die', a.id, FORCED_EXIT]]);
  assert.equal(h.b.result().perPlayer.p1.deaths, 0, 'not a new knock-out');
  h.run(6.5);
  assert.equal(downOf(h, a.id)[3], DOWN_STATE.WAIT_DP, 'timer done, DP short of its cost');
  h.run(6);
  assert.ok(a.alive && a.deployed, 'redeployed once DP ≥ cost');
  assert.deepEqual([a.tileR, a.tileC], [9, 5]);
  assert.equal(a.hp, a.s.maxHp, 'at full HP');
  assert.equal(downOf(h, a.id), null);
  // a later knock-out in the 联防 battle is an ordinary one
  h.b.kill(a);
  assert.equal(downOf(h, a.id)[3], DOWN_STATE.COUNTING);
  assert.equal(h.b.result().perPlayer.p1.deaths, 1);
});

test('carryState.down (联防): a redeploy-time effect that starts with the battle (机变 征召) covers the operator forced out', () => {
  // 征召 "开始作战时若场上至少有一行存在3名干员，所有干员的再部署时间-50%" is switched on by a battleStart handler, after
  // the forced exit: the forced-out operator's timer is re-read with it (6 → 3 s), like a later knock-out's
  const run = (card) => {
    const h = makeBattle({
      kind: 'unite', defs: { chess: { t_a: op('t_a'), t_b: op('t_b'), t_c: op('t_c'), t_d: op('t_d') } },
      players: [{
        playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, bandId: null,
        playerEffects: card ? [{ key: 'choice:allybuff_select_14', id: 'choice:allybuff_select_14#1', data: { effectId: 'allybuff_select_14' } }] : [],
        units: [
          { uid: 1, kind: 'chess', chessId: 't_a', row: 9, col: 5, dir: 'RIGHT', items: [], carryState: { down: true } },
          ...['t_b', 't_c', 't_d'].map((chessId, i) => ({ uid: 2 + i, kind: 'chess', chessId, row: 10, col: 4 + i, dir: 'RIGHT', items: [], carryState: { hpPct: 1, sp: 0 } })),
        ],
      }],
      autoFinish: false, timeLimit: 120,
    });
    h.step();
    const a = h.unit('t_a'), b = h.unit('t_b');
    const forced = downOf(h, a.id);
    h.b.kill(b);
    const later = downOf(h, b.id);
    return { forced: forced[2], forcedAt: forced[1], later: later[2] };
  };
  const off = run(false), on = run(true);
  approx(off.forced, 6, 0.011);
  approx(off.later, 6, 0.011);
  approx(on.forced, 3, 0.011);
  approx(on.forcedAt, 3, 0.011);
  approx(on.later, 3, 0.011);
});

test('elementView: the fullest gauge (ties: the official element order), its cooldown while bursting, nothing when empty', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0 }), enemy_lead: enemyRec({ key: 'enemy_lead', hp: 1e6, speed: 0, rank: 'BOSS' }) } },
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }, { key: 'enemy_lead', pos: [10, 8] }], content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_dummy'), L = h.enemy('enemy_lead');
  assert.equal(elementView(e, h.b.time), null);
  assert.equal(h.snapshot().elem, undefined, 'no `elem` key when nothing shows');
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 300 });
  h.b.dealDamage(null, e, { type: 'element', element: 'apoptosis', amount: 450 });
  assert.deepEqual(elementView(e, h.b.time), ['apoptosis', 0.45, 0, 0]);
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 150 });
  assert.deepEqual(elementView(e, h.b.time), ['burn', 0.45, 0, 0], 'a tie goes to the lower official id (灼燃 3 < 凋亡 4)');
  assert.deepEqual(ELEMENT_ORDER.slice(0, 4), ['neural', 'erosion', 'burn', 'apoptosis']);
  h.b.dealDamage(null, L, { type: 'element', element: 'neural', amount: 500 });
  assert.deepEqual(elementView(L, h.b.time), ['neural', 0.25, 0, 0], 'leaders hold 2000');
  const snap = h.snapshot();
  assert.deepEqual(snap.elem.map((x) => x[0]).sort(), [e.id, L.id].sort());
  // burst: the bursting element, full, with the cooldown's end and length
  h.b.dealDamage(null, e, { type: 'element', element: 'apoptosis', amount: 600 });
  const t = h.b.time;
  const v = elementView(e, t);
  assert.equal(v[0], 'apoptosis');
  assert.equal(v[1], 1);
  approx(v[2], Math.round((t + ELEMENT.apoptosis.enemy.duration) * 100) / 100, 0.011);
  assert.equal(v[3], ELEMENT.apoptosis.enemy.duration);
  h.run(5);
  approx(elementView(e, h.b.time)[2], v[2], 0.05);
  h.run(ELEMENT.apoptosis.enemy.duration - 4.9);
  assert.equal(elementView(e, h.b.time), null, 'every gauge reset after the cooldown');
  // a dead or hidden unit has no entry
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 100 });
  h.b.kill(e);
  assert.ok(!(h.snapshot().elem || []).some((x) => x[0] === e.id));
});
