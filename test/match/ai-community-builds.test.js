import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA } from './harness.js';
import { buildPlaybook } from '../../server/ai/playbook.js';
import { strategyCandidates } from '../../server/ai/strategy.js';

const modeId = 'mode_multi_normal', book = buildPlaybook(DATA, { modeId });
const build = id => book.community.builds.find(b => b.id === id);
const digest = (id = 'band_sciurus') => ({ round: 5, band: { id }, economy: { level: 4 },
  board: [], bench: [], opponents: [], factions: [], availability: {} });
const candidates = (d, b = book) => strategyCandidates(b, d).candidates;
const named = (id, d, b = book) => candidates(d, b).find(c => c.build === id);

test('named builds resolve every current operator/alias, list absence and replace the unsupported two-core annotation', () => {
  const freeze = build('kjerag-freeze'), redeploy = build('kazimierz-redeploy');
  // i18n-ignore: official operator names and community aliases are test data, not UI strings
  const expected = { 初雪: '3_14', 银灰: '4_22', 灵知: '4_13', 耶拉: '3_20', 角峰: '1_02', 空弦: '3_21', 魔王: '4_25',
    归溟幽灵鲨: '5_13', 凛御银灰: '5_14', 妮芙: '5_22', 远牙: '4_20', 砾: '2_12', 瑕光: '3_12', 野鬃: '1_19', 灰毫: '2_18', 焰尾: '4_19', 铃兰: '5_10', 耀骑士临光: '6_17' };
  const members = [...freeze.members, ...redeploy.members];
  for (const [name, suffix] of Object.entries(expected)) {
    const m = members.find(m => m.name === name);
    assert.equal(m.id, `chess_char_${suffix}_a`, name);
    assert.equal(DATA.chess[m.id].name, name);
    assert.ok(DATA.chess[m.id].visible && !DATA.chess[m.id].isGolden);
  }
  assert.deepEqual(members.filter(m => !m.id).map(m => [m.name, m.records]), [['阿斯卡纶', []]]); // i18n-ignore: absent source operator name
  assert.deepEqual(members.filter(m => m.alias).map(m => [m.alias, m.id]), [ // i18n-ignore: source aliases checked below
    ['异鲨', 'chess_char_5_13_a'], ['异银', 'chess_char_5_14_a'], // i18n-ignore: community aliases
  ]);
  assert.ok(!book.community.builds.some(b => b.bonds.includes('kjeragShip') && b.bonds.includes('kazimierzShip')));
  assert.deepEqual(book.community.builds.map(b => b.id).sort(), ['kazimierz-redeploy', 'kjerag-freeze', 'meter-backwards']);
});

test('recipes carry stages, shop timing, sources, weaknesses, substitutes and current official effect evidence', () => {
  for (const [id, sources] of [['kjerag-freeze', 5], ['kazimierz-redeploy', 3]]) {
    const b = build(id);
    assert.equal(b.sources.length, sources); assert.ok(b.sources.every(s => s.startsWith('https://')));
    assert.equal(b.stages.length, 4);
    for (const k of ['preconditions', 'counters', 'avoid', 'substitutes', 'disagreements']) assert.ok(b[k].length);
    assert.ok(b.shopTiming.includes('L4'));
    for (const [kind, rows] of Object.entries(b.mechanics)) for (const r of rows) {
      assert.equal(r.available, true);
      assert.deepEqual(r.bb, DATA[kind][r.id].bb);
      assert.equal(r.source, `data/${kind}.json:${r.id}`);
    }
  }
  assert.equal(build('kjerag-freeze').mechanics.bonds[0].bb.base_ex_damage_scale, 1.35);
  assert.equal(build('kazimierz-redeploy').mechanics.bonds[0].bb.atk_when_born, 0.2);
  assert.equal(build('kazimierz-redeploy').disagreements.length, 4);
  assert.equal(build('kjerag-freeze').disagreements.length, 3);
});

test('draft and prep shortlist both sourced builds with accessible staged IDs and decomposed scores', () => {
  for (const [id, band] of [['kjerag-freeze', 'band_sciurus'], ['kazimierz-redeploy', 'band_mlynar']]) {
    const d = digest(band), c = named(id, d);
    assert.ok(c, id); assert.equal(c.minimumShopLevel, 4); assert.equal(c.status, 'setup');
    assert.equal(c.score, Object.values(c.scoreParts).reduce((a, b) => a + b, 0));
    assert.ok(c.subs.length <= 2); assert.equal(c.stages.length, 4);
    for (const s of c.stages) for (const key of s.keys) assert.ok(book.operators.some(o => o.id === key));
    assert.ok(c.stages[0].keys.every(key => DATA.chess[key].tier <= 3));
    d.round = 1; d.economy.level = 1;
    d.actions = [{ id: 'pick', intent: { t: 'g.band', bandId: band } }];
    assert.equal(named(id, d).choice, 'pick');
  }
});

