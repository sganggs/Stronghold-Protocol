import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, GEO } from '../../shared/constants.js';
import { botPrepEnd } from '../../server/match/bot.js';
import { registerDslMeta } from '../../server/match/dslMeta.js';
import { DATA, makeMatch, give, checkInvariants } from './harness.js';

const FILLER = 'chess_item_2_03_e_b';
const NORMAL = 'chess_char_1_06_a';

function prep(t) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 1426 }).start().toPrep(1);
  t.after(() => h.m.dispose());
  h.setStage('act2autochess_m04');
  const ps = h.ps('p_0');
  for (const p of ps.allChess()) ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.bandId = null; ps.recompute();
  ps.funds = 100;
  return { h, m: h.m, ps };
}

const fill = (ps, n) => Array.from({ length: n }, () => {
  const p = ps.acquireItem(FILLER, { silent: true });
  assert.ok(p);
  return p;
});

test('forty granted operators survive; selling refills the five visible slots in order and purchases stay blocked', (t) => {
  const { m, ps } = prep(t);
  const ids = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && !c.isDiy && m.pool.has(c.chessId)).slice(0, 40).map((c) => c.chessId);
  assert.equal(ids.length, 40);
  const gained = ids.map((id) => ps.acquireChess(id, { silent: true }));
  assert.ok(gained.every(Boolean));
  assert.equal(ps.hand.filter(Boolean).length, 10);
  assert.equal(ps.temp.length, 30);
  assert.deepEqual(ps.temp.slice(0, 5).reverse(), gained.slice(10, 15));
  assert.deepEqual(ps.temp.slice(5), gained.slice(15));
  assert.equal(ps.privateView().temp.filter(Boolean).length, 30, 'private state includes the entire queue');
  ps.shop.slots[0] = { kind: 'chess', id: ids[0], basePrice: 1, sold: false };
  const buy = () => m.handle(ps.playerId, { t: 'g.buy', slot: 0 });
  const funds = ps.funds;
  assert.deepEqual(buy(), { error: ERR.HAND_FULL });
  assert.equal(ps.funds, funds);
  assert.deepEqual(ps.setReady(true), { error: ERR.TEMP_NOT_EMPTY });
  assert.deepEqual(ps.sell(gained[12].uid), { ok: true });
  const queued = gained.slice(10).filter((p) => p !== gained[12]);
  assert.deepEqual(ps.temp.slice(0, 5).reverse(), queued.slice(0, 5));
  while (queued.length) {
    const next = queued.shift();
    assert.deepEqual(ps.sell(ps.hand[9].uid), { ok: true });
    assert.equal(ps.hand[9], next);
    assert.equal(ps._tempDue.has(next.uid), false);
    assert.deepEqual(buy(), { error: ERR.HAND_FULL });
    checkInvariants(m);
  }
  assert.equal(ps.temp.length, GEO.TEMP_SIZE);
  assert.ok(ps.tempEmpty);
  assert.deepEqual(ps.sell(ps.hand[9].uid), { ok: true });
  assert.deepEqual(buy(), { ok: true });
  checkInvariants(m);
});

test('hidden operators and items merge normally without losing adjacent queued resources', (t) => {
  const { m, ps } = prep(t);
  const original = fill(ps, 24);
  const a = ps.acquireChess(NORMAL, { silent: true });
  const b = ps.acquireChess(NORMAL, { silent: true });
  assert.ok(ps.temp.indexOf(a) >= 5 && ps.temp.indexOf(b) >= 5);
  const elite = ps.acquireChess(NORMAL, { silent: true });
  assert.equal(elite.id, m.gd.goldenIdOf(NORMAL));
  assert.equal(ps.find(a.uid), null);
  assert.equal(ps.find(b.uid), null);
  const itemId = 'chess_item_1_02_e_a';
  const item = ps.acquireItem(itemId, { silent: true });
  assert.ok(ps.temp.indexOf(item) >= 5);
  const golden = ps.acquireItem(itemId, { silent: true });
  assert.equal(golden.id, m.gd.item(itemId).goldenId || m.gd.item(itemId).upgradeChessId);
  assert.equal(ps.find(item.uid), null);
  for (const p of original) assert.equal(ps.find(p.uid).piece, p);
  assert.equal(ps.temp.filter(Boolean).length, 16);
  checkInvariants(m);
});

