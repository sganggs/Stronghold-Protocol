// 规程·序列Ⅰ (act3autochess@V3_1) garrison types and in-battle events.
// Prep uses the match's own data. Battle garrison records come from the process gameData() singleton, so this file
// loads the regulation tables and restores them afterwards. Behaviour is keyed by effect / blackboard key.
import { installItem } from '../../server/sim/content/items/battle.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { getVersionData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { ursusTempExtra } from '../../server/sim/content/garrisons/regulation.js';
import { underframeActions } from '../../public/js/ui/facing.js';
import { carrySellPrice } from '../../server/match/player/acquire.js';
import { buildBattleSpec, compactResult, resultDigest } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { isBattleResult } from '../../shared/protocol.js';
import { SharedPool } from '../../server/match/pool.js';
import { DataSource } from '../../server/sim/simdata.js';

const QUIET = { warn() {}, error() {}, info() {} };
const RAW = getVersionData('act3autochess@V3_1', { log: QUIET });
const REG = createRegistry({ log: QUIET });
setGameData(RAW);
after(() => setGameData(null));

const handItems = (ps) => [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'item');

function setup(seed = 70, mode = 'solo', difficulty = 'FUNNY') {
  // 规程 has no mode_single_normal. mode_single_funny is the solo table modeIdFor('solo', 'FUNNY') names,
  // and its level-1 shop is still 3 chess + 1 item. band_bldsk is not in this season; band_sarkazb is, and has no buffs.
  const h = makeMatch({ mode, difficulty, seed, registry: REG, fake: true, data: RAW }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.offers.length = 0;
  ps.funds = 50;
  ps.layers = {};
  ps.pendingFunds = 0;
  ps.shop.freeRefreshes = 0;
  ps.bandId = null;
  ps.recompute();
  const activate = (...bonds) => { for (const b of bonds) if (b !== 'soloShip') ps.bondCountBonus[b] = 20; ps.recompute(); };
  const L = (b) => ps.layers[b] || 0;
  const prepEnd = () => m.dispatch(ps, 'onPrepEnd', { round: m.round });
  const prepStart = () => m.dispatch(ps, 'onPrepStart', { round: m.round });
  const acquire = (id) => ps.acquireChess(id, { source: 'test' });
  const fin = (result) => m.dispatch(ps, 'onBattleResult', { result });
  return { h, m, ps, activate, L, prepEnd, prepStart, acquire, fin };
}

function rec(id, garrisonIds, o = {}) {
  return {
    ...chessRec({
      id, charId: o.charId || id, bonds: o.bonds || [], rangeGrid: o.rangeGrid, position: o.position, profession: o.profession,
      subProfessionId: o.subProfessionId,
    }),
    garrisonIds,
  };
}
const B = (layers = 0, active = true) => ({ count: active ? 3 : 0, active, tier: active ? 1 : 0, layers });

function battle(units, bonds = {}, extra = {}) {
  const chess = {};
  for (const u of units) chess[u.id] = rec(u.id, u.g || [], u);
  if (extra.chess) Object.assign(chess, extra.chess);
  const h = makeBattle({
    seed: extra.seed || 1, bonds, kind: extra.kind, flags: extra.flags,
    defs: { chess, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 8000, speed: 0, atk: 0 }) } },
    units: units.map((u) => ({ chessId: u.id, row: u.row, col: u.col, uid: u.uid })),
    autoFinish: false, timeLimit: 60,
  });
  if (extra.step !== false) h.step(1);
  return h;
}
const lg = (h, bond) => h.result().perPlayer.p1.layerGains[bond] || 0;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg || `${a} ≈ ${b}`);
const living = (n, extra = []) => {
  const unitsEnd = [];
  for (let i = 0; i < n; i++) unitsEnd.push({ defId: 'chess_char_1_06_a', alive: true });
  return { unitsEnd: unitsEnd.concat(extra) };
};

for (const [form, per, cap] of [['a', 4, 20], ['b', 8, 40]]) {
  test(`妮芙 ${form}: fear grants Swift layers, never freeze, with range/activation/refresh/cap checks`, () => {
    const id = `chess_char_6_10_${form}`;
    const h = makeBattle({
      data: new DataSource({ ...RAW, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, speed: 0, atk: 0 }) } }),
      units: [{ chessId: id, row: 10, col: 4 }],
      bonds: { swiftShip: B(0) },
      enemies: [{ key: 'e_dummy', pos: [10, 5] }, { key: 'e_dummy', pos: [12, 9] }],
      autoFinish: false, timeLimit: 60,
    });
    h.step();
    const u = h.unit(id), [nearEnemy, farEnemy] = h.enemies();
    h.b.applyStatus(nearEnemy, 'freeze', { duration: 1, source: u });
    assert.equal(lg(h, 'swiftShip'), 0, 'freeze must not trigger the fear garrison');
    h.b.removeStatus(nearEnemy, 'freeze');
    h.b.applyStatus(farEnemy, 'fear', { duration: 1, source: u });
    assert.equal(lg(h, 'swiftShip'), 0, 'fear outside attack range must not grant layers');
    h.b.applyStatus(nearEnemy, 'fear', { duration: 1, source: u });
    assert.equal(lg(h, 'swiftShip'), per, 'first fear entry');
    h.b.applyStatus(nearEnemy, 'fear', { duration: 2, source: u });
    assert.equal(lg(h, 'swiftShip'), per, 'refresh is not a new fear entry');
    for (let i = 0; i < 6; i++) {
      h.b.removeStatus(nearEnemy, 'fear');
      h.b.applyStatus(nearEnemy, 'fear', { duration: 1, source: u });
    }
    assert.equal(lg(h, 'swiftShip'), cap, 'per-battle cap');
    assert.deepEqual(h.b.errors, []);

    const inactive = makeBattle({
      data: new DataSource({ ...RAW, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, speed: 0, atk: 0 }) } }),
      units: [{ chessId: id, row: 10, col: 4 }], bonds: { swiftShip: B(0, false) },
      enemies: [{ key: 'e_dummy', pos: [10, 5] }], autoFinish: false,
    });
    inactive.step();
    inactive.b.applyStatus(inactive.enemies()[0], 'fear', { duration: 1, source: inactive.unit(id) });
    assert.equal(lg(inactive, 'swiftShip'), 0, 'Swift must be activated');
    assert.deepEqual(inactive.b.errors, []);

    const skillBattle = makeBattle({
      data: new DataSource({ ...RAW, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, speed: 0, atk: 0 }) } }),
      units: [{ chessId: id, row: 10, col: 4 }], bonds: { swiftShip: B(0) },
      enemies: [{ key: 'e_dummy', pos: [10, 5] }], autoFinish: false,
    });
    skillBattle.step();
    skillBattle.unit(id).skill.gainSp(1000);
    assert.ok(skillBattle.runUntil(() => lg(skillBattle, 'swiftShip') > 0, 5), 'real S2 fear grants layers');
    assert.equal(lg(skillBattle, 'swiftShip'), per);
    assert.deepEqual(skillBattle.b.errors, []);
  });
}

function saleSetup(t, seed = 70) {
  // Use a mode with 绝技 enabled; the upstream solo FUNNY fixture disables it.
  const s = setup(seed, 'coop', 'ABYSS');
  t.after(() => { assert.equal(s.m.errorCount, 0); s.m.dispose(); });
  s.m.disabledBonds = []; s.m.bannedChess = [];
  s.m.pool = new SharedPool(s.m.gd);
  return s;
}

test('伊桑 sale: official 3 elites / 2 助力 formation can grant 罗比菈塔', t => {
  for (const seed of [1, 2, 3, 4]) for (const form of ['a', 'b']) {
    const { m, ps } = saleSetup(t, seed);
    ps.shop.level = 6;
    // Match the observed bond counts, not the whole recording's roster. 绝技 has no member operators.
    for (const [id, r, c] of [
      ['chess_char_3_19_b', 10, 4], // 罗比菈塔: 助力 / 坚守.
      ['chess_char_1_11_b', 10, 5], // 夏栎: 助力.
      ['chess_char_1_09_b', 10, 6], // 卡达: 奥术.
    ]) give(m, ps, id, 'board', [r, c]);
    const ethan = give(m, ps, `chess_char_3_18_${form}`, 'hand');
    assert.equal(ps.bonds.suntShip.count, 3);
    assert.equal(ps.bonds.deputShip.count, 2);
    // Make the observed reward deterministic; the official capture does not establish its probability.
    const roberta = 'chess_char_3_19_a';
    for (const [id, entry] of m.pool.entries) if (id !== roberta) m.pool.take(id, entry.left);
    const old = new Set(ps.allChess().map(p => p.uid));
    assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: ethan.uid }), { ok: true });
    assert.deepEqual(ps.allChess().filter(p => !old.has(p.uid)).map(p => p.id), [roberta]);
  }
});

test('伊桑 sale: reported R13 formation grants a 莱塔尼亚 operator when 4 elites outnumber its 3 real members', t => {
  for (const seed of [1, 2, 3, 4]) for (const form of ['a', 'b']) {
    const { m, ps } = saleSetup(t, seed);
    ps.shop.level = 6;
    // Public formation from R13 of the reported replay; no account or replay identifiers are needed.
    for (const [id, r, c] of [
      ['chess_char_4_02_b', 11, 6], ['chess_char_1_04_a', 11, 7], ['chess_char_6_20_a', 11, 8],
      ['chess_char_5_01_b', 10, 5], ['chess_char_4_26_a', 10, 6], ['chess_char_6_20_b', 10, 7],
      ['chess_char_5_11_b', 10, 8],
    ]) give(m, ps, id, 'board', [r, c]);
    const ethan = give(m, ps, `chess_char_3_18_${form}`, 'hand');
    assert.equal(ps.bonds.suntShip.count, 4);
    assert.equal(ps.bonds.lethaniaShip.count, 3);
    const old = new Set(ps.allChess().map(p => p.uid));
    assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: ethan.uid }), { ok: true });
    const gained = ps.allChess().filter(p => !old.has(p.uid));
    assert.equal(gained.length, 1);
    assert.ok(ps.gd.chess(gained[0].id).bonds.includes('lethaniaShip'));
  }
});

