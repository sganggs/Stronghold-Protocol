

import { layoutPrefab } from '../../render/shop/uguiLayout.js';
import { UNITY_FONT_METRICS } from '../../render/shop/cardStage.js';

export const DESIGN_W = 1920;

export const DESIGN_H = 372;

export const PANEL_H = 286;

export function createMeasure() {
  if (typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');

  return (text, node) => {
    const t = (node && node.text) || {};
    const size = Number(t.fontSize) || 16;
    const family = t.font || 'NotoSansHans-Medium';
    ctx.font = `${size}px "${family}", "Noto Sans SC", sans-serif`;
    const m = ctx.measureText(String(text));
    const unity = UNITY_FONT_METRICS[family];
    const padding = unity ? unity.characterPadding * (size / unity.fontSize) : 0;
    const width = m.width + padding * String(text).length;
    const ascent = Number.isFinite(m.fontBoundingBoxAscent) ? m.fontBoundingBoxAscent : size * 1.05;
    const descent = Number.isFinite(m.fontBoundingBoxDescent) ? m.fontBoundingBoxDescent : size * 0.15;
    return { w: width, h: ascent + descent };
  };
}

function writeBack(node, box, parentW, parentH) {
  if (!node || !box) return;
  const rect = node.rect || (node.rect = {});
  const anchors = rect.anchors || { min: [0.5, 0.5], max: [0.5, 0.5] };
  const min = anchors.min || [0.5, 0.5];
  const max = anchors.max || [0.5, 0.5];
  const pivot = rect.pivot || [0.5, 0.5];
  const stretchW = parentW * (max[0] - min[0]);
  const stretchH = parentH * (max[1] - min[1]);
  const ax = parentW * (min[0] + (max[0] - min[0]) * pivot[0]);
  const ay = parentH * (min[1] + (max[1] - min[1]) * pivot[1]);
  const w = box.w;
  const h = box.h;
  rect.sizeDelta = [w - stretchW, h - stretchH];
  rect.anchoredPosition = [box.left - ax + pivot[0] * w, parentH - box.top - h + pivot[1] * h - ay];
}

export function layoutScene(panelRoot, opts = {}) {
  const width = Number(opts.width) || DESIGN_W;
  const height = Number(opts.height) || DESIGN_H;
  const stage = {
    name: 'shop_stage',
    path: 'shop_stage',
    active: true,
    rect: { anchors: { min: [0, 0], max: [0, 0] }, pivot: [0, 0], sizeDelta: [width, height], anchoredPosition: [0, 0] },
    children: [panelRoot],
  };
  const result = layoutPrefab(stage, { measure: opts.measure || undefined });
  const panelBox = result.box.children[0];
  if (panelBox) {
    const walk = (box, parentBox) => {
      writeBack(box.node, box, parentBox.w, parentBox.h);
      for (const child of box.children || []) walk(child, box);
    };

    walk(panelBox, result.box);
  }
  return { box: result.box, panelBox, bounds: result.bounds };
}
