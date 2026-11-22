// MAP10's frame mesh is static. The client attaches animated FX to its explicitly bound Special0 / Muzzle.
import { boardToUnity, quatMul, quatRotate } from './math.js';
import { paracurve, arcHeight } from './flight.js';

export const CANNON_UNIT = 'trap_196_cnnon';
export const CANNON_FX = Object.freeze({
  idle: 'trap_cnnon_idle',
  born: 'trap_cnnon_start',
  cast: 'trap_cnnon_attack_start',
  marker: 'trap_cnnon_lockon',
  trail: 'trap_cnnon_trail_1',
  hit: 'trap_cnnon_explode_1',
  unitHit: 'trap_cnnon_explode_hit',
  destroyed: 'trap_cnnon_destroyed',
});
const isCannon = (v) => v?.info?.defId === CANNON_UNIT;
// The mesh prefab and its FixedMuzzle are saved facing DOWN, as are MAP10's four stage records.
const angleOf = (v) => ({ DOWN: 0, RIGHT: Math.PI / 2, UP: Math.PI, LEFT: -Math.PI / 2 })[v.info?.dir || v.dir] ?? 0;

/** [ASSUMED] Register the authored ball's first pose to FixedMuzzle, without rewriting the original clip's keys.
 * The supplied client keeps an edit-time translation in every child of fixed (including the ball's curves).
 * FixedMuzzle references this clip at snapshotTime=0; exact native registration still needs a recorded comparison.
 */
export function cannonCastPlace(special, muzzle, def) {
  const ball = def?.nodes?.find((n) => n.name === 'ball');
  if (!special || !muzzle || !ball?.pos) return null;
  // This prefab has identity ancestors. Refuse a changed hierarchy rather than guess a new registration.
  for (let i = ball.parent; i != null && i >= 0; i = def.nodes[i]?.parent) {
    const n = def.nodes[i];
    if (
      !n ||
      n.pos?.some((v) => v !== 0) ||
      n.rot?.some((v, j) => v !== (j === 3 ? 1 : 0)) ||
      n.scale?.some((v) => v !== 1)
    )
      return null;
  }
  const offset = quatRotate(special.rootRot, ball.pos);
  return { ...special, pos: muzzle.pos.map((v, i) => v - offset[i]) };
}

