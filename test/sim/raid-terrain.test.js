// Regression checks for 突袭 landing terrain, using the shared server/browser simulation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, flatStage, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { inRange } from '../../server/sim/content/support/index.js';

const HOME = [12, 3];
const ENEMY = [10, 8];
const BONDS = { raidShip: { count: 2, active: true, tier: 1, layers: 0 } };

function scenario(ready, noLanding = false) {
  const stage = flatStage();
  const put = (r, c, glyph) => { stage.rows[r] = stage.rows[r].slice(0, c) + glyph + stage.rows[r].slice(c + 1); };
  // Every tile in the landing search area is high ground or water except the one dry shore tile.
  for (let r = 9; r <= 12; r++) for (let c = 6; c <= 10; c++) put(r, c, 'h');
  put(...ENEMY, 'd');
  put(10, 9, 'r'); // A shooting platform: low ground in the legend, but unavailable to melee.
  if (!noLanding) put(9, 8, 'r');
  const h = makeBattle({
    stage, bonds: BONDS,
    defs: {
      chess: { raider: chessRec({
        id: 'raider', profession: 'WARRIOR', position: 'MELEE', bonds: ['raidShip'],
        rangeGrid: [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]],
        skill: ready ? { spCost: 10, initSp: 10 } : null,
      }) },
      enemies: { enemy_wader: enemyRec({ key: 'enemy_wader', hp: 1e7, speed: 0 }) },
    },
    units: [{ chessId: 'raider', row: HOME[0], col: HOME[1] }],
    enemies: [{ key: 'enemy_wader', pos: ENEMY }],
    setup(b) { b.setObstacle(10, 9, true); },
  });
  h.step();
  assert.equal(h.unit('raider').alive, true);
  assert.equal(h.b.grid.canStand(10, 7), false, 'high ground is not a melee landing tile');
  assert.equal(h.b.grid.canStand(...ENEMY), false, 'water is not a landing tile');
  assert.equal(h.b.grid.canStand(10, 9), false, 'shooting platform is not a melee landing tile');
  return h;
}

for (const ready of [false, true]) {
  const trigger = ready ? 'skill ready' : 'idle for 10 seconds';
  test(`突袭 (${trigger}): skips high ground, water and shooting platforms, landing on dry ground`, () => {
    const h = scenario(ready);
    const u = h.unit('raider');
    h.run(ready ? 0.6 : 11);
    assert.deepEqual([u.tileR, u.tileC], [9, 8], 'the only legal shore tile');
    assert.ok(u.alive && u.deployed && u.ground);
    assert.ok(inRange(u, h.enemy('enemy_wader')), 'the enemy is in range after the jump');
    const landings = h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial);
    assert.equal(landings.length, 1, 'one successful raid redeployment');
    checkInvariants(h.b);
  });

  test(`突袭 (${trigger}): stays deployed when only high ground, water and platforms surround the enemy`, () => {
    const h = scenario(ready, true);
    const u = h.unit('raider');
    h.run(12);
    assert.deepEqual([u.tileR, u.tileC], HOME);
    assert.ok(u.alive && u.deployed, 'no withdrawal without a valid landing');
    assert.equal(h.hooksOf('death').filter((c) => c.unit === u).length, 0);
    assert.equal(h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial).length, 0);
    checkInvariants(h.b);
  });
}
