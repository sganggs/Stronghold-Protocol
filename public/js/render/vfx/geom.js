// render/vfx/geom.js — per-frame geometry of the official battle effects (DESIGN §33.6): particles as instanced quads
// or instanced meshes, particle trails / ribbons, TrailRenderers, LineRenderers, MeshRenderers and skinned meshes as
// CPU-built triangles. Everything is written in Unity battle-frame world space into the frame's shared buffers
// (`FrameData`); render/vfx/gl.js uploads them once per pass and draws ranges of them.
//
// Billboards (DESIGN §33.6 renderAlignment): view = the camera plane; facing = towards the camera position; world =
// the world XY plane (the board); local = the system's own XY plane; velocity = across the velocity; horizontal
// billboards lie in the world XZ plane and vertical ones turn about world Y — Unity's literal geometry in this frame,
// whose ground is XY. The roll of a billboard turns it clockwise on screen for positive angles (ROLL_SIGN, §33.5:
// assumed, Unity's behaviour, which no data of the client confirms). Stretched billboards run along the velocity from the particle (the head) back by
// the particle's Y size × lengthScale + speed × velocityScale, its X size across, the texture's u along the stretch (u
// = 1 at the head) [ASSUMED: the streak textures are horizontal]. The particle's Y is the stretched axis in the client's
// data (0.3.1, 风笛's lance thrust drawn as a vertical needle): of the used set's stretched renderers with a pivot, 2,434
// set it in Y and 9 in X (plain billboards: 405 / 379), and of the 2,449 stretched systems with unequal X / Y sizes 2,130
// make Y the long one. Mesh particles: the mesh × the 3D size, turned by the particle's Euler rotation
// inside the alignment frame. A particle's size is × the scaling mode's scale per axis — x across, y up the particle, z
// through a mesh — whether or not its system sets size3D (0.3.1, history §34.6: the remake drew a uniform size at the x
// scale; 1,318 systems of 462 prefabs sit on unevenly scaled nodes: 荒芜拉普兰德 S3's seal tips (1, 0.7) are flat spikes,
// 娜仁图亚 S3's hit glow (2.4, 0.29) a streak along the cut, not a round glow). A renderer's pivot (m_Pivot, in particle sizes) moves a billboard or mesh particle off its
// position by pivot × size along the particle's own axes — it turns with the particle's roll about the position (0.3.1,
// history §34.6: the remake moved it the other way; the client's data settle it — 荒芜拉普兰德 S3's seal tips, quads with a
// pivot of −0.5 / −0.81 placed left of the centre and their mirrored twins right of it, point outward only so, and of
// the used set's view billboards with a Y pivot 210 lift the quad (+) against 22, 34 against 1 of those spawned on the
// ground: 艾雅法拉 S2's range flames rise from the ground). A stretched billboard adds the same pivot after the head
// shift: pivot.y × the particle's Y size along the velocity and pivot.x × its X size across — the Y size, not the
// stretched length (lengthScale / velocityScale). Texture sheets: frame 0 is the top-left tile; frame index =
// floor(frac(startFrame + frameOverTime(frac(t · cycles))) · frames) (§33.5, resolved: the authored curves end at
// 0.9999 so that the last frame does not wrap to the first).

import { hashRand, RF } from './rng.js';
import { quatEuler, mat4Point, mat4Dir } from './math.js';

/** Sign of a billboard's roll: −1 = positive angles turn clockwise on screen (Unity, §33.5, assumed). */
export const ROLL_SIGN = -1;

export const QUAD_STRIDE = 27;   // center 3, ax 3, ay 3, color 4, uvr 4, t0 2, t1 4, t2 4
export const MESH_STRIDE = 30;   // center 3, m0 3, m1 3, m2 3, color 4, uvr 4, t0 2, t1 4, t2 4
export const STRIP_STRIDE = 12;  // pos 3, uv 2, color 4, normal 3

/** Growable per-frame buffers. */
export class FrameData {
  constructor() {
    this.quad = new Float32Array(QUAD_STRIDE * 1024); this.nq = 0;
    this.mesh = new Float32Array(MESH_STRIDE * 256); this.nm = 0;
    this.strip = new Float32Array(STRIP_STRIDE * 4096); this.ns = 0;
    this.index = new Uint32Array(8192); this.ni = 0;
  }

  reset() { this.nq = 0; this.nm = 0; this.ns = 0; this.ni = 0; }

  quads(n) {
    const need = (this.nq + n) * QUAD_STRIDE;
    if (need > this.quad.length) { const a = new Float32Array(Math.max(need, this.quad.length * 2)); a.set(this.quad.subarray(0, this.nq * QUAD_STRIDE)); this.quad = a; }
    const o = this.nq; this.nq += n; return o;
  }

  meshes(n) {
    const need = (this.nm + n) * MESH_STRIDE;
    if (need > this.mesh.length) { const a = new Float32Array(Math.max(need, this.mesh.length * 2)); a.set(this.mesh.subarray(0, this.nm * MESH_STRIDE)); this.mesh = a; }
    const o = this.nm; this.nm += n; return o;
  }

  verts(n) {
    const need = (this.ns + n) * STRIP_STRIDE;
    if (need > this.strip.length) { const a = new Float32Array(Math.max(need, this.strip.length * 2)); a.set(this.strip.subarray(0, this.ns * STRIP_STRIDE)); this.strip = a; }
    const o = this.ns; this.ns += n; return o;
  }

  indices(n) {
    const need = this.ni + n;
    if (need > this.index.length) { const a = new Uint32Array(Math.max(need, this.index.length * 2)); a.set(this.index.subarray(0, this.ni)); this.index = a; }
    const o = this.ni; this.ni += n; return o;
  }
}