test('queued prep deadlines survive compaction and late grants receive the next prep', (t) => {
  const { m, ps } = prep(t);
  fill(ps, 10);
  ps.ready = true;
  const late = fill(ps, 12);
  assert.ok(late.every((p) => ps.tempDue(p) === ps.prepsEnded + 1));
  ps.resolveTemp();
  assert.ok(late.every((p) => ps.find(p.uid)));
  ps.ready = false;
  const due = fill(ps, 8);
  ps.resolveTemp();
  assert.ok(due.every((p) => !ps.find(p.uid)), 'all due resources, including hidden ones, resolve');
  assert.ok(late.every((p) => ps.find(p.uid) && ps.tempDue(p) === ps.prepsEnded + 1));
  ps.prepsEnded++;
  assert.equal(ps.privateView().canReady, false);
  ps.resolveTemp();
  assert.equal(ps.temp.length, GEO.TEMP_SIZE);
  assert.ok(ps.tempEmpty);
  checkInvariants(m);
});

test('a large deferred equipment batch merges completely beyond the old twenty-merge limit', (t) => {
  const { m, ps } = prep(t);
  fill(ps, 15);
  const gained = Array.from({ length: 60 }, () => ps.acquireItem('chess_item_2_03_e_a', { silent: true, deferMerge: true }));
  assert.ok(gained.every(Boolean));
  assert.equal(ps.temp.length, 65);
  const before = ps.stats.itemMerges;
  ps.checkItemMerges();
  ps.recompute();
  assert.equal(ps.stats.itemMerges - before, 30);
  assert.equal(ps.temp.length, 35);
  assert.ok([...ps.hand, ...ps.temp].every((p) => p.id === FILLER));
  checkInvariants(m);
});

test('reconnect resends hidden overflow and subsequent actions preserve the queue', (t) => {
  const { h, m, ps } = prep(t);
  fill(ps, 30);
  const before = ps.privateView().temp;
  m.onDisconnect(ps.playerId);
  m.onReconnect(ps.playerId);
  assert.deepEqual(h.lastTo(ps.playerId, 'm.private').temp, before);
  assert.deepEqual(ps.destroy(ps.hand[0].uid), { ok: true });
  h.flushAll();
  const after = h.lastTo(ps.playerId, 'm.private');
  assert.equal(after.temp.filter(Boolean).length, 19);
  assert.equal(after.hand[0].uid, before[4].uid);
  checkInvariants(m);
});

test('elimination returns queued pool copies and resets the visible window', (t) => {
  const { m, ps } = prep(t);
  fill(ps, 20);
  const p = ps.acquireChess(NORMAL, { silent: true });
  const before = m.pool.left(NORMAL);
  const copies = p.poolCopies;
  ps.eliminate(m.round);
  assert.equal(m.pool.left(NORMAL), before + copies);
  assert.equal(ps.temp.length, GEO.TEMP_SIZE);
  assert.ok(ps.tempEmpty);
  assert.equal(ps._tempDue.size, 0);
  checkInvariants(m);
});

test('autoplay resolves an extended queue without skipping pieces as visible slots compact', (t) => {
  const { m, ps } = prep(t);
  const id = m.gd.goldenIdOf(NORMAL);
  for (let i = 0; i < 40; i++) assert.ok(ps.acquireChess(id, { silent: true }));
  ps.autoplay = true;
  botPrepEnd(m, ps);
  assert.ok(ps.tempEmpty);
  assert.equal(ps.temp.length, GEO.TEMP_SIZE);
  assert.ok(ps.ready);
  assert.equal(ps.allChess().length, 9, 'one regular slot is left free for the next round');
  checkInvariants(m);
});

