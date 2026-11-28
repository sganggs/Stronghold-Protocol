// render/vfx/radianfx.js — 赛柯 (token_10052_radian_tower2) official shots.
//
// The tower's trait never emits an 'atk' (op-radian.js fireVolley). Each shot is a kit fx: 'strike' in the
// Default mode, 'volley' while 电弧 S2 is on. The index still has the attacks: Default flies
// projectile_chr_radian_tower2 (start token_raidian_tower2_start_01, trail _trail_01, hit _hit_01) from MUZZLE;
// S2 flies projectile_chr_radian_tower2_s2 (start_01 / start_02 / start_03, trail _trail_02, the same hit) from
// SPECIAL_7. Both movements are FarthestPointMovement with useSourceDirection, speed 5. The event names no enemy:
// the bullet flies along the tower's facing for its life, and the hit plays where that life ends.
//
// S2's SimpleProjectile has _getLifeTimeFromBB 1 and a recorded lifeTime of 10. That 10 is the blackboard slot,
// not the flight. The kit reads attack@projectile_life_time (0.6 at rank 4, 0.8 at rank 7). [ASSUMED] 0.6 when
// the token record has no such blackboard. The Default projectile's own 0.6 is used as recorded.
//
// [ASSUMED] one trail per event. The extracted attack lists one projectileKey; the three S2 start prefabs are the
// three muzzle flashes. The sim still fires three bullets. This does not invent two extra trails.
//
// With 官方特效 off, or the trail or the hit missing, nothing here is spawned and the procedural strike stays.

import { boardToUnity } from './math.js';
import { mountPoint, unitPoint } from './mounts.js';
import { mountPointType } from './skills.js';

const ID_ROT = Object.freeze([0, 0, 0, 1]);
/** 赛柯. */
export const TOWER2 = 'token_10052_radian_tower2';
const BB_LIFE = 'attack@projectile_life_time';
/** [dCol, dRow]. Row 0 is the bottom row, so UP is +row (server/sim/dir.js DIR_VEC). */
const STEP = Object.freeze({ UP: [0, 1], RIGHT: [1, 0], DOWN: [0, -1], LEFT: [-1, 0] });
const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);

/**
 * Flight seconds of 赛柯's projectile. A SimpleProjectile with `_getLifeTimeFromBB` uses the token skill's
 * `attack@projectile_life_time`. Otherwise the record's lifeTime. [ASSUMED] 0.6 when that blackboard is absent
 * (the S2 record's lifeTime 10 is not the flight).
 * @param {import('./wiring.js').FxWiring} w
 * @param {any} v the tower view
 * @param {any} proj
 */
export function towerShotLife(w, v, proj) {
  const beh = (Array.isArray(proj?.behaviours) ? proj.behaviours : []).find((b) => b && b.class === 'SimpleProjectile');
  const recorded = Number(proj?.lifeTime);
  const fromBB = Number(beh?.fields?._getLifeTimeFromBB) === 1;
  if (!fromBB) return recorded > 0 ? recorded : 0.6;
  let bb = NaN;
  try {
    const rec = typeof w?.opts?.record === 'function' ? w.opts.record(v?.info) : null;
    bb = Number(rec?.skill?.bb?.[BB_LIFE]);
  } catch { /* a throwing lookup is no blackboard */ }
  return bb > 0 ? bb : 0.6;
}

/** Board step [dCol, dRow] of a facing. Junk is RIGHT. */
export function towerStep(dir) {
  const d = typeof dir === 'string' ? dir.toUpperCase() : '';
  return STEP[d] || STEP.RIGHT;
}

function castKeys(attack) {
  const out = [];
  for (const row of attack?.cast || []) {
    const list = Array.isArray(row?.effects) ? row.effects : Array.isArray(row?.keys) ? row.keys : row?.key ? [row.key] : [];
    for (const k of list) { const key = lc(k); if (key) out.push(key); }
  }
  return out;
}

function isTower(w, v) {
  if (!v) return false;
  if (w.unitKeyOf(v) === TOWER2) return true;
  return v.info?.defId === TOWER2 || v.info?.spine === TOWER2;
}

