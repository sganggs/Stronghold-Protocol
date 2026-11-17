import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, highestBondRecord, fitToBudget, FULL_KEEP, achievementRecords, isModdedRecord } from '../../public/js/ui/stats.js';

function record(seed, layers) {
  return buildRecord({ seed, victory: true, roundsPassed: 14, players: [
    { playerId: 'self', alive: true, victory: true, lineup: [{ id: 'chess_self', tier: 3, items: ['item_self'] }],
      bonds: [{ bondId: 'yanShip', active: true, layers }, { bondId: 'egirShip', active: false, layers: 99999 }], stats: {} },
    { playerId: 'other', bonds: [{ bondId: 'lateranoShip', active: true, layers: 99999 }] },
  ] }, { myId: 'self', now: seed });
}

test('peak alliance belongs to the self settlement, excluding inactive bonds and quit snapshots', () => {
  const newest = record(3, 200);
  const old = record(1, 400);
  const quit = { ...record(4, 900), end: 'quit' };
  const peak = highestBondRecord([quit, newest, old]);
  assert.equal(peak.record.id, old.id);
  assert.equal(peak.bond.bondId, 'yanShip');
});

test('compaction retains the peak lineup and equipment past the full-history window, releasing it for a new peak', () => {
  const peak = record(1, 400);
  const recent = Array.from({ length: FULL_KEEP }, (_, i) => record(100 - i, 100));
  const fitted = fitToBudget([...recent, peak]);
  const savedPeak = fitted.find((r) => r.id === peak.id);
  assert.deepEqual(savedPeak.players[0].lineup[0].items, ['item_self']);
  assert.equal(highestBondRecord(fitted).record.id, peak.id);
  const next = fitToBudget([record(101, 500), ...fitted]);
  assert.equal(next.find((r) => r.id === peak.id).compact, true);
});

// a match with gameplay plugins (DESIGN §32.6): the record names its content set
const modded = (rec) => ({ ...rec, content: { cs: 'a'.repeat(64), plugins: ['big-numbers@1.0.0'] } });

test('the peak alliance leaves gameplay-plugin matches out (checklist §二.6) unless 「含插件对局」 takes them in', () => {
  const official = record(1, 400);
  const plugin = modded(record(2, 9000));
  assert.ok(isModdedRecord(plugin) && !isModdedRecord(official));
  assert.equal(highestBondRecord([plugin, official]).record.id, plugin.id, 'the helper itself reads every record (the budget needs it)');
  assert.equal(highestBondRecord(achievementRecords([plugin, official])).record.id, official.id, '成就统计 / 统计数据 by default');
  assert.equal(highestBondRecord(achievementRecords([plugin, official], true)).record.id, plugin.id, 'with 含插件对局');
  assert.equal(highestBondRecord(achievementRecords([plugin])), null, 'only plugin matches: no peak');
  // the storage budget still keeps a plugin match's peak lineup
  const recent = Array.from({ length: FULL_KEEP }, (_, i) => record(100 - i, 100));
  const fitted = fitToBudget([...recent, plugin, official]);
  assert.deepEqual(fitted.find((r) => r.id === plugin.id).players[0].lineup[0].items, ['item_self']);
});
