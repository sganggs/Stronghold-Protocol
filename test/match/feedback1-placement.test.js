// Player reports after the 0.1.0 release, placement legality on the server (PlayerState / board.js), the client's
// mirror (ui/gameLogic.js canPlace / boardTargets = the drag highlights) and the bots:
//   #3 "有水池的那张图干员可以错误的被部署到水里" — 战场#08(下半) 涨潮控制 (act2autochess_m04): the 深水区 (tile_deepsea,
//      board (10–12, 6)) refuses deployment (PRTS 深水区 地形信息 "地形机制：拒绝部署（待补充）"; 特制水上平台
//      "在水上建立可以部署任意单位的平台" on every 深水区 of the season-1 战场#05) although the level's buildableType
//      says ALL.
//   #9 "干员伺夜这样的战术家的战术点能被错误的被放到攻击范围之外" — the tacticians' summons (伺夜's 狼群, 缪尔赛思's 流形)
//      read "只能部署在召唤者攻击范围内" (token description; PRTS 狼群 特性): the piece may only stand on a tile of its
//      owner's attack range (the rotated grid of its board tile and facing). Re-orienting the owner in place keeps the
//      piece while it is still inside, else sends it back to its stack [ASSUMED] (refused, HAND_FULL, when it would have
//      nowhere to go); moving the owner sends it back anyway (PRTS 卫戍协议/帮助 "移动干员时，其所属召唤物全部退场并重置
//      至手牌区") — with no room it leaves the board until the next round start.
// The sim side (突袭 landing tile, tactical point) is test/sim/feedback1-water.test.js.
// Owner's decision 2026-10-04 reverses DESIGN §22.6: the trait 「可以放置于远程位」 is not trusted. Only elite
// 歌蕾蒂娅 carrying HOK-Y 淡金坠饰 (uniequip_003_glady) may stand on a 高台. The battle keeps position MELEE
// (on a 高台 she attacks but blocks nothing). A bot may plan that one loadout on a 高台; everyone else stays on the ground.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeployMap, canPlace as boardCanPlace, legalTiles, positionClass, placeClass, tileKey, ownerRangeKeys } from '../../server/match/board.js';
import { GLADIIA_HOK_Y } from '../../shared/highGround.js';
import { ERR } from '../../shared/constants.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier } from './harness.js';
import { botPrep, planLayout, fieldModel } from '../../server/match/bot.js';
import { placementContext, canPlace as clientCanPlace, boardTargets, deployMap as clientDeployMap } from '../../public/js/ui/gameLogic.js';
import { makeBattle } from '../helpers/battleHarness.js';

const STAGE = 'act2autochess_m04';
const WATER = ['10,6', '11,6', '12,6'];
const VIGIL = 'chess_char_3_19_a';
const MLYSS = 'chess_char_6_11_a';
const WOLF = 'token_10028_vigil_wolf';
const MANIFOLD = 'token_10030_mlyss_wtrman';
const MELEE = (c) => c.position === 'MELEE';
const RANGED = (c) => c.position === 'RANGED';

function prep(stageId = STAGE, seed = 11) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed }).start();
  h.toPrep(1);
  h.setStage(stageId);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m: h.m, ps };
}
const move = (m, uid, to, dir) => m.handle('p_0', { t: 'g.move', uid, to, ...(dir ? { dir } : {}) });
const board = (r, c) => ({ area: 'board', row: r, col: c });
const stackOf = (ps, id) => [...ps.hand, ...ps.temp].find((p) => p && p.kind === 'token' && p.id === id) ?? null;
const clientCtx = (m, ps, field = 'normal') => placementContext({
  priv: ps.privateView(), stage: m.stage, editable: true, field,
  getChess: (id) => DATA.chess[id] ?? null, getToken: (id) => DATA.tokens[id] ?? null, getItem: (id) => DATA.items[id] ?? null,
});

// ---------------------------------------------------------------------------------------------------------------------
// #3 the pool

