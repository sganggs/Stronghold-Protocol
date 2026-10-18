// Public issue #5 (v0.1.1): "准备阶段，收起商店界面时，界面并不会进行缩放（观战及作战时无此现象）" — folding the shop (收起) in prep
// left the own board at the shop camera. Now the own prep board takes the official shop-collapsed camera
// (configBlackBoard left_prepare_camera_param / *_boss_prepare_*) while the shop bar is shown folded, keeping the bench
// above the folded shop's HUD band (the tab and the corner buttons' hit areas), and returns to the shop camera when it is
// unfolded; never over the pen, a teammate's board or a battle; deferred during a drag or the direction step.
//   gameLogic prepCameraFor / foldCamera (the choice), ui/fieldHost.js hudBands(kind, size, { shop: false }) (the band),
//   render/app.js (the band follows the request's `shop`), screens/game.js (the effect), css/devices.css (one-row corner).
// Browser measurement: the headless-Chrome checks of DESIGN §21 (fold / unfold at 1920×1080, 844×390, 756×366).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const { prepCameraFor, foldCamera, prepCamera } = await import('../../public/js/ui/gameLogic.js');
const { hudBands, HUD_REM } = await import('../../public/js/ui/fieldHost.js');
const { presetCamera, tileQuad } = await import('../../public/js/render/projection.js');

const pl = (id, seat, alive = true) => ({ playerId: id, seat, alive });
const pubAt = (round, players = [pl('a', 0), pl('b', 1)]) => ({ round, bossRound: 14, hiddenRound: 15, players });

describe('the camera choice (gameLogic prepCameraFor / foldCamera)', () => {
  test('prepCameraFor: the own prep camera with the shop state — open = shop camera, folded = shop-collapsed', () => {
    assert.deepEqual(prepCameraFor(pubAt(6), 'a'), { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: true } });
    assert.deepEqual(prepCameraFor(pubAt(6), 'a', true), { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false } });
    // the Final Assault prep: the player's half of the boss field, with the same flag
    assert.deepEqual(prepCameraFor(pubAt(14), 'b', true), { kind: 'bossPrep', opts: { side: 'R', shop: false } });
    assert.deepEqual(prepCameraFor(pubAt(14), 'a'), { kind: 'bossPrep', opts: { side: 'L', shop: true } });
    // everything but the flag is prepCamera's
    for (const [pub, me] of [[pubAt(3), 'a'], [pubAt(15), 'b'], [null, 'a']]) {
      const { shop, ...rest } = prepCameraFor(pub, me, true).opts;
      assert.equal(shop, false);
      assert.deepEqual(rest, prepCamera(pub, me).opts);
    }
  });

  const base = { pub: pubAt(6), myId: 'a', ownPrep: true, pen: false, busy: false };
  const open = { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: true } };
  const folded = { kind: 'prep', opts: { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false } };

  test('foldCamera: a fold asks for the shop-collapsed camera, an unfold for the shop camera again, else nothing', () => {
    assert.deepEqual(foldCamera({ ...base, folded: true, current: open }), folded);
    assert.deepEqual(foldCamera({ ...base, folded: false, current: folded }), open);
    assert.equal(foldCamera({ ...base, folded: true, current: folded }), null, 'already folded');
    assert.equal(foldCamera({ ...base, folded: false, current: open }), null, 'already open');
    // a request made before this rule (no shop flag) counts as the shop camera
    assert.equal(foldCamera({ ...base, folded: false, current: { kind: 'prep', opts: { side: 'L' } } }), null);
    assert.deepEqual(foldCamera({ ...base, folded: true, current: { kind: 'prep', opts: { side: 'L' } } }), folded);
  });

  test('foldCamera: own prep board only — not a teammate\'s board, a battle, the pen', () => {
    assert.equal(foldCamera({ ...base, ownPrep: false, folded: true, current: open }), null, 'scouting / battle / observer');
    assert.equal(foldCamera({ ...base, pen: true, folded: true, current: open }), null, 'the pen folds the shop itself');
    assert.equal(foldCamera(null), null);
  });

  test('foldCamera: deferred while a piece is dragged or its direction is chosen, applied once that ends', () => {
    const s = { ...base, folded: true, current: open };
    assert.equal(foldCamera({ ...s, busy: true }), null, 'drag / wheel in progress: the camera stays');
    assert.deepEqual(foldCamera({ ...s, busy: false }), folded, 'the effect runs again when busy clears');
  });

  test('foldCamera: the Final Assault prep half follows the fold too', () => {
    const want = foldCamera({ ...base, pub: pubAt(14), myId: 'b', folded: true, current: { kind: 'bossPrep', opts: { side: 'R', shop: true } } });
    assert.deepEqual(want, { kind: 'bossPrep', opts: { side: 'R', shop: false } });
  });
});

