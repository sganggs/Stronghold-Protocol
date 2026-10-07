import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

test('user Given Gladiia tornado enemies at radius 0.9 and 1.25 When the skill ends Then only the inner enemy is pulled but both receive tornado slow', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_4_12_a', row: 10, col: 3 }], autoFinish: false,
    defs: { enemies: { probe: enemyRec({ key: 'probe', hp: 1e8, speed: 0 }) } } });
  h.step();
  const u = h.unit('chess_char_4_12_a');
  h.spawn('probe', { pos: [10, 5] });
  h.step();
  assert.ok(u.skill.activate('test', { free: true }));
  const inner = h.spawn('probe', { pos: [10, 4.1] });
  const outer = h.spawn('probe', { pos: [10, 3.75] });
  h.step();
  assert.ok(inner.findBuff(`glady:slow:${u.id}`));
  assert.ok(outer.findBuff(`glady:slow:${u.id}`));
  u.skill.end('test');
  h.run(0.6);
  assert.ok(inner.x < 4.1, 'inner enemy pulled towards Gladiia');
  assert.equal(outer.x, 3.75, 'outer tornado ring is outside the final net');
});
