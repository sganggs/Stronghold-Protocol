import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { SALT_CANNON } from '../../server/sim/content/saltCannon.js';
import { sortEnemyTargets, canTargetEnemy } from '../../server/sim/targeting.js';

const stage = JSON.parse(
  readFileSync(new URL('../../data/versions/act3autochess-v3_1/stages.json', import.meta.url)),
).act3autochess_m10;
const modes = JSON.parse(
  readFileSync(new URL('../../data/versions/act3autochess-v3_1/config.json', import.meta.url)),
).modes;
const cannonOf = h => h.b.enemies.find(e => e.defId === SALT_CANNON);
const guard = chessRec({
  id: 'test_guard',
  skill: null,
  stats: { maxHp: 100000, atk: 0, def: 0 },
  rangeGrid: [[0, 0]],
});
function battle(opts = {}) {
  return makeBattle({
    stage,
    autoFinish: false,
    timeLimit: 60,
    ...opts,
    defs: {
      chess: { test_guard: guard },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 10000, speed: 0, atk: 0 }) },
      ...opts.defs,
    },
  });
}
function board(h, props = {}) {
  return h.b.spawnEnemy('enemy_dummy', { pos: [12.45, 6], ...props });
}

test('MAP10 applies its main-level cannon runes once, consistently across solo and multiplayer difficulties', () => {
  const attr = stage.runes.find(r => r.key === 'char_attribute_add' && r.bbStr.char === SALT_CANNON);
  const cd = stage.runes.find(r => r.key === 'char_skill_cd_mul' && r.bbStr.char === SALT_CANNON);
  assert.equal(attr.bb.MAX_HP, 30000);
  assert.equal(attr.bb.ATK, -300);
  assert.equal(cd.bb.scale, 3);
  for (const modeId of [
    'mode_single_9',
    'mode_single_13',
    'mode_single_15',
    'mode_single_20',
    'mode_multi_hard',
    'mode_multi_abyss',
  ]) {
    assert.ok(modes[modeId]);
    const h = battle({ modeId });
    h.step();
    const c = cannonOf(h);
    assert.equal(c.hp, 60000, modeId);
    assert.equal(c.s.atk, 900, modeId);
    assert.equal(c.mem.saltCannon.data.spCost, 18, modeId);
  }
});

test('MAP10 emits SP, branch identity and native landing routes; each field creates only its own fixed devices', () => {
  for (const [kind, count, row] of [
    ['normal', 1, 13],
    ['unite', 2, 13],
    ['boss', 2, 6],
    ['hidden', 2, 6],
  ]) {
    const h = battle({ kind });
    h.step(2);
    const cs = h.b.enemies.filter(e => e.defId === SALT_CANNON);
    assert.equal(cs.length, count);
    for (const c of cs) {
      assert.equal(c.kind, 'device');
      assert.equal(c.side, 'enemy');
      assert.equal(c.y, row);
      assert.equal(c.s.maxHp, 60000);
      assert.equal(c.s.atk, 900);
      assert.equal(c.s.def, 3000);
      assert.equal(c.s.taunt, -1);
      assert.equal(c.mem.saltCannon.data.spCost, 18);
      assert.equal(c.counted, false);
      assert.equal(c.inTotal, false);
      assert.equal(c.isEnemyEntity, false);
      assert.equal(c.mem.saltCannon.data.route.start[0], row - 4);
      assert.match(c.mem.saltCannon.data.branchId, /^route_/);
    }
    assert.equal(h.b.total, 0);
    checkInvariants(h.b);
  }
});

test('first cannon shot charges eighteen seconds then travels at speed five to the fixed landing point', () => {
  const h = battle({
    units: [
      { chessId: 'test_guard', row: 10, col: 6 },
      { chessId: 'test_guard', row: 10, col: 8 },
    ],
  });
  h.step();
  const [near, far] = h.b.allyUnits;
  h.run(17.8);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'saltCannonShot').length, 0);
  h.run(0.3);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'saltCannonShot').length, 1);
  assert.equal(near.hp, 100000, 'in flight');
  h.run(0.8);
  assert.equal(near.hp, 99100);
  assert.equal(far.hp, 100000);
  assert.equal(h.b.projectiles.list.length, 0);
  checkInvariants(h.b);
});

