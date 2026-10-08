// render/projection.js — the battlefield camera: one perspective camera model shared by the three.js board scene
// (render/board3d, DESIGN §15) and the Pixi layers on top of it (units, FX, drag & drop, hit-testing). Pure math, no
// PIXI / three import (Node tests and the 2D fallback use it as is).
//
// World space (DESIGN §3): x = col, y = row (row 0 = bottom = nearest to the camera), z = height in tiles (up).
// Tile (r,c) covers x ∈ [c−½, c+½], y ∈ [r−½, r+½]. The camera is a three.js-style PerspectiveCamera: a pinhole
// south of its target (towards −y), pitched `tilt` degrees away from looking straight down, `dist` tiles from the
// target point on the ground, with an off-axis lens (principal point (cx, cy), three's setViewOffset):
//
//   C = T + dist·(0, −sin tilt, cos tilt)       camera position
//   f = (0, sin tilt, −cos tilt)                forward      u = (0, cos tilt, sin tilt)   up      r = (1,0,0)
//   depth = (P−C)·f ;  screen = (cx, cy) + scale·dist·((P−C)·r, −(P−C)·u) / depth
//
// `scale` = CSS px per world unit at the target's depth, i.e. the focal length is scale·dist px and the vertical
// field of view of a viewport H px high is 2·atan(H / 2 / (scale·dist)). `threeCameraParams` / `syncThreeCamera`
// turn a Camera into the equivalent THREE.PerspectiveCamera (fov, aspect, position, up, look-at, view offset) —
// test/render/projection.test.js projects every tile centre through both and requires identical pixels.
//
// Official framing (research 09 §2.1, fitted against official 1920×1080 screenshots; DESIGN §15): every 卫戍协议
// level's configBlackBoard carries camera params "(x,y,z,w)" (left_prepare / left_shop / left_battle / mid_battle /
// *_boss_* / enemy). They are offsets of Arknights' standard battle camera: position = OFFICIAL.base + param in the
// level's centred Unity frame (x = col − 10, y = row − 9, z = −height), pitched OFFICIAL.pitch = 30° with a vertical
// field of view of OFFICIAL.fovY = 40° and the principal point at the screen centre. (Measured: the shop camera
// (−4.83, −1.75, −3.77) puts the camera at col 5.17, row 2.44, height 11.53 — the least-squares fit of tile seams in
// an official shop-view screenshot gave col 5.17, row 2.40, height 11.57 at 30°/40°.) Screens narrower than 16:9
// back the camera off like the client (up to 4:3: Δ = (0, −1.4, −2.8)·t). `presetCamera` returns these official
// cameras; `fitCamera` (frame any rect inside a padded viewport) remains for custom rects and portrait viewports.
//
// HUD clearance of the prep views (user playtest #5 item 9, `clearHud`): the official shop camera puts the bench's
// near edge right on the shop bar's top and the field's back row right under the bond strip at 16:9 (both measured
// flush at 1920×1080). The remake's HUD is sized in rem with a 40 px floor (css/theme.css), so on screens shorter
// than 432 CSS px (phones in landscape) it is taller than the official one relative to the screen and the shop bar
// covered the lower part of bench pads 3–9 (29 % at 844×390, 46 % at the user's Android = 756×366, 51 % at 800×360;
// the Final Assault prep alike). With `opts.hud` (the px bands the HUD covers along the top and bottom edge) the
// official prep camera is kept whenever the band from the bench's near edge to the field's back row fits between them
// — every desktop viewport measured (the Final Assault bench, 1.2 px lower, is nudged up < 3 px at 16:9) — and
// otherwise panned and, only when the band is taller than the space, zoomed out (844×390: ×0.90, 756×366: ×0.84,
// 800×360: ×0.83): a 2D pan / zoom of the image (principal point and focal length), so the perspective and the
// three.js camera stay the official ones.

export const DEG = Math.PI / 180;

/** Arknights' standard battle camera (see header). */
export const OFFICIAL = Object.freeze({
  base: Object.freeze([0, -4.81, -7.76]), // standard view position in the centred Unity frame
  pitch: 30,                               // degrees from straight down
  fovY: 40,                                // vertical field of view, degrees
  center: Object.freeze([10, 9]),          // (col, row) of the Unity frame origin on the 19×21 grid
  aspectAdjust: Object.freeze([0, -1.4, -2.8]), // camera offset at 3:4 (H/W), interpolated from 9:16
});

