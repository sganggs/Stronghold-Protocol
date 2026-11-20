// GitHub #984: swapping a ranged operator onto its own MELEE summon leaves the summon on the ranged tile.
// The move stays legal; recompute returns the summon. Harness-only, 规程 stage act3autochess_m09 (tile 10,6 is ranged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { GEO, ERR } from '../../shared/constants.js';
import { renderMessage } from '../../shared/i18n.js';
import { planLayout } from '../../server/match/bot.js';
import { placementContext, canPlace } from '../../public/js/ui/gameLogic.js';
import { makeMatch, give, giveItem } from './harness.js';

const V3 = getVersionData('act3autochess@V3_1');
const NIGHT = 'chess_char_4_22_a';
const BIRD = 'token_10003_cgbird_bird';
const STAGE = 'act3autochess_m09';

const board = (row, col) => ({ area: 'board', row, col });
const move = (h, piece, to, dir = 'RIGHT') => h.m.handle('p_0', { t: 'g.move', uid: piece.uid, to, dir });
const stackOf = (ps, owner) => [...ps.hand, ...ps.temp].find((p) => p?.kind === 'token' && p.ownerUid === owner.uid && p.id === BIRD);

function watch(m) {
  const toasts = [];
  const toast = m.toast.bind(m);
  m.toast = (p, kind, text) => { toasts.push(renderMessage(text)); return toast(p, kind, text); };
  return toasts;
}

function prep(t) {
  const h = makeMatch({
    data: V3, mode: 'solo', modeId: 'mode_single_1', seed: 11,
    seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true }],
  }).start();
  t.after(() => h.m.dispose());
  h.toPrep(1, { band: 'band_sarkazb' });
  h.setStage(STAGE);
  const ps = h.ps('p_0');
  for (const p of ps.allChess()) ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp = new Array(GEO.TEMP_SIZE).fill(null);
  ps._tempDue.clear();
  ps.recompute();
  assert.equal(ps.gd.chess(NIGHT)?.charId, 'char_179_cgbird');
  assert.equal(ps.gd.token(BIRD)?.name, '幻影');
  assert.equal(ps.gd.token(BIRD)?.position, 'MELEE');
  assert.equal(ps.gd.token(BIRD)?.ownerRange, false);
  assert.equal(ps.deployMap().get('10,6'), 'ranged');
  assert.equal(ps.deployMap().get('10,5'), 'melee');
  assert.equal(ps.deployMap().get('11,5'), 'melee');
  assert.equal(ps.deployMap().get('11,4'), 'melee');
  h.invariants();
  return { h, ps };
}

function deployOwner(h, ps, row, col) {
  return give(h.m, ps, NIGHT, 'board', [row, col]);
}

function placeOne(h, ps, owner, row, col, dir = 'LEFT') {
  const stack = stackOf(ps, owner);
  assert.ok(stack && stack.count >= 2, 'a copy stays in the hand so the placed piece is a split');
  const before = stack.count;
  assert.deepEqual(move(h, stack, board(row, col), dir), { ok: true });
  const placed = ps.board.get(`${row},${col}`);
  assert.equal(placed?.id, BIRD);
  assert.equal(placed.dir, dir);
  assert.notEqual(placed, stack);
  assert.equal(stack.count, before - 1);
  return placed;
}

/** Put every remaining 幻影 copy on a melee tile. Returns the placed pieces, last one is the final copy. */
function placeAll(h, ps, owner) {
  const spots = [[11, 5], [11, 4], [11, 3], [11, 6], [11, 7], [10, 5], [10, 3], [10, 7]];
  const placed = [];
  let i = 0;
  while (stackOf(ps, owner)) {
    assert.ok(i < spots.length, 'ran out of melee tiles before the stack was empty');
    const [r, c] = spots[i++];
    const stack = stackOf(ps, owner);
    assert.deepEqual(move(h, stack, board(r, c), 'LEFT'), { ok: true });
    placed.push(ps.board.get(`${r},${c}`));
  }
  assert.ok(placed.length >= 2, 'both granted copies are on the board');
  return placed;
}

