// test/content/feedback4-egir-unite.test.js — 阿戈尔's battle-start devour in 联防 (GitHub #105, #140 comment 4; the
// owner's decision of 2026-10-05). PRTS 盟约记录 阿戈尔: "战斗开始时【阿戈尔】干员依次吞噬身前一格干员" — no own-side limit:
// the operator on the front tile is devoured whoever owns it, a teammate's living operator or a teammate's operator
// that entered 联防 knocked out (carry.down, forced out right after the deployment), and the marker gains its base ATK
// and block count exactly as in a solo battle. 联防 still adds no layers ("该阶段不能叠加层数"). The remake's two 联防
// helpers stand on board cols 3–9 and 11–17 (colOffset 8) with the road column 10 between them, so these fields put the
// teammate's operator on col 10 (a LOW tile the sim deploys on) to be in front. The last test runs the own-board case
// through unite.js's carry: a chain whose food is down since the own combat gives 联防 the gains of the own combat.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import { uniteBattleOpts } from '../../server/match/unite.js';
import { makeMatch } from '../match/harness.js';
import { FORCED_EXIT } from '../../server/sim/constants.js';

const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const bondOn = (count, layers = 0) => ({ count, active: count >= 3, tier: count >= 5 ? 2 : count >= 3 ? 1 : 0, layers });
const buffOf = (u, key) => u.buffs.find((b) => b.key === key) ?? null;
const devours = (h) => h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes('bond:egir:devour'));

const ULPIA = 'chess_char_5_05_a', GHOST = 'chess_char_2_07_a', GLADY = 'chess_char_4_12_a', DEEP = 'chess_char_1_04_a';
const HN = 'chess_char_3_09_a', MIZUKI = 'chess_char_4_09_a', FODDER = 'chess_char_1_01_a';

/** p1's 3 阿戈尔: 乌尔比安 on (10,9) facing right — its front tile is field (10,10) — and two facing empty tiles. */
const p1Units = () => [
  { uid: 1, kind: 'chess', chessId: ULPIA, row: 10, col: 9, dir: 'RIGHT' },
  { uid: 2, kind: 'chess', chessId: GLADY, row: 12, col: 3, dir: 'RIGHT' },
  { uid: 3, kind: 'chess', chessId: DEEP, row: 12, col: 5, dir: 'RIGHT' },
];
const player = (playerId, seat, colOffset, units, bonds) => ({ playerId, seat, side: 'L', colOffset, units, bonds, bandId: null, playerEffects: [] });

/**
 * A battle where `front` (chess ids, left to right) stands on field (10,10), (10,11) …: owned by p1 itself (`owner`
 * 'own', board cols 10, 11 …) or by the teammate p2 (`owner` 'mate', colOffset 8: board cols 2, 3 …).
 */
function field({ kind = 'unite', owner = 'own', front = [FODDER], extra = {}, p2Bonds = {}, p2Units = [] } = {}) {
  const lane = front.map((chessId, i) => ({ uid: 100 + i, kind: 'chess', chessId, row: 10, dir: 'RIGHT', ...(extra[i] || {}) }));
  const players = owner === 'own'
    ? [player('p1', 0, 0, [...p1Units(), ...lane.map((u, i) => ({ ...u, col: 10 + i }))], { egirShip: bondOn(3, 10) })]
    : [player('p1', 0, 0, p1Units(), { egirShip: bondOn(3, 10) }),
      player('p2', 1, 8, [...lane.map((u, i) => ({ ...u, col: 2 + i })), ...p2Units], p2Bonds)];
  const h = makeBattle({ kind, players, autoFinish: false, timeLimit: 60, hooks: ['damaged', 'death', 'deploy', 'kill', 'layerGain'], captureNoisy: true });
  h.step();
  return h;
}

test('联防: an 阿戈尔 devours a teammate\'s living operator in front — the same base ATK and block count as an own one, the 物理流失 lands, no layers', () => {
  const solo = field({ kind: 'normal' });
  const own = field();
  const mate = field({ owner: 'mate' });
  const ref = buffOf(solo.unit(1), 'bond:egir:devour');
  const fodderBase = solo.unit(100).base;
  assert.ok(ref, 'solo: 乌尔比安 devours the operator in front');
  close(ref.mods.atkFinal, fodderBase.atk, 1e-9, 'its base ATK');
  assert.equal(ref.mods.blockCnt, fodderBase.blockCnt, 'its block count');
  for (const [tag, h] of [['own', own], ['teammate\'s', mate]]) {
    const ulpia = h.unit(1), t = h.unit(100);
    assert.deepEqual(buffOf(ulpia, 'bond:egir:devour')?.mods, ref.mods, `${tag}: the solo gains`);
    close(ulpia.s.atk, own.unit(1).s.atk, 1e-6, `${tag}: 乌尔比安's ATK`);
    assert.equal(ulpia.s.blockCnt, solo.unit(1).s.blockCnt, `${tag}: the block count`);
    const d = devours(h);
    assert.deepEqual(d.map((c) => [c.credit.uid, c.target.uid]), [[1, 100]], `${tag}: one mark`);
    close(d[0].amount, devours(solo)[0].amount, 1e-6, `${tag}: the same 物理流失`);
    assert.equal(d[0].source, t, 'PRTS: physical HP loss comes from the victim itself');
    assert.equal(d[0].credit, ulpia, 'the devour mark owner receives the kill credit');
    assert.equal(d[0].dmg.type, 'phys', 'the instance retains its physical HP-loss type');
    assert.ok(!t.alive && h.hooksOf('kill').some((c) => c.victim === t && c.killer === ulpia), `${tag}: knocked out, credited to 乌尔比安`);
    assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 10, `${tag}: 联防 adds no layers`);
    assert.equal(h.hooksOf('layerGain').length, 0, `${tag}: no layer gain at all`);
    checkInvariants(h.b);
  }
  assert.equal(solo.b.getPlayer('p1').bonds.egirShip.layers, 10 + 1, 'solo: the devoured tier as layers');
  assert.equal(mate.unit(100).ownerId, 'p2');
});

