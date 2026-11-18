import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { makeMatch, give } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { payKjeragIce } from '../../server/sim/content/bonds/regulation.js';

const version = 'act3autochess@V3_1', data = getVersionData(version);
const registry = createRegistry({ builtins: false }); registerBuiltins(registry, data);
const special = ['eff_acarm045', 'eff_acarm043', 'eff_acarm044', 'eff_acarm042', 'eff_acarm140'];
const items = ps => [...ps.hand, ...ps.temp, ...ps.board.values()].filter(p => p?.kind === 'item');
function fixture(t, seed = 11) {
  const h = makeMatch({ data, version, registry, mode: 'solo', modeId: 'mode_single_12', seed, fake: true }).start();
  h.toPrep(1, { band: 'band_sarkazb' });
  h.m.disabledBonds = [];
  h.ps('p_0').bandId = null;
  t.after(() => h.m.dispose());
  return h;
}

test('every regulation trait and effect references an existing reward pool', () => {
  for (const [name, table] of [['garrisons', data.garrisons], ['effects', data.effects]]) {
    for (const [id, row] of Object.entries(table)) {
      for (const bb of name === 'garrisons' ? [row.bbStr] : (row.buffs || []).map(b => b.bbStr)) {
        for (const v of Object.values(bb || {})) if (typeof v === 'string' && v.startsWith('pool_')) {
          assert.ok(data.choices.pools[v], `${name} ${id}: ${v}`);
        }
      }
    }
  }
});

test('regulation pool members match ordinary, special, ultimate, passenger and ice rewards', () => {
  const effects = id => {
    const p = data.choices.pools[id];
    const ids = p.weighted ? p.weighted.map(([id]) => id) : p.items;
    return ids.map(id => data.items[id].effectId).sort();
  };
  assert.deepEqual(effects('pool_equip_kathe_0'), ['eff_acarm041', ...special].sort());
  assert.deepEqual(effects('pool_equip_rockr'), [...special, 'eff_acarm155'].sort());
  assert.deepEqual(effects('pool_equip_vict'), special.slice().sort());
  assert.deepEqual(effects('pool_equip_pasngr'), ['eff_acarm066', 'eff_acarm050', 'eff_acarm069'].sort());
  assert.deepEqual(effects('pool_equip_kjeragbond2'), ['eff_acarm062']);
});

test('obtaining normal or elite Catherine always grants one hammer from her own pool', t => {
  for (const [id, allowed] of [['chess_char_3_22_a', ['eff_acarm041', ...special]], ['chess_char_3_22_b', [...special, 'eff_acarm155']]]) {
    for (let seed = 1; seed <= 16; seed++) {
      const h = fixture(t, seed), ps = h.ps('p_0'), before = new Set(items(ps).map(p => p.uid));
      assert.ok(ps.acquireChess(id, { source: 'test' }));
      const reward = items(ps).filter(p => !before.has(p.uid));
      assert.equal(reward.length, 1, `${id} seed ${seed}`);
      assert.ok(allowed.includes(data.items[reward[0].id].effectId));
    }
  }
});

test('every weighted reward is reachable, including electric and ultimate hammers', t => {
  const h = fixture(t), original = h.m.rngMeta;
  try {
    for (const id of ['pool_equip_kathe_0', 'pool_equip_rockr', 'pool_equip_pasngr']) {
      const pairs = data.choices.pools[id].weighted, total = pairs.reduce((n, [, w]) => n + w, 0);
      let before = 0;
      for (const [item, weight] of pairs) {
        h.m.rngMeta = () => (before + weight / 2) / total;
        assert.equal(h.m.rollPool(id).id, item);
        before += weight;
      }
    }
  } finally { h.m.rngMeta = original; }
});

test('Passenger actually grants equipment at prep start and Kjerag can pay its fixed ice pool', t => {
  const h = fixture(t), ps = h.ps('p_0');
  const rec = Object.values(data.chess).find(c => !c.isGolden && c.name === '异客');
  give(h.m, ps, rec.chessId, 'board', [10, 4]);
  const before = items(ps).length;
  h.m.dispatch(ps, 'onPrepStart', { round: h.m.round });
  assert.equal(items(ps).length - before, 1);
  assert.ok(['eff_acarm066', 'eff_acarm050', 'eff_acarm069'].includes(data.items[items(ps).at(-1).id].effectId));
  const ice = h.m.rollPool('pool_equip_kjeragbond2');
  assert.equal(data.items[ice.id].effectId, 'eff_acarm062');
  const counters = {}, oldUids = new Set(items(ps).map(p => p.uid));
  assert.equal(payKjeragIce({
    data, bondActive: () => true, layers: () => 100,
    counter: k => counters[k] || 0, setCounter: (k, v) => { counters[k] = v; },
    rollItem: options => h.m.rollItemId(options),
    grantItem: id => ps.acquireItem(id, { source: 'test' }),
  }), 1);
  const reward = items(ps).filter(p => !oldUids.has(p.uid));
  assert.equal(reward.length, 1);
  assert.equal(data.items[reward[0].id].effectId, 'eff_acarm062');
});
