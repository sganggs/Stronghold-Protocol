// 暴雨 S1 应急迷彩 (第一期, ver-zebra.js): the ally's camouflage buff carries the 'camou' status, so the client
// knows it is 迷彩 and the official zebra_buff_01 loop can stand in for the generic 隐匿 icon (as 乌啾 S2).
// The status is display only: the buff's flags and regen are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = loadData(path.join(ROOT, 'data/versions/act1autochess'), { log: { warn() {}, error() {}, info() {} } });
const DOG = 'enemy_1000_gopro_2';

test('暴雨 S1: the camouflaged ally gets status camou with the buff, and loses it when the buff ends', (t) => {
  setGameData(DATA);
  t.after(() => setGameData(null));
  const tried = [];
  for (const [row, col] of [[11, 4], [9, 4], [10, 3], [11, 3], [9, 3], [11, 5], [9, 5]]) {
    const h = makeBattle({
      data: new DataSource(DATA), seed: 1, timeLimit: 30, autoFinish: false, captureNoisy: true,
      units: [
        { uid: 1, chessId: 'chess_char_2_08_a', row: 10, col: 4, skillIndex: 0, carryState: { sp: 999 } },
        { uid: 2, chessId: 'chess_char_2_08_a', row, col, skillIndex: 1, carryState: { sp: 0, hpPct: 0.2 } },
      ],
      enemies: [{ key: DOG, time: 0, pos: [10, 5], mods: { hpMul: 40 } }],
    });
    const ally = () => h.unit(2);
    let buff = null;
    for (let i = 0; i < 80 && !buff; i++) { h.run(0.1); buff = ally().findBuff('zebra:camou:' + h.unit(1).id); }
    tried.push(`${row},${col}`);
    if (!buff) continue;
    assert.equal(buff.status, 'camou');
    assert.equal(buff.flags.camou, true, 'still camouflage for targeting');
    const on = h.eventsOf('status').filter((e) => e[1] === ally().id && e[2] === 'camou');
    assert.deepEqual(on.map((e) => e[3]), [1], 'one status-on event');
    assert.ok(h.eventsOf('fx').some((e) => e[1] === 'zebraCamou' && e[4].target === ally().id));
    h.run(buff.timeLeft + 0.5);
    assert.equal(ally().findBuff('zebra:camou:' + h.unit(1).id), null);
    assert.deepEqual(h.eventsOf('status').filter((e) => e[1] === ally().id && e[2] === 'camou').map((e) => e[3]), [1, 0]);
    return;
  }
  assert.fail(`no tile put the ally in 暴雨 S1's grid (${tried.join(' ')})`);
});
