// §37.42 缪尔赛思 (round56; the maintainer 2026-10-29: 「缪尔赛思除了炎盟约我基本都是到手就卖不留着，这样能提高再次拿到的概率」):
// outside a focus whose top tier exceeds the deploy cap the bot sells a normal 缪尔赛思 as soon as she arrives (her 变形同构体
// stays, the copy returns to the pool); the 博士投影 that promotes at once (her strategy's round-1 item) waits for a deployed
// normal operator of tier ≥ 4, at the latest until the Final Assault prep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botPrepBegin, equipItems, arrange } from '../../server/match/bot.js';
import { makeMatch, give, giveItem, legalTileFor, DATA } from './harness.js';

const MLYSS = 'chess_char_6_11_a'; // 缪尔赛思 (her gain brings a 变形同构体)
const MORPH = 'chess_item_6_09_e_a'; // 变形同构体
const PROMO_NOW = 'chess_item_5_06_e_b'; // 进阶博士投影 (promotes at once)
const bots = [{ seat: 0, playerId: 'ai_0', name: 'AI-1', isBot: true, connected: true }];

function setup(t, round = 11) {
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
  ps.shop.slots = [];
  ps.funds = 0;
  ps.recompute();
  return { m, ps };
}

/** Visible members of a core bond that belong to no other core bond, lowest tier first, with copies in the pool. */
const membersOf = (m, bond, n) => DATA.bonds[bond].visibleMembers.map((id) => DATA.chess[id])
  .filter((c) => c && m.pool.left(c.chessId) >= 1 && !c.bonds.some((b) => b !== bond && DATA.bonds[b]?.isCore))
  .sort((a, b) => a.tier - b.tier).slice(0, n);
const deploy = (m, ps, c) => give(m, ps, c.chessId, 'board', legalTileFor(m, ps, c.chessId));
const morphs = (ps) => [...ps.hand, ...ps.temp].filter((p) => p && p.id === MORPH).length
  + ps.allChess().reduce((n, p) => n + (p.items || []).filter((it) => it.id === MORPH).length, 0);
const owns = (m, ps, id) => ps.allChess().some((p) => m.gd.baseIdOf(p.id) === id);

test('§37.42: outside 炎 a 缪尔赛思 from an offer is sold at once — her 变形同构体 stays, the copy returns to the pool', (t) => {
  const { m, ps } = setup(t);
  for (const c of membersOf(m, 'siracusaShip', 5)) deploy(m, ps, c);
  const left = m.pool.left(MLYSS);
  ps.pushRewardOffer('merge', { tier: 6, ids: [MLYSS] });
  botPrepBegin(m, ps);
  assert.equal(owns(m, ps, MLYSS), false, 'sold');
  assert.equal(morphs(ps), 1, 'the 变形同构体 she brought stays');
  assert.equal(m.pool.left(MLYSS), left, 'her copy is back in the pool');
});

test('§37.42: with 炎 the focus (its top tier 9 exceeds the deploy cap) she stays', (t) => {
  const { m, ps } = setup(t);
  for (const c of membersOf(m, 'yanShip', 4)) deploy(m, ps, c);
  ps.pushRewardOffer('merge', { tier: 6, ids: [MLYSS] });
  botPrepBegin(m, ps);
  assert.equal(owns(m, ps, MLYSS), true);
});

test('§37.42: one that arrives another way (not from an offer) is sold by the item step', (t) => {
  const { m, ps } = setup(t);
  for (const c of membersOf(m, 'siracusaShip', 3)) deploy(m, ps, c);
  give(m, ps, MLYSS, 'hand');
  equipItems(m, ps);
  assert.equal(owns(m, ps, MLYSS), false);
});

test('§37.42: the 博士投影 that promotes at once waits for a deployed tier-4+ normal operator, then promotes it', (t) => {
  const { m, ps } = setup(t, 2);
  const low = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier <= 2 && m.pool.left(c.chessId) >= 1).slice(0, 2);
  for (const c of low) deploy(m, ps, c);
  giveItem(m, ps, PROMO_NOW, 'hand');
  equipItems(m, ps);
  assert.ok(ps.hand.some((p) => p && p.id === PROMO_NOW), 'kept while only tier ≤ 2 operators stand');
  const t4 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 4 && m.pool.left(c.chessId) >= 1);
  deploy(m, ps, t4);
  equipItems(m, ps);
  assert.ok(!ps.hand.some((p) => p && p.id === PROMO_NOW), 'used');
  assert.ok([...ps.board.values()].some((p) => p.kind === 'chess' && m.gd.isGolden(p.id)), 'an elite on the board');
});

