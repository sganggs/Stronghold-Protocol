// Official legacy AnimationClips played on a drawn prefab (ui/prefab/view.js) with the Web Animations API. Each clip is
// sampled (ui/prefab/anim.js, Unity's Hermite curves) at 30 frames a second into keyframes per node: the box's opacity
// (CanvasGroup m_Alpha), visibility (m_IsActive) and transform (anchored position as a translation from where the layout
// put it, sizeDelta as a scale about the pivot, local scale, z rotation), and the graphic's opacity and colour
// (Image / Text / RawImage m_Color). Only opacity and transform move every frame for most clips, so the browser can
// composite them. A play request runs once (a status transition, a banner's show / out clip; `reverse` for a switch
// clip shown backwards); a node's PlayAutomatically clip loops while the node is shown (wireline lights, wings, emoji).
// The browser interpolates keyframes linearly, so a sampled frame that the straight line between its neighbours already
// reproduces is dropped (keptFrames). 可露希尔's 35 s countdown_bg_loop drops from 26 300 keyframes to 2 500 (most nodes
// 12–101 instead of 1052 each); Firefox spent ~200 ms a frame on the main thread driving the full loops (PR #973's measurement).

import { evalKeys, evalVecKeys, resolvePath } from './anim.js';
import { parseHex } from './color.js';

const FPS = 30;

/**
 * How far a dropped frame may sit from the straight line between the frames kept around it: opacity 1/1000, colour
 * 1/500 (half a step of 255), a translation 0.1 layout units (a tenth of a pixel on the official 1920×1080 layout),
 * scale 1/2000, rotation 0.02°. Visibility is 0 / 1, so its tolerance keeps both frames around every change and the
 * switch lands on the same frame as before.
 */
export const KEYFRAME_TOLERANCE = { alpha: 0.001, pos: 0.1, scale: 0.0005, rot: 0.02, color: 0.002, step: 0.01 };

/**
 * The sampled frames to keep, the first and the last always: Ramer–Douglas–Peucker over all channels at once, each
 * channel's distance from the straight line between two kept frames measured against its own tolerance. A value that
 * is not a number keeps its frame.
 * @param {{ v: number[], eps: number }[]} channels  one value per frame (frames + 1 each) @param {number} frames
 * @returns {number[]}
 */
export function keptFrames(channels, frames) {
  const keep = new Uint8Array(frames + 1);
  keep[0] = 1;
  keep[frames] = 1;
  /** @type {[number, number][]} */
  const stack = [[0, frames]];
  while (stack.length) {
    const [a, b] = /** @type {[number, number]} */ (stack.pop());
    if (b - a < 2) continue;
    let worst = 1;
    let at = -1;
    for (let j = a + 1; j < b; j++) {
      const u = (j - a) / (b - a);
      for (const ch of channels) {
        const d = Math.abs(ch.v[j] - (ch.v[a] + (ch.v[b] - ch.v[a]) * u)) / ch.eps;
        if (Number.isNaN(d)) {
          worst = Infinity;
          at = j;
        } else if (d > worst) {
          worst = d;
          at = j;
        }
      }
    }
    if (at < 0) continue;
    keep[at] = 1;
    stack.push([a, at], [at, b]);
  }
  const out = [];
  for (let i = 0; i <= frames; i++) if (keep[i]) out.push(i);
  return out;
}

/** Quaternion → degrees about z. @param {number[]} q */
function quatZ(q) {
  const [x, y, z, w] = q.map(Number);
  const n = Math.hypot(x, y, z, w) || 1;
  return (Math.atan2(2 * ((w / n) * (z / n) + (x / n) * (y / n)), 1 - 2 * ((y / n) ** 2 + (z / n) ** 2)) * 180) / Math.PI;
}

const rem = (u) => `${Number((u / 100).toFixed(4))}rem`;

/**
 * Per-node tracks of a clip: node → { prop → value per frame }.
 * @param {any} clip @param {any} wrapper @returns {{ frames: number, tracks: Map<any, Record<string, (number|number[])[]>> }}
 */
export function sampleClip(clip, wrapper) {
  const len = Math.max(0, Number(clip?.len) || 0);
  const frames = Math.max(1, Math.round(len * FPS));
  /** @type {Map<any, Record<string, any[]>>} */
  const tracks = new Map();
  for (const [path, prop, keys] of clip?.curves || []) {
    const node = resolvePath(wrapper, path);
    if (!node || !Array.isArray(keys) || !keys.length) continue;
    const vector = Array.isArray(keys[0][1]);
    const out = [];
    for (let i = 0; i <= frames; i++) {
      const t = (i / frames) * len;
      out.push(vector ? evalVecKeys(keys, t) : evalKeys(keys, t));
    }
    const rec = tracks.get(node) || {};
    rec[prop] = out;
    tracks.set(node, rec);
  }
  return { frames, tracks };
}

/**
 * Keyframes for one node's box and graphic from its tracks.
 * @param {Record<string, any[]>} tr @param {number} frames
 * @param {{ pos: number[], size: number[], scale: number[], rot: number, alpha: number, color: string|null, tinted: boolean, text: boolean }} ref
 *   what the layout drew: anchored position and size (units), scale, rotation, alpha; the graphic's colour
 */