export class RadianFx {
  /** @param {import('./wiring.js').FxWiring} w */
  constructor(w) {
    this.w = w;
    /** @type {Array<{ h: any, x0: number, y0: number, z: number, x1: number, y1: number, yaw: number, born: number, dur: number, hit: string, done: boolean }>} */
    this.shots = [];
  }

  /**
   * 'strike' (Default) or 'volley' (S2). True only when the trail was spawned, so the procedural strike stays.
   * @param {string} kind
   * @param {number} _x
   * @param {number} _y
   * @param {any} extra
   */
  simFx(kind, _x, _y, extra) {
    if ((kind !== 'strike' && kind !== 'volley') || !extra || !this.w.ofx.active) return false;
    const v = extra.id != null ? this.w.view(extra.id) : null;
    if (!v || v.alive === false || v.destroyed || !isTower(this.w, v)) return false;
    const unit = this.w.idx?.units?.[TOWER2];
    const attack = (unit?.modes || []).find((m) => m && m.name === (kind === 'volley' ? 'S2' : 'Default'))?.attack;
    const proj = attack?.projectileKey ? this.w.idx?.projectiles?.[lc(attack.projectileKey)] : null;
    if (!attack || !proj || proj.movement?.class !== 'FarthestPointMovement') return false;
    const main = lc(proj.main);
    const hit = lc(Array.isArray(proj.onHit) ? proj.onHit[0] : null);
    if (!main || !hit || !this.w.ofx.lib.has(main) || !this.w.ofx.lib.has(hit)) return false;
    const speed = Number(proj.movement?.speed);
    const life = towerShotLife(this.w, v, proj);
    if (!(speed > 0) || !(life > 0)) return false;
    const skin = this.w.skinOf(this.w.unitOf(v));
    const pose = this.w.pose(v);
    const mount = mountPointType(attack.mount);
    const from = mount == null ? unitPoint(skin, 'muzzle', pose) : mountPoint(skin, mount, pose);
    const z = -from[2];
    const [dc, dr] = towerStep(v.dir);
    const dist = speed * life;
    const x1 = v.x + dc * dist;
    const y1 = v.y + dr * dist;
    const yaw = Math.atan2(dr, dc);
    const started = [];
    for (const key of castKeys(attack)) {
      if (!this.w.ofx.lib.has(key)) continue;
      const h = this.w.playOn(key, v, { important: true, strike: true });
      if (h) started.push(h);
    }
    const shot = {
      h: null, x0: v.x, y0: v.y, z, x1, y1, yaw,
      born: this.w.ofx.time || 0, dur: life, hit, done: false,
    };
    shot.h = this.w.ofx.spawn(main, {
      pos: from.slice(), yaw, groundZ: -(v.z || 0), rootRot: ID_ROT,
    }, {
      important: true, loop: true,
      track: (fx) => {
        if (shot.done) return;
        const now = this.w.ofx.time || 0;
        const k = shot.dur > 0 ? Math.min(1, Math.max(0, (now - shot.born) / shot.dur)) : 1;
        const x = shot.x0 + (shot.x1 - shot.x0) * k;
        const y = shot.y0 + (shot.y1 - shot.y0) * k;
        boardToUnity(x, y, shot.z, fx.anchor);
        fx.yaw = shot.yaw;
        fx.pitch = 0;
        fx.mirror = false;
        if (k < 1) return;
        shot.done = true;
        fx.stop({});
        this.w.ofx.spawn(shot.hit, {
          pos: boardToUnity(shot.x1, shot.y1, shot.z), yaw: shot.yaw, groundZ: 0, rootRot: ID_ROT,
        }, { important: true });
        const i = this.shots.indexOf(shot);
        if (i >= 0) this.shots.splice(i, 1);
      },
    });
    if (!shot.h) {
      for (const h of started) h.stop?.({});
      return false;
    }
    this.shots.push(shot);
    return true;
  }

  release() { /* a shot already in the air finishes */ }

  clear() {
    for (const s of this.shots) { s.done = true; s.h?.stop?.({}); }
    this.shots.length = 0;
  }
}
