// User playtest #6 follow-up — a merge's elite goes to the board when it consumed a deployed copy. The user (first-hand,
// official game): "官方就是合成精锐时，如果消耗了场上的干员，精锐会出现在场上那个位置". PRTS 卫戍协议/帮助 §干员的获得与精锐化:
// "不获得第3名干员，销毁已有的2名初始干员，发送1名【精锐】状态的该干员至手牌区（若消耗已部署至作战区的干员，则发送至作战区
// 对应位置）". Remake (server/match/PlayerState.js _mergeChess, board.js mergeTile): the elite takes the tile and facing of the
// consumed copy that deploys first (row desc, col asc — [ASSUMED] when several stood on the board); a 突变细胞 carrier is
// destroyed before its gain, so its tile never counts; with no deployed copy it goes to the hand (overflow temp).
// Equipment returns to the hand ("干员晋级后已配发装备会回收至整备区"), the copies' summons are removed and the elite on
// the board gets its own stack (its loadout), the deploy count never grows, the reward offer is unchanged — for buys,
// rewards, effect grants, SETTLE merges and the boss-field prep alike. audit.js checks the rule in every audited match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { checkLoadout } from '../../shared/protocol.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier, legalTileFor } from './harness.js';
import { canPlace, placeClass, tileKey, mergeTile } from '../../server/match/board.js';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { attachAudit } from '../../server/match/audit.js';
import { botPrep } from '../../server/match/bot.js';

const chess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const SILENCE = 'chess_char_2_02_a'; // 赫默: S2 (default) makes the 医疗探机 hand card, S1 none
const DRONE = 'token_10000_silent_healrb';
const VIGIL = 'chess_char_3_19_a'; // 伺夜: talent summon 狼群 (a hand card)
const WOLF = 'token_10028_vigil_wolf';
const KAZEMARU = 'chess_char_2_11_a'; // 风丸: merges with 2 copies

function prep({ seed = 41, loadout = null, stageId = 'act2autochess_m04' } = {}) {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, loadout }];
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats, seed }).start();
  h.toPrep(1);
  h.setStage(stageId);
  const ps = h.ps('p_0');
  clean(ps);
  ps.funds = 100;
  return { h, m: h.m, ps };
}

function clean(ps) {
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.recompute();
}

/** Put chess `id` into shop slot `slot` at its normal price. */
function stock(m, ps, id, slot = 0) {
  ps.shop.slots[slot] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false };
}

/** Deploy a copy of `id` on its next legal tile (reading order, skipping `skip`) with facing `dir`. */
function deploy(m, ps, id, dir = 'RIGHT', skip = new Set()) {
  const at = legalTileFor(m, ps, id, skip);
  assert.ok(at, `a legal tile for ${id}`);
  const p = give(m, ps, id, 'board', at);
  p.dir = dir;
  return p;
}

const meleeTier1 = (m) => chessOfTier(1, (c) => c.position === 'MELEE' && !m.gd.placeableTokens(c.chessId).length).filter((id) => m.pool.has(id) && m.gd.mergeCount(id) === 3);
const keyOf = (ps, p) => ps.find(p.uid)?.key ?? null;
const eliteOf = (ps, id) => ps.allChess().find((p) => p.id === chess(id).goldenId) ?? null;
const tokens = (ps, id) => [...ps.hand, ...ps.temp, ...ps.board.values()].filter((p) => p && p.kind === 'token' && (!id || p.id === id));

