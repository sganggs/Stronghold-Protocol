// test/render/zoom.browser.test.js — the player's own map view (zoom + pan) in a real browser: the wheel, a
// two-finger pinch / drag, a middle- or Alt+left-drag and a double click drive render/app.js, and picking
// (pickTile → Camera.unproject) still maps every tile back to itself under a zoom and a pan together.
//
// This suite exists because the unit tests cannot see the whole chain: a ReferenceError in createFieldView (for
// instance an API entry that names a function that does not exist) makes public/js/ui/fieldHost.js catch the failed
// view and degrade the WHOLE page to the simplified view — with every pure-function test still green. Booting the
// dev demo and reading window.__demo.error is what catches that.
//
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/render/zoom.browser.test.js
// Chrome path: $CHROME_PATH or the macOS default. Needs public/assets (game data / art).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';

describe('the map view (zoom + pan) in headless Chrome', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** The dev demo in the prep scene, with the map-view helpers of the test installed as window.__p. */
  async function openZoom(w = 1600, h = 900) {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.setViewport({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=prep&panel=0`);
    await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__demo.error || null), null, 'the field view booted (no degraded page)');
    await page.evaluate(() => {
      const view = window.__demo.view;
      const canvas = view.debug.app.view;
      const rect = canvas.getBoundingClientRect();
      const ev = (type, x, y, o = {}) => new PointerEvent(type, {
        pointerId: o.pointerId ?? 1, pointerType: o.pointerType ?? 'mouse', button: o.button ?? 0, buttons: o.buttons ?? 1,
        clientX: rect.left + x, clientY: rect.top + y, altKey: !!o.altKey, bubbles: true, cancelable: true,
      });
      const log = [];
      for (const n of ['pieceDrop', 'pieceClick', 'pieceDetail', 'tileClick']) view.on(n, () => log.push(n));
      window.__p = {
        view, rect, log,
        down: (x, y, o) => canvas.dispatchEvent(ev('pointerdown', x, y, o)),
        move: (x, y, o) => canvas.dispatchEvent(ev('pointermove', x, y, o)),
        up: (x, y, o) => canvas.dispatchEvent(ev('pointerup', x, y, o)),
        dbl: () => canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
        wheel: (x, y, o = {}) => canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: o.dx ?? 0, deltaY: o.dy ?? 0, shiftKey: !!o.shift, clientX: rect.left + x, clientY: rect.top + y, bubbles: true, cancelable: true })),
        zoom: () => view.getZoom(), pan: () => view.getPan(), cam: () => view.stats().camera,
        /** Every tile's own centre, projected and then picked back through the real pickTile → cam.unproject path. */
        sweep() {
          const out = {};
          for (let row = 0; row < 19; row++) {
            for (let col = 0; col < 21; col++) {
              const s = view.tileScreen(row, col);
              if (!s) continue;
              const x = s.x - rect.left, y = s.y - rect.top;
              if (x < -20 || x > rect.width + 20 || y < -20 || y > rect.height + 20) continue;
              const t = view.debug.pick.groundTile(x, y);
              out[`${row},${col}`] = t ? `${t.row},${t.col}` : 'none';
            }
          }
          return out;
        },
      };
    });
    return { page, problems };
  }

  test('the wheel zooms about the pointer; a middle / Alt+left drag pans; picking follows both', async () => {
    const { page, problems } = await openZoom();
    const base = await page.evaluate(() => window.__p.sweep());
    assert.ok(Object.keys(base).length > 50, `the preset framing shows the board (${Object.keys(base).length} tiles)`);
    assert.deepEqual(await page.evaluate(() => ({ z: window.__p.zoom(), p: window.__p.pan() })), { z: 1, p: { x: 0, y: 0 } }, 'a fresh field is the preset framing');

    // one mouse notch = exp(−deltaY · 0.0016) of the current factor, about the pointer, and the page must not scroll
    const wheel = await page.evaluate(() => {
      const { rect } = window.__p;
      const before = window.__p.cam();
      const notCancelled = window.__p.wheel(rect.width * 0.35, rect.height * 0.5, { dy: -100 });
      return { before, after: window.__p.cam(), notCancelled };
    });
    assert.equal(wheel.notCancelled, false, 'the wheel is preventDefault-ed');
    assert.ok(Math.abs(wheel.after.scale / wheel.before.scale - Math.exp(100 * 0.0016)) < 1e-6, 'one notch scales by exp(−deltaY·0.0016)');

    // two strong notches at an off-centre pointer: the tile under the cursor stays under it, picking stays exact
    const zoomed = await page.evaluate(() => {
      const { rect } = window.__p;
      const x = rect.width * 0.4, y = rect.height * 0.55;
      window.__p.wheel(x, y, { dy: -600 });
      const first = window.__demo.view.debug.pick.groundTile(x, y);
      window.__p.wheel(x, y, { dy: -600 });
      const second = window.__demo.view.debug.pick.groundTile(x, y);
      return { zoom: window.__p.zoom(), first: first && `${first.row},${first.col}`, second: second && `${second.row},${second.col}`, after: window.__p.sweep() };
    });
    assert.ok(zoomed.zoom > 1.5, `the wheel zoomed in (${zoomed.zoom.toFixed(2)})`);
    assert.equal(zoomed.first, zoomed.second, 'the world point under the pointer does not move while zooming');
    const pairs = Object.keys(base).filter((k) => k in zoomed.after);
    assert.ok(pairs.length >= 20, `the zoomed view still shows a band of tiles (${pairs.length})`);
    assert.equal(pairs.filter((k) => base[k] === zoomed.after[k]).length, pairs.length, 'every tile centre still picks its own tile under the zoom');

    // a middle-button drag and an Alt+left drag pan by exactly their travel, and never touch the board
    const pan = await page.evaluate(() => {
      const { rect } = window.__p;
      const x = rect.width * 0.5, y = rect.height * 0.5;
      const p0 = window.__p.pan();
      window.__p.down(x, y, { button: 1 });
      window.__p.move(x + 90, y - 40, { button: 1 });
      window.__p.move(x + 180, y - 80, { button: 1 });
      window.__p.up(x + 180, y - 80, { button: 1 });
      const middle = window.__p.pan();
      window.__p.down(x, y, { button: 0, altKey: true });
      window.__p.move(x - 60, y + 30, { button: 0, altKey: true });
      window.__p.up(x - 60, y + 30, { button: 0, altKey: true });
      return { p0, middle, alt: window.__p.pan(), events: window.__p.log.slice(), after: window.__p.sweep() };
    });
    assert.ok(Math.abs(pan.middle.x - pan.p0.x - 180) < 1e-9 && Math.abs(pan.middle.y - pan.p0.y + 80) < 1e-9, 'the middle drag pans by its travel');
    assert.ok(Math.abs(pan.alt.x - pan.middle.x + 60) < 1e-9 && Math.abs(pan.alt.y - pan.middle.y - 30) < 1e-9, 'the Alt+left drag pans on');
    assert.deepEqual(pan.events, [], 'a mouse pan never selects or drops anything');
    const panned = Object.keys(base).filter((k) => k in pan.after);
    assert.equal(panned.filter((k) => base[k] === pan.after[k]).length, panned.length, 'picking follows the zoom + pan combination');

    // a horizontal / Shift wheel is a trackpad pan, not a zoom
    const trackpad = await page.evaluate(() => {
      const { rect } = window.__p;
      const before = window.__p.pan();
      window.__p.wheel(rect.width / 2, rect.height / 2, { dx: 40, dy: 5 });
      const flat = { pan: window.__p.pan(), zoom: window.__p.zoom() };
      window.__p.wheel(rect.width / 2, rect.height / 2, { dx: 0, dy: 60, shift: true });
      return { before, flat, shifted: { pan: window.__p.pan(), zoom: window.__p.zoom() } };
    });
    assert.ok(Math.abs(trackpad.flat.pan.x - trackpad.before.x + 40) < 1e-9, 'a horizontal two-finger scroll pans');
    assert.ok(Math.abs(trackpad.shifted.pan.y - trackpad.flat.pan.y + 60) < 1e-9, 'Shift+wheel pans vertically');
    assert.equal(trackpad.shifted.zoom, trackpad.flat.zoom, '... and does not zoom');

    await page.close();
    assert.deepEqual(problems, []);
  });

  test('a second finger turns a drag into a pinch and drops nothing; a double click resets both', async () => {
    const { page, problems } = await openZoom();
    const pinch = await page.evaluate(() => {
      const view = window.__demo.view;
      view.resetZoom();
      const { rect, log } = window.__p;
      let piece = null;
      for (const k of view.debug.views.keys()) {
        if (!String(k).startsWith('p:')) continue;
        const v = view.debug.views.get(k);
        const s = view.tileScreen(Math.round(v.y), Math.round(v.x));
        if (s) { piece = { x: s.x - rect.left, y: s.y - rect.top }; break; }
      }
      if (!piece) return { piece: null };
      const cx = rect.width * 0.5, cy = rect.height * 0.5;
      const K = { x: rect.width / 2, y: rect.height / 2 };
      const base = view.stats().camera;                 // zoom 1 and no pan: camBase itself
      const z0 = window.__p.zoom();
      log.length = 0;
      // the first finger presses the piece and drags it: a real board drag starts
      window.__p.down(piece.x, piece.y, { pointerId: 11, pointerType: 'touch' });
      window.__p.move(piece.x + 60, piece.y + 30, { pointerId: 11, pointerType: 'touch' });
      const dragging = view.debug.drag.dragging;
      const f0 = { x: piece.x + 60, y: piece.y + 30 };
      // ... then a second finger lands: that is a pinch, so the drag is cancelled and nothing may drop or be selected
      window.__p.down(cx, cy, { pointerId: 12, pointerType: 'touch' });
      const d0 = Math.hypot(f0.x - cx, f0.y - cy);
      const mid0 = { x: (f0.x + cx) / 2, y: (f0.y + cy) / 2 };
      const f1 = { x: piece.x + (piece.x - cx) * 0.5, y: piece.y + (piece.y - cy) * 0.5 };
      const f2 = { x: cx + (cx - piece.x) * 0.25, y: cy + (cy - piece.y) * 0.25 };
      window.__p.move(f1.x, f1.y, { pointerId: 11, pointerType: 'touch' });
      window.__p.move(f2.x, f2.y, { pointerId: 12, pointerType: 'touch' });
      const k = Math.hypot(f1.x - f2.x, f1.y - f2.y) / d0;
      const kk = Math.min(k, 190 / base.scale);          // the factor actually applied (camera-aware cap, 190 px per tile)
      const mid = { x: (f1.x + f2.x) / 2, y: (f1.y + f2.y) / 2 };
      const zoom = window.__p.zoom(), pan = window.__p.pan();
      window.__p.up(f1.x, f1.y, { pointerId: 11, pointerType: 'touch' });
      window.__p.up(f2.x, f2.y, { pointerId: 12, pointerType: 'touch' });
      // the documented gesture: zoom about the starting midpoint, then the midpoint's own travel as a pan
      const expected = { x: (1 - kk) * (mid0.x - K.x) + (mid.x - mid0.x), y: (1 - kk) * (mid0.y - K.y) + (mid.y - mid0.y) };
      return { piece, dragging, z0, k, kk, zoom, pan, expected, events: log.slice() };
    });
    assert.ok(pinch.piece, 'the prep scene has a piece to press');
    assert.equal(pinch.dragging, true, 'the first finger really started a board drag (the test is meaningful)');
    assert.ok(Math.abs(pinch.zoom - pinch.kk) < 1e-9, `the pinch applied the distance ratio as the factor (${pinch.zoom.toFixed(3)})`);
    assert.ok(Math.abs(pinch.pan.x - pinch.expected.x) < 1e-6 && Math.abs(pinch.pan.y - pinch.expected.y) < 1e-6,
      `the fingers' travel panned by mid − mid0 (${JSON.stringify(pinch.pan)} vs ${JSON.stringify(pinch.expected)})`);
    assert.deepEqual(pinch.events, [], 'the pinch neither dropped nor selected anything');

    // a double click is the way back: it drops the zoom AND the pan
    const reset = await page.evaluate(() => {
      const before = { zoom: window.__p.zoom(), pan: window.__p.pan() };
      window.__p.dbl();
      return { before, zoom: window.__p.zoom(), pan: window.__p.pan() };
    });
    assert.ok(reset.before.zoom !== 1 || reset.before.pan.x || reset.before.pan.y, 'the view really was zoomed / panned before the reset');
    assert.deepEqual({ zoom: reset.zoom, pan: reset.pan }, { zoom: 1, pan: { x: 0, y: 0 } }, 'the double click reset both');

    await page.close();
    assert.deepEqual(problems, []);
  });

  test('the API clamps to the camera-aware band, and a camera change keeps the zoom but drops the pan', async () => {
    const { page, problems } = await openZoom();
    const api = await page.evaluate(() => {
      const view = window.__demo.view;
      const preset = view.stats().camera;
      view.setZoom(2.2, { x: 300, y: 260 });
      const closest = { zoom: view.getZoom(), cam: view.stats().camera };
      view.zoomBy(4);                                   // past the cap: the total factor is clamped, not multiplied on
      const afterZoomBy = view.getZoom();
      view.setZoom(0.2);
      const widest = { zoom: view.getZoom(), cam: view.stats().camera };
      view.resetZoom();
      const reset = { zoom: view.getZoom(), pan: view.getPan(), cam: view.stats().camera };
      view.setZoom(1.8, { x: 400, y: 300 });
      view.panBy(70, 60);
      view.resize();                                    // the layout changed under the player's view
      const afterResize = { zoom: view.getZoom(), pan: view.getPan() };
      view.setCamera('prep', { instant: true });        // a new framing / field
      const after = { zoom: view.getZoom(), pan: view.getPan() };
      view.resetZoom();
      return { preset, closest, afterZoomBy, widest, reset, afterResize, after };
    });
    // the camera-aware band (projection.js): 9–190 px per tile, inside the 0.5–3 factor range
    assert.ok(api.closest.zoom > 1.5 && api.closest.zoom <= 3, `the closest view is the factor cap or the tile cap (${api.closest.zoom.toFixed(3)})`);
    assert.ok(api.closest.cam.scale <= 190 + 1e-6 && api.closest.cam.scale > 100, `≤ 190 px per tile at the closest (${api.closest.cam.scale.toFixed(1)})`);
    assert.ok(api.widest.zoom >= 0.5, `the widest view is the factor floor (${api.widest.zoom.toFixed(3)})`);
    assert.ok(api.widest.cam.scale >= 9 - 1e-6, `≥ 9 px per tile at the widest (${api.widest.cam.scale.toFixed(1)})`);
    assert.equal(api.afterZoomBy, api.closest.zoom, 'zoomBy cannot pass the cap');
    // at zoom 1 with no pan the drawn camera IS the preset camera again — the object tiles.project caches by version
    assert.equal(api.reset.cam.scale, api.preset.scale, 'reset scale');
    assert.equal(api.reset.cam.cx, api.preset.cx, 'reset cx');
    assert.equal(api.reset.cam.cy, api.preset.cy, 'reset cy');
    assert.deepEqual({ zoom: api.afterResize.zoom, pan: api.afterResize.pan }, { zoom: 1.8, pan: { x: 0, y: 0 } }, 'a resize keeps the zoom, drops the pan');
    assert.deepEqual({ zoom: api.after.zoom, pan: api.after.pan }, { zoom: 1.8, pan: { x: 0, y: 0 } }, 'a camera change keeps the zoom, drops the pan');

    await page.close();
    assert.deepEqual(problems, []);
  });
});
