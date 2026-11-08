// 规程·序列Ⅰ (act3autochess@V3_1) garrison types and in-battle events.
// Prep uses the match's own data. Battle garrison records come from the process gameData() singleton, so this file
// loads the regulation tables and restores them afterwards. Behaviour is keyed by effect / blackboard key.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { getVersionData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { ursusTempExtra } from '../../server/sim/content/garrisons/regulation.js';
import { underframeActions } from '../../public/js/ui/facing.js';
import { buildBattleSpec, compactResult, resultDigest } from '../../server/sim/spec.js';
import { validateClientResult } from '../../server/match/fields.js';
import { isBattleResult } from '../../shared/protocol.js';

const QUIET = { warn() {}, error() {}, info() {} };
const RAW = getVersionData('act3autochess@V3_1', { log: QUIET });
const REG = createRegistry({ log: QUIET });
setGameData(RAW);
after(() => setGameData(null));

const handItems = (ps) => [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'item');

function setup(seed = 70) {
  // 规程 has no mode_single_normal. mode_single_funny is the solo table modeIdFor('solo', 'FUNNY') names,
  // and its level-1 shop is still 3 chess + 1 item. band_bldsk is not in this season; band_sarkazb is, and has no buffs.
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed, registry: REG, fake: true, data: RAW }).start();
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

test('SERVER_GAIN_RANDOM_EQUIP: one item from the board at prep start; the hand does not; the elite text is 两件 twice', () => {
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
  assert.equal(handItems(elite.ps).length, 4, '158_b and 159_b each say 两件');
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

test('SERVER_UPGRADE_SELF_EQUIP: a carried non-golden item becomes its upgrade in place', () => {
  const s = setup();
  const piece = give(s.m, s.ps, 'chess_char_4_15_a', 'board', [10, 4]);
  piece.items.push(s.ps.newPiece('item', 'chess_item_1_01_e_a'));
  piece.items.push(s.ps.newPiece('item', 'chess_item_1_01_e_b'));
  s.prepStart();
  assert.deepEqual(piece.items.map((it) => it.id), ['chess_item_1_01_e_b', 'chess_item_1_01_e_b']);
  const hand = setup(71);
  const held = give(hand.m, hand.ps, 'chess_char_4_15_a', 'hand');
  held.items.push(hand.ps.newPiece('item', 'chess_item_1_01_e_a'));
  hand.prepStart();
  assert.equal(held.items[0].id, 'chess_item_1_01_e_a', 'the hand is not on the board');
});

test('SERVER_ADD_BOND_UPGRADE_LAYER: 1, 2, 3, 4, then the remainder, then nothing', () => {
  const s = setup();
  s.activate('kjeragShip');
  const piece = s.acquire('chess_char_3_07_a');
  assert.equal(s.L('kjeragShip'), 1);
  for (const n of [3, 6, 10, 12, 12]) {
    s.m.dispatcher.triggerGarrisons(s.ps, piece, 'SERVER_GAIN');
    assert.equal(s.L('kjeragShip'), n);
  }
});

test('SERVER_GAIN_FREE_REFRESH_UPGRADE_COUNT: the first two grants are 1, the next fills the cap', () => {
  const s = setup();
  const piece = s.acquire('chess_char_3_13_a');
  assert.equal(s.ps.shop.freeRefreshes, 1);
  s.m.dispatcher.triggerGarrisons(s.ps, piece, 'SERVER_GAIN');
  assert.equal(s.ps.shop.freeRefreshes, 2);
  s.m.dispatcher.triggerGarrisons(s.ps, piece, 'SERVER_GAIN');
  assert.equal(s.ps.shop.freeRefreshes, 3);
  s.m.dispatcher.triggerGarrisons(s.ps, piece, 'SERVER_GAIN');
  assert.equal(s.ps.shop.freeRefreshes, 3);
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

test('SERVER_CONVERT_TEMP_BOND: converters share one pool, a replay consumes it, settle drops it', () => {
  const one = setup();
  const piece = give(one.m, one.ps, 'chess_char_1_01_a', 'board', [10, 4]);
  one.activate('ursusShip');
  one.ps.tempLayers = { ursusShip: 1 };
  one.m.dispatcher.triggerGarrisons(one.ps, piece, 'SERVER_BATTLE_FIN');
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
    tempLayerGains: { ursusShip: 10 }, unitsEnd: [],
  });
  both.m.settle(null, null);
  assert.equal(both.ps.tempLayers, undefined, 'settle deletes the bag after the dispatch');
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

test('switch summon: the rightmost matching bench chess, not the death tile; its own garrison installs', () => {
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
  const death = [h.unit('op').tileR, h.unit('op').tileC];
  h.b.kill(h.unit('op'));
  const summoned = h.b.allyUnits.find((u) => u.uid === 55);
  assert.ok(summoned && summoned.alive && summoned.deployed);
  assert.ok(summoned.tileR !== death[0] || summoned.tileC !== death[1]);
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

test('battlestart temporary layers are omitted when gains are disabled', () => {
  const h = battle(
    [{ id: 'op', g: ['garrison_13_a'], row: 10, col: 4, bonds: ['ursusShip'] }],
    { ursusShip: B(0) },
  );
  assert.equal(h.b._perPlayer.p1.tempLayerGains.ursusShip, 4);
  assert.equal(lg(h, 'ursusShip'), 0);
  const off = battle(
    [{ id: 'op', g: ['garrison_13_a'], row: 10, col: 4, bonds: ['ursusShip'] }],
    { ursusShip: B(0) },
    { flags: { layerGainsEnabled: false } },
  );
  assert.equal(off.b._perPlayer.p1.tempLayerGains, undefined);
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
    { id: 'op', g: ['garrison_142_a'], row: 10, col: 4, bonds: ['egirShip'] },
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

test('ex_bond_cnt adds extra on garrison and item gains only, from an on-field carrier', () => {
  const gain = (reason, source) => {
    const h = battle(
      [{ id: 'op', g: ['garrison_235_a'], row: 10, col: 4 }],
      { emptyShip: B(0) },
    );
    return h.b.addLayers('p1', 'emptyShip', 1, reason, { source: source === 'op' ? h.unit('op') : source });
  };
  assert.equal(gain('garrison', 'op'), 2);
  assert.equal(gain('item', 'op'), 2);
  assert.equal(gain('bond', 'op'), 1);
  assert.equal(gain('garrison', { ownerId: 'nope' }), 1);
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

test('sleepstun: bond_self pays the carrier; bond_allinrange pays the operator behind', () => {
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
  const unite = buildBattleSpec({ ...spec, kind: 'unite', flags: { layerGainsEnabled: false } });
  assert.equal(validateClientResult(unite, withTemp, { gd }).reason, 'layers disabled');

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