test('#3 board.js: no deploy class on 战场#08\'s 深水区 — normal field, both boss halves; the client\'s map agrees', () => {
  const st = DATA.stages[STAGE];
  const n = buildDeployMap(st);
  for (const k of WATER) assert.equal(n.get(k), undefined, `normal ${k}`);
  assert.equal(n.get('11,5'), 'melee', 'the road beside it stays deployable');
  for (const field of ['bossL', 'bossR']) {
    const b = buildDeployMap(st, { field });
    // boss (3–5, 6) = board (10–12, 6); the right half is mirrored (col 14 → board col 6)
    for (const k of WATER) assert.equal(b.get(k), undefined, `${field} ${k}`);
    assert.deepEqual([...clientDeployMap(st, { field })].sort(), [...b].sort(), `${field}: client = server`);
  }
  assert.deepEqual([...clientDeployMap(st)].sort(), [...n].sort(), 'normal: client = server');
});

test('#3 g.move: neither a melee nor a ranged operator nor a summon goes into the water (BAD_TILE); the client refuses and never lights it', () => {
  const { m, ps } = prep();
  const melee = give(m, ps, chessOfTier(1, MELEE).find((x) => m.pool.has(x)));
  const ranged = give(m, ps, chessOfTier(1, RANGED).find((x) => m.pool.has(x)));
  for (const k of WATER) {
    const [r, c] = k.split(',').map(Number);
    assert.equal(move(m, melee.uid, board(r, c)).error, ERR.BAD_TILE, `melee ${k}`);
    assert.equal(move(m, ranged.uid, board(r, c)).error, ERR.BAD_TILE, `ranged ${k}`);
  }
  // 伺夜 (ranged) beside the pool facing it: her 狼群 (MELEE) may not go into the water either
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(11, 4)), { ok: true });
  const wolf = stackOf(ps, WOLF);
  assert.ok(wolf);
  assert.equal(move(m, wolf.uid, board(11, 6)).error, ERR.BAD_TILE, '狼群 into the water');
  const ctx = clientCtx(m, ps);
  for (const piece of [melee, ranged, wolf]) {
    for (const k of WATER) {
      const [r, c] = k.split(',').map(Number);
      assert.equal(clientCanPlace(ctx, piece.uid, board(r, c)).ok, false, `client ${piece.id} ${k}`);
    }
    const lit = boardTargets(ctx, piece.uid).legal.map(([r, c]) => tileKey(r, c));
    for (const k of WATER) assert.ok(!lit.includes(k), `${piece.id}: ${k} not lit`);
  }
  checkInvariants(m);
  m.dispose();
});

test('#3 act1 m05 (season 1, inactive): a 特制水上平台 makes its 深水区 deployable for any unit; the raw level files agree', () => {
  const st = DATA.stages.act1autochess_m05;
  const map = buildDeployMap(st);
  const platforms = st.devices.filter((d) => d.role === 'waterPlatform' && d.active).map((d) => tileKey(d.pos[0], d.pos[1]));
  for (const k of platforms) {
    const [r, c] = k.split(',').map(Number);
    if (r < 9 || r > 12 || c < 2 || c > 10) continue;
    assert.equal(map.get(k), 'melee', `platform ${k}`);
  }
  assert.deepEqual([...clientDeployMap(st)].sort(), [...map].sort());
});

