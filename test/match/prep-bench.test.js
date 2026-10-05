// 观战队友的整备区(游玩记录 #2 item 1「观战队友时看不到队友的未上场的干员」,建议见 GitHub #44
// 「看不见队友的待战栏位」):prep 侦察的 m.field(`Match.prepFieldMeta`)把被侦察玩家的手牌当作
// 单位放进手牌行(row 7,col = 手牌槽位,道具是 kind 'item')——客户端按自己整备区的同一渲染路径
// 画出这一行(app.js battleView / ItemView)。手牌变化(部署 / 购入 / 装备)跟棋盘变化一样触发
// 推送(`_prepScoutSig`);观战席副本与玩家完全一致(test/match/spectator.test.js)。客户端:
// test/ui/prep-bench.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEO, PHASE } from '../../shared/constants.js';
import { makeMatch, give, giveItem, legalTileFor, chessOfTier } from './harness.js';

const MELEE = (c) => c.position === 'MELEE' && c.profession === 'TANK';

test('#44 prep scout: held pieces are units on the hand row; deploying moves them onto the field', () => {
  const S = 's_spec';
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true, spectators: [S] }).start();
  h.toPrep(1);
  const m = h.m;
  assert.equal(m.phase, PHASE.PREP);
  const b = h.ps('p_1');
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: false }), { ok: true });
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) {
    if (p.kind === 'chess') b.returnCopies(p);
  }
  b.board.clear();
  b.hand.fill(null);
  b.temp.fill(null);
  b.recompute();
  const id = chessOfTier(1, MELEE).find((x) => m.pool.has(x));
  const piece = give(m, b, id); // into the hand
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.deepEqual(m.handle(S, { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });

  for (const pid of ['p_0', S]) {
    const first = h.lastTo(pid, 'm.field');
    assert.equal(first.prep, true);
    const u = first.units.find((x) => x.uid === piece.uid);
    assert.ok(u, `${pid}: the held operator is a unit of the scout`);
    assert.deepEqual([u.x, u.y], [0, GEO.HAND_ROW], `${pid}: standing on the first hand slot`);
    assert.equal(u.kind, 'op');
    assert.equal(u.items, undefined, 'no items equipped yet');
  }
  assert.deepEqual(h.lastTo('p_0', 'm.field').effects, h.ps('p_1').effectsView(), 'the scouted effects column rides the meta');

  // deploying it is a hand AND a board change: one new push with the piece on the field and off the hand row
  const [r, c] = legalTileFor(m, b, id);
  assert.deepEqual(m.handle('p_1', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: r, col: c }, dir: 'LEFT' }), { ok: true });
  const last = h.lastTo('p_0', 'm.field');
  const u = last.units.find((x) => x.uid === piece.uid);
  assert.deepEqual([u.x, u.y], [c, r], 'deployed onto the watched board');
  assert.equal(last.units.some((x) => x.uid === piece.uid && x.y === GEO.HAND_ROW), false, 'and gone from the hand row');
  m.dispose();
});

test('#44 prep scout: a held item is a kind-item unit on the hand row; equipped items ride their operator', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 46, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const b = h.ps('p_1');
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: false }), { ok: true });
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) {
    if (p.kind === 'chess') b.returnCopies(p);
  }
  b.board.clear();
  b.hand.fill(null);
  b.temp.fill(null);
  b.recompute();
  const id = chessOfTier(1, MELEE).find((x) => m.pool.has(x));
  const op = give(m, b, id);
  const item = giveItem(m, b, 'chess_item_1_01_e_a'); // 维式重锤, into the hand
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  const first = h.lastTo('p_0', 'm.field');
  const iu = first.units.find((x) => x.uid === item.uid);
  assert.ok(iu, 'the held item is a unit of the scout');
  assert.equal(iu.kind, 'item');
  assert.equal(iu.y, GEO.HAND_ROW);
  // equip the item onto the operator (still in the hand): the operator's unit carries the item id
  assert.deepEqual(m.handle('p_1', { t: 'g.equip', itemUid: item.uid, targetUid: op.uid }), { ok: true });
  const after = h.lastTo('p_0', 'm.field');
  assert.equal(after.units.some((x) => x.uid === item.uid), false, 'the equipped item left the hand row');
  const ou = after.units.find((x) => x.uid === op.uid);
  assert.deepEqual(ou.items, ['chess_item_1_01_e_a'], 'the operator scouts with its equipment');
  m.dispose();
});

test("PR #129 review: moving a hand piece to another slot is a scout change (x follows the slot), and the temp row rides along", () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 47, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const b = h.ps('p_1');
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: false }), { ok: true });
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) {
    if (p.kind === 'chess') b.returnCopies(p);
  }
  b.board.clear();
  b.hand.fill(null);
  b.temp.fill(null);
  b.recompute();
  const id = chessOfTier(1, MELEE).find((x) => m.pool.has(x));
  const a = give(m, b, id, 'hand', 0);
  const c = give(m, b, id, 'temp', 0); // 临时整备区: PRTS 帮助把它算进手牌区,一起侦察
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });

  const first = h.lastTo('p_0', 'm.field');
  const tu = first.units.find((x) => x.uid === c.uid);
  assert.deepEqual([tu.x, tu.y], [GEO.TEMP_C0, GEO.TEMP_ROW], 'the temp piece scouts on the temp row (first slot, col 4)');
  assert.equal(first.units.find((x) => x.uid === a.uid).x, 0);

  // a hand piece moved to another slot keeps uid and id — the slot must be in the signature for the push to fire
  assert.deepEqual(m.handle('p_1', { t: 'g.move', uid: a.uid, to: { area: 'hand', idx: 3 } }), { ok: true });
  const last = h.lastTo('p_0', 'm.field');
  assert.ok(last, 'a new scout push arrived');
  assert.equal(last.units.find((x) => x.uid === a.uid).x, 3, 'the piece stands on its new hand slot');
  m.dispose();
});

test('#44 prep scout: an empty hand adds no units and never an m.private to a spectator seat', () => {
  const S = 's_spec';
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 45, fake: true, spectators: [S] }).start();
  h.toPrep(1);
  const m = h.m;
  const b = h.ps('p_1');
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: false }), { ok: true });
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) {
    if (p.kind === 'chess') b.returnCopies(p);
  }
  b.board.clear();
  b.hand.fill(null);
  b.temp.fill(null);
  b.recompute();
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.deepEqual(m.handle(S, { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  const first = h.lastTo('p_0', 'm.field');
  assert.equal(first.units.length, 0, 'nothing held, nothing deployed: no units');
  assert.equal(first.bench, undefined, 'no separate bench field (the hand rides units)');
  assert.equal(h.allTo(S, 'm.private').length, 0, 'still no private state to a scout');
  m.dispose();
});
