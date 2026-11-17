// PRTS special HP: damage-based effects see normal damage; only the final HP delta is one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function fixture(artsOnly = false) {
  const h = makeBattle({ content: 'none', autoFinish: false, units: [{ uid: 'medic', chessId: 'medic', row: 10, col: 5 }],
    defs: { chess: { medic: chessRec({ id: 'medic', profession: 'MEDIC', subProfessionId: 'incantationmedic',
      attackKind: 'ranged', dmgType: 'arts', rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]], skill: null, stats: { maxHp: 10000, atk: 0 } }) },
      enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 10, speed: 0, atk: 0, def: 100, res: 20 }) } } });
  h.step();
  const b = h.b, u = h.unit('medic'), e = h.spawn('enemy_probe', { pos: [10, 8] });
  b.addBuff(e, { key: 'special-hp', flags: artsOnly ? { hitCountArts: true } : { hitCount: true } });
  return { h, b, u, e };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} versus ${expected}`);

test('special HP preserves formula, source/target effects, barrier overflow, incantation healing and gauge ratios', () => {
  const { b, u, e } = fixture();
  b.addBuff(u, { key: 'source', mods: { dmgDealtMul: 2 } });
  b.addBuff(e, { key: 'target', mods: { dmgTakenMul: 1.5 } });
  b.addBuff(e, { key: 'barrier', shield: 50 });
  u.hp = 1000;
  const seen = [], request = b.makeDamage({ amount: 200, type: 'arts', tags: ['original'] });
  b.on('damageOutput', c => { if (c.target === e) seen.push(['output', c.amount]); });
  b.on('hpDamage', c => { if (c.target === e) seen.push(['hpDamage', c.amount]); });
  b.on('damageApplied', c => {
    if (c.target !== e) return;
    seen.push(['applied', c.amount, c.hpRemoved]);
    b.dealElementDamage({ source: u, target: e, amount: c.amount * 0.1, element: 'burn' });
  });
  b.on('damaged', c => { if (c.target === e) { assert.equal(c.dmg, request); seen.push(['legacy', c.amount]); } });
  assert.equal(b.dealDamage(u, e, request), 1);
  assert.deepEqual(seen, [['output', 320], ['hpDamage', 430], ['applied', 430, 1], ['legacy', 430]]);
  assert.equal(e.hp, 9);
  assert.equal(e.findBuff('barrier'), null);
  close(u.hp, 1215); // (200 × 0.8 × 2 × 1.5 − 50) × 0.5
  close(e.elem.burn, 43);
  assert.equal(u.stats.dmg, 1, 'the API and existing damage statistics retain actual HP removed');
  assert.equal(e.stats.taken, 1);
  checkInvariants(b);
});

test('special HP barriers absorb actual damage and full absorption never spends a hit or heals', () => {
  const { b, u, e } = fixture();
  u.hp = 1000;
  b.addBuff(e, { key: 'barrier', shield: 1000 });
  let applied = 0;
  b.on('damageApplied', c => { if (c.target === e) applied++; });
  assert.equal(b.dealDamage({ source: u, target: e, amount: 200, type: 'arts' }), 0);
  assert.equal(e.findBuff('barrier').shield, 840);
  assert.equal(e.hp, 10);
  assert.equal(u.hp, 1000);
  assert.equal(applied, 0);
  b.addBuff(e, { key: 'earlier-dodge', injuryPriority: 1000, mods: { dodgeArts: 1 } });
  b.rng = () => 0;
  assert.equal(b.dealDamage({ source: u, target: e, amount: 200, type: 'arts' }), 0);
  assert.equal(e.findBuff('barrier').shield, 840);
  assert.equal(e.hp, 10);
  assert.equal(applied, 0);
  checkInvariants(b);
});

test('tea special HP accepts arts/true only, including a positive fraction, without changing the amount itself', () => {
  const { b, e } = fixture(true);
  const amounts = [];
  b.on('damageApplied', c => { if (c.target === e) amounts.push([c.amount, c.hpRemoved]); });
  assert.equal(b.dealDamage({ target: e, amount: 1000, type: 'phys' }), 0);
  assert.equal(b.dealDamage({ target: e, amount: 1000, type: 'elemental' }), 0);
  assert.equal(e.hp, 10);
  assert.equal(b.dealDamage({ target: e, amount: 100, type: 'arts' }), 1);
  assert.equal(b.dealDamage({ target: e, amount: 0.1, type: 'true' }), 1);
  assert.equal(b.dealDamage({ target: e, amount: 0, type: 'true' }), 0);
  assert.deepEqual(amounts, [[900, 0], [1000, 0], [80, 1], [0.1, 1]]);
  assert.equal(e.hp, 8);
  checkInvariants(b);
});

test('a lethal special-HP hit retains its damage descriptor and independent source/credit through fatal and kill', () => {
  const { b, u, e } = fixture();
  e.hp = 1;
  let fatal, applied, killer;
  b.on('fatal', c => { if (c.unit === e) fatal = c; });
  b.on('damageApplied', c => { if (c.target === e) applied = c; });
  b.on('kill', c => { if (c.victim === e) killer = c.killer; });
  assert.equal(b.dealDamage({ source: null, credit: u, target: e, amount: 500, type: 'true', tags: ['original'] }), 1);
  assert.equal(fatal.source, null);
  assert.equal(fatal.credit, u);
  assert.equal(fatal.amount, 500);
  assert.equal(applied.amount, 500);
  assert.equal(applied.hpRemoved, 1);
  assert.equal(applied.dmg, fatal.dmg);
  assert.deepEqual(applied.dmg.tags, ['original']);
  assert.equal(killer, u);
  assert.equal(e.alive, false);
  checkInvariants(b);
});
