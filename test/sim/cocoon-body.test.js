import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { bodyKeys, bodyDist, hitRect } from '../../server/sim/body.js';
import { COLS } from '../../server/sim/constants.js';
import { makeBattle, flatStage, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { leaderStand } from '../../public/js/render/prepfield.js';
import { hitTiles } from '../../public/js/render/pick.js';

const RAW = getVersionData('act3autochess@V3_1');
const keys = ['enemy_9035_acspider', 'enemy_9035_acspider_2'];
const area = { w: 4.95, h: 2.95, dx: 0, dy: 1 };
const tiles = [3, 4, 5].flatMap(r => [8, 9, 10, 11, 12].map(c => [r, c]));
const tileKeys = tiles.map(([r, c]) => r * COLS + c);
const probe = chessRec({ id: 'body_probe', profession: 'SNIPER', rangeGrid: [[0, 0]], skill: null,
  stats: { maxHp: 1e9, atk: 100, blockCnt: 0 } });
const data = new DataSource({ ...RAW, chess: { body_probe: probe } });

function field(key, positions = [], pos = [3, 10]) {
  const h = makeBattle({ data, kind: 'boss', content: 'none', autoFinish: false, timeLimit: 10,
    stage: flatStage({ rows: Object.fromEntries(Array.from({ length: 6 }, (_, r) => [r, 'r'.repeat(COLS)])) }),
    hooks: ['damaged'], captureNoisy: true,
    players: [{ playerId: 'p1', seat: 0, side: 'L', coords: 'field',
      units: positions.map(([row, col], i) => ({ uid: i + 1, kind: 'chess', chessId: 'body_probe', row, col })) }] });
  h.step();
  const e = h.spawn(key, { pos, route: {
    motion: 'WALK', start: pos, end: pos, steps: [{ t: 'wait', s: 9999 }],
  } });
  return { h, e };
}

for (const key of keys) {
  test(`${key}: generated and normalized collider covers 15 tiles, including the top corners`, () => {
    assert.deepEqual(RAW.enemies[key].hitArea, area);
    const { h, e } = field(key);
    assert.deepEqual(e.hitArea, area, 'the generated record reaches a spawned unit');
    assert.deepEqual(bodyKeys(e), tileKeys);
    assert.deepEqual(hitRect(e), { x0: 7.525, x1: 12.475, y0: 2.525, y1: 5.475 });
    assert.equal(bodyDist(e, 12, 5), 0);
    assert.equal(h.b.errorCount, 0);
  });

  test(`${key}: attacks reach every body tile, but not the immediately adjacent tiles`, () => {
    // Move the anchor down one row so all four outside probes fit inside the boss field.
    const body = tiles.map(([r, c]) => [r - 1, c]);
    const outside = [[1, 10], [5, 10], [3, 7], [3, 13]];
    const positions = [...body, ...outside];
    const { h, e } = field(key, positions, [2, 10]);
    h.run(1.5);
    for (let i = 0; i < tiles.length + outside.length; i++) {
      const u = h.unit(i + 1);
      assert.deepEqual([u.tileR, u.tileC], positions[i]);
      assert.ok(u.alive && u.deployed && !u.hidden);
      const hits = h.hooksOf('damaged').filter(c => c.target === e && c.source === u);
      assert.equal(hits.length > 0, i < body.length, `unit ${i + 1} at ${positions[i]}`);
    }
    checkInvariants(h.b);
    assert.equal(h.b.errorCount, 0);
  });

  test(`${key}: radius and grid queries see the body once; centre-based splash keeps its original centre`, () => {
    const { h, e } = field(key);
    h.step(); // populate the enemy spatial index after spawning
    assert.deepEqual(h.b.enemiesInRadius(13.475, 4, 1), [e]);
    assert.deepEqual(h.b.enemiesInRadius(13.6, 4, 1), []);
    assert.deepEqual(h.b.enemiesInRadius(13.475, 4, 1, true), []);
    assert.deepEqual(h.b.enemiesInKeys(tileKeys, null, { canHitFly: true }), [e]);
    assert.deepEqual(hitTiles(10, 3, e.hitArea), tiles, 'client picking uses the same body');
  });
}

test('both cocoon forms use the same 5×3 body in actual solo and co-op wave previews', () => {
  const seen = new Set();
  for (const [waveId, wave] of Object.entries(RAW.waves)) {
    for (const spawn of wave.spawns ?? []) {
      if (!keys.includes(spawn.key) || spawn.tag !== 'boss') continue;
      const start = wave.routes[spawn.routeIndex].start.slice(0, 2);
      const stand = leaderStand([{ enemyKey: spawn.key, boss: true, start }], k => RAW.enemies[k].hitArea, hitTiles);
      const body = bodyKeys({ x: start[1], y: start[0], hitArea: RAW.enemies[spawn.key].hitArea });
      assert.equal(stand.tiles.length, 15);
      assert.deepEqual(stand.tiles.map(([r, c]) => r * COLS + c), body);
      seen.add(`${spawn.key}:${waveId.endsWith('_s') ? 'solo' : 'pair'}`);
    }
  }
  assert.deepEqual([...seen].sort(), keys.flatMap(k => [`${k}:pair`, `${k}:solo`]).sort());
  for (const key of ['enemy_9036_acweb', 'enemy_9037_aceel', 'enemy_9037_aceel_2']) {
    assert.equal(RAW.enemies[key].hitArea, undefined, `${key} is outside this fix`);
  }
});
