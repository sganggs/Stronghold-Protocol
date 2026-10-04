// Merges (精锐), reward offers, item equip/replace/merge, consume-on-equip items (research 01 §7 + A1, 04 §2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier, legalTileFor } from './harness.js';
import { canPlace, placeClass } from '../../server/match/board.js';

function prep(seed = 21, o = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed, ...o }).start();
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  ps.funds = 100;
  return { h, m: h.m, ps };
}

/** Put chess `id` into shop slot 0 at its normal price. */
function stock(m, ps, id, slot = 0) {
  ps.shop.slots[slot] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false };
}

test('3 copies (board + hand + bought) merge into 1 elite on the board copy\'s tile; equipment returns; reward offer of tier level+1', () => {
  const { m, ps } = prep();
  const id = chessOfTier(1, (c) => c.position === 'MELEE').find((x) => m.pool.has(x));
  const cap = m.pool.cap(id);
  const a = give(m, ps, id, 'board', [9, 3]);
  a.dir = 'UP';
  const b = give(m, ps, id);
  const it1 = giveItem(m, ps, 'chess_item_1_01_e_a');
  const it2 = giveItem(m, ps, 'chess_item_1_02_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: it1.uid, targetUid: a.uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: it2.uid, targetUid: b.uid }), { ok: true });
  stock(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  const golden = DATA.chess[id].goldenId;
  // PRTS 卫戍协议/帮助: "若消耗已部署至作战区的干员，则发送至作战区对应位置"
  const elite = ps.board.get('9,3');
  assert.ok(elite && elite.id === golden, 'the elite took the consumed board copy\'s tile');
  assert.notEqual(elite.uid, a.uid, 'a new piece (the copy was destroyed)');
  assert.equal(elite.dir, 'UP', 'with that copy\'s facing');
  assert.ok(!ps.hand.some((p) => p && p.kind === 'chess'), 'no chess left in the hand');
  assert.equal(ps.deployCount, 1, 'the deploy count is unchanged');
  assert.equal(elite.poolCopies, 3);
  assert.equal(m.pool.left(id), cap - 3);
  assert.equal(ps.countCopies(id), 0);
  assert.ok(ps.hand.some((p) => p && p.uid === it1.uid) && ps.hand.some((p) => p && p.uid === it2.uid), 'equipment returned to the hand');
  assert.equal(elite.items.length, 0);
  assert.equal(ps.stats.merges, 1);
  const offer = ps.privateView().shop.rewardOffer;
  assert.ok(offer);
  assert.equal(offer.tier, Math.min(ps.shop.level + 1, 6));
  assert.equal(offer.slots.length, 3);
  for (const s of offer.slots) { assert.equal(s.price, 0); assert.equal(DATA.chess[s.id].tier <= offer.tier, true); }
  // take one reward (free), the offer is consumed
  const funds = ps.funds;
  const pick = offer.slots[1].id;
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 1 }), { ok: true });
  assert.equal(ps.funds, funds);
  assert.ok(ps.hand.some((p) => p && p.id === pick) || ps.hand.some((p) => p && p.id === DATA.chess[pick].goldenId));
  assert.equal(ps.privateView().shop.rewardOffer, null);
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }).error, ERR.BAD_TARGET);
  checkInvariants(m);
  m.dispose();
});

