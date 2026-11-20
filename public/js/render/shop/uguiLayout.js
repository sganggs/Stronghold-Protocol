// uGUI layout for the panel documents: anchors/pivot to box, HorizontalOrVerticalLayoutGroup (min/pref/flex)
// and sliders, in the panel's top-down px space.
const AXES = [0, 1];

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

const vec = (v, d) => (Array.isArray(v) && v.length >= 2 ? [num(v[0], d[0]), num(v[1], d[1])] : d.slice());

export function isActive(node, opts) {
  const over = opts?.pose?.active;
  if (over && over.has(node)) return !!over.get(node);
  return node?.active !== false;
}

const merge2 = (over, base) => (over ? [over[0] ?? base[0], over[1] ?? base[1]] : base);

function rectOf(node, opts) {
  const r = node.rect || {};
  const pose = opts?.pose;
  const anchors = pose?.anchors.get(node);
  return {
    min: anchors ? vec(anchors.min, [0.5, 0.5]) : vec(r.anchors?.min, [0.5, 0.5]),
    max: anchors ? vec(anchors.max, [0.5, 0.5]) : vec(r.anchors?.max, [0.5, 0.5]),
    pivot: vec(r.pivot, [0.5, 0.5]),
    size: merge2(pose?.size.get(node), vec(r.sizeDelta, [0, 0])),
    pos: merge2(pose?.pos.get(node), vec(r.anchoredPosition, [0, 0])),
  };
}

function layoutChildren(node, opts) {
  return (node.children || []).filter((c) => isActive(c, opts) && !c.element?.ignore);
}

export function layoutSize(node, axis, opts, memo = new Map()) {
  const key = memo.get(node);
  if (key && key[axis]) return key[axis];
  let min = 0;
  let pref = 0;
  let flex = 0;
  if (node.layout && (node.layout.axis === 'h' || node.layout.axis === 'v')) {
    ({ min, pref, flex } = groupSize(node, axis, opts, memo));
  } else if (node.text) {
    const s = textSize(node, opts);
    pref = axis === 0 ? s.w : s.h;
  } else if (node.image && node.image.sprite) {
    const ppu = num(node.image.ppu, 1) || 1;
    const sliced = node.image.type === 'sliced' || node.image.type === 'tiled';
    if (sliced) {
      const sl = Array.isArray(node.image.slice) ? node.image.slice : [0, 0, 0, 0];
      pref = (axis === 0 ? num(sl[1]) + num(sl[3]) : num(sl[0]) + num(sl[2])) / ppu;
    } else {
      pref = (axis === 0 ? num(node.image.w) : num(node.image.h)) / ppu;
    }
  }
  const el = node.element;
  if (el) {
    const take = (pair, cur) => (Array.isArray(pair) && num(pair[axis], -1) >= 0 ? num(pair[axis]) : cur);
    min = take(el.min, min);
    pref = take(el.pref, pref);
    flex = take(el.flex, flex);
    const maxw = axis === 0 ? opts.pose?.maxw.get(node) : undefined;
    const cap = maxw != null ? maxw : Array.isArray(el.max) ? num(el.max[axis], -1) : -1;
    if (cap >= 0) pref = Math.min(pref, cap);
  }
  const out = { min, pref: Math.max(min, pref), flex };
  memo.set(node, { ...(key || {}), [axis]: out });
  return out;
}

export function textOf(node, opts) {
  const over = opts?.pose?.texts;
  if (over && over.has(node)) return over.get(node);
  return node.text?.text ?? '';
}

function textSize(node, opts) {
  const text = textOf(node, opts);
  if (!text) return { w: 0, h: 0 };
  return opts.measure ? opts.measure(String(text), node) : { w: String(text).length * num(node.text?.fontSize, 14) * 0.6, h: num(node.text?.fontSize, 14) * 1.2 };
}

function childSizes(child, axis, control, expand, opts, memo) {
  let min;
  let pref;
  let flex;
  if (!control) {
    min = rectOf(child, opts).size[axis];
    pref = min;
    flex = 0;
  } else {
    ({ min, pref, flex } = layoutSize(child, axis, opts, memo));
  }
  if (expand) flex = Math.max(flex, 1);
  return { min, pref, flex };
}

function groupSize(node, axis, opts, memo) {
  const g = node.layout;
  const vertical = g.axis === 'v';
  const pad = Array.isArray(g.pad) ? g.pad : [0, 0, 0, 0];
  const padding = axis === 0 ? num(pad[0]) + num(pad[1]) : num(pad[2]) + num(pad[3]);
  const control = !!(g.control || [])[axis];
  const expand = !!(g.expand || [])[axis];
  const spacing = num(g.spacing);
  const along = vertical === (axis === 1);
  const kids = layoutChildren(node, opts);
  let min = padding;
  let pref = padding;
  let flex = 0;
  for (const c of kids) {
    const s = childSizes(c, axis, control, expand, opts, memo);
    if (!along) {
      min = Math.max(s.min + padding, min);
      pref = Math.max(s.pref + padding, pref);
      flex = Math.max(s.flex, flex);
    } else {
      min += s.min + spacing;
      pref += s.pref + spacing;
      flex += s.flex;
    }
  }
  if (along && kids.length) {
    min -= spacing;
    pref -= spacing;
  }
  return { min, pref: Math.max(min, pref), flex };
}

