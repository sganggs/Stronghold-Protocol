// §37.35 职业队 (round54; owner 2026-10-28: without a strategy that reliably supplies its bond's operators the draws decide
// whether layers can be stacked). A strategy that supplies a core bond leads the bot's focus from round 1, its rigged
// refreshes come before the level-up, layer trades count every 获得时 layer trait and the deployed 小满 / 夕, and a refresh
// is taken for the 阿罗玛 / 安洁莉娜 / 拉普兰德 layers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bondPlan, buyLoopSteps, bandRefreshGain, acquireLayers, gainCountLayers, refreshLayers, engineFor, buyScoreOf, tradeMin } from '../../server/match/bot.js';
import { makeMatch, give, legalTileFor, chessOfTier } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];

function solo(difficulty = 'ABYSS', seed = 3) {
  const h = makeMatch({ mode: 'solo', difficulty, seats: SEAT, seed }).start().toPrep();
  const m = h.m, ps = m.order[0];
  ps.hand.fill(null);
  ps.board.clear();
  ps.recompute();
  return { h, m, ps };
}

function deploy(m, ps, ids) {
  for (const id of ids) give(m, ps, id, 'board', legalTileFor(m, ps, id));
  ps.recompute();
}

const run = (gen) => { for (const _ of gen) { /* drain the step generator */ } };

test('a 职业队 strategy\'s core bond is the focus with no member owned; other strategies and switched-off bonds are not', () => {
  const { h, m, ps } = solo();
  try {
    ps.bandId = 'band_duyaoy';
    assert.equal(bondPlan(m, ps).focus, 'yanShip');
    ps.bandId = 'band_chiave';
    assert.equal(bondPlan(m, ps).focus, 'siracusaShip', 'the cache follows the strategy');
    ps.bandId = 'band_bldsk';
    ps._botFocusId = null;
    assert.equal(bondPlan(m, ps).focus, null, '歌利亚 supplies no bond: nothing owned, no focus');
  } finally { h.dispose?.(); }
  const f = solo('FUNNY');
  try {
    f.ps.bandId = 'band_paganini';
    assert.ok(f.m.gd.modeInactiveBonds.has('lateranoShip'));
    assert.equal(bondPlan(f.m, f.ps).focus, null, '标准 switches 拉特兰 off');
  } finally { f.h.dispose?.(); }
});

test('rigged refreshes: 杜遥夜 the first two of a round, 佩佩 after its level-up, 贾维 a sixth of a member per refresh', () => {
  const { h, m, ps } = solo();
  try {
    ps.bandId = 'band_duyaoy';
    for (const [done, want] of [[0, 1], [1, 1], [2, 0]]) {
      ps.round.refreshes = done;
      assert.equal(bandRefreshGain(m, ps, 'yanShip'), want, `杜遥夜 after ${done} refreshes`);
    }
    assert.equal(bandRefreshGain(m, ps, 'kjeragShip'), 0, 'only its own bond');
    ps.round.refreshes = 0;
    ps.bandId = 'band_pepe';
    assert.equal(bandRefreshGain(m, ps, 'sargonShip'), 0);
    ps.counters['band:pepe:special'] = 1;
    assert.equal(bandRefreshGain(m, ps, 'sargonShip'), m.gd.shopSlots(ps.shop.level).chess, 'every chess slot');
    ps.bandId = 'band_chiave';
    assert.equal(bandRefreshGain(m, ps, 'siracusaShip'), 1 / 6);
    assert.equal(bandRefreshGain(m, ps, 'siracusaShip', { sure: true }), 0, 'not a sure one');
    ps.counters['band:chiave:r'] = m.round;
    ps.counters['band:chiave'] = 2;
    assert.equal(bandRefreshGain(m, ps, 'siracusaShip'), 0, 'two granted this round');
  } finally { h.dispose?.(); }
});