test('elites never merge; 风丸 merges with 2 copies; a full hand still buys the merge-completing copy', () => {
  const { m, ps } = prep(22);
  const id = chessOfTier(2).find((x) => m.pool.has(x) && x !== 'chess_char_2_11_a');
  const golden = DATA.chess[id].goldenId;
  give(m, ps, golden);
  give(m, ps, golden);
  stock(m, ps, golden);
  m.handle('p_0', { t: 'g.buy', slot: 0 });
  assert.equal(ps.hand.filter((p) => p && p.id === golden).length, 3, 'three elites stay three elites');
  // 风丸 (chess_char_2_11_a) upgradeNum 2
  if (m.pool.has('chess_char_2_11_a')) {
    give(m, ps, 'chess_char_2_11_a');
    stock(m, ps, 'chess_char_2_11_a');
    m.handle('p_0', { t: 'g.buy', slot: 0 });
    assert.ok(ps.hand.some((p) => p && p.id === DATA.chess.chess_char_2_11_a.goldenId), '风丸 elite after 2 copies');
  }
  // full hand + 2 copies in the hand: buying the 3rd completes the merge (net −1)
  for (const p of ps.hand) if (p) ps.returnCopies(p);
  ps.hand.fill(null);
  const x = chessOfTier(1).filter((c) => m.pool.has(c));
  const target = x[0];
  give(m, ps, target);
  give(m, ps, target);
  for (let i = 1; ps.hand.some((p) => p == null); i++) give(m, ps, x[i]);
  assert.ok(ps.hand.every(Boolean));
  stock(m, ps, x[20] || x[x.length - 1], 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 1 }), { error: ERR.HAND_FULL });
  stock(m, ps, target, 0);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.ok(ps.hand.some((p) => p && p.id === DATA.chess[target].goldenId));
  assert.equal(ps.hand.filter(Boolean).length, 9);
  assert.ok(ps.tempEmpty);
  checkInvariants(m);
  m.dispose();
});

test('merge from two board copies with a full hand: the elite takes the copy that deploys first (no overflow, one tile freed)', () => {
  const { m, ps } = prep(23);
  const ids = chessOfTier(1, (c) => c.position === 'MELEE').filter((c) => m.pool.has(c));
  const id = ids[0];
  const a = give(m, ps, id, 'board', [9, 4]);
  const b = give(m, ps, id, 'board', [9, 3]);
  a.dir = 'LEFT';
  b.dir = 'DOWN';
  const others = chessOfTier(2).filter((c) => m.pool.has(c));
  for (let i = 0; ps.hand.some((p) => p == null); i++) give(m, ps, others[i]);
  stock(m, ps, id);
  assert.equal(ps.deployCount, 2);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  // deploy order = by column from the left (col asc, then row desc; Battle.start): (9,3) before (9,4) — [ASSUMED] the copy
  // the battle deploys first
  const elite = ps.board.get('9,3');
  assert.ok(elite && elite.id === DATA.chess[id].goldenId, 'the elite stands on (9,3)');
  assert.equal(elite.dir, 'DOWN', 'with the facing of the copy that stood there');
  assert.ok(!ps.board.has('9,4'), 'the other copy\'s tile is free');
  assert.equal(ps.deployCount, 1, 'two deployed copies became one deployed elite');
  assert.ok(ps.tempEmpty, 'nothing overflowed');
  assert.equal(ps.hand.filter(Boolean).length, 10, 'the full hand is untouched');
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  checkInvariants(m);
  m.dispose();
});

test('merge whose copies are not deployed (temp) with a full hand overflows the elite into temp (blocks ready until resolved)', () => {
  const { m, ps } = prep(23);
  const ids = chessOfTier(1, (c) => c.position === 'MELEE').filter((c) => m.pool.has(c));
  const id = ids[0];
  give(m, ps, id, 'temp', 0);
  give(m, ps, id, 'temp', 1);
  const others = chessOfTier(2).filter((c) => m.pool.has(c));
  for (let i = 0; ps.hand.some((p) => p == null); i++) give(m, ps, others[i]);
  stock(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.ok(ps.temp.some((p) => p && p.id === DATA.chess[id].goldenId), 'elite overflowed into temp');
  assert.equal(ps.board.size, 0, 'nothing was deployed');
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { error: ERR.TEMP_NOT_EMPTY });
  checkInvariants(m);
  m.dispose();
});

test('reward pick respects the pool and a full hand; offers expire at prep end', () => {
  const { h, m, ps } = prep(24);
  ps.pushRewardOffer('merge');
  const offer = ps.offers[0];
  const id0 = offer.slots[0].id;
  const taken = m.pool.take(id0, 100);
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), { error: ERR.SOLD_OUT });
  m.pool.give(id0, taken);
  const others = chessOfTier(3).filter((c) => m.pool.has(c) && !offer.slots.some((s) => s.id === c));
  for (let i = 0; ps.hand.some((p) => p == null); i++) give(m, ps, others[i]);
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), { error: ERR.HAND_FULL });
  ps.hand[0] && ps.returnCopies(ps.hand[0]);
  ps.hand[0] = null;
  ps.recompute();
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  h.sched.runNext();
  h.sched.runNext();
  assert.equal(ps.offers.length, 0, 'offer gone at prep end');
  checkInvariants(m);
  m.dispose();
});

