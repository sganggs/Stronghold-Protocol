// Official legacy AnimationClips played on a drawn prefab (ui/prefab/view.js) with the Web Animations API. Each clip is
// sampled (ui/prefab/anim.js, Unity's Hermite curves) at 30 frames a second into keyframes per node: the box's opacity
// (CanvasGroup m_Alpha), visibility (m_IsActive) and transform (anchored position as a translation from where the layout
// put it, sizeDelta as a scale about the pivot, local scale, z rotation), and the graphic's opacity and colour
// (Image / Text / RawImage m_Color). Only opacity and transform move every frame for most clips, so the browser can
// composite them. A play request runs once (a status transition, a banner's show / out clip; `reverse` for a switch
// clip shown backwards); a node's PlayAutomatically clip loops while the node is shown (wireline lights, wings, emoji).

import { evalKeys, evalVecKeys, resolvePath } from './anim.js';
import { parseHex } from './color.js';

const FPS = 30;

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
  const box = [];
  const gfx = [];
  const moves = tr.ax || tr.ay || tr.sw || tr.sh || tr.scale || tr.rot || tr.euler || tr.rz;
  const fades = tr.alpha;
  const shows = tr.active;
  const colours = ['img', 'txt', 'raw'].some((g) => tr[`${g}.r`] || tr[`${g}.g`] || tr[`${g}.b`] || tr[`${g}.a`]);
  const [r0, g0, b0, a0] = parseHex(ref.color);
  for (let i = 0; i <= frames; i++) {
    const offset = frames ? i / frames : 0;
    if (moves || fades || shows) {
      const k = { offset };
      if (fades) k.opacity = String(Math.max(0, Math.min(1, Number(tr.alpha[i]))));
      if (shows) k.visibility = Number(tr.active[i]) > 0.5 ? 'visible' : 'hidden';
      if (moves) {
        const dx = tr.ax ? Number(tr.ax[i]) - ref.pos[0] : 0;
        const dy = tr.ay ? -(Number(tr.ay[i]) - ref.pos[1]) : 0;
        let sx = tr.scale ? Number(tr.scale[i][0]) : ref.scale[0];
        let sy = tr.scale ? Number(tr.scale[i][1]) : ref.scale[1];
        if (tr.sw && ref.size[0] > 0) sx *= Number(tr.sw[i]) / ref.size[0];
        if (tr.sh && ref.size[1] > 0) sy *= Number(tr.sh[i]) / ref.size[1];
        const rot = tr.rot ? quatZ(tr.rot[i]) : tr.euler ? Number(tr.euler[i][2]) : tr.rz ? Number(tr.rz[i]) : ref.rot;
        k.transform = `translate(${rem(dx)}, ${rem(dy)}) rotate(${-rot}deg) scale(${sx}, ${sy})`;
      }
      box.push(k);
    }
    if (colours) {
      const pick = (c, base) => {
        for (const g of ['img', 'txt', 'raw']) if (tr[`${g}.${c}`]) return Number(tr[`${g}.${c}`][i]);
        return base;
      };
      const a = pick('a', a0);
      const k = { offset, opacity: String(Math.max(0, Math.min(1, a))) };
      const r = Math.round(pick('r', r0 / 255) * 255);
      const g = Math.round(pick('g', g0 / 255) * 255);
      const b = Math.round(pick('b', b0 / 255) * 255);
      if (ref.text) k.color = `rgb(${r} ${g} ${b})`;
      else if (ref.tinted) k.backgroundColor = `rgb(${r} ${g} ${b})`;
      gfx.push(k);
    }
  }
  return { box: box.length ? box : null, gfx: gfx.length ? gfx : null };
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
