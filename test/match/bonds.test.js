// Bond counting modes, tiers, 调和, 独行, 绝技, 助力, layers (DESIGN §6.3, research 02 §2.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds, tierFor, activatedLayers, bondList, thresholdsOf } from '../../server/match/bondsMeta.js';
import { DATA } from './harness.js';

const gd = new GameData(DATA, 'mode_multi_normal');
let uid = 1;
const piece = (id, items = []) => ({ uid: uid++, kind: 'chess', id, items: items.map((i) => ({ uid: uid++, kind: 'item', id: i })) });
const state = ({ board = [], hand = [], layers = {} } = {}) => {
  const b = new Map();
  board.forEach((p, i) => b.set(`${9 + (i % 4)},${2 + Math.floor(i / 4)}`, p));
  const h = new Array(10).fill(null);
  hand.forEach((p, i) => { h[9 - i] = p; });
  return { board: b, hand: h, layers };
};
const members = (bond, n, extra = () => true) => Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.bonds.includes(bond) && extra(c)).slice(0, n).map((c) => c.chessId);

test('BOARD: distinct base chess on the board; normal + elite of one operator count once; the hand does not count', () => {
  const [a, b, c] = members('yanShip', 3, (x) => x.bonds.length === 1 || true);
  let s = computeBonds(gd, state({ board: [piece(a), piece(b)], hand: [piece(c)] }));
  assert.equal(s.yanShip.count, 2);
  assert.equal(s.yanShip.active, false);
  s = computeBonds(gd, state({ board: [piece(a), piece(b), piece(c)] }));
  assert.equal(s.yanShip.count, 3);
  assert.equal(s.yanShip.tier, 1);
  assert.equal(s.yanShip.active, true);
  s = computeBonds(gd, state({ board: [piece(a), piece(DATA.chess[a].goldenId), piece(b)] }));
  assert.equal(s.yanShip.count, 2, 'normal + elite of one operator = 1');
  const six = members('yanShip', 6);
  s = computeBonds(gd, state({ board: six.map((x) => piece(x)) }));
  assert.equal(s.yanShip.tier, 2);
  assert.deepEqual(thresholdsOf(DATA.bonds.yanShip), [3, 6, 9]);
});

test('BOARD_AND_DECK (远见/奇迹/投资人) also counts the hand', () => {
  const [a, b] = members('visiShip', 2);
  const s = computeBonds(gd, state({ board: [piece(a)], hand: [piece(b)] }));
  assert.equal(s.visiShip.count, 2);
  assert.equal(s.visiShip.active, true);
  const v = bondList(gd, s, { full: true }).find((x) => x.bondId === 'visiShip');
  assert.equal(v.countsHand, true);
});

test('绝技 (BOARD_ALL_CHESS): every elite on the board, duplicates included', () => {
  const g = Object.values(DATA.chess).filter((c) => c.visible && c.isGolden !== true).slice(0, 5).map((c) => c.goldenId);
  let s = computeBonds(gd, state({ board: [piece(g[0]), piece(g[0])] }));
  assert.equal(s.suntShip.count, 2);
  assert.equal(s.suntShip.active, true);
  s = computeBonds(gd, state({ board: g.map((x) => piece(x)) }));
  assert.equal(s.suntShip.tier, 2);
  s = computeBonds(gd, state({ hand: [piece(g[0]), piece(g[1])] }));
  assert.equal(s.suntShip.count, 0, 'hand elites do not count');
});

test('调和: +1 to core bonds with ≥ 1 real member on the board while active', () => {
  const mani = members('maniShip', 1)[0];
  assert.ok(mani, 'a visible 调和 chess exists');
  const yan = members('yanShip', 2, (c) => !c.bonds.includes('maniShip'));
  let s = computeBonds(gd, state({ board: [piece(mani), ...yan.map((x) => piece(x))] }));
  assert.equal(s.maniShip.active, true);
  assert.equal(s.yanShip.count, 3, '2 real + 1');
  assert.equal(s.yanShip.active, true);
  const noMember = s.sargonShip ? s.sargonShip.count : 0;
  assert.equal(noMember, members('sargonShip', 99).includes(mani) ? 1 : 0, 'no +1 without a real member');
  s = computeBonds(gd, state({ board: yan.map((x) => piece(x)) }));
  assert.equal(s.yanShip.count, 2);
});

test('独行 (downward): active only while exactly 1 distinct 独行 operator is on the board', () => {
  const solo = members('soloShip', 2);
  assert.equal(tierFor(DATA.bonds.soloShip, 1), 1);
  assert.equal(tierFor(DATA.bonds.soloShip, 2), 0);
  assert.equal(tierFor(DATA.bonds.soloShip, 0), 0);
  let s = computeBonds(gd, state({ board: [piece(solo[0])] }));
  assert.equal(s.soloShip.active, true);
  s = computeBonds(gd, state({ board: [piece(solo[0]), piece(DATA.chess[solo[0]].goldenId)] }));
  assert.equal(s.soloShip.active, true, 'two copies of the same operator do not break it');
  s = computeBonds(gd, state({ board: [piece(solo[0]), piece(solo[1])] }));
  assert.equal(s.soloShip.active, false);
});

test('助力: upper tier counts operators differing in name OR elite state', () => {
  const d = members('deputShip', 2);
  let s = computeBonds(gd, state({ board: [piece(d[0]), piece(d[1])] }));
  assert.equal(s.deputShip.tier, 1);
  s = computeBonds(gd, state({ board: [piece(d[0]), piece(d[1]), piece(DATA.chess[d[1]].goldenId)] }));
  assert.equal(s.deputShip.count, 2);
  assert.equal(s.deputShip.tier, 2, 'normal + elite count as different for the 3-member tier');
});

test('layers persist on every bond; Σ activated layers only counts active bonds; FUNNY inactive bonds omitted', () => {
  const [a, b, c] = members('yanShip', 3);
  const s = computeBonds(gd, state({ board: [piece(a), piece(b), piece(c)], layers: { yanShip: 40, egirShip: 100 } }));
  assert.equal(s.yanShip.layers, 40);
  assert.equal(s.egirShip.layers, 100);
  assert.equal(activatedLayers(s), 40);
  const list = bondList(gd, s);
  assert.equal(list[0].bondId, 'yanShip', 'active first');
  assert.ok(list.some((x) => x.bondId === 'egirShip' && !x.active), 'inactive bonds with layers are listed');
  const funny = new GameData(DATA, 'mode_multi_funny');
  const f = computeBonds(funny, state({ board: [piece(a)] }));
  for (const off of DATA.config.modes.mode_multi_funny.inactiveBondIds) assert.ok(!(off in f), `${off} omitted in FUNNY`);
});
