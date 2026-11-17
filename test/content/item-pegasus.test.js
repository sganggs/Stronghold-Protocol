// PRTS 盟约下半: source-less ADDITION, scaled origin input, processed before its parent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function field(helm = 'a', lance = 'a') {
  const h = makeBattle({ autoFinish: false, defs: {
    chess: { carrier: chessRec({ id: 'carrier', stats: { maxHp: 10000, atk: 500 }, skill: null }) },
    enemies: { probe: enemyRec({ key: 'probe', hp: 1000000, def: 0, res: 0, atk: 0, speed: 0 }) },
  }, units: [{ uid: 'carrier', chessId: 'carrier', row: 10, col: 3,
    items: [`chess_item_5_09_e_${helm}`, `chess_item_6_01_e_${lance}`] }] });
  h.step();
  const b = h.b, u = h.unit('carrier'), e = h.spawn('probe', { pos: [10, 7] }), applied = [];
  u.atkCd = 999;
  b.on('damageApplied', c => { if (c.target === e) applied.push(c); });
  return { h, b, u, e, applied };
}
const hit = (f, extra = {}) => f.b.dealDamage({ source: f.u, target: f.e, amount: 1000, type: 'phys', ...extra });
const done = f => { checkInvariants(f.b); assert.deepEqual(f.b.errors, []); };

for (const helm of ['a', 'b']) for (const lance of ['a', 'b']) test(`Pegasus ${helm}/${lance} uses scaled input and independent source/credit before the parent`, () => {
  const f = field(helm, lance), { b, u, e, applied } = f;
  b.addBuff(u, { key: 'source', mods: { dmgDealtMul: 2 } });
  b.addBuff(e, { key: 'target', mods: { defFlat: 900, dmgTakenMul: 2 } });
  assert.equal(hit(f), 400, '100 primary after DEF, source ×2 and target ×2');
  assert.equal(applied.length, 2, 'one child, no recursive item trigger');
  assert.equal(applied[0].source, null);
  assert.equal(applied[0].credit, u);
  assert.equal(applied[0].dmg.attackType, 'ADDITION');
  assert.equal(applied[0].dmg.type, 'true');
  assert.equal(applied[0].dmg.origin, applied[1].dmg, 'parent relation does not pretend the child has a source');
  assert.equal(applied[0].amount, 600, '1000 ×30% × target 2, without source 2');
  assert.equal(applied[1].source, u);
  assert.equal(u.stats.dmg, 1000);
  assert.equal(e.hp, e.s.maxHp - 1000);
  done(f);
});

test('Pegasus reads source calculation and target arts addition once, before resistance', () => {
  const f = field(), { b, u, e, applied } = f;
  b.addBuff(e, { key: 'target', mods: { resFlat: 90, artsAttackAddition: 200 } });
  b.on('damageCalculate', c => { if (c.source === u) c.dmg.amount *= 2; });
  assert.ok(Math.abs(hit(f, { type: 'arts' }) - 220) < 1e-9);
  assert.equal(applied[0].amount, 660, '(1000 ×2 +200) ×30%, without RES');
  assert.equal(applied[1].dmg.amount, 2200);
  done(f);
});

for (const defense of ['shield', 'barrier', 'dodge']) test(`Pegasus child precedes parent ${defense}`, () => {
  const f = field(), { b, e } = f;
  if (defense === 'shield') b.addBuff(e, { key: 'defense', shieldHits: 1 });
  if (defense === 'barrier') b.addBuff(e, { key: 'defense', shield: 1100 });
  if (defense === 'dodge') b.addBuff(e, { key: 'defense', mods: { dodgePhys: 1 } });
  assert.equal(hit(f), defense === 'shield' ? 1000 : defense === 'barrier' ? 200 : 0);
  assert.equal(e.s.maxHp - e.hp, defense === 'shield' ? 1000 : defense === 'barrier' ? 200 : 300);
  done(f);
});

test('Pegasus child can kill before the parent while keeping carrier credit', () => {
  const f = field();
  f.e.hp = 100;
  assert.equal(hit(f), 0);
  assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].source, null);
  assert.equal(f.u.stats.kills, 1);
  assert.equal(f.u.stats.dmg, 100);
  done(f);
});

test('Pegasus excludes ADDITION, HP loss, gauges and source-less credit, independently of descriptive item tags', () => {
  const f = field(), { b, u, e, applied } = f;
  hit(f, { attackType: 'ADDITION', type: 'true' });
  b.dealHPLose({ source: u, target: e, amount: 100 });
  b.dealElementDamage({ source: u, target: e, amount: 1, element: 'burn' });
  b.dealDamage({ source: null, credit: u, target: e, amount: 100, type: 'true' });
  assert.equal(applied.filter(c => c.dmg.tags.includes('item:pegasus')).length, 0);
  hit(f, { tags: ['item'], attackType: 'NORMAL' });
  assert.equal(applied.filter(c => c.dmg.tags.includes('item:pegasus')).length, 1);
  done(f);
});

for (const calculation of ['precomputed', 'resolved']) test(`Pegasus ${calculation} input retains its supplied origin basis`, () => {
  const f = field();
  f.b.addBuff(f.e, { key: 'defense', mods: { defFlat: 100 } });
  assert.equal(hit(f, { amount: 200, calculation }), calculation === 'resolved' ? 200 : 100);
  assert.equal(f.applied[0].amount, 60);
  done(f);
});

test('Pegasus origin basis excludes the post-mitigation instance multiplier', () => {
  const f = field();
  assert.equal(hit(f, { mul: 2 }), 2000);
  assert.equal(f.applied[0].amount, 300);
  done(f);
});
