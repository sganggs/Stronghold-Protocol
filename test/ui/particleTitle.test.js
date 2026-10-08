// Unit tests for the title screen's particle logo helpers (public/js/ui/particleTitle.js): the vertical
// layout mirrors css/screens/title.css, the emblem geometry is the original dot matrix (every dot's
// particle cluster must reproduce its SVG circle 1:1), planStep caps the particle count, collectTargets
// samples RGBA coverage at the device-pixel ratio, and a canvas without a 2D context is a clean no-op.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TITLE_LINES, TITLE_PAD, EMBLEM, layoutTitle, emblemDots, emblemBox, emblemParticles, emblemRow,
  planStep, collectTargets, createParticleTitle, Particle,
} from '../../public/js/ui/particleTitle.js';

/** Synthetic RGBA image; `alphaAt(x, y)` decides each pixel's alpha, colour = (10, 200, 30). */
function image(w, h, alphaAt) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 10; data[i + 1] = 200; data[i + 2] = 30; data[i + 3] = alphaAt(x, y);
    }
  }
  return data;
}

describe('particleTitle layout', () => {
  test('mirrors the title.css English line sizes and keeps the lines in order', () => {
    const { lines, textHeight, height } = layoutTitle(100);
    assert.equal(TITLE_LINES.length, 2, 'emblem + English lines only; the Chinese title is DOM');
    assert.equal(lines.length, TITLE_LINES.length);
    assert.equal(lines[0].sizePx, 34);
    assert.equal(lines[1].sizePx, 38);
    assert.ok(lines[0].cy < lines[1].cy, 'lines top to bottom');
    // 34 + 2 + 38 = 74 (+ the 2×TITLE_PAD scatter margin)
    assert.ok(Math.abs(textHeight - 74) < 0.01, `textHeight ${textHeight}`);
    assert.ok(Math.abs(height - (74 + 2 * TITLE_PAD * 100)) < 0.01, `height ${height}`);
    assert.match(lines[1].fontSpec, /^700 38px/);
    assert.ok(lines[1].trackingPx > lines[0].trackingPx, 'ALLIANCE is tracked wider');
  });
});

describe('particleTitle emblem', () => {
  test('dot matrix (original): 140 dots, four mint accents, radii grow toward the base', () => {
    const dots = emblemDots();
    assert.equal(EMBLEM.length, 14);
    assert.ok(EMBLEM.every((row) => row.length === 13), '13 columns');
    assert.equal(dots.length, 140);
    assert.equal(dots.filter((d) => d.accent).length, 4);
    assert.ok(dots.every((d) => d.r >= 0.2 && d.r <= 0.4 && d.d >= 0 && d.d < 7));
    const top = dots.find((d) => d.cy === 0.5);
    const bottom = dots.find((d) => d.cy === 13.5);
    assert.ok(Math.abs(top.r - 0.2) < 1e-9 && Math.abs(bottom.r - 0.4) < 1e-9, 'the original radius ramp');
  });

  test('the emblem box is the original 1.3rem × 1.4rem svg box, centred in its bracket row', () => {
    const row = emblemRow(1000, 100);
    const box = emblemBox(1000, 100);
    assert.equal(box.boxW, 130);
    assert.equal(box.boxH, 140);
    assert.equal(box.left, 435);
    assert.ok(Math.abs(box.top - 40) < 1e-9, 'top = (TITLE_PAD + (1.7 − 1.4) / 2) rem');
    assert.ok(Math.abs(box.scale - 130 / 14) < 1e-9, 'viewBox is 14 user units wide');
    assert.ok(Math.abs(box.top + box.boxH / 2 - (row.top + row.height / 2)) < 1e-9, 'centred in the row');
  });

  test('every dot is a particle cluster that fits its original circle exactly (1:1)', () => {
    const remPx = 100;
    const width = 1000;
    const box = emblemBox(width, remPx);
    const parts = emblemParticles(remPx, width, () => 0.5);
    const dots = emblemDots().map((d) => ({
      x: box.left + (d.cx + 0.5) * box.scale,
      y: box.top + (d.cy + 0.5) * box.scale,
      R: d.r * box.scale,
      accent: d.accent,
    }));
    const covered = new Set();
    for (const p of parts) {
      let best = null;
      dots.forEach((d, i) => {
        const dist = Math.hypot(p.x - d.x, p.y - d.y);
        if (!best || dist < best.dist) best = { i, d, dist };
      });
      assert.ok(best.dist <= best.d.R + 1e-9, `cluster centre stays inside its dot (dist ${best.dist} > R ${best.d.R})`);
      assert.ok(best.dist + p.size / 2 <= best.d.R + 1e-6, 'the rendered dot never grows past the original radius');
      covered.add(best.i);
      if (best.d.accent) assert.deepEqual([p.r, p.g, p.b], [23, 249, 183]);
      else assert.deepEqual([p.r, p.g, p.b], [223, 230, 226]);
    }
    assert.equal(covered.size, dots.length, 'every dot has particles');
  });

  test('dots too small for a cluster render as one particle of exactly the dot diameter', () => {
    const remPx = 40;
    const width = 400;
    const box = emblemBox(width, remPx);
    const smallest = 0.2 * box.scale;
    const parts = emblemParticles(remPx, width, () => 0.25);
    assert.ok(parts.some((p) => Math.abs(p.size - smallest * 2) < 1e-9), 'a single-particle dot exists');
  });

  test('the bracket row is centred around the dot box', () => {
    const row = emblemRow(1000, 100);
    assert.ok(Math.abs(row.rowW - 214) < 1e-9, '(2·0.16 + 2·0.26 + 1.3) rem');
    assert.equal(row.left, 393);
    assert.equal(row.bracketW, 16);
    assert.equal(row.top, 25);
    assert.equal(row.height, 170);
  });
});

