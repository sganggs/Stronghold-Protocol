// Board placement legality (stage legend), deploy cap, move semantics, placeable summons (DESIGN §3, research 03 C2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeployMap, canPlace, legalTiles, tileKey, positionClass, basePositionClass } from '../../server/match/board.js';
import { applyCard } from '../../server/match/choices.js';
import { ERR } from '../../shared/constants.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier } from './harness.js';

const MELEE = (c) => c.position === 'MELEE';
const RANGED = (c) => c.position === 'RANGED';

function prepMatch(stageId = 'act2autochess_m01', o = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: o.seed ?? 11, ...o }).start();
  h.toPrep(1);
  h.setStage(stageId);
  const ps = h.ps('p_0');
  // clean board/hand for deterministic scenarios
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m: h.m, ps };
}

test('deploy map from the stage legend equals stages[id].deployTiles.normal for every stage', () => {
  for (const [id, st] of Object.entries(DATA.stages)) {
    const map = buildDeployMap(st);
    const melee = [...map].filter(([, v]) => v === 'melee').map(([k]) => k).sort();
    const ranged = [...map].filter(([, v]) => v === 'ranged').map(([k]) => k).sort();
    assert.deepEqual(melee, st.deployTiles.normal.melee.map(([r, c]) => tileKey(r, c)).sort(), `${id} melee`);
    assert.deepEqual(ranged, st.deployTiles.normal.rangedOnly.map(([r, c]) => tileKey(r, c)).sort(), `${id} ranged`);
  }
});

test('glyph rules: melee only on LOW buildable ALL/MELEE; ranged also on HIGH/RANGED; lane/forbidden never; device overrides', () => {
  const st = DATA.stages.act2autochess_m01;
  const map = buildDeployMap(st);
  // (10,4) is 'h' high ground: ranged only; (9,3) road: both; (9,6) '#': none; col 9 lane (10,9) 'f': none
  assert.equal(map.get('10,4'), 'ranged');
  assert.ok(canPlace(map, 'ranged', 10, 4) && !canPlace(map, 'melee', 10, 4));
  assert.ok(canPlace(map, 'melee', 9, 3) && canPlace(map, 'ranged', 9, 3) && canPlace(map, 'all', 9, 3));
  assert.ok(!canPlace(map, 'ranged', 9, 6));
  assert.ok(!canPlace(map, 'ranged', 10, 9));
  assert.ok(!canPlace(map, 'ranged', 8, 4), 'temp row is not the board');
  assert.ok(!canPlace(map, 'ranged', 9, 11), 'partner half is not the own board');
  // crates block tiles; a terrain override (crate removed) frees them
  const m01 = DATA.stages.act1autochess_m01;
  const crate = m01.devices.find((d) => d.role === 'crate' && d.pos[0] === 11 && d.pos[1] === 5);
  assert.ok(crate);
  assert.ok(!canPlace(buildDeployMap(m01), 'melee', 11, 5));
  assert.ok(canPlace(buildDeployMap(m01, { deviceOverrides: { [crate.alias]: false } }), 'melee', 11, 5));
  assert.ok(!canPlace(buildDeployMap(m01, { tileOverrides: { '12,3': 'none' } }), 'melee', 12, 3));
  assert.deepEqual(legalTiles(map, 'melee').length, st.deployTiles.normal.melee.length);
  // missing stage data: an open board (degraded mode)
  assert.ok(canPlace(buildDeployMap(null), 'melee', 10, 5));
});

