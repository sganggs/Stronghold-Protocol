// Regression tests (Node) of user playtest #5, UI items (workstream W5):
//   8  the settings button's gear (bottom-left corner, next to 交流 / 📖 / ⛶) looked deformed: the hand-written path had
//      teeth of different sizes on a rim that was not round. It is now a regular 8-tooth gear (ui/gameComponents.js
//      gearPath): every vertex on the tip / root circle, 8-fold rotational and mirror symmetric, a centred round hole.
//      On phones the corner glyphs keep half the grown button (css/devices.css).
//   9  on phones in landscape the shop bar covered the lower part of the bench (整备区, row 7): the prep camera keeps
//      the bench / temp rows and the field's back row between the HUD bands (ui/fieldHost.js hudBands →
//      render/app.js → render/projection.js clearHud; the camera math itself: test/render/projection.test.js). The
//      bands mirror the CSS; here: the CSS rules they depend on, the wiring, and every bench / temp / back-row tile at
//      the phone viewports through the real hudBands. Browser measurement: test/ui/playtest5-ui.e2e.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unscaled } from '../helpers/uiSize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => unscaled(readFileSync(path.join(ROOT, p), 'utf8'));

const { GLYPHS, gearPath, GIcon } = await import('../../public/js/ui/gameComponents.js');
const { hudBands, HUD_REM } = await import('../../public/js/ui/fieldHost.js');
const { presetCamera, tileQuad } = await import('../../public/js/render/projection.js');

// ---- 8: the gear ----------------------------------------------------------------------------------------------------

/** Outer-contour vertices (endpoints of M / L / A commands before the first Z) and the arcs' radii of a gear path. */
function contour(d) {
  const outer = d.slice(0, d.indexOf('Z'));
  const pts = [];
  const radii = [];
  for (const m of outer.matchAll(/([MLA])([^MLAZ]+)/g)) {
    const n = m[2].trim().split(/[\s,]+/).map(Number);
    if (m[1] === 'A') { radii.push(n[0], n[1]); pts.push([n[5], n[6]]); } else pts.push([n[0], n[1]]);
  }
  return { pts, radii };
}

/** A regular gear: vertices on two circles about (12, 12), invariant under a 1/teeth turn and the mirror x → 24 − x. */
function regularGear(d, teeth = 8, eps = 0.03) {
  // absolute commands only (the old hand-written path used relative ones — not a generated gear at all)
  if (/[a-z]/.test(d.replace(/e-?\d/g, ''))) return false;
  const { pts } = contour(d);
  const r = pts.map(([x, y]) => Math.hypot(x - 12, y - 12));
  const rs = [...new Set(r.map((v) => v.toFixed(1)))];
  if (rs.length !== 2) return false;
  const has = ([x, y]) => pts.some(([u, v]) => Math.abs(u - x) < eps && Math.abs(v - y) < eps);
  const a = (2 * Math.PI) / teeth;
  for (const [x, y] of pts) {
    const dx = x - 12, dy = y - 12;
    if (!has([12 + dx * Math.cos(a) - dy * Math.sin(a), 12 + dx * Math.sin(a) + dy * Math.cos(a)])) return false;
    if (!has([24 - x, y])) return false;
  }
  return true;
}

describe('8: the settings gear is a clean, regular icon', () => {
  const OLD = 'M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.8c.1.6.1 1.2 0 1.8l2 1.8-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9L2 14.9l2-1.8a6 6 0 0 1 0-1.8L2 9.5l1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9zM12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z';

  test('reproduction: the v2.3 path was not a regular gear', () => {
    assert.equal(regularGear(OLD), false);
  });

  test('the gear glyph: 8 teeth, every vertex on the tip (r 10) or root (r 7.4) circle, rotational + mirror symmetric', () => {
    assert.equal(GLYPHS.gear, gearPath());
    assert.ok(regularGear(GLYPHS.gear), GLYPHS.gear);
    const { pts, radii } = contour(GLYPHS.gear);
    assert.equal(pts.length, 1 + 8 * 4, 'start + 4 vertices per tooth');
    const rs = pts.map(([x, y]) => Math.hypot(x - 12, y - 12));
    assert.ok(Math.min(...rs) > 7.38 && Math.max(...rs) < 10.02, `${Math.min(...rs)}..${Math.max(...rs)}`);
    assert.deepEqual([...new Set(radii)].sort(), ['10', '7.4'].map(Number).sort());
    // inside the 24 × 24 box, centred: the same extent as the 📖 glyph next to it (x 2–22)
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    assert.ok(Math.min(...xs) >= 2 && Math.max(...xs) <= 22 && Math.min(...ys) >= 2 && Math.max(...ys) <= 22);
    assert.ok(Math.abs(Math.min(...xs) + Math.max(...xs) - 24) < 0.02 && Math.abs(Math.min(...ys) + Math.max(...ys) - 24) < 0.02);
    // the hole: a circle of r 3.3 about the centre (even-odd)
    assert.match(GLYPHS.gear, /ZM12 8\.7A3\.3 3\.3 0 1 0 12 15\.3A3\.3 3\.3 0 1 0 12 8\.7Z$/);
    // other gear shapes stay regular too (the generator, not one lucky constant)
    assert.ok(regularGear(gearPath({ teeth: 6, tipW: 3.6, rootW: 5 }), 6));
  });

  test('GIcon draws it as an even-odd 24 × 24 SVG path', () => {
    const v = GIcon({ name: 'gear' });
    assert.equal(v.type, 'svg');
    assert.equal(v.props.viewBox, '0 0 24 24');
    const p = [v.props.children].flat(3).find((c) => c && c.type === 'path');
    assert.equal(p.props.d, GLYPHS.gear);
    assert.equal(p.props['fill-rule'], 'evenodd');
  });

  test('phones: the corner glyphs keep half of the grown 34 px buttons (not an 11 px glyph)', () => {
    const css = read('public/css/devices.css');
    const phone = css.slice(css.indexOf('@media (max-height: 600px) and (pointer: coarse)'));
    const block = phone.slice(0, phone.indexOf('\n}\n'));
    assert.match(block, /\.gm__gear \{ width: max\(\.56rem, 34px\); height: max\(\.56rem, 34px\); \}/);
    assert.match(block, /\.gm__corner \.gm__gear \.icon \{ width: max\(\.28rem, 17px\); height: max\(\.28rem, 17px\); \}/);
    // desktop: .28rem in a .56rem button — the same half
    assert.match(read('public/css/screens/game.css'), /\.gm__gear \.icon \{ width: \.28rem; height: \.28rem; \}/);
  });
});

