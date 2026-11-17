// Performance: a normal battle with ~70 enemies + 10 operators must average < 0.5 ms per tick (DESIGN §11), 1.0 ms when
// process.env.CI is set: the worst case below usually takes 170–250 µs on GitHub's runners and hit 512 µs once on a shared
// windows runner, with the wave in the same job at its usual 192 µs (test/sim/robustness.test.js has the same bar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { getDefaultSource, spawnsFromTemplate } from '../../server/sim/simdata.js';

const ds = getDefaultSource();
const quiet = { error() {}, warn() {} };
const MS_PER_TICK = process.env.CI ? 1.0 : 0.5;
const LINEUP = [
  ['chess_char_1_02_a', 9, 7], ['chess_char_2_09_a', 9, 4], ['chess_char_4_09_a', 12, 5], ['chess_char_3_08_a', 12, 7],
  ['chess_char_1_01_a', 10, 4], ['chess_char_1_03_a', 11, 4], ['chess_char_2_02_a', 12, 4], ['chess_char_2_14_a', 10, 5],
  ['chess_char_5_12_a', 11, 5], ['chess_char_6_13_a', 9, 8],
];

function build(spawns, routes, timeLimit, seed = 7) {
  return new Battle({
    seed, kind: 'normal', stageId: 'act2autochess_m01', routes, spawns, timeLimit, logger: quiet, quiet: true,
    players: [{ playerId: 'p', units: LINEUP.map(([chessId, row, col], i) => ({ uid: i + 1, kind: 'chess', chessId, row, col, abs: true })) }],
  });
}

test(`benchmark: 70-enemy wave (h05) + 10 operators < ${MS_PER_TICK} ms/tick average`, () => {
  const tpl = ds.getWave('act1autochess_h05');
  const { routes, spawns, maxPlayTime } = spawnsFromTemplate(tpl, { mods: { hpMul: 3 } });
  // warm-up (JIT)
  for (let i = 0; i < 2; i++) { const w = build(spawns, routes, maxPlayTime, i + 100); while (!w.finished) w.step(); }
  const b = build(spawns, routes, maxPlayTime);
  let n = 0, maxAlive = 0;
  const t0 = performance.now();
  while (!b.finished) {
    b.step();
    n++;
    if (n % 3 === 0) { b.snapshot(); b.drainEvents(); }
    if (b.enemies.length > maxAlive) maxAlive = b.enemies.length;
  }
  const avg = (performance.now() - t0) / n;
  // eslint-disable-next-line no-console
  console.log(`bench wave: ${n} ticks, total ${b.total} enemies, peak ${maxAlive} alive, avg ${(avg * 1000).toFixed(1)} µs/tick, reason ${b.reason}`);
  assert.ok(b.total >= 60);
  assert.ok(avg < MS_PER_TICK, `avg ${avg} ms/tick`);
});

test(`benchmark: worst case — 70 enemies alive at once + 10 operators < ${MS_PER_TICK} ms/tick`, () => {
  const tpl = ds.getWave('act1autochess_h05');
  const { routes } = spawnsFromTemplate(tpl);
  const keys = ['enemy_1422_lrsldr', 'enemy_1427_lrnazg', 'enemy_1005_yokai', 'enemy_1042_frostd', 'enemy_1425_lrcmra', 'enemy_1040_bombd'];
  const spawns = [];
  for (let i = 0; i < 70; i++) spawns.push({ time: (i % 10) * 0.2, enemyKey: keys[i % keys.length], routeIndex: i % routes.length, mods: { hpMul: 10 } });
  for (let i = 0; i < 2; i++) { const w = build(spawns, routes, 20, 50 + i); while (!w.finished) w.step(); }
  const b = build(spawns, routes, 60);
  let n = 0;
  const t0 = performance.now();
  while (!b.finished && b.time < 40) { b.step(); n++; if (n % 3 === 0) { b.snapshot(); b.drainEvents(); } }
  const avg = (performance.now() - t0) / n;
  // eslint-disable-next-line no-console
  console.log(`bench worst: ${n} ticks, ${b.enemies.length} alive at end, avg ${(avg * 1000).toFixed(1)} µs/tick`);
  assert.ok(avg < MS_PER_TICK, `avg ${avg} ms/tick`);
});