test('core bans, insufficient distinct main members and shop caps reject a named recipe, including DIY bans', () => {
  const d = digest();
  d.availability = { bannedChess: ['chess_char_4_13_a'] };
  assert.equal(named('kjerag-freeze', d), undefined);
  d.availability = { diyBanned: ['chess_char_3_14_a', 'chess_char_4_22_a'] };
  assert.equal(named('kjerag-freeze', d), undefined);
  d.availability = { disabledBonds: ['kjeragShip'] };
  assert.equal(named('kjerag-freeze', d), undefined);
  d.availability = {};
  assert.equal(named('kjerag-freeze', d, { ...book, maxShopLevel: 3 }), undefined);
  const twoMembers = { ...book, operators: book.operators.filter(o => !o.bonds.includes('kjeragShip') || ['chess_char_3_14_a', 'chess_char_4_13_a'].includes(o.id)) };
  assert.equal(named('kjerag-freeze', d, twoMembers), undefined);
  d.band.id = 'band_mlynar'; d.availability = { bannedChess: ['chess_char_4_20_a'] };
  assert.equal(named('kazimierz-redeploy', d), undefined);
});

test('documented collector/receiver substitutes survive bans; absent members and banned subs never become keys', () => {
  const d = digest();
  d.availability = { bannedChess: ['chess_char_3_14_a'], disabledBonds: ['swiftShip'] };
  const c = named('kjerag-freeze', d);
  assert.ok(c.members.includes('chess_char_4_22_a'));
  assert.ok(!c.members.includes('chess_char_3_14_a'));
  assert.ok(!c.subs.includes('swiftShip'));
  d.band.id = 'band_mlynar'; d.availability = { bannedChess: ['chess_char_2_12_a'] };
  const other = named('kazimierz-redeploy', d);
  assert.ok(other.members.includes('chess_char_3_12_a'));
  assert.ok(!other.members.includes('chess_char_2_12_a'));
  d.availability.bannedChess.push('chess_char_3_12_a');
  assert.equal(named('kazimierz-redeploy', d), undefined);
});

test('held high-tier gift permits lower shop access without inventing future gifts or marking the engine ready', () => {
  const d = digest(); d.economy.level = 3;
  const capped = { ...book, maxShopLevel: 3 };
  d.bench = [{ id: 'chess_char_4_13_b' }];
  const c = named('kjerag-freeze', d, capped);
  assert.equal(c.minimumShopLevel, 3); assert.equal(c.status, 'setup');
  assert.ok(c.members.includes('chess_char_4_13_a'));
  assert.ok(!c.members.includes('chess_char_5_14_a'));
  d.board = [{ id: 'chess_char_3_14_a' }]; d.bonds = [{ bondId: 'kjeragShip', active: true }];
  assert.equal(named('kjerag-freeze', d, capped).status, 'core-held');
});

test('public contention, counters and previous investment affect named-build scores without hidden state', () => {
  const d = digest(), alone = named('kjerag-freeze', d);
  d.opponents = [{ playerId: 'other', bandId: 'band_sciurus', board: [{ id: 'chess_char_3_14_a' }] }];
  const contested = named('kjerag-freeze', d);
  assert.ok(contested.score < alone.score); assert.ok(contested.scoreParts.contention <= -26);
  d.factions = ['INVISIBLE', 'ELEMENT'];
  assert.equal(named('kjerag-freeze', d).coverageRepairs.length, 2);
  const continued = strategyCandidates(book, d, { bonds: [{ id: 'kjeragShip', priority: 5 }] }).candidates.find(c => c.build === 'kjerag-freeze');
  assert.equal(continued.scoreParts.continuity, 14);
  assert.deepEqual(candidates({ ...d, hiddenPool: { anything: 0 } }), candidates(d));
});

test('regeneration follows changed roster/effects and cannot invent missing core members', () => {
  const data = structuredClone(DATA);
  data.bonds.kjeragShip.bb.base_ex_damage_scale = 1.5;
  data.chess.chess_char_4_13_a.visible = false;
  const changed = buildPlaybook(data, { modeId }), b = changed.community.builds.find(b => b.id === 'kjerag-freeze');
  assert.equal(b.available, false); assert.equal(b.mechanics.bonds[0].bb.base_ex_damage_scale, 1.5);
  assert.equal(named('kjerag-freeze', digest(), changed), undefined);
});
