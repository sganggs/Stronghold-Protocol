// §37.67 the Final Assault's damage items: what an equipment item does to its carrier's damage is read from its buffs'
// blackboards (bot.faItemMods: the same keys in all four versions, which reuse item ids for other items). After the
// rehearsed Final Assault layout the bench is sold and its funds refresh the shop for such items, each equipped at once
// on the operator whose rehearsed leader damage it raises most.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, botPrepEnd, equipItems, faItemMods } from '../../server/match/bot.js';
import { getData, getVersionData } from '../../server/data.js';
import { makeMatch, give, giveItem } from './harness.js';

const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
// the fa-damage fixture: ten operators for a deploy cap of eight (two stay on the bench)
const IDS = ['4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '3_12_a', '1_01_a', '2_03_a', '6_12_a', '5_21_a'];

/** The normal record of `effectId` in a version's items. */
const byEffect = (items, effectId) => Object.values(items).find((r) => r.effectId === effectId && !r.isGolden);

test('§37.67: faItemMods reads an item\'s damage from its blackboards, in every version', () => {
  for (const [name, data] of [['default', getData({ log: QUIET })], ['act1autochess', getVersionData('act1autochess', { log: QUIET })],
    ['act1autochess@V1_1', getVersionData('act1autochess@V1_1', { log: QUIET })], ['act2autochess@V2_1', getVersionData('act2autochess@V2_1', { log: QUIET })]]) {
    const at = (eff) => faItemMods(byEffect(data.items, eff));
    assert.deepEqual({ ...at('eff_acarm052') }, { atk: 0, aspd: 0, stack: 1, cap: 60, resPen: 0, weak: false }, `${name} 有限加速器`);
    assert.equal(faItemMods(data.items[byEffect(data.items, 'eff_acarm052').goldenId]).stack, 2, `${name}: the golden one stacks 2`);
    assert.ok(at('eff_acarm067').weak && at('eff_acarm067').atk > 0, `${name} 双模机械臂: ATK and 弱点伤害`);
    assert.ok(at('eff_acarm046').atk > 0 && at('eff_acarm046').aspd === -10, `${name} 阿戈尔重刃`);
    assert.equal(at('eff_acarm053').resPen, 0.25, `${name} 激光发射器`);
    // 休眠子裔, 精准狙击镜 (a distance), 炎国短刀 (skill starts), 坚守盾牌, 盟约之币 / 幸运硬币, 博士投影
    for (const eff of ['eff_acarm065', 'eff_acarm063', 'eff_acarm040', 'eff_acarm047', 'eff_acarm066', 'eff_acarm071']) {
      assert.equal(at(eff), null, `${name} ${byEffect(data.items, eff).name}: no damage the bot counts`);
    }
  }
  assert.equal(faItemMods(getData({ log: QUIET }).items.chess_item_1_05_e_a), null, '源石溶剂 drains its own carrier');
  // 上半 gives the ids of 下半's damage items to other items: each is read from its own record
  const act1 = getVersionData('act1autochess', { log: QUIET }).items;
  assert.equal(act1.chess_item_4_03_e_a.name, '休眠子裔');
  assert.equal(faItemMods(act1.chess_item_4_03_e_a), null);
  assert.equal(act1.chess_item_5_03_e_a.name, '寻呼模块');
  assert.equal(faItemMods(act1.chess_item_5_03_e_a), null);
  assert.equal(faItemMods(act1.chess_item_1_02_e_a).atk, 0.35, '阿戈尔重刃 is 1_02 there');
});

function bossRound(bossId, round = null) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seats: SEAT, seed: 7, botRehearsal: 3 }).start().toPrep();
  const m = h.m, ps = m.order[0];
  m.bossId = bossId;
  m.startRound(round ?? m.gd.bossRound);
  m.phase = 'PREP'; // the round's prep (startRound leaves the round start)
  for (const id of IDS) give(m, ps, `chess_char_${id}`, 'hand');
  return { h, m, ps };
}

const slot = (m, id) => ({ kind: 'item', id, basePrice: m.gd.itemPrice(id), frozen: false, sold: false });
const carrierOf = (ps, itemId) => [...ps.board.values()].find((p) => p.kind === 'chess' && (p.items || []).some((it) => it.id === itemId)) || null;

