// render/vfx/psys.js — a small Unity ParticleSystem interpreter (DESIGN §33.5) for the official battle effects.
//
//   const def = compileSystem(node.particleSystem, node.particleSystemRenderer, res)   shared, immutable per descriptor node
//   const ps = new PSys(def, { seed, emission })                                        one per effect instance
//   ps.play(); ps.update(dt, frame) (frame: { m, scale, pos, time }); ps.stopEmitting(); ps.clear()
//   ps.count, ps.px / py / pz …                                                         struct-of-arrays particle state
//
// Modules: initial (lifetime, speed, size / 3D size, rotation / 3D rotation, colour, gravity modifier, max particles,
// randomised rotation direction), emission (rate over time, rate over distance, bursts with cycles / interval /
// probability), shape (render/vfx/shapes.js), velocity over lifetime (linear, orbital + offset, radial, speed modifier,
// local / world), force over lifetime, limit velocity (magnitude or per axis, dampen, drag × size / speed), inherit
// velocity (initial / current), size / rotation / colour over lifetime and by speed, lifetime by emitter speed, noise
// (a smooth 3D value noise of the same frequency, strength, octaves and scroll — Unity's is curl noise; the brief allows
// an approximation), texture sheet animation (evaluated at draw time, render/vfx/geom.js), custom data (likewise),
// birth / death sub-emitters with inherited colour / size / rotation / lifetime, the trail module's per-particle
// histories (geom.js builds the ribbons), prewarm, start delay, simulation speed, local / world simulation space and
// the three scaling modes. Collision, trigger, lights and external forces are ignored (no colliders in our scene).
//
// Space and scale: a local-space system keeps its particles in its own space, unscaled; the effect hands it every frame
// the render matrix `frame.m` = the node's world rotation / position with the scale of the scaling mode (Hierarchy:
// the lossy world scale, Local: the node's own scale, Shape: none — the shape positions are scaled at birth instead).
// A world-space system converts each particle at birth through that matrix. Velocities scale with it (not in Shape mode).
// Sizes: a local-space particle is drawn at that scale as it is now (`sizeScale`), as the rest of its frame is — a node
// a clip grows from 0 grows the particles it holds (0.3.1, history §34.6: 荒芜拉普兰德 S3's seal discs, born at the scale 0
// of their 0.5 s pop-in, stayed invisible for their 4.8 s life); a world-space particle keeps the scale it was born at.
//
// Time: `update(dt)` takes battle seconds and sub-steps at ≤ 1/30 s like the client (TimeManager "Maximum Particle
// Timestep" 0.0333): drag and limit velocity are applied per step. A particle born inside a step is aged by its share
// of the step and placed along the emitter's motion (continuous emission and rate-over-distance trails stay smooth).

import { MinMax, MinMaxColor } from './curves.js';
import { Shape } from './shapes.js';
import { Rng, hashRand, RF } from './rng.js';
import { mat4InvertAffine, mat4Point, mat4Dir, mat4 } from './math.js';

export const MAX_STEP = 1 / 30;
/** Hard cap of one system's live particles (a runaway rate never allocates more). */
export const SYSTEM_CAP = 2000;
/** Points kept per particle trail. */
export const TRAIL_POINTS = 24;

const GRAVITY = 9.81;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v) => v === true || v === 1;
const mm = (v, d = 0) => new MinMax(v, d);

/** A compiled burst. */
function burst(b) {
  return {
    time: Math.max(0, num(b?.time, 0)), count: mm(b?.countCurve ?? b?.count ?? 0), cycles: num(b?.cycleCount, 1) | 0,
    interval: Math.max(0.0001, num(b?.repeatInterval, 0.01)), prob: Math.min(1, Math.max(0, num(b?.probability, 1))),
  };
}

/** Over-lifetime module helpers. */
const xyz = (m, keys) => keys.map((k) => mm(m?.[k], 0));

/**
 * Compile a descriptor's ParticleSystem (+ its renderer) once: curves baked, enums resolved.
 * @param {any} ps node.particleSystem
 * @param {any} psr node.particleSystemRenderer (may be absent)
 * @param {{ mesh?: (key: string) => any }} [res]
 */