test('buy: one deployed copy + one hand copy → the elite takes the deployed copy\'s tile and facing; deploy count and reward offer as before', () => {
  const { m, ps } = prep();
  const [id] = meleeTier1(m);
  const a = deploy(m, ps, id, 'DOWN');
  const tile = keyOf(ps, a);
  give(m, ps, id);
  stock(m, ps, id);
  assert.equal(ps.deployCount, 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  const elite = ps.board.get(tile);
  assert.ok(elite && elite.id === chess(id).goldenId, 'the elite stands where the deployed copy stood');
  assert.equal(elite.dir, 'DOWN', 'with its facing');
  assert.equal(elite.poolCopies, 3, 'it holds the three copies');
  assert.equal(ps.deployCount, 1, 'the deploy count is unchanged');
  assert.ok(!ps.hand.some(Boolean) && ps.tempEmpty, 'hand and temp are empty');
  assert.equal(ps.stats.merges, 1);
  const offer = ps.privateView().shop.rewardOffer;
  assert.ok(offer && offer.slots.length === 3 && offer.tier === Math.min(ps.shop.level + 1, 6), 'the promotion reward is offered as before');
  const view = ps.privateView().board.find((v) => v.uid === elite.uid);
  assert.deepEqual([view.row, view.col, view.dir, view.golden], [...tile.split(',').map(Number), 'DOWN', true], 'm.private shows it on the tile');
  checkInvariants(m);
  m.dispose();
});

test('buy: two deployed copies → the copy that deploys first (col asc, then row desc: by column from the left) gives its tile and facing, in either placement order', () => {
  for (const order of ['first-placed-first', 'first-placed-last']) {
    const { m, ps } = prep({ seed: 42 });
    const [id] = meleeTier1(m);
    // two legal tiles, the first of them in deploy order (legalTileFor walks the top row left to right: on one row, the
    // deploy order)
    const t1 = legalTileFor(m, ps, id);
    const t2 = legalTileFor(m, ps, id, new Set([tileKey(...t1)]));
    const [early, late] = order === 'first-placed-first' ? [t1, t2] : [t2, t1];
    const a = give(m, ps, id, 'board', early);
    const b = give(m, ps, id, 'board', late);
    a.dir = 'UP';
    b.dir = 'LEFT';
    stock(m, ps, id);
    assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
    const want = mergeTile([t1, t2].map((t) => ({ key: tileKey(...t) })));
    assert.equal(want.key, tileKey(...t1), 'the first in deploy order');
    const elite = ps.board.get(want.key);
    assert.ok(elite && m.gd.isGolden(elite.id), `${order}: the elite on ${want.key}`);
    assert.equal(elite.dir, want.key === tileKey(...early) ? 'UP' : 'LEFT', `${order}: the facing of the copy that stood there`);
    assert.ok(!ps.board.has(tileKey(...t2)), `${order}: the other copy's tile is free`);
    assert.equal(ps.deployCount, 1, `${order}: two deployed copies → one deployed elite`);
    checkInvariants(m);
    m.dispose();
  }
});

test('a deployed operator transformed into the third copy (突变细胞) → the first deployed COPY\'s tile, never the carrier\'s (destroyed first)', () => {
  const { m, ps } = prep({ seed: 43 });
  const [id, other] = meleeTier1(m);
  // the carrier deploys first: under the 0.1.1 WA rule its tile won; the official destroy-then-gain frees it instead
  const carrier = deploy(m, ps, other, 'UP');
  const c1 = deploy(m, ps, id, 'LEFT');
  const c2 = deploy(m, ps, id, 'DOWN');
  const [ct, t1, t2] = [carrier, c1, c2].map((p) => keyOf(ps, p));
  assert.equal(mergeTile([ct, t1, t2].map((key) => ({ key }))).key, ct, 'the carrier\'s tile is the first in deploy order');
  const elite = ps.transformChess(carrier, id);
  assert.ok(elite && elite.id === chess(id).goldenId, 'the gain completed the merge');
  const want = mergeTile([t1, t2].map((key) => ({ key })));
  assert.equal(keyOf(ps, elite), want.key, 'the elite takes the first deployed copy\'s tile');
  assert.equal(elite.dir, want.key === t1 ? 'LEFT' : 'DOWN', 'with that copy\'s facing');
  assert.ok(!ps.board.has(ct), 'the carrier\'s tile is empty');
  assert.equal(ps.deployCount, 1, 'carrier + two copies deployed → the elite alone');
  assert.equal(ps.stats.merges, 1);
  checkInvariants(m);
  m.dispose();
});

test('only hand copies → the elite goes to the hand (a free board slot does not pull it onto the board); 风丸 merges 2 the same way', () => {
  const { m, ps } = prep({ seed: 44 });
  const [id, filler] = meleeTier1(m);
  deploy(m, ps, filler);
  give(m, ps, id);
  give(m, ps, id);
  stock(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  const elite = eliteOf(ps, id);
  assert.equal(ps.find(elite.uid).area, 'hand', 'no copy was deployed: the hand');
  assert.equal(ps.deployCount, 1, 'the board is unchanged');
  // 风丸: one deployed copy + the bought one
  if (m.pool.has(KAZEMARU) && m.gd.mergeCount(KAZEMARU) === 2) {
    const k = deploy(m, ps, KAZEMARU, 'UP');
    const tile = keyOf(ps, k);
    stock(m, ps, KAZEMARU);
    assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
    const ke = ps.board.get(tile);
    assert.ok(ke && ke.id === chess(KAZEMARU).goldenId && ke.dir === 'UP', '风丸\'s elite takes its deployed copy\'s tile');
  }
  checkInvariants(m);
  m.dispose();
});

test('equipment: the consumed copies\' items return to the hand, the elite on the board starts with empty slots', () => {
  const { m, ps } = prep({ seed: 45 });
  const [id] = meleeTier1(m);
  const a = deploy(m, ps, id);
  const b = give(m, ps, id);
  const i1 = giveItem(m, ps, 'chess_item_1_01_e_a');
  const i2 = giveItem(m, ps, 'chess_item_1_02_e_a');
  const i3 = giveItem(m, ps, 'chess_item_2_04_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i1.uid, targetUid: a.uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i2.uid, targetUid: a.uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i3.uid, targetUid: b.uid }), { ok: true });
  const tile = keyOf(ps, a);
  stock(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  const elite = ps.board.get(tile);
  assert.ok(elite && m.gd.isGolden(elite.id));
  assert.deepEqual(elite.items, [], '"干员晋级后已配发装备会回收至整备区，需要重新配置"');
  for (const it of [i1, i2, i3]) assert.equal(ps.find(it.uid)?.area, 'hand', `${it.id} is back in the hand`);
  // and can be equipped again on the deployed elite
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: i1.uid, targetUid: elite.uid }), { ok: true });
  checkInvariants(m);
  m.dispose();
});

test('equipment with the hand and temp full: the elite keeps up to its 2 equip slots, any further item is destroyed (logged)', () => {
  const { m, ps } = prep({ seed: 47 });
  const [id] = meleeTier1(m);
  const a = deploy(m, ps, id, 'UP');
  const b = deploy(m, ps, id, 'DOWN');
  const ids = ['chess_item_1_01_e_a', 'chess_item_1_02_e_a', 'chess_item_1_05_e_a', 'chess_item_2_04_e_a'];
  const its = ids.map((x) => giveItem(m, ps, x));
  its.forEach((it, i) => assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: (i < 2 ? a : b).uid }), { ok: true }));
  const fill = [2, 3].flatMap((t) => chessOfTier(t)).filter((x) => m.pool.has(x));
  let n = 0;
  while (ps.hand.some((p) => p == null)) give(m, ps, fill[n++]);
  while (ps.temp.some((p) => p == null)) give(m, ps, fill[n++], 'temp');
  const want = mergeTile([a, b].map((p) => ({ key: keyOf(ps, p) }))).key;
  const warns = [];
  const warn = m.log.warn;
  m.log.warn = (s) => { warns.push(String(s)); };
  stock(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true }, 'a merge-completing buy needs no hand slot');
  m.log.warn = warn;
  const elite = ps.board.get(want);
  assert.ok(elite && m.gd.isGolden(elite.id), 'the elite took the first deployed copy\'s tile');
  assert.equal(elite.items.length, m.gd.equipPerChess, 'it keeps 2 of the 4 returned items');
  const kept = new Set(elite.items.map((it) => it.uid));
  assert.ok([...kept].every((u) => its.some((it) => it.uid === u)), 'the kept items are returned ones');
  assert.equal(its.filter((it) => !kept.has(it.uid) && ps.find(it.uid)).length, 0, 'the other two are nowhere (hand, temp, board)');
  assert.equal(warns.filter((s) => /returned item .* destroyed \(no space\)/.test(s)).length, ids.length - m.gd.equipPerChess, 'the other two are destroyed with a log warning');
  checkInvariants(m);
  m.dispose();
});

