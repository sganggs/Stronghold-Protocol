// Projectile interception is delivery, before hit/injury/HP or gauge application.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec } from '../helpers/battleHarness.js';
import { ProjectileSystem } from '../../server/sim/projectiles.js';

function wall(dir = 'RIGHT') {
  const h = makeBattle({ defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, atk: 0, speed: 0 }) },
    chess: { target: chessRec({ id: 'target', stats: { maxHp: 100000 }, skill: null }) } },
    units: [{ uid: 'yu', chessId: 'chess_char_6_03_a', row: 10, col: 5, dir },
      { uid: 'target', chessId: 'target', row: 10, col: 4 }], hooks: ['hit', 'block', 'dodge'], captureNoisy: true, autoFinish: false });
  h.step();
  const u = h.unit('yu'), t = h.unit('target'), e = h.spawn('enemy_probe', { pos: [10, 8] });
  assert.ok(u.skill.activate('test', { free: true }));
  return { h, b: h.b, u, t, e };
}

test('Yu wall is half a tile ahead of each deployment direction', () => {
  for (const [dir, expected] of [['RIGHT', { axis: 'x', v: 5.5 }], ['LEFT', { axis: 'x', v: 4.5 }],
    ['UP', { axis: 'y', v: 10.5 }], ['DOWN', { axis: 'y', v: 9.5 }]]) {
    assert.deepEqual(wall(dir).u.mem.yuWall, expected);
  }
});

function flight(b, e, onHit, extra = {}) {
  const p = b.addProjectile({ from: { x: 7, y: 10 }, to: { x: 4, y: 10 }, source: e, speed: 3, onHit, ...extra });
  for (let i = 0; i < 40 && b.projectiles.list.includes(p); i++) b.projectiles.update(1 / 30);
  return p;
}

test('Yu removes a crossing projectile before any of its multiple impacts or element riders run', () => {
  const { h, b, u, t, e } = wall();
  b.rng = () => 0;
  const hp = [u.hp, t.hp];
  let impacts = 0;
  flight(b, e, () => {
    impacts++;
    for (const target of [u, t]) {
      b.dealDamage({ source: e, target, amount: 100, type: 'true', isProjectile: true });
      b.dealElementDamage({ source: e, target, amount: 100, element: 'burn' });
    }
  });
  assert.equal(impacts, 0);
  assert.deepEqual([u.hp, t.hp], hp);
  assert.equal(t.elem.burn ?? 0, 0);
  assert.equal(h.hooksOf('hit').length, 0);
  assert.equal(b.projectiles.list.length, 0);
});

test('Yu rolls once per collision entry, honours removal metadata and leaves direct damage alone', () => {
  for (const [extra, removable] of [[{}, true], [{ removable: false }, false], [{ visual: 'none' }, false],
    [{ visual: 'none', speedChangeable: true }, true], [{ speedChangeable: false, removable: true }, true]]) {
    const { b, t, e } = wall();
    let rolls = 0, impacts = 0;
    b.rng = () => { rolls++; return 0.999999; };
    flight(b, e, () => { impacts++; }, extra);
    assert.equal(rolls, removable ? 1 : 0);
    assert.equal(impacts, 1);
    b.rng = () => { throw new Error('direct damage must not attempt projectile interception'); };
    assert.equal(b.dealDamage({ source: e, target: t, amount: 10, type: 'true', isProjectile: true }), 10);
  }
});

test('Yu collision uses tick position: a fast projectile can skip the strip; a stationary one draws nothing', () => {
  const { b, e } = wall();
  let rolls = 0, impacts = 0;
  b.rng = () => { rolls++; return 0; };
  flight(b, e, () => { impacts++; }, { from: { x: 6, y: 10 }, speed: 60 });
  assert.equal(impacts, 1);
  assert.equal(rolls, 0);
  const still = b.addProjectile({ source: e, from: { x: 5.5, y: 10 }, to: { x: 4, y: 10 }, speed: 0 });
  b.projectiles.update(1 / 30);
  assert.equal(still.x, 5.5);
  assert.equal(rolls, 0);
});

test('Yu no longer intercepts after skill end', () => {
  const { b, u, e } = wall();
  u.skill.end('test');
  b.rng = () => { throw new Error('inactive wall'); };
  let impacts = 0;
  flight(b, e, () => { impacts++; });
  assert.equal(impacts, 1);
});

test('Yu wall does not extend beyond the battlefield', () => {
  const { b, e } = wall();
  b.rng = () => { throw new Error('outside the field'); };
  let impacts = 0;
  flight(b, e, () => { impacts++; }, { from: { x: 7, y: b.rect.r1 + 2 }, to: { x: 4, y: b.rect.r1 + 2 } });
  assert.equal(impacts, 1);
});

test('projectiles created by flight hooks wait for the next update, and cancelling a landing skips its callback', () => {
  let born = null, impacts = 0;
  const battle = { _hooks: { projectileStep: true }, _safe: fn => fn(), emit(_event, ctx) {
    if (!born) born = system.add({ from: { x: 0, y: 0 }, to: { x: 3, y: 0 }, speed: 1 });
    ctx.cancel = true;
  } };
  const system = new ProjectileSystem(battle);
  system.add({ from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, speed: 1, onHit() { impacts++; } });
  system.update(1);
  assert.equal(impacts, 0);
  assert.deepEqual(system.list, [born]);
  assert.equal(born.x, 0);
  system.update(1);
  assert.equal(system.list.length, 0);
});
