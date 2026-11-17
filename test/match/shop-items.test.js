// §37.41 shop items and 9 炎 (round55; the maintainer 2026-10-29: 「前期精打细算玩偶以及全时期的见钱眼开玩偶也都是非常不错的道具」,
// 「大炎盟约缪尔赛斯转炎可以做到8人口9大炎」, then 「发，继续做」): despite §37.39 the bot buys the two items that make an elite
// (博士投影 for a deployed normal operator of tier ≥ 4 before the Final Assault prep, 拟态物质 for a normal pair of tier ≥ 4
// whose pool still holds copies), the two dolls in solo (destroyed at once), and — for a focus whose top tier exceeds the deploy
// cap — one bond item it holds for 缪尔赛思's 变形同构体; the focus choice carries a prior from the bots' own results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botPrepBegin, equipItems, buyScoreOf, bondPlan } from '../../server/match/bot.js';
import { makeMatch, give, giveItem, legalTileFor, DATA } from './harness.js';

const PROMO = 'chess_item_5_06_e_a'; // 博士投影
const MIMIC = 'chess_item_5_05_e_a'; // 拟态物质
const SAVE = 'chess_item_2_05_e_a'; // 精打细算玩偶
const EYE = 'chess_item_2_07_e_a'; // 见钱眼开玩偶
const DAGGER = 'chess_item_3_04_e_a'; // 炎国短刀 (gives 炎 with a 变形同构体)
const SUIT = 'chess_item_3_01_e_a'; // 叙拉古正装
const MORPH = 'chess_item_6_09_e_a'; // 变形同构体
const MLYSS = 'chess_char_6_11_a'; // 缪尔赛思 (调和)
const bots = [{ seat: 0, playerId: 'ai_0', name: 'AI-1', isBot: true, connected: true }];

function setup(t, round = 9) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seed: 5, seats: bots }).start().toPrep();
  t.after(() => h.dispose?.());
  const m = h.m, ps = m.order[0];
  ps.hand.fill(null);
  ps.board.clear();
  ps.bandId = 'band_sarkazb'; // 歌利亚: no strategy bond
  delete ps._botFocus;
  delete ps._botFocusId;
  m.round = round;
  ps.shop.level = 5;
  ps.shop.upgradePrice = 100;
  ps.funds = 8;
  ps.recompute();
  return { m, ps };
}

/** Normal shop chess of one tier the shared pool still holds, distinct operators. */
const chessOfTier = (m, tier, n) => Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === tier
  && m.pool.has(c.chessId) && m.pool.left(c.chessId) >= 3).slice(0, n);
/** Visible members of a bond (by ascending tier) the pool still holds, optionally only those of that one core bond. */
const membersOf = (m, bond, n, only = true) => DATA.bonds[bond].visibleMembers.map((id) => DATA.chess[id])
  .filter((c) => c && m.pool.has(c.chessId) && m.pool.left(c.chessId) >= 1 && (!only || !c.bonds.some((b) => b !== bond && DATA.bonds[b]?.isCore)))
  .sort((a, b) => a.tier - b.tier).slice(0, n);
const deploy = (m, ps, c) => give(m, ps, c.chessId, 'board', legalTileFor(m, ps, c.chessId));

/** The bot's prep with one item stocked in the shop: the actions in order ('buy <id>', 'equip <id>', 'refresh'). */
function prepWith(m, ps, itemId) {
  ps.shop.slots = [{ kind: 'item', id: itemId, basePrice: DATA.items[itemId].price, sold: false }];
  const log = [];
  const buy = ps.buy.bind(ps), equip = ps.equip.bind(ps), refresh = ps.refresh.bind(ps);
  ps.buy = (i) => { const s = ps.shop.slots[i]; if (s?.kind === 'item') log.push(`buy ${s.id}`); return buy(i); };
  ps.equip = (u, target, rep) => { const it = [...ps.hand, ...ps.temp].find((p) => p && p.uid === u); if (it) log.push(`equip ${it.id}`); return equip(u, target, rep); };
  ps.refresh = () => { log.push('refresh'); return refresh(); };
  botPrepBegin(m, ps);
  return log;
}
const bought = (log) => log.filter((x) => x.startsWith('buy ')).map((x) => x.slice(4));

test('§37.41: 博士投影 is bought for a deployed tier-4+ normal operator and worn by it', (t) => {
  const { m, ps } = setup(t);
  const piece = deploy(m, ps, chessOfTier(m, 5, 1)[0]);
  assert.deepEqual(bought(prepWith(m, ps, PROMO)), [PROMO]);
  assert.ok((piece.items || []).some((it) => it.id === PROMO), 'the tier-V operator wears it');
});

test('§37.41: no 博士投影 for a board of tier ≤ 3, nor in the Final Assault prep', (t) => {
  {
    const { m, ps } = setup(t);
    for (const c of chessOfTier(m, 3, 2)) deploy(m, ps, c);
    assert.deepEqual(bought(prepWith(m, ps, PROMO)), []);
  }
  {
    const { m, ps } = setup(t);
    m.round = m.gd.bossRound;
    deploy(m, ps, chessOfTier(m, 5, 1)[0]);
    assert.deepEqual(bought(prepWith(m, ps, PROMO)), []);
  }
});