test('联防: a teammate\'s operator that entered 联防 down is devoured as if it stood — the same gains, nothing lands on it, it stays forced out', () => {
  const up = field({ owner: 'mate' });
  const down = field({ owner: 'mate', extra: { 0: { carryState: { down: true } } } });
  const ownDown = field({ extra: { 0: { carryState: { down: true } } } });
  const t = down.unit(100);
  assert.ok(!t.alive && t.removeReason === FORCED_EXIT && down.b.isDown(t), 'the teammate\'s operator lies on (10,10), forced out');
  for (const [tag, h] of [['teammate\'s', down], ['own', ownDown]]) {
    assert.deepEqual(buffOf(h.unit(1), 'bond:egir:devour')?.mods, buffOf(up.unit(1), 'bond:egir:devour').mods, `${tag} down: the gains of the standing one`);
    assert.equal(devours(h).length, 0, `${tag} down: no 物理流失 on it`);
    assert.equal(h.hooksOf('death').filter((c) => c.unit === h.unit(100) && c.reason === 'killed').length, 0, `${tag} down: no knock-out`);
    assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 10, `${tag} down: no layers`);
    checkInvariants(h.b);
  }
});

test('联防: the chain goes on through a teammate\'s 阿戈尔 — the gains equal the same chain of own operators; its knock-out spends its owner\'s 5-tier slot', () => {
  const own = field({ front: [GHOST, FODDER] });
  // p2 holds 5 阿戈尔 (5-tier active): 幽灵鲨 in front of 乌尔比安, four more on its board facing empty tiles
  const p2Units = [HN, MIZUKI, GLADY, DEEP].map((chessId, i) => ({ uid: 200 + i, kind: 'chess', chessId, row: 12, col: 3 + 2 * i, dir: 'RIGHT' }));
  const mate = field({ owner: 'mate', front: [GHOST, FODDER], p2Units, p2Bonds: { egirShip: bondOn(5) } });
  const ref = buffOf(own.unit(1), 'bond:egir:devour');
  close(ref.mods.atkFinal, own.unit(100).base.atk + own.unit(101).base.atk, 1e-9, 'own chain: 幽灵鲨 and, through her, the fodder');
  assert.deepEqual(buffOf(mate.unit(1), 'bond:egir:devour')?.mods, ref.mods, 'the teammate\'s chain gives the same');
  assert.deepEqual(devours(mate).map((c) => [c.credit.uid, c.target.uid]), devours(own).map((c) => [c.credit.uid, c.target.uid]));
  const ghost = mate.unit(100);
  assert.equal(mate.hooksOf('death').filter((c) => c.unit === ghost && c.reason === 'killed').length, 1, '幽灵鲨 knocked out by p1\'s mark');
  assert.ok(ghost.alive && mate.hooksOf('deploy').some((c) => c.unit === ghost && !c.initial), 'p2\'s 5-tier revives her at once');
  assert.ok(!own.unit(100).alive, 'p1 has no 5-tier: its own 幽灵鲨 stays down');
  assert.equal(mate.b.getPlayer('p1').bonds.egirShip.layers, 10, 'no layers');
  checkInvariants(mate.b);
});

