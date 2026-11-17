import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

function setup() {
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 0 }, skill: null }) },
      enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 10000, def: 0, res: 0, speed: 0 }) } },
    units: [{ uid: 1, chessId: 'probe', row: 10, col: 3 }] });
  h.step();
  return { b: h.b, source: h.unit(1), target: h.spawn('enemy_probe', { pos: [10, 8] }) };
}

test('target modifier application precedes source success; conditional rider follows fatal/kill handling', () => {
  const { b, source, target } = setup(), seen = [];
  b.on('modifierApplied', c => seen.push(['target', c.amount, c.hpRemoved, target.alive]));
  b.on('damageApplied', c => seen.push(['source', c.amount, c.hpRemoved, target.alive]));
  b.on('kill', () => seen.push(['kill']));
  assert.equal(b.dealDamage({ source, target, amount: 20000, type: 'true',
    onApplied(c) { seen.push(['rider', c.amount, c.hpRemoved, target.alive]); } }), 10000);
  assert.deepEqual(seen, [['target', 20000, 10000, true], ['source', 20000, 10000, true], ['kill'], ['rider', 20000, 10000, false]]);
  assert.deepEqual(b.errors, []);
});

test('post-modifier reports ordinary heal/gauge values and omits direct restoration, regen and HP loss', () => {
  const { b, source, target } = setup(), seen = [];
  b.on('modifierApplied', c => seen.push([c.kind, c.amount, c.hpRestored ?? c.gaugeAdded]));
  target.hp -= 10;
  assert.equal(b.heal({ source, target, amount: 100 }), 10);
  b.dealElementDamage({ source, target, amount: 20, element: 'burn' });
  b.dealHPLose({ source, target, amount: 1 });
  b.heal({ source, target, amount: 1, mode: 'regen' });
  b.heal({ source, target, amount: 1, mode: 'restore' });
  assert.deepEqual(seen, [['heal', 100, 10], ['elementDamage', 20, 20]]);
  assert.deepEqual(b.errors, []);
});

test('conditional damage rider distinguishes positive special-HP damage from blocked or dodged output', () => {
  for (const defense of ['special', 'barrier', 'dodge']) {
    const { b, source, target } = setup(), applied = [];
    if (defense === 'special') b.addBuff(target, { key: defense, flags: { hitCountArts: true } });
    if (defense === 'barrier') b.addBuff(target, { key: defense, shield: 1000 });
    if (defense === 'dodge') b.addBuff(target, { key: defense, mods: { dodgePhys: 1 } });
    b.rng = () => 0;
    assert.equal(b.dealDamage({ source, target, amount: 100, type: 'phys', onApplied(c) { applied.push([c.amount, c.hpRemoved]); } }), 0);
    assert.deepEqual(applied, defense === 'special' ? [[100, 0]] : []);
    assert.deepEqual(b.errors, []);
  }
});
