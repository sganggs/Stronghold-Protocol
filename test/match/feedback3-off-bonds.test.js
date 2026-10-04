// Mode-off bonds stay out of the battle (computeBonds) and show in the views when the player has members
// (offBondCounts → bondList `off: true`, the strip's grey 本局禁用 discs). 标准模拟's inactiveBondIdList
// (activity_table mode_single_funny): 投资人 and 奇迹 count the hand (BOARD_AND_DECK); 突袭 counts the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds, bondList, bondSnapshot, offBondCounts } from '../../server/match/bondsMeta.js';
import { DATA } from './harness.js';

const funny = new GameData(DATA, 'mode_single_funny');
const open = new GameData(DATA, 'mode_multi_normal');
let uid = 1;
const piece = (id) => ({ uid: uid++, kind: 'chess', id, items: [] });
const state = ({ board = [], hand = [], layers = {}, bondCountBonus } = {}) => {
  const b = new Map();
  board.forEach((p, i) => b.set(`${9 + (i % 4)},${2 + Math.floor(i / 4)}`, p));
  const h = new Array(10).fill(null);
  hand.forEach((p, i) => { h[9 - i] = p; });
  return { board: b, hand: h, layers, bondCountBonus };
};
const members = (bond, n) => Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && c.bonds.includes(bond))
  .slice(0, n)
  .map((c) => c.chessId);

const INVESTOR = members('investShip', 2);
const RAIDER = members('raidShip', 1);
const YAN = members('yanShip', 1);

test('标准模拟: an 投资人 member in hand and a 突袭 member on the board are off entries, never in computeBonds', () => {
  assert.equal(INVESTOR.length, 2);
  assert.equal(RAIDER.length, 1);
  const ps = state({
    board: [piece(RAIDER[0]), piece(YAN[0])],
    hand: [piece(INVESTOR[0])],
    layers: { investShip: 12, raidShip: 4, lateranoShip: 9 },
  });
  const bonds = computeBonds(funny, ps);
  assert.ok(!('investShip' in bonds), '投资人 stays out of the battle input');
  assert.ok(!('raidShip' in bonds), '突袭 stays out of the battle input');
  assert.ok(!('lateranoShip' in bonds));
  assert.equal(bondSnapshot(bonds).investShip, undefined);
  assert.ok(bonds.yanShip, 'an enabled bond is unchanged');

  const off = offBondCounts(funny, ps);
  assert.equal(off.investShip.count, 1, 'a hand member counts for 投资人');
  assert.equal(off.investShip.layers, 12);
  assert.equal(off.raidShip.count, 1);
  assert.equal(off.raidShip.layers, 4);
  assert.ok(!('lateranoShip' in off), 'an inactive bond with zero members is omitted, layers or not');

  const list = bondList(funny, bonds, { full: true, off });
  const invest = list.find((x) => x.bondId === 'investShip');
  const raid = list.find((x) => x.bondId === 'raidShip');
  assert.deepEqual(
    { count: invest.count, active: invest.active, tier: invest.tier, layers: invest.layers, off: invest.off, countsHand: invest.countsHand },
    { count: 1, active: false, tier: 0, layers: 12, off: true, countsHand: true },
  );
  assert.equal(raid.off, true);
  assert.equal(raid.active, false);
  assert.equal(raid.tier, 0);
  assert.equal(raid.countsHand, false);
  assert.ok(list.findIndex((x) => x.off) > list.findIndex((x) => x.bondId === 'yanShip'), 'off entries follow the live bonds');
  assert.ok(list.slice(list.findIndex((x) => x.off)).every((x) => x.off), 'the off entries are a suffix');
  const pub = bondList(funny, bonds, { off });
  assert.equal(pub.find((x) => x.bondId === 'investShip').off, true);
  assert.equal('countsHand' in pub.find((x) => x.bondId === 'investShip'), false, 'm.public omits countsHand');
});

test('a BOARD_AND_DECK off bond counts the hand, not the temporary slots, and not twice', () => {
  const [a, b] = INVESTOR;
  const handOnly = offBondCounts(funny, state({ hand: [piece(a), piece(b)] }));
  assert.equal(handOnly.investShip.count, 2);
  assert.ok(!('raidShip' in (handOnly || {})), '突袭 in nobody\'s hand: a board bond with no board member is omitted');
  const raidHand = offBondCounts(funny, state({ hand: [piece(RAIDER[0])] }));
  assert.equal(raidHand, null, '突袭 does not count a hand member');
  const both = offBondCounts(funny, state({ board: [piece(a)], hand: [piece(a), piece(DATA.chess[a].goldenId)] }));
  assert.equal(both.investShip.count, 1, 'normal and elite of one operator, board and hand, count once');
  const tempOnly = { board: new Map(), hand: new Array(10).fill(null), layers: {}, temp: [piece(a)] };
  assert.equal(offBondCounts(funny, tempOnly), null, 'the 5 temporary slots never count');
});

test('a mode with an empty inactive set returns null, and those bonds stay in computeBonds', () => {
  assert.equal(open.modeInactiveBonds.size, 0);
  const ps = state({ board: [piece(RAIDER[0])], hand: [piece(INVESTOR[0])] });
  assert.equal(offBondCounts(open, ps), null);
  const bonds = computeBonds(open, ps);
  assert.equal(bonds.investShip.count, 1);
  assert.equal(bonds.raidShip.count, 1);
  assert.equal(bondList(open, bonds).some((x) => x.off), false);
});