/** configBlackBoard camera params (identical in all 11 autochess stages; stage.config overrides). */
export const OFFICIAL_PARAMS = Object.freeze({
  left_prepare_camera_param: '(-4.67,0.3,-2.46,1)',
  left_shop_camera_param: '(-4.83,-1.75,-3.77,1)',
  left_battle_camera_param: '(-4,1.91,-0.6,1)',
  right_battle_camera_param: '(4,1.91,-0.6,1)',
  mid_battle_camera_param: '(0,0,-4.22,1)',
  left_boss_prepare_camera_param: '(-4.67,-6.68,-2.46,1)',
  left_boss_shop_camera_param: '(-4.83,-8.73,-3.77,1)',
  left_boss_battle_camera_param: '(-4,-5.54,-0.6,1)',
  right_boss_battle_camera_param: '(4,-5.54,-0.6,1)',
  mid_boss_battle_camera_param: '(0,-7.95,-4.22,1)',
  right_boss_prepare_camera_param: '(5.93,-6.68,-2.46,1)',
  right_boss_shop_camera_param: '(5.83,-8.73,-3.77,1)',
  enemy_camera_param: '(0,7.86,0.9,1)',
});

/** Default optics of the fitted (non-official) cameras: the official pitch; dist is a moderate lens. */
export const DEFAULT_OPTICS = Object.freeze({ tilt: OFFICIAL.pitch, dist: 16 });

/** Tile-top heights (tiles) of the prep band's edges (render/style.js TILE_H): bench pads, raised high ground. */
const KEEP_Z_BENCH = 0.16, KEEP_Z_HIGH = 0.42;

/**
 * Rects framed by each camera kind (inclusive tile bounds), framing parameters of the fitted fallback, and the
 * official configBlackBoard param(s) of the kind (`official`: side → param key; `half` for the ‹ › half views).
 * `keep` (prep views): the band `clearHud` keeps clear of the HUD — `near` = world row (y) of the bench's near edge
 * (hand row 7 / boss row 0) with the pads' tops at `zNear`, `far` = the field's back edge (row 12 / boss row 5) with
 * its raised tops at `zFar`.
 */
export const CAMERA_PRESETS = Object.freeze({
  prep: Object.freeze({
    rect: Object.freeze({ r0: 7, r1: 12, c0: 0, c1: 10 }), margin: 0.35, headroom: 1.25, tilt: 30, dist: 13,
    official: Object.freeze({ L: 'left_shop_camera_param', R: 'left_shop_camera_param' }),
    officialNoShop: Object.freeze({ L: 'left_prepare_camera_param', R: 'left_prepare_camera_param' }),
    keep: Object.freeze({ near: 6.5, zNear: KEEP_Z_BENCH, far: 12.5, zFar: KEEP_Z_HIGH }),
  }),
  normal: Object.freeze({
    rect: Object.freeze({ r0: 9, r1: 12, c0: 0, c1: 10 }), margin: 0.45, headroom: 1.35, tilt: 30, dist: 13,
    official: Object.freeze({ L: 'left_battle_camera_param', R: 'right_battle_camera_param' }),
  }),
  unite: Object.freeze({
    rect: Object.freeze({ r0: 9, r1: 12, c0: 0, c1: 20 }), margin: 0.25, headroom: 1.35, tilt: 30, dist: 18,
    official: Object.freeze({ L: 'mid_battle_camera_param', R: 'mid_battle_camera_param' }),
    half: Object.freeze({ L: 'left_battle_camera_param', R: 'right_battle_camera_param' }),
  }),
  boss: Object.freeze({
    rect: Object.freeze({ r0: 0, r1: 5, c0: 0, c1: 20 }), margin: 0.2, headroom: 1.5, tilt: 30, dist: 18,
    official: Object.freeze({ L: 'mid_boss_battle_camera_param', R: 'mid_boss_battle_camera_param' }),
    half: Object.freeze({ L: 'left_boss_battle_camera_param', R: 'right_boss_battle_camera_param' }),
  }),
  bossPrep: Object.freeze({
    rect: Object.freeze({ r0: 0, r1: 5, c0: 0, c1: 10 }), margin: 0.35, headroom: 1.25, tilt: 30, dist: 13,
    official: Object.freeze({ L: 'left_boss_shop_camera_param', R: 'right_boss_shop_camera_param' }),
    officialNoShop: Object.freeze({ L: 'left_boss_prepare_camera_param', R: 'right_boss_prepare_camera_param' }),
    keep: Object.freeze({ near: -0.5, zNear: KEEP_Z_BENCH, far: 5.5, zFar: KEEP_Z_HIGH }),
  }),
  pen: Object.freeze({
    rect: Object.freeze({ r0: 14, r1: 18, c0: 7, c1: 13 }), margin: 0.3, headroom: 1.2, tilt: 30, dist: 11,
    official: Object.freeze({ L: 'enemy_camera_param', R: 'enemy_camera_param' }),
  }),
});

const EPS = 1e-6;
const MIN_DEPTH = 0.05;

const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Perspective camera. Mutable; call `update()` after changing fields directly (setters do it for you).
 */
