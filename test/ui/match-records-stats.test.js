import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATS_VERSION, recordsForStatsTab, aggregateStatsBySeason, highestBondLayers, buildRecord, aggregateStats, migrateStats, compactRecord, exportStats, importStats, emptyStats,
} from '../../public/js/ui/stats.js';

function record(seed, { funds = 100, merges = 2, defeats } = {}) {
  return buildRecord({ victory: true, seed, roundsPassed: 14, difficulty: 'HARD', modeId: 'mode_multi_hard', players: [
    { playerId: 'self', alive: true, victory: true, roundsPassed: 14, stats: { gold: funds, merges, kills: 1000 }, ...(defeats === undefined ? {} : { creditedKills: defeats }) },
    { playerId: 'teammate', alive: true, stats: { gold: 99999, merges: 999 }, creditedKills: 99999 },
  ] }, { myId: 'self', now: seed + 1 });
}

test('three independent single-match maxima use the self row, not totals or teammates', () => {
  const agg = aggregateStats([
    record(1, { funds: 900, merges: 3, defeats: 7 }),
    record(2, { funds: 100, merges: 9, defeats: 12 }),
    record(3, { funds: 300, merges: 2, defeats: 4 }),
  ]);
  assert.deepEqual(agg.maxima, { gold: 900, merges: 9, kills: 12 });
  assert.equal(agg.sums.gold, 1300);
  assert.equal(agg.sums.merges, 14);
  assert.equal(agg.sums.kills, 3000, 'existing wave-owned cumulative counter remains unchanged');
  assert.deepEqual(aggregateStats([record(0, { funds: 0, merges: 0, defeats: 0 })]).maxima, { gold: 0, merges: 0, kills: 0 });
});

test('legacy records contribute funds and promotions without inventing actual kill totals', () => {
  const migrated = migrateStats({ v: 1, records: [record(1, { funds: 700, merges: 8 })] });
  assert.equal(migrated.stats.v, STATS_VERSION);
  assert.equal(migrated.changed, true);
  assert.deepEqual(aggregateStats(migrated.stats.records).maxima, { gold: 700, merges: 8, kills: null });
  for (const bad of [null, -1, 1.5, '10', Infinity, 1e9 + 1]) assert.equal(aggregateStats([record(2, { defeats: bad })]).maxima.kills, null);
  assert.deepEqual(aggregateStats([]).maxima, { gold: null, merges: null, kills: null });
});

test('compaction and JSON export/import retain all three records after replay detail is discarded', () => {
  const compact = compactRecord(record(10, { funds: 515, merges: 6, defeats: 47 }));
  assert.equal(compact.players[0].creditedKills, 47);
  const exported = JSON.parse(JSON.stringify(exportStats({ v: STATS_VERSION, records: [compact] })));
  const imported = importStats(exported, emptyStats());
  assert.deepEqual(aggregateStats(imported.stats.records).maxima, { gold: 515, merges: 6, kills: 47 });
});

test('partial quit data does not set a whole-match record; a settled defeat still does', () => {
  const partial = { ...record(1, { funds: 9999, merges: 99, defeats: 9999 }), end: 'quit' };
  const lost = record(2, { funds: 200, merges: 3, defeats: 11 });
  lost.victory = false;
  lost.players[0].victory = false;
  assert.deepEqual(aggregateStats([partial, lost]).maxima, { gold: 200, merges: 3, kills: 11 });
  assert.equal(aggregateStats([partial, lost]).count, 2, 'existing quit counting rule is unchanged');
});

test('six-card records keep exact unite credits and boss HP percentage across compaction and import', () => {
	const rec = record(1);
	rec.players[0].stats.uniteKills = 17;
	rec.players[0].stats.bossHpPercent = 12;
	rec.players[0].stats.bossDamage = 30;
	rec.players[1].stats.bossDamage = 70;
	const compact = compactRecord(rec);
	const imported = importStats(exportStats({ v: STATS_VERSION, records: [compact] }), emptyStats());
	assert.equal(aggregateStats(imported.stats.records).achievements.uniteKills, 17);
	assert.equal(aggregateStats(imported.stats.records).achievements.bossShare, 12);
	assert.equal(aggregateStats([record(2)]).achievements.uniteKills, null);
	assert.equal(aggregateStats([compactRecord(record(3))]).achievements.bossShare, null);
	const partial = structuredClone(rec);
	delete partial.players[0].stats.bossHpPercent;
	assert.equal(aggregateStats([partial]).achievements.bossShare, null);
});