test('blast hits camouflage and flying/default entities but excludes stealth and untargetable allies', () => {
  for (const [flag, hits] of [
    ['camou', true],
    ['liftoff', false],
    ['fly', true],
    ['stealth', false],
    ['untargetable', false],
  ]) {
    const h = battle({ units: [{ chessId: 'test_guard', row: 10, col: 6 }] });
    h.step();
    const a = h.b.allyUnits[0];
    if (flag === 'fly') a.motion = 'FLY';
    else h.b.addBuff(a, { key: 'test', flags: { [flag]: true }, persist: true });
    h.run(19);
    assert.equal(a.hp, hits ? 99100 : 100000, flag);
    checkInvariants(h.b);
  }
});

test('only one selectable ground enemy of weight at most three boards; flyers and heavier units stay', () => {
  for (const [motion, weight, flag, boards] of [
    ['WALK', 3, null, true],
    ['WALK', 4, null, false],
    ['FLY', 1, null, false],
    ['WALK', 1, 'stealth', false],
    ['WALK', 1, 'untargetable', false],
  ]) {
    const h = battle();
    h.step();
    const p = board(h);
    p.motion = motion;
    p.base.massLevel = weight;
    p.markDirty();
    if (flag) h.b.addBuff(p, { key: 'test', flags: { [flag]: true }, persist: true });
    h.step();
    assert.equal(!!p.mem.carrier, boards);
    assert.equal(p.hidden, boards || false);
    if (boards) {
      const second = board(h);
      h.step();
      assert.equal(second.mem.carrier, undefined);
    }
    checkInvariants(h.b);
  }
});

test('passenger keeps identity, HP, modifiers and ownership; unload uses the arena route and a bounded square', () => {
  const h = battle();
  h.step();
  const p = board(h, { mods: { hpMul: 2 }, bounty: { coins: 5, ownerPlayerId: 'p1' }, ownerPlayerId: 'p1' });
  p.hp = 9000;
  const id = p.id,
    route = p.route;
  h.step();
  assert.equal(p.mem.carrier, cannonOf(h));
  assert.equal(p.hidden, true);
  h.run(18.9);
  assert.equal(p.hidden, false);
  assert.equal(p.mem.carrier, undefined);
  assert.equal(p.id, id);
  assert.equal(p.hp, 9000);
  assert.equal(p.mods.hpMul, 2);
  assert.equal(p.bounty.coins, 5);
  assert.equal(p.ownerId, 'p1');
  assert.ok(Math.abs(p.x - 6) <= 0.2 && Math.abs(p.y - 9) <= 0.2);
  assert.notEqual(p.route, route);
  assert.ok(p.route.legs.some(l => l.r === 9 && l.c === 2));
  const appear = h.eventsOf('fx').findLast(e => e[1] === 'appear' && e[4].id === p.id);
  assert.ok(appear);
  assert.ok(p.mem.cannonBoardAfter > 18.7 && p.mem.cannonBoardAfter < 19.1);
  p.base.moveSpeed = 1;
  p.markDirty();
  assert.ok(h.runUntil(() => !p.alive, 20));
  assert.equal(p.removeReason, 'leak');
  assert.equal(h.result()?.leaked?.some?.(e => e.enemyKey === SALT_CANNON) ?? false, false);
  checkInvariants(h.b);
});

test('low taunt keeps the cannon behind ordinary enemies; immunity and first lethal floor are preserved', () => {
  const h = battle();
  h.step();
  const c = cannonOf(h),
    p = board(h);
  for (const key of ['stun', 'cold', 'freeze', 'levitate', 'silence', 'sleep'])
    assert.equal(h.b.applyStatus(c, key, { duration: 1 }), false, key);
  assert.equal(sortEnemyTargets(h.b, { x: 5, y: 12, blocking: [] }, [c, p], null)[0], p);
  h.b.dealDamage({ source: null, target: c, amount: 1e6, type: 'true' });
  assert.equal(c.hp, 1);
  assert.equal(c.alive, true);
  h.b.dealDamage({ source: null, target: c, amount: 10, type: 'true' });
  assert.equal(c.alive, false);
  assert.equal(h.b.killed, 0);
  assert.equal(h.b.total, 0);
  checkInvariants(h.b);
});

