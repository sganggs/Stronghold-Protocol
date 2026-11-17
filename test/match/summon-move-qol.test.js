// Owner-reported original-game recording, 2026-11-12: moving a summoner retains legal summons.
// Real g.move actions, public/private views and battle inputs; fixture grants only seed the pieces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { DATA, makeMatch, give } from './harness.js';
import { placementContext, canPlace } from '../../public/js/ui/gameLogic/placement.js';

const board = (row, col) => ({ area: 'board', row, col });
const move = (h, piece, to, dir = 'RIGHT') => h.m.handle('p_0', { t: 'g.move', uid: piece.uid, to, dir });
const stackOf = (ps, owner) => [...ps.hand, ...ps.temp].find(p => p?.kind === 'token' && p.ownerUid === owner.uid);
const ctx = (h, ps) => placementContext({ priv: ps.privateView(), stage: h.m.stage, editable: true,
  getChess: id => ps.gd.chess(id), getToken: id => ps.gd.token(id), backups: ps.gd.raw.backups });

function prep(t, data = DATA) {
  const h = makeMatch({ data, mode: 'solo', ...(data.config.version?.id === 'act3autochess@V3_1' ? { modeId: 'mode_single_1' } : {}), seed: 11, seats: [{ seat: 0, playerId: 'p_0', name: 'P0',
    isBot: false, connected: true }] }).start();
  t.after(() => h.m.dispose());
  h.toPrep(1, { band: data.config.version?.id === 'act3autochess@V3_1' ? 'band_sarkazb' : 'band_bldsk' });
  if (data === DATA) h.setStage('act2autochess_m04');
  return { h, ps: h.ps('p_0') };
}

function owner(h, ps, charId) {
  const rec = Object.values(ps.gd.raw.chess).find(r => r.charId === charId && !r.isGolden);
  assert.ok(rec, charId);
  return give(h.m, ps, rec.chessId);
}

for (const version of ['act2autochess', 'act3autochess@V3_1']) {
  test(`${version}: unrestricted summons keep identity, facing, stack counts and battle positions when their owner moves`, t => {
    const { h, ps } = prep(t, version === 'act2autochess' ? DATA : getVersionData(version));
    const cat = owner(h, ps, 'char_4162_cathy');
    const tiles = [...ps.deployMap()].filter(([, cls]) => cls === 'melee').map(([k]) => k.split(',').map(Number));
    assert.ok(tiles.length >= 4);
    assert.deepEqual(move(h, cat, board(...tiles[0])), { ok: true });
    const stack = stackOf(ps, cat);
    assert.ok(stack.count >= 2);
    assert.deepEqual(move(h, stack, board(...tiles[1]), 'LEFT'), { ok: true });
    const key = tiles[1].join(',');
    const placed = ps.board.get(key);
    const before = structuredClone(placed);
    const remaining = stack.count;
    assert.deepEqual(move(h, cat, board(...tiles[2]), 'UP'), { ok: true });
    assert.equal(ps.board.get(key), placed);
    assert.deepEqual(placed, before);
    assert.equal(stackOf(ps, cat)?.count, remaining, 'the unplaced stack gains no extra copy');
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const token = input.units.find(u => u.uid === placed.uid);
    assert.equal(token.ownerUid, cat.uid);
    assert.deepEqual([token.row, token.col, token.dir], [...tiles[1], 'LEFT']);
    const view = ps.privateView().board.find(p => p.uid === placed.uid);
    assert.deepEqual([view.ownerUid, view.row, view.col, view.dir, view.count], [cat.uid, ...tiles[1], 'LEFT', 1]);
    h.invariants();
  });
}

test('range-bound summon stays on a still-valid tile after moving, then returns when the final range excludes it', t => {
  const { h, ps } = prep(t);
  const vigil = owner(h, ps, 'char_427_vigil');
  assert.deepEqual(move(h, vigil, board(10, 4)), { ok: true });
  assert.deepEqual(move(h, stackOf(ps, vigil), board(11, 5), 'DOWN'), { ok: true });
  const wolf = ps.board.get('11,5');
  assert.deepEqual(move(h, vigil, board(10, 3)), { ok: true });
  assert.equal(ps.board.get('11,5'), wolf);
  assert.equal(wolf.dir, 'DOWN');
  assert.equal(stackOf(ps, vigil), undefined);
  h.invariants();
  assert.deepEqual(move(h, vigil, board(10, 7)), { ok: true });
  assert.equal(ps.board.get('11,5'), undefined);
  assert.equal(stackOf(ps, vigil), wolf, 'invalid summon returns exactly once');
  assert.equal(wolf.count, 1);
  h.invariants();
});

for (const wolfCol of [4, 5]) {
  test(`two summoners swap: only the wolf left outside is returned (wolf column ${wolfCol})`, t => {
    const { h, ps } = prep(t);
    const vigil = owner(h, ps, 'char_427_vigil');
    const mlyss = owner(h, ps, 'char_249_mlyss');
    assert.deepEqual(move(h, vigil, board(10, 4)), { ok: true });
    assert.deepEqual(move(h, mlyss, board(10, 5)), { ok: true });
    assert.deepEqual(move(h, stackOf(ps, vigil), board(11, wolfCol)), { ok: true });
    assert.deepEqual(move(h, stackOf(ps, mlyss), board(9, 7)), { ok: true });
    const wolf = ps.board.get(`11,${wolfCol}`), water = ps.board.get('9,7');
    assert.equal(canPlace(ctx(h, ps), vigil.uid, board(10, 5)).ok, true);
    assert.deepEqual(move(h, vigil, board(10, 5)), { ok: true });
    assert.equal(ps.board.get('10,5'), vigil);
    assert.equal(ps.board.get('10,4'), mlyss);
    if (wolfCol === 5) assert.equal(ps.board.get('11,5'), wolf);
    else {
      assert.equal(ps.board.get('11,4'), undefined);
      assert.equal(stackOf(ps, vigil), wolf);
    }
    assert.equal(ps.board.get('9,7'), water);
    h.invariants();
  });
}

for (const dir of ['RIGHT', 'LEFT']) {
  test(`owner swaps onto its wolf, facing ${dir}: reconcile the displaced wolf at the final position`, t => {
    const { h, ps } = prep(t);
    const vigil = owner(h, ps, 'char_427_vigil');
    assert.deepEqual(move(h, vigil, board(10, 4)), { ok: true });
    assert.deepEqual(move(h, stackOf(ps, vigil), board(10, 5)), { ok: true });
    const wolf = ps.board.get('10,5');
    assert.equal(canPlace(ctx(h, ps), vigil.uid, board(10, 5)).ok, true);
    assert.deepEqual(move(h, vigil, board(10, 5), dir), { ok: true });
    assert.equal(ps.board.get('10,5'), vigil);
    if (dir === 'LEFT') {
      assert.equal(ps.board.get('10,4'), wolf);
      assert.equal(stackOf(ps, vigil), undefined);
    } else {
      assert.equal(ps.board.get('10,4'), undefined);
      assert.equal(stackOf(ps, vigil), wolf);
    }
    h.invariants();
  });
}