test('streaks are chronological, mode-specific, broken by early quits, and exclude tests and plugins', () => {
	const rows = Array.from({ length: 7 }, (_, i) => record(i));
	for (const row of rows) row.roomMode = 'coop';
	rows[2].end = 'quit';
	rows[2].roundsPassed = 0;
	rows[2].players[0].roundsPassed = 0;
	rows[3].roomMode = 'solo';
	rows[6].test = true;
	const agg = aggregateStats(rows.reverse());
	assert.equal(agg.achievements.winStreak, 2);
	assert.equal(agg.achievements.streakMode, 'coop');
	assert.equal(aggregateStats([]).achievements.winStreak, null);
});


test('alliance ranking uses highest active layers rather than usage and survives compaction/import', () => {
	const a = record(1), b = record(2);
	a.players[0].bonds = [{ bondId: 'often', layers: 10, active: true }, { bondId: 'peak', layers: 90, active: true }, { bondId: 'inactive', layers: 999, active: false }];
	b.players[0].bonds = [{ bondId: 'often', layers: 20, active: true }];
	b.players[1].bonds = [{ bondId: 'teammate', layers: 999, active: true }];
	const excluded = { ...a, test: true };
	const rows = [compactRecord(a), compactRecord(b), excluded];
	const imported = importStats(exportStats({ v: STATS_VERSION, records: rows }), emptyStats());
	assert.deepEqual(highestBondLayers(imported.stats.records), [['peak', 90], ['often', 20]]);
	assert.deepEqual(highestBondLayers([{ ...a, end: 'quit' }]), []);
});


test('achievement tab scopes to the latest season; past seasons only includes the second-period lower half', () => {
	const old = record(1);
	const current = { ...record(2), version: 'act3autochess@V3_1' };
	const first = { ...record(3), version: 'act1autochess' };
	const rows = [old, current, first];
	assert.deepEqual(recordsForStatsTab(rows, 'overview', 'act1autochess'), [current]);
	assert.deepEqual(recordsForStatsTab(rows, 'overview', 'all'), [current]);
	assert.deepEqual(recordsForStatsTab([old], 'overview', 'all'), []);
	assert.deepEqual(recordsForStatsTab([...rows, { ...record(4), version: 'act2autochess@V2_1' }], 'pastSeasons', 'all'), [old]);
	assert.deepEqual(recordsForStatsTab(rows, 'pastSeasons', 'act3autochess@V3_1'), [old]);
	assert.deepEqual(recordsForStatsTab(rows, 'history', 'act1autochess'), [first]);
});


test('same-id alliances and strategies from different seasons are counted independently', () => {
	const old = record(30);
	old.players[0].bandId = 'shared_strategy';
	old.players[0].usedBondIds = ['shared_bond'];
	old.players[0].bonds = [{ bondId: 'shared_bond', active: true, layers: 100 }];
	const current = structuredClone(old);
	current.id = 'new-season';
	current.version = 'act3autochess@V3_1';
	current.players[0].victory = false;
	current.players[0].bonds[0].layers = 500;
	const groups = aggregateStatsBySeason([old, current, { ...current, id: 'new-season-2' }]);
	assert.equal(groups.length, 2);
	const second = groups.find(g => g.season === 'act2autochess').stats;
	const third = groups.find(g => g.season === 'act3autochess').stats;
	assert.deepEqual(second.bands.shared_strategy, { games: 1, wins: 1 });
	assert.deepEqual(third.bands.shared_strategy, { games: 2, wins: 0 });
	assert.equal(second.bonds.shared_bond.games, 1);
	assert.equal(third.bonds.shared_bond.games, 2);
});
