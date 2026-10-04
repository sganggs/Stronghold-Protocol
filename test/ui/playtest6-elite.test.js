// User playtest #6 follow-up, client side of "合成精锐时，如果消耗了场上的干员，精锐会出现在场上那个位置" (PRTS 卫戍协议/帮助
// "若消耗已部署至作战区的干员，则发送至作战区对应位置"; server PlayerState._mergeChess / board.js mergeTile):
//   * gameLogic.mergeTarget mirrors the server: the tile of the deployed copy that deploys first (row desc, col asc)
//     when gaining one more copy completes a merge, null when it completes none or no copy is deployed (the hand)
//   * the shop card's 可晋升 tag says where the elite goes; ShopBar reports the armed card (armedSlotOf → onArm) so the
//     game screen lights that tile (screens/game.js MERGE_HL)
//   * the server and client agree on the target for real merges (the engine's elite lands on mergeTarget's tile)
//   * an elite card never merges (server completesChessMerge): mergeProgress reports 0 copies, so no pips / tag / tile

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { mergeTarget, mergeProgress } = await import('../../public/js/ui/gameLogic.js');
const { ChessCard, armedSlotOf, armKey, mergeHint } = await import('../../public/js/ui/shopBar.js');
const { ChessDetail, resolveDetail } = await import('../../public/js/ui/detailPanel.js');
const { data } = await import('../../public/js/data.js');
const { DATA, makeMatch, give } = await import('../match/harness.js');

await data.loadAll('chess', 'bonds', 'assets');

const getChess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const A = 'chess_char_1_01_a';
const KAZE = 'chess_char_2_11_a';
const golden = (id) => DATA.chess[id].goldenId;
const onBoard = (id, row, col, dir = 'RIGHT', uid = row * 100 + col) => ({ uid, kind: 'chess', id, golden: false, row, col, dir });
const inHand = (id, uid) => ({ uid, kind: 'chess', id, golden: false });

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

describe('gameLogic.mergeTarget (mirror of server board.js mergeTile)', () => {
  test('no merge yet / hand copies only → null; a deployed copy → its tile and facing', () => {
    assert.equal(mergeTarget({ board: [], hand: [inHand(A, 1)] }, A, getChess), null, 'one copy: no merge');
    assert.equal(mergeTarget({ board: [], hand: [inHand(A, 1), inHand(A, 2)] }, A, getChess), null, 'hand copies: the elite goes to the hand');
    assert.deepEqual(mergeTarget({ board: [onBoard(A, 10, 4, 'UP')], hand: [inHand(A, 2)] }, A, getChess), { row: 10, col: 4, dir: 'UP' });
    assert.deepEqual(mergeTarget({ board: [onBoard(A, 10, 4)], temp: [inHand(A, 2)] }, A, getChess), { row: 10, col: 4, dir: 'RIGHT' }, 'temp copies count');
  });
  test('two deployed copies → the one that deploys first: col asc, then row desc (by column from the left, Battle.start)', () => {
    const priv = { board: [onBoard(A, 9, 2, 'DOWN'), onBoard(A, 11, 7, 'LEFT')], hand: [] };
    assert.deepEqual(mergeTarget(priv, A, getChess), { row: 9, col: 2, dir: 'DOWN' }, 'the left column, though lower (row-major until 0.1.3)');
    const same = { board: [onBoard(A, 10, 8, 'UP'), onBoard(A, 10, 3, 'DOWN')], hand: [] };
    assert.deepEqual(mergeTarget(same, A, getChess), { row: 10, col: 3, dir: 'DOWN' });
    const column = { board: [onBoard(A, 9, 4, 'UP'), onBoard(A, 12, 4, 'LEFT')], hand: [] };
    assert.deepEqual(mergeTarget(column, A, getChess), { row: 12, col: 4, dir: 'LEFT' }, 'one column: the top first');
  });
  test('elites and other operators are ignored; 风丸 merges with one deployed copy', () => {
    const priv = { board: [{ ...onBoard(golden(A), 12, 2), golden: true }, onBoard('chess_char_1_02_a', 12, 3), onBoard(A, 9, 9)], hand: [inHand(A, 5)] };
    assert.deepEqual(mergeTarget(priv, A, getChess), { row: 9, col: 9, dir: 'RIGHT' });
    assert.equal(mergeProgress({ board: [onBoard(KAZE, 10, 5)] }, KAZE, getChess).need, 2);
    assert.deepEqual(mergeTarget({ board: [onBoard(KAZE, 10, 5, 'UP')] }, KAZE, getChess), { row: 10, col: 5, dir: 'UP' });
    assert.equal(mergeTarget({ board: [onBoard(A, 10, 5)] }, A, getChess), null, 'two of three: no merge yet');
  });
  test('the engine agrees: a real merge puts the elite on mergeTarget\'s tile', () => {
    for (const seed of [61, 62, 63]) {
      const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed }).start();
      h.toPrep(1);
      h.setStage('act2autochess_m04');
      const m = h.m;
      const ps = h.ps('p_0');
      for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
      ps.board.clear();
      ps.hand.fill(null);
      ps.recompute();
      const id = Object.values(DATA.chess).find((c) => !c.isGolden && c.tier === 1 && c.position === 'MELEE' && m.pool.has(c.chessId) && m.gd.mergeCount(c.chessId) === 3 && !m.gd.placeableTokens(c.chessId).length).chessId;
      const tiles = [];
      const map = ps.deployMap();
      for (const [k, cls] of map) if (cls === 'melee') tiles.push(k.split(',').map(Number));
      // two copies on two seed-dependent melee tiles
      const pick = [tiles[seed % tiles.length], tiles[(seed * 7 + 3) % tiles.length]];
      if (pick[0].join() === pick[1].join()) pick[1] = tiles[(seed + 1) % tiles.length];
      give(m, ps, id, 'board', pick[0]).dir = 'UP';
      give(m, ps, id, 'board', pick[1]).dir = 'DOWN';
      const want = mergeTarget(ps.privateView(), id, getChess);
      ps.funds = 10;
      ps.shop.slots[0] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false };
      assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
      const view = ps.privateView().board.find((v) => v.golden);
      assert.deepEqual([view.row, view.col, view.dir], [want.row, want.col, want.dir], `seed ${seed}: server and client agree`);
      m.dispose();
    }
  });
});