export class Camera {
  /**
   * @param {{ tx?: number, ty?: number, tz?: number, tilt?: number, dist?: number, scale?: number, cx?: number, cy?: number }} [o]
   */
  constructor(options) {
    const o = options && typeof options === 'object' ? options : {};
    this.tx = finite(o.tx, 5);
    this.ty = finite(o.ty, 10);
    this.tz = finite(o.tz, 0);
    this.tilt = clamp(finite(o.tilt, DEFAULT_OPTICS.tilt), 0, 80);
    this.dist = Math.max(1, finite(o.dist, DEFAULT_OPTICS.dist));
    this.scale = Math.max(EPS, finite(o.scale, 64));
    this.cx = finite(o.cx, 0);
    this.cy = finite(o.cy, 0);
    /** bumped by update(); lets consumers cache projections */
    this.version = 0;
    this.update();
  }

  /** Recompute derived values (camera position, basis). */
  update() {
    const t = this.tilt * DEG;
    this._s = Math.sin(t);
    this._c = Math.cos(t);
    this._px = this.tx;
    this._py = this.ty - this.dist * this._s;
    this._pz = this.tz + this.dist * this._c;
    this._k = this.scale * this.dist;
    this.version++;
    return this;
  }

  /** Copy every parameter from another camera. */
  copy(o) {
    this.tx = o.tx; this.ty = o.ty; this.tz = o.tz; this.tilt = o.tilt; this.dist = o.dist;
    this.scale = o.scale; this.cx = o.cx; this.cy = o.cy;
    return this.update();
  }

  clone() { return new Camera(this.params()); }

  /** Plain parameter object (serialisable). */
  params() {
    return { tx: this.tx, ty: this.ty, tz: this.tz, tilt: this.tilt, dist: this.dist, scale: this.scale, cx: this.cx, cy: this.cy };
  }

  /** World position of the camera (the pinhole). */
  position() { return { x: this._px, y: this._py, z: this._pz }; }

  /** Focal length in CSS px (screen distance of the image plane). */
  focal() { return this._k; }

  /** Depth of a world point along the view axis (≥ MIN_DEPTH). */
  depthOf(x, y, z = 0) {
    const d = (y - this._py) * this._s - (z - this._pz) * this._c;
    return d > MIN_DEPTH ? d : MIN_DEPTH;
  }

  /**
   * Project a world point. Writes `{ x, y, s, depth }` into `out` (allocated when omitted):
   * screen position (CSS px) and `s` = CSS px per world unit at that point.
   */
  project(x, y, z = 0, out = { x: 0, y: 0, s: 0, depth: 0 }) {
    const vx = x - this._px, vy = y - this._py, vz = z - this._pz;
    let depth = vy * this._s - vz * this._c;
    if (!(depth > MIN_DEPTH)) depth = MIN_DEPTH;
    const up = vy * this._c + vz * this._s;
    const k = this._k / depth;
    out.x = this.cx + vx * k;
    out.y = this.cy - up * k;
    out.s = k;
    out.depth = depth;
    return out;
  }

  /** CSS px per world unit at a world point. */
  scaleAt(x, y, z = 0) { return this._k / this.depthOf(x, y, z); }

  /**
   * World height above (x, y, z) whose projection lies `px` CSS px above the projection of (x, y, z) — exact for this
   * camera. A unit's model is an upright screen billboard, so a point at a given drawn height on it (render/fx.js
   * SHOT_HEIGHT, GitHub #61) is this lift, not that many tiles: under the 30° pitch a vertical world height shows at
   * about half its length.
   */
  liftFor(x, y, z, px) {
    const vy = y - this._py, vz = z - this._pz;
    let depth = vy * this._s - vz * this._c;
    if (!(depth > MIN_DEPTH)) depth = MIN_DEPTH;
    const up = vy * this._c + vz * this._s;
    // screen y = cy − k·up/depth; raising z by h: up += h·sin, depth −= h·cos — solve for the wanted up/depth ratio
    const ratio = up / depth + px / this._k;
    const den = this._s + ratio * this._c;
    if (!(den > 1e-6)) return px / Math.max(1e-6, (this._k / depth) * Math.max(this._s, 0.1));
    return (ratio * depth - up) / den;
  }

  /**
   * Inverse projection onto the horizontal plane at height `z`. Returns `{ x, y }` (written into `out`) or
   * null when the view ray does not hit the plane in front of the camera.
   */
  unproject(sx, sy, z = 0, out = { x: 0, y: 0 }) {
    // Ray direction for screen point: d = f + r·a + u·b with a = (sx−cx)/k, b = −(sy−cy)/k.
    const a = (sx - this.cx) / this._k;
    const b = -(sy - this.cy) / this._k;
    const dx = a;
    const dy = this._s + b * this._c;
    const dz = -this._c + b * this._s;
    if (Math.abs(dz) < EPS) return null;
    const t = (z - this._pz) / dz;
    if (!(t > 0) || !Number.isFinite(t)) return null;
    out.x = this._px + t * dx;
    out.y = this._py + t * dy;
    return out;
  }

