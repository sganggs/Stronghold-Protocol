// test/match/feedback5-we2-placement.test.js — 0.2.0 WE2: where the 自选 summon pieces may be placed in prep.
// #22 望's 棋子 go on any tile class (PRTS 棋子 部署位置 "全部位", 备注 "游戏内召唤物信息与实际不符（显示为仅部署在近战位）").
// #26 Mon3tr's 重构体 only inside her attack range on the ground (her talent "可以在攻击范围内的地面使用一个…重构体");
// 凯尔希·思衡托's 战术锚点 only on a ranged tile outside her attack range (PRTS 战术锚点 特性 "仅可以部署在凯尔希·思衡托攻击范围外的
// 远程位") — server (PlayerState._legal / summonRange / summonExcluded, board.js 'high'), the client mirror (gameLogic
// canPlace) and the re-orientation lift.
// Run: node --test test/match/feedback5-we2-placement.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR } from '../../shared/constants.js';
import { FIELD, canPlace, placeClass, tileKey, parseKey } from '../../server/match/board.js';
import { placementContext, canPlace as clientCanPlace, diyGetter } from '../../public/js/ui/gameLogic.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';

const T5A = 'chess_char_5_diy1_a';
const WANG = 'char_2027_wang';
const STONE = 'token_10064_wang_stone1';
const MONSTR = 'char_4179_monstr';
const PROSTS = 'token_10050_monstr_prosts';
const KALTS2 = 'char_1052_kalts2';
const ANCHOR = 'token_10068_kalts2_mtship';

/** A solo match whose human slots `picks`, in its first prep on `stage` (战场#01: 3 高台 tiles) with an empty board and hand. */
function prep(picks, seed = 2101, stage = 'act2autochess_m01') {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: picks }];
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats, seed }).start();
  h.toPrep(1);
  h.setStage(stage);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  ps.funds = 100;
  return { h, m: h.m, ps };
}

/** Free tiles of the player's deploy map of class `cls` ('melee' | 'ranged'), reading order. */
function tilesOf(ps, cls) {
  const map = ps.deployMap();
  const out = [];
  for (let r = FIELD.r1; r >= FIELD.r0; r--) for (let c = FIELD.c0; c <= FIELD.c1; c++) {
    if (!ps.board.has(tileKey(r, c)) && map.get(tileKey(r, c)) === cls) out.push([r, c]);
  }
  return out;
}

/** Gain slot `slotId` (its 自选 operator) and place it on the first free tile of its class; returns the piece. */
function placeDiy(m, ps, slotId, at = null) {
  const piece = ps.acquireChess(slotId, { source: 'buy' });
  assert.ok(piece, `${slotId} gained`);
  const map = ps.deployMap();
  const pos = placeClass(ps, ps.gd.chess(slotId));
  let tile = at;
  for (let r = FIELD.r1; r >= FIELD.r0 && !tile; r--) for (let c = FIELD.c0; c <= FIELD.c1 && !tile; c++) {
    if (!ps.board.has(tileKey(r, c)) && canPlace(map, pos, r, c)) tile = [r, c];
  }
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true }, `${slotId} placed`);
  return piece;
}

test('#22 望\'s 棋子: a hand piece goes on a 高台 (ranged tile) as well as on the ground — PRTS 棋子 全部位', () => {
  const { m, ps } = prep({ [T5A]: { charId: WANG, skillIndex: 0 } });
  assert.equal(ps.gd.token(STONE).position, 'ALL');
  const wang = placeDiy(m, ps, T5A);
  const stack = ps.hand.find((p) => p && p.kind === 'token' && p.id === STONE && p.ownerUid === wang.uid);
  assert.ok(stack && stack.count === 7, 'her 7 棋子 joined the hand (6 + 1 at full potential)');
  const high = tilesOf(ps, 'ranged');
  const ground = tilesOf(ps, 'melee');
  assert.ok(high.length && ground.length, 'the stage has both tile classes');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: high[0][0], col: high[0][1] } }), { ok: true }, 'onto a 高台');
  const left = ps.hand.find((p) => p && p.kind === 'token' && p.id === STONE);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: left.uid, to: { area: 'board', row: ground[0][0], col: ground[0][1] } }), { ok: true }, 'onto the ground');
  // still refused off the deploy map (a forbidden tile of the field)
  const map = ps.deployMap();
  let off = null;
  for (let r = FIELD.r1; r >= FIELD.r0 && !off; r--) for (let c = FIELD.c0; c <= FIELD.c1 && !off; c++) if (!map.get(tileKey(r, c)) && !ps.board.has(tileKey(r, c))) off = [r, c];
  if (off) {
    const again = ps.hand.find((p) => p && p.kind === 'token' && p.id === STONE);
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: again.uid, to: { area: 'board', row: off[0], col: off[1] } }), { error: ERR.BAD_TILE }, 'not a deployable tile');
  }
  checkInvariants(m);
  m.dispose();
});