export function nodeKeyframes(tr, frames, ref) {
  const moves = tr.ax || tr.ay || tr.sw || tr.sh || tr.scale || tr.rot || tr.euler || tr.rz;
  const fades = tr.alpha;
  const shows = tr.active;
  const colours = ['img', 'txt', 'raw'].some((g) => tr[`${g}.r`] || tr[`${g}.g`] || tr[`${g}.b`] || tr[`${g}.a`]);
  const [r0, g0, b0, a0] = parseHex(ref.color);
  const T = KEYFRAME_TOLERANCE;
  const clamp01 = (/** @type {number} */ v) => Math.max(0, Math.min(1, v));
  const range = Array.from({ length: frames + 1 }, (_, i) => i);
  const offset = (/** @type {number} */ i) => (frames ? i / frames : 0);

  let box = null;
  if (moves || fades || shows) {
    const alpha = fades ? range.map((i) => clamp01(Number(tr.alpha[i]))) : null;
    const vis = shows ? range.map((i) => (Number(tr.active[i]) > 0.5 ? 1 : 0)) : null;
    const pose = moves ? range.map((i) => {
      const dx = tr.ax ? Number(tr.ax[i]) - ref.pos[0] : 0;
      const dy = tr.ay ? -(Number(tr.ay[i]) - ref.pos[1]) : 0;
      let sx = tr.scale ? Number(tr.scale[i][0]) : ref.scale[0];
      let sy = tr.scale ? Number(tr.scale[i][1]) : ref.scale[1];
      if (tr.sw && ref.size[0] > 0) sx *= Number(tr.sw[i]) / ref.size[0];
      if (tr.sh && ref.size[1] > 0) sy *= Number(tr.sh[i]) / ref.size[1];
      const rot = tr.rot ? quatZ(tr.rot[i]) : tr.euler ? Number(tr.euler[i][2]) : tr.rz ? Number(tr.rz[i]) : ref.rot;
      return { dx, dy, sx, sy, rot };
    }) : null;
    const channels = [];
    if (alpha) channels.push({ v: alpha, eps: T.alpha });
    if (vis) channels.push({ v: vis, eps: T.step });
    if (pose) {
      channels.push({ v: pose.map((p) => p.dx), eps: T.pos }, { v: pose.map((p) => p.dy), eps: T.pos });
      channels.push({ v: pose.map((p) => p.sx), eps: T.scale }, { v: pose.map((p) => p.sy), eps: T.scale });
      channels.push({ v: pose.map((p) => p.rot), eps: T.rot });
    }
    box = keptFrames(channels, frames).map((i) => {
      /** @type {Keyframe} */
      const k = { offset: offset(i) };
      if (alpha) k.opacity = String(alpha[i]);
      if (vis) k.visibility = vis[i] ? 'visible' : 'hidden';
      if (pose) {
        const { dx, dy, sx, sy, rot } = pose[i];
        k.transform = `translate(${rem(dx)}, ${rem(dy)}) rotate(${-rot}deg) scale(${sx}, ${sy})`;
      }
      return k;
    });
  }

  let gfx = null;
  if (colours) {
    const pick = (/** @type {string} */ c, /** @type {number} */ base, /** @type {number} */ i) => {
      for (const g of ['img', 'txt', 'raw']) if (tr[`${g}.${c}`]) return Number(tr[`${g}.${c}`][i]);
      return base;
    };
    const a = range.map((i) => clamp01(pick('a', a0, i)));
    const r = range.map((i) => pick('r', r0 / 255, i));
    const g = range.map((i) => pick('g', g0 / 255, i));
    const b = range.map((i) => pick('b', b0 / 255, i));
    const channels = [{ v: a, eps: T.alpha }];
    if (ref.text || ref.tinted) channels.push({ v: r, eps: T.color }, { v: g, eps: T.color }, { v: b, eps: T.color });
    gfx = keptFrames(channels, frames).map((i) => {
      /** @type {Keyframe} */
      const k = { offset: offset(i), opacity: String(a[i]) };
      const rgb = `rgb(${Math.round(r[i] * 255)} ${Math.round(g[i] * 255)} ${Math.round(b[i] * 255)})`;
      if (ref.text) k.color = rgb;
      else if (ref.tinted) k.backgroundColor = rgb;
      return k;
    });
  }
  return { box, gfx };
}

/**
 * Run clips on a drawn prefab. `elOf(node)` gives a node's box element (null when not drawn), `refOf(node)` what the
 * layout drew for it. Returns the animations (cancel them to stop).
 * @param {{ clip: any, on: any, loop?: boolean, reverse?: boolean, delay?: number, rate?: number }[]} jobs  rate: playback speed
 * @param {(node: any) => HTMLElement|null} elOf @param {(node: any) => any} refOf
 * @returns {Animation[]}
 */
export function runClips(jobs, elOf, refOf) {
  const out = [];
  for (const job of jobs) {
    const len = Number(job.clip?.len) || 0;
    if (!job.clip || !job.on || len <= 0) continue;
    const { frames, tracks } = sampleClip(job.clip, job.on);
    const timing = {
      duration: (len * 1000) / Math.max(0.1, Number(job.rate) || 1),
      iterations: job.loop ? Infinity : 1,
      direction: /** @type {PlaybackDirection} */ (job.reverse ? 'reverse' : 'normal'),
      fill: /** @type {FillMode} */ (job.loop ? 'none' : 'both'),
      delay: job.delay || 0,
      easing: 'linear',
    };
    for (const [node, tr] of tracks) {
      const el = elOf(node);
      const ref = refOf(node);
      if (!el || !ref) continue;
      const kf = nodeKeyframes(tr, frames, ref);
      try {
        if (kf.box && typeof el.animate === 'function') out.push(el.animate(kf.box, timing));
        const g = kf.gfx ? el.querySelector(':scope > .pf__g') : null;
        if (g && typeof g.animate === 'function') out.push(g.animate(kf.gfx, timing));
      } catch { /* an element gone mid-run */ }
    }
  }
  return out;
}