test('#3 bots never put a piece into the water (layout planner and full bot preps on 战场#08)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 3, seed: 5 }).start();
  h.setStage(STAGE);
  let pieces = 0;
  for (let round = 1; round <= 5; round++) {
    h.toPrep(round);
    for (const ps of h.m.players.values()) {
      if (!ps.isBot || !ps.alive) continue;
      if (!ps.ready) botPrep(h.m, ps);
      for (const k of ps.board.keys()) { pieces++; assert.ok(!WATER.includes(k), `R${round} ${ps.playerId}: a piece on ${k}`); }
      const plan = planLayout(h.m, ps, ps.allChess());
      for (const k of plan.values()) assert.ok(!WATER.includes(k), `plan on ${k}`);
    }
  }
  assert.ok(pieces > 10, 'the bots fielded pieces');
  h.invariants();
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------------
// #9 tactical points

test('#9 data: 狼群 and 流形 are owner-range summons (token text "只能部署在召唤者攻击范围内"), no other hand summon is', () => {
  assert.equal(DATA.tokens[WOLF].ownerRange, true);
  assert.equal(DATA.tokens[MANIFOLD].ownerRange, true);
  for (const t of Object.values(DATA.tokens)) if (t.placeable && t.tokenId !== WOLF && t.tokenId !== MANIFOLD) assert.ok(!t.ownerRange, t.name);
});

test('#9 g.move: 伺夜\'s 狼群 only on a tile of her attack range (rotated grid of her tile + facing); outside → BAD_TILE', () => {
  const { m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  const wolf = stackOf(ps, WOLF);
  const range = ownerRangeKeys(DATA.chess[VIGIL].rangeGrid, 10, 4, 'RIGHT');
  assert.ok(range.has('11,5') && range.has('9,7') && !range.has('10,3') && !range.has('12,4'));
  // behind her / two rows down: outside the 3-row, 4-column range
  for (const [r, c] of [[10, 3], [12, 4], [12, 5], [9, 8]]) assert.equal(move(m, wolf.uid, board(r, c)).error, ERR.BAD_TILE, `outside ${r},${c}`);
  assert.ok(stackOf(ps, WOLF), 'still in the hand');
  assert.deepEqual(move(m, wolf.uid, board(11, 5)), { ok: true }, 'inside the range');
  const placed = ps.board.get('11,5');
  assert.equal(placed.id, WOLF);
  // board → board: a move out of the range is refused too, one inside it is fine
  assert.equal(move(m, placed.uid, board(12, 4)).error, ERR.BAD_TILE);
  assert.deepEqual(move(m, placed.uid, board(9, 6)), { ok: true });
  assert.equal(ps.board.get('9,6'), placed);
  checkInvariants(m);
  m.dispose();
});

test('#9 re-orienting the tactician: a summon still inside the new range stays, one left outside goes back to its stack', () => {
  const { m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  assert.deepEqual(move(m, stackOf(ps, WOLF).uid, board(11, 5)), { ok: true });
  const wolf = ps.board.get('11,5');
  // facing UP the range is rows 10–13 × cols 3–5: (11,5) is still inside
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'UP'), { ok: true });
  assert.equal(ps.board.get('10,4').dir, 'UP');
  assert.equal(ps.board.get('11,5'), wolf, 'still in range: stays');
  // facing LEFT the range is cols 1–4: (11,5) falls outside → back onto its stack in the hand
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'LEFT'), { ok: true });
  assert.equal(ps.board.get('11,5'), undefined, 'outside the new range: lifted');
  const stack = stackOf(ps, WOLF);
  assert.ok(stack && stack.count === 1, 'back in the hand');
  assert.equal(ps.battleInput().units.filter((u) => u.kind === 'token').length, 0);
  checkInvariants(m);
  m.dispose();
});

