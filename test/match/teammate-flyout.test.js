// 同盟盟约速查浮窗（PR #922 批注），服务端：名册必须按观众裁剪。
//   * m.public 是面向所有座位与观战席的一条广播，绝不能携带按座位裁剪的名册
//     （players[].boardOps 会送到观战席，而观战席只被 g.watch 接纳——test/match/watch-bonds.test.js 对
//     players[].bonds 记录了同一规则）。
//   * m.private（单席）携带自己的 boardOps：只含场上棋子，精简 { id, golden? }，不含手牌 / 暂存 / 装备 /
//     召唤物 / 坐标 / standInFor，淘汰后为 []。
// 队友的名册改走状态通道（g.peek / m.peek，test/match/peek.test.js）；与屏上侦察 / 战场视图的合并在
// test/ui/team-flyout.test.js。
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
