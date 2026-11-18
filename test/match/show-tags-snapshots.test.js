import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
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

test('scouting carries owner-specific live tags; shop and reward records retain initial values', t => {
  const h = fixture(t, { mode: 'coop', modeId: 'mode_multi_normal', humans: 2 });
  const ps = h.ps('p_0'), other = h.ps('p_1');
  const a = give(h.m, ps, 'chess_char_3_07_a', 'board', [10, 4]);
  const b = give(h.m, other, a.id, 'board', [10, 4]);
  ps.counters['garrison:upgrade:chess_char_3_07_a:SERVER_ADD_BOND_UPGRADE_LAYER'] = 5;
  const book = giveItem(h.m, ps, 'chess_item_3_15_e_a');
  ps.counters[`passbook:${book.uid}`] = 4;
  const before = JSON.stringify([ps.counters, ps.round, h.m.rngShop.state()]);
  const scout = h.m.prepFieldMeta(ps).units;
  assert.deepEqual(scout.find(u => u.uid === a.uid).garrisonTags, { garrison_50_a: [6] });
  assert.deepEqual(h.m._prepBoardUnits(other).find(u => u.uid === b.uid).garrisonTags, { garrison_50_a: [1] });
  assert.deepEqual(renderInfo(scout.find(u => u.uid === book.uid)).showTag, [4]);
  ps.shop.slots = [{ kind: 'chess', id: a.id, basePrice: 3, sold: false }];
  assert.equal(ps.privateView().shop.slots[0].garrisonTags, undefined);
  assert.equal(JSON.stringify([ps.counters, ps.round, h.m.rngShop.state()]), before);
  const frozen = scout.find(u => u.uid === a.uid);
  frozen.garrisonTags.garrison_50_a[0] = 99;
  assert.deepEqual(h.m._prepBoardUnits(ps).find(u => u.uid === a.uid).garrisonTags, { garrison_50_a: [6] });
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