test('positionClass: melee stays ground-only; only elite 歌蕾蒂娅 + HOK-Y is widened (owner 2026-10-04)', () => {
  assert.equal(positionClass({ position: 'MELEE' }), 'melee');
  assert.equal(positionClass({ position: 'MELEE', placement: 'all' }), 'melee', 'the old placement field is ignored');
  assert.equal(basePositionClass({ position: 'MELEE', isGolden: true, charId: 'char_474_glady' }), 'melee');
  assert.equal(positionClass({ position: 'RANGED' }), 'ranged');
  assert.equal(positionClass({ position: 'ALL' }), 'all');
  assert.equal(positionClass(null), 'all');
  const HOK_Y = 'uniequip_003_glady';
  const gladE = DATA.chess.chess_char_4_12_b;
  const map = buildDeployMap(DATA.stages.act2autochess_m01);
  assert.ok(!canPlace(map, positionClass(DATA.chess.chess_char_4_12_a, HOK_Y), 10, 4), 'normal 歌蕾蒂娅, even with the id, not');
  assert.ok(!canPlace(map, positionClass(gladE), 10, 4), 'elite with no module id (default is not passed) not');
  assert.ok(!canPlace(map, positionClass(gladE, 'uniequip_002_glady'), 10, 4), 'HOK-X not');
  assert.ok(!canPlace(map, positionClass(gladE, 'none'), 10, 4), 'no module not');
  assert.ok(canPlace(map, positionClass(gladE, HOK_Y), 10, 4), 'elite + HOK-Y on the 高台');
  assert.ok(canPlace(map, positionClass(gladE, HOK_Y), 9, 3), 'and still on the ground');
  assert.ok(!canPlace(map, positionClass(DATA.chess.chess_char_2_03_b, HOK_Y), 10, 4), '崖心 not');
  assert.ok(!canPlace(map, positionClass(DATA.chess.chess_char_3_07_b, HOK_Y), 10, 4), '见行者 not');
  assert.ok(!canPlace(map, positionClass(DATA.chess.chess_char_1_02_a), 10, 4), '角峰 (重装) not');
  assert.equal(DATA.chess.chess_char_4_12_a.placement, undefined);
  assert.equal(gladE.placement, undefined);
});

test('g.move: legality per chess position, BAD_TILE outside, deploy cap 8, swaps allowed at cap', () => {
  const { h, m, ps } = prepMatch();
  const meleeId = chessOfTier(1, MELEE).find((id) => m.pool.has(id));
  const rangedId = chessOfTier(1, RANGED).find((id) => m.pool.has(id));
  const a = give(m, ps, meleeId);
  const b = give(m, ps, rangedId);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 10, col: 4 } }), { error: ERR.BAD_TILE }, 'melee on high ground');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: b.uid, to: { area: 'board', row: 10, col: 4 } }), { ok: true }, 'ranged on high ground');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 9, col: 6 } }), { error: ERR.BAD_TILE }, 'forbidden tile');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 15, col: 4 } }), { error: ERR.BAD_TILE }, 'outside the board');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 9, col: 3 } }), { ok: true });
  // ranged may use a melee tile; board→board swap keeps legality (melee cannot be swapped onto high ground)
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: b.uid, to: { area: 'board', row: 9, col: 3 } }), { error: ERR.BAD_TILE }, 'the melee occupant cannot go to 10,4');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: b.uid, to: { area: 'board', row: 9, col: 4 } }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 9, col: 4 } }), { ok: true }, 'melee/ranged swap on melee tiles');
  assert.equal(ps.board.get('9,4').uid, a.uid);
  assert.equal(ps.board.get('9,3').uid, b.uid);
  // fill to the cap (8)
  const tiles = legalTiles(ps.deployMap(), 'melee').filter(([r, c]) => !ps.board.has(tileKey(r, c)));
  const extra = [];
  for (const id of chessOfTier(2, MELEE).filter((x) => m.pool.has(x)).slice(0, 7)) extra.push(give(m, ps, id));
  for (let i = 0; i < 6; i++) assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: extra[i].uid, to: { area: 'board', row: tiles[i][0], col: tiles[i][1] } }), { ok: true });
  assert.equal(ps.deployCount, 8);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: extra[6].uid, to: { area: 'board', row: tiles[6][0], col: tiles[6][1] } }), { error: ERR.BOARD_FULL });
  // swapping a hand chess with a board chess is fine at the cap
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: extra[6].uid, to: { area: 'board', row: tiles[0][0], col: tiles[0][1] } }), { ok: true });
  assert.equal(ps.deployCount, 8);
  assert.ok(ps.hand.some((p) => p && p.uid === extra[0].uid), 'the swapped-out chess went to the hand');
  // the 人事部文档 style cap raise
  ps.deployCapMin = 9;
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: extra[0].uid, to: { area: 'board', row: tiles[6][0], col: tiles[6][1] } }), { ok: true });
  assert.equal(ps.deployCount, 9);
  checkInvariants(m);
  m.dispose();
});