test('equipment: max 2 (a third replaces the oldest), identical normal items merge into golden — also when equipped', () => {
  const { m, ps } = prep(25);
  const id = chessOfTier(3).find((c) => m.pool.has(c));
  const a = give(m, ps, id);
  const i1 = giveItem(m, ps, 'chess_item_1_01_e_a');
  const i2 = giveItem(m, ps, 'chess_item_1_02_e_a');
  const i3 = giveItem(m, ps, 'chess_item_3_03_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i1.uid, targetUid: a.uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i2.uid, targetUid: a.uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i3.uid, targetUid: a.uid }), { ok: true });
  assert.deepEqual(a.items.map((x) => x.id), ['chess_item_1_02_e_a', 'chess_item_3_03_e_a'], 'oldest replaced (destroyed)');
  assert.ok(!ps.find(i1.uid), 'the replaced item is gone');
  // equip a second 坚守盾牌 onto the same carrier → merges into the golden version in the hand
  const i4 = giveItem(m, ps, 'chess_item_1_02_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i4.uid, targetUid: a.uid }), { ok: true });
  assert.ok(ps.hand.some((p) => p && p.id === 'chess_item_1_02_e_b'), 'golden item in the hand');
  assert.ok(!a.items.some((x) => x.id === 'chess_item_1_02_e_a'));
  assert.equal(ps.stats.itemMerges, 1);
  // buying an item whose twin is in the hand merges immediately (and works with a full hand)
  const i5 = giveItem(m, ps, 'chess_item_2_03_e_a');
  const others = chessOfTier(1).filter((c) => m.pool.has(c));
  for (let i = 0; ps.hand.some((p) => p == null); i++) give(m, ps, others[i]);
  ps.shop.slots[0] = { kind: 'item', id: 'chess_item_2_03_e_a', basePrice: 2, frozen: false, sold: false };
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.ok(ps.hand.some((p) => p && p.id === 'chess_item_2_03_e_b'));
  assert.ok(!ps.find(i5.uid));
  // golden items never merge again; non-mergeable items (upgradeNum 100) never merge
  const g2 = giveItem(m, ps, 'chess_item_2_03_e_b', 'temp');
  ps.checkItemMerges();
  assert.equal([...ps.hand, ...ps.temp].filter((p) => p && p.id === 'chess_item_2_03_e_b').length, 2);
  void g2;
  // bad targets
  const it = ps.hand.find((p) => p && p.kind === 'item');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: it.uid }).error, ERR.BAD_TARGET);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: a.uid, targetUid: a.uid }).error, ERR.BAD_TARGET);
  checkInvariants(m);
  m.dispose();
});

test('变形同构体 grants the bond of the other equipped item (bond counting)', () => {
  const { m, ps } = prep(26);
  const id = chessOfTier(1, (c) => !c.bonds.includes('victoriaShip') && c.position === 'MELEE').find((c) => m.pool.has(c));
  const a = give(m, ps, id, 'board', [9, 3]);
  const iso = giveItem(m, ps, 'chess_item_6_09_e_a');
  const hammer = giveItem(m, ps, 'chess_item_1_01_e_a');
  const before = ps.bonds.victoriaShip ? ps.bonds.victoriaShip.count : 0;
  m.handle('p_0', { t: 'g.equip', itemUid: iso.uid, targetUid: a.uid });
  m.handle('p_0', { t: 'g.equip', itemUid: hammer.uid, targetUid: a.uid });
  assert.equal(ps.bonds.victoriaShip.count, before + 1, 'wearer counts as a 维多利亚 member');
  m.dispose();
});

