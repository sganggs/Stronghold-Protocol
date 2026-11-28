// render/vfx/bouncefx.js — BouncedAdvancedMovement as straight hops (round 88 lane g2: 真言 S3).
//
// index.json projectile_chr_mantra_s3_2 is a BounceProjectile. Its movement class is BouncedAdvancedMovement,
// moveType 1 (docs/design/vfx-format.md MoveType: TRACE_TARGET_WITH_SPEED — a straight homing leg, not a
// parabola; ParacurveMovement is the arc). `comeBack` is 0, so comeBackSpeedScale is unused. `speed` 30 is the
// first leg; `speedAfterFirstReach` 4 is every leg after the first reach. The main effect is
// mantra_bounce_trail_01; onHit is mantra_bounce_hit_01. `_clearMainEffectWhenReached` is 1, so the trail
// stops at the landing and the hit plays there. lifeTime is 0 and `_lifeTimeType` is 2, so there is no timed life.
//
// The kit (server/sim/content/kits/ops/op-mantra.js bounce) deals the first overflow hit at once and emits
// `mantraArc` at the holder. That event is a landing, not a flight from the caster, so the 30-tile/s first leg
// has no segment to draw: the client plays the onHit there and does not invent a shot from her. Each later hop
// is a sim projectile at JUMP_SPEED 3.2 with no client event of its own; the kit emits cosmetic `mantraHop`
// with the hop's endpoints and that speed. The visual follows that segment (the sim's flight), not the
// record's 4, so the spark lands with the damage. moveType is not an arc, so the segment is straight.
//
// The hit and the trail sit at the target's hit point, the same place mantra_skill_03_hit_01 and the attack hit
// play (mantra_bounce_hit_01's spawn is HIT_POINT). A hop's trail runs from the previous target's hit point to
// the next one's. A landing whose unit is already gone uses the tile surface (ctx.heightAt, else 0) plus that
// same hit-point offset, so a raised road does not leave the spark under the tile.
//
// With 官方特效 off, or the prefab missing, simFx returns false. `mantraArc` stays the procedural bolt.
// `mantraHop` is `{ a: 'none' }` in render/fx/kinds.js, so a missing prefab draws nothing (the hop had no
// procedural shot before). S2's chain bolts are a different event and are not touched. The skill's attack
// projectile is projectile_chr_mantra_s3, not this one.

import { boardToUnity } from './math.js';
import { projectileParts } from './flight.js';
import { unitPoint } from './mounts.js';

const ID_ROT = Object.freeze([0, 0, 0, 1]);
const PROJ_ID = 'projectile_chr_mantra_s3_2';
const SKILL_ID = 'skchr_mantra_3';
const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);

/**
 * BouncedAdvancedMovement at moveType 1, or null. A different moveType is not drawn (this file does not
 * invent an arc). `speed` is the first leg; `speedAfter` is `speedAfterFirstReach` when the record sets it.
 * @param {any} proj
 */
export function bounceMotion(proj) {
  const mv = proj?.movement;
  if (!mv || mv.class !== 'BouncedAdvancedMovement') return null;
  if (Number(mv.moveType) !== 1) return null;
  const speed = Number(mv.speed);
  if (!(speed > 0)) return null;
  const after = Number(mv.speedAfterFirstReach);
  const main = projectileParts(proj).main || lc(proj.main);
  const onHit = (Array.isArray(proj.onHit) ? proj.onHit : []).map(lc).filter(Boolean);
  return Object.freeze({
    speed,
    speedAfter: after > 0 ? after : speed,
    comeBack: Number(mv.comeBack) === 1,
    main,
    onHit,
  });
}

/**
 * Straight segments through `points` ({ x, y, speed? }). Segment i uses the destination's `speed` when it
 * is set, else the record's first-leg speed, else `speedAfter`. `afterFirst` makes every unspecified
 * segment use `speedAfter` (a hop the kit already resolved past the first landing).
 * @returns {Array<{ x0: number, y0: number, x1: number, y1: number, speed: number, dur: number }>|null}
 */
