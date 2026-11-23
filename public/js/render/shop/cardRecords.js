// The flat record list cardStage draws: absolute boxes in prefab units (top-down y), the clip/soft-mask/
// stencil state inherited down the tree, and the pose the timeline writes into.
import { createClipPose } from './cardTimeline.js';

export function cardSize(card) {
  const size = (card && Array.isArray(card.size) && card.size) || null;
  const rect = card && card.root && card.root.rect;
  const delta = rect && Array.isArray(rect.sizeDelta) ? rect.sizeDelta : null;
  const num = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && value !== null && value !== undefined ? n : fallback;
  };
  return [
    num(size ? size[0] : null, num(delta ? delta[0] : null, 157)),
    num(size ? size[1] : null, num(delta ? delta[1] : null, 207)),
  ];
}

// uGUI anchors: when min != max the size follows the parent (parent * (max - min) + sizeDelta), the pivot
// sits at min + (max - min) * pivot, and the returned y is already flipped to the card top-down space. This is
// the only y flip in the pipeline.
export function place(node, parent, sizeOverride) {
  const r = (node && node.rect) || {};
  const anchors = r.anchors || { min: [0.5, 0.5], max: [0.5, 0.5] };
  const min = anchors.min || [0.5, 0.5];
  const max = anchors.max || [0.5, 0.5];
  const pivot = r.pivot || [0.5, 0.5];
  const sizeDelta = sizeOverride || r.sizeDelta || [0, 0];
  const pos = r.anchoredPosition || [0, 0];
  const w = Math.abs(max[0] - min[0]) > 1e-6 ? parent.w * (max[0] - min[0]) + sizeDelta[0] : sizeDelta[0];
  const h = Math.abs(max[1] - min[1]) > 1e-6 ? parent.h * (max[1] - min[1]) + sizeDelta[1] : sizeDelta[1];

  const ax = parent.w * (min[0] + (max[0] - min[0]) * pivot[0]);
  const ay = parent.h * (min[1] + (max[1] - min[1]) * pivot[1]);
  return { x: ax + pos[0] - pivot[0] * w, y: parent.h - (ay + pos[1] - pivot[1] * h + h), w, h };
}

export function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

export function levelStyle(card, tier) {
  const levels = (card && card.driver && card.driver.levels) || [];
  return levels.find((l) => (l.tiers || []).includes(tier)) || levels[0] || {};
}

export function findNode(root, name) {
  if (!root) return null;
  if (root.name === name) return root;
  for (const child of root.children || []) {
    const hit = findNode(child, name);
    if (hit) return hit;
  }
  return null;
}

