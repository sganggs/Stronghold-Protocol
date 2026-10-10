// test/match/feedback5-we2-diy-grants.test.js — 0.2.0 WE2 #9: an effect / reward / 机变 card that grants a player a random
// operator draws that player's 自选 stock too (「自选干员放入后模拟中的补给池随机范围也将被相应扩大」; PRTS 新手教程 "调度中心随机资源
// 的范围将被扩大"): effectsMeta ctx.rollChess / ctx.rollPool (player/diy.js diyStockEntries), choices.js 驰援 fallback —
// the roll's own tier rules, bonds through the player's view; never another player's stock.
// Run: node --test test/match/feedback5-we2-diy-grants.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { applyCard, tacticCard } from '../../server/match/choices.js';
import { makeMatch, checkInvariants } from './harness.js';

const T5A = 'chess_char_5_diy1_a';
const SIEGE = 'char_112_siege'; // 推进之王 (维多利亚)
const PICK = { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' };

/** A co-op match: p_0 slots 推进之王 at T5A, p_1 slots nothing; first prep. */
function prep(seed = 911) {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T5A]: PICK } },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true },
  ];
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed }).start();
  h.toPrep(1);
  return { h, m: h.m, p0: h.ps('p_0'), p1: h.ps('p_1') };
}
/** Take every shared-pool copy of the chess `pred` admits (the draw then sees only what is left); m.restore() gives them back. */
function drain(m, pred) {
  const back = (m.drained ??= []);
  for (const [id, e] of m.pool.entries) if (pred(id, e) && e.left > 0) back.push([id, m.pool.take(id, e.left)]);
  m.restore = () => { for (const [id, n] of back.splice(0)) m.pool.give(id, n); };
}

test('#9 effect rolls (ctx.rollChess, any tier / bond filter) draw the player\'s 自选 stock — its own player only', () => {
  const { m, p0, p1 } = prep();
  assert.equal(p0.diyStock.left(T5A), 16, 'tier-5 cap 8 × the co-op scale 2 (GitHub #430)');
  drain(m, (id, e) => e.tier === 5);
  const c0 = makeCtx(m, p0, { key: 'test' }, 'onTest');
  const c1 = makeCtx(m, p1, { key: 'test' }, 'onTest');
  assert.equal(c0.rollChess({ tier: 5 }), T5A, 'the only tier-5 copies left: her stock');
  assert.equal(c1.rollChess({ tier: 5 }), null, 'another player never draws it');
  // the 调度中心 level is not the shop's gate here: an effect's tier rule alone (p_0 is at level 1)
  assert.ok(p0.shop.level < 5);
  // a bond filter reads the operator: 推进之王 is 维多利亚
  drain(m, (id) => (m.gd.chess(id)?.bonds || []).includes('victoriaShip'));
  assert.equal(c0.rollChess({ bond: 'victoriaShip' }), T5A);
  assert.equal(c0.rollChess({ bond: 'yanShip', tier: 5 }), null, 'not a 炎 operator');
  // granting it takes one copy of her own stock
  assert.ok(c0.grantChess(T5A));
  assert.equal(p0.diyStock.left(T5A), 15);
  m.restore();
  checkInvariants(m);
  m.dispose();
});

test('#9 reward pools (ctx.rollPool: a shared-pool chess pool) and the 维多利亚驰援 card draw it too', () => {
  const { m, p0, p1 } = prep(910);
  drain(m, (id, e) => e.tier === 5);
  const c0 = makeCtx(m, p0, { key: 'test' }, 'onTest');
  const c1 = makeCtx(m, p1, { key: 'test' }, 'onTest');
  assert.deepEqual(c0.rollPool('pool_chess_shop_5_reward'), { kind: 'chess', id: T5A, golden: false });
  assert.equal(c1.rollPool('pool_chess_shop_5_reward'), null);
  // 维多利亚驰援 (allybuff_select_7_7, single_special_choice_gain_bond_chess) with every 维多利亚 copy of the pool taken:
  // the card grants her 推进之王 from her own stock
  drain(m, (id) => (m.gd.chess(id)?.bonds || []).includes('victoriaShip'));
  const card = tacticCard(m.gd.choices.cards.tactic.find((c) => c.effectId === 'allybuff_select_7_7'));
  const owned = (ps) => [...ps.board.values(), ...ps.hand, ...ps.temp].filter((x) => x && x.kind === 'chess' && x.id === T5A).length;
  const before = p0.diyStock.left(T5A);
  applyCard(m, p0, card);
  assert.equal(owned(p0), 1, 'she got her 自选 piece');
  assert.equal(p0.diyStock.left(T5A), before - 1, 'from her stock');
  const had1 = [...p1.hand, ...p1.temp].filter(Boolean).length;
  applyCard(m, p1, card);
  assert.equal([...p1.hand, ...p1.temp].filter(Boolean).length, had1, 'p_1 has no 自选 piece to draw: nothing');
  m.restore();
  checkInvariants(m);
  m.dispose();
});