/** The owner's attack-range keys on the board (the server's own reading). */
const rangeOf = (ps, owner) => ps._ownerRangeOf({ kind: 'token', ownerUid: owner.uid, id: '' });
/** The summon stack of `owner` in the hand. */
const stackOf = (ps, owner, tokenId) => ps.hand.find((p) => p && p.kind === 'token' && p.id === tokenId && p.ownerUid === owner.uid);
/** The client's legality of dropping `uid` on (r, c), from the player's private view. */
function clientOk(m, ps, uid, r, c) {
  const priv = ps.privateView();
  const getChess = diyGetter((id) => DATA.chess[id] ?? null, priv, DATA);
  const ctx = placementContext({
    priv, stage: m.stage, editable: true, getChess, backups: DATA.backups,
    getToken: (id) => DATA.tokens[id] ?? DATA.backups.tokens[id] ?? null, getItem: (id) => DATA.items[id] ?? null,
  });
  return clientCanPlace(ctx, uid, { area: 'board', row: r, col: c }).ok;
}
/** Every free tile of the field: [r, c, serverLegal]. */
function freeTiles(ps, piece) {
  const out = [];
  for (let r = FIELD.r1; r >= FIELD.r0; r--) for (let c = FIELD.c0; c <= FIELD.c1; c++) if (!ps.board.has(tileKey(r, c))) out.push([r, c, ps._legal(piece, r, c)]);
  return out;
}

test('#26 Mon3tr\'s 重构体: only on a ground tile of her attack range — data ownerRange from her talent; server and client agree', () => {
  assert.equal(DATA.backups.tokens[PROSTS].ownerRange, true);
  const { m, ps } = prep({ [T5A]: { charId: MONSTR, skillIndex: 0 } });
  const mon = placeDiy(m, ps, T5A, [10, 5]);
  const stack = stackOf(ps, mon, PROSTS);
  assert.ok(stack, 'her 重构体 joined the hand');
  const range = rangeOf(ps, mon);
  const map = ps.deployMap();
  const tiles = freeTiles(ps, stack);
  let inside = 0, outside = 0;
  for (const [r, c, legal] of tiles) {
    const k = tileKey(r, c);
    assert.equal(legal, range.has(k) && map.get(k) === 'melee', `server ${k}`);
    assert.equal(clientOk(m, ps, stack.uid, r, c), legal, `client ${k}`);
    if (legal) inside++; else if (map.get(k) === 'melee') outside++;
  }
  assert.ok(inside > 0 && outside > 0, `${inside} legal ground tiles in her range, ${outside} outside`);
  const [r0, c0] = tiles.find((t) => t[2]);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: r0, col: c0 } }), { ok: true });
  const off = tiles.find(([r, c]) => map.get(tileKey(r, c)) === 'melee' && !range.has(tileKey(r, c)));
  const again = ps.board.get(tileKey(r0, c0));
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: again.uid, to: { area: 'board', row: off[0], col: off[1] } }), { error: ERR.BAD_TILE }, 'outside her range');
  checkInvariants(m);
  m.dispose();
});

test('#26 moving 凯尔希·思衡托 preserves an outside-bound anchor unless her final attack range covers it', () => {
  const { m, ps } = prep({ [T5A]: { charId: KALTS2, skillIndex: 2 } }, 2102, 'act1autochess_m03');
  try {
    const kal = placeDiy(m, ps, T5A, [12, 5]);
    const anchor = stackOf(ps, kal, ANCHOR);
    const map = ps.deployMap();
    // Real map, high tile outside the original range, and two legal owner destinations: one retains it, one covers it.
    const at = [...map].find(([key, cls]) => cls === 'ranged' && !ps.summonExcluded(anchor).has(key));
    assert.ok(at);
    const [ar, ac] = parseKey(at[0]);
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: anchor.uid, to: { area: 'board', row: ar, col: ac }, dir: 'LEFT' }), { ok: true });
    const candidates = [...map].filter(([key, cls]) => cls === 'melee' && key !== '12,5').map(([key]) => ({ key,
      covered: ps.summonExcluded(anchor, { key, piece: kal, dir: 'RIGHT' }).has(at[0]) }));
    for (const covered of [false, true]) {
      const dest = candidates.find(c => c.covered === covered);
      assert.ok(dest, `owner destination covered=${covered}`);
      const [row, col] = parseKey(dest.key);
      assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: kal.uid, to: { area: 'board', row, col } }), { ok: true });
      if (!covered) {
        assert.equal(ps.board.get(at[0]), anchor);
        assert.equal(anchor.dir, 'LEFT');
      } else {
        assert.equal(ps.board.get(at[0]), undefined);
        assert.equal(stackOf(ps, kal, ANCHOR), anchor);
        assert.equal(anchor.count, 1);
      }
      checkInvariants(m);
    }
  } finally { m.dispose(); }
});

