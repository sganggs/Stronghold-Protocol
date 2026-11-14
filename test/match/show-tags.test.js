import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { VERSIONS } from '../../shared/versions.js';
import { formatShowTags, garrisonShowTags, itemShowTags } from '../../shared/showTags.js';
import { pieceGarrisonTags } from '../../server/match/showTags.js';
import { makeMatch, give, giveItem } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { renderInfo } from '../../public/js/render/app/info.js';
import { Battle } from '../../server/sim/Battle.js';

const version = 'act3autochess@V3_1', raw = getVersionData(version);
const registry = createRegistry({ builtins: false });
registerBuiltins(registry, raw);
function fixture(t, options = {}) {
  const h = makeMatch({ data: raw, version, registry, mode: 'solo', modeId: 'mode_single_12', fake: true, seed: 41, ...options }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  t.after(() => h.m.dispose());
  return h;
}

test('all official dynamic trait slots have an initial value; unresolved future slots show unavailable', () => {
  let covered = 0;
  for (const v of VERSIONS) {
    const data = getVersionData(v.id);
    for (const g of Object.values(data.garrisons)) {
      const text = g.descRaw || g.desc || '';
      if (!text.includes('{showtag_')) continue;
      const values = garrisonShowTags(g);
      assert.ok(Number.isFinite(values?.showtag_value_1), `${v.id} ${g.garrisonId}`);
      assert.doesNotMatch(formatShowTags(text, values), /\{showtag_|—/);
      covered++;
    }
    for (const it of Object.values(data.items)) {
      const text = it.descRaw || it.desc || '';
      if (text.includes('{showtag_')) {
        assert.equal(itemShowTags(it)?.showtag_value_1, 0);
        assert.doesNotMatch(formatShowTags(text, itemShowTags(it)), /\{showtag_|—/);
      }
    }
  }
  assert.equal(covered, 16);
  assert.equal(formatShowTags('<@ba.vup>{showtag_value_1}</> / {showtag_value_2} {0:0%}', { showtag_value_1: 0 }),
    '<@ba.vup>0</> / — {0:0%}');
  assert.equal(formatShowTags('{showtag_value_1}', { showtag_value_1: Infinity }), '—');
});

test('owned traits show next payout and real round counts, without mutating counters or sharing owners', t => {
  const h = fixture(t, { mode: 'coop', modeId: 'mode_multi_normal', humans: 2 }), ps = h.ps('p_0'), other = h.ps('p_1');
  const aurora = give(h.m, ps, 'chess_char_3_07_a', 'board', [10, 4]);
  aurora.meta.gar = { garrison_50_a: { fired: 2, sum: 3 } };
  const vulpis = give(h.m, ps, 'chess_char_3_13_a', 'hand');
  const closure = give(h.m, ps, 'chess_char_5_21_a', 'hand');
  const compare = give(h.m, other, 'chess_char_5_21_a', 'hand');
  Object.assign(ps.round, { gainedChess: 9, spent: 19, refreshes: 7 });
  Object.assign(other.round, { gainedChess: 2 });
  const before = JSON.stringify([ps.round, ps.counters, aurora.meta, vulpis.meta]);
  assert.equal(ps.pieceView(aurora).garrisonTags.garrison_50_a[0], 3);
  assert.equal(ps.pieceView(vulpis).garrisonTags.garrison_74_a[0], 1);
  assert.equal(ps.pieceView(closure).garrisonTags.garrison_125_a[0], 9);
  assert.equal(other.pieceView(compare).garrisonTags.garrison_125_a[0], 2);
  for (const [gid, expected] of [['garrison_36_a', 9], ['garrison_91_a', 7], ['garrison_121_a', 19], ['garrison_128_b', 9], ['garrison_236_b', 7]]) {
    assert.equal(garrisonShowTags(raw.garrisons[gid], { round: ps.round }).showtag_value_1, expected);
  }
  const scouted = h.m._prepBoardUnits(ps).find(u => u.uid === aurora.uid);
  assert.deepEqual(scouted.garrisonTags, ps.pieceView(aurora).garrisonTags);
  assert.deepEqual(renderInfo(scouted).garrisonTags, scouted.garrisonTags);
  assert.deepEqual(ps.battleInput().units.find(u => u.uid === aurora.uid).garrisonTags, ps.pieceView(aurora).garrisonTags);
  assert.equal(JSON.stringify([ps.round, ps.counters, aurora.meta, vulpis.meta]), before);
  ps.round.gainedChess = 0;
  assert.equal(pieceGarrisonTags(ps, closure).garrison_125_a[0], 0);
});

test('upgrade preview follows actual handler payouts, including either legacy or shared progression', t => {
  const h = fixture(t), ps = h.ps('p_0');
  ps.bondCountBonus.kjeragShip = 3; ps.recompute();
  const p = ps.acquireChess('chess_char_3_07_a', { source: 'test' });
  assert.ok(p);
  const gid = 'garrison_50_a';
  for (let i = 0; i < 14; i++) {
    const expected = pieceGarrisonTags(ps, p)[gid][0];
    const before = ps.layers.kjeragShip || 0;
    h.m.dispatch(ps, 'onGain', { piece: p, kind: 'chess', source: 'test' });
    assert.equal((ps.layers.kjeragShip || 0) - before, expected);
  }
});

test('passbook text follows held growth and actual funds granted on use', t => {
  const h = fixture(t), ps = h.ps('p_0');
  const book = giveItem(h.m, ps, 'chess_item_3_15_e_a', 'hand');
  assert.equal(ps.pieceView(book).showTag[0], 0);
  h.m.dispatch(ps, 'onRoundStart', { round: 2 });
  h.m.dispatch(ps, 'onRoundStart', { round: 3 });
  assert.equal(ps.pieceView(book).showTag[0], 2);
  const wearer = give(h.m, ps, 'chess_char_1_06_a', 'board', [10, 4]);
  const funds = ps.funds;
  assert.equal(ps.equip(book.uid, wearer.uid).ok, true);
  assert.equal(ps.funds - funds, 2);
});

test('battle and renderer retain prep values without changing logical frames or RNG', t => {
  const h = fixture(t), ps = h.ps('p_0');
  const carrier = give(h.m, ps, 'chess_char_5_21_a', 'board', [10, 4]);
  ps.round.gainedChess = 9;
  const input = ps.battleInput(), normal = structuredClone(input);
  normal.units.forEach(u => { delete u.garrisonTags; });
  const make = player => {
    const b = new Battle({ fieldId: 'n:p_0', kind: 'normal', seed: 2, players: [player], spawns: [], data: raw,
      log: { info() {}, warn() {}, error() {} } });
    b.start();
    return b;
  };
  const battle = make(input), baseline = make(normal);
  input.units.find(u => u.uid === carrier.uid).garrisonTags.garrison_125_a[0] = 99;
  const unit = battle.fieldMeta().units.find(u => u.uid === carrier.uid);
  assert.equal(renderInfo(unit).garrisonTags.garrison_125_a[0], 9, 'prep values are captured, not aliased');
  for (let i = 0; i < 20; i++) { battle.step(); baseline.step(); }
  assert.deepEqual(battle.snapshot(), baseline.snapshot());
  assert.equal(battle.rng.state(), baseline.rng.state());
});


test('upgrade display reads the shared counter when present, otherwise preserves legacy progression', t => {
  const h = fixture(t), ps = h.ps('p_0');
  const p = give(h.m, ps, 'chess_char_3_07_a', 'hand');
  p.meta.gar = { garrison_50_a: { fired: 6, sum: 12 } };
  assert.equal(pieceGarrisonTags(ps, p).garrison_50_a[0], 0);
  const key = 'garrison:upgrade:chess_char_3_07_a:SERVER_ADD_BOND_UPGRADE_LAYER';
  ps.counters[key] = 13;
  const before = JSON.stringify([ps.counters, p.meta]);
  assert.equal(pieceGarrisonTags(ps, p).garrison_50_a[0], 12);
  ps.shop.slots = [{ kind: 'chess', id: p.id, basePrice: 3, sold: false }];
  assert.equal(ps.privateView().shop.slots[0].garrisonTags.garrison_50_a[0], 12);
  assert.equal(JSON.stringify([ps.counters, p.meta]), before);
});
