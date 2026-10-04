// Player feedback after 0.1.0 (workstream WA, match-side effects), through the real match paths (g.refresh / g.buy /
// g.move / g.equip, the round loop's SETTLE):
//   #1 拉普兰德 garrison_123 "<刷新时>若为本回合首次主动刷新，使已激活的【叙拉古】层数+4(+8)，此干员在整备区时也有效": the
//      players' official behaviour — "获得该干员后该回合的首次刷新" also stacks. The refresh count is the 拉普兰德's own
//      (each copy counts the manual refreshes it witnessed this round), not the player's.
//   #4 昆图斯 突变细胞 "战斗结束后，装备者替换为高一阶的随机干员": the cell is not consumed — the original operator is
//      destroyed (PRTS 备注 "生效时，原干员销毁，获得一名高一阶的随机初始干员（最高六阶）") and its equipment, the cell
//      included, returns to the hand, to be equipped again ("之后就是一直打针，扎到核心卡…就换人扎"); then the new operator
//      is gained like any gained operator — into the 整备区, never onto the carrier's tile (official footage: bilibili
//      BV1vzyVBuEN9 ≈ 8:24, BV1Qkw1zMEoR ≈ 7:25 — the tile is empty at the next prep, one more deployment is left, the
//      new operator waits on the bench; pointed out in PR #2). Bots / AI 托管 deploy it in their normal placement step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, legalTileFor, checkInvariants, DATA } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { botPrep, botPrepEnd, cellTarget } from '../../server/match/bot.js';
import { mergeTile } from '../../server/match/board.js';

import { textMsg } from '../../shared/i18n.js';
const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const OK = { ok: true };
const LAP = 'chess_char_2_16_a'; // 拉普兰德 (Ⅱ, 叙拉古) — garrison_123_a
const LAP_B = 'chess_char_2_16_b';
const PROVENCE = 'chess_char_1_07_a'; // 普罗旺斯 (Ⅰ, 叙拉古)
const TEXAS = 'chess_char_1_08_a'; // 德克萨斯 (Ⅰ, 独行 / 叙拉古)
const CELL = 'chess_item_5_08_e_a'; // 突变细胞
const KEY = 'garrison:SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT';

function setup({ seed = 70, mode = 'solo' } = {}) {
  const h = makeMatch({ mode, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.offers.length = 0;
  ps.funds = 50;
  ps.layers = {};
  ps.pendingFunds = 0;
  ps.shop.freeRefreshes = 0;
  ps.bandId = null; // isolate from the band's own prep effects
  ps.recompute();
  /** layers added by 拉普兰德's trait (the dispatcher's reason = the registry key) */
  const lap = { n: 0 };
  const addLayers = ps.addLayers.bind(ps);
  ps.addLayers = (b, n, o = {}) => { const a = addLayers(b, n, o); if (o.reason === KEY && b === 'siracusaShip') lap.n += a; return a; };
  const refresh = () => assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), OK);
  const L = () => lap.n;
  /** put `id` into shop slot `i` (as a roll would) and buy it through g.buy; returns the owned piece */
  const buy = (id, i = 0) => {
    ps.shop.slots[i] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false };
    const before = new Set(ps.allChess().map((p) => p.uid));
    assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: i }), OK, `buy ${id}`);
    return ps.allChess().find((p) => !before.has(p.uid));
  };
  const place = (piece) => {
    const [row, col] = legalTileFor(m, ps, piece.id);
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row, col } }), OK);
    return [row, col];
  };
  const activate = () => { ps.bondCountBonus.siracusaShip = 20; ps.recompute(); };
  return { h, m, ps, refresh, L, buy, place, activate };
}

// ---------------------------------------------------------------------------------------------------------------------
// #1 拉普兰德

