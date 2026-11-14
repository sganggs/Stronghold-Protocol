// test/match/show-tags.test.js — 规程's {showtag_value_N} texts (§37.201): the player's own piece views carry the live
// numbers (server/match/showTags.js) — 定期存折's pay now, the round counters of 风絮 / 安洁莉娜 / 溯光星源, the next
// grant of 极光 / 忍冬's upgrading 特质 — and records without such a text add no field (every other version's views stay
// as they were). Client side: test/ui/show-tags.test.js.
// Run: node --test test/match/show-tags.test.js

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData, setData, resetData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { createRegistry, resetDefaultRegistry } from '../../server/match/effectsMeta.js';
import { upgradeGive } from '../../server/sim/content/garrisons/meta.js';
import { hasShowTag } from '../../server/match/showTags.js';
import { makeMatch, give, giveItem } from './harness.js';

const QUIET = { warn() {}, error() {}, info() {} };
const V3 = getVersionData('act3autochess@V3_1', { log: QUIET });
setData(V3);
setGameData(V3);
const REG = createRegistry({ log: QUIET, builtins: true, content: false });
after(() => { setGameData(null); resetData(); resetDefaultRegistry(); });

const PASSBOOK = 'chess_item_3_15_e_a';
const FENGXU = 'chess_char_3_06_a';     // 风絮 garrison_36_a: 已获得{showtag_value_1}名 (round_gain_char)
const AURORA = 'chess_char_3_07_a';     // 极光 garrison_50_a: 【谢拉格】层数+{showtag_value_1} (count 1, +1 per trigger, max 11 more)
const RENDONG = 'chess_char_3_13_a';    // 忍冬 garrison_74_a: 获得{showtag_value_1}次免费刷新 (count 1, n 2, +1, max 2 more)
const ANGELINA = 'chess_char_4_25_a';   // 安洁莉娜 garrison_91_a + garrison_236_a: 已刷新{showtag_value_1}次
const SUGUANG = 'chess_char_5_18_a';    // 溯光星源 garrison_121_a: 已消耗{showtag_value_1}资金
const XIA = 'chess_char_1_11_a';        // no such text

function setup(seed = 41) {
  const h = makeMatch({ mode: 'solo', modeId: 'mode_single_1', humans: 1, seed, registry: REG, fake: true, data: V3 }).start();
  h.toPrep(1, { band: 'band_amiya' });
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
  ps.funds = 50; ps.layers = {}; ps.pendingFunds = 0; ps.shop.freeRefreshes = 0;
  ps.shop.level = 6; ps.bandId = null; ps.recompute();
  return { h, m: h.m, ps };
}

test('the records: 定期存折 and eight 特质 pairs carry the placeholder', () => {
  assert.ok(hasShowTag(V3.items[PASSBOOK].descRaw));
  const gs = Object.values(V3.garrisons).filter((g) => hasShowTag(g.descRaw || g.desc)).map((g) => g.garrisonId).sort();
  assert.deepEqual(gs, ['garrison_121_a', 'garrison_121_b', 'garrison_125_a', 'garrison_125_b', 'garrison_128_a', 'garrison_128_b',
    'garrison_236_a', 'garrison_236_b', 'garrison_36_a', 'garrison_36_b', 'garrison_50_a', 'garrison_50_b', 'garrison_74_a',
    'garrison_74_b', 'garrison_91_a', 'garrison_91_b']);
});

test('定期存折: the view carries what equipping pays now — its value, then +1 per round start held (hand and m.private)', () => {
  const { m, ps } = setup();
  try {
    const book = giveItem(m, ps, PASSBOOK);
    assert.deepEqual(ps.pieceView(book).showTag, [0]);
    m.dispatch(ps, 'onRoundStart', { round: 2 });
    m.dispatch(ps, 'onRoundStart', { round: 3 });
    assert.deepEqual(ps.pieceView(book).showTag, [2]);
    const inHand = ps.privateView().hand.find((p) => p && p.uid === book.uid);
    assert.deepEqual(inHand.showTag, [2]);
  } finally { m.dispose(); }
});

test('round counters: operators gained, refreshes, funds spent this round', () => {
  const { m, ps } = setup();
  try {
    const f = give(m, ps, FENGXU), a = give(m, ps, ANGELINA), s = give(m, ps, SUGUANG);
    ps.round.gainedChess = 3; ps.round.refreshes = 2; ps.round.spent = 7;
    assert.deepEqual(ps.pieceView(f).garrisonTags, { garrison_36_a: [3] });
    assert.deepEqual(ps.pieceView(a).garrisonTags, { garrison_91_a: [2], garrison_236_a: [2] });
    assert.deepEqual(ps.pieceView(s).garrisonTags, { garrison_121_a: [7] });
  } finally { m.dispose(); }
});

test('upgrading 特质: the next trigger\'s grant — 极光 1, 2, 3 … up to 12 in all; 忍冬 1, 1, then 2 up to 3 in all', () => {
  const { m, ps } = setup();
  try {
    const au = give(m, ps, AURORA), rd = give(m, ps, RENDONG);
    assert.deepEqual(ps.pieceView(au).garrisonTags, { garrison_50_a: [1] });
    assert.deepEqual(ps.pieceView(rd).garrisonTags, { garrison_74_a: [1] });
    au.meta.gar = { garrison_50_a: { fired: 2, sum: 3 } };
    assert.deepEqual(ps.pieceView(au).garrisonTags, { garrison_50_a: [3] });
    au.meta.gar.garrison_50_a = { fired: 5, sum: 11 };
    assert.deepEqual(ps.pieceView(au).garrisonTags, { garrison_50_a: [1] }, 'only 1 of the 12 left');
    rd.meta.gar = { garrison_74_a: { fired: 2, sum: 2 } };
    assert.deepEqual(ps.pieceView(rd).garrisonTags, { garrison_74_a: [1] }, 'the third trigger: 2 wanted, 1 left of 3');
    // the formula the handlers count with
    const bb50 = V3.garrisons.garrison_50_a.bb;
    let st = { fired: 0, sum: 0 };
    const gives = [];
    for (let i = 0; i < 6; i++) { const g = upgradeGive(st, bb50); gives.push(g); st = { fired: st.fired + 1, sum: st.sum + g }; }
    assert.deepEqual(gives, [1, 2, 3, 4, 2, 0]);
  } finally { m.dispose(); }
});

test('no placeholder, no field: an operator without such a 特质, an item without such a text', () => {
  const { m, ps } = setup();
  try {
    const x = give(m, ps, XIA);
    assert.equal(Object.hasOwn(ps.pieceView(x), 'garrisonTags'), false);
    const other = Object.values(V3.items).find((r) => r.itemType === 'EQUIP' && !r.isGolden && !hasShowTag(r.descRaw || r.desc) && r.id !== PASSBOOK);
    const it = giveItem(m, ps, other.id);
    assert.equal(Object.hasOwn(ps.pieceView(it), 'showTag'), false);
  } finally { m.dispose(); }
});