export function compileSystem(ps, psr, res = {}) {
  const I = ps.InitialModule || {};
  const def = {
    raw: ps,
    duration: Math.max(0.0001, num(ps.lengthInSec, 1)),
    looping: bool(ps.looping),
    prewarm: bool(ps.prewarm) && bool(ps.looping),
    startDelay: mm(ps.startDelay, 0),
    playOnAwake: ps.playOnAwake !== false && ps.playOnAwake !== 0,
    simSpeed: Math.max(0, num(ps.simulationSpeed, 1)),
    space: num(ps.moveWithTransform, 0) | 0,
    scalingMode: num(ps.scalingMode, 1) | 0,
    emitterVelocityMode: num(ps.emitterVelocityMode, 0) | 0,
    seed: ps.autoRandomSeed === false || ps.autoRandomSeed === 0 ? (num(ps.randomSeed, 0) >>> 0) || 1 : 0,
    maxParticles: Math.max(0, Math.min(SYSTEM_CAP, num(I.maxNumParticles, 1000) | 0)),
    startLifetime: mm(I.startLifetime, 5),
    startSpeed: mm(I.startSpeed, 5),
    size3D: bool(I.size3D),
    startSize: mm(I.startSize, 1),
    startSizeY: mm(I.startSizeY, 1),
    startSizeZ: mm(I.startSizeZ, 1),
    rot3D: bool(I.rotation3D),
    startRotation: mm(I.startRotation, 0),
    startRotationX: mm(I.startRotationX, 0),
    startRotationY: mm(I.startRotationY, 0),
    randRotDir: Math.min(1, Math.max(0, num(I.randomizeRotationDirection, 0))),
    startColor: new MinMaxColor(I.startColor ?? [1, 1, 1, 1]),
    gravity: mm(I.gravityModifier, 0),
    shape: new Shape(ps.ShapeModule || null, res),
    emission: null, size: null, rotation: null, color: null, velocity: null, clamp: null, force: null, inherit: null,
    noise: null, uv: null, sub: null, trail: null, custom: null, sizeBySpeed: null, rotBySpeed: null, colorBySpeed: null,
    lifeBySpeed: null,
  };
  const E = ps.EmissionModule;
  if (E) {
    def.emission = {
      rate: mm(E.rateOverTime, 0), rateDist: mm(E.rateOverDistance, 0),
      bursts: Array.isArray(E.m_Bursts) ? E.m_Bursts.map(burst) : [],
    };
  }
  const S = ps.SizeModule;
  if (S) def.size = { sep: bool(S.separateAxes), x: mm(S.curve, 1), y: mm(S.y, 1), z: mm(S.z, 1) };
  const R = ps.RotationModule;
  if (R) def.rotation = { sep: bool(R.separateAxes), x: mm(R.x, 0), y: mm(R.y, 0), z: mm(R.curve, 0) };
  const C = ps.ColorModule;
  if (C) def.color = new MinMaxColor(C.gradient ?? [1, 1, 1, 1]);
  const V = ps.VelocityModule;
  if (V) {
    const [x, y, z] = xyz(V, ['x', 'y', 'z']);
    const [ox, oy, oz] = xyz(V, ['orbitalX', 'orbitalY', 'orbitalZ']);
    const [fx, fy, fz] = xyz(V, ['orbitalOffsetX', 'orbitalOffsetY', 'orbitalOffsetZ']);
    const linear = !(x.constant && y.constant && z.constant && !x.peak && !y.peak && !z.peak && x.min === 0 && y.min === 0 && z.min === 0);
    const orbital = !(ox.constant && oy.constant && oz.constant && !ox.peak && !oy.peak && !oz.peak && ox.min === 0 && oy.min === 0 && oz.min === 0);
    const radial = mm(V.radial, 0);
    def.velocity = { x, y, z, ox, oy, oz, fx, fy, fz, radial, linear, orbital, hasRadial: !(radial.constant && radial.peak === 0 && radial.min === 0),
      speed: mm(V.speedModifier, 1), world: bool(V.inWorldSpace) };
  }
  const L = ps.ClampVelocityModule;
  if (L) {
    def.clamp = { sep: bool(L.separateAxis), mag: mm(L.magnitude, 1), x: mm(L.x, 1), y: mm(L.y, 1), z: mm(L.z, 1),
      dampen: Math.min(1, Math.max(0, num(L.dampen, 1))), drag: mm(L.drag, 0), bySize: bool(L.multiplyDragByParticleSize),
      byVel: bool(L.multiplyDragByParticleVelocity), world: bool(L.inWorldSpace) };
  }
  const F = ps.ForceModule;
  if (F) { const [x, y, z] = xyz(F, ['x', 'y', 'z']); def.force = { x, y, z, world: bool(F.inWorldSpace), perFrame: bool(F.randomizePerFrame) }; }
  const H = ps.InheritVelocityModule;
  if (H) def.inherit = { mode: num(H.m_Mode, 0) | 0, curve: mm(H.m_Curve, 0) };
  const N = ps.NoiseModule;
  if (N) {
    def.noise = {
      sep: bool(N.separateAxes), x: mm(N.strength, 1), y: mm(N.strengthY ?? N.strength, 1), z: mm(N.strengthZ ?? N.strength, 1),
      freq: Math.max(0.0001, num(N.frequency, 0.5)), scroll: mm(N.scrollSpeed, 0), damping: bool(N.damping),
      octaves: Math.max(1, Math.min(4, num(N.octaves, 1) | 0)), octMul: num(N.octaveMultiplier, 0.5), octScale: num(N.octaveScale, 2),
      pos: mm(N.positionAmount, 1), rot: mm(N.rotationAmount, 0), size: mm(N.sizeAmount, 0),
    };
  }
  const U = ps.UVModule;
  if (U) {
    const tx = Math.max(1, num(U.tilesX, 1) | 0), ty = Math.max(1, num(U.tilesY, 1) | 0);
    const row = num(U.animationType, 0) === 1;
    def.uv = {
      tx, ty, row, rowMode: num(U.rowMode, U.randomRow ? 1 : 0) | 0, rowIndex: num(U.rowIndex, 0) | 0, frames: row ? tx : tx * ty,
      timeMode: num(U.timeMode, 0) | 0, fps: num(U.fps, 30), speedRange: Array.isArray(U.speedRange) ? U.speedRange : [0, 1],
      over: mm(U.frameOverTime, 0), start: mm(U.startFrame, 0), cycles: Math.max(0, num(U.cycles, 1)),
      flipU: Math.min(1, Math.max(0, num(U.flipU, 0))), flipV: Math.min(1, Math.max(0, num(U.flipV, 0))),
    };
  }
  const SB = ps.SubModule;
  if (SB && Array.isArray(SB.subEmitters)) {
    const list = SB.subEmitters.filter((s) => s && s.emitter && s.emitter.node != null)
      .map((s) => ({ node: s.emitter.node, type: num(s.type, 0) | 0, props: num(s.properties, 0) | 0, prob: Math.min(1, Math.max(0, num(s.emitProbability, 1))) }));
    if (list.length) def.sub = list;
  }
  const T = ps.TrailModule;
  if (T) {
    def.trail = {
      mode: num(T.mode, 0) | 0, ratio: Math.min(1, Math.max(0, num(T.ratio, 1))), life: mm(T.lifetime, 1),
      minDist: Math.max(0, num(T.minVertexDistance, 0.2)), textureMode: num(T.textureMode, 0) | 0, world: bool(T.worldSpace),
      die: T.dieWithParticles !== false && T.dieWithParticles !== 0, sizeWidth: T.sizeAffectsWidth !== false && T.sizeAffectsWidth !== 0,
      sizeLife: bool(T.sizeAffectsLifetime), inheritColor: T.inheritParticleColor !== false && T.inheritParticleColor !== 0,
      colorLife: new MinMaxColor(T.colorOverLifetime ?? [1, 1, 1, 1]), width: mm(T.widthOverTrail, 1),
      colorTrail: new MinMaxColor(T.colorOverTrail ?? [1, 1, 1, 1]), ribbons: Math.max(1, num(T.ribbonCount, 1) | 0),
    };
  }
  const CD = ps.CustomDataModule;
  if (CD) {
    const stream = (k) => {
      const mode = num(CD['mode' + k], 0) | 0;
      if (mode === 1) {
        const n = Math.max(1, Math.min(4, num(CD['vectorComponentCount' + k], 4) | 0));
        return { mode, n, v: [0, 1, 2, 3].map((i) => mm(CD[`vector${k}_${i}`], 0)) };
      }
      if (mode === 2) return { mode, n: 4, c: new MinMaxColor(CD['color' + k] ?? [1, 1, 1, 1]) };
      return null;
    };
    def.custom = [stream(0), stream(1)];
  }
  const SS = ps.SizeBySpeedModule;
  if (SS) def.sizeBySpeed = { sep: bool(SS.separateAxes), x: mm(SS.curve, 1), y: mm(SS.y, 1), z: mm(SS.z, 1), range: SS.range || [0, 1] };
  const RS = ps.RotationBySpeedModule;
  if (RS) def.rotBySpeed = { sep: bool(RS.separateAxes), x: mm(RS.x, 0), y: mm(RS.y, 0), z: mm(RS.curve, 0), range: RS.range || [0, 1] };
  const CS = ps.ColorBySpeedModule;
  if (CS) def.colorBySpeed = { c: new MinMaxColor(CS.gradient ?? [1, 1, 1, 1]), range: CS.range || [0, 1] };
  const LS = ps.LifetimeByEmitterSpeedModule;
  if (LS) def.lifeBySpeed = { curve: mm(LS.m_Curve ?? LS.curve, 1), range: LS.m_Range || LS.range || [0, 1] };
  def.renderer = psr || null;
  return def;
}