test('伊桑 sale: both forms respect shop level and exclude their own base id even after copies return', t => {
  for (const form of ['a', 'b']) for (const level of [1, 3, 5]) {
    const { m, ps } = saleSetup(t);
    ps.shop.level = level;
    ps.bondCountBonus.arcaneShip = 10; ps.recompute();
    const ethan = give(m, ps, `chess_char_3_18_${form}`, 'hand');
    const allowed = 'chess_char_1_09_a'; // 卡达: a stocked arcane operator within every tested shop level.
    for (const [id, entry] of m.pool.entries) if (id !== allowed) m.pool.take(id, entry.left);
    assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: ethan.uid }), { ok: true });
    assert.deepEqual(ps.allChess().map(p => p.id), [allowed], 'returned Ethan copies cannot be granted back');
    assert.ok(ps.gd.tierOf(ps.allChess()[0].id) <= level);
  }
});

test('伊桑 sale: only self or above-level stock leaves no reward and does not fall back to a smaller bond', t => {
  for (const form of ['a', 'b']) {
    const { m, ps } = saleSetup(t);
    ps.shop.level = 3;
    ps.bondCountBonus.arcaneShip = 10;
    ps.bondCountBonus.lethaniaShip = 5;
    const ethan = give(m, ps, `chess_char_3_18_${form}`, 'hand');
    // Keep a T5 arcane operator and a T3 operator of the smaller bond in stock; neither qualifies.
    for (const [id, entry] of m.pool.entries) {
      if (!['chess_char_5_11_a', 'chess_char_3_02_a'].includes(id)) m.pool.take(id, entry.left);
    }
    const funds = ps.funds;
    assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: ethan.uid }), { ok: true });
    assert.equal(ps.allChess().length, 0);
    assert.ok(ps.funds > funds, 'sale payment is independent of reward availability');
  }
});

test('SERVER_SELF_SELL_PRICE_DELTA: stacks to the text cap, skips the hand, never lowers a higher price; sell pays it', () => {
  const s = setup();
  const piece = give(s.m, s.ps, 'chess_char_3_04_a', 'board', [10, 4]);
  const hand = give(s.m, s.ps, 'chess_char_3_04_a', 'hand');
  assert.equal(s.m.gd.sellPrice(piece.id), 1);
  s.prepEnd();
  s.prepEnd();
  s.prepEnd();
  assert.equal(s.ps.sellPriceOf(piece), 4);
  assert.equal(piece.meta.sellBonus, 3);
  s.prepEnd();
  assert.equal(s.ps.sellPriceOf(piece), 4, 'the fourth prep end is at the cap');
  assert.equal(s.ps.sellPriceOf(hand), 1, 'a hand copy is not on the board');
  piece.meta.sellPrice = 9;
  s.prepEnd();
  assert.equal(piece.meta.sellPrice, 9, 'a price already above the text cap stays');
  const view = s.ps.pieceView(piece);
  assert.equal(view.sellPrice, 9);
  const actions = underframeActions({
    pieces: new Map([[view.uid, { piece: view, area: 'board' }]]),
    getChess: (id) => s.m.gd.chess(id),
  }, view.uid);
  assert.equal(actions.sell, 9);
  assert.equal(s.m.gd.sellPrice(piece.id), 1, 'the catalogue price the bots read is unchanged');
  const funds = s.ps.funds;
  assert.deepEqual(s.m.handle('p_0', { t: 'g.sell', uid: piece.uid }), { ok: true });
  assert.equal(s.ps.funds, funds + 9);
});

test('SERVER_SELF_SELL_PRICE_FIXED: acquire sets the blackboard price and clears the bonus', () => {
  const s = setup();
  const piece = s.acquire('chess_char_4_05_a');
  assert.equal(piece.meta.sellPrice, 3);
  assert.equal(piece.meta.sellBonus, 0);
  assert.equal(piece.meta.sellFixed, true);
  assert.equal(s.ps.sellPriceOf(piece), 3);
  assert.equal(s.m.gd.sellPrice(piece.id), 1);
});

test('精英化 keeps the sale price (§37.209): a grown 海沫 merges into a 4 elite that grows on to 8; 温蒂 still fixes 6', () => {
  const s = setup();
  // a tile the elite may take (the merge puts it on the deployed copy's tile only when that tile is legal for it)
  const probe = s.ps.newPiece('chess', 'chess_char_3_04_b');
  let at = null;
  for (let r = 0; r < 12 && !at; r++) for (let c = 0; c < 12 && !at; c++) if (s.ps._legal(probe, r, c)) at = [r, c];
  assert.ok(at, 'a legal tile for 海沫');
  const grown = give(s.m, s.ps, 'chess_char_3_04_a', 'board', at);
  s.prepEnd();
  s.prepEnd();
  s.prepEnd();
  assert.equal(s.ps.sellPriceOf(grown), 4);
  give(s.m, s.ps, 'chess_char_3_04_a', 'hand');
  const elite = s.acquire('chess_char_3_04_a');
  assert.equal(elite.id, 'chess_char_3_04_b');
  assert.equal(s.ps.find(elite.uid).area, 'board', 'the elite takes the grown copy\'s tile');
  assert.equal(s.ps.sellPriceOf(elite), 4, 'the grown copy\'s price, not the table 1');
  assert.equal(s.ps.pieceView(elite).sellPrice, 4, 'the sell button shows it');
  assert.equal(elite.meta.sellBonus, 3);
  s.prepEnd();
  assert.equal(s.ps.sellPriceOf(elite), 6, '+2 a prep end once elite');
  s.prepEnd();
  assert.equal(s.ps.sellPriceOf(elite), 8);
  s.prepEnd();
  assert.equal(s.ps.sellPriceOf(elite), 8, 'the elite text cap');
  const funds = s.ps.funds;
  assert.deepEqual(s.m.handle('p_0', { t: 'g.sell', uid: elite.uid }), { ok: true });
  assert.equal(s.ps.funds, funds + 8);

  // 温蒂: the copies are fixed at 3; the elite's own 获得时 特质 sets 6 in the gain after the merge
  const w = s.acquire('chess_char_4_05_a');
  s.acquire('chess_char_4_05_a');
  assert.equal(s.ps.sellPriceOf(w), 3);
  const we = s.acquire('chess_char_4_05_a');
  assert.equal(we.id, 'chess_char_4_05_b');
  assert.equal(s.ps.sellPriceOf(we), 6);
  assert.equal(we.meta.sellFixed, true);

  // copies without an effect price merge into a table-price elite (nothing to carry)
  for (let i = 0; i < 3; i++) s.acquire('chess_char_1_18_a');
  const plain = s.ps.allChess().find((p) => p.id === 'chess_char_1_18_b');
  assert.ok(plain, 'a merged elite 拉普兰德');
  assert.equal(plain.meta.sellPrice, undefined);
  assert.equal(s.ps.sellPriceOf(plain), 1);
});

test('carrySellPrice: the highest copy with its bonus / fixed mark; nothing at or below the elite table price', () => {
  const copy = (meta) => ({ meta });
  const elite = () => ({ meta: {} });
  const a = elite();
  carrySellPrice(a, [copy({}), copy({ sellPrice: 3, sellBonus: 2 }), copy({ sellPrice: 5, sellBonus: 4 })], 1);
  assert.deepEqual(a.meta, { sellPrice: 5, sellBonus: 4 });
  const b = elite();
  carrySellPrice(b, [copy({ sellPrice: 3, sellBonus: 0, sellFixed: true }), copy({})], 1);
  assert.deepEqual(b.meta, { sellPrice: 3, sellBonus: 0, sellFixed: true });
  const c = elite();
  carrySellPrice(c, [copy({ sellPrice: 1 }), copy({ sellPrice: 0 }), copy({ sellPrice: Number.NaN })], 1);
  assert.deepEqual(c.meta, {}, 'no price above the table');
  const d = elite();
  carrySellPrice(d, [copy({}), null, copy(undefined)], 1);
  assert.deepEqual(d.meta, {});
});

test('SERVER_GAIN_RANDOM_EQUIP: one item per row from the board at prep start; the hand does not; the elite gets two', () => {
  const board = setup();
  give(board.m, board.ps, 'chess_char_6_07_a', 'board', [10, 4]);
  board.prepStart();
  assert.equal(handItems(board.ps).length, 1);
  const hand = setup();
  give(hand.m, hand.ps, 'chess_char_6_07_a', 'hand');
  hand.prepStart();
  assert.equal(handItems(hand.ps).length, 0);
  const elite = setup();
  give(elite.m, elite.ps, 'chess_char_6_07_b', 'board', [10, 4]);
  elite.prepStart();
  assert.equal(handItems(elite.ps).length, 2, '158_b and 159_b are the two halves of one 「获得两件」 (one item each)');
});

test('SERVER_GAIN_SPECIAL_REFRESH_BOND_CHAR: one charge, count is how many slots; a queued test shop does not spend it', () => {
  const s = setup();
  s.acquire('chess_char_4_09_a');
  assert.deepEqual(s.ps.shop.bondRefresh, [{ bond: 'kjeragShip', count: 1 }]);
  s.ps.rollShop();
  assert.equal(s.ps.shop.bondRefresh, undefined);
  const chessSlots = s.ps.shop.slots.slice(0, s.ps.shop.layout.chess);
  const kjerag = chessSlots.filter((slot) => s.m.gd.chess(slot.id).bonds.includes('kjeragShip')).length;
  assert.ok(kjerag >= 1, `kjerag slots ${kjerag}`);

  const two = setup();
  two.acquire('chess_char_4_09_b');
  assert.equal(two.ps.shop.bondRefresh[0].count, 2);
  two.ps.rollShop();
  const slots2 = two.ps.shop.slots.slice(0, two.ps.shop.layout.chess);
  const n2 = slots2.filter((slot) => two.m.gd.chess(slot.id).bonds.includes('kjeragShip')).length;
  assert.ok(n2 >= 2, `two kjerag slots, got ${n2}`);

  const queued = setup();
  queued.ps.shop.bondRefresh = [{ bond: 'kjeragShip', count: 1 }];
  queued.m.test = true;
  const itemId = 'chess_item_1_01_e_a';
  assert.ok(queued.m.gd.item(itemId));
  queued.ps._testShopNext = [
    { kind: 'chess', id: 'chess_char_1_01_a' },
    { kind: 'chess', id: 'chess_char_1_01_a' },
    { kind: 'chess', id: 'chess_char_1_01_a' },
    { kind: 'item', id: itemId },
  ];
  queued.ps.rollShop();
  assert.deepEqual(queued.ps.shop.bondRefresh, [{ bond: 'kjeragShip', count: 1 }]);
  assert.deepEqual(queued.ps.shop.slots.map((slot) => slot.id), ['chess_char_1_01_a', 'chess_char_1_01_a', 'chess_char_1_01_a', itemId]);
});