test('§37.42: in the Final Assault prep the 博士投影 that promotes at once is used on whoever stands', (t) => {
  const { m, ps } = setup(t);
  m.round = m.gd.bossRound;
  const low = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier <= 2 && m.pool.left(c.chessId) >= 1).slice(0, 2);
  for (const c of low) deploy(m, ps, c);
  giveItem(m, ps, PROMO_NOW, 'hand');
  equipItems(m, ps);
  assert.ok(!ps.hand.some((p) => p && p.id === PROMO_NOW));
});

// §37.43 9 炎: one-swap climbs stopped at 6 炎 even with 缪尔赛思 converted and seven 炎 owned (a 7th member crosses no tier),
// and morphPlan never put the 变形同构体 on her while she stood on the bench.
const DAGGER = 'chess_item_3_04_e_a'; // 炎国短刀 (gives 炎 with a 变形同构体)
/** Normal tier-6 operators outside 炎 (a strong pair of outsiders, as in the round-56 review games). */
const strongOutsiders = (m, n) => Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier === 6
  && !c.bonds.includes('yanShip') && !c.bonds.some((b) => DATA.bonds[b]?.activeType === 'MANI') && m.pool.left(c.chessId) >= 1).slice(0, n);

test('§37.43: with 炎 the focus, 缪尔赛思 on the bench takes the held 炎国短刀 and 变形同构体', (t) => {
  const { m, ps } = setup(t, 12);
  for (const c of membersOf(m, 'yanShip', 6)) deploy(m, ps, c);
  // elite outsiders: before her conversion the lineup leaves her on the bench, where morphPlan never looked
  for (const c of Object.values(DATA.chess).filter((c) => c.visible && c.isGolden && c.tier === 6 && !c.bonds.includes('yanShip')
    && !c.bonds.some((b) => DATA.bonds[b]?.activeType === 'MANI')).slice(0, 2)) deploy(m, ps, c);
  const her = give(m, ps, MLYSS, 'hand');
  giveItem(m, ps, DAGGER, 'hand');
  giveItem(m, ps, MORPH, 'hand');
  equipItems(m, ps);
  assert.deepEqual((her.items || []).map((it) => it.id).sort(), [DAGGER, MORPH].sort());
});

test('§37.43: 缪尔赛思 converted and seven 炎 owned — the lineup fields her with seven 炎 for 9 炎', (t) => {
  const { m, ps } = setup(t, 12);
  const yan = membersOf(m, 'yanShip', 7);
  assert.equal(yan.length, 7, 'seven 炎 operators');
  for (const c of yan.slice(0, 6)) deploy(m, ps, c);
  for (const c of strongOutsiders(m, 2)) deploy(m, ps, c);
  give(m, ps, yan[6].chessId, 'hand');
  const her = give(m, ps, MLYSS, 'hand');
  for (const id of [DAGGER, MORPH]) { const it = giveItem(m, ps, id, 'hand'); ps.equip(it.uid, her.uid); }
  arrange(m, ps);
  assert.equal(ps.bonds.yanShip.count, 9, '7 炎 + 缪尔赛思 converted + 调和');
  assert.ok([...ps.board.values()].some((p) => p.uid === her.uid), 'she is deployed');
});

// §37.44 娜仁图亚: her 6 萨尔贡 lends a skill-starting member's equipment (tier ≤ 5) to its 8 neighbours instead of the attack
// stacks, so the bot buys combat equipment for the 萨尔贡 members (an exception to §37.39) and lets them carry first.
test('§37.44: with 娜仁图亚 and four 萨尔贡 a tier-3+ combat item is bought for a 萨尔贡 member; another strategy buys none', (t) => {
  const item = Object.values(DATA.items).find((r) => r.itemType === 'EQUIP' && r.tier === 4 && !r.isGolden && !r.giveBondId && !r.canGiveBond
    && Array.isArray(r.buffs) && r.buffs.length && !String(r.buffs[0].key).startsWith('use_') && !String(r.buffs[0].key).includes('coin')
    && !(typeof r.kind === 'string' && r.kind.startsWith('consume')) && r.category !== 'SURVIVAL' && r.price <= 4);
  for (const [band, want] of [['band_narant', true], ['band_sarkazb', false]]) {
    const { m, ps } = setup(t, 9);
    ps.bandId = band;
    const sargon = membersOf(m, 'sargonShip', 4);
    for (const c of sargon) deploy(m, ps, c);
    ps.funds = 6;
    ps.shop.slots = [{ kind: 'item', id: item.id, basePrice: item.price, sold: false }];
    botPrepBegin(m, ps);
    const carrier = ps.allChess().find((p) => (p.items || []).some((it) => it.id === item.id));
    assert.equal(!!carrier, want, `${band}: ${item.name}`);
    if (want) assert.ok(m.gd.chess(carrier.id).bonds.includes('sargonShip'), 'worn by a 萨尔贡 member');
  }
});
