// render/vfx/system.js — the official battle effects layer (设置「官方特效」; client docs: the fx layer, DESIGN §33):
// owns the effect instances, their library (render/vfx/library.js) and the WebGL2 renderer (render/vfx/gl.js), and
// draws them as two Pixi display objects of the field view — a ground pass under the units (flat ranges / decals) and
// an over pass above them — with the shared battle camera (render/projection.js; the prefabs are authored for it).
//
//   const ofx = new OfficialFx({ P, renderer, assets, cam, heightAt })
//   ofx.ground / ofx.over                       Pixi containers to add to the layers (they draw through raw GL)
//   ofx.setTier('off' | 'lite' | 'full')        精简 = half-size textures, emission × 0.5, FxLODSetting, exotic
//                                                shaders fall back (render/vfx/materials.js)
//   await ofx.init() → ofx.available             the extracted effects exist (data/local-fx.json lists prefabs)
//   ofx.spawn(key, place, opts) → handle         handle.effect (once loaded), handle.stop(o), handle.kill(), handle.place(o)
//   ofx.update(dt)                               battle seconds (paused battle: 0)
//   ofx.clear(); ofx.stats(); ofx.destroy()
//
// Pooling and caps: compiled prefabs are shared (library); instances are cheap records over them. The live effects are
// capped per tier (MAX_EFFECTS) and so is the sum of live particles (MAX_PARTICLES): past it, new one-shot effects are
// skipped (loops and projectiles still start). A prefab not loaded yet starts when it arrives if that is within
// LATE_START s (else a one-shot is dropped); the battle's units preload their effects at the prep → battle switch.
// Effects never touch the sim: they only read the views (render/vfx/wiring.js).

import { FxLibrary } from './library.js';
import { FxGL } from './gl.js';
import { Effect } from './effect.js';
import { FrameData, cameraBasis } from './geom.js';
import { mat4, mat4Mul } from './math.js';

export const TIERS = Object.freeze(['off', 'lite', 'full']);
export const MAX_EFFECTS = Object.freeze({ lite: 90, full: 220 });
export const MAX_PARTICLES = Object.freeze({ lite: 2500, full: 6000 });
/** Battle seconds a pending one-shot may start late (its prefab still loading) before it is dropped. */
export const LATE_START = 0.6;
/** Finished instances kept per prefab for reuse (at most; `_preloadCnt` sets the share of each). */
export const POOL_MAX = 12;
/** Battle seconds a one-shot without an authored duration (it loops) may play before it is stopped. */
export const ONE_SHOT_TTL = 4;
/** Battle seconds a looping effect nobody owns lasts at most (the wiring stops a cast loop at its end event). */
export const LOOP_TTL = 8;
/** Real milliseconds per frame spent compiling programs / uploading textures ahead of their first draw. */
export const WARM_MS = 2;

/** Unity battle frame → board frame (x + 10, y + 9, −z) as a column-major matrix. */
const U2B = (() => { const m = mat4(); m[10] = -1; m[12] = 10; m[13] = 9; return m; })();

/**
 * View-projection of a projection.js Camera for a W × H CSS px viewport (board frame → clip space), exactly
 * Camera.project's pinhole with an OpenGL depth range [near, far] along the view axis.
 */
export function boardViewProj(cam, W, H, near = 0.5, far = 80, out = mat4()) {
  const t = cam.tilt * Math.PI / 180, s = Math.sin(t), c = Math.cos(t);
  const k = cam.scale * cam.dist;
  const P = cam.position();
  const ax = 2 * cam.cx / W - 1, ay = 1 - 2 * cam.cy / H;
  const A = (far + near) / (far - near), B = -2 * far * near / (far - near);
  // rows: x = (2k/W)·r + ax·f, y = (2k/H)·u + ay·f, z = A·f (+B), w = f; with r = (1,0,0), u = (0,c,s), f = (0,s,−c)
  const rx = [2 * k / W, ax * s, -ax * c];
  const ry = [0, (2 * k / H) * c + ay * s, (2 * k / H) * s - ay * c];
  const rz = [0, A * s, -A * c];
  const rw = [0, s, -c];
  const dot = (r) => r[0] * P.x + r[1] * P.y + r[2] * P.z;
  out[0] = rx[0]; out[4] = rx[1]; out[8] = rx[2]; out[12] = -dot(rx);
  out[1] = ry[0]; out[5] = ry[1]; out[9] = ry[2]; out[13] = -dot(ry);
  out[2] = rz[0]; out[6] = rz[1]; out[10] = rz[2]; out[14] = -dot(rz) + B;
  out[3] = rw[0]; out[7] = rw[1]; out[11] = rw[2]; out[15] = -dot(rw);
  return out;
}