test('summons: the copies\' placed summons and stacks are removed; the elite on the board gets its own full stack (伺夜 狼群)', () => {
  const { m, ps } = prep({ seed: 46 });
  assert.ok(m.pool.has(VIGIL), '伺夜 is in this match\'s pool');
  const a = give(m, ps, VIGIL);
  const at = legalTileFor(m, ps, VIGIL);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: at[0], col: at[1] }, dir: 'UP' }), { ok: true });
  const stack = ps.hand.find((p) => p && p.kind === 'token' && p.ownerUid === a.uid);
  assert.ok(stack && stack.id === WOLF, 'the deployed copy\'s 狼群 card');
  // one wolf placed, the rest of the stack in the hand
  const wt = legalTileFor(m, ps, VIGIL);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: wt[0], col: wt[1] } }), { ok: true });
  assert.ok(tokens(ps, WOLF).some((t) => ps.find(t.uid).area === 'board'), 'a wolf is placed');
  give(m, ps, VIGIL);
  stock(m, ps, VIGIL);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  const elite = ps.board.get(tileKey(...at));
  assert.ok(elite && elite.id === chess(VIGIL).goldenId && elite.dir === 'UP', 'the elite took the copy\'s tile');
  const left = tokens(ps, WOLF);
  assert.ok(left.every((t) => t.ownerUid === elite.uid), 'no summon of a consumed copy is left (placed or stacked)');
  assert.ok(!ps.board.has(tileKey(...wt)), 'the placed wolf left the board');
  const [{ count }] = m.gd.placeableTokens(elite.id, ps.loadoutFor(chess(elite.id)));
  assert.equal(left.length, 1, 'one fresh stack');
  assert.equal(ps.find(left[0].uid).area, 'hand');
  assert.equal(left[0].count, count, 'deploy-limit copies of the elite');
  checkInvariants(m);
  m.dispose();
});

