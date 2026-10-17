// server/sim/projectiles.js — projectile flight & impact (DESIGN §5.4 addProjectile).
//
// A projectile homes on `target` (a unit) or flies to a fixed point `to` ({x,y}). On arrival `onHit(ctx)` runs
// with ctx = { battle, projectile, target (null if it died / point shot), x, y }. When a homing target dies
// mid-flight the projectile fizzles, unless `hitDead: true` (then it lands at the last known position).
//
// `steer` is the content-owned flight path: every tick, after the homing target was refreshed and before the step, the
// projectile asks its own kit where to aim — `steer({ battle, projectile, dt })` may return `{ x, y }` (a drift, a beat,
// a curve that follows a body of its own; the homing target is dropped, the kit then owns the aim) and anything else
// keeps the straight line the projectile had. Arrival is still the ordinary step test, so a steer has to answer a point
// farther than one step to keep the projectile flying: an aim inside its own step lands it now (and `onHit` runs at that
// steered point), while one that only ever answers far points keeps the projectile alive until `maxAge`. The call is
// isolated like `onHit` (`battle._safe`): a throwing steer leaves the projectile on its last aim instead of ending the
// battle.

import { PROJECTILE_SPEED } from './constants.js';
import { hypot } from './detmath.js';

let seq = 0;
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class ProjectileSystem {
  constructor(battle) {
    this.battle = battle;
    /** @type {object[]} */
    this.list = [];
  }

  add(p) {
    const from = p.from || { x: 0, y: 0 };
    // non-finite coordinates would never "arrive" (NaN distance) and leak the projectile for maxAge
    const fx = fin(from.x, 0), fy = fin(from.y, 0);
    const target = p.target && typeof p.target === 'object' ? p.target : null;
    const proj = {
      id: ++seq,
      x: fx,
      y: fy,
      target,
      // the target "life" it was fired at: an op that dies and is redeployed mid-flight is a new target (fizzle)
      tseq: target ? target.deploySeq : 0,
      tx: fin(p.to ? p.to.x : (target ? target.x : fx), fx),
      ty: fin(p.to ? p.to.y : (target ? target.y : fy), fy),
      speed: p.speed > 0 ? p.speed : PROJECTILE_SPEED,
      onHit: p.onHit ?? null,
      steer: typeof p.steer === 'function' ? p.steer : null,
      visual: p.visual ?? 'arrow',
      source: p.source ?? (p.from && p.from.id != null ? p.from : null),
      hitDead: !!p.hitDead,
      data: p.data ?? null,
      age: 0,
      maxAge: p.maxAge > 0 ? p.maxAge : 10,
    };
    this.list.push(proj);
    return proj;
  }

  update(dt) {
    if (!this.list.length) return;
    const keep = [];
    const arrived = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.target) {
        if (p.target.alive && !p.target.hidden && p.target.deploySeq === p.tseq) { p.tx = fin(p.target.x, p.tx); p.ty = fin(p.target.y, p.ty); }
        else if (!p.hitDead) continue; // fizzle
        else p.target = null;
      }
      if (p.steer) {
        // the kit's own path for this tick (header): it may redirect the aim; its homing target then no longer applies
        let aim = null;
        this.battle._safe(() => { aim = p.steer({ battle: this.battle, projectile: p, dt }); }, 'projectile.steer', p.source);
        if (aim && typeof aim === 'object' && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
          p.tx = aim.x; p.ty = aim.y;
          p.target = null;
        }
      }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step || p.age >= p.maxAge) {
        p.x = p.tx; p.y = p.ty;
        arrived.push(p);
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        keep.push(p);
      }
    }
    this.list = keep;
    for (const p of arrived) {
      if (!p.onHit) continue;
      const t = p.target && p.target.alive && p.target.deploySeq === p.tseq ? p.target : null;
      this.battle._safe(() => p.onHit({ battle: this.battle, projectile: p, target: t, x: p.x, y: p.y }), 'projectile.onHit', p.source);
    }
  }

  clear() { this.list = []; }
}