describe('shop bar: the merge tag and the armed card', () => {
  test('the 可晋升 tag says where the elite goes (the board copy\'s place / the hand)', () => {
    const slot = { kind: 'chess', id: A, price: 1, basePrice: 1 };
    const tagOf = (priv) => [...walk(ChessCard({ slot, idx: 0, priv, onBuy() {}, onDetail() {} }))].find((v) => hasClass(v, 'scard__mergetag'));
    assert.equal(tagOf({ board: [onBoard(A, 10, 4)], hand: [inHand(A, 2)] })?.props.title, '精锐干员将出现在作战区原位置');
    assert.equal(tagOf({ board: [], hand: [inHand(A, 1), inHand(A, 2)] })?.props.title, '精锐干员将进入整备区');
    assert.equal(tagOf({ board: [], hand: [inHand(A, 1)] }), undefined, 'no tag before the merge');
  });
  test('touch shows no title: the detail card the first tap opens says where the elite goes (QA 6b)', async () => {
    await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'items');
    const board = { board: [onBoard(A, 10, 4)], hand: [inHand(A, 2)] };
    const hand = { board: [], hand: [inHand(A, 1), inHand(A, 2)] };
    assert.equal(mergeHint(board, A), '精锐干员将出现在作战区原位置');
    assert.equal(mergeHint(hand, A), '精锐干员将进入整备区');
    assert.equal(mergeHint({ board: [], hand: [inHand(A, 1)] }, A), null, 'no merge yet');
    assert.equal(mergeHint(board, golden(A)), null, 'an elite card never merges');
    // the first tap: ShopBar tapCard → onDetail(id, 'chess', mergeHint) → game.js setDetail({ …, hint }) → resolveDetail
    assert.match(read('public/js/ui/shopBar.js'), /setArmed\(key\); onDetail\(slot\.id, detailKind, detailKind === 'chess' \? mergeHint\(priv, slot\.id\) : null\)/);
    assert.match(read('public/js/screens/game.js'), /onDetail=\$\{\(id, kind, hint\) => setDetail\(\{ kind: kind === 'item' \? 'item' : 'chess', id, hint: hint \|\| null \}\)\}/);
    const r = resolveDetail({ kind: 'chess', id: A, hint: mergeHint(board, A) }, new Map());
    assert.equal(r.hint, '精锐干员将出现在作战区原位置');
    const blocks = ChessDetail({ chess: r.chess, piece: null, editable: false, bonds: [], loadout: null, hint: r.hint });
    assert.equal(blocks[0].key, 'head');
    assert.equal(blocks[1].key, 'merge', 'right under the header');
    assert.ok(hasClass(blocks[1], 'dhint'));
    const text = JSON.stringify(blocks[1].props.children);
    assert.ok(text.includes('可晋升：') && text.includes('精锐干员将出现在作战区原位置'), text);
    assert.ok(!ChessDetail({ chess: r.chess, piece: null, editable: false, bonds: [], loadout: null }).some((b) => b.key === 'merge'), 'no hint, no line');
  });
  test('an elite card never merges (server completesChessMerge refuses isGolden): no pips, no tag, no target tile', () => {
    const E = golden(A);
    const priv = { board: [onBoard(A, 10, 4, 'UP')], hand: [inHand(A, 2)] };
    assert.equal(mergeProgress(priv, A, getChess).copies, 2);
    assert.equal(mergeProgress(priv, E, getChess).copies, 0);
    assert.equal(mergeTarget(priv, E, getChess), null);
    const card = ChessCard({ slot: { kind: 'chess', id: E, price: 3, basePrice: 3 }, idx: 0, priv, onBuy() {}, onDetail() {} });
    const nodes = [...walk(card)];
    assert.equal(nodes.find((v) => hasClass(v, 'scard__mergetag')), undefined, 'no 可晋升 tag');
    assert.equal(nodes.find((v) => hasClass(v, 'scard__pips')), undefined, 'no 已拥有 pips');
    assert.ok(!hasClass(card, 'is-merge'));
    // the normal card in the same state still merges onto the deployed copy's tile
    assert.deepEqual(mergeTarget(priv, A, getChess), { row: 10, col: 4, dir: 'UP' });
    // and the server agrees: gaining the elite completes no merge
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 64 }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    const id = Object.values(DATA.chess).find((c) => !c.isGolden && c.tier === 1 && h.m.pool.has(c.chessId) && h.m.gd.mergeCount(c.chessId) === 3).chessId;
    give(h.m, ps, id);
    give(h.m, ps, id);
    assert.equal(ps.completesChessMerge(id), true);
    assert.equal(ps.completesChessMerge(golden(id)), false);
    h.m.dispose();
  });
  test('armedSlotOf: shop / reward slots by key; level card, stale and sold keys → null', () => {
    const slots = [{ kind: 'chess', id: A }, { kind: 'chess', id: KAZE, sold: true }, { kind: 'item', id: 'chess_item_1_01_e_a' }];
    const reward = [{ kind: 'chess', id: 'chess_char_1_02_a' }];
    assert.equal(armedSlotOf(armKey('c', 0, slots[0]), slots), slots[0]);
    assert.equal(armedSlotOf(armKey('i', 2, slots[2]), slots), slots[2]);
    assert.equal(armedSlotOf(armKey('r', 0, reward[0]), slots, reward), reward[0]);
    assert.equal(armedSlotOf(armKey('c', 1, slots[1]), slots), null, 'sold');
    assert.equal(armedSlotOf('c:0:other', slots), null, 'rerolled');
    assert.equal(armedSlotOf('lv', slots), null);
    assert.equal(armedSlotOf(null, slots), null);
  });
  test('the game screen lights the target tile while a merge-completing card is armed', () => {
    const src = read('public/js/screens/game.js');
    assert.match(src, /onArm=\$\{setArmedCard\}/, 'ShopBar reports the armed card');
    assert.match(src, /mergeTarget\(priv, armedCard\.id, gd\.chess\)/, 'the target comes from gameLogic.mergeTarget');
    assert.match(src, /view\.highlightTiles\(mergeAt \? \[\[mergeAt\.row, mergeAt\.col\]\] : \[\], MERGE_HL\)/, 'its own highlight group (cleared with [])');
    assert.match(src, /const MERGE_HL = Object\.freeze\(\{ group: 'mergeTile'/);
  });
});
