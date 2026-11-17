import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VERSIONS } from '../../shared/versions.js';
import { getVersionData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { bodyKeys, colliderKeys, hitRect } from '../../server/sim/body.js';
import { COLS } from '../../server/sim/constants.js';
import { hitTiles } from '../../public/js/render/pick.js';
import { leaderStand } from '../../public/js/render/prepfield.js';
import { makeBattle, flatStage, chessRec, checkInvariants } from '../helpers/battleHarness.js';

// Independent root Collider2D measurements, not a copy of the generator's HIT_AREAS map.
const measured = JSON.parse(fs.readFileSync(new URL('../../docs/research/boss-hit-areas-20261112.json', import.meta.url)));
const byPrefab = new Map(measured.prefabs.map(row => [row.prefab, row]));
const raw = getVersionData('act3autochess@V3_1');
const fixes = ['enemy_9029_acfnc', 'enemy_9029_acfnc_2', 'enemy_2123_dyjsww'];

test('every shipped Boss matches the official root hit collider, including shared normal/hidden prefabs', () => {
  const seen = new Set();
  for (const version of VERSIONS) {
    for (const enemy of Object.values(getVersionData(version.id).enemies)) {
      if (enemy.rank !== 'BOSS') continue;
      const prefab = enemy.spine || enemy.key;
      const record = byPrefab.get(prefab);
      assert.ok(record, `missing official body measurement: ${version.id}/${prefab}`);
      assert.deepEqual(enemy.hitArea ?? null, record.hitArea, `${version.id}/${enemy.key}`);
      seen.add(prefab);
    }
  }
  assert.deepEqual([...seen].sort(), [...byPrefab.keys()].sort(), 'fixture covers exactly the shipped Boss catalog');
});

const probe = chessRec({ id: 'hit_probe', profession: 'SNIPER', rangeGrid: [[0, 0]], skill: null,
  stats: { maxHp: 1e9, atk: 100, blockCnt: 0 } });
const data = new DataSource({ ...raw, chess: { hit_probe: probe } });

for (const key of fixes) {
  const mech = key !== 'enemy_2123_dyjsww';
  const tiles = mech
    ? [2, 3, 4].flatMap(r => [8, 9, 10, 11, 12].map(c => [r, c]))
    : [1, 2, 3].flatMap(r => [9, 10, 11].map(c => [r, c]));
  const outside = mech ? [[1, 10], [5, 10], [3, 7], [3, 13]] : [[0, 10], [4, 10], [2, 8], [2, 12]];
  const positions = [...tiles, ...outside];
  const expected = tiles.map(([r, c]) => r * COLS + c);

  test(`${key}: actual attacks reach all official body tiles and reject all four outside edges`, () => {
    const h = makeBattle({ data, kind: 'boss', content: 'none', autoFinish: false, timeLimit: 10,
      stage: flatStage({ rows: Object.fromEntries(Array.from({ length: 6 }, (_, r) => [r, 'r'.repeat(COLS)])) }),
      hooks: ['damaged'], captureNoisy: true,
      players: [{ playerId: 'p1', seat: 0, side: 'L', coords: 'field',
        units: positions.map(([row, col], i) => ({ uid: i + 1, kind: 'chess', chessId: 'hit_probe', row, col })) }] });
    h.step();
    const e = h.spawn(key, { pos: [2, 10], route: {
      motion: 'WALK', start: [2, 10], end: [2, 10], steps: [{ t: 'wait', s: 9999 }],
    } });
    h.run(1.5);
    assert.deepEqual(bodyKeys(e), expected);
    assert.deepEqual(colliderKeys(e), expected);
    for (let i = 0; i < positions.length; i++) {
      const source = h.unit(i + 1);
      assert.deepEqual([source.tileR, source.tileC], positions[i]);
      const hits = h.hooksOf('damaged').filter(c => c.target === e && c.source === source);
      assert.equal(hits.length > 0, i < tiles.length, `${key}: attacker at ${positions[i]}`);
    }
    assert.deepEqual(h.b.enemiesInKeys(expected, null, { canHitFly: true }), [e], 'spatial index returns one enemy');
    const rect = hitRect(e);
    const y = (rect.y0 + rect.y1) / 2;
    assert.deepEqual(h.b.enemiesInRadius(rect.x1 + 1, y, 1), [e]);
    assert.deepEqual(h.b.enemiesInRadius(rect.x1 + 1.1, y, 1), []);
    assert.deepEqual(h.b.enemiesInRadius(rect.x1 + 1, y, 1, true), [], 'centre-based splash keeps its old origin');
    assert.deepEqual(hitTiles(10, 2, e.hitArea), tiles, 'client hit picking agrees');
    assert.deepEqual([e.x, e.y], [10, 2], 'hit body does not move the unit');
    checkInvariants(h.b);
    assert.equal(h.b.errorCount, 0);
  });
}

test('both mech forms have the complete body in real single-player and co-op wave previews', () => {
  const seen = new Set();
  for (const [waveId, wave] of Object.entries(raw.waves)) {
    for (const spawn of wave.spawns ?? []) {
      if (!fixes.slice(0, 2).includes(spawn.key) || spawn.tag !== 'boss') continue;
      const start = wave.routes[spawn.routeIndex].start.slice(0, 2);
      const area = raw.enemies[spawn.key].hitArea;
      const stand = leaderStand([{ enemyKey: spawn.key, boss: true, start }], k => raw.enemies[k].hitArea, hitTiles);
      assert.equal(stand.tiles.length, 15);
      assert.deepEqual(stand.tiles.map(([r, c]) => r * COLS + c), bodyKeys({ x: start[1], y: start[0], hitArea: area }));
      seen.add(`${spawn.key}:${waveId.endsWith('_s') ? 'solo' : 'pair'}`);
    }
  }
  assert.deepEqual([...seen].sort(), fixes.slice(0, 2).flatMap(k => [`${k}:pair`, `${k}:solo`]).sort());
});

test('moving 后兽 keeps its centred body; 矩兽 and 鳍 retain their small root colliders', () => {
  const hitArea = raw.enemies.enemy_2123_dyjsww.hitArea;
  const unit = { x: 10, y: 2, hitArea };
  const before = bodyKeys(unit);
  unit.x += 1;
  assert.deepEqual(bodyKeys(unit), before.map(k => k + 1));
  unit.x += 0.25;
  assert.equal(hitRect(unit).x0, unit.x - 1.475, 'body follows continuous movement, without grid snapping');
  for (const key of ['enemy_2124_dyjsfg', 'enemy_9037_aceel', 'enemy_9037_aceel_2']) {
    assert.equal(raw.enemies[key].hitArea, undefined, key);
  }
});