// The 调和 operator herself as the wearer (case from PR #40 by @shanzhaikabi; GitHub issue #1): the granted membership
// counts once and, 维多利亚 being a core bond with a member on the board, 调和 adds its +1 (bondsMeta `harmony`).
test('缪尔赛思 wearing 变形同构体 + 维式重锤 counts twice for 维多利亚: the granted member + 调和\'s +1', () => {
  const MIRA = 'chess_char_6_11_a'; // 缪尔赛思: own bond 调和 (maniShip, thresholds [1])
  const { m, ps } = prep(28);
  const tile = legalTileFor(m, ps, MIRA);
  assert.ok(tile, 'a legal tile for 缪尔赛思');
  const mira = give(m, ps, MIRA, 'board', tile);
  const iso = giveItem(m, ps, 'chess_item_6_09_e_a');
  const hammer = giveItem(m, ps, 'chess_item_1_01_e_a');
  assert.equal(ps.bonds.maniShip.active, true, '调和 is active with one 调和 operator on the board');
  assert.equal(ps.bonds.victoriaShip?.count ?? 0, 0, 'no 维多利亚 member before the second item');
  m.handle('p_0', { t: 'g.equip', itemUid: iso.uid, targetUid: mira.uid });
  m.handle('p_0', { t: 'g.equip', itemUid: hammer.uid, targetUid: mira.uid });
  assert.equal(ps.bonds.victoriaShip.count, 2, 'one from the granted membership, one from 调和');
  assert.equal(ps.bonds.victoriaShip.harmony, 1, 'the state says which +1 came from 调和');
  assert.equal(ps.bonds.victoriaShip.active, false, 'tier 1 still needs 3');
  checkInvariants(m);
  m.dispose();
});

test('consume-on-equip built-ins: 盟约之币 funds, 随身身份牌 layers, 人事部文档 cap 9, 博士投影 promote; Arts limit', () => {
  const { m, ps } = prep(27);
  const id = chessOfTier(2).find((c) => m.pool.has(c));
  const a = give(m, ps, id);
  ps.funds = 0;
  const coin = giveItem(m, ps, 'chess_item_1_03_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: coin.uid, targetUid: a.uid }), { ok: true });
  assert.equal(ps.funds, 1);
  assert.equal(a.items.length, 0, 'consumed, no slot used');
  assert.ok(!ps.find(coin.uid));
  const tag = giveItem(m, ps, 'chess_item_1_04_e_b');
  m.handle('p_0', { t: 'g.equip', itemUid: tag.uid, targetUid: a.uid });
  for (const b of DATA.chess[id].bonds) assert.equal(ps.layers[b], 6, `${b} +6 layers (无需激活)`);
  const hr = giveItem(m, ps, 'chess_item_6_08_e_a');
  m.handle('p_0', { t: 'g.equip', itemUid: hr.uid, targetUid: a.uid });
  assert.equal(ps.deployCap, 9);
  const holo = giveItem(m, ps, 'chess_item_5_06_e_b');
  m.handle('p_0', { t: 'g.equip', itemUid: holo.uid, targetUid: a.uid });
  assert.equal(a.id, DATA.chess[id].goldenId, 'golden 博士投影 promotes immediately');
  assert.equal(a.poolCopies, 3);
  const holo2 = giveItem(m, ps, 'chess_item_5_06_e_b');
  assert.equal(m.handle('p_0', { t: 'g.equip', itemUid: holo2.uid, targetUid: a.uid }).error, ERR.BAD_TARGET, 'already elite');
  // normal 博士投影: stays equipped, promotes at the next round start
  const b = give(m, ps, chessOfTier(3).find((c) => m.pool.has(c)));
  const holo3 = giveItem(m, ps, 'chess_item_5_06_e_a');
  m.handle('p_0', { t: 'g.equip', itemUid: holo3.uid, targetUid: b.uid });
  assert.equal(b.items.length, 1);
  ps.hand.forEach((p, i) => { if (p && p.kind === 'item') ps.hand[i] = null; });
  checkInvariants(m);
  m.handle('p_0', { t: 'g.ready', ready: true });
  const h = { sched: m.sched };
  h.sched.runUntil(() => m.phase === PHASE.PREP && m.round === 2, { maxSteps: 1e6 });
  // the bot-free solo round needs a combat → it ran; now at R2
  assert.equal(b.id, DATA.chess[b.id].goldenId ? b.id : b.id);
  assert.ok(m.gd.isGolden(b.id), 'promoted at the round start');
  assert.equal(b.items.length, 0);
  // Arts: at most 2 per round; unimplemented handlers are rejected cleanly
  const art = giveItem(m, ps, 'chess_item_6_02_m');
  const board = [...ps.board.entries()].find(([, p]) => p.kind === 'chess');
  let target = board;
  if (!target) { const c = give(m, ps, chessOfTier(1, (x) => x.position === 'MELEE').find((x) => m.pool.has(x)), 'board', [9, 3]); target = ['9,3', c]; }
  const [r, c] = target[0].split(',').map(Number);
  const res = m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: r, col: c });
  assert.deepEqual(res, { ok: true }, '画卷 copies the operator');
  assert.ok(!ps.find(art.uid));
  const art2 = giveItem(m, ps, 'chess_item_6_02_m');
  assert.equal(m.handle('p_0', { t: 'g.art', itemUid: art2.uid, row: 12, col: 10 }).error, ERR.BAD_TARGET, 'no operator in range');
  assert.equal(m.handle('p_0', { t: 'g.art', itemUid: art2.uid, row: 1, col: 1 }).error, ERR.BAD_TILE);
  assert.equal(m.handle('p_0', { t: 'g.art', itemUid: a.uid, row: r, col: c }).error, ERR.BAD_TARGET);
  checkInvariants(m);
  m.dispose();
});

