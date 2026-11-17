import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, checkInvariants } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds } from '../../server/match/bondsMeta.js';

function emptyPrep() {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 11, fake: true }).start().toPrep(1);
  const p = h.ps('p_0');
  for (const x of p.allChess()) p.returnCopies(x);
  p.board.clear(); p.hand.fill(null); p.temp.fill(null); p.offers.length = 0; p.bandId = null; p.recompute();
  return { h, m: h.m, p };
}

for (const g of Object.values(DATA.garrisons).filter(g => g.effectKey === 'SERVER_GAIN_EQUIP')) {
  for (const owner of g.owners) test(`fixed gift ${g.garrisonId}/${owner} is produced past stock and still occupies it`, () => {
    const { m, p } = emptyPrep(), id = g.bbStr.chess, cap = m.itemPool.cap(id);
    assert.ok(Number.isInteger(cap));
    for (let i = 0; i < cap; i++) assert.ok(p.acquireItem(id));
    assert.equal(m.itemPool.left(id), 0);
    assert.ok(p.acquireChess(owner, { fromPool: false }));
    assert.equal(m.itemPool.held(id), cap + g.bb.count, 'the trait must finish all grants, including merges');
    assert.equal(m.itemPool.left(id), 0, 'overstock prevents new shop draws');
    assert.equal(p.acquireItem(id), null, 'an ordinary stock-backed grant is still refused');
    checkInvariants(m); m.dispose();
  });
}

test('unlimited fixed-item gifts do not exempt unrelated strategy equipment from stock', () => {
  const { m, p } = emptyPrep(), id = 'chess_item_5_07_e_a';
  assert.ok(p.acquireItem(id)); assert.ok(p.acquireItem(id));
  assert.equal(p.acquireItem(id, { requirePool: false }), null, 'commercial packaging is not a fixed operator gift');
  assert.equal(m.itemPool.held(id), 2); checkInvariants(m); m.dispose();
});

for (const invest of [false, true]) test(`repeated Muelsyse acquisition and elite gifts remain unlimited (investor=${invest})`, () => {
  const { m, p } = emptyPrep(), id = 'chess_item_6_09_e_a';
  if (invest) {
    const members = Object.values(DATA.chess).filter(c => c.visible && !c.isGolden && c.bonds.includes('investShip')).slice(0, 3);
    for (const c of members) give(m, p, c.chessId);
  }
  assert.equal(m.dispatcher.investRepeat(p), invest ? 2 : 1);
  const expected = invest ? [2, 4, 8, 10, 12] : [1, 2, 4, 5, 6];
  for (const n of expected) {
    assert.ok(p.acquireChess('chess_char_6_11_a'));
    assert.equal(m.itemPool.held(id), n); checkInvariants(m);
    // Stow the non-merging isomorphs on holders so this stock test does not exhaust the player's inventory.
    for (const item of [...p.hand, ...p.temp].filter(x => x?.kind === 'item')) {
      const holder = p.allChess().find(c => c.items.length < m.gd.equipPerChess);
      if (holder) assert.ok(p.equip(item.uid, holder.uid).ok);
    }
  }
  m.dispose();
});

test('Damazti strategy grants its fixed item at rounds 5/10/15 past cap; releasing overflow does not free stock early', () => {
  const { m, p } = emptyPrep(), id = 'chess_item_6_09_e_a';
  for (let i = 0; i < 3; i++) assert.ok(p.acquireItem(id));
  p.bandId = 'band_damaztic'; p.recompute();
  for (const [i, round] of [5, 10, 15].entries()) {
    m.round = round; m.dispatch(p, 'onPrepStart', { round });
    assert.equal(m.itemPool.held(id), 4 + i); checkInvariants(m);
  }
  const copy = () => [...p.hand, ...p.temp].find(x => x?.kind === 'item' && x.id === id);
  for (let i = 0; i < 3; i++) { assert.ok(p.destroy(copy().uid).ok); assert.equal(m.itemPool.left(id), 0); }
  assert.ok(p.destroy(copy().uid).ok);
  assert.equal(m.itemPool.held(id), 2); assert.equal(m.itemPool.left(id), 1);
  checkInvariants(m); m.dispose();
});

for (const mu of ['chess_char_6_11_a', 'chess_char_6_11_b']) test(`seven distinct Yan operators plus Yan-converted ${mu} activate nine Yan`, () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  const seven = Object.values(DATA.chess).filter(c => c.visible && !c.isGolden && c.bonds.includes('yanShip')).slice(0, 7);
  assert.equal(seven.length, 7);
  const pieces = seven.map((c, i) => ({ uid: i + 1, kind: 'chess', id: c.chessId, items: [] }));
  pieces.push({ uid: 8, kind: 'chess', id: mu, items: [{ id: 'chess_item_6_09_e_a' }, { id: 'chess_item_3_04_e_a' }] });
  const state = { board: new Map(pieces.map((p, i) => [`${9 + i % 4},${3 + Math.floor(i / 4)}`, p])), hand: [], layers: {} };
  const b = computeBonds(gd, state);
  assert.equal(b.yanShip.count, 9); assert.equal(b.yanShip.tier, 3); assert.equal(b.yanShip.harmony, 1);
  pieces[7].items.pop();
  const withoutConversion = computeBonds(gd, state);
  assert.equal(withoutConversion.yanShip.count, 8); assert.equal(withoutConversion.yanShip.tier, 2);
});