test('SERVER_UPGRADE_SELF_EQUIP: both operator forms return the upgraded instances without unequipping unchanged items', () => {
  for (const id of ['chess_char_4_15_a', 'chess_char_4_15_b']) {
    const s = setup();
    const piece = give(s.m, s.ps, id, 'board', [10, 4]);
    const normal = s.ps.newPiece('item', 'chess_item_1_01_e_a');
    normal.itemPoolCopies = 0;
    normal.meta = { source: 'test' };
    const golden = s.ps.newPiece('item', 'chess_item_1_01_e_b');
    piece.items.push(normal, golden);
    s.prepStart();
    assert.deepEqual(piece.items, [golden], 'already-advanced equipment is not upgraded or returned');
    assert.equal(normal.id, 'chess_item_1_01_e_b');
    assert.equal(normal.itemPoolCopies, 0, 'passive stock provenance survives the return');
    assert.deepEqual(normal.meta, { source: 'test' });
    assert.ok(handItems(s.ps).includes(normal), 'the same instance returns to storage');
    assert.notEqual(s.ps.find(normal.uid)?.area, 'equipped');
    const before = handItems(s.ps).length;
    s.prepStart();
    assert.equal(handItems(s.ps).length, before, 'a repeated trigger does not duplicate returned equipment');
  }
  const hand = setup(71);
  const held = give(hand.m, hand.ps, 'chess_char_4_15_a', 'hand');
  held.items.push(hand.ps.newPiece('item', 'chess_item_1_01_e_a'));
  hand.prepStart();
  assert.equal(held.items[0].id, 'chess_item_1_01_e_a', 'the hand is not on the board');
});

test('SERVER_UPGRADE_SELF_EQUIP: multiple upgrades return to overflow when the equipment row is full', () => {
  const s = setup(72);
  const piece = give(s.m, s.ps, 'chess_char_4_15_a', 'board', [10, 4]);
  for (let i = 0; i < 5; i++) s.ps.stow(s.ps.newPiece('item', 'chess_item_1_01_e_b'));
  const items = [s.ps.newPiece('item', 'chess_item_1_01_e_a'), s.ps.newPiece('item', 'chess_item_1_01_e_a')];
  for (const item of items) item.itemPoolCopies = 0;
  piece.items.push(...items);
  s.prepStart();
  assert.equal(piece.items.length, 0, 'mutating the equipment list does not skip the second item');
  for (const item of items) {
    assert.equal(item.id, 'chess_item_1_01_e_b');
    assert.ok(s.ps.tempPieces().includes(item), 'forced returns use the existing hidden overflow');
    assert.equal(item.itemPoolCopies, 0);
  }
});

test('SERVER_ADD_BOND_UPGRADE_LAYER: single rewards rise to 12 and keep paying', () => {
  const s = setup();
  s.activate('kjeragShip');
  const piece = s.acquire('chess_char_3_07_a');
  assert.equal(s.L('kjeragShip'), 1);
  for (const n of [3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78, 90]) {
    s.m.dispatcher.triggerGarrisons(s.ps, piece, 'SERVER_GAIN');
    assert.equal(s.L('kjeragShip'), n);
  }
});

test('SERVER_GAIN_FREE_REFRESH_UPGRADE_COUNT: each pair upgrades the next reward to a maximum of 3', () => {
  const s = setup();
  const piece = s.acquire('chess_char_3_13_a');
  assert.equal(s.ps.shop.freeRefreshes, 1);
  for (const total of [2, 4, 6, 9, 12, 15]) {
    s.m.dispatcher.triggerGarrisons(s.ps, piece, 'SERVER_GAIN');
    assert.equal(s.ps.shop.freeRefreshes, total);
  }
});

test('SERVER_ADD_ACTIVATED_BOND_BY_ALIVE_CHAR: living chess, the per-trigger cap, SELF, and a hand carrier', () => {
  const listed = setup();
  give(listed.m, listed.ps, 'chess_char_4_06_a', 'board', [10, 4]);
  listed.activate('iberiaShip', 'docShip');
  listed.fin(living(2, [{ defId: 'chess_char_1_06_a', alive: false }, { defId: 'not_a_chess', alive: true }]));
  assert.equal(listed.L('iberiaShip'), 2);
  assert.equal(listed.L('docShip'), 2);

  const self = setup();
  give(self.m, self.ps, 'chess_char_4_22_a', 'board', [10, 4]);
  self.activate('docShip');
  self.fin(living(12));
  assert.equal(self.L('docShip'), 9, 'max_count 9 caps this trigger');
  assert.equal(self.L('emptyShip'), 0, 'an inactive bond of the carrier is not SELF');

  const hand = setup();
  give(hand.m, hand.ps, 'chess_char_4_06_a', 'hand');
  hand.activate('iberiaShip', 'docShip');
  hand.fin(living(4));
  assert.equal(hand.L('iberiaShip'), 0);
});

test('SERVER_CONVERT_TEMP_BOND: share one pool and convert only on entering prep', () => {
  const one = setup();
  const piece = give(one.m, one.ps, 'chess_char_1_01_a', 'board', [10, 4]);
  one.activate('ursusShip');
  one.ps.tempLayers = { ursusShip: 1 };
  one.m.dispatcher.triggerGarrisons(one.ps, piece, 'SERVER_BATTLE_FIN');
  assert.equal(one.L('ursusShip'), 0, 'battle-end dispatch cannot convert before prep');
  one.prepStart();
  assert.equal(one.L('ursusShip'), 1, 'a pool of 1 cannot pay the whole count of 2');
  assert.equal(one.ps.tempLayers.ursusShip, undefined);

  const none = setup();
  give(none.m, none.ps, 'chess_char_1_01_a', 'board', [10, 4]);
  none.fin({ unitsEnd: [] });
  assert.equal(none.L('ursusShip'), 0);

  const both = setup();
  give(both.m, both.ps, 'chess_char_1_01_a', 'board', [10, 4]);
  give(both.m, both.ps, 'chess_char_3_03_a', 'board', [10, 6]);
  both.activate('ursusShip');
  both.m.lastResults.set(both.ps.playerId, {
    leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0,
    tempLayerGains: { ursusShip: 10.8, unknownBond: 3, yanShip: Infinity }, unitsEnd: [],
  });
  both.m.settle(null, null);
  assert.deepEqual(both.ps.tempLayers, { ursusShip: 10 }, 'SETTLE preserves the pool');
  assert.equal(both.L('ursusShip'), 0, 'no conversion before the next prep');
  both.m.enterPrep();
  assert.equal(both.ps.tempLayers, undefined, 'entering prep discards the unconverted remainder');
  assert.equal(both.L('ursusShip'), 4, '184 takes 2 and 21 takes one per on-board 乌萨斯 member');
});

test('SERVER_ADD_BOND_BOARD_SELL_PRICE: every on-board price, capped by max', () => {
  const s = setup();
  const a = give(s.m, s.ps, 'chess_char_5_04_a', 'board', [10, 4]);
  const b = give(s.m, s.ps, 'chess_char_1_06_a', 'board', [10, 6]);
  a.meta.sellPrice = 10;
  b.meta.sellPrice = 10;
  s.activate('iberiaShip');
  s.prepEnd();
  assert.equal(s.L('iberiaShip'), 12);
  assert.equal(s.L('arcaneShip'), 0);
});

test('SERVER_ADD_BOND_POSITION_COUNT_SELL_PRICE: an empty front still pays the carrier; the front pays its own bonds', () => {
  const empty = setup();
  give(empty.m, empty.ps, 'chess_char_3_05_a', 'board', [10, 4]);
  empty.activate('iberiaShip', 'preciShip');
  empty.prepEnd();
  assert.equal(empty.L('iberiaShip'), 1);
  assert.equal(empty.L('preciShip'), 1);

  const front = setup();
  give(front.m, front.ps, 'chess_char_3_05_a', 'board', [10, 4]);
  give(front.m, front.ps, 'chess_char_1_06_a', 'board', [10, 5]);
  front.activate('iberiaShip', 'preciShip', 'kjeragShip', 'steadShip');
  front.prepEnd();
  assert.equal(front.L('iberiaShip'), 1, 'the carrier is not paid twice');
  assert.equal(front.L('preciShip'), 1);
  assert.equal(front.L('kjeragShip'), 1);
  assert.equal(front.L('steadShip'), 1);
});

test('SERVER_ADD_BOND_BOARD_EQUIP_CHAR: an equipped operator adds count to each listed active bond', () => {
  const s = setup();
  const piece = give(s.m, s.ps, 'chess_char_4_14_a', 'board', [10, 4]);
  piece.items.push(s.ps.newPiece('item', 'chess_item_1_01_e_a'));
  s.activate('victoriaShip', 'steadShip');
  s.prepEnd();
  assert.equal(s.L('victoriaShip'), 2);
  assert.equal(s.L('steadShip'), 2);
  const bare = setup();
  give(bare.m, bare.ps, 'chess_char_4_14_a', 'board', [10, 4]);
  bare.activate('victoriaShip', 'steadShip');
  bare.prepEnd();
  assert.equal(bare.L('victoriaShip'), 0);
});