/** The same for points in the Unity battle frame. */
export function unityViewProj(cam, W, H, near, far, out = mat4()) {
  return mat4Mul(boardViewProj(cam, W, H, near, far, _vpb), U2B, out);
}
const _vpb = mat4();

/** Board heightfield triangles (tile tops + the walls of raised tiles) for the depth pre-pass. */
export function heightfield(heightAt, rows = 19, cols = 21, bias = 0.02) {
  const out = [];
  const h = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? 0 : Math.max(0, Number(heightAt(r, c)) || 0));
  const quad = (a, b, c, d) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const z = h(r, c) - bias;
    quad([c - 0.5, r - 0.5, z], [c + 0.5, r - 0.5, z], [c + 0.5, r + 0.5, z], [c - 0.5, r + 0.5, z]);
    // walls towards lower neighbours (front and sides: the camera looks from −y)
    for (const [dr, dc] of [[-1, 0], [0, -1], [0, 1], [1, 0]]) {
      const zn = h(r + dr, c + dc) - bias;
      if (zn >= z - 1e-3) continue;
      if (dr === -1) quad([c - 0.5, r - 0.5, zn], [c + 0.5, r - 0.5, zn], [c + 0.5, r - 0.5, z], [c - 0.5, r - 0.5, z]);
      else if (dr === 1) quad([c - 0.5, r + 0.5, zn], [c + 0.5, r + 0.5, zn], [c + 0.5, r + 0.5, z], [c - 0.5, r + 0.5, z]);
      else if (dc === -1) quad([c - 0.5, r - 0.5, zn], [c - 0.5, r + 0.5, zn], [c - 0.5, r + 0.5, z], [c - 0.5, r - 0.5, z]);
      else quad([c + 0.5, r - 0.5, zn], [c + 0.5, r + 0.5, zn], [c + 0.5, r + 0.5, z], [c + 0.5, r - 0.5, z]);
    }
  }
  return new Float32Array(out);
}

/**
 * Pixi's GL state is stale after raw GL calls: its program, VAO, texture and render-state caches are reset so its
 * systems rebind on their next use. Not `renderer.reset()`: that also rebinds the render target, which syncs Pixi's
 * global uniforms while our program is still bound (WebGL INVALID_OPERATION).
 */
export function resetPixi(renderer) {
  try { renderer.shader.reset(); } catch { /* ignore */ }
  try { renderer.batch.reset(); } catch { /* ignore */ }
  try { renderer.geometry.reset(); } catch { /* ignore */ }
  try { renderer.texture.reset(); } catch { /* ignore */ }
  try { renderer.state.reset(); } catch { /* ignore */ }
}

/** Draw order of two items: sorting layer, sorting order, render queue, then back to front (Unity's transparent sort). */
function byUnityOrder(a, b) {
  return (a.layer - b.layer) || (a.order - b.order) || (a.queue - b.queue) || (b.dist - a.dist) || (a.seq - b.seq);
}