  /** The equivalent THREE.PerspectiveCamera parameters for a `width`×`height` CSS px viewport (see below). */
  threeParams(width, height, opts) { return threeCameraParams(this, width, height, opts); }
}

// ---- three.js PerspectiveCamera equivalence ------------------------------------------------------------------

/**
 * Parameters of the THREE.PerspectiveCamera that projects exactly like `cam` onto a `width`×`height` viewport:
 * `{ fov (vertical, degrees), aspect, near, far, position: [x,y,z], up: [x,y,z], target: [x,y,z],
 *    view: { fullWidth, fullHeight, offsetX, offsetY, width, height } }` (three's setViewOffset: the off-axis
 * principal point (cx, cy)). World axes are the projection's (x = col, y = row, z = up).
 */
export function threeCameraParams(cam, width, height, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const W = Math.max(1, finite(width, 1)), H = Math.max(1, finite(height, 1));
  const t = cam.tilt * DEG, s = Math.sin(t), c = Math.cos(t);
  const fovY = 2 * Math.atan(H / 2 / Math.max(EPS, cam.scale * cam.dist)) / DEG;
  const pos = [cam.tx, cam.ty - cam.dist * s, cam.tz + cam.dist * c];
  return {
    fov: fovY, aspect: W / H,
    near: Math.max(0.01, finite(o.near, cam.dist * 0.05)), far: Math.max(1, finite(o.far, cam.dist + 80)),
    position: pos, up: [0, c, s], target: [cam.tx, cam.ty, cam.tz],
    view: { fullWidth: W, fullHeight: H, offsetX: W / 2 - cam.cx, offsetY: H / 2 - cam.cy, width: W, height: H },
  };
}

/**
 * Configure a THREE.PerspectiveCamera (duck-typed: fov, aspect, near, far, position, up, lookAt, setViewOffset,
 * updateProjectionMatrix, updateMatrixWorld) to project exactly like `cam` on a `width`×`height` CSS px viewport.
 */
export function syncThreeCamera(cam, three, width, height, opts) {
  const p = threeCameraParams(cam, width, height, opts);
  three.fov = p.fov;
  three.aspect = p.aspect;
  three.near = p.near;
  three.far = p.far;
  three.position.set(p.position[0], p.position[1], p.position[2]);
  three.up.set(p.up[0], p.up[1], p.up[2]);
  three.lookAt(p.target[0], p.target[1], p.target[2]);
  const v = p.view;
  three.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height);
  three.updateProjectionMatrix();
  three.updateMatrixWorld(true);
  return three;
}

/** Ease for camera transitions. */
export const easeInOutCubic = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

/** Interpolate two cameras into `out` (scale in log space so zooms feel linear). */
export function lerpCamera(a, b, t, out = new Camera()) {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const L = (p, q) => p + (q - p) * u;
  out.tx = L(a.tx, b.tx); out.ty = L(a.ty, b.ty); out.tz = L(a.tz, b.tz);
  out.tilt = L(a.tilt, b.tilt); out.dist = L(a.dist, b.dist);
  out.scale = Math.exp(L(Math.log(Math.max(EPS, a.scale)), Math.log(Math.max(EPS, b.scale))));
  out.cx = L(a.cx, b.cx); out.cy = L(a.cy, b.cy);
  return out.update();
}

/** Normalised copy of a rect ({r0,r1,c0,c1} inclusive; swapped bounds fixed; clamped to the 19×21 grid). */
export function normRect(rect, rows = 19, cols = 21) {
  const src = rect && typeof rect === 'object' ? rect : {};
  let r0 = Math.round(finite(src.r0, 0)), r1 = Math.round(finite(src.r1, rows - 1));
  let c0 = Math.round(finite(src.c0, 0)), c1 = Math.round(finite(src.c1, cols - 1));
  if (r0 > r1) [r0, r1] = [r1, r0];
  if (c0 > c1) [c0, c1] = [c1, c0];
  return { r0: clamp(r0, 0, rows - 1), r1: clamp(r1, 0, rows - 1), c0: clamp(c0, 0, cols - 1), c1: clamp(c1, 0, cols - 1) };
}

/**
 * Camera that frames `rect` inside the viewport.
 * @param {{r0,r1,c0,c1}} rect inclusive tile bounds
 * @param {{ width: number, height: number, padding?: { top?, right?, bottom?, left? } }} viewport CSS px
 * @param {{ tilt?, dist?, margin?: number, headroom?: number, maxTilePx?: number, minTilePx?: number }} [opts]
 *   margin (tiles) around the rect; headroom (tiles) of vertical space kept above the far row for units.
 */