test('garrison_61 pool holds the four operators the text names, including 安哲拉', () => {
  const s = setup();
  const pool = s.m.gd.choices.pools.pool_chess_glady;
  const names = pool.items.map((id) => s.m.gd.chess(id).name);
  assert.deepEqual(names, ['斯卡蒂', '幽灵鲨', '深巡', '安哲拉']);
  for (const id of ['garrison_61_a', 'garrison_61_b']) {
    const desc = s.m.gd.garrison(id).desc;
    for (const n of names) assert.ok(desc.includes(n), `${id} ${desc}`);
  }
});

test('known-type max: round chess gains and coin cost clamp only when the blackboard has max', () => {
  const method = setup();
  give(method.m, method.ps, 'chess_char_3_06_a', 'board', [10, 4]);
  method.ps.round.gainedChess = 100;
  method.activate('yanShip', 'docShip');
  method.prepEnd();
  assert.equal(method.L('yanShip'), 16);
  assert.equal(method.L('docShip'), 16);
  const idle = setup();
  give(idle.m, idle.ps, 'chess_char_3_06_a', 'board', [10, 4]);
  idle.ps.round.gainedChess = 100;
  idle.prepEnd();
  assert.equal(idle.L('yanShip'), 0, 'the text requires the bonds to be active');
  const hand = setup();
  give(hand.m, hand.ps, 'chess_char_3_06_a', 'hand');
  hand.ps.round.gainedChess = 100;
  hand.activate('yanShip', 'docShip');
  hand.prepEnd();
  assert.equal(hand.L('yanShip'), 0);

  const coin = setup();
  give(coin.m, coin.ps, 'chess_char_5_18_a', 'board', [10, 4]);
  coin.ps.round.spent = 300;
  coin.activate('arcaneShip');
  coin.prepEnd();
  assert.equal(coin.L('arcaneShip'), 18);
});

test('battle input carries the bench only when a board piece has a switch garrison', () => {
  const s = setup();
  give(s.m, s.ps, 'chess_char_6_05_a', 'board', [10, 4]);
  give(s.m, s.ps, 'chess_char_1_06_a', 'hand');
  const bench = s.ps.battleInput().bench;
  assert.equal(bench.length, 1);
  assert.equal(bench[0].chessId, 'chess_char_1_06_a');
  assert.ok(bench[0].bonds.includes('kjeragShip'));
  const quiet = setup();
  give(quiet.m, quiet.ps, 'chess_char_1_06_a', 'board', [10, 4]);
  give(quiet.m, quiet.ps, 'chess_char_6_05_a', 'hand');
  assert.equal(quiet.ps.battleInput().bench, undefined);
  const def = makeMatch({ mode: 'solo', seed: 3, registry: REG, fake: true }).start();
  def.toPrep(1);
  const ps = def.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  give(def.m, ps, 'chess_char_1_02_a', 'board', [10, 4]);
  give(def.m, ps, 'chess_char_1_03_a', 'hand');
  assert.equal(ps.battleInput().bench, undefined, 'default tables have no switch key');
});

test('enemykilled in range: one layer per enemy, the cap holds, a knocked-out carrier skips', () => {
  const h = battle(
    [{ id: 'op', g: ['garrison_01_a'], row: 10, col: 4, bonds: ['lethaniaShip'] }],
    { lethaniaShip: B(0) },
  );
  const far = h.spawn('e_dummy', { pos: [12, 8] });
  h.b.kill(far);
  assert.equal(lg(h, 'lethaniaShip'), 0);
  const nearE = h.spawn('e_dummy', { pos: [10, 5] });
  h.b.kill(nearE);
  assert.equal(lg(h, 'lethaniaShip'), 1);
  h.b.kill(h.spawn('e_dummy', { pos: [10, 5] }));
  assert.equal(lg(h, 'lethaniaShip'), 1, 'cap 1');

  const down = battle(
    [{ id: 'op', g: ['garrison_01_a'], row: 10, col: 4, bonds: ['lethaniaShip'] }],
    { lethaniaShip: B(0) },
  );
  down.b.kill(down.unit('op'));
  down.b.kill(down.spawn('e_dummy', { pos: [10, 5] }));
  assert.equal(lg(down, 'lethaniaShip'), 0);
});

test('minus respawn cuts an operator who is already down; garrison_170 only queues a bench ratio', () => {
  const h = battle([
    { id: 'op', g: ['garrison_70_a', 'garrison_150_a'], row: 10, col: 4 },
    { id: 'ally', row: 10, col: 5 },
  ]);
  const ally = h.unit('ally');
  h.b.kill(ally);
  const before = ally.respawnAt;
  h.b.kill(h.spawn('e_dummy', { pos: [ally.tileR, ally.tileC] }));
  near(ally.respawnAt, before - 3, 'remaining timer −3');

  const bench = battle(
    [{ id: 'op', g: ['garrison_170_a', 'garrison_171_a'], row: 10, col: 4 }],
    {},
    { chess: { bench: rec('bench', [], { bonds: ['kazimierzShip'] }) } },
  );
  bench.b.getPlayer('p1').input.bench = [{ uid: 77, kind: 'chess', chessId: 'bench', idx: 3, bonds: ['kazimierzShip'] }];
  const n = bench.b.allyUnits.length;
  bench.b.kill(bench.unit('op'));
  assert.equal(bench.b.allyUnits.length, n, 'garrison_170 does not summon');
  assert.deepEqual(bench.b._benchCuts[77], [{ ratio: true, value: 0.7 }]);
});

test('switch summon: the carrier leaves and the rightmost matching bench chess takes its tile; its garrison installs', () => {
  const h = battle(
    [{ id: 'op', g: ['garrison_223_a', 'garrison_224_a'], row: 10, col: 4, bonds: ['kazimierzShip'] }],
    { kazimierzShip: B(0) },
    { chess: {
      left: rec('left', [], { bonds: ['kazimierzShip'] }),
      right: rec('right', ['garrison_88_a'], { bonds: ['kazimierzShip'] }),
      decoy: rec('decoy', [], { bonds: ['yanShip'] }),
    } },
  );
  h.b.getPlayer('p1').input.bench = [
    { uid: 11, kind: 'chess', chessId: 'left', idx: 1, bonds: ['kazimierzShip'] },
    { uid: 55, kind: 'chess', chessId: 'right', idx: 5, bonds: ['kazimierzShip'] },
    { uid: 99, kind: 'chess', chessId: 'decoy', idx: 9, bonds: ['yanShip'] },
  ];
  const op = h.unit('op');
  const death = [op.tileR, op.tileC];
  h.b.kill(op);
  const summoned = h.b.allyUnits.find((u) => u.uid === 55);
  assert.ok(summoned && summoned.alive && summoned.deployed);
  assert.deepEqual([summoned.tileR, summoned.tileC], death, '_putType ORIGINAL: the carrier\'s tile');
  assert.equal(op.removed, true, 'switched out: the carrier left the battle');
  assert.equal(h.b.isDown(op), false, 'it does not redeploy');
  const enemy = h.spawn('e_dummy', { pos: [11, 8] });
  h.b.dealDamage(summoned, enemy, { amount: 10, type: 'true' });
  assert.ok(enemy.findBuff('cold'), 'the summoned garrison was installed late');
  assert.equal(enemy.findBuff('freeze'), null);
});

test('switchhand: both bonds are required, and the carrier plus the summon each gain 6', () => {
  const h = battle(
    [{ id: 'op', g: ['garrison_58_a'], row: 10, col: 4, bonds: ['kazimierzShip', 'raidShip'] }],
    { kazimierzShip: B(0), raidShip: B(0) },
    { chess: {
      both: rec('both', [], { bonds: ['kazimierzShip', 'raidShip'] }),
      only: rec('only', [], { bonds: ['kazimierzShip'] }),
    } },
  );
  h.b.getPlayer('p1').input.bench = [
    { uid: 21, kind: 'chess', chessId: 'both', idx: 2, bonds: ['kazimierzShip', 'raidShip'] },
    { uid: 90, kind: 'chess', chessId: 'only', idx: 8, bonds: ['kazimierzShip'] },
  ];
  h.b.kill(h.unit('op'));
  const summoned = h.b.allyUnits.find((u) => u.uid === 21);
  assert.ok(summoned && summoned.alive && summoned.deployed);
  assert.equal(h.b.allyUnits.some((u) => u.uid === 90), false);
  assert.equal(lg(h, 'kazimierzShip'), 12);
  assert.equal(lg(h, 'raidShip'), 12);
});

test('boss retains battle-start temporary receipts; unite cannot gain new layers', () => {
  const off = battle(
    [{ id: 'op', g: ['garrison_13_a'], row: 10, col: 4, bonds: ['ursusShip'] }],
    { ursusShip: B(0) },
    { kind: 'boss', flags: { layerGainsEnabled: false } },
  );
  assert.equal(off.b._perPlayer.p1.tempLayerGains.ursusShip, 4);
  const unite = battle(
    [{ id: 'op', g: ['garrison_13_a'], row: 10, col: 4, bonds: ['ursusShip'] }],
    { ursusShip: B(0) },
    { kind: 'unite' },
  );
  assert.equal(unite.b._perPlayer.p1.tempLayerGains, undefined);
});

test('bondstackmax raises another operator cap when a chess bond is shared', () => {
  const h = battle([
    { id: 'op', g: ['garrison_152_a', 'garrison_156_a'], row: 10, col: 4, bonds: ['lethaniaShip', 'kazimierzShip'] },
    { id: 'share', g: ['garrison_01_a'], row: 10, col: 6, bonds: ['lethaniaShip'] },
    { id: 'other', g: ['garrison_01_a'], row: 11, col: 6, bonds: ['yanShip'] },
  ], { lethaniaShip: B(0), kazimierzShip: B(0), yanShip: B(0) });
  const cap = (id) => h.b._garInstances.find((it) => it.unit === h.unit(id) && it.gid === 'garrison_01_a').cap;
  assert.equal(cap('share'), 8);
  assert.equal(cap('other'), 1);
  const own = h.b._garInstances.find((it) => it.unit === h.unit('op') && it.gid === 'garrison_01_a');
  assert.equal(own, undefined, 'filter_bond_by_self skips the carrier');
});

