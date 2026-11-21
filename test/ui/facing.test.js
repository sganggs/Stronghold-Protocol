// Facing / direction step of the prep board (research 09 §1.2, §5, §6.1 5, §6.5; DESIGN §3 "Facing (corrected)"):
// the range rotation, the wheel's swipe → direction mapping with its dead-zone, which drops enter the direction step,
// the committed intents (g.move / g.art carry `dir`), the underframe actions (撤退 / 出售 +N / 销毁), the 撤退 target
// slot, the in-place re-orient drop of render/drag.js, and the g.move / g.art payloads of ui/gameActions.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DIRS, normDir, rotateOffset, rangeTiles, dirFromDelta, dirFromKey, pieceDir, previewGrid, artHasFacing, needsFacing,
  facingIntent, underframeActions, retreatSlot, DEAD_ZONE_TILES,
} from '../../public/js/ui/facing.js';
import { placementContext, canPlace, dropIntent } from '../../public/js/ui/gameLogic.js';
import { resolveDrop, createDragController, pieceSlot } from '../../public/js/render/drag.js';
import { GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const chess = load('chess.json');
const stages = load('stages.json');
const items = load('items.json');
const tokens = load('tokens.json');
const getChess = (id) => chess[id] || null;
const getItem = (id) => items[id] || null;
const getToken = (id) => tokens[id] || null;
const STAGE = stages.act2autochess_m01;
const MELEE = 'chess_char_1_02_a';
const RANGED = 'chess_char_1_01_a';
const EQUIP = 'chess_item_1_01_e_a';
const SCROLL = 'chess_item_6_02_m'; // 画卷: range [[0,0],[0,1]]
const CUSTOMER = 'chess_item_6_01_m'; // “神秘顾客”: range [[0,0]]

let uid = 100;
const piece = (id, extra = {}) => ({ uid: ++uid, kind: 'chess', id, golden: false, tier: chess[id]?.tier ?? 1, items: [], ...extra });
const item = (id) => ({ uid: ++uid, kind: 'item', id, golden: false, tier: 1 });
function privWith({ board = [], hand = [] } = {}) {
  const h = new Array(GEO.HAND_SIZE).fill(null);
  hand.forEach((p, i) => { if (p) h[p.idx ?? i] = p.piece ?? p; });
  return { alive: true, ready: false, funds: 10, board, hand: h, temp: new Array(GEO.TEMP_SIZE).fill(null), deployCap: 8,
    deployCount: board.filter((p) => p.kind === 'chess').length, shop: { level: 3, slots: [] } };
}
const ctxFor = (priv) => placementContext({ priv, stage: STAGE, editable: true, getChess, getItem, getToken });

describe('rotation (DESIGN §3: RIGHT (dr,dc) · UP (dc,−dr) · LEFT (−dr,−dc) · DOWN (−dc,dr); row 0 = bottom)', () => {
  test('rotateOffset per direction', () => {
    assert.deepEqual(rotateOffset(1, 2, 'RIGHT'), [1, 2]);
    assert.deepEqual(rotateOffset(1, 2, 'UP'), [2, -1]);
    assert.deepEqual(rotateOffset(1, 2, 'LEFT'), [-1, -2]);
    assert.deepEqual(rotateOffset(1, 2, 'DOWN'), [-2, 1]);
    assert.deepEqual(rotateOffset(0, 1, 'up'), [1, 0], 'the tile in front of an UP unit is the next row up');
    assert.deepEqual(rotateOffset(0, 1, 'DOWN'), [-1, 0]);
    assert.deepEqual(rotateOffset(0, 1, null), [0, 1], 'default RIGHT');
  });

  test('rangeTiles: a sniper grid (3 wide, 4 deep) turns with the facing; clipped to the stage; deduplicated', () => {
    const grid = chess[RANGED].rangeGrid;
    assert.ok(grid.length >= 6);
    const right = rangeTiles(grid, 10, 5, 'RIGHT');
    const up = rangeTiles(grid, 10, 5, 'UP');
    const left = rangeTiles(grid, 10, 5, 'LEFT');
    const down = rangeTiles(grid, 10, 5, 'DOWN');
    for (const t of [right, up, left, down]) assert.equal(t.length, new Set(grid.map(([a, b]) => `${a},${b}`)).size);
    assert.ok(right.every(([, c]) => c >= 5), 'RIGHT reaches columns to the right');
    assert.ok(left.every(([, c]) => c <= 5), 'LEFT mirrors it');
    assert.ok(up.every(([r]) => r >= 10), 'UP reaches the rows above (higher row index)');
    assert.ok(down.every(([r]) => r <= 10), 'DOWN reaches the rows below');
    const clipped = rangeTiles([[0, 0], [0, 1], [0, 30]], 10, 18, 'RIGHT');
    assert.deepEqual(clipped, [[10, 18], [10, 19]], 'off-stage tiles dropped');
    assert.deepEqual(rangeTiles([[0, 1], [0, 1]], 10, 5, 'RIGHT'), [[10, 6]]);
    assert.deepEqual(rangeTiles(null, 10, 5, 'RIGHT'), []);
    assert.deepEqual(rangeTiles([[0, 0], [0, 1]], 10, 5, 'UP', { extend: 1 }), [[10, 5], [11, 5], [12, 5]], 'rangeExtend grows along +dCol before rotating');
  });

  test('normDir / pieceDir: case-insensitive, legacy ±1, default RIGHT', () => {
    assert.deepEqual(DIRS, ['UP', 'RIGHT', 'DOWN', 'LEFT']);
    assert.equal(normDir('left'), 'LEFT');
    assert.equal(normDir(-1), 'LEFT');
    assert.equal(normDir('sideways'), 'RIGHT');
    assert.equal(pieceDir({ dir: 'UP' }), 'UP');
    assert.equal(pieceDir({}), 'RIGHT', 'server default when absent');
  });
});

describe('the wheel: swipe → direction with a ~0.5 tile dead-zone', () => {
  test('dominant axis decides; screen up = UP; inside the dead-zone nothing', () => {
    const s = 80; const dead = s * DEAD_ZONE_TILES;
    assert.equal(DEAD_ZONE_TILES, 0.5);
    assert.equal(dirFromDelta(10, 5, dead), null, 'inside the centre');
    assert.equal(dirFromDelta(60, 10, dead), 'RIGHT');
    assert.equal(dirFromDelta(-60, 10, dead), 'LEFT');
    assert.equal(dirFromDelta(5, -60, dead), 'UP');
    assert.equal(dirFromDelta(5, 60, dead), 'DOWN');
    assert.equal(dirFromDelta(50, -50, dead), 'RIGHT', 'ties go horizontal');
    assert.equal(dirFromDelta(NaN, 0, dead), null);
    assert.equal(dirFromKey('ArrowUp'), 'UP');
    assert.equal(dirFromKey('KeyW'), null);
  });
});

describe('which drops enter the direction step', () => {
  test('units on board tiles (move / swap / own tile) do; bench slots, equipment and single-tile Arts do not; 画卷 does', () => {
    const m = { ...piece(MELEE), row: 9, col: 3, dir: 'UP' };
    const r = piece(RANGED);
    const eq = item(EQUIP);
    const scroll = item(SCROLL);
    const customer = item(CUSTOMER);
    const ctx = ctxFor(privWith({ board: [m], hand: [r, eq, scroll, customer] }));
    const check = (u, t) => needsFacing(ctx, u, t, canPlace(ctx, u, t));
    const free = ctx.deploy.ranged.values().next().value.split(',').map(Number);
    assert.equal(check(r.uid, { area: 'board', row: free[0], col: free[1] }), true, 'hand → board');
    assert.equal(check(m.uid, { area: 'board', row: 9, col: 3 }), true, 'own tile: re-orient in place');
    assert.equal(canPlace(ctx, m.uid, { area: 'board', row: 9, col: 3 }).action, 'orient');
    assert.equal(check(m.uid, { area: 'hand', idx: 5 }), false, 'withdraw to the bench');
    assert.equal(check(eq.uid, { area: 'board', row: 9, col: 3 }), false, 'equip');
    assert.equal(check(scroll.uid, { area: 'board', row: 10, col: 5 }), true, '画卷 picks its front tile with the wheel');
    assert.equal(check(customer.uid, { area: 'board', row: 10, col: 5 }), false, 'a single-tile Art needs no direction');
    assert.equal(artHasFacing(getItem(SCROLL)), true);
    assert.equal(artHasFacing(getItem(CUSTOMER)), false);
    assert.equal(needsFacing(ctx, r.uid, { area: 'board', row: 0, col: 0 }, { ok: false }), false, 'illegal never');
  });

  test('facingIntent: g.move {uid, to, dir} for units, g.art {itemUid, row, col, dir} for Arts', () => {
    const r = piece(RANGED);
    // `to.dir` too: Match.handle forwards only msg.to to PlayerState.move, which reads to.dir when dir is absent
    assert.deepEqual(facingIntent(r, { row: 10, col: 4 }, 'up'), { t: 'g.move', fields: { uid: r.uid, to: { area: 'board', row: 10, col: 4, dir: 'UP' }, dir: 'UP' } });
    const s = item(SCROLL);
    assert.deepEqual(facingIntent(s, { row: 11, col: 6 }, 'LEFT'), { t: 'g.art', fields: { itemUid: s.uid, row: 11, col: 6, dir: 'LEFT' } });
  });

  test('previewGrid: the unit / summon / Art range grid (null without one)', () => {
    assert.deepEqual(previewGrid({ getChess, getToken, getItem }, { kind: 'chess', id: RANGED }), chess[RANGED].rangeGrid);
    assert.deepEqual(previewGrid({ getChess, getToken, getItem }, { kind: 'item', id: SCROLL }), [[0, 0], [0, 1]]);
    assert.equal(previewGrid({ getChess, getToken, getItem }, { kind: 'item', id: EQUIP }), null);
    assert.equal(previewGrid(null, { kind: 'chess', id: RANGED }), null);
  });
});

describe('underframe (research 09 §5): 撤退 / 出售 +N / 销毁', () => {
  test('actions per piece kind and place', () => {
    const b = { ...piece(MELEE), row: 9, col: 3 };
    const h = piece(RANGED);
    const it = item(EQUIP);
    const tokId = Object.keys(tokens)[0];
    const bt = { uid: ++uid, kind: 'token', id: tokId, count: 1, ownerUid: b.uid, row: 10, col: 4 };
    const ht = { uid: ++uid, kind: 'token', id: tokId, count: 1, ownerUid: b.uid };
    const ctx = ctxFor(privWith({ board: [b, bt], hand: [h, it, ht] }));
    const sell = chess[MELEE].sellPrice;
    assert.deepEqual(underframeActions(ctx, b.uid), { retreat: true, sell, destroy: false }, 'board operator');
    assert.deepEqual(underframeActions(ctx, h.uid), { retreat: false, sell: chess[RANGED].sellPrice, destroy: false }, 'bench operator: 出售 only');
    assert.deepEqual(underframeActions(ctx, it.uid), { retreat: false, sell: null, destroy: true }, 'items: 销毁 only');
    assert.deepEqual(underframeActions(ctx, bt.uid), { retreat: true, sell: null, destroy: false }, 'board summon: 撤退 only');
    assert.equal(underframeActions(ctx, ht.uid), null, 'bench summon: nothing');
    assert.equal(underframeActions(ctx, 999999), null);
  });

  test('retreatSlot: the first free bench slot; a full bench → null (summons always go back onto their stack)', () => {
    const b = { ...piece(MELEE), row: 9, col: 3 };
    const tok = { uid: ++uid, kind: 'token', id: Object.keys(tokens)[0], count: 1, ownerUid: b.uid, row: 10, col: 4 };
    const hand = [];
    for (let i = 0; i < 3; i++) hand.push({ idx: i, piece: piece(RANGED) });
    assert.deepEqual(retreatSlot(ctxFor(privWith({ board: [b], hand })), b.uid), { area: 'hand', idx: 3 });
    const full = [];
    for (let i = 0; i < GEO.HAND_SIZE; i++) full.push({ idx: i, piece: piece(RANGED) });
    assert.equal(retreatSlot(ctxFor(privWith({ board: [b], hand: full })), b.uid), null);
    assert.deepEqual(retreatSlot(ctxFor(privWith({ board: [b, tok], hand: full })), tok.uid), { area: 'hand', idx: 0 });
    const own = full.slice(0, GEO.HAND_SIZE - 1).concat([{ idx: GEO.HAND_SIZE - 1, piece: { uid: ++uid, kind: 'token', id: tok.id, count: 2, ownerUid: b.uid } }]);
    assert.deepEqual(retreatSlot(ctxFor(privWith({ board: [b], hand: own })), b.uid), { area: 'hand', idx: GEO.HAND_SIZE - 1 }, 'its own summon stack frees a slot');
    assert.equal(retreatSlot(ctxFor(privWith({ hand: full })), full[0].piece.uid), null, 'not on the board');
  });
});

describe('render/drag.js: dropping a board piece on its own tile is a drop (re-orient)', () => {
  test('resolveDrop: own board tile → drop; own bench slot still cancels', () => {
    const b = { uid: 7, area: 'board', row: 10, col: 4 };
    const d = resolveDrop({ piece: b, from: pieceSlot(b), tile: { row: 10, col: 4 }, overCanvas: true, clientX: 0, clientY: 0 });
    assert.deepEqual(d, { kind: 'drop', target: { area: 'board', row: 10, col: 4 } });
    const refused = resolveDrop({ piece: b, from: pieceSlot(b), tile: { row: 10, col: 4 }, overCanvas: true, canPlace: () => false });
    assert.equal(refused.kind, 'cancel', 'canPlace still rules');
    const h = { uid: 8, area: 'hand', idx: 3 };
    assert.equal(resolveDrop({ piece: h, from: pieceSlot(h), tile: { row: GEO.HAND_ROW, col: 3 }, overCanvas: true }).reason, 'same');
  });

  test('controller: dragging a board unit away and back onto its tile emits pieceDrop on that tile, lit as legal', () => {
    const events = [];
    const pieces = [{ uid: 2, area: 'board', row: 10, col: 4, x: 450, y: 250 }];
    const c = createDragController({
      hitPiece: (x, y) => pieces.find((p) => Math.abs(p.x - x) < 40 && Math.abs(p.y - y) < 40) || null,
      pickTile: (x, y) => ({ row: 12 - Math.floor(y / 100), col: Math.floor(x / 100) }),
      emit: (n, p) => events.push([n, p]),
      setTimeout: () => 0, clearTimeout: () => {},
    });
    c.setEditable(true);
    const ev = (t, x, y) => c[t]({ pointerId: 1, pointerType: 'mouse', button: 0, x, y, clientX: x, clientY: y });
    ev('pointerDown', 450, 250);
    ev('pointerMove', 470, 250);
    ev('pointerMove', 560, 250);
    ev('pointerMove', 452, 252);
    const mv = events.filter((e) => e[0] === 'pieceDragMove').pop()[1];
    assert.equal(mv.legal, true, 'its own tile is a legal target while dragging');
    ev('pointerUp', 452, 252);
    const drop = events.find((e) => e[0] === 'pieceDrop');
    assert.ok(drop, 'pieceDrop emitted');
    assert.deepEqual(drop[1].target, { area: 'board', row: 10, col: 4 });
  });
});

describe('gameActions: g.move / g.art carry the chosen dir', () => {
  test('payloads', async () => {
    const { net } = await import('../../public/js/net.js');
    const { actions } = await import('../../public/js/ui/gameActions.js');
    const sent = [];
    const orig = net.request;
    net.request = async (t, f) => { sent.push([t, f]); return {}; };
    try {
      await actions.move(5, { area: 'board', row: 10, col: 4 }, 'UP');
      await actions.move(5, { area: 'hand', idx: 2 });
      await actions.art(9, 11, 6, 'LEFT');
      await actions.art(9, 11, 6);
    } finally { net.request = orig; }
    assert.deepEqual(sent, [
      ['g.move', { uid: 5, to: { area: 'board', row: 10, col: 4 }, dir: 'UP' }],
      ['g.move', { uid: 5, to: { area: 'hand', idx: 2 } }],
      ['g.art', { itemUid: 9, row: 11, col: 6, dir: 'LEFT' }],
      ['g.art', { itemUid: 9, row: 11, col: 6 }],
    ]);
  });

  test('dropIntent of a same-tile orient is a plain g.move (the wheel adds dir)', () => {
    const m = { ...piece(MELEE), row: 9, col: 3 };
    const ctx = ctxFor(privWith({ board: [m] }));
    assert.equal(dropIntent(ctx, m.uid, { area: 'board', row: 9, col: 3 }).t, 'g.move');
  });
});

// ---- review regressions ------------------------------------------------------------------------------------------

describe('the wheel\'s intent reaches the stored facing through the real Match.handle', () => {
  test('placement, in-place re-orient and the next round keep the chosen dir (no snap back to RIGHT)', async () => {
    const { makeMatch, give, chessOfTier, legalTileFor } = await import('../match/harness.js');
    const { PHASE } = await import('../../shared/constants.js');
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 14 }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_0');
    const id = chessOfTier(1, (c) => c.position === 'MELEE').find((x) => m.pool.has(x) && !chess[x].tokens?.length);
    const a = give(m, ps, id, 'hand');
    const [row, col] = legalTileFor(m, ps, id);
    const send = (dir, r = row, c = col) => {
      const it = facingIntent({ uid: a.uid, kind: 'chess', id }, { row: r, col: c }, dir);
      return m.handle('p_0', { t: it.t, ...it.fields });
    };
    const stored = () => ps.privateView().board.find((p) => p.uid === a.uid)?.dir;
    assert.deepEqual(send('UP'), { ok: true });
    assert.equal(stored(), 'UP', 'placed facing UP');
    assert.deepEqual(send('LEFT'), { ok: true });
    assert.equal(stored(), 'LEFT', 're-oriented in place (own tile)');
    assert.equal(ps.privateView().board.filter((p) => p.uid === a.uid).length, 1);
    assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 2), 'next prep');
    assert.equal(stored(), 'LEFT', 'kept across the round');
    m.dispose();
  });
});