/**
 * The camera of a frame in Unity battle space: right, up, forward (unit) and position; px: world units per CSS px at a
 * depth of 1 (for the on-screen particle size clamp).
 */
export function cameraBasis(tiltDeg, posUnity, viewportH, fovYRad) {
  const t = tiltDeg * Math.PI / 180, s = Math.sin(t), c = Math.cos(t);
  return { right: [1, 0, 0], up: [0, c, -s], fwd: [0, s, c], pos: posUnity, h: viewportH, tanHalf: Math.tan(fovYRad / 2) };
}

const _c4 = [1, 1, 1, 1], _d4 = [1, 1, 1, 1], _e4 = [1, 1, 1, 1];
/** Unity keeps particle and line colours as Color32: 0…1 per channel (HDR start colours are clamped). */
const c01 = (v) => (v > 1 ? 1 : v < 0 ? 0 : v);
const _p = [0, 0, 0], _q = [0, 0, 0, 1], _v = [0, 0, 0], _w = [0, 0, 0];
const _ax = [0, 0, 0], _ay = [0, 0, 0], _az = [0, 0, 0];
const _s = new Float32Array(16);
const _idx = [];

const STREAM_SIZE = {
  UV: 2, UV2: 2, UV3: 2, UV4: 2, AnimBlend: 1, AnimFrame: 1, Center: 3, VertexID: 1, SizeX: 1, SizeXY: 2, SizeXYZ: 3,
  Rotation: 1, Rotation3D: 3, RotationSpeed: 1, RotationSpeed3D: 3, Velocity: 3, Speed: 1, AgePercent: 1,
  InvStartLifetime: 1, StableRandomX: 1, StableRandomXY: 2, StableRandomXYZ: 3, StableRandomXYZW: 4, VaryingRandomX: 1,
  VaryingRandomXY: 2, VaryingRandomXYZ: 3, VaryingRandomXYZW: 4, Custom1X: 1, Custom1XY: 2, Custom1XYZ: 3, Custom1XYZW: 4,
  Custom2X: 1, Custom2XY: 2, Custom2XYZ: 3, Custom2XYZW: 4, NoiseSumX: 1, NoiseSumXY: 2, NoiseSumXYZ: 3, NoiseImpulseX: 1,
  NoiseImpulseXY: 2, NoiseImpulseXYZ: 3, MeshIndex: 1, ParticleIndex: 1, ColorPackedAsTwoFloats: 2,
};
const DEDICATED = new Set(['Position', 'Normal', 'Tangent', 'Color']);

/** The custom stream layout of a renderer: [{ name, n }] after the first UV (null without custom streams). */
export function streamLayout(psr) {
  if (!psr || !psr.m_UseCustomVertexStreams || !Array.isArray(psr.vertexStreams)) return null;
  const rest = psr.vertexStreams.filter((s) => !DEDICATED.has(s));
  // the first texcoord stream feeds TEXCOORD0.xy (our quad UV); the rest follow it
  const i = rest.indexOf('UV');
  const list = (i === 0 ? rest.slice(1) : rest).map((name) => ({ name, n: STREAM_SIZE[name] || 1 }));
  return list.length ? list : null;
}

/** Fill the packed custom streams (up to 10 floats) of particle i of system ps into out[o..o+9]. */
function packStreams(ps, i, t, layout, out, o, frame) {
  let k = 0;
  const put = (v) => { if (k < 10) out[o + k] = v; k++; };
  const def = ps.def, s = ps.seed[i];
  for (const st of layout) {
    const nm = st.name;
    if (nm.startsWith('Custom')) {
      const c = def.custom ? def.custom[nm[6] === '1' ? 0 : 1] : null;
      const n = st.n;
      if (c && c.mode === 1) for (let j = 0; j < n; j++) put(c.v[j].at(t, hashRand(s, RF.CUSTOM + j)));
      else if (c && c.mode === 2) { c.c.at(t, hashRand(s, RF.CUSTOM), _e4); for (let j = 0; j < n; j++) put(_e4[j]); }
      else for (let j = 0; j < n; j++) put(0);
    } else if (nm === 'AgePercent') put(t);
    else if (nm === 'InvStartLifetime') put(1 / Math.max(1e-6, ps.life[i]));
    else if (nm.startsWith('StableRandom')) for (let j = 0; j < st.n; j++) put(hashRand(s, 60 + j));
    else if (nm.startsWith('VaryingRandom')) for (let j = 0; j < st.n; j++) put(hashRand(s ^ (frame & 0xffff), 70 + j));
    else if (nm === 'AnimFrame') put(frame);
    else if (nm === 'Speed') put(Math.hypot(ps.tvx[i], ps.tvy[i], ps.tvz[i]));
    else if (nm === 'Velocity') { put(ps.tvx[i]); put(ps.tvy[i]); put(ps.tvz[i]); }
    else if (nm === 'Center') { ps.worldPos(i, _w); put(_w[0]); put(_w[1]); put(_w[2]); }
    else if (nm === 'Rotation') put(ps.rz[i]);
    else for (let j = 0; j < st.n; j++) put(0);
  }
  for (; k < 10; k++) out[o + k] = 0;
}