export class OfficialFx {
  /**
   * @param {{ P: any, renderer: any, assets?: any, cam: () => any, heightAt?: (r: number, c: number) => number,
   *           fieldRect?: () => any, lib?: FxLibrary, tier?: string }} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.P = ctx.P;
    this.renderer = ctx.renderer;
    this.lib = ctx.lib || new FxLibrary({ assets: ctx.assets });
    this.glr = null;
    this.unsupported = false;
    this.tier = TIERS.includes(ctx.tier) ? ctx.tier : 'off';
    this.effects = [];
    this.pending = [];
    this.time = 0;
    this.frameNo = 0;
    this.prepared = -1;
    this.depthDone = -1;
    this.fd = new FrameData();
    this.items = { ground: [], over: [] };
    this.needDepth = false;
    this.particles = 0;
    this.dropped = 0;
    this.hfSig = null;
    this.paused = false;
    this.vpB = mat4(); this.vpU = mat4();
    this.camU = [0, 0, 0];
    this.seed = 1;
    this.warmQueue = [];       // { kind, mat } programs / { tex } textures to put on the GPU ahead of their first draw
    this.pool = new Map();     // compiled prefab → finished instances to reuse (this tier's)
    this.pooled = 0;
    const mk = (pass) => {
      const c = new this.P.Container();
      c._render = (renderer) => this.renderPass(pass, renderer);
      return c;
    };
    this.ground = mk('ground');
    this.over = mk('over');
  }

  /** Load the file list; resolves to `available`. */
  init() { return this.lib.init(); }

  get available() { return this.lib.available; }

  /** Effects are drawn: a tier is on, the files exist and the context is WebGL2. */
  get active() { return this.tier !== 'off' && !this.unsupported && this.lib.available; }

  get lite() { return this.tier === 'lite'; }

  setTier(t) {
    const tier = TIERS.includes(t) ? t : 'off';
    if (tier === this.tier) return;
    const wasLite = this.tier === 'lite';
    this.tier = tier;
    if (tier === 'off') this.clear();
    else if (wasLite !== (tier === 'lite')) this.clear(); // the instances were built for the other tier
    if (wasLite !== (tier === 'lite')) this.pool.clear();
  }

  /**
   * Start an effect. place: { pos (Unity), yaw, pitch, mirror, groundZ }; opts: { loop?: boolean (keep pending until
   * it loads), important?: boolean, seed?: number, track?: fn, onFinish?: fn, data?: any, skip?: s to start it in,
   * owner?: the unit it plays on (PauseAnotherEffect pauses by it) }.
   * Returns a handle (its `effect` is null until the prefab is loaded) or null when off / absent / over the caps.
   */
  spawn(key, place, opts = {}) {
    if (!this.active || !key) return null;
    const k = String(key).toLowerCase();
    if (!this.lib.has(k)) return null;
    const lim = MAX_EFFECTS[this.tier] || 200;
    const important = !!opts.loop || !!opts.important;
    // [ASSUMED] Author loops never bypass tier budgets; pending plugin loads also count toward 128 instances.
    if (k.startsWith('plugin:') && (this.effects.length + this.pending.length >= Math.min(128, lim) || this.particles >= (MAX_PARTICLES[this.tier] || 5000))) { this.dropped++; return null; }
    if (!important && (this.effects.length >= lim || this.particles >= (MAX_PARTICLES[this.tier] || 5000))) { this.dropped++; return null; }
    const handle = new FxHandle(this, k, place, opts);
    const def = this.lib.def(k);
    if (def) handle._start(def);
    else if (def === null && this.lib.defs.has(k)) return null; // known absent
    else {
      handle.t0 = this.time;
      this.pending.push(handle);
      this.lib.load(k).then((d) => {
        const i = this.pending.indexOf(handle);
        if (i < 0) return;
        this.pending.splice(i, 1);
        if (!d || handle.cancelled || !this.active) return;
        if (!important && this.time - handle.t0 > LATE_START) return;
        handle._start(d);
      }, () => {});
    }
    return handle;
  }

  _add(fx) {
    const lim = MAX_EFFECTS[this.tier] || 200;
    if (this.effects.length >= lim * 1.25) {
      // over the hard limit: the oldest one-shot goes
      const i = this.effects.findIndex((e) => !e.def.loops);
      if (i >= 0) this.effects.splice(i, 1)[0].kill();
    }
    this.effects.push(fx);
  }

  /** Advance every effect by dt battle seconds. */
  update(dt) {
    const d = dt > 0 ? Math.min(dt, 0.25) : 0;
    this.time += d;
    this.frameNo++;
    let w = 0, parts = 0;
    for (const fx of this.effects) {
      if (d > 0) fx.update(d);
      if (fx.done) { if (fx.handle) { fx.handle.effect = null; fx.handle.done = true; } this._recycle(fx); continue; }
      for (const s of fx.sys) if (s) parts += s.count;
      this.effects[w++] = fx;
    }
    this.effects.length = w;
    this.particles = parts;
    this._pauseOthers();
  }