describe('client range preview = sim range (every rangeGrid of chess / tokens / Arts, 4 dirs, rangeExtend 0..3)', () => {
  test('rangeTiles matches server/sim/targeting.js absoluteRangeKeys tile for tile', async () => {
    const { absoluteRangeKeys } = await import('../../server/sim/targeting.js');
    const grids = new Map();
    for (const src of [chess, tokens, items]) for (const rec of Object.values(src)) {
      if (Array.isArray(rec?.rangeGrid) && rec.rangeGrid.length) grids.set(JSON.stringify(rec.rangeGrid), rec.rangeGrid);
    }
    assert.ok(grids.size >= 10, `distinct range shapes (${grids.size})`);
    let n = 0;
    for (const g of grids.values()) for (const dir of DIRS) for (const ext of [0, 1, 2, 3]) for (const [r, c] of [[9, 0], [10, 5], [12, 9], [11, 2]]) {
      const a = rangeTiles(g, r, c, dir, { extend: ext }).map(([rr, cc]) => rr * GEO.COLS + cc).sort((x, y) => x - y);
      const b = absoluteRangeKeys(g, r, c, dir, ext).slice().sort((x, y) => x - y);
      assert.deepEqual(a, b, `${JSON.stringify(g)} ${dir} +${ext} @${r},${c}`);
      n++;
    }
    assert.ok(n > 500);
  });
});