test('联防: a member a teammate\'s devour knocks out waits for every devour pass, then takes its owner\'s slot by position (community report, 2026-10-07; DESIGN §25.22.5)', () => {
  // p1's 乌尔比安 → p2's 幽灵鲨 (field 10,10) → p2's fodder (10,11); on p2's board 海霓 (12,3) → 水月 (12,4); p2 holds 5
  // 阿戈尔. p1's pass runs first (players' order): it knocks 幽灵鲨 out; p2's pass knocks 水月 out; then p2's revives —
  // 幽灵鲨 (field col 10) before 水月 (col 12). Until 0.2.0 she stood again right after p1's mark, before p2's pass.
  const seq = [];
  const p2Units = [
    { uid: 200, kind: 'chess', chessId: HN, row: 12, col: 3, dir: 'RIGHT' }, { uid: 201, kind: 'chess', chessId: MIZUKI, row: 12, col: 4, dir: 'RIGHT' },
    { uid: 202, kind: 'chess', chessId: GLADY, row: 12, col: 7, dir: 'RIGHT' }, { uid: 203, kind: 'chess', chessId: DEEP, row: 12, col: 9, dir: 'RIGHT' },
  ];
  const lane = [GHOST, FODDER].map((chessId, i) => ({ uid: 100 + i, kind: 'chess', chessId, row: 10, col: 2 + i, dir: 'RIGHT' }));
  const h = makeBattle({
    kind: 'unite', autoFinish: false, timeLimit: 60, hooks: ['death', 'deploy'],
    players: [player('p1', 0, 0, p1Units(), { egirShip: bondOn(3, 10) }), player('p2', 1, 8, [...lane, ...p2Units], { egirShip: bondOn(5) })],
    setup: (b) => {
      b.on('damaged', (c) => { if (c.dmg?.tags?.includes('bond:egir:devour')) seq.push(`mark ${c.credit.uid}→${c.target.uid}`); }, { priority: -1000 });
      b.on('deploy', (c) => { if (!c.initial) seq.push(`revive ${c.unit.uid}`); }, { priority: -1000 });
    },
  });
  h.step();
  assert.deepEqual(seq, ['mark 1→100', 'mark 1→101', 'mark 200→201', 'revive 100', 'revive 201']);
  assert.ok(h.unit(100).alive && h.unit(201).alive, 'both stand again, on p2\'s slots');
  assert.equal(h.eventsOf('fx').filter((x) => x[1] === 'revive' && x[4]?.src === 'bond:egirShip').length, 2);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// the own board through unite.js: a chain whose food is down since the own combat

let gdCache = null;
const gd = () => (gdCache ??= makeMatch({ mode: 'coop', humans: 3, seed: 1, fake: true }).start().m.gd);

test('联防 through unite.js: food knocked out by the own combat\'s devour enters down, and 乌尔比安 gets exactly the own combat\'s base ATK and block count', () => {
  // 乌尔比安 → 幽灵鲨 → 歌蕾蒂娅 → fodder on row 10 (3 阿戈尔: no revive), 30 s own combat
  const ids = [ULPIA, GHOST, GLADY, FODDER];
  const units = ids.map((chessId, i) => ({ uid: i + 1, kind: 'chess', chessId, row: 10, col: 3 + i, dir: 'RIGHT', items: [] }));
  const bonds = { egirShip: bondOn(3, 10) };
  const own = makeBattle({ players: [player('p1', 0, 0, units, bonds)], autoFinish: false, timeLimit: 30 });
  own.runToEnd(60);
  const gain = buffOf(own.unit(1), 'bond:egir:devour').mods;
  const unitsEnd = own.result().perPlayer.p1.unitsEnd;
  assert.deepEqual(unitsEnd.filter((u) => !u.alive).map((u) => u.uid).sort(), [2, 3, 4], 'the food is down at the end');
  // the helper's 联防 input as unite.js builds it from that result
  const ps = {
    playerId: 'p1', seat: 0,
    board: new Map(units.map((u) => [`${u.row},${u.col}`, { uid: u.uid, kind: 'chess' }])),
    battleInput: ({ side, colOffset, carry }) => ({
      ...player('p1', 0, colOffset, units.map((u) => ({ ...u, ...(carry.has(u.uid) ? { carryState: carry.get(u.uid) } : {}) })), bonds), side,
    }),
  };
  const m = { gd: gd(), round: 3, lastResults: new Map([['p1', { unitsEnd }]]), dispatch() {} };
  const { players } = uniteBattleOpts(m, { helpers: [ps], leaked: [] }, 60);
  assert.deepEqual(players[0].units.filter((u) => u.carryState?.down).map((u) => u.uid), [2, 3, 4]);
  const u = makeBattle({ kind: 'unite', players, autoFinish: false, timeLimit: 60 });
  u.step();
  const ulpia = u.unit(1);
  assert.deepEqual(buffOf(ulpia, 'bond:egir:devour')?.mods, gain, 'the own combat\'s gains');
  close(gain.atkFinal, [2, 3, 4].reduce((s, uid) => s + u.unit(uid).base.atk, 0), 1e-9, '幽灵鲨 + 歌蕾蒂娅 + fodder base ATK');
  assert.equal(gain.blockCnt, [2, 3, 4].reduce((s, uid) => s + u.unit(uid).base.blockCnt, 0));
  for (const uid of [2, 3, 4]) assert.ok(!u.unit(uid).alive && u.unit(uid).removeReason === FORCED_EXIT, `${uid} forced out`);
  assert.equal(u.b.getPlayer('p1').bonds.egirShip.layers, 10, 'no layers in 联防');
  checkInvariants(u.b);
});