test('#1 players\' scenario: 普罗旺斯 + 德克萨斯 deployed, refresh, buy 拉普兰德, deploy her (3 叙拉古), refresh again → 叙拉古 +4', () => {
  const s = setup();
  const { m, ps } = s;
  give(m, ps, PROVENCE, 'board', legalTileFor(m, ps, PROVENCE));
  give(m, ps, TEXAS, 'board', legalTileFor(m, ps, TEXAS));
  assert.ok(!ps.bonds.siracusaShip.active, '2 叙拉古: not active yet');
  s.refresh(); // the round's first manual refresh — no 拉普兰德 owned yet
  const lap = s.buy(LAP);
  s.place(lap);
  assert.ok(ps.bonds.siracusaShip.active, '3 different 叙拉古 on the board: active');
  const before = ps.layers.siracusaShip || 0;
  s.refresh(); // the round's 2nd refresh, her 1st
  assert.equal((ps.layers.siracusaShip || 0) - before, 4, 'the first refresh after she joined stacks +4 (the official behaviour the players report)');
  s.refresh();
  assert.equal((ps.layers.siracusaShip || 0) - before, 4, 'only her first refresh of the round');
  // the next round: her first refresh of that round stacks again
  s.h.toPrep(2);
  ps.funds = 50;
  const b2 = ps.layers.siracusaShip || 0;
  s.refresh();
  assert.equal((ps.layers.siracusaShip || 0) - b2, 4, 'R2: first refresh +4');
  s.refresh();
  assert.equal((ps.layers.siracusaShip || 0) - b2, 4, 'R2: once');
  checkInvariants(m);
  m.dispose();
});

test('#1 each copy counts its own refreshes: a bench copy (整备区时也有效) bought later fires on its own first refresh; an elite keeps "already fired"', () => {
  const s = setup();
  const { m, ps } = s;
  s.activate();
  const a = give(m, ps, LAP, 'board', legalTileFor(m, ps, LAP));
  s.refresh();
  assert.equal(s.L(), 4, 'copy A (board): its first refresh');
  const b = s.buy(LAP); // copy B stays in the hand (整备区)
  assert.equal(ps.find(b.uid).area, 'hand');
  s.refresh();
  assert.equal(s.L(), 8, 'copy B: its first refresh (A already fired this round)');
  s.refresh();
  assert.equal(s.L(), 8, 'nothing more this round');
  // the third copy completes the elite: A and B already fired this round, so the elite does not fire again this round
  // [ASSUMED: conservative — the elite keeps the highest refresh count of its copies]
  const elite = s.buy(LAP);
  assert.equal(elite.id, LAP_B, 'merged into the elite');
  assert.ok(!ps.find(a.uid) && !ps.find(b.uid), 'copies consumed');
  s.refresh();
  assert.equal(s.L(), 8, 'the elite made this round from copies that already fired: no second trigger');
  s.h.toPrep(2);
  ps.funds = 50;
  s.activate();
  s.refresh();
  assert.equal(s.L(), 8 + 8, 'R2: the elite fires +8 on the round\'s first refresh');
  checkInvariants(m);
  m.dispose();
});

test('#1 an elite merged from copies that had not fired yet this round fires on the next refresh; a re-bought copy is a new 拉普兰德', () => {
  const s = setup();
  const { m, ps } = s;
  s.activate();
  s.refresh();
  s.refresh(); // two refreshes before owning any copy
  give(m, ps, LAP, 'hand');
  give(m, ps, LAP, 'hand');
  const elite = s.buy(LAP);
  assert.equal(elite.id, LAP_B);
  s.refresh();
  assert.equal(s.L(), 8, 'the elite\'s first refresh (the round\'s 3rd) stacks +8');
  // sell it, buy a new copy: a new operator — it fires on its own first refresh (costs its price and a refresh)
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: elite.uid }), OK);
  s.buy(LAP);
  s.refresh();
  assert.equal(s.L(), 8 + 4, 'a newly acquired copy counts from its own first refresh');
  s.refresh();
  assert.equal(s.L(), 12);
  checkInvariants(m);
  m.dispose();
});