test('§37.67: the boss rehearsal counts the leader damage of each own operator; after it the bench is sold for damage items', () => {
  const { h, m, ps } = bossRound('boss_3');
  try {
    const job = arrange(m, ps, { final: true, defer: true });
    assert.ok(job, 'the boss round is rehearsed');
    const hammer = giveItem(m, ps, 'chess_item_1_01_e_a'); // 维式重锤, held before the layout
    const seer = give(m, ps, 'chess_char_2_02_a', 'hand'); // 赫默: 远见 counts the hand
    equipItems(m, ps);
    assert.equal(ps.find(hammer.uid)?.area, 'hand', 'a damage item waits for the rehearsed layout');
    job.run();
    const lead = ps._botFaLead?.lead;
    assert.ok(lead instanceof Map && lead.size > 0 && ps._botFaLead.round === m.round, 'leader damage per piece uid');
    for (const [uid, v] of lead) assert.ok(ps.find(uid) && v > 0, 'own operators only');
    // the shop shows 叙拉古正装 (ASPD +15: the same share for every 100-ASPD carrier), every refresh after it 坚守盾牌
    ps.shop.slots = [slot(m, 'chess_item_3_01_e_a')];
    ps.rollShop = () => { ps.shop.slots = [slot(m, 'chess_item_1_02_e_a')]; };
    ps.funds = 0;
    const owned = ps.allChess().length;
    botPrepEnd(m, ps, job);
    const handBond = (p) => (ps.gd.chess(p.id).bonds || []).some((b) => ps.gd.bond(b)?.countMode === 'BOARD_AND_DECK');
    const bench = ps.hand.filter((p) => p && p.kind === 'chess');
    assert.ok(ps.allChess().length < owned, 'the bench is sold');
    assert.ok(bench.every(handBond) && bench.some((p) => p.uid === seer.uid), 'but not a member of a bond that counts the hand (远见)');
    assert.ok(carrierOf(ps, 'chess_item_1_01_e_a'), 'the held damage item is equipped after the layout');
    const dealers = [...ps.board.values()].filter((p) => p.kind === 'chess' && ps.gd.chess(p.id).stats.aspd === 100 && lead.has(p.uid));
    const top = dealers.sort((a, b) => lead.get(b.uid) - lead.get(a.uid))[0];
    assert.equal(carrierOf(ps, 'chess_item_3_01_e_a')?.uid, top.uid, 'the bought one: the 100-ASPD operator with the most leader damage');
    assert.ok(ps.funds < 2, 'the funds are spent on refreshes');
  } finally { h.dispose?.(); }
});

test('§37.67: a strategy that keeps its leftover funds (坎诺特) keeps its interest capital through the hunt', () => {
  const { h, m, ps } = bossRound('boss_3');
  try {
    ps.bandId = 'band_cannot'; // 利滚利: the funds left carry over, with interest from 5 on
    const job = arrange(m, ps, { final: true, defer: true });
    job.run();
    // the shop shows 叙拉古正装, every refresh after it 坚守盾牌 (no damage)
    ps.shop.slots = [slot(m, 'chess_item_3_01_e_a')];
    ps.rollShop = () => { ps.shop.slots = [slot(m, 'chess_item_1_02_e_a')]; };
    ps.funds = 8;
    botPrepEnd(m, ps, job);
    assert.ok(ps.funds >= 5, `the interest capital stays (funds ${ps.funds})`);
  } finally { h.dispose?.(); }
});

test('§37.67: a full hand neither buys nor refreshes', () => {
  const { h, m, ps } = bossRound('boss_3');
  try {
    const job = arrange(m, ps, { final: true, defer: true });
    job.run();
    // no bench left to sell, the hand full of items nobody carries for damage (坚守盾牌)
    for (const p of ps.hand.filter((x) => x && x.kind === 'chess')) ps.sell(p.uid);
    while (ps.hand.includes(null)) giveItem(m, ps, 'chess_item_1_02_e_a');
    ps.shop.slots = [slot(m, 'chess_item_3_01_e_a')]; // 叙拉古正装, which a hand slot would buy
    let rolls = 0;
    ps.rollShop = () => { rolls++; ps.shop.slots = [slot(m, 'chess_item_1_01_e_a')]; };
    ps.funds = 8;
    botPrepEnd(m, ps, job);
    assert.equal(rolls, 0, 'no refresh');
    assert.equal(ps.funds, 8);
  } finally { h.dispose?.(); }
});

/** The Final Assault prep after its rehearsed layout, the bench full of members of bonds that count the hand. */
function memberBench() {
  const { h, m, ps } = bossRound('boss_3');
  const job = arrange(m, ps, { final: true, defer: true });
  job.run();
  for (const p of ps.hand.filter((x) => x && x.kind === 'chess')) ps.sell(p.uid);
  // 远见 / 奇迹 / 投资人 members
  for (const id of ['2_02_a', '2_11_a', '2_19_a', '3_01_a', '3_03_a', '3_14_a', '3_19_a', '4_04_a', '4_07_a', '5_01_a']) {
    give(m, ps, `chess_char_${id}`, 'hand');
  }
  assert.ok(!ps.hand.includes(null), 'a full hand');
  ps.funds = 0;
  return { h, m, ps, job, kept: ps.hand.map((p) => p.uid) };
}

test('§37.67: after the hunt the rest of the prep sells none of the bench it kept', () => {
  // a full hand at the prep end frees no slot by selling a member: the bench fights no more, but its bonds count
  let { h, m, ps, job, kept } = memberBench();
  try {
    botPrepEnd(m, ps, job);
    assert.deepEqual(ps.hand.map((p) => p?.uid), kept, 'every member stays');
  } finally { h.dispose?.(); }
  // a piece on the temp row goes instead of a member, however strong (史尔特尔, tier 5)
  ({ h, m, ps, job, kept } = memberBench());
  try {
    const temp = give(m, ps, 'chess_char_5_07_a', 'temp');
    botPrepEnd(m, ps, job);
    assert.deepEqual(ps.hand.map((p) => p?.uid), kept, 'every member stays');
    assert.equal(ps.find(temp.uid), null, 'the temp piece is sold');
  } finally { h.dispose?.(); }
});

test('§37.67: before the Final Assault a damage item is equipped as before', () => {
  const { h, m, ps } = bossRound('boss_3', 13);
  try {
    assert.ok(m.wave, 'a normal round');
    arrange(m, ps);
    const hammer = giveItem(m, ps, 'chess_item_1_01_e_a');
    equipItems(m, ps);
    assert.equal(ps.find(hammer.uid)?.area, 'equipped');
  } finally { h.dispose?.(); }
});
