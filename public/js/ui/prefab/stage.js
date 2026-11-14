// An official prefab drawn frame by frame (the 规程 opening, ui/regulationFilm.js). PrefabView (ui/prefab/view.js) lays
// a prefab out once and hands its clips to the Web Animations API, which moves boxes by transforms only; an opening
// whose clips resize masks, sliced frames and groups with anchored children (cards revealed by a growing RectMask2D,
// a cross whose corners follow its rect, a logo uncovered from the middle) is laid out again for every frame instead:
// draw(pose) runs ui/prefab/layout.js in that frame's pose and writes only the style values that changed. Images only
// (the opening has no Text); particle holders (fx) are not drawn. Units as in view.js: 1 unit = 0.01rem.

import { layoutPrefab } from './layout.js';
import { effectImageStyle } from './view.js';

/** @param {any} v @param {number} d */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
/** Units → rem text. @param {number} u */
const rem = (u) => `${Number((u / 100).toFixed(3))}rem`;

/**
 * @param {HTMLElement} host  the element the stage root goes in (positioned by the caller)
 * @param {{ pack: { sprite: (name: string, file?: string|null) => string, texture?: (name: string) => string }, prefab: any }} opts
 * @returns {{ root: HTMLElement, draw: (pose: import('./anim.js').Pose) => void, destroy: () => void }}
 */
export function createStage(host, { pack, prefab }) {
  /** @type {Map<any, { el: HTMLElement, g: HTMLElement|null, s: Record<string, string>, gk: string, shown: boolean }>} */
  const recs = new Map();
  const root = document.createElement('div');
  root.className = 'pf__root';
  (function build(node, parent) {
    if (!node || node.fx) return;
    const el = document.createElement('div');
    el.className = 'pf__n';
    el.setAttribute('data-n', node.name || '');
    el.style.display = 'none';
    if (node.mask?.rect) el.style.overflow = 'hidden';
    let g = null;
    if (node.image) {
      g = document.createElement('i');
      g.className = 'pf__g';
      el.appendChild(g);
    }
    parent.appendChild(el);
    recs.set(node, { el, g, s: {}, gk: '', shown: false });
    for (const c of node.children || []) build(c, el);
  })(prefab, root);
  host.appendChild(root);

  /** @param {{ el: HTMLElement, s: Record<string, string> }} rec @param {string} key @param {string} value */
  const put = (rec, key, value) => {
    if (rec.s[key] === value) return;
    rec.s[key] = value;
    rec.el.style.setProperty(key, value);
  };

  /** @param {any} box @param {import('./anim.js').Pose} pose @param {Set<any>} seen */
  const paint = (box, pose, seen) => {
    const n = box.node;
    const rec = recs.get(n);
    if (!rec) return;
    seen.add(n);
    if (!rec.shown) { rec.el.style.display = ''; rec.shown = true; }
    put(rec, 'left', rem(box.left));
    put(rec, 'top', rem(box.top));
    put(rec, 'width', rem(box.w));
    put(rec, 'height', rem(box.h));
    put(rec, 'opacity', box.alpha < 1 ? String(Number(Math.max(0, box.alpha).toFixed(3))) : '');
    const rot = pose.rot.has(n) ? pose.rot.get(n) : n.rot;
    const scl = pose.scale.get(n) || n.scale;
    const tf = [];
    if (num(rot)) tf.push(`rotate(${-num(rot)}deg)`);
    if (Array.isArray(scl) && (num(scl[0], 1) !== 1 || num(scl[1], 1) !== 1)) tf.push(`scale(${Number(num(scl[0], 1).toFixed(4))}, ${Number(num(scl[1], 1).toFixed(4))})`);
    put(rec, 'transform', tf.join(' '));
    if (tf.length) put(rec, 'transform-origin', `${box.pivot[0] * 100}% ${(1 - box.pivot[1]) * 100}%`);
    if (rec.g && n.image) {
      // the graphic changes with its colour (a sheet frame, a fade) and, for sliced / tiled art, never with its size
      const over = pose.color.get(n);
      const fill = pose.fill.get(n);
      const key = `${over ? `${over.r},${over.g},${over.b},${over.a}` : ''}|${fill ?? ''}`;
      if (key !== rec.gk) {
        rec.gk = key;
        const st = effectImageStyle(n.image, pack.sprite, over, fill ?? null, pack.texture || null);
        rec.g.removeAttribute('style');
        if (st) Object.assign(rec.g.style, st);
        else rec.g.style.display = 'none';
      }
    }
    for (const c of box.children) paint(c, pose, seen);
  };

  return {
    root,
    draw(pose) {
      const { box } = layoutPrefab(prefab, { pose, measure: () => ({ w: 0, h: 0 }), skip: (node) => !!node.fx });
      const seen = new Set();
      paint(box, pose, seen);
      for (const [node, rec] of recs) {
        if (rec.shown && !seen.has(node)) { rec.el.style.display = 'none'; rec.shown = false; }
      }
    },
    destroy() {
      root.remove();
      recs.clear();
    },
  };
}
