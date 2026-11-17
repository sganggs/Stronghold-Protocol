import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackCombat, combineCombat } from '../../public/js/battle/metrics.js';
import { Unit } from '../../server/sim/units.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

test('meter pictures retain the effective stand-in / DIY body and latest elite form', () => {
  const { b, u } = rig({ tracked: false });
  u.def = { ...u.def, charId: 'char_x_backup', avatar: 'char_x_backup_2', golden: true };
  const read = trackCombat(b);
  const r = read().rows[0];
  assert.deepEqual(r.picture, { charId: 'char_x_backup', isGolden: true, assets: { avatar: 'char_x_backup_2' } });
  const combined = combineCombat([{ ...read(), rows: [{ ...r, picture: { charId: 'old' } }] }, read()]);
  assert.deepEqual(combined.rows[0].picture, r.picture);
  assert.equal(combined.rows[0].ownerId, u.ownerId);
  read.stop();
});

function rig({ tracked = true } = {}) {
  const h = makeBattle({
    defs: {
      chess: { test_op: chessRec({ id: 'test_op', stats: { atk: 0, maxHp: 1000 }, skill: null }) },
      enemies: { enemy_test: enemyRec({ key: 'enemy_test', hp: 10000, def: 100, res: 50, speed: 0, atk: 0 }) },
    },
    units: [{ chessId: 'test_op', row: 9, col: 4 }], enemies: [{ key: 'enemy_test', pos: [9, 6] }],
    content: 'none', autoFinish: false, hooks: [],
  });
  const read = tracked ? trackCombat(h.b) : null;
  h.step();
  return { h, b: h.b, u: h.unit('test_op'), e: h.enemy('enemy_test'), read };
}

test('effective HP damage: mitigation, silent loss, overkill, shields, friendly damage and element gauge fill', () => {
  const { b, u, e, read } = rig();
  b.dealDamage(u, e, { amount: 500, type: 'phys' });
  b.dealDamage(u, e, { amount: 500, type: 'arts', silent: true });
  b.loseHp(e, 50, { source: u, silent: true });
  b.dealDamage(u, e, { amount: 100, type: 'elemental' });
  b.dealDamage(u, e, { amount: 100, type: 'element', element: 'burn' });
  b.dealDamage(u, u, { amount: 50, type: 'true' });
  b.addBuff(e, { key: 'test_shield', shield: 100 });
  b.dealDamage(u, e, { amount: 100, type: 'true' });
  const row = read().rows[0];
  assert.deepEqual(row.types, { phys: 400, arts: 250, true: 50, elemental: 100 });
  assert.equal(row.damage, 800);
  assert.equal(row.damage, u.stats.dmg);
  e.hp = 10;
  b.dealDamage(u, e, { amount: 1000, type: 'true' });
  assert.equal(read().rows[0].types.true, 60, 'only remaining HP, not the overkill float');
});

test('stop detaches the meter and keeps the rows already counted', () => {
  const { b, u, e, read } = rig();
  const hooks = b._hooks.damaged.length;
  b.dealDamage(u, e, { amount: 100, type: 'true' });
  const damage = read().rows[0].damage;
  assert.ok(damage > 0);
  const wrapped = b.heal;
  read.stop();
  read.stop();
  assert.equal(b._hooks.damaged?.length || 0, hooks - 1);
  assert.notEqual(b.heal, wrapped);
  assert.equal(Object.prototype.hasOwnProperty.call(b, 'heal'), false);
  b.dealDamage(u, e, { amount: 100, type: 'true' });
  u.hp -= 30;
  assert.equal(b.heal(u, u, 30), 30);
  assert.equal(read().rows[0].damage, damage);
  assert.equal(read().rows[0].healing, 0);
});

test('effective healing: silent/self heals included, overheal and shields excluded; enemy healing excluded', () => {
  const { b, u, e, read } = rig();
  u.hp -= 100;
  assert.equal(b.heal(u, u, 60, { silent: true, self: true }), 60);
  assert.equal(b.heal(u, u, 100, { overheal: true }), 40);
  assert.equal(b.heal(u, u, 100), 0);
  e.hp -= 100;
  b.heal(e, e, 100);
  assert.equal(read().rows[0].healing, 100);
  assert.equal(read().rows[0].healing, u.stats.heal);
});

test('summons aggregate to their operator; nested damage is credited once to the correct types', () => {
  const { b, u, e, read } = rig();
  const token = new Unit({ id: 900, kind: 'token', side: 'ally', ownerId: u.ownerId, ownerUnit: u, defId: 'test_token' });
  b.dealDamage(token, e, { amount: 40, type: 'true' });
  let reflected = false;
  b.on('damaged', ({ target }) => {
    if (target !== e || reflected) return;
    reflected = true;
    b.dealDamage(u, e, { amount: 20, type: 'arts' });
  });
  b.dealDamage(u, e, { amount: 100, type: 'phys' });
  const row = read().rows[0];
  assert.equal(read().rows.length, 1);
  assert.deepEqual(row.types, { phys: 5, arts: 10, true: 40, elemental: 0 });
  assert.equal(row.damage, token.stats.dmg + u.stats.dmg);
});