test('#9 hand and temp full: a re-orientation that would push 狼群 out is refused (HAND_FULL); a move drops it until the next round', () => {
  const { h, m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  assert.deepEqual(move(m, stackOf(ps, WOLF).uid, board(11, 5)), { ok: true });
  const wolf = ps.board.get('11,5');
  assert.equal(stackOf(ps, WOLF), null, 'its only copy is placed: no stack left to return onto');
  const toasts = [];
  const toast = m.toast.bind(m);
  m.toast = (p, kind, text) => { toasts.push(text); return toast(p, kind, text); };
  const golden = Object.keys(DATA.items).find((id) => DATA.items[id].isGolden && DATA.items[id].itemType === 'EQUIP');
  while (ps.hand.includes(null)) giveItem(m, ps, golden);
  while (ps.temp.includes(null)) giveItem(m, ps, golden, 'temp');
  // facing LEFT would leave (11,5) outside her range and the wolf has nowhere to go: refused, nothing changes
  assert.equal(move(m, vigil.uid, board(10, 4), 'LEFT').error, ERR.HAND_FULL);
  assert.equal(ps.board.get('10,4').dir, 'RIGHT');
  assert.equal(ps.board.get('11,5'), wolf);
  // facing UP keeps it inside: allowed
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'UP'), { ok: true });
  assert.equal(ps.board.get('11,5'), wolf);
  checkInvariants(m);
  // moving her (her summons go back to the hand; with no room a normal summon stays put) to (9,9) facing RIGHT, whose
  // range (rows 8–10, cols 9–12) leaves the wolf out: it leaves the board — no illegal placement reaches the battle
  assert.deepEqual(move(m, vigil.uid, board(9, 9), 'RIGHT'), { ok: true });
  assert.equal(ps.board.get('11,5'), undefined, 'outside her range with nowhere to go: removed');
  assert.ok(toasts.some((t) => t.includes('狼群') && t.includes('下回合返还')), toasts.join(' / '));
  assert.equal(ps.battleInput().units.filter((u) => u.kind === 'token').length, 0);
  checkInvariants(m);
  // …and its stack comes back at the next round start (grantTokensFor, "干员所属召唤物会于下一回合返还")
  h.toPrep(2);
  assert.ok(stackOf(ps, WOLF), 'the wolf is back in the hand / temp');
  checkInvariants(m);
  m.dispose();
});

test('#9 swaps: a summon dragged onto its tactician, or an operator onto the summon, must leave the summon inside the range', () => {
  const { m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  assert.deepEqual(move(m, stackOf(ps, WOLF).uid, board(10, 5)), { ok: true });
  const wolf = ps.board.get('10,5');
  // wolf onto 伺夜: she would stand on (10,5) facing RIGHT and the wolf behind her on (10,4) — outside → refused
  assert.equal(move(m, wolf.uid, board(10, 4)).error, ERR.BAD_TILE);
  assert.equal(ps.board.get('10,5'), wolf);
  assert.equal(ps.board.get('10,4'), vigil);
  // the wolf on (11,4), right above her: after the swap it is right below her (offset −1, 0) — inside → allowed
  assert.deepEqual(move(m, wolf.uid, board(11, 4)), { ok: true });
  assert.deepEqual(move(m, wolf.uid, board(10, 4)), { ok: true }, 'swap with the owner, still in range');
  assert.equal(ps.board.get('10,4'), wolf);
  assert.equal(ps.board.get('11,4'), vigil);
  // another operator dragged onto the wolf would send the wolf to that operator's tile: outside → refused
  const other = give(m, ps, chessOfTier(1, MELEE).find((x) => m.pool.has(x)));
  assert.deepEqual(move(m, other.uid, board(12, 3)), { ok: true });
  assert.equal(move(m, other.uid, board(10, 4)).error, ERR.BAD_TILE, '(12,3) is outside 伺夜\'s range (she stands on (11,4) now)');
  assert.deepEqual(move(m, other.uid, board(12, 5)), { ok: true });
  assert.deepEqual(move(m, other.uid, board(10, 4)), { ok: true }, '(12,5) is inside: the wolf moves there');
  assert.equal(ps.board.get('12,5'), wolf);
  checkInvariants(m);
  m.dispose();
});

test('#9 the client mirrors it: the drag highlights of 狼群 / 流形 are exactly the free legal tiles of the owner\'s range', () => {
  const { m, ps } = prep();
  const vigil = give(m, ps, VIGIL);
  assert.deepEqual(move(m, vigil.uid, board(10, 4), 'RIGHT'), { ok: true });
  const mly = give(m, ps, MLYSS);
  assert.deepEqual(move(m, mly.uid, board(12, 8), 'LEFT'), { ok: true });
  const map = buildDeployMap(m.stage);
  for (const [owner, tid, dir, at] of [[vigil, WOLF, 'RIGHT', [10, 4]], [mly, MANIFOLD, 'LEFT', [12, 8]]]) {
    const ctx = clientCtx(m, ps);
    const tok = stackOf(ps, tid);
    assert.ok(tok, tid);
    const range = ownerRangeKeys(DATA.chess[owner.id].rangeGrid, at[0], at[1], dir);
    const pos = positionClass(DATA.tokens[tid]);
    const want = legalTiles(map, pos).map(([r, c]) => tileKey(r, c)).filter((k) => range.has(k) && !ps.board.has(k)).sort();
    const lit = boardTargets(ctx, tok.uid).legal.map(([r, c]) => tileKey(r, c)).sort();
    assert.deepEqual(lit, want, `${tid} highlights`);
    assert.ok(want.length > 0);
    // every lit tile is accepted by the server, every other deployable tile refused
    for (const k of map.keys()) {
      const [r, c] = k.split(',').map(Number);
      if (ps.board.has(k)) continue;
      assert.equal(clientCanPlace(ctx, tok.uid, board(r, c)).ok, lit.includes(k), `client ${tid} ${k}`);
      assert.equal(boardCanPlace(map, pos, r, c) && range.has(k), lit.includes(k));
    }
  }
  // the client's swap rule: 狼群 onto 伺夜 from (10,5) would end behind her → refused
  assert.deepEqual(move(m, stackOf(ps, WOLF).uid, board(10, 5)), { ok: true });
  const ctx = clientCtx(m, ps);
  assert.equal(clientCanPlace(ctx, ps.board.get('10,5').uid, board(10, 4)).ok, false);
  checkInvariants(m);
  m.dispose();
});

test('#9 bots place 狼群 / 流形 only inside their owner\'s range', () => {
  let placed = 0;
  for (const seed of [3, 8, 21]) {
    const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed }).start();
    h.toPrep(2);
    h.setStage(STAGE);
    const bp = h.ps('ai_0');
    for (const p of [...bp.board.values(), ...bp.hand.filter(Boolean)]) if (p.kind === 'chess') bp.returnCopies(p);
    bp.board.clear();
    bp.hand.fill(null);
    bp.recompute();
    give(h.m, bp, 'chess_char_1_10_a'); // 古米: a blocker
    give(h.m, bp, VIGIL);
    give(h.m, bp, MLYSS);
    bp.ready = false;
    botPrep(h.m, bp);
    for (const [k, p] of bp.board) {
      if (p.kind !== 'token') continue;
      const owner = [...bp.board.entries()].find(([, q]) => q.uid === p.ownerUid);
      assert.ok(owner, 'its owner is on the board');
      const [or, oc] = owner[0].split(',').map(Number);
      const range = ownerRangeKeys(DATA.chess[owner[1].id].rangeGrid, or, oc, owner[1].dir || 'RIGHT');
      assert.ok(range.has(k), `seed ${seed}: ${p.id} on ${k} inside ${owner[1].id}'s range`);
      placed++;
    }
    checkInvariants(h.m);
    h.m.dispose();
  }
  assert.ok(placed > 0, 'the bots placed some summons');
});