// ---- noise (smooth value noise, 3D, with octaves) -------------------------------------------------------------------

const PERM = new Uint8Array(512);
{
  const r = new Rng(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = (r.next() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GR = new Float32Array(256);
{ const r = new Rng(4242); for (let i = 0; i < 256; i++) GR[i] = r.next() * 2 - 1; }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise in [-1, 1] at (x, y, z). */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const cx = xi & 255, cy = yi & 255, cz = zi & 255;   // the lattice cell (lower-case names: the hotkey scan of public/js reads a capital X index as a key)
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const a = PERM[cx] + cy, aa = PERM[a] + cz, ab = PERM[a + 1] + cz, b = PERM[cx + 1] + cy, ba = PERM[b] + cz, bb = PERM[b + 1] + cz;
  const l = (p, q, t) => p + (q - p) * t;
  return l(l(l(GR[PERM[aa]], GR[PERM[ba]], u), l(GR[PERM[ab]], GR[PERM[bb]], u), v),
    l(l(GR[PERM[aa + 1]], GR[PERM[ba + 1]], u), l(GR[PERM[ab + 1]], GR[PERM[bb + 1]], u), v), w);
}

// ---- the system instance ---------------------------------------------------------------------------------------------

const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'tvx', 'tvy', 'tvz', 'age', 'life', 'sx', 'sy', 'sz', 'rx', 'ry', 'rz',
  'cr', 'cg', 'cb', 'ca', 'subAcc'];

const _shape = { px: 0, py: 0, pz: 0, dx: 0, dy: 0, dz: 1 };
const _ctx = { time: 0, tau: 0, index: 0, count: 0 };
const _c4 = [1, 1, 1, 1];
const _v3 = [0, 0, 0];
const _w3 = [0, 0, 0];
const _full = new Float32Array(16);

/**
 * A copy of affine matrix m whose empty basis columns (a zero scale) are unit axes — the cross product of the other two
 * (two empty: world axes) — for an invertible stand-in (PSys._inverse).
 */
export function completeAxes(m, out) {
  out.set(m);
  const len = (c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
  const k = [len(0), len(1), len(2)];
  const eps = 1e-5 * Math.max(1e-6, k[0], k[1], k[2]);   // (relative: float noise of a zero-scaled axis is no axis)
  const empty = k.map((v) => !(v > eps));
  const n = empty.filter(Boolean).length;
  for (let c = 0; c < 3; c++) {
    if (!empty[c]) continue;
    let x = c === 0 ? 1 : 0, y = c === 1 ? 1 : 0, z = c === 2 ? 1 : 0;
    if (n === 1) {
      const a = ((c + 1) % 3) * 4, b = ((c + 2) % 3) * 4;
      const cx = m[a + 1] * m[b + 2] - m[a + 2] * m[b + 1], cy = m[a + 2] * m[b] - m[a] * m[b + 2], cz = m[a] * m[b + 1] - m[a + 1] * m[b];
      const l = Math.hypot(cx, cy, cz);
      if (l > 1e-12) { x = cx / l; y = cy / l; z = cz / l; }
    }
    out[c * 4] = x; out[c * 4 + 1] = y; out[c * 4 + 2] = z;
  }
  return out;
}

export class PSys {
  /**
   * @param {any} def compileSystem(...)
   * @param {{ seed?: number, emission?: number, sub?: boolean, rng?: Rng }} [opts]
   *   emission: multiplier of the emitted counts (the light tier's ×0.5, FxLODSetting's detail share)
   */
  constructor(def, opts = {}) {
    this.def = def;
    this.rng = opts.rng || new Rng(def.seed || opts.seed || ((Math.random() * 4294967296) >>> 0));
    this.emissionScale = num(opts.emission, 1);
    this.isSub = !!opts.sub;
    // per-instance references to the def's curves (a clip binding replaces one with a private copy: overrideField)
    this.rate = def.emission ? def.emission.rate : null;
    this.sizeX = def.size ? def.size.x : null;
    this.startColor = def.startColor;
    this.cap = 0;
    this.count = 0;
    for (const f of FIELDS) this[f] = new Float32Array(0);
    this.seed = new Uint32Array(0);
    this.trailBuf = null;   // Float32Array(cap × TRAIL_POINTS × 4): x, y, z, time
    this.trailHead = null;  // Uint16Array: write index (ring)
    this.trailLen = null;   // Uint16Array: points kept
    this.orphans = [];      // trails of dead particles that outlive them { pts: Float32Array, n, color, size }
    this.children = [];     // { sys: PSys, type, props, prob } (wired by the effect)
    this.pending = [];      // delayed sub-emitter bursts { t, count, x, y, z, inherit }
    this.playing = false;
    this.emitting = false;
    this.time = 0;          // s since play (system clock, × simulation speed)
    this.delay = 0;
    this.loopT = 0;         // time inside the current loop iteration (after the delay)
    this.loops = 0;
    this.acc = 0;           // rate-over-time accumulator
    this.accDist = 0;       // rate-over-distance accumulator
    this.burstNext = def.emission ? def.emission.bursts.map(() => 0) : []; // next cycle index per burst (this iteration)
    this.m = mat4();        // render matrix (frame.m)
    this.inv = mat4();
    this._invOk = false;
    this.scale = [1, 1, 1]; // scale of the scaling mode
    // sizes in the system's own units, drawn × the scaling mode's scale of the frame (a local-space system that scales
    // them: sizeScale); a world-space system's (and Shape mode's) are as born
    this.liveScale = def.space !== 1 && def.scalingMode !== 2;
    this.pos = [0, 0, 0];   // world position (emitter)
    this.prevPos = null;
    this.vel = [0, 0, 0];   // emitter velocity (world, per s)
    this.time0 = 0;         // battle time at play (custom data / noise scroll)
    this.started = false;
    this.wasAlive = false;
    this.deaths = 0;
  }

  get alive() { return this.playing && (this.emitting || this.count > 0 || this.orphans.length > 0 || this.pending.length > 0); }

  /** The factor of axis k (0 x, 1 y, 2 z) the stored sizes are drawn at: the scaling mode's scale now (liveScale), else 1. */
  sizeScale(k) { return this.liveScale ? Math.abs(this.scale[k]) : 1; }

  /** Replace a curve field for this instance only (clip bindings, §33.10 'ParticleSystem' paths). */
  overrideField(path, value) {
    const v = num(value, 0);
    const set = (src, key) => {
      let c = this[key];
      if (!c || c === src) { c = Object.assign(Object.create(Object.getPrototypeOf(src)), src); this[key] = c; }
      return c;
    };
    if (path === 'EmissionModule.rateOverTime.scalar' && this.rate) {
      const c = set(this.def.emission.rate, 'rate');
      if (c.mode === 0) c.c = v; else if (c.mode === 3) c.max = v; else c.scalar = v;
      return true;
    }
    if (path === 'EmissionModule.rateOverTime.minScalar' && this.rate) { set(this.def.emission.rate, 'rate').min = v; return true; }
    if (path === 'SizeModule.curve.scalar' && this.sizeX) {
      const c = set(this.def.size.x, 'sizeX');
      if (c.mode === 0) c.c = v; else if (c.mode === 3) c.max = v; else c.scalar = v;
      return true;
    }
    const m = /^InitialModule\.startColor\.(maxColor|minColor)\.([rgba])$/.exec(path);
    if (m) {
      const c = set(this.def.startColor, 'startColor');
      const i = 'rgba'.indexOf(m[2]);
      if (c.mode === 0) { if (c.c === this.def.startColor.c) c.c = c.c.slice(); c.c[i] = v; }
      else if (c.mode === 2) { const k = m[1] === 'maxColor' ? 'max' : 'min'; if (c[k] === this.def.startColor[k]) c[k] = c[k].slice(); c[k][i] = v; }
      return true;
    }
    return false;
  }

  _grow(n) {
    const cap = Math.min(Math.max(this.def.maxParticles, 1), Math.max(n, this.cap ? this.cap * 2 : 16));
    if (cap <= this.cap) return false;
    for (const f of FIELDS) { const a = new Float32Array(cap); a.set(this[f].subarray(0, this.count)); this[f] = a; }
    const s = new Uint32Array(cap); s.set(this.seed.subarray(0, this.count)); this.seed = s;
    if (this.def.trail) {
      const tb = new Float32Array(cap * TRAIL_POINTS * 4);
      if (this.trailBuf) tb.set(this.trailBuf.subarray(0, this.count * TRAIL_POINTS * 4));
      this.trailBuf = tb;
      const th = new Uint16Array(cap), tl = new Uint16Array(cap);
      if (this.trailHead) { th.set(this.trailHead.subarray(0, this.count)); tl.set(this.trailLen.subarray(0, this.count)); }
      this.trailHead = th; this.trailLen = tl;
    }
    this.cap = cap;
    return true;
  }

  /** Start (or restart) the system: start delay sampled, prewarm simulated. `frame` places it before the first step. */
  play(frame) {
    this.clear();
    this.playing = true;
    this.emitting = !this.isSub;
    this.time = 0;
    this.delay = this.def.prewarm ? 0 : Math.max(0, this.def.startDelay.at(0, this.rng.next()));
    this.loopT = 0; this.loops = 0; this.acc = 0; this.accDist = 0;
    this.burstNext.fill(0);
    this.started = false;
    if (frame) this.setFrame(frame);
    this.prevPos = null;
    if (this.def.prewarm && this.emitting) {
      // as if one full loop had already run (Unity: the start delay does not apply with prewarm)
      const d = this.def.duration;
      let t = 0;
      while (t < d - 1e-6) { const s = Math.min(MAX_STEP, d - t); this._step(s, true); t += s; }
      this.prevPos = null;
    }
  }

  /** Stop emitting; live particles finish their lives (Unity's StopEmitting). */
  stopEmitting() { this.emitting = false; this.pending.length = 0; }

  /** Kill every particle (and orphaned trail) now. */
  clear() {
    this.count = 0;
    this.orphans.length = 0;
    this.pending.length = 0;
  }

  /** The render matrix and emitter position of this frame (see the header). */
  setFrame(frame) {
    this.m.set(frame.m);
    this._invOk = false;
    this.scale[0] = frame.scale[0]; this.scale[1] = frame.scale[1]; this.scale[2] = frame.scale[2];
    this.pos[0] = frame.m[12]; this.pos[1] = frame.m[13]; this.pos[2] = frame.m[14];
  }

  /**
   * The inverse of the render matrix; a singular one (a zero scale of the scaling mode — the system's own in Local
   * mode, any in Hierarchy) is inverted with its empty axes as unit axes, so a conversion world → local → world keeps
   * the other components instead of the identity's (which made a world-space system's limited velocity grow without
   * bound: 珊比's 'lizi (2)' flew 24,000 tiles in a second).
   */
  _inverse() {
    if (!this._invOk) {
      const m = this.m;
      const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
      const k = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10]));
      if (Math.abs(det) > 1e-6 * k * k * k) mat4InvertAffine(m, this.inv);
      else mat4InvertAffine(completeAxes(m, _full), this.inv);
      this._invOk = true;
    }
    return this.inv;
  }

  /** Advance by dt battle seconds (frame: this frame's render matrix, see setFrame). */
  update(dt, frame) {
    if (!this.playing) return;
    const prev = this.prevPos ? [this.prevPos[0], this.prevPos[1], this.prevPos[2]] : null;
    if (frame) this.setFrame(frame);
    const sdt = dt * this.def.simSpeed;
    // emitter velocity (world units per battle s) for inherit velocity and rate over distance
    if (prev && dt > 0) {
      this.vel[0] = (this.pos[0] - prev[0]) / dt; this.vel[1] = (this.pos[1] - prev[1]) / dt; this.vel[2] = (this.pos[2] - prev[2]) / dt;
    } else { this.vel[0] = this.vel[1] = this.vel[2] = 0; }
    this._from = prev || [this.pos[0], this.pos[1], this.pos[2]];
    const steps = Math.max(1, Math.ceil(sdt / MAX_STEP - 1e-6));
    const h = sdt / steps;
    for (let i = 0; i < steps; i++) {
      this._stepFrac0 = i / steps; this._stepFrac1 = (i + 1) / steps;
      this._step(h, false);
    }
    this.prevPos = [this.pos[0], this.pos[1], this.pos[2]];
  }

  /** One simulation step of h system seconds. */
  _step(h, prewarm) {
    const def = this.def;
    if (!(h > 0)) return;
    const t0 = this.time;
    this.time += h;
    // ---- age, die, forces, move ----
    this._simulate(h, prewarm);
    // ---- pending sub-emitter bursts ----
    if (this.pending.length) {
      let w = 0;
      for (const p of this.pending) {
        p.t -= h;
        if (p.t <= 0) this._emitAt(p.count, p.x, p.y, p.z, p.inherit, p.world);
        else this.pending[w++] = p;
      }
      this.pending.length = w;
    }
    // ---- emission ----
    if (!this.emitting) return;
    const local0 = t0 - this.delay, local1 = this.time - this.delay;
    if (local1 < 0) return;
    if (!def.emission) {
      // a system that emits nothing (the timing parents) still ends with its duration
      if (!def.looping && local1 >= def.duration) this.emitting = false;
      return;
    }
    let a = Math.max(0, local0), b = local1;
    if (!this.started) { this.started = true; a = 0; this._burstFrom = -1e-9; }
    // a non-looping system emits during its duration only
    const D = def.duration;
    while (a < b) {
      const loopStart = this.loops * D;
      const segEnd = Math.min(b, loopStart + D);
      const la = a - loopStart, lb = segEnd - loopStart;
      this._emitSpan(la, lb, b - a > 0 ? (segEnd - a) / (b - a) : 1, prewarm);
      a = segEnd;
      if (segEnd >= loopStart + D - 1e-9) {
        if (!def.looping) { this.emitting = false; break; }
        this.loops++;
        this.burstNext.fill(0);
        this._burstFrom = -1e-9;
      }
    }
  }

  /** Emission inside one loop iteration from local time la to lb. */
  _emitSpan(la, lb, _share, prewarm) {
    const def = this.def, E = def.emission, D = def.duration;
    const tau = Math.min(1, lb / D);
    const span = lb - la;
    // rate over time
    let n = 0;
    const rate = this.rate.at(tau, this.rng.next()) * this.emissionScale;
    if (rate > 0) {
      this.acc += rate * span;
      n = Math.floor(this.acc);
      this.acc -= n;
    }
    // rate over distance (emitter motion in world units)
    let nd = 0;
    const rd = E.rateDist.peak > 0 ? E.rateDist.at(tau, this.rng.next()) * this.emissionScale : 0;
    if (rd > 0 && !prewarm && this.prevPos !== null) {
      const f0 = this._stepFrac0 ?? 0, f1 = this._stepFrac1 ?? 1, fr = this._from;
      const dx = (this.pos[0] - fr[0]) * (f1 - f0), dy = (this.pos[1] - fr[1]) * (f1 - f0), dz = (this.pos[2] - fr[2]) * (f1 - f0);
      this.accDist += rd * Math.sqrt(dx * dx + dy * dy + dz * dz);
      nd = Math.floor(this.accDist);
      this.accDist -= nd;
    }
    const total = n + nd;
    for (let i = 0; i < total; i++) {
      // spread over the step: the i-th of n is (n − i) / n of the step old, placed along the emitter's motion
      const f = (i + 1) / total;
      this._spawn(tau, (1 - f) * span, f, 0, 0, null);
    }
    // bursts
    for (let bi = 0; bi < E.bursts.length; bi++) {
      const B = E.bursts[bi];
      for (;;) {
        const k = this.burstNext[bi];
        if (B.cycles > 0 && k >= B.cycles) break;
        const tf = B.time + k * B.interval;
        if (tf >= D && k > 0) break;
        if (tf > lb + 1e-9) break;
        this.burstNext[bi] = k + 1;
        if (tf < la - 1e-9 && !(la === 0 && tf <= 1e-9)) continue; // passed while not emitting (a late start)
        if (B.prob < 1 && this.rng.next() >= B.prob) continue;
        const c = Math.round(B.count.at(Math.min(1, tf / D), this.rng.next()) * this.emissionScale);
        for (let i = 0; i < c; i++) this._spawn(tau, Math.max(0, lb - tf), 1, i, c, null);
      }
    }
  }

  /**
   * Emit `count` particles at a point (sub-emitters): x, y, z in world space; `inherit` = { props, r, g, b, a, size,
   * rot, life } of the parent.
   */
  _emitAt(count, x, y, z, inherit) {
    for (let i = 0; i < count; i++) this._spawn(Math.min(1, this.time / this.def.duration), 0, 1, i, count, inherit, x, y, z);
  }

  /** Sub-emitter trigger from a parent particle (death / birth): bursts of this system at the point. */
  trigger(x, y, z, inherit) {
    if (!this.playing) { this.playing = true; this.emitting = false; this.started = true; }
    const E = this.def.emission;
    if (!E) return;
    for (const B of E.bursts) {
      if (B.prob < 1 && this.rng.next() >= B.prob) continue;
      const cycles = B.cycles > 0 ? B.cycles : 1;
      for (let k = 0; k < cycles; k++) {
        const c = Math.round(B.count.at(0, this.rng.next()) * this.emissionScale);
        const t = B.time + k * B.interval;
        if (c <= 0) continue;
        if (t <= 1e-6) this._emitAt(c, x, y, z, inherit);
        else this.pending.push({ t, count: c, x, y, z, inherit });
      }
    }
  }

  /**
   * Birth one particle. tau: system normalised time; age: initial age (s into the step); f: 0…1 along this step's emitter
   * motion; (bi, bc): place in a burst; inherit: sub-emitter parent; (ex, ey, ez): a world emission point (sub-emitters).
   */
  _spawn(tau, age, f, bi, bc, inherit, ex, ey, ez) {
    const def = this.def;
    if (this.count >= def.maxParticles || this.count >= SYSTEM_CAP) return -1;
    if (this.count >= this.cap && !this._grow(this.count + 1)) return -1;
    const i = this.count++;
    const rng = this.rng;
    const s = rng.seed();
    this.seed[i] = s;
    let life = def.startLifetime.at(tau, hashRand(s, RF.LIFETIME));
    if (def.lifeBySpeed) {
      const sp = Math.hypot(this.vel[0], this.vel[1], this.vel[2]), r = def.lifeBySpeed.range;
      life *= def.lifeBySpeed.curve.at(Math.min(1, Math.max(0, (sp - r[0]) / ((r[1] - r[0]) || 1))), hashRand(s, RF.LIFE_SPEED));
    }
    if (inherit && (inherit.props & 8)) life *= inherit.life || 1;
    if (!(life > 0)) { this.count--; return -1; }
    this.life[i] = life;
    this.age[i] = Math.min(age, life * 0.999);
    const speed = def.startSpeed.at(tau, hashRand(s, RF.SPEED));
    // size (× the scale of the scaling mode at birth for a world-space system, except Shape; a local-space system's
    // sizes are drawn × its scale as it is then: sizeScale)
    const sk = def.scalingMode === 2 || this.liveScale ? 1 : 0;
    const scx = sk ? 1 : Math.abs(this.scale[0]), scy = sk ? 1 : Math.abs(this.scale[1]), scz = sk ? 1 : Math.abs(this.scale[2]);
    let sx = def.startSize.at(tau, hashRand(s, RF.SIZE)), sy = sx, sz = sx;
    if (def.size3D) { sy = def.startSizeY.at(tau, hashRand(s, RF.SIZE_Y)); sz = def.startSizeZ.at(tau, hashRand(s, RF.SIZE_Z)); }
    if (inherit && (inherit.props & 2)) { sx *= inherit.size; sy *= inherit.size; sz *= inherit.size; }
    this.sx[i] = sx * scx; this.sy[i] = sy * scy; this.sz[i] = sz * scz;
    // rotation (radians); a share of particles mirrored
    const dir = def.randRotDir > 0 && hashRand(s, RF.ROT_DIR) < def.randRotDir ? -1 : 1;
    this.rz[i] = def.startRotation.at(tau, hashRand(s, RF.ROT)) * dir + (inherit && (inherit.props & 4) ? inherit.rot : 0);
    this.rx[i] = def.rot3D ? def.startRotationX.at(tau, hashRand(s, RF.ROT_X)) * dir : 0;
    this.ry[i] = def.rot3D ? def.startRotationY.at(tau, hashRand(s, RF.ROT_Y)) * dir : 0;
    // colour
    this.startColor.at(tau, hashRand(s, RF.COLOR), _c4);
    if (inherit && (inherit.props & 1)) { _c4[0] *= inherit.r; _c4[1] *= inherit.g; _c4[2] *= inherit.b; _c4[3] *= inherit.a; }
    this.cr[i] = _c4[0]; this.cg[i] = _c4[1]; this.cb[i] = _c4[2]; this.ca[i] = _c4[3];
    this.subAcc[i] = 0;
    // shape → system-local position / direction
    _ctx.time = this.time; _ctx.tau = tau; _ctx.index = bi; _ctx.count = bc;
    def.shape.sample(rng, _ctx, _shape);
    let px = _shape.px, py = _shape.py, pz = _shape.pz;
    let vx = _shape.dx * speed, vy = _shape.dy * speed, vz = _shape.dz * speed;
    if (def.scalingMode === 2) { px *= this.scale[0]; py *= this.scale[1]; pz *= this.scale[2]; }
    const m = this.m;
    if (ex !== undefined) {
      // a sub-emitter's point (world): the shape offset is kept in the system's orientation
      if (def.space === 1) {
        mat4Dir(m, px, py, pz, _v3);
        px = ex + _v3[0]; py = ey + _v3[1]; pz = ez + _v3[2];
        mat4Dir(m, vx, vy, vz, _v3); vx = _v3[0]; vy = _v3[1]; vz = _v3[2];
      } else {
        mat4Point(this._inverse(), ex, ey, ez, _w3);
        px += _w3[0]; py += _w3[1]; pz += _w3[2];
      }
    } else if (def.space === 1) {
      // world space: through the render matrix now; along this step's emitter motion
      mat4Point(m, px, py, pz, _v3);
      const fr = this._from;
      if (fr && f < 1) {
        const k = 1 - ((this._stepFrac0 ?? 0) + ((this._stepFrac1 ?? 1) - (this._stepFrac0 ?? 0)) * f);
        _v3[0] -= (this.pos[0] - fr[0]) * k; _v3[1] -= (this.pos[1] - fr[1]) * k; _v3[2] -= (this.pos[2] - fr[2]) * k;
      }
      px = _v3[0]; py = _v3[1]; pz = _v3[2];
      mat4Dir(m, vx, vy, vz, _v3);
      if (def.scalingMode === 2) { const l0 = Math.hypot(vx, vy, vz), l1 = Math.hypot(_v3[0], _v3[1], _v3[2]) || 1; _v3[0] *= l0 / l1; _v3[1] *= l0 / l1; _v3[2] *= l0 / l1; }
      vx = _v3[0]; vy = _v3[1]; vz = _v3[2];
    }
    // inherit velocity (initial): the emitter's world velocity × curve
    if (def.inherit && def.inherit.mode === 0) {
      const k = def.inherit.curve.at(tau, hashRand(s, RF.INHERIT));
      if (k) {
        if (def.space === 1) { vx += this.vel[0] * k; vy += this.vel[1] * k; vz += this.vel[2] * k; }
        else { mat4Dir(this._inverse(), this.vel[0] * k, this.vel[1] * k, this.vel[2] * k, _v3); vx += _v3[0]; vy += _v3[1]; vz += _v3[2]; }
      }
    }
    this.px[i] = px + vx * this.age[i]; this.py[i] = py + vy * this.age[i]; this.pz[i] = pz + vz * this.age[i];
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.tvx[i] = vx; this.tvy[i] = vy; this.tvz[i] = vz;
    if (this.trailLen) { this.trailLen[i] = 0; this.trailHead[i] = 0; }
    // sub-emitters of birth: the child systems follow this particle (emission handled in _simulate)
    return i;
  }

  /** Copy particle j into slot i (removal by swapping with the last). */
  _move(i, j) {
    for (const f of FIELDS) { const a = this[f]; a[i] = a[j]; }
    this.seed[i] = this.seed[j];
    if (this.trailBuf) {
      const P = TRAIL_POINTS * 4;
      this.trailBuf.copyWithin(i * P, j * P, j * P + P);
      this.trailHead[i] = this.trailHead[j]; this.trailLen[i] = this.trailLen[j];
    }
  }

  /** World position of particle i into out. */
  worldPos(i, out) {
    if (this.def.space === 1) { out[0] = this.px[i]; out[1] = this.py[i]; out[2] = this.pz[i]; return out; }
    return mat4Point(this.m, this.px[i], this.py[i], this.pz[i], out);
  }

  _inheritOf(i, props, out = {}) {
    out.props = props;
    const t = this.age[i] / this.life[i];
    let r = this.cr[i], g = this.cg[i], b = this.cb[i], a = this.ca[i];
    if (this.def.color) { this.def.color.at(t, hashRand(this.seed[i], RF.COLOR_OL), _c4); r *= _c4[0]; g *= _c4[1]; b *= _c4[2]; a *= _c4[3]; }
    out.r = r; out.g = g; out.b = b; out.a = a;
    out.size = this.sx[i] * this.sizeScale(0) * (this.sizeX ? this.sizeX.at(t, hashRand(this.seed[i], RF.SIZE_OL)) : 1);
    out.rot = this.rz[i];
    out.life = Math.max(0, this.life[i] - this.age[i]) / Math.max(1e-6, this.life[i]);
    return out;
  }

  /** Age, kill, apply forces and move every particle by h seconds. */
  _simulate(h, prewarm) {
    const def = this.def;
    const n0 = this.count;
    if (!n0 && !this.orphans.length) return;
    const V = def.velocity, L = def.clamp, Fo = def.force, No = def.noise, R = def.rotation, RB = def.rotBySpeed;
    const local = def.space !== 1;
    // gravity in simulation space
    let gx = 0, gy = 0, gz = 0;
    const gm = def.gravity.peak !== 0 || def.gravity.min !== 0 ? def.gravity.at(Math.min(1, Math.max(0, (this.time - this.delay) / def.duration)), 0.5) : 0;
    if (gm) {
      if (local) { mat4Dir(this._inverse(), 0, -GRAVITY * gm, 0, _v3); gx = _v3[0]; gy = _v3[1]; gz = _v3[2]; }
      else gy = -GRAVITY * gm;
    }
    const inv = local ? this._inverse() : null;
    const m = this.m;
    const subs = this.children;
    const hasBirthSub = subs.length && subs.some((c) => c.type === 0);
    const hasDeathSub = subs.length && subs.some((c) => c.type === 2);
    const trail = def.trail && this.trailBuf ? def.trail : null;
    const noiseT = (this.time - this.delay);
    let i = 0;
    while (i < this.count) {
      const age = this.age[i] + h;
      if (age >= this.life[i]) {
        // death: sub-emitters, the trail outliving its particle, then swap-remove
        if (hasDeathSub && !prewarm) this._subEmit(i, 2);
        if (trail && !trail.die && this.trailLen[i] > 1) this._orphan(i);
        this.deaths++;
        const last = --this.count;
        if (i !== last) this._move(i, last);
        continue;
      }
      this.age[i] = age;
      const t = age / this.life[i];
      const s = this.seed[i];
      let vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
      // forces → stored velocity
      vx += gx * h; vy += gy * h; vz += gz * h;
      if (Fo) {
        const fr = Fo.perFrame ? this.rng.next() : 0;
        let fx = Fo.x.at(t, Fo.perFrame ? fr : hashRand(s, RF.FORCE_X)), fy = Fo.y.at(t, Fo.perFrame ? fr : hashRand(s, RF.FORCE_Y)), fz = Fo.z.at(t, Fo.perFrame ? fr : hashRand(s, RF.FORCE_Z));
        if (Fo.world && local) { mat4Dir(inv, fx, fy, fz, _v3); fx = _v3[0]; fy = _v3[1]; fz = _v3[2]; }
        else if (!Fo.world && !local) { mat4Dir(m, fx, fy, fz, _v3); fx = _v3[0]; fy = _v3[1]; fz = _v3[2]; }
        vx += fx * h; vy += fy * h; vz += fz * h;
      }
      if (def.inherit && def.inherit.mode === 1) {
        const k = def.inherit.curve.at(t, hashRand(s, RF.INHERIT));
        if (k) {
          if (local) { mat4Dir(inv, this.vel[0] * k, this.vel[1] * k, this.vel[2] * k, _v3); vx += _v3[0] * h; vy += _v3[1] * h; vz += _v3[2] * h; }
          else { vx += this.vel[0] * k * h; vy += this.vel[1] * k * h; vz += this.vel[2] * k * h; }
        }
      }
      // animated velocity (not accumulated): velocity over lifetime, orbital / radial, noise
      let ax = 0, ay = 0, az = 0, spMod = 1;
      if (V) {
        if (V.linear) {
          let lx = V.x.at(t, hashRand(s, RF.VEL_X)), ly = V.y.at(t, hashRand(s, RF.VEL_Y)), lz = V.z.at(t, hashRand(s, RF.VEL_Z));
          if (V.world && local) { mat4Dir(inv, lx, ly, lz, _v3); lx = _v3[0]; ly = _v3[1]; lz = _v3[2]; }
          else if (!V.world && !local) { mat4Dir(m, lx, ly, lz, _v3); lx = _v3[0]; ly = _v3[1]; lz = _v3[2]; }
          ax += lx; ay += ly; az += lz;
        }
        if (V.orbital || V.hasRadial) {
          // around the system centre (+ offset), in the system's local axes
          let cx, cy, cz;
          if (local) { cx = this.px[i]; cy = this.py[i]; cz = this.pz[i]; }
          else { mat4Point(inv || this._inverse(), this.px[i], this.py[i], this.pz[i], _w3); cx = _w3[0]; cy = _w3[1]; cz = _w3[2]; }
          cx -= V.fx.at(t, 0); cy -= V.fy.at(t, 0); cz -= V.fz.at(t, 0);
          let ox = 0, oy = 0, oz = 0;
          if (V.orbital) {
            const wx = V.ox.at(t, hashRand(s, RF.ORB_X)), wy = V.oy.at(t, hashRand(s, RF.ORB_Y)), wz = V.oz.at(t, hashRand(s, RF.ORB_Z));
            ox += wy * cz - wz * cy; oy += wz * cx - wx * cz; oz += wx * cy - wy * cx;
          }
          if (V.hasRadial) {
            const rv = V.radial.at(t, hashRand(s, RF.RADIAL)), l = Math.hypot(cx, cy, cz);
            if (l > 1e-6) { ox += cx / l * rv; oy += cy / l * rv; oz += cz / l * rv; }
          }
          if (!local) { mat4Dir(m, ox, oy, oz, _v3); ox = _v3[0]; oy = _v3[1]; oz = _v3[2]; }
          ax += ox; ay += oy; az += oz;
        }
        spMod = V.speed.at(t, hashRand(s, RF.SPEED_MOD));
      }
      if (No) {
        const f = No.freq, sc = No.scroll.at(t, 0) * noiseT;
        const px = this.px[i] * f + sc, py = this.py[i] * f + sc, pz = this.pz[i] * f + sc;
        let nx = 0, ny = 0, nz = 0, amp = 1, fq = 1, norm = 0;
        for (let o = 0; o < No.octaves; o++) {
          nx += noise3(px * fq, py * fq, pz * fq + 17.3) * amp;
          ny += noise3(px * fq + 31.7, py * fq, pz * fq) * amp;
          nz += noise3(px * fq, py * fq + 53.1, pz * fq) * amp;
          norm += amp; amp *= No.octMul; fq *= No.octScale;
        }
        const k = No.pos.at(t, 0) / norm;
        const st = No.x.at(t, hashRand(s, RF.NOISE));
        ax += nx * k * st; ay += ny * k * (No.sep ? No.y.at(t, hashRand(s, RF.NOISE)) : st); az += nz * k * (No.sep ? No.z.at(t, hashRand(s, RF.NOISE)) : st);
      }
      // limit velocity: dampen the excess, then drag (per step)
      if (L) {
        let tx = vx + ax, ty = vy + ay, tz = vz + az;
        const toW = L.world && local, toL = !L.world && !local;
        if (toW) { mat4Dir(m, tx, ty, tz, _v3); tx = _v3[0]; ty = _v3[1]; tz = _v3[2]; }
        else if (toL) { mat4Dir(inv || this._inverse(), tx, ty, tz, _v3); tx = _v3[0]; ty = _v3[1]; tz = _v3[2]; }
        let nx = tx, ny = ty, nz = tz;
        if (L.sep) {
          const lx = L.x.at(t, hashRand(s, RF.LIMIT)), ly = L.y.at(t, hashRand(s, RF.LIMIT)), lz = L.z.at(t, hashRand(s, RF.LIMIT));
          if (Math.abs(nx) > lx) nx = Math.sign(nx) * (Math.abs(nx) + (lx - Math.abs(nx)) * L.dampen);
          if (Math.abs(ny) > ly) ny = Math.sign(ny) * (Math.abs(ny) + (ly - Math.abs(ny)) * L.dampen);
          if (Math.abs(nz) > lz) nz = Math.sign(nz) * (Math.abs(nz) + (lz - Math.abs(nz)) * L.dampen);
        } else {
          const lim = L.mag.at(t, hashRand(s, RF.LIMIT)), sp = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (sp > lim && sp > 1e-9) { const k = (sp + (lim - sp) * L.dampen) / sp; nx *= k; ny *= k; nz *= k; }
        }
        const drag = L.drag.peak !== 0 || L.drag.min !== 0 ? L.drag.at(t, hashRand(s, RF.DRAG)) : 0;
        if (drag > 0) {
          let k = drag;
          if (L.bySize) { const sz = Math.max(this.sx[i] * this.sizeScale(0), this.sy[i] * this.sizeScale(1)); k *= sz * sz; }
          if (L.byVel) k *= Math.sqrt(nx * nx + ny * ny + nz * nz);
          const d = Math.max(0, 1 - k * h);
          nx *= d; ny *= d; nz *= d;
        }
        if (toW) { mat4Dir(inv || this._inverse(), nx, ny, nz, _v3); nx = _v3[0]; ny = _v3[1]; nz = _v3[2]; }
        else if (toL) { mat4Dir(m, nx, ny, nz, _v3); nx = _v3[0]; ny = _v3[1]; nz = _v3[2]; }
        // the stored velocity takes the change (the animated part stays as evaluated)
        vx = nx - ax; vy = ny - ay; vz = nz - az;
      }
      this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
      const mx = (vx + ax) * spMod, my = (vy + ay) * spMod, mz = (vz + az) * spMod;
      this.tvx[i] = mx; this.tvy[i] = my; this.tvz[i] = mz;
      this.px[i] += mx * h; this.py[i] += my * h; this.pz[i] += mz * h;
      // rotation over lifetime / by speed (rad/s), noise rotation
      if (R) {
        const dir = def.randRotDir > 0 && hashRand(s, RF.ROT_DIR) < def.randRotDir ? -1 : 1;
        this.rz[i] += R.z.at(t, hashRand(s, RF.ROT_OL)) * h * dir;
        if (R.sep) { this.rx[i] += R.x.at(t, hashRand(s, RF.ROT_OL_X)) * h * dir; this.ry[i] += R.y.at(t, hashRand(s, RF.ROT_OL_Y)) * h * dir; }
      }
      if (RB) {
        const sp = Math.sqrt(mx * mx + my * my + mz * mz), rr = RB.range;
        const u = Math.min(1, Math.max(0, (sp - rr[0]) / ((rr[1] - rr[0]) || 1)));
        this.rz[i] += RB.z.at(u, hashRand(s, RF.ROT_SPEED)) * h;
        if (RB.sep) { this.rx[i] += RB.x.at(u, hashRand(s, RF.ROT_SPEED)) * h; this.ry[i] += RB.y.at(u, hashRand(s, RF.ROT_SPEED)) * h; }
      }
      if (No && No.rot.peak) this.rz[i] += noise3(this.px[i] * No.freq + 91.1, this.py[i] * No.freq, noiseT) * No.rot.at(t, 0) * h;
      // trails: a new point every minVertexDistance
      if (trail) this._trailPoint(i, trail);
      // birth sub-emitters: this particle emits the child's rate over time (and its bursts by the particle's age)
      if (hasBirthSub && !prewarm) this._subBirth(i, h);
      i++;
    }
    // orphaned trails fade out as their points expire
    if (this.orphans.length) {
      let w = 0;
      for (const o of this.orphans) { o.t += h; if (o.t < o.life) this.orphans[w++] = o; }
      this.orphans.length = w;
    }
  }

  /** A trail point for particle i when it moved minVertexDistance from the last one. */
  _trailPoint(i, tr) {
    const P = TRAIL_POINTS, base = i * P * 4, buf = this.trailBuf;
    let x, y, z;
    if (tr.world) { this.worldPos(i, _w3); x = _w3[0]; y = _w3[1]; z = _w3[2]; }
    else { x = this.px[i]; y = this.py[i]; z = this.pz[i]; }
    const n = this.trailLen[i], head = this.trailHead[i];
    if (n > 0) {
      const last = base + ((head + P - 1) % P) * 4;
      const dx = x - buf[last], dy = y - buf[last + 1], dz = z - buf[last + 2];
      if (dx * dx + dy * dy + dz * dz < tr.minDist * tr.minDist) return;
    }
    const o = base + head * 4;
    buf[o] = x; buf[o + 1] = y; buf[o + 2] = z; buf[o + 3] = this.age[i];
    this.trailHead[i] = (head + 1) % P;
    if (n < P) this.trailLen[i] = n + 1;
  }

  /** Keep a dying particle's trail until its points expire. */
  _orphan(i) {
    const P = TRAIL_POINTS, n = this.trailLen[i], head = this.trailHead[i], base = i * P * 4;
    const pts = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      const o = base + ((head + P - n + k) % P) * 4;
      pts[k * 4] = this.trailBuf[o]; pts[k * 4 + 1] = this.trailBuf[o + 1]; pts[k * 4 + 2] = this.trailBuf[o + 2]; pts[k * 4 + 3] = this.trailBuf[o + 3] - this.age[i];
    }
    const tr = this.def.trail;
    const life = tr.life.at(1, hashRand(this.seed[i], RF.TRAIL_LIFE)) * this.life[i];
    this.orphans.push({ pts, n, t: 0, life: Math.max(0.01, life), seed: this.seed[i], sx: this.sx[i] * this.sizeScale(0), i: -1,
      r: this.cr[i], g: this.cg[i], b: this.cb[i], a: this.ca[i], ageAtDeath: this.age[i], plife: this.life[i] });
  }

  /** Trigger sub-emitters of `type` from particle i. */
  _subEmit(i, type) {
    const p = this.worldPos(i, [0, 0, 0]);
    for (const c of this.children) {
      if (c.type !== type || !c.sys) continue;
      if (c.prob < 1 && this.rng.next() >= c.prob) continue;
      c.sys.trigger(p[0], p[1], p[2], c.props ? this._inheritOf(i, c.props) : null);
    }
  }

  /** Birth sub-emitters: particle i emits the child's rate over time over its life (and the child's bursts at birth). */
  _subBirth(i, h) {
    for (const c of this.children) {
      if (c.type !== 0 || !c.sys || !c.sys.def.emission) continue;
      const E = c.sys.def.emission;
      const t = this.age[i] / this.life[i];
      if (this.age[i] - h <= 1e-6 && E.bursts.length) {
        if (!(c.prob < 1 && this.rng.next() >= c.prob)) {
          const p = this.worldPos(i, [0, 0, 0]);
          c.sys.trigger(p[0], p[1], p[2], c.props ? this._inheritOf(i, c.props) : null);
        }
      }
      const rate = E.rate.at(t, 0.5) * c.sys.emissionScale;
      if (rate > 0) {
        this.subAcc[i] += rate * h;
        const n = Math.floor(this.subAcc[i]);
        if (n > 0) {
          this.subAcc[i] -= n;
          const p = this.worldPos(i, [0, 0, 0]);
          if (!c.sys.playing) { c.sys.playing = true; c.sys.emitting = false; c.sys.started = true; }
          c.sys._emitAt(n, p[0], p[1], p[2], c.props ? this._inheritOf(i, c.props) : null);
        }
      }
    }
  }
}
