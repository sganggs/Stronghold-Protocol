// §37.69 solo 终极: 杰西卡 for 谢拉格 (the owner, 2026-11-03). The solo AI seat drafts 杰西卡 whenever the shared pool can
// still supply 6 distinct 谢拉格 members of tier ≤ 5, builds 谢拉格 from R1, puts each 寻呼模块 on the member most likely to
// bring a missing one and takes that one from the offer, buys a missing member the shop shows and never sells the last
// copy of a member.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botPickBand, botPrepBegin, buyLoopSteps, itemTarget, resolveTemp, sellWeakestHand } from '../../server/match/bot.js';
import { makeMatch, give, giveItem } from './harness.js';

const PAGER_BAND = 'band_jesica', KJERAG = 'kjeragShip', PAGER = 'chess_item_4_01_e_a';
const SILVERASH = 'chess_char_4_22_a'; // 银灰: 谢拉格 only
const MATTERHORN = 'chess_char_1_02_a'; // 角峰: 谢拉格 + 坚守
const OTHERS = ['chess_char_4_20_b', 'chess_char_4_14_a', 'chess_char_4_21_a', 'chess_char_3_12_a']; // no 谢拉格
const seat = (o = {}) => [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true, ...o }];
const isMember = (m, id) => (m.gd.chess(id)?.bonds || []).includes(KJERAG);

/** Distinct 谢拉格 members of tier ≤ 5 the match's pool still holds. */
function reach(m) {
  let n = 0;
  for (const [id, e] of m.pool.entries) if (e.left > 0 && e.tier <= 5 && isMember(m, id)) n++;
  return n;
}
/** Distinct 谢拉格 members a seat owns. */
const members = (m, ps) => new Set(ps.allChess().filter((p) => isMember(m, p.id)).map((p) => m.gd.baseIdOf(p.id))).size;

/**
 * A solo match at the prep of round `r`, its AI seat on `band` with an empty board and hand and a shop of `level` (a
 * 寻呼模块 offers chess up to the shop level; seed 1: the drawn bans leave 谢拉格 in the pool).
 */
function prepAt(r, { difficulty = 'ABYSS', band = PAGER_BAND, seed = 1, level = 3 } = {}) {
  const h = makeMatch({ mode: 'solo', difficulty, seats: seat(), seed }).start().toPrep();
  const m = h.m, ps = m.order[0];
  m.startRound(r);
  m.phase = 'PREP'; // the round's prep (startRound leaves the round start)
  ps.bandId = band;
  ps._botPager = undefined;
  ps.shop.level = level;
  for (const p of [...ps.hand, ...ps.temp]) if (p) tryRemove(ps, p);
  for (const [, p] of [...ps.board]) if (p.kind === 'chess') tryRemove(ps, p);
  ps.recompute();
  return { h, m, ps };
}
function tryRemove(ps, p) {
  const loc = ps.find(p.uid);
  if (!loc) return;
  ps.returnCopies?.(p);
  if (loc.area === 'board') ps.board.delete(loc.key);
  else if (loc.area === 'hand') ps.hand[loc.idx] = null;
  else if (loc.area === 'temp') ps.temp[loc.idx] = null;
}

test('§37.69: the solo 终极 AI seat drafts 杰西卡 while the pool can supply 6 谢拉格', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seats: seat(), seed: 1 });
  try {
    const { m } = h;
    const ps = m.order[0];
    assert.ok(m.gd.bandIds().includes(PAGER_BAND));
    assert.ok(reach(m) >= 6, `seed 1 leaves ${reach(m)} members`);
    for (let i = 0; i < 40; i++) assert.equal(botPickBand(m, ps), PAGER_BAND);
    // fewer than 6 left (a drawn 本局禁用 谢拉格 bans the single-bond ones): the weights decide, and they rarely take it
    const live = [...m.pool.entries].filter(([id, e]) => e.left > 0 && e.tier <= 5 && isMember(m, id));
    for (const [, e] of live.slice(0, live.length - 5)) e.left = 0;
    assert.equal(reach(m), 5);
    const hits = Array.from({ length: 200 }, () => botPickBand(m, ps)).filter((id) => id === PAGER_BAND).length;
    assert.ok(hits < 20, `${hits} of 200`);
  } finally { h.m.dispose(); }
});