test('loadout: the deployed elite\'s summon card and battle unit follow the player\'s loadout (赫默 S2 default → drone card, S1 → none)', () => {
  for (const [label, loadout, drone] of [['default S2', null, true], ['S1', checkLoadout({ [SILENCE]: { skill: 0 } }, chess).loadout, false]]) {
    const { m, ps } = prep({ seed: 47, loadout });
    assert.ok(m.pool.has(SILENCE), '赫默 is in this match\'s pool');
    const a = deploy(m, ps, SILENCE, 'LEFT');
    const tile = keyOf(ps, a);
    give(m, ps, SILENCE);
    stock(m, ps, SILENCE);
    assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
    const elite = ps.board.get(tile);
    assert.ok(elite && elite.id === chess(SILENCE).goldenId, `${label}: the elite took the tile`);
    const cards = tokens(ps, DRONE);
    assert.equal(cards.length, drone ? 1 : 0, `${label}: drone card`);
    if (drone) assert.equal(cards[0].ownerUid, elite.uid);
    const u = ps.battleInput({ side: 'L', colOffset: 0 }).units.find((x) => x.uid === elite.uid);
    const lo = ps.loadoutFor(chess(elite.id));
    assert.ok(u, `${label}: the elite fights`);
    assert.deepEqual([u.skillIndex, u.moduleId, u.dir], [lo.skillIndex, lo.moduleId, 'LEFT'], `${label}: with the loadout's skill / module and the copy's facing`);
    assert.equal(u.skillIndex, drone ? 1 : 0);
    checkInvariants(m);
    m.dispose();
  }
});

test('deploy cap: a merge with a deployed copy at the cap is never refused and never grows the count', () => {
  const { m, ps } = prep({ seed: 48 });
  const ids = meleeTier1(m);
  const id = ids[0];
  const ranged = [1, 2].flatMap((t) => chessOfTier(t, (c) => c.position !== 'MELEE' && !m.gd.placeableTokens(c.chessId).length)).filter((x) => m.pool.has(x));
  const a = deploy(m, ps, id, 'UP');
  const b = deploy(m, ps, id, 'DOWN');
  for (let i = 0; ps.deployCount < ps.deployCap; i++) deploy(m, ps, ranged[i]);
  assert.equal(ps.deployCount, ps.deployCap, 'the board is full');
  const first = mergeTile([keyOf(ps, a), keyOf(ps, b)].map((key) => ({ key })));
  stock(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true }, 'no BOARD_FULL: the elite replaces a deployed copy');
  assert.ok(m.gd.isGolden(ps.board.get(first.key).id));
  assert.equal(ps.deployCount, ps.deployCap - 1, 'two deployed copies → one elite');
  // one deployed copy at the cap: unchanged
  const id2 = ids[1];
  const extra = deploy(m, ps, id2, 'RIGHT');
  assert.equal(ps.deployCount, ps.deployCap);
  give(m, ps, id2);
  stock(m, ps, id2);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.ok(!ps.find(extra.uid));
  assert.equal(ps.deployCount, ps.deployCap, 'still at the cap');
  checkInvariants(m);
  m.dispose();
});