// ---------------------------------------------------------------------------------------------------------------------
// 高台: only elite 歌蕾蒂娅 + HOK-Y (owner's decision 2026-10-04)

const HIGH_STAGE = 'act2autochess_m01';
const HIGH = ['10,4', '11,4', '12,4']; // 战场#01(下半)'s ranged-only (高台) tiles
const GLAD_N = 'chess_char_4_12_a';
const GLAD_E = 'chess_char_4_12_b'; // the golden record
const CLIFF_E = 'chess_char_2_03_b';
const FORCER_N = 'chess_char_3_07_a';
const FORCER_E = 'chess_char_3_07_b';
const HOK_X = 'uniequip_002_glady';
const TANK = (c) => c.profession === 'TANK' && c.position === 'MELEE';
const rc = (k) => k.split(',').map(Number);
const toHand = (m, ps, p) => move(m, p.uid, { area: 'hand', idx: ps.hand.findIndex((x) => x == null) });
const equip = (ps, module) => {
  assert.equal(ps.setLoadout({ [GLAD_N]: { module } }), true, module);
};

test('高台 data: no chess stores placement; HOK-Y is 淡金坠饰 on the elite 歌蕾蒂娅 only', () => {
  assert.equal(Object.values(DATA.chess).some((c) => c.placement !== undefined), false);
  for (const t of Object.values(DATA.tokens)) assert.equal(t.placement, undefined, t.tokenId);
  const e = DATA.chess[GLAD_E];
  const y = e.modules.find((m) => m.uniEquipId === GLADIIA_HOK_Y);
  assert.equal(e.charId, 'char_474_glady');
  assert.equal(e.isGolden, true);
  assert.equal(y.typeName, 'HOK-Y');
  assert.equal(y.name, '淡金坠饰');
  assert.equal(e.modules.find((m) => m.isDefault).uniEquipId, HOK_X, 'the default module is HOK-X, ground-only');
  assert.equal(DATA.chess[GLAD_N].isGolden, false);
  assert.ok(!DATA.chess[CLIFF_E].modules.some((m) => m.uniEquipId === GLADIIA_HOK_Y), '崖心 has no HOK-Y');
  assert.equal(DATA.chess[GLAD_N].position, 'MELEE');
  assert.equal(e.position, 'MELEE');
});

