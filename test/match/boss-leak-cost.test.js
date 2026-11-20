// 规程 Final Assault / Hidden Core: every enemy that reaches a goal costs the team 1 LP (boss and minions alike), not its
// lifePointReduce — the maintainer's first-hand answer of 2026-11-20 (config.finalAssault.leakCostOne, spec flag
// leakCostOne). The covenant versions keep the lpr cost and their spec shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossFieldFlags, bossLeakCostOne } from '../../server/match/finalAssault.js';
import { attachLpMeter } from '../../server/sim/spec.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { DATA } from './harness.js';

const QUIET = { warn() {}, error() {}, info() {} };
const RAW = getVersionData('act3autochess@V3_1', { log: QUIET });

test('only the regulation profile sets leakCostOne; the covenant boss flags keep their shape', () => {
  assert.equal(RAW.config.finalAssault.leakCostOne, true);
  assert.equal(bossLeakCostOne(new GameData(RAW, 'mode_multi_abyss')), true);
  assert.deepEqual(bossFieldFlags(new GameData(RAW, 'mode_multi_abyss')), { layerGainsEnabled: true, leakCostOne: true });
  assert.equal(DATA.config.finalAssault.leakCostOne, undefined);
  assert.deepEqual(bossFieldFlags(new GameData(DATA, 'mode_multi_abyss')), { layerGainsEnabled: false });
  for (const id of ['act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1']) {
    const gd = new GameData(getVersionData(id, { log: QUIET }), 'mode_multi_abyss');
    assert.equal(bossLeakCostOne(gd), false, id);
  }
});

function leakOne(flags, { lpr, counted = true, boss = false }) {
  const h = makeBattle({ kind: 'boss', content: 'none', flags, autoFinish: false });
  const meter = attachLpMeter(h.b);
  const e = h.spawn('e_dummy', { pos: [11, 9] });
  e.lpr = lpr;
  e.counted = counted;
  e.isBoss = boss;
  h.b.leak(e);
  const entry = Object.values(h.b._perPlayer).flatMap((pp) => pp.leaked)[0];
  return { entry, lp: meter.lp };
}

test('leakCostOne: a counted leak costs 1 whatever its lpr, the boss too; an uncounted one 0; without it the lpr', () => {
  const two = leakOne({ leakCostOne: true }, { lpr: 2 });
  assert.equal(two.entry.lpr, 1, 'a minion with lpr 2 is recorded at 1');
  assert.equal(two.lp, 1, 'the LP meter charges 1');
  const zero = leakOne({ leakCostOne: true }, { lpr: 0 });
  assert.equal(zero.entry.lpr, 1, 'lpr 0 still costs 1 when counted, like the normal rounds');
  assert.equal(zero.lp, 1);
  const boss = leakOne({ leakCostOne: true }, { lpr: 2, counted: false, boss: true });
  assert.equal(boss.entry.lpr, 1, 'the leader costs 1');
  assert.equal(boss.lp, 1);
  const part = leakOne({ leakCostOne: true }, { lpr: 1, counted: false });
  assert.equal(part.entry.lpr, 0, 'an uncounted unit (a part, notCountInTotal) costs nothing');
  assert.equal(part.lp, 0);
  const covenant = leakOne({}, { lpr: 2 });
  assert.equal(covenant.entry.lpr, 2, 'covenant boss fields keep the lpr');
  assert.equal(covenant.lp, 2);
});