test('rewards and effect grants (g.reward, a band\'s ctx.grantChess) complete merges the same way', () => {
  const { m, ps } = prep({ seed: 49 });
  const [id, id2] = meleeTier1(m);
  // reward pick
  const a = deploy(m, ps, id, 'UP');
  const tile = keyOf(ps, a);
  give(m, ps, id);
  ps.pushRewardOffer('effect', { ids: [id] });
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), { ok: true });
  assert.ok(m.gd.isGolden(ps.board.get(tile)?.id), 'g.reward: the elite on the copy\'s tile');
  // a band grant (ctx.grantChess → acquireChess)
  const b = deploy(m, ps, id2, 'LEFT');
  const tile2 = keyOf(ps, b);
  give(m, ps, id2);
  const ctx = makeCtx(m, ps, { kind: 'band', key: 'band:test' }, 'onRoundStart');
  const got = ctx.grantChess(id2);
  assert.ok(got && got.id === chess(id2).goldenId, 'the grant returned the elite');
  assert.equal(ps.board.get(tile2)?.uid, got.uid, 'band grant: the elite on the copy\'s tile');
  assert.equal(ps.board.get(tile2).dir, 'LEFT');
  checkInvariants(m);
  m.dispose();
});

test('after the prep: a SETTLE grant completing a merge puts the elite on the deployed copy\'s tile; the offer waits for the next prep', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 50, fake: true }).start();
  const m = h.m;
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const ps = h.ps('p_0');
  clean(ps);
  const [id] = meleeTier1(m);
  const a = deploy(m, ps, id, 'DOWN');
  const tile = keyOf(ps, a);
  give(m, ps, id);
  // fill the hand: no room is needed for the elite
  const fillers = ['chess_item_1_01_e_a', 'chess_item_1_02_e_a', 'chess_item_1_03_e_a', 'chess_item_1_04_e_a', 'chess_item_1_05_e_a', 'chess_item_2_01_e_a', 'chess_item_2_02_e_a', 'chess_item_2_03_e_a', 'chess_item_2_04_e_a'];
  for (let i = 0; ps.hand.some((x) => x == null); i++) giveItem(m, ps, fillers[i]);
  h.drive(() => m.phase === PHASE.SETTLE);
  const elite = ps.acquireChess(id, { source: 'test' });
  assert.ok(elite && ps.board.get(tile) === elite, 'SETTLE: the elite took the tile at once');
  assert.equal(elite.dir, 'DOWN');
  assert.deepEqual(ps.offers.map((o) => o.source), ['merge']);
  h.toPrep(2);
  assert.equal(ps.board.get(tile)?.uid, elite.uid, 'still there in the next prep');
  assert.ok(ps.privateView().shop.rewardOffer, 'the promotion reward is shown in that prep');
  assert.ok(ps.tempEmpty && ps.privateView().canReady, 'nothing waits in temp');
  checkInvariants(m);
  m.dispose();
});