test('bondstackmax filter_bond_ids matches ANY listed bond (garrison_227: 【谢拉格】 or 【灵巧】)', () => {
  // AutoChessFilterCharacterBondIds._FilterBondId returns on the first listed bond the operator has.
  for (const bond of ['kjeragShip', 'skillfulShip']) {
    const h = battle([
      { id: 'op', g: ['garrison_227_a'], row: 10, col: 4 },
      { id: 'front', g: ['garrison_08_a'], row: 10, col: 5, bonds: [bond] },
    ], { [bond]: B(0) });
    const it = h.b._garInstances.find((x) => x.unit === h.unit('front') && x.gid === 'garrison_08_a');
    assert.equal(it.cap, Math.floor(8 * 1.75), bond);
  }
  const neither = battle([
    { id: 'op', g: ['garrison_227_a'], row: 10, col: 4 },
    { id: 'front', g: ['garrison_08_a'], row: 10, col: 5, bonds: ['yanShip'] },
  ], { yanShip: B(0) });
  const it = neither.b._garInstances.find((x) => x.unit === neither.unit('front') && x.gid === 'garrison_08_a');
  assert.equal(it.cap, 8, 'neither listed bond: no raise');
});

test('addsp payloads: freeze, skill, kill, and death; garrison_155 grants no 谢拉格 layers', () => {
  const freeze = battle(
    [{ id: 'op', g: ['garrison_155_a', 'garrison_154_a'], row: 10, col: 4, bonds: ['kjeragShip'] }],
    { kjeragShip: B(0) },
  );
  const beforeF = freeze.unit('op').skill.sp;
  freeze.b.applyStatus(freeze.spawn('e_dummy', { pos: [10, 5] }), 'freeze', { duration: 3, source: freeze.unit('op') });
  near(freeze.unit('op').skill.sp, beforeF + 1);
  assert.equal(lg(freeze, 'kjeragShip'), 0);

  const skill = battle([
    { id: 'op', g: ['garrison_44_a', 'garrison_233_a'], row: 10, col: 4 },
    { id: 'front', row: 10, col: 5 },
  ]);
  const beforeS = skill.unit('front').skill.sp;
  const beforeSelf = skill.unit('op').skill.sp;
  skill.b.emit('skillStart', { unit: skill.unit('op'), skill: skill.unit('op').skill });
  near(skill.unit('front').skill.sp, beforeS + 2);
  near(skill.unit('op').skill.sp, beforeSelf);

  const kill = battle([{ id: 'op', g: ['garrison_167_a', 'garrison_169_a'], row: 10, col: 4 }]);
  const beforeK = kill.unit('op').skill.sp;
  kill.b.kill(kill.spawn('e_dummy', { pos: [10, 5] }));
  near(kill.unit('op').skill.sp, beforeK + 3);

  const dead = battle([
    { id: 'op', g: ['garrison_62_a', 'garrison_146_a'], row: 10, col: 4 },
    { id: 'ally', row: 11, col: 4, bonds: ['egirShip'] },
  ]);
  const beforeD = dead.unit('ally').skill.sp;
  dead.b.kill(dead.unit('op'));
  near(dead.unit('ally').skill.sp, beforeD + 5);
});

test('attackslow and attr-by-bond follow the layer band inside the cross', () => {
  const slow = battle(
    [{ id: 'op', g: ['garrison_59_a'], row: 10, col: 4, bonds: ['egirShip'] }],
    { egirShip: B(20) },
  );
  const enemy = slow.spawn('e_dummy', { pos: [11, 8] });
  slow.b.dealDamage(slow.unit('op'), enemy, { amount: 10, type: 'true' });
  const buff = enemy.findBuff('gar:garrison_59_a:slow');
  assert.ok(buff);
  near(buff.mods.moveMul, 0.99);

  const more = battle(
    [{ id: 'op', g: ['garrison_59_a'], row: 10, col: 4, bonds: ['egirShip'] }],
    { egirShip: B(40) },
  );
  const enemy2 = more.spawn('e_dummy', { pos: [11, 8] });
  more.b.dealDamage(more.unit('op'), enemy2, { amount: 10, type: 'true' });
  near(more.unit('op') && enemy2.findBuff('gar:garrison_59_a:slow').mods.moveMul, 0.98);

  const aura = battle([
    { id: 'op', g: ['garrison_60_a', 'garrison_142_a'], row: 10, col: 4, bonds: ['egirShip'] },
    { id: 'side', row: 11, col: 4, bonds: ['egirShip'] },
    { id: 'far', row: 12, col: 8 },
  ], { egirShip: B(20) });
  const self = aura.unit('op').findBuff('gar:garrison_142_a:aura');
  const side = aura.unit('side').findBuff('gar:garrison_142_a:aura');
  assert.equal(self.mods.aspd, 1);
  assert.equal(side.mods.aspd, 1);
  assert.ok(self.timeLeft > 29);
  assert.equal(aura.unit('far').findBuff('gar:garrison_142_a:aura'), null);
});

test('H5 attr-by-bond: the child without its onstart parent does not fire', () => {
  const h = battle(
    [{ id: 'op', g: ['garrison_142_a'], row: 10, col: 4, bonds: ['egirShip'] }],
    { egirShip: B(20) },
  );
  assert.equal(h.unit('op').findBuff('gar:garrison_142_a:aura'), null);
});

test('H5 attr-by-bond: a later-column neighbor misses the opening snapshot', () => {
  const h = battle([
    { id: 'op', g: ['garrison_60_a', 'garrison_142_a'], row: 10, col: 4, bonds: ['egirShip'] },
    { id: 'above', row: 11, col: 4 },
    { id: 'right', row: 10, col: 5 },
    { id: 'below', row: 9, col: 4 },
  ], { egirShip: B(20) });
  assert.equal(h.unit('op').findBuff('gar:garrison_142_a:aura').mods.aspd, 1);
  assert.equal(h.unit('above').findBuff('gar:garrison_142_a:aura').mods.aspd, 1, 'higher row deploys first');
  assert.equal(h.unit('right').findBuff('gar:garrison_142_a:aura'), null, 'later column is not born yet');
  assert.equal(h.unit('below').findBuff('gar:garrison_142_a:aura'), null, 'lower row in the same column deploys later');
});

test('H5 attr-by-bond: layer changes do not refresh, and the buff ends at attr_duration', () => {
  const h = battle([
    { id: 'op', g: ['garrison_60_a', 'garrison_142_a'], row: 10, col: 4, bonds: ['egirShip'] },
    { id: 'side', row: 11, col: 4 },
    { id: 'far', row: 12, col: 8 },
  ], { egirShip: B(20) });
  assert.equal(h.unit('op').findBuff('gar:garrison_142_a:aura').mods.aspd, 1);
  h.b.addTempLayers('p1', 'egirShip', 20);
  h.step(1);
  assert.equal(h.unit('op').findBuff('gar:garrison_142_a:aura').mods.aspd, 1, '40 layers do not rewrite the snapshot');
  assert.equal(h.unit('side').findBuff('gar:garrison_142_a:aura').mods.aspd, 1);
  assert.equal(h.unit('far').findBuff('gar:garrison_142_a:aura'), null);
  h.run(31);
  assert.equal(h.unit('op').findBuff('gar:garrison_142_a:aura'), null);
  assert.equal(h.unit('side').findBuff('gar:garrison_142_a:aura'), null);
  h.b.addTempLayers('p1', 'egirShip', 20);
  h.step(1);
  assert.equal(h.unit('op').findBuff('gar:garrison_142_a:aura'), null, 'expiry is not a new deployment');
});

test('H5 attr-by-bond: a redeploy writes a new 30s snapshot', () => {
  const h = battle([
    { id: 'op', g: ['garrison_60_a', 'garrison_142_a'], row: 10, col: 4, bonds: ['egirShip'] },
    { id: 'side', row: 11, col: 4 },
  ], { egirShip: B(20) });
  h.run(10);
  assert.ok(h.unit('side').findBuff('gar:garrison_142_a:aura').timeLeft < 21);
  h.b.addTempLayers('p1', 'egirShip', 20);
  h.b.kill(h.unit('op'));
  assert.equal(h.b.redeploy(h.unit('op'), { free: true }), true);
  const self = h.unit('op').findBuff('gar:garrison_142_a:aura');
  const side = h.unit('side').findBuff('gar:garrison_142_a:aura');
  assert.equal(self.mods.aspd, 2);
  assert.equal(side.mods.aspd, 2);
  assert.ok(self.timeLeft > 29);
  assert.ok(side.timeLeft > 29);
});

test('H5 attr-by-bond: moving snapshots the new cross and leaves the old buff', () => {
  const h = battle([
    { id: 'op', g: ['garrison_60_a', 'garrison_142_a'], row: 10, col: 4, bonds: ['egirShip'] },
    { id: 'side', row: 11, col: 4 },
    { id: 'far', row: 12, col: 8 },
  ], { egirShip: B(20) });
  h.run(5);
  const sideLeft = h.unit('side').findBuff('gar:garrison_142_a:aura').timeLeft;
  assert.equal(h.b.moveRedeploy(h.unit('op'), 12, 7), true);
  const far = h.unit('far').findBuff('gar:garrison_142_a:aura');
  assert.equal(far.mods.aspd, 1);
  assert.ok(far.timeLeft > 29);
  const side = h.unit('side').findBuff('gar:garrison_142_a:aura');
  assert.equal(side.mods.aspd, 1);
  assert.ok(side.timeLeft <= sideLeft, 'a unit that left the cross keeps the remainder');
});