test('高台 table: (operator, module, tile) → allowed only for elite 歌蕾蒂娅 + HOK-Y on a 高台; ranged unchanged', () => {
  const { m, ps } = prep(HIGH_STAGE);
  assert.deepEqual([...ps.deployMap()].filter(([, cls]) => cls === 'ranged').map(([k]) => k).sort(), HIGH);
  // rows: chess id, module set on the 歌蕾蒂娅 loadout (null = leave the default), expect 高台
  const rows = [
    [GLAD_E, GLADIIA_HOK_Y, true],
    [GLAD_E, HOK_X, false],
    [GLAD_E, 'none', false],
    [GLAD_N, GLADIIA_HOK_Y, false],
    [GLAD_N, null, false],
    [CLIFF_E, GLADIIA_HOK_Y, false],
    [FORCER_N, null, false],
    [FORCER_E, null, false],
  ];
  const owned = new Map();
  for (const [id, module, allowHigh] of rows) {
    if (module) equip(ps, module);
    else ps.setLoadout({});
    let p = owned.get(id);
    if (!p) { p = give(m, ps, id); owned.set(id, p); }
    else if (ps.find(p.uid)?.area === 'board') assert.deepEqual(toHand(m, ps, p), { ok: true });
    for (const k of HIGH) {
      const [r, c] = rc(k);
      const res = move(m, p.uid, board(r, c), 'DOWN');
      if (allowHigh) {
        assert.deepEqual(res, { ok: true }, `${id} ${module} → ${k}`);
        assert.equal(ps.board.get(k), p);
        checkInvariants(m);
        assert.deepEqual(toHand(m, ps, p), { ok: true });
      } else {
        assert.equal(res.error, ERR.BAD_TILE, `${id} ${module || 'default'} → ${k}`);
      }
    }
    assert.deepEqual(move(m, p.uid, board(9, 3)), { ok: true }, `${id}: the ground stays legal`);
    assert.equal(placeClass(ps, DATA.chess[id]) === 'all', allowHigh, id);
    assert.deepEqual(toHand(m, ps, p), { ok: true });
    ps.setLoadout({});
  }
  const tank = give(m, ps, chessOfTier(1, TANK).find((x) => m.pool.has(x)));
  const ranged = give(m, ps, chessOfTier(1, RANGED).find((x) => m.pool.has(x)));
  for (const k of HIGH) {
    const [r, c] = rc(k);
    assert.equal(move(m, tank.uid, board(r, c)).error, ERR.BAD_TILE, `重装 → ${k}`);
  }
  assert.deepEqual(move(m, tank.uid, board(9, 3)), { ok: true }, 'the 重装 on the ground');
  assert.deepEqual(move(m, ranged.uid, board(10, 4)), { ok: true }, 'ranged on the 高台');
  assert.deepEqual(move(m, ranged.uid, board(9, 4)), { ok: true }, 'ranged on the ground (there is no ground-only tile)');
  assert.equal(move(m, ranged.uid, board(9, 6)).error, ERR.BAD_TILE, 'ranged refused on a non-deployable tile');
  checkInvariants(m);
  m.dispose();
});