test('boss-field prep (R14, act2 m01): the elite takes a copy\'s tile that is legal only on the player\'s boss half', () => {
  const STAGE = 'act2autochess_m01';
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 21, fake: true }).start();
  h.setStage(STAGE);
  h.toPrep(14);
  const m = h.m;
  assert.equal(m.round, m.gd.bossRound);
  for (const [pid, field] of [['p_0', 'bossL'], ['p_1', 'bossR']]) {
    const ps = h.ps(pid);
    clean(ps);
    assert.equal(m.deployFieldOf(ps), field);
    const id = chessOfTier(1, (c) => c.position === 'MELEE' && !m.gd.placeableTokens(c.chessId).length).find((x) => m.pool.has(x) && m.pool.left(x) >= 3 && m.gd.mergeCount(x) === 3);
    // board (11, 8): a tile_fence_bound tile on the boss half, forbidden on the normal field (DESIGN §19.7)
    const normal = m.deployMapFor(ps, 'normal');
    assert.equal(canPlace(normal, 'melee', 11, 8), false, 'illegal on the normal field');
    const a = give(m, ps, id);
    assert.deepEqual(m.handle(pid, { t: 'g.move', uid: a.uid, to: { area: 'board', row: 11, col: 8 }, dir: 'UP' }), { ok: true }, `${pid}: placed on the boss half`);
    give(m, ps, id);
    ps.funds = 50;
    stock(m, ps, id);
    assert.deepEqual(m.handle(pid, { t: 'g.buy', slot: 0 }), { ok: true });
    const elite = ps.board.get('11,8');
    assert.ok(elite && elite.id === chess(id).goldenId && elite.dir === 'UP', `${pid} (${field}): the elite on board (11,8) of its boss half`);
    assert.ok(canPlace(ps.deployMap(), placeClass(ps, chess(elite.id)), 11, 8));
  }
  checkInvariants(m);
  m.dispose();
});

test('bots: a bot prep that completes a merge keeps the invariants (the elite is deployed)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 51, fake: true }).start();
  const m = h.m;
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const bot = h.ps('ai_0');
  // botPrep only runs while the bot has not readied yet
  bot.ready = false;
  clean(bot);
  const [id] = meleeTier1(m);
  deploy(m, bot, id, 'RIGHT');
  give(m, bot, id);
  bot.shop.slots = bot.shop.slots.map(() => null);
  stock(m, bot, id);
  bot.funds = 10;
  botPrep(m, bot);
  const elite = eliteOf(bot, id);
  assert.ok(elite, 'the bot bought the third copy');
  assert.equal(bot.find(elite.uid).area, 'board', 'its elite is deployed');
  checkInvariants(m);
  m.dispose();
});

test('audit.js flags an elite that misses the deployed copy\'s tile (and passes the engine\'s merges)', () => {
  const { m, ps } = prep({ seed: 52 });
  const [id, id2] = meleeTier1(m);
  // a deliberately wrong merge (the pre-follow-up rule: always the hand) installed before the audit wraps it
  const real = ps._mergeChess;
  let broken = false;
  ps._mergeChess = function (baseId, incoming, opts) {
    const elite = real.call(this, baseId, incoming, opts);
    if (broken && elite) {
      const loc = this.find(elite.uid);
      if (loc && loc.area === 'board') { this.board.delete(loc.key); this.stow(elite, { allowTemp: true }); }
    }
    return elite;
  };
  const audit = attachAudit(m, { invariants: false });
  deploy(m, ps, id);
  give(m, ps, id);
  stock(m, ps, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.deepEqual(audit.violations, [], 'the engine\'s merge passes');
  broken = true;
  deploy(m, ps, id2);
  give(m, ps, id2);
  stock(m, ps, id2);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  assert.equal(audit.violations.length, 1);
  assert.match(audit.violations[0], /expected the deployed copy's tile/);
  m.dispose();
});

test('audit.js passes transformations that complete a merge (突变细胞 ctx.transform: the carrier is destroyed before the gain, its tile no copy\'s), in PREP and SETTLE', () => {
  // carrier / the two copies: 'board' or 'hand'
  const layouts = [['board', 'hand', 'hand'], ['board', 'board', 'hand'], ['board', 'board', 'board'], ['hand', 'board', 'board'], ['hand', 'hand', 'hand']];
  for (const phase of ['PREP', 'SETTLE']) {
    for (const [i, [carrierAt, ...copiesAt]] of layouts.entries()) {
      const label = `${phase} carrier ${carrierAt}, copies ${copiesAt.join('+')}`;
      const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 60 + i, fake: true }).start();
      const m = h.m;
      h.toPrep(1);
      h.setStage('act2autochess_m04');
      const ps = h.ps('p_0');
      clean(ps);
      const audit = attachAudit(m);
      const [id, other] = meleeTier1(m);
      const place = (cid, at, dir) => (at === 'board' ? deploy(m, ps, cid, dir) : give(m, ps, cid));
      const carrier = place(other, carrierAt, 'UP');
      const carrierTile = keyOf(ps, carrier);
      const copies = copiesAt.map((at, j) => place(id, at, j ? 'DOWN' : 'LEFT'));
      // only the copies' tiles count (PRTS: a destroy, then a gain — the carrier is no copy of the merge)
      const dirOf = new Map(copies.filter((p) => keyOf(ps, p)).map((p) => [keyOf(ps, p), p.dir]));
      const before = ps.deployCount;
      if (phase === 'SETTLE') h.drive(() => m.phase === PHASE.SETTLE);
      assert.equal(m.phase, PHASE[phase]);
      const ctx = makeCtx(m, ps, { kind: 'item', key: 'item:test' }, phase === 'SETTLE' ? 'onSettle' : 'onBuy');
      const got = ctx.transform(carrier.uid, id);
      assert.ok(got && got.id === chess(id).goldenId, `${label}: the gain completed the merge`);
      const want = mergeTile([...dirOf.keys()].map((key) => ({ key })));
      const loc = ps.find(got.uid);
      if (carrierTile) assert.ok(!ps.board.has(carrierTile), `${label}: the carrier's tile is empty`);
      if (want) {
        assert.equal(loc.key, want.key, `${label}: the elite on the first deployed copy's tile`);
        assert.equal(loc.piece.dir, dirOf.get(want.key), `${label}: with that copy's facing`);
        assert.equal(ps.deployCount, 1, `${label}: ${before} deployed → 1`);
      } else {
        assert.equal(loc.area, 'hand', `${label}: no deployed copy → the hand`);
        assert.equal(ps.deployCount, 0, `${label}: ${before} deployed → 0`);
      }
      assert.deepEqual(audit.violations, [], `${label}: no audit violation`);
      m.dispose();
    }
  }
});