test('#1 only manual refreshes count: a re-triggered "刷新时" trait (ctx.triggerGarrisons) neither fires nor uses up her first refresh', () => {
  const s = setup();
  const { m, ps } = s;
  s.activate();
  const a = give(m, ps, LAP, 'hand');
  assert.equal(m.dispatcher.triggerGarrisons(ps, a, 'SERVER_REFRESH_SHOP'), 1, 'the trait ran as a trigger');
  assert.equal(s.L(), 0, 'not a manual refresh');
  s.refresh();
  assert.equal(s.L(), 4, 'her first manual refresh still counts');
  checkInvariants(m);
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------------
// #4 突变细胞

/** Plain visible normal chess (only IN_BATTLE traits) of a tier with a free pool copy. */
const plainOf = (m, tier) => Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && c.tier === tier && (c.garrisonIds || []).every((g) => DATA.garrisons[g].eventType === 'IN_BATTLE') && !m.gd.placeableTokens(c.chessId).length && m.pool.has(c.chessId) && m.pool.left(c.chessId) > 0)
  .map((c) => c.chessId).sort();
const ownedItems = (ps, id) => [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'item' && p.id === id);
const equip = (m, item, target) => m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: target.uid });
const SWORD = 'chess_item_1_01_e_a'; // 维式重锤
const PACK = 'chess_item_5_07_e_a'; // 商业包装方案 (counts sells per item: player counter `pack:<item uid>`)
const VIGIL = 'chess_char_3_19_a'; // 伺夜 (Ⅲ) — a placeable 狼群 summon card
/** Distinct normal equipment ids (never merge with each other), the cell excluded. */
const fillerItems = () => Object.values(DATA.items).filter((it) => it.itemType === 'EQUIP' && !it.isGolden && it.id !== CELL).map((it) => it.id).sort();
const unusedFillers = (ps) => fillerItems().filter((id) => ![...ps.hand, ...ps.temp].some((p) => p && p.id === id));
/** Fill every free hand slot but `leave` with distinct items. */
const fillHand = (m, ps, leave = 1) => {
  const ids = unusedFillers(ps);
  while (ps.hand.filter((x) => x == null).length > leave) giveItem(m, ps, ids.shift());
};
/** Fill every free temp slot with distinct items. */
const fillTemp = (m, ps) => {
  const ids = unusedFillers(ps);
  while (ps.temp.some((x) => x == null)) giveItem(m, ps, ids.shift(), 'temp');
};
/** Force the cell's roll (the random draw) of `tier` to `id`; everything else stays the real path. */
const forceRoll = (m, tier, id) => { const roll = m.pool.roll.bind(m.pool); m.pool.roll = (rng, o = {}) => (o.tier === tier ? id : roll(rng, o)); };
const where = (ps, pred) => (ps.hand.some((p) => p && pred(p)) ? 'hand' : ps.temp.some((p) => p && pred(p)) ? 'temp' : null);
const handIdx = (ps, pred) => ps.hand.findIndex((p) => p && pred(p));
/** The round loop's SETTLE dispatch, alone. */
const battleResult = (m, ps) => m.dispatch(ps, 'onBattleResult', { result: {}, lpLoss: 0, perfect: true });

test('#4 players\' report and the official flow: after each battle the deployed carrier is destroyed — its tile empties, one more deployment is left —, its equipment (the cell too) comes back first, then a NORMAL tier+1 operator joins the hand', () => {
  const s = setup({ seed: 5 });
  const { h, m, ps } = s;
  const t2 = plainOf(m, 2)[0];
  const carrier = give(m, ps, t2, 'board', legalTileFor(m, ps, t2));
  const tile = ps.find(carrier.uid).key;
  const cell = giveItem(m, ps, CELL);
  const sword = giveItem(m, ps, SWORD); // other equipment returns too
  assert.deepEqual(equip(m, cell, carrier), OK);
  assert.deepEqual(equip(m, sword, carrier), OK);
  assert.equal(ps.deployCount, 1);
  h.toPrep(2);
  assert.ok(!ps.find(carrier.uid), 'the original operator is gone (原干员销毁)');
  assert.ok(!ps.board.has(tile), 'its tile is empty (bilibili BV1vzyVBuEN9 ≈ 8:24, BV1Qkw1zMEoR ≈ 7:25)');
  assert.equal(ps.deployCount, 0, 'one more deployment is left');
  const next = ps.hand.find((p) => p && p.kind === 'chess');
  assert.ok(next, 'the new operator waits in the hand (整备区)');
  assert.equal(m.gd.chess(next.id).tier, 3, 'one tier higher');
  assert.ok(!m.gd.isGolden(next.id), 'an initial (normal) operator');
  assert.deepEqual(next.items, [], 'nothing equipped');
  assert.equal(ownedItems(ps, CELL).length, 1, 'the cell is back in the hand, not consumed');
  assert.equal(ownedItems(ps, SWORD).length, 1, 'the other equipment too');
  // the hand fills right → left ("被发送至手牌区的物资优先从右到左填充空位"): the equipment came off first, then the gain
  assert.deepEqual([handIdx(ps, (p) => p.id === CELL), handIdx(ps, (p) => p.id === SWORD), ps.hand.indexOf(next)], [9, 8, 7]);
  assert.ok(ps.tempEmpty);
  // the player deploys it by hand, then "一直打针": inject again — it climbs once more and comes back to the bench
  const [row, col] = legalTileFor(m, ps, next.id);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: next.uid, to: { area: 'board', row, col } }), OK);
  assert.equal(ps.deployCount, 1);
  assert.deepEqual(equip(m, ownedItems(ps, CELL)[0], next), OK);
  h.toPrep(3);
  assert.ok(!ps.find(next.uid) && !ps.board.has(`${row},${col}`), 'the second carrier is gone too, its tile empty');
  assert.equal(ps.deployCount, 0);
  const third = ps.hand.find((p) => p && p.kind === 'chess');
  assert.equal(m.gd.chess(third.id).tier, 4, 'tier 4 after the second battle, on the bench');
  assert.equal(ownedItems(ps, CELL).length, 1, 'and the cell is back again');
  checkInvariants(m);
  m.dispose();
});