test('#26 凯尔希·思衡托\'s 战术锚点 (S3): only on a ranged tile outside her attack range; re-oriented so that her range covers it, it goes back to the hand', () => {
  const rec = DATA.backups.tokens[ANCHOR];
  assert.deepEqual([rec.position, rec.ownerRangeOutside, rec.rangedTilesOnly, rec.ownerRange], ['RANGED', true, true, false]);
  // act1 m03: 高台 at (10, 3), (10, 4), (11, 7), (11, 8); she stands on the ground at (12, 5), facing RIGHT — her y-6 takes
  // (11, 7) in and leaves the other three out
  const { h, m, ps } = prep({ [T5A]: { charId: KALTS2, skillIndex: 2 } }, 2102, 'act1autochess_m03');
  const map = ps.deployMap();
  const highs = [...map].filter(([, v]) => v === 'ranged').map(([k]) => parseKey(k));
  assert.ok(highs.length >= 2, 'the stage has 高台 tiles');
  const kal = placeDiy(m, ps, T5A, [12, 5]);
  const stack = stackOf(ps, kal, ANCHOR);
  assert.ok(stack && (stack.count || 1) === 1, 'one 战术锚点 in the hand (S3)');
  const range = rangeOf(ps, kal);
  const tiles = freeTiles(ps, stack);
  let legalN = 0;
  for (const [r, c, legal] of tiles) {
    const k = tileKey(r, c);
    assert.equal(legal, map.get(k) === 'ranged' && !range.has(k), `server ${k}`);
    assert.equal(clientOk(m, ps, stack.uid, r, c), legal, `client ${k}`);
    if (legal) legalN++;
  }
  const insideHigh = highs.find(([r, c]) => range.has(tileKey(r, c)) && !ps.board.has(tileKey(r, c)));
  const ground = tiles.find(([r, c]) => map.get(tileKey(r, c)) === 'melee' && !range.has(tileKey(r, c)));
  assert.ok(ground, 'a ground tile outside her range');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: ground[0], col: ground[1] } }), { error: ERR.BAD_TILE }, 'not on the ground');
  if (insideHigh) assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: insideHigh[0], col: insideHigh[1] } }), { error: ERR.BAD_TILE }, 'not inside her range');
  assert.ok(legalN > 0, 'a 高台 outside her range');
  // placed on a 高台 outside her range; then she turns so that her range takes that tile in: the anchor goes back
  for (const dir of ['RIGHT', 'UP', 'DOWN', 'LEFT']) {
    const atDir = { key: tileKey(12, 5), piece: kal, dir };
    const keys = ps._ownerRangeOf({ kind: 'token', ownerUid: kal.uid, id: '' }, atDir);
    const spot = tiles.find(([r, c, legal]) => legal && keys.has(tileKey(r, c)));
    if (!spot) continue;
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: spot[0], col: spot[1] } }), { ok: true }, 'onto a free 高台 outside her range');
    const placed = ps.board.get(tileKey(spot[0], spot[1]));
    assert.equal(placed.id, ANCHOR);
    const toasts = h.sent.length;
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: kal.uid, to: { area: 'board', row: 12, col: 5 }, dir }), { ok: true }, `re-oriented ${dir}`);
    assert.ok(!ps.board.has(tileKey(spot[0], spot[1])), 'the anchor left the board');
    assert.ok(stackOf(ps, kal, ANCHOR), 'back on its stack');
    const said = h.sent.slice(toasts).filter(([, msg]) => msg.t === 'm.toast').map(([, msg]) => msg.msgid || msg.text);
    assert.ok(said.some((x) => String(x).includes('只能部署在召唤者攻击范围外')), `the toast: ${said.join(' / ')}`);
    checkInvariants(m);
    m.dispose();
    return;
  }
  assert.fail('no facing of hers covers a legal 高台');
});
