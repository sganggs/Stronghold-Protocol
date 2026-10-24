// public/js/render/fx/projectiles.js — FxSystem shots, boomerangs, mortar shells and impacts.
// Installed on FxSystem.prototype by ./system.js (a method container: never instantiated; `this` is the effect system).

import { PROJ } from '../style.js';
import { SHOT_HEIGHT, bodyZ, feetZ } from './camera.js';
import { clamp } from './limits.js';
import { projSpeed } from './speeds.js';

const MAX_PROJ = 260;

/** Trail particles (and boomerang afterimages) per real second of one flying projectile (cosmetic). */
const TRAIL_HZ = 36;

/** Real seconds a shot lingers after arriving: the tracer shrinks into the target, the head fades (short shots read). */
const SHOT_FADE = 0.08;

/** Boomerang: spin (rad per real s), sideways bow of each leg (tiles, at ≥ 2 tiles range), safety lifetime (real s). */
const BOOM_SPIN = 22, BOOM_BOW = 0.35, BOOM_MAX_T = 6;

/** Bombard shell: share of its flight spent rising from the shooter, and the height it climbs / falls from (tiles). */
const SHELL_RISE = 0.34, SHELL_UP = 5.5;

/** 蕾缪安 S3 shell (fx 'bombardShell'); `look` 'mortar' is its own flight (_stepMortar). */
const BOMBARD_SHELL = Object.freeze({ look: 'mortar', tint: 0xfff2d8, glow: 0xff9c33, trail: 0xffb35c, smoke: 0x3a3430, len: 1.3, width: 0.3, head: 0.56 });

/** 空弦 S3: a long, white-hot golden arrow with a brief bow flash and a star-ring impact.
 * [ASSUMED] Colour and particle timing approximate the player's gameplay screenshots; visual only. */
const ARCHET_STORM = Object.freeze({ ...PROJ.arrow, tint: 0xffffff, glow: 0xffdf58, trail: 0xffb731,
  muzzle: 0xfff07a, len: 7, width: 0.31, head: 0.62, hit: 'archetStorm', storm: true });

const SHOTGUN_DIR = Object.freeze({ RIGHT: [1, 0], LEFT: [-1, 0], UP: [0, 1], DOWN: [0, -1] });
const EXECUTOR_ID = /^chess_char_2_01_[ab]$/;

export class FxProjectiles {
  // ---- helpers ------------------------------------------------------------------------------------------

  _proj(x, y, z, out = this._p) { return this.ctx.cam().project(x, y, z, out); }

  /** Ground decals: on a raised top they are drawn with that block row (tiles.surfaceLayer), else in groundFx. */
  _onGround(sp, y, z) {
    let layer = this.ctx.layers.groundFx;
    if (z > 0.12 && this.ctx.surfaceLayer) layer = this.ctx.surfaceLayer(Math.round(y)) || layer;
    if (sp.parent !== layer) layer.addChild(sp);
  }

  _chest(view, out = this._p) {
    const z = (view.z || 0) + (view.hover || 0) + (view._headTiles ? view._headTiles * 0.45 : 0.5);
    return this._proj(view.x, view.y, z, out);
  }

  /** Screen point `frac` of a unit's drawn model height above its feet (SHOT_HEIGHT: beams, a mortar's muzzle). */
  _bodyPt(view, frac, out = this._p) {
    const p = this._proj(view.x, view.y, (view.z || 0) + (view.hover || 0), out);
    p.y -= (view._headTiles || 1.2) * frac * p.s;
    return p;
  }

  // ---- projectiles -----------------------------------------------------------------------------------------

  /** b.ev 'atk' visual. src/tgt are views (tgt may be null). */
  attack(src, tgt, kind, shots = 1, visualStyle = null, rangeTiles = null) {
    if (!src) return;
    if (visualStyle === 'shotgunWaveSkip') return;
    if (visualStyle === 'shotgunWave' && tgt) { this._shotgunWave(src, rangeTiles); return; }
    // chain: the source is the previous target of the bounce (sim ai.js), so the arc hops unit to unit
    if (kind === 'chain' || kind === 'chainHeal') { if (tgt && tgt !== src) this._beam(src, tgt, kind === 'chainHeal' ? 0x7dffa8 : 0xc9a2ff, 0.22, 1, true); return; }
    if (kind === 'beam') { if (tgt && tgt !== src) this._beam(src, tgt, src.isEnemy ? 0xff7a5a : 0xffe6a8, 0.18, 0.15); return; }
    const spec = kind === 'arrow' && visualStyle === 'archetStorm' && !src.isEnemy ? ARCHET_STORM : PROJ[kind];
    if (!spec || !tgt) {
      if (kind === 'none' || !kind) this._slashAt = src.id;
      return;
    }
    const count = kind === 'arrow' || kind === 'bolt' ? clamp(Math.floor(Number(shots) || 1), 1, 8) : 1;
    for (let i = 0; i < count; i++) this._launchShot(src, tgt, kind, spec, i * 0.08 / this._ts(), i);
  }

