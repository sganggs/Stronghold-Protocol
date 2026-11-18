// 规程 consume items use renamed buff keys (builtinMeta.js). The bot's buy and carrier choices stay the 盟约 ones
// through bot.js EFFECT_ALIAS. Older seasons do not have these keys, so this file loads act3autochess@V3_1 only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { MetaRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { buyLoopSteps, equipItems, itemTarget } from '../../server/match/bot.js';
import { GEO } from '../../shared/constants.js';
import { SharedPool } from '../../server/match/pool.js';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';

const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const data = getVersionData('act3autochess@V3_1', { log: QUIET });
const BEACON = 'chess_item_5_02_e_a'; // 信标 equip_tier_recr_gift
const MIMIC = 'chess_item_5_03_e_a'; // 拟态物质 use_equip_reward_same_tier
const COMMS = 'chess_item_2_06_e_a'; // 简易通讯机 equip_destory_first_bond_char
const EYE = 'chess_item_2_07_e_a'; // 见钱眼开玩偶 use_equip_next_gold
const LETTER = 'chess_item_2_08_e_a'; // 卫戍推荐信 prep_end_act_bond
const HAMMER = 'chess_item_1_01_e_a'; // 维式重锤, passive, unchanged key
const DEALER = 'chess_char_5_02_a'; // 怒潮凛冬
const SINGLE = 'chess_char_4_08_a'; // 森蚺
const BOT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];

after(() => setGameData(null));

function setup(t, round = 9) {
  setGameData(data);
  const registry = registerBuiltins(new MetaRegistry(), data);
  const h = makeMatch({
    data, mode: 'solo', difficulty: 'NORMAL', modeId: 'mode_single_12', seed: 3, seats: BOT, registry,
  }).start().toPrep();
  t.after(() => { assert.equal(h.m.errorCount, 0); h.m.dispose(); });
  const m = h.m, ps = m.order[0];
  for (const p of ps.allChess()) ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp = new Array(GEO.TEMP_SIZE).fill(null);
  ps.bandId = 'band_sarkazb';
  delete ps._botFocus;
  delete ps._botFocusId;
  m.disabledBonds = [];
  m.bannedChess = [];
  m.pool = new SharedPool(m.gd);
  m.round = round;
  ps.shop.level = 5;
  ps.shop.upgradePrice = 100;
  ps.funds = 40;
  ps.recompute();
  assert.equal(ps.equipHand, true);
  return { m, ps };
}

const deploy = (m, ps, id) => give(m, ps, id, 'board', legalTileFor(m, ps, id));
const held = (ps, id) => [...ps.hand, ...ps.temp].some((p) => p && p.id === id);
const drainBuy = (m, ps) => { for (const _ of buyLoopSteps(m, ps, { maxRefreshes: 0 })) { /* one shop pass */ } };

test('规程: a hammer in the equipment row is equipped on the deployed dealer', (t) => {
  const { m, ps } = setup(t);
  const dealer = deploy(m, ps, DEALER);
  const hammer = giveItem(m, ps, HAMMER, 'temp');
  assert.equal(ps.temp[0], hammer);
  equipItems(m, ps);
  assert.ok((dealer.items || []).some((it) => it.uid === hammer.uid), 'worn by the dealer');
  assert.ok(!ps.temp.includes(hammer) && !ps.hand.includes(hammer));
});

test('规程: a 信标 in the equipment row goes on the bench single, not the strongest dealer', (t) => {
  const { m, ps } = setup(t);
  assert.equal(data.items[BEACON].buffs[0].key, 'equip_tier_recr_gift');
  const dealer = deploy(m, ps, DEALER);
  const single = give(m, ps, SINGLE, 'hand');
  const beacon = giveItem(m, ps, BEACON, 'temp');
  assert.equal(itemTarget(m, ps, beacon)?.uid, single.uid);
  equipItems(m, ps);
  assert.ok([...ps.board.values()].includes(dealer), 'the dealer is not sacrificed');
  assert.equal(ps.find(single.uid), null, 'the bench single is the carrier the beacon destroys');
  assert.equal(held(ps, BEACON), false);
});

