import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from './helpers/battleHarness.js';

for (const redeploy of [false, true]) {
  test(`user Given nearer earlier and farther later Laterano ammo users When rmixer reloads${redeploy ? ' after the earlier user redeploys' : ''} Then the latest deployment wins`, () => {
    const h = makeBattle({ units: [
      { chessId: 'chess_char_4_01_a', row: 10, col: 5, skillIndex: 0 },
      { chessId: 'chess_char_1_01_a', row: 10, col: 4, uid: 2 },
      { chessId: 'chess_char_1_01_a', row: 9, col: 4, uid: 3 },
    ], autoFinish: false, captureNoisy: true,
    defs: { enemies: { probe: enemyRec({ key: 'probe', hp: 1e8, speed: 0 }) } } });
    h.step();
    const u = h.unit('chess_char_4_01_a'), near = h.unit(2), far = h.unit(3);
    if (redeploy) {
      h.b.retreat(near, { reason: 'raid' });
      assert.ok(h.b._deploy(near));
    }
    for (const a of [near, far]) {
      assert.ok(a.skill.activate('test', { free: true }));
      a.skill.ammoLeft = 5;
    }
    const e = h.spawn('probe', { pos: [10, 6] });
    assert.ok(u.skill.activate('test', { free: true }));
    h.b.forceAttack(u, [e]);
    h.run(0.5);
    const reloads = h.eventsOf('fx').filter((e) => e[1] === 'reload');
    assert.ok(reloads.length > 0);
    assert.ok(reloads.every((e) => e[4].id === (redeploy ? near : far).id));
  });
}