  /** Scattershooter blast: one luminous expanding fan per attack, regardless of target count.
   * [ASSUMED] The fan's spread, lifetime and Executor's tiny scattered pellets approximate the supplied gameplay reference. */
  _shotgunWave(src, rangeTiles) {
    const reach = clamp(Number(rangeTiles) || 2.5, 0.5, 8);
    const dir = SHOTGUN_DIR[src.dir] || (src.facing === -1 ? SHOTGUN_DIR.LEFT : SHOTGUN_DIR.RIGHT);
    const z = bodyZ(this.ctx.cam(), src, SHOT_HEIGHT.launch);
    const p = this._proj(src.x, src.y, z, this._p);
    const x = p.x, y = p.y, s = p.s;
    const q = this._proj(src.x + dir[0] * reach, src.y + dir[1] * reach, z, this._q);
    const angle = Math.atan2(q.y - y, q.x - x);
    const range = Math.hypot(q.x - x, q.y - y);
    // Cosmetic only: sample once per blast, so the little streaks do not jitter when a frame is redrawn.
    // Independent angles may cluster naturally; each pellet also starts and fades on its own schedule.
    // One heavy tracer, two medium ones and two tiny sparks break up the otherwise even wave front.
    const pellets = EXECUTOR_ID.test(src.info?.defId || '') ? Array.from({ length: 5 }, (_, i) => ({
      angle: angle + (Math.random() - 0.5) * 1.04,
      reach: 0.48 + Math.random() * 0.5,
      start: Math.random() * 0.22,
      duration: 0.45 + Math.random() * 0.35,
      offset: (Math.random() - 0.5) * s * 0.22,
      size: i === 0 ? 1.45 + Math.random() * 0.45 : i < 3 ? 0.75 + Math.random() * 0.4 : 0.3 + Math.random() * 0.3,
      length: i === 0 ? 1.25 + Math.random() * 0.55 : i < 3 ? 0.6 + Math.random() * 0.65 : 0.3 + Math.random() * 0.4,
    })) : [];
    this.shotgunWaves.push({ x, y, s, angle, range, pellets, t: 0, dur: 0.17 });
    if (this.shotgunWaves.length > 24) this.shotgunWaves.shift();
    this.particle('flare', x, y, { tint: 0xffe7a0, life: 0.12, s0: s / 128 * 0.55, s1: s / 128 * 0.12, a0: 0.9, a1: 0 });
  }