  /**
   * PauseAnotherEffect (effect.js `def.pauses`, DESIGN §33.11): an effect playing on a unit (`owner`, FxWiring.playOn)
   * pauses that unit's effects of the keys it names once its `_preDelay` has passed, until it stops — the client's way to
   * show one variant of a stack (泥岩's and 鼠王's shield layers: the top layer's effect pauses the lower ones) or to put
   * a skill's range in place of a talent's aura (塑心 S3, 调香师 S2). A paused effect keeps running but is not drawn
   * [ASSUMED: the client's pause hides it; `_checkUpdate` 0 — check at the start only — is treated as 1].
   */
  _pauseOthers() {
    let pausers = null;
    for (const fx of this.effects) {
      fx.pausedBy = false;
      if (fx.def.pauses?.length && fx.owner != null && fx.state === 'play') (pausers || (pausers = [])).push(fx);
    }
    if (!pausers) return;
    for (const p of pausers) {
      for (const q of p.def.pauses) {
        if (p.time < q.delay) continue;
        for (const fx of this.effects) if (fx !== p && fx.owner === p.owner && fx.def.key === q.key) fx.pausedBy = true;
      }
    }
  }

  /**
   * Programs and textures of these prefabs go to the GPU ahead of their first draw, a few per frame (WARM_MS of each
   * frame's pass): a battle's effects compile at its start instead of hitching when each first plays.
   */
  warm(keys) {
    const seenP = new Set(this.warmQueue.map((w) => w.id));
    for (const key of keys) {
      const def = this.lib.def(key);
      if (!def) continue;
      const add = (kind, mi) => {
        if (mi == null) return;
        const mat = def.material(mi, this.lite);
        if (!mat) return;
        const id = `${kind}|${mat.key}`;
        if (!seenP.has(id)) { seenP.add(id); this.warmQueue.push({ id, kind, mat }); }
        for (const t of mat.textures) if (t.key && !seenP.has('t|' + t.key)) { seenP.add('t|' + t.key); this.warmQueue.push({ id: 't|' + t.key, tex: t.key, tries: 0 }); }
      };
      for (let i = 0; i < def.n; i++) {
        const r = def.psr[i];
        if (r && r.enabled && r.mode !== 'none') { add(r.mode === 'mesh' ? 'mesh' : 'quad', r.mats[0]); if (def.ps[i]?.trail) add('strip', r.mats[1]); }
        for (const x of [def.mesh[i]]) if (x) for (const mi of x.mats) add('mesh', mi);
        for (const x of [def.skinned[i], def.trail[i], def.line[i]]) if (x) for (const mi of x.mats) add('strip', mi);
      }
    }
  }

  _warmStep() {
    if (!this.warmQueue.length || !this.glr) return;
    const t0 = performance.now();
    while (this.warmQueue.length && performance.now() - t0 < WARM_MS) {
      const w = this.warmQueue.shift();
      if (w.kind) this.glr.program(w.kind, w.mat);
      else if (!this.glr.texture(w.tex, this.lite) && ++w.tries < 120) this.warmQueue.push(w); // its image still loads
    }
  }

  /** Keep a finished instance for the next play of its prefab (up to its `_preloadCnt`, POOL_MAX). */
  _recycle(fx) {
    if (fx.lite !== this.lite) return;
    let list = this.pool.get(fx.def);
    if (!list) { list = []; this.pool.set(fx.def, list); }
    const cap = Math.min(POOL_MAX, Math.max(2, Number((fx.def.pe || fx.def.proj || {})._preloadCnt) || 2));
    if (list.length < cap) { fx.handle = null; fx.track = null; fx.onFinish = null; list.push(fx); }
  }

  /** A pooled instance of a prefab, reset for another play (null when none is free). */
  _take(def, seed) {
    const list = this.pool.get(def);
    const fx = list && list.pop();
    if (!fx) return null;
    this.pooled++;
    return fx.reset(seed);
  }

