// Poses of the official theme prefabs: what a status driver and the prefab's legacy AnimationClips set on the nodes.
// A clip (tools/local-extract ui_components.clip_info) is evaluated like Unity's AnimationCurve: cubic Hermite between
// two keys (an infinite slope holds the left key's value), the first / last value outside the keys. A curve's path is
// relative to the node that owns the Animation component (the status op's wrapper); each path segment is the first
// child of that name. The pose maps are keyed by node object (ui/prefab/layout.js and view.js read them).

/**
 * @typedef {import('./layout.js').PNode} PNode
 * @typedef {{ active: Map<PNode, boolean>, alpha: Map<PNode, number>, color: Map<PNode, { r?: number, g?: number, b?: number, a?: number }>,
 *   pos: Map<PNode, (number|null)[]>, size: Map<PNode, (number|null)[]>, scale: Map<PNode, number[]>, rot: Map<PNode, number>,
 *   maxw: Map<PNode, number>, anchors: Map<PNode, { min: number[], max: number[] }>, texts: Map<PNode, string|null>,
 *   fill: Map<PNode, number> }} Pose  fill: a filled Image's fillAmount
 */

const INF = 1e8;

/** @returns {Pose} */
export function createPose() {
  return { active: new Map(), alpha: new Map(), color: new Map(), pos: new Map(), size: new Map(), scale: new Map(), rot: new Map(), maxw: new Map(), anchors: new Map(), texts: new Map(), fill: new Map() };
}

/** One Hermite segment. @param {number} v0 @param {number} m0 @param {number} v1 @param {number} m1 @param {number} dt @param {number} u */
function hermite(v0, m0, v1, m1, dt, u) {
  if (Math.abs(m0) >= INF || Math.abs(m1) >= INF) return v0;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * m0 * dt + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * m1 * dt;
}

/** @param {any[]} keys @param {number} t @param {(k: any[], i: number) => number} at */
function segment(keys, t, at) {
  if (!keys.length) return null;
  if (t <= keys[0][0]) return { lo: 0, hi: 0, u: 0 };
  const last = keys.length - 1;
  if (t >= keys[last][0]) return { lo: last, hi: last, u: 0 };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid][0] <= t) lo = mid; else hi = mid;
  }
  const dt = keys[hi][0] - keys[lo][0];
  void at;
  return { lo, hi, u: dt > 0 ? (t - keys[lo][0]) / dt : 0 };
}

/** A scalar curve at time t. @param {any[]} keys  [time, value, inSlope, outSlope] @param {number} t */
export function evalKeys(keys, t) {
  const s = segment(keys, t, null);
  if (!s) return 0;
  const a = keys[s.lo];
  if (s.lo === s.hi) return Number(a[1]);
  const b = keys[s.hi];
  return hermite(Number(a[1]), Number(a[3]), Number(b[1]), Number(b[2]), b[0] - a[0], s.u);
}

/** A vector curve at time t. @param {any[]} keys  [time, values[], inSlopes[], outSlopes[]] @param {number} t */
export function evalVecKeys(keys, t) {
  const s = segment(keys, t, null);
  if (!s) return [];
  const a = keys[s.lo];
  if (s.lo === s.hi) return a[1].map(Number);
  const b = keys[s.hi];
  return a[1].map((v, i) => hermite(Number(v), Number(a[3][i]), Number(b[1][i]), Number(b[2][i]), b[0] - a[0], s.u));
}

/** Clip time after its wrap mode (2 loop, 4 ping-pong; else it clamps). @param {any} clip @param {number} t */
export function clipTime(clip, t) {
  const len = Number(clip?.len) || 0;
  if (len <= 0) return 0;
  if (clip.wrap === 2) return ((t % len) + len) % len;
  if (clip.wrap === 4) {
    const k = ((t % (2 * len)) + 2 * len) % (2 * len);
    return k <= len ? k : 2 * len - k;
  }
  return Math.min(Math.max(t, 0), len);
}

/** The node a clip path names under `from` ('' is `from` itself). @param {PNode} from @param {string} path @returns {PNode|null} */
export function resolvePath(from, path) {
  if (!from) return null;
  if (!path) return from;
  let node = from;
  for (const part of String(path).split('/')) {
    const next = (node.children || []).find((c) => c.name === part);
    if (!next) return null;
    node = next;
  }
  return node;
}

