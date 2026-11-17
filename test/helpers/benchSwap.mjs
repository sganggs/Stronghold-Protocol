import assert from 'node:assert/strict';
import { getVersionData, setData } from '../../server/data.js';
import { installOfficialBounds, officialBoundsOf } from '../../shared/plugins/officialBounds.js';
import { PHASE } from '../../shared/constants.js';

const version = process.argv[2];
if (!version) process.exit(0);
const data = setData(getVersionData(version, { log: { info() {}, warn() {}, error() {} } }));
installOfficialBounds(officialBoundsOf(data));
const { makeMatch, give, giveItem, legalTileFor } = await import('../match/harness.js');
const { createRegistry } = await import('../../server/match/effectsMeta.js');
const OP = 'chess_char_1_10_a'; // 古米: ground operator in all four versions, no summon cards.

function fixture() {
  const h = makeMatch({ data, mode: 'solo', fake: true, seed: 53, registry: createRegistry() }).start().toPrep();
  const ps = h.ps('p_0');
  for (const p of ps.allChess()) ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.recompute();
  return { h, ps, move: (uid, to) => h.m.handle(ps.playerId, { t: 'g.move', uid, to }) };
}

const { h, ps, move } = fixture();
try {
  const eliteId = h.m.gd.goldenIdOf(OP);
  while (ps.deployCount < ps.deployCap) give(h.m, ps, eliteId, 'board', legalTileFor(h.m, ps, eliteId));
  while (ps.hand.some(p => p == null)) give(h.m, ps, eliteId);
  const [key, otherKey] = [...ps.board.keys()];
  const [row, col] = key.split(',').map(Number);
  const target = { area: 'board', row, col };
  const counts = () => [ps.hand.filter(Boolean).length, ps.deployCount, ps.temp.filter(Boolean).length];
  const expectedCounts = counts();
  const before = ps.privateView();
  const outgoing = ps.board.get(key), incoming = ps.hand[0];
  const forward = move(incoming.uid, target);
  const afterForward = { board: ps.board.get(key).uid, hand: ps.hand[0].uid, counts: counts() };
  const reverse = move(ps.board.get(key).uid, { area: 'hand', idx: 0 });
  console.log(JSON.stringify({ version, forward, reverse, counts: counts() }));
  assert.deepEqual(forward, { ok: true }, 'bench → occupied field at both caps');
  assert.deepEqual(afterForward, { board: incoming.uid, hand: outgoing.uid, counts: expectedCounts });
  assert.deepEqual(reverse, { ok: true }, 'field → occupied bench at both caps');
  assert.equal(ps.board.get(key), outgoing);
  assert.equal(ps.hand[0], incoming);
  assert.deepEqual(counts(), expectedCounts);
  assert.deepEqual(ps.privateView().hand, before.hand, 'round-trip preserves every bench card');

  const first = ps.hand[0], second = ps.hand[1];
  assert.deepEqual(move(first.uid, { area: 'hand', idx: 1 }), { ok: true });
  assert.equal(ps.hand[0], second); assert.equal(ps.hand[1], first);
  const fieldFirst = ps.board.get(key), fieldSecond = ps.board.get(otherKey);
  const [otherRow, otherCol] = otherKey.split(',').map(Number);
  assert.deepEqual(move(fieldFirst.uid, { area: 'board', row: otherRow, col: otherCol }), { ok: true });
  assert.equal(ps.board.get(key), fieldSecond); assert.equal(ps.board.get(otherKey), fieldFirst);
  assert.deepEqual(counts(), expectedCounts);

  const overflow = ps.acquireChess(eliteId, { silent: true });
  const displaced = ps.board.get(key);
  assert.equal(ps.find(overflow.uid).area, 'temp');
  assert.deepEqual(move(overflow.uid, target), { ok: true }, 'temp → occupied field reuses the overflow slot');
  assert.equal(ps.find(displaced.uid).area, 'temp');
  const bench = ps.hand[0];
  assert.deepEqual(move(displaced.uid, { area: 'hand', idx: 0 }), { ok: true }, 'temp ↔ full hand');
  assert.equal(ps.hand[0], displaced);
  assert.equal(ps.find(bench.uid).area, 'temp');
  assert.deepEqual(counts(), [10, ps.deployCap, 1]);

  const empty = legalTileFor(h.m, ps, OP);
  const snapshot = ps.privateView();
  assert.equal(move(ps.hand[0].uid, { area: 'board', row: empty[0], col: empty[1] }).error, 'BOARD_FULL');
  assert.deepEqual(ps.privateView(), snapshot, 'an actual deployment above the cap is atomic');
  for (const phase of Object.values(PHASE).filter(p => p !== PHASE.PREP)) {
    h.m.phase = phase;
    assert.equal(ps.move(ps.hand[0].uid, target).error, 'WRONG_PHASE', phase);
    assert.equal(ps.move(ps.board.get(key).uid, { area: 'hand', idx: 0 }).error, 'WRONG_PHASE', phase);
  }
  h.m.phase = PHASE.PREP;
  ps.ready = true;
  assert.equal(ps.move(ps.hand[0].uid, target).error, 'WRONG_PHASE');
  assert.equal(ps.move(ps.board.get(key).uid, { area: 'hand', idx: 0 }).error, 'WRONG_PHASE');
  ps.ready = false;
  h.invariants();
} finally { h.m.dispose(); }

// Buying / choosing a third copy still requires a free regular slot; a passive gain can merge at capacity.
const f = fixture();
try {
  const { h, ps, move } = f;
  const at = legalTileFor(h.m, ps, OP);
  give(h.m, ps, OP, 'board', at);
  give(h.m, ps, OP);
  const itemIds = Object.keys(data.items).filter(id => !data.items[id].isGolden);
  for (let i = 0; ps.hand.some(p => p == null); i++) giveItem(h.m, ps, itemIds[i]);
  const itemIdx = ps.hand.findIndex(p => p.kind === 'item');
  assert.equal(move(ps.board.get(at.join(',')).uid, { area: 'hand', idx: itemIdx }).error, 'HAND_FULL');
  ps.funds = 100;
  assert.equal(ps.completesChessMerge(OP), true);
  ps.shop.slots[0] = { kind: 'chess', id: OP, basePrice: 1, sold: false };
  ps.offers = [{ source: 'test', slots: [{ kind: 'chess', id: OP, price: 0, sold: false }] }];
  const snapshot = ps.privateView();
  assert.equal(h.m.handle(ps.playerId, { t: 'g.buy', slot: 0 }).error, 'HAND_FULL');
  assert.equal(h.m.handle(ps.playerId, { t: 'g.reward', idx: 0 }).error, 'HAND_FULL');
  assert.deepEqual(ps.privateView(), snapshot, 'refused additions do not spend or consume offers');
  const elite = ps.acquireChess(OP, { silent: true });
  assert.equal(elite.id, h.m.gd.goldenIdOf(OP));
  assert.equal(ps.board.get(at.join(',')), elite, 'passive merge retains the consumed field tile');
  assert.equal(ps.hand.filter(Boolean).length, 9);
  const idx = ps.hand.findIndex(p => p == null);
  assert.deepEqual(move(elite.uid, { area: 'hand', idx }), { ok: true }, 'withdrawal into an actual free slot');
  h.invariants();
} finally { f.h.m.dispose(); }
