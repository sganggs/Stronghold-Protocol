import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import * as devices from '../../server/sim/content/devices.js';
import { canTargetAlly, canTargetEnemy, enemyStealthed, stealthOffKey } from '../../server/sim/targeting.js';
import { normalizeLegendEntry } from '../../server/sim/grid.js';
import { parseStage } from '../../public/js/render/tiles.js';
import { classifyStage, buildBoard, AREAS } from '../../public/js/render/board3d/layout.js';
import { fallbackTileClass } from '../../public/js/ui/fallbackField.js';
import { terrainInfo } from '../../public/js/ui/gameLogic/terrain.js';

const raw = getVersionData('act3autochess@V3_1');
const stage = raw.stages.act3autochess_m09;
const ground = enemyRec({ key: 'grass_ground', hp: 1e7, atk: 0, speed: 0, range: 8 });
const flyer = enemyRec({ key: 'grass_flyer', hp: 1e7, atk: 0, speed: 0, motion: 'FLY' });
const probe = chessRec({ id: 'grass_probe', stats: { maxHp: 1e7, atk: 0, blockCnt: 0 }, skill: null });
const blocker = chessRec({ id: 'grass_blocker', stats: { maxHp: 1e7, atk: 0, blockCnt: 3 }, skill: null });

function field(units = []) {
  return makeBattle({ stage, content: 'generic', extraContent: [devices], autoFinish: false,
    defs: { chess: { grass_probe: probe, grass_blocker: blocker }, enemies: { grass_ground: ground, grass_flyer: flyer } },
    units, timeLimit: 20 });
}
function spawn(h, key, r, c, motion = 'WALK') {
  return h.spawn(key, { pos: [r, c], route: { motion, start: [r, c], end: [r, c], steps: [{ t: 'wait', s: 99999 }] } });
}

test('m09 keeps the original four-tile L on each half, plus both Boss groups', () => {
  const positions = (r0, r1, c0, c1) => {
    const found = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (stage.rows[r][c] === 'w') found.push([r, c]);
    return found;
  };
  // Directly from pinned level sub_02 (+8 rows) and sub_03, not estimated from the model.
  assert.deepEqual(positions(9, 12, 0, 10), [[9, 7], [10, 7], [11, 6], [11, 7]]);
  assert.deepEqual(positions(9, 12, 11, 20), [[9, 15], [10, 15], [11, 14], [11, 15]]);
  assert.deepEqual(positions(0, 6, 0, 10), [[2, 7], [3, 7], [4, 6], [4, 7]]);
  assert.deepEqual(positions(0, 6, 11, 20), [[2, 13], [3, 13], [4, 13], [4, 14]]);
  assert.equal(stage.tiles.w.special, 'duelGrass');
  assert.equal(normalizeLegendEntry('?', stage.tiles.w).terrain, 'duelGrass', 'tile-key lookup also works with a custom glyph');
});

test('2D, 3D and fallback boards identify the same L and expose its terrain tip', () => {
  const pixi = parseStage(stage);
  const three = classifyStage(stage, AREAS.normal);
  for (const [r, c] of [[9, 7], [10, 7], [11, 6], [11, 7]]) {
    assert.equal(pixi[r][c].glyph, 'w');
    assert.equal(pixi[r][c].mat, 'duelGrass');
    assert.equal(pixi[r][c].h, 0);
    assert.equal(three[r][c].glyph, 'w');
    assert.equal(three[r][c].content, true);
    assert.equal(fallbackTileClass(stage, r, c), 'duel-grass');
    assert.equal(terrainInfo(stage, r, c).key, 'duelGrass');
  }
  const board = buildBoard(stage, { area: AREAS.normal });
  for (const pos of [[9, 7], [10, 7], [11, 6], [11, 7]]) {
    assert.ok(board.terrain.duelGrass.some(p => p[0] === pos[0] && p[1] === pos[1]));
    assert.ok(!board.terrain.smog.some(p => p[0] === pos[0] && p[1] === pos[1]), 'concealment is not exhaust haze');
  }
});

test('both ground sides gain stealth; flyers skip it; leaving only removes the terrain source', () => {
  const h = field([{ chessId: 'grass_probe', row: 10, col: 7 }]);
  h.step();
  const u = h.unit('grass_probe');
  const e = spawn(h, 'grass_ground', 9, 7);
  const air = spawn(h, 'grass_flyer', 11, 7, 'FLY');
  h.step(2);
  assert.equal(devices.terrainAt(h.b, 10, 7), 'duelGrass');
  assert.ok(u.findBuff('terrain:duelGrass'));
  assert.ok(e.findBuff('terrain:duelGrass'));
  assert.equal(canTargetAlly(e, u, true), false);
  assert.equal(canTargetEnemy(u, e), false);
  assert.equal(air.findBuff('terrain:duelGrass'), null);
  h.b.addBuff(u, { key: 'other:stealth', flags: { stealth: true } });
  assert.equal(h.b.relocate(u, 10, 6), true);
  e.x = 8; e.y = 9;
  h.step(2);
  assert.equal(u.findBuff('terrain:duelGrass'), null);
  assert.ok(u.findBuff('other:stealth'));
  assert.equal(u.s.flags.stealth, true);
  assert.equal(e.findBuff('terrain:duelGrass'), null);
  assert.equal(canTargetEnemy(u, e), true);
  checkInvariants(h.b);
  assert.equal(h.b.errorCount, 0);
});

test('a blocked enemy is revealed and regains grass stealth immediately after release', () => {
  const h = field([{ chessId: 'grass_blocker', row: 10, col: 7 }]);
  h.step();
  const u = h.unit('grass_blocker');
  const e = spawn(h, 'grass_ground', 10, 7);
  h.step(2);
  assert.equal(e.blockedBy, u);
  assert.equal(enemyStealthed(e), false);
  assert.equal(canTargetEnemy(u, e), true);
  assert.equal(canTargetAlly(e, u, true), true, 'the hidden blocker remains targetable by the enemy it holds');
  h.b.applyStatus(u, 'stun', { duration: 5, force: true });
  assert.equal(e.blockedBy, null);
  assert.equal(e.findBuff(stealthOffKey('terrain:duelGrass')), null, 'no default three-second delay');
  assert.equal(enemyStealthed(e), true);
  h.b.addBuff(e, { key: 'probe:reveal', flags: { reveal: true } });
  assert.equal(canTargetEnemy(u, e), true, 'reveal still works');
  h.b.removeBuff(e, 'probe:reveal');
  assert.equal(canTargetEnemy(u, e), false);
  assert.equal(h.b.errorCount, 0);
});