  /** Remove every effect (battle reset). */
  clear() {
    for (const fx of this.effects) fx.kill();
    this.effects.length = 0;
    for (const h of this.pending) h.cancelled = true;
    this.pending.length = 0;
  }

  /** The board's heights for the ZTest materials' depth pre-pass (rebuilt when they change). */
  setGround(heightAt, sig) {
    if (sig !== undefined && sig === this.hfSig) return;
    this.hfSig = sig;
    this._hf = heightfield(heightAt);
    if (this.glr) this.glr.setHeightfield(this._hf);
  }

  /** Build and upload this frame's geometry, sorted per pass (once per frame, by the first pass drawn). */
  _prepare(renderer) {
    this.prepared = this.frameNo;
    const cam = this.ctx.cam();
    const W = renderer.screen.width, H = renderer.screen.height;
    boardViewProj(cam, W, H, 0.5, cam.dist + 60, this.vpB);
    mat4Mul(this.vpB, U2B, this.vpU);
    const P = cam.position();
    this.camU[0] = P.x - 10; this.camU[1] = P.y - 9; this.camU[2] = -P.z;
    const basis = cameraBasis(cam.tilt, this.camU, H, 2 * Math.atan(H / 2 / Math.max(1e-6, cam.scale * cam.dist)));
    const fd = this.fd;
    fd.reset();
    const g = this.items.ground, o = this.items.over;
    g.length = 0; o.length = 0;
    let seq = 0, depth = false;
    const sink = (e) => {
      e.seq = seq++;
      if (e.mat.state.zTest) depth = true;
      (e.ground ? g : o).push(e);
    };
    for (const fx of this.effects) fx.gather(basis, sink);
    g.sort(byUnityOrder);
    o.sort(byUnityOrder);
    // geometry in draw order: neighbours of one material and kind become one draw (their ranges are contiguous)
    const frameNo = this.frameNo;
    for (const list of [g, o]) {
      let w = 0, prev = null;
      for (const e of list) {
        const r = e.effect.build(e, basis, fd, frameNo);
        if (!r || !r.count) continue;
        e.kind = r.kind; e.first = r.first; e.count = r.count;
        if (prev && prev.mat === e.mat && prev.kind === e.kind && !prev.ov && !e.ov && prev.meshKey === e.meshKey && prev.submesh === e.submesh
          && prev.first + prev.count === e.first) { prev.count += e.count; continue; }
        list[w++] = e;
        prev = e;
      }
      list.length = w;
    }
    this.needDepth = depth;
    this.glr.upload(fd);
  }

  /** Draw one pass from inside Pixi's render (see the header). */
  renderPass(pass, renderer) {
    if (!this.active || (!this.effects.length && !this.warmQueue.length)) return;
    const gl = renderer.gl;
    if (!this.glr) {
      if (!gl || renderer.context?.webGLVersion !== 2) { this.unsupported = true; return; }
      try {
        this.glr = new FxGL(gl, this.lib);
        if (this._hf) this.glr.setHeightfield(this._hf);
      } catch (err) { console.warn('[fx] renderer unavailable', err); this.unsupported = true; return; }
    }
    renderer.batch.flush();
    try {
      if (pass === 'ground' || this.prepared !== this.frameNo) this._warmStep();
      if (this.prepared !== this.frameNo) this._prepare(renderer);
      const items = this.items[pass];
      if (this.needDepth && this.depthDone !== this.frameNo) { this.glr.depthPrepass(this.vpB); this.depthDone = this.frameNo; }
      if (items.length) this.glr.draw(items, { vp: this.vpU, cam: this.camU, time: this.time, half: this.lite, pass: this.frameNo * 2 + (pass === 'over' ? 1 : 0) });
    } catch (err) {
      if (!this._warned) { this._warned = true; console.error('[fx] render failed', err); }
    } finally {
      resetPixi(renderer);
    }
  }