test('g.move to the hand: withdraw, full-hand swap with a chess, hand↔hand swaps, items stay in the hand', () => {
  const { m, ps } = prepMatch();
  const ids = chessOfTier(1).filter((x) => m.pool.has(x));
  const onBoard = give(m, ps, ids[0], 'board', [9, 3]);
  // fill the hand with 9 chess + 1 item
  const handChess = [];
  for (let i = 1; i <= 9; i++) handChess.push(give(m, ps, ids[i]));
  const item = giveItem(m, ps, 'chess_item_1_01_e_a');
  assert.equal(ps.hand.filter(Boolean).length, 10);
  // hand full: withdraw onto an empty slot impossible → onto a chess = swap (if the chess is legal on the tile)
  const target = ps.hand.findIndex((p) => p && p.kind === 'chess' && m.gd.chess(p.id).position === 'MELEE');
  if (target >= 0) {
    const other = ps.hand[target];
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: onBoard.uid, to: { area: 'hand', idx: target } }), { ok: true });
    assert.equal(ps.hand[target].uid, onBoard.uid);
    assert.equal(ps.board.get('9,3').uid, other.uid);
  }
  // onto the item slot with a full hand → HAND_FULL
  const itemIdx = ps.hand.findIndex((p) => p && p.kind === 'item');
  const boardPiece = ps.board.get('9,3');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: boardPiece.uid, to: { area: 'hand', idx: itemIdx } }), { error: ERR.HAND_FULL });
  // items cannot be placed on the board but can move inside the hand
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: item.uid, to: { area: 'board', row: 9, col: 4 } }).error, ERR.BAD_TARGET);
  const other = handChess[0];
  const oi = ps.hand.findIndex((p) => p && p.uid === other.uid);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: item.uid, to: { area: 'hand', idx: oi } }), { ok: true });
  assert.equal(ps.hand[oi].uid, item.uid);
  assert.equal(ps.hand[itemIdx].uid, other.uid);
  // bad inputs
  assert.equal(m.handle('p_0', { t: 'g.move', uid: 999999, to: { area: 'hand', idx: 0 } }).error, ERR.BAD_TARGET);
  assert.equal(m.handle('p_0', { t: 'g.move', uid: item.uid, to: { area: 'hand', idx: 10 } }).error, ERR.BAD_TARGET);
  checkInvariants(m);
  m.dispose();
});