test('#4 bench carriers transform too: a hand or temp carrier leaves its slot; the cell, then the new operator, fill the hand right → left', () => {
  for (const area of ['hand', 'temp']) {
    const s = setup({ seed: 6 });
    const { m, ps } = s;
    const t1 = plainOf(m, 1)[0];
    const carrier = give(m, ps, t1, area);
    assert.deepEqual(equip(m, giveItem(m, ps, CELL), carrier), OK);
    battleResult(m, ps);
    assert.ok(!ps.find(carrier.uid), `${area}: the carrier is destroyed`);
    const got = ps.allChess();
    assert.equal(got.length, 1, `${area}: one operator gained`);
    assert.equal(m.gd.chess(got[0].id).tier, 2, `${area}: one tier higher`);
    assert.ok(!m.gd.isGolden(got[0].id));
    assert.deepEqual([handIdx(ps, (p) => p.id === CELL), ps.hand.indexOf(got[0])], [9, 8], `${area}: the cell first, then the gain`);
    assert.ok(ps.tempEmpty, `${area}: nothing waits in temp`);
    assert.equal(ps.deployCount, 0);
    checkInvariants(m);
    m.dispose();
  }
});

test('#4 突变细胞 details: an elite carrier → a NORMAL operator one tier higher; 6阶 → another 6阶', () => {
  {
    const s = setup({ seed: 9 });
    const { h, m, ps } = s;
    const t3 = plainOf(m, 3)[0];
    const elite = give(m, ps, m.gd.goldenIdOf(t3), 'hand');
    assert.deepEqual(equip(m, giveItem(m, ps, CELL), elite), OK);
    h.toPrep(2);
    const got = ps.allChess();
    assert.equal(got.length, 1);
    assert.equal(m.gd.chess(got[0].id).tier, 4);
    assert.ok(!m.gd.isGolden(got[0].id), 'PRTS 备注: 获得一名高一阶的随机初始干员');
    assert.equal(ownedItems(ps, CELL).length, 1);
    m.dispose();
  }
  {
    const s = setup({ seed: 10 });
    const { h, m, ps } = s;
    const t6 = plainOf(m, 6)[0] || Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 6 && m.pool.has(c.chessId) && m.pool.left(c.chessId) > 0).chessId;
    const top = give(m, ps, t6, 'hand');
    assert.deepEqual(equip(m, giveItem(m, ps, CELL), top), OK);
    h.toPrep(2);
    const got = ps.allChess();
    assert.equal(got.length, 1);
    assert.equal(m.gd.chess(got[0].id).tier, 6, '最高6阶');
    assert.equal(ownedItems(ps, CELL).length, 1);
    m.dispose();
  }
});

test('#4 hand full: the returned cell takes the last hand slot, the new operator overflows into temp — with no summon card until it is deployed', () => {
  const s = setup({ seed: 31 });
  const { m, ps } = s;
  forceRoll(m, 3, VIGIL);
  const t2 = plainOf(m, 2)[0];
  const carrier = give(m, ps, t2, 'board', legalTileFor(m, ps, t2));
  const at = ps.find(carrier.uid).key;
  assert.deepEqual(equip(m, giveItem(m, ps, CELL), carrier), OK);
  fillHand(m, ps, 1);
  battleResult(m, ps);
  assert.ok(!ps.board.has(at), 'the carrier\'s tile is empty');
  assert.equal(ps.deployCount, 0);
  assert.equal(where(ps, (p) => p.id === CELL), 'hand', 'the cell came back first, into the last hand slot');
  const vigil = ps.temp.find((p) => p && p.id === VIGIL);
  assert.ok(vigil, '伺夜 overflows into temp like any gain with a full hand');
  assert.equal(where(ps, (p) => p.kind === 'token'), null, 'no 狼群 card yet: a summon card comes with a deployment');
  // deployed by hand from temp, it brings its card like any operator placed there
  const [row, col] = legalTileFor(m, ps, VIGIL);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: vigil.uid, to: { area: 'board', row, col } }), OK);
  assert.ok(where(ps, (p) => p.kind === 'token' && p.ownerUid === vigil.uid), 'its 狼群 card arrived');
  checkInvariants(m);
  m.dispose();
});

