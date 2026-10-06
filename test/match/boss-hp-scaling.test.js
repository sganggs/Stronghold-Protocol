import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossPoolHp, SharedBossPool } from '../../server/match/finalAssault.js';
import { makeBattle } from '../helpers/battleHarness.js';

test('Every boss and difficulty uses per-player HP times participants', () => {
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
    const gd = new GameData(DATA, `mode_multi_${difficulty.toLowerCase()}`);
    for (const id of Object.keys(DATA.bosses)) {
      const base = DATA.bosses[id].bloodPoint[difficulty];
      for (const n of [1, 2, 3, 4]) assert.equal(bossPoolHp(gd, id, n), base * n);
      const solo = new GameData(DATA, `mode_single_${difficulty.toLowerCase()}`);
      assert.equal(bossPoolHp(solo, id, 1), base);
    }
  }
});

for (const hidden of [false, true]) {
  test(`R${hidden ? 15 : 14} round pool excludes two departed players`, () => {
    const h = makeMatch({ humans: 4, difficulty: 'HARD', fake: true, instant: false }).start();
    h.toPrep(1);
    const m = h.m;
    m.onLeave('p_2');
    m.onLeave('p_3');
    assert.equal(m.alivePlayers().length, 2);
    assert.equal(h.ps('p_2').alive, false);
    m.round = hidden ? 15 : 14;
    m.teamLp = 50;
    m.bossId = 'boss_1';
    m.hiddenBossId = 'boss_9';
    m._planBossWaves();
    m.startFinalAssault(hidden);
    const id = hidden ? m.hiddenBossId : m.bossId;
    assert.equal(m.bossPool.maxHp, DATA.bosses[id].bloodPoint.HARD * 2);
    m.dispose();
  });
}

test('Legacy scale configuration cannot restore quarter or fixed pools', () => {
  const data = structuredClone(DATA);
  data.config.bossHpScale = { solo: 0.25, aliveScaling: false, aliveFull: 4 };
  for (const modeId of ['mode_single_abyss', 'mode_multi_abyss']) {
    data.config.modes[modeId].bossHpScale = { solo: 0.25, aliveScaling: false, aliveFull: 4 };
    const gd = new GameData(data, modeId);
    const base = data.bosses.boss_8.bloodPoint.ABYSS;
    for (const n of [1, 2, 3, 4]) {
      const expected = base * (gd.isSolo ? 1 : n);
      assert.equal(gd.bossPoolHp('boss_8', n), expected);
      assert.equal(bossPoolHp(gd, 'boss_8', n), expected);
      gd.bossPoolShare = undefined;
      assert.equal(bossPoolHp(gd, 'boss_8', n), expected);
      delete gd.bossPoolShare;
    }
  }
});

test('Only boss HP scales: escorts and hidden-core parts keep their stats', () => {
  for (const kind of ['boss', 'hidden']) {
    const bossKey = kind === 'boss' ? 'enemy_9013_acstmk' : 'enemy_9013_acstmk_2';
    const snapshot = (n) => {
      const h = makeBattle({ kind, content: 'none', sharedBoss: new SharedBossPool(7200000 * n),
        enemies: [{ key: bossKey, tag: 'boss', pos: [3, 10] },
          { key: 'enemy_1427_lrnazg', pos: [2, 10] },
          { key: 'enemy_9014_acstma', pos: [4, 10] }], autoFinish: false });
      h.step();
      return [bossKey, 'enemy_1427_lrnazg', 'enemy_9014_acstma'].map(key => {
        const e = h.enemy(key);
        assert.ok(e, `Spawned ${key}`);
        return { hp: e.s.maxHp, atk: e.s.atk, def: e.s.def };
      });
    };
    const one = snapshot(1), four = snapshot(4);
    assert.equal(four[0].hp, one[0].hp * 4);
    assert.equal(four[0].atk, one[0].atk);
    assert.equal(four[0].def, one[0].def);
    assert.deepEqual(four.slice(1), one.slice(1));
  }
});

test('Disconnected players and AI count; eliminated players do not', () => {
  const h = makeMatch({ humans: 3, bots: 1, fake: true, instant: false }).start();
  h.toPrep(1);
  h.m.onDisconnect('p_1');
  h.ps('p_2').eliminate(1);
  h.m.round = 14;
  h.m._planBossWaves();
  h.m.startFinalAssault(false);
  assert.equal(h.m.alivePlayers().length, 3);
  assert.equal(h.m.bossPool.maxHp, h.m.gd.boss(h.m.bossId).bloodPoint.NORMAL * 3);
  h.m.dispose();
});