export class CannonFx {
  constructor(wiring) {
    this.w = wiring;
    this.idle = new Map();
    this.markers = new Map();
    this.shots = new Set();
    this.ones = new Set();
    this.loading = null;
  }
  keys(views) {
    return [...views].some(isCannon) ? Object.values(CANNON_FX) : [];
  }
  _point(v, name) {
    const skin = this.w.idx?.skins?.[CANNON_UNIT],
      point = skin?.points?.[name]?.all;
    if (!point) return null; // older installs keep the existing procedural shot
    const a = angleOf(v),
      ca = Math.cos(a),
      sa = Math.sin(a),
      [x, y, z] = point.pos;
    const pos = boardToUnity(v.x + x * ca - y * sa, v.y + x * sa + y * ca, (v.z || 0) - z);
    return { pos, groundZ: -(v.z || 0), rootRot: quatMul([0, 0, Math.sin(a / 2), Math.cos(a / 2)], point.rot) };
  }
  _spawn(key, place, opts = {}) {
    if (!place || !this.w.ofx.active) return null;
    const h = this.w.ofx.spawn(key, place, opts);
    if (h && !opts.loop) this.ones.add(h);
    return h;
  }
  _ground(v) {
    return { pos: boardToUnity(v.x, v.y, v.z || 0), groundZ: -(v.z || 0), rootRot: [0, 0, 0, 1] };
  }
  _target(v) {
    const d = (this.w.opts.stage?.()?.devices || []).find(
      (d) => d.key === CANNON_UNIT && d.pos[0] === Math.round(v.y) && d.pos[1] === Math.round(v.x),
    );
    if (!(d?.cannon?.distance > 0)) return null;
    const a = angleOf(v),
      x = v.x + Math.sin(a) * d.cannon.distance,
      y = v.y - Math.cos(a) * d.cannon.distance;
    const ground = this.w.ofx.ctx?.heightAt?.(Math.round(y), Math.round(x)) || 0;
    return { pos: boardToUnity(x, y, ground), groundZ: -ground, rootRot: [0, 0, 0, 1] };
  }
  sync(views, { birth = true } = {}) {
    if (!this.w.ofx.active) {
      this.clear();
      return;
    }
    const keep = new Set();
    for (const v of views) {
      if (!isCannon(v) || v.alive === false || v.remove || v.destroyed) continue;
      keep.add(v.id);
      if (!this.idle.get(v.id)?.alive) {
        const h = this._spawn(CANNON_FX.idle, this._point(v, 'SpecialPoint0'), { owner: v, loop: true });
        if (h) {
          this.idle.set(v.id, h);
          if (birth) this._spawn(CANNON_FX.born, this._ground(v), { owner: v });
        }
      }
      if (!this.markers.get(v.id)?.alive) {
        // TargetEffectManager's projectile_cnnon_target_mark owns a separate persistent landing marker.
        const h = this._spawn(CANNON_FX.marker, this._target(v), { owner: v, loop: true });
        if (h) this.markers.set(v.id, h);
      }
    }
    for (const [id, h] of this.idle)
      if (!keep.has(id)) {
        h.kill();
        this.idle.delete(id);
      }
    for (const [id, h] of this.markers)
      if (!keep.has(id)) {
        h.kill();
        this.markers.delete(id);
      }
    for (const h of this.ones) if (!h.alive) this.ones.delete(h);
    for (const s of this.shots) if (!s.h.alive) this.shots.delete(s);
  }
  prep(board) {
    // [ASSUMED] Reuse battle idle and landing markers in preparation; the source only establishes live-entity effects.
    const devices = board?.board?.devices?.filter((d) => d.kind === 'cannon') || [];
    if (!devices.length || !this.w.ofx.active) {
      this.sync([]);
      return;
    }
    if (!this.w.idx) {
      this.loading ||= this.w
        .ready()
        .then(() => this.w.begin(devices.map((d) => ({ info: { defId: CANNON_UNIT }, id: d.key }))))
        .catch(() => {})
        .finally(() => {
          this.loading = null;
        });
      return;
    }
    this.sync(
      devices.map((d) => ({
        id: `${board.stage.id}:${d.r}:${d.c}`,
        info: { defId: CANNON_UNIT, dir: d.dir },
        x: d.c,
        y: d.r,
        z: d.z0,
        alive: true,
      })),
      { birth: false },
    );
  }
  simFx(kind, x, y, extra = {}) {
    if (!this.w.ofx.active || !['saltCannonShot', 'saltCannonHit'].includes(kind)) return false;
    const v = this.w.opts.view?.(extra.id);
    if (kind === 'saltCannonShot' && !isCannon(v)) return false;
    const ofx = this.w.ofx;
    const ground = ofx.ctx?.heightAt?.(Math.round(y), Math.round(x)) || 0;
    if (kind === 'saltCannonHit') {
      // The projectile's _effectsWhenHit plays once on each unit selected by the authoritative splash.
      for (const id of extra.targets || []) {
        const target = this.w.opts.view?.(id);
        if (!target || target.destroyed) continue;
        const h = this.w.playOn(CANNON_FX.unitHit, target);
        if (h) this.ones.add(h);
      }
      // The sim's impact event is authoritative; do not emit a second explosion at a visual timer's end.
      for (const s of this.shots)
        if (s.id === extra.id && ofx.time + 1e-6 >= s.end) {
          s.h.kill();
          this.shots.delete(s);
        }
      return !!this._spawn(CANNON_FX.hit, { pos: boardToUnity(x, y, ground), groundZ: -ground });
    }
    const special = this._point(v, 'SpecialPoint0');
    if (special) {
      // [ASSUMED] Register authored +Z motion (+Y up) to this shot, not the mesh's FBX axes; needs recorded calibration.
      const a = Math.atan2(y - v.y, x - v.x) - Math.PI / 2;
      special.rootRot = quatMul([0, 0, Math.sin(a / 2), Math.cos(a / 2)], [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    }
    const cast = cannonCastPlace(special, this._point(v, 'Muzzle'), ofx.lib.defs?.get(CANNON_FX.cast));
    this._spawn(CANNON_FX.cast, cast, { owner: v });
    const from = this._point(v, 'Muzzle')?.pos,
      mv = this.w.idx?.projectiles?.projectile_trap_cnnon_small?.movement;
    if (!from || !mv || !ofx.lib.has(CANNON_FX.trail) || !(extra.t > 0)) return false;
    const to = boardToUnity(x, y, ground),
      t0 = ofx.time,
      duration = extra.t;
    const arc = paracurve(mv, -from[2], ground, Math.hypot(to[0] - from[0], to[1] - from[1]));
    const point = (k) => [
      from[0] + (to[0] - from[0]) * k,
      from[1] + (to[1] - from[1]) * k,
      -(arc ? arcHeight(arc, k, ground) : -from[2] + (ground + from[2]) * k),
    ];
    const shot = { id: extra.id, end: t0 + duration, h: null };
    shot.h = ofx.spawn(
      CANNON_FX.trail,
      { pos: from, groundZ: -ground, rootRot: [0, 0, 0, 1] },
      {
        loop: true,
        important: true,
        track: (fx) => {
          const k = Math.max(0, Math.min(1, (ofx.time - t0) / duration)),
            p = point(k),
            q = point(Math.min(1, k + 0.02));
          fx.anchor[0] = p[0];
          fx.anchor[1] = p[1];
          fx.anchor[2] = p[2];
          fx.yaw = Math.atan2(q[1] - p[1], q[0] - p[0]);
          fx.pitch = Math.atan2(p[2] - q[2], Math.hypot(q[0] - p[0], q[1] - p[1]));
          if (k >= 1) {
            shot.h?.kill();
            this.shots.delete(shot);
          }
        },
      },
    );
    if (shot.h) this.shots.add(shot);
    return !!shot.h;
  }
  release(v, destroyed = false) {
    const h = this.idle.get(v.id);
    h?.kill();
    this.idle.delete(v.id);
    const marker = this.markers.get(v.id);
    marker?.kill();
    this.markers.delete(v.id);
    // Native _clearProjectileWhenDead=0: an already-fired shot survives the cannon's disappearance.
    return destroyed && !!this._spawn(CANNON_FX.destroyed, this._ground(v));
  }
  clear() {
    for (const h of this.idle.values()) h.kill();
    for (const h of this.markers.values()) h.kill();
    for (const s of this.shots) s.h.kill();
    for (const h of this.ones) h.kill();
    this.idle.clear();
    this.markers.clear();
    this.shots.clear();
    this.ones.clear();
  }
}