function clientCtx(h, ps) {
  return placementContext({
    priv: ps.privateView(), stage: h.m.stage, editable: true,
    getChess: (id) => ps.gd.chess(id), getToken: (id) => ps.gd.token(id), backups: ps.gd.raw.backups,
    config: ps.gd.raw.config,
  });
}

test('GitHub #984: swapping onto a melee summon returns it off the ranged tile', (t) => {
  const { h, ps } = prep(t);
  const night = deployOwner(h, ps, 10, 6);
  const before = stackOf(ps, night).count;
  const bird = placeOne(h, ps, night, 10, 5);
  const toasts = watch(h.m);
  assert.equal(canPlace(clientCtx(h, ps), night.uid, board(10, 5)).ok, true);
  assert.equal(canPlace(clientCtx(h, ps), night.uid, board(10, 5)).action, 'swap');
  assert.deepEqual(move(h, night, board(10, 5)), { ok: true });
  assert.equal(ps.board.get('10,5'), night);
  assert.equal(ps.board.get('10,6'), undefined, 'the summon must not stay on the ranged tile');
  assert.equal(stackOf(ps, night).count, before, 'the copy merges back onto the hand stack');
  assert.equal(bird.count, 1);
  const text = toasts.join('\n');
  assert.match(text, /幻影/);
  assert.match(text, /不能部署在该地块，已退回整备区/);
  assert.doesNotMatch(text, /下回合返还/);
  h.invariants();
});

test('a summon swapped onto a melee tile stays, with its facing', (t) => {
  const { h, ps } = prep(t);
  const night = deployOwner(h, ps, 10, 5);
  const bird = placeOne(h, ps, night, 11, 5, 'DOWN');
  const left = stackOf(ps, night).count;
  const toasts = watch(h.m);
  assert.deepEqual(move(h, night, board(11, 5), 'LEFT'), { ok: true });
  assert.equal(ps.board.get('11,5'), night);
  assert.equal(ps.board.get('10,5'), bird);
  assert.equal(bird.dir, 'DOWN');
  assert.equal(stackOf(ps, night).count, left, 'a still-legal summon is not returned onto the stack');
  assert.ok(!toasts.some((s) => s.includes('不能部署在该地块')));
  h.invariants();
});

test('full character hand and equipment row: the returned summon waits in overflow, not "next round"', (t) => {
  const { h, ps } = prep(t);
  const night = deployOwner(h, ps, 10, 6);
  const placed = placeAll(h, ps, night);
  const swapped = placed[0];
  const stayed = placed[1];
  assert.equal(ps.board.get('11,5'), swapped);
  assert.equal(ps.board.get('11,4'), stayed);
  const seen = new Set();
  const fillers = [];
  for (const c of Object.values(ps.gd.raw.chess)) {
    if (!c || c.isGolden || c.isDiy || c.chessId === NIGHT) continue;
    if (h.m.chessExcluded(c) || ps.gd.placeableTokens(c.chessId).length) continue;
    const base = ps.gd.baseIdOf(c.chessId);
    if (seen.has(base) || !h.m.pool.has(base) || h.m.pool.left(base) < 1) continue;
    seen.add(base);
    fillers.push(c.chessId);
    if (fillers.length === ps.hand.length) break;
  }
  assert.equal(fillers.length, ps.hand.length, 'one distinct chess per character-hand slot');
  for (const id of fillers) give(h.m, ps, id);
  assert.ok(!ps.hand.includes(null));
  const items = [];
  for (const rec of Object.values(ps.gd.raw.items || {})) {
    if (!rec?.isGolden || rec.itemType !== 'EQUIP') continue;
    const id = rec.itemId || rec.id;
    if (ps.gd.item(id)) items.push(id);
    if (items.length === GEO.TEMP_SIZE) break;
  }
  assert.equal(items.length, GEO.TEMP_SIZE, 'one distinct golden equipment piece per visible equipment slot');
  for (const id of items) giveItem(h.m, ps, id, 'temp');
  assert.equal(ps.temp.length, GEO.TEMP_SIZE);
  assert.ok(!ps.temp.slice(0, GEO.TEMP_SIZE).includes(null));
  const toasts = watch(h.m);
  assert.deepEqual(move(h, night, board(11, 5)), { ok: true });
  assert.equal(ps.board.get('11,5'), night);
  assert.equal(ps.board.get('10,6'), undefined);
  assert.equal(ps.board.get('11,4'), stayed, 'the summon whose tile is still melee stays');
  assert.equal(ps.board.get('11,3'), placed[2]);
  assert.ok(ps.temp.length > GEO.TEMP_SIZE);
  assert.ok(ps.temp.slice(GEO.TEMP_SIZE).includes(swapped), 'the returned copy is overflow, not destroyed');
  assert.equal(swapped.count, 1);
  const text = toasts.join('\n');
  assert.match(text, /幻影/);
  assert.match(text, /不能部署在该地块，已退回整备区/);
  assert.doesNotMatch(text, /下回合返还/);
  h.invariants();
});