function arrange(node, w, h, opts, memo) {
  const g = node.layout;
  const vertical = g.axis === 'v';
  const pad = Array.isArray(g.pad) ? g.pad : [0, 0, 0, 0];
  const kids = layoutChildren(node, opts);
  if (g.reverse) kids.reverse();

  const out = new Map(kids.map((c) => {
    const r = rectOf(c, opts);
    return [c, { x: 0, y: 0, w: r.size[0], h: r.size[1] }];
  }));
  const align = num(g.align);
  const alignOn = (axis) => (axis === 0 ? (align % 3) * 0.5 : Math.floor(align / 3) * 0.5);
  for (const axis of AXES) {
    const size = (axis === 0 ? w : h) - (axis === 0 ? num(pad[0]) + num(pad[1]) : num(pad[2]) + num(pad[3]));
    const control = !!(g.control || [])[axis];
    const expand = !!(g.expand || [])[axis];
    const start = axis === 0 ? num(pad[0]) : num(pad[2]);
    const startOffset = (required) => start + ((axis === 0 ? w : h) - (required + (axis === 0 ? num(pad[0]) + num(pad[1]) : num(pad[2]) + num(pad[3])))) * alignOn(axis);
    const along = vertical === (axis === 1);
    if (!along) {
      for (const c of kids) {
        const s = childSizes(c, axis, control, expand, opts, memo);

        const upper = s.flex > 0 ? (axis === 0 ? w : h) : s.pref;
        const required = size < s.min ? s.min : size > upper ? upper : size;
        const o = out.get(c);
        if (control) {
          const off = startOffset(required);
          if (axis === 0) { o.x = off; o.w = required; } else { o.y = off; o.h = required; }
        } else {
          const own = axis === 0 ? o.w : o.h;
          const off = startOffset(required) + (required - own) * alignOn(axis);
          if (axis === 0) o.x = off; else o.y = off;
        }
      }
      continue;
    }
    const total = groupSize(node, axis, opts, memo);
    const inner = axis === 0 ? num(pad[0]) + num(pad[1]) : num(pad[2]) + num(pad[3]);
    let pos = start;
    let flexMul = 0;
    const surplus = size - (total.pref - inner);
    if (surplus > 0) {
      if (total.flex === 0) pos = startOffset(total.pref - inner);
      else if (total.flex > 0) flexMul = surplus / total.flex;
    }
    const lerp = total.min !== total.pref ? Math.min(1, Math.max(0, (size - (total.min - inner)) / (total.pref - total.min))) : 0;
    for (const c of kids) {
      const s = childSizes(c, axis, control, expand, opts, memo);
      const childSize = s.min + (s.pref - s.min) * lerp + s.flex * flexMul;
      const o = out.get(c);
      if (control) {
        if (axis === 0) { o.x = pos; o.w = childSize; } else { o.y = pos; o.h = childSize; }
      } else {
        const own = axis === 0 ? o.w : o.h;
        const off = pos + (childSize - own) * alignOn(axis);
        if (axis === 0) o.x = off; else o.y = off;
      }
      pos += childSize + num(g.spacing);
    }
  }
  return out;
}

export function layoutPrefab(root, opts = {}) {

  const memo = new Map();
  const bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const r0 = rectOf(root, opts);
  // ContentSizeFitter: 1 = min, 2 = preferred. root_layout fits its width to the content, which is why the
  // panel content sits right-aligned under the official 1920 layout.
  const rootSize = fitted(root, r0.size, opts, memo);
  const box = place(root, { x: -r0.pivot[0] * rootSize[0], y: -r0.pivot[1] * rootSize[1], w: rootSize[0], h: rootSize[1] }, null, 0, 0, opts, memo, bounds, 1);
  const b = Number.isFinite(bounds.x0)
    ? { left: bounds.x0, top: bounds.y0, w: bounds.x1 - bounds.x0, h: bounds.y1 - bounds.y0 }
    : { left: 0, top: 0, w: rootSize[0], h: rootSize[1] };
  return { box, bounds: b };
}

function fitted(node, size, opts, memo) {
  const fit = Array.isArray(node.fit) ? node.fit : null;
  if (!fit) return size;
  return AXES.map((axis) => {
    if (fit[axis] === 2) return layoutSize(node, axis, opts, memo).pref;
    if (fit[axis] === 1) return layoutSize(node, axis, opts, memo).min;
    return size[axis];
  });
}

