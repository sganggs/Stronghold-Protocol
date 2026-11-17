import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function field(id, defense) {
  const h = makeBattle({ autoFinish: false, units: [{ chessId: id, row: 10, col: 5, carryState: { sp: 0 } }],
    defs: { enemies: { probe: enemyRec({ key: 'probe', hp: 1000000, atk: 0, speed: 0, def: 0, res: 0 }) } } });
  h.step();
  const b = h.b, u = h.unit(id), e = h.spawn('probe', { pos: [10, 5] }), hits = [], gauges = [];
  u.atkCd = e.atkCd = 999;
  if (defense === 'dodge') b.addBuff(e, { key: 'dodge', mods: { dodgeArts: 1 } });
  if (defense === 'shield') b.addBuff(e, { key: 'shield', shieldHits: 1 });
  let sourceCalculations = 0, targetCalculations = 0;
  b.on('damageCalculate', c => { if (c.source === u) { sourceCalculations++; c.dmg.amount *= 2; } });
  b.on('damageCalculateTarget', c => { if (c.source === u && c.target === e) targetCalculations++; });
  b.on('damaged', c => { if (c.source === u && c.target === e) (c.type === 'element' ? gauges : hits).push(c); });
  h.run(1.1);
  return { h, b, u, e, hits, gauges, sourceCalculations, targetCalculations };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

for (const id of ['chess_char_6_03_a', 'chess_char_6_03_b']) for (const defense of ['none', 'dodge', 'shield']) test(`Yu blocked-target ${id} pulse is precomputed BUFF/MELEE through ${defense}`, () => {
  const f = field(id, defense), { b, u, e, hits, gauges } = f;
  assert.equal(e.blockedBy, u);
  assert.equal(f.sourceCalculations, 0, 'native AdvancedApplyDamage disables source calculation');
  assert.equal(f.targetCalculations, 1, 'target calculation still applies to precomputed damage');
  assert.equal(gauges.length, 1, 'gauge remains independent of the arts injury');
  const t0 = u.def.talents[0].bb;
  const scale = t0['yu_t_1[enemy].atk_scale'];
  if (defense === 'dodge') assert.equal(hits.length, 0);
  else {
    assert.equal(hits.length, 1);
    assert.equal(hits[0].dmg.calculation, 'precomputed');
    assert.equal(hits[0].dmg.attackType, 'BUFF');
    assert.equal(hits[0].dmg.applyWay, 'MELEE');
    near(hits[0].amount, defense === 'shield' ? 0 : u.s.atk * scale);
  }
  assert.ok(e.elem.burn > 0);
  checkInvariants(b);
  assert.deepEqual(b.errors, []);
});