test('item merge with a full hand AND a full temp: the golden item takes the equipped twin\'s slot instead of being lost', () => {
  const { m, ps } = prep(29);
  const id = chessOfTier(3).find((c) => m.pool.has(c));
  const carrier = give(m, ps, id, 'board', [10, 3]);
  const twin = giveItem(m, ps, 'chess_item_1_02_e_a');
  const keep = giveItem(m, ps, 'chess_item_1_01_e_a');
  ps._detach(ps.find(twin.uid));
  ps._detach(ps.find(keep.uid));
  carrier.items.push(keep, twin);
  const fill = chessOfTier(1).filter((c) => m.pool.has(c));
  for (let i = 0; ps.hand.some((p) => p == null); i++) give(m, ps, fill[i]);
  const fill2 = chessOfTier(2).filter((c) => m.pool.has(c));
  for (let i = 0; ps.temp.some((p) => p == null); i++) give(m, ps, fill2[i], 'temp');
  ps.recompute();
  const got = ps.acquireItem('chess_item_1_02_e_a', { source: 'grant' });
  assert.ok(got && got.id === 'chess_item_1_02_e_b', 'the merge produced the golden item');
  assert.deepEqual(carrier.items.map((x) => x.id), ['chess_item_1_01_e_a', 'chess_item_1_02_e_b'], 'golden item equipped in the twin\'s slot');
  assert.ok(!ps.find(twin.uid), 'the twin was consumed');
  assert.equal(ps.stats.itemMerges, 1);
  checkInvariants(m);
  m.dispose();
});