export function bounceSegments(points, motion, { afterFirst = false } = {}) {
  if (!motion || motion.comeBack || !Array.isArray(points) || points.length < 2) return null;
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
    const own = Number(b.speed);
    const speed = own > 0 ? own : (i === 0 && !afterFirst ? motion.speed : motion.speedAfter);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, speed, dur: speed > 0 ? dist / speed : 0 });
  }
  return segs;
}

/** Point at fraction k (0…1) of a straight segment. */
export function bounceAt(seg, k) {
  const t = Math.max(0, Math.min(1, Number(k) || 0));
  return { x: seg.x0 + (seg.x1 - seg.x0) * t, y: seg.y0 + (seg.y1 - seg.y0) * t };
}

export class BounceFx {
  /** @param {import('./wiring.js').FxWiring} w */
  constructor(w) {
    this.w = w;
    /** @type {Array<{ h: any, x: number, y: number, z: number, yaw: number, born: number, dur: number, x0: number, y0: number, x1: number, y1: number, hit: boolean, onHit: string|null }>} */
    this.shots = [];
  }

  /**
   * `mantraArc`: the first overflow landing (no flight). `mantraHop`: one later hop, endpoints in the event.
   * True only when the official effect was spawned, so the procedural bolt stays otherwise.
   */
  simFx(kind, x, y, extra) {
    if ((kind !== 'mantraArc' && kind !== 'mantraHop') || !extra || !this.w.ofx.active) return false;
    const proj = this.w.idx?.projectiles?.[PROJ_ID];
    const motion = bounceMotion(proj);
    if (!motion || !this._owner(extra)) return false;
    if (kind === 'mantraArc') return this._land(x, y, motion, extra);
    return this._hop(x, y, extra, motion);
  }

  release() { /* hops are not tied to a unit's life: a shot already in the air finishes */ }

  clear() {
    for (const s of this.shots) s.h?.stop();
    this.shots.length = 0;
  }

  _owner(extra) {
    const v = extra.id != null ? this.w.view(extra.id) : null;
    if (!v) return null;
    const st = this.w.skills.state(v);
    if (!st.U || st.U.skillId !== SKILL_ID || !st.on) return null;
    return v;
  }

  _hitKey(motion) {
    const k = motion.onHit[0] || null;
    return k && this.w.ofx.lib.has(k) ? k : null;
  }

