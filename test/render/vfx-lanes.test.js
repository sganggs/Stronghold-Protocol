// test/render/vfx-lanes.test.js — 塔露拉 S3 日冕重烈's 簇火 lanes (render/vfx/lanes.js, history §37.354). The kit moves the
// shots itself and sends one 'heatwave' fx per volley ({ x, y, dir, n } at her tile); the client rebuilds the shots'
// paths from it and the field rect for the official flights (skillfx.js _lanes) and the procedural streaks. The paths
// are checked by hand and against the shots the kit pushes in that very volley (server/sim/content/kits/ops/op-oxi.js
// `volley`: unit.mem.oxiShots) — every facing, the lane window shifted at the field's edge, the 11-tile back limit, the
// exit distance, 过载's wider window — in a normal and a boss field.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heatwaveLanes, LANE_BACK, LANE_EXIT, LANE_SPEED } from '../../public/js/render/vfx/lanes.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { GEO } from '../../shared/constants.js';

const NORMAL = GEO.NORMAL_RECT;   // rows 9…12, columns 0…10
const BOSS = GEO.BOSS_RECT;       // rows 0…5, columns 0…20
const ends = (lanes) => lanes.map((L) => [L.x0, L.y0, L.x1, L.y1]);

describe('heatwaveLanes: the volley\'s paths from the one fx', () => {
  test('the defaults mirror the kit and the data (op-oxi.js WAVE_MAX_BACK, 塔露拉 S3 wave_exit_distance / wave_speed)', () => {
    const b = JSON.parse(readFileSync(new URL('../../data/backups.json', import.meta.url), 'utf8')).units.char_4247_oxi.forms['2/60/7/3']
      .skills.find((s) => s.skillId === 'skchr_oxi_3').bb;
    assert.equal(LANE_EXIT, b.wave_exit_distance);
    assert.equal(LANE_SPEED, b.wave_speed);
    const kit = readFileSync(new URL('../../server/sim/content/kits/ops/op-oxi.js', import.meta.url), 'utf8');
    assert.equal(Number(/const WAVE_MAX_BACK = (\d+);/.exec(kit)?.[1]), LANE_BACK);
  });

  test('facing right: the rows around hers, from the field\'s back edge (or 11 tiles behind her) to 5 past the far edge', () => {
    // 3 lanes around row 10; she stands at column 3: the back edge (0) is nearer than 11 tiles
    assert.deepEqual(ends(heatwaveLanes({ x: 3, y: 10, dir: 'RIGHT', n: 3 }, NORMAL)), [[0, 9, 15, 9], [0, 10, 15, 10], [0, 11, 15, 11]]);
    assert.deepEqual(heatwaveLanes({ x: 3, y: 10, dir: 'RIGHT', n: 3 }, NORMAL).map((L) => [L.len, L.lane]), [[15, 9], [15, 10], [15, 11]]);
    // deep in a boss field: 11 tiles behind her
    assert.deepEqual(ends(heatwaveLanes({ x: 15, y: 2, dir: 'RIGHT', n: 1 }, BOSS)), [[4, 2, 25, 2]]);
  });

  test('left, up and down; the window shifted inside the field at its edge; the whole field when it is narrower', () => {
    assert.deepEqual(ends(heatwaveLanes({ x: 5, y: 11, dir: 'LEFT', n: 1 }, NORMAL)), [[10, 11, -5, 11]], 'left: from the right edge to 0 − 5');
    assert.deepEqual(ends(heatwaveLanes({ x: 5, y: 10, dir: 'UP', n: 5 }, NORMAL)), [3, 4, 5, 6, 7].map((c) => [c, 9, c, 17]), 'up: columns, row 9 to 12 + 5');
    assert.deepEqual(ends(heatwaveLanes({ x: 1, y: 10, dir: 'up', n: 5 }, NORMAL)).map((p) => p[0]), [0, 1, 2, 3, 4], 'shifted right at the left edge');
    assert.deepEqual(ends(heatwaveLanes({ x: 10, y: 12, dir: 'DOWN', n: 5 }, NORMAL)), [6, 7, 8, 9, 10].map((c) => [c, 12, c, 4]), 'down: shifted left, 12 to 9 − 5');
    assert.deepEqual(heatwaveLanes({ x: 3, y: 10, dir: 'RIGHT', n: 13 }, NORMAL).map((L) => L.lane), [9, 10, 11, 12], '过载 13 > the 4 rows');
    assert.deepEqual(heatwaveLanes({ x: 10, y: 0, dir: 'UP', n: 13 }, BOSS).map((L) => L.lane), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  test('options, junk and the rounding of the caster\'s point', () => {
    assert.deepEqual(ends(heatwaveLanes({ x: 15, y: 2, dir: 'RIGHT', n: 1 }, BOSS, { back: 3, exit: 2 })), [[12, 2, 22, 2]]);
    assert.deepEqual(heatwaveLanes({ x: 2.9, y: 10.2, dir: 'RIGHT', n: 1 }, NORMAL).map((L) => [L.x0, L.lane]), [[0, 10]], 'her tile');
    assert.deepEqual(heatwaveLanes({ x: NaN, y: 10, dir: 'RIGHT', n: 3 }, NORMAL), []);
    assert.deepEqual(heatwaveLanes(null, NORMAL), []);
    assert.deepEqual(ends(heatwaveLanes({ x: 3, y: 10, dir: 'sideways', n: 1 }, NORMAL)), [[0, 10, 15, 10]], 'a junk facing is RIGHT');
    assert.equal(heatwaveLanes({ x: 3, y: 10, dir: 'RIGHT', n: 0 }, NORMAL).length, 1, 'at least one lane');
    assert.equal(heatwaveLanes({ x: 10, y: 9, dir: 'UP', n: 99 }, null).length, 21, 'no rect: the whole board, 21 lanes at most');
    assert.deepEqual(ends(heatwaveLanes({ x: 10, y: 9, dir: 'RIGHT', n: 1 }, null)), [[0, 9, 25, 9]]);
  });
});

describe('the lanes are the kit\'s shots (op-oxi.js volley)', () => {
  const OXI = 'char_4247_oxi';
  const dummy = enemyRec({ key: 'enemy_dummy', hp: 1e9, atk: 0, speed: 0, mass: 0 });

  /** Every volley of an S3 cast: [the 'heatwave' fx, the shots the kit pushed for it]. */
  function volleys({ row, col, dir, kind = 'normal', overload = false }) {
    const h = makeBattle({
      kind, defs: { enemies: { enemy_dummy: dummy } }, timeLimit: 600, autoFinish: false, seed: 7,
      units: [{ uid: 1, diy: { slot: 'chess_char_6_diy1_a', charId: OXI, skillIndex: 2 }, elite: true, row, col, dir }],
    });
    h.step();
    const u = h.unit(1);
    const out = [];
    const fx = h.b.fx.bind(h.b);
    h.b.fx = (k, p) => {
      if (k === 'heatwave') out.push([{ ...p }, u.mem.oxiShots.slice(-p.n).map((s) => ({ ...s }))]);
      return fx(k, p);
    };
    h.b.on('tick', () => { if (!u.skill.active && !out.length) { u.skill.gainSp(999); u.skill.activate('test'); } });
    h.runUntil(() => (overload ? u.mem.oxiRain?.over && out.length > 7 : out.length > 0), 30);
    return { h, out };
  }

  const check = (o) => {
    const { h, out } = volleys(o);
    assert.ok(out.length > 0, `${JSON.stringify(o)}: a volley`);
    for (const [ev, shots] of out) {
      const lanes = heatwaveLanes(ev, h.b.rect);
      const kit = shots.map((s) => [s.x, s.y, s.x + s.dx * s.left, s.y + s.dy * s.left]);
      assert.deepEqual(ends(lanes), kit, `${JSON.stringify(o)} n=${ev.n}`);
    }
    return out;
  };

  test('a normal field: every facing, her tile at the field\'s edge and inside it', () => {
    check({ row: 10, col: 3, dir: 'RIGHT' });
    check({ row: 11, col: 8, dir: 'LEFT' });
    check({ row: 12, col: 1, dir: 'UP' });
    check({ row: 9, col: 10, dir: 'DOWN' });
    check({ row: 9, col: 0, dir: 'RIGHT' });
  });

  test('a boss field: the 11-tile back limit, 过载\'s 13 lanes', () => {
    check({ row: 2, col: 15, dir: 'RIGHT', kind: 'boss' });
    check({ row: 4, col: 3, dir: 'LEFT', kind: 'boss' });
    const out = check({ row: 0, col: 10, dir: 'UP', kind: 'boss', overload: true });
    assert.deepEqual([...new Set(out.map(([ev]) => ev.n))], [5, 13], 'normal_half_width 2, then overload_half_width 6');
  });
});