/** Quaternion → degrees about z. @param {number[]} q */
function quatZ(q) {
  const [x, y, z, w] = q.map(Number);
  const n = Math.hypot(x, y, z, w) || 1;
  return (Math.atan2(2 * ((w / n) * (z / n) + (x / n) * (y / n)), 1 - 2 * ((y / n) ** 2 + (z / n) ** 2)) * 180) / Math.PI;
}

/**
 * Write a clip's values at time t into a pose.
 * @param {any} clip @param {PNode} wrapper @param {number} t @param {Pose} pose
 */
export function clipPose(clip, wrapper, t, pose) {
  if (!clip || !wrapper || !Array.isArray(clip.curves)) return pose;
  const time = clipTime(clip, t);
  for (const [path, prop, keys] of clip.curves) {
    const node = resolvePath(wrapper, path);
    if (!node || !Array.isArray(keys) || !keys.length) continue;
    const vector = Array.isArray(keys[0][1]);
    const v = vector ? evalVecKeys(keys, time) : evalKeys(keys, time);
    switch (prop) {
      case 'active': pose.active.set(node, Number(v) > 0.5); break;
      case 'alpha': pose.alpha.set(node, Math.min(1, Math.max(0, Number(v)))); break;
      case 'ax': case 'ay': {
        const cur = pose.pos.get(node) || [null, null];
        cur[prop === 'ax' ? 0 : 1] = Number(v);
        pose.pos.set(node, cur);
        break;
      }
      case 'sw': case 'sh': {
        const cur = pose.size.get(node) || [null, null];
        cur[prop === 'sw' ? 0 : 1] = Number(v);
        pose.size.set(node, cur);
        break;
      }
      case 'scale': pose.scale.set(node, [Number(v[0]), Number(v[1])]); break;
      case 'rot': pose.rot.set(node, quatZ(/** @type {number[]} */ (v))); break;
      case 'euler': pose.rot.set(node, Number(v[2])); break;
      case 'rz': pose.rot.set(node, Number(v)); break;
      case 'maxw': pose.maxw.set(node, Number(v)); break;
      default:
        if (/^(img|txt|raw)\.[rgba]$/.test(prop)) {
          const cur = pose.color.get(node) || {};
          cur[prop.slice(-1)] = Math.min(1, Math.max(0, Number(v)));
          pose.color.set(node, cur);
        }
    }
  }
  return pose;
}

/** Status driver tables under a prefab. @param {PNode} root */
function driversOf(root) {
  const out = [];
  (function walk(n) {
    if (Array.isArray(n?.status)) out.push(n.status);
    for (const c of n?.children || []) walk(c);
  })(root);
  return out;
}

/**
 * Apply status driver entries to a pose, in order. Active ops first, then each clip at its end (a switch clip played
 * backwards, show 0, at its start): a static picture of what the status leaves on screen once its clips are done.
 * @param {PNode} root @param {Record<string, any>} clips @param {string[]} names @param {Pose} pose
 * @param {(id: number) => PNode|null} byId
 * @returns {{ name: string, clip: string, on: PNode, fast: boolean, show: boolean }[]} the clips the statuses play
 */
export function applyStatuses(root, clips, names, pose, byId) {
  const played = [];
  const tables = driversOf(root);
  for (const name of (names || []).filter(Boolean)) {
    for (const table of tables) {
      const entry = table.find((e) => e?.name === name);
      if (!entry) continue;
      for (const op of entry.ops || []) {
        if (op.t === 1 && Number.isInteger(op.node)) {
          const n = byId(op.node);
          if (n) pose.active.set(n, !!op.on);
        }
        if (op.alpha && Number.isInteger(op.alpha.node)) {
          const n = byId(op.alpha.node);
          if (n) pose.alpha.set(n, Number(op.alpha.value) || 0);
        }
      }
      for (const op of entry.ops || []) {
        if (!op.anim?.clip) continue;
        const on = (Number.isInteger(op.anim.on) ? byId(op.anim.on) : null) || root;
        const clip = clips?.[op.anim.clip];
        if (!clip) continue;
        const back = op.t === 3 && !op.show;
        clipPose(clip, on, back ? 0 : Number(clip.len) || 0, pose);
        played.push({ name, clip: op.anim.clip, on, fast: !!op.fast, show: !back });
      }
    }
  }
  return played;
}