test('H5 attr-by-bond: garrison_144 snapshots attack on the cross', () => {
  const h = battle([
    { id: 'op', g: ['garrison_63_a', 'garrison_144_a'], row: 10, col: 4, bonds: ['egirShip'] },
    { id: 'side', row: 11, col: 4 },
    { id: 'far', row: 12, col: 8 },
  ], { egirShip: B(20) });
  const self = h.unit('op').findBuff('gar:garrison_144_a:aura');
  assert.equal(self.mods.atkPct, 0.01);
  assert.equal(self.mods.aspd, undefined);
  assert.ok(self.timeLeft > 29);
  assert.equal(h.unit('side').findBuff('gar:garrison_144_a:aura').mods.atkPct, 0.01);
  assert.equal(h.unit('far').findBuff('gar:garrison_144_a:aura'), null);
});

test('switch summon: a moved carrier is switched on the tile it fell on; its body at home goes too', () => {
  const h = battle(
    [
      { id: 'op', uid: 1, g: ['garrison_223_a', 'garrison_224_a'], row: 10, col: 4, bonds: ['kazimierzShip'] },
      // A board uid makes (10, 6) another piece's 初始位置, so the body returns home and the fall tile is free.
      { id: 'mark', uid: 2, row: 10, col: 6 },
    ],
    { kazimierzShip: B(0) },
    { chess: { right: rec('right', [], { bonds: ['kazimierzShip'] }) } },
  );
  h.b.getPlayer('p1').input.bench = [
    { uid: 55, kind: 'chess', chessId: 'right', idx: 5, bonds: ['kazimierzShip'] },
  ];
  assert.equal(h.b.relocate(h.unit('mark'), 11, 6), true);
  assert.equal(h.b.relocate(h.unit('op'), 10, 6), true);
  h.b.kill(h.unit('op'));
  const summoned = h.b.allyUnits.find((u) => u.uid === 55);
  assert.ok(summoned && summoned.alive && summoned.deployed);
  assert.equal(summoned.tileR, 10);
  assert.equal(summoned.tileC, 6);
  assert.equal(h.unit('op').removed, true, 'switched out');
  assert.equal(h.b.isDown(h.unit('op')), false, 'it does not redeploy');
  assert.equal(h.b.downOn(10, 4), null, 'no body left on its home tile');
});

test('switch summon: a bench chess that cannot stand on the carrier\'s tile is skipped; none fits → the carrier stays down', () => {
  const probe = battle([{ id: 'x', row: 10, col: 4 }]);
  const ps = probe.b.getPlayer('p1');
  let high = null;
  for (let r = 0; r < 30 && !high; r++) {
    for (let c = 0; c < 60 && !high; c++) {
      if (!probe.b.grid.inRect(r, c) || !probe.b.onOwnBoard(ps, r, c)) continue;
      if (probe.b.grid.canStand(r, c, { ranged: true }) && !probe.b.grid.canStand(r, c)) high = [r, c];
    }
  }
  assert.ok(high, 'the test board has a tile only a ranged chess can stand on');
  const mk = (bench) => {
    const h = battle(
      [{ id: 'op', g: ['garrison_223_a', 'garrison_224_a'], row: high[0], col: high[1], bonds: ['kazimierzShip'],
        position: 'RANGED', profession: 'SNIPER' }],
      { kazimierzShip: B(0) },
      { chess: {
        melee: rec('melee', [], { bonds: ['kazimierzShip'] }),
        far: rec('far', [], { bonds: ['kazimierzShip'], position: 'RANGED', profession: 'SNIPER' }),
      } },
    );
    h.b.getPlayer('p1').input.bench = bench;
    return h;
  };
  const h = mk([
    { uid: 31, kind: 'chess', chessId: 'far', idx: 1, bonds: ['kazimierzShip'] },
    { uid: 32, kind: 'chess', chessId: 'melee', idx: 6, bonds: ['kazimierzShip'] },
  ]);
  assert.ok(h.unit('op').deployed, 'the ranged carrier stands on the ranged tile');
  h.b.kill(h.unit('op'));
  assert.equal(h.b.allyUnits.some((u) => u.uid === 32), false, '_checkOriginBuildable: the melee chess is skipped');
  const far = h.b.allyUnits.find((u) => u.uid === 31);
  assert.ok(far && far.deployed);
  assert.deepEqual([far.tileR, far.tileC], high);

  const none = mk([{ uid: 32, kind: 'chess', chessId: 'melee', idx: 6, bonds: ['kazimierzShip'] }]);
  const op = none.unit('op');
  none.b.kill(op);
  assert.equal(none.b.allyUnits.some((u) => u.uid === 32), false);
  assert.equal(op.removed, false);
  assert.equal(none.b.isDown(op), true, 'no switch: the carrier stays down and redeploys');
});

test('H5 bondstackmax: a carrier installed after start does not raise caps', () => {
  const h = battle([
    { id: 'share', g: ['garrison_01_a'], row: 10, col: 6, bonds: ['lethaniaShip'] },
    { id: 'front', g: ['garrison_08_a'], row: 10, col: 5, bonds: ['kjeragShip'] },
  ], { lethaniaShip: B(0), kazimierzShip: B(0), kjeragShip: B(0) }, {
    chess: {
      lateParent: rec('lateParent', ['garrison_152_a', 'garrison_156_a'], { bonds: ['lethaniaShip', 'kazimierzShip'] }),
      lateChild: rec('lateChild', ['garrison_227_a']),
    },
  });
  const capOf = (id, gid) => h.b._garInstances.find((it) => it.unit === h.unit(id) && it.gid === gid).cap;
  assert.equal(capOf('share', 'garrison_01_a'), 1);
  assert.equal(capOf('front', 'garrison_08_a'), 8);
  const parent = h.b.spawnOperator('p1', 'lateParent', 11, 4, { uid: 80 });
  assert.ok(parent && parent.deployed);
  h.b._installGarrisonLate(parent);
  assert.equal(capOf('share', 'garrison_01_a'), 1, 'battlestart does not re-fire after the mode change');
  const child = h.b.spawnOperator('p1', 'lateChild', 10, 4, { uid: 82 });
  assert.ok(child && child.deployed);
  h.b._installGarrisonLate(child);
  assert.equal(capOf('front', 'garrison_08_a'), 8, 'a late bondstackmax child does not apply');
});

test('H5 bondstackmax: an operator who appears after start keeps the base cap', () => {
  const h = battle([
    { id: 'op', g: ['garrison_152_a', 'garrison_156_a'], row: 10, col: 4, bonds: ['lethaniaShip', 'kazimierzShip'] },
    { id: 'share', g: ['garrison_01_a'], row: 10, col: 6, bonds: ['lethaniaShip'] },
  ], { lethaniaShip: B(0), kazimierzShip: B(0) }, {
    chess: { late: rec('late', ['garrison_01_a'], { bonds: ['lethaniaShip'] }) },
  });
  const late = h.b.spawnOperator('p1', 'late', 11, 6, { uid: 81 });
  assert.ok(late && late.deployed);
  h.b._installGarrisonLate(late);
  const it = h.b._garInstances.find((x) => x.unit === late && x.gid === 'garrison_01_a');
  assert.equal(it.cap, 1);
  const share = h.b._garInstances.find((x) => x.unit === h.unit('share') && x.gid === 'garrison_01_a');
  assert.equal(share.cap, 8);
});

test('erosion recovery rate is the layer band, and a tick shortens the lock', () => {
  const h = battle(
    [{ id: 'op', g: ['garrison_65_a'], row: 10, col: 4, bonds: ['egirShip'] }],
    { egirShip: B(20) },
  );
  const it = h.b._garInstances.find((x) => x.gid === 'garrison_65_a');
  near(it._epRate, 0.01);
  const enemy = h.spawn('e_dummy', { pos: [11, 4] });
  h.b.addBuff(enemy, { key: 'erosionBurst', duration: 10 });
  const before = enemy.findBuff('erosionBurst').timeLeft;
  h.step(1);
  assert.ok(enemy.findBuff('erosionBurst').timeLeft < before - 1e-9);
  const quiet = battle(
    [{ id: 'op', g: ['garrison_65_a'], row: 10, col: 4, bonds: ['egirShip'] }],
    { egirShip: B(0) },
  );
  near(quiet.b._garInstances.find((x) => x.gid === 'garrison_65_a')._epRate, 0);
});

test('ex_bond_cnt adds extra on garrison and item gains only, from the carrier who holds it', () => {
  const gain = (reason, source) => {
    const h = battle(
      [
        { id: 'op', g: ['garrison_235_a'], row: 10, col: 4 },
        { id: 'other', row: 10, col: 5 },
      ],
      { emptyShip: B(0) },
    );
    const src = source === 'op' ? h.unit('op') : source === 'other' ? h.unit('other') : source;
    return h.b.addLayers('p1', 'emptyShip', 1, reason, { source: src });
  };
  assert.equal(gain('garrison', 'op'), 2);
  assert.equal(gain('item', 'op'), 2);
  assert.equal(gain('bond', 'op'), 1);
  assert.equal(gain('garrison', { ownerId: 'nope' }), 1);
  assert.equal(gain('garrison', 'other'), 1, 'another ally is not the buff owner');
  assert.equal(gain('garrison', null), 1, 'a gain with no source is not the buff owner');

  const both = battle([
    { id: 'op', g: ['garrison_235_a'], row: 10, col: 4 },
    { id: 'other', g: ['garrison_235_b'], row: 10, col: 5 },
  ], { emptyShip: B(0) });
  assert.equal(both.b.addLayers('p1', 'emptyShip', 1, 'garrison', { source: both.unit('op') }), 2);
  assert.equal(both.b.addLayers('p1', 'emptyShip', 1, 'garrison', { source: both.unit('other') }), 3);
});