export function fitCamera(rect, viewport, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const R = normRect(rect);
  const W = Math.max(1, finite(viewport?.width, 1));
  const H = Math.max(1, finite(viewport?.height, 1));
  const pad = viewport?.padding || {};
  const pt = Math.max(0, finite(pad.top, 0)), pr = Math.max(0, finite(pad.right, 0));
  const pb = Math.max(0, finite(pad.bottom, 0)), pl = Math.max(0, finite(pad.left, 0));
  const availW = Math.max(16, W - pl - pr), availH = Math.max(16, H - pt - pb);
  const margin = Math.max(0, finite(opts.margin, 0.35));
  const headroom = Math.max(0, finite(opts.headroom, 1.2));
  const cam = new Camera({
    tx: (R.c0 + R.c1) / 2, ty: (R.r0 + R.r1) / 2, tz: 0,
    tilt: finite(opts.tilt, DEFAULT_OPTICS.tilt), dist: finite(opts.dist, DEFAULT_OPTICS.dist), scale: 1, cx: 0, cy: 0,
  });
  const x0 = R.c0 - 0.5 - margin, x1 = R.c1 + 0.5 + margin;
  const y0 = R.r0 - 0.5 - margin, y1 = R.r1 + 0.5 + margin;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const p = { x: 0, y: 0, s: 0, depth: 0 };
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [0, headroom]) {
    cam.project(x, y, z, p);
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const bw = Math.max(EPS, maxX - minX), bh = Math.max(EPS, maxY - minY);
  let s = Math.min(availW / bw, availH / bh);
  const maxTile = finite(opts.maxTilePx, 360), minTile = finite(opts.minTilePx, 4);
  s = clamp(s, minTile, maxTile);
  cam.scale = s;
  cam.cx = pl + availW / 2 - s * (minX + maxX) / 2;
  cam.cy = pt + availH / 2 - s * (minY + maxY) / 2;
  return cam.update();
}

/** Parse a configBlackBoard camera param "(x,y,z,w)" → [x, y, z, w] (null when malformed). */
export function parseCameraParam(v) {
  if (Array.isArray(v)) {
    const a = v.map(Number);
    return a.length >= 3 && a.slice(0, 3).every(Number.isFinite) ? [a[0], a[1], a[2], Number.isFinite(a[3]) ? a[3] : 1] : null;
  }
  if (typeof v !== 'string') return null;
  const nums = v.replace(/[()\s]/g, '').split(',').map(Number);
  if (nums.length < 3 || !nums.slice(0, 3).every(Number.isFinite)) return null;
  return [nums[0], nums[1], nums[2], Number.isFinite(nums[3]) ? nums[3] : 1];
}

/**
 * The official camera of a configBlackBoard param on a `width`×`height` viewport (see the header): position =
 * OFFICIAL.base + param (+ the narrow-screen adjustment), pitch 30°, vertical FOV 40°, centred principal point.
 * @param {string|number[]} param "(x,y,z,w)" or [x,y,z]
 * @param {{ width: number, height: number }} viewport
 */
export function officialCamera(param, viewport, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const p = parseCameraParam(param) || [0, 0, 0, 1];
  const W = Math.max(1, finite(viewport?.width, 1920)), H = Math.max(1, finite(viewport?.height, 1080));
  const pitch = finite(o.pitch, OFFICIAL.pitch), fovY = finite(o.fovY, OFFICIAL.fovY);
  const base = Array.isArray(o.base) ? o.base : OFFICIAL.base;
  // narrow screens (up to 4:3) back the camera off like the client; wider ones keep the 16:9 position
  const ratio = H / W;
  const k = clamp((9 / 16 - ratio) / (9 / 16 - 3 / 4), 0, 1);
  const adj = OFFICIAL.aspectAdjust;
  const ux = p[0] + base[0] + adj[0] * k, uy = p[1] + base[1] + adj[1] * k, uz = p[2] + base[2] + adj[2] * k;
  const cx = ux + OFFICIAL.center[0], cy = uy + OFFICIAL.center[1], height = Math.max(0.5, -uz);
  const t = clamp(pitch, 1, 80) * DEG;
  const dist = height / Math.cos(t);
  const focal = (H / 2) / Math.tan((clamp(fovY, 5, 150) * DEG) / 2);
  return new Camera({ tx: cx, ty: cy + height * Math.tan(t), tz: 0, tilt: pitch, dist, scale: focal / dist, cx: W / 2, cy: H / 2 });
}

/** Overlap (px) between the kept band and a HUD band that still counts as clear (float noise). */
const HUD_TOLERANCE = 0.5;
/** Gap (px) an adjusted camera leaves between the kept band and the HUD when there is room (no seam under an edge). */
const HUD_GAP = 1;

/**
 * Player map view (render/app.js): the player's own zoom and pan on top of the camera a preset / flight produced.
 * The zoom is the factor that camera is scaled by — 1 = the framing the preset asked for (official configBlackBoard
 * framing / the fitted rect), `ZOOM_MIN` the widest and `ZOOM_MAX` the closest (a factor, so every camera kind keeps
 * its own sensible px per tile).
 */
