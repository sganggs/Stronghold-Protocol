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

for (const clientCombat of [false, true]) {
  test(`#346 prep watch: a bounty choice refreshes existing teammate and spectator views (clientCombat=${clientCombat})`, (t) => {
    const S = 's_spec';
    // Only the earlier battles are fake; the draft, choice, views and notifications are real.
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, seed: 1, fake: true, clientCombat, spectators: [S] }).start();
    const m = h.m;
    t.after(() => m.dispose());
    assert.ok(h.drive(() => m.phase === PHASE.SP_DRAFT));
    assert.equal(m.round, 3);
    assert.equal(m.sp.family, 'bounty');
    assert.equal(m.spTurn(), 'p_0');
    assert.equal(m.sp.cards[0].name, '悬赏·持续III');
    for (const pid of ['p_1', S]) assert.deepEqual(m.handle(pid, { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true });
    h.flushAll();
    const before = h.lastTo(S, 'm.field');
    const counts = ['p_1', S].map((pid) => [pid, h.allTo(pid, 'm.field').length]);

    assert.deepEqual(m.handle('p_0', { t: 'g.choice', idx: 0 }), { ok: true });
    h.flushAll();
    for (const [pid, count] of counts) {
      const fields = h.allTo(pid, 'm.field');
      assert.equal(fields.length, count + 1, `${pid}: the choice pushes one updated scout view`);
      const after = fields.at(-1);
      assert.deepEqual(after.units, before.units, 'no board, hand or temp piece changed');
      assert.deepEqual(after.effects.map((e) => e.name), [...before.effects.map((e) => e.name), '悬赏·持续III']);
      assert.deepEqual(after.nextEnemies.filter((e) => e.tag === 'bounty').map((e) => [e.enemyKey, e.count]), [['enemy_1272_nhtank', 1]]);
      assert.deepEqual(after.nextEnemies.filter((e) => e.tag !== 'bounty'), before.nextEnemies);
      assert.deepEqual(after, m.prepFieldMeta(h.ps('p_0')), 'the watcher receives the current public view');
      assert.equal(Object.hasOwn(after, 'funds'), false);
      assert.equal(Object.hasOwn(after, 'shop'), false);
    }

    // Exercise dedup even when the player is dirty, rather than just flushing an empty queue.
    m.markPrivate(h.ps('p_0'));
    h.flushAll();
    h.flushAll();
    for (const [pid, count] of counts) assert.equal(h.allTo(pid, 'm.field').length, count + 1, `${pid}: unchanged public content is not pushed again`);
    assert.equal(h.allTo(S, 'm.private').length, 0, 'the spectator never receives private player state');

    assert.deepEqual(m.handle(S, { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true });
    assert.equal(h.allTo(S, 'm.field').length, counts[1][1] + 2, 'an explicit watch still resends the current view');
    assert.equal(h.allTo('p_1', 'm.field').length, counts[0][1] + 1, 'the resend does not duplicate the other watcher\'s view');

    // Shop actions are only legal after the draft ends, in PREP.
    h.toPrep(3);
    h.flushAll();
    const prepCounts = ['p_1', S].map((pid) => [pid, h.allTo(pid, 'm.field').length]);
    assert.deepEqual(m.handle('p_0', { t: 'g.freeze' }), { ok: true });
    h.flushAll();
    for (const [pid, count] of prepCounts) assert.equal(h.allTo(pid, 'm.field').length, count, `${pid}: a shop toggle does not change the scout view`);
    assert.equal(h.allTo(S, 'm.private').length, 0);
    assert.equal(m.errorCount, 0);
  });
}

for (const field of ['effects', 'nextEnemies']) {
  test(`#346 prep watch: ${field} changes alone refresh the existing view`, (t) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 2, seed: 1, fake: true, spectators: ['s_spec'] }).start();
    const m = h.m;
    t.after(() => m.dispose());
    assert.ok(h.drive(() => m.phase === PHASE.SP_DRAFT));
    assert.deepEqual(m.handle('p_0', { t: 'g.choice', idx: 0 }), { ok: true });
    assert.deepEqual(m.handle('s_spec', { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true });
    h.flushAll();
    const before = h.lastTo('s_spec', 'm.field');
    const count = h.allTo('s_spec', 'm.field').length;
    const ps = h.ps('p_0');
    const bounty = ps.bounties[0];
    if (field === 'effects') bounty.roundsLeft--;
    else bounty.card.count++;
    m.markPrivate(ps);
    h.flushAll();

    assert.equal(h.allTo('s_spec', 'm.field').length, count + 1);
    const after = h.lastTo('s_spec', 'm.field');
    assert.deepEqual(after.units, before.units);
    if (field === 'effects') {
      assert.equal(after.effects.at(-1).counter, 1, 'the remaining bounty battles update in place');
      assert.deepEqual(after.nextEnemies, before.nextEnemies);
    } else {
      const enemies = after.nextEnemies.filter((e) => e.tag === 'bounty');
      assert.ok(enemies.every((e) => e.enemyKey === 'enemy_1272_nhtank'));
      assert.equal(enemies.reduce((n, e) => n + e.count, 0), 2, 'both bounty enemies reach the preview');
      assert.deepEqual(after.effects, before.effects);
    }
    assert.equal(h.allTo('s_spec', 'm.private').length, 0);
    assert.equal(m.errorCount, 0);
  });
}