test('高台 client: drag highlights follow the loadout; a 重装 keeps "近战单位只能部署在地面"', () => {
  const { m, ps } = prep(HIGH_STAGE);
  equip(ps, GLADIIA_HOK_Y);
  const glad = give(m, ps, GLAD_E);
  const normal = give(m, ps, GLAD_N);
  const cliff = give(m, ps, CLIFF_E);
  const tank = give(m, ps, chessOfTier(1, TANK).find((x) => m.pool.has(x)));
  const ranged = give(m, ps, chessOfTier(1, RANGED).find((x) => m.pool.has(x)));
  const ctx = clientCtx(m, ps);
  const map = ps.deployMap();
  for (const p of [glad, normal, cliff, tank, ranged]) {
    const lit = boardTargets(ctx, p.uid).legal.map(([r, c]) => tileKey(r, c)).sort();
    assert.deepEqual(lit, legalTiles(map, placeClass(ps, DATA.chess[p.id])).map(([r, c]) => tileKey(r, c)).sort(), `${p.id}: highlights = the server`);
  }
  for (const k of HIGH) {
    const [r, c] = rc(k);
    assert.equal(clientCanPlace(ctx, glad.uid, board(r, c)).ok, true, k);
    for (const p of [normal, cliff, tank]) {
      const res = clientCanPlace(ctx, p.uid, board(r, c));
      assert.equal(res.ok, false, p.id);
      assert.equal(res.reason, '近战单位只能部署在地面');
    }
    assert.equal(clientCanPlace(ctx, ranged.uid, board(r, c)).ok, true);
  }
  m.dispose();
});

test('高台 swaps: elite 歌蕾蒂娅 + HOK-Y trades with a ranged operator, not with a 重装', () => {
  const { m, ps } = prep(HIGH_STAGE);
  equip(ps, GLADIIA_HOK_Y);
  const glad = give(m, ps, GLAD_E);
  const tank = give(m, ps, chessOfTier(1, TANK).find((x) => m.pool.has(x)));
  const ranged = give(m, ps, chessOfTier(1, RANGED).find((x) => m.pool.has(x)));
  assert.deepEqual(move(m, glad.uid, board(10, 4), 'DOWN'), { ok: true });
  assert.deepEqual(move(m, tank.uid, board(9, 3)), { ok: true });
  assert.deepEqual(move(m, ranged.uid, board(11, 4)), { ok: true });
  let ctx = clientCtx(m, ps);
  assert.equal(clientCanPlace(ctx, glad.uid, board(9, 3)).ok, false);
  assert.equal(move(m, glad.uid, board(9, 3)).error, ERR.BAD_TILE);
  assert.equal(clientCanPlace(ctx, tank.uid, board(10, 4)).ok, false);
  assert.equal(move(m, tank.uid, board(10, 4)).error, ERR.BAD_TILE);
  assert.equal(clientCanPlace(ctx, glad.uid, board(11, 4)).ok, true);
  assert.deepEqual(move(m, glad.uid, board(11, 4)), { ok: true });
  assert.equal(ps.board.get('11,4'), glad);
  assert.equal(ps.board.get('10,4'), ranged);
  assert.deepEqual(move(m, glad.uid, board(12, 5)), { ok: true });
  ctx = clientCtx(m, ps);
  assert.equal(clientCanPlace(ctx, tank.uid, board(12, 5)).ok, true);
  assert.deepEqual(move(m, tank.uid, board(12, 5)), { ok: true });
  assert.equal(ps.board.get('9,3'), glad);
  checkInvariants(m);
  m.dispose();
});