function place(node, rect, parent, px, py, opts, memo, bounds, alpha) {
  const r = rectOf(node, opts);
  const top = rect.y + rect.h;
  const ownAlpha = Number.isFinite(Number(node.alpha)) ? Number(node.alpha) : 1;
  const overAlpha = opts.pose?.alpha.has(node) ? Number(opts.pose.alpha.get(node)) : null;
  const a = overAlpha ?? ownAlpha;

  const box = {
    node,
    left: rect.x - px,
    top: py - top,
    w: rect.w,
    h: rect.h,
    pivot: r.pivot,
    alpha: a,
    shown: alpha > 0,
    text: node.text ? textOf(node, opts) : null,
    children: [],
  };
  const drawn = (node.image && (node.image.sprite || !node.image.external)) || node.text || node.raw;
  if (drawn && alpha * a > 0 && !opts.skip?.(node)) {
    bounds.x0 = Math.min(bounds.x0, rect.x);
    bounds.x1 = Math.max(bounds.x1, rect.x + rect.w);
    bounds.y0 = Math.min(bounds.y0, -top);
    bounds.y1 = Math.max(bounds.y1, -rect.y);
  }
  const driven = node.layout && (node.layout.axis === 'h' || node.layout.axis === 'v') ? arrange(node, rect.w, rect.h, opts, memo) : null;
  for (const child of node.children || []) {
    if (!isActive(child, opts) || opts.skip?.(child)) continue;
    let cr;
    const d = driven?.get(child);
    if (d) {

      cr = { x: rect.x + d.x, y: top - d.y - d.h, w: d.w, h: d.h };
    } else {
      const c = rectOf(child, opts);
      const size0 = AXES.map((axis) => (c.max[axis] - c.min[axis]) * (axis === 0 ? rect.w : rect.h) + c.size[axis]);
      const size = fitted(child, size0, opts, memo);
      const pivotAt = AXES.map((axis) => {
        const lo = (axis === 0 ? rect.x : rect.y) + c.min[axis] * (axis === 0 ? rect.w : rect.h);
        const hi = (axis === 0 ? rect.x : rect.y) + c.max[axis] * (axis === 0 ? rect.w : rect.h);
        return lo + (hi - lo) * c.pivot[axis] + c.pos[axis];
      });
      cr = { x: pivotAt[0] - c.pivot[0] * size[0], y: pivotAt[1] - c.pivot[1] * size[1], w: size[0], h: size[1] };
    }
    box.children.push(place(child, cr, box, rect.x, top, opts, memo, bounds, alpha * a));
  }
  void parent;
  return box;
}

// A slider is not a layout node: the prefab drives it by rewriting the fill and handle anchors, so the
// normalized value is replayed through pose.anchors (dir 0 L-R, 1 R-L, 2 B-T, 3 T-B).
export function applySliders(root, values, pose) {
  if (!values?.size) return pose;
  const byId = new Map();
  (function index(n) {
    if (Number.isInteger(n?.id)) byId.set(n.id, n);
    for (const c of n?.children || []) index(c);
  })(root);
  for (const [id, value] of values) {
    const n = byId.get(id);
    const s = n?.slider;
    if (!s) continue;
    const lo = num(s.min);
    const hi = num(s.max, 1);
    const t = hi > lo ? Math.min(1, Math.max(0, (num(value) - lo) / (hi - lo))) : 0;
    const dir = num(s.dir);
    const k = dir === 0 || dir === 1 ? 0 : 1;
    const reverse = dir === 1 || dir === 3;
    const fill = byId.get(s.fill);
    if (fill) {
      const min = [0, 0];
      const max = [1, 1];
      if (reverse) min[k] = 1 - t; else max[k] = t;
      pose.anchors.set(fill, { min, max });
    }
    const handle = byId.get(s.handle);
    if (handle) {
      const at = reverse ? 1 - t : t;
      const min = [0, 0];
      const max = [1, 1];
      min[k] = at;
      max[k] = at;
      pose.anchors.set(handle, { min, max });
    }
  }
  return pose;
}

export function scriptRef(from, field) {
  let hit = null;
  (function walk(n) {
    if (hit != null || !n) return;
    for (const s of n.scripts || []) {
      const v = s?.refs?.[field];
      if (Number.isInteger(v)) { hit = v; return; }
    }
    for (const c of n.children || []) walk(c);
  })(from);
  return hit;
}

export function nodeById(root, id) {
  if (!Number.isInteger(id)) return null;
  let hit = null;
  (function walk(n) {
    if (hit || !n) return;
    if (n.id === id) { hit = n; return; }
    for (const c of n.children || []) walk(c);
  })(root);
  return hit;
}

export function nodeByName(root, name) {
  let hit = null;
  (function walk(n) {
    if (hit || !n) return;
    if (n.name === name) { hit = n; return; }
    for (const c of n.children || []) walk(c);
  })(root);
  return hit;
}

