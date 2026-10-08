// server/sim/projectiles.js — projectile flight & impact (DESIGN §5.4 addProjectile).
//
// A projectile homes on `target` (a unit) or flies to a fixed point `to` ({x,y}). On arrival `onHit(ctx)` runs
// with ctx = { battle, projectile, target (null if it died / point shot), x, y }. When a homing target dies
// mid-flight the projectile fizzles, unless `hitDead: true` (then it lands at the last known position).
//
// `steer(p, dt) → boolean` (an option of addProjectile) hands ONE projectile's movement to its content: the system then
// calls it every step instead of the straight-line move, and returning true is the arrival (`onHit` runs as usual).
// Everything else — id, age / maxAge, data, visual, the `target` fizzle, the handler-error isolation — stays the
// system's, so a content-owned flight is still an ordinary projectile for the rest of the engine and its snapshots.

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
      if (p.steer) {
        // content-owned flight (see the header): a throwing / non-boolean `steer` must not leak the projectile
        let done = false;
        try { done = !!p.steer(p, dt); } catch (e) { done = true; this.battle._handlerError('projectile.steer', p.source, e); }
        if (done || p.age >= p.maxAge) arrived.push(p);
        else keep.push(p);
        continue;
      }
      if (p.target) {
        if (p.target.alive && !p.target.hidden && p.target.deploySeq === p.tseq) { p.tx = fin(p.target.x, p.tx); p.ty = fin(p.target.y, p.ty); }
        else if (!p.hitDead) continue; // fizzle
        else p.target = null;
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
