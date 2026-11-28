// render/vfx/orbitfx.js — an official projectile whose movement is RotateAroundMovement, drawn as one orbit
// around its owner (round 88 lane g2: 魔王's 微尘).
//
// The index projectile (public/assets/local/fx/index.json projectile_chr_cetsyr_talent and the per-skill copies)
// gives the trail (`main`) and `clockwise`. It names no start angle (every arc-start field is 0) and no count.
// Count is the snapshot `motes` the kit already publishes (server/sim/snapshot.js moteView ← chess_char_4_25-cetsyr.js
// moteRing). Phase is battle time (`view.gameT`, the same clock a reconnect and a spectator sample), so a late join
// does not restart at 0.
//
// Turn speed and radius are NOT the record's. The projectile says `aroundSpeed` 150 and radius 1 (S2's copy: 0.01),
// but the talent blackboard the sim orbits by says `dynamic_spd` 30°/s and `range_radius` 1.15 tiles, S2
// `outside_radius` 2 (maintainer review 2026-10-15, render/motes.js; the hidden 5★ kit collides on exactly that
// orbit). The ability most likely writes its blackboard into the projectile at runtime [ASSUMED]. The official
// effect replaces the stand-in for the same motion, so the trail turns exactly like MoteRing: 30°/s
// (MOTE_PERIOD 12 s), 1.15 tiles, S2's `wide` 2 tiles. [ASSUMED] `clockwise` 0 turns counter-clockwise in board
// x/y (angle increases), and the motes are spaced evenly. The projectile's `_lifeTimeType` is 2, not the LIMITED
// enum flight.js treats as a hard life, and the snapshot has no projectile age, so lifeTime 20 is not a client
// despawn: the orbit lasts while the snapshot still counts motes. `_stopWhenSourceInvalid` stops it when the
// owner is gone.
//
// One orbit, not two. skchr_cetsyr_1's projectile_chr_cetsyr_talent_s1 is the same trail, radius and speed as the
// talent projectile; the player keeps the talent orbiter and does not spawn a second body. While skchr_cetsyr_2
// is on, the body is projectile_chr_cetsyr_talent_s2 (`aroundSpeed` 0.01, trail cetsyr_skill_02_trail_01). While
// skchr_cetsyr_3 is on, it is projectile_chr_cetsyr_talent_s3 (trail cetsyr_skill_03_trail_01, speed 150). The
// talent ability still names only projectile_chr_cetsyr_talent on those buff edges; a second copy is not drawn.
// The orbit radius follows the snapshot's `wide` (S2's outside_radius) as MoteRing does.
//
// The orbit plane is not the tile surface. The talent ability launches from mount MUZZLE. char_4134_cetsyr's
// exported skin has no Muzzle point (HitPoint and HeadPoint only), so the plane sits on the HitPoint, about a
// quarter tile above her feet, and a raised tile lifts it with her. [ASSUMED] nobody has compared this height
// with the official client. Radius and 30°/s are unchanged.
//
// With 官方特效 off, or the trail missing, nothing here is spawned and the view's `officialMotes` stays false, so
// render/units.js keeps MoteRing exactly as it is.

import { boardToUnity } from './math.js';
import { projectileParts } from './flight.js';
import { skinPoint, unitPoint } from './mounts.js';
import { MOTE_PERIOD, MOTE_ORBIT_TILES } from '../motes.js';

const ID_ROT = Object.freeze([0, 0, 0, 1]);
const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);

/** Projectile ids. S1's copy is listed so the sweep can see it; the player does not fly it. */
export const CETSYR_ORBIT = Object.freeze({
  talent: 'projectile_chr_cetsyr_talent',
  s1: 'projectile_chr_cetsyr_talent_s1',
  s2: 'projectile_chr_cetsyr_talent_s2',
  s3: 'projectile_chr_cetsyr_talent_s3',
  unit: 'char_4134_cetsyr',
});

/**
 * The one orbiting projectile shown for 魔王's equipped skill. S1 and a skill that is off keep the talent
 * orbiter. S2 and S3 replace it for the time the skill is on. Never two at once.
 * @param {string|null} skillId
 * @param {boolean} skillOn
 */
export function cetsyrOrbitKey(skillId, skillOn) {
  if (skillOn && skillId === 'skchr_cetsyr_2') return CETSYR_ORBIT.s2;
  if (skillOn && skillId === 'skchr_cetsyr_3') return CETSYR_ORBIT.s3;
  return CETSYR_ORBIT.talent;
}

/** The reviewed turn speed of 魔王's motes (render/motes.js MOTE_PERIOD: `dynamic_spd` 30°/s). */
export const ORBIT_DEG_PER_SEC = 360 / MOTE_PERIOD;

/**
 * Board height of 魔王's orbit plane. MUZZLE when the skin exports one, otherwise HitPoint (she does not).
 * `pose.z` is the tile surface; the point's height is added, so a raised tile does not leave the motes in the road.
 * [ASSUMED] not compared with the official client.
 * @param {any} skin
 * @param {{ x: number, y: number, z?: number, left?: boolean, back?: boolean, scale?: number, tilt?: number, view?: any }} pose
 */
export function orbitPlaneZ(skin, pose) {
  const kind = skinPoint(skin, 'muzzle', !!pose?.back) ? 'muzzle' : 'hit';
  const p = unitPoint(skin, kind, pose || { x: 0, y: 0, z: 0 });
  return -p[2];
}