  _updateShotgunWaves(dt) {
    const g = this.beams; // _updateBeams has cleared this shared additive layer
    let w = 0;
    for (const wave of this.shotgunWaves) {
      wave.t += dt;
      if (wave.t >= wave.dur) continue;
      const k = wave.t / wave.dur;
      const fade = (1 - k) ** 1.3;
      const radius = wave.range * (0.07 + 0.93 * (1 - (1 - k) ** 2));
      const halfAngle = 0.55;
      const steps = 12;
      // A soft sector connects the muzzle to the rapidly moving crescent; it never resembles a flying bullet.
      g.lineStyle(0, 0, 0);
      g.beginFill(0xffb651, 0.1 * fade);
      g.moveTo(wave.x, wave.y);
      for (let i = 0; i <= steps; i++) {
        const a = wave.angle - halfAngle + (i / steps) * halfAngle * 2;
        g.lineTo(wave.x + Math.cos(a) * radius, wave.y + Math.sin(a) * radius);
      }
      g.lineTo(wave.x, wave.y);
      g.endFill();
      for (let pass = 0; pass < 3; pass++) {
        const r = radius * (pass === 0 ? 1 : pass === 1 ? 0.94 : 0.87);
        g.lineStyle(Math.max(1, wave.s * (pass === 0 ? 0.16 : pass === 1 ? 0.055 : 0.02)),
          pass === 2 ? 0xffffff : pass === 1 ? 0xffee9e : 0xff9b4d,
          fade * (pass === 0 ? 0.25 : pass === 1 ? 0.8 : 0.9));
        for (let i = 0; i <= steps; i++) {
          const a = wave.angle - halfAngle + (i / steps) * halfAngle * 2;
          const px = wave.x + Math.cos(a) * r, py = wave.y + Math.sin(a) * r;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
      }
      for (const pellet of wave.pellets) {
        const progress = (k - pellet.start) / pellet.duration;
        if (progress <= 0 || progress >= 1) continue;
        const travel = wave.range * pellet.reach * (1 - (1 - progress) ** 2);
        const trail = Math.min(travel, clamp(wave.s * 0.14 * pellet.length, 2, 20));
        const dx = Math.cos(pellet.angle), dy = Math.sin(pellet.angle);
        const ox = wave.x - Math.sin(wave.angle) * pellet.offset;
        const oy = wave.y + Math.cos(wave.angle) * pellet.offset;
        const px = ox + dx * travel, py = oy + dy * travel;
        const tailX = px - dx * trail, tailY = py - dy * trail;
        const pelletFade = Math.min(1, (1 - progress) * 4) * (1 - k) ** 0.4;
        g.lineStyle(clamp(wave.s * 0.055 * pellet.size, 1, 6), 0xffaa49, pelletFade * 0.55);
        g.moveTo(tailX, tailY); g.lineTo(px, py);
        g.lineStyle(clamp(wave.s * 0.025 * pellet.size, 0.8, 3), 0xfff4c0, pelletFade * 0.95);
        g.moveTo(tailX, tailY); g.lineTo(px, py);
      }
      this.shotgunWaves[w++] = wave;
    }
    this.shotgunWaves.length = w;
  }

  /** Stagger a cosmetic volley in game time without repeating the unit's attack animation. */
  _launchShot(src, tgt, kind, spec, delay, volleyIndex = 0) {
    const pr = this._takeProj();
    const cam = this.ctx.cam();
    const dx = tgt.x - src.x, dy = tgt.y - src.y;
    const dist = Math.hypot(dx, dy);
    const ux = dist > 1e-6 ? dx / dist : (src.facing || 1) >= 0 ? 1 : -1, uy = dist > 1e-6 ? dy / dist : 0;
    const hand = Math.min(0.28, dist * 0.3);   // the weapon is in front of the body
    const look = spec.look;
    pr.kind = kind; pr.spec = spec; pr.src = src; pr.tgt = tgt; pr.rise = 0; pr.volleyIndex = volleyIndex;
    pr.x0 = src.x + ux * hand; pr.y0 = src.y + uy * hand; pr.z0 = bodyZ(cam, src, SHOT_HEIGHT.launch);
    pr.tx = tgt.x; pr.ty = tgt.y; pr.tz = look === 'shell' ? feetZ(tgt) : bodyZ(cam, tgt, SHOT_HEIGHT.aim);
    pr.t = 0; pr.delay = delay; pr.fade = 0; pr.hit = false; pr.emit = Math.random(); pr.ang = Math.atan2(-uy, ux);   // ≈ on screen (rows run up)
    pr.dur = clamp(dist / projSpeed(kind) / this._ts(), 0.04, 1.5);
    pr.arc = spec.arc ? spec.arc * clamp(0.45 + dist * 0.18, 0.6, 1.8) : 0;
    pr.glow = spec.glow;
    pr.trailTint = spec.trail ?? spec.glow;
    // boomerang legs: kinematic, from (bx, by, bz) at constant speed towards the target, then back to the thrower
    pr.phase = 0; pr.bx = pr.x0; pr.by = pr.y0; pr.bz = pr.z0; pr.trav = 0; pr.d0 = Math.max(0.1, dist); pr.ux = ux; pr.uy = uy;
    pr.spin = Math.random() * 6;
    this._dressProj(pr);
    this.projs.push(pr);
    if (this.rich && !delay) this._muzzle(pr);
  }

  /** A pooled projectile record: trail + halo + core sprites (additive, above units) and a ground shadow. */
  _takeProj() {
    if (this.projs.length >= MAX_PROJ) this._releaseProj(this.projs.shift());
    let pr = this.projFree.pop();
    if (!pr) {
      const P = this.P;
      const add = (tex, ax) => {
        const sp = new P.Sprite(this.tex[tex]);
        sp.anchor.set(ax, 0.5);
        sp.blendMode = P.BLEND_MODES.ADD;
        sp.visible = false;
        return sp;
      };
      const trail = add('tracer', 1), halo = add('glow', 0.5), core = add('orb', 0.5);
      this.projLayer.addChild(trail, halo, core);
      const shadow = new P.Sprite(this.tex.soft);
      shadow.anchor.set(0.5);
      shadow.tint = 0x000000;
      shadow.visible = false;
      this.shadowLayer.addChild(shadow);
      pr = { trail, halo, core, shadow };
    }
    return pr;
  }

  /** Textures / tints of a projectile's sprites for its look (shown from its first update). */
  _dressProj(pr) {
    const spec = pr.spec, look = spec.look;
    const thin = look === 'tracer' || look === 'dart';
    const { trail, halo, core, shadow } = pr;
    trail.texture = this.tex[thin ? 'tracer' : 'streak'];
    trail.tint = thin ? spec.tint : pr.trailTint;
    trail.visible = look !== 'boomerang';
    halo.texture = this.tex.glow;
    halo.tint = pr.glow;
    halo.visible = true;
    core.texture = this.tex[look === 'boomerang' ? 'boomerang' : thin ? 'dot' : 'orb'];
    core.tint = spec.tint;
    core.rotation = 0;
    core.visible = true;
    shadow.visible = look === 'shell' || look === 'boomerang';
    trail.alpha = halo.alpha = core.alpha = shadow.alpha = 0;
  }

  _releaseProj(pr) {
    pr.trail.visible = pr.halo.visible = pr.core.visible = pr.shadow.visible = false;
    pr.src = pr.tgt = null;
    pr.delay = 0;
    this.projFree.push(pr);
  }

  _updateProjs(dt) {
    if (!this.projs.length) return;
    const cam = this.ctx.cam();
    const rich = this.rich;
    let w = 0;
    for (let i = 0; i < this.projs.length; i++) {
      const pr = this.projs[i];
      let stepDt = dt;
      if (pr.delay > 0) {
        stepDt = Math.max(0, dt - pr.delay);
        pr.delay = Math.max(0, pr.delay - dt);
        if (pr.delay > 0) { this.projs[w++] = pr; continue; }
        if (rich) this._muzzle(pr);
      }
      const look = pr.spec.look;
      const live = look === 'boomerang' ? this._stepBoomerang(pr, stepDt, cam, rich)
        : look === 'mortar' ? this._stepMortar(pr, stepDt, cam, rich) : this._stepShot(pr, stepDt, cam, rich);
      if (!live) { this._releaseProj(pr); continue; }
      this.projs[w++] = pr;
    }
    this.projs.length = w;
  }

  /** Screen point of a straight / lobbed shot at flight fraction k (a parabola of height `arc` over the line). */
  _shotPoint(pr, k, cam, out) {
    const x = pr.x0 + (pr.tx - pr.x0) * k, y = pr.y0 + (pr.ty - pr.y0) * k;
    const z = pr.z0 + (pr.tz - pr.z0) * k + (pr.arc ? pr.arc * 4 * k * (1 - k) : 0);
    return cam.project(x, y, z, out);
  }

  /**
   * One frame of a tracer / orb / shell / dart: placed by flight time (homing on the target), trail behind the head
   * along the path (never longer than the part flown), an arrival burst, then a SHOT_FADE linger in the target.
   */
  _stepShot(pr, dt, cam, rich) {
    const spec = pr.spec, look = spec.look;
    pr.t += dt;
    const tg = pr.tgt;
    if (tg && !tg.destroyed && tg.alive !== false) { pr.tx = tg.x; pr.ty = tg.y; pr.tz = look === 'shell' ? feetZ(tg) : bodyZ(cam, tg, SHOT_HEIGHT.aim); }
    const k = Math.min(1, pr.t / pr.dur);
    if (k >= 1 && !pr.hit) { pr.hit = true; pr.fade = 0; this._impact(pr, cam); }
    let fk = 0;
    if (pr.hit) { pr.fade += dt; fk = pr.fade / SHOT_FADE; if (fk >= 1) return false; }
    const p = this._shotPoint(pr, k, cam, this._p);
    const kb = Math.max(0, k - (pr.arc ? 0.12 : 0.25));
    const q = this._shotPoint(pr, kb, cam, this._q);
    const s = p.s, px = p.x, py = p.y;
    const seg = Math.hypot(px - q.x, py - q.y);
    if (seg > 0.5) pr.ang = Math.atan2(py - q.y, px - q.x);
    const thin = look === 'tracer' || look === 'dart';
    const flown = k > kb ? seg * (k / (k - kb)) : 0;
    const L = Math.min(spec.len * s, flown) * (1 - fk);
    const tr = pr.trail;
    tr.position.set(px, py);
    tr.rotation = pr.ang;
    tr.scale.set(Math.max(0.001, L / 128), (spec.width * s) / (thin ? 16 : 20));
    tr.alpha = (thin ? 1 : 0.85) * (1 - fk);
    const hs = spec.head * s;
    const halo = pr.halo;
    halo.position.set(px, py);
    halo.scale.set((hs / 128) * (1 + 0.12 * Math.sin(pr.t * 40)));
    halo.alpha = 0.85 * (1 - fk);
    const core = pr.core;
    core.position.set(px, py);
    if (thin) core.scale.set((hs * 0.5) / 32);
    else if (look === 'shell') { core.rotation = pr.ang; core.scale.set((hs * 0.85) / 64, (hs * 0.55) / 64); }   // a shell along its flight
    else core.scale.set((hs * 0.62) / 64);
    core.alpha = 1 - fk;
    if (look === 'shell') {
      // its shadow on the ground under it: bigger and darker the lower it flies
      const gx = pr.x0 + (pr.tx - pr.x0) * k, gy = pr.y0 + (pr.ty - pr.y0) * k;
      const g = cam.project(gx, gy, this._groundZ(gx, gy) + 0.01, this._g);
      const near = 1 - clamp((pr.arc * 4 * k * (1 - k)) / Math.max(0.3, pr.arc), 0, 1);
      const r = g.s * (0.17 + 0.13 * near);
      const sh = pr.shadow;
      sh.position.set(g.x, g.y);
      sh.scale.set((r * 2) / 128, (r * 0.9) / 128);
      sh.alpha = (0.32 + 0.3 * near) * (1 - fk);
    }
    if (rich && !pr.hit && (spec.storm || !thin)) {
      pr.emit += dt * TRAIL_HZ;
      for (let n = 0; pr.emit >= 1 && n < 2; n++) {
        pr.emit -= 1;
        if (!this._room()) { pr.emit = 0; break; }
        if (look === 'shell') this._puff(px, py, s, pr.trailTint, spec.smoke, n);
        else if (spec.storm) this.particle(n ? 'dot' : 'spark', px, py, { tint: n ? 0xffffff : 0xffd44d,
          life: 0.18, s0: (s / 64) * (n ? 0.17 : 0.24), s1: 0, a0: 0.95, a1: 0 });
        else this._mote(px, py, s, pr.trailTint, spec.width);
      }
    }
    return true;
  }

  /**
   * 回环射手 (sim ai.js throwBoomerang): out to the (moving) target at the boomerang speed, a hit flash, then back to the
   * thrower's current position at the return speed (PRTS 跃跃: 15 out, 3.75 back); gone when caught — or at once when
   * the thrower's view is gone (the sim drops a boomerang whose thrower left). Each leg bows sideways (left of its own
   * direction, so out and back form a loop); it spins, leaves afterimages and a shadow.
   */
  _stepBoomerang(pr, dt, cam, rich) {
    const spec = pr.spec;
    pr.t += dt;
    if (pr.t > BOOM_MAX_T) return false;
    const step = projSpeed(pr.phase ? 'boomerangReturn' : pr.kind) * this._ts() * dt;
    let gx, gy, gz;
    if (pr.phase === 0) {
      const tg = pr.tgt;
      if (tg && !tg.destroyed && tg.alive !== false) { pr.tx = tg.x; pr.ty = tg.y; pr.tz = bodyZ(cam, tg, SHOT_HEIGHT.aim); }
      gx = pr.tx; gy = pr.ty; gz = pr.tz;
    } else {
      const sv = pr.src;
      if (!sv || sv.destroyed || sv.alive === false) return false;
      gx = sv.x; gy = sv.y; gz = bodyZ(cam, sv, SHOT_HEIGHT.launch);
    }
    const dx = gx - pr.bx, dy = gy - pr.by, dz = gz - pr.bz;
    const d = Math.hypot(dx, dy, dz);
    if (d <= step) {
      pr.bx = gx; pr.by = gy; pr.bz = gz;
      if (pr.phase === 1) { this._catch(pr, cam); return false; }
      this._impact(pr, cam);
      // turn back: the next leg runs from here to the thrower (a thrower already gone gets nothing back)
      const sv = pr.src;
      if (!sv || sv.destroyed || sv.alive === false) return false;
      const bx = sv.x - gx, by = sv.y - gy;
      const bd = Math.hypot(bx, by);
      pr.phase = 1; pr.trav = 0; pr.d0 = Math.max(0.1, bd);
      if (bd > 1e-6) { pr.ux = bx / bd; pr.uy = by / bd; } else { pr.ux = -pr.ux; pr.uy = -pr.uy; }
    } else {
      pr.bx += (dx / d) * step; pr.by += (dy / d) * step; pr.bz += (dz / d) * step;
      pr.trav += step;
    }
    const arcK = Math.sin(clamp(pr.trav / pr.d0, 0, 1) * Math.PI);
    const bow = arcK * BOOM_BOW * Math.min(1, pr.d0 / 2);
    const x = pr.bx - pr.uy * bow, y = pr.by + pr.ux * bow, z = pr.bz + arcK * 0.12;
    const p = cam.project(x, y, z, this._p);
    const px = p.x, py = p.y, hs = spec.head * p.s;
    pr.spin += BOOM_SPIN * dt;
    const core = pr.core;
    core.position.set(px, py);
    core.rotation = pr.spin;
    core.scale.set(hs / 64);
    core.alpha = 1;
    const halo = pr.halo;
    halo.position.set(px, py);
    halo.scale.set((hs * 1.5) / 128);
    halo.alpha = 0.4;
    const g = cam.project(x, y, this._groundZ(x, y) + 0.01, this._g);
    const sh = pr.shadow;
    sh.position.set(g.x, g.y);
    sh.scale.set((g.s * 0.4) / 128, (g.s * 0.18) / 128);
    sh.alpha = 0.22;
    if (rich) {
      pr.emit += dt * TRAIL_HZ;
      if (pr.emit >= 1) {
        pr.emit = Math.min(1, pr.emit - 1);
        if (this._room()) {
          const o = this._o();
          o.tint = spec.glow; o.life = 0.14; o.s0 = hs / 64; o.s1 = (hs / 64) * 0.9; o.a0 = 0.4; o.rot = pr.spin;
          this.particle('boomerang', px, py, o);
        }
      }
    }
    return true;
  }

  /**
   * One frame of a 蕾缪安 bombard shell: a long flight first streaks up out of the shooter (`rise` of it, following
   * her); then it falls onto its spot, faster and faster, its shadow growing there. It ends at the impact — the
   * explosion (and the end of its lock) is the sim's own 'bombard' fx.
   */
  _stepMortar(pr, dt, cam, rich) {
    const spec = pr.spec;
    pr.t += dt;
    const k = pr.t / pr.dur;
    if (k >= 1) return false;
    let x, y, z, zq;
    if (k < pr.rise) {
      const u = k / pr.rise, ub = Math.max(0, u - 0.25);
      const sv = pr.src;
      if (sv && !sv.destroyed) { pr.x0 = sv.x; pr.y0 = sv.y; }
      x = pr.x0; y = pr.y0;
      z = pr.z0 + SHELL_UP * (1 - (1 - u) * (1 - u));          // out of the barrel fast, slowing as it climbs
      zq = pr.z0 + SHELL_UP * (1 - (1 - ub) * (1 - ub));
    } else {
      const u = (k - pr.rise) / (1 - pr.rise), ub = Math.max(0, u - 0.25);
      x = pr.tx; y = pr.ty;
      z = pr.tz + SHELL_UP * (1 - u * u);                       // falling faster and faster
      zq = pr.tz + SHELL_UP * (1 - ub * ub) + 0.3;
      const g = cam.project(x, y, pr.tz + 0.01, this._g);
      const r = g.s * (0.12 + 0.3 * u);
      const sh = pr.shadow;
      sh.visible = true;
      sh.position.set(g.x, g.y);
      sh.scale.set((r * 2) / 128, (r * 0.9) / 128);
      sh.alpha = 0.12 + 0.36 * u;
    }
    const p = cam.project(x, y, z, this._p);
    const q = cam.project(x, y, zq, this._q);
    const s = p.s, px = p.x, py = p.y;
    const seg = Math.hypot(px - q.x, py - q.y);
    if (seg > 0.5) pr.ang = Math.atan2(py - q.y, px - q.x);
    const tr = pr.trail;
    tr.position.set(px, py);
    tr.rotation = pr.ang;
    tr.scale.set(Math.max(0.001, Math.min(spec.len * s, seg * 1.6) / 128), (spec.width * s) / 20);
    tr.alpha = 0.95;
    const hs = spec.head * s;
    pr.halo.position.set(px, py);
    pr.halo.scale.set((hs / 128) * (1 + 0.15 * Math.sin(pr.t * 50)));
    pr.halo.alpha = 0.95;
    pr.core.position.set(px, py);
    pr.core.rotation = pr.ang;
    pr.core.scale.set((hs * 0.85) / 64, (hs * 0.5) / 64);
    pr.core.alpha = 1;
    if (rich) {
      pr.emit += dt * TRAIL_HZ;
      for (let n = 0; pr.emit >= 1 && n < 2; n++) {
        pr.emit -= 1;
        if (!this._room()) { pr.emit = 0; break; }
        this._puff(px, py, s, spec.trail, spec.smoke, n);
      }
    }
    return true;
  }

  /** Flash at the shooter as a shot leaves (tracers: an oriented muzzle cone). Cosmetic. */
  _muzzle(pr) {
    const spec = pr.spec, look = spec.look;
    if (!spec.muzzle) return;
    const cam = this.ctx.cam();
    const p = cam.project(pr.x0, pr.y0, pr.z0, this._g);
    const px = p.x, py = p.y, s = p.s;
    if (look === 'tracer') {
      const q = cam.project(pr.tx, pr.ty, pr.tz, this._q);
      this.particle('muzzle', px, py, { tint: spec.muzzle, life: 0.09, s0: (s / 64) * 0.55, s1: (s / 64) * 0.72, a0: 1, a1: 0, rot: Math.atan2(q.y - py, q.x - px), anchorX: 0.19 });
      this.particle('glow', px, py, { tint: spec.muzzle, life: 0.1, s0: (s / 128) * 0.45, s1: (s / 128) * 0.7, a0: 0.9, a1: 0 });
      if (spec.storm && pr.volleyIndex === 0) {
        const heading = Math.atan2(q.y - py, q.x - px);
        this.particle('slash', px, py, { tint: 0xffd932, life: 0.16, s0: (s / 128) * 1.1,
          s1: (s / 128) * 1.55, a0: 0.95, a1: 0, rot: heading - Math.PI / 2 });
        this.particle('ring', px, py, { tint: 0xffec76, life: 0.2, s0: (s / 128) * 0.48,
          s1: (s / 128) * 0.85, a0: 0.9, a1: 0 });
      }
    } else {
      this.particle('glow', px, py, { tint: pr.glow === spec.glow ? spec.muzzle : pr.glow, life: 0.16, s0: (s / 128) * 0.45, s1: (s / 128) * 0.8, a0: 0.9, a1: 0 });
      if (look === 'shell') this.smoke(px, py, s * 0.28, spec.smoke ?? 0x2a2522, 0.3);
    }
  }

  /** Arrival burst of a shot (PROJ `hit`): at the target, or the ground under it for shells. */
  _impact(pr, cam) {
    const spec = pr.spec;
    const p = cam.project(pr.tx, pr.ty, pr.tz, this._g);
    const x = p.x, y = p.y, s = p.s;
    const rich = this.rich;
    switch (spec.hit) {
      case 'archetStorm': {
        this.particle('flare', x, y, { tint: 0xffffff, life: 0.16, s0: (s / 128) * 0.95,
          s1: (s / 128) * 0.18, a0: 1, a1: 0, rot: Math.random() * Math.PI });
        if (pr.volleyIndex === 0) {
          this.particle('ring', x, y, { tint: 0xffc52f, life: 0.24, s0: (s / 128) * 0.35,
            s1: (s / 128) * 1.05, a0: 0.95, a1: 0 });
          this.particle('shock', x, y, { tint: 0xffe37d, life: 0.2, s0: (s / 128) * 0.32,
            s1: (s / 128) * 0.86, a0: 0.85, a1: 0 });
        }
        if (rich) this.burst(x, y, s, pr.volleyIndex === 0 ? 7 : 3, 0xffdc55,
          { speed: 2.8, life: 0.25, tex: 'spark', size: 0.32 });
        break;
      }
      case 'arts':
        this.particle('glow', x, y, { tint: pr.glow, life: 0.24, s0: (s / 128) * 0.7, s1: (s / 128) * 1.2, a0: 0.95, a1: 0 });
        this.particle('shock', x, y, { tint: pr.glow, life: 0.26, s0: (s / 128) * 0.25, s1: (s / 128) * 1.05, a0: 0.9, a1: 0 });
        if (rich) this.burst(x, y, s, 4, pr.trailTint, { speed: 2.2, life: 0.3, tex: 'dot', size: 0.35 });
        break;
      case 'heal': {
        this.particle('glow', x, y, { tint: spec.glow, life: 0.3, s0: (s / 128) * 0.6, s1: (s / 128) * 1.1, a0: 0.9, a1: 0 });
        this.particle('flare', x, y, { tint: 0xc8ffd8, life: 0.22, s0: (s / 128) * 0.9, s1: (s / 128) * 0.3, a0: 1, a1: 0, rot: Math.random() });
        const n = rich ? 3 : 1;
        for (let i = 0; i < n; i++) {
          this.particle('plus', x + (Math.random() - 0.5) * s * 0.45, y - Math.random() * s * 0.2, { tint: 0x7dffa8, vy: -s * 0.8, life: 0.6, s0: (s / 64) * 0.26, s1: (s / 64) * 0.14, a0: 0.95, a1: 0, fadeIn: 0.05 });
        }
        break;
      }
      case 'boom': this.explosion(pr.tx, pr.ty, this._groundZ(pr.tx, pr.ty), 1, pr.glow, { smoke: spec.smoke, small: true }); break;
      case 'splash': this.explosion(pr.tx, pr.ty, this._groundZ(pr.tx, pr.ty), 0.7, pr.glow, { smoke: spec.smoke, small: true }); break;
      case 'zap':
        this.particle('flare', x, y, { tint: spec.glow, life: 0.16, s0: (s / 128) * 0.7, s1: (s / 128) * 0.25, a0: 1, a1: 0, rot: Math.random() });
        if (rich) this.burst(x, y, s, 3, spec.glow, { speed: 2.4, life: 0.22, size: 0.35 });
        break;
      case 'enemy':
        this.particle('glow', x, y, { tint: spec.glow, life: 0.2, s0: (s / 128) * 0.6, s1: (s / 128) * 1.0, a0: 0.9, a1: 0 });
        this.particle('flare', x, y, { tint: 0xffb0a0, life: 0.16, s0: (s / 128) * 0.8, s1: (s / 128) * 0.3, a0: 1, a1: 0, rot: Math.random() });
        break;
      default:   // 'spark': bullets, boomerang hits (the hit's own sparks come with its damage number)
        this.particle('flare', x, y, { tint: spec.glow, life: 0.11, s0: (s / 128) * 0.55, s1: (s / 128) * 0.2, a0: 1, a1: 0, rot: Math.random() });
    }
  }

  /** The thrower caught its boomerang: a small flash in its hands. */
  _catch(pr, cam) {
    const p = cam.project(pr.bx, pr.by, pr.bz, this._g);
    this.particle('flare', p.x, p.y, { tint: pr.spec.glow, life: 0.12, s0: (p.s / 128) * 0.6, s1: (p.s / 128) * 0.2, a0: 0.9, a1: 0, rot: Math.random() });
  }

  /**
   * 蕾缪安 S3 shell (fx 'bombardShell'): fired now by `src` (its view, or null) at the spot (x, y), where it lands after
   * `flight` real seconds (_stepMortar; the sim's shells fly 0.3 game s — they drop out of the sky, a launch streak
   * leaving the shooter; a flight ≥ 0.45 real s climbs out of her first). The spot gets a thin ring closing in and
   * brightening plus the blast radius throbbing until the impact. The shell takes the shooter's lock on that spot: the
   * lock ends with this shell's 'bombard' (_landed).
   */
  mortar(src, x, y, r, flight) {
    const pr = this._takeProj();
    const gz = this._groundZ(x, y);
    pr.kind = 'bombardShell'; pr.spec = BOMBARD_SHELL; pr.src = src; pr.tgt = null;
    pr.x0 = src ? src.x : x; pr.y0 = src ? src.y : y; pr.z0 = src ? bodyZ(this.ctx.cam(), src, SHOT_HEIGHT.launch) : gz + 0.5;
    pr.tx = x; pr.ty = y; pr.tz = gz;
    pr.t = 0; pr.dur = clamp(flight, 0.1, 4); pr.fade = 0; pr.hit = false; pr.emit = 0; pr.arc = 0; pr.ang = Math.PI / 2;
    pr.rise = pr.dur >= 0.45 ? SHELL_RISE : 0;
    pr.glow = BOMBARD_SHELL.glow; pr.trailTint = BOMBARD_SHELL.trail;
    const L = this._nearestLock(src ? src.id : null, x, y, 3, true);
    if (L) { L.shell = true; L.sx = x; L.sy = y; }
    this._dressProj(pr);
    pr.shadow.visible = false;
    this.projs.push(pr);
    const rr = Math.max(0.5, r);
    this.ring(x, y, gz, rr, rr * 0.22, 0xff5a3a, pr.dur, 'shock', 'in');
    this.ring(x, y, gz, rr * 0.96, rr, 0xff7a4a, pr.dur, 'ring', 'pulse');
    if (src && this.rich) {
      // the shot leaves her upwards: a muzzle flash and a streak climbing out of sight
      const p = this._bodyPt(src, SHOT_HEIGHT.launch, this._g);
      const s = p.s;
      this.particle('muzzle', p.x, p.y, { tint: 0xffc27a, life: 0.1, s0: (s / 64) * 0.6, s1: (s / 64) * 0.8, a0: 1, a1: 0, rot: -Math.PI / 2, anchorX: 0.19 });
      this.particle('glow', p.x, p.y, { tint: 0xffb35c, life: 0.14, s0: (s / 128) * 0.5, s1: (s / 128) * 0.9, a0: 0.9, a1: 0 });
      this.particle('tracer', p.x, p.y, { tint: 0xffe0b0, life: 0.16, vy: -s * 16, s0: (s * 0.3) / 16, s1: (s * 0.24) / 16, sx: (1.3 * 16) / (0.3 * 128), a0: 1, a1: 0.2, rot: -Math.PI / 2, anchorX: 1 });
    }
    return pr;
  }

  /**
   * fx 'bombard' (the impact) at (x, y) by shooter `src`: the shell falling there has landed (ended now if still in
   * the air) and its lock goes — the lock that shell took, found by the landing point (the sim uses the same spot for
   * both events); a sim without 'bombardShell' releases the shooter's lock nearest to the spot.
   */
  _landed(src, x, y, r) {
    for (const pr of this.projs) {
      if (pr.spec !== BOMBARD_SHELL || (src != null && pr.src && pr.src.id !== src)) continue;
      if (Math.hypot(pr.tx - x, pr.ty - y) < 0.05) pr.t = Math.max(pr.t, pr.dur);
    }
    let best = null, bd = Infinity;
    for (const L of this.locks) {
      if (L.out >= 0 || (src != null && L.src != null && L.src !== src)) continue;
      const d = L.shell ? Math.hypot(L.sx - x, L.sy - y) : Math.hypot(L.x - x, L.y - y) + 0.5;
      if (d < bd) { bd = d; best = L; }
    }
    if (best && bd <= r + 1.5) this._releaseLock(best);
  }
}