test('a merge completed during SETTLE (突变细胞) keeps its reward offer for the next prep; the elite takes a deployed copy\'s tile (never the carrier\'s) or goes to the hand', () => {
  const X = 'chess_char_2_04_a';
  const fillers = Object.values(DATA.items).filter((i) => i.itemType === 'EQUIP' && !i.isGolden && !String(i.kind || '').startsWith('consume')).map((i) => i.itemId ?? i.id).filter(Boolean);
  // where the carrier of 突变细胞 and the two copies of X are: hand/hand, board/hand, board/board
  for (const [carrierAt, copiesAt] of [['hand', 'hand'], ['board', 'hand'], ['board', 'board']]) {
    const label = `carrier ${carrierAt}, copies ${copiesAt}`;
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 3, fake: true }).start();
    const m = h.m;
    h.toPrep(1);
    const ps = h.ps('p_0');
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear();
    ps.hand.fill(null);
    ps.recompute();
    // the mutation's tier+1 roll can only give X
    const saved = new Map();
    for (const [base, e] of m.pool.entries) if (e.tier === 2 && base !== X) { saved.set(base, e.left); e.left = 0; }
    const T = chessOfTier(1, (c) => !m.gd.placeableTokens(c.chessId).length).find((id) => m.pool.has(id));
    const holder = carrierAt === 'board' ? give(m, ps, T, 'board', legalTileFor(m, ps, T)) : give(m, ps, T);
    holder.items.push(ps.newPiece('item', 'chess_item_5_08_e_a'));
    const copies = copiesAt === 'board' ? [0, 1].map(() => give(m, ps, X, 'board', legalTileFor(m, ps, X))) : [give(m, ps, X), give(m, ps, X)];
    // the carrier is destroyed before its gain (PRTS 备注 "原干员销毁，获得一名…"): only the copies' tiles count
    const holderTile = ps.find(holder.uid).key || null;
    const deployedTiles = copies.map((p) => ps.find(p.uid)).filter((l) => l.area === 'board').map((l) => l.key);
    const deployed0 = ps.deployCount;
    for (let i = 0; ps.hand.some((x) => x == null); i++) giveItem(m, ps, fillers[i]);
    const fillers0 = ps.hand.filter((p) => p && p.kind === 'item').length;
    let atSettle = null;
    const settle = m.settle.bind(m);
    m.settle = (...a) => { const r = settle(...a); atSettle = { offers: ps.offers.map((o) => o.source), merges: ps.stats.merges }; return r; };
    h.toPrep(2);
    for (const [base, left] of saved) m.pool.entries.get(base).left = left;
    assert.deepEqual(atSettle, { offers: ['merge'], merges: 1 }, `${label}: the transform completed a merge in SETTLE`);
    const elite = ps.allChess().find((p) => p.id === m.gd.goldenIdOf(X));
    assert.ok(elite, 'the elite survived the round start');
    assert.deepEqual(ps.offers.map((o) => o.source), ['merge'], 'the promotion reward waits for this prep');
    assert.ok(ps.privateView().shop.rewardOffer, 'and is shown');
    const loc = ps.find(elite.uid);
    if (holderTile) assert.ok(!ps.board.has(holderTile), `${label}: the carrier's tile is empty`);
    if (deployedTiles.length) {
      // PRTS 卫戍协议/帮助: a merge consuming a deployed copy sends the elite to that copy's tile — outside PREP too; of
      // several, the first in deploy order (col asc, then row desc — by column from the left, Battle.start)
      const map = ps.deployMap();
      const pos = placeClass(ps, m.gd.chess(elite.id));
      const legal = deployedTiles.map((k) => k.split(',').map(Number)).filter(([r, c]) => canPlace(map, pos, r, c)).sort((a, b) => a[1] - b[1] || b[0] - a[0]);
      assert.ok(legal.length, `${label}: a legal deployed tile exists`);
      assert.equal(loc.area, 'board', `${label}: the elite stands on the board`);
      assert.equal(loc.key, `${legal[0][0]},${legal[0][1]}`, `${label}: on the first deployed tile in deploy order`);
      assert.ok(ps.deployCount <= deployed0, `${label}: the deploy count did not grow (${ps.deployCount} ≤ ${deployed0})`);
    } else {
      assert.equal(loc.area, 'hand', `${label}: the consumed hand pieces freed the slots`);
    }
    // the carrier's deployment is gone; deployed copies were replaced by at most the one elite
    assert.equal(ps.deployCount, deployed0 - (holderTile ? 1 : 0) - deployedTiles.length + (loc.area === 'board' ? 1 : 0), `${label}: deploy count`);
    const CELL = 'chess_item_5_08_e_a';
    assert.equal(ps.hand.filter((p) => p && p.kind === 'item' && p.id !== CELL).length, fillers0, `${label}: the hand's equipment stays`);
    // the cell is not consumed (player feedback after 0.1.0): it came back to the hand — or temp, the hand being full
    assert.equal([...ps.hand, ...ps.temp].filter((p) => p && p.id === CELL).length, 1, `${label}: the cell came back`);
    assert.ok(ps.temp.every((p) => !p || p.id === CELL), `${label}: nothing else waits in temp`);
    checkInvariants(m);
    // it expires at the end of that prep like any other offer
    h.drive(() => m.phase === PHASE.COMBAT && m.round === 2);
    assert.equal(ps.offers.length, 0);
    m.dispose();
  }
});