test('#4 hand and temp full: the gained operator follows the no-room rule of every gain (back to the pool, the same toast); the carrier is destroyed all the same', () => {
  const s = setup({ seed: 11 });
  const { h, m, ps } = s;
  const t2 = plainOf(m, 2)[0];
  const t3 = plainOf(m, 3)[0];
  forceRoll(m, 3, t3);
  const carrier = give(m, ps, t2, 'board', legalTileFor(m, ps, t2));
  const at = ps.find(carrier.uid).key;
  assert.deepEqual(equip(m, giveItem(m, ps, CELL), carrier), OK);
  fillHand(m, ps, 0);
  fillTemp(m, ps);
  const left0 = m.pool.left(t3);
  const left2 = m.pool.left(t2);
  const toasts = [];
  const toast = m.toast.bind(m);
  m.toast = (who, kind, text, ...rest) => { if (who === ps) toasts.push(textMsg(text, rest[0]).text); return toast(who, kind, text, ...rest); };
  battleResult(m, ps);
  assert.ok(!ps.board.has(at), 'the carrier is destroyed wherever it stands');
  assert.equal(ps.deployCount, 0);
  assert.equal(m.pool.left(t2), left2 + 1, 'its copy went back to the pool');
  assert.ok(!ps.allChess().some((p) => p.id === t3), 'no slot anywhere: the gained operator is not kept');
  assert.equal(m.pool.left(t3), left0, 'its copy went back to the pool (PlayerState.acquireChess)');
  assert.ok(toasts.includes('整备区已满，获得的干员已返还'), 'the toast of any gained operator with no room');
  // the cell found no slot and no gained operator to stay on: destroyed with a log warning, as in a merge
  assert.equal(ownedItems(ps, CELL).length, 0);
  assert.ok(h.logs.warn.some((w) => w.includes(`returned item ${CELL} destroyed (no space)`)), 'logged');
  checkInvariants(m);
  m.dispose();
});

test('#4 per-piece state rides on the returned equipment: 商业包装方案 keeps its sell count through the transformation', () => {
  const s = setup({ seed: 36 });
  const { m, ps } = s;
  const t2 = plainOf(m, 2)[0];
  const carrier = give(m, ps, t2, 'board', legalTileFor(m, ps, t2));
  const pack = giveItem(m, ps, PACK);
  assert.deepEqual(equip(m, giveItem(m, ps, CELL), carrier), OK);
  assert.deepEqual(equip(m, pack, carrier), OK);
  const [fodder] = plainOf(m, 1);
  const sell = () => assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: give(m, ps, fodder, 'hand').uid }), OK);
  for (let i = 0; i < 3; i++) sell();
  const key = `pack:${pack.uid}`;
  assert.equal(ps.counters[key], 3, 'three sells counted while equipped');
  battleResult(m, ps);
  const back = ownedItems(ps, PACK)[0];
  assert.ok(back && back.uid === pack.uid, 'the same item came back to the hand');
  assert.equal(ps.counters[key], 3, 'with its progress');
  const next = ps.hand.find((p) => p && p.kind === 'chess');
  assert.deepEqual(equip(m, back, next), OK);
  sell();
  assert.equal(ps.counters[key], 4, 'it goes on counting on its next carrier');
  checkInvariants(m);
  m.dispose();
});