describe('particleTitle sampling', () => {
  test('planStep keeps a full grid under the particle cap', () => {
    const w = 100;
    const h = 100;
    const data = image(w, h, () => 255);
    const step = planStep(data, w, h, 400);
    assert.equal(step, 5);
    assert.ok(collectTargets(data, w, h, step).length <= 400);
  });

  test('planStep never goes below 2 and ignores faint pixels', () => {
    const data = image(10, 10, () => 40); // below the coverage threshold
    assert.equal(planStep(data, 10, 10, 10), 2);
    assert.equal(collectTargets(data, 10, 10, 2).length, 0);
  });

  test('collectTargets samples coverage, colour and the device-pixel scale', () => {
    const data = image(4, 2, (x, y) => (x === 1 && y === 1 ? 255 : 0));
    const out = collectTargets(data, 4, 2, 1, 2);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], { x: 0.75, y: 0.75, r: 10, g: 200, b: 30, a: 1 });
  });

  test('a canvas without a 2D context is a clean no-op', () => {
    assert.equal(createParticleTitle(null), null);
    assert.equal(createParticleTitle({ getContext: () => null }), null);
  });
});

describe('particleTitle rebuild', () => {
  test('retarget follows the new raster: position, alpha, size and colour', () => {
    const orig = Math.random;
    Math.random = () => 0.5; // deterministic: the colour jitter and the twinkle phase are rolled once
    try {
      // emblem:true pins the colour path (no spark roll), so the expectations are exact
      const p = new Particle({ x: 1, y: 2, r: 0, g: 0, b: 0, a: 1, size: 3, emblem: true }, null);
      assert.equal(p.css, 'rgb(0,0,0)');
      p.retarget({ x: 9, y: 8, r: 255, g: 255, b: 255, a: 0, size: 5, emblem: true });
      assert.equal(p.tx, 9);
      assert.equal(p.ty, 8);
      assert.equal(p.size, 5);
      assert.equal(p.a0, 0.45);
      assert.equal(p.css, 'rgb(252,252,252)'); // 255 × (0.94 + 0.5·0.1) rounded
    } finally {
      Math.random = orig;
    }
  });
});
