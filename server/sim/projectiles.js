// server/sim/projectiles.js — projectile flight & impact (DESIGN §5.4 addProjectile).
//
// A projectile homes on `target` (a unit) or flies to a fixed point `to` ({x,y}). On arrival `onHit(ctx)` runs
// with ctx = { battle, projectile, target (null if it died / point shot), x, y }. When a homing target dies
// mid-flight the projectile fizzles, unless `hitDead: true` (then it lands at the last known position).

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
    const visual = p.visual ?? 'arrow';
    const speedChangeable = p.speedChangeable ?? (visual !== 'none' && visual !== '');
    const proj = {
      id: ++seq,
      x: fx,
      y: fy,
      target,
      // the target "life" it was fired at: an op that dies and is redeployed mid-flight is a new target (fizzle)
      tseq: target ? target.deploySeq : 0,
      tx: fin(p.to ? p.to.x : (target ? target.x : fx), fx),
      ty: fin(p.to ? p.to.y : (target ? target.y : fy), fy),
      speed: Number.isFinite(p.speed) && p.speed >= 0 ? p.speed : PROJECTILE_SPEED,
      onHit: p.onHit ?? null,
      visual,
      speedChangeable,
      // PRTS 弹道: automatic removal follows speed-change eligibility, normally visible VFX.
      removable: p.removable ?? speedChangeable,
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
    const moving = this.list;
    this.list = []; // flight hooks may spawn projectiles; those start moving on the next update.
    for (const p of moving) {
      p.age += dt;
      if (p.target) {
        if (p.target.alive && !p.target.hidden && p.target.deploySeq === p.tseq) { p.tx = fin(p.target.x, p.tx); p.ty = fin(p.target.y, p.ty); }
        else if (!p.hitDead) continue; // fizzle
        else p.target = null;
      }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = hypot(dx, dy);
      const step = p.speed * dt;
      const lands = d <= step || p.age >= p.maxAge;
      if (lands) {
        p.x = p.tx; p.y = p.ty;
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
      if (this.battle._hooks.projectileStep) {
        const ctx = { projectile: p, cancel: false };
        this.battle.emit('projectileStep', ctx);
        if (ctx.cancel) continue;
      }
      if (lands) arrived.push(p);
      else keep.push(p);
    }
    this.list = keep.concat(this.list);
    for (const p of arrived) {
      if (!p.onHit) continue;
      const t = p.target && p.target.alive && p.target.deploySeq === p.tseq ? p.target : null;
      this.battle._safe(() => p.onHit({ battle: this.battle, projectile: p, target: t, x: p.x, y: p.y }), 'projectile.onHit', p.source);
    }
  }

  clear() { this.list = []; }
}