test('#4 strategy 昆图斯 end to end: the R3 cell survives its first transformation; a bot injects its weakest single normal operator, never an elite', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 21, registry: REG, fake: true }).start();
  const m = h.m;
  h.toPrep(1, { band: 'band_quintus' });
  const ps = h.ps('p_0');
  assert.equal(ps.bandId, 'band_quintus');
  h.toPrep(3, { band: 'band_quintus' });
  assert.equal(ownedItems(ps, CELL).length, 1, 'R3: the strategy grants the cell');
  // equip it on a deployed operator (any) and play the R3 battle
  const target = ps.allChess()[0] || give(m, ps, plainOf(m, 1)[0], 'board', legalTileFor(m, ps, plainOf(m, 1)[0]));
  assert.deepEqual(equip(m, ownedItems(ps, CELL)[0], target), OK);
  h.toPrep(4);
  const owned = [...ownedItems(ps, CELL), ...ps.allChess().flatMap((p) => (p.items || []).filter((it) => it.id === CELL))];
  assert.equal(owned.length, 1, 'R4: the cell is still owned after its transformation');
  m.dispose();

  // the bot's choice: its least valuable single normal operator below 6阶 — never an elite, a merge pair or a 6阶
  const s = setup({ seed: 23 });
  const { m: m2, ps: p2 } = s;
  const [t1a, t1b] = plainOf(m2, 1);
  const t3 = plainOf(m2, 3)[0];
  const t6 = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 6 && m2.pool.has(c.chessId) && m2.pool.left(c.chessId) > 0).chessId;
  const elite = give(m2, p2, m2.gd.goldenIdOf(t3), 'board', legalTileFor(m2, p2, t3));
  const pair = [give(m2, p2, t1a, 'board', legalTileFor(m2, p2, t1a)), give(m2, p2, t1a, 'hand')];
  const top = give(m2, p2, t6, 'hand');
  assert.equal(cellTarget(m2, p2), null, 'no candidate: the cell waits in the hand');
  const single = give(m2, p2, t1b, 'board', legalTileFor(m2, p2, t1b));
  assert.equal(cellTarget(m2, p2).uid, single.uid, 'the single normal operator');
  void elite; void pair; void top;
  // through the whole bot prep (it may buy, sell and move first): whoever carries the cell is a normal operator below 6阶
  p2.isBot = true;
  giveItem(m2, p2, CELL);
  botPrep(m2, p2);
  const carrierOf = p2.allChess().find((p) => (p.items || []).some((it) => it.id === CELL));
  assert.ok(carrierOf, 'the bot equipped the cell');
  assert.ok(!m2.gd.isGolden(carrierOf.id) && m2.gd.tierOf(carrierOf.id) < 6, 'never an elite or a 6阶');
  m2.dispose();
});

// ---------------------------------------------------------------------------------------------------------------------
// #4: a gain that completes a merge merges like any gained copy (DESIGN §20.11) — the elite goes to a consumed DEPLOYED
// copy's tile (board.js mergeTile), else to the hand; the destroyed carrier's tile is no copy's. The returned cell is
// stowed before the elite's summon card (it would be lost in temp at the deadline).

test('#4 the gain completes a merge with deployed copies: the elite takes the first deployed copy\'s tile, never the carrier\'s; the cell is returned before the elite\'s summon card', () => {
  const s = setup({ seed: 32 });
  const { m, ps } = s;
  forceRoll(m, 3, VIGIL);
  // the carrier deploys FIRST: its tile leads the deploy order (under the 0.1.1 WA rule the elite took it)
  const t2 = plainOf(m, 2)[0];
  const carrier = give(m, ps, t2, 'board', legalTileFor(m, ps, t2));
  const ct = ps.find(carrier.uid).key;
  const copies = [give(m, ps, VIGIL, 'board', legalTileFor(m, ps, VIGIL))];
  copies.push(give(m, ps, VIGIL, 'board', legalTileFor(m, ps, VIGIL)));
  copies[0].dir = 'UP';
  copies[1].dir = 'DOWN';
  for (const c of copies) ps.removeTokensOf(c.uid); // keep the hand count exact
  const copyTiles = copies.map((c) => ps.find(c.uid).key);
  assert.equal(mergeTile([ct, ...copyTiles].map((key) => ({ key }))).key, ct, 'the carrier\'s tile is the first in deploy order');
  assert.deepEqual(equip(m, giveItem(m, ps, CELL), carrier), OK);
  fillHand(m, ps, 1);
  battleResult(m, ps);
  const want = mergeTile(copyTiles.map((key) => ({ key })));
  const elite = ps.board.get(want.key);
  assert.ok(elite && elite.id === m.gd.goldenIdOf(VIGIL), 'the elite 伺夜 stands on the first deployed copy\'s tile');
  assert.equal(elite.dir, want.key === copyTiles[0] ? 'UP' : 'DOWN', 'with that copy\'s facing');
  assert.ok(!ps.board.has(ct), 'the carrier\'s tile is empty');
  assert.equal(ps.deployCount, 1, 'carrier + two copies deployed → the elite alone');
  assert.equal(where(ps, (p) => p.id === CELL), 'hand', 'the cell came back first, into the last hand slot');
  assert.equal(where(ps, (p) => p.kind === 'token' && p.ownerUid === elite.uid), 'temp', 'the elite\'s 狼群 card overflows into temp');
  assert.equal(ps.stats.merges, 1);
  checkInvariants(m);
  m.dispose();
});