test('another operator swapping onto the summon is still BAD_TILE', (t) => {
  const { h, ps } = prep(t);
  const night = deployOwner(h, ps, 10, 3);
  const bird = placeOne(h, ps, night, 10, 5);
  const otherRec = Object.values(ps.gd.raw.chess).find((c) => c
    && c.position === 'RANGED' && !c.isGolden && !c.isDiy && c.chessId !== NIGHT
    && !h.m.chessExcluded(c) && !ps.gd.placeableTokens(c.chessId).length
    && h.m.pool.left(ps.gd.baseIdOf(c.chessId)) >= 1);
  assert.ok(otherRec, 'a ranged operator with no summons');
  const other = give(h.m, ps, otherRec.chessId, 'board', [10, 6]);
  const res = move(h, other, board(10, 5));
  assert.equal(res.error, ERR.BAD_TILE);
  assert.equal(ps.board.get('10,6'), other);
  assert.equal(ps.board.get('10,5'), bird);
  assert.equal(ps.board.get('10,3'), night);
  h.invariants();
});

test('a tile-class change between rounds returns the summon through the stale deploy map', (t) => {
  const { h, ps } = prep(t);
  const night = deployOwner(h, ps, 10, 3);
  const granted = stackOf(ps, night).count;
  placeOne(h, ps, night, 10, 5);
  ps.tileOverrides['10,5'] = 'ranged';
  ps.invalidateDeployMap();
  ps.recompute();
  assert.equal(ps.board.get('10,5'), undefined);
  assert.equal(stackOf(ps, night).count, granted);
  h.invariants();
  placeOne(h, ps, night, 10, 7);
  ps.tileOverrides['10,7'] = 'none';
  ps.invalidateDeployMap();
  ps.recompute();
  assert.equal(ps.board.get('10,7'), undefined);
  assert.equal(stackOf(ps, night).count, granted);
  h.invariants();
});

test('re-orienting the owner does not lift a summon that is still on a legal tile', (t) => {
  const { h, ps } = prep(t);
  const night = deployOwner(h, ps, 10, 6);
  const bird = placeOne(h, ps, night, 10, 5, 'UP');
  assert.deepEqual(move(h, night, board(10, 6), 'LEFT'), { ok: true });
  assert.equal(night.dir, 'LEFT');
  assert.equal(ps.board.get('10,5'), bird);
  assert.equal(bird.dir, 'UP');
  h.invariants();
});

test('planLayout never assigns the melee summon a ranged tile', (t) => {
  const { h, ps } = prep(t);
  const night = deployOwner(h, ps, 10, 6);
  const bird = placeOne(h, ps, night, 10, 5);
  const plan = planLayout(h.m, ps, [night, bird]);
  const key = plan.get(bird.uid);
  assert.ok(key, 'the summon is placed');
  assert.equal(ps.deployMap().get(key), 'melee');
});
