import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { makeMatch } from '../match/harness.js';
import { uniteBattleOpts } from '../../server/match/unite.js';

const egir = (layers = 0, count = 5) => ({ count, active: true, tier: count >= 5 ? 2 : 1, layers });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const defs = { chess: Object.fromEntries([['A', 10000], ['B', 7000], ['C', 20000], ['D', 10000], ['E', 10000]]
  .map(([id, maxHp]) => [id, chessRec({ id, bonds: ['egirShip'], stats: { atk: 100, def: 0, maxHp, blockCnt: 1 },
    skill: { spCost: 30, initSp: 5, duration: 10 } })])) };
const units = [['A', 10, 3], ['B', 10, 4], ['C', 10, 5], ['D', 12, 3], ['E', 12, 5]]
  .map(([chessId, row, col], i) => ({ uid: i + 1, kind: 'chess', chessId, row, col, dir: 'RIGHT' }));

function carryInput(t, own, lineup, bonds) {
  const m = makeMatch({ mode: 'coop', humans: 3, fake: true }).m;
  t.after(() => m.dispose());
  const unitsEnd = own.result().perPlayer.p1.unitsEnd;
  const ps = { playerId: 'p1', board: new Map(lineup.map(u => [u.uid, { uid: u.uid, kind: 'chess' }])),
    battleInput: ({ side, colOffset, carry }) => ({ playerId: 'p1', seat: 0, side, colOffset, bonds,
      units: lineup.map(u => ({ ...u, carryState: carry.get(u.uid) })) }) };
  const { players } = uniteBattleOpts({ gd: m.gd, round: 3, lastResults: new Map([['p1', { unitsEnd }]]), dispatch() {} },
    { helpers: [ps], leaked: [] }, 60);
  return { players, unitsEnd };
}

test('normal result → unite rebuilds Egir attributes but preserves every living HP ratio and SP', t => {
  const own = makeBattle({ defs, units, bonds: { egirShip: egir() }, autoFinish: false });
  own.step(2); own.b.forceEnd();
  const { players, unitsEnd } = carryInput(t, own, units, { egirShip: egir(own.b.getPlayer('p1').bonds.egirShip.layers) });
  const next = makeBattle({ kind: 'unite', defs, players, autoFinish: false }); next.b.start();
  for (const old of unitsEnd) {
    const u = next.unit(old.uid);
    assert.equal(u.alive, old.alive);
    close(u.hpRatio, old.hpPct); close(u.skill.spTotal, old.sp);
    assert.deepEqual(u.findBuff('bond:egir:devour')?.mods, own.unit(old.uid).findBuff('bond:egir:devour')?.mods);
  }
  assert.equal(next.b.result().perPlayer.p1.deaths, 0);
  assert.deepEqual(next.b.result().perPlayer.p1.layerGains, {});
  checkInvariants(next.b);
});

test('a previous full-health survivor cannot be newly killed by opening devour during carry restoration', t => {
  const weak = { chess: { ...defs.chess, B: { ...defs.chess.B, stats: { ...defs.chess.B.stats, maxHp: 2000 } } } };
  const three = units.slice(0, 3).map(u => u.uid === 3 ? { ...u, row: 12, col: 7 } : u);
  const own = makeBattle({ defs: weak, units: three, bonds: { egirShip: egir(0, 3) }, autoFinish: false, timeLimit: 120 });
  own.run(80); own.b.forceEnd();
  assert.equal(own.unit(2).hpRatio, 1, 'food redeployed before its old battle ended');
  const { players } = carryInput(t, own, three, { egirShip: egir(own.b.getPlayer('p1').bonds.egirShip.layers, 3) });
  const next = makeBattle({ kind: 'unite', defs: weak, players, autoFinish: false }); next.b.start();
  assert.equal(next.unit(2).alive, true); assert.equal(next.unit(2).hpRatio, 1);
  assert.equal(next.b.result().perPlayer.p1.deaths, 0);
  close(next.unit(1).findBuff('bond:egir:devour').mods.atkFinal, 100);
});

test('forced-down carry still contributes devour attributes and spends one of the three revives at the 协防 start', () => {
  const lineup = units.map(u => ({ ...u, carryState: u.uid === 2 ? { down: true } : { hpPct: 0.4, sp: 17 } }));
  const next = makeBattle({ kind: 'unite', defs, players: [{ playerId: 'p1', units: lineup, bonds: { egirShip: egir() } }], autoFinish: false, hooks: ['deploy'] });
  next.b.start();
  const down = next.unit(2);
  assert.equal(down.alive, true, 'the down member is revived on the battle-start scan');
  assert.equal(next.b.isDown(down), false);
  close(down.hp, down.s.maxHp);
  assert.ok(next.hooksOf('deploy').some((c) => c.unit === down && !c.initial));
  close(next.unit(1).findBuff('bond:egir:devour').mods.atkFinal, 200);
  // one slot already spent: the next two knock-outs revive, the two after that stay down
  const survived = [];
  for (const uid of [4, 5, 1, 3]) { next.b.loseHp(next.unit(uid), 1e9); survived.push(next.unit(uid).alive); }
  assert.deepEqual(survived, [true, true, false, false]);
  next.b.loseHp(down, 1e9);
  assert.equal(down.alive, false, 'its first knock-out of this battle was the 协防 entry');
  checkInvariants(next.b);
});

test('carry preserves positive ratios below 1% and fractional HP when the new max HP is smaller', t => {
  const lineup = [{ ...units[0], dir: 'UP' }];
  const own = makeBattle({ defs, units: lineup, bonds: { egirShip: egir() }, autoFinish: false });
  own.b.start(); own.unit(1).hp = 1; own.b.forceEnd();
  const { players, unitsEnd } = carryInput(t, own, lineup, {});
  close(players[0].units[0].carryState.hpPct, unitsEnd[0].hpPct);
  const small = { chess: { A: { ...defs.chess.A, stats: { ...defs.chess.A.stats, maxHp: 1000 } } } };
  const next = makeBattle({ kind: 'unite', defs: small, players, autoFinish: false }); next.b.start();
  assert.ok(next.unit(1).alive && next.unit(1).hp > 0 && next.unit(1).hp < 1);
  close(next.unit(1).hpRatio, unitsEnd[0].hpPct);
});

test('ordinary/boss devour and fresh unite units still receive opening devour damage', () => {
  for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
    const h = makeBattle({ kind, defs, units, bonds: { egirShip: egir() }, autoFinish: false }); h.b.start();
    assert.ok(h.unit(2).hpRatio < 0.5, kind);
    assert.ok(h.unit(3).hpRatio < 0.7, kind);
    checkInvariants(h.b);
  }
});