describe('wheel stripes go under the units on the 3D board (review regression)', () => {
  test('stripeMount: between the 3D canvas and the Pixi canvas only when the 3D board is on; stripePolys offsets', async () => {
    const { stripeMount, stripePolys } = await import('../../public/js/ui/facingWheel.js');
    const host = { insertBefore() {} };
    const canvas = { parentElement: host, getBoundingClientRect: () => ({ left: 10, top: 20 }) };
    const cam = { project: (x, y) => ({ x: x * 10, y: 100 - y * 10, s: 10 }) };
    const view = (board3d) => ({ raw: { debug: { app: { view: canvas }, cam, board3d, tiles: { heightAt: () => 0 } } } });
    assert.deepEqual(stripeMount(view({ on: true })), { host, before: canvas }, '3D board: under the Pixi canvas');
    assert.equal(stripeMount(view(null)), null, '2D board (opaque Pixi canvas): overlay');
    assert.equal(stripeMount({ raw: { tileScreen: () => null } }), null, 'DOM fallback view: overlay');
    assert.equal(stripeMount(null), null);
    const polys = stripePolys(view({ on: true }), [[9, 2]], 10, 20);
    assert.equal(polys.length, 1);
    // tile (9,2): corners (±0.5) projected, + canvas offset (10,20), − host offset (10,20)
    assert.equal(polys[0].pts, '15.0,5.0 25.0,5.0 25.0,15.0 15.0,15.0');
    const clipped = view({ on: true });
    clipped.raw.tileScreen = () => null;
    assert.deepEqual(stripePolys(clipped, [[14, 2]]), [], 'authoritative clipping must not fall back to the untransformed debug camera');
  });
});