/** Texture-sheet frame of particle i into out = [u0, v0, du, dv] (flips applied). */
function sheetRect(def, ps, i, t, out) {
  const U = def.uv;
  const s = ps.seed[i];
  let u0 = 0, v0 = 0, du = 1, dv = 1;
  if (U) {
    let x;
    if (U.timeMode === 2) x = (ps.age[i] * U.fps / U.frames) % 1;
    else if (U.timeMode === 1) {
      const sp = Math.hypot(ps.tvx[i], ps.tvy[i], ps.tvz[i]), r = U.speedRange;
      x = Math.min(1, Math.max(0, (sp - r[0]) / ((r[1] - r[0]) || 1)));
    } else x = ((t * U.cycles) % 1 + 1) % 1;
    const f = U.start.at(t, hashRand(s, RF.START_FRAME)) + U.over.at(x, hashRand(s, RF.FRAME));
    const frame = Math.min(U.frames - 1, Math.floor((((f % 1) + 1) % 1) * U.frames));
    let col, row;
    if (U.row) {
      col = frame;
      row = U.rowMode === 1 ? Math.floor(hashRand(s, RF.ROW) * U.ty) : Math.min(U.ty - 1, U.rowIndex);
    } else { col = frame % U.tx; row = Math.floor(frame / U.tx); }
    du = 1 / U.tx; dv = 1 / U.ty;
    u0 = col * du; v0 = 1 - (row + 1) * dv;
    if (U.flipU > 0 && hashRand(s, RF.FLIP_U) < U.flipU) { u0 += du; du = -du; }
    if (U.flipV > 0 && hashRand(s, RF.FLIP_V) < U.flipV) { v0 += dv; dv = -dv; }
  }
  out[0] = u0; out[1] = v0; out[2] = du; out[3] = dv;
  return out;
}
const _uvr = [0, 0, 1, 1];

/** Colour of particle i at normalised age t into out (start × over lifetime × by speed). */
export function particleColor(ps, i, t, out) {
  const def = ps.def;
  out[0] = ps.cr[i]; out[1] = ps.cg[i]; out[2] = ps.cb[i]; out[3] = ps.ca[i];
  if (def.color) { def.color.at(t, hashRand(ps.seed[i], RF.COLOR_OL), _d4); out[0] *= _d4[0]; out[1] *= _d4[1]; out[2] *= _d4[2]; out[3] *= _d4[3]; }
  if (def.colorBySpeed) {
    const sp = Math.hypot(ps.tvx[i], ps.tvy[i], ps.tvz[i]), r = def.colorBySpeed.range;
    def.colorBySpeed.c.at(Math.min(1, Math.max(0, (sp - r[0]) / ((r[1] - r[0]) || 1))), hashRand(ps.seed[i], RF.COLOR_SPEED), _d4);
    out[0] *= _d4[0]; out[1] *= _d4[1]; out[2] *= _d4[2]; out[3] *= _d4[3];
  }
  return out;
}

/** Size multipliers of particle i at normalised age t into out [x, y, z] (over lifetime, by speed, noise). */
function sizeMul(ps, i, t, out) {
  const def = ps.def, s = ps.seed[i];
  let x = 1, y = 1, z = 1;
  const S = def.size;
  if (S) {
    x = ps.sizeX.at(t, hashRand(s, RF.SIZE_OL));
    if (S.sep) { y = S.y.at(t, hashRand(s, RF.SIZE_OL_Y)); z = S.z.at(t, hashRand(s, RF.SIZE_OL_Z)); } else { y = x; z = x; }
  }
  const B = def.sizeBySpeed;
  if (B) {
    const sp = Math.hypot(ps.tvx[i], ps.tvy[i], ps.tvz[i]), r = B.range;
    const u = Math.min(1, Math.max(0, (sp - r[0]) / ((r[1] - r[0]) || 1)));
    const bx = B.x.at(u, hashRand(s, RF.SIZE_SPEED));
    if (B.sep) { x *= bx; y *= B.y.at(u, hashRand(s, RF.SIZE_SPEED)); z *= B.z.at(u, hashRand(s, RF.SIZE_SPEED)); } else { x *= bx; y *= bx; z *= bx; }
  }
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}
const _sm = [1, 1, 1];

/** Order of particles to draw (Unity m_SortMode) into _idx; returns the count. */
function sortOrder(ps, mode, cam) {
  const n = ps.count;
  _idx.length = n;
  for (let i = 0; i < n; i++) _idx[i] = i;
  if (mode === 1) {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) { ps.worldPos(i, _w); const dx = _w[0] - cam.pos[0], dy = _w[1] - cam.pos[1], dz = _w[2] - cam.pos[2]; d[i] = dx * dx + dy * dy + dz * dz; }
    _idx.sort((a, b) => d[b] - d[a]); // far first
  } else if (mode === 2) _idx.sort((a, b) => ps.age[a] - ps.age[b]);   // oldest in front: youngest drawn first
  else if (mode === 3) _idx.sort((a, b) => ps.age[b] - ps.age[a]);     // youngest in front: oldest drawn first
  return n;
}

/**
 * Write the particles of system `ps` (renderer `r` = the compiled renderer info of the effect) as quads or mesh
 * instances. Returns { kind: 'quad'|'mesh', first, count } or null.
 * @param {any} ps PSys
 * @param {any} r  { mode, align, sortMode, pivot, flip, lengthScale, velocityScale, cameraVelocityScale, maxSize, minSize,
 *                  streams, mesh (gpu-side key), meshData, rot (world rotation quat of the system) }
 */
