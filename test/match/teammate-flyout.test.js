// 同盟盟约速查 flyout, server side (PR #922 review): the roster's operator lists must follow g.watch.
//   * m.public is one broadcast for every seat and the spectator bench. It must never carry a per-seat roster
//     (players[].boardOps would let a viewer see the other group, or a teammate still in battle, which g.watch
//     refuses — test/match/watch-bonds.test.js documents the same rule for players[].bonds).
//   * m.private (one seat) carries its own boardOps: docker board chess only, lean { id, golden? }, nothing from
//     the hand / temp area / equipment / summons / coordinates / standInFor, and [] once eliminated.
// The viewer-side merge (own m.private + the scout / battle field on screen) is test/ui/team-flyout.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileKey } from '../../server/match/board.js';
import { makeMatch, give, giveItem, legalTileFor, chessOfTier, DATA } from './harness.js';

const MELEE = (c) => c.position === 'MELEE' && c.profession === 'TANK';
const row = (h, pid) => h.m.publicView().players.find((p) => p.playerId === pid);

function clearSeat(b) {
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) {
    if (p.kind === 'chess') b.returnCopies(p);
  }
  b.board.clear();
  b.hand.fill(null);
  b.temp.fill(null);
  b.recompute();
}

test('m.public never carries boardOps (one broadcast cannot follow g.watch); m.private carries only the own seat', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9221, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  const id = chessOfTier(1, MELEE).find((x) => h.m.pool.has(x));
  const [r, c] = legalTileFor(h.m, b, id);
  give(h.m, b, id, 'board', [r, c]);

  const pub = h.m.publicView();
  assert.ok(Array.isArray(row(h, 'p_1').bonds), 'bonds stay public (they never carried operators)');
  for (const p of pub.players) assert.ok(!('boardOps' in p), `${p.playerId}: m.public must not list operators`);
  assert.ok(!JSON.stringify(pub).includes('boardOps'), 'no boardOps anywhere in the broadcast');

  const priv = b.privateView();
  assert.equal(priv.boardOps.length, 1, 'the own board chess is there');
  const other = h.ps('p_0').privateView();
  assert.ok((other.boardOps || []).every((u) => u.id !== priv.boardOps[0]?.id), 'another seat does not get this list');
  h.m.dispose();
});

test('m.private.boardOps: board chess only, lean fields; hand / temp / items / summons / coords / standInFor stay out', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9222, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  const id = chessOfTier(1, MELEE).find((x) => h.m.pool.has(x));
  const [r, c] = legalTileFor(h.m, b, id);
  give(h.m, b, id, 'board', [r, c]);
  // a second board chess with an elite flag, plus a hand operator, a hand item and a token on the board
  const goldenId = h.m.gd.chess(id).goldenId;
  const [r2, c2] = legalTileFor(h.m, b, goldenId);
  give(h.m, b, goldenId, 'board', [r2, c2]);
  const handId = chessOfTier(1, (x) => x.position !== 'MELEE').find((x) => h.m.pool.has(x));
  give(h.m, b, handId);
  const itemId = Object.values(DATA.items).find((x) => x?.id)?.id;
  giveItem(h.m, b, itemId);
  const [r3, c3] = legalTileFor(h.m, b, id);
  b.board.set(tileKey(r3, c3), b.newPiece('token', Object.keys(DATA.tokens)[0]));
  b.recompute();

  const ops = b.privateView().boardOps;
  assert.equal(ops.length, 2, 'board chess only: the hand operator, the item and the summon token are not operators on the field');
  for (const u of ops) assert.deepEqual(Object.keys(u).sort().filter((k) => !['id', 'golden'].includes(k)), [], `${u.id}: lean`);
  const goldenOp = ops.find((u) => u.golden);
  assert.ok(goldenOp, 'the elite bit is kept');
  assert.equal(goldenOp.id, h.m.gd.chess(goldenId).charId, 'the field record char id, not the chess id');
  h.m.dispose();
});

test('m.private.boardOps of an eliminated seat: [] (a spectator cannot watch them)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9223, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  const id = chessOfTier(1, MELEE).find((x) => h.m.pool.has(x));
  const [r, c] = legalTileFor(h.m, b, id);
  give(h.m, b, id, 'board', [r, c]);
  assert.equal(b.privateView().boardOps.length, 1);
  b.eliminate(1);
  assert.deepEqual(b.privateView().boardOps, []);
  assert.equal(row(h, 'p_1').alive, false);
  h.m.dispose();
});