export const ZOOM_MIN = 0.5, ZOOM_MAX = 3;
/**
 * …and the tile size those factors may not leave (CSS px per tile at the camera's target): the official cameras differ
 * a lot (a battle field is ~50 px per tile, the prep shop view ~128), so a bare factor would let the prep camera zoom
 * to a 400 px tile. A camera-aware clamp (`clampZoomFor`) keeps every view in a readable band.
 */
export const ZOOM_MIN_TILE_PX = 9, ZOOM_MAX_TILE_PX = 190;

/** A zoom factor clamped to ZOOM_MIN…ZOOM_MAX (a non-finite factor means "no zoom"). */
export function clampZoom(f) { return clamp(finite(f, 1), ZOOM_MIN, ZOOM_MAX); }

/**
 * The factor clamped for a particular camera: ZOOM_MIN…ZOOM_MAX and, inside that, whatever keeps the tile under the
 * camera's target between ZOOM_MIN_TILE_PX and ZOOM_MAX_TILE_PX (cam.scale is px per world unit at that depth, i.e.
 * px per tile there). Cameras whose base size already sits near a bound simply allow less travel.
 */
export function clampZoomFor(cam, f) {
  const base = Math.max(EPS, finite(cam?.scale, 64));
  const lo = Math.max(ZOOM_MIN, ZOOM_MIN_TILE_PX / base);
  const hi = Math.min(ZOOM_MAX, ZOOM_MAX_TILE_PX / base);
  return clamp(finite(f, 1), Math.min(lo, hi), Math.max(lo, hi));
}

/**
 * How far the player's pan may drag the view from the framing the preset / flight asked for, as a share of the
 * viewport: the base image's own centre can never leave the viewport, so the board cannot be pushed off screen.
 */
export const PAN_LIMIT_FRAC = 0.5;

/** A pan offset (CSS px) clamped to ±`limit`; a non-finite value means "no pan". */
export function clampPan(v, limit) {
  const hi = Math.max(0, finite(limit, 0));
  return clamp(finite(v, 0), -hi, hi);
}

/**
 * The same view, its whole image translated by (dx, dy) CSS px — the principal point moves, nothing else. This is
 * what a pan is once the zoom has been applied (the camera-aware pan limits live in the app: PAN_LIMIT_FRAC of the
 * viewport). `out` may be a reused camera.
 */
export function panCamera(cam, dx, dy, out = new Camera()) {
  out.tx = cam.tx; out.ty = cam.ty; out.tz = cam.tz; out.tilt = cam.tilt; out.dist = cam.dist;
  out.scale = cam.scale;
  out.cx = cam.cx + finite(dx, 0);
  out.cy = cam.cy + finite(dy, 0);
  return out.update();
}

/**
 * The pan that results from zooming the player's view by `factor` about the screen point `anchor`, when the view is
 * written as a pan plus a zoom about the viewport's centre `centre` — `screen' = centre + pan + zoom·(screen − centre)`
 * with `screen` the base camera's own pixel for a world point. Zooming about the screen point `anchor` means scaling
 * the IMAGE about it (`T_new(x) = anchor + factor·(T_old(x) − anchor)`), which in that form is
 * `pan' = factor·pan + (1 − factor)·(anchor − centre)`: the existing pan scales with the zoom (it is a screen offset of
 * the zoomed image), and the second term is the anchor's own share. This keeps whatever world point sits under
 * `anchor` exactly under it — at any zoom, with any pan already applied — so a zoom after a pan, or a pinch whose
 * midpoint travels, all stay consistent, and picking under the pointer cannot drift.
 * @param {number} factor the factor actually applied (the clamped one)
 * @param {{x: number, y: number}} anchor screen point held fixed (CSS px)
 * @param {{x: number, y: number}} centre the viewport's centre (the zoom reference)
 * @param {{x: number, y: number}} [pan] the pan before the zoom
 * @returns {{ x: number, y: number }} the pan after it (CSS px)
 */
export function zoomedPan(factor, anchor, centre, pan) {
  const k = finite(factor, 1);
  const px = finite(pan?.x, 0), py = finite(pan?.y, 0);
  return {
    x: k * px + (1 - k) * (finite(anchor?.x, 0) - finite(centre?.x, 0)),
    y: k * py + (1 - k) * (finite(anchor?.y, 0) - finite(centre?.y, 0)),
  };
}

/**
 * The same view, zoomed by `factor` about the screen point (ax, ay): the focal length and the principal point are
 * scaled so whatever world point sits under (ax, ay) stays exactly under it — the `clearHud` image transform,
 * generalised to any anchor (screen' = A + f·(screen − A) ⇒ scale' = f·scale, c' = A + f·(c − A)). This is a
 * perspective zoom (the official model's focal length), not a dolly: the pitch, the camera position and the framing of
 * the field stay as the preset left them, only the field of view narrows.
 * `factor` is applied as given (callers clamp the TOTAL factor with `clampZoom`); `out` may be a reused camera.
 * @param {Camera} cam
 * @param {number} factor
 * @param {number} [ax] anchor x (CSS px), default the camera's principal point
 * @param {number} [ay] anchor y
 * @param {Camera} [out]
 */