test('garrison_124 grants 不屈 on a 傀儡 swap; a charger selfdead does not', () => {
  const h = battle(
    [{ id: 'op', g: ['garrison_124_a'], row: 10, col: 4, bonds: ['indomShip'], profession: 'SPECIAL', subProfessionId: 'dollkeeper' }],
    { indomShip: B(0) },
  );
  const u = h.unit('op');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.deployed && u.trait.doll, 'a lethal hit on the body switches to the substitute');
  assert.equal(lg(h, 'indomShip'), 0, 'the swap is noticed on the next tick, not inside the hit');
  h.step(1);
  assert.equal(lg(h, 'indomShip'), 2);

  const charger = battle(
    [{ id: 'op', g: ['garrison_223_a'], row: 10, col: 4, bonds: ['kazimierzShip'], profession: 'PIONEER', subProfessionId: 'charger' }],
    { kazimierzShip: B(0) },
  );
  const c = charger.unit('op');
  c.trait.doll = true;
  charger.step(1);
  assert.equal(lg(charger, 'kazimierzShip'), 0, '历阵锐枪芬 has no 替身 or 傀儡 text');
  assert.equal(charger.b.allyUnits.filter((x) => x !== c && x.deployed).length, 0);
});

test('first damaging hit applies cold once per enemy', () => {
  const h = battle([{ id: 'op', g: ['garrison_88_a'], row: 10, col: 4 }]);
  const enemy = h.spawn('e_dummy', { pos: [11, 8] });
  h.b.dealDamage(h.unit('op'), enemy, { amount: 10, type: 'true' });
  assert.ok(enemy.findBuff('cold'));
  assert.equal(enemy.findBuff('freeze'), null);
  h.b.dealDamage(h.unit('op'), enemy, { amount: 10, type: 'true' });
  assert.equal(enemy.findBuff('freeze'), null);
  const other = h.spawn('e_dummy', { pos: [12, 8] });
  h.b.dealDamage(h.unit('op'), other, { amount: 10, type: 'true' });
  assert.ok(other.findBuff('cold'));
});

test('ursus temp extra is the base until six distinct on-field members, then the power field', () => {
  const one = battle(
    [{ id: 'op', g: ['garrison_23_a'], row: 10, col: 4, bonds: ['ursusShip'], charId: 'c0' }],
    { ursusShip: B(0) },
  );
  const lone = one.b._garInstances.find((x) => x.key === 'act3autochess_gar_effect_ursusexbondcnt');
  lone.bb = { ...lone.bb, 'ex_bond_cnt[power]': 9 };
  assert.equal(ursusTempExtra(one.b, 'p1'), 2);
  const units = [];
  for (let i = 0; i < 6; i++) {
    units.push({ id: `u${i}`, g: i === 0 ? ['garrison_23_a'] : [], row: 10, col: 3 + i, bonds: ['ursusShip'], charId: `c${i}` });
  }
  const many = battle(units, { ursusShip: B(0) });
  assert.equal(ursusTempExtra(many.b, 'p1'), 2, 'the published base and power extras are equal');
  const it = many.b._garInstances.find((x) => x.key === 'act3autochess_gar_effect_ursusexbondcnt');
  it.bb = { ...it.bb, 'ex_bond_cnt[power]': 9 };
  assert.equal(ursusTempExtra(many.b, 'p1'), 9);
});

test('element burst in range adds layers; the eight-tile grid excludes the carrier tile', () => {
  const grid = battle(
    [{ id: 'op', g: ['garrison_38_a'], row: 10, col: 4, bonds: ['yanShip', 'steadShip'] }],
    { yanShip: B(0), steadShip: B(0) },
  );
  const onSelf = grid.spawn('e_dummy', { pos: [10, 4] });
  grid.b.emit('elementBurst', { source: null, credit: null, target: onSelf, element: 'erosion' });
  assert.equal(lg(grid, 'yanShip'), 0);
  const beside = grid.spawn('e_dummy', { pos: [11, 4] });
  grid.b.emit('elementBurst', { source: null, credit: null, target: beside, element: 'erosion' });
  grid.b.emit('elementBurst', { source: null, credit: null, target: beside, element: 'burn' });
  assert.equal(lg(grid, 'yanShip'), 2);
  assert.equal(lg(grid, 'steadShip'), 2);

  const attack = battle(
    [{ id: 'op', g: ['garrison_41_a'], row: 10, col: 4, bonds: ['yanShip', 'victoriaShip'] }],
    { yanShip: B(0), victoriaShip: B(0) },
  );
  const front = attack.spawn('e_dummy', { pos: [10, 5] });
  attack.b.emit('elementBurst', { source: null, credit: null, target: front, element: 'erosion' });
  assert.equal(lg(attack, 'yanShip'), 1);
  assert.equal(lg(attack, 'victoriaShip'), 1);
});

test('onstart in the attack range counts the carrier and a front ally, not a far one', () => {
  const units = [
    { id: 'op', g: ['garrison_64_a'], row: 10, col: 4, bonds: ['egirShip'] },
    { id: 'front', row: 10, col: 5, bonds: ['egirShip'] },
    { id: 'far', row: 12, col: 8 },
  ];
  const h = battle(units, { egirShip: B(0) });
  // 阿戈尔's own opening devour also writes egirShip. The garrison's share is the difference.
  const bare = battle(units.map((u) => ({ ...u, g: [] })), { egirShip: B(0) });
  assert.equal(lg(h, 'egirShip') - lg(bare, 'egirShip'), 4);
});

test('sleepstun: bond_self pays the carrier; bond_allinrange pays the operator behind (elite pair: not the carrier twice)', () => {
  const self = battle([
    { id: 'op', g: ['garrison_49_a'], row: 10, col: 4, bonds: ['sargonShip', 'skillfulShip'] },
    { id: 'behind', row: 10, col: 3, bonds: ['yanShip'] },
  ], { sargonShip: B(0), skillfulShip: B(0), yanShip: B(0) });
  self.b.applyStatus(self.spawn('e_dummy', { pos: [11, 4] }), 'stun', { duration: 3, source: self.unit('op') });
  assert.equal(lg(self, 'sargonShip'), 1);
  assert.equal(lg(self, 'skillfulShip'), 1);
  assert.equal(lg(self, 'yanShip'), 0);

  const behind = battle([
    { id: 'op', g: ['garrison_237_a'], row: 10, col: 4, bonds: ['sargonShip'] },
    { id: 'back', row: 10, col: 3, bonds: ['yanShip'] },
  ], { sargonShip: B(0), yanShip: B(0) });
  behind.b.applyStatus(behind.spawn('e_dummy', { pos: [11, 4] }), 'stun', { duration: 3, source: behind.unit('op') });
  assert.equal(lg(behind, 'sargonShip'), 0, 'garrison_237_a does not say 自身');
  assert.equal(lg(behind, 'yanShip'), 1);

  // the elite pair: 49_b pays the carrier, 237_b (its text says 自身及身后 too) only the one behind — not the carrier again
  const elite = battle([
    { id: 'op', g: ['garrison_49_b', 'garrison_237_b'], row: 10, col: 4, bonds: ['sargonShip'] },
    { id: 'back', row: 10, col: 3, bonds: ['yanShip'] },
  ], { sargonShip: B(0), yanShip: B(0) });
  elite.b.applyStatus(elite.spawn('e_dummy', { pos: [11, 4] }), 'stun', { duration: 3, source: elite.unit('op') });
  assert.equal(lg(elite, 'sargonShip'), 2, 'the carrier +2 once (49_b), not +4');
  assert.equal(lg(elite, 'yanShip'), 2, 'the one behind +2 (237_b)');
});

test('tempLayerGains is optional on the result wire and rejected when it is not a real bond', () => {
  const spec = buildBattleSpec({
    battleId: 'x', fieldId: 'n:p', kind: 'normal', round: 3, stageId: 's', timeLimit: 120,
    players: [{ playerId: 'p', units: [{ uid: 5, kind: 'chess', chessId: 'chess_char_1_a', row: 9, col: 3 }] }],
    spawns: [{ enemyKey: 'enemy_1007_slime', count: 3, time: 0, bounty: { coins: 2, ownerPlayerId: 'p' } }],
    flags: { layerGainsEnabled: true },
  });
  const ok = {
    reason: 'timeout', time: 120,
    perPlayer: { p: {
      killed: 2, total: 3, leaked: [{ enemyKey: 'enemy_1007_slime', counted: true }], perfect: false,
      layerGains: { yanShip: 3 }, coins: 4, unitsEnd: [{ uid: 5, hpPct: 0.5, sp: 2, alive: true }],
    } },
  };
  // A gd makes the permanent-layer check require a lineup bond. The chess record names yanShip;
  // ursusShip is only a temporary gain and does not have to be one the player started with.
  const gd = {
    bond: (id) => (id === 'yanShip' || id === 'ursusShip' ? { id } : null),
    chess: (id) => (id === 'chess_char_1_a' ? { id, bonds: ['yanShip'] } : null),
  };
  const withTemp = structuredClone(ok);
  withTemp.perPlayer.p.tempLayerGains = { ursusShip: 3.2 };
  const validated = validateClientResult(spec, withTemp, { gd });
  assert.equal(validated.ok, true);
  assert.equal(validated.result.perPlayer.p.tempLayerGains.ursusShip, 3);
  const badBond = structuredClone(withTemp);
  badBond.perPlayer.p.tempLayerGains = { nopeShip: 1 };
  assert.equal(validateClientResult(spec, badBond, { gd }).reason, 'temp bond');
  const huge = structuredClone(withTemp);
  huge.perPlayer.p.tempLayerGains = { ursusShip: 10001 };
  assert.equal(validateClientResult(spec, huge, { gd }).reason, 'temp layers');
  // round 83: at most 8 per counted knock-out + 200 (killed 2 → 216), not the ledger's 10000 (a later 联防 fights with it)
  const edge = structuredClone(withTemp);
  edge.perPlayer.p.tempLayerGains = { ursusShip: 216 };
  assert.equal(validateClientResult(spec, edge, { gd }).ok, true);
  edge.perPlayer.p.tempLayerGains = { ursusShip: 217 };
  assert.equal(validateClientResult(spec, edge, { gd }).reason, 'temp layers');
  const unite = buildBattleSpec({ ...spec, kind: 'unite', flags: { layerGainsEnabled: false } });
  assert.equal(validateClientResult(unite, withTemp, { gd }).reason, 'layers disabled');
  const onlyTemp = structuredClone(withTemp);
  onlyTemp.perPlayer.p.layerGains = {};
  assert.equal(validateClientResult(unite, onlyTemp, { gd }).reason, 'layers disabled', 'no new temporary receipts in unite');
  const boss = buildBattleSpec({ ...spec, kind: 'boss', flags: { layerGainsEnabled: false } });
  assert.equal(validateClientResult(boss, onlyTemp, { gd }).ok, true, 'boss can report temporary layers for next-prep conversion');

  const compact = compactResult({ reason: 'timeout', time: 1, perPlayer: { p: { tempLayerGains: { ursusShip: 3.2 } } } });
  assert.equal(compact.perPlayer.p.tempLayerGains.ursusShip, 3);
  const omitted = compactResult({ reason: 'timeout', time: 1, perPlayer: { p: { tempLayerGains: {} } } });
  assert.equal(omitted.perPlayer.p.tempLayerGains, undefined);

  const bare = { reason: 'timeout', time: 1, perPlayer: { p: { killed: 0, total: 0, perfect: true, layerGains: {}, coins: 0, leaked: [], unitsEnd: [] } } };
  const empty = structuredClone(bare);
  empty.perPlayer.p.tempLayerGains = {};
  assert.equal(resultDigest(bare).hash, resultDigest(empty).hash);
  const filled = structuredClone(bare);
  filled.perPlayer.p.tempLayerGains = { ursusShip: 3 };
  assert.notEqual(resultDigest(bare).hash, resultDigest(filled).hash);
  assert.equal(isBattleResult(filled), true);
  filled.perPlayer.p.tempLayerGains = { ursusShip: 10001 };
  assert.equal(isBattleResult(filled), false);
});

