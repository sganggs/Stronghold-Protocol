// A fresh 隐匿 source belongs to the husk, not to the blocked warrior it replaces.
// PRTS 深池逐火战士 / 深池逐火护卫: 1 s 重生 (无法阻挡), then the husk gains 隐匿.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemies from '../../server/sim/content/enemies.js';
import { canTargetEnemy, enemyStealthed, stealthOffKey } from '../../server/sim/targeting.js';

const WALL = chessRec({ id: 't_ember_wall', profession: 'TANK',
  stats: { atk: 0, maxHp: 1e7, blockCnt: 1 }, skill: null });
const quiet = () => ({ trait: { noAttack: true } });
const KEYS = ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld'];
function arena() {
  const h = makeBattle({ content: 'generic', extraContent: [enemies], seed: 7,
    autoFinish: false, timeLimit: 60, defs: { chess: { t_ember_wall: WALL } },
    kits: { t_ember_wall: quiet }, units: [{ chessId: 't_ember_wall', row: 9, col: 5 }] });
  h.step();
  return h;
}
const put = (h, key, x = 5) => h.spawn(key, { pos: [9, x], routeIndex: 0, mods: { speedMul: 0, atkMul: 0 } });
function clean(h) { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); }

for (const key of KEYS) {
  test(`${key}: repeated knock-outs renew the husk's initial 隐匿, not its previous block's restore timer`, () => {
    const h = arena(), wall = h.unit('t_ember_wall');
    const e = put(h, key), next = put(h, 'enemy_1007_slime', 5.3);
    h.step(2); assert.equal(e.blockedBy, wall);
    h.b.kill(e, null); h.run(enemies.HUSK_REBIRTH + 0.1);
    assert.equal(next.blockedBy, wall); assert.equal(enemyStealthed(e), true);
    // Reveal by a new block, then release the husk's own block and let it stand up.
    h.b.kill(next, null); h.step(2); assert.equal(e.blockedBy, wall);
    h.b.applyStatus(wall, 'stun', { duration: 30, force: true }); h.step();
    assert.ok(e.findBuff(stealthOffKey('ab:ember')));
    assert.equal(enemyStealthed(e), false);
    assert.ok(h.runUntil(() => e.form === 'revived', 15));
    assert.equal(!!e.s.flags.stealth, false); assert.equal(e.hp, e.s.maxHp);
    h.b.kill(e, null); h.run(enemies.HUSK_REBIRTH + 0.1);
    assert.equal(e.form, 'husk'); assert.equal(e.blockedBy, null);
    assert.equal(enemyStealthed(e), true);
    assert.equal(e.findBuff(stealthOffKey('ab:ember')), null);
    clean(h);
  });

  test(`${key}: 反隐 still reveals a fresh unblocked husk; it hides immediately when 反隐 ends`, () => {
    const h = arena(), wall = h.unit('t_ember_wall');
    const e = put(h, key), next = put(h, 'enemy_1007_slime', 5.3);
    h.step(2); assert.equal(e.blockedBy, wall);
    h.b.kill(e, null);
    h.b.addBuff(e, { key: 'test:reveal', flags: { reveal: true } });
    h.run(enemies.HUSK_REBIRTH + 0.1);
    assert.equal(next.blockedBy, wall); assert.equal(e.blockedBy, null);
    assert.equal(enemyStealthed(e), false);
    assert.equal(canTargetEnemy(null, e, { canHitFly: false }), true);
    h.b.removeBuff(e, 'test:reveal'); h.step();
    assert.equal(enemyStealthed(e), true);
    assert.equal(canTargetEnemy(null, e, { canHitFly: false }), false);
    clean(h);
  });
}

test('假想敌：再生 uses the same husk helper but gains no 隐匿 and remains targetable and unblockable', () => {
  const h = arena(), wall = h.unit('t_ember_wall');
  const e = put(h, 'enemy_9010_acpupp'), next = put(h, 'enemy_1007_slime', 5.3);
  h.step(2); assert.equal(e.blockedBy, wall);
  h.b.kill(e, null);
  assert.equal(e.blockedBy, null);
  h.run(enemies.HUSK_REBIRTH + 0.1);
  assert.equal(next.blockedBy, wall);
  assert.equal(e.form, 'husk'); assert.equal(e.blockedBy, null);
  assert.equal(!!e.s.flags.stealth, false); assert.equal(e.s.flags.unblockable, true);
  assert.equal(canTargetEnemy(null, e, { canHitFly: false }), true);
  assert.equal(enemies.abOf(h.b, next).hitShield, 5);
  assert.equal(e.hp, 15);
  assert.ok(h.runUntil(() => e.form === 'revived', 20));
  assert.equal(e.hp, e.s.maxHp); assert.equal(!!e.s.flags.stealth, false);
  assert.equal(!!e.s.flags.unblockable, false);
  clean(h);
});