test('loaded cannon at one HP fires one final shot, becomes untargetable, then dies when its shot lands', () => {
  const h = battle();
  h.step();
  const c = cannonOf(h),
    p = board(h);
  h.step();
  h.b.dealDamage({ source: null, target: c, amount: 1e6, type: 'true' });
  h.b.dealDamage({ source: null, target: c, amount: 1, type: 'true' });
  assert.equal(c.alive, true);
  assert.equal(c.hp, 1);
  assert.equal(canTargetEnemy(null, c), false);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'saltCannonShot').length, 1);
  h.run(1);
  assert.equal(c.alive, false);
  assert.equal(p.alive, true);
  assert.equal(p.hidden, false);
  assert.ok(Math.abs(p.x - 6) <= 0.2 && Math.abs(p.y - 9) <= 0.2);
  checkInvariants(h.b);
});

test('clearing an ordinary shot retains Eat passenger for the next shot; only a cancelled final shot kills it', () => {
  for (const final of [false, true]) {
    const h = battle();
    h.step();
    const c = cannonOf(h);
    const p = board(h);
    h.step();
    if (final) {
      h.b.dealDamage({ source: null, target: c, amount: 1e6, type: 'true' });
      h.b.dealDamage({ source: null, target: c, amount: 1, type: 'true' });
    } else h.run(18);
    assert.equal(h.b.projectiles.list.length, 1);
    h.b.projectiles.clear();
    h.step();
    assert.equal(p.alive, !final);
    assert.equal(c.alive, !final);
    if (final) {
      assert.equal(p.mem.carrier, undefined);
      assert.equal(c.mem.saltCannon.passenger, null);
    } else {
      assert.equal(p.mem.carrier, c);
      assert.equal(c.mem.saltCannon.passenger, p);
      assert.equal(p.hidden, true);
      h.run(18.9);
      assert.equal(p.alive, true);
      assert.equal(p.hidden, false);
      assert.equal(p.mem.carrier, undefined);
      assert.ok(Math.abs(p.x - 6) <= 0.2 && Math.abs(p.y - 9) <= 0.2);
    }
    checkInvariants(h.b);
  }
});

test('an ordinary shot cannot finish a dying cannon before its final shot', () => {
  const h = battle();
  h.step();
  const c = cannonOf(h);
  board(h);
  h.step();
  h.run(18);
  h.b.dealDamage({ source: null, target: c, amount: 1e6, type: 'true' });
  h.b.dealDamage({ source: null, target: c, amount: 1, type: 'true' });
  const [ordinary, final] = [...c.mem.saltCannon.flights];
  assert.equal(ordinary.final, false);
  assert.equal(final.final, true);
  h.b.projectiles.list = h.b.projectiles.list.filter(p => p !== ordinary.projectile);
  h.step();
  assert.equal(c.alive, true);
  h.run(1);
  assert.equal(c.alive, false);
  checkInvariants(h.b);
});

test('empty cannon self-destruction has no operator kill credit', () => {
  const h = battle({ units: [{ chessId: 'test_guard', row: 12, col: 6 }] });
  h.step();
  const c = cannonOf(h);
  const source = h.b.allyUnits[0];
  const deaths = [];
  h.b.on('death', e => deaths.push(e));
  h.b.dealDamage({ source, target: c, amount: 1e6, type: 'true' });
  h.b.dealDamage({ source, target: c, amount: 1, type: 'true' });
  assert.equal(c.alive, false);
  assert.equal(source.stats.kills, 0);
  assert.equal(deaths.filter(e => e.unit === c).length, 1);
  assert.equal(deaths.find(e => e.unit === c).killer, null);
});

test('x-4 splash follows the 3×3 tile grid for units offset from their tile centers', () => {
  for (const [x, y, hit] of [
    [7.49, 10.49, true],
    [7.51, 9, false],
  ]) {
    const h = battle({ units: [{ chessId: 'test_guard', row: 10, col: 7 }] });
    h.step();
    const a = h.b.allyUnits[0];
    a.x = x;
    a.y = y;
    a.tileR = Math.round(y);
    a.tileC = Math.round(x);
    h.run(19);
    assert.equal(a.hp, hit ? 99100 : 100000);
    const impact = h.eventsOf('fx').find(e => e[1] === 'saltCannonHit');
    assert.deepEqual(impact[4].targets, hit ? [a.id] : []);
  }
});