test('§37.69: 杰西卡 for 谢拉格 is a solo 终极 rule of the AI\'s own seat', () => {
  const pick = (o) => {
    const h = makeMatch({ seed: 1, ...o });
    try {
      const ps = h.m.order.find((p) => p.isBot && !o.autoplay) || h.m.order[0];
      if (o.autoplay) ps.autoplay = true;
      return Array.from({ length: 200 }, () => botPickBand(h.m, ps)).filter((id) => id === PAGER_BAND).length;
    } finally { h.m.dispose(); }
  };
  assert.ok(pick({ mode: 'solo', difficulty: 'HARD', seats: seat() }) < 20, '绝境 and below: the weights');
  assert.ok(pick({ mode: 'solo', difficulty: 'ABYSS', seats: seat({ isBot: false }), autoplay: true }) < 20, 'not a human seat under AI 托管');
  const bots = Array.from({ length: 4 }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI-${i}`, isBot: true, connected: true }));
  assert.ok(pick({ mode: 'coop', difficulty: 'ABYSS', seats: bots }) < 20, 'not in co-op');
});

test('§37.69: a 寻呼模块 goes on the member most likely to bring a missing one; none without a member', () => {
  const { h, m, ps } = prepAt(5);
  try {
    const pager = giveItem(m, ps, PAGER);
    for (const id of OTHERS.slice(0, 2)) give(m, ps, id, 'hand');
    assert.equal(itemTarget(m, ps, pager), null, 'no 谢拉格 member yet: the item waits (another carrier draws other bonds)');
    give(m, ps, MATTERHORN, 'hand');
    const silver = give(m, ps, SILVERASH, 'hand');
    // 银灰's offer is all 谢拉格; 角峰's also draws 坚守 operators
    assert.equal(itemTarget(m, ps, pager)?.uid, silver.uid);
  } finally { h.m.dispose(); }
});

test('§37.69: at the prep start the 杰西卡 seat equips its 寻呼模块 and takes a missing member from the offer', () => {
  const { h, m, ps } = prepAt(5);
  try {
    give(m, ps, MATTERHORN, 'hand');
    give(m, ps, SILVERASH, 'hand');
    const pager = giveItem(m, ps, PAGER);
    assert.equal(members(m, ps), 2);
    // nothing else can bring a member this prep: an empty shop and no funds
    ps.shop.slots = [];
    ps.rollShop = () => { ps.shop.slots = []; };
    ps.funds = 0;
    botPrepBegin(m, ps);
    assert.equal(ps.find(pager.uid), null, 'the 寻呼模块 is used');
    // three distinct 谢拉格 members are offered and only two are owned: one is new
    assert.ok(members(m, ps) >= 3, `members ${members(m, ps)}`);
  } finally { h.m.dispose(); }
});

test('§37.69: the 杰西卡 seat keeps its last copy of a 谢拉格 member when it sells the weakest single', () => {
  for (const band of [PAGER_BAND, 'band_bldsk']) {
    const { h, m, ps } = prepAt(6, { band });
    try {
      const horn = give(m, ps, MATTERHORN, 'hand'); // a 1-tier single: the weakest by value
      for (const id of OTHERS) give(m, ps, id, 'hand');
      sellWeakestHand(m, ps, { handOnly: true });
      if (band === PAGER_BAND) assert.ok(ps.find(horn.uid), 'the member stays');
      else assert.equal(ps.find(horn.uid), null, 'another strategy sells it as before');
    } finally { h.m.dispose(); }
  }
});

test('§37.69: the 杰西卡 seat buys a missing member the shop shows, and keeps one it cannot pay for the next round', () => {
  const id = 'chess_char_3_11_a'; // 雪猎
  const shop = (m, ps, funds) => {
    for (const o of OTHERS) give(m, ps, o, 'hand');
    ps.shop.slots = [{ kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false }];
    ps.rollShop = () => { ps.shop.slots = []; };
    ps.funds = funds;
  };
  let h, m, ps;
  ({ h, m, ps } = prepAt(6));
  try {
    shop(m, ps, 20);
    botPrepBegin(m, ps);
    assert.ok(ps.allChess().some((p) => m.gd.baseIdOf(p.id) === id), 'bought');
  } finally { h.m.dispose(); }
  for (const band of [PAGER_BAND, 'band_bldsk']) {
    ({ h, m, ps } = prepAt(6, { band }));
    try {
      shop(m, ps, 1);
      botPrepBegin(m, ps);
      assert.equal(!!ps.shop.frozen, band === PAGER_BAND, band === PAGER_BAND ? 'the unaffordable member is frozen' : 'another strategy does not freeze it');
    } finally { h.m.dispose(); }
  }
});

test('§37.69: a missing member the 杰西卡 seat cannot pay is not refreshed away before the freeze keeps it', () => {
  const { h, m, ps } = prepAt(11, { level: 5 });
  try {
    give(m, ps, SILVERASH, 'hand');
    give(m, ps, MATTERHORN, 'hand');
    const id = 'chess_char_5_14_a'; // 凛御银灰, price 4
    ps.shop.slots = [{ kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false }];
    ps.rollShop = () => { ps.shop.slots = [{ kind: 'chess', id: OTHERS[0], basePrice: m.gd.chessPrice(OTHERS[0]), frozen: false, sold: false }]; };
    ps.funds = 3; // a refresh (1) is affordable, the member (4) is not
    botPrepBegin(m, ps);
    assert.equal(ps.shop.slots[0]?.id, id, 'the member is still shown');
    assert.ok(ps.shop.frozen, 'and kept for the next round');
  } finally { h.m.dispose(); }
});

test('§37.69: a temp 谢拉格 member of the 杰西卡 seat goes before a copy of a pair only when nothing else can go', () => {
  const { h, m, ps } = prepAt(7);
  try {
    // five pairs of normal (not elite) operators: nothing the weakest-single sale may take
    for (const id of ['chess_char_4_20_a', 'chess_char_4_14_a', 'chess_char_4_21_a', 'chess_char_3_12_a', 'chess_char_3_01_a']) { give(m, ps, id, 'hand'); give(m, ps, id, 'hand'); }
    assert.equal(ps.hand.filter(Boolean).length, ps.hand.length, 'a hand of pairs');
    ps.funds = 0;
    const horn = give(m, ps, MATTERHORN, 'temp');
    resolveTemp(m, ps);
    assert.ok(ps.find(horn.uid), 'the member stays (a copy of a pair is sold instead)');
  } finally { h.m.dispose(); }
});

test('§37.69: the hunt never sells a piece carrying equipment to make room (its items would refill the slot)', () => {
  const { h, m, ps } = prepAt(6, { level: 3 });
  try {
    for (const id of ['chess_char_3_12_a', 'chess_char_3_01_a', 'chess_char_3_02_a', 'chess_char_3_03_a']) { give(m, ps, id, 'hand'); give(m, ps, id, 'hand'); }
    give(m, ps, MATTERHORN, 'hand');
    const carrier = give(m, ps, 'chess_char_2_01_a', 'hand');
    const hammer = giveItem(m, ps, 'chess_item_1_01_e_a', 'temp');
    assert.ok(!ps.equip(hammer.uid, carrier.uid)?.error, 'the tier-2 single carries 维式重锤');
    assert.equal(ps.hand.filter(Boolean).length, ps.hand.length, 'a full hand');
    const id = 'chess_char_3_11_a'; // 雪猎
    ps.shop.slots = [{ kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false }];
    ps.funds = 20;
    for (const _ of buyLoopSteps(m, ps, { fillOnly: true })) { /* run the pass */ }
    assert.ok(ps.find(carrier.uid), 'the carrier stays');
  } finally { h.m.dispose(); }
});