  _spark(x, y, z, key) {
    if (!key || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const h = this.w.ofx.spawn(key, { pos: boardToUnity(x, y, Number.isFinite(z) ? z : 0), yaw: 0, groundZ: 0, rootRot: ID_ROT }, { important: true });
    return !!h;
  }

  /** Tile surface at a board point (the field's heightAt), else 0. */
  _groundZ(x, y) {
    const hAt = this.w.ofx.ctx?.heightAt;
    if (typeof hAt !== 'function' || !Number.isFinite(x) || !Number.isFinite(y)) return 0;
    const h = Number(hAt(Math.round(y), Math.round(x)));
    return Number.isFinite(h) ? Math.max(0, h) : 0;
  }

  /** A view standing on this point (the hop's previous target is coordinates, not an id). */
  _viewAt(x, y) {
    const list = this.w.skills?.viewList;
    if (!Array.isArray(list)) return null;
    let best = null, bd = 0.35;
    for (const v of list) {
      if (!v || v.alive === false || v.destroyed) continue;
      const d = Math.hypot((v.x || 0) - x, (v.y || 0) - y);
      if (d <= bd) { bd = d; best = v; }
    }
    return best;
  }

  /**
   * Board height of a HIT_POINT: the unit's own point when `v` is there (the same spawnPoint playOn uses), else
   * the tile surface plus that offset. Above the tile either way.
   */
  _hitZ(v, x, y) {
    if (v && v.alive !== false && !v.destroyed) {
      return -unitPoint(this.w.skinOf(this.w.unitOf(v)), 'hit', this.w.pose(v))[2];
    }
    const z = this._groundZ(x, y);
    return -unitPoint(null, 'hit', { x, y, z, left: false, back: false })[2];
  }

  /**
   * The onHit on the unit it landed on, at the prefab's own spawn point (mantra_bounce_hit_01: HIT_POINT, where the
   * other hits on that enemy show), through FxWiring.playOn. When that unit is gone, the same hit-point height
   * above the tile, not the floor.
   */
  _hitOn(targetId, x, y, key) {
    if (!key) return false;
    const tv = targetId != null ? this.w.view(targetId) : null;
    if (tv && tv.alive !== false && !tv.destroyed) {
      const h = this.w.playOn(key, tv, { important: true });
      if (h) return true;
    }
    return this._spark(x, y, this._hitZ(tv && tv.alive !== false && !tv.destroyed ? tv : null, x, y), key);
  }

  _land(x, y, motion, extra) {
    const key = this._hitKey(motion);
    if (!key || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return this._hitOn(extra?.target, x, y, key);
  }

  _hop(x, y, extra, motion) {
    const tx = Number(extra.tx), ty = Number(extra.ty);
    const kit = Number(extra.speed);
    const segs = bounceSegments(
      [{ x, y }, { x: tx, y: ty, speed: kit > 0 ? kit : undefined }],
      motion,
      { afterFirst: true },
    );
    const seg = segs && segs[0];
    if (!seg) return false;
    const hit = this._hitKey(motion);
    if (!(seg.dur > 0)) return hit ? this._hitOn(extra.target, seg.x1, seg.y1, hit) : false;
    if (!motion.main || !this.w.ofx.lib.has(motion.main)) return false;
    const fromV = this._viewAt(seg.x0, seg.y0);
    const toV = extra.target != null ? this.w.view(extra.target) : this._viewAt(seg.x1, seg.y1);
    const z0 = this._hitZ(fromV, seg.x0, seg.y0);
    const z1 = this._hitZ(toV, seg.x1, seg.y1);
    const shot = {
      h: null, x: seg.x0, y: seg.y0, z: z0, yaw: Math.atan2(seg.y1 - seg.y0, seg.x1 - seg.x0),
      born: this.w.ofx.time || 0, dur: seg.dur, x0: seg.x0, y0: seg.y0, z0, x1: seg.x1, y1: seg.y1, z1,
      hit: false, onHit: hit, target: extra.target ?? null,
    };
    shot.h = this.w.ofx.spawn(motion.main, {
      pos: boardToUnity(shot.x, shot.y, z0), yaw: shot.yaw, groundZ: 0, rootRot: ID_ROT,
    }, {
      important: true, loop: true,
      track: (fx) => {
        this._place(shot);
        boardToUnity(shot.x, shot.y, shot.z, fx.anchor);
        fx.yaw = shot.yaw;
        fx.pitch = 0;
        fx.mirror = false;
      },
    });
    if (!shot.h) return false;
    this.shots.push(shot);
    return true;
  }

  _place(shot) {
    if (shot.hit) return;
    const now = this.w.ofx.time || 0;
    const k = shot.dur > 0 ? Math.min(1, Math.max(0, (now - shot.born) / shot.dur)) : 1;
    const p = bounceAt(shot, k);
    shot.x = p.x;
    shot.y = p.y;
    shot.z = shot.z0 + (shot.z1 - shot.z0) * k;
    if (k < 1) return;
    shot.hit = true;
    shot.h?.stop();
    if (shot.onHit) this._hitOn(shot.target, shot.x1, shot.y1, shot.onHit);
    // the hop is over: drop it, or every hop of the battle stays listed with its handle until clear() (round 88
    // on-screen check: 12 s into a 真言 S3 cast, 9 landed hops were still listed; the golden diy-030 battle flies 510)
    const i = this.shots.indexOf(shot);
    if (i >= 0) this.shots.splice(i, 1);
  }
}