export function buildParticles(ps, r, cam, fd, frameNo) {
  const n = ps.count;
  if (!n) return null;
  const def = ps.def;
  sortOrder(ps, r.sortMode, cam);
  const mesh = r.mode === 'mesh';
  if (mesh && !r.meshData) return null;
  const first = mesh ? fd.meshes(n) : fd.quads(n);
  const buf = mesh ? fd.mesh : fd.quad, stride = mesh ? MESH_STRIDE : QUAD_STRIDE;
  const m = ps.m;
  const R = cam.right, U = cam.up, F = cam.fwd;
  // the system's world axes (local alignment) and mirror sign
  const lx = [m[0], m[1], m[2]], ly = [m[4], m[5], m[6]], lz = [m[8], m[9], m[10]];
  const nl = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };
  nl(lx); nl(ly); nl(lz);
  const mirror = (m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])) < 0 ? -1 : 1;
  const pv = r.pivot;
  // a local-space system's sizes are drawn at its scaling mode's scale as it is now (psys.js sizeScale)
  const k0 = ps.sizeScale(0), k1 = ps.sizeScale(1), k2 = ps.sizeScale(2);
  let w = 0;
  for (let k = 0; k < n; k++) {
    const i = _idx[k];
    const t = ps.age[i] / ps.life[i];
    const o = (first + w) * stride;
    ps.worldPos(i, _p);
    particleColor(ps, i, t, _c4);
    if (r.tint) { _c4[0] *= r.tint[0]; _c4[1] *= r.tint[1]; _c4[2] *= r.tint[2]; _c4[3] *= r.tint[3]; }
    _c4[0] = c01(_c4[0]); _c4[1] = c01(_c4[1]); _c4[2] = c01(_c4[2]); _c4[3] = c01(_c4[3]);
    sizeMul(ps, i, t, _sm);
    // per axis even when the sizes are uniform (no size3D): a node scaled (0.27, 4.2, 1) draws a streak (header)
    let sx = ps.sx[i] * k0 * _sm[0], sy = ps.sy[i] * k1 * _sm[1], sz = ps.sz[i] * k2 * _sm[2];
    const s = ps.seed[i];
    const fx = r.flip && r.flip[0] > 0 && hashRand(s, RF.FLIP_X) < r.flip[0] ? -1 : 1;
    const fy = r.flip && r.flip[1] > 0 && hashRand(s, RF.FLIP_Y) < r.flip[1] ? -1 : 1;
    if (!mesh) {
      // on-screen size clamp (fractions of the viewport height at the particle's depth)
      if (r.maxSize > 0 || r.minSize > 0) {
        const dx = _p[0] - cam.pos[0], dy = _p[1] - cam.pos[1], dz = _p[2] - cam.pos[2];
        const depth = Math.max(0.05, dx * F[0] + dy * F[1] + dz * F[2]);
        const view = 2 * depth * cam.tanHalf;
        const big = Math.max(sx, sy);
        if (r.maxSize > 0 && big > r.maxSize * view) { const k2 = r.maxSize * view / big; sx *= k2; sy *= k2; }
        if (r.minSize > 0 && big < r.minSize * view && big > 0) { const k2 = r.minSize * view / big; sx *= k2; sy *= k2; }
      }
      let ax0, ax1, ax2, ay0, ay1, ay2;
      let cx = _p[0], cy = _p[1], cz = _p[2];
      if (r.mode === 'stretch') {
        // along the velocity, facing the camera; the particle is the head
        let vx = ps.tvx[i], vy = ps.tvy[i], vz = ps.tvz[i];
        if (def.space !== 1) { mat4Dir(m, vx, vy, vz, _v); vx = _v[0]; vy = _v[1]; vz = _v[2]; }
        const sp = Math.hypot(vx, vy, vz);
        // the particle's Y size along the velocity, its X size across (header)
        const len = sy * r.lengthScale + sp * r.velocityScale;
        const moving = sp > 1e-6;
        const dx = moving ? vx / sp : R[0], dy = moving ? vy / sp : R[1], dz = moving ? vz / sp : R[2];
        // across: perpendicular to the direction and to the view ray
        const tx = _p[0] - cam.pos[0], ty = _p[1] - cam.pos[1], tz = _p[2] - cam.pos[2];
        let wx = dy * tz - dz * ty, wy = dz * tx - dx * tz, wz = dx * ty - dy * tx;
        const wl = Math.hypot(wx, wy, wz) || 1;
        wx /= wl; wy /= wl; wz /= wl;
        ax0 = dx * len; ax1 = dy * len; ax2 = dz * len;
        ay0 = wx * sx; ay1 = wy * sx; ay2 = wz * sx;
        cx -= dx * len / 2; cy -= dy * len / 2; cz -= dz * len / 2;
        // pivot × size, added like a billboard: Y along the velocity, X across. size.y, not `len` (header).
        if (pv && (pv[0] || pv[1])) {
          const px = pv[0] * sx, py = pv[1] * sy;
          cx += wx * px + dx * py; cy += wy * px + dy * py; cz += wz * px + dz * py;
        }
      } else {
        // the alignment frame (X, Y)
        let X0, X1, X2, Y0, Y1, Y2;
        const align = r.mode === 'horizontal' ? 'horizontal' : r.mode === 'vertical' ? 'vertical' : r.align;
        if (align === 'world') { X0 = 1; X1 = 0; X2 = 0; Y0 = 0; Y1 = 1; Y2 = 0; }
        else if (align === 'local' || align === 'velocity') { X0 = lx[0]; X1 = lx[1]; X2 = lx[2]; Y0 = ly[0]; Y1 = ly[1]; Y2 = ly[2]; }
        else if (align === 'horizontal') { X0 = 1; X1 = 0; X2 = 0; Y0 = 0; Y1 = 0; Y2 = 1; }
        else if (align === 'facing' || align === 'vertical') {
          let nx = _p[0] - cam.pos[0], ny = _p[1] - cam.pos[1], nz = _p[2] - cam.pos[2];
          const nlen = Math.hypot(nx, ny, nz) || 1; nx /= nlen; ny /= nlen; nz /= nlen;
          const ux = align === 'vertical' ? 0 : U[0], uy = align === 'vertical' ? 1 : U[1], uz = align === 'vertical' ? 0 : U[2];
          // X = up × forward, Y = forward × X
          X0 = uy * nz - uz * ny; X1 = uz * nx - ux * nz; X2 = ux * ny - uy * nx;
          const xl = Math.hypot(X0, X1, X2) || 1; X0 /= xl; X1 /= xl; X2 /= xl;
          if (align === 'vertical') { Y0 = 0; Y1 = 1; Y2 = 0; }
          else { Y0 = ny * X2 - nz * X1; Y1 = nz * X0 - nx * X2; Y2 = nx * X1 - ny * X0; }
        } else { X0 = R[0]; X1 = R[1]; X2 = R[2]; Y0 = U[0]; Y1 = U[1]; Y2 = U[2]; }
        // roll
        const a = ROLL_SIGN * ps.rz[i] * mirror;
        const ca = Math.cos(a), sa = Math.sin(a);
        const rx0 = ca * X0 + sa * Y0, rx1 = ca * X1 + sa * Y1, rx2 = ca * X2 + sa * Y2;
        const ry0 = -sa * X0 + ca * Y0, ry1 = -sa * X1 + ca * Y1, ry2 = -sa * X2 + ca * Y2;
        const kx = sx * fx * mirror, ky = sy * fy;
        ax0 = rx0 * kx; ax1 = rx1 * kx; ax2 = rx2 * kx;
        ay0 = ry0 * ky; ay1 = ry1 * ky; ay2 = ry2 * ky;
        // the pivot moves the quad off the particle by pivot × size along its (rolled) axes (header)
        if (pv && (pv[0] || pv[1])) { cx += ax0 * pv[0] + ay0 * pv[1]; cy += ax1 * pv[0] + ay1 * pv[1]; cz += ax2 * pv[0] + ay2 * pv[1]; }
      }
      buf[o] = cx; buf[o + 1] = cy; buf[o + 2] = cz;
      buf[o + 3] = ax0; buf[o + 4] = ax1; buf[o + 5] = ax2;
      buf[o + 6] = ay0; buf[o + 7] = ay1; buf[o + 8] = ay2;
      // (stretched: the quad's x runs tail → head, so the texture's u = 1 at the head)
      const uvr = sheetRect(def, ps, i, t, _uvr);
      buf[o + 9] = _c4[0]; buf[o + 10] = _c4[1]; buf[o + 11] = _c4[2]; buf[o + 12] = _c4[3];
      buf[o + 13] = uvr[0]; buf[o + 14] = uvr[1]; buf[o + 15] = uvr[2]; buf[o + 16] = uvr[3];
      if (r.streams) packStreams(ps, i, t, r.streams, buf, o + 17, frameNo);
      else for (let j = 17; j < 27; j++) buf[o + j] = 0;
    } else {
      // mesh particles: frame · Euler(rotation) · size
      let F0, F1, F2; // frame columns
      if (r.align === 'world') { F0 = [1, 0, 0]; F1 = [0, 1, 0]; F2 = [0, 0, 1]; }
      else if (r.align === 'local') { F0 = lx; F1 = ly; F2 = lz; }
      else if (r.align === 'facing' || r.align === 'velocity') {
        let zx, zy, zz;
        if (r.align === 'velocity') {
          let vx = ps.tvx[i], vy = ps.tvy[i], vz = ps.tvz[i];
          if (def.space !== 1) { mat4Dir(m, vx, vy, vz, _v); vx = _v[0]; vy = _v[1]; vz = _v[2]; }
          const l = Math.hypot(vx, vy, vz);
          if (l > 1e-6) { zx = vx / l; zy = vy / l; zz = vz / l; } else { zx = F[0]; zy = F[1]; zz = F[2]; }
        } else {
          zx = _p[0] - cam.pos[0]; zy = _p[1] - cam.pos[1]; zz = _p[2] - cam.pos[2];
          const l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
        }
        const ux = U[0], uy = U[1], uz = U[2];
        let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
        const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
        F0 = [xx, xy, xz]; F2 = [zx, zy, zz]; F1 = [zy * xz - zz * xy, zz * xx - zx * xz, zx * xy - zy * xx];
      } else { F0 = R; F1 = U; F2 = F; }
      const DEGR = 180 / Math.PI;
      quatEuler(ps.rx[i] * DEGR, ps.ry[i] * DEGR, ps.rz[i] * DEGR, _q);
      // particle rotation columns
      const qx = _q[0], qy = _q[1], qz = _q[2], qw = _q[3];
      const r00 = 1 - 2 * (qy * qy + qz * qz), r10 = 2 * (qx * qy + qw * qz), r20 = 2 * (qx * qz - qw * qy);
      const r01 = 2 * (qx * qy - qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r21 = 2 * (qy * qz + qw * qx);
      const r02 = 2 * (qx * qz + qw * qy), r12 = 2 * (qy * qz - qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
      for (let c = 0; c < 3; c++) {
        const a0 = c === 0 ? r00 : c === 1 ? r01 : r02, a1 = c === 0 ? r10 : c === 1 ? r11 : r12, a2 = c === 0 ? r20 : c === 1 ? r21 : r22;
        const sc = (c === 0 ? sx * fx * mirror : c === 1 ? sy * fy : sz);
        const col = c === 0 ? _ax : c === 1 ? _ay : _az;
        col[0] = (F0[0] * a0 + F1[0] * a1 + F2[0] * a2) * sc;
        col[1] = (F0[1] * a0 + F1[1] * a1 + F2[1] * a2) * sc;
        col[2] = (F0[2] * a0 + F1[2] * a1 + F2[2] * a2) * sc;
      }
      let cx = _p[0], cy = _p[1], cz = _p[2];
      if (pv && (pv[0] || pv[1] || pv[2])) {
        cx += _ax[0] * pv[0] + _ay[0] * pv[1] + _az[0] * pv[2];
        cy += _ax[1] * pv[0] + _ay[1] * pv[1] + _az[1] * pv[2];
        cz += _ax[2] * pv[0] + _ay[2] * pv[1] + _az[2] * pv[2];
      }
      buf[o] = cx; buf[o + 1] = cy; buf[o + 2] = cz;
      buf[o + 3] = _ax[0]; buf[o + 4] = _ax[1]; buf[o + 5] = _ax[2];
      buf[o + 6] = _ay[0]; buf[o + 7] = _ay[1]; buf[o + 8] = _ay[2];
      buf[o + 9] = _az[0]; buf[o + 10] = _az[1]; buf[o + 11] = _az[2];
      buf[o + 12] = _c4[0]; buf[o + 13] = _c4[1]; buf[o + 14] = _c4[2]; buf[o + 15] = _c4[3];
      const uvr = sheetRect(def, ps, i, t, _uvr);
      buf[o + 16] = uvr[0]; buf[o + 17] = uvr[1]; buf[o + 18] = uvr[2]; buf[o + 19] = uvr[3];
      if (r.streams) packStreams(ps, i, t, r.streams, buf, o + 20, frameNo);
      else for (let j = 20; j < 30; j++) buf[o + j] = 0;
    }
    w++;
  }
  return { kind: mesh ? 'mesh' : 'quad', first, count: w };
}

/** One mesh instance (MeshRenderer) for world matrix m, colour tint. Returns its instance index. */
export function buildMeshInstance(m, fd, tint) {
  const first = fd.meshes(1), o = first * MESH_STRIDE, b = fd.mesh;
  b[o] = m[12]; b[o + 1] = m[13]; b[o + 2] = m[14];
  b[o + 3] = m[0]; b[o + 4] = m[1]; b[o + 5] = m[2];
  b[o + 6] = m[4]; b[o + 7] = m[5]; b[o + 8] = m[6];
  b[o + 9] = m[8]; b[o + 10] = m[9]; b[o + 11] = m[10];
  b[o + 12] = tint ? tint[0] : 1; b[o + 13] = tint ? tint[1] : 1; b[o + 14] = tint ? tint[2] : 1; b[o + 15] = tint ? tint[3] : 1;
  b[o + 16] = 0; b[o + 17] = 0; b[o + 18] = 1; b[o + 19] = 1;
  for (let j = 20; j < 30; j++) b[o + j] = 0;
  return first;
}

/**
 * A camera-facing ribbon through points (world): pts = Float32Array [x, y, z, …] (n points, head first), widths and
 * colours per point via callbacks. Writes vertices + indices; returns { first (index offset), count } or null.
 * @param {(k: number, u: number) => number} widthAt   half width at point k (u: 0 head … 1 tail)
 * @param {(k: number, u: number, out: number[]) => any} colorAt
 * @param {{ texMode: number, cam, alignZ?: number[]|null }} o
 */
export function buildRibbon(pts, n, widthAt, colorAt, fd, o) {
  if (n < 2) return null;
  // cumulative distances
  let total = 0;
  const dist = _ribDist.length >= n ? _ribDist : (_ribDist = new Float32Array(n * 2));
  dist[0] = 0;
  for (let k = 1; k < n; k++) {
    const dx = pts[k * 3] - pts[k * 3 - 3], dy = pts[k * 3 + 1] - pts[k * 3 - 2], dz = pts[k * 3 + 2] - pts[k * 3 - 1];
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
    dist[k] = total;
  }
  if (!(total > 1e-6)) return null;
  const v0 = fd.verts(n * 2);
  const b = fd.strip;
  const cam = o.cam;
  for (let k = 0; k < n; k++) {
    const u = dist[k] / total;
    // tangent
    const a = Math.max(0, k - 1), c = Math.min(n - 1, k + 1);
    let tx = pts[c * 3] - pts[a * 3], ty = pts[c * 3 + 1] - pts[a * 3 + 1], tz = pts[c * 3 + 2] - pts[a * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // across: perpendicular to the tangent and the view ray (or the transform's Z)
    let vx, vy, vz;
    if (o.alignZ) { vx = o.alignZ[0]; vy = o.alignZ[1]; vz = o.alignZ[2]; }
    else { vx = pts[k * 3] - cam.pos[0]; vy = pts[k * 3 + 1] - cam.pos[1]; vz = pts[k * 3 + 2] - cam.pos[2]; }
    let wx = ty * vz - tz * vy, wy = tz * vx - tx * vz, wz = tx * vy - ty * vx;
    const wl = Math.hypot(wx, wy, wz) || 1; wx /= wl; wy /= wl; wz /= wl;
    const hw = widthAt(k, u);
    colorAt(k, u, _c4);
    const uu = o.texMode === 1 ? dist[k] : u; // Tile: one repeat per world unit; Stretch: once along the trail
    for (let side = 0; side < 2; side++) {
      const off = (v0 + k * 2 + side) * STRIP_STRIDE, sg = side ? -1 : 1;
      b[off] = pts[k * 3] + wx * hw * sg; b[off + 1] = pts[k * 3 + 1] + wy * hw * sg; b[off + 2] = pts[k * 3 + 2] + wz * hw * sg;
      b[off + 3] = uu; b[off + 4] = side ? 0 : 1;
      b[off + 5] = c01(_c4[0]); b[off + 6] = c01(_c4[1]); b[off + 7] = c01(_c4[2]); b[off + 8] = c01(_c4[3]);
      b[off + 9] = 0; b[off + 10] = 0; b[off + 11] = -1;
    }
  }
  const i0 = fd.indices((n - 1) * 6), I = fd.index;
  for (let k = 0; k < n - 1; k++) {
    const a = v0 + k * 2, j = i0 + k * 6;
    I[j] = a; I[j + 1] = a + 1; I[j + 2] = a + 2; I[j + 3] = a + 1; I[j + 4] = a + 3; I[j + 5] = a + 2;
  }
  return { first: i0, count: (n - 1) * 6 };
}
let _ribDist = new Float32Array(256);

/**
 * Particle trails (TrailModule) of system ps: one ribbon per particle with a trail (and the orphaned trails of dead
 * ones). Returns { first, count } of the index range or null.
 */
export function buildParticleTrails(ps, cam, fd, tint) {
  const def = ps.def, tr = def.trail;
  if (!tr || (!ps.count && !ps.orphans.length)) return null;
  const i0 = fd.ni;
  const P = 24;
  const pts = _trailPts.length >= (P + 1) * 3 ? _trailPts : (_trailPts = new Float32Array((P + 1) * 3));
  const m = ps.m;
  const toWorld = (x, y, z, k) => {
    if (tr.world || def.space === 1) { pts[k * 3] = x; pts[k * 3 + 1] = y; pts[k * 3 + 2] = z; }
    else mat4Point(m, x, y, z, pts, k * 3);
  };
  if (tr.mode === 1) {
    // ribbon: one strip through the particles by age (oldest last = tail)
    const n = ps.count;
    if (n >= 2) {
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => ps.age[a] - ps.age[b]);
      const rp = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { ps.worldPos(order[k], _w); rp[k * 3] = _w[0]; rp[k * 3 + 1] = _w[1]; rp[k * 3 + 2] = _w[2]; }
      buildRibbon(rp, n, (k, u) => {
        const i = order[k]; const t = ps.age[i] / ps.life[i];
        return (tr.sizeWidth ? ps.sx[i] * ps.sizeScale(0) * (ps.sizeX ? ps.sizeX.at(t, hashRand(ps.seed[i], RF.SIZE_OL)) : 1) : 1) * tr.width.at(u, 0.5) / 2;
      }, (k, u, out) => {
        const i = order[k]; const t = ps.age[i] / ps.life[i];
        if (tr.inheritColor) particleColor(ps, i, t, out); else { out[0] = out[1] = out[2] = out[3] = 1; }
        tr.colorTrail.at(u, 0.5, _d4); out[0] *= _d4[0]; out[1] *= _d4[1]; out[2] *= _d4[2]; out[3] *= _d4[3];
        if (tint) { out[0] *= tint[0]; out[1] *= tint[1]; out[2] *= tint[2]; out[3] *= tint[3]; }
      }, fd, { texMode: tr.textureMode, cam });
    }
  } else {
    for (let i = 0; i < ps.count; i++) {
      if (tr.ratio < 1 && hashRand(ps.seed[i], RF.TRAIL) >= tr.ratio) continue;
      const len = ps.trailLen[i];
      if (!len) continue;
      const t = ps.age[i] / ps.life[i];
      const life = Math.max(1e-3, tr.life.at(t, hashRand(ps.seed[i], RF.TRAIL_LIFE)) * ps.life[i]);
      // head = the particle now, then the recorded points newest → oldest, dropping expired ones
      if (tr.world || def.space === 1) { ps.worldPos(i, _w); pts[0] = _w[0]; pts[1] = _w[1]; pts[2] = _w[2]; }
      else toWorld(ps.px[i], ps.py[i], ps.pz[i], 0);
      let n = 1;
      const head = ps.trailHead[i], base = i * P * 4;
      for (let k = 0; k < len; k++) {
        const o = base + ((head + P - 1 - k) % P) * 4;
        if (ps.age[i] - ps.trailBuf[o + 3] > life) break;
        toWorld(ps.trailBuf[o], ps.trailBuf[o + 1], ps.trailBuf[o + 2], n);
        n++;
      }
      if (n < 2) continue;
      const size = tr.sizeWidth ? ps.sx[i] * ps.sizeScale(0) * (ps.sizeX ? ps.sizeX.at(t, hashRand(ps.seed[i], RF.SIZE_OL)) : 1) : 1;
      particleColor(ps, i, t, _e4);
      const pc = tr.inheritColor ? [_e4[0], _e4[1], _e4[2], _e4[3]] : [1, 1, 1, 1];
      tr.colorLife.at(t, hashRand(ps.seed[i], RF.TRAIL_C), _d4);
      pc[0] *= _d4[0]; pc[1] *= _d4[1]; pc[2] *= _d4[2]; pc[3] *= _d4[3];
      if (tint) { pc[0] *= tint[0]; pc[1] *= tint[1]; pc[2] *= tint[2]; pc[3] *= tint[3]; }
      buildRibbon(pts, n, (k, u) => size * tr.width.at(u, hashRand(ps.seed[i], RF.TRAIL_W)) / 2, (k, u, out) => {
        tr.colorTrail.at(u, 0.5, out); out[0] *= pc[0]; out[1] *= pc[1]; out[2] *= pc[2]; out[3] *= pc[3];
      }, fd, { texMode: tr.textureMode, cam });
    }
    // orphaned trails (dieWithParticles off) fading out
    for (const ob of ps.orphans) {
      const n = ob.n;
      if (n < 2) continue;
      const tp = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) {
        const o = (n - 1 - k) * 4; // newest first
        if (tr.world || def.space === 1) { tp[k * 3] = ob.pts[o]; tp[k * 3 + 1] = ob.pts[o + 1]; tp[k * 3 + 2] = ob.pts[o + 2]; }
        else mat4Point(m, ob.pts[o], ob.pts[o + 1], ob.pts[o + 2], tp, k * 3);
      }
      const fade = Math.max(0, 1 - ob.t / ob.life);
      buildRibbon(tp, n, (k, u) => (tr.sizeWidth ? ob.sx : 1) * tr.width.at(u, 0.5) / 2 * fade, (k, u, out) => {
        tr.colorTrail.at(u, 0.5, out);
        out[0] *= ob.r; out[1] *= ob.g; out[2] *= ob.b; out[3] *= ob.a * fade;
        if (tint) { out[0] *= tint[0]; out[1] *= tint[1]; out[2] *= tint[2]; out[3] *= tint[3]; }
      }, fd, { texMode: tr.textureMode, cam });
    }
  }
  const count = fd.ni - i0;
  return count > 0 ? { first: i0, count } : null;
}
let _trailPts = new Float32Array(75);