test('withdrawing a summoner with a full hand: its own summon stack frees the slot (onto the stack or anywhere)', () => {
  for (const onto of ['stack', 'other']) {
    const { m, ps } = prep(24);
    // 伺夜: its talent summon 狼群 is a hand card (a skill's summon such as 赫默's drone never is)
    const hemo = give(m, ps, 'chess_char_3_19_a');
    const [r, c] = legalTileFor(m, ps, 'chess_char_3_19_a');
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: hemo.uid, to: { area: 'board', row: r, col: c } }), { ok: true });
    const stackIdx = ps.hand.findIndex((p) => p && p.kind === 'token' && p.ownerUid === hemo.uid);
    assert.ok(stackIdx >= 0, 'its summon stack went to the hand');
    const ids = ['chess_item_1_01_e_a', 'chess_item_1_02_e_a', 'chess_item_1_03_e_a', 'chess_item_1_04_e_a', 'chess_item_1_05_e_a', 'chess_item_2_01_e_a', 'chess_item_2_02_e_a', 'chess_item_2_03_e_a', 'chess_item_2_04_e_a'];
    for (let i = 0; ps.hand.some((x) => x == null); i++) giveItem(m, ps, ids[i]);
    const idx = onto === 'stack' ? stackIdx : ps.hand.findIndex((p) => p && p.kind === 'item');
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: hemo.uid, to: { area: 'hand', idx } }), { ok: true }, onto);
    assert.equal(ps.find(hemo.uid).area, 'hand');
    assert.equal(ps.hand[stackIdx], hemo, 'it takes the slot its stack left');
    assert.ok(![...ps.hand, ...ps.temp, ...ps.board.values()].some((p) => p && p.kind === 'token'), 'its summons are gone');
    assert.equal(ps.hand.filter((p) => p && p.kind === 'item').length, 9, 'no item was displaced');
    checkInvariants(m);
    m.dispose();
  }
});

test('equipment: the replace dialog picks WHICH equipped item a third one destroys (g.equip replaceUid); equipped items are otherwise locked (g.destroy refused)', () => {
  const { m, ps } = prep(26);
  const a = give(m, ps, chessOfTier(3).find((c) => m.pool.has(c)));
  const i1 = giveItem(m, ps, 'chess_item_1_01_e_a');
  const i2 = giveItem(m, ps, 'chess_item_1_02_e_a');
  const i3 = giveItem(m, ps, 'chess_item_3_03_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i1.uid, targetUid: a.uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i2.uid, targetUid: a.uid }), { ok: true });
  // equipped items cannot be destroyed directly
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: i1.uid }), { error: ERR.BAD_TARGET, detail: 'equipped items are locked' });
  assert.deepEqual(a.items.map((x) => x.uid), [i1.uid, i2.uid]);
  // a replaceUid that is not on the target changes nothing
  assert.equal(m.handle('p_0', { t: 'g.equip', itemUid: i3.uid, targetUid: a.uid, replaceUid: i3.uid }).error, ERR.BAD_TARGET);
  assert.ok(ps.hand.includes(i3), 'the new item stays in the hand');
  assert.deepEqual(a.items.map((x) => x.uid), [i1.uid, i2.uid]);
  // the player keeps the older item and replaces the newer one
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i3.uid, targetUid: a.uid, replaceUid: i2.uid }), { ok: true });
  assert.deepEqual(a.items.map((x) => x.uid), [i1.uid, i3.uid]);
  assert.ok(!ps.find(i2.uid), 'the picked item was destroyed');
  // hand items can still be destroyed
  const i4 = giveItem(m, ps, 'chess_item_2_03_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: i4.uid }), { ok: true });
  checkInvariants(m);
  m.dispose();
});