test('acquisition layers: 惊蛰 the shop level, 烛煌 / 录武官 their bonds, 星熊 each own bond, 灰毫 the most-layered active bond', () => {
  const { h, m, ps } = solo();
  try {
    ps.shop.level = 4;
    const of = (id) => Object.fromEntries(acquireLayers(m, ps, m.gd.chess(id)));
    assert.deepEqual(of('chess_char_1_03_a'), { yanShip: 4 });
    assert.deepEqual(of('chess_char_1_03_b'), { yanShip: 8 }, 'the elite doubles');
    assert.deepEqual(of('chess_char_5_03_a'), { yanShip: 5, victoriaShip: 5 });
    assert.deepEqual(of('chess_char_5_23_a'), { yanShip: 6, miraShip: 3 });
    assert.deepEqual(of('chess_char_4_17_a'), { yanShip: 8 });
    assert.deepEqual(of('chess_char_1_19_a'), { kazimierzShip: 2, swiftShip: 2 }, '野鬃: both of its bonds');
    assert.deepEqual(of('chess_char_2_18_a'), {}, '灰毫 with no active bond');
    deploy(m, ps, ['chess_char_2_16_a', 'chess_char_3_18_a', 'chess_char_3_19_a']);
    assert.ok(ps.bonds.siracusaShip?.active);
    ps.layers.siracusaShip = 40;
    assert.equal(acquireLayers(m, ps, m.gd.chess('chess_char_2_18_a')).get('siracusaShip'), 3);
    assert.equal(acquireLayers(m, ps, m.gd.chess('chess_char_2_16_a')).size, 0, '拉普兰德 has no 获得时 layers');
  } finally { h.dispose?.(); }
});

test('小满 / 夕 on the board add their multiple per gained operator while 炎 is active; on the bench nothing', () => {
  const { h, m, ps } = solo();
  try {
    deploy(m, ps, ['chess_char_1_03_a', 'chess_char_2_04_a', 'chess_char_5_12_a']);
    assert.ok(ps.bonds.yanShip?.active);
    assert.equal(gainCountLayers(m, ps), 3, '小满 1 + 夕 2');
    const xiao = [...ps.board.entries()].find(([, p]) => p.id === 'chess_char_2_04_a');
    ps.board.delete(xiao[0]);
    ps.hand[0] = xiao[1];
    ps.recompute();
    assert.equal(gainCountLayers(m, ps), 0, 'two members left: 炎 inactive, and 小满 is benched');
  } finally { h.dispose?.(); }
});

test('refresh layers: 阿罗玛 per refresh up to its cap, 拉普兰德 on the first refresh of the round (bench too)', () => {
  const { h, m, ps } = solo();
  try {
    deploy(m, ps, ['chess_char_2_16_a', 'chess_char_3_18_a', 'chess_char_4_10_a']);
    assert.ok(ps.bonds.siracusaShip?.active && !ps.bonds.arcaneShip?.active);
    ps.round.refreshes = 0;
    assert.equal(refreshLayers(m, ps), 2 + 4, '阿罗玛 2 on 叙拉古, 拉普兰德 4');
    ps.round.refreshes = 2;
    assert.equal(refreshLayers(m, ps), 2, 'the third refresh still within 阿罗玛\'s 6');
    ps.round.refreshes = 3;
    assert.equal(refreshLayers(m, ps), 0, 'over the cap');
    ps.round.refreshes = 0;
    give(m, ps, 'chess_char_2_16_b', 'hand');
    ps.recompute();
    assert.equal(refreshLayers(m, ps), 2 + 4 + 8, 'a benched elite 拉普兰德 counts too');
  } finally { h.dispose?.(); }
});

test('before the level-up, 杜遥夜 takes its two rigged refreshes toward 炎; 歌利亚 takes none', () => {
  for (const [band, want] of [['band_duyaoy', 2], ['band_bldsk', 0]]) {
    const { h, m, ps } = solo();
    try {
      ps.bandId = band;
      // a full board of non-炎 pieces: the first pass buys nothing but merges (and 杜遥夜's new 炎 members)
      const fill = chessOfTier(1, (c) => !(c.bonds || []).includes('yanShip')).slice(0, ps.deployCap);
      deploy(m, ps, fill);
      ps.shop.level = 3; // 惊蛰 T1, 小满 T2, 诗怀雅 / 琳琅诗怀雅 T3 can come
      ps.funds = 9;
      ps.round.refreshes = 0;
      run(buyLoopSteps(m, ps, { fillOnly: true, maxRefreshes: 0 }));
      assert.equal(ps.round.refreshes, want, band);
    } finally { h.dispose?.(); }
  }
});

