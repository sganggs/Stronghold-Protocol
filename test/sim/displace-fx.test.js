// The contract between server/sim/battle/displacement.js and render/app.js: a displacement puts a
// ['fx', 'displace', x, y, { id }] tuple into the stream the client renders. The client must read the destination
// from the tuple's own slots — e[4] carries the id only, and reading x/y from it silently produced NaN, which made
// slideTo a no-op (player report: 有停顿但没有中间帧).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

const walker = (o = {}) => enemyRec({ key: 'enemy_walker', hp: 1e6, speed: 1, ...o });

test('a displacement puts a `displace` fx into the event stream the client receives', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_walker: walker({ speed: 0.01 }) } },
    enemies: [{ key: 'enemy_walker', pos: [10, 6] }],
    content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_walker');
  h.b.drainEvents();                                   // clear the spawn/etc. batch
  const moved = h.b.displace(e, { x: 1, y: 0 }, 2, { force: 1 });
  assert.ok(moved > 1.8, 'the enemy moved: ' + moved);
  const evs = h.b.drainEvents();
  const fx = (evs || []).filter((t) => Array.isArray(t) && t[0] === 'fx');
  const disp = fx.find((t) => t[1] === 'displace');
  assert.ok(disp, 'the stream carries a displace fx: ' + JSON.stringify(fx));
  // the fx rounds its coordinates to 2 decimals (events.js fx), the unit keeps full precision
  assert.ok(Math.abs(disp[2] - e.x) <= 0.01, 'e[2] is the destination x: ' + disp[2] + ' vs ' + e.x);
  assert.ok(Math.abs(disp[3] - e.y) <= 0.01, 'e[3] is the destination y: ' + disp[3] + ' vs ' + e.y);
  assert.equal(disp[4] && disp[4].id, e.id, 'e[4].id is the displaced unit');
  assert.equal(disp[4].x, undefined, 'e[4] carries no x — reading it gave NaN, so no slide ever ran');
  assert.equal(disp[4].y, undefined, 'e[4] carries no y either');
});

test('directional and radial pushes and hook pulls preserve facing; explicit overrides and raw moves do not', () => {
  for (const directional of [false, true]) {
    const h = makeBattle({
      defs: { enemies: { enemy_walker: walker({ speed: 0.01 }) } },
      enemies: [{ key: 'enemy_walker', pos: [10, 6] }],
      content: 'none', autoFinish: false,
    });
    h.step();
    const e = h.enemy('enemy_walker');
    h.b.drainEvents();
    const from = { x: 5, y: 10 };
    const opts = directional ? { from, dir: { x: 1, y: 0 } } : { from };
    assert.ok(h.b.push(e, 0, opts) > 0);
    const fx = () => h.b.drainEvents().find((ev) => ev[0] === 'fx' && ev[1] === 'displace');
    assert.equal(fx()?.[4]?.keepFacing, true, 'both official push direction classes preserve the prior facing');

    assert.ok(h.b.pull(e, 0, { to: { x: 5, y: 10 } }) > 0);
    assert.equal(fx()?.[4]?.keepFacing, true, 'hook pull preserves the pre-hit facing by default');

    assert.ok(h.b.pull(e, 0, { to: { x: 9, y: 10 }, keepFacing: false }) > 0);
    assert.equal(fx()?.[4]?.keepFacing, undefined, 'a pull source can opt out');

    assert.ok(h.b.push(e, 0, { ...opts, keepFacing: false }) > 0);
    assert.equal(fx()?.[4]?.keepFacing, undefined, 'a push source can opt out');

    assert.ok(h.b.displace(e, { x: -1, y: 0 }, 0.2) > 0);
    assert.equal(fx()?.[4]?.keepFacing, undefined, 'raw displace remains unmarked');
  }
});
