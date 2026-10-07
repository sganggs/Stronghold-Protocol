import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

function battle(units) {
  const h = makeBattle({ units, autoFinish: false, captureNoisy: true,
    defs: { enemies: { probe: enemyRec({ key: 'probe', hp: 1e8, speed: 0 }) } } });
  h.step();
  return h;
}

for (const [dx, dy, inside] of [[2, 0, true], [-2, 0, true], [0, 2, true], [0, -2, true],
  [1, 1, true], [1.49, 1.49, true], [1.51, 0.51, false]]) {
  test(`user Given Passenger's target offset within its tile When the storm strikes (${dx},${dy}) Then diamond membership is ${inside}`, () => {
    const h = battle([{ chessId: 'chess_char_6_05_a', row: 10, col: 3 }]);
    const u = h.unit('chess_char_6_05_a');
    const e = h.spawn('probe', { pos: [10, 5] });
    e.x = 5.4; e.y = 10.4;
    h.step();
    assert.ok(u.skill.activate('test', { free: true }));
    e.x = 5 + dx; e.y = 10 + dy;
    h.run(0.6);
    const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.tags?.includes('storm'));
    assert.equal(hits.length > 0, inside);
    const storm = h.eventsOf('fx').find((e) => e[1] === 'storm');
    assert.deepEqual(storm.slice(2, 4), [5, 10], 'storm centre is the containing tile centre');
  });
}

test('user Given a storm target at a diamond extreme When lightning bounces Then an enemy outside the storm can still receive the independent chain hit', () => {
  const h = battle([{ chessId: 'chess_char_6_05_a', row: 10, col: 3 }]);
  const u = h.unit('chess_char_6_05_a');
  const first = h.spawn('probe', { pos: [10, 5] });
  h.step();
  assert.ok(u.skill.activate('test', { free: true }));
  first.x = 7;
  const outside = h.spawn('probe', { pos: [11, 7] });
  h.run(0.6);
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.tags?.includes('storm'));
  assert.deepEqual(hits.map((c) => c.target), [first, outside]);
});