test('fixed hostile devices neither hold a clear nor leak on timeout; devices:false suppresses them', () => {
  const clear = battle({ autoFinish: true, enemies: [{ key: 'enemy_dummy', pos: [9, 9] }] });
  clear.step();
  clear.b.kill(
    clear.b.enemies.find(e => e.defId === 'enemy_dummy'),
    null,
  );
  clear.step();
  assert.equal(clear.b.finished, true);
  assert.equal(clear.result().reason, 'cleared');
  const timed = battle({ timeLimit: 0.2 });
  timed.run(1);
  assert.equal(timed.result().reason, 'timeout');
  assert.ok(Object.values(timed.result().perPlayer).every(p => !p.leaked.some(e => e.enemyKey === SALT_CANNON)));
  const off = battle();
  off.b.opts.devices = false;
  off.step();
  assert.equal(cannonOf(off), undefined);
});

test('native sailor release doubles movement for one second, then restores its original speed', () => {
  const enemies = JSON.parse(
    readFileSync(new URL('../../data/versions/act3autochess-v3_1/enemies.json', import.meta.url)),
  );
  const h = battle({ defs: { enemies: { enemy_10043_sailor: enemies.enemy_10043_sailor } } });
  h.step();
  const p = h.b.spawnEnemy('enemy_10043_sailor', { pos: [12.45, 6] });
  h.step();
  assert.equal(p.hidden, true);
  h.runUntil(() => !p.hidden, 20);
  assert.equal(p.s.moveSpeed, 1.8);
  h.run(1.1);
  assert.equal(p.s.moveSpeed, 0.9);
  checkInvariants(h.b);
});

test('Saga cannot apply dying to the cannon even when her damage leaves it at one HP', () => {
  const h = battle({
    units: [{ uid: 1, diy: { slot: 'chess_char_5_diy1_a', charId: 'char_362_saga', skillIndex: 0 }, row: 12, col: 6 }],
  });
  h.step();
  const c = cannonOf(h),
    saga = h.unit(1);
  h.b.dealDamage({ source: saga, target: c, amount: 1e6, type: 'true' });
  assert.equal(c.hp, 1);
  assert.equal(c.findBuff('saga:dying'), null);
  h.b.dealDamage({ source: null, target: c, amount: 1, type: 'true' });
  assert.equal(c.alive, false);
  assert.equal(h.b.killed, 0);
  assert.equal(h.b.killedInTotal, 0);
});

test('SP blocking delays shots and a nonfatal hit to exactly one HP arms empty-cannon destruction', () => {
  const h = battle();
  h.step();
  const c = cannonOf(h);
  h.b.addBuff(c, { key: 'test:noSp', duration: 2, flags: { noSp: true } });
  h.run(18);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'saltCannonShot').length, 0);
  h.run(2.1);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'saltCannonShot').length, 1);
  h.b.dealDamage({ source: null, target: c, amount: c.hp - 1, type: 'true' });
  assert.equal(c.hp, 1);
  assert.equal(c.alive, true);
  h.b.dealDamage({ source: null, target: c, amount: 1, type: 'true' });
  assert.equal(c.alive, false);
  checkInvariants(h.b);
});

test('normal operator attacks can reach the fixed cannon across the road boundary', () => {
  const hitter = chessRec({
    id: 'test_hitter',
    skill: null,
    stats: { maxHp: 100000, atk: 5000, def: 0 },
    rangeGrid: [[0, 1]],
  });
  const h = battle({
    defs: { chess: { test_hitter: hitter } },
    units: [{ chessId: 'test_hitter', row: 12, col: 6, dir: 'UP' }],
  });
  h.step();
  const c = cannonOf(h);
  assert.equal(c.hp, 58000, 'first attack is already resolved on the initial tick');
  h.run(3);
  assert.ok(c.hp < 58000, 'real AI/attack pipeline reaches the enemy-side device repeatedly');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0);
});

test('a passenger killed while hidden does not make a one-HP empty cannon fire a final shot', () => {
  const h = battle();
  h.step();
  const c = cannonOf(h),
    p = board(h);
  h.step();
  assert.equal(p.hidden, true);
  h.b.kill(p, null);
  h.b.dealDamage({ source: null, target: c, amount: 1e6, type: 'true' });
  h.b.dealDamage({ source: null, target: c, amount: 1, type: 'true' });
  assert.equal(c.alive, false);
  assert.equal(h.eventsOf('fx').filter(e => e[1] === 'saltCannonShot').length, 0);
});