/**
 * RotateAroundMovement, or null for any other class. `main` is the flying effect and `clockwise` the record's
 * turn direction. Radius and speed are MoteRing's (see the header): 1.15 tiles, or 2 with `wide`, at 30°/s. The
 * record's own numbers stay in `record` for reference only.
 * @param {any} proj index projectile
 * @param {boolean|number} [wide] S2's wider orbit (the snapshot's `motes.wide`)
 */
export function orbitMotion(proj, wide = false) {
  const mv = proj?.movement;
  if (!mv || mv.class !== 'RotateAroundMovement') return null;
  const main = projectileParts(proj).main || lc(proj.main);
  if (!main) return null;
  return Object.freeze({
    radius: wide ? MOTE_ORBIT_TILES.wide : MOTE_ORBIT_TILES.normal,
    degPerSec: ORBIT_DEG_PER_SEC,
    clockwise: Number(mv.clockwise) === 1,
    main,
    record: Object.freeze({ radius: Number(mv.projectileAroundRadius), degPerSec: Number(mv.aroundSpeed) }),
  });
}

/**
 * Board offset of mote `i` of `n` at battle time `t` (seconds). Angle 0 is +x. Even spacing, then
 * ORBIT_DEG_PER_SEC, counter-clockwise unless `clockwise`.
 * @returns {{ x: number, y: number, yaw: number }}
 */
export function orbitOffset(t, i, n, motion) {
  const count = n > 0 ? n : 1;
  const dir = motion.clockwise ? -1 : 1;
  const ang = (i * 2 * Math.PI) / count + dir * motion.degPerSec * (Math.PI / 180) * t;
  return {
    x: Math.cos(ang) * motion.radius,
    y: Math.sin(ang) * motion.radius,
    // [ASSUMED] face along the orbit. rotateToTarget is 1 and no field names an inward facing.
    yaw: ang + (dir > 0 ? Math.PI / 2 : -Math.PI / 2),
  };
}

export class OrbitFx {
  /** @param {import('./wiring.js').FxWiring} w */
  constructor(w) {
    this.w = w;
    /** @type {Map<any, { key: string, bodies: Array<{ h: any, x: number, y: number, z: number, yaw: number }> }>} */
    this.rings = new Map();
  }

  /**
   * One pass after the views took the snapshot (wiring.sync, before UnitView.update). Rebuilds from `v.motes`.
   * Sets `v.officialMotes` only while the official trail is actually in the air.
   */
  sync(views) {
    const list = Array.isArray(views) ? views : [...views];
    const seen = new Set();
    for (const v of list) {
      const id = v?.id ?? v?.info?.id;
      if (id == null) continue;
      if (this._apply(v, id)) seen.add(id);
      else this._drop(id, v);
    }
    for (const id of [...this.rings.keys()]) if (!seen.has(id)) this._drop(id);
  }

  release(v) {
    const id = v?.id ?? v?.info?.id;
    if (id == null) return;
    this._drop(id, v);
  }

  clear() {
    for (const id of [...this.rings.keys()]) this._drop(id);
  }

  _apply(v, id) {
    const n = v?.motes?.n | 0;
    if (!(n > 0) || v.alive === false || v.destroyed) {
      if (v) v.officialMotes = false;
      return false;
    }
    if (this.w.unitKeyOf(v) !== CETSYR_ORBIT.unit) return false;
    const st = this.w.skills.state(v);
    const key = cetsyrOrbitKey(st.U?.skillId || null, !!st.on);
    const proj = this.w.idx?.projectiles?.[key];
    const motion = orbitMotion(proj, !!v.motes?.wide);
    if (!this.w.ofx.active || !motion || !this.w.ofx.lib.has(motion.main)) {
      if (v) v.officialMotes = false;
      return false;
    }
    let ring = this.rings.get(id);
    if (!ring || ring.key !== key) {
      if (ring) this._stop(ring);
      ring = { key, bodies: [] };
      this.rings.set(id, ring);
    }
    const plane = orbitPlaneZ(this.w.skinOf(this.w.unitOf(v)), this.w.pose(v));
    while (ring.bodies.length > n) ring.bodies.pop().h?.stop();
    while (ring.bodies.length < n) {
      const body = { h: null, x: v.x, y: v.y, z: plane, yaw: 0 };
      body.h = this.w.ofx.spawn(motion.main, {
        pos: boardToUnity(v.x, v.y, plane), yaw: 0, groundZ: 0, rootRot: ID_ROT,
      }, {
        important: true, loop: true,
        track: (fx) => {
          boardToUnity(body.x, body.y, body.z, fx.anchor);
          fx.yaw = body.yaw;
          fx.pitch = 0;
          fx.mirror = false;
        },
      });
      if (!body.h) {
        this._stop(ring);
        this.rings.delete(id);
        v.officialMotes = false;
        return false;
      }
      ring.bodies.push(body);
    }
    const t = Number.isFinite(v.gameT) ? v.gameT : (this.w.ofx.time || 0);
    for (let i = 0; i < n; i++) {
      const off = orbitOffset(t, i, n, motion);
      const body = ring.bodies[i];
      body.x = v.x + off.x;
      body.y = v.y + off.y;
      body.z = plane;
      body.yaw = off.yaw;
    }
    v.officialMotes = true;
    return true;
  }

  _drop(id, v) {
    const ring = this.rings.get(id);
    if (ring) { this._stop(ring); this.rings.delete(id); }
    if (v) v.officialMotes = false;
  }

  _stop(ring) {
    for (const b of ring.bodies) b.h?.stop();
    ring.bodies.length = 0;
  }
}