// ---- the folded shop's HUD band (ui/fieldHost.js hudBands) ----------------------------------------------------------

/** Root font size of css/theme.css: clamp(40px, min(100vw / 19.2, 100vh / 10.8), 240px). */
const remAt = (w, h) => Math.max(40, Math.min(w / 19.2, h / 10.8, 240));

/**
 * Run `fn` with a stubbed DOM: root font size, the HUD layer's rect (safe-area insets), the corner buttons (client-px
 * rects, or none) and whether the pointer is coarse (`sp-coarse`, --tap-min 44 px).
 */
function withDom({ rem, hudTop = 0, hudBottom = null, corner = null, coarse = false }, fn) {
  const g = globalThis;
  const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
  const root = { classList: { contains: (c) => c === 'sp-coarse' && coarse } };
  g.getComputedStyle = (el) => ({ fontSize: `${rem}px`, getPropertyValue: (p) => (el === root && p === '--tap-min' ? ' 44px' : '') });
  g.document = {
    documentElement: root,
    querySelector: (s) => (s === '.gm__hud' ? { getBoundingClientRect: () => ({ top: hudTop, bottom: hudBottom ?? 0 }) } : null),
    querySelectorAll: (s) => (s.includes('.gm__corner') && corner ? corner.map((r) => ({ getBoundingClientRect: () => r })) : []),
  };
  try { return fn(); } finally { g.document = saved.document; g.getComputedStyle = saved.getComputedStyle; }
}

/** A one-row corner of `n` buttons `size` px high at bottom .24rem (css/screens/game.css .gm__corner). */
const cornerRow = (h, rem, size, n = 4) => Array.from({ length: n }, () => ({ top: h - 0.24 * rem - size, height: size }));

describe('hudBands: the folded shop\'s band', () => {
  test('HUD_REM mirrors the CSS of the folded tab and the corner', () => {
    const shop = read('public/css/screens/game-shop.css');
    const game = read('public/css/screens/game.css');
    // tab: bottom .2rem + padding .08rem × 2 + the .44rem button + 1 px + 2 px borders
    assert.match(shop, /\.shopbar-tab \{ position: absolute; right: \.26rem; bottom: \.2rem;[^}]*padding: \.08rem;[^}]*border: 1px solid var\(--line-2\); border-top: 2px solid var\(--mint-700\); \}/);
    assert.match(shop, /\.shopbar-tab__btn \{[^}]*height: \.44rem;/);
    assert.equal(HUD_REM.shopTabTop, 0.2 + 0.08 * 2 + 0.44);
    assert.equal(HUD_REM.shopTabBorderPx, 3);
    // corner (fallback when it cannot be measured): bottom .24rem + a .56rem desktop row
    assert.match(game, /\.gm__corner \{ position: absolute; left: \.24rem; bottom: \.24rem;/);
    assert.match(game, /\.gm__gear \{\n {2}width: \.56rem; height: \.56rem;/);
    assert.ok(Math.abs(HUD_REM.cornerTop - (0.24 + 0.56)) < 1e-9);
    // folded, the narrow phones' corner is one row again (the bar that made it wrap is gone)
    assert.match(read('public/css/devices.css'), /@media \(max-width: 767px\) \{\n {2}\.gm\.is-collapsed \.gm__corner \{ flex-wrap: nowrap; width: auto; \}\n\}/);
  });

  test('prep / Final Assault prep only; open = the bar (unchanged), folded = the higher of the tab and the corner', () => {
    withDom({ rem: 40 }, () => {
      for (const k of ['normal', 'unite', 'boss', 'pen']) assert.equal(hudBands(k, { width: 844, height: 390 }, { shop: false }), null, k);
      for (const k of ['prep', 'bossPrep']) {
        const open = hudBands(k, { width: 844, height: 390 });
        assert.deepEqual(hudBands(k, { width: 844, height: 390 }, { shop: true }), open);
        assert.ok(Math.abs(open.bottom - 108.6) < 1e-9, 'the bar: 2.64rem + 3 px');
        const f = hudBands(k, { width: 844, height: 390 }, { shop: false });
        assert.equal(f.top, open.top, 'the top band does not change');
        assert.ok(Math.abs(f.bottom - 35) < 1e-9, `no corner on the page: the tab .8rem + 3 px (${f.bottom})`);
      }
    });
    withDom({ rem: 100 }, () => assert.deepEqual(hudBands('prep', { width: 1920, height: 1080 }, { shop: false }), { top: 216, bottom: 83 }));
  });

  test('the corner buttons are measured, touch hit areas included; the tab sits above the bottom safe-area inset', () => {
    const h = 390, rem = 40;
    // desktop-like pointer: the buttons' own top
    withDom({ rem, corner: cornerRow(h, rem, 34) }, () => assert.ok(Math.abs(hudBands('prep', { width: 844, height: h }, { shop: false }).bottom - (9.6 + 34)) < 1e-9));
    // touch: a 44 px hit area centred on a 34 px button reaches 5 px higher
    withDom({ rem, corner: cornerRow(h, rem, 34), coarse: true }, () => assert.ok(Math.abs(hudBands('prep', { width: 844, height: h }, { shop: false }).bottom - (9.6 + 34 + 5)) < 1e-9));
    // two rows (a narrow phone with the bar open would wrap them): the higher row decides
    const two = [...cornerRow(366, rem, 34, 1), { top: 366 - 9.6 - 34 - 4 - 34, height: 34 }];
    withDom({ rem, corner: two, coarse: true }, () => assert.ok(Math.abs(hudBands('prep', { width: 756, height: 366 }, { shop: false }).bottom - (9.6 + 72 + 5)) < 1e-9));
    // a low corner: the tab wins; a notched phone's bottom inset lifts the tab (it lives inside the HUD layer)
    withDom({ rem, corner: cornerRow(h, rem, 10) }, () => assert.ok(Math.abs(hudBands('prep', { width: 844, height: h }, { shop: false }).bottom - 35) < 1e-9));
    withDom({ rem, hudBottom: h - 21, corner: cornerRow(h - 21, rem, 10) }, () => assert.ok(Math.abs(hudBands('prep', { width: 844, height: h }, { shop: false }).bottom - (21 + 35)) < 1e-9));
    // clamped like the bar's band
    withDom({ rem, corner: [{ top: 10, height: 34 }] }, () => assert.equal(hudBands('prep', { width: 640, height: 200 }, { shop: false }).bottom, 80));
  });
});