export function zoomCamera(cam, factor, ax = cam.cx, ay = cam.cy, out = new Camera()) {
  const f = Math.max(0.05, finite(factor, 1));
  out.tx = cam.tx; out.ty = cam.ty; out.tz = cam.tz; out.tilt = cam.tilt; out.dist = cam.dist;
  out.scale = cam.scale * f;
  out.cx = finite(ax, cam.cx) + (cam.cx - finite(ax, cam.cx)) * f;
  out.cy = finite(ay, cam.cy) + (cam.cy - finite(ay, cam.cy)) * f;
  return out.update();
}

/**
 * Keep a band of the board clear of the HUD (see the header). `hud` = { top, bottom }: CSS px the HUD covers along
 * the viewport's top edge (top bar + bond strip) and bottom edge (the shop bar); `keep` = { near, zNear?, far, zFar? }:
 * world rows (y) of the band's near and far edge, at the heights zNear / zFar. Returns `cam` itself when the band
 * fits between the HUD bands; else a new camera whose image is panned vertically by the smallest shift that clears
 * the HUD (by up to HUD_GAP where there is room) or — only when the band is taller than the space between — zoomed
 * out about the viewport's centre so it fills that space less HUD_GAP at both ends. The screen y of a horizontal
 * world line is the same at every x (the camera has no roll), so one point per edge decides.
 * @param {Camera} cam
 * @param {{ top?: number, bottom?: number }|null} hud
 * @param {{ near: number, zNear?: number, far: number, zFar?: number }|null} keep
 * @param {{ width: number, height: number }} viewport CSS px
 * @returns {Camera}
 */
export function clearHud(cam, hud, keep, viewport) {
  if (!cam || !hud || typeof hud !== 'object' || !keep) return cam;
  const W = Math.max(1, finite(viewport?.width, 1)), H = Math.max(1, finite(viewport?.height, 1));
  const top = Math.max(0, finite(hud.top, 0)), bottom = H - Math.max(0, finite(hud.bottom, 0));
  if (!(bottom - top > 16)) return cam; // no usable space: keep the official framing
  const yNear = cam.project(cam.tx, keep.near, finite(keep.zNear, 0)).y;
  const yFar = cam.project(cam.tx, keep.far, finite(keep.zFar, 0)).y;
  if (!Number.isFinite(yNear) || !Number.isFinite(yFar) || !(yNear > yFar)) return cam;
  if (yNear <= bottom + HUD_TOLERANCE && yFar >= top - HUD_TOLERANCE) return cam;
  const spare = bottom - top - (yNear - yFar);
  const gap = spare >= 0 ? Math.min(HUD_GAP, spare / 2) : HUD_GAP;
  const lo = top + gap, hi = bottom - gap;
  const f = spare >= 0 ? 1 : (hi - lo) / (yNear - yFar);
  const out = cam.clone();
  // image transform x' = xc + f·(x − xc), y' = lo + f·(y − yFar) (zoom) or y' = y + dy (pan, the smallest shift
  // that puts [yFar, yNear] inside [lo, hi]): scale the focal length by f and move the principal point accordingly
  out.scale = cam.scale * f;
  out.cx = W / 2 + f * (cam.cx - W / 2);
  out.cy = f < 1 ? lo + f * (cam.cy - yFar) : cam.cy + Math.min(Math.max(0, lo - yFar), hi - yNear);
  return out.update();
}

const sameRect = (a, b) => !!a && !!b && a.r0 === b.r0 && a.r1 === b.r1 && a.c0 === b.c0 && a.c1 === b.c1;

/**
 * Preset camera for a field kind: 'prep' | 'normal' | 'unite' | 'boss' ('hidden') | 'bossPrep' | 'pen'.
 * Official framing (configBlackBoard params, `opts.config` = stage.config overrides the defaults) unless the
 * viewport is narrower than 4:3 (portrait), `opts.fit` is set, or `opts.rect` is a custom rect — then the rect is
 * fitted into the padded viewport (`fitCamera`). `opts.side` 'L'|'R' picks the side's param (right boss half);
 * `opts.half` frames only that half of a unite/boss field; `opts.shop === false` uses the shop-collapsed prep camera.
 * `opts.hud` = { top, bottom } (CSS px of HUD along the top / bottom edge): the official prep / Final Assault prep
 * camera keeps the bench and the field clear of it (`clearHud`, the preset's `keep` band).
 */