test('the main pass refreshes for 拉普兰德 + 阿罗玛 layers once (6 ≥ 4 per fund alone, §37.60), not again for 阿罗玛\'s 2', () => {
  const { h, m, ps } = solo();
  try {
    deploy(m, ps, ['chess_char_2_16_a', 'chess_char_3_18_a', 'chess_char_4_10_a']);
    ps.funds = 20;
    ps.round.refreshes = 0;
    ps.shop.frozen = false;
    run(buyLoopSteps(m, ps, { fillOnly: false, maxRefreshes: 0 }));
    assert.equal(ps.round.refreshes, 1);
  } finally { h.dispose?.(); }
});

// §37.60 [ASSUMED]: alone a layer trade or a refresh for layers has to pay 4 layers per fund; co-op keeps 3.
test('§37.60: the layer trade bar is 4 layers per fund alone, 3 in co-op', () => {
  const coopSeats = [0, 1].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true }));
  for (const [mode, seats, want] of [['solo', SEAT, 4], ['coop', coopSeats, 3]]) {
    const h = makeMatch({ mode, difficulty: 'ABYSS', seats, seed: 3 });
    try { assert.equal(tradeMin(h.m), want, mode); } finally { h.dispose?.(); }
  }
});

// §37.36 engine-first: a piece whose recurring or battle 特质 adds layers to the focus bond is worth more to buy and to field
// until the Final Assault (layers stop growing there).
test('engine-first: the text names the focus bond or the piece\'s own bonds; 获得时, layer-scaling and most-layered traits are not engines', () => {
  const { h, m } = solo();
  try {
    const is = (id, bond) => engineFor(m, m.gd.chess(id), bond);
    assert.ok(is('chess_char_2_04_a', 'yanShip'), '小满 <休整期结束时> 【炎】');
    assert.ok(is('chess_char_2_06_a', 'sargonShip') && is('chess_char_3_06_a', 'sargonShip'), '莎草 / 菲莱 skill starts');
    assert.ok(is('chess_char_3_12_a', 'kazimierzShip'), '瑕光 「自身已激活的盟约」 on a 卡西米尔 member');
    assert.ok(is('chess_char_2_16_a', 'siracusaShip'), '拉普兰德 on refresh');
    assert.ok(!is('chess_char_1_03_a', 'yanShip'), '惊蛰 is 获得时 (the layer trade)');
    assert.ok(!is('chess_char_2_08_a', 'sargonShip'), '泡泡 scales with layers, adds none');
    assert.ok(!is('chess_char_5_08_a', 'victoriaShip'), '号角 feeds the most-layered bond, not a named one');
    assert.ok(!is('chess_char_2_04_a', 'sargonShip'), 'another bond');
  } finally { h.dispose?.(); }
});

test('engine-first: an engine of the focus scores ENGINE_BONUS more before the Final Assault, a 获得时 unit does not', () => {
  const { h, m, ps } = solo();
  try {
    ps.bandId = 'band_duyaoy';
    const at = (round, id) => { m.round = round; ps._botFocus = null; return buyScoreOf(m, ps, id); };
    const real = m.round;
    const engine = at(m.gd.bossRound - 2, 'chess_char_2_04_a') - at(m.gd.bossRound, 'chess_char_2_04_a');
    const plain = at(m.gd.bossRound - 2, 'chess_char_1_03_a') - at(m.gd.bossRound, 'chess_char_1_03_a');
    m.round = real;
    assert.ok(Math.abs(engine - plain - 10) < 1e-9, `小满 ${engine} vs 惊蛰 ${plain}`);
  } finally { h.dispose?.(); }
});