test('placeable summons: owner on board sends a stack to the hand; tokens deploy without a slot; withdrawing removes them', () => {
  const { m, ps } = prepMatch('act2autochess_m04');
  const ownerId = 'chess_char_3_19_a'; // 伺夜 → 狼群 (DEFAULT, placeable)
  assert.equal(DATA.tokens.token_10028_vigil_wolf.displayType, 'DEFAULT');
  const owner = give(m, ps, ownerId);
  const tile = [9, 3];
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: owner.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
  const stack = ps.hand.find((p) => p && p.kind === 'token');
  assert.ok(stack, 'token stack sent to the hand');
  assert.equal(stack.ownerUid, owner.uid);
  assert.equal(stack.count, DATA.tokens.token_10028_vigil_wolf.deployLimit);
  const deployedBefore = ps.deployCount;
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: 9, col: 4 } }), { ok: true });
  assert.equal(ps.deployCount, deployedBefore, 'summons do not use deploy slots');
  const tok = ps.board.get('9,4');
  assert.equal(tok.kind, 'token');
  // the private view carries it with count/ownerUid
  const view = ps.privateView();
  const tv = view.board.find((p) => p.kind === 'token');
  assert.equal(tv.ownerUid, owner.uid);
  // back to the hand (re-stacks), then withdraw the owner → tokens gone
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: tok.uid, to: { area: 'hand', idx: 0 } }), { ok: true });
  assert.equal(ps.hand.filter((p) => p && p.kind === 'token').length, 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: ps.hand.find((p) => p && p.kind === 'token').uid, to: { area: 'board', row: 9, col: 4 } }), { ok: true });
  const free = ps.hand.findIndex((x) => x == null);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: owner.uid, to: { area: 'hand', idx: free } }), { ok: true });
  assert.ok(![...ps.board.values(), ...ps.hand].some((p) => p && p.kind === 'token'), 'owner withdrawn → its summons removed');
  // summons of an owner that is not on the board cannot deploy; tokens are not sellable
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: owner.uid, to: { area: 'board', row: 9, col: 3 } }), { ok: true });
  const st2 = ps.hand.find((p) => p && p.kind === 'token');
  assert.equal(m.handle('p_0', { t: 'g.sell', uid: st2.uid }).error, ERR.BAD_TARGET);
  // selling the owner removes its summons too
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: owner.uid }), { ok: true });
  assert.ok(![...ps.board.values(), ...ps.hand].some((p) => p && p.kind === 'token'));
  checkInvariants(m);
  m.dispose();
});

test('battle input: board units in deploy order with items; tokens carry ownerUid', () => {
  const { m, ps } = prepMatch('act2autochess_m04');
  const a = give(m, ps, 'chess_char_3_19_a');
  m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 10, col: 5 } });
  const b = give(m, ps, chessOfTier(1, MELEE).find((x) => m.pool.has(x)), 'board', [12, 3]);
  const it = giveItem(m, ps, 'chess_item_1_01_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: it.uid, targetUid: b.uid }), { ok: true });
  const tok = ps.hand.find((p) => p && p.kind === 'token');
  // (9,6): inside 伺夜's range ("只能部署在召唤者攻击范围内", player report #9 after 0.1.0)
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: tok.uid, to: { area: 'board', row: 9, col: 6 } }), { ok: true });
  const input = ps.battleInput();
  assert.deepEqual(input.units.map((u) => [u.row, u.col]), [[12, 3], [10, 5], [9, 6]], 'top→bottom then left→right');
  assert.deepEqual(input.units[0].items, ['chess_item_1_01_e_a']);
  assert.equal(input.units[2].kind, 'token');
  assert.equal(input.units[2].ownerUid, a.uid);
  assert.equal(input.playerId, 'p_0');
  assert.ok(input.bonds && typeof input.bonds === 'object');
  m.dispose();
});