export function presetCamera(kind, viewport, options) {
  const opts = options && typeof options === 'object' ? options : {};
  let k = kind === 'hidden' ? 'boss' : kind;
  if (!CAMERA_PRESETS[k]) k = 'normal';
  let rect = opts.rect ? normRect(opts.rect) : null;
  // the Final Assault prep happens on the boss field: a 'prep' camera asked for the boss rows is the boss one
  if (k === 'prep' && rect && rect.r1 <= 6) k = 'bossPrep';
  const preset = CAMERA_PRESETS[k];
  const side = opts.side === 'R' ? 'R' : 'L';
  const W = Math.max(1, finite(viewport?.width, 1)), H = Math.max(1, finite(viewport?.height, 1));
  const knownRect = !rect || sameRect(rect, preset.rect) || (k === 'prep' && rect.r0 >= 6 && rect.r1 <= 12 && rect.c1 <= 10)
    || (k === 'normal' && rect.r0 >= 6 && rect.r1 <= 13) || (k === 'unite' && rect.r0 >= 6 && rect.r1 <= 13)
    || (k === 'boss' && rect.r1 <= 6) || k === 'bossPrep' || k === 'pen';
  const useOfficial = !opts.fit && knownRect && W / H >= 4 / 3 - 1e-6;
  if (useOfficial) {
    const table = opts.half && preset.half ? preset.half : opts.shop === false && preset.officialNoShop ? preset.officialNoShop : preset.official;
    const key = table[side];
    const cfg = opts.config && typeof opts.config === 'object' ? opts.config : null;
    const param = (cfg && parseCameraParam(cfg[key])) || parseCameraParam(OFFICIAL_PARAMS[key]);
    const cam = officialCamera(param, { width: W, height: H }, opts);
    return preset.keep && opts.hud ? clearHud(cam, opts.hud, preset.keep, { width: W, height: H }) : cam;
  }
  if (!rect) {
    rect = { ...preset.rect };
    // the right-hand Final Assault player prepares on the right boss half (mirrored col c → 20 − c)
    if (k === 'bossPrep' && side === 'R') rect = { ...rect, c0: 20 - preset.rect.c1, c1: 20 - preset.rect.c0 };
  }
  if (k === 'prep') rect = { ...rect, r0: Math.min(rect.r0, 7) };
  if (opts.half && (k === 'boss' || k === 'unite')) {
    const mid = Math.floor((rect.c0 + rect.c1) / 2);
    rect = side === 'R' ? { ...rect, c0: mid } : { ...rect, c1: mid };
  }
  // a narrow rect (e.g. a solo boss half) keeps the normal optics; wide ones use the preset's wider lens
  const wide = rect.c1 - rect.c0 >= 14;
  const base = wide ? preset : CAMERA_PRESETS[k === 'prep' || k === 'bossPrep' ? 'prep' : 'normal'];
  return fitCamera(rect, viewport, {
    tilt: finite(opts.tilt, base.tilt), dist: finite(opts.dist, base.dist),
    margin: finite(opts.margin, preset.margin), headroom: finite(opts.headroom, preset.headroom),
    maxTilePx: opts.maxTilePx, minTilePx: opts.minTilePx,
  });
}

/**
 * Tile under a screen point, honouring raised tiles: planes are tried from the highest height down, and a hit
 * counts only when the tile found there really has that height. Returns `{ row, col }` or null (off-grid).
 * @param {Camera} cam
 * @param {(row:number, col:number) => number} heightAt  tile top height (0 for low / off-grid)
 * @param {number[]} [levels] distinct heights to test (descending), default [heights present…, 0]
 */
export function pickTile(cam, sx, sy, heightAt, levels = [0], rows = 19, cols = 21) {
  const p = { x: 0, y: 0 };
  const hs = [...levels].sort((a, b) => b - a);
  if (!hs.includes(0)) hs.push(0);
  for (const h of hs) {
    if (!cam.unproject(sx, sy, h, p)) continue;
    const col = Math.round(p.x) + 0, row = Math.round(p.y) + 0; // + 0 turns -0 into 0
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      if (h === 0) return null;
      continue;
    }
    const th = heightAt ? finite(heightAt(row, col), 0) : 0;
    if (h === 0 || Math.abs(th - h) < 1e-3) return { row, col, x: p.x, y: p.y };
  }
  return null;
}

/** Screen-space quad (4 projected corners, counter-clockwise from near-left) of a tile top at height z. */
export function tileQuad(cam, row, col, z = 0, inset = 0) {
  const a = 0.5 - inset;
  return [
    cam.project(col - a, row - a, z, { x: 0, y: 0, s: 0, depth: 0 }),
    cam.project(col + a, row - a, z, { x: 0, y: 0, s: 0, depth: 0 }),
    cam.project(col + a, row + a, z, { x: 0, y: 0, s: 0, depth: 0 }),
    cam.project(col - a, row + a, z, { x: 0, y: 0, s: 0, depth: 0 }),
  ];
}