test('Suzuran, two elite Flametails and 100 Investor layers retain all twelve prep-start gains on a full bench', (t) => {
  const { m, ps } = prep(t);
  const suzu = ps.newPiece('chess', 'chess_char_5_10_b');
  const flame = ps.newPiece('chess', 'chess_char_4_19_b');
  let tiles;
  for (let r = 9; r <= 13 && !tiles; r++) for (let c = 0; c < 8 && !tiles; c++) {
    for (const [dr, dc, dir] of [[0, 1, 'RIGHT'], [0, -1, 'LEFT'], [1, 0, 'DOWN'], [-1, 0, 'UP']]) {
      if (ps._legal(suzu, r, c) && ps._legal(flame, r + dr, c + dc) && ps._legal(flame, r + 2 * dr, c + 2 * dc)) {
        tiles = { r, c, dr, dc, dir }; break;
      }
    }
  }
  assert.ok(tiles, 'the real stage has legal adjacent positions');
  const { r, c, dr, dc, dir } = tiles;
  give(m, ps, suzu.id, 'board', [r, c]).dir = dir;
  give(m, ps, flame.id, 'board', [r + dr, c + dc]);
  give(m, ps, flame.id, 'board', [r + 2 * dr, c + 2 * dc]);
  for (const id of DATA.bonds.investShip.visibleMembers.slice(0, 3)) give(m, ps, id);
  ps.addLayers('investShip', 100);
  assert.equal(m.dispatcher.investRepeat(ps), 3);
  fill(ps, 15 - ps.hand.filter(Boolean).length);
  const gained = ps.round.gainedChess;
  // Pinus grants include hidden operators outside the shared stock, whose poolCopies is zero.
  const held = () => ps.allChess().reduce((n, p) => n + (m.gd.isGolden(p.id) ? m.gd.goldenCopies : 1), 0);
  const before = held();
  m.dispatch(ps, 'onPrepStart', { round: m.round });   // the 「进入休整期时」 traits (DESIGN §35.53)
  assert.equal(ps.round.gainedChess - gained, 12);
  assert.equal(held() - before, 12, 'all copies retained even when automatic merges reduce the piece count');
  assert.ok(ps.temp.length > 5);
  checkInvariants(m);
});

test('plugin DSL gainItem and a script meta handler queue past the visible bench (PRTS 卫戍协议/帮助 §手牌区)', (t) => {
  const { m, ps } = prep(t);
  fill(ps, 15);
  // Distinct from the filler already on the bench, and granted once each, so neither merges away.
  const dslItemId = 'chess_item_1_02_e_a';
  const scriptItemId = 'chess_item_2_03_e_a';
  const dslKey = 'effect:benchplug:gain';
  const scriptKey = 'effect:benchscript:gain';
  t.after(() => {
    m.registry.unregister(dslKey);
    m.registry.unregister(scriptKey);
  });
  registerDslMeta(m.registry, {
    dsl: 1,
    pluginId: 'benchplug',
    meta: {
      key: dslKey,
      on: [{ when: 'roundStart', do: [{ gainItem: { item: dslItemId } }] }],
    },
  }, { pluginId: 'benchplug' });
  assert.equal(m.dispatcher.runKey(ps, dslKey, 'onRoundStart', { kind: 'effect', key: dslKey }, { round: m.round }), true);
  const dslItem = ps.temp.at(-1);
  assert.equal(dslItem && dslItem.id, dslItemId);
  assert.ok(ps.temp.indexOf(dslItem) >= GEO.TEMP_SIZE, 'the DSL item waits behind the five visible slots');
  const chessBefore = ps.allChess().filter((p) => p.id === NORMAL).length;
  m.registry.register(scriptKey, {
    onRoundStart(ctx) {
      ctx.grantChess(NORMAL, { requirePool: false, source: 'plugin:benchscript', toast: false });
      ctx.grantItem(scriptItemId, { source: 'plugin:benchscript', requirePool: false });
    },
  });
  assert.equal(m.dispatcher.runKey(ps, scriptKey, 'onRoundStart', { kind: 'effect', key: scriptKey }, { round: m.round }), true);
  assert.ok(ps.allChess().filter((p) => p.id === NORMAL).length >= chessBefore + 1);
  const scriptItem = [...ps.hand, ...ps.temp].find((p) => p && p.id === scriptItemId);
  assert.ok(scriptItem);
  assert.ok(ps.temp.indexOf(scriptItem) >= GEO.TEMP_SIZE);
  assert.ok(ps.temp.length > GEO.TEMP_SIZE);
  assert.ok(ps.temp.every(Boolean), 'a queue longer than the visible row has no hole');
  checkInvariants(m);
});