test('terrain 机变 card (模拟战场演变·模式二 on 战场 m02): an operator left on a tile it may no longer occupy is withdrawn to the hand (overflow temp); legal pieces stay', () => {
  const { m, ps } = prepMatch('act1autochess_m02');
  assert.equal(ps.deployMap().get('12,4'), 'melee');
  assert.equal(ps.deployMap().get('12,5'), 'melee');
  const melees = chessOfTier(1, MELEE).filter((x) => m.pool.has(x));
  const ranged = chessOfTier(1, RANGED).find((x) => m.pool.has(x));
  const a = give(m, ps, melees[0]);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 12, col: 4 } }), { ok: true });
  const r = give(m, ps, ranged);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: r.uid, to: { area: 'board', row: 12, col: 5 } }), { ok: true });
  // a full hand: the withdrawn operator overflows into temp (the player re-places it during the prep)
  for (let i = 1; ps.hand.some((p) => p == null); i++) give(m, ps, melees[i % melees.length]);
  const card = m.gd.choices.cards.tactic.find((c) => c.effectId === 'map_m02_1');
  assert.ok(card, 'data: the m02 terrain card');
  applyCard(m, ps, { kind: 'tactic', id: 'map_m02_1', name: card.name, desc: card.desc, team: false, tacticKind: 'terrain' });
  assert.equal(ps.deployMap().get('12,4'), 'ranged', 'the barricades became 射击台');
  assert.equal(ps.board.get('12,4'), undefined, 'the melee operator left the 射击台');
  assert.ok(ps.temp.includes(a), 'hand full → temp');
  assert.equal(ps.board.get('12,5'), r, 'a ranged operator stays on the new 射击台');
  assert.ok(!ps.battleInput().units.some((u) => u.uid === a.uid));
  assert.equal(ps.tempEmpty, false, 'temp blocks Ready until the operator is re-placed');
  checkInvariants(m);
  m.dispose();
});

test('a terrain change by content (setDeviceActive at the prep end, no recompute) never fields an illegal board', () => {
  const { m, ps } = prepMatch('act1autochess_m02');
  const a = give(m, ps, chessOfTier(1, MELEE).find((x) => m.pool.has(x)));
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 12, col: 4 } }), { ok: true });
  // what map_m02_1 toggles, applied the way ctx.setDeviceActive does it (invalidateDeployMap + dirty, no recompute)
  const eff = m.gd.effect('map_m02_1');
  for (const b of eff.buffs) for (const [alias, v] of Object.entries(b.bb || {})) if (alias.includes('#')) { ps.deviceOverrides[alias] = Number(v) !== 0; ps.invalidateDeployMap(); }
  const input = ps.battleInput();
  assert.ok(!input.units.some((u) => u.uid === a.uid), 'withdrawn before the battle input is built');
  assert.ok(ps.hand.includes(a));
  checkInvariants(m);
  m.dispose();
});

test('withdrawing a deployed summon into a full hand: HAND_FULL like any other card (no overflow into temp)', () => {
  const { m, ps } = prepMatch('act2autochess_m04');
  // 伺夜 → one 狼群 (deployLimit 1): once deployed no stack is left in the hand to join
  const medic = give(m, ps, 'chess_char_3_19_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: medic.uid, to: { area: 'board', row: 10, col: 5 } }), { ok: true });
  const drone = ps.hand.find((p) => p && p.kind === 'token');
  assert.ok(drone && drone.count === 1, 'one 狼群');
  // (9,6): inside 伺夜's range ("只能部署在召唤者攻击范围内", player report #9 after 0.1.0)
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: drone.uid, to: { area: 'board', row: 9, col: 6 } }), { ok: true });
  // golden items never merge with each other: a plain full hand
  for (let i = 0; i < ps.hand.length; i++) if (!ps.hand[i]) giveItem(m, ps, 'chess_item_1_02_e_b', 'hand', i);
  assert.ok(ps.hand.every(Boolean) && ps.tempEmpty);
  assert.equal(m.handle('p_0', { t: 'g.move', uid: drone.uid, to: { area: 'hand', idx: 0 } }).error, ERR.HAND_FULL, 'a new card for a full hand');
  assert.equal(ps.board.get('9,6'), drone, 'the 狼群 stays on the board');
  assert.ok(ps.tempEmpty, 'nothing overflowed into temp (Ready stays possible)');
  assert.equal(m.handle('p_0', { t: 'g.move', uid: medic.uid, to: { area: 'hand', idx: 0 } }).error, ERR.HAND_FULL, 'the same as withdrawing an operator');
  // a free slot: the 狼群 comes back
  ps.hand[3] = null;
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: drone.uid, to: { area: 'hand', idx: 0 } }), { ok: true });
  assert.equal(ps.hand[3], drone);
  checkInvariants(m);
  m.dispose();
});