/**
 * The bone influences per vertex of a skinned mesh file (§33.9 writes four; an extraction made before the fix of
 * 2026-10-15 wrote the client's own count — 2 for 铃兰 S3's fox tails, 琴柳's flags —, which read as four put every
 * vertex on the wrong bones and weights: a long strip across the board). 0 when the file has no usable skin.
 */
export function skinStride(meshData) {
  const P = meshData?.positions, BI = meshData?.boneIndices, BP = meshData?.bindPoses;
  const nv = P ? (P.length / 3) | 0 : 0;
  if (!nv || !Array.isArray(BI) || !Array.isArray(BP) || !BP.length) return 0;
  const k = BI.length / nv;
  return Number.isInteger(k) && k >= 1 && k <= 4 ? k : 0;
}

/**
 * Skinned mesh (CPU skinning): vertex = Σ w · (bone world · bind pose) · v, written as indexed triangles.
 * bones: Float32Array(16) world matrices (or null for a missing bone → identity), bind poses row-major. The influences
 * per vertex come from the file (skinStride); without weights each vertex follows its one bone (weight 1).
 */
export function buildSkinned(meshData, bones, submesh, fd, tint) {
  const P = meshData.positions, N = meshData.normals, UV = meshData.uv0, C = meshData.colors;
  const BW = meshData.boneWeights, BI = meshData.boneIndices, BP = meshData.bindPoses;
  const nv = (P.length / 3) | 0;
  const K = skinStride(meshData);
  if (!K || (BW && BW.length !== BI.length)) return null;
  // skin matrices = bone world · bind pose (bind poses are row-major)
  const skin = _skin.length >= bones.length * 16 ? _skin : (_skin = new Float32Array(bones.length * 16 + 16));
  for (let b = 0; b < bones.length; b++) {
    const wm = bones[b], bp = BP[b];
    if (!wm || !bp) { skin.fill(0, b * 16, b * 16 + 16); skin[b * 16] = skin[b * 16 + 5] = skin[b * 16 + 10] = skin[b * 16 + 15] = 1; continue; }
    // column-major copy of the row-major bind pose
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) _s[c * 4 + r] = bp[r * 4 + c];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      skin[b * 16 + c * 4 + r] = wm[r] * _s[c * 4] + wm[4 + r] * _s[c * 4 + 1] + wm[8 + r] * _s[c * 4 + 2] + wm[12 + r] * _s[c * 4 + 3];
    }
  }
  const v0 = fd.verts(nv), b = fd.strip;
  for (let v = 0; v < nv; v++) {
    let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
    const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
    for (let k = 0; k < K; k++) {
      const w = BW ? BW[v * K + k] : (k === 0 ? 1 : 0);
      if (!(w > 0)) continue;
      const bi = BI[v * K + k] | 0;
      if (bi < 0 || bi >= bones.length) continue;
      const o = bi * 16;
      x += w * (skin[o] * px + skin[o + 4] * py + skin[o + 8] * pz + skin[o + 12]);
      y += w * (skin[o + 1] * px + skin[o + 5] * py + skin[o + 9] * pz + skin[o + 13]);
      z += w * (skin[o + 2] * px + skin[o + 6] * py + skin[o + 10] * pz + skin[o + 14]);
      if (N) {
        const qx = N[v * 3], qy = N[v * 3 + 1], qz = N[v * 3 + 2];
        nx += w * (skin[o] * qx + skin[o + 4] * qy + skin[o + 8] * qz);
        ny += w * (skin[o + 1] * qx + skin[o + 5] * qy + skin[o + 9] * qz);
        nz += w * (skin[o + 2] * qx + skin[o + 6] * qy + skin[o + 10] * qz);
      }
    }
    const off = (v0 + v) * STRIP_STRIDE;
    b[off] = x; b[off + 1] = y; b[off + 2] = z;
    b[off + 3] = UV ? UV[v * 2] : 0; b[off + 4] = UV ? UV[v * 2 + 1] : 0;
    const cr = C ? C[v * 4] : 1, cg = C ? C[v * 4 + 1] : 1, cb = C ? C[v * 4 + 2] : 1, ca = C ? C[v * 4 + 3] : 1;
    b[off + 5] = cr * (tint ? tint[0] : 1); b[off + 6] = cg * (tint ? tint[1] : 1); b[off + 7] = cb * (tint ? tint[2] : 1); b[off + 8] = ca * (tint ? tint[3] : 1);
    b[off + 9] = nx; b[off + 10] = ny; b[off + 11] = nz;
  }
  const tris = meshData.submeshes[submesh] || [];
  const i0 = fd.indices(tris.length), I = fd.index;
  for (let k = 0; k < tris.length; k++) I[i0 + k] = v0 + tris[k];
  return { first: i0, count: tris.length };
}
let _skin = new Float32Array(16 * 32);

/** World positions of a LineRenderer (points in world or node space) into a Float32Array; returns n. */
export function linePoints(points, world, m, loop, out) {
  const n = points.length;
  const total = n + (loop && n > 2 ? 1 : 0);
  if (out.length < total * 3) return 0;
  for (let k = 0; k < total; k++) {
    const p = points[k % n];
    if (world) { out[k * 3] = p[0]; out[k * 3 + 1] = p[1]; out[k * 3 + 2] = p[2]; } else mat4Point(m, p[0], p[1], p[2], out, k * 3);
  }
  return total;
}

export { mat4Point as _mat4Point };