// ---- 9: the bench stays clear of the shop bar on phones -------------------------------------------------------------

/** Root font size of css/theme.css: clamp(40px, min(100vw / 19.2, 100vh / 10.8), 240px). */
const remAt = (w, h) => Math.max(40, Math.min(w / 19.2, h / 10.8, 240));

/** Run `fn` with a stubbed DOM: the root font size, and the HUD layer's top (safe-area inset). */
function withDom(rem, hudTop, fn, bondsBottom = 0) {
  const g = globalThis;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  g.getComputedStyle = () => ({ fontSize: `${rem}px` });
  g.document = { documentElement: {}, querySelector: (s) => s === '.gm__hud'
    ? { getBoundingClientRect: () => ({ top: hudTop }) }
    : s === '.gm__bonds' && bondsBottom ? { getBoundingClientRect: () => ({ bottom: bondsBottom, height: 44 }) } : null };
  try { return fn(); } finally { g.document = saved.document; g.getComputedStyle = saved.getComputedStyle; }
}

describe('9: the prep camera keeps the bench clear of the shop bar on phones in landscape', () => {
  test('HUD_REM mirrors the CSS it measures (bond strip bottom, shop bar top, the notched-phone rule)', () => {
    const game = read('public/css/screens/game.css');
    const shop = read('public/css/screens/game-shop.css');
    // #678: clip padding is offset by margins; the 44 px arrows can still raise the band on phones.
    assert.match(game, /\.gm__bonds \{ position: absolute; left: 1\.56rem; top: 1\.36rem;/);
    assert.match(game, /\.bslot \.bond \{ --disc: \.52rem; \}/);
    assert.match(game, /\.gm__bonds \.bstrip-scroll \.bstrip \{[^}]*padding: \.08rem 0; margin: -\.08rem 0;/);
    assert.match(game, /\.gm__bonds \.bstrip-scroll__arrow \{[^}]*height: 44px;/);
    assert.equal(HUD_REM.bondStripTop, 1.36);
    assert.equal(HUD_REM.bondStripBottom, 2.16);
    assert.equal(HUD_REM.bondArrowPx, 44);
    // shop bar: bottom .2rem + row padding .1rem × 2 + 2.24rem cards (level / operator / item) + 2 px + 1 px borders
    assert.match(shop, /\.shopbar \{\n {2}position: absolute; right: \.26rem; bottom: \.2rem;/);
    assert.match(shop, /\.shopbar__row \{\n {2}position: relative; display: flex; align-items: stretch; gap: \.08rem; padding: \.1rem;\n[^}]*border: 1px solid var\(--line-2\); border-top: 2px solid var\(--mint-700\);/);
    assert.match(shop, /\.lvcard \{\n {2}position: relative; width: 1\.24rem; height: 2\.24rem;/);
    assert.match(shop, /\.scard \{\n {2}--tc: var\(--tier-1\);\n {2}position: relative; width: 1\.56rem; height: 2\.24rem;/);
    assert.equal(HUD_REM.shopBarTop, 0.2 + 0.1 * 2 + 2.24);
    assert.equal(HUD_REM.shopBarBorderPx, 3);
    // the bar stays on the viewport's bottom edge on a notched phone (DESIGN §18.1): no bottom inset to add
    assert.match(read('public/css/devices.css'), /\.gm__hud > \.shopbar \{ bottom: calc\(\.2rem - var\(--sa-b\)\); \}/);
  });

  test('hudBands: prep / Final Assault prep only; rem-scaled; below the top safe-area inset; clamped', () => {
    withDom(40, 0, () => {
      for (const k of ['normal', 'unite', 'boss', 'hidden', 'pen']) assert.equal(hudBands(k, { width: 844, height: 390 }), null, k);
      for (const k of ['prep', 'bossPrep']) {
        const b = hudBands(k, { width: 844, height: 390 });
        assert.ok(Math.abs(b.top - 98.4) < 1e-9 && Math.abs(b.bottom - 108.6) < 1e-9, `${k} ${JSON.stringify(b)}`);
      }
    });
    withDom(100, 0, () => assert.deepEqual(hudBands('prep', { width: 1920, height: 1080 }), { top: 216, bottom: 267 }));
    withDom(40, 12, () => assert.ok(Math.abs(hudBands('prep', { width: 844, height: 390 }).top - 110.4) < 1e-9, 'top inset'));
    withDom(40, 0, () => assert.deepEqual(hudBands('prep', { width: 640, height: 200 }), { top: 80, bottom: 80 }, 'clamped at 40 % of the height'));
  });

  test('a taller measured scroller is kept clear; a collapsed strip keeps the minimum band', () => {
    const size = { width: 844, height: 390 };
    withDom(40, 12, () => assert.equal(hudBands('prep', size).top, 124), 124);
    withDom(40, 12, () => assert.ok(Math.abs(hudBands('prep', size).top - 110.4) < 1e-9), 90);
  });

  test('wiring: the game hands hudBands to the view, the view to the prep cameras', () => {
    assert.match(read('public/js/ui/fieldHost.js'), /padding: hudPadding, hud: hudBands \}/);
    const app = read('public/js/render/app.js');
    // (the folded shop's band since public issue #5: test/ui/issue5-fold-camera.test.js)
    assert.match(app, /hud: hudBands\(vk, sz, \{ shop: o\.shop \?\? true \}\),/);
    assert.match(app, /presetCamera\('prep', \{ width: s0\.width, height: s0\.height, padding: defaultPadding\('prep', s0\) \}, \{ hud: hudBands\('prep', s0\) \}\)/);
  });

  // phones in landscape (CSS px) incl. the user's Android: its 2772×1272 px screenshot shows the page right of a 141 px
  // black cutout band, 2631×1272 px at DPR ≈ 3.48 = 756×366 (798×366 had the page covered the cutout too)
  const PHONES = [[844, 390], [932, 430], [915, 412], [914, 411], [800, 360], [960, 411], [756, 366], [798, 366], [924, 424]];
  const stage = JSON.parse(read('data/stages.json')).act2autochess_m01;
  const H = { h: 0.42, '#': 0.3, X: 0.55, a: 0.16, A: 0.16 }; // render/style.js TILE_H by glyph
  const heightAt = (r, c) => H[stage.rows[r]?.[c]] ?? 0; // rows[0] = the bottom row (DATA.md)

  /** Screen y extent of the bench (row 7 / boss row 0), temp (8 / 1) and back row (12 / 5) tile tops. */
  function extents(cam, rows) {
    const ys = (r, c0, c1) => { const out = []; for (let c = c0; c <= c1; c++) for (const p of tileQuad(cam, r, c, heightAt(r, c))) out.push(p.y); return out; };
    return { benchBottom: Math.max(...ys(rows.bench, 0, 9)), tempBottom: Math.max(...ys(rows.temp, 4, 8)), backTop: Math.min(...ys(rows.back, 4, 10)) };
  }

  test('reproduction + fix: at every phone viewport every bench / temp tile ends above the shop bar, the back row below the bond strip', () => {
    assert.ok(stage, 'stage act2autochess_m01');
    for (const [w, h] of PHONES) {
      const rem = remAt(w, h);
      const shopTop = h - (HUD_REM.shopBarTop * rem + 3);
      for (const [kind, rows] of [['prep', { bench: 7, temp: 8, back: 12 }], ['bossPrep', { bench: 0, temp: 1, back: 5 }]]) {
        const hud = withDom(rem, 0, () => hudBands(kind, { width: w, height: h }));
        const before = extents(presetCamera(kind, { width: w, height: h }), rows);
        const after = extents(presetCamera(kind, { width: w, height: h }, { hud }), rows);
        const tag = `${kind} ${w}×${h}`;
        if (w <= 844) assert.ok(before.benchBottom > shopTop + 5, `${tag}: v2.3 bench under the shop bar (${before.benchBottom} vs ${shopTop})`);
        assert.ok(after.benchBottom <= shopTop + 1e-6, `${tag}: bench ${after.benchBottom} ≤ shop bar ${shopTop}`);
        assert.ok(after.tempBottom < after.benchBottom, `${tag}: temp row above the bench`);
        assert.ok(after.backTop >= hud.top - 1e-6, `${tag}: back row ${after.backTop} ≥ bond strip ${hud.top}`);
      }
    }
  });
});
