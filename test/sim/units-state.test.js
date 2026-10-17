// Content units can publish display-only state for their own sprite / HUD (`Unit.publish`, SIM §9). The snapshot
// carries it as `ext: [[id, [[key, value], …]], …]` and no sim state ever reads it: a battle whose units publish
// every tick is byte-identical to the same battle without publishing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, hashOf } from '../helpers/battleHarness.js';

const op = (o = {}) => chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 1, blockCnt: 2 }, skill: null, ...o });
const field = (setup) => makeBattle({
  defs: {
    chess: { t_guard: op() },
    enemies: { enemy_w: enemyRec({ key: 'enemy_w', hp: 1e6, speed: 1 }) },
  },
  units: [{ chessId: 't_guard', row: 9, col: 3 }],
  enemies: [{ key: 'enemy_w', count: 1, pos: [9, 8] }],
  content: 'none',
  setup,
});

/** The unit's row in `snap.ext` as a plain object (empty when the unit published nothing). */
const extOf = (snap, id) => {
  const row = (snap.ext || []).find((e) => e[0] === id);
  return row ? Object.fromEntries(row.slice(1)) : {};
};

test('publish: the snapshot carries the keys, numbers round to two decimals, strings cap, booleans stay', () => {
  const h = field((b) => {
    b.allyUnits[0].publish('stage', 3.14159).publish('label', 'x'.repeat(40)).publish('cooling', true);
  });
  h.step();
  const unit = h.b.allyUnits[0];
  const ext = extOf(h.b.snapshot(), unit.id);
  assert.equal(ext.stage, 3.14);
  assert.equal(ext.label, 'x'.repeat(32));
  assert.equal(ext.cooling, true);
});

test('publish: null clears a key (and the row disappears when the last key goes), garbage clears too', () => {
  const h = field((b) => {
    const u = b.allyUnits[0];
    u.publish('stage', 2).publish('label', 'a');
    u.publish('stage', null);
    u.publish('label', Number.NaN);
  });
  h.step();
  const unit = h.b.allyUnits[0];
  assert.equal(unit.ext.size, 0, 'both keys cleared');
  const snap = h.b.snapshot();
  assert.deepEqual(extOf(snap, unit.id), {});
  assert.equal(snap.ext, undefined, 'no unit publishes ⇒ the snapshot field is absent');
});

test('publish: a bad key is ignored, at most eight keys per unit, a repeat replaces the value', () => {
  const h = field((b) => {
    const u = b.allyUnits[0];
    u.publish('9bad', 1).publish('', 1).publish('ok', 1);
    for (let i = 0; i < 10; i++) u.publish(`k${i}`, i);
    u.publish('ok', 7);
  });
  h.step();
  const unit = h.b.allyUnits[0];
  assert.equal(unit.ext.size, 8, 'the eight slots are k0..k7');
  assert.equal(unit.ext.get('ok'), 7, 'republishing replaces');
  assert.ok(!unit.ext.has('9bad') && !unit.ext.has(''));
});

test('publish: display only — publishing every tick leaves the finished battle identical', () => {
  const plain = field();
  plain.runToEnd(120);
  const chatty = field((b) => {
    b.every(1, () => {
      for (const u of b.allyUnits) u.publish('tick', b.time).publish('label', `t${b.time}`);
    });
  });
  chatty.runToEnd(120);
  assert.deepEqual(chatty.result(), plain.result(), 'the sim never reads ext');
  assert.equal(hashOf(chatty.result()), hashOf(plain.result()));
});