export function buildRecords(tree, card, opts = {}) {
  const [CARD_W, CARD_H] = Array.isArray(opts.size) && opts.size.length === 2 ? opts.size : cardSize(card);
  const records = [];
  const byPath = new Map();
  const order = [];

  function walk(node, parentBox, origin, scopes, parentActive, parentRec) {

    if (node.text) {
      node.text = {
        bestFit: false,
        minSize: 1,
        maxSize: Number(node.text.fontSize) || 16,
        ...node.text,
      };
    }
    const box = parentBox ? place(node, parentBox) : { x: 0, y: 0, w: CARD_W, h: CARD_H };

    const pivot = (node.rect && node.rect.pivot) || [0.5, 0.5];
    // scale.y < 0 mirrors about the pivot, so the box origin moves by h * (1 - 2 * pivot.y) (fx_loop / fx_outline:
    // pivot.y = 1, scale.y = -1). Without the term they draw off the card.
    const mirroredY = Number((node.scale || [1, 1, 1])[1]) < 0;
    const abs = {
      x: origin.x + box.x,
      y: origin.y + box.y + (mirroredY ? box.h * (1 - 2 * pivot[1]) : 0),
      w: box.w,
      h: box.h,
    };
    const classes = (node.components || []).map((c) => c.class);
    const active = parentActive && node.active !== false;
    const next = { ...scopes };
    if (classes.includes('RectMask2D')) {
      const clip = scopes.clip ? intersect(scopes.clip, abs) : { ...abs };
      next.clip = clip;
    }
    if (classes.includes('SoftMask')) {
      const comp = (node.components || []).find((c) => c.class === 'SoftMask');
      const soft = (node.mask && node.mask.soft) || {};
      next.softMask = {
        // card_prefab.py _soft_mask: a picture sampled in card space with per-channel weights. The fallback picture and
        // the R-channel weights are the official mask_char_portrait.png, which is why a rectangular mask is wrong here.
        file: soft.file || 'sprites/mask_char_portrait.png',
        rect: { ...abs },
        weights: (comp.fields && comp.fields._channelWeights) || soft.weights || { r: 1, g: 0, b: 0, a: 0 },
      };
    }
    let stencil = null;
    let stencilRead = false;
    if (classes.includes('UIStencilComponent')) {
      const comp = (node.components || []).find((c) => c.class === 'UIStencilComponent');
      const f = comp.fields || {};
      const write = Number(f._writeChannel) > 0;
      stencil = { mode: write ? 'write' : 'read' };
      stencilRead = !write;
    }

    let slice = null;
    const imageFields = node.image || null;
    if (imageFields && imageFields.type === 'sliced' && Array.isArray(imageFields.slice) && imageFields.slice.length === 4) {
      const [top, right, bottom, left] = imageFields.slice.map(Number);
      if (top || right || bottom || left) {
        slice = { top, right, bottom, left, spriteW: Number(imageFields.w) || 0, spriteH: Number(imageFields.h) || 0 };
      }
    }
    const rec = {
      node,
      active,
      abs,
      slice,
      mirroredY,
      // UIRawImage node: cardStage raw-UV branch and the confirm-sweep alpha special case both key off this.
      rawUv: !!node.raw,
      children: [],
      sizePosed: false,
      clipRect: next.clip || null,
      softMask: next.softMask || null,
      stencil,
      stencilRead,
      stencilClear: false,
      pose: createClipPose(),

      parent: parentRec,
      pos: (node.rect && node.rect.anchoredPosition) || [0, 0],
      group: classes.includes('CanvasGroup'),
      delta: { x: 0, y: 0 },
      inheritAlpha: 1,
      inheritScale: [1, 1],
    };
    records.push(rec);
    order.push(rec);
    if (parentRec) parentRec.children.push(rec);
    byPath.set(node.path || node.name, rec);
    for (const child of node.children || []) walk(child, { w: box.w, h: box.h }, abs, next, active, rec);
    if (classes.includes('UIStencilCleaner')) {
      const clear = {
        node, abs, slice: null, active, clipRect: next.clip || null, stencil: null, stencilRead: false, stencilClear: true, pose: {},
        parent: parentRec, pos: [0, 0], group: false, delta: { x: 0, y: 0 }, inheritAlpha: 1, inheritScale: [1, 1],
      };
      records.push(clear);
      order.push(clear);
    }
  }

  walk(tree, null, { x: 0, y: 0 }, { clip: null, softMask: null }, true, null);
  return { records, order, byPath: (path) => byPath.get(path) || null, paths: () => byPath.keys(), root: tree };
}

export function visibleRecords(records, only = [], skip = []) {
  return records.order.filter((rec) => (!only.length || only.includes(rec.node.name)) && !skip.includes(rec.node.name));
}

export function syncActive(node, records, parentActive) {
  const active = parentActive && node.active !== false;
  for (const rec of records.order) if (rec.node === node) rec.active = active;
  for (const child of node.children || []) syncActive(child, records, active);
}