// ---- the camera itself (render/projection.js presetCamera with the folded band) ---------------------------------------

describe('the folded board grows and every bench / temp tile stays clear of the folded HUD', () => {
  const stage = JSON.parse(read('data/stages.json')).act2autochess_m01;
  const H = { h: 0.42, '#': 0.3, X: 0.55, a: 0.16, A: 0.16 }; // render/style.js TILE_H by glyph
  const heightAt = (r, c) => H[stage.rows[r]?.[c]] ?? 0;
  const tileAt = (cam, row) => cam.project(5.5, row - 0.5).x - cam.project(4.5, row - 0.5).x;
  /** Screen y extent of the bench (row 7 / boss row 0), temp (8 / 1) and back row (12 / 5) tile tops. */
  function extents(cam, rows) {
    const ys = (r, c0, c1) => { const out = []; for (let c = c0; c <= c1; c++) for (const p of tileQuad(cam, r, c, heightAt(r, c))) out.push(p.y); return out; };
    return { benchBottom: Math.max(...ys(rows.bench, 0, 9)), tempBottom: Math.max(...ys(rows.temp, 4, 8)), backTop: Math.min(...ys(rows.back, 4, 10)) };
  }
  // [w, h, coarse pointer, corner rows when folded (css/devices.css: one row again)]
  const VIEWPORTS = [[1920, 1080, false], [1280, 720, false], [1680, 1050, false], [844, 390, true], [756, 366, true], [800, 360, true], [915, 412, true], [932, 430, true]];

  test('fold → shop-collapsed camera (bigger tiles), bench above the band, back row under the bond strip; unfold → the shop camera', () => {
    for (const [w, h, coarse] of VIEWPORTS) {
      const rem = remAt(w, h);
      const btn = coarse ? Math.max(0.56 * rem, 34) : 0.56 * rem;
      for (const [kind, rows, opts] of [['prep', { bench: 7, temp: 8, back: 12 }, { rect: { ...GEO.NORMAL_RECT }, side: 'L' }],
        ['bossPrep', { bench: 0, temp: 1, back: 5 }, { side: 'L' }], ['bossPrep', { bench: 0, temp: 1, back: 5 }, { side: 'R' }]]) {
        const dom = { rem, corner: cornerRow(h, rem, btn), coarse };
        const openHud = withDom(dom, () => hudBands(kind, { width: w, height: h }, { shop: true }));
        const foldHud = withDom(dom, () => hudBands(kind, { width: w, height: h }, { shop: false }));
        const openCam = presetCamera(kind, { width: w, height: h }, { ...opts, shop: true, hud: openHud });
        const foldCam = presetCamera(kind, { width: w, height: h }, { ...opts, shop: false, hud: foldHud });
        const tag = `${kind}${opts.side} ${w}×${h}`;
        const midRow = rows.back - 2;
        assert.ok(tileAt(foldCam, midRow) > tileAt(openCam, midRow) * 1.15, `${tag}: grows (${tileAt(openCam, midRow).toFixed(1)} → ${tileAt(foldCam, midRow).toFixed(1)})`);
        const e = extents(foldCam, rows);
        // (projection.js clearHud keeps an official camera that overlaps a band by ≤ 0.5 px: float noise)
        assert.ok(e.benchBottom <= h - foldHud.bottom + 0.5 + 1e-6, `${tag}: bench ${e.benchBottom} above the folded band ${h - foldHud.bottom}`);
        assert.ok(e.tempBottom < e.benchBottom, `${tag}: temp row above the bench`);
        assert.ok(e.backTop >= foldHud.top - 1e-6, `${tag}: back row ${e.backTop} under the bond strip ${foldHud.top}`);
        // unfolding asks for exactly the shop camera again
        assert.deepEqual(presetCamera(kind, { width: w, height: h }, { ...opts, shop: true, hud: openHud }).params(), openCam.params());
      }
    }
  });

  test('1920×1080: the official shop-collapsed camera at its own scale, panned up just enough to clear the folded tab', () => {
    const off = presetCamera('prep', { width: 1920, height: 1080 }, { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false });
    const fit = presetCamera('prep', { width: 1920, height: 1080 }, { rect: { ...GEO.NORMAL_RECT }, side: 'L', shop: false, hud: { top: 216, bottom: 83 } });
    const shop = presetCamera('prep', { width: 1920, height: 1080 }, { rect: { ...GEO.NORMAL_RECT }, side: 'L', hud: { top: 216, bottom: 267 } });
    const { cy: cyFit, ...restFit } = fit.params();
    const { cy: cyOff, ...restOff } = off.params();
    assert.deepEqual(restFit, restOff, 'same optics and scale (a 2D pan of the image)');
    assert.ok(cyFit < cyOff && cyOff - cyFit < 60, `panned up ${cyOff - cyFit} px`);
    assert.ok(Math.abs(tileAt(fit, 10) - 130.7) < 0.2, `≈ 131 px per tile at row 10 (${tileAt(fit, 10)})`);
    assert.ok(Math.abs(tileAt(shop, 10) - 109.8) < 0.2, `the shop camera: ≈ 110 px (${tileAt(shop, 10)})`);
  });
});