test('combat observation leaves the simulation result and rendered events identical', () => {
  const control = rig({ tracked: false }).h, tracked = rig();
  for (const h of [control, tracked.h]) {
    const u = h.unit('test_op'), e = h.enemy('enemy_test');
    h.b.dealDamage(u, e, { amount: 500, type: 'phys' });
    h.b.dealDamage(u, u, { amount: 100, type: 'true' });
    h.b.heal(u, u, 100, { silent: true });
    h.run(1);
    h.b.forceEnd('forced');
  }
  assert.deepEqual(tracked.b.result(), control.b.result());
  assert.deepEqual(tracked.h.events, control.events);
});

test('match accumulation merges the same name per owner, sorts damage descending and uses game seconds', () => {
  const { b, u, e, read } = rig();
  b.dealDamage(u, e, { amount: 500, type: 'phys' });
  b.time = 2;
  const first = read();
  const second = structuredClone(first);
  second.seconds = 3;
  second.rows[0].defId = 'promoted';
  second.rows[0].damage = 600;
  second.rows[0].types.phys = 600;
  second.rows[0].healing = 100;
  const other = structuredClone(first);
  other.owners = ['p2'];
  other.rows[0].key = 'another-player';
  other.rows[0].ownerId = 'p2';
  const totals = combineCombat([first, second, other]);
  assert.equal(totals.rows.length, 2);
  assert.equal(totals.rows[0].damage, 1000);
  assert.equal(totals.rows[0].defId, 'promoted');
  assert.equal(totals.rows[0].dps, 200);
  assert.equal(totals.rows[0].hps, 20);
  assert.equal(totals.rows[1].dps, 200);
  assert.equal(combineCombat([first, second, other], u.ownerId).rows.length, 1);
  assert.equal(combineCombat([{ owners: [u.ownerId], seconds: 5, rows: [] }, first, second]).rows[0].dps, 100,
    'rounds with an empty board still count toward that player’s elapsed battle time');
  second.seconds = 0;
  assert.equal(combineCombat([second]).rows[0].dps, 0);
  assert.equal(first.rows[0].damage, 400, 'snapshots are detached from both collector and aggregation');
});

test('same-name copies combine damage types, healing and rates in both battle and match views without merging players', () => {
  const { b, u, e, read } = rig();
  b.dealDamage(u, e, { amount: 500, type: 'phys' });
  b.time = 2;
  const battle = read();
  const copy = { ...structuredClone(battle.rows[0]), key: 'copy', uid: 2, defId: 'promoted-copy',
    damage: 100, healing: 60, types: { phys: 0, arts: 100, true: 0, elemental: 0 } };
  const other = { ...structuredClone(copy), key: 'other-player', ownerId: 'p2', damage: 700,
    types: { phys: 0, arts: 700, true: 0, elemental: 0 } };
  const differentName = { ...structuredClone(copy), key: 'different-name', name: '另一位干员', damage: 200,
    types: { phys: 0, arts: 200, true: 0, elemental: 0 } };
  battle.rows.push(copy, other, differentName);
  battle.owners.push('p2');
  const current = combineCombat([battle], u.ownerId);
  assert.equal(current.rows.length, 2);
  assert.equal(current.rows[0].damage, 500);
  assert.equal(current.rows[0].healing, 60);
  assert.deepEqual(current.rows[0].types, { phys: 400, arts: 100, true: 0, elemental: 0 });
  assert.equal(current.rows[0].dps, 250, 'two copies share the battle duration');
  assert.equal(current.rows[0].hps, 30);
  assert.equal(combineCombat([battle]).rows.length, 3, 'same-name teammates remain separate');
  assert.equal(combineCombat([battle]).rows[0].ownerId, 'p2', 'sorting uses combined damage');
  const next = { seconds: 3, owners: [u.ownerId], rows: [{ ...copy, key: 'new-copy-next-round', uid: 3 }] };
  const match = combineCombat([battle, next], u.ownerId);
  assert.equal(match.rows.length, 2);
  assert.equal(match.rows[0].damage, 600);
  assert.equal(match.rows[0].healing, 120);
  assert.equal(match.rows[0].dps, 120);
  assert.equal(match.rows[0].hps, 24);
  assert.equal(battle.rows[0].damage, 400, 'grouping never changes individual snapshots');
});
