// 同盟盟约速查的 peek（g.peek / m.peek）：除自己外每个座位的按观众裁剪干员名单（状态通道，常开）。
// 浮窗的组合逻辑（flyOpsFor / mergeFlyOps）在 test/ui/team-flyout.test.js；PR #922 的 m.public / m.private
// 划分在 test/match/teammate-flyout.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, ERR } from '../../shared/constants.js';
import { tileKey } from '../../server/match/board.js';
import { makeMatch, give, legalTileFor, chessOfTier } from './harness.js';

const MELEE = (c) => c.position === 'MELEE' && c.profession === 'TANK';

function clearSeat(ps) {
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
}

/** 给该座位放一个场上棋子（取一个合法格位）；返回它占用的格位 key。 */
function place(m, ps) {
  const id = chessOfTier(1, MELEE).find((x) => m.pool.has(x));
  const [r, c] = legalTileFor(m, ps, id);
  give(m, ps, id, 'board', [r, c]);
  return tileKey(r, c);
}

test('g.peek: the snapshot names the other seats only, lean, and never goes to another seat', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 9301, fake: true }).start();
  h.toPrep(1);
  clearSeat(h.ps('p_1'));
  clearSeat(h.ps('p_2'));
  place(h.m, h.ps('p_1'));
  place(h.m, h.ps('p_2'));

  assert.equal(h.m.handle('p_0', { t: 'g.peek', open: true }).ok, true);
  const snap = h.lastTo('p_0', 'm.peek');
  assert.ok(snap, 'the requester got the snapshot');
  assert.equal(typeof snap.seq, 'number');
  assert.deepEqual(Object.keys(snap.ops).sort(), ['p_1', 'p_2'], 'the own seat is m.private boardOps, never here');
  for (const list of Object.values(snap.ops)) {
    assert.equal(list.length, 1);
    for (const u of list) assert.deepEqual(Object.keys(u).sort().filter((k) => !['id', 'golden'].includes(k)), [], `${u.id}: lean`);
  }
  assert.equal(h.lastTo('p_1', 'm.peek'), null, 'a unicast: the mate got nothing');
  assert.equal(h.lastTo('p_2', 'm.peek'), null);
  assert.ok(!JSON.stringify(h.m.publicView()).includes('peek'), 'm.public carries no peek');
  h.m.dispose();
});

test('g.peek: a moved piece pushes nothing; a new / removed board chess pushes that seat', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9302, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  const key = place(h.m, b);
  h.m.handle('p_0', { t: 'g.peek', open: true });
  const n = h.allTo('p_0', 'm.peek').length;
  assert.equal(n, 1, 'the snapshot');

  // 同一批棋子换到别的格子仍是同一份名单：位置不参与签名
  const piece = b.board.get(key);
  const [r2, c2] = legalTileFor(h.m, b, piece.id, new Set([key]));
  b.board.delete(key);
  b.board.set(tileKey(r2, c2), piece);
  h.m.flush();
  assert.equal(h.allTo('p_0', 'm.peek').length, n, 'a move pushes nothing');

  // 再放一个干员：名单变化
  const id2 = chessOfTier(1, MELEE).find((x) => x !== piece.id && h.m.pool.has(x));
  const [r3, c3] = legalTileFor(h.m, b, id2);
  give(h.m, b, id2, 'board', [r3, c3]);
  h.m.flush();
  const frames = h.allTo('p_0', 'm.peek');
  assert.equal(frames.length, n + 1, 'one frame for the changed seat');
  assert.equal(frames.at(-1).seat, 'p_1');
  assert.deepEqual(frames.at(-1).ops.map((u) => u.id).sort(),
    [h.m.gd.chess(piece.id).charId, h.m.gd.chess(id2).charId].sort());

  // 第二个干员离场：名单被替换成更短的那份
  b.board.delete(tileKey(r3, c3));
  h.m.flush();
  assert.deepEqual(h.allTo('p_0', 'm.peek').at(-1).ops, [{ id: h.m.gd.chess(piece.id).charId }]);
  h.m.dispose();
});

test('g.peek: closing drops the subscription, and a later layout change is silent', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9303, fake: true }).start();
  h.toPrep(1);
  const b = h.ps('p_1');
  clearSeat(b);
  place(h.m, b);
  h.m.handle('p_0', { t: 'g.peek', open: true });
  assert.equal(h.m.handle('p_0', { t: 'g.peek', open: false }).ok, true);
  assert.equal(h.m._peekSubs.has('p_0'), false);
  const n = h.allTo('p_0', 'm.peek').length;
  const id2 = chessOfTier(1, MELEE).find((x) => h.m.pool.has(x));
  const [r2, c2] = legalTileFor(h.m, b, id2);
  give(h.m, b, id2, 'board', [r2, c2]);
  h.m.flush();
  assert.equal(h.allTo('p_0', 'm.peek').length, n, 'nothing after the close');
  h.m.dispose();
});

test('g.peek: a round / phase change ends the subscription on the next flush', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9304, fake: true }).start();
  h.toPrep(1);
  h.m.handle('p_0', { t: 'g.peek', open: true });
  h.m.phase = PHASE.COMBAT;
  h.m._flushPeek();
  assert.equal(h.m._peekSubs.has('p_0'), false, 'the glance belonged to the prep phase');

  h.m.phase = PHASE.PREP;
  h.m.handle('p_0', { t: 'g.peek', open: true });
  h.m.round += 1;
  h.m._flushPeek();
  assert.equal(h.m._peekSubs.has('p_0'), false, 'and to that round');
  h.m.dispose();
});

test('g.peek: a disconnect drops the subscription, and a spectator seat is refused like any intent', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, spectators: ['spec'], seed: 9305, fake: true }).start();
  h.toPrep(1);
  h.m.handle('p_0', { t: 'g.peek', open: true });
  assert.equal(h.m._peekSubs.has('p_0'), true);
  h.m.onDisconnect('p_0');
  assert.equal(h.m._peekSubs.has('p_0'), false);

  const r = h.m.handle('spec', { t: 'g.peek', open: true });
  assert.equal(r.error, ERR.SPECTATOR);
  assert.equal(h.m._peekSubs.has('spec'), false);
  h.m.dispose();
});

test('the status channel is always on: every other seat, in a battle window and across boss groups alike', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 9306, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const viewer = h.ps('p_0');
  const mate = h.ps('p_1');

  m.clientCombat = true;
  m.fields = [
    { fieldId: 'n:p_0', kind: 'normal', live: true, cc: true, players: ['p_0'] },
    { fieldId: 'n:p_1', kind: 'normal', live: true, cc: true, players: ['p_1'] },
  ];
  assert.equal(m._peekVisible(viewer, mate), true, 'a roster is not battle state: the own battle does not hide it');
  assert.deepEqual(Object.keys(m._peekSnapshot(viewer, { known: new Map() })), ['p_1'], 'the snapshot carries the mate mid-battle');

  m.fields = [
    { fieldId: 'b1', kind: 'boss', live: true, cc: true, players: ['p_0'] },
    { fieldId: 'b2', kind: 'hidden', live: true, cc: true, players: ['p_1'] },
  ];
  assert.equal(m._peekVisible(viewer, mate), true, 'the other group is still an ally: its roster is status, not battle state');
  assert.deepEqual(Object.keys(m._peekSnapshot(viewer, { known: new Map() })), ['p_1'], 'the snapshot crosses boss groups');
  assert.equal(m._peekVisible(viewer, viewer), false, 'never the own seat');

  viewer.alive = false;
  assert.equal(m._peekVisible(viewer, mate), true, 'an eliminated viewer sees every seat');
  h.m.dispose();
});
