import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, strategyBadgeIds, achievementRecords } from '../../public/js/ui/stats.js';

const bands = {
  band_amiya: { bandId: 'band_amiya', victorCount: 3, sortId: 1 },
  band_fang: { bandId: 'band_fang', victorCount: 2, sortId: 2 },
};

function record(seed, { bandId = 'band_amiya', victory = true, difficulty = 'HARD', modeId = 'mode_multi_hard' } = {}) {
  return buildRecord({ seed, victory: true, roundsPassed: 14, difficulty, modeId, hiddenReached: true, hiddenCleared: false,
    players: [
      { playerId: 'self', bandId, victory, alive: victory, roundsPassed: 14, stats: {} },
      { playerId: 'teammate', bandId: 'band_fang', victory: true, alive: true, roundsPassed: 14, stats: {} },
    ],
  }, { myId: 'self', now: seed + 1 });
}

test('special badges require the data threshold of self clears, excluding training, quit and teammate victories', () => {
  const records = [record(1), record(2), record(3, { victory: false }),
    record(4, { difficulty: 'TRAINING' }), record(5, { modeId: 'mode_training_1' }),
    { ...record(6), end: 'quit' },
  ];
  assert.deepEqual(strategyBadgeIds(records, bands), []);
  assert.deepEqual(strategyBadgeIds([...records, record(7)], bands), ['band_amiya'], 'a failed hidden core does not undo successful defense');
  assert.deepEqual(strategyBadgeIds([record(8, { bandId: 'band_fang' }), record(9, { bandId: 'band_fang' })], bands), ['band_fang'], 'read the per-strategy threshold rather than hardcoding three');
});

test('strategy marks leave gameplay-plugin matches out (checklist §二.6) unless 「含插件对局」 takes them in', () => {
  const modded = (rec) => ({ ...rec, content: { cs: 'b'.repeat(64), plugins: ['fast-rounds@2.0.0'] } });
  const records = [record(1), record(2), modded(record(3))];
  assert.deepEqual(strategyBadgeIds(achievementRecords(records), bands), [], 'two official clears of three');
  assert.deepEqual(strategyBadgeIds(achievementRecords(records, true), bands), ['band_amiya'], 'with 含插件对局');
  assert.deepEqual(strategyBadgeIds(achievementRecords([...records, record(4)]), bands), ['band_amiya'], 'a third official clear');
});
