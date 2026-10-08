import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { SnapshotBuffer } from '../../public/js/render/interp.js';

for (const placed of [false, true]) test(`user wolf count: Given ${placed ? 'placed' : 'automatic'} pack, When shadows change, Then snapshots carry exact remaining lives`, () => {
  const units = [{ chessId: 'chess_char_3_19_a', row: 12, col: 3, uid: 1 }];
  if (placed) units.push({ kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 11, col: 5, uid: 2 });
  const h = makeBattle({ units, timeLimit: 120,
    defs: { enemies: { enemy_d: enemyRec({ key: 'enemy_d', hp: 1e9, speed: 0, atk: 0 }) } },
    enemies: [{ key: 'enemy_d', pos: [1, 1] }],
  });
  h.run(0.2);
  const w = h.b.allyUnits.find((u) => u.defId === 'token_10028_vigil_wolf');
  const count = () => h.b.snapshot().wolves?.find((entry) => entry[0] === w.id);
  assert.deepEqual(count(), [w.id, 2, 3]);
  h.run(25);
  assert.deepEqual(count(), [w.id, 3, 3]);
  for (const left of [2, 1, 0]) {
    h.b.dealDamage(null, w, { amount: 1e9, type: 'true' });
    assert.deepEqual(count(), [w.id, left, 3]);
  }
  assert.equal(w.alive, false);
  h.run(26);
  assert.deepEqual(count(), [w.id, 1, 3]);
  h.b.retreat(h.unit('chess_char_3_19_a'), { reason: 'expired', permanent: true });
  assert.equal(h.b.snapshot().wolves, undefined, 'owner removal clears the count');
  assert.deepEqual(h.b.errors, []);
});

test('user wolf count: Given adjacent snapshots, When sampling, Then counts stay discrete and missing counts clear', () => {
  const b = new SnapshotBuffer({ delay: 0 });
  const units = [[1, 5, 10, 100, 100, 0, 0, 0, 0]];
  b.push({ t: 1, units, wolves: [[1, 3, 3]] }, 0);
  b.push({ t: 2, units, wolves: [[1, 1, 3]] }, 0.5);
  b.push({ t: 3, units }, 1);
  const out = b.sample(1.9);
  assert.deepEqual(out.get(1).wolves, [3, 3]);
  b.sample(2, out);
  assert.deepEqual(out.get(1).wolves, [1, 3]);
  b.sample(3, out);
  assert.equal(out.get(1).wolves, null);
});