test('高台 battle input: elite 歌蕾蒂娅 + HOK-Y is fielded on (10,4) and blocks nothing there; on the ground she blocks', () => {
  const { m, ps } = prep(HIGH_STAGE);
  equip(ps, GLADIIA_HOK_Y);
  const glad = give(m, ps, GLAD_E);
  assert.deepEqual(move(m, glad.uid, board(10, 4), 'DOWN'), { ok: true });
  const u0 = ps.battleInput().units.find((u) => u.uid === glad.uid);
  assert.deepEqual([u0.row, u0.col, u0.dir, u0.moduleId], [10, 4, 'DOWN', GLADIIA_HOK_Y]);
  m.dispose();
  // position stays MELEE either way: the normal record (the same body the 0.1.2 measurement used) attacks the lane
  // from the 高台 and blocks nothing there. HOK-Y's own range is not what this asserts.
  for (const [r, c, dir, high] of [[10, 4, 'DOWN', true], [9, 5, 'RIGHT', false]]) {
    const h = makeBattle({
      stageId: HIGH_STAGE, seed: 3, timeLimit: 60, autoFinish: false,
      units: [{ chessId: GLAD_N, row: r, col: c, dir, carryState: { sp: 0 } }],
      enemies: [{ key: 'enemy_1422_lrsldr', route: 0, time: 1, mods: { hpMul: 50 } }],
    });
    const u = h.unit(GLAD_N);
    let hits = 0;
    let blocked = false;
    h.b.on('damaged', (x) => { if (x.source === u) hits++; });
    for (let i = 0; i < 30 * 30; i++) { h.step(1); if (u.blocking.length) blocked = true; }
    assert.ok(u.deployed, `deployed on ${r},${c}`);
    assert.equal(u.ground, !high, `${r},${c}: ground unit`);
    assert.ok(hits > 0, `attacks from ${r},${c}`);
    assert.equal(blocked, !high, high ? 'blocks nothing on the 高台' : 'blocks on the ground');
    assert.equal(h.b.errors.length, 0);
  }
});

test('高台 bots: elite 歌蕾蒂娅 + HOK-Y takes a 高台 that covers the road while the ground is still free', () => {
  const { m, ps } = prep(HIGH_STAGE, 11);
  equip(ps, GLADIIA_HOK_Y);
  const elite = give(m, ps, GLAD_E);
  const k = planLayout(m, ps, [elite]).get(elite.uid);
  assert.equal(ps.deployMap().get(k), 'ranged', `planned on a 高台 with the road open (${k})`);
  const [r, c] = rc(k);
  assert.deepEqual(move(m, elite.uid, board(r, c)), { ok: true });
  m.dispose();
});

test('高台 bots: everyone else stays on the road; elite 歌蕾蒂娅 + HOK-Y may take a 高台 when the ground is full', () => {
  const { m, ps } = prep(HIGH_STAGE, 11);
  const pieces = ['chess_char_4_02_a', GLAD_N, FORCER_N, 'chess_char_2_03_a'].map((id) => give(m, ps, id));
  const plan = planLayout(m, ps, pieces);
  const map = ps.deployMap();
  const road = fieldModel(m, ps).ground;
  for (const p of pieces.slice(1)) {
    const k = plan.get(p.uid);
    assert.equal(map.get(k), 'melee', `${p.id} on a ground tile (${k})`);
    assert.ok(road.has(k), `${p.id} on an enemy road tile (${k})`);
    assert.equal(move(m, p.uid, board(10, 4)).error, ERR.BAD_TILE, `${p.id} deploy refused`);
  }
  const elite = give(m, ps, GLAD_E);
  equip(ps, GLADIIA_HOK_Y);
  const melee = [...map].filter(([, cls]) => cls === 'melee').map(([k]) => k);
  const highPlan = planLayout(m, ps, [elite], undefined, { occupied: new Set(melee) });
  const hk = highPlan.get(elite.uid);
  assert.equal(map.get(hk), 'ranged', `HOK-Y planned on a 高台 (${hk})`);
  const [hr, hc] = rc(hk);
  assert.deepEqual(move(m, elite.uid, board(hr, hc)), { ok: true });
  checkInvariants(m);
  assert.deepEqual(toHand(m, ps, elite), { ok: true });
  equip(ps, 'none');
  const refused = planLayout(m, ps, [elite], undefined, { occupied: new Set(melee) });
  assert.equal(refused.get(elite.uid), undefined, 'no module: a 高台 is not a fallback');
  assert.equal(move(m, elite.uid, board(10, 4)).error, ERR.BAD_TILE);
  m.dispose();
});