test('#4 the gain completes a merge with no deployed copy: the elite goes to the hand (no summon card); the carrier\'s tile stays empty', () => {
  const s = setup({ seed: 35 });
  const { m, ps } = s;
  forceRoll(m, 3, VIGIL);
  const t2 = plainOf(m, 2)[0];
  const carrier = give(m, ps, t2, 'board', legalTileFor(m, ps, t2));
  const ct = ps.find(carrier.uid).key;
  const copies = [give(m, ps, VIGIL, 'hand'), give(m, ps, VIGIL, 'hand')];
  assert.deepEqual(equip(m, giveItem(m, ps, CELL), carrier), OK);
  battleResult(m, ps);
  const elite = ps.allChess().find((p) => p.id === m.gd.goldenIdOf(VIGIL));
  assert.ok(elite, 'the gain completed the merge');
  assert.ok(copies.every((c) => !ps.find(c.uid)), 'both bench copies were consumed');
  assert.equal(ps.find(elite.uid).area, 'hand', 'no consumed copy was deployed (the carrier\'s tile is no copy\'s): the hand');
  assert.ok(!ps.board.has(ct), 'the carrier\'s tile is empty');
  assert.equal(ps.deployCount, 0);
  assert.equal(where(ps, (p) => p.kind === 'token'), null, 'an elite on the bench brings no summon card');
  assert.equal(where(ps, (p) => p.id === CELL), 'hand');
  assert.equal(ps.stats.merges, 1);
  assert.deepEqual(ps.offers.map((o) => o.source), ['merge'], 'the promotion reward as for any merge');
  checkInvariants(m);
  m.dispose();
});

test('#4 bots and AI 托管 deploy the gained operator in their normal placement step (a real co-op round: SETTLE → the next prep)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 41, registry: REG, fake: true }).start();
  const m = h.m;
  h.toPrep(1);
  const human = h.ps('p_0');
  const bot = h.ps('ai_0');
  h.run(() => bot.ready); // the bot's own R1 prep is done
  // each seat: a small board — a tier-2 carrier of the cell and a tier-1 operator, nothing on the bench
  const [t1a, t1b] = plainOf(m, 1);
  const [t2a, t2b] = plainOf(m, 2);
  const before = new Map();
  for (const [ps, t1, t2] of [[human, t1a, t2a], [bot, t1b, t2b]]) {
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear();
    ps.hand.fill(null);
    ps.temp.fill(null);
    ps.offers.length = 0;
    const carrier = give(m, ps, t2, 'board', legalTileFor(m, ps, t2));
    give(m, ps, t1, 'board', legalTileFor(m, ps, t1));
    carrier.items.push(ps.newPiece('item', CELL));
    ps.recompute();
    before.set(ps, { uids: new Set(ps.allChess().map((p) => p.uid)), carrier });
  }
  // SETTLE: each carrier is destroyed and a tier-3 operator gained into the hand
  const gained = new Map();
  const settle = m.settle.bind(m);
  m.settle = (...a) => {
    const r = settle(...a);
    for (const [ps, b] of before) gained.set(ps, ps.allChess().find((p) => !b.uids.has(p.uid)) || null);
    return r;
  };
  // the layout each seat readies with in R2 (its bot prep ends with g.ready)
  const atReady = new Map();
  for (const ps of [human, bot]) {
    const setReady = ps.setReady.bind(ps);
    ps.setReady = (on) => {
      const g = gained.get(ps);
      if (on && m.round === 2 && g && !atReady.has(ps)) atReady.set(ps, { area: ps.find(g.uid)?.area ?? null, deployed: ps.deployCount });
      return setReady(on);
    };
  }
  h.toPrep(2);
  for (const [ps, b] of before) {
    const g = gained.get(ps);
    assert.ok(g && m.gd.chess(g.id).tier === 3 && !m.gd.isGolden(g.id), `${ps.playerId}: a NORMAL tier-3 operator was gained at SETTLE`);
    assert.ok(!ps.find(b.carrier.uid), `${ps.playerId}: the carrier is gone`);
    assert.notEqual(ps.find(g.uid)?.area, 'board', `${ps.playerId}: it starts the prep on the bench`);
  }
  assert.ok(!human.ready, 'the human has not readied yet');
  assert.deepEqual(m.handle('p_0', { t: 'g.autoplay', on: true }), OK); // AI 托管 plays the human seat from here
  h.run(() => atReady.size === 2);
  for (const ps of [bot, human]) {
    const r = atReady.get(ps);
    assert.ok(r, `${ps.playerId}: readied in R2`);
    assert.equal(r.area, 'board', `${ps.playerId}: the gained operator was deployed by the placement step`);
    assert.ok(r.deployed >= 2, `${ps.playerId}: the freed deployment is used (${r.deployed} deployed)`);
  }
  m.dispose();
});