describe('wheel on the mirrored Final Assault half (research 09 §1.2: RIGHT ↔ LEFT for the right-hand player)', () => {
  test('boardDir maps screen directions to board directions and back; UP / DOWN unchanged', async () => {
    const { boardDir, viewMirrored } = await import('../../public/js/ui/facing.js');
    const { bossPrepField } = await import('../../public/js/render/prepfield.js');
    for (const d of DIRS) {
      assert.equal(boardDir(d, false), d);
      assert.equal(boardDir(boardDir(d, true), true), d, 'its own inverse');
      // the direction drawn for a board dir on the right half is the screen direction that picks it
      assert.equal(bossPrepField('R').dirToDisp(boardDir(d, true)), d);
    }
    assert.equal(boardDir('RIGHT', true), 'LEFT');
    assert.equal(boardDir('UP', true), 'UP');
    assert.equal(boardDir(null, true), null);
    assert.equal(boardDir('nope', true), null);
    assert.equal(viewMirrored({ raw: { prepField: () => ({ kind: 'bossPrep', side: 'R', mirror: true }) } }), true);
    assert.equal(viewMirrored({ raw: { prepField: () => ({ kind: 'board', side: 'L', mirror: false }) } }), false);
    assert.equal(viewMirrored({ raw: {} }), false, 'views without the hook (DOM fallback)');
    assert.equal(viewMirrored({ raw: { prepField: () => { throw new Error('x'); } } }), false);
    assert.equal(viewMirrored(null), false);
  });
});
