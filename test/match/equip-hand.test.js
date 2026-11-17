import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { attachAudit } from '../../server/match/audit.js';
import { aiDigest } from '../../server/match/aiDigest.js';
import { compactDigest } from '../../tools/ai/llm-context.mjs';
import { botPrepBegin, botPrepEnd, resolveTemp, buyLoopSteps } from '../../server/match/bot.js';
import { bossFieldPlacement } from '../../server/match/finalAssault.js';
import { GEO, ERR, PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { placementContext, canPlace, dropIntent, dropFailureReason, shopBlockReason } from '../../public/js/ui/gameLogic.js';
import { resolveDrop } from '../../public/js/render/drag.js';
import { tempInfo, tempReadyReason } from '../../public/js/ui/hud.js';
import { DATA, makeMatch, checkInvariants, legalTileFor } from './harness.js';

const regulation = getVersionData('act3autochess@V3_1');
after(() => setGameData(null));
function setup(t, data = regulation, options = {}) {
  setGameData(data);
  const h = makeMatch({ data, mode: 'coop', humans: 2, fake: true, seed: 137, registry: createRegistry(), ...options }).start();
  t.after(() => { assert.equal(h.m.errorCount, 0); h.m.dispose(); });
  h.toPrep(1);
  const ps = h.ps('p_0'), m = h.m;
  for (const p of ps.allChess()) ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp = new Array(GEO.TEMP_SIZE).fill(null); ps._tempDue.clear();
  ps.bandId = null; ps.effects = []; ps.command = null; ps.commandDrafts = []; ps.offers = []; ps.funds = 100;
  ps.recompute();
  const items = Object.values(data.items).filter(i => i.itemType === 'EQUIP' && i.kind === 'passive' && !i.isGolden).map(i => i.itemId || i.id);
  const chars = Object.values(data.chess).filter(c => !c.isGolden && !c.isDiy && !m.chessExcluded(c) && !m.gd.placeableTokens(c.chessId).length).map(c => c.chessId);
  const item = (n = 0, opts = {}) => ps.acquireItem(items[n], { silent: true, ...opts });
  const chess = (n = 0) => ps.acquireChess(chars[n], { silent: true });
  const fill = kind => { for (let i = 0; ps.handSlot(kind) >= 0; i++) { assert.ok(i < 30, 'fill makes progress'); assert.ok((kind === 'item' ? item : chess)(i)); } };
  return { h, ps, m, items, chars, item, chess, fill };
}

test('regulation keeps five permanent equipment slots separate from ten character slots', t => {
  const { ps, item, chess } = setup(t);
  const it = item(), op = chess();
  assert.equal(ps.temp[4], it); assert.equal(ps.hand[9], op);
  assert.equal(ps._tempDue.has(it.uid), false); assert.equal(ps.tempDue(it), Infinity);
  assert.equal(ps.tempEmpty, true); assert.equal(ps.privateView().canReady, true);
  assert.deepEqual(ps.setReady(true), { ok: true });
  ps.setReady(false); assert.equal(ps._tempDue.has(it.uid), false);
  ps.endPrep(); assert.equal(ps.temp[4], it);
});

test('normal buys and reward picks require a free slot in their own row, including merge-completing cards', t => {
  const { ps, items, chars, fill } = setup(t);
  fill('item');
  ps.shop.slots = [{ kind: 'item', id: items[0], basePrice: 1 }, { kind: 'chess', id: chars[0], basePrice: 1 }];
  assert.deepEqual(ps.buy(0), { error: ERR.HAND_FULL }); assert.ok(ps.buy(1).ok);
  ps.offers = [{ slots: [{ kind: 'item', id: items[0], price: 0 }] }];
  assert.deepEqual(ps.pickReward(0), { error: ERR.HAND_FULL });
  ps.destroy(ps.temp[4].uid); fill('chess');
  assert.ok(ps.pickReward(0).ok);
  ps.shop.slots = [{ kind: 'chess', id: chars[3], basePrice: 1 }, { kind: 'item', id: items[6], basePrice: 1 }];
  assert.deepEqual(ps.buy(0), { error: ERR.HAND_FULL });
  ps.destroy(ps.temp.find(Boolean).uid); assert.ok(ps.buy(1).ok);
  ps.offers = [{ slots: [{ kind: 'chess', id: chars[3], price: 0 }] }];
  assert.deepEqual(ps.pickReward(0), { error: ERR.HAND_FULL });
});

test('forced overflow is private, notifies its owner, and refills each kind in arrival order', t => {
  const { h, ps, item, chess, fill } = setup(t);
  fill('item'); fill('chess'); h.sent.length = 0;
  const c1 = chess(12), i1 = item(6), c2 = chess(13), i2 = item(7);
  assert.deepEqual(ps.tempPieces(), [c1, i1, c2, i2]);
  const v = ps.privateView(); assert.equal(v.stashCount, 4); assert.equal(v.temp.length, 5);
  assert.ok(!JSON.stringify(v).includes(`"uid":${i1.uid},`));
  const notices = h.sent.filter(([, msg]) => msg.t === 'm.toast');
  assert.equal(notices.length, 8); assert.ok(notices.every(([id]) => id === ps.playerId));
  assert.ok(notices.some(([, msg]) => msg.msgid === '装备区已满，{name}进入暂存'));
  assert.ok(notices.some(([, msg]) => msg.msgid === '手牌已满，{name}进入暂存'));
  assert.deepEqual(ps.setReady(true), { error: ERR.TEMP_NOT_EMPTY });
  const due = ps.tempDue(c1);
  ps.destroy(ps.temp[4].uid); assert.equal(ps.temp[4], i1); assert.deepEqual(ps.tempPieces(), [c1, c2, i2]);
  assert.equal(ps.tempDue(c1), due); assert.equal(ps._tempDue.has(i1.uid), false);
  ps.sell(ps.hand[9].uid); assert.equal(ps.hand[9], c1);
  ps.sell(ps.hand[8].uid); assert.equal(ps.hand[8], c2);
  ps.destroy(ps.temp[3].uid); assert.equal(ps.temp[3], i2);
  assert.equal(ps.tempEmpty, true); checkInvariants(h.m);
});

test('stash deadline returns item stock and pool copies, runs no onDestroy (as covenant temp) and keeps the equipment row', t => {
  const { ps, m, item, chess, fill, items, chars } = setup(t);
  const audit = attachAudit(m);
  fill('item'); fill('chess');
  const itemBefore = m.itemPool.left(items[6]), chessBefore = m.pool.left(chars[12]);
  const it = item(6), op = chess(12), permanent = ps.temp.slice(0, 5);
  const hooks = [], dispatch = m.dispatchItem.bind(m);
  m.dispatchItem = (...args) => { if (args[3] === 'onDestroy') hooks.push(args[1].uid); return dispatch(...args); };
  assert.equal(m.itemPool.left(it.id), itemBefore - 1); assert.equal(m.pool.left(op.id), chessBefore - 1);
  ps.endPrep();
  assert.equal(ps.find(it.uid), null); assert.equal(ps.find(op.uid), null);
  assert.equal(m.itemPool.left(it.id), itemBefore); assert.equal(m.pool.left(op.id), chessBefore);
  assert.deepEqual(hooks, []); assert.deepEqual(ps.temp, permanent);
  assert.deepEqual(audit.violations, []); checkInvariants(m);
});

test('overflow after Ready survives one deadline; cancelling Ready makes it due now', t => {
  const { ps, item, fill } = setup(t);
  fill('item'); assert.ok(ps.setReady(true).ok);
  const late = item(6); assert.equal(ps.tempDue(late), ps.prepsEnded + 1);
  ps.endPrep(); assert.ok(ps.find(late.uid));
  ps.ready = false; ps.endPrep(); assert.equal(ps.find(late.uid), null);
  ps.ready = true; const next = item(7); ps.setReady(false);
  assert.equal(ps.tempDue(next), ps.prepsEnded); ps.endPrep(); assert.equal(ps.find(next.uid), null);
});

test('unequip uses only equipment slots and moves respect the two row types', t => {
  const { ps, item, chess, fill } = setup(t, regulation, { rules: { unequip: 'allow' } });
  const op = chess(), it = item(20); assert.ok(ps.equip(it.uid, op.uid).ok);
  fill('chess'); assert.ok(ps.unequip(it.uid).ok); assert.equal(ps.find(it.uid).area, 'temp');
  assert.deepEqual(ps.move(it.uid, { area: 'hand', idx: 0 }), { error: ERR.BAD_TILE });
  assert.deepEqual(ps.move(op.uid, { area: 'temp', idx: 0 }), { error: ERR.BAD_TILE });
  assert.ok(ps.move(it.uid, { area: 'temp', idx: 0 }).ok); assert.equal(ps.temp[0], it);
  const other = item(1); const at = ps.find(other.uid).idx;
  assert.ok(ps.move(it.uid, { area: 'temp', idx: at }).ok); assert.equal(ps.temp[0], other);
  assert.ok(ps.equip(it.uid, op.uid).ok); fill('item');
  assert.deepEqual(ps.unequip(it.uid), { error: ERR.HAND_FULL }); assert.ok(op.items.includes(it));
  assert.equal(validateC2S({ t: 'g.move', uid: other.uid, to: { area: 'temp', idx: 4 } }), null);
  assert.ok(validateC2S({ t: 'g.move', uid: other.uid, to: { area: 'temp', idx: 5 } }));
});

test('merge returns equipment to its row and queues overflow while tokens use the character hand', t => {
  const { ps, item, chess, fill, chars } = setup(t);
  const op = chess(), it = item(20); assert.ok(ps.equip(it.uid, op.uid).ok);
  fill('item'); chess(); const elite = chess();
  assert.equal(elite.id, ps.gd.goldenIdOf(chars[0])); assert.ok(ps.tempPieces().includes(it));
  const tok = ps.newPiece('token', Object.keys(ps.gd.raw.tokens)[0], { ownerUid: elite.uid });
  ps.stow(tok); assert.equal(ps.find(tok.uid).area, 'hand');
  fill('chess'); const extra = ps.newPiece('token', tok.id, { ownerUid: elite.uid });
  ps.stow(extra); assert.ok(ps.tempPieces().includes(extra));
});

test('final assault and hidden-core benches map equipment to the boss equipment tiles on both halves', t => {
  const { ps, m, item, chess } = setup(t);
  const it = item(), op = chess();
  for (const round of [m.gd.bossRound, m.gd.hiddenRound]) {
    m.round = round;
    for (const side of ['L', 'R']) {
      const meta = m.prepFieldMeta(ps);
      const equip = meta.units.find(u => u.uid === it.uid || u.id === it.uid);
      const hand = meta.units.find(u => u.uid === op.uid || u.id === op.uid);
      assert.ok(equip && hand);
      const mapped = m._onBossHalf(equip, side), mappedHand = m._onBossHalf(hand, side);
      assert.equal(mapped.y, 1); assert.equal(mappedHand.y, 0);
      assert.deepEqual(bossFieldPlacement(side, GEO.TEMP_ROW, GEO.TEMP_C0 + 4), { row: 1, col: side === 'L' ? 8 : 12, dir: side === 'L' ? 'RIGHT' : 'LEFT' });
      const stage = m.gd.stage(m.stageId); assert.equal(stage.tiles[stage.rows[mapped.y][mapped.x]].tileKey, 'tile_acbag');
    }
  }
});

test('bot prep equips from the equipment row and its temp cleanup keeps unused regular equipment', t => {
  const { ps, m, item, chess } = setup(t);
  const op = chess(), it = item(20);
  const [row, col] = legalTileFor(m, ps, op.id); assert.ok(ps.move(op.uid, { area: 'board', row, col }).ok);
  ps.isBot = true; ps.funds = 0; ps.shop.slots = [];
  const job = botPrepBegin(m, ps); botPrepEnd(m, ps, job);
  assert.ok(ps.stats.itemsEquipped > 0); assert.equal(ps.find(it.uid).area, 'equipped'); assert.equal(ps.ready, true);
  ps.ready = false; const extra = item(1); resolveTemp(m, ps); assert.ok(ps.find(extra.uid));
});

test('bot purchases equipment with a full character hand and the test console grants into the proper row', t => {
  const { ps, m, item, chess, fill, items } = setup(t, regulation, { test: true });
  const op = chess();
  const [row, col] = legalTileFor(m, ps, op.id); assert.ok(ps.move(op.uid, { area: 'board', row, col }).ok);
  item(); fill('chess');
  ps.shop.slots = [{ kind: 'item', id: items[0], basePrice: 0 }];
  const buys = ps.stats.buys;
  for (const _ of buyLoopSteps(m, ps)) { /* drain the prep step generator */ }
  assert.ok(ps.stats.buys > buys);
  assert.ok(m.handle(ps.playerId, { t: 'g.test', cmd: 'item', args: { id: items[20] } }).ok);
  const granted = ps.itemCards().find(p => p.id === items[20]);
  assert.ok(granted); assert.equal(ps.find(granted.uid).area, 'temp');
  assert.ok(ps.find(granted.uid).idx < GEO.TEMP_SIZE);
});

test('client placement, drag, shop and Ready use the loaded equipHand rule', t => {
  const { ps, m, item, chess, fill } = setup(t);
  const it = item(), op = chess();
  const config = regulation.config;
  const context = () => placementContext({ priv: ps.privateView(), config, editable: true, stage: m.gd.stage(m.stageId), getItem: id => m.gd.item(id) });
  const ctx = context(), to = { area: 'temp', idx: 1 };
  assert.equal(canPlace(ctx, it.uid, to).ok, true);
  assert.deepEqual(dropIntent(ctx, it.uid, to), { t: 'g.move', fields: { uid: it.uid, to } });
  assert.equal(canPlace(ctx, it.uid, { area: 'hand', idx: 1 }).reason, '装备只能放入装备区');
  assert.equal(dropFailureReason(ctx, op.uid, { area: 'temp', idx: 0 }), '装备区只能放入装备');
  assert.equal(canPlace(ctx, it.uid, { area: 'hand', idx: 9 }).action, 'equip');
  const drop = resolveDrop({ piece: { ...it, area: 'temp', idx: 4 }, from: { area: 'temp', idx: 4 }, tile: { row: 8, col: 5 }, overCanvas: true,
    canPlace: (p, r, c, target) => canPlace(ctx, p.uid, target).ok });
  assert.deepEqual(drop, { kind: 'drop', target: to });
  assert.deepEqual(tempInfo(ps.privateView(), config), { count: 0, items: 0 }); assert.equal(tempReadyReason(ps.privateView(), config), null);
  fill('item'); item(7);
  const priv = ps.privateView(); assert.equal(tempInfo(priv, config).count, 1);
  assert.match(tempReadyReason(priv, config), /暂存 1 个单位/);
  assert.equal(shopBlockReason('buy', { priv, config, editable: true, slot: { kind: 'item', price: 0 } }), '装备区已满');
  assert.equal(shopBlockReason('buy', { priv, config, editable: true, slot: { kind: 'chess', price: 0 } }), null);
});

test('AI observations expose equipment and row-specific shortcuts without revealing the stash', t => {
  const { ps, m, item, fill, items, chars } = setup(t);
  const it = item(); fill('chess');
  ps.shop.slots = [{ kind: 'item', id: items[1], basePrice: 1 }, { kind: 'chess', id: chars[0], basePrice: 1 }];
  ps.offers = [{ slots: [{ kind: 'item', id: items[1], price: 0 }] }];
  const observe = () => aiDigest(m, ps, 'prep', m.publicView(), ps.privateView());
  const first = observe();
  assert.ok(first.equipment.some(p => p.uid === it.uid)); assert.deepEqual(first.overflow, []);
  assert.ok(first.actions.some(a => a.intent.t === 'g.buy' && a.intent.slot === 0));
  assert.ok(!first.actions.some(a => a.intent.t === 'g.buy' && a.intent.slot === 1));
  assert.ok(first.actions.some(a => a.intent.t === 'g.reward'));
  assert.ok(first.actions.some(a => a.intent.t === 'g.equip' && a.intent.itemUid === it.uid));
  fill('item'); const hidden = item(20), last = observe();
  assert.equal(last.stashCount, 1); assert.ok(!last.equipment.some(p => p.uid === hidden.uid));
  assert.ok(!last.actions.some(a => a.intent.t === 'g.buy' || a.intent.t === 'g.reward'));
  const compact = compactDigest(last, { operators: [], bonds: [] });
  assert.equal(compact.equipment.length, 5); assert.equal(compact.stashCount, 1);
});

test('covenant control retains the mixed hand, visible temp deadline and readiness rule', t => {
  const { ps, item, chess, fill } = setup(t, DATA);
  const it = item(20), op = chess(); assert.equal(ps.hand[9], it); assert.equal(ps.hand[8], op);
  fill('item'); const overflow = item(12); assert.equal(ps.temp[4], overflow);
  assert.equal(ps.privateView().stashCount, undefined); assert.equal(ps.tempEmpty, false);
  assert.deepEqual(ps.setReady(true), { error: ERR.TEMP_NOT_EMPTY });
  assert.deepEqual(ps.move(it.uid, { area: 'temp', idx: 0 }), { error: ERR.BAD_TARGET });
  ps.destroy(it.uid); assert.ok(ps.hand.includes(overflow));
  const due = item(13); assert.equal(ps.find(due.uid).area, 'temp');
  ps.endPrep(); assert.equal(ps.find(due.uid), null);
  assert.equal(ps.m.phase, PHASE.PREP);
});