test('#4 a bot on 昆图斯 lets the placement step judge each gained operator: the bench shed never sells one in its first prep, and no deployment stays free while one waits on the bench', () => {
  // a real solo 绝境 bot match on strategy 昆图斯 (the only band on offer, as tools/botbench.mjs --band) through R8: the
  // buy loop's pre-emptive bench shed sells by piece value while the bench is crowded — before rememberOwned it sold this
  // seed's R7 operator in the R8 prep (20 such matches: 44 of 222 gained operators, before any placement step saw them)
  const seats = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seats, seed: 9, registry: REG });
  const m = h.m;
  m.gd.bandIds = () => ['band_quintus'];
  const ps = h.ps('ai_0');
  const gained = new Map(); // uid → round of the SETTLE that gained it
  const shed = [];
  const waiting = [];
  const transform = ps.transformChess.bind(ps);
  ps.transformChess = (...a) => { const np = transform(...a); if (np) gained.set(np.uid, m.round); return np; };
  const sell = ps.sell.bind(ps);
  ps.sell = (uid) => {
    if (gained.get(uid) === m.round - 1 && /buyLoopSteps/.test(new Error().stack)) shed.push(`R${m.round} ${ps.find(uid)?.piece.id}`);
    return sell(uid);
  };
  const setReady = ps.setReady.bind(ps);
  ps.setReady = (on) => {
    for (const [uid, r] of gained) {
      const loc = r === m.round - 1 ? ps.find(uid) : null;
      if (on && loc && loc.area !== 'board' && ps.deployCount < ps.deployCap) waiting.push(`R${m.round} ${loc.piece.id} ${ps.deployCount}/${ps.deployCap}`);
    }
    return setReady(on);
  };
  h.start();
  h.run(() => h.ended != null || (m.phase === 'PREP' && m.round === 9));
  assert.equal(ps.bandId, 'band_quintus');
  assert.ok(gained.size >= 5, `the cell transformed after every battle from R3 (${gained.size})`);
  assert.deepEqual(shed, [], 'no operator sold by the bench shed in the prep after its gain');
  assert.deepEqual(waiting, [], 'a gained operator off the board only when the board is full');
  checkInvariants(m);
  m.dispose();
});

test('#10 AI 托管 never destroys a human\'s item to clear temp: a bench operator is sold for its slot instead', () => {
  const s = setup({ seed: 34 });
  const { m, ps } = s;
  ps.autoplay = true;                                  // a human seat under AI 托管 (ps.isBot stays false)
  const elites = [1, 2, 3, 4, 5, 6].flatMap((t) => plainOf(m, t)).map((id) => m.gd.goldenIdOf(id)).filter((g) => g && m.pool.left(m.gd.baseIdOf(g)) >= m.gd.goldenCopies);
  while (ps.hand.some((x) => x == null)) give(m, ps, elites.shift(), 'hand');
  const item = Object.values(DATA.items).find((it) => it && it.id !== CELL && !it.isGolden && it.price > 0 && /_e_a$/.test(it.id));
  giveItem(m, ps, item.id, 'temp');
  botPrepEnd(m, ps);
  assert.equal(ownedItems(ps, item.id).length, 1, `${item.name}: kept (it used to be destroyed when the hand was full)`);
  assert.ok(ps.tempEmpty, 'temp resolved');
  checkInvariants(m);
  m.dispose();
});

test('#4 a bot never destroys the cell: left in temp with a full hand and nobody to inject, it gets a hand slot', () => {
  const s = setup({ seed: 33 });
  const { m, ps } = s;
  ps.isBot = true;
  const elites = [1, 2, 3, 4, 5, 6].flatMap((t) => plainOf(m, t)).map((id) => m.gd.goldenIdOf(id)).filter((g) => g && m.pool.left(m.gd.baseIdOf(g)) >= m.gd.goldenCopies);
  for (let i = 0; i < 8; i++) { const id = elites.shift(); give(m, ps, id, 'board', legalTileFor(m, ps, id)); }
  while (ps.hand.some((x) => x == null)) give(m, ps, elites.shift(), 'hand');
  giveItem(m, ps, CELL, 'temp');
  assert.equal(cellTarget(m, ps), null, 'elites only: nobody to inject');
  botPrepEnd(m, ps); // the end of the bot's prep: temp → hand / sell / destroy, a free hand slot, Ready
  assert.equal(ownedItems(ps, CELL).length, 1, 'the bot kept its strategy item (a hand chess was sold for the slot)');
  assert.ok(ps.tempEmpty, 'temp resolved');
  checkInvariants(m);
  m.dispose();
});