  stats() {
    let systems = 0;
    for (const fx of this.effects) for (const s of fx.sys) if (s && s.count) systems++;
    return {
      tier: this.tier, available: this.available, effects: this.effects.length, pending: this.pending.length, particles: this.particles, reused: this.pooled,
      systems, dropped: this.dropped, draws: this.glr ? this.glr.stats.draws : 0, programs: this.glr ? this.glr.stats.programs : 0,
      textures: this.glr ? this.glr.stats.textures : 0, texMB: this.glr ? Math.round(this.glr.stats.texBytes / 1048576) : 0,
    };
  }

  /** Per-frame counters reset (draw counts are per frame). */
  frameStats() { if (this.glr) { this.glr.stats.draws = 0; this.glr.stats.tris = 0; } }

  /** The GL context was lost / restored: drop GPU objects (rebuilt lazily). */
  contextLost() {
    this.glr = null;
    this.lib.dropImages();
  }

  destroy() {
    this.clear();
    try { this.glr?.destroy(); } catch { /* the context may be gone */ }
    this.glr = null;
    this.ground.destroy();
    this.over.destroy();
  }
}

/** A started (or pending) effect, as the wiring keeps it. */
export class FxHandle {
  constructor(sys, key, place, opts) {
    this.sys = sys;
    this.key = key;
    this.placeArgs = place || {};
    this.opts = opts;
    this.effect = null;
    this.cancelled = false;
    this.done = false;
    this.t0 = 0;
  }

  _start(def) {
    const s = this.sys;
    const seed = this.opts.seed ?? ((s.seed = (s.seed * 1103515245 + 12345) >>> 0) || 1);
    const fx = s._take(def, seed) || new Effect(def, { lite: s.lite, lib: s.lib, seed });
    fx.place(this.placeArgs);
    fx.track = this.opts.track || null;
    fx.owner = this.opts.owner ?? null;
    fx.handle = this;
    // a one-shot nobody stops is capped: its authored duration (plus its linger), else ONE_SHOT_TTL; a looping prefab
    // nobody owns (the wiring stops it at its end event) ends after LOOP_TTL at the latest
    if (!this.opts.loop && !this.opts.important) {
      const d = Number(def.stats?.duration);
      fx.ttl = def.isLoop ? LOOP_TTL : Number.isFinite(d) && d > 0 ? Math.min(ONE_SHOT_TTL * 2, d + def.delayToPlay + 0.5) : ONE_SHOT_TTL;
    }
    fx.data = this.opts.data ?? null;
    if (this.opts.onFinish) fx.onFinish = this.opts.onFinish;
    // a chained effect of the prefab itself (OnPlayEmitter) starts with the same placement and owner; a looping one
    // stops with it (OnFinishEmitter's start where it finished)
    this.children = [];
    const own = { track: this.opts.track, data: this.opts.data, loop: this.opts.loop, important: this.opts.important, owner: this.opts.owner };
    for (const e of def.onPlay) for (const k of e.keys) if (k !== def.key) { const c = s.spawn(k, this.placeArgs, own); if (c) this.children.push(c); }
    const prev = fx.onFinish;
    fx.onFinish = (f) => {
      prev?.(f);
      this._stopChildren();
      for (const k of def.onFinish) if (k !== def.key) s.spawn(k, { pos: f.anchor.slice(), yaw: f.yaw, mirror: f.mirror, groundZ: f.groundZ }, { track: this.opts.track, owner: this.opts.owner });
    };
    this.effect = fx;
    // started late (a cast whose wind-up began past the clip's start): advanced to where it would be
    if (this.opts.skip > 0) fx.update(Math.min(1, this.opts.skip));
    if (this.stopped) fx.stop(this.stopped);
    s._add(fx);
    return fx;
  }

  place(o) { Object.assign(this.placeArgs, o); this.effect?.place(o); return this; }

  stop(o = {}) { this.stopped = o; this.cancelled = !this.effect; this.effect?.stop(o); this._stopChildren(); }

  kill() { this.cancelled = true; this.effect?.kill(); for (const c of this.children || []) c.kill(); }

  /** The looping chained effects end with this one (a one-shot child plays out). */
  _stopChildren() {
    for (const c of this.children || []) if (this.sys.lib.def(c.key)?.isLoop) c.stop();
  }

  get alive() { return !this.cancelled && !this.done && (!this.effect || !this.effect.done); }
}