test('a deployed copy on a tile its elite may not use (terrain changed, not re-checked yet) is skipped: hand, or the tile when nothing has room', () => {
  for (const full of [false, true]) {
    const label = full ? 'hand and temp full' : 'room';
    const { m, ps } = prep({ seed: 54 });
    const [id] = meleeTier1(m);
    // both owned copies deployed, both tiles then made undeployable (a content tile override, not re-checked yet)
    const a = deploy(m, ps, id, 'UP');
    const b = deploy(m, ps, id, 'DOWN');
    const tiles = [keyOf(ps, a), keyOf(ps, b)];
    if (full) {
      const fill = [2, 3].flatMap((t) => chessOfTier(t)).filter((x) => m.pool.has(x));
      for (let i = 0; ps.hand.some((p) => p == null); i++) give(m, ps, fill[i]);
      for (let i = 0; ps.temp.some((p) => p == null); i++) give(m, ps, fill[ps.hand.length + i], 'temp');
    }
    for (const k of tiles) ps.tileOverrides[k] = 'none';
    ps.invalidateDeployMap();
    const elite = ps.acquireChess(id, { source: 'test' });
    assert.ok(elite && m.gd.isGolden(elite.id), `${label}: merged`);
    const loc = ps.find(elite.uid);
    if (!full) {
      assert.equal(loc.area, 'hand', `${label}: the illegal tiles are skipped, the elite goes to the hand`);
    } else {
      // never lost: it stays on the first deployed copy's tile, like a piece the eviction finds no room for
      assert.equal(loc.area, 'board', `${label}: kept on the board`);
      assert.equal(loc.key, mergeTile(tiles.map((key) => ({ key }))).key);
      assert.equal(elite.poolCopies, 3);
    }
    m.dispose();
  }
});

test('ERR codes unchanged: a full hand still refuses a purchase that completes no merge', () => {
  const { m, ps } = prep({ seed: 53 });
  const [id, other] = meleeTier1(m);
  deploy(m, ps, id);
  const fill = chessOfTier(2).filter((x) => m.pool.has(x));
  for (let i = 0; ps.hand.some((p) => p == null); i++) give(m, ps, fill[i]);
  stock(m, ps, other);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { error: ERR.HAND_FULL });
  checkInvariants(m);
  m.dispose();
});
