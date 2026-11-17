// The plugin SDK's hit / damage helpers (shared/plugins/sdk.js `kit`: onHitBy, onHitOn, onDamagedOn, byEnemyAttack —
// server/sim/content/kits/shared/tier1.js) under the ordered settlement pipeline of 0.3.2 (PR #802, DESIGN §35.32;
// PLUGINS.md "SDK hit and damage helpers"): when each one fires and what it sees, through a plugin's content
// registration in a real battle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSDK, kit } from '../../shared/plugins/sdk.js';
import { resetExtensions } from '../../server/sim/content/extensions.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const r2 = (v) => Math.round(v * 100) / 100;

function arena(record) {
  resetExtensions();
  const sp = createSDK({ id: 'sdk-hooks' });
  sp.content.register({ install(b) {
    b.on('battleStart', () => {
      const u = b.allyUnits.find((x) => x.defId === 'probe');
      kit.onHitBy(b, u, (c) => record(['hitBy', c.target.defId, c.dmg.type]));
      kit.onHitOn(b, u, (c) => record(['hitOn', c.source?.defId ?? null, c.dmg.type, c.dmg.amount]));
      kit.onDamagedOn(b, u, (c) => record(['damagedOn', c.source?.defId ?? null, c.type, r2(c.amount), kit.byEnemyAttack(c)]));
    });
  } });
  const h = makeBattle({
    defs: {
      chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, def: 100, res: 0, atk: 0 }, skill: null }) },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0, atk: 0, def: 0, res: 0 }) },
    },
    units: [{ uid: 'probe', chessId: 'probe', row: 10, col: 5 }], autoFinish: false,
  });
  h.step();
  return { h, b: h.b, u: h.unit('probe'), e: h.spawn('enemy_dummy', { pos: [10, 9] }) };
}

test('SDK onHitBy / onHitOn fire on `hit` before calculation and the injury effects; onDamagedOn on `damaged` after the HP step', () => {
  const seen = [];
  const { b, u, e } = arena((x) => seen.push(x));
  const mark = (label) => seen.push([label]);
  try {
    mark('own hit');
    b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' });
    mark('enemy hit');
    b.dealDamage({ source: e, target: u, amount: 300, type: 'phys' });
    mark('counter-tagged enemy hit');
    b.dealDamage({ source: e, target: u, amount: 300, type: 'phys', tags: ['counter'] });
    mark('dodged');
    const dodge = b.addBuff(u, { key: 'dodge', mods: { dodgePhys: 1 } });
    b.dealDamage({ source: e, target: u, amount: 300, type: 'phys' });
    b.removeBuff(u, dodge);
    mark('full barrier');
    b.addBuff(u, { key: 'barrier', shield: 1000 });
    b.dealDamage({ source: e, target: u, amount: 300, type: 'phys' });
    b.removeBuff(u, 'barrier');
    mark('partial barrier');
    b.addBuff(u, { key: 'barrier2', shield: 50 });
    b.dealDamage({ source: e, target: u, amount: 300, type: 'phys' });
    mark('HP loss');
    b.dealHPLose({ source: e, target: u, amount: 50, type: 'true' });
    mark('source-less');
    b.dealDamage({ source: null, credit: e, target: u, amount: 60, type: 'true' });
    mark('gauge');
    b.dealElementDamage({ source: e, target: u, amount: 10, element: 'burn' });
  } finally { resetExtensions(); }
  assert.deepEqual(seen, [
    ['own hit'], ['hitBy', 'enemy_dummy', 'phys'],
    // the instance's amount at `hit` is its input (before DEF and every later stage); `damaged` has the damage dealt
    ['enemy hit'], ['hitOn', 'enemy_dummy', 'phys', 300], ['damagedOn', 'enemy_dummy', 'phys', 200, true],
    // descriptive tags no longer exclude an enemy source from byEnemyAttack (= byEnemyDamage since 0.3.2)
    ['counter-tagged enemy hit'], ['hitOn', 'enemy_dummy', 'phys', 300], ['damagedOn', 'enemy_dummy', 'phys', 200, true],
    // a dodge cancels after `hit`: no `damaged`
    ['dodged'], ['hitOn', 'enemy_dummy', 'phys', 300],
    // a barrier that absorbs everything blocks the hit; `damaged` still reports 0
    ['full barrier'], ['hitOn', 'enemy_dummy', 'phys', 300], ['damagedOn', 'enemy_dummy', 'phys', 0, true],
    ['partial barrier'], ['hitOn', 'enemy_dummy', 'phys', 300], ['damagedOn', 'enemy_dummy', 'phys', 150, true],
    // 流失 skips `hit` and every settlement stage; its `damaged` is no enemy damage for byEnemyAttack
    ['HP loss'], ['damagedOn', 'enemy_dummy', 'true', 50, false],
    // 无来源 damage: no source in either hook (the credit is the enemy)
    ['source-less'], ['hitOn', null, 'true', 60], ['damagedOn', null, 'true', 60, false],
    // a gauge fill has its own pipeline: `damaged` with type 'element', never `hit`
    ['gauge'], ['damagedOn', 'enemy_dummy', 'element', 10, false],
  ]);
  assert.deepEqual(b.errors, []);
});

test('SDK hooks see the special-HP damage amount; the HP still drops by one point', () => {
  const seen = [];
  resetExtensions();
  const sp = createSDK({ id: 'sdk-hooks-count' });
  sp.content.register({ install(b) {
    b.on('battleStart', () => {
      const u = b.allyUnits.find((x) => x.defId === 'probe');
      kit.onHitBy(b, u, (c) => seen.push(['hitBy', c.dmg.amount]));
      b.on('damaged', (c) => { if (c.source === u) seen.push(['damaged', r2(c.amount)]); });
    });
  } });
  try {
    const h = makeBattle({
      defs: {
        chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 10000, atk: 0 }, skill: null }) },
        enemies: { counted: enemyRec({ key: 'counted', hp: 5, speed: 0, def: 0, res: 0 }) },
      },
      units: [{ uid: 'probe', chessId: 'probe', row: 10, col: 5 }], autoFinish: false,
    });
    h.step();
    const u = h.unit('probe'), e = h.spawn('counted', { pos: [10, 9] });
    h.b.addBuff(e, { key: 'times', persist: true, flags: { hitCount: true } });
    h.b.dealDamage({ source: u, target: e, amount: 700, type: 'arts' });
    assert.equal(e.hp, 4);
    assert.deepEqual(seen, [['hitBy', 700], ['damaged', 700]]);
    assert.deepEqual(h.b.errors, []);
  } finally { resetExtensions(); }
});