describe('wiring', () => {
  test('the view passes the request\'s shop state to the HUD bands; the game asks for the camera of the fold state', () => {
    const app = read('public/js/render/app.js');
    assert.match(app, /hud: hudBands\(vk, sz, \{ shop: o\.shop !== false \}\),/);
    assert.match(app, /return opts\.hud\(kind, sz, o\) \|\| null;/);
    const game = read('public/js/screens/game.js');
    // issue #602 also ORs the deploy interaction's temporary fold into the camera state (issue602-deploy-fold.test.js)
    assert.match(game, /const shopFolded = showShop && \(pen \? penRef\.current\.collapsed : \(collapsed \|\| deployFold\)\);/);
    // entering prep and the boss-prep re-frame take the fold state; a fold / unfold re-frames through prepDeployCamera
    // (which calls foldCamera, still deferred while busy unless a deploy zoom is being given back — issue #602)
    assert.equal((game.match(/const pc = prepCameraFor\(pub, myId, shopFolded\);/g) || []).length, 2);
    assert.match(game, /const next = prepDeployCamera\(\{\n\s+pub, myId, deployFold, releaseDeploy: step\.release, folded: shopFolded,\n\s+ownPrep: !!view && viewModeRef\.current === 'prep' && showPrep,\n\s+pen, busy: !!drag \|\| !!facing, current: camRef\.current,\n\s+\}\);\n\s+\/\/ a null release because the pen is open stays owed; a null only because the camera already\n\s+\/\/ matches the player's fold spends it\. \[ASSUMED\]\n\s+deployZoomedRef\.current = deployZoomRemember\(step, \{ next, pen \}\);\n\s+\/\/ the fold zoom and the restore fly with the short FOLD_CAMERA_MS, not a generic camera flight\n\s+if \(next\) setCam\(next\.kind, \{ \.\.\.next\.opts, ms: FOLD_CAMERA_MS \}\);/);
  });
});