// Regression coverage from bmryggdrasil's PR #962.

test('garrison_13 (battlestart) and garrison_23 (ursus temp extra) boost live 乌萨斯 stats', () => {
  const hStart = battle(
    [{ id: 'op', g: ['garrison_13_a'], row: 10, col: 4, bonds: ['ursusShip'] }],
    { ursusShip: B(0) },
  );
  const us = hStart.unit('op');
  assert.equal(hStart.b.tempLayers('p1', 'ursusShip'), 4);
  assert.equal(hStart.b.result().perPlayer.p1.tempLayerGains.ursusShip, 4);
  assert.equal(lg(hStart, 'ursusShip'), 0);
  near(us.s.atk, us.base.atk * (1 + 0.35 + 0.0075 * 4), 'garrison_13_a boosts live atk');
  near(us.s.maxHp, us.base.maxHp * (1 + 0.1 + 0.003 * 4), 'garrison_13_a boosts live maxHp');

  const hLow = battle(
    [{ id: 'op', g: ['garrison_23_a'], row: 10, col: 4, bonds: ['ursusShip'] }],
    { ursusShip: B(0) },
  );
  const ul = hLow.unit('op');
  hLow.b.dealDamage(ul, hLow.spawn('e_dummy', { pos: [11, 8] }), { amount: 1e9, type: 'true' });
  assert.equal(hLow.b.tempLayers('p1', 'ursusShip'), 4, 'garrison_23_a raises kill temp gain from 2 to 4');
  hLow.step(1);
  near(ul.s.atk, ul.base.atk * (1 + 0.35 + 0.0075 * 4), 'garrison_23_a temp gain applies to live atk');

  const six = Array.from({ length: 6 }, (_, i) => ({
    id: `op_${i}`, g: i === 0 ? ['garrison_23_b'] : [], row: 10, col: 1 + i, bonds: ['ursusShip'],
  }));
  const hHigh = battle(six, { ursusShip: { count: 6, active: true, tier: 2, layers: 0 } });
  const uh = hHigh.unit('op_0');
  hHigh.b.dealDamage(uh, hHigh.spawn('e_dummy', { pos: [11, 8] }), { amount: 1e9, type: 'true' });
  assert.equal(hHigh.b.tempLayers('p1', 'ursusShip'), 8, '6-ursus + garrison_23_b grants 8 temp layers per kill');
  hHigh.step(1);
  near(uh.s.atk, uh.base.atk * (1 + 0.35 + 0.0075 * 8));
});

test('乌萨斯 kill temp layers flow into result.tempLayerGains and convert to permanent layers at next prep', (t) => {
  const s = setup(71);
  t.after(() => { assert.equal(s.m.errorCount, 0); s.m.dispose(); });
  give(s.m, s.ps, 'chess_char_1_01_a', 'board', [10, 4]);
  give(s.m, s.ps, 'chess_char_3_03_a', 'board', [10, 5]);
  s.activate('ursusShip');

  const h = battle(
    [{ id: 'killer', row: 10, col: 4, bonds: ['ursusShip'] }],
    { ursusShip: B(0) },
  );
  const u = h.unit('killer');
  h.b.dealDamage(u, h.spawn('e_dummy', { pos: [11, 8] }), { amount: 1e9, type: 'true' });
  h.b.dealDamage(u, h.spawn('e_dummy', { pos: [11, 9] }), { amount: 1e9, type: 'true' });
  const r = h.b.result().perPlayer.p1;
  assert.equal(r.tempLayerGains.ursusShip, 4);
  assert.equal(r.layerGains.ursusShip, undefined);

  s.ps.tempLayers = { ...r.tempLayerGains };
  s.fin({ ...r, unitsEnd: living(2).unitsEnd });
  assert.equal(s.L('ursusShip'), 0, 'own battle end must not convert yet');
  s.m.enterPrep();
  assert.equal(s.L('ursusShip'), 4, 'garrison_184_a (2) + garrison_21_a (2 on-board 乌萨斯) convert all 4 kill temp layers');
});

test('多功能补剂 temporary receipts use the same settlement converters as bond and garrison gains', t => {
  const s = setup(71);
  t.after(() => { assert.equal(s.m.errorCount, 0); s.m.dispose(); });
  give(s.m, s.ps, 'chess_char_1_01_a', 'board', [10, 4]);
  give(s.m, s.ps, 'chess_char_3_03_a', 'board', [10, 5]);
  s.activate('ursusShip');
  const h = battle([{ id: 'carrier', row: 10, col: 4, bonds: ['ursusShip'] }], { ursusShip: B(0) });
  const u = h.unit('carrier');
  installItem(h.b, u, 'chess_item_3_13_e_a');
  const foe = h.spawn('e_dummy', { pos: [11, 8] });
  for (let i = 0; i < 4; i++) h.b.dealDamage(u, foe, { amount: 1, type: 'true' });
  const r = h.b.result().perPlayer.p1;
  assert.equal(r.tempLayerGains.ursusShip, 4);
  assert.equal(h.b.getPlayer('p1').bonds.ursusShip.layers, 0);
  s.ps.tempLayers = { ...r.tempLayerGains };
  s.fin({ ...r, unitsEnd: living(2).unitsEnd });
  assert.equal(s.L('ursusShip'), 0, 'own battle end must not convert yet');
  s.m.enterPrep();
  assert.equal(s.L('ursusShip'), 4, 'both existing converters consume the shared equipment pool');
});

test('own combat end and SETTLE retain temporary layers in public/private views; next prep converts once', t => {
  const s = setup(71);
  t.after(() => s.m.dispose());
  give(s.m, s.ps, 'chess_char_1_01_a', 'board', [10, 4]);
  give(s.m, s.ps, 'chess_char_3_03_a', 'board', [10, 5]);
  s.activate('ursusShip');
  const pid = s.ps.playerId;
  const result = { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0,
    tempLayerGains: { ursusShip: 10.8, unknownBond: 3, yanShip: Infinity }, unitsEnd: [] };
  s.m.phase = 'COMBAT';
  s.m.fields = [{ fieldId: `n:${pid}`, players: [pid], kind: 'normal', live: true }];
  s.m._finishCombat(() => ({ perPlayer: { [pid]: result }, errors: 0 }));
  assert.deepEqual(s.ps.tempLayers, { ursusShip: 10 });
  assert.equal(s.L('ursusShip'), 0);
  assert.equal(s.ps.privateView().bonds.find(b => b.bondId === 'ursusShip').tempLayers, 10);
  assert.equal(s.m.publicView().players.find(p => p.playerId === pid).bonds.find(b => b.bondId === 'ursusShip').tempLayers, 10);
  s.m.settle(null, null);
  assert.equal(s.L('ursusShip'), 0, 'SETTLE is not entering prep');
  assert.deepEqual(s.ps.tempLayers, { ursusShip: 10 });
  s.m.enterPrep();
  assert.equal(s.L('ursusShip'), 4);
  assert.equal(s.ps.tempLayers, undefined);
  assert.equal(s.ps.privateView().bonds.find(b => b.bondId === 'ursusShip').tempLayers, undefined);
  s.m.enterPrep();
  assert.equal(s.L('ursusShip'), 4, 're-entering prep cannot convert a stale pool again');
});

test('SETTLE clears a stale temporary balance when the reported pool is empty', t => {
  const s = setup(71);
  t.after(() => s.m.dispose());
  s.ps.tempLayers = { ursusShip: 4 };
  s.m.settle(null, null);
  assert.equal(s.ps.tempLayers, undefined);
});

test('attrByBond and block_eprecoverspeed_inrange refresh when temporary layers change', () => {
  const attr = battle(
    [{ id: 'op', g: ['garrison_24_a'], row: 10, col: 4, bonds: ['ursusShip'] }],
    { ursusShip: B(0) },
  );
  near(attr.unit('op').s.aspd, 100);
  attr.b.addTempLayers('p1', 'ursusShip', 4);
  attr.step(1);
  near(attr.unit('op').s.aspd, 102, 'garrison_24_a refreshes on temp layer gain');

  const ep = battle(
    [{ id: 'op', g: ['garrison_65_a'], row: 10, col: 4, bonds: ['egirShip'] }],
    { egirShip: B(0) },
  );
  const it = ep.b._garInstances.find((x) => x.gid === 'garrison_65_a');
  near(it._epRate, 0);
  ep.b.addTempLayers('p1', 'egirShip', 20);
  ep.step(1);
  near(it._epRate, 0.01);
});