export function propagateTransforms(records) {
  for (const rec of records.order) {
    const parent = rec.parent || null;
    const pose = rec.pose || {};
    const base = rec.pos || [0, 0];
    const pDelta = parent ? parent.delta : { x: 0, y: 0 };
    // x and y need opposite signs: y flips because the boxes are top-down, x does not. ShopScene pre-reflects
    // pose.ax (2 * rest - ax) so x also yields clipValue - rest; switching to ax - rest here would double-negate
    // every shop clip's horizontal movement.
    rec.delta = {
      x: pDelta.x + (pose.ax != null ? base[0] - pose.ax : 0),
      y: pDelta.y + (pose.ay != null ? base[1] - pose.ay : 0),
    };

    const parentGroup = parent && parent.group ? (parent.pose.alpha != null ? parent.pose.alpha : 1) : 1;
    rec.inheritAlpha = (parent ? parent.inheritAlpha : 1) * parentGroup;
    const parentScale = parent ? parent.inheritScale || [1, 1] : [1, 1];
    const parentPoseScale = parent && parent.pose.scale ? parent.pose.scale : [1, 1, 1];
    const sx = Number(parentPoseScale[0]);
    const sy = Number(parentPoseScale[1]);
    rec.inheritScale = [
      parentScale[0] * (Number.isFinite(sx) ? sx : 1),
      parentScale[1] * (Number.isFinite(sy) ? sy : 1),
    ];
    // A rotated node rotates its whole subtree (uGUI localRotation): the refresh button's additive arrow
    // (root_special/icon/icon_add) must turn with root_special/icon it sits in, not stay behind it.
    const ownRot = (Number(rec.node.rot) || 0) + (pose.rot != null ? Number(pose.rot) : 0);
    const parentRot = parent ? Number(parent.rotTotal) || 0 : 0;
    rec.rotTotal = parentRot + ownRot;
    // ...and it turns AROUND THE PARENT'S PIVOT, not its own: icon_add sits 2.94 px off the icon's pivot, so
    // orbiting its own centre instead leaves it up to 5.89 px off at half a turn. `rotOrigin` is that pivot in
    // canvas units (node pivot of the outermost rotated ancestor, after its own delta).
    if (parent && parentRot !== 0) {
      if (parent.rotOrigin) rec.rotOrigin = parent.rotOrigin;
      else {
        const pp = (parent.node.rect && parent.node.rect.pivot) || [0.5, 0.5];
        // An auto-clip target turns around its sprite's ring centre (centerRot, normalized), so its children
        // orbit that point instead of the rect centre.
        const cr = parent.node && parent.node.centerRot;
        rec.rotOrigin = cr
          ? [
            parent.abs.x + pDelta.x + (Array.isArray(cr) ? cr[0] : 0.5) * parent.abs.w,
            parent.abs.y + pDelta.y + (Array.isArray(cr) ? cr[1] : 0.5) * parent.abs.h,
          ]
          : [
            parent.abs.x + pDelta.x + pp[0] * parent.abs.w,
            parent.abs.y + pDelta.y + pp[1] * parent.abs.h,
          ];
      }
    } else {
      rec.rotOrigin = null;
    }
  }
}

export function relayoutAnimatedSizes(records, card) {
  const [CARD_W, CARD_H] = cardSize(card);
  for (const rec of records.order) {
    const posed = !!(rec.pose && (rec.pose.h != null || rec.pose.w != null));
    if (!posed && !rec.sizePosed) continue;
    const parent = rec.parent || null;
    layoutRecord(rec,
      parent ? { w: parent.abs.w, h: parent.abs.h } : { w: CARD_W, h: CARD_H },
      parent ? { x: parent.abs.x, y: parent.abs.y } : { x: 0, y: 0 });
    rec.sizePosed = posed;
  }
}

export function layoutRecord(rec, parentBox, origin) {
  const r = rec.node.rect || {};
  const size = r.sizeDelta || [0, 0];
  const posed = rec.pose && (rec.pose.w != null || rec.pose.h != null);
  const override = posed ? [rec.pose.w != null ? rec.pose.w : size[0], rec.pose.h != null ? rec.pose.h : size[1]] : null;
  const box = place(rec.node, parentBox, override);
  const pivot = (r.pivot) || [0.5, 0.5];
  const mirroredY = Number((rec.node.scale || [1, 1, 1])[1]) < 0;
  rec.abs = {
    x: origin.x + box.x,
    y: origin.y + box.y + (mirroredY ? box.h * (1 - 2 * pivot[1]) : 0),
    w: box.w,
    h: box.h,
  };
  for (const child of rec.children || []) layoutRecord(child, { w: box.w, h: box.h }, rec.abs);
}