test('§37.41: 拟态物质 is bought for a tier-4+ pair with copies left, not for a tier-3 pair', (t) => {
  for (const [tier, want] of [[4, [MIMIC]], [3, []]]) {
    const { m, ps } = setup(t);
    const [c] = chessOfTier(m, tier, 1);
    deploy(m, ps, c);
    give(m, ps, c.chessId, 'hand');
    assert.deepEqual(bought(prepWith(m, ps, MIMIC)), want, `a tier-${tier} pair`);
  }
});

test('§37.41: 精打细算玩偶 while five rounds remain, 见钱眼开玩偶 before the Final Assault prep, each destroyed at once', (t) => {
  for (const [round, id, want] of [[9, SAVE, true], [10, SAVE, false], [10, EYE, true], [null, EYE, false]]) {
    const { m, ps } = setup(t, round ?? 9);
    if (round == null) m.round = m.gd.bossRound;
    deploy(m, ps, chessOfTier(m, 2, 1)[0]);
    const log = prepWith(m, ps, id);
    assert.deepEqual(bought(log), want ? [id] : [], `R${m.round} ${DATA.items[id].name}`);
    if (want) {
      assert.equal(log[log.indexOf(`buy ${id}`) + 1], `equip ${id}`, 'equipped (destroyed) right after the purchase');
      assert.ok(![...ps.hand, ...ps.temp].some((p) => p && p.id === id), 'gone from the hand');
    }
  }
  // co-op: no dolls
  const seats = Array.from({ length: 4 }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', seed: 5, seats }).start().toPrep();
  t.after(() => h.dispose?.());
  const m = h.m, ps = m.order[0];
  m.round = 6;
  ps.funds = 8;
  ps.shop.upgradePrice = 100;
  assert.deepEqual(bought(prepWith(m, ps, SAVE)), [], 'co-op: no 精打细算玩偶');
});

test('§37.41: with 炎 the focus one 炎国短刀 is bought from R6 and held; a 叙拉古 focus buys no 叙拉古正装', (t) => {
  for (const [bond, item, want] of [['yanShip', DAGGER, true], ['siracusaShip', SUIT, false]]) {
    const { m, ps } = setup(t, 7);
    for (const c of membersOf(m, bond, 4)) deploy(m, ps, c);
    assert.equal(bondPlan(m, ps).focus, bond);
    assert.deepEqual(bought(prepWith(m, ps, item)), want ? [item] : [], bond);
    if (want) assert.ok(ps.hand.some((p) => p && p.id === item), 'held in the hand for a 变形同构体');
  }
});

test('§37.41: 缪尔赛思 wears her 变形同构体 with the held 炎国短刀 — 8 deployed, 9 炎', (t) => {
  const { m, ps } = setup(t, 12);
  const yan = membersOf(m, 'yanShip', 7, false);
  assert.equal(yan.length, 7, 'seven 炎 operators');
  for (const c of yan) deploy(m, ps, c);
  const mly = deploy(m, ps, DATA.chess[MLYSS]);
  giveItem(m, ps, DAGGER, 'hand');
  giveItem(m, ps, MORPH, 'hand');
  assert.equal(ps.bonds.yanShip.count, 8, '7 炎 + 调和');
  equipItems(m, ps);
  assert.deepEqual((mly.items || []).map((it) => it.id).sort(), [DAGGER, MORPH].sort());
  assert.equal(ps.bonds.yanShip.count, 9, '7 炎 + 缪尔赛思 converted + 调和');
});

test('§37.41: holding the 炎 bond item makes 缪尔赛思 worth two 炎 members; a 叙拉古 item does not', (t) => {
  for (const [bond, item, gain] of [['yanShip', DAGGER, true], ['siracusaShip', SUIT, false]]) {
    const { m, ps } = setup(t, 11);
    for (const c of membersOf(m, bond, 5)) deploy(m, ps, c);
    const before = buyScoreOf(m, ps, MLYSS);
    giveItem(m, ps, item, 'hand');
    const after = buyScoreOf(m, ps, MLYSS);
    if (gain) assert.ok(after >= before + 30, `${bond}: ${before.toFixed(1)} → ${after.toFixed(1)}`);
    else assert.equal(after, before, `${bond}: unchanged`);
  }
});

test('§37.41: between as many 炎 as 谢拉格 members the focus is 谢拉格 (the prior from the bots\' results)', (t) => {
  const { m, ps } = setup(t, 6);
  for (const c of [...membersOf(m, 'yanShip', 3), ...membersOf(m, 'kjeragShip', 3)]) give(m, ps, c.chessId, 'hand');
  assert.equal(bondPlan(m, ps).focus, 'kjeragShip');
});