test('规程: 拟态物质 is worn by a tier-4 pair and bought for that pair', (t) => {
  const { m, ps } = setup(t);
  assert.equal(data.items[MIMIC].buffs[0].key, 'use_equip_reward_same_tier');
  deploy(m, ps, DEALER);
  const a = give(m, ps, SINGLE, 'hand');
  const b = give(m, ps, SINGLE, 'hand');
  ps.shop.slots = [{ kind: 'item', id: MIMIC, basePrice: data.items[MIMIC].price, sold: false }];
  drainBuy(m, ps);
  assert.equal(ps.shop.slots[0].sold, true, 'bought like the 盟约 mimic');
  const mimic = [...ps.hand, ...ps.temp].find((p) => p && p.id === MIMIC);
  assert.ok(mimic, 'the bought copy is in the equipment row');
  assert.ok([a.uid, b.uid].includes(itemTarget(m, ps, mimic)?.uid));
  const before = ps.allChess().filter((p) => m.gd.baseIdOf(p.id) === SINGLE && !m.gd.isGolden(p.id)).length;
  equipItems(m, ps);
  assert.equal(held(ps, MIMIC), false, 'consumed from the equipment row');
  const ofSingle = ps.allChess().filter((p) => m.gd.baseIdOf(p.id) === SINGLE);
  assert.ok(ofSingle.length > before || ofSingle.some((p) => m.gd.isGolden(p.id)), 'the pair gains another copy');
});

test('规程: 见钱眼开玩偶 is bought and consumed in solo before the Final Assault', (t) => {
  const { m, ps } = setup(t, 10);
  assert.equal(data.items[EYE].buffs[0].key, 'use_equip_next_gold');
  assert.ok(m.round < m.gd.bossRound);
  deploy(m, ps, 'chess_char_2_03_a');
  ps.shop.slots = [{ kind: 'item', id: EYE, basePrice: data.items[EYE].price, sold: false }];
  drainBuy(m, ps);
  assert.equal(ps.shop.slots[0].sold, true);
  assert.equal(held(ps, EYE), false, 'destroyed on equip, like the 盟约 doll');
});

test('规程: 简易通讯机 prefers the operator whose first bond is the focus', (t) => {
  const { m, ps } = setup(t);
  assert.equal(data.items[COMMS].buffs[0].key, 'equip_destory_first_bond_char');
  const focus = deploy(m, ps, 'chess_char_1_02_a'); // 艾丝黛尔, first bond 萨尔贡
  deploy(m, ps, 'chess_char_2_03_a');
  deploy(m, ps, 'chess_char_2_04_a');
  const other = deploy(m, ps, 'chess_char_3_02_a'); // 卡涅利安, first bond 莱塔尼亚, also 萨尔贡
  deploy(m, ps, 'chess_char_1_19_a');
  deploy(m, ps, 'chess_char_2_01_a');
  ps.recompute();
  assert.equal(ps.bonds.sargonShip.active, true);
  assert.equal(ps.bonds.lethaniaShip.active, true);
  const comms = giveItem(m, ps, COMMS, 'temp');
  const target = itemTarget(m, ps, comms);
  const who = (p) => `${p.uid}:${m.gd.chess(p.id).name}:${(m.gd.chess(p.id).bonds || [])[0]}`;
  assert.equal(m.gd.chess(target.id).bonds[0], 'sargonShip', `focus ${ps._botFocusId} picked ${who(target)} not a 萨尔贡-first operator (艾丝黛尔 ${who(focus)}, 卡涅利安 ${who(other)})`);
});

test('规程: 卫戍推荐信 waits for a free slot instead of replacing a worn item', (t) => {
  const { m, ps } = setup(t);
  assert.equal(data.items[LETTER].buffs[0].key, 'prep_end_act_bond');
  const dealer = deploy(m, ps, DEALER);
  while ((dealer.items || []).length < m.gd.equipPerChess) dealer.items.push(ps.newPiece('item', HAMMER));
  const letter = giveItem(m, ps, LETTER, 'temp');
  assert.equal(itemTarget(m, ps, letter), null);
  equipItems(m, ps);
  assert.equal(ps.temp.includes(letter), true, 'still in the equipment row');
  assert.equal((dealer.items || []).some((it) => it.id === LETTER), false);
});

