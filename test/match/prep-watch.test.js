// GitHub #87: watching another board during prep follows its moves. A spectator uses the same prep scout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEO, PHASE } from '../../shared/constants.js';
import { makeMatch, give, legalTileFor, chessOfTier } from './harness.js';

const MELEE = (c) => c.position === 'MELEE' && c.profession === 'TANK';

test('#87 prep watch: seat B moves during prep and seat A\'s view of B changes before combat; a spectator does too', () => {
  const S = 's_spec';
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 8701, fake: true, spectators: [S] }).start();
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
  const piece = give(m, b, id);
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.deepEqual(m.handle(S, { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.equal(m.watchers.get('p_0'), 'n:p_1');
  assert.equal(m.watchers.get(S), 'n:p_1');
  for (const pid of ['p_0', S]) {
    const first = h.lastTo(pid, 'm.field');
    assert.equal(first.fieldId, 'n:p_1');
    assert.equal(first.prep, true);
    const hu = first.units.find((u) => u.uid === piece.uid);
    assert.ok(hu, `${pid}: the piece is held — it scouts as a unit on the hand row`);
    assert.equal(hu.y, GEO.HAND_ROW, `${pid}: on the bench (row 7), not on the field`);
  }
  assert.equal(h.allTo(S, 'm.private').length, 0);
  const beforeA = h.allTo('p_0', 'm.field').length;
  const beforeS = h.allTo(S, 'm.field').length;
  const [r, c] = legalTileFor(m, b, id);
  assert.deepEqual(m.handle('p_1', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: r, col: c }, dir: 'LEFT' }), { ok: true });
  assert.equal(m.phase, PHASE.PREP, 'still prep — the update did not wait for combat');
  for (const [pid, before] of [['p_0', beforeA], [S, beforeS]]) {
    const fields = h.allTo(pid, 'm.field');
    assert.equal(fields.length, before + 1, `${pid}: one new board`);
    const last = fields.at(-1);
    const u = last.units.find((x) => x.uid === piece.uid);
    assert.ok(u, `${pid}: the moved piece is on the watched board`);
    assert.deepEqual([u.x, u.y, u.dir], [c, r, 'LEFT']);
  }
  const n = h.allTo('p_0', 'm.field').length;
  assert.deepEqual(m.handle('p_1', { t: 'g.freeze' }), { ok: true });
  assert.equal(h.allTo('p_0', 'm.field').length, n, 'a shop toggle is not a board change');
  assert.equal(h.allTo(S, 'm.private').length, 0);
  m.dispose();
});
